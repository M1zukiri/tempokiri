// 创建时间：2026-08-24 09:20:00
/** probe18.mjs — tap 增强批量收益模拟：以真值 ±2%/±5% 抖动模拟人耳 tap，统计命中率对比基线。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = JSON.parse(fs.readFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json', 'utf8'));
const SETS = ['batch_review', 'batch_test'];
const items = DB.filter((e) => SETS.includes(e.set) && e.hasAudio);
const jit = (rng) => 1 + (rng() * 2 - 1) * 0.05; // ±5% 抖动
let seed = 42;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

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

  const results = { exact: 0, layer: 0, none: 0 };
  let i = 0;
  for (const item of items) {
    const prevSeq = await c.evalJs('window.__fileSeq');
    await c.injectFile(item.audio);
    await c.waitFor(`window.__fileSeq > ${prevSeq} && document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 30000, item.id + ' 就绪');
    // 模拟 tap：真值 ±5% 抖动 → 范围 [×0.8, ×1.2]（含 2% 小抖动版本）
    const t2 = item.bpm * (1 + (rng() * 2 - 1) * 0.02);
    const t5 = item.bpm * (1 + (rng() * 2 - 1) * 0.05);
    const r = await c.evalJs(`(async () => {
      const d = await MC.decodeAudioFile(window.__lastFile);
      const pcm = MC.resample(d.rawMono, d.sampleRate, 22050);
      const gs = MC.loadGlobalSettings();
      const delta = 1.6 - 0.9 * gs.sensitivity;
      const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
      const run = (tap) => {
        const minBpm = Math.max(40, Math.round(tap * 0.8));
        const maxBpm = Math.min(300, Math.round(tap * 1.2));
        const r = MC.analyze(pcm, { sampleRate: 22050, hop, delta, minBpm, maxBpm });
        return r.bpm;
      };
      return JSON.stringify({ tap2: run(${t2.toFixed(2)}), tap5: run(${t5.toFixed(2)}) });
    })()`);
    const o = JSON.parse(r);
    for (const key of ['tap2', 'tap5']) {
      const v = o[key];
      const d1 = v != null ? Math.abs(v - item.bpm) : Infinity;
      if (d1 <= 0.6) results.exact++;
      else if (d1 <= 2) results.layer++;
      else results.none++;
    }
    i++;
    if (i % 20 === 0) console.log(`[${i}/${items.length}] exact=${results.exact} layer=${results.layer} none=${results.none}`);
  }
  const N = items.length * 2;
  console.log('\n===== tap 模拟（140 首 × 2 档：tap±2% / tap±5%）=====');
  console.log(`精确命中(≤0.6): ${results.exact} (${(results.exact / N * 100).toFixed(1)}%)`);
  console.log(`层正确(≤2.0):  ${results.layer} (${(results.layer / N * 100).toFixed(1)}%)`);
  console.log(`仍未命中:      ${results.none} (${(results.none / N * 100).toFixed(1)}%)`);
  console.log('基线（无 tap，140 首）: 精确 22.9% / 层正确 —');
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
