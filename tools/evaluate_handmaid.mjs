// 创建时间：2026-08-24 05:50:00
/** evaluate_handmaid.mjs — 批量评估 Tempokiri BPM 识别算法（无头 Edge + CDP）。
 * 用法：node tools/evaluate_handmaid.mjs [集合列表,逗号分隔，默认 batch_review,batch_test]
 * 数据：eval/handmaid/handmaid_db.json → 结果增量写 eval/handmaid/eval_raw.jsonl（断点续跑，已完成 id 跳过）。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json';
const OUTL = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_raw.jsonl';
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
if (!todo.length) process.exit(0);

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => {
  window.__fileSeq = (window.__fileSeq || 0) + 1;
  window.__lastFile = e.target.files && e.target.files[0];
}, { capture: true });
window.__fileSeq = 0; true`);

const tStart = Date.now();
let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i++) {
  const item = todo[i];
  const prevSeq = await c.evalJs('window.__fileSeq');
  try {
    await c.injectFile(item.audio);
  } catch (err) {
    const rec = { id: item.id, set: item.set, err: 'inject:' + err.message, at: Date.now() };
    fs.appendFileSync(OUTL, JSON.stringify(rec) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 注入失败: ${err.message}`);
    continue;
  }
  try {
    // waitFor：成功 return undefined，超时 throw（e2e_lib 语义）
    await c.waitFor(`window.__fileSeq > ${prevSeq} && (document.getElementById('statusBar').textContent.indexOf('就绪') !== -1 || document.getElementById('statusBar').textContent.indexOf('已应用') !== -1)`, 30000, item.id + ' 就绪');
  } catch (err) {
    const rec = { id: item.id, set: item.set, err: 'ready-timeout:' + err.message, at: Date.now() };
    fs.appendFileSync(OUTL, JSON.stringify(rec) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 就绪超时`);
    continue;
  }
  try {
    const r = await c.evalJs(`(async () => {
      const file = window.__lastFile;
      const d = await MC.decodeAudioFile(file);
      const pcm = MC.resample(d.rawMono, d.sampleRate, 22050);
      const gs = MC.loadGlobalSettings();
      const delta = 1.6 - 0.9 * gs.sensitivity;
      const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
      const t0 = performance.now();
      const r = MC.analyze(pcm, { sampleRate: 22050, hop, delta, minBpm: gs.minBpm || 60, maxBpm: gs.maxBpm || 200 });
      return JSON.stringify({
        bpm: r.bpm, offset: r.offset,
        cands: (r.bpmCandidates || []).map((cc) => ({ bpm: cc.bpm, rel: cc.rel, harm: cc.harm })),
        dur: +(pcm.length / 22050).toFixed(1),
        ms: Math.round(performance.now() - t0),
      });
    })()`);
    const rec = Object.assign({ id: item.id, set: item.set, truth: item.bpm, truthField: item.bpmField, first: item.first, at: Date.now() }, JSON.parse(r));
    fs.appendFileSync(OUTL, JSON.stringify(rec) + '\n', 'utf8');
    ok++;
    if ((i + 1) % 10 === 0 || i === todo.length - 1) {
      const el = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`[${i + 1}/${todo.length}] 耗时 ${el}s  成功 ${ok} 失败 ${fail}  最近: ${item.id} bpm=${rec.bpm} truth=${item.bpm}`);
    }
  } catch (err) {
    const rec = { id: item.id, set: item.set, err: 'analyze:' + err.message, at: Date.now() };
    fs.appendFileSync(OUTL, JSON.stringify(rec) + '\n', 'utf8');
    fail++;
    console.log(`[${i + 1}/${todo.length}] ${item.id} 分析失败: ${err.message}`);
  }
}
console.log(`完成：${ok} 成功 / ${fail} 失败，总耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
c.close();
process.exit(0);
