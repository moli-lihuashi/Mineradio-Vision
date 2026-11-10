/* 移植自 Folia「雾笺」 nebbiaCompositions.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { emitBlock, FLOW_GAP, hasTurned, measureBlock, STACK_GAP } from './nebbiaBlocks.mjs';
const M = (ctx, i, dir)=>measureBlock(ctx.blocks[i], ctx.chars, dir);
const flowRows = (ctx, rows, shifts)=>{
    const out = [];
    const rowMs = rows.map((r)=>r.map((i)=>M(ctx, i, 'h')));
    const rowW = rowMs.map((ms)=>ms.reduce((s, m)=>s + m.w, 0) + FLOW_GAP * (ms.length - 1));
    const widest = Math.max(...rowW);
    let y = 0;
    rowMs.forEach((ms, ri)=>{
        const rh = Math.max(...ms.map((m)=>m.h));
        let x = -rowW[ri] / 2 + shifts[ri] * widest;
        ms.forEach((m)=>{
            emitBlock(m, x + m.w / 2, y + rh - m.h / 2, out);
            x += m.w + FLOW_GAP;
        });
        y += rh + STACK_GAP;
    });
    return {
        items: out,
        vRot: 0
    };
};
export const COMPOSITIONS = {
    ribbon: (ctx)=>flowRows(ctx, [
            ctx.blocks.map((_, i)=>i)
        ], [
            0
        ]),
    lines2 (ctx) {
        const n = ctx.blocks.length;
        if (n < 2) return null;
        const ms = ctx.blocks.map((_, i)=>M(ctx, i, 'h')), total = ms.reduce((s, m)=>s + m.w, 0);
        let acc = 0, cut = 1, best = Infinity;
        ms.forEach((m, i)=>{
            acc += m.w;
            if (i < n - 1 && Math.abs(acc - total / 2) < best) {
                best = Math.abs(acc - total / 2);
                cut = i + 1;
            }
        });
        return flowRows(ctx, [
            [
                ...Array(cut).keys()
            ],
            [
                ...Array(n - cut).keys()
            ].map((i)=>i + cut)
        ], [
            -0.12,
            0.12
        ]);
    },
    lines3 (ctx) {
        const n = ctx.blocks.length;
        if (n < 3) return null;
        const ms = ctx.blocks.map((_, i)=>M(ctx, i, 'h')), total = ms.reduce((s, m)=>s + m.w, 0);
        const rows = [
            []
        ];
        let acc = 0;
        ms.forEach((m, i)=>{
            if (rows[rows.length - 1].length && rows.length < 3 && (acc + m.w / 2 > total / 3 * rows.length || n - i <= 3 - rows.length)) rows.push([]);
            rows[rows.length - 1].push(i);
            acc += m.w;
        });
        return rows.length === 3 ? flowRows(ctx, rows, [
            -0.14,
            0.1,
            -0.04
        ]) : null;
    },
    cross (ctx) {
        const { blocks, h } = ctx, n = blocks.length;
        if (n < 3 || n > 7) return null;
        const top = Math.floor(h / 2), right = Math.ceil((n - 1 - h) / 2);
        if (top === 0 && h + right + 1 >= n) return null;
        const out = [], hm = M(ctx, h, 'h');
        emitBlock(hm, 0, 0, out);
        let vRot = 0;
        let x = -hm.w / 2 - STACK_GAP;
        for(let i = h - 1; i >= top; i -= 1){
            const m = M(ctx, i, 'h');
            emitBlock(m, x - m.w / 2, (hm.h - m.h) / 2, out);
            x -= m.w + FLOW_GAP;
        }
        let y = -hm.h / 2 - STACK_GAP;
        for(let i = top - 1; i >= 0; i -= 1){
            const m = M(ctx, i, 'v');
            vRot += hasTurned(m);
            emitBlock(m, 0, y - m.h / 2, out);
            y -= m.h + STACK_GAP;
        }
        x = hm.w / 2 + STACK_GAP;
        for(let i = h + 1; i <= h + right; i += 1){
            const m = M(ctx, i, 'h');
            emitBlock(m, x + m.w / 2, (hm.h - m.h) / 2, out);
            x += m.w + FLOW_GAP;
        }
        y = hm.h / 2 + STACK_GAP;
        for(let i = h + right + 1; i < n; i += 1){
            const m = M(ctx, i, 'v');
            vRot += hasTurned(m);
            emitBlock(m, 0, y + m.h / 2, out);
            y += m.h + STACK_GAP;
        }
        return {
            items: out,
            vRot
        };
    },
    pillar (ctx) {
        const { blocks, h } = ctx, n = blocks.length;
        if (n < 2 || n > 6) return null;
        const out = [], hm = M(ctx, h, 'v');
        let vRot = hasTurned(hm);
        emitBlock(hm, 0, 0, out);
        const top = -hm.h / 2 + 0.15;
        const side = (from, to, dirX)=>{
            const cols = [
                []
            ];
            let y = top;
            for(let i = from; i !== to; i += 1){
                const m = M(ctx, i, 'v');
                vRot += hasTurned(m);
                if (y + m.h > hm.h / 2 + 0.6 && cols[cols.length - 1].length) {
                    cols.push([]);
                    y = top;
                }
                cols[cols.length - 1].push(m);
                y += m.h + STACK_GAP;
            }
            let colX = dirX * (hm.w / 2 + FLOW_GAP);
            for (const col of dirX > 0 ? cols : [
                ...cols
            ].reverse()){
                y = top;
                for (const m of col){
                    emitBlock(m, colX + dirX * m.w / 2, y + m.h / 2, out);
                    y += m.h + STACK_GAP;
                }
                colX += dirX * (Math.max(0, ...col.map((m)=>m.w)) + FLOW_GAP);
            }
        };
        side(0, h, -1);
        side(h + 1, n, 1);
        return {
            items: out,
            vRot
        };
    },
    header (ctx) {
        const { blocks, h } = ctx, n = blocks.length;
        if (n < 3 || n - 1 - h < 2) return null;
        const out = [], hm = M(ctx, h, 'h');
        emitBlock(hm, 0, 0, out);
        if (h > 0) {
            const ms = blocks.slice(0, h).map((_, i)=>M(ctx, i, 'h'));
            const rowW = ms.reduce((s, m)=>s + m.w, 0) + FLOW_GAP * (h - 1), rowH = Math.max(...ms.map((m)=>m.h));
            let x = -rowW / 2;
            const y = -hm.h / 2 - STACK_GAP - rowH / 2;
            ms.forEach((m)=>{
                emitBlock(m, x + m.w / 2, y + (rowH - m.h) / 2, out);
                x += m.w + FLOW_GAP;
            });
        }
        let y = hm.h / 2 + STACK_GAP;
        const L = -hm.w * 0.22 - FLOW_GAP / 2, R = hm.w * 0.22 + FLOW_GAP / 2;
        for(let i = h + 1; i < n; i += 2){
            const a = M(ctx, i, 'h'), b = i + 1 < n ? M(ctx, i + 1, 'h') : null;
            const rh = Math.max(a.h, b ? b.h : 0);
            emitBlock(a, L - a.w / 2, y + rh - a.h / 2, out);
            if (b) emitBlock(b, R + b.w / 2, y + rh - b.h / 2, out);
            y += rh + STACK_GAP;
        }
        return {
            items: out,
            vRot: 0
        };
    },
    badge (ctx) {
        const { blocks, h } = ctx, n = blocks.length;
        if (n < 3 || n > 7 || h !== 0) return null;
        const out = [], hm = M(ctx, 0, 'v');
        const ms = blocks.slice(1).map((_, i)=>M(ctx, i + 1, 'h'));
        const colW = Math.max(Math.max(...ms.map((m)=>m.w)), hm.h * 0.9);
        emitBlock(hm, hm.w / 2, hm.h / 2, out);
        let x = hm.w + FLOW_GAP, y = 0, rowH = 0;
        const left = ()=>y < hm.h ? hm.w + FLOW_GAP : 0;
        ms.forEach((m)=>{
            if (x > left() && x + m.w > hm.w + FLOW_GAP + colW) {
                y += rowH + STACK_GAP;
                x = left();
                rowH = 0;
            }
            emitBlock(m, x + m.w / 2, y + m.h / 2, out);
            x += m.w + FLOW_GAP;
            rowH = Math.max(rowH, m.h);
        });
        return {
            items: out,
            vRot: hasTurned(hm)
        };
    },
    columns (ctx) {
        const { blocks } = ctx, n = blocks.length;
        if (n < 2 || n > 5 || blocks.some((b)=>b.words.some((w)=>!w.cjk))) return null;
        const out = [];
        let x = 0;
        blocks.forEach((_, i)=>{
            const m = M(ctx, i, 'v');
            emitBlock(m, x + m.w / 2, m.h / 2 + i % 2 * 0.5, out);
            x += m.w + STACK_GAP;
        });
        return {
            items: out,
            vRot: 0
        };
    },
    orbit (ctx) {
        const { blocks, h } = ctx, n = blocks.length;
        if (n < 4 || n > 7) return null;
        const out = [], hm = M(ctx, h, 'h');
        emitBlock(hm, 0, 0, out);
        const rects = [
            {
                x0: -hm.w / 2,
                x1: hm.w / 2,
                y0: -hm.h / 2,
                y1: hm.h / 2
            }
        ];
        const sep = (a, b)=>Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1);
        let ang = -Math.PI * 0.75, vRot = 0;
        const base = Math.hypot(hm.w, hm.h) / 2 + STACK_GAP;
        for(let i = 0; i < n; i += 1){
            if (i === h) continue;
            let r = base, a = ang, rect = null, m = M(ctx, i, 'h');
            for(let tries = 0; tries < 600 && !rect; tries += 1){
                m = M(ctx, i, Math.abs(Math.cos(a)) > 0.75 ? 'v' : 'h');
                const cx = Math.cos(a) * r * 1.25, cy = Math.sin(a) * r * 0.8;
                const c = {
                    x0: cx - m.w / 2,
                    x1: cx + m.w / 2,
                    y0: cy - m.h / 2,
                    y1: cy + m.h / 2
                };
                if (rects.every((q)=>sep(q, c) >= FLOW_GAP)) rect = c;
                else {
                    a += 0.08;
                    if (tries % 80 === 79) r += 0.5;
                }
            }
            if (!rect) return null;
            rects.push(rect);
            vRot += hasTurned(m);
            emitBlock(m, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, out);
            ang = a + 0.5;
        }
        return {
            items: out,
            vRot
        };
    }
};
export const COMPOSITION_BIAS = {
    ribbon: 12,
    lines2: 10,
    lines3: 14,
    cross: 0,
    pillar: 1,
    header: 1,
    badge: 4,
    columns: 2,
    orbit: 4
};
export const SIMPLE_COMPOSITIONS = new Set([
    'ribbon',
    'lines2',
    'lines3'
]);
