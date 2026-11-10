/* 移植自 Folia components/visualizer/hanabi/collage/collagePlan.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { splitLyricGraphemes } from './utils_lyrics_graphemeTiming.mjs';
import { segmentLyricWords } from './utils_lyrics_wordSegmentation.mjs';
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
import { clamp, mixColor } from './components_visualizer_hanabi_mg_mgMath.mjs';
const FAMILY_RECIPES = {
    uchiage: [
        'strips',
        'scrapbook',
        'stickerbomb'
    ],
    kiku: [
        'echo',
        'strips',
        'window'
    ],
    botan: [
        'stickerbomb',
        'scrapbook',
        'window'
    ],
    yanagi: [
        'quiet',
        'echo'
    ],
    senrin: [
        'stickerbomb',
        'strips',
        'scrapbook'
    ],
    hoshikuzu: [
        'window',
        'quiet',
        'stickerbomb'
    ],
    obi: [
        'strips',
        'scrapbook',
        'echo'
    ],
    senko: [
        'window',
        'echo',
        'strips'
    ],
    senkohanabi: [
        'quiet',
        'scrapbook'
    ],
    shakudama: [
        'echo',
        'strips',
        'stickerbomb'
    ]
};
export const CANDY = [
    0xffb3d1,
    0xb8f2e6,
    0xfff1a8,
    0xd7c4ff,
    0xffc9a8,
    0xa8dcff
];
export const CANDY_INK = 0x2b1f3d;
export const DEEP_CARD = 0x1d1838;
export const HANABI_FALLBACK_ICON = 'Flower';
export const ICON_INKS = [
    0xff5fa2,
    0x3fb2ff,
    0xffa31a,
    0x9b6bff,
    0x2ec9a0
];
const BUBBLE_LABELS = [
    '♡',
    '!!',
    '♪',
    'LOVE',
    'yay!',
    '(≧▽≦)',
    '☆彡'
];
const WINDOW_TITLES = [
    '♡ hanabi.exe',
    '♪ lyric.txt',
    '✦ night_sky.png',
    '☆ summer.mp3',
    '♡ kirakira.app'
];
const SHAPES = [
    'heart',
    'star',
    'sparkle',
    'flower',
    'cloud',
    'ribbon',
    'cat'
];
export const STRIP_STYLES = [
    'film',
    'cut',
    'lace'
];
const STRIP_THICKNESS = {
    film: 0.075,
    cut: 0.045,
    lace: 0.06
};
const pick = (list, random)=>list[Math.floor(random() * list.length) % list.length];
export const pastel = (color, amount = 0.45)=>mixColor(color, 0xffffff, amount);
const LATIN = /^[\p{Script=Latin}\p{N}'’\- ]+$/u;
export const pickCollageKeyword = (line)=>{
    if (!line) return null;
    const text = line.fullText.trim();
    const graphemes = splitLyricGraphemes(text).filter((grapheme)=>grapheme.trim().length > 0);
    const shout = (word)=>LATIN.test(word) ? word.toLocaleUpperCase() : word;
    if (graphemes.length >= 2 && graphemes.length <= 5) return shout(text);
    let best = null;
    let bestLength = 0;
    segmentLyricWords(line).forEach((part)=>{
        const word = part.segment.trim();
        const length = splitLyricGraphemes(word).length;
        if (!part.isWordLike || length < 2 || length > 10) return;
        if (length > bestLength) {
            best = word;
            bestLength = length;
        }
    });
    return best ? shout(best) : null;
};
export const chooseCollageRecipe = (family, isBridge, previous, random)=>{
    if (isBridge) return 'bridge';
    const preferred = FAMILY_RECIPES[family] ?? [
        'scrapbook',
        'strips',
        'stickerbomb'
    ];
    const choices = preferred.filter((recipe)=>recipe !== previous);
    const list = choices.length > 0 ? choices : preferred;
    const total = list.length * (list.length + 1) / 2;
    let roll = random() * total;
    for(let index = 0; index < list.length; index += 1){
        roll -= list.length - index;
        if (roll < 0) return list[index];
    }
    return list[0];
};
const countOf = (base, amount, min = 1)=>amount <= 0 ? 0 : Math.max(min, Math.round(base * amount));
export const planShotCollage = (input)=>{
    if (input.amount <= 0) return {
        recipe: null,
        items: []
    };
    const random = createRng(`${input.seed}:collage`);
    const recipe = input.isBridge && input.opening ? 'opening' : chooseCollageRecipe(input.family, input.isBridge, input.previous, random);
    const { bounds, screen, unit, amount } = input;
    const items = [];
    const exit = {
        exitAt: input.exitAt,
        exitDuration: input.exitDuration
    };
    const candy = [
        ...CANDY,
        pastel(input.palette.accent),
        pastel(input.palette.sparks[1] ?? input.palette.accent)
    ];
    const candyColor = ()=>pick(candy, random);
    const railGap = unit * 0.14;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const sx = screen.x + screen.width / 2;
    const clampX = (x, pad)=>clamp(x, screen.x + railGap * 0.5 + pad, screen.x + screen.width - pad);
    const clampY = (y, pad)=>clamp(y, screen.y + pad, screen.y + screen.height - pad);
    const signed = ()=>random() < 0.5 ? -1 : 1;
    const motifs = input.motifs.length > 0 ? input.motifs : [
        'HANABI',
        '花火'
    ];
    const motif = ()=>pick(motifs, random);
    const sticker = (shape, x, y, size, delay, layer = 'front', label = null)=>({
            kind: 'sticker',
            shape,
            x: clampX(x, size * 0.6),
            y: clampY(y, size * 0.6),
            size,
            rotation: (random() - 0.5) * 0.7,
            color: candyColor(),
            label,
            layer,
            at: input.enterAt + delay,
            ...exit
        });
    const corner = (index, out)=>{
        const dx = index === 0 || index === 3 ? -1 : 1;
        const dy = index < 2 ? -1 : 1;
        return {
            x: (dx < 0 ? bounds.x : bounds.x + bounds.width) + dx * out,
            y: (dy < 0 ? bounds.y : bounds.y + bounds.height) + dy * out * 0.6
        };
    };
    const strip = (style, side, delay)=>{
        const thickness = Math.max(style === 'cut' ? 14 : 18, unit * STRIP_THICKNESS[style]);
        const gap = unit * 0.05 + thickness / 2;
        let y = side < 0 ? bounds.y - gap : bounds.y + bounds.height + gap;
        y = clampY(y, thickness);
        return {
            kind: 'strip',
            style,
            x: sx,
            y,
            length: Math.hypot(screen.width, screen.height) * 1.25,
            thickness,
            rotation: side * (0.06 + random() * 0.1),
            color: candyColor(),
            speed: signed() * unit * (style === 'film' ? 0.12 : 0.05) * (0.8 + random() * 0.4),
            from: signed(),
            at: input.enterAt + delay,
            ...exit
        };
    };
    const echo = (axis, side, alpha)=>{
        const text = input.keyword ?? motif();
        if (!text.trim()) return null;
        const size = unit * (axis === 'x' ? 0.13 : 0.11);
        if (axis === 'x') {
            const y = side < 0 ? bounds.y - size * 0.75 : bounds.y + bounds.height + size * 0.75;
            return {
                kind: 'echo',
                axis,
                text,
                size,
                alpha,
                x: sx,
                y: clampY(y, size * 0.5),
                width: screen.width * 1.3,
                height: size * 1.25,
                rotation: (random() - 0.5) * 0.08,
                color: random() < 0.5 ? input.palette.paper : candyColor(),
                speed: side * unit * 0.07,
                at: input.enterAt - 0.15,
                ...exit
            };
        }
        const width = size * Math.max(1, Array.from(text).length) * 0.9 + size * 0.4;
        const free = (screen.width - bounds.width) / 2;
        const x = side < 0 ? bounds.x - width * 0.55 : bounds.x + bounds.width + width * 0.55;
        return {
            kind: 'echo',
            axis,
            text,
            size,
            alpha,
            x: clamp(free > width * 0.6 ? x : side < 0 ? -Infinity : Infinity, screen.x + railGap + width * 0.5, screen.x + screen.width - unit * 0.06 - width * 0.5),
            y: cy,
            width,
            height: screen.height * 1.3,
            rotation: 0,
            color: random() < 0.5 ? input.palette.paper : candyColor(),
            speed: side * unit * 0.06,
            at: input.enterAt - 0.15,
            ...exit
        };
    };
    const patch = (pad, offset, pattern, delay)=>{
        const dark = input.block === 'none' || input.block === 'outline' || input.block === 'marker';
        return {
            kind: 'patch',
            x: cx + offset * signed(),
            y: cy + offset * signed() * 0.6,
            width: bounds.width + pad * 2,
            height: bounds.height + pad * 2,
            rotation: (random() - 0.5) * 0.09,
            color: dark ? DEEP_CARD : candyColor(),
            pattern,
            dark,
            at: input.enterAt + delay,
            ...exit
        };
    };
    const tape = (index, delay, around)=>{
        const length = unit * (0.12 + random() * 0.04);
        const x = index === 0 || index === 3 ? around.x : around.x + around.width;
        const y = index < 2 ? around.y : around.y + around.height;
        const diagonal = index === 0 || index === 2 ? -1 : 1;
        return {
            kind: 'tape',
            x,
            y,
            length,
            width: length * 0.3,
            rotation: diagonal * (0.62 + random() * 0.2),
            color: candyColor(),
            pattern: pick([
                'stripe',
                'dot',
                'check'
            ], random),
            at: input.enterAt + delay,
            ...exit
        };
    };
    const label = (delay)=>{
        const size = Math.max(12, unit * 0.026);
        const text = random() < 0.5 ? `No.${String(input.shotNumber + 1).padStart(2, '0')}` : `#${String(input.shotNumber + 1).padStart(2, '0')} ${pick([
            '♪',
            '♡',
            '✦'
        ], random)}`;
        const at = corner(3, size * 0.4);
        return {
            kind: 'label',
            x: clampX(at.x + size * 2.2, size * 3),
            y: clampY(at.y + size * 0.9, size),
            text,
            color: candyColor(),
            size,
            rotation: (random() - 0.5) * 0.2,
            at: input.enterAt + delay,
            ...exit
        };
    };
    const stickerSize = ()=>unit * (0.065 + random() * 0.04);
    switch(recipe){
        case 'scrapbook':
            {
                const pad = unit * 0.045;
                const card = patch(pad, unit * 0.012, pick([
                    'grid',
                    'dots',
                    'gingham'
                ], random), -0.12);
                items.push(patch(pad * 0.6, unit * 0.04, 'plain', -0.2), card);
                const around = {
                    x: card.x - card.width / 2,
                    y: card.y - card.height / 2,
                    width: card.width,
                    height: card.height
                };
                const first = Math.floor(random() * 2);
                items.push(tape(first, 0.05, around), tape(first + 2, 0.12, around));
                for(let k = 0; k < countOf(1.5, amount); k += 1){
                    const at = corner((first + 1 + k * 2) % 4, unit * 0.03);
                    items.push(sticker(pick(SHAPES, random), at.x, at.y, stickerSize(), 0.25 + k * 0.1));
                }
                items.push(label(0.3));
                break;
            }
        case 'strips':
            {
                const side = random() < 0.5 ? -1 : 1;
                const first = pick(STRIP_STYLES, random);
                items.push(strip(first, side, -0.1));
                if (amount >= 0.75) items.push(strip(pick(STRIP_STYLES.filter((style)=>style !== first), random), side === -1 ? 1 : -1, 0.05));
                for(let k = 0; k < countOf(2, amount); k += 1){
                    const at = corner((k * 2 + (side < 0 ? 1 : 0)) % 4, unit * 0.04);
                    items.push(sticker(k % 2 === 0 ? 'sparkle' : 'star', at.x, at.y, stickerSize() * 0.85, 0.2 + k * 0.12));
                }
                break;
            }
        case 'echo':
            {
                const vertical = screen.width - bounds.width > unit * 0.5;
                const first = echo(vertical ? 'y' : 'x', -1, 0.3);
                const second = echo(vertical ? 'y' : 'x', 1, 0.3);
                if (first) items.push(first);
                if (second && amount >= 0.75) items.push(second);
                const at = corner(1, unit * 0.04);
                items.push(sticker('bubble', at.x, at.y, stickerSize() * 1.6, 0.3, 'front', pick(BUBBLE_LABELS, random)));
                break;
            }
        case 'window':
            {
                const pad = unit * 0.05;
                const bar = Math.max(16, unit * 0.04);
                const width = bounds.width + pad * 2;
                const height = bounds.height + pad * 2 + bar;
                const win = {
                    kind: 'window',
                    x: cx,
                    y: cy - bar / 2,
                    width,
                    height,
                    rotation: (random() - 0.5) * 0.05,
                    bar,
                    title: pick(WINDOW_TITLES, random),
                    at: input.enterAt - 0.18,
                    ...exit
                };
                items.push(win);
                for(let k = 0; k < countOf(2, amount); k += 1){
                    const at = corner(k === 0 ? 0 : 2, unit * 0.035);
                    items.push(sticker(pick(SHAPES, random), at.x, at.y, stickerSize(), 0.25 + k * 0.12));
                }
                break;
            }
        case 'stickerbomb':
            {
                const count = countOf(4, amount, 2);
                for(let k = 0; k < count; k += 1){
                    const at = corner(k % 4, unit * (0.03 + 0.03 * Math.floor(k / 4)));
                    const jitter = unit * 0.03;
                    items.push(sticker(pick(SHAPES, random), at.x + (random() - 0.5) * jitter, at.y + (random() - 0.5) * jitter, stickerSize(), 0.15 + k * 0.08));
                }
                const at = corner(Math.floor(random() * 4), unit * 0.09);
                items.push(sticker('bubble', at.x, at.y, stickerSize() * 1.5, 0.4, 'front', pick(BUBBLE_LABELS, random)));
                break;
            }
        case 'quiet':
            {
                const row = echo('x', random() < 0.5 ? -1 : 1, 0.16);
                if (row) items.push(row);
                const at = corner(Math.floor(random() * 4), unit * 0.03);
                items.push(sticker('sparkle', at.x, at.y, stickerSize() * 0.7, 0.35));
                break;
            }
        case 'opening':
            {
                const opening = input.opening;
                const leave = {
                    exitAt: Math.max(input.start + 1.2, input.end - 0.7),
                    exitDuration: 0.5
                };
                const titleSize = Math.min(unit * 0.11, screen.width * 0.5 / Math.max(4, Array.from(opening.title).length * 0.62));
                const width = Math.min(screen.width * 0.72, Math.max(unit * 0.6, titleSize * Array.from(opening.title).length * 0.7 + unit * 0.2));
                const bar = Math.max(16, unit * 0.045);
                const height = titleSize * 1.9 + bar + (opening.artist ? unit * 0.06 : 0);
                const y = screen.y + screen.height * 0.42;
                const at = input.start + 0.25;
                items.push({
                    kind: 'window',
                    x: sx,
                    y,
                    width,
                    height,
                    rotation: -0.02,
                    bar,
                    title: '♪ now playing',
                    at,
                    ...leave
                }, {
                    kind: 'headline',
                    x: sx,
                    y: y + bar / 2 - (opening.artist ? unit * 0.02 : 0),
                    text: opening.title,
                    color: candyColor(),
                    size: titleSize,
                    rotation: -0.03,
                    at: at + 0.18,
                    ...leave
                });
                if (opening.artist) {
                    items.push({
                        kind: 'label',
                        x: sx,
                        y: y + height / 2 - unit * 0.045,
                        text: opening.artist,
                        color: candyColor(),
                        size: Math.max(12, unit * 0.028),
                        rotation: 0.02,
                        at: at + 0.4,
                        ...leave
                    });
                }
                const card = {
                    x: sx - width / 2,
                    y: y - height / 2,
                    width,
                    height
                };
                [
                    0,
                    1,
                    2,
                    3
                ].forEach((k)=>{
                    const x = k === 0 || k === 3 ? card.x : card.x + card.width;
                    const cornerY = k < 2 ? card.y : card.y + card.height;
                    items.push({
                        ...sticker(pick([
                            'heart',
                            'star',
                            'ribbon',
                            'sparkle'
                        ], random), x, cornerY, unit * 0.075, 0),
                        at: at + 0.3 + k * 0.08,
                        ...leave
                    });
                });
                const floaters = countOf(5, amount, 2);
                for(let k = 0; k < floaters; k += 1){
                    items.push({
                        kind: 'floater',
                        shape: pick([
                            'heart',
                            'star',
                            'sparkle'
                        ], random),
                        x: screen.x + screen.width * (0.1 + random() * 0.8),
                        y: screen.y + screen.height * 1.08,
                        rise: screen.height * (1.25 + random() * 0.3),
                        size: unit * (0.045 + random() * 0.04),
                        color: candyColor(),
                        at: input.start + 0.6 + k / floaters * Math.max(0.5, input.end - input.start - 1.5),
                        duration: 3.4 + random() * 1.4,
                        sway: unit * (0.02 + random() * 0.03)
                    });
                }
                break;
            }
        case 'bridge':
            {
                const film = strip('film', 1, 0);
                film.y = screen.y + screen.height * (0.62 + random() * 0.12);
                film.at = input.start + 0.1;
                items.push(film);
                const floaters = countOf(7, amount, 3);
                const span = Math.max(0.5, input.end - input.start);
                for(let k = 0; k < floaters; k += 1){
                    const at = input.start + k / floaters * span * 0.8 + random() * 0.3;
                    items.push({
                        kind: 'floater',
                        shape: pick([
                            'heart',
                            'star',
                            'sparkle',
                            'flower'
                        ], random),
                        x: screen.x + screen.width * (0.08 + random() * 0.84),
                        y: screen.y + screen.height * 1.08,
                        rise: screen.height * (1.25 + random() * 0.3),
                        size: unit * (0.05 + random() * 0.05),
                        color: candyColor(),
                        at,
                        duration: 3.2 + random() * 1.6,
                        sway: unit * (0.02 + random() * 0.03)
                    });
                }
                break;
            }
    }
    const icons = input.icons && input.icons.length > 0 ? input.icons : [
        HANABI_FALLBACK_ICON
    ];
    let iconTurn = Math.floor(random() * icons.length);
    const nextIcon = ()=>icons[iconTurn++ % icons.length];
    const mains = input.bursts.filter((burst)=>burst.main);
    const popped = recipe === 'opening' ? [] : input.isBridge ? mains.filter((_, index)=>index % 2 === 0).slice(0, 5) : mains.slice(0, 1);
    popped.forEach((burst)=>{
        if (random() > Math.min(1, 0.55 + 0.35 * amount)) return;
        const size = unit * (input.isBridge ? 0.1 : 0.115) * (0.9 + random() * 0.25);
        const view = input.screenAt?.(burst.at + 0.35) ?? screen;
        const halfWidth = size * 0.6;
        const left = view.x + railGap * 0.5 + halfWidth;
        const right = view.x + view.width - halfWidth - size * 0.3;
        const top = view.y + size * 0.8;
        const bottom = view.y + view.height * 0.8;
        const preferRight = input.isBridge ? burst.x > sx : burst.x >= cx;
        const beside = (dir)=>({
                x: dir > 0 ? bounds.x + bounds.width + halfWidth + size * 0.3 : bounds.x - halfWidth - size * 0.3,
                y: bounds.y + size * 0.2
            });
        const candidates = input.isBridge ? [
            {
                x: burst.x + (preferRight ? 1 : -1) * burst.radius * 0.45,
                y: burst.y - burst.radius * 0.35
            }
        ] : [
            beside(preferRight ? 1 : -1),
            beside(preferRight ? -1 : 1),
            {
                x: cx + (random() - 0.5) * bounds.width * 0.3,
                y: bounds.y - size * 0.75
            }
        ];
        const fits = (p)=>p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
        const spot = candidates.find(fits) ?? candidates[0];
        items.push({
            kind: 'pop',
            icon: nextIcon(),
            x: clamp(spot.x, left, Math.max(left, right)),
            y: clamp(spot.y, top, Math.max(top, bottom)),
            color: pick(ICON_INKS, random),
            size,
            rotation: (preferRight ? 1 : -1) * (0.08 + random() * 0.18),
            at: burst.at + 0.04,
            duration: 1.3
        });
    });
    input.launches.slice(0, 2).forEach((launch)=>{
        if (random() > 0.45 + 0.25 * amount) return;
        items.push({
            kind: 'whoosh',
            icon: nextIcon(),
            fromX: launch.fromX,
            fromY: launch.fromY,
            toX: launch.toX,
            toY: launch.toY,
            at: launch.at,
            duration: launch.duration,
            color: pick(ICON_INKS, random),
            size: Math.max(18, unit * 0.055)
        });
    });
    return {
        recipe,
        items
    };
};
