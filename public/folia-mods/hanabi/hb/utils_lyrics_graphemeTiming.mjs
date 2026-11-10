/* 移植自 Folia utils/lyrics/graphemeTiming.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, {
    granularity: 'grapheme'
}) : null;
export const splitLyricGraphemes = (text)=>{
    if (!text) {
        return [];
    }
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment })=>segment);
    }
    return Array.from(text);
};
const buildEvenGraphemeTimings = (text, startTime, endTime, wordIndex)=>{
    const graphemes = splitLyricGraphemes(text);
    if (graphemes.length === 0) {
        return [];
    }
    const duration = Math.max(endTime - startTime, 0);
    const unitDuration = duration / graphemes.length;
    return graphemes.map((char, index)=>({
            char,
            startTime: startTime + unitDuration * index,
            endTime: index === graphemes.length - 1 ? endTime : startTime + unitDuration * (index + 1),
            ...typeof wordIndex === 'number' ? {
                wordIndex
            } : {}
        }));
};
export const buildWordGraphemeTimings = (word, wordIndex)=>{
    if (!word.syllables?.length) {
        return buildEvenGraphemeTimings(word.text, word.startTime, word.endTime, wordIndex);
    }
    return word.syllables.flatMap((syllable)=>buildEvenGraphemeTimings(syllable.text, syllable.startTime, syllable.endTime, wordIndex));
};
const findGraphemeSequence = (source, target, fromIndex)=>{
    if (target.length === 0) {
        return fromIndex;
    }
    for(let index = fromIndex; index <= source.length - target.length; index += 1){
        let matched = true;
        for(let targetIndex = 0; targetIndex < target.length; targetIndex += 1){
            if (source[index + targetIndex] !== target[targetIndex]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            return index;
        }
    }
    return -1;
};
export const buildLineGraphemeTimeline = (line)=>{
    const lineGraphemes = splitLyricGraphemes(line.fullText);
    if (lineGraphemes.length === 0) {
        return [];
    }
    if (line.words.length === 0) {
        return buildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }
    const timeline = [];
    let cursor = 0;
    let lastResolvedTime = line.startTime;
    line.words.forEach((word, wordIndex)=>{
        const wordGraphemes = splitLyricGraphemes(word.text);
        if (wordGraphemes.length === 0) {
            return;
        }
        const matchedStart = findGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
        const start = matchedStart >= 0 ? matchedStart : cursor;
        const end = Math.min(start + wordGraphemes.length, lineGraphemes.length);
        for(let gapIndex = cursor; gapIndex < start; gapIndex += 1){
            timeline[gapIndex] = {
                char: lineGraphemes[gapIndex],
                startTime: word.startTime,
                endTime: word.startTime
            };
        }
        const wordTimings = buildWordGraphemeTimings(word, wordIndex);
        for(let localIndex = 0; localIndex < end - start; localIndex += 1){
            const timing = wordTimings[localIndex] ?? buildEvenGraphemeTimings(wordGraphemes[localIndex] ?? '', word.startTime, word.endTime, wordIndex)[0];
            if (!timing) {
                continue;
            }
            timeline[start + localIndex] = {
                ...timing,
                char: lineGraphemes[start + localIndex]
            };
            lastResolvedTime = Math.max(lastResolvedTime, timing.endTime);
        }
        cursor = Math.max(cursor, end);
    });
    for(let index = 0; index < lineGraphemes.length; index += 1){
        if (timeline[index]) {
            continue;
        }
        timeline[index] = {
            char: lineGraphemes[index],
            startTime: lastResolvedTime,
            endTime: lastResolvedTime
        };
    }
    return timeline;
};
