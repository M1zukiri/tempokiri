/**
 * make_test_track.js — 生成测试音频（120 BPM 合成节拍，8 小节）。
 * 用法：node make_test_track.js [输出路径]
 */
const fs = require('fs');
const E = require('../src/export.js');
const A = require('../src/analysis.js');

const SR = 44100;
const BPM = 120;
const BARS = 8;
const BEATS = 4;
const beat = 60 / BPM;
const total = beat * BEATS * BARS; // 16s

const pcm = new Float32Array(Math.round(SR * total));

function addNoiseBurst(startSec, durSec, amp) {
  const s = Math.round(startSec * SR);
  const n = Math.round(durSec * SR);
  for (let i = 0; i < n && s + i < pcm.length; i++) {
    pcm[s + i] += (Math.random() * 2 - 1) * amp;
  }
}

function addTone(startSec, freq, durSec, amp) {
  const s = Math.round(startSec * SR);
  const n = Math.round(durSec * SR);
  for (let i = 0; i < n && s + i < pcm.length; i++) {
    pcm[s + i] += Math.sin((2 * Math.PI * freq * i) / SR) * amp * (1 - i / n);
  }
}

// 每拍：短噪声（hi-hat）；每小节第一拍：低音
for (let bar = 0; bar < BARS; bar++) {
  for (let b = 0; b < BEATS; b++) {
    const t = (bar * BEATS + b) * beat;
    addNoiseBurst(t, 0.04, 0.25);
    if (b === 0) addTone(t, 110, beat * 0.9, 0.5);
    else if (b === 2) addTone(t, 165, beat * 0.5, 0.3);
  }
}

const buf = E.encodeWav(pcm, SR);
const out = process.argv[2] || 'test_track.wav';
fs.writeFileSync(out, Buffer.from(buf));
console.log('已生成', out, '(' + (buf.byteLength / 1024).toFixed(0) + ' KB,', BPM, 'BPM,', total.toFixed(1) + 's)');

// 自检：分析生成的文件
const A2 = require('../src/analysis.js');
const y = new Float32Array(pcm);
const r = A2.analyze(y, { sampleRate: SR });
console.log('自检 BPM 检测:', r.bpm ? r.bpm.toFixed(1) : 'null', '(期望 ~120)');
