// 创建时间：2026-08-24 01:30:00
/** create_release.mjs — 用 User 级 GITHUB_TOKEN 创建 GitHub Release（Node 标准 UTF-8，替代 PowerShell JSON 编码问题）。 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const token = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'GITHUB_TOKEN\',\'User\')"', { encoding: 'utf8' }).trim();
if (!token) { console.error('未读取到 token'); process.exit(1); }

const md = fs.readFileSync(process.argv[3] || 'C:/Users/M1zukuro/Desktop/个人/tempokiri/tools/release_body_v180_190_191.md', 'utf8');
function section(name) {
  const m = md.match(new RegExp('## ' + name + '[\\s\\S]*?(?=## |$)'));
  return m ? m[0].replace(new RegExp('## ' + name), '').trim() : '';
}

const tag = process.argv[2] || 'v1.9.1';
const makeLatest = process.argv[4]; // 可选：'true' / 'false'（字符串）
const body = section(tag);
if (!body) { console.error('草稿中未找到 ' + tag + ' 段落'); process.exit(1); }

const payload = { tag_name: tag, name: tag, body, draft: false, prerelease: false };
if (makeLatest) payload.make_latest = makeLatest;

const res = await fetch('https://api.github.com/repos/M1zukiri/tempokiri/releases', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'tempokiri-release',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});
const j = await res.json();
if (res.ok) {
  console.log('已创建 ' + tag + ' → id=' + j.id + ' ' + j.html_url);
} else {
  console.error('创建失败: ' + res.status + ' ' + JSON.stringify(j));
  process.exit(1);
}
