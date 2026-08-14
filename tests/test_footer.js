/**
 * test_footer.js — 页脚模块单元测试（node --test）。
 * 覆盖：Markdown 渲染（标题/列表/代码块/粗体）、HTML 转义防注入、版本/链接常量。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/footer.js');

test('renderMarkdown: 标题/列表/代码块/粗体渲染', () => {
  const md = '# 标题\n\n## 小节\n\n- 列表项\n- **加粗**\n\n```bash\npython build.py\n```\n\n普通段落';
  const html = F.renderMarkdown(md);
  assert.ok(html.includes('<h2>标题</h2>'));
  assert.ok(html.includes('<h3>小节</h3>'));
  assert.ok(html.includes('<ul>'));
  assert.ok(html.includes('<li>列表项</li>'));
  assert.ok(html.includes('<li><strong>加粗</strong></li>'));
  assert.ok(html.includes('<pre><code>python build.py</code></pre>'));
  assert.ok(html.includes('<p>普通段落</p>'));
});

test('renderMarkdown: HTML 转义防注入', () => {
  const html = F.renderMarkdown('<script>alert(1)</script> & "x"');
  assert.ok(!html.includes('<script>'), '脚本标签必须转义');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
});

test('renderMarkdown: 有序列表', () => {
  const html = F.renderMarkdown('1. 第一\n2. 第二');
  assert.ok(html.includes('<ol>'));
  assert.ok(html.includes('<li>第一</li>'));
});

test('常量: 版本与链接占位符（src 环境为占位，打包后注入）', () => {
  // src 直跑时是占位符；build.py 打包后替换为真实值
  assert.ok(typeof F.VERSION === 'string');
  assert.equal(F.LINKS.bilibili, 'https://space.bilibili.com/80733922');
  assert.equal(F.LINKS.github, 'https://github.com/M1zukiri');
});

test('resolveVersion: src 占位符回退 dev', () => {
  // src 模式 VERSION='__VERSION__'（占位符）→ 'dev'；打包后为真实版本
  assert.equal(F.resolveVersion(), 'dev');
});

test('compareVersions: 语义化逐段比较（检查更新分支）', () => {
  assert.equal(F.compareVersions('1.4.2', '1.1.2'), 1, '本地超前应判定大于');
  assert.equal(F.compareVersions('1.1.2', '1.4.2'), -1, '落后应判定小于');
  assert.equal(F.compareVersions('1.4.2', '1.4.2'), 0, '相等');
  assert.equal(F.compareVersions('1.10.0', '1.9.0'), 1, '语义化：10 大于 9（字符串比较会错）');
  assert.equal(F.compareVersions('1.4.2', '1.4.10'), -1, '末段多位数正确比较');
  assert.equal(F.compareVersions('2.0.0', '1.9.9'), 1, '主版本优先');
  assert.equal(F.compareVersions('1.4', '1.4.0'), 0, '缺段补 0');
  assert.equal(F.compareVersions('1.4.2', '1.4'), 1, '缺段补 0 后比较');
  assert.equal(F.compareVersions('v1.4.2', '1.4.2'), -1, '带 v 前缀按 NaN 段处理（调用处已去前缀）');
  assert.equal(F.compareVersions('', ''), 0, '空串相等');
});
