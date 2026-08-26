(function (global) {
  'use strict';

  var NS = global.Mineradio = global.Mineradio || {};
  var STORE_KEY = 'mineradio-mood-audio-v1';

  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  function clampRange(v, min, max) {
    v = Number(v) || 0;
    return Math.max(min, Math.min(max, v));
  }

  function follow(cur, next, k) {
    return cur + (next - cur) * k;
  }

  var state = {
    mode: 'auto',
    visualLink: true,
    abHold: false,
    installed: false,
    ctx: null,
    dryGain: null,
    wetGain: null,
    makeupGain: null,
    lowShelf: null,
    midPeak: null,
    highShelf: null,
    compressor: null,
    limiter: null,
    exitNode: null,
    beatHint: null,
    styleProfile: { id: 'default', kickBias: 0.5, softVocal: 0, electronic: 0, ambient: 0 },
    params: {
      energy: 0,
      aggression: 0,
      groove: 0,
      space: 0.5,
      brightness: 0.5,
      warmth: 0.5,
      stability: 0.5,
      bpmHint: 0
    },
    smooth: {
      energy: 0,
      aggression: 0,
      groove: 0,
      space: 0.5,
      brightness: 0.5,
      warmth: 0.5,
      stability: 0.5
    },
    variance: { energy: 0.01, sum: 0, sumSq: 0, frames: 0 },
    lastFxAt: 0,
    sceneBias: null
  };

  function readPreference() {
    try {
      var raw = JSON.parse(global.localStorage.getItem(STORE_KEY) || '{}') || {};
      var mode = String(raw.mode || 'auto').toLowerCase();
      if (mode !== 'off' && mode !== 'auto' && mode !== 'raw') mode = 'auto';
      state.mode = mode;
      state.visualLink = raw.visualLink !== false;
    } catch (e) {
      state.mode = 'auto';
      state.visualLink = true;
    }
    return state.mode;
  }

  function savePreference() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify({
        mode: state.mode,
        visualLink: state.visualLink !== false
      }));
    } catch (e) {}
  }

  function modeLabel(mode) {
    if (state.abHold) return '原声';
    mode = mode || state.mode;
    if (mode === 'off') return '关';
    if (mode === 'raw') return '原声';
    if (mode === 'auto' && state.visualLink === false) return '音效';
    return '自动';
  }

  function isAudioActive() {
    return state.mode === 'auto' && !state.abHold && state.installed;
  }

  function isActive() {
    return isAudioActive();
  }

  function getVisualLink() {
    return state.visualLink !== false;
  }

  function setVisualLink(on, opts) {
    opts = opts || {};
    state.visualLink = !!on;
    if (opts.persist !== false) savePreference();
    return state.visualLink;
  }

  function getVisualStrength() {
    if (state.mode !== 'auto' || state.abHold || !state.visualLink) return 0;
    return 1;
  }

  function visualLinkSummary() {
    if (state.mode !== 'auto') return '';
    return state.visualLink !== false ? '音效 + 视觉' : '仅音效';
  }

  function computeStyleProfile(p) {
    p = p || state.smooth;
    var electronic = clamp01(p.aggression * 0.48 + p.groove * 0.42 + (state.params.bpmHint > 118 ? 0.14 : 0));
    var softVocal = clamp01(p.space * 0.34 + (1 - p.aggression) * 0.24 + (p.energy < 0.28 ? 0.34 : 0));
    var ambient = clamp01((1 - p.aggression) * 0.38 + p.stability * 0.34 + (p.energy < 0.22 ? 0.24 : 0));
    var kickBias = clamp01(p.groove * 0.52 + p.aggression * 0.38);
    var id = 'default';
    if (electronic > 0.62 && kickBias > 0.45) id = 'electronic-kick';
    else if (softVocal > 0.58 && p.energy < 0.38) id = 'soft-vocal';
    else if (ambient > 0.55) id = 'ambient-calm';
    return { id: id, kickBias: kickBias, softVocal: softVocal, electronic: electronic, ambient: ambient };
  }

  function styleProfileLabel(id) {
    if (id === 'electronic-kick') return '电子 · kick';
    if (id === 'soft-vocal') return '慢歌 · 人声';
    if (id === 'ambient-calm') return '安静 · 氛围';
    return '综合';
  }

  function applyCrossfade(now) {
    if (!state.dryGain || !state.wetGain || !state.ctx) return;
    var t = now == null ? state.ctx.currentTime : now;
    var wet = isAudioActive() ? 1 : 0;
    var dry = 1 - wet;
    state.dryGain.gain.cancelScheduledValues(t);
    state.wetGain.gain.cancelScheduledValues(t);
    state.dryGain.gain.setValueAtTime(state.dryGain.gain.value, t);
    state.wetGain.gain.setValueAtTime(state.wetGain.gain.value, t);
    state.dryGain.gain.linearRampToValueAtTime(dry, t + 0.06);
    state.wetGain.gain.linearRampToValueAtTime(wet, t + 0.06);
  }

  function applyFxTargets(now) {
    if (!state.installed || !state.ctx) return;
    var t = now == null ? state.ctx.currentTime : now;
    var p = state.smooth;
    var sp = state.styleProfile;
    var enabled = isAudioActive();

    var lowDb = enabled ? clampRange((0.42 - p.warmth) * 2.4 + p.aggression * 0.8, -0.4, 2.0) : 0;
    var midDb = enabled ? clampRange((p.energy - 0.34) * 1.4 - p.aggression * 0.35, -0.8, 1.0) : 0;
    var highDb = enabled ? clampRange((0.52 - p.brightness) * 2.0 + p.space * 0.5, -0.3, 1.6) : 0;
    var compThreshold = enabled ? clampRange(-22 - p.aggression * 8 - p.energy * 4, -32, -14) : -8;
    var compRatio = enabled ? clampRange(1.6 + p.aggression * 1.4 + p.energy * 0.8, 1.4, 3.2) : 1;
    var makeup = enabled ? clampRange(1 + p.energy * 0.04 + p.aggression * 0.03, 1, 1.08) : 1;

    if (enabled) {
      if (sp.softVocal > 0.55) lowDb *= clampRange(1 - sp.softVocal * 0.32, 0.58, 1);
      if (sp.electronic > 0.60) compRatio = clampRange(compRatio + sp.electronic * 0.22, 1.4, 3.4);
      if (sp.ambient > 0.55) {
        compRatio = clampRange(compRatio - sp.ambient * 0.35, 1.25, 3.2);
        highDb *= clampRange(1 - sp.ambient * 0.18, 0.72, 1);
      }
      if (p.brightness > 0.72) highDb *= 0.78;
      if (state.sceneBias) {
        var bias = state.sceneBias;
        if (bias.calm) {
          compRatio = clampRange(compRatio - 0.35, 1.2, 3.2);
          highDb = clampRange(highDb - 0.35, -0.8, 1.2);
          lowDb = clampRange(lowDb + 0.25, -0.4, 2.0);
        }
        if (bias.punch) {
          compRatio = clampRange(compRatio + 0.28, 1.4, 3.5);
          midDb = clampRange(midDb + 0.35, -0.8, 1.2);
        }
        if (bias.melancholy > 0.55) {
          highDb = clampRange(highDb - bias.melancholy * 0.22, -0.8, 1.2);
          lowDb = clampRange(lowDb + bias.melancholy * 0.18, -0.4, 2.0);
        }
        if (bias.focus > 0.7) {
          compRatio = clampRange(compRatio - 0.12, 1.25, 3.2);
        }
      }
    }

    function setParam(node, key, value) {
      if (!node || !node[key]) return;
      try {
        node[key].cancelScheduledValues(t);
        node[key].setValueAtTime(node[key].value, t);
        node[key].linearRampToValueAtTime(value, t + 0.12);
      } catch (e) {}
    }

    setParam(state.lowShelf, 'gain', lowDb);
    setParam(state.midPeak, 'gain', midDb);
    setParam(state.highShelf, 'gain', highDb);
    setParam(state.compressor, 'threshold', compThreshold);
    setParam(state.compressor, 'ratio', compRatio);
    setParam(state.makeupGain, 'gain', makeup);
  }

  function installChain(ctx, sourceNode) {
    if (!ctx || !sourceNode) return null;
    if (state.installed && state.ctx === ctx && state.exitNode) return state.exitNode;

    state.ctx = ctx;
    state.dryGain = ctx.createGain();
    state.wetGain = ctx.createGain();
    state.makeupGain = ctx.createGain();
    state.lowShelf = ctx.createBiquadFilter();
    state.midPeak = ctx.createBiquadFilter();
    state.highShelf = ctx.createBiquadFilter();
    state.compressor = ctx.createDynamicsCompressor();
    state.limiter = ctx.createDynamicsCompressor();

    state.lowShelf.type = 'lowshelf';
    state.lowShelf.frequency.value = 120;
    state.midPeak.type = 'peaking';
    state.midPeak.frequency.value = 2800;
    state.midPeak.Q.value = 0.9;
    state.highShelf.type = 'highshelf';
    state.highShelf.frequency.value = 8200;

    state.compressor.attack.value = 0.012;
    state.compressor.release.value = 0.18;
    state.compressor.knee.value = 8;

    state.limiter.threshold.value = -1.2;
    state.limiter.ratio.value = 20;
    state.limiter.attack.value = 0.003;
    state.limiter.release.value = 0.08;
    state.limiter.knee.value = 0;

    sourceNode.connect(state.dryGain);
    sourceNode.connect(state.lowShelf);
    state.lowShelf.connect(state.midPeak);
    state.midPeak.connect(state.highShelf);
    state.highShelf.connect(state.compressor);
    state.compressor.connect(state.makeupGain);
    state.makeupGain.connect(state.limiter);
    state.limiter.connect(state.wetGain);

    var merge = ctx.createGain();
    merge.gain.value = 1;
    state.dryGain.connect(merge);
    state.wetGain.connect(merge);
    state.exitNode = merge;
    state.installed = true;

    applyCrossfade(ctx.currentTime);
    applyFxTargets(ctx.currentTime);
    return merge;
  }

  function setBeatMapHint(map) {
    state.beatHint = map || null;
    if (map && map.gridStep) {
      state.params.bpmHint = clampRange(60 / Math.max(0.001, map.gridStep), 60, 180);
    }
  }

  function resetTrackAnalysis() {
    state.variance = { energy: 0.01, sum: 0, sumSq: 0, frames: 0 };
    state.smooth.aggression = 0;
    state.smooth.groove = 0;
    state.styleProfile = computeStyleProfile(state.smooth);
  }

  function tickSample(sample) {
    if (!sample) return state.smooth;
    var energy = clamp01(sample.energy);
    var low = clamp01(sample.low);
    var vocal = clamp01(sample.vocal);
    var melody = clamp01(sample.melody);
    var lowOnset = clamp01(sample.lowOnset || 0);
    var energyOnset = clamp01(sample.energyOnset || 0);
    var dt = Math.max(0.001, Number(sample.dt) || 0.016);

    var aggression = clamp01(lowOnset * 2.1 + energyOnset * 1.4 + low * 0.18);
    var brightness = clamp01(melody * 0.42 + (1 - low) * 0.18 + energy * 0.22);
    var warmth = clamp01(low * 0.55 + (1 - brightness) * 0.25 + energy * 0.12);
    var space = clamp01(0.42 + (1 - vocal) * 0.28 + brightness * 0.18 - aggression * 0.12);
    var groove = clamp01((sample.tempoConfidence || 0) * 0.55 + lowOnset * 1.6 + energy * 0.12);

    if (state.beatHint && state.beatHint.gridStep) {
      var offlineGroove = clamp01(1 - Math.abs(state.beatHint.gridStep - 0.5) / 0.35);
      if (state.beatHint.visualBeatCount && state.beatHint.duration) {
        var density = state.beatHint.visualBeatCount / Math.max(20, state.beatHint.duration);
        offlineGroove = clamp01(offlineGroove * 0.62 + clamp01(density / 1.4) * 0.38);
      }
      var mapReady = (state.beatHint.visualBeatCount || 0) >= 8;
      groove = clamp01(mapReady ? groove * 0.28 + offlineGroove * 0.72 : groove * 0.55 + offlineGroove * 0.45);
    }

    state.variance.frames++;
    state.variance.sum += energy;
    state.variance.sumSq += energy * energy;
    if (state.variance.frames > 24) {
      var mean = state.variance.sum / state.variance.frames;
      var varRaw = Math.max(0, state.variance.sumSq / state.variance.frames - mean * mean);
      state.variance.energy = varRaw;
      state.variance.frames = Math.floor(state.variance.frames * 0.5);
      state.variance.sum *= 0.5;
      state.variance.sumSq *= 0.5;
    }
    var stability = clamp01(1 - Math.sqrt(state.variance.energy) * 3.2);

    var k = dt > 0.03 ? 0.08 : 0.035;
    state.smooth.energy = follow(state.smooth.energy, energy, k);
    state.smooth.aggression = follow(state.smooth.aggression, aggression, k * 1.2);
    state.smooth.groove = follow(state.smooth.groove, groove, k * 0.9);
    state.smooth.space = follow(state.smooth.space, space, k * 0.7);
    state.smooth.brightness = follow(state.smooth.brightness, brightness, k * 0.6);
    state.smooth.warmth = follow(state.smooth.warmth, warmth, k * 0.6);
    state.smooth.stability = follow(state.smooth.stability, stability, k * 0.5);

    state.params.energy = state.smooth.energy;
    state.params.aggression = state.smooth.aggression;
    state.params.groove = state.smooth.groove;
    state.params.space = state.smooth.space;
    state.params.brightness = state.smooth.brightness;
    state.params.warmth = state.smooth.warmth;
    state.params.stability = state.smooth.stability;

    state.styleProfile = computeStyleProfile(state.smooth);

    var nowMs = global.performance ? global.performance.now() : Date.now();
    if (nowMs - state.lastFxAt > 120) {
      state.lastFxAt = nowMs;
      applyFxTargets();
    }
    return state.smooth;
  }

  function getParams() {
    return Object.assign({}, state.params, {
      styleId: state.styleProfile.id,
      styleLabel: styleProfileLabel(state.styleProfile.id)
    });
  }

  function getStyleProfile() {
    return Object.assign({}, state.styleProfile, {
      label: styleProfileLabel(state.styleProfile.id)
    });
  }

  function getCinemaBoost() {
    if (getVisualStrength() < 0.01) return 1;
    var p = state.smooth;
    var sp = state.styleProfile;
    var boost = 1
      + p.groove * 0.08
      + p.aggression * 0.05
      + p.energy * 0.03
      - (1 - p.stability) * 0.04;
    if (sp.id === 'electronic-kick') boost += sp.kickBias * 0.04;
    if (sp.id === 'soft-vocal') boost -= 0.03;
    if (sp.id === 'ambient-calm') boost -= 0.05;
    return clampRange(boost, 0.90, 1.18);
  }

  function getCinemaShakeMul() {
    if (getVisualStrength() < 0.01) return 1;
    var p = state.smooth;
    var sp = state.styleProfile;
    var mul = 1;
    if (sp.id === 'soft-vocal' || sp.id === 'ambient-calm') {
      mul *= clampRange(0.60 + (1 - p.aggression) * 0.26, 0.52, 0.78);
    }
    if (sp.id === 'electronic-kick') {
      mul *= clampRange(0.94 + p.groove * 0.16 + p.aggression * 0.10, 0.94, 1.24);
    }
    if (p.stability < 0.34) mul *= 0.86;
    return mul;
  }

  function getBeatCameraAmpMul() {
    if (getVisualStrength() < 0.01) return 1;
    var sp = state.styleProfile;
    var p = state.smooth;
    if (sp.id === 'electronic-kick') return clampRange(1.04 + sp.kickBias * 0.16, 1, 1.22);
    if (sp.id === 'soft-vocal') return clampRange(0.70 + p.groove * 0.14, 0.66, 0.90);
    if (sp.id === 'ambient-calm') return clampRange(0.58 + p.energy * 0.16, 0.54, 0.80);
    return clampRange(0.90 + p.groove * 0.14, 0.86, 1.10);
  }

  function getParticleBreath() {
    if (getVisualStrength() < 0.01) return 0;
    return clamp01(state.smooth.groove * 0.55 + state.smooth.aggression * 0.25 + state.smooth.energy * 0.15);
  }

  function getParticleDensityMul() {
    if (getVisualStrength() < 0.01) return 1;
    var breath = getParticleBreath();
    var sp = state.styleProfile;
    if (sp.id === 'ambient-calm') return clampRange(0.94 + breath * 0.05, 0.92, 1.03);
    if (sp.id === 'soft-vocal') return clampRange(0.96 + breath * 0.07, 0.94, 1.07);
    return clampRange(1 + breath * 0.14 + sp.kickBias * 0.08, 1, 1.24);
  }

  function getBeatPulseBoost() {
    if (getVisualStrength() < 0.01) return 0;
    var sp = state.styleProfile;
    var base = clamp01(state.smooth.groove * 0.20 + state.smooth.aggression * 0.14);
    if (sp.id === 'electronic-kick') base *= 1.18;
    if (sp.id === 'ambient-calm') base *= 0.55;
    return base;
  }

  function beginAbHold() {
    if (state.mode !== 'auto') return false;
    state.abHold = true;
    applyCrossfade();
    applyFxTargets();
    return true;
  }

  function endAbHold() {
    if (!state.abHold) return false;
    state.abHold = false;
    applyCrossfade();
    applyFxTargets();
    return true;
  }

  function isAbHold() {
    return !!state.abHold;
  }

  function setMode(mode) {
    mode = String(mode || 'auto').toLowerCase();
    if (mode !== 'off' && mode !== 'auto' && mode !== 'raw') mode = 'auto';
    state.abHold = false;
    state.mode = mode;
    savePreference();
    applyCrossfade();
    applyFxTargets();
    return state.mode;
  }

  function applySceneBias(mood) {
    if (!mood) {
      state.sceneBias = null;
      applyFxTargets();
      return;
    }
    var energy = clamp01(mood.energy);
    var focus = clamp01(mood.focus);
    var melancholy = clamp01(mood.melancholy);
    state.sceneBias = {
      energy: energy,
      warmth: clamp01(mood.warmth),
      focus: focus,
      melancholy: melancholy,
      calm: energy < 0.35,
      punch: energy > 0.72,
    };
    applyFxTargets();
  }

  function clearSceneBias() {
    state.sceneBias = null;
    applyFxTargets();
  }

  function getMode() {
    return state.mode;
  }

  readPreference();

  NS.moodAudio = {
    STORE_KEY: STORE_KEY,
    readPreference: readPreference,
    savePreference: savePreference,
    modeLabel: modeLabel,
    isActive: isActive,
    isAudioActive: isAudioActive,
    getVisualStrength: getVisualStrength,
    installChain: installChain,
    setBeatMapHint: setBeatMapHint,
    resetTrackAnalysis: resetTrackAnalysis,
    tickSample: tickSample,
    getParams: getParams,
    getStyleProfile: getStyleProfile,
    getCinemaBoost: getCinemaBoost,
    getCinemaShakeMul: getCinemaShakeMul,
    getBeatCameraAmpMul: getBeatCameraAmpMul,
    getParticleBreath: getParticleBreath,
    getParticleDensityMul: getParticleDensityMul,
    getBeatPulseBoost: getBeatPulseBoost,
    getVisualLink: getVisualLink,
    setVisualLink: setVisualLink,
    visualLinkSummary: visualLinkSummary,
    beginAbHold: beginAbHold,
    endAbHold: endAbHold,
    isAbHold: isAbHold,
    setMode: setMode,
    getMode: getMode,
    applySceneBias: applySceneBias,
    clearSceneBias: clearSceneBias
  };
})(typeof window !== 'undefined' ? window : globalThis);
