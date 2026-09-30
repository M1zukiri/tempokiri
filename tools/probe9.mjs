// 创建时间：2026-08-24 02:00:00
/** probe9.mjs — 闭环验证：检查更新应显示「已是最新版本 v1.9.1」。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const c = await Cdp.connect();
await c.navigate(pathToFileURL(path.resolve('dist/tempokiri-workstation.html')).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(path.resolve('dist/tempokiri-workstation.html')).href);
const ver = await c.evalJs("document.querySelector('[data-version]').textContent");
await c.click('#btnCheckUpdate');
await sleep(6000);
const toast = await c.evalJs("(() => { const t = document.getElementById('updateToast'); return { hidden: t.hidden, text: t.textContent }; })()");
const egg = await c.evalJs("!!document.getElementById('easterEggOverlay')");
console.log(JSON.stringify({ 页面版本: ver, toast, 彩蛋弹出: egg }));
console.log('errs:', JSON.stringify(await c.pageErrs()));
c.close();
process.exit(0);
