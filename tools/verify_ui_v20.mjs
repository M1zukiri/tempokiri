// 创建时间：2026-10-14 15:00:00
/**
 * verify_ui_v20.mjs —— UI 2.0 扁平高密度重排后验收（无头 Edge + CDP 9338）。
 *
 * 用法（先启动无头 Edge，remote-debugging-port=9338）：
 *   node tools/verify_ui_v20.mjs
 *
 * 覆盖：
 *   S1 载入 WAV 后零 JS 错误
 *   S2 走带条（#controlBar）几何位置必须在波形（#waveWrap）下方
 *   S3 五主题切换后 --accent 实际生效且不堪 Silver 回退
 *   S4 快捷微调、播放、添加选中区间可用（序列卡片渲染）；高密度行（19px 方形序号、4×18 进度条 knob）
 *   S5 六个弹窗（节拍设置/导出/元数据/自动剪辑/高级设置/README）零错误打开且圆角统一 ≤4px
 *   S6 360px 窄屏无横向溢出
 *   S8 舞台布局：波形 300px 高、视频预览位于波形右侧（360px 转上下堆叠）；已有网格时切文件走工作区确认
 *   S9 五主题下被引用的 CSS 变量全部可解析（令牌补齐回归防护）
 *   S10 页脚吸底（空态贴视口底部）
 * 输出：tools/ui_shots/v20/*.png + assertions.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, PORT, wavInfo } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const VID = path.resolve('examples/test_video.mp4');
const OUT = path.resolve('tools/ui_shots/v20');
fs.mkdirSync(OUT, { recursive: true });

const ASSERTS = [];
let shotNo = 0;

function ok(name, cond, detail = '') {
  ASSERTS.push({ name, pass: !!cond, detail: String(detail) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function shot(cdp, name) {
  shotNo++;
  const file = path.join(OUT, `s${String(shotNo).padStart(2, '0')}_${name}.png`);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

const cdp = await Cdp.connect();
const url = pathToFileURL(DIST).href;
// 清空持久化状态（user-data-dir 跨 run 保留 localStorage，会恢复上次的工作区/网格导致走带条换行）
await cdp.navigate(url);
await cdp.evalJs('localStorage.clear()');
await cdp.navigate(url);
await cdp.evalJs("(() => { const w = document.querySelector('#waveWrap'); return !!w; })()");

// ---------- S1 载入音频 ----------
await shot(cdp, 'empty');
await cdp.injectFile(WAV);
await cdp.waitFor("(() => { const c = document.querySelector('#controlBar'); return c && !c.hidden; })()", 15000, '控制栏出现');
await sleep(900);
await shot(cdp, 'loaded');
ok('S1-1 载入 WAV 后零 JS 错误', cdp.errs.length === 0, cdp.errs.join(' | ').slice(0, 200));

// ---------- S2 走带条在波形下方（本版核心布局要求） ----------
const geo = await cdp.evalJs(`(() => {
  const w = document.querySelector('#waveWrap').getBoundingClientRect();
  const c = document.querySelector('#controlBar').getBoundingClientRect();
  const s = document.querySelector('#statusBar')?.getBoundingClientRect();
  const p = document.querySelector('#sequencePanel').getBoundingClientRect();
  return { waveBottom: w.bottom, waveTop: w.top, ctlTop: c.top, ctlBottom: c.bottom, ctlH: c.height, statusTop: s ? s.top : -1, panelTop: p.top };
})()`);
ok('S2-1 走带条位于波形下方', geo.ctlTop >= geo.waveBottom - 1, `wave.bottom=${geo.waveBottom.toFixed(0)} ctl.top=${geo.ctlTop.toFixed(0)}`);
ok('S2-2 走带条在序列面板上方', geo.ctlBottom <= geo.panelTop + 1, `ctl.bottom=${geo.ctlBottom.toFixed(0)} panel.top=${geo.panelTop.toFixed(0)}`);
ok('S2-3 走带条高度 ≤ 60px（扁平紧凑）', geo.ctlH <= 60, `h=${geo.ctlH.toFixed(0)}`);

// 信息密度：首屏可见面板数量（无滚动即可看到的 UI 带数）
const density = await cdp.evalJs(`(() => {
  const vh = window.innerHeight;
  const above = ['#waveWrap', '#controlBar', '#sequencePanel'].filter(s => {
    const el = document.querySelector(s); return el && el.getBoundingClientRect().top < vh;
  }).length;
  return { vh, visibleBands: above, scrollY: document.body.scrollHeight - vh };
})()`);
ok('S2-4 首屏可见 波形+走带+序列 三区', density.visibleBands === 3, JSON.stringify(density));

// ---------- S3 五主题切换 ----------
const themes = ['aurora', 'nebula', 'paper', 'seigaiha', 'kurenai'];
const accents = {};
for (const t of themes) {
  await cdp.evalJs(`document.documentElement.setAttribute('data-theme','${t}')`);
  await sleep(220);
  accents[t] = await cdp.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
  await shot(cdp, 'theme-' + t);
}
const uniq = new Set(Object.values(accents));
ok('S3-1 五主题 accent 各不相同', uniq.size === 5, JSON.stringify(accents));
ok('S3-2 五主题均取到有效色值', Object.values(accents).every(v => /^#|^rgb/.test(v)), JSON.stringify(accents));
await cdp.evalJs(`document.documentElement.setAttribute('data-theme','aurora')`);
await sleep(200);

// ---------- S4 交互流程：应用网格 → 双击选小节 → 添加 → 序列卡片 ----------
// 应用网格（BPM 120 / offset 0），与 verify_ui 既定流程一致
await cdp.click('#btnSettings');
await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 8000, '设置弹窗');
await cdp.evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
await sleep(250);
await cdp.click('#mOk');
await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
await sleep(400);
const legendShown = await cdp.evalJs(`(() => { const l = document.querySelector('#waveLegend'); return l && !l.hidden; })()`);
ok('S4-0 应用网格后图例显示', !!legendShown);
await shot(cdp, 'grid-applied');

const box = await cdp.evalJs(`(() => { const r = document.querySelector('#waveWrap').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
await cdp.mouse('dbl', box.x + box.w * 0.15, box.y + box.h / 2);
await sleep(400);
const selVisible = await cdp.evalJs(`(() => { const b = document.querySelector('#btnAddSelection'); return b && !b.disabled; })()`);
ok('S4-1 双击选中区间（添加区间按钮可用）', !!selVisible);
if (selVisible) {
  await cdp.click('#btnAddSelection');
  await sleep(500);
}
const cards = await cdp.evalJs(`document.querySelectorAll('#seqList .seq-card').length`);
ok('S4-2 序列卡片已渲染', cards >= 1, `cards=${cards}`);
// 静音段表单
await cdp.click('#btnSilentAdd');
await sleep(350);
const silentOpen = await cdp.evalJs(`(() => { const f = document.querySelector('#silentForm'); return f && !f.hidden; })()`);
ok('S4-3 静音段表单可展开', !!silentOpen);
await shot(cdp, 'silent-form');
await cdp.click('#btnSilentCancel');
await sleep(250);
// 卡片折叠区（淡入淡出）
await cdp.click('#seqList .seq-card .seq-toggle');
await sleep(300);
const detailOpen = await cdp.evalJs(`(() => { const d = document.querySelector('#seqList .seq-card .seq-detail'); return d && !d.hidden; })()`);
ok('S4-4 卡片淡化折叠区可展开', !!detailOpen);
await shot(cdp, 'card-detail');
// 快速微调 BPM
const bpmBefore = await cdp.evalJs(`document.querySelector('#qBpmVal').textContent`);
await cdp.click('.q-btns.q-pos .btn-mini[data-q="bpm"]');
await sleep(350);
const bpmAfter = await cdp.evalJs(`document.querySelector('#qBpmVal').textContent`);
ok('S4-5 BPM 快捷微调生效', bpmBefore !== bpmAfter, `${bpmBefore} → ${bpmAfter}`);

// 高密度行（本版核心之一）：方形序号 + 玫红竖条 knob
const dense = await cdp.evalJs(`(() => {
  const num = document.querySelector('#seqList .seq-num');
  const knob = document.querySelector('#seqProgressKnob');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
  return { num: box(num), knob: box(knob), progressHidden: document.querySelector('#seqProgress').hidden };
})()`);
ok('S4-6 序列序号为 19px 方形块', !!dense.num && dense.num[0] === 19 && dense.num[1] === 19, JSON.stringify(dense));
ok('S4-7 进度条 knob 为 4×18 竖条', !dense.progressHidden && !!dense.knob && dense.knob[0] === 4 && dense.knob[1] === 18, JSON.stringify(dense));

// ---------- S5 弹窗 ----------
const modals = [
  ['#btnSettings', 'modal-setBpm', '.seg-table'],
  ['#btnExport', 'modal-export', '.exp-tabs'],
  ['#btnMeta', 'modal-meta', '.meta-form'],
  ['#btnAutoCut', 'modal-autocut', '.ac-params'],
  ['#btnAdvanced', 'modal-settings', '.as-form'],
  ['#btnReadme', 'modal-readme', '.readme-modal-body'],
];
for (const [btn, name, probe] of modals) {
  const before = cdp.errs.length;
  try {
    await cdp.click(btn);
    await sleep(600);
    const found = await cdp.evalJs(`!!document.querySelector(${JSON.stringify(probe)})`);
    ok(`S5 弹窗 ${name} 打开且有内容`, found && cdp.errs.length === before, found ? '' : '内容缺失');
    const radius = await cdp.evalJs(`(() => {
      const overlay = [...document.querySelectorAll('.modal-overlay')].find((o) => !o.hidden);
      if (!overlay) return null;
      const box = overlay.querySelector('.modal, .readme-modal');
      const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-lg'));
      const legacy8 = [...overlay.querySelectorAll('*')]
        .filter((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) === 8).length;
      return { r: box ? parseFloat(getComputedStyle(box).borderTopLeftRadius) : null, token, legacy8 };
    })()`);
    ok(`S5 弹窗 ${name} 圆角取设计令牌（统一）`, !!radius && radius.r === radius.token, JSON.stringify(radius));
    ok(`S5 弹窗 ${name} 无 8px 遗留圆角`, !!radius && radius.legacy8 === 0, `legacy8=${radius && radius.legacy8}`);
    await shot(cdp, name);
    // Esc 关闭
    await cdp.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(300);
  } catch (e) {
    ok(`S5 弹窗 ${name} 打开且有内容`, false, e.message);
  }
}

// ---------- S6 窄屏无横向溢出 ----------
await cdp.evalJs(`(() => { document.body.style.width='360px'; })()`);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 720, deviceScaleFactor: 1, mobile: true });
await sleep(500);
const overflow = await cdp.evalJs(`document.documentElement.scrollWidth - window.innerWidth`);
await shot(cdp, 'narrow-360');
ok('S6 360px 无横向溢出', overflow <= 1, `overflow=${overflow}px`);
await cdp.send('Emulation.clearDeviceMetricsOverride');
await cdp.evalJs(`(() => { document.body.style.width=''; })()`);

// ---------- S8 舞台布局：波形加高 · 视频预览右置（≤480px 转上下堆叠） ----------
await cdp.injectFile(VID);
// 已有网格/序列时切文件先弹「是否保留工作区」（main.js confirmWorkspace）→ 选「不保留」继续加载
let keepPrompted = false;
try {
  await cdp.waitFor("!!document.querySelector('[data-act=\"discard\"]')", 3000, '工作区确认弹窗');
  keepPrompted = true;
  await cdp.click('[data-act="discard"]');
} catch (e) { /* 无弹窗：当前无网格/序列 */ }
ok('S8-0 已有网格时打开新文件先确认工作区', keepPrompted, `prompted=${keepPrompted}`);
await cdp.waitFor("(() => { const v = document.querySelector('#videoWrap'); return v && !v.hidden; })()", 15000, '视频预览出现');
await sleep(700);
const stage = await cdp.evalJs(`(() => {
  const w = document.querySelector('#waveWrap').getBoundingClientRect();
  const v = document.querySelector('#videoWrap').getBoundingClientRect();
  return { waveH: Math.round(w.height), waveTop: Math.round(w.top), waveRight: Math.round(w.right), videoLeft: Math.round(v.left), videoTop: Math.round(v.top), videoW: Math.round(v.width) };
})()`);
ok('S8-1 波形高度 300px（本版加高）', Math.abs(stage.waveH - 300) <= 1, `waveH=${stage.waveH}`);
ok('S8-2 视频预览位于波形右侧（同一行）', stage.videoLeft >= stage.waveRight - 1 && Math.abs(stage.videoTop - stage.waveTop) <= 2, JSON.stringify(stage));
await shot(cdp, 'stage-video-right');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 720, deviceScaleFactor: 1, mobile: true });
await sleep(600);
const stacked = await cdp.evalJs(`(() => {
  const w = document.querySelector('#waveWrap').getBoundingClientRect();
  const v = document.querySelector('#videoWrap').getBoundingClientRect();
  return { stacked: v.top >= w.bottom - 1, videoW: Math.round(v.width), waveW: Math.round(w.width), overflow: document.documentElement.scrollWidth - window.innerWidth };
})()`);
await shot(cdp, 'narrow-360-video');
ok('S8-3 360px 下视频与波形上下堆叠且无溢出', stacked.stacked && stacked.overflow <= 1, JSON.stringify(stacked));
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(300);

// ---------- S9 设计令牌：五主题下被引用的 CSS 变量均可解析 ----------
const cssRefs = await cdp.evalJs(`(() => {
  const set = new Set();
  const scan = (txt) => { for (const m of String(txt).matchAll(/var\\(\\s*(--[a-zA-Z0-9-]+)/g)) set.add(m[1]); };
  for (const st of document.querySelectorAll('style')) scan(st.textContent);
  for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) scan(r.cssText); } catch (e) { /* 跨域表忽略 */ } }
  return [...set];
})()`);
const missingVars = {};
for (const t of themes) {
  await cdp.evalJs(`document.documentElement.setAttribute('data-theme','${t}')`);
  await sleep(180);
  const vals = await cdp.evalJs(`(() => { const cs = getComputedStyle(document.documentElement); const o = {}; for (const k of ${JSON.stringify(cssRefs)}) o[k] = cs.getPropertyValue(k).trim(); return o; })()`);
  const bad = Object.entries(vals).filter(([, v]) => !v).map(([k]) => k);
  if (bad.length) missingVars[t] = bad;
}
ok('S9-1 五主题下 CSS 变量引用全部可解析', Object.keys(missingVars).length === 0, `引用 ${cssRefs.length} 个 · 缺失 ${JSON.stringify(missingVars)}`);
await cdp.evalJs(`document.documentElement.setAttribute('data-theme','aurora')`);
await sleep(200);

// ---------- S10 页脚吸底（空态短内容贴视口底部） ----------
await cdp.navigate(url);
await sleep(500);
const foot = await cdp.evalJs(`(() => {
  const f = document.querySelector('.site-footer').getBoundingClientRect();
  return { gap: Math.round(window.innerHeight - f.bottom), bottom: Math.round(f.bottom), innerH: window.innerHeight };
})()`);
ok('S10 页脚吸底（空态贴视口底部）', Math.abs(foot.gap) <= 2, JSON.stringify(foot));
await shot(cdp, 'footer-bottom');

const errCount = cdp.errs.length;
ok('S7 全流程零 JS 错误', errCount === 0, cdp.errs.join(' | ').slice(0, 300));

const fail = ASSERTS.filter(a => !a.pass).length;
fs.writeFileSync(path.join(OUT, 'assertions.json'), JSON.stringify(ASSERTS, null, 2));
console.log(`\n=== ${ASSERTS.length - fail} PASS / ${fail} FAIL · 截图 ${shotNo} 张 → ${OUT} ===`);
process.exit(fail ? 1 : 0);
