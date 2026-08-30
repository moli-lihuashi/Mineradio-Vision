// ============================================================
//  主循环
// ============================================================
var prevTime = performance.now();
var renderPerfState = {
  mode: 'vsync',
  fps: 0,
  frames: 0,
  skipped: 0,
  longFrames: 0,
  lastRenderAt: 0,
  lastSampleAt: performance.now(),
  displayHz: 0,
  adaptivePressure: 0,
  foregroundFpsMode: 'vsync',
  targetFps: 0
};
window.__mineradioRenderPerf = renderPerfState;
if (window.__mineradioPerf && typeof window.__mineradioPerf.registerRenderState === 'function') {
  window.__mineradioPerf.registerRenderState(renderPerfState);
} else {
  window.__mineradioPerf = renderPerfState;
}
var splashWarmRenderLast = 0;
var fixedRenderCadenceState = {
  key: '',
  lastCheckAt: 0,
  phase: 0
};
function resetFixedRenderCadenceState() {
  fixedRenderCadenceState.key = '';
  fixedRenderCadenceState.lastCheckAt = 0;
  fixedRenderCadenceState.phase = 0;
}
function shouldSkipFixedRenderCadenceFrame(state, now, fps, displayHz, key) {
  if (!state) return false;
  now = Number(now);
  fps = Math.max(1, Number(fps) || 1);
  displayHz = Math.max(1, Number(displayHz) || 60);
  key = String(key || fps);
  if (!isFinite(now)) now = performance.now();
  var lastCheckAt = Number(state.lastCheckAt) || 0;
  var elapsedMs = Math.max(0, now - lastCheckAt);
  var stallResetMs = Math.max(50, (1000 / displayHz) * 4);
  if (state.key !== key || !lastCheckAt || now < lastCheckAt || elapsedMs > stallResetMs) {
    state.key = key;
    state.lastCheckAt = now;
    state.phase = 0;
    return false;
  }
  state.lastCheckAt = now;
  if (fps >= displayHz * 0.98) {
    state.phase = 0;
    return false;
  }
  state.phase = Math.max(0, Number(state.phase) || 0) + elapsedMs * fps / 1000;
  if (state.phase < 1) return true;
  state.phase = Math.max(0, state.phase - 1);
  return false;
}
function isMainSceneCoveredBySplash() {
  return document.body.classList.contains('splash-active') && !document.body.classList.contains('splash-revealing');
}
function getAdaptiveRenderFps() {
  // 页面隐藏时，即使后台保活也降速（仅保持音频分析，跳过视觉渲染）
  if (document.hidden) return isLiveBackgroundKeepMode() ? 5 : 1;
  if (isDeepBackgroundMode()) return 1;
  if (typeof syncGpuThrottle === 'function') syncGpuThrottle(performance.now());
  if (typeof isGpuThrottleActive === 'function' && isGpuThrottleActive()) {
    return (typeof gpuThrottleTargetFps === 'function') ? gpuThrottleTargetFps() : 30;
  }
  // 前台帧率：完全跟 FX「前台帧率上限」；GPU 节流开启时仍可临时压到 ~30
  var fgMode = (typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : 'vsync';
  var fgFixedFps = (typeof resolvedForegroundRenderFps === 'function')
    ? resolvedForegroundRenderFps()
    : ((typeof foregroundFixedFpsForMode === 'function') ? foregroundFixedFpsForMode(fgMode) : 0);
  if (fgFixedFps > 0) {
    // 切歌过渡：临时压到 ≤30，不改 FX 面板长期设置
    if (typeof coverTransitionReliefFpsCap === 'function') {
      var reliefCap = coverTransitionReliefFpsCap();
      if (reliefCap > 0) return Math.min(fgFixedFps, reliefCap);
    }
    return fgFixedFps;
  }
  if (typeof coverTransitionReliefFpsCap === 'function') {
    var reliefOnly = coverTransitionReliefFpsCap();
    if (reliefOnly > 0) return reliefOnly; // vsync 跟屏时过渡期临时 30
  }
  if (RENDER_VISIBLE_VSYNC) return 0;
  var tier = (typeof getRenderLoadTier === 'function') ? getRenderLoadTier() : 0;
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) {
    if (tier >= 2) return RENDER_INTERACTION_HUGE_FPS;
    if (tier >= 1) return RENDER_INTERACTION_LARGE_FPS;
    return RENDER_INTERACTION_FPS;
  }
  if (tier >= 2) return RENDER_HUGE_FPS;
  if (tier >= 1) return RENDER_LARGE_FPS;
  return RENDER_ACTIVE_FPS;
}
function shouldSkipAdaptiveRenderFrame(now) {
  sampleDisplayRefreshHz(now); // 刷新率采样 (每帧调用, 累积稳定 displayHz 估值)
  var displayHz = estimatedDisplayRefreshHz();
  renderPerfState.displayHz = displayHz;
  var fgMode = (typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : 'vsync';
  renderPerfState.foregroundFpsMode = fgMode;
  var fps = getAdaptiveRenderFps();
  renderPerfState.mode = fps ? (fps + 'fps') : 'vsync';
  renderPerfState.targetFps = fps;
  if (!fps) {
    resetFixedRenderCadenceState();
    renderPerfState.lastRenderAt = now;
    return false;
  }
  var fixedCadenceKey = fgMode + ':' + fps;
  if (shouldSkipFixedRenderCadenceFrame(fixedRenderCadenceState, now, fps, displayHz, fixedCadenceKey)) {
    renderPerfState.skipped += 1;
    return true;
  }
  renderPerfState.lastRenderAt = now;
  return false;
}
function sampleRenderPerf(now, dt) {
  renderPerfState.frames += 1;
  if (dt > 0.034) renderPerfState.longFrames += 1;
  // 帧成本采样: dt 转为 ms, 目标 fps 取刷新率或 60
  var frameCostMs = dt * 1000;
  var targetFps = renderPerfState.displayHz || renderPerfState.fps || 60;
  sampleAdaptiveFrameCost(frameCostMs, targetFps);
  renderPerfState.adaptivePressure = adaptiveLoadPressureLevel();
  if (now - renderPerfState.lastSampleAt >= 1000) {
    renderPerfState.fps = Math.round(renderPerfState.frames * 1000 / Math.max(1, now - renderPerfState.lastSampleAt));
    renderPerfState.frames = 0;
    renderPerfState.lastSampleAt = now;
  }
  maybeTrimRuntimeCaches(now);
}
var mainFrameGates = {
  audio: createFrameGate('main.audio', 60),
  shelf: createFrameGate('main.shelf', 30),
  lyricsParticles: createFrameGate('main.lyricsParticles', 45),
  stageLyrics: createFrameGate('main.stageLyrics', 45),
  skullParticles: createFrameGate('main.skullParticles', 45),
  homeAudio: createFrameGate('main.homeAudio', 15),
  desktopOverlay: createFrameGate('main.desktopOverlay', 12)
};
window.__mineradioMainFrameGates = mainFrameGates;
var mainLoopBackgroundTimer = 0;
var mainLoopAnimationRequested = false;
function mainLoopDeepBackgroundSleeping() {
  return typeof isDeepBackgroundMode === 'function'
    && isDeepBackgroundMode()
    && !(typeof isLiveBackgroundKeepMode === 'function' && isLiveBackgroundKeepMode());
}
function mainLoopBackgroundDelayMs() {
  if (!mainLoopDeepBackgroundSleeping()) return 0;
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) return 250;
  if (typeof isBackgroundReleaseMode === 'function' && isBackgroundReleaseMode()) return 1500;
  return 1000;
}
function requestMainLoopAnimationFrame() {
  if (mainLoopAnimationRequested) return;
  mainLoopAnimationRequested = true;
  requestAnimationFrame(animate);
}
function scheduleNextMainLoopFrame() {
  var delay = mainLoopBackgroundDelayMs();
  if (delay > 0) {
    if (mainLoopBackgroundTimer) return;
    mainLoopBackgroundTimer = setTimeout(function () {
      mainLoopBackgroundTimer = 0;
      requestMainLoopAnimationFrame();
    }, delay);
    return;
  }
  requestMainLoopAnimationFrame();
}
function wakeMainLoopFromBackground() {
  if (mainLoopBackgroundTimer) {
    clearTimeout(mainLoopBackgroundTimer);
    mainLoopBackgroundTimer = 0;
  }
  requestMainLoopAnimationFrame();
}
function tickDeepBackgroundFrame(now, dt) {
  sampleRenderPerf(now, dt);
  if (fx && (fx.desktopLyrics || fx.wallpaperMode) && typeof syncDesktopOverlayState === 'function') {
    syncDesktopOverlayState();
  }
}
document.addEventListener('visibilitychange', function () {
  if (!mainLoopDeepBackgroundSleeping()) wakeMainLoopFromBackground();
});
window.addEventListener('focus', wakeMainLoopFromBackground);
function mainLoopInteractionActive(now) {
  return (typeof isRenderInteractionActive === 'function') && isRenderInteractionActive(now);
}
function visibleMotionFollowVsync(now) {
  if (isDeepBackgroundMode()) return false;
  var mode = (typeof normalizeForegroundFpsMode === 'function')
    ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode)
    : 'vsync';
  if (mode !== 'vsync') return false;
  if (typeof isProgressDragPreviewActive === 'function' && isProgressDragPreviewActive()) return true;
  if (mainLoopInteractionActive(now)) return true;
  return !!(playing && audio && !audio.paused);
}
function capMainLoopFpsToDisplay(fps) {
  var hz = (typeof estimatedDisplayRefreshHz === 'function') ? estimatedDisplayRefreshHz() : 60;
  return Math.max(1, Math.min(Number(fps) || 60, Math.max(48, hz)));
}
function capMainLoopFpsForBudget(fps, minFps) {
  var scale = (typeof runtimePerfScale === 'function') ? runtimePerfScale() : 1;
  var target = Math.round((Number(fps) || 60) * scale);
  return Math.max(minFps || 1, capMainLoopFpsToDisplay(target));
}
function targetMainAudioFps(now) {
  if (isDeepBackgroundMode()) return 1;
  var scale = (typeof runtimeAudioAnalysisScale === 'function') ? runtimeAudioAnalysisScale() : 1;
  if (playing && audio && !audio.paused) {
    var base = mainLoopInteractionActive(now) ? 72 : 54;
    return capMainLoopFpsToDisplay(Math.max(30, Math.round(base * scale)));
  }
  return mainLoopInteractionActive(now) ? 30 : 24;
}
function targetMainShelfFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.shelf === 'off') return 12;
  if (mainLoopInteractionActive(now)) return 0;
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return 0;
  if (typeof shelfPreviewIsVisible === 'function' && shelfPreviewIsVisible()) return 0;
  if (shelfPinnedOpen || (typeof shelfAlwaysVisible === 'function' && shelfAlwaysVisible())) return 0;
  return capMainLoopFpsForBudget(38, 18);
}
function targetMainLyricsParticleFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.particleLyrics === false) return 12;
  if (visibleMotionFollowVsync(now)) return 0;
  if (mainLoopInteractionActive(now)) return capMainLoopFpsForBudget(120, 72);
  return (playing && audio && !audio.paused) ? capMainLoopFpsForBudget(60, 48) : 24;
}
function targetMainStageLyricsFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.particleLyrics === false) return 12;
  if (visibleMotionFollowVsync(now)) return 0;
  if (mainLoopInteractionActive(now)) return capMainLoopFpsForBudget(120, 72);
  return (playing && audio && !audio.paused) ? capMainLoopFpsForBudget(60, 48) : 24;
}
function targetMainSkullParticleFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.preset !== SKULL_PRESET_INDEX) return 10;
  if (visibleMotionFollowVsync(now)) return 0;
  if (mainLoopInteractionActive(now)) return capMainLoopFpsForBudget(120, 72);
  return (playing && audio && !audio.paused) ? capMainLoopFpsForBudget(60, 45) : 24;
}
function targetMainHomeAudioFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (typeof emptyHomeActive !== 'undefined' && !emptyHomeActive) return 6;
  return mainLoopInteractionActive(now) ? 30 : 15;
}
function targetMainDesktopOverlayFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) {
    if (fx.desktopLyricsFps === 0 || mainLoopInteractionActive(now)) return 0;
    return Math.max(24, Math.min(120, Number(fx.desktopLyricsFps) || 60));
  }
  return 6;
}
function audioEnv(prev, next, attack, release) {
  return prev + (next - prev) * (next > prev ? attack : release);
}
/* ===== 8 频段 sonic 监控 =====
 * 渐进式移植：8 频段作为新增数据暴露，现有 bass/mid/treble legacy 合成不变。
 * 视觉层可逐步迁移到 subBass/lowMid/highMid/presence/brilliance/air 等新频段。
 */
var SONIC_BAND_EDGES = [
  { name: 'subBass',    lo: 32,    hi: 58,    attack: 34, release: 10 },
  { name: 'bass',       lo: 58,    hi: 118,   attack: 34, release: 10 },
  { name: 'lowMid',     lo: 118,   hi: 260,   attack: 32, release: 9.5 },
  { name: 'mid',        lo: 260,   hi: 720,   attack: 32, release: 9.5 },
  { name: 'highMid',    lo: 720,   hi: 1800,  attack: 32, release: 9.5 },
  { name: 'presence',   lo: 1800,  hi: 4200,  attack: 30, release: 9 },
  { name: 'brilliance', lo: 4200,  hi: 9000,  attack: 30, release: 9 },
  { name: 'air',        lo: 9000,  hi: 16000, attack: 30, release: 9 }
];
var sonicBandRaw = { subBass:0, bass:0, lowMid:0, mid:0, highMid:0, presence:0, brilliance:0, air:0 };
var sonicBandSmooth = { subBass:0, bass:0, lowMid:0, mid:0, highMid:0, presence:0, brilliance:0, air:0 };
var sonicDerived = { lowDrive:0, lowDominance:0, energy:0, warmth:0, brightness:0, sharpness:0, density:0 };
var sonicAutoKickBin = 3; // AUTO 模式下平滑跟随的低频最强 bin

// AudioWorklet 特征缓存
var audioWorkletFeatures = null;
var audioWorkletActive = false;
var audioWorkletFeaturesAt = 0;
var audioWorkletSpectrumAt = 0;

function onAudioWorkletFeatures(payload) {
  audioWorkletFeatures = payload;
  audioWorkletActive = true;
  audioWorkletFeaturesAt = performance.now();
}
function audioWorkletFeaturesFresh(maxAgeMs) {
  return !!(audioWorkletActive && audioWorkletFeatures && (performance.now() - audioWorkletFeaturesAt) < (maxAgeMs || 90));
}
function sonicHzToBin(hz, binHz, binCount) {
  if (binHz <= 0) return 0;
  return Math.max(0, Math.min(binCount - 1, Math.round(hz / binHz)));
}
function sonicHzRangeAverage(data, loHz, hiHz, binHz, binCount) {
  var lo = sonicHzToBin(loHz, binHz, binCount);
  var hi = sonicHzToBin(hiHz, binHz, binCount);
  if (hi <= lo) hi = lo + 1;
  var sum = 0, total = 0;
  for (var i = lo; i < hi; i++) {
    var v = (data[i] || 0) / 255;
    sum += v * v;
    total += 1;
  }
  return total > 0 ? Math.sqrt(sum / total) : 0;
}
function sonicFollowValue(prev, next, attackRate, releaseRate, dt) {
  var rate = next > prev ? attackRate : releaseRate;
  return prev + (next - prev) * (1 - Math.exp(-rate * dt));
}
function sonicComputeHzBands(data, analyserNode, dt) {
  if (!data || !analyserNode) return;
  var binCount = data.length;
  var sampleRate = (analyserNode.context && analyserNode.context.sampleRate) ? analyserNode.context.sampleRate : 44100;
  var binHz = sampleRate / 2 / binCount;
  for (var i = 0; i < SONIC_BAND_EDGES.length; i++) {
    var edge = SONIC_BAND_EDGES[i];
    var raw = sonicHzRangeAverage(data, edge.lo, edge.hi, binHz, binCount);
    sonicBandRaw[edge.name] = raw;
    sonicBandSmooth[edge.name] = sonicFollowValue(sonicBandSmooth[edge.name] || 0, raw, edge.attack, edge.release, dt);
  }
  // 派生量
  sonicDerived.lowDrive = sonicBandSmooth.bass * 0.86 + sonicBandSmooth.subBass * 0.42 + sonicBandSmooth.lowMid * 0.10;
  var totalEnergy = sonicBandSmooth.bass + sonicBandSmooth.mid + sonicBandSmooth.presence + sonicBandSmooth.brilliance;
  sonicDerived.lowDominance = sonicBandSmooth.bass / Math.max(0.001, totalEnergy);
  sonicDerived.energy = Math.sqrt((sonicBandSmooth.bass * sonicBandSmooth.bass + sonicBandSmooth.mid * sonicBandSmooth.mid + sonicBandSmooth.presence * sonicBandSmooth.presence) / 3);
  sonicDerived.warmth = sonicBandSmooth.bass / Math.max(0.001, sonicBandSmooth.bass + sonicBandSmooth.mid);
  sonicDerived.brightness = (sonicBandSmooth.presence + sonicBandSmooth.brilliance + sonicBandSmooth.air) / Math.max(0.001, totalEnergy + sonicBandSmooth.air);
  sonicDerived.sharpness = sonicBandSmooth.presence / Math.max(0.001, sonicBandSmooth.mid + sonicBandSmooth.presence);
  sonicDerived.density = clamp01((sonicBandSmooth.lowMid + sonicBandSmooth.mid + sonicBandSmooth.highMid) / 1.8);
}
function sonicDecayBands(dt) {
  var factor = Math.pow(0.08, dt);
  for (var k in sonicBandSmooth) sonicBandSmooth[k] *= factor;
  for (var d in sonicDerived) sonicDerived[d] *= factor;
}
function animate() {
  mainLoopAnimationRequested = false;
  scheduleNextMainLoopFrame();
  var now = performance.now();
  if (mainLoopDeepBackgroundSleeping()) {
    var deepDt = Math.min((now - prevTime) / 1000, 0.25);
    prevTime = now;
    tickDeepBackgroundFrame(now, deepDt);
    return;
  }
  if (shouldSkipAdaptiveRenderFrame(now)) {
    if (window.__mineradioPerf && typeof window.__mineradioPerf.count === 'function') {
      window.__mineradioPerf.count('frame.skipped');
    }
    return;
  }
  var framePerfStart = performance.now();
  var dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  sampleRenderPerf(now, dt);
  // P1：帧压变化时重算内部分辨率（像素预算随 pressure 缩放）
  var pressureNow = typeof adaptiveLoadPressureLevel === 'function' ? adaptiveLoadPressureLevel() : 0;
  if (renderPerfState._lastPressureApplied !== pressureNow) {
    renderPerfState._lastPressureApplied = pressureNow;
    if (typeof applyRendererPowerMode === 'function') applyRendererPowerMode();
  }
  uniforms.uTime.value += dt;
  if (uniforms.uTemporalSubset && uniforms.uFrameParity) {
    var wantSubset = typeof particleTemporalSubsetEnabled === 'function' && particleTemporalSubsetEnabled();
    uniforms.uTemporalSubset.value = wantSubset ? 1 : 0;
    if (wantSubset) {
      uniforms.uFrameParity.value = uniforms.uFrameParity.value > 0.5 ? 0 : 1;
    }
    var usedDrawRange = typeof applyCoverParticleTemporalDrawRange === 'function'
      && applyCoverParticleTemporalDrawRange(wantSubset, uniforms.uFrameParity.value);
    if (uniforms.uUseDrawRange) uniforms.uUseDrawRange.value = usedDrawRange ? 1 : 0;
    renderPerfState.temporalSubset = wantSubset ? 1 : 0;
    renderPerfState.drawRangeSubset = usedDrawRange ? 1 : 0;
  }
  if (isMainSceneCoveredBySplash()) {
    if (now - splashWarmRenderLast > 520) {
      splashWarmRenderLast = now;
      renderer.render(scene, camera);
    }
    return;
  }
  pointerParallax.x += (pointerTarget.x - pointerParallax.x) * 0.040;
  pointerParallax.y += (pointerTarget.y - pointerParallax.y) * 0.040;

  // 频谱分析 — v7.1: 真正分离 kick 和人声
  // bin = sampleRate / fftSize = 44100/2048 ≈ 21.5Hz
  // kick 60-150Hz → bin 3-7 (用前 5 个 bin)
  // vocal 200-3000Hz → bin 9-140 (尽量不计入 bass/mid 的"鼓点"判断)
  // 真正的 mid 乐器/和声: 3000-6000Hz → bin 140-280
  // treble: 6000Hz+ → bin 280+
  beatOnsetFlag = false;
  var audioPerfStart = performance.now();
  var audioStepDt = consumeFrameGate(mainFrameGates.audio, now, dt, targetMainAudioFps(now), false, 'audio-analysis');
  if (audioStepDt > 0) {
  if (analyser && playing && audio && !audio.paused) {
    if (audioCtx && audioCtx.state === 'suspended') resumeAudioAnalysis();
    tickCuefieldAutoMix();

    var rb, rm, rt, re, bassOnset, energyOnset, voc, realtimeBeat;
    var useWorklet = audioWorkletFeaturesFresh(100);
    if (useWorklet) {
      var wf = audioWorkletFeatures.features || {};
      var wl = audioWorkletFeatures.legacy || {};
      var wb = audioWorkletFeatures.beat || null;
      var ws = audioWorkletFeatures.sonicBands || null;
      rb = Number(wf.rb) || 0;
      rm = Number(wf.rm) || 0;
      rt = Number(wf.rt) || 0;
      re = Number(wf.re) || 0;
      bassOnset = Number(wf.bassOnset) || 0;
      energyOnset = Number(wf.energyOnset) || 0;
      voc = Number(wf.voc != null ? wf.voc : wl.voc) || 0;
      if (ws) {
        for (var sk in ws) {
          if (Object.prototype.hasOwnProperty.call(ws, sk)) sonicBandSmooth[sk] = ws[sk];
        }
        sonicDerived.lowDrive = (sonicBandSmooth.bass || 0) * 0.86 + (sonicBandSmooth.subBass || 0) * 0.42 + (sonicBandSmooth.lowMid || 0) * 0.10;
        var totalEnergy = (sonicBandSmooth.bass || 0) + (sonicBandSmooth.mid || 0) + (sonicBandSmooth.presence || 0) + (sonicBandSmooth.brilliance || 0);
        sonicDerived.lowDominance = (sonicBandSmooth.bass || 0) / Math.max(0.001, totalEnergy);
        sonicDerived.energy = Math.sqrt(((sonicBandSmooth.bass || 0) * (sonicBandSmooth.bass || 0) + (sonicBandSmooth.mid || 0) * (sonicBandSmooth.mid || 0) + (sonicBandSmooth.presence || 0) * (sonicBandSmooth.presence || 0)) / 3);
      }
      if (audioWorkletFeatures.kickRange) sonicAudioMonitorState.kickRange = audioWorkletFeatures.kickRange;
      smoothBass = Number(wf.smoothBass != null ? wf.smoothBass : smoothBass) || smoothBass;
      smoothMid = Number(wf.smoothMid != null ? wf.smoothMid : smoothMid) || smoothMid;
      smoothTreb = Number(wf.smoothTreb != null ? wf.smoothTreb : smoothTreb) || smoothTreb;
      smoothEnergy = Number(wf.smoothEnergy != null ? wf.smoothEnergy : smoothEnergy) || smoothEnergy;
      prevEnergy = re;
      realtimeBeat = wb || { hit: false };
      // 低频刷新 frequencyData，供 Sonic Topography / FX 频谱条 / 黑洞频谱纹理使用
      // 33ms (~30fps) + JS 侧 attack/release 平滑 → 频谱纹理流畅且不扫 Worklet 热路径
      if (analyser && frequencyData && (now - audioWorkletSpectrumAt) > 33) {
        try {
          analyser.getByteFrequencyData(frequencyData);
          audioWorkletSpectrumAt = now;
        } catch (_) {}
      }
    } else {
      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(timeDomainData);
      var len = frequencyData.length;
      var kickStart = 0, kickEnd = 7;
      if (fx.sonicAudioAutoTrack === false) {
        kickStart = clampRange(Math.round(Number(fx.sonicAudioBandStart) || 0), 0, Math.max(0, len - 2));
        kickEnd = clampRange(Math.round(Number(fx.sonicAudioBandEnd) || 4), kickStart + 1, len);
      } else {
        var autoHi = Math.min(16, len);
        var peakBin = 3, peakVal = -1;
        for (var ab = 0; ab < autoHi; ab++) {
          var av = (frequencyData[ab] || 0) / 255;
          if (av > peakVal) { peakVal = av; peakBin = ab; }
        }
        sonicAutoKickBin += (peakBin - sonicAutoKickBin) * 0.08;
        var cb = Math.round(sonicAutoKickBin);
        kickStart = Math.max(0, cb - 3);
        kickEnd = Math.min(autoHi, cb + 4);
      }
      var vocalEnd = Math.min(len, 140);
      var midEnd   = Math.min(len, 280);
      if (vocalEnd <= kickEnd) vocalEnd = Math.min(len, kickEnd + 1);
      var bKick = 0, mInst = 0, tHigh = 0, rms = 0;
      voc = 0;
      for (var i = 0; i < len; i++) {
        var v = frequencyData[i] / 255;
        if (i >= kickStart && i < kickEnd) bKick += v;
        else if (i >= kickEnd && i < vocalEnd) voc += v;
        else if (i >= vocalEnd && i < midEnd) mInst += v;
        else if (i >= midEnd) tHigh += v;
      }
      // stride 是常量：循环外只求值一次，避免 FFT 每个样本都调一次函数
      var timeStride = (typeof runtimeAnalysisStride === 'function') ? runtimeAnalysisStride('time', timeDomainData.length) : 1;
      for (var j = 0; j < timeDomainData.length; j += timeStride) {
        var tv = (timeDomainData[j] - 128) / 128;
        rms += tv * tv;
      }
      var timeSamples = Math.max(1, Math.ceil(timeDomainData.length / Math.max(1, timeStride)));
      bKick /= Math.max(1, kickEnd - kickStart);
      bKick *= clampRange((Number(fx.sonicAudioSensitivity) || 50) / 50, 0.4, 1.6);
      voc /= Math.max(1, vocalEnd - kickEnd);
      mInst /= Math.max(1, midEnd - vocalEnd);
      tHigh /= Math.max(1, len - midEnd);
      rms = Math.sqrt(rms / timeSamples);
      sonicAudioMonitorState.kickRange = [kickStart, kickEnd];
      sonicComputeHzBands(frequencyData, analyser, audioStepDt);

      bassPeak = Math.max(bassPeak * 0.994, bKick, 0.030);
      midPeak  = Math.max(midPeak  * 0.993, mInst, 0.026);
      treblePeak = Math.max(treblePeak * 0.992, tHigh, 0.018);
      energyPeak = Math.max(energyPeak * 0.995, rms, 0.030);

      rb = Math.min(1, Math.pow(bKick / Math.max(0.038, bassPeak * 0.66), 0.78));
      rm = Math.min(1, Math.pow(mInst / Math.max(0.025, midPeak  * 0.70), 0.86));
      rt = Math.min(1, Math.pow(tHigh / Math.max(0.020, treblePeak * 0.74), 0.92));
      re = Math.min(1, Math.pow(rms / Math.max(0.034, energyPeak * 0.68), 0.82));

      bassOnset = Math.max(0, rb - smoothBass);
      energyOnset = Math.max(0, re - prevEnergy);
      prevEnergy = prevEnergy * 0.88 + re * 0.12;
      realtimeBeat = processRealtimeBeatEngine(audioStepDt);
    }

    if (realtimeBeat && realtimeBeat.hit) {
      var dj = djMode.active;
      var djMapCoversCurrentTime = !dj || !currentDjBeatMap || !currentDjBeatMap.partialUntilSec || !audio || (audio.currentTime || 0) <= currentDjBeatMap.partialUntilSec - 1.25;
      var djBeatMapReadyForCamera = dj && currentDjBeatMap && currentDjBeatMap.cameraBeats && currentDjBeatMap.cameraBeats.length >= 4 && djMapCoversCurrentTime;
      var beatMapReadyForCamera = dj ? djBeatMapReadyForCamera : (currentBeatMap && currentBeatMap.cameraBeats && currentBeatMap.cameraBeats.length >= 4);
      var waitingForBeatMap = dj ? !djBeatMapReadyForCamera : (!beatMapReadyForCamera && (!!beatMapBusy || !!beatAnalysisTimer || ((audio && audio.currentTime) || 0) < 18));
      var liveKickFrame = dj
        ? (realtimeBeat.low > 0.48 && rb > 0.38 && bassOnset > 0.055 && energyOnset > 0.010 && (realtimeBeat.lowDominance || 0) > 0.82)
        : (realtimeBeat.low > 0.50 && rb > 0.42 && bassOnset > 0.070 && energyOnset > 0.016);
      var liveStrongHit = dj
        ? (realtimeBeat.confidence > 0.60 && realtimeBeat.strength > 0.56 && realtimeBeat.score > 0.50 && liveKickFrame)
        : (realtimeBeat.confidence > 0.76 && realtimeBeat.strength > 0.70 && realtimeBeat.score > 0.56 && liveKickFrame);
      var liveTempoHit = dj
        ? (realtimeBeat.tempoAssist && realtimeBeat.confidence > 0.62 && realtimeBeat.strength > 0.52 && realtimeBeat.low > 0.48 && (liveKickFrame || bassOnset > 0.046))
        : (realtimeBeat.tempoAssist && realtimeBeat.confidence > 0.80 && realtimeBeat.strength > 0.66 && realtimeBeat.low > 0.50 && bassOnset > 0.052);
      var liveFallbackOk = dj
        ? (liveStrongHit || liveTempoHit)
        : (waitingForBeatMap
          ? (liveStrongHit || liveTempoHit)
          : (realtimeBeat.confidence > 0.84 && realtimeBeat.strength > 0.80 && realtimeBeat.low > 0.54 && (liveKickFrame || realtimeBeat.score > 0.68)));
      if (!beatMapReadyForCamera && liveFallbackOk) {
        scheduleBeatCamera({
          time: realtimeBeat.time,
          strength: realtimeBeat.strength,
          confidence: realtimeBeat.confidence,
          low: realtimeBeat.low,
          body: realtimeBeat.body,
          snap: realtimeBeat.snap,
          mass: realtimeBeat.mass,
          sharpness: realtimeBeat.sharpness,
          combo: realtimeBeat.combo,
          impact: clamp01(realtimeBeat.strength * 0.46 + realtimeBeat.confidence * 0.20 + realtimeBeat.low * 0.28),
          preview: waitingForBeatMap,
          primary: true,
          dj: dj
        }, 'live');
      }
      if (!beatMapReadyForCamera && liveFallbackOk) {
        var previewPulseScale = waitingForBeatMap && !dj ? 0.68 : 1;
        var rtPulse = Math.min(dj ? 0.34 : (waitingForBeatMap ? 0.46 : 0.62), realtimeBeat.strength * (realtimeBeat.tempoAssist ? (dj ? 0.42 : 0.62) : (dj ? 0.48 : 0.68)) * previewPulseScale);
        if (rtPulse > beatPulse + 0.09) beatOnsetFlag = true;
        beatPulse = Math.max(beatPulse, rtPulse);
      }
    } else if (bassOnset > 0.075 && rb > 0.32 && energyOnset > 0.020) {
      beatPulse = Math.max(beatPulse, Math.min(0.12, bassOnset * 0.18));
    }
    beatPulse *= Math.pow(0.36, dt);

    // v7.2+: 预解析 beatmap 只在实时引擎暂时没锁住时补位.
    tickPodcastDjBeatMap();
    tickBeatMap();
    if (scheduledBeatFlag) {
      beatOnsetFlag = true;
      scheduledBeatFlag = false;
    }
    // scheduledBeatPulse 衰减并合并到 beatPulse
    if (scheduledBeatPulse > beatPulse) beatPulse = scheduledBeatPulse;
    scheduledBeatPulse *= Math.pow(0.32, dt);

    if (!useWorklet) {
      smoothBass  = audioEnv(smoothBass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075);
      // smoothMid 用 中高乐器, 不再混入人声
      smoothMid   = audioEnv(smoothMid,  Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.060);
      smoothTreb  = audioEnv(smoothTreb, Math.min(0.56, rt * 0.54), 0.18, 0.055);
      smoothEnergy= audioEnv(smoothEnergy, Math.min(0.72, re), 0.16, 0.055);
    }
    updateCinemaDynamics(re, rb);
    updateCinemaTrackProfile({ energy: re, low: rb, vocal: voc, melody: rm, lowOnset: bassOnset, energyOnset: energyOnset });
    if (Mineradio.moodAudio && typeof Mineradio.moodAudio.tickSample === 'function') {
      Mineradio.moodAudio.tickSample({
        energy: re,
        low: rb,
        vocal: voc,
        melody: rm,
        lowOnset: bassOnset,
        energyOnset: energyOnset,
        tempoConfidence: (realtimeBeat && realtimeBeat.tempoConfidence) || 0,
        dt: dt
      });
      if (Mineradio.moodAudio.getVisualStrength && Mineradio.moodAudio.getVisualStrength() > 0.01) {
        cinemaTrackProfile.scale = clampRange(cinemaTrackProfile.scale * Mineradio.moodAudio.getCinemaBoost(), 0.28, 1.26);
      }
      updateMoodAudioMeterUi(false);
    }
    // 歌词阳光溢光: 独立于律动强度, 看持续能量 + 中高频抬升, 更像副歌/高音段落而不是单个鼓点.
    var sunEnergy = clamp01((smoothEnergy - 0.18) / 0.38);
    var sunVoice = clamp01((voc - 0.11) / 0.34);
    var sunMelody = clamp01((smoothMid - 0.16) / 0.27);
    var sunAir = clamp01((smoothTreb - 0.105) / 0.17);
    var sunRaw = clamp01(sunEnergy * 0.36 + sunVoice * 0.18 + sunMelody * 0.26 + sunAir * 0.20);
    sunRaw = sunRaw * sunRaw * (3 - 2 * sunRaw);
    lyricSunAvg += (sunRaw - lyricSunAvg) * 0.006;
    lyricSunPeak = Math.max(0.48, lyricSunPeak * 0.9985, sunRaw);
    var sunThreshold = Math.max(0.78, lyricSunAvg + 0.20, lyricSunPeak * 0.74);
    var sunGate = clamp01((sunRaw - sunThreshold) / Math.max(0.08, 1.0 - sunThreshold));
    sunGate = sunGate * sunGate * (3 - 2 * sunGate);
    lyricSunHold += (sunGate - lyricSunHold) * (sunGate > lyricSunHold ? 0.035 : 0.014);
    lyricSunTarget = lyricSunHold > 0.16 ? clamp01((lyricSunHold - 0.16) / 0.84) : 0;
    lyricSunEnergy += (lyricSunTarget - lyricSunEnergy) * (lyricSunTarget > lyricSunEnergy ? 0.075 : 0.030);
  } else {
    smoothBass *= 0.91; smoothMid *= 0.91; smoothTreb *= 0.91; smoothEnergy *= 0.91; beatPulse *= 0.82;
    sonicDecayBands(dt);
    liveCamAvg *= 0.94;
    liveCamPeak = Math.max(0.28, liveCamPeak * 0.98);
    liveCamLastRaw *= 0.80;
    lyricSunTarget = 0;
    lyricSunHold *= 0.90;
    lyricSunEnergy *= 0.92;
    lyricSunAvg *= 0.995;
    lyricSunPeak = Math.max(0.48, lyricSunPeak * 0.997);
  }
  } // end audioStepDt gate
  if (window.__mineradioPerf && typeof window.__mineradioPerf.markSince === 'function') {
    window.__mineradioPerf.markSince('audio.analysis', audioPerfStart);
  }
  audioEnergy = Math.max(smoothEnergy, beatPulse * 0.30);
  bass = Math.min(0.90, smoothBass * 1.05 + beatPulse * 0.18) * fx.intensity;
  mid  = Math.min(0.72, smoothMid * 1.12) * fx.intensity;
  treble = Math.min(0.62, smoothTreb * 1.20) * fx.intensity;
  if (fx.preset >= 4) {
    var wallpaperAudio = fx.preset === 5 || fx.preset === 8 || fx.preset === 9;
    var ringBass = smoothBass * (wallpaperAudio ? 1.18 : 1.58) + beatPulse * (wallpaperAudio ? 0.22 : 0.42) - smoothMid * 0.16 - smoothTreb * 0.06;
    var ringMid = smoothMid * (wallpaperAudio ? 1.24 : 1.82) - smoothBass * 0.14 - smoothTreb * 0.07;
    var ringTreble = smoothTreb * (wallpaperAudio ? 1.42 : 2.28) - smoothMid * 0.10 - smoothBass * 0.05;
    bass = Math.pow(clamp01((ringBass - 0.050) / 0.58), 0.72) * fx.intensity;
    mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * fx.intensity;
    treble = Math.pow(clamp01((ringTreble - 0.030) / 0.34), 0.84) * fx.intensity;
    if (wallpaperAudio) {
      bass = Math.min(bass, 0.54 * fx.intensity);
      mid = Math.min(mid, 0.48 * fx.intensity);
      treble = Math.min(treble, 0.44 * fx.intensity);
      beatPulse *= 0.46;
    }
  }
  if (djMode.active) {
    bass = Math.min(1.00, bass * 1.06 + beatPulse * 0.085);
    mid = Math.min(0.76, mid * 1.00 + clamp01(djMode.sectionChange * 1.6) * 0.020);
    treble = Math.min(0.66, treble * 0.98);
    audioEnergy = Math.max(audioEnergy, beatPulse * 0.38, djMode.sectionEnergy * 0.54);
  }
  if (Mineradio.moodAudio && Mineradio.moodAudio.getVisualStrength && Mineradio.moodAudio.getVisualStrength() > 0.01) {
    // mood 节拍增益只在真实播放中注入：暂停时 tickSample 停止更新、state.smooth 冻结在暂停前的值，
    // 若仍每帧泵高 beatPulse，会与暂停分支的 *0.82 衰减形成 ~23Hz 锯齿振荡（uBeat/uBass/uEnergy 抖动 → 预设视觉抖动）。
    var moodBeatBoost = (playing && audio && !audio.paused && Mineradio.moodAudio.getBeatPulseBoost) ? Mineradio.moodAudio.getBeatPulseBoost() : 0;
    if (moodBeatBoost > 0) beatPulse = Math.min(0.92, beatPulse + moodBeatBoost * 0.10);
    if (uniforms && uniforms.uParticleDensity) {
      uniforms.uParticleDensity.value = clampRange(fx.particleCount * (Mineradio.moodAudio.getParticleDensityMul ? Mineradio.moodAudio.getParticleDensityMul() : 1), 0.3, 1.0);
    }
  } else if (uniforms && uniforms.uParticleDensity) {
    uniforms.uParticleDensity.value = fx.particleCount;
  }

  var vinylSpeedMul = isFinite(fx.speed) ? Math.max(0.05, fx.speed) : 1;
  var vinylSpinSpeed = (0.40 + smoothBass * 0.09) * vinylSpeedMul;
  uniforms.uVinylSpin.value = (uniforms.uVinylSpin.value + dt * vinylSpinSpeed) % (Math.PI * 2);

  updateParticlePointerFrame();
  // FFT 频谱纹理：对数重采样 + attack/release 平滑后写入 256×1 纹理（暂停时自然衰减归零）
  if (typeof updateParticleSpectrumTexture === 'function') updateParticleSpectrumTexture(dt);
  uniforms.uBass.value   = bass;
  uniforms.uMid.value    = mid;
  uniforms.uTreble.value = treble;
  uniforms.uBeat.value   = beatPulse;
  uniforms.uEnergy.value = audioEnergy;
  // 鼓点全局反馈：边缘光晕脉冲（仅经典预设，封面主色 + screen 混合）
  beatGlowIntensity *= Math.pow(0.84, dt * 60);
  if (fx.preset === 11 && beatOnsetFlag && beatPulse > 0.22) {
    beatGlowIntensity = Math.max(beatGlowIntensity, Math.min(0.95, beatPulse * 1.1 + bass * 0.15));
  }
  if (!beatGlowEl) {
    beatGlowEl = document.getElementById('beat-glow-overlay');
    if (beatGlowEl) beatGlowEl.style.setProperty('--beat-glow-rgb', beatGlowCoverRGB);
  }
  if (beatGlowEl) {
    var _bgOp = beatGlowIntensity * 0.5;
    if (_bgOp > 0.008) {
      var _bgOpStr = _bgOp.toFixed(3);
      if (beatGlowEl.style.opacity !== _bgOpStr) beatGlowEl.style.opacity = _bgOpStr;
    } else if (beatGlowEl.style.opacity !== '0') {
      beatGlowEl.style.opacity = '0';
    }
  }
  // 涟漪平面 uniform 同步
  if (ripplePlane && ripplePlane.visible) {
    ripplePlaneMat.uniforms.uTime.value = uniforms.uTime.value;
    ripplePlaneMat.uniforms.uBass.value = bass;
    ripplePlaneMat.uniforms.uMid.value = mid;
    ripplePlaneMat.uniforms.uTreble.value = treble;
    ripplePlaneMat.uniforms.uBeat.value = beatPulse;
    ripplePlaneMat.uniforms.uEnergy.value = audioEnergy;
    // 颜色：auto 模式用封面取色，custom 模式用涟漪专属颜色
    var rippleIsCustom = fx.rippleColorMode === 'custom';
    var pal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
    var rippleTintHex = rippleIsCustom
      ? (fx.rippleColor || fxDefaults.rippleColor || '#9db8cf')
      : (pal.secondary || pal.primary || fx.rippleColor || fxDefaults.rippleColor || '#9db8cf');
    // 仅在颜色源变化时才重新 parseColorToHex，避免每帧解析
    var rippleTintNorm;
    if (_rippleTintCache.hex === rippleTintHex && _rippleTintCache.norm) {
      rippleTintNorm = _rippleTintCache.norm;
    } else {
      rippleTintNorm = parseColorToHex(rippleTintHex, '#9db8cf');
      _rippleTintCache.hex = rippleTintHex;
      _rippleTintCache.norm = rippleTintNorm;
    }
    ripplePlaneMat.uniforms.uTintColor.value.set(rippleTintNorm);
    // 参数
    ripplePlaneMat.uniforms.uSpeedMul.value = fx.rippleSpeed != null ? fx.rippleSpeed : 1.0;
    ripplePlaneMat.uniforms.uDensityMul.value = fx.rippleDensity != null ? fx.rippleDensity : 1.0;
    ripplePlaneMat.uniforms.uBrightMul.value = fx.rippleBrightness != null ? fx.rippleBrightness : 1.0;
    ripplePlaneMat.uniforms.uWidthMul.value = fx.rippleWidth != null ? fx.rippleWidth : 1.0;
    ripplePlaneMat.uniforms.uRangeMul.value = fx.rippleRange != null ? fx.rippleRange : 1.0;
    // fade-in
    var fadeElapsed = (performance.now() - rippleFadeStart) / RIPPLE_FADE_DURATION;
    ripplePlaneMat.uniforms.uAlpha.value = Math.min(1, fadeElapsed);
  }
  // 黑洞引力透镜背景层（preset 8）：音频 uniform + 黑洞屏幕投影 + fade-in
  if (typeof blackHoleLensPlane !== 'undefined' && blackHoleLensPlane && blackHoleLensPlane.visible) {
    updateBlackHoleLensFrame(camera);
  }
  uniforms.uMouseXY.value.set(mouseWorld.x, mouseWorld.y);
  uniforms.uMouseActive.value = mouseActive ? 1 : 0;
  var skullBackdropDim = fx && fx.preset === SKULL_PRESET_INDEX ? 0.58 : 1;
  var shelfDimTarget = shouldDimWallpaperForShelf() ? 0.48 : skullBackdropDim;
  var shelfDimEase = shelfDimTarget < uniforms.uParticleDim.value ? 0.18 : 0.10;
  uniforms.uParticleDim.value += (shelfDimTarget - uniforms.uParticleDim.value) * Math.min(1, shelfDimEase * Math.max(1, dt * 60));

  // 通用转场脉冲: 只作为切换预设时的短促提亮。
  uniforms.uBurstAmt.value *= 0.90;
  tickPresetTransition();

  updateRipples(dt);
  updateFloatLayer(dt);
  var shelfStepDt = consumeFrameGate(mainFrameGates.shelf, now, dt, targetMainShelfFps(now), false, 'shelf-manager');
  if (shelfStepDt > 0 && shelfManager) shelfManager.update(shelfStepDt);
  var lyricsParticleStepDt = consumeFrameGate(mainFrameGates.lyricsParticles, now, dt, targetMainLyricsParticleFps(now), false, 'lyrics-particles');
  if (lyricsParticleStepDt > 0) tickLyricsParticles();
  var homeAudioStepDt = consumeFrameGate(mainFrameGates.homeAudio, now, dt, targetMainHomeAudioFps(now), false, 'home-audio');
  if (homeAudioStepDt > 0) updateHomeAudioVisual(homeAudioStepDt);

  // 电影镜头
  updateCinema(dt);
  updateFreeCamera(dt);
  updateCamera();
  applySkullCameraPose(dt);

  // v7.2 旋转 = 头部+眼球追踪 + 鼠标/手势拖动 + 惯性
  tickGestureRotation(dt);
  var skullPresetActive = fx && fx.preset === SKULL_PRESET_INDEX;
  var sonicPresetActive = isSonicTopographyPresetActive();
  var ripplePresetActive = fx && fx.preset === 9;
  var classicPresetActive = isClassicPresetActive();
  var hideParticles = skullPresetActive || sonicPresetActive || ripplePresetActive || classicPresetActive;
  particles.visible = !hideParticles;
  if (bloomParticles) bloomParticles.visible = !hideParticles && fx.bloom && fx.bloomStrength > 0.01;
  if (floatGroup) floatGroup.visible = !hideParticles;
  if (backCoverGroup) backCoverGroup.visible = !hideParticles;
  var targetRotY = orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + gestureRotation.y;
  var targetRotX = orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) + gestureRotation.x;
  particles.rotation.y += (targetRotY - particles.rotation.y) * 0.055;
  particles.rotation.x += (targetRotX - particles.rotation.x) * 0.055;
  if (bloomParticles) {
    bloomParticles.rotation.copy(particles.rotation);
  }
  // 同步给背面粒子层
  if (floatGroup) {
    floatGroup.rotation.copy(particles.rotation);
  }
  if (backCoverGroup) {
    backCoverGroup.rotation.copy(particles.rotation);
  }
  var skullStepDt = consumeFrameGate(mainFrameGates.skullParticles, now, dt, targetMainSkullParticleFps(now), false, 'skull-particles');
  if (skullStepDt > 0) updateSkullParticleLayer(skullStepDt);
  var stageLyricsPerfStart = performance.now();
  var stageLyricsStepDt = consumeFrameGate(mainFrameGates.stageLyrics, now, dt, targetMainStageLyricsFps(now), false, 'stage-lyrics');
  if (stageLyricsStepDt > 0) {
    updateStageLyrics3D(stageLyricsStepDt);
    updateClassicPlayerLyrics();
    updateInterludeWave(stageLyricsStepDt);
  }
  if (window.__mineradioPerf && typeof window.__mineradioPerf.markSince === 'function') {
    window.__mineradioPerf.markSince('visual.stage-lyrics', stageLyricsPerfStart);
  }
  if (typeof MineradioSonicTopography !== 'undefined') {
    MineradioSonicTopography.update(dt, {
      scene: scene,
      fx: fx,
      audio: {
        sonicDetailed: true,
        subBass: sonicBandSmooth.subBass,
        bass: sonicBandSmooth.bass,
        lowMid: sonicBandSmooth.lowMid,
        mid: sonicBandSmooth.mid,
        highMid: sonicBandSmooth.highMid,
        presence: sonicBandSmooth.presence,
        brilliance: sonicBandSmooth.brilliance,
        air: sonicBandSmooth.air,
        treble: treble,
        kickEnvelope: beatPulse,
        energy: audioEnergy,
        sharpness: sonicDerived.sharpness,
        smoothness: 1.0 - treble * 0.42 + mid * 0.14,
        density: sonicDerived.density
      },
      time: uniforms.uTime.value,
      visualRotation: { x: particles.rotation.x, y: particles.rotation.y },
      visualRotationActive: orbit.rotating
    });
  }
  var desktopOverlayStepDt = consumeFrameGate(mainFrameGates.desktopOverlay, now, dt, targetMainDesktopOverlayFps(now), false, 'desktop-overlay');
  if (desktopOverlayStepDt > 0) syncDesktopOverlayState();

  // 缩略图脉动
  if (currentIdx >= 0) {
    var s = 1 + bass * 0.08;
    // 量化到 0.001 步长，避免每帧写入几乎相同的 transform 字符串
    var sStr = 'scale(' + (Math.round(s * 1000) / 1000) + ')';
    if (sStr !== _thumbCoverLastScaleStr) {
      if (!_thumbCoverEl) _thumbCoverEl = document.getElementById('thumb-cover');
      if (_thumbCoverEl) {
        _thumbCoverEl.style.transform = sStr;
        _thumbCoverLastScaleStr = sStr;
      }
    }
  }

  // 黑洞预设（preset 8）：先在离屏半分辨率 RT 上完成 raymarching，再进主渲染
  if (typeof blackHoleLensPlane !== 'undefined' && blackHoleLensPlane && blackHoleLensPlane.visible && typeof renderBlackHoleLensRT === 'function') {
    renderBlackHoleLensRT(camera);
  }
  var rendererPerfStart = performance.now();
  renderer.render(scene, camera);
  updateLiquidGlassBackdropMirror();
  if (window.__mineradioPerf && typeof window.__mineradioPerf.markSince === 'function') {
    window.__mineradioPerf.markSince('renderer.render', rendererPerfStart);
    window.__mineradioPerf.markSince('frame.total', framePerfStart);
  }
}
// LiquidGlass 玻璃背景镜像：渲染后同帧同步 blit 主 WebGL canvas 到 2D 镜像，
// 供玻璃 shader 采样真实页面背景（主 canvas 无 preserveDrawingBuffer，
// 异步读取只会得到黑帧，必须在同一渲染回调内拷贝）。
var _lgMirrorCanvas = null;
var _lgMirrorCtx = null;
var _lgMirrorFrame = 0;
var _lgMirrorBgColor = '#000';
var _lgMirrorBgColorAt = 0;
var _lgMirrorRectAt = 0;
function liquidGlassMirrorBlitStride() {
  var quality = (typeof resolvedPerformanceQuality === 'function') ? resolvedPerformanceQuality() : 'balanced';
  if (quality === 'eco') return 6;
  if (quality === 'balanced') return 4;
  if (quality === 'ultra') return 2;
  return 3;
}
function liquidGlassHasActiveMirrorTargets(mgr) {
  if (!mgr || !mgr._instances) return false;
  for (var k in mgr._instances) {
    if (!Object.prototype.hasOwnProperty.call(mgr._instances, k)) continue;
    var e = mgr._instances[k];
    if (!e || !e.instance || !e.instance._running) continue;
    var els = e.elements;
    if (!els || !els.length) {
      try {
        var sel = e.config && e.config.glassSelector;
        if (sel) els = document.querySelectorAll(sel);
      } catch (_) { els = null; }
    }
    if (!els || !els.length) return true;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || !el.getClientRects) continue;
      try {
        if (el.getClientRects().length) return true;
      } catch (_) {}
    }
  }
  return false;
}
function updateLiquidGlassBackdropMirror() {
  var mgr = window._liquidGlassMgr;
  if (!mgr || !mgr._instances || !Object.keys(mgr._instances).length) return;
  if (!liquidGlassHasActiveMirrorTargets(mgr)) return;
  var src = renderer.domElement;
  if (!src || src.width <= 0 || src.height <= 0) return;
  if (!_lgMirrorCanvas) {
    _lgMirrorCanvas = document.createElement('canvas');
    _lgMirrorCtx = _lgMirrorCanvas.getContext('2d');
    window.__lgBackdropCanvas = _lgMirrorCanvas;
    window.__lgBackdropRect = { left: 0, top: 0, scale: 1 };
    _lgMirrorRectAt = 0;
  }
  var stride = liquidGlassMirrorBlitStride();
  var quality = (typeof resolvedPerformanceQuality === 'function') ? resolvedPerformanceQuality() : 'balanced';
  var sampleScale = (quality === 'eco') ? 0.5 : ((quality === 'balanced') ? 0.75 : 1);
  var targetW = Math.max(1, Math.round(src.width * sampleScale));
  var targetH = Math.max(1, Math.round(src.height * sampleScale));
  if (_lgMirrorCanvas.width !== targetW || _lgMirrorCanvas.height !== targetH) {
    _lgMirrorCanvas.width = targetW;
    _lgMirrorCanvas.height = targetH;
    _lgMirrorRectAt = 0;
  }
  // 背景是动态的（音乐律动），blit 与玻璃重采样同频节流；无可见玻璃时已早退
  if ((_lgMirrorFrame++ % stride) !== 0) return;
  var info = window.__lgBackdropRect;
  if (!info) { info = window.__lgBackdropRect = { left: 0, top: 0, scale: 1 }; }
  var nowMs = performance.now();
  // 画布位置/缩放仅在窗口布局变化后读取（1s 兜底刷新），不再每帧 getBoundingClientRect
  if (!_lgMirrorRectAt || (nowMs - _lgMirrorRectAt) > 1000) {
    var r = src.getBoundingClientRect();
    info.left = r.left; info.top = r.top;
    info.scale = r.width > 0 ? targetW / r.width : sampleScale;
    _lgMirrorRectAt = nowMs;
  } else if (Math.abs((info.scale || 0) - (targetW / Math.max(1, src.clientWidth || targetW))) > 0.02) {
    info.scale = src.clientWidth > 0 ? targetW / src.clientWidth : sampleScale;
  }
  var W = _lgMirrorCanvas.width, H = _lgMirrorCanvas.height;
  // 合成完整页面背景：壁纸底色 + 壁纸视频（cover）+ 主视觉 WebGL canvas（透明叠层）
  // CSS 变量读结果缓存 2s，避免每帧 getComputedStyle
  if (!_lgMirrorBgColorAt || (nowMs - _lgMirrorBgColorAt) > 2000) {
    _lgMirrorBgColor = (getComputedStyle(document.documentElement).getPropertyValue('--custom-bg-color') || '').trim() || '#000';
    _lgMirrorBgColorAt = nowMs;
  }
  _lgMirrorCtx.fillStyle = _lgMirrorBgColor;
  _lgMirrorCtx.fillRect(0, 0, W, H);
  var vid = document.getElementById('custom-bg-video');
  if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
    var vscale = Math.max(W / vid.videoWidth, H / vid.videoHeight);
    var vsw = W / vscale, vsh = H / vscale;
    try {
      _lgMirrorCtx.drawImage(vid, (vid.videoWidth - vsw) / 2, (vid.videoHeight - vsh) / 2, vsw, vsh, 0, 0, W, H);
    } catch (_) {}
  }
  try {
    _lgMirrorCtx.drawImage(src, 0, 0, W, H);
  } catch (_) {
    _lgMirrorCtx.drawImage(src, 0, 0);
  }
  for (var k in mgr._instances) {
    var e = mgr._instances[k];
    if (e && e.instance && e.instance._running) {
      e.instance._globalDirty = true;
    }
  }
}
animate();
