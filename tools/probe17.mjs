// 创建时间：2026-08-24 08:40:00
/** probe17.mjs — v1.12.0 BPM Tap + ×2/÷2 验证（真实音频两场景：半频修正与范围外曲目）。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const DB = JSON.parse(fs.readFileSync('C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/handmaid_db.json', 'utf8'));
const R = {};
async function tryRec(name, fn) {
  try { const v = await fn(); R[name] = v; console.log('  [OK]   ' + name + ' = ' + clip(JSON.stringify(v))); }
  catch (e) { R[name] = 'FAIL: ' + e.message; console.log('  [FAIL] ' + name + ' = ' + e.message); }
}

async function tapN(c, n, gapMs) {
  // 页面内定时器驱动（CDP 通信延迟会使 sleep(500) 漂移 → 用页面时钟精确控制间隔）
  await c.evalJs(`(async () => {
    const b = document.querySelector('.seg-tap');
    const t0 = performance.now();
    for (let i = 0; i < ${n}; i++) {
      const target = t0 + i * ${gapMs};
      const wait = target - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      b.click();
    }
    return true;
  })()`);
}

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);

  // ---------- 场景 A：11622（truth=120，基线半频 60）----------
  console.log('\n--- A 11622 (truth=120)：无 tap 识别 60 → ×2 修正 + tap 识别 ---');
  const a120 = DB.find((e) => e.id === '11622');
  await c.injectFile(a120.audio);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 30000, '就绪A');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '弹窗A');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 60000, '识别A');
  await tryRec('A-无tap识别', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  // ×2 手动修正
  await c.click('.seg-double');
  await sleep(200);
  await tryRec('A-×2后', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await tryRec('A-×2状态', () => c.evalJs("document.getElementById('mAutoStatus').textContent"));
  await c.click('.seg-halve');
  await sleep(200);
  await tryRec('A-÷2回退', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  // tap 8 拍（120BPM → 500ms）
  await tapN(c, 8, 500);
  await sleep(300);
  await tryRec('A-tap锁定-状态', () => c.evalJs("document.querySelector('.seg-tap-status').textContent"));
  await tryRec('A-tap锁定-行内BPM', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await tryRec('A-tap锁定-消息', () => c.evalJs("document.getElementById('mAutoStatus').textContent"));
  // tap 范围识别
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 60000, '识别A2');
  await tryRec('A-tap范围识别', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await tryRec('A-识别状态', () => c.evalJs("document.getElementById('mAutoStatus').textContent"));
  // 确认 → 快捷栏
  await c.click('#mOk');
  await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格A');
  await tryRec('A-确认后快捷栏', () => c.evalJs("document.getElementById('qBpmVal').textContent"));
  await c.evalJs("document.getElementById('btnStop').click()");
  await sleep(300);

  // ---------- 场景 B：11809（truth=242 > 200，范围外）----------
  console.log('\n--- B 11809 (truth=242)：tap 242 → 范围外命中 ---');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  const b242 = DB.find((e) => e.id === '11809');
  await c.injectFile(b242.audio);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 30000, '就绪B');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '弹窗B');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 60000, '识别B');
  await tryRec('B-无tap识别', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  // tap 8 拍（242 → 248ms）
  await tapN(c, 8, 248);
  await sleep(300);
  await tryRec('B-tap锁定', () => c.evalJs("document.querySelector('.seg-tap-status').textContent + ' | ' + document.querySelector('.seg-bpm').value"));
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 60000, '识别B2');
  await tryRec('B-tap范围识别', () => c.evalJs("document.querySelector('.seg-bpm').value"));
  await tryRec('页面错误', () => c.pageErrs());

  console.log('\n===== 汇总 =====');
  const fails = Object.entries(R).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  console.log('检查项:', Object.keys(R).length, ' 失败:', fails.length);
  for (const [k, v] of fails) console.log('  [!!]', k, '=', v);
  c.close();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
