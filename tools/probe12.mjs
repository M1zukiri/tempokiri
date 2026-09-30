// 创建时间：2026-08-24 03:30:00
/** probe12.mjs — 目标音频 BPM 识别诊断：默认参数结果 + 参数扫描 + 引擎 API 面。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const M4A = 'C:/Users/M1zukuro/Desktop/Sync/Majproject/制作中/doppelganger/二重身 ⧸ 日暮翠(cv.异世界情绪)＆日暮红(cv.宮崎 恵里花) Character Covers [BV1MRKP6CEXc].m4a';

async function main() {
  const c = await Cdp.connect();
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);

  // 注入 m4a（AAC 音频；非 WAV → ctx.decodeAudioData 设备率）
  const t0 = Date.now();
  await c.injectFile(M4A);
  await c.waitFor("['就绪','已应用','解码失败'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 60000, '音频就绪');
  console.log('导入耗时:', Date.now() - t0, 'ms');
  console.log('状态:', await c.evalJs("document.getElementById('statusBar').textContent"));
  console.log('时长:', await c.evalJs("(() => { const cv = document.getElementById('wave'); return cv ? cv.width + 'x' + cv.height : null; })()"));

  // 引擎 API 面
  console.log('MC.analysis 导出:', await c.evalJs("JSON.stringify(Object.keys(MC.analysis || {}))"));

  // 首次识别（默认参数：hop 512 标准、灵敏度 0.9、60-200）
  console.log('\n--- 识别 1：默认参数 ---');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await c.evalJs('window.__t0 = performance.now()');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别') !== -1 && (document.getElementById('mAutoStatus').textContent.indexOf('完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('失败') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('未能') !== -1)", 120000, '识别结束');
  console.log('识别耗时:', await c.evalJs("Math.round(performance.now() - window.__t0)"), 'ms');
  console.log('结果:', await c.evalJs("document.getElementById('mAutoStatus').textContent"));
  console.log('回填BPM:', await c.evalJs("document.querySelector('.seg-bpm').value"));
  await c.evalJs("document.getElementById('mCancel').click()");
  await sleep(400);

  // 直接引擎调用：MC.analyze 拿 {bpm, offset, onsets, flux}
  const diag = await c.evalJs(`(async () => {
    if (typeof MC.analyze !== 'function') return { err: 'MC.analyze 不可用' };
    // 分析用 pcm（22050）在页面内部——尝试从引擎重跑：用 state 不暴露，直接找 window 上的 PCM。
    // 兜底：返回可用 API 列表
    return { apis: Object.keys(MC).filter(k => typeof MC[k] === 'function').slice(0, 60) };
  })()`);
  console.log('MC 顶层函数:', JSON.stringify(diag));

  // 参数扫描：高精度 hop 256 → 识别
  console.log('\n--- 识别 2：hop 256 高精度 ---');
  await c.click('#btnAdvanced');
  await c.waitFor("(() => { const el = document.getElementById('asOverlay'); return el && !el.hidden; })()", 5000, '高级设置');
  await c.evalJs("document.getElementById('as-hop-sel').value = '256'; document.getElementById('as-hop-sel').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(300);
  await c.click('#asClose');
  await sleep(300);
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗2');
  await c.evalJs('window.__t0 = performance.now()');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别') !== -1 && (document.getElementById('mAutoStatus').textContent.indexOf('完成') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('失败') !== -1 || document.getElementById('mAutoStatus').textContent.indexOf('未能') !== -1)", 120000, '识别结束2');
  console.log('识别耗时:', await c.evalJs("Math.round(performance.now() - window.__t0)"), 'ms');
  console.log('结果:', await c.evalJs("document.getElementById('mAutoStatus').textContent"));
  console.log('回填BPM:', await c.evalJs("document.querySelector('.seg-bpm').value"));
  await c.evalJs("document.getElementById('mCancel').click()");

  // 页面无错误
  console.log('errs:', JSON.stringify(await c.pageErrs()));
  c.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
