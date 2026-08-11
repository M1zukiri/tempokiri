"""tempokiri 基础功能测试。"""

import sys
import os
from pathlib import Path

# 确保可以导入项目
sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
from tempokiri.beat import (
    Bar,
    compute_bar_grid,
    bpm_to_string,
    bar_time_to_string,
)
from tempokiri.cutter import (
    Selection,
    parse_selections,
    cut_bars,
    concatenate_segments,
    get_selection_duration,
)
from tempokiri.audio import get_audio_info, save_audio, load_audio


def test_parse_selections_simple():
    """测试小节选择解析：简单区间。"""
    result = parse_selections("1-4")
    assert len(result) == 1
    assert result[0] == Selection(1, 4)


def test_parse_selections_multiple():
    """测试小节选择解析：多个区间。"""
    result = parse_selections("1-4, 8-12, 16")
    assert len(result) == 3
    assert result[0] == Selection(1, 4)
    assert result[1] == Selection(8, 12)
    assert result[2] == Selection(16, 16)


def test_parse_selections_merge_adjacent():
    """测试相邻区间合并。"""
    result = parse_selections("1-4, 5-8")
    assert len(result) == 1
    assert result[0] == Selection(1, 8)


def test_parse_selections_single():
    """测试单个小节。"""
    result = parse_selections("5")
    assert len(result) == 1
    assert result[0] == Selection(5, 5)


def test_selection_validation():
    """测试 Selection 的验证逻辑。"""
    try:
        Selection(0, 2)
        assert False, "应该抛出异常"
    except ValueError:
        pass

    try:
        Selection(5, 3)
        assert False, "应该抛出异常"
    except ValueError:
        pass


def test_bpm_to_string():
    """测试 BPM 转字符串。"""
    assert bpm_to_string(120.0) == "120.0 BPM"
    assert bpm_to_string(128.5) == "128.5 BPM"


def test_bar_time_to_string():
    """测试时间转字符串。"""
    assert bar_time_to_string(0) == "00:00.000"
    assert bar_time_to_string(65.5) == "01:05.500"
    assert bar_time_to_string(3661.25) == "61:01.250"


def test_compute_bar_grid_strict():
    """测试严格数学模式的小节网格计算。"""
    sr = 22050
    duration = 4.0  # 4 秒音频
    y = np.zeros(int(duration * sr))
    bpm = 120.0  # 每拍 0.5s, 每小节 2s

    bars, beats = compute_bar_grid(y, sr, bpm, align=False)

    assert len(bars) == 2  # 4秒 / 2秒每小节 = 2 小节
    assert bars[0].bar_number == 1
    assert abs(bars[0].start_time - 0.0) < 0.001
    assert abs(bars[0].end_time - 2.0) < 0.001
    assert bars[1].bar_number == 2
    assert abs(bars[1].start_time - 2.0) < 0.001
    assert abs(bars[1].end_time - 4.0) < 0.001


def test_cut_bars_single_selection():
    """测试单个区间裁剪。"""
    sr = 1000
    duration = 4.0
    y = np.ones(int(duration * sr)) * 0.5
    bpm = 120.0

    bars, beats = compute_bar_grid(y, sr, bpm, align=False)
    selections = [Selection(1, 1)]  # 只保留第一小节（~2秒）

    result = cut_bars(y, sr, bars, selections, crossfade_ms=0)
    expected_len = int(bars[0].duration * sr)
    # 允许少量误差
    assert abs(len(result) - expected_len) < sr * 0.01


def test_cut_bars_two_selections():
    """测试两个区间裁剪拼接。"""
    sr = 1000
    duration = 6.0  # 3 个小节（BPM 120）
    y = np.arange(int(duration * sr), dtype=np.float64) / sr
    bpm = 120.0

    bars, beats = compute_bar_grid(y, sr, bpm, align=False)
    selections = [Selection(1, 1), Selection(3, 3)]  # 小节 1 + 小节 3

    result = cut_bars(y, sr, bars, selections, crossfade_ms=0)
    dur1 = bars[0].duration
    dur3 = bars[2].duration
    expected_len = int((dur1 + dur3) * sr)
    assert abs(len(result) - expected_len) < sr * 0.02


def test_concatenate_segments():
    """测试片段拼接。"""
    sr = 1000
    a = np.ones(sr) * 0.3  # 1 秒
    b = np.ones(sr) * 0.7  # 1 秒

    result = concatenate_segments([a, b], sr, crossfade_ms=0)
    assert len(result) == 2 * sr

    result_cf = concatenate_segments([a, b], sr, crossfade_ms=10)
    # 交叉淡化会缩短一点总长度
    assert len(result_cf) == 2 * sr - int(sr * 0.01) * 2 + int(sr * 0.01)


def test_get_selection_duration():
    """测试选择片区总时长计算。"""
    sr = 22050
    duration = 8.0
    y = np.zeros(int(duration * sr))
    bpm = 120.0

    bars, beats = compute_bar_grid(y, sr, bpm, align=False)
    selections = [Selection(1, 1)]

    dur = get_selection_duration(bars, selections)
    # 第一小节大约 2 秒
    assert abs(dur - 2.0) < 0.05


def test_save_and_load_audio(tmp_path):
    """测试音频保存和加载。"""
    sr = 44100
    duration = 1.0
    y = np.sin(2 * np.pi * 440 * np.arange(int(sr * duration)) / sr)

    path = tmp_path / "test_sine.wav"
    save_audio(str(path), y, sr)

    assert path.exists()
    info = get_audio_info(str(path))
    assert info["sr"] == sr
    assert abs(info["duration"] - duration) < 0.01

    y_loaded, sr_loaded = load_audio(str(path), sr=None)
    assert sr_loaded == sr
    assert len(y_loaded) == len(y)
