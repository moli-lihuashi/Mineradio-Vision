/* Folia 世界 — 文本层（字素 / 分词 / 布局单元 / 词色 / 字体权重）
 *
 * 对应 Folia 的三个 utils：graphemeTiming.ts、wordSegmentation.ts、cjkSemanticLayout.ts
 * 以及 components/visualizer/wordColoring.ts 的 resolveWordColor 和 utils/fontStacks.ts 的权重归一。
 *
 * 铁律：这里全是纯函数 + 一张测量缓存，不碰 DOM 结构（除了一个离屏 canvas 量字宽）。
 * 新增符号一律 folia 前缀。
 */
'use strict';

var FOLIA_CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

function foliaHasCjk(text) {
  return FOLIA_CJK_RE.test(String(text || ''));
}

/* ---- 字素切分（Intl.Segmenter，退化到码点） ---- */
var foliaGraphemeSegmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function foliaSplitGraphemes(text) {
  var s = String(text || '');
  if (!s) return [];
  if (!foliaGraphemeSegmenter) return Array.from(s);
  var out = [];
  var it = foliaGraphemeSegmenter.segment(s);
  for (var part of it) out.push(part.segment);
  return out;
}

/* ---- 词切分（Intl.Segmenter word，退化到字素） ---- */
var FOLIA_PUNCT_ONLY_RE = /^[\s\p{P}\p{S}]+$/u;
var foliaWordSegmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null;

function foliaSegmentsFromBoundaries(boundaries) {
  var cursor = 0;
  return boundaries.map(function (segment) {
    var part = { segment: segment, index: cursor, isWordLike: !FOLIA_PUNCT_ONLY_RE.test(segment) };
    cursor += segment.length;
    return part;
  });
}

function foliaSegmentTextWords(text) {
  var s = String(text || '');
  if (!s) return [];
  if (foliaWordSegmenter) {
    try {
      var out = [];
      var it = foliaWordSegmenter.segment(s);
      for (var part of it) {
        out.push({
          segment: part.segment,
          index: part.index,
          isWordLike: part.isWordLike == null ? !FOLIA_PUNCT_ONLY_RE.test(part.segment) : part.isWordLike
        });
      }
      return out;
    } catch (_) {}
  }
  return foliaSegmentsFromBoundaries(foliaSplitGraphemes(s));
}

/* 本项目没有用户自定义分词（line.wordSegments 不存在），所以只有 Intl 一条路。 */
function foliaSegmentLyricWords(line) {
  return foliaSegmentTextWords(line && line.fullText);
}

/* ---- 布局单元（CJK 语义分组 + 标点黏连） ---- */
var FOLIA_WS_RE = /^\s+$/;
var FOLIA_APOS_ONLY_RE = /^['’]\s*$/;
var FOLIA_CONTRACTION_SUFFIX_RE = /^(s|t|m|d|ll|re|ve|em)\s*$/i;
var FOLIA_DIRECT_CONTRACTION_RE = /^['’](s|t|m|d|ll|re|ve|em)\s*$/i;
var FOLIA_TRAILING_APOS_RE = /['’]\s*$/;
var FOLIA_TRAILING_WORD_CHAR_RE = /[\p{L}\p{N}]$/u;
var FOLIA_INLINE_CONTRACTION_RE = /[\p{L}\p{N}]+['’](s|t|m|d|ll|re|ve|em)/iu;
var FOLIA_STICKY_PUNCT_RE = /^[,.;:!?，。！？、：；）】》」』〉〕］)}\]"'’”’]+$/u;

function foliaCreateSingleWordLayoutUnits(words) {
  return (words || []).map(function (word) {
    return {
      text: word.text,
      words: [word],
      startTime: word.startTime,
      endTime: word.endTime,
      isSemantic: false
    };
  });
}

function foliaCloneUnit(unit) {
  return {
    text: unit.text,
    words: unit.words.slice(),
    startTime: unit.startTime,
    endTime: unit.endTime,
    isSemantic: unit.isSemantic,
    isSticky: unit.isSticky
  };
}

function foliaAppendUnitToSticky(target, unit) {
  target.text += unit.text;
  for (var i = 0; i < unit.words.length; i++) target.words.push(unit.words[i]);
  target.endTime = unit.endTime;
  target.isSticky = true;
}

/* Intl.Segmenter 输出映射回 parser 词。任何一步对不上就整体回落，不猜。 */
function foliaMapSegmentsToWords(segments, words) {
  var units = [];
  var wordIndex = 0;

  for (var s = 0; s < segments.length; s++) {
    var segmentText = segments[s].segment;
    if (!segmentText || FOLIA_WS_RE.test(segmentText)) continue;

    var startWordIndex = wordIndex;
    var collected = '';
    while (wordIndex < words.length && collected.length < segmentText.length) {
      collected += words[wordIndex].text;
      wordIndex += 1;
      if (segmentText.indexOf(collected) !== 0) return null;
    }
    if (collected !== segmentText) return null;

    var segmentWords = words.slice(startWordIndex, wordIndex);
    var firstWord = segmentWords[0];
    var lastWord = segmentWords[segmentWords.length - 1];
    if (!firstWord || !lastWord) return null;

    if (!segments[s].isWordLike && units.length > 0) {
      var prev = units[units.length - 1];
      prev.text += segmentText;
      for (var k = 0; k < segmentWords.length; k++) prev.words.push(segmentWords[k]);
      prev.endTime = segmentWords[segmentWords.length - 1].endTime;
      continue;
    }

    units.push({
      text: segmentText,
      words: segmentWords,
      startTime: firstWord.startTime,
      endTime: lastWord.endTime,
      isSemantic: Boolean(segments[s].isWordLike && foliaHasCjk(segmentText) && segmentWords.length > 1)
    });
  }

  if (wordIndex !== words.length || units.length === 0) return null;
  return units;
}

function foliaBuildCjkSemanticLayoutUnits(line) {
  var words = (line && line.words) || [];
  if (words.length === 0) return [];
  var fallback = foliaCreateSingleWordLayoutUnits(words);
  if (!foliaHasCjk(line.fullText)) return fallback;
  var segments = foliaSegmentLyricWords(line);
  if (!segments || segments.length === 0) return fallback;
  return foliaMapSegmentsToWords(segments, words) || fallback;
}

function foliaCanAttachToPrevious(text) {
  return FOLIA_TRAILING_WORD_CHAR_RE.test(String(text || '').replace(/\s+$/, ''));
}

function foliaApplyStickyPunctuationLayoutUnits(units) {
  var merged = [];
  for (var i = 0; i < units.length; i++) {
    var current = units[i];
    var previous = merged[merged.length - 1];
    if (!previous) { merged.push(foliaCloneUnit(current)); continue; }

    var next = units[i + 1];
    var curTrim = String(current.text).trim();

    if (FOLIA_APOS_ONLY_RE.test(curTrim) && next && foliaCanAttachToPrevious(previous.text)
        && FOLIA_CONTRACTION_SUFFIX_RE.test(String(next.text).trim())) {
      foliaAppendUnitToSticky(previous, current);
      foliaAppendUnitToSticky(previous, next);
      i += 1;
      continue;
    }
    if (FOLIA_DIRECT_CONTRACTION_RE.test(curTrim) && foliaCanAttachToPrevious(previous.text)) {
      foliaAppendUnitToSticky(previous, current);
      continue;
    }
    if (FOLIA_CONTRACTION_SUFFIX_RE.test(curTrim) && FOLIA_TRAILING_APOS_RE.test(String(previous.text).replace(/\s+$/, ''))) {
      foliaAppendUnitToSticky(previous, current);
      continue;
    }
    if (FOLIA_STICKY_PUNCT_RE.test(curTrim) && foliaCanAttachToPrevious(previous.text)) {
      foliaAppendUnitToSticky(previous, current);
      continue;
    }
    merged.push(foliaCloneUnit(current));
  }

  return merged.map(function (unit) {
    var hasTrailingPunct = false;
    if (unit.words.length > 1) {
      var lastWord = unit.words[unit.words.length - 1];
      if (lastWord) hasTrailingPunct = FOLIA_STICKY_PUNCT_RE.test(String(lastWord.text).trim());
    }
    var hasInlineContraction = unit.words.length > 1 && !unit.isSemantic && FOLIA_INLINE_CONTRACTION_RE.test(unit.text);
    if (hasTrailingPunct || hasInlineContraction) {
      var copy = foliaCloneUnit(unit);
      copy.isSticky = true;
      return copy;
    }
    return unit;
  });
}

function foliaBuildPostLyricLayoutUnits(line, options) {
  options = options || {};
  var rawUnits = options.semantic ? foliaBuildCjkSemanticLayoutUnits(line) : foliaCreateSingleWordLayoutUnits((line && line.words) || []);
  return options.sticky ? foliaApplyStickyPunctuationLayoutUnits(rawUnits) : rawUnits;
}

/* 布局单元 → 真正要画的词。黏连的非语义单元合成一个词（It + ’ + s → It’s），
 * CJK 语义单元保留原始逐字词，逐字时间不丢。 */
function foliaBuildDisplayWordsFromLayoutUnits(units) {
  var out = [];
  for (var i = 0; i < units.length; i++) {
    var unit = units[i];
    if (!unit.isSticky || unit.isSemantic) {
      for (var k = 0; k < unit.words.length; k++) out.push(unit.words[k]);
    } else {
      out.push({ text: unit.text, startTime: unit.startTime, endTime: unit.endTime });
    }
  }
  return out;
}

/* 纯 LRC（没有逐字时间）时的兜底：按分词把整行时长均摊到每个词。
 * Folia 的解析器永远给逐词时间，本项目有些源只给整行时间，缺了这一步 classic 会一个字都不显示。 */
function foliaSynthesizeWordsForLine(line) {
  var text = String((line && line.fullText) || '');
  if (!text) return [];
  var segments = foliaSegmentTextWords(text).filter(function (part) {
    return part.segment && !FOLIA_WS_RE.test(part.segment);
  });
  if (segments.length === 0) {
    segments = foliaSplitGraphemes(text).map(function (ch) { return { segment: ch }; });
  }
  if (segments.length === 0) return [];

  var start = line.startTime;
  var end = Math.max(line.endTime, start + 0.2);
  var total = 0;
  var i;
  for (i = 0; i < segments.length; i++) total += Math.max(segments[i].segment.length, 1);

  var out = [];
  var cursor = start;
  for (i = 0; i < segments.length; i++) {
    var share = Math.max(segments[i].segment.length, 1) / total;
    var next = i === segments.length - 1 ? end : cursor + (end - start) * share;
    out.push({ text: segments[i].segment, startTime: cursor, endTime: next });
    cursor = next;
  }
  return out;
}

/* classic / partita 的默认展示词：语义分组 + 标点黏连。 */
function foliaDisplayWordsForLine(line, useLegacyLayout) {
  if (!line) return [];
  if (!line.words || line.words.length === 0) return foliaSynthesizeWordsForLine(line);
  if (useLegacyLayout) return (line.words || []).slice();
  var units = foliaBuildPostLyricLayoutUnits(line, { semantic: true, sticky: true });
  return foliaBuildDisplayWordsFromLayoutUnits(units);
}

/* ---- 字素时间（逐字辉光要靠它） ---- */
function foliaBuildEvenGraphemeTimings(text, startTime, endTime) {
  var graphemes = foliaSplitGraphemes(text);
  if (graphemes.length === 0) return [];
  var duration = Math.max(endTime - startTime, 0);
  var unit = duration / graphemes.length;
  return graphemes.map(function (ch, i) {
    return {
      char: ch,
      startTime: startTime + unit * i,
      endTime: i === graphemes.length - 1 ? endTime : startTime + unit * (i + 1)
    };
  });
}

function foliaBuildWordGraphemeTimings(word) {
  if (!word) return [];
  if (word.syllables && word.syllables.length) {
    var out = [];
    for (var i = 0; i < word.syllables.length; i++) {
      var syl = word.syllables[i];
      var timings = foliaBuildEvenGraphemeTimings(syl.text, syl.startTime, syl.endTime);
      for (var k = 0; k < timings.length; k++) out.push(timings[k]);
    }
    return out;
  }
  return foliaBuildEvenGraphemeTimings(word.text, word.startTime, word.endTime);
}

/* ---- 词色（关键词着色）：本项目没有映射表，等价于永远返回兜底色 ---- */
function foliaNormalizeWordColorToken(text) {
  return String(text || '').toLowerCase().replace(/[^\w]/g, '');
}

/* Folia resolveWordColor：cjkMatchMode 三档（target-contains-token 默认 /
 * bidirectional-contains / exact），fume 用 bidirectional-contains。 */
function foliaResolveWordColor(wordText, wordColors, fallbackColor, options) {
  if (!wordColors || wordColors.length === 0) return fallbackColor;
  var cleanCurrent = String(wordText || '').trim();
  if (!cleanCurrent) return fallbackColor;
  var cjkMatchMode = (options && options.cjkMatchMode) || 'target-contains-token';

  for (var i = 0; i < wordColors.length; i++) {
    var entry = wordColors[i];
    if (!entry || typeof entry.word !== 'string' || typeof entry.color !== 'string') continue;
    var target = entry.word.trim();
    if (!target) continue;

    if (foliaHasCjk(cleanCurrent)) {
      if (cjkMatchMode === 'exact') {
        if (target === cleanCurrent) return entry.color;
        continue;
      }
      if (cjkMatchMode === 'bidirectional-contains') {
        if (target.indexOf(cleanCurrent) >= 0 || cleanCurrent.indexOf(target) >= 0) return entry.color;
        continue;
      }
      if (target.indexOf(cleanCurrent) >= 0) return entry.color;
      continue;
    }
    var targetWords = target.split(/\s+/).map(foliaNormalizeWordColorToken).filter(Boolean);
    var normalizedCurrent = foliaNormalizeWordColorToken(cleanCurrent);
    if (normalizedCurrent && targetWords.indexOf(normalizedCurrent) >= 0) return entry.color;
  }
  return fallbackColor;
}

/* ---- 字体权重归一（Folia: 100..900，按 10 取整） ---- */
function foliaNormalizeFontWeight(value) {
  var n = Number(value);
  if (!isFinite(n)) return null;
  var clamped = Math.min(900, Math.max(100, n));
  return Math.round(clamped / 10) * 10;
}

function foliaResolveThemeFontWeight(theme, fallback) {
  var normalized = foliaNormalizeFontWeight(theme && theme.weight);
  return normalized == null ? fallback : normalized;
}

/* ---- 量字宽（classic 的逐词右边距要精确宽度，避免缩放/位移时重叠） ---- */
var foliaMeasureCanvas = null;
var foliaMeasureCache = new Map();
var FOLIA_MEASURE_CACHE_LIMIT = 2000;

function foliaMeasureWordWidth(text, pxSize, fontStack, fontWeight) {
  var s = String(text || '');
  var px = Math.round(Number(pxSize) * 2) / 2;
  var key = s + '|' + px + '|' + fontWeight + '|' + fontStack;
  var cached = foliaMeasureCache.get(key);
  if (cached != null) return cached;

  var width;
  try {
    if (!foliaMeasureCanvas) foliaMeasureCanvas = document.createElement('canvas');
    var context = foliaMeasureCanvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.font = fontWeight + ' ' + px + 'px ' + fontStack;
    width = context.measureText(s).width;
  } catch (_) {
    width = s.length * px * 0.65;
  }

  if (foliaMeasureCache.size > FOLIA_MEASURE_CACHE_LIMIT) foliaMeasureCache.clear();
  foliaMeasureCache.set(key, width);
  return width;
}

/* clamp(min, preferred, max) 字号串：classic 主字号 / 空状态字号用它。 */
function foliaClampFontSize(min, preferred, max, scale) {
  var s = (isFinite(Number(scale)) && Number(scale) > 0) ? Number(scale) : 1;
  return 'clamp(' + (min * s).toFixed(3) + 'rem, ' + (preferred * s).toFixed(3) + 'vw, ' + (max * s).toFixed(3) + 'rem)';
}

/* 底部字幕（译文 / 下一句预览）字号 —— Folia subtitleFontSizes.ts 的唯一来源。 */
function foliaResolveSubtitleFontSizes(scale) {
  var s = (isFinite(Number(scale)) && Number(scale) > 0) ? Number(scale) : 1;
  return {
    translationFontSize: 'clamp(' + (1.125 * s).toFixed(3) + 'rem, ' + (2.6 * s).toFixed(3) + 'vw, ' + (1.25 * s).toFixed(3) + 'rem)',
    upcomingFontSize: 'clamp(' + (0.875 * s).toFixed(3) + 'rem, ' + (2 * s).toFixed(3) + 'vw, ' + (1 * s).toFixed(3) + 'rem)'
  };
}

/* ---- 确定性散列 / 数值（Folia fumeMath.ts + visualizerSeedHash.ts） ---- */

/* FNV-1a 32 位字符串散列。版式种子、装饰种子全用它，保证同一首歌每次构图一样。 */
function foliaHashString(input) {
  var hash = 2166136261;
  var s = String(input == null ? '' : input);
  for (var i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* 字符串 → 0..1 确定性抖动（Folia seeded）。 */
function foliaSeeded(seed) {
  return (foliaHashString(seed) % 10000) / 10000;
}

/* ---- 数值种子两件套（Folia visualizerSeedHash.ts）----
 * sonnet / tempera / lumiere 的 MG 图库要靠「种子 + 盐」选出 geo 变体、HUD 变体、
 * fixedGeo 变体、decor 变体，还要按元素下标取 0..1 抖动。字符串散列不够用，
 * 所以把 Folia 的 mixVisualizerSeed / visualizerHash01 一并搬过来。
 * 三个函数必须与 Folia 逐字同构，否则同一首歌的构图会对不上。 */

/* 把数字种子与盐混合，让不同子系统（版式、装饰、逐字抖动）互不相关。 */
function foliaMixSeed(seed, salt) {
  return Math.imul((Math.trunc(Number(seed)) ^ salt) >>> 0, 2654435761) >>> 0;
}

/* 按元素下标取确定性的 0..1 抖动（seek 安全、重建稳定）。 */
function foliaHash01(seed, index, salt) {
  return foliaMixSeed(Number(seed) + Math.imul(Number(index) + 1, 97), salt) / 4294967296;
}

function foliaClamp(value, min, max) {
  var n = Number(value);
  if (!isFinite(n)) n = min;
  return Math.min(Math.max(n, min), max);
}

/* Folia textMeasureCache.ts：按插入顺序淘汰的有界缓存。 */
function foliaRememberBounded(cache, key, value, limit) {
  if (!cache.has(key) && cache.size >= limit) {
    var oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
}

/* Folia textMeasureCache.ts：整段前缀累计字素偏移。
 * offsets[i] = 前 i 个字素的推进宽度，offsets[0] = 0。
 * 每个前缀按整串测量（不是单字宽求和），跨字边的 kerning/shaping 才准确。 */
function foliaMeasurePrefixOffsets(graphemes, measurePrefix) {
  var offsets = new Array(graphemes.length + 1).fill(0);
  for (var count = 1; count <= graphemes.length; count++) {
    offsets[count] = measurePrefix(graphemes.slice(0, count).join(''), count, offsets[count - 1]);
  }
  return offsets;
}

/* Folia utils/fontStacks.ts 的 BUILTIN_FONT_STACKS（无自定义字体族时的回落栈）。 */
var FOLIA_BUILTIN_FONT_STACKS = {
  sans: '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Noto Serif CJK SC", "Noto Serif JP", "Source Han Serif SC", "Songti SC", "STSong", "Georgia", serif',
  mono: '"IBM Plex Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "SFMono-Regular", Consolas, monospace'
};

/* Folia resolveThemeFontStack：自定义族 + 内置回落栈。
 * 本项目的 theme.fontStack 已经是解析好的完整栈（00-folia-state 的 foliaWorldTheme），
 * 所以优先用它；只有它为空时才按 fontStyle 取内置栈。 */
function foliaResolveThemeFontStack(theme) {
  var stack = theme && theme.fontStack;
  if (stack && String(stack).trim()) return String(stack);
  var style = (theme && theme.fontStyle) || 'sans';
  return FOLIA_BUILTIN_FONT_STACKS[style] || FOLIA_BUILTIN_FONT_STACKS.sans;
}
