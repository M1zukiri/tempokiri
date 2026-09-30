// 创建时间：2026-08-24 00:02:00
/** probe4.mjs — 调查自动剪辑无方案场景。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const OUT = path.resolve('tools/e2e_out');

async function main() {
  // 生成 2s 55Hz 近静音 WAV
  const sr = 44100, secs = 2;
  const pcm = new Float32Array(sr * secs);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 55 * i / sr) * 0.001;
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(pcm[i] * 32767), 44 + i * 2);
  const file = path.join(OUT, 'no_beat.wav');
  fs.writeFileSync(file, wav);

  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(file);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
  console.log('状态:', JSON.stringify(await c.evalJs("document.getElementById('statusBar').textContent")));
  console.log('btnAutoCut.disabled:', await c.evalJs("document.getElementById('btnAutoCut').disabled"));
  await c.click('#btnAutoCut');
  await sleep(3000);
  console.log('3s后状态:', JSON.stringify(await c.evalJs("document.getElementById('statusBar').textContent")));
  console.log('overlay:', JSON.stringify(await c.evalJs("(() => { const el = document.getElementById('autoCutOverlay'); return el ? (!el.hidden ? 'visible' : 'hidden') : 'null'; })()")));
  console.log('errs:', JSON.stringify(await c.evalJs("(window.__e2eErr || '')")));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
