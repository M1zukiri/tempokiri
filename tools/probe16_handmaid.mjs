// 创建时间：2026-08-24 07:00:00
/** probe16_handmaid.mjs — 代表性样本内部诊断：主峰/候选分数、onset 间隔分布、2× 提升可行性。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = JSON.parse(fs.readFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json', 'utf8'));
// 代表性样本：x0.5(11622/11313/22)、高BPM拉低(779)、范围外(11809)
const IDS = ['11622', '11313', '22', '779', '11809'];
const items = IDS.map((id) => DB.find((e) => e.id === id)).filter(Boolean);
console.log('样本:', items.map((i) => i.id + '(truth=' + i.bpm + ')').join(' '));

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

  for (const item of items) {
    const prevSeq = await c.evalJs('window.__fileSeq');
    await c.injectFile(item.audio);
    await c.waitFor(`window.__fileSeq > ${prevSeq} && document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 30000, item.id + ' 就绪');
    const r = await c.evalJs(`(async () => {
      const d = await MC.decodeAudioFile(window.__lastFile);
      const pcm = MC.resample(d.rawMono, d.sampleRate, 22050);
      const gs = MC.loadGlobalSettings();
      const delta = 1.6 - 0.9 * gs.sensitivity;
      const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
      const flux = MC.spectralFlux(pcm, { sampleRate: 22050, hop });
      const onsets = MC.detectOnsets(flux, { sampleRate: 22050, hop });
      const res = MC.estimateBpmCands(onsets, { sampleRate: 22050, minBpm: gs.minBpm || 60, maxBpm: gs.maxBpm || 200 });
      // onset 间隔分布（0.05s 桶，top 6）
      const bins = {};
      for (let i = 1; i < onsets.length; i++) {
        const g = onsets[i] - onsets[i - 1];
        if (g <= 0) continue;
        const k = Math.round(g / 0.05) * 0.05;
        bins[k] = (bins[k] || 0) + 1;
      }
      const hist = Object.entries(bins).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + 's:' + v);
      return JSON.stringify({ bpm: res.bpm, cands: res.cands.map((cc) => ({ bpm: cc.bpm, rel: cc.rel, harm: cc.harm })), onsets: onsets.length, hist });
    })()`);
    const o = JSON.parse(r);
    console.log('--- ' + item.id + '  真值=' + item.bpm + '  (first=' + item.first + ')');
    console.log('    主选:', o.bpm, '  onset数:', o.onsets);
    console.log('    候选(rel):', o.cands.map((cc) => cc.bpm + '(' + cc.rel + (cc.harm ? ',' + cc.harm : '') + ')').join(' '));
    console.log('    间隔分布:', o.hist.join(' | '));
    await sleep(300);
  }
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
