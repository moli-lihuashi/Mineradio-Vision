var STAGE_LYRIC_MAX_LINES = 1;
var STAGE_LYRIC_DISPLAY_MODES = { single: 1, dual: 1, triple: 1, cinema: 1, custom: 1 };
var STAGE_LYRIC_TRANSLATION_MODES = { off: 1, current: 1, dual: 1, multi: 1 };
var STAGE_LYRIC_MOTION_STYLES = { glass: 1, smooth: 1, float: 1, quick: 1, shine: 1, glitch: 1 };

function normalizeLyricDisplayMode(mode) {
  mode = String(mode || 'single');
  return STAGE_LYRIC_DISPLAY_MODES[mode] ? mode : 'single';
}
function normalizeLyricTranslationMode(mode) {
  mode = String(mode || 'off');
  return STAGE_LYRIC_TRANSLATION_MODES[mode] ? mode : 'off';
}
function lyricCustomLineCountValue() {
  // lyricCustomLines 是滑块/持久化/预设档案的唯一真字段；
  // lyricCustomLineCount 是恒为默认值的旧字段，若优先读它会把滑块值永久遮蔽。
  var raw = fx && fx.lyricCustomLines != null
    ? Number(fx.lyricCustomLines)
    : (fx && fx.lyricCustomLineCount != null ? Number(fx.lyricCustomLineCount) : (fxDefaults && (fxDefaults.lyricCustomLines != null ? fxDefaults.lyricCustomLines : fxDefaults.lyricCustomLineCount)));
  if (!isFinite(raw)) raw = 3;
  return clampRange(Math.round(raw), 1, 10);
}
function lyricDisplayLineCountForMode(mode) {
  mode = normalizeLyricDisplayMode(mode);
  if (mode === 'single') return 1;
  if (mode === 'dual') return 2;
  if (mode === 'triple') return 3;
  if (mode === 'cinema') return 5;
  return lyricCustomLineCountValue();
}
function lyricDisplayOffsetsForMode(mode) {
  mode = normalizeLyricDisplayMode(mode);
  if (mode === 'single') return [0];
  if (mode === 'dual') return [0, 1];
  var count = lyricDisplayLineCountForMode(mode);
  var activeSlot = Math.floor(count / 2);
  var offsets = [];
  for (var i = 0; i < count; i++) offsets.push(i - activeSlot);
  return offsets;
}
/**
 * 行层轨道（track）的「显示模式」必须以实时 fx 为准，不能用建 mesh 时的快照。
 *
 * 踩坑（症状：自定义行数最多 3 行 / 拖行数滑块没反应）：
 *   data.displayMode 是建 mesh 那一刻对 payload.mode 的快照
 *   （13-lyrics-mesh-build.js 写 data.displayMode ← rowLayerBundle.displayMode
 *    ← 12-lyrics-row-layers.js 的 state.payload.mode）。
 *   用户切「单行/双行/三行/沉浸/自定」或拖动「显示行数」滑块时，轨道 mesh 只是被
 *   setLyricTrackTarget() 重新指向新行，data.displayMode 从不更新；而
 *   lyricLineAllowedForDisplayMode() 正好用它决定哪些行允许显示（不允许的行
 *   contextAlpha→0、visibleFade→0、mesh.visible=false、行窗口不补建）。
 *   于是「三行时建的轨道」之后永远只显示 3 行 —— 无论滑块拖到几行。
 *
 * 只对 usesTrack 的轨道 mesh 采用实时值；legacy（单行/预告）路径保持原快照语义。
 */
function lyricTrackDisplayModeFor(data) {
  if (data && data.usesTrack && fx && fx.lyricDisplayMode) {
    return normalizeLyricDisplayMode(fx.lyricDisplayMode);
  }
  return normalizeLyricDisplayMode((data && data.displayMode) || (fx && fx.lyricDisplayMode));
}
/** 轨道可见半径同样跟随实时模式/行数，否则新行数的行会被 visibleFade 渐隐为 0 */
function lyricTrackVisibleRadiusFor(mode) {
  return Math.max(0.85, lyricDisplayLineCountForMode(mode) * 0.50 * lyricPrimarySlotStepValue());
}
function normalizeLyricMotionStyle(style) {
  style = String(style || 'float');
  return STAGE_LYRIC_MOTION_STYLES[style] ? style : 'float';
}
/**
 * 统一的 fx 数值读取：fx → fxDefaults → 显式兜底，且任何非有限值都退回兜底。
 * 历史坑：fxDefaults 里从来没有 lyricContextOpacity / lyricContextSpread /
 * lyricTranslationGap 等字段，而 fx.<字段> 也没有任何 UI/预设会写它，
 * 于是 clampRange(undefined, min, max) === NaN 会一路污染：
 *   entry.alpha → row.targetAlpha → contextAlpha → uOpacity →
 *   gl_FragColor = vec4(color, alpha * uOpacity) → 整行不可见。
 * 表现就是「自定义行数失效、永远只显示当前行」。此函数是该类污染的收敛点。
 */
function lyricFxNumber(key, fallback, min, max) {
  var raw;
  if (fx && fx[key] != null) raw = Number(fx[key]);
  else if (fxDefaults && fxDefaults[key] != null) raw = Number(fxDefaults[key]);
  else raw = Number(fallback);
  if (!isFinite(raw)) raw = Number(fallback);
  if (!isFinite(raw)) raw = min;
  return clampRange(raw, min, max);
}
function lyricContextOpacityValue() {
  return lyricFxNumber('lyricContextOpacity', 0.62, 0.25, 1);
}
function lyricContextSpreadValue() {
  return lyricFxNumber('lyricContextSpread', 1.30, 0.60, 2.40);
}
function lyricTranslationGapValue() {
  return lyricFxNumber('lyricTranslationGap', 0.62, 0.28, 2.20);
}
function lyricTranslationVisualGapValue() {
  var gap = lyricTranslationGapValue();
  var scale = lyricTranslationScaleValue();
  return clampRange(0.98 + (gap - 0.28) * 0.36 + Math.max(0, scale - 0.66) * 0.12, 0.92, 2.20);
}
function lyricTranslationLayoutActive() {
  return normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off';
}
function lyricPrimarySlotStepValue() {
  if (!lyricTranslationLayoutActive()) return 1;
  return clampRange(lyricTranslationVisualGapValue() + 0.82 + lyricTranslationScaleValue() * 0.14, 1.78, 2.88);
}
function lyricLineTranslationTextAt(index) {
  var line = lyricsLines && lyricsLines[index];
  return typeof normalizeLyricTranslationText === 'function'
    ? normalizeLyricTranslationText(line && line.translation)
    : String((line && line.translation) || '').trim();
}
function lyricLineHasTranslationAt(index) {
  if (!lyricTranslationLayoutActive()) return false;
  var n = Math.max(0, Math.round(Number(index) || 0));
  return !!lyricLineTranslationTextAt(n);
}
function lyricLineSlotStepValue(index) {
  if (!lyricTranslationLayoutActive()) return 1;
  var n = Math.round(Number(index) || 0);
  var needsTranslationSlot = lyricLineHasTranslationAt(n) || (n >= 0 && lyricLineHasTranslationAt(n + 1));
  return needsTranslationSlot ? lyricPrimarySlotStepValue() : clampRange(1.04 + (lyricContextSpreadValue() - 1) * 0.10, 0.96, 1.24);
}
var lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
function lyricPrimaryVirtualPrefixKey() {
  var first = lyricsLines && lyricsLines[0];
  var last = lyricsLines && lyricsLines.length ? lyricsLines[lyricsLines.length - 1] : null;
  return [
    lyricTranslationLayoutActive() ? 1 : 0,
    Math.round(lyricTranslationGapValue() * 1000),
    Math.round(lyricTranslationScaleValue() * 1000),
    Math.round(lyricContextSpreadValue() * 1000),
    lyricsLines ? lyricsLines.length : 0,
    lyricsTranslationLines ? lyricsTranslationLines.length : 0,
    first ? normalizeLyricTranslationText(first.translation).slice(0, 12) : '',
    last ? normalizeLyricTranslationText(last.translation).slice(0, 12) : ''
  ].join('|');
}
function lyricPrimaryVirtualIndex(index) {
  var n = Math.round(Number(index) || 0);
  if (!isFinite(n) || n === 0) return 0;
  if (!lyricTranslationLayoutActive()) return n;
  if (n < 0) return n * lyricPrimarySlotStepValue();
  var key = lyricPrimaryVirtualPrefixKey();
  if (!lyricPrimaryVirtualPrefixCache || lyricPrimaryVirtualPrefixCache.key !== key) {
    lyricPrimaryVirtualPrefixCache = { key: key, values: [0] };
  }
  var values = lyricPrimaryVirtualPrefixCache.values;
  for (var i = values.length; i <= n; i++) values[i] = values[i - 1] + lyricLineSlotStepValue(i - 1);
  return values[n] || 0;
}
function lyricTranslationVirtualIndex(parentIndex) {
  return lyricPrimaryVirtualIndex(parentIndex) + lyricTranslationVisualGapValue();
}
function lyricTranslationScaleValue() {
  return lyricFxNumber('lyricTranslationScale', 0.78, 0.46, 1.12);
}
function lyricTranslationOpacityValue() {
  return lyricFxNumber('lyricTranslationOpacity', 0.66, 0.20, 1);
}
function lyricEdgeFadeValue() {
  return lyricFxNumber('lyricEdgeFade', 0.30, 0, 1);
}
function lyricMotionSoftnessValue() {
  // 注意：fxDefaults 里从来没有 lyricMotionSoftness 字段（历史遗留），
  // 直接读会让 clampRange 收到 undefined → 返回 NaN，
  // 进而污染整个 motion profile。这里给出稳定默认值并对非有限值兜底。
  return lyricFxNumber('lyricMotionSoftness', 0.70, 0.15, 1.2);
}
/** 非有限值兜底：任何 NaN/Infinity 都不能流进 shader uniform（会导致整片元变黑） */
function lyricProfileFinite(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}
function lyricGlitchIntensityValue() {
  return lyricFxNumber('lyricGlitchIntensity', 0.55, 0, 1.5);
}
function lyricGlitchSliceValue() {
  return lyricFxNumber('lyricGlitchSlice', 0.55, 0, 1.4);
}
function lyricGlitchChromaValue() {
  return lyricFxNumber('lyricGlitchChroma', 0.75, 0, 1.6);
}
function lyricGlitchRateValue() {
  return lyricFxNumber('lyricGlitchRate', 1.0, 0.45, 2.2);
}
function lyricGlitchJitterValue() {
  return lyricFxNumber('lyricGlitchJitter', 0.55, 0, 1.8);
}
function lyricMotionProfile() {
  var style = normalizeLyricMotionStyle(fx && fx.lyricMotionStyle);
  var soft = lyricMotionSoftnessValue();
  var profile = {
    style: style,
    enter: 0.54,
    exit: 0.46,
    slide: 0.34,
    progressEase: lyricsHasNativeKaraoke ? 0.34 : 0.18,
    contextDrift: 0.060,
    edgeBoost: 1.0,
    sweep: 0.62,
    // 扫光形状：前沿亮唇宽度 / 已唱区余晖拖尾宽度 / 前沿峰值强度（相对 uFeather 的倍数）
    sweepLead: 1.5,
    sweepTail: 2.0,
    sweepPeak: 1.0,
    shimmer: 0.24,
    glitch: 0.0,
    glitchSlice: 0.0,
    glitchChroma: 0.0,
    glitchRate: 1.0,
    glitchJitter: 0.0,
    glitchCameraBind: false,
    glowLift: 1.0,
    floatAmp: 1.0
  };
  if (style === 'smooth') {
    profile.enter = 0.72; profile.exit = 0.62; profile.slide = 0.24; profile.progressEase *= 0.72; profile.contextDrift = 0.030; profile.edgeBoost = 0.62; profile.sweep = 0.18; profile.sweepLead = 1.2; profile.sweepTail = 3.2; profile.sweepPeak = 0.72; profile.shimmer = 0.05; profile.glowLift = 0.74; profile.floatAmp = 0.55;
  } else if (style === 'float') {
    profile.enter = 0.86; profile.exit = 0.76; profile.slide = 0.54; profile.progressEase *= 0.66; profile.contextDrift = 0.120; profile.edgeBoost = 1.04; profile.sweep = 0.36; profile.sweepLead = 1.7; profile.sweepTail = 2.3; profile.sweepPeak = 1.05; profile.shimmer = 0.14; profile.glowLift = 1.16; profile.floatAmp = 1.45;
  } else if (style === 'shine') {
    profile.enter = 0.50; profile.exit = 0.44; profile.slide = 0.34; profile.progressEase *= 1.02; profile.contextDrift = 0.052; profile.edgeBoost = 1.42; profile.sweep = 1.22; profile.sweepLead = 1.0; profile.sweepTail = 1.3; profile.sweepPeak = 1.90; profile.shimmer = 0.34; profile.glowLift = 1.30; profile.floatAmp = 0.82;
  } else if (style === 'glitch') {
    profile.enter = 0.40; profile.exit = 0.36; profile.slide = 0.30; profile.progressEase *= 1.24; profile.contextDrift = 0.035; profile.edgeBoost = 1.18; profile.sweep = 0.54; profile.sweepLead = 1.9; profile.sweepTail = 1.5; profile.sweepPeak = 1.45; profile.shimmer = 0.28; profile.glitch = lyricGlitchIntensityValue(); profile.glitchSlice = lyricGlitchSliceValue(); profile.glitchChroma = lyricGlitchChromaValue(); profile.glitchRate = lyricGlitchRateValue(); profile.glitchJitter = lyricGlitchJitterValue(); profile.glitchCameraBind = !!(fx && fx.lyricGlitchCameraBind); profile.glowLift = 1.08 + profile.glitch * 0.10; profile.floatAmp = 0.70;
  } else if (style === 'quick') {
    profile.enter = 0.36; profile.exit = 0.32; profile.slide = 0.22; profile.progressEase *= 1.34; profile.contextDrift = 0.034; profile.edgeBoost = 0.70; profile.sweep = 0.28; profile.sweepLead = 2.6; profile.sweepTail = 1.0; profile.sweepPeak = 1.25; profile.shimmer = 0.10; profile.glowLift = 0.86; profile.floatAmp = 0.62;
  } else {
    profile.enter = 0.62; profile.exit = 0.52; profile.slide = 0.38; profile.progressEase *= 0.90; profile.contextDrift = 0.066; profile.edgeBoost = 1.18; profile.sweep = 0.72; profile.sweepLead = 1.5; profile.sweepTail = 2.0; profile.sweepPeak = 1.08; profile.shimmer = 0.22; profile.glowLift = 1.0; profile.floatAmp = 1.0;
  }
  profile.enter *= soft;
  profile.exit *= soft;
  profile.slide *= clampRange(0.80 + soft * 0.35, 0.75, 1.28);
  profile.progressEase = clampRange(profile.progressEase / clampRange(soft, 0.35, 1.2), 0.08, 0.72);
  // 柔性越高 → 前沿更钝、余晖拖尾更长（“亮过几个字再衰减”的观感强度随柔性变化）
  profile.sweepLead *= clampRange(0.70 + soft * 0.50, 0.70, 1.32);
  profile.sweepTail *= clampRange(0.60 + soft * 0.72, 0.60, 1.48);
  // 出口统一兜底：进入 shader 的字段一律保证有限
  profile.sweep = lyricProfileFinite(profile.sweep, 0.62);
  profile.sweepLead = lyricProfileFinite(profile.sweepLead, 1.5);
  profile.sweepTail = lyricProfileFinite(profile.sweepTail, 2.0);
  profile.sweepPeak = lyricProfileFinite(profile.sweepPeak, 1.0);
  profile.shimmer = lyricProfileFinite(profile.shimmer, 0.24);
  profile.edgeBoost = lyricProfileFinite(profile.edgeBoost, 1.0);
  profile.glowLift = lyricProfileFinite(profile.glowLift, 1.0);
  profile.glitch = lyricProfileFinite(profile.glitch, 0);
  profile.glitchSlice = lyricProfileFinite(profile.glitchSlice, 0);
  profile.glitchChroma = lyricProfileFinite(profile.glitchChroma, 0);
  profile.glitchRate = lyricProfileFinite(profile.glitchRate, 1);
  profile.enter = lyricProfileFinite(profile.enter, 0.54);
  profile.exit = lyricProfileFinite(profile.exit, 0.46);
  profile.slide = lyricProfileFinite(profile.slide, 0.34);
  profile.progressEase = lyricProfileFinite(profile.progressEase, 0.2);
  profile.contextDrift = lyricProfileFinite(profile.contextDrift, 0.06);
  profile.floatAmp = lyricProfileFinite(profile.floatAmp, 1.0);
  return profile;
}
