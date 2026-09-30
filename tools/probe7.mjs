// 创建时间：2026-08-24 00:30:00
/** probe7.mjs — 视频拼接播放画面跟随验证（57MB/223s 素材）。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const c = await Cdp.connect();
await c.navigate(pathToFileURL(path.resolve('dist/tempokiri-workstation.html')).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(path.resolve('dist/tempokiri-workstation.html')).href);
const t0 = Date.now();
await c.injectFile(path.resolve('examples/shin_yohou.mp4'));
await c.waitFor("['就绪','已应用','提取失败'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 90000, '大视频就绪');
console.log('导入耗时:', Date.now() - t0, '状态:', await c.evalJs("document.getElementById('statusBar').textContent"));

await c.click('#btnSettings');
await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置');
await c.evalJs("document.querySelector('.seg-bpm').value = '120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true})); true");
await sleep(200);
await c.click('#mOk');
await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');

// 选第一小节（全览比例换算）
const r = await c.evalJs("(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
const dur = await c.evalJs("(document.getElementById('video')||{}).duration || 223");
await c.mouse('dbl', r.x + (1.5 / dur) * r.w, r.y + r.h / 2);
await sleep(300);
console.log('选中:', await c.evalJs("document.getElementById('statusBar').textContent"));
await c.click('#btnAddSelection');
await sleep(300);

console.log('播放前 videoEl:', JSON.stringify(await c.evalJs("(() => { const v = document.getElementById('video'); return {ct: v.currentTime, paused: v.paused}; })()")));
await c.click('#btnPlaySeq');
await sleep(2000);
console.log('播放中 videoEl:', JSON.stringify(await c.evalJs("(() => { const v = document.getElementById('video'); return {ct: +v.currentTime.toFixed(2), paused: v.paused, status: document.getElementById('statusBar').textContent}; })()")));
await c.click('#btnStop');
await sleep(400);
console.log('停止后 videoEl:', JSON.stringify(await c.evalJs("(() => { const v = document.getElementById('video'); return {ct: +v.currentTime.toFixed(2), paused: v.paused, status: document.getElementById('statusBar').textContent}; })()")));
console.log('errs:', JSON.stringify(await c.pageErrs()));
c.close();
process.exit(0);
