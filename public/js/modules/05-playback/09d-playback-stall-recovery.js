// =============================================================================
// 播放卡顿 / 错误 / 长暂停后重新取链恢复
// =============================================================================

function clearPlaybackResumeWatchdogs() {
  if (!playbackResumeRecovery || !Array.isArray(playbackResumeRecovery.timerIds)) return;
  playbackResumeRecovery.timerIds.forEach(function (timerId) { clearTimeout(timerId); });
  playbackResumeRecovery.timerIds = [];
}

function clearPlaybackResumePauseMarker() {
  if (!playbackResumeRecovery) return;
  playbackResumeRecovery.pausedAt = 0;
  playbackResumeRecovery.pausedSongKey = '';
  playbackResumeRecovery.pausedSrc = '';
  playbackResumeRecovery.pausedPosition = 0;
}

function updatePlaybackResumePauseMarker(reason) {
  if (!playbackResumeRecovery) return;
  if (reason === 'pause' || reason === 'manual-pause') {
    var song = playQueue && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
    var src = audio && (audio.currentSrc || audio.src || '') || '';
    if (!song || !src || !audio || audio.ended) {
      clearPlaybackResumePauseMarker();
      return;
    }
    playbackResumeRecovery.pausedAt = Date.now();
    playbackResumeRecovery.pausedSongKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
    playbackResumeRecovery.pausedSrc = src;
    playbackResumeRecovery.pausedPosition = isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    return;
  }
  if (
    reason === 'play' || reason === 'playing' || reason === 'ended' ||
    reason === 'emptied' || reason === 'abort' || reason === 'error' ||
    reason === 'track-switch'
  ) {
    clearPlaybackResumePauseMarker();
  }
}

function setPlaybackBufferingState(active, reason) {
  if (!playbackResumeRecovery) return;
  var next = !!active;
  if (playbackResumeRecovery.buffering === next) return;
  playbackResumeRecovery.buffering = next;
  var bar = document.getElementById('progress-bar');
  if (bar) bar.classList.toggle('is-buffering', next);
  if (next) {
    if (typeof showLoading === 'function') showLoading();
  } else if (reason !== 'track-switch' && typeof hideLoading === 'function') {
    hideLoading();
  }
}

function currentResumeSeconds(fallback) {
  if (audio && isFinite(audio.currentTime) && audio.currentTime > 0) return audio.currentTime;
  if (typeof getPlaybackCurrentSeconds === 'function') {
    var current = getPlaybackCurrentSeconds();
    if (isFinite(current) && current > 0) return current;
  }
  return Math.max(0, Number(fallback) || 0);
}

function canRefreshCurrentPlaybackUrlForResume(song) {
  if (!song || song.type === 'local' || song.source === 'local' || song.localUrl) return false;
  var provider = typeof getMusicProviderKey === 'function'
    ? getMusicProviderKey(song)
    : (typeof songProviderKey === 'function' ? songProviderKey(song) : '');
  return provider === 'netease' || provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify';
}

function playbackResumeProvider(song) {
  if (!song) return '';
  return typeof getMusicProviderKey === 'function'
    ? getMusicProviderKey(song)
    : (typeof songProviderKey === 'function' ? songProviderKey(song) : '');
}

function playbackResumeLongPauseThresholdMs(song) {
  var provider = playbackResumeProvider(song);
  var providerMs = PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS && PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS[provider];
  return Math.max(30000, Number(providerMs || PLAYBACK_RESUME_LONG_PAUSE_MS || 0) || (8 * 60 * 1000));
}

function playbackResumePausedLongEnough(song) {
  if (!playbackResumeRecovery || !playbackResumeRecovery.pausedAt) return false;
  if (!song || !canRefreshCurrentPlaybackUrlForResume(song)) return false;
  var markerKey = playbackResumeRecovery.pausedSongKey || '';
  var currentKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
  if (markerKey && currentKey && markerKey !== currentKey) return false;
  var markerSrc = playbackResumeRecovery.pausedSrc || '';
  var currentSrc = audio && (audio.currentSrc || audio.src || '') || '';
  if (markerSrc && currentSrc && markerSrc !== currentSrc) return false;
  return Date.now() - playbackResumeRecovery.pausedAt >= playbackResumeLongPauseThresholdMs(song);
}

function playbackFreshUrlRecoverySongKey(song) {
  if (typeof queueItemKey === 'function') return queueItemKey(song);
  return song ? [playbackResumeProvider(song), song.id || song.mid || song.hash || ''].join(':') : '';
}

function resetPlaybackFreshUrlRecoveryBudget(song) {
  if (!playbackResumeRecovery) return;
  playbackResumeRecovery.freshUrlSongKey = playbackFreshUrlRecoverySongKey(song);
  playbackResumeRecovery.freshUrlAttemptCount = 0;
  playbackResumeRecovery.softRetryCount = 0;
  /* 源指纹跟着预算一起归零，否则换歌后仍会用上一首的「源没变」去解释提示文案。 */
  playbackResumeRecovery.lastSourceRevision = '';
  playbackResumeRecovery.recoveryRevisionChanged = null;
}

function isSameAudioPlaybackTarget(media, src) {
  return !!(audio && media && audio === media && (audio.currentSrc || audio.src || '') === src);
}

/* 切歌进行中 / 还有目标排队：看门狗必须站住不动。
 * 换源会给共享 audio 重新 load，这个过程中 readyState 天然是 0、看似「卡住」，
 * 此时软重试再补一刀 media.load() 只会把还在飞的 play() 打断
 * （AbortError: The play() request was interrupted by a new load request），
 * 本来能播的曲目就这样被判成播放失败。 */
function playbackTrackSwitchInProgress() {
  if (typeof pendingTrackSwitch !== 'undefined' && pendingTrackSwitch) return true;
  if (typeof trackSwitchDrain !== 'undefined' && trackSwitchDrain) return true;
  return false;
}

function playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial) {
  if (playbackTrackSwitchInProgress()) return false;
  if (!isSameAudioPlaybackTarget(media, src)) return false;
  if (token !== trackSwitchToken || recoverySerial !== playbackResumeRecovery.serial) return false;
  if (media.paused || media.ended || media.seeking) return false;
  return true;
}

async function softRetryStalledAudio(media, src, token, resumeAt) {
  if (playbackTrackSwitchInProgress()) return false;
  if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken) return false;
  var target = Math.max(0, Number(resumeAt) || (isFinite(media.currentTime) ? media.currentTime : 0));
  try {
    setPlaybackBufferingState(true, 'soft-retry');
    if (media.readyState >= 2) {
      try { media.currentTime = target; } catch (_) {}
      await media.play();
    } else if (!media.readyState && media.networkState === media.NETWORK_LOADING) {
      /* 新源还在下载：再 load() 等于把请求推倒重来并打断在飞的 play()。
         这里只补一次 play()，让它挂着等数据到位。 */
      await media.play();
    } else {
      media.load();
      await new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          media.removeEventListener('canplay', finish);
          media.removeEventListener('error', finish);
          resolve();
        }
        media.addEventListener('canplay', finish, { once: true });
        media.addEventListener('error', finish, { once: true });
        setTimeout(finish, 1800);
      });
      if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken) return false;
      try { if (target > 0.2) media.currentTime = target; } catch (_) {}
      await media.play();
    }
    if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken) return false;
    if (media.paused || media.ended) return false;
    setPlaybackBufferingState(false, 'soft-retry-ok');
    return true;
  } catch (err) {
    console.warn('[PlaybackStallRecovery] soft retry failed:', err && (err.message || err));
    return false;
  }
}

/* 源指纹（09f 缺席时返回空串，恢复主流程不受影响）。 */
function playbackSourceRevisionOf(song) {
  if (typeof buildPlaybackSourceRevision !== 'function') return '';
  try {
    var src = (audio && (audio.currentSrc || audio.src)) || '';
    return buildPlaybackSourceRevision(song, src);
  } catch (_) { return ''; }
}

async function recoverCurrentTrackPlaybackFromFreshUrl(reason, opts) {
  opts = opts || {};
  if (playbackTrackSwitchInProgress()) return false;
  if (!playQueue.length || currentIdx < 0 || currentIdx >= playQueue.length) return false;
  var song = playQueue[currentIdx];
  if (!canRefreshCurrentPlaybackUrlForResume(song)) return false;
  var songKey = playbackFreshUrlRecoverySongKey(song);
  if (playbackResumeRecovery.freshUrlSongKey !== songKey) resetPlaybackFreshUrlRecoveryBudget(song);
  var now = performance.now();
  if (playbackResumeRecovery.pending || now - (playbackResumeRecovery.lastAttemptAt || 0) < 1200) return false;
  if ((Number(playbackResumeRecovery.freshUrlAttemptCount) || 0) >= 1) {
    if (!opts.silent && typeof showSourceFallbackNotice === 'function') {
      /* 上一次换链拿回来的还是同一个源：不是「重新取链也播不了」，而是根本没换到新链接，
         再取一次也是同一枚签名 URL，该让用户换音质或换音源。 */
      if (playbackResumeRecovery.recoveryRevisionChanged === false) {
        showSourceFallbackNotice('播放恢复已停止', '这个音源没有可用的备用链接，请切换音质或换一个音源。');
      } else {
        showSourceFallbackNotice('播放恢复已停止', '重新取链后仍无法播放，请手动换歌或切换音质。');
      }
    }
    return false;
  }
  playbackResumeRecovery.freshUrlAttemptCount = (Number(playbackResumeRecovery.freshUrlAttemptCount) || 0) + 1;
  playbackResumeRecovery.pending = true;
  playbackResumeRecovery.lastAttemptAt = now;
  playbackResumeRecovery.lastReason = reason || 'resume-recovery';
  playbackResumeRecovery.serial++;
  /* 换链前的源指纹，换完再算一次做对比：同一枚 URL 说明 CDN 没轮换签名，
     「换了源还是不行」和「没换到源」是两种完全不同的结论，别混成一个提示。 */
  var revisionBefore = playbackSourceRevisionOf(song);
  playbackResumeRecovery.lastSourceRevision = revisionBefore;
  playbackResumeRecovery.recoveryRevisionChanged = null;
  clearPlaybackResumeWatchdogs();
  var resumeAt = currentResumeSeconds(opts.resumeAt);
  try {
    if (!opts.silent && typeof showSourceFallbackNotice === 'function') {
      showSourceFallbackNotice('播放恢复保护', '旧播放链接可能已失效，正在重新取链并回到原进度。');
    }
    var recovered = await playQueueAt(currentIdx, {
      manual: true,
      resumeAt: resumeAt,
      preserveHomeState: true,
      resumeRecovery: true
    });
    if (typeof playbackSourceRevisionChanged === 'function') {
      playbackResumeRecovery.recoveryRevisionChanged =
        playbackSourceRevisionChanged(revisionBefore, playbackSourceRevisionOf(song));
    }
    return recovered === true;
  } catch (recoveryErr) {
    console.warn('[PlaybackStallRecovery]', reason, recoveryErr);
    return false;
  } finally {
    playbackResumeRecovery.pending = false;
    setPlaybackBufferingState(false, 'fresh-url-done');
    if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  }
}

function schedulePlaybackStallRecovery(reason, opts) {
  opts = opts || {};
  var media = opts.ownerMedia || audio;
  /* 切歌 / 换源产生的 MEDIA_ERR_ABORTED 是「操作被中断」，不是播放失败。
   * 旧行为给它安排看门狗，随后的软重试会去打断新一次起播的 play()。
   * 分类器缺席时 typeof 兜底，保持原有恢复能力。 */
  if (typeof mediaFailureBlocksStallRecovery === 'function' &&
      mediaFailureBlocksStallRecovery(reason, media)) {
    setPlaybackBufferingState(false, 'media-aborted');
    return;
  }
  if (!media || media !== audio || !media.src) return;
  if (opts.ownerToken != null && Number(opts.ownerToken) !== Number(trackSwitchToken)) return;
  var song = playQueue[currentIdx];
  if (!canRefreshCurrentPlaybackUrlForResume(song) && reason !== 'waiting' && reason !== 'stalled') {
    // 本地文件仍做 soft retry，不做重新取链
  }
  clearPlaybackResumeWatchdogs();
  playbackResumeRecovery.serial = (Number(playbackResumeRecovery.serial) || 0) + 1;
  var src = media.currentSrc || media.src || '';
  var token = trackSwitchToken;
  var startTime = isFinite(media.currentTime) ? media.currentTime : 0;
  var recoverySerial = playbackResumeRecovery.serial;
  var delays = Array.isArray(PLAYBACK_RESUME_STALL_DELAYS) ? PLAYBACK_RESUME_STALL_DELAYS : [1600, 3600];

  if (reason === 'waiting' || reason === 'stalled' || reason === 'error') {
    setPlaybackBufferingState(true, reason);
  }

  delays.forEach(function (delayMs, delayIdx) {
    var timerId = setTimeout(async function () {
      if (!playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial)) {
        if (token === trackSwitchToken) setPlaybackBufferingState(false, 'owner-changed');
        return;
      }
      var current = isFinite(media.currentTime) ? media.currentTime : 0;
      var minAdvance = delayMs > 2000 ? 0.28 : 0.08;
      if (current >= startTime + minAdvance) {
        setPlaybackBufferingState(false, 'advanced');
        return;
      }
      // 首档：软重试（seek/load + play）
      if (delayIdx === 0 && (Number(playbackResumeRecovery.softRetryCount) || 0) < 1) {
        playbackResumeRecovery.softRetryCount = (Number(playbackResumeRecovery.softRetryCount) || 0) + 1;
        if (await softRetryStalledAudio(media, src, token, current || startTime)) return;
      }
      if (delayMs < 3000 && media.readyState >= 2 && media.networkState !== media.NETWORK_NO_SOURCE) return;
      /* 软重试期间用户又开始切歌了（它因此返回 false）：这里必须跟着退场。
         否则会走下面的重新取链，把新一次起播的 play() 打断 —— 正是本轮要修的那个 AbortError。 */
      if (playbackTrackSwitchInProgress()) return;
      if (!canRefreshCurrentPlaybackUrlForResume(song)) {
        if (!opts.silent && typeof showToast === 'function') showToast('网络缓冲异常，请稍后重试或拖动进度');
        setPlaybackBufferingState(false, 'no-refresh');
        return;
      }
      var recovered = await recoverCurrentTrackPlaybackFromFreshUrl(reason || 'resume-stalled', {
        resumeAt: current || startTime,
        silent: opts.silent
      });
      if (!recovered && !opts.silent && typeof showSourceFallbackNotice === 'function') {
        showSourceFallbackNotice('播放仍在缓冲', '若长时间无声，可拖动进度或切换音质后再试。');
      }
    }, delayMs);
    playbackResumeRecovery.timerIds.push(timerId);
  });
}

async function maybeRecoverPlaybackAfterLongPause(opts) {
  opts = opts || {};
  if (!playQueue.length || currentIdx < 0 || currentIdx >= playQueue.length) return null;
  var song = playQueue[currentIdx];
  if (!playbackResumePausedLongEnough(song)) return null;
  var resumeAt = currentResumeSeconds(playbackResumeRecovery.pausedPosition);
  clearPlaybackResumePauseMarker();
  var ok = await recoverCurrentTrackPlaybackFromFreshUrl('long-pause-resume', {
    resumeAt: resumeAt,
    silent: !!opts.silent
  });
  return !!ok;
}
