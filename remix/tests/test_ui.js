/**
 * test_ui.js — 序列列表渲染与播放态高亮测试（node --test）。
 */
const { test } = require('node:test');
// ui.js 使用 document.createElement，Node 环境注入最小 mock
global.document = {
  createElement: (tag) => ({
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
  }),
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
  const mkEl = (tag, cls) => ({
    tagName: tag.toUpperCase(),
    className: cls || '',
    dataset: {},
    innerHTML: '',
    classList: {
      add(c) { this._cls = this._cls || []; if (!this._cls.includes(c)) this._cls.push(c); },
      contains(c) { return (this._cls || []).includes(c); },
      remove() {},
    },
    addEventListener() {},
    querySelector() { return mkEl('span'); },
  });
  container.querySelector = () => mkEl('span');
  return { container, cards };
}

test('renderSequenceList: 空列表渲染提示', () => {
  const { container } = makeContainer();
  U.renderSequenceList(container, [], { getGrid: () => null });
  assert.ok(container.innerHTML.includes('尚未添加段落'));
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
