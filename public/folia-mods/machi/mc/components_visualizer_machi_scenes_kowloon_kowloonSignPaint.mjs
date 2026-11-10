/* 移植自 Folia components/visualizer/machi/scenes/kowloon/kowloonSignPaint.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { fitFont, fontSpec, strokeNeonText } from './components_visualizer_machi_engine_signRaster.mjs';
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NEON_BACKGROUND = '#130f19';
export const resolveKowloonVerticalText = (text)=>{
    const compact = text.replace(/\s+/g, '');
    const glyphs = Array.from(compact);
    if (glyphs.length === 0) return {
        mode: 'stack',
        glyphs: []
    };
    if (CJK.test(compact) || glyphs.length <= 7) {
        return {
            mode: 'stack',
            glyphs: glyphs.length > 8 ? [
                ...glyphs.slice(0, 7),
                '…'
            ] : glyphs
        };
    }
    return {
        mode: 'rotate',
        text: text.trim()
    };
};
const roundRect = (context, x, y, width, height, radius)=>{
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
};
const paintPanel = (context, rect, style)=>{
    const { x, y, width, height } = rect;
    const unit = Math.min(width, height);
    if (style.kind === 'neon') {
        context.fillStyle = NEON_BACKGROUND;
        context.fillRect(x, y, width, height);
        context.save();
        context.shadowColor = style.border;
        context.shadowBlur = unit * 0.05;
        context.strokeStyle = style.border;
        context.lineWidth = Math.max(2, unit * 0.025);
        const inset = unit * 0.06;
        roundRect(context, x + inset, y + inset, width - inset * 2, height - inset * 2, unit * 0.06);
        context.stroke();
        context.restore();
        return;
    }
    context.fillStyle = style.background;
    context.fillRect(x, y, width, height);
    context.fillStyle = 'rgba(0, 0, 0, 0.16)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = style.ink;
    context.globalAlpha = 0.55;
    context.lineWidth = Math.max(2, unit * 0.02);
    const inset = unit * 0.05;
    roundRect(context, x + inset, y + inset, width - inset * 2, height - inset * 2, unit * 0.04);
    context.stroke();
    context.globalAlpha = 1;
};
const writeText = (context, text, cx, cy, px, style)=>{
    if (style.kind === 'neon') {
        context.save();
        context.shadowColor = style.color;
        context.shadowBlur = px * 0.25;
        context.fillStyle = style.color;
        context.fillText(text, cx, cy);
        context.restore();
        strokeNeonText(context, text, cx, cy, style.color, px * 0.07);
        return;
    }
    context.fillStyle = style.ink;
    context.fillText(text, cx, cy);
};
export const paintKowloonSign = (context, rect, paint)=>{
    const { x, y, width, height } = rect;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    paintPanel(context, rect, paint.style);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const font = {
        ...paint.font,
        weight: 800
    };
    const captionHeight = paint.caption ? Math.min(width, height) * 0.22 : 0;
    if (paint.vertical) {
        const vertical = resolveKowloonVerticalText(paint.text);
        const top = y + height * 0.07;
        const usable = height * 0.86 - captionHeight;
        if (vertical.mode === 'stack') {
            const count = Math.max(1, vertical.glyphs.length);
            const step = usable / count;
            const px = Math.min(width * 0.7, step * 0.86);
            context.font = fontSpec(font, px);
            vertical.glyphs.forEach((glyph, index)=>writeText(context, glyph, x + width / 2, top + step * (index + 0.5), px, paint.style));
        } else {
            context.save();
            context.translate(x + width / 2, top + usable / 2);
            context.rotate(Math.PI / 2);
            const px = fitFont(context, font, vertical.text, usable * 0.94, width * 0.62);
            writeText(context, vertical.text, 0, 0, px, paint.style);
            context.restore();
        }
        if (paint.caption) {
            const px = fitFont(context, {
                ...paint.font,
                weight: 700
            }, paint.caption, width * 0.84, captionHeight * 0.7);
            writeText(context, paint.caption, x + width / 2, y + height * 0.93 - captionHeight / 2, px, paint.style);
        }
    } else {
        const px = fitFont(context, font, paint.text, width * 0.84, height * 0.66);
        writeText(context, paint.text, x + width / 2, y + height * 0.53, px, paint.style);
    }
    context.restore();
};
const drawCocktail = (context, cx, cy, size, color)=>{
    context.save();
    context.shadowColor = color;
    context.shadowBlur = size * 0.18;
    context.strokeStyle = color;
    context.lineWidth = size * 0.07;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    const top = cy - size * 0.42;
    context.beginPath();
    context.moveTo(cx - size * 0.38, top);
    context.lineTo(cx + size * 0.38, top);
    context.lineTo(cx, cy + size * 0.05);
    context.closePath();
    context.moveTo(cx, cy + size * 0.05);
    context.lineTo(cx, cy + size * 0.38);
    context.moveTo(cx - size * 0.2, cy + size * 0.4);
    context.lineTo(cx + size * 0.2, cy + size * 0.4);
    context.stroke();
    context.beginPath();
    context.arc(cx + size * 0.08, top + size * 0.14, size * 0.07, 0, Math.PI * 2);
    context.stroke();
    context.restore();
};
export const paintKowloonBarSign = (context, rect, paint)=>{
    const { x, y, width, height } = rect;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.fillStyle = NEON_BACKGROUND;
    context.fillRect(x, y, width, height);
    drawCocktail(context, x + height * 0.6, y + height * 0.5, height * 0.8, paint.glass);
    const markWidth = height * 0.7;
    const markX = x + width - markWidth * 0.75;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const markPx = height * 0.36;
    context.font = fontSpec({
        ...paint.font,
        weight: 800
    }, markPx);
    writeText(context, '酒', markX, y + height * 0.29, markPx, {
        kind: 'neon',
        color: paint.mark,
        border: paint.mark
    });
    writeText(context, '吧', markX, y + height * 0.71, markPx, {
        kind: 'neon',
        color: paint.mark,
        border: paint.mark
    });
    const left = x + height * 1.15;
    const right = markX - markWidth * 0.55;
    const px = fitFont(context, paint.font, paint.title, right - left, height * 0.6);
    writeText(context, paint.title, (left + right) / 2, y + height * 0.54, px, {
        kind: 'neon',
        color: paint.neon,
        border: paint.neon
    });
    context.restore();
};
