/* 移植自 Folia components/visualizer/tuningDefinition.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const modNumber = (min, max, step)=>step === undefined ? {
        type: 'number',
        min,
        max
    } : {
        type: 'number',
        min,
        max,
        step
    };
export const MOD_SWITCH = {
    type: 'boolean'
};
export const modChoice = (options)=>({
        type: 'choice',
        options
    });
export const numberWithin = (value, fallback, min, max)=>typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export const defineVisualizerTuning = (definition)=>({
        ...definition,
        read: (bundle)=>bundle?.[definition.mode] ?? definition.defaults
    });
export const defineBackgroundTuning = (definition)=>definition;
