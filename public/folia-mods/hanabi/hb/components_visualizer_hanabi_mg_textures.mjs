/* 移植自 Folia components/visualizer/hanabi/mg/textures.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const canvasOf = (width, height)=>{
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return {
        canvas,
        context: canvas.getContext('2d')
    };
};
const WHITE = (alpha)=>`rgba(255,255,255,${alpha})`;
const drawDot = (size)=>{
    const { canvas, context } = canvasOf(size, size);
    const r = size / 2;
    const gradient = context.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, WHITE(1));
    gradient.addColorStop(Math.max(0, 1 - 2 / r), WHITE(1));
    gradient.addColorStop(1, WHITE(0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return canvas;
};
const drawGlow = (size)=>{
    const { canvas, context } = canvasOf(size, size);
    const r = size / 2;
    const gradient = context.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, WHITE(1));
    gradient.addColorStop(0.1, WHITE(0.95));
    gradient.addColorStop(0.22, WHITE(0.55));
    gradient.addColorStop(0.42, WHITE(0.18));
    gradient.addColorStop(0.7, WHITE(0.05));
    gradient.addColorStop(1, WHITE(0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return canvas;
};
const drawStar4 = (size)=>{
    const { canvas, context } = canvasOf(size, size);
    const c = size / 2;
    const r = size * 0.48;
    const halo = context.createRadialGradient(c, c, 0, c, c, r * 0.5);
    halo.addColorStop(0, WHITE(0.9));
    halo.addColorStop(1, WHITE(0));
    context.fillStyle = halo;
    context.fillRect(0, 0, size, size);
    const pinch = r * 0.1;
    context.fillStyle = WHITE(1);
    context.beginPath();
    context.moveTo(c, c - r);
    context.quadraticCurveTo(c + pinch, c - pinch, c + r, c);
    context.quadraticCurveTo(c + pinch, c + pinch, c, c + r);
    context.quadraticCurveTo(c - pinch, c + pinch, c - r, c);
    context.quadraticCurveTo(c - pinch, c - pinch, c, c - r);
    context.closePath();
    context.fill();
    return canvas;
};
const drawStreak = (width, height)=>{
    const { canvas, context } = canvasOf(width, height);
    const vertical = context.createLinearGradient(0, 0, 0, height);
    vertical.addColorStop(0, WHITE(1));
    vertical.addColorStop(0.6, WHITE(0.6));
    vertical.addColorStop(1, WHITE(0.28));
    context.fillStyle = vertical;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    const horizontal = context.createLinearGradient(0, 0, width, 0);
    horizontal.addColorStop(0, WHITE(0));
    horizontal.addColorStop(0.3, WHITE(0.85));
    horizontal.addColorStop(0.5, WHITE(1));
    horizontal.addColorStop(0.7, WHITE(0.85));
    horizontal.addColorStop(1, WHITE(0));
    context.fillStyle = horizontal;
    context.fillRect(0, 0, width, height);
    return canvas;
};
const drawRing = (size)=>{
    const { canvas, context } = canvasOf(size, size);
    const c = size / 2;
    const line = Math.max(1.5, size * 0.05);
    context.strokeStyle = WHITE(1);
    context.lineWidth = line;
    context.beginPath();
    context.arc(c, c, c - line, 0, Math.PI * 2);
    context.stroke();
    return canvas;
};
const drawSquare = (size)=>{
    const { canvas, context } = canvasOf(size, size);
    context.fillStyle = WHITE(1);
    context.fillRect(0, 0, size, size);
    return canvas;
};
const drawTriangle = (size)=>{
    const { canvas, context } = canvasOf(size, size);
    const c = size / 2;
    const r = size * 0.48;
    context.fillStyle = WHITE(1);
    context.beginPath();
    for(let i = 0; i < 3; i += 1){
        const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r * 1.0 + r * 0.12;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    return canvas;
};
const drawPetal = (width, height)=>{
    const { canvas, context } = canvasOf(width, height);
    const cx = width / 2;
    const top = height * 0.06;
    const bottom = height * 0.96;
    const notch = height * 0.16;
    context.fillStyle = WHITE(1);
    context.beginPath();
    context.moveTo(cx, bottom);
    context.bezierCurveTo(cx - width * 0.62, height * 0.62, cx - width * 0.5, top, cx - width * 0.14, top);
    context.lineTo(cx, top + notch);
    context.lineTo(cx + width * 0.14, top);
    context.bezierCurveTo(cx + width * 0.5, top, cx + width * 0.62, height * 0.62, cx, bottom);
    context.closePath();
    context.fill();
    return canvas;
};
export const createHanabiTextures = (pixi, resolution)=>{
    const scale = Math.max(0.5, Math.min(4, resolution || 1));
    const px = (base)=>Math.max(4, Math.min(1024, Math.round(base * scale)));
    const make = (canvas)=>pixi.Texture.from(canvas);
    const textures = {
        dot: make(drawDot(px(32))),
        glow: make(drawGlow(px(96))),
        star4: make(drawStar4(px(96))),
        streak: make(drawStreak(px(16), px(128))),
        ring: make(drawRing(px(160))),
        square: make(drawSquare(px(8))),
        triangle: make(drawTriangle(px(48))),
        petal: make(drawPetal(px(32), px(44)))
    };
    return {
        ...textures,
        destroy: ()=>Object.values(textures).forEach((texture)=>texture.destroy(true))
    };
};
