/**
 * audio.js — 浏览器音频解码与视频音轨 PCM 采集。
 *
 * 音频文件：AudioContext.decodeAudioData → 全量 PCM。
 * 视频文件：<video>.captureStream() + ScriptProcessorNode 静音快速播放采集
 *           （避开 AudioWorklet 的 Blob URL 限制，兼容 file:// 场景）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./analysis.js'));
  } else {
    global.MC = global.MC || {};
    Object.assign(global.MC, factory(global.MC));
  }
})(typeof self !== 'undefined' ? self : this, function (analysis) {
  'use strict';

  const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'webm'];
  const VIDEO_EXTS = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'ogv'];

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  /** 判断文件是音频还是视频（按扩展名，未知按 MIME 兜底）。 */
  function classifyFile(file) {
    const ext = extOf(file.name);
    if (VIDEO_EXTS.indexOf(ext) >= 0) return 'video';
    if (AUDIO_EXTS.indexOf(ext) >= 0) return 'audio';
    if (file.type && file.type.startsWith('video/')) return 'video';
    if (file.type && file.type.startsWith('audio/')) return 'audio';
    return 'audio'; // 未知扩展名按音频处理，让浏览器解码器决定
  }

  function getAudioContext() {
    if (typeof AudioContext !== 'undefined') return new AudioContext();
    if (typeof webkitAudioContext !== 'undefined') return new webkitAudioContext();
    return null;
  }

  /**
   * 用 WebCodecs 直接从视频文件解码音轨（快、准，无 autoplay 限制）。
   * 备用方案：captureStream 实时采集。
   * @param {File} file
   * @param {(p:number)=>void} [onProgress]
   * @returns {Promise<{pcm:Float32Array, rawMono:Float32Array, sampleRate:number, duration:number}>}
   */
  async function decodeVideoAudioTrack(file, onProgress) {
    if (typeof window.AudioDecoder !== 'function' || (!window.MP4Box && !window.mp4box)) {
      throw new Error('WebCodecs 不可用');
    }
    const MP4Box = window.MP4Box || window.mp4box;
    const buf = await file.arrayBuffer();

    // 1. mp4box demux 音频轨
    const audio = await demuxAudioTrack(buf, MP4Box);
    if (!audio || !audio.samples.length) throw new Error('视频中没有音频轨道');
    if (!audio.description && /mp4a|aac/i.test(audio.codec || '')) { throw new Error('无法获取音频解码描述（该编码暂不支持音轨提取）'); }

    // 2. AudioDecoder 解码
    const pcmChunks = [];
    let decoderError = null;
    const decoder = new AudioDecoder({
      output: (audioData) => {
        try {
          const frames = audioData.numberOfFrames;
          const channels = audioData.numberOfChannels;
          // 逐平面拷贝：AudioDecoder 输出 f32-planar，copyTo 必须显式指定
          // planeIndex（不支持一次拷贝全部平面），dest 每平面恰好 frames 长。
          // 平面布局 planar[ch * frames + i] 与下方汇总循环的按平面索引
          // 混合一致；不能把平面数据当交错布局读，否则立体声每个 chunk
          // 后半段读到 0（产生周期性“有声→静音”锯齿音）
          const planar = new Float32Array(frames * channels);
          for (let ch = 0; ch < channels; ch++) {
            audioData.copyTo(planar.subarray(ch * frames), { planeIndex: ch });
          }
          pcmChunks.push({ data: planar, channels, rate: audioData.sampleRate });
        } catch (e) {
          decoderError = new Error('AudioData.copyTo 失败：' + e.message);
        } finally {
          audioData.close();
        }
      },
      error: (e) => {
        decoderError = new Error('音轨解码失败：' + e.message);
      },
    });
    const decCfg = {
      codec: audio.codec,
      sampleRate: audio.sampleRate,
      numberOfChannels: audio.channels,
    };
    if (audio.description) decCfg.description = audio.description;
    decoder.configure(decCfg);

    for (let i = 0; i < audio.samples.length; i++) {
      const s = audio.samples[i];
      const chunk = new EncodedAudioChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round((s.cts / audio.timescale) * 1e6),
        duration: Math.round((s.duration / audio.timescale) * 1e6),
        data: s.data,
      });
      decoder.decode(chunk);
      if (i % 64 === 0 && onProgress) onProgress(0.1 + 0.6 * (i / audio.samples.length));
    }
    await decoder.flush();
    if (decoderError) throw decoderError;
    // 3. 汇总为 mono：data 为平面布局 planar[ch * frames + i]，按平面索引混合
    const mono = mixPlanarChunks(pcmChunks);
    const rate = pcmChunks.length ? pcmChunks[0].rate : audio.sampleRate;
    if (onProgress) onProgress(0.85);
    const duration = mono.length / rate;
    return {
      pcm: analysis.resample(mono, rate, analysis.DEFAULT_ANALYSIS_SR),
      rawMono: mono,
      sampleRate: rate,
      duration,
    };
  }

  /**
   * 将平面布局 PCM chunk 混合为 mono。
   * 每个 chunk：data 为 planar[ch * frames + i]（各声道独立连续段），
   * 多声道按等权平均。若把平面数据当交错布局读，立体声每个 chunk
   * 后半段会读到 0（周期性“有声→静音”锯齿音），必须按平面索引混合。
   * @param {Array<{data:Float32Array, channels:number}>} chunks
   * @returns {Float32Array}
   */
  function mixPlanarChunks(chunks) {
    let total = 0;
    for (const c of chunks) total += c.data.length / c.channels;
    const mono = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      const frames = c.data.length / c.channels;
      if (c.channels === 1) {
        mono.set(c.data, off);
      } else {
        for (let f = 0; f < frames; f++) {
          let sum = 0;
          for (let ch = 0; ch < c.channels; ch++) sum += c.data[ch * frames + f];
          mono[off + f] = sum / c.channels;
        }
      }
      off += frames;
    }
    return mono;
  }

  /** mp4box 提取音频轨样本与解码描述。 */
  function demuxAudioTrack(buf, MP4Box) {
    return new Promise((resolve, reject) => {
      const file = MP4Box.createFile();
      let audioTrack = null;
      let description = null;
      let ready = false;

      file.onReady = (info) => {
        const at = info.audioTracks && info.audioTracks[0];
        if (!at) {
          resolve(null);
          return;
        }
        audioTrack = at;
        const track = file.getTrackById(at.id);
        if (track) {
          const stsd = track.mdia && track.mdia.minf && track.mdia.minf.stbl && track.mdia.minf.stbl.stsd;
          const entry = stsd && stsd.entries && stsd.entries[0];
          description = extractAudioDescription(entry, MP4Box);
        }
        file.setExtractionOptions(at.id, null, { nbSamples: Infinity });
        file.start();
      };

      file.onSamples = (trackId, user, samples) => {
        if (!ready) {
          ready = true;
          resolve({
            codec: audioTrack && audioTrack.codec,
            sampleRate: audioTrack && audioTrack.audio && audioTrack.audio.sample_rate,
            channels: audioTrack && audioTrack.audio && audioTrack.audio.channel_count,
            timescale: audioTrack && audioTrack.timescale,
            samples,
            description,
          });
        }
      };

      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
      setTimeout(() => {
        if (!ready) reject(new Error('无法解析音频轨'));
      }, 10000);
    });
  }

  /** 从音频 sample entry 提取 AudioSpecificConfig（AAC）。 */
  function extractAudioDescription(entry, MP4Box) {
    if (!entry) return null;
    // esds box → DecoderSpecificInfo
    const esds = entry.esds;
    if (esds) {
      const walk = (obj, depth) => {
        if (!obj || depth > 6) return null;
        if (obj.tag === 5 && obj.data) {
          // DecoderSpecificInfo：data 即 AudioSpecificConfig
          return new Uint8Array(obj.data);
        }
        if (obj.decoderSpecificInfo) {
          const d = obj.decoderSpecificInfo;
          if (d.data) return new Uint8Array(d.data);
        }
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (v && typeof v === 'object') {
            const r = Array.isArray(v) ? v.map((x) => walk(x, depth + 1)).find(Boolean) : walk(v, depth + 1);
            if (r) return r;
          }
        }
        return null;
      };
      return walk(esds, 0);
    }
    return null;
  }

  /**
   * 解析 WAV 文件头（RIFF fmt chunk）的真实采样率。
   * Chromium 的 decodeAudioData 会把解码结果重采样到 AudioContext 的设备率，
   * 导致「跟随源」导出静默变成 48k；WAV 可从文件头直接取源率。
   * @param {ArrayBuffer|DataView} buf
   * @returns {number|null} 采样率；非 WAV/无法解析返回 null
   */
  function readWavSampleRate(buf) {
    try {
      const dv = buf instanceof DataView ? buf : new DataView(buf);
      if (dv.byteLength < 44) return null;
      const tag = (off, n) => {
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(off + i));
        return s;
      };
      if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE') return null;
      // 遍历 chunk（fmt 不一定是第一个），RIFF chunk 按 2 字节对齐
      let off = 12;
      while (off + 8 <= dv.byteLength) {
        const id = tag(off, 4);
        const size = dv.getUint32(off + 4, true);
        if (id === 'fmt ') {
          if (size < 4 || off + 8 + size > dv.byteLength) return null;
          return dv.getUint32(off + 8 + 4, true); // audioFormat(2) + channels(2) 之后
        }
        off += 8 + size + (size % 2);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 解码音频文件。
   * 返回：pcm（降采样分析用）、rawMono（原始采样率，导出用）、audioBuffer（试听用）。
   * @param {File} file
   * @returns {Promise<{pcm:Float32Array, rawMono:Float32Array, audioBuffer:AudioBuffer,
   *                    sampleRate:number, duration:number}>}
   */
  async function decodeAudioFile(file) {
    const ctx = getAudioContext();
    if (!ctx) throw new Error('当前浏览器不支持 Web Audio API');
    const buf = await file.arrayBuffer();
    // WAV：以源采样率创建 OfflineAudioContext 解码，避免被设备率（常见 48k）
    // 重采样——否则「跟随源」导出的 WAV 会被静默改为 48k（无损归档场景失真）。
    // 非 WAV（MP3 等无法可靠读头）保持现状：跟随设备率，弹窗会标注实际率。
    const wavRate = readWavSampleRate(buf);
    let audioBuffer;
    if (wavRate && wavRate > 0) {
      const octx = new OfflineAudioContext(1, 1, wavRate);
      audioBuffer = await octx.decodeAudioData(buf);
    } else {
      audioBuffer = await ctx.decodeAudioData(buf);
    }
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }
    const mono = analysis.toMono(channels);
    const sampleRate = audioBuffer.sampleRate;
    return {
      pcm: analysis.resample(mono, sampleRate, analysis.DEFAULT_ANALYSIS_SR),
      rawMono: mono,
      audioBuffer,
      sampleRate,
      duration: audioBuffer.duration,
    };
  }

  /**
   * 从视频采集音轨 PCM（静音快速播放一遍）。
   * 注意：captureStream 的音频跟随 playbackRate，采集后需按倍速拉伸时间轴。
   * @param {HTMLVideoElement} video
   * @param {(progress:number)=>void} [onProgress] 0..1
   * @param {number} [playbackRate=4]
   * @returns {Promise<{pcm:Float32Array, sampleRate:number, duration:number}>}
   */
  function captureVideoPcm(video, onProgress, playbackRate = 8) {
    return new Promise((resolve, reject) => {
      if (!video.captureStream) {
        reject(new Error('当前浏览器不支持 video.captureStream，无法分析视频音轨'));
        return;
      }
      const ctx = getAudioContext();
      if (!ctx) {
        reject(new Error('当前浏览器不支持 Web Audio API'));
        return;
      }
      const stream = video.captureStream();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      let sampleRate = ctx.sampleRate;

      const onAudio = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        sampleRate = e.inputBuffer.sampleRate || sampleRate;
        chunks.push(Float32Array.from(input));
      };

      const onEnded = () => {
        clearTimeout(guardTimer);
        try {
          cleanup();
          resolve(finalize(chunks, sampleRate, video.duration, playbackRate));
        } catch (e) {
          reject(e);
        }
      };
      const onError = (err) => {
        clearTimeout(guardTimer);
        try {
          cleanup();
        } catch (e) {
          /* 忽略收尾异常 */
        }
        reject(err);
      };

      // 超时兜底：受限环境下 video.play() 可能挂起（永不触发 ended），
      // 按预期播放时长（duration/playbackRate）给出上限，超时按已采集
      // 数据收尾——chunks 为空时 finalize 抛错，避免无限等待无反馈
      const expectedMs = ((video.duration || 30) / playbackRate) * 1000;
      const guardMs = Math.min(15000, Math.max(8000, expectedMs * 2 + 2000));
      const guardTimer = setTimeout(() => {
        clearTimeout(guardTimer);
        try {
          cleanup();
          resolve(finalize(chunks, sampleRate, video.duration, playbackRate));
        } catch (e) {
          reject(e);
        }
      }, guardMs);

      let cleanup = () => {
        proc.onaudioprocess = null;
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        src.disconnect();
        proc.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        if (ctx.state === 'running') {
          ctx.close().catch(() => {});
        }
      };

      video.muted = true;
      video.playbackRate = playbackRate;
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
      video.play().catch((e) => {
        cleanup();
        reject(new Error('视频播放失败（可能需用户交互后重试）：' + e.message));
      });
      if (onProgress) {
        const tick = () => {
          if (video.duration) onProgress(Math.min(1, video.currentTime / video.duration));
        };
        video.addEventListener('timeupdate', tick);
        const origCleanup = cleanup;
        cleanup = () => {
          video.removeEventListener('timeupdate', tick);
          origCleanup();
        };
      }
    });
  }

  /**
   * 汇总采集块；playbackRate > 1 时音频被加速，需拉伸回原始时长。
   * @param {Array<Float32Array>} chunks
   * @param {number} sampleRate 采集采样率
   * @param {number} duration 视频时长
   * @param {number} playbackRate 播放倍速
   */
  function finalize(chunks, sampleRate, duration, playbackRate = 1) {
    if (!chunks.length) {
      // 采集未收到任何音频数据（视频无声/无音轨，或环境不支持音轨采集）：
      // 直接抛错，避免产出 0 样本的「成功」结果静默污染分析与导出
      throw new Error('未能采集到视频音轨数据（视频可能无声，或当前环境不支持音轨采集）');
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    let mono = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      mono.set(c, off);
      off += c.length;
    }
    // 4x 播放 → 采集音频为 4x 加速：重采样拉伸 4 倍时长
    if (playbackRate > 1) {
      mono = analysis.resample(mono, sampleRate, sampleRate * playbackRate);
    }
    return {
      pcm: analysis.resample(mono, sampleRate, analysis.DEFAULT_ANALYSIS_SR),
      rawMono: mono,
      sampleRate,
      duration: duration || mono.length / sampleRate,
    };
  }
  return { classifyFile, decodeAudioFile, decodeVideoAudioTrack, captureVideoPcm, getAudioContext, extOf, mixPlanarChunks, readWavSampleRate };
});
