"""小节级精确裁剪引擎。

负责：
    1. 根据小节网格和用户选择，提取对应音频段。
    2. 在节拍边界处执行精确采样点裁剪。
    3. 使用交叉淡化（crossfade）拼接多个片段，保证节奏连贯。
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

from .beat import Bar


@dataclass
class Selection:
    """用户要保留的一个小节范围。"""

    start_bar: int  # 起始小节号（从 1 开始）
    end_bar: int  # 结束小节号（包含）

    def __post_init__(self):
        if self.start_bar < 1:
            raise ValueError(f"小节号从 1 开始，不支持 {self.start_bar}")
        if self.end_bar < self.start_bar:
            raise ValueError(
                f"结束小节 {self.end_bar} 不能小于起始小节 {self.start_bar}"
            )

    def __repr__(self) -> str:
        if self.start_bar == self.end_bar:
            return f"Bar {self.start_bar}"
        return f"Bars {self.start_bar}–{self.end_bar}"


def parse_selections(desc: str) -> List[Selection]:
    """解析用户输入的小节选择描述。

    格式示例：
        "1-4, 8-12, 16" → [Selection(1,4), Selection(8,12), Selection(16,16)]
        "1,3,5-8"       → [Selection(1,1), Selection(3,3), Selection(5,8)]

    Args:
        desc: 小节选择字符串。

    Returns:
        小节的 Selection 列表。
    """
    selections: List[Selection] = []
    parts = [p.strip() for p in desc.split(",")]

    for part in parts:
        if not part:
            continue
        if "-" in part:
            start_str, end_str = part.split("-", 1)
            start = int(start_str.strip())
            end = int(end_str.strip())
            selections.append(Selection(start, end))
        else:
            num = int(part)
            selections.append(Selection(num, num))

    # 合并相邻或重叠的选择区间
    selections.sort(key=lambda s: s.start_bar)
    merged: List[Selection] = []
    for sel in selections:
        if (
            merged
            and sel.start_bar <= merged[-1].end_bar + 1
        ):
            merged[-1] = Selection(
                merged[-1].start_bar,
                max(merged[-1].end_bar, sel.end_bar),
            )
        else:
            merged.append(sel)

    return merged


def extract_bar_segments(
    y: np.ndarray,
    sr: int,
    bars: List[Bar],
    selections: List[Selection],
    fade_samples: int = 0,
) -> List[np.ndarray]:
    """根据选择的小节范围，从音频中提取对应片段。

    Args:
        y: 完整音频数组。
        sr: 采样率。
        bars: 小节网格列表。
        selections: 用户选择的小节范围列表。
        fade_samples: 每个片段进入/退出时的淡化采样点数（0 表示不淡化）。

    Returns:
        音频片段数组列表。
    """
    segments: List[np.ndarray] = []

    for sel in selections:
        start_bar = sel.start_bar
        end_bar = min(sel.end_bar, len(bars))

        if start_bar > len(bars):
            break

        bar_start = bars[start_bar - 1].start_time
        bar_end = bars[end_bar - 1].end_time

        start_sample = int(bar_start * sr)
        end_sample = int(bar_end * sr)

        # 边界检查
        start_sample = max(0, min(start_sample, len(y)))
        end_sample = max(start_sample + 1, min(end_sample, len(y)))

        segment = y[start_sample:end_sample].copy()

        # 应用淡化（用于独立导出，不自带 crossfade）
        if fade_samples > 0 and len(segment) > fade_samples * 2:
            fade_in = np.linspace(0, 1, fade_samples)
            segment[:fade_samples] *= fade_in
            segment[-fade_samples:] *= fade_in[::-1]

        segments.append(segment)

    return segments


def _crossfade(
    a: np.ndarray,
    b: np.ndarray,
    fade_len: int,
) -> np.ndarray:
    """将两段音频以交叉淡化方式拼接。

    Args:
        a: 前段音频。
        b: 后段音频。
        fade_len: 交叉淡化长度（采样点）。

    Returns:
        拼接后的音频数组。
    """
    # 如果任一段太短，直接拼接
    if len(a) < fade_len or len(b) < fade_len:
        return np.concatenate([a, b])

    # 前段的渐出部分
    fade_out = np.linspace(1, 0, fade_len)
    # 后段的渐入部分
    fade_in = np.linspace(0, 1, fade_len)

    a_tail = a[-fade_len:] * fade_out
    b_head = b[:fade_len] * fade_in
    # 交叉区域叠加
    cross = a_tail + b_head

    return np.concatenate([a[:-fade_len], cross, b[fade_len:]])


def concatenate_segments(
    segments: List[np.ndarray],
    sr: int,
    crossfade_ms: float = 10.0,
) -> np.ndarray:
    """将多个音频片段拼接（带交叉淡化）。

    Args:
        segments: 音频片段列表。
        sr: 采样率。
        crossfade_ms: 交叉淡化时长（毫秒）。

    Returns:
        拼接后的完整音频数组。
    """
    if not segments:
        return np.array([], dtype=np.float64)
    if len(segments) == 1:
        return segments[0]

    fade_len = int(sr * crossfade_ms / 1000)
    if fade_len < 1:
        return np.concatenate(segments)

    result = segments[0]
    for seg in segments[1:]:
        result = _crossfade(result, seg, fade_len)

    return result


def cut_bars(
    y: np.ndarray,
    sr: int,
    bars: List[Bar],
    selections: List[Selection],
    crossfade_ms: float = 10.0,
) -> np.ndarray:
    """核心裁剪函数：按小节选择精确裁剪并拼接。

    这是 CLI 和 API 使用的主入口。

    Args:
        y: 完整音频数据。
        sr: 采样率。
        bars: 小节网格。
        selections: 要保留的小节选择。
        crossfade_ms: 拼接处的交叉淡化时长（毫秒）。

    Returns:
        裁剪并拼接后的音频数组。
    """
    # 验证选择
    for sel in selections:
        if sel.start_bar < 1:
            raise ValueError(f"小节号从 1 开始，不支持 {sel.start_bar}")
        if sel.end_bar > len(bars):
            # 静默截断到最后一个有效小节
            sel.end_bar = len(bars)

    segments = extract_bar_segments(y, sr, bars, selections)
    return concatenate_segments(segments, sr, crossfade_ms)


def get_selection_duration(
    bars: List[Bar],
    selections: List[Selection],
) -> float:
    """计算选择的音频片段总时长（交叉淡化前的原始时长）。

    Args:
        bars: 小节网格。
        selections: 用户选择。

    Returns:
        总时长（秒）。
    """
    total = 0.0
    for sel in selections:
        end_bar = min(sel.end_bar, len(bars))
        if sel.start_bar <= len(bars):
            total += bars[end_bar - 1].end_time - bars[sel.start_bar - 1].start_time
    return total
