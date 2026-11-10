/* 移植自 Folia components/visualizer/hanabi/program.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { splitLyricGraphemes } from './utils_lyrics_graphemeTiming.mjs';
import { segmentLyricWords } from './utils_lyrics_wordSegmentation.mjs';
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
import { burstPreset, HANABI_KINDS, profileOf } from './components_visualizer_hanabi_catalog.mjs';
export const DEFAULT_HANABI_PARAMS = {
    bridgeGap: 3,
    maxChars: 18,
    maxLineSeconds: 6
};
const RECENT = 6;
const BRIDGE_FAMILIES = [
    'senrin',
    'uchiage',
    'kiku',
    'shakudama'
];
const BRIDGE_TAIL = 0.6;
const MAX_PIECES = 3;
const MOODS_BY_KIND = {
    chorus: [
        'loud',
        'neutral'
    ],
    lift: [
        'loud',
        'neutral'
    ],
    verse: [
        'neutral',
        'quiet'
    ],
    breath: [
        'quiet',
        'neutral'
    ],
    outro: [
        'quiet',
        'neutral'
    ],
    break: null
};
const locateWords = (line)=>{
    const text = line.fullText;
    const located = [];
    let cursor = 0;
    for (const word of line.words ?? []){
        if (!word.text) continue;
        const index = text.indexOf(word.text, cursor);
        if (index < 0) return null;
        located.push({
            word,
            start: index,
            end: index + word.text.length
        });
        cursor = index + word.text.length;
    }
    return located.length > 0 ? located : null;
};
const hasLetters = (text)=>/[\p{L}\p{N}]/u.test(text);
export const segmentHanabiLine = (line)=>{
    const text = line.fullText;
    const located = locateWords(line);
    if (located && located.length >= 2) {
        return located.map(({ word, start, end })=>({
                startOffset: start,
                endOffset: end,
                startTime: word.startTime,
                endTime: word.endTime
            }));
    }
    const pieces = segmentLyricWords(line).map(({ segment, index })=>({
            start: index,
            end: index + segment.length,
            text: segment
        }));
    const merged = [];
    for (const piece of pieces){
        const last = merged.at(-1);
        if (last && !hasLetters(piece.text)) last.end = piece.end;
        else merged.push({
            start: piece.start,
            end: piece.end
        });
    }
    const length = Math.max(text.length, 1);
    const timeAt = (offset)=>line.startTime + (line.endTime - line.startTime) * (offset / length);
    return merged.map(({ start, end })=>({
            startOffset: start,
            endOffset: end,
            startTime: timeAt(start),
            endTime: timeAt(end)
        }));
};
export const sliceLine = (line, startOffset, endOffset)=>{
    const text = line.fullText;
    const start = Math.max(0, Math.min(startOffset, text.length));
    const end = Math.max(start, Math.min(endOffset, text.length));
    if (start === 0 && end === text.length) return line;
    const located = locateWords(line) ?? [
        {
            word: {
                text,
                startTime: line.startTime,
                endTime: line.endTime
            },
            start: 0,
            end: text.length
        }
    ];
    const words = [];
    for (const { word, start: ws, end: we } of located){
        const from = Math.max(ws, start);
        const to = Math.min(we, end);
        if (to <= from) continue;
        const span = Math.max(we - ws, 1);
        const duration = word.endTime - word.startTime;
        words.push({
            text: text.slice(from, to),
            startTime: word.startTime + duration * ((from - ws) / span),
            endTime: word.startTime + duration * ((to - ws) / span)
        });
    }
    const fullText = text.slice(start, end);
    if (words.length === 0) {
        const length = Math.max(text.length, 1);
        const timeAt = (offset)=>line.startTime + (line.endTime - line.startTime) * (offset / length);
        words.push({
            text: fullText,
            startTime: timeAt(start),
            endTime: timeAt(end)
        });
    }
    return {
        ...line,
        fullText,
        words,
        startTime: words[0].startTime,
        endTime: words.at(-1).endTime,
        translation: undefined,
        romanization: undefined
    };
};
export const shotLine = (lines, slices)=>{
    const parts = slices.map((slice)=>{
        const line = lines.get(slice.lineIndex);
        return line ? sliceLine(line, slice.startOffset, slice.endOffset) : null;
    }).filter((line)=>line !== null && line.fullText.trim().length > 0);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    const words = [];
    parts.forEach((part, index)=>{
        if (index > 0) {
            const gapAt = words.at(-1).endTime;
            words.push({
                text: ' ',
                startTime: gapAt,
                endTime: Math.max(gapAt, part.startTime)
            });
        }
        words.push(...part.words);
    });
    return {
        ...parts[0],
        fullText: words.map((word)=>word.text).join(''),
        words,
        startTime: parts[0].startTime,
        endTime: Math.max(...parts.map((part)=>part.endTime))
    };
};
const visibleLength = (text)=>splitLyricGraphemes(text).filter((grapheme)=>grapheme.trim().length > 0).length;
export const splitLine = (unified, params)=>{
    const { line } = unified;
    const text = line.fullText;
    const whole = [
        {
            slice: {
                lineIndex: unified.sourceIndex,
                startOffset: 0,
                endOffset: text.length
            },
            startTime: line.startTime,
            lyricEndTime: unified.renderEndTime
        }
    ];
    const count = visibleLength(text);
    const duration = line.endTime - line.startTime;
    const maxChars = Math.max(4, params.maxChars);
    const maxSeconds = Math.max(1, params.maxLineSeconds);
    if (count <= maxChars && duration <= maxSeconds) return whole;
    const segments = segmentHanabiLine(line);
    const pieces = Math.min(MAX_PIECES, segments.length, Math.max(2, Math.ceil(Math.max(count / maxChars, duration / maxSeconds))));
    if (pieces < 2) return whole;
    const cuts = [];
    let after = -1;
    for(let k = 1; k < pieces; k += 1){
        const target = text.length * k / pieces;
        let best = -1;
        for(let j = after + 1; j <= segments.length - 1 - (pieces - k); j += 1){
            const offset = segments[j + 1].startOffset;
            if (best < 0 || Math.abs(offset - target) < Math.abs(segments[best + 1].startOffset - target)) best = j;
        }
        if (best < 0) break;
        cuts.push(best);
        after = best;
    }
    if (cuts.length === 0) return whole;
    const bounds = [
        -1,
        ...cuts,
        segments.length - 1
    ];
    const result = [];
    for(let k = 0; k < bounds.length - 1; k += 1){
        const first = segments[bounds[k] + 1];
        const last = segments[bounds[k + 1]];
        const isFirst = k === 0;
        const isLast = k === bounds.length - 2;
        result.push({
            slice: {
                lineIndex: unified.sourceIndex,
                startOffset: isFirst ? 0 : first.startOffset,
                endOffset: isLast ? text.length : segments[bounds[k + 1] + 1].startOffset
            },
            startTime: isFirst ? line.startTime : first.startTime,
            lyricEndTime: isLast ? unified.renderEndTime : last.endTime
        });
    }
    return result;
};
export const planShots = (lines, paragraphStart, paragraphEnd, params)=>{
    const pieces = lines.flatMap((line)=>splitLine(line, params).map((piece, index)=>({
                ...piece,
                slot: `s${index}`
            })));
    const shots = [];
    let cursor = pieces.length > 0 ? Math.min(paragraphStart, pieces[0].startTime) : paragraphStart;
    pieces.forEach((piece, index)=>{
        const start = cursor;
        const nextStart = Math.max(pieces[index + 1]?.startTime ?? paragraphEnd, start + 0.05);
        const lyricEnd = piece.lyricEndTime;
        if (index < pieces.length - 1 && nextStart - lyricEnd >= params.bridgeGap) {
            const end = Math.max(start + 0.05, lyricEnd + BRIDGE_TAIL);
            shots.push({
                slices: [
                    piece.slice
                ],
                slot: piece.slot,
                startTime: start,
                endTime: end,
                lyricEndTime: lyricEnd,
                isBridge: false
            });
            shots.push({
                slices: [],
                slot: null,
                startTime: end,
                endTime: nextStart,
                lyricEndTime: nextStart,
                isBridge: true
            });
        } else {
            const end = index < pieces.length - 1 ? nextStart : Math.max(nextStart, lyricEnd);
            shots.push({
                slices: [
                    piece.slice
                ],
                slot: piece.slot,
                startTime: start,
                endTime: end,
                lyricEndTime: Math.min(lyricEnd, end),
                isBridge: false
            });
        }
        cursor = shots.at(-1).endTime;
    });
    if (pieces.length === 0 && paragraphEnd > paragraphStart) {
        shots.push({
            slices: [],
            slot: null,
            startTime: paragraphStart,
            endTime: paragraphEnd,
            lyricEndTime: paragraphEnd,
            isBridge: true
        });
    }
    return shots;
};
export const castShot = (options)=>{
    const { chain } = options;
    let candidates = HANABI_KINDS;
    const narrow = (keep)=>{
        const next = candidates.filter(keep);
        if (next.length > 0) candidates = next;
    };
    const moods = MOODS_BY_KIND[options.kind];
    if (options.isBridge) narrow((kind)=>BRIDGE_FAMILIES.includes(profileOf(kind).family));
    if (moods) narrow((kind)=>moods.includes(profileOf(kind).mood));
    narrow((kind)=>!chain.recent.includes(kind));
    if (chain.family) narrow((kind)=>profileOf(kind).family !== chain.family);
    const random = createRng(`${options.seed}:${options.paragraphIndex}:${options.shotIndex}:hanabi-cast`);
    return candidates[Math.floor(random() * candidates.length)];
};
export const advanceChain = (chain, kind)=>{
    chain.recent = [
        ...chain.recent,
        kind
    ].slice(-RECENT);
    chain.family = profileOf(kind).family;
};
export const shotText = (shot)=>{
    const text = profileOf(shot.typography ?? shot.kind).text;
    const block = shot.block ?? text.block;
    const enter = shot.enter ?? text.enter;
    return block === text.block && enter === text.enter ? text : {
        ...text,
        block,
        enter
    };
};
export const resolveShotProfile = (shot)=>{
    const base = profileOf(shot.kind);
    const text = shotText(shot);
    const burst = shot.burst && shot.burst !== base.burst?.kind ? burstPreset(shot.burst, base.burst?.colors) : base.burst;
    if (text === base.text && burst === base.burst) return base;
    return {
        ...base,
        text,
        burst
    };
};
