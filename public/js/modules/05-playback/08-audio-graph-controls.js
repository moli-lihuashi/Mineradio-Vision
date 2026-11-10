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
  /* 独立调音链（10 段 EQ / 前级增益 / 响度对齐 / 声道平衡 / 防爆音）：
     插在 moodExit 与 gainNode 之间，只接管自己的节点，绝不写 gainNode。
     gainNode 上挂着音量、播放/暂停淡变、曲末淡出与 Cuefield A deck 淡出。 */
  if (typeof Mineradio !== 'undefined' && Mineradio.audioTuning && Mineradio.audioTuning.install) {
    try {
      audioTap = Mineradio.audioTuning.install(audioCtx, audioTap) || audioTap;
      Mineradio.audioTuning.bindMedia(audio);
    } catch (e) {
      console.warn('[AudioTuning] install skipped:', e);
    }
  }
  // 音频图（重新）建好后重挂变速：load() 会把 playbackRate 恢复成 defaultPlaybackRate
  if (typeof Mineradio !== 'undefined' && Mineradio.playbackAdvanced && Mineradio.playbackAdvanced.bindMedia) {
    try { Mineradio.playbackAdvanced.bindMedia(audio); } catch (e) {}
  }
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
  cancelAudioOutputCurve();
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(value, now);
  } else if (audio) {
    audio.volume = value;
  }
}
/* ──────────────────────────────────────────────────────────────────────────
 * 淡变基础层
 * 借鉴的是设计点（显式包络曲线 / 曲末提前触发），实现完全是我们自己的 Web Audio。
 *
 * 历史缺陷 1：Cuefield 双 deck 交叉淡入里有 5 处 writeAudioOutputGain(...) 调用，
 *   但这个函数从未定义 → A deck（当前曲）在过渡时完全不淡出，只有 B deck 淡入，
 *   两首歌满音量叠加、浑浊爆音，结束时旧曲也不会归零。这里补上统一写入口。
 * 历史缺陷 2：旧 linearRampToValueAtTime 靠 cancelAndHoldAtTime 隐式推断起点，
 *   与 applyVolumeToAudio() 留下的永久 setTargetAtTime 叠加时起点算错、曲线被拉回，
 *   表现就是「暂停/播放没有淡入淡出」。改成显式 setValueCurveAtTime 采样级排程。
 * ────────────────────────────────────────────────────────────────────────── */
var audioFadeCurveActive = false;
var audioFadeCurveToken = 0;
var audioFadeCurveTimer = 0;

function cancelAudioOutputCurve() {
  audioFadeCurveToken++;
  audioFadeCurveActive = false;
  if (audioFadeCurveTimer) { clearTimeout(audioFadeCurveTimer); audioFadeCurveTimer = 0; }
  if (gainNode && audioCtx && gainNode.gain) {
    try { gainNode.gain.cancelScheduledValues(audioCtx.currentTime || 0); } catch (_) {}
  }
}

/* 立即把输出增益钉到 value。Cuefield 的 A deck 会逐帧调用，所以只在
   「有曲线在飞」时才清一次排程，其余情况直接写 .value，避免每帧堆事件。 */
function writeAudioOutputGain(value) {
  value = normalizeAudioFadeTarget(value);
  if (audioFadeCurveActive) cancelAudioOutputCurve();
  if (gainNode && audioCtx && gainNode.gain) {
    try { gainNode.gain.value = value; } catch (_) {}
  } else if (audio) {
    audio.volume = value;
  }
  return value;
}

/* 等功率感知曲线 sin(pi/2 * t)：淡入快起慢收、淡出快降慢收，两端平滑，
   交叉淡入时不会出现线性幅度 ramp 的中间音量凹陷。curve[0]=from, [last]=to。 */
function buildAudioFadeCurve(from, to, kind) {
  var frames = 96;
  var curve = new Float32Array(frames);
  var delta = to - from;
  for (var i = 0; i < frames; i++) {
    var t = i / (frames - 1);
    var shape = kind === 'linear' ? t : Math.sin(t * Math.PI * 0.5);
    curve[i] = from + delta * shape;
  }
  curve[frames - 1] = to;
  return curve;
}

function audioFadeCurveAvailable() {
  return !!(gainNode && audioCtx && gainNode.gain
    && typeof gainNode.gain.setValueCurveAtTime === 'function'
    && typeof Float32Array !== 'undefined');
}

function rampAudioOutputGain(value, durationMs, opts) {
  value = normalizeAudioFadeTarget(value);
  durationMs = Math.max(0, Number(durationMs) || 0);
  clearAudioFadeTimers();
  var serial = audioFadeSerial;
  var from = currentAudioOutputGain();   // 清排程之前先取显式起点快照
  cancelAudioOutputCurve();
  /* 歌曲过渡编排器（18）的曲线形状：只在「交接淡变」的两次调用上生效
   * （opts.transition = true），暂停 / 播放淡变仍走原来的等功率曲线。
   * 用 typeof 包住，编排器缺席或老沙箱切片没注入时安静回退。 */
  var curveKind = opts && opts.curve;
  if (!curveKind && opts && opts.transition && typeof transitionDirector === 'function') {
    var curveDirector = transitionDirector();
    if (curveDirector && typeof curveDirector.getFadeCurve === 'function') {
      try { curveKind = curveDirector.getFadeCurve(); } catch (_) {}
    }
  }
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    if (durationMs <= 0) { writeAudioOutputGain(value); return; }
    var seconds = durationMs / 1000;
    if (audioFadeCurveAvailable()) {
      try {
        gainNode.gain.setValueCurveAtTime(
          buildAudioFadeCurve(from, value, curveKind), now, seconds);
        audioFadeCurveActive = true;
        var token = audioFadeCurveToken;
        audioFadeCurveTimer = setTimeout(function () {
          audioFadeCurveTimer = 0;
          if (token !== audioFadeCurveToken) return;
          audioFadeCurveActive = false;
          writeAudioOutputGain(value);   // 曲线结束后钉在终值
        }, durationMs + 40);
        return;
      } catch (_) {
        cancelAudioOutputCurve();
      }
    }
    // 浏览器不支持 setValueCurveAtTime 时回退到显式锚点 + 线性 ramp
    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(from, now);
      gainNode.gain.linearRampToValueAtTime(value, now + seconds);
      return;
    } catch (_) {}
    writeAudioOutputGain(value);
    return;
  }
  if (!audio) return;
  // 无 WebAudio 图时的 rAF 兜底（保留原有语义）
  var started = performance.now();
  function tickAudioFade(nowMs) {
    if (serial !== audioFadeSerial || !audio) return;
    var t = durationMs ? clampRange((nowMs - started) / durationMs, 0, 1) : 1;
    var eased = Math.sin(t * Math.PI * 0.5);
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
  transitionNotify('onTrackStart');
  if (targetVolume <= 0.001) {
    setAudioOutputGainImmediate(0);
    return;
  }
  rampAudioOutputGain(targetVolume, transitionFadeInMs(), { transition: true });
}
function restorePlaybackGain() {
  audioFadeSerial++;
  transitionNotify('onTrackStart');
  setAudioOutputGainImmediate(targetVolume);
}
function fadeOutAndPauseAudio() {
  if (!audio || audio.paused) return Promise.resolve(false);
  cancelTrackEndFade();
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

/* ── 曲末提前淡出（对标酷狗 DSPManager::SetFadeOutStartTime）──────────────
   timeupdate 只负责「排程」，真正执行由 setTimeout 落在 duration - fadeOut，
   避免 4Hz 轮询带来的 ±250ms 误差。已有 B deck 交叉淡入接管时不重复做。
   注意：这是「柔和的切歌」而非采样级 gapless，浏览器 <audio> 黑盒解码
   无法裁 encoder delay / padding，真 gapless 需要 decodeAudioData 架构改造。 */
var TRACK_END_FADE_LOOKAHEAD_SEC = 1.8;

/* ── 歌曲过渡编排器（18-track-transition.js）的可选钩子 ──────────────────
   编排器未加载 / 未启用时一律返回用户原设置，下面各调用点的行为与改造前
   完全一致。这里只决定「淡变时长」和「要不要做曲末淡出」，
   真正写 gainNode.gain 的仍然只有 rampAudioOutputGain 一处——
   绝不在这里开第二条写增益的路径。 */
function transitionDirector() {
  return (typeof Mineradio !== 'undefined' && Mineradio.trackTransition)
    ? Mineradio.trackTransition : null;
}
function transitionFadeInMs() {
  var d = transitionDirector();
  if (d && typeof d.getFadeInMs === 'function') {
    var raw = d.getFadeInMs();
    var v = Number(raw);
    if (raw != null && isFinite(v) && v >= 0) return v;
  }
  return AUDIO_FADE_IN_MS;
}
function transitionFadeOutMs() {
  var d = transitionDirector();
  if (d && typeof d.getFadeOutMs === 'function') {
    var raw = d.getFadeOutMs();
    var v = Number(raw);
    if (raw != null && isFinite(v) && v >= 0) return v;
  }
  return AUDIO_FADE_OUT_MS;
}
function transitionSkipTrackEndFade() {
  var d = transitionDirector();
  return !!(d && typeof d.shouldSkipTrackEndFade === 'function' && d.shouldSkipTrackEndFade());
}
function transitionNotify(name) {
  var d = transitionDirector();
  if (d && typeof d[name] === 'function') { try { d[name](); } catch (_) {} }
}

/* 变速后 audio.currentTime / duration 仍是「歌曲秒」，而 setTimeout 用的是墙钟毫秒。
   曲末淡出必须把剩余媒体秒换算成墙钟秒，否则 1.5x 时淡出会迟到大半秒。 */
function playbackWallRate() {
  if (typeof Mineradio !== 'undefined' && Mineradio.playbackAdvanced
      && typeof Mineradio.playbackAdvanced.getRate === 'function') {
    var r = Number(Mineradio.playbackAdvanced.getRate());
    if (isFinite(r) && r > 0) return r;
  }
  return 1;
}
function trackEndFadeLookaheadSec() {
  var base = TRACK_END_FADE_LOOKAHEAD_SEC;
  if (typeof Mineradio !== 'undefined' && Mineradio.playbackAdvanced
      && typeof Mineradio.playbackAdvanced.getLookaheadSec === 'function') {
    var v = Number(Mineradio.playbackAdvanced.getLookaheadSec());
    if (isFinite(v) && v > 0) base = v;
  }
  /* 混音 / 立体声过渡的曲末淡出长达 2.2~2.4s，若窗口还停在 1.8s，
     scheduleTrackEndFade 的「wallRemain <= fadeSec + lookahead」判断
     会把整段淡出挡掉，所以编排器可以按需把窗口放大。 */
  var d = transitionDirector();
  if (d && typeof d.getExtraLookaheadSec === 'function') {
    var extra = Number(d.getExtraLookaheadSec());
    if (isFinite(extra) && extra > base) base = extra;
  }
  return base;
}

var trackEndFadeToken = 0;
var trackEndFadeTimer = 0;
var trackEndFadeScheduled = false;

function cancelTrackEndFade() {
  trackEndFadeToken++;
  trackEndFadeScheduled = false;
  if (trackEndFadeTimer) { clearTimeout(trackEndFadeTimer); trackEndFadeTimer = 0; }
}

function trackEndFadeTakenOver() {
  if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return true;
  if (typeof playbackTransitionHasAudibleNextDeck === 'function'
      && playbackTransitionHasAudibleNextDeck()) return true;
  return false;
}

function scheduleTrackEndFade(media) {
  if (!media || trackEndFadeScheduled || media.paused || media.ended) return false;
  // 无缝过渡：曲末保持音量到 ended，不做淡出（交接零重叠、零淡变）
  if (transitionSkipTrackEndFade()) return false;
  var duration = Number(media.duration);
  var currentTime = Number(media.currentTime);
  if (!isFinite(duration) || duration <= 0 || !isFinite(currentTime)) return false;
  var fadeOutMs = transitionFadeOutMs();
  var fadeSec = Math.max(0, fadeOutMs) / 1000;
  if (fadeSec <= 0) return false;
  var remain = duration - currentTime;
  // fadeSec 是 AudioParam ramp 的墙钟时长，保持不变；只有媒体秒 remain 需要换算
  var wallRemain = remain / playbackWallRate();
  if (wallRemain <= fadeSec + 0.02 || wallRemain > fadeSec + trackEndFadeLookaheadSec()) return false;
  var token = ++trackEndFadeToken;
  trackEndFadeScheduled = true;
  trackEndFadeTimer = setTimeout(function () {
    trackEndFadeTimer = 0;
    trackEndFadeScheduled = false;
    if (token !== trackEndFadeToken) return;
    if (!audio || audio !== media || audio.paused || audio.ended) return;
    if (trackEndFadeTakenOver()) return;
    transitionNotify('onEndFadeStart');
    rampAudioOutputGain(0, fadeOutMs, { transition: true });
  }, Math.max(0, (wallRemain - fadeSec) * 1000));
  return true;
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
    /* 这里过去用 setTargetAtTime(targetVolume, now, 0.025)：它是一条**永不结束**
       的自动化事件，会持续把 gain 拉回 targetVolume，把之后排的淡入/淡出曲线
       整体盖掉 —— 表现就是「暂停/播放听不到淡入淡出」。音量调节的平滑本来就
       由 springVolumeUiTo -> applyVolumeLevel 逐帧提供，此处改用一次性写入。 */
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(targetVolume, now);
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
    // morphicons 弹簧 morph：高音量 ↔ 低音量 ↔ 静音三档（库缺失时回退 stroke path 直切）
    var mc = window.MorphiconCtl;
    var volIcon = level <= 0.01 ? 'volMute' : level < 0.45 ? 'volLow' : 'volHigh';
    if (!(mc && mc.set('vol', volIcon))) {
      icon.innerHTML = level <= 0.01
        ? '<path d="M11 5 6 9 2 9 2 15 6 15 11 19 11 5Z"/><path d="M17 9 22 14"/><path d="M22 9 17 14"/>'
        : level < 0.45
          ? '<path d="M11 5 6 9 2 9 2 15 6 15 11 19 11 5Z"/><path d="M15 10.5a2 2 0 0 1 0 3"/>'
          : '<path d="M11 5 6 9 2 9 2 15 6 15 11 19 11 5Z"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>';
    }
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

