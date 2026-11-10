/* 移植自 Folia components/visualizer/hanabi/text/animations.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const ENTER_FX = [
    'pop',
    'drop',
    'rise',
    'spin',
    'wipe',
    'type',
    'scramble',
    'stretch',
    'elastic',
    'split',
    'spiral',
    'flip',
    'glitch',
    'stamp',
    'wave',
    'zoom',
    'burst'
];
export const SING_FX = [
    'none',
    'bounce',
    'flash',
    'swell',
    'shake',
    'jump',
    'glow',
    'underline',
    'color'
];
export const EXIT_FX = [
    'ascend',
    'scatter',
    'shrink',
    'slide',
    'dissolve',
    'fall',
    'blink'
];
export const ENTER_DURATION = {
    pop: 0.45,
    drop: 0.62,
    rise: 0.6,
    spin: 0.62,
    wipe: 0.42,
    type: 0.12,
    scramble: 0.75,
    stretch: 0.55,
    elastic: 0.85,
    split: 0.5,
    spiral: 0.85,
    flip: 0.55,
    glitch: 0.6,
    stamp: 0.5,
    wave: 0.75,
    zoom: 0.6,
    burst: 0.75
};
export const ENTER_ARRIVAL = {
    pop: 0,
    drop: 0.4,
    rise: 0.3,
    spin: 0.2,
    wipe: 0,
    type: 0,
    scramble: 0,
    stretch: 0.1,
    elastic: 0.1,
    split: 0.3,
    spiral: 0.45,
    flip: 0.15,
    glitch: 0,
    stamp: 0.35,
    wave: 0.3,
    zoom: 0.25,
    burst: 0.3
};
export const STAMP_IMPACT = 0.5;
export const clamp01 = (value)=>value <= 0 ? 0 : value >= 1 ? 1 : value;
const easeOutCubic = (t)=>1 - (1 - t) ** 3;
const easeInCubic = (t)=>t * t * t;
const easeInQuad = (t)=>t * t;
const easeOutQuad = (t)=>1 - (1 - t) * (1 - t);
const easeOutExpo = (t)=>t >= 1 ? 1 : 1 - 2 ** (-10 * t);
const easeOutBack = (t, s = 1.70158)=>1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
const easeInBack = (t, s = 1.70158)=>(s + 1) * t * t * t - s * t * t;
export const easeInOutCubic = (t)=>t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const dampedCos = (q, freq, decay)=>Math.exp(-decay * q) * Math.cos(freq * q) * (1 - q);
const dampedSin = (q, freq, decay)=>Math.exp(-decay * q) * Math.sin(freq * q) * (1 - q);
export const hash01 = (a, b = 0)=>{
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
};
export const restPose = ()=>({
        dx: 0,
        dy: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        skew: 0,
        scramble: -1,
        rgbSplit: 0,
        blur: 0,
        split: 0,
        backside: false,
        reveal: 1
    });
export const restSing = ()=>({
        dx: 0,
        dy: 0,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flash: 0,
        glow: 0,
        color: 0
    });
const applyMotion = (pose, motion)=>{
    if (motion === 1) return pose;
    pose.dx *= motion;
    pose.dy *= motion;
    pose.rotation *= motion;
    pose.skew *= motion;
    pose.rgbSplit *= motion;
    pose.scaleX = 1 + (pose.scaleX - 1) * motion;
    pose.scaleY = 1 + (pose.scaleY - 1) * motion;
    return pose;
};
const scaled = (pose, scale)=>{
    pose.scaleX = scale;
    pose.scaleY = scale;
    return pose;
};
export const enterPose = (fx, p, ctx)=>{
    const pose = restPose();
    if (p >= 1) return pose;
    const q = clamp01(p);
    const [r0, r1, r2] = ctx.rand;
    switch(fx){
        case 'pop':
            {
                const s = easeOutBack(q, 2.4);
                scaled(pose, s);
                pose.scaleY = s * (1 + 0.14 * dampedSin(q, 14, 3));
                pose.scaleX = s * (1 - 0.1 * dampedSin(q, 14, 3));
                pose.rotation = (r0 - 0.5) * 0.7 * (1 - easeOutCubic(q));
                pose.dy = 0.25 * (1 - easeOutCubic(q));
                pose.alpha = clamp01(q * 6);
                break;
            }
        case 'drop':
            {
                if (q < 0.48) {
                    const f = q / 0.48;
                    pose.dy = -2.4 * (1 - f * f);
                    pose.scaleY = 1 + 0.3 * f;
                    pose.scaleX = 1 - 0.12 * f;
                } else {
                    const f = (q - 0.48) / 0.52;
                    pose.dy = -0.32 * Math.abs(Math.sin(f * Math.PI * 2)) * Math.exp(-3 * f) * (1 - f);
                    pose.scaleY = 1 - 0.3 * dampedCos(f, 16, 4);
                    pose.scaleX = 1 + 0.22 * dampedCos(f, 16, 4);
                }
                pose.alpha = clamp01(q * 7);
                break;
            }
        case 'rise':
            {
                const f = clamp01(q / 0.58);
                const e = easeOutCubic(f);
                pose.dy = 1.7 * (1 - e);
                if (q < 0.58) {
                    pose.scaleY = 1 + 0.55 * (1 - e);
                    pose.scaleX = 1 - 0.28 * (1 - e);
                } else {
                    const g = (q - 0.58) / 0.42;
                    pose.scaleY = 1 - 0.2 * dampedSin(g, 11, 2.5);
                    pose.scaleX = 1 + 0.16 * dampedSin(g, 11, 2.5);
                    pose.dy += 0.08 * dampedSin(g, 11, 2.5);
                }
                pose.alpha = clamp01(q * 4);
                break;
            }
        case 'spin':
            {
                const e = easeOutBack(q, 1.9);
                pose.rotation = -2.6 * (1 - e) * (r0 < 0.5 ? 1 : -1);
                scaled(pose, 0.15 + 0.85 * e);
                pose.dx = -0.7 * (1 - easeOutCubic(q)) * ctx.dirX;
                pose.dy = -0.7 * (1 - easeOutCubic(q)) * ctx.dirY - 0.3 * Math.sin(Math.PI * q) * (1 - q);
                pose.alpha = clamp01(q * 4);
                break;
            }
        case 'wipe':
            {
                const e = easeOutCubic(q);
                pose.reveal = easeOutCubic(clamp01(q / 0.8));
                pose.dx = -0.35 * (1 - e) * ctx.dirX;
                pose.dy = -0.35 * (1 - e) * ctx.dirY;
                pose.skew = -0.3 * (1 - e);
                pose.alpha = clamp01(q * 8);
                break;
            }
        case 'type':
            {
                pose.alpha = q > 0 ? 1 : 0;
                scaled(pose, 1 + 0.3 * (1 - clamp01(q / 0.6)) ** 2);
                break;
            }
        case 'scramble':
            {
                pose.alpha = clamp01(q * 8);
                if (q < 0.72) {
                    const frame = Math.floor(ctx.time * 22);
                    pose.scramble = Math.floor(hash01(frame, Math.floor(r0 * 1e6)) * 1e6);
                    pose.dy = (hash01(frame + 7, Math.floor(r1 * 1e6)) - 0.5) * 0.12;
                    pose.alpha *= 0.75 + 0.25 * hash01(frame + 13, 1);
                } else {
                    scaled(pose, 1 + 0.16 * (1 - (q - 0.72) / 0.28) ** 2);
                }
                break;
            }
        case 'stretch':
            {
                const k = (1 - q) ** 3;
                pose.scaleX = 1 + 2 * k - 0.16 * dampedSin(q, 13, 3);
                pose.scaleY = 1 - 0.72 * k + 0.12 * dampedSin(q, 13, 3);
                pose.dx = -1.4 * k * ctx.dirX;
                pose.dy = -1.4 * k * ctx.dirY;
                pose.alpha = clamp01(q * 5);
                break;
            }
        case 'elastic':
            {
                const angle = r0 * Math.PI * 2;
                const spring = Math.exp(-4.2 * q) * Math.cos(q * Math.PI * 4.5) * (1 - q);
                pose.dx = Math.cos(angle) * 1.6 * spring;
                pose.dy = Math.sin(angle) * 1.6 * spring;
                pose.rotation = (r1 - 0.5) * 0.8 * spring;
                pose.scaleX = 1 + 0.18 * Math.abs(spring);
                pose.scaleY = 1 - 0.12 * Math.abs(spring);
                pose.alpha = clamp01(q * 5);
                break;
            }
        case 'split':
            {
                pose.split = 1 - easeOutExpo(clamp01(q / 0.8));
                if (q > 0.8) {
                    const g = (q - 0.8) / 0.2;
                    pose.scaleX = 1 + 0.1 * dampedSin(g, 10, 2);
                    pose.scaleY = 1 - 0.08 * dampedSin(g, 10, 2);
                }
                pose.alpha = clamp01(q * 5);
                break;
            }
        case 'spiral':
            {
                const e = easeOutCubic(q);
                const radius = 3.4 * (1 - e);
                const angle = r0 * Math.PI * 2 + Math.PI * 2.5 * (1 - e);
                pose.dx = Math.cos(angle) * radius;
                pose.dy = Math.sin(angle) * radius * 0.8;
                pose.rotation = -Math.PI * 2 * (1 - e) * (r1 < 0.5 ? 1 : -1);
                scaled(pose, 0.25 + 0.75 * easeOutBack(q, 1.5));
                pose.alpha = clamp01(q * 3);
                break;
            }
        case 'flip':
            {
                const phi = Math.PI * 2.5 * (1 - easeOutCubic(q));
                pose.scaleX = Math.cos(phi);
                pose.backside = pose.scaleX < 0;
                pose.scaleY = 1 + 0.08 * Math.sin(phi);
                pose.dy = -0.3 * Math.sin(Math.PI * q) * (1 - q);
                pose.alpha = clamp01(q * 6);
                break;
            }
        case 'glitch':
            {
                if (q < 0.8) {
                    const frame = Math.floor(ctx.time * 24);
                    const seed = Math.floor(r0 * 1e6);
                    const intensity = 1 - q / 0.8;
                    const h1 = hash01(frame, seed), h2 = hash01(frame, seed + 1), h3 = hash01(frame, seed + 2), h4 = hash01(frame, seed + 3);
                    pose.dx = h2 > 0.35 ? (h1 - 0.5) * 0.9 * intensity : 0;
                    pose.rgbSplit = (0.05 + 0.13 * h3) * intensity;
                    pose.skew = h4 > 0.7 ? (h1 - 0.5) * 0.9 * intensity : 0;
                    pose.scaleX = h2 > 0.82 ? 1 + 0.4 * intensity : 1;
                    pose.alpha = clamp01(q * 10) * (hash01(frame, seed + 4) > 0.18 ? 1 : 0.25);
                }
                break;
            }
        case 'stamp':
            {
                if (q < STAMP_IMPACT) {
                    const f = q / STAMP_IMPACT;
                    scaled(pose, 2.6 - 1.6 * easeInQuad(f));
                    pose.rotation = (r0 - 0.5) * 0.35 * (1 - f);
                    pose.alpha = clamp01(f * 2.2);
                } else {
                    const f = (q - STAMP_IMPACT) / (1 - STAMP_IMPACT);
                    pose.scaleX = 1 + 0.22 * dampedCos(f, 17, 4);
                    pose.scaleY = 1 - 0.22 * dampedCos(f, 17, 4);
                }
                break;
            }
        case 'wave':
            {
                const k = (1 - q) ** 1.5;
                pose.dy = 1.1 * k * Math.cos(q * Math.PI * 3);
                pose.rotation = 0.4 * k * Math.sin(q * Math.PI * 3);
                pose.scaleY = 1 + 0.18 * k * Math.sin(q * Math.PI * 3 + 0.6);
                pose.alpha = clamp01(q * 4);
                break;
            }
        case 'zoom':
            {
                const e = easeOutExpo(q);
                const k = 1.8 * (1 - e);
                scaled(pose, 1 + k * 1.5);
                pose.dx = -ctx.toCenterX * k;
                pose.dy = -ctx.toCenterY * k;
                pose.blur = (1 - q) ** 1.4;
                pose.alpha = clamp01(q * 3.5);
                break;
            }
        case 'burst':
            {
                const e = easeOutBack(q, 1.8);
                pose.dx = ctx.toCenterX * (1 - e);
                pose.dy = ctx.toCenterY * (1 - e);
                scaled(pose, 0.2 + 0.8 * easeOutBack(clamp01(q * 1.3), 1.6));
                pose.rotation = (r2 - 0.5) * 4 * (1 - easeOutCubic(q));
                pose.alpha = clamp01(q * 6);
                break;
            }
    }
    return applyMotion(pose, ctx.motion);
};
export const exitPose = (fx, p, ctx)=>{
    const pose = restPose();
    if (p <= 0) return pose;
    const q = clamp01(p);
    const [r0, r1, r2] = ctx.rand;
    switch(fx){
        case 'ascend':
            {
                const e = easeInCubic(q);
                const dip = q < 0.22 ? Math.sin(q / 0.22 * Math.PI) * 0.12 : 0;
                pose.dy = dip - 2.8 * e;
                pose.dx = (r0 - 0.5) * 0.7 * e;
                pose.rotation = (r1 - 0.5) * 0.5 * e;
                pose.scaleY = 1 + 0.45 * e;
                pose.scaleX = 1 - 0.22 * e;
                pose.alpha = 1 - easeInQuad(q);
                break;
            }
        case 'scatter':
            {
                let ox = -ctx.toCenterX + (r0 - 0.5) * 2;
                let oy = -ctx.toCenterY + (r1 - 0.5) * 2;
                const len = Math.hypot(ox, oy) || 1;
                ox /= len;
                oy /= len;
                const e = easeOutCubic(q);
                const dist = 2.4 + r2 * 1.8;
                pose.dx = ox * dist * e;
                pose.dy = oy * dist * e;
                pose.rotation = (r1 - 0.5) * 3.2 * e;
                scaled(pose, 1 - 0.65 * e);
                pose.alpha = 1 - q ** 1.6;
                break;
            }
        case 'shrink':
            {
                const s = q < 0.2 ? 1 + 0.16 * Math.sin(q / 0.2 * Math.PI / 2) : 1.16 * (1 - easeInBack((q - 0.2) / 0.8, 1.4));
                scaled(pose, Math.max(0, s));
                pose.rotation = (r0 - 0.5) * 0.9 * q;
                pose.alpha = q > 0.8 ? (1 - q) / 0.2 : 1;
                break;
            }
        case 'slide':
            {
                const e = easeInBack(q, 1.6);
                const dist = ctx.slideDistance ?? 7;
                pose.dx = ctx.dirX * dist * e;
                pose.dy = ctx.dirY * dist * e;
                pose.scaleX = 1 + 0.45 * easeInQuad(q) * Math.abs(ctx.dirX);
                pose.scaleY = 1 + 0.45 * easeInQuad(q) * Math.abs(ctx.dirY);
                pose.skew = -0.45 * easeInQuad(q) * Math.sign(ctx.dirX || 1);
                pose.alpha = 1 - clamp01((q - 0.45) / 0.55) ** 1.5;
                break;
            }
        case 'dissolve':
            {
                const frame = Math.floor(ctx.time * 20);
                const flicker = hash01(frame, Math.floor(r0 * 1e6));
                pose.alpha = (1 - q) ** 1.3 * (1 - 0.45 * q * flicker);
                scaled(pose, 1 + 0.14 * easeOutQuad(q));
                pose.dy = -0.35 * easeOutQuad(q);
                pose.blur = q;
                break;
            }
        case 'fall':
            {
                const e = easeInQuad(q);
                pose.dy = 3 * e;
                pose.dx = 0.28 * Math.sin(q * Math.PI * 2 + r0 * 6) * q;
                pose.rotation = (r1 - 0.5) * 1.2 * e;
                pose.scaleY = 1 + 0.4 * e;
                pose.scaleX = 1 - 0.25 * e;
                pose.alpha = 1 - q ** 1.6;
                break;
            }
        case 'blink':
            {
                const on = q < 0.14 || q >= 0.24 && q < 0.4 || q >= 0.5 && q < 0.6 || q >= 0.7 && q < 0.76 || q >= 0.82 && q < 0.85;
                pose.alpha = on && q < 1 ? 1 : 0;
                scaled(pose, 1 + (on ? 0.05 * q : 0));
                break;
            }
    }
    if (q >= 1) pose.alpha = 0;
    return applyMotion(pose, ctx.motion);
};
export const singPose = (fx, u, duration, rand, motion)=>{
    const pose = restSing();
    if (u < 0 || fx === 'none') return pose;
    const hold = Math.max(duration, 0.12);
    const envelope = clamp01(u / 0.08) * (1 - clamp01((u - hold) / 0.35));
    switch(fx){
        case 'bounce':
            {
                const T = 0.3;
                if (u < T) pose.dy = -0.26 * Math.sin(u / T * Math.PI);
                else if (u < T + 0.16) pose.dy = -0.06 * Math.sin((u - T) / 0.16 * Math.PI);
                const land = u - T;
                if (land >= 0 && land < 0.3) {
                    const f = land / 0.3;
                    pose.scaleY = 1 - 0.14 * dampedCos(f, 14, 3);
                    pose.scaleX = 1 + 0.1 * dampedCos(f, 14, 3);
                } else if (u < T) {
                    pose.scaleY = 1 + 0.08 * Math.sin(u / T * Math.PI);
                }
                break;
            }
        case 'flash':
            {
                pose.flash = Math.exp(-u / 0.16);
                pose.scale = 1 + 0.2 * Math.exp(-u / 0.1) * clamp01(u / 0.03);
                break;
            }
        case 'swell':
            {
                pose.scale = 1 + 0.24 * easeOutBack(clamp01(u / 0.18), 2) * (1 - clamp01((u - hold) / 0.35));
                break;
            }
        case 'shake':
            {
                const decay = Math.exp(-Math.max(0, u - hold) / 0.08);
                const k = clamp01(u / 0.04) * decay * (u < hold + 0.4 ? 1 : 0);
                pose.dx = 0.06 * Math.sin(u * 61 + rand * 9) * k;
                pose.dy = 0.04 * Math.sin(u * 47 + rand * 5) * k;
                pose.rotation = 0.08 * Math.sin(u * 53 + rand * 7) * k;
                break;
            }
        case 'jump':
            {
                const T = 0.42;
                if (u < T) {
                    const f = u / T;
                    pose.dy = -0.5 * Math.sin(f * Math.PI);
                    pose.rotation = (rand < 0.5 ? 1 : -1) * 0.22 * Math.sin(f * Math.PI * 2) * (1 - f);
                    pose.scaleY = 1 + 0.2 * Math.sin(f * Math.PI) * (1 - f);
                    pose.scaleX = 1 - 0.12 * Math.sin(f * Math.PI) * (1 - f);
                } else if (u < T + 0.35) {
                    const f = (u - T) / 0.35;
                    pose.scaleY = 1 - 0.2 * dampedCos(f, 13, 3);
                    pose.scaleX = 1 + 0.16 * dampedCos(f, 13, 3);
                }
                break;
            }
        case 'glow':
            {
                pose.glow = envelope;
                pose.flash = 0.35 * envelope;
                pose.scale = 1 + 0.07 * envelope;
                break;
            }
        case 'underline':
            {
                pose.dy = -0.05 * envelope;
                break;
            }
        case 'color':
            {
                pose.color = clamp01(u / 0.1);
                pose.scale = 1 + 0.14 * Math.exp(-u / 0.12) * clamp01(u / 0.03);
                break;
            }
    }
    if (motion !== 1) {
        pose.dx *= motion;
        pose.dy *= motion;
        pose.rotation *= motion;
        pose.scale = 1 + (pose.scale - 1) * motion;
        pose.scaleX = 1 + (pose.scaleX - 1) * motion;
        pose.scaleY = 1 + (pose.scaleY - 1) * motion;
    }
    return pose;
};
export const combinePoses = (a, b, out = restPose())=>{
    out.dx = a.dx + b.dx;
    out.dy = a.dy + b.dy;
    out.scaleX = a.scaleX * b.scaleX;
    out.scaleY = a.scaleY * b.scaleY;
    out.rotation = a.rotation + b.rotation;
    out.alpha = a.alpha * b.alpha;
    out.skew = a.skew + b.skew;
    out.scramble = a.scramble >= 0 ? a.scramble : b.scramble;
    out.rgbSplit = a.rgbSplit + b.rgbSplit;
    out.blur = Math.max(a.blur, b.blur);
    out.split = Math.max(a.split, b.split);
    out.backside = a.backside || b.backside;
    out.reveal = Math.min(a.reveal, b.reveal);
    return out;
};
export const enterOrder = (fx, count, rand)=>{
    const order = Array.from({
        length: count
    }, (_, index)=>index);
    if (fx === 'scramble' || fx === 'glitch') {
        for(let i = count - 1; i > 0; i -= 1){
            const j = Math.floor(rand() * (i + 1));
            [order[i], order[j]] = [
                order[j],
                order[i]
            ];
        }
        const rank = new Array(count);
        order.forEach((glyph, k)=>{
            rank[glyph] = k;
        });
        return rank;
    }
    if (fx === 'zoom' || fx === 'burst') {
        const mid = (count - 1) / 2;
        return order.map((index)=>Math.round(Math.abs(index - mid) * 2) / 2);
    }
    return order;
};
const STAGGER_FACTOR = {
    burst: 0.35,
    zoom: 0.6,
    stamp: 1.35,
    type: 1
};
export const scheduleEnter = (fx, ranks, enterAt, stagger, deadline)=>{
    const maxRank = ranks.reduce((max, rank)=>Math.max(max, rank), 0);
    let step = Math.max(0, stagger) * (STAGGER_FACTOR[fx] ?? 1);
    let duration = ENTER_DURATION[fx];
    const available = deadline - enterAt;
    if (step * maxRank + duration > available) {
        step = maxRank > 0 ? Math.max(0, Math.min(step, (available - duration) / maxRank)) : 0;
        if (step * maxRank + duration > available) {
            const ratio = Math.max(0, available) / (step * maxRank + duration);
            step *= ratio;
            duration = Math.max(0.1, duration * ratio);
            if (step * maxRank + duration > available) step = maxRank > 0 ? Math.max(0, (available - duration) / maxRank) : 0;
        }
    }
    const start = ranks.map((rank)=>rank < 0 ? Number.NaN : enterAt + rank * step);
    return {
        start,
        duration,
        landed: start.map((value)=>value + duration)
    };
};
export const scheduleExit = (ranks, exitAt, exitDuration)=>{
    const maxRank = ranks.reduce((max, rank)=>Math.max(max, rank), 0);
    const total = Math.max(0.001, exitDuration);
    const step = maxRank > 0 ? Math.min(0.05, total * 0.4 / maxRank) : 0;
    const each = total - step * maxRank;
    const start = ranks.map((rank)=>rank < 0 ? Number.NaN : exitAt + rank * step);
    return {
        start,
        end: start.map((value)=>value + each)
    };
};
export const stampShake = (time, impacts, amplitude)=>{
    let x = 0;
    let y = 0;
    for(let i = 0; i < impacts.length; i += 1){
        const tau = time - impacts[i];
        if (tau < 0 || tau > 0.45) continue;
        const k = amplitude * Math.exp(-tau / 0.085);
        x += k * Math.sin(tau * 96 + i * 1.7);
        y += k * 0.8 * Math.sin(tau * 77 + i * 2.3 + 1);
    }
    return {
        x,
        y
    };
};
