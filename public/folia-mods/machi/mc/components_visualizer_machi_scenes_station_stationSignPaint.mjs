/* 移植自 Folia components/visualizer/machi/scenes/station/stationSignPaint.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { context2d, drawIcon, fitFont, fontSpec, strokeNeonText } from './components_visualizer_machi_engine_signRaster.mjs';
export const paintStationCanopy = (canvas, paint)=>{
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = paint.base;
    context.fillRect(0, 0, width, height);
    const badge = height * 0.86;
    const badgeX = height * 0.2;
    const badgeY = (height - badge) / 2;
    context.fillStyle = paint.brand[0];
    context.beginPath();
    context.arc(badgeX + badge / 2, badgeY + badge / 2, badge / 2, 0, Math.PI * 2);
    context.fill();
    drawIcon(context, paint.icon, paint.fallbacks, badgeX + badge * 0.2, badgeY + badge * 0.2, badge * 0.6, '#ffffff', 2.4);
    const tagWidth = height * 1.7;
    const textLeft = badgeX + badge + height * 0.3;
    const textRight = width - tagWidth - height * 0.3;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = paint.text;
    fitFont(context, paint.font, paint.name, textRight - textLeft, height * 0.62);
    context.fillText(paint.name, textLeft, height * 0.53);
    context.fillStyle = paint.brand[2];
    context.beginPath();
    context.roundRect(width - tagWidth - height * 0.12, height * 0.16, tagWidth, height * 0.68, height * 0.12);
    context.fill();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    fitFont(context, {
        ...paint.font,
        weight: 800
    }, 'SELF', tagWidth * 0.8, height * 0.46);
    context.fillText('SELF', width - tagWidth / 2 - height * 0.12, height * 0.53);
};
const SEGMENTS = {
    0: 'abcdef',
    1: 'bc',
    2: 'abdeg',
    3: 'abcdg',
    4: 'bcfg',
    5: 'acdfg',
    6: 'acdefg',
    7: 'abc',
    8: 'abcdefg',
    9: 'abcdfg',
    '-': 'g',
    ' ': ''
};
const drawSevenSegment = (context, char, x, y, w, h, on, off)=>{
    const lit = SEGMENTS[char] ?? '';
    const t = w * 0.18;
    const half = h / 2;
    const segment = (name, sx, sy, horizontal, length)=>{
        context.fillStyle = lit.includes(name) ? on : off;
        context.beginPath();
        if (horizontal) {
            context.moveTo(sx + t * 0.5, sy);
            context.lineTo(sx + t, sy - t * 0.5);
            context.lineTo(sx + length - t, sy - t * 0.5);
            context.lineTo(sx + length - t * 0.5, sy);
            context.lineTo(sx + length - t, sy + t * 0.5);
            context.lineTo(sx + t, sy + t * 0.5);
        } else {
            context.moveTo(sx, sy + t * 0.5);
            context.lineTo(sx + t * 0.5, sy + t);
            context.lineTo(sx + t * 0.5, sy + length - t);
            context.lineTo(sx, sy + length - t * 0.5);
            context.lineTo(sx - t * 0.5, sy + length - t);
            context.lineTo(sx - t * 0.5, sy + t);
        }
        context.closePath();
        context.fill();
    };
    segment('a', x, y + t * 0.5, true, w);
    segment('g', x, y + half, true, w);
    segment('d', x, y + h - t * 0.5, true, w);
    segment('f', x + t * 0.5, y, false, half);
    segment('e', x + t * 0.5, y + half, false, half);
    segment('b', x + w - t * 0.5, y, false, half);
    segment('c', x + w - t * 0.5, y + half, false, half);
};
export const paintStationPylon = (canvas, paint)=>{
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#f4f2ec';
    context.fillRect(0, 0, width, height);
    const head = height * 0.34;
    context.fillStyle = paint.brand[0];
    context.fillRect(0, 0, width, head);
    context.fillStyle = paint.brand[2];
    context.fillRect(0, head - height * 0.025, width, height * 0.025);
    const icon = head * 0.62;
    drawIcon(context, paint.icon, paint.fallbacks, (width - icon) / 2, head * 0.08, icon, '#ffffff', 2.3);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    fitFont(context, {
        ...paint.font,
        weight: 800
    }, 'SELF', width * 0.8, head * 0.2);
    context.fillText('SELF', width / 2, head * 0.84);
    const rowTop = head + height * 0.03;
    const rowHeight = (height - rowTop - height * 0.03) / paint.rows.length;
    const span = (value)=>value.split('').reduce((sum, char, index)=>sum + (char === ':' ? 0.26 : 0.52) + (index > 0 && char !== ':' && value[index - 1] !== ':' ? 0.1664 : 0), 0);
    const widest = Math.max(...paint.rows.map((row)=>span(row.value)), 1);
    const panelTop = rowHeight * 0.06;
    const panelHeight = rowHeight * 0.88;
    const labelBand = panelHeight * 0.28;
    const digitArea = panelHeight - labelBand - panelHeight * 0.06;
    const digitH = Math.min(digitArea * 0.88, width * 0.8 / widest);
    paint.rows.forEach((row, index)=>{
        const y = rowTop + index * rowHeight;
        context.fillStyle = '#16191f';
        context.fillRect(width * 0.05, y + panelTop, width * 0.9, panelHeight);
        context.fillStyle = '#e8eaee';
        context.textAlign = 'left';
        fitFont(context, paint.font, row.label, width * 0.78, labelBand * 0.62);
        context.fillText(row.label, width * 0.1, y + panelTop + labelBand * 0.58);
        const chars = row.value.split('');
        const digitW = digitH * 0.52;
        const gap = digitW * 0.32;
        const colonW = digitW * 0.5;
        let x = width * 0.9 - span(row.value) * digitH;
        const dy = y + panelTop + labelBand + (digitArea - digitH) / 2;
        chars.forEach((char, charIndex)=>{
            if (charIndex > 0 && char !== ':' && chars[charIndex - 1] !== ':') x += gap;
            if (char === ':') {
                context.fillStyle = paint.digit;
                const r = digitW * 0.09;
                context.beginPath();
                context.arc(x + colonW * 0.5, dy + digitH * 0.32, r, 0, Math.PI * 2);
                context.arc(x + colonW * 0.5, dy + digitH * 0.72, r, 0, Math.PI * 2);
                context.fill();
                x += colonW;
                return;
            }
            drawSevenSegment(context, char, x, dy, digitW, digitH, paint.digit, 'rgba(255,255,255,0.05)');
            x += digitW;
        });
    });
};
export const paintMotelTall = (canvas, font, neon)=>{
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#10161c';
    context.fillRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const letters = 'MOTEL'.split('');
    const step = height / (letters.length + 0.2);
    context.font = fontSpec({
        ...font,
        weight: 800
    }, Math.min(width * 0.72, step * 0.86));
    letters.forEach((letter, index)=>strokeNeonText(context, letter, width / 2, step * (index + 0.6), neon, width * 0.08));
};
export const paintMotelName = (canvas, font, title, neon)=>{
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#10161c';
    context.fillRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    fitFont(context, font, title, width * 0.86, height * 0.62);
    strokeNeonText(context, title, width / 2, height * 0.54, neon, height * 0.1);
};
export const paintMotelVacancy = (canvas, font, noLit)=>{
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#10161c';
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'middle';
    context.font = fontSpec({
        ...font,
        weight: 800
    }, height * 0.62);
    context.textAlign = 'left';
    if (noLit) strokeNeonText(context, 'NO', width * 0.05, height * 0.55, '#ff3b4a', height * 0.12);
    else {
        context.fillStyle = '#3a2328';
        context.fillText('NO', width * 0.05, height * 0.55);
    }
    context.textAlign = 'right';
    strokeNeonText(context, 'VACANCY', width * 0.95, height * 0.55, '#58f0a0', height * 0.12);
};
