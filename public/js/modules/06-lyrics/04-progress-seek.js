var progressDragState = {
  active: false,
  lastParticleAt: 0,
  previewTime: 0,
  previewDuration: 0,
  resumeAfterSeek: false,
  media: null,
  mediaSrc: '',
  commitSerial: 0,
  previewHoldUntil: 0,
  previewHoldSerial: 0,
  previewClockBase: 0,
  previewClockStartedAt: 0,
  previewClockRunning: false,
  previewClockShouldRun: false,
  previewAudioSettled: false,
  previewReleaseAt: 0,
  previewReleaseDelay: 96,
  previewSettleTarget: 0,
  previewSettleStartedAt: 0,
  previewSettleMedia: null,
  previewSettleMediaSrc: '',
  resumePlaySerial: 0,
  barRect: null,
  pendingPointer: null,
  pointerPreviewRaf: 0
};
var progressLyricPreviewRaf = 0;
function progressSeekPreviewVisualReady() {
  if (!lyricsLines || !lyricsLines.length || (fx && fx.particleLyrics === false)) return true;
  if (typeof stageLyricProgressSeekVisualReady !== 'function') return true;
  return stageLyricProgressSeekVisualReady(getProgressPreviewClockSeconds());
}
function clearProgressPreviewHold(serial) {
  if (serial && progressDragState.previewHoldSerial && serial !== progressDragState.previewHoldSerial) return false;
  progressDragState.previewHoldUntil = 0;
  progressDragState.previewHoldSerial = 0;
  progressDragState.previewClockRunning = false;
  progressDragState.previewClockShouldRun = false;
  progressDragState.previewAudioSettled = false;
  progressDragState.previewReleaseAt = 0;
  progressDragState.previewSettleTarget = 0;
  progressDragState.previewSettleStartedAt = 0;
  progressDragState.previewSettleMedia = null;
  progressDragState.previewSettleMediaSrc = '';
  return true;
}
function isProgressDragPreviewActive() {
  if (!progressDragState || progressDragState.previewDuration <= 0) return false;
  if (progressDragState.active) return true;
  var now = performance.now();
  if (progressDragState.previewHoldSerial) {
    if (progressDragState.previewAudioSettled && progressSeekPreviewVisualReady()) {
      if (!progressDragState.previewReleaseAt) {
        progressDragState.previewReleaseAt = now + Math.max(34, Number(progressDragState.previewReleaseDelay) || 96);
      }
      if (now < progressDragState.previewReleaseAt) return true;
      clearProgressPreviewHold(progressDragState.previewHoldSerial);
      return false;
    }
    progressDragState.previewReleaseAt = 0;
    if (progressDragState.previewHoldUntil > now) return true;
    var settleAge = now - (Number(progressDragState.previewSettleStartedAt) || now);
    var settleMedia = progressDragState.previewSettleMedia;
    if (settleAge < 5200 && settleMedia && progressSeekMediaStillCurrent(settleMedia, progressDragState.previewSettleMediaSrc)) {
      progressDragState.previewHoldUntil = now + 420;
      return true;
    }
    clearProgressPreviewHold(progressDragState.previewHoldSerial);
    return false;
  }
  progressDragState.previewClockRunning = false;
  return false;
}
function getProgressPreviewClockSeconds() {
  var t = Number(progressDragState.previewTime) || 0;
  if (!progressDragState.active && progressDragState.previewClockRunning && progressDragState.previewHoldUntil > performance.now()) {
    var elapsed = Math.max(0, (performance.now() - (Number(progressDragState.previewClockStartedAt) || performance.now())) / 1000);
    t = (Number(progressDragState.previewClockBase) || 0) + elapsed;
    if (progressDragState.previewDuration > 0) t = Math.min(t, progressDragState.previewDuration);
    progressDragState.previewTime = t;
  }
  return t;
}
function getProgressDragPreviewSeconds() {
  return isProgressDragPreviewActive() ? getProgressPreviewClockSeconds() : null;
}
function beginProgressPreviewHold(serial, holdMs, runClock, media, mediaSrc, targetTime) {
  progressDragState.previewHoldSerial = serial || progressDragState.previewHoldSerial || 0;
  progressDragState.previewClockRunning = false;
  progressDragState.previewClockShouldRun = !!runClock;
  progressDragState.previewAudioSettled = false;
  progressDragState.previewReleaseAt = 0;
  progressDragState.previewReleaseDelay = 96;
  progressDragState.previewSettleTarget = Math.max(0, Number(targetTime) || Number(progressDragState.previewTime) || 0);
  progressDragState.previewSettleStartedAt = performance.now();
  progressDragState.previewSettleMedia = media || null;
  progressDragState.previewSettleMediaSrc = mediaSrc || '';
  progressDragState.previewClockBase = Number(progressDragState.previewTime) || 0;
  progressDragState.previewClockStartedAt = performance.now();
  progressDragState.previewHoldUntil = performance.now() + Math.max(1200, Number(holdMs) || 2800);
  scheduleProgressLyricPreviewTick();
}
function finishProgressPreviewHold(serial, settleMs) {
  if (serial && progressDragState.previewHoldSerial && serial !== progressDragState.previewHoldSerial) return;
  var settleMedia = progressDragState.previewSettleMedia;
  var mediaSeconds = settleMedia && isFinite(Number(settleMedia.currentTime)) ? Math.max(0, Number(settleMedia.currentTime)) : null;
  if (mediaSeconds != null) progressDragState.previewTime = mediaSeconds;
  progressDragState.previewAudioSettled = true;
  progressDragState.previewReleaseDelay = Math.max(34, Number(settleMs) || 96);
  if (progressDragState.previewClockShouldRun) {
    progressDragState.previewClockRunning = true;
    progressDragState.previewClockBase = Number(progressDragState.previewTime) || 0;
    progressDragState.previewClockStartedAt = performance.now();
  }
  scheduleProgressLyricPreviewTick();
}
function scheduleProgressLyricPreviewTick() {
  if (typeof markRenderInteraction === 'function') markRenderInteraction('progress-drag', 420);
  if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
  if (progressLyricPreviewRaf) return;
  var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
  progressLyricPreviewRaf = raf(function () {
    progressLyricPreviewRaf = 0;
    if (!isProgressDragPreviewActive()) return;
    // The main rAF loop is the sole lyric tick owner.  Calling it here as well
    // made a seek preview update the same track twice in one display frame.
    if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
    if (isProgressDragPreviewActive()) scheduleProgressLyricPreviewTick();
  });
}
function normalizePlaybackDurationSeconds(value) {
  var raw = Number(value);
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 1000 ? raw / 1000 : raw;
}
function playbackDurationFromSong(song) {
  if (!song) return 0;
  return normalizePlaybackDurationSeconds(song.duration || song.durationMs || song.dt || 0);
}
function getPlaybackDurationSeconds() {
  if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return playbackDurationFromSong(currentCoverSong());
}
function getPlaybackCurrentSeconds() {
  return audio && isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0;
}
function setProgressVisual(percent) {
  percent = clampRange(percent || 0, 0, 100);
  var pctStr = (Math.round(percent * 1000) / 1000) + '%';
  var fill = document.getElementById('progress-fill');
  var thumb = document.getElementById('progress-thumb');
  if (fill) fill.style.width = pctStr;
  if (thumb) thumb.style.left = pctStr;
}

// P1：预览→live 交接 spring（MineradioMotion）。只动视觉 percent，不碰 thumb transform / 预览时钟 / seek 时间。
// 有界：snappy settle + 硬超时，禁止每帧 springTo（会重置 life，导致长期滞后）。
var seekPreviewWasActive = false;
var seekHandoffLastPreviewPct = 0;
var seekDisplayState = { pct: 0 };
var seekHandoff = { active: false, startedAt: 0, targetPct: 0 };
var SEEK_HANDOFF_MAX_MS = 380;
var SEEK_HANDOFF_MIN_DELTA = 0.05;
var SEEK_HANDOFF_RETARGET_DELTA = 0.35;
// P2：release→commit 短 spring（flush 与 clamp 错位时）
var seekReleaseSpring = { active: false, startedAt: 0, targetPct: 0 };
var SEEK_RELEASE_MAX_MS = 200;
var SEEK_RELEASE_MIN_DELTA = 0.08;

function killSeekDisplayPctSpring() {
  try {
    if (window.MineradioMotion && typeof window.MineradioMotion.killSpring === 'function') {
      window.MineradioMotion.killSpring(seekDisplayState, 'pct');
      return;
    }
    if (window.MineradioMotion && typeof window.MineradioMotion.killAll === 'function') {
      window.MineradioMotion.killAll(seekDisplayState);
    }
  } catch (_) {}
}

function finishSeekProgressHandoffSpring() {
  seekHandoff.active = false;
  seekHandoff.startedAt = 0;
}

function finishSeekReleaseCommitSpring() {
  seekReleaseSpring.active = false;
  seekReleaseSpring.startedAt = 0;
}

function stopSeekReleaseCommitSpring(applyPct) {
  var wasActive = seekReleaseSpring.active;
  finishSeekReleaseCommitSpring();
  if (wasActive) killSeekDisplayPctSpring();
  if (applyPct != null && isFinite(Number(applyPct))) setProgressVisual(applyPct);
}

function stopSeekProgressHandoffSpring() {
  var wasActive = seekHandoff.active;
  finishSeekProgressHandoffSpring();
  if (wasActive || seekReleaseSpring.active) {
    // handoff/release 共用 pct owner；停 handoff 时一并清 release，避免残留 spring
    finishSeekReleaseCommitSpring();
    killSeekDisplayPctSpring();
  } else {
    killSeekDisplayPctSpring();
  }
}

function startSeekReleaseCommitSpring(fromPct, toPct) {
  var M = window.MineradioMotion;
  fromPct = clampRange(Number(fromPct) || 0, 0, 100);
  toPct = clampRange(Number(toPct) || 0, 0, 100);
  if (seekHandoff.active) stopSeekProgressHandoffSpring();
  if (!M || typeof M.springTo !== 'function' || Math.abs(fromPct - toPct) < SEEK_RELEASE_MIN_DELTA) {
    setProgressVisual(toPct);
    finishSeekReleaseCommitSpring();
    return false;
  }
  seekReleaseSpring.active = true;
  seekReleaseSpring.startedAt = performance.now();
  seekReleaseSpring.targetPct = toPct;
  seekDisplayState.pct = fromPct;
  M.springTo(seekDisplayState, 'pct', toPct, {
    from: fromPct,
    preset: (M.SPRING && M.SPRING.snappy) || null,
    apply: function (v) {
      seekDisplayState.pct = v;
      setProgressVisual(v);
    },
    onComplete: function () {
      finishSeekReleaseCommitSpring();
    }
  });
  return true;
}

function tickSeekReleaseCommitSpring() {
  if (!seekReleaseSpring.active) return false;
  var now = performance.now();
  if ((now - (Number(seekReleaseSpring.startedAt) || now)) > SEEK_RELEASE_MAX_MS) {
    stopSeekReleaseCommitSpring(seekReleaseSpring.targetPct);
    return false;
  }
  return true;
}

function startSeekProgressHandoffSpring(fromPct, livePct) {
  var M = window.MineradioMotion;
  fromPct = clampRange(Number(fromPct) || 0, 0, 100);
  livePct = clampRange(Number(livePct) || 0, 0, 100);
  if (seekReleaseSpring.active) stopSeekReleaseCommitSpring();
  if (!M || typeof M.springTo !== 'function' || Math.abs(fromPct - livePct) < SEEK_HANDOFF_MIN_DELTA) {
    setProgressVisual(livePct);
    finishSeekProgressHandoffSpring();
    return;
  }
  seekHandoff.active = true;
  seekHandoff.startedAt = performance.now();
  seekHandoff.targetPct = livePct;
  seekDisplayState.pct = fromPct;
  M.springTo(seekDisplayState, 'pct', livePct, {
    from: fromPct,
    preset: (M.SPRING && M.SPRING.snappy) || null,
    apply: function (v) {
      seekDisplayState.pct = v;
      setProgressVisual(v);
    },
    onComplete: function () {
      finishSeekProgressHandoffSpring();
    }
  });
}

function updateSeekProgressHandoffSpring(livePct) {
  if (!seekHandoff.active) return false;
  livePct = clampRange(Number(livePct) || 0, 0, 100);
  var now = performance.now();
  if ((now - (Number(seekHandoff.startedAt) || now)) > SEEK_HANDOFF_MAX_MS) {
    stopSeekProgressHandoffSpring();
    setProgressVisual(livePct);
    return false;
  }
  var M = window.MineradioMotion;
  // 仅在 live 明显跳变时轻量 retarget（audio snap），避免每帧重置 spring life
  if (M && typeof M.springTo === 'function' && Math.abs(livePct - seekHandoff.targetPct) > SEEK_HANDOFF_RETARGET_DELTA) {
    seekHandoff.targetPct = livePct;
    M.springTo(seekDisplayState, 'pct', livePct, {
      preset: (M.SPRING && M.SPRING.snappy) || null,
      apply: function (v) {
        seekDisplayState.pct = v;
        setProgressVisual(v);
      },
      onComplete: function () {
        finishSeekProgressHandoffSpring();
      }
    });
  }
  return true;
}

function updatePlaybackProgressUi() {
  if (isProgressDragPreviewActive() && progressDragState.previewDuration > 0) {
    renderProgressPreview(getProgressPreviewClockSeconds(), progressDragState.previewDuration);
    // 新的拖动/预览打断交接 spring（可中断交互）
    if (seekHandoff.active) stopSeekProgressHandoffSpring();
    seekPreviewWasActive = true;
    seekHandoffLastPreviewPct = progressDragState.previewDuration > 0
      ? ((Number(progressDragState.previewTime) || 0) / progressDragState.previewDuration * 100)
      : 0;
    updateBufferProgressUi();
    return;
  }

  var durationSec = getPlaybackDurationSeconds();
  var currentSec = getPlaybackCurrentSeconds();
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  var livePct = durationSec > 0 ? (currentSec / durationSec * 100) : 0;

  if (seekPreviewWasActive && !seekHandoff.active) {
    startSeekProgressHandoffSpring(seekHandoffLastPreviewPct, livePct);
  }
  seekPreviewWasActive = false;

  if (!updateSeekProgressHandoffSpring(livePct)) {
    setProgressVisual(livePct);
  }

  var timeDisplay = document.getElementById('time-display');
  if (timeDisplay) timeDisplay.textContent = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
  updateBufferProgressUi();
  if (typeof maybeSyncContinueProgressLive === 'function') maybeSyncContinueProgressLive();
}

var _lastProgressTimeupdateAt = 0;
var _progressBufferEl = null;
var _progressBufferLastWidth = '';
function updateBufferProgressUi() {
  if (!_progressBufferEl) _progressBufferEl = document.getElementById('progress-buffer');
  if (!_progressBufferEl || !audio) {
    if (_progressBufferLastWidth !== '0%' && _progressBufferEl) {
      _progressBufferEl.style.width = '0%';
      _progressBufferLastWidth = '0%';
    }
    return;
  }
  var durationSec = getPlaybackDurationSeconds();
  var bufferedEnd = 0;
  try {
    var ranges = audio.buffered;
    if (ranges && ranges.length) bufferedEnd = ranges.end(ranges.length - 1);
  } catch (_) {}
  var pct = durationSec > 0 ? clampRange((bufferedEnd / durationSec) * 100, 0, 100) : 0;
  var pctStr = (Math.round(pct * 10) / 10) + '%';
  if (pctStr !== _progressBufferLastWidth) {
    _progressBufferEl.style.width = pctStr;
    _progressBufferLastWidth = pctStr;
  }
}

function playbackTransitionHasAudibleNextDeck() {
  var cuefieldMedia = typeof cuefieldAutoMixPreparedAudio !== 'undefined' ? cuefieldAutoMixPreparedAudio : null;
  if (
    typeof cuefieldAutoMixExecuting !== 'undefined'
    && cuefieldAutoMixExecuting
    && cuefieldMedia
    && cuefieldMedia !== audio
    && !cuefieldMedia.paused
    && !cuefieldMedia.ended
    && Number(cuefieldMedia.volume) > 0.001
  ) return true;
  var preload = typeof albumGaplessState !== 'undefined' && albumGaplessState ? albumGaplessState.preload : null;
  return !!(
    preload
    && preload.mixStarted
    && preload.media
    && preload.media !== audio
    && !preload.media.paused
    && !preload.media.ended
    && Number(preload.media.volume) > 0.001
  );
}

function bindPlaybackProgressEvents(audioEl) {
  if (!audioEl || audioEl._mineradioProgressBound) return;
  audioEl._mineradioProgressBound = true;
  ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'emptied', 'progress'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (name === 'timeupdate') _lastProgressTimeupdateAt = performance.now();
      updatePlaybackProgressUi();
    });
  });
  audioEl.addEventListener('timeupdate', function () {
    if (typeof tickCuefieldAutoMix === 'function') tickCuefieldAutoMix();
    if (typeof savePlaybackSession === 'function') savePlaybackSession(false);
  });
  audioEl.addEventListener('pause', function () {
    if (typeof savePlaybackSession === 'function') savePlaybackSession(true);
  });
  audioEl.addEventListener('seeked', function () {
    if (typeof savePlaybackSession === 'function') savePlaybackSession(true);
  });
  ['play', 'playing', 'pause', 'ended', 'emptied', 'abort', 'error'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (audioEl !== audio) return;
      syncPlaybackStateFromAudioEvent(name);
      if (typeof saveLastPlaybackSnapshot === 'function') {
        saveLastPlaybackSnapshot(name === 'pause' || name === 'ended', name);
      }
    });
  });
  ['waiting', 'stalled', 'error'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (audioEl !== audio) return;
      if (progressDragState && progressDragState.active) return;
      if (typeof schedulePlaybackStallRecovery === 'function') {
        schedulePlaybackStallRecovery(name, {
          silent: name !== 'error',
          ownerMedia: audioEl,
          ownerToken: trackSwitchToken
        });
      }
    });
  });
  audioEl.addEventListener('playing', function () {
    if (audioEl !== audio) return;
    if (typeof setPlaybackBufferingState === 'function') setPlaybackBufferingState(false, 'playing');
  });
}
function emitProgressDragParticles(x, y) {
  var now = performance.now();
  if (now - progressDragState.lastParticleAt < 46) return;
  progressDragState.lastParticleAt = now;
  for (var i = 0; i < 3; i++) {
    var dot = document.createElement('span');
    dot.className = 'progress-drag-particle';
    var dx = (Math.random() - 0.5) * 34;
    var dy = -10 - Math.random() * 28;
    dot.style.setProperty('--px', x + 'px');
    dot.style.setProperty('--py', y + 'px');
    dot.style.setProperty('--dx', dx + 'px');
    dot.style.setProperty('--dy', dy + 'px');
    document.body.appendChild(dot);
    setTimeout((function (el) { return function () { if (el && el.parentNode) el.parentNode.removeChild(el); }; })(dot), 700);
  }
}
function renderProgressPreview(currentSec, durationSec) {
  currentSec = Math.max(0, Number(currentSec) || 0);
  durationSec = Math.max(0, Number(durationSec) || 0);
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  // P2：release spring 托管视觉 percent 时，预览时钟只推进时间文案，避免抢写 setProgressVisual
  if (!seekReleaseSpring.active) {
    setProgressVisual(durationSec > 0 ? (currentSec / durationSec * 100) : 0);
  } else {
    tickSeekReleaseCommitSpring();
  }
  var timeDisplay = document.getElementById('time-display');
  if (timeDisplay) timeDisplay.textContent = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
}
function progressPointerPreviewFromEvent(e) {
  var durationSec = getPlaybackDurationSeconds();
  if (!audio || !durationSec) return null;
  var bar = document.getElementById('progress-bar');
  if (!bar) return null;
  var rect = progressDragState.active && progressDragState.barRect
    ? progressDragState.barRect
    : bar.getBoundingClientRect();
  var width = Math.max(1, rect.width || 1);
  var ratio = clampRange((e.clientX - rect.left) / width, 0, 1);
  return { ratio: ratio, time: ratio * durationSec, duration: durationSec, rect: rect };
}
function queueProgressPointerPreview(e, emitParticles) {
  if (!e) return;
  progressDragState.pendingPointer = { clientX: Number(e.clientX) || 0, clientY: Number(e.clientY) || 0, emitParticles: !!emitParticles };
  if (progressDragState.pointerPreviewRaf) return;
  progressDragState.pointerPreviewRaf = requestAnimationFrame(function () {
    progressDragState.pointerPreviewRaf = 0;
    var pending = progressDragState.pendingPointer;
    progressDragState.pendingPointer = null;
    if (pending && progressDragState.active) previewProgressPointer(pending, pending.emitParticles);
  });
}
function flushProgressPointerPreview(e) {
  if (progressDragState.pointerPreviewRaf) {
    cancelAnimationFrame(progressDragState.pointerPreviewRaf);
    progressDragState.pointerPreviewRaf = 0;
  }
  var pending = progressDragState.pendingPointer;
  progressDragState.pendingPointer = null;
  if (e && isFinite(Number(e.clientX))) previewProgressPointer(e, false);
  else if (pending) previewProgressPointer(pending, false);
}
function previewProgressPointer(e, emitParticles) {
  var preview = progressPointerPreviewFromEvent(e);
  if (!preview) return false;
  progressDragState.previewTime = preview.time;
  progressDragState.previewDuration = preview.duration;
  progressDragState.previewClockRunning = false;
  renderProgressPreview(preview.time, preview.duration);
  // Beat-map cursors are committed once on pointer release.  Rewinding and
  // rescanning long beat arrays for every raw pointermove steals rAF time from
  // the continuous lyric track without changing audible playback.
  scheduleProgressLyricPreviewTick();
  if (emitParticles) emitProgressDragParticles(e.clientX, preview.rect.top + preview.rect.height / 2);
  return true;
}
function progressSeekTargetReached(media, targetTime, serial) {
  if (!media || serial !== progressDragState.commitSerial) return false;
  if (!progressSeekMediaStillCurrent(media, progressDragState.previewSettleMediaSrc)) return false;
  if (media.seeking || media.readyState < 2 || !isFinite(Number(media.currentTime))) return false;
  var current = Math.max(0, Number(media.currentTime) || 0);
  var target = Math.max(0, Number(targetTime) || 0);
  return current >= Math.max(0, target - 0.45) && current <= target + 1.5;
}
function waitForProgressSeekReady(media, targetTime, serial, timeoutMs) {
  if (!media) return Promise.resolve(false);
  if (progressSeekTargetReached(media, targetTime, serial)) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var done = false;
    var timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      media.removeEventListener('seeked', onReady);
      media.removeEventListener('timeupdate', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('loadeddata', onReady);
      media.removeEventListener('playing', onReady);
      media.removeEventListener('error', onError);
    }
    function finish(ok) {
      if (done) return;
      done = true;
      cleanup();
      resolve(!!ok);
    }
    function onReady() {
      if (progressSeekTargetReached(media, targetTime, serial)) finish(true);
    }
    function onError() { finish(false); }
    media.addEventListener('seeked', onReady, { once: true });
    media.addEventListener('timeupdate', onReady);
    media.addEventListener('canplay', onReady);
    media.addEventListener('loadeddata', onReady);
    media.addEventListener('playing', onReady);
    media.addEventListener('error', onError, { once: true });
    timer = setTimeout(function () { finish(progressSeekTargetReached(media, targetTime, serial)); }, timeoutMs || 1800);
  });
}
function progressSeekMediaStillCurrent(media, mediaSrc) {
  return !!(media && audio === media && (media.currentSrc || media.src || '') === mediaSrc);
}
function restoreProgressSeekAudio(media, mediaSrc, resumeAfterSeek, serial) {
  if (serial !== progressDragState.commitSerial) return;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) {
    clearProgressPreviewHold(serial);
    return;
  }
  if (!resumeAfterSeek) {
    progressDragState.resumePlaySerial = 0;
    finishProgressPreviewHold(serial, 96);
    try { if (media && !media.paused) media.pause(); } catch (pauseErr) { }
    if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
    return;
  }
  if (progressDragState.resumePlaySerial !== serial || (media && media.paused)) {
    primeProgressSeekPlayback(media, mediaSrc, serial);
  }
  finishProgressPreviewHold(serial, 96);
}
function primeProgressSeekPlayback(media, mediaSrc, serial) {
  if (serial !== progressDragState.commitSerial) return false;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) return false;
  progressDragState.resumePlaySerial = serial;
  if (typeof attemptAudioPlay === 'function') {
    attemptAudioPlay({ manual: true, silent: true, fade: true });
    return true;
  }
  try {
    var playResult = media.play();
    if (playResult && playResult.then) {
      playResult.then(function () {
        if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
        if (typeof startPlaybackFadeIn === 'function') startPlaybackFadeIn();
        else if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
      }).catch(function () {
        if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
        if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
      });
    }
    return true;
  } catch (e) {
    finishProgressPreviewHold(serial, 48);
    if (progressSeekMediaStillCurrent(media, mediaSrc) && typeof restorePlaybackGain === 'function') restorePlaybackGain();
    return false;
  }
}
function commitProgressSeek(targetTime, resumeAfterSeek) {
  var media = progressDragState.media || audio;
  if (!media) return;
  var durationSec = progressDragState.previewDuration || getPlaybackDurationSeconds();
  if (!durationSec) return;
  // P2：记录 flush 后的预览位置，再与 clamp 后的 commit 目标比较
  var fromTime = Number(progressDragState.previewTime) || 0;
  var fromPct = durationSec > 0 ? (fromTime / durationSec * 100) : 0;
  targetTime = clampRange(Number(targetTime) || 0, 0, durationSec);
  var commitPct = durationSec > 0 ? (targetTime / durationSec * 100) : 0;
  var mediaSrc = progressDragState.mediaSrc || (media.currentSrc || media.src || '');
  var serial = ++progressDragState.commitSerial;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) {
    clearProgressPreviewHold();
    progressDragState.resumePlaySerial = 0;
    return false;
  }
  progressDragState.previewTime = targetTime;
  progressDragState.previewDuration = durationSec;
  beginProgressPreviewHold(serial, 2800, !!resumeAfterSeek, media, mediaSrc, targetTime);
  if (typeof setAudioOutputGainImmediate === 'function') setAudioOutputGainImmediate(0);
  try {
    media.currentTime = targetTime;
  } catch (err) {
    console.warn('[ProgressSeek] commit failed:', err && (err.message || err));
    progressDragState.previewClockRunning = false;
    finishProgressPreviewHold(serial, 48);
    restoreProgressSeekAudio(media, mediaSrc, false, serial);
    return;
  }
  if (resumeAfterSeek) primeProgressSeekPlayback(media, mediaSrc, serial);
  // 视觉：仅在 flush≠clamp 时短 spring；时间文案立即对齐 commit（seek 时间准确）
  startSeekReleaseCommitSpring(fromPct, commitPct);
  renderProgressPreview(targetTime, durationSec);
  syncBeatMapPlaybackCursor(targetTime, true);
  saveLastPlaybackSnapshot(true, 'seek');
  waitForProgressSeekReady(media, targetTime, serial, 1800).then(function (ready) {
    if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return false;
    if (ready) return true;
    try { media.currentTime = targetTime; } catch (retryErr) { }
    return waitForProgressSeekReady(media, targetTime, serial, 1200);
  }).then(function (ready) {
    if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
    if (!ready) console.warn('[ProgressSeek] target did not settle before fallback handoff');
    restoreProgressSeekAudio(media, mediaSrc, !!resumeAfterSeek && !!ready, serial);
  });
}
var progressBar = document.getElementById('progress-bar');
var progressThumbSpring = { active: false };

function applyProgressThumbScale(thumb, scale) {
  if (!thumb) return;
  var v = clampRange(Number(scale) || 1, 0.45, 1.35);
  thumb.style.transform = 'translate(-50%, -50%) scale(' + (Math.round(v * 100000) / 100000) + ')';
}

function readProgressThumbScale(thumb) {
  if (!thumb) return 0.72;
  try {
    var inline = String(thumb.style.transform || '');
    var m = inline.match(/scale\(\s*([-0-9.]+)\s*\)/i);
    if (m && isFinite(Number(m[1]))) return clampRange(Number(m[1]), 0.45, 1.35);
  } catch (_) {}
  try {
    if (progressBar && (progressBar.classList.contains('is-dragging') || progressBar.matches(':hover'))) return 1;
  } catch (_) {}
  return 0.72;
}

function releaseProgressThumbSpringInline(thumb) {
  if (!thumb) return;
  try { thumb.style.transition = ''; } catch (_) {}
  try { thumb.style.transform = ''; } catch (_) {}
  progressThumbSpring.active = false;
}

// P3：thumb 按压 spring。custom-apply 保留 translate(-50%,-50%) 居中，临时摘掉 transform transition，settle 后交还 CSS。
function springProgressThumbPress() {
  var thumb = document.getElementById('progress-thumb');
  var M = window.MineradioMotion;
  if (!thumb) return;
  if (!M || typeof M.springTo !== 'function') {
    applyProgressThumbScale(thumb, 1);
    return;
  }
  var from = readProgressThumbScale(thumb);
  // 已 hover 到 1 时给一点下压，避免「按下无反馈」
  if (from >= 0.98) from = 0.88;
  try { thumb.style.transition = 'opacity .16s'; } catch (_) {}
  progressThumbSpring.active = true;
  M.springTo(thumb, 'scale', 1, {
    from: from,
    preset: (M.SPRING && M.SPRING.snappy) || null,
    persist: true,
    apply: function (v) { applyProgressThumbScale(thumb, v); }
  });
}

function springProgressThumbRelease() {
  var thumb = document.getElementById('progress-thumb');
  var M = window.MineradioMotion;
  if (!thumb) return;
  var target = 0.72;
  try {
    if (progressBar && progressBar.matches(':hover')) target = 1;
  } catch (_) {}
  if (!M || typeof M.springTo !== 'function') {
    releaseProgressThumbSpringInline(thumb);
    return;
  }
  try { thumb.style.transition = 'opacity .16s'; } catch (_) {}
  progressThumbSpring.active = true;
  M.springTo(thumb, 'scale', target, {
    preset: (M.SPRING && M.SPRING.snappy) || null,
    persist: true,
    apply: function (v) { applyProgressThumbScale(thumb, v); },
    onComplete: function () {
      try {
        thumb.style.transition = '';
        // 交还 CSS :hover / 默认 scale，避免内联 transform 永久盖住悬停态
        if (!progressBar || !progressBar.classList.contains('is-dragging')) {
          thumb.style.transform = '';
        }
      } catch (_) {
        try { releaseProgressThumbSpringInline(thumb); } catch (__) {}
      }
      progressThumbSpring.active = false;
    }
  });
}

progressBar.addEventListener('pointerdown', function (e) {
  if (!audio || !getPlaybackDurationSeconds()) return;
  if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('manual-seek');
  if (
    typeof albumGaplessState !== 'undefined'
    && albumGaplessState
    && albumGaplessState.preload
    && (albumGaplessState.preload.mixPending || albumGaplessState.preload.mixStarted)
    && typeof clearAlbumGaplessPreload === 'function'
  ) clearAlbumGaplessPreload('manual-seek');
  progressDragState.active = true;
  progressDragState.media = audio;
  progressDragState.mediaSrc = audio.currentSrc || audio.src || '';
  progressDragState.resumeAfterSeek = !!(audio && !audio.paused && !audio.ended && playing);
  progressDragState.previewTime = getPlaybackCurrentSeconds();
  progressDragState.previewDuration = getPlaybackDurationSeconds();
  progressDragState.barRect = progressBar.getBoundingClientRect();
  progressBar.classList.add('is-dragging');
  if (seekReleaseSpring.active) stopSeekReleaseCommitSpring();
  if (seekHandoff.active) stopSeekProgressHandoffSpring();
  springProgressThumbPress();
  if (progressDragState.resumeAfterSeek) {
    if (typeof setAudioOutputGainImmediate === 'function') setAudioOutputGainImmediate(0);
    try { audio.pause(); } catch (pauseErr) { }
  }
  try { progressBar.setPointerCapture(e.pointerId); } catch (err) { }
  previewProgressPointer(e, true);
  scheduleProgressLyricPreviewTick();
});
progressBar.addEventListener('pointermove', function (e) {
  if (!progressDragState.active) return;
  queueProgressPointerPreview(e, true);
});
function endProgressDrag(e, commit) {
  if (!progressDragState.active) return;
  flushProgressPointerPreview(e);
  var targetTime = progressDragState.previewTime;
  var resumeAfterSeek = progressDragState.resumeAfterSeek;
  var dragMedia = progressDragState.media;
  var dragMediaSrc = progressDragState.mediaSrc;
  progressDragState.active = false;
  progressDragState.barRect = null;
  progressBar.classList.remove('is-dragging');
  springProgressThumbRelease();
  try { if (e && e.pointerId != null) progressBar.releasePointerCapture(e.pointerId); } catch (err) { }
  if (commit !== false) commitProgressSeek(targetTime, resumeAfterSeek);
  else {
    clearProgressPreviewHold();
    progressDragState.resumePlaySerial = 0;
    if (progressSeekMediaStillCurrent(dragMedia, dragMediaSrc) && typeof restorePlaybackGain === 'function') restorePlaybackGain();
  }
  progressDragState.media = null;
  progressDragState.mediaSrc = '';
  progressDragState.resumeAfterSeek = false;
  if (commit !== false && typeof scheduleCuefieldAutoMixPrepare === 'function') {
    scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 900);
  }
}
progressBar.addEventListener('pointerup', function (e) { endProgressDrag(e, true); });
progressBar.addEventListener('pointercancel', function (e) { endProgressDrag(e, false); });
progressBar.addEventListener('lostpointercapture', function (e) { endProgressDrag(e, true); });
setInterval(function () {
  if (!audio) {
    updatePlaybackProgressUi();
    return;
  }
  if (progressDragState.active || isProgressDragPreviewActive()) {
    updatePlaybackProgressUi();
    return;
  }
  updateListenStatsTick(false);
  var recentTimeupdate = (performance.now() - _lastProgressTimeupdateAt) < 480;
  if (audio.paused || audio.ended || !recentTimeupdate) {
  updatePlaybackProgressUi();
    if (audio.currentTime && typeof updateLyricsHighlight === 'function') updateLyricsHighlight();
  } else {
    updateBufferProgressUi();
  }
  if (typeof saveLastPlaybackSnapshot === 'function') saveLastPlaybackSnapshot(false, 'tick');
}, 200);