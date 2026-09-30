// 创建时间：2026-08-26 21:35:00 (setValue 最小复现)
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
const test = await evalJs(`(() => {
  const host = document.createElement('span');
  document.body.appendChild(host);
  const c = MC.rangeInput.create(host, {
    getGrid: () => window.__testGrid || null,
    value: { mode: 'bars', startBar: 1, startCell: 1, endBar: 1, endCell: 1, startTime: 0, endTime: 2 },
  });
  const spec = c.getSpec();
  return { spec, barsActive: host.querySelector('.ri-block-bars').className };
})()`);
log('minitest: ' + JSON.stringify(test));
// 再看 manual 表单里到底有几个组件
const dup = await evalJs("(() => { const r = document.querySelector('#maRange'); return { kids: r.children.length, html: r.innerHTML.slice(0, 300) }; })()");
log('maRange: ' + JSON.stringify(dup));
process.exit(0);
