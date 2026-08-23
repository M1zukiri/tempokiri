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
  let dprScale = 1;
  /** 设置波形渲染 DPR 缩放系数（0.1–4；非正数回退 1）。 */
  function setRenderScale(s) { dprScale = (typeof s === 'number' && s > 0) ? s : 1; }

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
    bg: 'transparent',
    gridBg: 'transparent',
    wave: '#22d3ee',
    waveHigh: '#38e1f5',
    waveDim: 'rgba(34,211,238,0.45)',
    barLine: 'rgba(255,255,255,0.75)',
    beatLine: 'rgba(255,255,255,0.14)',
    selFill: 'rgba(34,211,238,0.22)',
    selBorder: '#22d3ee',
    playLine: '#f43f5e',
    cutLine: '#fb923c',
    axis: '#7d8794',
    barLabel: '#9aa4b2',
  };

  const CANVAS_THEMES = {
    aurora: {
      bg: 'transparent',
      gridBg: 'transparent',
      wave: '#22d3ee',
      waveHigh: '#38e1f5',
      waveDim: 'rgba(34,211,238,0.45)',
      barLine: 'rgba(255,255,255,0.75)',
      beatLine: 'rgba(255,255,255,0.14)',
      selFill: 'rgba(34,211,238,0.22)',
      selBorder: '#22d3ee',
      playLine: '#f43f5e',
      cutLine: '#fb923c',
      axis: '#7d8794',
      barLabel: '#9aa4b2',
    },
    nebula: {
      bg: 'transparent',
      gridBg: 'transparent',
      wave: '#a78bfa',
      waveHigh: '#c4b5fd',
      waveDim: 'rgba(167,139,250,0.45)',
      barLine: 'rgba(255,255,255,0.75)',
      beatLine: 'rgba(255,255,255,0.14)',
      selFill: 'rgba(167,139,250,0.22)',
      selBorder: '#a78bfa',
      playLine: '#f43f5e',
      cutLine: '#f0abfc',
      axis: '#8f87a0',
      barLabel: '#a89fb5',
    },
    paper: {
      bg: 'transparent',
      gridBg: 'transparent',
      wave: '#0f766e',
      waveHigh: '#14a89b',
      waveDim: 'rgba(15,118,110,0.40)',
      barLine: 'rgba(42,37,34,0.75)',
      beatLine: 'rgba(42,37,34,0.12)',
      selFill: 'rgba(15,118,110,0.18)',
      selBorder: '#0f766e',
      playLine: '#d63a5a',
      cutLine: '#c2410c',
      axis: '#7a7268',
      barLabel: '#5c554d',
    },
  };

  // ---------- 波形平移增量渲染（P0）----------
  let waveCache = null;      // 离屏缓存 canvas（与 #wave 同物理尺寸）
  let waveCacheCtx = null;
  let lastView = null;       // 上次绘制的 view { start, end }
  let lastSpan = 0;
  let lastSig = null;        // buildSig(data) 结果（引用数组）
  let themeStamp = 0;        // setTheme 时 +1（主题变化 → 强制全量）
  let cachedGrad = null;     // 波形渐变对象（按 waveH 缓存，THEME 变化失效）
  let cachedGradWaveH = -1;

  /** 波形数据版本签名：引用比较关键字段（避免 JSON.stringify 大数组开销）。 */
  function buildSig(data) {
    return [data.peaks, data.grid, data.sequence, data.dragRange,
            data.pendingSelection, data.cursorPos, data.cutPoints, themeStamp];
  }
  function sigEq(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  /** 确保离屏缓存 canvas 尺寸匹配；创建失败（Node 无 OffscreenCanvas/document）降级全量。 */
  function ensureCache(w, h) {
    if (waveCache && waveCache.width === w && waveCache.height === h) return;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        waveCache = new OffscreenCanvas(w, h);
      } else if (typeof document !== 'undefined') {
        waveCache = document.createElement('canvas');
        waveCache.width = w;
        waveCache.height = h;
      } else {
        waveCache = null;
        return;
      }
      waveCacheCtx = waveCache.getContext('2d');
    } catch (e) {
      waveCache = null;
    }
  }

  function setTheme(name) {
    Object.assign(THEME, CANVAS_THEMES[name] || CANVAS_THEMES.aurora);
    themeStamp++;      // 主题变化 → 波形签名变化 → 强制全量重绘
    cachedGrad = null; // 渐变颜色随 THEME 变化，缓存失效
  }

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
    const dpr = (window.devicePixelRatio || 1) * dprScale;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w) { canvas.width = w; waveCache = null; lastView = null; }
    if (canvas.height !== h) { canvas.height = h; waveCache = null; lastView = null; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const span = view.end - view.start;
    const sig = buildSig(data);
    const canIncr = lastView && sigEq(sig, lastSig) && waveCache
      && Math.abs(span - lastSpan) / lastSpan < 0.005;
    const dxPx = canIncr ? Math.round((view.start - lastView.start) * cssW / lastSpan) : 0;

    if (canIncr && dxPx !== 0 && Math.abs(dxPx) < cssW) {
      // 纯平移：旧帧 → 离屏缓存 → 物理像素 blit → 只重绘露出条带
      ensureCache(w, h);
      waveCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
      waveCacheCtx.clearRect(0, 0, w, h);
      waveCacheCtx.drawImage(canvas, 0, 0);
      const dxPhys = Math.round(dxPx * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(waveCache, -dxPhys, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x0 = dxPx > 0 ? cssW - dxPx : 0;
      const x1 = dxPx > 0 ? cssW : -dxPx;
      ctx.clearRect(x0, 0, x1 - x0, cssH);
      drawRange(canvas, view, data, x0, x1);
    } else {
      // 全量：clearRect 清除旧内容（transparent 背景需显式清除）+ 全幅绘制
      ctx.clearRect(0, 0, cssW, cssH);
      drawRange(canvas, view, data, 0, cssW);
    }

    // 更新离屏缓存与 last* 状态（全量与增量路径共用；Node 无 OffscreenCanvas 时跳过缓存拷贝）
    ensureCache(w, h);
    if (waveCache && waveCacheCtx) {
      waveCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
      waveCacheCtx.clearRect(0, 0, w, h);
      waveCacheCtx.drawImage(canvas, 0, 0);
    }
    lastView = { start: view.start, end: view.end };
    lastSpan = span;
    lastSig = sig;
  }

  /**
   * 按 x 区间 [x0, x1) 绘制波形视图（P0 增量渲染的条带重绘；全量 = drawRange(0, cssW)）。
   * @param {HTMLCanvasElement} canvas
   * @param {{start:number,end:number}} view 秒
   * @param {object} data 同 draw
   * @param {number} x0 起始像素（CSS 坐标，含）
   * @param {number} x1 结束像素（CSS 坐标，不含）
   */
  function drawRange(canvas, view, data, x0, x1) {
    const dpr = (window.devicePixelRatio || 1) * dprScale;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const axisH = data.axisHeight != null ? data.axisHeight : 22;
    const waveH = cssH - axisH;
    const amp = waveH * 0.45;
    const midY = waveH / 2;
    const sr = data.sampleRate || 22050;
    const t0 = xToTime(x0, view, cssW);
    const t1 = xToTime(x1, view, cssW);

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
      let acc = c.start + x0 * c.step; // 累加器起步于 x0，每像素省一次乘法
      for (let x = x0; x < x1; x += 1) {
        const bIdx = Math.floor(acc * c.k);
        acc += c.step;
        if (bIdx < 0 || bIdx >= mArr.length) continue;
        const lo = mArr[bIdx];
        const hi = xArr[bIdx];
        const y0 = midY - hi * amp;
        const y1 = midY - lo * amp;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      // 渐变笔触缓存（按 waveH；THEME 变化由 setTheme 置 cachedGrad = null 失效）
      if (!cachedGrad || cachedGradWaveH !== waveH) {
        cachedGrad = ctx.createLinearGradient(0, 0, 0, waveH);
        cachedGrad.addColorStop(0, THEME.waveHigh);
        cachedGrad.addColorStop(0.5, THEME.wave);
        cachedGrad.addColorStop(1, 'rgba(34,211,238,0.55)');
        cachedGradWaveH = waveH;
      }
      ctx.strokeStyle = cachedGrad;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 网格：节拍线（弱）+ 小节线（强 + 标签），按条带时间区间 [t0, t1] 二分过滤
    if (data.grid && data.grid.bars.length) {
      const grid = data.grid;
      const bLo = lowerBound(grid.beatTimes, t0);
      const bHi = upperBound(grid.beatTimes, t1);
      ctx.strokeStyle = THEME.beatLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = bLo; i < bHi; i++) {
        const x = timeToX(grid.beatTimes[i], view, cssW);
        if (x < x0 || x >= x1) continue; // 严格半开裁剪到条带
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
      }
      ctx.stroke();
      const margin = (20 / cssW) * (view.end - view.start);
      const sLo = lowerBoundBars(grid.bars, t0 - margin);
      const sHi = upperBoundBars(grid.bars, t1 + margin);
      ctx.strokeStyle = THEME.barLine;
      ctx.fillStyle = THEME.barLabel;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.beginPath();
      for (let i = sLo; i < sHi; i++) {
        const x = timeToX(grid.bars[i].startTime, view, cssW);
        if (x < x0 || x >= x1) continue; // 严格半开裁剪到条带（增量时不画到未清除区）
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
      }
      ctx.stroke();
      for (let i = sLo; i < sHi; i++) {
        const x = timeToX(grid.bars[i].startTime, view, cssW);
        if (x < x0 || x >= x1) continue;
        ctx.fillText(String(grid.bars[i].barNumber), x, 11);
      }
    }

    // 已加入序列的段落高亮（x 交集裁剪）
    if (data.sequence && data.sequence.length && data.grid) {
      for (const item of data.sequence) {
        const ix0 = Math.max(x0, timeToX(item.startTime, view, cssW));
        const ix1 = Math.min(x1, timeToX(item.endTime, view, cssW));
        if (ix1 <= ix0) continue;
        ctx.fillStyle = THEME.selFill;
        ctx.fillRect(ix0, 0, ix1 - ix0, waveH);
        ctx.strokeStyle = THEME.selBorder;
        ctx.strokeRect(ix0, 0, ix1 - ix0, waveH);
      }
    }

    // 拖拽中的临时选区（x 交集裁剪）
    if (data.dragRange) {
      const ix0 = Math.max(x0, timeToX(Math.min(data.dragRange.t0, data.dragRange.t1), view, cssW));
      const ix1 = Math.min(x1, timeToX(Math.max(data.dragRange.t0, data.dragRange.t1), view, cssW));
      if (ix1 > ix0) {
        ctx.fillStyle = 'rgba(244,63,94,0.18)';
        ctx.fillRect(ix0, 0, ix1 - ix0, waveH);
        ctx.strokeStyle = THEME.playLine;
        ctx.strokeRect(ix0, 0, ix1 - ix0, waveH);
      }
    }

    // 待添加选区（已选定未入列，金黄高亮，x 交集裁剪）
    if (data.pendingSelection && data.grid) {
      const p = data.pendingSelection;
      const sBar = data.grid.bars.find((b) => b.barNumber === p.startBar);
      const eBar = data.grid.bars.find((b) => b.barNumber === p.endBar);
      if (sBar && eBar) {
        const ix0 = Math.max(x0, timeToX(sBar.startTime, view, cssW));
        const ix1 = Math.min(x1, timeToX(eBar.endTime, view, cssW));
        if (ix1 > ix0) {
          ctx.fillStyle = 'rgba(250,204,21,0.25)';
          ctx.fillRect(ix0, 0, ix1 - ix0, waveH);
          ctx.strokeStyle = '#facc15';
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(ix0, 0, ix1 - ix0, waveH);
          ctx.setLineDash([]);
        }
      }
    }

    // 自动剪辑剪切点标记（橙色实线 + 顶部菱形，x 交集裁剪）
    if (data.cutPoints && data.cutPoints.length) {
      ctx.strokeStyle = THEME.cutLine;
      ctx.fillStyle = THEME.cutLine;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const t of data.cutPoints) {
        const x = timeToX(t, view, cssW);
        if (x < x0 || x > x1) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
      }
      ctx.stroke();
      for (const t of data.cutPoints) {
        const x = timeToX(t, view, cssW);
        if (x < x0 || x > x1) continue;
        // 顶部小菱形
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x - 4, 9);
        ctx.lineTo(x + 4, 9);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 播放起点标记（静态黄色虚线；与播放线区分，x 交集裁剪）
    if (data.cursorPos != null) {
      const x = timeToX(data.cursorPos, view, cssW);
      if (x >= x0 && x <= x1) {
        ctx.strokeStyle = 'rgba(250,204,21,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH - axisH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 时间轴
    drawAxis(ctx, view, cssW, cssH, axisH, x0, x1);
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
    const dpr = (window.devicePixelRatio || 1) * dprScale;
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
   */
  function playHeadMoved(prevX, newX) {
    return prevX == null || Math.abs(newX - prevX) >= 1;
  }

  function drawAxis(ctx, view, cssW, cssH, axisH, x0, x1) {
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
      if (x < x0 || x > x1) continue; // 条带裁剪
      ctx.moveTo(x, cssH - axisH + 4);
      ctx.lineTo(x, cssH - axisH + 8);
      tickCount++;
    }
    ctx.stroke();
    for (let t = start; t <= view.end + 1e-6 && tickCount > 0; t += step) {
      if (t < view.start - 1e-6) continue;
      const x = timeToX(t, view, cssW);
      if (x < x0 || x > x1) continue;
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

  return { buildPeaks, bucketIndexStep, lowerBound, upperBound, lowerBoundBars, upperBoundBars, timeToX, xToTime, draw, drawRange, drawPlayHead, playHeadMoved, setRenderScale, setTheme, CANVAS_THEMES, THEME };
});
