// 创建时间：2026-09-30 12:45:00
/** diag_mp3_sr.mjs — 校验 decodeAudioFile 是否拿到 MP3 的真实源采样率（而非设备率 48k）。
 * 用法：node tools/diag_mp3_sr.mjs <音频路径> [...]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/diag_mp3_sr.mjs <音频路径> [...]');
  process.exit(1);
}

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => {
  window.__fileSeq = (window.__fileSeq || 0) + 1;
  window.__lastFile = e.target.files && e.target.files[0];
}, { capture: true });
window.__fileSeq = 0; true`);

for (const f of files) {
  const prev = await c.evalJs('window.__fileSeq');
  await c.injectFile(f);
  await c.waitFor(`window.__fileSeq > ${prev} && document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 30000, '就绪');
  const r = await c.evalJs(`(async () => {
    const file = window.__lastFile;
    const buf = await file.arrayBuffer();
    const parsed = { wav: MC.readWavSampleRate(buf), mp3: MC.readMp3SampleRate(buf) };
    const buf2 = await file.arrayBuffer();
    let octxSr = null;
    if (parsed.wav || parsed.mp3) {
      try {
        const o = new OfflineAudioContext(1, 1, parsed.wav || parsed.mp3);
        octxSr = (await o.decodeAudioData(buf2)).sampleRate;
      } catch (e) { octxSr = 'ERR:' + e.message; }
    }
    const buf3 = await file.arrayBuffer();
    const plain = new (window.AudioContext || window.webkitAudioContext)();
    const plainSr = (await plain.decodeAudioData(buf3)).sampleRate; // 修复前行为：设备率
    const d = await MC.decodeAudioFile(file);
    return JSON.stringify({
      parsed, octxSr, plainSr, sr: d.sampleRate, dur: +d.duration.toFixed(2), ch: d.audioBuffer.numberOfChannels,
    });
  })()`);
  const j = JSON.parse(r);
  console.log(`${path.basename(f)}: 源率=${j.parsed.mp3 || j.parsed.wav}  decodeAudioFile=${j.sr} Hz（修复前 AudioContext 会给 ${j.plainSr}）  时长 ${j.dur}s`);
}
c.close();
process.exit(0);
