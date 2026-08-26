// ============================================================
//  GPU 节流模式（电池 / 低端 GPU / 高帧压 → 约 30fps + 关 bloom）
//  原则见 docs/LOW_SPEC_OPTIMIZATION_DOCTRINE.md
// ============================================================
var gpuThrottleState = {
  active: false,
  reason: '',
  batteryCharging: true,
  batteryLevel: 1,
  batteryReady: false,
  lowGpuHint: false,
  savedBloom: null,
  toastAt: 0,
  lastEvalAt: 0
};

function normalizeGpuThrottleMode(value) {
  var mode = String(value || '').trim().toLowerCase();
  if (mode === 'on' || mode === 'off' || mode === 'auto') return mode;
  return (fxDefaults && fxDefaults.gpuThrottleMode) || 'auto';
}

function detectLowGpuRendererHint() {
  try {
    if (!renderer || !renderer.getContext) return false;
    var gl = renderer.getContext();
    if (!gl) return false;
    var ext = gl.getExtension('WEBGL_debug_renderer_info');
    var raw = '';
    if (ext) raw = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    else raw = String(gl.getParameter(gl.RENDERER) || '');
    raw = raw.toLowerCase();
    if (!raw) return false;
    if (/nvidia|radeon|geforce|rtx|gtx|rx\s?\d/.test(raw) && !/uhd|hd graphics|iris|vega\s?[0-3]|intel/.test(raw)) {
      return false;
    }
    return /intel|uhd|hd graphics|iris|mali|adreno|apple\s*gpu|llvmpipe|swiftshader|microsoft basic/.test(raw)
      || /vega\s?[0-3]|radeon\s*graphics(?!\s*rx)/.test(raw);
  } catch (e) {
    return false;
  }
}

function initGpuThrottleMonitor() {
  gpuThrottleState.lowGpuHint = detectLowGpuRendererHint();
  if (!(navigator && typeof navigator.getBattery === 'function')) {
    gpuThrottleState.batteryReady = false;
    return;
  }
  navigator.getBattery().then(function (battery) {
    function syncBattery() {
      gpuThrottleState.batteryCharging = !!battery.charging;
      gpuThrottleState.batteryLevel = typeof battery.level === 'number' ? battery.level : 1;
      gpuThrottleState.batteryReady = true;
    }
    syncBattery();
    battery.addEventListener('chargingchange', syncBattery);
    battery.addEventListener('levelchange', syncBattery);
  }).catch(function () {
    gpuThrottleState.batteryReady = false;
  });
}

function gpuThrottleEvalReasons() {
  var reasons = [];
  var profile = (typeof runtimeHardwareProfile !== 'undefined' && runtimeHardwareProfile) || {};
  var pressure = (typeof adaptiveLoadPressureLevel === 'function') ? adaptiveLoadPressureLevel() : 0;
  var onBattery = gpuThrottleState.batteryReady && !gpuThrottleState.batteryCharging;
  var lowBatt = onBattery && gpuThrottleState.batteryLevel <= 0.35;
  if (lowBatt) reasons.push('battery-low');
  else if (onBattery && (profile.lowSpec || gpuThrottleState.lowGpuHint)) reasons.push('battery-lowspec');
  if (profile.lowSpec && pressure >= 1) reasons.push('lowspec-pressure');
  if (gpuThrottleState.lowGpuHint && pressure >= 1) reasons.push('gpu-pressure');
  return reasons;
}

function shouldGpuThrottle() {
  var mode = normalizeGpuThrottleMode(fx && fx.gpuThrottleMode);
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return gpuThrottleEvalReasons().length > 0;
}

function gpuThrottleTargetFps() {
  return 30;
}

function isGpuThrottleActive() {
  return !!gpuThrottleState.active;
}

function applyGpuThrottleBloomMute(active) {
  if (!uniforms) return;
  if (active) {
    uniforms.uBloomStrength.value = 0;
    if (typeof bloomParticles !== 'undefined' && bloomParticles) bloomParticles.visible = false;
    return;
  }
  if (fx && fx.bloom) {
    uniforms.uBloomStrength.value = fx.bloomStrength || 0;
    if (typeof bloomParticles !== 'undefined' && bloomParticles) {
      bloomParticles.visible = fx.preset !== 9 && fx.bloomStrength > 0.01;
    }
  }
}

function syncGpuThrottle(now) {
  now = now || performance.now();
  if (now - gpuThrottleState.lastEvalAt < 400) return gpuThrottleState.active;
  gpuThrottleState.lastEvalAt = now;
  var want = shouldGpuThrottle();
  var reasons = want ? (normalizeGpuThrottleMode(fx && fx.gpuThrottleMode) === 'on' ? ['forced'] : gpuThrottleEvalReasons()) : [];
  gpuThrottleState.reason = reasons.join(',') || '';

  if (want && !gpuThrottleState.active) {
    gpuThrottleState.active = true;
    if (gpuThrottleState.savedBloom == null) gpuThrottleState.savedBloom = !!(fx && fx.bloom);
    if (fx && fx.bloom) {
      fx.bloom = false;
      var bloomToggle = document.getElementById('t-bloom');
      if (bloomToggle) bloomToggle.classList.remove('on');
    }
    applyGpuThrottleBloomMute(true);
    if (now - gpuThrottleState.toastAt > 12000 && typeof showToast === 'function') {
      gpuThrottleState.toastAt = now;
      showToast('GPU 节流已启用 · 约 30fps · 暂时关闭溢光');
    }
  } else if (!want && gpuThrottleState.active) {
    gpuThrottleState.active = false;
    if (gpuThrottleState.savedBloom != null) {
      fx.bloom = !!gpuThrottleState.savedBloom;
      gpuThrottleState.savedBloom = null;
      var bloomToggleOn = document.getElementById('t-bloom');
      if (bloomToggleOn) bloomToggleOn.classList.toggle('on', !!fx.bloom);
      applyGpuThrottleBloomMute(false);
    }
    if (typeof showToast === 'function' && now - gpuThrottleState.toastAt > 4000) {
      gpuThrottleState.toastAt = now;
      showToast('GPU 节流已解除');
    }
  } else if (gpuThrottleState.active) {
    applyGpuThrottleBloomMute(true);
  }

  if (typeof renderPerfState !== 'undefined' && renderPerfState) {
    renderPerfState.gpuThrottle = gpuThrottleState.active;
    renderPerfState.gpuThrottleReason = gpuThrottleState.reason;
    renderPerfState.gpuThrottleMode = normalizeGpuThrottleMode(fx && fx.gpuThrottleMode);
  }
  if (typeof updateGpuThrottleReasonUi === 'function') {
    try { updateGpuThrottleReasonUi(); } catch (_) {}
  }
  return gpuThrottleState.active;
}

function getGpuThrottleSnapshot() {
  return {
    active: gpuThrottleState.active,
    reason: gpuThrottleState.reason,
    mode: normalizeGpuThrottleMode(fx && fx.gpuThrottleMode),
    batteryCharging: gpuThrottleState.batteryCharging,
    batteryLevel: gpuThrottleState.batteryLevel,
    lowGpuHint: gpuThrottleState.lowGpuHint,
    targetFps: gpuThrottleTargetFps()
  };
}
window.__mineradioGpuThrottle = getGpuThrottleSnapshot;
try { initGpuThrottleMonitor(); } catch (e) {}
