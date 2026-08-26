/**
 * test_tapTempo.js — BPM Tap 模块单元测试（node --test）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const TT = require('../src/tapTempo.js');

test('bpmFromIntervals: 8 拍（±30ms 抖动）估计正确', () => {
  // 120 BPM 拍间隔 0.5s，±30ms 抖动
  const iv = [0.5, 0.52, 0.49, 0.51, 0.48, 0.52, 0.5];
  const bpm = TT.bpmFromIntervals(iv);
  assert.ok(bpm != null);
  assert.ok(Math.abs(bpm - 120) < 3, `期望 ~120，实际 ${bpm}`);
});

test('bpmFromIntervals: <100ms 双击被忽略', () => {
  // 80ms 双击 + 正常 0.5s 拍
  const bpm = TT.bpmFromIntervals([0.08, 0.5, 0.5, 0.48, 0.5, 0.52, 0.5]);
  assert.ok(bpm != null);
  assert.ok(Math.abs(bpm - 120) < 3, `期望 ~120，实际 ${bpm}`);
});

test('bpmFromIntervals: 300 BPM 快拍（0.2s 间隔）不被双击阈值吞掉', () => {
  const bpm = TT.bpmFromIntervals([0.2, 0.21, 0.19, 0.2, 0.2, 0.21, 0.2]);
  assert.ok(bpm != null);
  assert.ok(Math.abs(bpm - 300) < 10, `期望 ~300，实际 ${bpm}`);
});

test('bpmFromIntervals: 野值被一致性滤波剔除', () => {
  // 一个 0.9s 的野间隔（漏拍/误触）不影响均值
  const bpm = TT.bpmFromIntervals([0.5, 0.9, 0.5, 0.51, 0.49, 0.5, 0.5]);
  assert.ok(bpm != null);
  assert.ok(Math.abs(bpm - 120) < 3, `期望 ~120，实际 ${bpm}`);
});

test('bpmFromIntervals: 有效拍不足返回 null', () => {
  assert.equal(TT.bpmFromIntervals([]), null);
  assert.equal(TT.bpmFromIntervals([0.5, 0.5, 0.5]), null); // 3 拍不足
  assert.equal(TT.bpmFromIntervals([0.08, 0.08, 0.08, 0.08]), null); // 全为双击
});

test('bpmFromIntervals: 240 BPM 快拍（0.25s 间隔）不被双击阈值吞掉', () => {
  const bpm = TT.bpmFromIntervals([0.25, 0.26, 0.24, 0.25, 0.25, 0.26, 0.25]);
  assert.ok(bpm != null);
  assert.ok(Math.abs(bpm - 240) < 8, `期望 ~240，实际 ${bpm}`);
});

test('tapper: 8 拍锁定且 bpm 正确（对称抖动）', () => {
  const t = TT.createTapper();
  let cur = null;
  let t0 = 10000;
  for (let i = 0; i < 8; i++) {
    cur = t.push(t0);
    t0 += 500 + (i % 2 ? 15 : -15); // 0.5s ±15ms 对称抖动（均值 ≈0.5s）
  }
  assert.equal(cur.locked, true, '8 拍后应锁定');
  assert.equal(cur.n, 8);
  assert.ok(Math.abs(cur.bpm - 120) < 2, `锁定 bpm 应 ≈120，实际 ${cur.bpm}`);
  // 锁定后不再收集（继续 push 返回锁定态）
  const after = t.push(t0 + 600);
  assert.equal(after.locked, true);
  assert.equal(after.n, 8);
});

test('tapper: >2s 停顿重置', () => {
  const t = TT.createTapper();
  let t0 = 10000;
  for (let i = 0; i < 4; i++) { t.push(t0); t0 += 500; }
  const r = t.push(t0 + 3000); // 3s 停顿 → 重置
  assert.equal(r.reset, true);
  assert.equal(r.n, 1, '重置后从第 1 拍重新计数');
});

test('tapper: 双击不计数且不重置', () => {
  const t = TT.createTapper();
  let t0 = 10000;
  t.push(t0); // 第 1 拍
  const r = t.push(t0 + 80); // 80ms 双击 → 忽略
  assert.equal(r.n, 1, '双击不增加拍数');
  t.push(t0 + 580); // 第 2 拍（从第 1 拍起 0.58s）
  const r2 = t.push(t0 + 1080); // 第 3 拍
  assert.equal(r2.n, 3);
});

test('tapper: 500 BPM 级快拍（120ms 间隔）可收集并锁定', () => {
  const t = TT.createTapper();
  let cur = null;
  let t0 = 10000;
  for (let i = 0; i < 8; i++) {
    cur = t.push(t0);
    t0 += 120 + (i % 2 ? 4 : -4);
  }
  assert.equal(cur.locked, true, '快拍 8 次应锁定');
  assert.ok(Math.abs(cur.bpm - 500) < 12, `期望 ~500，实际 ${cur.bpm}`);
});
