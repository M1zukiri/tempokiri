// 创建时间：2026-08-23 23:40:00
/** probe_dl.mjs — 无头 Edge 下载行为探针（最小复现）。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const OUT = path.resolve('tools/e2e_out');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const c = await Cdp.connect();
  // 监听下载事件
  c.on('Browser.downloadWillBegin', (p) => console.log('[EVT] downloadWillBegin:', JSON.stringify(p).slice(0, 200)));
  c.on('Browser.downloadProgress', (p) => console.log('[EVT] downloadProgress:', JSON.stringify(p).slice(0, 120)));
  c.on('Page.downloadWillBegin', (p) => console.log('[EVT] Page.downloadWillBegin:', JSON.stringify(p).slice(0, 200)));

  await c.navigate(pathToFileURL(DIST).href);
  const before = new Set(fs.readdirSync(OUT));
  console.log('--- 尝试1: page session setDownloadBehavior 已由 lib 完成，JS click 触发 ---');
  await c.evalJs(`(() => { const b = new Blob(['hello-dl-test'], {type:'text/plain'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'probe1.txt'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await sleep(3000);
  console.log('OUT 新增:', fs.readdirSync(OUT).filter(f => !before.has(f)));

  const before2 = new Set(fs.readdirSync(OUT));
  console.log('--- 尝试2: Browser target 级 setDownloadBehavior ---');
  // 获取 browser ws 并设置
  const list = await (await fetch('http://127.0.0.1:9338/json/version')).json();
  const bws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j; });
  let id = 0; const pend = new Map();
  bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } else if (m.method === 'Browser.downloadWillBegin') { console.log('[B-EVT] willBegin', JSON.stringify(m.params).slice(0, 160)); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method, params })); });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  console.log('browser-level set OK');
  await c.evalJs(`(() => { const b = new Blob(['hello-dl-test2'], {type:'text/plain'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'probe2.txt'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await sleep(3000);
  console.log('OUT 新增:', fs.readdirSync(OUT).filter(f => !before2.has(f)));

  console.log('--- 尝试3: 受信任 CDP click 触发页内按钮下载 ---');
  const before3 = new Set(fs.readdirSync(OUT));
  const btn = await c.evalJs(`(() => { const b = document.createElement('button'); b.id = 'probeBtn'; b.textContent = 'dl'; b.onclick = () => { const b2 = new Blob(['hello-dl-test3'], {type:'text/plain'}); const u = URL.createObjectURL(b2); const a = document.createElement('a'); a.href = u; a.download = 'probe3.txt'; document.body.appendChild(a); a.click(); a.remove(); }; document.body.appendChild(b); return true; })()`);
  const r = await c.center('#probeBtn');
  await c.mouse('click', r.x, r.y);
  await sleep(3000);
  console.log('OUT 新增:', fs.readdirSync(OUT).filter(f => !before3.has(f)));

  console.log('--- 尝试4: Page.setDownloadBehavior (present) ---');
  await c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  const before4 = new Set(fs.readdirSync(OUT));
  await c.evalJs(`(() => { const b = new Blob(['hello-dl-test4'], {type:'text/plain'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'probe4.txt'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await sleep(3000);
  console.log('OUT 新增:', fs.readdirSync(OUT).filter(f => !before4.has(f)));

  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('PROBE ERR:', e.message); process.exit(1); });
