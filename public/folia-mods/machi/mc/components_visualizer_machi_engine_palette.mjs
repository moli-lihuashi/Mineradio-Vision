/* 移植自 Folia components/visualizer/machi/engine/palette.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { adjustLightnessForContrast, getContrastRatio, getHueDistance, getRelativeLuminance, hexToHsl, hslToHex, mixHexColors, normalizeHue } from './utils_themeColorMath.mjs';
import { hashVisualizerSeed } from './components_visualizer_visualizerSeedHash.mjs';
export const MACHI_LIGHT_THEME_LUMINANCE = 0.4;
export const MACHI_BOARD_MIN_CONTRAST = 4.5;
const CHROMATIC_SATURATION = 0.22;
const CLASSIC_BRAND_TRIADS = [
    [
        '#f0781e',
        '#f4f1ea',
        '#1f9a52'
    ],
    [
        '#2f6fd6',
        '#f4f1ea',
        '#58b8ea'
    ],
    [
        '#1d9a63',
        '#f4f1ea',
        '#2d6cc0'
    ],
    [
        '#e2402f',
        '#f4f1ea',
        '#f2b520'
    ],
    [
        '#7a4fd0',
        '#f4f1ea',
        '#f07fae'
    ]
];
const PRODUCT_FALLBACK = [
    '#e85d4a',
    '#f2c14e',
    '#4fa3d8',
    '#7ccf7a',
    '#f08cc0',
    '#f4f1ea',
    '#9b7be0',
    '#ff9d4d'
];
const ART = {
    skyTop: '#0e1524',
    skyBottom: '#26324a',
    asphalt: '#2a303c',
    roadPaint: '#c9d1dc',
    concrete: '#4b5363',
    curb: '#5f6878',
    plinthTop: '#20242c',
    plinthMid: '#3d3a36',
    plinthLow: '#2b2622',
    plinthTrim: '#15171c',
    glass: '#9cc3e6',
    metal: '#8a94a1',
    darkMetal: '#383e49',
    pole: '#979ca4',
    rubber: '#1c1f26',
    wire: '#11141a',
    caution: '#e7b42e',
    stopRed: '#c7302b',
    hemiSky: '#3a4b6c',
    hemiGround: '#141923',
    moon: '#9cb3dc',
    skyTopDusk: '#2c2f5c',
    skyBottomDusk: '#e58a62',
    hemiSkyDusk: '#8b79a6',
    hemiGroundDusk: '#30262a',
    moonDusk: '#ffae78',
    skyTopDay: '#4d8bd4',
    skyBottomDay: '#cde4f2',
    hemiSkyDay: '#bcd6ee',
    hemiGroundDay: '#5f5b52',
    moonDay: '#fff0da',
    interiorLight: '#ffc887',
    streetLight: '#ffe4b8',
    vendingLight: '#d4ebff',
    gold: '#ffc861'
};
const clampRange = (value, min, max)=>Math.min(max, Math.max(min, value));
const hslOf = (color, fallback)=>(color ? hexToHsl(color) : null) ?? hexToHsl(fallback);
const isChromatic = (color)=>{
    const hsl = color ? hexToHsl(color) : null;
    return !!hsl && hsl.s >= CHROMATIC_SATURATION && hsl.l > 0.08 && hsl.l < 0.94;
};
export const vivid = (color, minSaturation = 0.58, minLightness = 0.42, maxLightness = 0.62)=>{
    const hsl = hslOf(color, ART.gold);
    return hslToHex({
        h: hsl.h,
        s: Math.max(minSaturation, hsl.s),
        l: clampRange(hsl.l, minLightness, maxLightness)
    });
};
const pullHue = (base, toward, amount)=>{
    const from = hexToHsl(base);
    const to = hexToHsl(toward);
    if (!to || amount <= 0) return base;
    const distance = getHueDistance(from.h, to.h);
    const forward = normalizeHue(from.h + distance) === normalizeHue(to.h) ? 1 : -1;
    return hslToHex({
        h: normalizeHue(from.h + forward * distance * amount),
        s: from.s,
        l: from.l
    });
};
const tintDark = (base, themeBackground)=>{
    const background = hexToHsl(themeBackground);
    if (!background || background.s < 0.08) return base;
    return pullHue(base, themeBackground, Math.min(0.25, background.s * 0.45));
};
export const seedIndex = (seed, salt, length)=>hashVisualizerSeed(`${seed}:${salt}`) % length;
const chromaticCandidates = (theme)=>[
        theme.accentColor,
        ...(theme.wordColors ?? []).map((entry)=>entry.color),
        theme.primaryColor,
        theme.secondaryColor
    ].filter(isChromatic);
const resolveBrand = (theme, seed)=>{
    const candidates = chromaticCandidates(theme);
    if (candidates.length === 0) {
        return CLASSIC_BRAND_TRIADS[seedIndex(seed, 'brand', CLASSIC_BRAND_TRIADS.length)];
    }
    const first = vivid(candidates[0]);
    const firstHue = hexToHsl(first).h;
    const second = candidates.slice(1).find((color)=>getHueDistance(hexToHsl(color).h, firstHue) >= 40);
    const third = second ? vivid(second) : hslToHex({
        ...hexToHsl(first),
        h: normalizeHue(firstHue + 150)
    });
    return [
        first,
        '#f4f1ea',
        third
    ];
};
const resolveBoard = (theme, brand, isLight)=>{
    const accent = isChromatic(theme.accentColor) ? theme.accentColor : brand[0];
    if (isLight) {
        const base = '#f3eee4';
        const lit = adjustLightnessForContrast(vivid(accent, 0.62, 0.3, 0.46), base, MACHI_BOARD_MIN_CONTRAST);
        return {
            base,
            unlit: '#9aa0ab',
            lit
        };
    }
    const base = mixHexColors('#0f1420', vivid(accent), 0.12);
    const glow = isChromatic(theme.accentColor) || isChromatic(brand[0]) ? vivid(accent, 0.62, 0.64, 0.74) : ART.gold;
    const lit = adjustLightnessForContrast(glow, base, MACHI_BOARD_MIN_CONTRAST);
    return {
        base,
        unlit: '#6c7384',
        lit
    };
};
const resolveProducts = (theme, brand, seed)=>{
    const keywordColors = (theme.wordColors ?? []).map((entry)=>entry.color).filter(isChromatic).map((color)=>vivid(color, 0.45, 0.45, 0.7));
    const pool = [
        ...keywordColors,
        brand[0],
        brand[2],
        ...PRODUCT_FALLBACK
    ];
    const offset = seedIndex(seed, 'products', PRODUCT_FALLBACK.length);
    return Array.from({
        length: 8
    }, (_, index)=>pool[index < keywordColors.length + 2 ? index : keywordColors.length + 2 + (index + offset) % PRODUCT_FALLBACK.length]);
};
export const resolveMachiPalette = (theme, seed, resolveArt)=>{
    const background = theme.backgroundColor;
    const isLight = getRelativeLuminance(background) > MACHI_LIGHT_THEME_LUMINANCE;
    const brand = resolveBrand(theme, seed);
    const board = resolveBoard(theme, brand, isLight);
    const accent = isChromatic(theme.accentColor) ? theme.accentColor : brand[0];
    const skyTop = tintDark(ART.skyTop, background);
    const skyBottom = tintDark(ART.skyBottom, background);
    const interiorHsl = hexToHsl(mixHexColors(ART.interiorLight, vivid(accent), 0.16));
    const interiorLight = hslToHex({
        ...interiorHsl,
        l: Math.max(0.72, interiorHsl.l)
    });
    const signText = getContrastRatio('#1b1f27', brand[1]) >= MACHI_BOARD_MIN_CONTRAST ? '#1b1f27' : '#ffffff';
    const base = {
        skyTop,
        skyBottom,
        fog: skyBottom,
        hemiSky: tintDark(ART.hemiSky, background),
        hemiGround: ART.hemiGround,
        moon: ART.moon,
        skyTopDusk: tintDark(ART.skyTopDusk, background),
        skyBottomDusk: ART.skyBottomDusk,
        hemiSkyDusk: ART.hemiSkyDusk,
        hemiGroundDusk: ART.hemiGroundDusk,
        moonDusk: ART.moonDusk,
        skyTopDay: tintDark(ART.skyTopDay, background),
        skyBottomDay: ART.skyBottomDay,
        hemiSkyDay: ART.hemiSkyDay,
        hemiGroundDay: ART.hemiGroundDay,
        moonDay: ART.moonDay,
        asphalt: tintDark(ART.asphalt, background),
        roadPaint: ART.roadPaint,
        concrete: tintDark(ART.concrete, background),
        curb: ART.curb,
        plinthTop: ART.plinthTop,
        plinthMid: ART.plinthMid,
        plinthLow: ART.plinthLow,
        plinthTrim: ART.plinthTrim,
        glass: ART.glass,
        metal: ART.metal,
        darkMetal: ART.darkMetal,
        pole: ART.pole,
        rubber: ART.rubber,
        wire: ART.wire,
        caution: ART.caution,
        stopRed: ART.stopRed,
        interiorLight,
        streetLight: ART.streetLight,
        vendingLight: ART.vendingLight,
        brand,
        signBase: brand[1],
        signText,
        boardBase: board.base,
        boardUnlit: board.unlit,
        boardLit: board.lit,
        boardIsLight: isLight,
        led: vivid(accent, 0.85, 0.58, 0.66),
        neon: vivid(accent, 0.75, 0.6, 0.7),
        vendingBody: hslToHex({
            ...hexToHsl(brand[2]),
            s: Math.min(0.62, Math.max(0.35, hexToHsl(brand[2]).s)),
            l: 0.42
        }),
        vendingAccent: vivid(brand[0], 0.6, 0.48, 0.6),
        products: resolveProducts(theme, brand, seed)
    };
    return {
        ...base,
        art: resolveArt ? resolveArt(theme, seed, base) : {}
    };
};
