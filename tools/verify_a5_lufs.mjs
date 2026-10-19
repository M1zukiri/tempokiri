// 创建时间：2026-10-19 18:02:00
/**
 * verify_a5_lufs.mjs — 1.22.3 A5-3 无头验签：LUFS 响度归一化。
 *
 * 断言：
 *   1. 导出弹窗存在「响度归一化（LUFS）」下拉，与峰值归一化互斥
 *   2. 选 -16 LUFS 导出的 WAV，用同一实现复测 ≈ -16（±0.3）
 *   3. 未归一化导出与归一化导出长度一致、后者不削波（|peak| ≤ 1）
 * 前置：无头 Edge（9338）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';
import loudness from '../src/loudness.js';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const DL = path.resolve('C:/tmp/a5lufs');
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    else if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV 解析失败');
  const n = Math.floor(data.length / (fmt.ch * (fmt.bits / 8)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * fmt.ch * (fmt.bits / 8);
    out[i] = fmt.bits === 16 ? data.readInt16LE(p) / 32768 : data.readFloatLE(p);
  }
  return { sr: fmt.sr, samples: out };
}

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(DIST).href);
await c.injectFile(WAV);
await c.waitFor(`document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 25000, 'audio-ready');
await c.prepareDownloads(DL);

// 网格 + 入选区
await c.click('#btnSettings');
await c.waitFor(`!document.getElementById('modalOverlay').hidden`, 8000, 'settings');
await c.evalJs(`(() => { const b=document.querySelector('.seg-bpm'); b.value='120'; b.dispatchEvent(new Event('change',{bubbles:true})); const o=document.getElementById('mOffset'); o.value='0'; o.dispatchEvent(new Event('change',{bubbles:true})); })()`);
await sleep(200);
await c.click('#mOk');
await c.waitFor(`!document.getElementById('quickBar').hidden`, 8000, 'grid');
await sleep(300);
const box = await c.evalJs(`(() => { const r = document.getElementById('wave').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height / 2 }; })()`);
await c.mouse('dbl', box.x, box.y);
await sleep(250);
await c.click('#btnAddSelection');
await sleep(300);

async function exportWav(name, lufsTarget) {
  await c.click('#btnExport');
  await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export');
  await c.click('.exp-tab[data-tab="audio"]');
  await sleep(120);
  const ui = await c.evalJs(`(() => {
    const sel = document.getElementById('aLufs');
    sel.value = ${JSON.stringify(lufsTarget == null ? '' : String(lufsTarget))};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const norm = document.getElementById('aNormalize');
    const before = norm.checked;
    if (${lufsTarget != null}) { /* 选中 LUFS 后应自动取消峰值归一化 */ }
    document.getElementById('aFormat').value = 'wav';
    document.getElementById('aFormat').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('aName').value = ${JSON.stringify(name)};
    return JSON.stringify({ lufs: sel.value, normChecked: before, peakRowHidden: document.getElementById('aPeakRow').hidden });
  })()`);
  const before = Date.now();
  await c.click('#xOk');
  const file = await c.waitForDownload(DL, '.wav', 30000, before);
  await sleep(200);
  return { ui: JSON.parse(ui), ...readWav(file) };
}

const raw = await exportWav('raw', null);
const norm = await exportWav('lufs16', -16);
const rawLufs = loudness.integratedLoudness(raw.samples, raw.sr);
const outLufs = loudness.integratedLoudness(norm.samples, norm.sr);
ok('未归一化导出有响度数据', isFinite(rawLufs), rawLufs.toFixed(2) + ' LUFS');
ok('LUFS 归一化导出复测 ≈ -16', Math.abs(outLufs - (-16)) < 0.3, outLufs.toFixed(2) + ' LUFS');
ok('归一化与未归一化长度一致', raw.samples.length === norm.samples.length, String(raw.samples.length));
let peak = 0;
for (let i = 0; i < norm.samples.length; i++) peak = Math.max(peak, Math.abs(norm.samples[i]));
ok('归一化输出不削波（|peak| ≤ 1）', peak <= 1.0001, peak.toFixed(4));
ok('UI：LUFS 下拉已选中 -16 且峰值归一化被取消', norm.ui.lufs === '-16' && norm.ui.normChecked === false && norm.ui.peakRowHidden === true, JSON.stringify(norm.ui));

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA5-3 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
