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

  const README_SOURCE = '__README_CONTENT__';
  const VERSION = '__VERSION__';

  const LINKS = {
    bilibili: 'https://space.bilibili.com/80733922',
    github: 'https://github.com/M1zukiri',
  };
  const REPO_API = 'https://api.github.com/repos/M1zukiri/tempokiri';

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
    const body = hasReadme ? renderMarkdown(README_SOURCE) : '<p>README 未内嵌（请用 build.py 打包后使用）。</p>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'readmeOverlay';
    overlay.innerHTML =
      '<div class="modal modal-wide readme-modal" role="dialog" aria-modal="true" aria-label="README">' +
      '<div class="readme-modal-head"><h3>README</h3><span class="readme-version">v' + esc(VERSION) + '</span>' +
      '<span class="spacer"></span><button class="btn btn-mini" data-close="1">✕</button></div>' +
      '<div class="readme-modal-body">' + body + '</div>' +
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
      btn.textContent = '检查中…';
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
        toast('无法获取最新版本（网络或仓库限制）');
      } else if (latest === VERSION) {
        toast('已是最新版本 v' + VERSION + ' 🎉');
      } else {
        toast('发现新版本 v' + latest + '（当前 v' + VERSION + '）→ ' + LINKS.github);
      }
    } catch (e) {
      toast('检查更新失败：' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '检查更新';
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
  }

  return { initFooter, openReadme, checkUpdate, renderMarkdown, VERSION, LINKS };
});
