/* lumiere 的编排：镜头程序、结构、无缝衔接、转场、单镜布局。
 *
 * 从 Folia lumiere 的 6 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCore = window.foliaLumiereCore;
  var foliaLumiereRigs = window.foliaLumiereRigs;
  if (!foliaLumiereCore || !foliaLumiereRigs) return;

  var createRng = foliaLumiereCore.createRng;
  var LUMIERE_KINDS = foliaLumiereRigs.LUMIERE_KINDS;
  var profileOf = foliaLumiereRigs.profileOf;
  var getLineRenderEndTime = (typeof foliaGetLineRenderEndTime === 'function') ? foliaGetLineRenderEndTime : null;
  var segmentLyricWords = (typeof foliaSegmentLyricWords === 'function') ? foliaSegmentLyricWords : null;

  /* 裸函数缺失（核心模块没加载）时整块退出，不把后续模块带崩。 */
  if (!getLineRenderEndTime || !segmentLyricWords) return;

  /* ---- program.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/program.ts
// 绘光的切块与选光位：切块（一个镜头 1–2 行，长间隙出间奏镜头）与选光位（按段落性质 / energy 定 mood，
// 族不连续重复、最近用过的不马上再用）。纯数据，不碰 Pixi。整首歌的编译（分段、转场、开场）在 lumiereProgram.ts。
// folia 里是全自动的：没有锁定风格、风格库偏好与族限制，energy 恒为 null（按段落性质定 mood）。


/** 并进一个单元的原段落范围（lumiereSeamless.ts）。 */

const LUMIERE_TRANSITION_KINDS = ['lights-out', 'flare-cut', 'focus-pull'];



const DEFAULT_LUMIERE_PARAMS = {
    maxShotDuration: 7,
    maxLinesPerShot: 2,
    longLine: 3.6,
    bridgeGap: 4,
};

/** 最近用过的几个光位不马上再用。 */
const RECENT = 3;
/** 间奏镜头偏向的族。 */
const BRIDGE_FAMILIES = ['motes', 'astral', 'zenith'];

const MOODS_BY_KIND = {
    chorus: ['loud', 'neutral'],
    lift: ['loud', 'neutral'],
    verse: ['quiet', 'neutral'],
    breath: ['quiet', 'neutral'],
    outro: ['quiet'],
    break: null,
};

/** 显式 energy：低能量排除喧哗的光位，高能量排除安静的，中段不限。 */
const moodsForEnergy = (energy) => (
    energy < 0.33 ? ['quiet', 'neutral'] : energy < 0.66 ? null : ['neutral', 'loud']
);


/** 切块：短行两两合成一个镜头（不超过时长上限），长行单独成镜头。 */
const groupLines = (lines, params) => {
    const groups = [];
    for (const line of lines) {
        const duration = line.renderEndTime - line.line.startTime;
        const last = groups.at(-1);
        const lastStart = last?.lines[0]?.line.startTime ?? 0;
        const lastLong = last ? last.lines.length === 1 && (last.lines[0].renderEndTime - lastStart) >= params.longLine : true;
        if (
            last
            && !lastLong
            && duration < params.longLine
            && last.lines.length < params.maxLinesPerShot
            && line.renderEndTime - lastStart <= params.maxShotDuration
        ) {
            last.lines.push(line);
        } else {
            groups.push({ lines: [line] });
        }
    }
    return groups;
};


/**
 * 镜头的时间：每个镜头从它的第一行开始（段首镜头从段落开始），到下一个镜头开始为止；
 * 行后的空隙超过 bridgeGap 时，镜头在行唱完后 0.6 秒收住，空隙交给间奏镜头。
 */
const planShots = (
    lines,
    paragraphStart,
    paragraphEnd,
    params,
) => {
    const groups = groupLines(lines, params);
    const shots = [];
    groups.forEach((group, index) => {
        const start = index === 0 ? Math.min(paragraphStart, group.lines[0].line.startTime) : group.lines[0].line.startTime;
        const lyricEnd = Math.max(...group.lines.map(line => line.renderEndTime));
        const nextStart = groups[index + 1]?.lines[0]?.line.startTime ?? paragraphEnd;
        if (nextStart - lyricEnd >= params.bridgeGap) {
            const end = lyricEnd + 0.6;
            shots.push({ lines: group.lines, startTime: start, endTime: end, lyricEndTime: lyricEnd, isBridge: false });
            shots.push({ lines: [], startTime: end, endTime: nextStart, lyricEndTime: nextStart, isBridge: true });
        } else {
            shots.push({ lines: group.lines, startTime: start, endTime: Math.max(nextStart, lyricEnd), lyricEndTime: Math.min(lyricEnd, nextStart), isBridge: false });
        }
    });
    if (groups.length === 0 && paragraphEnd > paragraphStart) {
        shots.push({ lines: [], startTime: paragraphStart, endTime: paragraphEnd, lyricEndTime: paragraphEnd, isBridge: true });
    }
    return shots;
};

/**
 * 选光位：全部光位 → 间奏限定族 → mood → 避开最近用过的与上一个的族，每一步筛空了就退回上一步。
 * energy 为 null 时按段落性质定 mood（folia 里总是 null）。
 */
const castShot = (options) => {
    const { chain } = options;
    let candidates = LUMIERE_KINDS;
    /** 按条件收窄；收窄后少于 atLeast 个就不收（族还不全时，避开同族会变成两族来回交替）。 */
    const narrow = (keep, atLeast = 1) => {
        const next = candidates.filter(keep);
        if (next.length >= atLeast) candidates = next;
    };
    const energy = options.energy ?? null;
    const moods = energy === null ? MOODS_BY_KIND[options.kind] : moodsForEnergy(energy);
    if (options.isBridge) narrow(kind => BRIDGE_FAMILIES.includes(profileOf(kind).family) && profileOf(kind).mood !== 'loud');
    if (moods) narrow(kind => moods.includes(profileOf(kind).mood));
    narrow(kind => !chain.recent.includes(kind));
    if (chain.family) narrow(kind => profileOf(kind).family !== chain.family, 3);
    const random = createRng(`${options.seed}:${options.paragraphIndex}:${options.shotIndex}:cast`);
    return candidates[Math.floor(random() * candidates.length)];
};

/** 选定之后更新 chain（跨段落保留）。 */
const advanceChain = (chain, kind) => {
    chain.recent = [...chain.recent, kind].slice(-RECENT);
    chain.family = profileOf(kind).family;
};

  /* ---- lumiereStructure.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereStructure.ts
// 绘光的分段：与 tempera / sonnet 的分段规则相同（空隙中位数 × 2.5 定阈值、元数据变化切段、超限段落在
// 最大空隙处切开、按副歌标记 / 时长 / 词数 / 标点分类），取自 lumisynth 编译器的 structure 步骤。
// 唯一的差别是超限段落的左半部分也继续切（lumisynth 的 recursiveSplit，folia 原版只切右半部分）。
// tempera / sonnet 的分段函数是模块私有的，所以这里带一份。


const DEFAULT_LUMIERE_STRUCTURE_PARAMS = {
    gapMultiplier: 2.5, gapMin: 1.25, gapMax: 3.5, maxLines: 6, maxDuration: 18, recursiveSplit: true,
};


const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const median = (values) => {
    if (values.length === 0) return 0.5;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? sorted[middle]) + sorted[middle]) / 2
        : sorted[middle];
};

/** 编译用的行：视觉结束时间可以超出 endTime，但不越过下一行开始。 */
const buildStructureLines = (lines) => lines.map((line, sourceIndex) => ({
    sourceIndex,
    line,
    renderEndTime: Math.max(
        line.startTime,
        Math.min(getLineRenderEndTime(line), lines[sourceIndex + 1]?.startTime ?? Number.POSITIVE_INFINITY),
    ),
}));

const resolveParagraphGapThreshold = (lines, params = DEFAULT_LUMIERE_STRUCTURE_PARAMS) => {
    const gaps = lines.slice(1).map((line, index) => (
        line.startTime - Math.min(getLineRenderEndTime(lines[index]), line.startTime)
    )).filter(gap => gap > 0);
    return clamp(median(gaps) * params.gapMultiplier, params.gapMin, params.gapMax);
};

const metadataChanged = (previous, next) => (
    (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
    || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
);

/** 超过行数或时长的段落在最大空隙处切开；recursiveSplit 时左半部分也继续切。 */
const splitOversizedDraft = (draft, params) => {
    const output = [];
    let remaining = draft.lines;
    let boundary = draft.boundary;
    let loopGuard = 0;
    while (remaining.length > params.maxLines || (remaining.length > 1 && (remaining.at(-1).renderEndTime - remaining[0].line.startTime) > params.maxDuration)) {
        if (loopGuard++ > 1000) break;
        const candidates = remaining.slice(2, -1).map((line, offset) => ({
            splitIndex: offset + 2,
            gap: line.line.startTime - remaining[offset + 1].renderEndTime,
        }));
        const validCandidates = candidates.filter(candidate => !Number.isNaN(candidate.gap));
        const rawSplitIndex = validCandidates.sort((a, b) => b.gap - a.gap)[0]?.splitIndex ?? Math.min(4, remaining.length - 1);
        const splitIndex = Math.max(1, rawSplitIndex);
        const head = { lines: remaining.slice(0, splitIndex), boundary };
        output.push(...(params.recursiveSplit ? splitOversizedDraft(head, params) : [head]));
        remaining = remaining.slice(splitIndex);
        boundary = output.at(-1).lines.length >= params.maxLines ? 'line-cap' : 'duration-cap';
    }
    output.push({ lines: remaining, boundary });
    return output;
};

/** 自动分段：元数据变化或空隙超过阈值处切开，再按上限切开超长的段落。 */
const draftParagraphs = (
    lines,
    threshold,
    params = DEFAULT_LUMIERE_STRUCTURE_PARAMS,
) => {
    const drafts = [];
    let current = { lines: [], boundary: 'song-start' };
    lines.forEach((line, index) => {
        const previous = lines[index - 1];
        const gap = previous ? line.line.startTime - previous.renderEndTime : 0;
        const boundary = previous && metadataChanged(previous.line, line.line)
            ? 'metadata'
            : previous && gap >= threshold
                ? 'time-gap'
                : null;
        if (boundary && current.lines.length > 0) {
            drafts.push(...splitOversizedDraft(current, params));
            current = { lines: [], boundary };
        }
        current.lines.push(line);
    });
    if (current.lines.length > 0) drafts.push(...splitOversizedDraft(current, params));
    return drafts;
};

/** 一行里「像词」的片段数。 */
const countWordLike = (line) => segmentLyricWords(line).filter(part => part.isWordLike).length;

/** 段落性质：副歌标记 → 间奏标记 → 最后一段是尾声 → 短或词少是换气 → 标点多或词密是上扬 → 其余是主歌。 */
const classifyParagraph = (lines, index, total) => {
    if (lines.some(item => item.line.isChorus || /chorus|副歌/i.test(item.line.songPart ?? ''))) return 'chorus';
    if (lines.some(item => /bridge|break|間奏|ブリッジ/i.test(item.line.songPart ?? ''))) return 'break';
    if (index === total - 1) return 'outro';
    const duration = lines.at(-1).renderEndTime - lines[0].line.startTime;
    const segmentCount = lines.reduce((sum, line) => sum + countWordLike(line.line), 0);
    const punctuationCount = lines.reduce((sum, line) => sum + (line.line.fullText.match(/[!?！？…]/g)?.length ?? 0), 0);
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
};

  /* ---- lumiereSeamless.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereSeamless.ts
// 轨迹过渡（tuning.seamlessTransitions）：把按段落编好的程序并成一个覆盖整首歌的场景单元。
// 镜头原样保留（光位仍按段落性质与跨段落的 chain 选，和不开时逐个相同），只去掉段落边界：
// 没有出场转场、没有再次星空开场，段落之间和段内换镜头一样在同一个光场里交接
// （主光束摆到新角度、线稿擦除重描、字沿轨迹飞到新槽位）。
// 原来的段落范围留在 sections 里，运镜按段落往返推拉（lumiereUnitLayout.ts 的 resolveLumiereCameraProgress）。

/** 把首尾相接的段落并成一个单元（少于两段时原样返回）。纯函数。 */
const mergeLumiereParagraphs = (paragraphs) => {
    if (paragraphs.length < 2) return [...paragraphs];
    const first = paragraphs[0];
    const last = paragraphs.at(-1);
    const sections = paragraphs.map(paragraph => ({
        startTime: paragraph.startTime,
        endTime: paragraph.endTime,
        kind: paragraph.kind,
    }));
    return [{
        id: 'lumiere-seamless',
        index: 0,
        kind: first.kind,
        boundary: first.boundary,
        startTime: first.startTime,
        endTime: last.endTime,
        lyricEndTime: last.lyricEndTime,
        lineIndices: paragraphs.flatMap(paragraph => paragraph.lineIndices),
        lines: paragraphs.flatMap(paragraph => paragraph.lines),
        shots: paragraphs.flatMap(paragraph => paragraph.shots),
        transitionOut: null,
        opening: first.opening,
        sections,
    }];
};

  /* ---- lumiereTransitions.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereTransitions.ts
// 绘光的段落转场：熄灯 lights-out、闪白 flare-cut、拉焦 focus-pull。光学感主要在场景内部做（熄灯时场景自己
// 在转场窗口里收光、开场星落），外层只配一个简单的帧：熄灯 = 透明度；闪白 = 轻微放大 + 模糊的峰值落在边界；
// 拉焦 = 模糊出、模糊入。lumisynth 里这一帧由内核套在单元容器上，folia 没有内核，由运行时按同样的规则套：
//   - 出场：transitionOut 窗口里对旧段落的容器套 resolveFrame('exit', 进度)；
//   - 进场：边界之后 enterDuration 秒（上一段转场窗口的长度钳在 enterClamp）里对新段落的容器套 resolveFrame('enter', 进度)；
//   运行时也可以简化成两段交叉渐变，只要熄灯的收光（场景的 fadeOut）照常生效。



const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

const LABELS = { 'lights-out': '熄灯', 'flare-cut': '闪白', 'focus-pull': '拉焦' };

const LUMIERE_TRANSITIONS = Object.fromEntries(
    LUMIERE_TRANSITION_KINDS.map(kind => [kind, {
        kind,
        label: LABELS[kind],
        duration: (gap) => (kind === 'focus-pull'
            ? Math.min(0.6, Math.max(0.35, gap > 0 ? gap * 0.5 : 0.45))
            : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8))),
        enterClamp: kind === 'focus-pull' ? [0.3, 0.6] : [0.4, 0.9],
        resolveFrame: (phase, progress) => {
            // 越靠近边界 near 越大。
            const near = phase === 'exit' ? smooth(progress) : 1 - smooth(progress);
            if (kind === 'lights-out') return { alpha: 1 - near, scale: 1, blur: 0 };
            if (kind === 'flare-cut') return { scale: 1 + 0.03 * near, blur: 7 * near * near, alpha: 1 - 0.35 * near * near };
            return { alpha: 1, blur: 12 * near, scale: 1 + 0.015 * near };
        },
    }]),
);

/** 进入阶段的时长：上一段 transitionOut 窗口（startTime..endTime）的长度钳在转场的 enterClamp 里。 */
const resolveLumiereEnterDuration = (kind, startTime, endTime) => {
    const [min, max] = LUMIERE_TRANSITIONS[kind].enterClamp;
    return Math.max(min, Math.min(max, endTime - startTime));
};

/** 选转场：不与这个模式上一次选的相同，按 (seed, 段落序号) 散列确定。 */
const chooseLumiereTransition = (seed, paragraphIndex, previous) => {
    const choices = LUMIERE_TRANSITION_KINDS.filter(kind => kind !== previous);
    let hash = 0;
    for (const char of `${seed}:${paragraphIndex}:transition`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return choices[Math.abs(hash) % choices.length];
};

  /* ---- lumiereProgram.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereProgram.ts
// 绘光在 folia 里的整首编译：歌词 → 段落（分段与段落性质同 tempera / sonnet）→ 每段切镜头、选光位（chain 跨段落）
// → 段落转场与星空开场。对应 lumisynth 统一编译器 + 绘光包的 compileParagraph / toNativeParagraph，
// 但没有编辑器的锁定、组件槽与跨包，全自动；同样的歌词与种子永远得到同样的程序（纯函数，不碰 Pixi）。
//
// 与 lumisynth 的两处差别（folia 没有内核，运行时直接按段落切场景）：
//   1. 段落首尾相接铺满时间轴：第一段从 0 开始（前奏够长时单独出一个间奏段），每段延伸到下一段开始，
//      最后一段延伸到歌曲结束（给了 duration 时）。段后的长间奏在本段里以间奏镜头出现，而不是让上一段的
//      最后一个镜头一直挂着。
//   2. 纯音乐 / 没有歌词：不造虚拟歌词行（绘光会把它们当字画出来），而是在 duration（缺省 480 秒）上
//      铺一串只有间奏镜头的段落，光位从萤尘、星象、天光里选。



/** 与上一段之间空隙超过这么多秒，才重新播放星空点亮的开场。 */
const REOPEN_GAP = 2.5;
/** 纯音乐缺省时长、每段时长与每个间奏镜头的目标时长（秒）。 */
const INSTRUMENTAL_DURATION = 480;
const INSTRUMENTAL_PARAGRAPH = 32;
const BRIDGE_SHOT = 10;
/** 间奏镜头长于这么多秒就切成几个（一个光位挂太久会显得停住）。 */
const BRIDGE_SPLIT = 16;


/** 把过长的间奏镜头等分成约 BRIDGE_SHOT 秒的几段。 */
const splitLongBridges = (shots) => shots.flatMap(shot => {
    const length = shot.endTime - shot.startTime;
    if (!shot.isBridge || length <= BRIDGE_SPLIT) return [shot];
    const count = Math.max(2, Math.round(length / BRIDGE_SHOT));
    return Array.from({ length: count }, (_, index) => {
        const startTime = shot.startTime + (length * index) / count;
        const endTime = index === count - 1 ? shot.endTime : shot.startTime + (length * (index + 1)) / count;
        return { lines: [], startTime, endTime, lyricEndTime: endTime, isBridge: true };
    });
});

/** 有歌词时的段落计划：可选的前奏段 + 分段结果，首尾相接铺到 programEnd。 */
const planLyricParagraphs = (lines, params, duration) => {
    const structure = buildStructureLines(lines);
    const paragraphGapThreshold = resolveParagraphGapThreshold(lines);
    const drafts = draftParagraphs(structure, paragraphGapThreshold);
    const lyricEndTime = Math.max(...structure.map(line => line.renderEndTime));
    const programEnd = Math.max(lyricEndTime, duration ?? 0);
    const firstStart = structure[0].line.startTime;
    const plans = [];
    // 前奏够长（≥ bridgeGap）时单独成一个间奏段：星空开场在 0 秒播放，前奏里有光，第一句不再从全黑开始。
    const intro = firstStart >= params.bridgeGap;
    if (intro) {
        plans.push({ lines: [], kind: 'break', boundary: 'intro', startTime: 0, endTime: firstStart, lyricEndTime: firstStart });
    }
    drafts.forEach((draft, index) => {
        const next = drafts[index + 1];
        plans.push({
            lines: draft.lines,
            kind: classifyParagraph(draft.lines, index, drafts.length),
            boundary: draft.boundary,
            startTime: index === 0 && !intro ? Math.min(0, firstStart) : draft.lines[0].line.startTime,
            endTime: next ? next.lines[0].line.startTime : programEnd,
            lyricEndTime: draft.lines.at(-1).renderEndTime,
        });
    });
    return { plans, paragraphGapThreshold, lyricEndTime, programEnd };
};

/** 纯音乐的段落计划：duration 等分成约 INSTRUMENTAL_PARAGRAPH 秒的段落。 */
const planInstrumentalParagraphs = (duration) => {
    const count = Math.max(1, Math.round(duration / INSTRUMENTAL_PARAGRAPH));
    return Array.from({ length: count }, (_, index) => {
        const startTime = (duration * index) / count;
        const endTime = index === count - 1 ? duration : (duration * (index + 1)) / count;
        return { lines: [], kind: 'break', boundary: index === 0 ? 'song-start' : 'instrumental', startTime, endTime, lyricEndTime: endTime };
    });
};

/**
 * 编译整首歌。lines 是统一歌词（按时间排序），seed 缺省为 'lumiere'；params 覆盖切块参数；
 * options.duration 为歌曲总时长（见 LumiereProgramOptions）。纯函数：同样的输入得到逐字段相同的程序。
 */
const compileLumiereProgram = (
    lines,
    seed,
    params = {},
    options = {},
) => {
    const resolvedParams = { ...DEFAULT_LUMIERE_PARAMS, ...params };
    const resolvedSeed = String(seed ?? 'lumiere');
    const instrumental = lines.length === 0;
    const lyric = instrumental ? null : planLyricParagraphs(lines, resolvedParams, options.duration);
    const instrumentalDuration = Math.max(1, options.duration && options.duration > 0 ? options.duration : INSTRUMENTAL_DURATION);
    const plans = lyric ? lyric.plans : planInstrumentalParagraphs(instrumentalDuration);

    const chain = { recent: [], family: null };
    let previousTransition = null;
    const paragraphs = plans.map((plan, index) => {
        const planned = splitLongBridges(planShots(plan.lines, plan.startTime, plan.endTime, resolvedParams));
        const shots = planned.map((shot, shotIndex) => {
            const kind = castShot({
                seed: resolvedSeed,
                paragraphIndex: index,
                shotIndex,
                kind: plan.kind,
                isBridge: shot.isBridge,
                chain,
            });
            advanceChain(chain, kind);
            return {
                id: `p${index}-lu${shotIndex}`,
                kind,
                lineIndices: shot.lines.map(line => line.sourceIndex),
                startTime: shot.startTime,
                endTime: shot.endTime,
                lyricEndTime: shot.lyricEndTime,
                isBridge: shot.isBridge,
            };
        });

        // 段落转场：结束在下一段开始（= 本段 endTime），时长按与下一段之间的空隙定。
        const next = plans[index + 1];
        let transitionOut = null;
        if (next) {
            const kind = chooseLumiereTransition(resolvedSeed, index, previousTransition);
            previousTransition = kind;
            const gap = next.startTime - plan.lyricEndTime;
            transitionOut = {
                kind,
                startTime: Math.max(plan.startTime, plan.endTime - LUMIERE_TRANSITIONS[kind].duration(gap)),
                endTime: plan.endTime,
            };
        }

        // 星空点亮的开场只在第一段、或与上一段唱完之间有明显空隙时播放；否则每段都从全黑重来，太频繁。
        const previous = plans[index - 1];
        const opening = !previous || plan.startTime - previous.lyricEndTime >= REOPEN_GAP;
        const lineIndices = plan.lines.map(line => line.sourceIndex);
        return {
            id: `lumiere-p${index}`,
            index,
            kind: plan.kind,
            boundary: plan.boundary,
            startTime: plan.startTime,
            endTime: plan.endTime,
            lyricEndTime: plan.lyricEndTime,
            lineIndices,
            lines: lineIndices.map(lineIndex => lines[lineIndex]),
            shots,
            transitionOut,
            opening,
        };
    });

    return {
        version: 1,
        seed: resolvedSeed,
        instrumental,
        paragraphGapThreshold: lyric?.paragraphGapThreshold ?? 0,
        duration: lyric ? lyric.programEnd : instrumentalDuration,
        lyricEndTime: lyric ? lyric.lyricEndTime : null,
        paragraphs: options.seamless ? mergeLumiereParagraphs(paragraphs) : paragraphs,
    };
};

/** 时刻 time 所在的段落序号（第一段之前算第一段，最后一段之后算最后一段）。 */
const findLumiereParagraphIndexAtTime = (program, time) => {
    for (let index = program.paragraphs.length - 1; index >= 0; index -= 1) {
        if (time >= program.paragraphs[index].startTime) return index;
    }
    return 0;
};

  /* ---- lumiereUnitLayout.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereUnitLayout.ts
// 一个场景单元里由镜头列表决定的几件事（纯函数，场景与单测共用）：领头光位、每行成为当前行时用的排版、运镜。
// 整首歌一个单元（轨迹过渡）时它们决定了段落之间是否连续：领头光位跳过前奏的间奏镜头；运镜按原段落往返推拉，
// 段落边界处位置连续、速度为 0。

/** 场景镜头里这几个函数用到的部分。 */

/**
 * 领头光位（文字区、字号、运镜、浮尘、星空按它）：第一个有歌词的镜头。按段落切单元时就是第一个镜头；
 * 整首歌一个单元时跳过前奏的间奏镜头，免得整首歌的字都排在间奏光位的文字区里。
 */
const resolveLumiereLeadShot = (shots) => (
    shots[Math.max(0, shots.findIndex(shot => shot.lines.length > 0))]
);

/** 第 i 行成为当前行时用它所在镜头的排版（不在任何镜头里的行跟随前一个有歌词的镜头）。 */
const lumiereTypographyOfLine = (shots) => (lineIndex) => {
    let found = shots[0];
    for (const shot of shots) {
        if (shot.lines.includes(lineIndex)) return shot.profile.typography;
        if (shot.lines.length > 0 && shot.lines[0] < lineIndex) found = shot;
    }
    return found.profile.typography;
};

/**
 * 运镜的推近进度（0..1，已缓入缓出）：没有 sections 时整个单元推一次（原来的行为）；
 * 有 sections 时每个段落推一次、下一段拉回来，往返交替——段落边界处速度为 0 且位置连续，
 * 整首歌一个单元时运镜也保持段落的节奏，而不是用 5 分钟推完一次。
 */
const resolveLumiereCameraProgress = (
    time,
    span,
    sections,
) => {
    const eased = (start, end) => {
        const linear = Math.min(1, Math.max(0, (time - start) / Math.max(end - start, 0.001)));
        return (1 - Math.cos(linear * Math.PI)) / 2;
    };
    if (!sections || sections.length === 0) return eased(span.startTime, span.endTime);
    let index = 0;
    for (let i = 0; i < sections.length; i += 1) if (sections[i].startTime <= time) index = i;
    const section = sections[index];
    const progress = eased(section.startTime, section.endTime);
    return index % 2 === 0 ? progress : 1 - progress;
};


/** 运镜：缓慢推近 + 平移（两端缓入缓出，见 resolveLumiereCameraProgress），再叠持续的手持感浮动。只由 time 决定。 */
const createLumiereCamera = (options) => {
    const { width, height, camera } = options;
    const motion = options.animationIntensity === 'calm' ? 0.6 : options.animationIntensity === 'chaotic' ? 1.4 : 1;
    const span = { startTime: options.startTime, endTime: options.endTime };
    return (time) => {
        const progress = resolveLumiereCameraProgress(time, span, options.sections);
        const floatX = (Math.sin(time * 0.21 + 0.4) * 0.6 + Math.sin(time * 0.53 + 1.9) * 0.4) * 0.006 * motion;
        const floatY = (Math.cos(time * 0.17 + 1.1) * 0.6 + Math.sin(time * 0.47 + 0.3) * 0.4) * 0.006 * motion;
        return {
            x: width / 2 + (camera.driftX * progress + floatX) * width,
            y: height / 2 + (camera.driftY * progress + floatY) * height,
            pivotX: width / 2,
            pivotY: height / 2,
            scale: (1 + camera.push * progress) * (1 + 0.008 * motion * Math.sin(time * 0.31 + 0.7)),
            rotation: 0.004 * motion * Math.sin(time * 0.13 + 2.1),
        };
    };
};

/** 舞台坐标（没有运镜时的画面坐标）经运镜变换后的画面坐标（与 Pixi 容器 pivot / position / scale / rotation 相同）。 */
const applyLumiereCamera = (transform, x, y) => {
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    const dx = (x - transform.pivotX) * transform.scale;
    const dy = (y - transform.pivotY) * transform.scale;
    return { x: transform.x + dx * cos - dy * sin, y: transform.y + dx * sin + dy * cos };
};

  window.foliaLumiereProgram = {
    LUMIERE_TRANSITIONS: LUMIERE_TRANSITIONS,
    compileLumiereProgram: compileLumiereProgram,
    createLumiereCamera: createLumiereCamera,
    findLumiereParagraphIndexAtTime: findLumiereParagraphIndexAtTime,
    lumiereTypographyOfLine: lumiereTypographyOfLine,
    resolveLumiereEnterDuration: resolveLumiereEnterDuration,
    resolveLumiereLeadShot: resolveLumiereLeadShot
  };
}());
