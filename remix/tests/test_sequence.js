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
