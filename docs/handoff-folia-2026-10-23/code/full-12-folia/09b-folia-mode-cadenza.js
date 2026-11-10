/* Folia 世界 — 歌词样式：心象（cadenza）
 *
 * 移植自 Folia src/components/visualizer/cadenza/（VisualizerCadenza 565 +
 * cadenzaEnvelopes 291 + cadenzaPlacements 361 + cadenzaFragments 216 +
 * cadenzaPreparedState 73 + cadenzaOverlayNodes 101 + cadenzaTypes 132）。
 *
 * 画面不是一行一行排，而是把一句歌词的**每个词**当成一个独立物件：先选字号、用 pretext
 * 测量换行，再把每个词切成片段、按「强调权重 + 避碰散射」摆到中线上下，逐词做
 * waiting → active → passed 三段状态机（模糊/旋转/漂移/辉光各有包络）。
 * 歌词本体走 DOM 叠层（outer 定位 + inner 位移 + body 正文 + 逐字 glow），
 * canvas 只负责副歌涟漪圆环与字形的 ascent 测量。
 *
 * 必须照抄的判据（改一处就整体走形）：
 *   - 字号 chooseFontPx = clamp(width*0.086, 34, 94) - 长度惩罚 - 密度惩罚，再 × fontScale
 *   - 换行宽度 maxWidth = clamp(min(width*widthRatio*0.92压缩, 820), minWidth, width-48)；
 *     字素 >12 个起按 0.018/字 压 wrapCompression，下限 0.62
 *   - 强调（hero）：语义权重（CJK 0.18 / 西文 min(字数*0.08, 0.36)）+ 居中偏移 *0.18 取最高分，
 *     emphasis = 1.46 * (1 + clamp(score-0.48, 0, 0.52))；hero 居中，其余词被推离它至少
 *     `hero宽*0.34 + 词宽*0.52 + padding*2`
 *   - 避碰散射：按半径 0→maxRadius 步进，每圈 8~N 个候选，评分 = 重叠面积*2.2 + 位移，
 *     取第一个不碰的点，全碰就用最优兜底
 *   - 三段状态 lookahead：normal 0.18 / fast 0.045 / instant 0；active 词放大 ×1.3 + 10Hz 脉冲
 *   - 平滑系数：transform 1-exp(-11dt)、视觉 1-exp(-14dt)、glow 1-exp(-16dt)
 *   - 行包络：normal 入场 0→1 / 0.9→1 / blur 10→0，preEnter = min(0.1, enter*0.35)
 *
 * 与 Folia 的实现差异（不改画面）：
 *   1) React + framer 的自绘 RAF 循环搬到主循环的 tick 里（dt 由 foliaWorld 统一给，
 *      同样 clamp 到 [1/240, 0.05]），帧内逻辑逐行照抄。
 *   2) audioPower：Folia 的 0~255（且做了 (x/255)^k 整形），本项目 audioEnergy 已是 0~1，
 *      所以直接 clamp 用，不再除 255。
 *   3) `activeLine.isChorus` 来自 Folia 的 TTML，本项目歌词没有这个字段 → 副歌涟漪不出现
 *      （代码保留，等 TTML 接入自动生效）。
 *
 * 依赖：@chenglou/pretext（只有 ESM）→ create 返回 Promise，等 import 完再建 DOM。
 */
'use strict';

(function registerFoliaCadenzaMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* Folia DEFAULT_CADENZA_TUNING。本项目暂无调参 UI，先写死，接面板时改成 fx 字段。 */
  var CADENZA_TUNING = {
    fontScale: 1.12,
    widthRatio: 0.72,
    motionAmount: 1,
    glowIntensity: 1,
    beamIntensity: 0
  };

  var ACTIVE_PULSE_FREQUENCY = 10;
  var STATUS_DRAW_ORDER = ['waiting', 'passed', 'active'];
  var WORD_COLLISION_MARGIN_CALM = 4;
  var WORD_COLLISION_MARGIN = 6;
  var EMPTY_FONT_MIN = 1.5;
  var EMPTY_FONT_VW = 3.5;
  var EMPTY_FONT_MAX = 2.25;
  var PREPARED_CACHE_LIMIT = 24;
  var CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

  /* ------------------------------------------------------------------ *
   * 包络（cadenzaEnvelopes.ts）
   * ------------------------------------------------------------------ */

  function cadenzaClamp(value, min, max) {
    return foliaClampNum(value, min, max);
  }

  function cadenzaMix(from, to, amount) {
    return from + (to - from) * amount;
  }

  function cadenzaEaseOutCubic(value) {
    return 1 - Math.pow(1 - cadenzaClamp(value, 0, 1), 3);
  }

  function cadenzaEaseInOutQuad(value) {
    var n = cadenzaClamp(value, 0, 1);
    return n < 0.5 ? 2 * n * n : 1 - Math.pow(-2 * n + 2, 2) / 2;
  }

  function cadenzaIsCJK(text) {
    return CJK_RE.test(String(text || ''));
  }

  /* 词的三种状态：active 的判定带 lookahead（提前亮），instant 模式整行共用结束时间。 */
  function cadenzaWordStatus(time, lineTiming, word) {
    var lookahead = lineTiming.wordRevealMode === 'fast'
      ? 0.045
      : lineTiming.wordRevealMode === 'instant'
        ? 0
        : 0.18;
    var activeEndTime = lineTiming.wordRevealMode === 'instant'
      ? lineTiming.lineRenderEndTime
      : word.endTime;

    if (time >= word.startTime - lookahead && time <= activeEndTime) return 'active';
    if (time > activeEndTime) return 'passed';
    return 'waiting';
  }

  function cadenzaWordProgress(time, wordRevealMode, word) {
    if (wordRevealMode === 'instant') return time < word.startTime ? 0 : 1;
    var minDuration = wordRevealMode === 'fast' ? 0.045 : 0.01;
    var duration = Math.max(word.endTime - word.startTime, minDuration);
    return cadenzaClamp((time - word.startTime) / duration, 0, 1);
  }

  /* 关键帧辉光：0.3 前升起、之后线性落，两端为 0（唱完立刻熄）。 */
  function cadenzaKeyframedGlow(progress) {
    if (progress <= 0 || progress >= 1) return 0;
    if (progress < 0.3) return cadenzaEaseOutCubic(progress / 0.3);
    return 1 - cadenzaClamp((progress - 0.3) / 0.7, 0, 1);
  }

  function cadenzaGlowEnvelope(time, lineTiming, word) {
    if (lineTiming.wordRevealMode === 'instant') {
      var activeEnd = lineTiming.lineRenderEndTime;
      if (time < word.startTime || time > activeEnd) return 0;
      return cadenzaKeyframedGlow(cadenzaClamp((time - word.startTime) / 0.067, 0, 1));
    }

    if (lineTiming.wordRevealMode === 'fast') {
      var fastDuration = Math.max(word.endTime - word.startTime, 0.045);
      if (time < word.startTime) return 0;
      if (time <= word.endTime) {
        var fastProgress = cadenzaClamp((time - word.startTime) / fastDuration, 0, 1);
        if (fastProgress < 0.14) return cadenzaEaseOutCubic(fastProgress / 0.14);
        if (fastProgress < 0.82) return 1;
        return cadenzaMix(1, 0.92, (fastProgress - 0.82) / 0.18);
      }
      var fastFade = cadenzaClamp((time - word.endTime) / 0.14, 0, 1);
      return Math.pow(1 - fastFade, 2);
    }

    var duration = Math.max(word.endTime - word.startTime, 0.1);
    if (time < word.startTime) return 0;
    if (time <= word.endTime) {
      var progress = cadenzaClamp((time - word.startTime) / duration, 0, 1);
      if (progress < 0.18) return cadenzaEaseOutCubic(progress / 0.18);
      if (progress < 0.9) return 1;
      return cadenzaMix(1, 0.9, (progress - 0.9) / 0.1);
    }
    var fadeOut = cadenzaClamp((time - word.endTime) / 0.9, 0, 1);
    return 0.9 * Math.pow(1 - fadeOut, 2);
  }

  /* 逐字辉光：每个字有自己的起跳时刻，动画时长 = 该字时长 *6。 */
  function cadenzaCharGlow(time, word, glyphIndex, glyphCount, wordGraphemeTimings) {
    var duration = Math.max(word.endTime - word.startTime, 0.1);
    var singleDuration = duration / Math.max(glyphCount, 1);
    var timing = wordGraphemeTimings && wordGraphemeTimings[glyphIndex];
    var charDuration = timing ? Math.max(timing.endTime - timing.startTime, 0.001) : singleDuration;
    var charStartTime = timing ? timing.startTime : (word.startTime + singleDuration * glyphIndex);
    var animationDuration = charDuration * 6;
    var elapsed = time - charStartTime;
    var activeGlow = elapsed <= 0 ? 0 : cadenzaKeyframedGlow(elapsed / animationDuration);
    if (time <= word.endTime) return activeGlow;
    var fadeOut = Math.pow(1 - cadenzaClamp((time - word.endTime) / 0.9, 0, 1), 2);
    return activeGlow * fadeOut;
  }

  /* 正文混色：0 = 主色（未亮），1 = 该词的高亮色（正在唱）。 */
  function cadenzaBodyMix(time, lineTiming, word) {
    if (lineTiming.wordRevealMode === 'instant') {
      if (time < word.startTime) return 0;
      return time <= lineTiming.lineRenderEndTime ? 1 : 0;
    }
    if (time < word.startTime) return 0;
    if (time <= word.endTime) return cadenzaWordProgress(time, lineTiming.wordRevealMode, word);
    var fadeOut = cadenzaClamp((time - word.endTime) / (lineTiming.wordRevealMode === 'fast' ? 0.12 : 0.8), 0, 1);
    return 1 - fadeOut;
  }

  /* 整行容器包络（opacity / scale / blur），对应 lineLayer 的样式。 */
  function cadenzaLineEnvelope(time, line, lineTiming) {
    if (!line) return { opacity: 1, scale: 1, blur: 0 };

    var renderHints = lineTiming.renderHints;
    var lineEndTime = lineTiming.lineRenderEndTime;
    var linePassStart = Math.max(lineTiming.lastWordEndTime, line.startTime) + lineTiming.linePassHold;

    if (renderHints && renderHints.lineTransitionMode === 'none') {
      return { opacity: 1, scale: 1, blur: 0 };
    }

    if (renderHints && renderHints.lineTransitionMode === 'fast') {
      var fastEnter = lineTiming.transitionTiming.enterDuration;
      var fastExit = lineTiming.transitionTiming.exitDuration;
      var fastExitStart = Math.max(line.startTime + fastEnter + 0.01, linePassStart, lineEndTime - fastExit);
      var fastEnterProgress = cadenzaEaseOutCubic(cadenzaClamp((time - line.startTime) / fastEnter, 0, 1));
      var opacity = cadenzaMix(0.65, 1, fastEnterProgress);
      var scale = cadenzaMix(0.97, 1, fastEnterProgress);
      var blur = cadenzaMix(4, 0, fastEnterProgress);

      var fastExitProgress = cadenzaEaseOutCubic(cadenzaClamp((time - fastExitStart) / fastExit, 0, 1));
      if (fastExitProgress > 0) {
        opacity = cadenzaMix(opacity, 0, fastExitProgress);
        scale = cadenzaMix(scale, 1.03, fastExitProgress);
        blur = Math.max(blur, cadenzaMix(0, 6, fastExitProgress));
      }
      return { opacity: cadenzaClamp(opacity, 0, 1), scale: scale, blur: blur };
    }

    var enterDuration = lineTiming.transitionTiming.enterDuration;
    var exitDuration = lineTiming.transitionTiming.exitDuration;
    var preEnter = Math.min(0.1, enterDuration * 0.35);

    var enterProgress = cadenzaEaseOutCubic(cadenzaClamp((time - (line.startTime - preEnter)) / (enterDuration + preEnter), 0, 1));
    var normalOpacity = cadenzaMix(0, 1, enterProgress);
    var normalScale = cadenzaMix(0.9, 1, enterProgress);
    var normalBlur = cadenzaMix(10, 0, enterProgress);

    var exitStart = Math.max(linePassStart, lineEndTime - exitDuration);
    var exitProgress = cadenzaEaseOutCubic(cadenzaClamp((time - exitStart) / exitDuration, 0, 1));
    if (exitProgress > 0) {
      normalOpacity *= 1 - exitProgress;
      normalScale = cadenzaMix(normalScale, 1.1, exitProgress);
      normalBlur = Math.max(normalBlur, cadenzaMix(0, 20, exitProgress));
    }

    return { opacity: cadenzaClamp(normalOpacity, 0, 1), scale: normalScale, blur: normalBlur };
  }

  /* 唱过之后往外飘的进度（0~1，5 秒走满）。 */
  function cadenzaPassedDrift(time, word) {
    if (time <= word.endTime) return 0;
    return cadenzaEaseInOutQuad(cadenzaClamp((time - word.endTime) / 5, 0, 1));
  }

  function cadenzaResolveLineRenderTiming(line) {
    var renderHints = foliaGetLineRenderHints(line);
    var wordRevealMode = (renderHints && renderHints.wordRevealMode) || 'normal';
    var lastWord = line.words && line.words.length ? line.words[line.words.length - 1] : null;
    var rawDuration = (renderHints && renderHints.rawDuration != null)
      ? renderHints.rawDuration
      : Math.max(line.endTime - line.startTime, 0);
    var transitionTiming = foliaGetLineTransitionTiming(
      rawDuration,
      (renderHints && renderHints.lineTransitionMode) || 'normal',
      wordRevealMode
    );

    return {
      renderHints: renderHints,
      lineRenderEndTime: renderHints ? renderHints.renderEndTime : line.endTime,
      wordRevealMode: wordRevealMode,
      lastWordEndTime: lastWord && isFinite(lastWord.endTime) ? lastWord.endTime : line.endTime,
      linePassHold: transitionTiming.linePassHold,
      transitionTiming: transitionTiming
    };
  }

  /* 三层叠辉光；intensity ≤ 0.01 直接 none（省掉一次字形缓存铸造）。 */
  function cadenzaDomTextShadow(color, intensity, blurScale) {
    var glow = cadenzaClamp(intensity, 0, 1.6);
    if (glow <= 0.01) return 'none';
    var scale = (isFinite(blurScale) && blurScale > 0) ? blurScale : 1;
    return [
      '0 0 ' + (40 * scale) + 'px ' + foliaColorWithAlpha(color, Math.min(0.98, glow)),
      '0 0 ' + (40 * scale) + 'px ' + foliaColorWithAlpha(color, Math.min(0.92, glow * 0.92)),
      '0 0 ' + (40 * scale) + 'px ' + foliaColorWithAlpha(color, Math.min(0.35, glow * 0.26))
    ].join(', ');
  }

  /* ------------------------------------------------------------------ *
   * 片段与落点（cadenzaFragments.ts + cadenzaPlacements.ts）
   * ------------------------------------------------------------------ */

  function cadenzaBuildSegmentMetas(prepared) {
    var segmentMetas = [];
    var graphemes = [];
    var graphemeCursor = 0;
    var segments = prepared.segments || [];
    for (var i = 0; i < segments.length; i++) {
      var segmentGraphemes = foliaSplitGraphemes(segments[i]);
      segmentMetas.push({
        graphemeStart: graphemeCursor,
        graphemeEnd: graphemeCursor + segmentGraphemes.length,
        graphemeCount: segmentGraphemes.length
      });
      for (var k = 0; k < segmentGraphemes.length; k++) graphemes.push(segmentGraphemes[k]);
      graphemeCursor += segmentGraphemes.length;
    }
    return { segmentMetas: segmentMetas, graphemes: graphemes };
  }

  /* 把歌词的词重新映射回 pretext 的字素流；匹配不上时退化成游标位置。 */
  function cadenzaFindWordRanges(line, graphemes, theme) {
    var ranges = [];
    var cursor = 0;
    var i, j;

    /* 纯行级 LRC（酷狗很多歌只给整行时间）没有 line.words：Folia 的解析器永远给逐词时间，
     * 上游用不到这一步，我们不行 —— 少了它 placements 恒为 0，心象整首歌一个字都不画
     * （画布透明、等待态又被 activeLine 关掉，画面全空）。按分词把整行时长均摊成词即可，
     * 词文本仍取自 fullText 的字素流，下面的重映射照样命中。 */
    var sourceWords = (line && line.words && line.words.length)
      ? line.words
      : foliaSynthesizeWordsForLine(line);

    for (var wordIndex = 0; wordIndex < sourceWords.length; wordIndex++) {
      var word = sourceWords[wordIndex];
      var target = foliaSplitGraphemes(word.text || '');
      var start = -1;

      for (i = cursor; i <= graphemes.length - target.length; i++) {
        var isMatch = true;
        for (j = 0; j < target.length; j++) {
          if (graphemes[i + j] !== target[j]) { isMatch = false; break; }
        }
        if (isMatch) { start = i; break; }
      }

      if (start === -1) start = cadenzaClamp(cursor, 0, graphemes.length);
      var end = cadenzaClamp(start + target.length, start, graphemes.length);

      ranges.push({
        wordIndex: wordIndex,
        word: word,
        start: start,
        end: end,
        color: foliaResolveWordColor(word.text, theme.wordColors, theme.accentColor),
        graphemeTimings: foliaBuildWordGraphemeTimings(word)
      });

      cursor = end;
    }
    return ranges;
  }

  function cadenzaCursorToGlobalOffset(cursor, segmentMetas) {
    if (!segmentMetas.length) return 0;
    var segment = segmentMetas[cursor.segmentIndex];
    if (!segment) return segmentMetas[segmentMetas.length - 1].graphemeEnd;
    return cadenzaClamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd);
  }

  function cadenzaGetPartialSegmentWidth(prepared, segmentIndex, segmentMeta, startOffset, endOffset) {
    var localStart = cadenzaClamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);
    var localEnd = cadenzaClamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);

    if (localEnd <= localStart) return 0;
    if (localStart === 0 && localEnd === segmentMeta.graphemeCount) return (prepared.widths[segmentIndex] || 0);

    var advances = prepared.breakableFitAdvances[segmentIndex];
    if (advances && advances.length > 0) {
      var width = 0;
      for (var i = localStart; i < localEnd; i++) width += (advances[i] || 0);
      return width;
    }

    var fullWidth = prepared.widths[segmentIndex] || 0;
    if (segmentMeta.graphemeCount === 0) return fullWidth;
    return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount);
  }

  function cadenzaWidthBetweenOffsets(prepared, segmentMetas, startOffset, endOffset) {
    if (endOffset <= startOffset) return 0;
    var width = 0;
    for (var segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex++) {
      var meta = segmentMetas[segmentIndex];
      if (endOffset <= meta.graphemeStart) break;
      if (startOffset >= meta.graphemeEnd) continue;
      var sliceStart = Math.max(startOffset, meta.graphemeStart);
      var sliceEnd = Math.min(endOffset, meta.graphemeEnd);
      width += cadenzaGetPartialSegmentWidth(prepared, segmentIndex, meta, sliceStart, sliceEnd);
    }
    return width;
  }

  /* 换行会把一个词切成两半；片段按「所在布局行 × 词」生成，同词的多个片段后置标记。 */
  function cadenzaBuildLineFragments(prepared, segmentMetas, graphemes, layout, ranges) {
    var lineViews = (layout.lines || []).map(function (line) {
      var lineStart = cadenzaCursorToGlobalOffset(line.start, segmentMetas);
      var lineEnd = cadenzaCursorToGlobalOffset(line.end, segmentMetas);

      var fragments = [];
      ranges.forEach(function (range) {
        if (range.end <= lineStart || range.start >= lineEnd) return;
        var fragmentStart = Math.max(range.start, lineStart);
        var fragmentEnd = Math.min(range.end, lineEnd);
        fragments.push({
          wordIndex: range.wordIndex,
          lineIndex: 0,
          word: range.word,
          text: graphemes.slice(fragmentStart, fragmentEnd).join(''),
          color: range.color,
          startX: cadenzaWidthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentStart),
          endX: cadenzaWidthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentEnd),
          fragmentStartInWord: fragmentStart - range.start,
          fragmentEndInWord: fragmentEnd - range.start,
          wordGraphemeCount: Math.max(range.end - range.start, 1),
          wordGraphemeTimings: range.graphemeTimings,
          fragmentIndexInWord: 0,
          fragmentCountInWord: 1,
          isPrimaryFragment: true,
          isSplitAcrossLines: false
        });
      });

      return { line: line, lineStart: lineStart, lineEnd: lineEnd, fragments: fragments };
    });

    var fragmentCountByWord = new Map();
    lineViews.forEach(function (lineView) {
      lineView.fragments.forEach(function (fragment) {
        fragmentCountByWord.set(
          fragment.wordIndex,
          (fragmentCountByWord.get(fragment.wordIndex) || 0) + 1
        );
      });
    });

    var seenFragmentsByWord = new Map();
    return lineViews.map(function (lineView, lineIndex) {
      var nextFragments = lineView.fragments.map(function (fragment) {
        var fragmentCountInWord = fragmentCountByWord.get(fragment.wordIndex) || 1;
        var fragmentIndexInWord = seenFragmentsByWord.get(fragment.wordIndex) || 0;
        seenFragmentsByWord.set(fragment.wordIndex, fragmentIndexInWord + 1);
        return {
          wordIndex: fragment.wordIndex,
          lineIndex: lineIndex,
          word: fragment.word,
          text: fragment.text,
          color: fragment.color,
          startX: fragment.startX,
          endX: fragment.endX,
          fragmentStartInWord: fragment.fragmentStartInWord,
          fragmentEndInWord: fragment.fragmentEndInWord,
          wordGraphemeCount: fragment.wordGraphemeCount,
          wordGraphemeTimings: fragment.wordGraphemeTimings,
          fragmentIndexInWord: fragmentIndexInWord,
          fragmentCountInWord: fragmentCountInWord,
          isPrimaryFragment: fragmentIndexInWord === 0,
          isSplitAcrossLines: fragmentCountInWord > 1
        };
      });
      return {
        line: lineView.line,
        lineStart: lineView.lineStart,
        lineEnd: lineView.lineEnd,
        fragments: nextFragments
      };
    });
  }

  /* 强调图：只有一个 hero，跨行拆开的词不当候选（否则两半会叠在一起）。 */
  function cadenzaBuildEmphasisMap(lineData, isInterlude) {
    var emphasisMap = new Map();
    if (isInterlude) return emphasisMap;

    var primaryFragments = [];
    lineData.forEach(function (lineView) {
      lineView.fragments.forEach(function (fragment) {
        if (fragment.isPrimaryFragment) primaryFragments.push(fragment);
      });
    });

    var candidates = [];
    primaryFragments.forEach(function (fragment) {
      if (fragment.isSplitAcrossLines) return;
      if (!fragment.text.trim().length) return;
      var graphemeCount = Math.max(fragment.wordGraphemeCount, foliaSplitGraphemes(fragment.word.text).length, 1);
      var semanticWeight = cadenzaIsCJK(fragment.word.text) ? 0.18 : Math.min(graphemeCount * 0.08, 0.36);
      var centerBias = 1 - Math.abs(fragment.wordIndex - (primaryFragments.length - 1) / 2) / Math.max(primaryFragments.length, 1);
      candidates.push({
        fragment: fragment,
        score: semanticWeight + centerBias * 0.18
      });
    });
    candidates.sort(function (a, b) { return b.score - a.score; });

    var hero = candidates[0];
    if (hero) {
      var scoreBoost = 1 + cadenzaClamp(hero.score - 0.48, 0, 0.52);
      emphasisMap.set(hero.fragment.wordIndex, 1.46 * scoreBoost);
    }
    return emphasisMap;
  }

  /* 片段 → 落点：hero 居中、其余按圆环候选点避碰散射，全部由行种子决定。 */
  function cadenzaBuildWordPlacements(lineData, fontPx, lineHeight, maxWidth, animationIntensity, seed, isInterlude) {
    var totalHeight = Math.max(lineData.length, 1) * lineHeight;
    var baseMargin = animationIntensity === 'calm' ? WORD_COLLISION_MARGIN_CALM : WORD_COLLISION_MARGIN;
    var baseScale = animationIntensity === 'chaotic'
      ? 1.02
      : animationIntensity === 'calm'
        ? 1
        : 1.01;
    var emphasisMap = cadenzaBuildEmphasisMap(lineData, isInterlude);
    var heroWordIndex = null;
    var heroScore = -Infinity;
    emphasisMap.forEach(function (value, key) {
      if (value > heroScore) { heroScore = value; heroWordIndex = key; }
    });

    var placements = [];
    var occupiedRects = [];
    var occupiedBands = new Map();
    var occupiedMarks = [];
    var occupiedQueryStamp = 0;
    var collisionBandSize = Math.max(24, Math.round(lineHeight * 0.9));

    function getBandIndex(value) { return Math.floor(value / collisionBandSize); }

    function registerOccupiedRect(rect) {
      var rectIndex = occupiedRects.length;
      occupiedRects.push(rect);
      var startBand = getBandIndex(rect.top);
      var endBand = getBandIndex(rect.bottom);
      for (var band = startBand; band <= endBand; band++) {
        var bucket = occupiedBands.get(band);
        if (bucket) bucket.push(rectIndex);
        else occupiedBands.set(band, [rectIndex]);
      }
    }

    function evaluateCollisionRect(left, top, right, bottom) {
      if (!occupiedRects.length) return { intersects: false, overlapArea: 0 };

      occupiedQueryStamp += 1;
      var stamp = occupiedQueryStamp;
      var startBand = getBandIndex(top);
      var endBand = getBandIndex(bottom);
      var intersects = false;
      var overlapArea = 0;

      for (var band = startBand; band <= endBand; band++) {
        var bucket = occupiedBands.get(band);
        if (!bucket) continue;
        for (var bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
          var rectIndex = bucket[bucketIndex];
          if (occupiedMarks[rectIndex] === stamp) continue;
          occupiedMarks[rectIndex] = stamp;
          var rect = occupiedRects[rectIndex];
          var overlapWidth = Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left));
          var overlapHeight = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top));
          if (overlapWidth <= 0 || overlapHeight <= 0) continue;
          intersects = true;
          overlapArea += overlapWidth * overlapHeight;
        }
      }
      return { intersects: intersects, overlapArea: overlapArea };
    }

    function pushPlacementRect(left, top, width, height, padding) {
      registerOccupiedRect({
        left: left - padding,
        top: top - height - padding,
        right: left + width + padding,
        bottom: top + padding
      });
    }

    var placementPlans = [];
    lineData.forEach(function (lineView, lineIndex) {
      var lineLeft = -lineView.line.width / 2;
      var baselineY = -totalHeight / 2 + fontPx + lineIndex * lineHeight;

      lineView.fragments.forEach(function (fragment, fragmentIndex) {
        var emphasis = emphasisMap.get(fragment.wordIndex) || 1;
        var width = Math.max(fragment.endX - fragment.startX, fontPx * 0.18);
        var scale = emphasis > 1 ? baseScale * emphasis : baseScale;
        var height = fontPx * scale * 0.95;

        placementPlans.push({
          fragment: fragment,
          lineIndex: lineIndex,
          fragmentIndex: fragmentIndex,
          baseX: lineLeft + fragment.startX,
          baseY: baselineY,
          emphasis: emphasis,
          width: width,
          height: height,
          scale: scale,
          collisionWidth: width * scale * (emphasis > 1 ? 1.48 : 1.26),
          collisionHeight: height * (emphasis > 1 ? 1.36 : 1.24),
          padding: baseMargin + (emphasis > 1 ? 10 : 2)
        });
      });
    });

    /* 强调大的先挑位置（hero 优先占中央），再按行序/横向次序。 */
    placementPlans.sort(function (a, b) {
      var emphasisDelta = b.emphasis - a.emphasis;
      if (Math.abs(emphasisDelta) > 0.001) return emphasisDelta;
      if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
      return a.fragment.startX - b.fragment.startX;
    });

    var primaryPlanByWordIndex = new Map();
    placementPlans.forEach(function (plan) {
      if (!primaryPlanByWordIndex.has(plan.fragment.wordIndex)) {
        primaryPlanByWordIndex.set(plan.fragment.wordIndex, plan);
      }
    });
    var heroPlan = heroWordIndex === null ? null : (primaryPlanByWordIndex.get(heroWordIndex) || null);
    var heroMetrics = heroPlan
      ? {
        centerX: (heroPlan.width * heroPlan.scale) / 2,
        centerY: -heroPlan.height * 0.46,
        width: heroPlan.width * heroPlan.scale
      }
      : null;

    placementPlans.forEach(function (plan) {
      var fragment = plan.fragment;
      var lineIndex = plan.lineIndex;
      var fragmentIndex = plan.fragmentIndex;
      var emphasis = plan.emphasis;
      var width = plan.width;
      var height = plan.height;
      var scale = plan.scale;
      var collisionWidth = plan.collisionWidth;
      var collisionHeight = plan.collisionHeight;
      var padding = plan.padding;

      var wordSeed = seed + fragment.wordIndex * 17 + lineIndex * 31 + fragmentIndex * 13;
      var random = function (offset) {
        var x = Math.sin(wordSeed + offset) * 10000;
        return x - Math.floor(x);
      };
      var passedRotate = (random(3) - 0.5) * (animationIntensity === 'chaotic' ? 20 : 12);
      var step = Math.max(10, Math.round(fontPx * 0.14));
      var maxRadius = emphasis > 1
        ? Math.max(20, lineHeight * 0.5)
        : Math.max(lineHeight * 2.2, collisionWidth * 0.75, 56);
      var preferredX = emphasis > 1 ? -width / 2 : plan.baseX;
      var preferredY = emphasis > 1 ? 0 : plan.baseY;

      /* 非 hero 词先被推离 hero 一段最小间距，再进避碰循环 */
      if (!isInterlude && emphasis <= 1 && heroMetrics) {
        var wordCenterX = preferredX + width / 2;
        var wordCenterY = preferredY - height * 0.46;
        var dx = wordCenterX - heroMetrics.centerX;
        var dy = wordCenterY - heroMetrics.centerY;
        var distance = Math.hypot(dx, dy);
        if (distance < 1) {
          dx = preferredX >= 0 ? 1 : -1;
          dy = lineIndex % 2 === 0 ? -0.65 : 0.65;
        }
        var minHeroSeparation = heroMetrics.width * 0.34 + width * 0.52 + padding * 2;
        if (distance < minHeroSeparation) {
          var normalizedDistance = Math.max(Math.hypot(dx, dy), 1);
          var ux = dx / normalizedDistance;
          var uy = dy / normalizedDistance;
          var push = minHeroSeparation - distance;
          preferredX += ux * push;
          preferredY += uy * push * 0.92;
        }
      }

      var horizontalMin = (-maxWidth / 2) - 72;
      var horizontalMax = (maxWidth / 2) + 72;
      var verticalMin = -Math.max(totalHeight * 0.9, lineHeight * 1.6);
      var verticalMax = Math.max(totalHeight * 0.9, lineHeight * 1.45);
      var chosenX = preferredX;
      var chosenY = preferredY;
      var found = false;
      var bestFallback = { x: preferredX, y: preferredY, score: Number.POSITIVE_INFINITY };
      var baseAngle = (heroMetrics && emphasis <= 1)
        ? Math.atan2(preferredY, preferredX + width / 2)
        : 0;

      for (var radius = 0; radius <= maxRadius && !found; radius += step) {
        var sampleCount = radius === 0
          ? 1
          : emphasis > 1
            ? 8
            : Math.max(12, Math.round((Math.PI * 2 * radius) / Math.max(step * 1.1, 10)));
        var candidates = [];
        var sampleIndex;
        if (radius === 0) {
          candidates.push([0, 0]);
        } else {
          for (sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
            var angle = baseAngle + (sampleIndex / sampleCount) * Math.PI * 2;
            var ellipseY = radius * (emphasis > 1 ? 0.8 : 0.92);
            candidates.push([Math.cos(angle) * radius, Math.sin(angle) * ellipseY]);
          }
        }

        for (var ci = 0; ci < candidates.length; ci++) {
          var dx2 = candidates[ci][0];
          var dy2 = candidates[ci][1];
          var left = preferredX + dx2 - padding;
          var top = preferredY + dy2 - collisionHeight - padding;
          var right = left + collisionWidth + padding * 2;
          var bottom = top + collisionHeight + padding * 2;
          var withinBounds = left >= horizontalMin
            && right <= horizontalMax
            && top >= verticalMin
            && bottom <= verticalMax;
          if (!withinBounds) continue;

          var collision = evaluateCollisionRect(left, top, right, bottom);
          var travel = Math.hypot(dx2, dy2);
          var score2 = collision.overlapArea * 2.2 + travel;
          if (score2 < bestFallback.score) {
            bestFallback = { x: preferredX + dx2, y: preferredY + dy2, score: score2 };
          }
          if (!collision.intersects) {
            chosenX = preferredX + dx2;
            chosenY = preferredY + dy2;
            pushPlacementRect(chosenX, chosenY, collisionWidth, collisionHeight, padding);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        chosenX = bestFallback.x;
        chosenY = bestFallback.y;
        pushPlacementRect(chosenX, chosenY, collisionWidth, collisionHeight, padding);
      }

      /* passed 漂移方向 = 从画面中心指向该词 */
      var outwardX = chosenX + width / 2;
      var outwardY = chosenY - height * 0.46;
      var outwardLength = Math.max(Math.hypot(outwardX, outwardY), 1);
      var outwardUnitX = outwardX / outwardLength;
      var outwardUnitY = outwardY / outwardLength;
      var driftAmount = isInterlude
        ? 3 + random(6) * 3
        : emphasis > 1
          ? 4 + random(6) * 4
          : animationIntensity === 'chaotic'
            ? 8 + random(6) * 9
            : 5 + random(6) * 6;

      placements.push({
        id: fragment.word.text + '-' + fragment.wordIndex + '-' + lineIndex + '-' + fragmentIndex + '-' + fragment.fragmentIndexInWord,
        wordIndex: fragment.wordIndex,
        word: fragment.word,
        text: fragment.text,
        color: fragment.color,
        x: chosenX,
        y: chosenY,
        width: width,
        height: height,
        rotate: 0,
        scale: scale,
        passedRotate: passedRotate,
        passedDriftX: outwardUnitX * driftAmount + (random(7) - 0.5) * 2.4,
        passedDriftY: outwardUnitY * driftAmount * 0.72 + (random(8) - 0.5) * 2,
        entryOffsetX: 0,
        entryOffsetY: 0,
        fragmentStartInWord: fragment.fragmentStartInWord,
        fragmentEndInWord: fragment.fragmentEndInWord,
        wordGraphemeCount: fragment.wordGraphemeCount,
        wordGraphemeTimings: fragment.wordGraphemeTimings,
        emphasis: emphasis,
        isInterlude: isInterlude
      });
    });

    return placements;
  }

  /* ------------------------------------------------------------------ *
   * 准备态（cadenzaPreparedState.ts）
   * ------------------------------------------------------------------ */

  function cadenzaChooseFontPx(width, line) {
    var graphemeCount = foliaSplitGraphemes(line.fullText).length || 1;
    var wordCount = (line.words && line.words.length) || 1;
    var widthBase = cadenzaClamp(width * 0.086, 34, 94);
    var lengthPenalty = graphemeCount > 12 ? Math.min((graphemeCount - 12) * 1.8, 34) : 0;
    var densityPenalty = wordCount > 7 ? Math.min((wordCount - 7) * 1.5, 18) : 0;
    return cadenzaClamp(widthBase - lengthPenalty - densityPenalty, 28, 104);
  }

  function cadenzaBuildPreparedState(inst, line, ctx) {
    var theme = ctx.theme;
    var width = inst.viewportWidth;
    var height = inst.viewportHeight;
    if (!ctx.showText || width <= 0 || height <= 0) return null;

    var fontPx = cadenzaClamp(cadenzaChooseFontPx(width, line) * CADENZA_TUNING.fontScale, 24, 132);
    var font = foliaResolveThemeFontWeight(theme, 700) + ' ' + fontPx + 'px ' + theme.fontStack;
    var prepared = inst.pretext.prepareWithSegments(line.fullText, font);
    var text = (prepared.segments || []).join('');
    var built = cadenzaBuildSegmentMetas(prepared);
    var segmentMetas = built.segmentMetas;
    var graphemes = built.graphemes;
    var lineHeight = Math.round(fontPx * (cadenzaIsCJK(text) ? 1.22 : 1.1));
    var availableWidth = Math.max(width - 48, 120);
    var minWidth = Math.min(220, availableWidth);
    var wrapCompression = graphemes.length > 12
      ? cadenzaClamp(0.92 - (graphemes.length - 12) * 0.018, 0.62, 0.92)
      : 0.92;
    var compactWidthRatio = CADENZA_TUNING.widthRatio * wrapCompression;
    var maxWidth = cadenzaClamp(Math.min(width * compactWidthRatio, 820), minWidth, availableWidth);
    var layout = inst.pretext.layoutWithLines(prepared, maxWidth, lineHeight);
    var ranges = cadenzaFindWordRanges(line, graphemes, theme);
    var lineFragments = cadenzaBuildLineFragments(prepared, segmentMetas, graphemes, layout, ranges);
    var placements = cadenzaBuildWordPlacements(
      lineFragments,
      fontPx,
      lineHeight,
      maxWidth,
      theme.animationIntensity,
      line.startTime * 1000,
      line.fullText === '......'
    );

    return {
      prepared: prepared,
      text: text,
      font: font,
      fontPx: fontPx,
      lineHeight: lineHeight,
      maxWidth: maxWidth,
      layout: layout,
      segmentMetas: segmentMetas,
      graphemes: graphemes,
      placements: placements
    };
  }

  function cadenzaPreparedCacheKey(line) {
    return [
      line.startTime, line.endTime, line.fullText,
      line.words ? line.words.length : 0
    ].join('|');
  }

  function cadenzaContextKey(inst, ctx) {
    var theme = ctx.theme;
    var wordColors = theme.wordColors || [];
    var signature = '';
    for (var i = 0; i < wordColors.length; i++) {
      var entry = wordColors[i] || {};
      signature += (typeof entry.word === 'string' ? entry.word : '') + ':' +
        (typeof entry.color === 'string' ? entry.color : '') + '||';
    }
    return [
      ctx.showText ? '1' : '0',
      inst.viewportWidth,
      inst.viewportHeight,
      theme.fontStack,
      theme.weight,
      theme.animationIntensity,
      theme.accentColor,
      CADENZA_TUNING.fontScale,
      CADENZA_TUNING.widthRatio,
      signature
    ].join('|');
  }

  /* Folia getUpcomingLine：有当前行就是下一行；还没有当前行就是「第一个还没到点的行」。
   * （同名逻辑在 cappella 里那份是 IIFE 私有的，这里自带一份，避免跨模块私有符号。） */
  function cadenzaUpcomingLine(lines, currentIndex, currentTime) {
    if (currentIndex >= 0 && lines[currentIndex]) return lines[currentIndex + 1] || null;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startTime > currentTime) return lines[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * DOM 叠层节点（cadenzaOverlayNodes.ts）
   * ------------------------------------------------------------------ */

  function cadenzaCreateOverlayWordNodes() {
    var outer = document.createElement('div');
    outer.className = 'folia-cadenza-word';
    outer.setAttribute('aria-hidden', 'true');
    outer.style.transformOrigin = '0 0';

    var inner = document.createElement('div');
    inner.className = 'folia-cadenza-word-inner';

    var body = document.createElement('span');
    body.className = 'folia-cadenza-word-body';

    var glow = document.createElement('span');
    glow.className = 'folia-cadenza-word-glow';

    inner.appendChild(body);
    inner.appendChild(glow);
    outer.appendChild(inner);

    return {
      outer: outer,
      inner: inner,
      body: body,
      glow: glow,
      glyphSpans: [],
      glyphSignature: '',
      written: null,
      glyphShadows: [],
      frame: -1
    };
  }

  /* 只写变过的值：textContent 即使字符串相同也会换文本节点，而 font/text 是重排的主因。
   * emphasis 是落点的静态属性（hero 1.46 / 其余 1），写成 data 探针供回归读取。 */
  function cadenzaWriteOverlayWord(nodes, next) {
    var written = nodes.written;
    if (!written || written.outerTransform !== next.outerTransform) nodes.outer.style.transform = next.outerTransform;
    if (!written || written.willChange !== next.willChange) nodes.outer.style.willChange = next.willChange;
    if (!written || written.font !== next.font) nodes.inner.style.font = next.font;
    if (!written || written.innerTransform !== next.innerTransform) nodes.inner.style.transform = next.innerTransform;
    if (!written || written.text !== next.text) nodes.body.textContent = next.text;
    if (!written || written.color !== next.color) nodes.body.style.color = next.color;
    if (!written || written.opacity !== next.opacity) nodes.body.style.opacity = next.opacity;
    if (!written || written.filter !== next.filter) nodes.body.style.filter = next.filter;
    if (!written || written.emphasis !== next.emphasis) {
      nodes.outer.setAttribute('data-folia-cadenza-emphasis', String(next.emphasis));
    }
    nodes.written = next;
  }

  function cadenzaWriteOverlayGlyphShadow(nodes, index, shadow) {
    if (nodes.glyphShadows[index] === shadow) return;
    nodes.glyphShadows[index] = shadow;
    if (nodes.glyphSpans[index]) nodes.glyphSpans[index].style.textShadow = shadow;
  }

  function cadenzaSyncOverlayGlyphSpans(nodes, texts) {
    var glyphSignature = texts.join('\u0001');
    if (nodes.glyphSignature === glyphSignature) return;

    while (nodes.glow.firstChild) nodes.glow.removeChild(nodes.glow.firstChild);
    nodes.glyphSpans = texts.map(function (text) {
      var span = document.createElement('span');
      span.textContent = text;
      nodes.glow.appendChild(span);
      return span;
    });
    nodes.glyphShadows = [];
    nodes.glyphSignature = glyphSignature;
  }

  function cadenzaClearOverlayWordNodes(overlayNodes) {
    overlayNodes.forEach(function (nodes) {
      if (nodes.outer && nodes.outer.parentNode) nodes.outer.parentNode.removeChild(nodes.outer);
    });
    overlayNodes.clear();
  }

  /* ------------------------------------------------------------------ *
   * 模式注册
   * ------------------------------------------------------------------ */
  registerFoliaMode('cadenza', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerCadenza = 心象，entry.tsx order 40。 */
    name: '心象',
    desc: '整句拆成单字散落画面，像脑海里浮起的碎片',
    order: 40,

    create: function (host, ctx) {
      return foliaLoadPretext().then(function (pretext) {
        var root = document.createElement('div');
        root.className = 'folia-cadenza';

        var lineLayer = document.createElement('div');
        lineLayer.className = 'folia-cadenza-layer';

        var overlay = document.createElement('div');
        overlay.className = 'folia-cadenza-overlay';

        var canvas = document.createElement('canvas');
        canvas.className = 'folia-cadenza-canvas';

        lineLayer.appendChild(overlay);
        lineLayer.appendChild(canvas);
        root.appendChild(lineLayer);

        var waiting = document.createElement('div');
        waiting.className = 'folia-cadenza-waiting';
        waiting.style.color = ctx.theme.secondaryColor;
        waiting.style.fontFamily = ctx.theme.fontStack;
        waiting.style.fontSize = foliaClampFontSize(EMPTY_FONT_MIN, EMPTY_FONT_VW, EMPTY_FONT_MAX, ctx.fontScale || 1);
        waiting.textContent = '等待播放';
        root.appendChild(waiting);

        host.appendChild(root);

        var inst = {
          pretext: pretext,
          root: root,
          lineLayer: lineLayer,
          overlay: overlay,
          canvas: canvas,
          textContext: null,
          waiting: waiting,
          overlayNodes: new Map(),
          animatedStates: new Map(),
          preparedCache: new Map(),
          preparedCacheKey: '',
          preparedState: null,
          preparedLineKey: '',
          glyphCache: new Map(),
          lastFrameTime: null,
          viewportWidth: window.innerWidth || 1280,
          viewportHeight: window.innerHeight || 900,
          subtitle: foliaCreateSubtitleOverlay(host, ctx.theme, foliaResolveSubtitleFontSizes(ctx.fontScale || 1))
        };
        try {
          inst.textContext = canvas.getContext('2d');
        } catch (_) {
          inst.textContext = null;
        }

        /* 字体加载完成会改变 ascent → 丢掉缓存，下一帧重量 */
        var fontSet = (typeof document !== 'undefined' && document.fonts) ? document.fonts : null;
        var forgetAscents = function () {
          inst.glyphCache.forEach(function (entry) { entry.ascent = undefined; });
        };
        if (fontSet && fontSet.addEventListener) {
          fontSet.addEventListener('loadingdone', forgetAscents);
          inst.fontSet = fontSet;
          inst.forgetAscents = forgetAscents;
        }

        root.setAttribute('data-folia-cadenza-placements', '0');
        return inst;
      });
    },

    tick: function (inst, ctx) {
      if (!inst || !inst.root) return;

      var width = window.innerWidth || 1280;
      var height = window.innerHeight || 900;
      if (width !== inst.viewportWidth || height !== inst.viewportHeight) {
        inst.viewportWidth = width;
        inst.viewportHeight = height;
      }

      var dt = 1 / 60;
      if (isFinite(ctx.dt) && ctx.dt > 0) dt = cadenzaClamp(ctx.dt, 1 / 240, 0.05);

      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
      var canvasWidth = Math.max(Math.floor(width), 1);
      var canvasHeight = Math.max(Math.floor(height), 1);
      if (inst.canvas.width !== Math.floor(canvasWidth * dpr) || inst.canvas.height !== Math.floor(canvasHeight * dpr)) {
        inst.canvas.width = Math.floor(canvasWidth * dpr);
        inst.canvas.height = Math.floor(canvasHeight * dpr);
        inst.canvas.style.width = canvasWidth + 'px';
        inst.canvas.style.height = canvasHeight + 'px';
      }

      var textContext = inst.textContext;
      if (!textContext) {
        inst.subtitle.update(ctx, ctx.dt);
        return;
      }
      textContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      textContext.clearRect(0, 0, canvasWidth, canvasHeight);

      var activeLine = ctx.index >= 0 ? ctx.lines[ctx.index] : null;

      /* 准备态缓存：上下文（视口/主题/调参）变了就整表作废 */
      var contextKey = cadenzaContextKey(inst, ctx);
      if (contextKey !== inst.preparedCacheKey) {
        inst.preparedCache.clear();
        inst.preparedCacheKey = contextKey;
      }

      var lineKey = activeLine ? cadenzaPreparedCacheKey(activeLine) : '';
      if (lineKey !== inst.preparedLineKey) {
        inst.preparedLineKey = lineKey;
        var nextState = null;
        if (lineKey) {
          nextState = inst.preparedCache.get(lineKey) || null;
          if (!nextState) {
            nextState = cadenzaBuildPreparedState(inst, activeLine, ctx);
            if (nextState) inst.preparedCache.set(lineKey, nextState);
          }
        }
        inst.preparedState = nextState;
        /* 换行：落点字形缓存与动画态全部作废（ascent 下一帧重量） */
        inst.glyphCache.clear();
        if (!nextState) inst.animatedStates.clear();
      }

      /* 预热下一行（Folia 的 prepareActiveAndUpcoming 的副作用） */
      var upcoming = cadenzaUpcomingLine(ctx.lines, ctx.index, ctx.time);
      if (upcoming) {
        var upcomingKey = cadenzaPreparedCacheKey(upcoming);
        if (!inst.preparedCache.has(upcomingKey)) {
          var upcomingState = cadenzaBuildPreparedState(inst, upcoming, ctx);
          if (upcomingState) inst.preparedCache.set(upcomingKey, upcomingState);
          if (inst.preparedCache.size > PREPARED_CACHE_LIMIT) {
            var oldest = inst.preparedCache.keys().next();
            if (!oldest.done) inst.preparedCache.delete(oldest.value);
          }
        }
      }

      var preparedState = inst.preparedState;
      if (!ctx.showText || !preparedState || !activeLine) {
        inst.lineLayer.style.opacity = '0';
        inst.lineLayer.style.filter = 'none';
        inst.lineLayer.style.transform = 'scale(1)';
        inst.lineLayer.style.perspective = '1000px';
        cadenzaClearOverlayWordNodes(inst.overlayNodes);
        /* 与 Folia 一致：没有当前行（前奏/间奏/播完）才显示等待态 */
        inst.waiting.style.display = (!activeLine && ctx.showText) ? '' : 'none';
        inst.subtitle.update(ctx, ctx.dt);
        return;
      }

      inst.waiting.style.display = 'none';

      var theme = ctx.theme;
      var time = ctx.time;
      var lineTiming = cadenzaResolveLineRenderTiming(activeLine);
      var lineEnvelope = cadenzaLineEnvelope(time, activeLine, lineTiming);
      var wordRevealMode = lineTiming.wordRevealMode;
      var isInstantWordReveal = wordRevealMode === 'instant';
      var lineSeed = Math.abs(Math.sin(activeLine.startTime * 997.1));
      var linePerspective = theme.animationIntensity === 'chaotic' ? 500 + Math.round(lineSeed * 500) : 1000;
      var energy = cadenzaClamp(ctx.audio && isFinite(ctx.audio.power) ? ctx.audio.power : 0, 0, 1);
      var motionEnergy = energy * CADENZA_TUNING.motionAmount;
      var verticalLift = Math.sin(time * 2.3) * (3 + motionEnergy * 8);
      var focusY = height * 0.42 + verticalLift;

      inst.lineLayer.style.opacity = lineEnvelope.opacity.toFixed(4);
      inst.lineLayer.style.filter = lineEnvelope.blur > 0.05 ? 'blur(' + lineEnvelope.blur.toFixed(2) + 'px)' : 'none';
      inst.lineLayer.style.transform = 'scale(' + lineEnvelope.scale.toFixed(4) + ')';
      inst.lineLayer.style.perspective = linePerspective + 'px';

      textContext.font = preparedState.font;
      textContext.textBaseline = 'alphabetic';
      textContext.lineJoin = 'round';
      textContext.lineCap = 'round';

      var byStatus = { waiting: [], passed: [], active: [] };
      byStatus.waiting.length = 0;
      byStatus.passed.length = 0;
      byStatus.active.length = 0;
      for (var pi = 0; pi < preparedState.placements.length; pi++) {
        var placement = preparedState.placements[pi];
        byStatus[cadenzaWordStatus(time, lineTiming, placement.word)].push(placement);
      }

      var overlayNodes = inst.overlayNodes;
      var stateMap = inst.animatedStates;
      var frameNumber = (inst.frameNumber || 0) + 1;
      inst.frameNumber = frameNumber;

      var transformTransitionAmount = 1 - Math.exp(-11 * dt);
      var visualTransitionAmount = 1 - Math.exp(-14 * dt);
      var glowTransitionAmount = 1 - Math.exp(-16 * dt);

      var placementIndex = -1;
      var statusOrderIndex;
      var bucketIndex;

      for (statusOrderIndex = 0; statusOrderIndex < STATUS_DRAW_ORDER.length; statusOrderIndex++) {
        var status = STATUS_DRAW_ORDER[statusOrderIndex];
        var bucket = byStatus[status];
        for (bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
          var item = bucket[bucketIndex];
          placementIndex += 1;
          var progress = cadenzaWordProgress(time, wordRevealMode, item.word);
          var passedAlpha = isInstantWordReveal
            ? 0
            : theme.animationIntensity === 'chaotic'
              ? 0.9
              : 0.82;
          var pulse = (status === 'active' && !isInstantWordReveal)
            ? 1 + Math.sin(time * ACTIVE_PULSE_FREQUENCY + item.word.startTime * 5) * 0.04 * CADENZA_TUNING.motionAmount
            : 1;
          var passedDriftProgress = isInstantWordReveal ? 0 : cadenzaPassedDrift(time, item.word);

          var targetScale;
          if (status === 'waiting') {
            targetScale = isInstantWordReveal ? item.scale : Math.max(item.scale * 0.5, 0.5);
          } else if (status === 'active') {
            targetScale = isInstantWordReveal ? item.scale : item.scale * 1.3 * pulse;
          } else {
            targetScale = item.scale;
          }

          var targetRotation;
          if (status === 'waiting') {
            targetRotation = isInstantWordReveal ? item.rotate : item.rotate + 20;
          } else if (status === 'passed') {
            targetRotation = isInstantWordReveal ? item.rotate : item.rotate + item.passedRotate * passedDriftProgress;
          } else {
            targetRotation = item.rotate;
          }

          var localFloatX = Math.sin(time * 1.2 + placementIndex * 0.6) * motionEnergy * 4;
          var localFloatY = Math.cos(time * 1.5 + placementIndex * 0.4) * motionEnergy * 2.5;
          var passedDriftX = status === 'passed' ? item.passedDriftX * passedDriftProgress : 0;
          var passedDriftY = status === 'passed' ? item.passedDriftY * passedDriftProgress : 0;
          var targetX = width / 2 + item.x + localFloatX + passedDriftX + (status === 'waiting' ? item.entryOffsetX : 0);
          var targetY = focusY + item.y + localFloatY + passedDriftY + (status === 'waiting' ? item.entryOffsetY : 0);
          var targetBodyAlpha = status === 'waiting' ? 0 : status === 'active' ? 1 : passedAlpha;
          var targetBlur = (status === 'waiting' && !isInstantWordReveal) ? 10 : 0;
          var targetActiveMix = cadenzaBodyMix(time, lineTiming, item.word);
          var targetGlowAlpha = cadenzaGlowEnvelope(time, lineTiming, item.word);

          var existingState = stateMap.get(item.id);
          var shouldInitializeAsActive = isInstantWordReveal && time >= item.word.startTime;
          var animatedState = existingState || {
            x: width / 2 + item.x + item.entryOffsetX,
            y: focusY + item.y + item.entryOffsetY,
            rotation: shouldInitializeAsActive ? targetRotation : targetRotation + 16,
            scale: shouldInitializeAsActive ? targetScale : Math.max(item.scale * 0.5, 0.5),
            bodyAlpha: shouldInitializeAsActive ? targetBodyAlpha : 0,
            blur: shouldInitializeAsActive ? targetBlur : 10,
            activeMix: shouldInitializeAsActive ? targetActiveMix : 0,
            glowAlpha: shouldInitializeAsActive ? targetGlowAlpha : 0
          };

          animatedState.x = cadenzaMix(animatedState.x, targetX, transformTransitionAmount);
          animatedState.y = cadenzaMix(animatedState.y, targetY, transformTransitionAmount);
          animatedState.rotation = cadenzaMix(animatedState.rotation, targetRotation, transformTransitionAmount);
          animatedState.scale = cadenzaMix(animatedState.scale, targetScale, transformTransitionAmount);
          animatedState.bodyAlpha = cadenzaMix(animatedState.bodyAlpha, targetBodyAlpha, visualTransitionAmount);
          animatedState.blur = cadenzaMix(animatedState.blur, targetBlur, visualTransitionAmount);
          animatedState.activeMix = cadenzaMix(animatedState.activeMix, targetActiveMix, visualTransitionAmount);
          animatedState.glowAlpha = cadenzaMix(animatedState.glowAlpha, targetGlowAlpha, glowTransitionAmount);
          stateMap.set(item.id, animatedState);

          if (animatedState.bodyAlpha < 0.015 && animatedState.glowAlpha < 0.015) continue;

          var drawX = animatedState.x;
          var drawBaselineY = animatedState.y;
          var visualWidth = item.width * animatedState.scale;
          var visualHeight = item.height * animatedState.scale;
          var highlightHeight = visualHeight * (status === 'active' ? 1.08 : 1);
          var scaledLeft = drawX - (visualWidth - item.width) / 2;

          /* 副歌涟漪画在 canvas 上（本项目歌词暂无 isChorus，等 TTML 接入自动生效） */
          if (status === 'active' && !item.isInterlude && activeLine.isChorus) {
            var rippleRadius = Math.max(visualWidth, highlightHeight) * (0.55 + progress * 0.45);
            textContext.strokeStyle = foliaColorWithAlpha(item.color, 0.45 * (1 - progress) * animatedState.bodyAlpha);
            textContext.lineWidth = 1.2;
            textContext.beginPath();
            textContext.arc(
              scaledLeft + visualWidth / 2,
              drawBaselineY - visualHeight * 0.42,
              rippleRadius,
              0,
              Math.PI * 2
            );
            textContext.stroke();
          }

          var textX = -item.width / 2;
          var textY = item.height * 0.42;
          var textColor = foliaMixColors(theme.primaryColor, item.color, animatedState.activeMix);

          var overlayAnchorX = drawX + item.width / 2;
          var overlayAnchorY = drawBaselineY - item.height * 0.42;

          /* 每个落点只量一次 ascent；web 字体迟到时靠 forgetAscents 丢掉重量 */
          var glyphEntry = inst.glyphCache.get(item.id);
          if (!glyphEntry) {
            glyphEntry = { glyphs: foliaSplitGraphemes(item.text), cjk: cadenzaIsCJK(item.text), ascent: undefined };
            inst.glyphCache.set(item.id, glyphEntry);
          }
          var measuredAscent = glyphEntry.ascent;
          if (measuredAscent == null) {
            var measured = textContext.measureText(item.text);
            measuredAscent = (measured && isFinite(measured.actualBoundingBoxAscent))
              ? measured.actualBoundingBoxAscent
              : 0;
            glyphEntry.ascent = measuredAscent;
          }
          var fallbackAscent = measuredAscent > 0 ? measuredAscent : preparedState.fontPx * 0.78;
          var overlayOffsetY = textY - fallbackAscent;

          var glyphs = glyphEntry.glyphs;
          /* 西文多字母词才逐字辉光；CJK 整词一层就够 */
          var shouldSplitGlow = wordRevealMode === 'normal' && !glyphEntry.cjk && glyphs.length > 1;
          var blurScale = 1 + energy * 0.22;

          var overlayWord = overlayNodes.get(item.id);
          if (!overlayWord) {
            overlayWord = cadenzaCreateOverlayWordNodes();
            overlayNodes.set(item.id, overlayWord);
            inst.overlay.appendChild(overlayWord.outer);
          }
          overlayWord.frame = frameNumber;

          cadenzaWriteOverlayWord(overlayWord, {
            outerTransform: 'translate3d(' + overlayAnchorX.toFixed(2) + 'px, ' + overlayAnchorY.toFixed(2) + 'px, 0) rotate('
              + animatedState.rotation.toFixed(3) + 'deg) scale(' + animatedState.scale.toFixed(4) + ')',
            /* Linux 上开着量化时给一层独立合成层，否则每次缩放都要按新尺寸重光栅化 40px 辉光 */
            willChange: foliaGlowBlurQuantized() ? 'transform' : '',
            font: preparedState.font,
            innerTransform: 'translate3d(' + textX.toFixed(2) + 'px, ' + overlayOffsetY.toFixed(2) + 'px, 0)',
            text: item.text,
            color: textColor,
            opacity: animatedState.bodyAlpha.toFixed(4),
            filter: animatedState.blur > 0.05 ? 'blur(' + animatedState.blur.toFixed(2) + 'px)' : 'none',
            emphasis: item.emphasis
          });

          var glowTexts = shouldSplitGlow ? glyphs : [item.text];
          cadenzaSyncOverlayGlyphSpans(overlayWord, glowTexts);

          if (shouldSplitGlow) {
            for (var glyphIndex = 0; glyphIndex < overlayWord.glyphSpans.length; glyphIndex++) {
              var absoluteIndex = item.fragmentStartInWord + glyphIndex;
              var intensity = cadenzaCharGlow(
                time,
                item.word,
                absoluteIndex,
                Math.max(item.wordGraphemeCount, glyphs.length),
                item.wordGraphemeTimings
              ) * cadenzaClamp(animatedState.glowAlpha, 0, 1) * Math.max(CADENZA_TUNING.glowIntensity, 0);

              cadenzaWriteOverlayGlyphShadow(overlayWord, glyphIndex, cadenzaDomTextShadow(item.color, intensity, blurScale));
            }
          } else if (overlayWord.glyphSpans[0]) {
            var wholeIntensity = cadenzaGlowEnvelope(time, lineTiming, item.word)
              * cadenzaClamp(animatedState.glowAlpha, 0, 1)
              * Math.max(CADENZA_TUNING.glowIntensity, 0);
            cadenzaWriteOverlayGlyphShadow(overlayWord, 0, cadenzaDomTextShadow(item.color, wholeIntensity, blurScale));
          }
        }
      }

      /* 这一帧没用到的节点（词已唱出画面）真删 */
      var stale = [];
      overlayNodes.forEach(function (nodes, key) {
        if (nodes.frame !== frameNumber) stale.push(key);
      });
      for (var si = 0; si < stale.length; si++) {
        var staleNodes = overlayNodes.get(stale[si]);
        if (staleNodes && staleNodes.outer && staleNodes.outer.parentNode) {
          staleNodes.outer.parentNode.removeChild(staleNodes.outer);
        }
        overlayNodes.delete(stale[si]);
        stateMap.delete(stale[si]);
      }

      /* 动画态里不在当前落点集合中的也清掉（换行时旧的会越积越多） */
      if (inst.animatedStates.size > preparedState.placements.length * 2 + 8) {
        var ids = {};
        for (var k2 = 0; k2 < preparedState.placements.length; k2++) ids[preparedState.placements[k2].id] = true;
        var dead = [];
        stateMap.forEach(function (value, key) {
          if (!ids[key]) dead.push(key);
        });
        for (var d2 = 0; d2 < dead.length; d2++) stateMap.delete(dead[d2]);
      }

      inst.root.setAttribute('data-folia-cadenza-placements', String(preparedState.placements.length));
      inst.root.setAttribute('data-folia-cadenza-active', String(byStatus.active.length));
      inst.root.setAttribute('data-folia-cadenza-passed', String(byStatus.passed.length));
      inst.subtitle.update(ctx, ctx.dt);
    },

    destroy: function (inst) {
      if (!inst) return;
      if (inst.subtitle) inst.subtitle.destroy();
      cadenzaClearOverlayWordNodes(inst.overlayNodes);
      if (inst.animatedStates) inst.animatedStates.clear();
      if (inst.preparedCache) inst.preparedCache.clear();
      if (inst.glyphCache) inst.glyphCache.clear();
      if (inst.fontSet && inst.forgetAscents && inst.fontSet.removeEventListener) {
        inst.fontSet.removeEventListener('loadingdone', inst.forgetAscents);
      }
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.root = null;
      inst.lineLayer = null;
      inst.overlay = null;
      inst.canvas = null;
      inst.textContext = null;
      inst.waiting = null;
      inst.overlayNodes = null;
      inst.animatedStates = null;
      inst.preparedCache = null;
      inst.glyphCache = null;
      inst.preparedState = null;
      inst.pretext = null;
    }
  });
})();
