// 创建时间：2026-08-19 23:10:00
/**
 * autoCutModal.js — 「自动剪辑方案」弹窗（工具栏入口）。
 *
 * 交互规则：
 *   - main.js 分析完成后调 open(plan, opts) 展示方案；
 *   - 方案含两表：可无痕剪辑的位置（时间/小节/依据/质量）与分段方案（起止/时长），
 *     每行提供「▶ 试听」（剪切点前后 2s / 整段），经 onPreview 回调播放原曲区间；
 *   - 参数行（最少段长 2/3/5s、对齐网格开关）即时生效：变更即调 onAnalyze
 *     重新计算方案并 update（参数无需「重新分析」按钮）；
 *   - 摘要行显示拼接总时长与保留比例；「一键导入」回调 onImport；
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

  const MINSEG_CHOICES = [2, 3, 5];

  const REASON_LABEL = {
    bar: T('autoCut.reasonBar'),
    beat: T('autoCut.reasonBeat'),
    valley: T('autoCut.reasonValley'),
  };
  // 字面量 T 调用：build.py 按引号字面量校验文案引用（变量拼接无法扫描）
  const LISTEN_CUT_TITLE = T('autoCut.listenCut');
  const LISTEN_SEG_TITLE = T('autoCut.listenSeg');

  let overlay = null;
  let plan = null;
  let params = { minSegSec: 3, alignGrid: true };
  let onImport = null;
  let onAnalyze = null;
  let onPreview = null;
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
      '<div class="ac-params" id="acParams">' +
      '<span class="ac-param-label">' + T('autoCut.minSeg') + '</span>' +
      '<span class="ac-minsegs" id="acMinsegs">' +
      MINSEG_CHOICES.map((s) => '<button class="btn btn-mini ac-minseg" data-sec="' + s + '">' + s + 's</button>').join('') +
      '</span>' +
      '<label class="ac-align" id="acAlignWrap"><input type="checkbox" id="acAlign" />' + T('autoCut.alignGrid') + '</label>' +
      '</div>' +
      '<p class="ac-summary" id="acSummary"></p>' +
      '<div class="ac-section" id="acCutsSection">' +
      '<h4 id="acCutsTitle"></h4>' +
      '<table class="ac-table"><thead><tr>' +
      '<th>' + T('autoCut.colTime') + '</th>' +
      '<th>' + T('autoCut.colBar') + '</th>' +
      '<th>' + T('autoCut.colReason') + '</th>' +
      '<th>' + T('autoCut.colScore') + '</th>' +
      '<th></th>' +
      '</tr></thead><tbody id="acCutsBody"></tbody></table>' +
      '</div>' +
      '<div class="ac-section">' +
      '<h4 id="acSegsTitle"></h4>' +
      '<table class="ac-table"><thead><tr>' +
      '<th>' + T('autoCut.colIdx') + '</th>' +
      '<th>' + T('autoCut.colRange') + '</th>' +
      '<th>' + T('autoCut.colDur') + '</th>' +
      '<th></th>' +
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
      '.ac-params{display:flex;align-items:center;gap:10px;padding:4px 10px;flex-wrap:wrap}' +
      '.ac-param-label{font-size:12px;color:var(--text-secondary);font-weight:600}' +
      '.ac-minsegs{display:inline-flex;gap:4px}' +
      '.ac-minseg{min-width:38px}' +
      '.ac-minseg.active{background:var(--accent);color:var(--accent-fg,#fff);border-color:transparent}' +
      '.ac-align{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary)}' +
      '.ac-summary{font-size:12px;color:var(--accent-fg,#22d3ee);padding:2px 10px}' +
      '.ac-section{max-height:26vh;overflow:auto;padding:2px 10px 8px}' +
      '.ac-section h4{margin:6px 0 4px;font-size:13px;color:var(--text-secondary)}' +
      '.ac-table{width:100%;border-collapse:collapse;font-size:12px}' +
      '.ac-table th{text-align:left;color:var(--text-secondary);font-weight:600;padding:3px 8px;border-bottom:1px solid var(--border-muted)}' +
      '.ac-table td{padding:3px 8px;border-bottom:1px solid rgba(128,128,128,.12);font-variant-numeric:tabular-nums}' +
      '.ac-table tr:last-child td{border-bottom:none}' +
      '.ac-score{display:inline-block;min-width:44px;text-align:center;padding:1px 6px;border-radius:8px;font-size:11px}' +
      '.ac-score.high{background:rgba(34,211,238,.18);color:var(--accent-fg,#22d3ee)}' +
      '.ac-score.mid{background:rgba(250,204,21,.16);color:#facc15}' +
      '.ac-score.low{background:rgba(148,163,184,.14);color:var(--text-secondary)}' +
      '.ac-note{font-size:12px;color:var(--text-secondary);padding:8px 10px}';
    document.head.appendChild(style);

    document.getElementById('acCancel').addEventListener('click', close);
    document.getElementById('acImport').addEventListener('click', () => {
      if (onImport) onImport(plan);
    });
    // 最少段长档位：即时重分析
    document.getElementById('acMinsegs').addEventListener('click', (e) => {
      const btn = e.target.closest('.ac-minseg');
      if (!btn) return;
      params.minSegSec = parseInt(btn.dataset.sec, 10);
      syncParamsUI();
      reanalyze();
    });
    // 对齐网格开关：有网格时显示；即时重分析
    document.getElementById('acAlign').addEventListener('change', (e) => {
      params.alignGrid = e.target.checked;
      reanalyze();
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

  /** 试听按钮（监听 onPreview 回调）。 */
  function listenBtn(start, end, title) {
    const b = document.createElement('button');
    b.className = 'btn-mini ac-listen';
    b.textContent = '▶';
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onPreview) onPreview(start, end);
    });
    return b;
  }

  /** 同步参数 UI 选中态与网格开关可见性。 */
  function syncParamsUI() {
    document.querySelectorAll('#acMinsegs .ac-minseg').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.sec, 10) === params.minSegSec);
    });
    const wrap = document.getElementById('acAlignWrap');
    const grid = getGrid ? getGrid() : null;
    wrap.hidden = !grid;
    document.getElementById('acAlign').checked = params.alignGrid;
  }

  /** 重新分析（参数变更即时调用）：onAnalyze 返回新方案并更新展示。 */
  function reanalyze() {
    const next = onAnalyze ? onAnalyze({ minSegSec: params.minSegSec, alignGrid: params.alignGrid }) : null;
    if (next === null) {
      showEmpty();
    } else {
      plan = next;
      render(false);
    }
  }

  /** 无方案状态：清空表格、隐藏剪切点表并显示提示（导入按钮禁用）。 */
  function showEmpty() {
    document.getElementById('acSummary').textContent = T('autoCut.none');
    document.getElementById('acCutsBody').innerHTML = '';
    const cutsSection = document.getElementById('acCutsSection');
    cutsSection.hidden = true;
    const segs = document.getElementById('acSegsBody');
    segs.innerHTML = '<tr><td class="ac-note" colspan="4">' + T('autoCut.none') + '</td></tr>';
    document.getElementById('acSegsTitle').textContent = T('autoCut.segTitle', { n: 0 });
    document.getElementById('acImport').disabled = true;
  }

  /** 渲染方案（参数 UI 不重建；renderSummary=true 时更新范围/摘要行）。 */
  function render(withRange) {
    if (!overlay) buildDom();
    if (withRange) {
      document.getElementById('acRange').textContent = plan
        ? (plan.rangeFull
          ? T('autoCut.rangeFull')
          : T('autoCut.range', { from: fmtTime(plan.searchStart), to: fmtTime(plan.searchEnd) }))
        : '';
    }
    document.getElementById('acImport').disabled = false;
    const cuts = (plan && plan.cuts) || [];
    const segments = (plan && plan.segments) || [];

    // 摘要：拼接总时长 + 保留比例
    const segTotal = segments.reduce((s, x) => s + (x.endTime - x.startTime), 0);
    const span = plan ? Math.max(0, plan.searchEnd - plan.searchStart) : 0;
    const pct = span > 0 ? Math.round((segTotal / span) * 100) : 0;
    document.getElementById('acSummary').textContent = T('autoCut.summary', { total: fmtTime(segTotal), pct });

    const cutsSection = document.getElementById('acCutsSection');
    cutsSection.hidden = cuts.length === 0;
    if (cuts.length) {
      document.getElementById('acCutsTitle').textContent = T('autoCut.cutTitle', { n: cuts.length });
      const body = document.getElementById('acCutsBody');
      body.innerHTML = '';
      for (const c of cuts) {
        const tr = document.createElement('tr');
        const ch = esc(barDesc(c.time));
        tr.innerHTML =
          '<td>' + fmtTime(c.time) + '</td>' +
          '<td>' + ch + '</td>' +
          '<td>' + esc(REASON_LABEL[c.reason] || c.reason) + '</td>' +
          '<td><span class="ac-score ' + scoreClass(c.score) + '">' + T('autoCut.score', { score: c.score }) + '</span></td>' +
          '<td></td>';
        tr.children[4].appendChild(listenBtn(Math.max(0, c.time - 1), c.time + 1, LISTEN_CUT_TITLE));
        body.appendChild(tr);
      }
    }

    document.getElementById('acSegsTitle').textContent = T('autoCut.segTitle', { n: segments.length });
    const segBody = document.getElementById('acSegsBody');
    segBody.innerHTML = '';
    if (!segments.length) {
      segBody.innerHTML = '<tr><td class="ac-note" colspan="4">' + T('autoCut.none') + '</td></tr>';
      return;
    }
    segments.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td>' + fmtTime(s.startTime) + ' – ' + fmtTime(s.endTime) + '</td>' +
        '<td>' + fmtTime(s.endTime - s.startTime) + '</td>' +
        '<td></td>';
      tr.children[3].appendChild(listenBtn(s.startTime, s.endTime, LISTEN_SEG_TITLE));
      segBody.appendChild(tr);
    });
  }

  /**
   * 打开方案弹窗并展示方案（含参数行、摘要行、试听按钮）。
   * @param {object} p 方案：{cuts, segments, searchStart, searchEnd, rangeFull}
   * @param {object} opts
   * @param {{minSegSec:number, alignGrid:boolean}} [opts.params] 当前方案参数
   * @param {() => object|null} [opts.getGrid] 取当前网格（小节列/对齐开关显示用）
   * @param {(plan:object) => void} opts.onImport 导入回调
   * @param {(params:{minSegSec:number,alignGrid:boolean}) => object|null} opts.onAnalyze
   *   参数变更重分析回调：返回新方案（null = 无方案）
   * @param {(start:number, end:number) => void} opts.onPreview 试听回调（原曲时间区间）
   * @param {() => void} opts.onCancel 取消回调
   */
  function open(p, opts) {
    if (!overlay) buildDom();
    plan = p || null;
    onImport = (opts && opts.onImport) || null;
    onAnalyze = (opts && opts.onAnalyze) || null;
    onPreview = (opts && opts.onPreview) || null;
    onCancel = (opts && opts.onCancel) || null;
    getGrid = (opts && opts.getGrid) || null;
    params = (opts && opts.params) ? Object.assign({}, opts.params) : { minSegSec: 3, alignGrid: true };
    syncParamsUI();
    render(true);
    // 无段方案：显示"未找到合适的剪辑位置"提示（保留参数行供调参重试）
    if (!p || !p.segments || !p.segments.length) showEmpty();
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
