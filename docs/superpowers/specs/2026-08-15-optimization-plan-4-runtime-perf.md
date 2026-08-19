# 优化计划四：运行时性能（波形平移增量渲染 + 播放循环生命周期 + 分析热路径）

> 目标版本：v1.6.0 系列第一步。失败则回退至 v1.5.4 并记录原因。
> 状态：方案评审稿（2026-08-15）。基准数据来自 `tools/bench_analysis.js`（Node 24）。

## 背景与问题

对 v1.5.4 全链路走读后，按「用户持续感知程度 × 优化性价比」排序，剩余热点如下：

1. **波形平移仍每帧全量重绘（交互帧率大头）**：纯滚轮平移、Shift 拖拽平移是最高频交互，
   但 `setView → renderWave → render.draw` 每次都全量重绘背景 + 逐像素波形（`for x in 0..cssW`，
   高 DPR 下 1600–3200 个 `moveTo/lineTo` + 单次大 stroke）+ 网格 + 选区 + 时间轴。
   已有 rAF 帧合并（合并的是**绘制次数**，不是**绘制量**）——**平移时波形形状完全不变**，
   只是整体 x 偏移，现有实现却重新逐像素计算整幅波形。v1.1.0 的二分/步长优化把单帧成本压到
   全量下限，但全量本身才是平移场景的浪费。
2. **tickProgress 的 rAF 死循环**（`main.js:866-924`）：函数末尾无条件
   `requestAnimationFrame(tickProgress)` 自续，`playing=false` 时每帧回调空跑。暂停/停止后
   页面仍以 60fps 持续空转（省电/后台运行场景可见），且 `playAnalyser` 置 null 时未
   `disconnect`，audio 图残留 analyser→destination 连接。
3. **spectralFlux 幅度计算用 `Math.hypot`（分析全链路最大单项）**（`analysis.js:103`）：
   V8 的 hypot 走溢出防护慢路径，比 `sqrt(re²+im²)` 慢 3–5 倍；每帧 1024 次、3 分钟曲目约
   800 万次。另 `prev = Float64Array.from(mags)`（`analysis.js:113`）每帧分配 1024 元素数组，
   帧数约 7700 次 → GC 压力。实测（`tools/bench_analysis.js`）：3 分钟曲目全链路 `analyze`
   583ms，其中幅度+FFT 阶段占 545ms。
4. **estimateBpm 的 scoreAt 每 lag 对每 sample 二分**（`analysis.js:242-256`）：
   350 lag × 600 sample × 二分 → 约 210 万次比较。实测 1.59ms——绝对收益小（顺手项），
   但双指针单调扫描可 2.5× 且纯函数易测。
5. **序列输入路径全列表重建**：`UnitInput` 的 `onChange`（每敲一个键触发）→ `setRange` →
   `saveWorkspace`（同步写 localStorage）→ `renderAll` → `renderSequenceList` 全量
   `innerHTML=''` + 重建每张卡片（含 2 个 UnitInput 组件实例）。序列 10+ 项时单次输入
   即可见卡顿；拖动重排同路径全量重建。

## 方案设计

### P0. 波形平移增量渲染（scroll blit）——render.js + main.js

**核心思想**：静态层（`#wave` canvas）维护一张同物理尺寸的离屏缓存 `waveCache`，
保存最近一帧完整绘制结果。当 `view` 变化为**纯平移**（缩放级别不变）时：

1. 计算像素偏移 `dxPx = round((view.start − lastView.start) × cssW / lastSpan)`；
2. `ctx.drawImage(waveCache, dxPx, 0)` 把旧帧整体平移（GPU blit，~0.5ms）；
3. 仅重绘露出的边缘条带：`dxPx>0 → x ∈ [cssW−dxPx, cssW)`，`dxPx<0 → x ∈ [0, −dxPx)`；
4. 把结果拷回缓存（`cacheCtx.drawImage(canvas, 0, 0)`），更新 `lastView`。

**实现要点**：

- **条带参数化**：把 `draw` 拆为 `drawRange(ctx, view, data, x0, x1)`，内部所有绘制按
  x 区间裁剪——波形循环 `for (x = x0; x < x1; x++)`（bIdx 累加器从 x0 起步）、网格二分
  改用条带对应时间区间 `[t0, t1]`、轴刻度循环按 `[t0, t1]` 过滤、选区/序列高亮
  `fillRect` 前按 x 交集裁剪。全量绘制 = `drawRange(0, cssW)`，单一绘制逻辑不漂移。
- **增量路径条件**：span 相对变化 < 0.5% 且 |dxPx| < cssW 且 canvas 物理尺寸未变且
  数据版本未变（peaks/grid/sequence/dragRange/pendingSelection/cursorPos/主题）。
  `dragRange` 拖拽预览每帧变化 → 强制全量（select 模式本就不走平移路径）。
- **累积误差**：dxPx 逐帧 round，误差 ≤ 0.5px/帧，视觉不可见；每次缩放全量重绘清零。
- **播放线不受影响**：叠加层 `#playHead` 独立（现状保持）。
- **顺带微优化**（并入本条）：波形循环 `Math.floor((c.start + x*c.step)*c.k)` 改累加器
  （`acc += c.k*c.step`，每像素省 1 次乘法）；渐变对象按 `waveH` 缓存（THEME 变化失效）。

**收益**：平移每帧绘制量从 O(cssW)（全量 1600+ 线段）降到 O(|dxPx|)（典型 20–100px 条带），
60fps 稳定；缩放保持现状（本已可接受）。

**风险**：条带重绘与全量绘制的一致性（用同一 `drawRange` 消除）；drawImage 自身到自身
属未定义行为，必须经离屏中转；DPR 下统一用物理像素整数坐标。

### P1. tickProgress rAF 生命周期——main.js

- 现状：`tickProgress` 末尾无条件自续 rAF；`playing=false` 时回调空跑。
- 方案：末尾改 `if (playing) requestAnimationFrame(tickProgress)`；播放起点
  （`playAudioSegment`/`playVideoSegment`/`playSequence`）已调用 `tickProgress()`，
  暂停/停止时链自然终止。
- 附带：`pausePlay`/`stopPlay` 中 `playAnalyser && playAnalyser.disconnect()`（当前只
  置 null，`analyser → destination` 连接残留）。

**收益**：停止播放后渲染循环归零（省电/发热/后台标签页）。

### P2. spectralFlux 幅度计算——analysis.js

- `mags[i] = Math.sqrt(re[i]*re[i] + im[i]*im[i])` 替代 `Math.hypot`。幅度上界
  ≤ 2048（Hann 窗和 ≤ 1024 × 样本 ≤ 1），`re²+im²` 远小于 double 上限，无溢出风险；
  结果差 ≤ 1 ulp，detectOnsets 全为相对/阈值比较（test_analysis 已确认非精确断言）。
- `prev` 改模块内双缓冲（`let prev/cur` 帧间交换），消除每帧 `Float64Array.from` 分配。
- 实测：幅度+FFT 阶段 545→391ms；全链路 583→约 430ms（约 27%）。

### P3. estimateBpm 双指针单调扫描——analysis.js（顺手项）

- 现状：`scoreAt(lag)` 对每个 `sample[k]` 二分 `hasNear`。
- 方案：`sorted` 有序且 `t = sample[k] + lag` 随 k 单调不减 → 窗口 `[t−0.03, t+0.03]`
  的 lo/hi 指针单调右移，每 lag O(N) 无 log。
- 实测：1.59→0.63ms（2.5×）；正确性以「随机 lag 双指针 vs 二分一致」抽查证明
  （`tools/bench_analysis.js` 已内置，60 lag 一致）。

### P4. 序列输入路径局部更新 + saveWorkspace 防抖——main.js + ui.js

- **P4a（先做，低成本高收益）**：`setRange` 不再触发 `renderAll` 全列表重建——输入合法
  时仅更新该卡片文本/校验态（或调用轻量刷新）；非法时保留现有 `markInvalidCard` 路径。
  `saveWorkspace` 加 150–300ms 防抖合并连续输入。
- **P4b（视序列规模需要）**：`renderSequenceList` 改 keyed reconcile——按 id 保留卡片
  DOM 与 UnitInput 实例，增/删/移动只操作对应节点，杜绝 `innerHTML=''` 全量重建。

**收益**：序列 10+ 项时单次输入从「全列表重建 + 同步 localStorage 写」降为局部更新；
拖动重排顺滑。

### P5. 资源释放杂项——main.js

- 切文件时 `URL.revokeObjectURL(videoEl.src)`（`main.js:270` 只建不撤，重复开视频泄漏
  Blob URL + 解码缓冲）。
- `handleFile` 开头清空 `mixCache`（避免旧拼接 buffer 悬挂到下次播放）。

## 测试用例设计（TDD，先写测试）

| 编号 | 测试 | 预期结果 |
|---|---|---|
| T1 | 单元：`drawRange(x0,x1)` 与 `drawRange(0,cssW)` 输出逐像素一致 | mock ctx 记录命令序列等价（覆盖 P0 条带/全量一致性） |
| T2 | 单元：纯平移时波形绘制循环只访问 x ∈ 条带 | mock ctx 统计 lineTo 的 x 坐标 ⊆ 条带（覆盖 P0） |
| T3 | 单元：非平移（span 变化/数据变化）强制全量 | 增量路径不触发（覆盖 P0 失效条件） |
| T4 | 集成：停止播放后 rAF 不再调度 | Performance 面板 scripting 归零 / spy 计数（覆盖 P1） |
| T5 | 单元：spectralFlux 输出与现状逐元素一致（±1e-9 容差） | 现有 test_analysis 全过（覆盖 P2） |
| T6 | 单元：双指针 scoreAt 与二分 scoreAt 全 lag 一致 | 随机合成 onset 全量对比（覆盖 P3） |
| T7 | 性能基准：`tools/bench_analysis.js` 全链路 | 3min 曲目 analyze < 450ms（现状 583ms） |
| T8 | 回归：现有 Node 测试套件（59 个）全部通过 | — |

## 实施顺序

1. P2（一行 + 双缓冲，风险最低，收益可测）→ 跑 `tools/bench_analysis.js` 记录数字。
2. P3（双指针，纯函数）→ T6 等价性测试。
3. P1（rAF 生命周期 + analyser disconnect）→ T4。
4. P5（资源释放，两处小改）。
5. P0（drawRange 参数化 + 离屏缓存）→ T1/T2/T3，浏览器实测平移/缩放帧率。
6. P4a（setRange 局部化 + 防抖）→ 浏览器实测输入卡顿；P4b 视序列规模决定。
7. 全量回归 + `python build.py` 重打包 + 浏览器实测（Edge/Chrome 各一轮）。

## 验收标准

- 平移（滚轮/Shift 拖拽）期间 scripting < 8ms/帧（Performance 面板，cssW=1600, dpr=2）；
  缩放保持现状无明显回退；
- 停止播放后 Performance 面板无周期性 scripting；
- 3 分钟曲目自动识别 < 450ms（现状 583ms）；
- 序列 20 项时编辑输入无可见卡顿；
- 现有测试套件（59 个）全部通过；dist 打包后浏览器实测无回归；
- 波形视觉效果与 v1.5.4 完全一致（无闪烁、无错位、无白边）。

## 已排除项（记录决策）

- **波形层 ImageData 逐像素填充**：1px 竖线可直接写像素，但失去渐变与抗锯齿、
  实现与主题系统耦合，收益低于 P0，不做。
- **Canvas 2D 换 WebGL**：重构面过大，P0 已覆盖主要浪费，不做。
- **analysis 分块 Worker**：识别为一次性操作（<0.6s），当前秒级反馈可接受；
  若未来接入多段并发识别再评估。
- **音频解码流式降采样**：decodeVideoAudioTrack 的 chunk 级降采样可降内存峰值，
  复杂度高，当前内存可接受，不做。
