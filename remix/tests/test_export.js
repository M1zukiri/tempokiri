/**
 * test_export.js — 导出编码与拼接测试（node --test）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/export.js');

test('applyFades: 淡入淡出端点归零', () => {
  const seg = new Float32Array([1, 1, 1, 1]);
  const out = E.applyFades(seg, 2, 2);
  assert.equal(out[0], 0);
  assert.equal(out[3], 0);
  assert.ok(out[1] > 0 && out[1] < 1);
  // 不修改原数据
  assert.equal(seg[0], 1);
});

test('crossfadeConcat: 长度与交叉区混合', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([4, 5, 6]);
  const out = E.crossfadeConcat(a, b, 2);
  assert.equal(out.length, 4); // 3+3-2
  assert.equal(out[0], 1);
  assert.equal(out[3], 6);
  assert.equal(out[1], 2); // t=0: a[1]*1 + b[0]*0
  assert.ok(Math.abs(out[2] - (3 * 0.5 + 5 * 0.5)) < 1e-6);
});

test('crossfadeConcat: fade 0 为直接拼接', () => {
  const a = new Float32Array([1, 2]);
  const b = new Float32Array([3, 4]);
  const out = E.crossfadeConcat(a, b, 0);
  assert.equal(out.length, 4);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4]);
});

test('renderMix: 顺序拼接 + 淡入淡出', () => {
  const pcm = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const parts = [
    { start: 0, end: 4, fadeIn: 1, fadeOut: 1 },
    { start: 4, end: 8, fadeIn: 0, fadeOut: 0 },
  ];
  const out = E.renderMix(pcm, parts, 0);
  assert.equal(out.length, 8);
  assert.equal(out[0], 0); // fadeIn 端点归零
  assert.equal(out[1], 2);
  assert.equal(out[2], 3);
  assert.equal(out[3], 0); // fadeOut 端点归零
  assert.equal(out[4], 5);
  assert.equal(out[7], 8);
});

test('encodeWav: RIFF 头与数据往返', () => {
  const sr = 8000;
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
  const buf = E.encodeWav(samples, sr);
  const view = new DataView(buf);
  const readStr = (off, len) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  };
  assert.equal(readStr(0, 4), 'RIFF');
  assert.equal(readStr(8, 4), 'WAVE');
  assert.equal(readStr(12, 4), 'fmt ');
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // mono
  // 样本往返：samples = [0, 0.5, -0.5, 1, -1, 0.25]
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), 16384); // 0.5
  assert.equal(view.getInt16(48, true), -16384); // -0.5
  assert.equal(view.getInt16(50, true), 32767); // 1（clamp）
  assert.equal(view.getInt16(52, true), -32768); // -1（clamp）
  assert.equal(view.getInt16(54, true), 8192); // 0.25
});

test('encodeMp3: 输出有效 MPEG 帧头', () => {
  const samples = new Float32Array(44100 * 2).fill(0.1);
  const buf = E.encodeMp3(samples, 44100);
  assert.ok(buf.byteLength > 0, 'MP3 输出不应为空');
  const view = new DataView(buf);
  const sync = view.getUint8(0) === 0xff && (view.getUint8(1) & 0xe0) === 0xe0;
  assert.ok(sync, '应有 11-bit 帧同步');
});

test('encodeMp3: 非标准采样率重采样到 44100', () => {
  const samples = new Float32Array(22050 * 2).fill(0.05);
  const buf = E.encodeMp3(samples, 22050);
  assert.ok(buf.byteLength > 0);
});
