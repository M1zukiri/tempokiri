// 创建时间：2026-08-24 12:10:00
/** push_via_api.mjs — 网络代理不可用时用 GitHub REST API 完成等效 push（main 快进 + 轻量 tag）。 */
import { execSync } from 'node:child_process';

const token = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'GITHUB_TOKEN\',\'User\')"', { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'tempokiri-release', 'Content-Type': 'application/json' };
const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
console.log('本地 HEAD:', sha);

const r1 = await fetch('https://api.github.com/repos/M1zukiri/tempokiri/git/refs/heads/main', {
  method: 'PATCH', headers: H, body: JSON.stringify({ sha, force: false }),
});
console.log('main 更新:', r1.status, (await r1.text()).slice(0, 100));

const r2 = await fetch('https://api.github.com/repos/M1zukiri/tempokiri/git/refs', {
  method: 'POST', headers: H, body: JSON.stringify({ ref: 'refs/tags/v1.12.3', sha }),
});
console.log('tag 创建:', r2.status, (await r2.text()).slice(0, 100));

const m = await (await fetch('https://api.github.com/repos/M1zukiri/tempokiri/commits/main', { headers: { 'User-Agent': 'x' } })).json();
console.log('远程 main:', m.sha);
