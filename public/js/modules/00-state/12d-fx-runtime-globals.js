var fxDefaults = {
  preset: 0,            // 0=emily cover, 1=tunnel, 2=orbit, 3=void, 4=vinyl, 5=wallpaper, 6=skull
  intensity: 0.85,
  particleCount: 1.0,
  cinemaShake: 0.5,
  depth: 1.0,
  coverResolution: 1.55,
  point: 1.0, speed: 1.0, twist: 0.0, color: 1.10, scatter: 0.0, bgFade: 0.20,
  bloomStrength: 0.62,
  lyricGlowStrength: 0.28,
  lyricScale: 1.0,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricColorMode: 'auto',
  lyricColor: '#a9b8c8',
  lyricHighlightMode: 'auto',
  lyricHighlightColor: '#fac900',
  lyricGlowLinked: true,
  lyricGlowColor: '#008aff',
  lyricFont: 'hei',
  lyricLetterSpacing: 0,
  lyricLineHeight: 1.0,
  lyricWeight: 900,
  visualTintMode: 'auto',
  visualTintColor: '#9db8cf',
  uiAccentColor: '#ffffff',
  homeAccentColor: '#ffffff',
  homeIconColor: '#ffffff',
  visualIconColor: '#ffffff',
  backgroundColorMode: 'cover',
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  controlGlassChromaticOffset: 90,
  liquidGlassBlur: 0.70,
  liquidGlassRefraction: 0.18,
  liquidGlassAberration: 0.0,
  liquidGlassHighlight: 0.12,
  liquidGlassBrightness: 0.04,
  liquidGlassBevel: 10,
  liquidGlassSaturation: 0.34,
  backgroundColorCustom: false,
  backgroundImage: '',
  backgroundMedia: null,
  backgroundAlbumCover: false,
  desktopLyrics: false,
  desktopLyricsSize: 1.0,
  desktopLyricsOpacity: 0.92,
  desktopLyricsY: 0.76,
  desktopLyricsClickThrough: false,
  desktopLyricsCinema: true,
  desktopLyricsHighlight: false,
  desktopLyricsFps: 60,
  wallpaperMode: false,
  wallpaperOpacity: 1,
  floatLayer: false, cinema: true, edge: false, aiDepth: false, bloom: false, lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  backgroundStarRiver: false,
  lyricVerticalFloat: false,
  lyricPauseHold: false,
  lyricCameraLock: false,
  particleLyrics: true,    // v7.2: 粒子歌词
  lyricDualLine: true,
  lyricDisplayMode: 'dual',          // single/dual/triple/cinema/custom
  lyricTranslationMode: 'off',       // off/current/dual/multi
  lyricMotionStyle: 'float',         // float/smooth/glass/shine/glitch
  lyricCustomLines: 3,
  lyricCustomLineCount: 3,
  lyricGlitchPower: 0.5,
  lyricGlitchRate: 0.22,
  sonicTheme: 'cycle',
  sonicThemeCycleInterval: 60,
  sonicPeakColorEnabled: true,
  sonicPeakColorIntensity: 1,
  sonicGridSize: 160,
  sonicAudioIntensity: 1,
  sonicResponseRange: 1,
  sonicPulseEnabled: true,
  sonicPulseSensitivity: 0.2,
  sonicPulseCooldown: 5,
  sonicMeteorEnabled: true,
  sonicMeteorSensitivity: 0.35,
  sonicMeteorCooldown: 60,
  sonicMeteorClickEnabled: true,
  sonicIdleWaveEnabled: true,
  sonicIdleWaveDebounce: 1,
  sonicIdleWaveFadeDuration: 1,
  sonicCameraDistance: 85,
  sonicCameraAngleX: 120,
  sonicCameraAngleY: 25,
  sonicAutoRotateEnabled: false,
  sonicAutoRotateSpeed: 10,
  backCover: false,        // 旧的封面背面粒子层关闭；浮空粒子层会跟随封面翻转
  shelf: 'side',
  shelfCameraMode: 'static',
  shelfPresence: 'always',
  shelfShowPodcasts: false,
  shelfMergeCollections: false,
  shelfSize: 1,
  shelfOffsetX: 0,
  shelfOffsetY: 0,
  shelfOffsetZ: 0,
  shelfAngleY: -15,
  shelfAngleYManual: false,
  shelfOpacity: 1,
  shelfBgOpacity: 0.90,
  shelfAccentColor: '#ffffff',
  performanceBackground: 'auto',
  performanceQuality: 'auto',
  foregroundFpsMode: 'vsync',
  gpuThrottleMode: 'auto',
  liveBackgroundKeep: false,
  cam: 'off',
  // 内存管理
  memoryAutoTrimApp: true,
  memoryAutoTrimOnBackground: true,
  memoryAutoSystemTrim: false,
  memorySystemAutoElevate: false,
  memorySystemIntervalMin: 30,
  memorySystemThresholdPercent: 78,
  memorySystemMask: 29,
  // sonic 频谱监控
  sonicAudioMonitorEnabled: false,
  sonicAudioAutoTrack: true,
  sonicAudioSensitivity: 50,
  sonicAudioBandStart: 1,
  sonicAudioBandEnd: 4,
  sonicAudioThreshold: 40,
  sonicAudioPulse: 50,
  sonicSubBass: 50,
  sonicBass: 50,
  sonicLowMid: 50,
  sonicMid: 50,
  sonicHighMid: 50,
  sonicPresence: 50,
  sonicBrilliance: 50,
  sonicAir: 50,
  sonicGroundSubBass: 90,
  sonicGroundBass: 92,
  sonicGroundLowMid: 50,
  sonicGroundMid: 50,
  sonicGroundHighMid: 50,
  sonicGroundPresence: 50,
  sonicGroundBrilliance: 50,
  sonicGroundAir: 48,
  sonicGroundColorMode: 'theme',
  sonicGroundBaseColor: '#05070c',
  sonicGroundCoolColor: '#0066ff',
  sonicGroundWarmColor: '#ff3c19',
  sonicGroundAccentColor: '#33e6ff',
  sonicGroundGlow: 68,
  sonicGroundFloatingEnabled: true,
  sonicGroundFloatingCount: 80,
  sonicGroundFloatingIntensity: 55,
  sonicGroundFloatingMinSize: 9,
  sonicGroundFloatingMaxSize: 26,
  sonicGroundFloatingSpeed: 77,
  sonicGroundMotionSpeed: 50,
  sonicGroundAmplitude: 50,
  sonicGroundDensity: 46,
  sonicGroundRange: 82,
  sonicGroundLower: 68,
  sonicGroundDepth: 62,
  sonicGroundAutoRotate: 50,
  rippleColorMode: 'auto',
  rippleColor: '#9db8cf',
  rippleSpeed: 1.0,
  rippleDensity: 1.0,
  rippleBrightness: 1.0,
  rippleWidth: 1.0,
  rippleRange: 1.0,
  classicLyricScale: 1.0,
  classicLyricCurvature: 0.85,
  classicLyricTiltStrength: 1.0,
  classicLyricArcTilt: true,
  classicLyricOffsetX: 0,
  classicLyricOffsetY: 0,
  classicShowCover: true,
  classicShowBg: true,
};
var PACKAGED_DEFAULT_USER_FX_ARCHIVE_NAME = '默认测试';
var PACKAGED_DEFAULT_USER_FX_ARCHIVE_EXPORTED_AT = 1782276031784;
var PACKAGED_DEFAULT_USER_FX_ARCHIVE_SAVED_AT = 1782273019045;
var PACKAGED_DEFAULT_FX_SNAPSHOT = Object.freeze({
  visualPresetSchema: VISUAL_PRESET_SCHEMA,
  preset: 0,
  intensity: 0.85,
  cinemaShake: 0.5,
  depth: 1,
  coverResolution: 1.55,
  point: 1,
  speed: 1,
  twist: 0,
  color: 1.1,
  scatter: 0,
  bgFade: 0.2,
  bloomStrength: 0.62,
  lyricGlowStrength: 0.28,
  lyricScale: 1,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricCameraLock: false,
  lyricColorMode: 'auto',
  lyricColor: '#a9b8c8',
  lyricHighlightMode: 'auto',
  lyricHighlightColor: '#fac900',
  lyricGlowLinked: true,
  lyricGlowColor: '#008aff',
  lyricFont: 'hei',
  lyricLetterSpacing: 0,
  lyricLineHeight: 1,
  lyricWeight: 900,
  visualTintMode: 'auto',
  visualTintColor: '#9db8cf',
  uiAccentColor: '#ffffff',
  homeAccentColor: '#ffffff',
  homeIconColor: '#ffffff',
  visualIconColor: '#ffffff',
  backgroundColorMode: 'cover',
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  controlGlassChromaticOffset: 90,
  liquidGlassBlur: 0.70,
  liquidGlassRefraction: 0.18,
  liquidGlassAberration: 0.0,
  liquidGlassHighlight: 0.12,
  liquidGlassBrightness: 0.04,
  liquidGlassBevel: 10,
  liquidGlassSaturation: 0.34,
  backgroundColorCustom: false,
  floatLayer: false,
  cinema: true,
  edge: false,
  aiDepth: false,
  bloom: false,
  lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  desktopLyrics: false,
  desktopLyricsSize: 1,
  desktopLyricsOpacity: 0.92,
  desktopLyricsY: 0.76,
  desktopLyricsClickThrough: false,
  desktopLyricsCinema: true,
  desktopLyricsHighlight: false,
  desktopLyricsFps: 60,
  performanceBackground: 'auto',
  performanceQuality: 'auto',
  foregroundFpsMode: 'vsync',
  gpuThrottleMode: 'auto',
  liveBackgroundKeep: false,
  particleLyrics: true,
  backCover: false,
  shelf: 'side',
  shelfCameraMode: 'static',
  shelfPresence: 'always',
  shelfShowPodcasts: false,
  shelfMergeCollections: false,
  shelfSize: 1,
  shelfOffsetX: 0,
  shelfOffsetY: 0,
  shelfOffsetZ: 0,
  shelfAngleY: -15,
  shelfAngleYManual: false,
  shelfOpacity: 1,
  shelfBgOpacity: 0.9,
  shelfAccentColor: '#ffffff',
  cam: 'off',
  rippleColorMode: 'auto',
  rippleColor: '#9db8cf',
  rippleSpeed: 1.0,
  rippleDensity: 1.0,
  rippleBrightness: 1.0,
  rippleWidth: 1.0,
  rippleRange: 1.0
});
function clonePackagedDefaultFxSnapshot() {
  return Object.assign({}, PACKAGED_DEFAULT_FX_SNAPSHOT);
}
function packagedDefaultLyricLayoutRaw() {
  return Object.assign({ desktopLyricsSchema: 'desktop-lyrics-v3' }, clonePackagedDefaultFxSnapshot());
}
var DEVELOPMENT_LOCKED_FX = {
  wallpaperMode: true
};
function isDevelopmentLockedFx(key) {
  return !!DEVELOPMENT_LOCKED_FX[key];
}
function normalizeDevelopmentLockedFxState() {
  if (!fx) return;
  fx.wallpaperMode = false;
}
function readSavedPlaybackVisualPreset() {
  try {
    var raw = JSON.parse(localStorage.getItem(LYRIC_LAYOUT_STORE_KEY) || '{}') || {};
    if (!Object.prototype.hasOwnProperty.call(raw, 'preset')) return fxDefaults.preset;
    var savedPreset = clampRange(Number(raw.preset) || 0, 0, VISUAL_PRESET_MAX_INDEX);
    if (savedPreset === 3 && raw.visualPresetSchema !== VISUAL_PRESET_SCHEMA) savedPreset = 5;
    return savedPreset;
  } catch (e) {
    return fxDefaults.preset;
  }
}
var playbackVisualPreset = readSavedPlaybackVisualPreset();
var startupVisualPreviewActive = false;
// 自定义歌词字体：同步读取记录，让 normalizeLyricFontKey 立即识别 custom: 键；异步注册 FontFace
var customLyricFonts = readCustomLyricFonts();
if (customLyricFonts.length) {
  if (typeof document !== 'undefined' && document.fonts && typeof FontFace === 'function') {
    customLyricFonts.forEach(function (record) { registerCustomLyricFont(record); });
  } else if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('DOMContentLoaded', function () {
      customLyricFonts.forEach(function (record) { registerCustomLyricFont(record); });
    });
  }
}
var fx = Object.assign({}, fxDefaults, readSavedLyricLayout());
normalizeDevelopmentLockedFxState();
var presetTransition = { active:false, start:-10, duration:0.92, from:0, to:0 };
var controlsAutoHide = readBooleanPreference(CONTROLS_AUTO_HIDE_STORE_KEY, false);
var controlsHovering = false;
var controlsHideTimer = null;
var controlsHandleDimTimer = null;
var controlsLastMoveAt = 0;
var controlsShelfSuppressUntil = 0;
var cursorHideTimer = null;
var CURSOR_HIDE_DELAY = 2500;
var fxPanelPinned = false;
var playlistPanelPinned = readBooleanPreference(PLAYLIST_PANEL_PIN_STORE_KEY, false);
var userCapsuleAutoHide = readBooleanPreference(USER_CAPSULE_AUTO_HIDE_STORE_KEY, false);
var fxFabAutoHide = readBooleanPreference(FX_FAB_AUTO_HIDE_STORE_KEY, false);
var fxFabAutoHideRevealArmed = true;
var hotkeySettings = readHotkeySettings();
var immersiveMode = false;
var immersiveState = {
  shelfMode: null,
  shelfPinnedOpen: false,
  lyrics: true,
  controlsAutoHide: true,
  bottomVisible: false
};

// 鼠标 / 摄像头视差
var pointerParallax = { x:0, y:0 };
var pointerTarget = { x:0, y:0 };
var headParallax = { x:0, y:0, active:false };
var headNeutral = null;

function pulseObjectValue(target, key, amount, duration) {
  if (!target) return;
  target[key] = Math.max(target[key] || 0, amount || 1);
  if (window.gsap) {
    window.gsap.killTweensOf(target, key);
    var vars = { duration: duration || 0.42, ease: 'power3.out' };
    vars[key] = 0;
    window.gsap.to(target, vars);
  } else {
    setTimeout(function(){ if (target) target[key] = 0; }, (duration || 0.42) * 1000);
  }
}

var desktopRuntimeState = {
  desktop: !!window.desktopWindow,
  minimized: false,
  visible: true,
  focused: true,
  fullscreen: false
};
var renderPowerState = { mode: '', width: 0, height: 0, pixelRatio: 0 };
var backgroundCacheTrimTimer = 0;
var backgroundAppMemoryTrimTimer = 0;
var backgroundAppMemoryTrimInFlight = false;
var runtimePerfState = {
  lastCacheTrimAt: 0,
  lastAppMemoryTrimAt: 0,
  lastAppMemoryTrimReason: '',
  lastAppMemoryTrimResult: null,
  cacheTrimCount: 0,
  lastCacheTrimReason: '',
  lastHeapSampleAt: 0,
  heapMB: 0,
  cacheCounts: {}
};
var runtimeGpuDiagnostics = null;
var runtimeGpuDiagnosticsError = '';
function isDeepBackgroundMode() {
  if (isLiveBackgroundKeepMode()) return false;
  // Electron may briefly leave document.hidden stale after a tray restore.
  // The native BrowserWindow state is authoritative for desktop power policy;
  // browser-only builds still use the Page Visibility API.
  if (desktopRuntimeState.desktop) {
    return !!(desktopRuntimeState.minimized || desktopRuntimeState.visible === false);
  }
  return !!document.hidden;
}
function currentPerformanceBackgroundMode() {
  return normalizePerformanceBackgroundMode(fx && fx.performanceBackground, fx && fx.liveBackgroundKeep === true);
}
function isLiveBackgroundKeepMode() {
  return currentPerformanceBackgroundMode() === 'keep';
}
function isBackgroundReleaseMode() {
  return currentPerformanceBackgroundMode() === 'release';
}
function isHiddenForBackgroundOptimization() {
  return !!(document.hidden && !isLiveBackgroundKeepMode());
}
function isVisibleBackgroundMode() {
  return false;
}
function updateRenderPowerClasses() {
  document.body.classList.toggle('render-deep-sleep', isDeepBackgroundMode());
  document.body.classList.toggle('render-background-eco', isVisibleBackgroundMode());
}
function safeObjectKeys(obj) {
  try { return obj ? Object.keys(obj) : []; } catch (e) { return []; }
}
function markProtectedKey(map, key) {
  if (key) map[String(key)] = true;
}
function collectProtectedCoverUrls() {
  var keep = Object.create(null);
  function mark(url) { if (url) keep[String(url)] = true; }
  try {
    var song = (typeof currentCoverSong === 'function') ? currentCoverSong() : (playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null);
    if (song) {
      mark(song.cover);
      if (typeof songCoverSrc === 'function') {
        mark(songCoverSrc(song, 60));
        mark(songCoverSrc(song, 360));
        mark(songCoverSrc(song, 400));
      }
    }
    if (typeof currentCoverSource !== 'undefined' && currentCoverSource && currentCoverSource.src) mark(currentCoverSource.src);
    if (typeof playlistPanelDetailState !== 'undefined' && playlistPanelDetailState && playlistPanelDetailState.playlist) {
      var cover = playlistPanelDetailState.playlist.cover;
      mark(cover);
      if (typeof coverUrlWithSize === 'function') {
        mark(coverUrlWithSize(cover, 88));
        mark(coverUrlWithSize(cover, 96));
      }
    }
    if (shelfManager && shelfManager.getCards) {
      shelfManager.getCards().forEach(function(card){
        if (card && card.item) mark(card.item.cover);
      });
    }
  } catch (e) {}
  return keep;
}
function collectProtectedBeatMapKeys() {
  var keep = Object.create(null);
  try {
    if (typeof beatMapSongKey === 'function' && playQueue && playQueue.length) {
      var start = Math.max(0, currentIdx - 5);
      var end = Math.min(playQueue.length - 1, currentIdx + 5);
      for (var i = start; i <= end; i++) markProtectedKey(keep, beatMapSongKey(playQueue[i]));
    }
    if (typeof beatPrefetchLastKey !== 'undefined') markProtectedKey(keep, beatPrefetchLastKey);
    if (typeof djMode !== 'undefined' && djMode && djMode.songKey) markProtectedKey(keep, djMode.songKey);
    if (typeof localBeatAnalysis !== 'undefined' && localBeatAnalysis && localBeatAnalysis.song && typeof beatMapSongKey === 'function') {
      markProtectedKey(keep, beatMapSongKey(localBeatAnalysis.song));
    }
  } catch (e) {}
  return keep;
}
function collectProtectedCoverDepthIds() {
  var keep = Object.create(null);
  try {
    if (typeof coverDepthCacheId !== 'function') return keep;
    var candidates = [];
    if (typeof currentCoverSource !== 'undefined' && currentCoverSource && currentCoverSource.src) candidates.push(currentCoverSource.src);
    var song = (typeof currentCoverSong === 'function') ? currentCoverSong() : null;
    if (song && typeof songCoverSrc === 'function') {
      candidates.push(songCoverSrc(song, 360));
      candidates.push(songCoverSrc(song, 400));
    }
    var texImg = (typeof coverTex !== 'undefined' && coverTex && coverTex.image) ? coverTex.image : null;
    var w = texImg && texImg.width ? texImg.width : 0;
    var h = texImg && texImg.height ? texImg.height : 0;
    candidates.forEach(function(src){
      if (src) markProtectedKey(keep, coverDepthCacheId(src + '|tex=' + w + 'x' + h));
    });
  } catch (e) {}
  return keep;
}
function trimObjectCache(cache, keep, protectedKeys, skipRecord) {
  var keys = safeObjectKeys(cache);
  if (!cache || keys.length <= keep) return 0;
  var drop = keys.length - keep;
  var dropped = 0;
  for (var i = 0; i < keys.length && drop > 0; i++) {
    var key = keys[i];
    if (protectedKeys && protectedKeys[key]) continue;
    var rec = cache[key];
    if (skipRecord && skipRecord(rec, key)) continue;
    delete cache[key];
    drop--;
    dropped++;
  }
  return dropped;
}
function trimCoverDepthCache(keep, protectedKeys) {
  if (!coverDepthCache || !coverDepthCacheKeys) return 0;
  var keys = coverDepthCacheKeys.filter(function(key){ return !!coverDepthCache[key]; });
  if (keys.length <= keep) {
    coverDepthCacheKeys = keys;
    return 0;
  }
  var keepSet = Object.create(null);
  var count = 0;
  for (var i = keys.length - 1; i >= 0 && count < keep; i--) {
    keepSet[keys[i]] = true;
    count++;
  }
  Object.keys(protectedKeys || {}).forEach(function(key){ keepSet[key] = true; });
  var dropped = 0;
  keys.forEach(function(key){
    if (keepSet[key]) return;
    delete coverDepthCache[key];
    dropped++;
  });
  coverDepthCacheKeys = keys.filter(function(key){ return !!coverDepthCache[key]; });
  return dropped;
}
function collectRuntimePerfSnapshot(now) {
  now = now || performance.now();
  runtimePerfState.cacheCounts = {
    playlistCovers: safeObjectKeys(playlistCoverCache).length,
    coverDepth: coverDepthCacheKeys ? coverDepthCacheKeys.length : 0,
    beatMaps: safeObjectKeys(beatMapCache).length,
    djBeatMaps: safeObjectKeys(djBeatMapCache).length,
    stageLyricTrack: (typeof stageLyricTrackCache !== 'undefined' && stageLyricTrackCache && stageLyricTrackCache.entries) ? stageLyricTrackCache.entries.length : 0
  };
  if (performance && performance.memory && now - runtimePerfState.lastHeapSampleAt > 12000) {
    runtimePerfState.lastHeapSampleAt = now;
    runtimePerfState.heapMB = Math.round((performance.memory.usedJSHeapSize || 0) / 1048576);
  }
  return {
    render: (typeof renderPerfState !== 'undefined') ? {
      mode: renderPerfState.mode,
      fps: renderPerfState.fps,
      targetFps: renderPerfState.targetFps,
      displayHz: renderPerfState.displayHz,
      adaptiveDivisor: renderPerfState.adaptiveDivisor,
      adaptiveKind: renderPerfState.adaptiveKind,
      adaptivePressure: renderPerfState.adaptivePressure,
      adaptiveFrameCostMs: renderPerfState.adaptiveFrameCostMs,
      foregroundFpsMode: renderPerfState.foregroundFpsMode,
      interactionBoost: renderPerfState.interactionBoost,
      skipped: renderPerfState.skipped,
      longFrames: renderPerfState.longFrames
    } : null,
    runtime: runtimePerfState,
    gpu: runtimeGpuDiagnostics || (runtimeGpuDiagnosticsError ? { error: runtimeGpuDiagnosticsError } : null),
    hardware: (typeof refreshRuntimeHardwareSurfaceProfile === 'function')
      ? refreshRuntimeHardwareSurfaceProfile()
      : ((typeof runtimeHardwareProfile !== 'undefined') ? runtimeHardwareProfile : null),
    budget: {
      qualityRank: (typeof performanceQualityRank === 'function') ? performanceQualityRank() : 0,
      level: (typeof runtimePerfBudgetLevel === 'function') ? runtimePerfBudgetLevel() : 0,
      perfScale: (typeof runtimePerfScale === 'function') ? runtimePerfScale() : 1,
      audioScale: (typeof runtimeAudioAnalysisScale === 'function') ? runtimeAudioAnalysisScale() : 1
    },
    renderer: (typeof renderer !== 'undefined' && renderer && renderer.info) ? {
      geometries: renderer.info.memory && renderer.info.memory.geometries,
      textures: renderer.info.memory && renderer.info.memory.textures,
      calls: renderer.info.render && renderer.info.render.calls,
      triangles: renderer.info.render && renderer.info.render.triangles
    } : null,
    viewport: (typeof renderer !== 'undefined' && renderer && renderer.domElement) ? {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      renderPixelRatio: renderer.getPixelRatio ? Number(renderer.getPixelRatio().toFixed(3)) : 0,
      canvasWidth: renderer.domElement.width || 0,
      canvasHeight: renderer.domElement.height || 0,
      renderPixels: (renderer.domElement.width || 0) * (renderer.domElement.height || 0),
      targetFps: (typeof getAdaptiveRenderFps === 'function') ? getAdaptiveRenderFps(now) : 0,
      displayHz: (typeof estimatedDisplayRefreshHz === 'function') ? Math.round(estimatedDisplayRefreshHz() * 10) / 10 : 0,
      adaptiveLoad: (typeof adaptiveFrameLoadSnapshot === 'function') ? adaptiveFrameLoadSnapshot() : null,
      foregroundFpsMode: (typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : '',
      interactionBoost: (typeof isRenderInteractionActive === 'function') ? isRenderInteractionActive() : false,
      interactionReason: (typeof renderInteractionReason !== 'undefined') ? renderInteractionReason : ''
    } : null,
    frameGates: (typeof collectFrameGateSnapshot === 'function' && typeof mainFrameGates !== 'undefined')
      ? collectFrameGateSnapshot(mainFrameGates)
      : null,
    deepSleep: isDeepBackgroundMode(),
    probe: (window.__mineradioPerf && window.__mineradioPerf.summary)
      ? window.__mineradioPerf.summary()
      : null
  };
}
window.__mineradioPerfSnapshot = collectRuntimePerfSnapshot;

function requestBackgroundAppMemoryTrim(reason, delayMs) {
  if (!window.desktopWindow || typeof window.desktopWindow.trimAppMemory !== 'function') return;
  if (!isDeepBackgroundMode() || isLiveBackgroundKeepMode()) return;
  if (fx && fx.memoryAutoTrimApp === false) return;
  if (fx && fx.memoryAutoTrimOnBackground === false) return;
  var now = performance.now();
  if (backgroundAppMemoryTrimInFlight || now - runtimePerfState.lastAppMemoryTrimAt < 30000) return;
  if (backgroundAppMemoryTrimTimer) clearTimeout(backgroundAppMemoryTrimTimer);
  backgroundAppMemoryTrimTimer = setTimeout(function () {
    backgroundAppMemoryTrimTimer = 0;
    if (!isDeepBackgroundMode() || isLiveBackgroundKeepMode() || backgroundAppMemoryTrimInFlight) return;
    if (fx && fx.memoryAutoTrimApp === false) return;
    if (fx && fx.memoryAutoTrimOnBackground === false) return;
    if (fx && fx.memoryAutoSystemTrim && typeof configureMemoryReductFromFx === 'function') {
      configureMemoryReductFromFx('deep-background', true);
    }
    backgroundAppMemoryTrimInFlight = true;
    runtimePerfState.lastAppMemoryTrimAt = performance.now();
    runtimePerfState.lastAppMemoryTrimReason = reason || 'deep-background';
    window.desktopWindow.trimAppMemory({ reason: runtimePerfState.lastAppMemoryTrimReason }).then(function (result) {
      runtimePerfState.lastAppMemoryTrimResult = result || null;
    }).catch(function (error) {
      runtimePerfState.lastAppMemoryTrimResult = { ok: false, error: String(error && error.message || error || 'APP_MEMORY_TRIM_FAILED') };
    }).finally(function () {
      backgroundAppMemoryTrimInFlight = false;
    });
  }, Math.max(500, delayMs || 1800));
}

function trimRuntimeCaches(reason, aggressive) {
  var protectedCovers = collectProtectedCoverUrls();
  var protectedBeats = collectProtectedBeatMapKeys();
  var dropped = 0;
  dropped += trimObjectCache(playlistCoverCache, aggressive ? 72 : 180, protectedCovers, function(rec){
    return rec && rec.loading;
  });
  dropped += trimCoverDepthCache(aggressive ? 4 : 10, collectProtectedCoverDepthIds());
  dropped += trimObjectCache(beatMapCache, aggressive ? 12 : 36, protectedBeats);
  dropped += trimObjectCache(djBeatMapCache, aggressive ? 4 : 12, protectedBeats);
  if (aggressive && typeof stageLyricTrackCache !== 'undefined' && stageLyricTrackCache) {
    stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
  }
  if (aggressive && typeof renderer !== 'undefined' && renderer && renderer.renderLists && renderer.renderLists.dispose) {
    try { renderer.renderLists.dispose(); } catch (e) {}
  }
  runtimePerfState.lastCacheTrimAt = performance.now();
  runtimePerfState.cacheTrimCount += 1;
  runtimePerfState.lastCacheTrimReason = reason || (aggressive ? 'deep' : 'active');
  collectRuntimePerfSnapshot(runtimePerfState.lastCacheTrimAt);
  return dropped;
}
function trimVisualCachesForBackground() {
  if (!isDeepBackgroundMode()) return;
  trimRuntimeCaches('deep-background', true);
  requestBackgroundAppMemoryTrim('deep-background', isBackgroundReleaseMode() ? 900 : 1800);
}
function scheduleBackgroundCacheTrim() {
  if (!isDeepBackgroundMode()) return;
  if (backgroundCacheTrimTimer) clearTimeout(backgroundCacheTrimTimer);
  backgroundCacheTrimTimer = setTimeout(function(){
    backgroundCacheTrimTimer = 0;
    trimVisualCachesForBackground();
  }, 900);
}
function maybeTrimRuntimeCaches(now) {
  now = now || performance.now();
  var deep = isDeepBackgroundMode();
  var gap = deep ? (isBackgroundReleaseMode() ? 3600 : 7000) : 45000;
  if (!deep && now < 30000) return;
  if (now - runtimePerfState.lastCacheTrimAt < gap) return;
  trimRuntimeCaches(deep ? (isBackgroundReleaseMode() ? 'release-frame' : 'deep-frame') : 'active-frame', deep);
}
function applyRendererPowerMode() {
  if (typeof renderer === 'undefined' || !renderer) return;
  var deep = isDeepBackgroundMode();
  var width = deep ? 4 : Math.max(1, innerWidth);
  var height = deep ? 4 : Math.max(1, innerHeight);
  var pixelRatio = getRenderPixelRatio();
  var mode = deep ? 'sleep' : 'active';
  if (renderPowerState.mode === mode && renderPowerState.width === width && renderPowerState.height === height && Math.abs(renderPowerState.pixelRatio - pixelRatio) < 0.001) return;
  renderPowerState = { mode: mode, width: width, height: height, pixelRatio: pixelRatio };
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  if (typeof uniforms !== 'undefined' && uniforms && uniforms.uPixel) uniforms.uPixel.value = renderer.getPixelRatio();
  if (typeof ripplePlaneMat !== 'undefined' && ripplePlaneMat && ripplePlaneMat.uniforms && ripplePlaneMat.uniforms.uResolution) {
    ripplePlaneMat.uniforms.uResolution.value.set(innerWidth, innerHeight);
  }
  if (deep) {
    if (renderer.renderLists && renderer.renderLists.dispose) renderer.renderLists.dispose();
    scheduleBackgroundCacheTrim();
    requestBackgroundAppMemoryTrim('renderer-deep-sleep', isBackgroundReleaseMode() ? 900 : 2200);
  }
}
function updateDesktopRuntimeState(state) {
  state = state || {};
  var wasFullscreen = desktopRuntimeState.fullscreen;
  var wasDeep = isDeepBackgroundMode();
  desktopRuntimeState.desktop = !!window.desktopWindow;
  desktopRuntimeState.minimized = !!state.isMinimized;
  desktopRuntimeState.visible = state.isVisible !== false;
  desktopRuntimeState.focused = state.isFocused !== false;
  desktopRuntimeState.fullscreen = !!(state.isFullScreen || state.isNativeFullScreen || state.isHtmlFullScreen || state.isWindowFullScreen);
  updateRenderPowerClasses();
  applyRendererPowerMode();
  if ((desktopRuntimeState.minimized || !desktopRuntimeState.visible) && typeof flushLyricLayoutSave === 'function') {
    flushLyricLayoutSave();
  }
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) setTimeout(syncDesktopOverlayState, 0);
  if (wasDeep && !isDeepBackgroundMode()) recoverVisualsAfterBackground('desktop-runtime-state');
  if (desktopRuntimeState.fullscreen !== wasFullscreen) scheduleMainRendererViewportRefresh('desktop-runtime-state');
}
function installRenderPowerHooks() {
  updateRenderPowerClasses();
  if (window.desktopWindow && typeof window.desktopWindow.getGpuDiagnostics === 'function') {
    window.desktopWindow.getGpuDiagnostics().then(function (info) {
      runtimeGpuDiagnostics = info || null;
      runtimeGpuDiagnosticsError = '';
    }).catch(function (error) {
      runtimeGpuDiagnosticsError = String(error && error.message || error || 'GPU_DIAGNOSTICS_FAILED');
    });
  }
  document.addEventListener('visibilitychange', function(){
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (!isDeepBackgroundMode()) recoverVisualsAfterBackground('visibilitychange');
  });
  window.addEventListener('focus', function(){
    desktopRuntimeState.focused = true;
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (!isDeepBackgroundMode()) recoverVisualsAfterBackground('focus');
  });
  window.addEventListener('blur', function(){
    desktopRuntimeState.focused = false;
    updateRenderPowerClasses();
    applyRendererPowerMode();
  });
  if (window.desktopWindow && typeof window.desktopWindow.onStateChange === 'function') {
    window.desktopWindow.onStateChange(updateDesktopRuntimeState);
    if (typeof window.desktopWindow.getState === 'function') {
      window.desktopWindow.getState().then(updateDesktopRuntimeState).catch(function(){});
    }
  }
}

