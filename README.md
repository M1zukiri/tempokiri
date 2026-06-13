# musiccutter 🎵

**节奏感知的音频剪辑利器**

musiccutter 以**拍数/小节**为裁剪单位——输入曲目 BPM，工具自动计算每拍、每小节的精确时间边界，
在节拍层面精确选择要保留的段落。裁剪、拼接后的音频节奏始终连贯如初，彻底告别传统时间轴剪辑导致的节奏断裂。
不同于普通剪辑软件，musiccutter **懂节奏**。

## 核心概念

```
BPM = 120 → 每拍 = 60/120 = 0.5 秒 → 每小节（4拍）= 2 秒
```

- 用户指定 BPM 或自动检测
- 程序计算每拍、每小节的精确时间边界
- 裁剪边界会自动对齐到检测到的实际节拍位置
- 多段裁剪结果用交叉淡化（crossfade）拼接，避免咔嗒声

## 安装

```bash
cd musiccutter
pip install -r requirements.txt

# 可选：安装为可执行包
pip install -e .
```

## 快速使用

### 1️⃣ 检测 BPM

```bash
musiccutter detect track.mp3
```

### 2️⃣ 查看小节网格

```bash
musiccutter info track.mp3
musiccutter info track.mp3 --bpm 128       # 手动指定 BPM
musiccutter info track.mp3 --strict         # 严格数学网格（不对齐实际节拍）
```

### 3️⃣ 裁剪音频

```bash
# 保留第 1-8 小节
musiccutter cut track.mp3 --bars 1-8

# 选择非连续段落：前奏 + 副歌
musiccutter cut track.mp3 --bars "1-8, 17-24, 33-40"

# 带 BPM 和输出路径
musiccutter cut track.mp3 --bpm 140 --bars "1-16" -o chorus.wav

# 自定义交叉淡化时长
musiccutter cut track.mp3 --bars "1-4, 9-12" --crossfade 5
```

## 命令行参考

| 命令 | 功能 |
|------|------|
| `detect <file>` | 检测音频 BPM |
| `info <file>` | 显示小节网格详情 |
| `cut <file> --bars <range>` | 按小节裁剪 |

**cut 选项：**

| 选项 | 说明 |
|------|------|
| `--bars, -b` | **必填**。小节选择，如 `1-8, 17-24, 33` |
| `--bpm` | 手动指定 BPM（默认自动检测） |
| `--output, -o` | 输出文件路径（默认 `{原文件名}_cut.wav`） |
| `--crossfade, -c` | 拼接淡化时长（毫秒，默认 10ms） |
| `--align` / `--strict` | 对齐到实际节拍 / 严格数学网格（默认对齐） |

## 算法原理

1. **节拍检测**：使用 librosa 的 onset detection + beat tracking 检测音频中的实际节拍位置。
2. **网格对齐**：以用户指定（或自动检测）的 BPM 为基准，生成理论节拍网格，然后将每个理论节拍对齐到最近的检测节拍（容差范围内）。
3. **精确裁剪**：在采样点级别按小节边界切割音频。
4. **交叉淡化**：在拼接处应用短时（默认 10ms）交叉淡化，消除咔嗒声。

## Python API 示例

```python
from musiccutter.core import MusicCutter

# 加载音频
cutter = MusicCutter("track.mp3")

# 分析（自动检测 BPM）
bpm, bars = cutter.analyze()
print(f"BPM: {bpm}")

# 查看小节信息
for bar in bars[:5]:
    print(f"Bar {bar.bar_number}: {bar.start_time:.3f}s → {bar.end_time:.3f}s")

# 裁剪：保留第 1-8 和第 17-24 小节
cutter.cut("1-8, 17-24", "remix.wav")
```

## 依赖

- Python 3.10+
- librosa — 音频分析、节拍检测
- soundfile — 音频读写
- numpy — 数组运算
- click — CLI 框架
- rich — 终端美化输出

## License

MIT
