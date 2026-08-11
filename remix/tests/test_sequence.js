/**
 * test_sequence.js — 段落序列与吸附测试（node --test）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/analysis.js');
const S = require('../src/sequence.js');

function grid() {
  return A.buildGrid({
    segments: [{ bpm: 120, beatsPerBar: 4, bars: 12 }],
    offset: 0,
    duration: 20,
  });
}

test('snapRange: 分段网格吸附', () => {
  // 两段：120 BPM 4/4 前 4 小节（0-8s），90 BPM 3/4 后 4 小节（8-16s）
  const g2 = A.buildGrid({
    segments: [
      { bpm: 120, beatsPerBar: 4, bars: 4 },
      { bpm: 90, beatsPerBar: 3, bars: 4 },
    ],
    offset: 0,
    duration: 16,
  });
  // 段 2 小节：8.0, 10.0, 12.0, 14.0
  assert.deepEqual(S.snapRange(g2, 8.1, 10.1), { startBar: 5, endBar: 6 }); // 10.1 覆盖小节 6 一点
  assert.deepEqual(S.snapRange(g2, 8.0, 12.1), { startBar: 5, endBar: 7 }); // 12.1 覆盖小节 7 一点
  assert.deepEqual(S.snapRange(g2, 0.1, 15.9), { startBar: 1, endBar: 8 });
});

test('snapRange: 基本吸附', () => {
  const g = grid();
  assert.deepEqual(S.snapRange(g, 0.1, 2.3), { startBar: 1, endBar: 2 }); // 2.3 覆盖小节 2 一点
  assert.deepEqual(S.snapRange(g, 0.0, 4.1), { startBar: 1, endBar: 3 }); // 4.1 覆盖小节 3 一点
  assert.deepEqual(S.snapRange(g, 4.5, 8.2), { startBar: 3, endBar: 5 }); // 8.2 覆盖小节 5 一点
  assert.deepEqual(S.snapRange(g, 12, 20), { startBar: 7, endBar: 10 });
});

test('snapRange: 跨小节边界部分覆盖即选', () => {
  const g = grid();
  // 1.9-2.1 跨 2s 边界：小节 1 覆盖 0.1s、小节 2 覆盖 0.1s → 都应选中
  assert.deepEqual(S.snapRange(g, 1.9, 2.1), { startBar: 1, endBar: 2 });
  // 恰在小节内极短拖拽
  assert.deepEqual(S.snapRange(g, 1.1, 1.2), { startBar: 1, endBar: 1 });
  // 双击边界（t0 === t1 在 2.0）→ 取右侧小节
  assert.deepEqual(S.snapRange(g, 2.0, 2.0), { startBar: 2, endBar: 2 });
});

test('snapRange: 越界 clamp', () => {
  const g = grid();
  const r = S.snapRange(g, -5, 100);
  assert.ok(r.startBar >= 1 && r.endBar <= 12);
});

test('createItem: 小节范围 → 时间', () => {
  const g = grid();
  const it = S.createItem(g, 1, 2);
  assert.equal(it.startTime, 0);
  assert.equal(it.endTime, 4);
  assert.equal(it.fadeInMs, 0);
  const it2 = S.createItem(g, 3, 3);
  assert.equal(it2.startTime, 4);
  assert.equal(it2.endTime, 6);
});

test('createItem: 超出范围返回 null', () => {
  const g = grid();
  assert.equal(S.createItem(g, 99, 100), null);
});

test('itemToPart: 毫秒 → 样本', () => {
  const g = grid();
  const it = S.createItem(g, 1, 2, 100, 200);
  const part = S.itemToPart(it, 44100);
  assert.equal(part.start, 0);
  assert.equal(part.end, 4 * 44100);
  assert.equal(part.fadeIn, Math.round(0.1 * 44100));
  assert.equal(part.fadeOut, Math.round(0.2 * 44100));
});

test('totalDuration: 序列总时长', () => {
  const g = grid();
  const items = [S.createItem(g, 1, 2), S.createItem(g, 5, 6)];
  assert.equal(S.totalDuration(items), 8);
  assert.equal(S.itemDuration(items[0]), 4);
});

test('时间↔小节/格换算', () => {
  const barDur = 0.5;
  const grid = {
    bars: [1, 2, 3, 4, 5, 6].map((n) => ({ barNumber: n, startTime: (n - 1) * barDur, endTime: n * barDur })),
    segments: [
      { bars: [1, 2, 3, 4].map((n) => ({ barNumber: n })), resolution: 4 },
      { bars: [5, 6].map((n) => ({ barNumber: n })), resolution: 8 },
    ],
  };
  const cases = [
    [0.0, 1, 1], [0.124, 1, 1], [0.125, 1, 2], [0.499, 1, 4],
    [0.5, 2, 1], [2.0, 5, 1], [2.0625, 5, 2], [2.49, 5, 8], [2.5, 6, 1],
  ];
  for (const [t, bar, cell] of cases) {
    const bc = S.timeToBarCell(grid, t);
    assert.ok(bc && bc.bar === bar && bc.cell === cell, 't=' + t + ' → ' + bar + '/' + cell + ' got ' + JSON.stringify(bc));
  }
  for (const [bar, cell] of [[1, 1], [1, 4], [5, 1], [6, 8]]) {
    const [st] = S.barCellToTime(grid, bar, cell);
    const bc = S.timeToBarCell(grid, st);
    assert.ok(bc && bc.bar === bar && bc.cell === cell, 'roundtrip ' + bar + '/' + cell);
  }
  assert.ok(S.timeToBarCell(grid, -0.1) === null, 'negative → null');
  assert.ok(S.timeToBarCell(grid, 3.5) === null, 'beyond → null');
});

test('时长↔小节/格换算', () => {
  const dc = S.durationToBarCell(1.25, 0.5, 0.125);
  assert.deepEqual(dc, { bars: 2, cells: 2 });
  assert.ok(Math.abs(S.barCellToDuration(2, 2, 0.5, 0.125) - 1.25) < 1e-9);
  // 溢出格进位
  const c = S.durationToBarCell(0.48, 0.5, 0.125); // 3.84 格 → 4 格进位
  assert.deepEqual(c, { bars: 1, cells: 0 });
});

test('网格末尾边界归属最后一格', () => {
  const barDur = 0.5;
  const grid = {
    bars: [1, 2, 3].map((n) => ({ barNumber: n, startTime: (n - 1) * barDur, endTime: n * barDur })),
    segments: [{ bars: [1, 2, 3].map((n) => ({ barNumber: n })), resolution: 4 }],
  };
  const bc = S.timeToBarCell(grid, 1.5);
  assert.deepEqual(bc, { bar: 3, cell: 4 });
  assert.ok(S.timeToBarCell(grid, 1.51) === null);
});

test('终点含边界换算 timeToBarCellEnd', () => {
  const barDur = 0.5;
  const grid = {
    bars: [1, 2, 3].map((n) => ({ barNumber: n, startTime: (n - 1) * barDur, endTime: n * barDur })),
    segments: [{ bars: [1, 2, 3].map((n) => ({ barNumber: n })), resolution: 4 }],
  };
  // 格 2 区间终点（= 格 3 起点）应归格 2，避免终点编辑显示 +1
  assert.deepEqual(S.timeToBarCellEnd(grid, 0.25), { bar: 1, cell: 2 });
  // 小节末尾归该小节最后一格
  assert.deepEqual(S.timeToBarCellEnd(grid, 0.5), { bar: 1, cell: 4 });
  // 网格末尾归最后一格
  assert.deepEqual(S.timeToBarCellEnd(grid, 1.5), { bar: 3, cell: 4 });
  // 超出网格 → null
  assert.ok(S.timeToBarCellEnd(grid, 1.51) === null);
  // 与 timeToBarCell 的差异：同一边界时间归属不同
  // 差异：timeToBarCell 边界归下一格（格 3），timeToBarCellEnd 归当前格（格 2）——修复终点编辑 +1 的关键
  assert.deepEqual(S.timeToBarCell(grid, 0.25), { bar: 1, cell: 3 });
});
