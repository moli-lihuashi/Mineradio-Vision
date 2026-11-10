/* lumiere 的地基：种子随机、共享内核、调色、字素时序。
 *
 * 从 Folia lumiere 的 7 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var parseColorChannels = (typeof foliaParseColorChannels === 'function') ? foliaParseColorChannels : null;

  /* 裸函数缺失（核心模块没加载）时整块退出，不把后续模块带崩。 */
  if (!parseColorChannels) return;

  /* ---- lumiereRandom.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereRandom.ts
// 绘光的确定性随机数：按 key 播种的 mulberry32 流（key 先经 FNV-1a 散列）。场景构建与编译里的随机量
// 全部从这里取，同一首歌同一个种子永远得到同一帧——seek、重建、预热都不会改变画面。
// folia 已有的 temperaRandom / sonnetRandom 只提供 FNV 散列与逐元素哈希，没有可连续取值的流，所以这里单独保留一份。
// FNV 散列本身与它们共用 visualizerSeedHash。

/** mulberry32：32 位状态，周期 2^32，对装饰用的随机足够。数字种子直接当状态，字符串种子先散列。 */
const createRng = (seed) => {
    let state = typeof seed === 'number' ? seed >>> 0 : hashVisualizerSeed(seed);
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * 与 createRng(seed) 同一条流，但从第 skip 个值之后开始：mulberry32 每取一次状态加一个常数，跳过是 O(1)。
 * 歌词窗口按需构建某一行时用它直接跳到这一行的起点，拿到的值与从头顺序取完全一样。
 */
const createRngAt = (seed, skip) => {
    const state = typeof seed === 'number' ? seed >>> 0 : hashVisualizerSeed(seed);
    return createRng((state + Math.imul(skip, 0x6d2b79f5)) >>> 0);
};

  /* ---- lumiereKernel.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereKernel.ts
// 绘光原本依赖的 lumisynth 内核 / 编译器类型的最小子集：mood、段落性质、运镜变换、片尾卡帧、歌曲信息、音频帧。
// folia 里没有内核，这些只是绘光自己的场景、编译与片尾卡之间的约定；运行时（VisualizerLumiere）按这里的含义去用。

/** 光位的情绪：quiet / neutral / loud。 */

/** 段落性质（与 tempera / sonnet 的分段分类相同）。 */

/** 段落从哪里切开：歌曲开头、时间空隙、歌词元数据（blockIndex / songPart）变化、超出时长或行数上限；intro / instrumental 为绘光自己补的间奏段。 */

/** 编译时的一行：全曲行序号、行本身、视觉结束时间（不越过下一行开始）。 */

/** 音频特征（0..1）：低频推光束亮度、高频推浮尘闪烁、整体响度推烟雾浓度。 */

/** 片尾卡要显示的歌曲信息。 */

/** 片尾卡的时间线帧：歌词层的透明度与失焦、片尾卡本身的透明度、位移与缩放。 */

/** 仿射矩阵：x' = a·x + c·y + tx，y' = b·x + d·y + ty。 */

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** 容器的变换参数（与 Pixi 相同的含义：先减 pivot，再缩放、旋转，最后移到 position）。 */

const fromParams = ({ x, y, pivotX, pivotY, scale, rotation }) => {
    const cos = Math.cos(rotation) * scale;
    const sin = Math.sin(rotation) * scale;
    return { a: cos, b: sin, c: -sin, d: cos, tx: x - (cos * pivotX - sin * pivotY), ty: y - (sin * pivotX + cos * pivotY) };
};

/** m ∘ n：先 n 再 m。 */
const multiply = (m, n) => ({
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
});

const invert = (m) => {
    const det = m.a * m.d - m.b * m.c || 1e-12;
    return {
        a: m.d / det,
        b: -m.b / det,
        c: -m.c / det,
        d: m.a / det,
        tx: (m.c * m.ty - m.d * m.tx) / det,
        ty: (m.b * m.tx - m.a * m.ty) / det,
    };
};

const applyAffine = (m, x, y) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });

/**
 * 运镜变换：没有运镜的容器变换 rest → 当前的容器变换 current。返回的矩阵把「没有运镜时的画面坐标」映射到
 * 「有运镜时的画面坐标」。想让别的图层（素材、字幕装饰）跟着场景运镜，就把它的 `setFromMatrix` 设成这个矩阵
 * （或先乘上图层自己的变换再设）；场景自己的 view 已经在 update 里套过运镜，不需要再套。
 */
const cameraBetween = (rest, current) => multiply(fromParams(current), invert(fromParams(rest)));

  /* ---- color.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/color.ts
// 绘光的颜色都在 0..1 的线性小数组上算，给 Pixi 时转成 0xRRGGBB。

const rgbOf = (color, fallback = [1, 1, 1]) => {
    const channels = parseColorChannels(color);
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : fallback;
};

const mixRgb = (a, b, amount) => [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
];

const scaleRgb = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

const hexOf = (rgb) => {
    const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    return (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2]);
};

const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

const WHITE = [1, 1, 1];
/** 参考图的香槟金。 */
const CHAMPAGNE = [1, 0.86, 0.62];

  /* ---- types.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/types.ts
// 绘光的光位（镜头风格）profile 与 tuning。一个光位 = 光束组 + 烟雾 + 浮尘 + 前景散景 + 线稿配方 +
// 文字区 + 运镜，全是数据，由同一套场景构建器解释（设计见 lumisynth 仓库 docs/LUMIERE.md 第二节）。
// LumiereSceneTuning 是场景直接读的参数；用户可见的 LumiereTuning 在 src/types.ts，由运行时映射过来。


/** 十字爆闪（EVA 式，行内一串小十字），只给部分光位（冠冕、日食、频闪、聚点……）。 */



const DEFAULT_LUMIERE_SCENE_TUNING = {
    lightIntensity: 1,
    audioResponse: 1,
    fogDensity: 1,
    darkField: 0.75,
    moteAmount: 1,
    bloom: 1,
    textBloom: 1,
    unlitOpacity: 0.22,
    windowNeighbors: 2,
    decay: 1,
    echo: 1,
    fogOctaves: 5,
    lineArt: true,
    frontBokeh: true,
    overlayFrame: true,
    trails: false,
    hideTrails: false,
    textOnly: false,
    keywordColors: true,
    themeIcons: true,
    themeColorMix: 0.3,
};

/** bloom 的默认值：绘光的主要观感，给得高。 */

const LUMIERE_BLOOM = {
    // 图形组阈值高一些：只让光源与光柱芯发晕，光柱本身不再被抬亮，文字在光里才压得住。
    graphics: { strength: 1.5, threshold: 0.42, knee: 0.3, levels: 6, spread: 0.9 },
    // 文字组：原来的 1.9 × 调试时试出的 0.6（可读性最好）。
    text: { strength: 1.15, threshold: 0.12, knee: 0.2, levels: 5, spread: 0.95 },
};

  /* ---- ~components/visualizer/visualizerSeedHash.ts ---- */
// Copyright (c) 2026 chthollyphile
// src/components/visualizer/visualizerSeedHash.ts
// 各模式共用的确定性散列：FNV-1a 字符串散列、带盐的数字种子混合、按元素下标取 0..1 抖动。
// 不依赖全局随机状态，seek、重建、预热都得到同一帧。sonnet / tempera / lumiere 的 *Random.ts 都从这里取。

/** FNV-1a 32 位字符串散列。 */
const hashVisualizerSeed = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/** 把数字种子与盐混合，让不同子系统（版式、装饰、逐字抖动）互不相关。 */
const mixVisualizerSeed = (seed, salt) => (
    Math.imul((Math.trunc(seed) ^ salt) >>> 0, 2654435761) >>> 0
);

/** 按元素下标取确定性的 0..1 抖动。 */
const visualizerHash01 = (seed, index, salt) => (
    mixVisualizerSeed(seed + Math.imul(index + 1, 97), salt) / 4294967296
);

  /* ---- ~components/visualizer/wordColoring.ts ---- */
// src/components/visualizer/wordColoring.ts
// Shared range-based keyword coloring helpers for visualizers that render timed lyric tokens.





const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

const isCJK = (text) => CJK_REGEX.test(text);

const normalizeWordColorToken = (text) => text.toLowerCase().replace(/[^\w]/g, '');

const resolveWordColorEntryText = (entry) => {
    if (!entry || typeof entry !== 'object' || !('word' in entry)) {
        return '';
    }

    const word = (entry).word;
    return typeof word === 'string' ? word.trim() : '';
};

const resolveWordColorEntryColor = (entry) => {
    if (!entry || typeof entry !== 'object' || !('color' in entry)) {
        return '';
    }

    const color = (entry).color;
    return typeof color === 'string' ? color : '';
};

const rangesOverlap = (a, b) => (
    a.startOffset < b.endOffset && b.startOffset < a.endOffset
);

const selectNonOverlappingRanges = (ranges) => {
    const selected = [];
    const prioritySorted = [...ranges].sort((a, b) => (
        b.priority - a.priority
        || a.startOffset - b.startOffset
        || a.endOffset - b.endOffset
    ));

    prioritySorted.forEach(range => {
        if (!selected.some(current => rangesOverlap(current, range))) {
            selected.push(range);
        }
    });

    return selected.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
};

const prepareWordColorMatchers = (
    wordColors,
    keywordColoringEnabled = true,
) => {
    if (!keywordColoringEnabled || !wordColors || wordColors.length === 0) {
        return [];
    }

    return wordColors.flatMap(entry => {
        const target = resolveWordColorEntryText(entry);
        if (!target) {
            return [];
        }

        const color = resolveWordColorEntryColor(entry);
        if (!color) {
            return [];
        }

        if (isCJK(target)) {
            return [{
                color,
                cjkPhrases: [target],
                englishWords: [],
                priority: target.length,
            }];
        }

        const englishWords = target
            .split(/\s+/)
            .map(normalizeWordColorToken)
            .filter(Boolean);

        if (englishWords.length === 0) {
            return [];
        }

        return [{
            color,
            cjkPhrases: [],
            englishWords,
            priority: Math.max(...englishWords.map(word => word.length)),
        }];
    });
};

/** Builds phrase color ranges once per line so token renderers can resolve colors with a single ordered pass. */
const buildWordColorRangesFromMatchers = (
    lineText,
    matchers,
) => {
    if (!lineText || matchers.length === 0) {
        return [];
    }

    const ranges = [];
    const englishColorByWord = new Map();

    matchers.forEach(matcher => {
        matcher.cjkPhrases.forEach(target => {
            let cursor = 0;
            while (cursor < lineText.length) {
                const startOffset = lineText.indexOf(target, cursor);
                if (startOffset < 0) {
                    break;
                }

                ranges.push({
                    startOffset,
                    endOffset: startOffset + target.length,
                    color: matcher.color,
                    priority: matcher.priority,
                });
                cursor = startOffset + Math.max(target.length, 1);
            }
        });

        matcher.englishWords.forEach(word => {
            const current = englishColorByWord.get(word);
            if (!current || matcher.priority > current.priority) {
                englishColorByWord.set(word, { color: matcher.color, priority: matcher.priority });
            }
        });
    });

    if (englishColorByWord.size > 0) {
        const wordRegex = /\w+/g;
        let match;
        while ((match = wordRegex.exec(lineText)) !== null) {
            const wordColor = englishColorByWord.get(normalizeWordColorToken(match[0]));
            if (wordColor) {
                ranges.push({
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    color: wordColor.color,
                    priority: wordColor.priority,
                });
            }
        }
    }

    return selectNonOverlappingRanges(ranges);
};

const buildWordColorRanges = (
    lineText,
    wordColors,
    keywordColoringEnabled = true,
) => (
    buildWordColorRangesFromMatchers(
        lineText,
        prepareWordColorMatchers(wordColors, keywordColoringEnabled),
    )
);

const resolveWordColor = (
    wordText,
    wordColors,
    fallbackColor,
    {
        keywordColoringEnabled = true,
        cjkMatchMode = 'target-contains-token',
    }  = {},
) => {
    if (!keywordColoringEnabled || !wordColors || wordColors.length === 0) {
        return fallbackColor;
    }

    const cleanCurrent = wordText.trim();
    if (!cleanCurrent) {
        return fallbackColor;
    }

    const matched = wordColors.find(entry => {
        const target = resolveWordColorEntryText(entry);
        if (!target) {
            return false;
        }

        if (isCJK(cleanCurrent)) {
            if (cjkMatchMode === 'exact') {
                return target === cleanCurrent;
            }
            if (cjkMatchMode === 'bidirectional-contains') {
                return target.includes(cleanCurrent) || cleanCurrent.includes(target);
            }
            return target.includes(cleanCurrent);
        }

        const targetWords = target
            .split(/\s+/)
            .map(normalizeWordColorToken)
            .filter(Boolean);
        const normalizedCurrent = normalizeWordColorToken(cleanCurrent);
        return Boolean(normalizedCurrent) && targetWords.includes(normalizedCurrent);
    });

    return resolveWordColorEntryColor(matched) || fallbackColor;
};

const resolveTokenColorMap = (
    tokens,
    ranges,
) => {
    const colors = new Map();
    let rangeIndex = 0;

    tokens.forEach(token => {
        if (!token.timed) {
            return;
        }

        while (rangeIndex < ranges.length && ranges[rangeIndex].endOffset <= token.startOffset) {
            rangeIndex += 1;
        }

        const range = ranges[rangeIndex];
        if (range && rangesOverlap(range, token)) {
            colors.set(token.key, range.color);
        }
    });

    return colors;
};

  /* ---- ~utils/lyrics/graphemeTiming.ts ---- */
// src/utils/lyrics/graphemeTiming.ts
// Builds parser-derived grapheme timing without owning visualizer animation curves.


const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const splitLyricGraphemes = (text) => {
    if (!text) {
        return [];
    }

    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }

    return Array.from(text);
};

const buildEvenGraphemeTimings = (
    text,
    startTime,
    endTime,
    wordIndex) => {
    const graphemes = splitLyricGraphemes(text);
    if (graphemes.length === 0) {
        return [];
    }

    const duration = Math.max(endTime - startTime, 0);
    const unitDuration = duration / graphemes.length;

    return graphemes.map((char, index) => ({
        char,
        startTime: startTime + unitDuration * index,
        endTime: index === graphemes.length - 1 ? endTime : startTime + unitDuration * (index + 1),
        ...(typeof wordIndex === 'number' ? { wordIndex } : {}),
    }));
};

const buildWordGraphemeTimings = (word, wordIndex) => {
    if (!word.syllables?.length) {
        return buildEvenGraphemeTimings(word.text, word.startTime, word.endTime, wordIndex);
    }

    return word.syllables.flatMap(syllable =>
        buildEvenGraphemeTimings(syllable.text, syllable.startTime, syllable.endTime, wordIndex)
    );
};

const findGraphemeSequence = (source, target, fromIndex) => {
    if (target.length === 0) {
        return fromIndex;
    }

    for (let index = fromIndex; index <= source.length - target.length; index += 1) {
        let matched = true;
        for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
            if (source[index + targetIndex] !== target[targetIndex]) {
                matched = false;
                break;
            }
        }

        if (matched) {
            return index;
        }
    }

    return -1;
};

// Maps word-level timing back to the full displayed line, including spaces and
// punctuation that may not be present in parser words.
const buildLineGraphemeTimeline = (line) => {
    const lineGraphemes = splitLyricGraphemes(line.fullText);
    if (lineGraphemes.length === 0) {
        return [];
    }

    if (line.words.length === 0) {
        return buildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }

    const timeline = [];
    let cursor = 0;
    let lastResolvedTime = line.startTime;

    line.words.forEach((word, wordIndex) => {
        const wordGraphemes = splitLyricGraphemes(word.text);
        if (wordGraphemes.length === 0) {
            return;
        }

        const matchedStart = findGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
        const start = matchedStart >= 0 ? matchedStart : cursor;
        const end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

        for (let gapIndex = cursor; gapIndex < start; gapIndex += 1) {
            timeline[gapIndex] = {
                char: lineGraphemes[gapIndex],
                startTime: word.startTime,
                endTime: word.startTime,
            };
        }

        const wordTimings = buildWordGraphemeTimings(word, wordIndex);
        for (let localIndex = 0; localIndex < end - start; localIndex += 1) {
            const timing = wordTimings[localIndex]
                ?? buildEvenGraphemeTimings(
                    wordGraphemes[localIndex] ?? '',
                    word.startTime,
                    word.endTime,
                    wordIndex
                )[0];

            if (!timing) {
                continue;
            }

            timeline[start + localIndex] = {
                ...timing,
                char: lineGraphemes[start + localIndex],
            };
            lastResolvedTime = Math.max(lastResolvedTime, timing.endTime);
        }

        cursor = Math.max(cursor, end);
    });

    for (let index = 0; index < lineGraphemes.length; index += 1) {
        if (timeline[index]) {
            continue;
        }

        timeline[index] = {
            char: lineGraphemes[index],
            startTime: lastResolvedTime,
            endTime: lastResolvedTime,
        };
    }

    return timeline;
};

  window.foliaLumiereCore = {
    CHAMPAGNE: CHAMPAGNE,
    LUMIERE_BLOOM: LUMIERE_BLOOM,
    WHITE: WHITE,
    buildLineGraphemeTimeline: buildLineGraphemeTimeline,
    buildWordColorRangesFromMatchers: buildWordColorRangesFromMatchers,
    cameraBetween: cameraBetween,
    createRng: createRng,
    createRngAt: createRngAt,
    hexOf: hexOf,
    luminance: luminance,
    mixRgb: mixRgb,
    prepareWordColorMatchers: prepareWordColorMatchers,
    resolveTokenColorMap: resolveTokenColorMap,
    rgbOf: rgbOf,
    scaleRgb: scaleRgb,
    splitLyricGraphemes: splitLyricGraphemes
  };
}());
