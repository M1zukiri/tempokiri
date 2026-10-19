/**
 * test_exportPrefs.js — 导出参数记忆清洗测试（A5-4）。
 *
 * 创建时间：2026-10-19 18:17:00
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/exportPrefs.js');

test('sanitizeExportPrefs: 非对象输入返回 null', () => {
  assert.equal(P.sanitizeExportPrefs(null), null);
  assert.equal(P.sanitizeExportPrefs('x'), null);
  assert.equal(P.sanitizeExportPrefs([]), null);
  assert.deepEqual(P.sanitizeExportPrefs({}), {});
});

test('sanitizeExportPrefs: 数值夹取与枚举回落', () => {
  const r = P.sanitizeExportPrefs({
    audio: { format: 'flac', bitDepth: 20, mp3Bitrate: 999, sampleRate: 96000, peakDb: 5, crossfadeMs: -3, fadeInMs: 99999, lufsTarget: '-16' },
  });
  assert.equal(r.audio.format, 'wav');
  assert.equal(r.audio.bitDepth, 16);
  assert.equal(r.audio.mp3Bitrate, 320);
  assert.equal(r.audio.sampleRate, 'src');
  assert.equal(r.audio.peakDb, 0);
  assert.equal(r.audio.crossfadeMs, 0);
  assert.equal(r.audio.fadeInMs, 10000);
  assert.equal(r.audio.lufsTarget, -16);
});

test('sanitizeExportPrefs: 合法值原样保留，布尔与可选字段', () => {
  const r = P.sanitizeExportPrefs({
    audio: { format: 'mp3', bitDepth: 24, mp3Bitrate: 192, sampleRate: '48000', normalize: 1, peakDb: -3, lufsTarget: null, crossfadeMs: 30, fadeInMs: 300, fadeOutMs: 200 },
    video: { videoBitrate: 4e6, framerate: '30', resolution: '720p', audioBitrate: 192000, includeAudio: false },
    majdata: { videoBitrate: 6e6, mp3Bitrate: 192, normalize: true, peakDb: -1, padBar: true },
    data: { format: 'json' },
  });
  assert.equal(r.audio.format, 'mp3');
  assert.equal(r.audio.normalize, true);
  assert.equal(r.audio.lufsTarget, null);
  assert.equal(r.audio.fadeInMs, 300);
  assert.equal(r.video.framerate, '30');
  assert.equal(r.video.includeAudio, false);
  assert.equal(r.majdata.mp3Bitrate, 192);
  assert.equal(r.majdata.padBar, true);
  assert.equal(r.data.format, 'json');
});

test('sanitizeExportPrefs: 缺失的 Tab 不生成键', () => {
  const r = P.sanitizeExportPrefs({ audio: { format: 'wav' } });
  assert.ok(r.audio);
  assert.equal(r.video, undefined);
  assert.equal(r.data, undefined);
});
