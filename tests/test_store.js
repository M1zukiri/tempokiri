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

test('全局设置：默认值兜底（含高级设置新键）', () => {
  const g = S.loadGlobalSettings();
  assert.equal(g.crossfadeMs, 30);
  assert.equal(g.sensitivity, 0.9);
  assert.equal(g.minBpm, 60);
  assert.equal(g.maxBpm, 200);
  assert.equal(g.hop, 512);
  assert.equal(g.videoExtract, 'auto');
  assert.equal(g.captureRate, 4);
  assert.equal(g.followMs, 90);
  assert.equal(g.renderScale, 1.0);
});

test('全局设置：高级设置新键局部保存合并不覆盖旧键', () => {
  mem.clear();
  S.saveGlobalSettings({ renderScale: 0.5 });
  const g = S.loadGlobalSettings();
  assert.equal(g.renderScale, 0.5);
  assert.equal(g.crossfadeMs, 30); // 未改的旧键保留默认
  assert.equal(g.hop, 512); // 未改的新键保留默认
  S.saveGlobalSettings({ hop: 256 });
  const g2 = S.loadGlobalSettings();
  assert.equal(g2.hop, 256);
  assert.equal(g2.renderScale, 0.5); // 前一次保存的值保留
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

test('全局设置：主题默认 aurora 且可保存切换（主题系统）', () => {
  mem.clear();
  const g = S.loadGlobalSettings();
  assert.equal(g.theme, 'aurora', '默认主题应为 aurora');
  S.saveGlobalSettings({ theme: 'nebula' });
  assert.equal(S.loadGlobalSettings().theme, 'nebula');
  S.saveGlobalSettings({ theme: 'paper' });
  assert.equal(S.loadGlobalSettings().theme, 'paper');
  // 非法主题值不在此层过滤（validateField 负责），保存即原样
  S.saveGlobalSettings({ theme: 'x' });
  assert.equal(S.loadGlobalSettings().theme, 'x');
});
