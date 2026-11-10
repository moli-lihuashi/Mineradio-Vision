/* 移植自 Folia components/visualizer/hanabi/mg/ornamentKit.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
import { clamp01 } from './components_visualizer_hanabi_mg_mgMath.mjs';
export const createKit = (spec, ctx)=>{
    const { pixi } = ctx;
    const view = new pixi.Container({
        isRenderGroup: true
    });
    const rng = createRng(`${ctx.seed}:ornament:${spec.kind}:${spec.placement}`);
    const start = ctx.enterAt + spec.delay;
    const end = ctx.exitAt + Math.max(0, ctx.exitDuration);
    const b = ctx.bounds;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const hw = Math.max(1, b.width / 2);
    const hh = Math.max(1, b.height / 2);
    const initial = ctx.anchorsAt(ctx.enterAt);
    const landed = initial.reduce((max, anchor)=>Math.max(max, anchor.landedAt), ctx.enterAt);
    const settle = Math.min(ctx.exitAt - 1e-3, landed + 0.05);
    const settled = settle > ctx.enterAt ? ctx.anchorsAt(settle) : initial;
    const glyphs = [];
    settled.forEach((anchor, index)=>{
        if (anchor.blank) return;
        glyphs.push({
            index,
            char: anchor.char,
            x: anchor.x,
            y: anchor.y,
            size: anchor.size,
            sungAt: anchor.sungAt,
            sungEnd: anchor.sungEnd,
            landedAt: anchor.landedAt
        });
    });
    const sizes = glyphs.map((g)=>g.size).sort((p, q)=>p - q);
    const base = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : Math.max(12, Math.min(hw, hh) * 0.8, Math.min(ctx.width, ctx.height) * 0.06);
    const size = base * Math.max(0.1, spec.scale);
    let vertical = false;
    if (glyphs.length > 1) {
        const xs = glyphs.map((g)=>g.x);
        const ys = glyphs.map((g)=>g.y);
        vertical = Math.max(...ys) - Math.min(...ys) > (Math.max(...xs) - Math.min(...xs)) * 1.3;
    }
    const sung = glyphs.map((g)=>g.sungAt).sort((p, q)=>p - q);
    const factor = Math.max(0, ctx.amount) * (0.35 + 0.9 * clamp01(spec.density));
    const count = (baseCount, min = 1)=>factor <= 0 ? 0 : Math.max(min, Math.round(baseCount * factor));
    const pick = (list, i, fallback)=>list.length > 0 ? list[(i % list.length + list.length) % list.length] : fallback;
    const color = (i)=>{
        const p = ctx.palette;
        switch(spec.color){
            case 'spark':
                return pick(p.sparks, i, p.accent);
            case 'block':
                return pick(p.blocks, i, p.accent);
            case 'paper':
                return p.paper;
            case 'glow':
                return p.glow;
            default:
                return p.accent;
        }
    };
    const pad = base * 0.35;
    const sites = (mode, maxGlyphSites)=>{
        const make = (x, y, w, h, angle, extra = {})=>({
                x,
                y,
                w,
                h,
                angle,
                glyph: -1,
                start,
                hollow: false,
                ...extra
            });
        switch(spec.placement){
            case 'behind':
                return [
                    make(cx, cy, hw, hh, -Math.PI / 2)
                ];
            case 'around':
                return [
                    make(cx, cy, hw + pad, hh + pad, -Math.PI / 2, {
                        hollow: mode === 'scatter'
                    })
                ];
            case 'corners':
                return [
                    [
                        -1,
                        -1
                    ],
                    [
                        1,
                        -1
                    ],
                    [
                        1,
                        1
                    ],
                    [
                        -1,
                        1
                    ]
                ].map(([sx, sy], k)=>make(cx + sx * (hw + pad * 0.6), cy + sy * (hh + pad * 0.6), base * 0.6, base * 0.6, Math.atan2(sy, sx), {
                        start: start + k * 0.07
                    }));
            case 'line-start':
                return [
                    vertical ? make(cx, cy - hh - pad, base * 0.7, base * 0.7, -Math.PI / 2) : make(cx - hw - pad, cy, base * 0.7, base * 0.7, Math.PI)
                ];
            case 'line-end':
                return [
                    vertical ? make(cx, cy + hh + pad, base * 0.7, base * 0.7, Math.PI / 2) : make(cx + hw + pad, cy, base * 0.7, base * 0.7, 0)
                ];
            case 'screen':
                return [
                    make(0, 0, ctx.width * 0.55, ctx.height * 0.55, -Math.PI / 2)
                ];
            case 'glyphs':
            default:
                {
                    if (glyphs.length === 0) return [
                        make(cx, cy, hw, hh, -Math.PI / 2)
                    ];
                    const limit = Math.max(1, Math.min(glyphs.length, maxGlyphSites));
                    const chosen = [];
                    for(let i = 0; i < limit; i += 1)chosen.push(glyphs[Math.floor((i + 0.5) * glyphs.length / limit)]);
                    return chosen.map((g)=>make(g.x, g.y, g.size * 0.55, g.size * 0.55, -Math.PI / 2, {
                            glyph: g.index,
                            start: Math.max(start, g.sungAt)
                        }));
                }
        }
    };
    let cachedTime = Number.NaN;
    let cached = settled;
    const anchors = (time)=>{
        if (time !== cachedTime) {
            cachedTime = time;
            cached = ctx.anchorsAt(time);
        }
        return cached;
    };
    const pos = (site, list, out)=>{
        const anchor = site.glyph >= 0 ? list[site.glyph] : undefined;
        if (anchor) {
            out.x = anchor.x;
            out.y = anchor.y;
            out.alpha = anchor.alpha;
            out.size = anchor.size;
        } else {
            out.x = site.x;
            out.y = site.y;
            out.alpha = 1;
            out.size = Math.max(site.w, site.h);
        }
        return out;
    };
    const exitSpan = Math.max(0.05, ctx.exitDuration);
    const exit = (time, stagger = 0)=>clamp01((time - ctx.exitAt - stagger) / Math.max(0.05, exitSpan - stagger));
    const scatter = (site)=>{
        if (!site.hollow) return [
            (rng() * 2 - 1) * site.w,
            (rng() * 2 - 1) * site.h
        ];
        const ow = site.w + base * 1.3;
        const oh = site.h + base * 1.0;
        for(let tries = 0; tries < 12; tries += 1){
            const x = (rng() * 2 - 1) * ow;
            const y = (rng() * 2 - 1) * oh;
            if (Math.abs(x) > site.w || Math.abs(y) > site.h) return [
                x,
                y
            ];
        }
        const a = rng() * Math.PI * 2;
        return [
            Math.cos(a) * ow,
            Math.sin(a) * oh
        ];
    };
    const lastSung = (time)=>{
        let result = Number.NEGATIVE_INFINITY;
        for (const at of sung){
            if (at > time) break;
            result = at;
        }
        return result;
    };
    const sprite = (texture, parent = view)=>{
        const s = new pixi.Sprite(ctx.textures[texture]);
        s.anchor.set(0.5);
        parent.addChild(s);
        return s;
    };
    const graphics = (parent = view, context)=>{
        const g = context ? new pixi.Graphics(context) : new pixi.Graphics();
        parent.addChild(g);
        return g;
    };
    const contexts = [];
    const context = ()=>{
        const c = new pixi.GraphicsContext();
        contexts.push(c);
        return c;
    };
    view.on('destroyed', ()=>contexts.forEach((c)=>c.destroy()));
    return {
        spec,
        ctx,
        pixi,
        view,
        rng,
        start,
        end,
        size,
        glyphs,
        vertical,
        cx,
        cy,
        hw,
        hh,
        count,
        color,
        sites,
        anchors,
        pos,
        exit,
        scatter,
        lastSung,
        sprite,
        graphics,
        context
    };
};
