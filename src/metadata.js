// 创建时间：2026-08-19 20:26:36
/**
 * metadata.js — 音频/视频元数据解析与导出附加（纯函数，Node 可测）。
 *
 * 数据模型（统一规范化）：
 *   meta = { title, artist, album, composer, year, genre: string|null,
 *            cover: { data: Uint8Array, mime: string } | null }
 *
 * 解析按容器分派（导入侧）：
 *   mp3  → ID3v2.3/2.4（ID3v1 兜底）
 *   flac → Vorbis Comment + PICTURE 块
 *   ogg/oga/opus → OGG 页拆包 → OpusTags / Vorbis comment
 *   m4a/mp4/m4v/mov → moov/udta/meta/ilst 盒子（手写，mp4box 无 onMeta）
 *   wav  → LIST/INFO chunk
 *   其他/失败 → 空 meta（静默，不抛错）
 *
 * 附加按目标格式写入（导出侧）：
 *   attachToMp3 → 帧流前置 ID3v2.3 头（UTF-16 文本帧 + APIC）
 *   attachToWav → fmt 与 data 之间插 LIST/INFO chunk（UTF-8）
 *   空 meta 一律返回原 buffer（零开销）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TEXT_FIELDS = ['title', 'artist', 'album', 'composer', 'year', 'genre'];

  function emptyMeta() {
    return { title: null, artist: null, album: null, composer: null, year: null, genre: null, cover: null };
  }
  function normalize(s) {
    return s == null || s === '' ? null : String(s);
  }

  // ---------- 字节 helpers ----------
  function u8view(buf) {
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  }
  function ascii(bytes, start, end) {
    let s = '';
    for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  const u8str = (s) => new TextEncoder().encode(s);
  function u32be(n) { return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]); }
  function u32le(n) { return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]); }
  function syncsafeWrite(n) { return new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]); }
  function syncsafeRead(bytes, off) {
    return ((bytes[off] & 0x7f) << 21) | ((bytes[off + 1] & 0x7f) << 14) | ((bytes[off + 2] & 0x7f) << 7) | (bytes[off + 3] & 0x7f);
  }
  function concatBytes(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
  function base64ToBytes(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  function sniffMime(b) {
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    return 'application/octet-stream';
  }
  /** UTF-16LE 编码（TextEncoder 只支持 UTF-8，必须手写；含代理对处理）。 */
  function utf16leBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let cp = s.codePointAt(i);
      if (cp > 0xffff) {
        i++;
        cp -= 0x10000;
        const hi = 0xd800 + (cp >> 10);
        const lo = 0xdc00 + (cp & 0x3ff);
        out.push(hi & 0xff, (hi >> 8) & 0xff, lo & 0xff, (lo >> 8) & 0xff);
      } else {
        out.push(cp & 0xff, (cp >> 8) & 0xff);
      }
    }
    return new Uint8Array(out);
  }
  /** ID3 文本解码：enc 0=Latin-1 1=UTF-16(BOM) 2=UTF-16BE 3=UTF-8；剥尾部与首段 null。 */
  function decodeText(bytes, start, end, enc) {
    const slice = bytes.subarray(start, end);
    let s;
    if (enc === 0) s = new TextDecoder('iso-8859-1').decode(slice);
    else if (enc === 1) {
      let off = 0;
      let label = 'utf-16be';
      if (slice.length >= 2 && slice[0] === 0xff && slice[1] === 0xfe) { label = 'utf-16le'; off = 2; }
      else if (slice.length >= 2 && slice[0] === 0xfe && slice[1] === 0xff) { label = 'utf-16be'; off = 2; }
      s = new TextDecoder(label).decode(slice.subarray(off));
    } else if (enc === 2) s = new TextDecoder('utf-16be').decode(slice);
    else s = new TextDecoder('utf-8').decode(slice);
    return s.split('\0')[0].replace(/\u0000+$/, '');
  }

  // ---------- ID3v2 ----------
  const ID3_TEXT_MAP = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCOM: 'composer', TCON: 'genre' };

  function parseApic(bytes, start, end) {
    let off = start;
    if (off >= end) return null;
    const enc = bytes[off++];
    const mimeStart = off;
    while (off < end && bytes[off] !== 0) off++;
    if (off >= end) return null;
    const mime = new TextDecoder('iso-8859-1').decode(bytes.subarray(mimeStart, off));
    off++; // mime cstr 结束
    if (off >= end) return null;
    off++; // picType
    if (enc === 1 || enc === 2) {
      while (off + 1 < end && !(bytes[off] === 0 && bytes[off + 1] === 0)) off += 2;
      off += 2; // desc cstr（UTF-16 双字节结束）
    } else {
      while (off < end && bytes[off] !== 0) off++;
      off++; // desc cstr 结束
    }
    if (off > end) return null;
    return { data: bytes.slice(off, end), mime: mime || 'image/' };
  }

  function parseId3v2(buf) {
    const bytes = u8view(buf);
    if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') return null;
    const ver = bytes[3];
    if (ver !== 3 && ver !== 4) return null;
    const size = syncsafeRead(bytes, 6);
    const end = Math.min(10 + size, bytes.length);
    const meta = emptyMeta();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 10;
    while (off + 10 <= end) {
      const id = ascii(bytes, off, off + 4);
      const fsize = dv.getUint32(off + 4, false);
      if (fsize === 0) break; // 防死循环（缺失/填充帧）
      const fstart = off + 10;
      const fend = fstart + fsize;
      if (fend > end) break;
      if (id === 'APIC') {
        if (!meta.cover) meta.cover = parseApic(bytes, fstart, fend);
      } else if (id === 'TYER' && ver === 3) {
        if (fend > fstart) meta.year = normalize(decodeText(bytes, fstart + 1, fend, bytes[fstart]).slice(0, 4));
      } else if (id === 'TDRC' && ver === 4) {
        if (fend > fstart) meta.year = normalize(decodeText(bytes, fstart + 1, fend, bytes[fstart]).slice(0, 4));
      } else {
        const field = ID3_TEXT_MAP[id];
        if (field && fend > fstart) meta[field] = normalize(decodeText(bytes, fstart + 1, fend, bytes[fstart]));
      }
      off = fend;
    }
    return meta;
  }

  // ---------- ID3v1 ----------
  function parseId3v1(buf) {
    const bytes = u8view(buf);
    const meta = emptyMeta();
    if (bytes.length < 128) return meta;
    const start = bytes.length - 128;
    if (ascii(bytes, start, start + 3) !== 'TAG') return meta;
    const field = (s, e) => {
      const v = new TextDecoder('iso-8859-1').decode(bytes.subarray(s, e)).split('\0')[0];
      return normalize(v);
    };
    meta.title = field(start + 3, start + 33);
    meta.artist = field(start + 33, start + 63);
    meta.album = field(start + 63, start + 93);
    meta.year = field(start + 93, start + 97);
    return meta;
  }

  // ---------- Vorbis Comment（FLAC 块 / OGG 包共用） ----------
  function parsePictureBlock(bytes, start, end) {
    const len = end - start;
    if (len < 4) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + start, len);
    let off = 0;
    off += 4; // picture type（不校验）
    if (off + 4 > len) return null;
    const mimeLen = dv.getUint32(off, true); off += 4;
    if (off + mimeLen + 4 > len) return null;
    const mime = new TextDecoder('iso-8859-1').decode(bytes.subarray(start + off, start + off + mimeLen));
    off += mimeLen;
    if (off + 4 > len) return null;
    const descLen = dv.getUint32(off, true); off += 4;
    off += descLen + 16; // desc + 宽/高/位深/颜色数
    if (off + 4 > len) return null;
    const dataLen = dv.getUint32(off, true); off += 4;
    if (off + dataLen > len) return null;
    return { data: bytes.slice(start + off, start + off + dataLen), mime: mime || 'image/' };
  }

  function parseVorbisEntries(bytes, off, end, meta) {
    if (off + 4 > end) return;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const vendorLen = dv.getUint32(off, true);
    off += 4 + vendorLen;
    if (off + 4 > end) return;
    const count = dv.getUint32(off, true);
    off += 4;
    for (let i = 0; i < count && off + 4 <= end; i++) {
      const len = dv.getUint32(off, true);
      off += 4;
      if (off + len > end) break;
      const kv = new TextDecoder('utf-8').decode(bytes.subarray(off, off + len));
      off += len;
      const eq = kv.indexOf('=');
      if (eq <= 0) continue;
      const key = kv.slice(0, eq).toUpperCase();
      const val = kv.slice(eq + 1);
      if (key === 'TITLE') meta.title = normalize(val);
      else if (key === 'ARTIST') meta.artist = normalize(val);
      else if (key === 'ALBUM') meta.album = normalize(val);
      else if (key === 'COMPOSER') meta.composer = normalize(val);
      else if (key === 'DATE') meta.year = normalize(val.slice(0, 4));
      else if (key === 'GENRE') meta.genre = normalize(val);
      else if (key === 'METADATA_BLOCK_PICTURE') {
        if (meta.cover) continue;
        try {
          const pic = base64ToBytes(val);
          const c = parsePictureBlock(pic, 0, pic.length);
          if (c) meta.cover = c;
        } catch (e) { /* 忽略坏条目 */ }
      } else if (key === 'COVERART') {
        if (meta.cover) continue;
        try {
          const pic = base64ToBytes(val);
          meta.cover = { data: pic, mime: sniffMime(pic) };
        } catch (e) { /* 忽略坏条目 */ }
      }
    }
  }

  // ---------- FLAC ----------
  function parseFlac(buf) {
    const bytes = u8view(buf);
    const meta = emptyMeta();
    if (bytes.length < 4 || ascii(bytes, 0, 4) !== 'fLaC') return meta;
    let off = 4;
    while (off + 4 <= bytes.length) {
      const hdr = bytes[off];
      const last = hdr & 0x80;
      const type = hdr & 0x7f;
      const size = ((bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
      off += 4;
      if (off + size > bytes.length) break;
      if (type === 4) parseVorbisEntries(bytes, off, off + size, meta);
      else if (type === 6 && !meta.cover) {
        const c = parsePictureBlock(bytes, off, off + size);
        if (c) meta.cover = c;
      }
      off += size;
      if (last) break;
    }
    return meta;
  }

  // ---------- OGG ----------
  function parseOgg(buf) {
    const bytes = u8view(buf);
    const meta = emptyMeta();
    if (bytes.length < 27 || ascii(bytes, 0, 4) !== 'OggS') return meta;
    const packets = [];
    let cur = null;
    let off = 0;
    while (off + 27 <= bytes.length && ascii(bytes, off, off + 4) === 'OggS') {
      if (bytes[off + 4] !== 0) return meta; // 版本必须为 0
      const segCount = bytes[off + 26];
      if (off + 27 + segCount > bytes.length) return meta;
      let dataOff = off + 27 + segCount;
      for (let i = 0; i < segCount; i++) {
        const segLen = bytes[off + 27 + i];
        if (dataOff + segLen > bytes.length) return meta;
        if (cur === null) cur = [];
        cur.push(bytes.subarray(dataOff, dataOff + segLen));
        dataOff += segLen;
        if (segLen < 255) { packets.push(concatBytes(cur)); cur = null; } // 段长 <255 表示包结束
      }
      off = dataOff;
    }
    if (packets.length < 2) return meta;
    const p0 = packets[0];
    const head = ascii(p0, 0, Math.min(8, p0.length));
    let comment = null;
    let coff = 0;
    if (head.startsWith('OpusHead')) {
      comment = packets[1];
      coff = 8; // OpusTags：'OpusTags' 后直接 vendor_length
    } else if (head.startsWith('vorbis')) {
      comment = packets[1];
      coff = 7; // Vorbis comment：packet_type(1) + 'vorbis'(6) 后直接 vendor_length
    }
    if (!comment) return meta;
    parseVorbisEntries(comment, coff, comment.length, meta);
    return meta;
  }

  // ---------- MP4 ilst ----------
  function findBox(dv, bytes, start, end, type) {
    let off = start;
    while (off + 8 <= end) {
      const size = dv.getUint32(off, false);
      let hdr = 8;
      if (size === 1) {
        if (off + 16 > end) return null;
        if (dv.getUint32(off + 8, false) !== 0) return null; // 不支持超大盒子
        size = dv.getUint32(off + 12, false);
        hdr = 16;
      } else if (size === 0) {
        size = end - off; // 延伸至末尾
      }
      if (size < hdr || off + size > end) return null;
      const t = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (t === type) return { start: off + hdr, end: off + size };
      off += size;
    }
    return null;
  }

  function parseMp4(buf) {
    const bytes = u8view(buf);
    const meta = emptyMeta();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = findBox(dv, bytes, 0, bytes.length, 'moov');
    if (!moov) return meta;
    const udta = findBox(dv, bytes, moov.start, moov.end, 'udta');
    if (!udta) return meta;
    const metaBox = findBox(dv, bytes, udta.start, udta.end, 'meta');
    if (!metaBox) return meta;
    const ilst = findBox(dv, bytes, metaBox.start + 4, metaBox.end, 'ilst'); // meta 是 full box：+4 version/flags
    if (!ilst) return meta;
    const MP4_MAP = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', '©wrt': 'composer', '©day': 'year', '©gen': 'genre' };
    let off = ilst.start;
    while (off + 8 <= ilst.end) {
      const size = dv.getUint32(off, false);
      if (size < 8 || off + size > ilst.end) break;
      const cc = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      const field = MP4_MAP[cc];
      const dataBox = findBox(dv, bytes, off + 8, off + size, 'data');
      if (dataBox && dataBox.end - dataBox.start >= 8) {
        const dtype = dv.getUint32(dataBox.start, false);
        const payload = bytes.subarray(dataBox.start + 8, dataBox.end);
        if (field && dtype === 1) {
          const v = new TextDecoder('utf-8').decode(payload).split('\0')[0];
          if (field === 'year') meta.year = normalize(v.slice(0, 4));
          else meta[field] = normalize(v);
        } else if (cc === 'covr' && !meta.cover && (dtype === 13 || dtype === 14)) {
          meta.cover = { data: payload.slice(), mime: dtype === 13 ? 'image/jpeg' : 'image/png' };
        }
      }
      off += size;
    }
    return meta;
  }

  // ---------- WAV LIST/INFO ----------
  function parseWav(buf) {
    const bytes = u8view(buf);
    const meta = emptyMeta();
    if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE') return meta;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const WAV_MAP = { INAM: 'title', IART: 'artist', IPRD: 'album', IMUS: 'composer', ICRD: 'year', IGNR: 'genre' };
    let off = 12;
    while (off + 8 <= bytes.length) {
      const id = ascii(bytes, off, off + 4);
      const size = dv.getUint32(off + 4, true);
      const payloadStart = off + 8;
      if (payloadStart + size > bytes.length) break;
      if (id === 'LIST' && size >= 4 && ascii(bytes, payloadStart, payloadStart + 4) === 'INFO') {
        let so = payloadStart + 4;
        const sEnd = payloadStart + size;
        while (so + 8 <= sEnd) {
          const sid = ascii(bytes, so, so + 4);
          const ssize = dv.getUint32(so + 4, true);
          if (so + 8 + ssize > sEnd) break;
          const field = WAV_MAP[sid];
          if (field) {
            let s;
            try {
              s = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(so + 8, so + 8 + ssize));
            } catch (e) {
              s = new TextDecoder('iso-8859-1').decode(bytes.subarray(so + 8, so + 8 + ssize));
            }
            meta[field] = normalize(s.split('\0')[0]);
          }
          so += 8 + ssize + (ssize & 1);
        }
      }
      off += 8 + size + (size & 1);
    }
    return meta;
  }

  // ---------- 入口 ----------
  /**
   * 解析文件字节的元数据（按扩展名分派，同步）。
   * @param {ArrayBuffer|Uint8Array} buf
   * @param {string} ext 文件扩展名（含点与否均可）
   * @returns {{title,artist,album,composer,year,genre,cover}} 解析失败返回全空（不抛错）
   */
  function parseMetadata(buf, ext) {
    try {
      const bytes = u8view(buf);
      const e = String(ext || '').toLowerCase().replace(/^\./, '');
      if (e === 'mp3') {
        const m = parseId3v2(bytes);
        if (m) return m;
        return parseId3v1(bytes);
      }
      if (e === 'flac') return parseFlac(bytes);
      if (e === 'ogg' || e === 'oga' || e === 'opus') return parseOgg(bytes);
      if (e === 'm4a' || e === 'mp4' || e === 'm4v' || e === 'mov') return parseMp4(bytes);
      if (e === 'wav') return parseWav(bytes);
    } catch (e) { /* 解析失败静默返回空 meta，不阻断主流程 */ }
    return emptyMeta();
  }

  // ---------- 导出附加 ----------
  const ID3_TO_CC = { title: 'TIT2', artist: 'TPE1', album: 'TALB', composer: 'TCOM', year: 'TYER', genre: 'TCON' };
  const WAV_TO_CC = { title: 'INAM', artist: 'IART', album: 'IPRD', composer: 'IMUS', year: 'ICRD', genre: 'IGNR' };

  /**
   * 给 MP3 帧流前置 ID3v2.3 标签（文本帧 UTF-16BE 带 BOM、APIC 原样）。
   * 空 meta 返回原 buffer。
   * @param {ArrayBuffer|Uint8Array} mp3Buf
   * @param {object} meta
   * @returns {ArrayBuffer}
   */
  function attachToMp3(mp3Buf, meta) {
    const m = meta || {};
    const fields = TEXT_FIELDS.filter((f) => m[f] != null && m[f] !== '');
    if (fields.length === 0 && !m.cover) return mp3Buf;
    const parts = [];
    for (const f of fields) {
      const content = concatBytes([new Uint8Array([1, 0xff, 0xfe]), utf16leBytes(String(m[f]))]);
      parts.push(concatBytes([u8str(ID3_TO_CC[f]), u32be(content.length), new Uint8Array([0, 0]), content]));
    }
    if (m.cover) {
      const content = concatBytes([new Uint8Array([0]), u8str(m.cover.mime || 'image/'), new Uint8Array([0, 0x03, 0]), m.cover.data]);
      parts.push(concatBytes([u8str('APIC'), u32be(content.length), new Uint8Array([0, 0]), content]));
    }
    const body = concatBytes(parts);
    if (body.length > 0x0fffffff) throw new Error('ID3v2 标签过大');
    const header = concatBytes([u8str('ID3'), new Uint8Array([3, 0, 0]), syncsafeWrite(body.length)]);
    return concatBytes([header, body, u8view(mp3Buf)]).buffer;
  }

  /**
   * 给 WAV 在 fmt 与 data 之间插入 LIST/INFO chunk（UTF-8，奇数字节补 0）。
   * 空 meta 返回原 buffer；非 RIFF/WAVE 输入抛错（由调用方 catch 兜底）。
   * @param {ArrayBuffer|Uint8Array} wavBuf
   * @param {object} meta
   * @returns {ArrayBuffer}
   */
  function attachToWav(wavBuf, meta) {
    const m = meta || {};
    const fields = TEXT_FIELDS.filter((f) => m[f] != null && m[f] !== '');
    if (fields.length === 0) return wavBuf;
    const bytes = u8view(wavBuf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE') {
      throw new Error('无效的 WAV 数据');
    }
    let off = 12;
    let fmtEnd = -1;
    let dataStart = -1;
    while (off + 8 <= bytes.length) {
      const id = ascii(bytes, off, off + 4);
      const size = dv.getUint32(off + 4, true);
      if (id === 'fmt ') fmtEnd = off + 8 + size;
      else if (id === 'data') { dataStart = off; break; }
      off += 8 + size + (size & 1);
    }
    if (fmtEnd < 0 || dataStart < 0) throw new Error('无效的 WAV 结构');
    const subs = [];
    for (const f of fields) {
      const b = new TextEncoder().encode(String(m[f]));
      const pad = b.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
      subs.push(concatBytes([u8str(WAV_TO_CC[f]), u32le(b.length), b, pad]));
    }
    const listPayload = concatBytes([u8str('INFO'), ...subs]);
    const list = concatBytes([u8str('LIST'), u32le(listPayload.length), listPayload]);
    const out = new Uint8Array(bytes.length + list.length);
    out.set(bytes.subarray(0, fmtEnd), 0);
    out.set(list, fmtEnd);
    out.set(bytes.subarray(dataStart), fmtEnd + list.length);
    new DataView(out.buffer).setUint32(4, dv.getUint32(4, true) + list.length, true);
    return out.buffer;
  }

  /**
   * 合并解析值与编辑值：编辑值（可能含空串）逐字段覆盖，cover 恒取解析值。
   * @param {object} parsed
   * @param {object} edited
   * @returns {object}
   */
  function mergeMeta(parsed, edited) {
    const p = parsed || emptyMeta();
    const e = edited || {};
    const out = { ...p };
    for (const f of TEXT_FIELDS) {
      if (f in e) out[f] = e[f] == null ? null : String(e[f]);
    }
    out.cover = p.cover || null;
    return out;
  }

  return { parseMetadata, attachToWav, attachToMp3, mergeMeta };
});
