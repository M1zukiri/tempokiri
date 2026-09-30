// 创建时间：2026-08-24 07:20:00
/** sim_p1.mjs — 改进方案离线模拟：P1 半频归一（2× 提升）与 P3 自适应上限的预期收益。 */
import fs from 'node:fs';

const JSONL = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_raw.jsonl';
const rows = [];
for (const line of fs.readFileSync(JSONL, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const j = JSON.parse(line); if (!j.err && j.bpm != null) rows.push(j); } catch { /* skip */ }
}
const total = rows.length;
const hit0 = rows.filter((r) => Math.abs(r.bpm - r.truth) <= 0.6).length;
const outOfRange0 = rows.filter((r) => r.truth > 200).length;

// P1 模拟：非命中 → 找到 candidate ≈ 2×主选 且 rel≥0.55 且 2× ≤200 → 视为可修复（双容差：0.6 精确 / 2.0 层正确）
let p1Fix06 = 0, p1Fix20 = 0;
const p1Not = [];
for (const r of rows) {
  if (Math.abs(r.bpm - r.truth) <= 0.6) continue;
  const c = (r.cands || []).find((cc) => {
    const ratio = cc.bpm / r.bpm;
    return Math.abs(ratio - 2) <= 0.08 && cc.rel >= 0.55 && cc.bpm <= 200;
  });
  if (c) {
    if (Math.abs(c.bpm - r.truth) <= 0.6) p1Fix06++;
    if (Math.abs(c.bpm - r.truth) <= 2.0) { p1Fix20++; p1Not.push(r.id + '（' + r.bpm + '→' + c.bpm + '，truth ' + r.truth + '，差 ' + Math.abs(c.bpm - r.truth).toFixed(1) + '）'); }
  }
}
// P3 模拟：truth>200 且主选接近 200 边缘（主选*1 ≈ 边缘 → 自适应 2× 扫描可再生真值层）
const p3Fix = rows.filter((r) => r.truth > 200 && r.bpm != null && r.bpm > 190).length;

console.log('样本:', total, ' 基线命中:', hit0, '(' + (hit0 / total * 100).toFixed(1) + '%)');
console.log('范围外(truth>200):', outOfRange0, '(' + (outOfRange0 / total * 100).toFixed(1) + '%)');
console.log('P1 修复(精确 ≤0.6):', p1Fix06, '(' + (p1Fix06 / total * 100).toFixed(1) + '%)');
console.log('P1 修复(层正确 ≤2.0):', p1Fix20, '(' + (p1Fix20 / total * 100).toFixed(1) + '%)');
console.log('P3 自适应上限可修复(预估):', p3Fix, '(' + (p3Fix / total * 100).toFixed(1) + '%)');
console.log('\n层正确但值偏(2.0 容差)样本：');
for (const s of p1Not.slice(0, 25)) console.log('  ' + s);
const after = hit0 + p1Fix06;
console.log('\nP1 后命中率(0.6 容差):', (after / total * 100).toFixed(1) + '%');
console.log('P1 后"层正确"率(2.0 容差):', ((hit0 + p1Fix20) / total * 100).toFixed(1) + '%');
// 完全未覆盖统计
const residual = rows.filter((r) => Math.abs(r.bpm - r.truth) > 0.6 && !(r.cands || []).some((cc) => Math.abs(cc.bpm / r.bpm - 2) <= 0.08 && cc.rel >= 0.55 && cc.bpm <= 200 && Math.abs(cc.bpm - r.truth) <= 0.6));
console.log('\nP1 后仍 miss:', residual.length, '(' + (residual.length / total * 100).toFixed(1) + '%)');
