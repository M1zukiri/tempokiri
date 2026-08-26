// 创建时间：2026-08-24 11:00:00
/** probe20.mjs — tap 搜索窗口宽度扫描：batch1 抽样 × {±10%,±12%,±15%,±20%} 定档。
 * 与 probe19 相同池：seed=20260824 随机 100 首；tap = 真值×(1±5% 均匀)，判定 |误差|≤0.1。
 * 用法：node tools/probe20.mjs [N]（默认 40 首，快扫；传 100 全量）。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = JSON.parse(fs.readFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json', 'utf8'));
const N = Math.min(100, parseInt(process.argv[2] || '40', 10));
const SEED = 20260824;
const WINDOWS = [0.1, 0.12, 0.15, 0.2];
let seed = SEED;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const pool = DB.filter((e) => e.set === 'batch1' && e.hasAudio);
const items = [];
const used = new Set();
while (items.length < N && used.size < pool.length) {
  const idx = Math.floor(rng() * pool.length);
  const e = pool[idx];
  if (!used.has(e.id)) { used.add(e.id); items.push(e); }
}
console.log(`扫描: batch1 ${items.length} 首（seed=${SEED}）× 窗口 ${WINDOWS.map((w) => '±' + Math.round(w * 100) + '%').join('/')}`);

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
    const tapDev = (rng() * 2 - 1) * 0.05;
    const tap = item.bpm * (1 + tapDev);
    const r = await c.evalJs(`(async () => {
      const d = await MC.decodeAudioFile(window.__lastFile);
      const pcm = MC.resample(d.rawMono, d.sampleRate, 22050);
      const gs = MC.loadGlobalSettings();
      const delta = 1.6 - 0.9 * gs.sensitivity;
      const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
      const tap = ${tap.toFixed(3)};
      const winds = ${JSON.stringify(WINDOWS)};
      const out = {};
      for (const w of winds) {
        const minBpm = Math.max(40, Math.round(tap * (1 - w)));
        const maxBpm = Math.min(300, Math.round(tap * (1 + w)));
        const r = MC.analyze(pcm, { sampleRate: 22050, hop, delta, minBpm, maxBpm });
        out['w' + Math.round(w * 100)] = r.bpm;
      }
      return JSON.stringify(out);
    })()`);
    const o = JSON.parse(r);
    rows.push({ id: item.id, truth: item.bpm, tap: +tap.toFixed(1), tapDev: +(tapDev * 100).toFixed(1), algs: o });
    if ((i + 1) % 10 === 0) console.log(`  [${i + 1}/${items.length}]`);
  }

  console.log('\n===== 窗口宽度 vs 准确率（|误差| ≤ 0.1 判定）=====');
  for (const w of WINDOWS) {
    const key = 'w' + Math.round(w * 100);
    const exact = rows.filter((x) => Math.abs(x.algs[key] - x.truth) <= 0.1).length;
    const near = rows.filter((x) => Math.abs(x.algs[key] - x.truth) > 0.1 && Math.abs(x.algs[key] - x.truth) <= 0.6).length;
    const bad = rows.filter((x) => Math.abs(x.algs[key] - x.truth) > 2).length;
    console.log(`±${Math.round(w * 100)}%: ≤0.1 = ${exact} (${(exact / items.length * 100).toFixed(1)}%) ｜ (0.1,0.6] ${near} ｜ >2 ${bad}`);
  }
  // 差异样本
  console.log('\n各窗口结果不同且误差 >0.1 的样本：');
  for (const x of rows) {
    const vals = WINDOWS.map((w) => ({ w: Math.round(w * 100), alg: x.algs['w' + Math.round(w * 100)], err: +(Math.abs(x.algs['w' + Math.round(w * 100)] - x.truth)).toFixed(1) }));
    const best = Math.min(...vals.map((v) => v.err));
    const worst = Math.max(...vals.map((v) => v.err));
    if (best <= 0.1 && worst > 0.1) {
      console.log(`  ${x.id} truth=${x.truth} tap=${x.tap}(${x.tapDev > 0 ? '+' : ''}${x.tapDev}%) → ${vals.map((v) => v.w + '%:' + v.alg + 'e' + v.err).join(' | ')}`);
    }
  }
  fs.writeFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/probe20_window_scan.json', JSON.stringify({ n: items.length, windows: WINDOWS, rows }, null, 1), 'utf8');
  console.log('\n写入 eval/handmaid/probe20_window_scan.json');
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
