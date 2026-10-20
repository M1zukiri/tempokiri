/**
 * zip.js — 最小 ZIP 打包（store 方式，无压缩）用于批量导出（A5-5）。
 *
 * 创建时间：2026-10-19 18:40:00
 *
 * 单文件交付约束下不引入第三方库：WAV/MP3 本身已是压缩/无损格式，再次
 * deflate 收益很小，故只实现 store（method=0）。结构完全遵循 PKWARE
 * APPNOTE：本地文件头 + 数据 + 中央目录 + EOCD，文件名 UTF-8 且置 bit 11。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  /** CRC-32（IEEE 802.3，ZIP 使用的多项式）。 */
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    // Node 无 TextEncoder 的兜底（极老环境）：仅 ASCII 安全
    const out = [];
    for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
    return Uint8Array.from(out);
  }

  /**
   * @param {Array<{name:string, data:Uint8Array}>} files
   * @returns {Uint8Array} ZIP 字节
   */
  function createZip(files) {
    const list = (files || []).map((f) => {
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const name = utf8(f.name);
      return { name, data, crc: crc32(data) };
    });
    let size = 22;
    for (const f of list) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let off = 0;
    const central = [];
    for (const f of list) {
      const localOff = off;
      view.setUint32(off, 0x04034b50, true); off += 4;   // 本地文件头签名
      view.setUint16(off, 20, true); off += 2;           // 解压所需版本
      view.setUint16(off, 0x0800, true); off += 2;       // 通用标志：UTF-8 文件名
      view.setUint16(off, 0, true); off += 2;            // 压缩方法：store
      view.setUint16(off, 0, true); off += 2;            // 修改时间（固定 0）
      view.setUint16(off, 0x21, true); off += 2;         // 修改日期（1980-01-01）
      view.setUint32(off, f.crc, true); off += 4;
      view.setUint32(off, f.data.length, true); off += 4; // 压缩后大小
      view.setUint32(off, f.data.length, true); off += 4; // 原始大小
      view.setUint16(off, f.name.length, true); off += 2;
      view.setUint16(off, 0, true); off += 2;            // 扩展字段长度
      out.set(f.name, off); off += f.name.length;
      out.set(f.data, off); off += f.data.length;
      central.push({ f, localOff });
    }
    const centralStart = off;
    for (const { f, localOff } of central) {
      view.setUint32(off, 0x02014b50, true); off += 4;   // 中央目录签名
      view.setUint16(off, 20, true); off += 2;           // 创建版本
      view.setUint16(off, 20, true); off += 2;           // 解压版本
      view.setUint16(off, 0x0800, true); off += 2;
      view.setUint16(off, 0, true); off += 2;
      view.setUint16(off, 0, true); off += 2;
      view.setUint16(off, 0x21, true); off += 2;
      view.setUint32(off, f.crc, true); off += 4;
      view.setUint32(off, f.data.length, true); off += 4;
      view.setUint32(off, f.data.length, true); off += 4;
      view.setUint16(off, f.name.length, true); off += 2;
      view.setUint16(off, 0, true); off += 2;            // 扩展字段
      view.setUint16(off, 0, true); off += 2;            // 注释
      view.setUint16(off, 0, true); off += 2;            // 磁盘号
      view.setUint16(off, 0, true); off += 2;            // 内部属性
      view.setUint32(off, 0, true); off += 4;            // 外部属性
      view.setUint32(off, localOff, true); off += 4;     // 本地头偏移
      out.set(f.name, off); off += f.name.length;
    }
    const centralSize = off - centralStart;
    view.setUint32(off, 0x06054b50, true); off += 4;     // EOCD 签名
    view.setUint16(off, 0, true); off += 2;
    view.setUint16(off, 0, true); off += 2;
    view.setUint16(off, list.length, true); off += 2;
    view.setUint16(off, list.length, true); off += 2;
    view.setUint32(off, centralSize, true); off += 4;
    view.setUint32(off, centralStart, true); off += 4;
    view.setUint16(off, 0, true); off += 2;
    return out.subarray(0, off);
  }

  return { crc32, createZip };
});
