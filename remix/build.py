#!/usr/bin/env python3
"""
build.py — 将 Remix 工作站打包为单 HTML 文件（dist/tempokiri-workstation.html）。

将 index.html 中所有 <script src="..."> 替换为内嵌内容，零外部请求。
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "index.html"
DIST = ROOT / "dist" / "tempokiri-workstation.html"

SCRIPT_RE = re.compile(r'<script src="([^"]+)"></script>')


def main() -> None:
    html = SRC.read_text(encoding="utf-8")

    def replace(match: re.Match) -> str:
        path = ROOT / match.group(1)
        if not path.exists():
            raise SystemExit(f"缺失文件: {path}")
        code = path.read_text(encoding="utf-8")
        # 防止 JS 字符串中的 </script> 提前终止内嵌脚本
        code = code.replace("</script>", "<\\/script>")
        return f"<script>\n{code}\n</script>"

    out = SCRIPT_RE.sub(replace, html)
    DIST.parent.mkdir(parents=True, exist_ok=True)
    DIST.write_text(out, encoding="utf-8")
    size_kb = DIST.stat().st_size / 1024
    print(f"已打包 → {DIST} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
