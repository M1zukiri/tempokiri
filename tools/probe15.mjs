// 创建时间：2026-08-24 05:00:00
/** probe15.mjs — v1.11.0 识别竞争候选展示与采用验证（真实音频 + 合成素材两场景）。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const M4A = 'C:/Users/M1zukuro/Desktop/Sync/Majproject/制作中/doppelganger/二重身 ⧸ 日暮翠(cv.异世界情绪)＆日暮红(cv.宮崎 恵里花) Character Covers [BV1MRKP6CEXc].m4a';
const WAV = path.resolve('examples/test_track.wav');
const R = {};
async function tryRec(name, fn) {
  try { const v = await fn(); R[name] = v; console.log('  [OK]   ' + name + ' = ' + clip(JSON.stringify(v))); }
  catch (e) { R[name] = 'FAIL: ' + e.message; console.log('  [FAIL] ' + name + ' = ' + e.message); }
}

async function main() {
  const c = await Cdp.connect();

  // ---------- 场景 A：目标音频（108.5 层 + 竞争层）----------
  console.log('\n--- A 目标音频：候选展示/采用 ---');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(M4A);
  await c.waitFor("['就绪','已应用'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 60000, '就绪');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 120000, '识别');
  await tryRec('A-识别状态', () => c.evalJs("document.getElementById('mAutoStatus').textContent"));
  await tryRec('A-候选区可见', () => c.evalJs("!document.getElementById('autoCands').hidden"));
  await tryRec('A-候选按钮', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#autoCands .auto-cand-bpm')].map(b => b.textContent))`));
  // 点击第一个候选（分数最高者）→ 输入框更新 + 状态提示
  await c.evalJs("document.querySelector('#autoCands .auto-cand-bpm').click()");
  await sleep(300);
  await tryRec('A-采用后-输入框', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await tryRec('A-采用后-状态', () => c.evalJs("document.getElementById('mAutoStatus').textContent"));
  await c.evalJs("document.getElementById('mCancel').click()");
  await sleep(400);

  // ---------- 场景 B：合成素材（无显著竞争层 → 候选隐藏）----------
  console.log('\n--- B test_track：候选范围检查 ---');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(WAV);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪WAV');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗B');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('未能') !== -1", 60000, '识别B');
  await tryRec('B-识别状态', () => c.evalJs("document.getElementById('mAutoStatus').textContent"));
  await tryRec('B-候选区可见(可能隐藏)', () => c.evalJs("!document.getElementById('autoCands').hidden"));
  await tryRec('B-候选按钮', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#autoCands .auto-cand-bpm')].map(b => b.textContent))`));
  await tryRec('页面错误', () => c.pageErrs());

  console.log('\n===== 汇总 =====');
  const fails = Object.entries(R).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  console.log('检查项:', Object.keys(R).length, ' 失败:', fails.length);
  for (const [k, v] of fails) console.log('  [!!]', k, '=', v);
  c.close();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
