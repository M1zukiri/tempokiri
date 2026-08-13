/**
 * test_videoExport.js — 视频导出规格纯函数单元测试（node --test）。
 * 创建时间：2026-08-13
 * 运行：node --test tests/test_videoExport.js
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const V = require('../src/videoExport.js');

test('computeVideoScale: 等比缩放（宽/高上限）', () => {
  assert.deepEqual(V.computeVideoScale(3840, 2160, 1920, 1080), { w: 1920, h: 1080 }); // 4K -> 1080P
  assert.deepEqual(V.computeVideoScale(2560, 1440, 1920, 1080), { w: 1920, h: 1080 }); // 2K -> 1080P
});

test('computeVideoScale: 源未超限不放大', () => {
  assert.deepEqual(V.computeVideoScale(1920, 1080, 1920, 1080), { w: 1920, h: 1080 });
  assert.deepEqual(V.computeVideoScale(1280, 720, 1920, 1080), { w: 1280, h: 720 });
  assert.deepEqual(V.computeVideoScale(1919, 1079, 1920, 1080), { w: 1919, h: 1079 });
});

test('computeVideoScale: 降级缩放', () => {
  assert.deepEqual(V.computeVideoScale(1920, 1080, 1280, 720), { w: 1280, h: 720 });
});

test('computeVideoScale: null 上限不缩放', () => {
  assert.deepEqual(V.computeVideoScale(1000, 1000, null, null), { w: 1000, h: 1000 });
  assert.deepEqual(V.computeVideoScale(4000, 3000, null, 1080), { w: 4000, h: 3000 }); // 任一 null 均不缩
});
test('computeVideoScale: 向下取整到偶数（H.264 要求）', () => {
  assert.deepEqual(V.computeVideoScale(1000, 1000, 999, 999), { w: 998, h: 998 });
  assert.deepEqual(V.computeVideoScale(1001, 601, 1000, 600), { w: 998, h: 600 });
});


test('frameKeepInterval: 抽帧间隔', () => {
  assert.equal(V.frameKeepInterval(60, 30), 2);
  assert.equal(V.frameKeepInterval(24, 60), 1); // 目标高于源，不抽
  assert.equal(V.frameKeepInterval(30, 24), 2);
  assert.equal(V.frameKeepInterval(30, null), 1); // 跟随源
  assert.equal(V.frameKeepInterval(30, 30), 1); // 相等不抽
  assert.equal(V.frameKeepInterval(null, 30), 1); // 源帧率未知不抽
});

test('estimateFps: 从样本时长估算帧率', () => {
  assert.equal(V.estimateFps([{ duration: 100 }, { duration: 100 }], 3000), 30);
  assert.equal(V.estimateFps([{ duration: 40 }, { duration: 40 }, { duration: 40 }], 2400), 60);
  assert.equal(V.estimateFps([], 3000), null); // 空样本
  assert.equal(V.estimateFps([{ duration: 100 }], 0), null); // timescale 0
  assert.equal(V.estimateFps([{ duration: 0 }], 3000), null); // 全零时长
  assert.equal(V.estimateFps(null, 3000), null); // 缺失样本
});
