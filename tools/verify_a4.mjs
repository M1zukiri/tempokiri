// 创建时间：2026-10-19 16:05:00
/**
 * verify_a4.mjs — 批注 a4 无头实测：自动识别「额外留空一小节」。
 *
 * 断言：
 *   1. 节拍设置弹窗存在 #mPadBar，且每次打开默认不勾
 *   2. 不勾识别：偏移 = 首个 onset（原行为）
 *   3. 勾选识别：偏移 = 原偏移 − 60/bpm×拍号分子，状态栏含「已留空一小节」
 *   4. 勾选识别的偏移仍满足 buildGrid 下界（> −小节长）
 * 前置：无头 Edge 已以 --remote-debugging-port=9338 启动。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const AUDIO = path.resolve('examples/test_track.wav');
const out = { steps: [], fail: 0 };
const ok = (name, cond, extra) => {
  out.steps.push({ name, pass: !!cond, extra });
  if (!cond) out.fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.watchErrors();

// 注入示例音频并等待就绪
await c.injectFile(AUDIO);
await c.waitFor(`document.getElementById('statusBar').textContent.indexOf('就绪') !== -1`, 30000, 'audio-ready');

// 打开节拍设置
await c.click('#btnSettings');
await c.waitFor(`!document.getElementById('modalOverlay').hidden`, 5000, 'modal-open');

const hasBox = await c.evalJs(`!!document.getElementById('mPadBar')`);
ok('弹窗存在 #mPadBar 复选框', hasBox);
ok('#mPadBar 默认不勾选', (await c.evalJs(`document.getElementById('mPadBar').checked`)) === false);
ok('#mPadBar 文案非空', !!(await c.evalJs(`document.getElementById('mPadBar').parentElement.textContent.trim()`)));

const readOffset = () => c.evalJs(`document.getElementById('mOffset').value`);
const clickDetect = async (expectText) => {
  await c.evalJs(`document.getElementById('mAutoStatus').textContent=''; document.querySelector('.seg-auto').click()`);
  await c.waitFor(`document.getElementById('mAutoStatus').textContent.indexOf(${JSON.stringify(expectText)}) !== -1`, 90000, 'detect');
};

// 1) 不勾选
await clickDetect('识别完成');
const off1 = Number(await readOffset());
const bpm1 = Number(await c.evalJs(`document.querySelector('.seg-bpm').value`));
ok('不勾选：识别出 BPM 与偏移', bpm1 > 0 && isFinite(off1), `bpm=${bpm1} offset=${off1}`);

// 2) 勾选后重识别
await c.evalJs(`document.getElementById('mPadBar').checked = true`);
await clickDetect('已留空一小节');
const off2 = Number(await readOffset());
const bpm2 = Number(await c.evalJs(`document.querySelector('.seg-bpm').value`));
const beats = Number(await c.evalJs(`document.querySelector('.seg-beats').value`)) || 4;
const barDur = (60 / bpm2) * beats;
ok('勾选：偏移提前约一个小节', Math.abs(off1 - off2 - barDur) < 0.002,
  `off1=${off1} off2=${off2} barDur=${barDur.toFixed(3)} 差=${(off1 - off2).toFixed(3)}`);
ok('勾选：状态栏提示已留空一小节',
  (await c.evalJs(`document.getElementById('mAutoStatus').textContent.indexOf('已留空一小节') !== -1`)));
ok('勾选：偏移满足网格下界（> −小节长）', off2 > -barDur, `off2=${off2} −barDur=${(-barDur).toFixed(3)}`);

// 3) 关闭再打开：复选框回到默认不勾
await c.click('#mCancel');
await c.click('#btnSettings');
await c.waitFor(`!document.getElementById('modalOverlay').hidden`, 5000, 'modal-reopen');
ok('重开弹窗后复选框复位为不勾', (await c.evalJs(`document.getElementById('mPadBar').checked`)) === false);

const errs = await c.pageErrs();
ok("零页面 JS 异常", errs.length === 0, JSON.stringify(errs));
c.close();
console.log(`\nA4 验签：${out.steps.length - out.fail}/${out.steps.length} PASS`);
process.exit(out.fail ? 1 : 0);
