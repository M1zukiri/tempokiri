# 设计：波形渲染与视频播放性能优化（去光晕 + 绘制走读优化）

> 目标版本：v1.0.1 系列第一步。失败则回退至 v1.0.0 并记录原因。
> 状态：已获用户确认（彻底移除光晕；砍掉渐变缓存 A3；本次范围 A1/A2/A4/A5/A6）。

## 背景与问题

用户在拖动/缩放波形图、播放视频时可感知明显卡顿。经链路分析定位到以下瓶颈（按收益排序）：

1. **`shadowBlur` 光晕（头号元凶）**：波形描边每帧 `shadowBlur=4`（`render.js:167`）、播放线每帧 `shadowBlur=6`（`render.js:288`）。`shadowBlur` 是 Canvas 2D 最昂贵操作之一——每次 stroke 额外光栅化一层模糊缓冲，在 DPR=2 大画布下把描边成本放大数倍到十几倍。
2. **网格/节拍线全量遍历**：`grid.beatTimes`（`render.js:179`）、`grid.bars`（`render.js:192`）每帧从头遍历全量，虽只画可见项，但循环本身 O(N)，长音频几千条。
3. **逐像素浮点除法**：`t * sr` + `Math.floor(sIdx / bucket)`（`render.js:149-150`）每像素一次浮点除（≈1000–2000 次/帧）。
4. **播放线无位移阈值**：`drawPlayHead`（`render.js:272-294`）在 `playTime` 像素位移 < 1px 时仍每帧 `clearRect + stroke`。

## 方案设计

> 用户决策：**彻底移除光晕**（波形与播放线均不再用 shadowBlur，改用纯渐变描边，保留青色渐变立体感）。**砍掉渐变缓存（原 A3）**——渐变对象绑定特定 ctx，跨调用复用需 `WeakMap<ctx,{waveH,grad}>` 管理生命周期，收益最弱、实现最绕，YAGNI。

- **A1. 移除波形光晕**：删除 `render.js:166-169` 的 `shadowColor`/`shadowBlur`，波形描边改用纯渐变（渐变本身已有立体感）。
- **A2. 移除播放线光晕**：删除 `render.js:287-293` 的 `shadowColor`/`shadowBlur=6`。
- **A4. 网格/节拍线二分查找**：`beatTimes`/`bars` 有序，用 lower_bound/upper_bound 定位可见区间，只遍历 `[lo, hi)`，遍历从 O(N) 降到 O(log N + 可见)。
- **A5. 步长替代逐像素除法**：提取纯函数，预计算 `samplesPerPixel`，逐像素累加定位 bucket，替代 `Math.floor(t*sr/bucket)`。
- **A6. 播放线像素阈值**：提取纯函数，`playTime` 像素位移 < 1px 时跳过 `drawPlayHead` 重绘。

## 测试用例设计（TDD，先写测试）

沿用 `test_render.js` 的 mock 2D context 模式，扩展 `mockCtx()`：加 `shadowBlur` setter 追踪（`shadowGlowUsed` 标志）+ `createLinearGradient` 计数。

| 编号 | 测试 | 预期结果 |
|---|---|---|
| T1 | 契约：`R.draw` 波形描边全程 shadowBlur 从未 > 0 | `ctx.shadowGlowUsed === false`（覆盖 A1） |
| T2 | 契约：`R.drawPlayHead` 全程 shadowBlur 从未 > 0 | `ctx.shadowGlowUsed === false`（覆盖 A2） |
| T3 | 性能特征：网格/节拍线只遍历可见区间 | Proxy 记录被访问索引 ⊆ 可见区间 ±1 边界（覆盖 A4） |
| T4 | 正确性：步长与除法 bucket 定位等价 | 随机 view/width/bucket/sr 逐像素抽样结果一致（覆盖 A5） |
| T5 | 性能特征：播放线像素阈值 | `|Δx|<1` 不重绘、`≥1` 重绘、越界/null 不重绘（覆盖 A6） |
| T6 | 回归：现有 5 个 test_render 用例全部通过 | 波形/网格/播放线坐标正确性不变 |

## 实施顺序

1. 写 T1/T2 → 跑测试看到失败（`shadowGlowUsed === true`）→ 改 `render.js` 移除光晕 → 通过。
2. 写 T4（提取 `bucketIndexOf` 纯函数 + 等价性）→ 失败 → 实现步长 → 通过。
3. 写 T3（Proxy 遍历裁剪）→ 失败 → 实现二分 → 通过。
4. 写 T5（提取 `playHeadX` + 阈值）→ 失败 → 改 `main.js` tickProgress 接入 → 通过。
5. 全量回归 + `python build.py` 重打包 + 浏览器实测。

## 验收标准

- T1–T5 全过，现有测试套件（Python 13 + Node 59）全部通过；
- 打包 dist 后浏览器实测：拖动/缩放/播放体感流畅，无回归；
- 视觉上波形保留青色渐变立体感，仅失去辉光（已获用户确认可接受）。
