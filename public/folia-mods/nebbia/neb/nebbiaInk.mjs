/* 移植自 Folia「雾笺」 nebbiaInk.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp, NEBBIA_FIXED, MASK_SCALE, smooth } from './nebbiaConstants.mjs';
import { windDrift } from './nebbiaDrops.mjs';
import './nebbiaScene.mjs';
import { pointAt } from './nebbiaGlyphs.mjs';
import { putInkBead } from './_stubs.mjs';
export const strokeTrail = (ctx, x, y0, y1, width, v, seed, wob)=>{
    if (y1 - y0 < 2) return;
    for(let y = y0; y < y1; y += 4){
        const ye = Math.min(y1, y + 5);
        const along = (y - y0) / Math.max(1, y1 - y0);
        const w = width * (0.72 + 0.28 * along) * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(y * 0.19 + seed * 3)));
        ctx.moveTo(x + wob(y), y);
        ctx.lineTo(x + wob(ye), ye);
        ctx.stroke(w, v);
    }
};
const partialPath = (p, st, l)=>{
    const { pts, cum } = st;
    p.moveTo(pts[0][0], pts[0][1]);
    for(let i = 1; i < pts.length; i += 1){
        if (cum[i] >= l) {
            const k = (l - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
            p.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k);
            return;
        }
        p.lineTo(pts[i][0], pts[i][1]);
    }
};
const toScreen = (c, u, v)=>{
    const cs = Math.cos(c.rot), sn = Math.sin(c.rot), lx = (u - 0.5) * c.s, ly = (v - 0.5) * c.s;
    return [
        c.x + cs * lx - sn * ly,
        c.y + sn * lx + cs * ly
    ];
};
const PEN_TAIL = 24;
const pushPen = (pens, c, st, drawn, width)=>{
    const [ux, uy] = pointAt(st, drawn), [vx, vy] = pointAt(st, Math.max(0, drawn - PEN_TAIL / c.s));
    const [x1, y1] = toScreen(c, ux, uy), [x0, y0] = toScreen(c, vx, vy);
    pens.push(x0, y0, x1, y1, width * c.s);
};
const pushWet = (wet, c, st, drawn, width)=>{
    const { pts, cum } = st;
    let [x0, y0] = toScreen(c, pts[0][0], pts[0][1]);
    for(let i = 1; i < pts.length && cum[i - 1] < drawn; i += 1){
        const [u, v] = cum[i] > drawn ? pointAt(st, drawn) : pts[i];
        const [x1, y1] = toScreen(c, u, v);
        wet.push(x0, y0, x1, y1, width * c.s);
        x0 = x1;
        y0 = y1;
    }
};
const drawDrip = (ink, c, st, d, age, width, clarity, beadV, alive)=>{
    let bx = 0, by = -1e9;
    for (const q of st.pts){
        const [x, y] = toScreen(c, q[0], q[1]);
        if (y > by) {
            bx = x;
            by = y;
        }
    }
    by += width * c.s * 0.35;
    const u = clamp(age / d.dur), f = u - Math.sin(u * 6 * Math.PI) / (6 * Math.PI);
    const dist = d.len * f, r = d.r * (1 - 0.35 * u);
    const wob = (y)=>Math.sin(y * 0.07 + d.seed) * 1.6 + Math.sin(y * 0.023 + d.seed * 2) * 2.5 + windDrift(y, ink.busSpeed);
    if (dist > 1 && clarity > 0.002) strokeTrail(ink.ctx, bx, by, by + dist, r * 1.5, clarity * 0.95, d.seed, (y)=>wob(y - by));
    if (beadV <= 0.002) return;
    const speed = 1 - Math.cos(u * 6 * Math.PI);
    for(let y = 14 + d.seed % 7 * 2; y < dist - r * 2; y += 18 + (y * 7 + d.seed * 13) % 11){
        const x = bx + wob(y), v = alive ? beadV * alive(x, by + y) : beadV;
        if (v > 0.002) ink.motion.put(x, by + y, r * (0.3 + 0.2 * ((y + d.seed) * 0.37 % 1)), v);
    }
    const ex = bx + wob(dist), ey = by + dist + r * 0.3, ev = alive ? beadV * alive(ex, ey) : beadV;
    if (ev > 0.002) putInkBead(ink, ex, ey, r, ev, u < 1 ? -1 : age - d.dur, d.seed + 0.5, 1, 1 + 0.35 * speed * (u < 1 ? 1 : 0));
    if (ink.sweeps && u < 1 && dist > 1 && beadV > 0.3) {
        const ya = Math.max(0, dist - r * 3);
        ink.sweeps.push(bx + wob(ya), by + ya, bx + wob(dist), by + dist + r * 0.3, r * 2.4);
    }
};
export const drawChar = (ink, c, T, clarityIn, beadIn = clarityIn, alive = null)=>{
    const g = c.glyph;
    const fadeIn = c.appearDur > 0;
    if (!g || T < (fadeIn ? c.t : c.wt)) return;
    const { ctx, motion } = ink;
    let clarity = clarityIn, beadV = beadIn;
    if (fadeIn) {
        const a = smooth(clamp((T - c.t) / c.appearDur));
        clarity *= a;
        beadV *= a;
    }
    const wd = c.wd;
    const gap = Math.min(0.06 / ink.writeSpeed, wd * 0.08);
    const inkTime = wd - gap * (g.strokes.length - 1);
    let local = T - (fadeIn ? c.t : c.wt);
    const k = MASK_SCALE, cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    ctx.setTransform(cs * c.s * k, sn * c.s * k, -sn * c.s * k, cs * c.s * k, (c.x - c.s / 2 * (cs - sn)) * k, (c.y - c.s / 2 * (sn + cs)) * k);
    const thin = clamp(Math.sqrt(9 / g.strokes.length), 0.55, 1);
    const width = Math.max(ink.strokeWidth * thin, 8 * thin / c.s);
    const drips = [];
    g.strokes.forEach((st, si)=>{
        const dur = fadeIn ? 0 : inkTime * st.len / g.total;
        if (local <= 0) return;
        const p = dur > 0 ? clamp(local / dur) : 1;
        const drawn = (p * 0.4 + smooth(p) * 0.6) * st.len;
        if (clarity > 0.002) {
            partialPath(ctx, st, drawn);
            ctx.stroke(width, clarity);
        }
        if (ink.sweeps && !fadeIn && p > 0 && p < 1) pushPen(ink.sweeps, c, st, drawn, width);
        if (ink.wet && !fadeIn && drawn > 0 && beadV > 0.3) pushWet(ink.wet, c, st, drawn, width);
        if (!fadeIn) {
            for (const b of c.beads[si]){
                if (b.s > drawn) break;
                const off = width / 2 + (b.r * 0.7 + b.j * 1.5) / c.s;
                const [x, y] = toScreen(c, b.x + b.nx * off, b.y + b.ny * off);
                const bv = alive && beadV > 0.002 ? beadV * alive(x, y) : beadV;
                if (bv <= 0.002) continue;
                putInkBead(ink, x, y, b.r * (0.55 + 0.45 * bv), bv, p >= 1 ? local - dur : -1, b.x * 131.7 + b.y * 71.3 + si, 1 + b.j * 0.25, 1 + (1 - b.j) * 0.3);
            }
            if (NEBBIA_FIXED.endBead > 0 && drawn > 0 && c.s >= NEBBIA_FIXED.endBeadMin) {
                const e = c.ends[si];
                const [ux, uy] = pointAt(st, drawn), [vx, vy] = pointAt(st, Math.max(0, drawn - 2 / c.s));
                let dx = ux - vx, dy = uy - vy;
                const dl = Math.hypot(dx, dy) || 1;
                dx /= dl;
                dy /= dl;
                const r = c.s * (0.031 + 0.018 * e.h) * NEBBIA_FIXED.endBead * (0.5 + 0.5 * smooth(p));
                const [x, y] = toScreen(c, ux + dx * r * 0.35 / c.s, uy + (dy * r * 0.35 + r * 0.15) / c.s);
                const ev = alive && beadV > 0.002 ? beadV * alive(x, y) : beadV;
                if (ev > 0.002) putInkBead(ink, x, y, r * (0.6 + 0.4 * ev), ev, p >= 1 ? local - dur : -1, c.x * 3.1 + c.y * 5.7 + si * 11, 1, 1.12 + e.j * 0.12);
            }
            const d = c.drips[si];
            if (d && p >= 1 && local - dur > d.delay) drips.push([
                st,
                d,
                local - dur - d.delay
            ]);
        }
        local -= dur + (fadeIn ? 0 : gap);
    });
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    for (const [st, d, age] of drips)drawDrip(ink, c, st, d, age, width, clarity, beadV, alive);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
};
