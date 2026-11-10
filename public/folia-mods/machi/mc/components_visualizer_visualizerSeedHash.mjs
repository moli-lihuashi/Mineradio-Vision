/* 移植自 Folia components/visualizer/visualizerSeedHash.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const hashVisualizerSeed = (value)=>{
    let hash = 2166136261;
    for(let index = 0; index < value.length; index += 1){
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};
export const mixVisualizerSeed = (seed, salt)=>Math.imul((Math.trunc(seed) ^ salt) >>> 0, 2654435761) >>> 0;
export const visualizerHash01 = (seed, index, salt)=>mixVisualizerSeed(seed + Math.imul(index + 1, 97), salt) / 4294967296;
export const createVisualizerRng = (seed)=>{
    let state = typeof seed === 'number' ? seed >>> 0 : hashVisualizerSeed(seed);
    return ()=>{
        state = state + 0x6d2b79f5 | 0;
        let t = Math.imul(state ^ state >>> 15, 1 | state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
};
export const createVisualizerRngAt = (seed, skip)=>{
    const state = typeof seed === 'number' ? seed >>> 0 : hashVisualizerSeed(seed);
    return createVisualizerRng(state + Math.imul(skip, 0x6d2b79f5) >>> 0);
};
