// 创建时间：2026-08-26 15:52:33 (节拍器拼接播放诊断)
/**
 * diag_metronome_seq.mjs — 拼接序列播放时记录节拍器发声事件。
 * 前置：无头 Edge 9338（autoplay 策略）。构建两段序列 → 播放拼接 → 统计事件与间隔。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const url = pathToFileURL(DIST).href;

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

await cdp.navigate(url);
await evalJs('localStorage.clear()');
await cdp.navigate(url);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
await sleep(300);

// 网格 120 / 4/4
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
await sleep(300);

// 添加两个片段(第 1、4 小节)
await addCardAt(1 / 16); // 第 1 小节
await addCardAt(5 / 16); // 第 4 小节（8s 处？视 wav 时长）——用时间比例，测试 wav 16s 时 4s≈1/4
const seqInfo = await evalJs(`(() => ({
  playSeqDisabled: document.getElementById('btnPlaySeq').disabled,
  cards: document.querySelectorAll('.seq-card').length,
}))()`);
console.log('序列状态:', JSON.stringify(seqInfo));

// patch 振荡器 + 开启节拍器 + 播放拼接
await evalJs(`(() => {
  window.__mtrLog = [];
  const orig = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const osc = orig.call(this);
    const rec = { t: this.currentTime };
    const oStart = osc.start.bind(osc);
    osc.start = (when) => { rec.t = when === undefined ? this.currentTime : when; window.__mtrLog.push(rec.t); oStart(when); };
    return osc;
  };
  true;
})()`);
await cdp.click('#btnMtr');
await sleep(150);
await cdp.click('#btnPlaySeq');
await sleep(4000);
const log = await evalJs('JSON.stringify(window.__mtrLog)');
const st = await evalJs(`(() => ({
  pauseSeq: document.getElementById('btnPlaySeq').textContent,
  mtrOn: document.getElementById('btnMtr').classList.contains('on'),
}))()`);
await cdp.click('#btnStop');
console.log('状态:', JSON.stringify(st));
const evts = JSON.parse(log);
console.log('拼接播放节拍器事件数:', evts.length);
evts.slice(0, 16).forEach((t, i) => {
  const gap = i === 0 ? '—' : (evts[i] - evts[i - 1]).toFixed(3);
  console.log(`  #${i}  t=${t.toFixed(3)}s  gap=${gap}s`);
});
process.exit(0);
