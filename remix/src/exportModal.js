/**
 * exportModal.js — 「导出」参数小窗口。
 * 统一导出入口：格式（WAV/MP3/视频）、MP3 码率、交叉淡化时长、文件名。
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

  function buildDom() {
    const overlay = document.createElement('div');
    overlay.id = 'exportOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="导出">
        <h3>导出</h3>
        <div class="modal-form">
          <label>格式
            <select id="xFormat">
              <option value="wav">WAV（无损）</option>
              <option value="mp3">MP3</option>
              <option value="video">视频（MP4）</option>
            </select>
          </label>
          <label id="xBitrateRow" hidden>MP3 码率
            <select id="xBitrate">
              <option value="128">128 kbps</option>
              <option value="192" selected>192 kbps</option>
              <option value="320">320 kbps</option>
            </select>
          </label>
          <label>交叉淡化
            <input id="xCrossfade" type="number" min="0" max="1000" step="5" value="10" /> ms
          </label>
          <label>文件名
            <input id="xName" type="text" />
          </label>
        </div>
        <div id="xStatus" class="modal-status" hidden></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button id="xCancel" class="btn">取消</button>
          <button id="xOk" class="btn btn-primary">导出</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  let overlay = null;
  let exportCb = null;

  function el(id) {
    return overlay.querySelector('#' + id);
  }

  /**
   * 打开导出窗口。
   * @param {object} opts {baseName, kind:'audio'|'video', canVideo:boolean}
   * @param {object} callbacks {onExport}
   */
  function open(opts, callbacks) {
    if (!overlay) overlay = buildDom();
    exportCb = callbacks.onExport || null;
    el('xName').value = opts.baseName || 'remix';
    // 预填交叉淡化 = 全局高级设置（用户可在此窗口单独调整）
    const g = (MC.store ? MC.store.loadGlobalSettings() : null) || { crossfadeMs: 30 };
    el('xCrossfade').value = String(g.crossfadeMs);
    const fmt = el('xFormat');
    // 视频格式选项：仅视频文件且浏览器支持 WebCodecs
    const videoOpt = fmt.querySelector('option[value="video"]');
    videoOpt.hidden = !(opts.kind === 'video' && opts.canVideo);
    if (!videoOpt.hidden) {
      videoOpt.textContent = '视频（MP4，画面 + 新音频）';
    }
    if (fmt.value === 'video' && videoOpt.hidden) fmt.value = 'wav';
    onFormatChange();
    overlay.hidden = false;
  }

  function onFormatChange() {
    el('xBitrateRow').hidden = el('xFormat').value !== 'mp3';
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function init() {
    if (!overlay) overlay = buildDom();
    el('xFormat').addEventListener('change', onFormatChange);
    el('xCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    el('xOk').addEventListener('click', () => {
      if (!exportCb) return;
      const name = el('xName').value.trim();
      if (!name) {
        el('xStatus').hidden = false;
        el('xStatus').textContent = '请填写文件名';
        return;
      }
      const crossfade = Math.max(0, parseInt(el('xCrossfade').value, 10) || 0);
      const format = el('xFormat').value;
      exportCb({
        format,
        mp3Bitrate: parseInt(el('xBitrate').value, 10),
        crossfadeMs: crossfade,
        fileName: name,
      });
      close();
    });
  }

  init();

  return { openExport: open, closeExport: close };
});
