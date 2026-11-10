/* 移植自 Folia「雾笺」 nebbiaConstants.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
export const NEBBIA_FIXED = {
    edge: 0.6,
    beads: 0.35,
    drip: 0.25,
    refract: 1,
    glint: 1,
    fieldDrops: 0.5,
    wind: 0,
    endBead: 1,
    endBeadMin: 48,
    beadHold: 4,
    breathSpread: 1.2,
    breathHold: 1,
    breathFade: 8,
    breathThick: 0.7,
    bumpRate: 1,
    bumpFall: 0.5
};
export const MASK_SCALE = 0.5;
export const FOG_DIV = 4;
export const clamp = (value, min = 0, max = 1)=>Math.max(min, Math.min(max, value));
export const smooth = (t)=>t * t * (3 - 2 * t);
