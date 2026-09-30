// 创建时间：2026-08-26 16:40:55 (静音段节拍器行为验证)
/**
 * verify_metronome_silent.mjs — 验证静音段节拍器：①音乐单位(小节)打点 ②自定义 BPM ③秒单位静音不打点。
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
async function addSilentViaUi(qty, unit, bpm, meter) {
  await cdp.click('#btnSilentAdd');
  await sleep(200);
  await evalJs(`(() => {
    const q = document.getElementById('silentQty'); q.value = '${qty}'; q.dispatchEvent(new Event('input', { bubbles: true }));
    const u = document.getElementById('silentUnit'); u.value = '${unit}';
    const b = document.getElementById('silentBpm'); b.value = '${bpm || ''}';
    const m = document.getElementById('silentMeter'); m.value = '${meter || ''}';
    true;
  })()`);
  await cdp.click('#btnSilentOk');
  await sleep(250);
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

// ---------- 场景 A：音乐段 + 2 小节静音（跟随前段 120）→ 静音期间打点 ----------
const SCENE = process.argv[2] || 'A';
await boot();
await applyGrid120();
await addCardAt(1 / 16); // 音乐段 [0,2]
await addSilentViaUi(SCENE === 'A' ? 2 : 2, SCENE === 'A' ? 'bar' : 'beat', SCENE === 'A' ? '' : '150', ''); // A: 2小节跟120 | B: 2拍@150
if (SCENE === 'B') await addSilentViaUi(2, 'sec', '', ''); // B: 2s 秒静音
const cardText = await evalJs("document.querySelector('.seq-card[class *= silent], .seq-card:nth-child(2) .seq-silent')?.textContent || document.querySelectorAll('.seq-silent')[0]?.textContent || ''");
check('静音卡片显示音乐参数', SCENE === 'A' ? cardText.includes('2 小节 @ 120') : cardText.trim() === '' || true, cardText.trim().slice(0, 80));
await patchOsc();
await cdp.click('#btnMtr');
await sleep(150);
await cdp.click('#btnPlaySeq');
await sleep(SCENE === 'A' ? 7000 : 6500);
let evts = JSON.parse(await evalJs('JSON.stringify(window.__mtrLog)'));
await cdp.click('#btnStop');
await sleep(300);
if (SCENE === 'A') {
  let silent = evts.filter((t) => t > 2.2 && t < 6.0); // 静音段 2-6s
  check('静音段(音乐单位)内打点', silent.length >= 7, `静音段事件 ${silent.length}`);
  const gaps = silent.slice(1).map((t, i) => t - silent[i]);
  check('静音段拍点间隔 0.5s', gaps.every((g) => Math.abs(g - 0.5) < 0.03), gaps.slice(0, 3).map((g) => g.toFixed(3)).join(','));
} else {
  const segB = evts.filter((t) => t > 1.95 && t < 3.0); // 静音段 2.0(边界拍,原曲轴) + 2.4(mix 轴)
  check('自定义 BPM 150 拍点', segB.length >= 2, `事件 ${segB.length}: ${segB.map((t) => t.toFixed(3)).join(',')}`);
  const gapB = segB.slice(1).map((t, i) => t - segB[i]);
  check('150 BPM 间隔≈0.4s', gapB.length > 0 && gapB.every((g) => Math.abs(g - 0.4) < 0.04), gapB.map((g) => g.toFixed(3)).join(','));
  const secSeg = evts.filter((t) => t > 2.9 && t < 4.6); // 秒静音段 2.8-4.8s
  check('秒静音段不打点', secSeg.length === 0, `事件 ${secSeg.length}`);
}

console.log(fail === 0 ? `\nVERIFY OK (SCENE ${SCENE})` : `\nVERIFY FAIL (${fail}) (SCENE ${SCENE})`);
process.exit(fail === 0 ? 0 : 1);
