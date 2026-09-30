// 创建时间：2026-08-24 02:20:00
/** reconstruct_164_170.mjs — 重建 v1.6.4 / v1.7.0 的 GitHub Release（make_latest=false，不抢 latest）。 */
import { execSync } from 'node:child_process';

const token = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'GITHUB_TOKEN\',\'User\')"', { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'tempokiri-release', 'Content-Type': 'application/json' };
const RELEASES = {
  'v1.6.4': '选区「延伸到末尾」浮标——选中区间后波形容器右上角出现「⤳ 延伸到末尾」chip，一键把选区右端延伸到网格最后一个小节，保证可入列语义；入列/切文件自动隐藏。验证：142/142 单测全绿。',
  'v1.7.0': '页脚新增「元数据」菜单：导入文件自动解析元数据（MP3 ID3v2.2-2.4/ID3v1、FLAC/OGG Vorbis Comment、MP4 moov/udta/meta/ilst、WAV LIST/INFO），6 文本字段可编辑并持久化到 per-file 缓存，封面只读展示；导出音频自动附加（WAV LIST/INFO UTF-8、MP3 ID3v2.3 含 APIC）。验证：132/132 单测全绿。',
};
for (const [tag, body] of Object.entries(RELEASES)) {
  const r = await fetch('https://api.github.com/repos/M1zukiri/tempokiri/releases', {
    method: 'POST', headers: H,
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false, make_latest: 'false' }),
  });
  const j = await r.json();
  console.log(r.ok ? '已重建 ' + tag + ' id=' + j.id : '重建失败 ' + tag + ' ' + r.status + ' ' + JSON.stringify(j));
}
// 验证
const latest = await (await fetch('https://api.github.com/repos/M1zukiri/tempokiri/releases/latest', { headers: { 'User-Agent': 'tempokiri-release' } })).json();
console.log('latest = ' + latest.tag_name);
