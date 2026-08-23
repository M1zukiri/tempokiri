/**
 * test_autoCut.js — 自动剪辑算法单元测试（node --test）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const AC = require('../src/autoCut.js');
const A = require('../src/analysis.js');

const SR = AC.DEFAULT_ANALYSIS_SR;

/** 合成「正弦段 + 静音段」交替信号：0-2s 音、2-2.5s 静音、2.5-4.5s 音、4.5-5s 静音、5-7s 音。 */
function makeAlternating(seconds = 7, amp = 0.5, freq = 440) {
  const n = Math.round(seconds * SR);
  const pcm = new Float32Array(n);
  const phase = (t) => amp * Math.sin(2 * Math.PI * freq * t);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const seg = t % 2.5;
    pcm[i] = seg < 2 ? phase(t) : 0; // 每 2.5s 周期中后 0.5s 静音
  }
  return pcm;
}

test('energyEnvelope: 恒定幅度信号的 RMS 包络接近理论值', () => {
  const n = SR * 2;
  const pcm = new Float32Array(n).fill(0.5);
  const { env } = AC.energyEnvelope(pcm);
  assert.ok(env.length > 10);
  const expect = 0.5; // 常数 0.5 的 RMS = 0.5
  for (let i = 0; i < env.length; i++) {
    assert.ok(Math.abs(env[i] - expect) < 1e-6, `包络点 ${i} = ${env[i]}，期望 ${expect}`);
  }
});

test('energyEnvelope: 静音信号包络全零', () => {
  const { env } = AC.energyEnvelope(new Float32Array(SR));
  assert.equal(env.length, Math.floor((SR - 1024) / 256) + 1);
  for (let i = 0; i < env.length; i++) assert.equal(env[i], 0);
});

test('findValleys: 交替信号的谷位于静音段中心', () => {
  const pcm = makeAlternating();
  const { env } = AC.energyEnvelope(pcm);
  const valleys = AC.findValleys(env);
  assert.ok(valleys.length >= 2, `谷数量过少: ${valleys.length}`);
  // 静音段 2.0-2.5s → 谷中心应 ≈ 2.25s；4.5-5.0s → ≈ 4.75s
  for (const v of valleys.slice(0, 2)) {
    const t = (AC.valleyCenter(env, v.idx) * 256 + 512) / SR;
    assert.ok(Math.abs(t - 2.25) < 0.2 || Math.abs(t - 4.75) < 0.2, `谷中心时间异常: ${t}`);
  }
});

test('findCutPoints: 交替信号剪切点落在静音段', () => {
  const pcm = makeAlternating();
  const cuts = AC.findCutPoints(pcm, { sr: SR, minGapSec: 1, maxCuts: 10 });
  assert.equal(cuts.length, 2, `期望 2 个剪切点，实际 ${cuts.length}`);
  for (const c of cuts) {
    assert.ok(c.reason === 'valley', `无网格时应为 valley，实际 ${c.reason}`);
    assert.ok(Math.abs(c.time - 2.25) < 0.35 || Math.abs(c.time - 4.75) < 0.35, `剪切点不在静音段: ${c.time}`);
    assert.ok(c.score >= 1 && c.score <= 100, `质量分越界: ${c.score}`);
  }
});

test('findCutPoints: 网格对齐优先于能量谷', () => {
  const pcm = makeAlternating();
  // 拍线落在静音段中心：offset=2.25 → 小节起点 2.25、拍线 2.25/2.75…
  const grid = A.buildSimpleGrid(120, 4, 2.25, 7);
  const cuts = AC.findCutPoints(pcm, { sr: SR, grid, minGapSec: 1, maxCuts: 10 });
  assert.ok(cuts.length >= 1);
  const c = cuts[0];
  assert.equal(c.reason, 'bar', `网格线（小节起点）应被优先吸附，实际 ${c.reason}`);
  assert.equal(c.time, 2.25);
});

test('gridAlign: 超半径不吸附；小节线优先于拍线', () => {
  const grid = A.buildSimpleGrid(120, 4, 0, 8);
  // 2.25 距最近拍线（2.0/2.5）0.25s > 0.12s → 不吸附
  assert.equal(AC.gridAlign(2.25, grid, 0.12), null);
  // 2.05 距小节线 2.0 仅 0.05s → 吸附小节线（bar 优先）
  const hitBar = AC.gridAlign(2.05, grid, 0.12);
  assert.ok(hitBar && hitBar.reason === 'bar' && Math.abs(hitBar.time - 2.0) < 1e-9);
  // 2.4 距小节线（2.0/4.0）均 > 0.12s，距拍线 2.5 仅 0.1s → 吸附拍线
  const hitBeat = AC.gridAlign(2.4, grid, 0.12);
  assert.ok(hitBeat && hitBeat.reason === 'beat' && Math.abs(hitBeat.time - 2.5) < 1e-9);
});

test('buildPlan: 交替信号生成 3 段方案（默认间隔=最小段长）', () => {
  const pcm = makeAlternating();
  const plan = AC.buildPlan(pcm, { sr: SR, minSegSec: 1.5 });
  assert.equal(plan.cuts.length, 2);
  assert.equal(plan.segments.length, 3);
  // 段精确衔接、覆盖全曲
  assert.ok(Math.abs(plan.segments[0].startTime - 0) < 1e-9);
  assert.ok(Math.abs(plan.segments[2].endTime - 7) < 1e-9);
  for (let i = 1; i < plan.segments.length; i++) {
    assert.ok(Math.abs(plan.segments[i].startTime - plan.segments[i - 1].endTime) < 1e-9);
    assert.ok(plan.segments[i].endTime - plan.segments[i].startTime >= 1.5 - 1e-6);
  }
});

test('buildPlan: 过短段被循环合并（碎切不保留）', () => {
  // 1s 音 + 0.3s 静音 + 1s 音 + 0.3s 静音 + 2s 音 → 最小段长 2s 时全部合并，无方案
  const n = Math.round(5.6 * SR);
  const pcm = new Float32Array(n);
  const phase = (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const r = t % 2.3;
    pcm[i] = r < 1 ? phase(t) : 0;
  }
  const plan = AC.buildPlan(pcm, { sr: SR, minSegSec: 2, minGapSec: 0.5 });
  assert.equal(plan.segments.length, 0, `碎切应合并为无方案，实际 ${plan.segments.length} 段`);
  assert.equal(plan.cuts.length, 0);
});

test('buildPlan: 分析范围限定（searchStart/searchEnd）', () => {
  const pcm = makeAlternating();
  // 范围 [2.3, 7]：静音段 1 的谷中心 2.25 被排除，只保留静音段 2（4.75）
  const plan = AC.buildPlan(pcm, { sr: SR, minSegSec: 1.5, minGapSec: 1, searchStart: 2.3, searchEnd: 7 });
  assert.equal(plan.cuts.length, 1);
  assert.ok(Math.abs(plan.cuts[0].time - 4.75) < 0.35);
  assert.equal(plan.segments.length, 2);
  assert.ok(Math.abs(plan.segments[0].startTime - 2.3) < 1e-9);
});

test('buildPlan: 无剪切点返回空方案', () => {
  const pcm = new Float32Array(SR * 3).fill(0.1); // 恒定低能量、无谷
  const plan = AC.buildPlan(pcm, { sr: SR });
  assert.equal(plan.cuts.length, 0);
  assert.equal(plan.segments.length, 0);
});
