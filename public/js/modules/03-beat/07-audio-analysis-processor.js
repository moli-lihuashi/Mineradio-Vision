// ============================================================
//  AudioWorklet Processor: 离主线程音频分析（从 PCM 自算 FFT）
//  - 不再依赖主线程 getByteFrequencyData + RAF 推送
//  - 输出与 11-main-loop 对齐的精简 features
// ============================================================

class MineradioAudioAnalysisProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'sensitivity', defaultValue: 1.0, minValue: 0.4, maxValue: 1.6, automationRate: 'k-rate' }
    ];
  }

  constructor(options) {
    super(options);
    this.fftSize = 2048;
    this.half = this.fftSize / 2;
    this.sampleRateHz = sampleRate;
    this.binHz = this.sampleRateHz / 2 / this.half;
    this.hopSec = 128 / this.sampleRateHz;

    this.pcmRing = new Float32Array(this.fftSize);
    this.pcmWrite = 0;
    this.pcmFilled = 0;
    this.window = new Float32Array(this.fftSize);
    for (var i = 0; i < this.fftSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.fftSize - 1));
    }
    this.fftRe = new Float32Array(this.fftSize);
    this.fftIm = new Float32Array(this.fftSize);
    this.mag = new Float32Array(this.half);
    this.bitrev = this.buildBitrev(this.fftSize);

    this.bandEdges = [
      { name: 'subBass', lo: 32, hi: 58, attack: 34, release: 10 },
      { name: 'bass', lo: 58, hi: 118, attack: 34, release: 10 },
      { name: 'lowMid', lo: 118, hi: 260, attack: 32, release: 9.5 },
      { name: 'mid', lo: 260, hi: 720, attack: 32, release: 9.5 },
      { name: 'highMid', lo: 720, hi: 1800, attack: 32, release: 9.5 },
      { name: 'presence', lo: 1800, hi: 4200, attack: 30, release: 9 },
      { name: 'brilliance', lo: 4200, hi: 9000, attack: 30, release: 9 },
      { name: 'air', lo: 9000, hi: 16000, attack: 30, release: 9 }
    ];
    this.bandBins = this.bandEdges.map((edge) => ({
      name: edge.name,
      start: Math.max(0, Math.round(edge.lo / this.binHz)),
      end: Math.min(this.half, Math.round(edge.hi / this.binHz)),
      attack: edge.attack,
      release: edge.release
    }));

    this.kickStart = 0;
    this.kickEnd = 7;
    this.vocalEnd = 140;
    this.midEnd = 280;
    this.autoKickBin = 3;
    this.autoTrack = true;

    this.smooth = {
      subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
      bKick: 0, voc: 0, mInst: 0, tHigh: 0, rms: 0
    };
    this.peak = { bass: 0.038, mid: 0.025, treble: 0.020, energy: 0.034 };
    this.prevEnergy = 0;
    this.smoothBass = 0;
    this.smoothMid = 0;
    this.smoothTreb = 0;
    this.smoothEnergy = 0;
    this.beatState = this.initBeatEngine();

    this.frameCounter = 0;
    this.framesPerMessage = Math.max(1, Math.round(0.016 / this.hopSec));
    this.pendingOutput = null;
    this.fftEvery = 4; // ~512 samples @ 128 quantum ≈ 每 11ms 一次 FFT
    this.quantumCount = 0;

    this.port.onmessage = (e) => {
      var type = e.data && e.data.type;
      var payload = e.data && e.data.payload;
      if (type === 'setKickRange' && payload) {
        this.autoTrack = !payload.manual;
        if (payload.manual) {
          this.kickStart = payload.start | 0;
          this.kickEnd = payload.end | 0;
        }
      } else if (type === 'reset') {
        this.resetState();
      }
    };
  }

  buildBitrev(n) {
    var out = new Uint16Array(n);
    var bits = Math.log2(n) | 0;
    for (var i = 0; i < n; i++) {
      var x = i, y = 0;
      for (var b = 0; b < bits; b++) {
        y = (y << 1) | (x & 1);
        x >>= 1;
      }
      out[i] = y;
    }
    return out;
  }

  initBeatEngine() {
    return {
      onsetBuffer: new Float32Array(128),
      onsetIdx: 0,
      onsetSum: 0,
      onsetSqSum: 0,
      lastOnsetTime: -1,
      lastBeatTime: -1,
      beatInterval: 0.5,
      tempo: 120,
      tempoConfidence: 0
    };
  }

  resetState() {
    this.smooth = {
      subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
      bKick: 0, voc: 0, mInst: 0, tHigh: 0, rms: 0
    };
    this.peak = { bass: 0.038, mid: 0.025, treble: 0.020, energy: 0.034 };
    this.prevEnergy = 0;
    this.smoothBass = 0; this.smoothMid = 0; this.smoothTreb = 0; this.smoothEnergy = 0;
    this.beatState = this.initBeatEngine();
    this.autoKickBin = 3;
    this.pcmWrite = 0;
    this.pcmFilled = 0;
  }

  follow(prev, next, attack, release) {
    var rate = next > prev ? attack : release;
    return prev + (next - prev) * (1 - Math.exp(-rate * this.hopSec));
  }

  pushPcm(channelData) {
    for (var i = 0; i < channelData.length; i++) {
      this.pcmRing[this.pcmWrite] = channelData[i] || 0;
      this.pcmWrite = (this.pcmWrite + 1) % this.fftSize;
      if (this.pcmFilled < this.fftSize) this.pcmFilled++;
    }
  }

  runFftToMag() {
    if (this.pcmFilled < this.fftSize) return false;
    var start = this.pcmWrite;
    for (var i = 0; i < this.fftSize; i++) {
      var s = this.pcmRing[(start + i) % this.fftSize] * this.window[i];
      var rev = this.bitrev[i];
      this.fftRe[rev] = s;
      this.fftIm[rev] = 0;
    }
    for (var size = 2; size <= this.fftSize; size <<= 1) {
      var half = size >> 1;
      var tableStep = this.fftSize / size;
      for (var i0 = 0; i0 < this.fftSize; i0 += size) {
        for (var j = 0; j < half; j++) {
          var k = j * tableStep;
          var angle = (-2 * Math.PI * k) / this.fftSize;
          var wr = Math.cos(angle);
          var wi = Math.sin(angle);
          var i1 = i0 + j;
          var i2 = i1 + half;
          var tr = wr * this.fftRe[i2] - wi * this.fftIm[i2];
          var ti = wr * this.fftIm[i2] + wi * this.fftRe[i2];
          this.fftRe[i2] = this.fftRe[i1] - tr;
          this.fftIm[i2] = this.fftIm[i1] - ti;
          this.fftRe[i1] += tr;
          this.fftIm[i1] += ti;
        }
      }
    }
    var inv = 1 / this.fftSize;
    for (var m = 0; m < this.half; m++) {
      var re = this.fftRe[m] * inv;
      var im = this.fftIm[m] * inv;
      // 近似 AnalyserNode getByteFrequencyData 归一化到 0..1
      var mag = Math.sqrt(re * re + im * im) * 8;
      this.mag[m] = mag > 1 ? 1 : mag;
    }
    return true;
  }

  computeBands(mag) {
    var bands = {};
    for (var bi = 0; bi < this.bandBins.length; bi++) {
      var b = this.bandBins[bi];
      var sum = 0, cnt = 0;
      for (var i = b.start; i < b.end; i++) {
        var v = mag[i] || 0;
        sum += v * v;
        cnt++;
      }
      bands[b.name] = cnt > 0 ? Math.sqrt(sum / cnt) : 0;
    }
    return bands;
  }

  computeLegacyBands(mag) {
    var bKick = 0, voc = 0, mInst = 0, tHigh = 0;
    var len = mag.length;
    var ks = this.kickStart, ke = this.kickEnd;
    var ve = Math.min(this.vocalEnd, len);
    var me = Math.min(this.midEnd, len);
    for (var i = 0; i < len; i++) {
      var v = mag[i];
      if (i >= ks && i < ke) bKick += v;
      else if (i >= ke && i < ve) voc += v;
      else if (i >= ve && i < me) mInst += v;
      else if (i >= me) tHigh += v;
    }
    bKick /= Math.max(1, ke - ks);
    voc /= Math.max(1, ve - ke);
    mInst /= Math.max(1, me - ve);
    tHigh /= Math.max(1, len - me);
    return { bKick: bKick, voc: voc, mInst: mInst, tHigh: tHigh };
  }

  updateAutoKick(mag) {
    if (!this.autoTrack) return;
    var searchHi = Math.min(16, mag.length);
    var peakBin = 3, peakVal = -1;
    for (var i = 0; i < searchHi; i++) {
      var v = mag[i];
      if (v > peakVal) { peakVal = v; peakBin = i; }
    }
    this.autoKickBin += (peakBin - this.autoKickBin) * 0.08;
    var cb = Math.round(this.autoKickBin);
    this.kickStart = Math.max(0, cb - 3);
    this.kickEnd = Math.min(searchHi, cb + 4);
  }

  detectOnset(lowEnergy) {
    var state = this.beatState;
    var now = currentTime;
    var o = lowEnergy;
    var old = state.onsetBuffer[state.onsetIdx];
    state.onsetSum += o - old;
    state.onsetSqSum += o * o - old * old;
    state.onsetBuffer[state.onsetIdx] = o;
    state.onsetIdx = (state.onsetIdx + 1) % state.onsetBuffer.length;
    var winN = state.onsetBuffer.length;
    var mean = state.onsetSum / winN;
    var std = Math.sqrt(Math.max(0, state.onsetSqSum / winN - mean * mean));
    var th = mean + std * 1.66 + lowEnergy * 0.0038;
    if (o > th && now - state.lastOnsetTime > 0.12) {
      state.lastOnsetTime = now;
      return { onset: true, strength: Math.min(1, (o - th) / Math.max(0.001, std)) };
    }
    return { onset: false, strength: 0 };
  }

  tickBeatEngine(lowEnergy, totalEnergy) {
    var state = this.beatState;
    var onset = this.detectOnset(lowEnergy);
    var now = currentTime;
    if (onset.onset) {
      if (state.lastBeatTime >= 0) {
        var interval = now - state.lastBeatTime;
        if (interval > 0.3 && interval < 2.5) {
          state.beatInterval = state.beatInterval * 0.8 + interval * 0.2;
          state.tempo = 60 / state.beatInterval;
          state.tempoConfidence = Math.min(1, state.tempoConfidence * 0.9 + 0.12);
        }
      }
      state.lastBeatTime = now;
    } else {
      state.tempoConfidence *= 0.995;
    }
    return {
      hit: onset.onset,
      time: now,
      strength: onset.strength,
      confidence: state.tempoConfidence,
      score: onset.strength * 0.6 + state.tempoConfidence * 0.4,
      low: lowEnergy,
      body: this.smooth.mid,
      snap: this.smooth.tHigh,
      mass: totalEnergy,
      sharpness: this.smooth.presence,
      combo: onset.strength,
      tempoAssist: state.tempo > 60 && state.tempo < 180,
      lowDominance: lowEnergy / Math.max(0.001, totalEnergy),
      tempoConfidence: state.tempoConfidence
    };
  }

  process(inputs, outputs, parameters) {
    var input = inputs[0];
    if (!input || !input.length || !input[0] || !input[0].length) return true;
    var channelData = input[0];
    var sensitivity = (parameters.sensitivity && parameters.sensitivity[0]) || 1.0;

    this.pushPcm(channelData);
    this.quantumCount++;

    var rms = 0;
    for (var i = 0; i < channelData.length; i++) {
      var v = channelData[i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / channelData.length);
    this.smooth.rms = this.follow(this.smooth.rms, rms, 30, 9);

    if (this.quantumCount % this.fftEvery === 0 && this.runFftToMag()) {
      var mag = this.mag;
      this.updateAutoKick(mag);
      var bands = this.computeBands(mag);
      for (var bi = 0; bi < this.bandBins.length; bi++) {
        var bb = this.bandBins[bi];
        this.smooth[bb.name] = this.follow(this.smooth[bb.name], bands[bb.name], bb.attack, bb.release);
      }
      var legacy = this.computeLegacyBands(mag);
      legacy.bKick *= sensitivity;
      this.smooth.bKick = this.follow(this.smooth.bKick, legacy.bKick, 34, 10);
      this.smooth.voc = this.follow(this.smooth.voc, legacy.voc, 32, 9.5);
      this.smooth.mInst = this.follow(this.smooth.mInst, legacy.mInst, 32, 9.5);
      this.smooth.tHigh = this.follow(this.smooth.tHigh, legacy.tHigh, 30, 9);

      this.peak.bass = Math.max(this.peak.bass * 0.994, this.smooth.bKick, 0.038);
      this.peak.mid = Math.max(this.peak.mid * 0.993, this.smooth.mInst, 0.025);
      this.peak.treble = Math.max(this.peak.treble * 0.992, this.smooth.tHigh, 0.020);
      this.peak.energy = Math.max(this.peak.energy * 0.995, this.smooth.rms, 0.034);

      var rb = Math.min(1, Math.pow(this.smooth.bKick / Math.max(0.038, this.peak.bass * 0.66), 0.78));
      var rm = Math.min(1, Math.pow(this.smooth.mInst / Math.max(0.025, this.peak.mid * 0.70), 0.86));
      var rt = Math.min(1, Math.pow(this.smooth.tHigh / Math.max(0.020, this.peak.treble * 0.74), 0.92));
      var re = Math.min(1, Math.pow(this.smooth.rms / Math.max(0.034, this.peak.energy * 0.68), 0.82));
      var bassOnset = Math.max(0, rb - this.smoothBass);
      var energyOnset = Math.max(0, re - this.prevEnergy);
      this.prevEnergy = this.prevEnergy * 0.88 + re * 0.12;
      var beatResult = this.tickBeatEngine(this.smooth.bass, re);

      this.smoothBass = this.follow(this.smoothBass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075);
      this.smoothMid = this.follow(this.smoothMid, Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.060);
      this.smoothTreb = this.follow(this.smoothTreb, Math.min(0.56, rt * 0.54), 0.18, 0.055);
      this.smoothEnergy = this.follow(this.smoothEnergy, Math.min(0.72, re), 0.16, 0.055);

      this.pendingOutput = {
        type: 'audioFeatures',
        payload: {
          sonicBands: {
            subBass: this.smooth.subBass, bass: this.smooth.bass, lowMid: this.smooth.lowMid, mid: this.smooth.mid,
            highMid: this.smooth.highMid, presence: this.smooth.presence, brilliance: this.smooth.brilliance, air: this.smooth.air
          },
          legacy: { bKick: this.smooth.bKick, voc: this.smooth.voc, mInst: this.smooth.mInst, tHigh: this.smooth.tHigh, rms: this.smooth.rms },
          features: {
            rb: rb, rm: rm, rt: rt, re: re,
            bassOnset: bassOnset, energyOnset: energyOnset,
            smoothBass: this.smoothBass, smoothMid: this.smoothMid, smoothTreb: this.smoothTreb, smoothEnergy: this.smoothEnergy,
            voc: this.smooth.voc
          },
          beat: beatResult,
          kickRange: [this.kickStart, this.kickEnd],
          autoKickBin: this.autoKickBin,
          tempo: this.beatState.tempo,
          tempoConfidence: this.beatState.tempoConfidence
        }
      };
    }

    this.frameCounter++;
    if (this.frameCounter >= this.framesPerMessage && this.pendingOutput) {
      this.port.postMessage(this.pendingOutput);
      this.pendingOutput = null;
      this.frameCounter = 0;
    }
    return true;
  }
}

registerProcessor('mineradio-audio-analysis', MineradioAudioAnalysisProcessor);
