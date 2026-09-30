// 创建时间：2026-08-26 16:47:30 (场景B卡点定位)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

async function waveXYOf(ratio) {
  const r = await evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
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
  await evalJs(`(() => {
    const q = document.getElementById('silentQty'); q.value = '${qty}';
    const u = document.getElementById('silentUnit'); u.value = '${unit}';
    const b = document.getElementById('silentBpm'); b.value = '${bpm || ''}';
    const m = document.getElementById('silentMeter'); m.value = '${meter || ''}';
    return true;
  })()`);
  await cdp.click('#btnSilentOk');
  await sleep(250);
}
async function applyGrid120() {
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  await sleep(300);
}

log('navigate');
await cdp.navigate(pathToFileURL(DIST).href);
log('clear');
await evalJs('localStorage.clear()');
log('navigate2');
await cdp.navigate(pathToFileURL(DIST).href);
log('inject');
await cdp.injectFile(WAV);
log('wait ready');
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
log('grid');
await applyGrid120();
log('card');
await addCardAt(1 / 16);
log('silent1');
await addSilentViaUi(2, 'beat', '150', '');
log('silent2');
await addSilentViaUi(2, 'sec', '', '');
log('desc');
const info = await evalJs(`(() => ({
  cards: document.querySelectorAll('.seq-card').length,
  seqText: document.querySelector('#seqList') ? document.querySelector('#seqList').textContent.slice(0, 120) : '',
}))()`);
log('cards=' + JSON.stringify(info));
process.exit(0);
