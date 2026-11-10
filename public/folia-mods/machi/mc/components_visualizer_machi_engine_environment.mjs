/* 移植自 Folia components/visualizer/machi/engine/environment.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { visualizerHash01, hashVisualizerSeed } from './components_visualizer_visualizerSeedHash.mjs';
export const MACHI_DAYLIGHT = {
    night: 0,
    dusk: 0.45,
    day: 1
};
const smoothstep = (edge0, edge1, x)=>{
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};
export const resolveMachiDaylightAt = (hour)=>{
    const h = (hour % 24 + 24) % 24;
    if (h >= 5 && h < 6.5) return smoothstep(5, 6.5, h);
    if (h >= 6.5 && h < 16.5) return 1;
    if (h >= 16.5 && h < 17.5) return 1 - (1 - MACHI_DAYLIGHT.dusk) * smoothstep(16.5, 17.5, h);
    if (h >= 17.5 && h < 18.5) return MACHI_DAYLIGHT.dusk * (1 - smoothstep(17.5, 18.5, h));
    return 0;
};
export const resolveMachiDaylight = (timeOfDay, now)=>timeOfDay === 'auto' ? resolveMachiDaylightAt(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600) : MACHI_DAYLIGHT[timeOfDay];
const AUTO_WEATHER = [
    [
        'rain',
        0.35
    ],
    [
        'clear',
        0.3
    ],
    [
        'fog',
        0.2
    ],
    [
        'snow',
        0.15
    ]
];
export const resolveMachiWeatherKind = (weather, seed)=>{
    if (weather !== 'auto') return weather;
    let roll = visualizerHash01(hashVisualizerSeed(`machi-weather:${seed}`), 0, 0x3d);
    for (const [kind, weight] of AUTO_WEATHER){
        if (roll < weight) return kind;
        roll -= weight;
    }
    return 'rain';
};
export const resolveMachiEnvironmentTarget = (daylight, kind)=>({
        daylight,
        rain: kind === 'rain' ? 1 : 0,
        snow: kind === 'snow' ? 1 : 0,
        fog: kind === 'fog' ? 1 : 0
    });
export const createMachiEnvironmentState = (target)=>({
        ...target,
        wetness: target.rain > 0.5 ? 1 : target.fog > 0.5 ? 0.35 : 0,
        snowCover: target.snow > 0.5 ? 1 : 0
    });
const TAU = {
    daylight: 1.6,
    precipitation: 1.4,
    fog: 2.2,
    wetUp: 3,
    wetDown: 20,
    snowUp: 8,
    snowDown: 12
};
const approach = (value, target, tau, delta)=>{
    const next = value + (target - value) * (1 - Math.exp(-delta / tau));
    return Math.abs(next - target) < 1e-3 ? target : next;
};
export const stepMachiEnvironment = (state, target, delta)=>{
    if (delta <= 0) return state;
    const rain = approach(state.rain, target.rain, TAU.precipitation, delta);
    const snow = approach(state.snow, target.snow, TAU.precipitation, delta);
    const fog = approach(state.fog, target.fog, TAU.fog, delta);
    const wetTarget = Math.max(rain, fog * 0.35);
    const wetness = approach(state.wetness, wetTarget, wetTarget > state.wetness ? TAU.wetUp : TAU.wetDown, delta);
    const snowCover = approach(state.snowCover, snow, snow > state.snowCover ? TAU.snowUp : TAU.snowDown, delta);
    return {
        daylight: approach(state.daylight, target.daylight, TAU.daylight, delta),
        rain,
        snow,
        fog,
        wetness,
        snowCover
    };
};
export const sameMachiEnvironment = (a, b)=>a.daylight === b.daylight && a.rain === b.rain && a.snow === b.snow && a.fog === b.fog && a.wetness === b.wetness && a.snowCover === b.snowCover;
export const resolveMachiEnvironmentLook = (state)=>{
    const { daylight } = state;
    const warmth = Math.max(0, 1 - Math.abs(daylight - MACHI_DAYLIGHT.dusk) / 0.38);
    const overcast = Math.min(1, Math.max(state.rain, state.fog, state.snow * 0.8));
    const night = 1 - daylight;
    return {
        warmth,
        overcast,
        artificial: 0.55 + 0.45 * smoothstep(0.85, 0.2, daylight),
        streetLamps: smoothstep(0.62, 0.3, daylight),
        sunIntensity: (1.35 + (3.0 - 1.35) * daylight) * (1 - 0.55 * overcast * daylight) * (1 - 0.25 * state.fog),
        hemiIntensity: 2.1 + 0.35 * daylight + 0.25 * overcast * daylight,
        bloom: 0.12 + 0.38 * night,
        streaks: 0.55 * night * night,
        clouds: 0.18 + 0.82 * overcast,
        stars: night * (1 - overcast) * smoothstep(0.35, 0.05, daylight),
        mist: 0.16 * (1 - 0.4 * daylight) + 0.1 * state.rain + 0.45 * state.fog + 0.06 * state.snow,
        haze: 0.42 * state.fog + 0.08 * state.snow
    };
};
