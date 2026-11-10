/* 移植自 Folia components/visualizer/machi/types.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const MACHI_SCENE_IDS = [
    'konbini',
    'station',
    'kowloon'
];
export const MACHI_TIMES_OF_DAY = [
    'auto',
    'day',
    'dusk',
    'night'
];
export const MACHI_WEATHERS = [
    'auto',
    'clear',
    'rain',
    'snow',
    'fog'
];
export const MACHI_CAMERA_MODES = [
    'default',
    'custom'
];
export const MACHI_FOCUS_MODES = [
    'center',
    'lyrics',
    'manual'
];
export const MACHI_VIEW_LIMITS = {
    azimuth: {
        min: -75,
        max: 75
    },
    elevation: {
        min: -12,
        max: 40
    },
    zoom: {
        min: 0.5,
        max: 2.8
    },
    panX: {
        min: -5,
        max: 5
    },
    panZ: {
        min: -5,
        max: 5
    }
};
export const MACHI_DOF_LIMITS = {
    aperture: {
        min: 1.4,
        max: 16
    },
    dof: {
        min: 0,
        max: 2
    },
    dofRange: {
        min: 0.3,
        max: 3
    },
    tiltShift: {
        min: 0,
        max: 1
    },
    focusOffset: {
        min: -10,
        max: 10
    }
};
export const MACHI_APERTURE_STOPS = [
    1.4,
    2,
    2.8,
    4,
    5.6,
    8,
    11,
    16
];
export const MACHI_MOTION_SPEED_LIMITS = {
    min: 0.25,
    max: 3
};
export const MACHI_RENDER_SCALES = [
    1,
    0.75,
    0.5
];
export const MACHI_ANTIALIAS_MODES = [
    'off',
    'fxaa',
    'smaa',
    'ssaa'
];
export const MACHI_FOLLOW_GLOBAL = 'global';
export const MACHI_DETAIL_LEVELS = [
    'off',
    'low',
    'high'
];
export const MACHI_QUALITY_REVISION = 2;
export const MACHI_QUALITY_PRESET_IDS = [
    'high',
    'balanced',
    'low'
];
export const MACHI_QUALITY_PRESETS = {
    high: {
        renderScale: MACHI_FOLLOW_GLOBAL,
        antialias: MACHI_FOLLOW_GLOBAL,
        shadows: 'high',
        reflections: 'high',
        glow: true
    },
    balanced: {
        renderScale: MACHI_FOLLOW_GLOBAL,
        antialias: 'fxaa',
        shadows: 'low',
        reflections: 'low',
        glow: true
    },
    low: {
        renderScale: 0.75,
        antialias: 'off',
        shadows: 'off',
        reflections: 'off',
        glow: false
    }
};
export const DEFAULT_MACHI_QUALITY = {
    ...MACHI_QUALITY_PRESETS.high,
    adaptive: true,
    revision: MACHI_QUALITY_REVISION
};
export const DEFAULT_MACHI_VIEW = {
    azimuth: 0,
    elevation: 0,
    zoom: 1,
    panX: 0,
    panZ: 0
};
export const DEFAULT_MACHI_VIEWS = {
    konbini: DEFAULT_MACHI_VIEW,
    station: DEFAULT_MACHI_VIEW,
    kowloon: DEFAULT_MACHI_VIEW
};
export const DEFAULT_MACHI_TUNING = {
    scene: 'auto',
    timeOfDay: 'auto',
    weather: 'auto',
    camera: 'default',
    views: DEFAULT_MACHI_VIEWS,
    motion: false,
    motionSpeed: 1,
    aperture: 8,
    dof: 1,
    dofRange: 1,
    tiltShift: 0.3,
    focus: 'center',
    focusOffset: 0,
    quality: DEFAULT_MACHI_QUALITY
};
