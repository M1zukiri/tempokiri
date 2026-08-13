/**
 * export.js — 拼接渲染与 WAV/MP3 编码（纯函数为主，Node 可测）。
 *
 * 不依赖 OfflineAudioContext：交叉淡化、淡入淡出、拼接全部在 Float32Array
 * 层面完成，WAV/MP3 编码输出 ArrayBuffer，浏览器侧只负责触发下载。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./analysis.js'));
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory(global.MC));
  }
})(typeof self !== 'undefined' ? self : this, function (analysis) {
  'use strict';

  /** 获取 lamejs（浏览器全局 / Node require，二选一）。 */
  function getLame() {
    if (typeof lamejs !== 'undefined') return lamejs;
    if (typeof require === 'function') {
      try {
        // lamejs 在 lib/lame.min.js（UMD 包装版），Node 下可用 require 拿到
        const mod = require('../lib/lame.min.js');
        return mod && mod.Mp3Encoder ? mod : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /**
   * 单段线性淡入淡出（就地复制后修改，不改原数据）。
   * @param {Float32Array} seg
   * @param {number} fadeInSamples
   * @param {number} fadeOutSamples
   * @returns {Float32Array}
   */
  function applyFades(seg, fadeInSamples, fadeOutSamples) {
    const out = seg.slice();
    const n = out.length;
    const fi = Math.min(fadeInSamples, n);
    const fo = Math.min(fadeOutSamples, n);
    for (let i = 0; i < fi; i++) out[i] *= i / fi;
    for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
    return out;
  }
  function crossfadeConcat(a, b, fadeSamples) {
    const fl = Math.max(0, Math.min(fadeSamples, a.length, b.length));
    const outLen = a.length + b.length - fl;
    const out = new Float32Array(outLen);
    // a 的前缀（不参与交叉）
    out.set(a.subarray(0, a.length - fl), 0);
    // 交叉区：等功率余弦曲线（两端斜率平缓），避免线性交叉在段边界处
    // 的相位跳变产生爆音/锯齿音（段衔接处样本跳变可达全曲平均的 35 倍）
    for (let i = 0; i < fl; i++) {
      const t = i / fl;
      const w = (1 - Math.cos(Math.PI * t)) / 2;
      out[a.length - fl + i] = a[a.length - fl + i] * (1 - w) + b[i] * w;
    }
    // b 的剩余部分
    out.set(b.subarray(fl), a.length);
    return out;
  }

  /**
   * 按 parts 顺序拼接整段音频。
   * @param {Float32Array} pcm 完整 mono PCM
   * @param {Array<{start:number,end:number,fadeIn:number,fadeOut:number}>} parts
   *        样本索引（end 排他），已按用户排序
   * @param {number} crossfadeSamples
   * @returns {Float32Array}
   */
  function renderMix(pcm, parts, crossfadeSamples) {
    let result = null;
    for (const p of parts) {
      if (p.end <= p.start) continue;
      const seg = pcm.subarray(p.start, p.end);
      const faded = applyFades(seg, p.fadeIn || 0, p.fadeOut || 0);
      result = result === null ? faded : crossfadeConcat(result, faded, crossfadeSamples);
    }
    return result || new Float32Array(0);
  }

  /**
   * 编码 PCM WAV（mono），支持 16/24-bit 整数与 32-bit float。
   * @param {Float32Array} samples -1..1
   * @param {number} sampleRate
   * @param {number} [bitDepth=16] 16 | 24 | 32（32 为 IEEE float），非法值回退 16
   * @returns {ArrayBuffer}
   */
  function encodeWav(samples, sampleRate, bitDepth = 16) {
    const bd = bitDepth === 24 || bitDepth === 32 ? bitDepth : 16;
    const bytesPerSample = bd === 32 ? 4 : bd / 8;
    const fmtCode = bd === 32 ? 3 : 1; // IEEE float | PCM
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * bytesPerSample);
    const view = new DataView(buf);
    const writeStr = (off, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    const writeInt24 = (off, q) => {
      const u = q < 0 ? q + 0x1000000 : q;
      view.setUint8(off, u & 0xff);
      view.setUint8(off + 1, (u >> 8) & 0xff);
      view.setUint8(off + 2, (u >> 16) & 0xff);
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + n * bytesPerSample, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, fmtCode, true);
    view.setUint16(22, 1, true);                 // mono
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      const off = 44 + i * bytesPerSample;
      if (bd === 32) view.setFloat32(off, v, true);
      else if (bd === 24) writeInt24(off, Math.round(v * (v < 0 ? 0x800000 : 0x7fffff)));
      else view.setInt16(off, Math.round(v * (v < 0 ? 0x8000 : 0x7fff)), true);
    }
    view.setUint32(24, sampleRate, true);        // 采样率
    view.setUint32(28, sampleRate * bytesPerSample, true); // 字节率
    view.setUint16(32, bytesPerSample, true);    // 块对齐
    view.setUint16(34, bd, true);                // 位深
    writeStr(36, 'data');
    view.setUint32(40, n * bytesPerSample, true);
    return buf;
  }

  /**
   * 峰值归一化：把样本峰值对齐到目标 dBFS（默认 -1）。
   * @param {Float32Array} samples -1..1
   * @param {number} [targetDb=-1] 目标峰值（dBFS，≤0）
   * @returns {Float32Array} 新数组，不改原数据
   */
  function peakNormalize(samples, targetDb = -1) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    if (!isFinite(peak) || peak <= 0) return Float32Array.from(samples); // 全静音/异常不放大
    const gain = Math.pow(10, targetDb / 20) / peak;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
    }
    return out;
  }

  const MP3_SUPPORTED_SR = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

  /**
   * 编码 MP3（mono）。lamejs 不支持的目标采样率先重采样到 44100。
   * @param {Float32Array} samples
   * @param {number} sampleRate
   * @param {number} [kbps=192]
   * @returns {ArrayBuffer}
   * @throws 当 lamejs 不可用时
   */
  function encodeMp3(samples, sampleRate, kbps = 192) {
    const lame = getLame();
    if (!lame) throw new Error('MP3 编码器不可用');
    const targetSr = MP3_SUPPORTED_SR.indexOf(sampleRate) >= 0 ? sampleRate : 44100;
    const pcm = targetSr === sampleRate ? samples : analysis.resample(samples, sampleRate, targetSr);
    const encoder = new lame.Mp3Encoder(1, targetSr, kbps);
    const chunks = [];
    const blockSize = 1152;
    for (let i = 0; i < pcm.length; i += blockSize) {
      const chunk = pcm.subarray(i, i + blockSize);
      const out = encoder.encodeBuffer(chunk);
      if (out.length) chunks.push(out);
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(tail);
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out.buffer;
  }

  /** 触发浏览器下载。 */
  function downloadBlob(buffer, filename, mime) {
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return {
    applyFades,
    crossfadeConcat,
    renderMix,
    encodeWav,
    encodeMp3,
    peakNormalize,
    downloadBlob,
  };
});
