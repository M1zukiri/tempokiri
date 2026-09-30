// 创建时间：2026-08-24 04:00:00
/** probe13.mjs — 引擎级诊断：hop 512 vs 256 的 onset/BPM 差异（目标音频）。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const M4A = 'C:/Users/M1zukuro/Desktop/Sync/Majproject/制作中/doppelganger/二重身 ⧸ 日暮翠(cv.异世界情绪)＆日暮红(cv.宮崎 恵里花) Character Covers [BV1MRKP6CEXc].m4a';

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  // 捕获阶段保存 File 引用（change 处理后 files 会被清空）
  await c.evalJs("document.getElementById('fileInput').addEventListener('change', (e) => { window.__lastFile = e.target.files && e.target.files[0]; }, { capture: true }); true");
  await c.injectFile(M4A);
  await c.waitFor("['就绪','已应用'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 60000, '就绪');

  // 页面内：用保存的 File 重新解码 → 分析 pcm（22050）
  const base = await c.evalJs(`(async () => {
    const file = window.__lastFile;
    if (!file) return JSON.stringify({ err: '无 File 引用' });
    const r = await MC.decodeAudioFile(file);
    const pcm = MC.resample(r.rawMono, r.sampleRate, 22050);
    return JSON.stringify({ len: pcm.length, dur: (pcm.length / 22050).toFixed(1), sr: r.sampleRate });
  })()`);
  console.log('PCM:', base);

  for (const hop of [512, 256, 1024]) {
    const r = await c.evalJs(`(async () => {
      const file = window.__lastFile;
      const d = await MC.decodeAudioFile(file);
      const pcm = MC.resample(d.rawMono, d.sampleRate, 22050);
      const SR = 22050;
      const hop = ${hop};
      const flux = MC.spectralFlux(pcm, { sampleRate: SR, hop });
      const onsets = MC.detectOnsets(flux, { sampleRate: SR, hop });
      let bpm = null, offset = null;
      if (onsets && onsets.length > 2) {
        bpm = MC.estimateBpm(onsets, { sampleRate: SR, minBpm: 40, maxBpm: 300 });
        offset = MC.estimateOffset(onsets, bpm, { sampleRate: SR });
      }
      return JSON.stringify({ hop, flux: flux ? flux.length : -1, onsets: onsets ? onsets.length : -1, bpm: bpm ? +bpm.toFixed(2) : null, offset: offset != null ? +offset.toFixed(3) : null });
    })()`);
    console.log(r);
  }

  console.log('errs:', JSON.stringify(await c.pageErrs()));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
