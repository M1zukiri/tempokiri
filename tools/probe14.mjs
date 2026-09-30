// 创建时间：2026-08-24 04:30:00
/** probe14.mjs — 复现 74.9 误判：BPM 范围配置对识别结果的影响。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const M4A = 'C:/Users/M1zukuro/Desktop/Sync/Majproject/制作中/doppelganger/二重身 ⧸ 日暮翠(cv.异世界情绪)＆日暮红(cv.宮崎 恵里花) Character Covers [BV1MRKP6CEXc].m4a';

async function setRange(c, minV, maxV, hopV) {
  await c.click('#btnAdvanced');
  await c.waitFor("(() => { const el = document.getElementById('asOverlay'); return el && !el.hidden; })()", 5000, '高级设置');
  const gs = await c.evalJs(`(() => {
    const hopEl = document.getElementById('as-hop-sel');
    const minEl = document.getElementById('as-minBpm-num');
    const maxEl = document.getElementById('as-maxBpm-num');
    const ids = { hop: !!hopEl, min: !!minEl, max: !!maxEl };
    if (hopEl) { hopEl.value = '${hopV}'; hopEl.dispatchEvent(new Event('change', {bubbles:true})); }
    if (minEl) { minEl.value = '${minV}'; minEl.dispatchEvent(new Event('input', {bubbles:true})); }
    if (maxEl) { maxEl.value = '${maxV}'; maxEl.dispatchEvent(new Event('input', {bubbles:true})); }
    return JSON.stringify({ ids, gs: MC.loadGlobalSettings() });
  })()`);
  console.log('  设置后 gs:', gs);
  await sleep(300);
  await c.click('#asClose');
  await sleep(300);
}

async function recognize(c, label) {
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别') !== -1 && (document.getElementById('mAutoStatus').textContent.indexOf('完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('失败') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('未能') !== -1)", 120000, '识别');
  const st = await c.evalJs("document.getElementById('mAutoStatus').textContent");
  const v = await c.evalJs("document.querySelector('.seg-bpm').value");
  console.log(label + ' → ' + st + ' | 回填: ' + v);
  await c.evalJs("document.getElementById('mCancel').click()");
  await sleep(400);
}

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(M4A);
  await c.waitFor("['就绪','已应用'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 60000, '就绪');

  await setRange(c, 60, 100, 512);
  await recognize(c, '范围 60-100 / hop512');
  await setRange(c, 90, 200, 512);
  await recognize(c, '范围 90-200 / hop512');
  await setRange(c, 60, 300, 512);
  await recognize(c, '范围 60-300 / hop512');
  await setRange(c, 60, 200, 256);
  await recognize(c, '范围 60-200 / hop256(高精度)');
  console.log('errs:', JSON.stringify(await c.pageErrs()));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
