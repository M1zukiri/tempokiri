/**
 * loudness.js — ITU-R BS.1770-4 积分响度（LUFS）与归一化（A5-3）。
 *
 * 创建时间：2026-10-19 17:50:00
 *
 * 链路：K 加权（高架预滤波 + RLB 高通，双线性变换，任意采样率）
 *   → 400ms 块 / 75% 重叠 → 均方 → 门限（-70 LUFS 绝对 + -10 LU 相对）
 *   → 积分响度 L = -0.691 + 10·log10(Σ 块均方)。
 * 纯函数，无 DOM 依赖，可单测（与 ffmpeg ebur128 交叉校验）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ABS_GATE = -70;   // 绝对门限（LUFS）
  const REL_GATE = -10;   // 相对门限（LU）
  const BLOCK_SEC = 0.4;
  const OVERLAP = 0.75;

  /** BS.1770 K 加权滤波器系数（模拟原型 → 双线性变换，适用于任意采样率）。 */
  function kWeightingCoeffs(sampleRate) {
    // 预滤波：高架（f0 = 1681.97 Hz, G = 3.9998 dB, Q = 0.70717）
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / sampleRate);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    const pre = {
      b0: (Vh + Vb * K / Q + K * K) / a0,
      b1: 2 * (K * K - Vh) / a0,
      b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0,
      a2: (1 - K / Q + K * K) / a0,
    };
    // RLB 高通（f0 = 38.135 Hz, Q = 0.50033）
    const f1 = 38.13547087602444;
    const Q1 = 0.5003270373238773;
    const K1 = Math.tan(Math.PI * f1 / sampleRate);
    const a01 = 1 + K1 / Q1 + K1 * K1;
    const rlb = {
      b0: 1 / a01,
      b1: -2 / a01,
      b2: 1 / a01,
      a1: 2 * (K1 * K1 - 1) / a01,
      a2: (1 - K1 / Q1 + K1 * K1) / a01,
    };
    return { pre, rlb };
  }

  /** 单级双极滤波器（直接 II 型转置）。 */
  function biquad(x, c) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const o = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = v;
      y2 = y1; y1 = o;
      y[i] = o;
    }
    return y;
  }

  const toLufs = (ms) => -0.691 + 10 * Math.log10(ms);

  /**
   * 积分响度（LUFS）。素材短于 400ms 时按整段均方计算；全静音返回 -Infinity。
   * @param {Float32Array|Float64Array} samples
   * @param {number} sampleRate
   * @returns {number}
   */
  function integratedLoudness(samples, sampleRate) {
    if (!samples || !samples.length || !(sampleRate > 0)) return -Infinity;
    const { pre, rlb } = kWeightingCoeffs(sampleRate);
    const y = biquad(biquad(samples, pre), rlb);
    const block = Math.max(1, Math.round(BLOCK_SEC * sampleRate));
    const hop = Math.max(1, Math.round(block * (1 - OVERLAP)));
    if (y.length < block) {
      let s = 0;
      for (let i = 0; i < y.length; i++) s += y[i] * y[i];
      return toLufs(s / y.length);
    }
    const blocks = [];
    for (let st = 0; st + block <= y.length; st += hop) {
      let s = 0;
      for (let i = st; i < st + block; i++) s += y[i] * y[i];
      const ms = s / block;
      blocks.push({ ms, l: toLufs(ms) });
    }
    let sum = 0, n = 0;
    for (const b of blocks) if (b.l > ABS_GATE) { sum += b.ms; n++; }
    if (!n) return -Infinity;
    const rel = toLufs(sum / n) + REL_GATE;
    sum = 0; n = 0;
    for (const b of blocks) if (b.l > ABS_GATE && b.l > rel) { sum += b.ms; n++; }
    if (!n) return -Infinity;
    return toLufs(sum / n);
  }

  /**
   * 把整段音频归一到目标 LUFS（线性增益，硬限幅 ±1）。
   * 静音/无有效响度时原样返回（gainDb = 0）。
   * @param {Float32Array} samples
   * @param {number} sampleRate
   * @param {number} targetLufs
   * @returns {{samples: Float32Array, gainDb: number, lufs: number, outLufs: number}}
   */
  function normalizeToLufs(samples, sampleRate, targetLufs) {
    const lufs = integratedLoudness(samples, sampleRate);
    if (!isFinite(lufs) || lufs <= ABS_GATE) {
      return { samples, gainDb: 0, lufs, outLufs: lufs };
    }
    const gainDb = targetLufs - lufs;
    const gain = Math.pow(10, gainDb / 20);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
    }
    return { samples: out, gainDb, lufs, outLufs: integratedLoudness(out, sampleRate) };
  }

  return { kWeightingCoeffs, integratedLoudness, normalizeToLufs };
});
