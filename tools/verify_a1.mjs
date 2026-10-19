// 创建时间：2026-10-19 16:30:00
/**
 * verify_a1.mjs — 批注 a1 无头实测：视频预览宽度可调。
 *
 * 断言：
 *   1. 载入视频后拖拽条可见，初始宽度 260
 *   2. 向左拖 80px → 宽度 340 左右，且 localStorage 持久化
 *   3. 刷新并重新载入视频 → 恢复 340（持久化生效）
 *   4. 极限拖动被夹在 180–640
 *   5. 双击复位 260 并持久化
 *   6. 360px 窄屏下拖拽条隐藏、视频占满宽度
 * 前置：无头 Edge 已以 --remote-debugging-port=9338 启动。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const VIDEO = path.resolve('examples/test_video.mp4');
const URL_ = pathToFileURL(DIST).href;
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const c = await Cdp.connect();

async function bootWithVideo() {
  await c.navigate(URL_);
  await c.evalJs('localStorage.clear()');
  await c.navigate(URL_);
  await c.injectFile(VIDEO);
  await c.waitFor(`(() => { const w = document.getElementById('videoWrap'); const r = document.getElementById('videoResizer'); return w && !w.hidden && r && !r.hidden; })()`, 20000, 'video-ready');
  await sleep(400);
}

const width = () => c.evalJs(`Math.round(document.getElementById('videoWrap').getBoundingClientRect().width)`);

await bootWithVideo();
ok('拖拽条可见', true);
const w0 = await width();
ok('初始宽度为 260', Math.abs(w0 - 260) <= 1, String(w0));

// 向左拖 80px → 视频变宽
let r = await c.center('#videoResizer');
await c.drag(r.x, r.y, r.x - 80, r.y);
await sleep(250);
const w1 = await width();
ok('左拖 80px 后宽度约 340', Math.abs(w1 - 340) <= 5, String(w1));
const saved = await c.evalJs(`JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').videoPaneWidth`);
ok('宽度已持久化', Math.abs(Number(saved) - w1) <= 1, `saved=${saved}`);

// 刷新后恢复
await c.navigate(URL_);
await c.injectFile(VIDEO);
await c.waitFor(`(() => { const w = document.getElementById('videoWrap'); const r = document.getElementById('videoResizer'); return w && !w.hidden && r && !r.hidden; })()`, 20000, 'video-ready-2');
await sleep(400);
const w2 = await width();
ok('刷新后恢复上次宽度', Math.abs(w2 - w1) <= 2, `w1=${w1} w2=${w2}`);

// 极限拖动夹取
r = await c.center('#videoResizer');
await c.drag(r.x, r.y, Math.max(0, r.x - 2000), r.y);
await sleep(250);
const wMax = await width();
ok('向左极限拖动被夹到 640', wMax === 640, String(wMax));
r = await c.center('#videoResizer');
await c.drag(r.x, r.y, r.x + 2000, r.y);
await sleep(250);
const wMin = await width();
ok('向右极限拖动被夹到 180', wMin === 180, String(wMin));

// 双击复位
r = await c.center('#videoResizer');
await c.mouse('dbl', r.x, r.y);
await sleep(250);
const wReset = await width();
const savedReset = await c.evalJs(`JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').videoPaneWidth`);
ok('双击复位到 260 并持久化', wReset === 260 && Number(savedReset) === 260, `w=${wReset} saved=${savedReset}`);

// 窄屏：拖拽条隐藏、视频占满
await c.setViewport(360, 720);
await sleep(400);
const narrow = await c.evalJs(`(() => {
  const r = document.getElementById('videoResizer');
  const w = document.getElementById('videoWrap');
  return JSON.stringify({ resizerDisplay: getComputedStyle(r).display, videoW: Math.round(w.getBoundingClientRect().width), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth });
})()`);
const n = JSON.parse(narrow);
ok('360px 下拖拽条隐藏', n.resizerDisplay === 'none', n.resizerDisplay);
ok('360px 下视频占满可用宽度且无横向溢出', n.videoW > 300 && n.overflow <= 0, narrow);
await c.send('Emulation.clearDeviceMetricsOverride');

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA1 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
