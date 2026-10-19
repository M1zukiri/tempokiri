# Tempokiri 批注修改计划（2026-10-19）

> 创建时间：2026-10-19 14:50:00
> 批注来源：外层工作区 `review/annotations-2026-10-19.json`（6 条），页面 `sha256 4cc60ba8…`（996187 字节）与当前 `dist/tempokiri-workstation.html` 一致
> 基线 1.21.0 ｜ 本批目标 **1.22.0**（a5 导出扩展量大，独立进 **1.23.0**）

## 0 已确认的决策

| 批注 | 决策 |
|---|---|
| a1 视频尺寸 | 只做**预览面板**宽度可调；导出分辨率档位不动 |
| a2 BPM 规范化 | **拟合代价门槛吸附**：整洁值与最优值网格代价接近才吸附，分数 BPM 不误伤 |
| a4 留空一小节 | 提供选项，**默认关** |
| a5 导出扩展 | 做 5 项：分段批量导出 / 首尾淡入淡出 / LUFS 归一化 / 参数记忆 / 节拍数据导出；**不做**视频叠加网格 |

## 1 逐条方案

### A3 候选「另一半」修正（先做，纯算法、无 UI 风险）

**现状**：八度提升后 `scan = wide`（`analysis.js:709`），候选 `harm` 相对宽扫主峰（80）计算（`analysis.js:318-325`），且距主峰 <2 BPM 的峰被过滤（`analysis.js:344`）→ 候选里出现已采用值 `159.9（2×）`，真正的 80 不在列表。

**改法**：`analyze()` 组装候选时以**最终 bpm** 为基准——补入 `bpmBeforeOctave`（标 `½×`）、剔除与最终值重复的候选、标签按最终值重算；`modal.js renderCands` 增加近值去重。

**落点**：`src/analysis.js`（`scanBpm` 候选组装 / `analyze` 返回）、`src/modal.js:253-284`
**验收**：单测——提升后候选含 `80`（½×）且不含 `159.9`；无提升时行为不变；`node --test` 全绿。

### A2 BPM 规范化（拟合代价门槛）

**现状**：`refine` 以 0.1 步长收敛（`analysis.js:303-315`），八度提升把误差 ×2（79.95 → 159.9）。

**改法**：`scanBpm` 的 refine 之后新增 `normalizeBpm(v, sample)`——候选整洁值 q ∈ {round(v), round(v×2)/2}；仅当 `|q−v| ≤ 0.6` 且 `gridCost(q) ≤ gridCost(v) × 1.02` 时采用 q；候选值同样吸附后去重。`modal.js` 显示改为 `String(Number(x.toFixed(2)))`（160 不再显示 160.0）。

**风险控制**：门槛吸附对真分数 BPM（如 159.5）不应生效——单测覆盖「代价差大 → 不吸附」；算法改动必须过 `eval_adx` 配对评估。
**落点**：`src/analysis.js`、`src/modal.js:304/313`、`tests/test_analysis.js`
**验收**：单测；`node tools/eval_adx.mjs --n=300 --seed=42 --variants=base,baseNorm`（同页面配对）：≤0.1 与 ≤0.6 不降、落半频不增、中位误差不升。

### A4 自动识别「额外留空一小节」

**现状**：`offset = 第一个 onset`（`analysis.js:716-718`）；1.20.0 的 A1 同类需求未落地，只在 Majdata 导出加了补空小节（`main.js:1604-1622`）。

**改法**：

- `modal.js` 识别区新增复选框「自动识别后额外留空一小节」，**默认不勾**；勾选态经 `onAutoDetect` 传给 `main.autoDetect`。
- 第 1 段识别：`offset = round3(onset − 60/bpm × beatsPerBar)`；`beatsPerBar` 缺省 4（现无拍号识别，天然 4/4）。
- 边界：`offset > −首段小节长` 的三处守卫（`analysis.js:448-456`、`modal.js:338-342`、`main.js:1715-1721`）保持不动；`onset = 0` 时 clamp 到 `−barDur + 0.001` 并在状态栏说明。
- 状态栏文案补「已留空一小节」。

**落点**：`src/modal.js`、`src/main.js:686-733`、`strings.json`、`tests/test_analysis.js`（新增纯函数 `padBarOffset`）
**验收**：单测；无头实测——导入示例曲 → 勾选识别 → `mOffset` 提前一小节、应用后网格第 1 小节全空、从第 1 小节起导出带静音。

### A6 灰阶主题（黑白灰）

**改法**：新增 `data-theme="mono"`——纯黑底 + 灰阶面板/文字，accent 用高亮灰，`danger/warning` 以明度区分（严格无彩）。同步 7 处：`index.html` 主题块、`render.js CANVAS_THEMES`、`footer.js THEME_ORDER`、`settings.js` 预设、`main.js applyTheme` 白名单、`store.js` 注释、`strings.json` 文案；测试与 README/CLAUDE 的「五主题」改「六主题」，`verify_ui_v20` S3/S9 扩到 6 套。

**验收**：单测、`verify_ui_v20` 全绿（六主题 accent 独立、CSS 变量全可解析、360px 无溢出）。

### A1 视频预览宽度可调

**改法**：`#waveRow` 内波形与视频之间插入 6px 竖向拖拽条（`waveWrap` order 1 / 拖拽条 2 / `videoWrap` 3）；拖动范围 180–640px，双击复位 260px；宽度持久化到全局设置 `videoPaneWidth`；≤480px 堆叠布局隐藏拖拽条、沿用 100% 宽。

**落点**：`index.html`、`src/main.js`、`src/store.js`（`DEFAULT_GLOBAL` 加 `videoPaneWidth: 260`）、`tests`（宽度 clamp 纯函数）
**验收**：无头实测拖动/复位/重开保留；360px 无横向溢出。

### A5 导出扩展（1.23.0，独立批）

1. **分段/选区批量导出**：导出弹窗音频/视频面板加「范围：整条序列 / 逐段」；逐段渲染并打包为最小 ZIP（store 方式自实现，不引入依赖）一次下载；文件名模板 `{index}_{名称}`。
2. **首尾淡入淡出**：音频面板 +（视频音轨）淡入/淡出 ms；画面淡入淡出单列后续。
3. **LUFS 响度归一化**：BS.1770 K 加权 + 门限积分，目标 −14/−16/−23；与峰值归一化二选一。
4. **导出参数记忆**：全局设置 `exportPrefs` 按 Tab 记住上次参数 + 「恢复默认」。
5. **节拍数据导出**：导出弹窗新增「节拍数据」Tab（CSV/JSON：BPM 段、offset、每小节/每拍起止时间）。

**风险**：多次触发下载会被浏览器拦截 → 用 ZIP 规避；LUFS 需对拍 ITU 标准信号单测。

## 2 实施顺序与批次

| 批次 | 内容 | 前置 |
|---|---|---|
| 1 | A3（候选修正） | 无 |
| 2 | A2（规范化 + eval 对照） | A3（同一链路） |
| 3 | A4（留空小节） | 无 |
| 4 | A6（灰阶主题） | 无 |
| 5 | A1（预览宽度） | 无 |
| 6 | A5（导出扩展，1.23.0） | A2/A4 定稿 |

## 3 全局验收

1. `node --test tests/test_*.js` 全绿（基线 233）
2. `python build.py` 零报错，`strings.json` 无冗余 key 警告
3. `eval_adx` 300 首配对：BPM 指标不劣化
4. 无头 Edge：六主题、拖动预览、识别留空、导出新流程，零 JS 错误
5. 批注副本：本批落地后重新生成 `review/tempokiri-workstation.annotate.html`（旧副本与新构建指纹不一致后失效）

## 4 待确认

无（a1/a2/a4/a5 已定；a3/a6 无歧义）。

## 5 实施结果（1.21.1 – 1.21.5，a1–a4 / a6）

| 批注 | 版本 | 落地 | 验证 |
|---|---|---|---|
| a3 候选修正 | 1.21.1 | `analysis.finalBpmCandidates`（补回提升前八度层、剔除当前值/近值）；UI 去掉倍频标签 | 单测 236/236；Majproject 八度提升 26 首，候选含提升前值 **0/26 → 26/26** |
| a2 BPM 整洁化 | 1.21.2 | `analysis.normalizeBpm`（整数优先、拟合代价门槛 5%，只在最终值上做）；`modal.fmtBpm` | 242/242；Majproject 整数真值精确命中 **26→29**、≤0.1 **29→30**，分数真值 114.08 未误吸附 |
| a4 留空一小节 | 1.21.3 | `analysis.padBarOffset` + `#mPadBar`（默认关）+ `main.autoDetect` 第 5 参 | 246/246；`verify_a4` **9/9** |
| a6 Monochrome | 1.21.4 | `[data-theme=mono]` 全链路 7 处（严格灰阶） | 246/246；`verify_ui_v20` **41/41**；`verify_a6` **14/14** |
| a1 预览宽度 | 1.21.5 | `#videoResizer` + `--video-pane-w` + 全局设置 `videoPaneWidth` | 247/247；`verify_a1` **11/11** |

**过程中修正的两个设计陷阱**（已写入版本历史）：① 整洁化若放在 `scanBpm` 内，会把主峰 67.5 先吸成 68，破坏八度判定的 2× 比例检查——实测把 130 BPM 的曲子掉回 68；改为只在 `analyze()` 最终值上做。② 视频宽度若写行内 `style.width`，会压住 ≤480px 堆叠布局的 `width:100%` 媒体查询；改用 CSS 变量 `--video-pane-w`。

**剩余**：a5 导出扩展（目标 1.23.0，5 项）。
