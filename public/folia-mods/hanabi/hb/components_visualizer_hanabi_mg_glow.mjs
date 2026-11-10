/* 移植自 Folia components/visualizer/hanabi/mg/glow.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createBloomFilter } from './components_visualizer_pixi_bloomFilter.mjs';
const BASE = {
    strength: 1.1,
    threshold: 0.2,
    knee: 0.25,
    levels: 5,
    spread: 0.85,
    tint: [
        1,
        0.96,
        0.9
    ]
};
export const createHanabiGlow = (pixi, amount, quality = {
    resolution: null,
    levelDrop: 0
}, padding = 48)=>{
    const filter = createBloomFilter(pixi, {
        ...BASE,
        strength: BASE.strength * Math.max(0, amount),
        levels: Math.max(1, BASE.levels - quality.levelDrop),
        padding
    });
    filter.resolution = quality.resolution ?? 'inherit';
    return filter;
};
export const setHanabiGlow = (filter, amount)=>{
    filter.options.strength = BASE.strength * Math.max(0, amount);
};
