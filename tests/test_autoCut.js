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

test('scoreCut: 三因子加权（节奏 40 + 能量 40 + 连续 20）', () => {
  // 最深谷 + 完美连续 + 网格对齐 = 100
  assert.equal(AC.scoreCut(1, 1, 0, 'bar'), 100);
  // 深度减半：能量 20 + 连续 20 + 节奏 40 = 80
  assert.equal(AC.scoreCut(0.5, 1, 0, 'beat'), 80);
  // cost=0.5（差分大）：连续分 20/(1+0.5*8)=4 → 未对齐 40+4=44
  assert.equal(AC.scoreCut(1, 1, 0.5, 'valley'), 44);
  // 同 cost 下节奏对齐 +40
  assert.equal(AC.scoreCut(1, 1, 0.5, 'bar'), 84);
  // 无网格（valley）上限语义：完美连续也只有 60（节奏分 0）
  assert.equal(AC.scoreCut(1, 1, 0, 'valley'), 60);
  // 域下限：连续分趋 0 时至少 1
  assert.equal(AC.scoreCut(0, 1, 100, 'valley'), 1);
});

test('buildPlan: 最少段长分档影响方案粒度', () => {
  const pcm = makeAlternating();
  // 谷 2.25/4.75 → 段 2.25/2.5/2.25s：minSeg 1.5 全保留（3 段）
  const fine = AC.buildPlan(pcm, { sr: SR, minSegSec: 1.5 });
  assert.equal(fine.segments.length, 3);
  // minSeg 2.5：第一段 2.25s 过短 → 循环合并至无方案
  const coarse = AC.buildPlan(pcm, { sr: SR, minSegSec: 2.5 });
  assert.equal(coarse.segments.length, 0);
  assert.equal(coarse.cuts.length, 0);
});

test('buildPlan: 对齐网格开关（grid 传 null 即关闭）', () => {
  const pcm = makeAlternating();
  const gridHit = A.buildSimpleGrid(120, 4, 2.25, 7); // 小节起点正好落在静音谷中心
  const on = AC.buildPlan(pcm, { sr: SR, grid: gridHit, minSegSec: 1.5 });
  assert.equal(on.cuts[0].reason, 'bar', '对齐开启时应吸附小节线');
  const off = AC.buildPlan(pcm, { sr: SR, grid: null, minSegSec: 1.5 });
  assert.ok(off.cuts.every((c) => c.reason === 'valley'), '对齐关闭时不应吸附网格线');
});

test('buildPlan: candidates 含被默认方案过滤的切点（可用终点池）', () => {
  // 交替信号两个谷（2.25/4.75，间距 2.5s）：minSeg 3 时默认方案为空（2.5 < 3 且首段 2.25 < 3），
  // 但候选池（间距 ≥2s）两个点都可见——弹窗"可用终点"仍有选择余地
  const pcm = makeAlternating();
  const plan = AC.buildPlan(pcm, { sr: SR, minSegSec: 3 });
  assert.equal(plan.segments.length, 0, '默认方案应为空');
  assert.equal(plan.candidates.length, 2, '候选池应保留两个显著切点');
  assert.ok(Math.abs(plan.candidates[0].time - 2.25) < 0.35);
  assert.ok(Math.abs(plan.candidates[1].time - 4.75) < 0.35);
});

test('buildPlan: 锚定一段后其余部分重新生成（固定点豁免合并）', () => {
  // 10s 交替信号：谷 ≈2.25/4.75/7.25（末端静音无右峰不计）；锚定段取候选池真实点
  const pcm = makeAlternating(10);
  const base = AC.buildPlan(pcm, { sr: SR, minSegSec: 3 });
  const s = base.candidates[0].time; // ≈2.252
  const e = base.candidates[1].time; // ≈4.748
  const plan = AC.buildPlan(pcm, { sr: SR, minSegSec: 3, anchor: { start: s, end: e } });
  // 锚定段在方案中（固定点豁免：即使首段 2.25s < minSeg 也不删除）
  const seg1 = plan.segments.find((x) => Math.abs(x.startTime - s) < 1e-6);
  assert.ok(seg1, '锚定段应出现在方案中');
  assert.ok(Math.abs(seg1.endTime - e) < 1e-6, '锚定段终点应保留');
  // 锚定后的切点（7.25 距锚点 ≈2.5s < 3 → 被合并），末段回边界
  const last = plan.segments[plan.segments.length - 1];
  assert.ok(Math.abs(last.endTime - 10) < 1e-9);
  // 锚定起止点均保留为方案切点（含分数/依据）
  assert.ok(plan.cuts.some((c) => Math.abs(c.time - s) < 1e-6));
  assert.ok(plan.cuts.some((c) => Math.abs(c.time - e) < 1e-6), '锚定终点应在方案切点中');
});
