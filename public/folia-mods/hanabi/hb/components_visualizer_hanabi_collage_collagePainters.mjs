/* 移植自 Folia components/visualizer/hanabi/collage/collagePainters.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { resolveLucideIconNode } from './_stubs.mjs';
import { lucideIconPath2d } from './components_visualizer_lucidePath2d.mjs';
import { CANDY, CANDY_INK, HANABI_FALLBACK_ICON } from './components_visualizer_hanabi_collage_collagePlan.mjs';
export const POP_FONT_FAMILIES = '"M PLUS Rounded 1c", "Zen Maru Gothic", "Kosugi Maru", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Yu Gothic UI", "Meiryo UI", "Microsoft YaHei UI"';
const css = (color, alpha = 1)=>`rgba(${color >> 16 & 255},${color >> 8 & 255},${color & 255},${alpha})`;
export const STICKER_PX = 112;
const pathHeart = (context, c, r)=>{
    context.moveTo(c, c + r * 0.85);
    context.bezierCurveTo(c - r * 1.25, c + r * 0.05, c - r * 0.95, c - r * 0.95, c, c - r * 0.42);
    context.bezierCurveTo(c + r * 0.95, c - r * 0.95, c + r * 1.25, c + r * 0.05, c, c + r * 0.85);
};
const pathStar = (context, c, r, points, inner, rotation = -Math.PI / 2)=>{
    for(let i = 0; i < points * 2; i += 1){
        const radius = i % 2 === 0 ? r : r * inner;
        const angle = rotation + i * Math.PI / points;
        const x = c + Math.cos(angle) * radius;
        const y = c + Math.sin(angle) * radius;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.closePath();
};
const pathSparkle = (context, c, r)=>{
    const pinch = r * 0.16;
    context.moveTo(c, c - r);
    context.quadraticCurveTo(c + pinch, c - pinch, c + r, c);
    context.quadraticCurveTo(c + pinch, c + pinch, c, c + r);
    context.quadraticCurveTo(c - pinch, c + pinch, c - r, c);
    context.quadraticCurveTo(c - pinch, c - pinch, c, c - r);
    context.closePath();
};
const pathFlower = (context, c, r)=>{
    for(let i = 0; i < 5; i += 1){
        const angle = -Math.PI / 2 + i * Math.PI * 2 / 5;
        context.moveTo(c + Math.cos(angle) * r * 0.55 + r * 0.42, c + Math.sin(angle) * r * 0.55);
        context.arc(c + Math.cos(angle) * r * 0.55, c + Math.sin(angle) * r * 0.55, r * 0.42, 0, Math.PI * 2);
    }
};
const pathCloud = (context, c, r)=>{
    const bumps = [
        [
            -0.5,
            0.15,
            0.38
        ],
        [
            -0.12,
            -0.18,
            0.48
        ],
        [
            0.38,
            -0.02,
            0.42
        ],
        [
            0.62,
            0.25,
            0.28
        ],
        [
            0.05,
            0.3,
            0.4
        ]
    ];
    bumps.forEach(([dx, dy, k])=>{
        context.moveTo(c + dx * r + k * r, c + dy * r);
        context.arc(c + dx * r, c + dy * r, k * r, 0, Math.PI * 2);
    });
};
const pathRibbon = (context, c, r)=>{
    context.moveTo(c, c);
    context.bezierCurveTo(c - r * 0.5, c - r * 0.75, c - r * 1.05, c - r * 0.55, c - r * 0.95, c);
    context.bezierCurveTo(c - r * 1.05, c + r * 0.55, c - r * 0.5, c + r * 0.75, c, c);
    context.bezierCurveTo(c + r * 0.5, c - r * 0.75, c + r * 1.05, c - r * 0.55, c + r * 0.95, c);
    context.bezierCurveTo(c + r * 1.05, c + r * 0.55, c + r * 0.5, c + r * 0.75, c, c);
    context.moveTo(c + r * 0.24, c);
    context.arc(c, c, r * 0.24, 0, Math.PI * 2);
};
const pathCat = (context, c, r)=>{
    context.moveTo(c + r * 0.78, c + r * 0.12);
    context.arc(c, c + r * 0.12, r * 0.78, 0, Math.PI * 2);
    context.moveTo(c - r * 0.72, c - r * 0.2);
    context.lineTo(c - r * 0.62, c - r * 0.95);
    context.lineTo(c - r * 0.12, c - r * 0.6);
    context.closePath();
    context.moveTo(c + r * 0.72, c - r * 0.2);
    context.lineTo(c + r * 0.62, c - r * 0.95);
    context.lineTo(c + r * 0.12, c - r * 0.6);
    context.closePath();
};
const pathBubble = (context, c, r)=>{
    const w = r * 1.0;
    const h = r * 0.72;
    const top = c - h * 0.95;
    const radius = h * 0.55;
    context.roundRect(c - w, top, w * 2, h * 1.6, radius);
    context.moveTo(c - w * 0.35, top + h * 1.55);
    context.lineTo(c - w * 0.62, top + h * 2.15);
    context.lineTo(c - w * 0.02, top + h * 1.55);
    context.closePath();
};
const SHAPE_PATHS = {
    heart: pathHeart,
    star: (context, c, r)=>pathStar(context, c, r, 5, 0.48),
    sparkle: pathSparkle,
    flower: pathFlower,
    cloud: pathCloud,
    ribbon: pathRibbon,
    cat: pathCat,
    bubble: pathBubble
};
const popFont = (px, fallback)=>`800 ${px}px ${POP_FONT_FAMILIES}, ${fallback}`;
export const createCollageTextureCache = (pixi, resolution, fallbackFont)=>{
    const scale = Math.max(1, Math.min(2, resolution || 1));
    const cache = new Map();
    const measureContext = document.createElement('canvas').getContext('2d');
    const canvasOf = (width, height)=>{
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(width * scale));
        canvas.height = Math.max(1, Math.ceil(height * scale));
        const context = canvas.getContext('2d');
        context.setTransform(scale, 0, 0, scale, 0, 0);
        return {
            canvas,
            context
        };
    };
    const finish = (key, canvas)=>{
        const source = new pixi.CanvasSource({
            resource: canvas,
            resolution: scale
        });
        const texture = new pixi.Texture({
            source
        });
        cache.set(key, texture);
        return texture;
    };
    const cached = (key, paint)=>cache.get(key) ?? finish(key, paint());
    const measure = (text, font)=>{
        measureContext.font = font;
        return measureContext.measureText(text).width;
    };
    const sticker = (shape, color, label)=>cached(`sticker:${shape}:${color}:${label ?? ''}`, ()=>{
            const side = STICKER_PX;
            const { canvas, context } = canvasOf(side, side);
            const c = side / 2;
            const r = side * 0.34;
            const path = SHAPE_PATHS[shape];
            context.lineJoin = 'round';
            context.lineCap = 'round';
            context.save();
            context.translate(side * 0.035, side * 0.05);
            context.beginPath();
            path(context, c, r);
            context.lineWidth = side * 0.13;
            context.strokeStyle = 'rgba(30,16,48,0.28)';
            context.fillStyle = 'rgba(30,16,48,0.28)';
            context.stroke();
            context.fill();
            context.restore();
            context.beginPath();
            path(context, c, r);
            context.lineWidth = side * 0.13;
            context.strokeStyle = '#ffffff';
            context.fillStyle = '#ffffff';
            context.stroke();
            context.fill();
            context.beginPath();
            path(context, c, r);
            context.fillStyle = css(color);
            context.fill();
            context.save();
            context.beginPath();
            path(context, c, r);
            context.clip();
            context.fillStyle = 'rgba(255,255,255,0.4)';
            context.beginPath();
            context.ellipse(c - r * 0.35, c - r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
            context.fill();
            context.restore();
            if (shape === 'cat') {
                context.fillStyle = css(0x2b1f3d);
                context.beginPath();
                context.arc(c - r * 0.3, c + r * 0.08, r * 0.08, 0, Math.PI * 2);
                context.arc(c + r * 0.3, c + r * 0.08, r * 0.08, 0, Math.PI * 2);
                context.fill();
                context.strokeStyle = css(0x2b1f3d);
                context.lineWidth = r * 0.07;
                context.beginPath();
                context.arc(c - r * 0.09, c + r * 0.28, r * 0.09, 0.1, Math.PI - 0.1);
                context.arc(c + r * 0.09, c + r * 0.28, r * 0.09, 0.1, Math.PI - 0.1);
                context.stroke();
                context.fillStyle = 'rgba(255,120,160,0.55)';
                context.beginPath();
                context.ellipse(c - r * 0.5, c + r * 0.3, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
                context.ellipse(c + r * 0.5, c + r * 0.3, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
                context.fill();
            }
            if (label) {
                let px = r * 0.62;
                const font = ()=>popFont(px, fallbackFont);
                while(px > 8 && measure(label, font()) > r * 1.7)px -= 1;
                context.font = font();
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillStyle = css(0x2b1f3d);
                context.fillText(label, c, c - r * 0.08);
            }
            return canvas;
        });
    const tape = (color, pattern)=>cached(`tape:${color}:${pattern}`, ()=>{
            const length = 160;
            const width = 48;
            const { canvas, context } = canvasOf(length, width);
            const tooth = 6;
            context.beginPath();
            context.moveTo(0, 0);
            for(let y = 0; y <= width; y += tooth)context.lineTo(y % (tooth * 2) === 0 ? 0 : tooth * 0.7, y);
            context.lineTo(length, width);
            for(let y = width; y >= 0; y -= tooth)context.lineTo(y % (tooth * 2) === 0 ? length : length - tooth * 0.7, y);
            context.closePath();
            context.fillStyle = css(color, 0.78);
            context.fill();
            context.save();
            context.clip();
            if (pattern === 'stripe') {
                context.strokeStyle = 'rgba(255,255,255,0.55)';
                context.lineWidth = 7;
                for(let x = -width; x < length + width; x += 18){
                    context.beginPath();
                    context.moveTo(x, width);
                    context.lineTo(x + width, 0);
                    context.stroke();
                }
            } else if (pattern === 'dot') {
                context.fillStyle = 'rgba(255,255,255,0.65)';
                for(let y = 8; y < width; y += 16){
                    for(let x = y / 16 % 2 === 0 ? 8 : 16; x < length; x += 16){
                        context.beginPath();
                        context.arc(x, y, 3.2, 0, Math.PI * 2);
                        context.fill();
                    }
                }
            } else {
                context.fillStyle = 'rgba(255,255,255,0.38)';
                for(let y = 0; y < width; y += 12){
                    for(let x = y / 12 % 2 === 0 ? 0 : 12; x < length; x += 24)context.fillRect(x, y, 12, 12);
                }
            }
            context.restore();
            return canvas;
        });
    const pattern = (kind)=>cached(`pattern:${kind}`, ()=>{
            const tile = 24;
            const { canvas, context } = canvasOf(tile, tile);
            context.fillStyle = '#ffffff';
            context.strokeStyle = '#ffffff';
            if (kind === 'grid') {
                context.lineWidth = 1.2;
                context.beginPath();
                context.moveTo(0, 0.6);
                context.lineTo(tile, 0.6);
                context.moveTo(0.6, 0);
                context.lineTo(0.6, tile);
                context.stroke();
            } else if (kind === 'dots') {
                context.beginPath();
                context.arc(tile / 4, tile / 4, 2.4, 0, Math.PI * 2);
                context.arc(tile * 3 / 4, tile * 3 / 4, 2.4, 0, Math.PI * 2);
                context.fill();
            } else {
                context.globalAlpha = 0.55;
                context.fillRect(0, 0, tile / 2, tile);
                context.fillRect(0, 0, tile, tile / 2);
            }
            return canvas;
        });
    const paintFilm = (color, height)=>{
        const frame = height * 1.18;
        const width = Math.round(frame * 3);
        const { canvas, context } = canvasOf(width, height);
        context.fillStyle = css(CANDY_INK, 0.92);
        context.fillRect(0, 0, width, height);
        const pitch = frame / 4;
        const holeW = pitch * 0.48;
        const holeH = height * 0.11;
        context.save();
        context.globalCompositeOperation = 'destination-out';
        for(let k = 0; k < 12; k += 1){
            const x = k * pitch + (pitch - holeW) / 2;
            [
                height * 0.07,
                height * 0.93 - holeH
            ].forEach((y)=>{
                context.beginPath();
                context.roundRect(x, y, holeW, holeH, holeH * 0.3);
                context.fill();
            });
        }
        context.restore();
        const base = Math.max(0, CANDY.indexOf(color));
        const colors = [
            color,
            CANDY[(base + 2) % CANDY.length],
            CANDY[(base + 4) % CANDY.length]
        ];
        const icons = [
            'heart',
            'star',
            'sparkle'
        ];
        for(let k = 0; k < 3; k += 1){
            const x = k * frame + frame * 0.07;
            const y = height * 0.25;
            const w = frame * 0.86;
            const h = height * 0.5;
            context.fillStyle = css(colors[k], 0.92);
            context.beginPath();
            context.roundRect(x, y, w, h, h * 0.12);
            context.fill();
            context.fillStyle = 'rgba(255,255,255,0.28)';
            context.beginPath();
            context.roundRect(x + w * 0.06, y + h * 0.1, w * 0.4, h * 0.16, h * 0.08);
            context.fill();
            context.fillStyle = 'rgba(255,255,255,0.9)';
            context.save();
            context.beginPath();
            context.translate(x + w / 2, y + h / 2);
            SHAPE_PATHS[icons[k]](context, 0, h * 0.24);
            context.fill();
            context.restore();
        }
        return canvas;
    };
    const paintCut = (color, height)=>{
        const period = Math.max(10, height * 0.9);
        const { canvas, context } = canvasOf(period, height);
        const line = Math.max(2, height * 0.11);
        const dash = period * 0.55;
        context.lineCap = 'round';
        context.lineWidth = line;
        context.strokeStyle = 'rgba(30,16,48,0.35)';
        context.beginPath();
        context.moveTo(line, height / 2 + line * 0.6);
        context.lineTo(line + dash - line, height / 2 + line * 0.6);
        context.stroke();
        context.strokeStyle = css(color);
        context.beginPath();
        context.moveTo(line, height / 2);
        context.lineTo(line + dash - line, height / 2);
        context.stroke();
        return canvas;
    };
    const paintLace = (color, height)=>{
        const scallop = Math.max(3, height * 0.21);
        const width = scallop * 4;
        const { canvas, context } = canvasOf(width, height);
        const top = height * 0.25;
        const bottom = height * 0.75;
        const centers = [
            scallop,
            scallop * 3
        ];
        const shape = (dy)=>{
            context.beginPath();
            context.rect(0, top + dy, width, bottom - top);
            centers.forEach((cx)=>{
                context.moveTo(cx + scallop, top + dy);
                context.arc(cx, top + dy, scallop, 0, Math.PI, true);
                context.moveTo(cx - scallop, bottom + dy);
                context.arc(cx, bottom + dy, scallop, Math.PI, 0, true);
            });
        };
        context.fillStyle = 'rgba(30,16,48,0.22)';
        shape(height * 0.05);
        context.fill();
        context.fillStyle = 'rgba(255,255,255,0.96)';
        shape(0);
        context.fill();
        context.save();
        context.globalCompositeOperation = 'destination-out';
        centers.forEach((cx)=>{
            [
                [
                    top - scallop * 0.45,
                    scallop * 0.3
                ],
                [
                    bottom + scallop * 0.45,
                    scallop * 0.3
                ],
                [
                    top + height * 0.075,
                    height * 0.035
                ],
                [
                    bottom - height * 0.075,
                    height * 0.035
                ]
            ].forEach(([y, radius])=>{
                context.beginPath();
                context.arc(cx, y, Math.max(0.8, radius), 0, Math.PI * 2);
                context.fill();
            });
        });
        context.restore();
        const ribbonTop = height * 0.4;
        const ribbonHeight = height * 0.2;
        context.fillStyle = css(color);
        context.fillRect(0, ribbonTop, width, ribbonHeight);
        context.fillStyle = 'rgba(255,255,255,0.45)';
        context.fillRect(0, ribbonTop + ribbonHeight * 0.18, width, Math.max(1, ribbonHeight * 0.16));
        context.fillStyle = 'rgba(43,31,61,0.16)';
        context.fillRect(0, ribbonTop + ribbonHeight * 0.86, width, Math.max(1, ribbonHeight * 0.14));
        return canvas;
    };
    const strip = (style, color, thickness)=>{
        const height = Math.max(10, Math.round(thickness));
        return cached(`strip:${style}:${color}:${height}`, ()=>style === 'film' ? paintFilm(color, height) : style === 'cut' ? paintCut(color, height) : paintLace(color, height));
    };
    const scissors = (thickness)=>{
        const side = Math.max(20, Math.round(thickness * 2.3));
        return cached(`scissors:${side}`, ()=>{
            const { canvas, context } = canvasOf(side, side);
            const c = side / 2;
            const ring = side * 0.15;
            context.lineJoin = 'round';
            context.lineCap = 'round';
            const outline = (path, fill)=>{
                context.beginPath();
                path();
                context.lineWidth = side * 0.09;
                context.strokeStyle = css(CANDY_INK);
                context.stroke();
                context.fillStyle = fill;
                context.fill();
            };
            [
                -1,
                1
            ].forEach((dir)=>outline(()=>{
                    context.moveTo(c - side * 0.12, c + dir * side * 0.1);
                    context.quadraticCurveTo(c + side * 0.15, c - dir * side * 0.02, c + side * 0.46, c - dir * side * 0.06);
                    context.quadraticCurveTo(c + side * 0.12, c + dir * side * 0.08, c - side * 0.12, c + dir * side * 0.16);
                    context.closePath();
                }, '#ffffff'));
            [
                -1,
                1
            ].forEach((dir)=>{
                context.beginPath();
                context.arc(c - side * 0.28, c + dir * side * 0.2, ring, 0, Math.PI * 2);
                context.lineWidth = side * 0.1;
                context.strokeStyle = css(CANDY_INK);
                context.stroke();
                context.lineWidth = side * 0.06;
                context.strokeStyle = css(CANDY[0]);
                context.stroke();
            });
            context.beginPath();
            context.arc(c - side * 0.06, c, side * 0.04, 0, Math.PI * 2);
            context.fillStyle = css(CANDY_INK);
            context.fill();
            return canvas;
        });
    };
    const echo = (text, color, size, axis)=>{
        const px = Math.max(10, Math.round(size));
        return cached(`echo:${text}:${color}:${px}:${axis}`, ()=>{
            const font = popFont(px, fallbackFont);
            const textWidth = measure(text, font);
            const gapX = axis === 'x' ? px * 0.6 : px * 0.2;
            const width = Math.ceil(textWidth + gapX * 2);
            const height = Math.ceil(px * (axis === 'x' ? 1.25 : 1.3));
            const { canvas, context } = canvasOf(width, height);
            context.font = font;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.lineJoin = 'round';
            context.lineWidth = Math.max(1.5, px * 0.045);
            context.strokeStyle = css(color);
            context.strokeText(text, width / 2, height * 0.52);
            return canvas;
        });
    };
    const icon = (name, color, size)=>{
        const node = resolveLucideIconNode(name) ?? resolveLucideIconNode(HANABI_FALLBACK_ICON);
        const side = Math.max(16, Math.round(size));
        return cached(`icon:${node ? name : '-'}:${color}:${side}`, ()=>{
            const { canvas, context } = canvasOf(side, side);
            const pad = side * 0.16;
            const scale = (side - pad * 2) / 24;
            context.translate(pad, pad);
            context.scale(scale, scale);
            context.lineJoin = 'round';
            context.lineCap = 'round';
            const path = node ? lucideIconPath2d(node) : null;
            const draw = (stroke, width, dx = 0, dy = 0)=>{
                context.save();
                context.translate(dx, dy);
                context.strokeStyle = stroke;
                context.lineWidth = width;
                if (path) context.stroke(path);
                else {
                    context.beginPath();
                    SHAPE_PATHS.flower(context, 12, 8);
                    context.stroke();
                }
                context.restore();
            };
            draw('rgba(30,16,48,0.3)', 7.2, 0.7, 1);
            draw('#ffffff', 7.2);
            draw(css(color), 2.8);
            return canvas;
        });
    };
    const sound = (text, color, size)=>{
        const px = Math.max(12, Math.round(size));
        return cached(`sound:${text}:${color}:${px}`, ()=>{
            const font = popFont(px, fallbackFont);
            const stroke = px * 0.2;
            const shadow = px * 0.09;
            const width = Math.ceil(measure(text, font) + stroke * 2 + shadow + px * 0.2);
            const height = Math.ceil(px * 1.35 + stroke * 2 + shadow);
            const { canvas, context } = canvasOf(width, height);
            const x = width / 2 - shadow / 2;
            const y = height / 2 - shadow / 2;
            context.font = font;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.lineJoin = 'round';
            context.lineWidth = stroke * 2;
            context.strokeStyle = 'rgba(43,31,61,0.9)';
            context.strokeText(text, x + shadow, y + shadow);
            context.strokeStyle = '#ffffff';
            context.strokeText(text, x, y);
            context.fillStyle = css(color);
            context.fillText(text, x, y);
            context.lineWidth = Math.max(1, px * 0.04);
            context.strokeStyle = 'rgba(43,31,61,0.85)';
            context.strokeText(text, x, y);
            return canvas;
        });
    };
    const label = (text, color, size)=>{
        const px = Math.max(10, Math.round(size));
        return cached(`label:${text}:${color}:${px}`, ()=>{
            const font = popFont(px, fallbackFont);
            const padX = px * 0.7;
            const height = Math.ceil(px * 1.7);
            const width = Math.ceil(measure(text, font) + padX * 2);
            const { canvas, context } = canvasOf(width + 4, height + 4);
            context.fillStyle = 'rgba(43,31,61,0.85)';
            context.beginPath();
            context.roundRect(3, 3, width, height, height / 2);
            context.fill();
            context.fillStyle = '#ffffff';
            context.beginPath();
            context.roundRect(0, 0, width, height, height / 2);
            context.fill();
            context.fillStyle = css(color);
            context.beginPath();
            context.roundRect(2, 2, width - 4, height - 4, (height - 4) / 2);
            context.fill();
            context.font = font;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillStyle = css(0x2b1f3d);
            context.fillText(text, width / 2, height * 0.54);
            return canvas;
        });
    };
    return {
        sticker,
        tape,
        pattern,
        strip,
        scissors,
        echo,
        sound,
        icon,
        label,
        destroy: ()=>{
            cache.forEach((texture)=>texture.destroy(true));
            cache.clear();
        }
    };
};
