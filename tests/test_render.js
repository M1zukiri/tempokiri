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
    shadowGlowUsed: false,
    _shadowBlur: 0,
    get shadowBlur() { return this._shadowBlur; },
    set shadowBlur(v) { this._shadowBlur = v; if (v > 0) this.shadowGlowUsed = true; },
    clearRect() { calls.push('clearRect'); },
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 1,
    font: '',
    textAlign: '',
    setLineDash() {},
    fillRect() {},
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

test('drawPlayHead: 清空 + 视口外不画 + 视口内画线', () => {
  const ctx = mockCtx();
  const canvas = fakeCanvas(ctx);
  const view = { start: 0, end: 16 };
  // playTime null → 只清空不画线
  R.drawPlayHead(canvas, view, null);
  const afterNull = { strokes: ctx.strokeCount, clears: ctx.calls.filter((c) => c === 'clearRect').length };
  // 视口外 → 不画线
  const ctx2 = mockCtx();
  const canvas2 = fakeCanvas(ctx2);
  R.drawPlayHead(canvas2, view, 99);
  const afterOut = { strokes: ctx2.strokeCount, clears: ctx2.calls.filter((c) => c === 'clearRect').length };
  // 视口内 → 画一条线
  const ctx3 = mockCtx();
  const canvas3 = fakeCanvas(ctx3);
  R.drawPlayHead(canvas3, view, 8);
  const afterIn = { strokes: ctx3.strokeCount, moveTos: ctx3.moveTos };
  assert.equal(afterNull.strokes, 0);
  assert.equal(afterNull.clears, 1);
  assert.equal(afterOut.strokes, 0);
  assert.equal(afterIn.strokes, 1);
  assert.equal(afterIn.moveTos, 1);
});

test('draw: 波形描边不使用 shadowBlur 光晕（性能 A1）', () => {
  const ctx = mockCtx();
  const canvas = fakeCanvas(ctx);
  const pcm = new Float32Array(6400);
  for (let i = 0; i < 6400; i++) pcm[i] = Math.sin(i / 20);
  const peaks = R.buildPeaks(pcm);
  R.draw(canvas, { start: 0, end: 10 }, { pcm, peaks, sampleRate: 22050, grid: null });
  assert.equal(ctx.shadowGlowUsed, false, '波形描边不应设置 shadowBlur > 0');
});

test('drawPlayHead: 播放线不使用 shadowBlur 光晕（性能 A2）', () => {
  const ctx = mockCtx();
  const canvas = fakeCanvas(ctx);
  R.drawPlayHead(canvas, { start: 0, end: 16 }, 8);
  assert.equal(ctx.shadowGlowUsed, false, '播放线不应设置 shadowBlur > 0');
});

test('bucketIndexStep: 步长索引与朴素除法等价（性能 A5）', () => {
  const sr = 22050;
  for (let trial = 0; trial < 60; trial++) {
    const start = Math.random() * 100;
    const view = { start, end: start + 1 + Math.random() * 500 };
    const bucket = 64 * Math.pow(2, Math.floor(Math.random() * 4));
    const cssW = 200 + Math.floor(Math.random() * 1800);
    const c = R.bucketIndexStep(view, sr, bucket, cssW);
    const xs = [0, 1, Math.floor(cssW / 2), cssW - 1];
    for (let i = 0; i < 20; i++) xs.push(Math.floor(Math.random() * cssW));
    for (const x of xs) {
      if (x < 0 || x >= cssW) continue;
      const naive = Math.floor((view.start + (x / cssW) * (view.end - view.start)) * sr / bucket);
      const fast = Math.floor((c.start + x * c.step) * c.k);
      assert.ok(Math.abs(fast - naive) <= 1, `trial=${trial} x=${x}: fast=${fast} naive=${naive}`);
    }
  }
});

test('bucketIndexStep: 索引随像素单调不减（波形正确性不变量）', () => {
  const sr = 22050;
  const view = { start: 3.7, end: 240 };
  const bucket = 128;
  const cssW = 1200;
  const c = R.bucketIndexStep(view, sr, bucket, cssW);
  let prev = -Infinity;
  for (let x = 0; x < cssW; x++) {
    const idx = Math.floor((c.start + x * c.step) * c.k);
    assert.ok(idx >= prev, `x=${x}: idx=${idx} < prev=${prev}`);
    prev = idx;
  }
});

test('lowerBound/upperBound: 二分边界正确（性能 A4）', () => {
  const a = [1, 3, 3, 5, 7, 9];
  assert.equal(R.lowerBound(a, 0), 0);
  assert.equal(R.lowerBound(a, 1), 0);
  assert.equal(R.lowerBound(a, 3), 1, '第一个 >= 3 是索引 1');
  assert.equal(R.lowerBound(a, 4), 3, '第一个 >= 4 是索引 3');
  assert.equal(R.lowerBound(a, 10), 6, '越界 → length');
  assert.equal(R.upperBound(a, 3), 3, '第一个 > 3 是索引 3');
  assert.equal(R.upperBound(a, 9), 6);
  assert.equal(R.upperBound(a, 0), 0);
  assert.equal(R.lowerBound([], 1), 0);
  assert.equal(R.upperBound([], 1), 0);
});

test('lowerBoundBars/upperBoundBars: 小节按 startTime 二分正确（性能 A4）', () => {
  const bars = [0, 2, 4, 6, 8].map((s) => ({ startTime: s, barNumber: s / 2 + 1 }));
  assert.equal(R.lowerBoundBars(bars, 0), 0);
  assert.equal(R.lowerBoundBars(bars, 3), 2, '第一个 startTime >= 3 是 4');
  assert.equal(R.lowerBoundBars(bars, 8), 4);
  assert.equal(R.lowerBoundBars(bars, 9), 5, '越界 → length');
  assert.equal(R.upperBoundBars(bars, 4), 3, '第一个 > 4 是 6');
  assert.equal(R.upperBoundBars(bars, 8), 5);
});

test('draw 网格: 二分裁剪与线性筛选区间一致（性能 A4 等价性）', () => {
  // 500 小节、2000 节拍，随机 view 对比二分区间与线性筛选
  const bars = [];
  const beatTimes = [];
  for (let b = 1; b <= 500; b++) {
    const st = (b - 1) * 2;
    bars.push({ barNumber: b, startTime: st, endTime: st + 2 });
    for (let k = 0; k < 4; k++) beatTimes.push(st + k * 0.5);
  }
  for (let trial = 0; trial < 40; trial++) {
    const start = Math.random() * 500;
    const view = { start, end: start + 1 + Math.random() * 200 };
    const margin = (20 / 800) * (view.end - view.start);
    // 节拍：线性筛选可见索引
    const linearBeat = [];
    for (let i = 0; i < beatTimes.length; i++) {
      if (beatTimes[i] >= view.start && beatTimes[i] <= view.end) linearBeat.push(i);
    }
    const bLo = R.lowerBound(beatTimes, view.start);
    const bHi = R.upperBound(beatTimes, view.end);
    assert.deepEqual(
      Array.from({ length: bHi - bLo }, (_, k) => bLo + k),
      linearBeat,
      `trial=${trial} 节拍二分区间应与线性筛选一致`
    );
    // 小节：线性筛选可见索引
    const linearBar = [];
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].startTime >= view.start - margin && bars[i].startTime <= view.end + margin) linearBar.push(i);
    }
    const sLo = R.lowerBoundBars(bars, view.start - margin);
    const sHi = R.upperBoundBars(bars, view.end + margin);
    assert.deepEqual(
      Array.from({ length: sHi - sLo }, (_, k) => sLo + k),
      linearBar,
      `trial=${trial} 小节二分区间应与线性筛选一致`
    );
  }
});

test('playHeadMoved: 播放线像素阈值（性能 A6）', () => {
  assert.equal(R.playHeadMoved(null, 100), true, '首次（无上一位置）应重绘');
  assert.equal(R.playHeadMoved(100, 100.5), false, '位移 0.5px 不重绘');
  assert.equal(R.playHeadMoved(100, 99.2), false, '位移 0.8px 不重绘');
  assert.equal(R.playHeadMoved(100, 101), true, '位移 1px 重绘');
  assert.equal(R.playHeadMoved(100, 99), true, '位移 -1px 重绘');
  assert.equal(R.playHeadMoved(100, 150), true, '大位移重绘');
});

test('setTheme: 切换 canvas 主题色并回退未知主题（主题系统）', () => {
  // 先记录 aurora 基准（默认态），测完恢复避免污染其他用例
  R.setTheme('aurora');
  assert.equal(R.THEME.wave, '#22d3ee');
  R.setTheme('nebula');
  assert.equal(R.THEME.wave, '#a78bfa');
  assert.equal(R.THEME.bg, 'transparent');
  R.setTheme('paper');
  assert.equal(R.THEME.bg, 'transparent');
  assert.equal(R.THEME.wave, '#0f766e');
  R.setTheme('unknown-theme');
  assert.equal(R.THEME.wave, '#22d3ee', '未知主题应回退 aurora');
  R.setTheme('aurora'); // 恢复默认，避免污染后续用例
});

test('CANVAS_THEMES: 三套主题各含 12 个绘制字段（主题系统）', () => {
  const fields = ['bg', 'gridBg', 'wave', 'waveHigh', 'waveDim', 'barLine', 'beatLine', 'selFill', 'selBorder', 'playLine', 'axis', 'barLabel'];
  for (const name of ['aurora', 'nebula', 'paper']) {
    assert.ok(R.CANVAS_THEMES[name], '缺少主题：' + name);
    for (const f of fields) {
      assert.ok(R.CANVAS_THEMES[name][f], `${name}.${f} 缺失`);
    }
  }
  // aurora 与默认 THEME 完全一致（默认主题行为零变化）
  assert.deepEqual(R.CANVAS_THEMES.aurora, {
    bg: 'transparent', gridBg: 'transparent', wave: '#22d3ee', waveHigh: '#38e1f5',
    waveDim: 'rgba(34,211,238,0.45)', barLine: 'rgba(255,255,255,0.75)',
    beatLine: 'rgba(255,255,255,0.14)', selFill: 'rgba(34,211,238,0.22)',
    selBorder: '#22d3ee', playLine: '#f43f5e', axis: '#7d8794', barLabel: '#9aa4b2',
  });
});
