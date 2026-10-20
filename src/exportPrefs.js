/**
 * exportPrefs.js — 导出参数记忆的校验与清洗（A5-4）。
 *
 * 创建时间：2026-10-19 18:15:00
 *
 * 全局设置里保存的是上次导出用的参数（每个 Tab 一份）。读取时统一过一遍
 * sanitize：未知键丢弃、数值夹取到合法区间、枚举回落默认，避免旧版本/手改
 * localStorage 把非法值灌进控件。纯函数，可单测。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  const oneOf = (v, list, dflt) => (list.indexOf(v) >= 0 ? v : dflt);

  /**
   * @param {object|null} raw 读取自全局设置的 exportPrefs
   * @returns {object|null} 清洗后的对象；raw 非对象返回 null
   */
  function sanitizeExportPrefs(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    const a = raw.audio;
    if (a && typeof a === 'object') {
      out.audio = {
        format: oneOf(a.format, ['wav', 'mp3'], 'wav'),
        bitDepth: oneOf(Number(a.bitDepth), [16, 24, 32], 16),
        mp3Bitrate: num(a.mp3Bitrate, 8, 320, 192),
        sampleRate: oneOf(String(a.sampleRate), ['src', '44100', '48000', '22050'], 'src'),
        normalize: !!a.normalize,
        peakDb: num(a.peakDb, -60, 0, -1),
        lufsTarget: a.lufsTarget == null || a.lufsTarget === '' ? null : num(a.lufsTarget, -40, 0, -16),
        crossfadeMs: num(a.crossfadeMs, 0, 1000, 30),
        fadeInMs: num(a.fadeInMs, 0, 10000, 0),
        fadeOutMs: num(a.fadeOutMs, 0, 10000, 0),
        range: oneOf(a.range, ['all', 'split'], 'all'),
      };
    }
    const v = raw.video;
    if (v && typeof v === 'object') {
      out.video = {
        videoBitrate: num(v.videoBitrate, 5e5, 5e7, 6e6),
        framerate: oneOf(String(v.framerate), ['src', '24', '30', '60'], 'src'),
        resolution: oneOf(v.resolution, ['orig', '1080p', '720p', '480p'], 'orig'),
        audioBitrate: num(v.audioBitrate, 64000, 320000, 128000),
        includeAudio: v.includeAudio !== false,
        crossfadeMs: num(v.crossfadeMs, 0, 1000, 30),
        fadeInMs: num(v.fadeInMs, 0, 10000, 0),
        fadeOutMs: num(v.fadeOutMs, 0, 10000, 0),
      };
    }
    const m = raw.majdata;
    if (m && typeof m === 'object') {
      out.majdata = {
        videoBitrate: num(m.videoBitrate, 5e5, 5e7, 6e6),
        mp3Bitrate: oneOf(Number(m.mp3Bitrate), [160, 192, 320], 320),
        normalize: !!m.normalize,
        peakDb: num(m.peakDb, -60, 0, -1),
        lufsTarget: m.lufsTarget == null || m.lufsTarget === '' ? null : num(m.lufsTarget, -40, 0, -16),
        crossfadeMs: num(m.crossfadeMs, 0, 1000, 30),
        fadeInMs: num(m.fadeInMs, 0, 10000, 0),
        fadeOutMs: num(m.fadeOutMs, 0, 10000, 0),
        padBar: !!m.padBar,
      };
    }
    const d = raw.data;
    if (d && typeof d === 'object') {
      out.data = { format: oneOf(d.format, ['csv', 'json'], 'csv') };
    }
    return out;
  }

  return { sanitizeExportPrefs };
});
