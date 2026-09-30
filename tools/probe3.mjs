// 创建时间：2026-08-23 23:50:00
/** probe3.mjs — 调查检查更新行为（彩蛋/toast）与彩蛋弹窗对导出按钮的影响。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(WAV);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');

  console.log('--- 点击检查更新 ---');
  await c.click('#btnCheckUpdate');
  await sleep(6000);
  console.log('updateToast:', JSON.stringify(await c.evalJs("(() => { const t = document.getElementById('updateToast'); return {hidden: t.hidden, text: t.textContent}; })()")));
  console.log('easterEggOverlay:', JSON.stringify(await c.evalJs("(() => { const el = document.getElementById('easterEggOverlay'); return el ? {visible: !el.hidden, text: el.textContent.slice(0, 120)} : null; })()")));
  console.log('btnCheckUpdate 状态:', JSON.stringify(await c.evalJs("(() => { const b = document.getElementById('btnCheckUpdate'); return {disabled: b.disabled, text: b.textContent}; })()")));

  console.log('--- 彩蛋存在时点导出 ---');
  await c.click('#btnExport');
  await sleep(1000);
  console.log('exportOverlay:', JSON.stringify(await c.evalJs("(() => { const el = document.getElementById('exportOverlay'); return el ? el.hidden : '不存在(未创建)'; })()")));

  console.log('--- 关闭彩蛋后点导出 ---');
  await c.evalJs("document.getElementById('easterEggOverlay')?.remove()");
  await c.click('#btnExport');
  await sleep(1000);
  console.log('exportOverlay:', JSON.stringify(await c.evalJs("(() => { const el = document.getElementById('exportOverlay'); return el ? el.hidden : '不存在(未创建)'; })()")));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
