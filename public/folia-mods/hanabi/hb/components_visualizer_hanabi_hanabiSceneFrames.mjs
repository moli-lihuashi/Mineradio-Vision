/* 移植自 Folia components/visualizer/hanabi/hanabiSceneFrames.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { findHanabiParagraphIndexAtTime } from './components_visualizer_hanabi_hanabiProgram.mjs';
import { HANABI_TRANSITIONS, resolveHanabiEnterDuration } from './components_visualizer_hanabi_hanabiTransitions.mjs';
const IDLE = {
    alpha: 1,
    scale: 1,
    blur: 0,
    y: 0,
    rotation: 0
};
const smooth = (value)=>{
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};
const exitFrameOf = (program, index, time, beyondBoundary = false)=>{
    const out = program.paragraphs[index]?.transitionOut;
    if (!out || time < out.startTime) return IDLE;
    const progress = (time - out.startTime) / Math.max(out.endTime - out.startTime, 1e-3);
    return HANABI_TRANSITIONS[out.kind].resolveFrame('exit', beyondBoundary ? progress : Math.min(progress, 1));
};
export const resolveHanabiSceneFrames = (program, time, transitionsEnabled)=>{
    if (program.paragraphs.length === 0) return {
        activeIndex: -1,
        layers: []
    };
    const activeIndex = findHanabiParagraphIndexAtTime(program, time);
    if (!transitionsEnabled) return {
        activeIndex,
        layers: [
            {
                index: activeIndex,
                ...IDLE
            }
        ]
    };
    const paragraph = program.paragraphs[activeIndex];
    const current = exitFrameOf(program, activeIndex, time);
    const layers = [];
    const previousOut = activeIndex > 0 ? program.paragraphs[activeIndex - 1].transitionOut : null;
    if (previousOut) {
        const enterDuration = resolveHanabiEnterDuration(previousOut.kind, previousOut.startTime, previousOut.endTime);
        const progress = (time - paragraph.startTime) / enterDuration;
        if (progress >= 0 && progress < 1) {
            const enter = HANABI_TRANSITIONS[previousOut.kind].resolveFrame('enter', progress);
            const weight = smooth(progress);
            const leaving = exitFrameOf(program, activeIndex - 1, time, true);
            if (leaving.alpha * (1 - weight) > 0.002) {
                layers.push({
                    index: activeIndex - 1,
                    ...leaving,
                    alpha: leaving.alpha * (1 - weight)
                });
            }
            layers.push({
                index: activeIndex,
                alpha: Math.min(enter.alpha, weight) * current.alpha,
                scale: enter.scale * current.scale,
                blur: Math.max(enter.blur, current.blur),
                y: enter.y + current.y,
                rotation: enter.rotation + current.rotation
            });
            return {
                activeIndex,
                layers
            };
        }
    }
    layers.push({
        index: activeIndex,
        ...current
    });
    return {
        activeIndex,
        layers
    };
};
