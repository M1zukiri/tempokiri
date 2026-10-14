// 临时探针：radio change 是否触发 rangeInput 模式切换
(async () => {
  const list = await (await fetch('http://127.0.0.1:9338/json/list')).json();
  const t = list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async ex => {
    const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  const out = await ev(`(() => {
    const blk = document.querySelector('#maRange .ri-block-time');
    if (!blk) return 'no block';
    const radio = blk.querySelector('input[type=radio]');
    let fired = 0;
    radio.addEventListener('change', () => fired++);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({
      fired,
      checked: radio.checked,
      timeActive: blk.classList.contains('ri-active'),
      barsActive: document.querySelector('#maRange .ri-block-bars').classList.contains('ri-active'),
      radioName: radio.name,
      radios: document.querySelectorAll('#maRange input[type=radio]').length,
      tsVal: (document.querySelector('#maRange .ri-ts') || {}).value
    });
  })()`);
  console.log(out);
  process.exit(0);
})();
