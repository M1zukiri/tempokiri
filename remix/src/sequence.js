/**
 * sequence.js — 段落序列领域逻辑（纯函数，Node 可测）。
 *
 * 序列项 = 用户选中的一个或多个连续小节：
 *   { id, startBar, endBar, startTime, endTime, fadeInMs, fadeOutMs }
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

  let nextId = 1;

  /** 生成序列项 id。 */
  function newId() {
    return 'seg-' + nextId++;
  }

  /**
   * 通过小节号查时间范围。
   * @param {object} grid buildGrid 的返回
   * @param {number} barNumber
   * @returns {[number, number]|null} [startTime, endTime] 或 null
   */
  function barToTime(grid, barNumber) {
    const bar = grid.bars.find((b) => b.barNumber === barNumber);
    return bar ? [bar.startTime, bar.endTime] : null;
  }

  /** 某小节所在段的网格分辨率（每小节格数）。 */
  function barResolution(grid, barNumber) {
    if (!grid || !grid.segments) return null;
    const seg = grid.segments.find((sg) => sg.bars && sg.bars.some((b) => b.barNumber === barNumber));
    return seg ? seg.resolution : null;
  }

  /** 某小节内第 cell 格的起止时间（格 = 网格线间区间，cell ∈ [1, resolution]）。 */
  function barCellToTime(grid, barNumber, cell) {
    const t = barToTime(grid, barNumber);
    if (!t) return null;
    const res = barResolution(grid, barNumber);
    if (!res) return null;
    const step = (t[1] - t[0]) / res;
    const c = Math.min(res, Math.max(1, Math.round(cell)));
    return [t[0] + (c - 1) * step, t[0] + c * step];
  }

  /** 时间 → 小节/格（时间落在哪一格；超出网格返回 null）。 */
  function timeToBarCell(grid, t) {
    if (!grid || !grid.bars || !grid.bars.length) return null;
    let bar = grid.bars.find((b) => t >= b.startTime && t < b.endTime);
    if (!bar) {
      // 网格末尾边界（序列终点常等于最后小节结束）→ 归属最后一格
      const last = grid.bars[grid.bars.length - 1];
      if (last && t >= last.startTime && t <= last.endTime + 1e-6) bar = last;
      else return null;
    }
    const res = barResolution(grid, bar.barNumber);
    if (!res) return null;
    const step = (bar.endTime - bar.startTime) / res;
    const cell = Math.min(res, Math.max(1, Math.floor((t - bar.startTime) / step) + 1));
    return { bar: bar.barNumber, cell };
  }

  /** 时间 → 小节/格（终点含边界：恰落在格区间终点归当前格，避免编辑终点格时显示 +1）。 */
  function timeToBarCellEnd(grid, t) {
    if (!grid || !grid.bars || !grid.bars.length) return null;
    const bar = grid.bars.find((b) => t >= b.startTime && t <= b.endTime + 1e-6);
    if (!bar) return null;
    const res = barResolution(grid, bar.barNumber);
    if (!res) return null;
    const step = (bar.endTime - bar.startTime) / res;
    const cell = Math.min(res, Math.max(1, Math.ceil((t - bar.startTime) / step)));
    return { bar: bar.barNumber, cell };
  }

  /** 时长 ↔ 小节/格（格 ∈ [0, resolution-1]，0 格 = 整小节）。 */
  function durationToBarCell(durationSec, barDur, step) {
    if (barDur <= 0 || step <= 0) return { bars: 0, cells: 0 };
    const res = Math.round(barDur / step);
    let bars = Math.floor(durationSec / barDur);
    let rem = durationSec - bars * barDur;
    let cells = Math.round(rem / step);
    if (cells >= res) {
      bars += 1;
      cells = 0;
    }
    return { bars, cells };
  }

  function barCellToDuration(bars, cells, barDur, step) {
    return bars * barDur + cells * step;
  }

  /**
   * 由小节选择创建序列项（fade 用毫秒）。
   * @param {object} grid
   * @param {number} startBar
   * @param {number} endBar
   * @param {number} [fadeInMs=0]
   * @param {number} [fadeOutMs=0]
   * @returns {object|null}
   */
  function createItem(grid, startBar, endBar, fadeInMs = 0, fadeOutMs = 0) {
    const s = barToTime(grid, startBar);
    const e = barToTime(grid, endBar);
    if (!s || !e) return null;
    return {
      id: newId(),
      startBar,
      endBar,
      startTime: s[0],
      endTime: e[1],
      fadeInMs,
      fadeOutMs,
    };
  }

  /**
   * 序列项 → 渲染 part（样本索引）。
   * @param {object} item
   * @param {number} sampleRate 导出用原始采样率
   * @returns {{start:number,end:number,fadeIn:number,fadeOut:number}}
   */
  function itemToPart(item, sampleRate) {
    const toS = (t) => Math.max(0, Math.round(t * sampleRate));
    return {
      start: toS(item.startTime),
      end: toS(item.endTime),
      fadeIn: Math.round((item.fadeInMs / 1000) * sampleRate),
      fadeOut: Math.round((item.fadeOutMs / 1000) * sampleRate),
    };
  }

  /**
   * 将序列项数组转为渲染 parts（保持顺序）。
   * @param {Array} items
   * @param {number} sampleRate
   * @returns {Array}
   */
  function itemsToParts(items, sampleRate) {
    return items.map((it) => itemToPart(it, sampleRate));
  }

  /** 序列项时长（秒）。 */
  function itemDuration(item) {
    return item.endTime - item.startTime;
  }

  /** 序列总时长（秒，不含交叉淡化重叠）。 */
  function totalDuration(items) {
    return items.reduce((s, it) => s + itemDuration(it), 0);
  }

  /**
   * 将任意时间范围吸附到小节网格，返回小节号区间。
   * 左边界吸附到某小节起点（含该小节），右边界吸附到某小节终点（含该小节）。
   * @param {object} grid
   * @param {number} t0 秒
   * @param {number} t1 秒
   * @returns {{startBar:number, endBar:number}}
   */
  function snapRange(grid, t0, t1) {
    if (t1 < t0) {
      const tmp = t0; t0 = t1; t1 = tmp;
    }
    const bars = grid.bars;
    const n = bars.length;
    if (n === 0) return { startBar: 1, endBar: 1 };
    // 期望：只要与 [t0, t1] 有重叠（哪怕只覆盖一点）的小节都被选中。
    // 区间交集：b.startTime < t1 && b.endTime > t0
    const sel = bars.filter((b) => b.startTime < t1 && b.endTime > t0);
    if (sel.length) {
      return { startBar: sel[0].barNumber, endBar: sel[sel.length - 1].barNumber };
    }
    // 无重叠（t0 ≈ t1 且落在小节边界上）：取包含 t0 的小节
    const bar = bars.find((b) => t0 >= b.startTime && t0 < b.endTime);
    const num = bar ? bar.barNumber : 1;
    return { startBar: num, endBar: num };
  }
  return {
    newId,
    barToTime,
    barResolution,
    barCellToTime,
    timeToBarCell,
    timeToBarCellEnd,
    durationToBarCell,
    barCellToDuration,
    createItem,
    itemToPart,
    itemsToParts,
    itemDuration,
    totalDuration,
    snapRange,
  };
});
