// 创建时间：2026-10-19 17:35:00
/**
 * verify_a5_fade.mjs — 1.22.2 A5-2 无头验签：导出首尾淡入淡出。
 *
 * 断言：
 *   1. 淡入 500ms：第 0 样本≈0、250ms 处约为原幅度的 50%、500ms 后与原导出一致
 *   2. 淡出 500ms：末样本≈0、结尾 250ms 处约为原幅度的 50%
 *   3. 长度与不加淡化的导出一致
 * 前置：无头 Edge（9338）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const DL = path.resolve('C:/tmp/a5fade');
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

/** 解析 16/24/32-bit PCM WAV → Float32Array（mono，取第 1 声道）。 */
function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(off + 8), ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      data = buf.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV 解析失败');
  const n = Math.floor(data.length / (fmt.ch * (fmt.bits / 8)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * fmt.ch * (fmt.bits / 8);
    if (fmt.bits === 16) out[i] = data.readInt16LE(p) / 32768;
    else if (fmt.bits === 24) {
      const v = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16);
      out[i] = ((v << 8) >> 8) / 8388608;
    } else out[i] = data.readFloatLE(p);
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

// 网格 120 BPM / offset 0 → 双击选一小节 → 入列
await c.click('#btnSettings');
await c.waitFor(`!document.getElementById('modalOverlay').hidden`, 8000, 'settings');
await c.evalJs(`(() => { const b = document.querySelector('.seg-bpm'); b.value='120'; b.dispatchEvent(new Event('change',{bubbles:true})); const o=document.getElementById('mOffset'); o.value='0'; o.dispatchEvent(new Event('change',{bubbles:true})); })()`);
await sleep(200);
await c.click('#mOk');
await c.waitFor(`!document.getElementById('quickBar').hidden`, 8000, 'grid');
await sleep(300);

async function addCardAt(ratio) {
  const box = await c.evalJs(`(() => { const r = document.getElementById('wave').getBoundingClientRect(); return { x: r.left + r.width * ${ratio}, y: r.top + r.height / 2 }; })()`);
  await c.mouse('dbl', box.x, box.y);
  await sleep(250);
  await c.click('#btnAddSelection');
  await sleep(300);
}
await addCardAt(0.3);
ok('序列已有一张卡片', (await c.evalJs(`document.querySelectorAll('.seq-card').length`)) >= 1);

async function exportWav(name, fadeMs) {
  await c.click('#btnExport');
  await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export');
  // 确保音频 Tab
  await c.click('.exp-tab[data-tab="audio"]');
  await sleep(120);
  await c.evalJs(`(() => {
    document.getElementById('aFormat').value = 'wav';
    document.getElementById('aFormat').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('aFadeIn').value = '${fadeMs}';
    document.getElementById('aFadeOut').value = '${fadeMs}';
    document.getElementById('aName').value = '${name}';
  })()`);
  const before = Date.now();
  await c.click('#xOk');
  const file = await c.waitForDownload(DL, '.wav', 30000, before);
  await sleep(200);
  return readWav(file);
}

const noFade = await exportWav('nofade', 0);
const fade = await exportWav('fade', 1000);
ok('长度一致', noFade.samples.length === fade.samples.length, `${noFade.samples.length} vs ${fade.samples.length}`);

const sr = fade.sr;
const fi = Math.min(Math.round(1.0 * sr), Math.floor(fade.samples.length / 2)); // 与导出时 1000ms 淡化一致
const mid = Math.floor(fade.samples.length / 2);
ok('淡入：首样本≈0', Math.abs(fade.samples[0]) < 1e-4, String(fade.samples[0]));
/** 在 [from,to) 找第一个可闻样本（|v| > 0.05），用于验证斜坡比例。 */
const findAudible = (arr, from, to) => {
  for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) if (Math.abs(arr[i]) > 0.05) return i;
  return -1;
};
const kIn = findAudible(noFade.samples, 0, fi);
ok('淡入区存在可闻样本', kIn >= 0, String(kIn));
const rampIn = kIn >= 0 ? fade.samples[kIn] / noFade.samples[kIn] : 0;
ok('淡入斜坡比例 = i/淡入样本数',
  kIn >= 0 && Math.abs(rampIn - kIn / fi) < 0.01,
  `k=${kIn} ratio=${rampIn.toFixed(4)} expect=${(kIn / fi).toFixed(4)}`);
ok('淡入区之后与原导出一致（1 LSB 内）', Math.abs(fade.samples[mid] - noFade.samples[mid]) < 1 / 32768,
  `mid=${fade.samples[mid].toFixed(5)}`);
const last = fade.samples.length - 1;
ok('淡出：末样本≈0', Math.abs(fade.samples[last]) < 1e-4, String(fade.samples[last]));
const q = last - Math.floor(fi / 2);
const kOut = findAudible(noFade.samples, last - fi + 1, last);
ok('淡出区存在可闻样本', kOut >= 0, String(kOut));
const rampOut = kOut >= 0 ? fade.samples[kOut] / noFade.samples[kOut] : 0;
ok('淡出斜坡比例 = (末-k)/淡出样本数',
  kOut >= 0 && Math.abs(rampOut - (last - kOut) / fi) < 0.01,
  `k=${kOut} ratio=${rampOut.toFixed(4)} expect=${((last - kOut) / fi).toFixed(4)}`);

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA5-2 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
