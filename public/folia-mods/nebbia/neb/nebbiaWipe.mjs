/* 移植自 Folia「雾笺」 nebbiaWipe.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp } from './nebbiaConstants.mjs';
import { lineRect } from './nebbiaScene.mjs';
import { createVisualizerRng } from './visualizerSeedHash.mjs';
export const buildWipe = (line, idx)=>{
    const rnd = createVisualizerRng(idx * 4241 + 77 >>> 0);
    const { x0, x1, y0, y1, S } = lineRect(line);
    if (!Number.isFinite(x0)) return null;
    const fw = Math.max(14, S * 0.28), n = 2, gap = fw * 0.8;
    const handW = gap + fw, cy = (y0 + y1) / 2, pad = S * 0.3;
    const fingers = [
        {
            w: fw * (0.92 + rnd() * 0.08),
            lenK: 0.88 + rnd() * 0.04
        },
        {
            w: fw * (0.97 + rnd() * 0.08),
            lenK: 1
        }
    ];
    const bowDir = rnd() < 0.5 ? 1 : -1, phase = rnd() * Math.PI * 2, swing = 0.45 + rnd() * 0.15;
    const len = y1 - y0 + pad * 2, slant = Math.sin(swing) * len * 0.5, xs = x0 - pad - slant, xe = x1 + pad + slant;
    const rubs = Math.max(6, Math.ceil((xe - xs) / (handW * 0.5)));
    const streaks = [];
    for(let k = 0; k < rubs; k += 1){
        const hx = xs + (xe - xs) * (k + 0.5) / rubs, down = k % 2 === 0 ? 1 : -1, pair = Math.floor(k / 2);
        const ang = swing * Math.sin(phase + pair * 0.5) + (rnd() - 0.5) * 0.06, ca = Math.cos(ang), sa = Math.sin(ang);
        const L = len * (0.95 + rnd() * 0.1), bow = bowDir * S * (0.08 + rnd() * 0.03);
        const a = k / rubs * 0.96, b = Math.min(1, (k + 1) / rubs * 0.96 + 0.04);
        for(let f = 0; f < n; f += 1){
            const off = (f - (n - 1) / 2) * gap, { w: fwk, lenK } = fingers[f];
            const pts = [];
            for(let i = 0; i <= 12; i += 1){
                const t = i / 12, u = 2 * t - 1, v = down * (t - 0.5) * L * lenK, w = off + bow * (1 - u * u);
                pts.push([
                    hx + sa * v + ca * w,
                    cy + ca * v - sa * w
                ]);
            }
            const r = fwk * 0.7, xsP = pts.map((q)=>q[0]), ysP = pts.map((q)=>q[1]);
            streaks.push({
                pts,
                w: fwk,
                a,
                b,
                box: [
                    Math.min(...xsP) - r,
                    Math.min(...ysP) - r,
                    Math.max(...xsP) + r,
                    Math.max(...ysP) + r
                ]
            });
        }
    }
    const beads = [];
    for (const st of streaks.slice(-n)){
        const [ex, ey] = st.pts[st.pts.length - 1];
        beads.push({
            x: ex,
            y: ey,
            r: st.w * 0.22 + 1.5 * rnd()
        });
        if (rnd() < 0.6) beads.push({
            x: ex - (st.pts[1][0] - st.pts[0][0]) * 0.6 + (rnd() - 0.5) * st.w * 0.6,
            y: ey - (st.pts[1][1] - st.pts[0][1]) * 0.6,
            r: 1.5 + rnd() * 2.5
        });
    }
    return {
        streaks,
        beads,
        dur: Math.min(0.08 * rubs, 1.6)
    };
};
export const streakProgress = (st, ue)=>clamp((ue - st.a) / (st.b - st.a));
export const isSwept = (wipe, ue, x, y)=>wipe.streaks.some((st)=>{
        const lp = streakProgress(st, ue);
        if (lp <= 0) return false;
        const bx = st.box;
        if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) return false;
        const pts = st.pts, last = lp * (pts.length - 1), r = st.w * 0.7, r2 = r * r;
        for(let i = 0; i < last; i += 1){
            const [ax, ay] = pts[i], b = pts[i + 1], f = Math.min(1, last - i);
            const dx = (b[0] - ax) * f, dy = (b[1] - ay) * f;
            const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
            const ex = x - ax - dx * t, ey = y - ay - dy * t;
            if (ex * ex + ey * ey < r2) return true;
        }
        return false;
    });
