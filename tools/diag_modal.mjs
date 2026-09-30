// 创建时间：2026-08-26 19:10:00 (段行渲染诊断)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const cdp = await Cdp.connect();
const evalJs = (e) => cdp.evalJs(e);
await cdp.navigate(pathToFileURL(DIST).href);
await evalJs('localStorage.clear()');
await cdp.navigate(pathToFileURL(DIST).href);
await cdp.waitFor("document.readyState === 'complete'", 15000, 'ready');
await cdp.injectFile(path.resolve('examples/test_track.wav'));
await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
await evalJs("window.__log = []; window.addEventListener('error', (e) => window.__log.push(String(e.message) + ' @ ' + (e.filename||'') + ':' + e.lineno)); true");
await cdp.click('#btnSettings');
await sleep(500);
const info = await evalJs("(() => { const t = document.getElementById('segTbody'); const seg = t && t.querySelector('.seg-length'); return { html: seg ? seg.innerHTML : 'NO-LEN', log: window.__log }; })()");
console.log('segTbody:', JSON.stringify(info, null, 2));
process.exit(0);
