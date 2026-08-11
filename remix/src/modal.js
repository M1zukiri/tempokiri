/**
 * modal.js — 「节拍设置」小窗口（确认制，支持分段网格）。
 *
 * 交互规则：
 *   - 「自动识别」只填充输入框，不应用；
 *   - 必须点击「确认」才回调应用（画网格 + 写缓存），「取消」放弃；
 *   - 多段时，第 N 段的识别按钮可用性由 onAutoDetect 返回的错误信息控制。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BEAT_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
  const UNIT_CHOICES = [2, 4, 8, 16];

  function buildModalDom() {
    const overlay = document.createElement('div');
    overlay.id = 'modalOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="节拍设置">
        <h3>节拍设置</h3>
        <p class="modal-sub">自动识别只填充数值，点击「确认」才会应用网格。段落可设置不同 BPM/拍号以适配变速歌曲。</p>
        <div class="modal-form">
          <label>第 1 段起点偏移（秒）
            <input id="mOffset" type="number" step="0.001" placeholder="如 0" />
          </label>
        </div>
        <div class="seg-header">段落</div>
        <table class="seg-table">
          <thead>
            <tr>
              <th>#</th><th>BPM</th><th>拍号</th><th>长度方式</th><th>数量</th><th>网格分辨率<br><span class="th-sub">每小节线数</span></th><th></th><th></th>
            </tr>
          </thead>
          <tbody id="segTbody"></tbody>
        </table>
        <div class="modal-form">
          <button id="mAddSeg" class="btn btn-mini-wide">+ 添加段落</button>
        </div>
        <div id="mAutoStatus" class="modal-status" hidden></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button id="mCancel" class="btn">取消</button>
          <button id="mOk" class="btn btn-primary">确认</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  let overlay = null;
  let okCb = null;
  let autoCb = null;
  let autoBusy = false;
  let rows = []; // {bpm, beats, unit, mode: 'bars'|'dur', qty, status}

  function el(id) {
    return overlay.querySelector('#' + id);
  }

  function rowToSeg(r, isLast) {
    const seg = {
      bpm: parseFloat(r.bpm),
      beatsPerBar: parseInt(r.beats, 10),
      beatUnit: parseInt(r.unit, 10),
    };
    const res = parseInt(r.res, 10);
    if (res > 0) seg.resolution = res;
    if (!isLast) {
      const qty = parseFloat(r.qty);
      if (r.mode === 'bars') seg.bars = qty;
      else if (r.mode === 'dur') seg.durationSec = qty;
    }
    return seg;
  }

  function renderRows() {
    const tbody = el('segTbody');
    tbody.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      const isLast = i === rows.length - 1;
      tr.innerHTML = `
        <td class="seg-idx">${i + 1}</td>
        <td><input type="number" class="seg-bpm" min="40" max="300" step="0.1" value="${r.bpm != null ? r.bpm : ''}" placeholder="BPM" /></td>
        <td>
          <select class="seg-beats">${BEAT_CHOICES.map((b) => `<option value="${b}" ${b == r.beats ? 'selected' : ''}>${b}</option>`).join('')}</select>
          /
          <select class="seg-unit">${UNIT_CHOICES.map((u) => `<option value="${u}" ${u == r.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </td>
        <td>
          ${isLast
            ? '<span class="seg-rest">剩余所有</span>'
            : `<select class="seg-mode">
                <option value="bars" ${r.mode === 'bars' ? 'selected' : ''}>小节数</option>
                <option value="dur" ${r.mode === 'dur' ? 'selected' : ''}>时长（秒）</option>
              </select>`}
        </td>
        <td>
          ${isLast
            ? '<span class="seg-rest">—</span>'
            : `<input type="number" class="seg-qty" min="0" step="0.1" value="${r.qty != null ? r.qty : ''}" placeholder="数量" />`}
        </td>
        <td><input type="number" class="seg-res" min="1" step="1" value="${r.res != null ? r.res : ''}" placeholder="每小节线数" title="网格分辨率：每小节网格线数，自动识别时默认为拍号分子" /></td>
        <td><button class="btn-mini seg-auto" title="自动识别该段">识别</button></td>
        <td><button class="btn-mini del seg-del" title="删除该段">✕</button></td>`;
      tr.querySelector('.seg-bpm').addEventListener('change', (e) => (r.bpm = e.target.value));
      tr.querySelector('.seg-beats').addEventListener('change', (e) => (r.beats = parseInt(e.target.value, 10)));
      tr.querySelector('.seg-unit').addEventListener('change', (e) => (r.unit = parseInt(e.target.value, 10)));
      const modeSel = tr.querySelector('.seg-mode');
      if (modeSel) modeSel.addEventListener('change', (e) => (r.mode = e.target.value));
      const qtyInput = tr.querySelector('.seg-qty');
      if (qtyInput) qtyInput.addEventListener('change', (e) => (r.qty = e.target.value));
      tr.querySelector('.seg-res').addEventListener('change', (e) => (r.res = e.target.value));
      tr.querySelector('.seg-auto').addEventListener('click', () => runAuto(i));
      tr.querySelector('.seg-bpm').addEventListener('change', (e) => (r.bpm = e.target.value));
      tr.querySelector('.seg-del').addEventListener('click', () => {
        if (rows.length > 1) {
          rows.splice(i, 1);
          renderRows();
        }
      });
      tbody.appendChild(tr);
    });
  }

  async function runAuto(i) {
    if (autoBusy || !autoCb) return;
    const r = rows[i];
    const status = el('mAutoStatus');
    status.hidden = false;
    status.textContent = '正在分析第 ' + (i + 1) + ' 段…';
    autoBusy = true;
    try {
      const result = await autoCb(i, rowToSeg(r, i === rows.length - 1), rows.map((x, j) => rowToSeg(x, j === rows.length - 1)));
      if (result && result.error) {
        status.textContent = result.error;
        return;
      }
      if (result && result.bpm) {
        r.bpm = result.bpm.toFixed(1);
        // 自动识别默认网格分辨率 = 每小节拍数（每拍一条线），可手动修改
        if (r.res == null || r.res === '') r.res = r.beats;
        // 第 1 段识别的 offset 填入全局偏移（后续段相位按前段衔接，不填）
        if (i === 0 && result.offset != null) {
          el('mOffset').value = String(Number(result.offset.toFixed(3)));
        }
        renderRows();
        status.textContent = '第 ' + (i + 1) + ' 段识别完成：BPM ' + result.bpm.toFixed(1) +
          (result.offset != null ? '，偏移 ' + Number(result.offset.toFixed(3)) + 's' : '') + '。确认后生效。';
      } else {
        status.textContent = '未能识别出清晰节拍，请手动输入 BPM。';
      }
    } catch (e) {
      status.textContent = '识别失败：' + e.message;
    } finally {
      autoBusy = false;
    }
  }

  function validate() {
    if (rows.length === 0) return '至少需要一个段落';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const bpm = parseFloat(r.bpm);
      if (!isFinite(bpm) || bpm < 40 || bpm > 300) return '第 ' + (i + 1) + ' 段 BPM 需在 40–300 之间';
      // 末段为"剩余所有"，无需长度
      if (i === rows.length - 1) continue;
      const qty = parseFloat(r.qty);
      if (!isFinite(qty) || qty <= 0) return '第 ' + (i + 1) + ' 段需填写小节数或时长';
    }
    const offset = parseFloat(el('mOffset').value);
    if (!isFinite(offset)) return '偏移需为数字（可为负）';
    return null;
  }

  /**
   * 打开设置窗口。
   * @param {object} current {segments, offset}
   * @param {object} callbacks
   * @param {(segIndex:number, seg:object) => Promise<{bpm:number, offset?:number}|{error:string}>} callbacks.onAutoDetect
   * @param {(values:{segments:Array, offset:number}) => void} callbacks.onConfirm
   */
  function open(current, callbacks) {
    if (!overlay) overlay = buildModalDom();
    okCb = callbacks.onConfirm || null;
    autoCb = callbacks.onAutoDetect || null;
    el('mOffset').value = current.offset != null ? current.offset : 0;
    rows = (current.segments && current.segments.length
      ? current.segments
      : [{ bpm: null, beatsPerBar: 4, beatUnit: 4 }]
    ).map((s) => ({
      bpm: s.bpm != null ? s.bpm : null,
      beats: s.beatsPerBar || 4,
      unit: s.beatUnit || 4,
      mode: s.durationSec != null ? 'dur' : 'bars',
      qty: s.durationSec != null ? s.durationSec : s.bars != null ? s.bars : null,
      res: s.resolution != null ? s.resolution : null,
    }));
    renderRows();
    const status = el('mAutoStatus');
    status.hidden = true;
    status.textContent = '';
    overlay.hidden = false;
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function init() {
    if (!overlay) overlay = buildModalDom();
    const status = el('mAutoStatus');

    el('mOk').addEventListener('click', () => {
      const err = validate();
      if (err) {
        status.textContent = err;
        status.hidden = false;
        return;
      }
      const values = {
        segments: rows.map((r, i) => rowToSeg(r, i === rows.length - 1)),
        offset: parseFloat(el('mOffset').value),
      };
      if (okCb) okCb(values);
      close();
    });

    el('mCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    el('mAddSeg').addEventListener('click', () => {
      rows.push({ bpm: null, beats: 4, unit: 4, mode: 'bars', qty: null });
      renderRows();
    });
  }

  init();

  return { open, close };
});
