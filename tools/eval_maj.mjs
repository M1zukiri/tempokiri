// 创建时间：2026-10-19 15:30:00
/**
 * eval_maj.mjs — 基于 E:/Sync/Majproject（59 首，含 maidata.txt 谱面）的 BPM 实测评估器。
 *
 * 与 eval_adx 的区别：
 *   - 真值来自 maidata.txt 谱面正文的首个 (BPM) 记号（Majdata 谱面声明值），
 *     而非音频文件名/数据库；可变 BPM 谱面单独统计，不混进恒定 BPM 口径。
 *   - 评估对象是**当前 dist 构建**的产品分析链路（MC.analyze），逐首记录候选与八度标记，
 *     便于验证候选列表修正（a3）与规范化（a2）。
 *
 * 用法：
 *   node tools/eval_maj.mjs                 # 全量 59 首
 *   node tools/eval_maj.mjs --n=20 --seed=7 # 抽样
 *   node tools/eval_maj.mjs --filter=const  # 只跑恒定 BPM 谱面
 * 前置：无头 Edge 已以 --remote-debugging-port=9338 启动。
 * 输出：C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/maj/eval_v<VER>_<tag>.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const arg = (k, d) => {
  const m = process.argv.slice(2).find((s) => s.startsWith('--' + k + '='));
  return m ? m.split('=')[1] : d;
};
const DB = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/maj/maj_db.json';
const OUT_DIR = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/maj';
const N = parseInt(arg('n', '0'), 10);
const SEED = parseInt(arg('seed', '42'), 10);
const FILTER = arg('filter', 'all'); // all | const | var
const TAG = arg('tag', 'base');
const DIST = path.resolve('dist/tempokiri-workstation.html');
const VER = (() => { try { return fs.readFileSync(path.resolve('VERSION'), 'utf8').trim(); } catch { return 'dev'; } })();
const OUT = path.join(OUT_DIR, `eval_v${VER}_${TAG}.jsonl`);

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
let items = db.items.filter((e) => e.bpmFirst != null && e.audio);
if (FILTER === 'const') items = items.filter((e) => e.bpmVariants.length <= 1);
if (FILTER === 'var') items = items.filter((e) => e.bpmVariants.length > 1);
items.sort((a, b) => a.id.localeCompare(b.id));
if (N > 0 && N < items.length) {
  let s = SEED >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = new Set();
  while (pick.size < N) pick.add(Math.floor(rnd() * items.length));
  items = [...pick].sort((a, b) => a - b).map((i) => items[i]);
}
console.log(`样本 ${items.length} 首（真值来自 maidata 谱面）→ ${OUT}`);

const PAGE_JS = `(async () => {
  const file = window.__lastFile;
  const d = await MC.decodeAudioFile(file);
  const gs = MC.loadGlobalSettings();
  const delta = 1.6 - 0.9 * gs.sensitivity;
  const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
  const srcSr = d.sampleRate;
  const pcm = d.rawMono;
  // 与产品一致：降采样到 22050（线性）
  const n = Math.max(1, Math.floor(pcm.length * 22050 / srcSr));
  const out22 = new Float32Array(n); const r = srcSr / 22050;
  for (let i = 0; i < n; i++) {
    const pos = i * r; const idx = Math.min(Math.floor(pos), pcm.length - 1); const fr = pos - idx;
    const a = pcm[idx]; const b = idx + 1 < pcm.length ? pcm[idx + 1] : a;
    out22[i] = a + (b - a) * fr;
  }
  const t0 = performance.now();
  const r0 = MC.analyze(out22, { sampleRate: 22050, hop, frameSize: 2048, delta });
  const ms = Math.round(performance.now() - t0);
  return JSON.stringify({
    bpm: r0.bpm, offset: r0.offset,
    promoted: !!r0.octavePromoted, before: r0.bpmBeforeOctave,
    cands: (r0.bpmCandidates || []).map((c) => [c.bpm, c.harm]),
    onsets: r0.onsets ? r0.onsets.length : 0,
    ms,
  });
})()`;

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);

async function hookFile() {
  await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => {
    window.__fileSeq = (window.__fileSeq || 0) + 1;
    window.__lastFile = e.target.files && e.target.files[0];
  }, { capture: true }); window.__fileSeq = 0; localStorage.clear(); true`);
}

let c;
if (!fs.existsSync(OUT) || arg('fresh', '0') === '1') fs.writeFileSync(OUT, '', 'utf8');
const seen = new Set();
for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { const j = JSON.parse(l); if (!j.err) seen.add(j.id); } catch { /* 忽略 */ }
}
const todo = items.filter((e) => !seen.has(e.id));
console.log(`待评估 ${todo.length}（已完成 ${seen.size}）`);

if (todo.length) {
  c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await hookFile();
  const tStart = Date.now();
  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    const prev = await c.evalJs('window.__fileSeq');
    try {
      await c.injectFile(item.audio);
    } catch (e) {
      fs.appendFileSync(OUT, JSON.stringify({ id: item.id, err: 'inject' }) + '\n', 'utf8'); fail++; continue;
    }
    try {
      await c.waitFor(`window.__fileSeq > ${prev} && document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 60000, item.id);
    } catch (e) {
      fs.appendFileSync(OUT, JSON.stringify({ id: item.id, err: 'ready-timeout' }) + '\n', 'utf8'); fail++; continue;
    }
    try {
      let r;
      try { r = await withTimeout(c.evalJs(PAGE_JS), 180000, 'analyze'); }
      catch (te) { await c.navigate(pathToFileURL(DIST).href); await hookFile(); throw te; }
      const rec = Object.assign({ id: item.id, title: item.title, truth: item.bpmFirst, variants: item.bpmVariants }, JSON.parse(r));
      fs.appendFileSync(OUT, JSON.stringify(rec) + '\n', 'utf8');
      ok++;
      if ((i + 1) % 10 === 0 || i === todo.length - 1) {
        console.log(`[${i + 1}/${todo.length}] ${((Date.now() - tStart) / 1000).toFixed(0)}s 成功 ${ok} 失败 ${fail}`);
      }
    } catch (e) {
      fs.appendFileSync(OUT, JSON.stringify({ id: item.id, err: 'analyze:' + e.message }) + '\n', 'utf8'); fail++;
      console.log(`[${i + 1}/${todo.length}] ${item.id} 失败: ${e.message}`);
    }
  }
  console.log(`完成 ${ok} 成功 / ${fail} 失败，${((Date.now() - tStart) / 1000).toFixed(1)}s`);
  c.close();
}
report();
process.exit(0);

function report() {
  const recs = fs.readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && !r.err && r.truth);
  if (!recs.length) { console.log('无有效结果'); return; }
  const consts = recs.filter((r) => (r.variants || []).length <= 1);
  const cls = (b, t) => {
    if (b == null) return 'null';
    const rt = b / t;
    if (Math.abs(rt - 0.5) < 0.02) return 'x0.5';
    if (Math.abs(rt - 2) < 0.02) return 'x2';
    if (Math.abs(rt - 1.5) < 0.02) return 'x1.5';
    if (Math.abs(rt - 0.67) < 0.03) return 'x0.67';
    if (Math.abs(b - t) <= 2) return 'layerOK';
    return 'miss';
  };
  const line = (label, rs) => {
    if (!rs.length) return;
    const hit = (tol) => ((rs.filter((r) => Math.abs(r.bpm - r.truth) <= tol).length / rs.length) * 100).toFixed(1);
    const layer = (rs.filter((r) => cls(r.bpm, r.truth) !== 'miss').length / rs.length * 100).toFixed(1);
    const errs = rs.map((r) => Math.abs(r.bpm - r.truth)).sort((a, b) => a - b);
    const half = rs.filter((r) => cls(r.bpm, r.truth) === 'x0.5').length;
    console.log(`  ${label.padEnd(10)} n=${String(rs.length).padStart(3)}  ≤0.1:${hit(0.1).padStart(5)}%  ≤0.6:${hit(0.6).padStart(5)}%  层正确:${layer.padStart(5)}%  半频:${String(half).padStart(2)}  中位误差:${errs[Math.floor(errs.length / 2)].toFixed(2)}`);
  };
  console.log(`\n===== Majproject 实测（${recs.length} 首，真值=谱面 (BPM)）=====`);
  line('全部', recs);
  line('恒定BPM', consts);
  line('可变BPM', recs.filter((r) => (r.variants || []).length > 1));
  // 八度提升子集：候选是否包含提升前的值（a3 验收）
  const promo = recs.filter((r) => r.promoted);
  if (promo.length) {
    const hasBefore = promo.filter((r) => (r.cands || []).some(([b]) => Math.abs(b - r.before) <= 0.6)).length;
    console.log(`  八度提升 ${promo.length} 首，候选含提升前值 ${hasBefore}/${promo.length}`);
    for (const r of promo) {
      console.log(`    ${r.id}  truth=${r.truth} bpm=${r.bpm} before=${r.before} cands=${JSON.stringify(r.cands)}`);
    }
  }
  const miss = recs.filter((r) => Math.abs(r.bpm - r.truth) > 0.6);
  if (miss.length) {
    console.log(`\n  超出 ≤0.6 的样本（${miss.length}）:`);
    for (const r of miss) console.log(`    ${r.bpm} vs ${r.truth} (${r.variants}) ${r.title} | ${r.id}`);
  }
}
