// 创建时间：2026-08-24 05:40:00
/** generate_handmaid_db.mjs — 解析 handmaid 训练集 maid data，构建音频-真值数据库。
 * 真值：&bpm=（若无则 &wholebpm=，记录来源 bpmField）；&first= 首拍偏移（秒）；
 * inote/eff 行首 (BPM) 集合 bpmSet（变速曲 >1 个值）。
 * 输出：外层工作区 eval/handmaid/handmaid_db.json（用户工作区评估资产，不入产品仓库）。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/M1zukuro/Desktop/Sync/handmaid/训练集';
const OUT = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid';
const SETS = [
  { set: 'batch_review', dir: path.join(ROOT, 'batch_review', 'out') },
  { set: 'batch_test', dir: path.join(ROOT, 'batch_test', 'out') },
  { set: 'batch1', dir: path.join(ROOT, 'batch1', 'out') },
];

const entries = [];
let files = 0, parsedOk = 0, bpmFieldBpm = 0, varTempo = 0, noBpm = 0;

for (const { set, dir } of SETS) {
  const ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of ids) {
    const folder = path.join(dir, d.name);
    const mdPath = path.join(folder, 'maidata.txt');
    const mp3Path = path.join(folder, 'track.mp3');
    if (!fs.existsSync(mdPath)) continue;
    files++;
    const txt = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
    let bpm = null, bpmField = null, first = null, firstRaw = null;
    const bpmSet = new Set();
    for (const line of txt) {
      const mBpm = line.match(/^&\s*bpm=([\d.]+)/);
      const mWhole = line.match(/^&\s*wholebpm=([\d.]+)/);
      const mFirst = line.match(/^&\s*first=([\d.-]*)/);
      const mNote = line.match(/^&\s*(?:inote|eff)_\d+\s*=.*?\((\d+(?:\.\d+)?)\)/);
      if (mBpm && bpm == null) { bpm = parseFloat(mBpm[1]); bpmField = 'bpm'; bpmFieldBpm++; }
      else if (mWhole && bpm == null) { bpm = parseFloat(mWhole[1]); bpmField = 'wholebpm'; }
      if (mFirst && first == null) { firstRaw = mFirst[1]; first = firstRaw === '' ? null : parseFloat(firstRaw); }
      if (mNote) bpmSet.add(parseFloat(mNote[1]));
    }
    if (bpm == null) { noBpm++; bpmField = 'none'; }
    if (bpmSet.size > 1) varTempo++;
    parsedOk++;
    entries.push({
      id: d.name,
      set,
      audio: mp3Path,
      hasAudio: fs.existsSync(mp3Path),
      bpm,
      bpmField,
      bpmSet: [...bpmSet].sort((a, b) => a - b),
      first,
      firstRaw,
      maidbytes: fs.statSync(mdPath).size,
    });
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'handmaid_db.json'), JSON.stringify(entries, null, 1), 'utf8');
const withAudio = entries.filter((e) => e.hasAudio).length;
console.log('总谱面:', entries.length, ' 含音频:', withAudio);
console.log('解析成功:', parsedOk, ' &bpm 字段:', bpmFieldBpm, ' 变速曲(>1 BPM):', varTempo, ' 无BPM:', noBpm);
const dist = {};
for (const e of entries) dist[e.set + '/' + (e.hasAudio ? 'audio' : 'noaudio')] = (dist[e.set + '/' + (e.hasAudio ? 'audio' : 'noaudio')] || 0) + 1;
console.log('分布:', JSON.stringify(dist));
console.log('BPM 范围:', Math.min(...entries.map((e) => e.bpm ?? 999)), '-', Math.max(...entries.map((e) => e.bpm ?? 0)));
console.log('写入:', path.join(OUT, 'handmaid_db.json'));
