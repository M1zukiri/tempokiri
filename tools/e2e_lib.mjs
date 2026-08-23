// 创建时间：2026-08-23 23:05:00
/**
 * e2e_lib.mjs — 无头 Edge（CDP 9338）端到端测试基础库。
 * 供 e2e_user.mjs 使用：连接、求值、等待、手势、截图、文件注入、下载与产物校验。
 */
import fs from 'node:fs';
import path from 'node:path';

export const PORT = 9338;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.errs = []; // Runtime.exceptionThrown / Log.entryAdded(error)
  }

  static async connect() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    // 关闭所有旧 page target（避免多页面状态串扰）；about:blank page target 保留一个用于复用
    for (const t of list) {
      if (t.type === 'page' && t.url && t.url !== 'about:blank') {
        try {
          const ws = new WebSocket(t.webSocketDebuggerUrl);
          await new Promise((r) => { ws.onopen = r; ws.onerror = r; });
          ws.send(JSON.stringify({ id: 1, method: 'Target.closeTarget', params: { targetId: t.id } }));
          setTimeout(() => { try { ws.close(); } catch (e) {} }, 300);
        } catch (e) { /* 忽略 */ }
      }
    }
    await sleep(500);
    let page = list.find((t) => t.type === 'page' && t.url === 'about:blank');
    if (!page) {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
      page = await r.json();
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const c = new Cdp(ws);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 连接失败')); });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method) {
        if (m.method === 'Runtime.exceptionThrown') {
          const d = m.params.exceptionDetails;
          c.errs.push('EXC: ' + (d?.exception?.description || d?.text || ''));
        } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
          c.errs.push('LOG: ' + m.params.entry.text);
        }
        for (const fn of c.listeners.get(m.method) || []) fn(m.params);
      }
    };
    // 页面内错误监听（覆盖未捕获 promise 等）
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Page.enable');
    await c.send('DOM.enable');
    c.on('Page.downloadWillBegin', (p) => console.log('  [DL-EVT] ' + (p.suggestedFilename || '?') + ' url=' + (p.url || '').slice(0, 40)));
    await c.watchErrors();
    return c;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async evalJs(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面表达式异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }

  /** 轮询页面表达式直到为真。 */
  async waitFor(expr, timeoutMs = 15000, label = expr) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await this.evalJs(expr)) return;
      await sleep(150);
    }
    throw new Error('等待超时: ' + label);
  }

  async navigate(url, waitReady = true) {
    await this.send('Page.navigate', { url: 'about:blank' });
    await sleep(500);
    await this.send('Page.navigate', { url });
    if (waitReady) await this.waitFor("document.readyState === 'complete'", 15000, '页面加载完成');
    await sleep(300);
    await this.watchErrors();
  }

  /** 在当前 document 注入错误监听（导航后须重新注入）。 */
  async watchErrors() {
    try {
      await this.evalJs("window.__e2eErr=null;window.addEventListener('error',e=>{window.__e2eErr=(window.__e2eErr||'')+'|err:'+e.message});window.addEventListener('unhandledrejection',e=>{window.__e2eErr=(window.__e2eErr||'')+'|rej:'+(e.reason&&e.reason.message)});");
    } catch (e) { /* 页面导航中忽略 */ }
  }

  /** 通过文件选择器注入文件（等价用户打开文件）。 */
  async injectFile(filePath, selector = '#fileInput') {
    const { root } = await this.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await this.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  }

  async click(selector) {
    const ok = await this.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error('元素不存在: ' + selector);
    await sleep(120);
  }

  /** 受信任鼠标事件（真实手势）：click/dbl/mousedown+mousemove+mouseup。 */
  async mouse(type, x, y) {
    const clickCount = type === 'dbl' ? 2 : 1;
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount });
    if (type === 'dbl') {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 2 });
    }
  }

  async drag(x0, y0, x1, y1) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, button: 'left', buttons: 1 });
      await sleep(20);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  }

  async wheel(x, y, deltaY, ctrl = false) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers: ctrl ? 2 : 0 });
  }

  /** 取元素中心坐标。 */
  async center(selector) {
    return this.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  }

  async screenshot(filePath) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(s.data, 'base64'));
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
  }

  /** 受信任鼠标点击（用户手势场景；找不到元素时抛错）。 */
  async trustedClick(selector) {
    const r = await this.center(selector);
    if (!r) throw new Error('元素不存在: ' + selector);
    await this.mouse('click', r.x, r.y);
  }

  /** 设置下载目录（browser 级 setDownloadBehavior，连接保持打开——关闭后配置会失效）。 */
  async prepareDownloads(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const bws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((r, j) => { bws.onopen = r; bws.onerror = () => j(new Error('browser ws 失败')); });
    await new Promise((resolve, reject) => {
      bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) m.error ? reject(new Error(m.error.message)) : resolve(m.result); };
      bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: path.resolve(dir), eventsEnabled: true } }));
    });
    // 不关闭连接：该配置与 browser 会话绑定，关闭后失效
    this._browserWs = bws;
  }

  /** 等待目录中出现修改时间晚于 beforeMtime 的目标文件（按 mtime 判定，同名覆盖也可靠）。 */
  async waitForDownload(dir, ext, timeoutMs = 60000, beforeMtime = 0) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const hits = fs.readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
        .filter((x) => x.m > beforeMtime);
      if (hits.length) {
        hits.sort((a, b) => a.m - b.m);
        return path.join(dir, hits[hits.length - 1].f);
      }
      await sleep(300);
    }
    throw new Error('等待下载超时: ' + ext);
  }

  pageErrs() {
    return this.evalJs('window.__e2eErr || null').then((pageErr) => pageErr ? [...this.errs, 'PAGE:' + pageErr] : [...this.errs]).catch(() => [...this.errs]);
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

// ---------- 产物校验 ----------

/** WAV：RIFF/fmt/data 解析。返回 {sr, ch, bits, dur, peak, clip}。 */
export function wavInfo(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('非 WAV');
  let off = 12, fmt = null, dataLen = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      dataLen = len;
      break;
    }
    off += 8 + len + (len % 2);
  }
  if (!fmt || dataLen === null) throw new Error('WAV 结构不完整');
  // 峰值（16-bit 有符号）
  let peak = 0;
  const start = off + 8;
  const n = Math.min(dataLen, (buf.length - start - 1)) >> 1;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(buf.readInt16LE(start + i * 2));
    if (v > peak) peak = v;
  }
  return { sr: fmt.sr, ch: fmt.ch, bits: fmt.bits, dur: dataLen / (fmt.sr * fmt.ch * (fmt.bits / 8)), peak, clip: peak >= 32767 };
}

/** MP3：从帧头精确步进扫描，提取 MPEG 版本/采样率/码率/帧数/时长（lamejs 固定 MPEG1 Layer3）。 */
export function mp3Info(buf) {
  const srTable = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const brTable = { 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0], 0: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] };
  // 找第一帧头
  let i = 0;
  while (i < buf.length - 4 && !(buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0)) i++;
  let frames = 0, sr = null, bitrate = null, pos = i;
  while (pos + 4 <= buf.length) {
    if (!(buf[pos] === 0xff && (buf[pos + 1] & 0xe0) === 0xe0)) break;
    const v = (buf[pos + 1] >> 3) & 0x3;
    const l = (buf[pos + 1] >> 1) & 0x3;
    if (v === 1 || l === 0) break;
    const srI = (buf[pos + 2] >> 2) & 0x3;
    if (srI === 3) break;
    const brI = (buf[pos + 2] >> 4) & 0xf;
    if (brI === 0 || brI === 15) break;
    if (sr === null) { sr = srTable[v][srI]; bitrate = brTable[v][brI]; }
    const padding = (buf[pos + 2] >> 1) & 0x1;
    const frameLen = Math.floor((144 * (bitrate * 1000)) / sr) + padding;
    if (frameLen <= 4) break;
    frames++;
    pos += frameLen;
  }
  return { frames, sr, bitrate, dur: sr && frames ? frames * 1152 / sr : null };
}

/** MP4：检查 ftyp/moov/mdat 盒与顶层结构。 */
export function mp4Info(buf) {
  const find = (tag) => {
    let off = 0;
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      if (type === tag) return { off, size };
      if (size < 8) break;
      off += size;
    }
    return null;
  };
  return { ftyp: !!find('ftyp'), moov: !!find('moov'), mdat: !!find('mdat'), bytes: buf.length };
}

/** 数组文本截断（日志用）。 */
export function clip(s, n = 400) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
