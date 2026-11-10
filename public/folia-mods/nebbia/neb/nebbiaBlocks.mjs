/* 移植自 Folia「雾笺」 nebbiaBlocks.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp } from './nebbiaConstants.mjs';
import { isIconChar } from './nebbiaChars.mjs';
import { getNebbiaStrokeMedians } from './nebbiaStrokes.mjs';
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const PUNCT = /^[，。、！？!?,.・…]$/;
const TURN_IN_VERTICAL = /^[ー—～〜…-]$/;
const PARTICLES = new Set([
    ...'的了着过吗呢吧啊呀嘛之与和是也都就还又被把给のがをにはへとでやもねよなかしてたっ'
]);
export const ROLE_SCALE = {
    hero: 2.0,
    semi: 1.35,
    support: 1,
    particle: 0.78
};
export const ROLE_SCALE_FAST = {
    hero: 1.55,
    semi: 1.18,
    support: 1,
    particle: 0.85
};
export const FLOW_GAP = 0.3;
export const STACK_GAP = 0.32;
export const isWideChar = (ch)=>/[　-鿿＀-￯]/.test(ch);
export const advanceOf = (ch)=>{
    if (isIconChar(ch)) return 1.1;
    if (ch === ' ') return 0.32;
    if (/[，。、・．]/.test(ch)) return 0.5;
    if (isWideChar(ch)) return 1;
    if (/[il.,'!|:;]/.test(ch)) return 0.3;
    if (/[mwMW]/.test(ch)) return 0.72;
    return 0.5;
};
export const mergeWords = (chars, words)=>{
    const out = [];
    const kata = (w)=>w.every((k)=>/^[゠-ヿ]$/.test(chars[k].ch));
    for (const w of words){
        const last = out[out.length - 1];
        if (last && (w.every((k)=>PUNCT.test(chars[k].ch)) || kata(w) && kata(last) && w[0] === last[last.length - 1] + 1)) last.push(...w);
        else out.push([
            ...w
        ]);
    }
    return out;
};
const scoreWord = (chars, w)=>{
    const len = w.filter((k)=>chars[k].ch.trim()).length;
    const t0 = chars[w[0]].t, last = chars[w[w.length - 1]];
    return Math.min(len, 8) * 14 + clamp(last.t + last.d - t0, 0, 2.5) * 18;
};
export const assignRoles = (chars, words)=>{
    const scores = words.map((w)=>scoreWord(chars, w));
    let hero = 0;
    scores.forEach((s, i)=>{
        if (s > scores[hero]) hero = i;
    });
    let semi = -1;
    if (words.length >= 4) {
        words.forEach((w, i)=>{
            if (i === hero || Math.abs(i - hero) < 2 || w.length < 2 || scores[i] < scores[hero] * 0.35) return;
            if (semi < 0 || scores[i] > scores[semi]) semi = i;
        });
    }
    return words.map((w, i)=>{
        if (i === hero && words.length > 1) return 'hero';
        if (i === semi) return 'semi';
        if (w.length === 1 && PARTICLES.has(chars[w[0]].ch)) return 'particle';
        return 'support';
    });
};
const isCjkWord = (chars, w)=>w.every((k)=>CJK.test(chars[k].ch) || PUNCT.test(chars[k].ch));
export const makeBlocks = (chars, words, roles, scales, maxBlocks)=>{
    const blocks = [];
    words.forEach((w, i)=>{
        const role = roles[i], word = {
            idx: w,
            scale: scales[role],
            cjk: isCjkWord(chars, w)
        };
        const last = blocks[blocks.length - 1];
        if (role === 'particle' && last && last.role !== 'hero' && last.role !== 'semi') last.words.push(word);
        else blocks.push({
            role,
            words: [
                word
            ]
        });
    });
    const len = (b)=>b.words.reduce((s, w)=>s + w.idx.length, 0);
    const strong = (b)=>b.role === 'hero' || b.role === 'semi';
    while(blocks.length > maxBlocks){
        let bi = -1, bl = Infinity;
        for(let i = 0; i < blocks.length - 1; i += 1){
            if (strong(blocks[i]) || strong(blocks[i + 1])) continue;
            if (len(blocks[i]) + len(blocks[i + 1]) < bl) {
                bl = len(blocks[i]) + len(blocks[i + 1]);
                bi = i;
            }
        }
        if (bi < 0) break;
        blocks[bi] = {
            role: 'support',
            words: [
                ...blocks[bi].words,
                ...blocks[bi + 1].words
            ]
        };
        blocks.splice(bi + 1, 1);
    }
    return blocks;
};
const gapOf = (a, b)=>a.cjk && b.cjk ? 0.04 : 0.24;
const complexScale = (ch, scale)=>{
    const n = getNebbiaStrokeMedians(ch)?.length ?? 0;
    return 1 + 0.25 * clamp((n - 9) / 10) / Math.max(1, scale);
};
export const measureBlock = (block, chars, dir)=>{
    const items = [];
    let pen = 0, thick = 0;
    block.words.forEach((w, wi)=>{
        if (wi > 0) pen += gapOf(block.words[wi - 1], w) * (dir === 'v' && w.cjk ? 0 : 1);
        for (const k of w.idx){
            const ch = chars[k].ch;
            const vertCjk = dir === 'v' && w.cjk;
            const a = vertCjk ? PUNCT.test(ch) ? 0.55 : 1.02 : advanceOf(ch);
            const rot = dir === 'v' && (!w.cjk || TURN_IN_VERTICAL.test(ch)) ? Math.PI / 2 : 0;
            const s = w.scale * (w.cjk ? complexScale(ch, w.scale) : 1);
            items.push({
                k,
                off: pen + a * s / 2,
                s,
                rot,
                punct: vertCjk && PUNCT.test(ch)
            });
            pen += a * s;
            thick = Math.max(thick, s);
        }
    });
    return dir === 'h' ? {
        dir,
        items,
        w: pen,
        h: thick
    } : {
        dir,
        items,
        w: thick,
        h: pen
    };
};
export const emitBlock = (m, cx, cy, out)=>{
    for (const it of m.items){
        if (m.dir === 'h') out.push({
            k: it.k,
            x: cx - m.w / 2 + it.off,
            y: cy + m.h / 2 - it.s / 2,
            s: it.s,
            rot: 0
        });
        else out.push({
            k: it.k,
            x: cx + (it.punct ? it.s * 0.3 : 0),
            y: cy - m.h / 2 + it.off - (it.punct ? it.s * 0.2 : 0),
            s: it.s,
            rot: it.rot
        });
    }
};
export const hasTurned = (m)=>m.items.some((it)=>it.rot) ? 1 : 0;
