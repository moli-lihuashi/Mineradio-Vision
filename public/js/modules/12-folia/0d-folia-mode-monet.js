/* Folia 世界 — 歌词样式：莫奈（monet）
 *
 * 移植自 Folia src/components/visualizer/monet/（17 文件 3754 行）+
 *          components/visualizer/backgrounds/monet/（背景 wash 管线）。
 *
 * 这套样式是一张**海报**：左列竖排（歌手 → 竖线 → 曲名 → 专辑 → 歌词轨 → 描述胶囊），
 * 右侧封面立牌（square 画到 135.135% 并左移 35.135%），左下角音频条，全屏漂浮装饰。
 * 歌词轨不是逐行堆叠，而是「固定轨道 + 弹簧跟随」：
 *   1. 窗口：当前行 ±2 行，逐行给 waiting / active / passed 三态；
 *   2. 测量：pretext 富行内测量（timed 词 break:'never' 的原子盒）算出每行要预留多高；
 *   3. 排布：锚点行钉在 railHeight×0.46 的中心，上下按 scaledHeight + gap 递推；
 *   4. 扫字：当前行逐词按字素时序推 mask 前缘，background-clip:text 铺渐变；
 *   5. 辉光：上升段 1.18×词长 到峰值，衰减段到 max(lineEnd, end+1.05)，两段都 smoothstep。
 *
 * 关键常量（改动即走形）：
 *   - 字号 clamp(1.34rem, 2.75vw, 2.28rem)×fontScale(1.2)=默认 36.5px 左右
 *   - 大屏统一放大 resolveMonetLargeScreenScale：≤1536px 为 1，2200px 到 1.16；
 *     字号与栏宽同乘这个因子 → 换行不变（这是它「不乱」的前提）
 *   - 行间距 = 相邻任一方 active ? max(18, fontPx×0.49) : max(14, fontPx×0.38)
 *   - 栏高 clamp(280px, 52vh, max(520×scale, fontPx×1.18×7))，宽 780×scale
 *   - 扫字羽化 = clamp(fontPx×0.45, 6, 16)；mask 前缘再向前推 soft×progress
 *   - 弹簧 MONET_SCROLL_SPRING{142,28,0.82} / MONET_SCALE_SPRING{150,30,0.78}
 *
 * 与 Folia 的实现差异（都不改画面）：
 *   1) Folia 是 React + framer-motion；这里 create/tick 挂主循环。y/scale 用
 *      foliaSpringFollower 逐帧积分（同一个 stiffness/damping/mass），opacity/filter 交给
 *      CSS transition 的 cubic-bezier(.32,.72,0,1)（0.28s / 0.32s），与 framer 的
 *      tween 定义逐字一致。
 *   2) Folia 的入场/退场是 AnimatePresence 的 initial/exit；这里用初始值 + 一次 rAF 收口，
 *      退场用 200ms 的 y 补间 + .is-exiting 收紧 transition（同 source 的 0.2s）。
 *   3) Folia 的 `theme.weight` 分「歌词 / 译文 / 译文第二行」三档（subtitleTheme 独立）；
 *      本项目没有独立字幕主题，译文权重取 Folia 的兜底值走同一公式。
 *   4) Folia 的 `theme.description / theme.name` 用作描述胶囊文案；本项目 theme 没有这两个
 *      字段，回落成样式名「莫奈」（Folia 也是回落到模式名 'Monet'）。
 *   5) Folia 的 `line.isChorus` 决定副歌染色与背景光斑；本项目无 TTML，永不触发，
 *      相关分支按 `line.isChorus` 守卫保留（永不进入），不额外造数据。
 *   6) Folia 把封面 wash 背景做成一个**独立背景选项**（backgrounds/monet），默认背景是
 *      latent 而不是它。本项目背景注册表目前只有「无背景」，这里把 wash 当作本样式自带的
 *      底，且在 foliaWorld.background !== 'none' 时自动让位（将来接 'monet' 背景时）
 *      —— 否则海报会落在纯黑上，与 Folia 的观感差一大截。
 *      封面读像素需要 canvas 干净：优先走 /api/cover 代理（同源、无跨域污染），
 *      真拿到污染画布时退回纯 CSS 图层（blur/saturate + 叠色渐变 + 混合模式），观感等价。
 *   7) Folia 的肖像可拖动（portraitOffsetX）+ 编辑态虚线框；本项目没有该设置入口，
 *      按 offsetX=0 渲染，挂杆只保留静息外观（那本来就是海报的一部分）。
 *   8) 两份调参都接上了面板：样式那份走 0l0 的 foliaModeTuning('monet')（本文件的 monetTuning），
 *      背景那份走 01d 的 foliaMonetTuning（0l 的莫奈背景面板）。
 *
 * 依赖：@chenglou/pretext（layout + rich-inline，均 ESM）→ 测量走 foliaLoadPretext /
 *       foliaLoadPretextRich。未就绪时用 canvas 贪心断行兜底（真原子盒语义，误差只在
 *       首个 layout 之前的那一两帧），就绪后清空测量缓存重排。
 */
'use strict';

(function registerFoliaMonetMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* ---------- 0. 调参（Folia types.ts 的 DEFAULT_MONET_TUNING / DEFAULT_MONET_BACKGROUND_TUNING） ----------
   * 前一份是**样式**的调参（0l0 存、0l1 出面板），后一份是**背景**的（01d 存、0l 出面板）。 */
  var MONET_TUNING_DEFAULT = {
    keywordColoringEnabled: true,
    showDescription: true,
    showAudioVisualization: true,
    audioStyle: 'bar',
    fontScale: 1.2,
    portraitSource: 'cover',
    portraitOffsetX: 0,
    portraitStyle: 'square',
    showPortraitDragHanger: true
  };

  /* 当前生效的样式调参：面板写在 0l0（共用存档），这里只读；0l0 没加载时回落默认值。 */
  function monetTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('monet')
      : MONET_TUNING_DEFAULT;
  }

  var MONET_BG_TUNING = {
    backgroundSource: 'cover-derived',
    backgroundLayout: 'full-overlay',
    backgroundBlurPx: 6,
    backgroundOverlayOpacity: 0.74,
    backgroundGrayscale: 0,
    backgroundSaturation: 1.05,
    backgroundWash: 0.34,
    backgroundWashColorMode: 'theme',
    backgroundWashCustomColor: '#8fb7ff',
    backgroundStreaksEnabled: true,
    backgroundDriftEnabled: true,
    backgroundDriftStrength: 0.5
  };

  /* ---------- 1. 常量（monetLyricsModel / monetRailLayout / monetRailMasks） ---------- */
  var ROOT_FONT_PX = 16;
  var MONET_VIEWPORT_FALLBACK_PX = 1280;
  var MONET_ACTIVE_TEXT_LINE_LIMIT = 14;
  var MONET_INACTIVE_TEXT_LINE_LIMIT = 2;
  var MONET_TRANSLATION_LINE_LIMIT = 2;
  var MONET_MIN_MEASURE_WIDTH_PX = 180;
  var MONET_GLYPH_VERTICAL_SAFETY_PX = 2;
  var MONET_GRAPHEME_CACHE_LIMIT = 420;
  var MONET_METRICS_CACHE_LIMIT = 420;
  var MONET_LAYOUT_CACHE_LIMIT = 240;
  var MONET_LARGE_SCREEN_MIN_PX = 1536;
  var MONET_LARGE_SCREEN_FULL_PX = 2200;
  var MONET_LARGE_SCREEN_MAX_SCALE = 1.16;
  var MONET_RAIL_BASE_MAX_WIDTH_PX = 780;
  var MONET_RAIL_BASE_MAX_HEIGHT_PX = 520;
  var MONET_ROW_BASE_MAX_WIDTH_PX = 1520;
  var MONET_PORTRAIT_BASE_MAX_PX = 430;
  var MONET_PORTRAIT_INNER_BASE_MAX_PX = 380;
  var MONET_RAIL_MIN_ROWS = 7;
  var MONET_ACTIVE_GAP_PX = 18;
  var MONET_INACTIVE_GAP_PX = 14;
  var MONET_ACTIVE_GAP_RATIO = 0.49;
  var MONET_INACTIVE_GAP_RATIO = 0.38;
  var MONET_SCROLL_IDLE_RESET_MS = 1800;
  var MONET_SCROLL_STEP_PX = 72;
  var MONET_TOUCH_STEP_PX = 52;
  var MONET_SCROLL_BEFORE = 4;
  var MONET_SCROLL_AFTER = 4;
  var MONET_SUBTITLE_TRACK_STAGGER_S = 0.04;
  var MONET_EXIT_MS = 200;
  var MONET_PORTRAIT_FADE_MS = 900;
  var MONET_PORTRAIT_MAX_LAYERS = 4;
  var MONET_DECOR_COUNT = 10;
  var MONET_AUDIO_BARS = 72;
  var MONET_MIN_RAW_SPECTRUM_BIN = 6;
  var MONET_BG_WIDTH = 1920;
  var MONET_BG_HEIGHT = 1080;

  /* Folia utils/lyrics/subtitleTrackStyle.ts：译文第二行比第一行小一档、淡一档。 */
  var SECONDARY_TRACK_SIZE_FACTOR = 0.88;
  var SECONDARY_TRACK_OPACITY = 0.82;
  var SECONDARY_TRACK_FONT_WEIGHT_FALLBACK = 400;
  var SECONDARY_TRACK_GAP_EM = 0.25;

  /* framer 的 transition 定义（monetRailLayout.MONET_SCROLL_TRANSITION）：
   * y/scale 是弹簧，opacity 0.28s、filter 0.32s，同一条 cubic-bezier(.32,.72,0,1)。
   * 弹簧在这里逐帧积分，两条 tween 交给 CSS transition，所以只需记曲线本身。 */
  var MONET_SCROLL_SPRING = { stiffness: 142, damping: 28, mass: 0.82 };
  var MONET_SCALE_SPRING = { stiffness: 150, damping: 30, mass: 0.78 };

  /* ---------- 2. 共享缓存（模块级：跨实例复用，切样式不重测） ---------- */
  var monetMetricsCache = new Map();
  var monetGraphemeCache = new Map();
  var monetLayoutCacheSeed = new Map();
  var monetBackgroundCache = new Map();
  var monetMeasureCanvas = null;
  var monetBgFilterSupported = null;

  /* ---------- 3. 数学 / 颜色小工具 ---------- */
  function monetClamp(value, min, max) {
    return foliaClamp(value, min, max);
  }

  function monetLuminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function monetMix(from, to, amount) {
    return from + (to - from) * amount;
  }

  function monetSmoothstep(progress) {
    var p = monetClamp(progress, 0, 1);
    return p * p * (3 - 2 * p);
  }

  /* ---------- 4. 字号与整幅缩放 ---------- */
  /* Folia monetLyricsModel.resolveClampFontPx：min 与 max 是 rem，preferred 是 vw。
   * 注意它读的是 window.innerWidth（视口），不是容器宽 —— 大屏缩放另有 resolveLargeScreenScale。 */
  function monetClampFontPx(minRem, preferredVw, maxRem) {
    var viewportWidth = (typeof window !== 'undefined' && window.innerWidth)
      ? window.innerWidth
      : MONET_VIEWPORT_FALLBACK_PX;
    return Math.min(maxRem * ROOT_FONT_PX, Math.max(minRem * ROOT_FONT_PX, viewportWidth * (preferredVw / 100)));
  }

  /* 1536 以下不缩放（老视口布局逐像素不变），1536→2200 线性升到 1.16。
   * 用容器自身宽度，所以嵌入预览按自己的盒子缩放，不会把大屏尺寸当成自己的。 */
  function monetLargeScreenScale(containerWidthPx) {
    var referenceWidth = (containerWidthPx && isFinite(containerWidthPx) && containerWidthPx > 0)
      ? containerWidthPx
      : ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : MONET_VIEWPORT_FALLBACK_PX);
    if (referenceWidth <= MONET_LARGE_SCREEN_MIN_PX) return 1;
    var progress = Math.min(
      1,
      (referenceWidth - MONET_LARGE_SCREEN_MIN_PX) / (MONET_LARGE_SCREEN_FULL_PX - MONET_LARGE_SCREEN_MIN_PX)
    );
    return 1 + (MONET_LARGE_SCREEN_MAX_SCALE - 1) * progress;
  }

  /* VisualizerMonet 的四档字号 + 三个几何上限。fontScale 在 entry.tsx 里已乘过 lyricsFontScale，
   * 本项目等价物是 ctx.fontScale（fx.lyricScale）。 */
  function monetFontMetrics(viewportWidth, fontScale) {
    var scale = (isFinite(fontScale) && fontScale > 0) ? Number(fontScale) : 1;
    var largeScreenScale = monetLargeScreenScale(viewportWidth);
    var tuningScale = monetTuning().fontScale * scale;
    return {
      largeScreenScale: largeScreenScale,
      lyricFontPx: monetClampFontPx(1.34, 2.75, 2.28) * tuningScale * largeScreenScale,
      inactiveFontPx: monetClampFontPx(1.08, 2, 1.48) * tuningScale * largeScreenScale,
      translationFontPx: monetClampFontPx(0.94, 1.28, 1.14) * tuningScale * largeScreenScale,
      rowMaxWidthPx: Math.round(MONET_ROW_BASE_MAX_WIDTH_PX * largeScreenScale),
      portraitMaxPx: Math.round(MONET_PORTRAIT_BASE_MAX_PX * largeScreenScale),
      portraitInnerMaxPx: Math.round(MONET_PORTRAIT_INNER_BASE_MAX_PX * largeScreenScale),
      titleMaxRem: (2.8 * largeScreenScale).toFixed(3),
      artistMaxRem: (1.8 * largeScreenScale).toFixed(3)
    };
  }

  /* ---------- 5. 字素与显示 token ---------- */
  function monetLineRenderEndTime(line) {
    /* 本项目 lines 没有 renderHints（Folia getLineRenderEndTime 的 fallback 就是 endTime）。 */
    return line ? Number(line.endTime) || 0 : 0;
  }

  function monetSplitGraphemes(text) {
    /* 字素切分统一走 core（10-folia-core-text 的 foliaSplitGraphemes）。
     * 注意 Intl.Segmenter.segment() 返回的是 Segments 迭代器，没有 forEach ——
     * 早先自己写的那份就是踩在这里，整条 tick 直接抛错。 */
    return foliaSplitGraphemes(String(text == null ? '' : text));
  }

  function monetFindGraphemeSequence(source, target, fromIndex) {
    if (target.length === 0) return fromIndex;
    for (var index = fromIndex; index <= source.length - target.length; index++) {
      var matched = true;
      for (var t = 0; t < target.length; t++) {
        if (source[index + t] !== target[t]) { matched = false; break; }
      }
      if (matched) return index;
    }
    return -1;
  }

  /* Folia graphemeTiming.buildLineGraphemeTimeline：把词级时序映射回整行（含间隔与标点）。 */
  function monetBuildLineGraphemeTimeline(line) {
    var lineGraphemes = monetSplitGraphemes(line ? line.fullText : '');
    if (lineGraphemes.length === 0) return [];
    var words = (line && line.words) ? line.words : [];
    if (words.length === 0) {
      return foliaBuildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }

    var timeline = new Array(lineGraphemes.length);
    var cursor = 0;
    var lastResolvedTime = line.startTime;

    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      var wordGraphemes = monetSplitGraphemes(word.text);
      if (wordGraphemes.length === 0) continue;

      var matchedStart = monetFindGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

      for (var gap = cursor; gap < start; gap++) {
        timeline[gap] = { char: lineGraphemes[gap], startTime: word.startTime, endTime: word.startTime };
      }

      var wordTimings = foliaBuildWordGraphemeTimings(word);
      for (var local = 0; local < end - start; local++) {
        var timing = wordTimings[local]
          || foliaBuildEvenGraphemeTimings(wordGraphemes[local] || '', word.startTime, word.endTime)[0];
        if (!timing) continue;
        timeline[start + local] = {
          char: lineGraphemes[start + local],
          startTime: timing.startTime,
          endTime: timing.endTime
        };
        if (timing.endTime > lastResolvedTime) lastResolvedTime = timing.endTime;
      }
      if (end > cursor) cursor = end;
    }

    for (var i = 0; i < lineGraphemes.length; i++) {
      if (timeline[i]) continue;
      timeline[i] = { char: lineGraphemes[i], startTime: lastResolvedTime, endTime: lastResolvedTime };
    }
    return timeline;
  }

  /* Folia monetLyricsModel.buildMonetDisplayTokens：
   * 没有词级时序 → 整行一个 timed token；有 → 词与词之间的静态串（空格/标点）单独成 token，
   * 这样 fullText 的标点与空格不会丢。 */
  function monetBuildDisplayTokens(line) {
    if (!line) return [];
    var fullText = String(line.fullText == null ? '' : line.fullText);
    var words = line.words || [];

    if (words.length === 0) {
      return [{
        text: fullText,
        startTime: line.startTime,
        endTime: monetLineRenderEndTime(line),
        key: line.startTime + '-full',
        timed: true,
        startOffset: 0,
        endOffset: fullText.length,
        graphemeTimings: monetBuildLineGraphemeTimeline(line)
      }];
    }

    var tokens = [];
    var cursor = 0;
    for (var index = 0; index < words.length; index++) {
      var word = words[index];
      var wordText = String(word.text || '');
      var matchIndex = fullText.indexOf(wordText, cursor);
      if (matchIndex < 0) continue;

      if (matchIndex > cursor) {
        tokens.push({
          text: fullText.slice(cursor, matchIndex),
          startTime: null,
          endTime: null,
          key: line.startTime + '-static-' + cursor,
          timed: false,
          startOffset: cursor,
          endOffset: matchIndex,
          graphemeTimings: []
        });
      }

      var endOffset = matchIndex + wordText.length;
      tokens.push({
        text: wordText,
        startTime: word.startTime,
        endTime: word.endTime,
        key: line.startTime + '-' + index + '-' + word.startTime,
        timed: true,
        startOffset: matchIndex,
        endOffset: endOffset,
        graphemeTimings: foliaBuildWordGraphemeTimings(word)
      });
      cursor = endOffset;
    }

    if (cursor < fullText.length) {
      tokens.push({
        text: fullText.slice(cursor),
        startTime: null,
        endTime: null,
        key: line.startTime + '-tail-' + cursor,
        timed: false,
        startOffset: cursor,
        endOffset: fullText.length,
        graphemeTimings: []
      });
    }

    if (tokens.length > 0) return tokens;
    return [{
      text: fullText,
      startTime: line.startTime,
      endTime: monetLineRenderEndTime(line),
      key: line.startTime + '-fallback-full',
      timed: true,
      startOffset: 0,
      endOffset: fullText.length,
      graphemeTimings: monetBuildLineGraphemeTimeline(line)
    }];
  }

  /* ---------- 6. 测量 ---------- */
  function monetMeasureContext() {
    if (monetMeasureCanvas) return monetMeasureCanvas;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        monetMeasureCanvas = new OffscreenCanvas(1, 1).getContext('2d');
      } else if (typeof document !== 'undefined') {
        monetMeasureCanvas = document.createElement('canvas').getContext('2d');
      }
    } catch (_) {
      monetMeasureCanvas = null;
    }
    return monetMeasureCanvas;
  }

  /* 行高必须是「最高字形包围盒」，否则 g/j/p/y 与 CJK 降部会被 line-height 裁掉。 */
  function monetMeasureLineHeight(text, fontSpec, fontPx, fallbackLineHeightPx) {
    var key = fontSpec + '|' + text;
    var cached = monetMetricsCache.get(key);
    if (cached !== undefined) return cached;

    var context = monetMeasureContext();
    if (!context) return fallbackLineHeightPx;

    var measured = fallbackLineHeightPx;
    try {
      context.font = fontSpec;
      var metrics = context.measureText(text || 'Hg');
      var ascent = Number(metrics.actualBoundingBoxAscent) || 0;
      var descent = Number(metrics.actualBoundingBoxDescent) || 0;
      var glyphHeight = ascent + descent;
      if (glyphHeight > 0) {
        measured = Math.max(fallbackLineHeightPx, Math.ceil(glyphHeight + MONET_GLYPH_VERTICAL_SAFETY_PX));
      }
    } catch (_) {
      measured = fallbackLineHeightPx;
    }
    return foliaRememberBounded(monetMetricsCache, key, measured, MONET_METRICS_CACHE_LIMIT);
  }

  function monetMeasureTokenWidth(text, fontSpec) {
    var context = monetMeasureContext();
    var s = String(text == null ? ' ' : text) || ' ';
    if (!context) return s.length * 12;
    try {
      context.font = fontSpec;
      return context.measureText(s).width;
    } catch (_) {
      return s.length * 12;
    }
  }

  /* pretext 未就绪时的兜底：按「timed 词是原子盒、静态串按空格/CJK 切开」贪心断行。
   * 与 rich-inline 的 break:'never' 语义同构，只是没有 pretext 的精确 shaping。 */
  function monetMeasureChunksOfToken(token) {
    if (token.timed) return [token.text];
    var parts = String(token.text || '').match(/\s+|[^\s]+/g);
    return parts || [];
  }

  function monetMeasureLineStatsFallback(tokens, fontSpec, maxWidthPx) {
    var maxW = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);
    var lineCount = 1;
    var current = 0;
    var maxLineWidth = 0;

    for (var i = 0; i < tokens.length; i++) {
      var chunks = monetMeasureChunksOfToken(tokens[i]);
      for (var c = 0; c < chunks.length; c++) {
        var width = monetMeasureTokenWidth(chunks[c], fontSpec);
        if (current > 0 && current + width > maxW) {
          if (current > maxLineWidth) maxLineWidth = current;
          lineCount += 1;
          current = width;
        } else {
          current += width;
        }
      }
    }
    if (current > maxLineWidth) maxLineWidth = current;
    return { lineCount: Math.max(lineCount, 1), maxLineWidthPx: maxLineWidth };
  }

  /* Folia measureLyricLineStats：用 rich-inline 按 token 原子盒量行数与最宽行。
   * 普通 layoutWithLines 会按整串断行，CJK 与 DOM 对不上 → 预留高度错、译文压到下一行。 */
  function monetMeasureLineStats(line, fontSpec, maxWidthPx, rich) {
    var tokens = monetBuildDisplayTokens(line);
    if (tokens.length === 0) return { lineCount: 1, maxLineWidthPx: 0 };
    var maxW = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);

    if (rich && typeof rich.prepareRichInline === 'function' && typeof rich.measureRichInlineStats === 'function') {
      try {
        var items = [];
        for (var i = 0; i < tokens.length; i++) {
          items.push({
            text: tokens[i].text,
            font: fontSpec,
            break: tokens[i].timed ? 'never' : 'normal'
          });
        }
        var stats = rich.measureRichInlineStats(rich.prepareRichInline(items), maxW);
        return {
          lineCount: Math.max(Number(stats.lineCount) || 1, 1),
          maxLineWidthPx: Number(stats.maxLineWidth) || 0
        };
      } catch (_) { /* 落到兜底 */ }
    }
    return monetMeasureLineStatsFallback(tokens, fontSpec, maxW);
  }

  function monetWrapCountFallback(text, fontSpec, maxWidthPx) {
    var maxW = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);
    var s = String(text || ' ') || ' ';
    var parts = s.match(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]+|\s+/g) || [s];
    var lines = 1;
    var current = 0;
    for (var i = 0; i < parts.length; i++) {
      var width = monetMeasureTokenWidth(parts[i], fontSpec);
      if (current > 0 && current + width > maxW) { lines += 1; current = width; }
      else current += width;
    }
    return Math.max(lines, 1);
  }

  function monetMeasureTextLineCount(text, fontSpec, maxWidthPx, lineHeightPx, pretext) {
    var maxW = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      try {
        var prepared = pretext.prepareWithSegments(text || ' ', fontSpec, { whiteSpace: 'pre-wrap' });
        var layout = pretext.layoutWithLines(prepared, maxW, lineHeightPx);
        return Math.max(layout.lines.length, 1);
      } catch (_) { /* 落到兜底 */ }
    }
    return monetWrapCountFallback(text, fontSpec, maxW);
  }

  /* 累计字素偏移：扫字前缘按字素推进，而不是整词跳。 */
  function monetMeasureGraphemeOffsets(text, fontPx, fontSpec) {
    var key = fontPx + '|' + fontSpec + '|' + text;
    var cached = monetGraphemeCache.get(key);
    if (cached) return cached;

    var offsets = foliaMeasurePrefixOffsets(monetSplitGraphemes(text), function (prefix) {
      return monetMeasureTokenWidth(prefix, fontSpec);
    });
    return foliaRememberBounded(monetGraphemeCache, key, offsets, MONET_GRAPHEME_CACHE_LIMIT);
  }

  /* Folia resolveMonetSweepEdgeSoftness / resolveMonetSweepEnd：短 CJK 词也能连续交接。 */
  function monetSweepEdgeSoftness(fontPx) {
    return Math.max(Math.min(fontPx * 0.45, 16), 6);
  }

  function monetSweepEnd(filledWidthPx, fullWidthPx, edgeSoftnessPx) {
    if (fullWidthPx <= 0) return 0;
    var progress = Math.min(1, Math.max(0, filledWidthPx / fullWidthPx));
    return filledWidthPx + edgeSoftnessPx * progress;
  }

  /* 5 停 90deg 渐变：实心段到 sweepEnd-soft，羽化到 sweepEnd。 */
  function monetSweepMaskImage(fillWidthPx, fullWidthPx, edgeSoftnessPx) {
    var sweepEnd = monetSweepEnd(fillWidthPx, fullWidthPx, edgeSoftnessPx);
    var solidEnd = Math.max(sweepEnd - edgeSoftnessPx, 0);
    var featherStart = Math.max(sweepEnd - edgeSoftnessPx * 0.55, 0);
    var featherEnd = Math.max(sweepEnd, 0);
    return 'linear-gradient(90deg, rgba(0, 0, 0, 1) 0px, rgba(0, 0, 0, 1) ' + solidEnd.toFixed(2)
      + 'px, rgba(0, 0, 0, 0.92) ' + featherStart.toFixed(2)
      + 'px, rgba(0, 0, 0, 0) ' + featherEnd.toFixed(2)
      + 'px, rgba(0, 0, 0, 0) 100%)';
  }

  /* 译文轨（本项目一个 line 只有 translation 一条，无 romanization/alternateTexts）。 */
  function monetSubtitleTracks(line, mode) {
    if (!line || mode === 'none') return [];
    var text = String(line.translation == null ? '' : line.translation).trim();
    if (!text || !foliaHasReadableText(text)) return [];
    return [{ role: 'translation', text: text }];
  }

  function monetMeasureSubtitleTrack(track, isSecondary, inputs) {
    var fontPx = isSecondary ? inputs.translationFontPx * SECONDARY_TRACK_SIZE_FACTOR : inputs.translationFontPx;
    var fontWeight = isSecondary ? inputs.secondaryTranslationFontWeight : inputs.translationFontWeight;
    var fontSpec = fontWeight + ' ' + fontPx + 'px ' + inputs.translationFontStack;
    var lineHeightPx = monetMeasureLineHeight(track.text, fontSpec, fontPx, fontPx * 1.28);
    var paddingTopPx = isSecondary ? fontPx * SECONDARY_TRACK_GAP_EM : Math.max(fontPx * 0.45, 7);
    var paddingBottomPx = Math.max(fontPx * 0.18, 5);
    var rawLineCount = monetMeasureTextLineCount(track.text, fontSpec, inputs.maxWidthPx, lineHeightPx, inputs.pretext);
    var lineCount = Math.min(rawLineCount, MONET_TRANSLATION_LINE_LIMIT);
    var contentHeightPx = lineCount * lineHeightPx;

    return {
      role: track.role,
      text: track.text,
      fontPx: fontPx,
      fontWeight: fontWeight,
      lineCount: lineCount,
      lineHeightPx: lineHeightPx,
      contentHeightPx: contentHeightPx,
      paddingTopPx: paddingTopPx,
      paddingBottomPx: paddingBottomPx,
      heightPx: contentHeightPx + paddingTopPx + paddingBottomPx,
      isClipped: rawLineCount > lineCount
    };
  }

  /* Folia buildMonetLayoutCacheKey：几何 + 字幕模式 + 已解析的轨文本，切模式不复用错盒子。 */
  function monetBuildLayoutCacheKey(entry, inputs) {
    var line = entry.line;
    return [
      entry.index,
      line.startTime,
      line.endTime,
      line.fullText,
      inputs.subtitleContentMode,
      entry.status === 'active'
        ? monetSubtitleTracks(line, inputs.subtitleContentMode).map(function (t) { return t.role + ':' + t.text; }).join('\u0002')
        : '',
      entry.status,
      inputs.fontPx,
      inputs.translationFontPx,
      inputs.fontStack,
      inputs.translationFontStack,
      inputs.fontWeight,
      inputs.translationFontWeight,
      inputs.secondaryTranslationFontWeight,
      inputs.maxWidthPx
    ].join('\u0001');
  }

  function monetMeasureLineLayout(options) {
    var line = options.line;
    var status = options.status;
    var fontPx = options.fontPx;
    var translationFontPx = options.translationFontPx;
    var fontStack = options.fontStack;
    var translationFontStack = options.translationFontStack || options.fontStack;
    var fontWeight = options.fontWeight == null ? 600 : options.fontWeight;
    var translationFontWeight = options.translationFontWeight == null ? 500 : options.translationFontWeight;
    var secondaryTranslationFontWeight = options.secondaryTranslationFontWeight == null
      ? SECONDARY_TRACK_FONT_WEIGHT_FALLBACK
      : options.secondaryTranslationFontWeight;
    var maxWidthPx = options.maxWidthPx;

    var fontSpec = fontWeight + ' ' + fontPx + 'px ' + fontStack;
    var lineHeightPx = monetMeasureLineHeight(line.fullText, fontSpec, fontPx, fontPx * 1.18);
    var textPaddingTopPx = Math.max(fontPx * 0.16, 8);
    var textPaddingBottomPx = Math.max(fontPx * 0.34, 14);
    var stats = monetMeasureLineStats(line, fontSpec, maxWidthPx, options.rich);
    var textLineCount = stats.lineCount;
    var textLimit = status === 'active' ? MONET_ACTIVE_TEXT_LINE_LIMIT : MONET_INACTIVE_TEXT_LINE_LIMIT;
    var visibleTextLineCount = Math.min(textLineCount, textLimit);
    var textContentHeightPx = visibleTextLineCount * lineHeightPx;
    var textHeightPx = textContentHeightPx + textPaddingTopPx + textPaddingBottomPx;

    var trackInputs = {
      translationFontPx: translationFontPx,
      translationFontStack: translationFontStack,
      translationFontWeight: translationFontWeight,
      secondaryTranslationFontWeight: secondaryTranslationFontWeight,
      maxWidthPx: maxWidthPx,
      pretext: options.pretext
    };
    var subtitleTracks = [];
    if (status === 'active') {
      var rawTracks = monetSubtitleTracks(line, options.subtitleContentMode || 'translation');
      for (var t = 0; t < rawTracks.length; t++) {
        subtitleTracks.push(monetMeasureSubtitleTrack(rawTracks[t], t > 0, trackInputs));
      }
    }

    var firstTrack = subtitleTracks[0] || null;
    var lastTrack = subtitleTracks.length ? subtitleTracks[subtitleTracks.length - 1] : null;
    var translationHeightPx = 0;
    var translationContentHeightPx = 0;
    var translationLineCount = 0;
    var isTranslationClipped = false;
    for (var k = 0; k < subtitleTracks.length; k++) {
      translationHeightPx += subtitleTracks[k].heightPx;
      translationContentHeightPx += subtitleTracks[k].contentHeightPx;
      translationLineCount += subtitleTracks[k].lineCount;
      if (subtitleTracks[k].isClipped) isTranslationClipped = true;
    }

    return {
      textLineCount: textLineCount,
      visibleTextLineCount: visibleTextLineCount,
      textHeightPx: textHeightPx,
      textContentHeightPx: textContentHeightPx,
      textPaddingTopPx: textPaddingTopPx,
      textPaddingBottomPx: textPaddingBottomPx,
      subtitleTracks: subtitleTracks,
      translationLineCount: translationLineCount,
      translationHeightPx: translationHeightPx,
      translationContentHeightPx: translationContentHeightPx,
      translationPaddingTopPx: firstTrack ? firstTrack.paddingTopPx : Math.max(translationFontPx * 0.45, 7),
      translationPaddingBottomPx: lastTrack ? lastTrack.paddingBottomPx : Math.max(translationFontPx * 0.18, 5),
      visualHeightPx: textHeightPx + translationHeightPx,
      lineHeightPx: lineHeightPx,
      translationLineHeightPx: firstTrack
        ? firstTrack.lineHeightPx
        : monetMeasureLineHeight('', translationFontWeight + ' ' + translationFontPx + 'px ' + translationFontStack,
          translationFontPx, translationFontPx * 1.28),
      isTextClipped: textLineCount > visibleTextLineCount,
      isTextOverflowingWidth: stats.maxLineWidthPx > maxWidthPx,
      isTranslationClipped: isTranslationClipped
    };
  }

  /* ---------- 7. 行状态与窗口 ---------- */
  function monetLineStatus(line, index, activeIndex, currentTime) {
    if (index === activeIndex
      || (activeIndex < 0 && currentTime >= line.startTime && currentTime <= line.endTime)) {
      return 'active';
    }
    if (currentTime > line.endTime || (activeIndex >= 0 && index < activeIndex)) return 'passed';
    return 'waiting';
  }

  function monetWordStatus(currentTime, startTime, endTime) {
    if (currentTime < startTime) return 'waiting';
    if (currentTime <= endTime) return 'active';
    return 'passed';
  }

  function monetBuildVisibleLineEntries(lines, activeIndex, currentTime, before, after) {
    if (!lines || lines.length === 0) return [];
    var anchorIndex = activeIndex;
    if (anchorIndex < 0) {
      /* Folia 在无当前行时取 upcoming（第一条 startTime > currentTime）作锚点。 */
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].startTime > currentTime) { anchorIndex = i; break; }
      }
      if (anchorIndex < 0) anchorIndex = lines.length - 1;
    }

    var startIndex = Math.max(0, anchorIndex - before);
    var endIndex = Math.min(lines.length - 1, anchorIndex + after);
    var entries = [];
    for (var index = startIndex; index <= endIndex; index++) {
      var line = lines[index];
      entries.push({
        key: index + '-' + line.startTime + '-' + line.fullText,
        line: line,
        index: index,
        offset: index - anchorIndex,
        status: monetLineStatus(line, index, activeIndex, currentTime)
      });
    }
    return entries;
  }

  /* 手动滚动时的窗口：锚点 ±4 行，状态按「当前行」重算（不看时间）。 */
  function monetBuildScrollableRailEntries(lines, anchorIndex, activeLineIndex) {
    if (!lines || lines.length === 0) return [];
    var safeAnchor = Math.round(monetClamp(anchorIndex, 0, lines.length - 1));
    var startIndex = Math.max(0, safeAnchor - MONET_SCROLL_BEFORE);
    var endIndex = Math.min(lines.length - 1, safeAnchor + MONET_SCROLL_AFTER);
    var entries = [];
    for (var index = startIndex; index <= endIndex; index++) {
      var line = lines[index];
      entries.push({
        key: index + '-' + line.startTime + '-' + line.fullText,
        line: line,
        index: index,
        offset: index - safeAnchor,
        status: index === activeLineIndex ? 'active' : (activeLineIndex >= 0 && index < activeLineIndex ? 'passed' : 'waiting')
      });
    }
    return entries;
  }

  /* ---------- 8. 行色调与栏排布 ---------- */
  function monetLineTone(entry, theme, inactiveScale) {
    if (entry.status === 'active') {
      return {
        opacity: 1,
        scale: 1,
        blurPx: 0,
        baseColor: foliaColorWithAlpha(theme.primaryColor, 0.34),
        fontWeight: 600,
        zIndex: 4
      };
    }

    var distance = Math.max(Math.abs(entry.offset), 1);
    var isWaiting = entry.status === 'waiting';
    return {
      opacity: isWaiting
        ? monetClamp(0.72 - (distance - 1) * 0.18, 0.36, 0.72)
        : monetClamp(0.52 - (distance - 1) * 0.12, 0.28, 0.52),
      scale: monetClamp(inactiveScale * Math.pow(0.9, distance - 1), 0.68, 0.92),
      blurPx: isWaiting
        ? (distance === 1 ? 0.7 : 1.8 + (distance - 2) * 0.8)
        : 1.1 + (distance - 1) * 0.7,
      baseColor: foliaColorWithAlpha(theme.primaryColor, isWaiting ? 0.46 : 0.36),
      fontWeight: 500,
      zIndex: isWaiting ? 3 - distance : 2 - distance
    };
  }

  function monetLineGap(previous, next, lyricFontPx) {
    return (previous.status === 'active' || next.status === 'active')
      ? Math.max(MONET_ACTIVE_GAP_PX, lyricFontPx * MONET_ACTIVE_GAP_RATIO)
      : Math.max(MONET_INACTIVE_GAP_PX, lyricFontPx * MONET_INACTIVE_GAP_RATIO);
  }

  function monetGetOrMeasureLineLayout(cache, entry, inputs) {
    var key = monetBuildLayoutCacheKey(entry, inputs);
    var cached = cache.get(key);
    if (cached) return cached;
    var layout = monetMeasureLineLayout({
      line: entry.line,
      status: entry.status,
      fontPx: inputs.fontPx,
      translationFontPx: inputs.translationFontPx,
      fontStack: inputs.fontStack,
      translationFontStack: inputs.translationFontStack,
      fontWeight: inputs.fontWeight,
      translationFontWeight: inputs.translationFontWeight,
      secondaryTranslationFontWeight: inputs.secondaryTranslationFontWeight,
      maxWidthPx: inputs.maxWidthPx,
      subtitleContentMode: inputs.subtitleContentMode,
      rich: inputs.rich,
      pretext: inputs.pretext
    });
    return foliaRememberBounded(cache, key, layout, MONET_LAYOUT_CACHE_LIMIT);
  }

  function monetBuildPositionedEntries(entries, railSize, theme, metrics, layoutInputs, glowBufferPx, layoutCache) {
    var railWidth = railSize.width || 680;
    var railHeight = railSize.height || 340;
    var lyricFontPx = metrics.lyricFontPx;
    var inactiveScale = monetClamp(metrics.inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92);
    var contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 0);
    var measureInputs = {
      translationFontPx: layoutInputs.translationFontPx,
      fontStack: layoutInputs.fontStack,
      translationFontStack: layoutInputs.translationFontStack,
      fontWeight: layoutInputs.fontWeight,
      translationFontWeight: layoutInputs.translationFontWeight,
      secondaryTranslationFontWeight: layoutInputs.secondaryTranslationFontWeight,
      subtitleContentMode: layoutInputs.subtitleContentMode,
      rich: layoutInputs.rich,
      pretext: layoutInputs.pretext,
      fontPx: lyricFontPx,
      maxWidthPx: contentWidthPx - 8
    };

    var measured = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var tone = monetLineTone(entry, theme, inactiveScale);
      /* Folia 这里用 theme 权重覆盖 resolveLineTone 的 600/500：全栏同权重。 */
      tone.fontWeight = layoutInputs.fontWeight;
      var layout = monetGetOrMeasureLineLayout(layoutCache, entry, measureInputs);
      measured.push({
        key: entry.key,
        line: entry.line,
        index: entry.index,
        offset: entry.offset,
        status: entry.status,
        y: 0,
        tone: tone,
        layout: layout,
        scaledHeight: layout.visualHeightPx * tone.scale
      });
    }

    if (measured.length === 0) return [];

    var anchorIndex = 0;
    for (var a = 0; a < measured.length; a++) {
      if (measured[a].offset === 0) { anchorIndex = a; break; }
    }
    var focusCenterY = railHeight * 0.46;
    measured[anchorIndex].y = focusCenterY - measured[anchorIndex].scaledHeight / 2;

    for (var down = anchorIndex + 1; down < measured.length; down++) {
      var prev = measured[down - 1];
      var cur = measured[down];
      cur.y = prev.y + prev.scaledHeight + monetLineGap(prev, cur, lyricFontPx);
    }
    for (var up = anchorIndex - 1; up >= 0; up--) {
      var node = measured[up];
      var nextNode = measured[up + 1];
      node.y = nextNode.y - node.scaledHeight - monetLineGap(node, nextNode, lyricFontPx);
    }
    return measured;
  }

  /* ---------- 9. 扫字与辉光包络 ---------- */
  function monetClampProgress(value) {
    return Math.min(1, Math.max(0, value));
  }

  /* Folia monetLyricMotion.resolveMonetGlow：rise=词长×1.18 到峰，随后驻留到
   * max(lineEnd, end+1.05) 再 smoothstep 衰减。 */
  function monetGlow(time, start, end, lineEnd) {
    if (time <= start) return 0;
    var rise = Math.max(0.001, end - start) * 1.18;
    var peak = start + rise;
    var tail = Math.max(lineEnd, end + 1.05);
    if (time <= peak) {
      return monetSmoothstep((time - start) / rise);
    }
    return monetSmoothstep(1 - monetClampProgress((time - peak) / Math.max(0.18, tail - peak)));
  }

  function monetFillWidth(time, start, end, offsets, timings) {
    var width = offsets.length ? offsets[offsets.length - 1] : 0;
    if (time <= start) return 0;
    if (time >= end) return width;
    var count = Math.min(timings.length, offsets.length - 1);
    if (count > 0) {
      for (var i = 0; i < count; i++) {
        var timing = timings[i];
        var timingStart = Math.max(start, timing.startTime);
        var timingEnd = Math.max(timingStart, timing.endTime);
        if (time < timingStart) return offsets[i];
        if (time <= timingEnd) {
          var progress = (time - timingStart) / Math.max(0.001, timingEnd - timingStart);
          return offsets[i] + (offsets[i + 1] - offsets[i]) * progress;
        }
      }
      return offsets[count] == null ? width : offsets[count];
    }
    var index = monetClampProgress((time - start) / Math.max(0.001, end - start)) * (offsets.length - 1);
    var whole = Math.floor(index);
    var a = offsets[whole] == null ? width : offsets[whole];
    var b = offsets[whole + 1] == null ? width : offsets[whole + 1];
    return a + (b - a) * (index - whole);
  }

  /* ---------- 10. 封面 wash 背景（Folia monetBackgroundPipeline） ---------- */
  function monetCoverWashSrc(url) {
    if (!url) return '';
    /* 同源代理读出来的画布才是干净的：直接打 CDN 会污染 canvas，getImageData/toDataURL 会抛。 */
    try {
      if (typeof coverProxySrc === 'function') {
        var proxied = coverProxySrc(url);
        if (proxied) return proxied;
      }
    } catch (_) {}
    return url;
  }

  function monetCheckCanvasFilterSupport() {
    if (monetBgFilterSupported !== null) return monetBgFilterSupported;
    monetBgFilterSupported = false;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      var context = canvas.getContext('2d');
      if (context && typeof context.filter === 'string') {
        context.fillStyle = '#000000';
        context.fillRect(0, 0, 2, 2);
        context.filter = 'blur(1px)';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 1, 1);
        monetBgFilterSupported = context.getImageData(1, 1, 1, 1).data[0] > 0;
      }
    } catch (_) {
      monetBgFilterSupported = false;
    }
    return monetBgFilterSupported;
  }

  function monetLoadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.decoding = 'async';
      var sameOrigin = false;
      try {
        sameOrigin = String(src).indexOf(location.origin) === 0;
      } catch (_) {}
      if (!sameOrigin && /^https?:\/\//i.test(String(src))) image.crossOrigin = 'anonymous';
      var settled = false;
      image.onload = function () { if (!settled) { settled = true; resolve(image); } };
      image.onerror = function () { if (!settled) { settled = true; reject(new Error('cover load failed')); } };
      image.src = src;
      if (typeof image.decode === 'function') {
        image.decode().then(function () {
          if (!settled) { settled = true; resolve(image); }
        }, function () { /* onload/onerror 收口 */ });
      }
    });
  }

  function monetDrawCoverCropped(context, image, width, height) {
    var imageWidth = Number(image.width) || width;
    var imageHeight = Number(image.height) || height;
    if (!imageWidth || !imageHeight) return;
    var scale = Math.max(width / imageWidth, height / imageHeight);
    var drawWidth = imageWidth * scale;
    var drawHeight = imageHeight * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function monetResolveWashEndpoints(background, primary) {
    var backgroundLuminance = monetLuminance(background.r, background.g, background.b);
    var primaryLuminance = monetLuminance(primary.r, primary.g, primary.b);
    return backgroundLuminance <= primaryLuminance
      ? { shadow: background, highlight: primary }
      : { shadow: primary, highlight: background };
  }

  function monetResolveWashColor(normalizedLuminance, background, accent, primary) {
    var ends = monetResolveWashEndpoints(background, primary);
    if (normalizedLuminance <= 0.55) {
      var amountLow = normalizedLuminance / 0.55;
      return {
        r: monetMix(ends.shadow.r, accent.r, amountLow),
        g: monetMix(ends.shadow.g, accent.g, amountLow),
        b: monetMix(ends.shadow.b, accent.b, amountLow)
      };
    }
    var amountHigh = (normalizedLuminance - 0.55) / 0.45;
    return {
      r: monetMix(accent.r, ends.highlight.r, amountHigh),
      g: monetMix(accent.g, ends.highlight.g, amountHigh),
      b: monetMix(accent.b, ends.highlight.b, amountHigh)
    };
  }

  function monetThemeChannels(color, fallback) {
    var parsed = foliaParseColorChannels(color);
    if (!parsed) return fallback;
    return {
      r: monetClamp(parsed.r, 0, 255),
      g: monetClamp(parsed.g, 0, 255),
      b: monetClamp(parsed.b, 0, 255)
    };
  }

  function monetApplyBackgroundPostProcessing(context, width, height, theme, tuning) {
    var grayscale = monetClamp(tuning.backgroundGrayscale, 0, 1);
    var saturation = monetClamp(tuning.backgroundSaturation, 0, 2);
    var wash = monetClamp(tuning.backgroundWash, 0, 1);
    if (grayscale <= 0 && Math.abs(saturation - 1) < 0.001 && wash <= 0) return;

    var imageData = context.getImageData(0, 0, width, height);
    var data = imageData.data;
    var FALLBACK_DARK = { r: 10, g: 10, b: 12 };
    var background = monetThemeChannels(theme.backgroundColor, FALLBACK_DARK);
    var accent = monetThemeChannels(theme.accentColor, background);
    var primary = monetThemeChannels(theme.primaryColor, { r: 245, g: 245, b: 245 });

    for (var index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue;
      var r = data[index];
      var g = data[index + 1];
      var b = data[index + 2];
      var luminance = monetLuminance(r, g, b);

      if (grayscale > 0) {
        r = monetMix(r, luminance, grayscale);
        g = monetMix(g, luminance, grayscale);
        b = monetMix(b, luminance, grayscale);
      }
      if (Math.abs(saturation - 1) >= 0.001) {
        var satLuminance = monetLuminance(r, g, b);
        r = satLuminance + (r - satLuminance) * saturation;
        g = satLuminance + (g - satLuminance) * saturation;
        b = satLuminance + (b - satLuminance) * saturation;
      }
      if (wash > 0) {
        var washColor = monetResolveWashColor(monetClamp(luminance / 255, 0, 1), background, accent, primary);
        r = monetMix(r, washColor.r, wash);
        g = monetMix(g, washColor.g, wash);
        b = monetMix(b, washColor.b, wash);
      }

      data[index] = Math.round(monetClamp(r, 0, 255));
      data[index + 1] = Math.round(monetClamp(g, 0, 255));
      data[index + 2] = Math.round(monetClamp(b, 0, 255));
    }
    context.putImageData(imageData, 0, 0);
  }

  function monetPaintBackgroundOverlay(context, width, height, theme, tuning) {
    var overlay = monetClamp(tuning.backgroundOverlayOpacity, 0, 1);

    var overlayGradient = context.createLinearGradient(0, 0, width, height);
    overlayGradient.addColorStop(0, foliaColorWithAlpha(theme.accentColor, 0.08 + overlay * 0.62));
    overlayGradient.addColorStop(0.44, foliaColorWithAlpha(theme.backgroundColor, 0.16 + overlay * 0.58));
    overlayGradient.addColorStop(1, foliaColorWithAlpha(theme.primaryColor, 0.06 + overlay * 0.36));
    context.fillStyle = overlayGradient;
    context.fillRect(0, 0, width, height);

    var leftBloom = context.createRadialGradient(
      width * 0.18, height * 0.34, 0, width * 0.18, height * 0.34, width * 0.55
    );
    leftBloom.addColorStop(0, foliaColorWithAlpha(theme.accentColor, overlay * 0.42));
    leftBloom.addColorStop(1, foliaColorWithAlpha(theme.backgroundColor, 0));
    context.fillStyle = leftBloom;
    context.fillRect(0, 0, width, height);

    var rightVeil = context.createLinearGradient(width * 0.45, 0, width, 0);
    rightVeil.addColorStop(0, foliaColorWithAlpha(theme.backgroundColor, 0));
    rightVeil.addColorStop(1, foliaColorWithAlpha(theme.backgroundColor, 0.18 + overlay * 0.38));
    context.fillStyle = rightVeil;
    context.fillRect(0, 0, width, height);

    if (tuning.backgroundStreaksEnabled === false) return;

    context.fillStyle = foliaColorWithAlpha(theme.backgroundColor, 0.1 + overlay * 0.08);
    for (var index = 0; index < 18; index++) {
      var x = (index * 127) % width;
      var y = ((index * 211) % height) - 40;
      context.fillRect(x, y, 1, height * 0.28);
    }
  }

  function monetBackgroundCacheKey(src, theme) {
    return [
      src,
      theme.backgroundColor,
      theme.primaryColor,
      theme.accentColor,
      MONET_BG_TUNING.backgroundBlurPx,
      MONET_BG_TUNING.backgroundOverlayOpacity,
      MONET_BG_TUNING.backgroundGrayscale,
      MONET_BG_TUNING.backgroundSaturation,
      MONET_BG_TUNING.backgroundWash,
      MONET_BG_TUNING.backgroundStreaksEnabled
    ].join('|');
  }

  function monetBuildBackgroundDataUrl(src, theme) {
    return monetLoadImage(src).then(function (image) {
      var canvas = document.createElement('canvas');
      canvas.width = MONET_BG_WIDTH;
      canvas.height = MONET_BG_HEIGHT;
      var context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.fillStyle = theme.backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      if (monetCheckCanvasFilterSupport()) {
        context.filter = 'blur(' + monetClamp(MONET_BG_TUNING.backgroundBlurPx, 0, 60) + 'px)';
      }
      monetDrawCoverCropped(context, image, canvas.width, canvas.height);
      context.restore();
      /* 画布被跨域污染时 getImageData / toDataURL 会抛 —— 上层据此退回 CSS 图层。 */
      monetApplyBackgroundPostProcessing(context, canvas.width, canvas.height, theme, MONET_BG_TUNING);
      monetPaintBackgroundOverlay(context, canvas.width, canvas.height, theme, MONET_BG_TUNING);
      return canvas.toDataURL('image/jpeg', 0.92);
    });
  }

  function monetResolveBackgroundDataUrl(src, theme) {
    if (!src) return Promise.resolve(null);
    var key = monetBackgroundCacheKey(src, theme);
    var cached = monetBackgroundCache.get(key);
    if (cached) return cached;
    var next = monetBuildBackgroundDataUrl(src, theme).catch(function (err) {
      console.warn('[FoliaMonet] 背景 wash 读取失败，退回 CSS 图层：', err && err.message);
      return null;
    });
    if (monetBackgroundCache.size > 8) monetBackgroundCache.clear();
    monetBackgroundCache.set(key, next);
    return next;
  }

  /* ---------- 11. 漂浮装饰（MonetFloatingDecor） ---------- */
  function monetBuildParticles(iconCount) {
    var out = [];
    for (var i = 0; i < MONET_DECOR_COUNT; i++) {
      out.push({
        id: i,
        x: ((i * 127 + 43) % 80) + 10,
        y: ((i * 211 + 17) % 80) + 5,
        size: 46 + ((i * 53) % 40),
        rotation: (i * 97) % 360,
        duration: 20 + ((i * 71) % 20),
        delay: ((i * 41) % 80) / 10,
        opacity: 0.06 + ((i * 31) % 12) / 100,
        useIcon: iconCount > 0 && ((i * 37 + 11) % 100) > 20,
        reverse: i % 2 === 0
      });
    }
    return out;
  }

  function monetBuildDecor(inst, theme) {
    var host = inst.decorEl;
    while (host.firstChild) host.removeChild(host.firstChild);
    var particles = monetBuildParticles(0);
    var petalColor = foliaColorWithAlpha(theme.secondaryColor, 0.55);

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var node = document.createElement('div');
      node.className = 'folia-monet-decor-item';
      node.style.left = p.x + '%';
      node.style.top = p.y + '%';
      node.style.width = p.size + 'px';
      node.style.height = p.size + 'px';
      node.style.setProperty('--monet-rot', String(p.rotation));
      node.style.setProperty('--monet-op', String(p.opacity));
      node.style.animationName = p.reverse ? 'folia-monet-float-a' : 'folia-monet-float-b';
      node.style.animationDuration = p.duration + 's';
      node.style.animationDelay = p.delay + 's';
      node.style.animationIterationCount = 'infinite';
      node.style.animationTimingFunction = 'easeInOut';

      /* Folia 无 theme.lyricsIcons 时回落樱花花瓣 SVG。 */
      var svgNs = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNs, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('width', String(p.size));
      svg.setAttribute('height', String(p.size));
      var petal = document.createElementNS(svgNs, 'path');
      petal.setAttribute('d', 'M12 3C14.5 5.5 16.8 9 16 14C15.2 19 13.5 21 12 21C10.5 21 8.8 19 8 14C7.2 9 9.5 5.5 12 3Z');
      petal.setAttribute('fill', petalColor);
      var vein = document.createElementNS(svgNs, 'path');
      vein.setAttribute('d', 'M12 6C12 6 11.3 10.5 11.3 14.5C11.3 17.5 12 20 12 20');
      vein.setAttribute('stroke', foliaColorWithAlpha(petalColor, 0.35));
      vein.setAttribute('stroke-width', '0.45');
      vein.setAttribute('stroke-linecap', 'round');
      svg.appendChild(petal);
      svg.appendChild(vein);
      node.appendChild(svg);
      host.appendChild(node);
    }
    inst.decorCount = particles.length;
  }

  /* ---------- 12. 音频条（AudioOverlay） ---------- */
  function monetSpectrumAnchors(bands) {
    var bass = bands[0], lowMid = bands[1], mid = bands[2], vocal = bands[3], treble = bands[4];
    return [
      bass * 1.08,
      bass * 0.96,
      bass * 0.74 + lowMid * 0.26,
      lowMid,
      lowMid * 0.58 + mid * 0.42,
      mid,
      mid * 0.42 + vocal * 0.58,
      vocal,
      vocal * 0.48 + treble * 0.52,
      treble,
      treble * 0.82
    ].map(function (value) { return Math.max(0, Math.min(1, value)); });
  }

  function monetSampleSpectrumProfile(bands, normalizedIndex) {
    var index = Math.max(0, Math.min(1, normalizedIndex));
    var anchors = monetSpectrumAnchors(bands);
    var logIndex = Math.log10(1 + index * 9);
    var scaled = logIndex * (anchors.length - 1);
    var lower = Math.floor(scaled);
    var upper = Math.min(lower + 1, anchors.length - 1);
    var lowerValue = anchors[lower] || 0;
    var upperValue = anchors[upper] == null ? lowerValue : anchors[upper];
    var interpolated = lowerValue + (upperValue - lowerValue) * (scaled - lower);
    var contour = 0.92
      + Math.sin(index * Math.PI * 3.4 - Math.PI * 0.3) * 0.08
      + Math.sin(index * Math.PI * 9.2 + Math.PI * 0.2) * 0.035;
    return Math.max(0, Math.min(1, interpolated * contour));
  }

  function monetSampleRawSpectrumProfile(rawSpectrum, normalizedIndex) {
    if (!rawSpectrum || rawSpectrum.length <= MONET_MIN_RAW_SPECTRUM_BIN) return 0;
    var index = Math.max(0, Math.min(1, normalizedIndex));
    var usableBinCount = Math.max(1, rawSpectrum.length - MONET_MIN_RAW_SPECTRUM_BIN);
    var mappedIndex = Math.expm1(index * Math.log(usableBinCount + 1));
    var centerIndex = MONET_MIN_RAW_SPECTRUM_BIN + mappedIndex;
    var edgeSoftness = 1 - Math.abs(index - 0.5) * 2;
    var windowRadius = Math.max(1, Math.round(5 - edgeSoftness * 3));
    var start = Math.max(MONET_MIN_RAW_SPECTRUM_BIN, Math.floor(centerIndex - windowRadius));
    var end = Math.min(rawSpectrum.length - 1, Math.ceil(centerIndex + windowRadius));

    var weightedSum = 0;
    var weightTotal = 0;
    for (var bin = start; bin <= end; bin++) {
      var distance = Math.abs(bin - centerIndex);
      var weight = Math.max(0.1, 1 - distance / (windowRadius + 1));
      weightedSum += rawSpectrum[bin] * weight;
      weightTotal += weight;
    }
    var averaged = weightTotal > 0 ? weightedSum / weightTotal : 0;
    var noiseFloor = 16 + (1 - index) * 12;
    var normalized = Math.max(0, Math.min(1, (averaged - noiseFloor) / (255 - noiseFloor)));
    var power = 1.8 + (1 - index) * 0.4;
    var processed = Math.pow(normalized, power);
    var lowFrequencyCompensation = 0.52 + index * 0.62;
    var presenceLift = 0.92 + Math.sqrt(index) * 0.94 * 0.149;
    return Math.max(0, Math.min(1, processed * lowFrequencyCompensation * presenceLift));
  }

  function monetDrawAudioFrame(inst, ctx) {
    var canvas = inst.audioCanvas;
    if (!canvas) return null;
    /* 画布尺寸只在几何变化后重量一次：每帧 getBoundingClientRect 会强制同步布局。 */
    var size = inst.audioSize;
    if (!size || !size.width || !size.height) {
      var rect = canvas.getBoundingClientRect();
      size = {
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height))
      };
      inst.audioSize = size;
    }
    var dpr = window.devicePixelRatio || 1;
    var width = size.width;
    var height = size.height;
    var pixelWidth = Math.max(1, Math.floor(width * dpr));
    var pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    var context = canvas.getContext('2d');
    if (!context) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    var theme = ctx.theme;
    var bandsState = ctx.audioBands || (ctx.audio && ctx.audio.bands) || {};
    var bands = [
      monetClamp(bandsState.bass, 0, 1),
      monetClamp(bandsState.lowMid, 0, 1),
      monetClamp(bandsState.mid, 0, 1),
      monetClamp(bandsState.vocal, 0, 1),
      monetClamp(bandsState.treble, 0, 1)
    ];
    var rawSpectrum = (ctx.audio && ctx.audio.spectrum) ? ctx.audio.spectrum : null;
    var hasRaw = !!(rawSpectrum && rawSpectrum.length > MONET_MIN_RAW_SPECTRUM_BIN);
    var energy = Math.min(1, Math.max(0.08, Number(ctx.audio && ctx.audio.power) || 0));
    var now = Number(ctx.now) || 0;

    var inkGradient = context.createLinearGradient(0, 0, width, 0);
    inkGradient.addColorStop(0, foliaColorWithAlpha(theme.primaryColor, 0.72));
    inkGradient.addColorStop(0.5, foliaColorWithAlpha(theme.primaryColor, 0.94));
    inkGradient.addColorStop(1, foliaColorWithAlpha(theme.primaryColor, 0.72));
    var areaGradient = context.createLinearGradient(0, 0, 0, height);
    areaGradient.addColorStop(0, foliaColorWithAlpha(theme.primaryColor, 0.24));
    areaGradient.addColorStop(1, foliaColorWithAlpha(theme.primaryColor, 0));

    context.lineCap = 'round';
    var mode = monetTuning().audioStyle;
    var i;

    if (mode === 'line') {
      var points = [];
      for (i = 0; i < MONET_AUDIO_BARS; i++) {
        var x = (i / (MONET_AUDIO_BARS - 1)) * width;
        var spectrumIndex = i / (MONET_AUDIO_BARS - 1);
        var band = hasRaw
          ? monetSampleRawSpectrumProfile(rawSpectrum, spectrumIndex)
          : monetSampleSpectrumProfile(bands, spectrumIndex);
        var wave = Math.sin(i * 0.24 + now * 0.004) * 0.08 + Math.sin(i * 0.68 + now * 0.0028) * 0.05;
        var envelope = Math.sin(spectrumIndex * Math.PI);
        var amplitude = energy * 0.04 + band * 0.8 + wave * 0.04;
        points.push({ x: x, y: height - Math.max(0, height * amplitude * envelope) });
      }
      var drawCurve = function (target) {
        if (points.length === 0) return;
        target.moveTo(points[0].x, points[0].y);
        for (var k = 0; k < points.length - 1; k++) {
          target.quadraticCurveTo(points[k].x, points[k].y, (points[k].x + points[k + 1].x) / 2, (points[k].y + points[k + 1].y) / 2);
        }
        target.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      };
      context.beginPath();
      drawCurve(context);
      context.lineTo(width, height);
      context.lineTo(0, height);
      context.closePath();
      context.fillStyle = areaGradient;
      context.fill();

      context.beginPath();
      drawCurve(context);
      context.strokeStyle = inkGradient;
      context.lineWidth = 2;
      context.stroke();
      return { mode: mode, bars: MONET_AUDIO_BARS, hasRaw: hasRaw, energy: energy };
    }

    var gap = width / MONET_AUDIO_BARS;
    for (i = 0; i < MONET_AUDIO_BARS; i++) {
      var barIndex = i / (MONET_AUDIO_BARS - 1);
      var barBand = hasRaw
        ? monetSampleRawSpectrumProfile(rawSpectrum, barIndex)
        : monetSampleSpectrumProfile(bands, barIndex);
      var pulse = Math.sin(i * 0.45 + now * 0.006) * 0.5 + 0.5;
      var barEnvelope = Math.sin(barIndex * Math.PI);
      var barHeight = height * (0.02 + (energy * 0.04 + barBand * 0.82 + pulse * 0.02) * barEnvelope);
      context.fillStyle = inkGradient;
      context.fillRect(i * gap + gap * 0.14, height - barHeight, Math.max(1.35, gap * 0.34), barHeight);
    }
    return { mode: mode, bars: MONET_AUDIO_BARS, hasRaw: hasRaw, energy: energy };
  }

  /* ---------- 13. DOM 构建 ---------- */
  function monetApplyMask(element, mask) {
    if (!mask) {
      element.style.webkitMaskImage = '';
      element.style.maskImage = '';
      element.style.webkitMaskComposite = '';
      element.style.maskComposite = '';
      return;
    }
    element.style.webkitMaskImage = mask.image;
    element.style.maskImage = mask.image;
    element.style.webkitMaskRepeat = 'no-repeat';
    element.style.maskRepeat = 'no-repeat';
    element.style.webkitMaskSize = '100% 100%';
    element.style.maskSize = '100% 100%';
    if (mask.composite) {
      element.style.webkitMaskComposite = 'source-in';
      element.style.maskComposite = 'intersect';
    } else {
      element.style.webkitMaskComposite = '';
      element.style.maskComposite = '';
    }
  }

  function monetTextMaskOf(layout, lyricFontPx, vGlowBufferPx) {
    var layers = [];
    if (layout.isTextClipped) {
      var contentBottom = vGlowBufferPx + layout.textPaddingTopPx + layout.textContentHeightPx;
      var fade = Math.max(lyricFontPx * 0.55, 12);
      var solidEnd = Math.max(contentBottom - fade, 0);
      layers.push('linear-gradient(180deg, black 0px, black ' + solidEnd.toFixed(2) + 'px, transparent ' + contentBottom.toFixed(2) + 'px)');
    }
    if (layout.isTextOverflowingWidth) {
      var edgeFade = Math.max(lyricFontPx * 0.9, 24);
      layers.push('linear-gradient(90deg, black 0%, black calc(100% - ' + edgeFade.toFixed(2) + 'px), transparent 100%)');
    }
    if (layers.length === 0) return null;
    return { image: layers.join(', '), composite: layers.length > 1 };
  }

  function monetTrackMaskOf(isClipped, fontPx) {
    if (!isClipped) return null;
    var fade = Math.max(fontPx * 0.65, 10);
    return {
      image: 'linear-gradient(180deg, black 0%, black calc(100% - ' + fade.toFixed(2) + 'px), transparent 100%)',
      composite: false
    };
  }

  function monetBuildDom(inst, ctx) {
    var theme = ctx.theme;
    var root = inst.root;

    /* 背景：封面 wash（mode 自带，见文件头差异 ⑥） */
    var bgTint = document.createElement('div');
    bgTint.className = 'folia-monet-bg-tint';
    bgTint.style.background = theme.backgroundColor;
    root.appendChild(bgTint);
    inst.bgTintEl = bgTint;

    var bg = document.createElement('div');
    bg.className = 'folia-monet-bg' + (MONET_BG_TUNING.backgroundDriftEnabled ? ' is-drifting' : '');
    root.appendChild(bg);
    inst.bgEl = bg;

    /* tier B 的叠色层：canvas 被跨域污染时用它顶替 getImageData + 烘焙叠色（近似，
     * 但观感一致）。tier A 成功时这层保持 opacity 0。 */
    var veil = document.createElement('div');
    veil.className = 'folia-monet-bg-veil';
    root.appendChild(veil);
    inst.bgVeilEl = veil;

    /* 漂浮装饰 */
    var decor = document.createElement('div');
    decor.className = 'folia-monet-decor';
    root.appendChild(decor);
    inst.decorEl = decor;
    monetBuildDecor(inst, theme);

    var shell = document.createElement('div');
    shell.className = 'folia-monet-shell';
    root.appendChild(shell);
    inst.shell = shell;

    var row = document.createElement('div');
    row.className = 'folia-monet-row';
    shell.appendChild(row);
    inst.row = row;

    /* ---- 左列：海报头部 + 歌词轨 + 描述胶囊 ---- */
    var textCol = document.createElement('div');
    textCol.className = 'folia-monet-text';
    row.appendChild(textCol);
    inst.textCol = textCol;

    var meta = document.createElement('div');
    meta.className = 'folia-monet-meta';
    textCol.appendChild(meta);
    inst.metaEl = meta;

    var artist = document.createElement('div');
    artist.className = 'folia-monet-artist';
    meta.appendChild(artist);
    inst.artistEl = artist;

    var bar = document.createElement('div');
    bar.className = 'folia-monet-bar';
    meta.appendChild(bar);
    inst.barEl = bar;

    var titleWrap = document.createElement('div');
    titleWrap.className = 'folia-monet-title-wrap';
    textCol.appendChild(titleWrap);
    inst.titleWrapEl = titleWrap;

    var title = document.createElement('div');
    title.className = 'folia-monet-title';
    titleWrap.appendChild(title);
    inst.titleEl = title;

    var album = document.createElement('div');
    album.className = 'folia-monet-album';
    titleWrap.appendChild(album);
    inst.albumEl = album;

    var railWrap = document.createElement('div');
    railWrap.className = 'folia-monet-rail-wrap';
    textCol.appendChild(railWrap);
    inst.railWrapEl = railWrap;

    var rail = document.createElement('div');
    rail.className = 'folia-monet-rail';
    railWrap.appendChild(rail);
    inst.railEl = rail;

    var desc = document.createElement('div');
    desc.className = 'folia-monet-desc-wrap';
    textCol.appendChild(desc);
    inst.descEl = desc;

    var capsule = document.createElement('div');
    capsule.className = 'folia-monet-capsule';
    desc.appendChild(capsule);
    inst.capsuleEl = capsule;

    var dot = document.createElement('span');
    dot.className = 'folia-monet-capsule-dot';
    dot.style.background = theme.accentColor;
    capsule.appendChild(dot);

    var capsuleLabel = document.createElement('span');
    capsuleLabel.className = 'folia-monet-capsule-label';
    capsuleLabel.textContent = monetCapsuleLabel(theme);
    capsule.appendChild(capsuleLabel);
    inst.capsuleLabelEl = capsuleLabel;

    /* ---- 右列：封面立牌 ---- */
    var portraitCol = document.createElement('div');
    portraitCol.className = 'folia-monet-portrait-col';
    row.appendChild(portraitCol);
    inst.portraitColEl = portraitCol;

    var portraitBox = document.createElement('div');
    portraitBox.className = 'folia-monet-portrait-box';
    portraitCol.appendChild(portraitBox);
    inst.portraitBoxEl = portraitBox;

    var portraitFloat = document.createElement('div');
    portraitFloat.className = 'folia-monet-portrait-float' + (
      theme.animationIntensity === 'chaotic' ? ' is-chaotic' : ''
    );
    portraitBox.appendChild(portraitFloat);
    inst.portraitFloatEl = portraitFloat;

    /* 挂环常驻：显隐由 monetApplyGeometry 每帧按调参写 display（Folia 是条件渲染，
     * 这里等价 —— 这样面板上切「显示 / 隐藏」不必重建整个 DOM）。 */
    var hanger = document.createElement('div');
    hanger.className = 'folia-monet-hanger';
    hanger.style.background = foliaColorWithAlpha(theme.backgroundColor, 0.86);
    portraitFloat.appendChild(hanger);
    inst.hangerEl = hanger;

    var frame = document.createElement('div');
    frame.className = monetTuning().portraitStyle === 'square'
      ? 'folia-monet-frame is-square'
      : 'folia-monet-frame is-portrait';
    portraitFloat.appendChild(frame);
    inst.frameEl = frame;

    var frameInner = document.createElement('div');
    frameInner.className = 'folia-monet-frame-inner';
    frame.appendChild(frameInner);
    inst.frameInnerEl = frameInner;

    var layers = document.createElement('div');
    layers.className = 'folia-monet-portrait-layers';
    frameInner.appendChild(layers);
    inst.portraitLayersEl = layers;

    /* ---- 底部音频条 ---- */
    var audioWrap = document.createElement('div');
    audioWrap.className = 'folia-monet-audio';
    root.appendChild(audioWrap);
    inst.audioWrapEl = audioWrap;

    var audioCanvas = document.createElement('canvas');
    audioCanvas.className = 'folia-monet-audio-canvas';
    audioWrap.appendChild(audioCanvas);
    inst.audioCanvas = audioCanvas;

    inst.layoutCache = new Map();
    inst.lineNodes = new Map();
    inst.portraitLayers = [];
    inst.portraitSrc = '';
    inst.decorCount = inst.decorCount || 0;
  }

  /* Folia 描述胶囊：theme.description → theme.name → 模式名。本项目只有模式名。 */
  function monetCapsuleLabel(theme) {
    var desc = theme && theme.description ? String(theme.description).trim() : '';
    if (desc) return desc;
    var name = theme && theme.name ? String(theme.name).trim() : '';
    return name || '莫奈';
  }

  /* ---- 栏尺寸与整幅几何（只在视口 / 字号变化时重算） ---- */
  function monetApplyGeometry(inst, ctx) {
    var theme = ctx.theme;
    var viewportWidth = inst.viewportWidth;
    var metrics = monetFontMetrics(viewportWidth, ctx.fontScale);
    /* 字体栈不属于几何，但 metrics 是同一个对象被逐帧读 —— 重算时一并带上，
     * 否则 applyGeometry 会把 create 时塞进去的 fontStack 冲掉（fontFamily: undefined）。 */
    metrics.fontStack = foliaResolveThemeFontStack(theme);
    metrics.translationFontStack = theme.translationFontStack || metrics.fontStack;
    inst.metrics = metrics;

    var glowBufferPx = Math.round(metrics.lyricFontPx * 1.2);
    inst.glowBufferPx = glowBufferPx;
    inst.vGlowBufferPx = glowBufferPx;

    inst.row.style.maxWidth = metrics.rowMaxWidthPx + 'px';

    /* 头部右边界：square 立牌画到 135.135% 并左移 35.135%，会把文字列压住；留出这段出血。 */
    var bleed = monetTuning().portraitStyle === 'square'
      ? '0.35135 * clamp(210px, 26vw, ' + metrics.portraitInnerMaxPx + 'px) - 3rem'
      : '0px';
    var shiftPx = Math.abs(Math.min(0, monetTuning().portraitOffsetX || 0));
    inst.headerMaxWidth = 'max(12rem, calc(100% - max(0px, calc(' + bleed + ')) - ' + shiftPx + 'px))';
    inst.metaEl.style.maxWidth = inst.headerMaxWidth;
    inst.titleWrapEl.style.maxWidth = inst.headerMaxWidth;

    inst.artistEl.style.fontSize = 'clamp(1rem, 1.8vw, ' + metrics.artistMaxRem + 'rem)';
    inst.artistEl.style.color = foliaColorWithAlpha(theme.primaryColor, 0.96);
    inst.barEl.style.background = 'linear-gradient(180deg, '
      + foliaColorWithAlpha(theme.primaryColor, 0.72) + ', transparent)';
    inst.titleEl.style.fontSize = 'clamp(1.45rem, 3.3vw, ' + metrics.titleMaxRem + 'rem)';
    inst.titleEl.style.color = theme.primaryColor;
    inst.titleEl.style.textShadow = '0 14px 36px ' + foliaColorWithAlpha(theme.backgroundColor, 0.28);
    inst.albumEl.style.color = foliaColorWithAlpha(theme.secondaryColor, 0.84);

    var capsuleStyleTouched = inst.capsuleEl.style;
    capsuleStyleTouched.borderColor = foliaColorWithAlpha(theme.primaryColor, 0.16);
    capsuleStyleTouched.backgroundColor = foliaColorWithAlpha(theme.backgroundColor, 0.18);
    capsuleStyleTouched.color = foliaColorWithAlpha(theme.primaryColor, 0.9);

    inst.descEl.style.display = monetTuning().showDescription ? '' : 'none';
    inst.audioWrapEl.style.display = monetTuning().showAudioVisualization ? '' : 'none';
    if (inst.hangerEl) inst.hangerEl.style.display = monetTuning().showPortraitDragHanger ? '' : 'none';
    if (inst.frameEl) {
      inst.frameEl.className = 'folia-monet-frame' + (monetTuning().portraitStyle === 'square' ? ' is-square' : ' is-portrait');
    }

    inst.portraitColEl.style.flex = '0 0 clamp(220px, 28vw, ' + metrics.portraitMaxPx + 'px)';
    inst.portraitBoxEl.style.maxWidth = 'clamp(210px, 26vw, ' + metrics.portraitInnerMaxPx + 'px)';

    /* square 立牌画到 135.135% 并左移 35.135%（Folia 的 motion.div 内联样式），
     * 让方封面盖住右侧整列并往文字列压过去一点。 */
    if (monetTuning().portraitStyle === 'square') {
      inst.portraitFloatEl.style.width = '135.135%';
      inst.portraitFloatEl.style.marginLeft = '-35.135%';
    } else {
      inst.portraitFloatEl.style.width = '100%';
      inst.portraitFloatEl.style.marginLeft = '0%';
    }

    /* tier B 叠色层：对角叠色 + 左 bloom + 右 veil + 主题色洗色，等价于烘焙进 canvas 的那几层。 */
    var overlay = monetClamp(MONET_BG_TUNING.backgroundOverlayOpacity, 0, 1);
    var washAlpha = monetClamp(MONET_BG_TUNING.backgroundWash, 0, 1) * 0.34;
    inst.bgVeilEl.style.backgroundImage = [
      'linear-gradient(135deg, ' + foliaColorWithAlpha(theme.accentColor, 0.08 + overlay * 0.62)
        + ' 0%, ' + foliaColorWithAlpha(theme.backgroundColor, 0.16 + overlay * 0.58)
        + ' 44%, ' + foliaColorWithAlpha(theme.primaryColor, 0.06 + overlay * 0.36) + ' 100%)',
      'radial-gradient(circle at 18% 34%, ' + foliaColorWithAlpha(theme.accentColor, overlay * 0.42)
        + ' 0%, ' + foliaColorWithAlpha(theme.backgroundColor, 0) + ' 55%)',
      'linear-gradient(90deg, ' + foliaColorWithAlpha(theme.backgroundColor, 0)
        + ' 45%, ' + foliaColorWithAlpha(theme.backgroundColor, 0.18 + overlay * 0.38) + ' 100%)',
      'linear-gradient(0deg, ' + foliaColorWithAlpha(theme.accentColor, washAlpha) + ' 0%, transparent 100%)'
    ].join(', ');

    var frameStyle = inst.frameEl.style;
    if (monetTuning().portraitStyle === 'square') {
      frameStyle.boxShadow = '0 36px 80px ' + foliaColorWithAlpha(theme.backgroundColor, 0.45)
        + ', 0 20px 42px ' + foliaColorWithAlpha(theme.accentColor, 0.22)
        + ', 0 0 0 1px ' + foliaColorWithAlpha(theme.primaryColor, 0.06);
      inst.frameInnerEl.style.backgroundColor = foliaColorWithAlpha(theme.primaryColor, 0.08);
    } else {
      frameStyle.borderColor = foliaColorWithAlpha(theme.primaryColor, 0.1);
      frameStyle.backgroundColor = foliaColorWithAlpha(theme.backgroundColor, 0.15);
      frameStyle.boxShadow = '0 24px 60px ' + foliaColorWithAlpha(theme.backgroundColor, 0.35);
      inst.frameInnerEl.style.backgroundColor = foliaColorWithAlpha(theme.primaryColor, 0.08);
    }

    /* 栏几何：高度 clamp(280px, 52vh, max(520×scale, fontPx×1.18×7))；左右各 glowBuffer 出血。 */
    var railMaxWidthPx = Math.round(MONET_RAIL_BASE_MAX_WIDTH_PX * metrics.largeScreenScale);
    var railMaxHeightPx = Math.round(Math.max(
      MONET_RAIL_BASE_MAX_HEIGHT_PX * metrics.largeScreenScale,
      metrics.lyricFontPx * 1.18 * MONET_RAIL_MIN_ROWS
    ));
    var railStyle = inst.railEl.style;
    railStyle.height = 'clamp(280px, 52vh, ' + railMaxHeightPx + 'px)';
    railStyle.maxWidth = railMaxWidthPx + 'px';
    railStyle.marginLeft = '-' + glowBufferPx + 'px';
    railStyle.marginRight = '-' + glowBufferPx + 'px';
    railStyle.paddingLeft = glowBufferPx + 'px';
    railStyle.paddingRight = glowBufferPx + 'px';

    /* 改字号 / 栏宽都会换行，测量缓存必须作废（否则预留高度对不上实际绘制）。 */
    inst.layoutCache.clear();
    inst.railSize = { width: 0, height: 0 };
    inst.audioSize = null;
    inst.layoutDirty = true;
  }

  function monetReadRailSize(inst) {
    var el = inst.railEl;
    if (!el) return { width: 0, height: 0 };
    return {
      width: Math.round(el.clientWidth),
      height: Math.round(el.clientHeight)
    };
  }

  /* ---- 歌词行 DOM ---- */
  function monetCreateLineNode(inst, entry, positioned, options) {
    var theme = inst.theme;
    var metrics = inst.metrics;
    var lyricFontPx = metrics.lyricFontPx;
    var glowBufferPx = inst.glowBufferPx;
    var vGlowBufferPx = inst.vGlowBufferPx;
    var isActive = entry.status === 'active';

    var el = document.createElement('div');
    el.className = 'folia-monet-line';
    el.setAttribute('data-folia-monet-line', String(entry.index));
    el.setAttribute('data-status', entry.status);

    var textEl = document.createElement('div');
    textEl.className = 'folia-monet-line-text';
    var textStyle = textEl.style;
    textStyle.marginLeft = '-' + glowBufferPx + 'px';
    textStyle.marginRight = '-' + glowBufferPx + 'px';
    textStyle.paddingLeft = glowBufferPx + 'px';
    textStyle.paddingRight = glowBufferPx + 'px';
    textStyle.marginTop = '-' + vGlowBufferPx + 'px';
    textStyle.marginBottom = '-' + vGlowBufferPx + 'px';
    textStyle.paddingTop = (positioned.layout.textPaddingTopPx + vGlowBufferPx) + 'px';
    textStyle.paddingBottom = (positioned.layout.textPaddingBottomPx + vGlowBufferPx) + 'px';
    textStyle.height = isActive ? '' : (positioned.layout.textHeightPx + vGlowBufferPx * 2) + 'px';
    textStyle.fontFamily = metrics.fontStack;
    textStyle.fontSize = lyricFontPx + 'px';
    textStyle.fontWeight = String(positioned.tone.fontWeight);
    textStyle.lineHeight = positioned.layout.lineHeightPx + 'px';
    textStyle.textShadow = isActive
      ? '0 14px 34px ' + foliaColorWithAlpha(theme.backgroundColor, 0.22)
      : 'none';
    el.appendChild(textEl);

    var tokensEl = document.createElement('span');
    tokensEl.className = 'folia-monet-tokens';
    textEl.appendChild(tokensEl);

    var lineObj = {
      key: entry.key,
      index: entry.index,
      entry: entry,
      el: el,
      textEl: textEl,
      tokensEl: tokensEl,
      tracksEl: [],
      words: [],
      entry: null,
      layout: positioned.layout,
      tone: positioned.tone,
      status: entry.status,
      ySpring: foliaSpringFollower(MONET_SCROLL_SPRING.stiffness, MONET_SCROLL_SPRING.damping, MONET_SCROLL_SPRING.mass),
      scaleSpring: foliaSpringFollower(MONET_SCALE_SPRING.stiffness, MONET_SCALE_SPRING.damping, MONET_SCALE_SPRING.mass),
      yTarget: positioned.y,
      scaleTarget: positioned.tone.scale,
      opacity: positioned.tone.opacity,
      blurPx: positioned.tone.blurPx,
      state: 'in',
      removeTimer: 0,
      exitStartAt: 0,
      exitFromY: 0,
      exitToY: 0,
      lastOpacity: 0,
      lastBlur: 5,
      lastWrittenY: 0,
      lastWrittenScale: 1,
      isManualStatic: !!options.renderStaticPassed
    };

    var swipeOverflowPx = Math.round(lyricFontPx * 0.5);
    lineObj.sweepOverflowPx = swipeOverflowPx;
    lineObj.fontSpec = positioned.tone.fontWeight + ' ' + lyricFontPx + 'px ' + metrics.fontStack;

    monetBuildLineWords(inst, lineObj, entry.line, isActive, swipeOverflowPx);
    monetBuildLineTracks(inst, lineObj, positioned, glowBufferPx);
    monetApplyLineAppearance(inst, lineObj, positioned, isActive);

    /* 入场：Folia 的 initial（opacity 0，y 偏移 ±34，scale×0.98，blur 5px）。 */
    if (!options.disableEntryMotion) {
      var initialOffset = entry.offset >= 0 ? 34 : -34;
      lineObj.ySpring.set(positioned.y + initialOffset);
      lineObj.scaleSpring.set(positioned.tone.scale * 0.98);
      lineObj.opacity = 0;
      lineObj.blurPx = 5;
      lineObj.pendingEntry = true;
    } else {
      lineObj.ySpring.set(positioned.y);
      lineObj.scaleSpring.set(positioned.tone.scale);
    }
    monetWriteLineTransform(lineObj);
    el.style.opacity = String(lineObj.opacity);
    el.style.filter = 'blur(' + lineObj.blurPx + 'px)';

    inst.railEl.appendChild(el);
    return lineObj;
  }

  function monetBuildLineWords(inst, lineObj, line, isActive, swipeOverflowPx) {
    var tokens = monetBuildDisplayTokens(line);
    lineObj.tokens = tokens;
    lineObj.words = [];
    var tokensEl = lineObj.tokensEl;
    while (tokensEl.firstChild) tokensEl.removeChild(tokensEl.firstChild);

    var accentColor = foliaColorWithAlpha(inst.theme.primaryColor, 0.98);
    var isChorus = !!line.isChorus;
    var chorusAccent = inst.theme.accentColor;
    var resolvedAccent = (isChorus && chorusAccent) ? foliaMixColors(accentColor, chorusAccent, 0.48) : accentColor;

    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var timed = token.timed && token.startTime !== null && token.endTime !== null;
      if (!isActive || !timed) {
        /* 静态串与非当前行：一个纯色 span（Folia renderStaticPassed / 非 timed 分支）。 */
        var plain = document.createElement('span');
        plain.className = 'folia-monet-token';
        plain.textContent = token.text;
        tokensEl.appendChild(plain);
        lineObj.words.push({
          token: token,
          baseEl: plain,
          sweepEl: null,
          fillEl: null,
          timed: false,
          color: resolvedAccent
        });
        continue;
      }

      var wordEl = document.createElement('span');
      wordEl.className = 'folia-monet-word';

      var baseEl = document.createElement('span');
      baseEl.className = 'folia-monet-word-base';
      baseEl.textContent = token.text;
      wordEl.appendChild(baseEl);

      var sweepEl = document.createElement('span');
      sweepEl.className = 'folia-monet-word-sweep';
      sweepEl.setAttribute('aria-hidden', 'true');
      sweepEl.style.top = '-' + swipeOverflowPx + 'px';
      sweepEl.style.bottom = '-' + swipeOverflowPx + 'px';
      sweepEl.style.paddingTop = swipeOverflowPx + 'px';
      sweepEl.style.paddingBottom = swipeOverflowPx + 'px';

      var fillEl = document.createElement('span');
      fillEl.className = 'folia-monet-word-fill';
      fillEl.textContent = token.text;
      fillEl.style.marginTop = '-' + swipeOverflowPx + 'px';
      fillEl.style.paddingTop = swipeOverflowPx + 'px';
      fillEl.style.paddingBottom = swipeOverflowPx + 'px';
      sweepEl.appendChild(fillEl);
      wordEl.appendChild(sweepEl);

      tokensEl.appendChild(wordEl);

      var offsets = monetMeasureGraphemeOffsets(token.text, inst.metrics.lyricFontPx, lineObj.fontSpec);
      lineObj.words.push({
        token: token,
        baseEl: baseEl,
        sweepEl: sweepEl,
        fillEl: fillEl,
        timed: true,
        offsets: offsets,
        timings: token.graphemeTimings || [],
        color: resolvedAccent,
        fullWidth: offsets.length ? offsets[offsets.length - 1] : 0,
        edgeSoftness: monetSweepEdgeSoftness(inst.metrics.lyricFontPx),
        isChorus: isChorus,
        lastMask: '',
        lastFill: '',
        lastShadow: ''
      });
    }
  }

  function monetBuildLineTracks(inst, lineObj, positioned, glowBufferPx) {
    var theme = inst.theme;
    var el = lineObj.el;
    for (var i = 0; i < positioned.layout.subtitleTracks.length; i++) {
      var track = positioned.layout.subtitleTracks[i];
      var trackEl = document.createElement('div');
      trackEl.className = 'folia-monet-track';
      trackEl.setAttribute('data-folia-monet-track', track.role);
      var style = trackEl.style;
      style.marginLeft = '-' + glowBufferPx + 'px';
      style.marginRight = '-' + glowBufferPx + 'px';
      style.paddingLeft = glowBufferPx + 'px';
      style.paddingRight = glowBufferPx + 'px';
      style.height = track.heightPx + 'px';
      style.paddingTop = track.paddingTopPx + 'px';
      style.paddingBottom = track.paddingBottomPx + 'px';
      style.color = foliaColorWithAlpha(theme.primaryColor, i > 0 ? 0.68 * SECONDARY_TRACK_OPACITY : 0.68);
      style.fontFamily = inst.metrics.translationFontStack;
      style.fontSize = track.fontPx + 'px';
      style.fontWeight = String(track.fontWeight);
      style.lineHeight = track.lineHeightPx + 'px';
      style.animationDelay = (i * MONET_SUBTITLE_TRACK_STAGGER_S) + 's';
      trackEl.textContent = track.text;
      monetApplyMask(trackEl, monetTrackMaskOf(track.isClipped, track.fontPx));
      el.appendChild(trackEl);
      lineObj.tracksEl.push(trackEl);
    }
  }

  function monetApplyLineAppearance(inst, lineObj, positioned, isActive) {
    var el = lineObj.el;
    el.style.height = positioned.layout.visualHeightPx + 'px';
    el.style.left = inst.glowBufferPx + 'px';
    el.style.right = inst.glowBufferPx + 'px';
    el.style.zIndex = String(positioned.tone.zIndex);
    el.setAttribute('data-status', positioned.status);

    var textStyle = lineObj.textEl.style;
    textStyle.fontWeight = String(positioned.tone.fontWeight);
    textStyle.height = isActive ? '' : (positioned.layout.textHeightPx + inst.vGlowBufferPx * 2) + 'px';
    textStyle.textShadow = isActive
      ? '0 14px 34px ' + foliaColorWithAlpha(inst.theme.backgroundColor, 0.22)
      : 'none';
    monetApplyMask(lineObj.textEl, isActive ? null : monetTextMaskOf(positioned.layout, inst.metrics.lyricFontPx, inst.vGlowBufferPx));
  }

  /* 行状态变了但 key 没变（waiting → active → passed）：重排词与译文的静态外观。 */
  function monetRebuildLineContent(inst, lineObj, entry, positioned) {
    var wasActive = lineObj.status === 'active';
    var isActive = entry.status === 'active';
    lineObj.status = entry.status;
    lineObj.layout = positioned.layout;
    lineObj.tone = positioned.tone;
    lineObj.isManualStatic = !!positioned.renderStaticPassed;

    if (wasActive !== isActive) {
      while (lineObj.tracksEl.length) {
        var old = lineObj.tracksEl.pop();
        if (old.parentNode) old.parentNode.removeChild(old);
      }
      monetBuildLineWords(inst, lineObj, entry.line, isActive, lineObj.sweepOverflowPx);
      monetBuildLineTracks(inst, lineObj, positioned, inst.glowBufferPx);
    }
    monetApplyLineAppearance(inst, lineObj, positioned, isActive);

    if (!isActive) {
      /* 非当前行不跑逐帧扫字：色调一次写定（passed 的 timed 词已是终色）。 */
      for (var i = 0; i < lineObj.words.length; i++) {
        var word = lineObj.words[i];
        word.baseEl.style.color = (entry.status === 'passed' && word.timed) ? word.color : positioned.tone.baseColor;
        word.baseEl.style.textShadow = 'none';
      }
    }
  }

  function monetWriteLineTransform(lineObj) {
    var y = lineObj.ySpring.get();
    var scale = lineObj.scaleSpring.get();
    lineObj.lastWrittenY = y;
    lineObj.lastWrittenScale = scale;
    lineObj.el.style.transform = 'translate3d(0, ' + y.toFixed(2) + 'px, 0) scale(' + scale.toFixed(4) + ')';
  }

  function monetDestroyLineNode(inst, lineObj) {
    if (lineObj.removeTimer) {
      clearTimeout(lineObj.removeTimer);
      lineObj.removeTimer = 0;
    }
    if (lineObj.el.parentNode) lineObj.el.parentNode.removeChild(lineObj.el);
    inst.lineNodes.delete(lineObj.key);
  }

  /* 行窗口同步：新增 / 更新 / 退场。Folia 的 AnimatePresence 在这里是「标记后 200ms 摘掉」。 */
  function monetSyncLines(inst, entries, positionedList, options) {
    var now = performance.now();
    var seen = {};
    var i;

    for (i = 0; i < positionedList.length; i++) {
      var positioned = positionedList[i];
      var entry = entries[i];
      seen[positioned.key] = true;

      var lineObj = inst.lineNodes.get(positioned.key);
      if (lineObj && lineObj.state === 'out') {
        /* 又回到窗口里：撤销退场，从当前位置继续弹。 */
        if (lineObj.removeTimer) { clearTimeout(lineObj.removeTimer); lineObj.removeTimer = 0; }
        lineObj.state = 'in';
        lineObj.el.classList.remove('is-exiting');
      }

      if (!lineObj) {
        lineObj = monetCreateLineNode(inst, entry, positioned, options);
        inst.lineNodes.set(positioned.key, lineObj);
        continue;
      }

      lineObj.index = entry.index;
      lineObj.entry = entry;
      lineObj.yTarget = positioned.y;
      lineObj.scaleTarget = positioned.tone.scale;
      lineObj.opacity = positioned.tone.opacity;
      lineObj.blurPx = positioned.tone.blurPx;
      /* 只有状态或测量结果真的变了才重排内容：外观与 tone 无关（权重/zIndex 只随状态变），
       * 每帧重写 8 个样式属性在 5 行上也是白烧。 */
      if (lineObj.status !== entry.status || lineObj.layout !== positioned.layout) {
        monetRebuildLineContent(inst, lineObj, entry, positioned);
      }
    }

    inst.lineNodes.forEach(function (lineObj, key) {
      if (seen[key] || lineObj.state === 'out') return;
      lineObj.state = 'out';
      lineObj.exitStartAt = now;
      lineObj.exitFromY = lineObj.ySpring.get();
      lineObj.exitToY = lineObj.yTarget + (lineObj.entry && lineObj.entry.offset < 0 ? -38 : 38);
      if (lineObj.status === 'passed') lineObj.exitToY = lineObj.yTarget - 38;
      lineObj.el.classList.add('is-exiting');
      lineObj.opacity = 0;
      lineObj.blurPx = 6;
      lineObj.el.style.opacity = '0';
      lineObj.el.style.filter = 'blur(6px)';
      lineObj.removeTimer = setTimeout(function () {
        monetDestroyLineNode(inst, lineObj);
      }, MONET_EXIT_MS + 60);
    });
  }

  /* ---- 逐帧：弹簧跟随 + 扫字 ---- */
  function monetStepLine(lineObj, dt, now) {
    if (lineObj.state === 'out') {
      var progress = monetClamp((now - lineObj.exitStartAt) / MONET_EXIT_MS, 0, 1);
      var eased = foliaEase([0.32, 0.72, 0, 1])(progress);
      lineObj.ySpring.set(lineObj.exitFromY + (lineObj.exitToY - lineObj.exitFromY) * eased);
      lineObj.scaleSpring.set(lineObj.scaleTarget * 0.98);
      monetWriteLineTransform(lineObj);
      return;
    }

    /* 入场：本帧只落 Folia 的 initial（opacity 0 / y 偏移 / blur 5），下一帧才收口 ——
     * 同一帧里既写 0 又写目标值，浏览器不会跑 transition，看上去就是「没有入场」。 */
    if (lineObj.pendingEntry) {
      lineObj.pendingEntry = false;
      monetWriteLineTransform(lineObj);
      return;
    }

    if (dt > 0) {
      lineObj.ySpring.step(lineObj.yTarget, dt);
      lineObj.scaleSpring.step(lineObj.scaleTarget, dt);
    }
    monetWriteLineTransform(lineObj);

    /* opacity / filter 走 CSS transition（0.28s / 0.32s，与 framer 的 tween 定义一致），
     * 只在目标值真的变了才写，避免每帧重置过渡。 */
    if (lineObj.opacity !== lineObj.lastOpacity) {
      lineObj.lastOpacity = lineObj.opacity;
      lineObj.el.style.opacity = String(lineObj.opacity);
    }
    if (lineObj.blurPx !== lineObj.lastBlur) {
      lineObj.lastBlur = lineObj.blurPx;
      lineObj.el.style.filter = 'blur(' + lineObj.blurPx + 'px)';
    }
  }

  function monetUpdateWords(inst, lineObj, time) {
    if (lineObj.status !== 'active') return;
    var baseColor = lineObj.tone.baseColor;
    var lineEnd = monetLineRenderEndTime(lineObj.entry ? lineObj.entry.line : null);

    for (var i = 0; i < lineObj.words.length; i++) {
      var word = lineObj.words[i];
      if (!word.timed || !word.fillEl) {
        word.baseEl.style.color = baseColor;
        continue;
      }

      var start = word.token.startTime;
      var end = word.token.endTime;
      var status = monetWordStatus(time, start, end);

      /* 基色：整行过了或词过了 → 词色；否则底色。 */
      var resolvedBase = (status === 'passed') ? word.color : baseColor;
      word.baseEl.style.color = resolvedBase;

      var fillWidth = monetFillWidth(time, start, end, word.offsets, word.timings);
      var maskImage = monetSweepMaskImage(fillWidth, word.fullWidth, word.edgeSoftness);
      if (maskImage !== word.lastMask) {
        word.lastMask = maskImage;
        word.sweepEl.style.webkitMaskImage = maskImage;
        word.sweepEl.style.maskImage = maskImage;
        word.sweepEl.style.webkitMaskSize = '100% 100%';
        word.sweepEl.style.maskSize = '100% 100%';
        word.sweepEl.style.webkitMaskRepeat = 'no-repeat';
        word.sweepEl.style.maskRepeat = 'no-repeat';
      }

      var progress = 0;
      if (time > start) {
        progress = time >= end ? 1 : (time - start) / Math.max(0.001, end - start);
      }
      var fillColor = foliaMixColors(baseColor, word.color, Math.min(progress, 1));
      var fillGradient = 'linear-gradient(90deg, ' + fillColor + ' 0%, '
        + foliaColorWithAlpha(fillColor, 0.92) + ' 68%, '
        + foliaColorWithAlpha(fillColor, 0.72) + ' 100%)';
      if (fillGradient !== word.lastFill) {
        word.lastFill = fillGradient;
        word.fillEl.style.backgroundImage = fillGradient;
      }

      var shadow = 'none';
      word.lastGlow = 0;
      if (time > start) {
        var intensity = monetGlow(time, start, end, lineEnd);
        word.lastGlow = intensity;
        if (intensity > 0) {
          var fontPx = inst.metrics.lyricFontPx;
          var radiusOne = Math.round(fontPx * (word.isChorus ? 0.45 : 0.28));
          var radiusTwo = Math.round(fontPx * (word.isChorus ? 0.90 : 0.65));
          var maxAlpha = word.isChorus ? 1.0 : 0.88;
          var glowColor = foliaMixColors(baseColor, word.color, intensity, intensity * maxAlpha);
          shadow = '0 0 ' + radiusOne + 'px ' + glowColor + ', 0 0 ' + radiusTwo + 'px ' + glowColor;
        }
      }
      if (shadow !== word.lastShadow) {
        word.lastShadow = shadow;
        word.baseEl.style.textShadow = shadow;
      }
    }
  }

  /* ---- 封面立牌交叉淡变（monetPortraitCrossfade + MonetPortraitImage） ---- */
  function monetPushPortraitLayer(inst, src) {
    var layers = inst.portraitLayers;
    var top = layers.length ? layers[layers.length - 1] : null;
    if (top && top.src === src) return;

    var key = 'monet-portrait-' + (inst.portraitLayerSeq = (inst.portraitLayerSeq || 0) + 1);
    var img = document.createElement('img');
    img.className = 'folia-monet-portrait-img';
    img.setAttribute('data-monet-portrait-image', '');
    img.decoding = 'async';
    img.alt = '';
    img.draggable = false;
    img.src = src;
    inst.portraitLayersEl.appendChild(img);

    var layer = { key: key, src: src, el: img };
    layers.push(layer);
    if (layers.length > MONET_PORTRAIT_MAX_LAYERS) {
      var dropped = layers.shift();
      if (dropped && dropped.el.parentNode) dropped.el.parentNode.removeChild(dropped.el);
    }

    /* 先解码再叠上去：解码失败就保持旧封面，绝不把空框露出来。 */
    requestAnimationFrame(function () {
      if (inst.destroyed) return;
      img.style.opacity = '1';
    });

    if (inst.portraitSettleTimer) clearTimeout(inst.portraitSettleTimer);
    inst.portraitSettleTimer = setTimeout(function () {
      if (inst.destroyed) return;
      var index = -1;
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].key === key) { index = i; break; }
      }
      if (index <= 0) return;
      for (var d = 0; d < index; d++) {
        if (layers[d].el.parentNode) layers[d].el.parentNode.removeChild(layers[d].el);
      }
      layers.splice(0, index);
    }, MONET_PORTRAIT_FADE_MS);
  }

  /* 肖像图来源（VisualizerMonet.tsx:170 逐字）：
   *   portraitSource === 'custom' ? 自定义图 ?? 封面 : 封面 ?? 自定义图
   * 「自定义图」来自 00b 的图片池（IndexedDB 键 monet_portrait_image），面板上传后即生效。 */
  function monetCustomPortraitUrl() {
    if (typeof window === 'undefined' || typeof window.foliaAssetGet !== 'function') return '';
    var entry = window.foliaAssetGet('portrait');
    return entry && entry.url ? String(entry.url) : '';
  }

  function monetSyncPortrait(inst, ctx) {
    var coverSrc = ctx.song ? String(ctx.song.coverUrl || '') : '';
    var customSrc = monetCustomPortraitUrl();
    var src = (inst.tuning || monetTuning()).portraitSource === 'custom'
      ? (customSrc || coverSrc)
      : (coverSrc || customSrc);
    if (!src) {
      /* 无封面：整栈淡出但保留节点，下一张才有东西可叠。 */
      if (inst.portraitSrc) {
        inst.portraitSrc = '';
        for (var i = 0; i < inst.portraitLayers.length; i++) inst.portraitLayers[i].el.style.opacity = '0';
      }
      return;
    }
    if (src === inst.portraitSrc) return;
    inst.portraitSrc = src;

    var loader = new Image();
    loader.decoding = 'async';
    var stack = function () {
      if (inst.destroyed || inst.portraitSrc !== src) return;
      monetPushPortraitLayer(inst, src);
    };
    if (src.indexOf('http') === 0) {
      var sameOrigin = false;
      try { sameOrigin = src.indexOf(location.origin) === 0; } catch (_) {}
      if (!sameOrigin) loader.crossOrigin = 'anonymous';
    }
    loader.src = src;
    if (typeof loader.decode === 'function') {
      loader.decode().then(stack, function () { stack(); });
    } else {
      loader.onload = stack;
    }
  }

  /* ---- 文本内容同步（曲名/歌手/专辑） ---- */
  function monetSyncHeader(inst, ctx) {
    var song = ctx.song || { title: '', artist: '', album: '' };
    var artist = String(song.artist || '').trim() || 'Monet';
    var album = String(song.album || '').trim() || 'Monet';
    var title = String(song.title || '').trim() || 'Monet';
    if (inst.artistEl.textContent !== artist) inst.artistEl.textContent = artist;
    if (inst.albumEl.textContent !== album) inst.albumEl.textContent = album;
    if (inst.titleEl.textContent !== title) inst.titleEl.textContent = title;
  }

  /* ---- 入场动画重放（Folia 的 introKey） ---- */
  function monetReplayIntro(inst) {
    var root = inst.root;
    /* 动画全挂在 .is-intro 后代上，所以必须「摘掉 → 强制 reflow → 挂回」才能重播；
     * 只 add 不 remove，第二次换歌时什么都不会发生。 */
    root.classList.remove('is-intro');
    void root.offsetWidth;
    root.classList.add('is-intro');
  }

  /* ---- 背景同步 ---- */
  function monetSyncBackground(inst, ctx) {
    var enabled = !foliaWorld.background || foliaWorld.background === 'none';
    inst.bgEl.style.opacity = enabled ? '1' : '0';
    if (!enabled) {
      inst.root.classList.remove('is-bg-fallback');
      return;
    }

    var src = monetCoverWashSrc(ctx.song ? ctx.song.coverUrl : '');
    var theme = ctx.theme;
    var key = monetBackgroundCacheKey(src || '', theme) + '|' + theme.backgroundColor + '|' + theme.accentColor;
    if (inst.bgKey === key) return;
    inst.bgKey = key;
    inst.bgReady = false;
    inst.bgFallback = false;

    if (!src) {
      inst.bgEl.style.backgroundImage = 'none';
      inst.root.classList.remove('is-bg-fallback');
      return;
    }

    /* 先挂 CSS 兜底图层，data URL 到了再换上去（避免首帧纯黑闪一下）。 */
    inst.bgFallback = true;
    inst.bgEl.style.backgroundImage = 'url("' + String(src).replace(/"/g, '%22') + '")';
    inst.bgEl.classList.add('is-css-fallback');
    inst.root.classList.add('is-bg-fallback');

    monetResolveBackgroundDataUrl(src, theme).then(function (dataUrl) {
      if (inst.destroyed || inst.bgKey !== key) return;
      if (!dataUrl) return; /* 画布被污染：保留 CSS 兜底图层 */
      inst.bgFallback = false;
      inst.bgReady = true;
      inst.bgEl.classList.remove('is-css-fallback');
      inst.root.classList.remove('is-bg-fallback');
      inst.bgEl.style.backgroundImage = 'url("' + dataUrl + '")';
    });
  }

  /* ---------- 14. 每帧主流程 ---------- */
  function monetTick(inst, ctx) {
    if (inst.destroyed) return;

    inst.theme = ctx.theme;
    inst.lastFrame = {
      time: Number(ctx.time) || 0,
      index: ctx.index,
      dt: Number(ctx.dt) || 0,
      paused: !!ctx.paused,
      lineCount: ctx.lines ? ctx.lines.length : 0
    };

    var textHidden = ctx.showText === false;
    if (textHidden !== !!inst.textHidden) {
      inst.textHidden = textHidden;
      if (textHidden) inst.root.classList.add('is-text-hidden');
      else inst.root.classList.remove('is-text-hidden');
    }

    /* 调参变化：字号 / 立牌形状进重排键，其余（描述、频谱、挂环）在 applyGeometry 里现读。 */
    var tuningNow = monetTuning();
    if (tuningNow !== inst.tuning) {
      var prevTuning = inst.tuning || {};
      inst.tuning = tuningNow;
      inst.layoutDirty = true;
      if (prevTuning.fontScale !== tuningNow.fontScale) inst.layoutCache.clear();
      /* 描述 / 频谱 / 挂环 / 立牌形状都是 applyGeometry 里现读的，不重跑那一遍就看不到开关生效。
       * 清键的代价只是重算一遍几何（text-wrap 缓存走 layoutCache，另有失效条件），比漏更新划算。 */
      inst.scaleKey = '';
    }

    /* 视口 / 字号变化才重排几何。 */
    var viewportWidth = window.innerWidth;
    var scaleKey = String(ctx.fontScale) + '|' + viewportWidth;
    if (inst.scaleKey !== scaleKey) {
      inst.scaleKey = scaleKey;
      inst.viewportWidth = viewportWidth;
      inst.metrics.fontStack = foliaResolveThemeFontStack(ctx.theme);
      inst.metrics.translationFontStack = ctx.theme.translationFontStack || inst.metrics.fontStack;
      monetApplyGeometry(inst, ctx);
    }

    /* 歌词轨尺寸在布局后才有值：读到 0 就下一帧再读，别用 0 去算位置。 */
    var railSize = monetReadRailSize(inst);
    if (railSize.width !== inst.railSize.width || railSize.height !== inst.railSize.height) {
      inst.railSize = railSize;
      inst.layoutDirty = true;
    }

    /* Folia 的 introKey：换歌（seed 变）或回到开头时整幅重播入场。 */
    var seed = ctx.seed == null ? '' : String(ctx.seed);
    if (inst.introSeed !== seed) {
      inst.introSeed = seed;
      monetReplayIntro(inst);
    }
    var time = Number(ctx.time) || 0;
    if (time < 0.1 && inst.lastTime > 2.0) monetReplayIntro(inst);
    inst.lastTime = time;

    /* 手动滚动的空闲复位。 */
    if (inst.manualAnchor !== null && ctx.now - inst.manualTouchedAt > MONET_SCROLL_IDLE_RESET_MS) {
      inst.manualAnchor = null;
      inst.wheelAccumulator = 0;
      inst.wheelDirection = 0;
      inst.touchAccumulator = 0;
      inst.touchDirection = 0;
    }

    var lines = ctx.lines || [];
    var manual = inst.manualAnchor !== null;
    var entries = manual
      ? monetBuildScrollableRailEntries(lines, inst.manualAnchor, ctx.index)
      : monetBuildVisibleLineEntries(lines, ctx.index, time, 2, 2);

    if (entries.length === 0) {
      inst.lineNodes.forEach(function (lineObj) {
        monetDestroyLineNode(inst, lineObj);
      });
      inst.positioned = [];
    } else if (inst.railSize.width > 0) {
      var positioned = monetBuildPositionedEntries(
        entries,
        inst.railSize,
        ctx.theme,
        inst.metrics,
        {
          translationFontPx: inst.metrics.translationFontPx,
          fontStack: inst.metrics.fontStack,
          translationFontStack: inst.metrics.translationFontStack,
          /* 本项目没有独立字幕主题：译文权重走 Folia 的 fallback（500 / 400）。 */
          fontWeight: foliaResolveThemeFontWeight(ctx.theme, 600),
          translationFontWeight: 500,
          secondaryTranslationFontWeight: SECONDARY_TRACK_FONT_WEIGHT_FALLBACK,
          subtitleContentMode: ctx.showTranslation ? 'translation' : 'none',
          rich: inst.pretextRich,
          pretext: inst.pretextLayout
        },
        inst.glowBufferPx,
        inst.layoutCache
      );
      monetSyncLines(inst, entries, positioned, {
        disableEntryMotion: manual,
        renderStaticPassed: manual
      });
      inst.positioned = positioned;
    }

    /* 弹簧 / 扫字。dt 由主循环 clamp 过；第一帧 dt=0 时只写位置不积分。 */
    var dt = Number(ctx.dt) || 0;
    var now = performance.now();
    var activeLineObj = null;
    inst.lineNodes.forEach(function (lineObj) {
      monetStepLine(lineObj, dt, now);
      if (lineObj.status === 'active' && lineObj.state === 'in') activeLineObj = lineObj;
    });
    if (activeLineObj) monetUpdateWords(inst, activeLineObj, time);

    monetSyncHeader(inst, ctx);
    monetSyncPortrait(inst, ctx);
    monetSyncBackground(inst, ctx);

    if (monetTuning().showAudioVisualization) {
      inst.audioState = monetDrawAudioFrame(inst, ctx);
    }

    inst.wordCount = activeLineObj ? activeLineObj.words.length : 0;
  }

  /* ---------- 15. 注册 ---------- */
  registerFoliaMode('monet', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerMonet = 莫奈，order 90，
     * pickerDescription.visualizer.monet = 海报式版面：左侧歌词轨、右侧肖像、底部频谱。 */
    name: '莫奈',
    desc: '海报式版面：左侧歌词轨、右侧肖像、底部频谱',
    order: 90,

    create: function (host, ctx) {
      var root = document.createElement('div');
      root.className = 'folia-monet is-intro';
      host.appendChild(root);

      var inst = {
        root: root,
        theme: ctx.theme,
        destroyed: false,
        failReason: '',
        metrics: monetFontMetrics(window.innerWidth, ctx.fontScale),
        viewportWidth: window.innerWidth,
        railSize: { width: 0, height: 0 },
        railScrollHandler: null,
        lineNodes: new Map(),
        layoutCache: new Map(),
        positioned: [],
        manualAnchor: null,
        manualTouchedAt: 0,
        wheelAccumulator: 0,
        wheelDirection: 0,
        touchAccumulator: 0,
        touchDirection: 0,
        touchLastY: null,
        lastTime: 0,
        introSeed: null,
        pretextLayout: null,
        pretextRich: null,
        audioState: null,
        wordCount: 0,
        lastFrame: null,
        /* 建实例时的调参快照：tick 里比对身份，变了按字段决定重排 / 改形状。 */
        tuning: monetTuning()
      };
      inst.metrics.fontStack = foliaResolveThemeFontStack(ctx.theme);
      inst.metrics.translationFontStack = ctx.theme.translationFontStack || inst.metrics.fontStack;

      monetBuildDom(inst, ctx);
      monetApplyGeometry(inst, ctx);

      /* pretext 两件套：layout 管译文断行，rich-inline 管 token 原子盒。
       * 未就绪时测量走 canvas 贪心兜底；到货后清缓存重排（等价于 Folia 的 fontsEpoch 失效）。 */
      if (typeof foliaLoadPretext === 'function') {
        foliaLoadPretext().then(function (mod) {
          if (inst.destroyed) return;
          inst.pretextLayout = mod;
          inst.layoutCache.clear();
          monetMetricsCache.clear();
        }).catch(function (err) {
          inst.failReason = 'pretext 加载失败（测量走 canvas 兜底）：' + ((err && err.message) || String(err));
          console.warn('[FoliaMonet]', inst.failReason);
        });
      }
      if (typeof foliaLoadPretextRich === 'function') {
        foliaLoadPretextRich().then(function (mod) {
          if (inst.destroyed) return;
          inst.pretextRich = mod;
          inst.layoutCache.clear();
        }).catch(function (err) {
          inst.failReason = 'pretext/rich-inline 加载失败（token 断行走 canvas 兜底）：' + ((err && err.message) || String(err));
          console.warn('[FoliaMonet]', inst.failReason);
        });
      }

      /* 歌词轨滚轮 / 触摸：累加器 + ±1 步限幅（Folia MonetLyricsRail）。 */
      var rail = inst.railEl;
      var moveAnchor = function (steps) {
        var lines = (typeof foliaWorldLines === 'function') ? foliaWorldLines() : [];
        if (!lines.length) return;
        var base = inst.manualAnchor !== null
          ? inst.manualAnchor
          : (inst.lastFrame && inst.lastFrame.index >= 0 ? inst.lastFrame.index : 0);
        inst.manualAnchor = Math.round(monetClamp(base + steps, 0, lines.length - 1));
        inst.manualTouchedAt = performance.now();
      };
      var touchAnchor = function () {
        inst.manualTouchedAt = performance.now();
        if (inst.manualAnchor === null) {
          inst.manualAnchor = (inst.lastFrame && inst.lastFrame.index >= 0) ? inst.lastFrame.index : 0;
        }
      };
      var onWheel = function (event) {
        if (!inst.lineNodes.size) return;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        var direction = event.deltaY === 0 ? 0 : (event.deltaY > 0 ? 1 : -1);
        if (direction !== 0 && inst.wheelDirection !== 0 && direction !== inst.wheelDirection) {
          inst.wheelAccumulator = 0;
        }
        inst.wheelDirection = direction || inst.wheelDirection;
        inst.wheelAccumulator += event.deltaY;
        var steps = Math.max(-1, Math.min(1, Math.trunc(inst.wheelAccumulator / MONET_SCROLL_STEP_PX)));
        if (steps !== 0) {
          inst.wheelAccumulator = 0;
          moveAnchor(steps);
        } else {
          inst.manualTouchedAt = performance.now();
        }
      };
      var onTouchStart = function (event) {
        if (!inst.lineNodes.size) return;
        event.stopPropagation();
        inst.touchLastY = event.touches[0] ? event.touches[0].clientY : null;
        inst.touchAccumulator = 0;
        inst.touchDirection = 0;
        touchAnchor();
      };
      var onTouchMove = function (event) {
        if (!inst.lineNodes.size || inst.touchLastY === null) return;
        event.stopPropagation();
        var nextY = event.touches[0] ? event.touches[0].clientY : null;
        if (typeof nextY !== 'number') return;
        var deltaY = inst.touchLastY - nextY;
        inst.touchLastY = nextY;
        var direction = deltaY === 0 ? 0 : (deltaY > 0 ? 1 : -1);
        if (direction !== 0 && inst.touchDirection !== 0 && direction !== inst.touchDirection) {
          inst.touchAccumulator = 0;
        }
        inst.touchDirection = direction || inst.touchDirection;
        inst.touchAccumulator += deltaY;
        var steps = Math.max(-1, Math.min(1, Math.trunc(inst.touchAccumulator / MONET_TOUCH_STEP_PX)));
        if (steps !== 0) {
          inst.touchAccumulator = 0;
          moveAnchor(steps);
        } else {
          inst.manualTouchedAt = performance.now();
        }
      };
      var onTouchEnd = function () {
        inst.touchLastY = null;
        inst.touchDirection = 0;
        inst.touchAccumulator = 0;
        inst.manualTouchedAt = performance.now();
      };
      rail.addEventListener('wheel', onWheel, { passive: false });
      rail.addEventListener('touchstart', onTouchStart, { passive: false });
      rail.addEventListener('touchmove', onTouchMove, { passive: false });
      rail.addEventListener('touchend', onTouchEnd, { passive: false });
      rail.addEventListener('touchcancel', onTouchEnd, { passive: false });
      inst.railScrollHandler = {
        wheel: onWheel, touchstart: onTouchStart, touchmove: onTouchMove,
        touchend: onTouchEnd, touchcancel: onTouchEnd
      };

      inst.debug = function () { return monetDebugState(inst); };
      inst.dropLayoutCache = function () {
        inst.layoutCache.clear();
        monetMetricsCache.clear();
        monetGraphemeCache.clear();
      };

      return inst;
    },

    tick: monetTick,

    destroy: function (inst) {
      if (!inst) return;
      inst.destroyed = true;
      if (inst.portraitSettleTimer) {
        clearTimeout(inst.portraitSettleTimer);
        inst.portraitSettleTimer = 0;
      }
      inst.lineNodes.forEach(function (lineObj) {
        if (lineObj.removeTimer) clearTimeout(lineObj.removeTimer);
      });
      inst.lineNodes.clear();
      if (inst.railEl && inst.railScrollHandler) {
        var h = inst.railScrollHandler;
        inst.railEl.removeEventListener('wheel', h.wheel, { passive: false });
        inst.railEl.removeEventListener('touchstart', h.touchstart, { passive: false });
        inst.railEl.removeEventListener('touchmove', h.touchmove, { passive: false });
        inst.railEl.removeEventListener('touchend', h.touchend, { passive: false });
        inst.railEl.removeEventListener('touchcancel', h.touchcancel, { passive: false });
      }
      inst.railScrollHandler = null;
      inst.portraitLayers = [];
      inst.layoutCache.clear();
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
    }
  });

  /* ---------- 16. 探针（冒烟判据的唯一入口） ---------- */
  function monetRound(value, digits) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    var factor = Math.pow(10, digits == null ? 3 : digits);
    return Math.round(n * factor) / factor;
  }

  function monetDebugState(inst) {
    var positioned = inst.positioned || [];
    var rows = [];
    for (var i = 0; i < positioned.length; i++) {
      var p = positioned[i];
      var node = inst.lineNodes.get(p.key);
      rows.push({
        key: p.key,
        index: p.index,
        offset: p.offset,
        status: p.status,
        y: monetRound(p.y, 2),
        scale: monetRound(p.tone.scale, 4),
        opacity: monetRound(p.tone.opacity, 4),
        blurPx: monetRound(p.tone.blurPx, 3),
        baseColor: p.tone.baseColor,
        zIndex: p.tone.zIndex,
        visualHeight: monetRound(p.layout.visualHeightPx, 2),
        textHeight: monetRound(p.layout.textHeightPx, 2),
        textLineCount: p.layout.textLineCount,
        visibleTextLineCount: p.layout.visibleTextLineCount,
        lineHeightPx: monetRound(p.layout.lineHeightPx, 3),
        isTextClipped: p.layout.isTextClipped,
        isTextOverflowingWidth: p.layout.isTextOverflowingWidth,
        trackCount: p.layout.subtitleTracks.length,
        trackHeight: monetRound(p.layout.translationHeightPx, 2),
        domY: node ? monetRound(node.lastWrittenY, 2) : null,
        domScale: node ? monetRound(node.lastWrittenScale, 4) : null,
        springY: node ? monetRound(node.ySpring.get(), 2) : null,
        domStatus: node ? node.el.getAttribute('data-status') : null,
        domOpacity: node ? node.el.style.opacity : null,
        domHeight: node ? node.el.style.height : null,
        tokenText: node ? node.tokensEl.textContent : null,
        /* 当前行的 DOM 里，每个 timed 词是「底色 span + 扫字覆盖 span」两层同样的文字，
         * 所以 textContent 会翻倍。token 切分是否无损要看 tokens 数组本身。 */
        tokenJoined: node ? node.tokens.map(function (t) { return t.text; }).join('') : null,
        tokenCount: node ? node.tokens.length : 0,
        wordCount: node ? node.words.length : 0,
        trackText: node && node.tracksEl.length ? node.tracksEl[0].textContent : null
      });
    }

    var activeNode = null;
    inst.lineNodes.forEach(function (lineObj) {
      if (lineObj.status === 'active') activeNode = lineObj;
    });

    var wordSamples = [];
    var tokensText = '';
    if (activeNode) {
      for (var w = 0; w < activeNode.words.length; w++) {
        var word = activeNode.words[w];
        if (!word.timed || !word.fillEl) continue;
        wordSamples.push({
          text: word.token.text,
          startTime: word.token.startTime,
          endTime: word.token.endTime,
          fullWidth: monetRound(word.fullWidth, 2),
          offsetCount: word.offsets.length,
          timingCount: word.timings.length,
          mask: word.lastMask,
          fill: word.lastFill,
          shadow: word.lastShadow,
          glow: monetRound(word.lastGlow || 0, 4),
          color: word.baseEl.style.color
        });
        tokensText += word.token.text;
      }
    }

    return {
      metrics: {
        lyricFontPx: monetRound(inst.metrics.lyricFontPx, 3),
        inactiveFontPx: monetRound(inst.metrics.inactiveFontPx, 3),
        translationFontPx: monetRound(inst.metrics.translationFontPx, 3),
        largeScreenScale: monetRound(inst.metrics.largeScreenScale, 4),
        rowMaxWidthPx: inst.metrics.rowMaxWidthPx,
        portraitMaxPx: inst.metrics.portraitMaxPx,
        portraitInnerMaxPx: inst.metrics.portraitInnerMaxPx
      },
      fontScaleKey: inst.scaleKey ? String(inst.scaleKey) : '',
      rail: {
        width: inst.railSize.width,
        height: inst.railSize.height,
        glowBufferPx: inst.glowBufferPx,
        heightCss: inst.railEl ? inst.railEl.style.height : '',
        maxWidthCss: inst.railEl ? inst.railEl.style.maxWidth : '',
        mask: inst.railEl ? inst.railEl.style.maskImage || inst.railEl.style.webkitMaskImage : ''
      },
      anchorIndex: inst.lastFrame ? inst.lastFrame.index : -1,
      manualAnchor: inst.manualAnchor,
      positioned: rows,
      activeWords: wordSamples,
      activeTokenText: tokensText,
      wordCount: inst.wordCount,
      header: {
        artist: inst.artistEl ? inst.artistEl.textContent : '',
        title: inst.titleEl ? inst.titleEl.textContent : '',
        album: inst.albumEl ? inst.albumEl.textContent : '',
        capsule: inst.capsuleLabelEl ? inst.capsuleLabelEl.textContent : '',
        maxWidth: inst.metaEl ? inst.metaEl.style.maxWidth : '',
        descDisplay: inst.descEl ? inst.descEl.style.display : ''
      },
      portrait: {
        style: monetTuning().portraitStyle,
        layerCount: inst.portraitLayers ? inst.portraitLayers.length : 0,
        src: inst.portraitSrc,
        floatWidth: inst.portraitFloatEl ? inst.portraitFloatEl.style.width : '',
        floatMarginLeft: inst.portraitFloatEl ? inst.portraitFloatEl.style.marginLeft : '',
        frameAspect: inst.frameEl ? inst.frameEl.className : '',
        hanger: !!inst.hangerEl
      },
      audio: inst.audioState ? {
        mode: inst.audioState.mode,
        bars: inst.audioState.bars,
        hasRawSpectrum: inst.audioState.hasRaw,
        energy: monetRound(inst.audioState.energy, 4),
        canvasWidth: inst.audioCanvas ? inst.audioCanvas.width : 0,
        canvasHeight: inst.audioCanvas ? inst.audioCanvas.height : 0
      } : null,
      background: {
        key: inst.bgKey || '',
        ready: !!inst.bgReady,
        cssFallback: !!inst.bgFallback,
        hasImage: !!(inst.bgEl && /url\(/.test(String(inst.bgEl.style.backgroundImage || '')))
      },
      decor: {
        count: inst.decorEl ? inst.decorEl.childElementCount : 0
      },
      pretext: {
        layout: !!inst.pretextLayout,
        rich: !!inst.pretextRich
      },
      failReason: inst.failReason || '',
      lineCount: inst.lineNodes.size,
      lastFrame: inst.lastFrame
    };
  }
})();
