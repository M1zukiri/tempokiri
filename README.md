# Tempokiri 🎵

**节奏感知的音频/视频剪辑工作站** —— 单 HTML 文件交付的浏览器端剪辑工具。

以**拍数/小节**为剪辑单位——自动检测曲目 BPM 并计算每拍、每小节的精确时间边界，
在节拍层面精确选择要保留的段落。裁剪、拼接后的音乐节奏始终连贯如初，彻底告别传统时间轴剪辑导致的节奏断裂。
不同于普通剪辑软件，tempokiri **懂节奏**。

```
BPM = 120 → 每拍 = 60/120 = 0.5 秒 → 每小节（4拍）= 2 秒
```

## 功能特性

- **音频/视频拖入**：mp3/wav/ogg/m4a/flac 音频与 mp4/mov 视频（视频带预览窗、自动提取音轨，音画同步试听）；「打开文件」随时切换，可保留并恢复工作区（节拍设置 + 序列/淡化）
- **波形可视化**：渐变波形 + 节拍网格；纯滚轮平移、Ctrl+滚轮缩放（指针为中心）、Shift+拖拽平移
- **自动节拍识别**：自研频谱分析（FFT + 频谱通量 + onset 自相关），一键识别 BPM 与偏移；**确认制**——识别只填充输入框，确认才应用；顶部快捷栏 BPM/偏移 ± 微调即时生效
- **按小节选段**：双击/拖拽选中小节（部分覆盖即选中），多段非连续选择、卡片拖动排序或 ↑↓ 调整、每段独立淡入/淡出
- **坐标输入**：卡片起终点与手动添加用统一切换组件（小节/格 ↔ 时间），非法输入标红禁播
- **多段拼接**：等功率余弦交叉淡化（默认 30ms，可调）；**拼接进度条**——总时长、seam 金黄竖线标记、点击/拖动即定位试听、已播放青色渐变；播放线按段映射回原曲位置
- **试听**：播放/暂停/停止（断点保留）、拼接序列先拼成连续音频再一次性播放（消除段间间隔）
- **导出**：WAV / MP3 / MP4/MOV 视频（WebCodecs 合成，关键帧边界 flush 零丢帧，可关闭音轨导出纯视频）/ Majdata（bg.mp4 + track.mp3）三 Tab 导出
- **三套配色主题**：Aoi Aurora（默认）/ Meltyland's Nightmare / Kamikiri，高级设置即时切换并持久化；顶部品牌标随播放律动
- **界面文案可定制**：全部按钮/提示/状态/弹窗文字集中在 `strings.json`，修改后 `python build.py` 即生效，无需改代码
- **页脚**：渐变霓虹签名、Bilibili/GitHub 链接、README 内嵌弹窗（离线可读）、检查更新（本地版本领先时彩蛋提示）；高级设置 9 项参数（主题/检测精度/灵敏度/BPM 范围/音轨提取/采集倍速/视频跟随/渲染质量/交叉淡化）持久化 localStorage
- **性能**：波形帧合并、批量 path 单次 stroke、拼接 seek 缓存（`getMixBuffer`）与播放段切换只切高亮——长音频拖拽/缩放/seek 流畅

## 快速开始

打包产物为单个 HTML 文件，双击即可离线使用，零外部请求：

```bash
# 直接使用
双击 dist/tempokiri-workstation.html

# 开发模式（源模块 + 本地伺服）
python -m http.server 8734 --directory .
# 浏览器打开 http://localhost:8734

# 单元测试（Node 18+）
node --test tests/test_*.js

# 打包 → dist/tempokiri-workstation.html
python build.py
```

## 使用流程

1. **拖入音频或视频文件** → 波形渲染、自动分析就绪
2. **设置节拍**：打开设置窗口，点「识别」自动检测 BPM 与偏移（可手动指定 BPM/拍号），「确认」应用网格；同一文件再次拖入自动恢复节拍设置
3. **选段**：在波形上**双击**选中一小节，点「＋ 添加选中区间」加入序列；重复可添加多段
4. **拼接试听**：「▶ 播放拼接序列」—— 各段按序拼成连续音频播放，进度条可点击/拖动 seek
5. **导出**：「导出」选择 WAV/MP3/MP4 与交叉淡化参数

## 目录结构

```
├── index.html          开发入口（深色 DJ 风格 UI，引用 src/*.js）
├── strings.json        界面文案唯一编辑源（约 200 条，改文案只改此文件）
├── build.py            打包脚本 → dist/tempokiri-workstation.html 单文件
│   ├── i18n.js         文案系统：T(key, params) 插值、data-i18n 静态填充
│   ├── main.js         装配层：状态、文件处理、播放、导出流程
│   ├── analysis.js     核心算法：FFT / 频谱通量 / BPM / 偏移 / 网格
│   ├── render.js       波形与网格渲染
│   ├── sequence.js     序列项、小节换算、拼接元数据
│   ├── export.js       拼接渲染 + WAV/MP3 编码
│   ├── audio.js        音频解码/视频音轨提取
│   ├── ui.js           序列列表渲染、播放态高亮
│   └── modal.js / exportModal.js / videoExport.js / store.js / footer.js / interact.js / unitInput.js / log.js
├── tests/              Node 单元测试（analysis/export/sequence/audio/render/ui/store/footer/i18n/settings）
├── lib/                lame.min.js（MP3）、mp4box.global.js（demux）、mp4-muxer.js（合成）
├── examples/           测试素材（合成音频/视频）与生成脚本
├── docs/               设计文档
├── CLAUDE.md           项目约定与版本历史
├── VERSION             版本号单源（build.py 注入页脚）
└── dist/               打包产物（gitignore）
```

## 核心算法

`src/analysis.js` 纯函数实现：resample 到 22050Hz → STFT（radix-2 FFT + Hann 窗）→
频谱通量 → onset 峰值检测 → **自相关主导周期 + 局部细化的 BPM 估计**（半速/倍速可区分，输出 0.1 精度）→
候选偏移吻合度投票（offset = 首个 onset，首条网格线对齐音乐实际开始处）。检测不准时可手动微调 BPM/偏移。

拼接交叉淡化用**等功率余弦曲线**（消除线性交叉在段边界的相位跳变爆音）。

## 视频说明

视频文件的波形分析需先提取音轨：优先 **WebCodecs 直接解码**（mp4box demux → AudioDecoder，快且准），
失败时降级为静音 4 倍速 `video.captureStream()` 采集（界面显示进度条）。
视频导出依赖 WebCodecs（Chrome/Edge 完整支持；Safari 部分；Firefox 不支持时导出面板灰掉视频选项）。

## License

MIT（lamejs 为 LGPL，见 lib 包内 LICENSE）
