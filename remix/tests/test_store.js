/**
 * test_store.js — 全局高级设置持久化测试（node --test）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// store.js 使用 localStorage，注入内存 mock
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const S = require('../src/store.js');

test('全局设置：默认值兜底', () => {
  const g = S.loadGlobalSettings();
  assert.equal(g.crossfadeMs, 30);
  assert.equal(g.sensitivity, 0.9);
  assert.equal(g.minBpm, 60);
  assert.equal(g.maxBpm, 200);
});

test('全局设置：局部保存后合并读取', () => {
  S.saveGlobalSettings({ crossfadeMs: 80 });
  const g = S.loadGlobalSettings();
  assert.equal(g.crossfadeMs, 80);
  assert.equal(g.sensitivity, 0.9); // 未改的键保留默认
  // 再改另一键，crossfadeMs 保留
  S.saveGlobalSettings({ sensitivity: 0.5 });
  const g2 = S.loadGlobalSettings();
  assert.equal(g2.crossfadeMs, 80);
  assert.equal(g2.sensitivity, 0.5);
});

test('全局设置：损坏 JSON 回退默认', () => {
  mem.set(S.GLOBAL_KEY, '{bad json');
  const g = S.loadGlobalSettings();
  assert.equal(g.crossfadeMs, 30);
});

test('文件设置：往返一致', () => {
  const file = { name: 'a.mp3', size: 100, lastModified: 42 };
  S.saveSettings(file, { bpm: 143, offset: 0.46, sequence: [], view: { start: 1, end: 5 } });
  const loaded = S.loadSettings(file);
  assert.equal(loaded.bpm, 143);
  assert.deepEqual(loaded.view, { start: 1, end: 5 });
  S.clearSettings(file);
  assert.equal(S.loadSettings(file), null);
});
