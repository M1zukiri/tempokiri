/**
 * test_metronome.js — 节拍器纯逻辑单元测试（node --test）。
 * 创建时间：2026-08-26
 * 运行：node --test tests/test_metronome.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/metronome.js');

const SEG_44_120 = { startTime: 0, endTime: 8, bpm: 120, beatsPerBar: 4, beatUnit: 4, barDur: 2 };
const SEG_68_120 = { startTime: 0, endTime: 8, bpm: 120, beatsPerBar: 6, beatUnit: 8, barDur: 3 };

test('clickInterval: 音符单位换算（4/4 与 6/8）', () => {
  // 4/4 @120：一拍=0.5s；四分音符一拍一点；八分音符每 0.25s 一点
  assert.equal(M.clickInterval(SEG_44_120, 4), 0.5);
  assert.equal(M.clickInterval(SEG_44_120, 8), 0.25);
  assert.equal(M.clickInterval(SEG_44_120, 2), 1.0);
  assert.equal(M.clickInterval(SEG_44_120, 16), 0.125);
  // 6/8 @120：一拍（八分）=0.5s；noteUnit=8 一拍一点；noteUnit=4 每 1s 一点
  assert.equal(M.clickInterval(SEG_68_120, 8), 0.5);
  assert.equal(M.clickInterval(SEG_68_120, 4), 1.0);
});

test('noteUnitDefault: 默认取拍号分母（4/4→4，6/8→8），显式值优先', () => {
  assert.equal(M.noteUnitDefault(SEG_44_120, 0), 4);
  assert.equal(M.noteUnitDefault(SEG_68_120, 0), 8);
  assert.equal(M.noteUnitDefault({}, 0), 4);
  assert.equal(M.noteUnitDefault(SEG_44_120, 8), 8);
});

test('segmentAt: 时间定位段与网格前后回退', () => {
  const segs = [
    { startTime: 0, endTime: 4, bpm: 120, barDur: 2 },
    { startTime: 4, endTime: 8, bpm: 90, barDur: 2.6667 },
  ];
  assert.equal(M.segmentAt(segs, 1.5), segs[0]);
  assert.equal(M.segmentAt(segs, 4.0), segs[1]);
  assert.equal(M.segmentAt(segs, -0.5), segs[0], '网格前回退首段');
  assert.equal(M.segmentAt(segs, 99), segs[1], '网格后回退末段');
  assert.equal(M.segmentAt([], 1), null);
});

test('nextClick: 拍点与重音对齐小节线（4/4 @120）', () => {
  const segs = [SEG_44_120];
  // 拍点：0.5, 1.0, 1.5, 2.0（小节起点，重音）……
  assert.deepEqual(M.nextClick(segs, 0.1), { t: 0.5, accent: false });
  assert.deepEqual(M.nextClick(segs, 0.9), { t: 1.0, accent: false });
  assert.deepEqual(M.nextClick(segs, 1.9), { t: 2.0, accent: true }, '小节起点重音');
  assert.deepEqual(M.nextClick(segs, 2.4), { t: 2.5, accent: false });
  // t 恰在拍点：返回下一拍
  assert.deepEqual(M.nextClick(segs, 0.5), { t: 1.0, accent: false });
});

test('nextClick: 跨段时下一拍落在段边界（重音）', () => {
  const segs = [
    { startTime: 0, endTime: 3.5, bpm: 120, beatsPerBar: 4, beatUnit: 4, barDur: 2 },
    { startTime: 3.5, endTime: 7, bpm: 90, beatsPerBar: 4, beatUnit: 4, barDur: 2.6667 },
  ];
  const n = M.nextClick(segs, 3.4);
  assert.equal(n.t, 3.5, '下一拍 = 下一段起点');
  assert.equal(n.accent, true);
});

test('nextClick: 无网格返回 null', () => {
  assert.equal(M.nextClick(null, 1, 4), null);
  assert.equal(M.nextClick([], 1, 4), null);
});

test('nextClickInSilent: 静音段音乐单位拍点合成（2 小节 @120）', () => {
  const it = { silent: true, unit: 'bar', qty: 2, bpm: 120, beatsPerBar: 4, beatUnit: 4, durationSec: 4 };
  // 段起点(0s)重音，每 0.5s 一拍，2s 处（小节边界）重音，4s 后无拍点
  assert.deepEqual(M.nextClickInSilent(it, 0, -1e-6, 4), { t: 0, accent: true });
  assert.deepEqual(M.nextClickInSilent(it, 0, 0.1, 4), { t: 0.5, accent: false });
  assert.deepEqual(M.nextClickInSilent(it, 0, 1.9, 4), { t: 2.0, accent: true }, '小节边界重音');
  assert.deepEqual(M.nextClickInSilent(it, 0, 2.9, 4), { t: 3.0, accent: false });
  assert.equal(M.nextClickInSilent(it, 0, 3.99, 4), null, '拍点跨出段尾');
  assert.equal(M.nextClickInSilent(it, 0, 4.1, 4), null, '超出段尾');
});

test('nextClickInSilent: 拍定义与自定义 BPM/起点', () => {
  const it = { silent: true, unit: 'beat', qty: 3, bpm: 120, beatsPerBar: 4, beatUnit: 4, durationSec: 1.5 };
  assert.deepEqual(M.nextClickInSilent(it, 10, 9.9, 4), { t: 10, accent: true }, '起点 offset 10s');
  assert.deepEqual(M.nextClickInSilent(it, 10, 10.2, 4), { t: 10.5, accent: false });
  assert.equal(M.nextClickInSilent(it, 10, 11.2, 4), null, '3 拍后无拍点');
  // BPM 140：拍点间隔 60/140 ≈ 0.4286
  const b = { silent: true, unit: 'beat', qty: 2, bpm: 140, beatsPerBar: 4, beatUnit: 4, durationSec: 0.8572 };
  const n = M.nextClickInSilent(b, 0, 0.01, 4);
  assert.ok(Math.abs(n.t - 60 / 140) < 1e-6, '自定义 BPM 步长');
});

test('nextClickInSilent: 浮点边界拍点严格递增（非 2 幂步长，如 0.4s）', () => {
  // 4 拍 @150 = 1.6s：内部拍点 2.4/2.8/3.2，段尾 3.6 不播。
  // 浮点 (2.4-2)/0.4 可能略小于 1 —— 每步必须严格前进（+EPS 容差修复，否则死循环）
  const it = { silent: true, unit: 'beat', qty: 4, bpm: 150, beatsPerBar: 4, beatUnit: 4, durationSec: 1.6 };
  let t = 2.4 - 1e-6;
  for (let i = 0; i < 3; i++) {
    const x = M.nextClickInSilent(it, 2, t, 4);
    assert.ok(x && x.t > t + 1e-9, '第 ' + i + ' 步未严格前进，t=' + t);
    t = x.t;
  }
  assert.equal(M.nextClickInSilent(it, 2, t, 4), null, '段尾拍点不播');
});

test('nextClickInSilent: 秒单位不打点 / 无效参数', () => {
  assert.equal(M.nextClickInSilent({ silent: true, unit: 'sec', durationSec: 2 }, 0, 0.1, 4), null);
  assert.equal(M.nextClickInSilent({ silent: false, unit: 'bar' }, 0, 0.1, 4), null);
  assert.equal(M.nextClickInSilent({ silent: true, unit: 'bar', bpm: 0 }, 0, 0.1, 4), null, 'bpm 缺失');
});

test('mixItemAt: 拼接轴定位与累计起点（普通段/静音段交错）', () => {
  const items = [
    { startTime: 0, endTime: 2, silent: false },
    { silent: true, unit: 'bar', durationSec: 4, bpm: 120 },
    { startTime: 3, endTime: 5, silent: false },
  ];
  assert.deepEqual(M.mixItemAt(items, 0.5), { item: items[0], index: 0, startMix: 0 });
  assert.deepEqual(M.mixItemAt(items, 2.5), { item: items[1], index: 1, startMix: 2 }, '静音段起点累计');
  assert.deepEqual(M.mixItemAt(items, 6.5), { item: items[2], index: 2, startMix: 6 });
  assert.equal(M.mixItemAt(items, 8.5), null, '超出序列末尾');
  assert.equal(M.mixItemAt([], 1), null);
});

test('shouldResync: 拼接播放原曲时间回退判定', () => {
  assert.equal(M.shouldResync(4.0, 0.02), true, '重复段回退（4s→0s）');
  assert.equal(M.shouldResync(0.02, 0.06), false, '正常前进');
  assert.equal(M.shouldResync(null, 0.5), false, '无上次记录');
  assert.equal(M.shouldResync(3.0, 2.98), false, '微小抖动不触发（阈值 0.05）');
  assert.equal(M.shouldResync(3.0, 2.9, 0.2), false, '自定义阈值');
});

test('planClicks: 收集区间内拍点（4/4 @120 noteUnit=8 每小节 8 点）', () => {
  const segs = [SEG_44_120];
  const clicks = M.planClicks(segs, 0, 4, 8);
  assert.equal(clicks.length, 17, '4 秒 × 每秒 4 点 + 起点拍 = 17');
  assert.deepEqual(clicks[0], { t: 0, accent: true }, '起点拍 = 段起点重音');
  assert.deepEqual(clicks[1], { t: 0.25, accent: false });
  assert.deepEqual(clicks[4], { t: 1.0, accent: false });
  assert.deepEqual(clicks[8], { t: 2.0, accent: true }, '小节起点重音');
});
