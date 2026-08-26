// test/benchmark.js
// JS vs Native BPM 分析对比基准
'use strict';

const bpm = require('../index.js');

// ============ 生成测试信号 ============
// 模拟 120 BPM 鼓点：每拍一个 80Hz 低频脉冲（kick drum）
function generateTestSignal(sampleRate, durationSec, targetBPM) {
  const N = Math.floor(sampleRate * durationSec);
  const pcm = new Float32Array(N);
  const beatInterval = sampleRate * 60 / targetBPM; // 每拍样本数
  const kickDuration = Math.floor(sampleRate * 0.08); // kick 持续 80ms

  for (let beat = 0; beat * beatInterval < N; beat++) {
    const start = Math.floor(beat * beatInterval);
    for (let i = 0; i < kickDuration && start + i < N; i++) {
      const t = i / sampleRate;
      // 80Hz 正弦 × 指数衰减 = kick drum
      const env = Math.exp(-t * 30);
      pcm[start + i] += Math.sin(2 * Math.PI * 80 * t) * env * 0.8;
    }
  }
  // 加少量白噪声 + 背景谐波，避免空信号
  for (let i = 0; i < N; i++) {
    pcm[i] += (Math.random() - 0.5) * 0.02;
    pcm[i] += Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.01;
  }
  return pcm;
}

// ============ 生成真实音频场景信号 ============
// 模拟更复杂的音乐：贝斯线 + hi-hat + kick
function generateComplexSignal(sampleRate, durationSec, targetBPM) {
  const N = Math.floor(sampleRate * durationSec);
  const pcm = new Float32Array(N);
  const beatInterval = sampleRate * 60 / targetBPM;
  const halfBeat = beatInterval / 2;

  for (let beat = 0; beat * beatInterval < N; beat++) {
    const bs = Math.floor(beat * beatInterval);
    // kick (80Hz)
    const kd = Math.floor(sampleRate * 0.1);
    for (let i = 0; i < kd && bs + i < N; i++) {
      const t = i / sampleRate;
      pcm[bs + i] += Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 25) * 0.7;
    }
    // snare on off-beat (200Hz + 噪声)
    const ss = Math.floor(bs + halfBeat);
    const sd = Math.floor(sampleRate * 0.06);
    for (let i = 0; i < sd && ss + i < N; i++) {
      const t = i / sampleRate;
      pcm[ss + i] += (Math.sin(2 * Math.PI * 200 * t) * 0.3 + (Math.random() - 0.5) * 0.4) * Math.exp(-t * 40);
    }
    // hi-hat 每个 half-beat
    for (let h = 0; h < 2; h++) {
      const hs = Math.floor(bs + h * halfBeat);
      const hd = Math.floor(sampleRate * 0.03);
      for (let i = 0; i < hd && hs + i < N; i++) {
        const t = i / sampleRate;
        pcm[hs + i] += (Math.random() - 0.5) * 0.15 * Math.exp(-t * 80);
      }
    }
  }
  // 贝斯线
  for (let i = 0; i < N; i++) {
    const t = i / sampleRate;
    pcm[i] += Math.sin(2 * Math.PI * 110 * t) * 0.08 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t));
  }
  return pcm;
}

// ============ 运行基准 ============
function runBenchmark() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Mineradio BPM 原生 vs JS 对比基准');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  引擎版本:', bpm.version);
  console.log('  Native 可用:', bpm.isNativeAvailable ? '是 ✓' : '否 ✗ (仅跑 JS)');
  console.log('');

  const sampleRate = 44100;
  const durationSec = 30; // 30 秒
  const targetBPM = 120;
  const runs = 5;

  // --- 测试 1: 简单鼓点 ---
  console.log('▶ 测试 1: 简单鼓点信号 (120 BPM, 30s, 44.1kHz)');
  const simplePcm = generateTestSignal(sampleRate, durationSec, targetBPM);
  console.log('  信号长度:', simplePcm.length, 'samples,', (simplePcm.length * 4 / 1024 / 1024).toFixed(1), 'MB');
  console.log('');

  if (bpm.isNativeAvailable) {
    const jsResults = [], nativeResults = [];
    // 预热
    bpm.jsAnalyzeBPM(simplePcm, sampleRate);
    bpm.native.analyzeBPM(simplePcm, sampleRate);

    for (let i = 0; i < runs; i++) {
      const jsR = bpm.jsAnalyzeBPM(simplePcm, sampleRate);
      jsResults.push(jsR.elapsedMs);
      const nR = bpm.native.analyzeBPM(simplePcm, sampleRate);
      nativeResults.push(nR.elapsedMs);
    }
    const jsAvg = jsResults.reduce((a, b) => a + b) / runs;
    const nAvg = nativeResults.reduce((a, b) => a + b) / runs;
    const speedup = jsAvg / nAvg;

    console.log('  JS 版平均耗时:    ', jsAvg.toFixed(2), 'ms  (', jsResults.map(x => x.toFixed(1)).join(', '), ')');
    console.log('  Native 版平均耗时:', nAvg.toFixed(2), 'ms  (', nativeResults.map(x => x.toFixed(1)).join(', '), ')');
    console.log('  加速比:           ', speedup.toFixed(2) + 'x');
    console.log('');

    // BPM 准确性
    const jsBpm = bpm.jsAnalyzeBPM(simplePcm, sampleRate);
    const nBpm = bpm.native.analyzeBPM(simplePcm, sampleRate);
    console.log('  JS BPM:    ', jsBpm.bpm.toFixed(1), '(置信度', jsBpm.confidence.toFixed(2) + ')');
    console.log('  Native BPM:', nBpm.bpm.toFixed(1), '(置信度', nBpm.confidence.toFixed(2) + ')');
    console.log('  目标 BPM:  ', targetBPM);
    console.log('');
  } else {
    const jsR = bpm.jsAnalyzeBPM(simplePcm, sampleRate);
    console.log('  JS 版耗时:', jsR.elapsedMs.toFixed(2), 'ms');
    console.log('  JS BPM:   ', jsR.bpm.toFixed(1), '(置信度', jsR.confidence.toFixed(2) + ')');
    console.log('  (编译 native 后才能对比)');
    console.log('');
  }

  // --- 测试 2: 复杂音乐信号 ---
  console.log('▶ 测试 2: 复杂音乐信号 (kick+snare+hihat+bass, 120 BPM, 30s)');
  const complexPcm = generateComplexSignal(sampleRate, durationSec, targetBPM);
  console.log('  信号长度:', complexPcm.length, 'samples');
  console.log('');

  if (bpm.isNativeAvailable) {
    const jsResults = [], nativeResults = [];
    for (let i = 0; i < runs; i++) {
      const jsR = bpm.jsAnalyzeBPM(complexPcm, sampleRate);
      jsResults.push(jsR.elapsedMs);
      const nR = bpm.native.analyzeBPM(complexPcm, sampleRate);
      nativeResults.push(nR.elapsedMs);
    }
    const jsAvg = jsResults.reduce((a, b) => a + b) / runs;
    const nAvg = nativeResults.reduce((a, b) => a + b) / runs;
    const speedup = jsAvg / nAvg;

    console.log('  JS 版平均耗时:    ', jsAvg.toFixed(2), 'ms');
    console.log('  Native 版平均耗时:', nAvg.toFixed(2), 'ms');
    console.log('  加速比:           ', speedup.toFixed(2) + 'x');
    console.log('');

    const jsBpm = bpm.jsAnalyzeBPM(complexPcm, sampleRate);
    const nBpm = bpm.native.analyzeBPM(complexPcm, sampleRate);
    console.log('  JS BPM:    ', jsBpm.bpm.toFixed(1), '(置信度', jsBpm.confidence.toFixed(2) + ')');
    console.log('  Native BPM:', nBpm.bpm.toFixed(1), '(置信度', nBpm.confidence.toFixed(2) + ')');
    console.log('');
  } else {
    const jsR = bpm.jsAnalyzeBPM(complexPcm, sampleRate);
    console.log('  JS 版耗时:', jsR.elapsedMs.toFixed(2), 'ms');
    console.log('  JS BPM:   ', jsR.bpm.toFixed(1));
    console.log('');
  }

  // --- 测试 3: 纯 FFT 基准 ---
  console.log('▶ 测试 3: 纯 FFT 性能 (1024点, 1000次迭代)');
  const fftRuns = 3;
  if (bpm.isNativeAvailable) {
    const jsFft = [], nFft = [];
    for (let i = 0; i < fftRuns; i++) {
      jsFft.push(bpm.jsFftBenchmark(1024, 1000).elapsedMs);
      nFft.push(bpm.native.fftBenchmark(1024, 1000).elapsedMs);
    }
    const jsAvg = jsFft.reduce((a, b) => a + b) / fftRuns;
    const nAvg = nFft.reduce((a, b) => a + b) / fftRuns;
    console.log('  JS FFT 1000次:    ', jsAvg.toFixed(2), 'ms  (', (1000 / (jsAvg / 1000)).toFixed(0), ' ops/s)');
    console.log('  Native FFT 1000次:', nAvg.toFixed(2), 'ms  (', (1000 / (nAvg / 1000)).toFixed(0), ' ops/s)');
    console.log('  FFT 加速比:       ', (jsAvg / nAvg).toFixed(2) + 'x');
    console.log('');

    // 4096 点
    console.log('▶ 测试 4: 纯 FFT 性能 (4096点, 500次迭代)');
    const jsFft4 = bpm.jsFftBenchmark(4096, 500);
    const nFft4 = bpm.native.fftBenchmark(4096, 500);
    console.log('  JS FFT 500次:    ', jsFft4.elapsedMs.toFixed(2), 'ms  (', jsFft4.opsPerSec.toFixed(0), ' ops/s)');
    console.log('  Native FFT 500次:', nFft4.elapsedMs.toFixed(2), 'ms  (', nFft4.opsPerSec.toFixed(0), ' ops/s)');
    console.log('  FFT 加速比:      ', (jsFft4.elapsedMs / nFft4.elapsedMs).toFixed(2) + 'x');
    console.log('');
  } else {
    const jsFft = bpm.jsFftBenchmark(1024, 1000);
    console.log('  JS FFT 1000次:', jsFft.elapsedMs.toFixed(2), 'ms  (', jsFft.opsPerSec.toFixed(0), ' ops/s)');
    console.log('');
  }

  // --- 长信号测试 ---
  console.log('▶ 测试 5: 长信号 (3分钟, 模拟完整歌曲)');
  const longPcm = generateComplexSignal(sampleRate, 180, targetBPM);
  console.log('  信号长度:', longPcm.length, 'samples,', (longPcm.length * 4 / 1024 / 1024).toFixed(1), 'MB');
  if (bpm.isNativeAvailable) {
    const t0 = performance.now();
    const jsR = bpm.jsAnalyzeBPM(longPcm, sampleRate);
    const jsT = performance.now() - t0;
    const t1 = performance.now();
    const nR = bpm.native.analyzeBPM(longPcm, sampleRate);
    const nT = performance.now() - t1;
    console.log('  JS 版:    ', jsT.toFixed(2), 'ms  BPM:', jsR.bpm.toFixed(1));
    console.log('  Native 版:', nT.toFixed(2), 'ms  BPM:', nR.bpm.toFixed(1));
    console.log('  加速比:   ', (jsT / nT).toFixed(2) + 'x');
  } else {
    const t0 = performance.now();
    const jsR = bpm.jsAnalyzeBPM(longPcm, sampleRate);
    console.log('  JS 版:', (performance.now() - t0).toFixed(2), 'ms  BPM:', jsR.bpm.toFixed(1));
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════');
  if (bpm.isNativeAvailable) {
    console.log('  结论: Native addon 已就绪，对比数据见上');
  } else {
    console.log('  ⚠ Native addon 未编译，当前仅显示 JS 基准数据');
    console.log('  编译步骤:');
    console.log('    1. 安装 VS Build Tools 2022 (带 C++ 工作负载)');
    console.log('    2. cd native/mineradio-bpm');
    console.log('    3. npm install');
    console.log('    4. npm run rebuild:electron');
    console.log('    5. node test/benchmark.js');
  }
  console.log('═══════════════════════════════════════════════════════════════');
}

runBenchmark();
