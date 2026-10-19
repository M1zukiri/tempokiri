/**
 * test_gridData.js — 节拍/网格数据导出纯函数测试（1.23.0）。
 *
 * 创建时间：2026-10-19 17:04:00
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/analysis.js');
const G = require('../src/gridData.js');

function grid120() {
  return A.buildGrid({
    segments: [{ bpm: 120, beatsPerBar: 4, beatUnit: 4, bars: 2 }],
    offset: 0.5,
    duration: 10,
  });
}

test('buildGridData: 小节/拍/BPM 与偏移', () => {
  const data = G.buildGridData({ grid: grid120(), offset: 0.5, duration: 10 });
  assert.equal(data.format, 'tempokiri-grid-v1');
  assert.equal(data.offset, 0.5);
  assert.equal(data.duration, 10);
  assert.equal(data.segments.length, 1);
  assert.equal(data.segments[0].bpm, 120);
  assert.equal(data.bars.length, 2);
  assert.equal(data.bars[0].number, 1);
  assert.equal(data.bars[0].startSec, 0.5);
  assert.equal(data.bars[0].endSec, 2.5);
  assert.equal(data.bars[0].durationSec, 2);
  assert.equal(data.bars[0].bpm, 120);
  // buildGrid 的 beatTimes 含末端网格线（与下一个小节起点重合），2 小节 4/4 → 9 条
  assert.equal(data.beats.length, 9, '2 小节 × 4 拍 + 末端线');
  assert.equal(data.beats[0].timeSec, 0.5);
});

test('buildGridData: 多段 BPM 变化时按小节起点归属', () => {
  const grid = A.buildGrid({
    segments: [
      { bpm: 120, beatsPerBar: 4, beatUnit: 4, bars: 1 },
      { bpm: 60, beatsPerBar: 4, beatUnit: 4, bars: 1 },
    ],
    offset: 0,
    duration: 20,
  });
  const data = G.buildGridData({ grid, offset: 0, duration: 20 });
  assert.equal(data.bars.length, 2);
  assert.equal(data.bars[0].bpm, 120);
  assert.equal(data.bars[1].bpm, 60, '第 2 小节起点落在第 2 段');
  assert.equal(data.segments.length, 2);
});

test('buildGridData: 无网格返回 null；元数据可选', () => {
  assert.equal(G.buildGridData({ grid: null }), null);
  assert.equal(G.buildGridData({ grid: { bars: [] } }), null);
  const data = G.buildGridData({ grid: grid120(), offset: 0.5, duration: 10, meta: { title: '曲', artist: '人' } });
  assert.equal(data.meta.title, '曲');
  assert.equal(data.meta.album, '');
});

test('gridDataToCSV: 注释头 + 表头 + 每小节一行', () => {
  const data = G.buildGridData({ grid: grid120(), offset: 0.5, duration: 10, meta: { title: 'T' } });
  const lines = G.gridDataToCSV(data).trimEnd().split('\n');
  assert.ok(lines.every((l) => l.length > 0));
  assert.ok(lines[0].startsWith('# tempokiri grid export'));
  assert.ok(lines.some((l) => l === '# title=T'));
  const headerIdx = lines.findIndex((l) => l.startsWith('bar,'));
  assert.ok(headerIdx > 0, '存在表头');
  assert.equal(lines[headerIdx], 'bar,start_sec,end_sec,duration_sec,bpm,beats_per_bar');
  const rows = lines.slice(headerIdx + 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0], '1,0.5,2.5,2,120,4');
  assert.equal(G.gridDataToCSV(null), '');
});

test('gridDataToJSON: 可解析且含全部键', () => {
  const data = G.buildGridData({ grid: grid120(), offset: 0.5, duration: 10 });
  const obj = JSON.parse(G.gridDataToJSON(data));
  assert.equal(obj.format, 'tempokiri-grid-v1');
  assert.ok(Array.isArray(obj.segments) && Array.isArray(obj.bars) && Array.isArray(obj.beats));
  assert.equal(obj.bars[1].number, 2);
  assert.equal(G.gridDataToJSON(null), '');
});
