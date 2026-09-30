/**
 * sequence.js — 段落序列领域逻辑（纯函数，Node 可测）。
 *
 * 序列项 = 用户选中的一个或多个连续小节：
 *   { id, startBar, endBar, startTime, endTime, fadeInMs, fadeOutMs }
 *
 * ================= 时间 ↔ 小节/格 换算语义 =================
 *
 * 区间模型：
 *   - 小节 b = 半开区间 [barStart, barEnd)，相邻小节精确衔接
 *     （buildGrid 中下一小节起点取当前小节终点，同一累积值，无浮点缝隙）
 *   - 格 k（k ∈ [1, resolution]）= 小节内网格线间的半开区间
 *     [barStart + (k-1)*step, barStart + k*step)，step = barDur / resolution
 *
 * 格 → 时间（输入方向，barCellToTime）：
 *   - 起点格 k 的时间戳 = 区间起点 start_k（含起点）
 *   - 终点格 k 的时间戳 = 区间终点 end_k（“包含终点格”语义：选择到格 k 内容末尾；
 *     该值恰好是格 k+1 的起点，这是区间代数的正常结果）
 *
 * 时间 → 格（显示方向）：
 *   - timeToBarCell（通用）：t 落在半开区间 [start_k, end_k) → 格 k。
 *     起点时间戳 start_k 归格 k；终点时间戳 end_k 归格 k+1（半开区间含起点不含终点）。
 *   - timeToBarCellEnd（终点专用）：t 作为“终点格末尾”→ 含端点 (start_k, end_k] 归格 k，
 *     与“包含终点格”语义一致（终点输入换算出的 end_k 显示回格 k，而非 k+1）。
 *
 * 浮点：相邻小节边界用同一累积值、格边界用同一表达式，换算不依赖容差补丁。
 * =======================================================
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
    if (!grid || !grid.bars || !grid.bars.length) return null;
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

  /**
   * 时间 → 小节/格（通用：半开区间归属，含起点不含终点；超出网格返回 null）。
   * 起点时间戳（= 格 k 区间起点）归格 k；恰好等于网格末尾（序列终点常见）归最后一格。
   */
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

  /**
   * 时间 → 小节/格（终点专用：含端点归当前格，与“包含终点格”语义一致）。
   * 终点时间戳 end_k（= 格 k 区间终点）显示回格 k，而非半开区间归属的 k+1。
   */
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
   * 底层记录 = 小节/格（mode 'bars'）；startTime/endTime 为派生缓存（syncItemTimes 重算）。
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
    const item = {
      id: newId(),
      mode: 'bars', // 底层记录：小节/格；时间为派生缓存
      startBar,
      startCell: 1,
      endBar,
      endCell: barResolution(grid, endBar) || 1,
      startTime: null,
      endTime: null,
      fadeInMs,
      fadeOutMs,
    };
    syncItemTimes(item, grid);
    return item;
  }

  /**
   * 同步序列项的两套语义（给定 grid）：
   *   bars 模式（底层=小节/格）→ 重算派生 startTime/endTime；
   *   time 模式（底层=秒）→ 重算派生 startBar/startCell/endBar/endCell（显示用）。
   * 单向换算，无时间↔小节往返值误差。
   * 失效规则：bars 越界（bar 不在网格 / 该小节分辨率异常）→ 派生时间置 null（下游 isEmptyItem 判 invalid），
   * 绝不保留陈旧缓存。
   */
  function syncItemTimes(item, grid) {
    if (!item || item.silent || !grid) return;
    if (item.mode === 'bars') {
      // 补全缺省格（旧数据/迁移）：起点格 1、终点格 = 所在小节分辨率
      if (!item.startCell) item.startCell = 1;
      if (!item.endCell) item.endCell = barResolution(grid, item.endBar) || 1;
      const s = barCellToTime(grid, item.startBar, item.startCell);
      const e = barCellToTime(grid, item.endBar, item.endCell);
      if (s instanceof Array && e instanceof Array) {
        item.startTime = s[0];
        item.endTime = e[1];
      } else {
        item.startTime = null; // 越界 → 显式失效（旧缓存不得保留）
        item.endTime = null;
      }
      return;
    }
    // time 模式：派生小节/格显示
    const sbc = timeToBarCell(grid, item.startTime);
    const ebc = timeToBarCellEnd(grid, item.endTime);
    item.startBar = sbc ? sbc.bar : null;
    item.startCell = sbc ? sbc.cell : null;
    item.endBar = ebc ? ebc.bar : null;
    item.endCell = ebc ? ebc.cell : null;
  }

  /** 网格/参数变化后重算全部非静音段的派生缓存（音乐单位段随动；时间锚定段内容不动）。 */
  function resyncGridItems(items, grid) {
    if (!items || !grid) return;
    for (const it of items) {
      if (!it.silent) syncItemTimes(it, grid);
    }
  }

  /** bars 范围 → 派生时间范围（单向；越界/无效返回 null）。 */
  function barsRangeToTime(grid, bv) {
    if (!grid || !bv || !(bv.startBar > 0) || !(bv.endBar > 0)) return null;
    const s = barCellToTime(grid, bv.startBar, bv.startCell || 1);
    const e = barCellToTime(grid, bv.endBar, bv.endCell || 1);
    if (!s || !e) return null;
    return { startSec: s[0], endSec: e[1] };
  }

  /** time 范围 → 派生小节/格（单向；超出网格返回 null）。负时间合法：网格起点可随负 offset 为负。 */
  function timeRangeToBars(grid, tv) {
    if (!grid || !tv || !(tv.endSec > tv.startSec)) return null;
    const s = timeToBarCell(grid, tv.startSec);
    const e = timeToBarCellEnd(grid, tv.endSec);
    if (!s || !e) return null;
    return { startBar: s.bar, startCell: s.cell, endBar: e.bar, endCell: e.cell };
  }

  /** 双语义 spec 换算：以 spec.mode 语义为基准派生另一侧；返回完整 spec（两路皆携带，失败侧 null）。 */
  function rangeSpecSync(spec, grid) {
    const out = { mode: spec && spec.mode === 'time' ? 'time' : 'bars', bars: null, time: null };
    if (!spec) return out;
    if (out.mode === 'bars' && spec.bars) {
      out.bars = spec.bars;
      out.time = barsRangeToTime(grid, spec.bars);
    } else if (out.mode === 'time' && spec.time) {
      out.time = spec.time;
      out.bars = timeRangeToBars(grid, spec.time);
    }
    return out;
  }

  /**
   * 序列项 → 渲染 part（样本索引）。
   * 绝对区间语义：start/end 允许越界（负起点 = 首部静音、超出曲长 = 尾部静音），
   * 由 renderMix 负责补零；静音段（silent）整段输出零。
   * @param {object} item 序列项（{silent, durationSec} 或 {startTime,endTime}）
   * @param {number} sampleRate 导出用原始采样率
   * @returns {{start:number,end:number,fadeIn:number,fadeOut:number,silent?:boolean}}
   */
  function itemToPart(item, sampleRate) {
    const toS = (t) => Math.round(t * sampleRate);
    if (item.silent) {
      const n = Math.max(0, Math.round(item.durationSec * sampleRate));
      return {
        start: 0,
        end: n,
        fadeIn: Math.round((item.fadeInMs / 1000) * sampleRate),
        fadeOut: Math.round((item.fadeOutMs / 1000) * sampleRate),
        silent: true,
      };
    }
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

  /** 序列项时长（秒）；静音段用 durationSec，普通段 = end − start。 */
  function itemDuration(item) {
    return item.silent ? item.durationSec : item.endTime - item.startTime;
  }

  /**
   * 序列项是否为「空段落」：无时长或与音频 [0, duration) 完全无重叠。
   * 部分重叠（如首小节负起点、末小节超长）是合法的——渲染补静音。
   * @param {object} item
   * @param {number} duration 音频总时长（秒）
   */
  function isEmptyItem(item, duration) {
    if (item.silent) return !(item.durationSec > 0);
    return !(item.startTime < item.endTime && item.endTime > 0 && item.startTime < duration);
  }

  /** 序列总时长（秒，不含交叉淡化重叠）。 */
  function totalDuration(items) {
    return items.reduce((s, it) => s + itemDuration(it), 0);
  }

  /**
   * 拼接序列进度条元数据：总时长 + 各拼接点（段边界）位置。
   * @param {Array} items 序列项（按顺序）
   * @returns {{total:number, seams:number[]}} seams 为段边界在拼接时间轴上的
   *   累计位置（不含 0 与末尾；每相邻两段之间一个拼接点）
   */
  function progressMeta(items) {
    const total = totalDuration(items);
    let acc = 0;
    const seams = [];
    for (let i = 0; i < items.length - 1; i++) {
      acc += itemDuration(items[i]);
      seams.push(acc);
    }
    return { total, seams };
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
  /**
   * Majdata 补空小节：空小节时长。
   * 取网格第一段 barDur（应用网格后）；无网格/段无效时回退默认（120BPM·4/4 = 2s）。
   * @param {Array<{barDur:number}>|null} segments 网格段列表
   * @param {number} [fallback=2] 回退时长（秒）
   * @returns {number} 一个小节的时长（秒）
   */
  function padBarDuration(segments, fallback = 2) {
    const f0 = segments && segments[0];
    return f0 && f0.barDur > 0 ? f0.barDur : fallback;
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
    isEmptyItem,
    totalDuration,
    progressMeta,
    snapRange,
    padBarDuration,
    syncItemTimes,
    resyncGridItems,
    barsRangeToTime,
    timeRangeToBars,
    rangeSpecSync,
  };
});
