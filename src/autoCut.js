// 创建时间：2026-08-19 21:30:00
/**
 * autoCut.js — 自动剪辑算法模块（纯函数，无 DOM 依赖，Node 可测）。
 *
 * 目标：寻找「无痕剪辑」位置——在该处切开并拼接，听感上不产生咔嗒/断裂：
 *   1. 剪切点位于能量低谷（乐句间隙/呼吸处），避免切断音符与瞬态；
 *   2. 剪切点处信号连续（幅度小、斜率小，优选过零附近），拼接无缝；
 *   3. 若存在节拍网格，剪切点优先对齐网格线（小节线 > 拍线），保证节奏连贯。
 *
 * 流程：
 *   energyEnvelope（积分图 O(n) RMS 包络）→ findValleys（局部极小 + 谷深）
 *   → locateCutPoint（谷内最小差分定位）→ gridAlign（可选网格对齐）
 *   → buildPlan（剪切点 → 分段方案，过滤过短段）。
 *
 * 浏览器全局暴露为 window.MC，CommonJS 环境 module.exports。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    global.MC.autoCut = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_ANALYSIS_SR = 22050;

  /**
   * 计算 RMS 能量包络（积分图实现，O(n)）。
   * @param {Float32Array|ArrayLike<number>} pcm 单声道 PCM（-1..1）
   * @param {object} [opts]
   * @param {number} [opts.win=1024] 能量窗（样本，≈46ms@22050）
   * @param {number} [opts.hop=256] 窗步进（样本，≈11.6ms@22050）
   * @returns {{env:Float32Array, win:number, hop:number}} env[i] 为窗 [i*hop, i*hop+win) 的 RMS
   */
  function energyEnvelope(pcm, opts = {}) {
    const win = opts.win || 1024;
    const hop = opts.hop || 256;
    const n = pcm.length;
    if (n < win) return { env: new Float32Array(0), win, hop };
    // 平方和积分图：O(n) 一次遍历，每窗 O(1) 查询
    const integ = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) integ[i + 1] = integ[i] + pcm[i] * pcm[i];
    const nEnv = Math.floor((n - win) / hop) + 1;
    const env = new Float32Array(nEnv);
    for (let i = 0; i < nEnv; i++) {
      const s = i * hop;
      env[i] = Math.sqrt((integ[s + win] - integ[s]) / win);
    }
    return { env, win, hop };
  }

  /**
   * 检测能量包络的局部极小（谷）并计算谷深。
   * 谷 = 平台 span（不高于谷值的连续区域）+ 两侧峰；谷深 = min(两侧峰) - 谷值。
   * 平台内多个极小点合并为一个谷（记录平台起点）；正弦持续段包络的微小波动
   * 因谷深低于显著性阈值（全局最大能量的 5%）被过滤，不会产生伪剪切点。
   * @param {Float32Array} env
   * @param {object} [opts]
   * @param {number} [opts.neighborhood=5] 平台外左右峰搜索半径（包络点）
   * @param {number} [opts.minDepthRatio=0.05] 谷深显著性：低于全局最大值该比例的谷丢弃
   * @returns {Array<{idx:number, depth:number}>} 按深度降序
   */
  function findValleys(env, opts = {}) {
    const half = opts.neighborhood || 5;
    const minDepthRatio = opts.minDepthRatio != null ? opts.minDepthRatio : 0.05;
    const n = env.length;
    let envMax = 0;
    for (let i = 0; i < n; i++) if (env[i] > envMax) envMax = env[i];
    const minDepth = Math.max(envMax * minDepthRatio, 1e-6);
    const out = [];
    for (let i = 1; i < n - 1; i++) {
      // 局部极小（含平台）：不高于两侧
      if (env[i] > env[i - 1] || env[i] > env[i + 1]) continue;
      // 平台 span：向左右扩展到能量高于谷值处
      const th = env[i] + 1e-12;
      let lo = i, hi = i;
      while (lo > 0 && env[lo - 1] <= th) lo--;
      while (hi < n - 1 && env[hi + 1] <= th) hi++;
      // 两侧峰（平台外 half 点内最大）：平台大时真实峰在平台边界外
      let lPeak = -Infinity, rPeak = -Infinity;
      for (let j = Math.max(0, lo - half); j < lo; j++) if (env[j] > lPeak) lPeak = env[j];
      for (let j = hi + 1; j <= Math.min(n - 1, hi + half); j++) if (env[j] > rPeak) rPeak = env[j];
      const depth = Math.min(lPeak, rPeak) - env[i];
      if (depth > minDepth) out.push({ idx: i, depth });
      i = hi; // 跳过平台内其余极小点（for 循环 i++ 后继续）
    }
    // 相邻过近的谷合并（只留较深者）；按深度降序供贪心选择
    out.sort((a, b) => b.depth - a.depth);
    const dedup = [];
    for (const v of out) {
      if (dedup.some((d) => Math.abs(d.idx - v.idx) < 3)) continue;
      dedup.push(v);
    }
    return dedup;
  }

  /**
   * 谷底平台中心（包络点索引）：向左右扩展至能量不再近似等于谷值，取平台中点。
   * 静音区间（包络=0 的平台）由此定位到区间中央，而非边缘。
   * @param {Float32Array} env
   * @param {number} idx 谷索引
   * @returns {number} 平台中心索引（可为小数）
   */
  function valleyCenter(env, idx) {
    const v = env[idx];
    const th = v + 1e-12; // 平台内近似等于谷值（浮点噪声容差）
    let lo = idx, hi = idx;
    while (lo > 0 && env[lo - 1] <= th) lo--;
    while (hi < env.length - 1 && env[hi + 1] <= th) hi++;
    return (lo + hi) / 2;
  }

  /**
   * 在谷中心附近精确定位剪切样本：最小化「差分 + 幅度 + 偏离中心」成本。
   * 差分小 = 波形连续（拼接无咔嗒）；幅度小 = 接近过零；偏离惩罚使静音平台取中心。
   * @param {Float32Array|ArrayLike<number>} pcm
   * @param {number} centerSample 谷中心样本索引
   * @param {number} radius 搜索半径（样本）
   * @param {number} sr 采样率
   * @returns {{time:number, cost:number}} 剪切时间（秒）与成本
   */
  function locateCutPoint(pcm, centerSample, radius, sr) {
    const lo = Math.max(0, centerSample - radius);
    const hi = Math.min(pcm.length - 2, centerSample + radius);
    let best = lo, bestCost = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = Math.abs(pcm[i + 1] - pcm[i]);
      const a = Math.abs(pcm[i]);
      const cost = d + a * 0.5 + Math.abs(i - centerSample) * 1e-4;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return { time: best / sr, cost: bestCost };
  }

  /**
   * 将剪切时间对齐到最近的网格线（小节线优先于拍线）。
   * @param {number} time 剪切时间（秒）
   * @param {object|null} grid buildGrid 的返回（无网格传 null）
   * @param {number} [radiusSec=0.12] 可吸附半径（秒）
   * @returns {{time:number, reason:string}|null} reason: 'bar'|'beat'；超出半径返回 null
   */
  function gridAlign(time, grid, radiusSec = 0.12) {
    if (!grid || !grid.bars) return null;
    let best = null;
    let bestD = radiusSec;
    for (const b of grid.bars) {
      const d = Math.abs(b.startTime - time);
      if (d <= bestD) { bestD = d; best = { time: b.startTime, reason: 'bar' }; }
    }
    if (!best && grid.beatTimes) {
      for (const t of grid.beatTimes) {
        const d = Math.abs(t - time);
        if (d <= bestD) { bestD = d; best = { time: t, reason: 'beat' }; }
      }
    }
    return best;
  }

  /**
   * 剪切点质量评分（0-100）：三因子加权——能量分（谷深占比 50）+ 连续分
   * （定位成本 30，成本 0 时满分、随差分/幅度增大衰减）+ 网格分（对齐网格
   * 线 +20）。分离成纯函数便于单测与调参。
   * @param {number} depth 谷深（能量包络）
   * @param {number} maxDepth 全部候选谷的最深值（能量分归一化基准）
   * @param {number} cost 定位成本（locateCutPoint 返回；越小越连续）
   * @param {string} reason 'bar'|'beat'|'valley'
   * @returns {number} 0-100 整数（下限 1，保证展示有意义）
   */
  function scoreCut(depth, maxDepth, cost, reason) {
    const energy = 50 * (maxDepth > 0 ? depth / maxDepth : 0);
    // cost 量纲为幅度（-1..1 差分典型 0~0.25）：8 为经验归一化系数
    const smooth = 30 / (1 + (cost || 0) * 8);
    const grid = (reason === 'bar' || reason === 'beat') ? 20 : 0;
    return Math.max(1, Math.min(100, Math.round(energy + smooth + grid)));
  }

  /**
   * 查找无痕剪切点（按谷深贪心 + 最小间隔过滤）。
   * @param {Float32Array|ArrayLike<number>} pcm 分析用 mono PCM（22050）
   * @param {object} [opts]
   * @param {number} [opts.sr=22050]
   * @param {object} [opts.grid] 节拍网格（用于对齐；无网格/传 null 跳过）
   * @param {number} [opts.minGapSec=2] 相邻剪切点最小间隔（秒）
   * @param {number} [opts.maxCuts=14] 剪切点数量上限
   * @param {number} [opts.alignRadius=0.12] 网格吸附半径（秒）
   * @returns {Array<{time:number, score:number, reason:string}>} 按时间升序
   */
  function findCutPoints(pcm, opts = {}) {
    const sr = opts.sr || DEFAULT_ANALYSIS_SR;
    const minGapSec = opts.minGapSec != null ? opts.minGapSec : 2;
    const maxCuts = opts.maxCuts != null ? opts.maxCuts : 14;
    const alignRadius = opts.alignRadius != null ? opts.alignRadius : 0.12;
    const { env, win, hop } = energyEnvelope(pcm, opts);
    if (!env.length) return [];
    const valleys = findValleys(env, opts);
    if (!valleys.length) return [];
    const maxDepth = valleys[0].depth || 1;
    const picked = [];
    for (const v of valleys) {
      if (picked.length >= maxCuts) break;
      const centerSample = Math.round(valleyCenter(env, v.idx) * hop + win / 2);
      const pt = locateCutPoint(pcm, centerSample, Math.round(win * 0.75), sr);
      let time = pt.time;
      let reason = 'valley';
      const aligned = gridAlign(time, opts.grid, alignRadius);
      if (aligned) { time = aligned.time; reason = aligned.reason; }
      if (picked.some((p) => Math.abs(p.time - time) < minGapSec)) continue;
      const score = scoreCut(v.depth, maxDepth, pt.cost, reason);
      picked.push({ time: Math.round(time * 1000) / 1000, score, reason });
    }
    return picked.sort((a, b) => a.time - b.time);
  }

  /**
   * 生成自动剪辑方案：剪切点 → 分段列表，过滤过短段（循环合并至稳定）。
   * @param {Float32Array|ArrayLike<number>} pcm 分析用 mono PCM（22050）
   * @param {object} [opts]
   * @param {number} [opts.sr=22050]
   * @param {number} [opts.duration] 音频总时长（秒）；默认按 pcm 长度
   * @param {number} [opts.searchStart=0] 分析范围起点（秒；网格覆盖范围时传网格起点）
   * @param {number} [opts.searchEnd] 分析范围终点（秒；默认 duration）
   * @param {number} [opts.minSegSec=3] 最短段长（秒），短于此的段并入相邻段
   * @param {object} [opts.grid] 节拍网格（对齐用）
   * @returns {{cuts:Array, segments:Array}}
   *   cuts: [{time, score, reason}] 保留的剪切点（升序）
   *   segments: [{startTime, endTime}] 分段方案（相邻段精确衔接）
   */
  function buildPlan(pcm, opts = {}) {
    const sr = opts.sr || DEFAULT_ANALYSIS_SR;
    const minSegSec = opts.minSegSec != null ? opts.minSegSec : 3;
    const duration = opts.duration != null ? opts.duration : pcm.length / sr;
    const start = opts.searchStart != null ? opts.searchStart : 0;
    const end = opts.searchEnd != null ? opts.searchEnd : duration;
    // 相邻剪切点间隔默认与最小段长一致：保证切出的段至少满足最短段长
    // （若 minGap < minSeg，贪心选出的密集剪切点会被段过滤全部合并 → 空方案）
    const all = findCutPoints(pcm, Object.assign({}, opts, {
      minGapSec: opts.minGapSec != null ? opts.minGapSec : minSegSec,
    }));
    // 范围过滤：剪切点必须严格落在分析范围内（边界由首尾段本身承担）
    const cuts = all.filter((c) => c.time > start + 1e-6 && c.time < end - 1e-6);
    // 过短段合并：删除使相邻任一段短于 minSegSec 的剪切点，循环至稳定
    let pts = [start, ...cuts.map((c) => c.time), end];
    let changed = true;
    while (changed && pts.length > 2) {
      changed = false;
      for (let i = 1; i < pts.length - 1; i++) {
        if (pts[i] - pts[i - 1] < minSegSec || pts[i + 1] - pts[i] < minSegSec) {
          pts.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (pts.length < 2) return { cuts: [], segments: [] };
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pts[i + 1] - pts[i];
      if (d < 1e-6) continue;
      segments.push({ startTime: pts[i], endTime: pts[i + 1] });
    }
    const kept = new Set(pts.slice(1, -1).map((t) => Math.round(t * 1000)));
    const finalCuts = cuts.filter((c) => kept.has(Math.round(c.time * 1000)));
    // 无保留剪切点 = 没有剪辑方案（全曲一段的导入无意义）
    if (!finalCuts.length) return { cuts: [], segments: [] };
    return { cuts: finalCuts, segments };
  }

  return {
    DEFAULT_ANALYSIS_SR,
    energyEnvelope,
    findValleys,
    valleyCenter,
    locateCutPoint,
    gridAlign,
    scoreCut,
    findCutPoints,
    buildPlan,
  };
});
