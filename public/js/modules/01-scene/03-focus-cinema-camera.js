function unlockCenteredView() {
  orbit.centerLocked = false;
}

function clearCenteredViewOffsets() {
  pointerTarget.x = 0;
  pointerTarget.y = 0;
  pointerParallax.x = 0;
  pointerParallax.y = 0;
  mouseWorld.set(-999, -999, 0);
  mouseActive = false;
  headParallax.x = 0;
  headParallax.y = 0;
  headParallax.active = false;
  headNeutral = null;
  if (typeof gestureRotation !== 'undefined') {
    gestureRotation.x = 0;
    gestureRotation.y = 0;
  }
  if (typeof particleSpin !== 'undefined') {
    particleSpin.vx = 0;
    particleSpin.vy = 0;
  }
  if (typeof pinchState !== 'undefined') pinchState.active = false;
  if (typeof particlePointerSpin !== 'undefined') particlePointerSpin.active = false;
  if (typeof resetParticleRotationTarget === 'function') resetParticleRotationTarget(false);
  if (typeof uniforms !== 'undefined' && uniforms.uHandActive) {
    uniforms.uHandActive.value = 0;
    uniforms.uHandXY.value.set(-999, -999);
    if (uniforms.uGestureGrip) uniforms.uGestureGrip.value = 0;
  }
}

function updateCamera() {
  if (applyFreeCameraToCamera()) return;
  if (orbit.recentering) {
    orbit.userTheta  += (orbit.baselineTheta - orbit.userTheta)  * 0.04;
    orbit.userPhi    += (orbit.baselinePhi   - orbit.userPhi)    * 0.04;
    orbit.userRadius += (orbit.baselineRadius- orbit.userRadius) * 0.04;
    if (Math.abs(orbit.userTheta - orbit.baselineTheta) < 0.005 &&
        Math.abs(orbit.userPhi - orbit.baselinePhi) < 0.005 &&
        Math.abs(orbit.userRadius - orbit.baselineRadius) < 0.05) {
      orbit.userTheta = orbit.baselineTheta;
      orbit.userPhi   = orbit.baselinePhi;
      orbit.userRadius= orbit.baselineRadius;
      orbit.recentering = false;
    }
  }

  // v8: focus 优先, 否则用 user + cine 复合姿态
  var fa = orbit.focus.active;
  var targetTheta, targetPhi, targetRadius, tLookAt;
  if (fa) {
    targetTheta = orbit.focus.theta;
    targetPhi   = orbit.focus.phi;
    targetRadius = orbit.focus.radius;
    tLookAt = orbit.focus.lookAt;
  } else if (orbit.centerLocked) {
    // centerLocked（涟漪/回正）仍叠加用户拖拽偏移：锁定基线但不禁拖，双击回正后可继续拖
    targetTheta = orbit.baselineTheta + orbit.userTheta + orbit.cineTheta;
    targetPhi = Math.max(orbit.minPhi, Math.min(orbit.maxPhi, orbit.baselinePhi + orbit.userPhi + orbit.cinePhi));
    targetRadius = Math.max(orbit.minRadius, Math.min(orbit.maxRadius, orbit.baselineRadius + orbit.userRadius + orbit.cineRadius));
    tLookAt = ZERO_VEC;
  } else {
    targetTheta = orbit.userTheta + orbit.cineTheta;
    targetPhi   = Math.max(orbit.minPhi, Math.min(orbit.maxPhi, orbit.userPhi + orbit.cinePhi));
    targetRadius= Math.max(orbit.minRadius, Math.min(orbit.maxRadius, orbit.userRadius + orbit.cineRadius));
    tLookAt = ZERO_VEC;
  }
  // 丝滑变速: 线性 lerp 自然给出 "快→慢" 缓出曲线
  var focusEase = fa ? 0.16 : 0.10;
  var radiusEase = fa ? 0.12 : 0.07;
  if (beatCam.punch > 0.01) {
    focusEase = Math.max(focusEase, 0.12 + beatCam.punch * 0.12);
    radiusEase = Math.max(radiusEase, 0.09 + beatCam.punch * 0.12);
  }
  orbit.theta  += (targetTheta  - orbit.theta)  * focusEase;
  orbit.phi    += (targetPhi    - orbit.phi)    * focusEase;
  orbit.radius += (targetRadius - orbit.radius) * radiusEase;
  orbit.lookAt.x += (tLookAt.x - orbit.lookAt.x) * focusEase;
  orbit.lookAt.y += (tLookAt.y - orbit.lookAt.y) * focusEase;
  orbit.lookAt.z += (tLookAt.z - orbit.lookAt.z) * focusEase;

  var cy = Math.cos(orbit.phi), sy = Math.sin(orbit.phi);
  var ct = Math.cos(orbit.theta), st = Math.sin(orbit.theta);
  camera.position.set(
    orbit.lookAt.x + orbit.radius * cy * st,
    orbit.lookAt.y + orbit.radius * sy,
    orbit.lookAt.z + orbit.radius * cy * ct
  );
  camera.lookAt(orbit.lookAt);
  var cameraShake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  camera.rotation.z += beatCam.rollKick * cameraShake;

  var cameraPunch = Math.max(camPunch * 0.55, beatCam.punch * 0.54 + beatCam.radiusKick * 0.16) * cameraShake;
  var targetFOV = BASE_FOV - cameraPunch * (djMode.active ? 2.62 : 2.35);
  var fovEase = targetFOV < camera.fov ? 0.24 : 0.12;
  camera.fov += (targetFOV - camera.fov) * fovEase;
  camera.updateProjectionMatrix();
  camPunch *= 0.86;
}

// 焦点跟拍 (hover 0.5s 后镜头移到目标)
var focusHover = { wantType: null, pendingTimer: null, exitTimer: null };
function shouldUseWallpaperSafeShelfCamera() {
  return !!(fx && Number(fx.preset) === 5);
}
function shouldUseSkullSafeShelfCamera() {
  return !!(fx && Number(fx.preset) === SKULL_PRESET_INDEX);
}
function shouldUseWallpaperLyricCameraLock() {
  return !!(fx && (Number(fx.preset) === 5 || Number(fx.preset) === SONIC_TOPOGRAPHY_PRESET_INDEX) && fx.lyricCameraLock);
}
function requestStageLyricCameraSnap(frames) {
  if (typeof stageLyrics === 'undefined' || !stageLyrics) return;
  stageLyrics.snapCameraLockFrames = Math.max(stageLyrics.snapCameraLockFrames || 0, frames || 8);
}
function isSonicTopographyPresetActive() {
  return !!(fx && Number(fx.preset) === SONIC_TOPOGRAPHY_PRESET_INDEX);
}
function ensureSonicTopographyFrame() {
  if (sonicTopographyFrame) return sonicTopographyFrame;
  sonicTopographyFrame = document.getElementById('sonic-topography-frame');
  if (!sonicTopographyFrame) return null;
  sonicTopographyFrame.addEventListener('load', function () {
    sonicTopographyReady = true;
    pushSonicTopographyMediaState(true);
    pushSonicTopographyProperties(true);
  });
  return sonicTopographyFrame;
}
function sonicTopographyGridSize() {
  var custom = Number(fx && fx.sonicGridSize);
  if (isFinite(custom) && custom >= 120) return Math.round(custom);
  var quality = normalizePerformanceQuality(fx && fx.performanceQuality);
  if (quality === 'ultra') return 320;
  if (quality === 'high') return 160;
  return 120;
}
function sonicTopographyPropertyPayload() {
  return {
    audioIntensity: clampRange(Number(fx.sonicAudioIntensity != null ? fx.sonicAudioIntensity : fx.intensity) || 1, 0.3, 2.5),
    responseRange: clampRange(Number(fx.sonicResponseRange != null ? fx.sonicResponseRange : (0.45 + (Number(fx.particleCount) || 0.65) * 0.95)), 0.3, 2),
    gridSize: sonicTopographyGridSize(),
    theme: fx.sonicTheme || 'cycle',
    themeCycleInterval: clampRange(Number(fx.sonicThemeCycleInterval) || 60, 8, 180),
    peakColorEnabled: fx.sonicPeakColorEnabled !== false,
    peakColorIntensity: clampRange(Number(fx.sonicPeakColorIntensity != null ? fx.sonicPeakColorIntensity : (Number(fx.color) || 1) * 0.72), 0, 2),
    pulseEnabled: fx.sonicPulseEnabled !== false,
    pulseSensitivity: clampRange(Number(fx.sonicPulseSensitivity) || 0.2, 0.05, 0.5),
    pulseCooldown: clampRange(Number(fx.sonicPulseCooldown) || 5, 0, 200),
    meteorEnabled: fx.sonicMeteorEnabled !== false,
    meteorSensitivity: clampRange(Number(fx.sonicMeteorSensitivity) || 0.35, 0.1, 0.8),
    meteorCooldown: clampRange(Number(fx.sonicMeteorCooldown) || 60, 0, 400),
    meteorClickEnabled: fx.sonicMeteorClickEnabled !== false,
    idleWaveEnabled: fx.sonicIdleWaveEnabled !== false,
    idleWaveDebounce: clampRange(Number(fx.sonicIdleWaveDebounce) || 1, 0.5, 5),
    idleWaveFadeDuration: clampRange(Number(fx.sonicIdleWaveFadeDuration) || 1, 0.5, 5),
    showAlbumCover: false,
    showPlayerController: false,
    autoRotateEnabled: fx.sonicAutoRotateEnabled === true,
    autoRotateSpeed: clampRange(Number(fx.sonicAutoRotateSpeed) || 10, 1, 30),
    cameraDistance: clampRange(Number(fx.sonicCameraDistance) || 85, 40, 120),
    cameraAngleX: clampRange(Number(fx.sonicCameraAngleX) || 120, 0, 360),
    cameraAngleY: clampRange(Number(fx.sonicCameraAngleY) || 25, 0, 90)
  };
}
function applySonicFxPanelState() {
  var fold = document.getElementById('fx-sonic-fold');
  if (fold) fold.classList.toggle('visible', isSonicTopographyPresetActive());
}
function isRipplePresetActive() {
  return !!(fx && Number(fx.preset) === 9);
}
function applyRippleFxPanelState() {
  var fold = document.getElementById('fx-ripple-fold');
  if (fold) fold.classList.toggle('visible', isRipplePresetActive());
}
function applyClassicFxPanelState() {
  var fold = document.getElementById('fx-classic-fold');
  if (fold) fold.classList.toggle('visible', isClassicPresetActive());
}
function applyClassicPlayerSettings() {
  var el = document.getElementById('classic-player');
  if (!el) return;
  var scale = clampRange(Number(fx.classicLyricScale) || 1, 0.5, 2.0);
  var offsetX = clampRange(Number(fx.classicLyricOffsetX) || 0, -25, 25);
  var offsetY = clampRange(Number(fx.classicLyricOffsetY) || 0, -20, 20);
  el.style.setProperty('--cp-lyric-scale', String(scale));
  el.style.setProperty('--cp-lyric-offset-x', offsetX + '%');
  el.style.setProperty('--cp-lyric-offset-y', offsetY + '%');
  el.classList.toggle('cp-hide-cover', fx.classicShowCover === false);
  el.classList.toggle('cp-hide-bg', fx.classicShowBg === false);
  syncClassicLyricInsets();
}
function syncClassicLyricInsets() {
  var el = document.getElementById('classic-player');
  var wrap = document.getElementById('cp-lyrics-wrap');
  if (!el) return;
  var curve = clampRange(Number(fx.classicLyricCurvature) || 0, -1.5, 1.5);
  var scale = clampRange(Number(fx.classicLyricScale) || 1, 0.5, 2.0);
  var tilt = fx.classicLyricArcTilt !== false ? clampRange(Number(fx.classicLyricTiltStrength) || 0, 0, 1.5) : 0;
  var rotSlack = Math.abs(curve) * tilt * 52 * scale;
  var insetLeft = 0;
  var insetRight = 0;
  if (curve < 0) {
    insetLeft = 24 + rotSlack * 0.48 + Math.abs(curve) * 10 * scale;
  } else if (curve > 0) {
    insetRight = curve * (18 + tilt * 8) * scale + 8;
  }
  var insetLeftPx = insetLeft.toFixed(1) + 'px';
  var insetRightPx = insetRight.toFixed(1) + 'px';
  el.style.setProperty('--cp-lyric-inset-left', insetLeftPx);
  el.style.setProperty('--cp-lyric-inset-right', insetRightPx);
  if (wrap) {
    wrap.style.setProperty('--cp-lyric-inset-left', insetLeftPx);
    wrap.style.setProperty('--cp-lyric-inset-right', insetRightPx);
  }
}
function classicLyricArcMetrics() {
  var curve = clampRange(Number(fx.classicLyricCurvature) || 0, -1.5, 1.5);
  var scale = clampRange(Number(fx.classicLyricScale) || 1, 0.5, 2.0);
  var arcPeak = Math.abs(curve) * 76 * scale;
  var baseOffset = curve < 0 ? (arcPeak + 48 * scale) : 0;
  return { curve: curve, scale: scale, baseOffset: baseOffset };
}
function classicLyricBezierX(dist, curve, baseOffset) {
  if (!curve) return 0;
  var ad = Math.min(Math.abs(dist), 6);
  var t = ad / 6;
  var bulge = Math.abs(curve) * 76 * (1 - t * t);
  if (curve < 0) return baseOffset - bulge;
  return curve * 76 * (1 - t * t);
}
function classicLyricRotateZ(dist, curve, tiltOn, tiltStrength) {
  if (!tiltOn || !curve || !dist) return 0;
  var strength = clampRange(Number(tiltStrength) || 1, 0, 1.5);
  var ad = Math.min(Math.abs(dist), 6);
  var falloff = 1 - (ad / 6) * 0.28;
  return curve * dist * 2.18 * strength * falloff;
}
function classicLyricTransform(dist, curve, isActive, metrics) {
  metrics = metrics || classicLyricArcMetrics();
  curve = metrics.curve;
  var arcX = classicLyricBezierX(dist, curve, metrics.baseOffset);
  if (isActive) {
    var scaleY = 1 + Math.min(0.18, Math.abs(curve) * 0.12);
    var scaleX = 1 + Math.min(0.06, Math.abs(curve) * 0.04);
    return 'translateX(' + arcX.toFixed(1) + 'px) scale(' + scaleX.toFixed(3) + ',' + scaleY.toFixed(3) + ')';
  }
  var rotate = classicLyricRotateZ(dist, curve, fx.classicLyricArcTilt !== false, fx.classicLyricTiltStrength);
  if (!rotate) return 'translateX(' + arcX.toFixed(1) + 'px)';
  return 'translateX(' + arcX.toFixed(1) + 'px) rotateZ(' + rotate.toFixed(2) + 'deg)';
}
function applyClassicLyricFade(el, wrap, isActive) {
  if (!wrap || !el) return;
  if (isActive) {
    el.style.opacity = '1';
    return;
  }
  var wrapRect = wrap.getBoundingClientRect();
  var lineRect = el.getBoundingClientRect();
  var centerDelta = Math.abs((lineRect.top + lineRect.height * 0.5) - (wrapRect.top + wrapRect.height * 0.5));
  var fadeStart = wrapRect.height * 0.10;
  var fadeEnd = wrapRect.height * 0.42;
  var fadeT = clampRange((centerDelta - fadeStart) / Math.max(1, fadeEnd - fadeStart), 0, 1);
  el.style.opacity = (0.50 - fadeT * 0.40).toFixed(3);
}
function applyClassicLyricCurve(lines, curIdx, wrapEl) {
  syncClassicLyricInsets();
  var metrics = classicLyricArcMetrics();
  var curve = metrics.curve;
  var wrap = wrapEl || document.getElementById('cp-lyrics-wrap');
  if (!lines || !lines.length) return;
  var anchor = curIdx >= 0 ? curIdx : 0;
  lines.forEach(function(el, i) {
    var isActive = i === curIdx;
    applyClassicLyricFade(el, wrap, isActive);
    if (curve === 0) {
      el.style.transform = '';
      return;
    }
    var dist = i - anchor;
    el.style.transform = classicLyricTransform(dist, curve, isActive, metrics);
  });
}
function updateClassicFxInputs() {
  setRange('fx-classiclyricscale', fx.classicLyricScale);
  setRange('fx-classiclyriccurve', fx.classicLyricCurvature);
  setRange('fx-classiclyrictilt', fx.classicLyricTiltStrength);
  setRange('fx-classiclyricx', fx.classicLyricOffsetX);
  setRange('fx-classiclyricy', fx.classicLyricOffsetY);
  [
    ['classicShowCover', 't-classicShowCover'],
    ['classicShowBg', 't-classicShowBg'],
    ['classicLyricArcTilt', 't-classicLyricArcTilt']
  ].forEach(function (pair) {
    var el = document.getElementById(pair[1]);
    if (!el) return;
    el.classList.toggle('on', fx[pair[0]] !== false);
  });
  applyClassicPlayerSettings();
}
function resetClassicParams() {
  fx.classicLyricScale = fxDefaults.classicLyricScale;
  fx.classicLyricCurvature = fxDefaults.classicLyricCurvature;
  fx.classicLyricTiltStrength = fxDefaults.classicLyricTiltStrength;
  fx.classicLyricArcTilt = fxDefaults.classicLyricArcTilt;
  fx.classicLyricOffsetX = fxDefaults.classicLyricOffsetX;
  fx.classicLyricOffsetY = fxDefaults.classicLyricOffsetY;
  fx.classicShowCover = fxDefaults.classicShowCover;
  fx.classicShowBg = fxDefaults.classicShowBg;
  updateClassicFxInputs();
  if (classicPlayer.active) {
    var container = document.getElementById('cp-lyrics');
    if (container) applyClassicLyricCurve(container.querySelectorAll('.cp-lyric-line'), classicPlayer.currentLyricIdx, document.getElementById('cp-lyrics-wrap'));
  }
  saveLyricLayout();
  showToast('经典参数已恢复默认');
}
function setSonicTheme(theme) {
  fx.sonicTheme = String(theme || 'cycle');
  var sel = document.getElementById('fx-sonictheme');
  if (sel && sel.value !== fx.sonicTheme) sel.value = fx.sonicTheme;
  pushSonicTopographyProperties(true);
  saveLyricLayout();
}
var SONIC_GROUND_COLOR_KEYS = {
  'sonic-ground-base-picker': 'sonicGroundBaseColor',
  'sonic-ground-cool-picker': 'sonicGroundCoolColor',
  'sonic-ground-warm-picker': 'sonicGroundWarmColor',
  'sonic-ground-accent-picker': 'sonicGroundAccentColor'
};
function setSonicGroundColorMode(mode) {
  fx.sonicGroundColorMode = (mode === 'custom') ? 'custom' : 'theme';
  var sel = document.getElementById('fx-soniccolormode');
  if (sel && sel.value !== fx.sonicGroundColorMode) sel.value = fx.sonicGroundColorMode;
  var colorsWrap = document.getElementById('sonic-ground-colors');
  if (colorsWrap) colorsWrap.classList.toggle('custom', fx.sonicGroundColorMode === 'custom');
  applySonicFxPanelState();
  saveLyricLayout();
}
function setSonicGroundColor(key, hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(hex))) return;
  fx[key] = String(hex).toLowerCase();
  var pickerId = null;
  Object.keys(SONIC_GROUND_COLOR_KEYS).forEach(function (pid) {
    if (SONIC_GROUND_COLOR_KEYS[pid] === key) pickerId = pid;
  });
  if (pickerId) {
    var valEl = document.getElementById(pickerId.replace('-picker', '') + '-value');
    if (valEl) valEl.textContent = String(hex).toUpperCase();
  }
  saveLyricLayout();
}
function setSonicGroundColorPickers() {
  Object.keys(SONIC_GROUND_COLOR_KEYS).forEach(function (pickerId) {
    var key = SONIC_GROUND_COLOR_KEYS[pickerId];
    var picker = document.getElementById(pickerId);
    var shortId = pickerId.replace('-picker', '');
    var valEl = document.getElementById(shortId + '-value');
    var val = fx[key] || fxDefaults[key] || '#000000';
    if (picker) picker.value = val;
    if (valEl) valEl.textContent = val.toUpperCase();
  });
  var modeSel = document.getElementById('fx-soniccolormode');
  if (modeSel) modeSel.value = fx.sonicGroundColorMode || 'theme';
  var colorsWrap = document.getElementById('sonic-ground-colors');
  if (colorsWrap) colorsWrap.classList.toggle('custom', fx.sonicGroundColorMode === 'custom');
  var floatToggle = document.getElementById('t-sonicGroundFloatingEnabled');
  if (floatToggle) floatToggle.classList.toggle('on', fx.sonicGroundFloatingEnabled !== false);
}
function resetSonicGroundColor(key) {
  if (fxDefaults[key] != null) fx[key] = fxDefaults[key];
  setSonicGroundColorPickers();
  saveLyricLayout();
}
var SONIC_GROUND_PARAM_KEYS = [
  'sonicGroundFloatingEnabled',
  'sonicGroundFloatingCount',
  'sonicGroundFloatingIntensity',
  'sonicGroundFloatingMinSize',
  'sonicGroundFloatingMaxSize',
  'sonicGroundFloatingSpeed',
  'sonicGroundGlow',
  'sonicGroundMotionSpeed',
  'sonicGroundAmplitude',
  'sonicGroundDensity',
  'sonicGroundRange',
  'sonicGroundLower',
  'sonicGroundDepth',
  'sonicGroundAutoRotate'
];
function resetSonicGroundParams() {
  SONIC_GROUND_PARAM_KEYS.forEach(function (key) {
    if (fxDefaults[key] != null) fx[key] = fxDefaults[key];
  });
  updateSonicFxInputs();
  pushSonicFxIfActive();
  saveLyricLayout();
  showToast('音域方块参数已恢复默认');
}
function bindSonicGroundColorPickers() {
  Object.keys(SONIC_GROUND_COLOR_KEYS).forEach(function (pickerId) {
    var el = document.getElementById(pickerId);
    if (!el || el._sonicGroundBound) return;
    el._sonicGroundBound = true;
    el.addEventListener('input', function () {
      setSonicGroundColor(SONIC_GROUND_COLOR_KEYS[pickerId], el.value);
    });
  });
}
function pushSonicFxIfActive() {
  if (isSonicTopographyPresetActive()) pushSonicTopographyProperties(true);
}
function pushSonicTopographyProperties(force) {
  if (!isSonicTopographyPresetActive()) return;
  var frame = ensureSonicTopographyFrame();
  if (!frame || !frame.contentWindow || (!sonicTopographyReady && !force)) return;
  frame.contentWindow.postMessage({
    type: 'mineradio-sonic',
    properties: sonicTopographyPropertyPayload(),
    hideUi: true
  }, location.origin);
  if (force) {
    setTimeout(function () {
      if (!isSonicTopographyPresetActive() || !sonicTopographyReady) return;
      frame.contentWindow.postMessage({ type: 'mineradio-sonic', properties: sonicTopographyPropertyPayload(), hideUi: true }, location.origin);
    }, 1200);
  }
}
function applySonicTopographyPresetState(active) {
  document.body.classList.toggle('sonic-topography-active', !!active);
  applySonicFxPanelState();
  // 进入 sonic 预设时按开关状态恢复频谱面板；离开时关闭
  setSonicAudioMonitorPanelOpen(!!active && fx.sonicAudioMonitorEnabled !== false && fx.sonicAudioMonitorEnabled === true);
}
function pushSonicTopographyMediaState(force) {
  if (!isSonicTopographyPresetActive()) return;
  var frame = ensureSonicTopographyFrame();
  if (!frame || !frame.contentWindow || (!sonicTopographyReady && !force)) return;
  var meta = currentDesktopSongMeta();
  var pal = stageLyrics && stageLyrics.palette || {};
  frame.contentWindow.postMessage({
    type: 'mineradio-sonic',
    media: {
      title: meta.title,
      artist: meta.artist,
      thumbnail: '',
      primaryColor: pal.primary || fx.lyricColor || '#d6f8ff',
      textColor: pal.highlight || fx.lyricHighlightColor || '#fff0b8',
      isPlaying: !!playing,
      position: audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0,
      duration: audio && isFinite(audio.duration) ? Number(audio.duration) : 0
    },
    properties: sonicTopographyPropertyPayload()
  }, location.origin);
}
function pushSonicTopographyAudioState() {
  if (!isSonicTopographyPresetActive() || !sonicTopographyReady) return;
  var frame = ensureSonicTopographyFrame();
  if (!frame || !frame.contentWindow) return;
  var srcLen = frequencyData.length;
  var outLen = 128;
  if (!sonicTopographyAudioBuf || sonicTopographyAudioBuf.length !== outLen) {
    sonicTopographyAudioBuf = new Array(outLen);
  }
  for (var i = 0; i < outLen; i++) {
    var idx = Math.min(srcLen - 1, Math.floor(i * srcLen / outLen));
    sonicTopographyAudioBuf[i] = frequencyData[idx] / 255;
  }
  frame.contentWindow.postMessage({ type: 'mineradio-sonic', audio: sonicTopographyAudioBuf }, location.origin);
}
function shouldDimWallpaperForShelf() {
  if (!shouldUseWallpaperSafeShelfCamera()) return false;
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (shelfPinnedOpen) return true;
  return !!(shelfManager.hasOpenContent && shelfManager.hasOpenContent());
}
function shouldOffsetLyricsForShelfDetail() {
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  return !!(shelfManager.hasOpenContent && shelfManager.hasOpenContent());
}
function shouldAvoidStageLyricsForShelf() {
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (shelfAlwaysVisible()) return true;
  if (shelfPinnedOpen) return true;
  if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return true;
  return !!(shelfVisibility > 0.24 || (shelfHoverCue && shelfHoverCue.value > 0.28));
}
function activateFocusZone(type) {
  unlockCenteredView();
  orbit.focus.active = true;
  orbit.focus.type = type;
  var shelfProfile = shelfLayoutProfile();
  if (type === 'shelf-side') {
    if (shouldUseWallpaperSafeShelfCamera()) {
      orbit.focus.theta  = shelfProfile.portrait ? 0.18 : 0.24;
      orbit.focus.phi    = shelfProfile.portrait ? 0.00 : 0.02;
      orbit.focus.radius = shelfProfile.portrait ? 5.74 : 5.32;
      orbit.focus.lookAt.set(shelfProfile.portrait ? 1.04 : 2.24, -0.08, 0.78);
      camPunch = Math.max(camPunch, 0.28);
      requestStageLyricCameraSnap(10);
    } else {
      // 侧栏 (右): 近一点、侧一点，让歌单架打开时有明确的镜头推近。
      orbit.focus.theta  = shelfProfile.portrait ? 0.24 : 0.42;
      orbit.focus.phi    = shelfProfile.portrait ? -0.06 : -0.12;
      orbit.focus.radius = shelfProfile.portrait ? 5.28 : 4.20;
      orbit.focus.lookAt.set(shelfProfile.portrait ? 1.08 : 2.32, shelfProfile.portrait ? -0.18 : -0.10, 0.72);
      camPunch = Math.max(camPunch, 0.82);
    }
  } else if (type === 'shelf-detail') {
    if (shouldUseWallpaperSafeShelfCamera()) {
      orbit.focus.theta  = shelfProfile.portrait ? 0.16 : 0.26;
      orbit.focus.phi    = shelfProfile.portrait ? -0.02 : 0.02;
      orbit.focus.radius = shelfProfile.portrait ? 5.88 : 5.18;
      orbit.focus.lookAt.set(shelfProfile.portrait ? 0.72 : 2.28, shelfProfile.portrait ? -0.36 : -0.32, 0.84);
      camPunch = Math.max(camPunch, 0.30);
      requestStageLyricCameraSnap(10);
    } else {
      orbit.focus.theta  = shelfProfile.portrait ? 0.16 : 0.34;
      orbit.focus.phi    = shelfProfile.portrait ? -0.03 : -0.06;
      orbit.focus.radius = shelfProfile.portrait ? 5.90 : 4.86;
      orbit.focus.lookAt.set(shelfProfile.portrait ? 0.62 : 1.74, shelfProfile.portrait ? -0.08 : 0.02, 0.82);
      camPunch = Math.max(camPunch, 0.38);
    }
  } else if (type === 'shelf-stage') {
    // 舞台: 居中仰拍
    orbit.focus.theta  = 0.0;
    orbit.focus.phi    = shelfProfile.portrait ? -0.24 : -0.32;
    orbit.focus.radius = shelfProfile.portrait ? 4.8 : 3.8;
    orbit.focus.lookAt.set(0, shelfProfile.portrait ? -1.86 : -1.7, 0.8);
  } else if (type === 'queue') {
    // 队列在左侧 HTML 面板, 相机微微左移 + 抬升
    orbit.focus.theta  = 0.40;
    orbit.focus.phi    = 0.05;
    orbit.focus.radius = 5.8;
    orbit.focus.lookAt.set(-1.2, 0, 0);
  }
}
function setFocusZone(type, immediate) {
  if (type && !shouldUseShelfDynamicCamera(type)) {
    if (/^shelf-/.test(String(orbit.focus.type || ''))) orbit.focus.active = false;
    type = null;
  }
  if (focusHover.wantType === type) return;
  focusHover.wantType = type;
  if (focusHover.pendingTimer) { clearTimeout(focusHover.pendingTimer); focusHover.pendingTimer = null; }
  if (focusHover.exitTimer) { clearTimeout(focusHover.exitTimer); focusHover.exitTimer = null; }
  if (!type) {
    // 立刻退出 focus, 让相机回主姿态 (但插值是平滑的)
    var exitDelay = orbit.focus.type === 'queue' ? PEEK_HIDE_DELAY : 120;
    focusHover.exitTimer = setTimeout(function(){
      focusHover.exitTimer = null;
      if (!focusHover.wantType) orbit.focus.active = false;
    }, exitDelay);
    return;
  }
  if (immediate) {
    activateFocusZone(type);
    return;
  }
  // 延迟 500ms 激活
  focusHover.pendingTimer = setTimeout(function(){
    focusHover.pendingTimer = null;
    if (focusHover.wantType !== type) return;
    activateFocusZone(type);
  }, 260);
}

// 电影镜头 v8: 振幅大幅减小, 节拍 punch 加冷却 + 强度门槛
//   - cineTheta/Phi 是非常缓慢的低频漂移, 不再让人 motion sick
//   - punch zoom 只在 真·强主拍 触发, 至少间隔 0.45s, 振幅 ×0.5
var lastCamPunchAt = -10;
var CAM_PUNCH_MIN_INTERVAL = 0.45;     // 秒
var CAM_PUNCH_BEAT_THRESHOLD = 0.55;   // 必须够强才触发
function updateCinema(dt) {
  cinemaT += dt;
  updateBeatCamera(dt);
  if (!fx.cinema) {
    orbit.cineTheta  *= 0.95;
    orbit.cinePhi    *= 0.95;
    orbit.cineRadius *= 0.95;
    return;
  }
  var damp = orbit.rotating ? 0.25 : 1.0;
  // v8: 振幅减半, 周期更长 (更优雅)
  var dj = djMode.active;
  var shake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  if (Mineradio.moodAudio && Mineradio.moodAudio.getCinemaShakeMul) {
    shake *= Mineradio.moodAudio.getCinemaShakeMul();
  }
  var beatDamp = (orbit.focus.active ? (dj ? 0.66 : 0.55) : (dj ? 1.12 : 1.0)) * shake;
  var idleDamp = damp * (dj ? 0.72 : 1.0) * shake;
  orbit.cineTheta  = Math.sin(cinemaT * 0.08) * 0.012 * idleDamp + beatCam.thetaKick * beatDamp;
  orbit.cinePhi    = Math.sin(cinemaT * 0.06 + 1.0) * 0.010 * idleDamp + beatCam.phiKick * beatDamp;
  orbit.cineRadius = Math.sin(cinemaT * 0.04 + 2.0) * 0.080 * idleDamp - beatCam.radiusKick * beatDamp * (dj ? 1.22 : 1.18);
}
updateCamera();

function recenterCamera() {
  orbit.centerLocked = true;
  orbit.recentering = true;
  clearCenteredViewOffsets();
  if (typeof skullWheelZoomTarget !== 'undefined') {
    skullWheelZoomTarget = 0;
    if (!(fx && fx.preset === SKULL_PRESET_INDEX)) skullWheelZoom = 0;
  }
  // 同时解除任何镜头跟拍
  if (focusHover) {
    focusHover.wantType = null;
    if (focusHover.pendingTimer) { clearTimeout(focusHover.pendingTimer); focusHover.pendingTimer = null; }
    if (focusHover.exitTimer) { clearTimeout(focusHover.exitTimer); focusHover.exitTimer = null; }
  }
  orbit.focus.active = false;
  if (fx && fx.preset === SKULL_PRESET_INDEX) {
    resetSkullPresetView(false, { smooth:true, keepLyricLock:true });
  } else {
    resetSkullPresetView(true);
  }
  if (!(fx && fx.preset === SKULL_PRESET_INDEX) && ((fx && fx.lyricCameraLock) || shouldUseWallpaperLyricCameraLock())) requestStageLyricCameraSnap(14);
  showToast('视角回正');
}
