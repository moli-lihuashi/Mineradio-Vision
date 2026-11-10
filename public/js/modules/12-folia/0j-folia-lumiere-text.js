/* lumiere 的文字：字行、绕排、词色、窗口切分与几何。
 *
 * 从 Folia lumiere 的 15 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCore = window.foliaLumiereCore;
  var foliaLumiereLight = window.foliaLumiereLight;
  if (!foliaLumiereCore || !foliaLumiereLight) return;

  function lumierePretextFn(globalKey, key) {
    return function () {
      var mod = window[globalKey];
      if (!mod || typeof mod[key] !== "function") {
        throw new Error("lumiere 需要 pretext：" + globalKey + "." + key + " 未注入");
      }
      return mod[key].apply(mod, arguments);
    };
  }
  var measureNaturalWidth = lumierePretextFn("foliaLumierePretext", "measureNaturalWidth");
  var prepareWithSegments = lumierePretextFn("foliaLumierePretext", "prepareWithSegments");
  var measureRichInlineStats = lumierePretextFn("foliaLumierePretextRich", "measureRichInlineStats");
  var prepareRichInline = lumierePretextFn("foliaLumierePretextRich", "prepareRichInline");
  var walkRichInlineLineRanges = lumierePretextFn("foliaLumierePretextRich", "walkRichInlineLineRanges");

  var buildLineGraphemeTimeline = foliaLumiereCore.buildLineGraphemeTimeline;
  var splitLyricGraphemes = foliaLumiereCore.splitLyricGraphemes;
  var createRng = foliaLumiereCore.createRng;
  var segmentLyricWords = (typeof foliaSegmentLyricWords === 'function') ? foliaSegmentLyricWords : null;
  var parseColorChannels = (typeof foliaParseColorChannels === 'function') ? foliaParseColorChannels : null;
  var buildWordColorRangesFromMatchers = foliaLumiereCore.buildWordColorRangesFromMatchers;
  var prepareWordColorMatchers = foliaLumiereCore.prepareWordColorMatchers;
  var resolveTokenColorMap = foliaLumiereCore.resolveTokenColorMap;
  var hexOf = foliaLumiereCore.hexOf;
  var mixRgb = foliaLumiereCore.mixRgb;
  var scaleRgb = foliaLumiereCore.scaleRgb;
  var WHITE = foliaLumiereCore.WHITE;
  var compressLight = foliaLumiereLight.compressLight;
  var lightAt = foliaLumiereLight.lightAt;
  var createRngAt = foliaLumiereCore.createRngAt;

  /* 裸函数缺失（核心模块没加载）时整块退出，不把后续模块带崩。 */
  if (!segmentLyricWords || !parseColorChannels) return;

  /* ---- text/reveal.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/reveal.ts
// 逐字的点亮时刻与进度。时刻取自解析器的逐字时间轴（词内按音节，没有音节按比例，同 fume 的 reveal），
// 进度与闪点包络都是 t 的纯函数。

const buildGlyphTimings = (line) => (
    buildLineGraphemeTimeline(line).map(timing => ({ start: timing.startTime, end: timing.endTime }))
);

const revealClamp01 = (value) => Math.min(1, Math.max(0, value));

/** 0 = 还没唱到，1 = 已唱完。字的时长太短时至少给 80ms，点亮不至于一闪而过。 */
const glyphProgress = (timing, time) => (
    revealClamp01((time - timing.start) / Math.max(timing.end - timing.start, 0.08))
);

/** 点亮瞬间的闪点：attack 秒平滑升起，之后按 decay 秒指数衰减。 */
const flashEnvelope = (timing, time, decay = 0.5, attack = 0.15) => {
    const age = time - timing.start;
    if (age <= 0) return 0;
    if (age < attack) {
        const t = age / attack;
        return t * t * (3 - 2 * t);
    }
    return Math.exp(-(age - attack) / decay);
};

  /* ---- text/windowTypes.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowTypes.ts
// 歌词窗口各模块共用的类型：文字区、排版、崩解参数与每行在某一时刻的变换。

/** 文字区（高度单位，中心 + 宽高）。 */

/** horizontal：横排为主；vertical：竖排为主（右起）；crossed：当前行横排，周围的行自由落点、横竖都有。 */



  /* ---- text/glyphLine.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/text/glyphLine.ts
// 一行歌词排成一张画布纹理，再按字形偏移切成逐字的子纹理（与 fume 一样用 Canvas 2D 画字）。
// 白字，着色靠 tint；纹理按渲染倍率（resolution）画，高 DPI 下不糊。



const UPRIGHT = /[ᄀ-ᇿ⺀-⿿　-〿぀-ヿ㄀-ㇿ㈀-鿿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u;

/** Canvas 2D / pretext 的字体串：画字与测量必须用同一个格式。 */
const glyphFont = (weight, px, family) => `${weight} ${px}px ${family}`;

/** 竖排时是否直立。 */
const isUprightGlyph = (char) => UPRIGHT.test(char);

const buildGlyphLine = (
    pixi,
    options,
) => {
    const { text, fontPx } = options;
    const graphemes = splitLyricGraphemes(text);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontSpec = glyphFont(options.weight, fontPx, options.font);
    context.font = fontSpec;
    const spacing = (options.letterSpacing ?? 0) * fontPx;

    // 前缀宽度：保留字距调整（kerning），逐字的边界落在前缀宽度上。
    const offsets = [0];
    let prefix = '';
    graphemes.forEach((char, index) => {
        prefix += char;
        offsets.push(context.measureText(prefix).width + spacing * (index + 1));
    });
    const width = Math.max(1, offsets[offsets.length - 1]);
    const height = Math.ceil(fontPx * 1.5);
    const pad = Math.ceil(fontPx * 0.25);

    const limit = options.maxCanvasPx ?? (8192);
    const resolution = Math.min(options.resolution, limit / (width + pad * 2), limit / (height + pad * 2));
    canvas.width = Math.ceil((width + pad * 2) * resolution);
    canvas.height = Math.ceil((height + pad * 2) * resolution);
    context.setTransform(resolution, 0, 0, resolution, 0, 0);
    context.font = fontSpec;
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#ffffff';
    const draw = (char, x) => {
        if (options.outline) {
            // 空心字：细描边 + 很淡的填充。
            context.globalAlpha = 0.14;
            context.fillText(char, x, pad + height / 2);
            context.globalAlpha = 1;
            context.lineWidth = fontPx * options.outline;
            context.strokeText(char, x, pad + height / 2);
        } else {
            context.fillText(char, x, pad + height / 2);
        }
    };
    if (spacing === 0) {
        draw(text, pad);
    } else {
        graphemes.forEach((char, index) => draw(char, pad + offsets[index]));
    }

    // 交给 Pixi 的纹理 GC：一分钟没画过的行（整首歌一个单元时，早已唱过的行）卸掉显存副本，画布还在，
    // 再出现时重新上传。按段落切单元时行不会闲置这么久，没有影响。
    // 以 resolution 1 构造、之后再设真实倍率（与 latticeLyricRaster 同一个坑）：直接传 resolution 时，CanvasSource
    // 先算 width = canvas.width / resolution，TextureSource 再乘回去，resizeCanvas() 用 !== 拿这个浮点数和整数画布
    // 尺寸比，往返不精确（上面的边长上限把特别长的行压成非整数倍率，或 1.75 这类 DPR）就回写 canvas.width——
    // 给画布赋宽高会清空刚画好的字，整行成了空白纹理。resolution 的 setter 只按像素尺寸重算宽高，不碰画布。
    const source = new pixi.CanvasSource({ resource: canvas, resolution: 1, autoGarbageCollect: true });
    source.resolution = resolution;
    const base = new pixi.Texture({ source });
    const glyphs = graphemes.map((char, index) => {
        const x = offsets[index];
        const w = Math.max(0.5, offsets[index + 1] - x);
        // 第一个与最后一个字把留白也带上，免得字形出头的部分（斜体、标点）被切掉。
        const left = index === 0 ? 0 : pad + x;
        const right = index === graphemes.length - 1 ? width + pad * 2 : pad + x + w;
        const frame = new pixi.Rectangle(left, 0, right - left, height + pad * 2);
        return {
            char,
            x: left - pad,
            width: right - left,
            charX: x,
            charWidth: w,
            anchorX: (pad + x + w / 2 - left) / (right - left),
            anchorY: 0.5,
            texture: new pixi.Texture({ source, frame }),
            blank: char.trim().length === 0,
            upright: isUprightGlyph(char),
        };
    });

    return {
        text,
        fontPx,
        width,
        height,
        glyphs,
        destroy: () => {
            glyphs.forEach(glyph => glyph.texture.destroy(false));
            base.destroy(true);
        },
    };
};

/** 纹理里的纵向留白（逻辑像素），放置字形时减去。 */
const glyphPad = (fontPx) => Math.ceil(fontPx * 0.25);

  /* ---- text/lineClearance.ts ---- */
// Copyright (c) 2026 chthollyphile
// src/components/visualizer/lumiere/text/lineClearance.ts
// 当前行与邻行之间的间隙：两件事，都是 t 的纯函数、不存历史。
//
// 1. 漂移让开当前行（源头）：每行永不停止的漂移（匀速 + 绕行）沿「堆叠轴」（横排与纵横交错是上下、竖排是左右）
//    拆开看，邻行朝当前行的那一份平滑地翻成背离（速度不变，字仍在动，只是不往当前行里钻）。当前行自己不再
//    越漂越远：沿自己的方向起步，随即绕一个半径 HOLD 的小圆，速度不变、永不停。邻行 / 当前行的身份与堆叠
//    方向都按槽位滑动的进度混合，换行时不跳。
// 2. 当前行的保护框（兜底）：当前行按它自己的位置、缩放、转角取墨迹框（外扩一个邻字的半个字号，再留一段
//    渐变的边），非当前行的字落进框里时透明度（连同光晕、闪点、径迹）压到 PROTECT_FLOOR，边上平滑过渡。
//    换行时新旧当前行的框按滑动进度交接（权重 = 两次换行的缓动进度之差，求和恒为 1，连续）。

/** 软绝对值的圆角（高度单位）：邻行的漂移在「朝向 / 背离」当前行之间换向时速度也连续。 */
const AWAY_SOFTNESS = 0.005;
/** 当前行漂移绕的小圆半径（高度单位）：最多离槽位 2 × HOLD，比邻行与当前行之间的空隙小得多。 */
const HOLD = 0.018;

/** 平滑的 |a|（a = 0 时为 0，远处比 |a| 小 AWAY_SOFTNESS）。 */
const softAbs = (a) => Math.sqrt(a * a + AWAY_SOFTNESS * AWAY_SOFTNESS) - AWAY_SOFTNESS;

/**
 * 邻行一条轴上的漂移（高度单位）：away 为这一行背离当前行的方向（±1）× 它作为邻行的权重（0..1）。
 * 朝当前行的那一份平滑地翻成背离（|a| 的软版本），背离的那一份不变；away = 0 时原样返回。
 */
const awayDrift = (drift, away) => {
    if (away === 0) return drift;
    const sign = away > 0 ? 1 : -1;
    const along = drift * sign;
    return drift + Math.abs(away) * (softAbs(along) - along) * sign;
};

/**
 * 当前行的匀速漂移（不含绕行）在 axis（0 = x，1 = y）上的分量：速度 (vx, vy)、从开始唱起 age 秒。
 * 起步时与匀速漂移一样（沿自己的方向），随即向左拐进半径 HOLD 的圆，速度大小不变。
 */
const heldDrift = (vx, vy, age, axis) => {
    const speed = Math.hypot(vx, vy);
    if (speed < 1e-9) return 0;
    const phi = (speed * age) / HOLD;
    const along = HOLD * Math.sin(phi);
    const turn = HOLD * (1 - Math.cos(phi));
    const ux = vx / speed;
    const uy = vy / speed;
    return axis === 0 ? along * ux - turn * uy : along * uy + turn * ux;
};

/** 保护框里非当前行的字最暗压到原来的多少。 */
const PROTECT_FLOOR = 0.4;
/** 保护框外扩的渐变边宽（以当前行的字号为单位）。 */
const PROTECT_MARGIN = 0.5;

/** 一个当前行的保护框（逻辑像素）：中心、转角、半宽半高（墨迹框，已缩放）、渐变边宽、交接权重、属于哪一行。 */

const createProtectBox = () => ({ line: -1, x: 0, y: 0, cos: 1, sin: 0, halfW: 0, halfH: 0, margin: 1, weight: 0 });

const clearanceSmooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/**
 * 第 line 行一个字（字心 x, y，半个字号 half）被保护的程度 0..1：在别的行的框里（转到那一行自己的方向上看，
 * 字的方块碰到墨迹框就算在里面）为 1，出了框按渐变边平滑降到 0；多个框按交接权重相加。自己那一行的框不算。
 */
const protectionAt = (boxes, count, line, x, y, half) => {
    let protect = 0;
    for (let i = 0; i < count; i += 1) {
        const box = boxes[i];
        if (box.line === line || box.weight <= 0) continue;
        const dx = x - box.x;
        const dy = y - box.y;
        const u = Math.abs(dx * box.cos + dy * box.sin) - box.halfW - half;
        const v = Math.abs(dy * box.cos - dx * box.sin) - box.halfH - half;
        const outside = u > 0 && v > 0 ? Math.hypot(u, v) : Math.max(u, v, 0);
        protect += box.weight * (1 - clearanceSmooth(outside / box.margin));
    }
    return Math.min(1, protect);
};

/** 被保护程度 → 透明度倍率。 */
const protectedAlpha = (protect) => 1 - (1 - PROTECT_FLOOR) * protect;

  /* ---- text/wordStyle.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/text/wordStyle.ts
// 基于分词的字号差异：虚词与符号小一号，一行里的重点词（最长的实词）大一号，其余按种子在小范围内浮动。
// 一行的排版以词为单位：横竖过渡时每个词整体移动，词内的字再各自重排。

/** 字号倍率的上限：字形纹理按这个倍率画，放大的词只缩小不放大，不会糊。 */
const MAX_WORD_SCALE = 1.5;

/** 把一行切成词：走 folia 唯一的分词入口（用户保存的精细分词优先，否则 Intl.Segmenter，没有就逐字）。 */
const segmentWords = (line) => {
    const pieces = segmentLyricWords(line);
    const words = [];
    let cursor = 0;
    for (const { segment, isWordLike } of pieces) {
        const length = splitLyricGraphemes(segment).length;
        if (length === 0) continue;
        words.push({ text: segment, start: cursor, end: cursor + length, blank: !isWordLike });
        cursor += length;
    }
    return words;
};

/** 常见的虚词、代词与助词：单字时小一号。 */
const FUNCTION_WORDS = new Set(Array.from('的了在把是我你他她它们和与也就都着过吗呢吧啊呀哦被让给从向到这那之而又很'));
const MINOR_LATIN = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'me', 'my', 'with', 'and', 'or', 'is', 'i', 'you', 'it', 'by', 'for']);

/** 每个词的字号倍率（与 segmentWords 的结果一一对应）。按种子确定。 */
const wordScales = (words, seed) => {
    const rng = createRng(`${seed}:words`);
    const lengthOf = (word) => word.end - word.start;
    const minor = (word) => word.blank
        || (lengthOf(word) === 1 && FUNCTION_WORDS.has(word.text))
        || MINOR_LATIN.has(word.text.toLowerCase());
    // 重点词：最长的实词；一样长取靠后的（句尾的词更像落点）。
    let key = -1;
    words.forEach((word, index) => {
        if (minor(word)) return;
        if (key < 0 || lengthOf(word) >= lengthOf(words[key])) key = index;
    });
    return words.map((word, index) => {
        const jitter = rng();
        // 空白保持原宽（缩小会把英文的词挤在一起）；标点与符号才算小字。
        if (word.blank && word.text.trim().length === 0) return 1;
        if (index === key && words.length > 1) return 1.45;
        if (minor(word)) return 0.62;
        return 0.85 + jitter * 0.35;
    });
};

/**
 * 错落：每个词在行的垂直方向上的错位（以字号为单位；横排时上下、竖排时左右）。
 * 重点词不动，小字错得多，其余按种子上下跳。
 */
const wordJags = (words, scales, seed) => {
    const rng = createRng(`${seed}:jags`);
    const keyScale = Math.max(...scales);
    return words.map((_, index) => {
        const offset = (rng() - 0.5) * 2;
        const scale = scales[index] ?? 1;
        if (scale === keyScale && words.length > 1) return 0;
        return offset * (scale < 0.7 ? 0.32 : 0.2);
    });
};

  /* ---- text/keywordColors.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/keywordColors.ts
// 绘光的关键字着色：关键字与颜色是主题的 wordColors，匹配走 folia 共用的 wordColoring（中日韩按短语包含、
// 英文按词，按字符区间落到字上，所以「花火」不会染到「火车」的「火」）。每行只在构建时匹配一次，得到逐字
// （grapheme）的关键字色；逐帧只做与光色的混合。
//
// 混合：关键字色与光色按比例混合，再把最亮的通道拉回光色的亮度——字仍是「被光照亮」的样子，只是带上了
// 关键字的色相；暗色的关键字（浅色主题常见）不会变成一块灰。未点亮的字保持冷色，不参与。

/** 各处关键字色的占比（其余是光色）：字身、光晕、闪点、十字爆闪、背景碎片。 */
const KEYWORD_MIX = {
    glyph: 0.6,
    halo: 0.75,
    star: 0.55,
    burst: 0.7,
    echo: 0.3,
};
/** 闪点在关键字光色之上再掺多少白（普通字是 0.5）：闪光带色，但仍是一颗亮星。 */
const KEYWORD_STAR_WHITE = 0.35;
/** 关键字的光晕比普通字亮一点，颜色才看得出来。 */
const KEYWORD_HALO_GAIN = 1.25;

const prepareLumiereKeywords = (
    wordColors,
    enabled,
) => prepareWordColorMatchers(wordColors, enabled);

const parseRgb = (color) => {
    const channels = parseColorChannels(color);
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : null;
};

/**
 * 一行文字逐字（splitLyricGraphemes 的切法，与字形条一致）的关键字色；不是关键字的字为 null。
 * 没有匹配器或没有匹配时返回全 null 的数组。
 */
const resolveGlyphKeywordColors = (text, matchers) => {
    const graphemes = splitLyricGraphemes(text);
    const colors = graphemes.map(() => null);
    if (matchers.length === 0 || graphemes.length === 0) return colors;
    const ranges = buildWordColorRangesFromMatchers(text, [...matchers]);
    if (ranges.length === 0) return colors;
    let offset = 0;
    const tokens = graphemes.map((grapheme, index) => {
        const token = { key: String(index), timed: grapheme.trim().length > 0, startOffset: offset, endOffset: offset + grapheme.length };
        offset += grapheme.length;
        return token;
    });
    // 同一个颜色只解析一次，一行里重复出现的关键字共用同一个数组。
    const parsed = new Map();
    resolveTokenColorMap(tokens, ranges).forEach((hex, key) => {
        if (!parsed.has(hex)) parsed.set(hex, parseRgb(hex));
        colors[Number(key)] = parsed.get(hex) ?? null;
    });
    return colors;
};

/**
 * 关键字色与光色按 amount 混合，最亮的通道拉回光色的亮度（保持发光观感）。关键字色先提到满亮度再混——
 * 只取它的色相与饱和度，不取明暗：浅色主题里常见的深蓝、深红照样能在光里读出颜色，不会被光色冲成白。
 */
const keywordLight = (light, keyword, amount) => {
    const keywordPeak = Math.max(keyword[0], keyword[1], keyword[2]);
    const hue = keywordPeak > 1e-4 ? scaleRgb(keyword, 1 / keywordPeak) : WHITE;
    const mixed = mixRgb(light, hue, amount);
    const peak = Math.max(mixed[0], mixed[1], mixed[2]);
    const target = Math.max(light[0], light[1], light[2]);
    return peak > 1e-4 ? scaleRgb(mixed, target / peak) : light;
};

/** 一个关键字在某个光色下的几种颜色（字身、光晕、闪点），按光色缓存，逐帧直接取。 */

const keywordTints = (light, keyword) => ({
    glyph: keywordLight(light, keyword, KEYWORD_MIX.glyph),
    halo: hexOf(keywordLight(light, keyword, KEYWORD_MIX.halo)),
    star: hexOf(mixRgb(keywordLight(light, keyword, KEYWORD_MIX.star), WHITE, KEYWORD_STAR_WHITE)),
});

/** 十字爆闪落在关键字上：以关键字光色为主，保留一点光位的 tint。 */
const keywordBurstColor = (burstColor, light, keyword) => (
    mixRgb(burstColor, keywordLight(light, keyword, KEYWORD_MIX.burst), 0.8)
);

/** 背景碎片里的关键字：只带一点色。 */
const keywordEchoColor = (light, keyword) => keywordLight(light, keyword, KEYWORD_MIX.echo);

  /* ---- text/lineWrap.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/lineWrap.ts
// 歌词窗口的折行：一行太长时先给它更大的地方（横排用画框内的整个宽度、竖排用画框内的整个高度），再允许
// 轻微整体缩小（到 SINGLE_MIN_FIT），仍放不下才折成两行 / 两列（竖排右起），两行 / 两列之后才继续整体缩小。
// 宽度全部用 pretext 量：每个词是一个原子行内盒（break: 'never'），带自己的字号与字距；断行走 pretext 的
// rich-inline，行宽与词的位置直接取它给出的 gapBefore / occupiedWidth。这里只算数，不碰 Pixi。


/** 画框（overlay 的四角括号）里放字的范围（高度单位，x 从左、y 从上）。 */

/** 画框四角括号的边距（逻辑像素）：边缘可能被运镜推近、后处理的镜头畸变往外推，留足。overlay 也用它。 */
const frameInsets = (width, height) => ({
    padX: Math.max(30, width * 0.065),
    padY: Math.max(30, height * 0.085),
});

/** 字离左右对位十字、上沿对焦虚线再留的距离（高度单位）。 */
const FRAME_CLEARANCE_X = 0.04;
const FRAME_CLEARANCE_TOP = 0.035;
/**
 * 底部给共享字幕（翻译 / 下一句）让出的高度（高度单位）：folia 的字幕层 bottom 约 112px（基线 32 + 净空 80），
 * 再加一行字高，900px 高的窗口里字幕上沿约在 0.83；再留 0.03 给行的漂移、绕行与运镜推近。
 */
const SUBTITLE_CLEARANCE = 0.2;

const frameBand = (width, height) => {
    const { padX, padY } = frameInsets(width, height);
    const left = padX / height + FRAME_CLEARANCE_X;
    return {
        left,
        right: width / height - left,
        top: padY / height + FRAME_CLEARANCE_TOP,
        bottom: Math.max(padY / height + FRAME_CLEARANCE_TOP + 0.2, 1 - SUBTITLE_CLEARANCE),
    };
};

/** 单行（单列）最多整体缩小到这个比例；再小就折成两行（两列）。 */
const SINGLE_MIN_FIT = 0.8;
/** 最多折成几行 / 几列。 */
const MAX_LINES = 2;
/** 行距（横排两行的行心距）与列距（竖排两列的列心距），以字号为单位。 */
const ROW_PITCH = 1.6;
const COLUMN_PITCH = 1.6;

/** pretext 测量：字体串与 glyphLine 画字时同一个格式；每次建场景一个，按（字号、文字）缓存。 */

const createTextMeasurer = (family, weight, letterSpacing) => {
    const cache = new Map();
    const font = (px) => glyphFont(weight, px, family);
    const spacing = (px) => letterSpacing * px;
    return {
        font,
        spacing,
        natural: (text, px) => {
            const key = `${px}|${text}`;
            let width = cache.get(key);
            if (width === undefined) {
                const ls = spacing(px);
                width = measureNaturalWidth(prepareWithSegments(text, font(px), ls === 0 ? undefined : { letterSpacing: ls }));
                cache.set(key, width);
            }
            return width;
        },
    };
};


/** 一行在某种朝向、某种折法下的排版：每个字相对整块中心的位置，追字光斑走的路，整块的尺寸（逻辑像素，未缩放）。 */

/** 一行的四种排版：[朝向 0 横 / 1 竖][0 单行 / 1 折行]。折不开（只有一个原子单位）时折行版与单行版相同。 */

/** 断行的原子单位：一个词，带上黏着它的标点；太长的词拆成单字。 */

/** 前置标点黏后一个词，其余标点黏前一个词。 */
const OPENING = /^[([{（【《「『〈〔［“‘]+$/u;


/** 把分词切成段：词两端的空白单独成段（rich-inline 会把它们收成词间距），没被分词覆盖的字各成一段。 */
const spansOf = (glyphs, words) => {
    const isSpace = (index) => glyphs[index].char.trim().length === 0;
    const ranges = [];
    let cursor = 0;
    for (const word of words) {
        const start = Math.max(cursor, Math.min(glyphs.length, word.start));
        const end = Math.min(glyphs.length, word.end);
        for (let index = cursor; index < start; index += 1) ranges.push({ start: index, end: index + 1, word: false });
        if (end > start) ranges.push({ start, end, word: !word.blank });
        cursor = Math.max(cursor, end);
    }
    for (let index = cursor; index < glyphs.length; index += 1) ranges.push({ start: index, end: index + 1, word: false });
    const spans = [];
    for (const range of ranges) {
        let { start, end } = range;
        const lead = [];
        const tail = [];
        while (start < end && isSpace(start)) lead.push({ start, end: ++start, kind: 'space' });
        while (end > start && isSpace(end - 1)) tail.unshift({ start: end - 1, end: end--, kind: 'space' });
        spans.push(...lead);
        if (end > start) spans.push({ start, end, kind: range.word ? 'word' : 'punct' });
        spans.push(...tail);
    }
    return spans;
};

const textOf = (glyphs, start, end) => glyphs.slice(start, end).map(glyph => glyph.char).join('');

/**
 * 断行单位：词黏上紧挨着的标点（中间没有空白），标点不会落到行首或与它的词分开。
 * 返回单位与夹在中间的空白段（给 rich-inline 当词间距）。
 */
const unitsOf = (glyphs, spans, heroPx) => {
    const pieces = [];
    const pxOf = (index) => heroPx * glyphs[index].scale;
    let pendingOpen = null;
    spans.forEach((span, index) => {
        if (span.kind === 'space') {
            if (pendingOpen) pieces.push({ kind: 'unit', unit: { start: pendingOpen.start, end: pendingOpen.end, text: textOf(glyphs, pendingOpen.start, pendingOpen.end), px: pxOf(pendingOpen.start) } });
            pendingOpen = null;
            pieces.push({ kind: 'space', span });
            return;
        }
        const previous = pieces[pieces.length - 1];
        const next = spans[index + 1];
        if (span.kind === 'punct') {
            const text = textOf(glyphs, span.start, span.end);
            if (OPENING.test(text) && next && next.kind !== 'space') {
                pendingOpen = pendingOpen ? { ...pendingOpen, end: span.end } : span;
                return;
            }
            if (!pendingOpen && previous?.kind === 'unit' && previous.unit.end === span.start) {
                previous.unit.end = span.end;
                return;
            }
        }
        const start = pendingOpen ? pendingOpen.start : span.start;
        pendingOpen = null;
        pieces.push({ kind: 'unit', unit: { start, end: span.end, text: textOf(glyphs, span.start, span.end), px: pxOf(span.start) } });
    });
    const open = pendingOpen;
    if (open) pieces.push({ kind: 'unit', unit: { start: open.start, end: open.end, text: textOf(glyphs, open.start, open.end), px: pxOf(open.start) } });
    return pieces;
};

/**
 * 按行（列）排一行：units 的沿行长度来自 advances（逐字），rich-inline 断行（extraWidth 把 pretext 自己量的
 * 宽度补成这里的长度），maxWidth 为 Infinity 时不折行。返回每个字所在的行、在行内的起点偏移与每行长度。
 */
const breakLines = (
    measurer,
    glyphs,
    pieces,
    advances,
    heroPx,
    lines,
) => {
    const extentOf = (unit) => advances.slice(unit.start, unit.end).reduce((sum, advance) => sum + advance, 0);
    const items = [];
    const unitOfItem = [];
    let widest = 0;
    let widestGap = 0;
    for (const piece of pieces) {
        if (piece.kind === 'space') {
            const px = heroPx * glyphs[piece.span.start].scale;
            items.push({ text: textOf(glyphs, piece.span.start, piece.span.end), font: measurer.font(px), letterSpacing: measurer.spacing(px) });
            unitOfItem.push(null);
            // 词间距（收拢后的一个空格）：pretext 单独量空白是 0，用「a a」与「aa」之差。
            widestGap = Math.max(widestGap, measurer.natural('a a', px) - measurer.natural('aa', px));
            continue;
        }
        const { unit } = piece;
        const extent = extentOf(unit);
        items.push({
            text: unit.text,
            font: measurer.font(unit.px),
            letterSpacing: measurer.spacing(unit.px),
            break: 'never',
            extraWidth: extent - measurer.natural(unit.text, unit.px),
        });
        unitOfItem.push(unit);
        widest = Math.max(widest, extent);
    }
    const prepared = prepareRichInline(items);
    const walk = (maxWidth) => {
        const rows = [];
        walkRichInlineLineRanges(prepared, maxWidth, line => { rows.push(line); });
        return rows;
    };
    let rows = walk(Number.POSITIVE_INFINITY);
    if (lines > 1 && rows.length === 1 && rows[0].fragments.length > 1) {
        // 两行均衡：目标行宽 = (总宽 + 最宽的词) / 2 + 一个词间距——贪心填第一行时它不会比第二行长出一个词以上，
        // 剩下的也一定放得进第二行；pretext 确认只有两行，否则放宽一次（词间距的算法差异）。
        const total = rows[0].width;
        let target = (total + widest) / 2 + widestGap;
        if (measureRichInlineStats(prepared, target).lineCount > lines) target = total / 2 + widest + widestGap;
        rows = walk(target);
        if (rows.length > lines) {
            // 兜底：多出来的行并进最后一行（不会发生在正常的词宽上）。
            const kept = rows.slice(0, lines - 1);
            const rest = rows.slice(lines - 1);
            const fragments = rest.flatMap((row, index) => row.fragments.map((fragment, k) => (
                index > 0 && k === 0 ? { ...fragment, gapBefore: widestGap } : fragment
            )));
            rows = [...kept, { fragments, width: fragments.reduce((sum, f) => sum + f.gapBefore + f.occupiedWidth, 0), end: rest[rest.length - 1].end }];
        }
    }

    const row = new Array(glyphs.length).fill(-1);
    const offset = new Array(glyphs.length).fill(0);
    const lengths = rows.map(line => line.width);
    rows.forEach((line, r) => {
        let cursor = 0;
        for (const fragment of line.fragments) {
            const unit = unitOfItem[fragment.itemIndex];
            const gapStart = cursor;
            cursor += fragment.gapBefore;
            if (!unit) continue;
            // 词前面的空白字：落在词间距中间（行首则落在行首）。
            for (let index = unit.start - 1; index >= 0 && row[index] === -1 && glyphs[index].char.trim().length === 0; index -= 1) {
                row[index] = r;
                offset[index] = gapStart + fragment.gapBefore / 2;
            }
            // 词宽按逐字宽度分摊，字心落在各自那一份的中间。
            const extent = extentOf(unit);
            const ratio = extent > 0 ? fragment.occupiedWidth / extent : 0;
            let inner = cursor;
            for (let index = unit.start; index < unit.end; index += 1) {
                const advance = advances[index] * ratio;
                row[index] = r;
                offset[index] = inner + advance / 2;
                inner += advance;
            }
            cursor += fragment.occupiedWidth;
        }
    });
    // 行尾、行首剩下的空白：跟着前一个字（没有就后一个）。
    for (let index = 0; index < glyphs.length; index += 1) {
        if (row[index] !== -1) continue;
        const previous = index > 0 ? index - 1 : -1;
        if (previous >= 0 && row[previous] !== -1) {
            row[index] = row[previous];
            offset[index] = offset[previous] + (advances[previous] / 2);
        }
    }
    for (let index = glyphs.length - 1; index >= 0; index -= 1) {
        if (row[index] !== -1) continue;
        row[index] = index + 1 < glyphs.length && row[index + 1] !== -1 ? row[index + 1] : 0;
        offset[index] = index + 1 < glyphs.length ? Math.max(0, offset[index + 1] - advances[index + 1] / 2) : 0;
    }
    return { row, offset, lengths: lengths.length ? lengths : [0] };
};

/** 太长的单位（一个词就超过行长上限）拆成单字，标点仍黏在前一个字上。 */
const splitLongUnits = (
    glyphs,
    pieces,
    advances,
    limit,
    heroPx,
) => pieces.flatMap(piece => {
    if (piece.kind === 'space') return [piece];
    const { unit } = piece;
    const extent = advances.slice(unit.start, unit.end).reduce((sum, advance) => sum + advance, 0);
    if (extent <= limit || unit.end - unit.start < 2) return [piece];
    const out = [];
    for (let index = unit.start; index < unit.end; index += 1) {
        const char = glyphs[index].char;
        const last = out[out.length - 1];
        if (last && last.kind === 'unit' && !/[\p{L}\p{N}]/u.test(char)) {
            last.unit.end = index + 1;
            continue;
        }
        out.push({ kind: 'unit', unit: { start: index, end: index + 1, text: char, px: heroPx * glyphs[index].scale } });
    }
    return out;
});

/**
 * 一行的四种排版（横 / 竖 × 单行 / 两行）。limits 为横排行长、竖排列长的上限（逻辑像素）：只用来决定哪些词
 * 长到必须拆字；要不要折行由歌词窗口按槽位的缩放判断（shouldWrap）。
 * 横排：每行居中，行从上往下；竖排：列从右往左，各列居中对齐（列心在同一条横线上，单列时就是原来的居中竖排）。
 */
const flowLine = (
    measurer,
    glyphs,
    words,
    options,
) => {
    const { heroPx } = options;
    const spans = spansOf(glyphs, words);
    const basePieces = unitsOf(glyphs, spans, heroPx);

    // 横排逐字宽度：每段（词 / 标点 / 空白）的 pretext 宽度按画布宽度分摊到字上。
    const horizontal = new Array(glyphs.length).fill(0);
    for (const span of spans) {
        const px = heroPx * glyphs[span.start].scale;
        const text = textOf(glyphs, span.start, span.end);
        const width = measurer.natural(text, px);
        const canvas = glyphs.slice(span.start, span.end).reduce((sum, glyph) => sum + glyph.advance, 0);
        for (let index = span.start; index < span.end; index += 1) {
            horizontal[index] = canvas > 0 ? (width * glyphs[index].advance) / canvas : width / (span.end - span.start);
        }
    }
    // 竖排逐字长度：直立的字占一个字号（加字距），侧转的拉丁字母、数字占它的横排宽度。
    const vertical = glyphs.map((glyph, index) => (
        glyph.upright ? heroPx * glyph.scale * (1 + measurer.spacing(1)) : horizontal[index]
    ));

    const variant = (orient, lines) => {
        const advances = orient === 0 ? horizontal : vertical;
        const pieces = splitLongUnits(glyphs, basePieces, advances, orient === 0 ? options.limits.horizontal : options.limits.vertical, heroPx);
        const { row, offset, lengths } = breakLines(measurer, glyphs, pieces, advances, heroPx, lines);
        const count = lengths.length;
        const along = Math.max(...lengths);
        const pitch = (orient === 0 ? ROW_PITCH : COLUMN_PITCH) * heroPx;
        const points = [];
        const spots = [];
        let inkX = 0;
        let inkY = 0;
        glyphs.forEach((glyph, index) => {
            const r = row[index];
            // 字面：横排宽 = 逐字宽度、高 = 字号；竖排宽 = 字号（侧转的字也是）、高 = 逐字长度。
            const size = heroPx * glyph.scale;
            let point;
            if (orient === 0) {
                const x = offset[index] - lengths[r] / 2;
                const rowY = (r - (count - 1) / 2) * pitch;
                point = { x, y: rowY + (1 - glyph.scale) * heroPx * 0.32 + glyph.jag };
                spots.push({ x, y: rowY });
                if (glyph.char.trim()) {
                    inkX = Math.max(inkX, Math.abs(point.x) + advances[index] / 2);
                    inkY = Math.max(inkY, Math.abs(point.y) + size / 2);
                }
            } else {
                const columnX = ((count - 1) / 2 - r) * pitch;
                // 各列按自己的长度居中：列心都落在同一条横线上（短的那列不贴顶）。
                const y = offset[index] - lengths[r] / 2;
                point = { x: columnX + glyph.jag * 0.8, y };
                spots.push({ x: columnX, y });
                if (glyph.char.trim()) {
                    inkX = Math.max(inkX, Math.abs(point.x) + size / 2);
                    inkY = Math.max(inkY, Math.abs(point.y) + advances[index] / 2);
                }
            }
            points.push(point);
        });
        return { points, spots, along, across: (count - 1) * pitch + heroPx, lines: count, inkWidth: inkX * 2, inkHeight: inkY * 2 };
    };
    return [
        [variant(0, 1), variant(0, MAX_LINES)],
        [variant(1, 1), variant(1, MAX_LINES)],
    ];
};

/** 在缩放 scale 下，沿行长度 along 放进 budget 要再缩多少（不放大）。 */
const fitScale = (along, budget, scale = 1) => Math.min(1, budget / Math.max(scale * along, 1e-6));

/** 这一行在缩放 scale 下要不要折：单行缩到 SINGLE_MIN_FIT 仍放不下，且折得开。 */
const shouldWrap = (flow, budget, scale) => (
    flow[1].lines > 1 && scale * flow[0].along * SINGLE_MIN_FIT > budget
);

/** 把中心 center 放进 [lo, hi]：整块长 extent，放不下时居中。 */
const clampInto = (center, extent, lo, hi) => {
    if (extent >= hi - lo) return (lo + hi) / 2;
    return Math.min(hi - extent / 2, Math.max(lo + extent / 2, center));
};

  /* ---- text/windowLines.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowLines.ts
// 歌词窗口里的一行：构建时要画字形纹理、用 pretext 量词宽排出四种版式（最贵的一步）、建精灵。
// 窗口只在当前行附近按需构建（整首歌一个单元时也一样），所以这里分成两半：
//   - LineMeta：每行都有、很便宜（逐字时刻、字素、关键字色），爆闪选字、光斑、时刻判断用它；
//   - LineView：按需构建、离开窗口后释放。构建结果只由（行、种子）决定，与何时构建无关：逐字的随机量
//     取自整个窗口共用的那条随机流，按前面各行的字数直接跳到这一行的起点（createRngAt），和从第一行起
//     顺序构建时拿到的值完全一样。


/**
 * 换槽位时字的飞行曲线（三次贝塞尔）。控制点按种子：有的走弧线、有的打卷成 S 形；起飞时间错开。
 * 起点与终点相同时（朝向不变）就是甩出去再绕回来的一个圈。
 */




/** 每个字、每行（字之后）从窗口随机流里取几个值：改了 buildLineView 里的取值就要同步改这里（单测会查）。 */
const GLYPH_RANDOM_DRAWS = 19;
const LINE_RANDOM_DRAWS = 4;

/** 每行都有的便宜信息（逐字时刻与关键字色第一次用到时才算）。 */


const buildLineMetas = (lines) => {
    let offset = 0;
    return lines.map(line => {
        const graphemes = splitLyricGraphemes(line.fullText);
        const meta = { line, graphemes, randomOffset: offset, timing: undefined, keywordColors: undefined };
        offset += graphemes.length * GLYPH_RANDOM_DRAWS + LINE_RANDOM_DRAWS;
        return meta;
    });
};

/** 某行的逐字时刻（第一次用到时算，之后缓存）。 */
const lineTimingOf = (meta) => {
    if (!meta.timing) {
        const { line, graphemes } = meta;
        const timings = buildGlyphTimings(line);
        const sung = graphemes.flatMap((char, index) => (char.trim().length === 0 ? [] : [timings[index] ?? { start: line.startTime, end: line.endTime }]));
        meta.timing = {
            timings,
            singStart: sung.length ? Math.min(...sung.map(timing => timing.start)) : line.startTime,
            singEnd: sung.length ? Math.max(...sung.map(timing => timing.end)) : line.endTime,
        };
    }
    return meta.timing;
};

/** 某行的关键字色（第一次用到时匹配，之后缓存）。 */
const keywordColorsOf = (meta, keywords) => {
    if (meta.keywordColors === undefined) {
        meta.keywordColors = keywords && keywords.length > 0 ? resolveGlyphKeywordColors(meta.line.fullText, keywords) : null;
    }
    return meta.keywordColors;
};


/**
 * 构建第 lineIndex 行（不挂到任何层上，由窗口按行号插进去）。rng 必须已经跳到这一行的起点（meta.randomOffset），
 * 取值的个数固定为 GLYPH_RANDOM_DRAWS × 字数 + LINE_RANDOM_DRAWS。
 */
const buildLineView = (context, lineIndex, meta, rng) => {
    const { pixi, heroPx, sprites } = context;
    const { line } = meta;
    const { timings, singStart, singEnd } = lineTimingOf(meta);
    // 字形纹理按最大的词字号画，放大的词只缩小不放大。
    const layout = buildGlyphLine(pixi, {
        text: line.fullText,
        fontPx: heroPx * MAX_WORD_SCALE,
        font: context.font,
        weight: context.weight,
        resolution: context.resolution,
        letterSpacing: context.spacing,
    });
    const keywordColors = keywordColorsOf(meta, context.keywords);

    // 分词与字号：每个字归到一个词，带上那个词的字号倍率与错落。
    const words = segmentWords(line);
    const wordSeed = `${context.seed}:${lineIndex}:${line.fullText}`;
    const scales = wordScales(words, wordSeed);
    const jags = wordJags(words, scales, wordSeed);
    const wordOf = layout.glyphs.map((_, index) => Math.max(0, words.findIndex(word => index >= word.start && index < word.end)));
    const glyphScale = (index) => scales[wordOf[index]] ?? 1;
    const glyphJag = (index) => (jags[wordOf[index]] ?? 0) * heroPx;

    // 横排：按词字号推进，基线对齐（小字往下沉一点），每个词再上下错开；竖排：按列推进，居中对齐，每个词左右错开。
    // 词宽用 pretext 量，太长时折成两行 / 两列（lineWrap），四种排版一次算好。
    const flow = flowLine(
        context.measurer,
        layout.glyphs.map((slice, index) => ({
            char: slice.char,
            scale: glyphScale(index),
            advance: (slice.charWidth / MAX_WORD_SCALE) * glyphScale(index),
            upright: slice.upright,
            jag: glyphJag(index),
        })),
        words,
        { heroPx, limits: context.limits },
    );

    const holder = new pixi.Container();
    const haloLayer = new pixi.Container();
    const starLayer = new pixi.Container();
    holder.label = `line-${lineIndex}`;
    const glyphs = layout.glyphs.map((slice, index) => {
        const glyph = new pixi.Sprite(slice.texture);
        glyph.anchor.set(slice.anchorX, slice.anchorY);
        holder.addChild(glyph);
        // 飞行曲线：第一个控制点朝随机方向甩出去，第二个在它的基础上转过半圈左右（弧线或 S 形、打卷）。
        const a1 = rng() * Math.PI * 2;
        const a2 = a1 + Math.PI * (rng() < 0.5 ? 0.5 : 1.5) + (rng() - 0.5) * 0.8;
        const m1 = heroPx * (1.6 + rng() * 3.2);
        const m2 = heroPx * (1 + rng() * 2.6);
        // 起飞时刻与飞行时长在整段滑动里铺开（delay + duration ≤ 1，滑动结束时一定到位）。
        const duration = 0.45 + rng() * 0.4;
        const flight = {
            c1: { x: Math.cos(a1) * m1, y: Math.sin(a1) * m1 },
            c2: { x: Math.cos(a2) * m2, y: Math.sin(a2) * m2 },
            delay: rng() * (1 - duration),
            duration,
            spin: (rng() - 0.5) * 2.4,
            wobble: rng() * Math.PI * 2,
        };
        const halo = new pixi.Sprite(sprites.dot);
        halo.anchor.set(0.5);
        haloLayer.addChild(halo);
        const star = new pixi.Sprite(sprites.star);
        star.anchor.set(0.5);
        starLayer.addChild(star);
        if (slice.blank) {
            glyph.visible = false;
            halo.visible = false;
            star.visible = false;
        }
        // 漂离方向：多数向上（烟往上走），左右散开。
        const angle = -Math.PI / 2 + (rng() - 0.5) * 2.2;
        const scatterAngle = rng() * Math.PI * 2;
        const scatterDistance = 0.6 + rng() * 1.4;
        return {
            glyph,
            halo,
            star,
            timing: timings[index] ?? { start: line.startTime, end: line.endTime },
            blank: slice.blank,
            index,
            vRotation: slice.upright ? 0 : Math.PI / 2,
            flight,
            scale: glyphScale(index),
            starShape: {
                dx: -0.15 + rng() * 0.5,
                // 上下随机：多数落在字的上半，少数压到字脚下。
                dy: -0.62 + rng() ** 1.4 * 0.9,
                rotation: (rng() - 0.5) * 0.5,
                size: 0.65 + rng() * 0.7,
            },
            drift: { dx: Math.cos(angle), dy: Math.sin(angle), speed: 0.6 + rng() * 0.9, spin: (rng() - 0.5) * 2 },
            scatter: { x: Math.cos(scatterAngle) * scatterDistance, y: Math.sin(scatterAngle) * scatterDistance },
            phase: rng() * Math.PI * 2,
            keyword: slice.blank ? null : keywordColors?.[index] ?? null,
            tints: null,
        };
    });
    const spot = new pixi.Sprite(sprites.dot);
    spot.anchor.set(0.5);
    const [slow, fast] = context.driftSpeed;
    return {
        index: lineIndex,
        line,
        layout,
        holder,
        haloLayer,
        starLayer,
        glyphs,
        keywordGlyphs: glyphs.filter(glyph => glyph.keyword !== null),
        flow,
        // 落点用单独的随机流：排版换来换去时，别的随机量不受影响。
        placements: context.placementsOf(lineIndex),
        spot,
        singStart,
        singEnd,
        jitter: (rng() - 0.5) * 0.16,
        velocity: (() => {
            const angle = rng() * Math.PI * 2;
            const speed = slow + rng() * (fast - slow);
            return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
        })(),
        motionPhase: rng() * Math.PI * 2,
    };
};

  /* ---- text/windowSlots.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowSlots.ts
// 槽位（纯函数）：横排 / 竖排的固定槽位、纵横交错的自由落点，以及堆叠方向与槽位比较。

/**
 * 纵横交错时一行的自由落点：上一行（−1）在上半圈、下一行（+1）在下半圈，角度与远近按种子；
 * 横竖都可能，横排的行倾斜得多一些。更远的位置（±2）沿同一方向再推出去、透明。
 */
const freePlacements = (random, region, nextAlpha) => {
    const placement = (upper, alpha) => {
        const angle = upper ? Math.PI * (1.12 + random() * 0.76) : Math.PI * (0.12 + random() * 0.76);
        const rx = region.w * (0.24 + random() * 0.22);
        const ry = region.h * (0.3 + random() * 0.18);
        const vertical = random() < 0.5;
        return {
            dx: Math.cos(angle) * rx,
            dy: Math.sin(angle) * ry,
            scale: 0.5 + random() * 0.2,
            alpha,
            orient: vertical ? 1 : 0,
            rotation: (random() - 0.5) * (vertical ? 0.3 : 0.7),
            wrap: 0,
        };
    };
    const farther = (slot) => ({ ...slot, dx: slot.dx * 1.45, dy: slot.dy * 1.45, scale: slot.scale * 0.85, alpha: 0 });
    const previous = placement(true, 0.9);
    const next = placement(false, nextAlpha);
    return new Map([[-1, previous], [1, next], [-2, farther(previous)], [2, farther(next)]]);
};

/**
 * 固定槽位里邻行与当前行之间的空隙（以字号为单位）：near 是 ±1 与当前行之间，far 是 ±2 与 ±1 之间。
 * 按单行单列（厚度一个字号）反推，单行时与原来的固定偏移完全一样。
 */
const STACK_GAP = {
    vertical: { previous: 0.95, next: 0.88, farPrevious: 0.78, farNext: 0.7 },
    horizontal: { previous: 0.93, next: 0.735, farPrevious: 0.56, farNext: 0.56 },
};

/**
 * 横排、竖排两种排版的固定槽位（相对文字区中心，高度单位）。relative = 行号 − 当前行号。
 * 邻行按实际厚度排开（竖排看宽度、横排看高度），折成两列 / 两行的行不会压到旁边的行：
 * across(offset, scale) 是「当前行 + offset」那一行在这个槽位缩放下垂直于行方向的厚度（高度单位）。
 */
const fixedSlot = (
    typography,
    relative,
    region,
    fontH,
    nextAlpha,
    across,
) => {
    const slot = (dx, dy, scale, alpha, orient) => ({ dx, dy, scale, alpha, orient, rotation: 0, wrap: 0 });
    const vertical = typography === 'vertical';
    const orient = vertical ? 1 : 0;
    if (relative === 0) return slot(0, 0, 1, 1, orient);
    const previous = relative < 0;
    const far = Math.abs(relative) > 1;
    const nearScale = vertical ? 0.58 : 0.52;
    const scale = far ? (vertical ? 0.48 : 0.44) : nearScale;
    const gap = STACK_GAP[vertical ? 'vertical' : 'horizontal'];
    const sign = previous ? -1 : 1;
    let offset = across(0, 1) / 2 + (previous ? gap.previous : gap.next) * fontH;
    if (far) offset += across(sign, nearScale) + (previous ? gap.farPrevious : gap.farNext) * fontH;
    offset += across(relative, scale) / 2;
    const alpha = previous ? (far ? 0 : 0.9) : (far ? 0 : nextAlpha);
    if (vertical) {
        // 竖排从右往左读：上一行在右、下一行在左。
        return slot(-sign * offset, sign * (far ? 0.07 : 0.03), scale, alpha, orient);
    }
    return slot(sign * region.w * (far ? 0.24 : 0.16), sign * offset, scale, alpha, orient);
};

/** 纵横交错时邻行与当前行之间至少留的空隙（以字号为单位）。 */
const CROSSED_CLEARANCE = 0.5;

/** 堆叠轴：横排与纵横交错时各行上下排开（y），竖排时左右排开（x）。 */
const stackX = (kind) => (kind === 'vertical' ? 1 : 0);
/**
 * 当前行为 c、排版为 kind 时第 index 行背离当前行的方向（堆叠轴上的 ±1，当前行为 0）：横排与纵横交错时
 * 上一行在上、下一行在下；竖排右起，上一行在右、下一行在左。
 */
const awayOf = (index, c, kind) => (
    (index === c ? 0 : index < c ? -1 : 1) * (kind === 'vertical' ? -1 : 1)
);

const sameSlot = (a, b) => a.dx === b.dx && a.dy === b.dy && a.scale === b.scale
    && a.alpha === b.alpha && a.orient === b.orient && a.rotation === b.rotation && a.wrap === b.wrap;

  /* ---- text/windowTiming.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/text/windowTiming.ts
// 歌词窗口的时间与缓动（纯函数，只由 t 决定）：换行的起步与滑动进度、字的飞行曲线、追字光斑、崩解量，
// 以及这些用到的时长常量。

/** 滑动进度 phase（0..1）下这个字在曲线上的位置参数 0..1。 */
const flightProgress = (flight, phase, lag = 0) => {
    const t = Math.min(1, Math.max(0, (phase - flight.delay - lag) / flight.duration));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** 起点 from → 终点 to 的贝塞尔曲线上参数 s 处的点。 */
const flightPoint = (flight, from, to, s) => {
    const u = 1 - s;
    const a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
    return {
        x: a * from.x + b * (from.x + flight.c1.x) + c * (to.x + flight.c2.x) + d * to.x,
        y: a * from.y + b * (from.y + flight.c1.y) + c * (to.y + flight.c2.y) + d * to.y,
    };
};

/** 径迹记录过去多久走过的路（秒）；字到位后尾端再过这么久追上，径迹收拢消失。 */
const TRACK_TIME = 0.45;
const TRACK_SAMPLES = 20;

/**
 * 换行：从新一行开始前 LEAD 秒起，各行依次（按落到的新位置错开 SLIDE_LAG 秒）用 SLIDE 秒滑到新位置——
 * 要离场的行先走，新的当前行随后，新进来的行最后。滑动叠加在每行永不停止的漂移上，画面没有静止的时刻。
 */
const LEAD = 1.2;
const SLIDE = 1.5;
const SLIDE_LAG = { [-2]: 0, [-1]: 0.15, 0: 0.3, 1: 0.5, 2: 0.6 };
const MAX_LAG = 0.6;
/** 每行的持续漂移：恒定速度（高度单位 / 秒）范围、绕行幅度（高度单位）。 */
const DRIFT_SPEED  = [0.013, 0.022];
const ORBIT = 0.03;
/** 逐字点亮的最短渐变时长（字本身很短时也不会一下跳亮）。 */
const LIGHT_UP = 0.3;
/** 追字光斑的时间平滑：对过去这段时间里的位置取平均。 */
const SPOT_WINDOW = 0.3;
const SPOT_SAMPLES = 8;
/** 未唱的行从开始滑动前多久开始聚拢、聚拢多久。 */
const GATHER_LEAD = 1.6;
const GATHER = 1.8;

const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};
const easeInOutCubic = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
/** 换位用更柔的正弦缓动：两端的减速比三次曲线平缓，叠在漂移上不会有「停住」的感觉。 */
const easeInOutSine = (value) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, value)))) / 2;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, k) => a + (b - a) * k;
const lerpPoint = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

/** 时刻 t 的当前行序号（-1 = 第一行之前）、滑动的线性进度 phase 与缓动后的 slide。 */
const resolveWindowCursor = (lines, time) => {
    let current = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].startTime - LEAD <= time) current = i;
        else break;
    }
    const phase = current < 0 ? 1 : clamp01((time - (lines[current].startTime - LEAD)) / SLIDE);
    return { current, phase, slide: easeInOutSine(phase) };
};

/** 某一行在这次换行里的滑动进度：按它落到的新位置（relative）错开起步。 */
const resolveLinePhase = (lines, current, relative, time) => {
    if (current < 0) return { phase: 1, start: Number.NEGATIVE_INFINITY };
    const start = lines[current].startTime - LEAD + (SLIDE_LAG[Math.max(-2, Math.min(2, relative))] ?? 0);
    return { phase: clamp01((time - start) / SLIDE), start };
};


/** 行内的演唱位置（以字为单位的连续值，0 = 第一个字之前，n = 唱完）。 */
const singingPosition = (glyphs, time) => {
    let position = 0;
    for (const glyph of glyphs) position += glyphProgress(glyph.timing, time);
    return position;
};

/** 连续位置 → 行内坐标：在相邻字心之间线性插值。 */
const positionToX = (glyphs, position) => {
    const n = glyphs.length;
    if (n === 0) return 0;
    const index = Math.min(n - 1, Math.max(0, position - 0.5));
    const lower = Math.floor(index);
    const upper = Math.min(n - 1, lower + 1);
    return glyphs[lower].center + (glyphs[upper].center - glyphs[lower].center) * (index - lower);
};

/**
 * 追字光斑在行内的坐标（沿行的方向）：对过去 window 秒里的位置取平均（仍只由 t 决定）。
 * window = 0 时就是不平滑的逐字位置。
 */
const resolveSpotX = (glyphs, time, window = SPOT_WINDOW) => {
    if (window <= 0) return positionToX(glyphs, singingPosition(glyphs, time));
    let x = 0;
    for (let s = 0; s < SPOT_SAMPLES; s += 1) {
        x += positionToX(glyphs, singingPosition(glyphs, time - (window * s) / (SPOT_SAMPLES - 1)));
    }
    return x / SPOT_SAMPLES;
};

/**
 * 崩解的漂离量（以字号为单位）：字点亮 delay 秒之后开始，按 age^1.5 缓慢加速。
 * 3 秒后约 0.4、5 秒约 0.9、8 秒约 1.8 个字号（× strength）：唱的时候只是开始松动，
 * 退到邻行时明显错位，淡出前才散开。
 */
const decayAmount = (decay, litAt, time) => {
    const age = time - litAt - decay.delay;
    return age > 0 ? decay.strength * 0.08 * age ** 1.5 : 0;
};

/** 崩解到多远开始淡出、多远完全看不见（以字号为单位）。 */
const DISSOLVE_FROM = 1;
const DISSOLVE_SPAN = 2;

  /* ---- text/lyricWindow.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/lyricWindow.ts
// 局部平铺窗口：只排当前行附近的几行（fume 的错落版式，但不是整首歌）。未来行是未点亮的刻字，
// 过去行是余光，当前行最大。当前行换到下一行时，各行换到新的槽位，最老的一行淡出进烟里。
//
// 纵横：每个字同时有横排位置与竖排位置（各有单行与折成两行 / 两列两种，见 lineWrap）。三种排版：横排为主、竖排为主、纵横交错。纵横交错时中心是
// 当前行的横排，周围的行按种子各有落点（上一行在上半圈、下一行在下半圈，角度与远近随机，横竖都可能、
// 还会倾斜）。换槽位时每个字沿自己的贝塞尔曲线飞过去（朝向不变也会甩出去再绕回来），身后拖一条细径迹：
// 径迹记录的是字在画面上真正走过的路（叠加了行本身的移动、转动与缩放），像云室里的粒子。字号按分词有差异。
//
// 崩解：字点亮一会儿之后开始沿各自的方向（多数向上）漂离排版位置并转动，越往后越快；
// 还没唱到的行反过来，字从散开的位置逐渐聚拢。所有字都有一点呼吸般的晃动。
//
// 间隙（lineClearance）：邻行的漂移不朝当前行走，当前行只在槽位附近绕小圈；非当前行的字落进当前行的
// 墨迹框（外扩一点）时压暗，当前行始终清楚。
//
// 按需构建（windowLines）：只有当前行附近几行（还在滑动的行往前再多三行、往后三行）有字形纹理、排版与精灵，
// 往后预先建两行（每帧最多一行），离开后释放；整首歌一个单元时构建也只花几行的钱。
//
// 点亮：每个字的亮度 = 点亮进度 × (底光 + 该字位置的光场强度)，唱到的一瞬有四芒闪点，受光强的字
// 下面垫一层柔光晕——这就是参考图里化学式被光柱照到的部分局部发光。全部是 t 的纯函数。
//
// 拆分：时间与缓动 windowTiming、槽位 windowSlots、按需构建的行 windowLineStore、几何（槽位、行变换、字位置）
// windowGeometry、当前行保护框 windowProtection；这里只装配各层、画径迹与每帧的字。





const createLyricWindow = (pixi, options) => {
    const { height, heroPx, decay } = options;
    const view = new pixi.Container();
    const trackLayer = new pixi.Graphics();
    const halos = new pixi.Container();
    const glyphLayer = new pixi.Container();
    const stars = new pixi.Container();
    const spots = new pixi.Container();
    view.addChild(spots, trackLayer, halos, glyphLayer, stars);
    const lineCount = options.lines.length;
    const nextAlpha = options.neighbors >= 2 ? 0.95 : 0;
    // 长度上限：横排用画框内的整个宽度（纵横交错留一成给四周的行），竖排用画框内的整个高度（避开底部字幕）。
    // 文字区只决定中心，不再限制行长。
    const band = frameBand(options.width, height);
    const columnCap = (band.bottom - band.top) * height;
    const maxWidthOf = (kind) => (band.right - band.left) * height * (kind === 'crossed' ? 0.9 : 1);
    const measurer = createTextMeasurer(options.font, options.weight, options.letterSpacing ?? 0);
    const KEYWORDS = options.keywords && options.keywords.length > 0 ? options.keywords : undefined;

    const lines = createWindowLineStore({
        pixi,
        options,
        lineCount,
        measurer,
        limits: { horizontal: maxWidthOf('horizontal'), vertical: columnCap },
        keywords: KEYWORDS,
        nextAlpha,
        glyphLayer,
        halos,
        stars,
        spots,
    });
    const { metas, lineOf } = lines;
    const geometry = createWindowGeometry({ options, lineCount, band, columnCap, maxWidthOf, nextAlpha, lineOf });
    const { lineTransform, glyphLocal, activeRange } = geometry;
    const protection = createWindowProtection({ lines: options.lines, heroPx, lineOf });
    const frameTransforms = new Array(lineCount);

    /**
     * 径迹：字在画面上过去 TRACK_TIME 秒里真正走过的路（叠加了行本身的移动、转动与缩放），加一点
     * 垂直方向的抖动，像云室里的粒子径迹；字到位后尾端追上来，径迹收拢消失。只画这一次滑动开始之后的部分。
     */
    let tracksDrawn = false;
    const drawTracks = (index, view, time, transform, alpha, color) => {
        if (alpha <= 0.003 || !Number.isFinite(transform.slideStart)) return;
        if (time > transform.slideStart + SLIDE + TRACK_TIME) return;
        const from = Math.max(transform.slideStart, time - TRACK_TIME);
        if (time - from < 1e-3) return;
        const samples = Array.from({ length: TRACK_SAMPLES + 1 }, (_, i) => from + ((time - from) * i) / TRACK_SAMPLES);
        const transforms = samples.map(sample => lineTransform(index, sample));
        if (!transforms.some(sample => sample.fly)) return;
        const width = 1.2;
        tracksDrawn = true;
        view.glyphs.forEach(glyph => {
            if (glyph.blank) return;
            let length = 0;
            let previous = null;
            let fontPx = heroPx;
            let flying = 0;
            samples.forEach((sample, i) => {
                const local = glyphLocal(view, glyph, sample, transforms[i]);
                const world = toWorld(transforms[i], local);
                fontPx = heroPx * transforms[i].scale * local.scale;
                flying = local.flying;
                const wobble = Math.sin(i * 0.9 + glyph.flight.wobble + sample * 6) * heroPx * 0.02;
                const x = world.x + wobble;
                const y = world.y - wobble * 0.6;
                if (previous) {
                    length += Math.hypot(x - previous.x, y - previous.y);
                    trackLayer.lineTo(x, y);
                } else {
                    trackLayer.moveTo(x, y);
                }
                previous = { x, y };
            });
            // 径迹越长（字飞得越快）越亮；几乎不动的字不留径迹。字头落在当前行的保护框里时，整条径迹跟字一起压暗
            // （与字身同一条规则，飞行途中不压）。
            const strength = Math.min(1, length / (heroPx * 3));
            const head = previous;
            const shield = head ? protection.shield(index, head.x, head.y, fontPx / 2, flying) : 1;
            // 几乎不动的字不留径迹：路径直接丢掉，不让一条看不见的线也去三角化。
            if (strength > 0.05) trackLayer.stroke({ width, color, alpha: alpha * 0.55 * strength * shield, cap: 'round', join: 'round' });
            else trackLayer.beginPath();
        });
    };

    const update = (frame) => {
        const { time, beams, litColor, unlitColor, unlitAlpha, intensity } = frame;
        trackLayer.visible = frame.hideTrails !== true;
        // 径迹只在行滑动时有；空着的层不再每帧 clear（clear 一个空 Graphics 也会让它重新合批）。
        if (tracksDrawn) {
            trackLayer.clear();
            tracksDrawn = false;
        }
        if (KEYWORDS) lines.refreshKeywordTints(litColor);
        const litHex = hexOf(litColor);
        const starHex = hexOf(mixRgb(litColor, WHITE, 0.5));
        const { low, high, current: cursor } = activeRange(time);
        lines.syncBuilt(low, high);
        for (let index = low; index <= high; index += 1) frameTransforms[index] = lineTransform(index, time);
        protection.build(time, cursor, low, frameTransforms);

        for (let index = low; index <= high; index += 1) {
            const view = lines.viewAt(index);
            const transform = frameTransforms[index];
            const { current, scale } = transform;
            const lineAlpha = transform.alpha * intensity;
            const visible = lineAlpha > 0.003;
            view.holder.visible = visible;
            view.haloLayer.visible = visible;
            view.starLayer.visible = visible;
            view.holder.position.set(transform.x, transform.y);
            view.holder.scale.set(scale);
            view.holder.rotation = transform.rotation;
            const passed = index < current || (index === current && time > view.line.endTime);
            const passedAge = passed ? time - view.line.endTime : 0;
            const passedDim = passed ? lerp(1, 0.75, clamp01(passedAge / 2.5)) : 1;
            const lineFontPx = heroPx * scale;
            if (trackLayer.visible) drawTracks(index, view, time, transform, lineAlpha * passedDim, litHex);

            for (const glyph of view.glyphs) {
                if (glyph.blank) continue;
                if (!visible) {
                    glyph.glyph.visible = false;
                    glyph.halo.visible = false;
                    glyph.star.visible = false;
                    continue;
                }
                const local = glyphLocal(view, glyph, time, transform);
                glyph.glyph.position.set(local.x, local.y);
                glyph.glyph.rotation = local.rotation;
                glyph.glyph.scale.set(local.scale / MAX_WORD_SCALE);
                // 这个字实际的字号（光晕、闪点按它定大小）。
                const fontPx = lineFontPx * local.scale;
                const { x: gx, y: gy } = toWorld(transform, local);
                const lit = smooth((time - glyph.timing.start) / Math.max(glyph.timing.end - glyph.timing.start, LIGHT_UP));
                const flash = flashEnvelope(glyph.timing, time, 0.45);
                const illumination = compressLight(lightAt(beams, gx / height, gy / height));
                // 闪点主要由星形小亮点表现，字身只略微提亮：字身一旦接近白色，文字组的强 bloom 会把笔画糊在一起。
                const heat = clamp01(illumination * 1.3 + flash * 0.2);
                // 崩解得越远越淡，像散进烟里。
                const dissolve = 1 - clamp01((decayAmount(decay, glyph.timing.start, time) * glyph.drift.speed - DISSOLVE_FROM) / DISSOLVE_SPAN);
                // 落进当前行的保护框就压暗（字身、光晕、闪点一起），当前行始终清楚。飞行途中的字一闪而过、本来就在发亮，
                // 不压（按飞行强度渐变）：否则它们高速穿过框边时透明度会一帧一帧地陡变。
                const shield = protection.shield(index, gx, gy, fontPx / 2, local.flying);
                const glyphAlpha = lineAlpha * passedDim * dissolve * (0.35 + 0.65 * local.gather) * shield;

                glyph.glyph.visible = true;
                // 没唱到的字也会被光柱照出来（冷色、半亮），唱到之后才是暖金色并带辉光；飞行中的字像带电粒子一样发亮。
                const revealed = Math.min(1, unlitAlpha + illumination * 0.45 + local.flying * 0.4);
                glyph.glyph.alpha = glyphAlpha * (revealed * (1 - lit) + lit * Math.min(1, 0.55 + 0.4 * heat + 0.3 * local.flying));
                // 关键字：点亮后的字身、光晕、闪点换成关键字光色（未唱时仍是冷色）。
                const tints = glyph.tints;
                const hot = mixRgb(tints ? tints.glyph : litColor, WHITE, clamp01(0.08 * illumination + 0.1 * flash + 0.25 * local.flying));
                const cold = mixRgb(unlitColor, litColor, illumination * 0.35);
                glyph.glyph.tint = hexOf(mixRgb(cold, hot, lit));

                // bloom 已经很强，光晕与闪点只做「局部更亮」的那一点，不能叠成一团白。
                const haloAlpha = glyphAlpha * lit * (0.03 + 0.14 * illumination + 0.08 * flash) * (tints ? KEYWORD_HALO_GAIN : 1);
                glyph.halo.visible = haloAlpha > 0.003;
                if (glyph.halo.visible) {
                    glyph.halo.position.set(gx, gy);
                    const size = fontPx * (2.2 + 0.8 * illumination);
                    glyph.halo.width = size;
                    glyph.halo.height = size * 0.9;
                    glyph.halo.alpha = haloAlpha;
                    glyph.halo.tint = tints ? tints.halo : litHex;
                }

                const starAlpha = lineAlpha * flash * 0.55 * shield;
                glyph.star.visible = starAlpha > 0.003;
                if (glyph.star.visible) {
                    // 亮点避开笔画中心，按种子上下错落；闪的过程中略微转动。
                    const star = glyph.starShape;
                    glyph.star.position.set(gx + fontPx * star.dx, gy + fontPx * star.dy);
                    glyph.star.rotation = star.rotation * (1 + (1 - flash) * 0.6);
                    const size = fontPx * star.size * (0.8 + 0.5 * flash);
                    glyph.star.width = size;
                    glyph.star.height = size;
                    glyph.star.alpha = starAlpha;
                    glyph.star.tint = tints ? tints.star : starHex;
                }
            }

            // 追字光斑：沿行内连续移动，并对过去 SPOT_WINDOW 秒的位置取平均（仍只由 t 决定），
            // 字与字之间的停顿、快慢变化都被抹平；唱前 0.3s 淡入，唱完 0.6s 淡出。
            const spotAlpha = visible
                ? lineAlpha * smooth((time - view.singStart + 0.3) / 0.3) * (1 - smooth((time - view.singEnd) / 0.6))
                : 0;
            view.spot.visible = spotAlpha > 0.003;
            if (view.spot.visible) {
                // 光斑沿行心线（横排）或列心线（竖排）按阅读顺序走：折行时走完一行（一列）跳到下一行（下一列）的开头，
                // 两个坐标用同一套插值，跳的那一下也被时间平均抹平。
                const vertical = transform.toOrient >= 0.5;
                const spotOf = (wrap) => {
                    const path = view.flow[vertical ? 1 : 0][wrap].spots;
                    return {
                        x: resolveSpotX(view.glyphs.map(glyph => ({ timing: glyph.timing, center: path[glyph.index].x })), time),
                        y: resolveSpotX(view.glyphs.map(glyph => ({ timing: glyph.timing, center: path[glyph.index].y })), time),
                    };
                };
                const local = transform.wrap <= 0 ? spotOf(0) : transform.wrap >= 1 ? spotOf(1) : lerpPoint(spotOf(0), spotOf(1), transform.wrap);
                const position = toWorld(transform, local);
                const size = lineFontPx * 5;
                view.spot.position.set(position.x, position.y);
                view.spot.rotation = transform.rotation;
                view.spot.width = size * (vertical ? 1 : 1.6);
                view.spot.height = size * (vertical ? 1.6 : 1);
                view.spot.alpha = 0.07 * spotAlpha;
                view.spot.tint = litHex;
            }
        }
        lines.prebuild(high);
    };

    return {
        view,
        update,
        glyphTimes: lineIndex => {
            const meta = metas[lineIndex];
            if (!meta) return [];
            return meta.graphemes.flatMap((char, glyphIndex) => (
                char.trim().length === 0 ? [] : [{ glyphIndex, start: (lineTimingOf(meta).timings[glyphIndex] ?? { start: meta.line.startTime }).start }]
            ));
        },
        glyphAnchor: (lineIndex, glyphIndex, time) => {
            const transform = lineTransform(lineIndex, time);
            const view = lineOf(lineIndex);
            const local = glyphLocal(view, view.glyphs[glyphIndex], time, transform);
            const world = toWorld(transform, local);
            return { x: world.x, y: world.y, fontPx: heroPx * transform.scale * local.scale };
        },
        lineAnchor: (lineIndex, time) => {
            const transform = lineTransform(lineIndex, time);
            return { x: transform.x, y: transform.y, scale: transform.scale, alpha: transform.alpha };
        },
        glyphKeyword: (lineIndex, glyphIndex) => {
            const meta = metas[lineIndex];
            if (!meta || (meta.graphemes[glyphIndex] ?? '').trim().length === 0) return null;
            return keywordColorsOf(meta, KEYWORDS)?.[glyphIndex] ?? null;
        },
        destroy: () => {
            lines.releaseAll();
            // trackLayer 是自建 context 的 Graphics，带 context: true 才会连 GPU 批数据一起放掉（见 lineArt 的 destroy）。
            view.destroy({ children: true, context: true });
        },
    };
};
  /* ---- text/windowGeometry.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowGeometry.ts
// 歌词窗口的几何（只由 t 决定）：每行在当前行、排版下的槽位（含折行与放进画框的整体偏移），
// 叠加式的行变换（滑动、漂移、让开当前行），字在行内的位置（飞行、聚拢、崩解、呼吸），
// 以及这一帧要画哪几行。行按需从行仓库取。

/** 当前行前后各画几行。 */
const WINDOW_REACH = 3;

/** 行内坐标 → 画面坐标（行的转角、缩放、位置）。 */
const toWorld = (transform, point) => {
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    return {
        x: transform.x + (point.x * cos - point.y * sin) * transform.scale,
        y: transform.y + (point.x * sin + point.y * cos) * transform.scale,
    };
};



const createWindowGeometry = ({
    options, lineCount, band, columnCap, maxWidthOf, nextAlpha, lineOf,
}) => {
    const { height, region, heroPx, typography, decay } = options;
    const fontH = heroPx / height;
    const driftScale = options.drift ?? 1;
    /** 第 c 行成为当前行时的排版（c = −1 即第一行之前，按第一行的排版）。 */
    const typographyAt = (c) => (
        options.typographyOf ? options.typographyOf(Math.max(0, Math.min(lineCount - 1, c))) : typography
    );

    /**
     * 第 index 行在槽位缩放 scale、朝向 orient 下落定的样子：单行缩到 SINGLE_MIN_FIT 还放不下才折，
     * 折了还放不下再整体缩小（邻行本身已经小，很少需要折）。
     */
    const settle = (index, kind, orient, scale) => {
        const flow = lineOf(index).flow[orient];
        const budget = orient === 1 ? columnCap : maxWidthOf(kind);
        const wrap = shouldWrap(flow, budget, scale) ? 1 : 0;
        const variant = flow[wrap];
        return { wrap, variant, scale: scale * fitScale(variant.along, budget, scale) };
    };
    /** 第 index 行垂直于行方向的厚度（高度单位，已缩放）；不存在的行（第一行之前）按一个字号。 */
    const acrossOf = (index, kind, orient, scale) => {
        if (index < 0 || index >= lineCount) return fontH * scale;
        const settled = settle(index, kind, orient, scale);
        return (settled.variant.across / height) * settled.scale;
    };
    /** 把当前行整块放进画框的偏移（高度单位）：整个窗口一起挪，行距不变。文字区的中心仍是锚点。 */
    const windowShift = (current, kind) => {
        if (current < 0 || current >= lineCount) return { x: 0, y: 0 };
        const orient = kind === 'vertical' ? 1 : 0;
        const { variant, scale } = settle(current, kind, orient, 1);
        const w = (variant.inkWidth / height) * scale;
        const h = (variant.inkHeight / height) * scale;
        return {
            x: clampInto(region.cx, w, band.left, band.right) - region.cx,
            y: clampInto(region.cy, h, band.top, band.bottom) - region.cy,
        };
    };

    // 槽位是（行、当前行、排版）的纯函数，每帧会反复查（径迹还要回溯几十个时刻），缓存起来。
    const slotCache = new Map();
    /** 当前行为 current、排版为 kind 时第 index 行的槽位（含把当前行放进画框的整体偏移与这一行的折行）。 */
    const slotOf = (index, current, kind) => {
        const key = `${index}|${current}|${kind}`;
        const cached = slotCache.get(key);
        if (cached) return cached;
        const view = lineOf(index);
        const clamped = Math.max(-2, Math.min(2, index - current));
        const shift = windowShift(current, kind);
        let slot;
        let wrap = null;
        if (kind === 'crossed' && clamped !== 0) {
            // 纵横交错：自由落点在当前行的上半圈 / 下半圈，但要让开当前行（折成两行时更高）：邻行整块的上下边
            // 与当前行之间至少留一段空隙。竖着的邻行很长，当前行与画框之间放不下时先折成两列，还放不下再缩小。
            const base = view.placements.get(clamped);
            const baseOrient = base.orient >= 0.5 ? 1 : 0;
            const sign = base.dy < 0 ? -1 : 1;
            const currentHalf = current >= 0 && current < lineCount
                ? (() => {
                    const settled = settle(current, kind, 0, 1);
                    return (settled.variant.inkHeight / height) * settled.scale / 2;
                })()
                : fontH / 2;
            const gap = fontH * CROSSED_CLEARANCE;
            const centerY = region.cy + shift.y;
            const room = sign < 0 ? centerY - currentHalf - gap - band.top : band.bottom - (centerY + currentHalf + gap);
            const flow = view.flow[baseOrient];
            const budget = baseOrient === 1 ? columnCap : maxWidthOf(kind);
            /** 在缩放 s、折法 w 下这一行整块（含落点的倾斜）的高度（高度单位）。 */
            const tilt = Math.abs(base.rotation) + 0.03;
            const heightOf = (w, s) => (
                ((flow[w].inkHeight * Math.cos(tilt) + flow[w].inkWidth * Math.sin(tilt)) / height) * s * fitScale(flow[w].along, budget, s)
            );
            let scale = base.scale;
            let w = settle(index, kind, baseOrient, scale).wrap ? 1 : 0;
            if (baseOrient === 1 && room > 0) {
                if (w === 0 && flow[1].lines > 1 && heightOf(0, scale) > room) w = 1;
                const tall = heightOf(w, scale);
                if (tall > room) scale = Math.max(base.scale * 0.5, scale * (room / tall));
            }
            wrap = w;
            const clearance = currentHalf + gap + heightOf(w, scale) / 2;
            const dy = sign * Math.max(Math.abs(base.dy), clearance);
            // 竖着的邻行折成两列时更宽，沿原来的方向再推开多出来的那一半。
            const wider = baseOrient === 1 ? Math.max(0, acrossOf(index, kind, 1, scale) - fontH * scale) / 2 : 0;
            slot = { ...base, scale, dy, dx: base.dx + Math.sign(base.dx) * wider };
        } else {
            const orient = kind === 'vertical' ? 1 : 0;
            slot = fixedSlot(kind === 'crossed' ? 'horizontal' : kind, clamped, region, fontH, nextAlpha, (offset, scale) => (
                acrossOf(offset === clamped ? index : current + offset, kind, orient, scale)
            ));
        }
        const result = {
            ...slot,
            dx: slot.dx + shift.x,
            dy: slot.dy + shift.y,
            wrap: wrap ?? settle(index, kind, slot.orient >= 0.5 ? 1 : 0, slot.scale).wrap,
        };
        slotCache.set(key, result);
        return result;
    };

    /**
     * 时刻 time 起还没「走完多时」的第一次换行（current + 1 = 全都走完了）：更早的换行对每一行都已滑完、径迹也已收拢
     * （按最晚的起步 SLIDE_LAG 估，保守）。行的开始时刻是升序的，从当前行往回找几步就到。
     */
    const firstLiveChange = (time, current) => {
        let c = current;
        while (c >= 0 && options.lines[c].startTime - LEAD + MAX_LAG + SLIDE + TRACK_TIME > time) c -= 1;
        return c + 1;
    };

    /**
     * 第 index 行在时刻 time 的位置（逻辑像素）、缩放、转角、透明度与槽位切换信息。纯函数，径迹与爆闪也用它。
     *
     * 叠加式：位置 = 第一行开始前的槽位 + Σ 每次换行带来的槽位差 × 这次换行对这一行的缓动进度。
     * 每次换行对各行错开起步（离场的先走），两行间隔很短、上一次还没走完时也连续，不会跳。
     * 已经走完多时的换行进度都是 1，前后相消（槽位差首尾相接），所以直接从它们之后的槽位起叠：
     * 与从头叠加结果相同，只用到当前行附近几行的排版（整首歌一个单元时不用构建前面所有的行）。
     */
    const lineTransform = (index, time) => {
        const view = lineOf(index);
        const { current } = resolveWindowCursor(options.lines, time);
        const first = firstLiveChange(time, current);
        const base = first - 1;
        const initialKind = typographyAt(base);
        const initial = slotOf(index, base, initialKind);
        let dx = initial.dx, dy = initial.dy, scale = initial.scale, rotation = initial.rotation;
        let alpha = initial.alpha, orient = initial.orient, wrap = initial.wrap;
        // 最近一次正在（或刚刚）作用于这一行的换行：给字的飞行曲线与径迹用。
        let latest = null;
        let restOrient = initial.orient;
        let restWrap = initial.wrap;
        const moves = [];
        // 随排版变化的量（宽度上限、错落）也跟着换行叠加，排版切换时不跳。
        let widthCap = maxWidthOf(initialKind);
        let jitterOn = initialKind === 'crossed' ? 0 : 1;
        // 间隙：背离当前行的方向（x、y 各一份，堆叠轴上的 ±1 × 作为邻行的权重）与作为当前行的权重，
        // 同样按换行叠加，换行与排版切换时连续。
        let awayX = stackX(initialKind) * awayOf(index, base, initialKind);
        let awayY = (1 - stackX(initialKind)) * awayOf(index, base, initialKind);
        let hero = index === base ? 1 : 0;
        // 槽位差为 0 的换行直接跳过。
        const last = Math.min(lineCount - 1, current);
        for (let c = first; c <= last; c += 1) {
            const beforeKind = typographyAt(c - 1);
            const afterKind = typographyAt(c);
            const before = slotOf(index, c - 1, beforeKind);
            const after = slotOf(index, c, afterKind);
            const kindChanged = beforeKind !== afterKind;
            if (sameSlot(before, after) && !kindChanged) continue;
            const { phase, start } = resolveLinePhase(options.lines, c, index - c, time);
            const k = easeInOutSine(phase);
            if (kindChanged) {
                widthCap += (maxWidthOf(afterKind) - maxWidthOf(beforeKind)) * k;
                jitterOn += ((afterKind === 'crossed' ? 0 : 1) - (beforeKind === 'crossed' ? 0 : 1)) * k;
            }
            const awayBefore = awayOf(index, c - 1, beforeKind);
            const awayAfter = awayOf(index, c, afterKind);
            awayX += (stackX(afterKind) * awayAfter - stackX(beforeKind) * awayBefore) * k;
            awayY += ((1 - stackX(afterKind)) * awayAfter - (1 - stackX(beforeKind)) * awayBefore) * k;
            hero += ((index === c ? 1 : 0) - (index === c - 1 ? 1 : 0)) * k;
            // 透明度不跟位移同一条曲线：要淡出的先走（前 60%），要淡入的后到（后 60%）。
            const fade = after.alpha < before.alpha
                ? easeInOutCubic(phase / 0.6)
                : after.alpha > before.alpha ? easeInOutCubic((phase - 0.4) / 0.6) : k;
            dx += (after.dx - before.dx) * k;
            dy += (after.dy - before.dy) * k;
            scale += (after.scale - before.scale) * k;
            rotation += (after.rotation - before.rotation) * k;
            alpha += (after.alpha - before.alpha) * fade;
            orient += (after.orient - before.orient) * phase;
            wrap += (after.wrap - before.wrap) * k;
            if (phase > 0) latest = { before, after, phase, start, kind: afterKind };
            if (phase >= 1) {
                restOrient = after.orient;
                restWrap = after.wrap;
                moves.length = 0;
            } else if (phase > 0) {
                moves.push({
                    toOrient: after.orient,
                    toWrap: after.wrap,
                    phase,
                    fly: options.alwaysFly === true || afterKind === 'crossed' || before.orient !== after.orient,
                });
            }
        }
        // 太长时整体缩小，不出画框（横排看宽度、竖排看长度；单行 / 折行按折行程度混合）。
        const o = clamp01(orient);
        const w = clamp01(wrap);
        const [hSingle, hWrapped] = view.flow[0];
        const [vSingle, vWrapped] = view.flow[1];
        const fitH = lerp(fitScale(hSingle.along, widthCap, scale), fitScale(hWrapped.along, widthCap, scale), w);
        const fitV = lerp(fitScale(vSingle.along, columnCap, scale), fitScale(vWrapped.along, columnCap, scale), w);
        const fitted = scale * lerp(fitH, fitV, o);
        // 错落只作用在固定槽位的邻行上（横排时横向、竖排时纵向），当前行居中。
        const jitter = jitterOn * view.jitter * region.w * clamp01((1 - scale) / 0.5);
        // 固定槽位里每一行沿自己的方向不出画框（横排左右、竖排上下）：邻行排在垂直于行的方向上，挪了也压不到
        // 当前行。纵横交错的邻行是自由落点，沿行挪可能挪进当前行里，保持原样（和错落一样只作用在固定槽位上）。
        // 漂移不算在里面，照常漂。
        const baseX = region.cx + dx + jitter * (1 - orient);
        const baseY = region.cy + dy + jitter * 0.5 * orient;
        const alongH = (lerp(hSingle.inkWidth, hWrapped.inkWidth, w) / height) * fitted;
        const alongV = (lerp(vSingle.inkHeight, vWrapped.inkHeight, w) / height) * fitted;
        const x = baseX + (clampInto(baseX, alongH, band.left, band.right) - baseX) * (1 - o) * jitterOn;
        const y = baseY + (clampInto(baseY, alongV, band.top, band.bottom) - baseY) * o * jitterOn;
        // 永不停止的漂移：以这一行开始唱的时刻为零点匀速漂（唱的时候正好在槽位上），再叠一点绕行、摆动与呼吸。
        // 让开当前行（lineClearance）：邻行朝当前行的那一份翻成背离；当前行不越漂越远，绕一个小圆，速度不变。
        const age = time - view.line.startTime;
        const m = view.motionPhase;
        const { x: vx, y: vy } = view.velocity;
        const orbitX = Math.sin(time * 0.52 + m) * ORBIT;
        const orbitY = Math.cos(time * 0.41 + m * 1.3) * ORBIT * 0.7;
        const held = clamp01(hero);
        const driftX = lerp(awayDrift((vx * age + orbitX) * driftScale, awayX), (heldDrift(vx, vy, age, 0) + orbitX) * driftScale, held);
        const driftY = lerp(awayDrift((vy * age + orbitY) * driftScale, awayY), (heldDrift(vx, vy, age, 1) + orbitY) * driftScale, held);
        const settledOrient = latest ? latest.after.orient : initial.orient;
        const settledWrap = latest ? latest.after.wrap : initial.wrap;
        return {
            current,
            x: (x + driftX) * height,
            y: (y + driftY) * height,
            scale: fitted * (1 + 0.025 * Math.sin(time * 0.43 + m)),
            rotation: rotation + 0.03 * Math.sin(time * 0.23 + m * 0.7),
            alpha: clamp01(alpha),
            fromOrient: latest ? latest.before.orient : settledOrient,
            toOrient: settledOrient,
            fromWrap: latest ? latest.before.wrap : settledWrap,
            toWrap: settledWrap,
            wrap: w,
            orient: o,
            phase: latest ? latest.phase : 1,
            // 纵横交错时每次换槽位都飞；另两种排版只在朝向变化时飞。
            fly: latest !== null && latest.phase < 1
                && (options.alwaysFly === true || latest.kind === 'crossed' || latest.before.orient !== latest.after.orient),
            slideStart: latest ? latest.start : Number.NEGATIVE_INFINITY,
            restOrient,
            restWrap,
            moves,
        };
    };

    /**
     * 字在行内的位置（未缩放）、转角与缩放：换槽位时沿自己的贝塞尔曲线飞过去，途中缩小、转动、发亮
     * （flying 为飞行强度 0..1）。再加上聚合、崩解与呼吸。
     */
    const glyphLocal = (view, glyph, time, transform) => {
        const at = (orient, wrap) => view.flow[orient >= 0.5 ? 1 : 0][wrap >= 0.5 ? 1 : 0].points[glyph.index];
        // 从上一次走完的换位的终点出发，依次叠上还在进行的换位：每一次都从上一次此刻的位置起飞（或滑过去），
        // 前一次还没飞完就换行时，字接着从它在曲线上的位置出发，不会跳回起点。
        let point = at(transform.restOrient, transform.restWrap);
        let orientation = transform.restOrient;
        let flying = 0;
        for (const move of transform.moves) {
            const target = at(move.toOrient, move.toWrap);
            if (move.fly) {
                const s = flightProgress(glyph.flight, move.phase);
                point = flightPoint(glyph.flight, point, target, s);
                orientation = lerp(orientation, move.toOrient, s);
                flying = Math.max(flying, Math.sin(Math.PI * s));
            } else {
                // 不飞的时候，单行与折行之间（邻行变成当前行、需要折开时）字随滑动缓动过去。
                const k = easeInOutSine(move.phase);
                point = lerpPoint(point, target, k);
                orientation = lerp(orientation, move.toOrient, k);
            }
        }
        let x = point.x;
        let y = point.y;
        let rotation = glyph.vRotation * orientation + glyph.flight.spin * flying;
        const pulse = 1 - 0.28 * flying;
        // 聚合：未唱的行从散开的位置逐渐收拢。
        const gather = smooth((time - (view.line.startTime - LEAD - GATHER_LEAD)) / GATHER);
        const scatter = (1 - gather) ** 2 * decay.strength;
        x += glyph.scatter.x * heroPx * scatter;
        y += glyph.scatter.y * heroPx * scatter;
        // 崩解：点亮一会儿之后沿各自的方向漂离、转动。
        const amount = decayAmount(decay, glyph.timing.start, time) * glyph.drift.speed;
        x += glyph.drift.dx * heroPx * amount;
        y += glyph.drift.dy * heroPx * amount;
        rotation += glyph.drift.spin * amount * 0.18;
        // 呼吸：一直有一点轻微晃动。
        const breath = heroPx * 0.022 * Math.min(1, decay.strength + 0.3);
        x += Math.sin(time * 0.9 + glyph.phase) * breath;
        y += Math.cos(time * 1.13 + glyph.phase * 1.7) * breath;
        return { x, y, rotation, gather, flying, scale: glyph.scale * pulse };
    };

    /**
     * 这一帧要画的行：当前行前后各 WINDOW_REACH 行，还在滑动（或径迹还没收拢）的换行再往前 WINDOW_REACH 行——
     * 槽位要看当前行 ±2 行的排版，更远的行透明度都是 0。只由时刻决定。
     */
    const activeRange = (time) => {
        const { current } = resolveWindowCursor(options.lines, time);
        const first = firstLiveChange(time, current);
        return {
            current,
            low: Math.max(0, Math.min(current, first) - WINDOW_REACH),
            high: Math.min(lineCount - 1, Math.max(current, 0) + WINDOW_REACH),
        };
    };

    return { fontH, lineTransform, glyphLocal, activeRange };
};

  /* ---- text/windowProtection.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowProtection.ts
// 当前行的保护框（lineClearance）：每帧按新旧当前行的换行进度建几个墨迹框，非当前行的字、径迹落进去就压暗。



const createWindowProtection = ({ lines, heroPx, lineOf }) => {
    // 当前行的保护框：每帧最多几个（换行交接时新旧当前行各一个，两次换行挨得很近时再多一两个），预先建好反复用。
    const protectBoxes = [createProtectBox(), createProtectBox(), createProtectBox(), createProtectBox()];
    let protectCount = 0;

    /**
     * 这一帧的保护框：第 j 行作为当前行的权重 = 它这次换行的缓动进度 − 下一次换行的缓动进度（换行进度都是 t 的
     * 连续函数，所以权重也连续，求和为 1）。框是第 j 行此刻的墨迹框（横竖 × 单行 / 折行按当前的朝向与折行程度混合），
     * 跟着它的位置、缩放与转角。横竖转到一半时（字在飞、混合出来的框又宽又高，框边扫得很快）框渐隐，转完再回来。
     * 要先算好这一帧所有行的变换（frameTransforms）。
     */
    const buildProtectBoxes = (time, current, low, frameTransforms) => {
        protectCount = 0;
        let later = 0;
        for (let j = current; j >= low && protectCount < protectBoxes.length; j -= 1) {
            const eased = easeInOutSine((time - (lines[j].startTime - LEAD)) / SLIDE);
            const transform = frameTransforms[j];
            const o = clamp01(transform.orient);
            const weight = (eased - later) * clamp01(transform.alpha) * (1 - 4 * o * (1 - o));
            later = eased;
            if (weight > 1e-4) {
                const [hSingle, hWrapped] = lineOf(j).flow[0];
                const [vSingle, vWrapped] = lineOf(j).flow[1];
                const w = transform.wrap;
                const inkW = lerp(lerp(hSingle.inkWidth, hWrapped.inkWidth, w), lerp(vSingle.inkWidth, vWrapped.inkWidth, w), transform.orient);
                const inkH = lerp(lerp(hSingle.inkHeight, hWrapped.inkHeight, w), lerp(vSingle.inkHeight, vWrapped.inkHeight, w), transform.orient);
                const box = protectBoxes[protectCount];
                box.line = j;
                box.x = transform.x;
                box.y = transform.y;
                box.cos = Math.cos(transform.rotation);
                box.sin = Math.sin(transform.rotation);
                box.halfW = (inkW / 2) * transform.scale;
                box.halfH = (inkH / 2) * transform.scale;
                box.margin = PROTECT_MARGIN * heroPx * transform.scale;
                box.weight = weight;
                protectCount += 1;
            }
            if (eased >= 1) break;
        }
    };

    return {
        build: buildProtectBoxes,
        /** 第 index 行一个字（画面坐标、半径）的保护系数：落进别的行的保护框就压暗，飞行途中按飞行强度不压。 */
        shield: (index, x, y, radius, flying) => (
            protectCount > 0
                ? protectedAlpha(protectionAt(protectBoxes, protectCount, index, x, y, radius) * (1 - flying))
                : 1
        ),
    };
};

  /* ---- text/windowLineStore.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowLineStore.ts
// 歌词窗口里按需构建的行：建（按行号插进各层）、藏、释放、往后预建，以及关键字在当前光色下的着色。
// 构建结果只由（行、种子）决定，与构建顺序无关。

/** 按需构建：当前行前后各画几行、往后预先建几行、离开窗口多远才释放。 */
const PREBUILD = 2;
const KEEP_MARGIN = 2;



/** 歌词窗口的行仓库：metas 每行都有，LineView 按需构建、离开窗口后释放。 */
const createWindowLineStore = ({
    pixi, options, lineCount, measurer, limits, keywords: KEYWORDS, nextAlpha, glyphLayer, halos, stars, spots,
}) => {
    const { region, heroPx, sprites } = options;
    const spacing = options.letterSpacing ?? 0;
    const metas = buildLineMetas(options.lines);
    /** 已构建的行（没建的是 null）与它们的行号（升序）：各层里的子节点按行号排，画的先后与构建顺序无关。 */
    const views = new Array(lineCount).fill(null);
    const built = [];
    const buildContext = {
        pixi,
        font: options.font,
        weight: options.weight,
        resolution: options.resolution,
        heroPx,
        spacing,
        seed: options.seed,
        sprites,
        measurer,
        limits,
        keywords: KEYWORDS,
        driftSpeed: DRIFT_SPEED,
        placementsOf: (lineIndex) => freePlacements(createRng(`${options.seed}:placements:${lineIndex}`), region, nextAlpha),
    };
    let tintedFor = null;
    /** 把 child 插到 parent 里行号 lineIndex 该在的位置（parent 里每个已构建的行各有一个子节点）。 */
    const insertByLine = (parent, child, position) => {
        if (position >= parent.children.length) parent.addChild(child);
        else parent.addChildAt(child, position);
    };
    /** 构建第 index 行：随机流跳到这一行的起点，结果与从第一行起顺序构建时一样。 */
    const buildLine = (index) => {
        const meta = metas[index];
        const lineView = buildLineView(buildContext, index, meta, createRngAt(`${options.seed}:window`, meta.randomOffset));
        let position = 0;
        while (position < built.length && built[position] < index) position += 1;
        built.splice(position, 0, index);
        insertByLine(glyphLayer, lineView.holder, position);
        insertByLine(halos, lineView.haloLayer, position);
        insertByLine(stars, lineView.starLayer, position);
        insertByLine(spots, lineView.spot, position);
        if (tintedFor) for (const glyph of lineView.keywordGlyphs) glyph.tints = keywordTints(tintedFor, glyph.keyword);
        views[index] = lineView;
        return lineView;
    };
    const releaseLine = (index) => {
        const lineView = views[index];
        if (!lineView) return;
        views[index] = null;
        built.splice(built.indexOf(index), 1);
        for (const item of [lineView.holder, lineView.haloLayer, lineView.starLayer, lineView.spot]) {
            item.parent?.removeChild(item);
            item.destroy({ children: true });
        }
        lineView.layout.destroy();
    };
    const lineOf = (index) => views[index] ?? buildLine(index);

    /** 关键字在当前光色下的颜色：光色不变时（通常整个单元都不变）只算一次；之后新建的行在构建时按它上色。 */
    const refreshKeywordTints = (litColor) => {
        if (tintedFor && tintedFor[0] === litColor[0] && tintedFor[1] === litColor[1] && tintedFor[2] === litColor[2]) return;
        tintedFor = [litColor[0], litColor[1], litColor[2]];
        for (const index of built) {
            for (const glyph of views[index].keywordGlyphs) glyph.tints = keywordTints(litColor, glyph.keyword);
        }
    };

    /** 窗口外的行藏起来，离得更远的释放（留一点余量，来回拖动进度时不反复重建）。 */
    const syncBuilt = (low, high) => {
        for (let k = built.length - 1; k >= 0; k -= 1) {
            const index = built[k];
            if (index >= low && index <= high) continue;
            if (index < low - KEEP_MARGIN || index > high + KEEP_MARGIN) {
                releaseLine(index);
                continue;
            }
            const lineView = views[index];
            lineView.holder.visible = false;
            lineView.haloLayer.visible = false;
            lineView.starLayer.visible = false;
            lineView.spot.visible = false;
        }
    };
    /** 往后预先建几行（每帧最多一行），当前行换过去时不用当场构建。 */
    const prebuild = (high) => {
        for (let index = high + 1; index <= Math.min(lineCount - 1, high + PREBUILD); index += 1) {
            if (views[index]) continue;
            buildLine(index);
            const lineView = views[index];
            lineView.holder.visible = false;
            lineView.haloLayer.visible = false;
            lineView.starLayer.visible = false;
            lineView.spot.visible = false;
            return;
        }
    };

    return {
        metas,
        lineOf,
        /** 已构建的第 index 行（没建的是 null）。 */
        viewAt: (index) => views[index],
        refreshKeywordTints,
        syncBuilt,
        prebuild,
        /** 释放全部已构建的行。 */
        releaseAll: () => {
            for (let k = built.length - 1; k >= 0; k -= 1) releaseLine(built[k]);
        },
    };
};

  /* ---- text/lyricEcho.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/lyricEcho.ts
// 背景的歌词装饰：不是整句，而是「采集」来的分词。每个词被唱到时，就在主光源附近出现一个巨大的空心字
// 碎片，随后沿主光束的方向（跟着光束的摆动）缓慢漂下去，约 7 秒淡出；碎片的大小、倾斜、拉伸按种子，
// 许多碎片在光束里互相重叠。漂的过程中词会被拆开：字彼此散开、转动、斜切。平时很淡，光束里被照亮。
// 每一帧只由 t 决定。
//
// 按需栅格化：随机量（落点、拆开方向）构建时一次抽完，与一次画完整个单元时逐项相同；巨大的空心字画布只在
// 这一行第一个碎片出现前 PREPARE 秒才画（一帧最多提前画一行），最后一个碎片消失后就释放。整首歌一个单元
// （轨迹过渡）时背景字的画布与纹理也只有正在漂的几行，构建时不再画整首歌的字。



/** 一个碎片存在多久（秒）、沿光束漂多快（高度单位 / 秒）、从离光源多远的地方出现。 */
const LIFE = 7;
const SPEED = 0.075;
const BIRTH_DISTANCE = 0.08;
/** 碎片出现前多久把这一行的空心字画好（秒）。 */
const PREPARE = 3;


/** 一行：它的碎片（fragments 里的下标范围）、第一个与最后一个碎片出现的时刻、画好的空心字（没画时为 null）。 */


const echoClamp01 = (value) => Math.min(1, Math.max(0, value));
const echoSmooth = (value) => {
    const t = echoClamp01(value);
    return t * t * (3 - 2 * t);
};

const createLyricEcho = (pixi, options) => {
    const { height } = options;
    const rng = createRng(`${options.seed}:echo`);
    const view = new pixi.Container();
    const fontPx = options.size * height;
    // 背景字本来就淡，分辨率不需要高；画布边长也封顶。
    const resolution = Math.min(options.resolution, 1.5);
    const fragments = [];
    const holders = [];
    const echoLines = [];

    // 随机量一次抽完（顺序与一次画完时相同）；字形只按字素数算（与 buildGlyphLine 同一个切分），不画。
    options.lines.forEach(line => {
        const graphemes = splitLyricGraphemes(line.fullText);
        const timings = buildGlyphTimings(line);
        const keywordColors = options.keywords && options.keywords.length > 0
            ? resolveGlyphKeywordColors(line.fullText, options.keywords)
            : null;
        const first = fragments.length;
        segmentWords(line).forEach(word => {
            if (word.blank) return;
            const end = Math.min(word.end, graphemes.length);
            if (end <= word.start) return;
            const holder = new pixi.Container();
            view.addChild(holder);
            holders.push(holder);
            fragments.push({
                birth: timings[word.start]?.start ?? line.startTime,
                across: (rng() - 0.5) * 2.8,
                speed: 0.7 + rng() * 0.7,
                scale: 0.4 + rng() * 0.6,
                rotation: (rng() - 0.5) * 0.9,
                stretch: 0.75 + rng() * 0.7,
                shear: (rng() - 0.5) * 0.12,
                spin: (rng() - 0.5) * 0.08,
                start: word.start,
                end,
                glyphs: graphemes.slice(word.start, end).map((char, offsetInWord) => {
                    const angle = rng() * Math.PI * 2;
                    return {
                        sprite: null,
                        blank: char.trim().length === 0,
                        offset: 0,
                        dx: Math.cos(angle),
                        dy: Math.sin(angle),
                        speed: 0.3 + rng() * 0.9,
                        spin: (rng() - 0.5) * 0.5,
                        keyword: keywordColors?.[word.start + offsetInWord] ?? null,
                    };
                }),
            });
        });
        const births = fragments.slice(first).map(fragment => fragment.birth);
        if (births.length === 0) return;
        echoLines.push({
            text: line.fullText,
            first,
            last: fragments.length,
            from: Math.min(...births),
            to: Math.max(...births),
            layout: null,
        });
    });

    /** 画这一行的空心字，把字形挂到它的碎片上。 */
    const rasterize = (echoLine) => {
        const layout = buildGlyphLine(pixi, {
            text: echoLine.text,
            fontPx,
            font: options.font,
            weight: options.weight,
            resolution,
            letterSpacing: 0.04,
            outline: 0.012,
            maxCanvasPx: 4096,
        });
        echoLine.layout = layout;
        for (let index = echoLine.first; index < echoLine.last; index += 1) {
            const fragment = fragments[index];
            const slices = layout.glyphs.slice(fragment.start, fragment.end);
            const left = slices[0].charX;
            const right = slices[slices.length - 1].charX + slices[slices.length - 1].charWidth;
            const middle = (left + right) / 2;
            fragment.glyphs.forEach((glyph, offsetInWord) => {
                const slice = slices[offsetInWord];
                const sprite = new pixi.Sprite(slice.texture);
                sprite.anchor.set(slice.anchorX, slice.anchorY);
                sprite.visible = !glyph.blank;
                holders[index].addChild(sprite);
                glyph.sprite = sprite;
                glyph.offset = slice.charX + slice.charWidth / 2 - middle;
            });
        }
    };
    /** 释放这一行的空心字（精灵与画布纹理）。 */
    const release = (echoLine) => {
        for (let index = echoLine.first; index < echoLine.last; index += 1) {
            holders[index].removeChildren().forEach(child => child.destroy());
            fragments[index].glyphs.forEach(glyph => { glyph.sprite = null; });
        }
        echoLine.layout?.destroy();
        echoLine.layout = null;
    };
    /**
     * 按时间画 / 释放：碎片已经出现的行立刻画；快出现的行一帧最多提前画一行（把画字的开销摊开）；
     * 碎片全部消失、或时间退回到出现之前的行释放。
     */
    const prepare = (time) => {
        let budget = 1;
        for (const echoLine of echoLines) {
            if (time < echoLine.from - PREPARE || time > echoLine.to + LIFE) {
                if (echoLine.layout) release(echoLine);
            } else if (!echoLine.layout && (time >= echoLine.from || budget-- > 0)) {
                rasterize(echoLine);
            }
        }
    };
    // 关键字碎片的颜色按光色缓存（光色通常整个单元不变）。
    const hasKeywords = fragments.some(fragment => fragment.glyphs.some(glyph => glyph.keyword));
    const keywordHex = new Map();
    let keywordFor = -1;
    const keywordTint = (color, keyword) => {
        if (color !== keywordFor) {
            keywordHex.clear();
            keywordFor = color;
        }
        let hex = keywordHex.get(keyword);
        if (hex === undefined) {
            const light = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
            hex = hexOf(keywordEchoColor(light, keyword));
            keywordHex.set(keyword, hex);
        }
        return hex;
    };

    const update = ({ time, beams, color, intensity }) => {
        prepare(time);
        // 主光束（第一束）的几何：原点、方向、半宽；没有光束时退回画面顶部中央竖直向下。
        const beam = beams[0];
        const ox = beam?.ox ?? (options.width / height) / 2;
        const oy = beam?.oy ?? 0;
        const bx = beam?.dx ?? 0;
        const by = beam?.dy ?? 1;
        const halfAt = (distance) => (beam ? beam.halfWidth + distance * beam.tanSpread : 0.08) + 0.04;

        fragments.forEach((fragment, index) => {
            const holder = holders[index];
            const age = time - fragment.birth;
            const presence = echoSmooth(age / 0.9) * (1 - echoSmooth((age - (LIFE - 2.5)) / 2.5));
            const alpha = presence * intensity * options.opacity;
            holder.visible = age >= 0 && age <= LIFE && alpha > 0.003;
            if (!holder.visible) return;
            // 沿光束漂：离光源的距离随时间增长，横向位置按光束在那里的半宽换算（光束摆动时跟着走）。
            const distance = BIRTH_DISTANCE + SPEED * fragment.speed * age;
            const across = fragment.across * halfAt(distance);
            const x = (ox + bx * distance - by * across) * height;
            const y = (oy + by * distance + bx * across) * height;
            holder.position.set(x, y);
            holder.rotation = fragment.rotation + fragment.spin * age;
            holder.scale.set(fragment.scale * fragment.stretch, fragment.scale);
            holder.skew.set(fragment.shear * age, 0);
            // 拆开：字彼此散开（按 age^1.3 加速）、各自转动。
            const split = 0.05 * age ** 1.3;
            const lit = compressLight(lightAt(beams, x / height, y / height));
            const glyphAlpha = alpha * (0.05 + 0.4 * lit);
            for (const glyph of fragment.glyphs) {
                if (!glyph.sprite) continue;
                glyph.sprite.position.set(
                    glyph.offset + glyph.dx * fontPx * split * glyph.speed,
                    glyph.dy * fontPx * split * glyph.speed,
                );
                glyph.sprite.rotation = glyph.spin * split * 4;
                glyph.sprite.alpha = glyphAlpha;
                glyph.sprite.tint = hasKeywords && glyph.keyword ? keywordTint(color, glyph.keyword) : color;
            }
        });
    };

    return {
        view,
        update,
        destroy: () => {
            view.destroy({ children: true });
            echoLines.forEach(echoLine => echoLine.layout?.destroy());
        },
    };
};

  window.foliaLumiereText = {
    createLyricEcho: createLyricEcho,
    createLyricWindow: createLyricWindow,
    frameInsets: frameInsets,
    keywordBurstColor: keywordBurstColor,
    prepareLumiereKeywords: prepareLumiereKeywords
  };
}());
