// 创建时间：2026-09-30 11:35:00
/** eval_aa_ab.mjs — M1（resample 抗混叠低通）配对 A/B 评估（无头 Edge + CDP）。
 *
 * 用途：同一首曲子、同一份解码结果，分别用「线性降采样（改动前）」与
 * 「抗混叠降采样（改动后）」跑同一条分析管线，得到**配对**对照，
 * 排除版本差异与曲目抽样差异的干扰。
 *
 * 用法：node tools/eval_aa_ab.mjs [集合列表,逗号分隔，默认 batch_review,batch_test]
 * 结果：增量写 eval/handmaid/eval_aa_ab.jsonl（断点续跑，已完成 id 跳过）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json';
const OUTL = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_aa_ab.jsonl';
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

// 页面内执行：一次解码，两种重采样，同一套分析参数
const PAGE_JS = `(async () => {
  const file = window.__lastFile;
  const d = await MC.decodeAudioFile(file);
  const lin = (pcm, f, t) => {
    const n = Math.max(1, Math.floor(pcm.length * t / f));
    const o = new Float32Array(n); const r = f / t;
    for (let i = 0; i < n; i++) {
      const pos = i * r; const idx = Math.min(Math.floor(pos), pcm.length - 1); const fr = pos - idx;
      const a = pcm[idx]; const b = idx + 1 < pcm.length ? pcm[idx + 1] : a;
      o[i] = a + (b - a) * fr;
    }
    return o;
  };
  const gs = MC.loadGlobalSettings();
  const delta = 1.6 - 0.9 * gs.sensitivity;
  const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
  const opts = { sampleRate: 22050, hop, delta, minBpm: gs.minBpm || 60, maxBpm: gs.maxBpm || 200 };
  const t1 = performance.now();
  const pcmAA = MC.resample(d.rawMono, d.sampleRate, 22050);
  const msResAA = performance.now() - t1;
  const t2 = performance.now();
  const pcmLin = lin(d.rawMono, d.sampleRate, 22050);
  const msResLin = performance.now() - t2;
  const t3 = performance.now();
  const rAA = MC.analyze(pcmAA, opts);
  const msAA = performance.now() - t3;
  const t4 = performance.now();
  const rLin = MC.analyze(pcmLin, opts);
  const msLin = performance.now() - t4;
  return JSON.stringify({
    srcSr: d.sampleRate, dur: +(pcmAA.length / 22050).toFixed(1),
    aa: { bpm: rAA.bpm, offset: rAA.offset, onsets: rAA.onsets.length },
    lin: { bpm: rLin.bpm, offset: rLin.offset, onsets: rLin.onsets.length },
    ms: { resAA: Math.round(msResAA), resLin: Math.round(msResLin), anaAA: Math.round(msAA), anaLin: Math.round(msLin) },
  });
})()`;

if (!todo.length) {
  report();
  process.exit(0);
}

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);

/** 打开页面并安装文件注入钩子（首次与卡死恢复后都要走一遍）。 */
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
    fs.appendFileSync(OUTL, JSON.stringify({ id: item.id, set: item.set, err: 'inject:' + err.message, at: Date.now() }) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 注入失败`);
    continue;
  }
  try {
    await c.waitFor(`window.__fileSeq > ${prevSeq} && (document.getElementById('statusBar').textContent.indexOf('就绪') !== -1 || document.getElementById('statusBar').textContent.indexOf('已应用') !== -1)`, 30000, item.id + ' 就绪');
  } catch (err) {
    fs.appendFileSync(OUTL, JSON.stringify({ id: item.id, set: item.set, err: 'ready-timeout', at: Date.now() }) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 就绪超时`);
    continue;
  }
  try {
    let r;
    try {
      r = await withTimeout(c.evalJs(PAGE_JS), 90000, 'analyze');
    } catch (te) {
      // 单首卡死（页面/WebSocket 僵住）不拖垮整批：重建页面后跳过该首
      await setup(c).catch(() => {});
      throw te;
    }
    const rec = Object.assign({ id: item.id, set: item.set, truth: item.bpm, at: Date.now() }, JSON.parse(r));
    fs.appendFileSync(OUTL, JSON.stringify(rec) + '\n', 'utf8');
    ok++;
    if ((i + 1) % 10 === 0 || i === todo.length - 1) {
      console.log(`[${i + 1}/${todo.length}] ${((Date.now() - tStart) / 1000).toFixed(0)}s  成功 ${ok} 失败 ${fail}  最近 ${item.id}: AA=${rec.aa.bpm} lin=${rec.lin.bpm} truth=${item.bpm}`);
    }
  } catch (err) {
    fs.appendFileSync(OUTL, JSON.stringify({ id: item.id, set: item.set, err: 'analyze:' + err.message, at: Date.now() }) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 分析失败: ${err.message}`);
  }
}
console.log(`完成：${ok} 成功 / ${fail} 失败，总耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
c.close();
report();
process.exit(0);

function report() {
  const recs = fs.readFileSync(OUTL, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && !r.err && r.truth && r.aa && r.aa.bpm);
  if (!recs.length) { console.log('无有效结果'); return; }
  const cls = (bpm, truth) => {
    if (bpm == null) return 'null';
    const ratio = bpm / truth;
    if (Math.abs(bpm - truth) <= 0.1) return 'hit0.1';
    if (Math.abs(bpm - truth) <= 0.6) return 'hit0.6';
    if (Math.abs(ratio - 0.5) < 0.02) return 'x0.5';
    if (Math.abs(ratio - 2) < 0.02) return 'x2';
    if (Math.abs(ratio - 1.5) < 0.02) return 'x1.5';
    if (Math.abs(ratio - 0.67) < 0.03) return 'x0.67';
    if (truth > 200) return 'outOfRange';
    return 'miss';
  };
  const stat = (key) => {
    const m = {};
    const errs = recs.map((r) => Math.abs(r[key].bpm - r.truth)).filter((v) => isFinite(v)).sort((a, b) => a - b);
    for (const r of recs) { const k = cls(r[key].bpm, r.truth); m[k] = (m[k] || 0) + 1; }
    const layer = recs.filter((r) => { const rt = r[key].bpm / r.truth; return Math.abs(r[key].bpm - r.truth) <= 2 || Math.abs(rt - 0.5) < 0.02 || Math.abs(rt - 2) < 0.02; }).length;
    return {
      n: recs.length,
      hit01: ((m['hit0.1'] || 0) / recs.length * 100).toFixed(1) + '%',
      hit06: (((m['hit0.1'] || 0) + (m['hit0.6'] || 0)) / recs.length * 100).toFixed(1) + '%',
      layerCorrect: (layer / recs.length * 100).toFixed(1) + '%',
      medianErr: errs[Math.floor(errs.length / 2)].toFixed(3),
      p90Err: errs[Math.floor(errs.length * 0.9)].toFixed(3),
      dist: m,
      meanResampleMs: Math.round(recs.reduce((s, r) => s + r.ms[key === 'aa' ? 'resAA' : 'resLin'], 0) / recs.length),
      meanAnalyzeMs: Math.round(recs.reduce((s, r) => s + r.ms[key === 'aa' ? 'anaAA' : 'anaLin'], 0) / recs.length),
      meanOnsets: Math.round(recs.reduce((s, r) => s + r[key].onsets, 0) / recs.length),
    };
  };
  console.log('\n===== M1 抗混叠 A/B 对照（' + recs.length + ' 首，配对同曲同解码）=====');
  console.log('改动前（线性降采样）:', JSON.stringify(stat('lin'), null, 1));
  console.log('改动后（抗混叠） :', JSON.stringify(stat('aa'), null, 1));
  const diff = recs.filter((r) => Math.abs(r.aa.bpm - r.lin.bpm) > 0.05);
  console.log(`\n结果发生变化的曲目: ${diff.length}/${recs.length}`);
  for (const r of diff.slice(0, 25)) {
    console.log(`  ${r.id}: 真值 ${r.truth}  AA ${r.aa.bpm}  线性 ${r.lin.bpm}  ${Math.abs(r.aa.bpm - r.truth) < Math.abs(r.lin.bpm - r.truth) ? 'AA 更准' : '线性更准'}`);
  }
}
