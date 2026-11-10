/* 移植自 Folia「雾笺」 nebbiaScene.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp, NEBBIA_FIXED, smooth } from './nebbiaConstants.mjs';
import { isIconChar } from './nebbiaChars.mjs';
import { isWideChar } from './nebbiaBlocks.mjs';
import { pointAt, warpGlyph } from './nebbiaGlyphs.mjs';
import { layoutNebbiaSong } from './nebbiaLayout.mjs';
import { createVisualizerRng, hashVisualizerSeed } from './visualizerSeedHash.mjs';
const lineModeOf = (fade, idx, seed)=>fade.length === 1 ? fade[0] : createVisualizerRng(seed + idx * 977 + 3 >>> 0)() < 0.5 ? 'fog' : 'fingers';
export const fogStartOf = (end, next, hold)=>Math.min(next, end + 6) + hold;
const LINGER_MAX = 16;
const LINGER_LINES = 3;
const decorate = (c, base, rnd, warp)=>{
    const g = warpGlyph(base, createVisualizerRng(Math.floor(rnd() * 1e9)), warp);
    c.glyph = g;
    c.beads = g.strokes.map((st)=>{
        const out = [], step = 7 / c.s;
        for(let s = step * rnd(); s < st.len; s += step * (0.5 + rnd())){
            if (rnd() > NEBBIA_FIXED.beads) continue;
            const [x, y, nx, ny] = pointAt(st, s), side = rnd() < 0.5 ? -1 : 1;
            out.push({
                s,
                x,
                y,
                nx: nx * side,
                ny: ny * side,
                r: 1.6 + rnd() ** 2.2 * 3.6,
                j: rnd()
            });
        }
        return out;
    });
    c.drips = g.strokes.map(()=>rnd() < NEBBIA_FIXED.drip * 0.22 ? {
            delay: 0.3 + rnd() * 1.6,
            len: 30 + rnd() * 130,
            dur: 2 + rnd() * 3.5,
            r: 3.2 + rnd() * 2.6,
            seed: rnd() * 100
        } : null);
    c.ends = g.strokes.map(()=>({
            h: rnd(),
            j: rnd()
        }));
};
export const naturalWriteTime = (g, speed)=>(g.total * 0.28 + (g.strokes.length - 1) * 0.06) / speed;
const scheduleWrite = (cs, nat, k)=>{
    let end = -Infinity;
    const starts = cs.map((c, i)=>{
        const t0 = Math.max(c.t, end);
        end = t0 + nat[i] * k;
        return t0;
    });
    return {
        starts,
        end
    };
};
const applyAppear = (line, tuning, idx, seed)=>{
    const kinds = tuning.appear.filter((a)=>a !== 'fade');
    const canFade = tuning.appear.includes('fade');
    const kind = kinds.length ? kinds[Math.floor(createVisualizerRng(seed + idx * 613 + 11 >>> 0)() * kinds.length)] : null;
    const cs = line.chars.filter((c)=>c.glyph);
    const nat = cs.map((c)=>naturalWriteTime(c.glyph, tuning.writeSpeed));
    const until = Math.max(line.next, line.end);
    let k = 1;
    if (scheduleWrite(cs, nat, 1).end > until) {
        let lo = 0.3, hi = 1;
        for(let n = 0; n < 14; n += 1){
            const m = (lo + hi) / 2;
            if (scheduleWrite(cs, nat, m).end > until) hi = m;
            else lo = m;
        }
        k = lo;
    }
    const plan = scheduleWrite(cs, nat, k);
    const fade = !kind || canFade && cs.length > 0 && plan.end > until + 1e-3;
    cs.forEach((c, i)=>{
        c.wt = plan.starts[i];
        c.wd = nat[i] * k;
    });
    if (kind === 'breath' && !fade && cs.length) {
        line.appearBreathAt = cs[0].wt - NEBBIA_FIXED.breathSpread - 0.3;
        line.appearBreathUntil = line.end + NEBBIA_FIXED.breathHold;
    }
    for (const c of line.chars)c.appearDur = fade ? clamp(c.d * 3, 0.35, 1.2) : 0;
};
const alignCredits = (laid, source)=>{
    const ti = source.findIndex((l)=>l.credits === 'title'), ai = source.findIndex((l)=>l.credits === 'artist');
    if (ti < 0 || ai < 0) return;
    const written = laid[ti].chars.filter((c)=>c.glyph);
    const last = written[written.length - 1];
    if (!last) return;
    const first = laid[ai].chars.find((c)=>c.glyph);
    const shift = first ? Math.max(0, last.wt + last.wd + 0.4 - first.wt) : 0;
    for (const c of laid[ai].chars)c.wt += shift;
};
export const lineRect = (line)=>{
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, S = 0;
    for (const c of line.chars)if (c.glyph) {
        x0 = Math.min(x0, c.x - c.s / 2);
        x1 = Math.max(x1, c.x + c.s / 2);
        y0 = Math.min(y0, c.y - c.s / 2);
        y1 = Math.max(y1, c.y + c.s / 2);
        S = Math.max(S, c.s);
    }
    return {
        x0,
        x1,
        y0,
        y1,
        S
    };
};
export const buildNebbiaScene = (source, glyphs, tuning, size, seed)=>{
    const seedHash = hashVisualizerSeed(String(seed));
    const modes = source.map((l, i)=>l.credits ? 'fog' : lineModeOf(tuning.fade, i, seedHash));
    const fadeOf = (i)=>tuning.refog + (modes[i] === 'fog' ? 0 : 2.5);
    const creditsAt = source.find((l)=>l.credits)?.t ?? Infinity;
    const beforeCredits = (i)=>Math.max(source[i].end + 0.5, creditsAt - fadeOf(i) * 0.6);
    const fogAt = (i)=>source[i].credits ? Infinity : Math.min(fogStartOf(source[i].end, source[i].next, tuning.hold), beforeCredits(i));
    const lingerAt = (i)=>Math.max(fogAt(i), Math.min(fogAt(i) + LINGER_MAX, (source[i + LINGER_LINES]?.t ?? Infinity) + tuning.hold, beforeCredits(i)));
    const goneAt = (i)=>fogAt(i) + fadeOf(i);
    const pos = layoutNebbiaSong(source, {
        W: size.W,
        H: size.H,
        jitter: tuning.jitter,
        layouts: tuning.layouts,
        fontScale: size.fontScale,
        visibleUntil: goneAt,
        fogAt,
        lingerUntil: (i)=>lingerAt(i) + fadeOf(i)
    });
    const laid = source.map((line, li)=>({
            t: line.t,
            end: line.end,
            next: line.next,
            mode: modes[li],
            fogAt: fogAt(li),
            yieldAt: Infinity,
            breathAt: Infinity,
            breathUntil: Infinity,
            breathDur: NEBBIA_FIXED.breathSpread,
            appearBreathAt: Infinity,
            appearBreathUntil: Infinity,
            chars: line.chars.map((c, i)=>{
                const p = pos[li][i], wide = isWideChar(c.ch) || isIconChar(c.ch);
                const out = {
                    ...c,
                    x: p.x,
                    y: p.y,
                    s: p.s * (wide ? 1 : 1.15),
                    rot: p.rot,
                    glyph: null,
                    beads: [],
                    drips: [],
                    ends: [],
                    appearDur: 0,
                    wt: c.t,
                    wd: 0
                };
                const base = glyphs.get(c.ch);
                if (base) decorate(out, base, createVisualizerRng(li * 131 + i * 17 + 5 >>> 0), tuning.warp);
                return out;
            })
        }));
    laid.forEach((line, li)=>applyAppear(line, tuning, li, seedHash));
    alignCredits(laid, source);
    const rects = laid.map(lineRect);
    const { breathSpread, breathHold } = NEBBIA_FIXED;
    laid.forEach((line, i)=>{
        if (source[i].credits) return;
        const gone = lingerAt(i) + fadeOf(i);
        let by = -1;
        for(let j = i + 1; j < laid.length && laid[j].t < gone; j += 1){
            const a = rects[i], b = rects[j];
            if (Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0)) {
                line.yieldAt = yieldMoment(laid[j].t, line);
                by = j;
                break;
            }
        }
        line.fogAt = Math.max(fogAt(i), Math.min(lingerAt(i), line.yieldAt - fadeOf(i)));
        if (by >= 0 && !source[by].credits && line.yieldAt < line.fogAt + fadeOf(i)) {
            const from = Math.max(line.yieldAt - breathSpread - 0.3, writtenAt(line) + YIELD_READ);
            line.breathAt = from;
            line.breathDur = Math.max(0.3, line.yieldAt - 0.3 - from);
            line.breathUntil = laid[by].end + breathHold;
        }
    });
    return laid;
};
const YIELD_LEAD = 0.6, YIELD_READ = 0.3;
export const yieldMoment = (nextT, line)=>Math.max(nextT, writtenAt(line) + YIELD_READ + YIELD_LEAD);
const writtenAt = (line)=>{
    let done = line.t;
    for (const c of line.chars)if (c.glyph) done = Math.max(done, c.wd > 0 ? c.wt + c.wd : c.t + Math.min(c.appearDur, 0.5));
    return done;
};
export const yieldFactor = (line, T)=>line.breathAt < Infinity ? 1 - smooth(clamp(((T - line.breathAt) / line.breathDur - 0.15) / 0.7)) : 1 - smooth(clamp((T - line.yieldAt + YIELD_LEAD) / 1));
export const BREATH_GHOST = 0.08;
export const yieldMask = (line, T)=>{
    const yf = yieldFactor(line, T);
    return line.breathAt < Infinity ? Math.max(yf, BREATH_GHOST) : yf;
};
