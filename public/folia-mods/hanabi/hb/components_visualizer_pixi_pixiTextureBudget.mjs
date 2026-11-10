/* 移植自 Folia components/visualizer/pixi/pixiTextureBudget.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const nextPow2 = (value)=>{
    let v = value + (value === 0 ? 1 : 0);
    v -= 1;
    v |= v >>> 1;
    v |= v >>> 2;
    v |= v >>> 4;
    v |= v >>> 8;
    v |= v >>> 16;
    return v + 1;
};
export const texturePoolAxis = (cssSize, resolution)=>nextPow2(Math.ceil(cssSize * resolution - 1e-6));
export const TEXTURE_POOL_MAX_RESOLUTION_DROP = 0.25;
const stepDownCandidate = (cssSize, resolution)=>{
    const bucket = texturePoolAxis(cssSize, resolution);
    if (bucket < 2) return null;
    return bucket / 2 / cssSize;
};
export const snapResolutionToTexturePool = (cssWidth, cssHeight, resolution, maxDrop = TEXTURE_POOL_MAX_RESOLUTION_DROP)=>{
    if (![
        cssWidth,
        cssHeight,
        resolution
    ].every((value)=>Number.isFinite(value) && value > 0)) {
        return resolution;
    }
    const lowest = resolution * (1 - Math.min(Math.max(maxDrop, 0), 1));
    const candidates = [
        stepDownCandidate(cssWidth, resolution),
        stepDownCandidate(cssHeight, resolution)
    ].filter((candidate)=>candidate !== null && candidate > 0 && candidate < resolution && candidate >= lowest);
    let best = resolution;
    let bestArea = texturePoolAxis(cssWidth, resolution) * texturePoolAxis(cssHeight, resolution);
    candidates.forEach((candidate)=>{
        const area = texturePoolAxis(cssWidth, candidate) * texturePoolAxis(cssHeight, candidate);
        if (area >= bestArea) return;
        bestArea = area;
        best = candidate;
    });
    return best;
};
