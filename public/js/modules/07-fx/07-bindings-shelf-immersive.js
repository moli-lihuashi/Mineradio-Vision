// =============================================================================
// FX 绑定 / 货架 / 沉浸模式 / 镜头模式
// =============================================================================

function bindFxPanel() {
  liftFxFloatingPopups();
  organizeFxPanel();
  relabelFxPanelControls();
  bindHotkeySettings();
  buildPresetGrid();
  renderUserFxArchives();
  buildLyricColorControls();
  var ids = [
    ['fx-intensity','intensity'],['fx-particlecount','particleCount'],['fx-depth','depth'],['fx-coverres','coverResolution'],['fx-cineshake','cinemaShake'],['fx-lyricglow','lyricGlowStrength'],['fx-bgopacity','backgroundOpacity'],['fx-glassaberration','controlGlassChromaticOffset'],
    ['fx-liquidglassblur','liquidGlassBlur'],['fx-liquidglassrefraction','liquidGlassRefraction'],['fx-liquidglassaberration','liquidGlassAberration'],['fx-liquidglasshighlight','liquidGlassHighlight'],['fx-liquidglassbrightness','liquidGlassBrightness'],['fx-liquidglassbevel','liquidGlassBevel'],['fx-liquidglasssaturation','liquidGlassSaturation'],
    ['fx-desktoplyricssize','desktopLyricsSize'],['fx-desktoplyricsopacity','desktopLyricsOpacity'],['fx-desktoplyricsy','desktopLyricsY'],['fx-wallpaperopacity','wallpaperOpacity'],
    ['fx-shelfsize','shelfSize'],['fx-shelfx','shelfOffsetX'],['fx-shelfy','shelfOffsetY'],['fx-shelfz','shelfOffsetZ'],['fx-shelfangle','shelfAngleY'],['fx-shelfopacity','shelfOpacity'],['fx-shelfbgalpha','shelfBgOpacity'],
    ['fx-lyricspacing','lyricLetterSpacing'],['fx-lyriclineheight','lyricLineHeight'],['fx-lyricweight','lyricWeight'],
    ['fx-lyricscale','lyricScale'],['fx-lyricx','lyricOffsetX'],['fx-lyricy','lyricOffsetY'],['fx-lyricz','lyricOffsetZ'],['fx-lyrictiltx','lyricTiltX'],['fx-lyrictilty','lyricTiltY'],
    ['fx-lyriccustomlines','lyricCustomLines'],['fx-lyricglitchpower','lyricGlitchPower'],['fx-lyricglitchrate','lyricGlitchRate'],
    ['fx-point','point'],['fx-speed','speed'],['fx-twist','twist'],
    ['fx-color','color'],['fx-bloom','bloomStrength'],['fx-scatter','scatter'],['fx-bgfade','bgFade'],
    ['fx-soniccycletime','sonicThemeCycleInterval'],['fx-sonicpeakintensity','sonicPeakColorIntensity'],['fx-sonicgrid','sonicGridSize'],
    ['fx-sonicaudio','sonicAudioIntensity'],['fx-sonicresponse','sonicResponseRange'],['fx-sonicpulse','sonicPulseSensitivity'],
    ['fx-sonicpulsecooldown','sonicPulseCooldown'],['fx-sonicmeteor','sonicMeteorSensitivity'],['fx-sonicmeteocooldown','sonicMeteorCooldown'],
    ['fx-sonicidledebounce','sonicIdleWaveDebounce'],['fx-sonicidlefade','sonicIdleWaveFadeDuration'],
    ['fx-soniccamdist','sonicCameraDistance'],['fx-soniccamx','sonicCameraAngleX'],['fx-soniccamy','sonicCameraAngleY'],
    ['fx-sonicrotatespeed','sonicAutoRotateSpeed'],
    ['fx-sonicglow','sonicGroundGlow'],['fx-sonicfloatcount','sonicGroundFloatingCount'],['fx-sonicfloatintensity','sonicGroundFloatingIntensity'],
    ['fx-sonicfloatmin','sonicGroundFloatingMinSize'],['fx-sonicfloatmax','sonicGroundFloatingMaxSize'],['fx-sonicfloatspeed','sonicGroundFloatingSpeed'],
    ['fx-sonicmotionspeed','sonicGroundMotionSpeed'],['fx-sonicamplitude','sonicGroundAmplitude'],['fx-sonicdensity','sonicGroundDensity'],
    ['fx-sonicrange','sonicGroundRange'],['fx-soniclower','sonicGroundLower'],['fx-sonicdepth','sonicGroundDepth'],
    ['fx-sonicautorate','sonicGroundAutoRotate'],
    ['fx-ripplespeed','rippleSpeed'],['fx-rippledensity','rippleDensity'],
    ['fx-ripplebright','rippleBrightness'],['fx-ripplewidth','rippleWidth'],
    ['fx-ripplerange','rippleRange'],
    ['fx-classiclyricscale','classicLyricScale'],['fx-classiclyriccurve','classicLyricCurvature'],
    ['fx-classiclyrictilt','classicLyricTiltStrength'],
    ['fx-classiclyricx','classicLyricOffsetX'],['fx-classiclyricy','classicLyricOffsetY'],
  ];
  ids.forEach(function(pair){
    var el = document.getElementById(pair[0]);
    if (!el) return;
    ensureFxSliderResetButton(pair[0], pair[1]);
    el.addEventListener('input', function(){
      fx[pair[1]] = parseFloat(el.value);
      var row = getFxSliderRow(el);
      var out = row ? row.querySelector('output') : null;
      if (pair[1] === 'coverResolution') {
        fx.coverResolution = normalizeCoverResolution(fx.coverResolution);
        applyCoverParticleResolution(fx.coverResolution, { reload: true });
      }
      if (pair[1] === 'lyricWeight') fx.lyricWeight = Math.round(clampRange(fx.lyricWeight, 500, 900) / 50) * 50;
      if (pair[1] === 'backgroundOpacity') {
        fx.backgroundOpacity = clampRange(fx.backgroundOpacity, 0, 1);
        fx.backgroundColorMode = 'custom';
        fx.backgroundColorCustom = true;
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'controlGlassChromaticOffset') {
        fx.controlGlassChromaticOffset = normalizeControlGlassChromaticOffset(fx.controlGlassChromaticOffset);
        applyControlGlassChromaticOffset();
      }
      if (/^liquidGlass/.test(pair[1])) {
        if (pair[1] === 'liquidGlassBlur') fx.liquidGlassBlur = clampRange(fx.liquidGlassBlur, 0, 1);
        if (pair[1] === 'liquidGlassRefraction') fx.liquidGlassRefraction = clampRange(fx.liquidGlassRefraction, 0, 2);
        if (pair[1] === 'liquidGlassAberration') fx.liquidGlassAberration = clampRange(fx.liquidGlassAberration, 0, 0.5);
        if (pair[1] === 'liquidGlassHighlight') fx.liquidGlassHighlight = clampRange(fx.liquidGlassHighlight, 0, 1);
        if (pair[1] === 'liquidGlassBrightness') fx.liquidGlassBrightness = clampRange(fx.liquidGlassBrightness, -0.5, 0.5);
        if (pair[1] === 'liquidGlassBevel') fx.liquidGlassBevel = Math.round(clampRange(fx.liquidGlassBevel, 0, 60));
        if (pair[1] === 'liquidGlassSaturation') fx.liquidGlassSaturation = clampRange(fx.liquidGlassSaturation, 0, 1);
        if (window.applyHomeLiquidGlassConfig) window.applyHomeLiquidGlassConfig();
        if (window.applyFxLiquidGlassConfig) window.applyFxLiquidGlassConfig();
      }
      if (pair[1] === 'desktopLyricsSize') fx.desktopLyricsSize = clampRange(fx.desktopLyricsSize, 0.72, 1.55);
      if (pair[1] === 'desktopLyricsOpacity') fx.desktopLyricsOpacity = clampRange(fx.desktopLyricsOpacity, 0.28, 1);
      if (pair[1] === 'desktopLyricsY') fx.desktopLyricsY = clampRange(fx.desktopLyricsY, 0.08, 0.92);
      if (pair[1] === 'wallpaperOpacity') fx.wallpaperOpacity = clampRange(fx.wallpaperOpacity, 0.35, 1);
      if (/^sonic/.test(pair[1])) {
        if (pair[1] === 'sonicThemeCycleInterval') fx.sonicThemeCycleInterval = Math.round(clampRange(fx.sonicThemeCycleInterval, 8, 180));
        if (pair[1] === 'sonicGridSize') fx.sonicGridSize = Math.round(clampRange(fx.sonicGridSize, 120, 640) / 40) * 40;
        if (pair[1] === 'sonicPulseCooldown' || pair[1] === 'sonicMeteorCooldown') fx[pair[1]] = Math.round(fx[pair[1]]);
        if (pair[1] === 'sonicCameraDistance' || pair[1] === 'sonicCameraAngleX' || pair[1] === 'sonicCameraAngleY' || pair[1] === 'sonicAutoRotateSpeed') fx[pair[1]] = Math.round(fx[pair[1]]);
        if (/^sonicGround/.test(pair[1])) fx[pair[1]] = Math.round(clampRange(fx[pair[1]], 0, 100));
        pushSonicFxIfActive();
      }
      if (pair[1] === 'shelfSize') fx.shelfSize = clampRange(fx.shelfSize, 0.65, 1.45);
      if (pair[1] === 'shelfOffsetX') fx.shelfOffsetX = clampRange(fx.shelfOffsetX, -1.2, 1.2);
      if (pair[1] === 'shelfOffsetY') fx.shelfOffsetY = clampRange(fx.shelfOffsetY, -0.9, 0.9);
      if (pair[1] === 'shelfOffsetZ') fx.shelfOffsetZ = clampRange(fx.shelfOffsetZ, -0.9, 0.9);
      if (pair[1] === 'shelfAngleY') {
        fx.shelfAngleYManual = true;
        fx.shelfAngleY = Math.round(clampRange(fx.shelfAngleY, -30, 30));
      }
      if (pair[1] === 'shelfOpacity') fx.shelfOpacity = clampRange(fx.shelfOpacity, 0.25, 1);
      if (pair[1] === 'shelfBgOpacity') fx.shelfBgOpacity = clampRange(fx.shelfBgOpacity, 0.25, 0.98);
      if (pair[1] === 'lyricOffsetX') fx.lyricOffsetX = clampRange(fx.lyricOffsetX, -4.0, 4.0);
      if (pair[1] === 'lyricOffsetY') fx.lyricOffsetY = clampRange(fx.lyricOffsetY, -2.4, 2.7);
      if (pair[1] === 'lyricOffsetZ') fx.lyricOffsetZ = clampRange(fx.lyricOffsetZ, -3.2, 3.2);
      if (pair[1] === 'lyricTiltX' || pair[1] === 'lyricTiltY') fx[pair[1]] = Math.round(clampRange(fx[pair[1]], -84, 84));
      if (pair[1] === 'lyricCustomLines') fx.lyricCustomLines = Math.round(clampRange(fx.lyricCustomLines, 1, 10));
      if (pair[1] === 'lyricGlitchPower') fx.lyricGlitchPower = clampRange(fx.lyricGlitchPower, 0.14, 1.0);
      if (pair[1] === 'lyricGlitchRate') fx.lyricGlitchRate = clampRange(fx.lyricGlitchRate, 0.08, 0.54);
      if (/^classicLyric/.test(pair[1])) {
        if (pair[1] === 'classicLyricScale') fx.classicLyricScale = clampRange(fx.classicLyricScale, 0.5, 2.0);
        if (pair[1] === 'classicLyricCurvature') fx.classicLyricCurvature = clampRange(fx.classicLyricCurvature, -1.5, 1.5);
        if (pair[1] === 'classicLyricTiltStrength') fx.classicLyricTiltStrength = clampRange(fx.classicLyricTiltStrength, 0, 1.5);
        if (pair[1] === 'classicLyricOffsetX') fx.classicLyricOffsetX = clampRange(fx.classicLyricOffsetX, -25, 25);
        if (pair[1] === 'classicLyricOffsetY') fx.classicLyricOffsetY = clampRange(fx.classicLyricOffsetY, -20, 20);
        applyClassicPlayerSettings();
        if (classicPlayer.active) {
          var cpLines = document.querySelectorAll('#cp-lyrics .cp-lyric-line');
          applyClassicLyricCurve(cpLines, classicPlayer.currentLyricIdx, document.getElementById('cp-lyrics-wrap'));
        }
      }
      if (out) out.textContent = pair[1] === 'coverResolution'
        ? coverParticleCountLabel(fx.coverResolution)
        : (pair[1] === 'lyricWeight' || pair[1] === 'controlGlassChromaticOffset' || pair[1] === 'liquidGlassBevel' || pair[1] === 'lyricTiltX' || pair[1] === 'lyricTiltY' || pair[1] === 'shelfAngleY' || pair[1] === 'lyricCustomLines' ? String(Math.round(fx[pair[1]])) : Number(el.value).toFixed(pair[1] === 'lyricLetterSpacing' ? 3 : 2));
      if (pair[1] === 'particleCount') updateFxParticleFireSliderVisual(fx.particleCount);
      syncFxUniforms();
      if (/^shelf(Size|OffsetX|OffsetY|OffsetZ|AngleY|Opacity|BgOpacity)$/.test(pair[1]) && shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
      if (pair[1] === 'lyricLetterSpacing' || pair[1] === 'lyricLineHeight' || pair[1] === 'lyricWeight') refreshCurrentLyricStyle();
      if (pair[1] === 'lyricLetterSpacing' || pair[1] === 'lyricLineHeight' || pair[1] === 'lyricWeight' || pair[1] === 'lyricScale' || pair[1] === 'lyricGlowStrength') pushDesktopLyricsState(true);
      if (/^(desktopLyricsSize|desktopLyricsOpacity|desktopLyricsY)$/.test(pair[1])) pushDesktopLyricsState(true);
      if (pair[1] === 'wallpaperOpacity') pushWallpaperState(true);
      saveLyricLayout();
    });
  });
  var lyricPicker = document.getElementById('lyric-color-picker');
  if (lyricPicker) {
    lyricPicker.addEventListener('input', function(){ setLyricColorCustom(lyricPicker.value, true); });
    lyricPicker.addEventListener('change', function(){ showToast('歌词颜色: ' + normalizeHexColor(lyricPicker.value).toUpperCase()); });
  }
  var lyricHighlightPicker = document.getElementById('lyric-highlight-picker');
  if (lyricHighlightPicker) {
    lyricHighlightPicker.addEventListener('input', function(){ setLyricHighlightCustom(lyricHighlightPicker.value, true); });
    lyricHighlightPicker.addEventListener('change', function(){ showToast('高亮颜色: ' + normalizeHexColor(lyricHighlightPicker.value).toUpperCase()); });
  }
  var lyricGlowPicker = document.getElementById('lyric-glow-picker');
  if (lyricGlowPicker) {
    lyricGlowPicker.addEventListener('input', function(){ setLyricGlowCustom(lyricGlowPicker.value, true); });
    lyricGlowPicker.addEventListener('change', function(){ showToast('溢光颜色: ' + normalizeHexColor(lyricGlowPicker.value).toUpperCase()); });
  }
  var uiAccentPicker = document.getElementById('ui-accent-picker');
  if (uiAccentPicker) {
    uiAccentPicker.addEventListener('input', function(){ setUiAccentColor(uiAccentPicker.value, true); });
    uiAccentPicker.addEventListener('change', function(){ showToast('界面高亮: ' + normalizeHexColor(uiAccentPicker.value, '#00f5d4').toUpperCase()); });
  }
  var visualTintPicker = document.getElementById('visual-tint-picker');
  if (visualTintPicker) {
    visualTintPicker.addEventListener('input', function(){ setVisualTintCustom(visualTintPicker.value, true); });
    visualTintPicker.addEventListener('change', function(){ showToast('视觉主色: ' + normalizeHexColor(visualTintPicker.value).toUpperCase()); });
  }
  var homeAccentPicker = document.getElementById('home-accent-picker');
  if (homeAccentPicker) {
    homeAccentPicker.addEventListener('input', function(){ setHomeAccentColor(homeAccentPicker.value, true); });
    homeAccentPicker.addEventListener('change', function(){ showToast('Home 填充: ' + normalizeHexColor(homeAccentPicker.value).toUpperCase()); });
  }
  var homeIconPicker = document.getElementById('home-icon-picker');
  if (homeIconPicker) {
    homeIconPicker.addEventListener('input', function(){ setHomeIconColor(homeIconPicker.value, true); });
    homeIconPicker.addEventListener('change', function(){ showToast('主页图标: ' + normalizeHexColor(homeIconPicker.value, '#f4d28a').toUpperCase()); });
  }
  var visualIconPicker = document.getElementById('visual-icon-picker');
  if (visualIconPicker) {
    visualIconPicker.addEventListener('input', function(){ setVisualIconColor(visualIconPicker.value, true); });
    visualIconPicker.addEventListener('change', function(){ showToast('视觉图标: ' + normalizeHexColor(visualIconPicker.value, '#7fd8ff').toUpperCase()); });
  }
  var bgColorPicker = document.getElementById('bg-color-picker');
  if (bgColorPicker) {
    bgColorPicker.addEventListener('input', function(){ setCustomBackgroundColor(bgColorPicker.value, true); });
    bgColorPicker.addEventListener('change', function(){ showToast('背景颜色: ' + normalizeHexColor(bgColorPicker.value, '#000000').toUpperCase()); });
  }
  var shelfAccentPicker = document.getElementById('shelf-accent-picker');
  if (shelfAccentPicker) {
    shelfAccentPicker.addEventListener('input', function(){ setShelfAccentColor(shelfAccentPicker.value, true); });
    shelfAccentPicker.addEventListener('change', function(){ showToast('歌单架颜色: ' + shelfAccentHex().toUpperCase()); });
  }
  var bgImageInput = document.getElementById('background-image-input');
  if (bgImageInput) {
    bgImageInput.addEventListener('change', function(e){
      var file = e.target.files && e.target.files[0];
      if (file) readBackgroundMediaFile(file);
      e.target.value = '';
    });
  }
  ['ui-accent-picker','visual-tint-picker','home-accent-picker','home-icon-picker','visual-icon-picker','bg-color-picker','shelf-accent-picker','lyric-color-picker','lyric-highlight-picker','lyric-glow-picker'].forEach(function(id){
    bindColorLabPicker(document.getElementById(id));
  });
  bindColorLabRows();
  var sv = document.getElementById('color-lab-sv');
  if (sv && !sv._bound) {
    sv._bound = true;
    sv.addEventListener('pointerdown', function(e){
      e.preventDefault();
      colorLabState.dragging = true;
      sv.setPointerCapture && sv.setPointerCapture(e.pointerId);
      updateColorLabFromSv(e);
    });
    sv.addEventListener('pointermove', function(e){ if (colorLabState.dragging) updateColorLabFromSv(e); });
    sv.addEventListener('pointerup', function(){ colorLabState.dragging = false; });
    sv.addEventListener('pointercancel', function(){ colorLabState.dragging = false; });
  }
  var hue = document.getElementById('color-lab-hue');
  if (hue && !hue._bound) {
    hue._bound = true;
    hue.addEventListener('input', function(){
      colorLabState.h = clampRange(Number(hue.value) || 0, 0, 360) / 360;
      var hex = hsvToHex(colorLabState.h, colorLabState.s, colorLabState.v);
      syncColorLabUi(hex);
      applyColorLabValue(hex, true);
    });
  }
  var hexInput = document.getElementById('color-lab-hex');
  if (hexInput && !hexInput._bound) {
    hexInput._bound = true;
    hexInput.addEventListener('change', function(){
      var hex = normalizeHexColor(hexInput.value || '#000000', '#000000');
      syncColorLabUi(hex);
      applyColorLabValue(hex);
    });
  }
  var presets = document.getElementById('color-lab-presets');
  if (presets && !presets._bound) {
    presets._bound = true;
    presets.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('[data-color]') : null;
      if (!btn) return;
      var hex = normalizeHexColor(btn.getAttribute('data-color') || '#000000', '#000000');
      syncColorLabUi(hex);
      applyColorLabValue(hex);
    });
  }
  if (!document._colorLabOutsideBound) {
    document._colorLabOutsideBound = true;
    document.addEventListener('mousedown', function(e){
      var pop = document.getElementById('color-lab-pop');
      if (!pop || !pop.classList.contains('show')) return;
      if (e.target && (e.target.closest('#color-lab-pop') || e.target.closest('.lyric-color-picker') || e.target.closest('.lyric-color-row'))) return;
      closeColorLab();
    }, true);
    document.addEventListener('mousedown', function(e){
      var pop = document.getElementById('cover-color-pop');
      if (!pop || !pop.classList.contains('show')) return;
      if (e.target && (e.target.closest('#cover-color-pop') || e.target.closest('#visual-tint-auto-btn'))) return;
      closeCoverColorPicker();
    }, true);
  }
  // 三态
  document.querySelectorAll('#shelf-seg button').forEach(function(b){
    b.addEventListener('click', function(){ setShelfMode(b.dataset.shelf); });
  });
  document.querySelectorAll('#shelf-camera-seg [data-shelf-camera]').forEach(function(b){
    b.addEventListener('click', function(){ setShelfCameraMode(b.getAttribute('data-shelf-camera')); });
  });
  document.querySelectorAll('#shelf-presence-seg [data-shelf-presence]').forEach(function(b){
    b.addEventListener('click', function(){ setShelfPresence(b.getAttribute('data-shelf-presence')); });
  });
  document.querySelectorAll('#cam-seg button').forEach(function(b){
    b.addEventListener('click', function(){ setCamMode(b.dataset.cam); });
  });
  document.querySelectorAll('#desktop-lyrics-fps-seg [data-desktop-lyrics-fps]').forEach(function(btn){
    btn.addEventListener('click', function(){
      fx.desktopLyricsFps = normalizeDesktopLyricsFps(btn.getAttribute('data-desktop-lyrics-fps'));
      updateDesktopLyricsFpsControls();
      saveLyricLayout();
      pushDesktopLyricsState(true);
      showToast(fx.desktopLyricsFps ? ('桌面歌词帧数 ' + fx.desktopLyricsFps) : '桌面歌词帧数无上限');
    });
  });
  document.querySelectorAll('#performance-background-seg [data-performance-background]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setPerformanceBackgroundMode(btn.getAttribute('data-performance-background'));
    });
  });
  document.querySelectorAll('#performance-quality-seg [data-performance-quality]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setPerformanceQualityMode(btn.getAttribute('data-performance-quality'));
    });
  });
  document.querySelectorAll('#foreground-fps-seg [data-foreground-fps]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setForegroundFpsMode(btn.getAttribute('data-foreground-fps'));
    });
  });
  document.querySelectorAll('#gpu-throttle-seg [data-gpu-throttle]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setGpuThrottleMode(btn.getAttribute('data-gpu-throttle'));
    });
  });
  document.querySelectorAll('#close-behavior-seg [data-close-behavior]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setCloseBehaviorMode(btn.getAttribute('data-close-behavior'));
    });
  });
  initDesktopIntegrationControls();
  updateFxInputs();
  initFxParticleFireSlider();
  scheduleFxParticleFireRefresh();
}
function toggleFx(key) {
  if (isDevelopmentLockedFx(key)) {
    normalizeDevelopmentLockedFxState();
    saveLyricLayout();
    updateFxInputs();
    applyDesktopLyricsState(true);
    applyWallpaperModeState(true);
    showToast('开发中，暂不可用');
    return;
  }
  fx[key] = (key === 'classicLyricArcTilt') ? (fx[key] === false) : !fx[key];
  var toggleId = 't-' + (key === 'floatLayer' ? 'float' : key === 'aiDepth' ? 'aidepth' : key);
  var toggle = document.getElementById(toggleId);
  if (toggle) {
    if (key === 'classicShowCover' || key === 'classicShowBg' || key === 'classicLyricArcTilt') toggle.classList.toggle('on', fx[key] !== false);
    else toggle.classList.toggle('on', fx[key]);
  }
  syncFxUniforms();
  if (key === 'lyricCameraLock' || key === 'lyricGlow' || key === 'lyricGlowBeat' || key === 'lyricGlowParticles' || key === 'backgroundStarRiver' || key === 'lyricVerticalFloat' || key === 'lyricPauseHold' || key === 'bloom' || key === 'edge' || key === 'cinema' || key === 'desktopLyrics' || key === 'desktopLyricsClickThrough' || key === 'desktopLyricsCinema' || key === 'desktopLyricsHighlight' || key === 'wallpaperMode' || key === 'shelfShowPodcasts' || key === 'shelfMergeCollections' || key === 'liveBackgroundKeep' || key === 'classicShowCover' || key === 'classicShowBg' || key === 'classicLyricArcTilt' || /^sonic/.test(key)) saveLyricLayout();
  if (key === 'floatLayer') { if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer(); }
  if (key === 'desktopLyrics') applyDesktopLyricsState(true);
  if (key === 'desktopLyricsClickThrough' || key === 'desktopLyricsCinema' || key === 'desktopLyricsHighlight') pushDesktopLyricsState(true);
  if (key === 'lyricGlow' || key === 'lyricGlowBeat' || key === 'lyricGlowParticles') pushDesktopLyricsState(true);
  if (key === 'wallpaperMode') applyWallpaperModeState(true);
  if (key === 'shelfShowPodcasts' || key === 'shelfMergeCollections') {
    if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
    if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  }
  if (key === 'classicShowCover' || key === 'classicShowBg') {
    applyClassicPlayerSettings();
    if (key === 'classicShowCover') showToast(fx.classicShowCover !== false ? '经典封面已显示' : '经典封面已隐藏');
    if (key === 'classicShowBg') showToast(fx.classicShowBg !== false ? '经典背景已显示' : '经典背景已隐藏');
  }
  if (key === 'classicLyricArcTilt' && classicPlayer.active) {
    syncClassicLyricInsets();
    var cpLines = document.querySelectorAll('#cp-lyrics .cp-lyric-line');
    applyClassicLyricCurve(cpLines, classicPlayer.currentLyricIdx, document.getElementById('cp-lyrics-wrap'));
    showToast(fx.classicLyricArcTilt !== false ? '弧线倾斜已开启' : '弧线倾斜已关闭');
  }
  if (key === 'liveBackgroundKeep') {
    fx.performanceBackground = fx.liveBackgroundKeep ? 'keep' : 'auto';
    updatePerformanceControls();
    saveLyricLayout();
    if (fx.liveBackgroundKeep && backgroundCacheTrimTimer) {
      clearTimeout(backgroundCacheTrimTimer);
      backgroundCacheTrimTimer = 0;
    }
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (fx.liveBackgroundKeep) recoverVisualsAfterBackground('live-background-keep');
  }
  if (key === 'lyricGlow') showToast(fx.lyricGlow ? '歌词溢光已开启' : '歌词溢光已关闭');
  if (key === 'lyricGlowBeat') showToast(fx.lyricGlowBeat ? '歌词溢光跟随鼓点' : '歌词溢光已脱离鼓点');
  if (key === 'lyricGlowParticles') showToast(fx.lyricGlowParticles ? '歌词光粒已开启' : '歌词光粒已关闭');
  if (key === 'backgroundStarRiver') showToast(fx.backgroundStarRiver ? '背景星河已开启' : '背景星河已关闭');
  if (key === 'lyricVerticalFloat') showToast(fx.lyricVerticalFloat ? '歌词上下浮动已开启' : '歌词上下浮动已关闭');
  if (key === 'lyricPauseHold') showToast(fx.lyricPauseHold ? '暂停时保留歌词' : '暂停时隐藏歌词');
  if (key === 'desktopLyrics') showToast(fx.desktopLyrics ? '桌面歌词已开启' : '桌面歌词已关闭');
  if (key === 'desktopLyricsClickThrough') showToast(fx.desktopLyricsClickThrough !== false ? '桌面歌词已锁定' : '桌面歌词可移动');
  if (key === 'desktopLyricsCinema') showToast(fx.desktopLyricsCinema !== false ? '桌面歌词电影震动已开启' : '桌面歌词电影震动已关闭，基础漂浮保留');
  if (key === 'desktopLyricsHighlight') showToast(fx.desktopLyricsHighlight === true ? '桌面歌词高亮跟随已开启' : '桌面歌词高亮跟随已关闭');
  if (key === 'wallpaperMode') showToast(fx.wallpaperMode ? '壁纸模式已开启' : '壁纸模式已关闭');
  if (key === 'shelfShowPodcasts') showToast(fx.shelfShowPodcasts !== false ? '3D歌单架已显示播客歌单' : '3D歌单架已隐藏播客歌单');
  if (key === 'shelfMergeCollections') showToast(fx.shelfMergeCollections === true ? '我的歌单与收藏歌单已合并滚动' : '收藏歌单恢复滚到底切页');
  if (key === 'liveBackgroundKeep') showToast(fx.liveBackgroundKeep ? '直播后台保持已开启' : '直播后台保持已关闭');
  if (key === 'lyricCameraLock') showToast(fx.lyricCameraLock ? '歌词已绑定镜头' : '歌词已恢复自由漂浮');
  if (/^sonic/.test(key)) pushSonicFxIfActive();
  if (key === 'sonicAudioMonitorEnabled') setSonicAudioMonitorPanelOpen(!!fx.sonicAudioMonitorEnabled);
  if (key === 'bloom') showToast(fx.bloom ? '溢光已开启' : '溢光已关闭');
  if (key === 'edge') showToast(fx.edge ? '已开启轮廓高亮' : '已关闭轮廓高亮');
  if (key === 'cinema') showToast(fx.cinema ? '已开启电影镜头' : '已关闭电影镜头');
  if (key === 'aiDepth') {
    if (fx.aiDepth) {
      aiDepthFailUntil = 0;
      queueAIDepthForCurrentCover(true);
    }
    showToast(fx.aiDepth ? '已开启后台 AI 立体增强' : '已关闭 AI 立体增强, 使用轻量弧面');
  }
}
function toggleFxPanel(force) {
  var el = document.getElementById('fx-panel');
  if (!el) return;
  if (!diyPlayerMode && force !== false) {
    showToast('开启 DIY 玩家模式后可打开视觉控制台');
    return;
  }
  var currentlyOpen = el.classList.contains('show') || el.classList.contains('peek');
  if (peekTimers && peekTimers.fx) { clearTimeout(peekTimers.fx); peekTimers.fx = null; }
  fxPanelPinned = false;
  if (force === false) {
    if (currentlyOpen && window.MineradioMotion && typeof window.MineradioMotion.springUiOut === 'function') {
      window.MineradioMotion.springUiOut(el, {
        toX: 0,
        toY: 12,
        toScale: 0.97,
        preset: window.MineradioMotion.SPRING.snappy,
        onComplete: function () {
          el.classList.remove('show', 'peek', 'closing');
        }
      });
    } else {
      el.classList.remove('show', 'peek');
      el.classList.toggle('closing', currentlyOpen);
      setTimeout(function(){ el.classList.remove('closing'); }, 280);
    }
    var fab = document.getElementById('fx-fab');
    if (fab) fab.classList.remove('active');
    closeColorLab();
    return;
  }
  closePlayerQuickMenu();
  el.classList.remove('show', 'closing');
  setPeek(el, true, 'fx');
}
function toggleFxPanelPin(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!diyPlayerMode) {
    showToast('请先点击标题栏 DIY 开启玩家模式');
    return;
  }
  var el = document.getElementById('fx-panel');
  var fab = document.getElementById('fx-fab');
  if (!el) return;
  if (el.classList.contains('show')) {
    fxPanelPinned = false;
    toggleFxPanel(false);
    return;
  }
  if (peekTimers && peekTimers.fx) { clearTimeout(peekTimers.fx); peekTimers.fx = null; }
  closePlayerQuickMenu();
  el.classList.remove('closing', 'peek');
  el.classList.add('show');
  if (window.MineradioMotion && typeof window.MineradioMotion.springUiIn === 'function') {
    window.MineradioMotion.springUiIn(el, {
      fromX: 0,
      fromY: 14,
      fromScale: 0.97,
      fromOpacity: 0.88,
      preset: window.MineradioMotion.SPRING.standard
    });
  }
  fxPanelPinned = true;
  document.body.classList.add('fx-fab-peek');
  if (fab) fab.classList.add('active');
  scheduleFxParticleFireRefresh();
}
(function(){
  var fxPanel = document.getElementById('fx-panel');
  if (!fxPanel || !('MutationObserver' in window)) return;
  var lastVisible = fxPanel.classList.contains('show') || fxPanel.classList.contains('peek');
  var obs = new MutationObserver(function(){
    var visible = fxPanel.classList.contains('show') || fxPanel.classList.contains('peek');
    if (lastVisible && !visible) closeColorLab();
    lastVisible = visible;
  });
  obs.observe(fxPanel, { attributes: true, attributeFilter: ['class'] });
})();
function resetFx() {
  var savedCam = fx.cam;
  var savedShelf = fx.shelf;
  var savedShelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  var savedShelfPresence = normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence);
  fx = Object.assign({}, fxDefaults, {
    cam: savedCam,
    shelf: savedShelf,
    shelfCameraMode: savedShelfCameraMode,
    shelfPresence: savedShelfPresence,
    shelfAngleY: shelfDefaultAngleForCameraMode(savedShelfCameraMode),
    shelfAngleYManual: false
  });
  applyCoverParticleResolution(fx.coverResolution, { reload: true });
  updateFxInputs();
  applyDesktopLyricsState(true);
  applyWallpaperModeState(true);
  updateRenderPowerClasses();
  applyRendererPowerMode();
  setStageLyricPalette(stageLyrics.coverPalette || stageLyrics.palette);
  setPreset(fx.preset, { silent: true, preserveCamera: true, skipTransition: true });
  if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer();
  if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  saveLyricLayout();
  showToast('已恢复默认参数');
}

function setShelfMode(m) {
  m = /^(off|side|stage)$/.test(String(m || '')) ? m : fxDefaults.shelf;
  fx.shelf = m;
  document.querySelectorAll('#shelf-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.shelf === m); });
  if (shelfManager) shelfManager.setMode(m);
  // 舞台模式: 顶部搜索、底部控件让位
  var searchArea = document.getElementById('search-area');
  var bottomBar = document.getElementById('bottom-bar');
  if (searchArea) searchArea.classList.toggle('stage-mode', m === 'stage');
  if (bottomBar) bottomBar.classList.toggle('stage-mode', m === 'stage');
  saveLyricLayout();
}

function updateShelfControlUi() {
  fx.shelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  fx.shelfPresence = normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence);
  document.querySelectorAll('#shelf-camera-seg [data-shelf-camera]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-shelf-camera') === fx.shelfCameraMode);
  });
  document.querySelectorAll('#shelf-presence-seg [data-shelf-presence]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-shelf-presence') === fx.shelfPresence);
  });
  var color = shelfAccentHex();
  var picker = document.getElementById('shelf-accent-picker');
  var value = document.getElementById('shelf-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}
function refreshShelfVisuals(reason) {
  updateShelfControlUi();
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  if (shelfManager && shelfManager.rebuild && reason === 'mode') shelfManager.rebuild(true);
}
function setShelfCameraMode(mode) {
  fx.shelfCameraMode = normalizeShelfCameraMode(mode);
  applyShelfCameraDefaultAngle(true);
  setRange('fx-shelfangle', fx.shelfAngleY);
  updateShelfControlUi();
  if (fx.shelfCameraMode === 'static' && orbit && orbit.focus && /^shelf-/.test(String(orbit.focus.type || ''))) {
    setFocusZone(null, true);
  }
  saveLyricLayout();
  showToast(fx.shelfCameraMode === 'static' ? '3D歌单架: 静态镜头' : '3D歌单架: 动态镜头');
}
function setShelfPresence(mode) {
  fx.shelfPresence = normalizeShelfPresence(mode);
  updateShelfControlUi();
  if (shelfManager && shelfManager.setMode) shelfManager.setMode(fx.shelf);
  if (fx.shelfPresence === 'auto' && !shelfPinnedOpen) {
    shelfHoverCue.target = 0;
  }
  saveLyricLayout();
  showToast(fx.shelfPresence === 'always' ? '3D歌单架: 常驻' : '3D歌单架: 自动隐藏');
}
function setShelfAccentColor(color, silent) {
  fx.shelfAccentColor = normalizeHexColor(color || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor);
  refreshShelfVisuals('color');
  saveLyricLayout();
  if (!silent) showToast('歌单架颜色: ' + fx.shelfAccentColor.toUpperCase());
}
function resetShelfAccentColor() {
  setShelfAccentColor(fxDefaults.shelfAccentColor || '#f4d28a');
}

function syncControlsAutoHideButton() {
  var btn = document.getElementById('controls-hide-btn');
  if (btn) {
    btn.classList.toggle('active', !!controlsAutoHide);
    btn.title = controlsAutoHide ? '控制条自动隐藏：开启' : '控制条自动隐藏：关闭';
  }
  if (!controlsAutoHide && controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }
}

function setParticleLyricsSilently(on) {
  fx.particleLyrics = !!on;
  if (fx.particleLyrics) createLyricsParticles();
  else clearStageLyrics();
  lyricsVisible = fx.particleLyrics;
  updatePlayerQuickMenuUi();
}

function updateImmersiveButton() {
  var btn = document.getElementById('immersive-btn');
  if (!btn) return;
  btn.classList.toggle('active', immersiveMode);
  btn.setAttribute('aria-pressed', immersiveMode ? 'true' : 'false');
  btn.title = immersiveMode ? '退出全沉浸式' : '全沉浸式';
  btn.setAttribute('aria-label', btn.title);
  if (window.MineradioMotion && typeof window.MineradioMotion.springTap === 'function') {
    window.MineradioMotion.springTap(btn, { dip: 0.1 });
  }
}

function closeImmersiveInterference() {
  closeMiniQueue();
  toggleFxPanel(false);
  closeUploadTip(false);
  closeLoginModal();
  closeUserModal();
  closeCollectModal();
  closeCoverCropModal();
  closeCustomLyricModal();
  closeTrackDetailModal();
  if (!localBeatAnalysis.active) closeLocalBeatModal();
  ['search-area', 'fx-panel', 'trial-banner', 'ai-depth-chip', 'beat-chip'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.classList.remove('peek', 'show', 'closing');
  });
  var fab = document.getElementById('fx-fab');
  if (fab) fab.classList.remove('active');
  document.body.classList.remove('login-guide-active');
  setFocusZone(null, true);
}

function setImmersiveMode(on) {
  on = !!on;
  if (immersiveMode === on) return;

  if (on) {
    immersiveState = {
      shelfMode: fx.shelf,
      shelfPinnedOpen: shelfPinnedOpen,
      lyrics: fx.particleLyrics,
      controlsAutoHide: controlsAutoHide,
      bottomVisible: !!(document.getElementById('bottom-bar') && document.getElementById('bottom-bar').classList.contains('visible'))
    };
    immersiveMode = true;
    document.body.classList.add('immersive-mode');
    var bottomBarEnter = document.getElementById('bottom-bar');
    if (bottomBarEnter) bottomBarEnter.classList.add('visible');
    closeImmersiveInterference();
    if (!fx.particleLyrics && !isClassicPresetActive()) setParticleLyricsSilently(true);
    updatePlayerQuickMenuUi();
    controlsAutoHide = true;
    syncControlsAutoHideButton();
    updateImmersiveButton();
    syncCursorAutoHideMode();
    revealBottomControls(720);
    setTimeout(function(){
      if (immersiveMode && !controlsHovering) setControlsHidden(true);
    }, 980);
    return;
  }

  immersiveMode = false;
  document.body.classList.remove('immersive-mode');
  closeMiniQueue();
  if (immersiveState.shelfMode) setShelfMode(immersiveState.shelfMode);
  if (immersiveState.shelfMode === 'side' && immersiveState.shelfPinnedOpen) setShelfPinnedOpen(true, true);
  else setShelfPinnedOpen(false, true);
  if (immersiveState.lyrics === false) setParticleLyricsSilently(false);
  controlsAutoHide = immersiveState.controlsAutoHide !== false;
  syncControlsAutoHideButton();
  updateImmersiveButton();
  syncCursorAutoHideMode();
  var bottomBarExit = document.getElementById('bottom-bar');
  if (immersiveState.bottomVisible) revealBottomControls(900);
  else if (bottomBarExit) bottomBarExit.classList.remove('visible', 'soft-hidden');
  showToast('已退出全沉浸式');
}

function toggleImmersiveMode() {
  setImmersiveMode(!immersiveMode);
}

function setCamMode(m) {
  if (m === 'head') m = 'gesture'; // v8: 头部追踪已下线, 兼容旧设置
  fx.cam = m;
  document.querySelectorAll('#cam-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.cam === m); });
  if (m === 'off') stopGestureControl();
  else if (m === 'gesture') startGestureControl();
  saveLyricLayout();
}

