// 创建时间：2026-08-26 21:20:00 (手动表单负时间时序诊断)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const log = (s) => console.log(s);

await cdp.navigate(pathToFileURL(DIST).href);
await evalJs('localStorage.clear()');
await cdp.navigate(pathToFileURL(DIST).href);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='-1'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
await cdp.click('#btnManualAdd');
await sleep(250); // 展开
const dump = async (tag) => {
  const d = await evalJs(`(() => {
    const c = document.querySelector('#maRange .range-input');
    const spec = null;
    return {
      ts: (c.querySelector('.ri-ts') || {}).value, te: (c.querySelector('.ri-te') || {}).value,
      sb: (c.querySelector('.ri-sb') || {}).value, eb: (c.querySelector('.ri-eb') || {}).value,
      barsRef: (c.querySelector('.ri-ref-bars') || {}).textContent, timeRef: (c.querySelector('.ri-ref-time') || {}).textContent,
      timeActive: c.querySelector('.ri-block-time').className,
    };
  })()`);
  log(tag + ': ' + JSON.stringify(d));
};
await dump('展开后');
// 步骤 1: 切 time radio
await evalJs(`(() => { const c = document.querySelector('#maRange .range-input'); const t = c.querySelector('input[value="time"]'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(200);
await dump('切 time 后');
// 步骤 2: 改 ts=-0.5
await evalJs(`(() => { const c = document.querySelector('#maRange .range-input'); const ts = c.querySelector('.ri-ts'); ts.value = '-0.5'; ts.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(200);
await dump('ts=-0.5 后');
// 步骤 3: 改 te=3.5
await evalJs(`(() => { const c = document.querySelector('#maRange .range-input'); const te = c.querySelector('.ri-te'); te.value = '3.5'; te.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(200);
await dump('te=3.5 后');
process.exit(0);
