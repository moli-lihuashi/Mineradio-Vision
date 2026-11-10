/* 移植自 Folia components/visualizer/machi/engine/signRaster.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { resolveLucideIconNode } from './_stubs.mjs';
import { lucideIconPath2d } from './components_visualizer_lucidePath2d.mjs';
export const MACHI_REFERENCE_PX = 100;
export const fontSpec = (font, px)=>`${font.weight} ${px.toFixed(1)}px ${font.stack}`;
let measureContext = null;
export const createMachiMeasure = (font)=>{
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    const cache = new Map();
    const spec = fontSpec(font, MACHI_REFERENCE_PX);
    return (text)=>{
        if (!text) return 0;
        let width = cache.get(text);
        if (width === undefined) {
            measureContext.font = spec;
            width = measureContext.measureText(text).width;
            if (cache.size > 4000) cache.clear();
            cache.set(text, width);
        }
        return width;
    };
};
export const createCanvas = (width, height)=>{
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};
export const context2d = (canvas)=>canvas.getContext('2d');
export const drawIcon = (context, name, fallbacks, x, y, size, color, lineWidth = 2.2)=>{
    const node = [
        name,
        ...fallbacks
    ].map((candidate)=>candidate ? resolveLucideIconNode(candidate) : null).find(Boolean);
    context.save();
    context.translate(x, y);
    context.scale(size / 24, size / 24);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    if (node) context.stroke(lucideIconPath2d(node));
    else {
        context.beginPath();
        context.arc(12, 12, 8, 0, Math.PI * 2);
        context.stroke();
    }
    context.restore();
};
export const strokeNeonText = (context, text, x, y, color, glow)=>{
    context.shadowColor = color;
    context.shadowBlur = glow;
    context.strokeStyle = color;
    context.lineWidth = glow * 0.45;
    context.strokeText(text, x, y);
    context.shadowBlur = glow * 0.4;
    context.strokeStyle = '#ffffff';
    context.lineWidth = glow * 0.14;
    context.strokeText(text, x, y);
    context.shadowBlur = 0;
};
export const fitFont = (context, font, text, maxWidth, maxPx, minPx = 8)=>{
    let px = maxPx;
    context.font = fontSpec(font, px);
    const width = context.measureText(text).width;
    if (width > maxWidth) px = Math.max(minPx, px * maxWidth / width);
    context.font = fontSpec(font, px);
    return px;
};
export const wrapText = (context, text, maxWidth, maxLines)=>{
    const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+\s*|\s+/gu) ?? [];
    const lines = [];
    let current = '';
    units.forEach((unit)=>{
        const next = current + unit;
        if (current && context.measureText(next.trimEnd()).width > maxWidth) {
            lines.push(current.trimEnd());
            current = unit.trimStart();
        } else current = next;
    });
    if (current.trim()) lines.push(current.trimEnd());
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1];
        while(last.length > 1 && context.measureText(`${last}…`).width > maxWidth)last = last.slice(0, -1);
        kept[maxLines - 1] = `${last}…`;
        return kept;
    }
    return lines;
};
export const paintMachiBoard = (canvas, paint)=>{
    const context = context2d(canvas);
    const half = canvas.height / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const { layout, font } = paint;
    const scaleY = half / layout.height;
    const scaleX = canvas.width / layout.width;
    layout.rows.forEach((row, rowIndex)=>{
        const px = row.fontPx;
        context.font = fontSpec(font, px * scaleX);
        row.glyphs.forEach((glyph)=>{
            const x = glyph.x0 * scaleX;
            const y = row.centerY * scaleY;
            const keyword = paint.keywordRanges.find((range)=>glyph.offset >= range.startOffset && glyph.offset < range.endOffset);
            context.fillStyle = paint.card && rowIndex === 0 ? paint.lit : paint.unlit;
            context.fillText(glyph.text, x, y);
            const color = paint.card ? rowIndex === 0 ? paint.lit : paint.unlit : keyword?.color ?? paint.lit;
            context.fillStyle = color;
            context.fillText(glyph.text, x, y + half);
        });
    });
};
export const paintMachiLedStrip = (canvas, font, text)=>{
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = '#ffffff';
    const px = fitFont(context, font, text, width * 0.94, height * 0.78, height * 0.4);
    context.font = fontSpec(font, px);
    const used = Math.min(width, context.measureText(text).width + height * 3);
    context.fillText(text, height * 1.5, height * 0.54);
    return used;
};
