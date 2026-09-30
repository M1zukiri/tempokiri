// 创建时间：2026-09-30 13:10:00
/** eval_adx.mjs — 基于 E:/Sync/adx-charts（1901 首）的**配对**变体评估器。
 *
 * 设计原则（吸取 M1 教训）：
 *   1. 所有变体在同一页面、同一次解码内计算 → 配对对照，杜绝跨批次/跨版本混淆
 *   2. 真值是谱面声明的整数 BPM，实际音频可能有小数漂移 → 主口径用 ≤0.6，
 *      ≤0.1 仅作参考；同时报层正确与分档统计
 *   3. 默认窗（60–200）与宽窗（40–320）分开报，把"算法能力"和"默认参数限制"分开
 *
 * 用法：
 *   node tools/eval_adx.mjs --n=300 --seed=42 --variants=base,baseRep,interp
 *   node tools/eval_adx.mjs --n=0 --variants=base            # 全量 1901
 * 参数：
 *   --n        抽样数（0=全量，默认 300）
 *   --seed     抽样随机种子（默认 42）
 *   --variants base | baseRep | interp | aa | sr44（逗号分隔，默认 base,baseRep,interp）
 *   --window   default(60–200) | wide(40–320)，默认 default
 *   --dedup    title（按曲名去重，默认）| none（保留 1901 全部，含同曲多谱）
 * 结果：C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/adx/eval_<tag>.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const arg = (k, d) => {
  const m = process.argv.slice(2).find((s) => s.startsWith('--' + k + '='));
  return m ? m.split('=')[1] : d;
};
const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/adx/adx_db.json';
const N = parseInt(arg('n', '300'), 10);
const SEED = parseInt(arg('seed', '42'), 10);
const VARIANTS = arg('variants', 'base,baseRep,interp').split(',');
const WINDOW = arg('window', 'default');
const DEDUP = arg('dedup', 'title');
// 文件名必须带变体标签：否则换变体重跑会被断点续跑逻辑跳过（结果里根本没有新变体字段）
const OUT = `C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/adx/eval_${WINDOW}_n${N}_s${SEED}_${VARIANTS.join('-')}.jsonl`;

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
let items = db.items.filter((e) => e.hasAudio);
if (DEDUP === 'title') {
  const seen = new Set();
  items = items.filter((e) => (seen.has(e.title) ? false : (seen.add(e.title), true)));
}
items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (N > 0 && N < items.length) {
  let s = SEED >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = new Set();
  while (pick.size < N) pick.add(Math.floor(rnd() * items.length));
  items = [...pick].sort((a, b) => a - b).map((i) => items[i]);
}
console.log(`样本 ${items.length} 首  变体 ${VARIANTS.join('/')}  窗 ${WINDOW}  去重 ${DEDUP}`);

const MINBPM = WINDOW === 'wide' ? 40 : 60;
const MAXBPM = WINDOW === 'wide' ? 320 : 200;

const PAGE_JS = `(async () => {
  const file = window.__lastFile;
  const d = await MC.decodeAudioFile(file);
  const gs = MC.loadGlobalSettings();
  const delta = 1.6 - 0.9 * gs.sensitivity;
  const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
  const frame = 2048;
  const minBpm = ${MINBPM}, maxBpm = ${MAXBPM};
  const raw = d.rawMono, srcSr = d.sampleRate;

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
  // 抗混叠（Hann 窗 sinc，多相；与 m1_antialias_neg_result.patch 同算法）
  const aaResample = (pcm, f, t) => {
    if (f === t) return Float32Array.from(pcm);
    const n = Math.max(1, Math.floor(pcm.length * t / f));
    const out = new Float32Array(n); const ratio = f / t; const len = pcm.length;
    if (ratio <= 1 || len <= 64) return lin(pcm, f, t);
    const taps = Math.min(129, Math.max(9, Math.ceil(16 * ratio) | 1));
    const cutoff = t / 2 / f, mid = (taps - 1) / 2, P = 32;
    const bank = new Float64Array(P * taps);
    for (let p = 0; p < P; p++) {
      const dl = p / P; let sum = 0;
      for (let k = 0; k < taps; k++) {
        const x = k - mid - dl;
        const h = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * k / (taps - 1)));
        bank[p * taps + k] = h * w; sum += bank[p * taps + k];
      }
      for (let k = 0; k < taps; k++) bank[p * taps + k] /= sum;
    }
    for (let i = 0; i < n; i++) {
      const pos = i * ratio; const base = Math.floor(pos);
      let ph = Math.round((pos - base) * P); if (ph >= P) ph = P - 1;
      const b = ph * taps; let acc = 0;
      for (let k = 0; k < taps; k++) {
        let j = base - mid + k; if (j < 0) j = 0; else if (j >= len) j = len - 1;
        acc += bank[b + k] * pcm[j];
      }
      out[i] = acc;
    }
    return out;
  };
  // 复刻 detectOnsets（interp=true 时加抛物线亚帧插值）
  const detect = (flux, sr, hopSize, frameSize, interp) => {
    const n = flux.length; if (n < 3) return [];
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) sm[i] = (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(n - 1, i + 1)]) / 3;
    let mean = 0; for (let i = 0; i < n; i++) mean += sm[i]; mean /= n;
    let vs = 0; for (let i = 0; i < n; i++) vs += (sm[i] - mean) ** 2;
    const std = Math.sqrt(vs / n) || 1;
    const nm = new Float32Array(n); for (let i = 0; i < n; i++) nm[i] = (sm[i] - mean) / std;
    const wait = Math.max(1, Math.round(0.08 / (hopSize / sr)));
    const times = []; let last = -Infinity;
    for (let i = 0; i < n; i++) {
      let isMax = true;
      for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
        if (nm[j] > nm[i] || (nm[j] === nm[i] && j !== i)) { isMax = false; break; }
      }
      if (!isMax) continue;
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { s += nm[j]; c++; }
      if (nm[i] < s / c + delta) continue;
      if (i - last < wait) continue;
      last = i;
      let fr = 0;
      if (interp && i > 0 && i < n - 1) {
        const y0 = nm[i - 1], y1 = nm[i], y2 = nm[i + 1];
        const den = y0 - 2 * y1 + y2;
        if (den !== 0) { const v = 0.5 * (y0 - y2) / den; if (isFinite(v) && Math.abs(v) <= 0.5) fr = v; }
      }
      times.push(((i + fr) * hopSize + frameSize / 2) / sr);
    }
    return times;
  };

  const out = {};
  const t0 = performance.now();
  const p22 = lin(raw, srcSr, 22050);
  const tRes = performance.now() - t0;
  if (VARIANTS.has('base')) out.base = MC.analyze(p22, { sampleRate: 22050, hop, frameSize: frame, delta, minBpm, maxBpm }).bpm;
  if (VARIANTS.has('baseRep') || VARIANTS.has('interp')) {
    const t1 = performance.now();
    const flux = MC.spectralFlux(p22, { hop, frameSize: frame });
    const tFlux = performance.now() - t1;
    if (VARIANTS.has('baseRep')) out.baseRep = MC.estimateBpm(detect(flux, 22050, hop, frame, false), { minBpm, maxBpm });
    if (VARIANTS.has('interp')) out.interp = MC.estimateBpm(detect(flux, 22050, hop, frame, true), { minBpm, maxBpm });
    out.__ms = Math.round(tRes + tFlux);
  }
  if (VARIANTS.has('adaptive') || VARIANTS.has('adaptiveKeep')) {
    // M5：条件式自适应上限 —— 仅当主峰触顶（>= maxBpm*0.97）时才以 ×2 上限重扫。
    // 前提：一刀切放宽（40–320）实测更差（层正确 81.7%→67.7%），所以必须条件触发。
    const scan = (minB, maxB) => MC.analyze(p22, { sampleRate: 22050, hop, frameSize: frame, delta, minBpm: minB, maxBpm: maxB });
    const r0 = scan(minBpm, maxBpm);
    const trig = r0.bpm != null && r0.bpm >= maxBpm * 0.97;
    let hi = null;
    if (trig) hi = scan(minBpm, maxBpm * 2).bpm;
    out.adaptive = trig ? hi : r0.bpm;                                            // 触顶一律采用重扫结果
    out.adaptiveKeep = (trig && hi != null && hi > maxBpm * 0.97) ? hi : r0.bpm;   // 仅当确实扫到更高才采用
    out.__trig = trig ? 1 : 0;
  }
  if (VARIANTS.has('alwaysKeep')) {
    // 补充变体：无条件用 ×2 上限扫一次，但**只采用 > 原上限的结果**（否则保留默认窗结果）。
    // 与 adaptive 的区别：不要求主峰触顶——因为真值 242 的曲子主峰会落在 121（窗口内的
    // 次谐波），根本触不到 200 的上限，P3 的触顶条件对它形同虚设。
    const scan2 = (minB, maxB) => MC.analyze(p22, { sampleRate: 22050, hop, frameSize: frame, delta, minBpm: minB, maxBpm: maxB });
    const r0b = scan2(minBpm, maxBpm);
    const r1b = scan2(minBpm, maxBpm * 2);
    out.alwaysKeep = (r1b.bpm != null && r1b.bpm > maxBpm) ? r1b.bpm : r0b.bpm;
    out.__r1 = r1b.bpm;
  }
  if (VARIANTS.has('adaptive300')) {
    // 可上线形式：重扫上限封顶在 300 —— modal.js 的 BPM 校验域是 40–300，
    // 直接取 maxBpm*2（默认 200 → 400）会产出被弹窗拒绝的值。
    const scan3 = (minB, maxB) => MC.analyze(p22, { sampleRate: 22050, hop, frameSize: frame, delta, minBpm: minB, maxBpm: maxB });
    const r0c = scan3(minBpm, maxBpm);
    const trig3 = r0c.bpm != null && r0c.bpm >= maxBpm * 0.97;
    let hi3 = null;
    if (trig3) hi3 = scan3(minBpm, Math.max(maxBpm, Math.min(maxBpm * 2, 300))).bpm;
    out.adaptive300 = trig3 ? hi3 : r0c.bpm;
  }
  if (VARIANTS.has('aa')) out.aa = MC.analyze(aaResample(raw, srcSr, 22050), { sampleRate: 22050, hop, frameSize: frame, delta, minBpm, maxBpm }).bpm;
  if (VARIANTS.has('sr44')) out.sr44 = MC.analyze(lin(raw, srcSr, 44100), { sampleRate: 44100, hop: hop * 2, frameSize: frame * 2, delta, minBpm, maxBpm }).bpm;
  return JSON.stringify(out);
})()`.replace(/VARIANTS\.has\(/g, 'SET.has(');

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);

async function setup(c) {
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs(`localStorage.clear(); document.getElementById('fileInput').addEventListener('change', (e) => {
    window.__fileSeq = (window.__fileSeq || 0) + 1;
    window.__lastFile = e.target.files && e.target.files[0];
  }, { capture: true }); window.__fileSeq = 0; true`);
}

const seen = new Set();
if (fs.existsSync(OUT)) {
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (!j.err) seen.add(j.id); } catch { /* 忽略坏行 */ }
  }
}
const todo = items.filter((e) => !seen.has(e.id));
console.log(`待评估 ${todo.length}（已完成 ${seen.size}）`);

if (todo.length) {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await setup(c);
  await c.evalJs(`window.SET = new Set(${JSON.stringify(VARIANTS)}); true`);
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
      await c.waitFor(`window.__fileSeq > ${prev} && (document.getElementById('statusBar').textContent.indexOf('就绪') !== -1 || document.getElementById('statusBar').textContent.indexOf('已应用') !== -1)`, 30000, item.id);
    } catch (e) {
      fs.appendFileSync(OUT, JSON.stringify({ id: item.id, err: 'ready-timeout' }) + '\n', 'utf8'); fail++; continue;
    }
    try {
      let r;
      try { r = await withTimeout(c.evalJs(PAGE_JS), 120000, 'analyze'); }
      catch (te) { await setup(c).catch(() => {}); await c.evalJs(`window.SET = new Set(${JSON.stringify(VARIANTS)}); true`).catch(() => {}); throw te; }
      const rec = Object.assign({ id: item.id, truth: item.bpm, title: item.title }, JSON.parse(r));
      fs.appendFileSync(OUT, JSON.stringify(rec) + '\n', 'utf8');
      ok++;
      if ((i + 1) % 25 === 0 || i === todo.length - 1) {
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
  const band = (t) => (t <= 120 ? '≤120' : t <= 160 ? '121-160' : t <= 200 ? '161-200' : '>200');
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
  console.log(`\n===== adx-charts 评估（${recs.length} 首，窗 ${MINBPM}–${MAXBPM}）=====`);
  for (const v of VARIANTS) {
    const rs = recs.filter((r) => r[v] != null);
    if (!rs.length) continue;
    const errs = rs.map((r) => Math.abs(r[v] - r.truth)).sort((a, b) => a - b);
    const hit = (tol) => ((rs.filter((r) => Math.abs(r[v] - r.truth) <= tol).length / rs.length) * 100).toFixed(1);
    const layer = (rs.filter((r) => cls(r[v], r.truth) !== 'miss').length / rs.length * 100).toFixed(1);
    const bands = {};
    for (const b of ['≤120', '121-160', '161-200', '>200']) {
      const sub = rs.filter((r) => band(r.truth) === b);
      if (sub.length) bands[b] = ((sub.filter((r) => Math.abs(r[v] - r.truth) <= 0.6).length / sub.length) * 100).toFixed(0) + '%';
    }
    const half = rs.filter((r) => cls(r[v], r.truth) === 'x0.5').length;
    console.log(`  ${v.padEnd(13)} ≤0.1:${hit(0.1).padStart(5)}%  ≤0.6:${hit(0.6).padStart(5)}%  ≤1.0:${hit(1).padStart(5)}%  层正确:${layer.padStart(5)}%  半频:${String(half).padStart(3)}  中位误差:${errs[Math.floor(errs.length / 2)].toFixed(2)}  分档:${JSON.stringify(bands)}`);
  }
  // 自适应变体的触发统计：只看被触发的子集，避免被未触发样本稀释
  const trig = recs.filter((r) => r.__trig === 1);
  if (trig.length && recs[0].adaptive !== undefined) {
    const imp = (k) => trig.filter((r) => Math.abs(r[k] - r.truth) < Math.abs(r.base - r.truth) - 0.05).length;
    const wor = (k) => trig.filter((r) => Math.abs(r[k] - r.truth) > Math.abs(r.base - r.truth) + 0.05).length;
    console.log(`\n  触顶触发 ${trig.length}/${recs.length} 首（其中真值 >200 的 ${trig.filter((r) => r.truth > 200).length} 首）`);
    console.log(`    adaptive     更准 ${imp('adaptive')} / 变差 ${wor('adaptive')}`);
    if (recs[0].adaptiveKeep !== undefined) console.log(`    adaptiveKeep 更准 ${imp('adaptiveKeep')} / 变差 ${wor('adaptiveKeep')}`);
  }
}
