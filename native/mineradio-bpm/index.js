// index.js
// Native addon 加载 + JS 对照实现（算法与 C++ 版完全一致）
'use strict';

let native = null;
try {
  // bindings 会自动找到 build/Release/bpm_native.node
  native = require('bindings')('bpm_native.node');
} catch (e) {
  native = null;
}

// ============ JS 纯实现（对照版）============
// 与 C++ bpm.h 算法完全一致，公平对比

function jsFFT(re, im) {
  const n = re.length;
  if (n <= 1) return;
  // 位反转
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // 蝶形
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlenRe = Math.cos(ang), wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const tRe = re[i + j + half], tIm = im[i + j + half];
        const vRe = tRe * wRe - tIm * wIm;
        const vIm = tRe * wIm + tIm * wRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe; im[i + j + half] = uIm - vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
}

function jsHannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  }
  return w;
}

function jsDownsample(src, srcRate, dstRate) {
  if (srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const outN = Math.floor(src.length / ratio);
  const out = new Float32Array(outN);
  for (let i = 0; i < outN; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = srcPos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

function jsAnalyzeBPM(pcm, sampleRate) {
  const t0 = performance.now();

  // 1. 下采样到 22050Hz
  const targetRate = 22050;
  const mono = jsDownsample(pcm, sampleRate, targetRate);
  const sr = targetRate;
  const N = mono.length;

  // 2. 分帧
  const winSize = 1024;
  const hopSize = 512;
  const nFrames = Math.max(0, Math.floor((N - winSize) / hopSize) + 1);
  if (nFrames < 20) {
    return { bpm: 0, confidence: 0, framesAnalyzed: nFrames, elapsedMs: 0, engine: 'js' };
  }

  // 3. Hann 窗
  const window = jsHannWindow(winSize);

  // 4. 逐帧 FFT + 频谱通量
  const lowBins = 10;
  const prevMag = new Float32Array(lowBins);
  const flux = new Float32Array(nFrames);
  const re = new Float32Array(winSize);
  const im = new Float32Array(winSize);

  for (let f = 0; f < nFrames; f++) {
    const offset = f * hopSize;
    for (let i = 0; i < winSize; i++) {
      re[i] = mono[offset + i] * window[i];
      im[i] = 0;
    }
    jsFFT(re, im);

    let sumFlux = 0;
    for (let b = 0; b < lowBins; b++) {
      const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      const diff = mag - prevMag[b];
      if (diff > 0) sumFlux += diff;
      prevMag[b] = mag;
    }
    flux[f] = sumFlux;
  }

  // 5. 自相关
  const frameRate = sr / hopSize;
  const lagLo = Math.max(8, Math.floor(frameRate * 60 / 180));
  const lagHi = Math.min(Math.floor(nFrames / 2), Math.floor(frameRate * 60 / 60));

  const autocorr = new Float32Array(lagHi + 1);
  let maxAc = 0, bestLag = lagLo, sumAc = 0, cntAc = 0;
  for (let lag = lagLo; lag <= lagHi; lag++) {
    let s = 0;
    for (let i = lag; i < nFrames; i++) {
      s += flux[i] * flux[i - lag];
    }
    const ac = s / (nFrames - lag);
    autocorr[lag] = ac;
    sumAc += ac;
    cntAc++;
    if (ac > maxAc) {
      maxAc = ac;
      bestLag = lag;
    }
  }

  const meanAc = cntAc > 0 ? sumAc / cntAc : 0.001;
  const confidence = meanAc > 0.001 ? maxAc / meanAc : 0;

  // Octave 校正：检查 bestLag/2 和 bestLag/3 是否也有显著峰值
  for (let div = 2; div <= 3; div++) {
    const shorterLag = Math.floor(bestLag / div);
    if (shorterLag >= lagLo && autocorr[shorterLag] > maxAc * 0.55) {
      bestLag = shorterLag;
      break;
    }
  }

  const bpm = frameRate * 60 / bestLag;

  const t1 = performance.now();
  return { bpm, confidence, framesAnalyzed: nFrames, elapsedMs: t1 - t0, engine: 'js' };
}

function jsFftBenchmark(fftSize, iterations) {
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    re[i] = Math.random() * 2 - 1;
    im[i] = Math.random() * 2 - 1;
  }
  const t0 = performance.now();
  for (let it = 0; it < iterations; it++) {
    // 复制后变换（和 C++ 一致）
    const tr = new Float32Array(re);
    const ti = new Float32Array(im);
    jsFFT(tr, ti);
  }
  const t1 = performance.now();
  return {
    elapsedMs: t1 - t0,
    totalOps: iterations,
    fftSize: fftSize,
    opsPerSec: iterations / ((t1 - t0) / 1000),
    engine: 'js'
  };
}

// ============ 导出 ============
module.exports = {
  native: native,
  isNativeAvailable: !!native,
  // 优先 native，回退 js
  analyzeBPM: function (pcm, sampleRate) {
    if (native) return native.analyzeBPM(pcm, sampleRate);
    return jsAnalyzeBPM(pcm, sampleRate);
  },
  fftBenchmark: function (fftSize, iterations) {
    if (native) return native.fftBenchmark(fftSize, iterations);
    return jsFftBenchmark(fftSize, iterations);
  },
  analyzeDjPcm: function (pcm, sampleRate, hopSec) {
    if (native && typeof native.analyzeDjPcm === 'function') {
      return native.analyzeDjPcm(pcm, sampleRate, hopSec == null ? 0.01 : hopSec);
    }
    return null;
  },
  djEnergyCreate: function (sampleRate, hopSec) {
    if (native && typeof native.djEnergyCreate === 'function') {
      return native.djEnergyCreate(sampleRate, hopSec == null ? 0.01 : hopSec);
    }
    return null;
  },
  djEnergyPushStereo: function (handle, left, right) {
    if (native && handle && typeof native.djEnergyPushStereo === 'function') {
      native.djEnergyPushStereo(handle, left, right);
    }
  },
  djEnergyFinish: function (handle) {
    if (native && handle && typeof native.djEnergyFinish === 'function') {
      return native.djEnergyFinish(handle);
    }
    return null;
  },
  buildBeatMapFromLowEnergy: function (lowEnergy, hitEnergy, hopSec, durationSec) {
    if (native && typeof native.buildBeatMapFromLowEnergy === 'function') {
      return native.buildBeatMapFromLowEnergy(lowEnergy, hitEnergy, hopSec, durationSec == null ? 0 : durationSec);
    }
    return null;
  },
  wasapiAvailable: function () {
    return !!(native && typeof native.wasapiAvailable === 'function' && native.wasapiAvailable());
  },
  wasapiCreate: function (sampleRate, channels) {
    if (native && typeof native.wasapiCreate === 'function') return native.wasapiCreate(sampleRate || 48000, channels || 2);
    return null;
  },
  wasapiStart: function (handle) {
    if (native && handle && typeof native.wasapiStart === 'function') return native.wasapiStart(handle);
    return false;
  },
  wasapiStop: function (handle) {
    if (native && handle && typeof native.wasapiStop === 'function') return native.wasapiStop(handle);
    return false;
  },
  wasapiClose: function (handle) {
    if (native && handle && typeof native.wasapiClose === 'function') return native.wasapiClose(handle);
    return false;
  },
  wasapiWrite: function (handle, interleavedFloat32) {
    if (native && handle && typeof native.wasapiWrite === 'function') return native.wasapiWrite(handle, interleavedFloat32);
    return 0;
  },
  wasapiSetVolume: function (handle, volume) {
    if (native && handle && typeof native.wasapiSetVolume === 'function') return native.wasapiSetVolume(handle, volume);
    return false;
  },
  wasapiStatus: function (handle) {
    if (native && typeof native.wasapiStatus === 'function') return native.wasapiStatus(handle == null ? null : handle);
    return { available: false, running: false };
  },
  // 暴露 JS 版用于对照测试
  jsAnalyzeBPM: jsAnalyzeBPM,
  jsFftBenchmark: jsFftBenchmark,
  version: native ? native.version() : 'js-fallback (native not built)'
};
