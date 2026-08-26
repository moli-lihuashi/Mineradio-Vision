function readSavedLyricLayout() {
  try {
    var savedLayoutRaw = localStorage.getItem(LYRIC_LAYOUT_STORE_KEY);
    var raw = savedLayoutRaw ? (JSON.parse(savedLayoutRaw) || {}) : packagedDefaultLyricLayoutRaw();
    var savedPreset = clampRange(Number(raw.preset) || 0, 0, VISUAL_PRESET_MAX_INDEX);
    if (savedPreset === 3 && raw.visualPresetSchema !== VISUAL_PRESET_SCHEMA) {
      savedPreset = 5;
    }
    var savedBgColor = normalizeHexColor(raw.backgroundColor || '#000000', '#000000');
    var savedBgOpacity = clampRange(raw.backgroundOpacity == null ? fxDefaults.backgroundOpacity : Number(raw.backgroundOpacity), 0, 1);
    var savedGlassOffset = clampRange(raw.controlGlassChromaticOffset == null ? fxDefaults.controlGlassChromaticOffset : Number(raw.controlGlassChromaticOffset), 0, 140);
    var savedBgMode = /^(cover|custom)$/.test(String(raw.backgroundColorMode || '')) ? String(raw.backgroundColorMode) : '';
    var savedBgCustom = savedBgMode
      ? savedBgMode === 'custom'
      : (raw.backgroundColorCustom === true || (raw.backgroundColorCustom !== false && savedBgColor !== '#000000') || savedBgOpacity < 1);
    var desktopLyricsSchemaReady = raw.desktopLyricsSchema === 'desktop-lyrics-v3';
    var savedShelfCameraMode = normalizeShelfCameraMode(raw.shelfCameraMode || fxDefaults.shelfCameraMode);
    var savedShelfAngleManual = raw.shelfAngleYManual === true;
    var savedShelfAngle = savedShelfAngleManual
      ? clampRange(raw.shelfAngleY == null ? shelfDefaultAngleForCameraMode(savedShelfCameraMode) : Number(raw.shelfAngleY), -30, 30)
      : shelfDefaultAngleForCameraMode(savedShelfCameraMode);
    return {
      preset: savedPreset,
      intensity: clampRange(Number(raw.intensity) || fxDefaults.intensity, 0.2, 1.6),
      particleCount: clampRange(Number(raw.particleCount) || fxDefaults.particleCount, 0.3, 1.0),
      cinemaShake: clampRange(Number(raw.cinemaShake) || fxDefaults.cinemaShake, 0, 1.8),
      depth: clampRange(Number(raw.depth) || fxDefaults.depth, 0.2, 1.8),
      point: clampRange(Number(raw.point) || fxDefaults.point, 0.5, 2.2),
      speed: clampRange(Number(raw.speed) || fxDefaults.speed, 0.2, 2.5),
      twist: clampRange(Number(raw.twist) || fxDefaults.twist, 0, 0.6),
      color: clampRange(Number(raw.color) || fxDefaults.color, 0.5, 2.0),
      scatter: clampRange(Number(raw.scatter) || fxDefaults.scatter, 0, 0.5),
      bgFade: clampRange(Number(raw.bgFade) || fxDefaults.bgFade, 0, 1.2),
      bloomStrength: clampRange(Number(raw.bloomStrength) || fxDefaults.bloomStrength, 0, 1.6),
      lyricGlowStrength: clampRange(Number(raw.lyricGlowStrength) || fxDefaults.lyricGlowStrength, 0, 0.85),
      lyricScale: clampRange(Number(raw.lyricScale) || 1, 0.35, 1.65),
      lyricOffsetX: clampRange(Number(raw.lyricOffsetX) || 0, -4.0, 4.0),
      lyricOffsetY: clampRange(Number(raw.lyricOffsetY) || 0, -2.4, 2.7),
      lyricOffsetZ: clampRange(Number(raw.lyricOffsetZ) || 0, -3.2, 3.2),
      lyricTiltX: clampRange(Number(raw.lyricTiltX) || 0, -84, 84),
      lyricTiltY: clampRange(Number(raw.lyricTiltY) || 0, -84, 84),
      lyricCameraLock: !!raw.lyricCameraLock,
      lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: normalizeHexColor(raw.lyricColor || '#a9b8c8'),
      lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || '#fff0b8'),
      lyricGlowLinked: raw.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || '#9db8cf'),
      lyricFont: normalizeLyricFontKey(raw.lyricFont),
      lyricLetterSpacing: clampRange(Number(raw.lyricLetterSpacing) || 0, -0.04, 0.18),
      lyricLineHeight: clampRange(Number(raw.lyricLineHeight) || 1, 0.86, 1.35),
      lyricWeight: clampRange(Number(raw.lyricWeight) || 900, 500, 900),
      lyricGlow: raw.lyricGlow !== false,
      lyricGlowBeat: raw.lyricGlowBeat !== false,
      lyricGlowParticles: !!raw.lyricGlowParticles,
      backgroundStarRiver: !!raw.backgroundStarRiver,
      lyricVerticalFloat: raw.lyricVerticalFloat === true,
      lyricPauseHold: raw.lyricPauseHold === true,
      cinema: raw.cinema !== false,
      bloom: raw.bloom === true,
      edge: raw.edge === true,
      visualTintMode: raw.visualTintMode === 'custom' ? 'custom' : 'auto',
      visualTintColor: normalizeHexColor(raw.visualTintColor || '#9db8cf'),
      uiAccentColor: normalizeHexColor(raw.uiAccentColor || '#00f5d4', '#00f5d4'),
      homeAccentColor: normalizeHexColor(raw.homeAccentColor || '#00f5d4'),
      homeIconColor: normalizeHexColor(raw.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a'),
      visualIconColor: normalizeHexColor(raw.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff'),
      backgroundColorMode: savedBgCustom ? 'custom' : 'cover',
      backgroundColor: savedBgColor,
      backgroundOpacity: savedBgOpacity,
      controlGlassChromaticOffset: savedGlassOffset,
      liquidGlassBlur: clampRange(raw.liquidGlassBlur == null ? fxDefaults.liquidGlassBlur : Number(raw.liquidGlassBlur), 0, 1),
      liquidGlassRefraction: clampRange(raw.liquidGlassRefraction == null ? fxDefaults.liquidGlassRefraction : Number(raw.liquidGlassRefraction), 0, 2),
      liquidGlassAberration: clampRange(raw.liquidGlassAberration == null ? fxDefaults.liquidGlassAberration : Number(raw.liquidGlassAberration), 0, 0.5),
      liquidGlassHighlight: clampRange(raw.liquidGlassHighlight == null ? fxDefaults.liquidGlassHighlight : Number(raw.liquidGlassHighlight), 0, 1),
      liquidGlassBrightness: clampRange(raw.liquidGlassBrightness == null ? fxDefaults.liquidGlassBrightness : Number(raw.liquidGlassBrightness), -0.5, 0.5),
      liquidGlassBevel: clampRange(raw.liquidGlassBevel == null ? fxDefaults.liquidGlassBevel : Number(raw.liquidGlassBevel), 0, 60),
      liquidGlassSaturation: clampRange(raw.liquidGlassSaturation == null ? fxDefaults.liquidGlassSaturation : Number(raw.liquidGlassSaturation), 0, 1),
      backgroundColorCustom: savedBgCustom,
      backgroundImage: normalizeCustomBackgroundImage(raw.backgroundImage),
      backgroundMedia: normalizeCustomBackgroundMedia(raw.backgroundMedia || raw.backgroundImage),
      backgroundAlbumCover: raw.backgroundAlbumCover === true,
      desktopLyrics: raw.desktopLyrics === true,
      desktopLyricsSize: clampRange(Number(raw.desktopLyricsSize) || fxDefaults.desktopLyricsSize, 0.72, 1.55),
      desktopLyricsOpacity: clampRange(raw.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(raw.desktopLyricsOpacity), 0.28, 1),
      desktopLyricsY: clampRange(raw.desktopLyricsY == null ? fxDefaults.desktopLyricsY : Number(raw.desktopLyricsY), 0.08, 0.92),
      desktopLyricsClickThrough: desktopLyricsSchemaReady ? raw.desktopLyricsClickThrough === true : fxDefaults.desktopLyricsClickThrough,
      desktopLyricsCinema: desktopLyricsSchemaReady ? raw.desktopLyricsCinema !== false : fxDefaults.desktopLyricsCinema,
      desktopLyricsHighlight: desktopLyricsSchemaReady ? raw.desktopLyricsHighlight === true : fxDefaults.desktopLyricsHighlight,
      desktopLyricsFps: desktopLyricsSchemaReady ? normalizeDesktopLyricsFps(raw.desktopLyricsFps) : fxDefaults.desktopLyricsFps,
      performanceBackground: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true),
      performanceQuality: normalizePerformanceQuality(raw.performanceQuality),
      foregroundFpsMode: normalizeForegroundFpsMode(raw.foregroundFpsMode),
      gpuThrottleMode: normalizeGpuThrottleMode(raw.gpuThrottleMode),
      liveBackgroundKeep: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true) === 'keep',
      wallpaperMode: false,
      wallpaperOpacity: clampRange(raw.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(raw.wallpaperOpacity), 0.35, 1),
      coverResolution: normalizeCoverResolution(raw.coverResolution),
      shelf: /^(off|side|stage)$/.test(String(raw.shelf || '')) ? raw.shelf : fxDefaults.shelf,
      shelfCameraMode: savedShelfCameraMode,
      shelfPresence: normalizeShelfPresence(raw.shelfPresence || fxDefaults.shelfPresence),
      shelfShowPodcasts: raw.shelfShowPodcasts !== false,
      shelfMergeCollections: raw.shelfMergeCollections === true,
      shelfSize: clampRange(raw.shelfSize == null ? fxDefaults.shelfSize : Number(raw.shelfSize), 0.65, 1.45),
      shelfOffsetX: clampRange(raw.shelfOffsetX == null ? fxDefaults.shelfOffsetX : Number(raw.shelfOffsetX), -1.2, 1.2),
      shelfOffsetY: clampRange(raw.shelfOffsetY == null ? fxDefaults.shelfOffsetY : Number(raw.shelfOffsetY), -0.9, 0.9),
      shelfOffsetZ: clampRange(raw.shelfOffsetZ == null ? fxDefaults.shelfOffsetZ : Number(raw.shelfOffsetZ), -0.9, 0.9),
      shelfAngleY: savedShelfAngle,
      shelfAngleYManual: savedShelfAngleManual,
      shelfOpacity: clampRange(raw.shelfOpacity == null ? fxDefaults.shelfOpacity : Number(raw.shelfOpacity), 0.25, 1),
      shelfBgOpacity: clampRange(raw.shelfBgOpacity == null ? fxDefaults.shelfBgOpacity : Number(raw.shelfBgOpacity), 0.25, 0.98),
      shelfAccentColor: normalizeHexColor(raw.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
      cam: /^(off|gesture)$/.test(String(raw.cam || '')) ? raw.cam : fxDefaults.cam,
      lyricDualLine: raw.lyricDualLine !== false,
      lyricDisplayMode: /^(single|dual|triple|cinema|custom)$/.test(String(raw.lyricDisplayMode)) ? raw.lyricDisplayMode : (raw.lyricDualLine === false ? 'single' : fxDefaults.lyricDisplayMode),
      lyricTranslationMode: /^(off|current|dual|multi)$/.test(String(raw.lyricTranslationMode)) ? raw.lyricTranslationMode : fxDefaults.lyricTranslationMode,
      lyricMotionStyle: /^(float|smooth|glass|shine|glitch)$/.test(String(raw.lyricMotionStyle)) ? raw.lyricMotionStyle : fxDefaults.lyricMotionStyle,
      lyricCustomLines: clampRange(Math.round(Number(raw.lyricCustomLines)) || fxDefaults.lyricCustomLines, 1, 10),
      lyricGlitchPower: clampRange(Number(raw.lyricGlitchPower) || fxDefaults.lyricGlitchPower, 0.14, 1.0),
      lyricGlitchRate: clampRange(Number(raw.lyricGlitchRate) || fxDefaults.lyricGlitchRate, 0.08, 0.54),
      sonicTheme: String(raw.sonicTheme || fxDefaults.sonicTheme || 'cycle'),
      sonicThemeCycleInterval: clampRange(Number(raw.sonicThemeCycleInterval) || fxDefaults.sonicThemeCycleInterval, 8, 180),
      sonicPeakColorEnabled: raw.sonicPeakColorEnabled !== false,
      sonicPeakColorIntensity: clampRange(Number(raw.sonicPeakColorIntensity) || fxDefaults.sonicPeakColorIntensity, 0, 2),
      sonicGridSize: clampRange(Number(raw.sonicGridSize) || fxDefaults.sonicGridSize, 120, 640),
      sonicAudioIntensity: clampRange(Number(raw.sonicAudioIntensity) || fxDefaults.sonicAudioIntensity, 0.3, 2.5),
      sonicResponseRange: clampRange(Number(raw.sonicResponseRange) || fxDefaults.sonicResponseRange, 0.3, 2),
      sonicPulseEnabled: raw.sonicPulseEnabled !== false,
      sonicPulseSensitivity: clampRange(Number(raw.sonicPulseSensitivity) || fxDefaults.sonicPulseSensitivity, 0.05, 0.5),
      sonicPulseCooldown: clampRange(Number(raw.sonicPulseCooldown) || fxDefaults.sonicPulseCooldown, 0, 200),
      sonicMeteorEnabled: raw.sonicMeteorEnabled !== false,
      sonicMeteorSensitivity: clampRange(Number(raw.sonicMeteorSensitivity) || fxDefaults.sonicMeteorSensitivity, 0.1, 0.8),
      sonicMeteorCooldown: clampRange(Number(raw.sonicMeteorCooldown) || fxDefaults.sonicMeteorCooldown, 0, 400),
      sonicMeteorClickEnabled: raw.sonicMeteorClickEnabled !== false,
      sonicIdleWaveEnabled: raw.sonicIdleWaveEnabled !== false,
      sonicIdleWaveDebounce: clampRange(Number(raw.sonicIdleWaveDebounce) || fxDefaults.sonicIdleWaveDebounce, 0.5, 5),
      sonicIdleWaveFadeDuration: clampRange(Number(raw.sonicIdleWaveFadeDuration) || fxDefaults.sonicIdleWaveFadeDuration, 0.5, 5),
      sonicCameraDistance: clampRange(Number(raw.sonicCameraDistance) || fxDefaults.sonicCameraDistance, 40, 120),
      sonicCameraAngleX: clampRange(Number(raw.sonicCameraAngleX) || fxDefaults.sonicCameraAngleX, 0, 360),
      sonicCameraAngleY: clampRange(Number(raw.sonicCameraAngleY) || fxDefaults.sonicCameraAngleY, 0, 90),
      sonicAutoRotateEnabled: raw.sonicAutoRotateEnabled === true,
      sonicAutoRotateSpeed: clampRange(Number(raw.sonicAutoRotateSpeed) || fxDefaults.sonicAutoRotateSpeed, 1, 30),
      rippleColorMode: raw.rippleColorMode === 'custom' ? 'custom' : 'auto',
      rippleColor: normalizeHexColor(raw.rippleColor || fxDefaults.rippleColor || '#9db8cf'),
      rippleSpeed: clampRange(raw.rippleSpeed == null ? fxDefaults.rippleSpeed : Number(raw.rippleSpeed), 0.2, 2.0),
      rippleDensity: clampRange(raw.rippleDensity == null ? fxDefaults.rippleDensity : Number(raw.rippleDensity), 0.5, 2.5),
      rippleBrightness: clampRange(raw.rippleBrightness == null ? fxDefaults.rippleBrightness : Number(raw.rippleBrightness), 0.3, 2.0),
      rippleWidth: clampRange(raw.rippleWidth == null ? fxDefaults.rippleWidth : Number(raw.rippleWidth), 0.5, 2.0),
      rippleRange: clampRange(raw.rippleRange == null ? fxDefaults.rippleRange : Number(raw.rippleRange), 0.5, 2.0),
      classicLyricScale: clampRange(raw.classicLyricScale == null ? fxDefaults.classicLyricScale : Number(raw.classicLyricScale), 0.5, 2.0),
      classicLyricCurvature: clampRange(raw.classicLyricCurvature == null ? fxDefaults.classicLyricCurvature : Number(raw.classicLyricCurvature), -1.5, 1.5),
      classicLyricTiltStrength: clampRange(raw.classicLyricTiltStrength == null ? fxDefaults.classicLyricTiltStrength : Number(raw.classicLyricTiltStrength), 0, 1.5),
      classicLyricArcTilt: raw.classicLyricArcTilt !== false,
      classicLyricOffsetX: clampRange(raw.classicLyricOffsetX == null ? fxDefaults.classicLyricOffsetX : Number(raw.classicLyricOffsetX), -25, 25),
      classicLyricOffsetY: clampRange(raw.classicLyricOffsetY == null ? fxDefaults.classicLyricOffsetY : Number(raw.classicLyricOffsetY), -20, 20),
      classicShowCover: raw.classicShowCover !== false,
      classicShowBg: raw.classicShowBg !== false
    };
  } catch (e) {
    return {};
  }
}
function saveLyricLayout() {
  try {
    var presetForSave = startupVisualPreviewActive && !playing && currentIdx < 0
      ? playbackVisualPreset
      : clampRange(Number(fx.preset) || 0, 0, presetMeta.length - 1);
    localStorage.setItem(LYRIC_LAYOUT_STORE_KEY, JSON.stringify({
      visualPresetSchema: VISUAL_PRESET_SCHEMA,
      desktopLyricsSchema: 'desktop-lyrics-v3',
      preset: presetForSave,
      intensity: clampRange(Number(fx.intensity) || fxDefaults.intensity, 0.2, 1.6),
      particleCount: clampRange(Number(fx.particleCount) || fxDefaults.particleCount, 0.3, 1.0),
      cinemaShake: clampRange(Number(fx.cinemaShake) || fxDefaults.cinemaShake, 0, 1.8),
      depth: clampRange(Number(fx.depth) || fxDefaults.depth, 0.2, 1.8),
      point: clampRange(Number(fx.point) || fxDefaults.point, 0.5, 2.2),
      speed: clampRange(Number(fx.speed) || fxDefaults.speed, 0.2, 2.5),
      twist: clampRange(Number(fx.twist) || fxDefaults.twist, 0, 0.6),
      color: clampRange(Number(fx.color) || fxDefaults.color, 0.5, 2.0),
      scatter: clampRange(Number(fx.scatter) || fxDefaults.scatter, 0, 0.5),
      bgFade: clampRange(Number(fx.bgFade) || fxDefaults.bgFade, 0, 1.2),
      bloomStrength: clampRange(Number(fx.bloomStrength) || fxDefaults.bloomStrength, 0, 1.6),
      lyricGlowStrength: clampRange(Number(fx.lyricGlowStrength) || fxDefaults.lyricGlowStrength, 0, 0.85),
      lyricScale: clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65),
      lyricOffsetX: clampRange(Number(fx.lyricOffsetX) || 0, -2.0, 2.0),
      lyricOffsetY: clampRange(Number(fx.lyricOffsetY) || 0, -1.2, 1.35),
      lyricOffsetZ: clampRange(Number(fx.lyricOffsetZ) || 0, -1.6, 1.6),
      lyricTiltX: clampRange(Number(fx.lyricTiltX) || 0, -42, 42),
      lyricTiltY: clampRange(Number(fx.lyricTiltY) || 0, -42, 42),
      lyricCameraLock: !!fx.lyricCameraLock,
      lyricColorMode: fx.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: normalizeHexColor(fx.lyricColor || '#a9b8c8'),
      lyricHighlightMode: fx.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(fx.lyricHighlightColor || '#fff0b8'),
      lyricGlowLinked: fx.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(fx.lyricGlowColor || '#9db8cf'),
      lyricFont: normalizeLyricFontKey(fx.lyricFont),
      lyricLetterSpacing: clampRange(Number(fx.lyricLetterSpacing) || 0, -0.04, 0.18),
      lyricLineHeight: clampRange(Number(fx.lyricLineHeight) || 1, 0.86, 1.35),
      lyricWeight: clampRange(Number(fx.lyricWeight) || 900, 500, 900),
      lyricGlow: !!fx.lyricGlow,
      lyricGlowBeat: !!fx.lyricGlowBeat,
      lyricGlowParticles: !!fx.lyricGlowParticles,
      backgroundStarRiver: !!fx.backgroundStarRiver,
      lyricVerticalFloat: !!fx.lyricVerticalFloat,
      lyricPauseHold: !!fx.lyricPauseHold,
      cinema: !!fx.cinema,
      bloom: !!fx.bloom,
      edge: !!fx.edge,
      visualTintMode: fx.visualTintMode === 'custom' ? 'custom' : 'auto',
      visualTintColor: normalizeHexColor(fx.visualTintColor || '#9db8cf'),
      uiAccentColor: normalizeHexColor(fx.uiAccentColor || '#00f5d4', '#00f5d4'),
      homeAccentColor: normalizeHexColor(fx.homeAccentColor || '#00f5d4'),
      homeIconColor: normalizeHexColor(fx.homeIconColor || '#f4d28a', '#f4d28a'),
      visualIconColor: normalizeHexColor(fx.visualIconColor || '#7fd8ff', '#7fd8ff'),
      backgroundColorMode: fx.backgroundColorMode === 'custom' || fx.backgroundColorCustom ? 'custom' : 'cover',
      backgroundColor: normalizeHexColor(fx.backgroundColor || '#000000', '#000000'),
      backgroundOpacity: clampRange(fx.backgroundOpacity == null ? fxDefaults.backgroundOpacity : Number(fx.backgroundOpacity), 0, 1),
      controlGlassChromaticOffset: clampRange(fx.controlGlassChromaticOffset == null ? fxDefaults.controlGlassChromaticOffset : Number(fx.controlGlassChromaticOffset), 0, 140),
      liquidGlassBlur: clampRange(fx.liquidGlassBlur == null ? fxDefaults.liquidGlassBlur : Number(fx.liquidGlassBlur), 0, 1),
      liquidGlassRefraction: clampRange(fx.liquidGlassRefraction == null ? fxDefaults.liquidGlassRefraction : Number(fx.liquidGlassRefraction), 0, 2),
      liquidGlassAberration: clampRange(fx.liquidGlassAberration == null ? fxDefaults.liquidGlassAberration : Number(fx.liquidGlassAberration), 0, 0.5),
      liquidGlassHighlight: clampRange(fx.liquidGlassHighlight == null ? fxDefaults.liquidGlassHighlight : Number(fx.liquidGlassHighlight), 0, 1),
      liquidGlassBrightness: clampRange(fx.liquidGlassBrightness == null ? fxDefaults.liquidGlassBrightness : Number(fx.liquidGlassBrightness), -0.5, 0.5),
      liquidGlassBevel: clampRange(fx.liquidGlassBevel == null ? fxDefaults.liquidGlassBevel : Number(fx.liquidGlassBevel), 0, 60),
      liquidGlassSaturation: clampRange(fx.liquidGlassSaturation == null ? fxDefaults.liquidGlassSaturation : Number(fx.liquidGlassSaturation), 0, 1),
      backgroundColorCustom: fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom,
      backgroundImage: normalizeCustomBackgroundImage(fx.backgroundImage),
      backgroundMedia: normalizeCustomBackgroundMedia(fx.backgroundMedia || fx.backgroundImage),
      backgroundAlbumCover: !!fx.backgroundAlbumCover,
      desktopLyrics: !!fx.desktopLyrics,
      desktopLyricsSize: clampRange(Number(fx.desktopLyricsSize) || fxDefaults.desktopLyricsSize, 0.72, 1.55),
      desktopLyricsOpacity: clampRange(fx.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(fx.desktopLyricsOpacity), 0.28, 1),
      desktopLyricsY: clampRange(fx.desktopLyricsY == null ? fxDefaults.desktopLyricsY : Number(fx.desktopLyricsY), 0.08, 0.92),
      desktopLyricsClickThrough: fx.desktopLyricsClickThrough === true,
      desktopLyricsCinema: fx.desktopLyricsCinema !== false,
      desktopLyricsHighlight: fx.desktopLyricsHighlight === true,
      desktopLyricsFps: normalizeDesktopLyricsFps(fx.desktopLyricsFps),
      performanceBackground: normalizePerformanceBackgroundMode(fx.performanceBackground, fx.liveBackgroundKeep === true),
      performanceQuality: normalizePerformanceQuality(fx.performanceQuality),
      foregroundFpsMode: normalizeForegroundFpsMode(fx.foregroundFpsMode),
      gpuThrottleMode: normalizeGpuThrottleMode(fx.gpuThrottleMode),
      liveBackgroundKeep: normalizePerformanceBackgroundMode(fx.performanceBackground, fx.liveBackgroundKeep === true) === 'keep',
      wallpaperMode: false,
      wallpaperOpacity: clampRange(fx.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(fx.wallpaperOpacity), 0.35, 1),
      coverResolution: normalizeCoverResolution(fx.coverResolution),
      shelf: /^(off|side|stage)$/.test(String(fx.shelf || '')) ? fx.shelf : fxDefaults.shelf,
      shelfCameraMode: normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode),
      shelfPresence: normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence),
      shelfShowPodcasts: fx.shelfShowPodcasts !== false,
      shelfMergeCollections: fx.shelfMergeCollections === true,
      shelfSize: clampRange(fx.shelfSize == null ? fxDefaults.shelfSize : Number(fx.shelfSize), 0.65, 1.45),
      shelfOffsetX: clampRange(fx.shelfOffsetX == null ? fxDefaults.shelfOffsetX : Number(fx.shelfOffsetX), -1.2, 1.2),
      shelfOffsetY: clampRange(fx.shelfOffsetY == null ? fxDefaults.shelfOffsetY : Number(fx.shelfOffsetY), -0.9, 0.9),
      shelfOffsetZ: clampRange(fx.shelfOffsetZ == null ? fxDefaults.shelfOffsetZ : Number(fx.shelfOffsetZ), -0.9, 0.9),
      shelfAngleY: clampRange(fx.shelfAngleY == null ? fxDefaults.shelfAngleY : Number(fx.shelfAngleY), -30, 30),
      shelfAngleYManual: fx.shelfAngleYManual === true,
      shelfOpacity: clampRange(fx.shelfOpacity == null ? fxDefaults.shelfOpacity : Number(fx.shelfOpacity), 0.25, 1),
      shelfBgOpacity: clampRange(fx.shelfBgOpacity == null ? fxDefaults.shelfBgOpacity : Number(fx.shelfBgOpacity), 0.25, 0.98),
      shelfAccentColor: normalizeHexColor(fx.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
      cam: /^(off|gesture)$/.test(String(fx.cam || '')) ? fx.cam : fxDefaults.cam,
      lyricDualLine: fx.lyricDualLine !== false,
      lyricDisplayMode: /^(single|dual|triple|cinema|custom)$/.test(String(fx.lyricDisplayMode)) ? fx.lyricDisplayMode : (fx.lyricDualLine === false ? 'single' : fxDefaults.lyricDisplayMode),
      lyricTranslationMode: /^(off|current|dual|multi)$/.test(String(fx.lyricTranslationMode)) ? fx.lyricTranslationMode : fxDefaults.lyricTranslationMode,
      lyricMotionStyle: /^(float|smooth|glass|shine|glitch)$/.test(String(fx.lyricMotionStyle)) ? fx.lyricMotionStyle : fxDefaults.lyricMotionStyle,
      lyricCustomLines: clampRange(Math.round(Number(fx.lyricCustomLines)) || fxDefaults.lyricCustomLines, 1, 10),
      lyricGlitchPower: clampRange(Number(fx.lyricGlitchPower) || fxDefaults.lyricGlitchPower, 0.14, 1.0),
      lyricGlitchRate: clampRange(Number(fx.lyricGlitchRate) || fxDefaults.lyricGlitchRate, 0.08, 0.54),
      sonicTheme: String(fx.sonicTheme || fxDefaults.sonicTheme || 'cycle'),
      sonicThemeCycleInterval: clampRange(Number(fx.sonicThemeCycleInterval) || fxDefaults.sonicThemeCycleInterval, 8, 180),
      sonicPeakColorEnabled: fx.sonicPeakColorEnabled !== false,
      sonicPeakColorIntensity: clampRange(Number(fx.sonicPeakColorIntensity) || fxDefaults.sonicPeakColorIntensity, 0, 2),
      sonicGridSize: clampRange(Number(fx.sonicGridSize) || fxDefaults.sonicGridSize, 120, 640),
      sonicAudioIntensity: clampRange(Number(fx.sonicAudioIntensity) || fxDefaults.sonicAudioIntensity, 0.3, 2.5),
      sonicResponseRange: clampRange(Number(fx.sonicResponseRange) || fxDefaults.sonicResponseRange, 0.3, 2),
      sonicPulseEnabled: fx.sonicPulseEnabled !== false,
      sonicPulseSensitivity: clampRange(Number(fx.sonicPulseSensitivity) || fxDefaults.sonicPulseSensitivity, 0.05, 0.5),
      sonicPulseCooldown: clampRange(Number(fx.sonicPulseCooldown) || fxDefaults.sonicPulseCooldown, 0, 200),
      sonicMeteorEnabled: fx.sonicMeteorEnabled !== false,
      sonicMeteorSensitivity: clampRange(Number(fx.sonicMeteorSensitivity) || fxDefaults.sonicMeteorSensitivity, 0.1, 0.8),
      sonicMeteorCooldown: clampRange(Number(fx.sonicMeteorCooldown) || fxDefaults.sonicMeteorCooldown, 0, 400),
      sonicMeteorClickEnabled: fx.sonicMeteorClickEnabled !== false,
      sonicIdleWaveEnabled: fx.sonicIdleWaveEnabled !== false,
      sonicIdleWaveDebounce: clampRange(Number(fx.sonicIdleWaveDebounce) || fxDefaults.sonicIdleWaveDebounce, 0.5, 5),
      sonicIdleWaveFadeDuration: clampRange(Number(fx.sonicIdleWaveFadeDuration) || fxDefaults.sonicIdleWaveFadeDuration, 0.5, 5),
      sonicCameraDistance: clampRange(Number(fx.sonicCameraDistance) || fxDefaults.sonicCameraDistance, 40, 120),
      sonicCameraAngleX: clampRange(Number(fx.sonicCameraAngleX) || fxDefaults.sonicCameraAngleX, 0, 360),
      sonicCameraAngleY: clampRange(Number(fx.sonicCameraAngleY) || fxDefaults.sonicCameraAngleY, 0, 90),
      sonicAutoRotateEnabled: fx.sonicAutoRotateEnabled === true,
      sonicAutoRotateSpeed: clampRange(Number(fx.sonicAutoRotateSpeed) || fxDefaults.sonicAutoRotateSpeed, 1, 30),
      rippleColorMode: fx.rippleColorMode === 'custom' ? 'custom' : 'auto',
      rippleColor: normalizeHexColor(fx.rippleColor || fxDefaults.rippleColor || '#9db8cf'),
      rippleSpeed: clampRange(fx.rippleSpeed == null ? fxDefaults.rippleSpeed : Number(fx.rippleSpeed), 0.2, 2.0),
      rippleDensity: clampRange(fx.rippleDensity == null ? fxDefaults.rippleDensity : Number(fx.rippleDensity), 0.5, 2.5),
      rippleBrightness: clampRange(fx.rippleBrightness == null ? fxDefaults.rippleBrightness : Number(fx.rippleBrightness), 0.3, 2.0),
      rippleWidth: clampRange(fx.rippleWidth == null ? fxDefaults.rippleWidth : Number(fx.rippleWidth), 0.5, 2.0),
      rippleRange: clampRange(fx.rippleRange == null ? fxDefaults.rippleRange : Number(fx.rippleRange), 0.5, 2.0),
      classicLyricScale: clampRange(fx.classicLyricScale == null ? fxDefaults.classicLyricScale : Number(fx.classicLyricScale), 0.5, 2.0),
      classicLyricCurvature: clampRange(fx.classicLyricCurvature == null ? fxDefaults.classicLyricCurvature : Number(fx.classicLyricCurvature), -1.5, 1.5),
      classicLyricTiltStrength: clampRange(fx.classicLyricTiltStrength == null ? fxDefaults.classicLyricTiltStrength : Number(fx.classicLyricTiltStrength), 0, 1.5),
      classicLyricArcTilt: fx.classicLyricArcTilt !== false,
      classicLyricOffsetX: clampRange(fx.classicLyricOffsetX == null ? fxDefaults.classicLyricOffsetX : Number(fx.classicLyricOffsetX), -25, 25),
      classicLyricOffsetY: clampRange(fx.classicLyricOffsetY == null ? fxDefaults.classicLyricOffsetY : Number(fx.classicLyricOffsetY), -20, 20),
      classicShowCover: fx.classicShowCover !== false,
      classicShowBg: fx.classicShowBg !== false
    }));
  } catch (e) {}
}
function normalizeHexColor(value, fallback) {
  var hex = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    hex = '#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3);
  }
  fallback = /^#[0-9a-f]{6}$/i.test(String(fallback || '')) ? String(fallback).toLowerCase() : '#a9b8c8';
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : fallback;
}
function parseColorToHex(value, fallback) {
  var s = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ('#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3)).toLowerCase();
  }
  var rgbMatch = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    var r = parseInt(rgbMatch[1], 10), g = parseInt(rgbMatch[2], 10), b = parseInt(rgbMatch[3], 10);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  return fallback != null ? normalizeHexColor(fallback) : '#a9b8c8';
}
function normalizeDesktopLyricsFps(value) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return 0;
  if (n <= 26) return 24;
  if (n <= 45) return 30;
  if (n <= 90) return 60;
  return 120;
}
function normalizeShelfCameraMode(value) {
  return String(value || '') === 'static' ? 'static' : 'dynamic';
}
function shelfDefaultAngleForCameraMode(mode) {
  return normalizeShelfCameraMode(mode) === 'static' ? -15 : 0;
}
function applyShelfCameraDefaultAngle(force) {
  if (!fx) return;
  fx.shelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  if (force || fx.shelfAngleYManual !== true) {
    fx.shelfAngleYManual = false;
    fx.shelfAngleY = shelfDefaultAngleForCameraMode(fx.shelfCameraMode);
  } else {
    fx.shelfAngleY = Math.round(clampRange(Number(fx.shelfAngleY) || 0, -30, 30));
  }
}
function normalizeShelfPresence(value) {
  return String(value || '') === 'always' ? 'always' : 'auto';
}
function normalizedShelfNumber(key, fallback, min, max) {
  var value = fx && fx[key] != null ? Number(fx[key]) : fallback;
  if (!isFinite(value)) value = fallback;
  return clampRange(value, min, max);
}
function shelfSettings() {
  var angleDeg = fx && fx.shelfAngleYManual === true
    ? normalizedShelfNumber('shelfAngleY', shelfDefaultAngleForCameraMode(fx.shelfCameraMode), -30, 30)
    : shelfDefaultAngleForCameraMode(fx && fx.shelfCameraMode);
  return {
    size: normalizedShelfNumber('shelfSize', fxDefaults.shelfSize, 0.65, 1.45),
    x: normalizedShelfNumber('shelfOffsetX', fxDefaults.shelfOffsetX, -1.2, 1.2),
    y: normalizedShelfNumber('shelfOffsetY', fxDefaults.shelfOffsetY, -0.9, 0.9),
    z: normalizedShelfNumber('shelfOffsetZ', fxDefaults.shelfOffsetZ, -0.9, 0.9),
    angle: angleDeg * Math.PI / 180,
    opacity: normalizedShelfNumber('shelfOpacity', fxDefaults.shelfOpacity, 0.25, 1),
    bgOpacity: normalizedShelfNumber('shelfBgOpacity', fxDefaults.shelfBgOpacity, 0.25, 0.98),
    accent: normalizeHexColor((fx && fx.shelfAccentColor) || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor)
  };
}
function shelfAlwaysVisible() {
  return !!(fx && normalizeShelfPresence(fx.shelfPresence) === 'always');
}
function shouldUseShelfDynamicCamera(type) {
  if (!/^shelf-/.test(String(type || ''))) return true;
  return !(fx && normalizeShelfCameraMode(fx.shelfCameraMode) === 'static');
}
function shelfAccentHex() {
  return normalizeHexColor((fx && fx.shelfAccentColor) || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor);
}
function shelfAccentRgba(alpha, fallback) {
  var rgb = hexToRgb(shelfAccentHex());
  if (!rgb) return fallback || 'rgba(244,210,138,' + alpha + ')';
  return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
}
function rgbToHexColor(r, g, b) {
  function part(v) {
    return Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0');
  }
  return '#' + part(r) + part(g) + part(b);
}
