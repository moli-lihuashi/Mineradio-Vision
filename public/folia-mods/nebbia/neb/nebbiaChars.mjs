/* 移植自 Folia「雾笺」 nebbiaChars.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { buildLineGraphemeTimeline } from './graphemeTiming.mjs';
import { getLineRenderEndTime } from './renderHints.mjs';
import { segmentLyricWords } from './wordSegmentation.mjs';
import { createVisualizerRng, hashVisualizerSeed } from './visualizerSeedHash.mjs';
export const ICON_PREFIX = 'icon:';
export const isIconChar = (ch)=>ch.startsWith(ICON_PREFIX);
const EMOJI_ICON = {
    '❤': 'Heart',
    '♥': 'Heart',
    '💗': 'Heart',
    '⭐': 'Star',
    '★': 'Star',
    '☆': 'Star',
    '🌙': 'Moon',
    '☀': 'Sun',
    '🌞': 'Sun',
    '🎵': 'Music',
    '♪': 'Music2',
    '🎶': 'Music',
    '🌸': 'Flower',
    '✿': 'Flower2',
    '🌷': 'Flower2',
    '✨': 'Sparkles',
    '☁': 'Cloud',
    '🌧': 'CloudRain',
    '☂': 'Umbrella',
    '☔': 'Umbrella',
    '🐱': 'Cat',
    '😊': 'Smile',
    '🙂': 'Smile',
    '❄': 'Snowflake',
    '🍃': 'Leaf',
    '🌿': 'Leaf',
    '🪶': 'Feather'
};
export const NEBBIA_DEFAULT_DOODLES = [
    'Heart',
    'Star',
    'Moon',
    'Music',
    'Flower',
    'Sparkles',
    'CloudRain',
    'Umbrella',
    'Smile',
    'Leaf'
];
export const collectEmojiIcons = (lines)=>{
    const out = new Set();
    for (const line of lines)for (const ch of line.fullText.replace(/[️‍]/g, ''))if (EMOJI_ICON[ch]) out.add(EMOJI_ICON[ch]);
    return [
        ...out
    ];
};
const toChar = (grapheme)=>{
    const bare = grapheme.replace(/[️‍]/g, '');
    return EMOJI_ICON[bare] ? ICON_PREFIX + EMOJI_ICON[bare] : bare;
};
const groupWords = (line, graphemes, chars)=>{
    const starts = [];
    let offset = 0;
    for (const g of graphemes){
        starts.push(offset);
        offset += g.length;
    }
    const indexAt = (unit)=>{
        let k = 0;
        while(k + 1 < starts.length && starts[k + 1] <= unit)k += 1;
        return k;
    };
    const words = [];
    for (const seg of segmentLyricWords(line)){
        if (!seg.segment.trim()) continue;
        const from = indexAt(seg.index), to = indexAt(seg.index + seg.segment.length - 1);
        let run = [];
        for(let k = from; k <= to; k += 1){
            if (!chars[k].ch.trim()) continue;
            if (isIconChar(chars[k].ch)) {
                if (run.length) words.push(run);
                words.push([
                    k
                ]);
                run = [];
            } else run.push(k);
        }
        if (run.length) words.push(run);
    }
    return words;
};
export const buildNebbiaLines = (lines, seed, doodle, doodles)=>{
    const base = hashVisualizerSeed(String(seed));
    return lines.map((line, index)=>{
        const timeline = buildLineGraphemeTimeline(line);
        const chars = timeline.map((g)=>({
                ch: toChar(g.char),
                t: g.startTime,
                d: Math.max(0, g.endTime - g.startTime)
            }));
        const words = groupWords(line, timeline.map((g)=>g.char), chars);
        const end = Math.max(line.startTime, getLineRenderEndTime(line));
        const next = lines[index + 1]?.startTime ?? Infinity;
        const rng = createVisualizerRng(base + Math.imul(index + 1, 977) + 31 >>> 0);
        const last = chars[chars.length - 1];
        if (last && doodles.length && !chars.some((c)=>isIconChar(c.ch)) && rng() < doodle) {
            const at = last.t + last.d;
            chars.push({
                ch: ' ',
                t: at,
                d: 0
            }, {
                ch: ICON_PREFIX + doodles[Math.floor(rng() * doodles.length)],
                t: at + 0.08,
                d: 1.1
            });
            words.push([
                chars.length - 1
            ]);
        }
        return {
            chars,
            words,
            t: line.startTime,
            end,
            next
        };
    });
};
