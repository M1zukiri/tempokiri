/**
 * store.js — 节拍设置持久化（localStorage）。
 *
 * 文件指纹 = 文件名|大小|最后修改时间；再次拖入同一文件时自动恢复设置。
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

  const KEY = 'tempokiri.remix.settings.v1';

  /** @param {File} file */
  function fingerprint(file) {
    return file.name + '|' + file.size + '|' + (file.lastModified || 0);
  }

  function storage() {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  /** 读取全部缓存设置。 */
  function readAll() {
    const s = storage();
    if (!s) return {};
    try {
      return JSON.parse(s.getItem(KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function writeAll(map) {
    const s = storage();
    if (!s) return;
    try {
      s.setItem(KEY, JSON.stringify(map));
    } catch (e) {
      // 配额等异常静默：缓存只是优化，不影响主流程
    }
  }

  /**
   * 保存节拍设置。
   * @param {File} file
   * @param {{bpm:number,beatsPerBar:number,beatUnit:number,offset:number}} settings
   */
  function saveSettings(file, settings) {
    const all = readAll();
    const key = fingerprint(file);
    // 合并语义：保留既有键（如 metadata），避免节拍保存覆盖元数据编辑
    all[key] = { ...(all[key] || {}), ...settings };
    writeAll(all);
  }

  /**
   * 读取节拍设置。
   * @param {File} file
   * @returns {object|null}
   */
  function loadSettings(file) {
    const all = readAll();
    const hit = all[fingerprint(file)];
    return hit || null;
  }

  /** 删除某个文件的缓存设置（切换文件时选「不保留」）。 */
  function clearSettings(file) {
    const all = readAll();
    delete all[fingerprint(file)];
    writeAll(all);
  }

  // 封面随 metadata 进 localStorage：Uint8Array 直接 JSON 化会变成逐字节对象，
  // 故存 base64。超过上限则不落缓存（本次会话仍有效），避免撑爆配额——
  // writeAll 会静默吞掉 QuotaExceededError，一旦超限会连带文本字段一起写不进去。
  const COVER_MAX_BYTES = 1024 * 1024;

  function bytesToB64(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }

  function b64ToBytes(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  /**
   * 保存元数据编辑值（6 文本字段 + 可选封面；经合并语义，节拍/序列键保留）。
   * @param {File} file
   * @param {object} meta 文本字段对象，可含 cover:{data:Uint8Array,mime:string}
   */
  function saveMetadata(file, meta) {
    const m = { ...(meta || {}) };
    const cover = m.cover;
    // 不写 cover 键 = 重开文件时回落解析值；仅超限或本就无封面时如此
    delete m.cover;
    if (cover && cover.data && cover.data.length && cover.data.length <= COVER_MAX_BYTES) {
      m.cover = { b64: bytesToB64(cover.data), mime: cover.mime || '' };
    }
    saveSettings(file, { metadata: m });
  }

  /** 读取元数据编辑值（无则返回 null）；cover 还原为 {data,mime} 形状。 */
  function loadMetadata(file) {
    const s = loadSettings(file);
    const m = (s && s.metadata) || null;
    if (!m) return null;
    if (m.cover && m.cover.b64) {
      return { ...m, cover: { data: b64ToBytes(m.cover.b64), mime: m.cover.mime || '' } };
    }
    return m;
  }

  const GLOBAL_KEY = 'tempokiri.remix.global.v1';
  const DEFAULT_GLOBAL = {
    crossfadeMs: 30,   // 拼接/导出交叉淡化时长
    sensitivity: 0.9,  // BPM 检测灵敏度（0..1，越大越宽松）
    minBpm: 60,
    maxBpm: 200,
    hop: 512,               // 检测精度：FFT 帧移（采样点），权威值；UI 数字框显示 hop/22.05 毫秒
    videoExtract: 'auto',   // 'auto' | 'webcodecs' | 'capture'
    captureRate: 4,         // captureStream 采集倍速（1–16）
    followMs: 90,           // 视频跟随 seek 节流间隔（毫秒）
    renderScale: 1.0,       // 波形渲染 DPR 系数（0.1–4）
    videoPaneWidth: 260,    // 视频预览面板宽度（px，180–640；批注 a1）
    theme: 'aurora',        // 界面主题：'aurora' | 'nebula' | 'paper' | 'seigaiha' | 'kurenai' | 'mono'
    metronomeOn: false,     // 节拍器开关（播放时跟随小节线）
    metronomeSeqOn: true,   // 拼接序列播放时启用节拍器（默认开）
    metronomeUnit: 0,       // 几分音符（0 = 自动取拍号分母）
    metronomeVolume: 80,    // 节拍器音量 0-200
    metronomeTone: 'click', // 音色：click | beep | wood
  };

  /** 读取全局高级设置（缺省合并）。 */
  function loadGlobalSettings() {
    const s = storage();
    if (!s) return { ...DEFAULT_GLOBAL };
    try {
      const raw = JSON.parse(s.getItem(GLOBAL_KEY) || '{}');
      return { ...DEFAULT_GLOBAL, ...raw };
    } catch (e) {
      return { ...DEFAULT_GLOBAL };
    }
  }

  /** 保存全局高级设置（局部合并，未涉及的键保留原值）。 */
  function saveGlobalSettings(patch) {
    const s = storage();
    if (!s) return;
    try {
      const cur = loadGlobalSettings();
      s.setItem(GLOBAL_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch (e) {
      // 静默：设置只是优化
    }
  }

  return { KEY, fingerprint, saveSettings, loadSettings, clearSettings, saveMetadata, loadMetadata, GLOBAL_KEY, loadGlobalSettings, saveGlobalSettings };
});
