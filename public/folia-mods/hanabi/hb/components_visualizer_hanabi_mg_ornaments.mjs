/* 移植自 Folia components/visualizer/hanabi/mg/ornaments.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createKit } from './components_visualizer_hanabi_mg_ornamentKit.mjs';
import { dotsLineOrnament, underlineOrnament, waveOrnament, zigzagOrnament } from './components_visualizer_hanabi_mg_ornamentLines.mjs';
import { chevronsOrnament, confettiOrnament, crossOrnament, glintsOrnament, petalsOrnament, shardsOrnament, sparkleOrnament, streaksOrnament } from './components_visualizer_hanabi_mg_ornamentParticles.mjs';
import { bracketsOrnament, dashCircleOrnament, halftoneOrnament, orbitOrnament, raysOrnament, ringOrnament, spokesOrnament, squaresOrnament, stampOrnament } from './components_visualizer_hanabi_mg_ornamentShapes.mjs';
export const ORNAMENT_BUILDERS = {
    ring: ringOrnament,
    spokes: spokesOrnament,
    sparkle: sparkleOrnament,
    orbit: orbitOrnament,
    chevrons: chevronsOrnament,
    brackets: bracketsOrnament,
    cross: crossOrnament,
    zigzag: zigzagOrnament,
    wave: waveOrnament,
    halftone: halftoneOrnament,
    confetti: confettiOrnament,
    shards: shardsOrnament,
    'dash-circle': dashCircleOrnament,
    squares: squaresOrnament,
    streaks: streaksOrnament,
    petals: petalsOrnament,
    stamp: stampOrnament,
    rays: raysOrnament,
    underline: underlineOrnament,
    'dots-line': dotsLineOrnament,
    glints: glintsOrnament
};
export const createOrnament = (spec, context)=>{
    const kit = createKit(spec, context);
    const empty = context.amount <= 0;
    const draw = empty ? null : ORNAMENT_BUILDERS[spec.kind](kit);
    const firstSung = kit.glyphs.reduce((min, glyph)=>Math.min(min, glyph.sungAt), Number.POSITIVE_INFINITY);
    const from = Math.min(kit.start, firstSung) - 0.05;
    const update = (time)=>{
        const visible = draw !== null && time >= from && time <= kit.end;
        kit.view.visible = visible;
        if (visible) draw(time);
    };
    return {
        view: kit.view,
        update,
        destroy: ()=>kit.view.destroy({
                children: true,
                context: true
            })
    };
};
