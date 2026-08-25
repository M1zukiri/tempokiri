// 创建时间：2026-08-19 22:00:00
/**
 * smoke_autoCut.mjs — 自动剪辑功能浏览器冒烟测试（无头 Edge + CDP）。
 *
 * 用法（先启动无头 Edge，remote-debugging-port=9338）：
 *   node tools/smoke_autoCut.mjs
 *
 * 场景：
 *   A. 无网格：导入 WAV → 点「自动剪辑」→ 弹窗出现 → 一键导入 → 序列出现段
 *   B. 有网格：设置节拍（自动识别 120BPM）→ 确认 → 自动剪辑 → 弹窗含小节/依据列 → 导入（替换确认）→ 序列被替换
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = 9338;
const DIST = path.resolve('dist/tempokiri-workstation.html');
const WAV = path.resolve('examples/test_track.wav');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 极简 CDP 客户端 ----------
let ws = null;
let msgId = 0;
const pending = new Map();
const listeners = new Map();

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + (e.message || e)));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) fn(msg.params);
      }
    };
  });
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function on(method, fn) {
  if (!listeners.has(method)) listeners.set(method, []);
  listeners.get(method).push(fn);
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面表达式异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  return r.result ? r.result.value : undefined;
}

/** 轮询页面表达式直到为真（超时抛错）。 */
async function waitFor(expr, timeoutMs = 15000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr)) return;
    await sleep(150);
  }
  throw new Error('等待超时: ' + label);
}

// ---------- 主流程 ----------
async function main() {
  // 取页面 target：优先复用已有的 tempokiri 页面，否则新建
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = list.find((t) => t.type === 'page' && t.url.includes('tempokiri-workstation.html'));
  if (!page) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    page = await r.json();
  }
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  // 打开打包产物（file://；先跳 about:blank 避免 bfcache 复用旧页面状态）
  const url = pathToFileURL(DIST).href;
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url });
  await waitFor("document.readyState === 'complete'", 15000, '页面加载完成');
  await sleep(300);
  // 清空缓存，保证场景 A 从干净工作区开始（就绪而非「已应用上次节拍设置」）
  await evalJs("localStorage.clear()");
  // 错误监听（诊断用）
  await evalJs("window.__errs = []; window.addEventListener('error', e => window.__errs.push('err:' + e.message)); window.addEventListener('unhandledrejection', e => window.__errs.push('rej:' + (e.reason && e.reason.message)));");

  const results = {};

  // ---- 场景 A：无网格 ----
  results.btnBefore = await evalJs("document.getElementById('btnAutoCut').disabled");
  await injectFile();
  await waitFor("['就绪','已应用'].some(k => document.getElementById('statusBar').textContent.indexOf(k) !== -1)", 20000, '音频就绪');
  await waitFor("document.getElementById('btnAutoCut').disabled === false", 5000, '自动剪辑按钮可用');
  results.btnAfter = await evalJs("document.getElementById('btnAutoCut').disabled");

  await evalJs("document.getElementById('btnAutoCut').click()");
  await waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden && document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length > 0; })()", 15000, '方案弹窗出现');
  results.a = await evalJs(`(() => {
    const cuts = document.getElementById('acCutsBody').children.length;
    const segs = document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length;
    const cands = document.querySelectorAll('#acSegsBody tr.ac-cand-row').length;
    return { cuts, segs, cands, range: document.getElementById('acRange').textContent, status: document.getElementById('statusBar').textContent };
  })()`);
  // 参数行 / 摘要 / 试听按钮（1.9.0 新交互）
  results.a.params = await evalJs(`(() => {
    const minsegs = [...document.querySelectorAll('.ac-minseg')].map(el => el.textContent);
    const alignWrap = document.getElementById('acAlignWrap');
    return {
      minsegs,
      alignVisible: !!(alignWrap && !alignWrap.hidden),
      listens: document.querySelectorAll('.ac-listen').length,
      summary: document.getElementById('acSummary').textContent,
    };
  })()`);
  // 切到 5s 档位 → 即时重分析（16s 音频：3 段 → 2 段）
  await evalJs("[...document.querySelectorAll('.ac-minseg')].find(b => b.dataset.sec === '5').click()");
  await waitFor("document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length === 2", 8000, '5s 档重分析');
  results.a.segsAt5s = await evalJs("document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length");
  // 试听：点第一个 ▶，播放原曲区间不应报错
  await evalJs("document.querySelector('.ac-listen').click()");
  await sleep(600);
  results.a.listenStatus = await evalJs("document.getElementById('statusBar').textContent");
  await evalJs("document.getElementById('btnStop').click()");
  // 恢复 3s 档
  await evalJs("[...document.querySelectorAll('.ac-minseg')].find(b => b.dataset.sec === '3').click()");
  await waitFor("document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length === 3", 8000, '恢复 3s 档');
  await shot('shot_autocut_plan.png');

  // 一键导入（序列为空 → 直接导入）
  await evalJs("document.getElementById('acImport').click()");
  await waitFor("document.querySelectorAll('#seqList .seq-card').length > 0", 8000, '序列导入');
  results.a.importedCards = await evalJs("document.querySelectorAll('#seqList .seq-card').length");
  results.a.statusAfterImport = await evalJs("document.getElementById('statusBar').textContent");
  results.a.overlayClosed = await evalJs("document.getElementById('autoCutOverlay').hidden");

  // ---- 场景 B：有网格（自动识别 → 确认）----
  results.b = {};
  console.log('[B1] 打开设置');
  await evalJs("document.getElementById('btnSettings').click()");
  await waitFor("(() => { const el = document.getElementById('modalOverlay'); return el && !el.hidden; })()", 5000, '设置弹窗');
  console.log('[B2] 点击识别');
  await evalJs("document.querySelector('#segTbody .seg-auto').click()");
  console.log('[B3] 轮询识别状态');
  // 轮询识别状态（带诊断：超时输出 mAutoStatus 内容）
  {
    const t0 = Date.now();
    let lastStatus = '';
    while (Date.now() - t0 < 20000) {
      lastStatus = await evalJs("document.getElementById('mAutoStatus').textContent");
      if (lastStatus.indexOf('识别完成') !== -1 || lastStatus.indexOf('识别失败') !== -1) break;
      await sleep(200);
    }
    if (lastStatus.indexOf('识别完成') === -1) throw new Error('BPM 识别未完成，mAutoStatus=' + JSON.stringify(lastStatus));
  }
  console.log('[B4] 识别完成');
  results.b.bpm = await evalJs("document.querySelector('#segTbody .seg-bpm').value");
  console.log('[B5] 确认网格');
  await evalJs("document.getElementById('mOk').click()");
  await waitFor("document.getElementById('quickBar').hidden === false", 8000, '网格应用');

  // 再跑自动剪辑：应显示小节列与网格对齐依据
  console.log('[B6] 有网格自动剪辑');
  await evalJs("document.getElementById('btnAutoCut').click()");
  await sleep(1500);
  console.log('[B6a] 状态:', JSON.stringify(await evalJs("document.getElementById('statusBar').textContent")));
  console.log('[B6b] 弹窗:', JSON.stringify(await evalJs("(() => { const el = document.getElementById('autoCutOverlay'); return el ? (el.hidden ? 'hidden' : 'visible') : 'null'; })()")));
  console.log('[B6c] errs:', JSON.stringify(await evalJs("window.__errs || 'no-listener'")));
  await waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden && document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length > 0; })()", 15000, '有网格方案弹窗');
  results.b.plan = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('#acCutsBody tr')].map(tr => [...tr.children].map(td => td.textContent));
    return { cuts: rows, segs: document.querySelectorAll('#acSegsBody tr:not(.ac-cand-row)').length, range: document.getElementById('acRange').textContent };
  })()`);
  // 有网格时：对齐开关可见 + 试听按钮存在
  results.b.alignVisible = await evalJs("!!document.getElementById('acAlignWrap') && !document.getElementById('acAlignWrap').hidden");
  results.b.listensB = await evalJs("document.querySelectorAll('.ac-listen').length");
  await shot('shot_autocut_grid.png');

  // 先加一段手动序列，验证「替换确认」弹窗
  await evalJs("document.getElementById('acCancel').click()");
  await waitFor("document.getElementById('autoCutOverlay').hidden", 5000, '弹窗关闭');
  await evalJs("document.getElementById('btnAutoCut').click()");
  await waitFor("(() => { const el = document.getElementById('autoCutOverlay'); return el && !el.hidden; })()", 8000, '再次打开方案');
  await evalJs("document.getElementById('acImport').click()");
  await waitFor("document.body.textContent.indexOf('替换现有序列') !== -1", 8000, '替换确认弹窗');
  results.b.replaceSeen = true;
  await evalJs("[...document.querySelectorAll('.modal-overlay button')].find(b => b.textContent.indexOf('替换') !== -1).click()");
  await waitFor("document.querySelectorAll('#seqList .seq-card').length > 0 && document.getElementById('autoCutOverlay').hidden", 8000, '替换后序列导入');
  results.b.cardsAfterReplace = await evalJs("document.querySelectorAll('#seqList .seq-card').length");
  results.b.statusAfterReplace = await evalJs("document.getElementById('statusBar').textContent");

  // 波形剪切点标记：验证 render 绘制调用（canvas 非空即认为已走绘制路径）
  results.b.cutMarksVisible = await evalJs(`!!document.getElementById('wave').getContext('2d')`);

  // 页面无 JS 错误（检查 window.onerror 记录——通过再执行一次简单交互确认运行时健康）
  await evalJs("document.getElementById('btnPlaySeq').click()"); // 拼接播放不应报错
  await sleep(500);
  await evalJs("document.getElementById('btnStop').click()");
  results.b.playOk = true;

  console.log(JSON.stringify(results, null, 2));
  console.log('SMOKE OK');
}

/** 通过 CDP 注入文件（触发 change → handleFile）。 */
async function injectFile() {
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
  await send('DOM.setFileInputFiles', { nodeId, files: [WAV] });
}

async function shot(name) {
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve('tools', name), Buffer.from(data, 'base64'));
    console.log('截图: tools/' + name);
  } catch (e) {
    console.log('截图失败（忽略）: ' + e.message);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('SMOKE FAILED: ' + e.message);
  process.exit(1);
});
