# 优化计划一：性能优化（波形缩放渲染 + mp4 同步播放）

> 目标版本：v0.2.0 系列第一步。失败则回退至 v0.1.x 并记录原因。

## 背景与问题

1. **波形缩放渲染**：滚轮 Ctrl+缩放 / Shift 平移时，每次 `setView` 都触发 `renderWave()` → 完整 `render.draw()`：背景填充、逐像素波形线（`for x in 0..cssW`）、网格线、选区、时间轴全量重绘。已有 `requestAnimationFrame` 合并，但**每帧全量重绘 + 逐像素浮点换算**在宽屏（高 DPR）下是主成本。播放时另有叠加层 `drawPlayHead`（已优化为独立层），但静态层重绘未做增量。
2. **mp4 同步播放**：拼接播放时 `tickProgress` 每 4 帧（~15fps）对 `videoEl.currentTime` 做 seek 跟随。**video 元素 seek 是重操作**（解码器刷新 + 帧定位），高频 seek 会造成画面卡顿、音画不同步，甚至解码器繁忙。用户反馈"mp4 同步播放卡顿"即源于此。

## 方案设计

### A. 波形渲染性能

- **A1. 帧合并（coalescing）**：`renderWave` 改为"标记脏 + rAF 单次执行"——连续多次 `setView`（滚轮高频事件）只触发一次实际绘制。
- **A2. 绘制走读优化**：
  - 波形段：`buildPeaks` 金字塔已按缩放级别取桶，保留；把 `moveTo/lineTo` 改为批量 `ctx.beginPath()` 单次 `stroke()`（已如此，验证无重复 beginPath）。
  - 网格线：按视口裁剪（已有 `if (bt < view.start || bt > view.end) continue`），补充小节线批量 path 合并（当前每个 bar 单独 beginPath/stroke，改为一条 path 一次 stroke）。
  - 时间轴刻度：计算可见刻度数量上限（避免长时段下几百个刻度全画）。
- **A3. 播放期间静态层不重绘**：`drawPlayHead` 已独立；确保 `tickProgress` 不触发 `renderWave`（当前不触发，验证保持）。
- **A4. 离屏 canvas 缓存波形层**（若 A1+A2 后仍 >16ms）：缩放时用 `OffscreenCanvas` 缓存峰值层，仅网格/选区重绘。

### B. mp4 同步播放

- **B1. seek 节流与自适应**：把"每 N 帧 seek"改为**基于时间差**的节流（如两次 seek 间隔 ≥ 100ms），且仅在画面需要更新时 seek（`videoEl.currentTime` 与目标差 > 0.5 帧时）。
- **B2. 段内平滑、段间 seek**：拼接播放时，若目标时间落在当前已显示的段内，不 seek（video 自然播放）；仅在跨越段边界时 seek。即维护 `lastSeekedSegment`。
- **B3. 暂停时停止 seek**：`playing=false` 时 tickProgress 已 return（验证）。
- **B4. 播放结束清理**：`src.onended`/`stopPlay` 时 `videoEl.pause()`，避免后台继续解码。

## 用户角度测试用例

| 编号 | 操作 | 预期结果 |
|---|---|---|
| U1 | 导入 223s 真实 mp4，Ctrl+滚轮连续快速缩放 10 次 | 缩放跟手不卡顿，波形清晰（无闪烁、无白屏中间态） |
| U2 | 缩放后播放原曲，观察画面 | 视频画面流畅跟随，无频繁跳动/卡顿 |
| U3 | 播放拼接序列（含跨段跳转） | 画面在段边界正确跳转，段内平滑；播放线位置准确 |
| U4 | 快速平移（Shift 拖拽） | 平移过程波形即时更新，无滞后感 |
| U5 | 长时间播放后停止 | 画面停止，无残留播放线/继续 seek |

## 开发角度测试用例

| 编号 | 测试 | 预期结果 |
|---|---|---|
| D1 | 单元：buildPeaks 各级桶边界 | 各级长度 = ceil(n/bucket)，min/max 正确（现有测试保持通过） |
| D2 | 单元：render.draw 视口裁剪 | 视口外小节线/节拍线不绘制（mock ctx 统计 lineTo 调用数随 view 变化正确） |
| D3 | 性能基准：基准波形绘制耗时 | 优化后单帧 draw（cssW=1600, dpr=2）< 12ms（优化前测量值记录对比） |
| D4 | 性能基准：连续缩放 30 次 setView | rAF 合并后实际绘制次数 ≤ 缩放事件数 / 2（帧合并生效） |
| D5 | 集成：mp4 播放时 videoEl.seek 调用频率 | 播放 10s 内 seek 次数 < 100（B1/B2 生效，优化前 ≈400+） |
| D6 | 回归：播放线位置 | drawPlayHead 在暂停/继续/停止后位置正确（现有 36 测试保持通过） |

## 验收标准

- 全部 U1–U5 通过；
- D3/D4/D5 优化后指标优于优化前基准（记录具体数字）；
- 现有测试套件（39 个）全部通过；
- 打包 dist 后浏览器实测无回归。
