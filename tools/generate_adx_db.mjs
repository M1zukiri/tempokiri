// 创建时间：2026-09-30 13:05:00
/** generate_adx_db.mjs — 从 E:/Sync/adx-charts 生成评估用音频-真值数据库。
 *
 * 语料：AstroDX（maimai 风格模拟器）谱面归档，27 个版本目录 / 1901 个曲目目录，
 *       每目录含 maidata.txt（谱面）+ track.mp3 + bg.png。
 * 真值：maidata.txt 的 `&wholebpm=`（谱面声明 BPM；本语料 1901/1901 都有，3 首带小数）。
 *
 * 已知口径限制（写进 DB 的 notes，别忘）：
 *   - `&first` 1901/1901 全为 0 → offset 维度无法用本语料验证
 *   - track.mp3 抽样 159 首中 158 首为 48000 Hz / 256 kbps → 无采样率多样性
 *   - 与旧语料 handmaid 重叠：handmaid 的 1477 个 id 全部包含在本库内，
 *     且音频字节完全相同（抽样校验）→ **不是独立语料**，只是超集（+424 首）
 *
 * 用法：node tools/generate_adx_db.mjs
 * 输出：C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/adx/adx_db.json（数据库不入库）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/Sync/adx-charts';
const OUT = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/adx/adx_db.json';
const SKIP = new Set(['.git', '.cache', '.tmp', 'tools', 'logs']);

const field = (text, key) => {
  const m = text.match(new RegExp('&' + key + '=([^\\r\\n&]*)'));
  return m ? m[1].trim() : null;
};

const recs = [];
for (const ver of fs.readdirSync(ROOT).sort()) {
  if (SKIP.has(ver) || ver.startsWith('.')) continue;
  const vp = path.join(ROOT, ver);
  if (!fs.statSync(vp).isDirectory()) continue;
  for (const dir of fs.readdirSync(vp).sort()) {
    const dp = path.join(vp, dir);
    if (!fs.statSync(dp).isDirectory()) continue;
    const mtPath = path.join(dp, 'maidata.txt');
    const mp3Path = path.join(dp, 'track.mp3');
    if (!fs.existsSync(mtPath)) continue;
    let head;
    try {
      // 只读前 4 KB：maidata 的头字段都在开头，避免读整个谱面
      const fd = fs.openSync(mtPath, 'r');
      const buf = Buffer.alloc(4096);
      fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      head = buf.toString('utf8');
    } catch (e) {
      continue;
    }
    const bpmRaw = field(head, 'wholebpm') || field(head, 'bpm');
    const bpm = bpmRaw != null ? parseFloat(bpmRaw) : null;
    if (bpm == null || !isFinite(bpm)) continue;
    recs.push({
      id: field(head, 'shortid') || dir.slice(0, 6),
      dir,
      ver,
      title: field(head, 'title'),
      artist: field(head, 'artist'),
      bpm,
      bpmRaw,
      bpmField: field(head, 'wholebpm') ? 'wholebpm' : 'bpm',
      first: parseFloat(field(head, 'first') || '0'),
      versionid: field(head, 'versionid'),
      audio: fs.existsSync(mp3Path) ? mp3Path : null,
      hasAudio: fs.existsSync(mp3Path),
    });
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: Date.now(),
  source: ROOT,
  notes: [
    '真值 = maidata.txt 的 &wholebpm（谱面声明 BPM，多为整数，实际音频可能有小数漂移）',
    '&first 全为 0 → offset 维度无法用本语料验证',
    'track.mp3 抽样 158/159 为 48000 Hz / 256 kbps → 无采样率多样性',
    '与 handmaid 语料重叠：其 1477 个 id 全部包含在本库内且音频字节相同 → 非独立语料，仅为超集（+424 首）',
  ],
  count: recs.length,
  withAudio: recs.filter((r) => r.hasAudio).length,
  items: recs,
}, null, 1), 'utf8');

const bpms = recs.map((r) => r.bpm);
console.log(`曲目 ${recs.length}（含音频 ${recs.filter((r) => r.hasAudio).length}）`);
console.log(`BPM ${Math.min(...bpms)}–${Math.max(...bpms)}  >200 的 ${bpms.filter((b) => b > 200).length} 首`);
console.log('→ ' + OUT);
