// 创建时间：2026-08-26 (节拍器设置弹窗)
/**
 * metronomeModal.js — 「节拍器设置」弹窗（控制栏 ⚙ 入口）。
 *
 * 字段：音符单位（自动=按拍号分母 / 2 / 4 / 8 / 16 分音符）、音量（0-100%）、音色（click/beep/wood）。
 * 打开时 open(unit, volume, tone, seg, onSave) 预填当前值；「保存」回调 onSave 并关闭；
 * 默认音符单位选项旁提示当前拍号（如 4/4 → 4 分音符）。
 * Esc 由 main.js 统一处理（close()）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.metronomeModal = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  let overlay = null;
  let onSave = null;

  const UNIT_OPTIONS = [
    { value: 0, label: T('metronome.unitAuto') },
    { value: 2, label: '2' + T('metronome.unitSuffix') },
    { value: 4, label: '4' + T('metronome.unitSuffix') },
    { value: 8, label: '8' + T('metronome.unitSuffix') },
    { value: 16, label: '16' + T('metronome.unitSuffix') },
  ];
  const TONE_OPTIONS = [
    { value: 'click', label: T('metronome.toneClick') },
    { value: 'beep', label: T('metronome.toneBeep') },
    { value: 'wood', label: T('metronome.toneWood') },
  ];

  function el(id) {
    return overlay.querySelector('#' + id);
  }

  function buildDom() {
    overlay = document.createElement('div');
    overlay.id = 'mtrOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + T('metronome.aria') + '">' +
      '<h3>' + T('metronome.title') + '</h3>' +
      '<p class="modal-sub">' + T('metronome.sub') + '</p>' +
      '<div class="modal-form">' +
      '<label id="mtrUnitNote" class="mtr-note"></label>' +
      '<label>' + T('metronome.unitLabel') +
      '  <select id="mtrUnit">' +
      UNIT_OPTIONS.map((o) => '<option value="' + o.value + '">' + o.label + '</option>').join('') +
      '</select></label>' +
      '<label>' + T('metronome.volume') +
      '  <input id="mtrVol" type="range" min="0" max="200" step="1" />' +
      '  <span id="mtrVolVal" class="mtr-note"></span></label>' +
      '<label>' + T('metronome.tone') +
      '  <select id="mtrTone">' +
      TONE_OPTIONS.map((o) => '<option value="' + o.value + '">' + o.label + '</option>').join('') +
      '</select></label>' +
      '<label class="exp-check" title="' + T('metronome.seqDesc') + '">' +
      '<input id="mtrSeqPlay" type="checkbox" /> ' + T('metronome.seqLabel') + '</label>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      '<button id="mtrOk" class="btn btn-primary">' + T('metronome.apply') + '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#mtrVol').addEventListener('input', () => {
      el('mtrVolVal').textContent = el('mtrVol').value + '%';
    });
    el('mtrOk').addEventListener('click', () => {
      if (!onSave) return;
      onSave({
        unit: parseInt(el('mtrUnit').value, 10) || 0,
        volume: parseInt(el('mtrVol').value, 10) || 0,
        tone: el('mtrTone').value,
        seqOn: el('mtrSeqPlay').checked,
      });
      close();
    });
    return overlay;
  }

  /** 打开设置：unit/volume/tone/seqOn 预填；seg（网格首段）用于提示默认音符单位。 */
  function open(unit, volume, tone, seg, seqOn, saveCb) {
    if (!overlay) buildDom();
    onSave = saveCb || null;
    const uEl = el('mtrUnit');
    uEl.value = String(unit > 0 ? unit : 0);
    el('mtrVol').value = String(volume);
    el('mtrVolVal').textContent = volume + '%';
    el('mtrTone').value = tone && TONE_OPTIONS.some((o) => o.value === tone) ? tone : 'click';
    el('mtrSeqPlay').checked = seqOn !== false;
    // 默认音符单位提示：拍号分母（4/4→4 分音符，6/8→8 分音符）
    const beatUnit = (seg && seg.beatUnit > 0) ? seg.beatUnit : 4;
    el('mtrUnitNote').textContent = T('metronome.unitDefaultHint', { unit: beatUnit });
    overlay.hidden = false;
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  return { open, close };
});
