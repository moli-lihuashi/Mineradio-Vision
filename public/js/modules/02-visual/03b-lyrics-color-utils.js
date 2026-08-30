function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h:h, s:s, l:l };
}
function hslToRgb(h, s, l) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  var r, g, b;
  if (s === 0) r = g = b = l;
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r:Math.round(r * 255), g:Math.round(g * 255), b:Math.round(b * 255) };
}
function rgbCss(c, a) {
  if (a == null) return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}
function clampRange(v, min, max) { return Math.max(min, Math.min(max, v)); }
function throttle(fn, delay) {
  var last = 0, timer = null;
  return function throttled() {
    var now = Date.now();
    var remaining = delay - (now - last);
    var args = arguments, ctx = this;
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn.apply(ctx, args);
    } else if (!timer) {
      timer = setTimeout(function(){
        last = Date.now();
        timer = null;
        fn.apply(ctx, args);
      }, remaining);
    }
  };
}
function debounce(fn, delay) {
  var timer = null;
  return function debounced() {
    var args = arguments, ctx = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function(){
      timer = null;
      fn.apply(ctx, args);
    }, delay);
  };
}
function normalizeCoverResolution(v) {
  return clampRange(Number(v) || 1, 0.75, 1.55);
}
function normalizePerformanceBackgroundMode(v, liveKeepFallback) {
  var value = String(v || '');
  if (value === 'keep' || liveKeepFallback === true) return 'keep';
  if (value === 'release') return 'release';
  return 'auto';
}
function normalizePerformanceQuality(v) {
  var value = String(v || '').trim().toLowerCase();
  if (value === 'auto') return 'auto';
  return /^(eco|balanced|high|ultra)$/.test(value) ? value : 'auto';
}
function suggestPerformanceQualityFromHardware() {
  var profile = (typeof runtimeHardwareProfile !== 'undefined' && runtimeHardwareProfile) || {};
  if (profile.lowSpec) return 'eco';
  if (profile.balancedSpec) return 'balanced';
  return 'high';
}
function resolvedPerformanceQuality() {
  var q = normalizePerformanceQuality(fx && fx.performanceQuality);
  if (q === 'auto') return suggestPerformanceQualityFromHardware();
  return q;
}
function normalizeForegroundFpsMode(value) {
  var mode = String(value || '').trim().toLowerCase();
  if (mode === 'vsync' || mode === 'adaptive') return mode;
  if (/^(30|45|60|75|90|120)$/.test(mode)) return mode;
  return fxDefaults.foregroundFpsMode || 'vsync';
}
function normalizeGpuThrottleMode(value) {
  var mode = String(value || '').trim().toLowerCase();
  if (mode === 'on' || mode === 'off' || mode === 'auto') return mode;
  return fxDefaults.gpuThrottleMode || 'auto';
}
function foregroundFixedFpsForMode(mode) {
  mode = normalizeForegroundFpsMode(mode);
  if (mode === 'vsync') return 0;
  if (mode === 'adaptive') return null;
  return Math.max(1, Number(mode) || 60);
}
/** 帧率以 FX 面板为准：固定档原样；跟随屏幕=VSync；仅「自适应」才按画质/帧压自动选档 */
function resolvedForegroundRenderFps() {
  var mode = normalizeForegroundFpsMode(fx && fx.foregroundFpsMode);
  var fixed = foregroundFixedFpsForMode(mode);
  if (fixed > 0) return fixed;
  if (mode !== 'adaptive') return 0; // vsync：不偷改面板选择
  var quality = typeof resolvedPerformanceQuality === 'function' ? resolvedPerformanceQuality() : 'balanced';
  var pressure = typeof adaptiveLoadPressureLevel === 'function' ? adaptiveLoadPressureLevel() : 0;
  if (quality === 'eco') return pressure >= 1 ? 30 : 36;
  if (quality === 'balanced') return pressure >= 2 ? 30 : (pressure >= 1 ? 45 : 60);
  if (pressure >= 2) return 45;
  return 0;
}
function effectiveCoverResolution(v) {
  var base = normalizeCoverResolution(v != null ? v : (fx && fx.coverResolution));
  var quality = typeof resolvedPerformanceQuality === 'function' ? resolvedPerformanceQuality() : 'balanced';
  var profile = (typeof runtimeHardwareProfile !== 'undefined' && runtimeHardwareProfile) || {};
  // P1.5：eco/balanced 再压有效网格（点径在 shader/drawRange 侧补偿）
  if (quality === 'eco') return Math.min(base, profile.lowSpec ? 0.76 : 0.86);
  if (quality === 'balanced') return Math.min(base, profile.lowSpec ? 0.96 : 1.06);
  return base;
}
/** P0：奇偶帧各画一半封面粒子。低配默认开（含 high）；超高满量。可 fx.particleTemporalSubset 强制 */
function particleTemporalSubsetEnabled() {
  if (fx && fx.particleTemporalSubset === true) return true;
  if (fx && fx.particleTemporalSubset === false) return false;
  // 封面溶入/重组期禁止隔帧：奇偶跳点会看起来发飘、不稳定
  if (typeof coverTransitionReliefActive === 'function' && coverTransitionReliefActive()) return false;
  var quality = typeof resolvedPerformanceQuality === 'function' ? resolvedPerformanceQuality() : 'balanced';
  var profile = (typeof runtimeHardwareProfile !== 'undefined' && runtimeHardwareProfile) || {};
  if (quality === 'ultra') return false;
  if (profile.lowCore || profile.lowSpec) return true;
  if (quality === 'eco' || quality === 'balanced') return true;
  return false;
}
function coverParticleGridForResolution(v) {
  var grid = Math.round(118 * effectiveCoverResolution(v));
  var quality = (typeof resolvedPerformanceQuality === 'function') ? resolvedPerformanceQuality() : 'balanced';
  var maxGrid = 183;
  if (quality === 'eco') maxGrid = 121;
  else if (quality === 'balanced') maxGrid = 143;
  grid = Math.max(72, Math.min(maxGrid, grid));
  return grid % 2 ? grid : grid + 1;
}
function coverParticleCountLabel(v) {
  var grid = coverParticleGridForResolution(v);
  return grid + 'x' + grid;
}
function coverTextureSizeForResolution(v) {
  v = normalizeCoverResolution(v);
  if (v >= 1.32) return 512;
  if (v >= 1.10) return 384;
  return 256;
}
