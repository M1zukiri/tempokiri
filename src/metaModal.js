// 创建时间：2026-08-19 20:26:36
/**
 * metaModal.js — 「元数据」弹窗（页脚入口）。
 *
 * 交互规则：
 *   - 导入文件后 main.js 调 setData({ fileName, meta }) 推送当前文件元数据；
 *   - 6 个文本字段可编辑，input 事件防抖 200ms 调 onEdit（main.js 里更新
 *     state.meta 并持久化到 per-file 缓存）；空串保留为「清空该字段」语义；
 *   - 封面只读展示（缩略图，blob URL；无封面显示占位文案）；
 *   - 未导入文件时打开：空表单、输入禁用；
 *   - Esc 由 main.js 统一处理（close()）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.metaModal = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  // 字段定义：label 为模块加载时 T 字面量调用（与 settings.js FIELD_DEFS 同模式，
  // build.py 按 T 引号字面量校验 i18n 引用，动态拼接无法被扫描）
  const FIELDS = [
    { key: 'title', label: T('metadata.labels.title') },
    { key: 'artist', label: T('metadata.labels.artist') },
    { key: 'album', label: T('metadata.labels.album') },
    { key: 'composer', label: T('metadata.labels.composer') },
    { key: 'year', label: T('metadata.labels.year') },
    { key: 'genre', label: T('metadata.labels.genre') },
  ];

  let overlay = null;
  let data = null; // { fileName, meta }
  let onEdit = null; // 编辑回调（main.js 注册）
  let debTimer = null;
  let coverUrl = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function buildDom() {
    overlay = document.createElement('div');
    overlay.id = 'metaOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="' + T('metadata.aria') + '">' +
      '<h3>' + T('metadata.title') + '</h3>' +
      '<p class="modal-sub">' + T('metadata.sub') + '</p>' +
      '<div class="meta-file"><span class="meta-file-label">' + T('metadata.fileLabel') + '</span>' +
      '<span id="metaFileName" class="meta-file-name"></span></div>' +
      '<div class="meta-cover-row">' +
      '<span class="meta-file-label">' + T('metadata.coverLabel') + '</span>' +
      '<img id="metaCover" class="meta-cover" alt="cover" hidden />' +
      '<span id="metaNoCover" class="meta-nocover">' + T('metadata.noCover') + '</span>' +
      '</div>' +
      '<div class="meta-form">' +
      FIELDS.map((f) =>
        '<div class="meta-row" data-key="' + f.key + '">' +
        '<span class="meta-label">' + f.label + '</span>' +
        '<input id="meta-' + f.key + '" type="text" autocomplete="off" />' +
        '</div>'
      ).join('') +
      '</div>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      '<button id="metaClose" class="btn btn-primary">' + T('metadata.close') + '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.textContent =
      '.meta-form{display:flex;flex-direction:column;gap:8px;max-height:48vh;overflow:auto;padding:2px}' +
      '.meta-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;border:1px solid rgba(128,128,128,.25);border-radius:8px}' +
      '.meta-label{font-weight:600;min-width:70px}' +
      '.meta-row input[type=text]{flex:1;min-width:0;max-width:340px}' +
      '.meta-row input:disabled{opacity:.55}' +
      '.meta-file{display:flex;gap:8px;align-items:center;padding:4px 10px;font-size:13px}' +
      '.meta-file-label{color:var(--text-secondary);font-weight:600}' +
      '.meta-file-name{word-break:break-all}' +
      '.meta-cover-row{display:flex;gap:8px;align-items:center;padding:4px 10px}' +
      '.meta-cover{max-width:120px;max-height:120px;object-fit:contain;border-radius:6px;border:1px solid var(--border-muted)}' +
      '.meta-nocover{font-size:12px;color:var(--text-secondary)}';
    document.head.appendChild(style);

    document.getElementById('metaClose').addEventListener('click', () => { overlay.hidden = true; });

    FIELDS.forEach((f) => {
      const input = document.getElementById('meta-' + f.key);
      input.addEventListener('input', () => {
        if (!data || !onEdit) return;
        data.meta[f.key] = input.value;
        clearTimeout(debTimer);
        debTimer = setTimeout(() => onEdit({ ...data.meta }), 200);
      });
    });
  }

  function renderCover() {
    const img = document.getElementById('metaCover');
    const noCover = document.getElementById('metaNoCover');
    if (coverUrl) { URL.revokeObjectURL(coverUrl); coverUrl = null; }
    const cover = data && data.meta && data.meta.cover;
    if (cover && cover.data && cover.data.length) {
      coverUrl = URL.createObjectURL(new Blob([cover.data], { type: cover.mime || 'application/octet-stream' }));
      img.src = coverUrl;
      img.hidden = false;
      noCover.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      noCover.hidden = false;
    }
  }

  function render() {
    if (!overlay) buildDom();
    const meta = data ? data.meta : null;
    document.getElementById('metaFileName').textContent = data ? data.fileName : '';
    FIELDS.forEach((f) => {
      const input = document.getElementById('meta-' + f.key);
      input.value = meta && meta[f.key] != null ? meta[f.key] : '';
      input.disabled = !meta;
    });
    renderCover();
  }

  /** 注册编辑回调（main.js init 调用一次）。 */
  function init(opts) {
    onEdit = (opts && opts.onEdit) || null;
  }

  /** 推送当前文件元数据（导入后调用）。 */
  function setData(d) {
    data = d || null;
  }

  /** 打开弹窗（页脚入口调用；渲染当前 data）。 */
  function open() {
    render();
    overlay.hidden = false;
  }

  /** 关闭弹窗（Esc 快捷键入口调用）。 */
  function close() {
    if (overlay) overlay.hidden = true;
  }

  return { init, setData, open, close };
});
