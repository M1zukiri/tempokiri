// 创建时间：2026-08-24 00:25:00
/** probe6.mjs — 快捷栏 ± 微调即时生效验证。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const c = await Cdp.connect();
await c.navigate(pathToFileURL(path.resolve('dist/tempokiri-workstation.html')).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(path.resolve('dist/tempokiri-workstation.html')).href);
await c.injectFile(path.resolve('examples/test_track.wav'));
await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
await c.click('#btnSettings');
await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置');
await c.evalJs("document.querySelector('.seg-bpm').value = '120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true})); true");
await sleep(200);
await c.click('#mOk');
await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');
console.log('初始:', await c.evalJs("document.getElementById('qBpmVal').textContent"));
await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"bpm\"][data-d=\"0.01\"]').click()");
await sleep(200);
console.log('+0.01:', await c.evalJs("document.getElementById('qBpmVal').textContent"));
await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"bpm\"][data-d=\"1\"]').click()");
await sleep(200);
console.log('+1:', await c.evalJs("document.getElementById('qBpmVal').textContent"));
await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"offset\"][data-d=\"-0.1\"]').click()");
await sleep(200);
console.log('偏移-0.1:', await c.evalJs("document.getElementById('qOffsetVal').textContent"));
console.log('errs:', JSON.stringify(await c.pageErrs()));
c.close();
process.exit(0);
