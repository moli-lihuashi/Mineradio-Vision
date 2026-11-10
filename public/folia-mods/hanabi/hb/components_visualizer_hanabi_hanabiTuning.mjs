/* 移植自 Folia components/visualizer/hanabi/hanabiTuning.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { normalizeLyricRenderOverride } from './_stubs.mjs';
import { snapResolutionToTexturePool } from './components_visualizer_pixi_pixiTextureBudget.mjs';
import { numberWithin } from './components_visualizer_tuningDefinition.mjs';
import { DEFAULT_HANABI_TUNING } from './components_visualizer_hanabi_types.mjs';
const MAX_BASE_RESOLUTION = 2;
export const resolveHanabiBaseResolution = (devicePixelRatio)=>Math.min(MAX_BASE_RESOLUTION, Math.max(1, devicePixelRatio || 1));
const COLOR_MODES = [
    'theme',
    'vivid',
    'mixed'
];
const RENDER_QUALITIES = [
    'full',
    'balanced',
    'low'
];
export const normalizeHanabiTuning = (raw)=>{
    const input = {
        ...DEFAULT_HANABI_TUNING,
        ...raw && typeof raw === 'object' ? raw : {}
    };
    const d = DEFAULT_HANABI_TUNING;
    return {
        render: normalizeLyricRenderOverride(input.render),
        colorMode: COLOR_MODES.includes(input.colorMode) ? input.colorMode : d.colorMode,
        sparkAmount: numberWithin(input.sparkAmount, d.sparkAmount, 0, 2),
        ornamentAmount: numberWithin(input.ornamentAmount, d.ornamentAmount, 0, 2),
        textMotion: numberWithin(input.textMotion, d.textMotion, 0, 2),
        blockOpacity: numberWithin(input.blockOpacity, d.blockOpacity, 0, 1),
        riseSpeed: numberWithin(input.riseSpeed, d.riseSpeed, 0, 2),
        spin: numberWithin(input.spin, d.spin, 0, 2),
        ambient: numberWithin(input.ambient, d.ambient, 0, 2),
        glow: numberWithin(input.glow, d.glow, 0, 2),
        bloom: numberWithin(input.bloom, d.bloom, 0, 2),
        chorusBloom: numberWithin(input.chorusBloom, d.chorusBloom, 0, 2),
        launches: input.launches !== false,
        overlayFrame: input.overlayFrame !== false,
        textOnly: input.textOnly === true,
        sky: numberWithin(input.sky, d.sky, 0, 1),
        collage: numberWithin(input.collage, d.collage, 0, 2),
        renderQuality: RENDER_QUALITIES.includes(input.renderQuality) ? input.renderQuality : d.renderQuality
    };
};
const HANABI_LIVE_KEYS = [
    'render',
    'sky',
    'overlayFrame',
    'bloom',
    'chorusBloom'
];
export const HANABI_OVERLAY_KEYS = [
    'overlayFrame',
    'colorMode',
    'textOnly'
];
export const requiresHanabiSceneRebuild = (previous, next)=>Object.keys(next).some((key)=>!HANABI_LIVE_KEYS.includes(key) && previous[key] !== next[key]);
export const changedHanabiKeys = (previous, next, keys)=>keys.some((key)=>previous[key] !== next[key]);
export const HANABI_QUALITY_PROFILES = {
    full: {
        glowScale: 1,
        ambientScale: 1
    },
    balanced: {
        glowScale: 0.7,
        ambientScale: 1
    },
    low: {
        glowScale: 0.5,
        ambientScale: 0.6
    }
};
export const resolveHanabiGlowResolution = (width, height, renderResolution, quality)=>{
    const { glowScale } = HANABI_QUALITY_PROFILES[quality] ?? HANABI_QUALITY_PROFILES.full;
    if (glowScale >= 1) return renderResolution;
    return snapResolutionToTexturePool(width, height, renderResolution * glowScale);
};
export const resolveHanabiGlowLevelDrop = (renderResolution, glowResolution)=>glowResolution > 0 && glowResolution < renderResolution ? Math.max(0, Math.round(Math.log2(renderResolution / glowResolution))) : 0;
export const resolveHanabiGlowQuality = (width, height, renderResolution, quality)=>{
    const resolution = resolveHanabiGlowResolution(width, height, renderResolution, quality);
    return {
        resolution: resolution < renderResolution ? resolution : null,
        levelDrop: resolveHanabiGlowLevelDrop(renderResolution, resolution)
    };
};
