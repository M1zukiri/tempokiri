/**
 * i18n.js — 界面文案系统（v1.5.0）。
 *
 * strings.json 是唯一编辑源；build.py 打包时把占位符 '__I18N__' 替换为文档
 * 序列化对象（与 footer.js 的 README/版本注入同机制）。src 模式（直接打开
 * index.html）下回退：静态文字保留 HTML 原文（data-i18n 缺字典不覆盖），
 * 动态文案 T() 返回 key 名（便于发现漏配）；Node 测试环境自动读取
 * ../strings.json。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, { i18n: factory() });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const I18N_SOURCE = '__I18N__'; // build.py 替换为 strings.json 对象字面量

  let dict = null;

  /** 取当前文案字典（注入 > Node 文件 > 空）。 */
  function dictOf() {
    if (dict) return dict;
    if (I18N_SOURCE && I18N_SOURCE[0] !== '_') {
      dict = I18N_SOURCE; // 构建产物：直接是对象
    } else if (typeof module === 'object' && module.exports) {
      try {
        dict = require('../strings.json'); // Node 测试环境
      } catch (e) {
        dict = {};
      }
    }
    return dict || {};
  }

  /** 分层取值：'a.b.c' → dict.a.b.c（仅返回字符串）。 */
  /** 分层取值：'a.b.c' → dict.a.b.c；每步先尝试剩余路径整体匹配（键名本身可含点，如 presets 的 "0.75"）。 */
  function lookup(key) {
    let node = dictOf();
    const parts = String(key).split('.');
    for (let i = 0; i < parts.length; i++) {
      if (node == null || typeof node !== 'object') return undefined;
      const rest = parts.slice(i).join('.');
      if (typeof node[rest] === 'string') return node[rest]; // 含点键整体命中
      node = node[parts[i]];
    }
    return typeof node === 'string' ? node : undefined;
  }

  /**
   * 取文案，支持 {name} 插值；缺失返回 key 名（便于发现漏配）。
   * @param {string} key
   * @param {object} [params] 插值参数，如 { name: 'a.mp3' }
   */
  function T(key, params) {
    const v = lookup(key);
    if (v == null) return key;
    if (!params) return v;
    return v.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
  }

  function applyStatic(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    const els = scope.querySelectorAll ? scope.querySelectorAll('[data-i18n], [data-i18n-title]') : [];
    for (const el of els) {
      if (el.dataset.i18n) {
        const v = lookup(el.dataset.i18n);
        if (v != null) el.textContent = v;
      }
      if (el.dataset.i18nTitle) {
        const t = lookup(el.dataset.i18nTitle);
        if (t != null) el.title = t;
      }
    }
  }

  return { T, lookup, applyStatic, dictOf };
});
