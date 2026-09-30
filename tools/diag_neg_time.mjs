// 创建时间：2026-08-26 21:10:00 (负时间浏览器验证)
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
// 网格 offset=-1（负偏移）
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='-1'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
// 手动添加：time 模式输入负起点 -0.5 → 3.5（网格内负时间）
await cdp.click('#btnManualAdd');
await sleep(250);
await evalJs(`(() => {
  const c = document.querySelector('#maRange .range-input');
  const t = c.querySelector('input[value="time"]');
  t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true }));
  const ts = c.querySelector('.ri-ts'); ts.value = '-0.5'; ts.dispatchEvent(new Event('change', { bubbles: true }));
  const te = c.querySelector('.ri-te'); te.value = '3.5'; te.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(300);
// 此时（时间选中）小节行 ref 应显示第 1 小节第 2 格起（负时间派生成功）
const ref = await evalJs(`(() => {
  const c = document.querySelector('#maRange .range-input');
  return { barsRef: (c.querySelector('.ri-ref-bars') || {}).textContent, timeRef: (c.querySelector('.ri-ref-time') || {}).textContent };
})()`);
log('负时间派生: ' + JSON.stringify(ref));
await cdp.click('#btnManualOk');
await sleep(400);
const saved = await evalJs(`(() => {
  const m = JSON.parse(localStorage.getItem('tempokiri.remix.settings.v1') || '{}');
  const k = Object.keys(m)[0];
  const it = (m[k] && m[k].sequence && m[k].sequence[0]) || {};
  return { mode: it.mode, s: it.startTime, e: it.endTime, bar: it.startBar, cell: it.startCell };
})()`);
log('保存: ' + JSON.stringify(saved));
process.exit(0);
