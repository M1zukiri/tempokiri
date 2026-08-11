# Tempokiri 工作站

**节奏感知的浏览器端音频/视频剪辑工具**——基于 BPM 的小节级选段、试听、拼接、导出。
单 HTML 交付，双击即用，适合小圈子分享。

## 功能

- 拖入音频（mp3/wav/ogg/m4a/flac）或视频（mp4/webm），视频带预览窗
- 波形 + 节拍网格可视化（滚轮缩放、Shift+拖拽平移）
- **确认制节拍设置**：BPM / 拍号 / 偏移在小窗口中输入，自动识别只填充、确认才应用
- 节拍设置持久化：同一文件再次拖入自动应用
- 按小节点击 / 拖拽选段，多段拼接排序、每段独立淡入淡出
- 试听序列（音频/视频）
- 导出 WAV / MP3（内嵌 lamejs，零外部依赖）

## 快速开始

```bash
# 开发模式：打开 index.html 或起本地服务器
python -m http.server 8000 --directory .
# 浏览器打开 http://localhost:8000

# 打包为单 HTML（发布物）
python build.py   # → dist/remix-workstation.html

# 运行单元测试（Node 18+）
node --test tests/test_analysis.js tests/test_export.js tests/test_sequence.js
```

## 目录结构

```
src/          开发期 JS 模块（分析/渲染/交互/导出等，可 Node 测试）
lib/lamejs    MP3 编码（唯一第三方依赖，UMD 包装）
index.html    开发入口（深色 DJ 风格 UI）
build.py      打包脚本 → dist/remix-workstation.html 单文件
tests/        Node 单元测试（算法、编码、序列逻辑）
examples/     测试音频生成脚本
docs/         设计文档
```

## 核心算法

`src/analysis.js` 纯函数实现：FFT → 频谱通量 → librosa 风格 onset 检测（归一化 + peak-pick）→
网格对齐评分的 BPM 估计（半速/倍速可区分）→ 相位（偏移）估计。检测不准时可手动输入 BPM/偏移微调。

## 视频说明

视频文件的波形分析需先提取音轨：打开「设置节拍」→「自动识别」时，视频会静音 4 倍速快速播放
一遍采集音频数据（界面显示进度条）。依赖浏览器 `video.captureStream()`。

## License

MIT（lamejs 为 LGPL，见 lib/lamejs 包内 LICENSE）
