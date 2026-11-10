/* 移植自 Folia components/visualizer/hanabi/overlay.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { resolveThemeFontStack, resolveThemeFontWeight } from './_stubs.mjs';
import { resolveHanabiPalette } from './components_visualizer_hanabi_color.mjs';
export const buildHanabiOverlay = (pixi, width, height, theme, colorMode, resolution = 1)=>{
    const container = new pixi.Container();
    const palette = resolveHanabiPalette('kawaii', theme, colorMode);
    const unit = Math.min(width, height);
    const padX = Math.max(width * 0.07, unit * 0.06);
    const padY = Math.max(height * 0.08, unit * 0.06);
    const line = Math.max(1.2, unit / 640);
    const font = resolveThemeFontStack(theme);
    const weight = String(resolveThemeFontWeight(theme, 700));
    const g = new pixi.Graphics();
    const seal = unit * 0.024;
    const sealX = padX + seal;
    const sealY = padY + seal;
    g.circle(sealX, sealY, seal).fill({
        color: palette.blocks[0],
        alpha: 0.85
    });
    g.circle(sealX, sealY, seal * 1.28).stroke({
        color: palette.blocks[0],
        width: line,
        alpha: 0.5
    });
    const sealText = new pixi.Text({
        text: '花火',
        style: new pixi.TextStyle({
            fontFamily: font,
            fontWeight: weight,
            fontSize: seal * 0.66,
            fill: palette.ink,
            letterSpacing: -seal * 0.04
        }),
        resolution
    });
    sealText.anchor.set(0.5);
    sealText.position.set(sealX, sealY);
    const letterSize = unit * 0.017;
    const letters = Array.from('HANABI').map((char, i)=>{
        const label = new pixi.Text({
            text: char,
            style: new pixi.TextStyle({
                fontFamily: font,
                fontWeight: weight,
                fontSize: letterSize,
                fill: palette.paper
            }),
            resolution
        });
        label.anchor.set(0.5);
        label.alpha = 0.55;
        label.position.set(width - padX, padY + letterSize * (0.6 + i * 1.5));
        return label;
    });
    const stemTop = padY + letterSize * (0.6 + 6 * 1.5);
    g.moveTo(width - padX, stemTop).lineTo(width - padX, stemTop + unit * 0.08).stroke({
        color: palette.paper,
        width: line,
        alpha: 0.35
    });
    const dotY = height - padY;
    palette.sparks.slice(0, 3).forEach((color, i)=>{
        g.circle(padX + i * unit * 0.018, dotY, unit * 0.0055).fill({
            color,
            alpha: 0.85
        });
    });
    g.moveTo(padX + unit * 0.05, dotY).lineTo(padX + unit * 0.16, dotY).stroke({
        color: palette.paper,
        width: line,
        alpha: 0.35
    });
    const arm = unit * 0.035;
    g.moveTo(width - padX - arm, height - padY).lineTo(width - padX, height - padY).lineTo(width - padX, height - padY - arm).stroke({
        color: palette.accent,
        width: line * 1.4,
        alpha: 0.6
    });
    container.addChild(g, sealText, ...letters);
    return container;
};
