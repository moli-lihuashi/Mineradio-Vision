'use strict';
// DJ energy: JS vs C++ 对照基准（算法与 dj-analyzer.js 对齐）
const path = require('path');
const bpm = require('..');
const dj = require(path.join(__dirname, '..', '..', '..', 'dj-analyzer.js'));

function synthKickPcm(seconds, sampleRate) {
  const n = Math.floor(seconds * sampleRate);
  const pcm = new Float32Array(n);
  const period = Math.floor(sampleRate * 0.5);
  for (let i = 0; i < n; i++) {
    const phase = i % period;
    const env = phase < sampleRate * 0.04 ? Math.exp(-phase / (sampleRate * 0.012)) : 0.02;
    pcm[i] = Math.sin(2 * Math.PI * 55 * i / sampleRate) * env
      + Math.sin(2 * Math.PI * 110 * i / sampleRate) * env * 0.35
      + (Math.random() * 2 - 1) * 0.01;
  }
  return pcm;
}

function makeBiquad(type, freq, q, sr) {
  freq = Math.max(8, Math.min(freq, sr * 0.45));
  const w0 = 2 * Math.PI * freq / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * (q || 0.707));
  let b0, b1, b2;
  if (type === 'highpass') {
    b0 = (1 + cos) * 0.5; b1 = -(1 + cos); b2 = (1 + cos) * 0.5;
  } else {
    b0 = (1 - cos) * 0.5; b1 = 1 - cos; b2 = (1 - cos) * 0.5;
  }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha, inv = 1 / a0;
  return { b0: b0 * inv, b1: b1 * inv, b2: b2 * inv, a1: a1 * inv, a2: a2 * inv, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function runBiquad(st, x) {
  const y = st.b0 * x + st.b1 * st.x1 + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2;
  st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
  return y;
}

function jsAnalyzeDjPcm(pcm, sampleRate, hopSec) {
  const sampleStep = sampleRate >= 44100 ? 4 : (sampleRate >= 32000 ? 3 : 2);
  const effectiveSr = sampleRate / sampleStep;
  const hopSize = Math.max(80, Math.floor(effectiveSr * hopSec));
  const hp = makeBiquad('highpass', 32, 0.72, effectiveSr);
  const lp = makeBiquad('lowpass', 178, 0.82, effectiveSr);
  const lowEnergy = [];
  const hitEnergy = [];
  let frameSum = 0, framePeak = 0, frameCount = 0;
  const t0 = performance.now();
  for (let i = 0; i < pcm.length; i += sampleStep) {
    const y = runBiquad(lp, runBiquad(hp, pcm[i]));
    const ay = Math.abs(y);
    frameSum += y * y;
    if (ay > framePeak) framePeak = ay;
    frameCount++;
    if (frameCount >= hopSize) {
      lowEnergy.push(Math.sqrt(frameSum / Math.max(1, frameCount)));
      hitEnergy.push(framePeak);
      frameSum = 0; framePeak = 0; frameCount = 0;
    }
  }
  if (frameCount > 0) {
    lowEnergy.push(Math.sqrt(frameSum / Math.max(1, frameCount)));
    hitEnergy.push(framePeak);
  }
  return { lowEnergy, hitEnergy, frames: lowEnergy.length, elapsedMs: performance.now() - t0, engine: 'js' };
}

function diffStats(a, b) {
  const n = Math.min(a.length, b.length);
  let max = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs((a[i] || 0) - (b[i] || 0));
    sum += d;
    if (d > max) max = d;
  }
  return { max, mean: n ? sum / n : 0, n };
}

function main() {
  if (!bpm.isNativeAvailable) {
    console.error('native addon not available');
    process.exit(1);
  }
  const sr = 44100;
  const hop = 0.01;
  const pcm = synthKickPcm(60, sr);

  const t0 = performance.now();
  const native = bpm.analyzeDjPcm(pcm, sr, hop);
  const wallNative = performance.now() - t0;
  const js = jsAnalyzeDjPcm(pcm, sr, hop);

  const low = diffStats(native.lowEnergy, js.lowEnergy);
  const hit = diffStats(native.hitEnergy, js.hitEnergy);
  const speedup = js.elapsedMs / Math.max(0.001, native.elapsedMs);

  console.log('=== DJ Energy benchmark (60s @ 44100) ===');
  console.log('native:', native.engine, 'frames=', native.frames, 'elapsedMs=', Number(native.elapsedMs).toFixed(2), 'wall=', wallNative.toFixed(2));
  console.log('js:    ', js.engine, 'frames=', js.frames, 'elapsedMs=', js.elapsedMs.toFixed(2));
  console.log('lowEnergy diff max/mean:', low.max.toFixed(6), low.mean.toFixed(6));
  console.log('hitEnergy  diff max/mean:', hit.max.toFixed(6), hit.mean.toFixed(6));
  console.log('speedup (js/native):', speedup.toFixed(2) + 'x');
  console.log('dj-analyzer nativeDjAvailable:', !!dj.nativeDjAvailable);

  if (native.frames !== js.frames || low.max > 1e-3 || hit.max > 1e-3) {
    console.error('FAIL parity');
    process.exit(1);
  }
  console.log('OK dj-energy parity');
}

main();
