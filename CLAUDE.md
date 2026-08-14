# CLAUDE.md

Tempokiri — 节奏感知的音频/视频剪辑工作站，以单 HTML 文件交付的浏览器端应用。
原 CLI 版本（Python + librosa）已移除——工作站已完整覆盖其功能，产品唯一交付物即打包后的 `dist/tempokiri-workstation.html`。

## 结构速查

```
index.html           主页面（开发期引用 src/*.js）
src/*.js             浏览器模块，UMD 挂到 window.MC（MC.analyze、MC.buildGrid …）
dist/                build.py 打包产物（gitignore）
tests/               Node 单元测试（node --test）
VERSION              版本号单源（build.py 注入页脚）
```

## 常用命令

```bash
python -m http.server 8734            # 开发伺服（浏览器缓存 src/*.js 时用无痕/禁用缓存）
python build.py                       # 打包 → dist/tempokiri-workstation.html
node --test tests/test_*.js   # 单元测试（analysis/export/sequence/audio/render/ui/store/footer）
```

## 关键约定

- **采样率**：`state.pcm` 恒为 22050（`DEFAULT_ANALYSIS_SR`）；`state.rawMono` + `state.sampleRate` 供导出；分析窗口必须用 22050 索引，否则 BPM 翻倍/减半
- **确认制**：自动识别只填充输入框，点「确认」才应用网格
- **段语义**：末段长度恒为"剩余所有"（modal 渲染 + 校验跳过）；段分辨率 `resolution`（每小节线数，默认=拍号分子）
- **offset 语义**：首条网格线（拍线）的绝对位置 = 第一个 onset；顶部快捷栏 ± 按钮即时生效
- **选区**：`snapRange` 区间交集——部分覆盖的小节即被选中
- **交互**：单击定位播放起点（不播放）、双击选小节、拖拽选区、卡片按住拖动排序（让位动画）、纯滚轮平移、Ctrl+滚轮缩放
- **git**：外层仓库 `个人/` 跟踪本仓库（历史），本仓库 `tempokiri/tempokiri/` 是独立仓库（推送 GitHub M1zukiri/tempokiri）；内层仓库**绝不被外层 gitlink 跟踪**（曾误加 3 次）
- **视频**：音轨提取优先 WebCodecs 直解（mp4box demux → AudioDecoder），降级 captureStream；导出仅 MP4/MOV（WebCodecs，Firefox 不支持）
- **视频音轨 PCM**：AudioDecoder 输出 f32-planar，`copyTo` 必须逐平面（`planeIndex`）拷贝到 `planar[ch*frames+i]`，汇总按平面索引混合（`mixPlanarChunks`）——交错读取会致立体声每 chunk 后半静音（锯齿音根因）
- **交叉淡化**：默认 30ms 等功率余弦；可经全局设置 `crossfadeMs` 调整（store.loadGlobalSettings），导出窗口预填
- **快捷键**：空格播放/暂停（输入框聚焦时忽略）、Esc 关闭弹窗、←/→ 平移视口
- **视图持久化**：`saveWorkspace` 存 view，切文件恢复（越界回退全览）
- **播放线**：`currentPlayTime()` 是 tickProgress 的关键依赖，编辑 tickProgress 时切勿误删（曾致播放线静默失效）
- **拼接进度条**：`seqProgressMeta`（sequence.progressMeta）给出总时长与各拼接点累计位置；拖动 seek 走 `seekMix`（暂停→设 mixPos→重播）；**pausePlay 停止前必须清空 src.onended**（stop() 的 ended 异步触发，会误杀 seek 后的新播放）；**序列内容不变的拼接结果由 `getMixBuffer` 缓存（key = parts/crossfade/sr 的 JSON 指纹），seek 复用 AudioBuffer 不重拼**（任何序列/淡化/设置修改都会使 key 失效自动重拼）
- **拼接点标记**：进度条上金黄竖线（`.seam`），位于每相邻两段的边界；播放头玫红圆点、已播放填充青色渐变
- **页脚**：`footer.js` 的 `README_SOURCE`/`VERSION` 由 build.py 注入（src 模式保持占位符，`resolveVersion()` 回退 `dev`、README 弹窗回退提示）；版本号**单源**于根级 `VERSION` 文件；`[data-version]` 徽标由 initFooter 填充
- **build.py 注入**：README/版本替换用**函数式 repl**（lambda）避免 `re.sub` 转义反斜杠；占位符判定用首字符 `'_'` 检查而非字面量比较（会被替换误伤）

## 版本历史

- **1.4.1**：高级设置「界面主题」移至第一栏（FIELD_DEFS 首项）；品牌字改用 Georgia 衬线栈（.brand 的 Tempokiri 与页脚 M1zukiri，中文「工作站」保持无衬线）
- **1.4.0**：三套配色主题（暗夜青蓝默认 / 幽夜霓紫 / 纸墨贝色，`data-theme` 属性 + CSS 变量，高级设置「界面主题」切换并持久化到 `tempokiri.remix.global.v1.theme`）；render.js 新增 `setTheme`/`CANVAS_THEMES` 同步波形 canvas 色；全局精致化（brand 渐变字、focus-visible 轮廓、数字等宽、按钮圆角）；签名元素「律动品牌标」（顶部 brand 旁 8 柱律动条，播放时 AnalyserNode 时域数据驱动，静止正弦包络）；主题相关硬编码色全部收编为 9 个语义变量（--accent-fg/--wave-bg/--input-bg/--chip-bg/--scroll-thumb…）
- **1.1.2**：移除 CLI 交付物（Python+librosa 仅作算法验证，工作站功能已完全覆盖）；仓库结构扁平化（remix/ 上移仓库根，两个 README 合并为单一文档）；版本号单源迁移至根级 VERSION 文件
- **1.1.1**：拼接操作性能优化——seekMix 缓存拼接 AudioBuffer（`getMixBuffer`，key 指纹自动失效，seek 全路径 240ms→0.3ms）；播放段切换只切卡片高亮（`ui.setPlayingCard` 替代整列表重建，35.8ms→0.1ms）
- **1.1.0**：波形/视频性能优化（去光晕 shadowBlur、网格二分裁剪、逐像素步长、播放线亚像素阈值）；修复视频暂停/停止不生效（pausePlay 补 videoEl.pause、移除原生 controls）
- **1.0.0**：页脚签名与工具（渐变霓虹签名、Bilibili/GitHub 链接、README 内嵌弹窗、检查更新）；拼接序列进度条（seam 标记/拖动 seek）；视频导出修复（关键帧边界 flush、mux decoderConfig、零丢帧）
- **0.2.0**：性能（帧合并/批量 path/seek 节流）、设计（渐变波形/播放态卡片）、高级设置（交叉淡化/快捷键/视图持久化）
- **0.1.0**：初始版本

## 深入文档

- 设计文档：`docs/superpowers/specs/`（工作站设计 + 优化计划，含 CLI→工作站的升级背景）
- 产品文档（内嵌页脚弹窗）：`README.md`
