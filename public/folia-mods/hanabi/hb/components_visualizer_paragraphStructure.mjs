/* 移植自 Folia components/visualizer/paragraphStructure.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { getLineRenderEndTime } from './utils_lyrics_renderHints.mjs';
import { segmentLyricWords } from './utils_lyrics_wordSegmentation.mjs';
export const DEFAULT_PARAGRAPH_STRUCTURE_PARAMS = {
    gapMultiplier: 2.5,
    gapMin: 1.25,
    gapMax: 3.5,
    maxLines: 6,
    maxDuration: 18,
    recursiveSplit: true
};
const clamp = (value, min, max)=>Math.min(max, Math.max(min, value));
const median = (values)=>{
    if (values.length === 0) return 0.5;
    const sorted = [
        ...values
    ].sort((a, b)=>a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? sorted[middle]) + sorted[middle]) / 2 : sorted[middle];
};
export const buildStructureLines = (lines)=>lines.map((line, sourceIndex)=>({
            sourceIndex,
            line,
            renderEndTime: Math.max(line.startTime, Math.min(getLineRenderEndTime(line), lines[sourceIndex + 1]?.startTime ?? Number.POSITIVE_INFINITY))
        }));
export const resolveParagraphGapThreshold = (lines, params = DEFAULT_PARAGRAPH_STRUCTURE_PARAMS)=>{
    const gaps = lines.slice(1).map((line, index)=>line.startTime - Math.min(getLineRenderEndTime(lines[index]), line.startTime)).filter((gap)=>gap > 0);
    return clamp(median(gaps) * params.gapMultiplier, params.gapMin, params.gapMax);
};
export const metadataChanged = (previous, next)=>previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex || previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart;
export const splitOversizedDraft = (draft, params)=>{
    const output = [];
    let remaining = draft.lines;
    let boundary = draft.boundary;
    let loopGuard = 0;
    while(remaining.length > params.maxLines || remaining.length > 1 && remaining.at(-1).renderEndTime - remaining[0].line.startTime > params.maxDuration){
        if (loopGuard++ > 1000) break;
        const candidates = remaining.slice(2, -1).map((line, offset)=>({
                splitIndex: offset + 2,
                gap: line.line.startTime - remaining[offset + 1].renderEndTime
            }));
        const validCandidates = candidates.filter((candidate)=>!Number.isNaN(candidate.gap));
        const rawSplitIndex = validCandidates.sort((a, b)=>b.gap - a.gap)[0]?.splitIndex ?? Math.min(4, remaining.length - 1);
        const splitIndex = Math.max(1, rawSplitIndex);
        const head = {
            lines: remaining.slice(0, splitIndex),
            boundary
        };
        output.push(...params.recursiveSplit ? splitOversizedDraft(head, params) : [
            head
        ]);
        remaining = remaining.slice(splitIndex);
        boundary = output.at(-1).lines.length >= params.maxLines ? 'line-cap' : 'duration-cap';
    }
    output.push({
        lines: remaining,
        boundary
    });
    return output;
};
export const draftParagraphs = (lines, threshold, params = DEFAULT_PARAGRAPH_STRUCTURE_PARAMS)=>{
    const drafts = [];
    let current = {
        lines: [],
        boundary: 'song-start'
    };
    lines.forEach((line, index)=>{
        const previous = lines[index - 1];
        const gap = previous ? line.line.startTime - previous.renderEndTime : 0;
        const boundary = previous && metadataChanged(previous.line, line.line) ? 'metadata' : previous && gap >= threshold ? 'time-gap' : null;
        if (boundary && current.lines.length > 0) {
            drafts.push(...splitOversizedDraft(current, params));
            current = {
                lines: [],
                boundary
            };
        }
        current.lines.push(line);
    });
    if (current.lines.length > 0) drafts.push(...splitOversizedDraft(current, params));
    return drafts;
};
export const countWordLike = (line)=>segmentLyricWords(line).filter((part)=>part.isWordLike).length;
export const classifyParagraph = (lines, index, total)=>{
    if (lines.some((item)=>item.line.isChorus || /chorus|副歌/i.test(item.line.songPart ?? ''))) return 'chorus';
    if (lines.some((item)=>/bridge|break|間奏|ブリッジ/i.test(item.line.songPart ?? ''))) return 'break';
    if (index === total - 1) return 'outro';
    const duration = lines.at(-1).renderEndTime - lines[0].line.startTime;
    const segmentCount = lines.reduce((sum, line)=>sum + countWordLike(line.line), 0);
    const punctuationCount = lines.reduce((sum, line)=>sum + (line.line.fullText.match(/[!?！？…]/g)?.length ?? 0), 0);
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
};
