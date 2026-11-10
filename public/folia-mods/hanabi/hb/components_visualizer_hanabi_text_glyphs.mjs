/* 移植自 Folia components/visualizer/hanabi/text/glyphs.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { resolveHanabiBaseResolution } from './components_visualizer_hanabi_hanabiTuning.mjs';
const UPRIGHT = /[ᄀ-ᇿ⺀-⿿　-〿぀-ヿ㄀-ㇿ㈀-鿿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u;
export const isUprightGlyph = (char)=>UPRIGHT.test(char);
export const hasCjk = (text)=>UPRIGHT.test(text);
export const glyphFont = (weight, px, family)=>`${weight} ${px}px ${family}`;
export const estimateAdvance = (char)=>{
    if (char.trim().length === 0) return 0.3;
    if (isUprightGlyph(char)) return 1;
    if (/[ilI.,:;'!|]/.test(char)) return 0.34;
    if (/[mwMW@]/.test(char)) return 0.85;
    return 0.6;
};
const createContext = ()=>{
    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            const context = new OffscreenCanvas(8, 8).getContext('2d');
            if (context) return context;
        }
        if (typeof document !== 'undefined') return document.createElement('canvas').getContext('2d');
    } catch  {}
    return null;
};
export const createGlyphMeasure = (font, weight)=>{
    const context = createContext();
    const cache = new Map();
    if (context) context.font = glyphFont(weight, 100, font);
    return (char)=>{
        let width = cache.get(char);
        if (width === undefined) {
            width = context ? context.measureText(char).width / 100 : estimateAdvance(char);
            if (!Number.isFinite(width) || width <= 0) width = estimateAdvance(char);
            cache.set(char, width);
        }
        return width;
    };
};
const ATLAS_BASE_LIMIT_PX = 4096;
const ATLAS_HARD_LIMIT_PX = 8192;
let gpuTextureLimitPx = 4096;
export const setHanabiGlyphTextureLimit = (px)=>{
    if (Number.isFinite(px) && px >= 2048) gpuTextureLimitPx = Math.floor(px);
};
export const resolveGlyphAtlasLimit = (resolution, maxCanvasPx, devicePixelRatio = globalThis.devicePixelRatio ?? 1)=>{
    if (maxCanvasPx !== undefined) return maxCanvasPx;
    const superscale = Math.max(1, resolution / resolveHanabiBaseResolution(devicePixelRatio));
    return Math.min(ATLAS_BASE_LIMIT_PX * superscale, Math.max(ATLAS_BASE_LIMIT_PX, gpuTextureLimitPx), ATLAS_HARD_LIMIT_PX);
};
const cellSide = (px, outline, glow)=>Math.ceil(px * 1.3 + 2 * Math.max(outline * px, glow ? px * 0.32 : 0) + 4);
export const buildGlyphAtlas = (pixi, options)=>{
    const variants = [
        'fill'
    ];
    if (options.outline > 0) variants.push('fat');
    if (options.glow) variants.push('glow');
    const cells = [];
    const add = (char, px, scramble)=>{
        const side = cellSide(px, options.outline, options.glow);
        const kinds = scramble ? variants.filter((v)=>v !== 'glow') : variants;
        kinds.forEach((variant)=>cells.push({
                char,
                px,
                variant,
                side,
                x: 0,
                y: 0,
                scramble
            }));
    };
    options.chars.forEach((px, char)=>{
        if (char.trim().length > 0) add(char, Math.max(4, px), false);
    });
    options.scramble?.chars.forEach((char)=>add(char, Math.max(4, options.scramble.px), true));
    const gap = 2;
    const area = cells.reduce((sum, cell)=>sum + (cell.side + gap) ** 2, 0);
    const maxSide = cells.reduce((max, cell)=>Math.max(max, cell.side), 1);
    const shelfWidth = Math.max(maxSide + gap, Math.ceil(Math.sqrt(area) * 1.15));
    const order = cells.map((_, index)=>index).sort((a, b)=>cells[b].side - cells[a].side);
    let x = 0;
    let y = 0;
    let shelf = 0;
    let width = 1;
    order.forEach((index)=>{
        const cell = cells[index];
        if (x + cell.side > shelfWidth && x > 0) {
            x = 0;
            y += shelf + gap;
            shelf = 0;
        }
        cell.x = x;
        cell.y = y;
        x += cell.side + gap;
        shelf = Math.max(shelf, cell.side);
        width = Math.max(width, x);
    });
    const height = Math.max(1, y + shelf);
    const limit = resolveGlyphAtlasLimit(options.resolution, options.maxCanvasPx);
    const resolution = Math.max(0.1, Math.min(options.resolution, limit / width, limit / height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * resolution));
    canvas.height = Math.max(1, Math.ceil(height * resolution));
    const source = new pixi.CanvasSource({
        resource: canvas,
        resolution
    });
    let painted = false;
    const paint = ()=>{
        if (painted) return false;
        painted = true;
        const context = canvas.getContext('2d');
        context.setTransform(resolution, 0, 0, resolution, 0, 0);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#ffffff';
        context.strokeStyle = '#ffffff';
        context.lineJoin = 'round';
        cells.forEach((cell)=>{
            context.font = glyphFont(options.weight, cell.px, options.font);
            const cx = cell.x + cell.side / 2;
            const cy = cell.y + cell.side / 2;
            if (cell.variant === 'fat') {
                context.lineWidth = options.outline * cell.px * 2;
                context.strokeText(cell.char, cx, cy);
                context.fillText(cell.char, cx, cy);
            } else if (cell.variant === 'glow') {
                context.save();
                context.shadowColor = '#ffffff';
                context.shadowBlur = cell.px * 0.22 * resolution;
                context.globalAlpha = 0.85;
                context.fillText(cell.char, cx, cy);
                context.fillText(cell.char, cx, cy);
                context.restore();
            } else {
                context.fillText(cell.char, cx, cy);
            }
        });
        source.update();
        return true;
    };
    const textures = [];
    const sub = (fx, fy, fw, fh)=>{
        const texture = new pixi.Texture({
            source,
            frame: new pixi.Rectangle(fx, fy, fw, fh)
        });
        textures.push(texture);
        return texture;
    };
    const entries = new Map();
    const scrambleEntries = new Map();
    cells.forEach((cell)=>{
        const map = cell.scramble ? scrambleEntries : entries;
        let entry = map.get(cell.char);
        if (!entry) {
            entry = {
                char: cell.char,
                px: cell.px,
                fill: null,
                fat: null,
                glow: null,
                halves: null
            };
            map.set(cell.char, entry);
        }
        const texture = sub(cell.x, cell.y, cell.side, cell.side);
        if (cell.variant === 'fill') {
            entry.fill = texture;
            if (options.halves && !cell.scramble) {
                const half = cell.side / 2;
                entry.halves = options.halves === 'lr' ? [
                    sub(cell.x, cell.y, half, cell.side),
                    sub(cell.x + half, cell.y, half, cell.side)
                ] : [
                    sub(cell.x, cell.y, cell.side, half),
                    sub(cell.x, cell.y + half, cell.side, half)
                ];
            }
        } else if (cell.variant === 'fat') entry.fat = texture;
        else entry.glow = texture;
    });
    const blank = {
        char: ' ',
        px: 1,
        fill: pixi.Texture.EMPTY,
        fat: null,
        glow: null,
        halves: null
    };
    return {
        entry: (char)=>entries.get(char) ?? blank,
        scramble: options.scramble?.chars.map((char)=>scrambleEntries.get(char)).filter(Boolean) ?? [],
        paint,
        destroy: ()=>{
            textures.forEach((texture)=>texture.destroy(false));
            source.destroy();
        }
    };
};
const SCRAMBLE_KANA = Array.from('アイウエオカキクケコサシスセソタチツテトナニヌネハヒフヘホマミムメモヤユヨラリルレロワヲン＃％＆＊？！◆※');
const SCRAMBLE_LATIN = Array.from('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*?!<>/+=');
export const pickScrambleChars = (text, count, random)=>{
    const pool = [
        ...hasCjk(text) ? SCRAMBLE_KANA : SCRAMBLE_LATIN
    ];
    const picked = [];
    while(picked.length < count && pool.length > 0){
        picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return picked;
};
