var STARTUP_AUTOPLAY_STORE_KEY = 'mineradio:startup-autoplay:v1';
var STARTUP_FAST_SKIP_STORE_KEY = 'mineradio:startup-fast-skip:v1';
var startupAutoplayPreference = (function() {
  try { var v = localStorage.getItem(STARTUP_AUTOPLAY_STORE_KEY); return v === 'true'; } catch (_) { return false; }
})();
var startupFastSkipPreference = (function() {
  try { var v = localStorage.getItem(STARTUP_FAST_SKIP_STORE_KEY); return v === 'true'; } catch (_) { return false; }
})();
function toggleStartupAutoplay() {
  startupAutoplayPreference = !startupAutoplayPreference;
  try { localStorage.setItem(STARTUP_AUTOPLAY_STORE_KEY, String(startupAutoplayPreference)); } catch (_) {}
  applyStartupAutoplayUi();
  showToast(startupAutoplayPreference ? '启动自动播放已开启' : '启动自动播放已关闭');
}
function toggleStartupFastSkip() {
  startupFastSkipPreference = !startupFastSkipPreference;
  try { localStorage.setItem(STARTUP_FAST_SKIP_STORE_KEY, String(startupFastSkipPreference)); } catch (_) {}
  applyStartupAutoplayUi();
  showToast(startupFastSkipPreference ? '秒启动已开启' : '秒启动已关闭');
}
function applyStartupAutoplayUi() {
  var t1 = document.getElementById('t-startupAutoplay');
  var t2 = document.getElementById('t-startupFastSkip');
  if (t1) { t1.classList.toggle('on', !!startupAutoplayPreference); t1.querySelector('.dot').classList.toggle('on', !!startupAutoplayPreference); }
  if (t2) { t2.classList.toggle('on', !!startupFastSkipPreference); t2.querySelector('.dot').classList.toggle('on', !!startupFastSkipPreference); }
}
// === 启动恢复模式（按上次进度 / 从头开始）===
var STARTUP_RESUME_MODE_STORE_KEY = 'mineradio:startup-resume-mode:v1';
var startupResumeModePreference = (function () {
  try { var v = localStorage.getItem(STARTUP_RESUME_MODE_STORE_KEY); return v === 'beginning' ? 'beginning' : 'resume'; } catch (_) { return 'resume'; }
})();
function setStartupResumeMode(mode) {
  startupResumeModePreference = mode === 'beginning' ? 'beginning' : 'resume';
  try { localStorage.setItem(STARTUP_RESUME_MODE_STORE_KEY, startupResumeModePreference); } catch (_) {}
  applyStartupResumeModeUi();
  showToast(startupResumeModePreference === 'beginning' ? '恢复时从头开始' : '恢复时按上次进度');
}
function applyStartupResumeModeUi() {
  var seg = document.getElementById('startup-resume-mode-seg');
  if (!seg) return;
  Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
    b.classList.toggle('active', b.getAttribute('data-startup-resume-mode') === startupResumeModePreference);
  });
}
// === 歌词时间偏移系统（逐曲校准，解决歌词与音源不同步）===
var LYRIC_TIMING_OFFSET_STORE_KEY = 'mineradio-lyric-timing-offsets-v1';
var LYRIC_TIMING_OFFSET_LIMIT = 500;
var lyricTimingOffsetMap = (function () {
  try {
    var raw = JSON.parse(localStorage.getItem(LYRIC_TIMING_OFFSET_STORE_KEY) || '{}');
    var items = raw && raw.version === 1 && raw.items ? raw.items : raw;
    var out = {};
    Object.keys(items || {}).forEach(function (key) {
      var entry = items[key];
      var offset = (entry && typeof entry === 'object') ? normalizeLyricTimingOffsetSeconds(entry.offset) : normalizeLyricTimingOffsetSeconds(entry);
      if (offset) {
        out[key] = {
          offset: offset,
          updatedAt: Number(entry && entry.updatedAt) || 0,
          title: String(entry && entry.title || '').slice(0, 80),
          artist: String(entry && entry.artist || '').slice(0, 80)
        };
      }
    });
    return out;
  } catch (e) { return {}; }
})();
var lyricTimingPopoverCloseTimer = null;
function normalizeLyricTimingOffsetSeconds(value) {
  var raw = Number(value);
  if (!isFinite(raw)) raw = 0;
  return Math.round(clampRange(raw, -5, 5) * 10) / 10;
}
function lyricTimingOffsetEntryValue(entry) {
  if (entry && typeof entry === 'object') return normalizeLyricTimingOffsetSeconds(entry.offset);
  return normalizeLyricTimingOffsetSeconds(entry);
}
function writeLyricTimingOffsetMap() {
  try {
    var keys = Object.keys(lyricTimingOffsetMap || {}).sort(function (a, b) {
      return (Number(lyricTimingOffsetMap[b] && lyricTimingOffsetMap[b].updatedAt) || 0) - (Number(lyricTimingOffsetMap[a] && lyricTimingOffsetMap[a].updatedAt) || 0);
    }).slice(0, LYRIC_TIMING_OFFSET_LIMIT);
    var items = {};
    keys.forEach(function (key) { items[key] = lyricTimingOffsetMap[key]; });
    lyricTimingOffsetMap = items;
    if (!keys.length) { localStorage.removeItem(LYRIC_TIMING_OFFSET_STORE_KEY); return; }
    localStorage.setItem(LYRIC_TIMING_OFFSET_STORE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), items: items }));
  } catch (e) { }
}
function lyricTimingCurrentSong() {
  if (typeof currentCoverSong === 'function') return currentCoverSong();
  if (typeof currentIdx !== 'undefined' && currentIdx >= 0 && typeof playQueue !== 'undefined' && playQueue && playQueue[currentIdx]) return playQueue[currentIdx];
  return (typeof currentLocalSong !== 'undefined' && currentLocalSong) || null;
}
function lyricTimingSongKey(song) {
  song = song || lyricTimingCurrentSong();
  if (!song) return '';
  if (typeof queueItemKey === 'function') return queueItemKey(song);
  if (typeof songCustomCoverKey === 'function') return songCustomCoverKey(song);
  return String(song.name || '') + '|' + String(song.artist || '');
}
function getLyricTimingOffsetForSong(song) {
  var key = lyricTimingSongKey(song);
  return key && lyricTimingOffsetMap && lyricTimingOffsetMap[key] ? lyricTimingOffsetEntryValue(lyricTimingOffsetMap[key]) : 0;
}
function getActiveLyricTimingOffsetSeconds() {
  return getLyricTimingOffsetForSong(lyricTimingCurrentSong());
}
function getAdjustedLyricPlaybackTime(rawTime) {
  var t = Number(rawTime);
  if (!isFinite(t)) t = 0;
  return Math.max(0, t + getActiveLyricTimingOffsetSeconds());
}
function formatLyricTimingOffset(offset) {
  offset = normalizeLyricTimingOffsetSeconds(offset);
  if (!offset) return '0.0s';
  return (offset > 0 ? '+' : '-') + Math.abs(offset).toFixed(1) + 's';
}
function lyricTimingToastText(offset) {
  offset = normalizeLyricTimingOffsetSeconds(offset);
  if (!offset) return '歌词校准已重置';
  return offset > 0 ? ('歌词提前 ' + Math.abs(offset).toFixed(1) + 's') : ('歌词延后 ' + Math.abs(offset).toFixed(1) + 's');
}
function clearLyricTimingPopoverClose() {
  if (lyricTimingPopoverCloseTimer) { clearTimeout(lyricTimingPopoverCloseTimer); lyricTimingPopoverCloseTimer = null; }
  var root = document.getElementById('lyric-timing-control');
  if (root) root.classList.remove('closing');
}
function closeLyricTimingPopover(force) {
  var root = document.getElementById('lyric-timing-control');
  if (!root) return;
  if (lyricTimingPopoverCloseTimer) { clearTimeout(lyricTimingPopoverCloseTimer); lyricTimingPopoverCloseTimer = null; }
  var active = document.activeElement;
  if (active && root.contains(active) && typeof active.blur === 'function') { try { active.blur(); } catch (e) { } }
  root.classList.add('closing');
  lyricTimingPopoverCloseTimer = setTimeout(function () {
    lyricTimingPopoverCloseTimer = null;
    root.classList.remove('closing');
  }, force ? 220 : 160);
}
function updateLyricTimingOffsetUi(songOverride) {
  var song = songOverride || lyricTimingCurrentSong();
  var key = lyricTimingSongKey(song);
  var offset = getLyricTimingOffsetForSong(song);
  var root = document.getElementById('lyric-timing-control');
  var value = document.getElementById('lyric-timing-value');
  var songEl = document.getElementById('lyric-timing-song');
  if (root) root.classList.toggle('has-offset', !!offset);
  if (value) value.textContent = formatLyricTimingOffset(offset);
  if (songEl) songEl.textContent = song ? (song.name || song.title || '当前歌曲') : '未选择歌曲';
  if (root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-lyric-offset-step],[data-lyric-offset-reset]'), function (btn) {
      btn.disabled = !key;
    });
  }
}
function refreshLyricTimingAfterOffsetChange() {
  if (typeof stageLyrics !== 'undefined' && stageLyrics) {
    stageLyrics.currentIdx = -999;
    try { stageLyrics.currentDisplayKey = ''; } catch (e) { }
  }
  if (typeof pushDesktopLyricsState === 'function') pushDesktopLyricsState(true);
}
function setCurrentLyricTimingOffset(offset, opts) {
  opts = opts || {};
  var song = lyricTimingCurrentSong();
  var key = lyricTimingSongKey(song);
  if (!key || !song) {
    updateLyricTimingOffsetUi(song);
    if (!opts.silent) showToast('请先播放歌曲');
    return 0;
  }
  offset = normalizeLyricTimingOffsetSeconds(offset);
  var previous = key && lyricTimingOffsetMap && lyricTimingOffsetMap[key] ? lyricTimingOffsetEntryValue(lyricTimingOffsetMap[key]) : 0;
  var hadEntry = !!(key && lyricTimingOffsetMap && lyricTimingOffsetMap[key]);
  if (!offset && !hadEntry) {
    updateLyricTimingOffsetUi(song);
    refreshLyricTimingAfterOffsetChange();
    if (!opts.silent) showToast(lyricTimingToastText(0));
    return 0;
  }
  if (offset && hadEntry && previous === offset) {
    updateLyricTimingOffsetUi(song);
    if (!opts.silent) showToast(lyricTimingToastText(offset));
    return offset;
  }
  if (offset) {
    lyricTimingOffsetMap[key] = {
      offset: offset,
      updatedAt: Date.now(),
      title: String(song.name || song.title || '').slice(0, 80),
      artist: String(song.artist || '').slice(0, 80)
    };
  } else if (lyricTimingOffsetMap && lyricTimingOffsetMap[key]) {
    delete lyricTimingOffsetMap[key];
  }
  writeLyricTimingOffsetMap();
  updateLyricTimingOffsetUi(song);
  refreshLyricTimingAfterOffsetChange();
  if (!opts.silent) showToast(lyricTimingToastText(offset));
  return offset;
}
function adjustCurrentLyricTimingOffset(delta) {
  var next = getActiveLyricTimingOffsetSeconds() + (Number(delta) || 0);
  return setCurrentLyricTimingOffset(next);
}
function handleLyricTimingOffsetClick(e) {
  if (e && e._mineradioLyricTimingHandled) return;
  var stepBtn = e && e.target && e.target.closest ? e.target.closest('[data-lyric-offset-step]') : null;
  var resetBtn = e && e.target && e.target.closest ? e.target.closest('[data-lyric-offset-reset]') : null;
  if (!stepBtn && !resetBtn) return;
  if (e) { e._mineradioLyricTimingHandled = true; e.preventDefault(); e.stopPropagation(); }
  if (resetBtn) setCurrentLyricTimingOffset(0);
  else adjustCurrentLyricTimingOffset(Number(stepBtn.getAttribute('data-lyric-offset-step')) || 0);
  var root = document.getElementById('lyric-timing-control');
  var active = document.activeElement;
  if (root && active && root.contains(active) && typeof active.blur === 'function') { try { active.blur(); } catch (e2) { } }
}
function bindLyricTimingOffsetControls() {
  var root = document.getElementById('lyric-timing-control');
  if (!root || root._mineradioLyricTimingBound) return;
  root._mineradioLyricTimingBound = true;
  root.addEventListener('mouseenter', function () { clearLyricTimingPopoverClose(); updateLyricTimingOffsetUi(); });
  root.addEventListener('focusin', function () { clearLyricTimingPopoverClose(); updateLyricTimingOffsetUi(); });
  root.addEventListener('click', handleLyricTimingOffsetClick);
  Array.prototype.forEach.call(root.querySelectorAll('[data-lyric-offset-step],[data-lyric-offset-reset]'), function (btn) {
    btn.addEventListener('click', handleLyricTimingOffsetClick);
  });
  document.addEventListener('pointerdown', function (e) {
    if (!root.contains(e.target)) closeLyricTimingPopover(false);
  }, true);
  updateLyricTimingOffsetUi();
}
// === 播放快照恢复系统（适配修改版：复用既有 savePlaybackSession / applyPlaybackSession 基础设施）===
var restoredLastPlaybackSnapshot = null;
var pendingPlaybackResumeAt = 0;
var lastPlaybackSnapshotSavedAt = 0;
var startupAutoplayJobId = 0;
var startupAutoplayAttemptCount = 0;
var startupAutoplayAttempted = false;
var startupAutoplayRetryTimer = null;
var startupAutoplayHomeFallbackTried = false;
var startupRestoreHomePending = false;
var startupHomeRevealReady = true;
var startupAutoplayHomeQueuedReason = '';
function saveLastPlaybackSnapshot(force, reason) {
  // 复用修改版既有的 savePlaybackSession（已保存 currentIdx/currentTime/duration/queue/song）
  if (typeof savePlaybackSession === 'function') {
    savePlaybackSession(!!force);
    if (force) lastPlaybackSnapshotSavedAt = Date.now();
  }
}
function applyRestoredPlaybackProgressUi(snapshot) {
  snapshot = snapshot || {};
  var durationSec = Number(snapshot.duration) || (snapshot.current ? playbackDurationFromSong(snapshot.current) : 0) || 0;
  var currentSec = Math.max(0, Number(snapshot.currentTime) || 0);
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  setProgressVisual(durationSec > 0 ? (currentSec / durationSec * 100) : 0);
  var timeDisplay = document.getElementById('time-display');
  if (timeDisplay) timeDisplay.textContent = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
}
function isStartupAutoplayPlaying() {
  return !!(typeof audio !== 'undefined' && audio && audio.src && !audio.paused && !audio.ended);
}
function clearStartupAutoplayRetryTimer() {
  if (startupAutoplayRetryTimer) { clearTimeout(startupAutoplayRetryTimer); startupAutoplayRetryTimer = null; }
}
function startupAutoplayRetryDelay(attempt) {
  var delays = [80, 260, 620, 1100, 1800, 2800, 4200, 6200, 8800, 12000, 16000, 22000];
  return delays[Math.min(delays.length - 1, Math.max(0, attempt))];
}
function scheduleStartupAutoplayRetry(jobId, reason, delay) {
  clearStartupAutoplayRetryTimer();
  if (!startupAutoplayPreference || jobId !== startupAutoplayJobId) return false;
  if (isStartupAutoplayPlaying()) return true;
  startupAutoplayRetryTimer = setTimeout(function () {
    startupAutoplayRetryTimer = null;
    runStartupAutoplayAttempt(jobId, reason || 'retry');
  }, delay == null ? startupAutoplayRetryDelay(startupAutoplayAttemptCount) : delay);
  return true;
}
function finishStartupAutoplayJob(success) {
  clearStartupAutoplayRetryTimer();
  if (success) {
    startupRestoreHomePending = false;
    if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
    return;
  }
  // 简化：不做首页推荐回退（修改版首页推荐 API 与原版不同），仅提示并保持队列已恢复状态
  if (typeof showToast === 'function') showToast('启动自动播放未成功，可手动点击播放');
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
}
function runStartupAutoplayAttempt(jobId, reason) {
  if (!startupAutoplayPreference || jobId !== startupAutoplayJobId) return false;
  if (!restoredLastPlaybackSnapshot) return false;
  if (isStartupAutoplayPlaying()) { finishStartupAutoplayJob(true); return true; }
  startupAutoplayAttemptCount += 1;
  // 音频已由 applyPlaybackSession 载入（holdPaused 暂停态），此处尝试触发播放
  Promise.resolve(typeof playAudio === 'function' ? playAudio({ silent: true }) : null)
    .catch(function (e) { console.warn('[StartupAutoplay]', reason || 'startup', e); })
    .then(function () {
      if (jobId !== startupAutoplayJobId || !startupAutoplayPreference) return;
      setTimeout(function () {
        if (jobId !== startupAutoplayJobId || !startupAutoplayPreference) return;
        if (isStartupAutoplayPlaying()) { finishStartupAutoplayJob(true); return; }
        if (startupAutoplayAttemptCount >= 12) { finishStartupAutoplayJob(false); return; }
        scheduleStartupAutoplayRetry(jobId, 'retry-after-' + reason);
      }, 260);
    });
  return true;
}
function restoreLastPlaybackSnapshot() {
  if (restoredLastPlaybackSnapshot) return false;
  var snapshot = (typeof readPlaybackSession === 'function') ? readPlaybackSession() : null;
  if (!snapshot || !snapshot.song) return false;
  restoredLastPlaybackSnapshot = snapshot;
  // 防止后续登录动作触发重复恢复
  try { if (typeof playbackSessionRestoreAttempted !== 'undefined') playbackSessionRestoreAttempted = true; } catch (e) { }
  var resumeAt = startupResumeModePreference === 'beginning' ? 0 : (Number(snapshot.currentTime) || 0);
  pendingPlaybackResumeAt = resumeAt;
  // "从头开始"模式：传给 applyPlaybackSession 的快照 currentTime 置 0（applyPlaybackSession 内部用 session.currentTime）
  var sessionForApply = (startupResumeModePreference === 'beginning') ? Object.assign({}, snapshot, { currentTime: 0 }) : snapshot;
  var applyPromise = (typeof applyPlaybackSession === 'function')
    ? applyPlaybackSession(sessionForApply, { holdPaused: true, toast: false, manual: false, preserveHomeState: true })
    : Promise.resolve(false);
  Promise.resolve(applyPromise).then(function () {
    applyRestoredPlaybackProgressUi({ currentTime: resumeAt, duration: Number(snapshot.duration) || 0, current: snapshot.song });
    if (startupAutoplayPreference) {
      startupAutoplayJobId += 1;
      startupAutoplayAttemptCount = 0;
      startupAutoplayAttempted = true;
      scheduleStartupAutoplayRetry(startupAutoplayJobId, 'startup', 900);
    }
  }).catch(function (e) { console.warn('[RestoreLastPlaybackSnapshot]', e); });
  return true;
}
// 绑定启动恢复模式分段按钮 + 歌词偏移 popover 控件
(function bindStartupSnapshotControls() {
  var seg = document.getElementById('startup-resume-mode-seg');
  if (seg && !seg._mineradioResumeModeBound) {
    seg._mineradioResumeModeBound = true;
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setStartupResumeMode(b.getAttribute('data-startup-resume-mode')); });
    });
  }
  applyStartupResumeModeUi();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLyricTimingOffsetControls);
  } else {
    bindLyricTimingOffsetControls();
  }
})();
// === 音频输出设备 ===