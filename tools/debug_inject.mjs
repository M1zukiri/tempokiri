// 创建时间：2026-08-24 06:30:00
/** debug_inject.mjs — 单首注入调试：__fileSeq/状态栏/错误。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const MP3 = 'C:/Users/M1zukuro/Desktop/Sync/handmaid/训练集/batch_review/out/11312/track.mp3';

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  console.log('fileInput 存在:', await c.evalJs("!!document.getElementById('fileInput')"));
  console.log('初始状态栏:', await c.evalJs("document.getElementById('statusBar').textContent"));
  await c.evalJs(`document.getElementById('fileInput').addEventListener('change', (e) => {
    window.__fileSeq = (window.__fileSeq || 0) + 1;
    window.__lastFile = e.target.files && e.target.files[0];
  }, { capture: true });
  window.__fileSeq = 0; true`);
  await c.injectFile(MP3);
  await sleep(2000);
  console.log('注入后 __fileSeq:', await c.evalJs("window.__fileSeq"));
  console.log('注入后 状态栏:', await c.evalJs("document.getElementById('statusBar').textContent"));
  console.log('页面错误:', await c.evalJs("JSON.stringify(window.__e2eErr || null)"));
  await sleep(8000);
  console.log('8s后 状态栏:', await c.evalJs("document.getElementById('statusBar').textContent"));
  const seq = await c.evalJs("window.__fileSeq");
  console.log('__fileSeq:', seq, ' lastFile:', await c.evalJs("window.__lastFile ? window.__lastFile.name : null"));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
