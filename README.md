# Tempokiri 🎵

**节奏感知的音频/视频剪辑工作站** —— 单 HTML 文件交付的浏览器端剪辑工具。

以**拍数/小节**为剪辑单位——自动检测曲目 BPM 并计算每拍、每小节的精确时间边界，
在节拍层面精确选择要保留的段落。裁剪、拼接后的音乐节奏始终连贯如初，彻底告别传统时间轴剪辑导致的节奏断裂。
不同于普通剪辑软件，tempokiri **懂节奏**。

```
BPM = 120 → 每拍 = 60/120 = 0.5 秒 → 每小节（4拍）= 2 秒
```

## 功能特性

- **音频/视频拖入**：WAV/MP3 等音频与 MP4/MOV 视频（视频自动提取音轨，支持音画同步试听与视频导出）
- **波形可视化**：渐变波形、节拍网格叠加、选区拖拽、滚轮平移缩放
- **自动节拍识别**：自研频谱分析（FFT + 频谱通量 + onset 自相关），一键识别 BPM 与相位偏移，可手动微调
- **按小节选段**：双击选中整小节，支持多段非连续选择与排序
- **多段拼接**：等功率余弦交叉淡化（默认 30ms，可调），带拼接进度条（seam 标记 + 拖动 seek），逐段淡入/淡出
- **导出**：WAV / MP3 / MP4（WebCodecs 视频合成）

## 快速开始

打包产物为单个 HTML 文件，双击即可离线使用，零外部请求：

```bash
# 直接使用
双击 remix/dist/tempokiri-workstation.html

# 开发模式（源模块 + 本地伺服）
cd remix
python -m http.server 8734 --directory .
# 浏览器打开 http://localhost:8734
```

## 使用流程

1. **拖入音频或视频文件** → 波形渲染、自动分析就绪
2. **设置节拍**：打开设置窗口，点「识别」自动检测 BPM 与偏移（可手动指定 BPM/拍号），「确认」应用网格
3. **选段**：在波形上**双击**选中一小节，点「＋ 添加选中区间」加入序列；重复可添加多段
4. **拼接试听**：「▶ 播放拼接序列」—— 各段按序拼成连续音频播放，进度条可点击/拖动 seek
5. **导出**：「导出」选择 WAV/MP3/MP4 与交叉淡化参数

## 开发

```bash
node --test tests/test_*.js   # 单元测试（analysis/export/sequence/audio/render/ui/store/footer）
python build.py               # 打包 → dist/tempokiri-workstation.html（注入 README 与版本号）
```

版本号**单源**于仓库根 `VERSION` 文件，由 build.py 注入页脚。

## 目录结构

```
remix/
├── index.html          主页面（开发期引用 src/*.js）
├── src/                浏览器模块（UMD 挂到 window.MC）
│   ├── main.js         装配层：状态、文件处理、播放、导出流程
│   ├── analysis.js     核心算法：FFT / 频谱通量 / BPM / 偏移 / 网格
│   ├── render.js       波形与网格渲染
│   ├── sequence.js     序列项、小节换算、拼接元数据
│   ├── export.js       拼接渲染 + WAV/MP3 编码
│   ├── audio.js        音频解码/视频音轨提取
│   ├── ui.js           序列列表渲染、播放态高亮
│   ├── modal.js / exportModal.js / videoExport.js / store.js / footer.js / interact.js / log.js
├── tests/              Node 单元测试（node --test）
├── examples/           测试音频/视频样本
├── lib/                第三方库（mp4box、lame.js、mp4-muxer）
├── build.py            单 HTML 打包脚本
└── dist/               打包产物（gitignore）
```

## 算法原理

1. **BPM 检测**：resample 到 22050Hz → STFT（radix-2 FFT + Hann 窗）→ 频谱通量 → onset 峰值检测 → onset 自相关估计 BPM
2. **相位估计**：候选偏移吻合度投票，选出与 onset 序列最吻合的网格偏移（首线 = 首个 onset）
3. **网格生成**：BPM 网格按段落（BPM/拍号可分段不同）连续编号小节，支持每小节网格分辨率
4. **精确裁剪**：在采样点级别按小节边界切割（双击选段即网格边界吸附）
5. **交叉淡化**：拼接处应用等功率余弦曲线交叉淡化（消除线性交叉在段边界的相位跳变爆音），另支持逐段淡入/淡出

## License

MIT
