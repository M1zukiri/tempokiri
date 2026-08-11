# Tempokiri 工作站

**节奏感知的浏览器端音频/视频剪辑工具**——基于 BPM 的小节级选段、试听、拼接、导出。
单 HTML 交付，双击即用，适合小圈子分享。

## 功能

- 拖入音频（mp3/wav/ogg/m4a/flac）或视频（mp4/mov，带预览窗），未导入时点击波形区也可打开文件；视频导入时波形区左侧分栏播放视频、右侧仍为波形
- **「打开文件」按钮**随时切换工作区文件：切换时询问是否保留当前工作区（节拍设置 + 拼接序列/淡化），选「保留」后重新打开该文件自动恢复工作状态
- 波形 + 节拍网格可视化；**纯滚轮平移、Ctrl+滚轮缩放（指针为中心）、Shift+拖拽平移**
- **确认制节拍设置**：BPM / 拍号 / 偏移在小窗口中输入，自动识别只填充、确认才应用；末段自动覆盖剩余时长
- **段级网格分辨率**：每段可独立设置每小节线数；顶部快捷栏 BPM/偏移 ±1/±0.1/±0.01 即时微调
- 节拍设置持久化：同一文件再次拖入自动应用
- 单击波形仅定位播放起点（不播放），双击/拖拽选段（**部分覆盖的小节即被选中**），多段拼接、卡片拖动排序或 ↑↓ 调整、每段独立淡入淡出
- **坐标输入**：序列卡片起终点与「手动添加」表单用统一切换组件（小节/格 ↔ 时间二选一，自动换算显示另一套）；起终点包含终点格（1.1–1.1 允许单格）；输入非法（超界/倒置）时保留输入、卡片标红并禁止播放，网格修改导致越界同样标红
- **换算语义**：小节/格为半开区间（起点含、终点不含）；起点格取区间起点、终点格取区间终点（含终点格）；显示时起点用通用归属、终点用含端点归属（避免边界时间被归到下一格）；相邻小节在网格构建时精确衔接，无浮点缝隙
- 试听：统一「播放」按钮（播放中点击=暂停，暂停后从断点继续；停止回到标记点，单击波形重新定位）、序列区「播放拼接序列」
- 导出 WAV / MP3 / 视频（MP4/MOV，WebCodecs 合成）

## 快速开始

```bash
# 开发模式：打开 index.html 或起本地服务器
python -m http.server 8734 --directory .
# 浏览器打开 http://localhost:8734

# 打包为单 HTML（发布物）
python build.py   # → dist/tempokiri-workstation.html

# 运行单元测试（Node 18+）
node --test tests/test_analysis.js tests/test_export.js tests/test_sequence.js
```

## 目录结构

```
src/          开发期 JS 模块（分析/渲染/交互/导出等，可 Node 测试）
lib/          lame.min.js（MP3 编码）、mp4box.global.js（demux）、mp4-muxer.js（合成）
index.html    开发入口（深色 DJ 风格 UI）
build.py      打包脚本 → dist/tempokiri-workstation.html 单文件
tests/        Node 单元测试（算法、编码、序列逻辑）
examples/     测试素材（合成音频/视频）与生成脚本
docs/         设计文档
```

## 核心算法

`src/analysis.js` 纯函数实现：FFT → 频谱通量 → onset 检测（归一化 + peak-pick）→
**自相关主导周期 + 局部细化的 BPM 估计**（半速/倍速可区分，输出 0.1 精度）→
offset 取首个 onset 位置（首条网格线对齐音乐实际开始处）。检测不准时可手动微调 BPM/偏移。

## 视频说明

视频文件的波形分析需先提取音轨：优先 **WebCodecs 直接解码**（mp4box demux → AudioDecoder，快且准），
失败时降级为静音 4 倍速 `video.captureStream()` 采集（界面显示进度条）。
视频导出依赖 WebCodecs（Chrome/Edge 完整支持；Safari 部分；Firefox 不支持时导出面板灰掉视频选项）。

## License

MIT（lamejs 为 LGPL，见 lib 包内 LICENSE）
