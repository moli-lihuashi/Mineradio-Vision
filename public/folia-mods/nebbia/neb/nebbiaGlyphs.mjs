/* 移植自 Folia「雾笺」 nebbiaGlyphs.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { resolveLucideIconNode } from './_stubs.mjs';
import { clamp } from './nebbiaConstants.mjs';
import { ICON_PREFIX } from './nebbiaChars.mjs';
import { skeletonPolys } from './nebbiaSkeleton.mjs';
import { getNebbiaStrokeMedians } from './nebbiaStrokes.mjs';
export const measureGlyph = (polys)=>{
    let total = 0;
    const strokes = polys.filter((p)=>p.length > 1).map((pts)=>{
        const cum = [
            0
        ];
        for(let i = 1; i < pts.length; i += 1)cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        total += cum[cum.length - 1];
        return {
            pts,
            cum,
            len: cum[cum.length - 1]
        };
    }).filter((s)=>s.len > 0.005);
    return strokes.length ? {
        strokes,
        total
    } : null;
};
const catmull = (pts, n)=>{
    if (pts.length < 3) return pts;
    const out = [];
    for(let i = 0; i < pts.length - 1; i += 1){
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for(let k = 0; k < n; k += 1){
            const t = k / n, t2 = t * t, t3 = t2 * t;
            const at = (j)=>0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
            out.push([
                at(0),
                at(1)
            ]);
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
};
let iconSvg = null;
const iconPolys = (name)=>{
    const nodes = resolveLucideIconNode(name);
    if (!nodes || typeof document === 'undefined') return null;
    if (!iconSvg) {
        iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.style.cssText = 'position:absolute;width:24px;height:24px;left:-99px;top:-99px;visibility:hidden;pointer-events:none';
        document.body.appendChild(iconSvg);
    }
    const polys = [];
    for (const [tag, attrs] of nodes){
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs))if (k !== 'key') el.setAttribute(k, String(v));
        iconSvg.appendChild(el);
        const len = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0, step = 0.35;
        let cur = [], prev = null;
        for(let l = 0; len > 0 && l <= len + 1e-6; l += step){
            const p = el.getPointAtLength(Math.min(l, len)), q = [
                p.x / 24,
                p.y / 24
            ];
            if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > step * 3 / 24) {
                if (cur.length > 1) polys.push(cur);
                cur = [];
            }
            cur.push(q);
            prev = q;
        }
        if (cur.length > 1) polys.push(cur);
        el.remove();
    }
    return polys.length ? polys : null;
};
export class NebbiaGlyphCache {
    fontFamily;
    fontWeight;
    cache = new Map();
    font = '';
    constructor(fontFamily, fontWeight){
        this.fontFamily = fontFamily;
        this.fontWeight = fontWeight;
        this.font = `${fontWeight} ${fontFamily}`;
    }
    setFont(fontFamily, fontWeight) {
        const font = `${fontWeight} ${fontFamily}`;
        if (font === this.font) return false;
        this.fontFamily = fontFamily;
        this.fontWeight = fontWeight;
        this.font = font;
        this.cache.clear();
        return true;
    }
    clear() {
        this.cache.clear();
    }
    fontReady() {
        try {
            return document.fonts?.check(`${this.fontWeight} 16px ${this.fontFamily}`) ?? true;
        } catch  {
            return true;
        }
    }
    get(ch) {
        const hit = this.cache.get(ch);
        if (hit !== undefined) return hit;
        let polys = null;
        const medians = getNebbiaStrokeMedians(ch);
        if (ch.startsWith(ICON_PREFIX)) polys = iconPolys(ch.slice(ICON_PREFIX.length));
        else if (medians) polys = medians.map((m)=>catmull(m.map(([x, y])=>[
                    x / 1024,
                    y / 1024
                ]), 6));
        else if (ch.trim()) polys = skeletonPolys(ch, this.fontFamily, this.fontWeight);
        const glyph = polys ? measureGlyph(polys) : null;
        this.cache.set(ch, glyph);
        return glyph;
    }
}
export const warpGlyph = (g, rnd, j)=>{
    if (j <= 0) return g;
    const r = ()=>rnd() * 2 - 1;
    const shear = r() * 0.16 * j, sx = 1 + r() * 0.1 * j, sy = 1 + r() * 0.1 * j;
    const bx = r() * 0.035 * j, by = r() * 0.035 * j, px = rnd() * 6.28, py = rnd() * 6.28;
    const whole = ([x, y])=>{
        let u = (x - 0.5) * sx, v = (y - 0.5) * sy;
        u += v * shear;
        u += bx * Math.sin(v * Math.PI * 1.6 + px);
        v += by * Math.sin(u * Math.PI * 1.6 + py);
        return [
            u + 0.5,
            v + 0.5
        ];
    };
    const sj = clamp(8 / g.strokes.length, 0.35, 1);
    const polys = g.strokes.map((st)=>{
        const pts = st.pts, n = pts.length;
        const cx = pts.reduce((a, p)=>a + p[0], 0) / n, cy = pts.reduce((a, p)=>a + p[1], 0) / n;
        const rot = r() * 0.09 * j * sj, len = 1 + r() * 0.1 * j * sj, ox = r() * 0.022 * j * sj, oy = r() * 0.022 * j * sj;
        const cr = Math.cos(rot), sr = Math.sin(rot), [x0, y0] = pts[0];
        const tremor = 0.006 * j, tf = 18 + rnd() * 14, tp = rnd() * 6.28;
        return pts.map(([x, y], i)=>{
            let u = x0 + (x - x0) * len, v = y0 + (y - y0) * len;
            const du = u - cx, dv = v - cy;
            u = cx + du * cr - dv * sr + ox;
            v = cy + du * sr + dv * cr + oy;
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
            const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
            const k = Math.sin(st.cum[i] * tf + tp) * tremor;
            return whole([
                u - ty / tl * k,
                v + tx / tl * k
            ]);
        });
    });
    return measureGlyph(polys) ?? g;
};
export const pointAt = (st, s)=>{
    const { pts, cum } = st;
    let i = 1;
    while(i < pts.length - 1 && cum[i] < s)i += 1;
    const a = pts[i - 1], b = pts[i], L = Math.max(1e-6, cum[i] - cum[i - 1]), k = clamp((s - cum[i - 1]) / L);
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    return [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        -dy,
        dx
    ];
};
