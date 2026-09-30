/**
 * main.js — Remix 工作站装配层：全局状态、文件处理、播放、导出。
 *
 * 浏览器入口。依赖 MC.analysis / MC.audio / MC.render / MC.interact /
 * MC.sequence / MC.store / MC.export / MC.modal / MC.ui。
 */
(function () {
  'use strict';
  const T = MC.i18n.T;

  const CROSSFADE_MS = 10;

  const state = {
    file: null,
    kind: 'audio', // audio | video
    pcm: null, // 分析用 mono（22050）
    rawMono: null, // 原始采样率 mono（导出用）
    audioBuffer: null, // 试听用
    sampleRate: 0, // 文件原始采样率（未加载文件前无意义，勿写成 22050——那是 state.pcm 的分析率）
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
    cutPoints: null, // 自动剪辑剪切点标记（秒数组；弹窗打开期间显示在波形上）
    meta: null, // 当前文件元数据（解析值 + 编辑值合并结果）
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const waveCanvas = $('wave');
  const playHeadCanvas = $('playHead');
  const waveWrap = $('waveWrap');
  const waveHint = $('waveHint');
  const hintCard = $('hintCard');
  const btnHintOpen = $('btnHintOpen');
  const waveLegend = $('waveLegend');
  const videoEl = $('video');
  const videoWrap = $('videoWrap');
  const statusBar = $('statusBar');
  const seqList = $('seqList');
  const seqInfo = $('seqInfo');
  const btnOpenFile = $('btnOpenFile');
  const btnSettings = $('btnSettings');
  const btnAutoCut = $('btnAutoCut');
  const btnPlay = $('btnPlay');
  const btnPlaySeq = $('btnPlaySeq');
  const btnStop = $('btnStop');
  const btnMtr = $('btnMtr');
  const btnMtrSet = $('btnMtrSet');
  const quickBar = $('quickBar');
  const qBpmLabel = $('qBpmLabel');
  const qBpmVal = $('qBpmVal');
  const qOffsetVal = $('qOffsetVal');
  const controlBar = $('controlBar');
  const btnAddSelection = $('btnAddSelection');
  const selToEnd = $('selToEnd');
  const btnExport = $('btnExport');
  const fileInput = $('fileInput');
  const btnManualAdd = $('btnManualAdd');
  const manualForm = $('manualForm');
  const maRange = $('maRange');
  const btnManualOk = $('btnManualOk');
  const btnManualCancel = $('btnManualCancel');
  const seqProgress = $('seqProgress');
  const seqProgressTrack = $('seqProgressTrack');
  const seqProgressFill = $('seqProgressFill');
  const seqProgressSeams = $('seqProgressSeams');
  const seqProgressKnob = $('seqProgressKnob');
  const seqProgressTime = $('seqProgressTime');
  const seqProgressTip = $('seqProgressTip');

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
    if (hintCard) hintCard.hidden = true;
    waveHint.textContent = msg;
    waveHint.hidden = false;
  }
  function hideHint() {
    waveHint.hidden = true;
  }
  /** 波形颜色图例：有网格时显示，剪切点标记存在时显示剪切点项。 */
  function syncLegend() {
    if (!waveLegend) return;
    waveLegend.hidden = !state.grid;
    const cut = waveLegend.querySelector('.lg-cut');
    if (cut) cut.hidden = !state.cutPoints || !state.cutPoints.length;
  }
  // ---------- 撤销栈（序列编辑 + 网格应用；快捷栏微调不入栈防刷屏） ----------
  const UNDO_MAX = 20;
  const undoStack = [];
  function pushUndo() {
    undoStack.push({
      seq: JSON.parse(JSON.stringify(state.sequence)),
      grid: state.grid ? { segments: JSON.parse(JSON.stringify(state.segments)), offset: state.offset } : null,
    });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  function doUndo() {
    const snap = undoStack.pop();
    if (!snap) return;
    state.sequence = snap.seq;
    if (snap.grid) {
      state.segments = snap.grid.segments;
      state.offset = snap.grid.offset;
      try {
        state.grid = analysis.buildGrid({ segments: analysis.resolveSegments(state.segments, state.duration), offset: state.offset, duration: state.duration });
      } catch (e) {
        state.grid = null;
      }
    }
    saveWorkspace();
    renderAll();
    status(T('status.undoDone'));
  }
  function status(msg, kind) {
    statusBar.textContent = msg;
    // 分级着色：error=失败，warn=需用户注意，其余默认弱灰
    statusBar.className = kind === 'error' ? 'status-error' : kind === 'warn' ? 'status-warn' : '';
  }
  let waveDirty = false;
  let waveRafPending = false;
  function renderWave() {
    syncLegend(); // 图例随网格/剪切点状态同步（DOM 开销极小，不进入 rAF）
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
        cutPoints: state.cutPoints,
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
      d.title = T('seq.seamTitle', { time: ui.fmtTime(s) });
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
      onSilentDur: setSilentDur,
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
    applyTheme(gs.theme);
    if (state.file) renderWave();
  }

  /** 应用界面主题：切 `data-theme` 属性 + 同步波形 canvas 色值。 */
  function applyTheme(name) {
    const n = (name === 'nebula' || name === 'paper' || name === 'seigaiha' || name === 'kurenai') ? name : 'aurora';
    document.documentElement.dataset.theme = n;
    render.setTheme(n);
    pulseColor = null; // 律动条颜色缓存失效，下次绘制重读新 accent
    drawBrandPulse(PULSE_IDLE); // 立即用新主题重绘静态律动条（播放中由下一帧 tick 覆盖）
  }

  /** 序列中是否有非法项（空段落：无时长或与音频完全无重叠；部分重叠合法，渲染补静音）。 */
  function anyInvalid() {
    return state.sequence.some((it) => seq.isEmptyItem(it, state.duration || 0));
  }

  /**
   * 序列项起终点编辑（rangeInput 整范围 spec）。
   * spec = { mode, bars?, time? }；以选中语义为底层记录，另一侧派生由 syncItemTimes 维护。
   */
  function setRange(id, spec) {
    const it = state.sequence.find((x) => x.id === id);
    if (!it || it.silent || !spec) return;
    pushUndo();
    if (spec.mode === 'time' && spec.time) {
      it.mode = 'time';
      it.startTime = spec.time.startSec;
      it.endTime = spec.time.endSec;
    } else if (spec.bars) {
      it.mode = 'bars';
      it.startBar = spec.bars.startBar;
      it.startCell = spec.bars.startCell;
      it.endBar = spec.bars.endBar;
      it.endCell = spec.bars.endCell;
    }
    seq.syncItemTimes(it, state.grid);
    const empty = seq.isEmptyItem(it, state.duration || 0); // 空段落（无时长/无音频重叠）
    it.invalid = empty;
    if (it.invalid) {
      markInvalidCard(it, id);
      btnPlaySeq.disabled = true;
      debouncedSaveWorkspace();
      return;
    }
    debouncedSaveWorkspace();
    renderWave(); // 波形序列高亮变化（renderWave 内部 rAF 帧合并，连续输入不重复绘制）
    renderSeqProgress(); // 总时长/拼接点变化
    ui.updateSeqInfo(seqInfo, state.sequence, seq); // 总时长文本
    btnPlaySeq.disabled = anyInvalid();
  }

  /** 给非法卡片加标红 class（不重建 DOM，保留输入内容）。 */
  function markInvalidCard(it, id) {
    const card = seqList.querySelector('.seq-card[data-id="' + id + '"]');
    if (card) card.classList.add('invalid');
  }
  // ---------- 文件处理 ----------
  async function handleFile(file) {
    flushSaveWorkspace(); // 落盘挂起的防抖输入，避免切文件丢失最后一次编辑
    // 工作区已有内容且打开的是不同文件 → 询问是否保留
    if (state.file && state.file !== file && (state.sequence.length || state.grid)) {
      const keep = await confirmWorkspace();
      if (keep === null) return; // 取消：不切换
      if (!keep) store.clearSettings(state.file); // 不保留：清除该文件缓存（下次打开为空白）
    }
    stopPlay();
    undoStack.length = 0; // 撤销栈不跨文件
    state.file = file;
    waveWrap.classList.remove('no-file'); // 空态光标提示（pointer）→ 波形交互光标（crosshair）
    state.kind = audio.classifyFile(file);
    state.pcm = state.rawMono = state.audioBuffer = null;
    state.meta = null;
    state.grid = null;
    state.segments = [{ bpm: null, beatsPerBar: 4, beatUnit: 4 }];
    state.offset = 0;
    state.cursorPos = null;
    state.playPos = null;
    state.pendingSelection = null;
    selToEnd.hidden = true;
    state.sequence = [];
    mixCache = null; // 清空拼接缓存，避免旧拼接 buffer 悬挂到下次播放
    state.peaks = null;
    state.playTime = null;
    state.cutPoints = null;
    btnSettings.disabled = false;
    btnAutoCut.disabled = false;
    btnPlay.disabled = false;
    btnPlaySeq.disabled = false;
    btnStop.disabled = false;
    btnMtr.disabled = false;
    btnMtrSet.disabled = false;
    controlBar.hidden = false;
    btnExport.disabled = false;
    btnAddSelection.disabled = true;

    if (state.kind === 'video') {
      if (videoEl.src && videoEl.src.startsWith('blob:')) URL.revokeObjectURL(videoEl.src);
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
      let extractError = null; // 音轨提取失败消息（收尾时覆盖 hint，避免被缓存恢复提示吞掉）
      if (gs.videoExtract === 'capture') {
        showHint(T('hint.extractSilent'));
        try {
          await captureVideoPcm();
          hideHint();
        } catch (e2) {
          extractError = e2.message;
          showHint(T('hint.extractFailedManual', { msg: e2.message }));
        }
      } else {
        showHint(T('hint.extracting'));
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
            extractError = e.message;
            showHint(T('hint.extractFailedManual', { msg: e.message }));
          } else {
            captureBar.hidden = true;
            showHint(T('hint.extractSilentNoWc'));
            try {
              await captureVideoPcm();
              hideHint();
            } catch (e2) {
              extractError = e2.message;
              showHint(T('hint.extractFailedManual', { msg: e2.message }));
            }
          }
        }
      }
      const cached = applyCachedSettings();
      if (extractError) showHint(T('hint.extractFailedManual', { msg: extractError }));
      renderWave();
      status(cached ? T('status.appliedCached', { name: file.name }) : T('status.videoReady', { name: file.name }));
    } else {
      videoWrap.hidden = true;
      videoEl.removeAttribute('src');
      showHint(T('hint.decoding'));
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
        status(cached ? T('status.appliedCached', { name: file.name }) : T('status.ready', { name: file.name }));
      } catch (e) {
        showHint(T('status.decodeFailedMsg', { msg: e.message }));
        status(T('status.decodeFailed'));
      }
    }
    await loadMetaForFile();
    renderAll();
  }

  /**
   * 解析当前文件元数据并与 per-file 编辑值合并（解析失败静默为空）。
   * 封面不持久化，每次导入重新解析。
   */
  async function loadMetaForFile() {
    let parsed = {};
    try {
      parsed = MC.parseMetadata(await state.file.arrayBuffer(), audio.extOf(state.file.name));
    } catch (e) {
      parsed = {};
    }
    const edited = store.loadMetadata(state.file) || {};
    state.meta = MC.mergeMeta(parsed, edited);
    MC.metaModal.setData({ fileName: state.file.name, meta: state.meta });
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
    showHint(T('hint.configureGrid'));
    return false;
  }

  // ---------- 节拍设置 ----------
  function applySettings(segments, offset) {
    pushUndo(); // 网格变更入撤销栈（快捷栏微调不走此路径）
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
        mode: it.mode,
        startBar: it.startBar,
        endBar: it.endBar,
        startCell: it.startCell,
        endCell: it.endCell,
        startTime: it.startTime,
        endTime: it.endTime,
        fadeInMs: it.fadeInMs,
        fadeOutMs: it.fadeOutMs,
        silent: !!it.silent,
        durationSec: it.silent ? it.durationSec : undefined,
        unit: it.silent ? it.unit : undefined,
        qty: it.silent ? it.qty : undefined,
        bpm: it.silent ? it.bpm : undefined,
        beatsPerBar: it.silent ? it.beatsPerBar : undefined,
        beatUnit: it.silent ? it.beatUnit : undefined,
        invalid: !!it.invalid,
      })),
      view: state.view ? { start: state.view.start, end: state.view.end } : undefined,
    });
  }

  /** 序列输入防抖保存：合并连续输入（逐键），250ms 静默后统一落盘。 */
  let saveWsTimer = null;
  function debouncedSaveWorkspace() {
    clearTimeout(saveWsTimer);
    saveWsTimer = setTimeout(() => { saveWsTimer = null; saveWorkspace(); }, 250);
  }
  /** 立即落盘挂起的防抖保存（切文件前调用，避免最后一次输入丢失）。 */
  function flushSaveWorkspace() {
    if (saveWsTimer) { clearTimeout(saveWsTimer); saveWsTimer = null; saveWorkspace(); }
  }
  /** 从缓存恢复拼接序列（时间为主；旧缓存无时间时按小节推算）。 */
  function restoreSequence(list) {
    state.sequence = [];
    if (!Array.isArray(list)) return;
    for (const rec of list) {
      let it = null;
      if (rec.startTime != null && rec.endTime != null) {
        // 迁移规则：startBar 非空 → 小节/格为底层（旧数据均为小节来源）；否则精确时间锚定
        const isBars = rec.startBar != null && rec.endBar != null;
        it = {
          id: seq.newId(),
          mode: (rec.mode === 'time' || rec.mode === 'bars') ? rec.mode : (isBars ? 'bars' : 'time'),
          startBar: rec.startBar != null ? rec.startBar : null,
          endBar: rec.endBar != null ? rec.endBar : null,
          startCell: rec.startCell != null ? rec.startCell : (isBars ? 1 : null),
          endCell: rec.endCell != null ? rec.endCell : null,
          startTime: rec.startTime,
          endTime: rec.endTime,
          fadeInMs: rec.fadeInMs || 0,
          fadeOutMs: rec.fadeOutMs || 0,
          invalid: !!rec.invalid,
        };
        if (it.mode === 'bars') seq.syncItemTimes(it, state.grid); // 补派生时间缓存
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
          <h3>${T('modal.openNewTitle')}</h3>
          <p class="modal-sub">${T('modal.openNewBody1')}</p>
          <p class="modal-sub">${T('modal.openNewBody2')}</p>
          <p class="modal-sub">${T('modal.openNewBody3')}</p>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button class="btn" data-act="cancel">${T('modal.cancel')}</button>
            <button class="btn" data-act="discard">${T('modal.discard')}</button>
            <button class="btn btn-primary" data-act="keep">${T('modal.keep')}</button>
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
      seq.resyncGridItems(state.sequence, state.grid); // 小节/格定义段随新网格重算派生时间（内容随小节移动）
      hideHint(); // 网格应用后不再显示波形中央的交互提示（避免覆盖波形）
      renderAll();
    } catch (e) {
      status(T('status.bpmApplyFailed', { msg: e.message }), 'error');
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
    qBpmLabel.textContent = seg ? T('quick.bpmSeg', { n: seg.index + 1 }) : T('quick.bpm');
    qBpmVal.textContent = seg && seg.bpm != null ? String(+seg.bpm.toFixed(2)) : '--';
    qOffsetVal.textContent = (state.offset != null ? state.offset : 0).toFixed(3);
  }

  /** 快捷栏数值「点击直改」：点击数值出现输入框，Enter/blur 提交、Esc 还原（提交走与 ± 微调相同的应用路径）。 */
  function makeEditableValue(span, toInput, onCommit) {
    if (!span) return;
    span.setAttribute('title', T('quick.editHint'));
    span.addEventListener('click', () => {
      if (span.querySelector('input')) return;
      const old = span.textContent;
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'q-edit';
      input.value = toInput(old);
      span.textContent = '';
      span.appendChild(input);
      input.focus();
      input.select();
      let cancelled = false;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { cancelled = true; input.blur(); }
      });
      input.addEventListener('blur', () => {
        if (cancelled) {
          span.textContent = old; // 还原并移除输入框
          return;
        }
        const v = parseFloat(input.value);
        if (Number.isFinite(v) && onCommit(v)) {
          // 提交成功：applyGridSettings + updateQuickBar 已刷新文本并移除输入框
        } else {
          span.textContent = old;
        }
      });
    });
  }

  /** 点击直改提交：BPM（0.01 精度，40–300 校验）。返回是否已应用。 */
  function commitEditBpm(v) {
    const seg = currentSegment();
    if (!seg) return false;
    const bpm = Math.round(v * 100) / 100;
    if (bpm < 40 || bpm > 300) return false;
    state.segments[seg.index].bpm = bpm;
    applyGridSettings();
    saveWorkspace();
    updateQuickBar();
    return true;
  }
  /** 点击直改提交：偏移（0.001 精度）。 */
  function commitEditOffset(v) {
    state.offset = Math.round(v * 1000) / 1000;
    applyGridSettings();
    saveWorkspace();
    updateQuickBar();
    return true;
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
  async function autoDetect(segIndex, seg, allSegs, range) {
    if (state.kind === 'video' && !state.pcm) {
      status(T('hint.extractRapid'));
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
    status(T('hint.analyzing'));
    await new Promise((r) => setTimeout(r, 0)); // 让步一帧，让状态栏提示可见
    const r = analyzeWindow(windowStart, windowEnd, range);
    if (r && r.error) {
      status(r.error);
      return { error: r.error };
    }
    if (!r.bpm) {
      status(T('hint.noBeat'));
      return null;
    }
    status(r.ceilExtended
      ? T('hint.autoDoneExtended', { bpm: r.bpm.toFixed(1) })
      : T('hint.autoDone', { bpm: r.bpm.toFixed(1) }));
    // 第 1 段返回段内偏移（相对段起点）；后续段只填 BPM（相位按前段衔接）。
    // cands：竞争层 BPM 候选（v1.11.0，识别弹窗展示「其他可能 BPM」）
    const out = segIndex === 0 ? { bpm: r.bpm, offset: r.offset } : { bpm: r.bpm };
    if (r.bpmCandidates && r.bpmCandidates.length) out.cands = r.bpmCandidates;
    return out;
  }

  function analyzeWindow(startSec, endSec, range) {
    const sr = analysis.DEFAULT_ANALYSIS_SR; // state.pcm 已降采样到分析采样率
    const gs = store.loadGlobalSettings();
    const hop = Math.max(64, Math.min(2048, Math.round(gs.hop)));
    const delta = 1.6 - 0.9 * Math.max(0, Math.min(1, gs.sensitivity));
    const s = Math.max(0, Math.floor(startSec * sr));
    const e = Math.min(state.pcm.length, Math.ceil(endSec * sr));
    const win = state.pcm.subarray(s, e);
    // 能量预检：无声/近无声窗口直接返回，避免全窗分析空转（近无音轨视频秒级反馈）；
    // 放在长度检查之前——空/单样本窗口 RMS 为 0 或 NaN，能正确落到对应分支
    if (analysis.rmsOf(win) < 1e-4) return { bpm: null, offset: 0, error: T('hint.lowEnergy') };
    if (win.length < sr * 1) return { bpm: null, offset: 0 };
    // BPM Tap：非空 range（[tap×0.8, tap×1.2]）覆盖本次识别搜索窗（不改全局设置）
    return analysis.analyze(win, {
      sampleRate: sr, hop, delta,
      minBpm: range ? range.minBpm : gs.minBpm,
      maxBpm: range ? range.maxBpm : gs.maxBpm,
    });
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
          status(T('status.trackDone'));
          resolve(r);
        })
        .catch((e) => {
          captureBar.hidden = true;
          reject(e);
        });
    });
  }
  // ---------- 自动剪辑 ----------
  /** 自动剪辑分析范围：网格覆盖范围（有网格时）或全曲。 */
  function autoCutRange() {
    if (state.grid && state.grid.bars && state.grid.bars.length) {
      return {
        start: Math.max(0, state.grid.bars[0].startTime),
        end: state.grid.bars[state.grid.bars.length - 1].endTime,
      };
    }
    return { start: 0, end: state.duration };
  }

  /** 按参数分析自动剪辑方案（同步；更新剪切点标记与状态栏）。返回带展示字段的方案或 null。 */
  function analyzeAutoCutPlan(params) {
    const range = autoCutRange();
    const plan = MC.autoCut.buildPlan(state.pcm, {
      sr: analysis.DEFAULT_ANALYSIS_SR,
      grid: params.alignGrid ? state.grid : null,
      duration: state.duration,
      searchStart: range.start,
      searchEnd: range.end,
      minSegSec: params.minSegSec,
      anchor: params.anchor || undefined,
    });
    if (!plan.segments.length) {
      state.cutPoints = null;
      renderWave();
      status(T('autoCut.none'));
      return null;
    }
    state.cutPoints = plan.cuts.map((c) => c.time);
    renderWave();
    status(T('autoCut.done', { n: plan.cuts.length, m: plan.segments.length }));
    return Object.assign({}, plan, {
      searchStart: range.start,
      searchEnd: range.end,
      rangeFull: !state.grid,
      anchored: !!params.anchor,
    });
  }

  /** 运行自动剪辑：分析无痕剪切点并打开方案弹窗。 */
  async function runAutoCut() {
    if (state.kind === 'video' && !state.pcm) {
      status(T('hint.extractRapid'));
      await captureVideoPcm();
    }
    if (!state.pcm) {
      status(T('autoCut.noTrack'));
      return;
    }
    status(T('autoCut.scanning'));
    await new Promise((r) => setTimeout(r, 0)); // 让步一帧，让状态栏提示可见
    const result = analyzeAutoCutPlan({ minSegSec: 3, alignGrid: true });
    if (!result) {
      // 无方案：仍打开弹窗（showEmpty 展示提示），保留参数行供用户调参重试
      const range = autoCutRange();
      MC.autoCutModal.open(
        { cuts: [], segments: [], searchStart: range.start, searchEnd: range.end, rangeFull: !state.grid },
        {
          params: { minSegSec: 3, alignGrid: true },
          onImport: (p) => importAutoCutPlan(p),
          onAnalyze: (params) => analyzeAutoCutPlan(params),
          onPreview: previewAutoCutRange,
          onCancel: clearAutoCutMarks,
          getGrid: () => state.grid,
        }
      );
      return;
    }
    MC.autoCutModal.open(result, {
      params: { minSegSec: 3, alignGrid: true },
      onImport: (p) => importAutoCutPlan(p),
      onAnalyze: (params) => analyzeAutoCutPlan(params),
      onPreview: previewAutoCutRange,
      onCancel: clearAutoCutMarks,
      getGrid: () => state.grid,
    });
  }

  /** 试听方案区间：播放原曲 [start, end]（弹窗「▶」按钮；先停当前播放）。 */
  function previewAutoCutRange(start, end) {
    const d = state.duration || 0;
    start = Math.max(0, Math.min(start, d));
    end = Math.min(Math.max(start + 0.001, end), d);
    if (end - start <= 0.01) return;
    pausePlay(); // 清理旧播放/残留
    const onEnd = () => {
      stopPlay();
      status(T('status.previewEnd'));
    };
    status(T('autoCut.previewing', { from: ui.fmtTime(start), to: ui.fmtTime(end) }));
    if (state.kind === 'video' && videoEl.src) {
      playing = true;
      btnPlay.textContent = T('wave.pause');
      playVideoSegment(start, end, onEnd);
    } else if (state.audioBuffer) {
      playing = true;
      btnPlay.textContent = T('wave.pause');
      playAudioSegment(start, end, onEnd);
    } else {
      status(T('autoCut.noTrack'));
    }
  }

  /** 清除波形上的剪切点标记（弹窗取消/关闭时）。 */
  function clearAutoCutMarks() {
    state.cutPoints = null;
    renderWave();
  }

  /** 将剪辑方案导入拼接序列（现有序列非空时先确认替换）。 */
  async function importAutoCutPlan(plan) {
    if (state.sequence.length) {
      const ok = await confirmReplaceSequence();
      if (!ok) return; // 取消：保持现状，弹窗不关闭
    }
    pushUndo(); // 自动剪辑导入替换序列前入栈
    state.sequence = plan.segments.map((s) => ({
      id: seq.newId(),
      startBar: null,
      endBar: null,
      startTime: s.startTime,
      endTime: s.endTime,
      fadeInMs: 0,
      fadeOutMs: 0,
      invalid: false,
    }));
    MC.autoCutModal.close(); // 关闭触发 onCancel → clearAutoCutMarks
    saveWorkspace();
    renderAll();
    status(T('autoCut.imported', { n: state.sequence.length }));
  }

  /** 替换现有序列前的确认弹窗。返回 true=替换 / false=取消。 */
  function confirmReplaceSequence() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${T('autoCut.replaceTitle')}</h3>
          <p class="modal-sub">${T('autoCut.replaceBody', { n: state.sequence.length })}</p>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button class="btn" data-act="cancel">${T('modal.cancel')}</button>
            <button class="btn btn-primary" data-act="ok">${T('autoCut.replaceOk')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => {
        overlay.remove();
        resolve(v);
      };
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) done(false);
      });
    });
  }

  function onSelectRange(t0, t1) {
    if (!state.grid) {
      status(T('status.needGrid'));
      return;
    }
    const r = seq.snapRange(state.grid, t0, t1);
    state.pendingSelection = r;
    btnAddSelection.disabled = false;
    selToEnd.hidden = false;
    renderWave();
    status(r.startBar === r.endBar ? T('status.selectedRangeOne', { bar: r.startBar }) : T('status.selectedRange', { start: r.startBar, end: r.endBar }));
  }

  function addPendingSelection() {
    if (!state.pendingSelection) return;
    const r = state.pendingSelection;
    const item = seq.createItem(state.grid, r.startBar, r.endBar);
    if (item) {
      pushUndo();
      state.sequence.push(item);
      saveWorkspace();
      state.pendingSelection = null;
      selToEnd.hidden = true;
      btnAddSelection.disabled = true;
      renderAll();
      status(T('status.addedRange', { start: r.startBar, end: r.endBar, from: ui.fmtTime(item.startTime), to: ui.fmtTime(item.endTime) }));
    }
  }

  function removeItem(id) {
    pushUndo();
    state.sequence = state.sequence.filter((it) => it.id !== id);
    saveWorkspace();
    renderAll();
    status(T('status.deletedHint')); // 可 Ctrl+Z 恢复
  }

  function moveItem(id, toIndex) {
    const arr = state.sequence;
    const idx = arr.findIndex((it) => it.id === id);
    if (idx < 0 || toIndex < 0 || toIndex >= arr.length || idx === toIndex) return;
    pushUndo();
    const [it] = arr.splice(idx, 1);
    arr.splice(toIndex, 0, it);
    saveWorkspace();
    renderAll();
  }

  function setFade(id, fadeInMs, fadeOutMs) {
    const it = state.sequence.find((x) => x.id === id);
    if (!it) return;
    pushUndo();
    it.fadeInMs = fadeInMs;
    it.fadeOutMs = fadeOutMs;
    saveWorkspace();
    renderAll();
  }

  /** 静音段时长编辑（卡片折叠区，秒）。编辑后语义退化为「精确时长」（音乐单位随动语义不再成立）。 */
  function setSilentDur(id, sec) {
    const it = state.sequence.find((x) => x.id === id);
    if (!it || !it.silent) return;
    pushUndo();
    it.durationSec = Math.round(sec * 1000) / 1000;
    it.unit = 'sec'; // 退化：精确时长定义（节拍器不打点）
    it.qty = it.durationSec;
    saveWorkspace();
    renderAll();
    status(T('status.silentAdded', { dur: ui.fmtTime(it.durationSec) }));
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
  let lastSeqPlay = false; // 空格恢复的播放来源：true=拼接序列（暂停断点续），false=原曲
  let playAnalyser = null; // 律动品牌标数据源（AnalyserNode，播放时采集时域振幅）
  let pulseData = null; // analyser 时域采样缓冲
  let pulseColor = null; // 律动条颜色缓存（主题切换时由 applyTheme 置空失效）
  let pulseEnv = null;   // 律动条包络状态（RMS + 快攻慢放平滑，避免逐帧闪烁）

  const PULSE_IDLE = [0.3, 0.7, 1, 0.8, 0.5, 0.9, 0.6, 0.3]; // 静止态正弦包络

  // ---------- 节拍器 ----------
  let mtrOn = false;        // 开关（store 持久化）
  let mtrSeqOn = true;      // 拼接序列播放时启用（默认开，设置弹窗可关）
  let mtrUnit = 0;          // 几分音符（0 = 自动取拍号分母）
  let mtrVolume = 80;       // 音量 0-200
  let mtrTone = 'click';    // 音色：click | beep | wood
  let mtrGain = null;       // 节拍器总线增益 → destination
  let mtrNextT = null;      // 下一拍网格时间（秒）
  let mtrNextAccent = false;// 下一拍是否重音（小节首拍）
  let mtrTimer = null;      // lookahead 调度定时器
  let mtrLastGrid = null;   // 上次调度的网格时间（拼接原曲时间回退检测）
  let mtrAxis = 'orig';     // 拍点时间轴：orig（原曲网格）| mix（静音段 mix 轴合成）| silent（静默）

  const MTR_TONES = {
    click: { type: 'triangle', freq: 1500, accentFreq: 1900, dur: 0.05 }, // 短促「嗒」：重音更高
    beep: { type: 'sine', freq: 880, accentFreq: 1175, dur: 0.12 },         // 柔和蜂鸣
    wood: { type: 'triangle', freq: 430, accentFreq: 620, dur: 0.07 },      // 木质敲击
  };

  /** 律动条颜色：读当前主题 accent（缓存；applyTheme 置空后下次重读）。 */
  function pulseColorOf() {
    if (!pulseColor) pulseColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#22d3ee';
    return pulseColor;
  }

  /** 绘制品牌律动条：amps 为长度 8 的 0..1 振幅数组。 */
  function drawBrandPulse(amps) {
    const c = document.getElementById('brandPulse');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = pulseColorOf();
    for (let i = 0; i < 8; i++) {
      const h = Math.max(2, Math.round(amps[i] * 16));
      ctx.fillRect(i * 8, c.height - h, 5, h);
    }
  }

  // ---------- 节拍器（跟随播放，拍点与小节线对齐；独立声源，不写入音频/导出） ----------
  /** 启动节拍器：从当前播放位置的下一拍开始 lookahead 调度。 */
  function startMetronome() {
    if (!mtrOn || mtrTimer) return;
    if (!state.grid || !state.grid.segments) return; // 无网格 → 无小节线
    const t0 = currentPlayTime();
    if (t0 == null) return;
    const first = MC.metronome.nextClick(state.grid.segments, t0 - 1e-6, mtrUnit);
    if (!first) return;
    mtrNextT = first.t;
    mtrNextAccent = first.accent;
    mtrLastGrid = t0;
    mtrAxis = 'orig';
    if (!mtrGain) {
      mtrGain = playCtx.createGain();
      mtrGain.gain.value = (mtrVolume / 100) * 0.5;
      mtrGain.connect(playCtx.destination);
    }
    mtrTimer = setInterval(mtrTick, 25);
  }

  /** 停止节拍器：清调度器（已排程的短音自然衰减，数毫秒内结束）。 */
  function stopMetronome() {
    if (mtrTimer) {
      clearInterval(mtrTimer);
      mtrTimer = null;
    }
    mtrNextT = null;
    mtrAxis = 'orig';
  }

  /** lookahead 调度：提前 ~120ms 排程拍点（拍点按网格时间轴，段内参数随段切换）。 */
  function mtrTick() {
    if (!mtrOn || !playing) {
      stopMetronome();
      return;
    }
    const segs = state.grid && state.grid.segments;
    if (!segs || !segs.length) return;
    const AHEAD = 0.2;
    const ctx = playCtx;
    const nowCtx = ctx.currentTime;
    // 拼接播放：音乐单位静音段在 mix 轴合成拍点（自带 BPM/拍号，与其他段一致的时长语义）
    if (mixPlaying && state.sequence.length) {
      const mt = playStartPos + (playCtx.currentTime - playStartCtxTime);
      const hit = MC.metronome.mixItemAt(state.sequence, mt);
      if (hit) {
        const it = hit.item;
        if (it.silent && (it.unit === 'bar' || it.unit === 'beat')) {
          // 音乐单位静音段：mix 轴打点（段起点重音，段内小节边界重音）
          if (mtrAxis !== 'mix') {
            const f = MC.metronome.nextClickInSilent(it, hit.startMix, mt - 1e-6, mtrUnit);
            mtrNextT = f ? f.t : null;
            mtrNextAccent = f ? f.accent : false;
            mtrAxis = 'mix';
          }
          while (mtrNextT != null && mtrNextT < mt + AHEAD) {
            if (mtrNextT + 0.005 >= mt) {
              mtrSchedule(mtrNextAccent, Math.max(nowCtx + 0.01, nowCtx + (mtrNextT - mt)));
            }
            const n = MC.metronome.nextClickInSilent(it, hit.startMix, mtrNextT, mtrUnit);
            // 防御浮点边界：拍点必须严格前进（否则终止，防死循环）
            if (!n || n.t <= mtrNextT + 1e-9) {
              mtrNextT = null;
              break;
            }
            mtrNextT = n.t;
            mtrNextAccent = n.accent;
          }
          return;
        }
        if (it.silent) {
          // 时间单位静音段：无节拍语义，静默（保持 mix 轴状态，结束段后重同步）
          mtrAxis = 'silent';
          return;
        }
      }
    }
    // 原曲轴（普通音乐段/原曲播放）：网格拍点
    const nowGrid = currentPlayTime();
    if (nowGrid == null) return;
    if (mtrAxis !== 'orig') {
      // 从静音段模式切回：重同步拍点游标
      const f = MC.metronome.nextClick(segs, nowGrid - 1e-6, mtrUnit);
      mtrNextT = f ? f.t : null;
      mtrNextAccent = f ? f.accent : false;
      mtrAxis = 'orig';
    } else if (MC.metronome.shouldResync(mtrLastGrid, nowGrid)) {
      // 拼接播放：重复段后原曲时间大幅回退 → 拍点游标重同步（否则节拍器静默）
      const f = MC.metronome.nextClick(segs, nowGrid - 1e-6, mtrUnit);
      mtrNextT = f ? f.t : null;
      mtrNextAccent = f ? f.accent : false;
    }
    mtrLastGrid = nowGrid;
    while (mtrNextT != null && mtrNextT < nowGrid + AHEAD) {
      if (mtrNextT + 0.005 >= nowGrid) {
        // 排程时间不早于当前（调度积压/seek 时避免 setValueAtTime(过去) 造成瞬时静音）
        mtrSchedule(mtrNextAccent, Math.max(nowCtx + 0.01, nowCtx + (mtrNextT - nowGrid)));
      }
      const n = MC.metronome.nextClick(segs, mtrNextT, mtrUnit);
      // 防御浮点边界：拍点必须严格前进（否则终止，防死循环）
      if (!n || n.t <= mtrNextT + 1e-9) {
        mtrNextT = null;
        break;
      }
      mtrNextT = n.t;
      mtrNextAccent = n.accent;
    }
  }

  /** 播放一个节拍音色：osc + 短促指数衰减包络；重音更高频、更响。 */
  function mtrSchedule(accent, ctxT) {
    const t = MTR_TONES[mtrTone] || MTR_TONES.click;
    const osc = playCtx.createOscillator();
    const g = playCtx.createGain();
    osc.type = t.type;
    osc.frequency.value = accent ? t.accentFreq : t.freq;
    const amp = accent ? 1.0 : 0.8; // 重音靠音高区分（更高频），响度差异克制
    g.gain.setValueAtTime(amp, ctxT);
    g.gain.exponentialRampToValueAtTime(0.001, ctxT + t.dur);
    osc.connect(g);
    g.connect(mtrGain);
    osc.start(ctxT);
    osc.stop(ctxT + t.dur + 0.02);
  }

  /** 应用节拍器设置（弹窗保存回调）：音量改动即时作用于总线增益。 */
  function applyMtrSettings(s) {
    if (s.unit != null) mtrUnit = s.unit;
    if (s.volume != null) mtrVolume = s.volume;
    if (s.tone != null) mtrTone = s.tone;
    if (s.seqOn != null) mtrSeqOn = !!s.seqOn;
    if (mtrGain) mtrGain.gain.value = (mtrVolume / 100) * 0.5;
  }

  /** 确保律动分析节点存在（fftSize 128 → frequencyBinCount 64，供 8 柱 × 8 点采样）。 */
  function ensureAnalyser() {
    if (!playAnalyser) {
      playAnalyser = playCtx.createAnalyser();
      playAnalyser.fftSize = 128;
      pulseData = new Uint8Array(playAnalyser.frequencyBinCount);
    }
    return playAnalyser;
  }

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
    btnPlay.textContent = T('wave.play');
    btnPlaySeq.textContent = T('wave.playSeq');
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
    syncPlayButtons();
    stopMetronome();
    if (playAnalyser) {
      try { playAnalyser.disconnect(); } catch (e) { /* 已断开则忽略 */ }
    }
  }

  /** 播放按钮状态：活动的播放按钮高亮，另一播放入口弱化（视觉区分当前播放源）。 */
  function syncPlayButtons() {
    btnPlay.classList.toggle('playing', playing && !mixPlaying);
    btnPlaySeq.classList.toggle('playing', mixPlaying);
    btnPlay.classList.toggle('dimmed', mixPlaying);
    btnPlaySeq.classList.toggle('dimmed', playing && !mixPlaying);
  }

  /** 停止：暂停并把播放位置重置（原曲回标记点、拼接回序列开头）。 */
  function stopPlay() {
    pausePlay();
    if (playAnalyser) { try { playAnalyser.disconnect(); } catch (e) { /* 已断开则忽略 */ } }
    playAnalyser = null; // 停止后释放分析节点（恢复播放时由 ensureAnalyser 重建）
    drawBrandPulse(PULSE_IDLE); // 律动条恢复静态波形
    state.playPos = state.cursorPos != null ? state.cursorPos : 0;
    mixPos = 0;
    if (playingSeqId !== null) {
      playingSeqId = null;
      renderAll();
    }
    lastSeqPlay = false;
    status(T('status.stopped')); // 手动停止后状态栏如实显示（自然结束路径随后覆盖）
  }

  /** 时间点描述：秒 + （有网格时）对应的小节/格。 */
  function posDesc(t) {
    const bc = state.grid ? seq.timeToBarCell(state.grid, t) : null;
    return ui.fmtTime(t) + (bc ? T('status.posDesc', { bar: bc.bar, cell: bc.cell }) : '');
  }

  /** 单击波形 → 重置播放位置与标记点到单击处（播放中则暂停），并把顶部 BPM 切换到该段。 */
  function onWaveClick(t) {
    if (!state.file) {
      fileInput.click();
      return;
    }
    if (!state.grid) {
      openSettings(); // 还未设置网格：与波形提示「点击设置节拍」一致，直接打开设置
      return;
    }
    if (playing) pausePlay();
    state.cursorPos = t;
    state.playPos = t;
    updateQuickBar();
    renderWave();
    status(T('status.cursorSet', { pos: posDesc(t) }));
  }

  /** 统一播放按钮：播放中点击 = 暂停（保留断点）；未播放 = 从当前播放位置（断点或标记点）开始。 */
  function playOriginal() {
    if (!state.file) return;
    if (playing) {
      pausePlay();
      status(T('status.paused'));
      return;
    }
    pausePlay(); // 清理残留但不重置播放位置
    const t = state.playPos != null ? state.playPos : state.cursorPos != null ? state.cursorPos : 0;
    playing = true;
    lastSeqPlay = false;
    btnPlay.textContent = T('wave.pause');
    syncPlayButtons();
    if (state.kind === 'video' && videoEl.src) {
      playVideoSegment(t, state.duration, () => {
        stopPlay();
        status(T('status.playEnd'));
      });
    } else if (state.audioBuffer) {
      playAudioSegment(t, state.duration, () => {
        stopPlay();
        status(T('status.playEnd'));
      });
    } else {
      return;
    }
    status(T('status.playFrom', { pos: posDesc(t) }));
    startMetronome();
  }

  function playAudioSegment(start, end, onEnd) {
    if (!state.audioBuffer) return;
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = playCtx.createBufferSource();
    src.buffer = state.audioBuffer;
    src.connect(ensureAnalyser());
    playAnalyser.connect(playCtx.destination);
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
  /** 拼接时间轴 → 原曲时间（播放线显示用）。静音段无原曲区间：播放线冻结在静音前位置。 */
  function mixToOriginalTime(mt) {
    const items = state.sequence;
    let acc = 0;
    let lastT = 0;
    for (const it of items) {
      const d = seq.itemDuration(it);
      if (mt < acc + d) return it.silent ? lastT : it.startTime + (mt - acc);
      acc += d;
      if (!it.silent) lastT = it.endTime;
    }
    const last = items[items.length - 1];
    return last ? (last.silent ? lastT : last.endTime) : 0;
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
    if (playAnalyser) {
      playAnalyser.getByteTimeDomainData(pulseData);
      const targets = new Array(8);
      for (let i = 0; i < 8; i++) {
        let sum = 0;
        for (let j = 0; j < 8; j++) {
          const v = (pulseData[i * 8 + j] - 128) / 128;
          sum += v * v;
        }
        targets[i] = Math.sqrt(sum / 8); // RMS：比瞬时峰值稳定
      }
      if (!pulseEnv) pulseEnv = PULSE_IDLE.slice();
      for (let i = 0; i < 8; i++) {
        pulseEnv[i] = render.envelopeTrack(pulseEnv[i], targets[i], 0.55, 0.12); // 快攻慢放（VU 表式）
      }
      drawBrandPulse(pulseEnv);
    }
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
      // 拼接播放：进度条跟随 + 定位当前段高亮（按拼接时间轴累计；静音段计入时长）
      if (mixPlaying && state.sequence.length) {
        const mt = playStartPos + (playCtx.currentTime - playStartCtxTime);
        updateSeqProgress(mt);
        let segId = null;
        let acc = 0;
        for (const it of state.sequence) {
          const d = seq.itemDuration(it);
          if (mt < acc + d) { segId = it.id; break; }
          acc += d;
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
    if (playing) requestAnimationFrame(tickProgress);
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
      status(T('status.seqEmpty'));
      return;
    }
    if (anyInvalid()) {
      status(T('status.seqInvalid'), 'warn');
      return;
    }
    if (mixPlaying) {
      pausePlay();
      status(T('status.pausedSeq'));
      return;
    }
    pausePlay(); // 清理残留但不重置拼接断点（暂停后继续从断点；首次 mixPos=0 从头）
    if (!state.rawMono) {
      status(T('status.noTrack'));
      return;
    }
    const buf = getMixBuffer();
    if (!buf) {
      status(T('status.nothingToPlay'));
      return;
    }
    const src = playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(ensureAnalyser());
    playAnalyser.connect(playCtx.destination);
    const startOffset = Math.min(mixPos, buf.length / state.sampleRate);
    src.start(0, startOffset);
    playSource = src;
    playStartCtxTime = playCtx.currentTime;
    playStartPos = startOffset;
    playing = true;
    mixPlaying = true;
    btnPlaySeq.textContent = T('wave.pauseSeq');
    syncPlayButtons();
    src.onended = () => {
      if (mixPlaying) {
        stopPlay();
        btnPlaySeq.textContent = T('wave.playSeq');
        status(T('status.playEnd'));
      }
    };
    tickProgress();
    lastSeqPlay = true;
    status(T('status.playingSeq'));
    if (mtrSeqOn) startMetronome(); // 拼接序列播放：设置里可关闭
  }

  // ---------- 导出 ----------
  function openExportDialog() {
    if (!state.sequence.length) {
      status(T('status.nothingToExport'));
      return;
    }
    const base = (state.file.name || 'remix').replace(/\.[^.]+$/, '');
    const canVideo =
      state.kind === 'video' &&
      typeof window.VideoEncoder === 'function' &&
      typeof window.VideoDecoder === 'function';
    MC.openExport(
      { baseName: base + '_remix', kind: state.kind, canVideo, sampleRate: state.sampleRate },
      { onExport: doExport }
    );
  }

  function doExport(opts) {
    if (!state.rawMono) {
      status(T('status.noTrack'));
      return;
    }
    status(T('status.rendering'));
    setTimeout(async () => {
      try {
        const parts = seq.itemsToParts(state.sequence, state.sampleRate);
        const crossfade = (opts.crossfadeMs / 1000) * state.sampleRate;
        let mix = exp.renderMix(state.rawMono, parts, crossfade);
        if (opts.tab === 'audio') {
          let sr = state.sampleRate;
          if (opts.sampleRate !== 'src') {
            sr = parseInt(opts.sampleRate, 10);
            mix = analysis.resample(mix, state.sampleRate, sr);
          }
          if (opts.normalize) mix = exp.peakNormalize(mix, opts.peakDb);
          const name = opts.fileName;
          if (opts.format === 'wav') {
            let buf = exp.encodeWav(mix, sr, opts.bitDepth);
            buf = MC.attachToWav(buf, state.meta || {});
            exp.downloadBlob(buf, name + '.wav', 'audio/wav');
            status(T('status.exportedWav', { name: name }));
          } else {
            let buf = exp.encodeMp3(mix, sr, opts.mp3Bitrate);
            buf = MC.attachToMp3(buf, state.meta || {});
            exp.downloadBlob(buf, name + '.mp3', 'audio/mpeg');
            status(T('status.exportedMp3', { name: name }));
          }
        } else if (opts.tab === 'video') {
          await MC.exportVideo({
            file: state.file,
            parts,
            mix,
            mixSampleRate: state.sampleRate,
            fileName: opts.fileName,
            videoBitrate: opts.videoBitrate,
            framerate: opts.framerate,
            maxWidth: opts.maxWidth,
            maxHeight: opts.maxHeight,
            audioBitrate: opts.audioBitrate,
            mute: !!opts.mute,
            onProgress: (p) => status(T('status.videoRendering', { pct: Math.round(p * 100) })),
          });
          status(T('status.videoExported', { name: opts.fileName }));
        } else {
          // Majdata：bg.mp4（无声，上限 1080P60）+ track.mp3（44100Hz）
          // 补空小节：开头插入一小节静音——音轨 padSilenceStart；视频 padStartSec（首帧冻结），保持音画同步
          const padDur = opts.padBar ? seq.padBarDuration(state.grid && state.grid.segments) : 0;
          const majMix = padDur > 0 ? exp.padSilenceStart(mix, padDur, state.sampleRate) : mix;
          if (state.kind === 'video') {
            await MC.exportVideo({
              file: state.file,
              parts,
              mix,
              mixSampleRate: state.sampleRate,
              fileName: 'bg',
              videoBitrate: opts.videoBitrate,
              framerate: 60,
              maxWidth: 1920,
              maxHeight: 1080,
              audioBitrate: 128000,
              mute: true,
              padStartSec: padDur,
              onProgress: (p) => status(T('status.majRendering', { pct: Math.round(p * 100) })),
            });
          }
          let tMix = analysis.resample(majMix, state.sampleRate, 44100);
          if (opts.normalize) tMix = exp.peakNormalize(tMix, opts.peakDb);
          const buf = MC.attachToMp3(exp.encodeMp3(tMix, 44100, opts.mp3Bitrate), state.meta || {});
          exp.downloadBlob(buf, 'track.mp3', 'audio/mpeg');
          status(state.kind === 'video' ? T('status.majDoneVideo') : T('status.majDoneAudio'));
        }
      } catch (e) {
        const m = (e && e.message) || String(e);
        let msg = m;
        // 已知环境性错误映射为可读提示（AAC 编码器在受限环境 flush 失败/码率受限）
        if ((e && e.code === 'AAC_ENCODER_UNSUPPORTED') || m.indexOf('Flushing error') !== -1) {
          msg = T('export.aacEnvHint');
        } else if (m.indexOf('Unsupported bitrate') !== -1) {
          msg = T('export.aacBitrateHint');
        }
        status(T('status.exportFailed', { msg }), 'error');
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
    if (btnHintOpen) btnHintOpen.addEventListener('click', () => fileInput.click()); // 空态引导卡主按钮
    btnSettings.addEventListener('click', openSettings);
    btnAutoCut.addEventListener('click', runAutoCut);
    btnPlay.addEventListener('click', playOriginal);
    btnPlaySeq.addEventListener('click', () => {
      if (playing && btnPlaySeq.textContent.includes('⏸')) pausePlay(); // 暂停：保留拼接断点
      else playSequence();
    });
    btnStop.addEventListener('click', stopPlay);
    // 节拍器：开关（跟随播放，拍点与小节线对齐）+ 设置弹窗
    if (btnMtr) {
      btnMtr.addEventListener('click', () => {
        if (!state.grid || !state.grid.segments) {
          status(T('metronome.noGrid'), 'warn');
          return;
        }
        mtrOn = !mtrOn;
        btnMtr.classList.toggle('on', mtrOn);
        store.saveGlobalSettings({ metronomeOn: mtrOn });
        if (mtrOn && playing) startMetronome();
        else if (!mtrOn && !playing) stopMetronome();
        status(mtrOn ? T('metronome.on') : T('metronome.off'));
      });
    }
    if (btnMtrSet) {
      btnMtrSet.addEventListener('click', () => {
        if (typeof MC.metronomeModal !== 'function' && !(MC.metronomeModal && MC.metronomeModal.open)) return;
        const seg0 = (state.grid && state.grid.segments && state.grid.segments[0]) || null;
        MC.metronomeModal.open(mtrUnit, mtrVolume, mtrTone, seg0, mtrSeqOn, (s) => {
          applyMtrSettings(s);
          store.saveGlobalSettings({ metronomeUnit: s.unit, metronomeVolume: s.volume, metronomeTone: s.tone, metronomeSeqOn: s.seqOn });
        });
      });
    }
    // 快捷微调：BPM/offset 立即生效并重绘
    quickBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-q]');
      if (!btn || !state.grid) return;
      const delta = parseFloat(btn.dataset.d);
      if (btn.dataset.q === 'offset') {
        const next = Math.round((state.offset + delta) * 1000) / 1000;
        // 全空小节下界：offset 负值不能超过首段一个小节长
        const f0 = state.grid && state.grid.segments && state.grid.segments[0];
        const barDur0 = f0 && f0.barDur > 0 ? f0.barDur : Infinity;
        if (next <= -barDur0) {
          status(T('status.offsetLimit'), 'warn');
          return;
        }
        state.offset = next;
      } else if (btn.dataset.q === 'bpm') {
        const seg = currentSegment();
        if (!seg) return;
        const bpm = Math.round((seg.bpm + delta) * 100) / 100; // 步进精度与 ±0.01 按钮一致
        if (bpm < 40 || bpm > 300) return;
        state.segments[seg.index].bpm = bpm;
      }
      applyGridSettings();
      saveWorkspace();
      updateQuickBar();
    });
    // 快捷栏数值点击直改（0.01/0.001 精度，与 ± 按钮同一应用路径）
    makeEditableValue(qBpmVal, (old) => { const v = parseFloat(old); return Number.isFinite(v) ? String(v) : ''; }, commitEditBpm);
    makeEditableValue(qOffsetVal, (old) => { const v = parseFloat(old); return Number.isFinite(v) ? String(v) : ''; }, commitEditOffset);
    // 操作说明 popover（? 按钮）
    const hintBtn = $('hintBtn');
    const hintPop = $('hintPop');
    if (hintBtn && hintPop) {
      hintBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hintPop.hidden = !hintPop.hidden;
        hintBtn.setAttribute('aria-expanded', String(!hintPop.hidden));
      });
      document.addEventListener('click', (e) => {
        if (!hintPop.hidden && !e.target.closest('.hint-wrap')) hintPop.hidden = true;
      });
    }
    btnAddSelection.addEventListener('click', addPendingSelection);
    selToEnd.addEventListener('click', () => {
      const g = state.grid, p = state.pendingSelection;
      const last = g && g.bars && g.bars[g.bars.length - 1];
      if (!p || !last) return;
      state.pendingSelection = { startBar: p.startBar, endBar: last.barNumber };
      renderWave();
      status(p.startBar === last.barNumber ? T('status.selectedRangeOne', { bar: p.startBar }) : T('status.selectedRange', { start: p.startBar, end: last.barNumber }));
    });
    btnExport.addEventListener('click', openExportDialog);
    btnManualAdd.addEventListener('click', toggleManualForm);
    btnManualOk.addEventListener('click', manualAdd);
    btnManualCancel.addEventListener('click', () => { manualForm.hidden = true; });

    // 静音段：行内表单（时长单位 + 音乐参数；节拍器行为与普通段一致：音乐单位打点、时间单位不打点）
    const btnSilentAdd = $('btnSilentAdd');
    const silentForm = $('silentForm');
    const silentQty = $('silentQty');
    const silentUnit = $('silentUnit');
    const silentMus = $('silentMus');
    const silentSec = $('silentSec');
    const silentQtySec = $('silentQtySec');
    const silentBpm = $('silentBpm');
    const silentMeter = $('silentMeter');
    const btnSilentOk = $('btnSilentOk');
    const btnSilentCancel = $('btnSilentCancel');
    if (silentBpm) silentBpm.placeholder = T('seq.silentBpmPh');
    if (silentMeter) silentMeter.placeholder = T('seq.silentMeterPh');
    function silentBarDur() {
      return (60 / silBpmOrDefault()) * silBpbOrDefault();
    }
    /** 音乐单位行编辑 → 精确时长派生（单向）。 */
    function syncSilentFromMus() {
      const q = parseFloat(silentQty.value);
      silentQtySec.value = Number.isFinite(q) && q > 0 ? String(+(q * silentBarDur()).toFixed(3)) : '';
    }
    /** 精确时长编辑 → 音乐单位派生（单向，按当前 BPM/拍号换算）。 */
    function syncSilentFromSec() {
      const q = parseFloat(silentQtySec.value);
      silentQty.value = Number.isFinite(q) && q > 0 ? String(+(q / silentBarDur()).toFixed(3)) : '';
    }
    /** radio 切换：应用当前缓存值到选中语义，另一侧禁用（只读派生随后单向往上更新）。 */
    function setSilentModeSection(mode) {
      const mus = mode === 'mus';
      silentQty.disabled = !mus;
      silentUnit.disabled = !mus;
      silentQtySec.disabled = mus;
      if (mus) syncSilentFromSec(); else syncSilentFromMus();
    }
    function silBpmOrDefault() {
      const v = parseFloat(silentBpm.value);
      if (Number.isFinite(v) && v > 0) return v;
      const p = silentMusicParams('bar');
      return p.bpm;
    }
    function silBpbOrDefault() {
      const m = /^\s*(\d{1,2})\s*[/:]\s*(\d{1,2})\s*$/.exec(silentMeter.value || '');
      if (m) return parseInt(m[1], 10);
      return silentMusicParams('bar').beatsPerBar;
    }
    if (silentMus) silentMus.addEventListener('change', () => setSilentModeSection('mus'));
    if (silentSec) silentSec.addEventListener('change', () => setSilentModeSection('sec'));
    if (silentQty) silentQty.addEventListener('input', () => { if (silentMus && silentMus.checked) syncSilentFromMus(); });
    if (silentQtySec) silentQtySec.addEventListener('input', () => { if (silentSec && silentSec.checked) syncSilentFromSec(); });
    function toggleSilentForm() {
      const show = silentForm.hidden;
      silentForm.hidden = !show;
      if (show) {
        // 音乐单位不再依赖网格：静音段自带 BPM/拍号（跟随前段 > 网格首段 > 120/4-4）
        silentMus.checked = true;
        silentSec.checked = false;
        silentQty.value = '1';
        silentQtySec.value = '1';
        setSilentModeSection('mus');
        const prev = state.sequence[state.sequence.length - 1];
        const bpmHint = prev && prev.silent ? prev.bpm
          : (prev && state.grid && state.grid.segments ? (MC.metronome.segmentAt(state.grid.segments, prev.startTime) || {}).bpm
            : (state.grid && state.grid.segments ? state.grid.segments[0].bpm : 120));
        if (silentBpm && bpmHint > 0) silentBpm.value = '';
        if (silentMeter) silentMeter.value = '';
        if (silentBpm && bpmHint > 0) silentBpm.title = bpmHint;
      }
    }
    /** 静音段 BPM/拍号来源链：显式输入 > 前段参数 > 网格 > 默认 120/4-4。 */
    function silentMusicParams(unit) {
      const prev = state.sequence[state.sequence.length - 1];
      let bpm = 120, bpb = 4, ub = 4;
      if (prev && prev.silent) {
        bpm = prev.bpm || 120; bpb = prev.beatsPerBar || 4; ub = prev.beatUnit || 4;
      } else if (prev && state.grid && state.grid.segments) {
        const seg = MC.metronome.segmentAt(state.grid.segments, prev.startTime);
        if (seg) { bpm = seg.bpm; bpb = seg.beatsPerBar; ub = seg.beatUnit; }
      } else if (state.grid && state.grid.segments) {
        const seg = state.grid.segments[0];
        bpm = seg.bpm; bpb = seg.beatsPerBar; ub = seg.beatUnit;
      }
      const bpmIn = parseFloat(silentBpm.value);
      if (Number.isFinite(bpmIn) && bpmIn > 0) bpm = bpmIn;
      const m = /^\s*(\d{1,2})\s*[/:]\s*(\d{1,2})\s*$/.exec(silentMeter.value || '');
      if (m) { bpb = parseInt(m[1], 10); ub = parseInt(m[2], 10); }
      return { bpm, beatsPerBar: Math.max(1, bpb), beatUnit: Math.max(1, ub), unit: unit };
    }
    function confirmSilent() {
      const mus = silentMus && silentMus.checked;
      const unit = mus ? silentUnit.value : 'sec';
      const qty = parseFloat(mus ? silentQty.value : silentQtySec.value);
      if (!Number.isFinite(qty) || qty <= 0) {
        status(T('status.manualAddEmpty'), 'warn');
        return;
      }
      let dur = qty;
      const p = silentMusicParams(unit);
      if (unit === 'bar' || unit === 'beat') {
        const beatDur = 60 / p.bpm;
        const barDur = beatDur * p.beatsPerBar;
        dur = qty * (unit === 'bar' ? barDur : beatDur);
      }
      const item = {
        id: seq.newId(),
        silent: true,
        durationSec: Math.round(dur * 1000) / 1000,
        unit,
        qty,
        bpm: p.bpm,
        beatsPerBar: p.beatsPerBar,
        beatUnit: p.beatUnit,
        startBar: null,
        endBar: null,
        startTime: 0,
        endTime: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        invalid: false,
      };
      pushUndo();
      state.sequence.push(item);
      silentForm.hidden = true;
      saveWorkspace();
      renderAll();
      status(T('status.silentAdded', { dur: ui.fmtTime(item.durationSec) }));
    }
    if (btnSilentAdd) {
      btnSilentAdd.addEventListener('click', toggleSilentForm);
      btnSilentOk.addEventListener('click', confirmSilent);
      btnSilentCancel.addEventListener('click', () => { silentForm.hidden = true; });
    }

    // 手动添加序列：展开/收起表单（rangeInput：小节/格 或 时间起止点，二选一；tab 默认小节/格）
    let maRangeComp = null;
    function toggleManualForm() {
      const show = manualForm.hidden;
      manualForm.hidden = !show;
      if (show) {
        maRangeComp = MC.rangeInput.create(maRange, {
          getGrid: () => state.grid,
          value: {
            mode: 'bars',
            startBar: state.cursorPos != null ? (seq.timeToBarCell(state.grid, state.cursorPos) || { bar: 1, cell: 1 }).bar : 1,
            startCell: state.cursorPos != null ? (seq.timeToBarCell(state.grid, state.cursorPos) || { cell: 1 }).cell : 1,
            endBar: (seq.timeToBarCell(state.grid, state.cursorPos || 0) || { bar: 1 }).bar,
            endCell: (seq.timeToBarCell(state.grid, state.cursorPos || 0) || { cell: 1 }).cell,
            startTime: state.cursorPos || 0,
            endTime: (state.cursorPos || 0) + 2,
          },
        });
      }
    }
    function manualAdd() {
      if (!maRangeComp) return;
      const spec = maRangeComp.getSpec();
      if (!spec || (spec.mode === 'time' ? !(spec.time && spec.time.endSec > spec.time.startSec) : !(spec.bars && spec.bars.endBar >= spec.bars.startBar))) {
        status(T('status.manualAddFailed'), 'warn');
        return;
      }
      let item;
      if (spec.mode === 'time') {
        item = {
          id: seq.newId(),
          mode: 'time',
          startBar: null,
          endBar: null,
          startCell: null,
          endCell: null,
          startTime: spec.time.startSec,
          endTime: spec.time.endSec,
          fadeInMs: 0,
          fadeOutMs: 0,
          invalid: false,
        };
        seq.syncItemTimes(item, state.grid); // 派生小节/格显示
      } else {
        item = {
          id: seq.newId(),
          mode: 'bars',
          startBar: spec.bars.startBar,
          startCell: spec.bars.startCell,
          endBar: spec.bars.endBar,
          endCell: spec.bars.endCell,
          startTime: null,
          endTime: null,
          fadeInMs: 0,
          fadeOutMs: 0,
          invalid: false,
        };
        seq.syncItemTimes(item, state.grid);
      }
      const s = item.startTime, e = item.endTime;
      // 空段落拦截：与音频 [0, duration) 完全无重叠（含 [16,100] 起点在曲尾）直接不允许添加
      if (!(e > 0 && s < (state.duration || 0))) {
        status(T('status.manualAddEmpty'), 'warn');
        return;
      }
      pushUndo();
      state.sequence.push(item);
      manualForm.hidden = true;
      saveWorkspace();
      renderAll();
      status(T('status.manualAdded', { from: ui.fmtTime(s), to: ui.fmtTime(e) }));
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
    // 拖动定位悬浮时间气泡（quadrant clamp 到轨道内）
    const showTip = (ratio) => {
      if (!seqProgressTip || !state.sequence.length) return;
      const total = seq.totalDuration(state.sequence);
      seqProgressTip.textContent = ui.fmtTime(ratio * total);
      seqProgressTip.hidden = false;
      const w = seqProgressTrack.clientWidth;
      const x = Math.max(18, Math.min(w - 18, ratio * w));
      seqProgressTip.style.left = x + 'px';
    };
    const hideTip = () => { if (seqProgressTip) seqProgressTip.hidden = true; };
    seqProgressTrack.addEventListener('pointerdown', (e) => {
      if (!state.sequence.length || anyInvalid()) return;
      progDrag = { ratio: progPos(e), dragged: false };
      e.preventDefault();
      progApply(progDrag.ratio); // 单击即定位
      showTip(progDrag.ratio);
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
      showTip(progDrag.ratio);
    });
    seqProgressTrack.addEventListener('pointerup', (e) => {
      hideTip();
      if (!progDrag) return;
      const ratio = progPos(e);
      const dragged = progDrag.dragged;
      progDrag = null;
      // 单击（无 move）→ down 已定位，不重复重建；拖动 → 以最终位置定位
      if (dragged) progApply(ratio);
    });
    seqProgressTrack.addEventListener('pointercancel', () => {
      hideTip();
      progDrag = null;
    });

    // 快捷键：空格播放/暂停、Esc 关闭弹窗、←/→ 平移视口、Ctrl/Cmd+Z 撤销
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target && e.target.isContentEditable;
      if (typing) return; // 输入框聚焦时不触发
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        doUndo();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (mixPlaying || playing) {
          const wasSeq = mixPlaying;
          pausePlay();
          status(wasSeq ? T('status.pausedSeq') : T('status.paused'));
        } else if (lastSeqPlay && state.sequence.length) {
          playSequence(); // 恢复拼接播放（从暂停断点继续）
        } else {
          playOriginal();
        }
      } else if (e.key === 'Escape') {
        // 各弹窗体系分别关闭：modal.js 铺平导出为 MC.open/MC.close（无 MC.modal）；
        // 高级设置挂在 MC.settings（footer.js 同源调用 openAdvanced）；页脚自建
        // overlay 按 id 移除，避免通用遍历误删持久化节点
        MC.close && MC.close();
        MC.closeExport && MC.closeExport();
        MC.settings && MC.settings.closeAdvanced && MC.settings.closeAdvanced();
        MC.metaModal && MC.metaModal.close && MC.metaModal.close();
        MC.autoCutModal && MC.autoCutModal.close && MC.autoCutModal.close();
        MC.metronomeModal && MC.metronomeModal.close && MC.metronomeModal.close();
        manualForm.hidden = true;
        const footOverlay = document.getElementById('readmeOverlay') || document.getElementById('easterEggOverlay');
        if (footOverlay) footOverlay.remove();
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

    MC.metaModal.init({
      onEdit: (meta) => {
        state.meta = meta;
        if (state.file) {
          const { cover, ...fields } = meta; // cover 只读，不持久化
          store.saveMetadata(state.file, fields);
        }
      },
    });
    refreshAdvancedSettings();
    document.addEventListener('tempokiri:settings-changed', refreshAdvancedSettings);

    // 节拍器初始设置（store 持久化），同按钮态
    const gs0 = store.loadGlobalSettings();
    mtrOn = !!gs0.metronomeOn;
    mtrSeqOn = gs0.metronomeSeqOn !== false;
    mtrUnit = gs0.metronomeUnit || 0;
    mtrVolume = gs0.metronomeVolume != null ? gs0.metronomeVolume : 80;
    mtrTone = gs0.metronomeTone || 'click';
    if (btnMtr) btnMtr.classList.toggle('on', mtrOn);

    drawBrandPulse(PULSE_IDLE); // 品牌律动条初始静态波形
    document.title = T('app.title');
    MC.i18n.applyStatic(); // 静态文字按 strings.json 填充（data-i18n）
    status(T('status.dragToStart'));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
