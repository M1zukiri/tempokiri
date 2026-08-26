// 创建时间：2026-08-24 08:00:00
/**
 * tapTempo.js — BPM Tap（人耳锚定）模块（纯函数状态机，Node 可测）。
 *
 * 目标：用户按歌曲正拍连续敲击（tap），收集拍间隔 → 估计 BPM（中位数 ±15%
 * 一致性滤波 → 均值）。产品中仅用于「缩小搜索范围」（识别前把 tap 值 ±20%
 * 作为本段搜索窗，结构性排除半频/倍频与范围外曲目的层误判）。
 *
 * 规则：
 *   - 间隔 < 250ms：视为双击/误触，忽略（不重置）；
 *   - 间隔 > 2s：视为停顿/换段，自动重置重拍；
 *   - 达到 8 拍（7 个有效间隔）锁定，后续 push 返回锁定结果，直到 reset()。
 *
 * 浏览器全局暴露为 window.MC.tapTempo，CommonJS 环境 module.exports。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.tapTempo = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_GAP = 0.1; // 双击忽略（秒）：低至 100ms 可拍 600 BPM 拍距；人体双击极限 ~80ms 仍防抖
  const RESET_GAP = 2.0; // 停顿重置（秒）
  const TARGET = 8; // 锁定拍数
  const CONSISTENCY = 0.15; // 一致性滤波半径（±15% 中位数）

  /**
   * 从拍间隔序列估计 BPM（纯函数）。
   * 滤波：丢弃 <250ms 间隔 → 中位数 ±15% 一致性过滤 → 剩余均值。
   * @param {number[]} intervals 拍间隔（秒）
   * @returns {number|null} BPM（2 位小数）或 null（有效拍 <4）
   */
  function bpmFromIntervals(intervals) {
    const iv = (intervals || []).filter((g) => g > MIN_GAP && isFinite(g));
    if (iv.length < 4) return null;
    const sorted = [...iv].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const ok = iv.filter((g) => Math.abs(g - med) <= med * CONSISTENCY);
    if (ok.length < 4) return null;
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
    return Math.round((60 / mean) * 100) / 100;
  }

  /**
   * Tap 状态机：push(nowMs) 推进一次敲击。
   * @returns {{n:number, bpm:number|null, locked:boolean, reset:boolean}}
   *   n 有效拍数；bpm 当前估计（可用时）；locked 到达 8 拍；reset 本次触发重置
   */
  function createTapper() {
    let last = null;
    let intervals = [];
    let locked = false;

    return {
      push(nowMs) {
        const t = nowMs / 1000;
        if (locked) return { n: intervals.length + 1, bpm: bpmFromIntervals(intervals), locked: true, reset: false };
        if (last == null) {
          last = t;
          return { n: 1, bpm: null, locked: false, reset: false };
        }
        const gap = t - last;
        if (gap < MIN_GAP) return { n: intervals.length + 1, bpm: bpmFromIntervals(intervals), locked: false, reset: false };
        if (gap > RESET_GAP) {
          // 停顿/换段：本次敲击作为新序列第 1 拍，不携带旧间隔
          intervals = [];
          last = t;
          return { n: 1, bpm: null, locked: false, reset: true };
        }
        intervals.push(gap);
        last = t;
        const n = intervals.length + 1;
        if (intervals.length >= TARGET - 1) locked = true;
        return { n, bpm: bpmFromIntervals(intervals), locked, reset: false };
      },
      reset() {
        last = null;
        intervals = [];
        locked = false;
      },
    };
  }

  return {
    MIN_GAP,
    RESET_GAP,
    TARGET,
    CONSISTENCY,
    bpmFromIntervals,
    createTapper,
  };
});
