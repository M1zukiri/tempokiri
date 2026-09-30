// 创建时间：2026-08-26 17:02:30 (死循环触发器二分定位)
// COMBO=1 仅 beat@150 静音段；2 仅 sec 静音段；3 beat@150 + sec
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const COMBO = process.argv[2] || '1';
const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const T = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT: ' + ms)), ms))]);

async function waveXYOf(ratio) {
  const r = await T(evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`), 5000);
  return { x: r.x + ratio * r.w, y: r.y + r.h / 2 };
}
async function addCardAt(ratio) {
  const p = await waveXYOf(ratio);
  await cdp.mouse('dbl', p.x, p.y);
  await sleep(300);
  await cdp.click('#btnAddSelection');
  await sleep(250);
}
async function addSilentViaUi(qty, unit, bpm, meter) {
  await cdp.click('#btnSilentAdd');
  await sleep(200);
  await T(evalJs(`(() => {
    const q = document.getElementById('silentQty'); q.value = '${qty}';
    const u = document.getElementById('silentUnit'); u.value = '${unit}';
    const b = document.getElementById('silentBpm'); b.value = '${bpm || ''}';
    const m = document.getElementById('silentMeter'); m.value = '${meter || ''}';
    return true;
  })()`), 5000);
  await cdp.click('#btnSilentOk');
  await sleep(250);
}
async function applyGrid120() {
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await T(evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true"), 5000);
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  await sleep(300);
}

await cdp.navigate(pathToFileURL(DIST).href);
await evalJs('localStorage.clear()');
await cdp.navigate(pathToFileURL(DIST).href);
await cdp.injectFile(WAV);
await T(cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪'), 25000);
await applyGrid120();
await addCardAt(1 / 16);
if (COMBO === '1' || COMBO === '3') await addSilentViaUi(2, 'beat', '150', '');
if (COMBO === '2' || COMBO === '3') await addSilentViaUi(2, 'sec', '', '');
log('sequence ready, playing...');
await cdp.click('#btnMtr');
await sleep(150);
await cdp.click('#btnPlaySeq');
await sleep(2500);
try {
  const v = await T(evalJs('window.__mtrLog ? JSON.stringify(window.__mtrLog) : "nopatch"'), 4000);
  log('log=' + v);
  log(`COMBO ${COMBO} OK`);
} catch (e) {
  log(`COMBO ${COMBO} HANG: ${e.message}`);
}
process.exit(0);
