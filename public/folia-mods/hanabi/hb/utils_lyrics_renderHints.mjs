/* 移植自 Folia utils/lyrics/renderHints.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const MICRO_LINE_DURATION_THRESHOLD = 0.10;
export const SHORT_LINE_DURATION_THRESHOLD = 0.18;
export const MICRO_LINE_RENDER_FLOOR = 0.067;
const getLastWordEndTime = (line)=>{
    const lastWord = line.words?.[line.words.length - 1];
    return lastWord?.endTime ?? line.endTime;
};
export const getLineTransitionTiming = (rawDuration, lineTransitionMode, wordRevealMode)=>{
    if (lineTransitionMode === 'none') {
        return {
            enterDuration: 0,
            exitDuration: 0,
            linePassHold: 0
        };
    }
    if (lineTransitionMode === 'fast') {
        return {
            enterDuration: clamp(rawDuration * 0.45, 0.045, 0.06),
            exitDuration: clamp(rawDuration * 0.22, 0.03, 0.04),
            linePassHold: wordRevealMode === 'instant' ? 0 : 0.03
        };
    }
    return {
        enterDuration: Math.min(0.42, Math.max(0.22, Math.max(rawDuration, 0.12) * 0.34)),
        exitDuration: Math.min(0.32, Math.max(0.18, Math.max(rawDuration, 0.12) * 0.18)),
        linePassHold: wordRevealMode === 'instant' ? 0 : 0.06
    };
};
const getTimingClass = (rawDuration)=>{
    if (rawDuration < MICRO_LINE_DURATION_THRESHOLD) {
        return 'micro';
    }
    if (rawDuration < SHORT_LINE_DURATION_THRESHOLD) {
        return 'short';
    }
    return 'normal';
};
const getLineTransitionMode = (timingClass)=>{
    if (timingClass === 'micro') {
        return 'none';
    }
    if (timingClass === 'short') {
        return 'fast';
    }
    return 'normal';
};
const getWordRevealMode = (timingClass)=>{
    if (timingClass === 'micro') {
        return 'instant';
    }
    if (timingClass === 'short') {
        return 'fast';
    }
    return 'normal';
};
const clamp = (value, min, max)=>Math.min(Math.max(value, min), max);
const buildLineRenderEndTime = (line, rawDuration, lineTransitionMode, wordRevealMode)=>{
    if (lineTransitionMode === 'none') {
        return Math.max(line.endTime, line.startTime + MICRO_LINE_RENDER_FLOOR);
    }
    const transitionTiming = getLineTransitionTiming(rawDuration, lineTransitionMode, wordRevealMode);
    const linePassStart = Math.max(getLastWordEndTime(line), line.startTime) + transitionTiming.linePassHold;
    const exitStart = lineTransitionMode === 'fast' ? Math.max(line.startTime + transitionTiming.enterDuration + 0.01, linePassStart, line.endTime - transitionTiming.exitDuration) : Math.max(linePassStart, line.endTime - transitionTiming.exitDuration);
    return Math.max(line.endTime, exitStart + transitionTiming.exitDuration);
};
export function buildLineRenderHints(lineOrStart, endTime) {
    const line = typeof lineOrStart === 'number' ? {
        startTime: lineOrStart,
        endTime: endTime ?? lineOrStart
    } : lineOrStart;
    const rawDuration = Math.max(line.endTime - line.startTime, 0);
    const timingClass = getTimingClass(rawDuration);
    const lineTransitionMode = getLineTransitionMode(timingClass);
    const wordRevealMode = getWordRevealMode(timingClass);
    return {
        rawDuration,
        timingClass,
        renderEndTime: buildLineRenderEndTime(line, rawDuration, lineTransitionMode, wordRevealMode),
        lineTransitionMode,
        wordRevealMode
    };
}
export const getLineRenderHints = (line)=>{
    if (!line) {
        return null;
    }
    return line.renderHints ?? buildLineRenderHints(line);
};
export const getLineRenderEndTime = (line)=>{
    if (!line) {
        return Number.NEGATIVE_INFINITY;
    }
    return getLineRenderHints(line)?.renderEndTime ?? line.endTime;
};
const hasExpectedRenderHints = (line, expected)=>{
    const current = line.renderHints;
    return Boolean(current && current.rawDuration === expected.rawDuration && current.timingClass === expected.timingClass && current.renderEndTime === expected.renderEndTime && current.lineTransitionMode === expected.lineTransitionMode && current.wordRevealMode === expected.wordRevealMode);
};
export const migrateLyricLinesRenderHints = (lines)=>{
    let changed = false;
    const nextLines = lines.map((line)=>{
        const renderHints = buildLineRenderHints(line);
        if (hasExpectedRenderHints(line, renderHints)) {
            return line;
        }
        changed = true;
        return {
            ...line,
            renderHints
        };
    });
    return {
        value: changed ? nextLines : lines,
        changed
    };
};
export const annotateLyricLines = (lines)=>{
    return migrateLyricLinesRenderHints(lines).value;
};
export const ensureLyricLinesRenderHints = (lines)=>{
    return migrateLyricLinesRenderHints(lines).value;
};
export function migrateLyricDataRenderHints(lyrics) {
    if (!lyrics) {
        return {
            value: null,
            changed: false
        };
    }
    const migration = migrateLyricLinesRenderHints(lyrics.lines);
    if (!migration.changed) {
        return {
            value: lyrics,
            changed: false
        };
    }
    return {
        value: {
            ...lyrics,
            lines: migration.value
        },
        changed: true
    };
}
export const ensureLyricDataRenderHints = (lyrics)=>{
    return migrateLyricDataRenderHints(lyrics).value;
};
