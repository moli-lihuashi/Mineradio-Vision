/* tempera 的 screentone 绘制层：十三个 composition 族 + 两个共享 kit + 共享叠加层。
 *
 * 源：src/components/visualizer/tempera/compositions/*.ts（15 个文件 2403 行）
 *     + src/components/visualizer/tempera/temperaCompositions.ts（123 行）
 * 生成：node .workbuddy/tmp/extract-tempera-compositions.js
 *   机械删类型，产物与 TS 源逐字对应；脚本自带 token 多重集校验（只准少类型 token，
 *   少一个 `ctx` / `add` 都会报错），所以「看起来一样」是有证据的。
 *
 * 必须照抄的判据
 * --------------
 * 1. 每个全片（full-bleed）形状都要越出视口 `bleed`：整张 shot 沿 flow 一直漂，画到
 *    视口边上的形状一滑就露背景。
 * 2. cutout 族（aperture / signal / corridor / monolith / terrain）的槽必须与 flow 平行 ——
 *    平行才在两个 shot 交接、整体滑动时读成一条连续走廊而不是硬切。`channelAxis` 把
 *    flowAngle 拉回一半到竖直轴，是为了别让长槽的端头滑进字里。
 * 3. cutout 族**字永远不压在洞上**：反色滤镜读的是 pixi 渲染目标，DOM 背景在 WebGL 外面，
 *    洞上滤镜只看见淡底 → 选墨色 → 墨色再压到任意背景上。洞是画，不是纸。
 * 4. `gradient` 只在该 shot 的调色板有 gradient 时非 null（temperaBlocks 按 seed 给轴）；
 *    null 时所有填充走纯色。
 * 5. `ctx.add` 的 delay / span 是 **shot 时长的比例**，由 temperaBlocks 换成秒。这里不算时间。
 * 6. 带 `drift` 的节点绕自身原点缩放 → 偏心形状必须放进 `createGroup` 的局部坐标，
 *    否则是绕画框原点公转。
 * 7. 共享叠加层（crossing lines + motif）不能压在 `sharedDecor === false` 的 kind 上：
 *    间奏卡按定义就是一片空场。
 * 8. 121 种 kind 每种都要有 drawer；缺的回落 `duo-split`。
 *
 * 与 Folia 的实现差异（三处，都不是行为差异）
 * --------------------------------------------
 * - 每个族各自一个 IIFE：`addField`（charm / signal / monogatari）这类局部名在多个族里
 *   重名，TS 靠「一文件一模块」隔离，合并 script 里只能靠函数作用域。
 * - 对象展开 `{ ...a, b }` 写成 `Object.assign({}, a, { b })`（只有共享叠加层里那两处）。
 * - 依赖走 `window.foliaTemperaMg` / `window.foliaTemperaProgram` 两个全局，不再是 TS import。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var mg = window.foliaTemperaMg;
  var program = window.foliaTemperaProgram;
  if (!mg || !program) return;

  var temperaHash01 = mg.hash01;
  var buildHatchSpec = mg.buildHatchSpec;
  var buildHatchLines = mg.buildHatchLines;
  var buildScribblePath = mg.buildScribblePath;
  var buildWavyPath = mg.buildWavyPath;
  var buildCrossRow = mg.buildCrossRow;
  var buildDotRow = mg.buildDotRow;
  var buildDotGrid = mg.buildDotGrid;
  var buildCrossingLines = mg.buildCrossingLines;
  var rectPolygon = mg.rectPolygon;
  var circlePolygon = mg.circlePolygon;
  var diamondPolygon = mg.diamondPolygon;
  var ellipsePolygon = mg.ellipsePolygon;
  var roundedRectPolygon = mg.roundedRectPolygon;
  var rotatePolygon = mg.rotatePolygon;
  var lobedPolygon = mg.lobedPolygon;
  var scallopBandPolygon = mg.scallopBandPolygon;
  var heartPolygon = mg.heartPolygon;
  var annularSectorPolygon = mg.annularSectorPolygon;
  var starPolygon = mg.starPolygon;
  var arcRibbonPolygon = mg.arcRibbonPolygon;
  var buildDiscField = mg.buildDiscField;
  var drawPolygonFill = mg.drawPolygonFill;
  var drawPolygonFillWithHoles = mg.drawPolygonFillWithHoles;
  var drawPolygonOutline = mg.drawPolygonOutline;
  var drawHatchFill = mg.drawHatchFill;
  var drawDiscs = mg.drawDiscs;
  var drawRings = mg.drawRings;
  var drawLines = mg.drawLines;
  var drawPolyline = mg.drawPolyline;
  var drawConcentricDiamonds = mg.drawConcentricDiamonds;
  var drawCrossMarks = mg.drawCrossMarks;
  var drawSquareMarks = mg.drawSquareMarks;
  var resolveTemperaShotProfile = program.resolveShotProfile;

  var __families = {};
  function __register(key, map) { __families[key] = map; }
/* ---- compositions/temperaCutout.ts ---- */
// src/components/visualizer/tempera/compositions/temperaCutout.ts
// Shared plumbing for the three families that punch holes through the tone field. A hole is
// genuinely transparent - the Pixi canvas runs on `backgroundAlpha: 0` - so it shows the
// shell's live background layer, veiled only by the scene's paper wash (which is built per
// paragraph and cannot be cut per shot).
//
// One rule governs every cutout composition: **the lyric never sits over a hole.** The
// inversion filter reads the Pixi render target, and the DOM background lives outside WebGL,
// so over a hole the filter sees only the pale wash and picks ink - which then has to survive
// on top of whatever the background happens to be. Keep the type on solid tone; the hole is
// the picture, not the page.

/** The full-bleed rectangle every composition starts from. */
const fieldPolygon = (ctx) => rectPolygon(
    -ctx.bleed,
    -ctx.bleed,
    ctx.width + ctx.bleed * 2,
    ctx.height + ctx.bleed * 2,
);


/** Full-bleed tone with `holes` punched through it. Hole outlines are separate nodes. */
const addCutField = (
    ctx,
    color,
    holes,
    options = {},
) => {
    ctx.add(
        drawPolygonFillWithHoles(ctx.pixi, fieldPolygon(ctx), holes, color, options.alpha ?? 0.94, ctx.gradient),
        { delay: options.delay ?? 0, span: options.span ?? 0.5 },
    );
};

/**
 * The ink lip around a hole. It is what keeps a cutout reading as a punched plate rather than
 * as a gap in the render, and it gives the inversion filter an edge next to the opening.
 */
const addHoleLip = (
    ctx,
    hole,
    width = 2.4,
    alpha = 0.85,
    delay = 0.1,
) => {
    ctx.add(drawPolygonOutline(ctx.pixi, hole, ctx.palette.ink, width, alpha), { delay, span: 0.5 });
};

/** A rectangle centred on (cx, cy), `length` along `angle` and `width` across it. */
const axisRect = (
    cx,
    cy,
    length,
    width,
    angle,
) => rotatePolygon(
    rectPolygon(cx - length / 2, cy - width / 2, length, width),
    cx,
    cy,
    angle,
);

/**
 * The flow angle, pulled halfway back toward its own vertical axis.
 *
 * A channel has to be parallel to the travel or the hand-off stops reading as one continuous
 * corridor - but a channel is also long, so the raw tilt (up to ~14°) walks its ends sideways
 * by around 90px on a 720px frame, which is enough to slide an opening under the type. Half
 * the tilt keeps the direction and halves the walk; the residual mismatch over one hand-off
 * slide is a handful of pixels and invisible.
 */
const channelAxis = (ctx) => {
    const axis = (Math.sin(ctx.flowAngle) >= 0 ? 1 : -1) * Math.PI / 2;
    return axis + (ctx.flowAngle - axis) * 0.5;
};

/**
 * Unit vector across the channel axis, always pointing into the +x half of the frame.
 *
 * Flow is vertical-dominant but points up in some shots and down in others, so the raw
 * perpendicular flips sides between shots. Layout regions are fixed data, so a channel offset
 * built on the raw perpendicular would sometimes land under the type. Normalising the sign
 * keeps "offset by +n" meaning "to the right" in every shot.
 */
const acrossFlow = (angle) => {
    const across = angle + Math.PI / 2;
    const sign = Math.cos(across) >= 0 ? 1 : -1;
    return { x: Math.cos(across) * sign, y: Math.sin(across) * sign };
};

/** Centre of a channel offset sideways from the frame centre by `offset` across the axis. */
const acrossPoint = (ctx, offset) => {
    const across = acrossFlow(channelAxis(ctx));
    return { x: ctx.width / 2 + across.x * offset, y: ctx.height / 2 + across.y * offset };
};

/** A point stepped `distance` along the axis from the frame centre, offset `offset` across it. */
const flowPoint = (ctx, distance, offset) => {
    const base = acrossPoint(ctx, offset);
    const angle = channelAxis(ctx);
    return {
        x: base.x + Math.cos(angle) * distance,
        y: base.y + Math.sin(angle) * distance,
    };
};

/** How far a shape must run to leave the frame on both ends whatever the flow angle. */
const flowSpan = (ctx) => Math.hypot(ctx.width, ctx.height) * 1.6;


/* ---- compositions/temperaMonolithKit.ts ---- */
// src/components/visualizer/tempera/compositions/temperaMonolithKit.ts
// The brutalist vocabulary, shared by the `monolith` and `terrain` families: one enormous
// matte mass, a couple of hairlines drawn straight across the whole picture, a face of ruled
// stripes, and a few small survey marks. The mass carries the shot on its own, so everything
// else here is deliberately thin - a monolith surrounded by decoration stops being monumental.
//
// Every mass runs past the frame on at least one side. A solid with all four edges in shot
// reads as an object sitting on a page; the same solid cropped by the frame reads as something
// too big for it, which is the entire effect.


const addMass = (
    ctx,
    polygon,
    color,
    options = {},
) => {
    ctx.add(drawPolygonFill(ctx.pixi, polygon, color, options.alpha ?? 0.95, ctx.gradient), {
        delay: options.delay ?? 0.04,
        span: options.span ?? 0.6,
        enterDX: options.enterDX ?? 0,
        enterDY: options.enterDY ?? 0,
    });
    if (options.edge === false) return;
    ctx.add(drawPolygonOutline(ctx.pixi, polygon, ctx.palette.ink, options.edgeWidth ?? 2.4, 0.8), {
        delay: (options.delay ?? 0.04) + 0.06,
        span: 0.5,
        enterDX: (options.enterDX ?? 0) * 0.6,
        enterDY: (options.enterDY ?? 0) * 0.6,
    });
};

/** The full-bleed ground the mass stands on. */
const addGround = (ctx, color, alpha = 0.94) => {
    ctx.add(
        drawPolygonFill(ctx.pixi, rectPolygon(-ctx.bleed, -ctx.bleed, ctx.width + ctx.bleed * 2, ctx.height + ctx.bleed * 2), color, alpha, ctx.gradient),
        { span: 0.5 },
    );
};

/**
 * Ruled stripes over one face of a mass. The polygon has to be convex - `buildHatchLines`
 * clips against edge half-planes - so callers pass a convex slice of the mass rather than the
 * mass itself, which is usually stepped or notched.
 */
const addFaceRuling = (
    ctx,
    face,
    salt,
    color = ctx.palette.tone4,
    alpha = 0.5,
) => {
    ctx.add(drawHatchFill(ctx.pixi, face, buildHatchSpec(ctx.seed, salt, 0.7), color, alpha), {
        delay: 0.16,
        span: 0.65,
        grow: true,
    });
};

/**
 * Two or three hairlines ruled across the entire picture at shallow angles. They are the only
 * thing in these compositions that ignores the mass, and that is what gives the mass its
 * scale: a line that crosses everything without touching anything.
 */
const addSurveyLines = (ctx, count = 3, salt = 211) => {
    const { width, height, bleed } = ctx;
    const lines = Array.from({ length: Math.max(1, count) }, (_, index) => {
        const anchor = height * (0.16 + ((index * 0.31 + (ctx.seed % 7) * 0.04) % 0.7));
        const lean = height * (index % 2 === 0 ? 0.22 : -0.16);
        return {
            x1: -bleed,
            y1: anchor - lean,
            x2: width + bleed,
            y2: anchor + lean,
        };
    });
    ctx.add(drawLines(ctx.pixi, lines, ctx.palette.paper, 1, 0.45), {
        delay: 0.2 + (salt % 3) * 0.02,
        span: 0.7,
        enterDX: width * 0.2,
    });
};

/** Survey marks in two opposite corners: registration for something far too big to register. */
const addCornerTicks = (ctx) => {
    const { width, height, palette } = ctx;
    const inset = Math.min(width, height) * 0.06;
    const arm = Math.min(width, height) * 0.05;
    ([[1, 1], [-1, -1]]).forEach(([sx, sy], index) => {
        const x = sx > 0 ? inset : width - inset;
        const y = sy > 0 ? inset : height - inset;
        ctx.add(drawLines(ctx.pixi, [
            { x1: x, y1: y, x2: x + sx * arm, y2: y },
            { x1: x, y1: y, x2: x, y2: y + sy * arm },
        ], palette.paper, 1.6, 0.6), { delay: 0.26 + index * 0.04, span: 0.5 });
    });
};

/** A loose wire contour parked in a corner - a survey trace of a shape that is not there. */
const addWireTrace = (ctx, cx, cy, radius) => {
    // Local coordinates inside a positioned group: `drift` scales and rotates a node about its
    // own origin, so a trace drawn at absolute coordinates would orbit the frame origin.
    const group = ctx.createGroup(0, cx, cy);
    ctx.add(drawPolyline(ctx.pixi, buildScribblePath(ctx.decor.scribbleSeed, 199, 0, 0, radius, 1), ctx.palette.paper, 1.2, 0.4), {
        delay: 0.3,
        span: 0.6,
        drift: true,
    }, group);
};


/* ---- compositions/temperaSplitCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaSplitCompositions.ts
  // Compositions that cut the frame into flat tone panels. These are the ones the inversion
  // filter reacts to most strongly: a glyph straddling a panel edge flips colour mid-stroke.

  // Lays panels in with a stagger and drops a hatch pass over one of them, so the split never
  // reads as flat vector art.
  const addPanels = (ctx, panels, hatchIndex) => {
      const hatch = buildHatchSpec(ctx.seed, 5);
      panels.forEach((panel, index) => {
          ctx.add(drawPolygonFill(ctx.pixi, panel.polygon, panel.tone, 0.96, ctx.gradient), {
              delay: index * 0.05,
              span: 0.5,
              enterDX: panel.enterDX,
              enterDY: panel.enterDY,
          });
          if (index !== hatchIndex) return;
          ctx.add(drawHatchFill(ctx.pixi, panel.polygon, hatch, ctx.palette.tone4, 0.5), {
              delay: index * 0.05 + 0.06,
              span: 0.5,
              grow: true,
          });
      });
  };

  const addSeam = (ctx, polygon, delay) => {
      ctx.add(drawPolygonFill(ctx.pixi, polygon, ctx.palette.ink, 0.85, ctx.gradient), { delay, span: 0.5 });
  };

  const duoSplit = ctx => {
      const { width, height, palette, bleed } = ctx;
      const horizontal = temperaHash01(ctx.seed, 1, 3) > 0.5;
      addPanels(ctx, horizontal
          ? [
              { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, height * 0.52 + bleed), tone: palette.tone1, enterDX: 0, enterDY: -height * 0.55 },
              { polygon: rectPolygon(-bleed, height * 0.52, width + bleed * 2, height * 0.48 + bleed), tone: palette.tone3, enterDX: 0, enterDY: height * 0.55 },
          ]
          : [
              { polygon: rectPolygon(-bleed, -bleed, width * 0.5 + bleed, height + bleed * 2), tone: palette.tone1, enterDX: -width * 0.5, enterDY: 0 },
              { polygon: rectPolygon(width * 0.5, -bleed, width * 0.5 + bleed, height + bleed * 2), tone: palette.tone3, enterDX: width * 0.5, enterDY: 0 },
          ], 0);
      addSeam(ctx, horizontal
          ? rectPolygon(-bleed, height * 0.52 - 1.5, width + bleed * 2, 3)
          : rectPolygon(width * 0.5 - 1.5, -bleed, 3, height + bleed * 2), 0.16);
  };

  // Four tone panels meeting under the type. Each quadrant arrives from its own corner.
  const quadSplit = ctx => {
      const { width, height, palette, bleed } = ctx;
      const splitX = width * (0.42 + temperaHash01(ctx.seed, 2, 7) * 0.16);
      const splitY = height * (0.42 + temperaHash01(ctx.seed, 3, 11) * 0.16);
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, splitX + bleed, splitY + bleed), tone: palette.tone1, enterDX: -width * 0.3, enterDY: -height * 0.3 },
          { polygon: rectPolygon(splitX, -bleed, width - splitX + bleed, splitY + bleed), tone: palette.tone4, enterDX: width * 0.3, enterDY: -height * 0.3 },
          { polygon: rectPolygon(-bleed, splitY, splitX + bleed, height - splitY + bleed), tone: palette.tone3, enterDX: -width * 0.3, enterDY: height * 0.3 },
          { polygon: rectPolygon(splitX, splitY, width - splitX + bleed, height - splitY + bleed), tone: palette.tone2, enterDX: width * 0.3, enterDY: height * 0.3 },
      ], 3);
      addSeam(ctx, rectPolygon(splitX - 1.5, -bleed, 3, height + bleed * 2), 0.2);
      addSeam(ctx, rectPolygon(-bleed, splitY - 1.5, width + bleed * 2, 3), 0.24);
  };

  const triColumn = ctx => {
      const { width, height, palette, bleed } = ctx;
      const edge = width * (0.26 + temperaHash01(ctx.seed, 4, 13) * 0.06);
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, edge + bleed, height + bleed * 2), tone: palette.tone1, enterDX: -width * 0.25, enterDY: 0 },
          { polygon: rectPolygon(edge, -bleed, width - edge * 2, height + bleed * 2), tone: palette.tone4, enterDX: 0, enterDY: -height * 0.3 },
          { polygon: rectPolygon(width - edge, -bleed, edge + bleed, height + bleed * 2), tone: palette.tone1, enterDX: width * 0.25, enterDY: 0 },
      ], 0);
  };

  const thirdsStack = ctx => {
      const { width, height, palette, bleed } = ctx;
      const band = height * 0.34;
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, band + bleed), tone: palette.tone2, enterDX: -width * 0.2, enterDY: 0 },
          { polygon: rectPolygon(-bleed, band, width + bleed * 2, band), tone: palette.tone4, enterDX: width * 0.2, enterDY: 0 },
          { polygon: rectPolygon(-bleed, band * 2, width + bleed * 2, height - band * 2 + bleed), tone: palette.tone1, enterDX: -width * 0.2, enterDY: 0 },
      ], 0);
  };

  // Diagonally opposite quadrants share a tone, so the type alternates as it crosses the centre.
  const checkerQuad = ctx => {
      const { width, height, palette, bleed } = ctx;
      const splitX = width * 0.5;
      const splitY = height * 0.5;
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, splitX + bleed, splitY + bleed), tone: palette.tone4, enterDX: 0, enterDY: -height * 0.35 },
          { polygon: rectPolygon(splitX, -bleed, width - splitX + bleed, splitY + bleed), tone: palette.tone1, enterDX: 0, enterDY: -height * 0.35 },
          { polygon: rectPolygon(-bleed, splitY, splitX + bleed, height - splitY + bleed), tone: palette.tone1, enterDX: 0, enterDY: height * 0.35 },
          { polygon: rectPolygon(splitX, splitY, width - splitX + bleed, height - splitY + bleed), tone: palette.tone4, enterDX: 0, enterDY: height * 0.35 },
      ], 1);
  };

  const cornerWedge = ctx => {
      const { width, height, palette, bleed } = ctx;
      const fromLeft = temperaHash01(ctx.seed, 5, 17) > 0.5;
      const apexX = fromLeft ? width * 0.78 : width * 0.22;
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), tone: palette.tone1, enterDX: 0, enterDY: 0 },
          {
              polygon: fromLeft
                  ? [-bleed, -bleed, apexX, -bleed, -bleed, height + bleed]
                  : [width + bleed, -bleed, apexX, -bleed, width + bleed, height + bleed],
              tone: palette.tone4,
              enterDX: fromLeft ? -width * 0.4 : width * 0.4,
              enterDY: 0,
          },
      ], 1);
  };

  const diagonalHalves = ctx => {
      const { width, height, palette, bleed } = ctx;
      const lean = height * (0.2 + temperaHash01(ctx.seed, 6, 19) * 0.3);
      addPanels(ctx, [
          { polygon: [-bleed, -bleed, width + bleed, -bleed, width + bleed, lean, -bleed, height - lean], tone: palette.tone2, enterDX: 0, enterDY: -height * 0.4 },
          { polygon: [-bleed, height - lean, width + bleed, lean, width + bleed, height + bleed, -bleed, height + bleed], tone: palette.tone4, enterDX: 0, enterDY: height * 0.4 },
      ], 1);
  };

  // Two heavy axes cutting the frame into quarters; the type sits on the crossing.
  const crossAxis = ctx => {
      const { width, height, palette, bleed } = ctx;
      const barX = width * 0.11;
      const barY = height * 0.13;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon((width - barX) / 2, -bleed, barX, height + bleed * 2), palette.tone4, 0.95),
          { delay: 0.06, span: 0.5, enterDY: -height * 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, (height - barY) / 2, width + bleed * 2, barY), palette.tone3, 0.95),
          { delay: 0.12, span: 0.5, enterDX: width * 0.5 });
  };

  // Two halves shoved past each other; the step where they miss is the composition.
  const offsetHalves = ctx => {
      const { width, height, palette, bleed } = ctx;
      const step = height * (0.06 + temperaHash01(ctx.seed, 7, 23) * 0.06);
      const seam = width * 0.48;
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, seam + bleed, height * 0.5 + step + bleed), tone: palette.tone1, enterDX: -width * 0.3, enterDY: 0 },
          { polygon: rectPolygon(seam, -bleed, width - seam + bleed, height * 0.5 - step + bleed), tone: palette.tone3, enterDX: width * 0.3, enterDY: 0 },
          { polygon: rectPolygon(-bleed, height * 0.5 + step, seam + bleed, height * 0.5 - step + bleed), tone: palette.tone4, enterDX: -width * 0.2, enterDY: 0 },
          { polygon: rectPolygon(seam, height * 0.5 - step, width - seam + bleed, height * 0.5 + step + bleed), tone: palette.tone2, enterDX: width * 0.2, enterDY: 0 },
      ], 2);
  };

  // Four blocks marching down the diagonal, each one a step darker.
  const stairBlocks = ctx => {
      const { width, height, palette, bleed } = ctx;
      const tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4];
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      tones.forEach((tone, index) => {
          const left = width * (0.06 + index * 0.2);
          const top = height * (0.1 + index * 0.16);
          ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(left, top, width * 0.3, height * 0.34), tone, 0.94, ctx.gradient),
              { delay: index * 0.06, span: 0.5, enterDX: -width * 0.2, enterDY: height * 0.12 });
      });
  };

  // Two heavy masses leave a bright vertical slot; the lyric stands in the slot.
  const pillarGap = ctx => {
      const { width, height, palette, bleed } = ctx;
      const gap = width * (0.26 + temperaHash01(ctx.seed, 8, 29) * 0.08);
      const side = (width - gap) / 2;
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, side + bleed, height + bleed * 2), tone: palette.tone4, enterDX: -width * 0.3, enterDY: 0 },
          { polygon: rectPolygon(width - side, -bleed, side + bleed, height + bleed * 2), tone: palette.tone4, enterDX: width * 0.3, enterDY: 0 },
      ], 1);
  };

  // Quadrants of deliberately unequal weight, split off-centre in both axes.
  const cornerQuad = ctx => {
      const { width, height, palette, bleed } = ctx;
      const splitX = width * (0.6 + temperaHash01(ctx.seed, 9, 31) * 0.12);
      const splitY = height * (0.62 + temperaHash01(ctx.seed, 10, 37) * 0.1);
      addPanels(ctx, [
          { polygon: rectPolygon(-bleed, -bleed, splitX + bleed, splitY + bleed), tone: palette.tone2, enterDX: 0, enterDY: -height * 0.25 },
          { polygon: rectPolygon(splitX, -bleed, width - splitX + bleed, splitY + bleed), tone: palette.tone4, enterDX: width * 0.25, enterDY: 0 },
          { polygon: rectPolygon(-bleed, splitY, splitX + bleed, height - splitY + bleed), tone: palette.tone1, enterDX: -width * 0.25, enterDY: 0 },
          { polygon: rectPolygon(splitX, splitY, width - splitX + bleed, height - splitY + bleed), tone: palette.tone3, enterDX: 0, enterDY: height * 0.25 },
      ], 0);
  };

  // A stack of thin alternating slivers filling one side of the frame.
  const sliverStack = ctx => {
      const { width, height, palette, bleed } = ctx;
      const fromLeft = temperaHash01(ctx.seed, 11, 41) > 0.5;
      const slabWidth = width * 0.46;
      const left = fromLeft ? -bleed : width - slabWidth;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      const count = 9;
      const sliver = (height + bleed * 2) / count;
      for (let index = 0; index < count; index += 1) {
          if (index % 2 === 1) continue;
          ctx.add(drawPolygonFill(
              ctx.pixi,
              rectPolygon(left, -bleed + sliver * index, slabWidth + bleed, sliver),
              palette.tone4,
              0.92,
              ctx.gradient,
          ), { delay: index * 0.02, span: 0.5, enterDX: (fromLeft ? -1 : 1) * width * 0.2 });
      }
  };

  const TEMPERA_SPLIT_COMPOSITIONS = {
      'duo-split': duoSplit,
      'quad-split': quadSplit,
      'tri-column': triColumn,
      'thirds-stack': thirdsStack,
      'checker-quad': checkerQuad,
      'corner-wedge': cornerWedge,
      'diagonal-halves': diagonalHalves,
      'cross-axis': crossAxis,
      'offset-halves': offsetHalves,
      'stair-blocks': stairBlocks,
      'pillar-gap': pillarGap,
      'corner-quad': cornerQuad,
      'sliver-stack': sliverStack,
  };

  __register('split', TEMPERA_SPLIT_COMPOSITIONS);
}());

/* ---- compositions/temperaBandCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaBandCompositions.ts
  // Horizontal strata. With Tempera's vertical flow these read as depth: the frame descends
  // through the bands, which is what turns a shot hand-off into a dive rather than a cut.
  const bandStrip = ctx => {
      const { width, height, palette, bleed } = ctx;
      const bandY = height * 0.37;
      const bandHeight = height * 0.3;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, bandY, width + bleed * 2, bandHeight), palette.tone3, 0.96, ctx.gradient),
          { span: 0.55, enterDX: -width * 0.5 });
      // Guide lines hug the band edges; the lyric inverts against the mid tone between them.
      ctx.add(drawLines(ctx.pixi, [
          { x1: -bleed, y1: bandY - 10, x2: width + bleed, y2: bandY - 22 },
          { x1: -bleed, y1: bandY + bandHeight + 22, x2: width + bleed, y2: bandY + bandHeight + 10 },
      ], palette.tone4, 1.4, 0.75), { delay: 0.12, enterDX: width * 0.25 });

      if (!ctx.showDecor) return;
      ctx.add(drawCrossMarks(ctx.pixi, buildCrossRow(ctx.seed, 17, width * 0.06, bandY - height * 0.16, 4, width * 0.055, 9), palette.ink, 2, 0.8),
          { delay: 0.2, span: 0.5 });
      ctx.add(drawSquareMarks(ctx.pixi, buildDotRow(ctx.seed, 19, width * 0.94, bandY + bandHeight + height * 0.06, 3, height * 0.05, 6), palette.ink, 0.75),
          { delay: 0.26, drift: true });
  };

  // A waterline: light above, dense below, with a wavy meniscus between the two.
  const horizonBand = ctx => {
      const { width, height, palette, bleed } = ctx;
      const waterline = height * (0.5 + temperaHash01(ctx.seed, 1, 23) * 0.12);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, waterline + bleed), palette.tone1, 0.94, ctx.gradient),
          { span: 0.55, enterDY: -height * 0.3 });
      const water = rectPolygon(-bleed, waterline, width + bleed * 2, height - waterline + bleed);
      ctx.add(drawPolygonFill(ctx.pixi, water, palette.tone3, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.3 });
      ctx.add(drawHatchFill(ctx.pixi, water, { ...buildHatchSpec(ctx.seed, 29), angle: 0 }, palette.tone4, 0.55),
          { delay: 0.1, span: 0.55, grow: true });
      ctx.add(drawPolyline(ctx.pixi, buildWavyPath(ctx.seed, 31, -bleed, width + bleed, waterline, height * 0.012, 30), palette.ink, 2.2, 0.85),
          { delay: 0.16, span: 0.5 });
  };

  // Stacked strata that get denser toward the bottom of the frame.
  const deepDive = ctx => {
      const { width, height, palette, bleed } = ctx;
      const tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4];
      const bandHeight = (height + bleed * 2) / tones.length;
      tones.forEach((tone, index) => {
          const top = -bleed + bandHeight * index;
          ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, top, width + bleed * 2, bandHeight + 1), tone, 0.95, ctx.gradient),
              { delay: index * 0.06, span: 0.55, enterDY: height * 0.3 });
          if (index === 0) return;
          ctx.add(drawPolyline(ctx.pixi, buildWavyPath(ctx.seed, 37 + index, -bleed, width + bleed, top, height * 0.008, 24), palette.paper, 1.6, 0.5),
              { delay: index * 0.06 + 0.05, span: 0.5 });
      });
  };

  // A density ramp instead of discrete panels: same hatch angle, tightening spacing.
  const toneRamp = ctx => {
      const { width, height, palette, bleed } = ctx;
      const spec = buildHatchSpec(ctx.seed, 41);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.92, ctx.gradient), { span: 0.5 });
      const steps = 4;
      for (let index = 0; index < steps; index += 1) {
          const columnWidth = (width + bleed * 2) / steps;
          const column = rectPolygon(-bleed + columnWidth * index, -bleed, columnWidth, height + bleed * 2);
          ctx.add(drawHatchFill(ctx.pixi, column, { ...spec, spacing: spec.spacing * (1.6 - index * 0.32) }, palette.tone4, 0.6),
              { delay: index * 0.06, span: 0.55, grow: true });
      }
  };

  // Two rails with a bright slot between them; the lyric sits in the slot.
  const doubleBand = ctx => {
      const { width, height, palette, bleed } = ctx;
      const slot = height * (0.2 + temperaHash01(ctx.seed, 51, 43) * 0.08);
      const rail = height * 0.3;
      const top = (height - slot) / 2 - rail;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, top, width + bleed * 2, rail), palette.tone3, 0.95, ctx.gradient),
          { span: 0.55, enterDX: -width * 0.4 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, top + rail + slot, width + bleed * 2, rail), palette.tone4, 0.95, ctx.gradient),
          { delay: 0.07, span: 0.55, enterDX: width * 0.4 });
  };

  // One band rotated off the horizontal, running past both edges.
  const tiltBand = ctx => {
      const { width, height, palette, bleed } = ctx;
      const lean = height * (0.14 + temperaHash01(ctx.seed, 53, 47) * 0.14);
      const half = height * 0.17;
      const band = [
          -bleed, height / 2 + lean - half,
          width + bleed, height / 2 - lean - half,
          width + bleed, height / 2 - lean + half,
          -bleed, height / 2 + lean + half,
      ];
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, band, palette.tone4, 0.95, ctx.gradient), { delay: 0.06, span: 0.55, enterDX: -width * 0.35 });
      ctx.add(drawHatchFill(ctx.pixi, band, { ...buildHatchSpec(ctx.seed, 59), angle: Math.PI / 2 }, palette.paper, 0.3),
          { delay: 0.12, span: 0.55, grow: true });
  };

  // Heavy rails hugging the top and bottom edges, leaving the middle open.
  const edgeRails = ctx => {
      const { width, height, palette, bleed } = ctx;
      const rail = height * (0.16 + temperaHash01(ctx.seed, 61, 53) * 0.06);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, rail + bleed), palette.tone3, 0.94, ctx.gradient),
          { span: 0.55, enterDY: -height * 0.2 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height - rail, width + bleed * 2, rail + bleed), palette.tone3, 0.94, ctx.gradient),
          { delay: 0.06, span: 0.55, enterDY: height * 0.2 });
      if (!ctx.showDecor) return;
      ctx.add(drawLines(ctx.pixi, [
          { x1: -bleed, y1: rail + 8, x2: width + bleed, y2: rail + 8 },
          { x1: -bleed, y1: height - rail - 8, x2: width + bleed, y2: height - rail - 8 },
      ], palette.tone4, 1.2, 0.6), { delay: 0.16, span: 0.5, enterDX: width * 0.2 });
  };

  // One full-bleed tone whose hatch tightens toward one edge - a tonal wall, not a band.
  const gradientWall = ctx => {
      const { width, height, palette, bleed } = ctx;
      const spec = buildHatchSpec(ctx.seed, 67);
      const downward = temperaHash01(ctx.seed, 71, 59) > 0.5;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone2, 0.94, ctx.gradient), { span: 0.5 });
      const steps = 5;
      const bandHeight = height / steps;
      for (let index = 0; index < steps; index += 1) {
          const rank = downward ? index : steps - 1 - index;
          const top = bandHeight * index - (index === 0 ? bleed : 0);
          const bottom = bandHeight * (index + 1) + (index === steps - 1 ? bleed : 0);
          ctx.add(drawHatchFill(
              ctx.pixi,
              rectPolygon(-bleed, top, width + bleed * 2, bottom - top),
              { ...spec, spacing: spec.spacing * (1.9 - rank * 0.34) },
              palette.tone4,
              0.55,
          ), { delay: index * 0.05, span: 0.55, grow: true });
      }
  };

  // Stepped bands, each starting further in than the one above it.
  const terrace = ctx => {
      const { width, height, palette, bleed } = ctx;
      const tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4];
      const bandHeight = height / tones.length;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      tones.forEach((tone, index) => {
          const left = width * index * 0.14 - bleed;
          const top = bandHeight * index - (index === 0 ? bleed : 0);
          const bottom = bandHeight * (index + 1) + (index === tones.length - 1 ? bleed : 1);
          ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(left, top, width + bleed * 2 - left - bleed, bottom - top), tone, 0.94, ctx.gradient),
              { delay: index * 0.06, span: 0.55, enterDX: -width * 0.25 });
      });
  };

  const TEMPERA_BAND_COMPOSITIONS = {
      'band-strip': bandStrip,
      'horizon-band': horizonBand,
      'deep-dive': deepDive,
      'tone-ramp': toneRamp,
      'double-band': doubleBand,
      'tilt-band': tiltBand,
      'edge-rails': edgeRails,
      'gradient-wall': gradientWall,
      'terrace': terrace,
  };

  __register('band', TEMPERA_BAND_COMPOSITIONS);
}());

/* ---- compositions/temperaFrameCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaFrameCompositions.ts
  // Outlined windows. These hold the type in a quiet pocket and let the surrounding tone do the
  // work, so they are what a paragraph cuts to when it needs to breathe.
  const frameWindow = ctx => {
      const { width, height, palette } = ctx;
      const cx = width / 2;
      const cy = height / 2;
      const rx = width * 0.42;
      const ry = height * 0.44;
      ctx.add(drawHatchFill(ctx.pixi, diamondPolygon(cx, cy, rx * 0.78, ry * 0.78), buildHatchSpec(ctx.seed, 23, 1.4), palette.tone2, 0.45),
          { grow: true, span: 0.6 });
      ctx.add(drawConcentricDiamonds(ctx.pixi, cx, cy, rx, ry, 3, palette.ink, 0.9),
          { delay: 0.08, enterDY: height * 0.06, span: 0.55 });

      if (!ctx.showDecor) return;
      ctx.add(drawCrossMarks(ctx.pixi, buildCrossRow(ctx.seed, 29, width * 0.08, height * 0.14, 3, width * 0.045, 8), palette.tone4, 1.8, 0.85), { delay: 0.22 });
      ctx.add(drawSquareMarks(ctx.pixi, buildDotRow(ctx.seed, 37, width * 0.92, height * 0.62, 4, height * 0.06, 7), palette.tone4, 0.8), { delay: 0.28 });
  };

  // Two offset rectangles: the type sits inside one and overlaps the edge of the other.
  const doubleFrame = ctx => {
      const { width, height, palette, bleed } = ctx;
      const offset = width * 0.05;
      const box = rectPolygon(width * 0.16, height * 0.2, width * 0.68, height * 0.6);
      const shifted = rectPolygon(width * 0.16 + offset, height * 0.2 + offset * 0.6, width * 0.68, height * 0.6);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, shifted, palette.tone3, 0.8, ctx.gradient), { delay: 0.06, span: 0.55, enterDX: offset * 3 });
      ctx.add(drawHatchFill(ctx.pixi, shifted, buildHatchSpec(ctx.seed, 43), palette.tone4, 0.4), { delay: 0.1, span: 0.55, grow: true });
      ctx.add(drawPolygonOutline(ctx.pixi, box, palette.ink, 3.5, 0.9), { delay: 0.14, span: 0.5, enterDY: -height * 0.08 });
  };

  const circleWindow = ctx => {
      const { width, height, palette, bleed } = ctx;
      const radius = Math.min(width, height) * 0.34;
      const circle = circlePolygon(width / 2, height / 2, radius);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone3, 0.92, ctx.gradient), { span: 0.5 });
      ctx.add(drawHatchFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), buildHatchSpec(ctx.seed, 47), palette.tone4, 0.4),
          { delay: 0.04, span: 0.6, grow: true });
      ctx.add(drawPolygonFill(ctx.pixi, circle, palette.paper, 0.95, ctx.gradient), { delay: 0.08, span: 0.55 });
      ctx.add(drawPolygonOutline(ctx.pixi, circle, palette.ink, 3, 0.9), { delay: 0.14, span: 0.5 });
      if (!ctx.showDecor) return;
      ctx.add(drawPolygonOutline(ctx.pixi, circlePolygon(width / 2, height / 2, radius * 1.12), palette.ink, 1.2, 0.55), { delay: 0.2, drift: true });
  };

  // A stepped bracket down one side: reads as a margin rule rather than a closed box.
  const ladderFrame = ctx => {
      const { width, height, palette, bleed } = ctx;
      const left = width * 0.14;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      const steps = 5;
      for (let index = 0; index < steps; index += 1) {
          const y = height * (0.18 + index * 0.14);
          const run = width * (0.06 + index * 0.03);
          ctx.add(drawLines(ctx.pixi, [
              { x1: left, y1: y, x2: left + run, y2: y },
              { x1: left, y1: y, x2: left, y2: y + height * 0.14 },
          ], palette.tone4, index % 2 === 0 ? 3 : 1.4, 0.85), { delay: index * 0.05, span: 0.5, enterDX: -width * 0.1 });
      }
      ctx.add(drawLines(ctx.pixi, [{ x1: width * 0.9, y1: -bleed, x2: width * 0.9, y2: height + bleed }], palette.tone4, 1.4, 0.6),
          { delay: 0.28, span: 0.5, enterDY: height * 0.2 });
  };

  const cornerBrackets = ctx => {
      const { width, height, palette, bleed } = ctx;
      const inset = Math.min(width, height) * 0.12;
      const arm = Math.min(width, height) * 0.16;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone2, 0.9, ctx.gradient), { span: 0.5 });
      const corners = [
          [inset, inset, 1, 1],
          [width - inset, inset, -1, 1],
          [inset, height - inset, 1, -1],
          [width - inset, height - inset, -1, -1],
      ];
      corners.forEach(([x, y, sx, sy], index) => {
          ctx.add(drawLines(ctx.pixi, [
              { x1: x, y1: y, x2: x + sx * arm, y2: y },
              { x1: x, y1: y, x2: x, y2: y + sy * arm },
          ], palette.ink, 3.5, 0.9), { delay: index * 0.05, span: 0.5, enterDX: sx * width * 0.06, enterDY: sy * height * 0.06 });
      });
      if (!ctx.showDecor) return;
      const dotted = temperaHash01(ctx.seed, 2, 53) > 0.5;
      ctx.add(dotted
          ? drawSquareMarks(ctx.pixi, buildDotRow(ctx.seed, 59, width * 0.5, height * 0.16, 3, width * 0.03, 6, 0), palette.tone4, 0.8)
          : drawCrossMarks(ctx.pixi, buildCrossRow(ctx.seed, 61, width * 0.44, height * 0.84, 3, width * 0.04, 7), palette.tone4, 1.8, 0.8),
      { delay: 0.24, drift: true });
  };

  // One inset rectangle, faintly filled: the quietest way to hold a phrase.
  const insetBox = ctx => {
      const { width, height, palette, bleed } = ctx;
      const box = rectPolygon(width * 0.14, height * 0.2, width * 0.72, height * 0.6);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, box, palette.tone3, 0.55, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.06 });
      ctx.add(drawPolygonOutline(ctx.pixi, box, palette.ink, 2.4, 0.85), { delay: 0.1, span: 0.5 });
  };

  // Two facing brackets instead of a closed box; the phrase sits between the jaws.
  const bracketPair = ctx => {
      const { width, height, palette, bleed } = ctx;
      const inset = width * 0.16;
      const arm = width * 0.09;
      const top = height * 0.26;
      const bottom = height * 0.74;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone2, 0.9, ctx.gradient), { span: 0.5 });
      ([1, -1]).forEach((side, index) => {
          const x = side === 1 ? inset : width - inset;
          ctx.add(drawLines(ctx.pixi, [
              { x1: x, y1: top, x2: x + side * arm, y2: top },
              { x1: x, y1: top, x2: x, y2: bottom },
              { x1: x, y1: bottom, x2: x + side * arm, y2: bottom },
          ], palette.ink, 4, 0.9), { delay: index * 0.07, span: 0.5, enterDX: side * width * 0.08 });
      });
  };

  // A rounded-top window: half disc riding a rectangle.
  const archWindow = ctx => {
      const { width, height, palette, bleed } = ctx;
      const radius = width * 0.24;
      const cx = width / 2;
      const shoulder = height * 0.42;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone3, 0.92, ctx.gradient), { span: 0.5 });
      const arch = circlePolygon(cx, shoulder, radius, 48);
      const body = rectPolygon(cx - radius, shoulder, radius * 2, height * 0.4);
      ctx.add(drawPolygonFill(ctx.pixi, arch, palette.paper, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: -height * 0.08 });
      ctx.add(drawPolygonFill(ctx.pixi, body, palette.paper, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.08 });
      ctx.add(drawPolygonOutline(ctx.pixi, arch, palette.ink, 2.4, 0.8), { delay: 0.12, span: 0.5 });
      ctx.add(drawPolygonOutline(ctx.pixi, body, palette.ink, 2.4, 0.8), { delay: 0.12, span: 0.5 });
  };

  // A hairline 3x3 lattice; the lyric runs across the middle row.
  const gridCells = ctx => {
      const { width, height, palette, bleed } = ctx;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      const left = width * 0.12;
      const top = height * 0.18;
      const cellWidth = (width * 0.76) / 3;
      const cellHeight = (height * 0.64) / 3;
      for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 3; column += 1) {
              const cell = rectPolygon(left + cellWidth * column, top + cellHeight * row, cellWidth, cellHeight);
              const index = row * 3 + column;
              if (row === 1 && column === 1) {
                  ctx.add(drawPolygonFill(ctx.pixi, cell, palette.tone4, 0.75, ctx.gradient), { delay: index * 0.03, span: 0.5 });
              }
              ctx.add(drawPolygonOutline(ctx.pixi, cell, palette.tone4, 1.2, 0.6), { delay: index * 0.03, span: 0.5 });
          }
      }
  };

  // Disc over a narrow shaft: the silhouette reads as a keyhole cut in the tone.
  const keyhole = ctx => {
      const { width, height, palette, bleed } = ctx;
      const radius = Math.min(width, height) * 0.19;
      const cx = width / 2;
      const cy = height * 0.36;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone4, 0.94, ctx.gradient), { span: 0.5 });
      const head = circlePolygon(cx, cy, radius, 48);
      const shaft = rectPolygon(cx - radius * 0.55, cy, radius * 1.1, height * 0.46);
      ctx.add(drawPolygonFill(ctx.pixi, head, palette.paper, 0.96, ctx.gradient), { delay: 0.05, span: 0.55 });
      ctx.add(drawPolygonFill(ctx.pixi, shaft, palette.paper, 0.96, ctx.gradient), { delay: 0.08, span: 0.55, enterDY: height * 0.1 });
      ctx.add(drawPolygonOutline(ctx.pixi, head, palette.ink, 2, 0.7), { delay: 0.14, span: 0.5 });
  };

  const TEMPERA_FRAME_COMPOSITIONS = {
      'frame-window': frameWindow,
      'double-frame': doubleFrame,
      'circle-window': circleWindow,
      'ladder-frame': ladderFrame,
      'corner-brackets': cornerBrackets,
      'inset-box': insetBox,
      'bracket-pair': bracketPair,
      'arch-window': archWindow,
      'grid-cells': gridCells,
      'keyhole': keyhole,
  };

  __register('frame', TEMPERA_FRAME_COMPOSITIONS);
}());

/* ---- compositions/temperaPosterCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaPosterCompositions.ts
  // Big tilted masses. These are the loud compositions: one dominant solid shape the type has to
  // fight, which is exactly what makes the inversion filter visible.
  const posterPanel = ctx => {
      const { width, height, palette } = ctx;
      const poster = ctx.createGroup(-0.06, width / 2, height / 2);
      const solid = diamondPolygon(-width * 0.12, 0, width * 0.42, height * 0.66);
      const hatched = diamondPolygon(width * 0.2, -height * 0.06, width * 0.3, height * 0.48);
      ctx.add(drawPolygonFill(ctx.pixi, solid, palette.ink, 0.92, ctx.gradient), { enterDX: -width * 0.6, span: 0.55 }, poster);
      ctx.add(drawHatchFill(ctx.pixi, hatched, buildHatchSpec(ctx.seed, 41), palette.tone4, 0.7), { delay: 0.08, grow: true, span: 0.55 }, poster);
      ctx.add(drawPolygonOutline(ctx.pixi, hatched, palette.ink, 2, 0.8), { delay: 0.12, span: 0.55 }, poster);
      ctx.add(drawPolyline(
          ctx.pixi,
          buildWavyPath(ctx.seed, 43, -width * 0.6, width * 0.6, height * 0.42, height * 0.02),
          palette.tone4,
          2,
          0.7,
      ), { delay: 0.2, enterDY: height * 0.1 }, poster);
  };

  // Three solids marching off the frame at descending size; the type rides the largest one.
  const diamondStack = ctx => {
      const { width, height, palette, bleed } = ctx;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      const tones = [palette.ink, palette.tone4, palette.tone3];
      tones.forEach((tone, index) => {
          const scale = 1 - index * 0.28;
          const cx = width * (0.34 + index * 0.24);
          const cy = height * (0.52 - index * 0.14);
          ctx.add(drawPolygonFill(ctx.pixi, diamondPolygon(cx, cy, width * 0.3 * scale, height * 0.46 * scale), tone, 0.93, ctx.gradient),
              { delay: index * 0.07, span: 0.55, enterDX: width * 0.25, enterDY: -height * 0.12 });
      });
  };

  // One broad slash across the frame with the counter-hatch running the other way.
  const slashPoster = ctx => {
      const { width, height, palette, bleed } = ctx;
      const lean = height * 0.34;
      const band = [
          -bleed, height * 0.24 + lean,
          width + bleed, height * 0.24 - lean,
          width + bleed, height * 0.72 - lean,
          -bleed, height * 0.72 + lean,
      ];
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, band, palette.tone4, 0.94, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: -width * 0.4 });
      ctx.add(drawHatchFill(ctx.pixi, band, { ...buildHatchSpec(ctx.seed, 67), angle: Math.PI / 3 }, palette.paper, 0.3),
          { delay: 0.1, span: 0.55, grow: true });
      ctx.add(drawPolygonOutline(ctx.pixi, band, palette.ink, 2.2, 0.8), { delay: 0.14, span: 0.5 });
  };

  // A chevron pointing across the frame, echoing the roof-line motif of the reference art.
  const arrowWedge = ctx => {
      const { width, height, palette, bleed } = ctx;
      const apex = height * (0.24 + temperaHash01(ctx.seed, 3, 71) * 0.14);
      const thickness = height * 0.2;
      const chevron = [
          -bleed, height + bleed,
          width * 0.5, apex,
          width + bleed, height + bleed,
          width + bleed, height + bleed,
          width * 0.5, apex + thickness,
          -bleed, height + bleed,
      ];
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, [-bleed, height + bleed, width * 0.5, apex, width + bleed, height + bleed], palette.tone4, 0.94, ctx.gradient),
          { delay: 0.05, span: 0.55, enterDY: height * 0.3 });
      ctx.add(drawHatchFill(ctx.pixi, chevron, { ...buildHatchSpec(ctx.seed, 73), angle: -Math.PI / 4 }, palette.paper, 0.35),
          { delay: 0.1, span: 0.55, grow: true });
      ctx.add(drawPolyline(ctx.pixi, [-bleed, height * 0.9, width * 0.5, apex - thickness * 0.4, width + bleed, height * 0.9], palette.ink, 2, 0.7),
          { delay: 0.16, span: 0.5, enterDY: -height * 0.1 });
  };

  // A single mass pushed in from one edge, leaving the type on the exposed paper beside it.
  const edgeBleed = ctx => {
      const { width, height, palette, bleed } = ctx;
      const fromLeft = temperaHash01(ctx.seed, 4, 79) > 0.5;
      const cover = width * 0.42;
      const mass = fromLeft
          ? rectPolygon(-bleed, -bleed, cover + bleed, height + bleed * 2)
          : rectPolygon(width - cover, -bleed, cover + bleed, height + bleed * 2);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, mass, palette.ink, 0.93, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: (fromLeft ? -1 : 1) * width * 0.4 });
      ctx.add(drawHatchFill(ctx.pixi, mass, buildHatchSpec(ctx.seed, 83), palette.paper, 0.22), { delay: 0.12, span: 0.55, grow: true });
  };

  // One triangle anchored on an edge, filling most of the frame.
  const triangleMass = ctx => {
      const { width, height, palette, bleed } = ctx;
      const fromLeft = temperaHash01(ctx.seed, 91, 89) > 0.5;
      const apexX = fromLeft ? width * 1.02 : -width * 0.02;
      const triangle = [
          fromLeft ? -bleed : width + bleed, -bleed,
          fromLeft ? -bleed : width + bleed, height + bleed,
          apexX, height * (0.3 + temperaHash01(ctx.seed, 93, 97) * 0.3),
      ];
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, triangle, palette.tone4, 0.94, ctx.gradient),
          { delay: 0.05, span: 0.55, enterDX: (fromLeft ? -1 : 1) * width * 0.35 });
      ctx.add(drawHatchFill(ctx.pixi, triangle, buildHatchSpec(ctx.seed, 101), palette.paper, 0.24),
          { delay: 0.12, span: 0.55, grow: true });
  };

  // Two tilted ribbons crossing; where they overlap the tone doubles up.
  const ribbonCross = ctx => {
      const { width, height, palette, bleed } = ctx;
      const half = height * 0.14;
      const lean = height * 0.3;
      const ribbon = (sign) => [
          -bleed, height / 2 + sign * lean - half,
          width + bleed, height / 2 - sign * lean - half,
          width + bleed, height / 2 - sign * lean + half,
          -bleed, height / 2 + sign * lean + half,
      ];
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, ribbon(1), palette.tone3, 0.8, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: -width * 0.3 });
      ctx.add(drawPolygonFill(ctx.pixi, ribbon(-1), palette.tone4, 0.8, ctx.gradient), { delay: 0.11, span: 0.55, enterDX: width * 0.3 });
  };

  // A disc so large that only its shoulder is in frame.
  const halfDisc = ctx => {
      const { width, height, palette, bleed } = ctx;
      const fromRight = temperaHash01(ctx.seed, 103, 107) > 0.5;
      const radius = Math.hypot(width, height) * 0.62;
      const disc = circlePolygon(fromRight ? width + radius * 0.55 : -radius * 0.55, height * 0.5, radius, 64);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, disc, palette.tone4, 0.94, ctx.gradient),
          { delay: 0.05, span: 0.55, enterDX: (fromRight ? 1 : -1) * width * 0.3 });
      ctx.add(drawPolygonOutline(ctx.pixi, disc, palette.ink, 2, 0.6), { delay: 0.12, span: 0.5 });
  };

  // Three rotated slabs stacked off-register, like sheets dropped on a table.
  const stackedSlabs = ctx => {
      const { width, height, palette, bleed } = ctx;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      const tones = [palette.tone2, palette.tone3, palette.tone4];
      tones.forEach((tone, index) => {
          const group = ctx.createGroup(-0.09 + index * 0.08, width / 2, height / 2);
          const slab = rectPolygon(-width * (0.42 - index * 0.05), -height * (0.3 - index * 0.03), width * (0.84 - index * 0.1), height * (0.6 - index * 0.06));
          ctx.add(drawPolygonFill(ctx.pixi, slab, tone, 0.93, ctx.gradient),
              { delay: index * 0.07, span: 0.55, enterDX: width * 0.2, enterDY: height * 0.12 }, group);
      });
  };

  // Two wedges biting in from opposite edges, leaving an hourglass of paper.
  const wedgePair = ctx => {
      const { width, height, palette, bleed } = ctx;
      const waist = width * (0.2 + temperaHash01(ctx.seed, 109, 113) * 0.1);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 });
      ctx.add(drawPolygonFill(ctx.pixi, [
          -bleed, -bleed, (width - waist) / 2, height / 2, -bleed, height + bleed,
      ], palette.tone4, 0.94, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: -width * 0.25 });
      ctx.add(drawPolygonFill(ctx.pixi, [
          width + bleed, -bleed, (width + waist) / 2, height / 2, width + bleed, height + bleed,
      ], palette.tone4, 0.94, ctx.gradient), { delay: 0.11, span: 0.55, enterDX: width * 0.25 });
  };

  const TEMPERA_POSTER_COMPOSITIONS = {
      'poster-panel': posterPanel,
      'diamond-stack': diamondStack,
      'slash-poster': slashPoster,
      'arrow-wedge': arrowWedge,
      'edge-bleed': edgeBleed,
      'triangle-mass': triangleMass,
      'ribbon-cross': ribbonCross,
      'half-disc': halfDisc,
      'stacked-slabs': stackedSlabs,
      'wedge-pair': wedgePair,
  };

  __register('poster', TEMPERA_POSTER_COMPOSITIONS);
}());

/* ---- compositions/temperaSparseCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaSparseCompositions.ts
  // Near-empty compositions for breathing paragraphs: hairlines, dot fields and hand-drawn
  // strokes, with almost no tone mass so the type reads as a whisper.
  const quietLine = ctx => {
      const { width, height, palette } = ctx;
      const gridWidth = width * 0.7;
      const gridX = (width - gridWidth) / 2;
      [0.38, 0.5, 0.62].forEach((ratio, index) => {
          ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(gridX, height * ratio, gridWidth, 1), palette.line, 1, ctx.gradient),
              { delay: index * 0.08, span: 0.6, enterDX: (index % 2 === 0 ? -1 : 1) * width * 0.2 });
      });
      if (!ctx.showDecor) return;
      ctx.add(drawPolyline(
          ctx.pixi,
          buildScribblePath(ctx.decor.scribbleSeed, 47, width * 0.2, height * 0.26, Math.min(width, height) * 0.09, 2),
          palette.tone4,
          1.6,
          0.7,
      ), { delay: 0.24, span: 0.6 });
      // Grass tufts: short strokes fanned from one baseline point.
      const tuftX = width * 0.82;
      const tuftY = height * 0.74;
      ctx.add(drawLines(ctx.pixi, Array.from({ length: 6 }, (_, index) => {
          const lean = (temperaHash01(ctx.decor.scribbleSeed, index, 59) - 0.5) * 34;
          return { x1: tuftX + index * 7, y1: tuftY, x2: tuftX + index * 7 + lean, y2: tuftY - 24 - index * 3 };
      }), palette.tone4, 1.4, 0.7), { delay: 0.3, span: 0.55 });
  };

  // A dot lattice that thins out toward one edge; the type floats in the sparse half.
  const starfieldDots = ctx => {
      const { width, height, palette, bleed } = ctx;
      const spacing = Math.max(24, Math.sqrt((width * height) / 900));
      const marks = buildDotGrid(width + bleed, height + bleed, spacing, 2.6);
      const dense = marks.filter(mark => mark.y > height * 0.45);
      const sparse = marks.filter(mark => mark.y <= height * 0.45 && (mark.x + mark.y) % 3 < 1);
      ctx.add(drawSquareMarks(ctx.pixi, dense, palette.tone4, 0.45), { span: 0.6, enterDY: height * 0.2 });
      ctx.add(drawSquareMarks(ctx.pixi, sparse, palette.tone4, 0.25), { delay: 0.08, span: 0.6, enterDY: -height * 0.15 });
      if (!ctx.showDecor) return;
      ctx.add(drawLines(ctx.pixi, [{ x1: -bleed, y1: height * 0.45, x2: width + bleed, y2: height * 0.45 }], palette.tone4, 1.2, 0.5),
          { delay: 0.2, span: 0.5, enterDX: width * 0.2 });
  };

  // Concentric wobbling lines, the surface of the water seen from just below it.
  const rippleLines = ctx => {
      const { width, height, palette, bleed } = ctx;
      const count = 7;
      for (let index = 0; index < count; index += 1) {
          const y = height * (0.16 + index * 0.11);
          const amplitude = height * (0.006 + index * 0.004);
          ctx.add(drawPolyline(
              ctx.pixi,
              buildWavyPath(ctx.seed, 89 + index, -bleed, width + bleed, y, amplitude, 26),
              palette.tone4,
              index % 3 === 0 ? 2 : 1.1,
              0.55,
          ), { delay: index * 0.045, span: 0.6, enterDX: (index % 2 === 0 ? -1 : 1) * width * 0.15 });
      }
  };

  // A full-bleed hairline lattice; the phrase floats on top of it.
  const hairGrid = ctx => {
      const { width, height, palette, bleed } = ctx;
      const columns = 6;
      const rows = 4;
      const vertical = Array.from({ length: columns + 1 }, (_, index) => ({
          x1: (width / columns) * index, y1: -bleed, x2: (width / columns) * index, y2: height + bleed,
      }));
      const horizontal = Array.from({ length: rows + 1 }, (_, index) => ({
          x1: -bleed, y1: (height / rows) * index, x2: width + bleed, y2: (height / rows) * index,
      }));
      ctx.add(drawLines(ctx.pixi, vertical, palette.line, 1, 0.8), { span: 0.6, enterDY: -height * 0.1 });
      ctx.add(drawLines(ctx.pixi, horizontal, palette.line, 1, 0.8), { delay: 0.08, span: 0.6, enterDX: width * 0.1 });
  };

  // A single heavy rule down one margin with a few register marks beside it.
  const marginRule = ctx => {
      const { width, height, palette, bleed } = ctx;
      const fromLeft = temperaHash01(ctx.seed, 121, 127) > 0.5;
      const x = fromLeft ? width * 0.12 : width * 0.88;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(x - 3, -bleed, 6, height + bleed * 2), palette.tone4, 0.9, ctx.gradient),
          { span: 0.6, enterDY: height * 0.15 });
      if (!ctx.showDecor) return;
      ctx.add(drawSquareMarks(
          ctx.pixi,
          [0, 1, 2].map(index => ({ x: x + (fromLeft ? 22 : -22), y: height * (0.32 + index * 0.18), size: 7, rotation: 0 })),
          palette.tone4,
          0.8,
      ), { delay: 0.22, drift: true });
  };

  // Dot lattice thinning out along one diagonal.
  const dotDrift = ctx => {
      const { width, height, palette, bleed } = ctx;
      const spacing = Math.max(22, Math.sqrt((width * height) / 1200));
      const marks = buildDotGrid(width + bleed, height + bleed, spacing, 2.4);
      const span = width + height;
      const near = marks.filter(mark => mark.x + mark.y > span * 0.5);
      const far = marks.filter(mark => mark.x + mark.y <= span * 0.5 && (mark.x + mark.y) % 2 < 1);
      ctx.add(drawSquareMarks(ctx.pixi, near, palette.tone4, 0.5), { span: 0.6, enterDX: width * 0.12 });
      ctx.add(drawSquareMarks(ctx.pixi, far, palette.tone4, 0.24), { delay: 0.08, span: 0.6, enterDX: -width * 0.12 });
  };

  // Concentric rings centred off frame, so only their arcs cross the picture.
  const arcSweep = ctx => {
      const { width, height, palette } = ctx;
      const cx = width * (temperaHash01(ctx.seed, 131, 137) > 0.5 ? 1.15 : -0.15);
      const cy = height * 1.05;
      const base = Math.hypot(width, height) * 0.42;
      for (let index = 0; index < 5; index += 1) {
          ctx.add(drawPolygonOutline(
              ctx.pixi,
              circlePolygon(cx, cy, base + index * base * 0.22, 72),
              palette.tone4,
              index % 2 === 0 ? 1.8 : 1,
              0.55,
          ), { delay: index * 0.05, span: 0.6, enterDY: height * 0.08 });
      }
  };

  // Almost bare paper with one small register mark. The breath before a verse.
  const blankPage = ctx => {
      const { width, height, palette } = ctx;
      ctx.add(drawLines(ctx.pixi, [
          { x1: width * 0.18, y1: height * 0.7, x2: width * 0.36, y2: height * 0.7 },
      ], palette.line, 1.4, 0.8), { span: 0.6, enterDX: -width * 0.12 });
      if (!ctx.showDecor) return;
      ctx.add(drawPolyline(
          ctx.pixi,
          buildScribblePath(ctx.decor.scribbleSeed, 139, width * 0.82, height * 0.26, Math.min(width, height) * 0.06, 2),
          palette.tone4,
          1.4,
          0.6,
      ), { delay: 0.28, span: 0.6 });
  };

  const TEMPERA_SPARSE_COMPOSITIONS = {
      'quiet-line': quietLine,
      'starfield-dots': starfieldDots,
      'ripple-lines': rippleLines,
      'hair-grid': hairGrid,
      'margin-rule': marginRule,
      'dot-drift': dotDrift,
      'arc-sweep': arcSweep,
      'blank-page': blankPage,
  };

  __register('sparse', TEMPERA_SPARSE_COMPOSITIONS);
}());

/* ---- compositions/temperaCinemaCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaCinemaCompositions.ts
  // Cinema mattes: a solid frame with a window of a given aspect punched out of the middle. The
  // hole is what the lyric sits in, so the surrounding tone reads as a matte rather than as a
  // block - and the difference filter has a hard edge to cut the type against.


  /**
   * Fits a window of the given aspect inside the frame. Real pixel dimensions are used rather
   * than viewport fractions, because a "square" window has to look square on any display.
   */
  const fitWindow = (width, height, aspect, fill) => {
      const maxWidth = width * fill;
      const maxHeight = height * fill;
      const windowWidth = Math.min(maxWidth, maxHeight * aspect);
      const windowHeight = windowWidth / aspect;
      return {
          x: (width - windowWidth) / 2,
          y: (height - windowHeight) / 2,
          width: windowWidth,
          height: windowHeight,
      };
  };

  /**
   * Draws the matte as four bars rather than a filled shape with a hole: the bars stay convex,
   * which the hatch clipper needs, and they can each carry their own entrance.
   */
  const addMatte = (ctx, hole, tone) => {
      const { width, height, bleed } = ctx;
      const bars = [
          { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, hole.y + bleed), enterDX: 0, enterDY: -height * 0.2 },
          { polygon: rectPolygon(-bleed, hole.y + hole.height, width + bleed * 2, height - hole.y - hole.height + bleed), enterDX: 0, enterDY: height * 0.2 },
          { polygon: rectPolygon(-bleed, hole.y, hole.x + bleed, hole.height), enterDX: -width * 0.2, enterDY: 0 },
          { polygon: rectPolygon(hole.x + hole.width, hole.y, width - hole.x - hole.width + bleed, hole.height), enterDX: width * 0.2, enterDY: 0 },
      ];
      bars.forEach((bar, index) => {
          ctx.add(drawPolygonFill(ctx.pixi, bar.polygon, tone, 0.96, ctx.gradient), {
              delay: index * 0.04,
              span: 0.5,
              enterDX: bar.enterDX,
              enterDY: bar.enterDY,
          });
      });
      // The inner edge is the whole point of a matte, so it gets a line of its own.
      ctx.add(drawPolygonOutline(
          ctx.pixi,
          rectPolygon(hole.x, hole.y, hole.width, hole.height),
          ctx.palette.ink,
          1.6,
          0.5,
      ), { delay: 0.2, span: 0.5 });
  };

  // Faint tone inside the window so the hole is not simply bare ground.
  const addWindowWash = (ctx, hole, alpha) => {
      const polygon = rectPolygon(hole.x, hole.y, hole.width, hole.height);
      ctx.add(drawPolygonFill(ctx.pixi, polygon, ctx.palette.tone1, alpha, ctx.gradient), { span: 0.55 });
      ctx.add(drawHatchFill(ctx.pixi, polygon, buildHatchSpec(ctx.seed, 149, 1.5), ctx.palette.tone4, 0.2),
          { delay: 0.1, span: 0.6, grow: true });
  };

  const matte = (aspect, fill, washAlpha = 0.35) => ctx => {
      const hole = fitWindow(ctx.width, ctx.height, aspect, fill);
      addWindowWash(ctx, hole, washAlpha);
      addMatte(ctx, hole, ctx.palette.tone4);
      if (!ctx.showDecor) return;
      // Registration ticks on the matte, aligned to the window edges.
      ctx.add(drawLines(ctx.pixi, [
          { x1: hole.x, y1: hole.y - ctx.height * 0.05, x2: hole.x, y2: hole.y - ctx.height * 0.02 },
          { x1: hole.x + hole.width, y1: hole.y + hole.height + ctx.height * 0.02, x2: hole.x + hole.width, y2: hole.y + hole.height + ctx.height * 0.05 },
      ], ctx.palette.paper, 2, 0.6), { delay: 0.26, span: 0.5 });
  };

  // Two windows side by side; the lyric takes the wider left one.
  const cinemaTwin = ctx => {
      const { width, height, palette, bleed } = ctx;
      const inset = height * 0.16;
      const gutter = width * 0.04;
      const left = { x: width * 0.08, y: inset, width: width * 0.5, height: height - inset * 2 };
      const right = {
          x: left.x + left.width + gutter,
          y: inset + height * 0.1,
          width: width * 0.28,
          height: height - inset * 2 - height * 0.2,
      };
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone4, 0.96, ctx.gradient),
          { span: 0.5 });
      ([left, right]).forEach((hole, index) => {
          const polygon = rectPolygon(hole.x, hole.y, hole.width, hole.height);
          ctx.add(drawPolygonFill(ctx.pixi, polygon, palette.tone1, index === 0 ? 0.4 : 0.85, ctx.gradient),
              { delay: index * 0.08, span: 0.55, enterDX: (index === 0 ? -1 : 1) * width * 0.14 });
          ctx.add(drawPolygonOutline(ctx.pixi, polygon, palette.ink, 1.6, 0.5), { delay: 0.16 + index * 0.05, span: 0.5 });
      });
      if (!ctx.showDecor) return;
      ctx.add(drawHatchFill(ctx.pixi, rectPolygon(right.x, right.y, right.width, right.height), buildHatchSpec(ctx.seed, 151), palette.tone4, 0.35),
          { delay: 0.24, span: 0.6, grow: true });
  };

  // A slightly off-square window drifts by seed, so the same aspect never lands identically.
  const jitteredFill = (ctx, base) => (
      base + (temperaHash01(ctx.seed, 157, 163) - 0.5) * 0.06
  );

  const TEMPERA_CINEMA_COMPOSITIONS = {
      'cinema-scope': ctx => matte(2.39, jitteredFill(ctx, 0.88))(ctx),
      'cinema-wide': ctx => matte(1.85, jitteredFill(ctx, 0.84))(ctx),
      'cinema-academy': ctx => matte(1.33, jitteredFill(ctx, 0.78))(ctx),
      'cinema-square': ctx => matte(1, jitteredFill(ctx, 0.72))(ctx),
      'cinema-portrait': ctx => matte(0.75, jitteredFill(ctx, 0.72))(ctx),
      'cinema-tall': ctx => matte(0.5625, jitteredFill(ctx, 0.72))(ctx),
      'cinema-twin': cinemaTwin,
  };

  __register('cinema', TEMPERA_CINEMA_COMPOSITIONS);
}());

/* ---- compositions/temperaCharmCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaCharmCompositions.ts
  // The rounded family, after the motion design of visual novel promo PVs: bubbles, frills,
  // hearts, sparkles and sticker plates. Every other family cuts the frame with straight edges;
  // these lay curved shapes *on* a flat field instead, so the type reads as printed on a sticker
  // rather than as straddling a panel seam. Geometry comes from `temperaCurves.ts`; only the
  // convex shapes there may be hatched.
  //
  // Two rules hold the family to the rest of Tempera: the ink outline stays (a soft shape with
  // no outline dissolves into the field and gives the inversion filter nothing to cut against),
  // and nothing here pulses with audio - the float is the shared deterministic `drift`.

  /** Every card starts from one flat field; the curved shapes sit on top of it. */
  const addField = (ctx, color, alpha = 0.92) => {
      const { width, height, bleed } = ctx;
      ctx.add(
          drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), color, alpha, ctx.gradient),
          { span: 0.5 },
      );
  };

  // Bubbles rising past the type. The size spread is what sells it, so a large tier the lyric
  // sits against carries the tone while a small tier drifts over it.
  const bubbleDrift = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      addField(ctx, palette.tone1);
      const big = buildDiscField(ctx.seed, 11, width, height, 8, unit * 0.115);
      const small = buildDiscField(ctx.seed, 17, width, height, 13, unit * 0.042);
      ctx.add(drawDiscs(ctx.pixi, big, palette.tone3, 0.88, ctx.gradient), { delay: 0.05, span: 0.6, enterDY: height * 0.16, drift: true });
      ctx.add(drawRings(ctx.pixi, big, palette.ink, 2, 0.55), { delay: 0.12, span: 0.55, enterDY: height * 0.12 });
      ctx.add(drawDiscs(ctx.pixi, small, palette.tone4, 0.7), { delay: 0.18, span: 0.6, enterDY: height * 0.22, drift: true });
      if (!ctx.showDecor) return;
      // Highlights on the two lead bubbles. Without them the discs read as flat dots.
      ctx.add(drawDiscs(ctx.pixi, big.slice(0, 2).map(disc => ({
          x: disc.x - disc.radius * 0.36,
          y: disc.y - disc.radius * 0.36,
          radius: disc.radius * 0.16,
      })), palette.paper, 0.85), { delay: 0.28, drift: true });
  };

  // A lobed medallion: the cloud frame a promo drops one line of narration into.
  const cloudWindow = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const cx = width / 2;
      const cy = height * 0.52;
      const rx = width * 0.3;
      const ry = height * 0.3;
      addField(ctx, palette.tone3);
      const cloud = lobedPolygon(cx, cy, rx, ry, 9, 0.1);
      ctx.add(drawPolygonFill(ctx.pixi, lobedPolygon(cx, cy + height * 0.025, rx * 1.05, ry * 1.05, 9, 0.1), palette.tone4, 0.5), { delay: 0.04, span: 0.6 });
      ctx.add(drawPolygonFill(ctx.pixi, cloud, palette.paper, 0.96, ctx.gradient), { delay: 0.08, span: 0.55 });
      ctx.add(drawPolygonOutline(ctx.pixi, cloud, palette.ink, 2.4, 0.85), { delay: 0.12, span: 0.5 });
      if (!ctx.showDecor) return;
      // The tail of a speech balloon, made of the two bubbles that fell off it.
      ctx.add(drawDiscs(ctx.pixi, [
          { x: cx - rx * 1.16, y: cy + ry * 0.66, radius: unit * 0.035 },
          { x: cx - rx * 1.32, y: cy + ry * 0.9, radius: unit * 0.02 },
      ], palette.paper, 0.92, ctx.gradient), { delay: 0.22, drift: true });
  };

  // Hearts at three sizes marching off frame; the largest one carries the type.
  const heartBurst = ctx => {
      const { width, height, palette } = ctx;
      const lean = temperaHash01(ctx.seed, 3, 83) > 0.5 ? 1 : -1;
      const cx = width * 0.5;
      const cy = height * 0.52;
      const rx = width * 0.32;
      const ry = height * 0.4;
      addField(ctx, palette.tone4, 0.94);
      const main = rotatePolygon(heartPolygon(cx, cy, rx, ry), cx, cy, lean * 0.06);
      // The offset copy goes down first: it reads as a mis-registered second printing, which is
      // the same idea as the type's echo layer, not as a drop shadow.
      ctx.add(drawPolygonFill(
          ctx.pixi,
          rotatePolygon(heartPolygon(cx + lean * width * 0.022, cy + height * 0.025, rx, ry), cx, cy, lean * 0.06),
          palette.tone2,
          0.6,
      ), { delay: 0.04, span: 0.6 });
      ctx.add(drawPolygonFill(ctx.pixi, main, palette.paper, 0.95, ctx.gradient), { delay: 0.08, span: 0.55, enterDY: height * 0.1 });
      ctx.add(drawPolygonOutline(ctx.pixi, main, palette.ink, 3, 0.9), { delay: 0.14, span: 0.5, enterDY: height * 0.08 });
      [0.4, 0.24].forEach((scale, index) => {
          const x = lean > 0 ? width * (0.88 + index * 0.08) : width * (0.12 - index * 0.08);
          const y = height * (0.24 + index * 0.42);
          // Drawn in local coordinates inside a positioned group: `drift` scales a node about
          // its own origin, so an off-centre shape has to be centred there or it orbits.
          const group = ctx.createGroup(0, x, y);
          ctx.add(drawPolygonFill(
              ctx.pixi,
              rotatePolygon(heartPolygon(0, 0, rx * scale, ry * scale), 0, 0, -lean * 0.22),
              palette.tone2,
              0.9,
              ctx.gradient,
          ), { delay: 0.2 + index * 0.06, span: 0.5, enterDX: lean * width * 0.12, drift: true }, group);
      });
  };

  // Kirakira: four-tipped sparkles at two tiers over an almost bare field.
  const sparkleField = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      addField(ctx, palette.tone1, 0.88);
      const seeds = buildDiscField(ctx.seed, 23, width, height, 9, unit * 0.07);
      seeds.slice(0, 5).forEach((disc, index) => {
          // A tight waist is what makes a four-pointed star read as a glint instead of a cross.
          // Local coordinates inside a positioned group so `drift` twinkles in place.
          const star = starPolygon(0, 0, disc.radius, disc.radius * 0.16, 4, temperaHash01(ctx.seed, index, 29) * 0.9);
          const group = ctx.createGroup(0, disc.x, disc.y);
          ctx.add(drawPolygonFill(ctx.pixi, star, palette.tone4, 0.9, ctx.gradient), { delay: 0.06 + index * 0.05, span: 0.5, drift: true }, group);
      });
      ctx.add(drawDiscs(
          ctx.pixi,
          seeds.slice(5).map(disc => ({ ...disc, radius: disc.radius * 0.22 })),
          palette.tone4,
          0.7,
      ), { delay: 0.24, span: 0.55, drift: true });
      ctx.add(drawLines(ctx.pixi, [{ x1: width * 0.08, y1: height * 0.74, x2: width * 0.92, y2: height * 0.72 }], palette.tone4, 1.2, 0.5),
          { delay: 0.3, span: 0.5, enterDX: -width * 0.12 });
  };

  // Petals swung out of an off-frame hub, plus the rosette they came from.
  const petalArc = ctx => {
      const { width, height, palette } = ctx;
      const fromLeft = temperaHash01(ctx.seed, 5, 89) > 0.5;
      const hubX = fromLeft ? -width * 0.1 : width * 1.1;
      const hubY = height * 0.12;
      const rx = width * 0.26;
      const ry = height * 0.085;
      addField(ctx, palette.tone2);
      for (let index = 0; index < 5; index += 1) {
          // Each petal is built touching the hub, then swung around it, so the fan stays a fan
          // whichever corner the seed picked.
          const base = ellipsePolygon(hubX + (fromLeft ? rx : -rx), hubY, rx, ry, 28);
          const petal = rotatePolygon(base, hubX, hubY, (fromLeft ? 1 : -1) * (0.18 + index * 0.3));
          ctx.add(drawPolygonFill(ctx.pixi, petal, index % 2 === 0 ? palette.tone3 : palette.tone1, 0.9, ctx.gradient),
              { delay: index * 0.05, span: 0.55, enterDY: -height * 0.1 });
          ctx.add(drawPolygonOutline(ctx.pixi, petal, palette.ink, 1.6, 0.5), { delay: 0.06 + index * 0.05, span: 0.5 });
      }
      const hub = ctx.createGroup(0, hubX, hubY);
      ctx.add(drawPolygonFill(ctx.pixi, lobedPolygon(0, 0, width * 0.11, width * 0.11, 6, 0.34), palette.tone4, 0.9, ctx.gradient),
          { delay: 0.28, span: 0.5, drift: true }, hub);
      if (!ctx.showDecor) return;
      // Petals that already fell, on the far side: without them the fan leaves that half bare.
      ctx.add(drawDiscs(ctx.pixi, [0, 1, 2].map(index => ({
          x: fromLeft ? width * (0.78 + index * 0.07) : width * (0.22 - index * 0.07),
          y: height * (0.7 + index * 0.1),
          radius: height * (0.03 - index * 0.006),
      })), palette.tone4, 0.75, ctx.gradient), { delay: 0.32, span: 0.5, drift: true });
  };

  // Two frilled bands closing in from the edges; the lyric sits in the bright slot between them.
  const scallopBand = ctx => {
      const { width, height, palette, bleed } = ctx;
      addField(ctx, palette.tone1, 0.9);
      const top = scallopBandPolygon(-bleed, width + bleed, -bleed, height * 0.28, 9);
      const bottom = scallopBandPolygon(-bleed, width + bleed, height + bleed, height * 0.72, 9);
      ctx.add(drawPolygonFill(ctx.pixi, top, palette.tone3, 0.92, ctx.gradient), { delay: 0.04, span: 0.55, enterDY: -height * 0.18 });
      ctx.add(drawPolygonFill(ctx.pixi, bottom, palette.tone4, 0.92, ctx.gradient), { delay: 0.1, span: 0.55, enterDY: height * 0.18 });
      ctx.add(drawPolygonOutline(ctx.pixi, top, palette.ink, 2, 0.75), { delay: 0.14, span: 0.5, enterDY: -height * 0.12 });
      ctx.add(drawPolygonOutline(ctx.pixi, bottom, palette.ink, 2, 0.75), { delay: 0.18, span: 0.5, enterDY: height * 0.12 });
      if (!ctx.showDecor) return;
      // Beads pinned on the cusps where two bumps meet, so they read as sewn to the frill
      // instead of scattered on it - hence the bump pitch rather than round fractions.
      const pitch = (width + bleed * 2) / 9;
      const beads = Array.from({ length: 5 }, (_, index) => ({
          x: -bleed + pitch * (index + 2),
          y: height * 0.28,
          radius: Math.min(width, height) * 0.018,
      }));
      ctx.add(drawDiscs(ctx.pixi, beads, palette.ink, 0.7), { delay: 0.26, drift: true });
  };

  // One ribbon arcing across the frame with a knot pinned on it: the caption banner of a promo.
  const ribbonLoop = ctx => {
      const { width, height, palette, bleed } = ctx;
      const sag = height * (0.06 + temperaHash01(ctx.seed, 7, 97) * 0.05) * (temperaHash01(ctx.seed, 9, 97) > 0.5 ? 1 : -1);
      addField(ctx, palette.tone2);
      const band = arcRibbonPolygon(-bleed, width + bleed, height * 0.5, height * 0.3, sag);
      const echo = arcRibbonPolygon(-bleed, width + bleed, height * 0.68, height * 0.06, -sag);
      ctx.add(drawPolygonFill(ctx.pixi, echo, palette.tone4, 0.7, ctx.gradient), { delay: 0.04, span: 0.6, enterDX: -width * 0.16 });
      ctx.add(drawPolygonFill(ctx.pixi, band, palette.paper, 0.95, ctx.gradient), { delay: 0.08, span: 0.55, enterDX: width * 0.18 });
      ctx.add(drawPolygonOutline(ctx.pixi, band, palette.ink, 2.6, 0.85), { delay: 0.14, span: 0.5, enterDX: width * 0.14 });
      // A bow on the band. It deliberately lands under the type: the lyric crossing it is what
      // the inversion filter turns into a two-colour word.
      const knotX = width * (temperaHash01(ctx.seed, 11, 97) > 0.5 ? 0.24 : 0.76);
      const knotY = height * 0.5 + Math.sin((knotX + bleed) / (width + bleed * 2) * Math.PI) * sag;
      const bow = ctx.createGroup(0, knotX, knotY);
      ([-1, 1]).forEach((side, index) => {
          const loop = rotatePolygon(
              ellipsePolygon(side * width * 0.055, 0, width * 0.05, height * 0.07, 26),
              0,
              0,
              side * 0.3,
          );
          ctx.add(drawPolygonFill(ctx.pixi, loop, palette.tone4, 0.92, ctx.gradient), { delay: 0.2 + index * 0.04, span: 0.5, enterDX: side * width * 0.06 }, bow);
          ctx.add(drawPolygonOutline(ctx.pixi, loop, palette.ink, 2, 0.8), { delay: 0.24 + index * 0.04, span: 0.5 }, bow);
      });
      const knot = roundedRectPolygon(-width * 0.018, -height * 0.035, width * 0.036, height * 0.07, height * 0.02);
      ctx.add(drawPolygonFill(ctx.pixi, knot, palette.tone4, 0.95, ctx.gradient), { delay: 0.28, span: 0.5 }, bow);
      ctx.add(drawPolygonOutline(ctx.pixi, knot, palette.ink, 2, 0.85), { delay: 0.3, span: 0.5 }, bow);
  };

  // A sticker plate: rounded panel, double rule, four pins. The calmest card in the family.
  const roundPlate = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      addField(ctx, palette.tone3);
      const plate = roundedRectPolygon(width * 0.16, height * 0.24, width * 0.68, height * 0.52, unit * 0.11);
      const inner = roundedRectPolygon(width * 0.19, height * 0.29, width * 0.62, height * 0.42, unit * 0.08);
      ctx.add(drawPolygonFill(ctx.pixi, plate, palette.paper, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.06 });
      // Rounded rectangles are convex, so the hatch clipper fills them directly - a lobed plate
      // would have to go without.
      ctx.add(drawHatchFill(ctx.pixi, inner, buildHatchSpec(ctx.seed, 101, 1.3), palette.tone2, 0.35), { delay: 0.1, span: 0.6, grow: true });
      ctx.add(drawPolygonOutline(ctx.pixi, plate, palette.ink, 3, 0.9), { delay: 0.12, span: 0.5 });
      ctx.add(drawPolygonOutline(ctx.pixi, inner, palette.tone4, 1.2, 0.55), { delay: 0.16, span: 0.5 });
      if (!ctx.showDecor) return;
      ctx.add(drawDiscs(ctx.pixi, [
          { x: width * 0.22, y: height * 0.3, radius: unit * 0.016 },
          { x: width * 0.78, y: height * 0.3, radius: unit * 0.016 },
          { x: width * 0.22, y: height * 0.7, radius: unit * 0.016 },
          { x: width * 0.78, y: height * 0.7, radius: unit * 0.016 },
      ], palette.ink, 0.75), { delay: 0.22, span: 0.5 });
  };

  // A soft halo: wide radial wedges out of an off-centre hub, then the disc and rings on top.
  const haloBurst = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const cx = width * (0.44 + temperaHash01(ctx.seed, 13, 103) * 0.12);
      const cy = height * 0.5;
      const reach = Math.hypot(width, height) * 0.7;
      const wedges = 14;
      addField(ctx, palette.tone1);
      // Every other wedge only: the gap is what keeps a burst soft instead of dizzying.
      for (let index = 0; index < wedges; index += 2) {
          const angle = (index / wedges) * Math.PI * 2 + temperaHash01(ctx.seed, index, 107) * 0.09;
          const spread = 0.11;
          ctx.add(drawPolygonFill(ctx.pixi, [
              cx, cy,
              cx + Math.cos(angle - spread) * reach, cy + Math.sin(angle - spread) * reach,
              cx + Math.cos(angle + spread) * reach, cy + Math.sin(angle + spread) * reach,
          ], palette.tone3, 0.55, ctx.gradient), { delay: 0.04 + index * 0.012, span: 0.6 });
      }
      ctx.add(drawPolygonFill(ctx.pixi, ellipsePolygon(cx, cy, unit * 0.34, unit * 0.34, 48), palette.paper, 0.94, ctx.gradient),
          { delay: 0.14, span: 0.55 });
      // Rings via the disc factory rather than an outlined polygon: it pivots the node on the
      // ring centre, so the halo breathes in place instead of orbiting the frame origin.
      ([[0.34, 3], [0.44, 1.4]]).forEach(([scale, stroke], index) => {
          ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: unit * scale }], palette.ink, stroke, 0.75),
              { delay: 0.2 + index * 0.06, span: 0.5, drift: true });
      });
  };

  const TEMPERA_CHARM_COMPOSITIONS = {
      'bubble-drift': bubbleDrift,
      'cloud-window': cloudWindow,
      'heart-burst': heartBurst,
      'sparkle-field': sparkleField,
      'petal-arc': petalArc,
      'scallop-band': scallopBand,
      'ribbon-loop': ribbonLoop,
      'round-plate': roundPlate,
      'halo-burst': haloBurst,
  };

  __register('charm', TEMPERA_CHARM_COMPOSITIONS);
}());

/* ---- compositions/temperaApertureCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaApertureCompositions.ts
  // Punched plates: one flat tone sheet with a hole cut clean through it, so the shell's live
  // background becomes the subject of the shot. The shape of the opening is the whole
  // composition, which is why these carry almost no other geometry - a decorated plate would
  // compete with its own window.
  //
  // The layout regions all sit on solid tone, never over an opening; see `temperaCutout.ts` for
  // why. Hole positions are fixed per kind rather than seed-mirrored, because the region that
  // has to stay clear of them is fixed data too.
  const irisHole = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const cx = width * 0.68;
      const cy = height * 0.42;
      const radius = unit * 0.3;
      const hole = circlePolygon(cx, cy, radius, 56);
      addCutField(ctx, palette.tone3, [hole]);
      addHoleLip(ctx, hole, 3, 0.9, 0.08);
      // A bar running in from the far edge: the opening reads as mounted rather than floating.
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-ctx.bleed, cy - unit * 0.035, cx - radius * 0.7 + ctx.bleed, unit * 0.07), palette.tone4, 0.9, ctx.gradient),
          { delay: 0.14, span: 0.55, enterDX: -width * 0.12 });
      if (!ctx.showDecor) return;
      ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: radius * 1.14 }], palette.tone4, 1.4, 0.6), { delay: 0.2, span: 0.5, drift: true });
  };

  // A single letterbox slit across the plate. The mass above and below it is what the type sits
  // on, so the opening reads as a horizon rather than as a window.
  const slotRail = ctx => {
      const { width, height, palette, bleed } = ctx;
      const top = height * 0.22;
      const slot = rectPolygon(-bleed, top, width + bleed * 2, height * 0.16);
      addCutField(ctx, palette.tone4, [slot]);
      addHoleLip(ctx, slot, 2.4, 0.8, 0.1);
      // The tab straddling the slit is the focal mass; it is also the only thing crossing it.
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(width * 0.66, top - height * 0.06, width * 0.12, height * 0.28), palette.tone2, 0.95, ctx.gradient),
          { delay: 0.16, span: 0.55, enterDY: -height * 0.1 });
      ctx.add(drawLines(ctx.pixi, [{ x1: -bleed, y1: top + height * 0.22, x2: width + bleed, y2: top + height * 0.22 }], palette.tone2, 1.4, 0.55),
          { delay: 0.22, span: 0.5, enterDX: width * 0.14 });
  };

  // Sprocket holes down both edges of the plate: the frame between them is the picture.
  const punchRow = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const radius = unit * 0.028;
      const holes = [];
      for (let index = 0; index < 9; index += 1) {
          const x = width * (0.08 + index * 0.105);
          holes.push(circlePolygon(x, height * 0.14, radius, 20));
          holes.push(circlePolygon(x, height * 0.86, radius, 20));
      }
      addCutField(ctx, palette.tone3, holes);
      ([0.22, 0.78]).forEach((y, index) => {
          ctx.add(drawLines(ctx.pixi, [{ x1: 0, y1: height * y, x2: width, y2: height * y }], palette.tone4, 1.6, 0.6),
              { delay: 0.12 + index * 0.04, span: 0.5, enterDX: (index === 0 ? 1 : -1) * width * 0.12 });
      });
  };

  // A film gate: the big rectangular opening is the frame being exposed, the small ones are the
  // transport holes pulling it past.
  const filmGate = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const gate = rectPolygon(width * 0.2, height * 0.1, width * 0.6, height * 0.52);
      const holes = [gate];
      for (let index = 0; index < 4; index += 1) {
          const y = height * (0.14 + index * 0.13);
          holes.push(rectPolygon(width * 0.08, y, width * 0.05, height * 0.06));
          holes.push(rectPolygon(width * 0.87, y, width * 0.05, height * 0.06));
      }
      addCutField(ctx, palette.tone4, holes);
      addHoleLip(ctx, gate, 3, 0.9, 0.08);
      ctx.add(drawHatchFill(ctx.pixi, rectPolygon(width * 0.2, height * 0.68, width * 0.6, height * 0.1), buildHatchSpec(ctx.seed, 131, 1.2), palette.tone2, 0.5),
          { delay: 0.18, span: 0.6, grow: true });
  };

  // A cross cut clean through, sitting high so the type keeps the lower mass to itself.
  const crossVent = ctx => {
      const { width, height, palette } = ctx;
      const cx = width * 0.5;
      const cy = height * 0.38;
      const arm = Math.min(width, height) * 0.3;
      const bar = Math.min(width, height) * 0.1;
      const cross = [
          cx - bar, cy - arm, cx + bar, cy - arm, cx + bar, cy - bar,
          cx + arm, cy - bar, cx + arm, cy + bar, cx + bar, cy + bar,
          cx + bar, cy + arm, cx - bar, cy + arm, cx - bar, cy + bar,
          cx - arm, cy + bar, cx - arm, cy - bar, cx - bar, cy - bar,
      ];
      addCutField(ctx, palette.tone3, [cross]);
      addHoleLip(ctx, cross, 2.6, 0.85, 0.1);
      if (!ctx.showDecor) return;
      ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: arm * 1.24 }], palette.tone4, 1.2, 0.5), { delay: 0.2, span: 0.5 });
  };

  // Louvre slats: parallel slits leaning off the horizontal, thinning as they descend.
  const louvre = ctx => {
      const { width, height, palette, bleed } = ctx;
      const holes = [];
      for (let index = 0; index < 6; index += 1) {
          const y = height * (0.08 + index * 0.1);
          const lean = height * 0.03;
          const thickness = height * (0.05 - index * 0.004);
          holes.push([
              -bleed, y, width + bleed, y - lean,
              width + bleed, y - lean + thickness, -bleed, y + thickness,
          ]);
      }
      addCutField(ctx, palette.tone4, holes);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(width * 0.1, height * 0.72, width * 0.08, height * 0.2), palette.tone2, 0.9, ctx.gradient),
          { delay: 0.2, span: 0.55, enterDY: height * 0.1 });
  };

  // A rose window: the ring is punched as twelve segments, so the spokes between them and the
  // hub inside them are still the plate itself. The type rides that hub - it is the only region
  // in the family sitting inside an opening, and it only works because the hub was never cut.
  // Re-covering a round hole with a disc drawn on top would look the same and be a lie: the
  // first change to the draw order would drop the type onto bare background.
  const ringEye = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;
      const inner = unit * 0.31;
      const outer = unit * 0.44;
      const segments = 12;
      const gap = 0.03;
      const holes = Array.from({ length: segments }, (_, index) => {
          const start = (index / segments) * Math.PI * 2 + gap;
          const end = ((index + 1) / segments) * Math.PI * 2 - gap;
          return annularSectorPolygon(cx, cy, inner, outer, start, end, 8);
      });
      addCutField(ctx, palette.tone3, holes);
      ctx.add(drawRings(ctx.pixi, [
          { x: cx, y: cy, radius: inner },
          { x: cx, y: cy, radius: outer },
      ], palette.ink, 2.4, 0.85), { delay: 0.12, span: 0.5 });
  };

  // Square openings stepping down one side, each a size smaller than the one above it.
  const notchStack = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const holes = [];
      for (let index = 0; index < 4; index += 1) {
          const size = unit * (0.26 - index * 0.05);
          holes.push(rectPolygon(width * (0.6 + index * 0.06), height * (0.1 + index * 0.19), size, size));
      }
      addCutField(ctx, palette.tone4, holes);
      holes.forEach((hole, index) => addHoleLip(ctx, hole, 2, 0.75, 0.1 + index * 0.04));
  };

  // A wedge driven in from the top edge. The plate keeps its whole lower half, which is where
  // the type goes.
  const wedgeGap = ctx => {
      const { width, height, palette, bleed } = ctx;
      const apexX = width * (0.4 + temperaHash01(ctx.seed, 3, 137) * 0.2);
      const wedge = [width * 0.1, -bleed, width * 0.92, -bleed, apexX, height * 0.56];
      addCutField(ctx, palette.tone3, [wedge]);
      addHoleLip(ctx, wedge, 3, 0.9, 0.08);
      ctx.add(drawLines(ctx.pixi, [{ x1: apexX, y1: height * 0.58, x2: apexX, y2: height + bleed }], palette.tone4, 1.6, 0.6),
          { delay: 0.18, span: 0.5, enterDY: height * 0.12 });
  };

  // A sieve: small holes thinning out across the plate, so the background bleeds through as a
  // gradient of light rather than as one opening.
  const dotSieve = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const holes = [];
      for (let row = 0; row < 6; row += 1) {
          // Five columns, not nine: the falloff has to reach zero well before the layout region
          // starts, or the last stragglers punch straight through the type's half of the plate.
          for (let column = 0; column < 5; column += 1) {
              const density = 1 - column / 4.5;
              if (temperaHash01(ctx.seed, row * 9 + column, 139) > density) continue;
              const x = width * (0.06 + column * 0.105) + (row % 2 === 0 ? 0 : width * 0.05);
              holes.push(circlePolygon(x, height * (0.1 + row * 0.16), unit * 0.045 * density + unit * 0.012, 18));
          }
      }
      addCutField(ctx, palette.tone2, holes, { alpha: 0.92 });
  };

  const TEMPERA_APERTURE_COMPOSITIONS = {
      'iris-hole': irisHole,
      'slot-rail': slotRail,
      'punch-row': punchRow,
      'film-gate': filmGate,
      'cross-vent': crossVent,
      'louvre-slats': louvre,
      'ring-eye': ringEye,
      'notch-stack': notchStack,
      'wedge-gap': wedgeGap,
      'dot-sieve': dotSieve,
  };

  __register('aperture', TEMPERA_APERTURE_COMPOSITIONS);
}());

/* ---- compositions/temperaSignalCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaSignalCompositions.ts
  // Instrument panels: hard geometric decoration - rules, ticks, brackets, repeated slats -
  // arranged around one heavy mass that the type shares the frame with. The decoration is
  // deliberately measured rather than expressive; it reads as a printed diagram, and the mass is
  // the only thing in the frame allowed to be loud.
  //
  // Several kinds punch their opening through the mass itself rather than through the field, so
  // the hole travels with the shape instead of sitting behind it.
  const addField = (ctx, color, alpha = 0.92) => {
      const { width, height, bleed } = ctx;
      ctx.add(
          drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), color, alpha, ctx.gradient),
          { span: 0.5 },
      );
  };

  // Crosshair: full-bleed rules, a boxed centre and corner ticks. The solid block under the
  // crossing is what the lyric stands on.
  const sightMark = ctx => {
      const { width, height, palette, bleed } = ctx;
      const cx = width * 0.5;
      const cy = height * 0.5;
      addField(ctx, palette.tone1);
      ctx.add(drawLines(ctx.pixi, [
          { x1: -bleed, y1: cy, x2: width + bleed, y2: cy },
          { x1: cx, y1: -bleed, x2: cx, y2: height + bleed },
      ], palette.tone4, 1.4, 0.6), { delay: 0.04, span: 0.55, enterDX: width * 0.1 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(width * 0.24, height * 0.36, width * 0.52, height * 0.28), palette.tone3, 0.94, ctx.gradient),
          { delay: 0.1, span: 0.55, enterDY: height * 0.06 });
      ctx.add(drawPolygonOutline(ctx.pixi, rectPolygon(width * 0.2, height * 0.32, width * 0.6, height * 0.36), palette.ink, 2.4, 0.85),
          { delay: 0.16, span: 0.5 });
      if (!ctx.showDecor) return;
      // Corner ticks, one arm each, pointing in at the box.
      ([[0.2, 0.32, 1, 1], [0.8, 0.32, -1, 1], [0.2, 0.68, 1, -1], [0.8, 0.68, -1, -1]]).forEach(([fx, fy, sx, sy], index) => {
          const x = width * fx;
          const y = height * fy;
          ctx.add(drawLines(ctx.pixi, [
              { x1: x, y1: y, x2: x + sx * width * 0.04, y2: y },
              { x1: x, y1: y, x2: x, y2: y + sy * height * 0.05 },
          ], palette.ink, 3, 0.8), { delay: 0.2 + index * 0.03, span: 0.5 });
      });
  };

  // A dial: solid ring, tick marks around it, one heavy pointer. The hub is left solid for type.
  const dialScale = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;
      addField(ctx, palette.tone2);
      // A drawn annulus, not a disc with a hole cut in it: the hub carries the type, so it has
      // to be opaque field rather than an opening that happens to have something behind it.
      ctx.add(drawPolygonFill(
          ctx.pixi,
          annularSectorPolygon(cx, cy, unit * 0.34, unit * 0.44, 0, Math.PI * 2 - 0.006, 60),
          palette.tone4,
          0.92,
          ctx.gradient,
      ), { delay: 0.05, span: 0.6 });
      const ticks = Array.from({ length: 24 }, (_, index) => {
          const angle = (index / 24) * Math.PI * 2;
          const inner = unit * (index % 6 === 0 ? 0.46 : 0.475);
          return {
              x1: cx + Math.cos(angle) * inner,
              y1: cy + Math.sin(angle) * inner,
              x2: cx + Math.cos(angle) * unit * 0.5,
              y2: cy + Math.sin(angle) * unit * 0.5,
          };
      });
      ctx.add(drawLines(ctx.pixi, ticks, palette.ink, 1.6, 0.7), { delay: 0.14, span: 0.55 });
      const pointer = 0.4 + temperaHash01(ctx.seed, 5, 149) * 0.5;
      ctx.add(drawPolygonFill(ctx.pixi, axisRect(
          cx + Math.cos(pointer * Math.PI * 2) * unit * 0.2,
          cy + Math.sin(pointer * Math.PI * 2) * unit * 0.2,
          unit * 0.4,
          unit * 0.035,
          pointer * Math.PI * 2,
      ), palette.ink, 0.9), { delay: 0.2, span: 0.5 });
  };

  // Chevrons repeating down the frame with one inverted: the repeat is what makes a hand-off
  // invisible, the odd one out is what the eye lands on.
  const chevronRun = ctx => {
      const { width, height, palette, bleed } = ctx;
      const focus = 2;
      addField(ctx, palette.tone1);
      for (let index = 0; index < 5; index += 1) {
          const y = height * (0.02 + index * 0.24);
          const rise = height * 0.12;
          const thickness = height * 0.07;
          const chevron = [
              -bleed, y, width * 0.5, y - rise, width + bleed, y,
              width + bleed, y + thickness, width * 0.5, y - rise + thickness, -bleed, y + thickness,
          ];
          ctx.add(drawPolygonFill(ctx.pixi, chevron, index === focus ? palette.tone4 : palette.tone3, index === focus ? 0.95 : 0.7, ctx.gradient),
              { delay: index * 0.04, span: 0.55, enterDY: -height * 0.12 });
      }
  };

  // A tally column hugging one edge, with the long mark as the focal element.
  const tallyColumn = ctx => {
      const { width, height, palette } = ctx;
      const x = width * 0.82;
      addField(ctx, palette.tone1);
      const marks = Array.from({ length: 11 }, (_, index) => {
          const long = index % 4 === 0;
          return {
              x1: x,
              y1: height * (0.1 + index * 0.075),
              x2: x + width * (long ? 0.12 : 0.06),
              y2: height * (0.1 + index * 0.075),
          };
      });
      ctx.add(drawLines(ctx.pixi, marks, palette.tone4, 2.4, 0.75), { delay: 0.06, span: 0.6, enterDX: width * 0.1 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(x - width * 0.02, height * 0.4, width * 0.16, height * 0.12), palette.tone4, 0.95, ctx.gradient),
          { delay: 0.16, span: 0.55, enterDX: width * 0.14 });
      ctx.add(drawLines(ctx.pixi, [{ x1: x, y1: height * 0.06, x2: x, y2: height * 0.92 }], palette.ink, 1.6, 0.6), { delay: 0.2, span: 0.5 });
  };

  // A hairline grid where one cell is filled and two are punched clean through.
  const gridFocus = ctx => {
      const { width, height, palette } = ctx;
      const left = width * 0.08;
      const top = height * 0.12;
      const cellWidth = (width * 0.84) / 4;
      const cellHeight = (height * 0.76) / 3;
      const cell = (column, row) => rectPolygon(left + cellWidth * column, top + cellHeight * row, cellWidth, cellHeight);
      addCutField(ctx, palette.tone2, [cell(0, 0), cell(3, 2)]);
      addHoleLip(ctx, cell(0, 0), 2, 0.7, 0.1);
      addHoleLip(ctx, cell(3, 2), 2, 0.7, 0.14);
      ctx.add(drawPolygonFill(ctx.pixi, cell(3, 0), palette.tone4, 0.95, ctx.gradient), { delay: 0.08, span: 0.55, enterDX: width * 0.08 });
      const lines = [];
      for (let column = 0; column <= 4; column += 1) {
          lines.push({ x1: left + cellWidth * column, y1: top, x2: left + cellWidth * column, y2: top + cellHeight * 3 });
      }
      for (let row = 0; row <= 3; row += 1) {
          lines.push({ x1: left, y1: top + cellHeight * row, x2: left + cellWidth * 4, y2: top + cellHeight * row });
      }
      ctx.add(drawLines(ctx.pixi, lines, palette.tone4, 1.2, 0.6), { delay: 0.16, span: 0.55 });
  };

  // One heavy axis running the length of the frame with a port bored through it and a cap block
  // at each end. The hole travels with the bar, not with the field behind it.
  const axisCaps = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const cx = width * 0.5;
      const cy = height * 0.42;
      const bar = axisRect(cx, cy, flowSpan(ctx), unit * 0.22, ctx.flowAngle);
      // The port is cut from the field as well as from the bar. Cutting only the bar would show
      // the field through it, not the background - a hole is only a window if nothing is left
      // behind it.
      const port = circlePolygon(cx, cy, unit * 0.08, 32);
      addCutField(ctx, palette.tone1, [port], { alpha: 0.92 });
      ctx.add(drawPolygonFillWithHoles(ctx.pixi, bar, [port], palette.tone4, 0.94, ctx.gradient),
          { delay: 0.05, span: 0.6 });
      ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: unit * 0.08 }], palette.ink, 2.4, 0.85), { delay: 0.12, span: 0.5 });
      ([1, -1]).forEach((side, index) => {
          const distance = unit * 0.46;
          const capX = cx + Math.cos(ctx.flowAngle) * distance * side;
          const capY = cy + Math.sin(ctx.flowAngle) * distance * side;
          ctx.add(drawPolygonFill(ctx.pixi, axisRect(capX, capY, unit * 0.1, unit * 0.34, ctx.flowAngle), palette.ink, 0.85),
              { delay: 0.16 + index * 0.04, span: 0.5 });
      });
  };

  // Slats of alternating width. The widest one is where the type goes, so it is drawn in the
  // pale tone while the rest close in around it.
  const strobeSlats = ctx => {
      const { width, height, palette, bleed } = ctx;
      addField(ctx, palette.tone1);
      const widths = [0.06, 0.03, 0.09, 0.04, 0.34, 0.04, 0.08, 0.03, 0.06];
      let cursor = width * 0.03;
      widths.forEach((fraction, index) => {
          const slat = rectPolygon(cursor, -bleed, width * fraction, height + bleed * 2);
          const wide = fraction > 0.2;
          ctx.add(drawPolygonFill(ctx.pixi, slat, wide ? palette.tone2 : palette.tone4, wide ? 0.9 : 0.85, ctx.gradient),
              { delay: index * 0.03, span: 0.55, enterDY: (index % 2 === 0 ? 1 : -1) * height * 0.14 });
          cursor += width * (fraction + 0.02);
      });
  };

  // Three plates of the same size stacked out of register, in the classic misprint stagger. The
  // top plate carries a register hole punched right through the stack.
  const offsetPlate = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const step = unit * 0.06;
      // One register hole drilled straight through the whole misregistered stack - the field and
      // every plate get the same opening at the same place, so it really is see-through.
      const holeX = width * 0.72;
      const holeY = height * 0.36;
      const hole = circlePolygon(holeX, holeY, unit * 0.05, 28);
      addCutField(ctx, palette.tone1, [hole], { alpha: 0.9 });
      ([palette.tone2, palette.tone3, palette.tone4]).forEach((tone, index) => {
          const plate = rectPolygon(width * 0.2 + step * index, height * 0.2 + step * index, width * 0.5, height * 0.5);
          ctx.add(drawPolygonFillWithHoles(ctx.pixi, plate, [hole], tone, index === 2 ? 0.95 : 0.8, ctx.gradient),
              { delay: index * 0.06, span: 0.55, enterDX: -step * 2, enterDY: -step });
      });
      ctx.add(drawRings(ctx.pixi, [{ x: holeX, y: holeY, radius: unit * 0.05 }], palette.ink, 2, 0.8), { delay: 0.22, span: 0.5 });
  };

  // A comb of rays from a hub parked off frame, with one solid sector as the mass.
  const radialComb = ctx => {
      const { width, height, palette } = ctx;
      const hubX = width * 1.06;
      const hubY = height * 1.1;
      const reach = Math.hypot(width, height) * 1.3;
      addField(ctx, palette.tone2);
      const rays = Array.from({ length: 11 }, (_, index) => {
          const angle = Math.PI + 0.16 + index * 0.062;
          return {
              x1: hubX,
              y1: hubY,
              x2: hubX + Math.cos(angle) * reach,
              y2: hubY + Math.sin(angle) * reach,
          };
      });
      ctx.add(drawLines(ctx.pixi, rays, palette.tone4, 2.6, 0.8), { delay: 0.06, span: 0.6 });
      const start = Math.PI + 0.44;
      const end = Math.PI + 0.56;
      ctx.add(drawPolygonFill(ctx.pixi, [
          hubX, hubY,
          hubX + Math.cos(start) * reach, hubY + Math.sin(start) * reach,
          hubX + Math.cos(end) * reach, hubY + Math.sin(end) * reach,
      ], palette.tone4, 0.95, ctx.gradient), { delay: 0.14, span: 0.6 });
      if (!ctx.showDecor) return;
      ctx.add(drawHatchFill(ctx.pixi, rectPolygon(width * 0.06, height * 0.08, width * 0.2, height * 0.14), buildHatchSpec(ctx.seed, 151), palette.tone4, 0.4),
          { delay: 0.24, span: 0.6, grow: true });
  };

  // A viewfinder: brackets around an opening low in the frame, type on the plate above it.
  const bracketTarget = ctx => {
      const { width, height, palette } = ctx;
      const box = rectPolygon(width * 0.28, height * 0.54, width * 0.44, height * 0.34);
      addCutField(ctx, palette.tone3, [box]);
      addHoleLip(ctx, box, 2.4, 0.85, 0.08);
      const arm = Math.min(width, height) * 0.08;
      ([[0.28, 0.54, 1, 1], [0.72, 0.54, -1, 1], [0.28, 0.88, 1, -1], [0.72, 0.88, -1, -1]]).forEach(([fx, fy, sx, sy], index) => {
          const x = width * fx + sx * width * 0.03;
          const y = height * fy + sy * height * 0.04;
          ctx.add(drawLines(ctx.pixi, [
              { x1: x, y1: y, x2: x + sx * arm, y2: y },
              { x1: x, y1: y, x2: x, y2: y + sy * arm },
          ], palette.ink, 3.5, 0.9), { delay: 0.12 + index * 0.04, span: 0.5, enterDX: sx * width * 0.05 });
      });
      ctx.add(drawLines(ctx.pixi, [{ x1: width * 0.1, y1: height * 0.44, x2: width * 0.9, y2: height * 0.44 }], palette.tone4, 1.6, 0.6),
          { delay: 0.24, span: 0.5, enterDX: -width * 0.1 });
  };

  const TEMPERA_SIGNAL_COMPOSITIONS = {
      'sight-mark': sightMark,
      'dial-scale': dialScale,
      'chevron-run': chevronRun,
      'tally-column': tallyColumn,
      'grid-focus': gridFocus,
      'axis-caps': axisCaps,
      'strobe-slats': strobeSlats,
      'offset-plate': offsetPlate,
      'radial-comb': radialComb,
      'bracket-target': bracketTarget,
  };

  __register('signal', TEMPERA_SIGNAL_COMPOSITIONS);
}());

/* ---- compositions/temperaCorridorCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaCorridorCompositions.ts
  // Openings cut *along* the direction the shot travels in. This is the family built for the
  // hand-off: neighbouring shots slide past each other along the flow vector, and a corridor
  // parallel to that vector still looks like the same corridor while it moves, so the seam
  // between two shots stops reading as an edit. The background stays continuously visible
  // through the moving opening instead of appearing and disappearing with each cut.
  //
  // Everything here is anchored past the frame on both ends - a corridor with a visible end is
  // a shape, and a shape betrays the cut. The type always rides a solid rib beside or across the
  // opening; `temperaCutout.ts` explains why it can never sit on the opening itself.
  const channel = (ctx, offset, width) => {
      const centre = acrossPoint(ctx, offset);
      return axisRect(centre.x, centre.y, flowSpan(ctx), width, channelAxis(ctx));
  };

  /** Rails running the length of a channel, a hair outside its lip. */
  const addRails = (ctx, offset, width, alpha = 0.55) => {
      const angle = channelAxis(ctx);
      const half = flowSpan(ctx) / 2;
      ([-1, 1]).forEach((side, index) => {
          const start = flowPoint(ctx, -half, offset + side * width);
          const end = flowPoint(ctx, half, offset + side * width);
          ctx.add(drawLines(ctx.pixi, [{ x1: start.x, y1: start.y, x2: end.x, y2: end.y }], ctx.palette.tone4, 1.4, alpha), {
              delay: 0.18 + index * 0.03,
              span: 0.5,
              enterDX: Math.cos(angle) * ctx.width * 0.08,
              enterDY: Math.sin(angle) * ctx.height * 0.08,
          });
      });
  };

  // One wide corridor down one side, railed on both edges.
  const flowChannel = ctx => {
      const { width, palette } = ctx;
      const unit = Math.min(width, ctx.height);
      const slot = channel(ctx, width * 0.26, unit * 0.3);
      addCutField(ctx, palette.tone3, [slot]);
      addHoleLip(ctx, slot, 2.6, 0.85, 0.08);
      addRails(ctx, width * 0.26, unit * 0.19);
  };

  // Two corridors with the type standing on the rib between them.
  const twinChannel = ctx => {
      const { width, palette } = ctx;
      const unit = Math.min(width, ctx.height);
      const slots = [channel(ctx, -width * 0.34, unit * 0.16), channel(ctx, width * 0.34, unit * 0.16)];
      addCutField(ctx, palette.tone4, slots);
      slots.forEach((slot, index) => addHoleLip(ctx, slot, 2.4, 0.8, 0.1 + index * 0.04));
  };

  // Reeds: many hairline corridors in the outer thirds, leaving a clear column down the middle.
  const reedRun = ctx => {
      const { width, palette } = ctx;
      const unit = Math.min(width, ctx.height);
      const slots = [];
      ([-1, 1]).forEach(side => {
          for (let index = 0; index < 4; index += 1) {
              slots.push(channel(ctx, side * width * (0.22 + index * 0.08), unit * 0.035));
          }
      });
      addCutField(ctx, palette.tone2, slots, { alpha: 0.9 });
      addRails(ctx, 0, width * 0.17, 0.4);
  };

  // A corridor that narrows as it runs: the only kind here whose opening is not translation
  // invariant, so it reads as the corridor arriving somewhere.
  const taperChannel = ctx => {
      const { width, palette } = ctx;
      const unit = Math.min(width, ctx.height);
      const half = flowSpan(ctx) / 2;
      const wide = unit * 0.24;
      const narrow = unit * 0.06;
      const offset = width * 0.24;
      const corners = [
          flowPoint(ctx, -half, offset - wide),
          flowPoint(ctx, -half, offset + wide),
          flowPoint(ctx, half, offset + narrow),
          flowPoint(ctx, half, offset - narrow),
      ];
      const slot = corners.flatMap(point => [point.x, point.y]);
      addCutField(ctx, palette.tone3, [slot]);
      addHoleLip(ctx, slot, 2.6, 0.85, 0.08);
  };

  // Ports bored along the travel line, chained by a hairline.
  const chainPorts = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const offset = width * 0.28;
      const spacing = height * 0.26;
      const ports = [-1.5, -0.5, 0.5, 1.5].map(step => flowPoint(ctx, step * spacing, offset));
      addCutField(ctx, palette.tone4, ports.map(port => circlePolygon(port.x, port.y, unit * 0.11, 40)));
      ctx.add(drawRings(ctx.pixi, ports.map(port => ({ x: port.x, y: port.y, radius: unit * 0.11 })), palette.ink, 2.4, 0.85),
          { delay: 0.1, span: 0.55 });
      const head = flowPoint(ctx, -spacing * 2.4, offset);
      const tail = flowPoint(ctx, spacing * 2.4, offset);
      ctx.add(drawLines(ctx.pixi, [{ x1: head.x, y1: head.y, x2: tail.x, y2: tail.y }], palette.tone2, 1.6, 0.6), { delay: 0.18, span: 0.5 });
  };

  // A corridor cut into dashes, with solid ties left between them.
  const dashChannel = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const offset = width * 0.24;
      const step = height * 0.32;
      const angle = channelAxis(ctx);
      const slots = [-1.5, -0.5, 0.5, 1.5].map(index => {
          const centre = flowPoint(ctx, index * step, offset);
          return axisRect(centre.x, centre.y, step * 0.72, unit * 0.22, angle);
      });
      addCutField(ctx, palette.tone3, slots);
      slots.forEach((slot, index) => addHoleLip(ctx, slot, 2.2, 0.8, 0.08 + index * 0.03));
  };

  // Carriage windows: rounded openings stepping past at a fixed pitch.
  const windowRun = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const offset = width * 0.27;
      // Pitch has to clear the window plus its lip, or the run reads as one chain of cells.
      const step = height * 0.36;
      const angle = channelAxis(ctx);
      const slots = [-1.5, -0.5, 0.5, 1.5].map(index => {
          const centre = flowPoint(ctx, index * step, offset);
          const size = unit * 0.2;
          return rotatePolygon(
              roundedRectPolygon(centre.x - size, centre.y - size * 0.62, size * 2, size * 1.24, size * 0.3),
              centre.x,
              centre.y,
              angle + Math.PI / 2,
          );
      });
      addCutField(ctx, palette.tone4, slots);
      slots.forEach((slot, index) => addHoleLip(ctx, slot, 2.4, 0.85, 0.08 + index * 0.03));
  };

  // The widest corridor in the family, crossed by one solid band. The type rides the band, so
  // the shot reads as a bridge over the background rather than as a plate with a hole in it.
  const bridgeSpan = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const slot = channel(ctx, 0, unit * 0.62);
      addCutField(ctx, palette.tone4, [slot]);
      addHoleLip(ctx, slot, 2.6, 0.8, 0.08);
      // The band is deliberately thicker than the type needs: it leans with the channel, and a
      // tilted band loses height off its own ends before the type has anywhere safe to sit.
      const band = axisRect(width / 2, height / 2, flowSpan(ctx), height * 0.46, channelAxis(ctx) + Math.PI / 2);
      ctx.add(drawPolygonFill(ctx.pixi, band, palette.tone3, 0.95, ctx.gradient), { delay: 0.12, span: 0.6, enterDX: -width * 0.16 });
      ctx.add(drawPolygonOutline(ctx.pixi, band, palette.ink, 2, 0.7), { delay: 0.2, span: 0.5, enterDX: width * 0.1 });
  };

  // Two corridors, each interrupted where the other one runs clear: the ties alternate, so the
  // pair reads as woven rather than as two parallel slots.
  const braidChannel = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const angle = channelAxis(ctx);
      const pitch = height * 0.42;
      const slots = [];
      ([-1, 1]).forEach(side => {
          // Half a pitch of offset between the two sides is the whole trick: where one corridor
          // is tied off, the other one is running clear.
          for (let index = -1; index <= 1; index += 1) {
              const centre = flowPoint(ctx, index * pitch + side * pitch * 0.5, side * width * 0.32);
              slots.push(axisRect(centre.x, centre.y, pitch * 0.78, unit * 0.16, angle));
          }
      });
      addCutField(ctx, palette.tone3, slots);
      slots.forEach((slot, index) => addHoleLip(ctx, slot, 2.2, 0.8, 0.08 + index * 0.025));
  };

  // A corridor with rungs ticked along both rails - the corridor as a measuring scale.
  const portLadder = ctx => {
      const { width, height, palette } = ctx;
      const unit = Math.min(width, height);
      const offset = width * 0.3;
      const slot = channel(ctx, offset, unit * 0.14);
      addCutField(ctx, palette.tone2, [slot]);
      addHoleLip(ctx, slot, 2.2, 0.8, 0.08);
      const rungs = Array.from({ length: 9 }, (_, index) => {
          const distance = (index - 4) * height * 0.13;
          const long = index % 3 === 0;
          const inner = flowPoint(ctx, distance, offset - unit * 0.09);
          const outer = flowPoint(ctx, distance, offset - unit * (long ? 0.22 : 0.15));
          return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
      });
      ctx.add(drawLines(ctx.pixi, rungs, palette.tone4, 2, 0.7), { delay: 0.14, span: 0.6 });
  };

  const TEMPERA_CORRIDOR_COMPOSITIONS = {
      'flow-channel': flowChannel,
      'twin-channel': twinChannel,
      'reed-run': reedRun,
      'taper-channel': taperChannel,
      'chain-ports': chainPorts,
      'dash-channel': dashChannel,
      'window-run': windowRun,
      'bridge-span': bridgeSpan,
      'braid-channel': braidChannel,
      'port-ladder': portLadder,
  };

  __register('corridor', TEMPERA_CORRIDOR_COMPOSITIONS);
}());

/* ---- compositions/temperaMonolithCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaMonolithCompositions.ts
  // Brutalism: one enormous matte solid, cropped by the frame, with the type sitting on its
  // silhouette. The whole family is built on a single move - a mass whose scale the frame cannot
  // contain - and `temperaMonolithKit.ts` holds the thin marks that give it that scale.
  //
  // The type is placed *across* the silhouette wherever the field behind it is solid, because a
  // glyph half on the mass and half off it is where the inversion filter does its best work.
  // Where a composition opens the ground to the background instead, the region moves onto the
  // mass; `temperaCutout.ts` explains why it can never straddle an opening.
  const apexMass = ctx => {
      const { width, height, palette, bleed } = ctx;
      const apexX = width * (0.46 + temperaHash01(ctx.seed, 3, 227) * 0.12);
      const apexY = height * 0.38;
      addGround(ctx, palette.tone1);
      const mass = [-bleed, height + bleed, apexX, apexY, width + bleed, height + bleed];
      addMass(ctx, mass, palette.tone3, { enterDY: height * 0.1 });
      // Ruled on one flank only. Both flanks would read as a texture rather than as a lit face.
      addFaceRuling(ctx, [apexX, apexY, width + bleed, height + bleed, apexX + width * 0.24, height + bleed], 229);
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
      addWireTrace(ctx, width * 0.12, height * 0.84, Math.min(width, height) * 0.09);
  };

  // A stepped mountain of slabs. Each course is its own node so the stack builds upward.
  const ziggurat = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      const tones = [palette.tone4, palette.tone3, palette.tone3, palette.tone2];
      for (let course = 0; course < 4; course += 1) {
          const half = width * (0.44 - course * 0.09);
          const top = height * (0.9 - course * 0.13) - height * 0.13;
          addMass(ctx, rectPolygon(width / 2 - half, top, half * 2, height * 0.13 + bleed), tones[course], {
              delay: 0.04 + course * 0.05,
              enterDY: height * 0.08,
              edgeWidth: 2,
          });
      }
      addSurveyLines(ctx, 2);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
  };

  // A wall filling most of the frame with one deep joint down its leading edge.
  const slabWall = ctx => {
      const { width, height, palette, bleed } = ctx;
      const edge = width * 0.36;
      addGround(ctx, palette.tone1);
      addMass(ctx, rectPolygon(edge, -bleed, width - edge + bleed, height + bleed * 2), palette.tone3, { edge: false });
      ctx.add(drawLines(ctx.pixi, [{ x1: edge, y1: -bleed, x2: edge, y2: height + bleed }], palette.ink, 3.5, 0.9),
          { delay: 0.1, span: 0.55, enterDX: width * 0.06 });
      addFaceRuling(ctx, rectPolygon(width * 0.62, height * 0.1, width * 0.3, height * 0.8), 233);
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addWireTrace(ctx, width * 0.16, height * 0.24, Math.min(width, height) * 0.08);
  };

  // A beam thrown out over nothing, with the one stub of support that makes it a cantilever.
  const cantilever = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      addMass(ctx, rectPolygon(0.16 * width, height * 0.5, width * 0.1, height * 0.5 + bleed), palette.tone4, {
          delay: 0.02,
          enterDY: height * 0.1,
          edge: false,
      });
      addMass(ctx, rectPolygon(-bleed, height * 0.34, width * 0.78 + bleed, height * 0.16), palette.tone3, {
          delay: 0.08,
          enterDX: -width * 0.14,
      });
      addFaceRuling(ctx, rectPolygon(width * 0.3, height * 0.36, width * 0.44, height * 0.12), 239, palette.paper, 0.35);
      addSurveyLines(ctx, 2);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
  };

  // Two pylons and the lintel they carry. The bay between them is cut clean out of the ground,
  // so the gap is sky rather than paper.
  const pylonPair = ctx => {
      const { width, height, palette, bleed } = ctx;
      const bay = rectPolygon(width * 0.26, height * 0.3, width * 0.48, height * 0.7 + bleed);
      addCutField(ctx, palette.tone1, [bay], { alpha: 0.94 });
      addHoleLip(ctx, bay, 2, 0.6, 0.12);
      ([0.1, 0.74]).forEach((x, index) => {
          addMass(ctx, rectPolygon(width * x, height * 0.28, width * 0.16, height * 0.72 + bleed), palette.tone4, {
              delay: 0.04 + index * 0.05,
              enterDY: height * 0.08,
              edgeWidth: 2,
          });
      });
      addMass(ctx, rectPolygon(width * 0.04, height * 0.14, width * 0.92, height * 0.16), palette.tone3, {
          delay: 0.14,
          enterDY: -height * 0.1,
      });
      addSurveyLines(ctx, 2);
  };

  // A blockhouse with one observation slit. The slit is cut from the ground as well as the mass:
  // a hole in the mass alone would only show the paper behind it.
  const bunkerSlit = ctx => {
      const { width, height, palette, bleed } = ctx;
      const slit = rectPolygon(-bleed, height * 0.62, width + bleed * 2, height * 0.06);
      addCutField(ctx, palette.tone1, [slit], { alpha: 0.94 });
      // The mass arrives as two courses that stop either side of the slit. Drawing it as one
      // block and cutting the slit out of that would work too, but the halves entering from
      // opposite directions is what makes the opening read as prised apart.
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height * 0.34, width + bleed * 2, height * 0.28), palette.tone4, 0.95, ctx.gradient),
          { delay: 0.05, span: 0.6, enterDY: -height * 0.08 });
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height * 0.68, width + bleed * 2, height * 0.32 + bleed), palette.tone4, 0.95, ctx.gradient),
          { delay: 0.08, span: 0.6, enterDY: height * 0.1 });
      ctx.add(drawLines(ctx.pixi, [
          { x1: -bleed, y1: height * 0.34, x2: width + bleed, y2: height * 0.34 },
      ], palette.ink, 3, 0.85), { delay: 0.14, span: 0.5 });
      addFaceRuling(ctx, rectPolygon(width * 0.08, height * 0.72, width * 0.36, height * 0.2), 241, palette.paper, 0.3);
      addSurveyLines(ctx, 2);
  };

  // Three courses of plinth, each one stepped in from the one below it.
  const plinthStack = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      addMass(ctx, rectPolygon(width * 0.06, height * 0.72, width * 0.88, height * 0.28 + bleed), palette.tone4, { edgeWidth: 2 });
      addMass(ctx, rectPolygon(width * 0.16, height * 0.52, width * 0.68, height * 0.2), palette.tone3, { delay: 0.08, edgeWidth: 2 });
      addMass(ctx, rectPolygon(width * 0.28, height * 0.34, width * 0.44, height * 0.18), palette.tone2, { delay: 0.14, enterDY: height * 0.06 });
      addFaceRuling(ctx, rectPolygon(width * 0.2, height * 0.76, width * 0.6, height * 0.16), 243);
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
  };

  // A row of buttresses. The ground is opened in one band and the fins are set into it, so the
  // sky shows between them without every gap needing its own cut.
  const buttressRun = ctx => {
      const { width, height, palette, bleed } = ctx;
      const band = rectPolygon(-bleed, height * 0.42, width + bleed * 2, height * 0.58 + bleed);
      addCutField(ctx, palette.tone1, [band], { alpha: 0.94 });
      for (let index = 0; index < 5; index += 1) {
          const left = width * (index * 0.2 + 0.01);
          addMass(ctx, [
              left, height + bleed,
              left + width * 0.09, height * 0.42,
              left + width * 0.17, height + bleed,
          ], index % 2 === 0 ? palette.tone4 : palette.tone3, {
              delay: 0.04 + index * 0.04,
              enterDY: height * 0.12,
              edgeWidth: 2,
          });
      }
      ctx.add(drawLines(ctx.pixi, [{ x1: -bleed, y1: height * 0.42, x2: width + bleed, y2: height * 0.42 }], palette.ink, 2.4, 0.8),
          { delay: 0.2, span: 0.5, enterDX: -width * 0.1 });
      addSurveyLines(ctx, 2);
  };

  // A single mass with its middle removed. The opening is the largest in the mode, and the band
  // left above it is exactly what the type stands on.
  const voidCore = ctx => {
      const { width, height, palette } = ctx;
      const core = rectPolygon(width * 0.22, height * 0.34, width * 0.56, height * 0.46);
      addCutField(ctx, palette.tone3, [core], { alpha: 0.95 });
      addHoleLip(ctx, core, 3.5, 0.9, 0.08);
      addFaceRuling(ctx, rectPolygon(width * 0.04, height * 0.36, width * 0.14, height * 0.42), 247, palette.tone4, 0.45);
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
      addWireTrace(ctx, width * 0.86, height * 0.86, Math.min(width, height) * 0.08);
  };

  // One block sheared along a diagonal and the halves pushed past each other.
  const shearBlock = ctx => {
      const { width, height, palette } = ctx;
      const left = width * 0.14;
      const right = width * 0.86;
      const top = height * 0.2;
      const bottom = height * 0.8;
      const cutTop = width * 0.56;
      const cutBottom = width * 0.44;
      addGround(ctx, palette.tone1);
      addMass(ctx, [left, top, cutTop, top, cutBottom, bottom, left, bottom], palette.tone3, {
          enterDX: -width * 0.08,
          enterDY: -height * 0.03,
          edgeWidth: 2,
      });
      addMass(ctx, [cutTop + width * 0.03, top + height * 0.04, right, top + height * 0.04, right, bottom + height * 0.04, cutBottom + width * 0.03, bottom + height * 0.04], palette.tone4, {
          delay: 0.1,
          enterDX: width * 0.08,
          enterDY: height * 0.03,
          edgeWidth: 2,
      });
      addSurveyLines(ctx, 2);
      if (!ctx.showDecor) return;
      ctx.add(drawPolygonOutline(ctx.pixi, rectPolygon(width * 0.1, height * 0.16, width * 0.8, height * 0.68), palette.paper, 1.2, 0.35),
          { delay: 0.28, span: 0.55 });
  };

  const TEMPERA_MONOLITH_COMPOSITIONS = {
      'apex-mass': apexMass,
      'ziggurat': ziggurat,
      'slab-wall': slabWall,
      'cantilever': cantilever,
      'pylon-pair': pylonPair,
      'bunker-slit': bunkerSlit,
      'plinth-stack': plinthStack,
      'buttress-run': buttressRun,
      'void-core': voidCore,
      'shear-block': shearBlock,
  };

  __register('monolith', TEMPERA_MONOLITH_COMPOSITIONS);
}());

/* ---- compositions/temperaTerrainCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaTerrainCompositions.ts
  // The other half of the brutalist set: masses read as ground and structure rather than as
  // objects - ridges, spans, piers, revetments. Same rules as `temperaMonolithCompositions.ts`
  // (one dominant solid, thin survey marks, everything cropped by the frame); what changes is
  // that the horizon these make is something the frame is inside of rather than looking at.
  const ridgeLine = ctx => {
      const { width, height, palette, bleed } = ctx;
      const lift = temperaHash01(ctx.seed, 5, 251) * 0.06;
      addGround(ctx, palette.tone1);
      // The ridge is the composition; the type is set to straddle its highest run.
      addMass(ctx, [
          -bleed, height * (0.68 + lift),
          width * 0.34, height * (0.4 + lift),
          width * 0.62, height * (0.58 + lift),
          width + bleed, height * (0.34 + lift),
          width + bleed, height + bleed,
          -bleed, height + bleed,
      ], palette.tone3, { enterDY: height * 0.08 });
      addFaceRuling(ctx, [
          width * 0.34, height * (0.42 + lift),
          width * 0.62, height * (0.6 + lift),
          width * 0.62, height + bleed,
          width * 0.34, height + bleed,
      ], 253, palette.tone4, 0.45);
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
      addWireTrace(ctx, width * 0.1, height * 0.86, Math.min(width, height) * 0.08);
  };

  // Two masses that do not meet. The gap between them is cut to the background, which makes it
  // the only bright thing in the frame.
  const chasm = ctx => {
      const { width, height, palette, bleed } = ctx;
      const gap = rectPolygon(width * 0.46, -bleed, width * 0.1, height + bleed * 2);
      addCutField(ctx, palette.tone1, [gap], { alpha: 0.94 });
      addMass(ctx, rectPolygon(-bleed, height * 0.3, width * 0.46 + bleed, height * 0.7 + bleed), palette.tone3, {
          enterDX: -width * 0.1,
          edgeWidth: 2,
      });
      addMass(ctx, rectPolygon(width * 0.56, height * 0.2, width * 0.44 + bleed, height * 0.8 + bleed), palette.tone4, {
          delay: 0.08,
          enterDX: width * 0.1,
          edgeWidth: 2,
      });
      addSurveyLines(ctx, 2);
  };

  // A roof pressing down from above, with the wall it runs into and the shadow it throws.
  const overhang = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      addMass(ctx, rectPolygon(-bleed, -bleed, width + bleed * 2, height * 0.34 + bleed), palette.tone4, {
          enterDY: -height * 0.1,
          edgeWidth: 3,
      });
      addMass(ctx, rectPolygon(width * 0.72, height * 0.34, width * 0.28 + bleed, height * 0.66 + bleed), palette.tone3, {
          delay: 0.08,
          enterDX: width * 0.1,
          edge: false,
      });
      // The shadow is a wash, not a mass: it must not be able to carry type on its own.
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height * 0.34, width + bleed * 2, height * 0.14), palette.tone2, 0.5, ctx.gradient),
          { delay: 0.16, span: 0.6 });
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
  };

  // A stepwell: courses descending inward to a shaft cut through every one of them.
  const stepWell = ctx => {
      const { width, height, palette, bleed } = ctx;
      const shaft = rectPolygon(width * 0.36, height * 0.6, width * 0.28, height * 0.4 + bleed);
      addCutField(ctx, palette.tone2, [shaft], { alpha: 0.94 });
      ([[0.14, 0.3, 0.72, palette.tone3], [0.24, 0.44, 0.52, palette.tone4]]).forEach(([x, y, w, tone], index) => {
          ctx.add(drawPolygonFillWithHoles(
              ctx.pixi,
              rectPolygon(width * x, height * y, width * w, height * (1 - y) + bleed),
              [shaft],
              tone,
              0.95,
              ctx.gradient,
          ), { delay: 0.06 + index * 0.06, span: 0.6, enterDY: height * 0.06 });
      });
      addHoleLip(ctx, shaft, 3, 0.85, 0.18);
      addSurveyLines(ctx, 2);
  };

  // Piers standing in an opened band, with the deck they carry running across all of them.
  const pierRow = ctx => {
      const { width, height, palette, bleed } = ctx;
      const water = rectPolygon(-bleed, height * 0.46, width + bleed * 2, height * 0.54 + bleed);
      addCutField(ctx, palette.tone1, [water], { alpha: 0.94 });
      [0.04, 0.28, 0.52, 0.76].forEach((x, index) => {
          addMass(ctx, rectPolygon(width * x, height * 0.46, width * 0.14, height * 0.54 + bleed), palette.tone4, {
              delay: 0.06 + index * 0.04,
              enterDY: height * 0.1,
              edge: false,
          });
      });
      // The deck has to be deeper than the type's box: it is the only solid thing over an
      // opened band, so anything hanging off it would be set against bare background.
      addMass(ctx, rectPolygon(-bleed, height * 0.32, width + bleed * 2, height * 0.16), palette.tone3, {
          delay: 0.02,
          enterDX: -width * 0.12,
          edgeWidth: 2,
      });
      addSurveyLines(ctx, 2);
  };

  // A revetment slope with its ribs, running out past both edges.
  const revetment = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      const slope = [
          -bleed, height * 0.72,
          width * 0.62, height * 0.3,
          width + bleed, height * 0.34,
          width + bleed, height + bleed,
          -bleed, height + bleed,
      ];
      addMass(ctx, slope, palette.tone3, { enterDY: height * 0.1 });
      const ribs = Array.from({ length: 9 }, (_, index) => {
          const x = width * (0.04 + index * 0.11);
          const top = height * (0.72 - (x / (width * 0.62)) * 0.42);
          return { x1: x, y1: Math.max(top, height * 0.3) + height * 0.03, x2: x - width * 0.03, y2: height + bleed };
      });
      ctx.add(drawLines(ctx.pixi, ribs, palette.tone4, 2.4, 0.5), { delay: 0.16, span: 0.65 });
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
  };

  // One corner of something far larger, and a great deal of nothing. The quietest way this
  // family can state its scale.
  const towerCrop = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      addMass(ctx, rectPolygon(width * 0.58, height * 0.18, width * 0.42 + bleed, height * 0.82 + bleed), palette.tone4, {
          enterDX: width * 0.08,
          enterDY: height * 0.06,
          edgeWidth: 3,
      });
      addFaceRuling(ctx, rectPolygon(width * 0.62, height * 0.26, width * 0.12, height * 0.6), 257, palette.paper, 0.3);
      addSurveyLines(ctx, 2);
      if (!ctx.showDecor) return;
      addWireTrace(ctx, width * 0.2, height * 0.7, Math.min(width, height) * 0.1);
      addCornerTicks(ctx);
  };

  // A lintel with both bearings off frame: the span is all there is.
  const lintel = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      addMass(ctx, rectPolygon(-bleed, height * 0.4, width + bleed * 2, height * 0.2), palette.tone3, {
          enterDX: -width * 0.16,
          edgeWidth: 3,
      });
      ([0.18, 0.66]).forEach((x, index) => {
          addMass(ctx, rectPolygon(width * x, height * 0.6, width * 0.16, height * 0.12), palette.tone4, {
              delay: 0.12 + index * 0.04,
              enterDY: height * 0.06,
              edge: false,
          });
      });
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
  };

  // Broken slabs fanned out from a point off frame - the same mass after it has failed.
  const rubbleFan = ctx => {
      const { width, height, palette } = ctx;
      const hubX = -width * 0.12;
      const hubY = height * 1.12;
      addGround(ctx, palette.tone1);
      for (let index = 0; index < 5; index += 1) {
          const angle = -1.24 + index * 0.19 + temperaHash01(ctx.seed, index, 259) * 0.05;
          const reach = Math.hypot(width, height) * (0.5 + index * 0.09);
          const slab = rectPolygon(hubX + reach * 0.34, hubY - height * 0.06, reach * 0.5, height * 0.12 + index * 8);
          addMass(ctx, rotatePolygon(slab, hubX, hubY, angle), index % 2 === 0 ? palette.tone3 : palette.tone4, {
              delay: 0.04 + index * 0.05,
              enterDX: -width * 0.06,
              enterDY: height * 0.06,
              edgeWidth: 2,
          });
      }
      addSurveyLines(ctx, 2);
  };

  // A gnomon and the shadow it casts: two masses, one of which is only a direction.
  const gnomon = ctx => {
      const { width, height, palette, bleed } = ctx;
      addGround(ctx, palette.tone1);
      ctx.add(drawPolygonFill(ctx.pixi, [
          width * 0.42, height * 0.86,
          width + bleed, height * 0.6,
          width + bleed, height * 0.78,
          width * 0.46, height * 0.94,
      ], palette.tone2, 0.6, ctx.gradient), { delay: 0.1, span: 0.65, enterDX: width * 0.1 });
      addMass(ctx, [
          width * 0.3, height + bleed,
          width * 0.36, height * 0.16,
          width * 0.42, height * 0.16,
          width * 0.46, height + bleed,
      ], palette.tone4, { delay: 0.04, enterDY: height * 0.08, edgeWidth: 2 });
      addSurveyLines(ctx, 3);
      if (!ctx.showDecor) return;
      addCornerTicks(ctx);
      addWireTrace(ctx, width * 0.8, height * 0.82, Math.min(width, height) * 0.08);
  };

  const TEMPERA_TERRAIN_COMPOSITIONS = {
      'ridge-line': ridgeLine,
      'chasm': chasm,
      'overhang': overhang,
      'step-well': stepWell,
      'pier-row': pierRow,
      'revetment': revetment,
      'tower-crop': towerCrop,
      'lintel': lintel,
      'rubble-fan': rubbleFan,
      'gnomon': gnomon,
  };

  __register('terrain', TEMPERA_TERRAIN_COMPOSITIONS);
}());

/* ---- compositions/temperaMonogatariCompositions.ts ---- */
(function () {
  // src/components/visualizer/tempera/compositions/temperaMonogatariCompositions.ts
  // Interstitial cards in the Monogatari manner: one flat field edge to edge, and the type is
  // the whole picture. These carry almost no geometry on purpose - the shot before and after
  // does the work, and the card is the beat of silence between them.

  // The field alternates which end of the tone ladder it takes, so consecutive cards in a song
  // read as a cut rather than as a hold.
  const addField = (ctx, tone) => {
      const { width, height, bleed } = ctx;
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), tone, 1, ctx.gradient),
          { span: 0.45 });
  };

  const pickField = (ctx) => (
      temperaHash01(ctx.seed, 167, 173) > 0.5 ? ctx.palette.tone4 : ctx.palette.tone1
  );

  // Bare card: flat field, nothing else. The type carries it alone.
  const monogatariCard = ctx => {
      addField(ctx, pickField(ctx));
      if (!ctx.showDecor) return;
      // A single hairline at the very bottom, the way a title card carries a footer rule.
      ctx.add(drawLines(ctx.pixi, [
          { x1: ctx.width * 0.12, y1: ctx.height * 0.9, x2: ctx.width * 0.88, y2: ctx.height * 0.9 },
      ], ctx.palette.paper, 1.2, 0.45), { delay: 0.22, span: 0.6, enterDX: ctx.width * 0.15 });
  };

  // Flat field with a heavy rule under the type, splitting the card in two.
  const monogatariRule = ctx => {
      const { width, height, palette, bleed } = ctx;
      addField(ctx, pickField(ctx));
      const y = height * (0.62 + temperaHash01(ctx.seed, 179, 181) * 0.08);
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, y, width + bleed * 2, height * 0.012), palette.paper, 0.85, ctx.gradient),
          { delay: 0.12, span: 0.55, enterDX: -width * 0.3 });
      if (!ctx.showDecor) return;
      ctx.add(drawLines(ctx.pixi, [
          { x1: -bleed, y1: y + height * 0.05, x2: width + bleed, y2: y + height * 0.05 },
      ], palette.paper, 1, 0.35), { delay: 0.2, span: 0.6, enterDX: width * 0.2 });
  };

  // Flat field with a contrasting band down one edge, like a bound page.
  const monogatariEdge = ctx => {
      const { width, height, palette, bleed } = ctx;
      const field = pickField(ctx);
      addField(ctx, field);
      const band = width * (0.1 + temperaHash01(ctx.seed, 191, 193) * 0.05);
      const fromLeft = temperaHash01(ctx.seed, 197, 199) > 0.5;
      const spine = rectPolygon(fromLeft ? -bleed : width - band, -bleed, band + bleed, height + bleed * 2);
      ctx.add(drawPolygonFill(ctx.pixi, spine, field === palette.tone4 ? palette.tone1 : palette.tone4, 0.95, ctx.gradient),
          { delay: 0.1, span: 0.55, enterDX: (fromLeft ? -1 : 1) * width * 0.2 });
      if (!ctx.showDecor) return;
      ctx.add(drawHatchFill(ctx.pixi, spine, buildHatchSpec(ctx.seed, 211), palette.paper, 0.2),
          { delay: 0.18, span: 0.6, grow: true });
  };

  // Flat field, narrow type column: the card reads as a stacked caption.
  const monogatariStack = ctx => {
      const { width, height, palette, bleed } = ctx;
      addField(ctx, pickField(ctx));
      const column = width * 0.5;
      ctx.add(drawLines(ctx.pixi, [
          { x1: (width - column) / 2, y1: -bleed, x2: (width - column) / 2, y2: height + bleed },
          { x1: (width + column) / 2, y1: -bleed, x2: (width + column) / 2, y2: height + bleed },
      ], palette.paper, 1.1, 0.4), { delay: 0.14, span: 0.6, enterDY: height * 0.12 });
  };

  // The loud one: field at the far end of the ladder, type at its largest, a row of marks.
  const monogatariFlash = ctx => {
      const { width, height, palette } = ctx;
      addField(ctx, palette.tone4);
      if (!ctx.showDecor) return;
      ctx.add(drawCrossMarks(
          ctx.pixi,
          buildCrossRow(ctx.seed, 223, width * 0.1, height * 0.18, 4, width * 0.05, 10),
          palette.paper,
          2.4,
          0.6,
      ), { delay: 0.2, span: 0.5, enterDX: -width * 0.1 });
  };

  const TEMPERA_MONOGATARI_COMPOSITIONS = {
      'monogatari-card': monogatariCard,
      'monogatari-rule': monogatariRule,
      'monogatari-edge': monogatariEdge,
      'monogatari-stack': monogatariStack,
      'monogatari-flash': monogatariFlash,
  };

  __register('monogatari', TEMPERA_MONOGATARI_COMPOSITIONS);
}());
  /* ---- temperaCompositions.ts：注册表 + 两层共享叠加 ---- */
  /* 合并顺序照抄源文件：后来的族覆盖先前同名 kind（若有）。 */
  var COMPOSITIONS = Object.assign(
    {},
    __families.split,
    __families.band,
    __families.frame,
    __families.poster,
    __families.sparse,
    __families.cinema,
    __families.charm,
    __families.aperture,
    __families.signal,
    __families.corridor,
    __families.monolith,
    __families.terrain,
    __families.monogatari,
  );

  /* 每种 kind 都要有 drawer；缺的回落 duo-split。 */
  function resolveTemperaComposition(kind) {
    return COMPOSITIONS[kind] ?? COMPOSITIONS['duo-split'];
  }

  /* 浅色全片导线，每种 kind 共用；它负责把视线从这一张带到下一张。 */
  function addCrossingLines(ctx) {
    var lines = buildCrossingLines(ctx.seed, 31, ctx.width, ctx.height, ctx.decor.crossCount);
    if (lines.length === 0) return;
    ctx.add(drawLines(ctx.pixi, lines, ctx.palette.tone4, 1.3, 0.6), {
      delay: 0.14,
      span: 0.6,
      enterDX: ctx.width * 0.25
    });
  }

  /* 母题叠加：编译期选好的一个额外网点元素，叠在任何 kind 上。 */
  function addMotif(ctx) {
    var width = ctx.width;
    var height = ctx.height;
    var palette = ctx.palette;
    var decor = ctx.decor;
    var cornerX = temperaHash01(ctx.seed, 61, 7) > 0.5 ? width * 0.14 : width * 0.86;
    var cornerY = temperaHash01(ctx.seed, 63, 7) > 0.5 ? height * 0.18 : height * 0.82;
    switch (decor.motif) {
      case 'diamonds':
        ctx.add(drawConcentricDiamonds(ctx.pixi, cornerX, cornerY, 34, 34, 3, palette.tone4, 0.8),
          { delay: 0.34, drift: true });
        return;
      case 'hatch-twin': {
        var spec = Object.assign({}, buildHatchSpec(ctx.seed, 67), { angle: decor.hatchAngle });
        [0, 1].forEach(function (index) {
          var box = rectPolygon(cornerX - 34 + index * 46, cornerY - 26, 38, 38);
          ctx.add(drawHatchFill(ctx.pixi, box,
            index === 0 ? spec : Object.assign({}, spec, { spacing: spec.spacing * 0.55 }),
            palette.tone4, 0.75), { delay: 0.34 + index * 0.05, grow: true });
          ctx.add(drawPolygonOutline(ctx.pixi, box, palette.tone4, 1.2, 0.6),
            { delay: 0.38 + index * 0.05 });
        });
        return;
      }
      case 'band-cross':
        ctx.add(drawCrossMarks(
          ctx.pixi,
          buildCrossRow(ctx.seed, 71, cornerX - width * 0.1, cornerY, 5, width * 0.05, 8,
            decor.hatchAngle * 0.4),
          palette.tone4,
          2,
          0.8,
        ), { delay: 0.34, span: 0.5 });
        return;
      case 'poster-diamond':
        /* 故意停到边缘外，让形状出血出画。 */
        ctx.add(drawPolygonFill(
          ctx.pixi,
          diamondPolygon(cornerX < width / 2 ? -width * 0.04 : width * 1.04, cornerY,
            width * 0.14, height * 0.2),
          palette.tone3,
          0.85,
        ), {
          delay: 0.32,
          span: 0.55,
          enterDX: (cornerX < width / 2 ? -1 : 1) * width * 0.1
        });
        return;
      case 'doodle':
      default:
        ctx.add(drawPolyline(
          ctx.pixi,
          buildScribblePath(decor.scribbleSeed, 73, cornerX, cornerY,
            Math.min(width, height) * 0.08, 3),
          palette.tone4,
          1.5,
          0.72,
        ), { delay: 0.34, span: 0.6 });
    }
  }

  function drawTemperaComposition(ctx) {
    resolveTemperaComposition(ctx.kind)(ctx);
    /* 间奏卡按定义就是一片空场；共享叠加会把它们毁掉。 */
    if (resolveTemperaShotProfile(ctx.kind).sharedDecor === false) return;
    addCrossingLines(ctx);
    if (ctx.showDecor) addMotif(ctx);
  }

  var FAMILY_KEYS = [
    'split', 'band', 'frame', 'poster', 'sparse', 'cinema', 'charm',
    'aperture', 'signal', 'corridor', 'monolith', 'terrain', 'monogatari'
  ];

  window.foliaTemperaCompositions = {
    FAMILY_KEYS: FAMILY_KEYS,
    FAMILIES: __families,
    COMPOSITIONS: COMPOSITIONS,
    KIND_COUNT: Object.keys(COMPOSITIONS).length,
    resolve: resolveTemperaComposition,
    draw: drawTemperaComposition,
    /* 共享 plumbing（cutout / monolithKit）—— 冒烟要单独量它们 */
    fieldPolygon: fieldPolygon,
    addCutField: addCutField,
    addHoleLip: addHoleLip,
    axisRect: axisRect,
    channelAxis: channelAxis,
    acrossFlow: acrossFlow,
    acrossPoint: acrossPoint,
    flowPoint: flowPoint,
    flowSpan: flowSpan,
    addMass: addMass,
    addGround: addGround,
    addFaceRuling: addFaceRuling,
    addSurveyLines: addSurveyLines,
    addCornerTicks: addCornerTicks,
    addWireTrace: addWireTrace
  };
}());
