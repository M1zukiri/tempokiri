// 创建时间：2026-08-19 20:26:36
/**
 * test_metadata.js — 元数据解析/附加/合并测试（node --test）。
 * 运行：node --test tests/test_metadata.js
 *
 * 全部使用手写字节 fixture（不依赖外部样本文件），断言即功能定义：
 * 解析（parseMetadata 按容器分派）、附加（attachToMp3/attachToWav 往返回读）、
 * 合并（mergeMeta 编辑覆盖语义）。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/metadata.js');
const E = require('../src/export.js');

// ---------- fixture helpers ----------
const u8 = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 0xff);
    else if (p instanceof Uint8Array || Array.isArray(p)) for (const b of p) out.push(b);
    else if (p instanceof ArrayBuffer) for (const b of new Uint8Array(p)) out.push(b);
  }
  return new Uint8Array(out);
};
const str = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const latin1 = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
const u32BE = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const u32LE = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const u24BE = (n) => new Uint8Array([(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const syncsafe = (n) => new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);
const emptyMeta = () => ({ title: null, artist: null, album: null, composer: null, year: null, genre: null, cover: null });

// ID3v2 文本帧（encoding 3 UTF-8）与 APIC 帧
const id3Text = (enc, s) => {
  let body;
  if (enc === 3) body = u8([3], str(s));
  else if (enc === 1) body = u8([1, 0xff, 0xfe], new Uint8Array(Buffer.from(s, 'utf16le')));
  return body;
};
const id3Frame = (id, content) => u8(str(id), u32BE(content.length), [0, 0], content);
const id3v23 = (frames) => {
  const body = u8(...frames);
  return u8(str('ID3'), [3, 0, 0], syncsafe(body.length), body);
};
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const APIC = u8([0], str('image/png'), [0, 0x03, 0], PNG);

const FIELDS = ['title', 'artist', 'album', 'composer', 'year', 'genre'];

// ---------- 解析：ID3v2 ----------
test('parseMetadata: ID3v2.3 全字段与封面', () => {
  const frames = [
    id3Frame('TIT2', id3Text(3, '测试标题')),
    id3Frame('TPE1', id3Text(3, '测试艺术家')),
    id3Frame('TALB', id3Text(3, '测试专辑')),
    id3Frame('TCOM', id3Text(3, '测试作曲家')),
    id3Frame('TYER', id3Text(3, '2024')),
    id3Frame('TCON', id3Text(3, '电子')),
    id3Frame('APIC', APIC),
  ];
  const m = M.parseMetadata(id3v23(frames), 'mp3');
  assert.equal(m.title, '测试标题');
  assert.equal(m.artist, '测试艺术家');
  assert.equal(m.album, '测试专辑');
  assert.equal(m.composer, '测试作曲家');
  assert.equal(m.year, '2024');
  assert.equal(m.genre, '电子');
  assert.ok(m.cover, '应解析出封面');
  assert.equal(m.cover.mime, 'image/png');
  assert.deepEqual(Array.from(m.cover.data), PNG);
});

test('parseMetadata: ID3v2.4 TDRC 年份取前 4 位', () => {
  const frames = [id3Frame('TDRC', id3Text(3, '2024-05-01'))];
  const buf = u8(str('ID3'), [4, 0, 0], syncsafe(frames[0].length), frames[0]);
  const m = M.parseMetadata(buf, 'mp3');
  assert.equal(m.year, '2024');
});

test('parseMetadata: ID3v2 帧 encoding 1（UTF-16 BOM）中文解码', () => {
  const frames = [id3Frame('TIT2', id3Text(1, '中文标题'))];
  const m = M.parseMetadata(id3v23(frames), 'mp3');
  assert.equal(m.title, '中文标题');
});

test('parseMetadata: ID3v1 兜底（无 ID3v2 头）', () => {
  // ID3v1 字段仅支持 Latin-1，fixture 用 ASCII 文本
  const t30 = (s) => new Uint8Array(Buffer.from(s.padEnd(30, '\0'), 'latin1'));
  const buf = u8(str('XXXX'), new Uint8Array(96), str('TAG'), t30('Old Song'), t30('Someone'), t30('Old Album'), str('1999'), new Uint8Array(30), [0]);
  const m = M.parseMetadata(buf, 'mp3');
  assert.equal(m.title, 'Old Song');
  assert.equal(m.artist, 'Someone');
  assert.equal(m.album, 'Old Album');
  assert.equal(m.year, '1999');
  assert.equal(m.genre, null);
});

// ---------- 解析：FLAC ----------
test('parseMetadata: FLAC Vorbis Comment + PICTURE 块', () => {
  const comment = u8(
    u32LE(4), str('libF'), // vendor
    u32LE(2),
    u32LE(str('TITLE=FLAC 标题').length), str('TITLE=FLAC 标题'),
    u32LE(str('ARTIST=某人').length), str('ARTIST=某人')
  );
  const picture = u8(
    u32LE(3), u32LE(9), str('image/png'), u32LE(0),
    u32LE(0), u32LE(0), u32LE(0), u32LE(0),
    u32LE(PNG.length), PNG
  );
  const buf = u8(
    str('fLaC'),
    [0x04], u24BE(comment.length), comment, // type 4，非最后块
    [0x86], u24BE(picture.length), picture  // last=1, type 6
  );
  const m = M.parseMetadata(buf, 'flac');
  assert.equal(m.title, 'FLAC 标题');
  assert.equal(m.artist, '某人');
  assert.equal(m.album, null);
  assert.equal(m.composer, null);
  assert.equal(m.year, null);
  assert.equal(m.genre, null);
  assert.ok(m.cover);
  assert.equal(m.cover.mime, 'image/png');
  assert.deepEqual(Array.from(m.cover.data), PNG);
});

// ---------- 解析：OGG ----------
test('parseMetadata: OGG OpusTags（含 METADATA_BLOCK_PICTURE）', () => {
  const picPayload = u8(
    u32LE(3), u32LE(9), str('image/png'), u32LE(0),
    u32LE(0), u32LE(0), u32LE(0), u32LE(0),
    u32LE(PNG.length), PNG
  );
  const b64 = Buffer.from(picPayload).toString('base64');
  const packet0 = u8(str('OpusHead'), new Uint8Array(15));
  const packet1 = u8(
    str('OpusTags'),
    u32LE(0), // vendor 长 0
    u32LE(3),
    u32LE(str('TITLE=OGG 标题').length), str('TITLE=OGG 标题'),
    u32LE(str('ARTIST=某人').length), str('ARTIST=某人'),
    u32LE(str('METADATA_BLOCK_PICTURE=' + b64).length), str('METADATA_BLOCK_PICTURE=' + b64)
  );
  // 单页两包：segment_table = [packet0 长, packet1 长]（均 < 255）
  const segTable = [packet0.length, packet1.length];
  const page = u8(
    str('OggS'), [0, 0x02],
    new Uint8Array(8), // granule 0
    u32LE(0x11223344), u32LE(0), // serial / page_seq
    new Uint8Array(4), // CRC 全 0，解析器不校验
    [segTable.length], segTable,
    packet0, packet1
  );
  const m = M.parseMetadata(page, 'opus');
  assert.equal(m.title, 'OGG 标题');
  assert.equal(m.artist, '某人');
  assert.ok(m.cover);
  assert.equal(m.cover.mime, 'image/png');
  assert.deepEqual(Array.from(m.cover.data), PNG);
});

// ---------- 解析：MP4 ilst ----------
test('parseMetadata: MP4 moov/udta/meta/ilst 盒子', () => {
  const box = (type, payload) => u8(u32BE(8 + payload.length), latin1(type), payload);
  const dataBox = (type, payload) => box('data', u8(u32BE(type), u32BE(0), payload));
  const items = [
    box('©nam', dataBox(1, str('MP4 标题'))),
    box('©ART', dataBox(1, str('MP4 艺术家'))),
    box('©alb', dataBox(1, str('MP4 专辑'))),
    box('©wrt', dataBox(1, str('MP4 作曲家'))),
    box('©day', dataBox(1, str('2026-03-15T00:00:00Z'))),
    box('©gen', dataBox(1, str('电子'))),
    box('covr', dataBox(13, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))),
  ];
  // meta 是 full box：version/flags 4 字节在 payload 前
  const meta = u8(u32BE(8 + 4 + box('ilst', u8(...items)).length), latin1('meta'), [0, 0, 0, 0], box('ilst', u8(...items)));
  const buf = box('moov', box('udta', meta));
  const m = M.parseMetadata(buf, 'm4a');
  assert.equal(m.title, 'MP4 标题');
  assert.equal(m.artist, 'MP4 艺术家');
  assert.equal(m.album, 'MP4 专辑');
  assert.equal(m.composer, 'MP4 作曲家');
  assert.equal(m.year, '2026');
  assert.equal(m.genre, '电子');
  assert.ok(m.cover);
  assert.equal(m.cover.mime, 'image/jpeg');
  assert.deepEqual(Array.from(m.cover.data), [0xff, 0xd8, 0xff, 0xd9]);
});

// ---------- 解析：WAV LIST/INFO ----------
test('parseMetadata: WAV LIST/INFO chunk', () => {
  const u16LE = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const sub = (id, s) => {
    const b = str(s);
    const pad = b.length % 2 === 1 ? [0] : [];
    return u8(str(id), u32LE(b.length), b, pad);
  };
  // fmt 体标准 16 字节：audioFormat u16 + channels u16 + sampleRate u32 + byteRate u32 + blockAlign u16 + bits u16
  const fmt = u8(str('fmt '), u32LE(16), u16LE(1), u16LE(1), u32LE(44100), u32LE(88200), u16LE(2), u16LE(16));
  const listPayload = u8(str('INFO'), sub('INAM', 'WAV 标题'), sub('IART', 'WAV 艺术家'), sub('IPRD', 'WAV 专辑'), sub('IMUS', 'WAV 作曲家'), sub('ICRD', '2021'), sub('IGNR', '摇滚'));
  const list = u8(str('LIST'), u32LE(listPayload.length), listPayload);
  const data = u8(str('data'), u32LE(4), new Uint8Array(4));
  const buf = u8(str('RIFF'), u32LE(4 + fmt.length + list.length + data.length), str('WAVE'), fmt, list, data);
  const m = M.parseMetadata(buf, 'wav');
  assert.equal(m.title, 'WAV 标题');
  assert.equal(m.artist, 'WAV 艺术家');
  assert.equal(m.album, 'WAV 专辑');
  assert.equal(m.composer, 'WAV 作曲家');
  assert.equal(m.year, '2021');
  assert.equal(m.genre, '摇滚');
  assert.equal(m.cover, null);
});

// ---------- 解析：静默失败 ----------
test('parseMetadata: 未知扩展名与垃圾字节静默返回空 meta', () => {
  assert.deepEqual(M.parseMetadata(new Uint8Array([1, 2, 3]), 'xyz'), emptyMeta());
  assert.deepEqual(M.parseMetadata(new Uint8Array([0xff, 0x00, 0x12, 0x34, 0x56]), 'mp3'), emptyMeta());
  assert.doesNotThrow(() => M.parseMetadata(new Uint8Array([1, 2, 3]), 'mp3'));
});

// ---------- 附加：MP3 ----------
test('attachToMp3: 空 meta 返回原 buffer（引用相等）', () => {
  const buf = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
  assert.equal(M.attachToMp3(buf, emptyMeta()), buf);
});

test('attachToMp3: 非空 meta 生成 ID3v2.3 头且往返一致', () => {
  const stream = new Uint8Array(100).fill(0xff);
  for (let i = 0; i < stream.length; i += 4) stream[i + 1] = 0xfb;
  const meta = {
    title: '往返标题', artist: '往返艺术家', album: '往返专辑',
    composer: '往返作曲家', year: '2025', genre: '流行',
    cover: { data: new Uint8Array(PNG), mime: 'image/png' },
  };
  const out = new Uint8Array(M.attachToMp3(stream, meta));
  assert.equal(String.fromCharCode(out[0], out[1], out[2]), 'ID3');
  assert.equal(out[3], 0x03, 'ID3v2.3');
  assert.equal(out[4], 0x00);
  const bodyLen = (out[6] << 21) | (out[7] << 14) | (out[8] << 7) | out[9];
  assert.equal(bodyLen, out.length - 10 - stream.length, 'syncsafe 大小 = 帧部分总长（不含 ID3 头与 MPEG 音频）');
  // 尾部帧流原样
  assert.deepEqual(Array.from(out.subarray(out.length - 100)), Array.from(stream));
  // 回读一致
  const m = M.parseMetadata(out.buffer, 'mp3');
  assert.equal(m.title, meta.title);
  assert.equal(m.artist, meta.artist);
  assert.equal(m.album, meta.album);
  assert.equal(m.composer, meta.composer);
  assert.equal(m.year, meta.year);
  assert.equal(m.genre, meta.genre);
  assert.equal(m.cover.mime, 'image/png');
  assert.deepEqual(Array.from(m.cover.data), PNG);
});

// ---------- 附加：WAV ----------
test('attachToWav: 空 meta 返回原 buffer（引用相等）', () => {
  const buf = E.encodeWav(new Float32Array(100), 44100, 16);
  assert.equal(M.attachToWav(buf, emptyMeta()), buf);
});

test('attachToWav: 非空 meta 插入 LIST/INFO 且结构完好', () => {
  const src = E.encodeWav(new Float32Array(100).fill(0.25), 44100, 16);
  const srcBytes = new Uint8Array(src);
  const meta = {
    title: 'WAV 附加标题', artist: '附加艺术家', album: '附加专辑',
    composer: '附加作曲家', year: '2020', genre: '电子', cover: null,
  };
  const out = new Uint8Array(M.attachToWav(src, meta));
  // 魔数不变
  assert.equal(String.fromCharCode(out[0], out[1], out[2], out[3]), 'RIFF');
  assert.equal(String.fromCharCode(out[8], out[9], out[10], out[11]), 'WAVE');
  // RIFF size = 原 size + LIST 总长（含 8 字节头）
  const origSize = (srcBytes[4] | (srcBytes[5] << 8) | (srcBytes[6] << 16) | (srcBytes[7] << 24)) >>> 0;
  const newSize = (out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24)) >>> 0;
  assert.ok(newSize > origSize);
  // fmt chunk 原样（偏移 12 起：'fmt ' 头 + 16 字节体，至偏移 36；RIFF size 字段必然变化，不比较）
  assert.deepEqual(Array.from(out.subarray(12, 36)), Array.from(srcBytes.subarray(12, 36)));
  // LIST 位于 fmt 与 data 之间；data chunk 数据区与原输入逐字节相等
  const listOff = 12 + 8 + 16;
  assert.equal(String.fromCharCode(out[listOff], out[listOff + 1], out[listOff + 2], out[listOff + 3]), 'LIST');
  const listSize = (out[listOff + 4] | (out[listOff + 5] << 8) | (out[listOff + 6] << 16) | (out[listOff + 7] << 24)) >>> 0;
  const dataOff = listOff + 8 + listSize;
  assert.equal(String.fromCharCode(out[dataOff], out[dataOff + 1], out[dataOff + 2], out[dataOff + 3]), 'data');
  assert.deepEqual(Array.from(out.subarray(dataOff)), Array.from(srcBytes.subarray(36)));
  // 回读一致
  const m = M.parseMetadata(out.buffer, 'wav');
  assert.equal(m.title, meta.title);
  assert.equal(m.artist, meta.artist);
  assert.equal(m.album, meta.album);
  assert.equal(m.composer, meta.composer);
  assert.equal(m.year, meta.year);
  assert.equal(m.genre, meta.genre);
});

// ---------- 合并 ----------
test('mergeMeta: 编辑值覆盖解析值、空串清空、cover 恒取解析值', () => {
  const parsed = { title: '解析值', artist: '解析值', album: null, composer: null, year: null, genre: null, cover: { data: new Uint8Array(PNG), mime: 'image/png' } };
  const merged = M.mergeMeta(parsed, { title: '编辑值', artist: '', album: '编辑专辑' });
  assert.equal(merged.title, '编辑值');
  assert.equal(merged.artist, '');
  assert.equal(merged.album, '编辑专辑');
  assert.equal(merged.composer, null);
  assert.equal(merged.cover, parsed.cover);
});
