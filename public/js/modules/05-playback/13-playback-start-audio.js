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
/* audio.play() 被自动播放策略拒绝（NotAllowedError）——区别于「源加载失败」。
 * 桌面端 main.js 有 autoplay-policy=no-user-gesture-required，但窗口失活 /
 * 后台还原等场景 Chromium 仍可能拒（表现为「有概率被系统拦截」）。
 * 这类错误一次用户手势即可恢复，所以单列出来挂手势代理。 */
function playbackBlockedByAutoplayPolicy(err) {
  if (!err) return false;
  if (err.name === 'NotAllowedError') return true;
  return /autoplay|not allowed|user gesture|user interaction|play\(\) failed because/i.test(String(err.message || ''));
}
/* 一次性手势代理：拦截后挂到 document capture 上，用户接下来的任意点击 / 按键 /
 * 触摸都当作激活，自动以 manual 重试——不必精确点到播放按钮（旧提示这么写，
 * 用户多点几次别处就以为坏了）。30 秒没等到手势自动撤，避免野监听堆积。 */
var playbackGestureRetryArmed = false;
function armPlaybackGestureRetry() {
  if (playbackGestureRetryArmed) return;
  playbackGestureRetryArmed = true;
  var timer = 0;
  function disarm() {
    if (!playbackGestureRetryArmed) return;
    playbackGestureRetryArmed = false;
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('touchstart', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    if (timer) { clearTimeout(timer); timer = 0; }
  }
  function onGesture() {
    if (!playbackGestureRetryArmed) return;
    disarm();
    /* 手势内重试：manual 走手势路径，silent 不重复弹提示。
     * 与用户紧接着点播放按钮触发的 togglePlay 可能叠加——play() 幂等、
     * fade 有 serial 作废旧渐变，重复调用无副作用。 */
    attemptAudioPlay({ manual: true, silent: true, gestureRetry: true });
  }
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('touchstart', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  timer = setTimeout(disarm, 30000);
}
/* 播放归属闸门：任何 await 之后、任何会改全局 audio / 播放状态的副作用之前，
 * 都必须重新确认这次请求仍属于当前曲目。trackSwitchToken 在每次 playQueueAt
 * 开头自增，清空队列/停止播放也会自增，因此这一个判据同时作废：
 *   - 被换歌顶掉的旧取址 / 取代理 URL 请求（旧请求晚到会改写新曲目的 audio.src）
 *   - 清空队列后仍在途的请求（不能稍后重新起播）
 *   - 旧起播流程的后续副作用（歌词会话、节拍分析、兜底跳歌） */
function playbackSwitchRequestStillOwned(token) {
  return token === trackSwitchToken;
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

// ---- holdPaused 的「一次性暂停」约束 --------------------------------------
// holdPaused 的语义是「只加载音源、不出声」（删掉暂停中的曲目 / 自动换源时保持暂停）。
// 旧实现给 loadedmetadata 和 canplay 各挂一个 { once: true } 监听：谁先触发都只移除
// 自己，另一个会一直残留。用户随后点播放时 token 并没有变，归属校验看不出这是新的
// 用户意图，残留回调下一次 canplay 就又把播放 pause 掉（表现为点了没反应 / 播一下又停）。
// 这里收敛成一个显式约束：首次生效或用户明确播放即整体撤销，两条路径共用。
var holdPauseConstraint = { token: 0, media: null, handler: null, playHandler: null };
function releaseHoldPauseConstraint(reason) {
  var constraint = holdPauseConstraint;
  holdPauseConstraint = { token: 0, media: null, handler: null, playHandler: null };
  if (!constraint.media || !constraint.handler) return false;
  try {
    constraint.media.removeEventListener('loadedmetadata', constraint.handler);
    constraint.media.removeEventListener('canplay', constraint.handler);
    if (constraint.playHandler) constraint.media.removeEventListener('play', constraint.playHandler);
  } catch (e) {}
  return true;
}
function armHoldPauseConstraint(token, media) {
  releaseHoldPauseConstraint('re-arm');
  if (!media) return;
  var handler = function () {
    if (holdPauseConstraint.handler !== handler) return;
    // 先撤销：两个事件都要摘掉，不能让另一个残留到用户播放之后
    var stillOwned = token === trackSwitchToken && audio === media;
    releaseHoldPauseConstraint('applied');
    if (!stillOwned) return;
    try { media.pause(); } catch (e) {}
    playing = false;
    setPlayIcon(false);
    updatePlaybackProgressUi();
    savePlaybackSession(true);
  };
  var playHandler = function () {
    // 媒体已经真的开始播了（用户手势 / 恢复任务）：暂停约束到此作废
    if (holdPauseConstraint.handler !== handler) return;
    releaseHoldPauseConstraint('media-play');
  };
  holdPauseConstraint = { token: token, media: media, handler: handler, playHandler: playHandler };
  media.addEventListener('loadedmetadata', handler);
  media.addEventListener('canplay', handler);
  media.addEventListener('play', playHandler);
}

// ---- 本地曲库曲目播放（mineradio-local:// 媒体，不走 provider 取址）----
function applyLocalTrackLyricOnDemand(song, token) {
  if (song && song.lyric) {
    applyLyricApiResponse({ lyric: song.lyric, lrc: song.lyric, yrc: '' }, token, song);
    return;
  }
  setOriginalLyricsState(withLyricFallback([]), false, 'fallback');
  applyPreferredLyricsForCurrent(true);
  if (
    !song
    || !song.hasLyric
    || !song.localFileId
    || !window.desktopWindow
    || typeof window.desktopWindow.readLocalMusicLyric !== 'function'
  ) return;
  window.desktopWindow.readLocalMusicLyric(song.localFileId).then(function (result) {
    if (
      token !== trackSwitchToken
      || !currentLocalSong
      || queueItemKey(currentLocalSong) !== queueItemKey(song)
      || !result
      || result.ok !== true
      || !result.lyric
    ) return;
    song.lyric = result.lyric;
    song.lyricSource = result.lyricSource || song.lyricSource || '';
    applyLyricApiResponse({ lyric: result.lyric, lrc: result.lyric, yrc: '' }, token, song);
  }).catch(function () { });
}
async function playLocalQueueSong(song, idx, token, firstVisualPlay, opts) {
  opts = opts || {};
  if (!song || !song.localUrl) {
    showToast('本地文件已失效，请重新导入后继续');
    forcePlaybackControlsInteractive();
    return false;
  }
  currentLocalSong = song;
  playQueue[idx] = song;
  updateCustomCoverButton();
  document.getElementById('trial-banner').classList.remove('show');
  if (!audio) { audio = new Audio(); audio.crossOrigin = 'anonymous'; }
  else {
    audioFadeSerial++;
    clearAudioFadeTimers();
    audio.pause();
  }
  bindPlaybackProgressEvents(audio);
  applyVolumeToAudio();
  audio.src = song.localUrl;
  audio.__mineradioQueueItemKey = queueItemKey(song);
  audio.__mineradioTrackSwitchToken = token;
  updatePlaybackProgressUi();
  lyricSunEnergy = 0; lyricSunTarget = 0; lyricSunHold = 0; lyricSunAvg = 0; lyricSunPeak = 0.55;
  audio.onended = function () {
    if (token !== trackSwitchToken) return;
    finalizeListenSession(true);
    noteCuefieldAutoMixOutgoingEnded(audio, token, currentIdx);
    if (sleepTimer.pendingStop) {
      executeSleepTimerStop();
      return;
    }
    if (playMode === 'single') setTimeout(function () { playQueueAt(currentIdx, { autoRepeat: true, preserveHomeState: true }); }, 0);
    else setTimeout(nextTrack, 0);
  };
  audio.onloadedmetadata = function () {
    if (token !== trackSwitchToken || !currentLocalSong || currentLocalSong.localKey !== song.localKey) return;
    var duration = audio && isFinite(audio.duration) ? audio.duration : 0;
    currentLocalSong.duration = duration;
    // 元数据是异步回来的：期间用户可能删掉前面的队列项或随机重排，
    // 捕获的 idx 会指向别的歌（把 C 的时长也改成 B 的）。按身份重新定位再写回；
    // 目标已不在队列里就只更新当前曲目，绝不动其他项。
    var durationIdx = typeof queueIndexForItem === 'function' ? queueIndexForItem(song) : playQueue.indexOf(song);
    if (durationIdx >= 0 && playQueue[durationIdx]) playQueue[durationIdx].duration = duration;
    if (lyricSourceMode === 'custom') applyCustomLyricState(currentLocalSong, true);
    safeRenderQueuePanel('local-metadata', { scrollCurrent: miniQueueOpen });
  };
  scheduleAudioResumePosition(audio, opts.resumeAt, token);
  audio.load();
  if (opts.holdPaused && audio) armHoldPauseConstraint(token, audio);
  currentBeatMap = null;
  beatMapNextIdx = 0;
  resetAudioVisualState();
  resetBeatCameraSync(0);
  cancelBeatAnalysisTimer();
  cancelDjBeatAnalysisTimer();
  beatMapToken++;
  djBeatMapToken++;
  resetDjBeatMapState();
  setDjModeActive(false);
  var playbackStarted;
  if (opts.holdPaused) {
    playbackStarted = true;
    playing = false;
    setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
  } else {
    playbackStarted = await playAudio({ manual: !!opts.manual, silent: !!opts.startupAutoplay || !opts.manual });
  }
  // 起播本身也是 await 边界：切歌/清空发生在起播等待期间时，别把旧曲目写进听歌会话与节拍分析
  if (!playbackSwitchRequestStillOwned(token)) return false;
  if (!playbackStarted) {
    forcePlaybackControlsInteractive();
    if (opts.startupAutoplay) return false;
    if (!opts.suppressPlayFailureNotice) {
      if (opts.manual) showToast('播放启动失败，请重新选择本地音乐');
      else showSourceFallbackNotice('本地音乐已载入', '点击播放器中间的播放按钮继续播放。');
    }
    return false;
  }
  forcePlaybackControlsInteractive();
  beginListenSession(song, activeRadioContext);
  applyLocalTrackLyricOnDemand(song, token);
  safeRenderQueuePanel('play-local-queue', { scrollCurrent: miniQueueOpen });
  scheduleShelfRebuild('play-local-queue', true);
  safePlaybackStep('snapshot-save', function(){ saveLastPlaybackSnapshot(true, 'local-track-switch'); });
  safePlaybackStep('lyric-offset-ui', function(){ if (typeof updateLyricTimingOffsetUi === 'function') updateLyricTimingOffsetUi(song); });
  setTimeout(function () {
    if (token === trackSwitchToken && currentLocalSong && currentLocalSong.localKey === song.localKey) {
      prepareLocalBeatAnalysis(currentLocalSong, song.localUrl);
    }
  }, firstVisualPlay ? 680 : 520);
  return true;
}

async function playQueueAt(idx, opts) {
  opts = opts || {};
  // 返回 boolean：false 表示换源事务已过期/应中止，勿把 true 写回 opts
  if (typeof beginSourceFallbackPlaybackInvocation === 'function' && !beginSourceFallbackPlaybackInvocation(opts)) return;
  if (idx < 0 || idx >= playQueue.length) return;
  /* 用户明确点选优先于排队中的「下一曲」（校验通过后才作废，
     这样「过期/越界的调用」不会白扔掉用户的点击）。 */
  claimPlaybackInvocationForExplicitPick(opts);
  // 切歌作废上一首遗留的 holdPaused 暂停约束（同一媒体元素会被复用）
  releaseHoldPauseConstraint('track-switch');
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
  // 四项调音能力：切歌重置响度会话，并优先套用本地文件的 ReplayGain tag；
  // 在线音源没有 tag 时，模块会在 playing 后自行做短窗 RMS 自适应。
  safePlaybackStep('audio-tuning-track', function () {
    if (typeof Mineradio !== 'undefined' && Mineradio.audioTuning && Mineradio.audioTuning.onTrackChanged) {
      Mineradio.audioTuning.onTrackChanged(song);
    }
  });
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

  // 封面重管线（图片解码 → canvas → buildEdgeAndDepth → 三张 three.js 纹理 → AI 深度）
  // 已从「取址前」后移到「取址成功之后」：歌取不到地址时完全不跑，
  // 否则 source-fallback 每递归一层就重跑一遍，主线程被反复打满、原生内存反复分配，
  // 实测会把渲染进程推向 OOM（kOomExceptionCode 0xE0000008）。
  var coverLoadPending = true;
  function runPendingCoverLoad() {
    if (!coverLoadPending) return;
    coverLoadPending = false;
    safePlaybackStep('cover-load', function(){
      var customCover = getCustomCoverForSong(song);
      var coverOpts = { trackToken: token, deferHeavy: true, delay: firstVisualPlay ? 420 : 900, timeout: firstVisualPlay ? 1600 : 2400 };
      if (customCover) applyCoverDataUrl(customCover, coverOpts);
      else loadCoverFromUrl(song.cover ? coverUrlWithSize(song.cover, 400) : '', coverOpts);
    });
  }
  function dropPendingCoverLoad(reason) {
    if (!coverLoadPending) return;
    coverLoadPending = false;
    // 让已排队/已启动的封面重工作全部失效，别在播放已经失败后还继续分配原生内存
    coverProcessToken++;
    if (window.__mineradioDebugLoading) console.log('[CoverLoad] dropped (' + reason + ')');
  }
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

  // 本地曲库曲目：blob / mineradio-local:// 直链，不走 provider 取址与媒体代理
  if (song && (song.type === 'local' || song.source === 'local' || song.localUrl)) {
    markPlayPhase('local-audio');
    // 封面（mineradio-local://cover/…）与在线路径同一套重管线，先起播再解码
    runPendingCoverLoad();
    var localStarted = await playLocalQueueSong(song, idx, token, firstVisualPlay, opts);
    if (localStarted !== true) dropPendingCoverLoad('local-failed');
    if (localStarted === true && opts.sourceFallbackRecovery && typeof completeSourceFallbackRecovery === 'function') {
      completeSourceFallbackRecovery(opts.sourceFallbackRecovery);
    }
    return localStarted === true;
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
      if (token !== trackSwitchToken) { dropPendingCoverLoad('token-expired-qq'); return; }
    }
    var qualityMeta = typeof resolveProviderRequestedQuality === 'function'
      ? resolveProviderRequestedQuality(song, opts)
      : null;
    var requestedQuality = qualityMeta ? qualityMeta.quality : normalizePlaybackQuality(opts.qualityOverride || playbackQuality);
    /* 独立「无缝衔接」：曲末已经解析过下一首地址时，把它作为本次取址的既有
       结果注入 opts，省掉 /api/song/url 这一段最慢的网络往返。这里只写 opts，
       不改任何既有分支；换源恢复、切音质、Cuefield 交接一律不复用。 */
    if (typeof consumeGaplessHandoffPreload === 'function' && !opts.preResolvedPlaybackData) {
      var gaplessPreload = consumeGaplessHandoffPreload(idx, song, opts);
      if (gaplessPreload && gaplessPreload.url) opts.preResolvedPlaybackData = gaplessPreload;
    }
    var data = typeof resolveProviderPlayUrlData === 'function'
      ? await resolveProviderPlayUrlData(song, opts)
      : await apiJson('/api/song/url?id=' + song.id + '&quality=' + encodeURIComponent(requestedQuality));
    if (token !== trackSwitchToken) { dropPendingCoverLoad('token-expired-resolve'); return; }
    if (
      typeof sourceFallbackRecoveryFromOptions === 'function'
      && sourceFallbackRecoveryFromOptions(opts)
      && typeof sourceFallbackRecoveryCanContinue === 'function'
      && !sourceFallbackRecoveryCanContinue(sourceFallbackRecoveryFromOptions(opts))
      && typeof settleExpiredSourceFallbackPlayback === 'function'
    ) {
      dropPendingCoverLoad('fallback-expired');
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
      // 取不到地址：封面重管线一律不启动，已排队的也作废
      dropPendingCoverLoad('no-url');
      /* 用户已经在连着点下一曲了：这一首本来就要被跨过去，
         不要再为它找替代源、更不要弹「不可播放」把界面钉在这种结论上。 */
      if (pendingTrackSwitch) return false;
      if (isQQPlayback && await retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality)) return;
      var fbNoUrl = await tryAutoPlaybackFallback(song, data, idx, token, opts);
      if (fbNoUrl != null) return fbNoUrl;
      if (!playbackSwitchRequestStillOwned(token)) {
        dropPendingCoverLoad('token-expired-unavailable');
        return false;
      }
      handlePlaybackUnavailable(song, data);
      return;
    }
    // 取址成功：这时才启动封面重管线
    runPendingCoverLoad();
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
    // 取代理 URL 是切歌路径上最后一个外部 await：旧请求若晚于新曲目返回，
    // 绝对不能把 audio.src 改回上一首（否则 currentIdx 指向 B、音频却是 A）。
    if (!playbackSwitchRequestStillOwned(token)) {
      dropPendingCoverLoad('token-expired-proxy');
      return false;
    }
    audio.src = proxyAudioUrl;
    audio.__mineradioQueueItemKey = queueItemKey(song);
    audio.__mineradioTrackSwitchToken = token;
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
    if (opts.holdPaused && audio) armHoldPauseConstraint(token, audio);
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
    // 起播等待期间可能已经被新的切歌 / 清空队列顶掉：立刻收手，
    // 不能再用旧曲目继续写听歌会话、节拍分析、封面与快照。
    if (!playbackSwitchRequestStillOwned(token)) return false;
    /* 已经又排了新的切歌：这一首是被跨过去的中间曲目。
       绝不能再走「换源重试 / 跳歌 / 清空音源」——那条路会把最后一次起播的现场拆掉，
       表现就是连点之后彻底没声音。直接把控制权交给排在后面的目标。 */
    if (pendingTrackSwitch) return false;
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
      } else if (song.type === 'local' || song.source === 'local' || song.localUrl) {
        // 本地歌词已由 playLocalQueueSong → applyLocalTrackLyricOnDemand 按需读取
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
    /* 有更新的切歌在排队：这一首已经作废，别为它找替代源、更别自动跳歌
       （自动跳歌会再起一次 playQueueAt，把用户点的那首挤掉）。 */
    if (pendingTrackSwitch) return false;
    if (!isPlaybackRecursionError(err) && token === trackSwitchToken) {
      try {
        var fbErr = await tryAutoPlaybackFallback(song, { url: null, reason: 'media_start_failed' }, idx, token, opts);
        if (fbErr != null) return fbErr;
      } catch (_) {}
    }
    if (!isPlaybackRecursionError(err) && token === trackSwitchToken && !opts.manual && !opts.userPick && playQueue.length > 1) {
      skipFailedQueueItem(idx, token, '当前歌曲加载失败，正在尝试队列里的下一首。');
      return;
    }
    showToast(playbackFailureToastText(err));
  }
  } catch (setupErr) {
    console.error('Play setup failed:', { phase: playPhase, error: setupErr }, setupErr);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (pendingTrackSwitch) return false;
    if (!isPlaybackRecursionError(setupErr) && typeof token !== 'undefined' && token === trackSwitchToken && !opts.manual && !opts.userPick && playQueue.length > 1) {
      skipFailedQueueItem(idx, token, '当前歌曲切换失败，正在尝试队列里的下一首。');
      return;
    }
    showToast(playbackFailureToastText(setupErr));
  }
}
/* 起播归属快照：attemptAudioPlay 内部有多个 await（长暂停恢复、音频分析恢复、
 * audio.play() 本身），期间用户可能切歌、清空队列，或用 holdPaused 加载并暂停了新媒体。
 * 旧流程若继续执行，会 play() 到新媒体的音源（放出来的是下一首），
 * 还会把新曲目的播放图标 / 增益 / 恢复任务 / 错误提示一起改坏。
 * 因此固定「媒体对象 + 曲目 token + 当前音源」三项，在每个异步边界后重新确认。 */
function captureAudioPlayOwnership() {
  return {
    media: audio || null,
    token: trackSwitchToken,
    src: audio && audio.src ? String(audio.src) : ''
  };
}
function audioPlayOwnershipStillCurrent(owner) {
  if (!owner || !owner.media || owner.media !== audio) return false;
  if (owner.token !== trackSwitchToken) return false;
  // 同一个媒体元素被换了音源（holdPaused 载入新曲目）也算过期
  if (owner.src && owner.media.src && String(owner.media.src) !== owner.src) return false;
  return true;
}
async function attemptAudioPlay(opts) {
  opts = opts || {};
  // 用户明确播放：先撤销 holdPaused 遗留的一次性暂停约束。
  // 这里曲目 token 没变，归属校验识别不出「新的用户意图」，必须显式撤销，
  // 否则残留的 canplay 回调会在这次播放之后再把音频 pause 掉。
  if (opts.manual) releaseHoldPauseConstraint('user-play');
  var owner = captureAudioPlayOwnership();
  try {
      if (!owner.media) return false;
      if (!opts.resumeRecovery && typeof maybeRecoverPlaybackAfterLongPause === 'function') {
        var longPauseRecovered = await maybeRecoverPlaybackAfterLongPause({ silent: !!opts.silent });
        if (longPauseRecovered === true) return true;
        if (longPauseRecovered === false && opts.manual) {
          // 长暂停恢复失败时继续走普通 play，避免按钮无响应
        }
      }
      if (!audioPlayOwnershipStillCurrent(owner)) return false;
      if (!audioReady) initAudio();
      if (opts.fade !== false) preparePlaybackFadeIn();
      if (opts.manual) {
        // 用户手势内先同步起播（此刻仍持有该媒体），随后再等分析恢复
        var manualPlay = owner.media.play();
        await resumeAudioAnalysis();
        if (!audioPlayOwnershipStillCurrent(owner)) {
          // 期间已换歌：把手势内的 play 结果收干净，避免未处理的 rejection
          Promise.resolve(manualPlay).catch(function () {});
          return false;
        }
        await manualPlay;
      } else {
        await resumeAudioAnalysis();
        // 关键闸门：调用 play 之前必须确认这次起播仍属于当前曲目，
        // 否则旧流程会把新媒体（下一首）直接放出来。
        if (!audioPlayOwnershipStillCurrent(owner)) return false;
        await owner.media.play();
      }
      await resumeAudioAnalysis();
      if (!audioPlayOwnershipStillCurrent(owner)) return false;
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
    // 过期流程的失败与新曲目无关：不还原增益、不写 playing/图标、不弹提示、不挂手势代理
    if (!audioPlayOwnershipStillCurrent(owner)) return false;
    console.warn('Audio play blocked:', err && (err.message || err));
    restorePlaybackGain();
    playing = false; setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!opts.silent) {
      showToast(opts.manual
        ? '播放启动失败, 请重新选择歌曲'
        : (playbackBlockedByAutoplayPolicy(err)
            ? '播放被系统拦截, 点击任意位置继续'
            : '播放启动失败, 请重新选择歌曲'));
    }
    /* 自动播放策略拦截：挂一次性手势代理，任意后续点击/按键自动重试。
     * manual 路径本身就在用户手势里（点的是播放按钮），再挂只会双重触发；
     * 非策略错误（源加载失败等）挂代理也没用，重试还是一样的错。 */
    if (!opts.manual && !opts.silent && playbackBlockedByAutoplayPolicy(err)) {
      armPlaybackGestureRetry();
    }
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
/* 连点下一曲 / 上一曲的合流闸。
 *
 * 旧实现的每次点击都直接起一次 playQueueAt：连点 6 下就是 6 个并行的取址请求，
 * 实测 /api/song/url 的耗时随点击次数线性恶化（103 → 190 → 225 → 791 → 1693 → 4196ms），
 * 最后的请求拿到地址时已经排到 4s 之后，起播失败后还会走「没有可用音源」分支把
 * audio.src 一起清掉 —— 用户看到的就是「快速点下一曲有概率播放失败、且停在没声音」。
 *
 * 现在的语义：
 *   - 点击只登记「最新目标」；在飞的那次换源立刻失去归属（token 前移），
 *     它走到下一个归属检查点就自行收手，不会把中间那首装载进去；
 *   - 同一时刻只有一次换源在跑，跑完再接着跑最后一个目标；
 *   - 中间那些被跨过的曲目完全不发请求，也不会闪一下。 */
var pendingTrackSwitch = null;
var trackSwitchDrain = null;
/* drain 的「代」。作废排队目标时会把句柄摘掉并让代往前走，
 * 这样老的 drain 退出时不会顺手把新一轮的句柄清掉（否则会并存两个 drain）。 */
var trackSwitchDrainGen = 0;
/* 内部发起的起播（合流闸 / 换源重试）带上这个标记。它们不是用户点选，
 * 不能把排队中的「下一曲」清掉。走 Object.assign({}, opts, ...) 的重试会天然继承它。 */
var INTERNAL_PLAYBACK_OPT = '__mineradioInternalPlayback';

function abandonPendingTrackSwitch() {
  if (!pendingTrackSwitch && !trackSwitchDrain) return false;
  pendingTrackSwitch = null;
  trackSwitchDrain = null;
  trackSwitchDrainGen++;
  return true;
}

/* 用户明确点选（队列面板 / 搜索 / 首页卡片 / 切音质）优先于排队中的「下一曲」：
 * 不作废的话，当前这一首起播完之后排队的那个目标会把用户点的那首顶掉
 * ——真机复现过「点了第 3 首，结果响了第 6 首」。 */
function claimPlaybackInvocationForExplicitPick(opts) {
  if (opts && opts[INTERNAL_PLAYBACK_OPT]) return false;
  return abandonPendingTrackSwitch();
}

function internalPlaybackOpts(opts) {
  opts = opts || {};
  opts[INTERNAL_PLAYBACK_OPT] = true;
  return opts;
}

function requestTrackSwitch(idx, opts, label) {
  idx = Number(idx);
  if (!isFinite(idx) || idx < 0 || idx >= playQueue.length) return Promise.resolve(false);
  pendingTrackSwitch = { idx: idx, opts: opts || {}, label: String(label || 'track-switch') };
  if (trackSwitchDrain) trackSwitchToken++;   // 作废在飞的那次（下一处归属检查会退场）
  else trackSwitchDrain = drainTrackSwitches();
  return trackSwitchDrain;
}
function drainTrackSwitches() {
  var gen = ++trackSwitchDrainGen;
  trackSwitchDrain = (async function () {
    var last = false;
    try {
      for (;;) {
        if (!pendingTrackSwitch) {
          /* 这里到 return 之间没有任何 await —— 与点击事件天然互斥。
             所以不存在「循环已退出、句柄还在」把最后一击丢掉的时间窗：
             早到的点击会被下面的 while 捡走，晚到的点击看到句柄已是 null 会自己起一轮。 */
          if (gen === trackSwitchDrainGen) trackSwitchDrain = null;
          return last;
        }
        var job = pendingTrackSwitch;
        pendingTrackSwitch = null;
        // 排队期间队列可能被清空 / 改短：目标已不存在就丢掉，绝不装错曲目
        if (!(job.idx >= 0) || job.idx >= playQueue.length) { last = false; continue; }
        last = await playQueueAt(job.idx, internalPlaybackOpts(job.opts));
      }
    } catch (error) {
      if (gen === trackSwitchDrainGen) trackSwitchDrain = null;
      console.warn('[TrackSwitchQueue] drain failed:', error && (error.message || error));
      return false;
    }
  })();
  return trackSwitchDrain;
}
function nextTrack() {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  var target = playMode === 'shuffle'
    ? Math.floor(Math.random() * playQueue.length)
    : (currentIdx + 1) % playQueue.length;
  currentIdx = target;
  Promise.resolve(requestTrackSwitch(target, {
    context: scenePlaybackContextForTrackSwitch(),
    preserveHomeState: true
  }, 'next-track')).finally(forcePlaybackControlsInteractive);
}
function prevTrack() {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  var target = (currentIdx - 1 + playQueue.length) % playQueue.length;
  currentIdx = target;
  Promise.resolve(requestTrackSwitch(target, {
    context: scenePlaybackContextForTrackSwitch(),
    preserveHomeState: true
  }, 'prev-track')).finally(forcePlaybackControlsInteractive);
}
/* 队列被清空 / 当前曲目被移除后，明确停止播放：
 *  - trackSwitchToken++ 作废所有在途请求（取址、取代理 URL、起播、恢复任务），
 *    之后旧请求即使返回也只能走过期分支，不能重新起播或重装 audio.src
 *  - 媒体元素卸源，避免任何残留回调把上一首装回去
 *  - 恢复看门狗 / 节拍分析 / 无缝预载 / cuefield 一起收回，别在空队列上继续跑 */
function releaseQueuePlaybackMedia(reason) {
  reason = reason || 'queue-reset';
  trackSwitchToken++;
  playToggleBusy = false;
  // 排队中的切歌目标一起作废：队列都空了 / 重置了，不能再把旧索引装回去
  abandonPendingTrackSwitch();
  if (typeof clearPlaybackResumeWatchdogs === 'function') clearPlaybackResumeWatchdogs();
  if (typeof setPlaybackBufferingState === 'function') setPlaybackBufferingState(false, reason);
  if (typeof clearAlbumGaplessPreload === 'function') clearAlbumGaplessPreload(reason);
  if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix(reason);
  // 在途的换源恢复事务一并作废：否则它的 deadline / 跳歌任务还会拿旧索引继续推进
  if (typeof cancelSourceFallbackRecovery === 'function') cancelSourceFallbackRecovery(reason);
  if (typeof playbackResumeRecovery !== 'undefined' && playbackResumeRecovery) {
    playbackResumeRecovery.serial = (Number(playbackResumeRecovery.serial) || 0) + 1;
    playbackResumeRecovery.pending = false;
  }
  cancelBeatAnalysisTimer();
  cancelBeatPrefetchTimer();
  if (typeof localBeatAnalysis !== 'undefined' && localBeatAnalysis && localBeatAnalysis.active && typeof cancelLocalBeatAnalysis === 'function') {
    cancelLocalBeatAnalysis();
  }
  beatMapToken++;
  beatMapNextIdx = 0;
  currentBeatMap = null;
  if (audio) {
    try {
      audioFadeSerial++;
      clearAudioFadeTimers();
      audio.onended = null;
      audio.onloadedmetadata = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.__mineradioQueueItemKey = '';
      audio.__mineradioTrackSwitchToken = 0;
      audio.load();
    } catch (e) {}
  }
  playing = false;
  setPlayIcon(false);
  hideLoading();
  forcePlaybackControlsInteractive();
  safePlaybackStep('queue-reset-state-sync', function(){ syncPlaybackStateFromAudioEvent(reason); });
  safePlaybackStep('queue-reset-progress', updatePlaybackProgressUi);
}
function shuffleQueue() {
  // 重排只换顺序，正在播放的曲目必须原地保持身份：先记住它，重排后再按新位置回填索引。
  // 旧实现直接 currentIdx = 0，只要当前曲目不在首位，索引就和实际音频错位。
  var currentSong = currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  for (var i = playQueue.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = playQueue[i]; playQueue[i] = playQueue[j]; playQueue[j] = tmp;
  }
  if (!playQueue.length) {
    currentIdx = -1;
  } else if (currentSong) {
    var relocated = playQueue.indexOf(currentSong);
    currentIdx = relocated >= 0 ? relocated : Math.min(Math.max(currentIdx, 0), playQueue.length - 1);
  } else {
    // 队列还没有「当前曲目」（如未起播）：沿用旧行为落在第 0 首，保证播放按钮可用
    currentIdx = Math.min(Math.max(currentIdx, 0), playQueue.length - 1);
  }
  safeRenderQueuePanel('shuffle-queue', { scrollCurrent: miniQueueOpen });
  showToast('队列已随机');
  safeShelfRebuild('shuffle-queue');
}
function clearQueue() {
  exitSceneRadioIfNeeded('clear-queue');
  activeRadioContext = null;
  playQueue = []; currentIdx = -1;
  // 清空必须同时作废在途播放请求：否则取址 / 取代理 URL 完成后的旧请求
  // 会把 audio.src 装回去并调用播放，队列已空却仍在响。
  releaseQueuePlaybackMedia('clear-queue');
  safeRenderQueuePanel('clear-queue');
  safeShelfRebuild('clear-queue');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}
function removeFromQueue(idx) {
  if (idx < 0 || idx >= playQueue.length) return;
  var removingCurrent = idx === currentIdx;
  // 删除当前项时按原状态接续：本来暂停就只换源不出声
  var resumePaused = !(audio && audio.src && !audio.paused);
  playQueue.splice(idx, 1);
  if (!playQueue.length) {
    // 删掉最后一首：明确停止，不留「队列空 + 音频还在响」的半状态
    currentIdx = -1;
    releaseQueuePlaybackMedia('remove-last-queue-item');
    safeRenderQueuePanel('remove-queue-item');
    safeShelfRebuild('remove-queue-item');
    updateCustomCoverButton();
    updateCustomLyricControls();
    updateEmptyHomeVisibility({ forceLoad: false });
    return;
  }
  if (idx < currentIdx) {
    // 删的是当前曲目之前的项：正在播放的曲目身份不变，索引左移一位即可
    currentIdx -= 1;
  } else if (removingCurrent) {
    // 删的是当前曲目：明确切到顶替它位置的那首（末尾则回退到新的最后一首）
    var nextIdx = Math.min(idx, playQueue.length - 1);
    currentIdx = nextIdx;
    Promise.resolve(playQueueAt(nextIdx, {
      preserveHomeState: true,
      context: scenePlaybackContextForTrackSwitch(),
      holdPaused: resumePaused
    })).finally(forcePlaybackControlsInteractive);
  }
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
