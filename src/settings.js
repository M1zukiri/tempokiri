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
      label: '界面主题',
      desc: '全局配色方案，切换即时生效',
      control: 'select',
      presets: [
        { label: '暗夜青蓝', value: 'aurora' },
        { label: '幽夜霓紫', value: 'nebula' },
        { label: '纸墨贝色', value: 'paper' },
      ],
      help: { effect: '切换整站配色（含波形）并即时保存', range: '三选一', recommend: '暗夜青蓝' },
    },
    {
      key: 'hop',
      label: '检测精度',
      desc: '帧移（相邻分析窗步进），越小节拍定位越精细、分析越慢',
      control: 'select+number',
      presets: [
        { label: '快速', value: 1024 },
        { label: '标准', value: 512 },
        { label: '高精度', value: 256 },
      ],
      number: { min: 3, max: 93, step: 0.1, unit: '毫秒', toStore: msToHop, fromStore: hopToMs },
      help: { effect: '帧移（相邻分析窗步进）越小节拍定位越精细但分析越慢', range: '3–93 毫秒（对应 FFT 帧移 64–2048 采样点）', recommend: '23 毫秒（标准）' },
    },
    {
      key: 'sensitivity',
      label: '识别灵敏度',
      desc: '数值越大越宽松，检出更多节拍候选',
      control: 'slider+number',
      number: { min: 0, max: 1, step: 0.01, unit: '' },
      help: { effect: '数值越大越宽松，检出更多节拍候选', range: '0–1', recommend: '0.9' },
    },
    {
      key: 'minBpm',
      label: 'BPM 范围（最小）',
      desc: '自动识别 BPM 搜索区间的下限',
      control: 'number',
      number: { min: 1, max: 600, step: 1, unit: 'BPM' },
      help: { effect: '自动识别 BPM 搜索区间，区间外真拍被忽略', range: '1–600（且最小 ≤ 最大）', recommend: '60' },
    },
    {
      key: 'maxBpm',
      label: 'BPM 范围（最大）',
      desc: '自动识别 BPM 搜索区间的上限',
      control: 'number',
      number: { min: 1, max: 600, step: 1, unit: 'BPM' },
      help: { effect: '自动识别 BPM 搜索区间，区间外真拍被忽略', range: '1–600（且最大 ≥ 最小）', recommend: '200' },
    },
    {
      key: 'videoExtract',
      label: '音轨提取方式',
      desc: '视频音轨的提取方案',
      control: 'select',
      presets: [
        { label: '自动（优先 WebCodecs，失败降级）', value: 'auto' },
        { label: '仅 WebCodecs（失败即报错）', value: 'webcodecs' },
        { label: '仅实时采集', value: 'capture' },
      ],
      help: { effect: '视频音轨提取方案；WebCodecs 快而准，实时采集兼容性更好', range: '三选一', recommend: '自动' },
    },
    {
      key: 'captureRate',
      label: '采集倍速',
      desc: '实时采集时静音快放的倍速',
      control: 'select+number',
      presets: [
        { label: '2x', value: 2 },
        { label: '4x', value: 4 },
        { label: '8x', value: 8 },
      ],
      number: { min: 1, max: 16, step: 1, unit: '倍' },
      help: { effect: '实时采集静音快放倍速，越高提取越快，极速可能丢帧', range: '1–16', recommend: '4' },
    },
    {
      key: 'followMs',
      label: '视频跟随间隔',
      desc: '拼接播放时视频画面跟随音频的最小间隔',
      control: 'select+number',
      presets: [
        { label: '流畅', value: 90 },
        { label: '均衡', value: 160 },
        { label: '省电', value: 250 },
      ],
      number: { min: 1, max: 5000, step: 10, unit: '毫秒' },
      help: { effect: '拼接播放时视频跟随音频 seek 的最小间隔，越小越跟手、越大越省电', range: '1–5000 毫秒', recommend: '90（流畅）' },
    },
    {
      key: 'renderScale',
      label: '渲染质量',
      desc: '波形渲染的设备像素比缩放系数',
      control: 'select+number',
      presets: [
        { label: '高（原分辨率）', value: 1.0 },
        { label: '中', value: 0.75 },
        { label: '低', value: 0.5 },
      ],
      number: { min: 0.1, max: 4, step: 0.05, unit: '' },
      help: { effect: '波形渲染 DPR 缩放系数，越小越流畅（略糊）、越大越清晰（更耗性能）', range: '0.1–4', recommend: '1.0（高）' },
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
      '<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="高级设置">' +
      '<h3>高级设置</h3>' +
      '<p class="modal-sub">参数改动即时生效并保存。鼠标聚焦任意输入框可查看作用与合法范围。</p>' +
      '<div class="as-form">' +
      FIELD_DEFS.map((f) => {
        const id = 'as-' + f.key;
        const ctrl =
          f.control === 'select+number'
            ? '<select id="' + id + '-sel">' +
              f.presets.map((p) => '<option value="' + p.value + '">' + p.label + '</option>').join('') +
              '<option value="custom">自定义</option></select>' +
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
      '<button id="asReset" class="btn">恢复默认</button>' +
      '<button id="asClose" class="btn btn-primary">关闭</button>' +
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
      '.as-desc{font-size:12px;color:#999}' +
      '.as-ctrl{display:flex;align-items:center;gap:8px;position:relative}' +
      '.as-ctrl select{max-width:230px}' +
      '.as-ctrl input[type=number]{width:110px}' +
      '.as-ctrl input[type=range]{width:110px}' +
      '.as-ctrl input.invalid{border-color:#e05555;background:rgba(224,85,85,.12)}' +
      '.help-pop{position:fixed;width:300px;max-width:calc(100vw - 16px);z-index:1000;background:#1e1e24;border:1px solid #444;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.5)}' +
      '.help-pop b{display:block;color:#ddd;font-weight:600}';
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
            showHelp(num, '<b>超出合法范围</b>' + f.help.range);
            return;
          }
          hideHelp();
          if (sel) sel.value = 'custom';
          if (slider) slider.value = String(v);
          saveField(f, st);
        });
        num.addEventListener('focus', () => {
          showHelp(num, '<b>作用</b>' + f.help.effect + '<b>范围</b>' + f.help.range + '<b>推荐</b>' + f.help.recommend);
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

  return {
    openAdvanced,
    DEFAULT_VALUES,
    FIELD_DEFS,
    msToHop,
    hopToMs,
    sensitivityToDelta,
    validateField,
  };
});
