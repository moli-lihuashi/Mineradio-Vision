/* 移植自 Folia「雾笺」 nebbiaLayout.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp } from './nebbiaConstants.mjs';
import { assignRoles, makeBlocks, mergeWords, ROLE_SCALE, ROLE_SCALE_FAST } from './nebbiaBlocks.mjs';
import { COMPOSITION_BIAS, COMPOSITIONS, SIMPLE_COMPOSITIONS } from './nebbiaCompositions.mjs';
import { createVisualizerRng, hashVisualizerSeed } from './visualizerSeedHash.mjs';
const LINGER_WEIGHT = 0.03;
const bboxOf = (items)=>{
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const it of items){
        x0 = Math.min(x0, it.x - it.s / 2);
        x1 = Math.max(x1, it.x + it.s / 2);
        y0 = Math.min(y0, it.y - it.s / 2);
        y1 = Math.max(y1, it.y + it.s / 2);
    }
    return {
        x0,
        x1,
        y0,
        y1,
        w: x1 - x0,
        h: y1 - y0
    };
};
const overlapArea = (a, b)=>Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
export const layoutNebbiaSong = (lines, opts)=>{
    const { W, H, jitter, layouts, fontScale, visibleUntil, fogAt, lingerUntil } = opts;
    const mx = W * 0.05, my = H * 0.07;
    const Smin = Math.max(26, H * 0.065) * fontScale, Smax = H * 0.14 * fontScale;
    const placed = [];
    const recent = [];
    let prev = null;
    let titleBox = null;
    const creditsCandidate = (ctx, kind)=>{
        const res = (kind === 'title' ? null : COMPOSITIONS.ribbon(ctx)) ?? pickWide(ctx);
        const bb = bboxOf(res.items);
        const cap = kind === 'title' ? Smax * 1.15 : Smax * 0.55;
        const S = Math.min(cap, (W - mx * 2) * 0.8 / bb.w, H * 0.32 / bb.h);
        const bw = bb.w * S, bh = bb.h * S;
        const cy = kind === 'title' || !titleBox ? H * 0.42 : titleBox.y1 + bh / 2 + S * 0.6;
        const box = {
            x0: W / 2 - bw / 2,
            x1: W / 2 + bw / 2,
            y0: cy - bh / 2,
            y1: cy + bh / 2
        };
        if (kind === 'title') titleBox = box;
        return {
            score: 0,
            name: 'ribbon',
            items: res.items,
            bb,
            S,
            cx: W / 2,
            cy,
            box
        };
    };
    const pickWide = (ctx)=>{
        const one = COMPOSITIONS.ribbon(ctx), bb = bboxOf(one.items);
        const fits = Math.min(Smax * 1.15, (W - mx * 2) * 0.8 / bb.w) >= Smin;
        return (fits ? null : COMPOSITIONS.lines2(ctx)) ?? one;
    };
    return lines.map((line, li)=>{
        const { chars } = line;
        const rnd = createVisualizerRng(hashVisualizerSeed(chars.map((c)=>c.ch).join('')) + li * 7919 >>> 0);
        const visible = chars.filter((c)=>c.ch.trim());
        const fast = visible.length > 0 && (line.end - line.t) / visible.length < 0.22;
        const words = mergeWords(chars, line.words);
        if (!words.length) return chars.map(()=>({
                x: W / 2,
                y: H / 2,
                s: Smin,
                rot: 0
            }));
        const roles = assignRoles(chars, words);
        const RS = fast ? ROLE_SCALE_FAST : ROLE_SCALE;
        const busy = placed.filter((p)=>p.linger > line.t - 0.3).map((p)=>({
                box: p.box,
                w: p.until <= line.t - 0.3 ? LINGER_WEIGHT : line.t <= p.fogAt ? 1 : 0.6 + 0.4 * clamp((p.until - line.t) / Math.max(1e-3, p.until - p.fogAt))
            }));
        let best = line.credits ? creditsCandidate({
            blocks: makeBlocks(chars, words, words.map(()=>'support'), ROLE_SCALE, 9),
            h: 0,
            chars
        }, line.credits) : null;
        if (!best) for (const maxBlocks of [
            5,
            7
        ]){
            const blocks = makeBlocks(chars, words, roles, RS, maxBlocks);
            const ctx = {
                blocks,
                h: Math.max(0, blocks.findIndex((b)=>b.role === 'hero')),
                chars
            };
            for (const name of Object.keys(COMPOSITIONS)){
                if (!layouts.includes(name)) continue;
                const res = COMPOSITIONS[name](ctx);
                if (!res || !res.items.length) continue;
                const bb = bboxOf(res.items);
                const maxH = H * (name === 'ribbon' ? 0.28 : 0.5), maxW = (W - mx * 2) * (SIMPLE_COMPOSITIONS.has(name) ? 0.94 : 0.68);
                const Sfit = Math.min(maxW / bb.w, maxH / bb.h, Smax);
                if (Sfit < Smin * 0.75) continue;
                for (const S of [
                    Sfit,
                    Sfit * 0.8,
                    Sfit * 0.64,
                    Sfit * 0.5
                ].filter((v, i)=>i === 0 || v >= Smin * 0.75)){
                    const bw = bb.w * S, bh = bb.h * S;
                    for (const fx of [
                        0.5,
                        0.3,
                        0.7
                    ])for (const fy of [
                        0.25,
                        0.42,
                        0.58,
                        0.75
                    ]){
                        const cx = clamp(fx * W, mx + bw / 2, W - mx - bw / 2), cy = clamp(fy * H, my + bh / 2, H - my - bh / 2);
                        const box = {
                            x0: cx - bw / 2,
                            x1: cx + bw / 2,
                            y0: cy - bh / 2,
                            y1: cy + bh / 2
                        };
                        const pad = S * 0.3, padBox = {
                            x0: box.x0 - pad,
                            x1: box.x1 + pad,
                            y0: box.y0 - pad,
                            y1: box.y1 + pad
                        };
                        let score = 0;
                        for (const b of busy)score += overlapArea(padBox, b.box) / (bw * bh) * 1000 * b.w;
                        score -= S / H * 100;
                        if (S < Smin) score += 40 + (Smin - S) / Smin * 200;
                        score += COMPOSITION_BIAS[name];
                        score += res.vRot * (fast ? 10 : 4);
                        if (fast && !SIMPLE_COMPOSITIONS.has(name)) score += 6;
                        if (maxBlocks === 7 && blocks.length <= 5) score += 100;
                        const rep = recent.lastIndexOf(name);
                        if (rep >= 0) score += [
                            18,
                            9,
                            4
                        ][recent.length - 1 - rep];
                        if (prev && Math.abs(prev.cx - cx) < W * 0.08 && Math.abs(prev.cy - cy) < H * 0.08) score += 8;
                        score += Math.abs(cy - H * 0.5) / H * 8;
                        score += rnd() * 8;
                        if (!best || score < best.score) best = {
                            score,
                            name,
                            items: res.items,
                            bb,
                            S,
                            cx,
                            cy,
                            box
                        };
                    }
                }
            }
        }
        if (!best) {
            const blocks = makeBlocks(chars, words, roles, ROLE_SCALE_FAST, 9);
            const ctx = {
                blocks,
                h: 0,
                chars
            };
            const res = COMPOSITIONS.lines3(ctx) ?? COMPOSITIONS.lines2(ctx) ?? COMPOSITIONS.ribbon(ctx);
            const bb = bboxOf(res.items);
            const S = Math.min(Smax, (W - mx * 2) / bb.w, (H - my * 2) / bb.h);
            best = {
                score: 0,
                name: 'lines3',
                items: res.items,
                bb,
                S,
                cx: W / 2,
                cy: H / 2,
                box: {
                    x0: W / 2 - bb.w * S / 2,
                    x1: W / 2 + bb.w * S / 2,
                    y0: H / 2 - bb.h * S / 2,
                    y1: H / 2 + bb.h * S / 2
                }
            };
        }
        const chosen = best;
        placed.push({
            box: chosen.box,
            until: visibleUntil(li),
            fogAt: fogAt(li),
            linger: Math.max(visibleUntil(li), lingerUntil?.(li) ?? 0)
        });
        recent.push(chosen.name);
        if (recent.length > 3) recent.shift();
        prev = chosen;
        const { bb, S, cx, cy } = chosen;
        const tilt = (rnd() - 0.5) * 0.04 * jitter;
        const byK = new Map(chosen.items.map((it)=>[
                it.k,
                it
            ]));
        let lastPos = {
            x: cx,
            y: cy,
            s: S,
            rot: 0
        };
        return chars.map((_, k)=>{
            const it = byK.get(k);
            if (!it) return {
                ...lastPos,
                rot: 0
            };
            const x = cx + (it.x - (bb.x0 + bb.x1) / 2) * S, y0 = cy + (it.y - (bb.y0 + bb.y1) / 2) * S;
            const s = it.s * S * (1 + (rnd() - 0.5) * 0.08 * jitter);
            lastPos = {
                x: x + (rnd() - 0.5) * S * 0.04 * jitter,
                y: y0 + (x - cx) * tilt + (rnd() - 0.5) * S * 0.05 * jitter,
                s,
                rot: it.rot + (rnd() - 0.5) * 0.08 * jitter + tilt
            };
            return lastPos;
        });
    });
};
