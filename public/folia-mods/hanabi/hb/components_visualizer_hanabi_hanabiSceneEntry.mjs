/* 移植自 Folia components/visualizer/hanabi/hanabiSceneEntry.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { hashVisualizerSeed } from './components_visualizer_visualizerSeedHash.mjs';
import { resolveShotProfile, shotLine } from './components_visualizer_hanabi_program.mjs';
import { createHanabiScene } from './components_visualizer_hanabi_scene.mjs';
export const hanabiSpinDirection = (programSeed)=>hashVisualizerSeed(`${programSeed}:spin-direction`) % 2 === 0 ? 1 : -1;
const BLUR_EPSILON = 0.3;
export const buildHanabiSceneEntry = (pixi, context, index)=>{
    const { width, height, program } = context;
    const paragraph = program.paragraphs[index];
    const lineMap = new Map(paragraph.lineIndices.map((lineIndex, k)=>[
            lineIndex,
            paragraph.lines[k]
        ]));
    const shots = paragraph.shots.map((shot)=>({
            id: shot.id,
            profile: resolveShotProfile(shot),
            startTime: shot.startTime,
            endTime: shot.endTime,
            isBridge: shot.isBridge,
            line: shot.isBridge ? null : shotLine(lineMap, shot.slices)
        }));
    if (shots.length === 0) {
        shots.push({
            id: paragraph.id,
            profile: resolveShotProfile({
                kind: ''
            }),
            startTime: paragraph.startTime,
            endTime: paragraph.endTime,
            isBridge: true,
            line: null
        });
    }
    const scene = createHanabiScene(pixi, {
        width,
        height,
        resolution: context.resolution,
        seed: `${program.seed}:${paragraph.id}`,
        theme: context.theme,
        tuning: context.tuning,
        shots,
        startTime: paragraph.startTime,
        endTime: paragraph.endTime,
        textures: context.textures,
        exitStart: paragraph.transitionOut?.startTime ?? null,
        motifs: context.motifs,
        icons: context.icons,
        spinDirection: hanabiSpinDirection(program.seed),
        opening: index === 0 && context.songTitle ? {
            title: context.songTitle,
            artist: context.songArtist
        } : null
    });
    scene.setLayerVisibility({
        graphics: true,
        text: context.showText,
        mid: false
    });
    const holder = new pixi.Container();
    holder.addChild(scene.view);
    holder.pivot.set(width / 2, height / 2);
    holder.position.set(width / 2, height / 2);
    holder.zIndex = index;
    return {
        index,
        scene,
        holder,
        blur: null
    };
};
export const applyHanabiLayerFrame = (pixi, entry, frame, size, blurResolution)=>{
    entry.holder.alpha = frame.alpha;
    entry.holder.scale.set(frame.scale);
    entry.holder.position.set(size.width / 2, size.height / 2 + frame.y * size.height);
    entry.holder.rotation = frame.rotation;
    if (frame.blur > BLUR_EPSILON) {
        if (!entry.blur) {
            entry.blur = new pixi.BlurFilter({
                strength: frame.blur,
                quality: 3,
                resolution: blurResolution
            });
        }
        entry.blur.strength = frame.blur;
        if (!entry.holder.filters?.includes(entry.blur)) {
            entry.holder.filterArea ??= new pixi.Rectangle(-size.width, -size.height, size.width * 3, size.height * 3);
            entry.holder.filters = [
                entry.blur
            ];
        }
    } else if (entry.holder.filters?.length) {
        entry.holder.filters = [];
    }
};
export const destroyHanabiSceneEntry = (entry)=>{
    entry.holder.parent?.removeChild(entry.holder);
    entry.holder.filters = [];
    entry.blur?.destroy();
    entry.blur = null;
    entry.holder.removeChild(entry.scene.view);
    entry.scene.destroy();
    entry.holder.destroy();
};
