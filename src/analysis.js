/**
 * analysis.js — 核心算法模块（纯函数，无 DOM 依赖，Node 可测）
 *
 * 检测流程：
 *   1. resample 降采样到分析采样率（22050 Hz）
 *   2. STFT（radix-2 FFT + Hann 窗）→ 频谱通量（spectral flux）
 *   3. 峰值检测 → onset 时间序列
 *   4. onset 自相关 → BPM 估计
 *   5. 候选偏移吻合度投票 → 相位（offset）估计
 *   6. buildGrid 生成小节/节拍网格
 *
 * 浏览器全局暴露为 window.MC，CommonJS 环境 module.exports。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_ANALYSIS_SR = 22050;

  // —— 八度判定（1.19.0，原评估报告 P1「半频归一」）参数 ——
  // 落半频是当前最大的单点损失（全量 1812 首中 806 首，45%）。算法几乎总能找到
  // 正确的"律动族"，只是挑错八度（层正确 83%+ 但精确命中仅 34%）。
  // 判定依据：若存在 ≈2× 主峰的强候选层，说明真实拍频可能是主峰的两倍。
  const OCT_RATIO_TOL = 0.08;  // 候选与主峰的倍频关系容差
  const OCT_REL = 0.55;        // 候选层相对主峰的最低强度（rel = 候选分 / 主峰分）
  const OCT_MIN_TARGET = 90;   // 提升目标下限（低于此值不进候选）
  // 主峰守卫：只在主峰低于此值时才允许提升。这是纯先验——本语料（maimai 系谱面）
  // 94% 的曲子 ≥120 BPM，主峰 <120 基本可判为半速误判。
  // 全量实测（1812 首）：无守卫 67.3% / w<100 68.2% / w<110 71.3% / **w<120 71.7%**；
  // 代价在真值 ≤120 的曲子（105 首，占 5.8%）上从 45% 降到 21%——纯自相关证据
  // 分不开"真值 100"与"真值 200 但主峰落在 100"，只能靠音域先验。
  // 若要把低 BPM 曲目保护得更重，改小此常量即可（w<100 时低档回到 48%，
  // 代价是整体掉到 68.2%）。竞争层候选列表仍会展示另一半，用户可一键切回。
  const OCTAVE_GUARD_BPM = 120;
  const OCTAVE_CAP = 300;      // 提升目标上限 = modal.js 的 BPM 校验域顶

  /** 生成 Hann 窗（对称，length 个点）。 */
  function hannWindow(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }

  /**
   * 原地 radix-2 FFT（Cooley-Tukey）。
   * @param {Float64Array} re 实部（就地写回）
   * @param {Float64Array} im 虚部（就地写回）
   * @returns {void}
   */
  function fft(re, im) {
    const n = re.length;
    if (n <= 1) return;
    if ((n & (n - 1)) !== 0) throw new Error('fft: 长度必须是 2 的幂，实际 ' + n);
    // 位反转置换
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
      let m = n >> 1;
      while (j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let k = 0; k < half; k++) {
          const aRe = re[i + k], aIm = im[i + k];
          const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
          const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
          re[i + k] = aRe + bRe;
          im[i + k] = aIm + bIm;
          re[i + k + half] = aRe - bRe;
          im[i + k + half] = aIm - bIm;
          const nRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nRe;
        }
      }
    }
  }

  /**
   * 计算频谱通量序列（相邻帧幅度谱正差分之和）。
   * 流式计算，不保存全部谱，内存 O(帧数)。
   * @param {Float32Array|number[]} pcm 单声道 PCM（-1..1）
   * @param {object} [opts]
   * @param {number} [opts.frameSize=2048]
   * @param {number} [opts.hop=512]
   * @returns {Float32Array} 每帧一个通量值
   */
  function spectralFlux(pcm, opts = {}) {
    const frameSize = opts.frameSize || 2048;
    const hop = opts.hop || 512;
    if (pcm.length < frameSize) return new Float32Array(0);
    const win = hannWindow(frameSize);
    const nFrames = Math.floor((pcm.length - frameSize) / hop) + 1;
    const flux = new Float32Array(nFrames);
    const re = new Float64Array(frameSize);
    const im = new Float64Array(frameSize);
    // 双缓冲复用幅度数组，消除每帧 Float64Array.from 分配（GC 压力）
    const magsA = new Float64Array(frameSize >> 1);
    const magsB = new Float64Array(frameSize >> 1);
    let mags = magsA;
    let prev = null;
    for (let f = 0; f < nFrames; f++) {
      const start = f * hop;
      for (let i = 0; i < frameSize; i++) {
        re[i] = pcm[start + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      // sqrt(re²+im²) 等价 Math.hypot（幅度上界 ≤2048 无溢出），免 V8 hypot 溢出防护慢路径
      for (let i = 0; i < mags.length; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      if (prev) {
        let s = 0;
        for (let i = 0; i < mags.length; i++) {
          const d = mags[i] - prev[i];
          if (d > 0) s += d;
        }
        // flux[f] = 帧 f 与帧 f-1 的差分；flux[0] 恒为 0
        flux[f] = s;
      }
      prev = mags;
      mags = (mags === magsA) ? magsB : magsA;
    }
    return flux;
  }

  /**
   * 从通量序列检测 onset 时间点（librosa peak_pick 风格）。
   * 流程：3 点平滑 → 全局归一化（z-score）→ 局部极大 → 与前后平均比较 + delta → 最小间隔。
   * 归一化使阈值与信号绝对强度无关，强弱动态的音乐都能正确处理。
   * @param {Float32Array} flux
   * @param {object} [opts]
   * @param {number} [opts.sampleRate=22050]
   * @param {number} [opts.hop=512]
   * @param {number} [opts.frameSize=2048]
   * @param {number} [opts.preMax=1] 局部极大前窗
   * @param {number} [opts.postMax=1] 局部极大后窗
   * @param {number} [opts.preAvg=3] 平均前窗
   * @param {number} [opts.postAvg=3] 平均后窗
   * @param {number} [opts.delta=0.8] 峰高于平均的最小差值（归一化单位）
   * @param {number} [opts.minGapMs=80] 相邻 onset 最小间隔
   * @returns {number[]} onset 时间（秒）
   */
  function detectOnsets(flux, opts = {}) {
    const sampleRate = opts.sampleRate || DEFAULT_ANALYSIS_SR;
    const hop = opts.hop || 512;
    const frameSize = opts.frameSize || 2048;
    const preMax = opts.preMax || 1;
    const postMax = opts.postMax || 1;
    const preAvg = opts.preAvg || 3;
    const postAvg = opts.postAvg || 3;
    const delta = opts.delta != null ? opts.delta : 0.8;
    const minGapMs = opts.minGapMs != null ? opts.minGapMs : 80;
    const wait = Math.max(1, Math.round((minGapMs / 1000) / (hop / sampleRate)));
    const times = [];
    const n = flux.length;
    if (n < 3) return times;

    // 3 点平滑
    const smooth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      smooth[i] = (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(n - 1, i + 1)]) / 3;
    }
    // 归一化
    let mean = 0;
    for (let i = 0; i < n; i++) mean += smooth[i];
    mean /= n;
    let varSum = 0;
    for (let i = 0; i < n; i++) varSum += (smooth[i] - mean) * (smooth[i] - mean);
    const std = Math.sqrt(varSum / n) || 1;
    const norm = new Float32Array(n);
    for (let i = 0; i < n; i++) norm[i] = (smooth[i] - mean) / std;

    let lastFrame = -Infinity;
    for (let i = 0; i < n; i++) {
      // 局部极大（含边界比较）
      let isMax = true;
      for (let j = Math.max(0, i - preMax); j <= Math.min(n - 1, i + postMax); j++) {
        if (norm[j] > norm[i] || (norm[j] === norm[i] && j !== i)) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      // 与前后窗口平均比较
      let avgSum = 0;
      let avgN = 0;
      for (let j = Math.max(0, i - preAvg); j <= Math.min(n - 1, i + postAvg); j++) {
        avgSum += norm[j];
        avgN++;
      }
      if (norm[i] < avgSum / avgN + delta) continue;
      if (i - lastFrame < wait) continue;
      lastFrame = i;
      times.push((i * hop + frameSize / 2) / sampleRate);
    }
    return times;
  }

  /**
   * 计算某个 BPM 下 onset 与最优网格的对齐成本。
   * 粗扫候选偏移，取所有 onset 到最近网格线距离平方和的最小值。
   * 半速/倍速区分力强：真正的节拍 BPM 成本趋近 0。
   * @param {number[]} onsets 秒
   * @param {number} bpm
   * @param {number} [steps=32] 候选偏移扫描步数
   * @returns {number}
   */
  function gridCost(onsets, bpm, steps = 32) {
    const beat = 60 / bpm;
    let best = Infinity;
    for (let c = 0; c < steps; c++) {
      const offset = (c / steps) * beat;
      let d = 0;
      for (let k = 0; k < onsets.length; k++) {
        const phase = ((onsets[k] - offset) % beat + beat) % beat;
        const dist = Math.min(phase, beat - phase);
        d += dist * dist;
      }
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * 从 onset 时间序列估计 BPM（网格对齐评分，60–200 范围，步长 1 BPM）。
   * @param {number[]} onsets 秒
   * @param {object} [opts]
   * @param {number} [opts.minBpm=60]
   * @param {number} [opts.maxBpm=200]
   * @returns {number|null} BPM 或 null（onset 不足）
   */
  /**
   * BPM 主峰 + 竞争层候选评估（v1.11.0）：主峰选择逻辑与先前完全一致，
   * 另收集自相关谱的局部峰作为「其他可能 BPM」候选（供 UI 展示与用户采用）。
   * @param {number[]} onsets 秒
   * @param {object} [opts]
   * @param {number} [opts.minBpm=60]
   * @param {number} [opts.maxBpm=200]
   * @returns {{bpm:number|null, cands:Array<{bpm:number, score:number, rel:number, harm:null|string}>}}
   *   cands 按分数降序最多 5 项；harm 为与主峰的整数倍关系（'2x'|'0.5x'|'3x'|'0.33x'）
   */
  function scanBpm(onsets, opts = {}) {
    const minBpm = opts.minBpm || 60;
    const maxBpm = opts.maxBpm || 200;
    if (!onsets || onsets.length < 4) return { bpm: null, cands: [] };
    // 长曲目 onset 过多时均匀抽样，控制成本
    let sample = onsets;
    if (onsets.length > 600) {
      sample = [];
      const step = onsets.length / 600;
      for (let i = 0; i < 600; i++) sample.push(onsets[Math.floor(i * step)]);
    }
    // 自相关主导周期：滞后范围对应 BPM minBpm–maxBpm（默认约 0.3–1.0s）。
    // 半拍/八分假峰（如 0.209s）天然落在范围外；倍速滞后（2×）配对 onset 数远少于真拍，
    // 除非 onset 严格等间隔（合成信号），此时主峰加权中心仍指向较快拍。
    // 相比纯 gridCost 最近线距离，对八分/十六分混合节奏更鲁棒：真拍滞后处配对 onset 最多。
    const lagMin = 60 / maxBpm;
    const lagMax = 60 / minBpm;
    const sorted = Float64Array.from(sample).sort();
    // 双指针单调扫描（模块级 scoreNear，见下）：sample 有序，每 lag O(N)（原二分 O(N log N)）。
    const scoreAt = (lag) => scoreNear(sorted, sample, lag);
    // 单次扫描：记录全谱 + 最高分（主峰选择与 v1.8+ 一致）
    const lags = [];
    const scores = [];
    let bestLag = null;
    let bestScore = -Infinity;
    for (let lag = lagMin; lag <= lagMax + 1e-9; lag += 0.002) {
      const s = scoreAt(lag);
      lags.push(lag);
      scores.push(s);
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    if (bestLag === null || bestScore < sample.length * 0.04) return { bpm: null, cands: [] };
    // 主峰 ±0.04s 内按分数加权取中心（onset 检测抖动会使平台出现，中心最接近真实周期）
    const centerOf = (lag) => {
      let sum = 0;
      let wsum = 0;
      for (let lag2 = Math.max(lagMin, lag - 0.04); lag2 <= Math.min(lagMax, lag + 0.04); lag2 += 0.002) {
        const s = scoreAt(lag2);
        sum += lag2 * s;
        wsum += s;
      }
      return wsum > 0 ? sum / wsum : lag;
    };
    const center = centerOf(bestLag);
    // 局部细化：估计值 ±max(3, bpm×4%) 内 0.1 步长，onset 到最近拍线距离平方和最小。
    // 自相关平台受 ±0.03s 配对窗口影响有 ±1 BPM 误差，且主峰中心偏差可达 3~4%
    // （如 194 vs 200），固定 ±3 窗口不足以回拉——按比例窗口（200±8）覆盖。
    const sample400 = sample.slice(0, 400);
    const refine = (b) => {
      const half = Math.max(3, Math.round(b * 0.04));
      let bc = gridCost(sample400, b);
      let best = b;
      for (let x = b - half; x <= b + half + 1e-9; x += 0.1) {
        const c = gridCost(sample400, x);
        if (c < bc) { bc = c; best = x; }
      }
      return Math.round(best * 10) / 10;
    };
    let bpm = refine(Math.round(60 / center));
    bpm = Math.min(maxBpm, Math.max(minBpm, bpm));

    // 竞争层候选：局部峰（分数 ≥ 主峰 25% 且 BPM 距主峰 >2 才展示；每峰加权中心）
    const harmOf = (b) => {
      const r = b / bpm;
      if (Math.abs(r - 2) <= 0.08) return '2x';
      if (Math.abs(r - 0.5) <= 0.02) return '0.5x';
      if (Math.abs(r - 3) <= 0.12) return '3x';
      if (Math.abs(r - 1 / 3) <= 0.014) return '0.33x';
      return null;
    };
    const cands = [];
    const seenLags = [];
    for (let i = 1; i < scores.length - 1; i++) {
      if (scores[i] < scores[i - 1] || scores[i] < scores[i + 1]) continue; // 局部峰
      if (scores[i] < bestScore * 0.25) continue;
      const lag = lags[i];
      if (seenLags.some((t) => Math.abs(t - lag) < 0.03)) continue;
      const nearBpm = Math.round((60 / lag) * 10) / 10;
      if (Math.abs(nearBpm - bpm) < 2) continue;
      seenLags.push(lag);
      const c = centerOf(lag);
      const cb = refine(Math.round((60 / c) * 10) / 10); // 候选同样细化（±max(3, b×4%) 窗口）
      if (Math.abs(cb - bpm) < 2) continue;
      cands.push({
        bpm: cb,
        score: Math.round(scores[i]),
        rel: Math.round((scores[i] / bestScore) * 100) / 100,
        harm: harmOf(cb),
      });
    }
    cands.sort((a, b) => b.score - a.score);
    return { bpm, cands: cands.slice(0, 5) };
  }

  /**
   * BPM 主估计（兼容旧接口，返回数值或 null）。
   * @param {number[]} onsets 秒
   * @param {object} [opts]
   * @param {number} [opts.minBpm=60]
   * @param {number} [opts.maxBpm=200]
   * @returns {number|null} BPM 或 null（onset 不足）
   */
  function estimateBpm(onsets, opts = {}) {
    return scanBpm(onsets, opts).bpm;
  }

  /**
   * BPM 主估计 + 竞争层候选（v1.11.0 新增）。
   * @param {number[]} onsets 秒
   * @param {object} [opts]
   * @param {number} [opts.minBpm=60]
   * @param {number} [opts.maxBpm=200]
   * @returns {{bpm:number|null, cands:Array}}
   */
  function estimateBpmCands(onsets, opts = {}) {
    return scanBpm(onsets, opts);
  }

  /**
   * 双指针单调扫描：sample 有序（t = sample[k]+lag 随 k 单调不减）时，统计
   * 落在每个 sample[k]+lag 的 ±0.03s 窗口内的 sorted 元素个数（onset 自相关配对）。
   * 每 lag O(N)；等价于对每个 sample[k] 二分 hasNear。
   * @param {Float64Array} sorted 有序 onset
   * @param {number[]} sample 有序 onset（与 sorted 同源）
   * @param {number} lag 滞后（秒）
   * @returns {number} 配对 onset 数
   */
  function scoreNear(sorted, sample, lag) {
    let score = 0;
    let lo = 0, hi = 0;
    for (let k = 0; k < sample.length; k++) {
      const t = sample[k] + lag;
      const loT = t - 0.03, hiT = t + 0.03;
      while (lo < sorted.length && sorted[lo] < loT) lo++;
      while (hi < sorted.length && sorted[hi] <= hiT) hi++;
      if (hi > lo) score++;
    }
    return score;
  }


  /**
   * 估计网格偏移（第 1 拍相对 0s 的相位）。
   * 扫描候选偏移，取所有 onset 到最近网格线距离平方和最小者。
   * @param {number[]} onsets 秒
   * @param {number} bpm
   * @param {object} [opts]
   * @param {number} [opts.resolution=0.005] 候选偏移步长（秒）
   * @returns {number} offset（秒，0..beat 之间）
   */
  function estimateOffset(onsets, bpm, opts = {}) {
    const resolution = opts.resolution || 0.005;
    const beat = 60 / bpm;
    const nCand = Math.max(1, Math.floor(beat / resolution));
    let bestOffset = 0;
    let bestScore = Infinity;
    for (let c = 0; c < nCand; c++) {
      const offset = c * resolution;
      let dist = 0;
      for (let k = 0; k < onsets.length; k++) {
        const phase = ((onsets[k] - offset) % beat + beat) % beat;
        const d = Math.min(phase, beat - phase);
        dist += d * d;
      }
      if (dist < bestScore) {
        bestScore = dist;
        bestOffset = offset;
      }
    }
    return bestOffset;
  }

  /**
   * 生成分段小节/节拍网格。
   *
   * 段定义：{bpm, beatsPerBar, beatUnit, bars?:number, durationSec?:number, resolution?:number}
   *   - bars 与 durationSec 二选一（bars 优先）：bars → 小节数自动算时长；
   *     durationSec → 直接指定段时长（适配无节拍段落，bpm 仅用于画拍线）
   *   - resolution：网格分辨率（每小节线数），默认 = 拍号分子（每拍一条线）
   * 第 1 段起点 = offset（全局偏移）；第 N 段起点 = 前段起点 + 前段长度。
   * 小节号跨段连续编号。
   *
   * @param {object} params
   * @param {Array} params.segments 段定义数组（至少 1 段）
   * @param {number} params.offset 第 1 段起点相对 0s 的偏移（秒，可负）
   * @param {number} params.duration 音频总时长（秒）
   * @returns {object}
   *   { segments:[{index,bpm,beatsPerBar,beatUnit,startTime,endTime,barDur,beatDur,
   *                resolution,barStart,bars:[{barNumber,startTime,endTime}]}],
   *     bars:[...全部小节], beatTimes:number[], barDur:null }
   */
  function buildGrid(params) {
    const { segments, offset = 0, duration } = params;
    if (!Array.isArray(segments) || !segments.length) {
      throw new Error('buildGrid: 至少需要一个段落');
    }
    // 全空小节下界：offset 负值不能超过首段一个小节长（首小节必须与音频重叠）
    const f0 = segments[0];
    if (f0 && f0.bpm > 0 && offset <= -(60 / f0.bpm) * (f0.beatsPerBar || 4)) {
      throw new Error('buildGrid: offset 负值不能超过一个小节长度（首小节将与音频完全无重叠）');
    }
    let t = offset;
    let barNumber = 1;
    const outSegments = [];
    const allBars = [];
    const beatTimes = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const bpm = seg.bpm;
      const beatsPerBar = seg.beatsPerBar;
      if (!bpm || bpm <= 0 || !beatsPerBar || beatsPerBar <= 0) {
        throw new Error('buildGrid: 第 ' + (i + 1) + ' 段的 bpm 与拍号必须为正数');
      }
      const beatDur = 60 / bpm;
      const barDur = beatDur * beatsPerBar;
      // 网格分辨率：每小节线数（默认 = 拍号分子，即每拍一条线）
      const resolution = seg.resolution || seg.subdivision * (seg.beatsPerBar || 4) || beatsPerBar;
      // 段时长：小节数优先，其次显式时长
      let segDur;
      if (seg.bars) {
        segDur = seg.bars * barDur;
      } else if (seg.durationSec != null) {
        segDur = seg.durationSec;
      } else {
        throw new Error('buildGrid: 第 ' + (i + 1) + ' 段需指定小节数或时长');
      }
      const start = t;
      const end = t + segDur;
      const segBars = [];
      const nBars = seg.bars || Math.max(1, Math.ceil(segDur / barDur));
      // 相邻小节精确衔接：下一小节起点 = 当前小节终点（同一累积值），
      // 避免 start + b*barDur（乘法链）与 s + barDur（加法链）的浮点差导致
      // 起点时间戳被上一小节末尾吞掉（如 7.1 显示成 6.4）
      let s = start;
      for (let b = 0; b < nBars && s < duration - 1e-9; b++) {
        // 小节截断：不生成与音频完全无重叠的小节（含负起点首小节 = 部分重叠允许；
        // 末小节 endTime 保留完整小节长，超长部分由导出/播放补静音）
        const e = Math.min(s + barDur, end);
        segBars.push({ barNumber, startTime: s, endTime: e });
        barNumber++;
        s = e;
      }
      // 拍线（含细分）
      const step = barDur / resolution;
      for (let bt = start; bt < end + 1e-6; bt += step) {
        if (bt >= 0 && bt < duration) beatTimes.push(bt);
      }
      outSegments.push({
        index: i,
        bpm,
        beatsPerBar,
        beatUnit: seg.beatUnit || 4,
        resolution,
        startTime: start,
        endTime: end,
        barDur,
        beatDur,
        bars: segBars,
      });
      allBars.push(...segBars);
      t = end;
    }
    return { segments: outSegments, bars: allBars, beatTimes, barDur: null };
  }

  /**
   * 解析段定义，补齐每段长度（buildGrid 前置步骤）。
   * 规则（与自动识别逻辑一致）：
   *   - 段需 bpm > 0；
   *   - 指定 bars 或 durationSec 则长度确定；
   *   - 未指定长度：必须是最后一段，自动延伸至音频末尾；
   *     中间段未指定长度则报错（后续段起点依赖前段长度）。
   * @param {Array} segs 用户输入的段定义
   * @param {number} duration 音频总时长
   * @returns {Array} 补齐长度后的段定义
   */
  function resolveSegments(segs, duration) {
    if (!Array.isArray(segs) || !segs.length) {
      throw new Error('至少需要一个段落');
    }
    const out = [];
    let t = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!s.bpm || s.bpm <= 0) {
        throw new Error('第 ' + (i + 1) + ' 段未填写 BPM');
      }
      const beatDur = 60 / s.bpm;
      const barDur = beatDur * s.beatsPerBar;
      let resolved;
      if (s.bars && s.bars > 0) {
        resolved = Object.assign({}, s, { bars: s.bars });
        t += s.bars * barDur;
      } else if (s.durationSec != null && s.durationSec >= 0) {
        resolved = Object.assign({}, s, { durationSec: s.durationSec });
        t += s.durationSec;
      } else if (i === segs.length - 1) {
        // 最后一段无长度 → 延伸至末尾
        const remaining = Math.max(0, duration - t);
        resolved = Object.assign({}, s, { bars: Math.max(1, Math.ceil(remaining / barDur)) });
        t += remaining;
      } else {
        throw new Error('第 ' + (i + 1) + ' 段需指定小节数或时长（后续段起点依赖它）');
      }
      out.push(resolved);
    }
    return out;
  }

  /**
   * 单段便捷包装：以一段 bpm/拍号生成网格（旧接口兼容）。
   */
  function buildSimpleGrid(bpm, beatsPerBar, offset, duration, resolution) {
    const segs = resolveSegments([{ bpm, beatsPerBar }], duration);
    return buildGrid({ segments: segs, offset, duration });
  }

  /**
   * 线性重采样。
   * @param {Float32Array|number[]} pcm
   * @param {number} fromRate
   * @param {number} toRate
   * @returns {Float32Array}
   */
  function resample(pcm, fromRate, toRate) {
    if (fromRate === toRate) return Float32Array.from(pcm);
    const n = Math.max(1, Math.floor((pcm.length * toRate) / fromRate));
    const out = new Float32Array(n);
    const ratio = fromRate / toRate;
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const idx = Math.min(Math.floor(pos), pcm.length - 1);
      const frac = pos - idx;
      const a = pcm[idx];
      const b = idx + 1 < pcm.length ? pcm[idx + 1] : a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  /**
   * 将多声道 AudioBuffer 数据合并为 mono Float32Array。
   * @param {Float32Array[]} channels 各声道数据
   * @returns {Float32Array}
   */
  function toMono(channels) {
    const n = channels[0].length;
    const out = new Float32Array(n);
    if (channels.length === 1) {
      out.set(channels[0]);
      return out;
    }
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = 0; i < n; i++) out[i] += ch[i];
    }
    const inv = 1 / channels.length;
    for (let i = 0; i < n; i++) out[i] *= inv;
    return out;
  }

  /**
   * 八度层选择（纯函数，可单测）：在候选层里找出该把主峰提升到的 2× 层。
   *
   * 规则：主峰本身低于守卫值（先验：本语料 94% 的曲子 ≥120 BPM，主峰 <120
   * 基本可判为半速误判）时，若存在 ≈2× 主峰、强度 rel ≥ OCT_REL、落在
   * [OCT_MIN_TARGET, OCTAVE_CAP] 的候选层，则提升到其中最强者。
   *
   * @param {number|null} mainBpm 宽扫主峰
   * @param {Array<{bpm:number, rel:number}>} cands 竞争层候选
   * @returns {number|null} 提升后的 BPM；不需要提升返回 null
   */
  function pickOctaveLayer(mainBpm, cands) {
    if (mainBpm == null || mainBpm >= OCTAVE_GUARD_BPM) return null;
    let best = null;
    for (const c of cands || []) {
      if (Math.abs(c.bpm / mainBpm - 2) > OCT_RATIO_TOL) continue; // 只认 ≈2× 层
      if (c.bpm < OCT_MIN_TARGET || c.bpm > OCTAVE_CAP) continue;
      if (c.rel < OCT_REL) continue;
      if (!best || c.rel > best.rel) best = c;
    }
    return best ? best.bpm : null;
  }

  /**
   * 窗口 RMS 能量（用于无声/近无声源的快速预检，避免全窗分析空转）。
   * @param {Float32Array|ArrayLike<number>} samples
   * @returns {number}
   */
  function rmsOf(samples) {
    let sum = 0;
    const n = samples.length;
    for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / n);
  }

  /**
   * 一键分析：flux → onsets → BPM → offset。

   * @param {Float32Array} pcm 分析用 mono PCM（任意采样率，内部降采样）
   * @param {object} [opts]
   * @param {number} [opts.sampleRate=22050]
   * @param {number} [opts.analysisSr=22050]
   * @returns {object} { bpm, offset, onsets, flux }
   */
  function analyze(pcm, opts = {}) {
    const sr = opts.sampleRate || DEFAULT_ANALYSIS_SR;
    const analysisSr = opts.analysisSr || DEFAULT_ANALYSIS_SR;
    const sig = sr === analysisSr ? pcm : resample(pcm, sr, analysisSr);
    const flux = spectralFlux(sig, opts);
    // 注意：detectOnsets 必须以降采样后的采样率计算时间，
    // 用户传入的原始 sampleRate 必须被覆盖，否则 onset 时间减半、BPM 翻倍。
    const onsets = detectOnsets(flux, Object.assign({}, opts, { sampleRate: analysisSr }));
    let scan = scanBpm(onsets, opts);
    let bpm = scan.bpm;
    // 触顶自适应上限（1.18.0）：主峰贴住扫描上限，说明真实的拍周期被上限截断了
    // （例如真值 205 在 maxBpm=200 下只能给出 200 附近的解），此时以放宽的上限重扫一次。
    //
    // 边界（务必保持）：
    //   - 重扫上限封顶 300 —— modal.js 的 BPM 校验域是 40–300，超出会产出被弹窗
    //     拒绝的值；上限已到 cap 时不再重扫，避免无意义开销
    //   - 只在触顶时触发：实测 85/1800 首触发，全量对照 ≤0.6 命中 31.2% → 33.8%，
    //     层正确 83.2% → 85.7%，落半频与中位误差**一分不变**（只动触顶那批）；
    //     而无条件放宽（40–320）反而更差（层正确 81.7% → 67.7%）
    //   - 真值 >300 的曲子救不了：主峰常落在次谐波（242 → 121），根本触不到上限，
    //     那需要八度判定而不是扫窗
    const ceilLo = opts.maxBpm || 200;
    const ceilCap = opts.maxBpmCap != null ? opts.maxBpmCap : 300;
    let ceilExtended = false;
    if (bpm != null && bpm >= ceilLo * 0.97 && ceilLo < ceilCap) {
      const up = Math.max(ceilLo + 1, Math.min(ceilLo * 2, ceilCap));
      const wide = scanBpm(onsets, Object.assign({}, opts, { maxBpm: up }));
      if (wide.bpm != null) {
        scan = wide;
        bpm = wide.bpm;
        ceilExtended = true;
      }
    }
    // —— 八度判定（1.19.0）——
    // 扫描上限放宽到 300 才能看到 2× 层：真值 242 的曲子主峰落在 121，
    // 242 根本不在默认 60–200 的窗内（当年 P1 只在原窗内找候选，对目标群体形同虚设）。
    // 守卫与倍数关系都以**宽扫主峰**为准（与评估口径一致，不能换成当前 bpm）。
    // 外层 `bpm < OCTAVE_GUARD_BPM` 只是省开销的门控——全量验证过：用当前值门控
    // 与用宽扫主峰门控的结果完全相同（都是 71.7% / 低档 21%），因为主峰 ≥120 时
    // 宽扫主峰也几乎不可能 <120。
    let octavePromoted = false;
    const bpmBeforeOctave = bpm;
    if (bpm != null && bpm < OCTAVE_GUARD_BPM && !opts.noOctave) {
      const wide = scanBpm(onsets, Object.assign({}, opts, { maxBpm: Math.max(opts.maxBpm || 200, OCTAVE_CAP) }));
      const promoted = pickOctaveLayer(wide.bpm, wide.cands);
      if (promoted != null) {
        bpm = promoted;
        scan = wide; // 候选列表换成宽扫的，UI 里仍能看到"另一半"（用户可一键切回）
        octavePromoted = true;
      }
    }
    // offset = 首条网格线位置 = 第一个 onset（开头第一个可听见的瞬态）。
    // 用户按听感校准（心予報 mp3：0.46s ≈ 首个 onset 0.464s）时首线就是音乐实际
    // 开始处，无需相位换算；首个 onset 若为弱装饰音可在设置窗口手动微调。
    let offset = 0;
    if (bpm && onsets.length) {
      offset = Math.round(onsets[0] * 1000) / 1000;
    }
    // bpmCandidates：竞争层 BPM 候选（v1.11.0，供 UI 展示「其他可能 BPM」）
    // ceilExtended：本次是否走了触顶重扫（供 UI 提示扫描范围被放宽）
    // octavePromoted / bpmBeforeOctave：八度判定是否提升过、提升前的值（供 UI 提示可切回）
    return { bpm, offset, onsets, flux, bpmCandidates: scan.cands, ceilExtended, octavePromoted, bpmBeforeOctave };
  }

  return {
    DEFAULT_ANALYSIS_SR,
    hannWindow,
    fft,
    spectralFlux,
    detectOnsets,
    estimateBpm,
    estimateBpmCands,
    scoreNear,
    estimateOffset,
    buildGrid,
    resolveSegments,
    buildSimpleGrid,
    resample,
    toMono,
    rmsOf,
    pickOctaveLayer,
    analyze,
  };
});
