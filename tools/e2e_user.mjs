// 创建时间：2026-08-23 23:20:00 ｜ 重建：2026-08-24 01:00（避免 PowerShell 中文编码破坏）
/**
 * e2e_user.mjs — 模拟真实用户的端到端体验测试（无头 Edge + CDP 9338）。
 * 用法：node tools/e2e_user.mjs [core|video|ui|perf|autocut]   （缺省=全部）
 * 依赖：tools/e2e_lib.mjs；先启动无头 Edge（remote-debugging-port=9338）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, wavInfo, mp3Info, mp4Info, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const VID = path.resolve('examples/test_video.mp4');
const VID_BIG = path.resolve('examples/shin_yohou.mp4');
const OUT = path.resolve('tools/e2e_out');
fs.mkdirSync(OUT, { recursive: true });
const RESULTS = {};
let cdp = null;

function rec(name, v) {
  RESULTS[name] = v;
  console.log('  [OK]   ' + name + ' = ' + clip(JSON.stringify(v)));
}
async function tryRec(name, fn) {
  try { rec(name, await fn()); } catch (e) { console.log('  [FAIL] ' + name + ' = ' + e.message); RESULTS[name] = 'FAIL: ' + e.message; }
}

/** 波形 canvas 上按比例定位 CSS 坐标（view 假设为全览）。 */
async function waveXYOf(ratio) {
  const r = await cdp.evalJs(`(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  return { x: r.x + ratio * r.w, y: r.y + r.h / 2 };
}

async function pressKey(key, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  await sleep(300);
}

/** 打开导出弹窗并等待可见。 */
async function openExport() {
  await cdp.click('#btnExport');
  await cdp.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗');
}

/** 等待导出状态栏出现 完成/失败。 */
async function waitExportStatus(timeoutMs = 90000) {
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('导出完成') !== -1 || document.getElementById('statusBar').textContent.indexOf('导出失败') !== -1 || document.getElementById('statusBar').textContent.indexOf('失败') !== -1", timeoutMs, '导出结束');
  return await cdp.evalJs("document.getElementById('statusBar').textContent");
}

// ---------------- core：音频核心链路 ----------------
async function stageCore() {
  console.log('\n===== STAGE CORE：音频全链路 =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);

  await tryRec('空状态-提示文案', () => cdp.evalJs("document.getElementById('waveHint').innerText.trim()"));
  await tryRec('空状态-按钮禁用', () => cdp.evalJs("JSON.stringify({settings: document.getElementById('btnSettings').disabled, autoCut: document.getElementById('btnAutoCut').disabled, export: document.getElementById('btnExport').disabled, play: document.getElementById('btnPlay').disabled})"));
  await tryRec('品牌版本徽标', () => cdp.evalJs("document.querySelector('[data-version]').textContent"));
  await tryRec('初始状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));

  const t0 = Date.now();
  await cdp.injectFile(WAV);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '音频就绪');
  rec('导入耗时(ms)', Date.now() - t0);
  await tryRec('导入后-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await tryRec('导入后-波形canvas', () => cdp.evalJs("(() => { const cv = document.getElementById('wave'); return cv.width + 'x' + cv.height; })()"));
  await tryRec('导入后-控制栏', () => cdp.evalJs("JSON.stringify({hidden: document.getElementById('controlBar').hidden, play: document.getElementById('btnPlay').disabled, autoCut: document.getElementById('btnAutoCut').disabled})"));

  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await tryRec('设置弹窗-标题', () => cdp.evalJs("document.getElementById('modalOverlay').textContent.replace(/\\s+/g, ' ').slice(0, 80)"));
  await cdp.evalJs('window.__t0 = performance.now()');
  await cdp.click('.seg-auto');
  tryRec('识别', async () => {
    await cdp.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('识别失败') !== -1", 30000, '识别完成');
    return await cdp.evalJs("JSON.stringify({ms: Math.round(performance.now() - window.__t0), status: document.getElementById('mAutoStatus').textContent, bpm: document.querySelector('.seg-bpm').value})");
  });
  await tryRec('确认前-网格未应用(确认制)', () => cdp.evalJs("document.getElementById('quickBar').hidden"));
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  await tryRec('确认后-快捷栏', () => cdp.evalJs("JSON.stringify({bpm: document.getElementById('qBpmVal').textContent, offset: document.getElementById('qOffsetVal').textContent})"));
  await tryRec('确认后-波形提示', () => cdp.evalJs("document.getElementById('waveHint').innerText.trim()"));

  // 真实手势：双击选第 2 小节（t=3s，全览 16s → ratio 3/16）
  const p2 = await waveXYOf(3 / 16);
  await cdp.mouse('dbl', p2.x, p2.y);
  await sleep(300);
  await tryRec('双击选中-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await tryRec('双击选中-添加按钮可用', () => cdp.evalJs("document.getElementById('btnAddSelection').disabled"));
  await cdp.click('#btnAddSelection');
  await sleep(300);
  await tryRec('序列-第1张卡片', () => cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length"));
  const p5 = await waveXYOf(9 / 16);
  await cdp.mouse('dbl', p5.x, p5.y);
  await sleep(300);
  await cdp.click('#btnAddSelection');
  await sleep(300);
  await tryRec('序列-第2张卡片', () => cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length"));
  await tryRec('序列-信息栏', () => cdp.evalJs("document.getElementById('seqInfo').textContent"));
  await tryRec('序列-卡片内容', () => cdp.evalJs("JSON.stringify([...document.querySelectorAll('#seqList .seq-card')].map(c => c.innerText.replace(/\\s+/g, ' ').slice(0, 100)))"));

  await cdp.click('#btnPlaySeq');
  await sleep(1500);
  await tryRec('播放中-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await tryRec('播放中-进度时间', () => cdp.evalJs("document.getElementById('seqProgressTime').textContent"));
  await tryRec('播放中-播放头位置', () => cdp.evalJs("(() => { const k = document.getElementById('seqProgressKnob'); return k ? k.style.left : null; })()"));

  const tr = await cdp.center('#seqProgressTrack');
  const before = await cdp.evalJs("document.getElementById('seqProgressTime').textContent");
  await cdp.mouse('click', tr.left + tr.width * 0.5, tr.top + tr.height / 2);
  await sleep(700);
  await tryRec('进度条seek50%', () => cdp.evalJs("({before: " + JSON.stringify(before) + ", after: document.getElementById('seqProgressTime').textContent})"));
  await tryRec('seek后-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));

  await pressKey(' ', 'Space', 32);
  await tryRec('空格暂停-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await pressKey(' ', 'Space', 32);
  await tryRec('空格恢复-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await cdp.click('#btnStop');
  await sleep(300);
  await tryRec('停止-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));

  await pressKey('ArrowLeft', 'ArrowLeft', 37);
  await tryRec('←平移-无异常', () => cdp.evalJs("(window.__e2eErr || '') === '' ? 'OK' : (window.__e2eErr || '').slice(0, 120)"));

  // 手动添加（时间模式）：0.5s–2.5s
  await cdp.click('#btnManualAdd');
  await sleep(300);
  await tryRec('手动添加-表单可见', () => cdp.evalJs("document.getElementById('manualForm').hidden"));
  await tryRec('手动添加-单位按钮', () => cdp.evalJs("(document.querySelector('#maStart .unit-mode-btn') || {}).textContent || null"));
  await cdp.click('#maStart .unit-mode-btn');
  await sleep(120);
  await cdp.click('#maEnd .unit-mode-btn');
  await sleep(120);
  await cdp.evalJs("(() => { const set = (sel, v) => { const i = document.querySelector(sel + ' .unit-time'); i.value = String(v); i.dispatchEvent(new Event('change', {bubbles:true})); }; set('#maStart', 0.5); set('#maEnd', 2.5); return true; })()");
  await sleep(200);
  await cdp.click('#btnManualOk');
  await sleep(400);
  await tryRec('手动添加后-卡片数', () => cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length"));
  await tryRec('手动添加后-信息栏', () => cdp.evalJs("document.getElementById('seqInfo').textContent"));
  await tryRec('手动添加后-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));

  await cdp.screenshot(path.join(OUT, 'shot_core_seq.png'));

  await tryRec('删除最后一张卡片', async () => {
    const n0 = await cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length");
    await cdp.evalJs("document.querySelector('#seqList .seq-card:last-child .del')?.click()");
    await sleep(400);
    const n1 = await cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length");
    return JSON.stringify({ before: n0, after: n1 });
  });

  // 导出 WAV
  const dlBefore = Date.now();
  await openExport();
  await tryRec('导出弹窗-默认Tab(音频)', () => cdp.evalJs("document.querySelector('#exportOverlay .exp-tab.active').dataset.tab"));
  await cdp.evalJs("document.getElementById('aName').value = 'e2e_wav'");
  await cdp.trustedClick('#xOk');
  tryRec('导出WAV-状态栏', async () => await waitExportStatus());
  const wavFile = await cdp.waitForDownload(OUT, '.wav', 60000, dlBefore);
  rec('导出WAV-文件', path.basename(wavFile) + ' (' + fs.statSync(wavFile).size + 'B)');
  rec('导出WAV-结构校验', wavInfo(fs.readFileSync(wavFile)));

  // 导出 MP3
  const dlBefore2 = Date.now();
  await openExport();
  await cdp.evalJs("document.getElementById('aFormat').value = 'mp3'; document.getElementById('aFormat').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('aName').value = 'e2e_mp3'");
  await cdp.trustedClick('#xOk');
  tryRec('导出MP3-状态栏', async () => await waitExportStatus());
  const mp3File = await cdp.waitForDownload(OUT, '.mp3', 60000, dlBefore2);
  rec('导出MP3-文件', path.basename(mp3File) + ' (' + fs.statSync(mp3File).size + 'B)');
  rec('导出MP3-结构校验', mp3Info(fs.readFileSync(mp3File)));

  // 工作区持久化：重开同一文件（per-file 恢复语义）
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.injectFile(WAV);
  await tryRec('重开文件-自动恢复提示', async () => {
    await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('已应用上次节拍设置') !== -1", 20000, '恢复提示');
    return await cdp.evalJs("document.getElementById('statusBar').textContent");
  });
  await tryRec('重开文件-序列卡片恢复', () => cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length"));
  await tryRec('重开文件-快捷栏恢复', () => cdp.evalJs("document.getElementById('qBpmVal').textContent"));
  await tryRec('CORE-页面错误', () => cdp.pageErrs());
}

// ---------------- video：视频链路 ----------------
async function stageVideo() {
  console.log('\n===== STAGE VIDEO：视频链路 =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);

  const t0 = Date.now();
  await cdp.injectFile(VID);
  await cdp.waitFor("['就绪','已应用','提取失败'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 30000, '视频就绪');
  rec('视频导入+音轨提取耗时(ms)', Date.now() - t0);
  await tryRec('视频-状态栏', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await tryRec('视频-预览与波形', () => cdp.evalJs("JSON.stringify({videoWrap: document.getElementById('videoWrap').hidden, videoDur: (document.getElementById('video')||{}).duration || null, waveSize: (() => { const cv = document.getElementById('wave'); return cv.width + 'x' + cv.height; })()})"));
  await tryRec('视频-提示', () => cdp.evalJs("document.getElementById('waveHint').innerText.trim()"));
  await cdp.screenshot(path.join(OUT, 'shot_video_import.png'));

  // 手动 BPM 120 → 确认网格
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await cdp.evalJs("document.querySelector('.seg-bpm').value = '120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true}))");
  await sleep(200);
  await cdp.evalJs("document.getElementById('mOffset').value = '0'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true}))");
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  await tryRec('视频-手动BPM网格', () => cdp.evalJs("document.getElementById('qBpmVal').textContent"));

  // 双击选中一段
  const dur = await cdp.evalJs("(document.getElementById('video')||{}).duration || 4");
  const p = await waveXYOf(1 / Math.max(dur, 1));
  await cdp.mouse('dbl', p.x, p.y);
  await sleep(300);
  await tryRec('视频-双击选中', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await cdp.click('#btnAddSelection');
  await sleep(300);
  await tryRec('视频-序列卡片', () => cdp.evalJs("document.querySelectorAll('#seqList .seq-card').length"));

  // 视频导出（带音轨）：预期无头环境 AAC 失败 → 可读中文提示
  const dlBefore = Date.now();
  await openExport();
  await tryRec('导出弹窗-默认Tab(视频)', () => cdp.evalJs("document.querySelector('#exportOverlay .exp-tab.active').dataset.tab"));
  await tryRec('视频Tab-包含音轨默认开', () => cdp.evalJs("document.getElementById('vAudio').checked"));
  await tryRec('视频Tab-AAC码率选项', () => cdp.evalJs("JSON.stringify([...document.getElementById('vAudioBitrate').options].map(o => o.value))"));
  await cdp.evalJs("document.getElementById('vName').value = 'e2e_v_audio'");
  await cdp.trustedClick('#xOk');
  tryRec('视频导出带音轨-结束状态', async () => await waitExportStatus(120000));
  tryRec('视频导出带音轨-产物(预期无:AAC受限)', async () => {
    try {
      const f = await cdp.waitForDownload(OUT, '.mp4', 5000, dlBefore);
      return path.basename(f);
    } catch (e) {
      return '(无产物，预期：AAC 编码器受限环境)';
    }
  });

  // 纯视频导出（关闭音轨）——重开导出弹窗
  const dlBefore2 = Date.now();
  await openExport();
  await cdp.evalJs("document.getElementById('vAudio').checked = false");
  await cdp.evalJs("document.getElementById('vName').value = 'e2e_v_silent'");
  await cdp.trustedClick('#xOk');
  tryRec('视频导出纯视频-状态', async () => await waitExportStatus(120000));
  const vf = await cdp.waitForDownload(OUT, '.mp4', 60000, dlBefore2);
  rec('视频导出纯视频-文件', path.basename(vf) + ' (' + fs.statSync(vf).size + 'B)');
  rec('视频导出纯视频-结构校验', mp4Info(fs.readFileSync(vf)));

  // Majdata 导出
  const dlBefore3 = Date.now();
  await openExport();
  await cdp.evalJs("[...document.querySelectorAll('#exportOverlay .exp-tab')].find(b => b.dataset.tab === 'majdata').click()");
  await sleep(200);
  await cdp.trustedClick('#xOk');
  tryRec('Majdata-结束状态', async () => await waitExportStatus(120000));
  const bgFile = await cdp.waitForDownload(OUT, '.mp4', 60000, dlBefore3);
  const trFile = await cdp.waitForDownload(OUT, '.mp3', 60000, dlBefore3);
  rec('Majdata-文件', path.basename(bgFile) + ' + ' + path.basename(trFile));
  rec('Majdata-bg.mp4校验', mp4Info(fs.readFileSync(bgFile)));
  rec('Majdata-track.mp3校验', mp3Info(fs.readFileSync(trFile)));
  await tryRec('VIDEO-页面错误', () => cdp.pageErrs());
}

// ---------------- ui：主题/设置/元数据/页脚/窄屏 ----------------
async function stageUi() {
  console.log('\n===== STAGE UI：主题/高级设置/元数据/页脚/窄屏 =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.injectFile(WAV);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');

  await cdp.click('#btnAdvanced');
  await cdp.waitFor("(() => { const el = document.getElementById('asOverlay'); return el && !el.hidden; })()", 5000, '高级设置弹窗');
  await tryRec('高级设置-主题默认', () => cdp.evalJs("document.documentElement.dataset.theme"));
  for (const th of ['nebula', 'paper', 'aurora']) {
    await tryRec('切换主题 ' + th, async () => {
      await cdp.evalJs("document.getElementById('as-theme-sel').value = '" + th + "'; document.getElementById('as-theme-sel').dispatchEvent(new Event('change', {bubbles:true})); true");
      await sleep(400);
      return await cdp.evalJs("JSON.stringify({theme: document.documentElement.dataset.theme, stored: (() => { try { return JSON.parse(localStorage.getItem('tempokiri.remix.global.v1')).theme; } catch (e) { return null; } })()})");
    });
  }

  await tryRec('高级设置-sensitivity修改', async () => {
    await cdp.evalJs("document.getElementById('as-sensitivity-num').value = '0.7'; document.getElementById('as-sensitivity-num').dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('as-sensitivity-num').dispatchEvent(new Event('change', {bubbles:true})); true");
    await sleep(400);
    return await cdp.evalJs("localStorage.getItem('tempokiri.remix.global.v1')");
  });
  await cdp.screenshot(path.join(OUT, 'shot_ui_advanced.png'));
  await cdp.click('#asClose');
  await cdp.waitFor("(() => { const el = document.getElementById('asOverlay'); return !el || el.hidden; })()", 5000, '高级设置关闭');

  // 元数据
  await cdp.click('#btnMeta');
  await cdp.waitFor("(() => { const el = document.getElementById('metaOverlay'); return el && !el.hidden; })()", 5000, '元数据弹窗');
  await tryRec('元数据-来源文件', () => cdp.evalJs("document.getElementById('metaFileName').textContent"));
  await cdp.screenshot(path.join(OUT, 'shot_ui_meta.png'));
  await cdp.evalJs("document.getElementById('meta-title').value = 'E2E标题测试'; document.getElementById('meta-title').dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('meta-title').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(300);
  await cdp.click('#metaClose');
  await sleep(500);
  await cdp.click('#btnMeta');
  await cdp.waitFor("(() => { const el = document.getElementById('metaOverlay'); return el && !el.hidden; })()", 5000, '元数据弹窗2');
  await tryRec('元数据-编辑持久化', () => cdp.evalJs("document.getElementById('meta-title').value"));
  await cdp.click('#metaClose');
  await sleep(400);

  // README 弹窗 + Esc
  await cdp.click('#btnReadme');
  await sleep(500);
  await tryRec('README弹窗-标题', () => cdp.evalJs("(() => { const el = document.getElementById('readmeOverlay'); return el ? el.querySelector('h2,h3,.modal-title')?.textContent || el.textContent.slice(0, 60) : null; })()"));
  await pressKey('Escape', 'Escape', 27);
  await tryRec('README-Esc关闭', () => cdp.evalJs("!document.getElementById('readmeOverlay') || document.getElementById('readmeOverlay').hidden"));

  // 检查更新（网络；本地领先 GitHub 时弹彩蛋——两者都是预期行为）
  await cdp.click('#btnCheckUpdate');
  await sleep(5000);
  await tryRec('检查更新-反馈(toast或彩蛋)', () => cdp.evalJs(`(() => {
    const t = document.getElementById('updateToast');
    const egg = document.getElementById('easterEggOverlay');
    if (t && !t.hidden) return 'toast: ' + t.textContent;
    if (egg) return '彩蛋: ' + egg.textContent.replace(/\\s+/g, ' ').slice(0, 100);
    return '(无反馈)';
  })()`));
  await cdp.evalJs("(() => { const egg = document.getElementById('easterEggOverlay'); if (egg) egg.querySelector('[data-close]')?.click(); return true; })()");
  await sleep(400);

  // 建序列：先设网格（手动 120 BPM 确认制），再双击选第一小节
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await cdp.evalJs("document.querySelector('.seg-bpm').value = '120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('mOffset').value = '0'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(200);
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');
  const p0 = await waveXYOf(1 / 16);
  await cdp.mouse('dbl', p0.x, p0.y);
  await sleep(300);
  await cdp.click('#btnAddSelection');
  await sleep(300);
  await cdp.click('#btnExport');
  await cdp.waitFor("(() => { const el = document.getElementById('exportOverlay'); return el && !el.hidden; })()", 8000, '导出弹窗');

  // 空文件名校验
  await cdp.evalJs("document.getElementById('aName').value = ''");
  await cdp.click('#xOk');
  await sleep(300);
  await tryRec('空文件名-校验提示', () => cdp.evalJs("(() => { const s = document.getElementById('xStatus'); return s && !s.hidden ? s.textContent : null; })()"));
  await cdp.evalJs("document.getElementById('xCancel').click()");
  await sleep(300);

  // 窄屏 360px
  await cdp.setViewport(360, 800);
  await sleep(600);
  await tryRec('窄屏360-横向溢出', () => cdp.evalJs("JSON.stringify({innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > window.innerWidth})"));
  await cdp.screenshot(path.join(OUT, 'shot_ui_360.png'));
  await cdp.setViewport(1440, 900);

  // Esc 关闭设置弹窗
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await pressKey('Escape', 'Escape', 27);
  await tryRec('设置弹窗-Esc关闭', () => cdp.evalJs("(() => { const el = document.getElementById('modalOverlay'); return !el || el.hidden; })()"));
  await tryRec('UI-页面错误', () => cdp.pageErrs());
}

// ---------------- perf：性能测量 ----------------
async function stagePerf() {
  console.log('\n===== STAGE PERF：性能测量 =====');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);

  // 1) 大视频导入（57MB/223s）
  await cdp.evalJs("localStorage.setItem('tempokiri.remix.global.v1', JSON.stringify({videoExtract: 'webcodecs'}))").catch(() => {});
  const t0 = Date.now();
  await cdp.injectFile(VID_BIG);
  await cdp.waitFor("['就绪','已应用','提取失败'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 90000, '大视频就绪');
  rec('大视频导入+提取耗时(ms)', Date.now() - t0);
  await tryRec('大视频-状态', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await tryRec('大视频-提示', () => cdp.evalJs("document.getElementById('waveHint').innerText.trim()"));

  // 2) 全曲 BPM 识别耗时
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await cdp.evalJs('window.__t0 = performance.now()');
  await cdp.click('.seg-auto');
  await tryRec('大音频-识别耗时', async () => {
    await cdp.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('识别失败') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('未能识别') !== -1", 60000, '识别结束');
    return await cdp.evalJs("JSON.stringify({ms: Math.round(performance.now() - window.__t0), status: document.getElementById('mAutoStatus').textContent})");
  });
  await cdp.evalJs("document.querySelector('#modalOverlay [data-close], #modalOverlay .modal-x, #modalOverlay button')?.click()").catch(() => {});
  await sleep(500);

  // 3) 波形平移帧率
  await cdp.evalJs("window.__raf = {n: 0, t0: performance.now()}; (function loop() { window.__raf.n++; requestAnimationFrame(loop); })()");
  const c0 = await cdp.center('#wave');
  await cdp.wheel(c0.x, c0.y, -400);
  await cdp.wheel(c0.x, c0.y, -400);
  await cdp.wheel(c0.x, c0.y, -400);
  await sleep(1200);
  await tryRec('波形滚轮平移-fps', () => cdp.evalJs("(() => { const d = (performance.now() - window.__raf.t0) / 1000; return JSON.stringify({frames: window.__raf.n, fps: +(window.__raf.n / d).toFixed(1)}); })()"));
  await cdp.wheel(c0.x, c0.y, -400, true);
  await cdp.wheel(c0.x, c0.y, 400, true);
  await sleep(600);
  await tryRec('Ctrl滚轮缩放-无异常', () => cdp.evalJs("(window.__e2eErr || '') === '' ? 'OK' : (window.__e2eErr || '').slice(0, 120)"));

  // 4) 拼接播放
  const dur = await cdp.evalJs("(document.getElementById('video') || {}).duration || 223");
  const p = await waveXYOf(1 / dur);
  await cdp.mouse('dbl', p.x, p.y);
  await sleep(300);
  await cdp.click('#btnAddSelection');
  await sleep(200);
  await cdp.click('#btnPlaySeq');
  await sleep(1200);
  await cdp.click('#btnStop');
  await tryRec('拼接播放-无异常', () => cdp.evalJs("(window.__e2eErr || '') === '' ? 'OK' : (window.__e2eErr || '').slice(0, 120)"));

  await tryRec('PERF-页面错误', () => cdp.pageErrs());
}

// ---------------- autocut：自动剪辑补充场景 ----------------
async function stageAutoCut() {
  console.log('\n===== STAGE AUTOCUT：自动剪辑补充场景 =====');
  // 生成 2s 近静音 WAV（无节拍 → 期望无方案提示）
  const sr = 44100, secs = 2;
  const pcm = new Float32Array(sr * secs);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 55 * i / sr) * 0.001;
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(pcm[i] * 32767), 44 + i * 2);
  const silent = path.join(OUT, 'no_beat.wav');
  fs.writeFileSync(silent, wav);

  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.evalJs('localStorage.clear()');
  await cdp.navigate(pathToFileURL(DIST).href);
  await cdp.injectFile(silent);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
  await cdp.click('#btnAutoCut');
  await sleep(2500);
  await tryRec('无方案-反馈(状态栏提示)', () => cdp.evalJs("document.getElementById('statusBar').textContent"));
  await tryRec('无方案-弹窗打开(1.9.1修复)', () => cdp.evalJs("(() => { const el = document.getElementById('autoCutOverlay'); return el ? !el.hidden : false; })()"));
  await tryRec('无方案-导入按钮禁用', () => cdp.evalJs("(() => { const el = document.getElementById('acImport'); return el ? el.disabled : 'n/a'; })()"));
  await cdp.screenshot(path.join(OUT, 'shot_autocut_empty.png'));
  await cdp.evalJs("document.getElementById('acCancel')?.click()");
  await sleep(400);

  // 有节拍素材 + 网格：对齐开关重分析
  await cdp.injectFile(WAV);
  await cdp.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪2');
  await cdp.click('#btnSettings');
  await cdp.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await cdp.click('.seg-auto');
  await cdp.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 30000, '识别');
  await cdp.click('#mOk');
  await cdp.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');
  await cdp.click('#btnAutoCut');
  await cdp.waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden && document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length > 0; })()", 15000, '方案弹窗');
  await tryRec('有网格-方案摘要', () => cdp.evalJs("document.getElementById('acSummary').textContent"));
  await tryRec('有网格-对齐开关可见', () => cdp.evalJs("!!document.getElementById('acAlignWrap') && !document.getElementById('acAlignWrap').hidden"));
  await tryRec('有网格-剪切点依据', () => cdp.evalJs("JSON.stringify([...document.querySelectorAll('#acCutsBody tr')].slice(0, 5).map(tr => tr.innerText.replace(/\\s+/g, ' ').slice(0, 80)))"));
  await cdp.evalJs("document.getElementById('acAlign').click()");
  await sleep(2000);
  await tryRec('关闭对齐-重分析', () => cdp.evalJs("JSON.stringify({segs: document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length, summary: document.getElementById('acSummary').textContent})"));
  await cdp.screenshot(path.join(OUT, 'shot_autocut_align_off.png'));
  await cdp.evalJs("document.getElementById('acCancel').click()");
  await sleep(400);
  await tryRec('AUTOCUT-页面错误', () => cdp.pageErrs());
}

// ---------------- main ----------------
async function main() {
  const stage = process.argv[2] || 'all';
  cdp = await Cdp.connect();
  await cdp.prepareDownloads(OUT);
  console.log('CDP 已连接，版本徽标:', await cdp.evalJs("document.querySelector('[data-version]') ? document.querySelector('[data-version]').textContent : '(未加载)'"));

  const run = async (name, fn) => {
    try { await fn(); } catch (e) { console.log('  [STAGE FAIL] ' + name + ' → ' + e.message); RESULTS['STAGE_' + name] = 'FAIL: ' + e.message; }
  };
  if (stage === 'all' || stage === 'core') await run('core', stageCore);
  if (stage === 'all' || stage === 'video') await run('video', stageVideo);
  if (stage === 'all' || stage === 'ui') await run('ui', stageUi);
  if (stage === 'all' || stage === 'perf') await run('perf', stagePerf);
  if (stage === 'all' || stage === 'autocut') await run('autocut', stageAutoCut);

  const fails = Object.entries(RESULTS).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  console.log('\n===== 汇总 =====');
  console.log('检查项总数:', Object.keys(RESULTS).length, ' 失败/异常项:', fails.length);
  for (const [k, v] of fails) console.log('  [!!]', k, '=', v);
  fs.writeFileSync(path.join(OUT, 'e2e_results.json'), JSON.stringify(RESULTS, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
