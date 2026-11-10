/* 移植自 Folia components/visualizer/hanabi/collage/unitCollage.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
import { CANDY } from './components_visualizer_hanabi_collage_collagePlan.mjs';
const paintDotTile = (scale)=>{
    const tile = 26;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(tile * scale);
    canvas.height = Math.ceil(tile * scale);
    const context = canvas.getContext('2d');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(tile / 4, tile / 4, 1.6, 0, Math.PI * 2);
    context.arc(tile * 3 / 4, tile * 3 / 4, 1.6, 0, Math.PI * 2);
    context.fill();
    return canvas;
};
export const createUnitCollage = (pixi, options)=>{
    const { width, height, amount } = options;
    const unit = Math.min(width, height);
    const random = createRng(`${options.seed}:unit-collage`);
    const back = new pixi.Container();
    const front = new pixi.Container();
    const scale = Math.max(1, Math.min(2, options.resolution || 1));
    const dotTexture = new pixi.Texture({
        source: new pixi.CanvasSource({
            resource: paintDotTile(scale),
            resolution: scale
        })
    });
    const dots = new pixi.TilingSprite({
        texture: dotTexture,
        width: width * 1.2,
        height: height * 1.2
    });
    dots.position.set(-width * 0.1, -height * 0.1);
    dots.tint = options.paper;
    dots.alpha = 0.05 + 0.03 * Math.min(1, amount);
    back.addChild(dots);
    const thickness = Math.max(20, unit * 0.055);
    const rail = new pixi.TilingSprite({
        texture: options.cache.strip('film', CANDY[Math.floor(random() * CANDY.length)], thickness),
        width: height * 1.3,
        height: thickness
    });
    rail.anchor.set(0.5);
    rail.rotation = -Math.PI / 2;
    rail.position.set(Math.max(thickness * 0.9, width * 0.022), height / 2);
    rail.alpha = 0.92;
    front.addChild(rail);
    const tile = rail.texture.width || 1;
    const drift = unit * 0.03;
    return {
        back,
        front,
        update: (time, rise)=>{
            dots.tilePosition.y = rise * 0.35;
            rail.tilePosition.x = (-(rise + drift * (time - options.startTime)) % tile + tile) % tile;
        },
        destroy: ()=>{
            back.destroy({
                children: true
            });
            front.destroy({
                children: true
            });
            dotTexture.destroy(true);
        }
    };
};
