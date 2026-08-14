/**
 * test_audio.js — 视频音轨 PCM 提取测试（node --test）。
 *
 * 重点回归：AudioDecoder 输出为平面布局（f32-planar），若把平面数据当
 * 交错布局读取，立体声每个 chunk 后半段读到 0，产生周期性“有声→静音”
 * 锯齿音。mixPlanarChunks 必须按平面索引混合。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/audio.js');

test('mixPlanarChunks: 立体声按平面索引混合（不产生半段静音）', () => {
  const frames = 1024;
  // 模拟立体声平面布局：planar[ch * frames + i]，左声道 0.5 正弦、右声道 -0.5 正弦
  const planar = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    planar[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;          // 左
    planar[frames + i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5; // 右
  }
  const mono = A.mixPlanarChunks([{ data: planar, channels: 2 }]);
  assert.equal(mono.length, frames);
  // 与 bug 版（交错读取）对比：bug 版后半 512 样本全是 0
  let frontActive = 0;
  let backActive = 0;
  for (let i = 0; i < 512; i++) if (Math.abs(mono[i]) > 1e-3) frontActive++;
  for (let i = 512; i < frames; i++) if (Math.abs(mono[i]) > 1e-3) backActive++;
  assert.ok(frontActive > 400, '前半段应活跃');
  assert.ok(backActive > 400, '后半段应活跃（bug 版此处为 0）');
  // 混合正确性：mono[i] = (L + R) / 2 = 正弦 * 0.5
  assert.ok(Math.abs(mono[100] - Math.sin((2 * Math.PI * 440 * 100) / 48000) * 0.5) < 1e-6);
});

test('mixPlanarChunks: 单声道原样复制', () => {
  const data = new Float32Array([1, -1, 0.5, 0.25]);
  const mono = A.mixPlanarChunks([{ data, channels: 1 }]);
  assert.deepEqual(Array.from(mono), [1, -1, 0.5, 0.25]);
});

test('mixPlanarChunks: 多 chunk 顺序拼接', () => {
  const c1 = { data: new Float32Array([0.2, 0.4, 0.6, 0.8]), channels: 1 };
  const c2 = { data: new Float32Array([0.1, 0.3, 0.5, 0.7]), channels: 1 };
  const mono = A.mixPlanarChunks([c1, c2]);
  const exp = [0.2, 0.4, 0.6, 0.8, 0.1, 0.3, 0.5, 0.7];
  for (let i = 0; i < exp.length; i++) assert.ok(Math.abs(mono[i] - exp[i]) < 1e-6);
});

/** 构造标准 WAV 头（44 字节，PCM，无数据）。 */
function wavHeader(sampleRate, channels = 1, bits = 16) {
  const buf = new ArrayBuffer(44);
  const dv = new DataView(buf);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  dv.setUint32(4, 36, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, (sampleRate * channels * bits) / 8, true);
  dv.setUint16(32, (channels * bits) / 8, true);
  dv.setUint16(34, bits, true);
  w(36, 'data');
  dv.setUint32(40, 0, true);
  return buf;
}

test('readWavSampleRate: 解析 RIFF fmt chunk 采样率', () => {
  assert.equal(A.readWavSampleRate(wavHeader(44100)), 44100);
  assert.equal(A.readWavSampleRate(wavHeader(48000)), 48000);
  assert.equal(A.readWavSampleRate(wavHeader(22050)), 22050);
  assert.equal(A.readWavSampleRate(wavHeader(96000, 2, 24)), 96000);
});

test('readWavSampleRate: 非 WAV/非法输入返回 null', () => {
  assert.equal(A.readWavSampleRate(new ArrayBuffer(10)), null, '不足 44 字节');
  assert.equal(A.readWavSampleRate(new ArrayBuffer(44)), null, '全零无 RIFF 标记');
  assert.equal(A.readWavSampleRate(new Uint8Array(64).buffer), null, '无 RIFF/WAVE 标记');
});
