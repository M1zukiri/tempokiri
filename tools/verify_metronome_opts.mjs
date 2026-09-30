// 创建时间：2026-08-26 16:05:12 (节拍器三项优化验证)
/**
 * verify_metronome_opts.mjs — 验证：①按钮 on 变色样式 ②音量 200% ③拼接重复段节拍器修复/seqOn 开关。
 * 前置：无头 Edge 9338（autoplay 策略）+ 已 build。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const url = pathToFileURL(DIST).href;
let fail = 0;
const check = (name, cond, detail) => { const p = !!cond; if (!p) fail++; console.log(`  [${p ? 'PASS' : 'FAIL'}] ${name} = ${String(detail ?? '').slice(0, 120)}`); };

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
async function boot() {
  await cdp.navigate(url);
  await evalJs('localStorage.clear()');
  await cdp.navigate(url);
  await cdp.injectFile(WAV);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
  await sleep(300);
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
async function patchOsc() {
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
}

await boot();
await applyGrid120();

// ---------- ① 按钮变色样式（on 态 accent 背景/边框） ----------
await cdp.click('#btnMtr');
await sleep(200);
const style = await evalJs(`(() => {
  const b = document.getElementById('btnMtr');
  const cs = getComputedStyle(b);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return { on: b.classList.contains('on'), bg: cs.backgroundColor, border: cs.borderColor, accent };
})()`);
check('按钮 on class', style.on, style.on);
check('按钮背景变色为 accent', /rgb\(34, 211, 238\)/.test(style.bg), `${style.bg}（期望 accent #22d3ee）`);
check('按钮边框为 accent', /rgb\(34, 211, 238\)/.test(style.border), style.border);
await cdp.click('#btnMtr'); // 关闭
await sleep(150);

// ---------- ② 音量 200% ----------
await cdp.click('#btnMtrSet');
await sleep(200);
const maxVol = await evalJs("document.getElementById('mtrVol').max");
check('音量滑块 max=200', maxVol === '200', maxVol);
await evalJs("(() => { const v = document.getElementById('mtrVol'); v.value='200'; v.dispatchEvent(new Event('input',{bubbles:true})); true })()");
await cdp.click('#mtrOk');
await sleep(200);
const vol = await evalJs("JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').metronomeVolume");
check('音量持久化 200', vol === 200, String(vol));

// ---------- ③ 拼接重复段：第 2 段（原曲时间回退）节拍器恢复 ----------
await addCardAt(1 / 16); // 第 1 小节 [0,2s]
await addCardAt(1 / 16); // 重复第 1 小节（原曲时间回退场景）
await patchOsc();
await cdp.click('#btnMtr'); // 开启
await sleep(150);
await cdp.click('#btnPlaySeq');
await sleep(6000);
const evts = JSON.parse(await evalJs('JSON.stringify(window.__mtrLog)'));
await cdp.click('#btnStop');
await sleep(300);
const late = evts.filter((t) => t > 2.2); // 第 2 段（mix 2s 之后）
check('拼接重复段第 2 段节拍器恢复（>2.2s 事件）', late.length >= 3, `事件 ${evts.length} 个，第 2 段 ${late.length} 个`);

// ---------- ③b seqOn 关闭 → 拼接不响 ----------
await cdp.click('#btnMtrSet');
await sleep(200);
await evalJs("(() => { const c = document.getElementById('mtrSeqPlay'); c.checked = false; true })()");
await cdp.click('#mtrOk');
await sleep(200);
await patchOsc();
await cdp.click('#btnPlaySeq');
await sleep(2500);
const evts2 = JSON.parse(await evalJs('JSON.stringify(window.__mtrLog)'));
await cdp.click('#btnStop');
check('seqOn=false 拼接播放节拍器静默', evts2.length === 0, `事件 ${evts2.length}`);

// ④ 原曲播放仍响（seqOn 不影响原曲）
await patchOsc();
await cdp.click('#btnPlay');
await sleep(2200);
const evts3 = JSON.parse(await evalJs('JSON.stringify(window.__mtrLog)'));
await cdp.click('#btnStop');
check('seqOn=false 原曲播放仍响', evts3.length >= 3, `事件 ${evts3.length}`);

console.log(fail === 0 ? '\nVERIFY OK' : `\nVERIFY FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
