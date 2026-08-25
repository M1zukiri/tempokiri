// 创建时间：2026-08-24 02:40:00
/** probe10.mjs — v1.10.0 自动剪辑改进验证：评分新权重 / 段中心展示 / 候选终点采用与恢复 / 1.5 小节试听。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep, clip } from './e2e_lib.mjs';

const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');
const R = {};
async function tryRec(name, fn) {
  try { const v = await fn(); R[name] = v; console.log('  [OK]   ' + name + ' = ' + clip(JSON.stringify(v))); }
  catch (e) { R[name] = 'FAIL: ' + e.message; console.log('  [FAIL] ' + name + ' = ' + e.message); }
}

async function main() {
  const c = await Cdp.connect();

  // ---------- 场景 A：无网格（候选采用 / 恢复默认）----------
  console.log('\n--- A 无网格：候选展示/采用/恢复 ---');
  await c.navigate(pathToFileURL(DIST).href);
  await c.evalJs('localStorage.clear()');
  await c.navigate(pathToFileURL(DIST).href);
  console.log('版本:', await c.evalJs("document.querySelector('[data-version]').textContent"));
  await c.injectFile(WAV);
  await c.waitFor("document.getElementById('statusBar').textContent.indexOf('就绪') !== -1", 20000, '就绪');
  await c.click('#btnAutoCut');
  await c.waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden && document.getElementById('acSegsBody').children.length > 0; })()", 20000, '方案弹窗');
  await tryRec('A-段表主行+候选子行', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#acSegsBody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 12))`));
  await tryRec('A-质量分(无网格≤60)', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#acCutsBody .ac-score')].map(e => e.textContent))`));
  await tryRec('A-候选行数量', () => c.evalJs("document.querySelectorAll('#acSegsBody .ac-cand-row').length"));
  await tryRec('A-锚定前reset隐藏', () => c.evalJs("document.getElementById('acReset').hidden"));

  // 采用第一个候选终点（最后一个子行？段1的候选）
  const useOk = await c.evalJs(`(() => { const b = document.querySelector('#acSegsBody .ac-cand-row .ac-use'); if (!b) return false; b.click(); return true; })()`);
  await tryRec('A-点击采用', () => useOk);
  await sleep(800);
  await tryRec('A-采用后-段行', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#acSegsBody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 10))`));
  await tryRec('A-采用后-摘要', () => c.evalJs("document.getElementById('acSummary').textContent"));
  await tryRec('A-采用后-reset可见', () => c.evalJs("document.getElementById('acReset').hidden"));
  await c.evalJs("document.getElementById('acReset').click()");
  await sleep(800);
  await tryRec('A-恢复默认-摘要', () => c.evalJs("document.getElementById('acSummary').textContent"));
  await tryRec('A-恢复默认-reset隐藏', () => c.evalJs("document.getElementById('acReset').hidden"));
  await c.evalJs("document.getElementById('acCancel').click()");
  await sleep(500);

  // ---------- 场景 B：有网格（试听窗口 1.5 小节 + 对齐开关）----------
  console.log('\n--- B 有网格：试听 1.5 小节 / 对齐开关 ---');
  await c.click('#btnSettings');
  await c.waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  await c.evalJs("document.querySelector('.seg-bpm').value = '120'; document.querySelector('.seg-bpm').dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('mOffset').value = '0.511'; document.getElementById('mOffset').dispatchEvent(new Event('change', {bubbles:true})); true");
  await sleep(200);
  await c.click('#mOk');
  await c.waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格');
  await c.click('#btnAutoCut');
  await c.waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden && document.getElementById('acSegsBody').children.length > 0; })()", 20000, '方案弹窗B');
  await tryRec('B-剪切点行', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#acCutsBody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()))`));
  // 点第一个剪切点试听：状态"试听中：x – y"，y-x 应 ≈ 3s+3s=6s（120BPM 小节 2s × 1.5）
  await c.evalJs("document.querySelector('#acCutsBody .ac-listen').click()");
  await sleep(600);
  await tryRec('B-试听窗口', async () => {
    const st = await c.evalJs("document.getElementById('statusBar').textContent");
    const m = st.match(/试听中：([0-9:.]+) – ([0-9:.]+)/);
    if (!m) return st;
    const f = (s) => { const [mm, ss] = s.split(':'); return parseInt(mm, 10) * 60 + parseFloat(ss); };
    return JSON.stringify({ status: st, spanSec: +(f(m[2]) - f(m[1])).toFixed(2) });
  });
  await c.evalJs("document.getElementById('btnStop').click()");
  await sleep(400);
  await tryRec('B-试听按钮title', () => c.evalJs("document.querySelector('#acCutsBody .ac-listen').title"));
  await tryRec('B-段行含小节数', () => c.evalJs(`JSON.stringify([...document.querySelectorAll('#acSegsBody tr')].filter(t => !t.className.includes('ac-cand')).map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 4))`));
  await tryRec('B-页面错误', () => c.pageErrs());

  console.log('\n===== 汇总 =====');
  const fails = Object.entries(R).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  console.log('检查项:', Object.keys(R).length, ' 失败:', fails.length);
  for (const [k, v] of fails) console.log('  [!!]', k, '=', v);
  c.close();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
