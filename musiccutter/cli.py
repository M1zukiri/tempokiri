"""命令行接口 —— musiccutter 的 CLI 入口。"""

import sys
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from . import __version__
from .core import MusicCutter
from .beat import (
    detect_bpm,
    bpm_to_string,
    bar_time_to_string,
)
from .audio import get_audio_info
from .cutter import parse_selections

console = Console()


@click.group()
@click.version_option(version=__version__, prog_name="musiccutter")
def cli():
    """musiccutter — 基于 BPM 的小节级精确音频裁剪工具。

    输入音频文件，指定 BPM（或自动检测），按小节选择要保留的段落，
    工具在节拍边界精确裁剪并拼接，保证节奏连贯。
    """


@cli.command()
@click.argument("file", type=click.Path(exists=True), metavar="FILE")
@click.option(
    "--bpm", type=float, default=None,
    help="指定 BPM（不指定则自动检测）",
)
@click.option(
    "--align/--strict", default=True,
    help="对齐到实际节拍（默认对齐）",
)
def info(file: str, bpm: float | None, align: bool):
    """分析音频文件，显示 BPM 和小节网格信息。"""
    cutter = MusicCutter(file)
    bpm_val, bars = cutter.analyze(bpm=bpm, align=align)
    info = get_audio_info(file)

    # 基本信息
    console.print(f"\n[bold cyan]== {Path(file).name} ==[/bold cyan]")
    console.print(f"  采样率  {info['sr']} Hz")
    console.print(f"  声道数  {info['channels']}")
    console.print(f"  时长    {info['duration']:.2f}s")
    console.print(f"  格式    {info['format']} / {info['subtype']}")
    console.print(f"  BPM     [bold yellow]{bpm_to_string(bpm_val)}[/bold yellow]")
    console.print(f"  小节数  [bold]{len(bars)}[/bold]")
    console.print()

    # 小节表格
    table = Table(title="小节网格（前 40 个小节）")
    table.add_column("小节", justify="right", style="cyan")
    table.add_column("起始时间", justify="right")
    table.add_column("结束时间", justify="right")
    table.add_column("时长", justify="right")
    table.add_column("节拍数", justify="right")

    for bar in bars[:40]:
        table.add_row(
            str(bar.bar_number),
            bar_time_to_string(bar.start_time),
            bar_time_to_string(bar.end_time),
            f"{bar.duration:.3f}s",
            str(len(bar.beats)),
        )
    console.print(table)

    if len(bars) > 40:
        console.print(f"[dim]... 还有 {len(bars) - 40} 个小节未显示[/dim]")

    # 使用建议
    total = len(bars)
    console.print(f"\n[green]>> 使用示例：[/green]")
    console.print(f"  保留前 8 个小节：")
    console.print(f"    [bold]musiccutter cut \"{file}\" --bars 1-8[/bold]")
    console.print(f"  选择特定段落：")
    console.print(f"    [bold]musiccutter cut \"{file}\" --bars \"1-8, 17-24, 33\"[/bold]")
    console.print()


@cli.command()
@click.argument("file", type=click.Path(exists=True), metavar="FILE")
def detect(file: str):
    """检测音频文件的 BPM。"""
    info = get_audio_info(file)

    console.print(f"\n[bold cyan]== 正在检测 BPM: {Path(file).name} ==[/bold cyan]")
    console.print(f"  时长: {info['duration']:.1f}s | 采样率: {info['sr']} Hz")

    import librosa
    y, sr = librosa.load(file, sr=None, mono=True)
    bpm_val = detect_bpm(y, sr)

    console.print(f"\n[bold yellow]  检测结果: {bpm_to_string(bpm_val)}[/bold yellow]")
    console.print()

    if bpm_val:
        bar_duration = 60.0 / bpm_val * 4
        total_bars = int(info["duration"] / bar_duration)
        console.print(f"  每小节约 {bar_duration:.3f}s，共约 {total_bars} 个小节")

    console.print(f"\n[green]>> 如果检测结果不准确，可以手动指定 BPM：[/green]")
    console.print(f"    [bold]musiccutter info \"{file}\" --bpm <你的BPM>[/bold]")
    console.print()


@cli.command()
@click.argument("file", type=click.Path(exists=True), metavar="FILE")
@click.option(
    "--bars", "-b", required=True,
    help='要保留的小节范围，例：1-8, 17-24, 33',
)
@click.option(
    "--bpm", type=float, default=None,
    help="指定 BPM（不指定则自动检测）",
)
@click.option(
    "--output", "-o", default=None,
    help="输出文件路径（默认: input_cut.wav）",
)
@click.option(
    "--crossfade", "-c", type=float, default=10.0,
    help="拼接处交叉淡化时长（毫秒，默认 10ms）",
)
@click.option(
    "--align/--strict", default=True,
    help="对齐到实际节拍（默认对齐）",
)
def cut(
    file: str,
    bars: str,
    bpm: float | None,
    output: str | None,
    crossfade: float,
    align: bool,
):
    """按小节裁剪音频并拼接输出。"""
    # 自动生成输出路径
    if output is None:
        inp = Path(file)
        output = str(inp.parent / f"{inp.stem}_cut.wav")

    # 解析小节选择
    try:
        selections = parse_selections(bars)
    except ValueError as e:
        console.print(f"[red]X 小节选择格式错误: {e}[/red]")
        sys.exit(1)

    console.print(f"[bold cyan]== 裁剪: {Path(file).name} ==[/bold cyan]")
    console.print(f"  选择: {' '.join(str(s) for s in selections)}")
    console.print(f"  交叉淡化: {crossfade}ms")
    console.print(f"  对齐模式: {'对齐节拍' if align else '严格数学网格'}")

    # 加载并分析
    cutter = MusicCutter(file)
    bpm_val, bars_list = cutter.analyze(bpm=bpm, align=align)
    console.print(f"  BPM: [bold yellow]{bpm_to_string(bpm_val)}[/bold yellow]")
    console.print(f"  小节数: {len(bars_list)}")

    # 验证选择
    max_bar = len(bars_list)
    for sel in selections:
        if sel.start_bar > max_bar:
            console.print(
                f"[red]X 小节 {sel.start_bar} 超出范围 "
                f"（最大: {max_bar}）[/red]"
            )
            sys.exit(1)
        if sel.end_bar > max_bar:
            console.print(
                f"[yellow]⚠ 小节 {sel.end_bar} 超出范围，截断到 {max_bar}[/yellow]"
            )

    # 执行裁剪
    try:
        cutter.cut(selections, output, crossfade_ms=crossfade)
    except Exception as e:
        console.print(f"[red]X 裁剪失败: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    cli()
