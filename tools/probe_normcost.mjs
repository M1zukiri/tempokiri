// 创建时间：2026-10-19 15:50:00
// probe_normcost.mjs — 诊断：识别值 vs 最近整洁值的网格拟合代价差异（用于标定 a2 吸附门槛）。
// 前置：无头 Edge 已以 --remote-debugging-port=9338 启动；在 tempokiri 仓库根运行。
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/maj/maj_db.json';
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const pickIds = [
  '其他人的谱面存档/Kawakaze/花',
  '其他人的谱面存档/Niubi/ストックホルムワルツ',
  '其他人的谱面存档/Kawakaze/またおいで',
  '制作中/FFF',
  '制作中/NIGHT DANCER',
  '其他人的谱面存档/Niubi/上弦の月',
];
const items = pickIds.map((id) => db.items.find((x) => x.id === id)).filter(Boolean);
const PAGE = `(async () => {
  const d = await MC.decodeAudioFile(window.__lastFile);
  const gs = MC.loadGlobalSettings();
  const delta = 1.6 - 0.9 * gs.sensitivity;
  const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
  const pcm = d.rawMono, sr = d.sampleRate;
  const n = Math.max(1, Math.floor(pcm.length * 22050 / sr));
  const out22 = new Float32Array(n); const r = sr / 22050;
  for (let i = 0; i < n; i++) { const pos = i * r; const idx = Math.min(Math.floor(pos), pcm.length - 1); const fr = pos - idx; const a = pcm[idx], b = idx + 1 < pcm.length ? pcm[idx + 1] : a; out22[i] = a + (b - a) * fr; }
  const res = MC.analyze(out22, { sampleRate: 22050, hop, frameSize: 2048, delta });
  const onsets = res.onsets.slice(0, 400);
  const cost = (bpm) => {
    const beat = 60 / bpm; let best = Infinity;
    for (let c = 0; c < 32; c++) {
      const off = (c / 32) * beat; let s = 0;
      for (const t of onsets) { const ph = ((t - off) % beat + beat) % beat; const dist = Math.min(ph, beat - ph); s += dist * dist; }
      if (s < best) best = s;
    }
    return best;
  };
  const b = res.bpm;
  const cands = [b, Math.round(b), Math.round(b * 2) / 2, Math.round(b * 10) / 10];
  const uniq = [...new Set(cands)];
  const rows = uniq.map((q) => ({ bpm: q, cost: cost(q), rms: Math.sqrt(cost(q) / onsets.length) }));
  return JSON.stringify({ bpm: b, promoted: !!res.octavePromoted, before: res.bpmBeforeOctave, rows });
})()`;

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => { window.__fileSeq=(window.__fileSeq||0)+1; window.__lastFile=e.target.files&&e.target.files[0]; }, {capture:true}); window.__fileSeq=0; localStorage.clear(); true`);
const out = [];
for (const it of items) {
  const prev = await c.evalJs('window.__fileSeq');
  await c.injectFile(it.audio);
  try {
    await c.waitFor(`window.__fileSeq > ${prev} && document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 30000, it.id);
  } catch (e) { out.push({ id: it.id, err: 'ready-timeout' }); continue; }
  try {
    const r = await c.evalJs(PAGE);
    out.push(Object.assign({ id: it.id, truth: it.bpmFirst }, JSON.parse(r)));
  } catch (e) { out.push({ id: it.id, err: String(e) }); }
}
c.close();
for (const r of out) {
  if (r.err) { console.log(r.id, r.err); continue; }
  console.log(`\n${r.id} truth=${r.truth} bpm=${r.bpm} promoted=${r.promoted} before=${r.before}`);
  for (const row of r.rows) console.log(`   q=${String(row.bpm).padEnd(7)} cost=${row.cost.toFixed(6)} rms=${(row.rms * 1000).toFixed(1)}ms`);
}
