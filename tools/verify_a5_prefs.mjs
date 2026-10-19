// 创建时间：2026-10-19 18:26:00
/**
 * verify_a5_prefs.mjs — 1.22.4 A5-4 无头验签：导出参数记忆。
 *
 * 断言：
 *   1. 首次导出后 exportPrefs 写入全局设置（音频/数据两组字段）
 *   2. 刷新后重新打开导出弹窗，音频参数按上次预填（格式/采样率/归一化/峰值/交叉淡化/淡入淡出）
 *   3. 数据 Tab 的格式也记忆；文件名字段不记忆（仍按源文件生成）
 * 前置：无头 Edge（9338）。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const DL = path.resolve('C:/tmp/a5prefs');
const URL_ = pathToFileURL(DIST).href;
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const c = await Cdp.connect();

async function bootWithGrid() {
  await c.navigate(URL_);
  await c.injectFile(WAV);
  // 二次进入时状态栏是「已应用上次节拍设置」，用控制栏出现作为就绪判据
  await c.waitFor(`!document.getElementById('controlBar').hidden`, 25000, 'audio-ready');
  await sleep(900);
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
}

await c.navigate(URL_);
await c.evalJs('localStorage.clear()');
await bootWithGrid();
await c.prepareDownloads(DL);

// 自定义音频参数后导出 MP3
await c.click('#btnExport');
await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export');
await c.click('.exp-tab[data-tab="audio"]');
await sleep(120);
await c.evalJs(`(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('aFormat', 'mp3');
  set('aSampleRate', '48000');
  const norm = document.getElementById('aNormalize');
  if (!norm.checked) norm.click();
  set('aPeak', '-3');
  set('aCrossfade', '50');
  set('aFadeIn', '300');
  set('aFadeOut', '200');
  document.getElementById('aName').value = 'pref1';
})()`);
await sleep(150);
let before = Date.now();
await c.click('#xOk');
await c.waitForDownload(DL, '.mp3', 60000, before);
await sleep(300);

const prefs = JSON.parse(await c.evalJs(`JSON.stringify((JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').exportPrefs) || null)`));
ok('导出后写入 exportPrefs.audio', !!prefs && !!prefs.audio, JSON.stringify(prefs && prefs.audio));
ok('记忆音频格式/采样率', prefs && prefs.audio.format === 'mp3' && prefs.audio.sampleRate === '48000', prefs && `${prefs.audio.format}/${prefs.audio.sampleRate}`);
ok('记忆归一化与峰值', prefs && prefs.audio.normalize === true && prefs.audio.peakDb === -3, prefs && JSON.stringify({ n: prefs.audio.normalize, p: prefs.audio.peakDb }));
ok('记忆交叉淡化与淡入淡出', prefs && prefs.audio.crossfadeMs === 50 && prefs.audio.fadeInMs === 300 && prefs.audio.fadeOutMs === 200, prefs && JSON.stringify([prefs.audio.crossfadeMs, prefs.audio.fadeInMs, prefs.audio.fadeOutMs]));

// 数据 Tab 格式改 JSON 后导出（顺带再次写 prefs）
await c.click('#btnExport');
await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export2');
await c.click('.exp-tab[data-tab="data"]');
await sleep(150);
await c.evalJs(`(() => { const sel = document.getElementById('dFormat'); sel.value = 'json'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
before = Date.now();
await c.click('#xOk');
await c.waitForDownload(DL, '.json', 20000, before);
await sleep(300);

// 刷新后重新准备同样的上下文，打开导出应预填
await bootWithGrid();
await c.click('#btnExport');
await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export3');
await c.click('.exp-tab[data-tab="audio"]');
await sleep(200);
const ui = JSON.parse(await c.evalJs(`JSON.stringify({
  format: document.getElementById('aFormat').value,
  sampleRate: document.getElementById('aSampleRate').value,
  normalize: document.getElementById('aNormalize').checked,
  peak: document.getElementById('aPeak').value,
  crossfade: document.getElementById('aCrossfade').value,
  fadeIn: document.getElementById('aFadeIn').value,
  fadeOut: document.getElementById('aFadeOut').value,
  name: document.getElementById('aName').value,
})`));
ok('刷新后音频格式预填 mp3', ui.format === 'mp3', ui.format);
ok('刷新后采样率预填 48000', ui.sampleRate === '48000', ui.sampleRate);
ok('刷新后归一化与峰值预填', ui.normalize === true && ui.peak === '-3', JSON.stringify({ n: ui.normalize, p: ui.peak }));
ok('刷新后交叉淡化/淡入淡出预填', ui.crossfade === '50' && ui.fadeIn === '300' && ui.fadeOut === '200', JSON.stringify([ui.crossfade, ui.fadeIn, ui.fadeOut]));
ok('文件名不记忆（按源文件生成）', ui.name.indexOf('pref1') === -1 && ui.name.indexOf('test_track') === 0, ui.name);

await c.click('.exp-tab[data-tab="data"]');
await sleep(150);
const dFormat = await c.evalJs(`document.getElementById('dFormat').value`);
ok('数据 Tab 格式预填 json', dFormat === 'json', dFormat);

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA5-4 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
