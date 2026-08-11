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
    all[fingerprint(file)] = settings;
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

  return { KEY, fingerprint, saveSettings, loadSettings };
});
