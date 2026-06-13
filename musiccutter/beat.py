"""BPM检测、节拍追踪和小节网格计算模块。

核心算法：
    1. 使用 librosa 的 onset/beat tracking 检测实际节拍位置。
    2. 以用户指定的 BPM 为基准，生成理论节拍网格。
    3. 将理论节拍对齐到最近的检测节拍（容差范围内），
       使得裁剪边界既符合指定节奏，又贴合实际音频。
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np
import librosa


@dataclass
class Bar:
    """代表一个小节的起止信息和其包含的节拍。"""

    bar_number: int  # 小节编号（从 1 开始）
    start_time: float  # 开始时间（秒）
    end_time: float  # 结束时间（秒）
    duration: float  # 时长（秒）
    beats: List[float] = field(default_factory=list)  # 该小节内各拍的精确时间（秒）

    def __repr__(self) -> str:
        return (
            f"Bar({self.bar_number}: "
            f"{self.start_time:.3f}s → {self.end_time:.3f}s, "
            f"{self.duration:.3f}s)"
        )


def detect_bpm(
    y: np.ndarray,
    sr: int,
    min_bpm: float = 60.0,
    max_bpm: float = 200.0,
) -> float:
    """自动检测音频的 BPM。

    Args:
        y: 音频数据数组。
        sr: 采样率。
        min_bpm: 允许的最小 BPM。
        max_bpm: 允许的最大 BPM。

    Returns:
        检测到的 BPM 值（浮点数）。
    """
    tempo, _ = librosa.beat.beat_track(
        y=y,
        sr=sr,
        units="time",
        start_bpm=120.0,
        tightness=100,
    )
    # librosa 0.10+ 返回标量 tempo
    if isinstance(tempo, np.ndarray):
        tempo = float(tempo[0])
    else:
        tempo = float(tempo)

    # 如果检测结果异常，回退到中速默认值
    if tempo < min_bpm or tempo > max_bpm:
        tempo = 120.0

    return tempo


def detect_beats(
    y: np.ndarray,
    sr: int,
    bpm: Optional[float] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """检测音频中的节拍位置。

    Args:
        y: 音频数据数组。
        sr: 采样率。
        bpm: 可选的先验 BPM 值，用于引导节拍追踪。

    Returns:
        (bpm, beat_times) —— 检测到的 BPM 和各节拍的时间点（秒）。
    """
    start_bpm = bpm if bpm is not None and 60 <= bpm <= 200 else 120.0
    tempo, beat_frames = librosa.beat.beat_track(
        y=y,
        sr=sr,
        start_bpm=start_bpm,
        tightness=100,
        units="frames",
    )
    if isinstance(tempo, np.ndarray):
        tempo = float(tempo[0])
    else:
        tempo = float(tempo)

    beat_times = librosa.frames_to_time(beat_frames, sr=sr, n_fft=2048, hop_length=512)
    return tempo, beat_times


def _align_to_grid(
    beat_times: np.ndarray,
    target_bpm: float,
    total_duration: float,
    tolerance_beats: float = 0.3,
) -> np.ndarray:
    """将理论节拍网格（由 target_bpm 确定）对齐到检测到的节拍位置。

    策略：
        - 根据 target_bpm 生成均匀的理论节拍时间序列。
        - 对每个理论节拍，在检测到的节拍中寻找最近的匹配。
        - 若最近距离小于 tolerance_beats 拍，则对齐到检测节拍；
          否则保持理论时间（容错回退）。
        - 这样既尊重了用户指定的节奏，又让边界贴合实际音频。

    Args:
        beat_times: 检测到的实际节拍时间序列（秒）。
        target_bpm: 目标 BPM（由用户指定或检测得到）。
        total_duration: 音频总时长（秒）。
        tolerance_beats: 对齐容差（拍数），默认 0.3 拍。

    Returns:
        对齐后的节拍时间数组（秒）。
    """
    beat_interval = 60.0 / target_bpm
    num_theoretical = int(total_duration / beat_interval) + 2
    theoretical = np.arange(num_theoretical, dtype=np.float64) * beat_interval

    tolerance_sec = beat_interval * tolerance_beats

    aligned = theoretical.copy()

    # 将检测到的节拍时间转为排序数组用于快速查找
    beats_sorted = np.sort(beat_times)

    for i in range(len(theoretical)):
        t = theoretical[i]

        # 在检测节拍中二分查找最近值
        idx = np.searchsorted(beats_sorted, t)
        candidates = []

        if idx < len(beats_sorted):
            candidates.append(beats_sorted[idx])
        if idx > 0:
            candidates.append(beats_sorted[idx - 1])

        if candidates:
            nearest = min(candidates, key=lambda x: abs(x - t))
            distance = abs(nearest - t)

            if distance < tolerance_sec:
                aligned[i] = nearest

    # 确保序列严格递增（对齐后可能有相邻节拍被拉到同一点）
    for i in range(1, len(aligned)):
        if aligned[i] <= aligned[i - 1]:
            aligned[i] = aligned[i - 1] + beat_interval * 0.1

    return aligned


def compute_bar_grid(
    y: np.ndarray,
    sr: int,
    bpm: float,
    beats_per_bar: int = 4,
    align: bool = True,
    tolerance_beats: float = 0.3,
) -> Tuple[List[Bar], np.ndarray]:
    """计算基于 BPM 的小节网格。

    两种模式：
        1. align=True（默认）：检测实际节拍并对齐。边界既贴合 BPM 又贴合音频。
        2. align=False：严格数学计算，每个小节时长严格 = 60/BPM * beats_per_bar 秒。

    Args:
        y: 音频数据数组。
        sr: 采样率。
        bpm: 用户指定的 BPM 值。
        beats_per_bar: 每小节拍数，通常为 4。
        align: 是否对齐到实际检测节拍。
        tolerance_beats: 对齐容差（拍数）。

    Returns:
        (bars, aligned_beats)
        - bars: 小节列表（每个 Bar 包含起止时间和所含节拍）。
        - aligned_beats: 对齐后的节拍时间数组（秒）。
    """
    total_duration = len(y) / sr

    if align:
        # 检测实际节拍
        _, beat_times = detect_beats(y, sr, bpm=bpm)
        # 对齐理论网格到实际节拍
        aligned_beats = _align_to_grid(
            beat_times, bpm, total_duration, tolerance_beats
        )
    else:
        # 严格数学模式
        beat_interval = 60.0 / bpm
        num_beats = int(total_duration / beat_interval) + 1
        aligned_beats = np.arange(num_beats, dtype=np.float64) * beat_interval

    # 过滤超出音频时长的节拍
    aligned_beats = aligned_beats[aligned_beats <= total_duration]

    # 分组为小节
    bars: List[Bar] = []
    for i in range(0, len(aligned_beats) - 1, beats_per_bar):
        end_idx = min(i + beats_per_bar, len(aligned_beats) - 1)
        bar_beats = [float(aligned_beats[j]) for j in range(i, end_idx + 1)]
        bar = Bar(
            bar_number=i // beats_per_bar + 1,
            start_time=float(aligned_beats[i]),
            end_time=float(aligned_beats[end_idx]),
            duration=float(aligned_beats[end_idx] - aligned_beats[i]),
            beats=bar_beats,
        )
        bars.append(bar)

    return bars, aligned_beats


def bpm_to_string(bpm: float) -> str:
    """返回 BPM 的人类可读字符串。"""
    return f"{bpm:.1f} BPM"


def bar_time_to_string(time_sec: float) -> str:
    """将秒数转为 mm:ss.mmm 格式。"""
    minutes = int(time_sec // 60)
    seconds = time_sec % 60
    return f"{minutes:02d}:{seconds:06.3f}"
