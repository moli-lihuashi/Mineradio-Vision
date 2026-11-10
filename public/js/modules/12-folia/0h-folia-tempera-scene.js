/* tempera 的段落场景装配：关键字着色、图片层、构图+字+水印+叠加的顺序、片尾海报。
 * 源：src/components/visualizer/wordColoring.ts（29-176，只搬 prepareWordColorMatchers /
 *      buildWordColorRangesFromMatchers 及其私有助手）+ temperaSceneBuilder.ts（616）
 *      + temperaCreditsLayer.ts（138）
 * 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. 子节点顺序就是反色滤镜读到的内容：blocks → back 图片 → 水印 → 文字层（挂反色）→ 回声层 →
 *    关键字层 → front 图片。任何字形都不能放进水印那层，否则每个字都会对着自己的影子翻色。
 * 2. 文字层滤镜只挂**文字层**：blendRequired 每帧会抄一遍覆盖范围内的像素，挂到整场景就是视口大小的 blit。
 * 3. 片尾海报围绕自身原点绘制，容器 pivot 必须留在 0；再加一个视口 pivot 会把整张卡停到左上角。
 * 4. 海报的 mass 圆心全在画框外，弧线才会横过标题；这是"标题同时压在两三条色阶边界上"的来源。
 * 5. 间奏 shot 没有字要揭晓，呼吸可以从 shot 起点就开始（revealDoneTime = shot.startTime）。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var motion = window.foliaTemperaMotion;
  var mg = window.foliaTemperaMg;
  var filters = window.foliaTemperaFilters;
  var blocks = window.foliaTemperaBlocks;
  var text = window.foliaTemperaText;
  var layers = window.foliaTemperaLayers;
  if (!motion || !mg || !filters || !blocks || !text || !layers) return;

  var resolveThemeFontStack = (typeof foliaResolveThemeFontStack === 'function') ? foliaResolveThemeFontStack : null;
  var resolveThemeFontWeight = (typeof foliaResolveThemeFontWeight === 'function') ? foliaResolveThemeFontWeight : null;
  var hashTemperaSeed = mg.hashSeed;
  var temperaHash01 = mg.hash01;
  var easeTemperaEnter = motion.easeTemperaEnter;
  var resolveTemperaPalette = mg.resolvePalette;
  var buildTemperaBlocks = blocks.buildTemperaBlocks;
  var isTemperaLayoutSegment = text.isTemperaLayoutSegment;
  var resolveTemperaLayout = text.resolveTemperaLayout;
  var buildTemperaFragmentViews = text.buildTemperaFragmentViews;
  var buildTemperaTextViews = text.buildTemperaTextViews;
  var buildTemperaWatermark = text.buildTemperaWatermark;
  var createTemperaDifferenceFilter = filters.createTemperaDifferenceFilter;
  var resolveTemperaPassResolution = filters.resolveTemperaPassResolution;
  var resolveTemperaTransitionBlurResolution = filters.resolveTemperaTransitionBlurResolution;
  var buildTemperaImageLayer = layers.buildTemperaImageLayer;
  var buildCrossRow = mg.buildCrossRow;
  var buildCrossingLines = mg.buildCrossingLines;
  var buildDotGrid = mg.buildDotGrid;
  var buildHatchSpec = mg.buildHatchSpec;
  var circlePolygon = mg.circlePolygon;
  var rectPolygon = mg.rectPolygon;
  var drawCrossMarks = mg.drawCrossMarks;
  var drawHatchFill = mg.drawHatchFill;
  var drawLines = mg.drawLines;
  var drawPolygonFill = mg.drawPolygonFill;
  var drawPolygonOutline = mg.drawPolygonOutline;
  var drawSquareMarks = mg.drawSquareMarks;
  var createSonnetPostProcessFilters = filters.createSonnetPostProcessFilters;
  var destroyPixiContainerChildren = layers.destroyPixiContainerChildren;
  var destroyPixiDisplayTree = layers.destroyPixiDisplayTree;
  var easeTemperaInOut = motion.easeTemperaInOut;
  var destroyTemperaGradientFills = mg.destroyGradientFills;

  /* 裸函数缺失（10-folia-core-text.js 没加载）时整块退出，不把后续模块带崩。 */
  if (!resolveThemeFontStack || !resolveThemeFontWeight) return;

  /* ---- wordColoring.ts:29-176 ---- */
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

  /* ---- tempera/temperaSceneBuilder.ts ---- */
// src/components/visualizer/tempera/temperaSceneBuilder.ts
// Builds one bounded paragraph scene; playback-time mutation remains in the runtime controller.

/**
 * The lyric's colour filter. In gradient mode the ramp only exists as this filter's tint, so
 * switching `textInversion` off must not take the filter with it - that would drop the whole
 * colour mode back to flat ink. Without a ramp and without the inversion there is nothing left
 * to do, and the layer stays unfiltered.
 */
const createTemperaTextFilter = (
    pixi,
    palette,
    inversion,
) => {
    if (!inversion && !palette.textGradient) return null;
    return createTemperaDifferenceFilter(pixi, {
        ink: palette.ink,
        paper: palette.paper,
        tint: palette.textGradient,
        inversion,
    });
};





const hasTemperaCreditsMetadata = (metadata) => Boolean(
    (metadata.title && metadata.title.trim())
    || (metadata.artist && metadata.artist.trim())
    || (metadata.album && metadata.album.trim()),
);

/**
 * Closing card. It is assembled from the same vocabulary as the shot compositions - a flat
 * tone ground, opaque tone masses with hard ink seams, one screentone hatch pass, and the
 * shared crossing lines and corner motif - so the outro reads as one more shot rather than as
 * a separate title screen bolted onto the end of the song.
 *
 * The masses are partial discs whose centres all sit outside the frame: each sweeps in from
 * its own edge and the arcs cross over the middle, so the title straddles two or three tone
 * boundaries at once and the inversion filter flips it mid-word.
 *
 * Everything is drawn around the container's own origin, so the runtime centres it by position
 * alone; giving this container a viewport pivot as well is what once parked the whole poster
 * in the top-left corner with half of it off screen.
 */



/** Asymptotic: always moving, never running away. */
const creditsCreep = (elapsed) => 1 - Math.exp(-Math.max(0, elapsed) / 7);

/** How many masses press in. Three is enough to cross over the type without muddying it. */
const CREDITS_DISC_COUNT = 3;

const buildTemperaCreditsPoster = (
    pixi,
    options,
) => {
    const { palette, metadata, width, height } = options;
    const { Container, Text, TextStyle } = pixi;
    const container = new Container();
    const filters = [];
    const items = [];
    const seed = hashTemperaSeed(`${metadata.title ?? ''}|${metadata.artist ?? ''}`);
    const diagonal = Math.hypot(width, height);
    const bleed = diagonal * 0.25;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    // One seeded bit mirrors the whole layout, so the card is not always the same picture.
    const flip = temperaHash01(seed, 1, 229) > 0.5 ? 1 : -1;
    // Gradient mode ramps every shot's fills; without this the card would be the one flat
    // frame in the song, which is exactly what reads as a foreign design.
    const gradient = palette.gradient
        ? { colors: palette.gradient, angle: temperaHash01(seed, 3, 197) * Math.PI * 2 }
        : null;

    const add = (
        node,
        item = {},
    ) => {
        items.push({
            node,
            baseX: node.x,
            baseY: node.y,
            baseAlpha: item.baseAlpha ?? 1,
            enterDX: item.enterDX ?? 0,
            enterDY: item.enterDY ?? 0,
            delay: item.delay ?? 0,
            driftX: item.driftX ?? 0,
            driftY: item.driftY ?? 0,
            grow: item.grow ?? 0,
        });
        container.addChild(node);
    };

    // The tone ground, exactly as a composition lays it: full bleed, no motion of its own.
    container.addChild(drawPolygonFill(
        pixi,
        rectPolygon(-halfWidth - bleed, -halfHeight - bleed, width + bleed * 2, height + bleed * 2),
        palette.tone1,
        1,
        gradient,
    ));

    // The masses climb the tone ladder as they stack, so the last one in is the brightest and
    // the type has a real edge to cross rather than three near-identical greys.
    const tones = [palette.tone2, palette.tone3, palette.tone4];
    const baseAngle = temperaHash01(seed, 4, 241) * Math.PI * 2;
    const hatchIndex = Math.floor(temperaHash01(seed, 5, 251) * CREDITS_DISC_COUNT) % CREDITS_DISC_COUNT;

    for (let index = 0; index < CREDITS_DISC_COUNT; index += 1) {
        // Spread around the frame, then jittered inside its own share of the circle.
        const angle = baseAngle
            + (index * Math.PI * 2) / CREDITS_DISC_COUNT
            + (temperaHash01(seed, index, 257) - 0.5) * 0.7;
        const distance = diagonal * (0.58 + temperaHash01(seed, index, 263) * 0.14);
        // The near edge lands past the middle, which is what makes the arcs cross the type.
        const radius = distance + diagonal * (0.06 + temperaHash01(seed, index, 269) * 0.1);
        const polygon = circlePolygon(0, 0, radius, 72);
        const cx = Math.cos(angle) * distance;
        const cy = Math.sin(angle) * distance;
        const delay = 0.08 + index * 0.16;
        // Enters along its own inward vector and keeps creeping the same way afterwards.
        const travel = {
            enterDX: Math.cos(angle) * diagonal * 0.16,
            enterDY: Math.sin(angle) * diagonal * 0.16,
            driftX: -Math.cos(angle) * diagonal * 0.024,
            driftY: -Math.sin(angle) * diagonal * 0.024,
        };
        const place = (node, itemDelay) => {
            node.position.set(cx, cy);
            add(node, { ...travel, delay: itemDelay });
        };

        place(drawPolygonFill(pixi, polygon, tones[index], 1, gradient), delay);
        if (index === hatchIndex) {
            // The one screentone pass. Without it the card is flat vector art, which is the
            // single thing none of the shot compositions ever are.
            place(drawHatchFill(pixi, polygon, buildHatchSpec(seed, 271), palette.paper, 0.28), delay + 0.06);
        }
        // Seam weight matches addSeam in the split compositions: hard ink, not a hairline.
        place(drawPolygonOutline(pixi, polygon, palette.ink, 2.4, 0.8), delay + 0.04);
    }

    // The two layers every shot carries: full-bleed guide lines, then a corner motif.
    const lines = buildCrossingLines(seed, 31, width, height, 2)
        .map(line => ({
            x1: line.x1 - halfWidth,
            y1: line.y1 - halfHeight,
            x2: line.x2 - halfWidth,
            y2: line.y2 - halfHeight,
        }));
    add(drawLines(pixi, lines, palette.tone4, 1.3, 0.6), { delay: 0.5, enterDX: width * 0.2 });

    if (options.tuning.showDecor) {
        const cornerX = halfWidth * 0.66 * flip;
        const cornerY = halfHeight * 0.62;
        add(drawCrossMarks(
            pixi,
            buildCrossRow(seed, 71, cornerX - width * 0.1, cornerY, 5, width * 0.05, 8),
            palette.tone4,
            2,
            0.8,
        ), { delay: 0.62, enterDX: -width * 0.06 });
        const box = rectPolygon(-cornerX - 19, -cornerY - 19, 38, 38);
        add(drawHatchFill(pixi, box, buildHatchSpec(seed, 67), palette.tone4, 0.7), { delay: 0.68, grow: 0.06 });
        add(drawPolygonOutline(pixi, box, palette.tone4, 1.2, 0.6), { delay: 0.72 });
    }

    const fontFamily = resolveThemeFontStack(options.theme);
    const fontWeight = String(resolveThemeFontWeight(options.theme, 600));
    const wrapWidth = Math.min(width * 0.72, diagonal * 0.52);
    const subtitle = [metadata.artist, metadata.album].filter(Boolean).join(' - ');
    const titleLayer = new Container();
    const titleSize = Math.max(26, Math.min(width, height) * 0.085 * options.lyricsFontScale);

    const buildLine = (text, size, offsetY, alpha) => {
        const node = new Text({
            text,
            style: new TextStyle({
                fontFamily,
                fontWeight,
                fontSize: size,
                fill: palette.ink,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: wrapWidth,
            }),
        });
        node.anchor.set(0.5);
        node.position.set(0, offsetY);
        node.alpha = alpha;
        titleLayer.addChild(node);
        return node;
    };

    const title = buildLine(metadata.title?.trim() || '\u266a', titleSize, subtitle ? -titleSize * 0.35 : 0, 1);
    if (subtitle) buildLine(subtitle, Math.max(14, titleSize * 0.34), title.height / 2 + titleSize * 0.22, 0.75);

    // The title stays put while the shapes move under it, so the inversion keeps re-cutting it.
    const titleFilter = createTemperaTextFilter(pixi, palette, options.tuning.textInversion);
    if (titleFilter) {
        titleLayer.filters = [titleFilter];
        filters.push(titleFilter);
    }
    add(titleLayer, { enterDY: diagonal * 0.03, delay: 0.78 });

    const updateTime = (elapsed) => {
        const creep = creditsCreep(elapsed);
        for (const item of items) {
            const enter = easeTemperaEnter((elapsed - item.delay) / 1.1);
            item.node.alpha = item.baseAlpha * enter;
            item.node.visible = enter > 0.001;
            item.node.position.set(
                item.baseX + item.enterDX * (1 - enter) + item.driftX * creep,
                item.baseY + item.enterDY * (1 - enter) + item.driftY * creep,
            );
            if (item.grow !== 0) item.node.scale.set(1 + item.grow * creep);
        }
    };
    updateTime(0);
    return { container, filters, updateTime };
};

// Assembles the scene post-process chain from tuning; GLSL factories are shared with sonnet.
const applyTemperaScenePostProcess = (
    pixi,
    container,
    tuning,
    seed,
    renderResolution,
) => {
    const filters = createSonnetPostProcessFilters(pixi, {
        lensDistortion: tuning.postProcessLensDistortion,
        lensDispersion: 0,
        noise: tuning.postProcessGrain * 0.35,
        contrast: tuning.postProcessContrast * 0.5,
        printEffects: {
            rgbShift: tuning.postProcessRgbShift,
            halftone: 0,
            vignette: tuning.postProcessVignette,
        },
    }, seed);
    // Every pass in the array has to carry the same resolution - Pixi keeps the minimum for the
    // whole container - and none of the shared sonnet factories set one, so they would each
    // default to a hard 1. See `resolveTemperaPassResolution` for why that softened the scene
    // and why it is safe for the inversion nested below.
    const resolution = resolveTemperaPassResolution(tuning, renderResolution);
    filters.forEach(filter => {
        filter.resolution = resolution;
    });
    if (filters.length > 0) container.filters = filters;
    return filters;
};

const buildTemperaScene = (
    pixi,
    options,
    paragraph,
) => {
    const { Container, Graphics } = pixi;
    const width = Math.max(options.host.clientWidth, 320);
    const height = Math.max(options.host.clientHeight, 240);
    const container = new Container();
    const { tuning } = options;
    const palette = resolveTemperaPalette(options.theme, tuning, options.coverColors);
    const sceneSeed = hashTemperaSeed(`${options.programSeed}:${paragraph.id}`);
    const fontFamily = resolveThemeFontStack(options.theme);
    const fontWeight = resolveThemeFontWeight(options.theme, 600);

    // A translucent paper wash unifies the block colors with the shell background, and the
    // dot lattice on top gives the whole frame its printed-paper grain. Both are built once
    // per paragraph scene and never touched again during playback.
    const paperWash = new Graphics()
        .rect(0, 0, width, height)
        .fill({ color: pixi.Color.shared.setValue(palette.paper).toNumber(), alpha: 0.35 });
    paperWash.visible = tuning.showBlocks;
    container.addChild(paperWash);
    if (tuning.showBlocks) {
        // Spacing grows with the viewport so the lattice stays around 3k dots on any display.
        const toneSpacing = Math.max(26, Math.sqrt((width * height) / 6000));
        const screentone = drawSquareMarks(pixi, buildDotGrid(width, height, toneSpacing, 1.6), palette.tone4, 0.05);
        container.addChild(screentone);
    }

    const postProcessFilters = [];
    // Tempera deliberately has no glow layer: a screen-blend halo washes the glyph toward
    // white and, wherever it lands, becomes backdrop the inversion filter has to read.
    //
    // The inversion is NOT a post-process pass: it is how this mode colors type, so it has its
    // own `textInversion` switch (default on) rather than riding `postProcessEnabled`, which
    // defaults to false and once left the effect dead for everyone.

    // 关键字着色: the theme's wordColors are matched once per line and handed to the typesetter
    // as per-segment colours. Matched glyphs opt out of the inversion filter so the hue lands.
    const wordColorMatchers = prepareWordColorMatchers(options.theme.wordColors);
    const colorRangesByLine = new Map(paragraph.lines.map(line => [
        line.sourceIndex,
        wordColorMatchers.length > 0
            ? buildWordColorRangesFromMatchers(line.line.fullText, wordColorMatchers)
            : [],
    ]));

    // Threaded so two neighbouring shots do not land on the same picture.
    let lastImageId = null;
    const shots = paragraph.shots.map((shot, shotIndex) => {
        const shotContainer = new Container();
        // A shot normally shows one half-phrase slice; whole-line mode deliberately trades
        // some of that type scale for keeping the source lyric line together.
        const sliceSegments = shot.slices.map(slice => ({
            slice,
            segments: paragraph.lines.find(item => item.sourceIndex === slice.lineIndex)
                ?.segments.slice(slice.segmentStart, slice.segmentEnd)
                .filter(isTemperaLayoutSegment) ?? [],
        })).filter(entry => entry.segments.length > 0);
        const linesSegments = sliceSegments.map(entry => entry.segments);
        const segmentColors = sliceSegments.map(entry => {
            const ranges = colorRangesByLine.get(entry.slice.lineIndex) ?? [];
            return entry.segments.map(segment => ranges.find(range => (
                range.startOffset < segment.endOffset && segment.startOffset < range.endOffset
            ))?.color ?? null);
        });

        const maxGraphemes = Math.max(3, ...linesSegments.map(
            segments => segments.reduce((sum, segment) => sum + segment.graphemes.length, 0),
        ));
        const baseFontSize = Math.max(34, Math.min(150, (
            width / Math.max(5, maxGraphemes * 1.05)
        ) * 1.5)) * options.lyricsFontScale;

        const shotSeed = sceneSeed + shotIndex * 97;
        const blocks = buildTemperaBlocks(pixi, {
            kind: shot.kind,
            decor: shot.decor,
            palette,
            width,
            height,
            seed: shotSeed,
            showDecor: tuning.showDecor,
            flowAngle: shot.flowAngle,
        });
        blocks.container.visible = tuning.showBlocks;

        const images = buildTemperaImageLayer(pixi, {
            pool: tuning.layerImages,
            frequency: tuning.layerImageFrequency,
            depth: tuning.layerImageDepth,
            textures: options.imageTextures,
            width,
            height,
            seed: shotSeed,
            flowAngle: shot.flowAngle,
            previousId: lastImageId,
        });
        lastImageId = images.chosenId ?? lastImageId;
        const watermarkLayer = new Container();
        const textLayer = new Container();
        const echoLayer = new Container();
        const keywordLayer = new Container();
        // Order matters. Everything the inversion filter should read must render before the
        // text layer - that includes the decorative watermark, which is the point of it: the
        // lyric flips colour where it crosses those strokes. Nothing glyph-shaped may go there
        // though, or each glyph inverts against its own ghost and shatters into patches.
        // Echoes and keyword-coloured glyphs render after it, unfiltered, keeping their colour.
        // A `back` image joins the artwork the inversion reads; a `front` one sits over
        // everything, including the lyric.
        shotContainer.addChild(
            blocks.container,
            images.back,
            watermarkLayer,
            textLayer,
            echoLayer,
            keywordLayer,
            images.front,
        );

        const placements = resolveTemperaLayout({
            lines: linesSegments,
            shotKind: shot.kind,
            width,
            height,
            baseFontSize,
            fontFamily,
            fontWeight,
            seed: shotSeed,
            segmentColors,
            settleStretch: tuning.glyphSettleStretch,
        });
        const glyphs = buildTemperaTextViews(pixi, {
            placements,
            palette,
            fontFamily,
            fontWeight,
            shadowEnabled: tuning.showDecor,
            echoCount: tuning.showDecor && !options.staticMode ? 2 : 0,
            textLayer,
            echoLayer,
            keywordLayer,
        });
        if (shot.decor.watermark && tuning.showDecor) {
            buildTemperaWatermark(pixi, {
                watermark: shot.decor.watermark,
                palette,
                fontFamily,
                fontWeight,
                baseFontSize,
                width,
                height,
                layer: watermarkLayer,
            });
        }
        if (shot.decor.fragments.length > 0 && tuning.showDecor) {
            buildTemperaFragmentViews(pixi, {
                fragments: shot.decor.fragments,
                palette,
                fontFamily,
                fontWeight,
                baseFontSize,
                width,
                height,
                layer: textLayer,
            });
        }
        // Scoped to the text layer only: blendRequired copies the pixels under these bounds
        // every frame, so a full-scene filter here would be a viewport-sized blit. In gradient
        // colour mode the ramp rides along as a tint - the filter still decides the luminance,
        // which is the only thing keeping the lyric readable over arbitrary artwork. With the
        // inversion switched off the same ramp is applied on its own, with no backdrop read.
        const textFilter = createTemperaTextFilter(pixi, palette, tuning.textInversion);
        if (textFilter) {
            textLayer.filters = [textFilter];
            postProcessFilters.push(textFilter);
        }
        // A bridge shot has no type to reveal, so the camera breath may start immediately -
        // an instrumental gap should not hold a rigid frame.
        const revealDoneTime = glyphs.length > 0
            ? Math.max(...glyphs.map(glyph => glyph.motion.settleTime))
            : shot.startTime;

        shotContainer.pivot.set(width / 2, height / 2);
        shotContainer.position.set(width / 2, height / 2);
        // The runtime opts shots into rendering from absolute playback time.
        shotContainer.visible = false;
        container.addChild(shotContainer);
        return {
            shot,
            container: shotContainer,
            glyphs,
            blocks,
            images,
            baseX: shotContainer.x,
            baseY: shotContainer.y,
            textLayer,
            revealDoneTime,
        };
    });

    const baseFilters = [];
    if (tuning.postProcessEnabled && !options.staticMode) {
        const sceneFilters = applyTemperaScenePostProcess(pixi, container, tuning, sceneSeed, options.renderResolution);
        if (sceneFilters.length > 0) {
            // Keep full-scene shaders in viewport space even when visible bounds are smaller.
            container.filterArea = new pixi.Rectangle(0, 0, width, height);
            baseFilters.push(...sceneFilters);
            postProcessFilters.push(...sceneFilters);
        }
    }

    const transitionBlurFilter = tuning.enableTransitions && !options.staticMode
        ? new pixi.BlurFilter({
            strength: 0,
            quality: 1,
            kernelSize: 5,
            resolution: resolveTemperaTransitionBlurResolution(tuning, options.renderResolution),
        })
        : null;
    if (transitionBlurFilter) {
        // Pins padding at 0 so ramping blur never rescales the shared vignette pass.
        transitionBlurFilter.repeatEdgePixels = true;
        // Left attached-but-disabled it becomes a skipped stack entry that misplaces the
        // inversion's backdrop copy, so the runtime attaches it per transition instead -
        // see `temperaSceneFilters.ts`.
        postProcessFilters.push(transitionBlurFilter);
    }
    container.visible = false;
    return {
        paragraph,
        container,
        shots,
        palette,
        postProcessFilters,
        baseFilters,
        transitionBlurFilter,
        transitionBlurAttached: false,
        activeShotIndex: -1,
    };
};

  /* ---- tempera/temperaCreditsLayer.ts ---- */
// src/components/visualizer/tempera/temperaCreditsLayer.ts
// 片尾海报层：建海报（可离屏建好留给换歌交接）、装进 credits 容器、按最后一段结束后的时间淡入。
// 不持有歌曲或设置，每次调用都由运行时传入当下的值。



// Simple credits fade: the poster rises once the final paragraph's lyric tail ends.
const resolveTemperaCreditsFrame = (time, finalEndTime) => {
    const lyricAlpha = 1 - easeTemperaInOut((time - finalEndTime - 0.1) / 0.9);
    const posterProgress = easeTemperaInOut((time - finalEndTime - 0.9) / 1.1);
    return {
        active: time > finalEndTime + 0.35,
        lyricAlpha,
        posterAlpha: posterProgress,
        posterOffsetY: (1 - posterProgress) * 0.06,
        posterScale: 0.96 + posterProgress * 0.04,
    };
};

class TemperaCreditsLayer {
    container;
    view = null;

    constructor(pixi) {
    this.pixi = pixi;
        this.container = new pixi.Container();
    }

    /** Whether a poster is installed; read once per frame before the scenes are posed. */
    get hasPoster() {
        return this.container.children.length > 0;
    }

    /**
     * Builds the credits poster for a song without installing it, so a handover can prepare the
     * incoming one under the block rather than on the frame the swap lands.
     */
    build(
        input,
        scenePalette,
        width,
        height,
    ){
        if (!hasTemperaCreditsMetadata(input.metadata)) return null;
        // Before any scene exists (metadata-only songs) the poster uses a freshly resolved palette.
        const palette = scenePalette
            ?? resolveTemperaPalette(input.theme, input.tuning, input.coverColors);
        return buildTemperaCreditsPoster(this.pixi, {
            theme: input.theme,
            tuning: input.tuning,
            palette,
            metadata: input.metadata,
            width,
            height,
            lyricsFontScale: input.lyricsFontScale,
        });
    }

    adopt(view, width, height) {
        this.dispose();
        this.view = view;
        if (!view) return;
        this.container.addChild(view.container);
        // The poster is already built around its own origin, so the pivot stays at zero and
        // the per-frame position alone centres it. Giving it a viewport pivot as well parked
        // the whole card in the top-left corner with half of it off screen.
        this.container.pivot.set(0, 0);
        this.container.position.set(width / 2, height / 2);
        this.container.visible = false;
    }

    dispose() {
        this.view?.container.children.forEach(child => {
            child.filters = null;
        });
        this.view?.filters.forEach(filter => filter.destroy());
        this.view = null;
        destroyTemperaGradientFills(this.pixi, this.container);
        destroyPixiContainerChildren(this.container);
    }

    /** Frees a poster that was never installed in the credits container. */
    destroyView(view) {
        view.container.children.forEach(child => {
            child.filters = null;
        });
        view.filters.forEach(filter => filter.destroy());
        destroyTemperaGradientFills(this.pixi, view.container);
        destroyPixiDisplayTree(view.container);
    }

    applyFrame(
        frame,
        hasPoster,
        time,
        finalEndTime,
        width,
        height,
    ) {
        this.container.visible = frame.active && hasPoster;
        this.container.alpha = frame.posterAlpha;
        // The card is never a still frame: shapes keep drifting under the fixed title, so the
        // inversion filter re-cuts it for as long as the outro runs.
        if (this.container.visible) {
            this.view?.updateTime(time - (finalEndTime ?? time));
        }
        this.container.position.set(
            width / 2,
            height / 2 + frame.posterOffsetY * height,
        );
        this.container.scale.set(frame.posterScale);
    }
}


  window.foliaTemperaScene = {
    prepareWordColorMatchers: prepareWordColorMatchers,
    buildWordColorRangesFromMatchers: buildWordColorRangesFromMatchers,
    hasTemperaCreditsMetadata: hasTemperaCreditsMetadata,
    buildTemperaCreditsPoster: buildTemperaCreditsPoster,
    buildTemperaScene: buildTemperaScene,
    resolveTemperaCreditsFrame: resolveTemperaCreditsFrame,
    TemperaCreditsLayer: TemperaCreditsLayer
  };
}());
