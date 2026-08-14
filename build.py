#!/usr/bin/env python3
"""
build.py — 将 Remix 工作站打包为单 HTML 文件（dist/tempokiri-workstation.html）。

将 index.html 中所有 <script src="..."> 替换为内嵌内容；并把 README.md 全文、
版本号注入 footer.js 占位符（__README_CONTENT__ / __VERSION__），strings.json
文案文档注入 i18n.js 占位符（__I18N__），零外部请求。

文案完整性校验：扫描合并后代码中的 T('key') 调用与 data-i18n="key" 属性，
与 strings.json 叶子 key 做差集——代码引用但文档缺失 → 构建失败（防漏）；
文档存在但代码未引用 → 警告（防冗余）。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "index.html"
DIST = ROOT / "dist" / "tempokiri-workstation.html"
README = ROOT / "README.md"
VERSION_FILE = ROOT / "VERSION"
I18N_FILE = ROOT / "strings.json"

SCRIPT_RE = re.compile(r'<script src="([^"]+)"></script>')
T_CALL_RE = re.compile(r"""T\(\s*['"]([^'"]+)['"]""")
DATA_I18N_RE = re.compile(r'data-i18n(?:-title)?="([^"]+)"')


def version() -> str:
    """从根级 VERSION 文件读取版本号（单源）。"""
    return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0"


def i18n_doc() -> dict:
    """读取文案文档（strings.json）。"""
    return json.loads(I18N_FILE.read_text(encoding="utf-8"))


def collect_keys(obj: dict, prefix: str = "") -> set:
    """展开嵌套字典为叶子 key（'a.b.c'）；_doc 说明字段不参与校验。"""
    keys = set()
    for k, v in obj.items():
        if k == '_doc':
            continue
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys |= collect_keys(v, p)
        else:
            keys.add(p)
    return keys




def verify_i18n(html: str, doc: dict) -> None:
    """校验文案完整性：代码引用的 key 必须存在于 strings.json。"""
    used = set(T_CALL_RE.findall(html)) | set(DATA_I18N_RE.findall(html))
    known = collect_keys(doc)
    missing = used - known
    unused = known - used
    if missing:
        raise SystemExit(
            "strings.json 缺失以下文案 key（构建中止）：\n  "
            + "\n  ".join(sorted(missing))
            + "\n请在 strings.json 中补充对应文案。"
        )
    if unused:
        print("警告：strings.json 中存在未被引用的 key（可清理）：\n  " + "\n  ".join(sorted(unused)))
SCRIPT_RE = re.compile(r'<script src="([^"]+)"></script>')


def version() -> str:
    """从根级 VERSION 文件读取版本号（单源）。"""
    return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0"


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

    # 文案完整性校验（在注入前扫描，避免注入的 key 干扰差集）
    doc = i18n_doc()
    verify_i18n(out, doc)

    # 注入 strings.json 文案对象（json.dumps 是合法 JS 对象字面量）
    out = out.replace(
        "const I18N_SOURCE = '__I18N__';",
        "const I18N_SOURCE = " + json.dumps(doc, ensure_ascii=False) + ";",
    )

    # 注入 README 全文（JS 单引号字符串转义，与 footer.js 占位符一致）
    # 与版本号。json.dumps 产生双引号 JSON，不能直接嵌入单引号 JS 字符串
    # （\" 与 \\u 会保持字面量）；这里转成单引号安全的 JS 字符串字面量。
    readme_text = README.read_text(encoding="utf-8")
    js_readme = (
        "'"
        + readme_text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
        + "'"
    )
    out = re.sub(
        r"const README_SOURCE = '__README_CONTENT__';",
        lambda m: "const README_SOURCE = " + js_readme + ";",  # 用函数避免 repl 转义反斜杠
        out,
    )
    out = out.replace("__VERSION__", version())

    DIST.parent.mkdir(parents=True, exist_ok=True)
    DIST.write_text(out, encoding="utf-8")
    size_kb = DIST.stat().st_size / 1024
    print(f"已打包 → {DIST} ({size_kb:.0f} KB) v{version()}")


if __name__ == "__main__":
    main()
