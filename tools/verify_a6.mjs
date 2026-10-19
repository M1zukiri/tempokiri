// 创建时间：2026-10-19 16:15:00
/**
 * verify_a6.mjs — 批注 a6 无头实测：Monochrome 黑白灰主题。
 *
 * 断言：
 *   1. 页脚主题按钮循环 5 次（aurora→nebula→paper→seigaiha→kurenai→mono）落到 mono，
 *      按钮文案为 Monochrome 且 localStorage 已持久化
 *   2. body 背景纯黑（灰阶且明度极低）
 *   3. 12 个关键 CSS 令牌在 mono 下全部为灰阶（r=g=b，严格无彩）
 *   4. 波形画布主题（MC.render.THEME）的 wave/selBorder/playLine/cutLine 均为灰阶
 *   5. 截图留档 tools/ui_shots/mono.png
 * 前置：无头 Edge 已以 --remote-debugging-port=9338 启动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const OUT = path.resolve('tools/ui_shots');
fs.mkdirSync(OUT, { recursive: true });

let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const c = await Cdp.connect();
await c.navigate(pathToFileURL(DIST).href);
await c.evalJs('localStorage.clear()');
await c.navigate(pathToFileURL(DIST).href);

// 主题循环：aurora 起，点 6 次回到 aurora；第 5 次落到 mono
const order = ['nebula', 'paper', 'seigaiha', 'kurenai', 'mono', 'aurora'];
let monoOk = false;
for (const expect of order) {
  await c.click('#btnTheme');
  await sleep(260);
  const got = await c.evalJs(`document.documentElement.dataset.theme`);
  ok('循环切到 ' + expect, got === expect, `data-theme=${got}`);
  if (expect === 'mono') {
    monoOk = got === 'mono';
    const label = await c.evalJs(`document.getElementById('themeName').textContent`);
    ok('主题按钮循环到 mono', monoOk, `data-theme=${got} label=${label}`);
    ok('按钮文案为 Monochrome', label === 'Monochrome', label);
    const stored = await c.evalJs(`JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').theme`);
    ok('localStorage 持久化 theme=mono', stored === 'mono', String(stored));
  }
}

// 循环最后一步已回到 aurora——量颜色前显式切回 mono
await c.evalJs(`document.documentElement.setAttribute('data-theme','mono')`);
await sleep(220);

const COLOR_JS = `(() => {
  const parse = (v) => {
    v = String(v).trim();
    if (/^#([0-9a-f]{3})$/i.test(v)) { const h = v.slice(1); return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)]; }
    if (/^#([0-9a-f]{6})$/i.test(v)) { const h = v.slice(1); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); }
    const m = v.match(/rgba?\\(([^)]+)\\)/i);
    if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return [p[0], p[1], p[2]]; }
    return null;
  };
  const gray = (c) => !!c && Math.abs(c[0]-c[1]) <= 1 && Math.abs(c[1]-c[2]) <= 1;
  const cs = getComputedStyle(document.documentElement);
  const keys = ['--bg-app','--surface-base','--surface-raised','--accent','--accent-2','--text-primary','--text-secondary','--text-tertiary','--danger','--warning','--success','--lcd-fg'];
  const out = {};
  for (const k of keys) { const raw = cs.getPropertyValue(k).trim(); out[k] = { raw, rgb: parse(raw), gray: gray(parse(raw)) }; }
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
  return JSON.stringify({ tokens: out, bodyBg, bodyGray: gray(bodyBg), bodyDark: !!bodyBg && bodyBg[0] <= 8 && bodyBg[1] <= 8 && bodyBg[2] <= 8 });
})()`;

const color = JSON.parse(await c.evalJs(COLOR_JS));
const bad = Object.entries(color.tokens).filter(([, v]) => !v.gray).map(([k, v]) => `${k}=${v.raw}`);
ok('12 个关键令牌全部为灰阶', bad.length === 0, bad.join(', '));
ok('body 背景为纯黑且灰阶', color.bodyGray && color.bodyDark, JSON.stringify(color.bodyBg));

const canvasTheme = await c.evalJs(`(() => {
  MC.setTheme('mono');
  const t = MC.THEME;
  const g = (s) => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/i);
    if (m) { const p = m[1].split(',').map(Number); return Math.abs(p[0]-p[1]) <= 1 && Math.abs(p[1]-p[2]) <= 1; }
    const h = String(s).replace('#','');
    if (h.length === 6) { const n = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); return n[0] === n[1] && n[1] === n[2]; }
    return false;
  };
  return JSON.stringify({ wave: t.wave, selBorder: t.selBorder, playLine: t.playLine, cutLine: t.cutLine,
    grays: g(t.wave) && g(t.selBorder) && g(t.playLine) && g(t.cutLine) });
})()`);
const ct = JSON.parse(canvasTheme);
ok('画布主题色全部为灰阶', ct.grays, `wave=${ct.wave} playLine=${ct.playLine} cutLine=${ct.cutLine}`);

// 截图留档
const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
const shotFile = path.join(OUT, 'mono.png');
fs.writeFileSync(shotFile, Buffer.from(data, 'base64'));
ok('截图已保存', fs.existsSync(shotFile), shotFile);

const errs = await c.pageErrs();
ok('零页面 JS 异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));
c.close();
console.log(`\nA6 验签：${fail ? 'FAIL ' + fail : '全部 PASS'}`);
process.exit(fail ? 1 : 0);
