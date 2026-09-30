// 创建时间：2026-08-26 20:45:00 (真实识别结果 + 负 offset 复现)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const M4A = `C:\\Users\\M1zukuro\\Desktop\\Sync\\Majproject\\制作中\\doppelganger\\二重身 ⧸ 日暮翠(cv.异世界情绪)＆日暮红(cv.宮崎 恵里花) Character Covers [BV1MRKP6CEXc].m4a`;
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const log = (s) => console.log(s);

async function waveXYOf(ratio) {
  const r = await evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  return { x: r.x + ratio * r.w, y: r.y + r.h / 2 };
}

await cdp.navigate(pathToFileURL(DIST).href);
await evalJs('localStorage.clear()');
await cdp.navigate(pathToFileURL(DIST).href);
await cdp.injectFile(M4A);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 30000, '音频就绪');
await sleep(600);
const dur = await evalJs("window.MC && MC.duration ? 'mc' : (document.querySelector('#statusBar') ? document.getElementById('statusBar').textContent : '?')");
log('状态: ' + dur);
// 规模信息通过波形时间轴刻度读取(0:15.0 表示时长)
const axis = await evalJs("(() => { const t = Array.from(document.querySelectorAll('canvas')).map(c => c.width); return t; })()");

// 识别 → 确认（保留识别结果）
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 8000, '设置弹窗');
await cdp.click('.seg-auto');
await sleep(4000);
const st = await evalJs("document.getElementById('mAutoStatus') ? document.getElementById('mAutoStatus').textContent : ''");
log('识别: ' + st);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 10000, '网格应用');
const qb = await evalJs("document.getElementById('qBpmVal').textContent + ' / ' + document.getElementById('qOffsetVal').textContent");
log('网格应用后 BPM/offset: ' + qb);
// 加段（第 1 小节，双击 网格第一小节位置——offset 4.342s 起）
// 双击波形 0.25 处
const p = await waveXYOf(0.25);
await cdp.mouse('dbl', p.x, p.y);
await sleep(300);
await cdp.click('#btnAddSelection');
await sleep(300);
const cards = await evalJs("document.querySelectorAll('.seq-card').length");
log('卡片数: ' + cards);
await cdp.click('.seq-card .seq-toggle');
await sleep(300);
const info = await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  const b = c ? c.querySelector('.ri-block-bars') : null;
  return {
    activeBars: b ? b.className : '?',
    sb: c && (c.querySelector('.ri-sb') || {}).value, sc: c && (c.querySelector('.ri-sc') || {}).value,
    eb: c && (c.querySelector('.ri-eb') || {}).value, ec: c && (c.querySelector('.ri-ec') || {}).value,
    refBars: c && (c.querySelector('.ri-ref-bars') || {}).textContent,
    refTime: c && (c.querySelector('.ri-ref-time') || {}).textContent,
  };
})()`);
log('首段初始: ' + JSON.stringify(info));
// 尝试输入 34/16
await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  const set = (cls, v) => { const i = c.querySelector('.' + cls); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); };
  set('ri-sb', '34'); set('ri-sc', '1'); set('ri-eb', '34'); set('ri-ec', '16');
  return true;
})()`);
await sleep(400);
const after = await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  return {
    sb: (c.querySelector('.ri-sb') || {}).value, sc: (c.querySelector('.ri-sc') || {}).value,
    eb: (c.querySelector('.ri-eb') || {}).value, ec: (c.querySelector('.ri-ec') || {}).value,
    refBars: (c.querySelector('.ri-ref-bars') || {}).textContent,
    refTime: (c.querySelector('.ri-ref-time') || {}).textContent,
  };
})()`);
log('输入 34/16 后: ' + JSON.stringify(after));
// 负 offset 实验:快捷栏 -1（BPM 不变，只 offset）
const offBefore = await evalJs("document.getElementById('qOffsetVal').textContent");
await evalJs("document.querySelector('[data-q=\"offset\"][data-d=\"-1\"]').click(); true");
await sleep(600);
const offAfter = await evalJs("document.getElementById('qOffsetVal').textContent");
log('offset: ' + offBefore + ' → ' + offAfter);
const after2 = await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  return {
    sb: (c.querySelector('.ri-sb') || {}).value,
    refBars: (c.querySelector('.ri-ref-bars') || {}).textContent,
    refTime: (c.querySelector('.ri-ref-time') || {}).textContent,
    timeActive: !!c.querySelector('.ri-block-time.ri-active'),
  };
})()`);
log('负 offset 后卡片: ' + JSON.stringify(after2));
process.exit(0);
