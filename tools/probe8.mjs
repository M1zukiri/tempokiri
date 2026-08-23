// 创建时间：2026-08-24 00:45:00
/** probe8.mjs — v1.9.1 修复验证：M1 空格语义 / M2 BPM 精度 / N1 播放结束文案 / L1 无方案弹窗 / N2 单小节提示。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const OUT = path.resolve('tools/e2e_out');
const R = {};

async function tryRec(name, fn) {
  try { const v = await fn(); R[name] = v; console.log('  [OK]   ' + name + ' = ' + clip(JSON.stringify(v))); }
  catch (e) { R[name] = 'FAIL: ' + e.message; console.log('  [FAIL] ' + name + ' = ' + e.message); }
}

async function main() {
  const c = await Cdp.connect();
  const sx = await c.evalJs("document.querySelector('[data-version]') ? document.querySelector('[data-version]').textContent : '(未加载)'");
  console.log('版本徽标:', sx);

  // 生成近静音 WAV（无方案素材）
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

  // ---- L1：无方案时弹窗打开（showEmpty + 导入禁用 + 参数行保留）----
  console.log('\n--- L1 无方案弹窗 ---');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  await c.injectFile(silent);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
  await c.click('#btnAutoCut');
  await sleep(1800);
  await tryRec('L1-弹窗打开', () => c.evalJs("(() => { const el = document.getElementById('autoCutOverlay'); return el ? !el.hidden : false; })()"));
  await tryRec('L1-摘要提示', () => c.evalJs("document.getElementById('acSummary').textContent"));
  await tryRec('L1-导入按钮禁用', () => c.evalJs("document.getElementById('acImport').disabled"));
  await tryRec('L1-参数行存在', () => c.evalJs("JSON.stringify([...document.querySelectorAll('.ac-minseg')].map(b => b.textContent))"));
  await tryRec('L1-分析范围', () => c.evalJs("document.getElementById('acRange').textContent"));
  // 切档位重分析（仍无方案 → 弹窗保持）
  await c.evalJs("document.querySelector('.ac-minseg[data-sec=\"2\"]').click()");
  await sleep(1200);
  await tryRec('L1-切档后仍提示', () => c.evalJs("document.getElementById('acSummary').textContent"));
  await c.evalJs("document.getElementById('acCancel').click()");
  await sleep(400);

  // ---- M2 / N2 / M1 / N1 ----（用有节拍素材）
  console.log('\n--- M2/N2/M1/N1 ---');
  await c.injectFile(WAV);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪2');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置');
  await c.evalJs('window.__t0 = performance.now()');
  await c.click('.seg-auto');
  await c.waitFor("document.getElementById('mAutoStatus').textContent.indexOf('识别完成') !== -1", 30000, '识别');
  await c.evalJs("document.getElementById('mOk').click()");
  await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');

  // M2：+0.01 微调显示
  await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"bpm\"][data-d=\"0.01\"]').click()");
  await sleep(200);
  await tryRec('M2-+0.01显示', () => c.evalJs("document.getElementById('qBpmVal').textContent"));
  await c.evalJs("document.querySelector('#quickBar .q-btns button[data-q=\"bpm\"][data-d=\"-0.01\"]').click()"); // 还原 120
  await sleep(200);

  // N2：双击选单小节
  const r = await c.evalJs("(() => { const cv = document.getElementById('wave'); const b = cv.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
  await c.mouse('dbl', r.x + (3 / 16) * r.w, r.y + r.h / 2);
  await sleep(400);
  await tryRec('N2-单小节提示', () => c.evalJs("document.getElementById('statusBar').textContent"));
  // 添加为第 1 段入列
  await c.click('#btnAddSelection');
  await sleep(300);
  // 再加第 2 段（第 5 小节）以便 M1 验证
  await c.mouse('dbl', r.x + (9 / 16) * r.w, r.y + r.h / 2);
  await sleep(400);
  await c.click('#btnAddSelection');
  await sleep(300);

  // M1：拼接播放 → 空格暂停（文案）→ 空格恢复（拼接、断点续）
  await c.click('#btnPlaySeq');
  await sleep(1200);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(500);
  await tryRec('M1-空格暂停文案', () => c.evalJs("document.getElementById('statusBar').textContent"));
  const tPause = await c.evalJs("document.getElementById('seqProgressTime').textContent");
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(800);
  await tryRec('M1-空格恢复', () => c.evalJs("JSON.stringify({status: document.getElementById('statusBar').textContent, time: document.getElementById('seqProgressTime').textContent})"));
  await tryRec('M1-断点续播(暂停时)>0', () => tPause);
  await c.click('#btnStop');
  await sleep(400);

  // N1：单段序列播完 → “播放结束”
  await c.evalJs("document.querySelector('#seqList .seq-card:last-child .del')?.click()");
  await sleep(400);
  await tryRec('N1-播完状态', async () => {
    await c.click('#btnPlaySeq');
    await c.waitFor("document.getElementById('statusBar').textContent.indexOf('播放结束') !== -1", 8000, '播放结束');
    return await c.evalJs("document.getElementById('statusBar').textContent");
  });

  console.log('\n===== 汇总 =====');
  const fails = Object.entries(R).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  console.log('检查项:', Object.keys(R).length, ' 失败:', fails.length);
  for (const [k, v] of fails) console.log('  [!!]', k, '=', v);
  c.close();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
