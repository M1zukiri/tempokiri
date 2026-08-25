// 创建时间：2026-08-24 03:00:00
/** probe11.mjs — BPM 显示/存储 2 位小数上限验证（手动输入规范化、快捷栏微调、识别回填）。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const R = {};
async function tryRec(name, fn) {
  try { const v = await fn(); R[name] = v; console.log('  [OK]   ' + name + ' = ' + clip(JSON.stringify(v))); }
  catch (e) { R[name] = 'FAIL: ' + e.message; console.log('  [FAIL] ' + name + ' = ' + e.message); }
}

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(WAV);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');

  // 1) 手动输入 120.123 → change 规范化 120.12 并回写输入框
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await c.evalJs("document.querySelector('.seg-bpm').value = '120.123'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(300);
  await tryRec('输入120.123后-输入框回写', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  // 2) 确认 → 快捷栏显示
  await c.evalJs("document.getElementById('mOffset').value = '0'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(200);
  await c.click('#mOk');
  await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');
  await tryRec('确认后-快捷栏BPM', () => c.evalJs("document.getElementById('qBpmVal').textContent"));
  // 3) 重开设置弹窗 → 输入框仍 120.12
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗2');
  await tryRec('重开弹窗-输入框值', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await c.click('#mCancel');
  await sleep(300);
  // 4) 快捷栏 ±0.01 微调
  await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"bpm\"][data-d=\"0.01\"]').click()");
  await sleep(250);
  await tryRec('快捷栏+0.01', () => c.evalJs("document.getElementById('qBpmVal').textContent"));
  await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"bpm\"][data-d=\"-0.01\"]').click()");
  await sleep(250);
  await tryRec('快捷栏-0.01', () => c.evalJs("document.getElementById('qBpmVal').textContent"));
  // 5) 边界：120.999 → 121；40.001 → 40（合规范围 40-300）
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗3');
  await c.evalJs("document.querySelector('.seg-bpm').value = '120.999'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(250);
  await tryRec('输入120.999-规范化', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  // 6) 识别路径：识别 → 回填 1 位 → 确认 → 快捷栏无多余小数
  await c.evalJs("document.querySelector('.seg-auto').click()");
  await sleep(1500);
  await tryRec('识别回填-输入框', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await c.click('#mOk');
  await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格2');
  await tryRec('识别确认后-快捷栏', () => c.evalJs("document.getElementById('qBpmVal').textContent"));
  await tryRec('页面错误', () => c.pageErrs());

  console.log('\n===== 汇总 =====');
  const fails = Object.entries(R).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  console.log('检查项:', Object.keys(R).length, ' 失败:', fails.length);
  for (const [k, v] of fails) console.log('  [!!]', k, '=', v);
  c.close();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
