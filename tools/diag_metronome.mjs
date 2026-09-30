// 创建时间：2026-08-26 (节拍器实际间隔诊断)
/**
 * diag_metronome.mjs — 记录节拍器真实发声事件（频率+时间戳），判定拍点间隔。
 * 前置：无头 Edge 9338。patch createOscillator（节拍器独用），播放 6s 后统计间隔。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const url = pathToFileURL(DIST).href;

await cdp.navigate(url);
await evalJs('localStorage.clear()');
await cdp.navigate(url);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
await sleep(300);

// 设置网格 120 / 4/4
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await sleep(300);

// 开启节拍器
await cdp.click('#btnMtr');
await sleep(200);

// patch createOscillator 记录节拍器声音
await evalJs(`(() => {
  window.__mtrLog = [];
  window.__mtrErrs = [];
  window.addEventListener('error', (e) => window.__mtrErrs.push(String(e.message)));
  const orig = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const osc = orig.call(this);
    const rec = { freq: osc.frequency.value, t: this.currentTime };
    const oStart = osc.start.bind(osc);
    osc.start = (when) => { rec.t = when === undefined ? this.currentTime : when; window.__mtrLog.push([rec.freq, rec.t]); oStart(when); };
    return osc;
  };
  true;
})()`);

await cdp.click('#btnPlay');
await sleep(6500);
const log = await evalJs('JSON.stringify(window.__mtrLog)');
const errs = await evalJs('JSON.stringify(window.__mtrErrs)');
const state = await evalJs(`(() => ({
  playingText: document.getElementById('btnPlay').textContent,
  mtrOn: document.getElementById('btnMtr').classList.contains('on'),
  hasMC: typeof MC !== 'undefined' && !!MC.metronome && !!MC.metronome.nextClick,
  ctxState: (function(){ try { return 'none'; } catch(e){ return 'err'; } })(),
  gridBars: (function(){ try { return 'n/a'; } catch(e){ return 'err'; } })(),
}))()`);
await cdp.click('#btnStop');
console.log('页面错误:', errs);
console.log('状态:', JSON.stringify(state));
const evts = JSON.parse(log);
console.log('节拍器发声事件数:', evts.length);
evts.forEach(([freq, t], i) => {
  const gap = i === 0 ? '—' : (evts[i][1] - evts[i - 1][1]).toFixed(3);
  console.log(`  #${i}  freq=${freq}Hz  t=${t.toFixed(3)}s  gap=${gap}s`);
});
if (evts.length >= 4) {
  const gaps = evts.slice(1).map((e, i) => e[1] - evts[i][1]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  console.log(`\n平均间隔: ${avg.toFixed(3)}s（期望 0.5s / 一小节则 2s）`);
}
process.exit(0);
