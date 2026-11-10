/* 移植自 Folia components/visualizer/hanabi/hanabiTransitions.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { easeSeptic } from './components_visualizer_hanabi_timeline.mjs';
export const HANABI_TRANSITION_KINDS = [
    'ascend',
    'flash',
    'bloom'
];
const ease = easeSeptic;
const launch = (p)=>p <= 0 ? 0 : p >= 1 ? 1 + 2 * (p - 1) : p * p * p * (2 - p);
const frame = (partial)=>({
        alpha: 1,
        scale: 1,
        blur: 0,
        y: 0,
        rotation: 0,
        ...partial
    });
const resolveFrame = (kind, phase, progress)=>{
    const p = Math.max(0, phase === 'exit' ? progress : Math.min(1, progress));
    if (kind === 'ascend') {
        if (phase === 'exit') {
            const e = launch(p);
            return frame({
                y: 0.32 * e,
                blur: 10 * Math.min(e, 1),
                alpha: 1 - 0.7 * ease((p - 0.5) / 0.5),
                rotation: 0.55 * e
            });
        }
        const k = launch(1 - p);
        return frame({
            y: -0.26 * k,
            blur: 10 * k,
            alpha: 1 - 0.7 * k,
            rotation: -0.5 * k
        });
    }
    if (kind === 'flash') {
        const near = phase === 'exit' ? ease(p) : 1 - ease(p);
        return frame({
            scale: 1 + 0.05 * near,
            blur: 9 * near * near,
            alpha: 1 - 0.55 * near * near,
            rotation: (phase === 'exit' ? 0.12 : -0.12) * near
        });
    }
    if (phase === 'exit') {
        const e = ease(p);
        return frame({
            scale: 1 + 0.18 * e,
            blur: 5 * e,
            alpha: 1 - e,
            rotation: 0.3 * e
        });
    }
    const k = 1 - ease(p);
    return frame({
        scale: 1 - 0.08 * k,
        blur: 4 * k,
        alpha: 1 - k,
        rotation: -0.25 * k
    });
};
export const HANABI_TRANSITIONS = Object.fromEntries(HANABI_TRANSITION_KINDS.map((kind)=>[
        kind,
        {
            kind,
            duration: (gap)=>kind === 'flash' ? Math.min(0.5, Math.max(0.28, gap > 0 ? gap * 0.4 : 0.35)) : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8)),
            enterClamp: kind === 'flash' ? [
                0.2,
                0.45
            ] : [
                0.4,
                0.9
            ],
            resolveFrame: (phase, progress)=>resolveFrame(kind, phase, progress)
        }
    ]));
export const resolveHanabiEnterDuration = (kind, startTime, endTime)=>{
    const [min, max] = HANABI_TRANSITIONS[kind].enterClamp;
    return Math.max(min, Math.min(max, endTime - startTime));
};
export const chooseHanabiTransition = (seed, paragraphIndex, previous)=>{
    let hash = 0;
    for (const char of `${seed}:${paragraphIndex}:hanabi-transition`)hash = hash * 31 + char.charCodeAt(0) | 0;
    const roll = Math.abs(hash);
    if (previous !== 'ascend' && roll % 2 === 0) return 'ascend';
    const choices = HANABI_TRANSITION_KINDS.filter((kind)=>kind !== previous && kind !== 'ascend');
    return choices[(roll >> 1) % choices.length];
};
