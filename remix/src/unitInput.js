/**
 * unitInput.js — 统一单位输入组件：小节/格 ↔ 时间 双模式切换。
 *
 * 核心设计（与用户确认）：位置/长度的小节/格与时间点二选一，
 * 编辑一套、另一套自动换算显示（只读参考），底层统一为秒。
 *
 * kind:
 *   'position' — 绝对位置（序列端点）。小节/格 = 第 x 小节第 x 格
 *                （格 = 网格线间区间，∈ [1, resolution]）。
 *   'length'   — 时长（段长度）。小节/格 = x 小节 + y 格（格 ∈ [0, resolution-1]）。
 *
 * 用法：
 *   const c = MC.UnitInput.create(el, {
 *     kind: 'position',
 *     getGrid: () => grid,          // position 换算
 *     getStep: () => ({ barDur, step }), // length 换算
 *     value: 1.5,                   // 初始值（秒）
 *     onChange: (sec) => {},        // 编辑回调；非法输入回调 null
 *   });
 *   c.setValue(sec); c.refresh();   // 外部值/网格变化后刷新
 *   c.mode();                       // 当前模式 'bars' | 'time'
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.UnitInput = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 惰性解析 sequence 模块（浏览器读铺平的 MC 命名空间）。 */
  function seq() {
    if (typeof module === 'object' && module.exports) return require('./sequence.js');
    return (typeof self !== 'undefined' ? self : globalThis).MC; // sequence.js 铺平到 MC
  }
  function cellBounds(kind, res) {
    return kind === 'length' ? [0, res - 1] : [1, res];
  }

  /**
   * @param {HTMLElement} container
   * @param {object} opts
   */
  function create(container, opts) {
    const kind = opts.kind === 'length' ? 'length' : 'position';
    // 位置组件的端点语义：'start' 取格区间起点，'end' 取格区间终点（包含终点格）
    const edge = opts.edge === 'end' ? 'end' : 'start';
    let mode = opts.mode === 'time' ? 'time' : 'bars';
    let value = Number.isFinite(opts.value) ? opts.value : NaN;
    let invalid = false;

    const el = document.createElement('span');
    el.className = 'unit-input unit-' + kind;

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'unit-mode-btn';
    modeBtn.textContent = mode === 'bars' ? '小节/格' : '时间';
    modeBtn.title = kind === 'length' ? '切换单位：小节/格 或 时间（秒）' : '切换单位：小节/格 或 时间点（秒）';

    const fields = document.createElement('span');
    fields.className = 'unit-fields';

    const refOut = document.createElement('span');
    refOut.className = 'unit-ref';

    /** 当前网格（position）。 */
    function grid() {
      return typeof opts.getGrid === 'function' ? opts.getGrid() : null;
    }
    /** 长度步长（length）。 */
    function step() {
      return typeof opts.getStep === 'function' ? opts.getStep() : null;
    }

    /** 将秒值格式化为只读参考文本。 */
    function refText(sec) {
      if (invalid) return '—';
      if (kind === 'length') {
        const st = step();
        if (mode === 'time' && st) {
          const bc = seq().durationToBarCell(sec, st.barDur, st.step);
          return bc.bars + ' 小节 ' + bc.cells + ' 格';
        }
        return sec.toFixed(3) + 's';
      }
      if (mode === 'time') {
        const g = grid();
        const bc = g ? (edge === 'end' ? seq().timeToBarCellEnd(g, sec) : seq().timeToBarCell(g, sec)) : null;
        return bc ? bc.bar + ' 小节 ' + bc.cell + ' 格' : '超出网格';
      }
      return sec.toFixed(3) + 's';
    }
    function readBars() {
      const iBar = fields.querySelector('.unit-bar');
      const iCell = fields.querySelector('.unit-cell');
      const bar = iBar ? parseInt(iBar.value, 10) : NaN;
      const cell = iCell ? parseInt(iCell.value, 10) : NaN;
      if (!Number.isFinite(bar) || !Number.isFinite(cell)) return null;
      if (kind === 'position') {
        const g = grid();
        if (!g) return null;
        if (bar < 1 || bar > g.bars.length) return null;
        const res = seq().barResolution(g, bar);
        if (!res) return null;
        const t = seq().barCellToTime(g, bar, cell);
        return t ? (edge === 'end' ? t[1] : t[0]) : null;
      }
      // length
      const st = step();
      if (!st) return null;
      if (bar < 0 || cell < 0) return null;
      const [lo, hi] = cellBounds(kind, Math.round(st.barDur / st.step));
      if (cell < lo || cell > hi) return null;
      return seq().barCellToDuration(bar, cell, st.barDur, st.step);
    }

    /** 从当前输入框读数（time 模式）。 */
    function readTime() {
      const iTime = fields.querySelector('.unit-time');
      const v = parseFloat(iTime ? iTime.value : '');
      if (!Number.isFinite(v)) return null;
      if (v < 0) return null;
      return v;
    }

    function commit() {
      const sec = mode === 'bars' ? readBars() : readTime();
      invalid = sec === null;
      fields.classList.toggle('unit-invalid', invalid);
      refOut.textContent = invalid ? '无效' : refText(sec === null ? value : sec);
      value = sec === null ? value : sec;
      if (typeof opts.onChange === 'function') opts.onChange(invalid ? null : value);
    }

    /** 渲染当前模式下的输入字段。 */
    function renderFields() {
      fields.textContent = '';
      if (mode === 'bars') {
        const g = kind === 'position' ? grid() : null;
        const noGrid = kind === 'position' && !g;
        const iBar = document.createElement('input');
        iBar.type = 'number';
        iBar.min = '0';
        iBar.className = 'unit-bar';
        iBar.placeholder = kind === 'length' ? '小节' : '小节';
        iBar.disabled = noGrid;
        iBar.addEventListener('change', commit);
        const iCell = document.createElement('input');
        iCell.type = 'number';
        iCell.min = '0';
        iCell.className = 'unit-cell';
        iCell.placeholder = '格';
        iCell.disabled = noGrid;
        iCell.addEventListener('change', commit);
        fields.appendChild(iBar);
        fields.appendChild(iCell);
        // 填充当前值
        if (kind === 'position') {
          if (g) {
            const bc = edge === 'end' ? seq().timeToBarCellEnd(g, value) : seq().timeToBarCell(g, value);
            if (bc) {
              iBar.value = String(bc.bar);
              iCell.value = String(bc.cell);
            } else {
              invalid = true;
              fields.classList.add('unit-invalid');
            }
          }
        } else {
          const st = step();
          if (st) {
            const bc = seq().durationToBarCell(value, st.barDur, st.step);
            iBar.value = String(bc.bars);
            iCell.value = String(bc.cells);
          }
        }
      } else {
        const iTime = document.createElement('input');
        iTime.type = 'number';
        iTime.min = '0';
        iTime.step = '0.001';
        iTime.className = 'unit-time';
        iTime.placeholder = '秒';
        iTime.addEventListener('change', commit);
        iTime.value = value > 0 ? String(+value.toFixed(3)) : '0';
        fields.appendChild(iTime);
      }
      refOut.textContent = refText(value);
    }

    modeBtn.addEventListener('click', () => {
      mode = mode === 'bars' ? 'time' : 'bars';
      modeBtn.textContent = mode === 'bars' ? '小节/格' : '时间';
      invalid = false;
      fields.classList.remove('unit-invalid');
      renderFields();
    });

    el.appendChild(modeBtn);
    el.appendChild(fields);
    el.appendChild(refOut);
    container.appendChild(el);

    renderFields();

    return {
      el,
      /** 重新填充显示（外部值/网格变化后调用）。 */
      refresh() {
        invalid = false;
        fields.classList.remove('unit-invalid');
        renderFields();
      },
      /** 设置当前值（秒）并刷新。 */
      setValue(sec) {
        value = typeof sec === 'number' && sec >= 0 ? sec : 0;
        this.refresh();
      },
      /** 当前值（秒）；非法返回 null。 */
      getValue() {
        return invalid ? null : value;
      },
      /** 是否处于非法状态。 */
      isInvalid() {
        return invalid;
      },
      /** 当前模式。 */
      mode() {
        return mode;
      },
      /** 强制切换模式。 */
      setMode(m) {
        if (m === 'time' || m === 'bars') {
          mode = m;
          modeBtn.textContent = mode === 'bars' ? '小节/格' : '时间';
          renderFields();
        }
      },
    };
  }

  return { create };
});
