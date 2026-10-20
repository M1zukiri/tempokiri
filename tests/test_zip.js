/**
 * test_zip.js — 最小 ZIP 打包测试（A5-5）。
 *
 * 创建时间：2026-10-19 18:42:00
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../src/zip.js');

test('crc32: 标准校验值', () => {
  assert.equal(Z.crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
});

test('createZip: 单文件结构可解析（签名/文件名/大小/CRC）', () => {
  const data = Uint8Array.from([1, 2, 3, 4, 5]);
  const zip = Z.createZip([{ name: 'a.wav', data }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50, '本地文件头签名');
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLen = view.getUint16(26, true);
  assert.equal(nameLen, 5);
  const name = Buffer.from(zip.subarray(30, 30 + 5)).toString('utf8');
  assert.equal(name, 'a.wav');
  assert.equal(view.getUint16(8, true), 0, 'store 方式');
  assert.equal(view.getUint32(18, true), 5, '压缩后大小');
  assert.equal(view.getUint32(22, true), 5, '原始大小');
  assert.equal(view.getUint32(14, true), Z.crc32(data), 'CRC');
  // EOCD 在末尾
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 1, '条目数');
});

test('createZip: 多文件、UTF-8 文件名、中央目录偏移一致', () => {
  const a = Uint8Array.from([9, 9, 9]);
  const b = Uint8Array.from([7, 7]);
  const zip = Z.createZip([{ name: '第1段.wav', data: a }, { name: 'seg-2.mp3', data: b }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  const count = view.getUint16(eocd + 10, true);
  assert.equal(count, 2);
  const centralStart = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(centralStart, true), 0x02014b50, '中央目录签名');
  // 第一项中央目录里的本地头偏移应为 0
  assert.equal(view.getUint32(centralStart + 42, true), 0);
  // 文件名 UTF-8 字节数（第1段.wav：3+3+1+3+4 = 3 CJK ×3 + "1" + ".wav" = 9+1+4=14）
  const nameLen1 = view.getUint16(centralStart + 28, true);
  assert.equal(nameLen1, 11); // 第1段.wav = 3+1+3+1+3 字节
});

test('createZip: 空列表生成合法空 ZIP', () => {
  const zip = Z.createZip([]);
  assert.equal(zip.length, 22);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x06054b50);
  assert.equal(view.getUint16(10, true), 0);
});
