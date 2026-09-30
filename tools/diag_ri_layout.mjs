// 创建时间：2026-08-26 20:00:00 (rangeInput 布局截图验证)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);

async function waveXYOf(ratio) {
  const r = await evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  return { x: r.x + ratio * r.w, y: r.y + r.h / 2 };
}

await cdp.navigate(pathToFileURL(DIST).href);
await evalJs('localStorage.clear()');
await cdp.navigate(pathToFileURL(DIST).href);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
// 网格 120
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
await sleep(200);
// 添加 2 段
for (const r of [1 / 16, 9 / 16]) {
  const p = await waveXYOf(r);
  await cdp.mouse('dbl', p.x, p.y);
  await sleep(250);
  await cdp.click('#btnAddSelection');
  await sleep(250);
}
// 展开第 1 张卡片
await cdp.click('.seq-card .seq-toggle');
await sleep(300);
// 切换选中 → 时间模式（截图第二态）
await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  const t = c.querySelector('input[value="time"]');
  t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(300);
const info = await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  return {
    html: c ? c.outerHTML.replace(/\\s+/g, ' ').slice(0, 900) : 'NO-RI',
  };
})()`);
console.log('rangeInput DOM:', info.html);
await cdp.screenshot('tools/diag_ri_layout.png');
console.log('screenshot saved');
process.exit(0);
