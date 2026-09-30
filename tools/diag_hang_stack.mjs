// 创建时间：2026-08-26 17:15:30 (挂起态调用栈取证)
/**
 * diag_hang_stack.mjs — 先复现 HANG(beat@150)，再 Debugger.pause 抓当前 JS 调用栈定位死循环。
 * 前置：无头 Edge 9338。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
const log = (s) => console.log(`[+${Date.now() % 100000}] ${s}`);

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
    const q = document.getElementById('silentQty'); q.value = '${qty}';
    const u = document.getElementById('silentUnit'); u.value = '${unit}';
    const b = document.getElementById('silentBpm'); b.value = '${bpm || ''}';
    const m = document.getElementById('silentMeter'); m.value = '${meter || ''}';
    return true;
  })()`);
  await cdp.click('#btnSilentOk');
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

async function main() {
  await cdp.navigate(pathToFileURL(DIST).href);
  await evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.injectFile(WAV);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
  await applyGrid120();
  await addCardAt(1 / 16);
  await addSilentViaUi(2, 'beat', '150', '');
  await cdp.click('#btnMtr');
  await sleep(150);
  await cdp.click('#btnPlaySeq');
  await sleep(2500);

  // 页面应已 HANG：尝试 Debugger.pause + 读栈
  log('try Debugger.enable');
  try {
    await cdp.send('Debugger.enable');
    log('Debugger.enable ok, pause...');
    const paused = cdp.send('Debugger.pause');
    const evt = await Promise.race([
      new Promise((res) => cdp.on('Debugger.paused', (p) => res(p))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('pause timeout')), 8000)),
    ]);
    log('PAUSED, callFrames=' + (evt.callFrames || []).length);
    for (const f of (evt.callFrames || []).slice(0, 12)) {
      log('  at ' + (f.functionName || '(anonymous)') + ' ' + (f.url || '').split('/').pop() + ':' + f.location.lineNumber);
    }
    await cdp.send('Debugger.resume').catch(() => {});
    // 再试恢复后 evaluate
    try {
      const v = await Promise.race([evalJs('1+1'), new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), 4000))]);
      log('post-resume eval: ' + v);
    } catch (e) { log('post-resume eval: ' + e.message); }
  } catch (e) {
    log('stack fetch failed: ' + e.message);
  }
  process.exit(0);
}
main().catch((e) => { log('ERR ' + e.message); process.exit(1); });
