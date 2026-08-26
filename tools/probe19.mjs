// 创建时间：2026-08-24 10:10:00
/** probe19.mjs — batch1 随机抽样 100 首：算法+tap（随机偏离真值 ±5%）最终识别准确率（|误差|≤0.1 判正）。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = JSON.parse(fs.readFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json', 'utf8'));
const N = 100;
const SEED = 20260824;
let seed = SEED;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// 固定 seed 随机抽样 100 首（batch1，含音频）
const pool = DB.filter((e) => e.set === 'batch1' && e.hasAudio);
const items = [];
const used = new Set();
while (items.length < N && used.size < pool.length) {
  const idx = Math.floor(rng() * pool.length);
  const e = pool[idx];
  if (!used.has(e.id)) { used.add(e.id); items.push(e); }
}
console.log(`抽样: batch1 ${items.length} 首（seed=${SEED}） BPM 范围 ${Math.min(...items.map((i) => i.bpm))}-${Math.max(...items.map((i) => i.bpm))}`);

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => {
    window.__fileSeq = (window.__fileSeq || 0) + 1;
    window.__lastFile = e.target.files && e.target.files[0];
  }, { capture: true });
  window.__fileSeq = 0; true`);

  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prevSeq = await c.evalJs('window.__fileSeq');
    await c.injectFile(item.audio);
    await c.waitFor(`window.__fileSeq > ${prevSeq} && document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 30000, item.id + ' 就绪');
    // 模拟 tap：真值 × (1 ± 5% 均匀随机)
    const tapDev = (rng() * 2 - 1) * 0.05;
    const tap = item.bpm * (1 + tapDev);
    const r = await c.evalJs(`(async () => {
      const d = await MC.decodeAudioFile(window.__lastFile);
      const pcm = MC.resample(d.rawMono, d.sampleRate, 22050);
      const gs = MC.loadGlobalSettings();
      const delta = 1.6 - 0.9 * gs.sensitivity;
      const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
      const tap = ${tap.toFixed(3)};
      const minBpm = Math.max(40, Math.round(tap * 0.8));
      const maxBpm = Math.min(300, Math.round(tap * 1.2));
      const r = MC.analyze(pcm, { sampleRate: 22050, hop, delta, minBpm, maxBpm });
      return JSON.stringify({ bpm: r.bpm, offset: r.offset });
    })()`);
    const o = JSON.parse(r);
    const err = Math.abs(o.bpm - item.bpm);
    rows.push({ id: item.id, truth: item.bpm, tap: +tap.toFixed(1), tapDev: +(tapDev * 100).toFixed(1), alg: o.bpm, err: +err.toFixed(2) });
    if ((i + 1) % 20 === 0) {
      const ok01 = rows.filter((x) => x.err <= 0.1).length;
      console.log(`[${i + 1}/${items.length}] ≤0.1 准确率 ${(ok01 / rows.length * 100).toFixed(1)}%`);
    }
  }

  const exact = rows.filter((x) => x.err <= 0.1).length;
  const near = rows.filter((x) => x.err > 0.1 && x.err <= 0.6).length;
  const layer = rows.filter((x) => x.err > 0.6 && x.err <= 2).length;
  const bad = rows.filter((x) => x.err > 2).length;
  const errs = rows.map((x) => x.err).sort((a, b) => a - b);
  const pct = (p) => errs[Math.floor((errs.length - 1) * p)];
  console.log('\n===== batch1 抽样 100 首：算法+tap（±5% 随机偏离真值）=====');
  console.log(`识别正确标准 |误差| ≤ 0.1： 准确率 ${(exact / N * 100).toFixed(1)}%（${exact}/100）`);
  console.log(`|误差| 分布：≤0.1 ${exact} | (0.1,0.6] ${near} | (0.6,2] ${layer} | >2 ${bad}`);
  console.log(`误差分位：中位 ${pct(0.5)} | p75 ${pct(0.75)} | p90 ${pct(0.9)} | 最大 ${errs[errs.length - 1]}`);
  console.log(`tap 偏离真值 %（均匀 ±5%）：中位 ${(() => { const d = rows.map((x) => Math.abs(x.tapDev)).sort((a, b) => a - b); return d[50]; })()}%`);
  console.log('\nTop 误差样本：');
  for (const x of [...rows].sort((a, b) => b.err - a.err).slice(0, 12)) {
    console.log(`  ${x.id} truth=${x.truth} tap=${x.tap}(${x.tapDev > 0 ? '+' : ''}${x.tapDev}%) alg=${x.alg} err=${x.err}`);
  }
  fs.writeFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_batch1_tap_100.json', JSON.stringify({ seed: SEED, n: N, exact, near, layer, bad, rows }, null, 1), 'utf8');
  console.log('\n写入 eval/handmaid/eval_batch1_tap_100.json');
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
