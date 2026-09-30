// 创建时间：2026-08-24 06:00:00
/** report_handmaid.mjs — 批量评估结果统计分析（分类命中/倍频/误判、offset 分布、误判样本表）。 */
import fs from 'node:fs';

const JSONL = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_raw.jsonl';
const OUT = 'C:/Users/M1zukuro/Desktop/个人/tempokiri/eval/handmaid/eval_report.json';
const rows = [];
for (const line of fs.readFileSync(JSONL, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const j = JSON.parse(line); if (!j.err && j.bpm != null) rows.push(j); } catch { /* 跳过 */ }
}
const FAILS = fs.readFileSync(JSONL, 'utf8').split('\n').filter((l) => l.includes('"err"')).map((l) => JSON.parse(l));

const classify = (r) => {
  const t = r.truth;
  if (t == null) return 'noTruth';
  if (t > 200) return 'truthOutOfDefaultRange';
  const a = r.bpm;
  if (a == null) return 'noBpm';
  const d = Math.abs(a - t);
  if (d <= 0.6) return 'hit';
  const ratio = a / t;
  if (Math.abs(ratio - 2) <= 0.06) return 'x2';
  if (Math.abs(ratio - 0.5) <= 0.02) return 'x0.5';
  if (Math.abs(ratio - 3) <= 0.09) return 'x3';
  if (Math.abs(ratio - 1 / 3) <= 0.011) return 'x0.33';
  return 'miss';
};

const stat = {};
for (const r of rows) {
  const k = classify(r);
  stat[k] = (stat[k] || 0) + 1;
}
const total = rows.length;
console.log('总样本:', total, ' 失败:', FAILS.length);
console.log('\n===== BPM 分类统计 =====');
for (const [k, v] of Object.entries(stat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(4)}  ${((v / total) * 100).toFixed(1)}%`);
}
const hit = stat.hit || 0;
const x2 = stat.x2 || 0, x05 = stat['x0.5'] || 0, x3 = stat.x3 || 0, x033 = stat['x0.33'] || 0;
console.log(`\n命中率: ${((hit / total) * 100).toFixed(1)}%    倍频/分频类误判: ${(x2 + x05 + x3 + x033)}（${(((x2 + x05 + x3 + x033) / total) * 100).toFixed(1)}%）`);
console.log(`修正后潜含命中（命中+倍频/分频可归一）: ${((hit + x2 + x05 + x3 + x033) / total * 100).toFixed(1)}%`);

// offset 分布
console.log('\n===== offset 语义检查（|算法首onset - &first|）=====');
const offBins = { '≤0.1s': 0, '≤0.3s': 0, '≤0.6s': 0, '≤1.0s': 0, '>1.0s': 0 };
const offRows = [];
for (const r of rows) {
  if (r.first == null) continue;
  const d = Math.abs((r.offset || 0) - r.first);
  if (d <= 0.1) offBins['≤0.1s']++; else if (d <= 0.3) offBins['≤0.3s']++; else if (d <= 0.6) offBins['≤0.6s']++; else if (d <= 1.0) offBins['≤1.0s']++; else offBins['>1.0s']++;
  offRows.push({ id: r.id, d: +d.toFixed(2), first: r.first, alg: +(r.offset || 0).toFixed(2) });
}
const offTotal = offRows.length || 1;
for (const [k, v] of Object.entries(offBins)) console.log(`  ${k}: ${v}（${((v / offTotal) * 100).toFixed(1)}%）`);
console.log('  （&first 语义 = 谱面首拍位置；算法 offset = 首个 onset，开头有装饰音/静音会差半拍-一拍）');

// 误判样本表
console.log('\n===== 误判样本（hit 之外）=====');
const bad = rows.filter((r) => classify(r) !== 'hit').sort((a, b) => Math.abs(a.bpm - a.truth) - Math.abs(b.bpm - b.truth));
for (const r of bad.slice(0, 60)) {
  console.log(`  ${r.id.padEnd(7)} set=${r.set.padEnd(13)} truth=${String(r.truth).padEnd(7)} alg=${String(r.bpm).padEnd(7)} ratio=${(r.bpm / r.truth).toFixed(2)}  cands=[${(r.cands || []).join(',')}]  dur=${r.dur}s first=${r.first} algOff=${r.offset}`);
}
console.log(`\n误判总数: ${bad.length}`);

fs.writeFileSync(OUT, JSON.stringify({
  total, stat, fails: FAILS,
  bad: bad.map((r) => ({ id: r.id, set: r.set, truth: r.truth, alg: r.bpm, ratio: +(r.bpm / r.truth).toFixed(2), cands: r.cands, dur: r.dur, first: r.first, algOff: r.offset })),
  offRows,
}, null, 1), 'utf8');
console.log('\n写入:', OUT);
