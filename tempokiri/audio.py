"""音频加载、保存和信息查询模块。"""

from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import soundfile as sf
import librosa


def load_audio(
    path: str | Path,
    sr: Optional[int] = None,
    mono: bool = True,
) -> Tuple[np.ndarray, int]:
    """加载音频文件。

    Args:
        path: 音频文件路径。
        sr: 目标采样率。None 表示使用文件原始采样率。
        mono: 是否转换为单声道。

    Returns:
        (音频数组 y, 采样率 sr)
        y 形状为 (n_samples,) 或 (n_channels, n_samples)。
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"音频文件不存在: {path}")

    y, sr = librosa.load(str(path), sr=sr, mono=mono)
    return y, sr


def save_audio(
    path: str | Path,
    y: np.ndarray,
    sr: int,
    subtype: str = "PCM_16",
) -> None:
    """保存音频文件到磁盘。

    Args:
        path: 输出文件路径。
        y: 音频数据数组。
        sr: 采样率。
        subtype: 音频编码子类型（默认 PCM_16）。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), y, sr, subtype=subtype)


def get_audio_info(path: str | Path) -> dict:
    """获取音频文件的基础信息。

    Returns:
        包含 duration(秒), sr, channels, format 等信息的字典。
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"音频文件不存在: {path}")

    info = sf.info(str(path))
    return {
        "path": str(path.absolute()),
        "format": info.format,
        "subtype": info.subtype,
        "sr": info.samplerate,
        "channels": info.channels,
        "duration": float(info.duration),
        "frames": info.frames,
    }


def resample(y: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """重采样音频到目标采样率。

    Args:
        y: 输入音频数组。
        orig_sr: 原始采样率。
        target_sr: 目标采样率。

    Returns:
        重采样后的音频数组。
    """
    if orig_sr == target_sr:
        return y
    return librosa.resample(y, orig_sr=orig_sr, target_sr=target_sr)
