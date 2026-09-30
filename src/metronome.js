// 创建时间：2026-08-26 (节拍器纯逻辑模块)
/**
 * metronome.js — 节拍器时间规划纯逻辑（无 WebAudio 依赖，Node 可测）。
 *
 * 拍点语义：
 *   - BPM 按「每分钟若干个单位音符」定义（4/4 → 四分音符/分；6/8 → 八分音符/分）；
 *     一拍时长 beatDur = 60 / bpm；
 *   - noteUnit（几分音符）决定拍点密度：拍点间隔 clickInterval = beatDur × unitBeat / noteUnit，
 *     其中 unitBeat = 拍号分母（4/4→4，6/8→8）；noteUnit 默认 = unitBeat（一拍一点）；
 *   - 小节起点 = 段起点 + m × barDur（barDur = beatDur × beatsPerBar），每小节第一个拍点为重音；
 *   - 段参数（bpm/beatsPerBar/beatUnit/barDur）来自网格 segments（buildGrid 产物），
 *     拍点跨段时以段边界（小节线）为边界重新起拍。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.metronome = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;

  /** 拍号分母（拍点的音符定义），缺省 4（4/4）。 */
  function unitBeatOf(seg) {
    return (seg && seg.beatUnit > 0) ? seg.beatUnit : 4;
  }

  /** 默认音符单位 = 拍号分母（4/4→4，6/8→8）。 */
  function noteUnitDefault(seg, noteUnit) {
    if (noteUnit > 0) return noteUnit;
    return unitBeatOf(seg);
  }

  /** 一拍时长（秒）：beatDur = 60 / bpm。 */
  function beatDurOf(seg) {
    const bpm = seg && seg.bpm > 0 ? seg.bpm : 120;
    return 60 / bpm;
  }

  /** 拍点间隔（秒）：beatDur × 拍号分母 / 音符单位。 */
  function clickInterval(seg, noteUnit) {
    const nu = noteUnitDefault(seg, noteUnit);
    return beatDurOf(seg) * unitBeatOf(seg) / nu;
  }

  /** 小节时长（秒）：barDur = beatDur × beatsPerBar。 */
  function barDurOf(seg) {
    if (seg && seg.barDur > 0) return seg.barDur;
    return beatDurOf(seg) * ((seg && seg.beatsPerBar > 0) ? seg.beatsPerBar : 4);
  }

  /** t 所在的网格段（segments 按时间顺序，段含 startTime/endTime）；无网格返回 null。 */
  function segmentAt(segments, t) {
    if (!segments || !segments.length) return null;
    let hit = null;
    for (const seg of segments) {
      if (t >= seg.startTime - EPS && t < seg.endTime + EPS) hit = seg; // 边界容忍：取最晚命中，段间边界归属下一段
    }
    // 网格前/后：前后取最近段（播放起点可能略早于首个 onset）
    if (!hit && t < segments[0].startTime) return segments[0];
    return hit || segments[segments.length - 1];
  }

  /**
   * t 之后的下一拍：返回 { t, accent }（accent = 该拍是否小节首拍）。
   * 拍点序列从段起点（小节线）起，步长 clickInterval；跨段时下一拍 = 段边界。
   * t 恰在拍点上时按「返回下一拍」（调用方需传入 t - ε 以命中当前拍）。
   */
  function nextClick(segments, t, noteUnit) {
    if (!segments || !segments.length) return null;
    const seg = segmentAt(segments, t);
    const ci = clickInterval(seg, noteUnit);
    const bar = barDurOf(seg);
    // 从段起点起算的拍点序号 k；k=0 即段起点（小节首拍）
    const k = Math.floor((t - seg.startTime) / ci + EPS) + 1;
    const t2 = seg.startTime + k * ci;
    if (t2 < seg.endTime - EPS) {
      const inBar = (k * ci) % bar;
      return { t: t2, accent: inBar < EPS || bar - inBar < EPS };
    }
    // 拍点跨出段尾 → 下一段起点（小节线，重音）
    const nxt = segments[segments.indexOf(seg) + 1];
    return nxt ? { t: nxt.startTime, accent: true } : null;
  }

  /** 收集 [fromT, toT] 内的拍点序列（含 fromT 所在拍点），测试与调试用。 */
  function planClicks(segments, fromT, toT, noteUnit) {
    const out = [];
    let t = fromT;
    for (let guard = 0; guard < 10000; guard++) {
      const n = nextClick(segments, t - EPS, noteUnit);
      if (!n || n.t > toT + EPS) break;
      out.push(n);
      t = n.t + EPS;
    }
    return out;
  }

  /** 拼接播放重同步判定：当前网格时间相对上次大幅回退（重复段/静音段后跳转）时，需重置拍点游标。 */
  function shouldResync(lastGrid, nowGrid, threshold = 0.05) {
    return lastGrid != null && nowGrid != null && nowGrid < lastGrid - threshold;
  }

  /** 序列项时长（秒）：静音段 durationSec，普通段 endTime − startTime（与 sequence.itemDuration 同规）。 */
  function itemDurOf(item) {
    if (!item) return 0;
    if (item.silent) return item.durationSec > 0 ? item.durationSec : 0;
    return (item.endTime != null && item.startTime != null) ? (item.endTime - item.startTime) : 0;
  }

  /** 拼接时间轴定位：mt（mix 时间）所在序列项及段内起点累计（mix 轴累计）。 */
  function mixItemAt(items, mt) {
    if (!items || !items.length) return null;
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const d = itemDurOf(items[i]);
      if (mt < acc + d) return { item: items[i], index: i, startMix: acc };
      acc += d;
    }
    return null;
  }

  /**
   * 静音段（音乐单位 bar/beat）拍点合成：段起点（mix 轴）起，步长 = 60/bpm×拍号分母/音符单位；
   * 重音 = 段内小节边界（k=0 段起点恒重音——静音段的音乐世界从自己开始）；
   * 时间单位（sec）或 t 超出段尾返回 null（不打点）。
   */
  function nextClickInSilent(item, startMix, tMix, noteUnit) {
    if (!item || !item.silent) return null;
    const unit = item.unit;
    if (unit !== 'bar' && unit !== 'beat') return null;
    if (!(item.bpm > 0) || !(item.durationSec > 0)) return null;
    const seg = { bpm: item.bpm, beatUnit: item.beatUnit, beatsPerBar: item.beatsPerBar };
    const ci = clickInterval(seg, noteUnit);
    const bar = barDurOf(seg);
    const start = startMix != null ? startMix : 0;
    const end = start + item.durationSec;
    if (!(ci > 0) || tMix >= end - EPS) return null;
    // +EPS 容差：非 2 幂步长（如 0.4s）的浮点误差可能使 (tMix-start)/ci 略小于整数，
    // floor 拉回上一个拍点导致"不前进"死循环（nextClick 同一做法）
    const k = Math.floor((tMix - start) / ci + EPS) + 1;
    const t2 = start + k * ci;
    if (t2 >= end - EPS) return null;
    const rel = k * ci;
    const inBar = rel % bar;
    return { t: t2, accent: inBar < EPS || bar - inBar < EPS };
  }

  return {
    unitBeatOf,
    noteUnitDefault,
    beatDurOf,
    clickInterval,
    barDurOf,
    segmentAt,
    nextClick,
    planClicks,
    shouldResync,
    itemDurOf,
    mixItemAt,
    nextClickInSilent,
  };
});
