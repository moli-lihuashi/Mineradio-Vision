// ============================================================
//  Three.js 场景
// ============================================================
var scene = new THREE.Scene();
scene.background = null;
var camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
/* ===== 硬件画像 + 刷新率采样 + 帧成本采样 ===== */
var runtimeHardwareProfile = { lowCore:false, lowMemory:false, largeSurface:false, veryLargeSurface:false, lowSpec:false, balancedSpec:false, cores:0, memory:0, dpr:1, cssPixels:0 };
function detectRuntimeHardwareProfile() {
  var cores = navigator.hardwareConcurrency || 4;
  var memory = navigator.deviceMemory || 4;
  var dpr = window.devicePixelRatio || 1;
  var cssPixels = Math.max(1, innerWidth * innerHeight);
  var lowCore = cores <= 4;
  var lowMemory = memory <= 4;
  var largeSurface = cssPixels >= 3200000;
  var veryLargeSurface = cssPixels >= 7200000;
  var lowSpec = lowCore || lowMemory;
  var balancedSpec = !lowSpec && (cores <= 6 || memory <= 6 || largeSurface);
  runtimeHardwareProfile = { cores:cores, memory:memory, dpr:dpr, cssPixels:cssPixels, lowCore:lowCore, lowMemory:lowMemory, largeSurface:largeSurface, veryLargeSurface:veryLargeSurface, lowSpec:lowSpec, balancedSpec:balancedSpec };
  return runtimeHardwareProfile;
}
function performanceQualityRank() {
  var q = typeof resolvedPerformanceQuality === 'function'
    ? resolvedPerformanceQuality()
    : normalizePerformanceQuality(fx && fx.performanceQuality);
  if (q === 'eco') return 0;
  if (q === 'balanced') return 1;
  if (q === 'high') return 2;
  if (q === 'ultra') return 3;
  return 1;
}
function runtimePerfBudgetLevel() {
  var rank = performanceQualityRank();
  if (runtimeHardwareProfile.lowSpec) return Math.max(0, rank - 1);
  if (runtimeHardwareProfile.balancedSpec) return Math.max(0, rank);
  return Math.min(3, rank + 1);
}
function refreshRuntimeHardwareSurfaceProfile() {
  var cores = runtimeHardwareProfile.cores || (navigator.hardwareConcurrency || 4);
  var memory = runtimeHardwareProfile.memory || (navigator.deviceMemory || 4);
  var dpr = window.devicePixelRatio || 1;
  var cssPixels = Math.max(1, innerWidth * innerHeight);
  var largeSurface = cssPixels >= 3200000;
  var veryLargeSurface = cssPixels >= 7200000;
  var lowCore = cores <= 4;
  var lowMemory = memory <= 4;
  var lowSpec = lowCore || lowMemory || (cores <= 6 && veryLargeSurface);
  runtimeHardwareProfile.dpr = dpr;
  runtimeHardwareProfile.cssPixels = cssPixels;
  runtimeHardwareProfile.largeSurface = largeSurface;
  runtimeHardwareProfile.veryLargeSurface = veryLargeSurface;
  runtimeHardwareProfile.lowCore = lowCore;
  runtimeHardwareProfile.lowMemory = lowMemory;
  runtimeHardwareProfile.lowSpec = lowSpec;
  runtimeHardwareProfile.balancedSpec = lowSpec || cores <= 8 || largeSurface;
  return runtimeHardwareProfile;
}
function runtimePerfScale() {
  var level = runtimePerfBudgetLevel();
  return level <= 0 ? 0.72 : (level === 1 ? 0.84 : (level >= 3 ? 1.08 : 1.0));
}
function runtimeAudioAnalysisScale() {
  if (typeof isDeepBackgroundMode === 'function' && isDeepBackgroundMode()) return 0.18;
  var level = runtimePerfBudgetLevel();
  var profile = runtimeHardwareProfile || {};
  if (level <= 0) return profile.lowMemory ? 0.62 : 0.68;
  if (level === 1) return 0.78;
  if (level >= 3) return 1.0;
  return 0.90;
}
function runtimeAnalysisStride(kind, length) {
  length = Math.max(1, Number(length) || 1);
  var level = runtimePerfBudgetLevel();
  if (kind === 'time') {
    if (level <= 0) return Math.max(2, Math.floor(length / 512));
    if (level === 1) return Math.max(1, Math.floor(length / 768));
    return 1;
  }
  if (kind === 'wide-band') {
    if (level <= 0) return 3;
    if (level === 1) return 2;
    return 1;
  }
  return 1;
}
detectRuntimeHardwareProfile();
// 刷新率采样
var renderRefreshState = { lastRafAt: 0, hz: 0, stableHz: 0, samples: [] };
function sampleDisplayRefreshHz(now) {
  if (!renderRefreshState.lastRafAt) { renderRefreshState.lastRafAt = now; return estimatedDisplayRefreshHz(); }
  var gap = now - renderRefreshState.lastRafAt;
  renderRefreshState.lastRafAt = now;
  if (gap < 4 || gap > 40) return estimatedDisplayRefreshHz(); // 过滤后台/卡顿
  renderRefreshState.samples.push(gap);
  if (renderRefreshState.samples.length > 36) renderRefreshState.samples.shift();
  if (renderRefreshState.samples.length < 6) return estimatedDisplayRefreshHz();
  var sorted = renderRefreshState.samples.slice().sort(function(a, b) { return a - b; });
  var median = sorted[Math.floor(sorted.length / 2)];
  var hz = Math.max(48, Math.min(240, 1000 / median));
  renderRefreshState.hz = hz;
  if (Math.abs(renderRefreshState.stableHz - hz) > 18) renderRefreshState.stableHz = hz; // 切换显示器/插拔
  else renderRefreshState.stableHz = renderRefreshState.stableHz * 0.90 + hz * 0.10;
  return estimatedDisplayRefreshHz();
}
function estimatedDisplayRefreshHz() {
  return Math.round(renderRefreshState.stableHz || renderRefreshState.hz || 60);
}
// 帧成本采样与压力等级
var adaptiveFrameLoadState = { avgMs: 0, lastCostMs: 0, lastTargetFps: 60, pressure: 0, level: 0 };
function sampleAdaptiveFrameCost(costMs, targetFps) {
  targetFps = Math.max(30, targetFps || 60);
  adaptiveFrameLoadState.lastCostMs = costMs;
  adaptiveFrameLoadState.lastTargetFps = targetFps;
  var budget = (1000 / targetFps) * 0.78;
  adaptiveFrameLoadState.avgMs = adaptiveFrameLoadState.avgMs * 0.92 + costMs * 0.08;
  if (adaptiveFrameLoadState.avgMs > budget) adaptiveFrameLoadState.pressure = Math.min(8, adaptiveFrameLoadState.pressure + 0.70);
  else if (adaptiveFrameLoadState.avgMs < budget * 0.62) adaptiveFrameLoadState.pressure = Math.max(0, adaptiveFrameLoadState.pressure - 0.30);
  else adaptiveFrameLoadState.pressure = Math.max(0, adaptiveFrameLoadState.pressure - 0.10);
  adaptiveFrameLoadState.level = adaptiveFrameLoadState.pressure >= 4 ? 2 : (adaptiveFrameLoadState.pressure >= 2 ? 1 : 0);
  return adaptiveFrameLoadState.level;
}
function adaptiveLoadPressureLevel() { return adaptiveFrameLoadState.level; }
function adaptiveFrameLoadSnapshot() {
  return { avgMs: adaptiveFrameLoadState.avgMs, lastCostMs: adaptiveFrameLoadState.lastCostMs, pressure: adaptiveFrameLoadState.pressure, level: adaptiveFrameLoadState.level, targetFps: adaptiveFrameLoadState.lastTargetFps };
}
function roundRenderNumber(value, digits) {
  var scale = Math.pow(10, digits == null ? 0 : digits);
  return Math.round((Number(value) || 0) * scale) / scale;
}
function clampAdaptiveCadenceDivisor(displayHz, divisor, minFps) {
  divisor = Math.max(1, Math.round(Number(divisor) || 1));
  minFps = Math.max(1, Number(minFps) || 60);
  while (divisor > 1 && displayHz / divisor < minFps) divisor--;
  return divisor;
}
function selectAdaptiveRenderCadence(kind, tier) {
  var displayHz = estimatedDisplayRefreshHz();
  var pressure = adaptiveLoadPressureLevel();
  var budgetLevel = (typeof runtimePerfBudgetLevel === 'function') ? runtimePerfBudgetLevel() : 2;
  var divisor = 1;
  kind = kind || 'playback';
  tier = Math.max(0, Number(tier) || 0);
  if (kind === 'idle') {
    divisor = (displayHz >= 144 && (tier >= 1 || budgetLevel <= 0)) ? 2 : 1;
  } else if (kind === 'playback') {
    divisor = (displayHz >= 190 && (tier >= 2 || pressure >= 1)) ? 2 : 1;
  } else if (kind === 'interaction') {
    divisor = 1;
  }
  if (kind !== 'interaction') {
    if (budgetLevel <= 0 && pressure >= 2 && displayHz >= 118) divisor = Math.max(divisor, 2);
    else if (budgetLevel === 1 && pressure >= 2 && displayHz >= 144) divisor = Math.max(divisor, 2);
    if (pressure >= 3 && displayHz >= 180) divisor = Math.max(divisor, 3);
  }
  divisor = clampAdaptiveCadenceDivisor(displayHz, divisor, kind === 'idle' ? 48 : 60);
  return {
    fps: Math.max(1, Math.round(displayHz / divisor)),
    divisor: divisor,
    displayHz: roundRenderNumber(displayHz, 1),
    kind: kind,
    tier: tier,
    pressure: pressure
  };
}
var RENDER_DPR_CAP = 1.35;
var RENDER_PIXEL_BUDGET = 5200000;
var RENDER_MIN_DPR = 0.72;
// 0 = display vsync. Keep visible playback high-refresh capable instead of capping 120Hz+ screens to 60/72.
var RENDER_VISIBLE_VSYNC = true;
var RENDER_ACTIVE_FPS = 0;
var RENDER_LARGE_FPS = 0;
var RENDER_HUGE_FPS = 0;
var RENDER_INTERACTION_FPS = 0;
var RENDER_INTERACTION_LARGE_FPS = 0;
var RENDER_INTERACTION_HUGE_FPS = 0;
var RENDER_INTERACTION_HOLD_MS = 900;
var renderInteractionBoostUntil = 0;
var renderInteractionReason = '';
function renderQualityProfile() {
  var quality = normalizePerformanceQuality(fx && fx.performanceQuality);
  if (quality === 'auto' && typeof resolvedPerformanceQuality === 'function') {
    quality = resolvedPerformanceQuality();
  }
  var lowSpec = runtimeHardwareProfile.lowSpec;
  // P1：eco 更紧的像素预算（内部分辨率），不是关特效
  if (quality === 'eco') return { cap: lowSpec ? 0.78 : 0.88, min: 0.50, budget: lowSpec ? 1400000 : 2000000, scale: lowSpec ? 0.82 : 0.88 };
  if (quality === 'balanced') return { cap: lowSpec ? 0.92 : 1.12, min: 0.62, budget: lowSpec ? 2400000 : 3800000, scale: lowSpec ? 0.90 : 1.0 };
  if (quality === 'ultra') return { cap: 1.75, min: 0.85, budget: 7800000, scale: 1.0 };
  return { cap: RENDER_DPR_CAP, min: RENDER_MIN_DPR, budget: RENDER_PIXEL_BUDGET, scale: 1.0 };
}
function getRenderPixelRatio() {
  var device = window.devicePixelRatio || 1;
  if (isDeepBackgroundMode()) return Math.min(device, 0.30);
  var cssPixels = Math.max(1, innerWidth * innerHeight);
  var quality = renderQualityProfile();
  var budgetCap = Math.sqrt(quality.budget / cssPixels);
  var cap = Math.min(quality.cap, budgetCap);
  var ratio = Math.max(quality.min, Math.min(device, cap));
  var scale = quality.scale != null ? quality.scale : 1;
  if (typeof adaptiveLoadPressureLevel === 'function' && adaptiveLoadPressureLevel() >= 2 && scale > 0.78) {
    scale *= 0.92;
  }
  return Math.max(quality.min * 0.92, ratio * scale);
}
function getRenderPixelLoad() {
  var ratio = getRenderPixelRatio();
  return Math.max(1, innerWidth * innerHeight) * ratio * ratio;
}
function markRenderInteraction(reason, holdMs) {
  if (isDeepBackgroundMode()) return;
  var now = performance.now();
  renderInteractionBoostUntil = Math.max(renderInteractionBoostUntil, now + (holdMs || RENDER_INTERACTION_HOLD_MS));
  renderInteractionReason = reason || renderInteractionReason || 'interaction';
  // 固定前台帧率档必须保留 cadence phase，否则 progress-drag 每帧唤醒会悄悄绕过 45/60 上限
  var foregroundMode = (typeof normalizeForegroundFpsMode === 'function')
    ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode)
    : 'vsync';
  var fixedForegroundFps = (typeof foregroundFixedFpsForMode === 'function')
    ? foregroundFixedFpsForMode(foregroundMode)
    : null;
  if (
    typeof renderPerfState !== 'undefined' && renderPerfState &&
    (fixedForegroundFps == null || fixedForegroundFps === 0)
  ) renderPerfState.lastRenderAt = 0;
}
function isRenderInteractionActive(now) {
  return (now || performance.now()) < renderInteractionBoostUntil;
}
function getRenderLoadTier() {
  var cssPixels = Math.max(1, innerWidth * innerHeight);
  var renderPixels = (typeof getRenderPixelLoad === 'function') ? getRenderPixelLoad() : cssPixels;
  if (cssPixels >= 7200000 || renderPixels >= 5000000) return 2;
  if (cssPixels >= 3200000 || renderPixels >= 3600000) return 1;
  return 0;
}
// ============================================================
//  WebGL 渲染器：必须 fail-open
//
//  下面这几行原本是顶层裸语句 `new THREE.WebGLRenderer(...)`。而 125 个模块是合并成
//  【单个】script 一次求值的（见 index-loader.js 注释：分块求值会打断跨文件 function 提升），
//  所以任何一行顶层未捕获异常都会把它之后的全部模块一起带走 —— 只留下被提升的函数声明。
//
//  实测（.workbuddy/harness/diag-splash-stuck.js，关掉 GPU 起 Electron）：
//    THREE.WebGLRenderer: Error creating WebGL context → throw
//    → 从这一行起，02-visual / 03-beat / 05-playback / 07-fx / 10-shell / 11-main-loop
//      的顶层语句全都不执行：`var splashShownAt = 0` 永不赋值（保持 undefined），
//      `initSplashDomBindings()` 永不被调用（开屏没有点击监听、没有最短时长计时器），
//      但 `tryMarkSplashReadyFromBoot` 因函数提升仍然存在 → 它在 loader 把进度推到 100 后被调起，
//      `elapsed = splashShownAt ? (now - splashShownAt) : 0` 恒为 0 → 每 50ms 重试、永不出队
//    → 开屏进度停在 100%，点击无反应，主循环也没起来。
//
//  所以这里必须兜住：拿不到 WebGL 就给一个惰性桩（不是 null，避免 89 处 renderer.xxx
//  逐帧抛错把主循环也打死），并留下可见的降级痕迹。
// ============================================================

/** 惰性替身：任何属性访问都返回「可调用、可继续取属性」的空实现。 */
function createInertRendererLike() {
  var fn = function () { return createInertRendererLike(); };
  return new Proxy(fn, {
    get: function (target, key) {
      if (key === 'then') return undefined;                 // 别被 await 当成 thenable
      if (key === Symbol.toPrimitive) return function (hint) { return hint === 'string' ? '' : 0; };
      if (key === 'toString' || key === 'valueOf') return function () { return 0; };
      if (key === 'toJSON') return function () { return null; };
      if (key === 'length') return 0;
      if (!(key in target)) target[key] = createInertRendererLike();
      return target[key];
    },
    set: function (target, key, value) { target[key] = value; return true; },
    apply: function () { return createInertRendererLike(); },
    construct: function () { return createInertRendererLike(); }
  });
}

/** WebGL 不可用时的 renderer 桩：保留一个真 canvas（要被 append 到 #canvas-container），其余全部惰性。 */
function createInertRendererStub(host) {
  var canvas = document.createElement('canvas');
  canvas.className = 'mineradio-renderer-stub';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.background = 'transparent';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  var stub = createInertRendererLike();
  // 下面这几个必须给真值：拿桩当数值用会变成 0 / NaN（NaN 一旦进 uniform 就是整行消失那一类问题）
  stub.domElement = canvas;
  stub.domElementIsInertStub = true;
  stub.getPixelRatio = function () { return 1; };
  stub.getSize = function (target) {
    if (target && typeof target.set === 'function') { target.set(innerWidth, innerHeight); return target; }
    return { width: innerWidth, height: innerHeight };
  };
  stub.getContext = function () { return createInertRendererLike(); };
  stub.capabilities = { isWebGL2: false, isWebGL1: false, getMaxAnisotropy: function () { return 1; } };
  stub.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [], autoReset: true };
  stub.setSize = function () {};
  stub.setPixelRatio = function () {};
  stub.setClearColor = function () {};
  stub.setClearAlpha = function () {};
  stub.clear = function () {};
  stub.render = function () {};
  stub.compile = function () {};
  stub.dispose = function () {};
  if (host && host.appendChild) host.appendChild(canvas);
  return stub;
}

var rendererUnavailableReason = '';
var renderer = (function createMineradioRenderer() {
  try {
    var real = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    real.setClearColor(0x000000, 0);
    real.setPixelRatio(getRenderPixelRatio());
    real.setSize(innerWidth, innerHeight);
    real.domElement.style.background = 'transparent';
    real.domElement.style.display = 'block';
    real.domElement.style.width = '100%';
    real.domElement.style.height = '100%';
    real.domElement.tabIndex = 0;
    var host = document.getElementById('canvas-container');
    if (host) host.appendChild(real.domElement);
    return real;
  } catch (rendererErr) {
    rendererUnavailableReason = (rendererErr && rendererErr.message) || String(rendererErr);
    console.error('[renderer] WebGL 不可用，已降级为惰性桩（3D 舞台失效，其余功能继续）:', rendererUnavailableReason);
    try {
      window.__mineradioRendererUnavailable = rendererUnavailableReason;
      document.body.classList.add('mineradio-no-webgl');
    } catch (_) {}
    return createInertRendererStub(document.getElementById('canvas-container'));
  }
})();

