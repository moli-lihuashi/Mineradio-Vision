/* 移植自 Folia components/visualizer/machi/engine/quality.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { DEFAULT_LYRIC_RENDER_QUALITY, MAX_LYRIC_PIXEL_RATIO } from './_stubs.mjs';
const SHADOW_MAP_SIZES = {
    off: 0,
    low: 1024,
    high: 2048
};
const REFLECTION_SCALES = {
    off: 0,
    low: 0.3,
    high: 0.5
};
const MAX_DEVICE_RATIO = 2;
const MAX_SUPERSAMPLED_RATIO = MAX_LYRIC_PIXEL_RATIO;
const SUPERSAMPLE = 2;
const PREVIEW_PIXEL_RATIO = 1;
const SMAA_SAMPLES = 4;
const LEVEL_DOWN = {
    high: 'low',
    low: 'off',
    off: 'off'
};
const POST_AA_DOWN = {
    smaa: 'fxaa',
    fxaa: 'off'
};
const SCALE_DOWN = {
    1: 0.75,
    0.75: 0.5
};
const DEGRADE_STEPS = [
    (s)=>{
        if (s.antialias === 'ssaa') return {
            ...s,
            antialias: 'smaa',
            msaa: true
        };
        return s.renderScale > 1 ? {
            ...s,
            renderScale: 1
        } : null;
    },
    (s)=>s.antialias === 'smaa' && s.msaa ? {
            ...s,
            msaa: false
        } : null,
    (s)=>s.glow ? {
            ...s,
            glow: false
        } : null,
    (s)=>s.reflections !== 'off' ? {
            ...s,
            reflections: LEVEL_DOWN[s.reflections]
        } : null,
    (s)=>s.dof ? {
            ...s,
            dof: false
        } : null,
    (s)=>{
        const lower = SCALE_DOWN[s.renderScale];
        return lower ? {
            ...s,
            renderScale: lower
        } : null;
    },
    (s)=>{
        const lower = POST_AA_DOWN[s.antialias];
        return lower ? {
            ...s,
            antialias: lower
        } : null;
    },
    (s)=>s.shadows !== 'off' ? {
            ...s,
            shadows: LEVEL_DOWN[s.shadows]
        } : null
];
const DEGRADE_MAX_FRAME_MS = 21;
const DEGRADE_MIN_FRAME_MS = 1000 / 90;
const DEGRADE_SLACK = 1.33;
const DEGRADE_SLOW_CHECKS = 2;
const DEGRADE_RELIEF = 0.95;
const DEGRADE_STEADY = 1.2;
export const createMachiDegradeState = ()=>({
        refresh: 0,
        slowChecks: 0,
        degradedAverage: 0,
        displayFloor: 0
    });
export const resolveMachiDegradeThreshold = (refresh)=>refresh > 0 ? Math.min(DEGRADE_MAX_FRAME_MS, Math.max(DEGRADE_MIN_FRAME_MS, refresh * DEGRADE_SLACK)) : DEGRADE_MAX_FRAME_MS;
export const stepMachiDegrade = (state, intervals)=>{
    const sorted = [
        ...intervals
    ].sort((a, b)=>a - b);
    const fast = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const slow = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const average = intervals.reduce((sum, value)=>sum + value, 0) / Math.max(1, intervals.length);
    const displayLimited = state.degradedAverage > 0 && average >= state.degradedAverage * DEGRADE_RELIEF && slow <= fast * DEGRADE_STEADY;
    const displayFloor = displayLimited ? fast : state.displayFloor;
    const learned = state.refresh > 0 && !displayLimited ? Math.min(state.refresh, fast) : fast;
    const refresh = Math.max(learned, displayFloor);
    const threshold = resolveMachiDegradeThreshold(refresh);
    if (average <= threshold) return {
        state: {
            refresh,
            slowChecks: 0,
            degradedAverage: 0,
            displayFloor
        },
        degrade: false,
        average,
        threshold
    };
    const slowChecks = state.slowChecks + 1;
    if (slowChecks < DEGRADE_SLOW_CHECKS) return {
        state: {
            refresh,
            slowChecks,
            degradedAverage: 0,
            displayFloor
        },
        degrade: false,
        average,
        threshold
    };
    return {
        state: {
            refresh,
            slowChecks: 0,
            degradedAverage: average,
            displayFloor
        },
        degrade: true,
        average,
        threshold
    };
};
const settle = (quality, global)=>({
        renderScale: quality.renderScale === 'global' ? global.scale : quality.renderScale,
        antialias: quality.antialias === 'global' ? global.antialias === 'off' ? 'off' : 'smaa' : quality.antialias,
        msaa: true,
        shadows: quality.shadows,
        reflections: quality.reflections,
        glow: quality.glow,
        dof: true
    });
export const resolveMachiRenderQuality = (quality, options)=>{
    let settled = settle(quality, options.previewMode ? DEFAULT_LYRIC_RENDER_QUALITY : options.global);
    const wanted = quality.adaptive && !options.previewMode ? Math.max(0, Math.floor(options.degrade)) : 0;
    let degrade = 0;
    for(let index = 0, idle = 0; degrade < wanted && idle < DEGRADE_STEPS.length; index += 1){
        const next = DEGRADE_STEPS[index % DEGRADE_STEPS.length](settled);
        if (next) {
            settled = next;
            degrade += 1;
            idle = 0;
        } else {
            idle += 1;
        }
    }
    let { antialias, shadows, glow, renderScale } = settled;
    if (options.previewMode) {
        if (antialias === 'ssaa') antialias = 'smaa';
        if (shadows === 'high') shadows = 'low';
        glow = false;
        renderScale = 1;
    }
    const device = Math.min(Math.max(1, options.devicePixelRatio || 1), MAX_DEVICE_RATIO);
    const base = options.previewMode ? PREVIEW_PIXEL_RATIO : device * Math.min(1, renderScale);
    const scaled = renderScale > 1 ? Math.max(base, Math.min(base * renderScale, MAX_SUPERSAMPLED_RATIO)) : base;
    const pixelRatio = antialias === 'ssaa' ? Math.max(scaled, Math.min(scaled * SUPERSAMPLE, MAX_SUPERSAMPLED_RATIO)) : scaled;
    return {
        pixelRatio,
        samples: antialias === 'smaa' && settled.msaa && !options.previewMode ? SMAA_SAMPLES : 0,
        postAA: antialias === 'fxaa' ? 'fxaa' : antialias === 'smaa' ? 'smaa' : 'none',
        inkScale: pixelRatio / base,
        shadowMapSize: SHADOW_MAP_SIZES[shadows],
        reflectionScale: REFLECTION_SCALES[settled.reflections],
        bloom: glow,
        streaks: glow,
        dof: settled.dof,
        antialias,
        renderScale,
        degrade
    };
};
