/**
 * test_analysis.js — 分析算法单元测试（node --test）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/analysis.js');

/** 合成节拍信号：每拍一个短噪声脉冲。 */
function makeBeatSignal(bpm, seconds, sr = A.DEFAULT_ANALYSIS_SR) {
  const n = Math.round(seconds * sr);
  const pcm = new Float32Array(n);
  const beat = 60 / bpm;
  const burst = Math.round(sr * 0.03);
  for (let t = 0; t < seconds; t += beat) {
    const start = Math.round(t * sr);
    for (let i = 0; i < burst && start + i < n; i++) {
      pcm[start + i] = Math.random() * 2 - 1;
    }
  }
  return pcm;
}

test('fft: 单频正弦峰值在正确频点', () => {
  const sr = 1024;
  const n = 1024;
  const freq = 100;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  A.fft(re, im);
  // 幅度谱峰值应在 freq bin
  let best = 0;
  for (let i = 1; i < n / 2; i++) {
    if (Math.hypot(re[i], im[i]) > Math.hypot(re[best], im[best])) best = i;
  }
  assert.ok(Math.abs(best - freq) <= 1, `期望峰值在 ${freq}，实际 ${best}`);
});

test('fft: 非 2 的幂长度抛错', () => {
  assert.throws(() => A.fft(new Float64Array(100), new Float64Array(100)));
});

test('estimateBpm: 合成 120 BPM 信号', () => {
  const pcm = makeBeatSignal(120, 12);
  const flux = A.spectralFlux(pcm);
  const onsets = A.detectOnsets(flux, { sampleRate: A.DEFAULT_ANALYSIS_SR });
  assert.ok(onsets.length >= 10, `onset 数量过少: ${onsets.length}`);
  const bpm = A.estimateBpm(onsets);
  assert.ok(bpm !== null);
  assert.ok(Math.abs(bpm - 120) <= 2, `期望 ~120，实际 ${bpm}`);
});

test('estimateBpm: 合成 128 BPM 信号', () => {
  const pcm = makeBeatSignal(128, 12);
  const flux = A.spectralFlux(pcm);
  const onsets = A.detectOnsets(flux, { sampleRate: A.DEFAULT_ANALYSIS_SR });
  const bpm = A.estimateBpm(onsets);
  assert.ok(bpm !== null);
  assert.ok(Math.abs(bpm - 128) <= 2, `期望 ~128，实际 ${bpm}`);
});

test('analyze: 端到端识别合成信号', () => {
  const pcm = makeBeatSignal(140, 10);
  const r = A.analyze(pcm, { sampleRate: A.DEFAULT_ANALYSIS_SR });
  assert.ok(r.bpm !== null);
  assert.ok(Math.abs(r.bpm - 140) <= 2, `期望 ~140，实际 ${r.bpm}`);
});

test('estimateBpmCands: 等间隔信号返回半值竞争层候选（harm=0.5x）', () => {
  // 纯 200 BPM 整拍：半拍（0.6s = 100 BPM）配对同样密集 → 候选应含 100（0.5x）
  const onsets = Array.from({ length: 41 }, (_, i) => i * 0.3);
  const r = A.estimateBpmCands(onsets, { minBpm: 60, maxBpm: 200 });
  assert.ok(r.bpm != null);
  // 等间隔信号下 gridCost 细化会将主峰推向平坦区（192-201 均合法），核心断言是半值层
  assert.ok(r.bpm > 189 && r.bpm < 202, '主峰应 ≈200，实际 ' + r.bpm);
  const half = r.cands.find((c) => c.harm === '0.5x');
  assert.ok(half, '候选应含半值层（harm 0.5x），实际 ' + JSON.stringify(r.cands.map((c) => c.bpm)));
  assert.ok(Math.abs(half.bpm - 100) < 3, '半值层应 ≈100，实际 ' + half.bpm);
});

test('estimateBpmCands: 与 estimateBpm 主选一致（同一输入）', () => {
  const onsets = [];
  for (let i = 0; i < 40; i++) onsets.push(i * 0.45 + (i % 3) * 0.01); // ≈133 BPM 微抖动
  const r = A.estimateBpmCands(onsets, { minBpm: 60, maxBpm: 200 });
  assert.equal(A.estimateBpm(onsets, { minBpm: 60, maxBpm: 200 }), r.bpm, '主选与旧接口一致');
  assert.ok(r.bpm > 125 && r.bpm < 140, '主峰应 ≈133，实际 ' + r.bpm);
});

test('estimateBpmCands: onset 不足返回空候选', () => {
  const r = A.estimateBpmCands([0, 0.5, 1.0], {});
  assert.equal(r.bpm, null);
  assert.deepEqual(r.cands, []);
});

test('buildGrid: 120 BPM 4/4 小节边界', () => {
  const g = A.buildGrid({
    segments: [{ bpm: 120, beatsPerBar: 4, bars: 10 }],
    offset: 0,
    duration: 20,
  });
  assert.equal(g.segments[0].barDur, 2.0);
  assert.equal(g.segments[0].beatDur, 0.5);
  assert.equal(g.bars[0].barNumber, 1);
  assert.equal(g.bars[0].startTime, 0);
  assert.equal(g.bars[0].endTime, 2.0);
  assert.equal(g.bars[1].startTime, 2.0);
  assert.equal(g.bars.length, 10);
  // 每小节 4 拍
  assert.ok(g.beatTimes.length >= 40);
});

test('buildGrid: 偏移与 3/4 拍号', () => {
  const g = A.buildGrid({
    segments: [{ bpm: 120, beatsPerBar: 3, bars: 6 }],
    offset: 1,
    duration: 10,
  });
  assert.equal(g.segments[0].barDur, 1.5);
  assert.equal(g.bars[0].barNumber, 1);
  assert.equal(g.bars[0].startTime, 1.0);
  // 负偏移：第 1 段起点在音频前，小节 1 起点 < 0
  const g2 = A.buildGrid({
    segments: [{ bpm: 120, beatsPerBar: 4, bars: 4 }],
    offset: -0.5,
    duration: 5,
  });
  assert.equal(g2.bars[0].startTime, -0.5);
});

test('buildGrid: 多段衔接与连续编号', () => {
  const g = A.buildGrid({
    segments: [
      { bpm: 120, beatsPerBar: 4, bars: 4 }, // 0-8s，小节 1-4
      { bpm: 90, beatsPerBar: 3, bars: 2 },  // 8-12s，小节 5-6
      { bpm: 150, beatsPerBar: 4, durationSec: 3 }, // 12-15s，无小节（时长模式）
    ],
    offset: 0,
    duration: 15,
  });
  assert.equal(g.segments.length, 3);
  assert.equal(g.segments[1].startTime, 8);
  assert.equal(g.segments[1].barDur, 60 / 90 * 3);
  assert.equal(g.bars[4].barNumber, 5); // 跨段连续编号
  assert.equal(g.bars[4].startTime, 8);
  assert.equal(g.segments[2].startTime, 12);
  assert.equal(g.segments[2].bars.length, 2); // 时长模式段按小节切分（150BPM 4/4：barDur 1.6s，3s → 2 小节）
  assert.equal(g.bars[6].barNumber, 7); // 时长模式段小节连续编号
});

test('buildGrid: 细分拍线', () => {
  const g = A.buildGrid({
    segments: [{ bpm: 120, beatsPerBar: 4, bars: 1, resolution: 16 }],
    offset: 0,
    duration: 2,
  });
  // 1 小节 2s，分辨率 16（每小节 16 条线）→ 16 条线 + 起点
  assert.ok(g.beatTimes.length >= 16);
});

test('buildGrid: 非法参数抛错', () => {
  assert.throws(() => A.buildGrid({ segments: [{ bpm: 0, beatsPerBar: 4, bars: 2 }], offset: 0, duration: 10 }));
  assert.throws(() => A.buildGrid({ segments: [], offset: 0, duration: 10 }));
  assert.throws(() => A.buildGrid({ segments: [{ bpm: 120, beatsPerBar: 4 }], offset: 0, duration: 10 }));
});

test('resample: 长度与端点保持', () => {
  const src = new Float32Array([0, 1, 0, -1]);
  const out = A.resample(src, 4, 8);
  assert.equal(out.length, 8);
  assert.equal(out[0], 0);
  assert.equal(out[out.length - 1], -1);
  const same = A.resample(src, 4, 4);
  assert.deepEqual(same, src);
});

test('toMono: 双声道平均', () => {
  const l = new Float32Array([0.5, -0.5]);
  const r = new Float32Array([-0.5, 0.5]);
  const m = A.toMono([l, r]);
  assert.ok(Math.abs(m[0]) < 1e-6 && Math.abs(m[1]) < 1e-6);
});

test('resolveSegments: 末段自动延伸', () => {
  const segs = A.resolveSegments([{ bpm: 120, beatsPerBar: 4, bars: 4 }, { bpm: 90, beatsPerBar: 3 }], 16);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].bars, 4);
  // 前段 4 小节 × 2s = 8s，剩余 8s，90BPM 3/4 → barDur 2s → 4 小节
  assert.equal(segs[1].bars, 4);
});

test('resolveSegments: 时长模式段', () => {
  const segs = A.resolveSegments([{ bpm: 120, beatsPerBar: 4, durationSec: 3.5 }], 10);
  assert.equal(segs[0].durationSec, 3.5);
});

test('resolveSegments: 中间段缺长度报错', () => {
  assert.throws(() =>
    A.resolveSegments(
      [{ bpm: 120, beatsPerBar: 4 }, { bpm: 90, beatsPerBar: 3, bars: 2 }],
      10
    )
  );
});

test('resolveSegments: 缺 BPM 报错', () => {
  assert.throws(() => A.resolveSegments([{ beatsPerBar: 4, bars: 2 }], 10));
});

test('rmsOf: RMS 能量计算', () => {
  assert.equal(A.rmsOf(new Float32Array([0, 0, 0, 0])), 0);
  assert.ok(Math.abs(A.rmsOf(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
  assert.ok(Math.abs(A.rmsOf(new Float32Array([0.5, -0.5])) - 0.5) < 1e-9);
  // 静音接近 0（float 噪声级），低于预检阈值 1e-4
  assert.ok(A.rmsOf(new Float32Array(4096)) < 1e-4);
});

test('scoreNear: 双指针与二分 hasNear 全 lag 一致（P3）', () => {
  // 随机合成有序 onset（带抖动），双指针 scoreNear vs 二分参考全 lag 对比
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sample = [];
  let t = 0;
  while (t < 30) {
    sample.push(t);
    t += 0.4 + rnd() * 0.2; // 约 0.4-0.6s 间隔，带抖动
  }
  const sorted = Float64Array.from(sample).sort();
  const hasNear = (tt) => {
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < tt - 0.03) lo = mid + 1;
      else if (sorted[mid] > tt + 0.03) hi = mid - 1;
      else return true;
    }
    return false;
  };
  const scoreBinary = (lag) => {
    let score = 0;
    for (let k = 0; k < sample.length; k++) if (hasNear(sample[k] + lag)) score++;
    return score;
  };
  // 全 lag 扫描（0.3-1.0s，0.002 步长，覆盖 estimateBpm 的滞后范围）
  for (let lag = 0.3; lag <= 1.0 + 1e-9; lag += 0.002) {
    assert.equal(A.scoreNear(sorted, sample, lag), scoreBinary(lag), `lag=${lag.toFixed(3)}`);
  }
});
