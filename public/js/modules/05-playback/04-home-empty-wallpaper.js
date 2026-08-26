// =============================================================================
// 空首页 / 壁纸预览 / showHome hideHome
// =============================================================================

function shouldShowEmptyHomeCore(ignoreSplash) {
  if (!ignoreSplash && document.body.classList.contains('splash-active')) return false;
  if (immersiveMode) return false;
  if (homeForcedOpen) return true;
  if (homeSuppressed) return false;
  if (shelfPinnedOpen) return false;
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
  if (playQueue && playQueue.length) return false;
  if (currentIdx >= 0 && playQueue[currentIdx]) return false;
  if (playing) return false;
  return true;
}
function shouldShowEmptyHome() {
  return shouldShowEmptyHomeCore(false);
}
function shouldShowEmptyHomeAfterSplash() {
  return shouldShowEmptyHomeCore(true);
}
function shouldForceEmptyHomeAfterSplash() {
  if (immersiveMode) return false;
  if (shelfPinnedOpen) return false;
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
  if (playQueue && playQueue.length) return false;
  if (currentIdx >= 0 && playQueue[currentIdx]) return false;
  if (playing) return false;
  return true;
}
function shouldUseIdleWallpaperPreview(ignoreSplash) {
  if (!ignoreSplash && document.body.classList.contains('splash-active')) return false;
  if (immersiveMode || playing || (audio && !audio.paused)) return false;
  if (shelfPinnedOpen) return false;
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
  return true;
}
function setHomeControlsLocked(locked) {
  document.body.classList.toggle('home-controls-locked', !!locked);
  var bottom = document.getElementById('bottom-bar');
  if (bottom && locked && !hasActivePlaybackControls()) bottom.classList.add('soft-hidden');
  if (bottom && !locked) bottom.classList.remove('soft-hidden');
  if (locked) closeMiniQueue();
  updateControlsChromeState();
}
function openHomePlayerConsole() {
  setHomeControlsLocked(false);
  var bar = document.getElementById('bottom-bar');
  if (bar) {
    bar.classList.add('visible');
    bar.classList.remove('soft-hidden');
    bar.style.pointerEvents = '';
  }
  wakeBottomHandle(2800);
  setControlsHidden(false);
  forcePlaybackControlsInteractive();
  updateControlsChromeState();
  if (controlsAutoHide) scheduleControlsHide(1800);
  showToast('播放器控制台已展开');
}
function ensureHomeWallpaperParticles(opts) {
  opts = opts || {};
  if (uniforms && uniforms.uAlpha && opts.instant) {
    uniforms.uAlpha.value = 0.96;
  } else if (uniforms && uniforms.uAlpha && uniforms.uAlpha.value < 0.88) {
    tweenParticleAlpha(uniforms.uAlpha.value || 0, 0.96, 920);
  }
  if (uniforms && uniforms.uFloatAlpha) uniforms.uFloatAlpha.value = 0;
  if (floatGroup) destroyFloatLayer();
}
function activateHomeWallpaperPreview(opts) {
  opts = opts || {};
  document.body.classList.add('home-wallpaper-preview');
  ensureHomeWallpaperParticles(Object.assign({ instant: true }, opts));
}
var homeWallpaperPrewarmStarted = false;
function prewarmHomeWallpaperPreview() {
  if (homeWallpaperPrewarmStarted) return;
  homeWallpaperPrewarmStarted = true;
  if (!shouldUseIdleWallpaperPreview(true)) return;
  scheduleVisualApply(function(){
    if (!shouldUseIdleWallpaperPreview(true)) return;
    activateHomeWallpaperPreview({ skipTransition: true, instant: true });
  }, 900, 2600);
}
function deactivateHomeWallpaperPreview(playback) {
  document.body.classList.remove('home-wallpaper-preview');
  if (!homeVisualPresetActive) return;
  homeVisualPresetActive = false;
  var nextPreset = typeof homeVisualPrevPreset === 'number' ? homeVisualPrevPreset : (fx && typeof fx.preset === 'number' ? fx.preset : 0);
  if (typeof setPreset === 'function' && fx.preset !== nextPreset) {
    setPreset(nextPreset, { silent: true, preserveCamera: false, skipTransition: false, noSave: true });
  }
}
function switchPlaybackVisualToEmily() {
  if (homeVisualPresetActive) {
    deactivateHomeWallpaperPreview(true);
    return;
  }
  document.body.classList.remove('home-wallpaper-preview');
  var targetPreset = typeof playbackVisualPreset === 'number' ? playbackVisualPreset : fxDefaults.preset;
  startupVisualPreviewActive = false;
  if (typeof setPreset === 'function' && fx.preset !== targetPreset) {
    setPreset(targetPreset, { silent: true, preserveCamera: false, noSave: true });
  } else if (typeof syncFxUniforms === 'function') {
    syncFxUniforms();
  }
}
function applyStartupStarfieldPreset() {
  if (playing || currentIdx >= 0) return;
  startupVisualPreviewActive = true;
  if (typeof setPreset === 'function' && fx.preset !== 5) {
    setPreset(5, { silent: true, preserveCamera: false, skipTransition: true, noSave: true });
  } else if (typeof syncFxUniforms === 'function') {
    syncFxUniforms();
  }
}
function clearHomeUiState() {
  document.body.classList.remove('home-preset-enter');
  if (typeof stopHomeWeatherFx === 'function') stopHomeWeatherFx();
}
function hasActivePresetOverlay() {
  return isClassicPresetActive() || document.body.classList.contains('sonic-topography-active');
}
function snapshotPresetLayersForHome() {
  var sonic = document.getElementById('sonic-topography-frame');
  homePresetLayerSnapshot = {
    sonicTransition: sonic ? sonic.style.transition : '',
    sonicOpacity: sonic ? sonic.style.opacity : '',
    sonicVisibility: sonic ? sonic.style.visibility : '',
    sonicTransform: sonic ? sonic.style.transform : ''
  };
}
function hidePresetLayersForHome() {
  if (document.body.classList.contains('home-preset-enter')) return;
  snapshotPresetLayersForHome();
  document.body.classList.add('home-preset-enter');
  var sonic = document.getElementById('sonic-topography-frame');
  if (sonic) {
    sonic.style.transition = 'none';
    sonic.style.opacity = '0';
    sonic.style.visibility = 'hidden';
    sonic.style.transform = 'none';
  }
}
function restorePresetLayersAfterHome() {
  var snap = homePresetLayerSnapshot;
  homePresetLayerSnapshot = null;
  document.body.classList.remove('home-preset-enter');
  var sonic = document.getElementById('sonic-topography-frame');
  if (sonic && snap) {
    sonic.style.transition = snap.sonicTransition || '';
    sonic.style.opacity = snap.sonicOpacity || '';
    sonic.style.visibility = snap.sonicVisibility || '';
    sonic.style.transform = snap.sonicTransform || '';
  } else if (sonic) {
    sonic.style.transition = '';
    sonic.style.opacity = '';
    sonic.style.visibility = '';
    sonic.style.transform = '';
  }
}
function ensurePresetLayersHiddenForHome() {
  if (hasActivePresetOverlay()) hidePresetLayersForHome();
}
function primeHomeDiscoverState(forceLoad) {
  if (!hasAnyPlatformLogin()) {
    homeDiscoverState.loading = false;
    homeDiscoverState.loaded = true;
    homeDiscoverState.loggedIn = false;
    homeDiscoverState.mode = 'starter';
    homeDiscoverState.songs = [];
    homeDiscoverState.playlists = [];
    homeDiscoverState.podcasts = [];
    return;
  }
  if (!homeDiscoverState.loaded) hydrateHomeDiscoverFromCache();
  if (forceLoad && homeDiscoverState.loaded) homeDiscoverState.stale = true;
}
function scheduleHomeDeferredRefresh(forceLoad, fromPreset) {
  if (!homeWeatherRadioState.loaded) hydrateHomeWeatherFromCache();
  var weatherDelay = fromPreset ? 900 : 0;
  var weatherStaleMs = 45 * 60 * 1000;
  var weatherStale = !homeWeatherRadioState.updatedAt || (Date.now() - homeWeatherRadioState.updatedAt > weatherStaleMs);
  if (!homeWeatherRadioState.loaded || weatherStale || forceLoad) {
    if (!maybeAutoLocateWeatherCity()) scheduleHomeWeatherLoad(weatherDelay);
  }
  if (!hasAnyPlatformLogin()) return;
  if (homeDiscoverState.loading) return;
  var discoverDelay = fromPreset ? 1600 : 0;
  scheduleVisualApply(function(){
    if (homeDiscoverState.loading) return;
    if (forceLoad || !homeDiscoverState.loaded || homeDiscoverState.stale) loadHomeDiscover(!!forceLoad);
  }, discoverDelay, discoverDelay + 400);
}
function closePanelsForHomeEntry() {
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) safeShelfCloseContent('open-empty-home');
  if (typeof setShelfPinnedOpen === 'function') setShelfPinnedOpen(false, true);
  togglePlaylistPanel(false);
  setPeek(document.getElementById('playlist-panel'), false, 'pl');
  setPeek(document.getElementById('fx-panel'), false, 'fx');
  setPeek(document.getElementById('search-area'), true, 'search');
  if (typeof setFocusZone === 'function') setFocusZone(null, true);
  if (orbit && orbit.focus) orbit.focus.active = false;
}
function showHome(opts) {
  opts = opts || {};
  var alreadyVisible = emptyHomeActive && document.body.classList.contains('empty-home-active');
  if (opts.forced) {
    homeForcedOpen = true;
    homeSuppressed = false;
  }
  if (alreadyVisible && !opts.forceLoad && !opts.closePanels) {
    ensurePresetLayersHiddenForHome();
    setHomeControlsLocked(!!homeForcedOpen);
    if (homeDiscoverState.loaded || homeWeatherRadioState.loaded) {
      renderHomeDiscover();
      refreshContinueCardLive();
    }
    return true;
  }
  ensurePresetLayersHiddenForHome();
  if (opts.closePanels) closePanelsForHomeEntry();
  else setPeek(document.getElementById('search-area'), true, 'search');
  activateHomeWallpaperPreview({ instant: true });
  setHomeControlsLocked(!!homeForcedOpen);
  emptyHomeActive = true;
  var shell = document.getElementById('empty-home');
  if (shell) void shell.offsetHeight;
  document.body.classList.add('empty-home-active');
  primeHomeDiscoverState(!!opts.forceLoad);
  if (!homeWeatherRadioState.loaded) hydrateHomeWeatherFromCache();
  renderHomeDiscover();
  if (typeof initHomeHeroAndGrid === 'function') initHomeHeroAndGrid();
  refreshContinueCardLive();
  bootstrapScenePresets(false);
  scheduleHomeDeferredRefresh(!!opts.forceLoad, !!opts.closePanels);
  if (!opts.forced) maybeOfferSceneResume();
  return true;
}
function hideHome(opts) {
  opts = opts || {};
  if (opts.suppress) homeSuppressed = true;
  homeForcedOpen = false;
  deactivateHomeWallpaperPreview(false);
  restorePresetLayersAfterHome();
  clearHomeUiState();
  emptyHomeActive = false;
  document.body.classList.remove('empty-home-active');
  if (!opts.keepControlsLocked) setHomeControlsLocked(false);
  return false;
}
function prepareLeaveHomeForPlayback(opts) {
  opts = opts || {};
  homeForcedOpen = false;
  if (opts.unsuppress !== false) homeSuppressed = false;
  setHomeControlsLocked(false);
}
function updateEmptyHomeVisibility(opts) {
  opts = opts || {};
  if (shouldShowEmptyHome()) {
    return showHome({ forceLoad: !!opts.forceLoad, closePanels: false });
  }
  return hideHome({ suppress: homeSuppressed });
}
