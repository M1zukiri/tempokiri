/**
 * test_render.js — 波形渲染正确性与性能特征测试（node --test）。
 *
 * 用 mock 2D context 验证：
 *   - draw 的网格线/小节线/时间轴刻度使用批量 path（一次 beginPath → 一次 stroke），
 *     避免每小节/每刻度一次绘制调用（缩放性能优化 A2）；
 *   - 视口外的小节线/刻度被裁剪（不产生 path 点）；
 *   - 帧合并逻辑独立函数（main.js 内联，此处验证 render 侧不变式）。
 */
// draw 使用 window.devicePixelRatio，Node 环境注入
global.window = { devicePixelRatio: 1 };

const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/render.js');

/** 记录调用序列的 mock 2D context。 */
function mockCtx() {
  const calls = [];
  const ctx = {
    calls,
    strokeCount: 0,
    beginPathCount: 0,
    moveTos: 0,
    fillTexts: 0,
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 1,
    font: '',
    textAlign: '',
    setLineDash() {},
    fillRect() {},
    clearRect() {},
    setTransform() {},
    beginPath() { this.beginPathCount++; calls.push('beginPath'); },
    moveTo() { this.moveTos++; calls.push('moveTo'); },
    lineTo() { calls.push('lineTo'); },
    stroke() { this.strokeCount++; calls.push('stroke'); },
    fillText() { this.fillTexts++; calls.push('fillText'); },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return ctx;
}

function fakeCanvas(ctx, cssW = 800, cssH = 300) {
  return {
    clientWidth: cssW,
    clientHeight: cssH,
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
}

function makeGrid() {
  const bars = [];
  const beatTimes = [];
  for (let b = 1; b <= 100; b++) {
    const startTime = (b - 1) * 2;
    bars.push({ barNumber: b, startTime, endTime: startTime + 2 });
    for (let k = 0; k < 4; k++) beatTimes.push(startTime + k * 0.5);
  }
  return { bars, beatTimes };
}

test('draw: 小节线与时间轴刻度使用批量 path（性能 A2）', () => {
  const ctx = mockCtx();
  const canvas = fakeCanvas(ctx);
  const view = { start: 0, end: 200 }; // 100 小节全部可见
  R.draw(canvas, view, {
    pcm: null,
    peaks: null,
    sampleRate: 22050,
    grid: makeGrid(),
  });
  // 波形为空时不画波形；小节线批量：一次 beginPath 一次 stroke
  // 但节拍线也是一次 beginPath+stroke，小节线也是一次，所以 beginPath >= 2
  assert.ok(ctx.beginPathCount >= 2, '网格应至少 2 组 path（节拍线 + 小节线）');
  // 关键不变式：stroke 次数远小于可见小节数（若每小节一次 stroke 则 >= 100）
  assert.ok(ctx.strokeCount < 30, 'stroke 次数应远小于小节数（批量合并）');
});

test('draw: 视口外的小节线被裁剪（不产生 path 点）', () => {
  const ctx = mockCtx();
  const canvas = fakeCanvas(ctx);
  // 视口只看 40–60s（第 21–30 小节），其余 90 小节应被裁剪
  const view = { start: 40, end: 60 };
  R.draw(canvas, view, {
    pcm: null,
    peaks: null,
    sampleRate: 22050,
    grid: makeGrid(),
  });
  // 节拍线 moveTo 数 ≈ 可见节拍（20s / 0.5 = 40 + 边界）
  // 小节线 moveTo 数 ≈ 可见小节（10 + 边界 ±1）
  // 若未裁剪：节拍 800+ 次、小节 100 次
  assert.ok(ctx.moveTos < 120, '裁剪后 path 点应远小于全量（实测 ' + ctx.moveTos + '）');
});

test('draw: 无 grid 时正常绘制（不抛错）', () => {
  const ctx = mockCtx();
  const canvas = fakeCanvas(ctx);
  assert.doesNotThrow(() => {
    R.draw(canvas, { start: 0, end: 10 }, { pcm: null, peaks: null, sampleRate: 22050, grid: null });
  });
});

test('buildPeaks: 金字塔各级长度与 min/max 正确', () => {
  const n = 1000;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.sin(i / 10);
  const peaks = R.buildPeaks(pcm);
  assert.ok(peaks.mins.length >= 2, '应有多级金字塔');
  assert.equal(peaks.baseBucket, 64);
  const level0 = peaks.mins[0];
  assert.equal(level0.length, Math.ceil(n / 64));
  // 每桶 min <= 该桶内样本最小值（抽样验证）
  const bucket = 64;
  let min = Infinity;
  for (let i = 0; i < bucket; i++) min = Math.min(min, pcm[i]);
  assert.ok(level0[0] <= min + 1e-9);
});
