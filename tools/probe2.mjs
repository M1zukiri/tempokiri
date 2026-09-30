// 创建时间：2026-08-23 23:25:00
/** probe2.mjs — 受控实验：下载行为在什么条件下失效。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const OUT = path.resolve('tools/e2e_out');

async function setBrowserDl() {
  const info = await (await fetch('http://127.0.0.1:9338/json/version')).json();
  const bws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j; });
  await new Promise((resolve, reject) => {
    bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) m.error ? reject(new Error(m.error.message)) : resolve(m.result); };
    bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: OUT, eventsEnabled: true } }));
  });
  return bws;
}

async function dlProbe(c, tag) {
  const before = new Set(fs.readdirSync(OUT));
  await c.evalJs(`(() => { const b = new Blob(['x'], {type:'text/plain'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'probe_${tag}.txt'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await sleep(2500);
  return fs.readdirSync(OUT).filter(f => !before.has(f));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const c = await Cdp.connect();
  c.on('Page.downloadWillBegin', (p) => console.log('  [EVT]', p.suggestedFilename));
  await c.navigate(pathToFileURL(DIST).href);

  console.log('=== A: navigate 后 browser 级设置 + 纯 blob 下载');
  const bws = await setBrowserDl();
  console.log('  A 结果:', await dlProbe(c, 'a'));

  console.log('=== B: 注入素材（应用跑了导入流程）后 + 纯 blob 下载');
  await c.injectFile(WAV);
  await c.waitFor("['就绪','已应用','提取失败'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 20000, '就绪');
  console.log('  B 结果:', await dlProbe(c, 'b'));

  console.log('=== C: 应用真实导出（e2e_wav2）');
  const beforeC = new Set(fs.readdirSync(OUT));
  await c.click('#btnExport');
  await c.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗');
  await c.evalJs("document.getElementById('aName').value = 'e2e_wav2'");
  await c.trustedClick('#xOk');
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('导出完成') !== -1", 90000, '导出完成');
  await sleep(4000);
  console.log('  C 结果:', fs.readdirSync(OUT).filter(f => !beforeC.has(f)));
  console.log('  C 环境: prepareDownloads 未调用（browser 级已由 setBrowserDl 配置，连接保持）');

  bws.close(); c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
