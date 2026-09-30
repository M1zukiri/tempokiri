// 创建时间：2026-08-26 19:25:00 (静音radio诊断)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);

await cdp.navigate(pathToFileURL(DIST).href);
await evalJs('localStorage.clear()');
await cdp.navigate(pathToFileURL(DIST).href);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
await cdp.click('#btnSilentAdd');
await sleep(250);
await evalJs(`(() => {
  const s = document.getElementById('silentSec'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true }));
  const q = document.getElementById('silentQtySec'); q.value = '2'; q.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(250);
const state = await evalJs(`(() => ({
  mus: document.getElementById('silentMus').checked,
  sec: document.getElementById('silentSec').checked,
  qty: document.getElementById('silentQty').value,
  qtySec: document.getElementById('silentQtySec').value,
  qtySecDisabled: document.getElementById('silentQtySec').disabled,
  unit: document.getElementById('silentUnit').value,
}))()`);
console.log('确认前状态:', JSON.stringify(state));
await cdp.click('#btnSilentOk');
await sleep(400);
const saved = await evalJs(`(() => {
  const m = JSON.parse(localStorage.getItem('tempokiri.remix.settings.v1') || '{}');
  const k = Object.keys(m)[0];
  const seq = (m[k] && m[k].sequence) || [];
  return { unit: seq[0] && seq[0].unit, dur: seq[0] && seq[0].durationSec, qty: seq[0] && seq[0].qty };
})()`);
console.log('保存:', JSON.stringify(saved));
process.exit(0);
