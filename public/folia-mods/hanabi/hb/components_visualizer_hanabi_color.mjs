/* 移植自 Folia components/visualizer/hanabi/color.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { parseColorChannels } from './components_visualizer_colorMix.mjs';
const rgbOfHex = (hex)=>[
        (hex >> 16 & 255) / 255,
        (hex >> 8 & 255) / 255,
        (hex & 255) / 255
    ];
export const hexOfRgb = (rgb)=>{
    const c = (v)=>Math.round(Math.min(1, Math.max(0, v)) * 255);
    return c(rgb[0]) << 16 | c(rgb[1]) << 8 | c(rgb[2]);
};
export const cssOfHex = (hex)=>`#${hex.toString(16).padStart(6, '0')}`;
const rgbOfCss = (color)=>{
    const channels = color ? parseColorChannels(color) : null;
    return channels ? [
        channels.r / 255,
        channels.g / 255,
        channels.b / 255
    ] : null;
};
export const hexOfCss = (color, fallback)=>{
    const rgb = rgbOfCss(color);
    return rgb ? hexOfRgb(rgb) : fallback;
};
const toHsl = ([r, g, b])=>{
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [
        0,
        0,
        l
    ];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [
        h / 6,
        s,
        l
    ];
};
const toRgb = ([h, s, l])=>{
    if (s === 0) return [
        l,
        l,
        l
    ];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t)=>{
        const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    return [
        channel(h + 1 / 3),
        channel(h),
        channel(h - 1 / 3)
    ];
};
const clamp01 = (value)=>Math.min(1, Math.max(0, value));
const mixHue = (from, to, amount)=>{
    let delta = to - from;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    return (from + delta * amount + 1) % 1;
};
const vivid = (hex, sat, minL, maxL)=>{
    const [h, s, l] = toHsl(rgbOfHex(hex));
    const saturation = s < 0.05 ? s : Math.max(s, sat);
    return hexOfRgb(toRgb([
        h,
        saturation,
        Math.min(maxL, Math.max(minL, l))
    ]));
};
const linear = (v)=>v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const relativeLuminance = (hex)=>{
    const [r, g, b] = rgbOfHex(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
export const contrastRatio = (a, b)=>{
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const DARK_INK = 0x2b1f3d;
const LIGHT_INK = 0xffffff;
export const MIN_BLOCK_CONTRAST = 3.2;
const separate = (block, ink)=>{
    if (contrastRatio(block, ink) >= MIN_BLOCK_CONTRAST) return block;
    const [h, s, l] = toHsl(rgbOfHex(block));
    const darker = relativeLuminance(ink) > 0.5;
    for(let step = 1; step <= 20; step += 1){
        const next = hexOfRgb(toRgb([
            h,
            s,
            clamp01(darker ? l - step * 0.04 : l + step * 0.04)
        ]));
        if (contrastRatio(next, ink) >= MIN_BLOCK_CONTRAST) return next;
    }
    return darker ? 0x000000 : 0xffffff;
};
export const ensureContrast = (color, against, min)=>{
    if (contrastRatio(color, against) >= min) return color;
    const [h, s, l] = toHsl(rgbOfHex(color));
    const directions = relativeLuminance(against) > 0.18 ? [
        -1,
        1
    ] : [
        1,
        -1
    ];
    for(let step = 1; step <= 25; step += 1){
        for (const direction of directions){
            const next = hexOfRgb(toRgb([
                h,
                s,
                clamp01(l + direction * step * 0.04)
            ]));
            if (contrastRatio(next, against) >= min) return next;
        }
    }
    return contrastRatio(0x000000, against) >= contrastRatio(0xffffff, against) ? 0x000000 : 0xffffff;
};
export const MIN_SUNG_CONTRAST = 3;
export const MIN_FLASH_CONTRAST = 2;
export const hanabiBackdropOf = (palette)=>relativeLuminance(palette.paper) > 0.5 ? 0x0b0d24 : 0xf3efe9;
export const resolveHanabiGlyphColors = (palette, base, under)=>{
    const ink = ensureContrast(base, under, MIN_SUNG_CONTRAST);
    const candidates = [
        palette.accent,
        ...palette.sparks,
        palette.glow
    ];
    const sung = candidates.find((color)=>contrastRatio(color, under) >= MIN_SUNG_CONTRAST && contrastRatio(color, ink) >= 1.3) ?? ensureContrast(palette.accent, under, MIN_SUNG_CONTRAST);
    return {
        ink,
        sung,
        flash: ensureContrast(palette.glow, under, MIN_FLASH_CONTRAST),
        back: ensureContrast(palette.sparks[0] ?? palette.accent, under, MIN_FLASH_CONTRAST)
    };
};
const ROLES = {
    night: {
        blocks: [
            0x1d2b7a,
            0xd62f74,
            0x5b3cc4
        ],
        sparks: [
            0xffd166,
            0xff6fa5,
            0x7bdff2,
            0xffffff,
            0xb79cff
        ],
        accent: 0xffd166,
        glow: 0xffe3a3
    },
    festival: {
        blocks: [
            0xe60033,
            0x1e50a2,
            0xd9480f
        ],
        sparks: [
            0xffcc1a,
            0xff3355,
            0x3cc8ff,
            0x6dff9a,
            0xffffff
        ],
        accent: 0xffc400,
        glow: 0xffa24a
    },
    pastel: {
        blocks: [
            0xff9ec0,
            0x8fd8ff,
            0xfff08a
        ],
        sparks: [
            0xffc4e1,
            0xa8e8ff,
            0xfff5b0,
            0xd4bfff
        ],
        accent: 0xff7fb2,
        glow: 0xfff0f6
    },
    mono: {
        blocks: [
            0xf4f1ea,
            0xc9c3b3
        ],
        sparks: [
            0xffffff,
            0xe8e2d0,
            0xfff3d6
        ],
        accent: 0xffffff,
        glow: 0xfff7e6
    },
    gold: {
        blocks: [
            0xf2b01e,
            0xffd970,
            0xfff1c9
        ],
        sparks: [
            0xffd36e,
            0xffae3b,
            0xfff1c1,
            0xff8a3d
        ],
        accent: 0xffc94a,
        glow: 0xffcf70
    },
    neon: {
        blocks: [
            0xff2bd6,
            0x00e5ff,
            0x7a2cff
        ],
        sparks: [
            0xff2bd6,
            0x00f0ff,
            0xb8ff1f,
            0xffffff,
            0x8f6bff
        ],
        accent: 0x00f0ff,
        glow: 0xff6bf0
    },
    sakura: {
        blocks: [
            0xff5f9e,
            0xfff4f8,
            0xffb8d2
        ],
        sparks: [
            0xffb7d5,
            0xffffff,
            0xff6fae,
            0xffe0ec
        ],
        accent: 0xff4f93,
        glow: 0xffd6e8
    },
    kawaii: {
        blocks: [
            0xff7eb6,
            0x7fd8ff,
            0xffe066
        ],
        sparks: [
            0xffb3d9,
            0xa0f0ff,
            0xfff3a0,
            0xd9b8ff,
            0xffffff
        ],
        accent: 0xff5fa2,
        glow: 0xffd1e8
    },
    ocean: {
        blocks: [
            0x0a5cff,
            0x00c2b8,
            0xeaf6ff
        ],
        sparks: [
            0x5ce1ff,
            0x2bffd5,
            0xffffff,
            0x4d86ff
        ],
        accent: 0x5ce1ff,
        glow: 0xa8f0ff
    }
};
export const PALETTE_ROLES = Object.keys(ROLES);
const themeColors = (theme)=>{
    const primary = hexOfCss(theme.primaryColor, 0xffffff);
    const accent = hexOfCss(theme.accentColor, 0xffd166);
    const secondary = hexOfCss(theme.secondaryColor, accent);
    const spark = (hex)=>vivid(hex, 0.6, 0.58, 0.8);
    return {
        blocks: [
            vivid(accent, 0.55, 0.3, 0.7),
            vivid(primary, 0.45, 0.25, 0.75),
            vivid(secondary, 0.5, 0.3, 0.7)
        ],
        sparks: [
            spark(accent),
            spark(primary),
            spark(secondary),
            0xffffff
        ],
        accent: spark(accent),
        glow: vivid(accent, 0.5, 0.75, 0.88)
    };
};
const MIX_MIN_SATURATION = 0.2;
const mixColors = (role, theme)=>{
    const target = toHsl(rgbOfHex(hexOfCss(theme.accentColor, role.accent)));
    if (target[1] < MIX_MIN_SATURATION) return role;
    const themed = themeColors(theme);
    const lean = (hex)=>{
        const [h, s, l] = toHsl(rgbOfHex(hex));
        if (s < 0.05) return hex;
        return hexOfRgb(toRgb([
            mixHue(h, target[0], 0.4),
            s,
            l
        ]));
    };
    return {
        blocks: [
            themed.blocks[0],
            ...role.blocks.slice(1).map(lean)
        ],
        sparks: [
            themed.sparks[0],
            ...role.sparks.slice(1).map(lean)
        ],
        accent: themed.accent,
        glow: lean(role.glow)
    };
};
export const keywordColorOf = (theme)=>{
    const entries = (theme.wordColors ?? []).map((entry)=>({
            word: entry.word.trim().toLowerCase(),
            color: rgbOfCss(entry.color)
        })).filter((entry)=>entry.word.length > 0 && entry.color !== null);
    if (entries.length === 0) return undefined;
    return (text)=>{
        const key = text.trim().toLowerCase();
        if (!key) return null;
        const hit = entries.find((entry)=>key === entry.word || key.includes(entry.word));
        return hit ? hexOfRgb(hit.color) : null;
    };
};
export const resolveHanabiPalette = (role, theme, colorMode)=>{
    const base = ROLES[role] ?? ROLES.night;
    const colors = colorMode === 'theme' ? themeColors(theme) : colorMode === 'mixed' ? mixColors(base, theme) : base;
    const background = hexOfCss(theme.backgroundColor, 0x000000);
    const paper = relativeLuminance(background) > 0.4 ? DARK_INK : LIGHT_INK;
    const worst = (ink)=>Math.min(...colors.blocks.map((block)=>contrastRatio(block, ink)));
    const ink = worst(DARK_INK) >= worst(LIGHT_INK) ? DARK_INK : LIGHT_INK;
    return {
        ink,
        paper,
        blocks: colors.blocks.map((block)=>separate(block, ink)),
        sparks: colors.sparks,
        accent: colors.accent,
        glow: colors.glow
    };
};
