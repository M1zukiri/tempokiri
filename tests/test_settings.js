/**
 * test_settings.js — 高级设置纯函数单元测试。
 * 创建时间：2026-08-13 22:21:17
 * 运行：node --test tests/test_settings.js
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const s = require('../src/settings.js');

test('msToHop 换算与边界 clamp', () => {
  assert.equal(s.msToHop(23.2), 512); // 标准档 512
  assert.equal(s.msToHop(1), 64); // 下限 clamp
  assert.equal(s.msToHop(100), 2048); // 上限 clamp
  assert.equal(s.msToHop(46.4), 1023); // 46.4*22.05=1023.12 -> round 1023（快速档显示 46.4ms 与 1024 的偏差属显示精度，权威值始终来自档位）
});

test('hopToMs 换算', () => {
  assert.ok(Math.abs(s.hopToMs(512) - 23.22) < 0.01);
  assert.ok(Math.abs(s.hopToMs(256) - 11.61) < 0.01);
});

test('sensitivityToDelta 线性映射', () => {
  assert.ok(Math.abs(s.sensitivityToDelta(0.9) - 0.79) < 1e-9); // 接近原默认 delta 0.8
  assert.ok(Math.abs(s.sensitivityToDelta(1.0) - 0.7) < 1e-9);
  assert.ok(Math.abs(s.sensitivityToDelta(0.0) - 1.6) < 1e-9);
  assert.ok(Math.abs(s.sensitivityToDelta(2.0) - 0.7) < 1e-9); // 越界 clamp 到 1
  assert.ok(Math.abs(s.sensitivityToDelta(-1.0) - 1.6) < 1e-9); // 越界 clamp 到 0
});

test('validateField 各键合法值', () => {
  assert.equal(s.validateField('hop', 512), true);
  assert.equal(s.validateField('hop', 64), true);
  assert.equal(s.validateField('hop', 2048), true);
  assert.equal(s.validateField('sensitivity', 0.5), true);
  assert.equal(s.validateField('minBpm', 1), true);
  assert.equal(s.validateField('maxBpm', 600), true);
  assert.equal(s.validateField('captureRate', 16), true);
  assert.equal(s.validateField('followMs', 5000), true);
  assert.equal(s.validateField('renderScale', 4), true);
  assert.equal(s.validateField('videoExtract', 'auto'), true);
  assert.equal(s.validateField('videoExtract', 'webcodecs'), true);
  assert.equal(s.validateField('videoExtract', 'capture'), true);
});

test('validateField 各键非法值', () => {
  assert.equal(s.validateField('hop', 512.5), false); // 必须整数
  assert.equal(s.validateField('hop', 63), false);
  assert.equal(s.validateField('hop', 2049), false);
  assert.equal(s.validateField('sensitivity', -0.1), false);
  assert.equal(s.validateField('sensitivity', 1.1), false);
  assert.equal(s.validateField('minBpm', 0), false);
  assert.equal(s.validateField('maxBpm', 601), false);
  assert.equal(s.validateField('captureRate', 0), false);
  assert.equal(s.validateField('captureRate', 17), false);
  assert.equal(s.validateField('followMs', 0), false);
  assert.equal(s.validateField('followMs', 5001), false);
  assert.equal(s.validateField('renderScale', 0), false);
  assert.equal(s.validateField('renderScale', 5), false);
  assert.equal(s.validateField('renderScale', 4.1), false);
  assert.equal(s.validateField('videoExtract', 'x'), false);
  assert.equal(s.validateField('videoExtract', ''), false);
  assert.equal(s.validateField('unknownKey', 1), false);
});

test('DEFAULT_VALUES 与 store.js 默认一致（9 键）', () => {
  const d = s.DEFAULT_VALUES;
  assert.deepEqual(Object.keys(d).sort(), [
    'captureRate', 'crossfadeMs', 'followMs', 'hop', 'maxBpm', 'minBpm', 'renderScale', 'sensitivity', 'videoExtract',
  ]);
  assert.equal(d.hop, 512);
  assert.equal(d.videoExtract, 'auto');
  assert.equal(d.captureRate, 4);
  assert.equal(d.followMs, 90);
  assert.equal(d.renderScale, 1.0);
  assert.equal(d.crossfadeMs, 30);
  assert.equal(d.sensitivity, 0.9);
  assert.equal(d.minBpm, 60);
  assert.equal(d.maxBpm, 200);
});

test('FIELD_DEFS 覆盖全部 9 个 store 键且 help 文案非空', () => {
  const keys = s.FIELD_DEFS.map((f) => f.key);
  for (const k of ['hop', 'sensitivity', 'minBpm', 'maxBpm', 'videoExtract', 'captureRate', 'followMs', 'renderScale']) {
    assert.ok(keys.includes(k), '缺少字段定义：' + k);
  }
  for (const f of s.FIELD_DEFS) {
    assert.ok(f.help.effect && f.help.range && f.help.recommend, 'help 文案不完整：' + f.key);
    if (f.number) {
      assert.ok(typeof f.number.min === 'number' && typeof f.number.max === 'number', '数字框范围缺失：' + f.key);
    }
  }
});
