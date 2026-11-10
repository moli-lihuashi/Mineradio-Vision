/* 移植自 Folia「雾笺」 textMeasureCache.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
export const rememberBounded = (cache, key, value, limit)=>{
    if (!cache.has(key) && cache.size >= limit) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
};
export const measurePrefixOffsets = (graphemes, measurePrefix)=>{
    const offsets = new Array(graphemes.length + 1).fill(0);
    for(let count = 1; count <= graphemes.length; count += 1){
        offsets[count] = measurePrefix(graphemes.slice(0, count).join(''), count, offsets[count - 1]);
    }
    return offsets;
};
