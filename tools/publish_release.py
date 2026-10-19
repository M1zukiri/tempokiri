# 创建时间：2026-10-19 16:00:00
# publish_release.py — 为当前 VERSION 建标签、推远端、创建 GitHub Release 并上传单文件产物。
# 版本说明从 CLAUDE.md「版本历史」对应条目提取（保留正文，去掉「验证：」段）。
# 用法：python tools/publish_release.py [--dry-run]
import io
import json
import os
import re
import subprocess
import sys
import urllib.request

REPO = "M1zukiri/tempokiri"
GIT_DIR = r"C:\Users\M1zukuro\Desktop\个人\tempokiri\tempokiri"
CLAUDE = os.path.join(GIT_DIR, "CLAUDE.md")
DIST = os.path.join(GIT_DIR, "dist", "tempokiri-workstation.html")


def run(cmd, cwd=None, check=True, env=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", env=env)
    if check and r.returncode != 0:
        raise RuntimeError("%s 失败: %s" % (" ".join(cmd), (r.stderr or r.stdout).strip()))
    return r.stdout.strip()


def token_of():
    r = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                       capture_output=True, text=True, cwd=GIT_DIR)
    m = re.search(r"^password=(.+)$", r.stdout, re.MULTILINE)
    if not m:
        raise RuntimeError("无法从 git credential 读取 GitHub 令牌")
    return m.group(1)


def api(url, token, method="GET", payload=None, raw=None, content_type="application/json"):
    body = raw if raw is not None else (json.dumps(payload).encode("utf-8") if payload is not None else None)
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "tempokiri-release",
        "Content-Type": content_type,
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8")), resp.status
    except urllib.error.HTTPError as e:
        return {"__error__": e.code, "body": e.read().decode("utf-8", "replace")[:300]}, e.code


def version_notes(ver):
    txt = io.open(CLAUDE, encoding="utf-8").read()
    m = re.search(r"^- \*\*%s\*\*：(.*)$" % re.escape(ver), txt, re.MULTILINE)
    if not m:
        raise RuntimeError("CLAUDE.md 版本历史缺少 %s 条目" % ver)
    body = m.group(1).strip()
    cut = body.find("验证：")
    if cut > 0:
        body = body[:cut].rstrip("；;。 ")
    return body


def push_tag(tag, token):
    env = dict(os.environ)
    env["TK_TOKEN"] = token
    env["GIT_TERMINAL_PROMPT"] = "0"
    run(["git", "-c", "credential.helper=",
         "-c", 'credential.helper=!f() { echo username=M1zukiri; echo "password=$TK_TOKEN"; }; f',
         "push", "origin", tag], cwd=GIT_DIR, env=env)


def main():
    dry = "--dry-run" in sys.argv
    ver = io.open(os.path.join(GIT_DIR, "VERSION"), encoding="utf-8").read().strip()
    tag = "v" + ver
    body = version_notes(ver)
    print("版本 %s  说明 %d 字" % (tag, len(body)))
    if dry:
        print(body[:300])
        return

    token = token_of()
    local_tags = set(run(["git", "tag"], cwd=GIT_DIR).split())
    if tag not in local_tags:
        run(["git", "tag", "-a", tag, "-m", "Tempokiri " + tag], cwd=GIT_DIR)
        print("[tag] 创建", tag)
    push_tag(tag, token)
    print("[push]", tag)

    j, status = api("https://api.github.com/repos/%s/releases" % REPO, token, "POST",
                    {"tag_name": tag, "name": tag, "body": body, "draft": False, "prerelease": False})
    if j.get("__error__"):
        print("Release 创建失败", j["__error__"], j.get("body"))
        return
    rel_id = j.get("id")
    print("[release]", j.get("html_url"))

    if os.path.isfile(DIST) and rel_id:
        with open(DIST, "rb") as f:
            data = f.read()
        up, _ = api("https://uploads.github.com/repos/%s/releases/%d/assets?name=tempokiri-workstation.html"
                    % (REPO, rel_id), token, "POST", raw=data, content_type="text/html")
        if up.get("__error__"):
            print("[asset] 上传失败", up["__error__"], up.get("body"))
        else:
            print("[asset]", up.get("name"), up.get("size"), "B")


if __name__ == "__main__":
    main()
