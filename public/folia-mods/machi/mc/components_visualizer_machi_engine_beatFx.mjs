/* 移植自 Folia components/visualizer/machi/engine/beatFx.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { DRUM_KICK, DRUM_SNARE } from './_stubs.mjs';
import { resolveBeatFxAccentGain } from './_stubs.mjs';
export const MACHI_NEON_GROUPS = 3;
export const MACHI_BEAT = {
    neon: {
        attack: 0.4,
        fall: 1.5,
        lift: 0.2,
        contrast: 0.2,
        downbeat: 1.2
    },
    lightbox: 0.3,
    warm: {
        attack: 0.6,
        fall: 2.2,
        lift: 0.08
    },
    bloom: 0.1,
    ripple: {
        speed: 6.5,
        life: 1.3,
        max: 4,
        floor: 0.3,
        gap: 0.33,
        thump: 0.55,
        thumpDecay: 0.14,
        wet: [
            0.1,
            0.6
        ]
    },
    screen: {
        attack: 0.25,
        fall: 1.15,
        max: 4,
        floor: 0.4,
        gap: 0.35
    }
};
export const createMachiBeatFrame = ()=>({
        neonGroups: new Float32Array(MACHI_NEON_GROUPS).fill(1),
        neon: 1,
        warm: 1,
        bloom: 1,
        thump: 0,
        swellAt: new Float32Array(MACHI_BEAT.screen.max).fill(0.5),
        swellAmp: new Float32Array(MACHI_BEAT.screen.max)
    });
export const resetMachiBeatFrame = (out)=>{
    out.neonGroups.fill(1);
    out.neon = 1;
    out.warm = 1;
    out.bloom = 1;
    out.thump = 0;
    out.swellAt.fill(0.5);
    out.swellAmp.fill(0);
    return out;
};
export const machiNeonGroup = (beat, group)=>beat.neonGroups[group % MACHI_NEON_GROUPS];
export const machiLightboxGroup = (beat, group)=>1 + MACHI_BEAT.lightbox * (machiNeonGroup(beat, group) - 1);
export const machiSwell = (age, attack, fall)=>{
    if (age < 0 || age >= attack + fall) return 0;
    if (age < attack) {
        const u = age / attack;
        return u * u * (3 - 2 * u);
    }
    const u = (age - attack) / fall;
    return 1 - u * u * (3 - 2 * u);
};
export const machiRippleWetness = (wetness)=>{
    const [from, to] = MACHI_BEAT.ripple.wet;
    const t = Math.min(1, Math.max(0, (wetness - from) / (to - from)));
    return t * t * (3 - 2 * t);
};
const lastAtOrBefore = (count, at, time)=>{
    let low = 0;
    let high = count;
    while(low < high){
        const middle = low + high >> 1;
        if (at(middle) <= time) low = middle + 1;
        else high = middle;
    }
    return low - 1;
};
const groupSwells = new Float32Array(MACHI_NEON_GROUPS);
export const resolveMachiNeonPulse = (events, time, strength, trackScale, out)=>{
    out.neonGroups.fill(1);
    out.neon = 1;
    out.warm = 1;
    out.bloom = 1;
    if (!events.length || strength <= 0) return out;
    const { neon, warm } = MACHI_BEAT;
    const life = Math.max(neon.attack + neon.fall, warm.attack + warm.fall);
    groupSwells.fill(0);
    let bar = 0;
    for(let index = lastAtOrBefore(events.length, (at)=>events[at].t, time); index >= 0; index -= 1){
        const event = events[index];
        const age = time - event.t;
        if (age >= life) break;
        const gain = resolveBeatFxAccentGain(event, trackScale);
        if (gain <= 0) continue;
        const tone = event.tone;
        const downbeat = event.kind === 'downbeat';
        const neonTone = tone ? Math.max(0, 0.4 + 0.9 * (tone.mid + tone.high)) : 1;
        const group = index % MACHI_NEON_GROUPS;
        const swell = gain * neonTone * (downbeat ? neon.downbeat : 1) * machiSwell(age, neon.attack, neon.fall);
        groupSwells[group] = Math.max(groupSwells[group], swell);
        if (downbeat) {
            const warmTone = tone ? Math.max(0, 0.4 + 1.8 * tone.low) : 1;
            bar = Math.max(bar, gain * warmTone * machiSwell(age, warm.attack, warm.fall));
        }
    }
    let mean = 0;
    for(let group = 0; group < MACHI_NEON_GROUPS; group += 1)mean += groupSwells[group];
    mean /= MACHI_NEON_GROUPS;
    for(let group = 0; group < MACHI_NEON_GROUPS; group += 1){
        const swell = groupSwells[group];
        out.neonGroups[group] = Math.max(0, 1 + strength * (neon.lift * swell + neon.contrast * (swell - mean)));
    }
    out.neon = 1 + strength * neon.lift * mean;
    out.warm = 1 + strength * warm.lift * bar;
    out.bloom = 1 + strength * MACHI_BEAT.bloom * mean;
    return out;
};
export const machiDrumHitsAt = (hits, time)=>hits && (hits.until === undefined || time < hits.until) ? hits : null;
const pickedCache = new WeakMap();
const pickedDrumHits = (hits, kind, floor, gap)=>{
    let byRule = pickedCache.get(hits);
    if (!byRule) {
        byRule = new Map();
        pickedCache.set(hits, byRule);
    }
    const rule = `${kind}:${floor}:${gap}`;
    let picked = byRule.get(rule);
    if (!picked) {
        picked = new Uint8Array(hits.times.length);
        let previous = Number.NEGATIVE_INFINITY;
        for(let index = 0; index < hits.times.length; index += 1){
            const hitAt = hits.times[index];
            if (hits.kinds[index] !== kind || hits.strengths[index] < floor || hitAt - previous < gap) continue;
            previous = hitAt;
            picked[index] = 1;
        }
        byRule.set(rule, picked);
    }
    return picked;
};
const pickDrumHits = (hits, time, kind, floor, gap, life, kept)=>{
    const picked = pickedDrumHits(hits, kind, floor, gap);
    const at = (index)=>hits.times[index];
    const last = lastAtOrBefore(hits.times.length, at, time);
    let count = 0;
    for(let index = lastAtOrBefore(hits.times.length, at, time - life) + 1; index <= last; index += 1){
        if (!picked[index]) continue;
        kept[count % kept.length] = index;
        count += 1;
    }
    return count;
};
const keptKicks = new Int32Array(MACHI_BEAT.ripple.max);
const keptSnares = new Int32Array(MACHI_BEAT.screen.max);
export const resolveMachiDrumRipples = (hits, time, strength, rings)=>{
    const { life, max, floor, gap, thump, thumpDecay } = MACHI_BEAT.ripple;
    for(let slot = 0; slot < max; slot += 1){
        rings[slot * 2] = -1;
        rings[slot * 2 + 1] = 0;
    }
    if (!hits || strength <= 0) return 0;
    const count = pickDrumHits(hits, time, DRUM_KICK, floor, gap, life, keptKicks);
    let pulse = 0;
    for(let slot = 0; slot < Math.min(count, max); slot += 1){
        const hit = keptKicks[(count - 1 - slot) % max];
        const age = time - hits.times[hit];
        const amp = strength * hits.strengths[hit];
        rings[slot * 2] = age;
        rings[slot * 2 + 1] = amp;
        pulse = Math.max(pulse, thump * amp * Math.exp(-age / thumpDecay));
    }
    return pulse;
};
export const resolveMachiScreenFlash = (hits, time, strength, out)=>{
    out.swellAt.fill(0.5);
    out.swellAmp.fill(0);
    if (!hits || strength <= 0) return out;
    const { attack, fall, max, floor, gap } = MACHI_BEAT.screen;
    const count = pickDrumHits(hits, time, DRUM_SNARE, floor, gap, attack + fall, keptSnares);
    for(let slot = 0; slot < Math.min(count, max); slot += 1){
        const hit = keptSnares[(count - 1 - slot) % max];
        out.swellAt[slot] = 0.15 + 0.7 * (hit * 0.618034 % 1);
        out.swellAmp[slot] = strength * hits.strengths[hit] * machiSwell(time - hits.times[hit], attack, fall);
    }
    return out;
};
