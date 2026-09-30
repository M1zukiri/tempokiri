// 创建时间：2026-08-26 18:05:00
/**
 * rangeInput.js — 段落起止点双语义输入组件：小节/格 ↔ 时间起止点（二选一）。
 *
 * 语义（与用户确认）：
 *   - radio 选中一行为「可编辑」语义（底层记录），另一行只读显示派生换算值（随动）；
 *   - 切换选中时，被选中行「直接应用当前的缓存值」（另一语义当前的派生显示值）；
 *   - 换算方向单一（选中的语义 → 派生显示），无 time↔小节往返数值误差。
 *
 * 用法：
 *   const c = MC.rangeInput.create(host, {
 *     getGrid: () => grid,
 *     value: it,                              // 序列项（按 item.mode 取底层值）
 *     onChange: (spec) => {},                 // spec = { mode, bars, time }（全量，两路皆携带）
 *   });
 *   c.setValue(item); c.refresh(); c.getSpec();
 *
 * spec 结构：
 *   { mode: 'bars'|'time',
 *     bars: { startBar, startCell, endBar, endCell } | null,
 *     time: { startSec, endSec } | null }
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.rangeInput = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  function seq() {
    if (typeof module === 'object' && module.exports) return require('./sequence.js');
    return (typeof self !== 'undefined' ? self : globalThis).MC;
  }

  let uid = 0; // radio name 防冲突

  /**
   * @param {HTMLElement} container
   * @param {object} opts { getGrid, value(item), onChange(spec) }
   */
  function create(container, opts) {
    const name = 'ri' + (++uid);
    let mode = 'bars'; // 当前选中（底层记录）语义
    let bars = null;   // { startBar, startCell, endBar, endCell }
    let time = null;   // { startSec, endSec }
    let onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    const root = document.createElement('span');
    root.className = 'range-input';

    function grid() {
      return typeof opts.getGrid === 'function' ? opts.getGrid() : null;
    }
    /** 以当前选中语义为基准重算派生值（sequence.rangeSpecSync 纯函数，与主数据层同一换算）。 */
    function derive(spec) {
      return seq().rangeSpecSync(spec, grid());
    }
    /** bars 语义 → 派生时间（单向；无效返回 null）。 */
    function barsToTime(bv) {
      return derive({ mode: 'bars', bars: bv }).time;
    }
    /** time 语义 → 派生小节/格（单向）。 */
    function timeToBars(tv) {
      return derive({ mode: 'time', time: tv }).bars;
    }

    /** 秒 → 可读时标文本（m:ss.s）。 */
    function fmtT(sec) {
      if (!Number.isFinite(sec)) return '—';
      const neg = sec < 0 ? '-' : '';
      const a = Math.abs(sec);
      const m = Math.floor(a / 60);
      const s = a - m * 60;
      return neg + m + ':' + (s < 10 ? '0' : '') + (+s.toFixed(1));
    }

    /** 以当前选中语义为基准重算派生值并重绘（选中行=可编辑输入，未选中行=只读文本显示）。 */
    function refreshViews() {
      if (mode === 'bars' && bars) {
        time = barsToTime(bars);
      } else if (mode === 'time' && time) {
        bars = timeToBars(time);
      }
      const isBars = mode === 'bars';
      const barsBlock = root.querySelector('.ri-block-bars');
      const timeBlock = root.querySelector('.ri-block-time');
      barsBlock.classList.toggle('ri-active', isBars);
      timeBlock.classList.toggle('ri-active', !isBars);
      const sb = root.querySelector('.ri-sb'), sc = root.querySelector('.ri-sc');
      const eb = root.querySelector('.ri-eb'), ec = root.querySelector('.ri-ec');
      const ts = root.querySelector('.ri-ts'), te = root.querySelector('.ri-te');
      if (bars) {
        sb.value = String(bars.startBar); sc.value = String(bars.startCell);
        eb.value = String(bars.endBar); ec.value = String(bars.endCell);
      } else {
        sb.value = sc.value = eb.value = ec.value = '';
      }
      if (time) {
        ts.value = String(+time.startSec.toFixed(3)); te.value = String(+time.endSec.toFixed(3));
      } else {
        ts.value = te.value = '';
      }
      root.querySelector('.ri-ref-bars').textContent = bars
        ? bars.startBar + T('seq.unitBar') + (bars.startCell || 1) + T('seq.unitCell') + ' – ' + bars.endBar + T('seq.unitBar') + (bars.endCell || 1) + T('seq.unitCell')
        : '—';
      root.querySelector('.ri-ref-time').textContent = time
        ? fmtT(time.startSec) + ' – ' + fmtT(time.endSec)
        : '—';
    }

    function emit() {
      if (onChange) onChange({ mode, bars: mode === 'bars' ? bars : null, time: mode === 'time' ? time : null });
    }

    /** 读编辑行输入 → 更新语义 → 重算派生 → emit。 */
    function commit() {
      if (mode === 'bars') {
        const sb = parseFloat(root.querySelector('.ri-sb').value);
        const sc = parseFloat(root.querySelector('.ri-sc').value);
        const eb = parseFloat(root.querySelector('.ri-eb').value);
        const ec = parseFloat(root.querySelector('.ri-ec').value);
        if (!(sb > 0 && eb >= sb && sc > 0 && ec > 0)) return refreshViews();
        const g = grid();
        // 无网格：允许输入（底层小节/格语义先存，派生显示 '—'；网格恢复后再换算）
        if (g && (sb > g.bars.length || eb > g.bars.length)) return refreshViews();
        bars = { startBar: sb, startCell: sc, endBar: eb, endCell: ec };
        refreshViews();
        emit();
      } else {
        const ts = parseFloat(root.querySelector('.ri-ts').value);
        const te = parseFloat(root.querySelector('.ri-te').value);
        // 负时间合法：网格起点可随负 offset 为负（与 sequence.timeToBarCell 同规约）
        if (!Number.isFinite(ts) || !Number.isFinite(te) || !(te > ts)) return refreshViews();
        time = { startSec: ts, endSec: te };
        refreshViews();
        emit();
      }
    }

    // DOM：两行块（radio 选中语义为可编辑输入；未选中块为只读文本）——
    // 小节/格行：起·小节/格 + 止·小节/格（分组微标签）；时间行：起/止（秒）
    const mkField = (cls, placeholder, min, step) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = min;
      i.step = step;
      i.className = 'ri-' + cls;
      i.placeholder = placeholder;
      i.addEventListener('change', commit);
      return i;
    };
    const lbl = (text) => {
      const s = document.createElement('span');
      s.className = 'ri-fld';
      s.textContent = text;
      return s;
    };
    const mkGroup = (host, childEls) => {
      const g = document.createElement('span');
      g.className = 'ri-fgroup';
      childEls.forEach((c) => g.appendChild(c));
      host.appendChild(g);
      return g;
    };
    const mkBlock = (val, label, onChangeRadio) => {
      const block = document.createElement('span');
      block.className = 'ri-block ri-block-' + val;
      const row = document.createElement('label');
      row.className = 'ri-row';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = val;
      radio.addEventListener('change', onChangeRadio);
      const lab = document.createElement('span');
      lab.textContent = label;
      row.appendChild(radio);
      row.appendChild(lab);
      block.appendChild(row);
      block.appendChild(document.createElement('span')).className = 'ri-fields';
      const ref = document.createElement('span');
      ref.className = 'ri-ref ri-ref-' + val;
      block.appendChild(ref);
      root.appendChild(block);
      return block;
    };

    // bars 块：起 小节[ ] 格[ ] · 止 小节[ ] 格[ ]（分组微标签）
    const barsBlock = mkBlock('bars', T('seq.unitBarsPair'), () => { mode = 'bars'; refreshViews(); emit(); });
    const barsFields = barsBlock.querySelector('.ri-fields');
    mkGroup(barsFields, [
      lbl('起'), lbl(T('seq.unitBar')), mkField('sb', '小节', 1, 1), lbl(T('seq.unitCell')), mkField('sc', '格', 1, 1),
      lbl('止'), lbl(T('seq.unitBar')), mkField('eb', '小节', 1, 1), lbl(T('seq.unitCell')), mkField('ec', '格', 1, 1),
    ]);

    // time 块：(时间起点|时间终点，秒)
    const timeBlock = mkBlock('time', T('seq.unitTimePair'), () => { mode = 'time'; refreshViews(); emit(); });
    const timeFields = timeBlock.querySelector('.ri-fields');
    mkGroup(timeFields, [
      lbl('起点'), mkField('ts', '秒', 0, 0.001),
      lbl('终点'), mkField('te', '秒', 0, 0.001),
    ]);

    /** 用序列项初始化（item.mode 决定选中语义；另一语义置派生显示）。 */
    function setValue(item) {
      if (!item) return;
      if (item.mode === 'time') {
        mode = 'time';
        time = { startSec: item.startTime || 0, endSec: item.endTime || 0 };
        bars = timeToBars(time) || bars;
      } else {
        mode = 'bars';
        bars = {
          startBar: item.startBar,
          startCell: item.startCell || 1,
          endBar: item.endBar,
          endCell: item.endCell || 1,
        };
        time = barsToTime(bars) || time;
      }
      const radios = root.querySelectorAll('input[type="radio"]');
      radios.forEach((r) => { r.checked = r.value === mode; });
      refreshViews();
    }

    container.appendChild(root);
    setValue(opts.value || {});
    return {
      el: root,
      getSpec: () => ({ mode, bars: mode === 'bars' ? bars : null, time: mode === 'time' ? time : null }),
      setValue,
      refresh: () => { refreshViews(); },
    };
  }

  return { create };
});
