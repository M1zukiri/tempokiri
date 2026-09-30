// 创建时间：2026-08-26 20:00:00
/**
 * verify_ui.mjs — UI 修复前后对照验证（无头 Edge + CDP 9338）。
 *
 * 用法（先启动无头 Edge，remote-debugging-port=9338）：
 *   node tools/verify_ui.mjs before   # 修复前基线（失败断言仅记录，不退出码）
 *   node tools/verify_ui.mjs after    # 修复后校验（任一失败 → 退出码 1）
 *
 * 输出：tools/ui_shots/{before,after}/*.png + assertions.json（21 项断言 PASS/FAIL）。
 * 场景覆盖：H1-H5、M1-M9、N1-N7（S1-S12）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, wavInfo } from './e2e_lib.mjs';

const MODE = (process.argv[2] === 'before') ? 'before' : 'after';
const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const VID = path.resolve('examples/test_video.mp4');
const OUT = path.resolve('tools/ui_shots', MODE);
fs.mkdirSync(OUT, { recursive: true });

const ASSERTS = [];
let cdp = null;
let shotNo = 0;

function shot(name) {
  shotNo++;
  const file = path.join(OUT, `s${String(shotNo).padStart(2, '0')}_${name}.png`);
  return cdp.screenshot(file).then(() => file);
}
function check(name, cond, detail) {
  const pass = !!cond;
  ASSERTS.push({ name, pass, detail: String(detail ?? '').slice(0, 300) });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} = ${String(detail ?? '').slice(0, 160)}`);
  return pass;
}
async function record(name, fn) {
  try {
    const v = await fn();
    ASSERTS.push({ name, pass: null, detail: String(v ?? '').slice(0, 300) });
    console.log(`  [REC ] ${name} = ${String(v ?? '').slice(0, 160)}`);
  } catch (e) {
    ASSERTS.push({ name, pass: null, detail: 'ERR: ' + e.message });
    console.log(`  [REC ] ${name} = ERR: ${e.message}`);
  }
}

// ---------- 通用步骤 ----------
async function waveXYOf(ratio) {
  const r = await cdp.evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  return { x: r.x + ratio * r.w, y: r.y + r.h / 2 };
}
async function pressCtrlZ() {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(350);
}
async function boot(theme) {
  const url = pathToFileURL(DIST).href;
  await cdp.navigate(url);
  await cdp.evalJs('localStorage.clear()');
  if (theme) await cdp.evalJs(`localStorage.setItem('tempokiri.remix.global.v1', JSON.stringify({theme:'${theme}'}))`);
  await cdp.navigate(url);
  await cdp.injectFile(WAV);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
  await sleep(300);
}
async function applyGrid120() {
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await cdp.evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('mOffset').value='0'; document.getElementById('mOffset').dispatchEvent(new Event('change',{bubbles:true})); true");
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  await sleep(300);
}
async function addCardAt(ratio) {
  const p = await waveXYOf(ratio);
  await cdp.mouse('dbl', p.x, p.y);
  await sleep(300);
  await cdp.click('#btnAddSelection');
  await sleep(250);
}
function parseRgb(s) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] ? parseFloat(m[4]) : 1] : null;
}
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(c1, c2) {
  const l1 = lum(c1), l2 = lum(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const evalJs = (e) => cdp.evalJs(e);

// ---------- S1 启动空态（H3 引导卡） ----------
async function s1() {
  console.log('\n===== S1 启动空态（H3） =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);
  await sleep(500);
  await record('S1.hintCard可见', () => evalJs("(() => { const c = document.getElementById('hintCard'); return JSON.stringify({exists: !!c, hidden: c ? c.hidden : null, waveHintHidden: document.getElementById('waveHint').hidden}); })()"));
  check('S1 空态显示引导卡（H3）', await evalJs("(() => { const c = document.getElementById('hintCard'); return !!c && !c.hidden && document.getElementById('btnHintOpen'); })()"), 'hintCard 可见且含打开按钮');
  check('S1 初始 waveHint 隐藏', await evalJs("document.getElementById('waveHint').hidden === true"), 'waveHint.hidden');
  check('S1 空态 no-file 光标', await evalJs("document.getElementById('waveWrap').classList.contains('no-file')"), 'waveWrap.no-file');
  check('S1 空态控制栏隐藏（hidden 覆盖修复）', await evalJs("getComputedStyle(document.getElementById('controlBar')).display === 'none'"), 'controlBar display=none');
  check('S1 空态快捷栏隐藏', await evalJs("getComputedStyle(document.getElementById('quickBar')).display === 'none'"), 'quickBar display=none');
  const f = await shot('boot_empty');
  check('S1 截图已保存', !!f, f);
}

// ---------- S2 载入未设网格（H3 点击引导） ----------
async function s2() {
  console.log('\n===== S2 载入未设网格（H3） =====');
  await boot();
  await record('S2.hintCard/waveHint', () => evalJs("JSON.stringify({hintCardHidden: document.getElementById('hintCard') ? document.getElementById('hintCard').hidden : 'absent', waveHint: document.getElementById('waveHint').innerText.trim()})"));
  check('S2 载入后引导卡隐藏', await evalJs("(() => { const c = document.getElementById('hintCard'); return c ? c.hidden === true : true; })()"), 'hintCard 隐藏或未引入');
  check('S2 waveHint 显示配置引导', await evalJs("document.getElementById('waveHint').innerText.indexOf('设置节拍') !== -1"), 'configureGrid 文案');
  check('S2 no-file 类已移除', await evalJs("!document.getElementById('waveWrap').classList.contains('no-file')"), 'waveWrap.no-file');
  // 点击波形（无网格）→ 应打开设置弹窗（H3）
  const c = await cdp.center('#wave');
  await cdp.mouse('click', c.x, c.y);
  await sleep(500);
  const opened = await evalJs("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()");
  check('S2 无网格点击波形打开设置（H3）', opened, 'modalOverlay 可见');
  await evalJs("(() => { const b = document.getElementById('mCancel'); if (b) b.click(); return true; })()");
  await sleep(200);
  const f2 = await shot('load_nogrid');
  check('S2 截图已保存', !!f2, f2);
}

// ---------- S3 应用网格后（H5 残留 / M2 图例） ----------
async function s3() {
  console.log('\n===== S3 应用网格后（H5 / M2） =====');
  await boot();
  await applyGrid120();
  await record('S3.gridApplied', () => evalJs("JSON.stringify({waveHintHidden: document.getElementById('waveHint').hidden, quickBar: !document.getElementById('quickBar').hidden})"));
  check('S3 waveHint 已隐藏（H5）', await evalJs("document.getElementById('waveHint').hidden === true"), '无残留覆盖');
  check('S3 快捷栏可见', await evalJs("!document.getElementById('quickBar').hidden"), 'quickBar');
  check('S3 图例可见（M2）', await evalJs("(() => { const l = document.getElementById('waveLegend'); return !!l && !l.hidden; })()"), 'waveLegend');
  const f4 = await shot('grid_applied');
  check('S3 截图已保存', !!f4, f4);
}

// ---------- S4 序列与播放态（M3 / M5 / N7） ----------
async function s4() {
  console.log('\n===== S4 序列与播放态（M3 / M5 / N7） =====');
  await boot();
  await applyGrid120();
  await addCardAt(3 / 16);
  await addCardAt(9 / 16);
  check('S4 两卡片', (await evalJs("document.querySelectorAll('#seqList .seq-card').length")) === 2, 'cards=2');
  await record('S4.卡片内容', () => evalJs("JSON.stringify([...document.querySelectorAll('#seqList .seq-card')].map(c => c.innerText.replace(/\\s+/g,' ').slice(0,120)))"));
  check('S4 卡片默认折叠（M3）', await evalJs("(() => { const d = document.querySelector('#seqList .seq-card .seq-detail'); return d && getComputedStyle(d).display === 'none'; })()"), '.seq-detail 隐藏');
  await evalJs("(() => { const b = document.querySelector('#seqList .seq-card .seq-toggle'); if (b) b.click(); return true; })()");
  await sleep(250);
  check('S4 点击后展开（M3）', await evalJs("(() => { const d = document.querySelector('#seqList .seq-card .seq-detail'); return d && getComputedStyle(d).display !== 'none'; })()"), '.seq-detail 可见');
  const f7 = await shot('seq_cards_expanded');
  // 收起恢复
  await evalJs("(() => { const b = document.querySelector('#seqList .seq-card .seq-toggle'); if (b) b.click(); return true; })()");
  await sleep(200);
  // 播放序列 → 播放态高亮（M5）
  await cdp.click('#btnPlaySeq');
  await sleep(1200);
  await record('S4.播放态', () => evalJs("JSON.stringify({playSeq: document.getElementById('btnPlaySeq').className, play: document.getElementById('btnPlay').className})"));
  check('S4 播放序列按钮高亮（M5）', await evalJs("document.getElementById('btnPlaySeq').classList.contains('playing')"), 'btnPlaySeq.playing');
  check('S4 原曲按钮弱化（M5）', await evalJs("document.getElementById('btnPlay').classList.contains('dimmed')"), 'btnPlay.dimmed');
  const f8 = await shot('seq_playing');
  // N7：真实拖动进度条（按住移动，未释放时检查 tip）
  const tr = await cdp.center('#seqProgressTrack');
  const ty = tr.top + tr.height / 2;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tr.left + tr.width * 0.25, y: ty, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(120);
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tr.left + tr.width * (0.25 + 0.3 * i / 5), y: ty, button: 'left', buttons: 1 });
    await sleep(50);
  }
  await sleep(120);
  await record('S4.拖拽tip', () => evalJs("(() => { const t = document.getElementById('seqProgressTip'); return JSON.stringify({exists: !!t, visible: t ? !t.hidden : null, text: t ? t.textContent : null}); })()"));
  check('S4 拖拽显示时间 tip（N7）', await evalJs("(() => { const t = document.getElementById('seqProgressTip'); return !!t && !t.hidden && /\\d+:\\d+/.test(t.textContent); })()"), 'tip 文本含时间');
  const f9 = await shot('seq_progress_tip');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tr.left + tr.width * 0.55, y: ty, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  check('S4 截图已保存', !!(f7 && f8 && f9), [f7, f8, f9].join(';'));
}

// ---------- S5 自动剪辑方案弹窗（H1，三主题对比） ----------
async function s5() {
  console.log('\n===== S5 自动剪辑方案摘要（H1，三主题） =====');
  for (const theme of ['aurora', 'nebula', 'paper']) {
    await boot(theme);
    await applyGrid120();
    await cdp.click('#btnAutoCut');
    await cdp.waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden; })()", 8000, '自动剪辑弹窗');
    await cdp.waitFor("document.getElementById('acSummary') && document.getElementById('acSummary').textContent.length > 3", 12000, '摘要文本');
    const info = await evalJs(`(() => {
      const s = document.getElementById('acSummary');
      const m = document.querySelector('#autoCutOverlay .modal');
      const cs = getComputedStyle(s), cm = getComputedStyle(m);
      return JSON.stringify({ text: s.textContent, color: cs.color, bg: cm.backgroundColor });
    })()`);
    const j = JSON.parse(info);
    const c1 = parseRgb(j.color), c2 = parseRgb(j.bg);
    const ratio = (c1 && c2) ? contrast(c1, c2) : 0;
    const shoot = await shot(`autocut_summary_${theme}`);
    check(`S5 ${theme} 摘要对比度≥4.5（H1）`, ratio >= 4.5, `${j.text} color=${j.color} ratio=${ratio.toFixed(2)}`);
    check(`S5 ${theme} 截图已保存`, !!shoot, shoot);
    if (theme === 'aurora') {
      // 采用一个候选终点 → 锚定后「恢复默认方案」按钮出现（布局不得竖排）
      await evalJs("(() => { const b = document.querySelector('#acSegsBody .ac-use'); if (b) b.click(); return true; })()");
      await sleep(400);
      check('S5 锚定后恢复按钮可见', await evalJs("(() => { const b = document.getElementById('acReset'); return !!b && !b.hidden; })()"), 'acReset 可见');
      const rl = await evalJs("(() => { const b = document.getElementById('acReset'); return b ? (b.getBoundingClientRect().width + 'x' + b.getBoundingClientRect().height) : null; })()");
      check('S5 恢复按钮横排（非竖排）', /^\d+x(13|14|15|16)$/.test(rl || ''), '尺寸=' + rl);
      const fs5 = await shot('autocut_reset_button');
      check('S5 恢复按钮截图已保存', !!fs5, fs5);
    }
  }
}

// ---------- S6 节拍设置弹窗（N5 / M9） ----------
async function s6() {
  console.log('\n===== S6 节拍设置弹窗（N5 / M9） =====');
  await boot();
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await record('S6.表头', () => evalJs("JSON.stringify({note: (document.querySelector('#modalOverlay .seg-note') || {}).textContent || null, th: (document.querySelector('#modalOverlay .seg-table th') || {innerText:''}).innerText.replace(/\\s+/g,' ')})"));
  check('S6 表头无 th-sub 堆叠（N5）', await evalJs("!document.querySelector('#modalOverlay .seg-table .th-sub')"), '移除 th-sub');
  check('S6 说明行存在（N5）', await evalJs("!!document.querySelector('#modalOverlay .seg-note')"), 'seg-note');
  await cdp.click('.seg-auto');
  await cdp.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('识别失败') !== -1", 30000, '识别');
  await sleep(300);
  await record('S6.候选BPM', () => evalJs("document.getElementById('autoCands').innerText.replace(/\\s+/g,' ').slice(0,200)"));
  check('S6 候选带「点击采用」提示（M9）', await evalJs("document.getElementById('autoCands').innerText.indexOf('点击采用') !== -1"), 'cands 前缀');
  // 按钮横排（btn-mini 通用规则）：识别/Tap/候选按钮均不得竖排截断
  const btnRects = await evalJs(`JSON.stringify({
    auto: (() => { const b = document.querySelector('.seg-auto'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    tap: (() => { const b = document.querySelector('.seg-tap'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    cands: [...document.querySelectorAll('.auto-cand-bpm')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), b.textContent]; }),
  })`);
  const bj = JSON.parse(btnRects);
  check('S6 识别按钮横排（非竖排）', bj.auto[0] >= 32 && bj.auto[1] <= 30, '识别 尺寸=' + bj.auto.join('x'));
  check('S6 Tap 按钮横排', bj.tap[0] >= 44 && bj.tap[1] <= 30, 'Tap 尺寸=' + bj.tap.join('x'));
  check('S6 候选按钮横排完整', bj.cands.every((c) => c[0] >= 40 && c[1] <= 30 && c[2].length > 0), JSON.stringify(bj.cands));
  const texts = bj.cands.map((c) => c[2].split('（')[0]);
  check('S6 候选 BPM 去重', new Set(texts).size === texts.length, JSON.stringify(texts));
  const f = await shot('bpm_modal_cands');
  check('S6 截图已保存', !!f, f);
}

// ---------- S7 导出弹窗（M4 / N6） ----------
async function s7() {
  console.log('\n===== S7 导出弹窗（M4 / N6） =====');
  await boot();
  await applyGrid120();
  await addCardAt(3 / 16); // 导出弹窗要求序列非空（openExportDialog 守卫）
  await cdp.click('#btnExport');
  await cdp.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗');
  await record('S7.分组', () => evalJs("JSON.stringify([...document.querySelectorAll('#exportOverlay .exp-group-title')].map(g => g.textContent))"));
  check('S7 音频面板分组≥2（M4）', await evalJs("document.querySelectorAll('#exportOverlay .exp-panel[data-panel=audio] .exp-group').length >= 2"), 'exp-group 数量');
  const ab = await evalJs("getComputedStyle(document.querySelector('#exportOverlay .exp-tab.active')).backgroundColor");
  check('S7 active tab 有背景（N6）', parseRgb(ab) && parseRgb(ab)[3] > 0.05, 'bg=' + ab);
  const f = await shot('export_audio');
  check('S7 截图已保存', !!f, f);
}

// ---------- S8 主题按钮与五主题波形（M8 / H2 / 1.13.0） ----------
async function s8() {
  console.log('\n===== S8 主题快捷切换（M8 / H2） =====');
  await boot('aurora');
  await applyGrid120();
  await record('S8.主题按钮初始', () => evalJs("(() => { const b = document.getElementById('btnTheme'); return JSON.stringify({exists: !!b, label: b ? b.textContent : null, theme: document.documentElement.dataset.theme}); })()"));
  check('S8 页脚主题按钮存在（M8）', await evalJs("!!document.getElementById('btnTheme')"), 'btnTheme');
  if (await evalJs("!!document.getElementById('btnTheme')")) {
    const expectOrder = ['nebula', 'paper', 'seigaiha', 'kurenai', 'aurora'];
    let shots = [];
    for (const expect of expectOrder) {
      await cdp.click('#btnTheme');
      await sleep(600);
      check(`S8 点击切到 ${expect}`, await evalJs(`document.documentElement.dataset.theme === '${expect}'`), `data-theme=${expect}`);
      shots.push(await shot(`theme_${expect}`));
    }
    await record('S8.主题持久化', () => evalJs("JSON.parse(localStorage.getItem('tempokiri.remix.global.v1') || '{}').theme"));
    check('S8 截图已保存', shots.every(Boolean), shots.join(';'));
  } else {
    check('S8 点击后切到 nebula', false, 'before 状态无 btnTheme：跳过循环');
  }
}

// ---------- S9 删除与撤销（H4） ----------
async function s9() {
  console.log('\n===== S9 删除与撤销（H4） =====');
  await boot();
  await applyGrid120();
  await addCardAt(3 / 16);
  await addCardAt(9 / 16);
  const n0 = await evalJs("document.querySelectorAll('#seqList .seq-card').length");
  await evalJs("document.querySelector('#seqList .seq-card:last-child .del').click()");
  await sleep(400);
  const n1 = await evalJs("document.querySelectorAll('#seqList .seq-card').length");
  const st = await evalJs("document.getElementById('statusBar').textContent");
  check('S9 删除后卡片数-1', n1 === n0 - 1, `${n0}->${n1}`);
  check('S9 删除提示含撤销（H4）', st.indexOf('撤销') !== -1, st);
  const f = await shot('delete_hint');
  await pressCtrlZ();
  await sleep(400);
  const n2 = await evalJs("document.querySelectorAll('#seqList .seq-card').length");
  check('S9 Ctrl+Z 恢复（H4）', n2 === n0, `恢复后=${n2}（期望${n0}）`);
  check('S9 截图已保存', !!f, f);
}

// ---------- S10 窄屏 360 视频（M6） ----------
async function s10() {
  console.log('\n===== S10 窄屏 360 视频（M6） =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.setViewport(360, 800);
  await cdp.injectFile(VID);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 30000, '视频就绪');
  await sleep(1500);
  const ov = await evalJs("JSON.stringify({innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > window.innerWidth})");
  const oj = JSON.parse(ov);
  check('S10 360px 无横向溢出（M6）', !oj.overflow, ov);
  const f = await shot('narrow_360_video');
  check('S10 截图已保存', !!f, f);
  await cdp.setViewport(1440, 900);
}

// ---------- S11 状态栏分级（M7） ----------
async function s11() {
  console.log('\n===== S11 状态栏分级（M7） =====');
  await boot();
  await cdp.click('#btnManualAdd');
  await sleep(300);
  await evalJs("document.querySelector('#maStart .unit-mode-btn').click(); document.querySelector('#maEnd .unit-mode-btn').click()");
  await sleep(150);
  await evalJs("(() => { const set=(sel,v)=>{const i=document.querySelector(sel+' .unit-time'); i.value=String(v); i.dispatchEvent(new Event('change',{bubbles:true}));}; set('#maStart',5); set('#maEnd',2); return true; })()");
  await sleep(150);
  await cdp.click('#btnManualOk');
  await sleep(400);
  await record('S11.手动添加失败', () => evalJs("JSON.stringify({cls: document.getElementById('statusBar').className, text: document.getElementById('statusBar').textContent})"));
  check('S11 失败状态为 warn 色（M7）', await evalJs("document.getElementById('statusBar').classList.contains('status-warn')"), 'status-warn');
  const f = await shot('status_warn');
  check('S11 截图已保存', !!f, f);
}

// ---------- S12 引导卡窄屏（H3 布局） ----------
async function s12() {
  console.log('\n===== S12 引导卡 720px（H3） =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.setViewport(720, 900);
  await sleep(500);
  const r = await evalJs("(() => { const c = document.getElementById('hintCard'); if (!c) return JSON.stringify({absent: true}); const b = c.getBoundingClientRect(); return JSON.stringify({left: b.left, right: b.right, w: innerWidth, inView: b.left >= 0 && b.right <= innerWidth + 1}); })()");
  const rj = JSON.parse(r);
  check('S12 引导卡不破版', rj.inView === true, r);
  const f = await shot('hintcard_720');
  check('S12 截图已保存', !!f, f);
  await cdp.setViewport(1440, 900);
}

// ---------- 工具：WAV 指定区间峰值（16-bit 样本级检查） ----------
function wavPeakInRange(buf, sr, fromSec, toSec) {
  const startD = 44 + Math.max(0, Math.floor(fromSec * sr)) * 2;
  const endD = Math.min(buf.length - ((buf.length - 44) % 2 || 2), 44 + Math.floor(toSec * sr) * 2);
  let peak = 0;
  for (let i = startD; i + 1 < endD; i += 2) {
    const v = Math.abs(buf.readInt16LE(i));
    if (v > peak) peak = v;
  }
  return peak;
}

/** 通过导出弹窗下载 WAV 并返回文件路径。 */
async function exportWav(name) {
  await cdp.click('#btnExport');
  await cdp.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗');
  await evalJs(`document.getElementById('aName').value = ${JSON.stringify(name)}; true`);
  await cdp.prepareDownloads(path.join(OUT, 'dl'));
  const before = Date.now();
  await cdp.click('#xOk');
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('导出完成') !== -1 || document.getElementById('statusBar').textContent.indexOf('导出失败') !== -1", 90000, '导出结束');
  return cdp.waitForDownload(path.join(OUT, 'dl'), '.wav', 60000, before - 1000);
}

// ---------- S13 静音段（新功能） ----------
async function s13() {
  console.log('\n===== S13 静音段（新功能） =====');
  await boot();
  await applyGrid120();
  await cdp.click('#btnSilentAdd');
  await sleep(200);
  check('S13 静音表单可见', await evalJs("!document.getElementById('silentForm').hidden"), 'silentForm');
  await evalJs("document.getElementById('silentUnit').value='bar'; document.getElementById('silentQty').value='2'; true");
  await cdp.click('#btnSilentOk');
  await sleep(400);
  const cardObj = JSON.parse(await evalJs("(() => { const c = document.querySelector('#seqList .seq-card'); return JSON.stringify({cls: c.className, text: c.innerText.replace(/\\s+/g,' ').slice(0,90)}); })()"));
  check('S13 静音卡片渲染', cardObj.cls.includes('silent') && cardObj.text.includes('静音'), cardObj.text);
  check('S13 2 小节 = 4.0s（120BPM 4/4）', await evalJs("(document.querySelector('.seq-silent') || {textContent:''}).textContent.indexOf('4.0s') !== -1"), await evalJs("(document.querySelector('.seq-silent') || {textContent:''}).textContent"));
  check('S13 总时长 4.0s', await evalJs("document.getElementById('seqProgressTime').textContent.indexOf('/ 0:04.0') !== -1"), await evalJs("document.getElementById('seqProgressTime').textContent"));
  // 无网格时拍/小节禁用（新 boot 验证入口限制）
  const f = await shot('silent_card');
  check('S13 截图已保存', !!f, f);
  // 导出 WAV：4s 全静音（峰值 0）
  const wav = await exportWav('silent_test');
  const wv = wavInfo(fs.readFileSync(wav));
  check('S13 导出 WAV 时长为 4.0s', Math.abs(wv.dur - 4.0) < 0.02, `dur=${wv.dur.toFixed(3)}`);
  check('S13 导出峰值=0（全静音）', wv.peak === 0, `peak=${wv.peak}`);
}

// ---------- S14 负 offset 首小节补静音导出 ----------
async function s14() {
  console.log('\n===== S14 负 offset 首小节补静音 =====');
  await boot();
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await evalJs("document.querySelector('.seg-bpm').value='120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change',{bubbles:true})); const o=document.getElementById('mOffset'); o.value='-0.5'; o.dispatchEvent(new Event('change',{bubbles:true})); true");
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  check('S14 快捷栏偏移 -0.500', (await evalJs("document.getElementById('qOffsetVal').textContent")) === '-0.500', await evalJs("document.getElementById('qOffsetVal').textContent"));
  // 双击选中第 1 小节（t=0.1s → ratio ≈ 0.1/16）
  await addCardAt(0.1 / 16);
  check('S14 第 1 小节时长 2.0s', await evalJs("document.getElementById('seqInfo').textContent.indexOf('0:02.0') !== -1"), await evalJs("document.getElementById('seqInfo').textContent"));
  const f = await shot('offset_neg_first_bar');
  // 导出：2.0s 全长 = 0.5s 静音 + 1.5s 原曲；WAV 样本级校验
  const wav = await exportWav('offset_neg_test');
  const buf = fs.readFileSync(wav);
  const wv = wavInfo(buf);
  check('S14 导出时长 2.0s', Math.abs(wv.dur - 2.0) < 0.02, `dur=${wv.dur.toFixed(3)}`);
  const pkHead = wavPeakInRange(buf, wv.sr, 0, 0.48);
  const pkBody = wavPeakInRange(buf, wv.sr, 0.6, 1.4);
  check('S14 前 0.5s 全静音', pkHead === 0, `headPeak=${pkHead}`);
  check('S14 0.5s 后为原曲（非零）', pkBody > 500, `bodyPeak=${pkBody}`);
  check('S14 截图已保存', !!f, f);
}

// ---------- S15 空段落拦截 ----------
async function s15() {
  console.log('\n===== S15 空段落拦截 =====');
  await boot(); // 无网格：手动添加走时间模式
  await cdp.click('#btnManualAdd');
  await sleep(300);
  await evalJs("document.querySelector('#maStart .unit-mode-btn').click(); document.querySelector('#maEnd .unit-mode-btn').click()");
  await sleep(150);
  const setRange = async (s, e) => {
    await evalJs(`(() => { const set=(sel,v)=>{const i=document.querySelector(sel+' .unit-time'); i.value=String(v); i.dispatchEvent(new Event('change',{bubbles:true}));}; set('#maStart',${s}); set('#maEnd',${e}); return true; })()`);
    await sleep(150);
    await cdp.click('#btnManualOk');
    await sleep(350);
  };
  await setRange(20, 22); // 完全越界（曲长 16s）
  check('S15 [20,22] 拒绝', (await evalJs("document.getElementById('statusBar').textContent")).indexOf('无法添加') !== -1, await evalJs("document.getElementById('statusBar').textContent"));
  check('S15 [20,22] 卡片数 0', (await evalJs("document.querySelectorAll('#seqList .seq-card').length")) === 0, 'cards=0');
  await setRange(16, 17); // 起点在曲尾
  check('S15 [16,17] 拒绝', (await evalJs("document.getElementById('statusBar').textContent")).indexOf('无法添加') !== -1, await evalJs("document.getElementById('statusBar').textContent"));
  await setRange(-5, -1); // 完全在曲前：unitInput 层拒绝负值（提示「请检查」或「无法添加」均可）
  check('S15 [-5,-1] 拒绝', (await evalJs("document.getElementById('statusBar').textContent")).indexOf('无法添加') !== -1 || (await evalJs("document.getElementById('statusBar').textContent")).indexOf('手动添加失败') !== -1, await evalJs("document.getElementById('statusBar').textContent"));
  await setRange(15.5, 100); // 部分重叠（用户用例）→ 允许
  check('S15 [15.5,100] 允许', (await evalJs("document.querySelectorAll('#seqList .seq-card').length")) === 1, 'cards=1');
  await setRange(2, 1); // 倒置
  check('S15 [2,1] 倒置拒绝', (await evalJs("document.querySelectorAll('#seqList .seq-card').length")) === 1, 'cards 保持 1');
  const f = await shot('empty_item_reject');
  check('S15 截图已保存', !!f, f);
}

// ---------- 主流程 ----------
cdp = await Cdp.connect();
// 统一视口：headless 默认 800x600，seq 面板区域（进度条 y>675）会落到视口外导致命中测试失效
await cdp.setViewport(1440, 900);
await sleep(300);
console.log('\n===== verify_ui (' + MODE + ') 开始 =====');
await s1();
await s2();
await s3();
await s4();
await s5();
await s6();
await s7();
await s8();
await s9();
await s10();
await s11();
await s12();
await s13();
await s14();
await s15();
await cdp.close();

const fails = ASSERTS.filter((a) => a.pass === false);
const pass = ASSERTS.filter((a) => a.pass === true);
fs.writeFileSync(path.join(OUT, 'assertions.json'), JSON.stringify({
  mode: MODE, at: new Date().toISOString(), dist: DIST,
  summary: { total: ASSERTS.length, pass: pass.length, fail: fails.length, rec: ASSERTS.length - pass.length - fails.length },
  items: ASSERTS,
}, null, 2));
console.log(`\n===== 完成：${pass.length} PASS / ${fails.length} FAIL / ${ASSERTS.length - pass.length - fails.length} REC =====`);
if (MODE === 'after' && fails.length) { console.log('修复后存在失败断言：\n  ' + fails.map((f) => f.name).join('\n  ')); process.exitCode = 1; }
