// 创建时间：2026-09-30 12:35:00
/** eval_sr_ab.mjs — 分析采样率对照评估（无头 Edge + CDP）。
 *
 * 背景：M1（resample 加抗混叠低通）在 140 首配对对照中**负收益**
 * （hit0.1 25.7% → 21.4%）。假设：降采样到 22050 会丢掉 >11 kHz 的
 * hi-hat/镲片 onset，而这些恰恰是支撑"正确（较高）BPM 层"的证据；
 * 线性降采样虽产生混叠，却把高频能量的**时间结构**折回了低频，歪打正着。
 * 若假设成立，正解不是滤波，而是提高分析采样率以保留高频 onset。
 *
 * 对照档位（同曲同解码、同一套分析参数语义）：
 *   A = 22050 + 线性降采样（现状）
 *   C = 44100（hop/frame 同比放大：hop 1024 / frame 4096，保持同样的
 *       毫秒窗与频率分辨率 —— 单独检验"保留高频"这一变量）
 *
 * 用法：node tools/eval_sr_ab.mjs [集合列表]
 * 结果：增量写 eval/handmaid/eval_sr_ab.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json';
const OUTL = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_sr_ab.jsonl';
const SETS = (process.argv[2] || 'batch_review,batch_test').split(',');

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const items = db.filter((e) => e.hasAudio && SETS.includes(e.set));
const seen = new Set();
if (fs.existsSync(OUTL)) {
  for (const line of fs.readFileSync(OUTL, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (!j.err) seen.add(j.id); } catch { /* 忽略坏行 */ }
  }
}
const todo = items.filter((e) => !seen.has(e.id));
console.log(`集合: ${SETS.join('+')}  待评估: ${todo.length}（已完成 ${seen.size}）`);

const PAGE_JS = `(async () => {
  const file = window.__lastFile;
  const d = await MC.decodeAudioFile(file);
  const gs = MC.loadGlobalSettings();
  const delta = 1.6 - 0.9 * gs.sensitivity;
  const minBpm = gs.minBpm || 60, maxBpm = gs.maxBpm || 200;
  const run = (sr, hop, frame) => {
    const t0 = performance.now();
    const pcm = MC.resample(d.rawMono, d.sampleRate, sr);
    const t1 = performance.now();
    const r = MC.analyze(pcm, { sampleRate: sr, hop, frameSize: frame, delta, minBpm, maxBpm });
    return { bpm: r.bpm, offset: r.offset, onsets: r.onsets.length,
             resMs: Math.round(t1 - t0), anaMs: Math.round(performance.now() - t1) };
  };
  return JSON.stringify({
    srcSr: d.sampleRate,
    A: run(22050, 512, 2048),   // 现状：22.05k，23.2 ms/帧
    C: run(44100, 1024, 4096),  // 44.1k，同比放大 → 同样 23.2 ms/帧，但保留到 22 kHz
  });
})()`;

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);

async function setup(c) {
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => {
    window.__fileSeq = (window.__fileSeq || 0) + 1;
    window.__lastFile = e.target.files && e.target.files[0];
  }, { capture: true });
  window.__fileSeq = 0; true`);
}

if (!todo.length) { report(); process.exit(0); }

const c = await Cdp.connect();
await setup(c);
const tStart = Date.now();
let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i++) {
  const item = todo[i];
  const prevSeq = await c.evalJs('window.__fileSeq');
  try {
    await c.injectFile(item.audio);
  } catch (err) {
    fs.appendFileSync(OUTL, JSON.stringify({ id: item.id, set: item.set, err: 'inject', at: Date.now() }) + '\n', 'utf8');
    fail++; continue;
  }
  try {
    await c.waitFor(`window.__fileSeq > ${prevSeq} && (document.getElementById('statusBar').textContent.indexOf('就绪') !== -1 || document.getElementById('statusBar').textContent.indexOf('已应用') !== -1)`, 30000, item.id);
  } catch (err) {
    fs.appendFileSync(OUTL, JSON.stringify({ id: item.id, set: item.set, err: 'ready-timeout', at: Date.now() }) + '\n', 'utf8');
    fail++; continue;
  }
  try {
    let r;
    try { r = await withTimeout(c.evalJs(PAGE_JS), 120000, 'analyze'); }
    catch (te) { await setup(c).catch(() => {}); throw te; }
    const rec = Object.assign({ id: item.id, set: item.set, truth: item.bpm, at: Date.now() }, JSON.parse(r));
    fs.appendFileSync(OUTL, JSON.stringify(rec) + '\n', 'utf8');
    ok++;
    if ((i + 1) % 10 === 0 || i === todo.length - 1) {
      console.log(`[${i + 1}/${todo.length}] ${((Date.now() - tStart) / 1000).toFixed(0)}s 成功 ${ok} 失败 ${fail} 最近 ${item.id}: A=${rec.A.bpm} C=${rec.C.bpm} truth=${item.bpm}`);
    }
  } catch (err) {
    fs.appendFileSync(OUTL, JSON.stringify({ id: item.id, set: item.set, err: 'analyze:' + err.message, at: Date.now() }) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 失败: ${err.message}`);
  }
}
console.log(`完成：${ok} 成功 / ${fail} 失败，总耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
c.close();
report();
process.exit(0);

function report() {
  const recs = fs.readFileSync(OUTL, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && !r.err && r.truth && r.A && r.C);
  if (!recs.length) { console.log('无有效结果'); return; }
  const cls = (bpm, truth) => {
    if (bpm == null) return 'null';
    const rt = bpm / truth;
    if (Math.abs(bpm - truth) <= 0.1) return 'hit0.1';
    if (Math.abs(bpm - truth) <= 0.6) return 'hit0.6';
    if (Math.abs(rt - 0.5) < 0.02) return 'x0.5';
    if (Math.abs(rt - 2) < 0.02) return 'x2';
    if (Math.abs(rt - 1.5) < 0.02) return 'x1.5';
    if (Math.abs(rt - 0.67) < 0.03) return 'x0.67';
    if (truth > 200) return 'outOfRange';
    return 'miss';
  };
  const stat = (key) => {
    const m = {};
    const errs = recs.map((r) => Math.abs(r[key].bpm - r.truth)).filter(isFinite).sort((a, b) => a - b);
    for (const r of recs) { const k = cls(r[key].bpm, r.truth); m[k] = (m[k] || 0) + 1; }
    const layer = recs.filter((r) => { const rt = r[key].bpm / r.truth; return Math.abs(r[key].bpm - r.truth) <= 2 || Math.abs(rt - 0.5) < 0.02 || Math.abs(rt - 2) < 0.02; }).length;
    return {
      n: recs.length,
      hit01: ((m['hit0.1'] || 0) / recs.length * 100).toFixed(1) + '%',
      hit06: (((m['hit0.1'] || 0) + (m['hit0.6'] || 0)) / recs.length * 100).toFixed(1) + '%',
      layerCorrect: (layer / recs.length * 100).toFixed(1) + '%',
      medianErr: errs[Math.floor(errs.length / 2)].toFixed(3),
      半频层: m['x0.5'] || 0, 命中: m['hit0.1'] || 0,
      meanOnsets: Math.round(recs.reduce((s, r) => s + r[key].onsets, 0) / recs.length),
      meanAnaMs: Math.round(recs.reduce((s, r) => s + r[key].anaMs, 0) / recs.length),
      meanResMs: Math.round(recs.reduce((s, r) => s + r[key].resMs, 0) / recs.length),
    };
  };
  console.log('\n===== 分析采样率对照（' + recs.length + ' 首，配对同曲同解码）=====');
  console.log('A 22050（现状）:', JSON.stringify(stat('A')));
  console.log('C 44100（同比参数）:', JSON.stringify(stat('C')));
  const better = recs.filter((r) => Math.abs(r.C.bpm - r.truth) < Math.abs(r.A.bpm - r.truth) - 0.05).length;
  const worse = recs.filter((r) => Math.abs(r.A.bpm - r.truth) < Math.abs(r.C.bpm - r.truth) - 0.05).length;
  console.log(`\nC 更准 ${better} 首 / A 更准 ${worse} 首 / 持平 ${recs.length - better - worse} 首`);
  for (const r of recs.filter((x) => Math.abs(x.A.bpm - x.C.bpm) > 0.05).slice(0, 20)) {
    console.log(`  ${r.id}: 真值 ${r.truth}  A(22k)=${r.A.bpm}  C(44k)=${r.C.bpm}  onset ${r.A.onsets}→${r.C.onsets}`);
  }
}
