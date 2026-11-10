/* Folia 世界 — 歌词样式：浮名（fume）
 *
 * 移植自 Folia src/components/visualizer/fume/（15 个文件 3660 行）+
 *          components/visualizer/FumeBackground.ts（483 行）。
 *
 * 这套样式只有一个想法：**把整首歌当成一篇文章排版，然后让一台相机在文章里巡航**。
 * 管线因此比其它模式大一圈：
 *   1. 版式（fumeArticleLayout）：按视口算纸张宽 → 试 4~1 栏 × 密度二分 →
 *      每行选 body/hero 变体 → pretext 量宽 → 确定性洗牌后落进最短栏；
 *   2. 逐字（fumeReveal/fumeCanvasText）：行内按词/字素时序「印刷」，带辉光与打印方块；
 *   3. 相机（fumeCamera/fumeCameraStep）：焦点块 → 入场焦点 → 弹簧/桥接飞行 + 空闲漂浮；
 *   4. 静止块（fumeBlockFrame）：等待态 / 唱完的行走缓存快照，dimmed 交叉淡变；
 *   5. 背景（FumeBackground）：纸张光晕环/方/十字/火花四种描边图形，按深度排序 + 视差。
 *
 * 关键机位（改动即走形）：
 *   - 落块顺序按 `seeded(seedKey:index:fullText)` 洗牌，同一首歌每次构图一模一样
 *   - hero 变体：语义 chorus（本项目无 TTML，永不触发）+ 4~28 字 + 靠近中部 +
 *     (index+1)%6===0 或 seeded>0.965；一首歌没有任何 hero 时按中心/长度/chorus 分补一个
 *   - 字号：`buildPreparedSingleLine` 对「单行能放下」做 8 次二分；hero 再乘 heroScale
 *   - 行通过时刻 = `min(renderEndTime, 下一行 startTime)`；辉光尾迹 colorTrailDuration
 *     = clamp(lineDuration×(hero?0.42:0.52), 0.45, 1.45)
 *   - 相机 idle 浮动用墙钟 now（不是播放时间），overview 时衰减到 0.36
 *   - passed 文字 textHoldRatio<1 时整体 dimmed，并按 passedFadeDuration 交叉淡回标准态
 *
 * 与 Folia 的实现差异（都不改画面）：
 *   1) Folia 是 React + 自递归 rAF 画布；这里 create/tick 挂到主循环（11-main-loop 的
 *      foliaWorldTick），dt 用主循环的 clamped dt，paused 时跳过绘制（最后一帧留在画布上，
 *      与 Folia 停止重排程的观感一致）。
 *   2) Folia 的 theme 有 name/fontFamily/fontFamilyStack/fontWeight；本项目的 theme
 *      （00-folia-state 的 foliaWorldTheme）给的是解析好的 fontStack + weight，
 *      foliaResolveThemeStack 优先用 fontStack。版式种子键 Folia 用 theme.name（跨主题才变），
 *      本项目没有主题名，用常量 'mineradio'——颜色不进版式，几何等价。
 *   3) Folia 的 audioBands 是 0~255；本项目 bass/mid/treble/vocal 是 0~1，
 *      喂背景前 ×255（与 cadenza 的 audioPower 适配同一判据）。
 *   4) Folia 的 staticMode（VisPlayground 静态预览）本项目没有，相关分支不移植。
 *   5) Folia 的 fumeTuning 有设置面板；本项目调参 UI 未做，先写死 DEFAULT_FUME_TUNING，
 *      接面板时改成 fx 字段（与 classic/cappella 的 tuning 同一处理）。
 *
 * 依赖：@chenglou/pretext（只有 ESM 构建）→ 版式构建走 foliaLoadPretext()，
 *       失败时退出世界并给出可见原因（不静默白屏）。
 */
'use strict';

(function registerFoliaFumeMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* Folia types.ts:446 DEFAULT_FUME_TUNING —— 面板（0l1）与归一化（0l0）用的同一份基准。 */
  var FUME_TUNING_DEFAULT = {
    hidePrintSymbols: false,
    disableGeometricBackground: true,
    backgroundObjectOpacity: 0.5,
    textHoldRatio: 1,
    cameraTrackingMode: 'smooth',
    cameraSpeed: 1,
    glowIntensity: 1,
    heroScale: 1
  };

  /* 当前生效的调参：面板写在 0l0（共用存档），这里只读；0l0 没加载时回落默认值。 */
  function fumeTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('fume')
      : FUME_TUNING_DEFAULT;
  }

  var LAYOUT_REBUILD_DEBOUNCE_MS = 96;
  var FUME_LAYOUT_SEED_KEY = 'mineradio';

  /* ------------------------------------------------------------------ *
   * A. 歌词时序（fumeReveal.ts）
   * ------------------------------------------------------------------ */

  function fumeBuildWordRangesFromWords(line, graphemes) {
    if (!line.words || line.words.length === 0 || graphemes.length === 0) return [];
    var rangedWords = line.words.filter(function (word) { return foliaSplitGraphemes(word.text).length > 0; });
    if (rangedWords.length === 0) return [];
    var ranges = [];
    var cursor = 0;
    for (var wordIndex = 0; wordIndex < rangedWords.length; wordIndex++) {
      var word = rangedWords[wordIndex];
      var wordGraphemes = foliaSplitGraphemes(word.text);
      var start = foliaClamp(cursor, 0, graphemes.length);
      var end = foliaClamp(start + wordGraphemes.length, start, graphemes.length);
      /* 有些歌词源的 word.text 不含词间空格而 fullText 含；把紧跟当前词的空白
       * 并进本词Range，避免后面每个词整体左移、视觉流断掉。 */
      while (end < graphemes.length && /\s/.test(graphemes[end] || '')) end += 1;
      ranges.push({
        wordIndex: wordIndex,
        word: word,
        start: start,
        end: end,
        colorStart: start,
        colorEnd: end,
        graphemeTimings: foliaBuildWordGraphemeTimings(word)
      });
      cursor = end;
    }
    return ranges;
  }

  function fumeResolveWordRevealProgress(range, currentTimeValue) {
    if (range.word.endTime <= range.word.startTime) {
      return currentTimeValue >= range.word.endTime ? 1 : 0;
    }
    var duration = Math.max(range.word.endTime - range.word.startTime, 0.08);
    return foliaClamp((currentTimeValue - range.word.startTime) / duration, 0, 1);
  }

  function fumeResolvePrintedGlyphsInRange(range, currentTimeValue) {
    var length = Math.max(range.end - range.start, 0);
    if (length === 0) return 0;
    if (currentTimeValue < range.word.startTime) return 0;

    var timedGlyphCount = (range.word.syllables && range.word.syllables.length)
      ? Math.min(range.graphemeTimings.length, length) : 0;
    if (timedGlyphCount > 0) {
      if (currentTimeValue >= range.word.endTime) return length;
      var printed = 0;
      for (var index = 0; index < timedGlyphCount; index++) {
        if (currentTimeValue >= range.graphemeTimings[index].startTime) printed = index + 1;
      }
      return foliaClamp(printed, 0, length);
    }

    var progress = fumeResolveWordRevealProgress(range, currentTimeValue);
    if (progress >= 1) return length;
    return foliaClamp(Math.floor(progress * length + 0.2), progress > 0 ? 1 : 0, length);
  }

  function fumeHasRevealCompletedByLineEnd(line, currentTimeValue) {
    return currentTimeValue >= line.endTime;
  }

  function fumeResolveLinePassCutoffTime(line, nextLineStartTime) {
    var renderEndTime = foliaGetLineRenderEndTime(line);
    if (typeof nextLineStartTime !== 'number' || !isFinite(nextLineStartTime)) return renderEndTime;
    return Math.min(renderEndTime, nextLineStartTime);
  }

  function fumeResolveVisualProgressWithCutoff(startedAt, duration, currentTimeValue, cutoffTime) {
    var nominalEndTime = startedAt + Math.max(duration, 0.001);
    var effectiveEndTime = Math.max(startedAt + 0.001, Math.min(nominalEndTime, cutoffTime));
    return foliaClamp((currentTimeValue - startedAt) / Math.max(effectiveEndTime - startedAt, 0.001), 0, 1);
  }

  function fumeResolvePrintedGraphemeCount(line, wordRanges, graphemeCount, currentTimeValue) {
    if (graphemeCount === 0) return 0;
    if (currentTimeValue < line.startTime) return 0;
    if (fumeHasRevealCompletedByLineEnd(line, currentTimeValue)) return graphemeCount;

    if (wordRanges.length === 0) {
      var duration = Math.max(line.endTime - line.startTime, 0.12);
      var progress = foliaClamp((currentTimeValue - line.startTime) / duration, 0, 1);
      return foliaClamp(Math.floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount);
    }

    var printed = 0;
    for (var index = 0; index < wordRanges.length; index++) {
      var range = wordRanges[index];
      var partial = fumeResolvePrintedGlyphsInRange(range, currentTimeValue);
      printed = range.start + partial;
      if (partial < range.end - range.start) return foliaClamp(printed, 0, graphemeCount);
    }
    return foliaClamp(printed, 0, graphemeCount);
  }

  function fumeResolvePrintedGraphemeProgress(line, wordRanges, graphemeCount, currentTimeValue) {
    if (graphemeCount === 0) return 0;
    if (currentTimeValue < line.startTime) return 0;
    if (fumeHasRevealCompletedByLineEnd(line, currentTimeValue)) return graphemeCount;

    if (wordRanges.length === 0) {
      var duration = Math.max(line.endTime - line.startTime, 0.12);
      var progress = foliaClamp((currentTimeValue - line.startTime) / duration, 0, 1);
      return foliaClamp(progress * graphemeCount, 0, graphemeCount);
    }

    var printed = 0;
    for (var index = 0; index < wordRanges.length; index++) {
      var range = wordRanges[index];
      if (currentTimeValue < range.word.startTime) return foliaClamp(printed, 0, graphemeCount);
      var progress = fumeResolveWordRevealProgress(range, currentTimeValue);
      var length = Math.max(range.end - range.start, 0);
      printed = range.start + progress * length;
      if (progress < 1) return foliaClamp(printed, 0, graphemeCount);
    }
    return foliaClamp(printed, 0, graphemeCount);
  }

  /* ------------------------------------------------------------------ *
   * B. 文本测量（fumeTextMeasure.ts）
   * ------------------------------------------------------------------ */

  var FUME_PRETEXT_OPTIONS = { whiteSpace: 'pre-wrap' };
  /* 有界缓存：长会话跨很多首歌也不能无限长。远大于一首歌的工作集。 */
  var FUME_SEGMENT_MEASURE_CACHE_LIMIT = 2048;
  var fumeSegmentMeasureCache = new Map();
  var fumeSegmentMeasureCanvas = null;

  function fumeBuildSegmentMetas(prepared) {
    var segmentMetas = [];
    var graphemes = [];
    var graphemeCursor = 0;
    for (var i = 0; i < prepared.segments.length; i++) {
      var segmentGraphemes = foliaSplitGraphemes(prepared.segments[i]);
      segmentMetas.push({
        graphemeStart: graphemeCursor,
        graphemeEnd: graphemeCursor + segmentGraphemes.length,
        graphemeCount: segmentGraphemes.length
      });
      for (var k = 0; k < segmentGraphemes.length; k++) graphemes.push(segmentGraphemes[k]);
      graphemeCursor += segmentGraphemes.length;
    }
    return { graphemes: graphemes, segmentMetas: segmentMetas };
  }

  function fumeCursorToGlobalOffset(cursor, segmentMetas) {
    if (segmentMetas.length === 0) return 0;
    var segment = segmentMetas[cursor.segmentIndex];
    if (!segment) return segmentMetas[segmentMetas.length - 1].graphemeEnd;
    return foliaClamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd);
  }

  function fumeGetPartialSegmentWidth(prepared, segmentIndex, segmentMeta, startOffset, endOffset) {
    var localStart = foliaClamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);
    var localEnd = foliaClamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);
    if (localEnd <= localStart) return 0;
    if (localStart === 0 && localEnd === segmentMeta.graphemeCount) return prepared.widths[segmentIndex] || 0;

    var breakableFitAdvances = prepared.breakableFitAdvances[segmentIndex];
    if (breakableFitAdvances && breakableFitAdvances.length > 0) {
      var width = 0;
      for (var index = localStart; index < localEnd; index++) width += breakableFitAdvances[index] || 0;
      return width;
    }

    var fullWidth = prepared.widths[segmentIndex] || 0;
    if (segmentMeta.graphemeCount === 0) return fullWidth;
    return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount);
  }

  function fumeWidthBetweenOffsets(prepared, segmentMetas, startOffset, endOffset) {
    if (endOffset <= startOffset) return 0;
    var width = 0;
    for (var segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex++) {
      var meta = segmentMetas[segmentIndex];
      if (endOffset <= meta.graphemeStart) break;
      if (startOffset >= meta.graphemeEnd) continue;
      var sliceStart = Math.max(startOffset, meta.graphemeStart);
      var sliceEnd = Math.min(endOffset, meta.graphemeEnd);
      width += fumeGetPartialSegmentWidth(prepared, segmentIndex, meta, sliceStart, sliceEnd);
    }
    return width;
  }

  function fumeBuildGlyphOffsets(prepared, segmentMetas, startOffset, graphemeCount) {
    var offsets = new Array(graphemeCount);
    for (var index = 0; index < graphemeCount; index++) {
      offsets[index] = fumeWidthBetweenOffsets(prepared, segmentMetas, startOffset, startOffset + index);
    }
    return offsets;
  }

  function fumeResolveGlyphAdvance(renderLine, graphemeIndex) {
    var currentOffset = renderLine.glyphOffsets[graphemeIndex] || 0;
    var nextOffset = graphemeIndex < renderLine.graphemes.length - 1
      ? (renderLine.glyphOffsets[graphemeIndex + 1] != null ? renderLine.glyphOffsets[graphemeIndex + 1] : renderLine.width)
      : renderLine.width;
    return Math.max(nextOffset - currentOffset, 0);
  }

  function fumeBuildRenderSegments(prepared, segmentMetas, lineStart, lineEnd, fontSpec) {
    var segments = [];
    for (var segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex++) {
      var meta = segmentMetas[segmentIndex];
      if (lineEnd <= meta.graphemeStart) break;
      if (lineStart >= meta.graphemeEnd) continue;

      var start = Math.max(lineStart, meta.graphemeStart);
      var end = Math.min(lineEnd, meta.graphemeEnd);
      if (end <= start) continue;

      var localStart = start - lineStart;
      var localEnd = end - lineStart;
      var segmentText = prepared.segments[segmentIndex] || '';
      var segmentGraphemes = foliaSplitGraphemes(segmentText);
      var text = (start === meta.graphemeStart && end === meta.graphemeEnd)
        ? segmentText
        : segmentGraphemes.slice(start - meta.graphemeStart, end - meta.graphemeStart).join('');
      var measuredGlyphOffsets = fumeMeasureSegmentGlyphOffsets(text, fontSpec);

      segments.push({
        text: text,
        start: start,
        end: end,
        localStart: localStart,
        localEnd: localEnd,
        x: fumeWidthBetweenOffsets(prepared, segmentMetas, lineStart, start),
        width: fumeWidthBetweenOffsets(prepared, segmentMetas, start, end),
        isFullSegment: start === meta.graphemeStart && end === meta.graphemeEnd,
        measuredGlyphOffsets: measuredGlyphOffsets
      });
    }
    return segments;
  }

  function fumeBuildFontSpec(fontPx, variant, fontFamily, theme) {
    var fontWeight = foliaResolveThemeFontWeight(theme, variant === 'hero' ? 780 : 640);
    return fontWeight + ' ' + fontPx + 'px ' + fontFamily;
  }

  function fumeMeasureSegmentGlyphOffsets(text, fontSpec) {
    var cacheKey = fontSpec + '__' + text;
    var cached = fumeSegmentMeasureCache.get(cacheKey);
    if (cached) return cached;

    var graphemes = foliaSplitGraphemes(text);
    var offsets = new Array(graphemes.length + 1).fill(0);
    try {
      if (!fumeSegmentMeasureCanvas) fumeSegmentMeasureCanvas = document.createElement('canvas');
      var context = fumeSegmentMeasureCanvas.getContext('2d');
      if (!context) return offsets;
      context.font = fontSpec;
      var measured = foliaMeasurePrefixOffsets(graphemes, function (prefix) {
        return context.measureText(prefix).width;
      });
      for (var i = 0; i < measured.length; i++) offsets[i] = measured[i];
    } catch (_) {}
    return foliaRememberBounded(fumeSegmentMeasureCache, cacheKey, offsets, FUME_SEGMENT_MEASURE_CACHE_LIMIT);
  }

  function fumeBuildWordRangeIndexByOffset(graphemeCount, wordRanges, rangeKind) {
    var indices = new Array(graphemeCount).fill(-1);
    for (var rangeIndex = 0; rangeIndex < wordRanges.length; rangeIndex++) {
      var range = wordRanges[rangeIndex];
      var start = rangeKind === 'color' ? range.colorStart : range.start;
      var end = rangeKind === 'color' ? range.colorEnd : range.end;
      for (var offset = start; offset < end && offset < graphemeCount; offset++) indices[offset] = rangeIndex;
    }
    return indices;
  }

  function fumeCountRenderableGraphemes(text) {
    return foliaSplitGraphemes(text).filter(function (value) { return value.trim().length > 0; }).length;
  }

  /* 「大多数块尽量保持单行」：对能单行放下的字号做 8 次二分，二分不动才回落。 */
  function fumeBuildPreparedSingleLine(pretext, text, fontFamily, width, variant, lyricsFontScale, densityScale, heroScale, theme) {
    var low = variant === 'hero' ? 18 : 10;
    var high = variant === 'hero' ? 58 : 30;
    var best = null;

    for (var iteration = 0; iteration < 8; iteration++) {
      var candidateFontPx = ((low + high) / 2) * lyricsFontScale * densityScale * (variant === 'hero' ? heroScale : 1);
      var fontSpec = fumeBuildFontSpec(candidateFontPx, variant, fontFamily, theme);
      var prepared = pretext.prepareWithSegments(text, fontSpec, FUME_PRETEXT_OPTIONS);
      var layout = pretext.layoutWithLines(prepared, width, Math.round(candidateFontPx * (variant === 'hero' ? 1.02 : 1.06)));

      if (layout.lineCount <= 1) {
        best = { fontPx: candidateFontPx, prepared: prepared, layout: layout };
        low = (low + high) / 2;
      } else {
        high = (low + high) / 2;
      }
    }

    if (best) return best;

    var fallbackFontPx = (variant === 'hero' ? 18 : 10) * lyricsFontScale * densityScale * (variant === 'hero' ? heroScale : 1);
    var fallbackSpec = fumeBuildFontSpec(fallbackFontPx, variant, fontFamily, theme);
    var fallbackPrepared = pretext.prepareWithSegments(text, fallbackSpec, FUME_PRETEXT_OPTIONS);
    return {
      fontPx: fallbackFontPx,
      prepared: fallbackPrepared,
      layout: pretext.layoutWithLines(fallbackPrepared, width, Math.round(fallbackFontPx * (variant === 'hero' ? 1.02 : 1.06)))
    };
  }

  function fumeResolveRenderLineOffset(renderLine, localOffset) {
    if (localOffset <= 0) return 0;
    if (localOffset >= renderLine.graphemes.length) return renderLine.width;
    return renderLine.glyphOffsets[localOffset] != null ? renderLine.glyphOffsets[localOffset] : renderLine.width;
  }

  function fumeResolveSegmentGlyphOffset(segment, globalOffset) {
    var localOffset = foliaClamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 1);
    return segment.measuredGlyphOffsets[localOffset] || 0;
  }

  function fumeResolveSegmentGlyphAdvance(segment, globalOffset) {
    var localOffset = foliaClamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 2);
    var current = segment.measuredGlyphOffsets[localOffset] || 0;
    var next = segment.measuredGlyphOffsets[localOffset + 1] != null ? segment.measuredGlyphOffsets[localOffset + 1] : current;
    return Math.max(next - current, 0);
  }

  /* ------------------------------------------------------------------ *
   * C. 文章版式（fumeArticleLayout.ts）
   * ------------------------------------------------------------------ */

  function fumeChooseNaturalBlockVariant(line, index, total) {
    var graphemeCount = fumeCountRenderableGraphemes(line.fullText);
    if (graphemeCount === 0) return 'body';
    if (line.isChorus && graphemeCount <= 22) return 'hero';

    var shortEnough = graphemeCount >= 4 && graphemeCount <= 28;
    var centered = Math.abs(index - total / 2) / Math.max(total, 1);
    var random = foliaSeeded(line.fullText + ':' + index);
    return shortEnough && centered < 0.72 && ((index + 1) % 6 === 0 || random > 0.965) ? 'hero' : 'body';
  }

  /* 整首歌没有任何自然 hero 时，按「居中 + 长度 + chorus + 稳定抖动」补一个。 */
  function fumeChooseFallbackHeroBlockIndex(entries) {
    if (entries.length === 0) return -1;
    var hasNaturalHero = entries.some(function (entry, blockIndex) {
      return fumeChooseNaturalBlockVariant(entry.line, blockIndex, entries.length) === 'hero';
    });
    if (hasNaturalHero) return -1;

    var bestIndex = -1;
    var bestScore = -Infinity;
    entries.forEach(function (entry, blockIndex) {
      var graphemeCount = fumeCountRenderableGraphemes(entry.line.fullText);
      if (graphemeCount === 0) return;
      var isComfortableHeroLength = graphemeCount >= 4 && graphemeCount <= 28;
      var isAcceptableFallbackLength = graphemeCount <= 36;
      if (!isComfortableHeroLength && !isAcceptableFallbackLength) return;

      var centered = Math.abs(blockIndex - entries.length / 2) / Math.max(entries.length, 1);
      var centerScore = 1 - centered;
      var lengthScore = graphemeCount >= 6 && graphemeCount <= 22 ? 1 : (graphemeCount <= 28 ? 0.72 : 0.36);
      var chorusScore = entry.line.isChorus ? 0.28 : 0;
      var stableJitter = foliaSeeded(entry.line.fullText + ':' + blockIndex + ':fallback-hero') * 0.04;
      var score = centerScore * 0.62 + lengthScore * 0.34 + chorusScore + stableJitter;
      if (score > bestScore) { bestScore = score; bestIndex = blockIndex; }
    });
    if (bestIndex >= 0) return bestIndex;

    var shortestIndex = -1;
    var shortestCount = Infinity;
    entries.forEach(function (entry, blockIndex) {
      var graphemeCount = fumeCountRenderableGraphemes(entry.line.fullText);
      if (graphemeCount > 0 && graphemeCount < shortestCount) { shortestCount = graphemeCount; shortestIndex = blockIndex; }
    });
    return shortestIndex;
  }

  function fumeChooseBlockVariant(line, index, total, forcedHeroIndex) {
    return index === forcedHeroIndex ? 'hero' : fumeChooseNaturalBlockVariant(line, index, total);
  }

  function fumeBuildLayoutCacheKey(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning) {
    /* 版式缓存键故意忽略短时播放状态：只有影响几何的输入才让整篇版式作废。 */
    var linesHash = 2166136261;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lineKey = line.startTime + ':' + line.endTime + ':' + line.fullText + ':' + (line.words ? line.words.length : 0) + ':' + (line.isChorus ? 1 : 0);
      linesHash ^= foliaHashString(lineKey);
      linesHash = Math.imul(linesHash, 16777619);
    }
    return [
      Math.round(viewport.width),
      Math.round(viewport.height),
      layoutTheme.fontStyle,
      layoutTheme.fontStack || '',
      layoutTheme.weight == null ? 'auto' : layoutTheme.weight,
      FUME_LAYOUT_SEED_KEY,
      Number(lyricsFontScale).toFixed(4),
      fumeTuning.heroScale.toFixed(4),
      lines.length,
      linesHash >>> 0
    ].join('|');
  }

  /* mode='measure' 只算几何（栏高），mode='render' 继续建逐字/逐段结构。 */
  function fumeBuildArticleLayoutAttempt(pretext, lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, options) {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) return null;

    var paperWidth = options.paperWidth;
    var viewportHeight = options.viewportHeight;
    var columns = options.columns;
    var gap = options.gap;
    var densityScale = options.densityScale;
    var seedKey = options.seedKey;
    var shouldBuildRenderDetails = options.mode !== 'measure';
    var horizontalMargin = Math.max(viewport.width * 0.86, 280);
    var verticalMargin = Math.max(viewport.height * 0.82, 220);
    var columnWidth = (paperWidth - gap * (columns - 1)) / columns;
    var fontFamily = foliaResolveThemeFontStack(layoutTheme);
    /* 空行对版式没有帮助；落块顺序按种子洗牌，纸面才像排过版而不是严格按时间。 */
    var filteredLines = lines
      .map(function (line, index) { return { line: line, index: index }; })
      .filter(function (entry) { return String(entry.line.fullText || '').trim().length > 0; })
      .sort(function (left, right) {
        var leftSeed = foliaSeeded(seedKey + ':' + left.index + ':' + left.line.fullText);
        var rightSeed = foliaSeeded(seedKey + ':' + right.index + ':' + right.line.fullText);
        return leftSeed - rightSeed;
      });

    var blocks = [];
    var columnHeights = [];
    for (var c = 0; c < columns; c++) columnHeights.push(verticalMargin);
    var bodyColumnTieCursor = 0;
    var heroPlacementTieCursor = 0;
    var forcedHeroIndex = fumeChooseFallbackHeroBlockIndex(filteredLines);

    filteredLines.forEach(function (entry, blockIndex) {
      var line = entry.line;
      var index = entry.index;
      var variant = fumeChooseBlockVariant(line, blockIndex, filteredLines.length, forcedHeroIndex);
      /* hero 块允许占更大版面；body 块保持窄，文章才读起来像分栏。 */
      var heroSpanColumns = variant === 'hero' ? Math.min(columns, columns <= 1 ? 1 : 2) : 1;
      var heroSpanWidth = heroSpanColumns > 1 ? columnWidth * heroSpanColumns + gap * (heroSpanColumns - 1) : paperWidth;
      var blockWidth = variant === 'hero'
        ? (heroSpanColumns === 1 ? paperWidth : (columns === 2 ? columnWidth * 1.5 + gap * 0.5 : heroSpanWidth))
        : columnWidth;
      var paddingX = 0;
      var paddingY = 0;
      var innerWidth = Math.max(blockWidth - paddingX * 2, 120);
      var preparedSingleLine = fumeBuildPreparedSingleLine(
        pretext, line.fullText, fontFamily, innerWidth, variant, lyricsFontScale, densityScale, fumeTuning.heroScale, layoutTheme
      );
      var fontPx = preparedSingleLine.fontPx;
      var lineHeight = Math.round(fontPx * (variant === 'hero' ? 1.02 : 1.06));
      var layout = preparedSingleLine.layout;
      var blockGap = variant === 'hero' ? Math.max(Math.round(lineHeight * 0.2), 6) : Math.max(Math.round(lineHeight * 0.08), 2);
      var blockHeight = paddingY * 2 + layout.lines.length * lineHeight;
      var x = 0;
      var y = 0;

      if (variant === 'hero') {
        /* hero 落位尝试在多个栏里找最空的大位。 */
        if (heroSpanColumns === 1) {
          y = Math.max.apply(null, columnHeights);
          x = horizontalMargin;
          columnHeights[0] = y + blockHeight + blockGap;
        } else {
          var bestHeight = Infinity;
          var candidateStarts = [];
          for (var startColumn = 0; startColumn <= columns - heroSpanColumns; startColumn++) {
            var coveredHeight = 0;
            for (var columnIndex = startColumn; columnIndex < startColumn + heroSpanColumns; columnIndex++) {
              coveredHeight = Math.max(coveredHeight, columnHeights[columnIndex] || 0);
            }
            if (coveredHeight < bestHeight) { bestHeight = coveredHeight; candidateStarts = [startColumn]; }
            else if (coveredHeight === bestHeight) candidateStarts.push(startColumn);
          }
          var targetStart = candidateStarts.length > 0 ? candidateStarts[heroPlacementTieCursor % candidateStarts.length] : 0;
          heroPlacementTieCursor += 1;
          y = bestHeight;
          x = horizontalMargin + targetStart * (columnWidth + gap) + Math.max((heroSpanWidth - blockWidth) * 0.5, 0);
          for (var ci = targetStart; ci < targetStart + heroSpanColumns; ci++) columnHeights[ci] = y + blockHeight + blockGap;
        }
      } else {
        /* body 落位简单：掉进当前最短的栏。 */
        var targetColumn = 0;
        var minHeight = columnHeights[0] || 0;
        var candidateColumns = [0];
        for (var columnIndex = 1; columnIndex < columns; columnIndex++) {
          var height = columnHeights[columnIndex] || 0;
          if (height < minHeight) { minHeight = height; candidateColumns = [columnIndex]; }
          else if (height === minHeight) candidateColumns.push(columnIndex);
        }
        targetColumn = candidateColumns[bodyColumnTieCursor % candidateColumns.length] || 0;
        bodyColumnTieCursor += 1;
        x = horizontalMargin + targetColumn * (columnWidth + gap);
        y = columnHeights[targetColumn];
        columnHeights[targetColumn] = y + blockHeight + blockGap;
      }

      if (!shouldBuildRenderDetails) return;

      var prepared = preparedSingleLine.prepared;
      var fontSpec = fumeBuildFontSpec(fontPx, variant, fontFamily, layoutTheme);
      var metas = fumeBuildSegmentMetas(prepared);
      var graphemes = metas.graphemes;
      var segmentMetas = metas.segmentMetas;
      var wordRanges = fumeBuildWordRangesFromWords(line, graphemes);
      var wordRangeIndexByOffset = fumeBuildWordRangeIndexByOffset(graphemes.length, wordRanges);
      var colorRangeIndexByOffset = fumeBuildWordRangeIndexByOffset(graphemes.length, wordRanges, 'color');
      var renderLines = layout.lines.map(function (layoutLine, lineIndex) {
        var start = fumeCursorToGlobalOffset(layoutLine.start, segmentMetas);
        var end = fumeCursorToGlobalOffset(layoutLine.end, segmentMetas);
        var lineGraphemes = foliaSplitGraphemes(layoutLine.text);
        return {
          id: line.startTime + '-' + lineIndex,
          text: layoutLine.text,
          start: start,
          end: end,
          graphemes: lineGraphemes,
          glyphOffsets: fumeBuildGlyphOffsets(prepared, segmentMetas, start, lineGraphemes.length),
          segments: fumeBuildRenderSegments(prepared, segmentMetas, start, end, fontSpec),
          left: variant === 'hero' ? Math.max((blockWidth - layoutLine.width) * 0.08, 0) : 0,
          top: paddingY + lineIndex * lineHeight,
          width: layoutLine.width
        };
      });

      blocks.push({
        id: 'fume-' + line.startTime + '-' + index,
        sourceLineIndex: index,
        line: line,
        variant: variant,
        /* 落在第几栏（hero 跨栏时取起始栏）。仅探针/取证用，绘制不吃这个字段。 */
        column: variant === 'hero' ? (targetStart == null ? 0 : targetStart) : (targetColumn == null ? 0 : targetColumn),
        x: x,
        y: y,
        width: blockWidth,
        height: blockHeight,
        innerWidth: innerWidth,
        fontPx: fontPx,
        lineHeight: lineHeight,
        prepared: prepared,
        layout: layout,
        graphemes: graphemes,
        segmentMetas: segmentMetas,
        wordRanges: wordRanges,
        wordRangeIndexByOffset: wordRangeIndexByOffset,
        colorRangeIndexByOffset: colorRangeIndexByOffset,
        renderLines: renderLines
      });
    });

    var articleHeight = Math.max.apply(null, columnHeights.concat([0])) + verticalMargin;
    var metrics = {
      width: paperWidth + horizontalMargin * 2,
      height: articleHeight,
      viewportHeight: viewportHeight,
      columns: columns,
      gap: gap,
      paperBounds: {
        left: horizontalMargin,
        top: verticalMargin,
        right: horizontalMargin + paperWidth,
        bottom: Math.max(articleHeight - verticalMargin, verticalMargin)
      }
    };
    if (!shouldBuildRenderDetails) return metrics;

    var chronologicalBlocks = blocks.slice().sort(function (left, right) { return left.sourceLineIndex - right.sourceLineIndex; });
    var blockBySourceLineIndex = new Map();
    for (var bi = 0; bi < chronologicalBlocks.length; bi++) blockBySourceLineIndex.set(chronologicalBlocks[bi].sourceLineIndex, chronologicalBlocks[bi]);
    var firstRenderableStartTime = chronologicalBlocks.length ? chronologicalBlocks[0].line.startTime : Infinity;
    var lastChronologicalRenderEndTime = chronologicalBlocks.length
      ? foliaGetLineRenderEndTime(chronologicalBlocks[chronologicalBlocks.length - 1].line)
      : -Infinity;

    var article = {
      width: metrics.width,
      height: metrics.height,
      viewportHeight: metrics.viewportHeight,
      columns: metrics.columns,
      gap: metrics.gap,
      paperBounds: metrics.paperBounds,
      blocks: blocks,
      blockBySourceLineIndex: blockBySourceLineIndex,
      chronologicalBlocks: chronologicalBlocks,
      firstRenderableStartTime: firstRenderableStartTime,
      lastChronologicalRenderEndTime: lastChronologicalRenderEndTime
    };
    return article;
  }

  /* 试几组栏数 × 密度，保留高度最贴近目标的文章——这是模式「有构图感」的原因。 */
  function fumeBuildArticleLayout(pretext, lines, viewport, layoutTheme, lyricsFontScale, fumeTuning) {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) return null;

    var paperWidth = foliaClamp(Math.max(viewport.width * 1.95, viewport.width + 520), 920, 2400);
    var viewportHeight = Math.max(viewport.height, 240);
    var maxColumns = paperWidth >= 1120 ? 4 : (paperWidth >= 760 ? 3 : (paperWidth >= 500 ? 2 : 1));
    var targetHeight = viewportHeight * 2.45;

    var bestOptions = null;
    var bestScore = Infinity;
    for (var columns = maxColumns; columns >= 1; columns--) {
      var low = 0.82;
      var high = 1.42;
      var gap = foliaClamp(Math.round(paperWidth * (columns >= 4 ? 0.0065 : (columns === 3 ? 0.0085 : 0.0115))), 6, 14);
      for (var iteration = 0; iteration < 8; iteration++) {
        var densityScale = (low + high) / 2;
        var layout = fumeBuildArticleLayoutAttempt(pretext, lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, {
          paperWidth: paperWidth,
          viewportHeight: viewportHeight,
          columns: columns,
          gap: gap,
          densityScale: densityScale,
          seedKey: FUME_LAYOUT_SEED_KEY + ':' + columns + ':' + paperWidth,
          mode: 'measure'
        });
        if (!layout) continue;
        var coveragePenalty = Math.abs(layout.height - targetHeight);
        var overflowPenalty = layout.height < targetHeight ? 0 : (layout.height - targetHeight) * 0.14;
        var score = coveragePenalty + overflowPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestOptions = {
            paperWidth: paperWidth,
            viewportHeight: viewportHeight,
            columns: columns,
            gap: gap,
            densityScale: densityScale,
            seedKey: FUME_LAYOUT_SEED_KEY + ':' + columns + ':' + paperWidth,
            mode: 'render'
          };
        }
        if (layout.height < targetHeight) low = densityScale;
        else high = densityScale;
      }
    }

    return bestOptions
      ? fumeBuildArticleLayoutAttempt(pretext, lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, bestOptions)
      : null;
  }

  /* ------------------------------------------------------------------ *
   * D. 逐块帧决策（fumeBlockFrame.ts）
   * ------------------------------------------------------------------ */

  function fumeResolveGlowBases(animationIntensity, glowIntensity) {
    return {
      activeGlowBoost: (animationIntensity === 'chaotic' ? 1.15 : (animationIntensity === 'calm' ? 0.72 : 0.92)) * glowIntensity,
      passedGlowBase: (animationIntensity === 'chaotic' ? 0.95 : (animationIntensity === 'calm' ? 0.35 : 0.62)) * glowIntensity
    };
  }

  function fumeIsBlockOnScreen(block, camera, viewport, overscan) {
    if (overscan == null) overscan = 180;
    var screenScale = camera.scale;
    var screenLeft = viewport.width * 0.5 + (block.x - camera.x) * screenScale;
    var screenTop = viewport.height * 0.5 + (block.y - camera.y) * screenScale;
    var screenRight = screenLeft + block.width * screenScale;
    var screenBottom = screenTop + block.height * screenScale;
    return !(screenRight < -overscan || screenLeft > viewport.width + overscan
      || screenBottom < -overscan || screenTop > viewport.height + overscan);
  }

  function fumeResolvePassedTextStyle(variant, textHoldStyle) {
    if (textHoldStyle === 'dimmed') {
      return {
        opacity: variant === 'hero' ? 0.11 : 0.075,
        glowMultiplier: 0,
        shadowAlphaBase: 0,
        shadowAlphaTrail: 0
      };
    }
    return {
      opacity: variant === 'hero' ? 0.74 : 0.58,
      glowMultiplier: 1,
      shadowAlphaBase: 0.1,
      shadowAlphaTrail: 0.16
    };
  }

  function fumeResolvePassedDimAmount(currentTimeValue, passedAt, fadeDuration) {
    if (!isFinite(currentTimeValue) || !isFinite(passedAt) || !isFinite(fadeDuration) || fadeDuration <= 0) return 1;
    var passedAge = Math.max(currentTimeValue - passedAt, 0);
    return foliaEaseInCubic(foliaClamp(passedAge / fadeDuration, 0, 1));
  }

  function fumeResolveBlockTiming(block, time, nextLineStartTime, textHoldRatio) {
    var waitingOpacity = block.variant === 'hero' ? 0.06 : 0.035;
    var activeOpacity = block.variant === 'hero' ? 0.985 : 0.92;
    var effectiveTextHoldStyle = textHoldRatio >= 1 ? 'standard' : 'dimmed';
    var passedStyle = fumeResolvePassedTextStyle(block.variant, effectiveTextHoldStyle);
    var transitionPassedStyle = fumeResolvePassedTextStyle(block.variant, 'standard');
    var baselineOffset = block.lineHeight * (foliaIsCjk(block.line.fullText) ? 0.52 : 0.5);
    var lineEndTime = foliaGetLineRenderEndTime(block.line);
    var linePassCutoffTime = fumeResolveLinePassCutoffTime(block.line, nextLineStartTime);
    var revealCompleteTime = block.line.endTime;
    var hasRevealCompleted = time >= revealCompleteTime;
    var hasPassCutoffReached = time >= linePassCutoffTime;
    var lineDuration = Math.max(lineEndTime - block.line.startTime, 0.18);
    var colorTrailDuration = foliaClamp(lineDuration * (block.variant === 'hero' ? 0.42 : 0.52), 0.45, 1.45);
    var staticState = time < block.line.startTime
      ? 'waiting'
      : (time >= lineEndTime + colorTrailDuration ? 'passed' : null);
    return {
      waitingOpacity: waitingOpacity,
      activeOpacity: activeOpacity,
      effectiveTextHoldStyle: effectiveTextHoldStyle,
      passedStyle: passedStyle,
      transitionPassedStyle: transitionPassedStyle,
      baselineOffset: baselineOffset,
      lineEndTime: lineEndTime,
      linePassCutoffTime: linePassCutoffTime,
      hasRevealCompleted: hasRevealCompleted,
      hasPassCutoffReached: hasPassCutoffReached,
      lineDuration: lineDuration,
      colorTrailDuration: colorTrailDuration,
      staticState: staticState
    };
  }

  /* 静止块画哪几张缓存快照、什么透明度——等待/久唱过的一张，dimmed 交叉淡变时两张。 */
  function fumeResolveStaticLayers(block, timing, input, getSnapshot) {
    var staticState = timing.staticState;
    if (!staticState) return null;
    var effectiveTextHoldStyle = timing.effectiveTextHoldStyle;
    var passedStyle = timing.passedStyle;
    var waitingOpacity = timing.waitingOpacity;
    var lineEndTime = timing.lineEndTime;
    var colorTrailDuration = timing.colorTrailDuration;
    var theme = input.theme;

    var cacheStyleKey = staticState === 'passed' ? effectiveTextHoldStyle : 'base';
    var snapshot = getSnapshot({
      key: block.id + ':' + staticState + ':' + cacheStyleKey + ':' + input.snapshotScale,
      fill: staticState === 'waiting'
        ? foliaColorWithAlpha(theme.primaryColor, waitingOpacity)
        : foliaColorWithAlpha(theme.primaryColor, passedStyle.opacity),
      shadowBlur: staticState === 'waiting'
        ? 0
        : (2 + block.fontPx * 0.1) * 0.65 * input.passedGlowBase * passedStyle.glowMultiplier,
      shadowColor: staticState === 'waiting'
        ? 'transparent'
        : foliaColorWithAlpha(theme.primaryColor, passedStyle.shadowAlphaBase)
    });
    if (!snapshot) return null;

    if (staticState === 'passed' && effectiveTextHoldStyle === 'dimmed') {
      var passedAt = lineEndTime + colorTrailDuration;
      var baseDimAmount = fumeResolvePassedDimAmount(input.time, passedAt, input.passedFadeDuration);
      var dimAmount = baseDimAmount * (1 - input.overviewTextRestoreProgress);
      var standardStyle = fumeResolvePassedTextStyle(block.variant, 'standard');
      var standardSnapshot = getSnapshot({
        key: block.id + ':passed:standard:' + input.snapshotScale,
        fill: foliaColorWithAlpha(theme.primaryColor, standardStyle.opacity),
        shadowBlur: (2 + block.fontPx * 0.1) * 0.65 * input.passedGlowBase * standardStyle.glowMultiplier,
        shadowColor: foliaColorWithAlpha(theme.primaryColor, standardStyle.shadowAlphaBase)
      });
      if (standardSnapshot) {
        if (dimAmount <= 0) return [{ snapshot: standardSnapshot, alpha: 1 }];
        if (dimAmount < 1) {
          return [
            { snapshot: standardSnapshot, alpha: 1 - dimAmount },
            { snapshot: snapshot, alpha: dimAmount }
          ];
        }
      }
    }
    return [{ snapshot: snapshot, alpha: 1 }];
  }

  /* ------------------------------------------------------------------ *
   * E. Canvas 文字（fumeCanvasText.ts）
   * ------------------------------------------------------------------ */

  function fumeBuildCanvasFont(block, theme) {
    return fumeBuildFontSpec(block.fontPx, block.variant, foliaResolveThemeFontStack(theme), theme);
  }

  function fumeBuildTextStyleKey(fillStyle, shadowBlur, shadowColor) {
    return fillStyle + '|' + shadowColor + '|' + shadowBlur.toFixed(3);
  }

  /* 把一个「同样式字素连续段」按 measuredGlyphOffsets 裁剪后整段画出来。 */
  function fumeDrawRenderTextRun(context, renderLine, segment, runStart, runEnd, baseX, baseY) {
    if (!segment.text || runEnd <= runStart) return;
    var segmentRunStart = Math.max(runStart - segment.localStart, 0);
    var segmentRunEnd = Math.min(runEnd - segment.localStart, segment.measuredGlyphOffsets.length - 1);
    var clipLeft = segment.measuredGlyphOffsets[segmentRunStart] != null
      ? segment.measuredGlyphOffsets[segmentRunStart]
      : (fumeResolveRenderLineOffset(renderLine, runStart) - segment.x);
    var clipRight = segment.measuredGlyphOffsets[segmentRunEnd] != null
      ? segment.measuredGlyphOffsets[segmentRunEnd]
      : (fumeResolveRenderLineOffset(renderLine, runEnd) - segment.x);
    var clipWidth = Math.max(clipRight - clipLeft, 0);
    if (clipWidth <= 0) return;

    context.save();
    context.beginPath();
    context.rect(
      baseX + segment.x + clipLeft,
      baseY - Math.max(clipWidth, 1) - 64,
      clipWidth,
      Math.max(128 + clipWidth * 2, 256)
    );
    context.clip();
    context.fillText(segment.text, baseX + segment.x, baseY);
    context.restore();
  }

  function fumeCreateStaticBlockSnapshot(block, theme, fillStyle, shadowBlur, shadowColor) {
    var rasterScale = foliaClamp(window.devicePixelRatio || 1, 1, 2);
    var padding = Math.ceil(Math.max(block.fontPx * 0.32, (shadowBlur || 0) + block.fontPx * 0.08, 4));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((block.width + padding * 2) * rasterScale));
    canvas.height = Math.max(1, Math.ceil((block.height + padding * 2) * rasterScale));

    var context = canvas.getContext('2d');
    if (!context) return null;

    var baselineOffset = block.lineHeight * (foliaIsCjk(block.line.fullText) ? 0.52 : 0.5);
    context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    context.font = fumeBuildCanvasFont(block, theme);
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = fillStyle;
    context.shadowBlur = shadowBlur || 0;
    context.shadowColor = shadowColor || 'transparent';

    for (var i = 0; i < block.renderLines.length; i++) {
      var renderLine = block.renderLines[i];
      context.fillText(renderLine.text, renderLine.left + padding, renderLine.top + baselineOffset + padding);
    }

    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    return { canvas: canvas, padding: padding };
  }

  /* 正在印刷 / 辉光尾迹中的块：逐字素画，行辉光 + 每段颜色与辉光 + 打印方块。 */
  function fumeDrawLiveBlock(context, block, timing, params) {
    var time = params.time;
    var theme = params.theme;
    var glowIntensity = params.glowIntensity;
    var activeGlowBoost = params.activeGlowBoost;
    var passedGlowBase = params.passedGlowBase;
    var showPrintStamp = params.showPrintStamp;
    var waitingOpacity = timing.waitingOpacity;
    var activeOpacity = timing.activeOpacity;
    var transitionPassedStyle = timing.transitionPassedStyle;
    var baselineOffset = timing.baselineOffset;
    var linePassCutoffTime = timing.linePassCutoffTime;
    var hasRevealCompleted = timing.hasRevealCompleted;
    var hasPassCutoffReached = timing.hasPassCutoffReached;
    var lineDuration = timing.lineDuration;
    var colorTrailDuration = timing.colorTrailDuration;

    var printedCount = fumeResolvePrintedGraphemeCount(block.line, block.wordRanges, block.graphemes.length, time);
    var totalGraphemeCount = block.graphemes.length;

    context.save();
    context.font = fumeBuildCanvasFont(block, theme);
    context.textAlign = 'left';
    context.textBaseline = 'middle';

    var isLineActive = time >= block.line.startTime && time <= linePassCutoffTime;
    if (isLineActive) {
      var lineProgress = fumeResolveVisualProgressWithCutoff(block.line.startTime, lineDuration, time, linePassCutoffTime);
      var lineGlowEnvelope = foliaDelayedGlowEnvelope(lineProgress, 0.8);
      var lineGlowAlpha = (
        (block.variant === 'hero' ? 0.16 : 0.12) + lineGlowEnvelope * (block.variant === 'hero' ? 0.26 : 0.2)
      ) * glowIntensity;
      var lineGlowBlur = (
        (block.variant === 'hero' ? 12 : 8) + lineGlowEnvelope * block.fontPx * (block.variant === 'hero' ? 0.7 : 0.52)
      ) * glowIntensity;

      context.save();
      context.fillStyle = foliaColorWithAlpha(theme.accentColor, lineGlowAlpha);
      foliaSetCanvasTextGlow(context, foliaQuantizeShadowBlur(lineGlowBlur), foliaColorWithAlpha(theme.accentColor, lineGlowAlpha * 1.35));
      for (var li = 0; li < block.renderLines.length; li++) {
        var renderLine = block.renderLines[li];
        var glowBaseX = block.x + renderLine.left;
        var glowBaseY = block.y + renderLine.top + baselineOffset;
        for (var si = 0; si < renderLine.segments.length; si++) {
          var glowSegment = renderLine.segments[si];
          if (glowSegment.text.trim().length === 0) continue;
          foliaFillGlowText(context, glowSegment.text, glowBaseX + glowSegment.x, glowBaseY);
        }
      }
      context.restore();
    }

    for (var rli = 0; rli < block.renderLines.length; rli++) {
      var line = block.renderLines[rli];
      var baseX = block.x + line.left;
      var baseY = block.y + line.top + baselineOffset;

      for (var segIndex = 0; segIndex < line.segments.length; segIndex++) {
        var segment = line.segments[segIndex];
        var runStart = -1;
        var runFillStyle = '';
        var runShadowBlur = 0;
        var runShadowColor = 'transparent';
        var runStyleKey = '';

        var flushRun = function (segmentEnd) {
          if (runStart < 0 || !runStyleKey || segmentEnd <= runStart) return;
          var localStart = runStart - line.start;
          var localEnd = segmentEnd - line.start;
          var runText = line.graphemes.slice(localStart, localEnd).join('');
          if (!runText || (runText.trim().length === 0 && runFillStyle === '')) {
            runStart = -1;
            runStyleKey = '';
            return;
          }
          context.fillStyle = runFillStyle;
          foliaSetCanvasTextGlow(context, runShadowBlur, runShadowColor);
          fumeDrawRenderTextRun(context, line, segment, localStart, localEnd, baseX, baseY);
          foliaClearCanvasTextGlow(context);
          runStart = -1;
          runStyleKey = '';
        };

        for (var globalOffset = segment.start; globalOffset < segment.end; globalOffset++) {
          var graphemeIndex = globalOffset - line.start;
          var grapheme = line.graphemes[graphemeIndex];
          var rangeIndex = block.wordRangeIndexByOffset[globalOffset] != null ? block.wordRangeIndexByOffset[globalOffset] : -1;
          var range = rangeIndex >= 0 ? block.wordRanges[rangeIndex] : null;
          var colorRangeIndex = block.colorRangeIndexByOffset[globalOffset] != null ? block.colorRangeIndexByOffset[globalOffset] : -1;
          var colorRange = colorRangeIndex >= 0 ? block.wordRanges[colorRangeIndex] : range;
          var isPrinted = hasRevealCompleted || globalOffset < printedCount;
          var isFrontier = printedCount > 0 && globalOffset === printedCount && printedCount < totalGraphemeCount
            && !hasRevealCompleted && !hasPassCutoffReached;

          var alpha = isPrinted ? activeOpacity : (isFrontier ? 0.82 : waitingOpacity);
          var shadowBlur = 0;
          var shadowColor = 'transparent';
          var fillStyle = foliaColorWithAlpha(theme.primaryColor, alpha);

          if (range) {
            var wordDuration = Math.max(range.word.endTime - range.word.startTime, 0.08);
            var wordProgress = foliaClamp((time - range.word.startTime) / wordDuration, 0, 1);
            var glyphCount = Math.max(range.end - range.start, 1);
            var glyphIndexInRange = globalOffset - range.start;
            var glyphTiming = (range.word.syllables && range.word.syllables.length)
              ? range.graphemeTimings[Math.min(glyphIndexInRange, Math.max(range.graphemeTimings.length - 1, 0))]
              : undefined;
            var glyphStartTime = glyphTiming ? glyphTiming.startTime
              : (range.word.startTime + (glyphIndexInRange / glyphCount) * wordDuration);
            var glyphEndTime = glyphTiming ? glyphTiming.endTime
              : (range.word.startTime + ((glyphIndexInRange + 1) / glyphCount) * wordDuration);
            var glyphDuration = Math.max(glyphEndTime - glyphStartTime, 0.001);
            var glyphProgress = glyphTiming
              ? foliaClamp((time - glyphStartTime) / glyphDuration + 0.16, 0, 1)
              : foliaClamp(wordProgress * glyphCount - glyphIndexInRange + 0.16, 0, 1);
            var easedGlyphProgress = foliaEaseOutCubic(glyphProgress);
            var activeColor = foliaResolveWordColor((colorRange || range).word.text, theme.wordColors, theme.accentColor, { cjkMatchMode: 'bidirectional-contains' });
            var glyphTrailStart = glyphStartTime + glyphDuration * 0.18;
            var colorTrailPhase = fumeResolveVisualProgressWithCutoff(glyphTrailStart, colorTrailDuration, time, linePassCutoffTime);
            var colorTrailProgress = Math.pow(colorTrailPhase, 1.35);

            if (hasPassCutoffReached) {
              alpha = foliaMix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress);
              fillStyle = foliaMixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha);
              shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier;
              shadowColor = foliaColorWithAlpha(
                foliaMixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail
              );
            } else if (time < range.word.startTime) {
              alpha = waitingOpacity;
              fillStyle = foliaColorWithAlpha(theme.primaryColor, alpha);
            } else if (time <= glyphTrailStart) {
              alpha = foliaMix(waitingOpacity, activeOpacity, easedGlyphProgress);
              fillStyle = foliaMixColors(theme.primaryColor, activeColor, 0.22 + easedGlyphProgress * 0.78, alpha);
              shadowBlur = (4 + block.fontPx * 0.22) * easedGlyphProgress * activeGlowBoost;
              shadowColor = foliaColorWithAlpha(activeColor, 0.4 + easedGlyphProgress * 0.44);
            } else {
              alpha = foliaMix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress);
              fillStyle = foliaMixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha);
              shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier;
              shadowColor = foliaColorWithAlpha(
                foliaMixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail
              );
            }

            if (showPrintStamp && grapheme.trim().length > 0) {
              var glyphWindowDuration = Math.max(wordDuration / glyphCount, 0.04);
              var activationLeadDuration = foliaClamp(
                Math.min(glyphWindowDuration * 0.86, lineDuration * 0.16),
                0.055,
                block.variant === 'hero' ? 0.2 : 0.16
              );
              var activationReleaseDuration = activationLeadDuration * 0.42;
              var activationWindowStart = glyphTrailStart - activationLeadDuration;
              var activationWindowEnd = glyphTrailStart + activationReleaseDuration;
              var glyphAdvance = fumeResolveSegmentGlyphAdvance(segment, globalOffset);
              var stampProgress = fumeResolveVisualProgressWithCutoff(
                activationWindowStart, activationWindowEnd - activationWindowStart, time, linePassCutoffTime
              );

              if (stampProgress > 0 && stampProgress < 1) {
                var glyphTrailPhase = fumeResolveVisualProgressWithCutoff(
                  glyphTrailStart, Math.max(activationWindowEnd - glyphTrailStart, 0.001), time, linePassCutoffTime
                );
                var isDropping = glyphTrailPhase <= 0;
                var dropProgress = isDropping
                  ? foliaEaseOutCubic(fumeResolveVisualProgressWithCutoff(
                    activationWindowStart, Math.max(glyphTrailStart - activationWindowStart, 0.001), time, linePassCutoffTime
                  ))
                  : 1;
                var fadeProgress = isDropping ? 0 : foliaEaseInOutCubic(glyphTrailPhase);
                var blockPulse = isDropping ? foliaMix(0.18, 1, Math.pow(dropProgress, 0.78)) : Math.pow(1 - fadeProgress, 1.2);
                var glyphVisualWidth = Math.max(
                  glyphAdvance * 0.88,
                  foliaIsCjk(grapheme) ? block.fontPx * 0.56 : block.fontPx * 0.38
                );
                var blockCenterX = baseX + segment.x + fumeResolveSegmentGlyphOffset(segment, globalOffset) + glyphAdvance * 0.5;
                var dropDistance = block.lineHeight * (block.variant === 'hero' ? 0.24 : 0.2);
                var activationBlockAlpha = blockPulse * (block.variant === 'hero' ? 0.82 : 0.72);
                var activationBlockWidth = glyphVisualWidth + block.fontPx * (block.variant === 'hero' ? 0.18 : 0.12);
                var activationBlockHeight = block.fontPx * (block.variant === 'hero' ? 0.72 : 0.62);
                var activationBlockY = baseY - block.fontPx * 0.38 - foliaMix(dropDistance, 0, dropProgress);
                var activationBlockBlur = (8 + block.fontPx * 0.24) * blockPulse * activeGlowBoost;

                if (activationBlockWidth > 0) {
                  var blockLeft = blockCenterX - activationBlockWidth * 0.5;
                  context.save();
                  context.fillStyle = foliaColorWithAlpha(activeColor, activationBlockAlpha);
                  context.shadowBlur = activationBlockBlur;
                  context.shadowColor = foliaColorWithAlpha(activeColor, 0.56 * blockPulse);
                  context.fillRect(
                    blockLeft,
                    activationBlockY - activationBlockHeight * 0.5,
                    activationBlockWidth,
                    activationBlockHeight
                  );
                  context.restore();
                }
              }
            }
          }

          if (alpha <= 0.002) {
            flushRun(globalOffset);
            continue;
          }

          /* 辉光量化开着时半径取整像素：逐帧变化的 blur 会让 Chromium 每帧铸新字形缓存
           * （4KiB 共享内存不归还，Linux 上 ~35 分钟耗尽 renderer 的 1024 fd）。 */
          shadowBlur = foliaQuantizeShadowBlur(shadowBlur);
          var styleKey = fumeBuildTextStyleKey(fillStyle, shadowBlur, shadowColor);
          if (runStart < 0) {
            runStart = globalOffset;
            runFillStyle = fillStyle;
            runShadowBlur = shadowBlur;
            runShadowColor = shadowColor;
            runStyleKey = styleKey;
            continue;
          }
          if (styleKey !== runStyleKey) {
            flushRun(globalOffset);
            runStart = globalOffset;
            runFillStyle = fillStyle;
            runShadowBlur = shadowBlur;
            runShadowColor = shadowColor;
            runStyleKey = styleKey;
          }
        }
        flushRun(segment.end);
      }
    }
    context.restore();
  }

  /* ------------------------------------------------------------------ *
   * F. 相机目标（fumeCamera.ts）
   * ------------------------------------------------------------------ */

  var FUME_CAMERA_SCALE_MIN = 0.22;
  var FUME_CAMERA_SCALE_MAX = 2.24;
  var FUME_OVERVIEW_CAMERA_SOURCE = -2;
  var FUME_CAMERA_TELEPORT_TRIGGER_SCREENS = 2.75;

  /* stepped：焦点落在「已印刷字数」所在的渲染行上的精确位置。 */
  function fumeResolveSteppedBlockFocusPoint(block, printedCount) {
    if (block.renderLines.length === 0) {
      return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 };
    }
    var effectiveOffset = foliaClamp(printedCount, 0, block.graphemes.length);
    var targetLine = null;
    for (var i = 0; i < block.renderLines.length; i++) {
      if (effectiveOffset <= block.renderLines[i].end) { targetLine = block.renderLines[i]; break; }
    }
    if (!targetLine) targetLine = block.renderLines[block.renderLines.length - 1];
    var localOffset = foliaClamp(effectiveOffset, targetLine.start, targetLine.end);
    var progressWidth = fumeWidthBetweenOffsets(block.prepared, block.segmentMetas, targetLine.start, localOffset);
    var minX = block.x + targetLine.left;
    var maxX = minX + targetLine.width;
    return {
      x: foliaClamp(minX + progressWidth, minX, maxX),
      y: block.y + targetLine.top + block.lineHeight * 0.5
    };
  }

  /* smooth：焦点按小数进度在字素间插值，跨行时 0.7 字素窗口混合。 */
  function fumeResolveSmoothBlockFocusPoint(block, printedProgress) {
    if (block.renderLines.length === 0) {
      return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 };
    }
    var effectiveOffset = foliaClamp(printedProgress, 0, block.graphemes.length);
    var findRenderLineIndex = function (offset) {
      for (var i = 0; i < block.renderLines.length; i++) {
        if (offset <= block.renderLines[i].end) return i;
      }
      return block.renderLines.length - 1;
    };
    var resolvePointOnRenderLine = function (lineIndex, offset) {
      var targetLine = block.renderLines[lineIndex] || block.renderLines[block.renderLines.length - 1];
      var clampedOffset = foliaClamp(offset, targetLine.start, targetLine.end);
      var baseOffset = Math.floor(clampedOffset);
      var fractionalOffset = clampedOffset - baseOffset;
      var baseWidth = fumeWidthBetweenOffsets(block.prepared, block.segmentMetas, targetLine.start, baseOffset);
      var localGlyphIndex = baseOffset - targetLine.start;
      var glyphAdvance = (localGlyphIndex >= 0 && localGlyphIndex < targetLine.graphemes.length)
        ? fumeResolveGlyphAdvance(targetLine, localGlyphIndex) : 0;
      var minX = block.x + targetLine.left;
      var maxX = minX + targetLine.width;
      return {
        x: foliaClamp(minX + baseWidth + glyphAdvance * fractionalOffset, minX, maxX),
        y: block.y + targetLine.top + block.lineHeight * 0.5
      };
    };

    var targetLineIndex = findRenderLineIndex(effectiveOffset);
    var point = resolvePointOnRenderLine(targetLineIndex, effectiveOffset);
    var currentLine = block.renderLines[targetLineIndex];
    var crossLineBlendWindow = 0.7;

    if (targetLineIndex > 0 && effectiveOffset < currentLine.start + crossLineBlendWindow) {
      var previousLine = block.renderLines[targetLineIndex - 1];
      var blend = foliaEaseInOutCubic(foliaClamp(1 - ((effectiveOffset - previousLine.end) / crossLineBlendWindow), 0, 1));
      var previousPoint = resolvePointOnRenderLine(targetLineIndex - 1, previousLine.end);
      point = { x: foliaMix(point.x, previousPoint.x, blend), y: foliaMix(point.y, previousPoint.y, blend) };
    } else if (targetLineIndex < block.renderLines.length - 1 && effectiveOffset > currentLine.end - crossLineBlendWindow) {
      var nextLine = block.renderLines[targetLineIndex + 1];
      var blend = foliaEaseInOutCubic(foliaClamp((effectiveOffset - (currentLine.end - crossLineBlendWindow)) / crossLineBlendWindow, 0, 1));
      var nextPoint = resolvePointOnRenderLine(targetLineIndex + 1, nextLine.start);
      point = { x: foliaMix(point.x, nextPoint.x, blend), y: foliaMix(point.y, nextPoint.y, blend) };
    }
    return point;
  }

  /* 换块瞬间相机先看一眼块首（entryFocusBias），再滑向焦点——Folia 的入场偏置。 */
  function fumeResolveBlockEntryFocusPoint(block) {
    var firstRenderLine = block.renderLines[0];
    if (!firstRenderLine) return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 };
    return {
      x: block.x + firstRenderLine.left,
      y: block.y + firstRenderLine.top + block.lineHeight * 0.5
    };
  }

  function fumeResolveCameraScaleForBlock(block, viewport) {
    var minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1);
    var targetLineHeight = foliaClamp(minViewportSide * 0.115, 64, 124);
    return foliaClamp(targetLineHeight / Math.max(block.lineHeight, 1), 0.88, 2.2);
  }

  function fumeResolveCameraRetargetDuration(line) {
    var hints = foliaGetLineRenderHints(line);
    if (!hints) return 0.09;
    var transitionTiming = foliaGetLineTransitionTiming(hints.rawDuration, hints.lineTransitionMode, hints.wordRevealMode);
    if (hints.lineTransitionMode === 'none') {
      return foliaClamp(Math.max(hints.rawDuration, 0.08) * 0.34, 0.04, 0.075);
    }
    if (hints.lineTransitionMode === 'fast') {
      return foliaClamp(transitionTiming.enterDuration * 0.5 + transitionTiming.exitDuration * 0.12, 0.055, 0.095);
    }
    return foliaClamp(transitionTiming.enterDuration * 0.44 + transitionTiming.linePassHold * 0.22, 0.075, 0.13);
  }

  function fumeResolveOverviewRetargetDuration(viewport) {
    return foliaClamp(Math.min(viewport.width, viewport.height) / 1500, 0.38, 0.58);
  }

  /* 跨屏飞跃时经过 overview 附近的「拱桥」waypoint，避免生硬直线穿篇。 */
  function fumeResolveOverviewFlightBridge(params) {
    var fromX = params.fromX, fromY = params.fromY, fromScale = params.fromScale;
    var targetX = params.targetX, targetY = params.targetY, targetScale = params.targetScale;
    var overviewCamera = params.overviewCamera, viewport = params.viewport;
    if (!overviewCamera) return null;

    var safeScale = Math.max(fromScale, targetScale, overviewCamera.scale, 0.001);
    var minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1);
    var deltaX = fromX - targetX;
    var deltaY = fromY - targetY;
    var worldDistance = Math.hypot(deltaX, deltaY);
    var screenDistance = worldDistance * safeScale;

    if (worldDistance <= 0 || screenDistance < minViewportSide * FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) return null;

    var loftStrength = foliaClamp((screenDistance / minViewportSide - FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) / 3.4, 0, 1);
    var midpointX = foliaMix(fromX, targetX, 0.5);
    var midpointY = foliaMix(fromY, targetY, 0.5);
    var waypointCenterBias = foliaMix(0.18, 0.42, loftStrength);
    var waypointX = foliaMix(midpointX, overviewCamera.x, waypointCenterBias);
    var waypointY = foliaMix(midpointY, overviewCamera.y, waypointCenterBias);
    var endpointScale = Math.max(fromScale, targetScale, 0.001);
    var loftedScale = endpointScale * foliaMix(0.62, 0.4, loftStrength);
    var overviewLimitedScale = overviewCamera.scale * foliaMix(1.85, 1.55, loftStrength);
    var waypointScale = foliaClamp(
      Math.max(loftedScale, overviewLimitedScale),
      FUME_CAMERA_SCALE_MIN,
      Math.max(endpointScale * 0.92, FUME_CAMERA_SCALE_MIN)
    );
    var overviewDistanceFromStart = Math.hypot(waypointX - fromX, waypointY - fromY) * Math.max(fromScale, waypointScale, 0.001);
    var overviewDistanceToTarget = Math.hypot(targetX - waypointX, targetY - waypointY) * Math.max(targetScale, waypointScale, 0.001);
    var totalLegDistance = overviewDistanceFromStart + overviewDistanceToTarget;
    var waypointPhase = totalLegDistance <= 0 ? 0.36 : foliaClamp(overviewDistanceFromStart / totalLegDistance, 0.26, 0.44);
    var duration = foliaClamp(0.26 + (screenDistance / (minViewportSide * 5.5)) * 0.28, 0.3, 0.68);

    return { waypointX: waypointX, waypointY: waypointY, waypointScale: waypointScale, waypointPhase: waypointPhase, duration: duration };
  }

  function fumeResolveArticleOverviewCamera(article, viewport) {
    if (article.blocks.length === 0) {
      var fitScale = Math.min(viewport.width / Math.max(article.width, 1), viewport.height / Math.max(article.height, 1));
      return { x: article.width * 0.5, y: article.height * 0.5, scale: foliaClamp(fitScale * 0.92, FUME_CAMERA_SCALE_MIN, 0.72) };
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < article.blocks.length; i++) {
      var block = article.blocks[i];
      minX = Math.min(minX, block.x);
      minY = Math.min(minY, block.y);
      maxX = Math.max(maxX, block.x + block.width);
      maxY = Math.max(maxY, block.y + block.height);
    }
    var paddingX = foliaClamp(viewport.width * 0.2, 120, 280);
    var paddingY = foliaClamp(viewport.height * 0.2, 96, 220);
    var framedWidth = Math.max(maxX - minX + paddingX * 2, 1);
    var framedHeight = Math.max(maxY - minY + paddingY * 2, 1);
    var fitScale = Math.min(viewport.width / framedWidth, viewport.height / framedHeight);
    return { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5, scale: foliaClamp(fitScale, FUME_CAMERA_SCALE_MIN, 0.72) };
  }

  /* 焦点块：当前行 → 播完后的最后块 → 最近有字印刷过的块 → 第一块。 */
  function fumeResolveFocusBlock(article, currentLineIndex, currentTimeValue) {
    if (currentLineIndex >= 0) {
      var active = article.blockBySourceLineIndex.get(currentLineIndex) || null;
      if (active) return active;
    }
    var chronologicalLastBlock = article.chronologicalBlocks.length
      ? article.chronologicalBlocks[article.chronologicalBlocks.length - 1] : null;
    if (chronologicalLastBlock && currentTimeValue >= article.lastChronologicalRenderEndTime) return chronologicalLastBlock;

    for (var index = article.chronologicalBlocks.length - 1; index >= 0; index--) {
      var block = article.chronologicalBlocks[index];
      var printedCount = fumeResolvePrintedGraphemeCount(block.line, block.wordRanges, block.graphemes.length, currentTimeValue);
      if (printedCount > 0) return block;
    }
    return article.chronologicalBlocks.length ? article.chronologicalBlocks[0] : null;
  }

  /* ------------------------------------------------------------------ *
   * G. 相机步进（fumeCameraStep.ts）
   * ------------------------------------------------------------------ */

  function fumeCreateCameraState() {
    return {
      camera: {
        x: 0, y: 0, velocityX: 0, velocityY: 0, focusX: 0, focusY: 0,
        scale: 1, velocityScale: 0, focusScale: 1
      },
      retarget: {
        sourceLineIndex: -1,
        startedAt: 0,
        duration: 0.18,
        fromX: 0, fromY: 0, fromScale: 1,
        bridgeMode: 'none',
        bridgeWaypointX: 0, bridgeWaypointY: 0, bridgeWaypointScale: 1,
        bridgeWaypointPhase: 0.36
      },
      initialized: false
    };
  }

  /* 新文章把相机放到页面中心；老文章把相机夹在边界内。 */
  function fumeSyncCameraToArticle(state, article) {
    if (article && !state.initialized) {
      state.camera = {
        x: article.width * 0.5, y: article.height * 0.5,
        velocityX: 0, velocityY: 0,
        focusX: article.width * 0.5, focusY: article.height * 0.5,
        scale: 1.18, velocityScale: 0, focusScale: 1.18
      };
      state.initialized = true;
    } else if (article) {
      state.camera.x = foliaClamp(state.camera.x, 0, article.width);
      state.camera.y = foliaClamp(state.camera.y, 0, article.height);
      state.camera.focusX = foliaClamp(state.camera.focusX, 0, article.width);
      state.camera.focusY = foliaClamp(state.camera.focusY, 0, article.height);
      state.camera.scale = foliaClamp(state.camera.scale, FUME_CAMERA_SCALE_MIN, FUME_CAMERA_SCALE_MAX);
      state.camera.focusScale = foliaClamp(state.camera.focusScale, FUME_CAMERA_SCALE_MIN, FUME_CAMERA_SCALE_MAX);
    } else {
      state.initialized = false;
    }
  }

  function fumeStepCamera(state, input) {
    var article = input.article;
    var time = input.time;
    var now = input.now;
    var dt = input.dt;
    var lineIndex = input.lineIndex;
    var viewport = input.viewport;
    var overviewCamera = input.overviewCamera;
    var overviewStartTime = input.overviewStartTime;
    var cameraSpeed = input.cameraSpeed;
    var cameraTrackingMode = input.cameraTrackingMode;
    var animationIntensity = input.animationIntensity;

    var focusBlock = fumeResolveFocusBlock(article, lineIndex, time);
    var shouldShowOverview = overviewCamera !== null && time >= overviewStartTime;
    var targetCameraX = article.width * 0.5;
    var targetCameraY = article.height * 0.5;
    var targetCameraScale = 1.18;
    var entryFocusPoint = null;
    var didRetargetThisFrame = false;

    if (shouldShowOverview && overviewCamera) {
      targetCameraX = overviewCamera.x;
      targetCameraY = overviewCamera.y;
      targetCameraScale = overviewCamera.scale;
      if (state.retarget.sourceLineIndex !== FUME_OVERVIEW_CAMERA_SOURCE) {
        state.retarget = {
          sourceLineIndex: FUME_OVERVIEW_CAMERA_SOURCE,
          startedAt: time,
          duration: foliaClamp(fumeResolveOverviewRetargetDuration(viewport) / cameraSpeed, 0.12, 1.2),
          fromX: state.camera.x, fromY: state.camera.y, fromScale: state.camera.scale,
          bridgeMode: 'none',
          bridgeWaypointX: 0, bridgeWaypointY: 0, bridgeWaypointScale: 1,
          bridgeWaypointPhase: 0.36
        };
        didRetargetThisFrame = true;
      }
    } else if (focusBlock) {
      var focusPoint = cameraTrackingMode === 'stepped'
        ? fumeResolveSteppedBlockFocusPoint(focusBlock, fumeResolvePrintedGraphemeCount(
          focusBlock.line, focusBlock.wordRanges, focusBlock.graphemes.length, time))
        : fumeResolveSmoothBlockFocusPoint(focusBlock, fumeResolvePrintedGraphemeProgress(
          focusBlock.line, focusBlock.wordRanges, focusBlock.graphemes.length, time));
      entryFocusPoint = fumeResolveBlockEntryFocusPoint(focusBlock);
      targetCameraX = focusPoint.x;
      targetCameraY = focusPoint.y;
      targetCameraScale = fumeResolveCameraScaleForBlock(focusBlock, viewport);

      if (state.retarget.sourceLineIndex !== focusBlock.sourceLineIndex) {
        state.retarget = {
          sourceLineIndex: focusBlock.sourceLineIndex,
          startedAt: time,
          duration: foliaClamp(fumeResolveCameraRetargetDuration(focusBlock.line) / cameraSpeed, 0.03, 0.3),
          fromX: state.camera.x, fromY: state.camera.y, fromScale: state.camera.scale,
          bridgeMode: 'none',
          bridgeWaypointX: 0, bridgeWaypointY: 0, bridgeWaypointScale: 1,
          bridgeWaypointPhase: 0.36
        };
        didRetargetThisFrame = true;
      }
    } else if (state.retarget.sourceLineIndex !== -1) {
      state.retarget = {
        sourceLineIndex: -1,
        startedAt: time,
        duration: foliaClamp(0.18 / cameraSpeed, 0.05, 0.4),
        fromX: state.camera.x, fromY: state.camera.y, fromScale: state.camera.scale,
        bridgeMode: 'none',
        bridgeWaypointX: 0, bridgeWaypointY: 0, bridgeWaypointScale: 1,
        bridgeWaypointPhase: 0.36
      };
      didRetargetThisFrame = true;
    }

    var retargetElapsed = Math.max(time - state.retarget.startedAt, 0);
    var overviewTextRestoreProgress = (shouldShowOverview && state.retarget.sourceLineIndex === FUME_OVERVIEW_CAMERA_SOURCE)
      ? foliaEaseInOutCubic(foliaClamp(retargetElapsed / Math.max(state.retarget.duration, 0.001), 0, 1))
      : 0;
    var retargetPhase = foliaClamp(retargetElapsed / Math.max(state.retarget.duration, 0.001), 0, 1);
    var retargetBoost = 1 - foliaEaseOutCubic(retargetPhase);
    var entryFocusBias = Math.pow(retargetBoost, 0.58);

    if (entryFocusPoint) {
      targetCameraX = foliaMix(targetCameraX, entryFocusPoint.x, entryFocusBias);
      targetCameraY = foliaMix(targetCameraY, entryFocusPoint.y, entryFocusBias);
    }

    /* 空闲漂浮用墙钟（不是播放时间），overview 时衰减到 0.36。 */
    var floatConfig = animationIntensity === 'chaotic'
      ? { distance: 24, duration: 5.8, scaleAmplitude: 0.014 }
      : (animationIntensity === 'calm' ? { distance: 14, duration: 8.5, scaleAmplitude: 0.008 } : { distance: 18, duration: 7, scaleAmplitude: 0.011 });
    var floatPhase = (now / 1000 / floatConfig.duration) * Math.PI * 2;
    var overviewAttenuation = shouldShowOverview ? 0.36 : 1;
    var screenFloatX = Math.sin(floatPhase * 0.74 + 0.8) * floatConfig.distance * 0.34;
    var screenFloatY = (Math.sin(floatPhase) * floatConfig.distance + Math.sin(floatPhase * 0.5 + 1.1) * floatConfig.distance * 0.22) * overviewAttenuation;
    var worldFloatDivisor = Math.max(targetCameraScale, 0.001);
    targetCameraX -= screenFloatX / worldFloatDivisor;
    targetCameraY -= screenFloatY / worldFloatDivisor;
    targetCameraScale = foliaClamp(
      targetCameraScale * (1 + Math.sin(floatPhase + 0.9) * floatConfig.scaleAmplitude * overviewAttenuation),
      FUME_CAMERA_SCALE_MIN, FUME_CAMERA_SCALE_MAX
    );

    if (didRetargetThisFrame) {
      var bridgeScale = Math.max(state.camera.scale, targetCameraScale, 0.001);
      var screenDeltaX = Math.abs(targetCameraX - state.retarget.fromX) * bridgeScale;
      var screenDeltaY = Math.abs(targetCameraY - state.retarget.fromY) * bridgeScale;
      var screenDistance = Math.hypot(screenDeltaX, screenDeltaY);
      state.retarget.bridgeMode = screenDistance >= Math.min(viewport.width, viewport.height) * 0.42 ? 'direct' : 'none';
      state.retarget.bridgeWaypointX = targetCameraX;
      state.retarget.bridgeWaypointY = targetCameraY;
      state.retarget.bridgeWaypointScale = targetCameraScale;
      state.retarget.bridgeWaypointPhase = 0.5;

      if (state.retarget.sourceLineIndex >= 0) {
        var overviewFlightBridge = fumeResolveOverviewFlightBridge({
          fromX: state.retarget.fromX, fromY: state.retarget.fromY, fromScale: state.retarget.fromScale,
          targetX: targetCameraX, targetY: targetCameraY, targetScale: targetCameraScale,
          overviewCamera: overviewCamera, viewport: viewport
        });
        if (overviewFlightBridge) {
          state.retarget.bridgeMode = 'overview';
          state.retarget.bridgeWaypointX = overviewFlightBridge.waypointX;
          state.retarget.bridgeWaypointY = overviewFlightBridge.waypointY;
          state.retarget.bridgeWaypointScale = overviewFlightBridge.waypointScale;
          state.retarget.bridgeWaypointPhase = overviewFlightBridge.waypointPhase;
          state.retarget.duration = Math.max(
            state.retarget.duration,
            foliaClamp(overviewFlightBridge.duration / cameraSpeed, 0.16, 0.9)
          );
        }
      }
    }

    var cameraDistance = Math.hypot(targetCameraX - state.camera.x, targetCameraY - state.camera.y);
    var shouldUseBridge = state.retarget.bridgeMode !== 'none' && retargetPhase < 1;

    if (shouldUseBridge) {
      var bridgedCameraX = targetCameraX;
      var bridgedCameraY = targetCameraY;
      var bridgedCameraScale = targetCameraScale;

      if (state.retarget.bridgeMode === 'overview') {
        var bridgePhase = foliaEaseOutCubic(retargetPhase);
        bridgedCameraX = foliaQuadraticBezier(state.retarget.fromX, state.retarget.bridgeWaypointX, targetCameraX, bridgePhase);
        bridgedCameraY = foliaQuadraticBezier(state.retarget.fromY, state.retarget.bridgeWaypointY, targetCameraY, bridgePhase);
        bridgedCameraScale = foliaQuadraticBezier(state.retarget.fromScale, state.retarget.bridgeWaypointScale, targetCameraScale, bridgePhase);
      } else {
        var bridgePhase2 = foliaEaseInOutCubic(retargetPhase);
        bridgedCameraX = foliaMix(state.retarget.fromX, targetCameraX, bridgePhase2);
        bridgedCameraY = foliaMix(state.retarget.fromY, targetCameraY, bridgePhase2);
        bridgedCameraScale = foliaMix(state.retarget.fromScale, targetCameraScale, bridgePhase2);
      }

      var bridgeCatchUp = 1 - Math.exp(-dt * (
        state.retarget.bridgeMode === 'overview' ? foliaMix(12.5, 22, 1 - retargetPhase) : foliaMix(10.5, 17.5, 1 - retargetPhase)
      ));
      state.camera.focusX = bridgedCameraX;
      state.camera.focusY = bridgedCameraY;
      state.camera.focusScale = bridgedCameraScale;
      state.camera.x += (bridgedCameraX - state.camera.x) * bridgeCatchUp;
      state.camera.y += (bridgedCameraY - state.camera.y) * bridgeCatchUp;
      state.camera.scale += (bridgedCameraScale - state.camera.scale) * bridgeCatchUp;
      state.camera.scale = foliaClamp(state.camera.scale, FUME_CAMERA_SCALE_MIN, FUME_CAMERA_SCALE_MAX);
      state.camera.velocityX *= 0.72;
      state.camera.velocityY *= 0.72;
      state.camera.velocityScale *= 0.68;
    } else {
      var boostedCatchUpRate = foliaClamp(4.8 / Math.max(state.retarget.duration, 0.05), 20, 54);
      var targetCatchUp = 1 - Math.exp(-dt * foliaMix(11.2, boostedCatchUpRate, retargetBoost));
      state.camera.focusX += (targetCameraX - state.camera.focusX) * targetCatchUp;
      state.camera.focusY += (targetCameraY - state.camera.focusY) * targetCatchUp;
      state.camera.focusScale += (targetCameraScale - state.camera.focusScale) * (1 - Math.exp(-dt * foliaMix(5.4, 12.8, retargetBoost)));

      var springStrength = foliaMix(208, foliaClamp(15.8 / Math.max(state.retarget.duration * state.retarget.duration, 0.0064), 260, 780), retargetBoost);
      var damping = foliaMix(24, foliaClamp(Math.sqrt(springStrength) * 1.36, 24, 40), retargetBoost);
      var accelX = (state.camera.focusX - state.camera.x) * springStrength - state.camera.velocityX * damping;
      var accelY = (state.camera.focusY - state.camera.y) * springStrength - state.camera.velocityY * damping;
      state.camera.velocityX += accelX * dt;
      state.camera.velocityY += accelY * dt;
      var maxVelocity = foliaMix(1320, foliaClamp(cameraDistance / Math.max(state.retarget.duration * 0.28, 0.028), 2600, 8800), retargetBoost);
      state.camera.velocityX = foliaClamp(state.camera.velocityX, -maxVelocity, maxVelocity);
      state.camera.velocityY = foliaClamp(state.camera.velocityY, -maxVelocity, maxVelocity);
      state.camera.x += state.camera.velocityX * dt;
      state.camera.y += state.camera.velocityY * dt;

      var scaleSpringStrength = foliaMix(54, 108, retargetBoost);
      var scaleDamping = foliaMix(13.5, 21, retargetBoost);
      var accelScale = (state.camera.focusScale - state.camera.scale) * scaleSpringStrength - state.camera.velocityScale * scaleDamping;
      state.camera.velocityScale += accelScale * dt;
      state.camera.velocityScale = foliaClamp(state.camera.velocityScale, -1.6, 1.6);
      state.camera.scale += state.camera.velocityScale * dt;
      state.camera.scale = foliaClamp(state.camera.scale, FUME_CAMERA_SCALE_MIN, FUME_CAMERA_SCALE_MAX);
    }

    return { shouldShowOverview: shouldShowOverview, overviewTextRestoreProgress: overviewTextRestoreProgress };
  }

  var FUME_BACKGROUND_PARALLAX_X = 0.9;
  var FUME_BACKGROUND_PARALLAX_Y = 0.74;
  var FUME_BACKGROUND_SCALE_FACTOR = 0.94;
  var FUME_BACKGROUND_VERTICAL_OFFSET_RATIO = 0.22;

  /* 背景层的机位：拖尾相机（视差）、略低、缩得少。 */
  function fumeResolveBackgroundView(backgroundScene, camera, viewport) {
    var screenScale = camera.scale;
    var backgroundCenterX = backgroundScene.width * 0.5;
    var backgroundCenterY = backgroundScene.height * 0.5;
    var backgroundVerticalOffset = foliaClamp(
      viewport.height * FUME_BACKGROUND_VERTICAL_OFFSET_RATIO / Math.max(screenScale, 0.001), 48, 180
    );
    var backgroundCameraX = foliaMix(backgroundCenterX, camera.x, FUME_BACKGROUND_PARALLAX_X);
    var backgroundCameraY = foliaMix(backgroundCenterY, camera.y, FUME_BACKGROUND_PARALLAX_Y) - backgroundVerticalOffset;
    var backgroundScale = foliaClamp(screenScale * FUME_BACKGROUND_SCALE_FACTOR, FUME_CAMERA_SCALE_MIN, FUME_CAMERA_SCALE_MAX);
    return { backgroundCenterX: backgroundCenterX, backgroundCenterY: backgroundCenterY, backgroundCameraX: backgroundCameraX, backgroundCameraY: backgroundCameraY, backgroundScale: backgroundScale };
  }

  /* ------------------------------------------------------------------ *
   * H. 直播栅格（fumeLiveRaster.ts）
   * ------------------------------------------------------------------ */

  var FUME_LIVE_IDLE_MS = 5000;
  var FUME_LIVE_CANVAS_GRANULE = 256;
  var FUME_LIVE_RASTER_LEVELS_PER_OCTAVE = 48;

  /* 不小于 scale 的最小栅格档（每八度 48 档 → 最多缩 2^(1/48) ≈ 1.5%）。 */
  function fumeResolveLiveRasterScale(scale) {
    return Math.pow(2, Math.ceil(Math.log2(Math.max(scale, 1e-3)) * FUME_LIVE_RASTER_LEVELS_PER_OCTAVE - 1e-9) / FUME_LIVE_RASTER_LEVELS_PER_OCTAVE);
  }

  function fumeCreateLiveRaster() {
    var canvases = new Map();

    function ensure(id, width, height) {
      var current = canvases.get(id);
      if (current && current.canvas.width >= width && current.canvas.height >= height) return current;
      var canvas = current ? current.canvas : document.createElement('canvas');
      canvas.width = Math.ceil(Math.max(width, current ? current.canvas.width : 0) / FUME_LIVE_CANVAS_GRANULE) * FUME_LIVE_CANVAS_GRANULE;
      canvas.height = Math.ceil(Math.max(height, current ? current.canvas.height : 0) / FUME_LIVE_CANVAS_GRANULE) * FUME_LIVE_CANVAS_GRANULE;
      var context = canvas.getContext('2d');
      if (!context) throw new Error('Fume live text canvas is unavailable');
      var live = { canvas: canvas, context: context, lastUsed: 0, usedWidth: 0, usedHeight: 0 };
      canvases.set(id, live);
      return live;
    }

    return {
      /* 把正在印刷的块画进自己的画布（栅格档略高于当前设备缩放），再整张贴回舞台。
       * 只有屏幕上那部分会被画，所以活画布永远不会超过视口。 */
      draw: function (block, timing, params, frame, now) {
        var deviceScale = frame.deviceScale;
        var visible = frame.visible;
        var scale = fumeResolveLiveRasterScale(deviceScale);
        var glowReach = (12 + block.fontPx * 0.7) * Math.max(params.glowIntensity, 1) * 1.5;
        var pad = Math.ceil(block.lineHeight * 0.5 + glowReach / Math.max(scale, 0.01));
        var left = Math.max(block.x - pad, visible.left);
        var top = Math.max(block.y - pad, visible.top);
        var right = Math.min(block.x + block.width + pad, visible.right);
        var bottom = Math.min(block.y + block.height + pad, visible.bottom);
        if (right <= left || bottom <= top) return null;
        var width = Math.max(1, Math.ceil((right - left) * scale));
        var height = Math.max(1, Math.ceil((bottom - top) * scale));

        var live = ensure(block.id, width, height);
        var context = live.context;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, Math.max(live.usedWidth, width), Math.max(live.usedHeight, height));
        context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
        fumeDrawLiveBlock(context, block, timing, params);
        live.usedWidth = width;
        live.usedHeight = height;
        live.lastUsed = now;

        return {
          canvas: live.canvas, width: width, height: height,
          x: left, y: top, worldWidth: width / scale, worldHeight: height / scale
        };
      },
      sweep: function (now) {
        canvases.forEach(function (live, id) {
          if (now - live.lastUsed <= FUME_LIVE_IDLE_MS) return;
          live.canvas.width = 0;
          live.canvas.height = 0;
          canvases.delete(id);
        });
      },
      clear: function () {
        canvases.forEach(function (live) {
          live.canvas.width = 0;
          live.canvas.height = 0;
        });
        canvases.clear();
      },
      size: function () { return canvases.size; }
    };
  }

  /* ------------------------------------------------------------------ *
   * I. 背景（FumeBackground.ts）
   * ------------------------------------------------------------------ */

  function fumeBuildShapePath(context, shape) {
    context.beginPath();
    if (shape.kind === 'ring') {
      var gapStart = shape.ringGapStart != null ? shape.ringGapStart : -Math.PI * 0.18;
      var gapSize = foliaClamp(shape.ringGapSize != null ? shape.ringGapSize : (Math.PI * 0.2), 0.18, Math.PI * 0.6);
      context.lineCap = 'round';
      context.ellipse(0, 0, shape.width * 0.5, shape.width * 0.5, 0, gapStart + gapSize, gapStart + Math.PI * 2);
      return;
    }
    var size = shape.width;
    if (shape.kind === 'square') {
      context.rect(-size * 0.5, -size * 0.5, size, size);
    } else if (shape.kind === 'cross') {
      var arm = size * 0.3;
      context.moveTo(-arm, -size * 0.5);
      context.lineTo(arm, -size * 0.5);
      context.lineTo(arm, -arm);
      context.lineTo(size * 0.5, -arm);
      context.lineTo(size * 0.5, arm);
      context.lineTo(arm, arm);
      context.lineTo(arm, size * 0.5);
      context.lineTo(-arm, size * 0.5);
      context.lineTo(-arm, arm);
      context.lineTo(-size * 0.5, arm);
      context.lineTo(-size * 0.5, -arm);
      context.lineTo(-arm, -arm);
      context.closePath();
    } else {
      var outer = size * 0.5;
      var inner = size * 0.13;
      context.moveTo(0, -outer);
      context.lineTo(inner, -inner);
      context.lineTo(outer, 0);
      context.lineTo(inner, inner);
      context.lineTo(0, outer);
      context.lineTo(-inner, inner);
      context.lineTo(-outer, 0);
      context.lineTo(-inner, -inner);
      context.closePath();
    }
  }

  function fumeTraceShape(context, shape) {
    context.save();
    context.translate(shape.x, shape.y);
    context.rotate(shape.rotation);
    fumeBuildShapePath(context, shape);
    context.stroke();
    context.restore();
  }

  function fumeNormalizeBounds(bounds, worldWidth, worldHeight) {
    return {
      left: foliaClamp(Math.min(bounds.left, bounds.right), 0, worldWidth),
      top: foliaClamp(Math.min(bounds.top, bounds.bottom), 0, worldHeight),
      right: foliaClamp(Math.max(bounds.left, bounds.right), 0, worldWidth),
      bottom: foliaClamp(Math.max(bounds.top, bounds.bottom), 0, worldHeight)
    };
  }

  /* 线图形的渐变只取决于尺寸/透明度/两个主题色——帧间不变，按 context 缓存。 */
  var fumeLineGradients = new WeakMap();
  var FUME_LINE_GRADIENT_LIMIT = 256;

  function fumeDrawBackground(params) {
    var context = params.context;
    var scene = params.scene;
    var theme = params.theme;
    var time = params.time || 0;
    var audioLevels = params.audioLevels;
    var parallax = params.parallax;
    var objectOpacityMultiplier = params.objectOpacityMultiplier == null ? 1 : params.objectOpacityMultiplier;

    var resolvedObjectOpacityMultiplier = foliaClamp(objectOpacityMultiplier, 0, 2);
    var gradients = fumeLineGradients.get(context);
    if (!gradients) {
      gradients = new Map();
      fumeLineGradients.set(context, gradients);
    }

    var createLineGradient = function (shape, opacity) {
      var key = shape.width + '|' + shape.height + '|' + opacity + '|' + theme.secondaryColor + '|' + theme.accentColor;
      var cached = gradients.get(key);
      if (cached) return cached;
      var gradient = context.createLinearGradient(-shape.width * 0.55, -shape.height * 0.28, shape.width * 0.55, shape.height * 0.28);
      gradient.addColorStop(0, foliaColorWithAlpha(theme.secondaryColor, opacity * 0.18));
      gradient.addColorStop(0.28, foliaColorWithAlpha(foliaMixColors(theme.secondaryColor, theme.accentColor, 0.24), opacity * 0.58));
      gradient.addColorStop(0.54, foliaColorWithAlpha(foliaMixColors(theme.secondaryColor, theme.accentColor, 0.62), opacity * 0.92));
      gradient.addColorStop(1, foliaColorWithAlpha(theme.accentColor, opacity * 0.7));
      return foliaRememberBounded(gradients, key, gradient, FUME_LINE_GRADIENT_LIMIT);
    };

    var drawGradientGeometry = function (shape, opacity) {
      var baseWidth = Math.max(shape.strokeWidth * 0.28, 0.14);
      var topWidth = Math.max(shape.strokeWidth * 0.92, 0.78);
      fumeBuildShapePath(context, shape);
      context.strokeStyle = createLineGradient(shape, opacity * 0.56);
      context.lineWidth = baseWidth;
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
      context.stroke();
      fumeBuildShapePath(context, shape);
      context.strokeStyle = createLineGradient(shape, opacity);
      context.lineWidth = topWidth;
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
      context.stroke();
    };

    for (var i = 0; i < scene.shapes.length; i++) {
      var shape = scene.shapes[i];
      var bandValue = shape.audioBand ? (audioLevels ? audioLevels[shape.audioBand] : undefined) : undefined;
      var audioScale = bandValue === undefined ? 1 : foliaMix(0.95, 1.45, foliaClamp((bandValue - 10) / 190, 0, 1));
      var audioOpacityBoost = bandValue === undefined ? 1 : foliaMix(0.85, 1.55, foliaClamp((bandValue - 10) / 190, 0, 1));

      context.save();
      context.lineWidth = shape.strokeWidth;
      var shapeColor = shape.color === 'accent' ? theme.accentColor : theme.secondaryColor;
      var layerResponse = foliaMix(0.58, 1.16, shape.depth);
      var parallaxStrength = parallax && parallax.strength != null ? parallax.strength : 1;
      var parallaxOffsetX = parallax ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength : 0;
      var parallaxOffsetY = parallax ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength : 0;

      var renderedShape = {
        x: shape.x + parallaxOffsetX,
        y: shape.y + parallaxOffsetY,
        width: shape.width * audioScale,
        height: shape.height * audioScale,
        rotation: shape.rotation + time * shape.rotationSpeed,
        kind: shape.kind,
        strokeWidth: shape.strokeWidth,
        ringGapStart: shape.ringGapStart,
        ringGapSize: shape.ringGapSize
      };

      if (shape.kind === 'spark') {
        context.strokeStyle = foliaColorWithAlpha(shapeColor, foliaClamp(shape.opacity * audioOpacityBoost * resolvedObjectOpacityMultiplier, 0, 0.42));
        context.lineWidth = shape.strokeWidth;
        context.shadowBlur = 10 * audioScale;
        context.shadowColor = foliaColorWithAlpha(shapeColor, shape.opacity * audioOpacityBoost * 0.75 * resolvedObjectOpacityMultiplier);
        fumeTraceShape(context, renderedShape);
      } else {
        context.translate(renderedShape.x, renderedShape.y);
        context.rotate(renderedShape.rotation);
        drawGradientGeometry(renderedShape, foliaClamp(shape.opacity * audioOpacityBoost * resolvedObjectOpacityMultiplier, 0, 0.42));
      }
      context.restore();
    }
  }

  function fumeChoosePaperHaloAnchor(params) {
    var paperBounds = params.paperBounds;
    var worldWidth = params.worldWidth;
    var worldHeight = params.worldHeight;
    var width = params.width;
    var height = params.height;
    var seedKey = params.seedKey;

    var insideChance = foliaSeeded(seedKey + ':inside-chance');
    if (insideChance < 0.22) {
      return {
        x: foliaClamp(foliaMix(paperBounds.left + width * 0.12, paperBounds.right - width * 0.12, foliaSeeded(seedKey + ':inside-x')), 0, worldWidth),
        y: foliaClamp(foliaMix(paperBounds.top + height * 0.12, paperBounds.bottom - height * 0.12, foliaSeeded(seedKey + ':inside-y')), 0, worldHeight)
      };
    }

    var side = Math.floor(foliaSeeded(seedKey + ':side') * 4) % 4;
    var overflowX = width * foliaMix(0.16, 0.24, foliaSeeded(seedKey + ':overflow-x'));
    var overflowY = height * foliaMix(0.16, 0.24, foliaSeeded(seedKey + ':overflow-y'));
    var spanJitterX = width * foliaMix(-0.18, 0.18, foliaSeeded(seedKey + ':span-jitter-x'));
    var spanJitterY = height * foliaMix(-0.18, 0.18, foliaSeeded(seedKey + ':span-jitter-y'));

    if (side === 0) {
      return {
        x: foliaClamp(paperBounds.left - overflowX, 0, worldWidth),
        y: foliaClamp(foliaMix(paperBounds.top - height * 0.12, paperBounds.bottom + height * 0.12, foliaSeeded(seedKey + ':y')) + spanJitterY, 0, worldHeight)
      };
    }
    if (side === 1) {
      return {
        x: foliaClamp(paperBounds.right + overflowX, 0, worldWidth),
        y: foliaClamp(foliaMix(paperBounds.top - height * 0.12, paperBounds.bottom + height * 0.12, foliaSeeded(seedKey + ':y')) + spanJitterY, 0, worldHeight)
      };
    }
    if (side === 2) {
      return {
        x: foliaClamp(foliaMix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, foliaSeeded(seedKey + ':x')) + spanJitterX, 0, worldWidth),
        y: foliaClamp(paperBounds.top - overflowY, 0, worldHeight)
      };
    }
    return {
      x: foliaClamp(foliaMix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, foliaSeeded(seedKey + ':x')) + spanJitterX, 0, worldWidth),
      y: foliaClamp(paperBounds.bottom + overflowY, 0, worldHeight)
    };
  }

  function fumeBuildBackgroundScene(params) {
    var viewport = params.viewport;
    var world = params.world;
    var paperBoundsInput = params.paperBounds;
    var seed = params.seed;

    if (viewport.width <= 0 || viewport.height <= 0 || world.width <= 0 || world.height <= 0) {
      return {
        width: Math.max(world.width, viewport.width, 1),
        height: Math.max(world.height, viewport.height, 1),
        shapes: []
      };
    }

    var worldWidth = Math.max(world.width, viewport.width * 1.2);
    var worldHeight = Math.max(world.height, viewport.height * 1.2);
    var baseUnit = foliaClamp(Math.min(viewport.width, viewport.height) * 0.72, 320, 760);
    var defaultPaperBounds = {
      left: worldWidth * 0.24, top: worldHeight * 0.18,
      right: worldWidth * 0.76, bottom: worldHeight * 0.82
    };
    var resolvedPaperBounds = fumeNormalizeBounds(paperBoundsInput || defaultPaperBounds, worldWidth, worldHeight);
    var shapeKinds = ['ring', 'square', 'cross', 'ring', 'square', 'cross'];
    var shapeCount = worldWidth > worldHeight ? 8 : 7;
    var sparkBands = ['treble', 'vocal', 'mid', 'treble', 'lowMid'];
    var sparkCount = worldWidth > worldHeight ? 12 : 9;
    var sparkAreaLeft = worldWidth * 0.2;
    var sparkAreaRight = worldWidth * 0.8;
    var sparkAreaTop = worldHeight * 0.18;
    var sparkAreaBottom = worldHeight * 0.82;
    var sparkAreaWidth = sparkAreaRight - sparkAreaLeft;
    var sparkAreaHeight = sparkAreaBottom - sparkAreaTop;
    var sparkColumns = Math.ceil(Math.sqrt(sparkCount * (worldWidth / Math.max(worldHeight, 1))));
    var sparkRows = Math.ceil(sparkCount / sparkColumns);
    var sparkCellWidth = sparkAreaWidth / sparkColumns;
    var sparkCellHeight = sparkAreaHeight / sparkRows;

    var baseShapes = [];
    for (var index = 0; index < shapeCount; index++) {
      var localSeed = (seed == null ? 'fume' : seed) + ':' + worldWidth + ':' + worldHeight + ':' + index;
      var kind = shapeKinds[index % shapeKinds.length];
      var width = baseUnit * foliaMix(0.82, 1.36, foliaSeeded(localSeed + ':size'));
      var anchor = fumeChoosePaperHaloAnchor({
        paperBounds: resolvedPaperBounds, worldWidth: worldWidth, worldHeight: worldHeight,
        width: width, height: width, seedKey: localSeed
      });
      baseShapes.push({
        id: 'fume-bg-' + index,
        kind: kind,
        x: anchor.x, y: anchor.y,
        width: width, height: width,
        rotation: foliaMix(-Math.PI * 0.2, Math.PI * 0.2, foliaSeeded(localSeed + ':rotation')),
        rotationSpeed: foliaMix(-0.045, 0.045, foliaSeeded(localSeed + ':rotation-speed')),
        strokeWidth: foliaMix(0.25, 2.1, foliaSeeded(localSeed + ':stroke-width')),
        opacity: foliaMix(0.01, 0.16, foliaSeeded(localSeed + ':opacity')),
        color: foliaSeeded(localSeed + ':color') > 0.5 ? 'accent' : 'secondary',
        depth: foliaSeeded(localSeed + ':depth'),
        ringGapStart: kind === 'ring' ? foliaMix(-Math.PI, Math.PI, foliaSeeded(localSeed + ':gap-start')) : undefined,
        ringGapSize: kind === 'ring' ? foliaMix(Math.PI * 0.12, Math.PI * 0.24, foliaSeeded(localSeed + ':gap-size')) : undefined
      });
    }

    var sparkShapes = [];
    for (var sIndex = 0; sIndex < sparkCount; sIndex++) {
      var sparkSeed = (seed == null ? 'fume' : seed) + ':' + worldWidth + ':' + worldHeight + ':spark:' + sIndex;
      var sparkWidth = baseUnit * foliaMix(0.1, 0.24, foliaSeeded(sparkSeed + ':size'));
      var column = sIndex % sparkColumns;
      var row = Math.floor(sIndex / sparkColumns);
      var jitterX = foliaMix(-0.32, 0.32, foliaSeeded(sparkSeed + ':jitter-x')) * sparkCellWidth;
      var jitterY = foliaMix(-0.32, 0.32, foliaSeeded(sparkSeed + ':jitter-y')) * sparkCellHeight;
      sparkShapes.push({
        id: 'fume-spark-' + sIndex,
        kind: 'spark',
        x: foliaClamp(sparkAreaLeft + (column + 0.5) * sparkCellWidth + jitterX, sparkAreaLeft, sparkAreaRight),
        y: foliaClamp(sparkAreaTop + (row + 0.5) * sparkCellHeight + jitterY, sparkAreaTop, sparkAreaBottom),
        width: sparkWidth, height: sparkWidth,
        rotation: foliaMix(-Math.PI, Math.PI, foliaSeeded(sparkSeed + ':rotation')),
        rotationSpeed: foliaMix(-0.18, 0.18, foliaSeeded(sparkSeed + ':rotation-speed')),
        strokeWidth: foliaMix(0.75, 1.7, foliaSeeded(sparkSeed + ':stroke-width')),
        opacity: foliaMix(0.08, 0.22, foliaSeeded(sparkSeed + ':opacity')),
        color: foliaSeeded(sparkSeed + ':color') > 0.5 ? 'accent' : 'secondary',
        depth: foliaSeeded(sparkSeed + ':depth'),
        audioBand: sparkBands[sIndex % sparkBands.length]
      });
    }

    var shapes = baseShapes.concat(sparkShapes).sort(function (left, right) { return left.depth - right.depth; });
    return { width: worldWidth, height: worldHeight, shapes: shapes };
  }

  /* ------------------------------------------------------------------ *
   * J. 舞台与模式注册
   * ------------------------------------------------------------------ */

  /* 版式缓存跨样式切换保留（Folia 的模块级 lastFumeLayoutCache）。 */
  var fumeLastLayoutCache = { key: '', article: null };
  /* 音频适配：本项目 0~1 → Folia 的 0~255（背景公式按 0~255 标定）。 */
  function fumeReadAudioLevels(ctx) {
    var bands = (ctx.audio && ctx.audio.bands) || {};
    function band255(value) {
      var n = Number(value);
      return isFinite(n) ? foliaClamp(n, 0, 1) * 255 : 0;
    }
    var mid = band255(bands.mid);
    return {
      power: band255(ctx.audio && ctx.audio.power),
      bass: band255(bands.bass),
      lowMid: mid,
      mid: mid,
      vocal: band255(bands.vocal),
      treble: band255(bands.treble)
    };
  }

  function fumeResolvePassedFadeDuration(lines, textHoldRatio) {
    if (textHoldRatio >= 1) return Infinity;
    var timedLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var startTime = line.startTime;
      var endTime = foliaGetLineRenderEndTime(line);
      if (isFinite(startTime) && isFinite(endTime) && endTime >= startTime) timedLines.push({ startTime: startTime, endTime: endTime });
    }
    timedLines.sort(function (left, right) { return left.startTime - right.startTime; });

    if (timedLines.length <= 1) return foliaClamp(8 * textHoldRatio, 2.4, 130);
    var first = timedLines[0];
    var last = timedLines[timedLines.length - 1];
    var totalDuration = Math.max(last.endTime - first.startTime, 0);
    return foliaClamp(totalDuration * textHoldRatio, 2.4, 130);
  }

  registerFoliaMode('fume', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerFume = 浮名，order 60，
     * pickerDescription.visualizer.fume = 满屏歌词层层堆叠，镜头追着当前句推移，虚实之间浮沉。 */
    name: '浮名',
    desc: '满屏歌词层层堆叠，镜头追着当前句推移，虚实之间浮沉',
    order: 60,

    create: function (host, ctx) {
      var root = document.createElement('div');
      root.className = 'folia-fume';
      host.appendChild(root);

      /* 舞台外层：第一段文字开印时从 0.985 缩放到 1（Folia 的 motion.div）。 */
      var stage = document.createElement('div');
      stage.className = 'folia-fume-stage';
      stage.style.transform = 'scale(0.985)';
      var canvas = document.createElement('canvas');
      canvas.className = 'folia-fume-canvas';
      stage.appendChild(canvas);
      root.appendChild(stage);

      /* 版式构建中的加载卡（Folia 的 Hourglass + 骨架条）。 */
      var loading = document.createElement('div');
      loading.className = 'folia-fume-loading';
      loading.style.display = 'none';
      var card = document.createElement('div');
      card.className = 'folia-fume-loading-card';
      var bars = document.createElement('div');
      bars.className = 'folia-fume-loading-bars';
      for (var b = 0; b < 3; b++) {
        var bar = document.createElement('div');
        bar.className = 'folia-fume-loading-bar';
        bar.style.width = (b === 0 ? 100 : (b === 1 ? 78 : 56)) + '%';
        bars.appendChild(bar);
      }
      card.appendChild(bars);
      loading.appendChild(card);
      root.appendChild(loading);

      var sizes = {
        translationFontSize: foliaClampFontSize(1.05, 2.2, 1.2, ctx.fontScale || 1),
        upcomingFontSize: foliaClampFontSize(0.875, 1.8, 1, ctx.fontScale || 1)
      };
      var subtitle = foliaCreateSubtitleOverlay(host, ctx.theme, sizes);

      var inst = {
        pretext: null,
        root: root,
        stage: stage,
        canvas: canvas,
        loading: loading,
        subtitle: subtitle,
        context: canvas.getContext('2d'),
        viewport: { width: Math.max(host.clientWidth, 1), height: Math.max(host.clientHeight, 1) },
        article: null,
        layoutPending: false,
        hasResolvedArticle: false,
        hasPrintedContent: false,
        layoutBuildVersion: 0,
        layoutRaf: 0,
        layoutTimer: 0,
        linesRef: null,
        fontScale: ctx.fontScale == null ? 1 : ctx.fontScale,
        fontSignature: '',
        /* 建实例时的调参快照：tick 里比对对象身份，变了按字段决定重排 / 重建背景。 */
        tuning: fumeTuning(),
        cameraState: fumeCreateCameraState(),
        snapshotCache: new Map(),
        liveRaster: fumeCreateLiveRaster(),
        backgroundScene: null,
        backgroundKey: '',
        destroyed: false,
        observer: null
      };

      function fontSignatureOf(theme) {
        return (theme.fontStack || '') + '|' + (theme.weight == null ? '' : theme.weight) + '|' + (theme.fontStyle || '');
      }
      inst.fontSignature = fontSignatureOf(ctx.theme);

      /* 视口变化（ResizeObserver）→ 重建版式。宿主是 inset:0，等于窗口内尺寸。 */
      if (typeof ResizeObserver === 'function') {
        inst.observer = new ResizeObserver(function (entries) {
          if (inst.destroyed) return;
          var entry = entries[0];
          if (!entry) return;
          var nextWidth = entry.contentRect.width;
          var nextHeight = entry.contentRect.height;
          if (nextWidth === inst.viewport.width && nextHeight === inst.viewport.height) return;
          inst.viewport = { width: nextWidth, height: nextHeight };
          fumeScheduleLayoutBuild();
        });
        inst.observer.observe(host);
      }

      function layoutDepsChanged() {
        if (inst.linesRef !== ctx.lines) return true;
        if (inst.fontScale !== (ctx.fontScale == null ? 1 : ctx.fontScale)) return true;
        if (inst.fontSignature !== fontSignatureOf(ctx.theme)) return true;
        if (inst.viewport.width <= 0 || inst.viewport.height <= 0) return true;
        return false;
      }

      /* Folia 的 layout effect：依赖变化才重建；首版不等（delay 0），之后 96ms 防抖。 */
      function fumeScheduleLayoutBuild() {
        inst.layoutBuildVersion += 1;
        var version = inst.layoutBuildVersion;
        if (inst.viewport.width <= 0 || inst.viewport.height <= 0 || !ctx.lines || ctx.lines.length === 0) {
          inst.hasResolvedArticle = false;
          inst.article = null;
          inst.layoutPending = false;
          inst.loading.style.display = 'none';
          return;
        }
        inst.layoutPending = true;
        inst.loading.style.display = '';
        var delay = inst.hasResolvedArticle ? LAYOUT_REBUILD_DEBOUNCE_MS : 0;
        if (inst.layoutRaf) cancelAnimationFrame(inst.layoutRaf);
        if (inst.layoutTimer) clearTimeout(inst.layoutTimer);
        inst.layoutRaf = requestAnimationFrame(function () {
          inst.layoutTimer = setTimeout(function () {
            if (inst.destroyed || inst.layoutBuildVersion !== version) return;
            buildLayout(version);
          }, delay);
        });
      }

      function buildLayout(version) {
        var layoutTheme = { fontStyle: ctx.theme.fontStyle, fontStack: ctx.theme.fontStack, weight: ctx.theme.weight };
        var lyricsFontScale = inst.fontScale;
        var layoutTuning = { heroScale: fumeTuning().heroScale };
        var cacheKey = fumeBuildLayoutCacheKey(ctx.lines, inst.viewport, layoutTheme, lyricsFontScale, layoutTuning);
        var cached = fumeLastLayoutCache.key === cacheKey ? fumeLastLayoutCache.article : null;
        if (cached) {
          installArticle(cached);
          return;
        }
        foliaLoadPretext().then(function (pretext) {
          if (inst.destroyed || inst.layoutBuildVersion !== version) return;
          var article = fumeBuildArticleLayout(pretext, ctx.lines, inst.viewport, layoutTheme, lyricsFontScale, layoutTuning);
          fumeLastLayoutCache = { key: cacheKey, article: article };
          installArticle(article);
        }).catch(function (err) {
          if (inst.destroyed) return;
          /* 回落必须可见：退出世界并给出原因，不静默白屏。 */
          try {
            foliaWorld.failReason = 'Folia 初始化失败：' + ((err && err.message) || String(err));
            if (typeof foliaWorldExit === 'function') foliaWorldExit({ silent: true });
            if (typeof showToast === 'function') showToast(foliaWorld.failReason);
          } catch (_) {}
          console.error('[FoliaWorld] fume layout failed', err);
        });
      }

      function installArticle(article) {
        inst.article = article;
        inst.hasResolvedArticle = article !== null;
        inst.layoutPending = false;
        inst.loading.style.display = 'none';
        inst.hasPrintedContent = false;
        inst.stage.style.transform = 'scale(0.985)';
        inst.linesRef = ctx.lines;
        inst.fontScale = ctx.fontScale == null ? 1 : ctx.fontScale;
        inst.fontSignature = fontSignatureOf(ctx.theme);
        inst.passedFadeDuration = fumeResolvePassedFadeDuration(ctx.lines, fumeTuning().textHoldRatio);
        /* 注意：相机跨歌曲不重置（Folia 的 cameraStateRef 也是跨文章保留，
         * 由 syncFumeCameraToArticle 夹进新边界）——换歌时相机是飞过去的，不是跳回去的。 */
        fumeReleaseSnapshots(inst, Infinity);
        inst.liveRaster.clear();
        inst.backgroundKey = '';
      }

      inst.scheduleLayoutBuild = fumeScheduleLayoutBuild;
      inst.layoutDepsChanged = layoutDepsChanged;
      /* 绑成闭包：instance.debug() 不带参，直接挂 fumeDebugState 会拿到 undefined。 */
      inst.debug = function () { return fumeDebugState(inst); };
      /* 探针专用：清掉跨样式的那份版式缓存，逼下一次 scheduleLayoutBuild 真算一遍。
       * 不这么做的话「重建后坐标一致」永远命中缓存，断言等于没测。 */
      inst.dropLayoutCache = function () { fumeLastLayoutCache = { key: '', article: null }; };

      /* 首版：先把依赖基线置成当前值（否则第一个 tick 会重复排一次），再排构建。 */
      inst.linesRef = ctx.lines;
      inst.fontScale = ctx.fontScale == null ? 1 : ctx.fontScale;
      inst.fontSignature = fontSignatureOf(ctx.theme);
      inst.passedFadeDuration = fumeResolvePassedFadeDuration(ctx.lines, fumeTuning().textHoldRatio);
      fumeScheduleLayoutBuild();

      return inst;
    },

    tick: function (inst, ctx) {
      if (inst.destroyed) return;
      if (inst.subtitle) inst.subtitle.update(ctx, ctx.dt);
      /* 冒烟探针要用「这一帧的 ctx 时间」，不许拿 debug 时的墙钟去猜（会差一帧）。
       * 放在 paused 早退之前：暂停时虽然不重绘，探针也该看到当前时间。 */
      inst.lastFrame = {
        time: ctx.time, now: ctx.now, index: ctx.index, dt: ctx.dt,
        showText: !!ctx.showText, paused: !!ctx.paused
      };
      if (ctx.paused) return; /* 暂停 = 停画（最后一帧留在画布上，同 Folia 停止重排程） */
      if (!inst.context) return;

      /* 调参变化：11 项里只有两项需要额外的动作 ——
       * heroScale 参与版式几何（整篇要重排），disableGeometricBackground 是共享背景的输入
       * （Folia 把它 OR 到 common 上，见 VisualizerFume.tsx:308）。其余每帧直接读。 */
      var tuning = fumeTuning();
      if (tuning !== inst.tuning) {
        var prevTuning = inst.tuning;
        inst.tuning = tuning;
        inst.passedFadeDuration = fumeResolvePassedFadeDuration(ctx.lines, tuning.textHoldRatio);
        if (!prevTuning || prevTuning.heroScale !== tuning.heroScale) inst.scheduleLayoutBuild();
        if (!prevTuning || prevTuning.disableGeometricBackground !== tuning.disableGeometricBackground) {
          if (typeof foliaWorldRebuildBackground === 'function') foliaWorldRebuildBackground();
        }
      }

      /* 依赖变化才重建版式（与 Folia 的 effect 依赖等价）。
       * 换歌时 passedFadeDuration 立即重算（Folia 的 useMemo 依赖 [lines, textHoldRatio]，
       * 不等版式重建——旧文章还会画一小会儿，用的就是新 fade）。 */
      if (inst.layoutDepsChanged && inst.layoutDepsChanged()) {
        inst.passedFadeDuration = fumeResolvePassedFadeDuration(ctx.lines, fumeTuning().textHoldRatio);
        inst.scheduleLayoutBuild();
      }

      var viewport = inst.viewport;
      var width = Math.max(Math.floor(viewport.width), 1);
      var height = Math.max(Math.floor(viewport.height), 1);
      var dpr = window.devicePixelRatio || 1;
      if (inst.canvas.width !== Math.floor(width * dpr) || inst.canvas.height !== Math.floor(height * dpr)) {
        inst.canvas.width = Math.floor(width * dpr);
        inst.canvas.height = Math.floor(height * dpr);
        inst.canvas.style.width = width + 'px';
        inst.canvas.style.height = height + 'px';
      }

      var context = inst.context;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      var theme = ctx.theme;
      var time = ctx.time;
      var now = ctx.now;
      var dt = foliaClamp(ctx.dt, 1 / 240, 0.05);
      var audioLevels = fumeReadAudioLevels(ctx);
      var viewportCenterX = viewport.width * 0.5;
      var viewportCenterY = viewport.height * 0.5;
      var article = inst.article;
      /* Folia 的 seed = 展示中的歌曲 id，无歌曲时回落 geometry-<mode>；空串按 'fume' 处理。 */
      var seed = ctx.seed ? String(ctx.seed) : 'fume';

      /* 背景场景：随文章/视口/种子重建（Folia 的 useMemo 依赖等价物）。 */
      var backgroundKey = [
        article ? article.width : 0, article ? article.height : 0,
        article ? article.paperBounds.left + ',' + article.paperBounds.top + ',' + article.paperBounds.right + ',' + article.paperBounds.bottom : '',
        seed, theme.fontStyle, Math.round(viewport.width), Math.round(viewport.height)
      ].join('|');
      if (inst.backgroundKey !== backgroundKey) {
        inst.backgroundKey = backgroundKey;
        inst.backgroundScene = fumeBuildBackgroundScene({
          viewport: viewport,
          world: {
            width: article ? article.width : Math.max(viewport.width * 1.8, viewport.width),
            height: article ? article.height : Math.max(viewport.height * 1.8, viewport.height)
          },
          paperBounds: article ? article.paperBounds : null,
          seed: seed + ':' + theme.fontStyle
        });
      }
      var backgroundScene = inst.backgroundScene;

      if (!article) {
        /* 版式还没好：只画背景（Folia 的 !article 分支）。 */
        context.save();
        context.translate(viewportCenterX, viewportCenterY);
        context.translate(-backgroundScene.width * 0.5, -backgroundScene.height * 0.5);
        fumeDrawBackground({
          context: context,
          scene: backgroundScene,
          theme: theme,
          time: time + now * 0.00018,
          audioLevels: audioLevels,
          objectOpacityMultiplier: fumeTuning().backgroundObjectOpacity * 2
        });
        context.restore();
        return;
      }

      /* 一次性检测：任何块开印 → 舞台从 0.985 归一。 */
      if (!inst.hasPrintedContent && time >= article.firstRenderableStartTime) {
        inst.hasPrintedContent = true;
        inst.stage.style.transform = 'scale(1)';
      }

      var overviewStartTime = Infinity;
      for (var li = article.chronologicalBlocks.length - 1; li >= 0; li--) {
        var lastLine = article.chronologicalBlocks[li].line;
        if (String(lastLine.fullText || '').trim().length) {
          var lineStartTime = lastLine.startTime;
          var lineRenderEndTime = foliaGetLineRenderEndTime(lastLine);
          overviewStartTime = lineStartTime + Math.max(lineRenderEndTime - lineStartTime, 0) * 0.5;
          break;
        }
      }
      var overviewCamera = fumeResolveArticleOverviewCamera(article, viewport);

      fumeSyncCameraToArticle(inst.cameraState, article);
      var step = fumeStepCamera(inst.cameraState, {
        article: article,
        time: time,
        now: now,
        dt: dt,
        lineIndex: ctx.index,
        viewport: viewport,
        overviewCamera: overviewCamera,
        overviewStartTime: overviewStartTime,
        cameraSpeed: fumeTuning().cameraSpeed,
        cameraTrackingMode: fumeTuning().cameraTrackingMode,
        animationIntensity: theme.animationIntensity
      });
      var camera = inst.cameraState.camera;
      var screenScale = camera.scale;

      var backgroundView = fumeResolveBackgroundView(backgroundScene, camera, viewport);
      context.save();
      context.translate(viewportCenterX, viewportCenterY);
      context.scale(backgroundView.backgroundScale, backgroundView.backgroundScale);
      context.translate(-backgroundView.backgroundCameraX, -backgroundView.backgroundCameraY);
      fumeDrawBackground({
        context: context,
        scene: backgroundScene,
        theme: theme,
        time: time,
        audioLevels: audioLevels,
        objectOpacityMultiplier: fumeTuning().backgroundObjectOpacity * 2,
        parallax: {
          cameraX: backgroundView.backgroundCameraX,
          cameraY: backgroundView.backgroundCameraY,
          originX: backgroundView.backgroundCenterX,
          originY: backgroundView.backgroundCenterY,
          strength: 0.72
        }
      });
      context.restore();

      context.save();
      context.translate(viewportCenterX, viewportCenterY);
      context.scale(screenScale, screenScale);
      context.translate(-camera.x, -camera.y);

      var glow = fumeResolveGlowBases(theme.animationIntensity, fumeTuning().glowIntensity);
      var liveParams = {
        time: time, theme: theme, glowIntensity: fumeTuning().glowIntensity,
        activeGlowBoost: glow.activeGlowBoost, passedGlowBase: glow.passedGlowBase,
        showPrintStamp: !fumeTuning().hidePrintSymbols
      };
      var staticLayerInput = {
        time: time,
        theme: theme,
        passedGlowBase: glow.passedGlowBase,
        passedFadeDuration: inst.passedFadeDuration,
        overviewTextRestoreProgress: step.overviewTextRestoreProgress,
        snapshotScale: foliaClamp(window.devicePixelRatio || 1, 1, 2)
      };
      var rasterLive = foliaGlowBlurQuantized();
      /* 一点余量：正在进屏的字素进来时就已经画好。 */
      var margin = 32 / screenScale;
      var liveFrame = {
        deviceScale: screenScale * (window.devicePixelRatio || 1),
        visible: {
          left: camera.x - viewportCenterX / screenScale - margin,
          top: camera.y - viewportCenterY / screenScale - margin,
          right: camera.x + viewportCenterX / screenScale + margin,
          bottom: camera.y + viewportCenterY / screenScale + margin
        }
      };

      if (ctx.showText) {
        for (var bi = 0; bi < article.blocks.length; bi++) {
          var block = article.blocks[bi];
          if (!fumeIsBlockOnScreen(block, camera, viewport)) continue;

          var nextLineStartTime = ctx.lines[block.sourceLineIndex + 1] ? ctx.lines[block.sourceLineIndex + 1].startTime : null;
          var timing = fumeResolveBlockTiming(block, time, nextLineStartTime, fumeTuning().textHoldRatio);
          var layers = fumeResolveStaticLayers(block, timing, staticLayerInput, function (spec) {
            var entry = inst.snapshotCache.get(spec.key);
            if (!entry) {
              var snapshot = fumeCreateStaticBlockSnapshot(block, theme, spec.fill, spec.shadowBlur, spec.shadowColor);
              if (!snapshot) return undefined;
              entry = { snapshot: snapshot, lastUsed: now };
              inst.snapshotCache.set(spec.key, entry);
            }
            entry.lastUsed = now;
            return entry.snapshot;
          });

          if (layers) {
            for (var di = 0; di < layers.length; di++) {
              context.globalAlpha = layers[di].alpha;
              context.drawImage(
                layers[di].snapshot.canvas,
                block.x - layers[di].snapshot.padding,
                block.y - layers[di].snapshot.padding,
                block.width + layers[di].snapshot.padding * 2,
                block.height + layers[di].snapshot.padding * 2
              );
            }
            context.globalAlpha = 1;
            continue;
          }

          if (!rasterLive) {
            fumeDrawLiveBlock(context, block, timing, liveParams);
            continue;
          }
          var image = inst.liveRaster.draw(block, timing, liveParams, liveFrame, now);
          if (image) {
            context.drawImage(image.canvas, 0, 0, image.width, image.height, image.x, image.y, image.worldWidth, image.worldHeight);
          }
        }
      }
      context.restore();
      inst.liveRaster.sweep(now);
      fumeReleaseSnapshots(inst, now);
    },

    destroy: function (inst) {
      if (!inst || inst.destroyed) return;
      inst.destroyed = true;
      if (inst.layoutRaf) cancelAnimationFrame(inst.layoutRaf);
      if (inst.layoutTimer) clearTimeout(inst.layoutTimer);
      if (inst.observer) { try { inst.observer.disconnect(); } catch (_) {} }
      fumeReleaseSnapshots(inst, Infinity);
      inst.liveRaster.clear();
      if (inst.subtitle) inst.subtitle.destroy();
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.article = null;
      inst.backgroundScene = null;
    }
  });

  /* 冒烟/取证探针：把内部状态暴露出来（断言不许猜）。挂在实例上，instance.debug() 调用。
   * 块的三态用 fumeResolveBlockTiming（tick 里同一函数）算，不另写一套判据 ——
   * 否则探针会「自己证明自己对」。 */
  function fumeDebugState(inst) {
    var blocks = inst.article ? inst.article.blocks : [];
    var frame = inst.lastFrame || { time: 0, now: 0, index: 0 };
    var textHoldRatio = fumeTuning().textHoldRatio;
    var summary = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var nextLineStartTime = inst.linesRef && inst.linesRef[block.sourceLineIndex + 1]
        ? inst.linesRef[block.sourceLineIndex + 1].startTime
        : null;
      var timing = fumeResolveBlockTiming(block, frame.time, nextLineStartTime, textHoldRatio);
      var phase = timing.staticState == null
        ? (timing.hasRevealCompleted ? 'active' : 'printing')
        : timing.staticState;
      summary.push({
        id: block.id,
        sourceLineIndex: block.sourceLineIndex,
        variant: block.variant,
        column: block.column,
        x: Math.round(block.x * 100) / 100,
        y: Math.round(block.y * 100) / 100,
        width: Math.round(block.width * 100) / 100,
        height: Math.round(block.height * 100) / 100,
        fontPx: Math.round(block.fontPx * 100) / 100,
        renderLines: block.renderLines.length,
        graphemes: block.graphemes.length,
        phase: phase,
        lineStartTime: block.line.startTime,
        lineEndTime: Math.round(timing.lineEndTime * 1000) / 1000,
        linePassCutoffTime: Math.round(timing.linePassCutoffTime * 1000) / 1000,
        colorTrailDuration: Math.round(timing.colorTrailDuration * 1000) / 1000,
        revealComplete: !!timing.hasRevealCompleted,
        passCutoffReached: !!timing.hasPassCutoffReached,
        text: block.renderLines.map(function (rl) { return rl.text; }).join('/')
      });
    }
    return {
      hasArticle: !!inst.article,
      layoutPending: inst.layoutPending,
      hasPrintedContent: inst.hasPrintedContent,
      lastFrame: {
        time: Math.round(frame.time * 1000) / 1000,
        index: frame.index,
        showText: frame.showText,
        paused: !!frame.paused,
        dt: Math.round((frame.dt || 0) * 1000) / 1000
      },
      stageTransform: inst.stage ? inst.stage.style.transform : '',
      loadingDisplay: inst.loading ? inst.loading.style.display : '',
      viewport: { width: Math.round(inst.viewport.width), height: Math.round(inst.viewport.height) },
      canvas: { width: inst.canvas.width, height: inst.canvas.height },
      article: inst.article ? {
        width: Math.round(inst.article.width),
        height: Math.round(inst.article.height),
        columns: inst.article.columns,
        gap: inst.article.gap,
        paperBounds: inst.article.paperBounds,
        blockCount: blocks.length,
        heroCount: blocks.filter(function (b) { return b.variant === 'hero'; }).length,
        firstRenderableStartTime: inst.article.firstRenderableStartTime,
        lastChronologicalRenderEndTime: inst.article.lastChronologicalRenderEndTime
      } : null,
      camera: {
        x: Math.round(inst.cameraState.camera.x * 100) / 100,
        y: Math.round(inst.cameraState.camera.y * 100) / 100,
        scale: Math.round(inst.cameraState.camera.scale * 1000) / 1000,
        retargetLine: inst.cameraState.retarget.sourceLineIndex,
        bridgeMode: inst.cameraState.retarget.bridgeMode
      },
      blocks: summary,
      snapshotCount: inst.snapshotCache.size,
      liveRasterCount: inst.liveRaster.size()
    };
  }

  /* 空闲超过 SNAPSHOT_IDLE_MS 的快照释放（now = Infinity 表示全放）。 */
  var FUME_SNAPSHOT_IDLE_MS = 15000;
  function fumeReleaseSnapshots(inst, now) {
    inst.snapshotCache.forEach(function (entry, key) {
      if (now - entry.lastUsed <= FUME_SNAPSHOT_IDLE_MS) return;
      /* 立即归还后备存储，而不是等 canvas 被回收。 */
      entry.snapshot.canvas.width = 0;
      entry.snapshot.canvas.height = 0;
      inst.snapshotCache.delete(key);
    });
  }
})();
