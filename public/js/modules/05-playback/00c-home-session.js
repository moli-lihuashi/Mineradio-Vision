function serializeSongForSession(song) {
  if (!song) return null;
  return cloneSong({
    id: song.id,
    mid: song.mid,
    songmid: song.songmid,
    name: song.name,
    title: song.title,
    artist: song.artist,
    cover: song.cover,
    duration: song.duration,
    source: song.source,
    provider: song.provider,
    type: song.type,
    localKey: song.localKey,
    programId: song.programId,
    playable: song.playable,
    customCover: song.customCover,
    customCoverKey: song.customCoverKey,
    hash: song.hash || '',
    albumAudioId: song.albumAudioId || song.album_audio_id || ''
  });
}
function formatPlaybackResumeTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  var mins = Math.floor(seconds / 60);
  var secs = Math.floor(seconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
}
function homePlatformKey(song) {
  if (!song) return '';
  if (song.provider === 'qishui' || song.source === 'qishui' || song.type === 'qishui') return 'qishui';
  if (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash) return 'kugou';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq';
  if (song.type === 'local' || song.localKey) return 'local';
  if (song.type === 'podcast' || song.source === 'podcast' || song.programId) return 'podcast';
  return 'netease';
}
function homePlatformShortLabel(song) {
  var key = homePlatformKey(song);
  if (key === 'kugou') return '酷狗';
  if (key === 'qq') return 'QQ';
  if (key === 'qishui') return '汽水';
  if (key === 'local') return '本地';
  if (key === 'podcast') return '播客';
  return '网易';
}
function continueDurationSeconds(presentation) {
  if (!presentation) return 0;
  if (presentation.duration > 0) return presentation.duration;
  return normalizePlaybackDurationSeconds(presentation.song && presentation.song.duration || 0);
}
function continueProgressPercent(presentation) {
  if (!presentation) return 0;
  var dur = continueDurationSeconds(presentation);
  var cur = Number(presentation.currentTime) || 0;
  if (dur > 0 && cur > 0.5) return clampRange(Math.round(cur / dur * 100), 1, 99);
  return 0;
}
function getContinuePresentation() {
  var session = readPlaybackSession();
  if (session && session.song) {
    var song = session.song;
    return {
      source: 'session',
      song: song,
      title: song.name || song.title || '继续听',
      artist: song.artist || '',
      cover: song.cover || '',
      platform: homePlatformKey(song),
      currentTime: Number(session.currentTime) || 0,
      duration: normalizePlaybackDurationSeconds(session.duration || song.duration || 0),
      queueLength: session.queue && session.queue.length || 1,
      record: null
    };
  }
  var recent = (listenStatsState.history || [])[0] || null;
  if (!recent) return null;
  var histSong = songFromListenRecord(recent);
  return {
    source: 'history',
    song: histSong,
    title: recent.name || '继续听',
    artist: recent.artist || '',
    cover: recent.cover || '',
    platform: homePlatformKey(histSong),
    currentTime: 0,
    duration: normalizePlaybackDurationSeconds(recent.duration || 0),
    queueLength: 1,
    record: recent
  };
}
function formatContinueSub(presentation) {
  if (!presentation) return '最近播放会出现在这里';
  var bits = [];
  if (presentation.artist) bits.push(presentation.artist);
  if (presentation.platform) bits.push(homePlatformShortLabel(presentation.song));
  return bits.join(' · ') || '最近播放';
}
function formatContinueCardSub(presentation) {
  if (!presentation) return '最近播放会出现在这里';
  var bits = [];
  if (presentation.artist) bits.push(presentation.artist);
  if (presentation.queueLength > 1) bits.push('队列 ' + presentation.queueLength + ' 首待播');
  var pct = continueProgressPercent(presentation);
  if (presentation.source === 'session') {
    bits.push(pct > 0 ? ('点击从 ' + pct + '% 继续') : '点击恢复上次播放');
  } else if (pct > 0) {
    bits.push('续播 ' + pct + '%');
  }
  if (presentation.platform) bits.push(homePlatformShortLabel(presentation.song));
  return bits.join(' · ') || '点击恢复上次播放';
}
function continueResumeToastText(session) {
  if (!session || !session.song) return '已恢复上次播放';
  var pct = continueProgressPercent({
    currentTime: session.currentTime,
    duration: session.duration || (session.song && session.song.duration),
    song: session.song
  });
  var name = session.song.name || session.song.title || '歌曲';
  if (pct > 0) return '从 ' + pct + '% 继续播放《' + name + '》';
  if (session.currentTime > 0.5) return '从 ' + formatPlaybackResumeTime(session.currentTime) + ' 继续播放《' + name + '》';
  return '继续播放《' + name + '》';
}
function setContinuePlatformBadge(el, song) {
  if (!el) return;
  var key = homePlatformKey(song);
  if (key) {
    el.textContent = homePlatformShortLabel(song);
    el.setAttribute('data-platform', key);
    el.classList.add('is-visible');
  } else {
    el.textContent = '';
    el.removeAttribute('data-platform');
    el.classList.remove('is-visible');
  }
}
function updateContinueProgressBar(barId, fillId, percent, trackFillId) {
  var bar = document.getElementById(barId);
  var fill = document.getElementById(fillId);
  percent = clampRange(Number(percent) || 0, 0, 100);
  if (bar) bar.classList.toggle('is-visible', percent > 0);
  if (fill) fill.style.width = percent + '%';
  if (trackFillId) {
    var track = document.getElementById('home-continue-track');
    var trackFill = document.getElementById(trackFillId);
    if (track) track.classList.toggle('is-visible', percent > 0);
    if (trackFill) trackFill.style.width = percent + '%';
  }
}
function syncContinueCard(opts) {
  opts = opts || {};
  var presentation = getContinuePresentation();
  var title = document.getElementById('home-continue-title');
  var sub = document.getElementById('home-continue-sub');
  var label = document.getElementById('home-continue-label');
  if (!presentation) {
    setContinuePlatformBadge(document.getElementById('home-continue-platform'), null);
    updateContinueProgressBar('home-continue-progress', 'home-continue-progress-fill', 0, 'home-continue-track-fill');
    if (label) label.textContent = 'Continue';
    var cardEmpty = document.getElementById('home-continue-card');
    if (cardEmpty) cardEmpty.classList.remove('has-resume-session');
    return false;
  }
  if (title) title.textContent = presentation.title;
  if (sub) {
    if (opts.livePresentation) presentation = opts.livePresentation;
    sub.textContent = formatContinueCardSub(presentation);
  }
  var pct = opts.livePercent != null ? opts.livePercent : continueProgressPercent(presentation);
  if (label) label.textContent = pct > 0 ? ('Continue · 续播 ' + pct + '%') : 'Continue';
  var card = document.getElementById('home-continue-card');
  if (card) card.classList.toggle('has-resume-session', presentation.source === 'session' && pct > 0);
  setHomeArt('home-continue-art', presentation.cover || '', 280);
  setContinuePlatformBadge(document.getElementById('home-continue-platform'), presentation.song);
  updateContinueProgressBar('home-continue-progress', 'home-continue-progress-fill', pct, 'home-continue-track-fill');
  return presentation.source === 'session';
}
function syncContinueCardFromSession() {
  return syncContinueCard();
}
function refreshContinueCardLive() {
  continueUiSyncTimer = 0;
  var session = readPlaybackSession();
  if (!session || !session.song) {
    syncContinueCard();
    return;
  }
  var song = currentCoverSong();
  if (!song || queueItemKey(song) !== queueItemKey(session.song)) {
    syncContinueCard();
    return;
  }
  var dur = getPlaybackDurationSeconds();
  var cur = getPlaybackCurrentSeconds();
  var pct = dur > 0 && cur > 0.5 ? clampRange(Math.round(cur / dur * 100), 1, 99) : continueProgressPercent(getContinuePresentation());
  var live = Object.assign({}, getContinuePresentation() || {}, {
    source: 'session',
    song: session.song,
    title: session.song.name || session.song.title || '继续听',
    artist: session.song.artist || '',
    currentTime: cur,
    duration: dur,
    queueLength: session.queue && session.queue.length || 1,
    platform: homePlatformKey(session.song)
  });
  syncContinueCard({ livePercent: pct, livePresentation: live });
}
function refreshHomeDiscoverFromStale(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!homeDiscoverState.stale || homeDiscoverState.loading) return;
  loadHomeDiscover(true);
  showToast('正在刷新推荐');
}
function homeRailNoteText(hasSession, loggedOutHome, radioSongs) {
  if (hasSession) return 'Continue 卡恢复进度，这里浏览其他最近歌曲';
  if (homeDiscoverState.stale && !homeDiscoverState.loading) return '离线缓存 · 点击刷新推荐';
  if (homeDiscoverState.loading) return '正在整理推荐';
  if (loggedOutHome && !radioSongs.length) return '不会自动拉取外部推荐';
  if (homeDiscoverState.error) return '离线精选';
  return homeDiscoverState.updatedAt ? '刚刚更新 · 点击即可播放' : '点击即可播放';
}
function applyHomeRailNote(note, hasSession, loggedOutHome, radioSongs) {
  if (!note) return;
  note.textContent = homeRailNoteText(hasSession, loggedOutHome, radioSongs);
  var stale = homeDiscoverState.stale && !homeDiscoverState.loading && !hasSession;
  note.classList.toggle('home-rail-note-stale', stale);
  note.onclick = stale ? refreshHomeDiscoverFromStale : null;
}
var continueUiSyncTimer = 0;
function maybeSyncContinueProgressLive() {
  var now = Date.now();
  if (now - continueUiSyncTimer < 800) return;
  continueUiSyncTimer = now;
  var homePage = document.getElementById('empty-home');
  if (!homePage || !document.body.classList.contains('empty-home-active')) return;
  var session = readPlaybackSession();
  if (!session || !session.song) return;
  var song = currentCoverSong();
  if (!song || queueItemKey(song) !== queueItemKey(session.song)) return;
  var dur = getPlaybackDurationSeconds();
  var cur = getPlaybackCurrentSeconds();
  if (dur <= 0 || cur <= 0.5) return;
  var pct = clampRange(Math.round(cur / dur * 100), 1, 99);
  updateContinueProgressBar('home-continue-progress', 'home-continue-progress-fill', pct, 'home-continue-track-fill');
  var label = document.getElementById('home-continue-label');
  if (label) label.textContent = pct > 0 ? ('Continue · 续播 ' + pct + '%') : 'Continue';
  var sub = document.getElementById('home-continue-sub');
  if (sub) {
    var live = Object.assign({}, getContinuePresentation() || {}, {
      source: 'session',
      song: session.song,
      title: session.song.name || session.song.title || '继续听',
      artist: session.song.artist || '',
      currentTime: cur,
      duration: dur,
      queueLength: session.queue && session.queue.length || 1,
      platform: homePlatformKey(session.song)
    });
    sub.textContent = formatContinueCardSub(live);
  }
}
function hydrateHomeDiscoverFromCache() {
  if (!Mineradio.home || typeof Mineradio.home.readCache !== 'function') return false;
  var cached = Mineradio.home.readCache();
  if (!cached) return false;
  homeDiscoverState.loggedIn = !!cached.loggedIn;
  homeDiscoverState.mode = cached.mode || homeDiscoverState.mode;
  homeDiscoverState.songs = (cached.songs || []).map(cloneSong);
  homeDiscoverState.playlists = cached.playlists || [];
  homeDiscoverState.podcasts = cached.podcasts || [];
  homeDiscoverState.updatedAt = Number(cached.updatedAt) || 0;
  homeDiscoverState.loaded = true;
  homeDiscoverState.stale = true;
  homeDiscoverState.error = '';
  return true;
}
function persistHomeDiscoverCache() {
  if (!Mineradio.home || typeof Mineradio.home.writeCache !== 'function') return;
  Mineradio.home.writeCache({
    loggedIn: homeDiscoverState.loggedIn,
    mode: homeDiscoverState.mode,
    songs: homeDiscoverState.songs,
    playlists: homeDiscoverState.playlists,
    podcasts: homeDiscoverState.podcasts,
    updatedAt: homeDiscoverState.updatedAt || Date.now(),
  });
}
function hydrateHomeWeatherFromCache() {
  if (!Mineradio.home || typeof Mineradio.home.readWeatherCache !== 'function') return false;
  var cached = Mineradio.home.readWeatherCache();
  if (!cached) return false;
  homeWeatherRadioState.weather = cached.weather || null;
  homeWeatherRadioState.radio = cached.radio || null;
  homeWeatherRadioState.loaded = true;
  homeWeatherRadioState.updatedAt = Number(cached.updatedAt) || 0;
  homeWeatherRadioState.error = '';
  if (cached.city) homeWeatherRadioState.city = cached.city;
  return !!(homeWeatherRadioState.radio && homeWeatherRadioState.radio.songs && homeWeatherRadioState.radio.songs.length);
}
function persistHomeWeatherCache() {
  if (!Mineradio.home || typeof Mineradio.home.writeWeatherCache !== 'function') return;
  if (!homeWeatherRadioState.loaded || !(homeWeatherRadioState.radio && homeWeatherRadioState.radio.songs && homeWeatherRadioState.radio.songs.length)) return;
  Mineradio.home.writeWeatherCache({
    city: homeWeatherRadioState.city || '',
    weather: homeWeatherRadioState.weather || null,
    radio: homeWeatherRadioState.radio || null,
    updatedAt: homeWeatherRadioState.updatedAt || Date.now(),
  });
}
function initHomeSceneRow(force) {
  var row = document.getElementById('home-scene-row');
  if (!row || !Mineradio.scene) return;
  if (!force && row._sceneBound) {
    if (Mineradio.scene.updateScenePanelActive) Mineradio.scene.updateScenePanelActive(row);
    return;
  }
  Mineradio.scene.renderScenePanel(row, function(sceneId){ startSceneRadio(sceneId); });
  row._sceneBound = true;
}
function refreshHomeSceneRow(force) {
  initHomeSceneRow(!!force);
}
function snapshotScenePresentationIfNeeded() {
  if (scenePresentationSnapshot) return;
  scenePresentationSnapshot = {
    preset: typeof fx !== 'undefined' && fx ? fx.preset : 0,
    visualLink: Mineradio.moodAudio && Mineradio.moodAudio.getVisualLink ? Mineradio.moodAudio.getVisualLink() : true,
  };
}
function restoreScenePresentationIfNeeded() {
  if (!scenePresentationSnapshot) return;
  var snap = scenePresentationSnapshot;
  scenePresentationSnapshot = null;
  if (typeof setPreset === 'function' && typeof fx !== 'undefined' && fx && fx.preset !== snap.preset) {
    try { setPreset(snap.preset, { silent: true, preserveCamera: false, skipTransition: false, noSave: true }); } catch (_) {}
  }
  if (Mineradio.moodAudio && Mineradio.moodAudio.setVisualLink) {
    Mineradio.moodAudio.setVisualLink(snap.visualLink, { persist: true });
  }
  if (typeof updateMoodAudioUi === 'function') updateMoodAudioUi();
}
function isSceneRadioContext(ctx) {
  return !!(ctx && ctx.type === 'scene-radio');
}
function exitSceneRadioIfNeeded(reason) {
  if (!isSceneRadioActive()) return false;
  clearSceneRadioState();
  if (emptyHomeActive) renderHomeDiscover();
  return true;
}
function syncSceneRadioPlaybackContext(prevContext, nextContext) {
  if (isSceneRadioContext(prevContext) && !isSceneRadioContext(nextContext)) {
    clearSceneRadioState();
    return;
  }
  if (isSceneRadioContext(nextContext) && nextContext.sceneId) {
    if (Mineradio.scene && Mineradio.scene.setActiveSceneId) Mineradio.scene.setActiveSceneId(nextContext.sceneId);
    var row = document.getElementById('home-scene-row');
    if (row && Mineradio.scene && Mineradio.scene.updateScenePanelActive) Mineradio.scene.updateScenePanelActive(row);
  }
}
function scenePlaybackContextForTrackSwitch() {
  if (!isSceneRadioActive()) return null;
  var song = currentIdx >= 0 && playQueue && playQueue[currentIdx] ? playQueue[currentIdx] : null;
  if (song && song.radioContext && isSceneRadioContext(song.radioContext)) return song.radioContext;
  if (activeRadioContext && isSceneRadioContext(activeRadioContext)) return activeRadioContext;
  return null;
}
async function bootstrapScenePresets(force) {
  if (!Mineradio.scene || !Mineradio.scene.hydrateScenePresets) return false;
  if (scenePresetsBootstrapped && !force) return Mineradio.scene.arePresetsHydrated ? Mineradio.scene.arePresetsHydrated() : false;
  scenePresetsBootstrapped = true;
  var ok = await Mineradio.scene.hydrateScenePresets(apiJson);
  if (ok) {
    var row = document.getElementById('home-scene-row');
    if (Mineradio.scene.invalidateScenePanelCache && row) Mineradio.scene.invalidateScenePanelCache(row);
    refreshHomeSceneRow(true);
  }
  return ok;
}
function maybeOfferSceneResume() {
  if (isSceneRadioActive() || playing) return;
  if (!Mineradio.scene || !Mineradio.scene.readLastScene) return;
  var last = Mineradio.scene.readLastScene();
  if (!last || !last.id) return;
  try {
    var raw = JSON.parse(localStorage.getItem(SCENE_RESUME_HINT_KEY) || 'null');
    if (raw && raw.id === last.id && Date.now() - Number(raw.at || 0) < 86400000) return;
    localStorage.setItem(SCENE_RESUME_HINT_KEY, JSON.stringify({ id: last.id, at: Date.now() }));
  } catch (e) {}
  showToast('上次场景「' + (last.label || last.title || last.id) + '」· 点场景区可恢复');
}
function clearSceneRadioState() {
  homeSceneRadioState.loading = false;
  homeSceneRadioState.loaded = false;
  homeSceneRadioState.error = '';
  homeSceneRadioState.weather = null;
  homeSceneRadioState.radio = null;
  homeSceneRadioState.sceneId = '';
  homeSceneRadioState.updatedAt = 0;
  if (Mineradio.scene && Mineradio.scene.setActiveSceneId) Mineradio.scene.setActiveSceneId('');
  if (Mineradio.moodAudio && Mineradio.moodAudio.clearSceneBias) Mineradio.moodAudio.clearSceneBias();
  restoreScenePresentationIfNeeded();
  refreshHomeSceneRow(false);
}
function isSceneRadioActive() {
  if (homeSceneRadioState.loaded) return true;
  if (activeRadioContext && activeRadioContext.type === 'scene-radio') return true;
  if (playQueue && playQueue.some(function(song){ return song && song.radioContext && song.radioContext.type === 'scene-radio'; })) return true;
  return false;
}
function sceneRadioContext() {
  var weather = homeSceneRadioState.weather || {};
  var radio = homeSceneRadioState.radio || {};
  return {
    type: 'scene-radio',
    provider: 'scene',
    sceneId: homeSceneRadioState.sceneId || radio.sceneId || '',
    title: radio.title || '场景电台',
    subtitle: radio.subtitle || '',
    mood: weather.mood && weather.mood.key || '',
  };
}
function applyScenePresentation(sceneId, data) {
  var mood = data.weather && data.weather.mood;
  var radio = data.radio || {};
  var meta = Mineradio.scene && Mineradio.scene.getSceneMeta ? Mineradio.scene.getSceneMeta(sceneId) : null;
  if (meta && mood) {
    mood = Object.assign({}, meta, mood);
  } else if (meta && !mood) {
    mood = meta;
  }
  snapshotScenePresentationIfNeeded();
  Mineradio.scene.applySceneVisual(sceneId, mood, {
    onSceneVisual: function(id, m, sceneMeta) {
      sceneMeta = sceneMeta || meta;
      var preset = isFinite(Number(radio.visualPreset)) ? Number(radio.visualPreset) : (sceneMeta && sceneMeta.visualPreset);
      if (typeof preset === 'number' && typeof setPreset === 'function') {
        try { setPreset(preset, { silent: true, skipTransition: false, preserveCamera: false, noSave: true }); } catch (_) {}
      }
      if (uniforms && fx && m) {
        var energy = Number(m.energy);
        var focus = Number(m.focus);
        if (uniforms.uAlpha && isFinite(energy)) {
          uniforms.uAlpha.value = Math.max(0.72, Math.min(0.98, 0.74 + energy * 0.22));
        }
        if (fx.particleCount != null && isFinite(focus)) {
          var target = Math.round(900 + focus * 2600);
          if (typeof setFxParticleCount === 'function') setFxParticleCount(target, { silent: true });
          else fx.particleCount = target;
        }
      }
      if (Mineradio.moodAudio) {
        if (Mineradio.moodAudio.applySceneBias) Mineradio.moodAudio.applySceneBias(m || mood);
        var visualLink = typeof radio.moodVisualLink === 'boolean'
          ? radio.moodVisualLink
          : (sceneMeta ? sceneMeta.moodVisualLink !== false : true);
        if (Mineradio.moodAudio.setVisualLink) Mineradio.moodAudio.setVisualLink(visualLink, { persist: false });
        if (typeof updateMoodAudioUi === 'function') updateMoodAudioUi();
      }
    }
  });
}
async function playSceneRadio(opts) {
  opts = opts || {};
  var radio = homeSceneRadioState.radio;
  if (!radio || !radio.songs || !radio.songs.length) return;
  activeRadioContext = sceneRadioContext();
  playQueue = radio.songs.map(function(song){
    var cloned = cloneSong(song);
    cloned.radioContext = activeRadioContext;
    return cloned;
  });
  currentIdx = 0;
  prepareLeaveHomeForPlayback({ unsuppress: !opts.preserveHomeState });
  safeRenderQueuePanel('scene-radio-start');
  safeShelfRebuild('scene-radio-start', true);
  forcePlaybackControlsInteractive();
  try {
    await playQueueAt(0, { context: activeRadioContext });
  } catch (e) {
    console.warn('[SceneRadioStartPlay]', e);
    showToast('场景电台已载入，播放启动失败');
  }
  forcePlaybackControlsInteractive();
}
async function startSceneRadio(sceneId, opts) {
  opts = opts || {};
  if (!sceneId || homeRadioStartBusy) return;
  updateEmptyHomeVisibility();
  homeRadioStartBusy = true;
  homeSceneRadioState.loading = true;
  homeSceneRadioState.error = '';
  try {
    var data = await apiJson(Mineradio.scene.sceneApiUrl(sceneId));
    if (!data || !data.radio || !(data.radio.songs || []).length) throw new Error((data && data.error) || '场景电台暂无歌曲');
    homeSceneRadioState.loaded = true;
    homeSceneRadioState.loading = false;
    homeSceneRadioState.weather = data.weather || null;
    homeSceneRadioState.radio = data.radio;
    homeSceneRadioState.sceneId = sceneId;
    homeSceneRadioState.updatedAt = Date.now();
    if (Mineradio.scene.saveLastScene) Mineradio.scene.saveLastScene(sceneId);
    applyScenePresentation(sceneId, data);
    renderHomeDiscover();
    refreshHomeSceneRow();
    await playSceneRadio(opts);
    var meta = Mineradio.scene && Mineradio.scene.getSceneMeta ? Mineradio.scene.getSceneMeta(sceneId) : null;
    showToast((data.radio.title || meta && meta.title || '场景电台') + ' · ' + playQueue.length + ' 首');
  } catch (e) {
    console.warn('[SceneRadio]', e);
    homeSceneRadioState.error = 'SCENE_FAILED';
    showToast('场景电台启动失败');
  } finally {
    homeSceneRadioState.loading = false;
    homeRadioStartBusy = false;
  }
}
function readPlaybackSession() {
  try {
    var raw = JSON.parse(localStorage.getItem(PLAYBACK_SESSION_STORE_KEY) || 'null');
    if (!raw || !raw.song) return null;
    return raw;
  } catch (e) {
    return null;
  }
}
// 队列序列化缓存：内容指纹未变时复用上次结果，避免每 4.5s 全量序列化 120 首造成的写盘尖峰
var _playbackSessionQueueCache = { fingerprint: '', json: '' };
function playbackSessionQueueFingerprint() {
  var parts = [];
  var cap = Math.min(playQueue.length, 120);
  for (var i = 0; i < cap; i++) parts.push(queueItemKey(playQueue[i]));
  return parts.join('|');
}
function playbackSessionQueueJson() {
  var fp = playbackSessionQueueFingerprint();
  if (_playbackSessionQueueCache.fingerprint === fp && _playbackSessionQueueCache.json) {
    return _playbackSessionQueueCache.json;
  }
  _playbackSessionQueueCache.fingerprint = fp;
  _playbackSessionQueueCache.json = JSON.stringify(
    playQueue.slice(0, 120).map(serializeSongForSession).filter(Boolean)
  );
  return _playbackSessionQueueCache.json;
}
function savePlaybackSession(force) {
  if (!force) {
    var now = Date.now();
    if (now - playbackSessionSaveTimer < 4500) return;
    playbackSessionSaveTimer = now;
  }
  var song = currentIdx >= 0 && playQueue && playQueue[currentIdx] ? playQueue[currentIdx] : null;
  if (!song) return;
  var currentTime = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  if (currentTime < 0.2 && !force) return;
  try {
    var head = JSON.stringify({
      version: 2,
      song: serializeSongForSession(song),
      currentIdx: currentIdx,
      currentTime: currentTime,
      duration: getPlaybackDurationSeconds() || normalizePlaybackDurationSeconds(song.duration || 0),
      playMode: playMode,
      visualPreset: typeof fx !== 'undefined' && fx ? fx.preset : 0,
      updatedAt: Date.now()
    });
    localStorage.setItem(PLAYBACK_SESSION_STORE_KEY, head.slice(0, -1) + ',"queue":' + playbackSessionQueueJson() + '}');
  } catch (e) {}
}
async function applyPlaybackSession(session, opts) {
  opts = opts || {};
  if (!session || !session.song) return false;
  if (!opts.force && currentIdx >= 0 && playing) return false;
  var queue = Array.isArray(session.queue) && session.queue.length ? session.queue.map(cloneSong) : [cloneSong(session.song)];
  var idx = clampRange(Number(session.currentIdx) || 0, 0, queue.length - 1);
  playQueue = queue;
  currentIdx = idx;
  safeRenderQueuePanel('restore-session');
  try {
    await playQueueAt(idx, {
      silent: opts.silent !== false,
      manual: !!opts.manual,
      preserveHomeState: opts.preserveHomeState != null ? opts.preserveHomeState : true,
      resumeAt: Number(session.currentTime) || 0,
      holdPaused: opts.holdPaused != null ? opts.holdPaused : true
    });
    if (typeof session.visualPreset === 'number' && typeof setPreset === 'function') {
      try { setPreset(session.visualPreset, { skipTransition: true, preserveCamera: true }); } catch (_) {}
    }
    if (opts.toast !== false) showToast(continueResumeToastText(session));
    syncContinueCard();
    return true;
  } catch (e) {
    console.warn('[RestorePlaybackSession]', e);
    return false;
  }
}
async function restorePlaybackSessionIfAvailable() {
  if (playbackSessionRestoreAttempted) return false;
  playbackSessionRestoreAttempted = true;
  return applyPlaybackSession(readPlaybackSession(), { toast: true });
}
function maybeRestorePlaybackSessionAfterLogin() {
  restorePlaybackSessionIfAvailable();
}
function maybeRestorePlaybackSessionOnStartup() {
  if (readPlaybackSession()) syncContinueCardFromSession();
  // 启动自动播放偏好开启时，恢复上次播放的队列 / 当前曲 / 进度，并按需触发自动播放重试
  if (startupAutoplayPreference && typeof restoreLastPlaybackSnapshot === 'function') {
    restoreLastPlaybackSnapshot();
  }
}
