/* 移植自 Folia components/visualizer/machi/machiTuning.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { numberWithin } from './components_visualizer_tuningDefinition.mjs';
import { hashVisualizerSeed } from './components_visualizer_visualizerSeedHash.mjs';
import { DEFAULT_MACHI_QUALITY, DEFAULT_MACHI_TUNING, DEFAULT_MACHI_VIEW, DEFAULT_MACHI_VIEWS, MACHI_ANTIALIAS_MODES, MACHI_CAMERA_MODES, MACHI_DETAIL_LEVELS, MACHI_DOF_LIMITS, MACHI_FOCUS_MODES, MACHI_FOLLOW_GLOBAL, MACHI_MOTION_SPEED_LIMITS, MACHI_QUALITY_PRESET_IDS, MACHI_QUALITY_PRESETS, MACHI_QUALITY_REVISION, MACHI_RENDER_SCALES, MACHI_SCENE_IDS, MACHI_TIMES_OF_DAY, MACHI_VIEW_LIMITS, MACHI_WEATHERS } from './components_visualizer_machi_types.mjs';
const SCENE_CHOICES = [
    'auto',
    ...MACHI_SCENE_IDS
];
export const normalizeMachiView = (raw)=>{
    const input = raw && typeof raw === 'object' ? raw : {};
    const field = (key)=>numberWithin(input[key], DEFAULT_MACHI_VIEW[key], MACHI_VIEW_LIMITS[key].min, MACHI_VIEW_LIMITS[key].max);
    return {
        azimuth: field('azimuth'),
        elevation: field('elevation'),
        zoom: field('zoom'),
        panX: field('panX'),
        panZ: field('panZ')
    };
};
export const normalizeMachiViews = (raw, legacy)=>{
    const input = raw && typeof raw === 'object' ? raw : null;
    if (!input && legacy === undefined) return DEFAULT_MACHI_VIEWS;
    return Object.fromEntries(MACHI_SCENE_IDS.map((id)=>[
            id,
            normalizeMachiView(input ? input[id] : legacy)
        ]));
};
export const normalizeMachiQuality = (raw)=>{
    const input = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_MACHI_QUALITY;
    const pick = (choices, value, fallback)=>choices.includes(value) ? value : fallback;
    const legacy = input.revision !== MACHI_QUALITY_REVISION;
    return {
        renderScale: legacy && input.renderScale === 1 ? MACHI_FOLLOW_GLOBAL : pick([
            MACHI_FOLLOW_GLOBAL,
            ...MACHI_RENDER_SCALES
        ], input.renderScale, d.renderScale),
        antialias: legacy && input.antialias === 'smaa' ? MACHI_FOLLOW_GLOBAL : pick([
            MACHI_FOLLOW_GLOBAL,
            ...MACHI_ANTIALIAS_MODES
        ], input.antialias, d.antialias),
        shadows: pick(MACHI_DETAIL_LEVELS, input.shadows, d.shadows),
        reflections: pick(MACHI_DETAIL_LEVELS, input.reflections, d.reflections),
        glow: typeof input.glow === 'boolean' ? input.glow : d.glow,
        adaptive: typeof input.adaptive === 'boolean' ? input.adaptive : d.adaptive,
        revision: MACHI_QUALITY_REVISION
    };
};
export const pinMachiQualityForExport = (quality)=>quality.renderScale === MACHI_FOLLOW_GLOBAL && quality.antialias === MACHI_FOLLOW_GLOBAL && !quality.adaptive ? quality : {
        ...quality,
        renderScale: MACHI_FOLLOW_GLOBAL,
        antialias: MACHI_FOLLOW_GLOBAL,
        adaptive: false
    };
export const resolveMachiQualityPreset = (quality)=>MACHI_QUALITY_PRESET_IDS.find((id)=>{
        const preset = MACHI_QUALITY_PRESETS[id];
        return Object.keys(preset).every((key)=>preset[key] === quality[key]);
    }) ?? 'custom';
export const normalizeMachiTuning = (raw)=>{
    const stored = raw && typeof raw === 'object' ? raw : {};
    const input = {
        ...DEFAULT_MACHI_TUNING,
        ...stored
    };
    const d = DEFAULT_MACHI_TUNING;
    const within = (key)=>numberWithin(input[key], d[key], MACHI_DOF_LIMITS[key].min, MACHI_DOF_LIMITS[key].max);
    return {
        scene: SCENE_CHOICES.includes(input.scene) ? input.scene : d.scene,
        timeOfDay: MACHI_TIMES_OF_DAY.includes(input.timeOfDay) ? input.timeOfDay : d.timeOfDay,
        weather: MACHI_WEATHERS.includes(input.weather) ? input.weather : d.weather,
        camera: MACHI_CAMERA_MODES.includes(input.camera) ? input.camera : d.camera,
        views: normalizeMachiViews(stored.views, stored.view),
        motion: typeof input.motion === 'boolean' ? input.motion : d.motion,
        motionSpeed: numberWithin(input.motionSpeed, d.motionSpeed, MACHI_MOTION_SPEED_LIMITS.min, MACHI_MOTION_SPEED_LIMITS.max),
        aperture: within('aperture'),
        dof: within('dof'),
        dofRange: within('dofRange'),
        tiltShift: within('tiltShift'),
        focus: MACHI_FOCUS_MODES.includes(input.focus) ? input.focus : d.focus,
        focusOffset: within('focusOffset'),
        quality: normalizeMachiQuality(input.quality)
    };
};
export const resolveMachiSceneId = (tuning, seed)=>{
    if (tuning.scene !== 'auto') return tuning.scene;
    return MACHI_SCENE_IDS[hashVisualizerSeed(`machi-scene:${seed}`) % MACHI_SCENE_IDS.length];
};
