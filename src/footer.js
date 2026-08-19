// 创建时间：2026-08-12 09:04:32
/**
 * footer.js — 页脚签名与工具：README 弹窗、检查更新、Bilibili/GitHub 链接。
 *
 * README 内容与版本号由 build.py 打包时注入（占位符保持 src 可独立校验）：
 *   __README_CONTENT__ → README.md 全文（JS 字符串转义）
 *   __VERSION__        → pyproject.toml 的版本号
 * 单 HTML 交付下双击即用（零外部请求）；「检查更新」仅在用户点击时访问 GitHub API。
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
  const T = (typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k);

  const README_SOURCE = '__README_CONTENT__';
  const VERSION = '__VERSION__';

  const LINKS = {
    bilibili: 'https://space.bilibili.com/80733922',
    github: 'https://github.com/M1zukiri',
  };
  const REPO_API = 'https://api.github.com/repos/M1zukiri/tempokiri';

  /**
   * 解析版本号：build.py 打包时把 '__VERSION__' 替换为 pyproject 版本；
   * src 模式（直接打开 index.html）下保持占位符，回退显示 'dev'。
   */
  function resolveVersion() {
    return VERSION && VERSION[0] !== '_' ? VERSION : 'dev';
  }
  /** HTML 转义（防 XSS，README 与版本号渲染共用）。 */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 极简 Markdown 渲染：标题/列表/代码块/粗体/行内代码/段落（只生成安全 HTML）。 */
  function renderMarkdown(src) {
    const inline = (s) =>
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inCode = false;
    let codeBuf = [];
    let inList = false;
    const flushList = () => {
      if (inList) { out.push('</ul>'); inList = false; }
    };
    for (const raw of lines) {
      if (/^```/.test(raw)) {
        if (inCode) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = []; inCode = false; }
        else inCode = true;
        continue;
      }
      if (inCode) { codeBuf.push(esc(raw)); continue; }
      if (/^###\s+/.test(raw)) { flushList(); out.push('<h4>' + inline(raw.slice(4)) + '</h4>'); continue; }
      if (/^##\s+/.test(raw)) { flushList(); out.push('<h3>' + inline(raw.slice(3)) + '</h3>'); continue; }
      if (/^#\s+/.test(raw)) { flushList(); out.push('<h2>' + inline(raw.slice(2)) + '</h2>'); continue; }
      if (/^[-*]\s+/.test(raw)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(raw.replace(/^[-*]\s+/, '')) + '</li>');
        continue;
      }
      if (/^\d+\.\s+/.test(raw)) {
        if (!inList) { out.push('<ol>'); inList = true; }
        out.push('<li>' + inline(raw.replace(/^\d+\.\s+/, '')) + '</li>');
        continue;
      }
      flushList();
      const t = raw.trim();
      if (t === '') { out.push(''); continue; }
      out.push('<p>' + inline(t) + '</p>');
    }
    if (inCode) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
    flushList();
    return out.join('\n');
  }

  /** 打开 README 弹窗（内容为打包时内嵌的 README.md）。 */
  function openReadme() {
    // 占位符以 '_' 开头（'__README_CONTENT__'）；注入后是真实 README 文本
    const hasReadme = README_SOURCE.length > 0 && README_SOURCE[0] !== '_';
    const body = hasReadme ? renderMarkdown(README_SOURCE) : '<p>' + T('footer.readmeMissing') + '</p>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'readmeOverlay';
    overlay.innerHTML =
      '<div class="modal modal-wide readme-modal" role="dialog" aria-modal="true" aria-label="' + T('footer.readme') + '">' +
      '<div class="readme-modal-head"><h3>' + T('footer.readme') + '</h3><span class="readme-version">v' + esc(resolveVersion()) + '</span>' +
      '<span class="spacer"></span><button class="btn btn-mini" data-close="1">✕</button></div>' +
      '<div class="readme-modal-body">' + body + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
    });
  }

  /**
   * 语义化版本比较（A.B.C 逐段数字比较，缺段补 0；非法段按 0 处理）。
   * @param {string} a
   * @param {string} b
   * @returns {number} a > b 返回 1，a < b 返回 -1，相等返回 0
   */
  function compareVersions(a, b) {
    const pa = String(a || '').split('.').map((s) => parseInt(s, 10));
    const pb = String(b || '').split('.').map((s) => parseInt(s, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = Number.isFinite(pa[i]) ? pa[i] : 0;
      const vb = Number.isFinite(pb[i]) ? pb[i] : 0;
      if (va !== vb) return va > vb ? 1 : -1;
    }
    return 0;
  }

  /** 彩蛋弹窗：本地版本领先于 GitHub 官方（测试者超前版）。 */
  function showEasterEgg(local, remote) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'easterEggOverlay';
    overlay.innerHTML =
      '<div class="modal easter-egg" role="dialog" aria-modal="true" aria-label="' + T('footer.eggAria') + '">' +
      '<h3>' + T('footer.eggTitle') + '</h3>' +
      '<p class="modal-sub">' + esc(T('footer.eggSub', { local: local, remote: remote })) + '</p>' +
      '<p class="easter-egg-text">' + T('footer.eggBody') + '</p>' +
      '<div class="modal-actions"><span class="spacer"></span>' +
      '<button class="btn btn-primary" data-close="1">' + T('footer.eggOk') + '</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
    });
  }

  /** 检查 GitHub 最新版本（releases → tags 兜底），与当前版本对比。 */
  async function checkUpdate() {
    const toast = (msg) => {
      const el = document.getElementById('updateToast');
      if (el) {
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.hidden = true; }, 5000);
      }
    };
    const btn = document.getElementById('btnCheckUpdate');
    if (btn) {
      btn.disabled = true;
      btn.textContent = T('footer.checking');
    }
    try {
      let latest = null;
      try {
        const r = await fetch(REPO_API + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) {
          const j = await r.json();
          latest = (j.tag_name || '').replace(/^v/, '');
        }
      } catch (e) { /* fallthrough */ }
      if (!latest) {
        const r2 = await fetch(REPO_API + '/tags');
        if (r2.ok) {
          const j = await r2.json();
          latest = (j[0] && j[0].name || '').replace(/^v/, '');
        }
      }
      if (!latest) {
        toast(T('footer.toastUnavailable'));
      } else if (resolveVersion() === 'dev') {
        toast(T('footer.toastDev', { latest: latest, link: LINKS.github }));
      } else {
        const cmp = compareVersions(latest, resolveVersion());
        if (cmp === 0) {
          toast(T('footer.toastLatest', { version: resolveVersion() }));
        } else if (cmp > 0) {
          toast(T('footer.toastNew', { latest: latest, local: resolveVersion(), link: LINKS.github }));
        } else {
          showEasterEgg(resolveVersion(), latest); // 本地领先 GitHub：测试者彩蛋
        }
      }
    } catch (e) {
      toast(T('footer.toastError', { msg: e.message }));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = T('footer.checkUpdate');
      }
    }
  }
  /** 初始化页脚交互（DOMContentLoaded 后调用）。 */
  function initFooter() {
    const links = document.querySelectorAll('[data-href]');
    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(a.dataset.href, '_blank', 'noopener');
      });
    });
    const btnReadme = document.getElementById('btnReadme');
    if (btnReadme) btnReadme.addEventListener('click', openReadme);
    const btnUpdate = document.getElementById('btnCheckUpdate');
    if (btnUpdate) btnUpdate.addEventListener('click', checkUpdate);
    const btnAdvanced = document.getElementById('btnAdvanced');
    if (btnAdvanced) btnAdvanced.addEventListener('click', () => MC.settings.openAdvanced());
    const btnMeta = document.getElementById('btnMeta');
    if (btnMeta) btnMeta.addEventListener('click', () => MC.metaModal.open());
    // 版本徽标：build.py 已把 '__VERSION__' 替换；src 模式下回退显示 dev
    const badge = document.querySelector('[data-version]');
    if (badge) badge.textContent = resolveVersion();
  }

  return { initFooter, openReadme, checkUpdate, renderMarkdown, compareVersions, VERSION, resolveVersion, LINKS };
});
