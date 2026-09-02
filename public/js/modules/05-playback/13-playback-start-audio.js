var firstPlayDone = false;

function pauseCurrentAudioForTrackSwitch() {
  playToggleBusy = false;
  if (typeof clearPlaybackResumeWatchdogs === 'function') clearPlaybackResumeWatchdogs();
  if (typeof setPlaybackBufferingState === 'function') setPlaybackBufferingState(false, 'track-switch');
  if (!audio) return;
  try {
    audioFadeSerial++;
    clearAudioFadeTimers();
    audio.onended = null;
    audio.pause();
  } catch (e) {}
  playing = false;
  setPlayIcon(false);
  syncPlaybackStateFromAudioEvent('track-switch');
}

function syncPlaybackStateFromAudioEvent(reason) {
  var isPlaying = !!(audio && audio.src && !audio.paused && !audio.ended);
  playing = isPlaying;
  setPlayIcon(isPlaying);
  if (!isPlaying) hideLoading();
  if (reason === 'play' || reason === 'playing') switchPlaybackVisualToEmily();
  if (typeof updatePlaybackResumePauseMarker === 'function') updatePlaybackResumePauseMarker(reason);
  forcePlaybackControlsInteractive();
}

function isPlaybackRecursionError(err) {
  var msg = String((err && err.message) || err || '');
  return err instanceof RangeError || /maximum call stack size exceeded/i.test(msg);
}

function safePlaybackStep(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[PlaybackSetupStep]', label, err);
    return null;
  }
}

function playbackFailureToastText(err) {
  if (isPlaybackRecursionError(err)) return '播放准备异常，已保持播放器可操作';
  return '播放失败: ' + (err && err.message ? err.message : err);
}
function scheduleAudioResumePosition(media, seconds, token) {
  seconds = Math.max(0, Number(seconds) || 0);
  if (!media || seconds < 0.35) return;
  var applied = false;
  function applyResume() {
    if (applied || token !== trackSwitchToken || !media) return;
    var duration = Number(media.duration) || 0;
    var target = duration > 0 ? Math.min(seconds, Math.max(0, duration - 0.45)) : seconds;
    try {
      media.currentTime = target;
      applied = true;
      if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(target, true);
      if (typeof syncPodcastDjMapCursor === 'function') syncPodcastDjMapCursor(target, true);
      updatePlaybackProgressUi();
    } catch (e) {}
  }
  media.addEventListener('loadedmetadata', applyResume, { once: true });
  media.addEventListener('canplay', applyResume, { once: true });
  setTimeout(applyResume, 520);
  applyResume();
}

async function playQueueAt(idx, opts) {
  opts = opts || {};
  // 返回 boolean：false 表示换源事务已过期/应中止，勿把 true 写回 opts
  if (typeof beginSourceFallbackPlaybackInvocation === 'function' && !beginSourceFallbackPlaybackInvocation(opts)) return;
  if (idx < 0 || idx >= playQueue.length) return;
  markRenderInteraction('track-switch', 1500);
  var playPhase = 'start';
  function markPlayPhase(name) { playPhase = name; }
  try {
  markPlayPhase('session-finalize');
  safePlaybackStep('session-finalize', function(){ finalizeListenSession(false); });
  prepareLeaveHomeForPlayback({ unsuppress: !opts.preserveHomeState });
  currentIdx = idx;
  safePlaybackStep('shelf-current-sync', function(){
    if (shelfManager && shelfManager.syncOpenContentToCurrent) shelfManager.syncOpenContentToCurrent(false);
  });
  trackSwitchToken++;
  resetCuefieldAutoMix(opts.cuefieldAutoMix ? 'cuefield-handoff' : 'track-switch', {
    preservePreparedAudio: !!opts.cuefieldAutoMix,
    preserveExecution: !!opts.cuefieldAutoMix
  });
  markPlayPhase('cancel-previous-track');
  cancelBeatAnalysisTimer();
  cancelBeatPrefetchTimer();
  if (localBeatAnalysis.active) cancelLocalBeatAnalysis();
  closeGsapModal(document.getElementById('local-beat-modal'));
  beatMapToken++;
  var token = trackSwitchToken;
  var firstVisualPlay = !firstPlayDone;
  markPlayPhase('track-setup');
  var song = safePlaybackStep('hydrate-song', function(){ return hydrateCustomCover(playQueue[idx]); }) || playQueue[idx];
  playQueue[idx] = song;
  var prevContext = activeRadioContext;
  var playbackContext = opts.context || (song && song.radioContext) || null;
  syncSceneRadioPlaybackContext(prevContext, playbackContext);
  activeRadioContext = playbackContext || null;
  // 切歌先出关键 UI；队列面板等重渲染放到出声后，减少切歌掉帧
  safePlaybackStep('shelf-preview-suppress', suppressShelfPreviewForPlaybackSwitch);
  pauseCurrentAudioForTrackSwitch();
  var bmKey = safePlaybackStep('beatmap-key', function(){ return beatMapSongKey(song); }) || '';
  var podcastDjMode = !!safePlaybackStep('podcast-mode', function(){ return isPodcastSong(song); });
  safePlaybackStep('dj-mode', function(){ setDjModeActive(podcastDjMode, song); });
  safePlaybackStep('visual-switch', switchPlaybackVisualToEmily);
  currentLocalSong = null;
  safePlaybackStep('cover-button', updateCustomCoverButton);
  safePlaybackStep('like-buttons', function(){ updateLikeButtons(song); });
  safePlaybackStep('like-status', function(){ syncLikeStatusForSong(song); });
  safePlaybackStep('quality-ui', updatePlaybackQualityUi);
  safePlaybackStep('cinema-track-profile', function(){ resetCinemaTrackProfile(song); });
  safePlaybackStep('empty-home', function(){ if (!opts.preserveHomeState) updateEmptyHomeVisibility(); });
  safePlaybackStep('track-ui', function(){
    document.getElementById('hint').classList.add('hidden');
    document.getElementById('thumb-title').textContent = song.name;
    document.getElementById('thumb-artist').textContent = song.artist;
    updateControlTrackInfo(song);
    document.getElementById('thumb-wrap').classList.add('visible');
  });
  markPlayPhase('lyric-prep');
  safePlaybackStep('lyric-prep', function(){
    var initialLyricLines = withLyricFallback([]);
    setOriginalLyricsState(initialLyricLines, false, 'fallback');
    applyPreferredLyricsForCurrent(true);
  });

  markPlayPhase('cover-load');
  safePlaybackStep('cover-load', function(){
    var customCover = getCustomCoverForSong(song);
    var coverOpts = { trackToken: token, deferHeavy: true, delay: firstVisualPlay ? 420 : 900, timeout: firstVisualPlay ? 1600 : 2400 };
    if (customCover) applyCoverDataUrl(customCover, coverOpts);
    else loadCoverFromUrl(song.cover ? coverUrlWithSize(song.cover, 400) : '', coverOpts);
  });
  safePlaybackStep('trial-banner-reset', function(){ document.getElementById('trial-banner').classList.remove('show'); });
  safePlaybackStep('show-loading', showLoading);
  lyricSunEnergy = 0; lyricSunTarget = 0; lyricSunHold = 0; lyricSunAvg = 0; lyricSunPeak = 0.55;

  // 首次播放: 粒子从暗处浮出 (Apple 风格)
  if (firstVisualPlay) {
    safePlaybackStep('first-visual-alpha', function(){
      firstPlayDone = true;
      tweenParticleAlpha(uniforms.uAlpha.value || 0, 1.0, 220);
    });
  }

  try {
    markPlayPhase('source-url');
    var playbackProvider = typeof getMusicProviderKey === 'function' ? getMusicProviderKey(song) : songProviderKey(song);
    var isQQPlayback = playbackProvider === 'qq';
    var isKugouPlayback = playbackProvider === 'kugou';
    var isQishuiPlayback = playbackProvider === 'qishui';
    var isSpotifyPlayback = playbackProvider === 'spotify';
    if (isQQPlayback && typeof ensureQQSessionBeforePlay === 'function') {
      try { await ensureQQSessionBeforePlay('pre-play'); } catch (prePlayErr) {
        console.warn('QQ pre-play session check failed:', prePlayErr);
      }
      if (token !== trackSwitchToken) return;
    }
    var qualityMeta = typeof resolveProviderRequestedQuality === 'function'
      ? resolveProviderRequestedQuality(song, opts)
      : null;
    var requestedQuality = qualityMeta ? qualityMeta.quality : normalizePlaybackQuality(opts.qualityOverride || playbackQuality);
    var data = typeof resolveProviderPlayUrlData === 'function'
      ? await resolveProviderPlayUrlData(song, opts)
      : await apiJson('/api/song/url?id=' + song.id + '&quality=' + encodeURIComponent(requestedQuality));
    if (token !== trackSwitchToken) return;
    if (
      typeof sourceFallbackRecoveryFromOptions === 'function'
      && sourceFallbackRecoveryFromOptions(opts)
      && typeof sourceFallbackRecoveryCanContinue === 'function'
      && !sourceFallbackRecoveryCanContinue(sourceFallbackRecoveryFromOptions(opts))
      && typeof settleExpiredSourceFallbackPlayback === 'function'
    ) {
      return settleExpiredSourceFallbackPlayback(idx, token, opts);
    }
    if (data) {
      song.resolvedPlaybackProvider = playbackProvider;
      if (!data.sourceMatch) song.playbackSource = data.source || data.provider || song.playbackSource || '';
      if (playbackProvider === 'netease' && !data.sourceMatch && typeof clearNeteaseSourceMatchMetadata === 'function') {
        clearNeteaseSourceMatchMetadata(song);
      }
      if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(song);
    }
    if (!data || !data.url) {
      if (isQQPlayback && await retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality)) return;
      var fbNoUrl = await tryAutoPlaybackFallback(song, data, idx, token, opts);
      if (fbNoUrl != null) return fbNoUrl;
      handlePlaybackUnavailable(song, data);
      return;
    }
    if (playbackProvider === 'netease' && data.sourceMatch && typeof applyNeteaseSourceMatchMetadata === 'function') {
      applyNeteaseSourceMatchMetadata(song, data);
      if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(song);
      if (!opts.startupAutoplay && !opts.qualitySwitch && !song.neteaseSourceMatchNotified && typeof showSourceFallbackNotice === 'function') {
        song.neteaseSourceMatchNotified = true;
        var matchAlbum = data.matchedSong && (data.matchedSong.album || data.matchedSong.albumName) || '';
        showSourceFallbackNotice(
          '已切换到可播放的同曲版本',
          matchAlbum ? ('匹配专辑：' + matchAlbum) : '原曲暂时无法完整播放，已自动改用站内同录音版本。'
        );
      }
    }
    var resolvedQualityText = playbackResolvedQualityText(data);
    if (isQishuiPlayback && playbackQualityWasDowngraded(requestedQuality, data.level)) {
      showSourceFallbackNotice('汽水音质自动降级', '请求 ' + playbackQualityLabel(requestedQuality) + '，实际播放 ' + resolvedQualityText + '。');
    } else if (!isQQPlayback && !isKugouPlayback && !isQishuiPlayback && !isSpotifyPlayback && playbackQualityWasDowngraded(requestedQuality, data.level)) {
      showSourceFallbackNotice('网易云音质自动降级', '请求 ' + playbackQualityLabel(requestedQuality) + '，实际播放 ' + resolvedQualityText + '。');
    } else if (opts.qualitySwitch) {
      showSourceFallbackNotice('音质已切换', '实际播放: ' + resolvedQualityText + '。');
    }
    if (data.trial) {
      var txt;
      if (data.loggedIn && data.vipLevel === 'svip') txt = '此歌曲需要单曲、专辑购买或更高权限';
      else if (data.loggedIn && data.vipLevel === 'vip') txt = '此歌曲需要 SVIP 或购买 · 当前仅播放试听片段';
      else if (data.loggedIn) txt = '此歌曲需 VIP · 当前仅播放试听片段';
      else txt = '当前未登录 · 仅播放试听片段';
      document.getElementById('trial-text').textContent = txt;
      var trialLoginBtn = document.getElementById('trial-login-btn');
      if (trialLoginBtn) {
        trialLoginBtn.style.display = data.loggedIn ? 'none' : '';
        trialLoginBtn.onclick = function(){ openProviderLogin('netease'); };
      }
      document.getElementById('trial-banner').classList.add('show');
    }
    markPlayPhase('audio-element');
    if (!audio) { audio = new Audio(); audio.crossOrigin = 'anonymous'; }
    else {
      audioFadeSerial++;
      clearAudioFadeTimers();
      audio.pause();
    }
    bindPlaybackProgressEvents(audio);
    applyVolumeToAudio();
    var proxyAudioUrl = await Mineradio.api.apiMediaProxyUrlAsync('/api/audio', { url: data.url });
    audio.src = proxyAudioUrl;
    updatePlaybackProgressUi();
    audio.onended = function(){
      if (token !== trackSwitchToken) return;
      finalizeListenSession(true);
      noteCuefieldAutoMixOutgoingEnded(audio, token, currentIdx);
      if (sleepTimer.pendingStop) {
        executeSleepTimerStop();
        return;
      }
      if (playMode === 'single') setTimeout(function(){ playQueueAt(currentIdx, { autoRepeat: true, preserveHomeState: true }); }, 0);
      else setTimeout(nextTrack, 0);
    };
    scheduleAudioResumePosition(audio, opts.resumeAt, token);
    audio.load();
    if (opts.holdPaused && audio) {
      var holdPauseOnce = function () {
        if (token !== trackSwitchToken || !audio) return;
        try { audio.pause(); } catch (e) {}
        playing = false;
        setPlayIcon(false);
        updatePlaybackProgressUi();
        savePlaybackSession(true);
      };
      audio.addEventListener('loadedmetadata', holdPauseOnce, { once: true });
      audio.addEventListener('canplay', holdPauseOnce, { once: true });
    }
    markPlayPhase('visual-prep');
    // 节拍分析/预取放到出声之后，避免与首包音频抢带宽
    var deferredBeatPrep = {
      podcastDjMode: podcastDjMode,
      bmKey: bmKey,
      song: song,
      dataUrl: data.url,
      proxyAudioUrl: proxyAudioUrl,
      bmTok: 0,
      idx: idx
    };
    try {
    // 重置 beatmap 状态
    currentBeatMap = null;
    beatMapNextIdx = 0;
    resetAudioVisualState();
    resetBeatCameraSync(0);
    cancelBeatAnalysisTimer();
    beatMapToken++;
    deferredBeatPrep.bmTok = beatMapToken;
    if (podcastDjMode) {
      djBeatMapToken++;
      cancelDjBeatAnalysisTimer();
      resetDjBeatMapState();
      currentBeatMap = null;
      beatMapNextIdx = 0;
      var djTok = djBeatMapToken;
      var djKey = djSongKey(song);
      deferredBeatPrep.djTok = djTok;
      deferredBeatPrep.djKey = djKey;
      if (djBeatMapCache[djKey]) {
        currentDjBeatMap = djBeatMapCache[djKey];
        applyPodcastDjProfileFromMap(currentDjBeatMap);
        syncPodcastDjMapCursor(audio ? audio.currentTime : 0, true);
        hideBeatChip();
        notifyDesktopLyricsBeatMapReady();
        console.log('podcast DJ beatmap 缓存命中:', currentDjBeatMap.cameraBeats.length, '个主拍');
        deferredBeatPrep = null;
      } else {
        showBeatChip('DJ 离线锁拍准备中…');
      }
    } else if (bmKey && beatMapCache[bmKey]) {
      currentBeatMap = beatMapCache[bmKey];
      applyCinemaProfileFromBeatMap(currentBeatMap);
      syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0);
      notifyDesktopLyricsBeatMapReady();
      console.log('beatmap 缓存命中:', currentBeatMap.kicks.length, '个鼓点');
      deferredBeatPrep.cached = true;
    } else {
      deferredBeatPrep.needDiskOrAnalyze = true;
    }
    } catch (visualErr) {
      console.warn('[PlaybackVisualPrep]', song && song.name, visualErr);
      currentBeatMap = null;
      beatMapNextIdx = 0;
      safePlaybackStep('visual-prep-hide-chip', hideBeatChip);
      deferredBeatPrep = null;
    }
    markPlayPhase('audio-start');
    var playbackStarted = false;
    if (opts.holdPaused) {
      playbackStarted = true;
      playing = false;
      setPlayIcon(false);
      restorePlaybackGain();
      hideLoading();
      forcePlaybackControlsInteractive();
      savePlaybackSession(true);
    } else {
      playbackStarted = await playAudio({ silent: isQQPlayback });
    }
    if (!playbackStarted) {
      if (
        typeof sourceFallbackRecoveryFromOptions === 'function'
        && sourceFallbackRecoveryFromOptions(opts)
        && typeof sourceFallbackRecoveryCanContinue === 'function'
        && !sourceFallbackRecoveryCanContinue(sourceFallbackRecoveryFromOptions(opts))
        && typeof settleExpiredSourceFallbackPlayback === 'function'
      ) {
        return settleExpiredSourceFallbackPlayback(idx, token, opts);
      }
      if (playbackProvider === 'netease' && data && data.sourceMatch && typeof retryNeteaseSourceMatchPlayback === 'function') {
        var sameSourceRetry = await retryNeteaseSourceMatchPlayback(song, data, idx, token, opts, requestedQuality);
        if (sameSourceRetry !== null) return sameSourceRetry === true;
      }
      if (isQQPlayback && await retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality)) return;
      var fbStart = await tryAutoPlaybackFallback(song, Object.assign({}, data || {}, { url: null, reason: 'media_start_failed' }), idx, token, opts);
      if (fbStart != null) return fbStart;
      forcePlaybackControlsInteractive();
      if (opts.manual) {
        showToast('播放启动失败，请重新选择歌曲');
      } else {
        showSourceFallbackNotice('歌曲已载入', '点击播放器中间的播放按钮继续播放。');
      }
      return;
    }
    forcePlaybackControlsInteractive();
    if (typeof markStageLyricsPlaybackResume === 'function') {
      markStageLyricsPlaybackResume('playback-started');
    }
    markPlayPhase('session-begin');
    safePlaybackStep('listen-session-begin', function(){ beginListenSession(song, playbackContext); });
    if (typeof resetPlaybackFreshUrlRecoveryBudget === 'function' && !opts.resumeRecovery) {
      resetPlaybackFreshUrlRecoveryBudget(song);
    }
    // 出声后再调度节拍分析 / 队列预取 / 货架与歌词
    (function runDeferredPlaybackSidework() {
      if (token !== trackSwitchToken) return;
      var prep = deferredBeatPrep;
      if (prep && prep.podcastDjMode && prep.djKey && !djBeatMapCache[prep.djKey]) {
        var djDurationSec = Math.max(0, Number(prep.song.duration) || 0);
        if (djDurationSec > 10000) djDurationSec /= 1000;
        schedulePodcastDjAnalysis(prep.djKey, prep.dataUrl, prep.djTok, djDurationSec);
        maybeAnnounceDjMode();
      } else if (prep && prep.cached) {
        scheduleQueueBeatPrefetch(prep.idx, 3200);
        if (typeof scheduleQueueLyricPrefetch === 'function') scheduleQueueLyricPrefetch(prep.idx, 3000);
      } else if (prep && prep.needDiskOrAnalyze) {
        var startBeatSidework = async function () {
          if (token !== trackSwitchToken) return;
          var diskBeatMap = prep.bmKey ? await readBeatDiskCache(prep.bmKey) : null;
          if (token !== trackSwitchToken) return;
          if (diskBeatMap) {
            currentBeatMap = diskBeatMap;
            applyCinemaProfileFromBeatMap(currentBeatMap);
            syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0);
            notifyDesktopLyricsBeatMapReady();
            console.log('beatmap D盘缓存命中:', currentBeatMap.kicks.length, '个鼓点');
            scheduleQueueBeatPrefetch(prep.idx, 3200);
            if (typeof scheduleQueueLyricPrefetch === 'function') scheduleQueueLyricPrefetch(prep.idx, 3000);
            return;
          }
          scheduleBeatAnalysis(prep.bmKey || prep.song.id, prep.proxyAudioUrl, prep.bmTok, prep.song);
        };
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(function () { startBeatSidework(); }, { timeout: 2200 });
        } else {
          setTimeout(function () { startBeatSidework(); }, 900);
        }
      }
    })();
    markPlayPhase('lyrics-fetch');
    var schedulePostPlayChrome = function () {
      if (token !== trackSwitchToken) return;
      if (typeof scheduleQueueLyricPrefetch === 'function') scheduleQueueLyricPrefetch(idx, 2800);
      if (song.type === 'podcast') {
        safePlaybackStep('podcast-lyrics', function(){
          var podcastLyricLines = withLyricFallback([]);
          setOriginalLyricsState(podcastLyricLines, false, 'fallback');
          applyPreferredLyricsForCurrent(true);
        });
      } else {
        fetchLyric(song, token);
      }
      safeRenderQueuePanel('play-queue-at', { scrollCurrent: miniQueueOpen });
      scheduleShelfRebuild('play-queue-at', true);
      safePlaybackStep('shelf-preview-suppress-end', suppressShelfPreviewForPlaybackSwitch);
      safePlaybackStep('snapshot-save', function(){ saveLastPlaybackSnapshot(true, 'track-switch'); });
      safePlaybackStep('lyric-offset-ui', function(){ if (typeof updateLyricTimingOffsetUi === 'function') updateLyricTimingOffsetUi(song); });
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(schedulePostPlayChrome, { timeout: 1200 });
    } else {
      setTimeout(schedulePostPlayChrome, 120);
    }
    if (opts.sourceFallbackRecovery && typeof completeSourceFallbackRecovery === 'function') {
      completeSourceFallbackRecovery(opts.sourceFallbackRecovery);
    }
    return true;
  } catch (err) {
    console.error('Play failed:', { phase: playPhase, error: err }, err);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!isPlaybackRecursionError(err) && token === trackSwitchToken) {
      try {
        var fbErr = await tryAutoPlaybackFallback(song, { url: null, reason: 'media_start_failed' }, idx, token, opts);
        if (fbErr != null) return fbErr;
      } catch (_) {}
    }
    if (!isPlaybackRecursionError(err) && token === trackSwitchToken && !opts.manual && playQueue.length > 1) {
      skipFailedQueueItem(idx, token, '当前歌曲加载失败，正在尝试队列里的下一首。');
      return;
    }
    showToast(playbackFailureToastText(err));
  }
  } catch (setupErr) {
    console.error('Play setup failed:', { phase: playPhase, error: setupErr }, setupErr);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!isPlaybackRecursionError(setupErr) && typeof token !== 'undefined' && token === trackSwitchToken && !opts.manual && playQueue.length > 1) {
      skipFailedQueueItem(idx, token, '当前歌曲切换失败，正在尝试队列里的下一首。');
      return;
    }
    showToast(playbackFailureToastText(setupErr));
  }
}
async function attemptAudioPlay(opts) {
  opts = opts || {};
  try {
      if (!audio) return false;
      if (!opts.resumeRecovery && typeof maybeRecoverPlaybackAfterLongPause === 'function') {
        var longPauseRecovered = await maybeRecoverPlaybackAfterLongPause({ silent: !!opts.silent });
        if (longPauseRecovered === true) return true;
        if (longPauseRecovered === false && opts.manual) {
          // 长暂停恢复失败时继续走普通 play，避免按钮无响应
        }
      }
      if (!audioReady) initAudio();
      if (opts.fade !== false) preparePlaybackFadeIn();
      if (opts.manual) {
        var manualPlay = audio.play();
        await resumeAudioAnalysis();
        await manualPlay;
      } else {
        await resumeAudioAnalysis();
        await audio.play();
      }
      await resumeAudioAnalysis();
      switchPlaybackVisualToEmily();
      playing = true; setPlayIcon(true);
    if (opts.fade !== false) startPlaybackFadeIn();
    else restorePlaybackGain();
    scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 4200);
    if (typeof schedulePlaybackStallRecovery === 'function' && !opts.holdPaused) {
      schedulePlaybackStallRecovery(opts.resumeRecovery ? 'resume-recovery-started' : 'playback-started', {
        silent: true,
        trackSwitch: !opts.manual,
        resumeRecovery: !!opts.resumeRecovery,
        ownerMedia: audio,
        ownerToken: trackSwitchToken
      });
    }
    forcePlaybackControlsInteractive();
    hideLoading();
    return true;
  } catch (err) {
    console.warn('Audio play blocked:', err && (err.message || err));
    restorePlaybackGain();
    playing = false; setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!opts.silent) showToast(opts.manual ? '播放启动失败, 请重新选择歌曲' : '播放被系统拦截, 请点击播放按钮');
    return false;
  }
}
async function playAudio(opts) {
  opts = opts || {};
  return attemptAudioPlay({ manual: false, silent: !!opts.silent });
}
async function togglePlay() {
  if (playToggleBusy) return;
  playToggleBusy = true;
  try {
    forcePlaybackControlsInteractive();
    if ((!audio || !audio.src) && playQueue.length && currentIdx >= 0) {
      await playQueueAt(currentIdx, { manual: true });
      return;
    }
    if (!audio) return;
    if (audio.paused || audio.ended) {
      await attemptAudioPlay({ manual: true });
    } else {
      await fadeOutAndPauseAudio();
      playing = false;
      setPlayIcon(false);
      hideLoading();
      safePlaybackStep('listen-stats-pause', function(){ updateListenStatsTick(true); });
      forcePlaybackControlsInteractive();
      safePlaybackStep('sync-pause-state', function(){ syncPlaybackStateFromAudioEvent('manual-pause'); });
      safePlaybackStep('pause-controls-hide', function(){ scheduleControlsHide(520); });
      savePlaybackSession(true);
    }
  } catch (err) {
    console.warn('[TogglePlay]', err);
    playing = !!(audio && !audio.paused);
    setPlayIcon(playing);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!audio || !audio.src) showToast('播放控制失败');
  } finally {
    playToggleBusy = false;
  }
}
function setPlayIcon(p) {
  // morphicons 弹簧 morph：play 三角 ↔ pause 双竖线（库缺失时回退 stroke path 直切）
  var mc = window.MorphiconCtl;
  if (mc && mc.set('play', p ? 'pause' : 'play')) return;
  var icon = document.getElementById('play-icon');
  if (icon) icon.innerHTML = p
    ? '<path d="M8 5v14M16 5v14"/>'
    : '<path d="M8 5 19 12 8 19Z"/>';
}
function nextTrack() {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  if (playMode === 'shuffle') currentIdx = Math.floor(Math.random() * playQueue.length);
  else currentIdx = (currentIdx + 1) % playQueue.length;
  Promise.resolve(playQueueAt(currentIdx, { context: scenePlaybackContextForTrackSwitch(), preserveHomeState: true })).finally(forcePlaybackControlsInteractive);
}
function prevTrack() {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  currentIdx = (currentIdx - 1 + playQueue.length) % playQueue.length;
  Promise.resolve(playQueueAt(currentIdx, { context: scenePlaybackContextForTrackSwitch(), preserveHomeState: true })).finally(forcePlaybackControlsInteractive);
}
function shuffleQueue() {
  for (var i = playQueue.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = playQueue[i]; playQueue[i] = playQueue[j]; playQueue[j] = tmp;
  }
  currentIdx = 0; safeRenderQueuePanel('shuffle-queue');
  showToast('队列已随机');
  safeShelfRebuild('shuffle-queue');
}
function clearQueue() {
  exitSceneRadioIfNeeded('clear-queue');
  activeRadioContext = null;
  playQueue = []; currentIdx = -1;
  safeRenderQueuePanel('clear-queue');
  safeShelfRebuild('clear-queue');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}
function removeFromQueue(idx) {
  if (idx < 0 || idx >= playQueue.length) return;
  playQueue.splice(idx, 1);
  if (currentIdx >= playQueue.length) currentIdx = playQueue.length - 1;
  safeRenderQueuePanel('remove-queue-item');
  safeShelfRebuild('remove-queue-item');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}
function playModeLabel(mode) {
  return { loop: '顺序循环', shuffle: '随机播放', single: '单曲循环' }[mode] || '顺序循环';
}

function playModeIconMarkup(mode) {
  if (mode === 'shuffle') {
    return '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>';
  }
  if (mode === 'single') {
    return '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M12 9v6"/><path d="M10.5 10.5 12 9l1.5 1.5"/>';
  }
  return '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
}

function updatePlayModeButton(animate) {
  var label = playModeLabel(playMode);
  var chip = document.getElementById('play-mode-chip');
  var btn = document.getElementById('play-mode-btn');
  var icon = document.getElementById('play-mode-icon');
  if (chip) chip.textContent = label;
  if (btn) {
    btn.dataset.mode = playMode;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('active', playMode !== 'loop');
  }
  if (icon) {
    // morphicons 弹簧 morph：loop ↔ shuffle ↔ single（库缺失时回退 stroke path 直切）
    var mc = window.MorphiconCtl;
    var modeIcon = playMode === 'shuffle' ? 'modeShuffle' : playMode === 'single' ? 'modeSingle' : 'modeLoop';
    if (!(mc && mc.set('mode', modeIcon))) icon.innerHTML = playModeIconMarkup(playMode);
  }
  if (!animate || !btn) return;
  var M = window.MineradioMotion;
  if (M) {
    // 真 spring + 可中断：连点平滑改向，取代 kill+overwrite 杀死重开
    // btn 的 scale/rotate 交由弹簧托管，settle 后自动清除内联 transform，CSS hover/active 复位
    M.tapPop(btn, 'scale', { dip: 0.14, preset: M.SPRING.bouncy });
    M.springTo(btn, 'rotate', 0, { from: -8, preset: M.SPRING.snappy });
    // 点按光晕：非交互修饰，boxShadow 与 transform 不互踩，保留 GSAP
    if (window.gsap) {
      window.gsap.fromTo(btn,
        { boxShadow: '0 0 0 0 rgba(255,63,85,.36)' },
        { boxShadow: '0 0 0 14px rgba(255,63,85,0)', duration: 0.58, ease: 'sine.out', overwrite: false, onComplete: function(){ window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
      );
    }
    if (icon) {
      M.springTo(icon, 'scale', 1, { from: 0.74, preset: M.SPRING.bouncy });
      M.springTo(icon, 'rotate', 0, { from: -22, preset: M.SPRING.snappy });
      M.springTo(icon, 'y', 0, { from: 4, preset: M.SPRING.snappy });
      M.springTo(icon, 'opacity', 1, { from: 0.32, preset: M.SPRING.snappy });
    }
  } else if (window.gsap) {
    window.gsap.killTweensOf(btn);
    if (icon) window.gsap.killTweensOf(icon);
    window.gsap.timeline({ defaults: { overwrite: true } })
      .fromTo(btn, { scale: 0.86, rotate: -8 }, { scale: 1.12, rotate: 4, duration: 0.16, ease: 'power2.out' })
      .to(btn, { scale: 1, rotate: 0, duration: 0.34, ease: 'back.out(2.1)' });
    window.gsap.fromTo(btn,
      { boxShadow: '0 0 0 0 rgba(255,63,85,.36)' },
      { boxShadow: '0 0 0 14px rgba(255,63,85,0)', duration: 0.58, ease: 'sine.out', overwrite: false, onComplete: function(){ window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
    );
    if (icon) window.gsap.fromTo(icon, { y: 4, autoAlpha: 0.32, rotate: -22, scale: 0.74 }, { y: 0, autoAlpha: 1, rotate: 0, scale: 1, duration: 0.42, ease: 'expo.out', overwrite: true });
  } else {
    btn.classList.remove('mode-switching');
    void btn.offsetWidth;
    btn.classList.add('mode-switching');
    setTimeout(function(){ btn.classList.remove('mode-switching'); }, 460);
  }
}

function cyclePlayMode() {
  var modes = ['loop', 'shuffle', 'single'];
  var idx = modes.indexOf(playMode);
  playMode = modes[(idx + 1) % modes.length];
  updatePlayModeButton(true);
  showToast('播放模式: ' + playModeLabel(playMode));
}
updatePlayModeButton(false);

// QQ playback request deadline (aligned with server VKEY+probe budgets)
var QQ_PLAYBACK_URL_TIMEOUT_MS = 15000;
var QQ_PLAYBACK_GAPLESS_TIMEOUT_MS = 15000;
function qqPlaybackUrlRequestOptions(){ return { timeoutMs: 15000 }; }
function qqGaplessUrlRequestOptions(){ return { timeoutMs: 15000 }; }
