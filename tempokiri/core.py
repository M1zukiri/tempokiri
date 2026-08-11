"""核心协调逻辑 —— 编排完整的分析-裁剪工作流。"""

from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from .audio import load_audio, get_audio_info, save_audio
from .beat import (
    Bar,
    detect_bpm,
    compute_bar_grid,
    bpm_to_string,
    bar_time_to_string,
)
from .cutter import (
    Selection,
    parse_selections,
    cut_bars,
    get_selection_duration,
)


class MusicCutter:
    """tempokiri 主控制器 —— 管理音频分析和裁剪的生命周期。"""

    def __init__(self, path: str | Path, sr: Optional[int] = None):
        """加载音频并准备处理。

        Args:
            path: 音频文件路径。
            sr: 目标采样率（None 使用原始采样率）。
        """
        self.path = Path(path)
        self.info = get_audio_info(self.path)
        self.y, self.sr = load_audio(self.path, sr=sr, mono=True)
        self.duration = len(self.y) / self.sr

        # 以下在 analyze 时填充
        self.bpm: Optional[float] = None
        self.bars: List[Bar] = []
        self.aligned_beats: np.ndarray = np.array([])

    def analyze(
        self,
        bpm: Optional[float] = None,
        beats_per_bar: int = 4,
        align: bool = True,
    ) -> Tuple[float, List[Bar]]:
        """分析音频，检测/计算 BPM 和小节网格。

        Args:
            bpm: 用户指定的 BPM。None 表示自动检测。
            beats_per_bar: 每小节拍数（默认 4）。
            align: 是否对齐到实际节拍。

        Returns:
            (bpm, bars) 检测/使用的 BPM 和小节列表。
        """
        if bpm is not None:
            self.bpm = float(bpm)
        else:
            print("正在自动检测 BPM...")
            detected = detect_bpm(self.y, self.sr)
            self.bpm = detected
            print(f"  检测结果: {bpm_to_string(self.bpm)}")

        self.bars, self.aligned_beats = compute_bar_grid(
            self.y, self.sr, self.bpm, beats_per_bar, align=align
        )

        return self.bpm, self.bars

    def cut(
        self,
        selections: List[Selection] | str,
        output: str | Path,
        crossfade_ms: float = 10.0,
    ) -> Path:
        """执行裁剪并保存结果。

        Args:
            selections: Selection 列表或选择描述字符串。
            output: 输出文件路径。
            crossfade_ms: 交叉淡化时长（毫秒）。

        Returns:
            输出文件的 Path。
        """
        if isinstance(selections, str):
            selections = parse_selections(selections)

        if not self.bars:
            raise RuntimeError(
                "请先调用 analyze() 分析音频，再执行裁剪。"
            )

        result = cut_bars(self.y, self.sr, self.bars, selections, crossfade_ms)
        output_path = Path(output)
        save_audio(output_path, result, self.sr)

        # 打印摘要
        in_dur = get_selection_duration(self.bars, selections)
        out_dur = len(result) / self.sr
        print(f"\n== 裁剪完成! ==")
        print(f"  输入 | {self.duration:.1f}s ({len(self.bars)} 小节)")
        print(f"  选择 | {in_dur:.1f}s")
        print(f"  输出 | {out_dur:.1f}s")
        print(f"  保存 | {output_path.absolute()}")

        return output_path

    def print_info(self) -> None:
        """打印音频和小节网格的详细信息。"""
        if not self.bars:
            raise RuntimeError("请先调用 analyze()。")

        print(f"\n{'='*50}")
        print(f"  文件: {self.path.name}")
        print(f"  采样率: {self.sr} Hz")
        print(f"  时长: {self.duration:.2f}s")
        print(f"  BPM: {bpm_to_string(self.bpm)}")
        print(f"  小节数: {len(self.bars)}")
        print(f"  每小节拍数: 4")
        print(f"{'='*50}")

        # 打印前 20 个小节信息
        print(f"\n{'小节':>5} {'起始时间':>10} {'结束时间':>10} {'时长':>8}")
        print("-" * 40)
        for i, bar in enumerate(self.bars[:30]):
            print(
                f"{bar.bar_number:>5} "
                f"{bar_time_to_string(bar.start_time):>10} "
                f"{bar_time_to_string(bar.end_time):>10} "
                f"{bar.duration:>7.2f}s"
            )
        if len(self.bars) > 30:
            print(f"  ... (还有 {len(self.bars) - 30} 个小节)")
        print()
