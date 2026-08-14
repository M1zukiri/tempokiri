/**
 * settings.js — 「高级设置」弹窗（性能 / 音效 / 解码参数）。
 *
 * 创建时间：2026-08-13 22:21:17
 *
 * 交互规则：
 *   - 所有「分立式」设置项为「预设档位 + 数字输入框」双轨：
 *     选档 → 数字框填入预设值并保存；手输（合法）→ 档位切到「自定义」并保存；
 *     越界 → 输入框标红（.invalid），不保存，失焦恢复上次合法值；
 *   - 数字框聚焦显示帮助气泡（作用 / 合法范围 / 推荐值），失焦或 Esc 隐藏；
 *   - 每次合法改动即时保存到 localStorage（tempokiri.remix.global.v1）并派发
 *     'tempokiri:settings-changed' 事件，供 main.js 刷新运行时参数；
 *   - 「恢复默认」重置全部键；「关闭」仅隐藏弹窗。
 *
 * 纯函数（msToHop / hopToMs / sensitivityToDelta / validateField / FIELD_DEFS /
 * DEFAULT_VALUES）不访问 MC，可在 Node 下直接单测；只有 openAdvanced 在
 * 浏览器运行时惰性访问 MC.loadGlobalSettings / MC.saveGlobalSettings。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.settings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function hopToMs(hop) { return hop / 22.05; }
  function msToHop(ms) { return clamp(Math.round(ms * 22.05), 64, 2048); }

  // —— 纯函数：灵敏度（0..1，越大越宽松）-> 识别 delta 阈值 ——
  function sensitivityToDelta(s) { return 1.6 - 0.9 * clamp(s, 0, 1); }

  // —— 默认值常量（与 store.js DEFAULT_GLOBAL 的 10 个键完全一致）——
  const DEFAULT_VALUES = {
    crossfadeMs: 30,
    sensitivity: 0.9,
    minBpm: 60,
    maxBpm: 200,
    hop: 512,
    videoExtract: 'auto',
    captureRate: 4,
    followMs: 90,
    renderScale: 1.0,
    theme: 'aurora',
  };

  // —— 7 项设置元数据（help 文案即弹窗气泡逐字内容）——
  // control: 'select+number' 档位+数字框 | 'slider+number' 滑杆+数字框
  //          | 'select' 枚举下拉（无数字框）| 'number' 纯数字框
  // number.toStore / number.fromStore：数字框值与 store 值的换算（hop 项
  // 数字框显示毫秒、store 存采样点；其余项无换算，省略两键）
  const FIELD_DEFS = [
    {
      key: 'theme',
      label: T('settings.theme.label'),
      desc: T('settings.theme.desc'),
      control: 'select',
      presets: [
        { label: T('settings.theme.presets.aurora'), value: 'aurora' },
        { label: T('settings.theme.presets.nebula'), value: 'nebula' },
        { label: T('settings.theme.presets.paper'), value: 'paper' },
      ],
      help: { range: T('settings.theme.helpRange'), recommend: T('settings.theme.helpRecommend') },
    },
    {
      key: 'hop',
      label: T('settings.hop.label'),
      desc: T('settings.hop.desc'),
      control: 'select+number',
      presets: [
        { label: T('settings.hop.presets.1024'), value: 1024 },
        { label: T('settings.hop.presets.512'), value: 512 },
        { label: T('settings.hop.presets.256'), value: 256 },
      ],
      number: { min: 3, max: 93, step: 0.1, unit: T('settings.hop.unit'), toStore: msToHop, fromStore: hopToMs },
      help: { range: T('settings.hop.helpRange'), recommend: T('settings.hop.helpRecommend') },
    },
    {
      key: 'sensitivity',
      label: T('settings.sensitivity.label'),
      desc: T('settings.sensitivity.desc'),
      control: 'slider+number',
      number: { min: 0, max: 1, step: 0.01, unit: '' },
      help: { range: T('settings.sensitivity.helpRange'), recommend: T('settings.sensitivity.helpRecommend') },
    },
    {
      key: 'minBpm',
      label: T('settings.minBpm.label'),
      desc: T('settings.minBpm.desc'),
      control: 'number',
      number: { min: 1, max: 600, step: 1, unit: T('settings.minBpm.unit') },
      help: { range: T('settings.minBpm.helpRange'), recommend: T('settings.minBpm.helpRecommend') },
    },
    {
      key: 'maxBpm',
      label: T('settings.maxBpm.label'),
      desc: T('settings.maxBpm.desc'),
      control: 'number',
      number: { min: 1, max: 600, step: 1, unit: T('settings.maxBpm.unit') },
      help: { range: T('settings.maxBpm.helpRange'), recommend: T('settings.maxBpm.helpRecommend') },
    },
    {
      key: 'videoExtract',
      label: T('settings.videoExtract.label'),
      desc: T('settings.videoExtract.desc'),
      control: 'select',
      presets: [
        { label: T('settings.videoExtract.presets.auto'), value: 'auto' },
        { label: T('settings.videoExtract.presets.webcodecs'), value: 'webcodecs' },
        { label: T('settings.videoExtract.presets.capture'), value: 'capture' },
      ],
      help: { range: T('settings.videoExtract.helpRange'), recommend: T('settings.videoExtract.helpRecommend') },
    },
    {
      key: 'captureRate',
      label: T('settings.captureRate.label'),
      desc: T('settings.captureRate.desc'),
      control: 'select+number',
      presets: [
        { label: T('settings.captureRate.presets.2'), value: 2 },
        { label: T('settings.captureRate.presets.4'), value: 4 },
        { label: T('settings.captureRate.presets.8'), value: 8 },
      ],
      number: { min: 1, max: 16, step: 1, unit: T('settings.captureRate.unit') },
      help: { range: T('settings.captureRate.helpRange'), recommend: T('settings.captureRate.helpRecommend') },
    },
    {
      key: 'followMs',
      label: T('settings.followMs.label'),
      desc: T('settings.followMs.desc'),
      control: 'select+number',
      presets: [
        { label: T('settings.followMs.presets.90'), value: 90 },
        { label: T('settings.followMs.presets.160'), value: 160 },
        { label: T('settings.followMs.presets.250'), value: 250 },
      ],
      number: { min: 1, max: 5000, step: 10, unit: T('settings.followMs.unit') },
      help: { range: T('settings.followMs.helpRange'), recommend: T('settings.followMs.helpRecommend') },
    },
    {
      key: 'renderScale',
      label: T('settings.renderScale.label'),
      desc: T('settings.renderScale.desc'),
      control: 'select+number',
      presets: [
        { label: T('settings.renderScale.presets.1'), value: 1.0 },
        { label: T('settings.renderScale.presets.0.75'), value: 0.75 },
        { label: T('settings.renderScale.presets.0.5'), value: 0.5 },
      ],
      number: { min: 0.1, max: 4, step: 0.05, unit: '' },
      help: { range: T('settings.renderScale.helpRange'), recommend: T('settings.renderScale.helpRecommend') },
    },
  ];

  // —— 纯函数：单项校验（min/maxBpm 的交叉校验在 UI 层做）——
  const RANGE = {
    hop: [64, 2048],
    sensitivity: [0, 1],
    minBpm: [1, 600],
    maxBpm: [1, 600],
    captureRate: [1, 16],
    followMs: [1, 5000],
    renderScale: [0.1, 4],
  };
  const EXTRACT_SET = { auto: 1, webcodecs: 1, capture: 1, aurora: 1, nebula: 1, paper: 1 };

  function validateField(key, value) {
    if (key === 'videoExtract' || key === 'theme') return !!EXTRACT_SET[value];
    const r = RANGE[key];
    if (!r || typeof value !== 'number' || !isFinite(value)) return false;
    if (key === 'hop') return Number.isInteger(value) && value >= r[0] && value <= r[1];
    return value >= r[0] && value <= r[1];
  }

  // —— UI 部分（仅浏览器运行时使用）——
  let overlay = null;
  let helpPop = null; // 单例帮助气泡（挂 body，fixed 定位，避免被 .as-form 滚动容器裁剪）
  let helpAnchor = null; // 当前气泡锚定的输入框

  /** 显示帮助气泡并定位在锚点输入框旁（下方优先，空间不足翻转到上方）。 */
  function showHelp(anchor, html) {
    if (!helpPop) return;
    helpPop.innerHTML = html;
    helpPop.hidden = false;
    helpAnchor = anchor;
    positionHelp(anchor);
  }

  function hideHelp() {
    helpAnchor = null;
    if (helpPop) helpPop.hidden = true;
  }

  function positionHelp(anchor) {
    const r = anchor.getBoundingClientRect();
    const popW = Math.min(300, window.innerWidth - 16);
    const popH = helpPop.offsetHeight || 120;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8));
    let top;
    if (window.innerHeight - r.bottom >= popH + 10) top = r.bottom + 8;
    else if (r.top >= popH + 10) top = r.top - popH - 8;
    else top = 8;
    helpPop.style.left = left + 'px';
    helpPop.style.top = top + 'px';
  }

  function buildDom() {
    overlay = document.createElement('div');
    overlay.id = 'asOverlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="' + T('settings.aria') + '">' +
      '<h3>' + T('settings.title') + '</h3>' +
      '<p class="modal-sub">' + T('settings.sub') + '</p>' +
      '<div class="as-form">' +
      FIELD_DEFS.map((f) => {
        const id = 'as-' + f.key;
        const ctrl =
          f.control === 'select+number'
            ? '<select id="' + id + '-sel">' +
              f.presets.map((p) => '<option value="' + p.value + '">' + p.label + '</option>').join('') +
              '<option value="custom">' + T('settings.custom') + '</option></select>' +
              numField(f, id)
            : f.control === 'select'
              ? '<select id="' + id + '-sel">' +
                f.presets.map((p) => '<option value="' + p.value + '">' + p.label + '</option>').join('') +
                '</select>'
              : f.control === 'slider+number'
                ? '<input id="' + id + '-slider" type="range" min="' + f.number.min + '" max="' + f.number.max + '" step="' + f.number.step + '">' +
                  numField(f, id)
                : numField(f, id);
        return (
          '<div class="as-row" data-key="' + f.key + '">' +
          '<div class="as-head"><span class="as-label">' + f.label + '</span>' +
          '<span class="as-desc">' + f.desc + '</span></div>' +
          '<div class="as-ctrl">' + ctrl + '</div>' +
          '</div>'
        );
      }).join('') +
      '</div>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      '<button id="asReset" class="btn">' + T('settings.reset') + '</button>' +
      '<button id="asClose" class="btn btn-primary">' + T('settings.close') + '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // 弹窗自身样式（自包含，避免侵入 index.html 的 style 块）
    const style = document.createElement('style');
    style.textContent =
      '.as-form{display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto;padding:2px}' +
      '.as-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid rgba(128,128,128,.25);border-radius:8px}' +
      '.as-head{display:flex;flex-direction:column;gap:2px;min-width:0}' +
      '.as-label{font-weight:600}' +
      '.as-desc{font-size:12px;color:var(--text-dim)}' +
      '.as-ctrl{display:flex;align-items:center;gap:8px;position:relative}' +
      '.as-ctrl select{max-width:230px}' +
      '.as-ctrl input[type=number]{width:110px}' +
      '.as-ctrl input[type=range]{width:110px}' +
      '.as-ctrl input.invalid{border-color:#e05555;background:rgba(224,85,85,.12)}' +
      '.help-pop{position:fixed;width:300px;max-width:calc(100vw - 16px);z-index:1000;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.5)}' +
      '.help-pop b{display:block;color:var(--text);font-weight:600}';
    document.head.appendChild(style);

    // 单例气泡挂到 body（overlay 之后，天然盖在弹窗上层）
    helpPop = document.createElement('div');
    helpPop.className = 'help-pop';
    helpPop.hidden = true;
    document.body.appendChild(helpPop);
    // 表单滚动时气泡保持贴住聚焦的输入框
    overlay.querySelector('.as-form').addEventListener('scroll', () => {
      if (helpAnchor && !helpPop.hidden) positionHelp(helpAnchor);
    });

    // 交互绑定
    FIELD_DEFS.forEach((f) => {
      const row = overlay.querySelector('.as-row[data-key="' + f.key + '"]');
      const num = row.querySelector('input[type=number]');
      const sel = row.querySelector('select');
      const slider = row.querySelector('input[type=range]');

      // 档位 -> 数字框（hop 项换算为毫秒显示）
      if (sel) {
        sel.addEventListener('change', () => {
          if (sel.value === 'custom') return;
          // 数字档位 parseFloat；字符串枚举（videoExtract）直接用原值
          const v = f.number ? parseFloat(sel.value) : sel.value;
          if (f.number) {
            num.value = roundNum(f.number.fromStore ? f.number.fromStore(v) : v);
            num.classList.remove('invalid');
          }
          saveField(f, v);
        });
      }
      // 数字框（手动输入）-> 自定义档 + 保存；越界标红不保存
      if (num) {
        num.addEventListener('input', () => {
          const v = parseFloat(num.value);
          const st = f.number && f.number.toStore ? f.number.toStore(v) : v;
          const ok = isFinite(v) && validateField(f.key, st) && crossOk(f, v);
          num.classList.toggle('invalid', !ok);
          if (!ok) {
            showHelp(num, '<b>' + T('settings.helpInvalid') + '</b>' + f.help.range);
            return;
          }
          hideHelp();
          if (sel) sel.value = 'custom';
          if (slider) slider.value = String(v);
          saveField(f, st);
        });
        num.addEventListener('focus', () => {
          showHelp(num, '<b>' + T('settings.helpRange') + '</b>' + f.help.range + '<b>' + T('settings.helpRecommend') + '</b>' + f.help.recommend);
        });
        num.addEventListener('blur', () => {
          hideHelp();
          // 越界/空值时回填上次合法值
          if (num.classList.contains('invalid')) {
            const cur = MC.loadGlobalSettings();
            const v = cur[f.key];
            num.value = roundNum(f.number && f.number.fromStore ? f.number.fromStore(v) : v);
            num.classList.remove('invalid');
          }
        });
        num.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            hideHelp();
            num.blur();
          }
        });
      }
      // 滑杆 -> 数字框 + 保存
      if (slider) {
        slider.addEventListener('input', () => {
          const v = parseFloat(slider.value);
          num.value = roundNum(v);
          num.classList.remove('invalid');
          saveField(f, v);
        });
      }
    });

    overlay.querySelector('#asReset').addEventListener('click', () => {
      MC.saveGlobalSettings(DEFAULT_VALUES);
      refreshAll();
      dispatchChanged();
    });
    overlay.querySelector('#asClose').addEventListener('click', () => {
      overlay.hidden = true;
    });
  }

  function numField(f, id) {
    const n = f.number;
    return '<input id="' + id + '-num" type="number" min="' + n.min + '" max="' + n.max + '" step="' + n.step + '"' +
      (n.unit ? ' aria-label="' + f.label + '（' + n.unit + '）"' : ' aria-label="' + f.label + '"') + ' />';
  }


  function roundNum(v) {
    return Math.round(v * 1000) / 1000;
  }

  /** BPM 交叉校验：min ≤ max（改 min 时看 max 控件，改 max 时看 min 控件）。 */
  function crossOk(f, v) {
    if (f.key !== 'minBpm' && f.key !== 'maxBpm') return true;
    const other = overlay.querySelector('.as-row[data-key="' + (f.key === 'minBpm' ? 'maxBpm' : 'minBpm') + '"] input[type=number]');
    const ov = parseFloat(other.value);
    return f.key === 'minBpm' ? v <= ov : v >= ov;
  }

  /** 派发设置变更事件（main.js 监听后刷新运行时参数）。 */
  function dispatchChanged() {
    document.dispatchEvent(new CustomEvent('tempokiri:settings-changed'));
  }

  function saveField(f, storeValue) {
    if (typeof storeValue === 'number' && !isFinite(storeValue)) return; // 防御：NaN 不落盘
    MC.saveGlobalSettings({ [f.key]: storeValue });
    dispatchChanged();
  }
  /** 以当前 store 值刷新全部控件（打开弹窗 / 恢复默认时调用）。 */
  function refreshAll() {
    const gs = MC.loadGlobalSettings();
    FIELD_DEFS.forEach((f) => {
      const row = overlay.querySelector('.as-row[data-key="' + f.key + '"]');
      const sel = row.querySelector('select');
      const num = row.querySelector('input[type=number]');
      const slider = row.querySelector('input[type=range]');
      const raw = gs[f.key];
      const v = f.number && f.number.fromStore ? f.number.fromStore(raw) : raw;
      if (sel) {
        const matched = f.presets.some((p) => p.value === raw);
        sel.value = matched ? String(raw) : 'custom';
      }
      if (num) {
        num.value = roundNum(v);
        num.classList.remove('invalid');
      }
      if (slider) slider.value = String(v);
    });
  }

  /** 打开高级设置弹窗（页脚入口调用）。 */
  function openAdvanced() {
    if (!overlay) buildDom();
    refreshAll();
    overlay.hidden = false;
  }

  /** 关闭高级设置弹窗（Esc 快捷键入口调用）。 */
  function closeAdvanced() {
    if (overlay) overlay.hidden = true;
  }

  return {
    openAdvanced,
    closeAdvanced,
    DEFAULT_VALUES,
    FIELD_DEFS,
    msToHop,
    hopToMs,
    sensitivityToDelta,
    validateField,
  };
});
