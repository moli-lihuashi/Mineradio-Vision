/* 移植自 Folia components/visualizer/hanabi/hanabiProgram.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { buildStructureLines, classifyParagraph, draftParagraphs, resolveParagraphGapThreshold } from './components_visualizer_paragraphStructure.mjs';
import { resolveHanabiChorusSpans } from './components_visualizer_hanabi_hanabiScreenBloom.mjs';
import { chooseHanabiTransition, HANABI_TRANSITIONS } from './components_visualizer_hanabi_hanabiTransitions.mjs';
import { advanceChain, castShot, DEFAULT_HANABI_PARAMS, planShots } from './components_visualizer_hanabi_program.mjs';
const INSTRUMENTAL_DURATION = 480;
const INSTRUMENTAL_PARAGRAPH = 28;
const BRIDGE_SHOT = 7;
const BRIDGE_SPLIT = 10;
const BRIDGE_TAIL = 0.6;
const closeTail = (shots, endTime, params)=>{
    const last = shots.at(-1);
    if (!last || last.isBridge || endTime - last.lyricEndTime < params.bridgeGap) return shots;
    const end = Math.max(last.startTime + 0.05, last.lyricEndTime + BRIDGE_TAIL);
    return [
        ...shots.slice(0, -1),
        {
            ...last,
            endTime: end
        },
        {
            slices: [],
            slot: null,
            startTime: end,
            endTime,
            lyricEndTime: endTime,
            isBridge: true
        }
    ];
};
const splitLongBridges = (shots)=>shots.flatMap((shot)=>{
        const length = shot.endTime - shot.startTime;
        if (!shot.isBridge || length <= BRIDGE_SPLIT) return [
            shot
        ];
        const count = Math.max(2, Math.round(length / BRIDGE_SHOT));
        return Array.from({
            length: count
        }, (_, index)=>{
            const startTime = shot.startTime + length * index / count;
            const endTime = index === count - 1 ? shot.endTime : shot.startTime + length * (index + 1) / count;
            return {
                slices: [],
                slot: null,
                startTime,
                endTime,
                lyricEndTime: endTime,
                isBridge: true
            };
        });
    });
const planLyricParagraphs = (lines, params, duration)=>{
    const structure = buildStructureLines(lines);
    const drafts = draftParagraphs(structure, resolveParagraphGapThreshold(lines));
    const lyricEndTime = Math.max(...structure.map((line)=>line.renderEndTime));
    const programEnd = Math.max(lyricEndTime, duration ?? 0);
    const firstStart = structure[0].line.startTime;
    const plans = [];
    const intro = firstStart >= params.bridgeGap;
    if (intro) plans.push({
        lines: [],
        kind: 'break',
        startTime: 0,
        endTime: firstStart,
        lyricEndTime: firstStart
    });
    drafts.forEach((draft, index)=>{
        const next = drafts[index + 1];
        plans.push({
            lines: draft.lines,
            kind: classifyParagraph(draft.lines, index, drafts.length),
            startTime: index === 0 && !intro ? Math.min(0, firstStart) : draft.lines[0].line.startTime,
            endTime: next ? next.lines[0].line.startTime : programEnd,
            lyricEndTime: draft.lines.at(-1).renderEndTime
        });
    });
    return {
        plans,
        lyricEndTime,
        programEnd
    };
};
const planInstrumentalParagraphs = (duration)=>{
    const count = Math.max(1, Math.round(duration / INSTRUMENTAL_PARAGRAPH));
    return Array.from({
        length: count
    }, (_, index)=>{
        const startTime = duration * index / count;
        const endTime = index === count - 1 ? duration : duration * (index + 1) / count;
        return {
            lines: [],
            kind: 'break',
            startTime,
            endTime,
            lyricEndTime: endTime
        };
    });
};
export const compileHanabiProgram = (lines, seed, params = {}, options = {})=>{
    const resolvedParams = {
        ...DEFAULT_HANABI_PARAMS,
        ...params
    };
    const resolvedSeed = String(seed ?? 'hanabi');
    const instrumental = lines.length === 0;
    const lyric = instrumental ? null : planLyricParagraphs(lines, resolvedParams, options.duration);
    const instrumentalDuration = Math.max(1, options.duration && options.duration > 0 ? options.duration : INSTRUMENTAL_DURATION);
    const plans = lyric ? lyric.plans : planInstrumentalParagraphs(instrumentalDuration);
    const chain = {
        recent: [],
        family: null
    };
    let previousTransition = null;
    const paragraphs = plans.map((plan, index)=>{
        const planned = splitLongBridges(closeTail(planShots(plan.lines, plan.startTime, plan.endTime, resolvedParams), plan.endTime, resolvedParams));
        const shots = planned.map((shot, shotIndex)=>{
            const kind = castShot({
                seed: resolvedSeed,
                paragraphIndex: index,
                shotIndex,
                kind: plan.kind,
                isBridge: shot.isBridge,
                chain
            });
            advanceChain(chain, kind);
            return {
                id: `p${index}-hb${shotIndex}`,
                kind,
                slices: shot.slices,
                startTime: shot.startTime,
                endTime: shot.endTime,
                lyricEndTime: shot.lyricEndTime,
                isBridge: shot.isBridge
            };
        });
        const next = plans[index + 1];
        let transitionOut = null;
        if (next) {
            const kind = chooseHanabiTransition(resolvedSeed, index, previousTransition);
            previousTransition = kind;
            const gap = next.startTime - plan.lyricEndTime;
            transitionOut = {
                kind,
                startTime: Math.max(plan.startTime, plan.endTime - HANABI_TRANSITIONS[kind].duration(gap)),
                endTime: plan.endTime
            };
        }
        const lineIndices = [
            ...new Set(shots.flatMap((shot)=>shot.slices.map((slice)=>slice.lineIndex)))
        ].sort((a, b)=>a - b);
        return {
            id: `hanabi-p${index}`,
            index,
            kind: plan.kind,
            startTime: plan.startTime,
            endTime: plan.endTime,
            lyricEndTime: plan.lyricEndTime,
            lineIndices,
            lines: lineIndices.map((lineIndex)=>lines[lineIndex]),
            shots,
            transitionOut
        };
    });
    return {
        version: 1,
        seed: resolvedSeed,
        instrumental,
        duration: lyric ? lyric.programEnd : instrumentalDuration,
        lyricEndTime: lyric ? lyric.lyricEndTime : null,
        paragraphs,
        chorus: resolveHanabiChorusSpans(lines)
    };
};
export const findHanabiParagraphIndexAtTime = (program, time)=>{
    for(let index = program.paragraphs.length - 1; index >= 0; index -= 1){
        if (time >= program.paragraphs[index].startTime) return index;
    }
    return 0;
};
