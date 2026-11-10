/* Folia 世界 — 歌词样式：回环（claddagh）
 *
 * 移植自 Folia src/components/visualizer/claddagh/（VisualizerCladdagh 330 +
 * CladdaghRingLine 491 + claddaghTimeline 198 + claddaghLayout 89 + claddaghGlow 35）。
 *
 * 画面只有一件事：把一行歌词的每个字素摆在一条**倾斜的椭圆环**上，当前行在环的正前方，
 * 上一行在左后方、下一行在右后方；换行时整环弹簧式转 180°，字沿着环「流」过去。
 *
 * 三个必须照抄的几何量（错一个整环就走形）：
 *   - Rx = min(容器宽 * 0.44, 560) * radiusScale，Ry = Rx * 0.707（45° 投影）
 *   - 每个字素的 nominalAngle 由「前缀实测宽度 / Rx」得出，总跨度超 4.25 弧度就整体压回来
 *   - 弧长 → 椭圆参数：thetaCurve = psi * R / R_major，深度 D = (cos + 1) / 2
 *     尺寸 ∝ D^1.5、模糊 ∝ (1 - D)、背面字距再乘 (0.35 + 0.65 * D^1.2) 收拢
 *
 * 换行推进靠「当前字在环上的角度」wordOffset：由字素时间轴插值出小数下标，
 * 当前行之外还要加一段 back-follow，让环在弹簧转动过程中连续走位而不是跳变。
 *
 * 与 Folia 的实现差异（不改画面）：
 *   1) framer 的 useSpring（音频平滑）换成逐帧跟随弹簧 foliaSpringFollower，参数同义；
 *      animate(mv, target, spring) 也用它——目标不变时两者轨迹一致。
 *   2) 每帧样式写入沿用 Folia 自己的「上次写过就不再写」比对，减少样式引擎解析。
 *   3) 本项目没有 wordColors 映射表，逐字着色那层恒为 null，主色走 accentColor。
 */
'use strict';

(function registerFoliaCladdaghMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* types.ts:465 DEFAULT_CLADDAGH_TUNING。面板见 0l1 的回环组，值存在 0l0。 */
  var CLADDAGH_TUNING_DEFAULT = {
    focusScaleRatio: 0.65,
    radiusScale: 1.0,
    ellipseTiltDeg: 45,
    showAxisLine: true,
    letterSpacingOffset: 0
  };
  /* 字距缩放的基准是「默认 focusScaleRatio」，Folia 用 DEFAULT_CLADDAGH_TUNING.focusScaleRatio
   * 做分母：面板把放大倍率调到别的值时，字距要按比例跟着放大（不是恒 1）。 */
  var DEFAULT_FOCUS_SCALE_RATIO = 0.65;

  /* 现取，不抄局部常量：面板改完立刻生效；0l0 未加载时回落默认值。 */
  function claddaghTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('claddagh')
      : CLADDAGH_TUNING_DEFAULT;
  }

  var MAX_ARC_SPAN = 4.25;
  var LETTER_SPACING_EM = 0.04;
  var BASE_TRACKING_EM = 0.18;
  var BACK_FOLLOW_RATIO = 0.28;
  var BACK_ORBIT_FOLLOW_RATIO = 0.52;
  var NEXT_LINE_ENTRY_LEAD_SECONDS = 0.34;
  var SPACING_CACHE_LIMIT = 240;
  var BASE_FONT_PX = 72;
  var GLOW_DROP_SHADOW_SCALE = 0.5;
  var CHORUS_DROP_SHADOW_SCALE = 0.4;
  var CHORUS_MIDDLE_ALPHA = 0.2;
  var WS_RE = /^\s+$/;

  /* 前缀实测宽度的缓存（key = 字号|字体|tracking|额外字距|整段文本）。 */
  var claddaghSpacingCache = new Map();

  /* ------------------------------------------------------------------ *
   * 时间轴（claddaghTimeline.ts）
   * ------------------------------------------------------------------ */

  function isCjkChar(ch) {
    return typeof foliaHasCjk === 'function' ? foliaHasCjk(ch) : false;
  }

  function visualLength(text) {
    if (!text) return 0;
    var score = 0;
    for (var i = 0; i < text.length; i++) score += isCjkChar(text[i]) ? 1.0 : 0.5;
    return score;
  }

  function findGraphemeSequence(source, target, fromIndex) {
    if (target.length === 0) return fromIndex;
    for (var i = fromIndex; i <= source.length - target.length; i++) {
      var matched = true;
      for (var k = 0; k < target.length; k++) {
        if (source[i + k] !== target[k]) { matched = false; break; }
      }
      if (matched) return i;
    }
    return -1;
  }

  /* 整行字素时间轴：把词级时间映射回含空格标点的整行（claddagh 的逐字进度就靠它）。 */
  function buildLineTimeline(line) {
    var lineGraphemes = foliaSplitGraphemes(line.fullText);
    if (lineGraphemes.length === 0) return [];

    var words = line.words || [];
    if (words.length === 0) {
      return foliaBuildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }

    var timeline = [];
    var cursor = 0;
    var lastResolvedTime = line.startTime;

    for (var wi = 0; wi < words.length; wi++) {
      var word = words[wi];
      var wordGraphemes = foliaSplitGraphemes(word.text);
      if (wordGraphemes.length === 0) continue;

      var matchedStart = findGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

      for (var gapIndex = cursor; gapIndex < start; gapIndex++) {
        timeline[gapIndex] = {
          char: lineGraphemes[gapIndex],
          startTime: word.startTime,
          endTime: word.startTime
        };
      }

      var wordTimings = foliaBuildWordGraphemeTimings(word);
      for (var localIndex = 0; localIndex < end - start; localIndex++) {
        var timing = wordTimings[localIndex];
        if (!timing) {
          var even = foliaBuildEvenGraphemeTimings(wordGraphemes[localIndex] || '', word.startTime, word.endTime);
          timing = even[0];
        }
        if (!timing) continue;
        timeline[start + localIndex] = {
          char: lineGraphemes[start + localIndex],
          startTime: timing.startTime,
          endTime: timing.endTime
        };
        lastResolvedTime = Math.max(lastResolvedTime, timing.endTime);
      }

      cursor = Math.max(cursor, end);
    }

    for (var index = 0; index < lineGraphemes.length; index++) {
      if (timeline[index]) continue;
      timeline[index] = {
        char: lineGraphemes[index],
        startTime: lastResolvedTime,
        endTime: lastResolvedTime
      };
    }

    return timeline;
  }

  /* 零时长的空格会挤成一瞬间；从邻居借时间，保证每个空档至少 60ms。 */
  function adjustTimeline(timeline, line) {
    if (timeline.length === 0) return timeline;
    var adjusted = timeline.map(function (item) {
      return { char: item.char, startTime: item.startTime, endTime: item.endTime };
    });
    var n = adjusted.length;
    var i = 0;

    while (i < n) {
      if (adjusted[i].startTime === adjusted[i].endTime) {
        var j = i;
        while (j < n && adjusted[j].startTime === adjusted[j].endTime) j++;
        var gapCount = j - i;
        var gapStart = i > 0 ? adjusted[i - 1].endTime : line.startTime;
        var gapEnd = j < n ? adjusted[j].startTime : line.endTime;
        var minNeeded = gapCount * 0.06;
        var duration = gapEnd - gapStart;

        if (duration < minNeeded) {
          var deficit = minNeeded - duration;
          if (i > 0 && j < n) {
            var half = deficit / 2;
            var prevDuration = adjusted[i - 1].endTime - adjusted[i - 1].startTime;
            var prevSteal = Math.min(half, Math.max(0, prevDuration - 0.04));
            var nextDuration = adjusted[j].endTime - adjusted[j].startTime;
            var nextSteal = Math.min(deficit - prevSteal, Math.max(0, nextDuration - 0.04));
            gapStart -= prevSteal;
            gapEnd += nextSteal;
            adjusted[i - 1].endTime = gapStart;
            adjusted[j].startTime = gapEnd;
          } else if (i > 0) {
            var prevDur = adjusted[i - 1].endTime - adjusted[i - 1].startTime;
            var stealPrev = Math.min(deficit, Math.max(0, prevDur - 0.04));
            gapStart -= stealPrev;
            adjusted[i - 1].endTime = gapStart;
          } else if (j < n) {
            var nextDur = adjusted[j].endTime - adjusted[j].startTime;
            var stealNext = Math.min(deficit, Math.max(0, nextDur - 0.04));
            gapEnd += stealNext;
            adjusted[j].startTime = gapEnd;
          }
          duration = gapEnd - gapStart;
        }

        var gapUnit = duration > 0 ? duration / gapCount : 0;
        for (var k = i; k < j; k++) {
          var idxInGap = k - i;
          adjusted[k].startTime = gapStart + gapUnit * idxInGap;
          adjusted[k].endTime = gapStart + gapUnit * (idxInGap + 1);
        }
        i = j;
      } else {
        i++;
      }
    }

    return adjusted;
  }

  function clampNum(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /* 时间 → 小数下标。末尾之后允许外插（环继续转），否则长间奏时整环会卡住。 */
  function fractionalActiveIndex(timeline, t, renderEnd) {
    if (timeline.length === 0) return 0;
    if (timeline.length === 1) {
      var item = timeline[0];
      var targetEnd = (typeof renderEnd === 'number' && isFinite(renderEnd)) ? renderEnd : item.endTime;
      var dur = Math.max(0.2, targetEnd - item.startTime);
      if (t <= item.startTime) return 0;
      return (t - item.startTime) / dur;
    }

    if (t <= timeline[0].startTime) return 0;

    var lastIdx = timeline.length - 1;
    if (t >= timeline[lastIdx].startTime) {
      var lastItem = timeline[lastIdx];
      if (typeof renderEnd === 'number' && isFinite(renderEnd) && renderEnd > lastItem.startTime) {
        var progress = clampNum((t - lastItem.startTime) / (renderEnd - lastItem.startTime), 0, 1);
        return lastIdx + progress * 2.0;
      }
      var prevItem = timeline[lastIdx - 1];
      var itemDur = lastItem.endTime - lastItem.startTime;
      var gapDur = lastItem.startTime - prevItem.startTime;
      var stepDur = itemDur > 0 ? itemDur : (gapDur > 0 ? gapDur : 0.5);
      var overshootProgress = (t - lastItem.startTime) / stepDur;
      return lastIdx + Math.min(overshootProgress, 1.8);
    }

    for (var i = 0; i < timeline.length - 1; i++) {
      var tStart = timeline[i].startTime;
      var tEnd = timeline[i + 1].startTime;
      if (t >= tStart && t < tEnd) {
        if (tEnd === tStart) return i;
        return i + (t - tStart) / (tEnd - tStart);
      }
    }
    return timeline.length - 1;
  }

  function lineWordOffset(spacingInfo, latestTime, renderEnd) {
    if (spacingInfo.length === 0) return 0;
    var frac = fractionalActiveIndex(spacingInfo, latestTime, renderEnd);
    var lastIdx = spacingInfo.length - 1;
    if (frac <= lastIdx) {
      var intPart = Math.floor(frac);
      var fracPart = frac - intPart;
      var angleA = spacingInfo[intPart] ? spacingInfo[intPart].nominalAngle : 0;
      var nextEntry = spacingInfo[Math.min(intPart + 1, lastIdx)];
      var angleB = nextEntry ? nextEntry.nominalAngle : 0;
      return angleA + (angleB - angleA) * fracPart;
    }
    var lastAngle = spacingInfo[lastIdx] ? spacingInfo[lastIdx].nominalAngle : 0;
    var prevEntry = spacingInfo[Math.max(0, lastIdx - 1)];
    var prevAngle = prevEntry ? prevEntry.nominalAngle : 0;
    return lastAngle + (lastAngle - prevAngle) * (frac - lastIdx);
  }

  function linePlaybackProgress(spacingInfo, latestTime, renderEnd) {
    if (spacingInfo.length === 0) return 0;
    if (spacingInfo.length === 1) {
      var item = spacingInfo[0];
      var targetEnd = (typeof renderEnd === 'number' && isFinite(renderEnd)) ? renderEnd : item.endTime;
      var duration = Math.max(0.001, targetEnd - item.startTime);
      return clampNum((latestTime - item.startTime) / duration, 0, 1);
    }
    var frac = fractionalActiveIndex(spacingInfo, latestTime, renderEnd);
    return clampNum(frac / Math.max(1, spacingInfo.length - 1), 0, 1);
  }

  function holdFrameForPlaybackReset(previousTime, currentTime, centerLineIndex) {
    return centerLineIndex > 0 && currentTime <= 0.5 && currentTime < previousTime - 0.5;
  }

  /* ------------------------------------------------------------------ *
   * 环上排布（claddaghLayout.ts）
   * ------------------------------------------------------------------ */

  /* 让字沿环切线旋转后仍然可读：超过 ±90° 就翻 180°，避免倒着的字。 */
  function normalizeReadableAngle(degrees) {
    var normalized = degrees;
    while (normalized > 90) normalized -= 180;
    while (normalized < -90) normalized += 180;
    return normalized;
  }

  function fallbackGraphemeWidth(ch, fontPx) {
    if (WS_RE.test(ch)) return fontPx * 0.36;
    if (isCjkChar(ch)) return fontPx;
    return fontPx * 0.62;
  }

  function measureTextWidth(pretext, text, fontSpec, fontPx, fallbackWidth) {
    if (!text) return 0;
    var prepared = pretext.prepareWithSegments(text, fontSpec, {
      whiteSpace: 'pre-wrap',
      letterSpacing: fontPx * LETTER_SPACING_EM
    });
    var measured = pretext.measureNaturalWidth(prepared);
    return (isFinite(measured) && measured > 0) ? measured : fallbackWidth;
  }

  function rememberBounded(cache, key, value, limit) {
    if (!cache.has(key) && cache.size >= limit) {
      var oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
  }

  /* 逐字素中心：每个前缀当整串量（保留跨字字距/连字），再加 tracking 与额外字距。 */
  function measureGraphemeOffsets(pretext, graphemes, fontSpec, fontPx, letterSpacingOffsetPx) {
    var text = graphemes.join('');
    var cacheKey = fontPx + '|' + fontSpec + '|' + BASE_TRACKING_EM + '|' + letterSpacingOffsetPx + '|' + text;
    var cached = claddaghSpacingCache.get(cacheKey);
    if (cached) return cached;

    var fallbackWidth = 0;
    var offsets = new Array(graphemes.length + 1);
    offsets[0] = 0;
    for (var count = 1; count <= graphemes.length; count++) {
      var previousOffset = offsets[count - 1];
      fallbackWidth += fallbackGraphemeWidth(graphemes[count - 1], fontPx);
      var baseTracking = Math.max(0, count - 1) * fontPx * BASE_TRACKING_EM;
      var extraOffset = Math.max(0, count - 1) * letterSpacingOffsetPx;
      var prefix = graphemes.slice(0, count).join('');
      offsets[count] = Math.max(
        previousOffset,
        measureTextWidth(pretext, prefix, fontSpec, fontPx, fallbackWidth) + baseTracking + extraOffset
      );
    }
    return rememberBounded(claddaghSpacingCache, cacheKey, offsets, SPACING_CACHE_LIMIT);
  }

  /* items → 每项 {startAngle, nominalAngle, scaleFactor}；总弧长超 4.25 就整体压回。 */
  function buildSpacingInfo(pretext, items, fontSpec, fontPx, radiusPx, spacingScale, letterSpacingOffsetPx) {
    if (items.length === 0) return [];
    var graphemes = items.map(function (item) { return item.char; });
    var offsets = measureGraphemeOffsets(pretext, graphemes, fontSpec, fontPx, letterSpacingOffsetPx);
    var safeSpacingScale = isFinite(spacingScale) ? Math.max(0.1, spacingScale) : 1;
    var lastOffset = offsets[offsets.length - 1];
    var totalWidth = (lastOffset !== undefined ? lastOffset : 0) * safeSpacingScale;
    var safeRadius = Math.max(radiusPx, fontPx * 2, 1);
    var totalSpan = totalWidth / safeRadius;
    var scaleFactor = totalSpan > MAX_ARC_SPAN ? MAX_ARC_SPAN / totalSpan : 1.0;

    return items.map(function (item, index) {
      var current = offsets[index] !== undefined ? offsets[index] : 0;
      var next = offsets[index + 1] !== undefined ? offsets[index + 1] : current;
      var centerPx = ((current + next) / 2) * safeSpacingScale;
      var startAngle = centerPx / safeRadius;
      return {
        char: item.char,
        startTime: item.startTime,
        endTime: item.endTime,
        charColor: item.charColor || null,
        startAngle: startAngle,
        nominalAngle: (startAngle - totalSpan / 2) * scaleFactor,
        scaleFactor: scaleFactor
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * 辉光（claddaghGlow.ts）：用串联 drop-shadow 表达，走合成器不碰字形缓存
   * ------------------------------------------------------------------ */

  function buildGlowFilter(color, coreColor, radius, glyphAlpha, fade, isChorus) {
    var glow = function (alpha) { return foliaMixColors(color, color, 0, alpha); };
    if (!isChorus) {
      return 'drop-shadow(0 0 ' + (radius * GLOW_DROP_SHADOW_SCALE).toFixed(2) + 'px ' + glow(fade) + ')';
    }
    var core = foliaMixColors(color, coreColor, 0.65, clampNum(fade / Math.max(glyphAlpha, 0.01), 0, 1));
    return 'drop-shadow(0 0 ' + (radius * 0.35 * CHORUS_DROP_SHADOW_SCALE).toFixed(2) + 'px ' + core + ') '
      + 'drop-shadow(0 0 ' + (radius * CHORUS_DROP_SHADOW_SCALE).toFixed(2) + 'px ' + glow(fade * CHORUS_MIDDLE_ALPHA) + ') '
      + 'drop-shadow(0 0 ' + (radius * 1.6 * CHORUS_DROP_SHADOW_SCALE).toFixed(2) + 'px ' + glow(fade) + ')';
  }

  /* ------------------------------------------------------------------ *
   * DOM 与逐帧
   * ------------------------------------------------------------------ */

  function buildLineElement(pretext, line, entry, spec) {
    var timeline = adjustTimeline(buildLineTimeline(line), line);
    var spacing = buildSpacingInfo(
      pretext, timeline, spec.fontSpec, spec.fontPx, spec.Rx,
      spec.textSpacingScale, claddaghTuning().letterSpacingOffset
    );

    var el = document.createElement('div');
    el.className = 'folia-claddagh-line';
    var spans = [];
    for (var i = 0; i < spacing.length; i++) {
      var span = document.createElement('span');
      span.className = 'folia-claddagh-char';
      span.textContent = spacing[i].char;
      span.style.fontFamily = spec.fontStack;
      span.style.fontSize = spec.fontPx + 'px';
      span.style.fontWeight = String(spec.fontWeight);
      span.style.color = spec.baseColor;
      span.style.letterSpacing = LETTER_SPACING_EM + 'em';
      el.appendChild(span);
      spans.push({ el: span, written: null });
    }

    entry.el = el;
    entry.spans = spans;
    entry.spacing = spacing;
    entry.writtenKey = spec.fontSpec;
  }

  function writeGlyph(holder, next) {
    var prev = holder.written;
    var style = holder.el.style;
    if (!prev || prev.transform !== next.transform) style.transform = next.transform;
    if (!prev || prev.opacity !== next.opacity) style.opacity = next.opacity;
    if (!prev || prev.color !== next.color) style.color = next.color;
    if (!prev || prev.textShadow !== next.textShadow) style.textShadow = next.textShadow;
    if (!prev || prev.filter !== next.filter) style.filter = next.filter;
    holder.written = next;
  }

  function renderSlot(inst, entry, ctx, shared) {
    var tuning = claddaghTuning();
    var spec = shared.spec;
    var spacing = entry.spacing;
    if (!spacing || spacing.length === 0) return;

    var line = entry.line;
    var lineIndex = entry.index;
    var lines = ctx.lines;
    var latestTime = ctx.time;
    var curLineOffset = inst.lineOffset.get();
    var power = shared.power;

    var intensity = ctx.theme.animationIntensity || 'normal';
    var intensityMultiplier = 0.25;
    var maxScale = 1.25;
    if (intensity === 'calm') { intensityMultiplier = 0.08; maxScale = 1.08; }
    else if (intensity === 'chaotic') { intensityMultiplier = 0.95; maxScale = 1.95; }

    var scaleFactor = Math.min(1 + power * intensityMultiplier, maxScale);
    var currentRx = shared.Rx * scaleFactor;
    var R_major = currentRx;
    var R_minor = currentRx * 0.09;

    var isUpcomingLine = lineIndex > shared.centerLineIndex;
    var upcomingEntryProgress = isUpcomingLine
      ? clampNum((latestTime - (line.startTime - NEXT_LINE_ENTRY_LEAD_SECONDS)) / NEXT_LINE_ENTRY_LEAD_SECONDS, 0, 1)
      : 0;
    var lineDiffFromCenter = Math.abs(curLineOffset - lineIndex * Math.PI) / Math.PI;

    var currentLine = lines[shared.centerLineIndex];
    var currentLen = currentLine ? visualLength(currentLine.fullText) : 0;
    var targetLine = lines[lineIndex];
    var targetLen = targetLine ? visualLength(targetLine.fullText) : 0;

    var lengthFadeFactor = 1.0;
    var lengthScaleFactor = 1.0;
    if (lineIndex > shared.centerLineIndex && currentLen > 10) {
      var fadeStrength = clampNum((currentLen - 10) / 8, 0, 1);
      var targetStrength = clampNum((targetLen - 5) / 5, 0.4, 1);
      var combinedStrength = fadeStrength * targetStrength;
      var targetMinOpacity = 1.0 - combinedStrength;
      var targetMinScale = 1.0 - combinedStrength * 0.25;
      var transitionProgress = clampNum((lineDiffFromCenter - 0.4) / 0.5, 0, 1);
      lengthFadeFactor = 1.0 - (1.0 - targetMinOpacity) * transitionProgress;
      lengthScaleFactor = 1.0 - (1.0 - targetMinScale) * transitionProgress;
    }

    var normalizeEnd = function (l) {
      var next = lines[l.index + 1];
      var base = foliaGetLineRenderEndTime(l.line);
      return Math.max(base, next ? next.startTime - NEXT_LINE_ENTRY_LEAD_SECONDS : l.line.endTime + 10.0);
    };
    var activeEntry = inst.slots[shared.renderBaseIndex];
    var activeRenderEnd = activeEntry ? normalizeEnd(activeEntry) : undefined;
    var ownRenderEnd = normalizeEnd(entry);

    var activeSpacing = activeEntry ? activeEntry.spacing : [];
    var activeWordOffset = lineWordOffset(activeSpacing, latestTime, activeRenderEnd);
    var ownWordOffset = lineWordOffset(spacing, latestTime, ownRenderEnd);
    var activeLineProgress = linePlaybackProgress(activeSpacing, latestTime, activeRenderEnd);
    var backOrbitFollow = Math.PI * BACK_ORBIT_FOLLOW_RATIO * (1 - Math.pow(1 - activeLineProgress, 1.35));

    var wordOffset = ownWordOffset;
    if (!(lineIndex < shared.centerLineIndex)) {
      var backFollowFactor = lineIndex > shared.centerLineIndex ? 1 : clampNum(lineDiffFromCenter, 0, 1);
      wordOffset += (activeWordOffset * BACK_FOLLOW_RATIO + backOrbitFollow) * backFollowFactor;
    }

    var thetaRot = -(tuning.ellipseTiltDeg * Math.PI) / 180;
    var cosTheta = Math.cos(thetaRot);
    var sinTheta = Math.sin(thetaRot);
    var isChorus = !!line.isChorus;
    var glowAsFilter = foliaGlowBlurQuantized();

    for (var i = 0; i < spacing.length; i++) {
      var holder = entry.spans[i];
      if (!holder) continue;

      var item = spacing[i];
      var theta = lineIndex * Math.PI + item.nominalAngle;
      var psi = theta - curLineOffset - wordOffset;
      var deltaDist = psi * currentRx;
      var thetaCurve = deltaDist / R_major;

      var localCos = Math.cos(thetaCurve);
      var D = (localCos + 1) / 2;
      var spacingFactor = 0.35 + 0.65 * Math.pow(D, 1.2);

      var rawX = Math.sin(thetaCurve) * R_major * spacingFactor;
      var rawY = localCos * R_minor;
      if (isChorus) {
        var staggerAmount = spec.fontPx * (0.06 + power * 0.12);
        rawY += (i % 2 === 0 ? 1 : -1) * staggerAmount;
      }

      var x = rawX * cosTheta - rawY * sinTheta;
      var y = rawX * sinTheta + rawY * cosTheta;

      var tangentX = Math.cos(thetaCurve) * R_major;
      var tangentY = -Math.sin(thetaCurve) * R_minor;
      var rotatedTangentX = tangentX * cosTheta - tangentY * sinTheta;
      var rotatedTangentY = tangentX * sinTheta + tangentY * cosTheta;
      var tangentAngle = normalizeReadableAngle(Math.atan2(rotatedTangentY, rotatedTangentX) * 180 / Math.PI);

      var lineDiffNormalized = lineDiffFromCenter;
      var activeLineFactor = Math.max(0, 1 - lineDiffNormalized);
      var maxVisibleDist = currentRx * 0.48;
      var distRatio = Math.min(1, Math.abs(deltaDist) / maxVisibleDist);
      var F = activeLineFactor * Math.pow(1 - distRatio, 1.8);

      var distanceOpacity = 0.68 + 0.32 * Math.pow(D, 1.9);
      var finalOpacity = (0.35 + 0.65 * Math.pow(D, 1.5) * (0.35 + 0.65 * F)) * distanceOpacity;
      finalOpacity *= clampNum(2 - lineDiffNormalized, 0, 1);
      if (lineIndex < shared.centerLineIndex) {
        finalOpacity *= Math.max(0, 1 - lineDiffNormalized);
      }
      finalOpacity *= lengthFadeFactor;
      if (isUpcomingLine) {
        finalOpacity *= (0.18 + 0.82 * upcomingEntryProgress);
      }

      var boundaryFade = 1.0;
      if (lineDiffFromCenter > 0.02) {
        var boundaryProgress = clampNum((lineDiffFromCenter - 0.3) / 0.6, 0, 1);
        var cosThreshold = 1.0 - 1.2 * boundaryProgress;
        if (localCos > cosThreshold) {
          boundaryFade = clampNum(1.0 - (localCos - cosThreshold) / 0.15, 0, 1);
        }
      }
      finalOpacity *= boundaryFade;

      var scale = (0.22 + 0.98 * Math.pow(D, 1.5))
        * (1.0 + tuning.focusScaleRatio * F)
        * lengthScaleFactor
        * (item.scaleFactor !== undefined ? item.scaleFactor : 1.0);
      var blur = 8.0 * (1 - D) * (1 - 0.5 * F);
      var tiltAngle = clampNum(tangentAngle * (0.4 + 0.6 * D), -38, 38);

      var transform = 'translate3d(calc(-50% + ' + x.toFixed(1) + 'px), calc(-50% + ' + y.toFixed(1) + 'px), 0px) rotate('
        + tiltAngle.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
      var blurFilter = blur < 0.2 ? '' : 'blur(' + blur.toFixed(2) + 'px)';
      var glowFilter = '';

      var charProgress = 0;
      if (latestTime >= item.endTime) {
        charProgress = 1;
      } else if (latestTime > item.startTime) {
        var dur = item.endTime - item.startTime;
        charProgress = dur > 0 ? (latestTime - item.startTime) / dur : 1;
      }

      var baseGlow = isChorus
        ? (36 + power * 24) * Math.pow(F, 1.5)
        : 24 * Math.pow(F, 2.0);

      var finalHighlightColor = item.charColor || spec.highlightColor;

      /* targetColor 起手就是「带 0.55 透明度的主色」——Folia 直接拿 colorWithAlpha 的结果当起始色，
       * 所以没唱到的字是半透明的；换成不透明主色会让整环明显变亮。 */
      var targetColor = spec.baseColor;
      var currentAlpha = 0.55;
      var flashPop = 0;

      if (charProgress >= 1) {
        targetColor = finalHighlightColor;
        currentAlpha = 1.0;
      } else if (charProgress > 0) {
        var progressFactor = Math.min(1, charProgress * 15.0);
        currentAlpha = 0.55 + 0.45 * progressFactor;
        targetColor = foliaMixColors(spec.baseColor, finalHighlightColor, progressFactor, currentAlpha);
        if (charProgress < 0.4) {
          flashPop = Math.pow(1 - charProgress / 0.4, 2.0) * 0.65;
        }
      }

      var currentGlowRadius = baseGlow * (1.0 + flashPop);
      var shadowFade = clampNum((currentGlowRadius - 0.5) / 2.0, 0, 1);
      var textShadow = 'none';

      if (currentGlowRadius > 0.5 && shadowFade > 0.01) {
        var fadedTargetColor = foliaMixColors(targetColor, targetColor, 0, currentAlpha * shadowFade);
        if (glowAsFilter) {
          glowFilter = buildGlowFilter(
            targetColor, ctx.theme.primaryColor || '#ffffff',
            currentGlowRadius, currentAlpha, shadowFade, isChorus
          );
        } else if (isChorus) {
          var innerGlowColor = foliaMixColors(targetColor, ctx.theme.primaryColor || '#ffffff', 0.65, shadowFade);
          textShadow = '0 0 ' + foliaQuantizeShadowBlur(currentGlowRadius * 0.35) + 'px ' + innerGlowColor + ', '
            + '0 0 ' + foliaQuantizeShadowBlur(currentGlowRadius) + 'px ' + fadedTargetColor + ', '
            + '0 0 ' + foliaQuantizeShadowBlur(currentGlowRadius * 1.6) + 'px ' + fadedTargetColor;
        } else {
          textShadow = '0 0 ' + foliaQuantizeShadowBlur(currentGlowRadius) + 'px ' + fadedTargetColor;
        }
      }

      var filterParts = [];
      if (glowFilter) filterParts.push(glowFilter);
      if (blurFilter) filterParts.push(blurFilter);

      writeGlyph(holder, {
        transform: transform,
        opacity: finalOpacity.toFixed(3),
        color: targetColor,
        textShadow: textShadow,
        filter: filterParts.length ? filterParts.join(' ') : 'none'
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 模式注册
   * ------------------------------------------------------------------ */
  registerFoliaMode('claddagh', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerCladdagh = 回环，entry.tsx order 80。 */
    name: '回环',
    desc: '歌词沿倾斜圆环轨道循环推进，大小对比拉开纵深',
    order: 80,

    create: function (host, ctx) {
      return foliaLoadPretext().then(function (pretext) {
        var root = document.createElement('div');
        root.className = 'folia-claddagh';
        root.style.fontFamily = ctx.theme.fontStack;

        /* 轴线节点常驻（display 由每帧按 tuning.showAxisLine 开关）：
         * 面板的「隐藏」要立刻生效，不能只在 create 时判一次。 */
        var axis = document.createElement('div');
        axis.className = 'folia-claddagh-axis';
        root.appendChild(axis);

        var stage = document.createElement('div');
        stage.className = 'folia-claddagh-stage';
        root.appendChild(stage);

        var waiting = document.createElement('div');
        waiting.className = 'folia-claddagh-waiting';
        waiting.style.color = ctx.theme.secondaryColor;
        waiting.textContent = '等待播放';
        root.appendChild(waiting);

        host.appendChild(root);

        var inst = {
          pretext: pretext,
          root: root,
          stage: stage,
          axis: axis,
          waiting: waiting,
          subtitle: foliaCreateSubtitleOverlay(host, ctx.theme, {
            translationFontSize: 'clamp(1.1rem, 2.2vw, 1.45rem)',
            upcomingFontSize: 'clamp(0.95rem, 1.8vw, 1.2rem)'
          }),
          slots: {},
          slotOrder: [],
          buildKey: '',
          centerLineIndex: -1,
          renderBaseIndex: -1,
          lineOffset: foliaSpringFollower(55, 14, 0.9),
          offsetInitialized: false,
          bass: foliaSpringFollower(150, 25, 1),
          vocal: foliaSpringFollower(120, 24, 1),
          rawScale: false,
          glowIntensity: 0,
          width: 0,
          height: 0,
          previousTime: ctx.time,
          holdResetFrame: false,
          theme: ctx.theme,
          tuning: claddaghTuning()
        };

        inst.bass.set(ctx.audio.bands.bass || 0);
        inst.vocal.set(ctx.audio.bands.vocal || 0);
        root.setAttribute('data-folia-claddagh-lines', '0');
        root.setAttribute('data-folia-claddagh-offset', '0.000');
        return inst;
      });
    },

    tick: function (inst, ctx) {
      if (!inst || !inst.root) return;

      var width = inst.root.clientWidth || 1200;
      var height = inst.root.clientHeight || 700;
      inst.width = width;
      inst.height = height;

      var theme = ctx.theme;
      var fontScale = ctx.fontScale || 1;
      var fontPx = BASE_FONT_PX * fontScale;
      var fontWeight = foliaResolveThemeFontWeight(theme, 700);
      var fontStack = theme.fontStack;
      var fontSpec = fontWeight + ' ' + fontPx + 'px ' + fontStack;
      /* 调参改过：轨道半径/放大倍率已在 buildKey 里，但字符间距不在 —— 统一在这里作废
       * 一次 buildKey，让整圈 DOM 按新参数重铺。按对象身份判（0l0 每次修改换新对象）。 */
      var tuning = claddaghTuning();
      if (tuning !== inst.tuning) {
        inst.tuning = tuning;
        inst.buildKey = '';
      }

      var Rx = Math.min(width * 0.44, 560) * tuning.radiusScale;
      var Ry = Rx > 0 ? Rx * 0.707 : 254;
      var textSpacingScale = (1 + tuning.focusScaleRatio) / (1 + DEFAULT_FOCUS_SCALE_RATIO);

      /* 焦点行：有当前行就用它，否则退到刚结束的那一行（与 Folia 一致）。 */
      var focusIndex = ctx.index;
      if (focusIndex === -1) {
        var recent = foliaGetRecentCompletedLine(ctx);
        focusIndex = recent ? ctx.lines.indexOf(recent) : -1;
      }
      var centerLineIndex = Math.max(-1, focusIndex);

      if (centerLineIndex !== inst.centerLineIndex) {
        var previous = inst.centerLineIndex;
        inst.centerLineIndex = centerLineIndex;
        /* 首次确定焦点行、或直接跳过不止一行（拖动进度条 / 跳播）时直接落位；
         * 正常换行才走弹簧，让整环转过去。 */
        if (!inst.offsetInitialized || Math.abs(centerLineIndex - previous) > 1) {
          inst.lineOffset.set(centerLineIndex * Math.PI);
        }
        inst.offsetInitialized = true;
        inst.renderBaseIndex = centerLineIndex;
      }

      /* 环角弹簧：目标恒定，走完即停。 */
      inst.lineOffset.step(centerLineIndex * Math.PI, ctx.dt);
      if (Math.abs(inst.lineOffset.get() - centerLineIndex * Math.PI) < 1e-4) {
        inst.lineOffset.set(centerLineIndex * Math.PI);
      }

      var indices = [];
      if (ctx.lines.length > 0) {
        for (var i = inst.renderBaseIndex - 1; i <= inst.renderBaseIndex + 2; i++) {
          if (i >= 0 && i < ctx.lines.length) indices.push(i);
        }
        if (indices.length === 0) {
          indices.push(Math.max(0, Math.min(centerLineIndex, ctx.lines.length - 1)));
        }
      }

      var keyParts = [fontSpec, Math.round(Rx), textSpacingScale.toFixed(3), inst.renderBaseIndex];
      for (var k = 0; k < indices.length; k++) {
        var ln = ctx.lines[indices[k]];
        keyParts.push(indices[k] + ':' + ln.startTime + ':' + ln.fullText);
      }
      var buildKey = keyParts.join('|');

      /* 排版规格：每帧都要用（逐帧写样式），只有 Rx / 字体变了才需要重建 DOM。 */
      var spec = {
        fontSpec: fontSpec,
        fontPx: fontPx,
        fontStack: fontStack,
        fontWeight: fontWeight,
        Rx: Rx,
        textSpacingScale: textSpacingScale,
        baseColor: foliaColorWithAlpha(theme.primaryColor, 0.55),
        highlightColor: theme.accentColor || theme.primaryColor
      };

      if (buildKey !== inst.buildKey) {
        inst.buildKey = buildKey;
        while (inst.stage.firstChild) inst.stage.removeChild(inst.stage.firstChild);
        inst.slots = {};
        inst.slotOrder = [];
        for (var s = 0; s < indices.length; s++) {
          var idx = indices[s];
          var entry = { index: idx, line: ctx.lines[idx], el: null, spans: null, spacing: null };
          buildLineElement(inst.pretext, entry.line, entry, spec);
          entry.el.setAttribute('data-folia-line-index', String(idx));
          /* 当前焦点行打标：探针/调试只需要看这一行（环上通常同时挂着 2~4 行）。 */
          entry.el.setAttribute('data-line-active', idx === centerLineIndex ? '1' : '0');
          inst.stage.appendChild(entry.el);
          inst.slots[idx] = entry;
          inst.slotOrder.push(idx);
        }
        inst.root.setAttribute('data-folia-claddagh-lines', String(indices.length));
      }

      /* 播放重置那一帧保住旧画面（时间先归零、行号还没跟上）。 */
      if (holdFrameForPlaybackReset(inst.previousTime, ctx.time, centerLineIndex)) {
        inst.holdResetFrame = true;
      }
      inst.previousTime = ctx.time;
      if (inst.holdResetFrame && centerLineIndex > 0) {
        inst.subtitle.update(ctx, ctx.dt);
        return;
      }
      inst.holdResetFrame = false;

      var bassTarget = ctx.paused ? 0 : (ctx.audio.bands.bass || 0);
      var vocalTarget = ctx.paused ? 0 : (ctx.audio.bands.vocal || 0);
      inst.bass.step(bassTarget, ctx.dt);
      inst.vocal.step(vocalTarget, ctx.dt);

      var normalizePower = function (power) {
        if (!isFinite(power)) return 0;
        if (power > 1.0) inst.rawScale = true;
        return Math.max(0, Math.min(1, inst.rawScale ? power / 255 : power));
      };

      var shared = {
        spec: spec,
        Rx: Rx,
        Ry: Ry,
        power: normalizePower(inst.bass.get()),
        centerLineIndex: centerLineIndex,
        renderBaseIndex: inst.renderBaseIndex
      };

      inst.waiting.style.display = (ctx.showText && inst.slotOrder.length > 0) ? 'none' : '';

      if (ctx.showText) {
        for (var si = 0; si < inst.slotOrder.length; si++) {
          var slot = inst.slots[inst.slotOrder[si]];
          if (slot) renderSlot(inst, slot, ctx, shared);
        }
      }

      /* 轴线：配色随低频/人声脉动，副歌时加辉光。 */
      if (inst.axis) {
        var bassPower = ctx.paused ? 0 : normalizePower(inst.bass.get());
        var vocalPower = ctx.paused ? 0 : normalizePower(inst.vocal.get());
        var fromColor = theme.primaryColor || '#ffffff';
        var toColor = theme.accentColor || '#ffffff';
        if (toColor === fromColor && theme.secondaryColor) toColor = theme.secondaryColor;
        if (toColor === fromColor) toColor = '#ffffff';

        var colorPower = Math.max(bassPower, vocalPower);
        var colorDelta = Math.max(0, colorPower - 0.02);
        var colorRatio = Math.min(1.0, colorDelta / 0.58);
        var mixed = foliaMixColors(fromColor, toColor, colorRatio, 0.2 + 0.75 * colorRatio);
        var gradient = 'linear-gradient(90deg, transparent, ' + mixed + ' 20%, ' + mixed + ' 80%, transparent)';
        inst.axis.style.background = gradient;

        var bassSqr = bassPower * bassPower;
        var axisScaleX = 1.0 + bassSqr * 1.5;
        var axisScaleY = 1.0 + bassSqr * 0.5;
        inst.axis.style.display = tuning.showAxisLine ? '' : 'none';
        var centerNormalTiltDeg = 90 - tuning.ellipseTiltDeg;
        inst.axis.style.transform = 'translate(-50%, -50%) rotate(' + centerNormalTiltDeg
          + 'deg) scale(' + axisScaleX + ', ' + axisScaleY + ')';

        var isChorusNow = !!(ctx.lines[centerLineIndex] && ctx.lines[centerLineIndex].isChorus);
        var targetIntensity = isChorusNow ? 1.0 : 0.0;
        var diff = targetIntensity - inst.glowIntensity;
        if (Math.abs(diff) > 0.01) {
          inst.glowIntensity += (diff > 0 ? 1 : -1) * 0.05;
          inst.glowIntensity = Math.max(0, Math.min(1, inst.glowIntensity));
        } else {
          inst.glowIntensity = targetIntensity;
        }
        if (inst.glowIntensity > 0.001) {
          var glowSize = (4 + bassPower * 12) * inst.glowIntensity;
          inst.axis.style.filter = 'drop-shadow(0 0 ' + glowSize.toFixed(1) + 'px '
            + foliaColorWithAlpha(mixed, inst.glowIntensity) + ')';
        } else {
          inst.axis.style.filter = 'none';
        }
      }

      inst.root.setAttribute('data-folia-claddagh-offset', (inst.lineOffset.get() / Math.PI).toFixed(3));
      inst.subtitle.update(ctx, ctx.dt);
    },

    destroy: function (inst) {
      if (!inst) return;
      if (inst.subtitle) inst.subtitle.destroy();
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.slots = {};
      inst.slotOrder = [];
      inst.root = null;
      inst.stage = null;
      inst.axis = null;
      inst.waiting = null;
      inst.pretext = null;
    }
  });
})();
