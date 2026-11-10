/* tempera 的排版与逐字视图：pretext 量词 → 拼贴排版 → 每字一个 pixi Text。
 * 源：src/components/visualizer/tempera/temperaMeasure.ts（133）+ temperaLayout.ts（376）
 *      + temperaTextView.ts（207） · 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. 测量缓存是**跨调用共享**的（20000 条 FIFO）：key = `weight size family|text`。改成每调用一份，
 *    换歌那一帧会把整首歌重新量一遍。
 * 2. 一个词的逐字宽度按 shaping 结果**等比校正**，不是给某个字补差值 —— 否则整词宽度对不上跨距。
 * 3. 版式只用 shot profile 的 region 数据（cx/cy/w/h/align/rotation/fontScale），不许自己算版式。
 * 4. 入场窗口 = `MIN_SETTLE_SECONDS` + 到本 shot 歌词末尾剩余距离 × `glyphSettleStretch`；
 *    释放期从「唱完」与「落定」中较晚的那个开始，杠杆臂 = 字相对整块中心的偏移。
 * 5. 词的间隔只有源文本真有空白时才是 `0.26em`，CJK 分词边界只给 `0.035em` 的光学间隙。
 * 6. 阴影片**在反色层里面**：放到下面它会成为滤镜读到的背景，字会按自己的影子翻色、碎成硬块。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var motion = window.foliaTemperaMotion;
  var mg = window.foliaTemperaMg;
  var program = window.foliaTemperaProgram;
  if (!motion || !mg || !program) return;

  var temperaHash01 = mg.hash01;
  var resolveTemperaShotProfile = program.resolveShotProfile;
  var TEMPERA_ENTER_STYLES = motion.TEMPERA_ENTER_STYLES;

  /* @chenglou/pretext 只有 ESM 构建，主脚本里不能静态 import，只能由
   * 16-folia-core-pretext.js 的 foliaLoadPretext() 动态取回后注入到这里。
   * 注入前调用测量会**直接抛错** —— 静默返回 0 宽会让整块版式塌成一行，
   * 那种错误在画面上看起来像"版式算法坏了"，查起来极慢。 */
  var pretextLayoutWithLines = null;
  var pretextPrepareWithSegments = null;

  function setTemperaPretext(mod) {
    if (!mod || typeof mod.layoutWithLines !== 'function' || typeof mod.prepareWithSegments !== 'function') {
      throw new Error('tempera: pretext 模块形态不对');
    }
    pretextLayoutWithLines = mod.layoutWithLines;
    pretextPrepareWithSegments = mod.prepareWithSegments;
  }

  function layoutWithLines(prepared, maxWidth, lineHeight) {
    if (!pretextLayoutWithLines) throw new Error('tempera: pretext 尚未注入');
    return pretextLayoutWithLines(prepared, maxWidth, lineHeight);
  }

  function prepareWithSegments(text, font, options) {
    if (!pretextPrepareWithSegments) throw new Error('tempera: pretext 尚未注入');
    return pretextPrepareWithSegments(text, font, options);
  }

  /* ---- tempera/temperaMeasure.ts ---- */
// src/components/visualizer/tempera/temperaMeasure.ts
// pretext-backed text metrics for the Tempera collage. Words come from the Intl.Segmenter
// split done at compile time; measuring the whole word and then normalising the per-grapheme
// advances to that width keeps shaping/kerning intact while still allowing per-char placement.

/**
 * Measurement is shared across every layout call, not scoped to one. A cache key names the
 * whole spec (`weight size family|text`), so nothing about a scene, a shot or a song can make
 * two entries with the same key disagree - and the same graphemes recur constantly: the fit
 * loop re-measures a shot up to four times, a paragraph has several shots, and consecutive
 * songs share most of their character set. A per-call cache threw all of that away and made a
 * song change re-measure everything from scratch on the frame it landed.
 */
const MEASURE_CACHE_LIMIT = 20000;
const measureCache = new Map();

const readMeasureCache = (key) => measureCache.get(key);

const writeMeasureCache = (key, width) => {
    // Plain FIFO eviction: entries are equally cheap to recompute, so the eviction policy only
    // has to bound memory, not predict reuse.
    if (measureCache.size >= MEASURE_CACHE_LIMIT) {
        const oldest = measureCache.keys().next();
        if (!oldest.done) measureCache.delete(oldest.value);
    }
    measureCache.set(key, width);
};

const createTemperaMeasureContext = (
    fontFamily,
    fontWeight,
) => ({ cache: measureCache, fontFamily, fontWeight });

const measureText = (ctx, text, fontSize) => {
    const fontSpec = `${ctx.fontWeight} ${fontSize}px ${ctx.fontFamily}`;
    const key = `${fontSpec}|${text}`;
    const cached = readMeasureCache(key);
    if (cached !== undefined) return cached;
    let measured;
    try {
        const layout = layoutWithLines(prepareWithSegments(text, fontSpec), 99999, fontSize * 1.2);
        measured = layout.lines[0]?.width ?? text.length * fontSize * 0.6;
    } catch {
        measured = text.length * fontSize * 0.6;
    }
    const width = Math.max(fontSize * 0.08, measured);
    writeMeasureCache(key, width);
    return width;
};

const measureTemperaGrapheme = (ctx, char, fontSize) => (
    char.trim().length === 0 ? fontSize * 0.3 : measureText(ctx, char, fontSize)
);



// Measures one word and lays its graphemes out inside the shaped width, so the sum of the
// per-glyph advances always equals what pretext reports for the whole word.
const buildTemperaWordUnit = (
    ctx,
    segment,
    lineIndex,
    segmentIndex,
    fontSize,
    scale,
) => {
    const glyphs = segment.graphemes.filter(grapheme => grapheme.char.length > 0);
    if (glyphs.length === 0) return null;
    const scaledSize = fontSize * scale;
    const raw = glyphs.map(grapheme => measureTemperaGrapheme(ctx, grapheme.char, scaledSize));
    const rawTotal = raw.reduce((sum, value) => sum + value, 0);
    const shaped = measureText(ctx, segment.text.replace(/\s+$/u, ''), scaledSize);
    // Distribute the shaping difference proportionally instead of nudging a single glyph.
    const correction = rawTotal > 0 ? shaped / rawTotal : 1;
    let offset = 0;
    const placed = glyphs.map((grapheme, index) => {
        const width = raw[index] * correction;
        const glyph = {
            char: grapheme.char,
            startTime: grapheme.startTime,
            endTime: grapheme.endTime,
            offset,
            width,
        };
        offset += width;
        return glyph;
    });
    return {
        lineIndex,
        segmentIndex,
        text: segment.text,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        leadingGap: 0,
        scale,
        width: offset,
        glyphs: placed,
        startTime: placed[0].startTime,
        endTime: placed[placed.length - 1].endTime,
    };
};

  /* ---- tempera/temperaLayout.ts ---- */
// src/components/visualizer/tempera/temperaLayout.ts
// Collage typesetting: Intl.Segmenter words (resolved at compile time) are measured through
// pretext, packed into ragged rows inside the shot's region, then each row and word gets a
// seeded indent / baseline shift / rotation. The result keeps a readable reading order while
// looking assembled rather than typed.




const TAU = Math.PI * 2;

const isTemperaLayoutSegment = (segment) => segment.text.trim().length > 0;

// Regions and entrance vectors are data, held per composition in temperaShotProfiles.
const resolveRegion = (shotKind, width, height) => {
    const { region } = resolveTemperaShotProfile(shotKind);
    return {
        centerX: region.cx * width,
        centerY: region.cy * height,
        width: region.w * width,
        height: region.h * height,
        align: region.align,
        rotation: region.rotation,
        fontScale: region.fontScale,
    };
};

const resolveEnterVector = (shotKind, fontSize) => {
    const { enter } = resolveTemperaShotProfile(shotKind);
    return { x: enter.x * fontSize, y: enter.y * fontSize };
};

const rotateAbout = (x, y, cx, cy, angle) => {
    if (angle === 0) return { x, y };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - cx;
    const dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
};

// One word per lyric line is promoted to a hero size; the rest vary slightly around the base
// so a row reads as a composed group instead of a uniform strip.
const resolveWordScales = (segments, seed, lineIndex) => {
    const lengths = segments.map(segment => (segment.isWordLike ? segment.graphemes.length : 0));
    const maxLength = Math.max(0, ...lengths);
    const heroCandidates = lengths.flatMap((length, index) => (
        length > 0 && length >= maxLength - 1 ? [index] : []
    ));
    const heroIndex = heroCandidates.length > 0
        ? heroCandidates[Math.floor(temperaHash01(seed, lineIndex, 101) * heroCandidates.length) % heroCandidates.length]
        : -1;
    // A wide gap between the hero and the rest is what gives the shot a center of gravity.
    return segments.map((_, index) => (
        index === heroIndex
            ? 1.34 + temperaHash01(seed, lineIndex * 31 + index, 103) * 0.26
            : 0.7 + temperaHash01(seed, lineIndex * 31 + index, 107) * 0.16
    ));
};

// Greedy packing with a seeded per-row fill budget, which is what makes the rows ragged.
// A new lyric line always starts a new row so the reading order stays obvious.
const packRows = (words, maxWidth, seed) => {
    const rows = [];
    let current = [];
    let currentWidth = 0;
    const budgetFor = (rowIndex) => maxWidth * (0.72 + temperaHash01(seed, rowIndex, 109) * 0.28);
    const flush = () => {
        if (current.length === 0) return;
        rows.push({ words: current, width: currentWidth, height: 0 });
        current = [];
        currentWidth = 0;
    };

    words.forEach(word => {
        const newLine = current.length > 0 && word.lineIndex !== current[0].lineIndex;
        const advance = current.length === 0 ? word.width : word.width + word.leadingGap;
        if (newLine || (current.length > 0 && currentWidth + advance > budgetFor(rows.length))) flush();
        currentWidth += current.length === 0 ? word.width : advance;
        current.push(word);
    });
    flush();
    return rows;
};

/**
 * Word segmentation exists to pick font sizes, not to space the text out. The gap before a
 * word is a real space only when the source actually had whitespace there; a plain
 * segmentation boundary (every CJK word break) gets nothing but an optical hair.
 */
const buildWordUnits = (
    ctx,
    lines,
    fontSize,
    seed,
) => lines.flatMap((segments, lineIndex) => {
    const scales = resolveWordScales(segments, seed, lineIndex);
    let previousEnd = null;
    return segments.flatMap((segment, segmentIndex) => {
        const unit = buildTemperaWordUnit(ctx, segment, lineIndex, segmentIndex, fontSize, scales[segmentIndex]);
        if (!unit) return [];
        const spaced = previousEnd !== null && segment.startOffset > previousEnd;
        unit.leadingGap = previousEnd === null ? 0 : fontSize * (spaced ? 0.26 : 0.035);
        previousEnd = segment.endOffset;
        return [unit];
    });
});

/** Shortest entrance any glyph gets, whatever else the shot's pace says. */
const MIN_SETTLE_SECONDS = 0.34;
/**
 * Default for how much of the way to the shot's lyric end an entrance stretches, past the
 * floor. Exposed as a tuning (`glyphSettleStretch`); this is the single dial between the two
 * behaviours that were tried on their own:
 *
 * - 0 gives every glyph the same short window regardless of where it sits in the shot. Dense,
 *   quickly cut songs read percussively that way - each glyph snaps in ~0.09s and then holds -
 *   but a slow phrase lands everything in the first second and then nothing moves.
 * - 1 lands the whole shot exactly on its lyric end. That keeps a slow phrase alive the whole
 *   way through, but leaves a fast shot with no moment at rest at all: the mean dwell before
 *   the cut goes to zero, every glyph is still travelling, and the type reads as mush.
 *
 * Half keeps most of the shot settled before it cuts while still giving a long phrase an
 * entrance that runs deep into it.
 */
const DEFAULT_SETTLE_STRETCH = 0.5;

/**
 * Paces every entrance against the end of the lyric *this shot* carries, then sets the
 * post-sung release.
 *
 * A glyph starts on its own lyric time and its window is the floor plus a share of whatever
 * distance is left to that end, so the stagger shortens smoothly from the first glyph to the
 * last and the shot arrives as one sweep rather than as a row of independent pops. Because the
 * curve is heavily front-loaded, a long window is a decisive opening followed by a slow creep,
 * not a slow arrival.
 *
 * The target is the shot's own lyric end. By default a shot shows a half-phrase and one source
 * line commonly runs across several shots; whole-line mode instead makes that shot end equal
 * the line's lyric end. In either case `lines` is already the exact slice set this shot carries,
 * and slices shown together are paced together. Only a glyph that starts within the floor of
 * the end lands after it.
 *
 * The alpha and echo ramps do not follow this window (see temperaMotion): a glyph that stayed
 * half-transparent for the length of a shot would not be readable.
 *
 * The release is separate: a glyph that stops moving the moment it has been sung leaves the
 * whole line frozen for the rest of a long shot, so the block slowly widens its tracking from
 * its centre outward and each glyph's lever arm is simply its offset from that centre. That
 * ramp lasts as long as the glyph's own line and no longer.
 */
const applyGlyphTiming = (placements, settleStretch) => {
    if (placements.length === 0) return placements;
    const stretch = Number.isFinite(settleStretch) ? Math.min(1, Math.max(0, settleStretch)) : DEFAULT_SETTLE_STRETCH;
    const lineSpans = new Map();
    placements.forEach(placement => {
        const current = lineSpans.get(placement.lineIndex) ?? 0;
        lineSpans.set(placement.lineIndex, Math.max(current, placement.endTime));
    });
    const lineStarts = new Map();
    placements.forEach(placement => {
        const current = lineStarts.get(placement.lineIndex) ?? Number.POSITIVE_INFINITY;
        lineStarts.set(placement.lineIndex, Math.min(current, placement.startTime));
    });

    // Every placement here belongs to the one shot being laid out.
    const shotLyricEnd = placements.reduce((latest, p) => Math.max(latest, p.endTime), 0);
    placements.forEach(placement => {
        const reach = Math.max(0, shotLyricEnd - placement.startTime - MIN_SETTLE_SECONDS);
        placement.settleTime = placement.startTime + MIN_SETTLE_SECONDS + reach * stretch;
    });
    // Centre of the composed block; the expansion is measured from here, so the layout keeps
    // its exact shape and only its spacing opens up.
    const centerX = placements.reduce((sum, placement) => sum + placement.x, 0) / placements.length;
    const centerY = placements.reduce((sum, placement) => sum + placement.y, 0) / placements.length;
    placements.forEach(placement => {
        const span = Math.max(
            0.5,
            (lineSpans.get(placement.lineIndex) ?? placement.endTime)
            - (lineStarts.get(placement.lineIndex) ?? placement.startTime),
        );
        placement.releaseTime = Math.max(placement.endTime, placement.settleTime) + span;
        placement.trackingX = placement.x - centerX;
        placement.trackingY = placement.y - centerY;
    });

    return placements;
};

const resolveTemperaLayout = ({
    lines,
    shotKind,
    width,
    height,
    baseFontSize,
    fontFamily,
    fontWeight,
    seed,
    segmentColors,
    settleStretch = DEFAULT_SETTLE_STRETCH,
}) => {
    const region = resolveRegion(shotKind, width, height);
    const ctx = createTemperaMeasureContext(fontFamily, fontWeight);

    // Fit loop: shrink until the packed rows sit inside the region.
    let fontSize = Math.max(14, baseFontSize * region.fontScale);
    let rows = [];
    let blockHeight = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        rows = packRows(buildWordUnits(ctx, lines, fontSize, seed), region.width, seed);
        rows.forEach((row, rowIndex) => {
            const tallest = Math.max(...row.words.map(word => word.scale));
            // Tight leading: the block should read as one mass, not as spaced-out lines.
            row.height = fontSize * tallest * (1.02 + temperaHash01(seed, rowIndex, 113) * 0.1);
        });
        blockHeight = rows.reduce((sum, row) => sum + row.height, 0);
        const maxRowWidth = Math.max(1, ...rows.map(row => row.width));
        const fit = Math.min(
            1,
            blockHeight > region.height ? region.height / blockHeight : 1,
            maxRowWidth > region.width ? region.width / maxRowWidth : 1,
        );
        if (fit >= 0.999) break;
        fontSize *= fit;
    }

    const base = resolveEnterVector(shotKind, fontSize);
    const baseAngle = Math.atan2(base.y, base.x);
    const baseMagnitude = Math.hypot(base.x, base.y);
    const placements = [];
    let cursorY = region.centerY - blockHeight / 2;

    rows.forEach((row, rowIndex) => {
        const rowCenterY = cursorY + row.height / 2;
        cursorY += row.height;
        // Rows stagger horizontally and tilt slightly; that is the layered collage read.
        const drift = (temperaHash01(seed, rowIndex, 127) - 0.5) * region.width * 0.06;
        const rowRotation = (temperaHash01(seed, rowIndex, 131) - 0.5) * 0.06;
        const rowLeft = region.align === 'center'
            ? region.centerX - row.width / 2 + drift
            : region.align === 'left'
                ? region.centerX - region.width / 2 + Math.abs(drift) * 0.6
                : region.centerX + region.width / 2 - row.width - Math.abs(drift) * 0.6;
        const rowCenterX = rowLeft + row.width / 2;

        let cursorX = rowLeft;
        row.words.forEach((word, wordIndex) => {
            const salt = rowIndex * 37 + wordIndex;
            // One entrance style per word: neighbouring words arrive differently, but a word
            // never breaks apart into several different gestures.
            const enterStyle = TEMPERA_ENTER_STYLES[
                Math.floor(temperaHash01(seed, salt, 193) * TEMPERA_ENTER_STYLES.length)
                % TEMPERA_ENTER_STYLES.length
            ];
            const wordRotation = (temperaHash01(seed, salt, 137) - 0.5) * 0.07;
            const wordShiftY = (temperaHash01(seed, salt, 139) - 0.5) * fontSize * 0.09;
            const wordLeft = cursorX + (wordIndex === 0 ? 0 : word.leadingGap);
            cursorX = wordLeft + word.width;
            const wordCenterX = wordLeft + word.width / 2;
            const wordCenterY = rowCenterY + wordShiftY;
            const glyphSize = fontSize * word.scale;

            word.glyphs.forEach((glyph, glyphIndex) => {
                if (glyph.char.trim().length === 0) return;
                const localX = wordLeft + glyph.offset + glyph.width / 2;
                const rotatedWord = rotateAbout(localX, wordCenterY, wordCenterX, wordCenterY, wordRotation);
                const rotatedRow = rotateAbout(rotatedWord.x, rotatedWord.y, rowCenterX, rowCenterY, rowRotation);
                const finalPoint = rotateAbout(
                    rotatedRow.x,
                    rotatedRow.y,
                    region.centerX,
                    region.centerY,
                    region.rotation,
                );

                // Per-glyph entrance: the shot's base direction fanned out and re-scaled, so
                // no two glyphs in a row arrive on exactly the same vector.
                const glyphSalt = salt * 53 + glyphIndex;
                const spread = (temperaHash01(seed, glyphSalt, 149) - 0.5) * 1.7;
                const magnitude = baseMagnitude * (0.55 + temperaHash01(seed, glyphSalt, 151) * 1.05);
                const angle = baseAngle + spread;
                placements.push({
                    char: glyph.char,
                    lineIndex: word.lineIndex,
                    segmentIndex: word.segmentIndex,
                    x: finalPoint.x,
                    y: finalPoint.y,
                    rotation: region.rotation + rowRotation + wordRotation,
                    startTime: glyph.startTime,
                    endTime: glyph.endTime,
                    settleTime: glyph.endTime,
                    fontSize: glyphSize,
                    color: segmentColors?.[word.lineIndex]?.[word.segmentIndex] ?? null,
                    enterX: Math.cos(angle) * magnitude,
                    enterY: Math.sin(angle) * magnitude,
                    enterRotation: (temperaHash01(seed, glyphSalt, 157) - 0.5) * 0.7,
                    enterScale: 0.6 + temperaHash01(seed, glyphSalt, 163) * 0.3,
                    enterStyle,
                    releaseTime: 0,
                    trackingX: 0,
                    trackingY: 0,
                });
            });
        });
    });

    return applyGlyphTiming(placements, settleStretch);
};

  /* ---- tempera/temperaTextView.ts ---- */
// src/components/visualizer/tempera/temperaTextView.ts
// Builds one Pixi Text node per grapheme plus an offset ghost copy for print misregistration.
//
// The ghost lives *inside* the inverted layer, not below it. Below it, the ghost becomes part
// of the backdrop the filter samples: each glyph then flips colour against its own shadow and
// breaks into hard patches along its strokes. Inside the layer the filter colours ghost and
// glyph alike, so the offset copy reads as a second printing plate instead of corrupting the
// decision. Nothing is ever painted behind a glyph to emphasise it either - the inversion
// against the artwork is the emphasis.



const SHADOW_OFFSET_X = 0.06;
const SHADOW_OFFSET_Y = 0.08;
/** The ghost is tinted by the filter, so only its opacity is its own. */
const SHADOW_ALPHA = 0.34;
const buildTemperaTextViews = (
    pixi,
    options,
) => {
    const { Text, TextStyle } = pixi;
    const { palette, fontFamily, fontWeight } = options;
    const views = [];
    const weightToken = String(fontWeight);

    options.placements.forEach(placement => {
        if (placement.char.trim().length === 0) return;
        const baseStyle = {
            fontFamily,
            fontWeight: weightToken,
            fontSize: placement.fontSize,
        };
        const display = new Text({
            text: placement.char,
            style: new TextStyle({ ...baseStyle, fill: placement.color ?? palette.ink }),
        });
        display.anchor.set(0.5);
        display.position.set(placement.x, placement.y);
        display.rotation = placement.rotation;

        // Unblurred offset copy at partial alpha; the filter tints it with the glyph, so it
        // reads as an off-register second printing plate.
        let shadow = null;
        if (options.shadowEnabled) {
            shadow = new Text({
                text: placement.char,
                style: new TextStyle({ ...baseStyle, fill: palette.ink }),
            });
            shadow.anchor.set(0.5);
            shadow.rotation = placement.rotation;
            options.textLayer.addChildAt(shadow, 0);
        }

        // Motion echoes: dimmed copies parked further back along the entrance vector. The
        // runtime scales their offset per index, so they read as a trail rather than a blur.
        const echoes = [];
        for (let index = 0; index < options.echoCount; index += 1) {
            const echo = new Text({
                text: placement.char,
                style: new TextStyle({ ...baseStyle, fill: placement.color ?? palette.tone4 }),
            });
            echo.anchor.set(0.5);
            echo.rotation = placement.rotation;
            echo.visible = false;
            options.echoLayer.addChild(echo);
            echoes.push(echo);
        }

        (placement.color ? options.keywordLayer : options.textLayer).addChild(display);
        views.push({
            display,
            shadow,
            echoes,
            motion: {
                startTime: placement.startTime,
                settleTime: placement.settleTime,
                endTime: placement.endTime,
                enterX: placement.enterX,
                enterY: placement.enterY,
                enterRotation: placement.enterRotation,
                enterScale: placement.enterScale,
                rotation: placement.rotation,
                enterStyle: placement.enterStyle,
                releaseTime: placement.releaseTime,
                trackingX: placement.trackingX,
                trackingY: placement.trackingY,
            },
            baseX: placement.x,
            baseY: placement.y,
            shadowDX: placement.fontSize * SHADOW_OFFSET_X,
            shadowDY: placement.fontSize * SHADOW_OFFSET_Y,
        });
    });

    return views;
};


// Stray glyphs parked in the margins of sparse compositions. They carry no timeline: the
// shot's own enter/exit alpha covers them, so playback never touches these nodes.
const buildTemperaFragmentViews = (
    pixi,
    options,
) => {
    const { Text, TextStyle } = pixi;
    options.fragments.forEach(fragment => {
        const node = new Text({
            text: fragment.char,
            style: new TextStyle({
                fontFamily: options.fontFamily,
                fontWeight: String(options.fontWeight),
                fontSize: Math.max(12, options.baseFontSize * fragment.scale),
                fill: options.palette.ink,
            }),
        });
        node.anchor.set(0.5);
        node.position.set(fragment.x * options.width, fragment.y * options.height);
        node.rotation = fragment.rotation;
        node.alpha = 0.42;
        options.layer.addChild(node);
    });
};


/**
 * Oversized decorative word behind the composition. It is deliberately placed *below* the
 * inverted text layer, so the lyric flips colour where it crosses the watermark's strokes -
 * the decoration becomes part of the artwork the type reacts to, not a second lyric.
 */
const buildTemperaWatermark = (
    pixi,
    options,
) => {
    const { watermark } = options;
    if (!watermark.text.trim()) return;
    const node = new pixi.Text({
        text: watermark.text,
        style: new pixi.TextStyle({
            fontFamily: options.fontFamily,
            fontWeight: String(options.fontWeight),
            fontSize: Math.max(48, options.baseFontSize * watermark.scale),
            fill: options.palette.tone4,
        }),
    });
    node.anchor.set(0.5);
    node.position.set(watermark.x * options.width, watermark.y * options.height);
    node.rotation = watermark.rotation;
    node.alpha = 0.16;
    options.layer.addChild(node);
};


  window.foliaTemperaText = {
    setTemperaPretext: setTemperaPretext,
    createTemperaMeasureContext: createTemperaMeasureContext,
    measureTemperaGrapheme: measureTemperaGrapheme,
    buildTemperaWordUnit: buildTemperaWordUnit,
    isTemperaLayoutSegment: isTemperaLayoutSegment,
    resolveTemperaLayout: resolveTemperaLayout,
    buildTemperaTextViews: buildTemperaTextViews,
    buildTemperaFragmentViews: buildTemperaFragmentViews,
    buildTemperaWatermark: buildTemperaWatermark
  };
}());
