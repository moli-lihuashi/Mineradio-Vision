/* Folia 世界 — 歌词样式：时计（pendolo）
 *
 * 移植自 Folia src/components/visualizer/pendolo/（VisualizerPendolo 638 +
 * PendoloActiveLyricSweep 214 + PendoloClockworkCanvas 353 + pendoloClockworkDraw2d 450 +
 * pendoloClockworkMeshes 595 + pendoloClockworkWebGL 504 + pendoloClockworkScene 159 +
 * pendoloClockworkMotion 83 + pendoloGeometry 128 + pendoloMotionProfile 84 +
 * pendoloSubtitleTracks 95 + pendoloTextLayout 48 + pendoloTimeline 43 +
 * pendoloColorRuns 29 + PendoloRotatingLine 55 + tuning 10）。
 *
 * 画面 = 左侧钟表机芯 + 沿圆弧排布的歌词轮。歌词行按「当前行 = 0 度、往后为正角度」排在
 * 半径 min(w,h)*(arcRadius+0.06) 的圆弧上，只画 ±90° 的右半圆；换行时整轮按擒纵弹簧
 * 抠过一格（wheelRotation 由 spring 驱动），行自身的角度不变 —— 所以视觉上是一格一格跳。
 * 文字再按 -wheelRotation*0.65 反向修正，保持基本水平。
 *
 * 必须照抄的判据（改一处就整体走形）：
 *   - baseRadius = min(w,h)*arcRadius（齿轮盘）；歌词弧半径 = baseRadius + min(w,h)*0.06
 *   - 角度步长 = arcAngleDeg/8（9 个可见窗口）；只有 |angle| < 90° 的行进 DOM
 *   - 行间距 = max(angleStep, (prevH + curH + 24) / (2*radius))，height = 行块高 × activeScale
 *   - alpha = max(0.12, cos(angle*0.75)^2.5 * (1 - |distanceIndex|*0.18))
 *   - scale = active ? activeScale : max(0.7, 1 - |distanceIndex|*0.08)
 *   - 行透明度 = baseAlpha * clamp((110 - |angle+wheelRotation|)/28, 0, 1)，>=110° 直接 0
 *   - spring：stiffness 180*tickSnappiness*profile，damping (18+4/max(0.5,snap))*profile，mass 0.8
 *   - 焦点字号 28*fontScale / 非焦点 22*fontScale；焦点 block 预留 (main+trans)*activeScale
 *   - 焦点行扫字：底色 alpha 0.52，填充 mix(primary, accent, 0.32)，mask 4 停 + 边缘 8~16px
 *   - 字幕轨：焦点 16px / 非焦点 12px，行高 ×1.5，gap 0.25em，可读性 /[\p{L}\p{N}]/u
 *
 * 与 Folia 的实现差异（不改画面）：
 *   1) React + framer 的 useSpring 换成 core 的 foliaSpringFollower（半隐式欧拉，1/240 子步），
 *      每帧 step(targetLineIndex, dt)；wheelRotation / gearAngle 由同一个 spring 值派生。
 *   2) 机芯只移植 Canvas2D 后端（pendoloClockworkDraw2d 1:1）。Folia 优先 WebGL2，两条路径
 *      画的是同一套几何；本项目先落 2D，WebGL 后端留作后续对齐项（见 debug().clockwork.backend）。
 *   3) 无歌词（纯器乐）时 Folia 会每 5 秒切一帧 instrumental 索引。本项目 lines 为空时
 *      target 恒为 0、行集合为空 —— 只有机芯在走，与 Folia 的静默态一致。
 *   4) `line.isChorus` 来自 TTML，本项目歌词没有 → 副歌 halo/光晕常关（代码保留）。
 *
 * 依赖：@chenglou/pretext（测量换行）→ create 返回 Promise。
 */
'use strict';

(function registerFoliaPendoloMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* ------------------------------------------------------------------ *
   * 1. 调参默认值（Folia DEFAULT_PENDOLO_TUNING）与常量
   * ------------------------------------------------------------------ */
  var PENDOLO_TUNING_DEFAULT = {
    arcRadius: 0.42,
    arcAngleDeg: 100,
    wheelCenterX: 0.0,
    wheelCenterY: 0.50,
    tickSnappiness: 2.0,
    activeScale: 1.25,
    showGearDecor: 'subtle',
    showCenterGradient: true,
    showCoverOnWatchFace: false,
    enableLineGlow: false
  };

  /* 当前生效的调参：面板写在 0l0（存档键 shared），这里只读。
   * 0l0 还没加载（或模式没登记）时回落到本文件的默认值。
   * 每次修改都是**新对象**，但本模式每帧都读一次、无缓存布局，所以不需要身份判据。 */
  function pendoloTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('pendolo')
      : PENDOLO_TUNING_DEFAULT;
  }

  var PENDOLO_SCROLL_IDLE_RESET_MS = 2500;
  var PENDOLO_SCROLL_STEP_PX = 90;
  var PENDOLO_TOUCH_STEP_PX = 60;
  var PENDOLO_VISIBLE_WINDOW_COUNT = 9;
  var PENDOLO_VISIBLE_ARC_DEG = 110;
  var PENDOLO_EDGE_FADE_DEG = 28;
  var PENDOLO_LINE_RADIUS_RATIO = 0.06;
  var PENDOLO_FOCAL_FONT_PX = 28;
  var PENDOLO_IDLE_FONT_PX = 22;
  var PENDOLO_TEXT_LINE_HEIGHT_RATIO = 1.2;
  var PENDOLO_FOCAL_SUBTITLE_PX = 16;
  var PENDOLO_IDLE_SUBTITLE_PX = 12;
  var PENDOLO_SUBTITLE_LINE_HEIGHT_RATIO = 1.5;
  var PENDOLO_LEAD_TRACK_GAP_EM = 0.25;
  var PENDOLO_LEAD_TRACK_WEIGHT_FALLBACK = 500;
  var PENDOLO_SECONDARY_TRACK_SIZE_FACTOR = 0.88;
  var PENDOLO_SECONDARY_TRACK_OPACITY = 0.82;
  var PENDOLO_SECONDARY_TRACK_GAP_EM = 0.25;
  var PENDOLO_SECONDARY_TRACK_WEIGHT_FALLBACK = 400;
  var PENDOLO_SWEEP_BASE_ALPHA = 0.52;
  var PENDOLO_BLOCK_HEIGHT_WINDOW = 10;
  var PENDOLO_LAYOUT_CACHE_LIMIT = 96;
  var PENDOLO_GRAPHEME_CACHE_LIMIT = 512;
  var PENDOLO_READABLE_RE = /[\p{L}\p{N}]/u;
  var PENDOLO_SCROLL_EVENT_OPTIONS = { passive: false };

  /* ------------------------------------------------------------------ *
   * 2. 运动档位（pendoloMotionProfile.ts）
   * ------------------------------------------------------------------ */
  var PENDOLO_MOTION_PROFILES = {
    calm: {
      balanceSpeedMultiplier: 0.72,
      balanceAmplitudeMultiplier: 0.58,
      bassResponseMultiplier: 0.62,
      escapementSpringMultiplier: 0.72,
      escapementDampingMultiplier: 1.2,
      chorusHaloOpacity: 0.22,
      chorusHaloScale: 1.012,
      chorusGlowMultiplier: 0.72,
      chorusTransitionDuration: 0.52
    },
    normal: {
      balanceSpeedMultiplier: 1,
      balanceAmplitudeMultiplier: 1,
      bassResponseMultiplier: 1,
      escapementSpringMultiplier: 1,
      escapementDampingMultiplier: 1,
      chorusHaloOpacity: 0.34,
      chorusHaloScale: 1.026,
      chorusGlowMultiplier: 1,
      chorusTransitionDuration: 0.42
    },
    chaotic: {
      balanceSpeedMultiplier: 1.3,
      balanceAmplitudeMultiplier: 1.42,
      bassResponseMultiplier: 1.38,
      escapementSpringMultiplier: 1.3,
      escapementDampingMultiplier: 0.84,
      chorusHaloOpacity: 0.5,
      chorusHaloScale: 1.045,
      chorusGlowMultiplier: 1.42,
      chorusTransitionDuration: 0.3
    }
  };

  function pendoloResolveMotionProfile(intensity) {
    return (intensity === 'calm' || intensity === 'chaotic')
      ? PENDOLO_MOTION_PROFILES[intensity]
      : PENDOLO_MOTION_PROFILES.normal;
  }

  function pendoloResolveChorusPresentation(isChorus, isPlaybackActive, profile) {
    var isActive = Boolean(isChorus && isPlaybackActive);
    return {
      isActive: isActive,
      accentMix: isActive ? 0.58 : 0.32,
      haloOpacity: isActive ? profile.chorusHaloOpacity : 0,
      haloScale: isActive ? profile.chorusHaloScale : 1,
      glowMultiplier: isActive ? profile.chorusGlowMultiplier : 0,
      transitionDuration: profile.chorusTransitionDuration
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. 时间轴（pendoloTimeline.ts + graphemeTiming）
   * ------------------------------------------------------------------ */
  function pendoloFindGraphemeSequence(source, target, fromIndex) {
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

  /* Folia buildLineGraphemeTimeline：把词级时间映射回整行（含标点/空格）。 */
  function pendoloBuildLineTimeline(line) {
    var lineGraphemes = foliaSplitGraphemes(line ? line.fullText : '');
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
      var wordGraphemes = foliaSplitGraphemes(word.text);
      if (wordGraphemes.length === 0) continue;

      var matchedStart = pendoloFindGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
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

  /* Folia resolvePendoloFallbackAnchorIndex。 */
  function pendoloFallbackAnchorIndex(lines, currentLineIndex, lastValidLineIndex, hasObservedLine, currentTime) {
    if (currentLineIndex >= 0 && currentLineIndex < lines.length) return currentLineIndex;
    if (!hasObservedLine) return -1;
    var finalLine = lines[lines.length - 1];
    var finalRenderEndTime = (finalLine && finalLine.renderHints && finalLine.renderHints.renderEndTime != null)
      ? finalLine.renderHints.renderEndTime
      : (finalLine ? finalLine.endTime : undefined);
    if (finalRenderEndTime !== undefined && currentTime > finalRenderEndTime) return lines.length;
    return lastValidLineIndex + 0.5;
  }

  /* Folia resolvePendoloRotatingLineOpacity：超出可见弧就整行隐掉。 */
  function pendoloRotatingLineOpacity(baseAngleDeg, wheelRotationDeg, baseOpacity) {
    var visibleAngleDeg = Math.abs(baseAngleDeg + wheelRotationDeg);
    if (visibleAngleDeg >= PENDOLO_VISIBLE_ARC_DEG) return 0;
    var edgeProgress = Math.min(1, (PENDOLO_VISIBLE_ARC_DEG - visibleAngleDeg) / PENDOLO_EDGE_FADE_DEG);
    return baseOpacity * edgeProgress;
  }

  /* ------------------------------------------------------------------ *
   * 4. 文本布局 / 颜色（pendoloTextLayout.ts + pendoloColorRuns.ts + wordColoring）
   * ------------------------------------------------------------------ */
  function pendoloBuildTextLayout(pretext, text, fontSpec, maxWidth, lineHeight) {
    var source = (text === '' || text == null) ? ' ' : String(text);
    var prepared = pretext.prepareWithSegments(source, fontSpec, { whiteSpace: 'pre-wrap' });
    var layout = pretext.layoutWithLines(prepared, Math.max(1, maxWidth), lineHeight);
    var graphemeCursor = 0;
    var lines = (layout.lines || []).map(function (line) {
      var graphemeCount = foliaSplitGraphemes(line.text).length;
      var entry = {
        text: line.text,
        width: line.width,
        graphemeStart: graphemeCursor,
        graphemeEnd: graphemeCursor + graphemeCount
      };
      graphemeCursor += graphemeCount;
      return entry;
    });
    return {
      lines: lines,
      lineHeight: lineHeight,
      height: Math.max(lines.length, 1) * lineHeight
    };
  }

  function pendoloBuildColorRuns(text, graphemeStart, tokenColors, fallbackColor) {
    var runs = [];
    foliaSplitGraphemes(text).forEach(function (grapheme, localIndex) {
      var color = tokenColors.get(String(graphemeStart + localIndex)) || fallbackColor;
      var previous = runs[runs.length - 1];
      if (previous && previous.color === color) { previous.text += grapheme; return; }
      runs.push({ key: (graphemeStart + localIndex) + '-' + color, text: grapheme, color: color });
    });
    return runs;
  }

  /* ---- wordColoring.ts（只保留 pendolo 用到的部分） ---- */
  var PENDOLO_CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

  function pendoloNormalizeColorToken(text) {
    return String(text).toLowerCase().replace(/[^\w]/g, '');
  }

  function pendoloWordColorEntry(entry) {
    if (!entry || typeof entry !== 'object') return { word: '', color: '' };
    return {
      word: typeof entry.word === 'string' ? entry.word.trim() : '',
      color: typeof entry.color === 'string' ? entry.color : ''
    };
  }

  function pendoloPrepareMatchers(wordColors) {
    if (!wordColors || wordColors.length === 0) return [];
    var matchers = [];
    for (var i = 0; i < wordColors.length; i++) {
      var entry = pendoloWordColorEntry(wordColors[i]);
      if (!entry.word || !entry.color) continue;
      if (PENDOLO_CJK_RE.test(entry.word)) {
        matchers.push({ color: entry.color, cjkPhrases: [entry.word], englishWords: [], priority: entry.word.length });
      } else {
        var words = entry.word.split(/\s+/).map(pendoloNormalizeColorToken).filter(Boolean);
        if (words.length === 0) continue;
        var priority = 0;
        for (var k = 0; k < words.length; k++) priority = Math.max(priority, words[k].length);
        matchers.push({ color: entry.color, cjkPhrases: [], englishWords: words, priority: priority });
      }
    }
    return matchers;
  }

  function pendoloRangesOverlap(a, b) {
    return a.startOffset < b.endOffset && b.startOffset < a.endOffset;
  }

  function pendoloSelectRanges(ranges) {
    var selected = [];
    var sorted = ranges.slice().sort(function (a, b) {
      return (b.priority - a.priority) || (a.startOffset - b.startOffset) || (a.endOffset - b.endOffset);
    });
    for (var i = 0; i < sorted.length; i++) {
      var range = sorted[i];
      var overlaps = false;
      for (var k = 0; k < selected.length; k++) {
        if (pendoloRangesOverlap(selected[k], range)) { overlaps = true; break; }
      }
      if (!overlaps) selected.push(range);
    }
    return selected.sort(function (a, b) {
      return (a.startOffset - b.startOffset) || (a.endOffset - b.endOffset);
    });
  }

  function pendoloBuildColorRanges(lineText, matchers) {
    if (!lineText || matchers.length === 0) return [];
    var ranges = [];
    var englishColorByWord = new Map();

    for (var i = 0; i < matchers.length; i++) {
      var matcher = matchers[i];
      for (var p = 0; p < matcher.cjkPhrases.length; p++) {
        var target = matcher.cjkPhrases[p];
        var cursor = 0;
        while (cursor < lineText.length) {
          var startOffset = lineText.indexOf(target, cursor);
          if (startOffset < 0) break;
          ranges.push({
            startOffset: startOffset,
            endOffset: startOffset + target.length,
            color: matcher.color,
            priority: matcher.priority
          });
          cursor = startOffset + Math.max(target.length, 1);
        }
      }
      for (var w = 0; w < matcher.englishWords.length; w++) {
        var word = matcher.englishWords[w];
        var current = englishColorByWord.get(word);
        if (!current || matcher.priority > current.priority) {
          englishColorByWord.set(word, { color: matcher.color, priority: matcher.priority });
        }
      }
    }

    if (englishColorByWord.size > 0) {
      var wordRegex = /\w+/g;
      var match;
      while ((match = wordRegex.exec(lineText)) !== null) {
        var wordColor = englishColorByWord.get(pendoloNormalizeColorToken(match[0]));
        if (!wordColor) continue;
        ranges.push({
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          color: wordColor.color,
          priority: wordColor.priority
        });
      }
    }

    return pendoloSelectRanges(ranges);
  }

  function pendoloResolveTokenColors(tokens, ranges) {
    var colors = new Map();
    var rangeIndex = 0;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (!token.timed) continue;
      while (rangeIndex < ranges.length && ranges[rangeIndex].endOffset <= token.startOffset) rangeIndex += 1;
      var range = ranges[rangeIndex];
      if (range && pendoloRangesOverlap(range, token)) colors.set(token.key, range.color);
    }
    return colors;
  }

  /* ------------------------------------------------------------------ *
   * 5. 字幕轨（pendoloSubtitleTracks.ts）
   * ------------------------------------------------------------------ */
  function pendoloSubtitleTracks(line, focal, mode, subtitleFontScale) {
    if (!line || mode === 'none') return [];
    var text = String(line.translation == null ? '' : line.translation).trim();
    if (!text || !PENDOLO_READABLE_RE.test(text)) return [];
    var scale = isFinite(subtitleFontScale) && subtitleFontScale > 0 ? subtitleFontScale : 1;
    var basePx = (focal ? PENDOLO_FOCAL_SUBTITLE_PX : PENDOLO_IDLE_SUBTITLE_PX) * scale;
    var fontPx = Math.round(basePx);
    return [{
      role: 'translation',
      text: text,
      fontPx: fontPx,
      lineHeightPx: fontPx * PENDOLO_SUBTITLE_LINE_HEIGHT_RATIO,
      fontWeightFallback: PENDOLO_LEAD_TRACK_WEIGHT_FALLBACK,
      gapEm: PENDOLO_LEAD_TRACK_GAP_EM,
      opacityFactor: 1
    }];
  }

  function pendoloSumTrackHeights(tracks, measure) {
    var total = 0;
    for (var i = 0; i < tracks.length; i++) {
      total += measure(tracks[i]) + tracks[i].gapEm * tracks[i].fontPx;
    }
    return total;
  }

  /* ------------------------------------------------------------------ *
   * 6. 轮盘几何（pendoloGeometry.ts）
   * ------------------------------------------------------------------ */
  function pendoloWheelLayout(lines, targetLineIndex, escapementAngleOffsetRad, viewportWidth, viewportHeight, tuning, radiusOffsetPx, lineBlockHeights) {
    var centerX = viewportWidth * tuning.wheelCenterX;
    var centerY = viewportHeight * tuning.wheelCenterY;
    var baseRadius = Math.min(viewportWidth, viewportHeight) * tuning.arcRadius + radiusOffsetPx;

    var totalArcRad = (tuning.arcAngleDeg * Math.PI) / 180;
    var angleStepRad = totalArcRad / Math.max(1, PENDOLO_VISIBLE_WINDOW_COUNT - 1);

    var isIntegerTarget = Math.floor(targetLineIndex) === targetLineIndex;
    var activeIndex = (isIntegerTarget && targetLineIndex >= 0 && targetLineIndex < lines.length) ? targetLineIndex : -1;
    var hasActive = activeIndex >= 0;
    var items = [];

    var centerRef = Math.max(0, Math.min(lines.length - 1, Math.floor(targetLineIndex >= 0 ? targetLineIndex : 0)));
    var windowStart = Math.max(0, centerRef - 8);
    var windowEnd = Math.min(lines.length - 1, centerRef + 8);
    var visualAngles = new Map();

    if (isIntegerTarget && targetLineIndex >= windowStart && targetLineIndex <= windowEnd) {
      visualAngles.set(targetLineIndex, 0);
      for (var up = targetLineIndex + 1; up <= windowEnd; up++) {
        var prevHeight = (lineBlockHeights && lineBlockHeights[up - 1]) || 0;
        var curHeight = (lineBlockHeights && lineBlockHeights[up]) || 0;
        var spacingUp = Math.max(angleStepRad, (prevHeight + curHeight + 24) / (2 * baseRadius));
        visualAngles.set(up, (visualAngles.get(up - 1) || 0) + spacingUp);
      }
      for (var down = targetLineIndex - 1; down >= windowStart; down--) {
        var nextHeight = (lineBlockHeights && lineBlockHeights[down + 1]) || 0;
        var selfHeight = (lineBlockHeights && lineBlockHeights[down]) || 0;
        var spacingDown = Math.max(angleStepRad, (nextHeight + selfHeight + 24) / (2 * baseRadius));
        visualAngles.set(down, (visualAngles.get(down + 1) || 0) - spacingDown);
      }
    }

    for (var i = windowStart; i <= windowEnd; i++) {
      var line = lines[i];
      if (!line) continue;

      var distanceIndex = i - targetLineIndex;
      var angleValue = visualAngles.has(i) ? visualAngles.get(i) : distanceIndex * angleStepRad;
      var rawAngleRad = angleValue + escapementAngleOffsetRad;

      /* 只画右半圆：|angle| >= 90° 的行连 DOM 都不建 */
      if (Math.abs(rawAngleRad) >= Math.PI / 2) continue;

      var isActive = hasActive && i === activeIndex;
      var absDistance = Math.abs(distanceIndex);

      items.push({
        line: line,
        index: i,
        angleRad: rawAngleRad,
        angleDeg: (rawAngleRad * 180) / Math.PI,
        x: centerX + baseRadius * Math.cos(rawAngleRad),
        y: centerY + baseRadius * Math.sin(rawAngleRad),
        isActive: isActive,
        distanceFromActive: absDistance,
        alpha: Math.max(0.12, Math.pow(Math.cos(rawAngleRad * 0.75), 2.5) * (1 - absDistance * 0.18)),
        scale: isActive ? tuning.activeScale : Math.max(0.7, 1 - absDistance * 0.08)
      });
    }

    return items;
  }

  /* ------------------------------------------------------------------ *
   * 7. 机芯：调色板 / 锚点 / 画布盒 / 运动仿真
   * ------------------------------------------------------------------ */
  function pendoloClockworkPalette(primaryTextColor, accentTextColor, showGearDecor) {
    var isFull = showGearDecor === 'full';
    var m = isFull ? 1.0 : 0.6;
    return {
      decorOpacityMultiplier: m,
      primaryAlpha10: foliaColorWithAlpha(primaryTextColor, 0.10 * m),
      primaryAlpha15: foliaColorWithAlpha(primaryTextColor, 0.15 * m),
      accentAlpha35: foliaColorWithAlpha(accentTextColor, 0.35 * m),
      gearPrimaryAlpha: foliaColorWithAlpha(primaryTextColor, 0.42 * m),
      gearPrimarySubtleAlpha: foliaColorWithAlpha(primaryTextColor, 0.32 * m),
      gearAccentAlpha: foliaColorWithAlpha(accentTextColor, 0.58 * m),
      gearAccentStrongAlpha: foliaColorWithAlpha(accentTextColor, 0.72 * m),
      planetGearAlpha: foliaColorWithAlpha(primaryTextColor, 0.24 * m),
      jewelFillColor: foliaColorWithAlpha(accentTextColor, 0.28 * m),
      jewelStrokeColor: foliaColorWithAlpha(accentTextColor, 0.65 * m),
      mainGearFill: foliaColorWithAlpha(accentTextColor, 0.08 * m),
      balanceGearFill: foliaColorWithAlpha(accentTextColor, 0.10 * m),
      secondGearFill: foliaColorWithAlpha(accentTextColor, 0.06 * m),
      bevelRing: foliaColorWithAlpha(primaryTextColor, 0.18 * m),
      rivetStroke: foliaColorWithAlpha(primaryTextColor, 0.25 * m),
      guillocheAlt: foliaColorWithAlpha(primaryTextColor, 0.07 * m),
      genevaAlt: foliaColorWithAlpha(primaryTextColor, 0.06 * m),
      idlerStroke: foliaColorWithAlpha(primaryTextColor, 0.28 * m),
      idlerInner: foliaColorWithAlpha(primaryTextColor, 0.18 * m)
    };
  }

  function pendoloClockworkAnchors(centerX, centerY, baseRadius, lyricRingRadius) {
    var balanceCx = centerX + baseRadius * 0.2;
    var balanceCy = centerY - baseRadius * 0.75;
    var balanceR = baseRadius * 0.28;
    var transCx = centerX + baseRadius * 0.32;
    var transCy = centerY + baseRadius * 0.78;
    var transR = baseRadius * 0.34;
    var secondGearCx = centerX + baseRadius * 0.68;
    var secondGearCy = centerY + baseRadius * 0.76;
    var secondGearR = baseRadius * 0.16;
    var idlerCx = (transCx + secondGearCx) * 0.5 + baseRadius * 0.04;
    var idlerCy = (transCy + secondGearCy) * 0.5 - baseRadius * 0.02;
    var idlerR = baseRadius * 0.08;
    return {
      balanceCx: balanceCx,
      balanceCy: balanceCy,
      balanceR: balanceR,
      transCx: transCx,
      transCy: transCy,
      transR: transR,
      secondGearCx: secondGearCx,
      secondGearCy: secondGearCy,
      secondGearR: secondGearR,
      idlerCx: idlerCx,
      idlerCy: idlerCy,
      idlerR: idlerR,
      focalAxisEndRadius: Math.min(lyricRingRadius - Math.max(14, baseRadius * 0.025)),
      orbitR: baseRadius * 0.52,
      planetR: baseRadius * 0.16,
      coverRadius: baseRadius * 0.88,
      gradientR: baseRadius * 1.65
    };
  }

  function pendoloClockworkBox(centerX, centerY, baseRadius, lyricRingRadius, viewportWidth, viewportHeight, hasCenterGradient) {
    var reach = baseRadius * (hasCenterGradient ? 1.65 : 1.4) + 16;
    var rightReach = Math.max(reach, lyricRingRadius + 16);
    var left = Math.max(0, Math.floor(centerX - reach));
    var top = Math.max(0, Math.floor(centerY - reach));
    var right = Math.min(viewportWidth, Math.ceil(centerX + rightReach));
    var bottom = Math.min(viewportHeight, Math.ceil(centerY + reach));
    return {
      left: left,
      top: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function pendoloCreateMotionState() {
    return {
      phase: 0,
      smoothedBass: 0.15,
      secondGearElapsed: 0,
      secondGearStep: 0,
      secondGearAngle: 0,
      secondGearVelocity: 0
    };
  }

  function pendoloNormalizeBass(value) {
    var norm = value > 1 ? value / 255 : value;
    return Math.max(0, Math.min(1, isFinite(norm) ? norm : 0));
  }

  function pendoloStepMotion(state, dt, rawBass, paused, profile) {
    var clampedBass = pendoloNormalizeBass(rawBass);
    state.smoothedBass += (clampedBass - state.smoothedBass) * Math.min(0.24, 0.12 * profile.bassResponseMultiplier);
    var bass = state.smoothedBass;

    if (!paused) {
      state.phase += dt * (2.8 + bass * 3.5 * profile.bassResponseMultiplier) * profile.balanceSpeedMultiplier;
      state.secondGearElapsed += dt;
      var completedSteps = Math.floor(state.secondGearElapsed);
      if (completedSteps > 0) {
        state.secondGearStep += completedSteps;
        state.secondGearElapsed -= completedSteps;
      }
      var secondGearTarget = state.secondGearStep * (Math.PI * 2 / 15);
      var displacement = secondGearTarget - state.secondGearAngle;
      state.secondGearVelocity += displacement * 92 * profile.escapementSpringMultiplier * dt;
      state.secondGearVelocity *= Math.exp(-13 * profile.escapementDampingMultiplier * dt);
      state.secondGearAngle += state.secondGearVelocity * dt;
    }

    return {
      bass: bass,
      bassOscillation: Math.sin(state.phase) * (0.15 + bass * 0.70 * profile.bassResponseMultiplier) * profile.bassAmplitudeMultiplier,
      secondGearAngle: state.secondGearAngle,
      phase: state.phase
    };
  }

  /* ------------------------------------------------------------------ *
   * 8. 机芯：Canvas2D 绘制（pendoloClockworkDraw2d.ts 1:1）
   * ------------------------------------------------------------------ */
  function pendoloDrawGearTeeth(ctx, cx, cy, radius, teethCount, toothDepth, rotationRad, strokeColor, lineWidth, fillColor) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);

    var innerR = radius - toothDepth;
    var outerR = radius;
    var anglePerTooth = (Math.PI * 2) / teethCount;

    ctx.beginPath();
    for (var i = 0; i < teethCount; i++) {
      var baseAngle = i * anglePerTooth;
      var a0 = baseAngle - anglePerTooth * 0.22;
      var a1 = baseAngle - anglePerTooth * 0.12;
      var a2 = baseAngle + anglePerTooth * 0.12;
      var a3 = baseAngle + anglePerTooth * 0.22;

      var x0 = innerR * Math.cos(a0);
      var y0 = innerR * Math.sin(a0);
      var x1 = outerR * Math.cos(a1);
      var y1 = outerR * Math.sin(a1);
      var x2 = outerR * Math.cos(a2);
      var y2 = outerR * Math.sin(a2);
      var x3 = innerR * Math.cos(a3);
      var y3 = innerR * Math.sin(a3);

      if (i === 0) ctx.moveTo(x0, y0);
      else ctx.lineTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
    }
    ctx.closePath();

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  function pendoloDrawSpokedWheel(ctx, cx, cy, hubR, rimR, spokeCount, rotationRad, strokeColor, lineWidth) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;

    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, rimR, 0, Math.PI * 2);
    ctx.stroke();

    var angleStep = (Math.PI * 2) / spokeCount;
    for (var i = 0; i < spokeCount; i++) {
      var a = i * angleStep;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(a), hubR * Math.sin(a));
      ctx.lineTo(rimR * Math.cos(a), rimR * Math.sin(a));
      ctx.stroke();
    }

    var midR = (hubR + rimR) * 0.5;
    var holeR = (rimR - hubR) * 0.22;
    for (var k = 0; k < spokeCount; k++) {
      var ha = k * angleStep + angleStep * 0.5;
      ctx.beginPath();
      ctx.arc(midR * Math.cos(ha), midR * Math.sin(ha), holeR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function pendoloDrawHairspring(ctx, cx, cy, startR, endR, coils, oscillationRad, strokeColor, lineWidth) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(oscillationRad);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;

    var totalAngle = coils * Math.PI * 2;
    var steps = coils * 60;
    ctx.beginPath();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var angle = t * totalAngle;
      var r = startR + (endR - startR) * Math.pow(t, 0.9);
      var x = r * Math.cos(angle);
      var y = r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function pendoloDrawJewel(ctx, cx, cy, outerR, innerR, strokeOuter, strokeInner, outerWidth, innerWidth) {
    ctx.strokeStyle = strokeOuter;
    ctx.lineWidth = outerWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = strokeInner;
    ctx.lineWidth = innerWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
  }

  function pendoloDrawClockwork2d(ctx, frame) {
    var centerX = frame.centerX;
    var centerY = frame.centerY;
    var baseRadius = frame.baseRadius;
    var escapementAngle = frame.escapementAngle;
    var phase = frame.phase;
    var bassOscillation = frame.bassOscillation;
    var secondGearAngle = frame.secondGearAngle;
    var primaryTextColor = frame.primaryTextColor;
    var accentTextColor = frame.accentTextColor;
    var backgroundColor = frame.backgroundColor;
    var showGearDecor = frame.showGearDecor;

    var anchors = pendoloClockworkAnchors(centerX, centerY, baseRadius, frame.lyricRingRadius);

    if (frame.showCenterGradient) {
      var bgCol = backgroundColor || '#000000';
      var grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, anchors.gradientR);
      grad.addColorStop(0, foliaColorWithAlpha(bgCol, 0.72));
      grad.addColorStop(0.35, foliaColorWithAlpha(bgCol, 0.52));
      grad.addColorStop(0.7, foliaColorWithAlpha(bgCol, 0.20));
      grad.addColorStop(1, foliaColorWithAlpha(bgCol, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, anchors.gradientR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (frame.showCover && frame.coverImage) {
      var coverRadius = anchors.coverRadius;
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, coverRadius, 0, Math.PI * 2);
      ctx.clip();
      var isFullDecor = showGearDecor === 'full';
      ctx.globalAlpha = 0.42 * (isFullDecor ? 1.0 : 0.6);
      var size = coverRadius * 2;
      ctx.drawImage(frame.coverImage, centerX - coverRadius, centerY - coverRadius, size, size);
      ctx.restore();
    }

    if (showGearDecor === 'none') return;

    var palette = pendoloClockworkPalette(primaryTextColor, accentTextColor, showGearDecor);
    var m = palette.decorOpacityMultiplier;

    /* 1. 同心引导环 */
    ctx.strokeStyle = palette.primaryAlpha15;
    ctx.lineWidth = 1;
    var ringRadii = [baseRadius * 0.3, baseRadius * 0.6, baseRadius * 0.85, baseRadius * 1.15, baseRadius * 1.4];
    for (var r = 0; r < ringRadii.length; r++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadii[r], 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 外圈刻度：每 6 度一根，每 5 根加重 */
    var tickCount = 60;
    var outerTickR = baseRadius * 1.15;
    for (var i = 0; i < tickCount; i++) {
      var angle = (i * Math.PI * 2) / tickCount + escapementAngle * 0.2;
      var isMajor = i % 5 === 0;
      var tickLen = isMajor ? 12 : 6;
      ctx.strokeStyle = isMajor ? palette.accentAlpha35 : palette.primaryAlpha15;
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(centerX + outerTickR * Math.cos(angle), centerY + outerTickR * Math.sin(angle));
      ctx.lineTo(centerX + (outerTickR + tickLen) * Math.cos(angle), centerY + (outerTickR + tickLen) * Math.sin(angle));
      ctx.stroke();
    }

    /* 2. 主擒纵齿轮外圈 + 内辐条 */
    pendoloDrawGearTeeth(ctx, centerX, centerY, baseRadius + 8, 36, 10, escapementAngle, palette.gearAccentAlpha, 2.2, palette.mainGearFill);
    pendoloDrawSpokedWheel(ctx, centerX, centerY, baseRadius * 0.2, baseRadius * 0.85, 6, escapementAngle, palette.gearPrimaryAlpha, 1.8);

    ctx.strokeStyle = palette.bevelRing;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius * 0.92, 0, Math.PI * 2);
    ctx.stroke();

    /* 玑镂纹 */
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(escapementAngle);
    var guillocheInnerR = baseRadius * 0.62;
    var guillocheOuterR = baseRadius * 0.83;
    for (var g = 0; g < 48; g++) {
      var ga = (g * Math.PI * 2) / 48;
      var innerOffset = g % 2 === 0 ? guillocheInnerR : guillocheInnerR + (guillocheOuterR - guillocheInnerR) * 0.3;
      ctx.strokeStyle = g % 2 === 0 ? palette.primaryAlpha10 : palette.guillocheAlt;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(innerOffset * Math.cos(ga), innerOffset * Math.sin(ga));
      ctx.lineTo(guillocheOuterR * Math.cos(ga), guillocheOuterR * Math.sin(ga));
      ctx.stroke();
    }
    ctx.restore();

    /* 外圈铆钉 */
    var rivetR = baseRadius * 0.96;
    for (var rv = 0; rv < 12; rv++) {
      var ra = (rv * Math.PI * 2) / 12 + escapementAngle;
      ctx.strokeStyle = palette.rivetStroke;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(centerX + rivetR * Math.cos(ra), centerY + rivetR * Math.sin(ra), 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 3. 中心轮 + 轴心宝石 */
    pendoloDrawGearTeeth(ctx, centerX, centerY, baseRadius * 0.22, 12, 6, -escapementAngle * 2.5, palette.gearAccentStrongAlpha, 2.1);
    pendoloDrawJewel(ctx, centerX, centerY, 4.5, 2.5, palette.jewelStrokeColor, palette.jewelFillColor, 1.2, 0.8);

    /* 4. 行星轮组 */
    var orbitAngleBase = escapementAngle * 0.4;
    for (var planetIdx = 0; planetIdx < 3; planetIdx++) {
      var planetAngle = orbitAngleBase + (planetIdx * Math.PI * 2) / 3;
      var px = centerX + anchors.orbitR * Math.cos(planetAngle);
      var py = centerY + anchors.orbitR * Math.sin(planetAngle);
      pendoloDrawGearTeeth(ctx, px, py, anchors.planetR, 14, 5, -escapementAngle * 3 + planetIdx * 0.5, palette.planetGearAlpha, 1.7);
      pendoloDrawJewel(ctx, px, py, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7);
    }

    /* 5. 左上摆轮 + 游丝 */
    var balanceGearAngle = phase * 0.1;
    pendoloDrawGearTeeth(ctx, anchors.balanceCx, anchors.balanceCy, anchors.balanceR, 20, 7, balanceGearAngle, palette.gearAccentStrongAlpha, 2.1, palette.balanceGearFill);
    ctx.strokeStyle = palette.gearPrimarySubtleAlpha;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(anchors.balanceCx, anchors.balanceCy, anchors.balanceR * 0.52, 0, Math.PI * 2);
    ctx.stroke();
    pendoloDrawHairspring(
      ctx, anchors.balanceCx, anchors.balanceCy,
      anchors.balanceR * 0.56, anchors.balanceR * 0.88, 3.5,
      bassOscillation * 0.6 + balanceGearAngle * 0.3,
      foliaColorWithAlpha(accentTextColor, 0.30 * m), 0.8
    );
    pendoloDrawJewel(ctx, anchors.balanceCx, anchors.balanceCy, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7);

    /* 中间传动齿轮 + 日内瓦纹 */
    pendoloDrawGearTeeth(ctx, anchors.transCx, anchors.transCy, anchors.transR, 24, 7, -escapementAngle * 1.4, palette.gearPrimaryAlpha, 1.8);
    pendoloDrawSpokedWheel(ctx, anchors.transCx, anchors.transCy, anchors.transR * 0.25, anchors.transR * 0.85, 5, -escapementAngle * 1.4, palette.gearPrimarySubtleAlpha, 1.5);

    ctx.save();
    ctx.translate(anchors.transCx, anchors.transCy);
    ctx.rotate(-escapementAngle * 1.4);
    ctx.beginPath();
    ctx.arc(0, 0, anchors.transR * 0.80, 0, Math.PI * 2);
    ctx.clip();
    var genevaSpan = anchors.transR * 1.6;
    var genevaStep = genevaSpan / 10;
    for (var gi = 1; gi <= 9; gi++) {
      var yOff = -genevaSpan * 0.5 + gi * genevaStep;
      ctx.strokeStyle = gi % 2 === 0 ? palette.primaryAlpha10 : palette.genevaAlt;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-anchors.transR, yOff);
      ctx.lineTo(anchors.transR, yOff);
      ctx.stroke();
    }
    ctx.restore();
    pendoloDrawJewel(ctx, anchors.transCx, anchors.transCy, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7);

    /* 秒轮：每过一秒咬一格 */
    pendoloDrawGearTeeth(ctx, anchors.secondGearCx, anchors.secondGearCy, anchors.secondGearR, 15, 5, secondGearAngle, palette.gearAccentAlpha, 1.8, palette.secondGearFill);
    pendoloDrawSpokedWheel(ctx, anchors.secondGearCx, anchors.secondGearCy, anchors.secondGearR * 0.28, anchors.secondGearR * 0.76, 4, -secondGearAngle, palette.gearPrimarySubtleAlpha, 1.3);
    pendoloDrawJewel(ctx, anchors.secondGearCx, anchors.secondGearCy, 2.8, 1.5, palette.jewelStrokeColor, palette.jewelFillColor, 0.8, 0.6);

    /* 惰轮 */
    pendoloDrawGearTeeth(ctx, anchors.idlerCx, anchors.idlerCy, anchors.idlerR, 10, 3.5, escapementAngle * 2.2, palette.idlerStroke, 1.3);
    ctx.strokeStyle = palette.idlerInner;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(anchors.idlerCx, anchors.idlerCy, anchors.idlerR * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    pendoloDrawJewel(ctx, anchors.idlerCx, anchors.idlerCy, 2.2, 1.2, palette.jewelStrokeColor, palette.jewelFillColor, 0.7, 0.5);

    /* 6. 焦点轴线 + 箭头 */
    ctx.strokeStyle = palette.gearAccentStrongAlpha;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX + baseRadius * 0.8, centerY);
    ctx.lineTo(centerX + anchors.focalAxisEndRadius, centerY);
    ctx.stroke();

    var arrowX = centerX + anchors.focalAxisEndRadius;
    ctx.fillStyle = palette.gearAccentStrongAlpha;
    ctx.beginPath();
    ctx.moveTo(arrowX, centerY - 4);
    ctx.lineTo(arrowX + 8, centerY);
    ctx.lineTo(arrowX, centerY + 4);
    ctx.closePath();
    ctx.fill();
  }

  /* ------------------------------------------------------------------ *
   * 9. DOM
   * ------------------------------------------------------------------ */
  function pendoloMakeBalanceIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    /* lucide Star（Folia 的兜底图标） */
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.398 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '1.2');
    svg.appendChild(path);
    return svg;
  }

  function pendoloBuildDom(host, ctx) {
    var root = document.createElement('div');
    root.className = 'folia-pendolo';

    var clockwork = document.createElement('div');
    clockwork.className = 'folia-pendolo-clockwork';
    var canvas = document.createElement('canvas');
    canvas.className = 'folia-pendolo-clockwork-canvas';
    clockwork.appendChild(canvas);

    var balance = document.createElement('div');
    balance.className = 'folia-pendolo-balance';
    var balanceIcon = pendoloMakeBalanceIcon();
    balance.appendChild(balanceIcon);

    var rail = document.createElement('div');
    rail.className = 'folia-pendolo-rail';

    root.appendChild(clockwork);
    root.appendChild(balance);
    root.appendChild(rail);
    host.appendChild(root);

    return {
      root: root,
      clockwork: clockwork,
      canvas: canvas,
      canvasContext: canvas.getContext('2d'),
      balance: balance,
      balanceIcon: balanceIcon,
      rail: rail
    };
  }

  function pendoloCreateLineNode() {
    var outer = document.createElement('div');
    outer.className = 'folia-pendolo-line';

    var rot = document.createElement('div');
    rot.className = 'folia-pendolo-line-rot';

    var tilt = document.createElement('div');
    tilt.className = 'folia-pendolo-line-tilt';

    var haloWrap = document.createElement('div');
    haloWrap.className = 'folia-pendolo-line-halo';

    var halo = document.createElement('div');
    halo.className = 'folia-pendolo-halo';
    halo.setAttribute('aria-hidden', 'true');

    var shift = document.createElement('div');
    shift.className = 'folia-pendolo-line-shift';

    var marker = document.createElement('span');
    marker.className = 'folia-pendolo-chorus-marker';
    marker.setAttribute('aria-hidden', 'true');

    var content = document.createElement('div');
    content.className = 'folia-pendolo-content';

    haloWrap.appendChild(halo);
    haloWrap.appendChild(shift);
    shift.appendChild(marker);
    shift.appendChild(content);
    tilt.appendChild(haloWrap);
    rot.appendChild(tilt);
    outer.appendChild(rot);

    return {
      el: outer,
      rot: rot,
      tilt: tilt,
      haloWrap: haloWrap,
      halo: halo,
      shift: shift,
      marker: marker,
      content: content,
      key: '',
      isFocal: null,
      sweepRows: [],
      lastOpacity: -1,
      lastRot: '',
      lastTilt: ''
    };
  }

  function pendoloDestroyLineNode(node) {
    if (node && node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
  }

  /* 非焦点行：一行纯文本 + 字幕轨 */
  function pendoloFillPlainContent(node, item, inputs) {
    var content = node.content;
    while (content.firstChild) content.removeChild(content.firstChild);

    var fontPx = Math.round(PENDOLO_IDLE_FONT_PX * inputs.fontScale);
    var maxWidth = inputs.availableTextWidth / item.scale;

    var textEl = document.createElement('div');
    textEl.className = 'folia-pendolo-plain';
    textEl.style.fontSize = fontPx + 'px';
    textEl.style.maxWidth = maxWidth + 'px';
    textEl.style.color = foliaColorWithAlpha(inputs.primaryTextColor, 0.75);
    textEl.textContent = item.line.fullText;
    content.appendChild(textEl);

    var tracks = pendoloSubtitleTracks(item.line, false, inputs.subtitleMode, inputs.subtitleFontScale);
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      var trackEl = document.createElement('div');
      trackEl.className = 'folia-pendolo-track';
      trackEl.setAttribute('data-pendolo-subtitle-track', track.role);
      trackEl.style.fontFamily = inputs.subtitleFontStack;
      trackEl.style.fontWeight = String(foliaResolveThemeFontWeight(inputs.subtitleTheme || inputs.theme, track.fontWeightFallback));
      trackEl.style.fontSize = track.fontPx + 'px';
      trackEl.style.maxWidth = maxWidth + 'px';
      trackEl.style.color = foliaColorWithAlpha(inputs.secondaryTextColor, 0.6);
      trackEl.style.opacity = track.opacityFactor === 1 ? '' : String(track.opacityFactor);
      trackEl.style.marginTop = track.gapEm + 'em';
      trackEl.textContent = track.text;
      content.appendChild(trackEl);
    }
    node.sweepRows = [];
  }

  /* 焦点行：多行扫字（每行两组文本 + 遮罩）+ 字幕轨 */
  function pendoloFillSweepContent(node, item, inputs) {
    var content = node.content;
    while (content.firstChild) content.removeChild(content.firstChild);

    var line = item.line;
    var fontPx = Math.round(PENDOLO_FOCAL_FONT_PX * inputs.fontScale);
    var maxWidth = inputs.availableTextWidth / item.scale;
    var lineHeight = Math.round(fontPx * PENDOLO_TEXT_LINE_HEIGHT_RATIO);
    var fontSpec = inputs.fontWeight + ' ' + fontPx + 'px ' + inputs.fontFamily;

    var timingTimeline = pendoloBuildLineTimeline(line);
    var matchers = pendoloPrepareMatchers(inputs.theme.wordColors);
    var ranges = pendoloBuildColorRanges(line.fullText, matchers);
    var charTokens = [];
    var cursor = 0;
    foliaSplitGraphemes(line.fullText).forEach(function (ch, index) {
      var startOffset = cursor;
      cursor += ch.length;
      charTokens.push({ key: String(index), timed: true, startOffset: startOffset, endOffset: cursor });
    });
    var tokenColors = pendoloResolveTokenColors(charTokens, ranges);
    var fillColor = foliaMixColors(inputs.primaryTextColor, inputs.accentTextColor, inputs.chorus.accentMix);

    var textLayout = pendoloBuildTextLayout(inputs.pretext, line.fullText, fontSpec, maxWidth, lineHeight);
    var glowFilter = inputs.chorus.isActive
      ? 'drop-shadow(0 0 ' + Math.round(fontPx * 0.3 * inputs.chorus.glowMultiplier) + 'px ' + foliaColorWithAlpha(fillColor, 0.72) + ')'
        + ' drop-shadow(0 0 ' + Math.round(fontPx * 0.62 * inputs.chorus.glowMultiplier) + 'px ' + foliaColorWithAlpha(inputs.accentTextColor, 0.28) + ')'
      : '';
    var glowPaddingPx = inputs.chorus.isActive
      ? Math.ceil(fontPx * 0.7 * inputs.chorus.glowMultiplier + 10)
      : 0;

    var block = document.createElement('div');
    block.className = 'folia-pendolo-sweep';
    block.style.fontSize = fontPx + 'px';
    block.style.lineHeight = lineHeight + 'px';
    block.style.width = maxWidth + 'px';

    node.sweepRows = [];

    for (var li = 0; li < textLayout.lines.length; li++) {
      var layoutLine = textLayout.lines[li];
      var runs = pendoloBuildColorRuns(
        layoutLine.text,
        layoutLine.graphemeStart,
        tokenColors,
        fillColor
      );
      var timings = timingTimeline.slice(layoutLine.graphemeStart, layoutLine.graphemeEnd);

      var row = document.createElement('span');
      row.className = 'folia-pendolo-sweep-row';
      row.style.width = layoutLine.width + 'px';
      row.style.height = textLayout.lineHeight + 'px';

      var base = document.createElement('span');
      base.className = 'folia-pendolo-sweep-base';
      base.style.color = foliaColorWithAlpha(inputs.primaryTextColor, PENDOLO_SWEEP_BASE_ALPHA);
      for (var bi = 0; bi < runs.length; bi++) {
        var baseRun = document.createElement('span');
        baseRun.textContent = runs[bi].text;
        base.appendChild(baseRun);
      }

      var cover = document.createElement('span');
      cover.className = 'folia-pendolo-sweep-cover';
      cover.setAttribute('aria-hidden', 'true');

      var glow = document.createElement('span');
      glow.className = 'folia-pendolo-sweep-glow';
      glow.style.inset = (-glowPaddingPx) + 'px';
      glow.style.filter = glowFilter;

      var fill = document.createElement('span');
      fill.className = 'folia-pendolo-sweep-fill';
      fill.style.padding = glowPaddingPx + 'px';
      for (var fi = 0; fi < runs.length; fi++) {
        var fillRun = document.createElement('span');
        fillRun.style.color = runs[fi].color;
        fillRun.textContent = runs[fi].text;
        fill.appendChild(fillRun);
      }

      glow.appendChild(fill);
      cover.appendChild(glow);
      row.appendChild(base);
      row.appendChild(cover);
      block.appendChild(row);

      node.sweepRows.push({
        fill: fill,
        timings: timings,
        offsets: pendoloMeasureGraphemeOffsets(inputs.pretext, layoutLine.text, fontPx, fontSpec),
        fullWidth: layoutLine.width,
        lineEndTime: line.endTime,
        fontPx: fontPx,
        glowPaddingPx: glowPaddingPx,
        lastMask: '',
        lastOpacity: -1
      });
    }

    content.appendChild(block);

    var tracks = pendoloSubtitleTracks(line, true, inputs.subtitleMode, inputs.subtitleFontScale);
    for (var ti = 0; ti < tracks.length; ti++) {
      var track = tracks[ti];
      var trackEl = document.createElement('div');
      trackEl.className = 'folia-pendolo-track';
      trackEl.setAttribute('data-pendolo-subtitle-track', track.role);
      trackEl.style.fontFamily = inputs.subtitleFontStack;
      trackEl.style.fontWeight = String(foliaResolveThemeFontWeight(inputs.subtitleTheme || inputs.theme, track.fontWeightFallback));
      trackEl.style.fontSize = track.fontPx + 'px';
      trackEl.style.maxWidth = maxWidth + 'px';
      trackEl.style.color = inputs.secondaryTextColor;
      trackEl.style.opacity = track.opacityFactor === 1 ? '' : String(track.opacityFactor);
      trackEl.style.marginTop = track.gapEm + 'em';
      trackEl.textContent = track.text;
      content.appendChild(trackEl);
    }
  }

  function pendoloMeasureGraphemeOffsets(pretext, text, fontPx, fontSpec) {
    var key = fontPx + '|' + fontSpec + '|' + text;
    var cached = pendoloGraphemeCache.get(key);
    if (cached) return cached;
    var offsets = foliaMeasurePrefixOffsets(foliaSplitGraphemes(text), function (prefix) {
      return pendoloMeasureWidth(pretext, prefix, fontSpec);
    });
    return foliaRememberBounded(pendoloGraphemeCache, key, offsets, PENDOLO_GRAPHEME_CACHE_LIMIT);
  }

  function pendoloMeasureWidth(pretext, text, fontSpec) {
    if (!text) return 0;
    try {
      var prepared = pretext.prepareWithSegments(text, fontSpec);
      var layout = pretext.layoutWithLines(prepared, 2000, 32);
      var first = layout && layout.lines && layout.lines[0];
      return first ? first.width : 0;
    } catch (_) {
      return text.length * 16;
    }
  }

  var pendoloGraphemeCache = new Map();
  var pendoloBlockHeightCache = new Map();

  /* Folia lineBlockHeights：焦点态预留高度（含字幕轨），窗口外给 0。 */
  function pendoloLineBlockHeights(inst, ctx, inputs) {
    var tuning = pendoloTuning();
    var measureWidth = inputs.availableTextWidth / tuning.activeScale;
    var fontPx = Math.round(PENDOLO_FOCAL_FONT_PX * inputs.fontScale);
    var fontSpec = inputs.fontWeight + ' ' + fontPx + 'px ' + inputs.fontFamily;
    var lineHeight = Math.round(fontPx * PENDOLO_TEXT_LINE_HEIGHT_RATIO);
    var heights = [];

    for (var i = 0; i < ctx.lines.length; i++) {
      if (Math.abs(i - inst.targetLineIndex) > PENDOLO_BLOCK_HEIGHT_WINDOW) { heights.push(0); continue; }
      var line = ctx.lines[i];
      /* 键里必须带 activeScale：高度是量出来的宽度再乘缩放，缩放变了旧值就不成立。
       * （Folia 是 useMemo 依赖 activeScale 整体重算，这里靠键把它等价补上。） */
      var cacheKey = [
        line.startTime, line.endTime, line.fullText, line.translation,
        fontPx, Math.round(measureWidth), inputs.subtitleMode, inputs.subtitleFontScale,
        tuning.activeScale
      ].join('|');
      var cached = pendoloBlockHeightCache.get(cacheKey);
      if (cached != null) { heights.push(cached); continue; }

      var mainHeight = pendoloBuildTextLayout(inputs.pretext, line.fullText, fontSpec, measureWidth, lineHeight).height;
      var tracks = pendoloSubtitleTracks(line, true, inputs.subtitleMode, inputs.subtitleFontScale);
      var translationHeight = pendoloSumTrackHeights(tracks, function (track) {
        var spec = foliaResolveThemeFontWeight(inputs.subtitleTheme || inputs.theme, track.fontWeightFallback)
          + ' ' + track.fontPx + 'px ' + inputs.subtitleFontStack;
        return pendoloBuildTextLayout(inputs.pretext, track.text, spec, measureWidth, track.lineHeightPx).height;
      });
      var value = (mainHeight + translationHeight) * tuning.activeScale;
      foliaRememberBounded(pendoloBlockHeightCache, cacheKey, value, PENDOLO_LAYOUT_CACHE_LIMIT);
      heights.push(value);
    }
    return heights;
  }

  /* ------------------------------------------------------------------ *
   * 10. tick
   * ------------------------------------------------------------------ */
  function pendoloTick(inst, ctx) {
    if (!inst || !inst.root) return;

    var tuning = pendoloTuning();
    var width = window.innerWidth || 1280;
    var height = window.innerHeight || 900;
    inst.viewportWidth = width;
    inst.viewportHeight = height;

    var dt = 1 / 60;
    if (isFinite(ctx.dt) && ctx.dt > 0) dt = Math.max(1 / 240, Math.min(0.05, ctx.dt));

    var theme = ctx.theme;
    var fontScale = ctx.fontScale || 1;
    inst.lines = ctx.lines || [];
    inst.subtitleMode = ctx.showTranslation ? 'translation' : 'none';
    inst.subtitleTheme = theme;
    inst.subtitleFontStack = theme.translationFontStack || theme.fontStack;
    var primaryTextColor = theme.primaryColor || '#FFFFFF';
    var accentTextColor = theme.accentColor || '#3B82F6';
    var secondaryTextColor = theme.secondaryColor || '#9CA3AF';

    var centerX = width * tuning.wheelCenterX;
    var centerY = height * tuning.wheelCenterY;
    var baseRadius = Math.min(width, height) * tuning.arcRadius;
    var lyricRadiusOffset = Math.min(width, height) * PENDOLO_LINE_RADIUS_RATIO;
    var lyricRingRadius = baseRadius + lyricRadiusOffset;
    var maxItemX = centerX + baseRadius;
    var availableTextWidth = Math.max(140, Math.min(width * 0.46, width - maxItemX - 48));

    var totalArcRad = (tuning.arcAngleDeg * Math.PI) / 180;
    var angleStepRad = totalArcRad / Math.max(1, PENDOLO_VISIBLE_WINDOW_COUNT - 1);

    /* --- 当前锚点行 --- */
    var currentLineIndex = ctx.index;
    if (currentLineIndex >= 0 && currentLineIndex < ctx.lines.length) {
      inst.lastValidLineIndex = currentLineIndex;
      inst.hasObservedLine = true;
    }
    var targetLineIndex;
    if (inst.manualAnchor !== null) {
      targetLineIndex = inst.manualAnchor;
    } else {
      targetLineIndex = pendoloFallbackAnchorIndex(
        ctx.lines,
        currentLineIndex,
        inst.lastValidLineIndex,
        inst.hasObservedLine,
        ctx.time
      );
    }
    /* 手动跳转落位后交还自动跟随（Folia 的 pendingSeekIndex） */
    if (inst.pendingSeekIndex !== null && inst.pendingSeekIndex === currentLineIndex) {
      inst.pendingSeekIndex = null;
      inst.manualAnchor = null;
      targetLineIndex = currentLineIndex;
    }
    inst.targetLineIndex = targetLineIndex;

    /* --- 擒纵弹簧：每帧朝 target 推。profile 换了才重建（k/c 在构造时闭包捕获） --- */
    var profile = pendoloResolveMotionProfile(theme.animationIntensity);
    var snappiness = isFinite(tuning.tickSnappiness) ? tuning.tickSnappiness : 2;
    var springStiffness = 180 * snappiness * profile.escapementSpringMultiplier;
    var springDamping = (18 + 4 / Math.max(0.5, snappiness)) * profile.escapementDampingMultiplier;
    if (inst.springKey !== springStiffness + '/' + springDamping) {
      inst.springKey = springStiffness + '/' + springDamping;
      inst.spring = foliaSpringFollower(springStiffness, springDamping, 0.8);
      inst.spring.set(isFinite(inst.springValue) ? inst.springValue : targetLineIndex);
    }
    if (!isFinite(inst.springValue)) { inst.spring.set(targetLineIndex); inst.springValue = targetLineIndex; }
    if (dt > 0) inst.springValue = inst.spring.step(targetLineIndex, dt);
    var springValue = isFinite(inst.springValue) ? inst.springValue : targetLineIndex;

    var wheelRotationDeg = -(springValue - targetLineIndex) * angleStepRad * (180 / Math.PI);
    var textRotationCorrectionDeg = -wheelRotationDeg * 0.65;
    var gearRotationAngleRad = springValue * angleStepRad;

    /* --- 机芯 --- */
    var motion = pendoloStepMotion(inst.motion, dt, ctx.audioBands && ctx.audioBands.bass, !!ctx.paused, profile);
    var box = pendoloClockworkBox(centerX, centerY, baseRadius, lyricRingRadius, width, height, tuning.showCenterGradient);

    inst.clockwork.style.left = box.left + 'px';
    inst.clockwork.style.top = box.top + 'px';
    inst.clockwork.style.width = box.width + 'px';
    inst.clockwork.style.height = box.height + 'px';
    inst.clockwork.style.display = tuning.showGearDecor === 'none' && !tuning.showCenterGradient
      ? 'none' : '';

    /* 线条发光（Folia PendoloClockworkCanvas.tsx:330-333）：机芯画布上一层 CSS drop-shadow，
     * 强调色决定颜色。只在开关或强调色变化时重设，避免每帧写一份字符串。 */
    var glowKey = tuning.enableLineGlow ? accentTextColor : '';
    if (inst.glowKey !== glowKey) {
      inst.glowKey = glowKey;
      inst.canvas.style.filter = glowKey
        ? 'drop-shadow(0 0 4px ' + foliaColorWithAlpha(accentTextColor, 0.65) + ')'
          + ' drop-shadow(0 0 12px ' + foliaColorWithAlpha(accentTextColor, 0.3) + ')'
        : '';
    }

    var dpr = window.devicePixelRatio || 1;
    var pixelWidth = Math.max(1, Math.round(box.width * dpr));
    var pixelHeight = Math.max(1, Math.round(box.height * dpr));
    if (box.width > 0 && box.height > 0) {
      if (inst.canvas.width !== pixelWidth || inst.canvas.height !== pixelHeight) {
        inst.canvas.width = pixelWidth;
        inst.canvas.height = pixelHeight;
      }
      var c2d = inst.canvasContext;
      if (c2d) {
        c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        c2d.clearRect(0, 0, box.width, box.height);
        pendoloDrawClockwork2d(c2d, {
          centerX: centerX - box.left,
          centerY: centerY - box.top,
          baseRadius: baseRadius,
          lyricRingRadius: lyricRingRadius,
          escapementAngle: gearRotationAngleRad,
          phase: motion.phase,
          bassOscillation: motion.bassOscillation,
          secondGearAngle: motion.secondGearAngle,
          primaryTextColor: primaryTextColor,
          accentTextColor: accentTextColor,
          backgroundColor: theme.backgroundColor || '#000000',
          showGearDecor: tuning.showGearDecor,
          showCenterGradient: tuning.showCenterGradient,
          showCover: tuning.showCoverOnWatchFace,
          coverImage: inst.coverImage
        });
      }
    }

    /* 摆轮图标（不随齿轮转，Folia 用一层独立 overlay） */
    if (tuning.showGearDecor !== 'none') {
      var iconSize = Math.max(14, baseRadius * 0.13);
      inst.balance.style.display = '';
      inst.balance.style.left = (centerX + baseRadius * 0.2) + 'px';
      inst.balance.style.top = (centerY - baseRadius * 0.75) + 'px';
      inst.balance.style.width = iconSize + 'px';
      inst.balance.style.height = iconSize + 'px';
      inst.balanceIcon.style.color = foliaColorWithAlpha(accentTextColor, 0.62);
      inst.balanceIcon.style.stroke = foliaColorWithAlpha(accentTextColor, 0.62);
    } else {
      inst.balance.style.display = 'none';
    }

    /* 封面（只在表盘上画时加载） */
    pendoloSyncCover(inst, ctx, baseRadius);

    /* --- 歌词轮 --- */
    inst.rail.style.transformOrigin = centerX + 'px ' + centerY + 'px';

    var lineBlockHeights = pendoloLineBlockHeights(inst, ctx, {
      pretext: inst.pretext,
      fontFamily: inst.fontFamily,
      fontWeight: inst.fontWeight,
      fontScale: fontScale,
      availableTextWidth: availableTextWidth,
      subtitleMode: inst.subtitleMode,
      subtitleFontScale: inst.subtitleFontScale,
      subtitleTheme: inst.subtitleTheme,
      theme: theme,
      subtitleFontStack: inst.subtitleFontStack
    });

    var items = ctx.showText
      ? pendoloWheelLayout(ctx.lines, targetLineIndex, 0, width, height, tuning, lyricRadiusOffset, lineBlockHeights)
      : [];

    var signature = items.map(function (it) {
      return it.index + ':' + it.isActive + ':' + Math.round(it.angleDeg * 100) + ':' + Math.round(it.scale * 1000);
    }).join(',') + '|' + Math.round(availableTextWidth) + '|' + Math.round(fontScale * 1000)
      + '|' + inst.subtitleMode + '|' + Math.round(inst.subtitleFontScale * 100);

    var inputs = {
      pretext: inst.pretext,
      theme: theme,
      fontFamily: inst.fontFamily,
      fontWeight: inst.fontWeight,
      fontScale: fontScale,
      availableTextWidth: availableTextWidth,
      subtitleMode: inst.subtitleMode,
      subtitleFontScale: inst.subtitleFontScale,
      subtitleTheme: inst.subtitleTheme,
      subtitleFontStack: inst.subtitleFontStack,
      primaryTextColor: primaryTextColor,
      accentTextColor: accentTextColor,
      secondaryTextColor: secondaryTextColor
    };

    if (signature !== inst.lineSignature) {
      inst.lineSignature = signature;
      pendoloRebuildLines(inst, items, inputs, ctx, profile);
    }

    /* 每帧：整体旋转 + 每行 opacity/修正角 + 焦点行扫字 */
    inst.rail.style.transform = 'rotate(' + wheelRotationDeg.toFixed(4) + 'deg)';

    for (var i = 0; i < inst.lineNodes.length; i++) {
      var entry = inst.lineNodes[i];
      var item = entry.item;
      entry.el.style.left = item.x.toFixed(2) + 'px';
      entry.el.style.top = item.y.toFixed(2) + 'px';

      var opacity = pendoloRotatingLineOpacity(item.angleDeg, wheelRotationDeg, item.alpha);
      if (Math.abs(opacity - entry.lastOpacity) > 0.002) {
        entry.lastOpacity = opacity;
        entry.el.style.opacity = opacity.toFixed(4);
      }
      if (textRotationCorrectionDeg !== entry.lastRot) {
        entry.lastRot = textRotationCorrectionDeg;
        entry.rot.style.transform = 'rotate(' + textRotationCorrectionDeg.toFixed(4) + 'deg)';
      }
      var tiltTransform = 'rotate(' + (item.angleDeg * 0.35).toFixed(4) + 'deg) scale(' + item.scale.toFixed(4) + ')';
      if (tiltTransform !== entry.lastTilt) {
        entry.lastTilt = tiltTransform;
        entry.tilt.style.transform = tiltTransform;
      }

      /* 副歌标记只在手动滚动时出现（Folia: manualScrollAnchorIndex !== null） */
      entry.marker.style.display = (inst.manualAnchor !== null && item.line.isChorus) ? '' : 'none';

      if (item.isActive) {
        pendoloUpdateSweep(entry, ctx.time);
        var halo = entry.halo;
        var chorus = entry.chorus;
        if (chorus.isActive) {
          halo.style.display = '';
          halo.style.opacity = String(chorus.haloOpacity);
          halo.style.background = 'radial-gradient(circle at 42% 50%, '
            + foliaColorWithAlpha(accentTextColor, 0.14 * chorus.haloOpacity) + ' 0%, '
            + foliaColorWithAlpha(accentTextColor, 0.035 * chorus.haloOpacity) + ' 55%, transparent 82%)';
          halo.style.filter = 'blur(' + Math.round(10 * profile.chorusGlowMultiplier) + 'px)';
        } else {
          halo.style.display = 'none';
        }
      }
    }

    /* 行集合已在 lineSignature 变化时重建，这里不再解释一遍 */
  }

  function pendoloRebuildLines(inst, items, inputs, ctx, profile) {
    var existing = new Map();
    for (var i = 0; i < inst.lineNodes.length; i++) existing.set(inst.lineNodes[i].key, inst.lineNodes[i]);

    var next = [];
    for (var k = 0; k < items.length; k++) {
      var item = items[k];
      var key = item.line.startTime + '|' + item.line.fullText;
      var entry = existing.get(key);
      if (!entry) {
        entry = pendoloCreateLineNode();
        entry.key = key;
        entry.el.style.fontFamily = inputs.fontFamily;
        entry.el.style.fontWeight = String(inputs.fontWeight);
        inst.rail.appendChild(entry.el);
        entry.lastOpacity = -1;
      }
      existing.delete(key);

      entry.item = item;
      entry.el.setAttribute('data-pendolo-line-index', String(item.index));
      entry.el.setAttribute('data-pendolo-active', item.isActive ? '1' : '0');

      entry.chorus = pendoloResolveChorusPresentation(
        item.line.isChorus,
        item.isActive && item.index === ctx.index,
        profile
      );
      entry.haloWrap.style.transform = entry.chorus.isActive
        ? 'scale(' + entry.chorus.haloScale.toFixed(4) + ')'
        : 'scale(1)';

      if (entry.isFocal !== item.isActive) {
        entry.isFocal = item.isActive;
        if (item.isActive) pendoloFillSweepContent(entry, item, {
          pretext: inputs.pretext,
          theme: inputs.theme,
          fontFamily: inputs.fontFamily,
          fontWeight: inputs.fontWeight,
          fontScale: inputs.fontScale,
          availableTextWidth: inputs.availableTextWidth,
          subtitleMode: inputs.subtitleMode,
          subtitleFontScale: inputs.subtitleFontScale,
          subtitleTheme: inputs.subtitleTheme,
          subtitleFontStack: inputs.subtitleFontStack,
          primaryTextColor: inputs.primaryTextColor,
          accentTextColor: inputs.accentTextColor,
          secondaryTextColor: inputs.secondaryTextColor,
          chorus: entry.chorus
        });
        else pendoloFillPlainContent(entry, item, inputs);
        entry.el.classList.toggle('is-focal', item.isActive);
      }
      next.push(entry);
    }

    existing.forEach(function (entry) { pendoloDestroyLineNode(entry); });
    inst.lineNodes = next;
  }

  function pendoloUpdateSweep(entry, time) {
    for (var i = 0; i < entry.sweepRows.length; i++) {
      var row = entry.sweepRows[i];
      var fullWidth = row.offsets.length ? (row.offsets[row.offsets.length - 1] || row.fullWidth) : row.fullWidth;
      var fillWidth;
      if (row.timings.length === 0) {
        fillWidth = time >= row.lineEndTime ? fullWidth : 0;
      } else if (time <= row.timings[0].startTime) {
        fillWidth = 0;
      } else {
        fillWidth = fullWidth;
        for (var t = 0; t < row.timings.length; t++) {
          var timing = row.timings[t];
          var startWidth = row.offsets[t] != null ? row.offsets[t] : 0;
          var endWidth = row.offsets[t + 1] != null ? row.offsets[t + 1] : startWidth;
          if (time < timing.startTime) { fillWidth = startWidth; break; }
          if (time <= timing.endTime) {
            fillWidth = startWidth + (endWidth - startWidth)
              * ((time - timing.startTime) / Math.max(0.001, timing.endTime - timing.startTime));
            break;
          }
        }
      }

      var edgeSoftness = Math.min(Math.max(row.fontPx * 0.42, 8), 16);
      var paddedFillWidth = row.glowPaddingPx + fillWidth;
      var mask = 'linear-gradient(90deg, #000 0px, #000 '
        + Math.max(paddedFillWidth - edgeSoftness, 0).toFixed(2) + 'px, rgba(0, 0, 0, 0.84) '
        + paddedFillWidth.toFixed(2) + 'px, transparent '
        + (paddedFillWidth + edgeSoftness).toFixed(2) + 'px)';
      if (mask !== row.lastMask) {
        row.lastMask = mask;
        row.fill.style.maskImage = mask;
        row.fill.style.webkitMaskImage = mask;
      }

      var firstStart = row.timings.length ? row.timings[0].startTime : row.lineEndTime;
      var fillOpacity = time < firstStart ? 0 : 1;
      if (fillOpacity !== row.lastOpacity) {
        row.lastOpacity = fillOpacity;
        row.fill.style.opacity = String(fillOpacity);
      }
    }
  }

  /* 封面：只在 showCoverOnWatchFace 打开时加载；失败静默（表盘留空，不挡歌词） */
  function pendoloSyncCover(inst, ctx) {
    var tuning = pendoloTuning();
    var url = (tuning.showCoverOnWatchFace && ctx.song) ? String(ctx.song.coverUrl || '') : '';
    if (url === inst.coverUrl) return;
    inst.coverUrl = url;
    inst.coverImage = null;
    if (!url) return;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (inst.coverUrl === url) inst.coverImage = img;
    };
    img.onerror = function () { if (inst.coverUrl === url) inst.coverImage = null; };
    img.src = url;
  }

  /* ------------------------------------------------------------------ *
   * 11. 注册
   * ------------------------------------------------------------------ */
  registerFoliaMode('pendolo', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerPendolo = 时计，order 100，
     * pickerDescription.visualizer.pendolo = 封面嵌进钟表盘，歌词沿弧线随擒纵一格格推过。 */
    name: '时计',
    desc: '封面嵌进钟表盘，歌词沿弧线随擒纵一格格推过',
    order: 100,

    create: function (host, ctx) {
      return foliaLoadPretext().then(function (pretext) {
        var dom = pendoloBuildDom(host, ctx);
        var inst = {
          pretext: pretext,
          root: dom.root,
          clockwork: dom.clockwork,
          canvas: dom.canvas,
          canvasContext: dom.canvasContext,
          balance: dom.balance,
          balanceIcon: dom.balanceIcon,
          rail: dom.rail,
          viewportWidth: window.innerWidth || 1280,
          viewportHeight: window.innerHeight || 900,
          targetLineIndex: 0,
          lastValidLineIndex: 0,
          hasObservedLine: false,
          manualAnchor: null,
          manualResetTimer: null,
          pendingSeekIndex: null,
          wheelAccumulator: 0,
          wheelDirection: 0,
          touchLastY: null,
          touchAccumulator: 0,
          touchDirection: 0,
          spring: foliaSpringFollower(360, 20, 0.8),
          springKey: '',
          lines: [],
          springValue: 0,
          motion: pendoloCreateMotionState(),
          lineNodes: [],
          lineSignature: '',
          coverUrl: '',
          coverImage: null,
          fontFamily: foliaResolveThemeFontStack(ctx.theme),
          fontWeight: foliaResolveThemeFontWeight(ctx.theme, 400),
          subtitleTheme: ctx.theme,
          subtitleFontStack: ctx.theme.translationFontStack || ctx.theme.fontStack,
          subtitleMode: ctx.showTranslation ? 'translation' : 'none',
          subtitleFontScale: 1,
          destroyed: false
        };

        /* 手动滚动 / 点行 seek */
        inst.onWheel = function (event) {
          if (!inst.lineNodes.length) return;
          if (event.cancelable) event.preventDefault();
          event.stopPropagation();
          var delta = Number(event.deltaY) || 0;
          var direction = Math.abs(delta) < 1 ? 0 : (delta > 0 ? 1 : -1);
          if (direction !== 0 && inst.wheelDirection !== 0 && direction !== inst.wheelDirection) inst.wheelAccumulator = 0;
          inst.wheelDirection = direction || inst.wheelDirection;
          inst.wheelAccumulator += delta;
          var steps = Math.trunc(inst.wheelAccumulator / PENDOLO_SCROLL_STEP_PX);
          if (Math.abs(steps) > 5) steps = steps > 0 ? 5 : -5;
          if (steps !== 0) {
            inst.wheelAccumulator = 0;
            pendoloMoveManualAnchor(inst, steps);
          } else {
            pendoloScheduleManualReset(inst);
          }
        };
        inst.onTouchStart = function (event) {
          if (!inst.lineNodes.length) return;
          event.stopPropagation();
          inst.touchLastY = event.touches[0] ? event.touches[0].clientY : null;
          inst.touchAccumulator = 0;
          inst.touchDirection = 0;
          inst.manualAnchor = inst.targetLineIndex;
          pendoloScheduleManualReset(inst);
        };
        inst.onTouchMove = function (event) {
          if (!inst.lineNodes.length || inst.touchLastY === null) return;
          event.stopPropagation();
          var nextY = event.touches[0] ? event.touches[0].clientY : null;
          if (typeof nextY !== 'number') return;
          var deltaY = inst.touchLastY - nextY;
          inst.touchLastY = nextY;
          var direction = Math.abs(deltaY) < 1 ? 0 : (deltaY > 0 ? 1 : -1);
          if (direction !== 0 && inst.touchDirection !== 0 && direction !== inst.touchDirection) inst.touchAccumulator = 0;
          inst.touchDirection = direction || inst.touchDirection;
          inst.touchAccumulator += deltaY;
          var steps = Math.trunc(inst.touchAccumulator / PENDOLO_TOUCH_STEP_PX);
          if (Math.abs(steps) > 5) steps = steps > 0 ? 5 : -5;
          if (steps !== 0) {
            inst.touchAccumulator = 0;
            pendoloMoveManualAnchor(inst, steps);
          } else {
            pendoloScheduleManualReset(inst);
          }
        };
        inst.onTouchEnd = function () {
          inst.touchLastY = null;
          inst.touchDirection = 0;
          inst.touchAccumulator = 0;
          pendoloScheduleManualReset(inst);
        };

        dom.rail.addEventListener('wheel', inst.onWheel, PENDOLO_SCROLL_EVENT_OPTIONS);
        dom.rail.addEventListener('touchstart', inst.onTouchStart, PENDOLO_SCROLL_EVENT_OPTIONS);
        dom.rail.addEventListener('touchmove', inst.onTouchMove, PENDOLO_SCROLL_EVENT_OPTIONS);
        dom.rail.addEventListener('touchend', inst.onTouchEnd, PENDOLO_SCROLL_EVENT_OPTIONS);
        dom.rail.addEventListener('touchcancel', inst.onTouchEnd, PENDOLO_SCROLL_EVENT_OPTIONS);

        inst.debug = function () { return pendoloDebugState(inst); };
        return inst;
      });
    },

    tick: pendoloTick,

    destroy: function (inst) {
      if (!inst) return;
      inst.destroyed = true;
      if (inst.manualResetTimer) { window.clearTimeout(inst.manualResetTimer); inst.manualResetTimer = null; }
      if (inst.rail) {
        if (inst.onWheel) inst.rail.removeEventListener('wheel', inst.onWheel);
        if (inst.onTouchStart) inst.rail.removeEventListener('touchstart', inst.onTouchStart);
        if (inst.onTouchMove) inst.rail.removeEventListener('touchmove', inst.onTouchMove);
        if (inst.onTouchEnd) {
          inst.rail.removeEventListener('touchend', inst.onTouchEnd);
          inst.rail.removeEventListener('touchcancel', inst.onTouchEnd);
        }
      }
      for (var i = 0; i < (inst.lineNodes || []).length; i++) pendoloDestroyLineNode(inst.lineNodes[i]);
      inst.lineNodes = [];
      inst.coverImage = null;
      inst.coverUrl = '';
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.root = null;
      inst.rail = null;
      inst.canvas = null;
      inst.canvasContext = null;
      inst.clockwork = null;
      inst.balance = null;
      inst.pretext = null;
    },

  });

  /* 探针入口（注册表不认 debug 字段，必须挂到实例上） */
  function pendoloDebugState(inst) {
      return {
        mode: 'pendolo',
        targetLineIndex: inst.targetLineIndex,
        manualAnchor: inst.manualAnchor,
        spring: inst.springValue,
        lines: (inst.lineNodes || []).map(function (entry) {
          return {
            index: entry.item.index,
            key: entry.key,
            isActive: entry.item.isActive,
            angleDeg: Math.round(entry.item.angleDeg * 1000) / 1000,
            x: Math.round(entry.item.x * 100) / 100,
            y: Math.round(entry.item.y * 100) / 100,
            alpha: Math.round(entry.item.alpha * 10000) / 10000,
            scale: Math.round(entry.item.scale * 10000) / 10000,
            opacity: entry.lastOpacity,
            rotation: entry.lastRot,
            tilt: entry.lastTilt,
            focal: !!entry.isFocal,
            sweepRows: entry.sweepRows.length,
            mask: entry.sweepRows.length ? entry.sweepRows[0].lastMask : '',
            fillOpacity: entry.sweepRows.length ? entry.sweepRows[0].lastOpacity : null,
            trackCount: entry.content.querySelectorAll('[data-pendolo-subtitle-track]').length,
            text: entry.content.textContent
          };
        }),
        clockwork: {
          backend: 'canvas2d',
          painting: !!(inst.canvasContext),
          canvas: inst.canvas ? inst.canvas.width + 'x' + inst.canvas.height : '',
          phase: Math.round(inst.motion.phase * 1000) / 1000,
          secondGearAngle: Math.round(inst.motion.secondGearAngle * 1000) / 1000,
          bassOscillation: Math.round(inst.motion.bassOscillation * 10000) / 10000
        },
        tuning: pendoloTuning(),
        failReason: ''
      };
  }

  function pendoloMoveManualAnchor(inst, steps) {
    var lines = inst.lines || [];
    if (lines.length === 0) return;
    var base = inst.manualAnchor !== null ? inst.manualAnchor : inst.targetLineIndex;
    var next = Math.round(base + steps);
    next = Math.max(0, Math.min(lines.length - 1, next));
    inst.manualAnchor = next;
    pendoloScheduleManualReset(inst);
  }

  function pendoloScheduleManualReset(inst) {
    if (inst.manualResetTimer) window.clearTimeout(inst.manualResetTimer);
    inst.manualResetTimer = window.setTimeout(function () {
      inst.manualAnchor = null;
      inst.wheelAccumulator = 0;
      inst.wheelDirection = 0;
      inst.touchAccumulator = 0;
      inst.touchDirection = 0;
      inst.manualResetTimer = null;
    }, PENDOLO_SCROLL_IDLE_RESET_MS);
  }
})();
