/* 移植自 Folia components/visualizer/hanabi/hanabiBeatFx.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { resolveBeatFxAccentGain } from './_stubs.mjs';
import { burstPreset } from './components_visualizer_hanabi_catalog.mjs';
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
export const HANABI_BEAT_SHELL_LIFE = 1.8;
const BEAT_KINDS = [
    'botan',
    'senrin',
    'strobe',
    'star',
    'heart',
    'ring'
];
const DOWNBEAT_KINDS = [
    'kiku',
    'ring',
    'willow-ring',
    'crossette',
    'palm'
];
export const resolveHanabiBeatShell = (event, seed, strength, trackScale)=>{
    const gain = resolveBeatFxAccentGain(event, trackScale);
    if (gain <= 0 || strength <= 0) return null;
    const key = `${seed}:beat:${Math.round(event.t * 1000)}`;
    const random = createRng(key);
    const downbeat = event.kind === 'downbeat';
    const kinds = downbeat ? DOWNBEAT_KINDS : BEAT_KINDS;
    const kind = kinds[Math.floor(random() * kinds.length)];
    const colors = [
        0,
        1,
        2
    ].map((k)=>(k + Math.floor(random() * 5)) % 5);
    const size = (0.55 + 0.45 * gain) * (0.7 + 0.3 * strength);
    const spec = downbeat ? {
        ...burstPreset(kind, colors),
        count: Math.round(80 * (0.5 + 0.5 * strength)),
        radius: 0.2 * size,
        duration: 1.7
    } : {
        ...burstPreset(kind, colors),
        count: Math.round(28 * (0.5 + 0.5 * strength)),
        radius: 0.09 * size,
        duration: 1.1,
        trail: 0.25
    };
    return {
        t: event.t,
        downbeat,
        sx: downbeat ? 0.2 + random() * 0.6 : 0.06 + random() * 0.88,
        sy: downbeat ? 0.12 + random() * 0.2 : 0.07 + random() * 0.36,
        spec,
        launch: downbeat,
        seed: key
    };
};
export const firstBeatAtOrAfter = (events, time)=>{
    let low = 0;
    let high = events.length;
    while(low < high){
        const middle = low + high >> 1;
        if (events[middle].t < time) low = middle + 1;
        else high = middle;
    }
    return low;
};
export const HANABI_BEAT_PULSE = {
    zoom: 0.035,
    downbeatZoom: 0.045,
    kickDeg: 1.6
};
export const resolveHanabiBeatPulse = (k, d, rotationSign)=>({
        scale: 1 + HANABI_BEAT_PULSE.zoom * Math.max(0, k) + HANABI_BEAT_PULSE.downbeatZoom * Math.max(0, d),
        rotation: HANABI_BEAT_PULSE.kickDeg * Math.PI / 180 * Math.max(0, k) * rotationSign
    });
export const rescaleBeatEnvelope = (envelope, clockStrength, ownStrength)=>clockStrength > 1e-3 ? envelope / clockStrength * ownStrength : 0;
