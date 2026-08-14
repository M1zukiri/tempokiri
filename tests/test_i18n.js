/**
 * test_i18n.js — 文案系统单测（node --test）。
 * 创建时间：2026-08-14 17:14:28
 *
 * 覆盖：分层取值、{name} 插值、缺失回退、静态填充逻辑、strings.json 完整性。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/i18n.js');
const strings = require('../strings.json');

test('T: 分层取值与默认文案', () => {
  assert.equal(I.T('seq.title'), '拼接序列');
  assert.equal(I.T('toolbar.openFile'), '打开文件');
  assert.equal(I.T('wave.play'), '▶ 播放');
});

test('T: {name} 插值', () => {
  assert.equal(I.T('status.playFrom', { pos: '1:23.4' }), '从 1:23.4 开始播放');
  assert.equal(I.T('seq.info', { count: 3, total: '0:12.5' }), '3 段 · 总时长 0:12.5');
  assert.equal(I.T('footer.eggSub', { local: '1.4.2', remote: '1.1.2' }), '你的本地版本 v1.4.2 比 GitHub 官方 v1.1.2 更新。');
  assert.equal(I.T('status.selectedRange', { start: 1, end: 4 }), '已选定：第 1–4 小节。点击「添加选中区间」加入列表。');
});

test('T: 缺 key 回退 key 名（便于发现漏配）', () => {
  assert.equal(I.T('no.such.key'), 'no.such.key');
  assert.equal(I.T('seq'), 'seq'); // 非字符串节点也回退
});

test('T: 缺失插值参数保持原占位符', () => {
  assert.equal(I.T('status.playFrom'), '从 {pos} 开始播放');
});

test('lookup: 分层查找仅返回字符串', () => {
  assert.equal(I.lookup('settings.theme.label'), '界面主题');
  assert.equal(I.lookup('settings'), undefined); // 对象节点不是文案
  assert.equal(I.lookup(''), undefined);
});

test('applyStatic: 无 DOM 环境不抛错', () => {
  assert.doesNotThrow(() => I.applyStatic(null));
  assert.doesNotThrow(() => I.applyStatic({}));
});

test('strings.json: 叶子 key 全部为字符串且无空值（文档完整性）', () => {
  const walk = (o, p = '', acc = []) => {
    for (const [k, v] of Object.entries(o)) {
      const pp = p ? p + '.' + k : k;
      if (v && typeof v === 'object') walk(v, pp, acc);
      else acc.push([pp, v]);
    }
    return acc;
  };
  const leaves = walk(strings);
  assert.ok(leaves.length > 150, '文案总数应 > 150：' + leaves.length);
  for (const [k, v] of leaves) {
    if (k === '_doc') continue;
    assert.equal(typeof v, 'string', k + ' 应为字符串');
    assert.ok(v.length > 0, k + ' 不能为空');
  }
});

test('strings.json: _doc 说明存在且所有顶层分组都有文案', () => {
  assert.ok(strings._doc.includes('唯一编辑源'));
  for (const g of ['app', 'toolbar', 'wave', 'quick', 'seq', 'footer', 'status', 'hint', 'modal', 'settings', 'export']) {
    assert.ok(strings[g] && Object.keys(strings[g]).length > 0, '缺少分组：' + g);
  }
});
