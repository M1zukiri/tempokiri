// 创建时间：2026-08-26 (节拍器/律动条浏览器冒烟)
/**
 * smoke_metronome.mjs — 节拍器 UI 链路冒烟（无头 Edge + CDP 9338）。
 * 前置：无头 Edge 已启动（remote-debugging-port=9338）。
 * 覆盖：模块挂载 → 载入音频 → 按钮可用 → 无网格提示 → 应用网格 → 开关/持久化 →
 *       设置弹窗/保存 → 播放时调度无 JS 错误 → 停止。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

let cdp = await Cdp.connect();
let fail = 0;

function check(name, cond, detail) {
  const pass = !!cond;
  if (!pass) fail++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} = ${String(detail ?? '').slice(0, 140)}`);
}
async function evalJs(expr) {
  return cdp.evalJs(expr);
}

const url = pathToFileURL(DIST).href;
await cdp.navigate(url);
await evalJs('localStorage.clear()');
await cdp.navigate(url);
await cdp.injectFile(WAV);
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
await sleep(300);

// 1. 模块挂载
check('MC.metronome 挂载', await evalJs("typeof MC !== 'undefined' && !!MC.metronome && !!MC.metronome.nextClick"), 'metronome');
check('MC.metronomeModal 挂载', await evalJs("!!(MC.metronomeModal && MC.metronomeModal.open)"), 'metronomeModal');
check('按钮存在且可用', await evalJs("!!document.getElementById('btnMtr') && !document.getElementById('btnMtr').disabled && !!document.getElementById('btnMtrSet')"), 'btnMtr/btnMtrSet');

// 2. 无网格点击 → 提示
await cdp.click('#btnMtr');
await sleep(200);
const s1 = await evalJs("document.getElementById('statusBar').textContent");
check('无网格提示', s1.includes('先设置节拍网格'), s1);
check('未开启(无 on)', await evalJs("!document.getElementById('btnMtr').classList.contains('on')"), 'class');

// 3. 应用网格 120
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(200);
await cdp.click('#mOk');
await sleep(300);

// 4. 开启节拍器
await cdp.click('#btnMtr');
await sleep(200);
check('开启后按钮 on', await evalJs("document.getElementById('btnMtr').classList.contains('on')"), 'class');
const gs = await evalJs("JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').metronomeOn");
check('持久化 metronomeOn=true', gs === true, String(gs));

// 5. 设置弹窗
await cdp.click('#btnMtrSet');
await sleep(200);
check('设置弹窗可见', await evalJs("(() => { const o = document.getElementById('mtrOverlay'); return o && !o.hidden; })()"), 'mtrOverlay');
const unitHint = await evalJs("(document.querySelector('#mtrUnitNote')||{}).textContent || ''");
check('默认单位提示含 4', unitHint.includes('4'), unitHint);
await evalJs("(() => { const u = document.getElementById('mtrUnit'); u.value='8'; u.dispatchEvent(new Event('change',{bubbles:true})); const v = document.getElementById('mtrVol'); v.value='50'; v.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('mtrTone').value='wood'; true })()");
await cdp.click('#mtrOk');
await sleep(200);
const gs2 = await evalJs("(() => { const g = JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}'); return { u: g.metronomeUnit, v: g.metronomeVolume, t: g.metronomeTone }; })()");
check('设置持久化 8/50/wood', gs2.u === 8 && gs2.v === 50 && gs2.t === 'wood', JSON.stringify(gs2));

// 6. 播放（节拍器调度启动）——收集 window.onerror
await evalJs("window.__smokeErrs = []; window.addEventListener('error', (e) => window.__smokeErrs.push(String(e.message))); true");
await cdp.click('#btnPlay');
await sleep(2500);
check('播放中(playing)', await evalJs("document.getElementById('btnPlay').textContent.includes('⏸') || document.getElementById('btnPlaySeq').textContent.includes('⏸')"), 'playState');
await cdp.click('#btnStop');
await sleep(300);
const errsNow = await evalJs('window.__smokeErrs.join(" | ")');
check('播放/调度无 JS 错误', errsNow === '', errsNow);

console.log(fail === 0 ? '\nSMOKE OK' : `\nSMOKE FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
