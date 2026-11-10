/* 移植自 Folia「雾笺」 nebbiaHits.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp, MASK_SCALE, smooth } from './nebbiaConstants.mjs';
import { lineRect } from './nebbiaScene.mjs';
import { createVisualizerRng, mixVisualizerSeed } from './visualizerSeedHash.mjs';
import { VOCAL_FPS } from './_stubs.mjs';
const BUCKET = 1 / VOCAL_FPS;
const lowerBound = (sorted, v)=>{
    let lo = 0, hi = sorted.length;
    while(lo < hi){
        const m = lo + hi >> 1;
        if (sorted[m] < v) lo = m + 1;
        else hi = m;
    }
    return lo;
};
const energies = new WeakMap();
export const vocalEnvelopeEnergy = (env)=>{
    const known = energies.get(env);
    if (known) return known;
    const { db, top, fps } = env;
    const n = db.length, reach = Math.round(1.5 * fps), floor = top - 28;
    const e = new Float32Array(n);
    const win = [];
    for(let j = 0; j < Math.min(n, reach); j += 1)if (db[j] > floor) win.splice(lowerBound(win, db[j]), 0, db[j]);
    for(let i = 0; i < n; i += 1){
        if (i > 0) {
            const enter = i + reach - 1, leave = i - reach - 1;
            if (enter < n && db[enter] > floor) win.splice(lowerBound(win, db[enter]), 0, db[enter]);
            if (leave >= 0 && db[leave] > floor) win.splice(lowerBound(win, db[leave]), 1);
        }
        if (db[i] <= floor) continue;
        const a = win[Math.floor(win.length * 0.1)], b = Math.max(a + 3, win[Math.floor(win.length * 0.95)]);
        e[i] = clamp((db[i] - a) / (b - a)) ** 1.2;
    }
    energies.set(env, e);
    return e;
};
export const songLoudness = (top)=>clamp(2 ** ((top + 17.4) / 8), 0.5, 3);
const activeLine = (laid, t)=>laid.find((line)=>t >= line.t - 0.3 && t <= line.end + 1) ?? null;
export class VocalEnergy {
    floor = 0;
    peak = 1;
    value = 0;
    update(raw, dt) {
        const k = 1 - Math.exp(-dt / 3);
        this.peak = Math.max(raw, this.peak + (raw - this.peak) * k * 0.5);
        this.floor = Math.min(raw, this.floor + (raw - this.floor) * k * 0.3);
        this.value = clamp((raw - this.floor) / Math.max(this.peak - this.floor, 8)) ** 1.2;
        return this.value;
    }
}
export class NebbiaHits {
    seed;
    big = [];
    small = [];
    lastBucket = -1;
    vocal = null;
    vocalFrom = 0;
    loud = 1;
    constructor(seed){
        this.seed = seed;
    }
    buildBig(laid, words, W, H, env = null) {
        this.big = [];
        this.small = [];
        this.lastBucket = -1;
        this.vocal = env && env.fps === VOCAL_FPS ? vocalEnvelopeEnergy(env) : null;
        this.vocalFrom = this.vocal ? env?.from ?? 0 : 0;
        this.loud = env && this.vocal ? songLoudness(env.top) : 1;
        const rnd = createVisualizerRng(mixVisualizerSeed(this.seed, 911));
        const k = Math.min(W, H) / 720;
        const add = (t, line)=>{
            const rect = line ? lineRect(line) : null;
            let x = 0, y = 0;
            for(let tries = 0; tries < 8; tries += 1){
                x = W * (0.03 + 0.94 * rnd());
                y = H * (0.03 + 0.94 * rnd());
                if (!rect || x < rect.x0 - 20 || x > rect.x1 + 20 || y < rect.y0 - 20 || y > rect.y1 + 20) break;
            }
            const R = (7 + rnd() * 6) * k;
            const sat = Array.from({
                length: 4 + Math.floor(rnd() * 5)
            }, ()=>{
                const a = rnd() * 6.28, d = R * (1.5 + rnd() * 1.4);
                return [
                    Math.cos(a) * d,
                    Math.sin(a) * d * 0.85 + R * 0.2,
                    (1 + rnd() * 1.6) * k
                ];
            });
            this.big.push({
                t,
                x,
                y,
                R,
                big: true,
                sat,
                seed: rnd() * 100
            });
        };
        const vocalStart = env && this.vocal ? this.vocalFrom / env.fps : Infinity;
        laid.forEach((line, li)=>{
            for (const w of words[li] ?? []){
                const t = line.chars[w[0]].t;
                if (t < vocalStart && rnd() < 0.6) add(t, line);
            }
        });
        if (env && this.vocal) {
            const e = this.vocal;
            for (const o of env.onsets)if (e[o] > 0.15 || rnd() < 0.3) add(o / env.fps, activeLine(laid, o / env.fps));
        }
        this.big.sort((a, b)=>a.t - b.t);
    }
    advance(T, energy, density, life, W, H) {
        const bucket = Math.floor(T / BUCKET);
        if (bucket < this.lastBucket || bucket - this.lastBucket > life / BUCKET) {
            this.small = [];
            this.lastBucket = bucket - Math.ceil(life / BUCKET);
        }
        if (density > 0) {
            const k = Math.min(W, H) / 720, vocal = this.vocal;
            const rateOf = (e)=>(0.15 + 7 * e * e) * density * BUCKET;
            const live = rateOf(energy);
            for(let b = this.lastBucket + 1; b <= bucket; b += 1){
                const rnd = createVisualizerRng(mixVisualizerSeed(this.seed + b, 0x5ad1));
                if (rnd() >= (vocal && (b < 0 || b >= this.vocalFrom) ? rateOf(b >= 0 && b < vocal.length ? vocal[b] : 0) * this.loud : live)) continue;
                this.small.push({
                    t: (b + rnd()) * BUCKET,
                    x: W * (0.03 + 0.94 * rnd()),
                    y: H * (0.03 + 0.94 * rnd()),
                    R: (2 + rnd() * 3.5) * k,
                    big: false,
                    sat: null,
                    seed: rnd() * 100
                });
            }
        }
        this.lastBucket = bucket;
        while(this.small.length && this.small[0].t < T - life)this.small.shift();
    }
    draw(ctx, motion, T, refog, beadHold, size) {
        const fogT = refog * 0.3, life = 0.4 + fogT + beadHold * 0.5 + refog;
        let lo = 0, hi = this.big.length;
        while(lo < hi){
            const m = lo + hi >> 1;
            if (this.big[m].t < T - life) lo = m + 1;
            else hi = m;
        }
        ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
        const one = (h, s)=>{
            const R = h.R * s;
            const age = T - h.t;
            const v = 1 - smooth(clamp((age - 0.4) / fogT));
            const bv = 1 - smooth(clamp((age - 0.4 - beadHold * 0.5) / refog));
            if (h.big && v > 0.002) {
                for(let j = 0; j < 7; j += 1){
                    const a = h.seed + j * 0.9, d = R * 0.3;
                    const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a * 1.3) * d;
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + 0.1, y);
                }
                ctx.stroke(R * 1.3, v);
            }
            if (bv > 0.01) {
                const sq = Math.exp(-age / 0.05);
                motion.put(h.x, h.y + R * 0.1, R * 0.9 * (0.6 + 0.4 * bv), bv, 1 + 0.5 * sq, 1 - 0.35 * sq);
                if (h.sat) for (const [dx0, dy0, r] of h.sat){
                    const out = clamp(age / 0.08), dx = dx0 * s, dy = dy0 * s;
                    motion.put(h.x + dx * out, h.y + dy * out, r * (0.55 + 0.45 * bv), bv * out);
                }
            }
        };
        if (size > 0) {
            for(let i = lo; i < this.big.length && this.big[i].t <= T; i += 1)if (this.big[i].R * size >= 1) one(this.big[i], size);
        }
        for (const h of this.small)if (h.t <= T) one(h, 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    scheduled() {
        return {
            big: this.big,
            small: this.small
        };
    }
    static lifeOf(refog, beadHold) {
        return 0.4 + refog * 0.3 + beadHold * 0.5 + refog;
    }
}
