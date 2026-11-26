function lyricHighImpactTextHsl(hsl, opts) {
  opts = opts || {};
  hsl = hsl || { h: 0.52, s: 0.72, l: 0.72 };
  var avgL = opts.avgL == null ? hsl.l : Number(opts.avgL);
  var neutral = hsl.s < (opts.neutralCutoff == null ? 0.035 : opts.neutralCutoff);
  var sampledBright = hsl.l >= 0.62 || avgL >= 0.64 || opts.sampledBright === true;
  var minS = opts.minS == null ? 0.88 : Number(opts.minS);
  var s = neutral ? 0 : (sampledBright
    ? clampRange(Math.max(hsl.s, minS), 0, 1)
    : clampRange(Math.max(hsl.s * 1.20, minS), 0, 1));
  var l = sampledBright
    ? clampRange(Math.max(hsl.l, 0.70), 0.66, 0.94)
    : clampRange(Math.max(hsl.l + 0.30, 0.74), 0.70, 0.90);
  return {
    h: hsl.h,
    s: s,
    l: l,
    neutral: neutral,
    sampledBright: sampledBright
  };
}
function lyricMultiLineGlowDetached() {
  var displayMode = typeof normalizeLyricDisplayMode === 'function' ? normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) : String(fx && fx.lyricDisplayMode || 'single');
  var translationMode = typeof normalizeLyricTranslationMode === 'function' ? normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) : String(fx && fx.lyricTranslationMode || 'off');
  return displayMode !== 'single' || translationMode === 'multi' || translationMode === 'dual';
}
function lyricDetachedGlowThreeColor(fallback, minLum) {
  return lyricThreeColor((fx && fx.lyricGlowColor) || (fxDefaults && fxDefaults.lyricGlowColor) || '#008aff', fallback || '#008aff', minLum == null ? 0.36 : minLum);
}
function lyricResolvedGlowColor(pal, fallback) {
  pal = pal || {};
  return pal.glowColor || pal.secondary || pal.highlight || pal.primary || fallback || '#9cffdf';
}
function lyricStageGlowThreeColor(pal, fallback, minLum) {
  pal = pal || {};
  return lyricThreeColor(lyricResolvedGlowColor(pal, fallback || '#9cffdf'), fallback || '#9cffdf', minLum == null ? 0.36 : minLum);
}
function lyricBeatGlowThreeColor(pal, fallback, minLum) {
  pal = pal || {};
  return lyricThreeColor(lyricResolvedGlowColor(pal, fallback || '#fff0b8'), fallback || '#fff0b8', minLum == null ? 0.50 : minLum);
}
function lyricRowGlowThreeColor(pal, isTranslation) {
  pal = pal || {};
  if (fx && fx.lyricGlowLinked === false) return lyricDetachedGlowThreeColor(isTranslation ? '#fff2bf' : '#9cffdf', isTranslation ? 0.34 : 0.40);
  return isTranslation
    ? lyricThreeColor(lyricResolvedGlowColor(pal, '#fff2bf'), '#fff2bf', 0.34)
    : lyricThreeColor(lyricResolvedGlowColor(pal, '#9cffdf'), '#9cffdf', 0.40);
}
function setLyricMaterialColor(mat, color) {
  if (!mat || !color) return;
  if (mat.uniforms && mat.uniforms.uColor) mat.uniforms.uColor.value.copy(color);
  else if (mat.color) mat.color.copy(color);
  mat.needsUpdate = true;
}
/* ────────────────────────────────────────────────────────────────────────────
 * ⚠ 本文件（07）里的 applyLyricPaletteToMesh / effectiveLyricPalette / setStageLyricPalette
 *   都是【死代码】：index-loader.js 把所有模块合并成同一 script 求值以保留函数提升，
 *   同作用域重名函数后声明者胜出；加载顺序 07(第 77 行) → 10(第 79 行)，所以 10 覆盖本文件。
 *   真正生效的是 10-lyrics-mask-shaders.js 里的同名函数。
 *   保留本份是为了「加载顺序一旦变化（例如退 legacy 合并策略）语义不退化」，
 *   因此这三处的语义改动必须与 10 同步。
 *   本文件里唯一真正生效的是 applyStageLyricPaletteNow（10 没有同名函数），
 *   但它只被本文件那份死掉的 setStageLyricPalette 调用 —— 即运行期不会被触发。
 * ──────────────────────────────────────────────────────────────────────────── */
function applyLyricPaletteToMesh(mesh) {
  if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
  var pal = stageLyrics.palette || {};
  var data = mesh.userData.lyric;
  if (data.textMat && data.textMat.uniforms) {
    var u = data.textMat.uniforms;
    if (u.uBaseColor) u.uBaseColor.value.copy(lyricThreeColor(pal.primary, '#d6f8ff', 0.38));
    if (u.uHiColor) u.uHiColor.value.copy(lyricThreeColor(pal.highlight || pal.primary, '#fff0b8', 0.48));
    if (u.uGlowColor) u.uGlowColor.value.copy(lyricStageGlowThreeColor(pal, '#9cffdf', 0.36));
    if (u.uSolarColor) u.uSolarColor.value.copy(lyricBeatGlowThreeColor(pal, '#fff0b8', 0.50));
    if (u.uSolar && !isFinite(u.uSolar.value)) u.uSolar.value = 0;
    if (u.uOpacity && !isFinite(u.uOpacity.value)) u.uOpacity.value = 0;
    data.textMat.needsUpdate = true;
  }
  if (data.glowMat) data.glowMat.color.copy(lyricStageGlowThreeColor(pal, '#9cffdf', 0.36));
  if (data.contextMat) data.contextMat.color.copy(lyricThreeColor(pal.primary || pal.secondary, '#d6f8ff', 0.34));
  if (data.rowLayers) {
    data.rowLayers.forEach(function (row) {
      if (!row || !row.mat) return;
      if (row.glowMat) setLyricMaterialColor(row.glowMat, lyricRowGlowThreeColor(pal, !!row.isTranslation));
      if (row.mat.uniforms) {
        var ru = row.mat.uniforms;
        if (ru.uBaseColor) ru.uBaseColor.value.copy(lyricThreeColor(pal.primary, '#d6f8ff', 0.38));
        if (ru.uHiColor) ru.uHiColor.value.copy(lyricThreeColor(pal.highlight || pal.primary, '#fff0b8', 0.48));
        if (ru.uGlowColor) ru.uGlowColor.value.copy(lyricStageGlowThreeColor(pal, '#9cffdf', 0.36));
        if (ru.uSolarColor) ru.uSolarColor.value.copy(lyricBeatGlowThreeColor(pal, '#fff0b8', 0.50));
        if (ru.uColor) ru.uColor.value.copy(row.isTranslation
          ? lyricThreeColor(pal.highlight || pal.primary, '#eaf6ff', 0.42)
          : lyricThreeColor(pal.primary || pal.secondary, '#d6f8ff', 0.34));
        row.mat.needsUpdate = true;
        return;
      }
      if (row.mat.color) {
        row.mat.color.copy(row.isTranslation
          ? lyricThreeColor(pal.highlight || pal.primary, '#eaf6ff', 0.42)
          : lyricThreeColor(pal.primary || pal.secondary, '#d6f8ff', 0.34));
      }
    });
  }
  if (data.sparkMat) setLyricSparkColor(data, lyricBeatGlowThreeColor(pal, '#fff0b8', 0.46));
  if (data.sunMat) data.sunMat.color.copy(lyricBeatGlowThreeColor(pal, '#fff0b8', 0.50));
}
function effectiveLyricPalette(pal) {
  var src = pal || stageLyrics.coverPalette || stageLyrics.palette || {};
  var out = {
    primary: src.primary || '#d6f8ff',
    secondary: src.secondary || '#9cffdf',
    highlight: src.highlight || '#eef7ff',
    shadow: src.shadow || 'rgba(2,8,12,0.42)',
    glow: src.glow || 'rgba(143,233,255,0.34)',
    glowColor: src.glowColor || null
  };
  if (fx.lyricHighlightMode === 'custom') {
    var hi = lyricPaletteFromHex(fx.lyricHighlightColor);
    out.highlight = hi.primary;
    if (fx.lyricGlowLinked !== false) {
      out.glowColor = hi.secondary || hi.primary;
      out.glow = hi.glow || out.glow;
    }
  }
  if (fx.lyricGlowLinked === false) {
    var glowPal = lyricPaletteFromHex(fx.lyricGlowColor || '#9db8cf');
    out.glowColor = glowPal.primary;
    out.glow = glowPal.glow || out.glow;
  }
  if (!out.glowColor) out.glowColor = out.secondary;
  return out;
}
var lyricPaletteTween = null;
function lerpStageLyricPaletteColor(fromCss, toCss, t, fallback, minLum) {
  var from = lyricThreeColor(fromCss, fallback, minLum);
  var to = lyricThreeColor(toCss, fallback, minLum);
  from.lerp(to, clampRange(Number(t) || 0, 0, 1));
  return '#' + from.getHexString();
}
function mixStageLyricPalette(from, to, t) {
  from = from || {};
  to = to || {};
  return {
    primary: lerpStageLyricPaletteColor(from.primary, to.primary, t, '#d6f8ff', 0.38),
    secondary: lerpStageLyricPaletteColor(from.secondary, to.secondary, t, '#9cffdf', 0.36),
    highlight: lerpStageLyricPaletteColor(from.highlight, to.highlight, t, '#fff0b8', 0.48),
    shadow: t >= 0.999 ? (to.shadow || from.shadow || 'rgba(2,8,12,0.42)') : (from.shadow || to.shadow || 'rgba(2,8,12,0.42)'),
    glow: t >= 0.999 ? (to.glow || from.glow || 'rgba(143,233,255,0.34)') : (from.glow || to.glow || 'rgba(143,233,255,0.34)'),
    glowColor: lerpStageLyricPaletteColor(from.glowColor || from.secondary, to.glowColor || to.secondary, t, '#9cffdf', 0.36)
  };
}
function applyStageLyricPaletteNow(pal) {
  stageLyrics.palette = pal || effectiveLyricPalette(null);
  lyricSunColor.copy(lyricStageGlowThreeColor(stageLyrics.palette, '#ffe6a4', 0.44));
  lyricSunHotColor.copy(lyricBeatGlowThreeColor(stageLyrics.palette, '#fff4cc', 0.54));
  applyLyricPaletteToMesh(stageLyrics.current);
  stageLyrics.outgoing.forEach(applyLyricPaletteToMesh);
  if (typeof stageLyricPrewarm !== 'undefined' && stageLyricPrewarm && stageLyricPrewarm.mesh) {
    applyLyricPaletteToMesh(stageLyricPrewarm.mesh);
  }
  syncSkullParticleColors();
}
function setStageLyricPalette(pal, opts) {
  var target = effectiveLyricPalette(pal);
  var current = effectiveLyricPalette(stageLyrics.palette || target);
  var duration = opts && opts.durationMs != null ? Number(opts.durationMs) : 520;
  var hidden = (typeof isHiddenForBackgroundOptimization === 'function' && isHiddenForBackgroundOptimization()) || (typeof isDeepBackgroundMode === 'function' && isDeepBackgroundMode());
  var hasVisibleLyrics = !!(stageLyrics && (stageLyrics.current || (stageLyrics.outgoing && stageLyrics.outgoing.length)));
  if (lyricPaletteTween && lyricPaletteTween.raf) cancelAnimationFrame(lyricPaletteTween.raf);
  lyricPaletteTween = null;
  if ((opts && opts.immediate) || hidden || !hasVisibleLyrics || duration <= 1) {
    applyStageLyricPaletteNow(target);
    return;
  }
  var start = performance.now();
  duration = clampRange(duration, 120, 1200);
  function step(now) {
    var raw = clampRange((now - start) / duration, 0, 1);
    var eased = (typeof visualEase === 'function') ? visualEase(raw) : (raw * raw * (3 - 2 * raw));
    applyStageLyricPaletteNow(mixStageLyricPalette(current, target, eased));
    if (raw < 1) {
      lyricPaletteTween = { raf: requestAnimationFrame(step) };
    } else {
      applyStageLyricPaletteNow(target);
      lyricPaletteTween = null;
    }
  }
  lyricPaletteTween = { raf: requestAnimationFrame(step) };
}
function lyricCoverSampleCss(sample, fallback) {
  if (!sample || !isFinite(Number(sample.score)) || Number(sample.score) < 0) return fallback || '#d6f8ff';
  return rgbCss({
    r: Math.round(clampRange(Number(sample.r) || 0, 0, 255)),
    g: Math.round(clampRange(Number(sample.g) || 0, 0, 255)),
    b: Math.round(clampRange(Number(sample.b) || 0, 0, 255))
  });
}
function lyricCoverSample(r, g, b, score, lum, chroma, hsl) {
  return {
    score: score,
    r: r,
    g: g,
    b: b,
    lum: lum,
    chroma: chroma,
    hsl: hsl || rgbToHsl(r, g, b)
  };
}
function lyricCoverLooksMonochrome(stats) {
  stats = stats || {};
  var avgChroma = Number(stats.avgChroma) || 0;
  var maxChroma = Number(stats.maxChroma) || 0;
  var colorfulRatio = Number(stats.colorfulRatio) || 0;
  var usableColorfulRatio = Number(stats.usableColorfulRatio) || 0;
  return maxChroma < 0.095 || avgChroma < 0.026 || colorfulRatio < 0.014 || usableColorfulRatio < 0.006;
}
function lyricCoverPushUniqueColor(list, value) {
  value = String(value || '').trim();
  if (!value) return;
  var key = value.replace(/\s+/g, '').toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (String(list[i] || '').replace(/\s+/g, '').toLowerCase() === key) return;
  }
  list.push(value);
}
function lyricCoverAreaDistance(a, b) {
  if (!a || !b) return 1;
  var dr = ((Number(a.r) || 0) - (Number(b.r) || 0)) / 255;
  var dg = ((Number(a.g) || 0) - (Number(b.g) || 0)) / 255;
  var db = ((Number(a.b) || 0) - (Number(b.b) || 0)) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
function lyricCoverAddAreaBucket(buckets, r, g, b) {
  var step = 24;
  var key = [
    Math.round(r / step),
    Math.round(g / step),
    Math.round(b / step)
  ].join(':');
  var item = buckets[key];
  if (!item) item = buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
  item.r += r;
  item.g += g;
  item.b += b;
  item.count += 1;
}
function lyricCoverAreaBucketList(buckets) {
  return Object.keys(buckets || {}).map(function (key) {
    var item = buckets[key];
    var count = Math.max(1, Number(item.count) || 1);
    var sample = {
      r: Math.round(item.r / count),
      g: Math.round(item.g / count),
      b: Math.round(item.b / count),
      count: count,
      score: count
    };
    sample.lum = (sample.r * 0.299 + sample.g * 0.587 + sample.b * 0.114) / 255;
    sample.hsl = rgbToHsl(sample.r, sample.g, sample.b);
    sample.chroma = (Math.max(sample.r, sample.g, sample.b) - Math.min(sample.r, sample.g, sample.b)) / 255;
    return sample;
  }).sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return b.chroma - a.chroma;
  });
}
function lyricCoverPickAreaColor(list, test, fallback, avoid, minDistance) {
  list = Array.isArray(list) ? list : [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (test && !test(item)) continue;
    if (avoid && lyricCoverAreaDistance(item, avoid) < (minDistance || 0.06)) continue;
    return item;
  }
  return fallback || list[0] || null;
}
function lyricCoverAreaPaletteFromBuckets(buckets) {
  var list = lyricCoverAreaBucketList(buckets);
  if (!list.length) return null;
  var primary = lyricCoverPickAreaColor(list, function (item) {
    return item.lum > 0.035 && item.lum < 0.965;
  }, list[0]);
  var base = lyricCoverPickAreaColor(list, function (item) {
    return item.lum < Math.min(0.46, (primary && primary.lum || 0.5) + 0.10);
  }, primary);
  var warm = lyricCoverPickAreaColor(list, function (item) {
    return item.chroma > 0.055 && item.hsl.s > 0.08 && (item.hsl.h < 0.18 || item.hsl.h > 0.90);
  }, primary);
  var cool = lyricCoverPickAreaColor(list, function (item) {
    return item.chroma > 0.055 && item.hsl.s > 0.08 && item.hsl.h > 0.42 && item.hsl.h < 0.78;
  }, primary, warm, 0.055);
  var light = lyricCoverPickAreaColor(list, function (item) {
    return item.lum > 0.52;
  }, primary);
  var accent = lyricCoverPickAreaColor(list, function (item) {
    return item.chroma > 0.075 && item.hsl.s > 0.10 && item.lum > 0.10 && item.lum < 0.92;
  }, light || primary, primary, 0.075);
  return {
    primary: primary,
    base: base,
    warm: warm,
    cool: cool,
    light: light,
    accent: accent,
    colors: list.slice(0, 10).map(function (item) { return lyricCoverSampleCss(item, ''); }).filter(Boolean)
  };
}
function lyricCurrentCoverPaletteKey() {
  try {
    var song = null;
    if (Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length) song = playQueue[currentIdx];
    else if (Array.isArray(playlist) && currentIdx >= 0 && currentIdx < playlist.length) song = playlist[currentIdx];
    if (!song) return '';
    if (typeof songCoverSrc === 'function') return String(songCoverSrc(song, 400) || song.cover || song.id || '');
    return String(song.cover || song.customCover || song.id || song.name || '');
  } catch (e) {
    return '';
  }
}