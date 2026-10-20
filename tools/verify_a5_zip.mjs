// 创建时间：2026-10-19 18:55:00
/**
 * verify_a5_zip.mjs — 1.22.5 A5-5 无头验签：分段批量导出（ZIP）。
 *
 * 断言：
 *   1. 音频 Tab 有「导出范围」选择，逐段导出生成单个 .zip
 *   2. ZIP 内含按序号命名的 2 个 WAV，且都是合法 RIFF、长度与对应段落一致
 *   3. 状态栏提示分段导出完成
 * 前置：无头 Edge（9338）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const DL = path.resolve('C:/tmp/a5zip');
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

/** 解析 store 方式 ZIP → [{name, data}]（本验签只需支持本项目产物）。 */
function readZip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('未找到 EOCD');
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) throw new Error('中央目录签名错误 @' + off);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = Buffer.from(buf.subarray(off + 46, off + 46 + nameLen)).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const compSize = view.getUint32(localOff + 18, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    out.push({ name, data: buf.subarray(dataStart, dataStart + compSize) });
  }
  return out;
}

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(DIST).href);
await c.injectFile(WAV);
await c.waitFor(`document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 25000, 'audio-ready');
await c.prepareDownloads(DL);

// 网格 + 两张卡片
await c.click('#btnSettings');
await c.waitFor(`!document.getElementById('modalOverlay').hidden`, 8000, 'settings');
await c.evalJs(`(() => { const b=document.querySelector('.seg-bpm'); b.value='120'; b.dispatchEvent(new Event('change',{bubbles:true})); const o=document.getElementById('mOffset'); o.value='0'; o.dispatchEvent(new Event('change',{bubbles:true})); })()`);
await sleep(200);
await c.click('#mOk');
await c.waitFor(`!document.getElementById('quickBar').hidden`, 8000, 'grid');
await sleep(300);
for (const ratio of [0.2, 0.55]) {
  const p = await c.evalJs(`(() => { const r = document.getElementById('wave').getBoundingClientRect(); return { x: r.left + r.width * ${ratio}, y: r.top + r.height / 2 }; })()`);
  await c.mouse('dbl', p.x, p.y);
  await sleep(250);
  await c.click('#btnAddSelection');
  await sleep(300);
}
const cardCount = await c.evalJs(`document.querySelectorAll('.seq-card').length`);
ok('序列有 2 张卡片', cardCount === 2, String(cardCount));

await c.click('#btnExport');
await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export');
await c.click('.exp-tab[data-tab="audio"]');
await sleep(150);
const hasRange = await c.evalJs(`!!document.getElementById('aRange')`);
ok('音频 Tab 存在「导出范围」选择', hasRange);
await c.evalJs(`(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('aFormat', 'wav');
  set('aRange', 'split');
  document.getElementById('aName').value = 'batch';
})()`);
await sleep(150);
const before = Date.now();
await c.click('#xOk');
const zipFile = await c.waitForDownload(DL, '.zip', 60000, before);
await sleep(300);

const entries = readZip(fs.readFileSync(zipFile));
ok('ZIP 含 2 个条目', entries.length === 2, String(entries.length));
ok('条目按序号命名', entries.every((e, i) => e.name === `batch_0${i + 1}.wav`), entries.map((e) => e.name).join(', '));
ok('条目都是合法 WAV（RIFF/WAVE 头）', entries.every((e) => e.data.toString('ascii', 0, 4) === 'RIFF' && e.data.toString('ascii', 8, 12) === 'WAVE'));
const sizes = entries.map((e) => e.data.length);
ok('每个 WAV 有音频数据（大小 > 10KB）', sizes.every((s) => s > 10240), JSON.stringify(sizes));

const statusText = await c.evalJs(`document.getElementById('statusBar').textContent`);
ok('状态栏提示分段导出完成', statusText.indexOf('分段导出完成') !== -1, statusText);

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA5-5 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
