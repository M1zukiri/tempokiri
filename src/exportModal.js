/**
 * exportModal.js — 「导出」参数窗口（三 Tab：视频 / 音频 / Majdata）。
 *
 * 创建时间：2026-08-13 22:21:17（三 Tab 重构：2026-08-13）
 *
 * 结构：
 *   - 顶部 Tab 栏切换 视频导出 / 音频导出 / Majdata导出 三个面板；
 *   - 音频面板：格式（WAV/MP3）、位深、MP3 码率（档位+自定义双轨）、采样率、
 *     峰值响度归一化（开关+目标）、交叉淡化、文件名；
 *   - 视频面板：视频码率（档位+自定义）、帧率、分辨率、AAC 码率、交叉淡化、文件名；
 *   - Majdata 面板：bg.mp4 码率、track.mp3 码率、归一化、交叉淡化；固定输出
 *     bg.mp4（无声，上限 1080P 60fps）+ track.mp3（44100Hz），无文件名字段；
 *     纯音频源时隐藏 bg 码率字段，仅导出 track.mp3。
 *
 * 交互规则：
 *   - 码率「档位+数字框」双轨：选档填值；手输合法 → 切「自定义」；越界标红、
 *     blur 回填档位值；
 *   - 交叉淡化预填全局高级设置 crossfadeMs（MC.loadGlobalSettings，store.js
 *     铺平挂载到 MC 顶层，无 MC.store）；
 *   - 「导出」按当前激活 Tab 组装 opts 回调 onExport。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  // 分辨率档位 → 输出宽/高上限（null = 不缩放；等比缩放仅降不升）
  const RESOLUTION_PRESETS = {
    orig: { maxWidth: null, maxHeight: null },
    '1080p': { maxWidth: 1920, maxHeight: 1080 },
    '720p': { maxWidth: 1280, maxHeight: 720 },
    '480p': { maxWidth: 854, maxHeight: 480 },
  };

  const BITRATE_PRESETS = {
    mp3: [96, 128, 160, 192, 256, 320],
    video: [2, 4, 6, 10],
  };

  function buildDom() {
    const overlay = document.createElement('div');
    overlay.id = 'exportOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="${T('export.aria')}">
        <h3>${T('export.title')}</h3>
        <div class="exp-tabs">
          <button type="button" class="exp-tab" data-tab="video">${T('export.tabVideo')}</button>
          <button type="button" class="exp-tab active" data-tab="audio">${T('export.tabAudio')}</button>
          <button type="button" class="exp-tab" data-tab="majdata">${T('export.tabMajdata')}</button>
        </div>

        <div class="exp-panel" data-panel="audio">
          <div class="modal-form">
            <label>${T('export.format')}
              <select id="aFormat">
                <option value="wav">${T('export.wav')}</option>
                <option value="mp3">${T('export.mp3')}</option>
              </select>
            </label>
            <label id="aBitDepthRow">${T('export.bitDepth')}
              <select id="aBitDepth">
                <option value="16">${T('export.depth16')}</option>
                <option value="24">${T('export.depth24')}</option>
                <option value="32">${T('export.depth32')}</option>
              </select>
            </label>
            <label id="aMp3Row" hidden>${T('export.mp3Bitrate')}
              <select id="aMp3BitrateSel">
                ${BITRATE_PRESETS.mp3.map((k) => '<option value="' + k + '"' + (k === 192 ? ' selected' : '') + '>' + k + ' ' + T('export.kbps') + '</option>').join('')}
                <option value="custom">${T('export.custom')}</option>
              </select>
              <input id="aMp3BitrateNum" type="number" min="8" max="320" step="8" value="192" aria-label="${T('export.mp3Bitrate')}" /> ${T('export.kbps')}
            </label>
            <label>${T('export.sampleRate')}
              <select id="aSampleRate">
                <option value="src">${T('export.followSource')}</option>
                <option value="44100">44100 Hz</option>
                <option value="48000">48000 Hz</option>
                <option value="22050">22050 Hz</option>
              </select>
            </label>
            <label class="exp-check">
              <input id="aNormalize" type="checkbox" /> ${T('export.normalize')}
            </label>
            <label id="aPeakRow" hidden>${T('export.peak')}
              <select id="aPeak">
                <option value="-0.5">-0.5 dBFS</option>
                <option value="-1" selected>-1 dBFS</option>
                <option value="-3">-3 dBFS</option>
              </select>
            </label>
            <label>${T('export.crossfade')}
              <input id="aCrossfade" type="number" min="0" max="1000" step="5" value="10" /> ms
            </label>
            <label>${T('export.fileName')}
              <input id="aName" type="text" />
            </label>
          </div>
        </div>

        <div class="exp-panel" data-panel="video" hidden>
          <div class="modal-form">
            <label>${T('export.videoBitrate')}
              <select id="vBitrateSel">
                ${BITRATE_PRESETS.video.map((m) => '<option value="' + m + '"' + (m === 6 ? ' selected' : '') + '>' + m + ' ' + T('export.mbps') + '</option>').join('')}
                <option value="custom">${T('export.custom')}</option>
              </select>
              <input id="vBitrateNum" type="number" min="0.5" max="50" step="0.5" value="6" aria-label="${T('export.videoBitrate')}" /> ${T('export.mbps')}
            </label>
            <label>${T('export.framerate')}
              <select id="vFramerate">
                <option value="src" selected>${T('export.followSource')}</option>
                <option value="24">24 ${T('export.fps')}</option>
                <option value="30">30 ${T('export.fps')}</option>
                <option value="60">60 ${T('export.fps')}</option>
              </select>
            </label>
            <label>${T('export.resolution')}
              <select id="vResolution">
                <option value="orig" selected>${T('export.orig')}</option>
                <option value="1080p">${T('export.res1080')}</option>
                <option value="720p">${T('export.res720')}</option>
                <option value="480p">${T('export.res480')}</option>
              </select>
            </label>
            <label>${T('export.aacBitrate')}
              <select id="vAudioBitrate">
                <option value="96">96 ${T('export.kbps')}</option>
                <option value="128" selected>128 ${T('export.kbps')}</option>
                <option value="192">192 ${T('export.kbps')}</option>
                <option value="256">256 ${T('export.kbps')}</option>
              </select>
            </label>
            <label>${T('export.crossfade')}
              <input id="vCrossfade" type="number" min="0" max="1000" step="5" value="10" /> ms
            </label>
            <label>${T('export.fileName')}
              <input id="vName" type="text" />
            </label>
          </div>
        </div>

        <div class="exp-panel" data-panel="majdata" hidden>
          <p id="mNote" class="modal-sub">${T('export.majNoteVideo')}</p>
          <div class="modal-form">
            <label id="mVideoRow">${T('export.majVideoBitrate')}
              <select id="mVideoBitrateSel">
                ${BITRATE_PRESETS.video.map((m) => '<option value="' + m + '"' + (m === 6 ? ' selected' : '') + '>' + m + ' ' + T('export.mbps') + '</option>').join('')}
                <option value="custom">${T('export.custom')}</option>
              </select>
              <input id="mVideoBitrateNum" type="number" min="0.5" max="50" step="0.5" value="6" aria-label="${T('export.majVideoBitrate')}" /> ${T('export.mbps')}
            </label>
            <label>${T('export.majMp3Bitrate')}
              <select id="mMp3Bitrate">
                <option value="160">160 ${T('export.kbps')}</option>
                <option value="192">192 ${T('export.kbps')}</option>
                <option value="320" selected>320 ${T('export.kbps')}</option>
              </select>
            </label>
            <label class="exp-check">
              <input id="mNormalize" type="checkbox" /> ${T('export.normalize')}
            </label>
            <label id="mPeakRow" hidden>${T('export.peak')}
              <select id="mPeak">
                <option value="-0.5">-0.5 dBFS</option>
                <option value="-1" selected>-1 dBFS</option>
                <option value="-3">-3 dBFS</option>
              </select>
            </label>
            <label>${T('export.crossfade')}
              <input id="mCrossfade" type="number" min="0" max="1000" step="5" value="10" /> ms
            </label>
          </div>
        </div>

        <div id="xStatus" class="modal-status" hidden></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button id="xCancel" class="btn">${T('export.cancel')}</button>
          <button id="xOk" class="btn btn-primary">${T('export.ok')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Tab 栏与行内布局样式（自包含）
    const style = document.createElement('style');
    style.textContent =
      '.exp-tabs{display:flex;gap:8px;margin-bottom:14px}' +
      '.exp-tab{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--panel-2);color:var(--text-dim);cursor:pointer;font-size:13px}' +
      '.exp-tab.active{color:var(--accent);border-color:var(--accent)}' +
      '.exp-tab:disabled{opacity:.4;cursor:not-allowed}' +
      '.exp-check{flex-direction:row !important;gap:6px !important;cursor:pointer}';
    document.head.appendChild(style);
    return overlay;
  }

  let overlay = null;
  let exportCb = null;

  function el(id) {
    return overlay.querySelector('#' + id);
  }

  function currentTab() {
    const t = overlay.querySelector('.exp-tab.active');
    return t ? t.dataset.tab : 'audio';
  }

  function switchTab(name) {
    overlay.querySelectorAll('.exp-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    overlay.querySelectorAll('.exp-panel').forEach((p) => (p.hidden = p.dataset.panel !== name));
  }

  /** 码率双轨：档位 select ↔ 数字框。档位填值；手输合法切「自定义」；越界标红、blur 回填。 */
  function bindDualTrack(selId, numId, min, max, fallback) {
    const sel = el(selId);
    const num = el(numId);
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') return;
      num.value = sel.value;
      num.classList.remove('invalid');
    });
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      const ok = isFinite(v) && v >= min && v <= max;
      num.classList.toggle('invalid', !ok);
      if (ok) sel.value = 'custom';
    });
    num.addEventListener('blur', () => {
      if (num.classList.contains('invalid')) {
        num.value = sel.value === 'custom' ? String(fallback) : sel.value;
        num.classList.remove('invalid');
      }
    });
  }

  /** 读取码率：数字框合法取数字框，否则取档位值（custom 且非法回退 fallback）。 */
  function readBitrate(sel, num, min, max, fallback) {
    const v = parseFloat(num.value);
    if (isFinite(v) && v >= min && v <= max) return v;
    return sel.value === 'custom' ? fallback : parseFloat(sel.value);
  }

  /**
   * 打开导出窗口。
   * @param {object} opts {baseName, kind:'audio'|'video', canVideo:boolean}
   * @param {object} callbacks {onExport}
   */
  function open(opts, callbacks) {
    if (!overlay) overlay = buildDom();
    exportCb = callbacks.onExport || null;
    // 交叉淡化预填全局高级设置（store.js 铺平挂载到 MC 顶层）
    const g = MC.loadGlobalSettings() || { crossfadeMs: 30 };
    el('aCrossfade').value = String(g.crossfadeMs);
    el('vCrossfade').value = String(g.crossfadeMs);
    el('mCrossfade').value = String(g.crossfadeMs);
    el('aName').value = opts.baseName || 'remix';
    el('vName').value = opts.baseName || 'remix';
    // Tab 可用性：视频 Tab 仅视频源 + WebCodecs
    const canVideoTab = opts.kind === 'video' && !!opts.canVideo;
    overlay.querySelector('.exp-tab[data-tab="video"]').disabled = !canVideoTab;
    // Majdata：纯音频源隐藏 bg.mp4 码率并提示
    const isAudioOnly = opts.kind !== 'video';
    el('mVideoRow').hidden = isAudioOnly;
    el('mNote').textContent = isAudioOnly
      ? T('export.majNoteAudio')
      : T('export.majNoteVideo');
    // 默认 Tab：视频源可导出视频时进视频 Tab，否则音频 Tab
    switchTab(canVideoTab ? 'video' : 'audio');
    el('xStatus').hidden = true;
    overlay.hidden = false;
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function updateAudioVisibility() {
    const isMp3 = el('aFormat').value === 'mp3';
    el('aBitDepthRow').hidden = isMp3;
    el('aMp3Row').hidden = !isMp3;
    el('aPeakRow').hidden = !el('aNormalize').checked;
  }

  function init() {
    if (!overlay) overlay = buildDom();
    overlay.querySelectorAll('.exp-tab').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
    el('aFormat').addEventListener('change', updateAudioVisibility);
    el('aNormalize').addEventListener('change', updateAudioVisibility);
    el('mNormalize').addEventListener('change', () => {
      el('mPeakRow').hidden = !el('mNormalize').checked;
    });
    bindDualTrack('aMp3BitrateSel', 'aMp3BitrateNum', 8, 320, 192);
    bindDualTrack('vBitrateSel', 'vBitrateNum', 0.5, 50, 6);
    bindDualTrack('mVideoBitrateSel', 'mVideoBitrateNum', 0.5, 50, 6);
    el('xCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    el('xOk').addEventListener('click', () => {
      if (!exportCb) return;
      const tab = currentTab();
      if (tab === 'audio' || tab === 'video') {
        const name = el(tab === 'audio' ? 'aName' : 'vName').value.trim();
        if (!name) {
          el('xStatus').hidden = false;
          el('xStatus').textContent = T('export.statusEmptyName');
          return;
        }
      }
      const crossfadeMs = Math.max(0, parseInt(el(tab === 'audio' ? 'aCrossfade' : tab === 'video' ? 'vCrossfade' : 'mCrossfade').value, 10) || 0);
      if (tab === 'audio') {
        exportCb({
          tab: 'audio',
          format: el('aFormat').value,
          bitDepth: parseInt(el('aBitDepth').value, 10),
          mp3Bitrate: readBitrate(el('aMp3BitrateSel'), el('aMp3BitrateNum'), 8, 320, 192),
          sampleRate: el('aSampleRate').value,
          normalize: el('aNormalize').checked,
          peakDb: parseFloat(el('aPeak').value),
          crossfadeMs,
          fileName: el('aName').value.trim(),
        });
      } else if (tab === 'video') {
        const res = RESOLUTION_PRESETS[el('vResolution').value] || RESOLUTION_PRESETS.orig;
        exportCb({
          tab: 'video',
          videoBitrate: Math.round(readBitrate(el('vBitrateSel'), el('vBitrateNum'), 0.5, 50, 6) * 1e6),
          framerate: el('vFramerate').value === 'src' ? null : parseInt(el('vFramerate').value, 10),
          maxWidth: res.maxWidth,
          maxHeight: res.maxHeight,
          audioBitrate: parseInt(el('vAudioBitrate').value, 10) * 1000,
          crossfadeMs,
          fileName: el('vName').value.trim(),
        });
      } else {
        exportCb({
          tab: 'majdata',
          videoBitrate: Math.round(readBitrate(el('mVideoBitrateSel'), el('mVideoBitrateNum'), 0.5, 50, 6) * 1e6),
          mp3Bitrate: parseInt(el('mMp3Bitrate').value, 10),
          normalize: el('mNormalize').checked,
          peakDb: parseFloat(el('mPeak').value),
          crossfadeMs,
        });
      }
      close();
    });
  }

  init();

  return { openExport: open, closeExport: close };
});
