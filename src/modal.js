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
              <th>#</th><th>BPM</th><th>拍号</th><th>长度<br><span class="th-sub">小节/格或时间</span></th><th>网格分辨率<br><span class="th-sub">每小节线数</span></th><th></th><th></th>
            </tr>
          </thead>
          <tbody id="segTbody"></tbody>
        </table>
        <div class="modal-form">
          <button id="mAddSeg" class="btn btn-mini-wide">+ 添加段落</button>
        </div>
        <div id="mAutoStatus" class="modal-status" hidden></div>
        <div id="autoCands" class="modal-status auto-cands" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center" hidden></div>
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
      // BPM 显示与存储统一上限 2 位小数（parseFloat 透传会保留任意位数）
      bpm: Math.round(parseFloat(r.bpm) * 100) / 100,
      beatsPerBar: parseInt(r.beats, 10),
      beatUnit: parseInt(r.unit, 10),
    };
    const res = parseInt(r.res, 10);
    if (res > 0) seg.resolution = res;
    if (!isLast) {
      const qty = parseFloat(r.qty);
      if (isFinite(qty) && qty > 0) seg.durationSec = qty;
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
        <td class="seg-length">
          ${isLast ? '<span class="seg-rest">剩余所有</span>' : ''}
        </td>
        <td><input type="number" class="seg-res" min="1" step="1" value="${r.res != null ? r.res : ''}" placeholder="每小节线数" title="网格分辨率：每小节网格线数，自动识别时默认为拍号分子" /></td>
        <td><button class="btn-mini seg-auto" title="自动识别该段">识别</button></td>
        <td><button class="btn-mini del seg-del" title="删除该段">✕</button></td>`;
      const refreshLen = () => r._unitInput && r._unitInput.refresh();
      tr.querySelector('.seg-bpm').addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (isFinite(v)) {
          // 规范化：显示与存储统一到最多 2 位小数（非法输入保留原文，由 validate 报错）
          const norm = Math.round(v * 100) / 100;
          r.bpm = String(norm);
          e.target.value = String(norm);
        } else {
          r.bpm = e.target.value;
        }
        refreshLen();
      });
      tr.querySelector('.seg-beats').addEventListener('change', (e) => { r.beats = parseInt(e.target.value, 10); refreshLen(); });
      tr.querySelector('.seg-unit').addEventListener('change', (e) => { r.unit = parseInt(e.target.value, 10); refreshLen(); });
      tr.querySelector('.seg-res').addEventListener('change', (e) => { r.res = e.target.value; refreshLen(); });
      tr.querySelector('.seg-auto').addEventListener('click', () => runAuto(i));
      tr.querySelector('.seg-del').addEventListener('click', () => {
        if (rows.length > 1) {
          rows.splice(i, 1);
          renderRows();
        }
      });
      const lenCell = tr.querySelector('.seg-length');
      if (lenCell && !isLast) {
        const comp = MC.UnitInput.create(lenCell, {
          kind: 'length',
          getStep: () => stepOf(r),
          value: parseFloat(r.qty) || 0,
          onChange: (sec) => { r.qty = sec; },
        });
        r._unitInput = comp;
      }
      tbody.appendChild(tr);
    });
  }

  /** 该段行当前参数下的小节时长与每格步长（未填 BPM 时按 120 估算）。 */
  function stepOf(r) {
    const bpm = parseFloat(r.bpm) || 120;
    const beats = parseInt(r.beats, 10) || 4;
    const unit = parseInt(r.unit, 10) || 4;
    const res = parseInt(r.res, 10) || beats;
    const barDur = (60 / bpm) * beats * (4 / unit);
    return { barDur, step: barDur / res };
  }

  /** 段定义（含 bpm/拍号）下的小节时长。 */
  function barDurOfSeg(s) {
    const bpm = parseFloat(s.bpm) || 120;
    const beats = s.beatsPerBar || 4;
    const unit = s.beatUnit || 4;
    return (60 / bpm) * beats * (4 / unit);
  }

  /**
   * 竞争层 BPM 候选渲染（v1.11.0）：识别结果旁展示「其他可能 BPM」，点击即采用该值。
   * @param {Array<{bpm:number, harm:null|string}>} cands
   * @param {number} rowIndex 对应段落行
   */
  function renderCands(cands, rowIndex) {
    const box = el('autoCands');
    if (!box) return;
    box.innerHTML = '';
    if (!cands || !cands.length) {
      box.hidden = true;
      return;
    }
    const harmLabel = { '2x': '2×', '0.5x': '½×', '3x': '3×', '0.33x': '⅓×' };
    box.hidden = false;
    const label = document.createElement('span');
    label.className = 'auto-cand-label';
    label.textContent = '其他可能 BPM：';
    box.appendChild(label);    for (const c of cands) {
      const b = document.createElement('button');
      b.className = 'btn-mini auto-cand-bpm';
      b.textContent = c.bpm + (c.harm && harmLabel[c.harm] ? '（' + harmLabel[c.harm] + '）' : '');
      b.title = '采用 ' + c.bpm;
      b.addEventListener('click', () => {
        const rr = rows[rowIndex];
        if (!rr) return;
        rr.bpm = String(c.bpm); // 候选已按 0.1 精度（≤2 位上限）
        // 切换候选 BPM 后网格分辨率同步为每小节拍数（与识别一致的默认）
        if (rr.res == null || rr.res === '') rr.res = rr.beats;
        renderRows();
        el('mAutoStatus').textContent = '已切换为 BPM ' + c.bpm + '，确认后生效。';
      });
      box.appendChild(b);
    }
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
        renderCands(result.cands, i);
      } else {
        status.textContent = '未能识别出清晰节拍，请手动输入 BPM。';
        renderCands(null, i);
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
      if (!isFinite(qty) || qty <= 0) return '第 ' + (i + 1) + ' 段需填写长度（小节/格或时间）';
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
      qty: s.durationSec != null ? s.durationSec : s.bars != null ? s.bars * barDurOfSeg(s) : null,
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
