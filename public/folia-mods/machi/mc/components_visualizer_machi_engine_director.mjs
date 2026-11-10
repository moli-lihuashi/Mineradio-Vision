/* 移植自 Folia components/visualizer/machi/engine/director.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { isInterludeLine } from './_stubs.mjs';
import { getLineRenderEndTime } from './utils_lyrics_renderHints.mjs';
import { hashVisualizerSeed, visualizerHash01 } from './components_visualizer_visualizerSeedHash.mjs';
const BOARD_HOLD_SECONDS = 2.6;
const BOARD_LEAD_SECONDS = 0.12;
export const resolveMachiBoardTarget = (lines, time)=>{
    let index = -1;
    for(let i = 0; i < lines.length; i += 1){
        if (lines[i].startTime <= time + BOARD_LEAD_SECONDS) index = i;
        else break;
    }
    if (index < 0) return {
        kind: 'card'
    };
    const line = lines[index];
    if (isInterludeLine(line) || !line.fullText.trim()) return {
        kind: 'card'
    };
    const next = lines[index + 1];
    const hold = getLineRenderEndTime(line) + BOARD_HOLD_SECONDS;
    if (time > hold && (!next || next.startTime - BOARD_LEAD_SECONDS > time)) return {
        kind: 'card'
    };
    return {
        kind: 'line',
        index
    };
};
export const sameBoardTarget = (a, b)=>!!a && a.kind === b.kind && (a.kind === 'card' || b.kind === 'line' && a.index === b.index);
export const isChorusLine = (line)=>!!line && (line.isChorus === true || /chorus|副歌/i.test(line.songPart ?? ''));
export const resolveMachiChorus = (lines, target)=>{
    if (target.kind !== 'line') return 0;
    return isChorusLine(lines[target.index]) ? 1 : 0;
};
export const resolveMachiFlicker = (time, seed, rate = 1)=>{
    const window = 6.5 / Math.max(0.3, rate);
    const index = Math.floor(time / window);
    const key = hashVisualizerSeed(`flicker:${seed}`);
    if (visualizerHash01(key, index, 0x51) > 0.42) return 1;
    const offset = visualizerHash01(key, index, 0x7a) * (window - 0.6);
    const local = time - index * window - offset;
    if (local < 0 || local > 0.46) return 1;
    const dips = [
        [
            0,
            0.07,
            0.5
        ],
        [
            0.15,
            0.2,
            0.68
        ],
        [
            0.32,
            0.36,
            0.8
        ]
    ];
    for (const [from, to, depth] of dips){
        if (local >= from && local <= to) return depth;
    }
    return 1;
};
export class MachiAudioFollower {
    value = 0;
    byteScale = false;
    step(raw, deltaSeconds, attack = 0.06, release = 0.25) {
        if (raw > 1.0001) this.byteScale = true;
        const target = Math.max(0, Math.min(1, this.byteScale ? raw / 255 : raw));
        const tau = target > this.value ? attack : release;
        const k = deltaSeconds <= 0 ? 0 : 1 - Math.exp(-deltaSeconds / tau);
        this.value += (target - this.value) * k;
        return this.value;
    }
}
export const buildMachiLightningTimes = (lines)=>lines.filter((line, index)=>isChorusLine(line) && !isChorusLine(lines[index - 1])).map((line)=>line.startTime);
export const resolveMachiLightning = (times, time)=>{
    let since = Infinity;
    for(let index = times.length - 1; index >= 0; index -= 1){
        if (times[index] <= time) {
            since = time - times[index];
            break;
        }
    }
    if (since > 1.2) return 0;
    const flash = (at, width, height)=>height * Math.exp(-((since - at) ** 2) / (width * width));
    return Math.min(1, flash(0.04, 0.05, 1) + flash(0.24, 0.06, 0.7) + 0.25 * Math.exp(-since * 3.5));
};
export const resolveMachiTickerText = (target, lines, song, fallbackTitle)=>{
    const title = song.title || fallbackTitle;
    if (target.kind === 'card') return `♪ ${title}${song.artist ? ` — ${song.artist}` : ''}   ◆   OPEN 24H   ◆`;
    const next = lines.slice(target.index + 1).find((line)=>line.fullText.trim());
    const current = lines[target.index];
    const parts = [
        next ? `NEXT ▸ ${next.fullText}` : '',
        current?.translation ? `◆ ${current.translation}` : ''
    ].filter(Boolean);
    return parts.length ? `${parts.join('   ')}   ` : `♪ ${title}   ◆   `;
};
