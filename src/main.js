/**
 * main.js — Remix 工作站装配层：全局状态、文件处理、播放、导出。
 *
 * 浏览器入口。依赖 MC.analysis / MC.audio / MC.render / MC.interact /
 * MC.sequence / MC.store / MC.export / MC.modal / MC.ui。
 */
(function () {
  'use strict';

  const CROSSFADE_MS = 10;

  const state = {
    file: null,
    kind: 'audio', // audio | video
    pcm: null, // 分析用 mono（22050）
    rawMono: null, // 原始采样率 mono（导出用）
    audioBuffer: null, // 试听用
    sampleRate: 22050,
    duration: 0,
    peaks: null,
    segments: [{ bpm: null, beatsPerBar: 4, beatUnit: 4 }], // 段定义（用户输入）
    offset: 0,
    cursorPos: null, // 播放标记点（单击定位）
    playPos: null, // 当前播放位置（暂停断点；停止/单击时重置）
    pendingSelection: null, // {startBar, endBar} 待添加选区
    grid: null,
    sequence: [],
    view: null,
    dragRange: null,
    playTime: null,
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const waveCanvas = $('wave');
  const playHeadCanvas = $('playHead');
  const waveWrap = $('waveWrap');
  const waveHint = $('waveHint');
  const videoEl = $('video');
  const videoWrap = $('videoWrap');
  const statusBar = $('statusBar');
  const seqList = $('seqList');
  const seqInfo = $('seqInfo');
  const btnOpenFile = $('btnOpenFile');
  const btnSettings = $('btnSettings');
  const btnPlay = $('btnPlay');
  const btnPlaySeq = $('btnPlaySeq');
  const btnStop = $('btnStop');
  const quickBar = $('quickBar');
  const qBpmLabel = $('qBpmLabel');
  const qBpmVal = $('qBpmVal');
  const qOffsetVal = $('qOffsetVal');
  const controlBar = $('controlBar');
  const btnAddSelection = $('btnAddSelection');
  const btnExport = $('btnExport');
  const fileInput = $('fileInput');
  const btnManualAdd = $('btnManualAdd');
  const manualForm = $('manualForm');
  const maStart = $('maStart');
  const maEnd = $('maEnd');
  const btnManualOk = $('btnManualOk');
  const btnManualCancel = $('btnManualCancel');
  const seqProgress = $('seqProgress');
  const seqProgressTrack = $('seqProgressTrack');
  const seqProgressFill = $('seqProgressFill');
  const seqProgressSeams = $('seqProgressSeams');
  const seqProgressKnob = $('seqProgressKnob');
  const seqProgressTime = $('seqProgressTime');

  // UMD 模块将导出铺平到 MC 命名空间（MC.analyze、MC.encodeWav 等）
  const mod = MC;
  const analysis = MC;
  const audio = MC;
  const render = MC;
  const interact = MC;
  const seq = MC;
  const store = MC;
  const exp = MC;
  const ui = MC;

  // ---------- 状态辅助 ----------
  function showHint(msg) {
    waveHint.textContent = msg;
    waveHint.hidden = false;
  }
  function hideHint() {
    waveHint.hidden = true;
  }
  function status(msg) {
    statusBar.textContent = msg;
  }
  let waveDirty = false;
  let waveRafPending = false;
  function renderWave() {
    // 帧合并：连续多次调用（高频滚轮/拖拽）只排队一次 rAF，实际绘制合并到下一帧
    waveDirty = true;
    if (waveRafPending) return;
    waveRafPending = true;
    requestAnimationFrame(() => {
      waveRafPending = false;
      if (!waveDirty) return;
      waveDirty = false;
      if (!state.pcm) return;
      render.draw(waveCanvas, state.view, {
        pcm: state.pcm,
        peaks: state.peaks,
        sampleRate: analysis.DEFAULT_ANALYSIS_SR,
        grid: state.grid,
        dragRange: state.dragRange,
        pendingSelection: state.pendingSelection,
        sequence: state.sequence,
        playTime: state.playTime,
        cursorPos: state.cursorPos,
      });
      // 播放线绘制在叠加层；全量重绘后同步当前播放线（非播放时 state.playTime 为 null → 清空）
      render.drawPlayHead(playHeadCanvas, state.view, state.playTime);
      // 同步 lastPlayHeadX，避免 view 变化后阈值判断用旧像素位置
      lastPlayHeadX = state.playTime != null ? render.timeToX(state.playTime, state.view, playHeadCanvas.clientWidth || playHeadCanvas.width) : null;
    });
  }

  // ---------- 拼接序列进度条 ----------
  /**
   * 渲染进度条：拼接点标记 + 总时长文本（序列变化时调用）。
   */
  function renderSeqProgress() {
    const has = state.sequence.length > 0;
    seqProgress.hidden = !has;
    if (!has) return;
    const { total, seams } = seq.progressMeta(state.sequence);
    seqProgressSeams.innerHTML = '';
    for (const s of seams) {
      const d = document.createElement('div');
      d.className = 'seam';
      d.style.left = (total > 0 ? (s / total) * 100 : 0) + '%';
      d.title = '拼接点 ' + ui.fmtTime(s);
      seqProgressSeams.appendChild(d);
    }
    seqProgressTime.textContent = ui.fmtTime(0) + ' / ' + ui.fmtTime(total);
    seqProgressFill.style.width = '0%';
    seqProgressKnob.style.left = '0%';
  }

  /** 播放中更新进度条（mix 时间轴，秒）。 */
  function updateSeqProgress(mt) {
    if (seqProgress.hidden) return;
    const total = seq.totalDuration(state.sequence);
    const ratio = total > 0 ? Math.max(0, Math.min(1, mt / total)) : 0;
    seqProgressFill.style.width = (ratio * 100) + '%';
    seqProgressKnob.style.left = (ratio * 100) + '%';
    seqProgressTime.textContent = ui.fmtTime(mt) + ' / ' + ui.fmtTime(total);
  }

  /** 拖动进度条 → 定位拼接时间轴（暂停后从该处继续播放）。 */
  function seekMix(mt) {
    if (!state.sequence.length || anyInvalid()) return;
    const total = seq.totalDuration(state.sequence);
    mt = Math.max(0, Math.min(mt, total));
    pausePlay(); // 记录断点并停止（mixPlaying → false）
    mixPos = mt;
    playSequence();
  }
  function renderAll() {
    ui.renderSequenceList(seqList, state.sequence, {
      onRemove: removeItem,
      onMove: moveItem,
      onFade: setFade,
      onRange: setRange,
      getGrid: () => state.grid,
    }, playingSeqId);
    ui.updateSeqInfo(seqInfo, state.sequence, seq);
    renderSeqProgress();
    btnPlaySeq.disabled = !state.sequence.length || anyInvalid();
    updateQuickBar();
    renderWave();
  }

  /** 应用全局高级设置到运行时缓存（初始化 + 设置变更事件时调用）。 */
  function refreshAdvancedSettings() {
    const gs = store.loadGlobalSettings();
    followMs = gs.followMs;
    render.setRenderScale(gs.renderScale);
    if (state.file) renderWave();
  }

  /** 序列中是否有非法项（用户输入非法或时间超出网格）。 */
  function anyInvalid() {
    const g = state.grid;
    return state.sequence.some((it) => {
      if (it.invalid) return true;
      if (!g) return false;
      return seq.timeToBarCell(g, it.startTime) === null || seq.timeToBarCell(g, it.endTime) === null;
    });
  }

  /** 序列项起终点手动编辑。sec=null 表示本端输入非法：保留输入、仅标红禁播，不重建清空。 */
  function setRange(id, sec, which) {
    const it = state.sequence.find((x) => x.id === id);
    if (!it) return;
    if (sec == null) {
      it.invalid = true;
      it.invalidSide = which;
      markInvalidCard(it, id);
      btnPlaySeq.disabled = true;
      saveWorkspace();
      return;
    }
    if (which === 'start') it.startTime = sec;
    else it.endTime = sec;
    const inverted = !(it.startTime < it.endTime);
    // 倒置（任一端修正可恢复）或另一端仍非法时保持 invalid
    it.invalid = inverted || (it.invalid && it.invalidSide !== which);
    it.invalidSide = it.invalid ? (inverted ? null : it.invalidSide) : null;
    if (it.invalid) {
      markInvalidCard(it, id);
      btnPlaySeq.disabled = true;
      saveWorkspace();
      return;
    }
    saveWorkspace();
    renderAll();
  }

  /** 给非法卡片加标红 class（不重建 DOM，保留输入内容）。 */
  function markInvalidCard(it, id) {
    const card = seqList.querySelector('.seq-card[data-id="' + id + '"]');
    if (card) card.classList.add('invalid');
  }
  // ---------- 文件处理 ----------
  async function handleFile(file) {
    // 工作区已有内容且打开的是不同文件 → 询问是否保留
    if (state.file && state.file !== file && (state.sequence.length || state.grid)) {
      const keep = await confirmWorkspace();
      if (keep === null) return; // 取消：不切换
      if (!keep) store.clearSettings(state.file); // 不保留：清除该文件缓存（下次打开为空白）
    }
    stopPlay();
    state.file = file;
    state.kind = audio.classifyFile(file);
    state.pcm = state.rawMono = state.audioBuffer = null;
    state.grid = null;
    state.segments = [{ bpm: null, beatsPerBar: 4, beatUnit: 4 }];
    state.offset = 0;
    state.cursorPos = null;
    state.playPos = null;
    state.pendingSelection = null;
    state.sequence = [];
    state.peaks = null;
    state.playTime = null;
    btnSettings.disabled = false;
    btnPlay.disabled = false;
    btnPlaySeq.disabled = false;
    btnStop.disabled = false;
    controlBar.hidden = false;
    btnExport.disabled = false;
    btnAddSelection.disabled = true;

    if (state.kind === 'video') {
      videoEl.src = URL.createObjectURL(file);
      videoWrap.hidden = false;
      await videoEl.load();
      // 等待元数据以便知道时长
      if (!videoEl.duration && !videoEl.readyState) {
        await new Promise((res) => {
          videoEl.addEventListener('loadedmetadata', res, { once: true });
          setTimeout(res, 8000);
        });
      }
      state.duration = videoEl.duration || 0;
      state.view = { start: 0, end: Math.max(state.duration, 1) };
      // 导入时即提取音轨：默认优先 WebCodecs 直接解码（快），失败降级 captureStream；
      // 「高级设置」可强制仅采集或仅 WebCodecs（后者失败只报错、不降级）
      const gs = store.loadGlobalSettings();
      if (gs.videoExtract === 'capture') {
        showHint('正在静音快速播放采集音轨…');
        try {
          await captureVideoPcm();
          hideHint();
        } catch (e2) {
          showHint('音轨提取失败：' + e2.message + '。可点击「设置节拍」手动输入 BPM。');
        }
      } else {
        showHint('正在提取视频音轨…');
        try {
          const r = await audio.decodeVideoAudioTrack(file, (p) => {
            captureBar.hidden = false;
            captureFill.style.width = Math.round(p * 100) + '%';
          });
          captureBar.hidden = true;
          state.pcm = r.pcm;
          state.rawMono = r.rawMono;
          state.sampleRate = r.sampleRate;
          state.duration = r.duration;
          state.peaks = render.buildPeaks(r.pcm);
          state.view = { start: 0, end: state.duration };
          hideHint();
          renderWave();
        } catch (e) {
          if (gs.videoExtract === 'webcodecs') {
            captureBar.hidden = true;
            showHint('音轨提取失败：' + e.message);
          } else {
            captureBar.hidden = true;
            showHint('正在静音快速播放采集音轨（WebCodecs 不可用）…');
            try {
              await captureVideoPcm();
              hideHint();
            } catch (e2) {
              showHint('音轨提取失败：' + e2.message + '。可点击「设置节拍」手动输入 BPM。');
            }
          }
        }
      }
      const cached = applyCachedSettings();
      renderWave();
      status(cached ? '已应用上次节拍设置：' + file.name : '视频就绪：' + file.name);
    } else {
      videoWrap.hidden = true;
      videoEl.removeAttribute('src');
      showHint('正在解码音频…');
      try {
        const r = await audio.decodeAudioFile(file);
        state.pcm = r.pcm;
        state.rawMono = r.rawMono;
        state.audioBuffer = r.audioBuffer;
        state.sampleRate = r.sampleRate;
        state.duration = r.duration;
        state.peaks = render.buildPeaks(r.pcm);
        state.view = { start: 0, end: r.duration };
        hideHint();
        const cached = applyCachedSettings();
        renderWave();
        status(cached ? '已应用上次节拍设置：' + file.name : '就绪：' + file.name);
      } catch (e) {
        showHint('解码失败：' + e.message);
        status('解码失败');
      }
    }
    renderAll();
  }

  /** 返回是否命中缓存并应用。 */
  function applyCachedSettings() {
    if (!state.file) return false;
    const cached = store.loadSettings(state.file);
    if (cached && cached.segments && cached.segments[0]) {
      const seq = cached.sequence;
      // applySettings 内的 saveWorkspace 会用当前（空）序列覆盖缓存，先记下再存回
      applySettings(cached.segments, cached.offset || 0);
      restoreSequence(seq);
      saveWorkspace();
      // 恢复上次视图（缩放/平移），越界则回退到全览
      if (cached.view && isFinite(cached.view.start) && isFinite(cached.view.end)) {
        const d = state.duration || 1;
        const span = Math.max(0.5, cached.view.end - cached.view.start);
        const minS = Math.min(0, d - span);
        const maxS = Math.max(0, d - span);
        const start = Math.max(minS, Math.min(maxS, cached.view.start));
        state.view = { start, end: start + span };
      }
      renderAll();
      return true;
    }
    showHint('点击「设置节拍」配置 BPM 与网格，之后即可在波形上选段。');
    return false;
  }

  // ---------- 节拍设置 ----------
  function applySettings(segments, offset) {
    state.segments = segments;
    state.offset = offset;
    applyGridSettings();
    saveWorkspace();
    updateQuickBar();
  }

  /** 保存当前文件的工作区（节拍设置 + 拼接序列/淡化），切文件时据此恢复。 */
  function saveWorkspace() {
    if (!state.file) return;
    store.saveSettings(state.file, {
      segments: state.segments,
      offset: state.offset,
      sequence: state.sequence.map((it) => ({
        startBar: it.startBar,
        endBar: it.endBar,
        startTime: it.startTime,
        endTime: it.endTime,
        fadeInMs: it.fadeInMs,
        fadeOutMs: it.fadeOutMs,
        invalid: !!it.invalid,
      })),
      view: state.view ? { start: state.view.start, end: state.view.end } : undefined,
    });
  }
  /** 从缓存恢复拼接序列（时间为主；旧缓存无时间时按小节推算）。 */
  function restoreSequence(list) {
    state.sequence = [];
    if (!Array.isArray(list)) return;
    for (const rec of list) {
      let it = null;
      if (rec.startTime != null && rec.endTime != null) {
        it = {
          id: seq.newId(),
          startBar: rec.startBar != null ? rec.startBar : null,
          endBar: rec.endBar != null ? rec.endBar : null,
          startTime: rec.startTime,
          endTime: rec.endTime,
          fadeInMs: rec.fadeInMs || 0,
          fadeOutMs: rec.fadeOutMs || 0,
          invalid: !!rec.invalid,
        };
      } else if (state.grid && rec.startBar != null && rec.endBar != null) {
        // 旧缓存：无时间字段，按小节重建
        it = seq.createItem(state.grid, rec.startBar, rec.endBar);
        if (it) {
          it.fadeInMs = rec.fadeInMs || 0;
          it.fadeOutMs = rec.fadeOutMs || 0;
        }
      }
      if (it) state.sequence.push(it);
    }
  }

  /** 切换文件前询问是否保留当前工作区。返回 true=保留 / false=不保留 / null=取消。 */
  function confirmWorkspace() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>打开新文件</h3>
          <p class="modal-sub">当前文件的工作区有内容（节拍设置、拼接序列、淡化）。</p>
          <p class="modal-sub">选择「保留」：新文件打开后，以后重新打开当前文件会恢复这份工作区；</p>
          <p class="modal-sub">选择「不保留」：清除当前文件的缓存记录，下次打开为空白。</p>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button class="btn" data-act="cancel">取消</button>
            <button class="btn" data-act="discard">不保留，清空</button>
            <button class="btn btn-primary" data-act="keep">保留并切换</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => {
        overlay.remove();
        resolve(v);
      };
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
      overlay.querySelector('[data-act="discard"]').addEventListener('click', () => done(false));
      overlay.querySelector('[data-act="keep"]').addEventListener('click', () => done(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) done(null);
      });
    });
  }

  /** 按当前 state.segments/offset 重建网格并重绘。 */
  function applyGridSettings() {
    try {
      const resolved = analysis.resolveSegments(state.segments, state.duration);
      state.grid = analysis.buildGrid({ segments: resolved, offset: state.offset, duration: state.duration });
      hideHint();
      renderAll();
    } catch (e) {
      status('节拍设置失败：' + e.message);
    }
  }

  /** 播放起点所在段（无网格/未定位返回 null；播放起点默认 0 → 第 1 段）。 */
  function currentSegment() {
    if (!state.grid) return null;
    const t = state.cursorPos != null ? state.cursorPos : 0;
    return state.grid.segments.find((seg) => t >= seg.startTime && t < seg.endTime) || state.grid.segments[0] || null;
  }

  /** 顶部快捷栏：有文件且已设置网格时显示，否则隐藏。 */
  function updateQuickBar() {
    if (!state.file || !state.grid) {
      quickBar.hidden = true;
      return;
    }
    quickBar.hidden = false;
    const seg = currentSegment();
    qBpmLabel.textContent = seg ? 'BPM（第 ' + (seg.index + 1) + ' 段）' : 'BPM';
    qBpmVal.textContent = seg && seg.bpm != null ? seg.bpm.toFixed(1) : '--';
    qOffsetVal.textContent = (state.offset != null ? state.offset : 0).toFixed(3);
  }

  function openSettings() {
    if (!state.file) return;
    mod.open(
      { segments: state.segments, offset: state.offset },
      {
        onAutoDetect: autoDetect,
        onConfirm: (v) => applySettings(v.segments, v.offset),
      }
    );
  }

  /**
   * 分段自动识别（只返回数值，不应用）。
   * 规则：第 N 段需前 N-1 段长度确定；未指定该段长度 → 识别 [段起点, 末尾]；
   * 指定长度 → 仅识别 [段起点, 段起点+长度]。
   * @param {number} segIndex
   * @param {object} seg 该行当前输入（可能未填全）
   */
  async function autoDetect(segIndex, seg, allSegs) {
    if (state.kind === 'video' && !state.pcm) {
      status('正在快速播放视频以采集音轨…');
      await captureVideoPcm();
    }
    if (!state.pcm) throw new Error('没有可分析的音频数据');

    // 前段长度累计（用窗口内当前行输入，而非已应用设置）
    let windowStart = 0;
    for (let i = 0; i < segIndex; i++) {
      const s = allSegs[i] || {};
      const bpm = parseFloat(s.bpm);
      if (!isFinite(bpm) || bpm <= 0) {
        return { error: '第 ' + (i + 1) + ' 段需先填写 BPM' };
      }
      const barDur = (60 / bpm) * (s.beatsPerBar || 4);
      if (s.bars && s.bars > 0) windowStart += s.bars * barDur;
      else if (s.durationSec != null && s.durationSec >= 0) windowStart += s.durationSec;
      else return { error: '第 ' + (i + 1) + ' 段需先指定长度（自动识别依赖段起点）' };
    }

    // 识别窗口：该段指定时长则仅识别窗口内，否则识别到末尾
    let windowEnd = state.duration;
    if (seg.durationSec != null && seg.durationSec >= 0) {
      windowEnd = Math.min(windowStart + seg.durationSec, state.duration);
    }
    const r = analyzeWindow(windowStart, windowEnd);
    if (!r.bpm) return null;
    // 第 1 段返回段内偏移（相对段起点）；后续段只填 BPM（相位按前段衔接）
    return segIndex === 0 ? { bpm: r.bpm, offset: r.offset } : { bpm: r.bpm };
  }

  function analyzeWindow(startSec, endSec) {
    const sr = analysis.DEFAULT_ANALYSIS_SR; // state.pcm 已降采样到分析采样率
    const gs = store.loadGlobalSettings();
    const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
    const delta = 1.6 - 0.9 * Math.max(0, Math.min(1, gs.sensitivity));
    const s = Math.max(0, Math.floor(startSec * sr));
    const e = Math.min(state.pcm.length, Math.ceil(endSec * sr));
    const win = state.pcm.subarray(s, e);
    if (win.length < sr * 1) return { bpm: null, offset: 0 };
    return analysis.analyze(win, { sampleRate: sr, hop, delta, minBpm: gs.minBpm, maxBpm: gs.maxBpm });
  }

  function captureVideoPcm() {
    return new Promise((resolve, reject) => {
      if (videoEl.readyState < 1) {
        reject(new Error('视频尚未加载完成'));
        return;
      }
      captureBar.hidden = false;
      captureFill.style.width = '0%';
      audio
        .captureVideoPcm(videoEl, (p) => {
          captureFill.style.width = Math.round(p * 100) + '%';
        }, store.loadGlobalSettings().captureRate)
        .then((r) => {
          state.pcm = r.pcm;
          state.rawMono = r.rawMono;
          state.sampleRate = r.sampleRate;
          state.duration = r.duration;
          state.peaks = render.buildPeaks(r.pcm);
          state.view = { start: 0, end: state.duration };
          captureBar.hidden = true;
          renderWave();
          status('音轨采集完成');
          resolve(r);
        })
        .catch((e) => {
          captureBar.hidden = true;
          reject(e);
        });
    });
  }
  function onSelectRange(t0, t1) {
    if (!state.grid) {
      status('请先设置节拍网格');
      return;
    }
    const r = seq.snapRange(state.grid, t0, t1);
    state.pendingSelection = r;
    btnAddSelection.disabled = false;
    renderWave();
    status('已选定：第 ' + r.startBar + '–' + r.endBar + ' 小节。点击「添加选中区间」加入列表。');
  }

  function addPendingSelection() {
    if (!state.pendingSelection) return;
    const r = state.pendingSelection;
    const item = seq.createItem(state.grid, r.startBar, r.endBar);
    if (item) {
      state.sequence.push(item);
      saveWorkspace();
      state.pendingSelection = null;
      btnAddSelection.disabled = true;
      renderAll();
      status('已添加：第 ' + r.startBar + '–' + r.endBar + ' 小节（' + ui.fmtTime(item.startTime) + ' – ' + ui.fmtTime(item.endTime) + '）');
    }
  }

  function removeItem(id) {
    state.sequence = state.sequence.filter((it) => it.id !== id);
    saveWorkspace();
    renderAll();
  }

  function moveItem(id, toIndex) {
    const arr = state.sequence;
    const idx = arr.findIndex((it) => it.id === id);
    if (idx < 0 || toIndex < 0 || toIndex >= arr.length || idx === toIndex) return;
    const [it] = arr.splice(idx, 1);
    arr.splice(toIndex, 0, it);
    saveWorkspace();
    renderAll();
  }

  function setFade(id, fadeInMs, fadeOutMs) {
    const it = state.sequence.find((x) => x.id === id);
    if (!it) return;
    it.fadeInMs = fadeInMs;
    it.fadeOutMs = fadeOutMs;
    saveWorkspace();
    renderAll();
  }

  // ---------- 播放 ----------
  let mixCache = null; // { key: string, buffer: AudioBuffer } —— 序列内容不变的拼接结果缓存
  let followMs = 90; // 视频跟随 seek 节流间隔（缓存自高级设置）
  let playTimer = null;
  let playSource = null;
  let playCtx = null;
  let playStartCtxTime = 0;
  let playStartPos = 0;
  let playing = false;
  let mixPlaying = false; // 拼接播放（先拼接成连续 buffer 再一次性播放，消除段间调度间隔）
  let mixPos = 0; // 拼接时间轴断点（秒）；暂停保留、停止重置为 0
  let playingSeqId = null; // 拼接播放中当前段的序列卡片 id（用于高亮）；null = 无高亮

  /** 暂停：停止播放但保留断点（playPos / mixPos），下次「播放」从断点继续。 */
  function pausePlay() {
    if (!playing) {
      // 未播放时也清理播放线等残留
      state.playTime = null;
      renderWave();
      return;
    }
    // 拼接播放暂停：记录拼接时间轴断点
    if (mixPlaying && playCtx && playSource) {
      mixPos = playStartPos + (playCtx.currentTime - playStartCtxTime);
    }
    playing = false;
    mixPlaying = false;
    btnPlay.textContent = '▶ 播放';
    btnPlaySeq.textContent = '▶ 播放拼接序列';
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (playSource) {
      // 手动停止前清空 onended：stop() 触发的 onended 是异步的，若后续立即
      // 重新播放（如进度条 seek），旧 source 的 onended 会在 mixPlaying 已
      // 恢复 true 后执行，误杀新播放（表现为点击进度条后立即“试听结束”）
      playSource.onended = null;
      try {
        playSource.stop();
      } catch (e) {
        /* 已停止则忽略 */
      }
      playSource.disconnect();
      playSource = null;
    }
    // 视频源：暂停画面（音频源已在上方 stop；视频与音频由统一按钮控制，音画同步）
    if (state.kind === 'video') {
      videoEl.pause();
    }
    state.playTime = null;
    renderWave();
  }

  /** 停止：暂停并把播放位置重置（原曲回标记点、拼接回序列开头）。 */
  function stopPlay() {
    pausePlay();
    state.playPos = state.cursorPos != null ? state.cursorPos : 0;
    mixPos = 0;
    if (playingSeqId !== null) {
      playingSeqId = null;
      renderAll();
    }
  }

  /** 时间点描述：秒 + （有网格时）对应的小节/格。 */
  function posDesc(t) {
    const bc = state.grid ? seq.timeToBarCell(state.grid, t) : null;
    return ui.fmtTime(t) + (bc ? '（第 ' + bc.bar + ' 小节 ' + bc.cell + ' 格）' : '');
  }

  /** 单击波形 → 重置播放位置与标记点到单击处（播放中则暂停），并把顶部 BPM 切换到该段。 */
  function onWaveClick(t) {
    if (!state.file) {
      fileInput.click();
      return;
    }
    if (playing) pausePlay();
    state.cursorPos = t;
    state.playPos = t;
    updateQuickBar();
    renderWave();
    status('播放位置与标记点：' + posDesc(t) + '（点「播放」从此处开始）');
  }

  /** 统一播放按钮：播放中点击 = 暂停（保留断点）；未播放 = 从当前播放位置（断点或标记点）开始。 */
  function playOriginal() {
    if (!state.file) return;
    if (playing) {
      pausePlay();
      status('已暂停（播放位置保留，点击「播放」从断点继续）');
      return;
    }
    pausePlay(); // 清理残留但不重置播放位置
    const t = state.playPos != null ? state.playPos : state.cursorPos != null ? state.cursorPos : 0;
    playing = true;
    btnPlay.textContent = '⏸ 暂停';
    if (state.kind === 'video' && videoEl.src) {
      playVideoSegment(t, state.duration, () => {
        stopPlay();
        status('播放结束');
      });
    } else if (state.audioBuffer) {
      playAudioSegment(t, state.duration, () => {
        stopPlay();
        status('播放结束');
      });
    } else {
      return;
    }
    status('从 ' + posDesc(t) + ' 开始播放');
  }

  function playAudioSegment(start, end, onEnd) {
    if (!state.audioBuffer) return;
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = playCtx.createBufferSource();
    src.buffer = state.audioBuffer;
    src.connect(playCtx.destination);
    src.start(0, start, end - start);
    playSource = src;
    playStartCtxTime = playCtx.currentTime;
    playStartPos = start;
    playTimer = setTimeout(onEnd, (end - start) * 1000 + 80);
    tickProgress();
  }

  function playVideoSegment(start, end, onEnd) {
    videoEl.currentTime = start;
    videoEl.play();
    playStartPos = start;
    const check = () => {
      if (!playing) return;
      if (videoEl.currentTime >= end || videoEl.ended) {
        videoEl.pause();
        onEnd();
      } else {
        playTimer = setTimeout(check, 100);
      }
    };
    playTimer = setTimeout(check, 100);
    tickProgress();
  }
  /** 拼接时间轴 → 原曲时间（播放线显示用）。 */
  function mixToOriginalTime(mt) {
    const items = state.sequence;
    let acc = 0;
    for (const it of items) {
      const d = it.endTime - it.startTime;
      if (mt < acc + d) return it.startTime + (mt - acc);
      acc += d;
    }
    const last = items[items.length - 1];
    return last ? last.endTime : 0;
  }

  function currentPlayTime() {
    if (mixPlaying) {
      const mt = playStartPos + (playCtx.currentTime - playStartCtxTime);
      return mixToOriginalTime(mt);
    }
    if (state.kind === 'video') return videoEl.currentTime;
    if (playCtx && playSource) return playStartPos + (playCtx.currentTime - playStartCtxTime);
    return null;
  }

  let tickFrame = 0;
  let lastVideoSeek = 0;
  let lastPlayHeadX = null;
  function tickProgress() {
    if (!playing) return;
    tickFrame++;
    if (tickFrame % 2 === 0) {
      const t = currentPlayTime();
      if (t != null) {
        state.playPos = t; // 播放位置跟随（暂停时即断点，每 tick 更新保证断点精度）
        const w = playHeadCanvas.clientWidth || playHeadCanvas.width;
        const x = render.timeToX(t, state.view, w);
        if (render.playHeadMoved(lastPlayHeadX, x)) {
          state.playTime = t;
          render.drawPlayHead(playHeadCanvas, state.view, t);
          lastPlayHeadX = x;
        }
      }
      // 拼接播放：进度条跟随 + 定位当前段高亮
      if (mixPlaying && state.sequence.length) {
        const mt = playStartPos + (playCtx.currentTime - playStartCtxTime);
        updateSeqProgress(mt);
        let segId = null;
        for (const it of state.sequence) {
          if (t != null && t >= it.startTime && t < it.endTime) { segId = it.id; break; }
        }
        if (segId !== playingSeqId) {
          const prevId = playingSeqId;
          playingSeqId = segId;
          ui.setPlayingCard(seqList, playingSeqId, prevId);
        }
      }
    }
    // 拼接播放（视频源）：画面跟随映射的原曲位置。
    // 优化：seek 节流（≥90ms 一次）+ 段内平滑（video 已在目标段附近时跳过，
    // 仅跨段或明显偏离时 seek）——避免每 4 帧无条件 seek 造成解码器繁忙卡顿。
    if (mixPlaying && state.kind === 'video' && videoEl.src && tickFrame % 4 === 0) {
      const t = currentPlayTime();
      if (t != null) {
        const now = performance.now();
        const drift = Math.abs(videoEl.currentTime - t);
        if (now - lastVideoSeek >= followMs && drift > 0.05) {
          videoEl.currentTime = t;
          lastVideoSeek = now;
        }
      }
    }
    requestAnimationFrame(tickProgress);
  }
  /** 序列内容不变的拼接结果缓存：命中返回缓存的 AudioBuffer，未命中重新拼接并缓存。 */
  function getMixBuffer() {
    const parts = seq.itemsToParts(state.sequence, state.sampleRate);
    const crossfade = Math.round((store.loadGlobalSettings().crossfadeMs / 1000) * state.sampleRate);
    const key = JSON.stringify({ parts, crossfade, sr: state.sampleRate });
    if (mixCache && mixCache.key === key) return mixCache.buffer;
    const mix = exp.renderMix(state.rawMono, parts, crossfade);
    if (!mix.length) return null;
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = playCtx.createBuffer(1, mix.length, state.sampleRate);
    buf.copyToChannel(mix, 0);
    mixCache = { key, buffer: buf };
    return buf;
  }
  /**
   * 播放拼接序列：先把各段按顺序拼成连续 buffer（含淡化与 5ms 防爆音交叉），
   * 再一次性播放——消除逐段 setTimeout 调度与音频节点启动造成的段间间隔。
   * 播放中再点 = 暂停（保留拼接断点）；停止 = 回到序列开头。
   */
  function playSequence() {
    if (!state.sequence.length) {
      status('序列为空，请先在波形上选段');
      return;
    }
    if (anyInvalid()) {
      status('存在无效的序列项（标红），请修正后再播放');
      return;
    }
    if (mixPlaying) {
      pausePlay();
      status('序列已暂停（播放位置保留，点击「播放拼接序列」从断点继续）');
      return;
    }
    pausePlay(); // 清理残留但不重置拼接断点（暂停后继续从断点；首次 mixPos=0 从头）
    if (!state.rawMono) {
      status('缺少音轨数据（视频需先采集音轨）');
      return;
    }
    const buf = getMixBuffer();
    if (!buf) {
      status('无可播放内容');
      return;
    }
    const src = playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(playCtx.destination);
    const startOffset = Math.min(mixPos, buf.length / state.sampleRate);
    src.start(0, startOffset);
    playSource = src;
    playStartCtxTime = playCtx.currentTime;
    playStartPos = startOffset;
    playing = true;
    mixPlaying = true;
    btnPlaySeq.textContent = '⏸ 暂停序列';
    src.onended = () => {
      if (mixPlaying) {
        stopPlay();
        btnPlaySeq.textContent = '▶ 播放拼接序列';
        status('试听结束');
      }
    };
    tickProgress();
    status('正在播放拼接序列（已消除段间间隔）');
  }

  // ---------- 导出 ----------
  function openExportDialog() {
    if (!state.sequence.length) {
      status('序列为空，没有可导出的内容');
      return;
    }
    const base = (state.file.name || 'remix').replace(/\.[^.]+$/, '');
    const canVideo =
      state.kind === 'video' &&
      typeof window.VideoEncoder === 'function' &&
      typeof window.VideoDecoder === 'function';
    MC.openExport(
      { baseName: base + '_remix', kind: state.kind, canVideo },
      { onExport: doExport }
    );
  }

  function doExport(opts) {
    if (!state.rawMono) {
      status('缺少音轨数据（视频需先采集音轨）');
      return;
    }
    status('正在渲染拼接…');
    setTimeout(async () => {
      try {
        const parts = seq.itemsToParts(state.sequence, state.sampleRate);
        const crossfade = (opts.crossfadeMs / 1000) * state.sampleRate;
        const mix = exp.renderMix(state.rawMono, parts, crossfade);
        const name = opts.fileName;
        if (opts.format === 'wav') {
          const buf = exp.encodeWav(mix, state.sampleRate);
          exp.downloadBlob(buf, name + '.wav', 'audio/wav');
          status('导出完成：' + name + '.wav');
        } else if (opts.format === 'mp3') {
          const buf = exp.encodeMp3(mix, state.sampleRate, opts.mp3Bitrate);
          exp.downloadBlob(buf, name + '.mp3', 'audio/mpeg');
          status('导出完成：' + name + '.mp3');
        } else if (opts.format === 'video') {
          await MC.exportVideo({
            file: state.file,
            parts,
            mix,
            mixSampleRate: state.sampleRate,
            fileName: name,
            onProgress: (p) => status('视频合成中…' + Math.round(p * 100) + '%'),
          });
          status('视频导出完成：' + name + '.mp4');
        }
      } catch (e) {
        status('导出失败：' + e.message);
      }
    }, 30);
  }

  // ---------- 事件绑定 ----------
  function init() {
    // 拖放
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      waveWrap.classList.add('drag-over');
    });
    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) waveWrap.classList.remove('drag-over');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      waveWrap.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length) handleFile(files[0]);
    });

    // 文件选择：未导入时点击波形区触发
    fileInput.addEventListener('click', (e) => e.stopPropagation());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
      fileInput.value = '';
    });

    btnOpenFile.addEventListener('click', () => fileInput.click());
    btnSettings.addEventListener('click', openSettings);
    btnPlay.addEventListener('click', playOriginal);
    btnPlaySeq.addEventListener('click', () => {
      if (playing && btnPlaySeq.textContent.includes('暂停')) pausePlay(); // 暂停：保留拼接断点
      else playSequence();
    });
    btnStop.addEventListener('click', stopPlay);
    // 快捷微调：BPM/offset 立即生效并重绘
    quickBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-q]');
      if (!btn || !state.grid) return;
      const delta = parseFloat(btn.dataset.d);
      if (btn.dataset.q === 'offset') {
        state.offset = Math.round((state.offset + delta) * 1000) / 1000;
      } else if (btn.dataset.q === 'bpm') {
        const seg = currentSegment();
        if (!seg) return;
        const bpm = Math.round((seg.bpm + delta) * 10) / 10;
        if (bpm < 40 || bpm > 300) return;
        state.segments[seg.index].bpm = bpm;
      }
      applyGridSettings();
      saveWorkspace();
      updateQuickBar();
    });
    btnAddSelection.addEventListener('click', addPendingSelection);
    btnExport.addEventListener('click', openExportDialog);
    btnManualAdd.addEventListener('click', toggleManualForm);
    btnManualOk.addEventListener('click', manualAdd);
    btnManualCancel.addEventListener('click', () => { manualForm.hidden = true; });

    // 手动添加序列：展开/收起表单（每次展开重建输入组件，使用当前网格）
    let maStartComp = null;
    let maEndComp = null;
    function toggleManualForm() {
      const show = manualForm.hidden;
      manualForm.hidden = !show;
      if (show) {
        maStart.textContent = '';
        maEnd.textContent = '';
        maStartComp = MC.UnitInput.create(maStart, {
          kind: 'position',
          edge: 'start',
          getGrid: () => state.grid,
          value: state.cursorPos || 0,
        });
        maEndComp = MC.UnitInput.create(maEnd, {
          kind: 'position',
          edge: 'end',
          getGrid: () => state.grid,
          value: (state.cursorPos || 0) + 1,
        });
      }
    }
    function manualAdd() {
      if (!maStartComp || !maEndComp) return;
      const s = maStartComp.getValue();
      const e = maEndComp.getValue();
      if (s == null || e == null || s >= e) {
        status('手动添加失败：起止需合法（小节/格或时间），且起点必须早于终点');
        return;
      }
      const item = {
        id: seq.newId(),
        startBar: null,
        endBar: null,
        startTime: s,
        endTime: e,
        fadeInMs: 0,
        fadeOutMs: 0,
        invalid: false,
      };
      state.sequence.push(item);
      manualForm.hidden = true;
      saveWorkspace();
      renderAll();
      status('已手动添加：' + ui.fmtTime(s) + ' – ' + ui.fmtTime(e));
    }

    // 波形交互
    interact.bindWaveform(waveCanvas, {
      getView: () => state.view || { start: 0, end: 1 },
      setView: (v) => {
        const d = state.duration || 1;
        const span = Math.max(0.5, v.end - v.start);
        // 视图窗口 start ∈ [min(0, d-span), max(0, d-span)]：
        // 宽度小于音频时可在音频范围内滑动（0..d-span），大于音频时居中（d-span..0）
        const minS = Math.min(0, d - span);
        const maxS = Math.max(0, d - span);
        const start = Math.max(minS, Math.min(maxS, v.start));
        state.view = { start, end: start + span };
        renderWave();
      },
      // 拖拽结束 → 选定区间（不落列，等「添加选中区间」）
      onSelectRange: onSelectRange,
      // 单击（无拖拽）→ 设置播放起点并从该处播放原曲
      onClick: onWaveClick,
      // 双击 → 选定该小节为区间
      onDblClick: (t) => onSelectRange(t, t),
      onPreviewRange: (t0, t1) => {
        state.dragRange = { t0, t1 };
        renderWave();
      },
      onClearPreview: () => {
        state.dragRange = null;
        renderWave();
      },
    });

    // 初始波形尺寸自适应
    function fitCanvas() {
      const rect = waveWrap.getBoundingClientRect();
      waveCanvas.width = rect.width;
      waveCanvas.height = rect.height;
      renderWave();
    }
    window.addEventListener('resize', fitCanvas);
    setTimeout(fitCanvas, 50);

    // 进度条：点击/拖动定位拼接时间轴
    // pointerdown 立即定位；pointermove 只更新视觉（避免拖动中反复重建音频）；
    // pointerup 以最终位置定位。setPointerCapture 对合成事件可能抛错，容错忽略。
    let progDrag = null;
    const progPos = (e) => {
      const rect = seqProgressTrack.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    };
    const progApply = (ratio) => {
      const total = seq.totalDuration(state.sequence);
      const mt = ratio * total;
      updateSeqProgress(mt);
      seekMix(mt);
    };
    seqProgressTrack.addEventListener('pointerdown', (e) => {
      if (!state.sequence.length || anyInvalid()) return;
      progDrag = { ratio: progPos(e), dragged: false };
      e.preventDefault();
      progApply(progDrag.ratio); // 单击即定位
      try {
        seqProgressTrack.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 合成事件无活动指针：忽略 */
      }
    });
    seqProgressTrack.addEventListener('pointermove', (e) => {
      if (!progDrag) return;
      progDrag.dragged = true;
      progDrag.ratio = progPos(e);
      // 拖动中只更新视觉，避免反复重建音频；松手时统一定位
      const total = seq.totalDuration(state.sequence);
      updateSeqProgress(progDrag.ratio * total);
    });
    seqProgressTrack.addEventListener('pointerup', (e) => {
      if (!progDrag) return;
      const ratio = progPos(e);
      const dragged = progDrag.dragged;
      progDrag = null;
      // 单击（无 move）→ down 已定位，不重复重建；拖动 → 以最终位置定位
      if (dragged) progApply(ratio);
    });
    seqProgressTrack.addEventListener('pointercancel', () => {
      progDrag = null;
    });

    // 快捷键：空格播放/暂停、Esc 关闭弹窗、←/→ 平移视口
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target && e.target.isContentEditable;
      if (typing) return; // 输入框聚焦时不触发
      if (e.code === 'Space') {
        e.preventDefault();
        if (mixPlaying || playing) {
          pausePlay();
          status('已暂停（播放位置保留，点击「播放」从断点继续）');
        } else {
          playOriginal();
        }
      } else if (e.key === 'Escape') {
        MC.modal && MC.modal.close();
        MC.closeExport && MC.closeExport();
        manualForm.hidden = true;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const view = state.view || { start: 0, end: 1 };
        const span = view.end - view.start;
        const dt = (e.key === 'ArrowLeft' ? -1 : 1) * span * 0.1;
        const d = state.duration || 1;
        const minS = Math.min(0, d - span);
        const maxS = Math.max(0, d - span);
        const start = Math.max(minS, Math.min(maxS, view.start + dt));
        state.view = { start, end: start + span };
        renderWave();
      }
    });

    refreshAdvancedSettings();
    document.addEventListener('tempokiri:settings-changed', refreshAdvancedSettings);

    status('拖入音频或视频文件开始');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
