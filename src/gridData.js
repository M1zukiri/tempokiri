/**
 * gridData.js — 节拍/网格数据导出（1.23.0）。
 *
 * 创建时间：2026-10-19 17:02:00
 *
 * 输入为 MC.buildGrid 的产物（segments / bars / beatTimes）+ 全局 offset / 时长 / 元数据，
 * 输出可序列化的数据对象，再转 CSV（每小节一行，带 # 注释头）或 JSON（含 segments/bars/beats）。
 * 纯函数，无 DOM 依赖，可在 Node 单测中直接调用。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const round = (v, d) => Number(Number(v).toFixed(d));

  /**
   * 组装网格数据。
   * @param {object} opts { grid, offset, duration, meta }
   * @returns {object|null} 无网格返回 null
   */
  function buildGridData(opts) {
    const o = opts || {};
    const grid = o.grid;
    if (!grid || !Array.isArray(grid.bars) || !grid.bars.length) return null;
    const offset = o.offset || 0;
    const duration = o.duration || 0;

    const segments = (grid.segments || []).map((s, i) => ({
      index: i + 1,
      bpm: round(s.bpm, 4),
      beatsPerBar: s.beatsPerBar,
      beatUnit: s.beatUnit || 4,
      resolution: s.resolution,
      startSec: round(s.startTime, 6),
      endSec: round(s.endTime, 6),
      barDur: round(s.barDur, 6),
      beatDur: round(s.beatDur, 6),
    }));

    const segAt = (t) => {
      const segs = grid.segments || [];
      for (let i = 0; i < segs.length; i++) {
        if (t >= segs[i].startTime - 1e-9 && t < segs[i].endTime) return segs[i];
      }
      return segs.length ? segs[segs.length - 1] : null;
    };

    const bars = grid.bars.map((b, i) => {
      const seg = segAt(b.startTime);
      return {
        index: i + 1,
        number: b.barNumber != null ? b.barNumber : i + 1,
        startSec: round(b.startTime, 6),
        endSec: round(b.endTime, 6),
        durationSec: round(b.endTime - b.startTime, 6),
        bpm: seg ? round(seg.bpm, 4) : null,
        beatsPerBar: seg ? seg.beatsPerBar : null,
      };
    });

    const beats = (grid.beatTimes || []).map((t, i) => ({ index: i + 1, timeSec: round(t, 6) }));

    return {
      format: 'tempokiri-grid-v1',
      offset: round(offset, 6),
      duration: round(duration, 6),
      meta: o.meta
        ? { title: o.meta.title || '', artist: o.meta.artist || '', album: o.meta.album || '' }
        : null,
      segments,
      bars,
      beats,
    };
  }

  /** CSV：注释头（# 开头）+ 表头 + 每小节一行。 */
  function gridDataToCSV(data) {
    if (!data) return '';
    const lines = [];
    lines.push('# tempokiri grid export v1');
    if (data.meta && data.meta.title) lines.push('# title=' + data.meta.title);
    if (data.meta && data.meta.artist) lines.push('# artist=' + data.meta.artist);
    lines.push('# offset_sec=' + data.offset);
    lines.push('# duration_sec=' + data.duration);
    lines.push('# segments=' + data.segments.length);
    lines.push('bar,start_sec,end_sec,duration_sec,bpm,beats_per_bar');
    for (const b of data.bars) {
      lines.push([b.number, b.startSec, b.endSec, b.durationSec, b.bpm, b.beatsPerBar].join(','));
    }
    return lines.join('\n') + '\n';
  }

  /** JSON：2 空格缩进，便于人工查看与脚本读取。 */
  function gridDataToJSON(data) {
    return data ? JSON.stringify(data, null, 2) + '\n' : '';
  }

  return { buildGridData, gridDataToCSV, gridDataToJSON };
});
