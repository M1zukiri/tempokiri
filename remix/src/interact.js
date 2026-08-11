/**
 * interact.js — 波形交互：拖拽选区、Shift 平移、滚轮缩放、双击选小节。
 * 只做坐标换算与手势识别，具体行为通过 handlers 回调交给 main.js。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./render.js'));
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory(global.MC));
  }
})(typeof self !== 'undefined' ? self : this, function (render) {
  'use strict';

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} handlers
   * @param {() => {start:number,end:number}} handlers.getView
   * @param {(view:{start:number,end:number}) => void} handlers.setView
   * @param {(t0:number, t1:number) => void} handlers.onSelectRange 拖拽结束/双击（秒）
   * @param {(t0:number, t1:number) => void} handlers.onPreviewRange 拖拽中预览（秒）
   * @param {() => void} handlers.onClearPreview
   */
  function bindWaveform(canvas, handlers) {
    let down = null;

    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        w: rect.width,
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const { x, w } = pos(e);
      const t = render.xToTime(x, handlers.getView(), w);
      down = { x, t, mode: e.shiftKey ? 'pan' : 'select', moved: false };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!down) return;
      const { x, w } = pos(e);
      if (Math.abs(x - down.x) > 3) down.moved = true;
      if (down.mode === 'pan') {
        const view = handlers.getView();
        const span = view.end - view.start;
        const dt = ((down.x - x) / w) * span;
        handlers.setView({ start: view.start + dt, end: view.end + dt });
        down.x = x;
      } else if (down.mode === 'select') {
        const t = render.xToTime(x, handlers.getView(), w);
        handlers.onPreviewRange(down.t, t);
      }
    });

    const up = (e) => {
      if (!down) return;
      const { x, w } = pos(e);
      const t = render.xToTime(x, handlers.getView(), w);
      const d = down;
      down = null;
      if (d.mode === 'select' && d.moved) {
        handlers.onSelectRange(d.t, t);
      } else if (d.mode === 'select' && handlers.onClick) {
        // 无拖拽的单击 → 设置播放起点
        handlers.onClick(t);
      }
      handlers.onClearPreview();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const { x, w } = pos(e);
      const t = render.xToTime(x, handlers.getView(), w);
      if (handlers.onDblClick) handlers.onDblClick(t);
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const view = handlers.getView();
        const span = view.end - view.start;
        // delta 归一化（line → pixel）
        const delta = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
        if (e.ctrlKey) {
          // Ctrl + 滚轮：以指针位置为中心缩放
          const { x, w } = pos(e);
          const t = render.xToTime(x, view, w);
          const factor = delta > 0 ? 1.35 : 1 / 1.35;
          const newSpan = Math.max(0.5, span * factor);
          const start = t - ((t - view.start) / span) * newSpan;
          handlers.setView({ start, end: start + newSpan });
        } else {
          // 纯滚轮：水平平移（向下滚 = 时间前进）
          const dt = delta * span * 0.0025;
          handlers.setView({ start: view.start + dt, end: view.end + dt });
        }
      },
      { passive: false }
    );

  }

  return { bindWaveform };
});
