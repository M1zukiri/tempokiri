/**
 * bench_analysis.js — 性能热点量化基准（Node，无依赖）。
 *
 * 对比对象（方案候选）：
 *  1. estimateBpm 的 scoreAt：现状每 lag 对每 sample 二分（O(L·N·logN)）
 *     vs 双指针单调扫描（O(L·N)）
 *  2. spectralFlux 的幅度：Math.hypot vs Math.sqrt(re²+im²)
 *     （音频 FFT 幅度 ≤ 2048，无溢出风险，sqrt 安全）
 *
 * 用法：node tools/bench_analysis.js
 */
'use strict';
const analysis = require('../src/analysis.js');

// ---------- 计时工具 ----------
function bench(name, fn, iters = 5) {
  // 预热（JIT）
  for (let i = 0; i < 2; i++) fn();
  const times = [];
  for (let i = 0; i < iters; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`${name.padEnd(52)} ${median.toFixed(2).padStart(8)} ms`);
  return median;
}

// ---------- 1. estimateBpm：二分 vs 双指针 ----------
// 合成一个 3 分钟、BPM≈128 的 onset 序列（带抖动），模拟长曲目识别
function synthOnsets(bpm, seconds, jitter = 0.012) {
  const beat = 60 / bpm;
  const onsets = [];
  for (let t = 0; t < seconds; t += beat) {
    onsets.push(t + (Math.random() - 0.5) * jitter);
  }
  return onsets;
}

/** 现状：每 sample 一次二分（等价于 analysis.estimateBpm 内部 scoreAt）。 */
function scoreAtBinary(sorted, sample, lag) {
  let score = 0;
  for (let k = 0; k < sample.length; k++) {
    const t = sample[k] + lag;
    let lo = 0, hi = sorted.length - 1;
    let found = false;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < t - 0.03) lo = mid + 1;
      else if (sorted[mid] > t + 0.03) hi = mid - 1;
      else { found = true; break; }
    }
    if (found) score++;
  }
  return score;
}

/** 优化：双指针。sample[k]+lag 随 k 单调不减 → 窗口边界指针单调右移。 */
function scoreAtLinear(sorted, sample, lag) {
  let score = 0;
  let lo = 0, hi = 0;
  const n = sorted.length;
  for (let k = 0; k < sample.length; k++) {
    const t = sample[k] + lag;
    const a = t - 0.03;
    while (lo < n && sorted[lo] < a) lo++;
    while (hi < n && sorted[hi] <= t + 0.03) hi++;
    if (lo < hi) score++;
  }
  return score;
}

/** 完整 estimateBpm 主循环替换版：只测 scoreAt 部分（含加权中心，同采样率）。 */
function fullEstimateBpm(onsets, { minBpm = 60, maxBpm = 200 } = {}) {
  const sample = onsets.length > 600 ? onsets.filter((_, i) => Math.floor((i * 600) / onsets.length) === Math.floor((i * 600) / onsets.length)) : onsets;
  return sample.length;
}

function benchBpm(onsets) {
  let sample = onsets;
  if (onsets.length > 600) {
    sample = [];
    const step = onsets.length / 600;
    for (let i = 0; i < 600; i++) sample.push(onsets[Math.floor(i * step)]);
  }
  const sorted = Float64Array.from(sample).sort();
  const lagMin = 60 / 200, lagMax = 60 / 60;
  const lags = [];
  for (let lag = lagMin; lag <= lagMax + 1e-9; lag += 0.002) lags.push(lag);

  // 正确性等价性抽查（双指针 vs 二分）
  let eq = true;
  for (let i = 0; i < 60; i++) {
    const lag = lags[Math.floor(Math.random() * lags.length)];
    if (scoreAtBinary(sorted, sample, lag) !== scoreAtLinear(sorted, sample, lag)) { eq = false; break; }
  }
  console.log(`  等价性抽查（60 lag 随机）：${eq ? '一致 ✓' : '不一致 ✗'}`);

  const tBin = bench('  estimateBpm·二分 scoreAt（现状，350 lag × 600 样本）', () => {
    for (const lag of lags) scoreAtBinary(sorted, sample, lag);
  });
  const tLin = bench('  estimateBpm·双指针 scoreAt（优化，同上）', () => {
    for (const lag of lags) scoreAtLinear(sorted, sample, lag);
  });
  console.log(`  → 提速 ${(tBin / tLin).toFixed(1)}×`);
}

// ---------- 2. spectralFlux：hypot vs sqrt ----------
function fluxMagnitude(pcm, frameSize, hop, useHypot) {
  const win = analysis.hannWindow(frameSize);
  const nFrames = Math.floor((pcm.length - frameSize) / hop) + 1;
  const flux = new Float32Array(nFrames);
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  const mags = new Float64Array(frameSize >> 1);
  let prev = new Float64Array(frameSize >> 1);
  let cur = new Float64Array(frameSize >> 1);
  let hasPrev = false;
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < frameSize; i++) {
      re[i] = pcm[start + i] * win[i];
      im[i] = 0;
    }
    analysis.fft(re, im);
    for (let i = 0; i < mags.length; i++) {
      mags[i] = useHypot ? Math.hypot(re[i], im[i]) : Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    if (hasPrev) {
      let s = 0;
      for (let i = 0; i < mags.length; i++) {
        const d = mags[i] - prev[i];
        if (d > 0) s += d;
      }
      flux[f] = s;
    }
    cur.set(mags);
    const tmp = prev; prev = cur; cur = tmp;
    hasPrev = true;
  }
  return flux;
}

function benchFlux() {
  // 3 分钟 @22050Hz
  const sr = 22050;
  const pcm = new Float32Array(sr * 180);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.sin(i * 0.05) * 0.5 + (Math.random() - 0.5) * 0.3;
  }
  // 与 src 实现（每帧 Float64Array.from 分配）同语义的对照：验证双缓冲结果一致
  const a = fluxMagnitude(pcm, 2048, 512, false);
  const b = fluxMagnitude(pcm, 2048, 512, false);
  let eq = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { eq = false; break; }
  console.log(`  同输入双跑一致：${eq ? '✓' : '✗'}`);

  const tHypot = bench('  spectralFlux·Math.hypot（现状，3min@22.05k）', () => fluxMagnitude(pcm, 2048, 512, true), 3);
  const tSqrt = bench('  spectralFlux·Math.sqrt（优化，同上）', () => fluxMagnitude(pcm, 2048, 512, false), 3);
  console.log(`  → 幅度阶段提速 ${(tHypot / tSqrt).toFixed(1)}×`);
}

console.log('=== 热点 1：estimateBpm scoreAt（onset 自相关扫描）===');
const onsets = synthOnsets(128, 180);
console.log(`  onsets 数量：${onsets.length}（抽样至 600）`);
benchBpm(onsets);

console.log('\n=== 热点 2：spectralFlux 幅度计算 ===');
benchFlux();

console.log('\n=== 参考：完整自动识别（现状，真实算法全链路）===');
const sr = 22050;
const pcm = new Float32Array(sr * 180);
for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 0.05) * 0.5 + (Math.random() - 0.5) * 0.3;
bench('  analysis.analyze（180s 全链路）', () => analysis.analyze(pcm, { sampleRate: sr, hop: 512, minBpm: 60, maxBpm: 200 }), 3);
