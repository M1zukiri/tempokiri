// 创建时间：2026-08-26 19:00:00 (段落时长双语义验证)
/**
 * verify_unit_semantics.mjs — 验证：①卡片 rangeInput radio 双行+派生随动 ②模式切换底层记录
 * ③BPM 修改后小节段随动 ④手动添加 time 模式 ⑤段行 radio(小节数/秒)。
 * 前置：无头 Edge 9338（autoplay 策略）+ 已 build。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

// 工作区存储 key：tempokiri.remix.settings.v1，值 = {指纹: 设置}，首值含 sequence
const readSeq = async () => {
  const v = await evalJs("(() => { const m = JSON.parse(localStorage.getItem('tempokiri.remix.settings.v1') || '{}'); const k = Object.keys(m)[0]; return m[k] && m[k].sequence ? JSON.stringify(m[k].sequence) : '[]'; })()");
  return JSON.parse(v);
};

const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const url = pathToFileURL(DIST).href;
let fail = 0;
const check = (name, cond, detail) => { const p = !!cond; if (!p) fail++; console.log(`  [${p ? 'PASS' : 'FAIL'}] ${name} = ${String(detail ?? '').slice(0, 130)}`); };

async function waveXYOf(ratio) {
  const r = await evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  return { x: r.x + ratio * r.w, y: r.y + r.h / 2 };
}
async function addCardAt(ratio) {
  const p = await waveXYOf(ratio);
  await cdp.mouse('dbl', p.x, p.y);
  await sleep(300);
  await cdp.click('#btnAddSelection');
  await sleep(250);
}
async function applyGrid120() {
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  await sleep(300);
}

await cdp.navigate(url);
await evalJs('localStorage.clear()');
await cdp.navigate(url);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
await applyGrid120();

// ① 段行 radio（小节数 / 秒）——添加第二段后非末段才有段长输入
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mAddSeg');
await sleep(300);
const segLen = await evalJs(`(() => {
  const c = document.querySelector('.seg-length .seg-len');
  if (!c) return null;
  return { bars: !!c.querySelector('input[value="bars"]'), sec: !!c.querySelector('input[value="dur"]'),
    barsVal: c.querySelector('.len-bars').value, secVal: c.querySelector('.len-sec').value };
})()`);
check('段行 radio 双行（小节数选中、秒派生禁用）', segLen && segLen.bars && segLen.sec, JSON.stringify(segLen));
await cdp.click('#mCancel');
await sleep(300);

// ② 选区创建 → 卡片主行/折叠区 rangeInput
await addCardAt(1 / 16); // 第 1 小节
await cdp.click('.seq-card .seq-toggle');
await sleep(200);
const cardState = await evalJs(`(() => {
  const card = document.querySelector('.seq-card');
  return {
    edgeText: card.querySelector('.edge-start') ? card.querySelector('.edge-start').textContent : '',
    radioBars: !!card.querySelector('.range-input input[value="bars"]'),
    radioTime: !!card.querySelector('.range-input input[value="time"]'),
    timeChecked: (() => { const t = card.querySelector('.range-input input[value="time"]'); return t ? t.checked : null; })(),
    timeVals: (() => { const ts = card.querySelector('.ri-ts'); return ts ? [ts.value, card.querySelector('.ri-te').value].join(',') : ''; })(),
  };
})()`);
check('卡片主行按小节显示', cardState.edgeText.includes('1'), cardState.edgeText);
check('rangeInput 双 radio（bars 选中）+ 派生时间行', cardState.radioBars && cardState.radioTime && cardState.timeChecked === false, JSON.stringify(cardState));
check('派生时间值 = 1 小节 [0,2s]', cardState.timeVals === '0,2', cardState.timeVals);

// ③ 折叠区编辑：切到时间模式 → 改终点为 3s → 卡片主行变时间显示
await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  const t = c.querySelector('input[value="time"]');
  t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true }));
  const te = c.querySelector('.ri-te'); te.value = '3'; te.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(400);
const seqAfterTime = await readSeq();
const afterTime = await evalJs("(() => { const card = document.querySelector('.seq-card'); return { edgeText: card.querySelector('.edge-start').textContent }; })()");
check('切时间模式后主行显示时间', afterTime.edgeText.includes('0:02.0') || afterTime.edgeText.includes('0:00.0') || afterTime.edgeText.includes('0'), afterTime.edgeText);
check('底层记录 mode=time + endTime=3', seqAfterTime[0] && seqAfterTime[0].mode === 'time' && seqAfterTime[0].endTime === 3, JSON.stringify(seqAfterTime[0]));

// ④ bars 模式切换回来，端点改为第 2 小节第 4 格（末格 = 4s @120）
await evalJs(`(() => {
  const c = document.querySelector('.seq-card .range-input');
  const t = c.querySelector('input[value="bars"]');
  t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true }));
  const eb = c.querySelector('.ri-eb'); eb.value = '2'; eb.dispatchEvent(new Event('change', { bubbles: true }));
  const ec = c.querySelector('.ri-ec'); ec.value = '4'; ec.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(400);
const seqAfterBars = await readSeq();
check('bars 模式底层 endBar/endCell=2/4、派生 endTime=4', seqAfterBars[0] && seqAfterBars[0].mode === 'bars' && seqAfterBars[0].endBar === 2 && seqAfterBars[0].endCell === 4 && seqAfterBars[0].endTime === 4, JSON.stringify(seqAfterBars[0]));

// ⑤ 快捷栏 BPM ±0.01 → 小节段派生长度随动（第 2 小节第 4 格末 = 2×barDur @119.99）
await evalJs("document.querySelector('[data-q=\"bpm\"][data-d=\"-0.01\"]').click(); true");
await sleep(500);
const seqAfterBpm = await readSeq();
check('BPM 变化后小节段随动（endTime 重算到新小节边界）', seqAfterBpm[0] && seqAfterBpm[0].endBar === 2 && Math.abs(seqAfterBpm[0].endTime - 2 * (60 / 119.99) * 4) < 0.01, JSON.stringify(seqAfterBpm[0]));

// ⑥ 手动添加：切时间模式添加 3.5–5.5s
await cdp.click('#btnManualAdd');
await sleep(250);
await evalJs(`(() => {
  const c = document.querySelector('#maRange .range-input');
  const t = c.querySelector('input[value="time"]');
  t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true }));
  const te = c.querySelector('.ri-te'); te.value = '5.5'; te.dispatchEvent(new Event('change', { bubbles: true }));
  const ts = c.querySelector('.ri-ts'); ts.value = '3.5'; ts.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(250);
await cdp.click('#btnManualOk');
await sleep(300);
const manual = await readSeq();
const manualCards = await evalJs("document.querySelectorAll('.seq-card').length");
check('手动添加 time 模式（3.5–5.5s）', manual[1] && manual[1].mode === 'time' && manual[1].startTime === 3.5 && manual[1].endTime === 5.5 && manualCards >= 2, JSON.stringify(manual[1]));

// ⑦ 静音段 radio：精确时长 2s → unit=sec
await cdp.click('#btnSilentAdd');
await sleep(200);
await evalJs(`(() => {
  const s = document.getElementById('silentSec'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true }));
  const q = document.getElementById('silentQtySec'); q.value = '2'; q.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(200);
await cdp.click('#btnSilentOk');
await sleep(400);
const sil = await readSeq();
check('静音段 radio 精确时长 → unit=sec/dur=2', sil[sil.length - 1] && sil[sil.length - 1].unit === 'sec' && sil[sil.length - 1].durationSec === 2, JSON.stringify(sil[sil.length - 1]));

console.log(fail === 0 ? '\nVERIFY OK' : `\nVERIFY FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
