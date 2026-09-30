/**
 * test_unit_mixin.js — 序列项双语义（小节/格 ↔ 时间）单元测试。
 * 创建时间：2026-08-26
 * 运行：node --test tests/test_unit_mixin.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/sequence.js');
const A = require('../src/analysis.js');

const GRID = A.buildGrid({
  segments: A.resolveSegments([{ bpm: 120, beatsPerBar: 4, beatUnit: 4, resolution: 4 }], 30),
  offset: 0,
  duration: 30,
}); // barDur=2s, step=0.5s(每小节4格)

test('createItem: 底层小节/格 + 派生时间缓存', () => {
  const it = S.createItem(GRID, 2, 3); // 第 2–3 小节 → 2s–6s
  assert.equal(it.mode, 'bars');
  assert.equal(it.startBar, 2);
  assert.equal(it.endBar, 3);
  assert.equal(it.startCell, 1);
  assert.equal(it.endCell, 4, '末格 = 分辨率');
  assert.equal(it.startTime, 2);
  assert.equal(it.endTime, 6);
});

test('syncItemTimes: bars 模式格级端点（第 2 小节第 3 格起）', () => {
  const it = { mode: 'bars', startBar: 2, startCell: 3, endBar: 3, endCell: 2 };
  S.syncItemTimes(it, GRID);
  // 第 2 小节起点=2s，第 3 格 = 2+2*0.5=3s；第 3 小节第 2 格末尾 = 4+2*0.5=5s
  assert.equal(it.startTime, 3);
  assert.equal(it.endTime, 5);
});

test('syncItemTimes: time 模式派生小节/格显示', () => {
  const it = { mode: 'time', startTime: 3.2, endTime: 5.3 };
  S.syncItemTimes(it, GRID);
  assert.equal(it.startBar, 2);
  assert.equal(it.startCell, 3, '3.2s 在第 2 小节第 3 格');
  assert.equal(it.endBar, 3);
  assert.equal(it.endCell, 3, '5.3s 在第 3 小节第 3 格(终点含端点)');
});

test('resyncGridItems: BPM 变化后音乐单位段随动（时间重算）', () => {
  const it = S.createItem(GRID, 1, 2);
  assert.equal(it.startTime, 0);
  assert.equal(it.endTime, 4);
  // 网格 BPM 改为 90：barDur = 60/90*4 = 2.6667s
  const grid90 = A.buildGrid({
    segments: A.resolveSegments([{ bpm: 90, beatsPerBar: 4, beatUnit: 4, resolution: 4 }], 30),
    offset: 0,
    duration: 30,
  });
  S.resyncGridItems([it], grid90);
  assert.ok(Math.abs(it.startTime - 0) < 1e-9);
  assert.ok(Math.abs(it.endTime - 2 * 2.6666666666666665) < 1e-6, '第 2 小节随新 BPM 移动: ' + it.endTime);
  // time 模式：内容锚定不随动，派生小节显示更新
  const t = { mode: 'time', startTime: 0.5, endTime: 3.5 };
  S.resyncGridItems([t], grid90);
  assert.equal(t.startTime, 0.5);
  assert.equal(t.endTime, 3.5);
  assert.ok(t.startBar >= 1 && t.endBar >= 1, '派生小节仍存在');
});
