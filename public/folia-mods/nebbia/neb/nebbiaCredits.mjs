/* 移植自 Folia「雾笺」 nebbiaCredits.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
export const CREDITS_DELAY = 2.5;
const graphemes = (text)=>{
    const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, {
        granularity: 'grapheme'
    }) : null;
    return seg ? [
        ...seg.segment(text)
    ].map((s)=>s.segment) : [
        ...text
    ];
};
const wordsOf = (text, chars)=>{
    const starts = [];
    let offset = 0;
    for (const g of chars){
        starts.push(offset);
        offset += g.length;
    }
    const words = [];
    const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, {
        granularity: 'word'
    }) : null;
    const pieces = seg ? [
        ...seg.segment(text)
    ].map((p)=>({
            at: p.index,
            text: p.segment
        })) : [
        ...text.matchAll(/\S+/g)
    ].map((m)=>({
            at: m.index ?? 0,
            text: m[0]
        }));
    for (const p of pieces){
        if (!p.text.trim()) continue;
        const run = starts.flatMap((u, i)=>u >= p.at && u < p.at + p.text.length && chars[i].trim() ? [
                i
            ] : []);
        if (run.length) words.push(run);
    }
    return words;
};
const creditLine = (text, t, credits)=>{
    const gs = graphemes(text);
    const chars = gs.map((ch, i)=>({
            ch,
            t: t + i * 0.1,
            d: 0.5
        }));
    const last = chars[chars.length - 1];
    return {
        chars,
        words: wordsOf(text, gs),
        t,
        end: last ? last.t + last.d : t,
        next: Infinity,
        credits
    };
};
export const appendNebbiaCredits = (source, title, artist)=>{
    const name = title?.trim();
    if (!source.length || !name) return source;
    const at = Math.max(...source.map((l)=>l.end)) + CREDITS_DELAY;
    const out = source.map((l, i)=>i === source.length - 1 ? {
            ...l,
            next: Math.min(l.next, at)
        } : l);
    const titleLine = creditLine(name, at, 'title');
    out.push(titleLine);
    const by = artist?.trim();
    if (by) {
        out.push(creditLine(by, titleLine.end + 0.2, 'artist'));
    }
    return out;
};
