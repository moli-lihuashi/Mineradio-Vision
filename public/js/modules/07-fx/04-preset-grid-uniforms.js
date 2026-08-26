function buildPresetGrid() {
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  var seen = {};
  var order = presetDisplayOrder.filter(function(id){
    var ok = id >= 0 && id < presetMeta.length && !seen[id];
    seen[id] = true;
    return ok;
  });
  presetMeta.forEach(function(_, id){
    if (!seen[id]) order.push(id);
  });
  grid.innerHTML = order.map(function(i){
    var p = presetMeta[i];
    var desc = p.descHtml || p.desc;
    return '<div class="preset-card" data-preset="' + i + '" onclick="setPreset(' + i + ')">' +
      '<div class="pc-icon">' + presetIcons[i] + '</div>' +
      '<div class="pc-name">' + p.name + '</div>' +
      '<div class="pc-desc">' + desc + '</div>' +
    '</div>';
  }).join('');
  refreshPresetGrid();
}
function refreshPresetGrid() {
  document.querySelectorAll('.preset-card').forEach(function(el){
    el.classList.toggle('active', Number(el.dataset.preset) === fx.preset);
  });
}
function triggerPresetParticleTransition(fromPreset, toPreset) {
  presetTransition.active = true;
  presetTransition.start = uniforms.uTime.value;
  presetTransition.duration = toPreset === 5 ? 0.46 : 0.42;
  presetTransition.from = fromPreset;
  presetTransition.to = toPreset;
  var newVisual = toPreset >= 4;
  var wallpaperFlow = toPreset === 5;
  // 粒子向外迸射 + 短暂放大
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + (newVisual ? (wallpaperFlow ? 0.014 : 0.040) : 0.20));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wallpaperFlow ? 0.08 : 0.22);
  camPunch = Math.max(camPunch, wallpaperFlow ? 0.06 : 0.18);
  // 中心主涟漪 + 周边辅助涟漪（涟漪着色器使用 coverColor，故天然带封面主色）
  triggerRipple(0, 0, 1.0 + (wallpaperFlow ? 0 : 0.15));
  for (var i = 0; i < 3; i++) {
    triggerRipple((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, 0.58 + Math.random() * 0.32);
  }
  // 全屏径向闪光（封面主色 + screen 混合），作为转场的标志性视觉
  if (!presetTransitionOverlayEl) {
    presetTransitionOverlayEl = document.getElementById('preset-transition-overlay');
    if (presetTransitionOverlayEl) presetTransitionOverlayEl.style.setProperty('--beat-glow-rgb', beatGlowCoverRGB);
  }
  if (presetTransitionOverlayEl) {
    presetTransitionOverlayEl.style.setProperty('--beat-glow-rgb', beatGlowCoverRGB);
    presetTransitionOverlayEl.classList.remove('flash');
    void presetTransitionOverlayEl.offsetWidth;  // 强制 reflow 以重启动画
    presetTransitionOverlayEl.classList.add('flash');
  }
  var card = document.querySelector('.preset-card[data-preset="' + toPreset + '"]');
  if (card) {
    card.classList.remove('switching');
    void card.offsetWidth;
    card.classList.add('switching');
    setTimeout(function(){ card.classList.remove('switching'); }, 760);
  }
}
function tickPresetTransition() {
  if (!presetTransition.active) return;
  var raw = (uniforms.uTime.value - presetTransition.start) / presetTransition.duration;
  var t = Math.max(0, Math.min(1, raw));
  // 使用 ease-out 衰减曲线：开局最强，缓缓回落，比对称 sin 更有"爆发→收束"感
  var decay = 1 - t;
  var wave = decay * decay;
  var newVisual = presetTransition.to >= 4;
  var wallpaperFlow = presetTransition.to === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + wave * (newVisual ? (wallpaperFlow ? 0.014 : 0.044) : 0.24));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wave * (wallpaperFlow ? 0.07 : (newVisual ? 0.18 : 0.24)));
  uniforms.uPointScale.value = fx.point * (1 + wave * (wallpaperFlow ? 0.024 : 0.072));
  if (raw >= 1) {
    presetTransition.active = false;
    syncFxUniforms();
  }
}
function setPreset(p, opts) {
  opts = opts || {};
  p = Math.max(0, Math.min(presetMeta.length - 1, Number(p) || 0));
  var prev = fx.preset;
  var changed = prev !== p;
  fx.preset = p;
  if (changed && prev === SKULL_PRESET_INDEX && p !== SKULL_PRESET_INDEX) clearSkullPresetResidue();
  if (changed && prev === SONIC_TOPOGRAPHY_PRESET_INDEX && p !== SONIC_TOPOGRAPHY_PRESET_INDEX && typeof MineradioSonicTopography !== 'undefined') MineradioSonicTopography.clear();
  if (p === SKULL_PRESET_INDEX) loadSkullParticleAsset();
  applySonicTopographyPresetState(p === SONIC_TOPOGRAPHY_PRESET_INDEX);
  applySonicFxPanelState();
  applyRippleFxPanelState();
  applyClassicFxPanelState();
  applyClassicPresetState(p === CLASSIC_PRESET_INDEX);
  uniforms.uPreset.value = p;
  refreshPresetGrid();
  if (changed && !opts.skipTransition) triggerPresetParticleTransition(prev, p);
  // 每个预设对应的相机基线 (改 userOrbit)
  if (changed && !opts.preserveCamera) {
    if (p === 1)      { orbit.userRadius = 6.2; orbit.userPhi = 0.03; orbit.userTheta = 0.0; orbit.baselineRadius = 6.2; orbit.baselinePhi = 0.03; }
    else if (p === 2) { orbit.userRadius = 7.0; orbit.userPhi = 0.15; orbit.userTheta = 0.0; orbit.baselineRadius = 7.0; orbit.baselinePhi = 0.15; }
    else if (p === 3) { orbit.userRadius = 8.0; orbit.userPhi = 0.05; orbit.userTheta = 0.0; orbit.baselineRadius = 8.0; orbit.baselinePhi = 0.05; }
    else if (p === 4) { orbit.userRadius = 6.5; orbit.userPhi = 0.04; orbit.userTheta = 0.0; orbit.baselineRadius = 6.5; orbit.baselinePhi = 0.04; }
    else if (p === 5) { orbit.userRadius = 9.4; orbit.userPhi = 0.34; orbit.userTheta = -0.52; orbit.baselineRadius = 9.4; orbit.baselinePhi = 0.34; }
    else if (p === 6) { orbit.userRadius = 10.8; orbit.userPhi = 0.35; orbit.userTheta = -0.20; orbit.baselineRadius = 10.8; orbit.baselinePhi = 0.35; }
    else if (p === 7) { orbit.userRadius = 7.5;  orbit.userPhi = 0.15; orbit.userTheta = -0.45; orbit.baselineRadius = 7.5;  orbit.baselinePhi = 0.15; }
    else if (p === 8) { orbit.userRadius = 9.0;  orbit.userPhi = -0.24; orbit.userTheta = -0.30; orbit.baselineRadius = 9.0;  orbit.baselinePhi = -0.24; }
    else if (p === 9) { orbit.userRadius = 6.6; orbit.userPhi = 0.0; orbit.userTheta = 0.0; orbit.baselineRadius = 6.6; orbit.baselinePhi = 0.0; orbit.centerLocked = true; }
    else if (p === SONIC_TOPOGRAPHY_PRESET_INDEX) {
      orbit.userRadius = 8.5; orbit.userPhi = 0.28; orbit.userTheta = 0.0; orbit.baselineRadius = 8.5; orbit.baselinePhi = 0.28;
    }
    else              { orbit.userRadius = 6.6; orbit.userPhi = 0.08; orbit.userTheta = 0.0; orbit.baselineRadius = 6.6; orbit.baselinePhi = 0.08; }
    orbit.baselineTheta = p === 5 ? -0.52 : (p === 6 ? -0.20 : (p === 7 ? -0.45 : (p === 8 ? -0.30 : (p === 9 ? 0.0 : 0.0))));
    if (changed && p === SONIC_TOPOGRAPHY_PRESET_INDEX) requestStageLyricCameraSnap(18);
  }
  // 涟漪/经典预设：切换粒子/涟漪层显示
  if (changed) {
    ripplePlane.visible = (p === 9);
    // 黑洞预设：引力透镜背景层随预设显隐
    if (typeof blackHoleLensPlane !== 'undefined' && blackHoleLensPlane) {
      blackHoleLensPlane.visible = (p === 8);
    }
    var hideParticles = (p === 9 || p === CLASSIC_PRESET_INDEX);
    if (particles) particles.visible = !hideParticles;
    if (bloomParticles) bloomParticles.visible = !hideParticles;
    if (floatGroup) floatGroup.visible = !hideParticles;
    if (backCoverGroup) backCoverGroup.visible = !hideParticles;
    if (p === 9) {
      ripplePlaneMat.uniforms.uAlpha.value = 0;
      ripplePlaneMat.uniforms.uTime.value = uniforms.uTime.value;
      rippleFadeStart = performance.now();
    } else {
      if (p === 8 && typeof blackHoleLensMat !== 'undefined' && blackHoleLensMat) {
        blackHoleLensMat.uniforms.uAlpha.value = 0;
        blackHoleLensFadeStart = performance.now();
      }
      orbit.centerLocked = false;
    }
  }
  if (changed && !opts.silent) showToast('视觉预设: ' + presetMeta[p].name);
  var shouldCommitPlaybackPreset = !!opts.commitPlaybackPreset || !opts.noSave;
  if (shouldCommitPlaybackPreset) {
    playbackVisualPreset = p;
    startupVisualPreviewActive = false;
  }
  if (!opts.noSave) {
    saveLyricLayout();
  }
}

function syncFxUniforms() {
  uniforms.uPreset.value = fx.preset;
  uniforms.uIntensity.value = fx.intensity;
  uniforms.uParticleDensity.value = fx.particleCount;
  uniforms.uDepth.value = fx.depth;
  uniforms.uPointScale.value = fx.point;
  // 专辑封面情绪映射：在用户基线上叠加温和的情绪乘子（暖→快/饱和，冷→缓慢流动）
  // calm(energy=0) → 0.82x 速度；active(energy=1) → 1.18x；暖色 +16% 饱和，冷色 -8%
  var _mood = coverMood.applied ? coverMood : null;
  var _speedMul = _mood ? (0.82 + _mood.energy * 0.36) : 1;
  var _colorMul = _mood ? (0.92 + _mood.warmth * 0.20) : 1;
  var _twistAdd = _mood ? (_mood.warmth - 0.5) * 0.08 : 0;
  uniforms.uSpeed.value = fx.speed * _speedMul;
  uniforms.uTwist.value = fx.twist + _twistAdd;
  uniforms.uColorBoost.value = fx.color * _colorMul;
  uniforms.uScatter.value = fx.scatter;
  uniforms.uCoverRes.value = normalizeCoverResolution(fx.coverResolution);
  uniforms.uBgFade.value = fx.bgFade;
  uniforms.uBloomStrength.value = fx.bloom ? fx.bloomStrength : 0;
  if (bloomParticles) bloomParticles.visible = fx.preset !== 9 && fx.bloom && fx.bloomStrength > 0.01;
  uniforms.uEdgeEnabled.value = fx.edge ? 1 : 0;
  if (uniforms.uTintColor) uniforms.uTintColor.value.set(normalizeHexColor(fx.visualTintColor || '#9db8cf'));
  if (uniforms.uTintStrength) uniforms.uTintStrength.value = fx.visualTintMode === 'custom' ? 0.42 : 0;
  // 涟漪颜色同步
  if (typeof ripplePlaneMat !== 'undefined' && ripplePlaneMat && ripplePlaneMat.uniforms && ripplePlaneMat.uniforms.uTintColor) {
    var ripplePal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
    var rippleHex = fx.rippleColorMode === 'custom'
      ? (fx.rippleColor || fxDefaults.rippleColor || '#9db8cf')
      : (ripplePal.secondary || ripplePal.primary || fx.rippleColor || fxDefaults.rippleColor || '#9db8cf');
    ripplePlaneMat.uniforms.uTintColor.value.set(parseColorToHex(rippleHex, '#9db8cf'));
  }
  syncSkullParticleColors();
  if (isSonicTopographyPresetActive()) pushSonicTopographyProperties(false);
}
