/* 移植自 Folia utils/lyrics/wordSegmentation.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { splitLyricGraphemes } from './utils_lyrics_graphemeTiming.mjs';
const PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]+$/u;
const isWordLikeText = (text)=>!PUNCTUATION_ONLY.test(text);
export const segmentsFromBoundaries = (boundaries)=>{
    let cursor = 0;
    return boundaries.map((segment)=>{
        const part = {
            segment,
            index: cursor,
            isWordLike: isWordLikeText(segment)
        };
        cursor += segment.length;
        return part;
    });
};
export const segmentTextWords = (text)=>{
    if (!text) {
        return [];
    }
    const Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined;
    if (Segmenter) {
        try {
            return Array.from(new Segmenter(undefined, {
                granularity: 'word'
            }).segment(text), (part)=>({
                    segment: part.segment,
                    index: part.index,
                    isWordLike: part.isWordLike ?? isWordLikeText(part.segment)
                }));
        } catch  {}
    }
    return segmentsFromBoundaries(splitLyricGraphemes(text));
};
export const isValidWordSegmentation = (text, boundaries)=>Array.isArray(boundaries) && boundaries.length > 0 && boundaries.every((segment)=>typeof segment === 'string') && boundaries.join('') === text;
const EDGE_WHITESPACE = /^(\s*)(.*?)(\s*)$/su;
const splitEdgeWhitespace = (boundaries)=>boundaries.flatMap((boundary)=>{
        const [, lead, core, trail] = EDGE_WHITESPACE.exec(boundary) ?? [];
        return core ? [
            lead,
            core,
            trail
        ].filter(Boolean) : [
            boundary
        ].filter(Boolean);
    });
export const segmentLyricWords = (line)=>{
    if (isValidWordSegmentation(line.fullText, line.wordSegments)) {
        return segmentsFromBoundaries(splitEdgeWhitespace(line.wordSegments));
    }
    if (isValidWordSegmentation(line.fullText, line.autoWordSegments)) {
        return segmentsFromBoundaries(line.autoWordSegments);
    }
    return segmentTextWords(line.fullText);
};
export const getWordSegmentationKey = (line)=>{
    if (line.wordSegments) {
        return line.wordSegments.map((segment)=>segment.length).join(',');
    }
    return line.autoWordSegments ? `a${line.autoWordSegments.map((segment)=>segment.length).join(',')}` : '';
};
export const hasWordSegmentationOverride = (line)=>isValidWordSegmentation(line.fullText, line.wordSegments);
