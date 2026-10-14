// 临时探针 2：手动添加 time 模式完整序列
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
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const url = 'file:///C:/Users/M1zukuro/Desktop/%E4%B8%AA%E4%BA%BA/tempokiri/tempokiri/dist/tempokiri-workstation.html';
  await send('Page.navigate', { url: 'about:blank' }); await new Promise(r => setTimeout(r, 400));
  await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 2000));
  await ev('localStorage.clear()');
  await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 2000));
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
  await send('DOM.setFileInputFiles', { nodeId, files: ['C:/Users/M1zukuro/Desktop/个人/tempokiri/tempokiri/examples/test_track.wav'] });
  await new Promise(r => setTimeout(r, 2500));
  await ev('document.getElementById("btnManualAdd").click()');
  await new Promise(r => setTimeout(r, 400));
  console.log('step1 radio:', await ev(`(() => {
    const r = document.querySelector('#maRange .ri-block-time input[type=radio]');
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({
      timeActive: document.querySelector('#maRange .ri-block-time').classList.contains('ri-active'),
      n: document.querySelectorAll('#maRange .range-input').length,
      hosts: [...document.querySelectorAll('.range-input')].map(e => (e.parentElement.id || e.parentElement.className || '?').slice(0, 30))
    });
  })()`));
  await ev(`(() => { const i = document.querySelector('#maRange .ri-ts'); i.value = '20'; i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await ev(`(() => { const i = document.querySelector('#maRange .ri-te'); i.value = '22'; i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await new Promise(r => setTimeout(r, 200));
  console.log('step2 values:', await ev(`JSON.stringify({
    ts: document.querySelector('#maRange .ri-ts').value,
    te: document.querySelector('#maRange .ri-te').value,
    timeActive: document.querySelector('#maRange .ri-block-time').classList.contains('ri-active')
  })`));
  await ev('document.getElementById("btnManualOk").click()');
  await new Promise(r => setTimeout(r, 400));
  console.log('step3 ok:', await ev(`JSON.stringify({
    cards: document.querySelectorAll('#seqList .seq-card').length,
    status: document.getElementById('statusBar').textContent
  })`));
  process.exit(0);
})();
