/* Folia 世界 — 逐行渲染提示（renderHints）与逐词时序
 *
 * 对应 Folia utils/lyrics/renderHints.ts + components/visualizer/glowWordTiming.ts。
 * 一行歌词的「短到什么程度」决定入场/离场/逐词揭示的档位：
 *   micro（<0.10s）→ 无转场、瞬时揭示；short（<0.18s）→ 快速转场；其余 → 常态。
 * 这套档位是 classic / partita 等模式共用的，必须逐字照搬，否则快歌会糊成一片。
 */
'use strict';

var FOLIA_MICRO_LINE_DURATION_THRESHOLD = 0.10;
var FOLIA_SHORT_LINE_DURATION_THRESHOLD = 0.18;
var FOLIA_MICRO_LINE_RENDER_FLOOR = 0.067;

function foliaClampNum(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function foliaGetLastWordEndTime(line) {
  var words = line && line.words;
  var last = words && words.length ? words[words.length - 1] : null;
  return last && isFinite(last.endTime) ? last.endTime : line.endTime;
}

function foliaGetLineTransitionTiming(rawDuration, lineTransitionMode, wordRevealMode) {
  if (lineTransitionMode === 'none') {
    return { enterDuration: 0, exitDuration: 0, linePassHold: 0 };
  }
  if (lineTransitionMode === 'fast') {
    return {
      enterDuration: foliaClampNum(rawDuration * 0.45, 0.045, 0.06),
      exitDuration: foliaClampNum(rawDuration * 0.22, 0.03, 0.04),
      linePassHold: wordRevealMode === 'instant' ? 0 : 0.03
    };
  }
  return {
    enterDuration: Math.min(0.42, Math.max(0.22, Math.max(rawDuration, 0.12) * 0.34)),
    exitDuration: Math.min(0.32, Math.max(0.18, Math.max(rawDuration, 0.12) * 0.18)),
    linePassHold: wordRevealMode === 'instant' ? 0 : 0.06
  };
}

function foliaTimingClassOf(rawDuration) {
  if (rawDuration < FOLIA_MICRO_LINE_DURATION_THRESHOLD) return 'micro';
  if (rawDuration < FOLIA_SHORT_LINE_DURATION_THRESHOLD) return 'short';
  return 'normal';
}

function foliaBuildLineRenderEndTime(line, rawDuration, lineTransitionMode, wordRevealMode) {
  if (lineTransitionMode === 'none') {
    return Math.max(line.endTime, line.startTime + FOLIA_MICRO_LINE_RENDER_FLOOR);
  }
  var timing = foliaGetLineTransitionTiming(rawDuration, lineTransitionMode, wordRevealMode);
  var linePassStart = Math.max(foliaGetLastWordEndTime(line), line.startTime) + timing.linePassHold;
  var exitStart = lineTransitionMode === 'fast'
    ? Math.max(line.startTime + timing.enterDuration + 0.01, linePassStart, line.endTime - timing.exitDuration)
    : Math.max(linePassStart, line.endTime - timing.exitDuration);
  return Math.max(line.endTime, exitStart + timing.exitDuration);
}

function foliaBuildLineRenderHints(line) {
  var rawDuration = Math.max(line.endTime - line.startTime, 0);
  var timingClass = foliaTimingClassOf(rawDuration);
  var lineTransitionMode = timingClass === 'micro' ? 'none' : (timingClass === 'short' ? 'fast' : 'normal');
  var wordRevealMode = timingClass === 'micro' ? 'instant' : (timingClass === 'short' ? 'fast' : 'normal');
  return {
    rawDuration: rawDuration,
    timingClass: timingClass,
    renderEndTime: foliaBuildLineRenderEndTime(line, rawDuration, lineTransitionMode, wordRevealMode),
    lineTransitionMode: lineTransitionMode,
    wordRevealMode: wordRevealMode
  };
}

function foliaGetLineRenderHints(line) {
  if (!line) return null;
  if (!line.__foliaHints) line.__foliaHints = foliaBuildLineRenderHints(line);
  return line.__foliaHints;
}

function foliaGetLineRenderEndTime(line) {
  if (!line) return -Infinity;
  var hints = foliaGetLineRenderHints(line);
  return hints ? hints.renderEndTime : line.endTime;
}

/* 把一个词的 renderHints 整理成逐帧好用的 profile。 */
function foliaResolveGlowWordRenderProfile(line) {
  if (!line) return null;
  var hints = foliaGetLineRenderHints(line);
  var wordRevealMode = (hints && hints.wordRevealMode) || 'normal';
  return {
    renderHints: hints,
    lineRenderEndTime: foliaGetLineRenderEndTime(line),
    lineTransitionMode: (hints && hints.lineTransitionMode) || 'normal',
    wordRevealMode: wordRevealMode,
    wordLookahead: wordRevealMode === 'instant' ? 0.03 : (wordRevealMode === 'fast' ? 0.08 : 0.15)
  };
}

function foliaGlowWordActiveEndTime(word, profile) {
  if (profile.wordRevealMode === 'instant') return profile.lineRenderEndTime;
  if (profile.wordRevealMode === 'fast') {
    return Math.min(profile.lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12));
  }
  return word.endTime;
}

function foliaGlowWordDisplayDuration(word, profile) {
  var end = foliaGlowWordActiveEndTime(word, profile);
  var minDuration = profile.wordRevealMode === 'instant' ? 0.08 : (profile.wordRevealMode === 'fast' ? 0.12 : 0.1);
  return Math.max(end - word.startTime, minDuration);
}

/* 整行容器的入场 / 离场（opacity + scale + blur）。返回的是数值与时长，交给 12 的动画器执行。 */
function foliaGlowLineContainerMotion(profile) {
  if (profile && profile.lineTransitionMode === 'none') {
    return {
      enter: { opacity: 1, scale: 1, blur: 0, duration: 0 },
      exit: { opacity: 0, scale: 1.02, blur: 6, duration: 0.12, ease: 'easeOut' }
    };
  }
  if (profile && profile.lineTransitionMode === 'fast') {
    return {
      enter: { opacity: 0.35, scale: 0.96, blur: 4, duration: 0.16, ease: 'easeOut' },
      exit: { opacity: 0, scale: 1.04, blur: 10, duration: 0.16, ease: 'easeInOut' }
    };
  }
  return {
    enter: { opacity: 0, scale: 0.9, blur: 10, duration: 0.2, ease: 'easeOut' },
    exit: { opacity: 0, scale: 1.1, blur: 20, duration: 0.3, ease: 'easeInOut' }
  };
}

/* 运行时上下文里的「当前行 / 上一行 / 接下来两行」——对应 Folia runtime.ts。
 * Folia 用 useVisualizerRuntime 每帧算一次，这里同样是纯函数。 */
function foliaGetRecentCompletedLine(ctx) {
  if (ctx.index !== -1 || !ctx.lines || ctx.lines.length === 0) return null;
  for (var i = ctx.lines.length - 1; i >= 0; i--) {
    if (ctx.time > foliaGetLineRenderEndTime(ctx.lines[i])) return ctx.lines[i];
  }
  return null;
}

function foliaGetUpcomingLines(ctx, count) {
  var n = count == null ? 2 : count;
  if (!ctx.lines || ctx.index < 0) return [];
  return ctx.lines.slice(ctx.index + 1, ctx.index + 1 + n);
}
