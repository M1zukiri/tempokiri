/**
 * test_loudness.js — LUFS 积分响度与归一化测试（A5-3）。
 *
 * 创建时间：2026-10-19 17:52:00
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/loudness.js');

function sine(freq, amp, sr, dur) {
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  return out;
}

function silence(sr, dur) {
  return new Float32Array(Math.round(dur * sr));
}

test('integratedLoudness: 997Hz -20dBFS 正弦约 -23 LUFS（BS.1770 参考）', () => {
  const sig = sine(997, 0.1, 48000, 3);
  const lufs = L.integratedLoudness(sig, 48000);
  assert.ok(Math.abs(lufs - (-23.0)) < 0.3, '实际 ' + lufs.toFixed(2));
});

test('integratedLoudness: 静音返回 -Infinity，空数组同样', () => {
  assert.equal(L.integratedLoudness(silence(48000, 1), 48000), -Infinity);
  assert.equal(L.integratedLoudness(new Float32Array(0), 48000), -Infinity);
});

test('integratedLoudness: 门限忽略静音段（响段 + 静音 ≈ 纯响段）', () => {
  const loud = sine(997, 0.3, 48000, 2);
  const mix = new Float32Array(loud.length + Math.round(3 * 48000));
  mix.set(loud, 0);
  const a = L.integratedLoudness(loud, 48000);
  const b = L.integratedLoudness(mix, 48000);
  assert.ok(Math.abs(a - b) < 0.6, `纯响段 ${a.toFixed(2)} vs 加静音 ${b.toFixed(2)}`);
});

test('integratedLoudness: 短于 400ms 按整段均方计算', () => {
  const sig = sine(997, 0.1, 48000, 0.2);
  const lufs = L.integratedLoudness(sig, 48000);
  assert.ok(Math.abs(lufs - (-23.0)) < 0.4, '实际 ' + lufs.toFixed(2));
});

test('normalizeToLufs: 归一到 -16 LUFS 且结果可复测', () => {
  const sig = sine(997, 0.1, 48000, 2);
  const r = L.normalizeToLufs(sig, 48000, -16);
  assert.ok(r.gainDb > 5 && r.gainDb < 9, '增益 ' + r.gainDb.toFixed(2) + ' dB');
  assert.ok(Math.abs(r.outLufs - (-16)) < 0.1, '复测 ' + r.outLufs.toFixed(2));
  assert.equal(r.samples.length, sig.length);
  assert.equal(sig[1000], sine(997, 0.1, 48000, 2)[1000], '不修改原数组');
});

test('normalizeToLufs: 静音原样返回（同引用、增益 0）', () => {
  const sig = silence(48000, 1);
  const r = L.normalizeToLufs(sig, 48000, -16);
  assert.equal(r.samples, sig);
  assert.equal(r.gainDb, 0);
  assert.equal(r.lufs, -Infinity);
});

test('kWeightingCoeffs: 系数稳定（48k 与 44.1k 均为有限值）', () => {
  for (const sr of [44100, 48000, 22050]) {
    const { pre, rlb } = L.kWeightingCoeffs(sr);
    for (const k of ['b0', 'b1', 'b2', 'a1', 'a2']) {
      assert.ok(isFinite(pre[k]), `${sr} pre.${k}`);
      assert.ok(isFinite(rlb[k]), `${sr} rlb.${k}`);
    }
  }
});
