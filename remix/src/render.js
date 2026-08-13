/**
 * render.js — Canvas 波形渲染（峰值金字塔优化 + 网格/选区/播放线）。
 *
 * 渲染只读 state：view {start, end}（秒）→ 像素。交互层（interact.js）负责改 view。
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

  const BASE_BUCKET = 64;

  /**
   * 构建 min/max 峰值金字塔。
   * level 0 桶大小 = BASE_BUCKET 样本，之后每层桶大小翻倍。
   * 内存 ≈ 4 × 样本数 / BASE_BUCKET。
   * @param {Float32Array} pcm
   * @returns {{mins:Float32Array[], maxs:Float32Array[], baseBucket:number}}
   */
  function buildPeaks(pcm) {
    const n = pcm.length;
    const mins = [];
    const maxs = [];
    const n0 = Math.ceil(n / BASE_BUCKET);
    const min0 = new Float32Array(n0);
    const max0 = new Float32Array(n0);
    for (let b = 0; b < n0; b++) {
      const s = b * BASE_BUCKET;
      const e = Math.min(n, s + BASE_BUCKET);
      let lo = Infinity, hi = -Infinity;
      for (let i = s; i < e; i++) {
        const v = pcm[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min0[b] = lo;
      max0[b] = hi;
    }
    mins.push(min0);
    maxs.push(max0);
    while (mins[mins.length - 1].length > 1) {
      const pMin = mins[mins.length - 1];
      const pMax = maxs[maxs.length - 1];
      const m = Math.ceil(pMin.length / 2);
      const minK = new Float32Array(m);
      const maxK = new Float32Array(m);
      for (let b = 0; b < m; b++) {
        const a = b * 2;
        const c = Math.min(pMin.length, a + 2);
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < c; i++) {
          if (pMin[i] < lo) lo = pMin[i];
          if (pMax[i] > hi) hi = pMax[i];
        }
        minK[b] = lo;
        maxK[b] = hi;
      }
      mins.push(minK);
      maxs.push(maxK);
    }
    return { mins, maxs, baseBucket: BASE_BUCKET };
  }

  /** 时间 → 像素 X。 */
  function timeToX(t, view, width) {
    return ((t - view.start) / (view.end - view.start)) * width;
  }

  /** 像素 X → 时间。 */
  function xToTime(x, view, width) {
    return view.start + (x / width) * (view.end - view.start);
  }

  /**
   * 预计算逐像素 bucket 索引常量，消除波形循环内的除法。
   * bucket 索引 = floor((start + x * step) * k)，与朴素
   * floor((view.start + x/cssW*(end-start)) * sr / bucket) 数学等价（浮点 ±1）。
   */
  function bucketIndexStep(view, sr, bucket, cssW) {
    return {
      k: sr / bucket,                        // 秒 → bucket 索引缩放
      step: (view.end - view.start) / cssW,  // 每像素秒数
      start: view.start,
    };
  }

  /** 第一个 >= target 的索引（二分）。 */
  function lowerBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 第一个 > target 的索引（二分）。 */
  function upperBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 第一个 startTime >= target 的小节索引（二分）。 */
  function lowerBoundBars(bars, target) {
    let lo = 0, hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].startTime < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 第一个 startTime > target 的小节索引（二分）。 */
  function upperBoundBars(bars, target) {
    let lo = 0, hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].startTime <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const THEME = {
    bg: '#0a0c10',
    gridBg: '#0e1117',
    wave: '#22d3ee',
    waveHigh: '#38e1f5',
    waveDim: 'rgba(34,211,238,0.45)',
    barLine: 'rgba(255,255,255,0.75)',
    beatLine: 'rgba(255,255,255,0.14)',
    selFill: 'rgba(34,211,238,0.22)',
    selBorder: '#22d3ee',
    playLine: '#f43f5e',
    axis: '#7d8794',
    barLabel: '#9aa4b2',
  };

  /**
   * 绘制完整波形视图。
   * @param {HTMLCanvasElement} canvas
   * @param {{start:number,end:number}} view 秒
   * @param {object} data
   * @param {Float32Array} [data.pcm]
   * @param {{mins:Float32Array[],maxs:Float32Array[]}} [data.peaks]
   * @param {number} [data.sampleRate]
   * @param {object} [data.grid]
   * @param {{startBar:number,endBar:number}|null} [data.dragRange] 拖拽中的临时选区
   * @param {Array} [data.sequence] 已加入序列的段落（按小节范围高亮）
   * @param {number} [data.playTime] 播放线位置（秒），null 不画
   * @param {number} [data.cursorPos] 播放起点标记（秒），null 不画
   * @param {number} [data.axisHeight=22] 底部时间轴高度
   */
  function draw(canvas, view, data) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const axisH = data.axisHeight != null ? data.axisHeight : 22;
    const waveH = cssH - axisH;
    const amp = waveH * 0.45;
    const midY = waveH / 2;
    const sr = data.sampleRate || 22050;

    // 背景
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = THEME.gridBg;
    ctx.fillRect(0, 0, cssW, waveH);

    // 波形
    if (data.pcm && data.peaks) {
      const spx = ((view.end - view.start) * sr) / cssW; // 每像素样本数
      let level = 0;
      let bucket = data.peaks.baseBucket;
      while (bucket * 2 < spx && level < data.peaks.mins.length - 1) {
        bucket *= 2;
        level++;
      }
      const levelIdx = Math.min(level, data.peaks.mins.length - 1);
      const mArr = data.peaks.mins[levelIdx];
      const xArr = data.peaks.maxs[levelIdx];
      const c = bucketIndexStep(view, sr, bucket, cssW);
      ctx.beginPath();
      for (let x = 0; x < cssW; x += 1) {
        const bIdx = Math.floor((c.start + x * c.step) * c.k);
        if (bIdx < 0 || bIdx >= mArr.length) continue;
        const lo = mArr[bIdx];
        const hi = xArr[bIdx];
        const y0 = midY - hi * amp;
        const y1 = midY - lo * amp;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      // 渐变笔触：峰值线自上而下青→青蓝渐变，增强立体感
      const grad = ctx.createLinearGradient(0, 0, 0, waveH);
      grad.addColorStop(0, THEME.waveHigh);
      grad.addColorStop(0.5, THEME.wave);
      grad.addColorStop(1, 'rgba(34,211,238,0.55)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 网格：节拍线（弱）+ 小节线（强 + 标签），二分定位可见区间避免全量遍历
    if (data.grid && data.grid.bars.length) {
      const grid = data.grid;
      // 节拍线
      const bLo = lowerBound(grid.beatTimes, view.start);
      const bHi = upperBound(grid.beatTimes, view.end);
      ctx.strokeStyle = THEME.beatLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = bLo; i < bHi; i++) {
        const x = timeToX(grid.beatTimes[i], view, cssW);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
      }
      ctx.stroke();
      // 小节线 + 标签（批量 path 单次 stroke；x 边界 ±20px → 秒 margin）
      const margin = (20 / cssW) * (view.end - view.start);
      const sLo = lowerBoundBars(grid.bars, view.start - margin);
      const sHi = upperBoundBars(grid.bars, view.end + margin);
      ctx.strokeStyle = THEME.barLine;
      ctx.fillStyle = THEME.barLabel;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.beginPath();
      for (let i = sLo; i < sHi; i++) {
        const x = timeToX(grid.bars[i].startTime, view, cssW);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
      }
      ctx.stroke();
      for (let i = sLo; i < sHi; i++) {
        const x = timeToX(grid.bars[i].startTime, view, cssW);
        ctx.fillText(String(grid.bars[i].barNumber), x, 11);
      }
    }

    // 已加入序列的段落高亮
    if (data.sequence && data.sequence.length && data.grid) {
      for (const item of data.sequence) {
        const x0 = timeToX(item.startTime, view, cssW);
        const x1 = timeToX(item.endTime, view, cssW);
        ctx.fillStyle = THEME.selFill;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), waveH);
        ctx.strokeStyle = THEME.selBorder;
        ctx.strokeRect(x0, 0, Math.max(1, x1 - x0), waveH);
      }
    }

    // 拖拽中的临时选区
    if (data.dragRange) {
      const x0 = timeToX(Math.min(data.dragRange.t0, data.dragRange.t1), view, cssW);
      const x1 = timeToX(Math.max(data.dragRange.t0, data.dragRange.t1), view, cssW);
      ctx.fillStyle = 'rgba(244,63,94,0.18)';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), waveH);
      ctx.strokeStyle = THEME.playLine;
      ctx.strokeRect(x0, 0, Math.max(1, x1 - x0), waveH);
    }

    // 待添加选区（已选定未入列，金黄高亮）
    if (data.pendingSelection && data.grid) {
      const p = data.pendingSelection;
      const sBar = data.grid.bars.find((b) => b.barNumber === p.startBar);
      const eBar = data.grid.bars.find((b) => b.barNumber === p.endBar);
      if (sBar && eBar) {
        const x0 = timeToX(sBar.startTime, view, cssW);
        const x1 = timeToX(eBar.endTime, view, cssW);
        ctx.fillStyle = 'rgba(250,204,21,0.25)';
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), waveH);
        ctx.strokeStyle = '#facc15';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x0, 0, Math.max(1, x1 - x0), waveH);
        ctx.setLineDash([]);
      }
    }

    // 播放起点标记（静态黄色虚线；与播放线区分）
    if (data.cursorPos != null && data.cursorPos >= view.start && data.cursorPos <= view.end) {
      const x = timeToX(data.cursorPos, view, cssW);
      ctx.strokeStyle = 'rgba(250,204,21,0.9)'; // 黄虚线：播放起点标记，与波形青、播放线玫红区分
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH - axisH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 播放线由 drawPlayHead 绘制在叠加层（避免播放时整幅重绘）

    // 时间轴
    drawAxis(ctx, view, cssW, cssH, axisH);
  }

  /**
   * 动态播放线层：只画播放头竖线，叠加在静态波形层之上。
   * 播放期间由 tickProgress 高频调用，避免整幅波形每帧重绘（视频播放卡顿主因）。
   * @param {HTMLCanvasElement} canvas 透明叠加层
   * @param {object} view
   * @param {number|null} playTime null 时清空
   * @param {number} [axisHeight=22]
   */
  function drawPlayHead(canvas, view, playTime, axisHeight = 22) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (playTime == null || playTime < view.start || playTime > view.end) return;
    const x = timeToX(playTime, view, cssW);
    ctx.strokeStyle = THEME.playLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssH - axisHeight);
    ctx.stroke();
  }

  /**
   * 播放线是否需要在像素位移 >= 1px 时重绘（跳过亚像素抖动，性能 A6）。
   * @param {number|null} prevX 上一次绘制位置（null = 首次）
   * @param {number} newX 当前播放线像素位置
   */
  function playHeadMoved(prevX, newX) {
    return prevX == null || Math.abs(newX - prevX) >= 1;
  }

  function drawAxis(ctx, view, cssW, cssH, axisH) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, cssH - axisH, cssW, axisH);
    ctx.strokeStyle = THEME.axis;
    ctx.fillStyle = THEME.axis;
    ctx.font = '10px system-ui, sans-serif';
    const span = view.end - view.start;
    const target = Math.max(1, cssW / 120); // 约 120px 一个刻度
    let step = 1;
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (const c of candidates) {
      if (span / c <= target) {
        step = c;
        break;
      }
    }
    const start = Math.floor(view.start / step) * step;
    ctx.textAlign = 'center';
    // 刻度线批量 path 单次 stroke（避免每刻度一次绘制调用）
    ctx.beginPath();
    let tickCount = 0;
    for (let t = start; t <= view.end + 1e-6; t += step) {
      if (t < view.start - 1e-6) continue;
      const x = timeToX(t, view, cssW);
      ctx.moveTo(x, cssH - axisH + 4);
      ctx.lineTo(x, cssH - axisH + 8);
      tickCount++;
    }
    ctx.stroke();
    for (let t = start; t <= view.end + 1e-6 && tickCount > 0; t += step) {
      if (t < view.start - 1e-6) continue;
      const x = timeToX(t, view, cssW);
      ctx.fillText(fmtTime(t), x, cssH - 5);
    }
  }
  function fmtTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const ss = (s < 10 ? '0' : '') + s.toFixed(1);
    return m + ':' + ss;
  }

  return { buildPeaks, bucketIndexStep, lowerBound, upperBound, lowerBoundBars, upperBoundBars, timeToX, xToTime, draw, drawPlayHead, playHeadMoved, THEME };
});
