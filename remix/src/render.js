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

  const THEME = {
    bg: '#0e1014',
    gridBg: '#12151b',
    wave: '#22d3ee',
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
      ctx.beginPath();
      for (let x = 0; x < cssW; x += 1) {
        const t = view.start + (x / cssW) * (view.end - view.start);
        const sIdx = t * sr;
        const bIdx = Math.floor(sIdx / bucket);
        if (bIdx < 0 || bIdx >= mArr.length) continue;
        const lo = mArr[bIdx];
        const hi = xArr[bIdx];
        const y0 = midY - hi * amp;
        const y1 = midY - lo * amp;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.strokeStyle = THEME.wave;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 网格：节拍线（弱）+ 小节线（强 + 标签）
    if (data.grid && data.grid.bars.length) {
      const grid = data.grid;
      // 节拍线
      ctx.strokeStyle = THEME.beatLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const bt of grid.beatTimes) {
        if (bt < view.start || bt > view.end) continue;
        const x = timeToX(bt, view, cssW);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
      }
      ctx.stroke();
      // 小节线 + 标签
      ctx.strokeStyle = THEME.barLine;
      ctx.fillStyle = THEME.barLabel;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const bar of grid.bars) {
        const x = timeToX(bar.startTime, view, cssW);
        if (x < -20 || x > cssW + 20) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, waveH);
        ctx.stroke();
        ctx.fillText(String(bar.barNumber), x, 11);
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
    for (let t = start; t <= view.end + 1e-6; t += step) {
      if (t < view.start - 1e-6) continue;
      const x = timeToX(t, view, cssW);
      ctx.beginPath();
      ctx.moveTo(x, cssH - axisH + 4);
      ctx.lineTo(x, cssH - axisH + 8);
      ctx.stroke();
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

  return { buildPeaks, timeToX, xToTime, draw, drawPlayHead, THEME };
});
