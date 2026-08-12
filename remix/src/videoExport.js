/**
 * videoExport.js — WebCodecs 视频合成管线（MP4 → MP4）。
 *
 * 流程：mp4box demux 原视频 → VideoDecoder 逐帧解码 →
 *       按选区时间窗筛选帧并重建时间戳 → VideoEncoder 重编码 →
 *       合成音频（AudioEncoder AAC）→ mp4box mux → 输出 MP4。
 * 流式处理：分批解码/编码，避免整段帧驻留内存。
 *
 * 依赖：lib/mp4box.global.js（MP4Box.js 0.5.x，全局 MP4Box）、WebCodecs（Chrome/Edge）。
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

  const AUDIO_CODEC = 'mp4a.40.2';

  /** 获取 MP4Box 全局。 */
  function getMP4Box() {
    if (typeof window === 'undefined') return null;
    return window.MP4Box || window.mp4box || null;
  }

  function supportsWebCodecs() {
    return (
      typeof window !== 'undefined' &&
      typeof window.VideoEncoder === 'function' &&
      typeof window.VideoDecoder === 'function' &&
      typeof window.AudioEncoder === 'function' &&
      !!getMP4Box()
    );
  }

  /**
   * 从 avcC box 对象构造 avcC 配置记录字节。
   * 0.5.x 结构：SPS[i] = {length, nalu}。
   */
  function buildAvcCFromBox(avcC) {
    try {
      const spsList = avcC.SPS || [];
      const ppsList = avcC.PPS || [];
      if (!spsList.length || !ppsList.length) return null;
      const sps = spsList[0].nalu || spsList[0];
      const pps = ppsList[0].nalu || ppsList[0];
      if (!sps || !pps) return null;
      const out = new Uint8Array(11 + sps.length + pps.length);
      out[0] = 1;
      out[1] = avcC.AVCProfileIndication != null ? avcC.AVCProfileIndication : sps[1];
      out[2] = avcC.profile_compatibility != null ? avcC.profile_compatibility : sps[2];
      out[3] = avcC.AVCLevelIndication != null ? avcC.AVCLevelIndication : sps[3];
      out[4] = 0xff;
      out[5] = 0xe1;
      out[6] = sps.length >> 8;
      out[7] = sps.length & 0xff;
      out.set(sps, 8);
      out[8 + sps.length] = 1;
      out[9 + sps.length] = pps.length >> 8;
      out[10 + sps.length] = pps.length & 0xff;
      out.set(pps, 11 + sps.length);
      return out;
    } catch (e) {
      return null;
    }
  }

  /** Box 对象 → 原始字节（Uint8Array）。 */
  function boxToBytes(box) {
    if (box && box.data && box.data.buffer) return box.data;
    return null;
  }

  /**
   * demux MP4：返回视频轨信息与全部样本（含解码描述）。
   * @param {ArrayBuffer} buf
   * @returns {Promise<object>}
   */
  function demuxMp4(buf) {
    return new Promise((resolve, reject) => {
      const MP4Box = getMP4Box();
      const file = MP4Box.createFile();
      let videoTrack = null;
      let samples = [];
      let width = 0;
      let height = 0;
      let description = null;
      let timescale = 1;
      let ready = false;

      file.onReady = (info) => {
        const vt = info.videoTracks && info.videoTracks[0];
        if (!vt) {
          reject(new Error('文件中没有视频轨道（仅支持 MP4/MOV）'));
          return;
        }
        videoTrack = vt;
        width = vt.video && vt.video.width;
        height = vt.video && vt.video.height;
        timescale = vt.timescale || 1000;
        const track = file.getTrackById(vt.id);
        if (track) {
          const stsd = track.mdia && track.mdia.minf && track.mdia.minf.stbl && track.mdia.minf.stbl.stsd;
          const entry = stsd && stsd.entries && stsd.entries[0];
          if (entry && entry.avcC) description = buildAvcCFromBox(entry.avcC);
          if (!description && entry && entry.hvcC) description = boxToBytes(entry.hvcC);
          if (!description && entry && entry.vpcC) description = boxToBytes(entry.vpcC);
        }
        file.setExtractionOptions(vt.id, null, { nbSamples: Infinity });
        file.start();
      };

      file.onSamples = (trackId, user, s) => {
        samples = s;
        if (!ready) {
          ready = true;
          resolve({
            id: trackId,
            codec: videoTrack && videoTrack.codec,
            width,
            height,
            timescale,
            samples,
            description,
          });
        }
      };

      buf.fileStart = 0; // mp4box 0.5.x 约定
      file.appendBuffer(buf);
      file.flush();
      setTimeout(() => {
        if (!ready) reject(new Error('无法解析 MP4 样本（文件可能损坏或不受支持）'));
      }, 10000);
    });
  }

  /**
   * 主入口：视频合成导出。
   * @param {object} opts
   * @param {File} opts.file 原视频文件
   * @param {Array} opts.parts 序列渲染 parts（样本索引）
   * @param {Float32Array} opts.mix 合成音频（mono PCM）
   * @param {number} opts.mixSampleRate
   * @param {string} opts.fileName 输出文件名（不含扩展名）
   * @param {(p:number)=>void} [opts.onProgress]
   */
  async function exportVideo(opts) {
    if (!supportsWebCodecs()) throw new Error('当前浏览器不支持 WebCodecs 视频合成');
    const { parts, mix, mixSampleRate, fileName } = opts;
    const buf = await opts.file.arrayBuffer();

    const progress = (p) => {
      if (opts.onProgress) opts.onProgress(Math.min(0.99, p));
    };
    const done = () => {
      if (opts.onProgress) opts.onProgress(1);
    };

    progress(0.02);
    const src = await demuxMp4(buf);
    if (!src.samples.length) throw new Error('视频轨道为空');
    if (!src.description) throw new Error('无法获取视频解码描述（avcC），不支持该编码');

    const windows = parts.map((p) => [p.start / mixSampleRate, p.end / mixSampleRate]);
    const keepTime = (sec) => windows.some(([s, e]) => sec >= s - 0.0001 && sec < e);
    const outTsUs = (sec) => {
      let acc = 0;
      for (const [s, e] of windows) {
        if (sec < e) return Math.round((acc + Math.max(0, sec - s)) * 1e6);
        acc += e - s;
      }
      return Math.round(acc * 1e6);
    };

    // 3. mp4-muxer 输出容器
    const Mp4Muxer = window.Mp4Muxer;
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: src.width, height: src.height },
      audio: { codec: 'aac', numberOfChannels: 1, sampleRate: mixSampleRate },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    const audioChunks = [];
    if (mix.length) {
      const audioEncoder = new AudioEncoder({
        output: (chunk) => audioChunks.push(chunk),
        error: (e) => {
          throw new Error('音频编码失败：' + e.message);
        },
      });
      audioEncoder.configure({
        codec: AUDIO_CODEC,
        sampleRate: mixSampleRate,
        numberOfChannels: 1,
        bitrate: 128000,
      });
      const frameDur = Math.round(mixSampleRate / 44);
      for (let i = 0; i < mix.length; i += frameDur) {
        const n = Math.min(frameDur, mix.length - i);
        const f = new AudioData({
          format: 'f32-planar',
          sampleRate: mixSampleRate,
          numberOfFrames: n,
          numberOfChannels: 1,
          timestamp: Math.round((i / mixSampleRate) * 1e6),
          data: mix.subarray(i, i + n),
        });
        audioEncoder.encode(f);
        f.close();
      }
      await audioEncoder.flush();
    }

    const encodedVideo = [];
    let encError = null;
    const encVideo = new VideoEncoder({
      output: (chunk) => encodedVideo.push(chunk),
      error: (e) => {
        encError = new Error('视频编码失败：' + e.message);
      },
    });
    encVideo.configure({
      codec: src.codec,
      width: src.width,
      height: src.height,
      bitrate: 6_000_000,
      framerate: 30,
      avc: { format: 'avc' },
    });

    let lastOutUs = -1;
    let frameCount = 0;
    const totalFrames = src.samples.length;

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const sec = frame.timestamp / 1e6;
          if (keepTime(sec)) {
            const t = Math.max(outTsUs(sec), lastOutUs + 1);
            lastOutUs = t;
            const outFrame = new VideoFrame(frame, { timestamp: t });
            encVideo.encode(outFrame);
            outFrame.close();
            frameCount++;
            if (frameCount % 60 === 0) progress(0.05 + 0.75 * (frameCount / totalFrames));
          }
          frame.close();
        } catch (e) {
          encError = e;
        }
      },
      error: (e) => {
        encError = new Error('视频解码失败：' + e.message);
      },
    });
    decoder.configure({
      codec: src.codec,
      codedWidth: src.width,
      codedHeight: src.height,
      description: src.description,
    });

    // flush() 后 VideoDecoder 要求下一个 chunk 必须是关键帧；跳过 delta 帧
    // 直到下一个关键帧，避免 "A key frame is required after configure() or flush()"
    let needKey = false;
    for (let i = 0; i < src.samples.length; i++) {
      const smp = src.samples[i];
      if (needKey && !smp.is_sync) continue; // 等待关键帧
      needKey = false;
      const chunk = new EncodedVideoChunk({
        type: smp.is_sync ? 'key' : 'delta',
        timestamp: Math.round((smp.cts / src.timescale) * 1e6),
        duration: Math.round((smp.duration / src.timescale) * 1e6),
        data: smp.data,
      });
      decoder.decode(chunk);
      if (i > 0 && i % 120 === 0) {
        await decoder.flush();
        await encVideo.flush();
        needKey = true;
      }
    }
    await decoder.flush();
    await encVideo.flush();
    if (encError) throw encError;

    // 6. mux 样本
    for (const c of encodedVideo) {
      muxer.addVideoChunk(c, {
        timestamp: c.timestamp,
        duration: c.duration,
        type: c.type,
        decoderConfig: { codec: src.codec, codedWidth: src.width, codedHeight: src.height, description: src.description },
      });
    }
    for (const c of audioChunks) {
      muxer.addAudioChunk(c, {
        timestamp: c.timestamp,
        duration: c.duration,
        type: c.type,
        decoderConfig: { codec: AUDIO_CODEC, sampleRate: mixSampleRate, numberOfChannels: 1 },
      });
    }
    muxer.finalize();

    progress(0.97);
    const out = muxer.target.buffer;
    const blob = new Blob([out], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName + '.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    done();
  }

  return { exportVideo, supportsWebCodecs, demuxMp4 };
});
