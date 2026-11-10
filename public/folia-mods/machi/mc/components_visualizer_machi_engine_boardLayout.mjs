/* 移植自 Folia components/visualizer/machi/engine/boardLayout.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { buildLineGraphemeTimeline } from './utils_lyrics_graphemeTiming.mjs';
const MAX_ROWS = 3;
const SINGLE_ROW_FILL = 0.56;
const LINE_GAP = 1.22;
const ROW_PENALTY = [
    1,
    0.94,
    0.84
];
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const STICKY_PUNCTUATION = /^[，。、！？；：,.!?;:」』）)\]】〉》…~～ー]+$/u;
const tokenize = (line)=>{
    const timeline = buildLineGraphemeTimeline(line);
    const tokens = [];
    let current = null;
    let offset = 0;
    timeline.forEach((entry)=>{
        const glyph = {
            text: entry.char,
            offset,
            startTime: entry.startTime,
            endTime: entry.endTime
        };
        offset += entry.char.length;
        const isSpace = /^\s+$/u.test(entry.char);
        const isCjk = CJK_PATTERN.test(entry.char);
        if (STICKY_PUNCTUATION.test(entry.char) && tokens.length > 0 && !current) {
            tokens[tokens.length - 1].glyphs.push(glyph);
            return;
        }
        if (isCjk) {
            if (current) tokens.push(current);
            current = null;
            tokens.push({
                glyphs: [
                    glyph
                ]
            });
            return;
        }
        if (!current) current = {
            glyphs: []
        };
        current.glyphs.push(glyph);
        if (isSpace) {
            tokens.push(current);
            current = null;
        }
    });
    if (current) tokens.push(current);
    return tokens.filter((token)=>token.glyphs.length > 0);
};
const tokenText = (token)=>token.glyphs.map((glyph)=>glyph.text).join('');
const rowWidth = (tokens, measure)=>measure(tokens.map(tokenText).join('').trimEnd());
const splitRows = (tokens, rows, measure)=>{
    if (rows <= 1 || tokens.length <= 1) return [
        tokens
    ];
    const total = rowWidth(tokens, measure);
    const target = total / rows;
    const result = [];
    let current = [];
    tokens.forEach((token, index)=>{
        const remainingRows = rows - result.length;
        const remainingTokens = tokens.length - index;
        const next = [
            ...current,
            token
        ];
        if (current.length > 0 && remainingRows > 1 && rowWidth(next, measure) > target * 1.04 && remainingTokens >= remainingRows - 1) {
            const without = rowWidth(current, measure);
            const withIt = rowWidth(next, measure);
            if (Math.abs(withIt - target) < Math.abs(without - target) && remainingTokens > remainingRows - 1) {
                result.push(next);
                current = [];
                return;
            }
            result.push(current);
            current = [
                token
            ];
            return;
        }
        current = next;
    });
    if (current.length > 0) result.push(current);
    return result;
};
export const layoutMachiBoardLine = (line, box, measure)=>{
    const tokens = tokenize(line);
    const usableWidth = box.width * (1 - box.paddingX * 2);
    let best = null;
    for(let rows = 1; rows <= MAX_ROWS; rows += 1){
        if (rows > tokens.length) break;
        const split = splitRows(tokens, rows, measure);
        const widest = Math.max(1, ...split.map((row)=>rowWidth(row, measure)));
        const byWidth = usableWidth / widest * box.referencePx;
        const byHeight = rows === 1 ? box.height * SINGLE_ROW_FILL : box.height * 0.86 / (split.length * LINE_GAP);
        const fontPx = Math.min(byWidth, byHeight);
        const score = fontPx * ROW_PENALTY[split.length - 1];
        if (!best || score > best.score) best = {
            rows: split,
            fontPx,
            score
        };
    }
    if (!best) return {
        fontPx: box.height * 0.4,
        rows: [],
        width: box.width,
        height: box.height
    };
    return placeRows(best.rows, best.fontPx, box, measure);
};
const placeRows = (rows, fontPx, box, measure)=>{
    const scale = fontPx / box.referencePx;
    const lineHeight = fontPx * LINE_GAP;
    const blockHeight = lineHeight * rows.length;
    const firstCenter = box.height / 2 - blockHeight / 2 + lineHeight / 2;
    return {
        fontPx,
        width: box.width,
        height: box.height,
        rows: rows.map((tokens, rowIndex)=>{
            const glyphs = tokens.flatMap((token)=>token.glyphs);
            const text = glyphs.map((glyph)=>glyph.text).join('');
            const width = measure(text.trimEnd()) * scale;
            const left = (box.width - width) / 2;
            let prefix = '';
            const placed = glyphs.map((glyph)=>{
                const x0 = left + measure(prefix) * scale;
                prefix += glyph.text;
                const x1 = left + measure(prefix) * scale;
                return {
                    ...glyph,
                    length: glyph.text.length,
                    x0,
                    x1
                };
            });
            const centerY = firstCenter + rowIndex * lineHeight;
            return {
                glyphs: placed,
                fontPx,
                centerY,
                top: centerY - lineHeight / 2,
                bottom: centerY + lineHeight / 2
            };
        })
    };
};
export const layoutMachiBoardCard = (title, subtitle, box, measure)=>{
    const usableWidth = box.width * (1 - box.paddingX * 2);
    const titleFont = Math.min(box.height * (subtitle ? 0.4 : 0.5), usableWidth / Math.max(1, measure(title)) * box.referencePx);
    const subtitleFont = subtitle ? Math.min(titleFont * 0.52, usableWidth / Math.max(1, measure(subtitle)) * box.referencePx) : 0;
    const rows = [];
    const totalHeight = titleFont * 1.15 + (subtitle ? subtitleFont * 1.4 : 0);
    let y = box.height / 2 - totalHeight / 2;
    const row = (text, fontPx)=>{
        const scale = fontPx / box.referencePx;
        const width = measure(text) * scale;
        const left = (box.width - width) / 2;
        const height = fontPx * (rows.length === 0 ? 1.15 : 1.4);
        const centerY = y + height / 2;
        rows.push({
            glyphs: [
                {
                    text,
                    offset: 0,
                    length: text.length,
                    x0: left,
                    x1: left + width,
                    startTime: -Infinity,
                    endTime: -Infinity
                }
            ],
            fontPx,
            centerY,
            top: y,
            bottom: y + height
        });
        y += height;
    };
    row(title, titleFont);
    if (subtitle) row(subtitle, subtitleFont);
    return {
        fontPx: titleFont,
        rows,
        width: box.width,
        height: box.height
    };
};
export const resolveMachiBoardReveal = (layout, time)=>layout.rows.map((row)=>{
        let lit = row.glyphs[0]?.x0 ?? 0;
        for (const glyph of row.glyphs){
            if (time >= glyph.endTime) {
                lit = glyph.x1;
                continue;
            }
            if (time > glyph.startTime) {
                const span = Math.max(1e-3, glyph.endTime - glyph.startTime);
                lit = glyph.x0 + (glyph.x1 - glyph.x0) * Math.min(1, (time - glyph.startTime) / span);
            }
            break;
        }
        return lit;
    });
