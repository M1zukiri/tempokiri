// 创建时间：2026-08-26 20:30:00 (用户 m4a 首段 bars 输入复现)
/**
 * diag_user_m4a.mjs — 复现「导入 m4a 后首段无法输入小节/格」。
 * 流程：载入 → 打开节拍设置(自动识别→确认) → 选段添加 → 展开首段 → 尝试输入小节/格 → 观察回退与 DOM。
 */
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
log('注入 m4a…');
await cdp.injectFile(M4A);
try {
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 30000, '音频就绪');
  log('音频就绪 ✓');
} catch (e) {
  log('就绪超时: ' + e.message);
}
await sleep(500);

// 打开节拍设置 → 识别 → 观察
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 8000, '设置弹窗');
log('设置弹窗打开 ✓');
const pre = await evalJs(`(() => ({
  segs: document.querySelectorAll('#segTbody tr').length,
  status: document.getElementById('mAutoStatus') ? document.getElementById('mAutoStatus').textContent : '',
}))()`);
log('段行数: ' + pre.segs + ' 状态: ' + pre.status);
// 点击识别（若有）
const hasAuto = await evalJs("!!document.querySelector('.seg-auto')");
if (hasAuto) {
  await cdp.click('.seg-auto');
  await sleep(2500);
  const after = await evalJs("document.getElementById('mAutoStatus') ? document.getElementById('mAutoStatus').textContent : ''");
  log('识别后状态: ' + after);
}
// 填写 BPM 120 并确认
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 10000, '网格应用');
log('网格应用 ✓');
// 选段添加（第 1 小节）
const p = await waveXYOf(1 / 16);
await cdp.mouse('dbl', p.x, p.y);
await sleep(300);
await cdp.click('#btnAddSelection');
await sleep(300);
const cards = await evalJs("document.querySelectorAll('.seq-card').length");
log('卡片数: ' + cards);
// 展开首段
await cdp.click('.seq-card .seq-toggle');
await sleep(300);
// 尝试把 bars 起/止小节设为 34/16（用户尝试值）
await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  if (!c) return 'NO-RI';
  const set = (cls, v) => { const i = c.querySelector('.' + cls); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); };
  set('ri-sb', '34'); set('ri-sc', '1'); set('ri-eb', '34'); set('ri-ec', '16');
  return c.outerHTML.replace(/\\s+/g, ' ').slice(0, 400);
})()`);
await sleep(400);
const st = await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  const b = document.querySelector('.seq-card .ri-block-bars');
  return {
    active: b ? b.className : '?',
    sb: (c.querySelector('.ri-sb') || {}).value, sc: (c.querySelector('.ri-sc') || {}).value,
    eb: (c.querySelector('.ri-eb') || {}).value, ec: (c.querySelector('.ri-ec') || {}).value,
    refBars: (c.querySelector('.ri-ref-bars') || {}).textContent,
    refTime: (c.querySelector('.ri-ref-time') || {}).textContent,
    barLen: 0,
  };
})()`);
log('输入后状态: ' + JSON.stringify(st));
const gridInfo = await evalJs(`(() => {
  const m = JSON.parse(localStorage.getItem('tempokiri.remix.settings.v1') || '{}');
  const k = Object.keys(m)[0];
  const s = m[k] || {};
  return { offset: s.offset, segs: (s.segments || []).map(x => ({ bpm: x.bpm, bars: x.bars, dur: x.durationSec })) };
})()`);
log('网格数据: ' + JSON.stringify(gridInfo));
process.exit(0);
