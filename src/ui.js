/**
 * ui.js — 序列列表渲染、状态栏、提示、按钮状态管理。
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

  function fmtRange(item) {
    return T('seq.range', { start: item.startBar, end: item.endBar });
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /**
   * 渲染序列列表。
   * @param {HTMLElement} container
   * @param {Array} items
   * @param {object} handlers
   * @param {(id:string) => void} handlers.onRemove
   * @param {(id:string, toIndex:number) => void} handlers.onMove
   * @param {(id:string, fadeInMs:number, fadeOutMs:number) => void} handlers.onFade
   * @param {() => void} handlers.onRender
   */
  function renderSequenceList(container, items, handlers, playingId) {
    container.innerHTML = '';
    if (!items.length) {
      container.innerHTML = `<div class="empty">${T('seq.empty')}</div>`;
      return;
    }
    items.forEach((it, idx) => {
      const card = document.createElement('div');
      card.className = 'seq-card' + (playingId && it.id === playingId ? ' playing' : '');
      card.dataset.id = it.id;
      card.innerHTML = `
        <span class="seq-num">${idx + 1}</span>
        <span class="seq-edges">
          <span class="edge-label">${T('seq.edgeStart')}</span><span class="edge-start"></span>
          <span class="edge-label">${T('seq.edgeEnd')}</span><span class="edge-end"></span>
        </span>
        <label class="fade">${T('seq.fadeIn')} <input type="number" class="fade-in" value="${it.fadeInMs}" min="0" max="5000" step="10" /> ${T('seq.ms')}</label>
        <label class="fade">${T('seq.fadeOut')} <input type="number" class="fade-out" value="${it.fadeOutMs}" min="0" max="5000" step="10" /> ${T('seq.ms')}</label>
        <span class="spacer"></span>
        <button class="btn-mini up" title="${T('seq.up')}">↑</button>
        <button class="btn-mini down" title="${T('seq.down')}">↓</button>
        <button class="btn-mini del" title="${T('seq.del')}">✕</button>`;
      const edgeGrid = () => handlers.getGrid();
      const compStart = MC.UnitInput.create(card.querySelector('.edge-start'), {
        kind: 'position',
        edge: 'start',
        getGrid: edgeGrid,
        value: it.invalid ? NaN : it.startTime,
        onChange: (sec) => handlers.onRange(it.id, sec, 'start'),
      });
      const compEnd = MC.UnitInput.create(card.querySelector('.edge-end'), {
        kind: 'position',
        edge: 'end',
        getGrid: edgeGrid,
        value: it.invalid ? NaN : it.endTime,
        onChange: (sec) => handlers.onRange(it.id, sec, 'end'),
      });
      if (it.invalid || compStart.isInvalid() || compEnd.isInvalid()) card.classList.add('invalid');
      card.querySelector('.up').addEventListener('click', () => handlers.onMove(it.id, idx - 1));
      card.querySelector('.down').addEventListener('click', () => handlers.onMove(it.id, idx + 1));
      card.querySelector('.del').addEventListener('click', () => handlers.onRemove(it.id));
      card.querySelector('.fade-in').addEventListener('change', (e) => {
        handlers.onFade(it.id, Math.max(0, parseInt(e.target.value, 10) || 0), it.fadeOutMs);
      });
      card.querySelector('.fade-out').addEventListener('change', (e) => {
        handlers.onFade(it.id, it.fadeInMs, Math.max(0, parseInt(e.target.value, 10) || 0));
      });
      attachDrag(card, idx, handlers, container);
      container.appendChild(card);
    });
  }

  /**
   * 按住卡片上下拖动重排：指针跟随移动，松手时按指针落点计算目标位置并回调。
   * 输入框/按钮上的按下不触发（避免与淡化编辑、按钮点击冲突）。
   */
  function attachDrag(card, idx, handlers, container) {
    let dragging = false;
    let startY = 0;
    let pointerId = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('input, button')) return;
      dragging = true;
      startY = e.clientY;
      pointerId = e.pointerId;
      card.classList.add('dragging');
      card.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    // 计算指针落点目标位（移除自己后的插入位）与卡片步长
    const computeTarget = (y) => {
      const others = [...container.querySelectorAll('.seq-card')].filter((c) => c !== card);
      let target = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = others[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { target = i; break; }
      }
      return { target, others };
    };
    const stepHeight = () => {
      const first = container.querySelector('.seq-card');
      if (!first) return 0;
      const style = getComputedStyle(container);
      const gap = parseInt(style.rowGap || style.gap, 10) || 8;
      return first.getBoundingClientRect().height + gap;
    };
    // 让位：目标位与被拖卡原位之间的卡片平移过渡。
    // target 是 others（移除被拖卡后）的插入位，换算成当前 DOM 中的原位置再定区间。
    const shiftOthers = (target) => {
      const step = stepHeight();
      const all = [...container.querySelectorAll('.seq-card')];
      const others = all.filter((c) => c !== card);
      const targetOrig = target >= others.length ? all.length - 1 : all.indexOf(others[target]);
      const dir = targetOrig - idx;
      all.forEach((c, i) => {
        if (c === card) return;
        let dy = 0;
        if (dir > 0 && i > idx && i <= targetOrig) dy = step; // 向下拖：中间卡下移让位
        else if (dir < 0 && i >= targetOrig && i < idx) dy = -step; // 向上拖：中间卡上移让位
        c.style.transition = 'transform 0.12s ease';
        c.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
      });
    };
    let lastTarget = idx;
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      card.style.transform = 'translateY(' + (e.clientY - startY) + 'px)';
      const { target } = computeTarget(e.clientY);
      if (target !== lastTarget) {
        lastTarget = target;
        shiftOthers(target);
      }
    });
    const finish = (e) => {
      if (!dragging) return;
      dragging = false;
      card.classList.remove('dragging');
      card.style.transform = '';
      [...container.querySelectorAll('.seq-card')].forEach((c) => {
        c.style.transition = '';
        c.style.transform = '';
      });
      // 指针落点 → 移除自己后的插入位
      const { target } = computeTarget(e.clientY);
      if (target !== idx && handlers.onMove) handlers.onMove(card.dataset.id, target);
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
  }

  /** 更新序列信息（段落数 / 总时长）。 */
  function updateSeqInfo(elInfo, items, seqMod) {
    if (!items.length) {
      elInfo.textContent = '';
      return;
    }
    const total = seqMod.totalDuration(items);
    elInfo.textContent = T('seq.info', { count: items.length, total: fmtTime(total) });
  }

  /**
   * 仅切换序列卡片的 playing 高亮（不重建 DOM）。
   * @param {HTMLElement} container 序列列表容器
   * @param {(string|null)} playingId 新高亮卡片 id；null = 只移除不高亮
   * @param {(string|null)} prevId 旧高亮卡片 id；null = 无旧高亮
   */
  function setPlayingCard(container, playingId, prevId) {
    if (prevId != null) {
      const prev = container.querySelector('.seq-card[data-id="' + prevId + '"]');
      if (prev) prev.classList.remove('playing');
    }
    if (playingId != null) {
      const cur = container.querySelector('.seq-card[data-id="' + playingId + '"]');
      if (cur) cur.classList.add('playing');
    }
  }
  return { renderSequenceList, setPlayingCard, updateSeqInfo, fmtRange, fmtTime };
});
