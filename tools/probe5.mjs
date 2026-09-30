// 创建时间：2026-08-24 00:20:00
/** probe5.mjs — 补充验证：元数据导出附加（WAV LIST/INFO + MP3 ID3）、拖拽选区、快捷栏微调。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, wavInfo, mp3Info } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const OUT = path.resolve('tools/e2e_out');

async function main() {
  const c = await Cdp.connect();
  await c.prepareDownloads(OUT);
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(WAV);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');

  // 1) 快捷栏微调：+0.01 BPM → 120.11；-1 → 119.11（验证即时生效与钮态）
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await c.evalJs("document.querySelector('.seg-bpm').value = '120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('mOffset').value = '0'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(200);
  await c.click('#mOk');
  await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');
  console.log('初始 BPM:', await c.evalJs("document.getElementById('qBpmVal').textContent"));
  await c.evalJs("document.querySelector('#quickBar .q-bpm button')?.click()"); // +0.01（第一个按钮是 -1? 顺序：-1 -0.1 -0.01 +0.01 +0.1 +1）
  await sleep(200);
  console.log('+0.01 后:', await c.evalJs("document.getElementById('qBpmVal').textContent"));
  await c.evalJs("document.querySelectorAll('#quickBar .q-bpm button')[5]?.click()"); // +1
  await sleep(200);
  console.log('+1 后:', await c.evalJs("document.getElementById('qBpmVal').textContent"));

  // 2) 拖拽选区（真实手势）：从 t=8s 拖到 t=12s → 选中第 5-6 小节
  const r = await c.evalJs("(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
  const x0 = r.x + (8.0 / 16.0) * r.w, x1 = r.x + (12.0 / 16.0) * r.w, y = r.y + r.h / 2;
  await c.drag(x0, y, x1, y);
  await sleep(500);
  console.log('拖拽后状态栏:', await c.evalJs("document.getElementById('statusBar').textContent"));
  console.log('添加按钮可用:', await c.evalJs("document.getElementById('btnAddSelection').disabled"));

  // 3) 元数据编辑 → 导出 WAV → 检查 LIST/INFO + INAM
  await c.click('#btnMeta');
  await c.waitFor("(() => { const el = document.getElementById('metaOverlay'); return el && !el.hidden; })()", 5000, '元数据');
  await c.evalJs("document.getElementById('meta-title').value = '探针标题Probe'; document.getElementById('meta-title').dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('meta-title').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(300);
  await c.click('#metaClose');
  await sleep(300);

  // 拖拽选择的区间入列 → 导出 WAV
  await c.click('#btnAddSelection');
  await sleep(300);
  const before = fs.readdirSync(OUT);
  await c.click('#btnExport');
  await c.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗');
  await c.evalJs("document.getElementById('aName').value = 'e2e_meta_probe'");
  await c.trustedClick('#xOk');
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('导出完成') !== -1", 90000, '导出');
  await sleep(1500);
  const f = fs.readdirSync(OUT).filter(f => f.endsWith('.wav') && !before.includes(f))[0];
  if (f) {
    const buf = fs.readFileSync(path.join(OUT, f));
    const idx = buf.indexOf(Buffer.from('INAM'));
    const hasList = buf.indexOf(Buffer.from('LIST')) !== -1;
    const infoOk = buf.indexOf(Buffer.from('INFO')) !== -1;
    // INAM 后跟 UTF-8 标题（长度前缀 u32le + 文本）
    let inamText = null;
    if (idx !== -1) {
      const len = buf.readUInt32LE(idx + 4);
      inamText = buf.toString('utf8', idx + 8, idx + 8 + len);
    }
    console.log('WAV 元数据:', JSON.stringify({ hasList, infoOk, inamText, wav: wavInfo(buf) }));
  } else {
    console.log('WAV 导出失败（无文件）');
  }

  // 4) MP3 ID3 校验：v2.3 头（ID3 + 版本 03 00 + TIT2 帧）
  const before2 = fs.readdirSync(OUT);
  await c.click('#btnExport');
  await c.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗2');
  await c.evalJs("document.getElementById('aFormat').value = 'mp3'; document.getElementById('aFormat').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('aName').value = 'e2e_meta_probe'");
  await c.trustedClick('#xOk');
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('导出完成') !== -1", 90000, '导出MP3');
  await sleep(1500);
  const f2 = fs.readdirSync(OUT).filter(f => f.endsWith('.mp3') && !before2.includes(f))[0];
  if (f2) {
    const buf = fs.readFileSync(path.join(OUT, f2));
    const id3 = buf.toString('ascii', 0, 3) === 'ID3';
    const ver = buf[3] + '.' + buf[4];
    const tit2 = buf.indexOf(Buffer.from('TIT2')) !== -1;
    const apic = buf.indexOf(Buffer.from('APIC')) !== -1;
    console.log('MP3 ID3:', JSON.stringify({ id3, ver, tit2, apic, mp3: mp3Info(buf.slice(buf.indexOf(Buffer.from([0xff, 0xfb])))) }));
  } else {
    console.log('MP3 导出失败（无文件）');
  }

  // 5) 页面错误
  console.log('errs:', JSON.stringify(await c.pageErrs()));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
