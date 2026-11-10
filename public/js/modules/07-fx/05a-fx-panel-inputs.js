var homeWaveTrackState = { bars: 0, smooth: [] };
function ensureHomeWaveTrackBars() {
  var el = document.getElementById('home-wave-track');
  if (!el) return;
  var count = 24;
  if (homeWaveTrackState.bars === count && el.children.length === count) return;
  homeWaveTrackState.bars = count;
  homeWaveTrackState.smooth = new Array(count).fill(0);
  el.innerHTML = new Array(count + 1).join('<span></span>');
}
function updateHomeAudioVisual(dt) {
  if (!emptyHomeActive) return;
  var wave = document.getElementById('home-wave-track');
  if (!wave) return;
  var nowMs = performance.now();
  if (homeWaveTrackState.lastAt && nowMs - homeWaveTrackState.lastAt < 80) return;
  homeWaveTrackState.lastAt = nowMs;
  ensureHomeWaveTrackBars();
  var bars = wave.children;
  var nowT = uniforms && uniforms.uTime ? uniforms.uTime.value : performance.now() / 1000;
  for (var i = 0; i < bars.length; i++) {
    var ratio = bars.length > 1 ? i / (bars.length - 1) : 0;
    var bin = 0;
    if (frequencyData && frequencyData.length) {
      bin = (frequencyData[Math.min(frequencyData.length - 1, Math.floor(Math.pow(ratio, 1.2) * (frequencyData.length - 1)))] || 0) / 255;
    } else {
      bin = 0.16 + Math.sin(nowT * 1.4 + i * 0.34) * 0.06;
    }
    var target = clampRange(Math.max(bin, smoothBass * 0.35 + smoothMid * 0.18 + beatPulse * 0.24), 0.03, 1);
    var prev = homeWaveTrackState.smooth[i] || 0;
    prev += (target - prev) * (target > prev ? 0.34 : 0.12);
    homeWaveTrackState.smooth[i] = prev;
    bars[i].style.height = Math.max(4, prev * 18) + 'px';
    bars[i].style.opacity = String(clampRange(0.36 + prev * 0.68, 0.32, 1));
  }
}
function getFxSliderRow(el) {
  return el && el.closest ? el.closest('.fx-slider') : null;
}
function particleCountToNorm(value) {
  return clampRange((Number(value) - 0.3) / 0.7, 0, 1);
}
/* 滑块右侧读数：桌面歌词这组用 px / % / °，比裸小数直观，
 * 也让「拖了到底有没有生效」一眼可见。启动刷新和拖动都要走这里，避免两套格式。 */
function fxSliderReadout(id, value) {
  var num = Number(value);
  if (!isFinite(num)) num = 0;
  if (id === 'fx-coverres') return coverParticleCountLabel(num);
  if (id === 'fx-desktoplyricssize') {
    return Math.round(DESKTOP_LYRICS_BASE_FONT * clampRange(num, DESKTOP_LYRICS_SIZE_MIN, DESKTOP_LYRICS_SIZE_MAX)) + 'px';
  }
  if (id === 'fx-desktoplyricsopacity') return Math.round(clampRange(num, 0.28, 1) * 100) + '%';
  if (id === 'fx-desktoplyricstilt') return Math.round(num) + '°';
  if (id === 'fx-lyricweight' || id === 'fx-glassaberration' || id === 'fx-lyrictiltx'
    || id === 'fx-lyrictilty' || id === 'fx-shelfangle' || id === 'fx-lyriccustomlines'
    || id === 'fx-liquidglassbevel' || id === 'fx-liquidglassshadowspread' || id === 'fx-liquidglassbevelmode') {
    return String(Math.round(num));
  }
  return num.toFixed(id === 'fx-lyricspacing' ? 3 : 2);
}
function setRange(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (id === 'fx-lyricglow') value = Math.min(0.85, Math.max(0, value));
  if (id === 'fx-coverres') value = normalizeCoverResolution(value);
  if (id === 'fx-glassaberration') value = normalizeControlGlassChromaticOffset(value);
  el.value = value;
  var row = getFxSliderRow(el);
  var out = row ? row.querySelector('output') : null;
  if (out) out.textContent = fxSliderReadout(id, value);
  if (id === 'fx-particlecount') updateFxParticleFireSliderVisual(value);
  // 程序化改 value 不会触发 input 事件；必须同步 --prism-fill，否则蓝色进度条会停在旧位置
  syncPrismalRangeFill(el);
}

function syncPrismalRangeFill(el) {
  try {
    if (window.MineradioPrismalChrome && typeof window.MineradioPrismalChrome.syncRangeFill === 'function') {
      window.MineradioPrismalChrome.syncRangeFill(el);
    }
  } catch (_) {}
}

function syncPrismalAllRangeFills() {
  try {
    if (window.MineradioPrismalChrome && typeof window.MineradioPrismalChrome.syncFills === 'function') {
      window.MineradioPrismalChrome.syncFills();
    }
  } catch (_) {}
}
function updateDevelopmentFxControls() {
  [
    ['desktopLyrics', 't-desktopLyrics', '全屏幕置顶歌词'],
    ['desktopLyricsClickThrough', 't-desktopLyricsClickThrough', '锁定后防误触；鼠标移到桌面歌词上按中键可锁定/解锁'],
    ['desktopLyricsCinema', 't-desktopLyricsCinema', '桌面歌词绑定鼓点电影震动，基础漂浮始终保留'],
    ['desktopLyricsHighlight', 't-desktopLyricsHighlight', '桌面歌词按播放进度高亮'],
    ['wallpaperMode', 't-wallpaperMode', '把完整 Mineradio 放到 Windows 桌面当壁纸；右上角控制器可显示/隐藏桌面图标，Esc 退出']
  ].forEach(function(item){
    var locked = isDevelopmentLockedFx(item[0]);
    var el = document.getElementById(item[1]);
    if (!el) return;
    el.classList.toggle('dev-locked', locked);
    if (locked) {
      el.classList.remove('on');
      el.setAttribute('aria-disabled', 'true');
      el.title = '开发中，暂不可用';
    } else {
      el.removeAttribute('aria-disabled');
      el.title = item[2];
    }
  });
  [
    ['desktopLyrics', 'fx-desktoplyricssize'],
    ['desktopLyrics', 'fx-desktoplyricsopacity'],
    ['desktopLyrics', 'fx-desktoplyricstilt'],
    ['wallpaperMode', 'fx-wallpaperopacity']
  ].forEach(function(item){
    var locked = isDevelopmentLockedFx(item[0]);
    var input = document.getElementById(item[1]);
    if (!input) return;
    input.disabled = locked;
    var row = input.closest && input.closest('.fx-slider');
    if (row) row.classList.toggle('dev-locked', locked);
  });
}
function updateDesktopLyricsFpsControls() {
  var fps = normalizeDesktopLyricsFps(fx.desktopLyricsFps);
  document.querySelectorAll('#desktop-lyrics-fps-seg [data-desktop-lyrics-fps]').forEach(function(btn){
    btn.classList.toggle('active', normalizeDesktopLyricsFps(btn.getAttribute('data-desktop-lyrics-fps')) === fps);
  });
}
// 壁纸模式帧数分段（24 / 30 / 60）的选中态
function updateWallpaperFpsControls() {
  var fps = Math.max(1, Math.min(60, Math.round(Number(fx.wallpaperFps) || 60)));
  document.querySelectorAll('#wallpaper-fps-seg [data-wallpaper-fps]').forEach(function(btn){
    btn.classList.toggle('active', Math.max(1, Math.min(60, Math.round(Number(btn.getAttribute('data-wallpaper-fps')) || 0))) === fps);
  });
}
// 行数 / 换行动效两个分段控件的选中态（面板打开、预设切换、外部改 fx 都要刷新）
function updateDesktopLyricsLayoutControls() {
  var lines = normalizeDesktopLyricsLineCount(fx.desktopLyricsLines);
  document.querySelectorAll('#desktop-lyrics-lines-seg [data-desktop-lyrics-lines]').forEach(function(btn){
    btn.classList.toggle('active', normalizeDesktopLyricsLineCount(btn.getAttribute('data-desktop-lyrics-lines')) === lines);
  });
  var motion = normalizeDesktopLyricsMotion(fx.desktopLyricsMotion);
  document.querySelectorAll('#desktop-lyrics-motion-seg [data-desktop-lyrics-motion]').forEach(function(btn){
    btn.classList.toggle('active', normalizeDesktopLyricsMotion(btn.getAttribute('data-desktop-lyrics-motion')) === motion);
  });
}
/* 桌面歌词主开关关掉时，把「大小 / 透明度 / 行数 / 动效 / 倾斜 / 帧率」整块收起，
 * 只留一行提示。这些参数作用于另一个窗口，主开关没开时摆在面板里只会让人以为「拖了没反应」。 */
function updateDesktopLyricsPanelVisibility() {
  var panel = document.getElementById('fx-panel');
  if (!panel) return;
  var locked = typeof isDevelopmentLockedFx === 'function' && isDevelopmentLockedFx('desktopLyrics');
  var on = !!(fx && fx.desktopLyrics) && !locked;
  panel.classList.toggle('dl-on', on);
  panel.classList.toggle('dl-off', !on);
}
// 壁纸模式的「帧数 / 透明度」只在开关打开时显示（与桌面歌词设置块同一条 UX 约定）
function updateWallpaperPanelVisibility() {
  var on = !!(fx && fx.wallpaperMode);
  var groupLabel = document.getElementById('wallpaper-settings-label');
  if (groupLabel) groupLabel.hidden = !on;
  var fpsLabel = document.getElementById('wallpaper-fps-label');
  if (fpsLabel) fpsLabel.hidden = !on;
  var fpsSeg = document.getElementById('wallpaper-fps-seg');
  if (fpsSeg) fpsSeg.hidden = !on;
  var opacityInput = document.getElementById('fx-wallpaperopacity');
  var row = opacityInput && opacityInput.closest && opacityInput.closest('.fx-slider');
  if (row) row.hidden = !on;
}
/* 低画质会关掉行层渲染（14-stage-lyrics-rendering.js: quality==='eco' → false），
 * 舞台只剩 cur/next/next2 三层 = 3 行。这件事以前完全没提示，用户只会觉得「行数设置坏了」，
 * 所以在「显示行数」下面挂一条只在 eco 时出现的说明。 */
function updateLyricRowsEcoHint() {
  var el = document.getElementById('fx-lyric-rows-eco-hint');
  if (!el) return;
  var eco = (typeof resolvedPerformanceQuality === 'function') && resolvedPerformanceQuality() === 'eco';
  el.hidden = !eco;
}

function updatePerformanceControls() {
  fx.performanceBackground = normalizePerformanceBackgroundMode(fx.performanceBackground, fx.liveBackgroundKeep === true);
  fx.liveBackgroundKeep = fx.performanceBackground === 'keep';
  fx.performanceQuality = normalizePerformanceQuality(fx.performanceQuality);
  fx.foregroundFpsMode = normalizeForegroundFpsMode(fx.foregroundFpsMode);
  fx.gpuThrottleMode = normalizeGpuThrottleMode(fx.gpuThrottleMode);
  document.querySelectorAll('#performance-background-seg [data-performance-background]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-performance-background') === fx.performanceBackground);
  });
  document.querySelectorAll('#performance-quality-seg [data-performance-quality]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-performance-quality') === fx.performanceQuality);
  });
  document.querySelectorAll('#foreground-fps-seg [data-foreground-fps]').forEach(function(btn){
    btn.classList.toggle('active', normalizeForegroundFpsMode(btn.getAttribute('data-foreground-fps')) === fx.foregroundFpsMode);
  });
  document.querySelectorAll('#gpu-throttle-seg [data-gpu-throttle]').forEach(function(btn){
    btn.classList.toggle('active', normalizeGpuThrottleMode(btn.getAttribute('data-gpu-throttle')) === fx.gpuThrottleMode);
  });
  var liveBackgroundKeepToggle = document.getElementById('t-liveBackgroundKeep');
  if (liveBackgroundKeepToggle) liveBackgroundKeepToggle.classList.toggle('on', fx.liveBackgroundKeep === true);
  updateGpuThrottleReasonUi();
  updateLyricRowsEcoHint();
}
function formatGpuThrottleReasonText(snapshot) {
  snapshot = snapshot || (typeof getGpuThrottleSnapshot === 'function' ? getGpuThrottleSnapshot() : null) || {};
  var mode = normalizeGpuThrottleMode(fx && fx.gpuThrottleMode);
  var modeLabel = mode === 'auto' ? '自动' : (mode === 'on' ? '强制开启' : '关闭');
  if (!snapshot.active) {
    return '状态：待命 · 模式 ' + modeLabel + (snapshot.reason ? (' · 上次 ' + snapshot.reason) : '');
  }
  var reasonMap = {
    'battery-low': '电池供电且电量偏低',
    'battery-lowspec': '电池 + 低端 GPU',
    'forced': '强制开启',
    'gpu-pressure': 'GPU 帧压偏高',
    'lowspec': '低端 GPU'
  };
  var parts = String(snapshot.reason || '').split(',').filter(Boolean).map(function (key) {
    return reasonMap[key] || key;
  });
  return '状态：节流中 · ' + (parts.join(' / ') || '未知原因') + ' · 模式 ' + modeLabel;
}
function updateGpuThrottleReasonUi() {
  var el = document.getElementById('gpu-throttle-reason');
  if (!el) return;
  el.textContent = formatGpuThrottleReasonText();
}
function setPerformanceBackgroundMode(mode, silent) {
  var next = normalizePerformanceBackgroundMode(mode, false);
  fx.performanceBackground = next;
  fx.liveBackgroundKeep = next === 'keep';
  updatePerformanceControls();
  saveLyricLayout();
  updateRenderPowerClasses();
  applyRendererPowerMode();
  if (next === 'keep') recoverVisualsAfterBackground('performance-background-keep');
  else if (next === 'release' && isDeepBackgroundMode()) trimRuntimeCaches('performance-release', true);
  if (!silent) {
    showToast(next === 'keep' ? '后台策略: 保持运行' : (next === 'release' ? '后台策略: 停止并释放' : '后台策略: 自动优化'));
  }
}
function setPerformanceQualityMode(mode, silent) {
  var next = normalizePerformanceQuality(mode);
  fx.performanceQuality = next;
  try { localStorage.setItem('mineradio-perf-quality-user-set-v1', '1'); } catch (_) {}
  updatePerformanceControls();
  applyRendererPowerMode();
  // 画质变化时重算封面粒子网格（eco 会把 1.55 有效压到 ~0.92，约 108² 而非 183²）
  if (typeof applyCoverParticleResolution === 'function') {
    try { applyCoverParticleResolution(fx.coverResolution, { reload: true }); } catch (_) {}
  }
  saveLyricLayout();
  if (!silent) {
    var resolved = typeof resolvedPerformanceQuality === 'function' ? resolvedPerformanceQuality() : next;
    var label = next === 'auto'
      ? ('自动 → ' + (resolved === 'eco' ? '低' : (resolved === 'balanced' ? '中' : (resolved === 'ultra' ? '超高' : '高'))))
      : (next === 'eco' ? '低' : (next === 'balanced' ? '中' : (next === 'ultra' ? '超高' : '高')));
    showToast('画质档位: ' + label + (resolved === 'eco' ? '（歌词行数限制为 3 行）' : ''));
  }
}

function migratePerformanceQualityTowardAutoOnce() {
  // 旧默认曾锁 eco，会让高配机也偏糊；未手动改过档位的用户升到 auto（上下兼顾）
  try {
    if (localStorage.getItem('mineradio-perf-quality-user-set-v1') === '1') return;
    if (localStorage.getItem('mineradio-perf-quality-migrated-auto-v1') === '1') return;
    if (normalizePerformanceQuality(fx && fx.performanceQuality) !== 'eco') {
      localStorage.setItem('mineradio-perf-quality-migrated-auto-v1', '1');
      return;
    }
    fx.performanceQuality = 'auto';
    localStorage.setItem('mineradio-perf-quality-migrated-auto-v1', '1');
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
    if (typeof updatePerformanceControls === 'function') updatePerformanceControls();
    if (typeof applyRendererPowerMode === 'function') applyRendererPowerMode();
  } catch (_) {}
}
function setForegroundFpsMode(mode, silent) {
  var next = normalizeForegroundFpsMode(mode);
  fx.foregroundFpsMode = next;
  updatePerformanceControls();
  saveLyricLayout();
  if (!silent) {
    var label = next === 'vsync' ? '跟随屏幕' : (next + ' fps');
    showToast('前台帧率上限: ' + label);
  }
}
function setGpuThrottleMode(mode, silent) {
  var next = normalizeGpuThrottleMode(mode);
  fx.gpuThrottleMode = next;
  updatePerformanceControls();
  saveLyricLayout();
  if (typeof syncGpuThrottle === 'function') syncGpuThrottle(performance.now());
  if (!silent) {
    var label = next === 'auto' ? '自动' : (next === 'on' ? '强制开启' : '关闭');
    showToast('GPU 节流: ' + label);
  }
}

// =============================================================================
// FX 面板输入 / 布局 / particle-fire（从 06-sonic-audio-monitor 纠域迁入）
// =============================================================================

function updateSonicFxInputs() {
  var themeSel = document.getElementById('fx-sonictheme');
  if (themeSel) themeSel.value = fx.sonicTheme || 'cycle';
  setRange('fx-soniccycletime', fx.sonicThemeCycleInterval);
  setRange('fx-sonicpeakintensity', fx.sonicPeakColorIntensity);
  setRange('fx-sonicgrid', fx.sonicGridSize);
  setRange('fx-sonicaudio', fx.sonicAudioIntensity);
  setRange('fx-sonicresponse', fx.sonicResponseRange);
  setRange('fx-sonicpulse', fx.sonicPulseSensitivity);
  setRange('fx-sonicpulsecooldown', fx.sonicPulseCooldown);
  setRange('fx-sonicmeteor', fx.sonicMeteorSensitivity);
  setRange('fx-sonicmeteocooldown', fx.sonicMeteorCooldown);
  setRange('fx-sonicidledebounce', fx.sonicIdleWaveDebounce);
  setRange('fx-sonicidlefade', fx.sonicIdleWaveFadeDuration);
  setRange('fx-soniccamdist', fx.sonicCameraDistance);
  setRange('fx-soniccamx', fx.sonicCameraAngleX);
  setRange('fx-soniccamy', fx.sonicCameraAngleY);
  setRange('fx-sonicrotatespeed', fx.sonicAutoRotateSpeed);
  // sonic 频谱监控滑块
  setRange('fx-sonicaudiosensitivity', fx.sonicAudioSensitivity);
  setRange('fx-sonicaudiobandstart', fx.sonicAudioBandStart);
  setRange('fx-sonicaudiobandend', fx.sonicAudioBandEnd);
  setRange('fx-sonicaudiothreshold', fx.sonicAudioThreshold);
  setRange('fx-sonicaudiopulse', fx.sonicAudioPulse);
  setRange('fx-sonicsubbass', fx.sonicGroundSubBass);
  setRange('fx-sonicbass', fx.sonicGroundBass);
  setRange('fx-soniclowmid', fx.sonicGroundLowMid);
  setRange('fx-sonicmid', fx.sonicGroundMid);
  setRange('fx-sonichighmid', fx.sonicGroundHighMid);
  setRange('fx-sonicpresence', fx.sonicGroundPresence);
  setRange('fx-sonicbrilliance', fx.sonicGroundBrilliance);
  setRange('fx-sonicair', fx.sonicGroundAir);
  setSonicGroundColorPickers();
  setRange('fx-sonicglow', fx.sonicGroundGlow);
  setRange('fx-sonicfloatcount', fx.sonicGroundFloatingCount);
  setRange('fx-sonicfloatintensity', fx.sonicGroundFloatingIntensity);
  setRange('fx-sonicfloatmin', fx.sonicGroundFloatingMinSize);
  setRange('fx-sonicfloatmax', fx.sonicGroundFloatingMaxSize);
  setRange('fx-sonicfloatspeed', fx.sonicGroundFloatingSpeed);
  setRange('fx-sonicmotionspeed', fx.sonicGroundMotionSpeed);
  setRange('fx-sonicamplitude', fx.sonicGroundAmplitude);
  setRange('fx-sonicdensity', fx.sonicGroundDensity);
  setRange('fx-sonicrange', fx.sonicGroundRange);
  setRange('fx-soniclower', fx.sonicGroundLower);
  setRange('fx-sonicdepth', fx.sonicGroundDepth);
  setRange('fx-sonicautorate', fx.sonicGroundAutoRotate);
  [
    ['sonicPeakColorEnabled', 't-sonicPeakColorEnabled'],
    ['sonicPulseEnabled', 't-sonicPulseEnabled'],
    ['sonicMeteorEnabled', 't-sonicMeteorEnabled'],
    ['sonicMeteorClickEnabled', 't-sonicMeteorClickEnabled'],
    ['sonicIdleWaveEnabled', 't-sonicIdleWaveEnabled'],
    ['sonicAutoRotateEnabled', 't-sonicAutoRotateEnabled'],
    ['sonicAudioMonitorEnabled', 't-sonicAudioMonitorEnabled'],
    ['sonicAudioAutoTrack', 't-sonicAudioAutoTrack'],
    ['sonicGroundFloatingEnabled', 't-sonicGroundFloatingEnabled']
  ].forEach(function (pair) {
    var el = document.getElementById(pair[1]);
    if (!el) return;
    if (pair[0] === 'sonicAutoRotateEnabled') el.classList.toggle('on', fx.sonicAutoRotateEnabled === true);
    else el.classList.toggle('on', fx[pair[0]] !== false);
  });
}
function updateFxInputs() {
  normalizeDevelopmentLockedFxState();
  applyShelfCameraDefaultAngle(false);
  setRange('fx-intensity', fx.intensity);
  setRange('fx-particlecount', fx.particleCount);
  setRange('fx-cineshake', fx.cinemaShake);
  setRange('fx-depth', fx.depth);
  setRange('fx-coverres', fx.coverResolution);
  setRange('fx-lyricglow', fx.lyricGlowStrength);
  setRange('fx-bgopacity', fx.backgroundOpacity == null ? 1 : fx.backgroundOpacity);
  setRange('fx-glassaberration', fx.controlGlassChromaticOffset);
  setRange('fx-liquidglassblur', fx.liquidGlassBlur);
  setRange('fx-liquidglassrefraction', fx.liquidGlassRefraction);
  setRange('fx-liquidglassaberration', fx.liquidGlassAberration);
  setRange('fx-liquidglasshighlight', fx.liquidGlassHighlight);
  setRange('fx-liquidglassbrightness', fx.liquidGlassBrightness);
  setRange('fx-liquidglassbevel', fx.liquidGlassBevel);
  setRange('fx-liquidglasssaturation', fx.liquidGlassSaturation);
  setRange('fx-liquidglassspecular', fx.liquidGlassSpecular);
  setRange('fx-liquidglassfresnel', fx.liquidGlassFresnel);
  setRange('fx-liquidglassshadow', fx.liquidGlassShadow);
  setRange('fx-liquidglassshadowspread', fx.liquidGlassShadowSpread);
  setRange('fx-liquidglasstint', fx.liquidGlassTint);
  setRange('fx-liquidglassdistortion', fx.liquidGlassDistortion);
  setRange('fx-liquidglassbevelmode', fx.liquidGlassBevelMode);
  setRange('fx-desktoplyricssize', fx.desktopLyricsSize);
  setRange('fx-desktoplyricsopacity', fx.desktopLyricsOpacity);
  setRange('fx-desktoplyricstilt', fx.desktopLyricsTilt || 0);
  setRange('fx-wallpaperopacity', fx.wallpaperOpacity);
  setRange('fx-shelfsize', fx.shelfSize);
  setRange('fx-shelfx', fx.shelfOffsetX);
  setRange('fx-shelfy', fx.shelfOffsetY);
  setRange('fx-shelfz', fx.shelfOffsetZ);
  setRange('fx-shelfangle', fx.shelfAngleY);
  setRange('fx-shelfopacity', fx.shelfOpacity);
  setRange('fx-shelfbgalpha', fx.shelfBgOpacity);
  setRange('fx-lyricspacing', fx.lyricLetterSpacing);
  setRange('fx-lyriclineheight', fx.lyricLineHeight);
  setRange('fx-lyricweight', fx.lyricWeight);
  setRange('fx-lyricscale', fx.lyricScale);
  setRange('fx-lyricx', fx.lyricOffsetX);
  setRange('fx-lyricy', fx.lyricOffsetY);
  setRange('fx-lyricz', fx.lyricOffsetZ);
  setRange('fx-lyrictiltx', fx.lyricTiltX);
  setRange('fx-lyrictilty', fx.lyricTiltY);
  setRange('fx-lyriccustomlines', fx.lyricCustomLines);
  setRange('fx-lyricglitchpower', fx.lyricGlitchPower);
  setRange('fx-lyricglitchrate', fx.lyricGlitchRate);
  syncLyricSegmentActive();
  setRange('fx-point', fx.point);
  setRange('fx-speed', fx.speed);
  setRange('fx-twist', fx.twist);
  setRange('fx-color', fx.color);
  setRange('fx-bloom', fx.bloomStrength);
  setRange('fx-scatter', fx.scatter);
  setRange('fx-bgfade', fx.bgFade);
  updateSonicFxInputs();
  updateClassicFxInputs();
  updateDualLyricsToggleButton();
  applySonicFxPanelState();
  applyRippleFxPanelState();
  applyClassicFxPanelState();
  applyClassicPresetState(isClassicPresetActive());
  updateLyricGlowControls();
  // 同步开关
  document.getElementById('t-float').classList.toggle('on', fx.floatLayer);
  var floatToggle = document.getElementById('t-float');
  if (floatToggle) floatToggle.classList.toggle('on', fx.floatLayer);
  document.getElementById('t-cinema').classList.toggle('on', fx.cinema);
  var lyricGlowToggle = document.getElementById('t-lyricGlow');
  if (lyricGlowToggle) lyricGlowToggle.classList.toggle('on', fx.lyricGlow);
  var lyricGlowBeatToggle = document.getElementById('t-lyricGlowBeat');
  if (lyricGlowBeatToggle) lyricGlowBeatToggle.classList.toggle('on', fx.lyricGlowBeat);
  var lyricGlowParticlesToggle = document.getElementById('t-lyricGlowParticles');
  if (lyricGlowParticlesToggle) lyricGlowParticlesToggle.classList.toggle('on', fx.lyricGlowParticles);
  var backgroundStarRiverToggle = document.getElementById('t-backgroundStarRiver');
  if (backgroundStarRiverToggle) backgroundStarRiverToggle.classList.toggle('on', fx.backgroundStarRiver === true);
  var lyricVerticalFloatToggle = document.getElementById('t-lyricVerticalFloat');
  if (lyricVerticalFloatToggle) lyricVerticalFloatToggle.classList.toggle('on', fx.lyricVerticalFloat === true);
  var lyricPauseHoldToggle = document.getElementById('t-lyricPauseHold');
  if (lyricPauseHoldToggle) lyricPauseHoldToggle.classList.toggle('on', fx.lyricPauseHold === true);
  var lyricCameraLockToggle = document.getElementById('t-lyricCameraLock');
  if (lyricCameraLockToggle) lyricCameraLockToggle.classList.toggle('on', fx.lyricCameraLock);
  document.getElementById('t-bloom').classList.toggle('on', fx.bloom);
  document.getElementById('t-edge').classList.toggle('on', fx.edge);
  var desktopLyricsToggle = document.getElementById('t-desktopLyrics');
  if (desktopLyricsToggle) desktopLyricsToggle.classList.toggle('on', fx.desktopLyrics);
  var desktopLyricsClickToggle = document.getElementById('t-desktopLyricsClickThrough');
  if (desktopLyricsClickToggle) desktopLyricsClickToggle.classList.toggle('on', fx.desktopLyricsClickThrough !== false);
  var desktopLyricsCinemaToggle = document.getElementById('t-desktopLyricsCinema');
  if (desktopLyricsCinemaToggle) desktopLyricsCinemaToggle.classList.toggle('on', fx.desktopLyricsCinema !== false);
  var desktopLyricsHighlightToggle = document.getElementById('t-desktopLyricsHighlight');
  if (desktopLyricsHighlightToggle) desktopLyricsHighlightToggle.classList.toggle('on', fx.desktopLyricsHighlight === true);
  updateDesktopLyricsFpsControls();
  updateDesktopLyricsLayoutControls();
  updateWallpaperFpsControls();
  updateWallpaperPanelVisibility();
  var wallpaperModeToggle = document.getElementById('t-wallpaperMode');
  if (wallpaperModeToggle) wallpaperModeToggle.classList.toggle('on', fx.wallpaperMode);
  var shelfPodcastsToggle = document.getElementById('t-shelfShowPodcasts');
  if (shelfPodcastsToggle) shelfPodcastsToggle.classList.toggle('on', fx.shelfShowPodcasts !== false);
  var shelfMergeToggle = document.getElementById('t-shelfMergeCollections');
  if (shelfMergeToggle) shelfMergeToggle.classList.toggle('on', fx.shelfMergeCollections === true);
  var liveBackgroundKeepToggle = document.getElementById('t-liveBackgroundKeep');
  if (liveBackgroundKeepToggle) liveBackgroundKeepToggle.classList.toggle('on', fx.liveBackgroundKeep === true);
  updatePerformanceControls();
  updateMemoryControls();
  if (typeof updateWasapiOutputControls === 'function') updateWasapiOutputControls();
  if (typeof updateAiLyricTranslateToggle === 'function') updateAiLyricTranslateToggle();
  updateDevelopmentFxControls();
  updateDesktopLyricsPanelVisibility();
  var aiDepthToggle = document.getElementById('t-aidepth');
  if (aiDepthToggle) aiDepthToggle.classList.toggle('on', fx.aiDepth);
  // 三态
  document.querySelectorAll('#shelf-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.shelf === fx.shelf); });
  updateShelfControlUi();
  document.querySelectorAll('#cam-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.cam === fx.cam); });
  refreshPresetGrid();
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  updateLyricFontControls();
  updateUiAccentControls();
  updateHomeAccentControls();
  updateIconAccentControls();
  updateCustomBackgroundControls();
  updateVisualTintControls();
  updateRippleColorControls();
  applyControlGlassChromaticOffset();
  syncFxUniforms();
  // 批量回填后统一校准蓝色进度条（setRange 单点已同步；这里兜底漏网 + 面板刚布局完成时的 trackW）
  syncPrismalAllRangeFills();
}
function animateFxResetButton(btn) {
  if (!btn || !window.gsap) return;
  window.gsap.fromTo(btn, { rotate: -120, scale: 0.88 }, { rotate: 0, scale: 1, duration: 0.48, ease: 'expo.out', overwrite: true });
  window.gsap.fromTo(btn, { boxShadow: '0 0 0 0 rgba(244,210,138,.38)' }, { boxShadow: '0 0 0 8px rgba(244,210,138,0)', duration: 0.55, ease: 'sine.out', overwrite: true });
}
function resetFxSliderValue(id, key, btn) {
  if (!Object.prototype.hasOwnProperty.call(fxDefaults, key)) return;
  if (key === 'shelfAngleY') {
    fx.shelfAngleYManual = false;
    fx.shelfAngleY = shelfDefaultAngleForCameraMode(fx.shelfCameraMode);
  } else {
    fx[key] = fxDefaults[key];
  }
  setRange(id, fx[key]);
  if (key === 'coverResolution') applyCoverParticleResolution(fx[key], { reload: true });
  if (key === 'controlGlassChromaticOffset') applyControlGlassChromaticOffset();
  syncFxUniforms();
  if (key === 'lyricLetterSpacing' || key === 'lyricLineHeight' || key === 'lyricWeight') refreshCurrentLyricStyle();
  saveLyricLayout();
  animateFxResetButton(btn);
  showToast('已恢复默认数值');
}
function ensureFxSliderResetButton(id, key) {
  var el = document.getElementById(id);
  var row = getFxSliderRow(el);
  if (!el || !row || row.querySelector('.fx-reset-one')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-reset-one';
  btn.title = '恢复当前滑条默认值';
  btn.setAttribute('aria-label', '恢复当前滑条默认值');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  btn.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    resetFxSliderValue(id, key, btn);
  });
  row.appendChild(btn);
}

/* 启动刷一次：eco 状态下打开面板就要能看到那条提示，不必先动一下画质档位 */
(function bootLyricRowsEcoHint() {
  if (typeof document === 'undefined') return;
  function run() {
    try { updateLyricRowsEcoHint(); } catch (_) {}
    /* 画质可能被自动降级/迁移改动，延迟再对一次 */
    setTimeout(function () { try { updateLyricRowsEcoHint(); } catch (_) {} }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
