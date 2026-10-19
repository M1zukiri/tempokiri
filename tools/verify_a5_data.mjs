// 创建时间：2026-10-19 17:12:00
/**
 * verify_a5_data.mjs — 1.23.0 A5-1 无头验签：节拍/网格数据导出。
 *
 * 断言：
 *   1. 有网格时导出弹窗出现「节拍数据」Tab 且可用（无网格时禁用）
 *   2. CSV 导出：注释头 + 表头 + 每小节一行，行数 = 网格小节数
 *   3. JSON 导出：format/segments/bars/beats 结构完整
 *   4. 零页面 JS 异常
 * 前置：无头 Edge（9338）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const DL = path.resolve('C:/tmp/a5dl');
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(DIST).href);

// 无网格且无序列：导出入口应拦截（状态栏提示「序列为空」），不打开弹窗
await c.injectFile(WAV);
await c.waitFor(`!document.getElementById('controlBar').hidden`, 20000, 'audio-ready');
await c.waitFor(`document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 20000, 'status-ready');
await c.click('#btnExport');
await sleep(500);
const blocked = await c.evalJs(`JSON.stringify({ hidden: document.getElementById('exportOverlay') ? document.getElementById('exportOverlay').hidden : true, status: document.getElementById('statusBar').textContent })`);
const bj = JSON.parse(blocked);
ok('无网格无序列时导出被拦截', bj.hidden === true && bj.status.indexOf('序列为空') !== -1, blocked);

// 通过节拍设置建立网格（120 BPM / 4-4 / 2 小节）
await c.click('#btnSettings');
await c.waitFor(`!document.getElementById('modalOverlay').hidden`, 8000, 'settings-open');
await c.evalJs(`(() => { const b = document.querySelector('.seg-bpm'); b.value = '120'; b.dispatchEvent(new Event('change', { bubbles: true })); const o = document.getElementById('mOffset'); o.value = '0'; o.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(200);
await c.click('#mOk');
await c.waitFor(`!document.getElementById('quickBar').hidden`, 8000, 'grid-applied');
await sleep(300);

async function exportData(format) {
  await c.click('#btnExport');
  await c.waitFor(`!document.getElementById('exportOverlay').hidden`, 8000, 'export-open-2');
  const disabled = await c.evalJs(`document.querySelector('.exp-tab[data-tab="data"]').disabled`);
  await c.click('.exp-tab[data-tab="data"]');
  await sleep(150);
  const panelShown = await c.evalJs(`!document.querySelector('.exp-panel[data-panel="data"]').hidden`);
  await c.evalJs(`(() => {
    const sel = document.getElementById('dFormat'); sel.value = ${JSON.stringify(format)};
    const nm = document.getElementById('dName'); nm.value = 'gridtest';
  })()`);
  const before = Date.now();
  await c.click('#xOk');
  const file = await c.waitForDownload(DL, '.' + (format === 'json' ? 'json' : 'csv'), 20000, before);
  await sleep(200);
  return { disabled, panelShown, file, text: fs.readFileSync(file, 'utf8') };
}

await c.prepareDownloads(DL);
const csv = await exportData('csv');
ok('有网格时「节拍数据」Tab 可用', csv.disabled === false);
ok('数据面板可见', csv.panelShown === true);
const lines = csv.text.trimEnd().split('\n');
ok('CSV 含注释头与表头', lines[0].startsWith('# tempokiri grid export') && lines.some((l) => l.startsWith('bar,start_sec')));
const headerIdx = lines.findIndex((l) => l.startsWith('bar,'));
const rows = lines.slice(headerIdx + 1);
ok('CSV 每小节一行且列数正确', rows.length > 0 && rows.every((r) => r.split(',').length === 6), `rows=${rows.length}`);
ok('CSV 首行为第 1 小节 120 BPM', /^1,0,2,2,120,4$/.test(rows[0]), rows[0]);

const json = await exportData('json');
const obj = JSON.parse(json.text);
ok('JSON format 标记', obj.format === 'tempokiri-grid-v1');
ok('JSON 含 segments/bars/beats', Array.isArray(obj.segments) && obj.segments.length >= 1 && obj.bars.length === rows.length && Array.isArray(obj.beats));
ok('JSON bars 与小节数一致', obj.bars.length === rows.length, `${obj.bars.length} vs ${rows.length}`);

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA5-1 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
