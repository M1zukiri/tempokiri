/**
 * test_range_convert.js — 小节/格 ↔ 时间双语义转换的边界情况测试。
 * 创建时间：2026-08-26
 * 覆盖：barCellToTime 越界/非整数、timeToBarCell(End) 网格边界、往返一致性（含非 2 幂浮点）、
 *       syncItemTimes 失效规则（越界 → null，绝不保留陈旧缓存）、resyncGridItems、rangeSpecSync。
 * 运行：node --test tests/test_range_convert.js
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
}); // barDur=2s, step=0.5s, bars[1] = [0,2)
const GRID90 = A.buildGrid({
  segments: A.resolveSegments([{ bpm: 90, beatsPerBar: 4, beatUnit: 4, resolution: 4 }], 30),
  offset: 0,
  duration: 30,
}); // barDur=2.6667s, step=0.6667s（非 2 幂浮点）
const GRIDNEG = A.buildGrid({
  segments: A.resolveSegments([{ bpm: 120, beatsPerBar: 4, beatUnit: 4, resolution: 4 }], 30),
  offset: -1,
  duration: 30,
}); // 负 offset：bars[0] = [-1, 1)
const GRID2SEG = A.buildGrid({
  segments: A.resolveSegments([
    { bpm: 120, beatsPerBar: 4, beatUnit: 4, resolution: 4, bars: 4 },
    { bpm: 120, beatsPerBar: 4, beatUnit: 4, resolution: 8, bars: 4 },
  ], 30),
  offset: 0,
  duration: 30,
}); // 段 2 分辨率 8（0.25s 格）

// ---------- A. barCellToTime 边界 ----------
test('barCellToTime: 基础格区间与末格端点', () => {
  assert.deepEqual(S.barCellToTime(GRID, 1, 1), [0, 0.5]);
  assert.deepEqual(S.barCellToTime(GRID, 2, 3), [2 + 1, 2 + 1.5], '第 2 小节第 3 格');
  assert.deepEqual(S.barCellToTime(GRID, 3, 4), [4 + 1.5, 4 + 2], '末格 = 小节末尾');
});

test('barCellToTime: cell 越界 clamp（0→1，超 res→末格）', () => {
  assert.deepEqual(S.barCellToTime(GRID, 1, 0), [0, 0.5], 'cell=0 clamp 到格 1');
  assert.deepEqual(S.barCellToTime(GRID, 1, 99), [1.5, 2], 'cell=99 clamp 到末格（第 4 格）');
});

test('barCellToTime: bar 越界/无网格 → null', () => {
  assert.equal(S.barCellToTime(GRID, 0, 1), null);
  assert.equal(S.barCellToTime(GRID, -3, 1), null);
  assert.equal(S.barCellToTime(GRID, 99, 1), null);
  assert.equal(S.barCellToTime(GRID, null, 1), null);
  assert.equal(S.barCellToTime(null, 1, 1), null, '无网格');
});

test('barCellToTime: 负 offset 网格（bars[0]=[-1,1)）', () => {
  assert.deepEqual(S.barCellToTime(GRIDNEG, 1, 1), [-1, -0.5]);
  assert.deepEqual(S.barCellToTime(GRIDNEG, 1, 3), [0, 0.5]);
});

test('barCellToTime: 多段不同分辨率', () => {
  assert.deepEqual(S.barCellToTime(GRID2SEG, 5, 2), [8 + 0.25, 8 + 0.5], '段 2（res=8, 0.25s/格）');
  assert.deepEqual(S.barCellToTime(GRID2SEG, 1, 2), [0.5, 1], '段 1（res=4, 0.5s/格）');
});

// ---------- B. timeToBarCell / timeToBarCellEnd 边界 ----------
test('timeToBarCell: 网格前/恒等起点/拍线边界/网格末尾容差', () => {
  assert.equal(S.timeToBarCell(GRID, -0.1), null, '网格前');
  assert.deepEqual(S.timeToBarCell(GRID, 0), { bar: 1, cell: 1 }, '网格起点');
  assert.deepEqual(S.timeToBarCell(GRID, 0.5), { bar: 1, cell: 2 }, '拍线边界归后格（半开）');
  assert.deepEqual(S.timeToBarCell(GRID, 2.0), { bar: 2, cell: 1 }, '小节边界');
  assert.deepEqual(S.timeToBarCell(GRID, 29.999), { bar: 15, cell: 4 }, '末尾前');
  assert.deepEqual(S.timeToBarCell(GRID, 30.0), { bar: 15, cell: 4 }, '网格末尾容差归末格');
  assert.equal(S.timeToBarCell(GRID, 30.1), null, '超出网格末尾');
});

test('timeToBarCellEnd: 端点含语义（恰在格末归本格）', () => {
  assert.deepEqual(S.timeToBarCellEnd(GRID, 0.5), { bar: 1, cell: 1 }, '格 1 末尾 → 格 1');
  assert.deepEqual(S.timeToBarCellEnd(GRID, 0.5001), { bar: 1, cell: 2 }, '格 2 内');
  assert.deepEqual(S.timeToBarCellEnd(GRID, 2.0), { bar: 1, cell: 4 }, '第 1 小节结束 → 末格（End 语义：含端点归本格）');
  assert.deepEqual(S.timeToBarCellEnd(GRID, 30.0), { bar: 15, cell: 4 }, '网格末尾');
  assert.equal(S.timeToBarCellEnd(GRID, -0.01), null, '网格前');
});

test('timeToBarCell: 负 offset 网格命中', () => {
  assert.deepEqual(S.timeToBarCell(GRIDNEG, 0), { bar: 1, cell: 3 }, '0s 在第 1 小节第 3 格([0,0.5))');
  assert.deepEqual(S.timeToBarCell(GRIDNEG, -1), { bar: 1, cell: 1 }, '负时间命中首格');
});

test('timeToBarCell: 多段分辨率切换处', () => {
  assert.deepEqual(S.timeToBarCell(GRID2SEG, 7.9), { bar: 4, cell: 4 }, '段 1 末');
  assert.deepEqual(S.timeToBarCell(GRID2SEG, 8.1), { bar: 5, cell: 1 }, '段 2 首格（0.25s 粒度）');
});

// ---------- C. 往返一致性（核心：无数值错误） ----------
test('往返 bars→time→bars 恒等（120 BPM，2 幂步长）', () => {
  const bv = { startBar: 2, startCell: 3, endBar: 4, endCell: 2 };
  const tv = S.barsRangeToTime(GRID, bv);
  assert.deepEqual(tv, { startSec: 3, endSec: 7 }, '派生时间');
  const back = S.timeRangeToBars(GRID, tv);
  assert.deepEqual(back, bv, '回环恒等');
});

test('往返 bars→time→bars 恒等（90 BPM 非 2 幂步长，浮点容差）', () => {
  const bv = { startBar: 2, startCell: 3, endBar: 4, endCell: 2 };
  const tv = S.barsRangeToTime(GRID90, bv);
  assert.ok(tv, '派生时间存在');
  const back = S.timeRangeToBars(GRID90, tv);
  assert.deepEqual(back, bv, '浮点步长下回环仍恒等（+EPS 容差）');
  // 派生时间本身：endBar=4 第 2 格末尾 = 3×barDur + 2×step
  assert.ok(Math.abs(tv.endSec - (3 * (60 / 90) * 4 + 2 * (60 / 90))) < 1e-6, 'endSec=' + tv.endSec);
});

test('往返 time→bars→time 量化语义（精确值 → 格粒度）', () => {
  const tv = { startSec: 3.2, endSec: 5.3 };
  const bv = S.timeRangeToBars(GRID, tv);
  assert.deepEqual(bv, { startBar: 2, startCell: 3, endBar: 3, endCell: 3 });
  const back = S.barsRangeToTime(GRID, bv);
  assert.deepEqual(back, { startSec: 3, endSec: 5.5 }, '量化回格起点/格末尾（语义：以格为粒度，起点取格首、终点取格末）');
});

test('往返边界：恰在网格线的时间（半开归属稳定）', () => {
  const bv = { startBar: 3, startCell: 2, endBar: 3, endCell: 2 };
  const tv = S.barsRangeToTime(GRID, bv);
  assert.deepEqual(tv, { startSec: 4.5, endSec: 5 });
  assert.deepEqual(S.timeRangeToBars(GRID, tv), bv, '格边界回环稳定（起点半开、终点含端点）');
});

test('往返 BPM 变化（网格重建）后 bars 锚定稳定', () => {
  const bv = { startBar: 1, startCell: 1, endBar: 2, endCell: 4 };
  const t120 = S.barsRangeToTime(GRID, bv);
  const t90 = S.barsRangeToTime(GRID90, bv);
  assert.ok(Math.abs(t120.endSec - 4) < 1e-9);
  assert.ok(Math.abs(t90.endSec - 8 * (60 / 90)) < 1e-6, '随 BPM 移动');
  assert.deepEqual(S.timeRangeToBars(GRID90, t90), bv, '新网格下回环恒等');
});

// ---------- D. syncItemTimes 失效规则 ----------
test('syncItemTimes: bars 越界 → 派生置 null（陈旧缓存绝不留存）', () => {
  const it = { mode: 'bars', startBar: 1, startCell: 1, endBar: 99, endCell: 4, startTime: 0, endTime: 4 };
  S.syncItemTimes(it, GRID);
  assert.equal(it.startTime, null, '起点仍有效？不——end 越界则双双失效');
  assert.equal(it.endTime, null);
});

test('syncItemTimes: 起点越界同样失效', () => {
  const it = { mode: 'bars', startBar: 50, startCell: 1, endBar: 2, endCell: 4, startTime: 0, endTime: 4 };
  S.syncItemTimes(it, GRID);
  assert.equal(it.startTime, null);
  assert.equal(it.endTime, null);
});

test('syncItemTimes: time 超网格 → 派生小节/格 null', () => {
  const it = { mode: 'time', startTime: 31, endTime: 33, startBar: 1, startCell: 1, endBar: 2, endCell: 2 };
  S.syncItemTimes(it, GRID);
  assert.equal(it.startBar, null);
  assert.equal(it.endBar, null);
});

test('syncItemTimes: 无网格/静音段 → 不修改', () => {
  const it = { mode: 'bars', startBar: 1, startCell: 1, endBar: 2, endCell: 4, startTime: 0, endTime: 4 };
  S.syncItemTimes(it, null);
  assert.equal(it.endTime, 4, '无网格不变');
  const sil = { silent: true, durationSec: 2, startTime: 99, mode: 'bars' };
  S.syncItemTimes(sil, GRID);
  assert.equal(sil.startTime, 99, '静音段不参与');
});

test('syncItemTimes: 旧数据缺 cell → 默认起格 1 / 末格', () => {
  const it = { mode: 'bars', startBar: 1, endBar: 2, startTime: null, endTime: null };
  S.syncItemTimes(it, GRID);
  assert.equal(it.startTime, 0);
  assert.equal(it.endTime, 4, 'endCell 缺省 = 末格（分辨率）');
  assert.equal(it.startCell, 1, 'startCell 补默认');
  assert.equal(it.endCell, 4);
});

// ---------- E. resyncGridItems 边界 ----------
test('resyncGridItems: 空/非数组/null grid 不抛错', () => {
  assert.doesNotThrow(() => S.resyncGridItems([], GRID));
  assert.doesNotThrow(() => S.resyncGridItems(null, GRID));
  assert.doesNotThrow(() => S.resyncGridItems([], null));
  assert.doesNotThrow(() => S.resyncGridItems(undefined, undefined));
});

test('resyncGridItems: 混合序列只重算非静音段', () => {
  const items = [
    { mode: 'bars', startBar: 1, startCell: 1, endBar: 2, endCell: 4, startTime: 0, endTime: null },
    { silent: true, durationSec: 3, mode: undefined },
    { mode: 'time', startTime: 0.5, endTime: 3.5, startBar: null },
  ];
  S.resyncGridItems(items, GRID90);
  assert.ok(Math.abs(items[0].endTime - 8 * (60 / 90)) < 1e-6, 'bars 段随动');
  assert.equal(items[1].durationSec, 3, '静音段不动');
  assert.equal(items[2].startTime, 0.5, 'time 段内容锚定');
  assert.ok(items[2].startBar >= 1, 'time 段派生小节刷新');
});

// ---------- F. rangeSpecSync 边界 ----------
test('rangeSpecSync: 两路皆携带、失败侧 null', () => {
  const r1 = S.rangeSpecSync({ mode: 'bars', bars: { startBar: 1, startCell: 1, endBar: 2, endCell: 4 } }, GRID);
  assert.deepEqual(r1.time, { startSec: 0, endSec: 4 });
  assert.deepEqual(r1.bars, { startBar: 1, startCell: 1, endBar: 2, endCell: 4 });
  const r2 = S.rangeSpecSync({ mode: 'time', time: { startSec: 3.2, endSec: 5.3 } }, GRID);
  assert.deepEqual(r2.bars, { startBar: 2, startCell: 3, endBar: 3, endCell: 3 });
});

test('rangeSpecSync: 越界 bars / 无网格 → 派生侧 null', () => {
  const r1 = S.rangeSpecSync({ mode: 'bars', bars: { startBar: 99, startCell: 1, endBar: 100, endCell: 1 } }, GRID);
  assert.equal(r1.time, null);
  const r2 = S.rangeSpecSync({ mode: 'bars', bars: { startBar: 1, startCell: 1, endBar: 2, endCell: 4 } }, null);
  assert.equal(r2.time, null, '无网格无法换算');
  const r3 = S.rangeSpecSync({ mode: 'time', time: { startSec: 31, endSec: 33 } }, GRID);
  assert.equal(r3.bars, null, '超网格时间');
});

test('timeRangeToBars: 负时间合法（网格内负 offset 区间可换算）', () => {
  // GRIDNEG: bars[1]=[-1,1)，step=0.5s；起点 -0.5s = 格 2，终点 0.5s = 格 3 末
  const bv = S.timeRangeToBars(GRIDNEG, { startSec: -0.5, endSec: 0.5 });
  assert.deepEqual(bv, { startBar: 1, startCell: 2, endBar: 1, endCell: 3 }, '负时间不再被拒绝');
});

test('timeRangeToBars: 网格外负时间/无法换算 → null', () => {
  assert.equal(S.timeRangeToBars(GRID, { startSec: -2, endSec: 5 }), null, '起点在网格前');
  assert.equal(S.timeRangeToBars(GRIDNEG, { startSec: -3, endSec: 4 }), null);
  assert.equal(S.timeRangeToBars(null, { startSec: 0, endSec: 2 }), null, '无网格');
  assert.equal(S.timeRangeToBars(GRID, { startSec: 3, endSec: 3 }), null, '零长度');
});

test('rangeSpecSync: 空/缺 mode 防御', () => {
  const r = S.rangeSpecSync(null, GRID);
  assert.equal(r.mode, 'bars');
  assert.equal(r.bars, null);
  assert.equal(r.time, null);
});
