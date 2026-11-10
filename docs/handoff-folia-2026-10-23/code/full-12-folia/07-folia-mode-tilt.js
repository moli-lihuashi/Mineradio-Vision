/* Folia 世界 — 歌词样式：倾诉（tilt）
 *
 * 移植自 Folia src/components/visualizer/tilt/VisualizerTilt.tsx（+ tuning.ts 默认值）。
 *
 * 这套样式只有一个想法：把一句歌词切成 1~4 段，每段一行，其中最多一段用「大字斜体」，
 * 其余用普通横排；段按时间顺序依次亮起，斜体那段每个字还上下交错半个字号。
 *
 * 关键机位（改动即走形）：
 *   - 段数由「字数 → 对数归一 → 抖动 → 概率」决定（determineLineCount），不是均分
 *   - 哪一段是斜体由「每段先掷一次骰子进候选，再从候选里挑一个」决定，最多一个
 *   - 字宽用量字工具实测后与可用宽度比，溢出了就整体缩（floor 0.55 普通 / 0.5 斜体）；
 *     溢出 ≥1.6 倍时先重新切更多段，切不动才缩
 *   - 段可见性 = 「时间跨过 段起点-0.25s」，且整行只在 [起点-0.1s, 渲染结束] 内有内容
 *   - 逐字脉冲：正弦起落 + 余辉 0.25 地板；斜体 ×0.18、普通 ×0.15
 *
 * 与 Folia 的两处实现差异（都不改画面）：
 *   1) Folia 是 React + framer-motion；这里用 CSS transition。逐字的「亮起位移」和
 *      「脉冲缩放」在 framer 里挤在同一个 transform 上，这里拆成内外两层，
 *      0.5s 的亮起和 0.06s 的脉冲互不干扰（叠加后观感与 framer 一致）。
 *   2) Folia 把 italic 拼在 font-spec 末尾（`300 100px stack italic`），这是非法 CSS
 *      简写，canvas 会静默忽略整条赋值 → 量出的宽度是错的，缩放判断跟着错。
 *      这里改成合法顺序 `italic 300 100px stack`，量的是真正的斜体大字。
 *
 * 依赖：@chenglou/pretext（只有 ESM 构建）→ create 返回 Promise，等 import 完再建 DOM。
 */
'use strict';

(function registerFoliaTiltMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* Folia types.ts:496 DEFAULT_TILT_TUNING。面板见 0l1 的倾诉组，值存在 0l0。 */
  var TILT_TUNING_DEFAULT = {
    splitProbability: 0.75,
    tiltStyleProbability: 0.35,
    colorScheme: 'default'
  };

  /* 现取，不抄局部常量：面板改完立刻生效；0l0 未加载时回落默认值。 */
  function tiltTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('tilt')
      : TILT_TUNING_DEFAULT;
  }

  var CHAR_REF_LENGTH = 20;
  var LOG_OFFSET = 4;
  var LINE_THRESHOLDS = [0.45, 1.05, 1.7];
  var REM_PX = 16;
  var RESPLIT_THRESHOLD = 1.6;
  var SCALE_FLOOR_NORMAL = 0.55;
  var SCALE_FLOOR_TILT = 0.5;
  var TILT_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  var TILT_SPACE_RE = /^\s+$/;

  /* pretext 只在真正用到 tilt 时加载。加载器在 16-folia-core-pretext.js（claddagh 也用它），
   * 全仓共用一个 Promise，反复切样式不会重复 import。 */
  function foliaTiltLoadPretext() {
    return foliaLoadPretext();
  }
  /* ------------------------------------------------------------------ *
   * 纯函数区
   * ------------------------------------------------------------------ */

  /* Folia 的确定性随机：sin 哈希。同一行每次算出的段数/斜体位/偏移都一样。 */
  function foliaTiltRandom(seed, offset) {
    var x = Math.sin(seed * 1000 + offset) * 10000;
    return x - Math.floor(x);
  }

  function foliaTiltDetermineLineCount(charCount, seed, splitProbability) {
    var normalized = Math.log(charCount + LOG_OFFSET) / Math.log(CHAR_REF_LENGTH + LOG_OFFSET);
    var jitter = foliaTiltRandom(seed, 1) * 0.6 + 0.7;
    var score = normalized * jitter * splitProbability;
    if (score < LINE_THRESHOLDS[0]) return 1;
    if (score < LINE_THRESHOLDS[1]) return 2;
    if (score < LINE_THRESHOLDS[2]) return 3;
    return 4;
  }

  function foliaTiltAvailableWidth() {
    var w = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
    return Math.max(320, w) * 0.85;
  }

  /* 量宽缓存：重建一次行可能问同一条文本好几次，pretext 自己也有缓存，这层只挡重复解析。 */
  var foliaTiltMeasureCache = new Map();

  function foliaTiltMeasure(pretext, text, pxSize, fontSpec) {
    var key = text + '|' + pxSize + '|' + fontSpec;
    var hit = foliaTiltMeasureCache.get(key);
    if (hit != null) return hit;
    var width = 0;
    try {
      var prepared = pretext.prepareWithSegments(text, fontSpec);
      var layout = pretext.layoutWithLines(prepared, 99999, pxSize * 1.4);
      var line = layout && layout.lines && layout.lines[0];
      width = line && isFinite(line.width) ? line.width : 0;
    } catch (_) {
      width = 0;
    }
    if (!(width > 0)) width = text.length * pxSize * 0.6;
    if (foliaTiltMeasureCache.size > 400) foliaTiltMeasureCache.clear();
    foliaTiltMeasureCache.set(key, width);
    return width;
  }

  /* 段内每个非空格字素落在哪几个词上（决定这一段的起止时间）。 */
  function foliaTiltFindSegmentWordRange(charOffset, segmentText, fullText, words) {
    var segmentStart = charOffset;
    if (segmentStart < 0 || segmentStart >= fullText.length) {
      return { startWordIndex: 0, endWordIndex: words.length };
    }
    var segmentEnd = segmentStart + segmentText.length;
    var fullTextPos = 0;
    var startWordIndex = 0;
    var endWordIndex = words.length;

    for (var wi = 0; wi < words.length; wi++) {
      var wordText = words[wi].text;
      var wordFullStart = fullText.indexOf(wordText, fullTextPos);
      if (wordFullStart === -1) {
        fullTextPos += wordText.length;
        continue;
      }
      var wordFullEnd = wordFullStart + wordText.length;
      if (wordFullStart <= segmentStart && wordFullEnd > segmentStart) startWordIndex = wi;
      if (wordFullStart < segmentEnd && wordFullEnd >= segmentEnd) {
        endWordIndex = wi + 1;
        break;
      }
      fullTextPos = wordFullEnd;
    }
    return { startWordIndex: startWordIndex, endWordIndex: endWordIndex };
  }

  /* 逐字时间：先按词切，词不够准就退回整段均分（与 Folia 同判据）。 */
  function foliaTiltBuildCharTimings(charOffset, segmentText, segmentStartTime, segmentEndTime, activeLine) {
    var graphemes = foliaSplitGraphemes(segmentText);
    if (!activeLine || graphemes.length === 0) return [];

    var nonSpaceCount = 0;
    for (var gi = 0; gi < graphemes.length; gi++) {
      if (!TILT_SPACE_RE.test(graphemes[gi])) nonSpaceCount++;
    }
    if (nonSpaceCount === 0) return [];

    var totalDuration = Math.max(segmentEndTime - segmentStartTime, 0.3);
    var range = foliaTiltFindSegmentWordRange(charOffset, segmentText, activeLine.fullText, activeLine.words || []);
    var segmentWords = (activeLine.words || []).slice(range.startWordIndex, range.endWordIndex);

    var timings = [];
    var currentCharIndex = 0;

    if (segmentWords.length > 0) {
      for (var wi = 0; wi < segmentWords.length; wi++) {
        var word = segmentWords[wi];
        var wordTimings = foliaBuildWordGraphemeTimings(word);
        var wordNonSpace = 0;
        for (var t = 0; t < wordTimings.length; t++) {
          if (!TILT_SPACE_RE.test(wordTimings[t].char)) wordNonSpace++;
        }
        if (wordNonSpace === 0) continue;

        if (word.syllables && word.syllables.length) {
          /* 本项目没有音节数据；保留这条分支只为与 Folia 结构一致。 */
          for (var st = 0; st < wordTimings.length; st++) {
            if (currentCharIndex >= nonSpaceCount) break;
            if (TILT_SPACE_RE.test(wordTimings[st].char)) continue;
            timings.push({
              charIndex: currentCharIndex,
              startTime: wordTimings[st].startTime,
              endTime: wordTimings[st].endTime
            });
            currentCharIndex++;
          }
          continue;
        }

        var wordDuration = Math.max(word.endTime - word.startTime, 0.05);
        var charDuration = wordDuration / wordNonSpace;
        var nonSpaceCi = 0;
        for (var wt = 0; wt < wordTimings.length; wt++) {
          if (currentCharIndex >= nonSpaceCount) break;
          if (TILT_SPACE_RE.test(wordTimings[wt].char)) continue;
          timings.push({
            charIndex: currentCharIndex,
            startTime: word.startTime + nonSpaceCi * charDuration,
            endTime: word.startTime + (nonSpaceCi + 1) * charDuration
          });
          currentCharIndex++;
          nonSpaceCi++;
        }
      }
    }

    if (timings.length === 0 || timings.length !== nonSpaceCount) {
      timings.length = 0;
      var avgCharDuration = totalDuration / nonSpaceCount;
      currentCharIndex = 0;
      for (var g = 0; g < graphemes.length; g++) {
        if (TILT_SPACE_RE.test(graphemes[g])) continue;
        timings.push({
          charIndex: currentCharIndex,
          startTime: segmentStartTime + currentCharIndex * avgCharDuration,
          endTime: segmentStartTime + (currentCharIndex + 1) * avgCharDuration
        });
        currentCharIndex++;
      }
    }

    return timings;
  }

  /* 逐字脉冲：0 起 → 正弦峰 → 余辉衰减 → 0.25 常驻（唱完的字保持微放大）。 */
  function foliaTiltCharPulse(time, timing) {
    var rawDuration = Math.max(timing.endTime - timing.startTime, 0.05);
    var duration = Math.min(Math.max(rawDuration, 0.2), 0.9);
    var elapsed = time - timing.startTime;
    if (elapsed < 0) return 0;
    if (elapsed <= duration) return Math.sin((elapsed / duration) * Math.PI);
    var afterElapsed = elapsed - duration;
    var afterglowRamp = duration * 1.2;
    if (afterElapsed >= afterglowRamp) return 0.25;
    return 0.25 * (afterElapsed / afterglowRamp);
  }

  function foliaTiltMarkShortLastLine(segs) {
    if (segs.length < 2) return segs;
    var last = segs[segs.length - 1];
    if (last.isTilt || last.text.trim().length > 2) return segs;
    var prev = segs[segs.length - 2];
    if (last.text.trim().length * 2 <= prev.text.length) last.isShortLastLine = true;
    return segs;
  }

  /* 段 → {text, isTilt, isShortLastLine, charOffset}。这是整套样式的排版核心。 */
  function foliaTiltBuildLayout(pretext, fullText, lineSeed, theme, fontScale) {
    var fontStack = theme.fontStack;
    var viewportWidth = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
    var measureMaxPx = Math.max(viewportWidth * 0.06875, 5.625 * REM_PX * fontScale);
    var normalBasePx = measureMaxPx;
    var tiltBasePx = measureMaxPx;
    var normalFontSpec = foliaResolveThemeFontWeight(theme, 400) + ' ' + normalBasePx + 'px ' + fontStack;
    /* 合法顺序（italic 在前）。Folia 写在末尾，canvas 会整条丢弃。 */
    var tiltFontSpec = 'italic ' + foliaResolveThemeFontWeight(theme, 300) + ' ' + tiltBasePx + 'px ' + fontStack;
    var availableWidth = foliaTiltAvailableWidth();

    var charCount = fullText.trim().length;
    var isEllipsisOnly = /^[\s.…·。]+$/.test(fullText.trim());
    var mergedSegments;

    if (isEllipsisOnly) {
      mergedSegments = [fullText];
    } else {
      var numLines = foliaTiltDetermineLineCount(charCount, lineSeed, tiltTuning().splitProbability);
      var units = foliaSplitIntoSentences(fullText, numLines, lineSeed);
      mergedSegments = units.map(function (u) { return u.text; });
    }

    /* 斜体位：每段先掷一次骰子，再在候选里挑一个。最多一个。 */
    var candidates = [];
    for (var ci = 0; ci < mergedSegments.length; ci++) {
      if (foliaTiltRandom(lineSeed, 100 + ci) < tiltTuning().tiltStyleProbability) candidates.push(ci);
    }
    var finalTiltIndex = -1;
    if (candidates.length > 0) {
      finalTiltIndex = candidates[Math.floor(foliaTiltRandom(lineSeed, 200) * candidates.length)];
    }

    var offsetAccum = 0;
    var segments = [];
    for (var si = 0; si < mergedSegments.length; si++) {
      var raw = mergedSegments[si];
      var leftTrimmed = raw.trimStart();
      var leadingSpaces = raw.length - leftTrimmed.length;
      segments.push({
        text: leftTrimmed.trimEnd(),
        isTilt: si === finalTiltIndex,
        isShortLastLine: false,
        charOffset: offsetAccum + leadingSpaces
      });
      offsetAccum += raw.length;
    }

    var scaleMultiplier = 1;
    var widestTiltWidth = 0;
    var widestNormalWidth = 0;
    var hasTiltSeg = false;
    var i;

    for (i = 0; i < segments.length; i++) {
      var segText = segments[i].text;
      if (!segText) continue;
      if (segments[i].isTilt) {
        hasTiltSeg = true;
        widestTiltWidth = Math.max(widestTiltWidth, foliaTiltMeasure(pretext, segText, tiltBasePx, tiltFontSpec));
      } else {
        widestNormalWidth = Math.max(widestNormalWidth, foliaTiltMeasure(pretext, segText, normalBasePx, normalFontSpec));
      }
    }

    var tiltOverflow = widestTiltWidth > 0 ? widestTiltWidth / availableWidth : 0;
    var normalOverflow = widestNormalWidth > 0 ? widestNormalWidth / availableWidth : 0;
    var maxOverflow = Math.max(tiltOverflow, normalOverflow);

    if (maxOverflow > 1) {
      if (maxOverflow >= RESPLIT_THRESHOLD) {
        var targetWidth = availableWidth * (RESPLIT_THRESHOLD - 0.15);
        var totalEstWidth = foliaTiltMeasure(pretext, fullText, normalBasePx, normalFontSpec);
        var extraSplitsNeeded = Math.min(4, Math.max(segments.length + 1, Math.ceil(totalEstWidth / targetWidth)));
        if (extraSplitsNeeded > segments.length) {
          var reUnits = foliaSplitIntoSentences(fullText, extraSplitsNeeded, lineSeed);
          var newSegments = [];
          var reOffset = 0;
          for (i = 0; i < reUnits.length; i++) {
            var reRaw = reUnits[i].text;
            var reLeft = reRaw.trimStart();
            newSegments.push({
              text: reLeft.trimEnd(),
              isTilt: false,
              isShortLastLine: false,
              charOffset: reOffset + (reRaw.length - reLeft.length)
            });
            reOffset += reRaw.length;
          }
          if (newSegments.length > 0 && foliaTiltRandom(lineSeed, 300) < tiltTuning().tiltStyleProbability) {
            var picked = Math.floor(foliaTiltRandom(lineSeed, 301) * newSegments.length);
            newSegments[picked].isTilt = true;
          }

          var postScale = 1;
          var postTilt = -1;
          var postWidestNormal = 0;
          for (i = 0; i < newSegments.length; i++) {
            if (newSegments[i].isTilt) { postTilt = i; break; }
          }
          if (postTilt >= 0) {
            var pw = foliaTiltMeasure(pretext, newSegments[postTilt].text, tiltBasePx, tiltFontSpec);
            if (pw > availableWidth) postScale = Math.max(SCALE_FLOOR_TILT, availableWidth / pw);
          } else {
            for (i = 0; i < newSegments.length; i++) {
              postWidestNormal = Math.max(postWidestNormal, foliaTiltMeasure(pretext, newSegments[i].text, normalBasePx, normalFontSpec));
            }
            if (postWidestNormal > availableWidth) {
              postScale = Math.max(SCALE_FLOOR_NORMAL, availableWidth / postWidestNormal);
            }
          }

          return { segments: foliaTiltMarkShortLastLine(newSegments), scaleMultiplier: postScale };
        }
      }

      if (tiltOverflow >= normalOverflow && hasTiltSeg) {
        scaleMultiplier = Math.max(SCALE_FLOOR_TILT, availableWidth / widestTiltWidth);
      } else if (widestNormalWidth > 0) {
        scaleMultiplier = Math.max(SCALE_FLOOR_NORMAL, availableWidth / widestNormalWidth);
      }
    }

    return { segments: foliaTiltMarkShortLastLine(segments), scaleMultiplier: scaleMultiplier };
  }

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */

  function foliaTiltColors(theme) {
    var scheme = tiltTuning().colorScheme;
    if (scheme === 'swap') {
      return { normal: theme.accentColor || theme.primaryColor, tilt: theme.primaryColor };
    }
    if (scheme === 'accentAll') {
      return { normal: theme.accentColor || theme.primaryColor, tilt: theme.accentColor || theme.primaryColor };
    }
    if (scheme === 'primaryAll') {
      return { normal: theme.primaryColor, tilt: theme.primaryColor };
    }
    return { normal: theme.primaryColor, tilt: theme.accentColor || theme.primaryColor };
  }

  function foliaTiltSegmentElement(seg, ctx, scaleMultiplier) {
    var theme = ctx.theme;
    var fontScale = ctx.fontScale || 1;
    var baseFontScale = fontScale * scaleMultiplier;
    var shortLastBoost = seg.isShortLastLine ? 1.18 : 1;
    var viewportWidth = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
    var tiltFontPx = Math.min(viewportWidth * 0.06875 * baseFontScale, 5.625 * REM_PX * baseFontScale);
    var yOffset = tiltFontPx / 6;

    var el = document.createElement('div');
    el.className = 'folia-tilt-seg' + (seg.isTilt ? ' is-tilt' : ' is-normal');
    el.setAttribute('data-tilt-style', seg.isTilt ? 'tilt' : 'normal');

    var colors = foliaTiltColors(theme);
    if (seg.isTilt) {
      el.style.fontSize = 'clamp(' + (3.125 * baseFontScale).toFixed(3) + 'rem, ' +
        (6.875 * baseFontScale).toFixed(3) + 'vw, ' + (5.625 * baseFontScale).toFixed(3) + 'rem)';
      el.style.color = colors.tilt;
      el.style.fontWeight = String(foliaResolveThemeFontWeight(theme, 300));
      el.style.fontStyle = 'italic';
      el.style.lineHeight = '1.25';
      el.style.letterSpacing = '0.15em';
    } else {
      el.style.fontSize = 'clamp(' + (3.125 * baseFontScale * shortLastBoost).toFixed(3) + 'rem, ' +
        (6.875 * baseFontScale * shortLastBoost).toFixed(3) + 'vw, ' +
        (5.625 * baseFontScale * shortLastBoost).toFixed(3) + 'rem)';
      el.style.color = colors.normal;
      el.style.fontWeight = String(foliaResolveThemeFontWeight(theme, 400));
      el.style.fontStyle = 'normal';
      el.style.lineHeight = '1.35';
      el.style.letterSpacing = '0.08em';
    }

    var graphemes = foliaSplitGraphemes(seg.text);
    var step = seg.isTilt ? 0.05 : 0.04;
    var spaceMinWidth = seg.isTilt ? '0.35em' : '0.25em';
    var items = [];
    var visualIndex = 0;

    for (var gi = 0; gi < graphemes.length; gi++) {
      var ch = graphemes[gi];
      var isSpace = TILT_SPACE_RE.test(ch);
      var isEven = visualIndex % 2 === 0;
      var delay = isSpace ? 0 : visualIndex * step;
      var ci = isSpace ? -1 : visualIndex;
      if (!isSpace) visualIndex++;

      var outer = document.createElement('span');
      outer.className = 'folia-tilt-g';
      outer.style.setProperty('--d', delay.toFixed(3) + 's');
      if (seg.isTilt) {
        var off = (isSpace ? 0 : (isEven ? -1 : 1) * yOffset);
        outer.style.setProperty('--off', off.toFixed(2) + 'px');
        outer.style.setProperty('--off2', (off * 2).toFixed(2) + 'px');
      } else {
        outer.style.setProperty('--off', '0px');
        outer.style.setProperty('--off2', '0px');
      }
      if (isSpace) outer.style.minWidth = spaceMinWidth;

      var inner = document.createElement('span');
      inner.className = 'folia-tilt-gi';
      inner.textContent = isSpace ? '\u00A0' : ch;
      outer.appendChild(inner);
      el.appendChild(outer);

      items.push({ el: inner, isSpace: isSpace, ci: ci, lastScale: -1 });
    }

    return { el: el, items: items, isTilt: seg.isTilt };
  }

  /* 建整行：段 + 每段的逐字时间。返回 {el, segs, timings, scaleMultiplier}。 */
  function foliaTiltBuildLine(inst, ctx) {
    var line = ctx.lines[ctx.index];
    if (!line || !line.fullText) return null;

    var layout = foliaTiltBuildLayout(inst.pretext, line.fullText, line.startTime, ctx.theme, ctx.fontScale || 1);
    if (!layout || !layout.segments.length) return null;

    var renderEnd = foliaGetLineRenderEndTime(line);
    var wrap = document.createElement('div');
    wrap.className = 'folia-tilt-line';

    var segs = [];
    var timings = [];

    for (var i = 0; i < layout.segments.length; i++) {
      var seg = layout.segments[i];
      var range = foliaTiltFindSegmentWordRange(seg.charOffset, seg.text, line.fullText, line.words || []);
      var segWords = (line.words || []).slice(range.startWordIndex, range.endWordIndex);
      var segStart, segEnd;
      if (segWords.length > 0) {
        segStart = segWords[0].startTime;
        segEnd = segWords[segWords.length - 1].endTime;
      } else {
        segStart = line.startTime;
        segEnd = renderEnd;
      }
      timings.push({ start: segStart, end: segEnd });

      var built = foliaTiltSegmentElement(seg, ctx, layout.scaleMultiplier);
      built.charTimings = foliaTiltBuildCharTimings(seg.charOffset, seg.text, segStart, segEnd, line);
      wrap.appendChild(built.el);
      segs.push(built);
    }

    return {
      el: wrap,
      segs: segs,
      timings: timings,
      scaleMultiplier: layout.scaleMultiplier,
      renderEnd: renderEnd,
      lineStart: line.startTime
    };
  }

  function foliaTiltApplyVisible(inst, visibleIndex) {
    var line = inst.line;
    if (!line) return;
    for (var i = 0; i < line.segs.length; i++) {
      var on = i <= visibleIndex;
      var cls = line.segs[i].el.classList;
      if (on) { if (!cls.contains('is-visible')) cls.add('is-visible'); }
      else if (cls.contains('is-visible')) cls.remove('is-visible');
    }
    inst.root.setAttribute('data-folia-tilt-visible', String(visibleIndex));
  }

  function foliaTiltWritePulse(seg, time) {
    var timings = seg.charTimings;
    var items = seg.items;
    var gain = seg.isTilt ? 0.18 : 0.15;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var scale = 1;
      if (!it.isSpace && it.ci >= 0 && timings && timings.length) {
        var ct = timings[it.ci];
        if (ct) scale = 1 + foliaTiltCharPulse(time, ct) * gain;
      }
      if (Math.abs(it.lastScale - scale) < 0.0004) continue;
      it.lastScale = scale;
      it.el.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }
  }

  function foliaTiltRetire(inst, entry) {
    entry.left = 0.45;
    entry.el.style.opacity = '0';
    entry.el.style.transition = 'opacity 0.45s ease-in-out';
    inst.exiting.push(entry);
  }

  /* ------------------------------------------------------------------ *
   * 模式注册
   * ------------------------------------------------------------------ */
  registerFoliaMode('tilt', {
    /* 名字/描述/排序一律取 Folia 的权威值：ui.visualizerTilt = 倾诉，
     * pickerDescription.visualizer.tilt，entry.tsx order 70。自己另起中文名会和 Folia 面板对不上。 */
    name: '倾诉',
    desc: '长句自动断行、随机斜体强调，像有人凑近低声说话',
    order: 70,

    create: function (host, ctx) {
      return foliaTiltLoadPretext().then(function (pretext) {
        var root = document.createElement('div');
        root.className = 'folia-tilt';
        root.style.fontFamily = ctx.theme.fontStack;

        var stage = document.createElement('div');
        stage.className = 'folia-tilt-stage';
        root.appendChild(stage);

        var waiting = document.createElement('div');
        waiting.className = 'folia-tilt-waiting';
        waiting.style.color = ctx.theme.secondaryColor;
        waiting.style.fontFamily = ctx.theme.fontStack;
        waiting.textContent = '等待播放';
        root.appendChild(waiting);

        host.appendChild(root);

        var inst = {
          pretext: pretext,
          root: root,
          stage: stage,
          waiting: waiting,
          subtitle: foliaCreateSubtitleOverlay(host, ctx.theme),
          line: null,
          lineKey: '',
          visibleIndex: -2,
          exiting: [],
          theme: ctx.theme,
          fontScale: ctx.fontScale || 1,
          viewportWidth: window.innerWidth || 1200,
          tuning: tiltTuning()
        };

        root.setAttribute('data-folia-tilt-scale', '1.000');
        root.setAttribute('data-folia-tilt-segments', '0');
        return inst;
      });
    },

    tick: function (inst, ctx) {
      if (!inst || !inst.root) return;

      var line = ctx.index >= 0 ? ctx.lines[ctx.index] : null;
      var viewportWidth = window.innerWidth || 1200;
      var rebuild = false;
      var key = '';

      if (!line || !line.fullText) {
        key = '';
      } else {
        key = line.startTime + '|' + line.fullText + '|' + (ctx.fontScale || 1) + '|' +
          viewportWidth + '|' + ctx.theme.fontStack + '|' + ctx.theme.weight;
      }
      /* 主题配色变了字号没变：颜色写在段上，得重建；字体栈/字重已进 key。 */
      if (ctx.theme !== inst.theme) rebuild = true;
      if (key !== inst.lineKey) rebuild = true;
      /* 调参改过：分行概率/斜体概率/配色都影响已拆好的段（分行数、哪段斜体、哪套颜色），
       * 必须整行重拆。按对象身份判（0l0 每次修改换新对象）。 */
      var tuning = tiltTuning();
      if (tuning !== inst.tuning) {
        inst.tuning = tuning;
        rebuild = true;
      }

      if (rebuild) {
        inst.theme = ctx.theme;
        inst.lineKey = key;
        inst.fontScale = ctx.fontScale || 1;
        inst.viewportWidth = viewportWidth;
        if (inst.line) {
          foliaTiltRetire(inst, inst.line);
          inst.line = null;
        }
        inst.visibleIndex = -2;
        if (key) {
          inst.line = foliaTiltBuildLine(inst, ctx);
          if (inst.line) {
            inst.line.el.classList.add('is-entering');
            inst.stage.appendChild(inst.line.el);
            inst.root.setAttribute('data-folia-tilt-scale', inst.line.scaleMultiplier.toFixed(3));
            inst.root.setAttribute('data-folia-tilt-segments', String(inst.line.segs.length));
          } else {
            inst.root.setAttribute('data-folia-tilt-segments', '0');
          }
        } else {
          inst.root.setAttribute('data-folia-tilt-segments', '0');
        }
      }

      inst.waiting.style.display = (inst.line || !ctx.showText) ? 'none' : '';

      /* 段可见性：跨过「段起点 - 0.25s」即亮；整行只在 [起点-0.1, 渲染结束] 内有内容。
       * 刚重建的那一帧不写可见性：元素是这一帧才插进去的，浏览器还没算过初始样式，
       * 同帧加 class 会把 0.5s 的逐字过渡直接压成「瞬间出现」（首段的错落会整段丢失）。 */
      var target = inst.visibleIndex;
      if (!rebuild) {
        target = -1;
        if (inst.line && ctx.showText) {
          var time = ctx.time;
          for (var i = 0; i < inst.line.timings.length; i++) {
            if (time >= inst.line.timings[i].start - 0.25) target = i;
          }
          if (time < inst.line.lineStart - 0.1 || time > inst.line.renderEnd) target = -1;
        }
      }
      if (target !== inst.visibleIndex) {
        inst.visibleIndex = target;
        foliaTiltApplyVisible(inst, target);
      }

      if (!rebuild && inst.line && ctx.showText) {
        for (var s = 0; s <= target && s < inst.line.segs.length; s++) {
          foliaTiltWritePulse(inst.line.segs[s], ctx.time);
        }
      }

      for (var k = inst.exiting.length - 1; k >= 0; k--) {
        var entry = inst.exiting[k];
        entry.left -= ctx.dt;
        if (entry.left <= 0) {
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
          inst.exiting.splice(k, 1);
        }
      }

      inst.subtitle.update(ctx, ctx.dt);
    },

    destroy: function (inst) {
      if (!inst) return;
      if (inst.subtitle) inst.subtitle.destroy();
      if (inst.exiting) {
        for (var k = 0; k < inst.exiting.length; k++) {
          if (inst.exiting[k].el && inst.exiting[k].el.parentNode) {
            inst.exiting[k].el.parentNode.removeChild(inst.exiting[k].el);
          }
        }
        inst.exiting.length = 0;
      }
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.line = null;
      inst.root = null;
      inst.stage = null;
      inst.waiting = null;
      inst.pretext = null;
    }
  });
})();
