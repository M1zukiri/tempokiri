/**
 * test_ui.js — 序列列表渲染与播放态高亮测试（node --test）。
 */
const { test } = require('node:test');
// ui.js 使用 document.createElement，Node 环境注入最小 mock
global.document = {
  createElement: (tag) => {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      className: '',
      dataset: {},
      addEventListener() {},
      querySelector() {
        return {
          classList: { add() {}, contains: () => false },
          addEventListener() {},
          value: '',
        };
      },
    };
    el.classList = {
      add(c) { if (!el.className.split(/\s+/).includes(c)) el.className += (el.className ? ' ' : '') + c; },
      contains(c) { return el.className.split(/\s+/).includes(c); },
      remove(c) { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    };
    return el;
  },
};
const assert = require('node:assert/strict');
const U = require('../src/ui.js');

/** 简化 DOM：仅支持 renderSequenceList 用到的接口。 */
function makeContainer() {
  const cards = [];
  const container = {
    innerHTML: '',
    _cards: cards,
    appendChild(c) { cards.push(c); },
  };
  // className 与 classList 真实联动，querySelector 支持 .seq-card[data-id="…"] 按 dataset.id 匹配
  const mkEl = (tag, cls) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: cls || '',
      dataset: {},
      innerHTML: '',
      addEventListener() {},
      querySelector() { return mkEl('span'); },
    };
    el.classList = {
      add(c) { if (!el.className.split(/\s+/).includes(c)) el.className += (el.className ? ' ' : '') + c; },
      contains(c) { return el.className.split(/\s+/).includes(c); },
      remove(c) { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    };
    return el;
  };
  container.querySelector = (sel) => {
    const m = /data-id="([^"]+)"/.exec(sel);
    if (!m) return null;
    return cards.find((c) => c.dataset.id === m[1]) || null;
  };
  return { container, cards };
}

test('renderSequenceList: 空列表渲染提示', () => {
  const { container } = makeContainer();
  U.renderSequenceList(container, [], { getGrid: () => null });
  assert.ok(container.innerHTML.includes('拼接序列为空'));
});

test('renderSequenceList: 卡片含折叠区与切换按钮（fade 默认收起）', () => {
  global.MC = global.MC || {};
  global.MC.UnitInput = { create: () => ({ isInvalid: () => false }) };
  const items = [{ id: 'a', fadeInMs: 30, fadeOutMs: 40, startTime: 0, endTime: 1 }];
  const { container, cards } = makeContainer();
  U.renderSequenceList(container, items, { getGrid: () => null });
  const html = cards[0].innerHTML || '';
  assert.ok(html.includes('seq-detail'), '含折叠区（seq-detail）');
  assert.ok(html.includes('seq-toggle'), '含展开切换按钮');
  assert.ok(html.includes('fade-in') && html.includes('fade-out'), '淡入/淡出输入保留');
});

test('renderSequenceList: 播放中的卡片带 playing 类', () => {
  global.MC = global.MC || {};
  global.MC.UnitInput = { create: () => ({ isInvalid: () => false }) };
  const items = [
    { id: 'a', fadeInMs: 0, fadeOutMs: 0, startTime: 0, endTime: 1 },
    { id: 'b', fadeInMs: 0, fadeOutMs: 0, startTime: 2, endTime: 3 },
  ];
  const { container, cards } = makeContainer();
  U.renderSequenceList(container, items, { getGrid: () => null }, 'b');
  assert.equal(cards.length, 2);
  assert.ok(!cards[0].className.includes('playing'));
  assert.ok(cards[1].className.includes('playing'));
});

test('renderSequenceList: 无 playingId 时不加高亮', () => {
  global.MC = global.MC || {};
  global.MC.UnitInput = { create: () => ({ isInvalid: () => false }) };
  const items = [{ id: 'a', fadeInMs: 0, fadeOutMs: 0, startTime: 0, endTime: 1 }];
  const { container, cards } = makeContainer();
  U.renderSequenceList(container, items, { getGrid: () => null }, null);
  assert.ok(!cards[0].className.includes('playing'));
});
test('setPlayingCard: 从 a 切到 b（旧高亮移除、新高亮新增）', () => {
  global.MC = global.MC || {};
  global.MC.UnitInput = { create: () => ({ isInvalid: () => false }) };
  const items = [
    { id: 'a', fadeInMs: 0, fadeOutMs: 0, startTime: 0, endTime: 1 },
    { id: 'b', fadeInMs: 0, fadeOutMs: 0, startTime: 2, endTime: 3 },
  ];
  const { container, cards } = makeContainer();
  U.renderSequenceList(container, items, { getGrid: () => null }, 'a');
  U.setPlayingCard(container, 'b', 'a');
  assert.ok(!cards[0].classList.contains('playing'), '卡片 a 应移除 playing');
  assert.ok(cards[1].classList.contains('playing'), '卡片 b 应新增 playing');
});

test('setPlayingCard: playingId 为 null 时只移除旧高亮', () => {
  global.MC = global.MC || {};
  global.MC.UnitInput = { create: () => ({ isInvalid: () => false }) };
  const items = [
    { id: 'a', fadeInMs: 0, fadeOutMs: 0, startTime: 0, endTime: 1 },
    { id: 'b', fadeInMs: 0, fadeOutMs: 0, startTime: 2, endTime: 3 },
  ];
  const { container, cards } = makeContainer();
  U.renderSequenceList(container, items, { getGrid: () => null }, 'a');
  U.setPlayingCard(container, null, 'a');
  assert.ok(!cards[0].classList.contains('playing'), '卡片 a 高亮应被移除');
  assert.ok(!cards[1].classList.contains('playing'), '不应新增任何高亮');
});

test('setPlayingCard: prevId 为 null 时只新增高亮、不报错', () => {
  global.MC = global.MC || {};
  global.MC.UnitInput = { create: () => ({ isInvalid: () => false }) };
  const items = [{ id: 'a', fadeInMs: 0, fadeOutMs: 0, startTime: 0, endTime: 1 }];
  const { container, cards } = makeContainer();
  U.renderSequenceList(container, items, { getGrid: () => null }, null);
  U.setPlayingCard(container, 'a', null);
  assert.ok(cards[0].classList.contains('playing'), '卡片 a 应新增 playing');
});

test('clampVideoPaneWidth: 180–640 夹取、非法值回落 260（批注 a1）', () => {
  assert.equal(U.clampVideoPaneWidth(260), 260);
  assert.equal(U.clampVideoPaneWidth(120), 180);
  assert.equal(U.clampVideoPaneWidth(900), 640);
  assert.equal(U.clampVideoPaneWidth(333.6), 334, '四舍五入到整数像素');
  assert.equal(U.clampVideoPaneWidth(null), 260);
  assert.equal(U.clampVideoPaneWidth('abc'), 260);
});
