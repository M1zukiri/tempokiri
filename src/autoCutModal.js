// 创建时间：2026-08-19 21:40:00
/**
 * autoCutModal.js — 「自动剪辑方案」弹窗（工具栏入口）。
 *
 * 交互规则：
 *   - main.js 分析完成后调 open(plan, { onImport, onCancel }) 展示方案；
 *   - 方案含两表：可无痕剪辑的位置（时间/小节/依据/质量）与分段方案（起止/时长）；
 *   - 「一键导入到拼接序列」回调 onImport（main.js 负责替换确认与落列）；
 *   - Esc 由 main.js 统一处理（close()）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.autoCutModal = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  const REASON_LABEL = {
    bar: T('autoCut.reasonBar'),
    beat: T('autoCut.reasonBeat'),
    valley: T('autoCut.reasonValley'),
  };

  let overlay = null;
  let plan = null;
  let onImport = null;
  let onCancel = null;
  let getGrid = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function buildDom() {
    overlay = document.createElement('div');
    overlay.id = 'autoCutOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="' + T('autoCut.title') + '">' +
      '<h3>' + T('autoCut.title') + '</h3>' +
      '<p class="modal-sub">' + T('autoCut.sub') + '</p>' +
      '<p class="ac-range" id="acRange"></p>' +
      '<div class="ac-section" id="acCutsSection">' +
      '<h4 id="acCutsTitle"></h4>' +
      '<table class="ac-table"><thead><tr>' +
      '<th>' + T('autoCut.colTime') + '</th>' +
      '<th>' + T('autoCut.colBar') + '</th>' +
      '<th>' + T('autoCut.colReason') + '</th>' +
      '<th>' + T('autoCut.colScore') + '</th>' +
      '</tr></thead><tbody id="acCutsBody"></tbody></table>' +
      '</div>' +
      '<div class="ac-section">' +
      '<h4 id="acSegsTitle"></h4>' +
      '<table class="ac-table"><thead><tr>' +
      '<th>' + T('autoCut.colIdx') + '</th>' +
      '<th>' + T('autoCut.colRange') + '</th>' +
      '<th>' + T('autoCut.colDur') + '</th>' +
      '</tr></thead><tbody id="acSegsBody"></tbody></table>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      '<button id="acCancel" class="btn">' + T('autoCut.cancel') + '</button>' +
      '<button id="acImport" class="btn btn-primary">' + T('autoCut.import') + '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.textContent =
      '.ac-range{font-size:12px;color:var(--text-secondary);padding:2px 10px 4px}' +
      '.ac-section{max-height:26vh;overflow:auto;padding:2px 10px 8px}' +
      '.ac-section h4{margin:6px 0 4px;font-size:13px;color:var(--text-secondary)}' +
      '.ac-table{width:100%;border-collapse:collapse;font-size:12px}' +
      '.ac-table th{text-align:left;color:var(--text-secondary);font-weight:600;padding:3px 8px;border-bottom:1px solid var(--border-muted)}' +
      '.ac-table td{padding:3px 8px;border-bottom:1px solid rgba(128,128,128,.12);font-variant-numeric:tabular-nums}' +
      '.ac-table tr:last-child td{border-bottom:none}' +
      '.ac-score{display:inline-block;min-width:44px;text-align:center;padding:1px 6px;border-radius:8px;font-size:11px}' +
      '.ac-score.high{background:rgba(34,211,238,.18);color:var(--accent-fg,#22d3ee)}' +
      '.ac-score.mid{background:rgba(250,204,21,.16);color:#facc15}' +
      '.ac-score.low{background:rgba(148,163,184,.14);color:var(--text-secondary)}';
    document.head.appendChild(style);

    document.getElementById('acCancel').addEventListener('click', close);
    document.getElementById('acImport').addEventListener('click', () => {
      if (onImport) onImport(plan);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  function scoreClass(score) {
    if (score >= 70) return 'high';
    if (score >= 40) return 'mid';
    return 'low';
  }

  function fmtTime(sec) {
    // ui.js 铺平到 MC 顶层（无 MC.ui 命名空间）；Node/缺省时回退
    return (typeof MC.fmtTime === 'function') ? MC.fmtTime(sec) : sec.toFixed(2);
  }

  /** 剪切点对应的小节描述（有网格时）；无网格或超出网格返回 ''。 */
  function barDesc(time) {
    const grid = getGrid ? getGrid() : null;
    if (!grid || typeof MC.timeToBarCell !== 'function') return '';
    const bc = MC.timeToBarCell(grid, time);
    return bc ? T('autoCut.barAt', { bar: bc.bar, cell: bc.cell }) : '';
  }

  function render() {
    if (!overlay) buildDom();
    const cuts = (plan && plan.cuts) || [];
    const segments = (plan && plan.segments) || [];
    document.getElementById('acRange').textContent = plan && plan.rangeFull
      ? T('autoCut.rangeFull')
      : T('autoCut.range', { from: fmtTime(plan.searchStart), to: fmtTime(plan.searchEnd) });

    const cutsSection = document.getElementById('acCutsSection');
    cutsSection.hidden = cuts.length === 0;
    if (cuts.length) {
      document.getElementById('acCutsTitle').textContent = T('autoCut.cutTitle', { n: cuts.length });
      const body = document.getElementById('acCutsBody');
      body.innerHTML = '';
      for (const c of cuts) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + fmtTime(c.time) + '</td>' +
          '<td>' + esc(barDesc(c.time)) + '</td>' +
          '<td>' + esc(REASON_LABEL[c.reason] || c.reason) + '</td>' +
          '<td><span class="ac-score ' + scoreClass(c.score) + '">' + T('autoCut.score', { score: c.score }) + '</span></td>';
        body.appendChild(tr);
      }
    }

    document.getElementById('acSegsTitle').textContent = T('autoCut.segTitle', { n: segments.length });
    const segBody = document.getElementById('acSegsBody');
    segBody.innerHTML = '';
    segments.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td>' + fmtTime(s.startTime) + ' – ' + fmtTime(s.endTime) + '</td>' +
        '<td>' + fmtTime(s.endTime - s.startTime) + '</td>';
      segBody.appendChild(tr);
    });
  }

  /**
   * 打开方案弹窗。
   * @param {object} p 方案：{cuts, segments, searchStart, searchEnd, rangeFull}
   * @param {object} opts
   * @param {(plan:object) => void} opts.onImport 导入回调
   * @param {() => void} opts.onCancel 取消回调
   * @param {() => object|null} [opts.getGrid] 取当前网格（小节列显示用）
   */
  function open(p, opts) {
    if (!overlay) buildDom();
    plan = p || null;
    onImport = (opts && opts.onImport) || null;
    onCancel = (opts && opts.onCancel) || null;
    getGrid = (opts && opts.getGrid) || null;
    render();
    overlay.hidden = false;
  }

  /** 关闭弹窗（Esc 快捷键入口调用）。 */
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (onCancel) onCancel();
    onCancel = null;
  }

  return { open, close };
});
