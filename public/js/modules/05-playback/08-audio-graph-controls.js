// ============================================================
//  音频上下文 & 频谱分析
// ============================================================
var audioWorkletAnalysis = null; // AudioWorklet 分析桥接器
var audioSourceMedia = null;
var analysisSinkNode = null;

function audioGraphHealthy() {
  return !!(audio && audioReady && audioCtx && audioCtx.state !== 'closed' && source && audioSourceMedia === audio && analyser && beatAnalyser && gainNode);
}
function disconnectAudioGraphNodes(keepSource) {
  [source, analyser, beatAnalyser, gainNode, analysisSinkNode].forEach(function (node) {
    if (!node) return;
    try { node.disconnect(); } catch (e) { }
  });
  if (!keepSource) {
    source = null;
    audioSourceMedia = null;
  }
  analyser = null;
  beatAnalyser = null;
  gainNode = null;
  analysisSinkNode = null;
  audioReady = false;
}
function resetPlaybackAudioGraphForSourceSwitch(reason) {
  disconnectAudioGraphNodes(false);
}

function initAudio() {
  if (!audio) return false;
  if (audioReady && audioGraphHealthy()) return true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  source = audioCtx.createMediaElementSource(audio);
  audioSourceMedia = audio;
  try { audio.__mineradioMediaSourceBound = true; } catch (_) {}
  var moodExit = (Mineradio.moodAudio && Mineradio.moodAudio.installChain)
    ? Mineradio.moodAudio.installChain(audioCtx, source)
    : null;
  analyser = audioCtx.createAnalyser();
  beatAnalyser = audioCtx.createAnalyser();
  gainNode = audioCtx.createGain();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.58;
  beatAnalyser.fftSize = BEAT_FFT_SIZE;
  beatAnalyser.smoothingTimeConstant = 0.10;
  var audioTap = moodExit || source;
  // 播放链路与分析旁路分离：Analyser 不串在出声路径上，Worklet 生效后可降载/断开主频谱
  audioTap.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  audioTap.connect(analyser);
  audioTap.connect(beatAnalyser);
  applyVolumeToAudio();
  frequencyData.fill(0);
  beatFrequencyData.fill(0);
  beatTimeDomainData.fill(128);
  resetRealtimeBeatEngine();

  // 初始化 AudioWorklet 分析器（PCM → FFT/频段/onset，主线程只收特征）
  if (ENABLE_AUDIO_WORKLET_ANALYSIS && typeof Mineradio !== 'undefined' && Mineradio.AudioWorkletAnalysis) {
    audioWorkletAnalysis = new Mineradio.AudioWorkletAnalysis();
    audioWorkletAnalysis.init(audioCtx, audioTap).then(function (ok) {
      if (ok) {
        audioWorkletAnalysis.onFeatures = onAudioWorkletFeatures;
        audioWorkletAnalysis.start();
        // Worklet 已接管主循环热路径：缩小 Analyser 频谱规模，仅保留可视化兜底采样
        try {
          analyser.fftSize = Math.min(FFT_SIZE, 512);
          if (beatAnalyser) beatAnalyser.fftSize = Math.min(BEAT_FFT_SIZE, 1024);
          if (typeof frequencyData === 'undefined' || !frequencyData || frequencyData.length !== analyser.frequencyBinCount) {
            frequencyData = new Uint8Array(analyser.frequencyBinCount);
            timeDomainData = new Uint8Array(analyser.fftSize);
          }
          if (typeof beatFrequencyData === 'undefined' || !beatFrequencyData || beatFrequencyData.length !== beatAnalyser.frequencyBinCount) {
            beatFrequencyData = new Uint8Array(beatAnalyser.frequencyBinCount);
            beatTimeDomainData = new Uint8Array(beatAnalyser.fftSize);
          }
        } catch (_) {}
        console.log('[AudioWorklet] Analysis started (PCM path)');
      } else {
        console.warn('[AudioWorklet] Init failed, using main-thread fallback');
        audioWorkletAnalysis = null;
      }
    }).catch(function (e) {
      console.warn('[AudioWorklet] Init error:', e);
      audioWorkletAnalysis = null;
    });
  }

  audioReady = true;
  return true;
}
function resumeAudioAnalysis() {
  if (audioCtx && audioCtx.state === 'suspended') return audioCtx.resume().catch(function(e){ console.warn('audio context resume failed:', e); });
  return Promise.resolve();
}

function ensureUiSfxContext() {
  var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!uiSfxCtx || uiSfxCtx.state === 'closed') uiSfxCtx = new AudioContextCtor();
  if (uiSfxCtx.state === 'suspended' && uiSfxCtx.resume) uiSfxCtx.resume().catch(function(){});
  return uiSfxCtx;
}

function playShelfSelectTick(direction, variant) {
  var nowMs = performance.now();
  var minGap = variant === 'row' ? 36 : 42;
  if (nowMs - lastShelfSelectSfxAt < minGap) return;
  var ctx = ensureUiSfxContext();
  if (!ctx) return;
  lastShelfSelectSfxAt = nowMs;
  var dir = direction < 0 ? -1 : 1;
  var pitch = dir > 0 ? 1.035 : 0.965;
  var rowScale = variant === 'row' ? 0.74 : 1.0;
  var volumeScale = 0.38 + Math.max(0, Math.min(1, targetVolume == null ? 0.65 : targetVolume)) * 0.62;
  var t = ctx.currentTime + 0.002;
  var out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(0.058 * rowScale * volumeScale, t + 0.002);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.082);
  out.connect(ctx.destination);

  var sampleRate = ctx.sampleRate || 44100;
  var len = Math.max(1, Math.floor(sampleRate * 0.034));
  var buf = ctx.createBuffer(1, len, sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < len; i++) {
    var e = Math.pow(1 - i / len, 4.2);
    data[i] = (Math.random() * 2 - 1) * e;
  }
  var noise = ctx.createBufferSource();
  noise.buffer = buf;
  var hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(4200 * pitch, t);
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(8400 * pitch, t);
  bp.Q.setValueAtTime(7.2, t);
  var ng = ctx.createGain();
  ng.gain.setValueAtTime(0.56, t);
  noise.connect(hp);
  hp.connect(bp);
  bp.connect(ng);
  ng.connect(out);
  noise.start(t);
  noise.stop(t + 0.040);

  function clickOsc(type, freq, delay, dur, gainValue, bend) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var start = t + delay;
    var end = start + dur;
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pitch, start);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch * (bend || 0.72), end);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gainValue, start + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(end + 0.004);
  }

  clickOsc('triangle', 720, 0.000, 0.030, 0.18, 0.70);
  clickOsc('square', 2180, 0.004, 0.022, 0.30, 0.86);
  clickOsc('triangle', 4200, 0.011, 0.018, 0.18, 0.94);
  clickOsc('square', 7100, 0.018, 0.012, 0.070, 0.98);
  setTimeout(function(){
    try { out.disconnect(); } catch (_) {}
  }, 160);
}

function clearAudioFadeTimers() {
  if (audioFadeTimer) {
    clearTimeout(audioFadeTimer);
    audioFadeTimer = null;
  }
  if (audioElementFadeFrame) {
    cancelAnimationFrame(audioElementFadeFrame);
    audioElementFadeFrame = 0;
  }
}
function currentAudioOutputGain() {
  if (gainNode && gainNode.gain && isFinite(gainNode.gain.value)) return clampRange(Number(gainNode.gain.value), 0, 1);
  if (audio && isFinite(audio.volume)) return clampRange(Number(audio.volume), 0, 1);
  return clampRange(targetVolume, 0, 1);
}
function audioSilentFloor() {
  return targetVolume > 0.001 ? AUDIO_SILENCE_GAIN : 0;
}
function normalizeAudioFadeTarget(value) {
  value = clampRange(Number(value) || 0, 0, 1);
  return value <= 0.001 ? audioSilentFloor() : value;
}
function holdAudioOutputGain(now) {
  var current = currentAudioOutputGain();
  if (!gainNode || !audioCtx || !gainNode.gain) return current;
  var param = gainNode.gain;
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
      return currentAudioOutputGain();
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  } catch (e) {
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    } catch (_) {}
  }
  return current;
}
function setAudioOutputGainImmediate(value) {
  value = normalizeAudioFadeTarget(value);
  clearAudioFadeTimers();
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(value, now);
  } else if (audio) {
    audio.volume = value;
  }
}
function rampAudioOutputGain(value, durationMs) {
  value = normalizeAudioFadeTarget(value);
  durationMs = Math.max(0, Number(durationMs) || 0);
  clearAudioFadeTimers();
  var serial = audioFadeSerial;
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    holdAudioOutputGain(now);
    if (durationMs <= 0) {
      gainNode.gain.setValueAtTime(value, now);
      return;
    }
    gainNode.gain.linearRampToValueAtTime(value, now + durationMs / 1000);
    return;
  }
  if (!audio) return;
  var from = currentAudioOutputGain();
  var started = performance.now();
  function tickAudioFade(nowMs) {
    if (serial !== audioFadeSerial || !audio) return;
    var t = durationMs ? clampRange((nowMs - started) / durationMs, 0, 1) : 1;
    var eased = 1 - Math.pow(1 - t, 3);
    audio.volume = from + (value - from) * eased;
    if (t < 1) audioElementFadeFrame = requestAnimationFrame(tickAudioFade);
    else audioElementFadeFrame = 0;
  }
  audioElementFadeFrame = requestAnimationFrame(tickAudioFade);
}
function preparePlaybackFadeIn() {
  audioFadeSerial++;
  setAudioOutputGainImmediate(0);
}
function startPlaybackFadeIn() {
  audioFadeSerial++;
  if (targetVolume <= 0.001) {
    setAudioOutputGainImmediate(0);
    return;
  }
  rampAudioOutputGain(targetVolume, AUDIO_FADE_IN_MS);
}
function restorePlaybackGain() {
  audioFadeSerial++;
  setAudioOutputGainImmediate(targetVolume);
}
function fadeOutAndPauseAudio() {
  if (!audio || audio.paused) return Promise.resolve(false);
  var serial = ++audioFadeSerial;
  rampAudioOutputGain(0, AUDIO_FADE_OUT_MS);
  return new Promise(function(resolve) {
    audioFadeTimer = setTimeout(function(){
      audioFadeTimer = null;
      if (serial !== audioFadeSerial || !audio) {
        resolve(false);
        return;
      }
      try { audio.pause(); } catch (pauseErr) { console.warn('[TogglePlayPause]', pauseErr); }
      setAudioOutputGainImmediate(0);
      resolve(true);
    }, AUDIO_FADE_OUT_MS + 80);
  });
}

/** 音量 UI/听感 spring 状态：拖动 1:1；滚轮/键盘/静音可中断追击 */
var volumeMotionState = { v: 1 };
var volumeSpringSerial = 0;
var volumeSpringActive = false;
var VOLUME_SPRING_MIN_DELTA = 0.008;

function killVolumeUiSpring() {
  volumeSpringSerial += 1;
  volumeSpringActive = false;
  volumeMotionState._springRunning = false;
  if (window.MineradioMotion && typeof window.MineradioMotion.killAll === 'function') {
    window.MineradioMotion.killAll(volumeMotionState);
  }
}

function applyVolumeLevel(level) {
  level = clampRange(Number(level) || 0, 0, 1);
  if (audio) {
    audio.muted = false;
    audio.volume = gainNode ? 1 : level;
  }
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(level, now);
    } catch (_) {}
  }
}

function applyVolumeToAudio() {
  if (audio) {
    audio.muted = false;
    audio.volume = gainNode ? 1 : targetVolume;
  }
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(targetVolume, now, 0.025);
  }
}

function updateVolumeUiFrom(level) {
  level = clampRange(Number(level) || 0, 0, 1);
  var slider = document.getElementById('volume-slider');
  var value = document.getElementById('volume-value');
  var icon = document.getElementById('volume-icon');
  var wrap = document.getElementById('volume-control');
  var pct = Math.round(level * 100);
  if (slider && Math.abs(parseFloat(slider.value) - level) > 0.001) slider.value = level;
  if (value) value.textContent = pct + '%';
  if (wrap) wrap.classList.toggle('muted', level <= 0.01);
  if (icon) {
    icon.innerHTML = level <= 0.01
      ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="17" y1="9" x2="22" y2="14"/><line x1="22" y1="9" x2="17" y2="14"/>'
      : level < 0.45
        ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 10.5a2 2 0 0 1 0 3"/>'
        : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>';
  }
}

function updateVolumeUi() {
  updateVolumeUiFrom(volumeSpringActive ? volumeMotionState.v : targetVolume);
  updateAudioFadeUi();
}

function springVolumeUiTo(next, silent) {
  var M = window.MineradioMotion;
  next = clampRange(Number(next) || 0, 0, 1);
  if (!M || typeof M.springTo !== 'function' || (M.prefersReducedMotion && M.prefersReducedMotion())) {
    killVolumeUiSpring();
    volumeMotionState.v = next;
    volumeMotionState._springRunning = false;
    applyVolumeToAudio();
    updateVolumeUi();
    if (!silent) showToast('音量 ' + Math.round(next * 100) + '%');
    return;
  }
  var from = clampRange(Number(volumeMotionState.v), 0, 1);
  if (!isFinite(from)) from = currentAudioOutputGain();
  if (!volumeMotionState._springRunning && Math.abs(from - next) < VOLUME_SPRING_MIN_DELTA) {
    volumeMotionState.v = next;
    applyVolumeToAudio();
    updateVolumeUi();
    if (!silent) showToast('音量 ' + Math.round(next * 100) + '%');
    return;
  }
  var serial = ++volumeSpringSerial;
  volumeSpringActive = true;
  var springOpts = {
    preset: M.SPRING.snappy,
    apply: function (v) {
      if (serial !== volumeSpringSerial) return;
      volumeMotionState.v = v;
      applyVolumeLevel(v);
      updateVolumeUiFrom(v);
    },
    onComplete: function () {
      if (serial !== volumeSpringSerial) return;
      volumeSpringActive = false;
      volumeMotionState._springRunning = false;
      volumeMotionState.v = targetVolume;
      applyVolumeToAudio();
      updateVolumeUi();
      if (!silent) showToast('音量 ' + Math.round(targetVolume * 100) + '%');
    }
  };
  // 首段带 from；滚轮/键盘改向不传 from，保留速度接力
  if (!volumeMotionState._springRunning) {
    springOpts.from = from;
    volumeMotionState._springRunning = true;
  }
  M.springTo(volumeMotionState, 'v', next, springOpts);
}

function saveAudioFadePreference() {
  try { localStorage.setItem('mineradio-audio-fade-v1', JSON.stringify({ in: AUDIO_FADE_IN_MS, out: AUDIO_FADE_OUT_MS })); } catch (_) { }
}
function normalizeAudioFadeMs(ms, fallback) {
  ms = Math.round(Number(ms) || 0);
  return ms > 0 ? ms : fallback;
}
function audioFadeSecondsLabel(ms) {
  ms = normalizeAudioFadeMs(ms, 0);
  return (ms / 1000).toFixed(ms % 1000 ? 2 : 1).replace(/0$/, '') + 's';
}
function updateAudioFadeUi() {
  var fadeInSlider = document.getElementById('fade-in-slider');
  var fadeOutSlider = document.getElementById('fade-out-slider');
  var fadeInValue = document.getElementById('fade-in-value');
  var fadeOutValue = document.getElementById('fade-out-value');
  var inSeconds = (AUDIO_FADE_IN_MS / 1000).toFixed(2);
  var outSeconds = (AUDIO_FADE_OUT_MS / 1000).toFixed(2);
  if (fadeInSlider && Math.abs(Number(fadeInSlider.value) - Number(inSeconds)) > 0.001) fadeInSlider.value = inSeconds;
  if (fadeOutSlider && Math.abs(Number(fadeOutSlider.value) - Number(outSeconds)) > 0.001) fadeOutSlider.value = outSeconds;
  if (fadeInValue) fadeInValue.textContent = audioFadeSecondsLabel(AUDIO_FADE_IN_MS);
  if (fadeOutValue) fadeOutValue.textContent = audioFadeSecondsLabel(AUDIO_FADE_OUT_MS);
}
function setAudioFadeSetting(kind, seconds, silent) {
  var ms = normalizeAudioFadeMs(Number(seconds) * 1000, kind === 'in' ? 460 : 420);
  if (kind === 'in') AUDIO_FADE_IN_MS = ms;
  else AUDIO_FADE_OUT_MS = ms;
  saveAudioFadePreference();
  updateAudioFadeUi();
  if (!silent) showToast((kind === 'in' ? '淡入 ' : '淡出 ') + audioFadeSecondsLabel(ms));
}

function setVolume(value, silent, opts) {
  opts = opts || {};
  var next = Math.max(0, Math.min(1, Number(value) || 0));
  targetVolume = next;
  if (next > 0.01) lastNonZeroVolume = next;
  try { localStorage.setItem('apex-player-volume', String(next)); } catch (e) {}
  if (opts.spring) {
    springVolumeUiTo(next, !!silent);
    return;
  }
  killVolumeUiSpring();
  volumeMotionState.v = next;
  applyVolumeToAudio();
  updateVolumeUi();
  if (!silent) showToast('音量 ' + Math.round(next * 100) + '%');
}
function adjustVolumeByKeyboard(delta) {
  var step = Number(delta) || 0;
  if (!step) return;
  setVolume(clampRange(targetVolume + step, 0, 1), false, { spring: true });
}
function adjustVolumeByWheel(e) {
  if (!e) return;
  e.preventDefault();
  e.stopPropagation();
  var step = 0.01;
  var direction = e.deltaY < 0 ? 1 : -1;
  var wrap = document.getElementById('volume-control');
  if (wrap) {
    wrap.classList.add('open');
    if (volumeCloseTimer) clearTimeout(volumeCloseTimer);
    volumeCloseTimer = setTimeout(function () {
      volumeCloseTimer = null;
      if (wrap && !wrap.matches(':hover')) wrap.classList.remove('open');
    }, 1200);
  }
  setVolume(clampRange(targetVolume + direction * step, 0, 1), false, { spring: true });
}

function toggleVolumePanel(e) {
  if (e) e.stopPropagation();
  var wrap = document.getElementById('volume-control');
  if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
  if (!wrap) return;
  var open = !wrap.classList.contains('open');
  wrap.classList.toggle('open', open);
  var pop = wrap.querySelector('.volume-popover');
  if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
    window.MineradioMotion.springPopover(pop, open);
  }
}

function toggleMute() {
  setVolume(targetVolume > 0.01 ? 0 : (lastNonZeroVolume || 0.8), false, { spring: true });
}

function bindVolumeControls() {
  var slider = document.getElementById('volume-slider');
  var fadeInSlider = document.getElementById('fade-in-slider');
  var fadeOutSlider = document.getElementById('fade-out-slider');
  var btn = document.getElementById('volume-btn');
  var wrap = document.getElementById('volume-control');
  function keepVolumePanelOpen() {
    if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
    if (wrap && !wrap.classList.contains('sibling-suppressed')) {
      wrap.classList.add('open');
      var pop = wrap.querySelector('.volume-popover');
      if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
        window.MineradioMotion.springPopover(pop, true);
      }
    }
  }
  function closeVolumePanelSoon() {
    if (volumeCloseTimer) clearTimeout(volumeCloseTimer);
    volumeCloseTimer = setTimeout(function(){
      volumeCloseTimer = null;
      if (wrap && !wrap.classList.contains('sibling-suppressed')) {
        wrap.classList.remove('open');
        var pop = wrap.querySelector('.volume-popover');
        if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
          window.MineradioMotion.springPopover(pop, false);
        }
      }
    }, 520);
  }
  if (wrap) {
    wrap.addEventListener('mouseenter', keepVolumePanelOpen);
    wrap.addEventListener('mouseleave', closeVolumePanelSoon);
  }
  if (slider) {
    slider.addEventListener('pointerdown', function () {
      killVolumeUiSpring();
      volumeMotionState.v = targetVolume;
    });
    slider.addEventListener('input', function () { setVolume(slider.value, true); });
    slider.addEventListener('focus', keepVolumePanelOpen);
    slider.addEventListener('blur', closeVolumePanelSoon);
    slider.addEventListener('change', function () { showToast('音量 ' + Math.round(targetVolume * 100) + '%'); });
  }
  if (fadeInSlider) {
    fadeInSlider.addEventListener('input', function(){ setAudioFadeSetting('in', fadeInSlider.value, true); });
    fadeInSlider.addEventListener('focus', keepVolumePanelOpen);
    fadeInSlider.addEventListener('blur', closeVolumePanelSoon);
    fadeInSlider.addEventListener('change', function(){ setAudioFadeSetting('in', fadeInSlider.value, false); });
  }
  if (fadeOutSlider) {
    fadeOutSlider.addEventListener('input', function(){ setAudioFadeSetting('out', fadeOutSlider.value, true); });
    fadeOutSlider.addEventListener('focus', keepVolumePanelOpen);
    fadeOutSlider.addEventListener('blur', closeVolumePanelSoon);
    fadeOutSlider.addEventListener('change', function(){ setAudioFadeSetting('out', fadeOutSlider.value, false); });
  }
  if (btn) {
    btn.addEventListener('dblclick', function(e){ e.stopPropagation(); toggleMute(); });
  }
  if (wrap && !wrap._wheelBound) {
    wrap._wheelBound = true;
    wrap.addEventListener('wheel', adjustVolumeByWheel, { passive: false });
  }
  document.addEventListener('click', function(e){
    if (!wrap) return;
    if (!wrap.contains(e.target)) {
      if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
      wrap.classList.remove('open');
    }
  });
  updateVolumeUi();
  updateAudioFadeUi();
  volumeMotionState.v = targetVolume;
  applyVolumeToAudio();
}

