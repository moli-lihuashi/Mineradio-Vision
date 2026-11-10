/* lumiere 的器械：11 个光位 rig 与它们的目录。
 *
 * 从 Folia lumiere 的 12 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereLineart = window.foliaLumiereLineart;
  if (!foliaLumiereLineart) return;

  var arcPoints = foliaLumiereLineart.arcPoints;
  var mergeSpecs = foliaLumiereLineart.mergeSpecs;
  var protractorHalo = foliaLumiereLineart.protractorHalo;
  var scatteredSparks = foliaLumiereLineart.scatteredSparks;
  var viewfinderFrame = foliaLumiereLineart.viewfinderFrame;
  var armillary = foliaLumiereLineart.armillary;
  var constellation = foliaLumiereLineart.constellation;
  var corona = foliaLumiereLineart.corona;
  var crescent = foliaLumiereLineart.crescent;
  var meteors = foliaLumiereLineart.meteors;
  var mergeDiagrams = foliaLumiereLineart.mergeDiagrams;
  var orbits = foliaLumiereLineart.orbits;
  var sextant = foliaLumiereLineart.sextant;
  var starTrails = foliaLumiereLineart.starTrails;
  var bigLeaf = foliaLumiereLineart.bigLeaf;
  var bloom = foliaLumiereLineart.bloom;
  var canopy = foliaLumiereLineart.canopy;
  var cells = foliaLumiereLineart.cells;
  var fernCurl = foliaLumiereLineart.fernCurl;
  var molecule = foliaLumiereLineart.molecule;
  var seedRoots = foliaLumiereLineart.seedRoots;
  var vine = foliaLumiereLineart.vine;
  var sprout = foliaLumiereLineart.sprout;
  var circle = foliaLumiereLineart.circle;
  var crystal = foliaLumiereLineart.crystal;
  var glassCup = foliaLumiereLineart.glassCup;
  var magnifier = foliaLumiereLineart.magnifier;
  var ripples = foliaLumiereLineart.ripples;
  var waterline = foliaLumiereLineart.waterline;
  var archWindow = foliaLumiereLineart.archWindow;
  var crossWindow = foliaLumiereLineart.crossWindow;
  var doorSlit = foliaLumiereLineart.doorSlit;
  var gridPanel = foliaLumiereLineart.gridPanel;
  var roseWindow = foliaLumiereLineart.roseWindow;
  var tallWindows = foliaLumiereLineart.tallWindows;
  var blindsWindow = foliaLumiereLineart.blindsWindow;
  var horizon = foliaLumiereLineart.horizon;
  var fiber = foliaLumiereLineart.fiber;
  var focusMark = foliaLumiereLineart.focusMark;
  var interfaceLine = foliaLumiereLineart.interfaceLine;
  var lens = foliaLumiereLineart.lens;
  var mirror = foliaLumiereLineart.mirror;
  var pinholeBox = foliaLumiereLineart.pinholeBox;
  var rayPath = foliaLumiereLineart.rayPath;
  var ruler = foliaLumiereLineart.ruler;
  var segment = foliaLumiereLineart.segment;
  var cubeSplitter = foliaLumiereLineart.cubeSplitter;
  var rainbowArcs = foliaLumiereLineart.rainbowArcs;
  var shards = foliaLumiereLineart.shards;
  var spectrumLines = foliaLumiereLineart.spectrumLines;
  var prismTriangle = foliaLumiereLineart.prismTriangle;
  var curtains = foliaLumiereLineart.curtains;
  var lampHead = foliaLumiereLineart.lampHead;
  var projector = foliaLumiereLineart.projector;
  var grating = foliaLumiereLineart.grating;
  var moire = foliaLumiereLineart.moire;
  var polarizers = foliaLumiereLineart.polarizers;
  var rings = foliaLumiereLineart.rings;
  var standingWave = foliaLumiereLineart.standingWave;
  var twoSources = foliaLumiereLineart.twoSources;
  var slitBarrier = foliaLumiereLineart.slitBarrier;

  /* ---- rigs/base.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/base.ts
// 各族光位共用的积木：光束预设、烟雾、浮尘、星空、线稿，以及按族填默认值的光位构造器。
const TOP = { x: 0.5, y: -0.04 };
const DOWN = Math.PI / 2;

/** 主光柱：窄、亮、束内有一丝丝的亮纹。 */
const shaft = (overrides = {}) => ({
    ...TOP, angle: DOWN, spread: 0.09, width: 0.05, length: 0.8, softness: 0.6,
    intensity: 0.95, streaks: 0.6, streakFreq: 7, streakSpeed: 0.08, core: 0.75,
    sway: { amplitude: 0.012, period: 13, phase: 0 },
    ...overrides,
});

/** 主光柱外的一圈放射光扇。 */
const fan = (overrides = {}) => ({
    ...TOP, angle: DOWN, spread: 0.3, length: 0.6, softness: 0.9,
    intensity: 0.32, streaks: 0.85, streakFreq: 26, streakSpeed: 0.05, core: 0.4,
    sway: { amplitude: 0.02, period: 17, phase: 0.3 },
    ...overrides,
});

const FOG = { density: 1, tyndallBase: 0.12, scale: 2.4, driftX: 0.008, driftY: -0.04, warp: 0.9, ambient: 0.03 };
const GLARE = { x: 0.5, y: 0.0, radius: 0.12, intensity: 0.9, streak: 0.45 };

const MOTES = {
    count: 260, sizeMin: 0.004, sizeMax: 0.013, driftX: 0.004, driftY: -0.01,
    swirl: 0.02, swirlPeriod: 9, twinkle: 0.5, ambient: 0.015, gain: 1.3,
};
const FRONT = {
    count: 9, sizeMin: 0.05, sizeMax: 0.15, driftX: 0.006, driftY: -0.002,
    swirl: 0.012, swirlPeriod: 14, twinkle: 0.2, ambient: 0.02, gain: 0.3,
};
const STARFALL = { stars: 420, opening: 3.2, rain: 70, rainSpeed: 0.22, rainSpread: 0.35, brightness: 1 };

/** 量角器光环 + 取景框 + 散落闪点（参考图的线稿）。 */
const standardArt = ({ aspect, random }, haloRadius = 0.3) => mergeSpecs(
    protractorHalo({ cx: aspect * 0.5, cy: 0.03, radius: haloRadius, alpha: 0.55 }),
    viewfinderFrame({ aspect, left: 0.07, top: 0.21, right: 0.93, bottom: 0.8, delay: 0.1, alpha: 0.32 }),
    scatteredSparks({ aspect, count: 16, random, delay: 0.3 }),
);

/** 只有取景框与闪点（光路、干涉这类自己画图解的族用）。 */
const frameArt = ({ aspect, random }) => mergeSpecs(
    viewfinderFrame({ aspect, left: 0.07, top: 0.21, right: 0.93, bottom: 0.8, delay: 0.1, alpha: 0.28 }),
    scatteredSparks({ aspect, count: 14, random, delay: 0.3 }),
);

const ellipse = (cx, cy, rx, ry, steps = 96) => (
    arcPoints(0, 0, 1, 0, Math.PI * 2, steps).map(([x, y]) => [cx + x * rx, cy + y * ry])
);

const rig = (beams, fog = {}, glare = GLARE, modules = {}) => () => ({
    beams,
    fog: { ...FOG, ...fog },
    glare,
    ...modules,
});


/** 按族填默认值的光位构造器：各光位只写不同的地方。 */
const familyOf = (family, defaults = {}) => (profile) => ({
    family,
    motes: MOTES,
    front: FRONT,
    lineArt: context => standardArt(context),
    region: { cx: 0.5, cy: 0.54, w: 0.72, h: 0.5 },
    heroSize: 0.085,
    camera: { push: 0.035, driftX: 0, driftY: -0.006 },
    ...defaults,
    ...profile,
});

  /* ---- rigs/astral.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/astral.ts
// 星象族：日食、日冕、轨道、星轨、星座、月与星云。默认带满天的星（星空点亮的星多、光雨少）。
// 排版 4 横 / 3 竖 / 3 纵横。
const astral = familyOf('astral', {
    starfall: { ...STARFALL, stars: 620, rain: 20, brightness: 1.1 },
    motes: { ...MOTES, count: 160 },
    // 轨道、星轨、星座、浑天仪的线稿是这一族的主角。
    artGain: 2,
});

const sparks = ({ aspect, random }) => scatteredSparks({ aspect, count: 20, random, delay: 0.3 });

/** 从圆盘 (cx, cy, r) 的边缘向外放射的一圈光束（日冕、日食）。 */
const radial = (cx, cy, r, aspect, count, overrides = {}) => (
    Array.from({ length: count }, (_, k) => {
        const angle = (k / count) * Math.PI * 2 + 0.3;
        return shaft({
            x: cx + (Math.cos(angle) * r) / aspect, y: cy + Math.sin(angle) * r, angle, spread: 0.14, width: 0.04, length: 0.35, softness: 0.8,
            intensity: 0.7, streaks: 0.7, streakFreq: 12, core: 0.3, sway: { amplitude: 0.04, period: 9 + k, phase: k / count },
            ...overrides,
        });
    })
);

/** 日食（l）：黑盘周围一圈日冕光，边上一颗贝利珠闪光。 */
const astralEclipse = astral({
    kind: 'astral-eclipse',
    label: '日食',
    mood: 'loud',
    light: ({ aspect }) => ({
        beams: radial(0.5, 0.34, 0.13, aspect, 6),
        fog: { density: 0.8, tyndallBase: 0.2, scale: 2.4, driftX: 0.004, driftY: -0.01, warp: 0.9, ambient: 0.02 },
        glare: { x: 0.5 + 0.13 * Math.cos(-0.8) / aspect, y: 0.34 + 0.13 * Math.sin(-0.8), radius: 0.05, intensity: 1.3, streak: 0.9 },
    }),
    lineArt: ({ aspect, random }) => mergeDiagrams(corona(aspect * 0.5, 0.34, 0.13, random), sparks({ aspect, random })),
    region: { cx: 0.5, cy: 0.7, w: 0.72, h: 0.4 },
    typography: 'crossed',
    burst: { mode: 'sung', density: 0.35, every: 1, offset: 0, size: 3.6, tint: [1, 0.6, 0.45] },
    decay: { strength: 1.3, delay: 0.7 },
});

/** 轨道（q）：同心的椭圆轨道，行星光点在上面。 */
const astralOrbit = astral({
    kind: 'astral-orbit',
    label: '轨道',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.05, intensity: 0.45, reach: 0.4 })], { density: 0.6, ambient: 0.015 }, { x: 0.5, y: 0.42, radius: 0.05, intensity: 1, streak: 0.5 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(orbits(aspect * 0.5, 0.42, [0.12, 0.2, 0.3, 0.42], -0.18, 0.34, random), sparks({ aspect, random })),
    region: { cx: 0.5, cy: 0.74, w: 0.72, h: 0.32 },
    typography: 'horizontal',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 星轨（q）：绕着天极缓慢旋转的一圈圈星轨。 */
const astralTrail = astral({
    kind: 'astral-trail',
    label: '星轨',
    mood: 'quiet',
    light: rig([shaft({ x: 0.72, spread: 0.04, intensity: 0.35 })], { density: 0.5, ambient: 0.01 }, null),
    lineArt: ({ aspect, random }) => mergeDiagrams(starTrails(aspect * 0.72, 0.12, random, 60, 0.9)),
    region: { cx: 0.36, cy: 0.54, w: 0.44, h: 0.6 },
    typography: 'vertical',
    decay: { strength: 0.5, delay: 1.8 },
});

/** 六分仪（n）：刻度弧、两条半径与一条对准太阳的视线。 */
const astralSextant = astral({
    kind: 'astral-sextant',
    label: '六分仪',
    mood: 'neutral',
    light: rig([shaft({ x: 0.85, y: -0.05, angle: 2.2, spread: 0.05, width: 0.03, length: 1.4, intensity: 0.9 })], { density: 0.8 }, { ...GLARE, x: 0.85, y: -0.02 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(sextant(aspect * 0.4, 0.14, 0.32), sparks({ aspect, random })),
    region: { cx: 0.52, cy: 0.66, w: 0.72, h: 0.4 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 星座（n）：星星连成一个星座，字像是星名。 */
const astralConstellation = astral({
    kind: 'astral-constellation',
    label: '星座',
    mood: 'neutral',
    light: rig([shaft({ spread: 0.06, intensity: 0.4 })], { density: 0.6, ambient: 0.015 }, { ...GLARE, intensity: 0.4 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(
        constellation(aspect, random, 8, [0.1, 0.1, 0.9, 0.42]),
        constellation(aspect, random, 5, [0.6, 0.62, 0.95, 0.9], { delay: 0.3 }),
    ),
    region: { cx: 0.42, cy: 0.66, w: 0.6, h: 0.4 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 日冕（l）：太阳在画面上方，边缘放射出丝丝的冕光。 */
const astralCorona = astral({
    kind: 'astral-corona',
    label: '日冕',
    mood: 'loud',
    light: ({ aspect }) => ({
        beams: radial(0.5, 0.12, 0.1, aspect, 6, { length: 0.6, intensity: 0.9 }),
        fog: { density: 1, tyndallBase: 0.15, scale: 2.4, driftX: 0.004, driftY: -0.02, warp: 0.9, ambient: 0.03 },
        glare: { x: 0.5, y: 0.12, radius: 0.16, intensity: 1.3, streak: 0.7 },
    }),
    lineArt: ({ aspect, random }) => mergeDiagrams(corona(aspect * 0.5, 0.12, 0.1, random), sparks({ aspect, random })),
    region: { cx: 0.5, cy: 0.62, w: 0.72, h: 0.46 },
    typography: 'crossed',
    burst: { mode: 'sung', density: 0.3, every: 2, offset: 0, size: 3.4, tint: [1, 0.65, 0.4] },
    decay: { strength: 1.3, delay: 0.7 },
});

/** 月光（q）：右上角一弯新月，冷色的光斜照下来，云雾流动。 */
const astralMoon = astral({
    kind: 'astral-moon',
    label: '月光',
    mood: 'quiet',
    light: rig([shaft({ x: 0.82, y: 0.12, angle: 2.1, spread: 0.12, width: 0.08, length: 1.4, softness: 0.8, intensity: 0.75, tint: [0.72, 0.82, 1] })],
        { density: 1.2, driftX: -0.01, driftY: 0, ambient: 0.035, warp: 1.3 }, { x: 0.82, y: 0.12, radius: 0.1, intensity: 0.8, streak: 0.2 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(crescent(aspect * 0.82, 0.12, 0.07), sparks({ aspect, random })),
    region: { cx: 0.38, cy: 0.54, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 星云（n）：大片带颜色的烟，光从里面透出来。 */
const astralNebula = astral({
    kind: 'astral-nebula',
    label: '星云',
    mood: 'neutral',
    light: rig([
        shaft({ x: 0.4, y: 0.45, angle: -0.6, spread: 0.6, width: 0.1, length: 0.8, softness: 1, intensity: 0.5, streaks: 0.6, streakFreq: 3, core: 0.2, spectrum: 0.7, sway: { amplitude: 0.2, period: 20, phase: 0 } }),
        shaft({ x: 0.6, y: 0.45, angle: 2.4, spread: 0.6, width: 0.1, length: 0.8, softness: 1, intensity: 0.4, streaks: 0.6, streakFreq: 3, core: 0.2, spectrum: 0.7, sway: { amplitude: 0.2, period: 23, phase: 0.5 } }),
    ], { density: 1.4, ambient: 0.06, warp: 1.6, scale: 1.6, driftX: 0.006, driftY: 0.002 }, { x: 0.5, y: 0.45, radius: 0.08, intensity: 0.7, streak: 0.2 }),
    lineArt: sparks,
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 浑天（n）：浑天仪的几个环缓慢转动。 */
const astralArmillary = astral({
    kind: 'astral-armillary',
    label: '浑天',
    mood: 'neutral',
    light: rig([shaft(), fan({ intensity: 0.2 })]),
    lineArt: ({ aspect, random }) => mergeDiagrams(armillary(aspect * 0.5, 0.42, 0.26), sparks({ aspect, random })),
    region: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 1, delay: 1 },
});

/** 流星（l）：几道斜着划过的光迹与拖尾。 */
const astralMeteor = astral({
    kind: 'astral-meteor',
    label: '流星',
    mood: 'loud',
    light: rig([0, 1, 2].map(i => shaft({
        x: 0.95 - i * 0.2, y: -0.02 + i * 0.05, angle: 2.5, spread: 0.01, width: 0.006, length: 0.6, intensity: 0.9, streaks: 0.2, core: 0.8, reach: 0.5 + i * 0.1,
        pulse: { amplitude: 0.7, period: 2.2 + i * 0.7, phase: i * 0.3 }, sway: undefined,
    })), { density: 0.7, ambient: 0.015 }, null),
    lineArt: ({ aspect, random }) => mergeDiagrams(meteors(aspect, random, 6), sparks({ aspect, random })),
    typography: 'crossed',
    decay: { strength: 1.3, delay: 0.7 },
    starfall: { ...STARFALL, stars: 620, rain: 60, rainSpeed: 0.6, rainSpread: 1.8, brightness: 1.2 },
});

const ASTRAL_PROFILES = [
    astralEclipse, astralOrbit, astralTrail, astralSextant, astralConstellation,
    astralCorona, astralMoon, astralNebula, astralArmillary, astralMeteor,
];

  /* ---- rigs/botany.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/botany.ts
// 叶脉族（光合）：嫩叶、叶脉、林冠、花与藤的线稿在光里生长。「萌芽」是 L0 的第一个光位（参考图底部）。
const botanySprout = {
    kind: 'botany-sprout',
    label: '萌芽',
    family: 'botany',
    mood: 'quiet',
    light: () => ({
        beams: [
            {
                x: 0.5, y: -0.05, angle: Math.PI / 2, spread: 0.075, width: 0.07, length: 1.2, softness: 0.7,
                intensity: 0.95, streaks: 0.5, streakFreq: 6, streakSpeed: 0.06, core: 0.7,
                sway: { amplitude: 0.008, period: 15, phase: 0.2 },
            },
            {
                x: 0.5, y: -0.05, angle: Math.PI / 2, spread: 0.26, length: 0.75, softness: 0.95,
                intensity: 0.42, streaks: 0.85, streakFreq: 30, streakSpeed: 0.04, core: 0.3,
            },
        ],
        fog: {
            density: 0.9, tyndallBase: 0.14, scale: 2, driftX: -0.006, driftY: -0.03, warp: 1.1, ambient: 0.025,
        },
        glare: { x: 0.5, y: -0.01, radius: 0.1, intensity: 0.9, streak: 0.35 },
    }),
    motes: {
        count: 200, sizeMin: 0.004, sizeMax: 0.011, driftX: -0.003, driftY: -0.012,
        swirl: 0.018, swirlPeriod: 11, twinkle: 0.55, ambient: 0.012, gain: 1.2,
    },
    front: {
        count: 6, sizeMin: 0.05, sizeMax: 0.12, driftX: -0.004, driftY: -0.002,
        swirl: 0.01, swirlPeriod: 16, twinkle: 0.2, ambient: 0.015, gain: 0.25,
    },
    lineArt: ({ aspect, random }) => mergeSpecs(
        sprout({ cx: aspect * 0.5, baseY: 0.78, size: 0.22, alpha: 1 }),
        protractorHalo({ cx: aspect * 0.5, cy: 0.02, radius: 0.22, alpha: 0.35, delay: 0.2 }),
        viewfinderFrame({ aspect, left: 0.07, top: 0.22, right: 0.93, bottom: 0.8, delay: 0.25, alpha: 0.22 }),
        scatteredSparks({ aspect, count: 12, random, delay: 0.35, region: [0.2, 0.3, 0.8, 0.9] }),
    ),
    // 竖排为主：当前行竖在光柱里，像茎一样从叶上长出来。
    region: { cx: 0.5, cy: 0.44, w: 0.72, h: 0.6 },
    heroSize: 0.08,
    // 光柱窄，背景碎片小一点。
    echo: { size: 0.28 },
    typography: 'vertical',
    decay: { strength: 0.75, delay: 1.2 },
    starfall: { stars: 300, opening: 3.6, rain: 50, rainSpeed: 0.16, rainSpread: 0.25, brightness: 0.85 },
    camera: { push: 0.03, driftX: 0, driftY: 0.004 },
};

// ---------------------------------------------------------------------------------------------
// 叶脉族其余 9 种。排版（连萌芽）4 横 / 3 竖 / 3 纵横。

const botany = familyOf('botany', {
    motes: { ...MOTES, count: 220, driftY: -0.012 },
    // 叶、蕨、花、藤的线稿是这一族的主角。
    artGain: 1.7,
    starfall: { ...STARFALL, rain: 40 },
});

const botanySparks = ({ aspect, random }) => scatteredSparks({ aspect, count: 12, random, delay: 0.3 });

/** 叶脉（n）：一片大叶斜在画面上，脉络被斜光一段段点亮。 */
const botanyVeins = botany({
    kind: 'botany-veins',
    label: '叶脉',
    mood: 'neutral',
    light: rig([shaft({ x: 0.15, y: -0.05, angle: 1.1, spread: 0.12, width: 0.12, length: 1.4, intensity: 0.9, streaks: 0.5, streakFreq: 6 })],
        { density: 0.9 }, { ...GLARE, x: 0.15, y: -0.02, radius: 0.14, intensity: 0.8 }),
    lineArt: context => mergeDiagrams(bigLeaf(context.aspect * 0.52, 0.42, 0.62, -0.45), botanySparks(context)),
    region: { cx: 0.5, cy: 0.72, w: 0.72, h: 0.36 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 林冠（l）：仰视树冠，几道光从叶间射下。 */
const botanyCanopy = botany({
    kind: 'botany-canopy',
    label: '林冠',
    mood: 'loud',
    light: rig([0.25, 0.48, 0.7].map((x, i) => shaft({
        x, y: -0.05, angle: 1.45 + i * 0.1, spread: 0.08, width: 0.08, length: 1.3, softness: 0.6, intensity: 0.85, streaks: 0.5, streakFreq: 6,
        gobo: { pattern: 'leaves', frequency: 9, duty: 0.5, drift: 0.14 }, sway: { amplitude: 0.03, period: 6 + i, phase: i * 0.3 },
    })), { density: 1.1, driftX: 0.008 }, null),
    lineArt: ({ aspect, random }) => mergeDiagrams(canopy(aspect, random), scatteredSparks({ aspect, count: 16, random, delay: 0.3 })),
    motes: { ...MOTES, count: 300, driftX: 0.008, driftY: 0.006, swirl: 0.03 },
    typography: 'crossed',
    decay: { strength: 1.2, delay: 0.8 },
    starfall: { ...STARFALL, rain: 90, rainSpread: 1.2 },
});

/** 蕨卷（n）：一枝蕨叶卷曲着，随唱缓缓展开。 */
const botanyFern = botany({
    kind: 'botany-fern',
    label: '蕨卷',
    mood: 'neutral',
    light: rig([shaft({ x: 0.3, spread: 0.08, intensity: 0.85 }), fan({ x: 0.3, intensity: 0.2 })]),
    lineArt: context => mergeDiagrams(fernCurl(context.aspect * 0.28, 0.42, 0.16), botanySparks(context)),
    region: { cx: 0.62, cy: 0.5, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.8, delay: 1.2 },
});

/** 种子（q）：一道光落在一粒种子上，根须往下长。 */
const botanySeed = botany({
    kind: 'botany-seed',
    label: '种子',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.04, width: 0.02, length: 1.2, intensity: 0.8, core: 0.9 })], { density: 0.7, ambient: 0.02 }, { ...GLARE, intensity: 0.6 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(seedRoots(aspect * 0.5, 0.7, random), scatteredSparks({ aspect, count: 10, random, delay: 0.3 })),
    region: { cx: 0.5, cy: 0.38, w: 0.72, h: 0.4 },
    typography: 'horizontal',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 绽放（l）：以光点为中心，花瓣线稿一片片打开。 */
const botanyBloom = botany({
    kind: 'botany-bloom',
    label: '绽放',
    mood: 'loud',
    light: rig(Array.from({ length: 6 }, (_, k) => shaft({
        x: 0.5, y: 0.42, angle: (k / 6) * Math.PI * 2 + 0.26, spread: 0.12, width: 0.01, length: 0.6, softness: 0.7, intensity: 0.55,
        streaks: 0.5, streakFreq: 7, core: 0.4, reach: 0.45, sway: { amplitude: 0.05, period: 10, phase: k / 6 },
    })), { density: 0.9 }, { x: 0.5, y: 0.42, radius: 0.1, intensity: 1.2, streak: 0.4 }),
    lineArt: context => mergeDiagrams(bloom(context.aspect * 0.5, 0.42, 0.2, 8), botanySparks(context)),
    typography: 'crossed',
    burst: { mode: 'sweep', density: 0.5, every: 3, offset: 1, size: 3, tint: [1, 0.8, 0.7] },
    decay: { strength: 1.2, delay: 0.8 },
});

/** 藤旋（n）：藤蔓螺旋着向光攀升。 */
const botanyVine = botany({
    kind: 'botany-vine',
    label: '藤旋',
    mood: 'neutral',
    light: rig([shaft({ x: 0.72, spread: 0.07, intensity: 0.9 }), fan({ x: 0.72, intensity: 0.2 })], {}, { ...GLARE, x: 0.72 }),
    lineArt: context => mergeDiagrams(vine(context.aspect * 0.72, 1.02, 0.08, 0.05, 4), botanySparks(context)),
    region: { cx: 0.36, cy: 0.5, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 1, delay: 1 },
});

/** 叶绿（q）：显微镜视野里，叶绿体的小圆点在光里发亮。 */
const botanyChloro = botany({
    kind: 'botany-chloro',
    label: '叶绿',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.2, width: 0.3, softness: 0.9, intensity: 0.6, core: 0.3 })], { density: 0.7 }, null,
        { caustic: { scale: 6, speed: 0.12, inBeam: 0.3, floor: { cx: 0.5, cy: 0.45, rx: 0.2, ry: 0.36, strength: 0.35 } } }),
    lineArt: ({ aspect, random }) => mergeDiagrams(cells(aspect * 0.5, 0.45, 0.36, random, 22), scatteredSparks({ aspect, count: 8, random, delay: 0.3 })),
    region: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 },
    typography: 'crossed',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 光合式（n）：分子结构的线稿与量角器光环，致敬参考图里的化学式。 */
const botanyFormula = botany({
    kind: 'botany-formula',
    label: '光合式',
    mood: 'neutral',
    light: rig([shaft(), fan()]),
    lineArt: context => mergeDiagrams(
        molecule(context.aspect * 0.24, 0.3, 0.06),
        molecule(context.aspect * 0.78, 0.74, 0.05, { delay: 0.2 }),
        protractorHalo({ cx: context.aspect * 0.5, cy: 0.03, radius: 0.28, alpha: 0.5 }),
        botanySparks(context),
    ),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 花粉（l）：斜光里漂着大颗的花粉粒子。 */
const botanyPollen = botany({
    kind: 'botany-pollen',
    label: '花粉',
    mood: 'loud',
    light: rig([shaft({ x: 0.2, y: -0.05, angle: 1.15, spread: 0.14, width: 0.16, length: 1.5, intensity: 1, streaks: 0.5 }), fan({ x: 0.2, angle: 1.15, intensity: 0.3 })],
        { density: 1, driftX: 0.012, driftY: -0.01 }, { ...GLARE, x: 0.2, y: 0.0 }),
    lineArt: botanySparks,
    motes: { count: 360, sizeMin: 0.006, sizeMax: 0.022, driftX: 0.012, driftY: -0.006, swirl: 0.04, swirlPeriod: 10, twinkle: 0.4, ambient: 0.02, gain: 1.6 },
    typography: 'horizontal',
    decay: { strength: 1.2, delay: 0.8 },
});

const BOTANY_PROFILES = [
    botanySprout, botanyVeins, botanyCanopy, botanyFern, botanySeed,
    botanyBloom, botanyVine, botanyChloro, botanyFormula, botanyPollen,
];

  /* ---- rigs/caustic.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/caustic.ts
// 焦散族：水、玻璃、晶体折出的流动光网。焦散模块调制光束，也可以在一块区域（池底、杯底）单独发亮。
// 排版 4 横 / 3 竖 / 3 纵横。
const caustic = familyOf('caustic', {
    motes: { ...MOTES, driftY: -0.004, swirl: 0.03, swirlPeriod: 12 },
    region: { cx: 0.5, cy: 0.46, w: 0.72, h: 0.46 },
});

const causticSparks = (count = 10) => ({ aspect, random }) => scatteredSparks({ aspect, count, random, delay: 0.3 });

const softTop = (overrides = {}) => shaft({
    spread: 0.22, width: 0.2, length: 1.4, softness: 0.8, intensity: 0.8, streaks: 0.3, core: 0.3, ...overrides,
});

const water = (spec = {})  => ({ caustic: { scale: 2.2, speed: 0.35, inBeam: 0.8, ...spec } });

/** 池底（q）：顶光落进水里，光柱里是流动的焦散网，池底有一片焦散光斑。 */
const causticPool = caustic({
    kind: 'caustic-pool',
    label: '池底',
    mood: 'quiet',
    light: rig([softTop()], { density: 0.8, driftY: -0.015, ambient: 0.02 }, { ...GLARE, intensity: 0.6 },
        water({ floor: { cx: 0.5, cy: 0.82, rx: 0.42, ry: 0.14, strength: 0.7 } })),
    lineArt: ({ aspect, random }) => ({
        paths: [{ points: ellipse(aspect * 0.5, 0.82, aspect * 0.42, 0.14), width: 0.0014, alpha: 0.4, delay: 0.1, span: 0.6 }],
        nodes: causticSparks()({ aspect, random }).nodes,
    }),
    typography: 'horizontal',
    decay: { strength: 0.7, delay: 1.4 },
});

/** 杯影（n）：侧光穿过玻璃杯，桌面上投下一片焦散。 */
const causticCup = caustic({
    kind: 'caustic-cup',
    label: '杯影',
    mood: 'neutral',
    light: rig([shaft({ x: -0.05, y: 0.3, angle: 0.35, spread: 0.08, width: 0.18, length: 1.6, softness: 0.5, intensity: 0.9, streaks: 0.3, core: 0.4, sway: undefined })],
        { density: 0.8 }, null,
        water({ scale: 3.2, speed: 0.25, inBeam: 0.3, floor: { cx: 0.36, cy: 0.8, rx: 0.14, ry: 0.07, strength: 1.1 } })),
    lineArt: context => mergeDiagrams(glassCup(context.aspect * 0.24, 0.52, 0.1, 0.2), causticSparks()(context)),
    region: { cx: 0.62, cy: 0.48, w: 0.56, h: 0.64 },
    typography: 'vertical',
    decay: { strength: 1, delay: 1 },
});

/** 涟漪（n）：水面荡开一圈圈同心波纹，光里的焦散随之晃动。 */
const causticRipple = caustic({
    kind: 'caustic-ripple',
    label: '涟漪',
    mood: 'neutral',
    light: rig([softTop({ intensity: 0.75 })], { density: 0.8 }, { ...GLARE, intensity: 0.5 },
        water({ scale: 3, speed: 0.5, inBeam: 0.6, floor: { cx: 0.5, cy: 0.8, rx: 0.34, ry: 0.1, strength: 0.5 } })),
    lineArt: context => mergeDiagrams(ripples(context.aspect * 0.5, 0.8, 0.34, 5), causticSparks()(context)),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 水面（l）：从水下仰望，水面的光斑与几道斜射下来的光束。 */
const causticSurface = caustic({
    kind: 'caustic-surface',
    label: '水面',
    mood: 'loud',
    light: rig([0.2, 0.42, 0.6, 0.8].map((x, i) => shaft({
        x, y: 0.1, angle: 1.35 + i * 0.06, spread: 0.04, width: 0.05, length: 1.2, softness: 0.6, intensity: 0.7, streaks: 0.5, streakFreq: 6, core: 0.5,
        sway: { amplitude: 0.05, period: 6 + i, phase: i * 0.2 },
    })), { density: 1.1, driftY: -0.02 }, null,
    water({ scale: 2.6, speed: 0.6, inBeam: 0.9, floor: { cx: 0.5, cy: 0.06, rx: 0.6, ry: 0.07, strength: 0.9 } })),
    lineArt: context => mergeDiagrams(waterline(context.aspect, 0.1, 0.012, 7), causticSparks(14)(context)),
    motes: { ...MOTES, count: 300, driftY: -0.02, swirl: 0.03 },
    region: { cx: 0.5, cy: 0.58, w: 0.72, h: 0.46 },
    typography: 'horizontal',
    decay: { strength: 1.2, delay: 0.8 },
});

/** 戒光（q）：一个圆环的内壁，焦散曲线落在环里。 */
const causticRing = caustic({
    kind: 'caustic-ring',
    label: '戒光',
    mood: 'quiet',
    light: rig([softTop({ spread: 0.14, width: 0.1, intensity: 0.7 })], { density: 0.7 }, { ...GLARE, intensity: 0.5 },
        water({ scale: 4, speed: 0.2, inBeam: 0.2, floor: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.36, strength: 0.6 } })),
    lineArt: context => mergeDiagrams(
        { paths: [circle(context.aspect * 0.5, 0.5, 0.36, { width: 0.0024, alpha: 0.6 }), circle(context.aspect * 0.5, 0.5, 0.32, { width: 0.0009, alpha: 0.3, delay: 0.1 })], nodes: [] },
        causticSparks()(context),
    ),
    region: { cx: 0.5, cy: 0.5, w: 0.4, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 聚点（l）：放大镜把光聚成一点，正好落在字上（会聚光束过焦点再散开）。 */
const causticBurn = caustic({
    kind: 'caustic-burn',
    label: '聚点',
    mood: 'loud',
    light: rig([
        shaft({ x: 0.5, y: 0.2, angle: Math.PI / 2, spread: -0.22, width: 0.2, length: 1.4, softness: 0.5, intensity: 1.2, streaks: 0.3, streakFreq: 5, core: 0.6, sway: { amplitude: 0.02, period: 9, phase: 0 } }),
        shaft({ x: 0.5, y: -0.1, angle: Math.PI / 2, spread: 0.03, width: 0.22, length: 1, intensity: 0.4, streaks: 0.4, reach: 0.3, sway: undefined }),
    ], { density: 1 }, { x: 0.5, y: 0.65, radius: 0.05, intensity: 1.1, streak: 0.8 }),
    lineArt: context => mergeDiagrams(magnifier(context.aspect * 0.5, 0.2, 0.1), causticSparks(12)(context)),
    region: { cx: 0.5, cy: 0.66, w: 0.72, h: 0.4 },
    typography: 'crossed',
    burst: { mode: 'sung', density: 0.35, every: 1, offset: 0, size: 3.6, tint: [1, 0.7, 0.45] },
    decay: { strength: 1.3, delay: 0.7 },
});

/** 粼粼（n）：横向的水面反光条纹在字上闪烁。 */
const causticShimmer = caustic({
    kind: 'caustic-shimmer',
    label: '粼粼',
    mood: 'neutral',
    light: rig([shaft({ x: -0.05, y: 0.5, angle: 0.02, spread: 0.06, width: 0.5, length: 2.4, softness: 0.4, intensity: 0.8, streaks: 0.2, core: 0.2,
        gobo: { pattern: 'blinds', frequency: 18, duty: 0.35, drift: 0.3 }, sway: undefined })],
    { density: 0.8 }, null, water({ scale: 1.4, speed: 0.8, inBeam: 0.6 })),
    lineArt: context => mergeDiagrams(waterline(context.aspect, 0.86, 0.008, 9), causticSparks()(context)),
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.5 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 晶影（n）：光穿过水晶，投下放射的光斑与一点彩色。 */
const causticCrystal = caustic({
    kind: 'caustic-crystal',
    label: '晶影',
    mood: 'neutral',
    light: rig([0, 1, 2, 3, 4].map(k => shaft({
        x: 0.5, y: 0.26, angle: Math.PI / 2 + (k - 2) * 0.45, spread: 0.05, width: 0.01, length: 0.8, softness: 0.5, intensity: 0.6,
        streaks: 0.3, core: 0.4, spectrum: 0.7, sway: { amplitude: 0.05, period: 12, phase: k * 0.15 },
    })), { density: 0.9 }, { ...GLARE, x: 0.5, y: 0.26, radius: 0.07, intensity: 1, streak: 0.5 },
    water({ scale: 3.4, speed: 0.2, inBeam: 0.4, floor: { cx: 0.5, cy: 0.8, rx: 0.3, ry: 0.09, strength: 0.5 } })),
    lineArt: context => mergeDiagrams(crystal(context.aspect * 0.5, 0.26, 0.05), causticSparks(14)(context)),
    region: { cx: 0.5, cy: 0.58, w: 0.72, h: 0.44 },
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 漂流（q）：大尺度的焦散缓慢漂移，几乎静止。 */
const causticDrift = caustic({
    kind: 'caustic-drift',
    label: '漂流',
    mood: 'quiet',
    light: rig([softTop({ spread: 0.4, width: 0.4, intensity: 1, softness: 0.95 })], { density: 0.8, driftX: 0.004, driftY: 0, ambient: 0.03 }, { ...GLARE, intensity: 0.5 },
        water({ scale: 1, speed: 0.08, inBeam: 0.8, floor: { cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.4, strength: 0.4 } })),
    lineArt: causticSparks(8),
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.5, delay: 1.8 },
});

/** 骤光（l）：高频闪烁的焦散随鼓点跳动。 */
const causticStorm = caustic({
    kind: 'caustic-storm',
    label: '骤光',
    mood: 'loud',
    light: rig([softTop({ intensity: 1, pulse: { amplitude: 0.35, period: 0.9, phase: 0 } })], { density: 1.1 }, { ...GLARE, intensity: 0.8 },
        water({ scale: 3, speed: 1.3, inBeam: 1, floor: { cx: 0.5, cy: 0.82, rx: 0.5, ry: 0.14, strength: 0.8 } })),
    lineArt: context => mergeDiagrams(ripples(context.aspect * 0.5, 0.82, 0.5, 4), causticSparks(14)(context)),
    typography: 'horizontal',
    decay: { strength: 1.3, delay: 0.7 },
});

const CAUSTIC_PROFILES = [
    causticPool, causticCup, causticRipple, causticSurface, causticRing,
    causticBurn, causticShimmer, causticCrystal, causticDrift, causticStorm,
];

  /* ---- rigs/lattice.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/lattice.ts
// 窗隙族（窗光与窗影）：光从窗、门缝、叶隙斜射进来，窗影把光束切成图样。排版 4 横 / 3 竖 / 3 纵横。
const lattice = familyOf('lattice', {
    region: { cx: 0.56, cy: 0.58, w: 0.66, h: 0.5 },
    motes: { ...MOTES, driftX: 0.008, driftY: -0.006 },
});

/** 从左上的窗斜射进来的宽光（窗光的公共形状）。 */
const windowBeam = (overrides = {}) => shaft({
    x: 0.1, y: 0.06, angle: 0.62, spread: 0.1, width: 0.34, length: 1.3, softness: 0.35,
    intensity: 1, streaks: 0.25, streakFreq: 4, core: 0.3,
    sway: { amplitude: 0.01, period: 17, phase: 0 },
    ...overrides,
});

const latticeSparks = (region) => ({ aspect, random }) => (
    scatteredSparks({ aspect, count: 14, random, delay: 0.3, region: region ?? [0.3, 0.3, 0.95, 0.9] })
);

/** 百叶（n）：左上的窗透进一道宽斜光，百叶把它切成一条条平行的光带。 */
const latticeBlinds = lattice({
    kind: 'lattice-blinds',
    label: '百叶',
    mood: 'neutral',
    light: rig([windowBeam({ gobo: { pattern: 'blinds', frequency: 13, duty: 0.52, drift: 0.02 } })],
        { driftX: 0.012, driftY: -0.02 }, { ...GLARE, x: 0.1, y: 0.06, radius: 0.16, intensity: 0.8 }),
    lineArt: context => mergeSpecs(
        blindsWindow({ x: context.aspect * 0.03, y: 0.02, w: context.aspect * 0.16, h: 0.26, slats: 9, alpha: 0.5 }),
        latticeSparks()(context),
    ),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 十字窗（q）：右上的十字窗投下四块光斑，中间一道窗棂的影子。 */
const latticeCross = lattice({
    kind: 'lattice-cross',
    label: '十字窗',
    mood: 'quiet',
    light: rig([windowBeam({ x: 0.9, angle: Math.PI - 0.7, width: 0.3, intensity: 0.9, gobo: { pattern: 'cross', frequency: 0, duty: 0.16, drift: 0 } })],
        { driftX: -0.008 }, { ...GLARE, x: 0.9, y: 0.06, radius: 0.14, intensity: 0.7 }),
    lineArt: context => mergeSpecs(
        crossWindow(context.aspect * 0.8, 0.01, context.aspect * 0.16, 0.26),
        latticeSparks([0.05, 0.3, 0.7, 0.9])(context),
    ),
    region: { cx: 0.4, cy: 0.52, w: 0.6, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.7, delay: 1.4 },
});

/** 拱窗（l）：高高的拱窗斜照下一道长长的丁达尔光束。 */
const latticeArch = lattice({
    kind: 'lattice-arch',
    label: '拱窗',
    mood: 'loud',
    light: rig([
        windowBeam({ x: 0.14, y: -0.02, angle: 0.95, width: 0.14, spread: 0.06, length: 1.6, intensity: 1.3, streaks: 0.55, streakFreq: 8, core: 0.6 }),
        windowBeam({ x: 0.14, y: -0.02, angle: 0.95, width: 0.3, spread: 0.2, length: 0.9, softness: 0.9, intensity: 0.3, streaks: 0.8, streakFreq: 22 }),
    ], { density: 1.1 }, { ...GLARE, x: 0.14, y: 0.0, radius: 0.18, intensity: 1.1, streak: 0.6 }),
    lineArt: context => mergeSpecs(
        archWindow(context.aspect * 0.08, -0.06, context.aspect * 0.12, 0.32),
        latticeSparks()(context),
    ),
    typography: 'crossed',
    decay: { strength: 1.2, delay: 0.8 },
    starfall: { ...STARFALL, rain: 90, rainSpread: 0.8 },
});

/** 玫瑰窗（l）：顶上一扇圆花窗，放射出一扇细光束。 */
const latticeRose = lattice({
    kind: 'lattice-rose',
    label: '玫瑰窗',
    mood: 'loud',
    light: rig([-2, -1, 0, 1, 2, 3].map(k => shaft({
        y: 0.08, angle: Math.PI / 2 + (k - 0.5) * 0.2, spread: 0.035, width: 0.03, length: 1, intensity: 0.65 - Math.abs(k - 0.5) * 0.06,
        streaks: 0.4, streakFreq: 5, sway: { amplitude: 0.015, period: 13, phase: k * 0.1 },
    })), {}, { ...GLARE, y: 0.08, radius: 0.16, intensity: 1.1, streak: 0.5 }),
    lineArt: ({ aspect, random }) => mergeSpecs(
        roseWindow(aspect * 0.5, 0.08, 0.12),
        scatteredSparks({ aspect, count: 16, random, delay: 0.3 }),
    ),
    region: { cx: 0.5, cy: 0.6, w: 0.72, h: 0.46 },
    typography: 'horizontal',
    decay: { strength: 1.2, delay: 0.8 },
    starfall: STARFALL,
});

/** 门缝（q）：左边一道门缝，极窄的光横着划过画面。 */
const latticeSlit = lattice({
    kind: 'lattice-slit',
    label: '门缝',
    mood: 'quiet',
    light: rig([shaft({ x: 0.1, y: 0.42, angle: 0.06, spread: 0.02, width: 0.012, length: 2.4, intensity: 1, streaks: 0.3, streakFreq: 3, core: 0.8, sway: { amplitude: 0.01, period: 15, phase: 0 } })],
        { density: 0.8, ambient: 0.015 }, { ...GLARE, x: 0.1, y: 0.42, radius: 0.08, intensity: 0.8, streak: 0.9 }),
    lineArt: ({ aspect, random }) => mergeSpecs(
        doorSlit(aspect * 0.1, 0.08, 0.86, 0.012),
        scatteredSparks({ aspect, count: 10, random, delay: 0.3, region: [0.2, 0.2, 0.95, 0.9] }),
    ),
    region: { cx: 0.55, cy: 0.5, w: 0.6, h: 0.64 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 障子（q）：方格纸窗透进柔和的漫射光，窗格的细影子落在光里。 */
const latticeShoji = lattice({
    kind: 'lattice-shoji',
    label: '障子',
    mood: 'quiet',
    light: rig([windowBeam({ x: 0.12, y: 0.1, angle: 0.4, width: 0.5, spread: 0.18, softness: 0.95, intensity: 0.7, streaks: 0.1, core: 0.2,
        gobo: { pattern: 'blinds', frequency: 10, duty: 0.86, drift: 0 } })], { density: 0.7, tyndallBase: 0.25 }, null),
    lineArt: ({ aspect, random }) => mergeSpecs(
        gridPanel(aspect * 0.02, 0.06, aspect * 0.18, 0.4, 3, 5),
        scatteredSparks({ aspect, count: 10, random, delay: 0.3 }),
    ),
    typography: 'horizontal',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 格栅（n）：菱形格栅的光影在字上流动。 */
const latticeGrille = lattice({
    kind: 'lattice-grille',
    label: '格栅',
    mood: 'neutral',
    light: rig([windowBeam({ width: 0.4, spread: 0.12, intensity: 1, gobo: { pattern: 'lattice', frequency: 9, duty: 0.62, drift: 0.04 } })],
        { driftX: 0.01 }, { ...GLARE, x: 0.1, y: 0.06, radius: 0.14, intensity: 0.7 }),
    lineArt: context => mergeSpecs(
        gridPanel(context.aspect * 0.02, 0.02, context.aspect * 0.16, 0.26, 4, 4, true),
        latticeSparks()(context),
    ),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 扫窗（n）：光源在动，百叶的影子扫过整句。 */
const latticeSweep = lattice({
    kind: 'lattice-sweep',
    label: '扫窗',
    mood: 'neutral',
    light: rig([windowBeam({ angle: 0.75, width: 0.3, intensity: 1, sway: { amplitude: 0.32, period: 10, phase: 0 }, gobo: { pattern: 'blinds', frequency: 11, duty: 0.55, drift: 0.05 } })],
        { driftX: 0.01 }, { ...GLARE, x: 0.1, y: 0.06, radius: 0.14, intensity: 0.7 }),
    lineArt: context => mergeSpecs(
        blindsWindow({ x: context.aspect * 0.03, y: 0.02, w: context.aspect * 0.16, h: 0.26, slats: 8, alpha: 0.45 }),
        latticeSparks()(context),
    ),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
    camera: { push: 0.02, driftX: 0.012, driftY: 0 },
});

/** 叶隙（q）：树叶缝隙里漏下来的斑驳光，随风摇曳。 */
const latticeKomorebi = lattice({
    kind: 'lattice-komorebi',
    label: '叶隙',
    mood: 'quiet',
    light: rig([
        shaft({ x: 0.35, y: -0.05, angle: 1.35, spread: 0.2, width: 0.2, length: 1.3, softness: 0.7, intensity: 1, streaks: 0.2, core: 0.3,
            gobo: { pattern: 'leaves', frequency: 7, duty: 0.52, drift: 0.12 }, sway: { amplitude: 0.03, period: 7, phase: 0 } }),
        shaft({ x: 0.72, y: -0.05, angle: 1.8, spread: 0.14, width: 0.12, length: 1.1, softness: 0.7, intensity: 0.7, streaks: 0.2, core: 0.3,
            gobo: { pattern: 'leaves', frequency: 8, duty: 0.55, drift: 0.1 }, sway: { amplitude: 0.03, period: 8, phase: 0.4 } }),
    ], { density: 0.9, driftX: 0.01 }, null),
    lineArt: ({ aspect, random }) => mergeDiagrams(canopy(aspect, random), scatteredSparks({ aspect, count: 12, random, delay: 0.3 })),
    motes: { ...MOTES, count: 220, driftX: 0.01, driftY: 0.004, swirl: 0.03 },
    region: { cx: 0.5, cy: 0.54, w: 0.72, h: 0.6 },
    typography: 'vertical',
    decay: { strength: 0.8, delay: 1.2 },
});

/** 殿堂（l）：一排高窗照下平行的斜光，层层烟雾。 */
const latticeNave = lattice({
    kind: 'lattice-nave',
    label: '殿堂',
    mood: 'loud',
    light: rig([0.12, 0.34, 0.56, 0.78].map((x, i) => windowBeam({
        x, y: -0.02, angle: 1.1, width: 0.06, spread: 0.05, length: 1.5, softness: 0.5, intensity: 0.75, streaks: 0.5, streakFreq: 6, core: 0.5,
        sway: { amplitude: 0.008, period: 19, phase: i * 0.2 },
    })), { density: 1.2, driftX: 0.006, driftY: -0.03 }, { ...GLARE, x: 0.45, y: 0.0, radius: 0.25, intensity: 0.6, streak: 0.3 }),
    lineArt: ({ aspect, random }) => mergeSpecs(
        tallWindows(aspect * 0.05, aspect * 0.95, -0.08, 0.26, 4),
        scatteredSparks({ aspect, count: 18, random, delay: 0.3 }),
    ),
    typography: 'crossed',
    decay: { strength: 1.2, delay: 0.8 },
    starfall: { ...STARFALL, rain: 80, rainSpread: 1.2 },
});

const LATTICE_PROFILES = [
    latticeBlinds, latticeCross, latticeArch, latticeRose, latticeSlit,
    latticeShoji, latticeGrille, latticeSweep, latticeKomorebi, latticeNave,
];

  /* ---- rigs/motes.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/motes.ts
// 萤尘族：以烟与粒子为主，光很少——浮尘、萤火、烟缕、飞烬、光雪、散景、晨雾、光群、化尘、极光。
// 也是间奏镜头的主力。排版 4 横 / 3 竖 / 3 纵横。
const motesFamily = familyOf('motes', {
    starfall: { ...STARFALL, rain: 30 },
    lineArt: ({ aspect, random }) => scatteredSparks({ aspect, count: 10, random, delay: 0.3 }),
});

const particles = (overrides) => ({ ...MOTES, ...overrides });

/** 浮尘（q）：暗室里一束斜光，光里的尘埃缓缓旋转。 */
const motesDust = motesFamily({
    kind: 'motes-dust',
    label: '浮尘',
    mood: 'quiet',
    light: rig([shaft({ x: 0.15, y: -0.05, angle: 1.05, spread: 0.1, width: 0.1, length: 1.5, intensity: 0.8, streaks: 0.4 })], { density: 0.8, ambient: 0.015 }, null),
    motes: particles({ count: 420, sizeMin: 0.003, sizeMax: 0.012, driftX: 0.002, driftY: -0.004, swirl: 0.035, swirlPeriod: 14, gain: 1.6 }),
    typography: 'horizontal',
    decay: { strength: 0.7, delay: 1.4 },
});

/** 萤火（q）：没有光束，只有散落的萤光点，自己亮着、忽明忽暗。 */
const motesFirefly = motesFamily({
    kind: 'motes-firefly',
    label: '萤火',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.05, intensity: 0.15 })], { density: 0.6, ambient: 0.02 }, null),
    motes: particles({ count: 90, sizeMin: 0.008, sizeMax: 0.022, driftX: 0.003, driftY: -0.003, swirl: 0.06, swirlPeriod: 11, twinkle: 0.9, ambient: 0.55, gain: 0.8 }),
    front: { ...FRONT, count: 14, ambient: 0.12, twinkle: 0.7 },
    region: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 烟缕（n）：一缕缕上升的烟，被侧光勾出轮廓。 */
const motesSmoke = motesFamily({
    kind: 'motes-smoke',
    label: '烟缕',
    mood: 'neutral',
    light: rig([shaft({ x: -0.05, y: 0.55, angle: -0.08, spread: 0.18, width: 0.3, length: 1.6, softness: 0.7, intensity: 0.42, streaks: 0.2, core: 0.3, sway: undefined })],
        { density: 1.5, tyndallBase: 0.05, scale: 1.8, warp: 1.8, driftX: 0.004, driftY: -0.06, ambient: 0.05 }, null),
    motes: particles({ count: 140 }),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 飞烬（l）：暖红的光从下面烧上来，火星往上飘。 */
const motesEmbers = motesFamily({
    kind: 'motes-embers',
    label: '飞烬',
    mood: 'loud',
    light: rig([shaft({ x: 0.5, y: 1.05, angle: -Math.PI / 2, spread: 0.35, width: 0.3, length: 0.6, softness: 0.9, intensity: 0.8, streaks: 0.6, streakFreq: 8, core: 0.3,
        tint: [1, 0.55, 0.3], pulse: { amplitude: 0.2, period: 1.3, phase: 0 }, sway: undefined })], { density: 1.1, driftY: -0.05 }, null),
    motes: particles({ count: 380, sizeMin: 0.003, sizeMax: 0.01, driftX: 0.004, driftY: -0.07, swirl: 0.03, swirlPeriod: 5, twinkle: 0.8, ambient: 0.1, gain: 1.8 }),
    region: { cx: 0.5, cy: 0.44, w: 0.72, h: 0.46 },
    typography: 'horizontal',
    decay: { strength: 1.4, delay: 0.6 },
});

/** 光雪（q）：光点像雪一样缓缓落下。 */
const motesSnow = motesFamily({
    kind: 'motes-snow',
    label: '光雪',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.2, width: 0.2, softness: 0.9, intensity: 0.5, core: 0.3 })], { density: 0.8, driftY: 0.01 }, null),
    motes: particles({ count: 460, sizeMin: 0.003, sizeMax: 0.012, driftX: 0.003, driftY: 0.035, swirl: 0.02, swirlPeriod: 8, twinkle: 0.3, ambient: 0.15, gain: 1 }),
    region: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
    starfall: { ...STARFALL, rain: 60, rainSpeed: 0.12, rainSpread: 1.8, brightness: 0.7 },
});

/** 散景（n）：前景一片片大光斑虚化，焦点在字上。 */
const motesBokeh = motesFamily({
    kind: 'motes-bokeh',
    label: '散景',
    mood: 'neutral',
    light: rig([shaft({ intensity: 0.6 })], { density: 0.8 }, null),
    motes: particles({ count: 120 }),
    front: { ...FRONT, count: 34, sizeMin: 0.06, sizeMax: 0.2, ambient: 0.1, gain: 0.5, twinkle: 0.3, driftX: 0.008 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 晨雾（q）：低伏的雾层，光从雾后面透出来。 */
const motesMist = motesFamily({
    kind: 'motes-mist',
    label: '晨雾',
    mood: 'quiet',
    // 雾后的光：光束与眩光都压低，眩光不拉横丝（原来亮得发白，一条横线贯穿画面）。
    light: rig([shaft({ x: 0.7, y: 0.62, angle: -2.8, spread: 0.5, width: 0.3, length: 1.2, softness: 1, intensity: 0.55, streaks: 0.3, core: 0.2, sway: undefined })],
        { density: 1.5, tyndallBase: 0.1, scale: 1.2, warp: 0.6, driftX: 0.02, driftY: 0, ambient: 0.05 }, { x: 0.7, y: 0.62, radius: 0.16, intensity: 0.5, streak: 0.08 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(horizon(aspect, 0.64), scatteredSparks({ aspect, count: 8, random, delay: 0.3, region: [0.05, 0.05, 0.95, 0.55] })),
    motes: particles({ count: 120, driftX: 0.01 }),
    region: { cx: 0.36, cy: 0.42, w: 0.44, h: 0.5 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 光群（l）：粒子成群地绕着字流动，又散开。 */
const motesSwarm = motesFamily({
    kind: 'motes-swarm',
    label: '光群',
    mood: 'loud',
    light: rig([shaft({ intensity: 0.8 }), shaft({ spread: 0.3, length: 0.6, softness: 0.9, intensity: 0.25, streaks: 0.8, streakFreq: 24 })]),
    motes: particles({ count: 460, sizeMin: 0.003, sizeMax: 0.012, driftX: 0, driftY: 0, swirl: 0.14, swirlPeriod: 6, twinkle: 0.6, ambient: 0.08, gain: 1.6 }),
    typography: 'crossed',
    decay: { strength: 1.3, delay: 0.7 },
});

/** 化尘（n）：字一唱完就碎成光尘飘散（衔接用）。 */
const motesDissolve = motesFamily({
    kind: 'motes-dissolve',
    label: '化尘',
    mood: 'neutral',
    light: rig([shaft({ intensity: 0.7 })]),
    motes: particles({ count: 380, driftY: -0.02, swirl: 0.04, gain: 1.5 }),
    typography: 'crossed',
    decay: { strength: 2.2, delay: 0.3 },
});

/** 极光（l）：画面上方帘子一样流动的光幕。 */
const motesAurora = motesFamily({
    kind: 'motes-aurora',
    label: '极光',
    mood: 'loud',
    light: rig([0.2, 0.4, 0.6, 0.8].map((x, i) => shaft({
        x, y: -0.1, angle: Math.PI / 2 + 0.1, spread: 0.06, width: 0.16, length: 0.7, softness: 0.8, intensity: 0.7, streaks: 0.9, streakFreq: 30, streakSpeed: 0.3,
        core: 0.2, spectrum: 0.5, tint: [0.6, 1, 0.8], sway: { amplitude: 0.12, period: 8 + i * 1.7, phase: i * 0.2 },
    })), { density: 0.9, ambient: 0.03 }, null),
    region: { cx: 0.5, cy: 0.62, w: 0.72, h: 0.4 },
    typography: 'horizontal',
    decay: { strength: 1.2, delay: 0.8 },
    starfall: { ...STARFALL, stars: 560, rain: 20 },
});

const MOTES_PROFILES = [
    motesDust, motesFirefly, motesSmoke, motesEmbers, motesSnow,
    motesBokeh, motesMist, motesSwarm, motesDissolve, motesAurora,
];

  /* ---- rigs/optics.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/optics.ts
// 光路族（光学图解）：光路图里的每一段光线是一条带射程的细光束，线稿画同一条路径与透镜、镜面、焦点。
// 蓝图式，字多排在图解下方。排版 4 横 / 3 竖 / 3 纵横。
const optics = familyOf('optics', {
    region: { cx: 0.5, cy: 0.74, w: 0.72, h: 0.3 },
    heroSize: 0.075,
    motes: { ...MOTES, count: 180 },
});


/** 从 a 到 b（画面比例）的一段光线：细光束，射程正好到 b（b 为 null 时一直延伸）。 */
const ray = (aspect, a, b, overrides = {}, open = false) => {
    const dx = (b[0] - a[0]) * aspect;
    const dy = b[1] - a[1];
    return {
        x: a[0], y: a[1], angle: Math.atan2(dy, dx), spread: 0.004, width: 0.008, length: 3, softness: 0.6,
        intensity: 0.9, streaks: 0.1, streakFreq: 3, streakSpeed: 0.05, core: 0.8,
        ...(open ? {} : { reach: Math.hypot(dx, dy) + 0.02 }),
        ...overrides,
    };
};

/** 同一条路径的线稿（画面比例 → 高度单位）。 */
const rayArt = (aspect, points, delay = 0.2) => rayPath(points.map(([x, y]) => [x * aspect, y]), { delay });

const opticsRig = (beams, glare = null) => ({
    beams,
    fog: { ...FOG, density: 0.9, tyndallBase: 0.2, ambient: 0.02 },
    glare,
});

const opticsSparks = ({ aspect, random }) => scatteredSparks({ aspect, count: 10, random, delay: 0.3, region: [0.05, 0.05, 0.95, 0.6] });

const AXIS = 0.4;

/** 会聚（n）：平行光经凸透镜会聚到焦点。 */
const opticsConvex = optics({
    kind: 'optics-convex',
    label: '会聚',
    mood: 'neutral',
    light: ({ aspect }) => opticsRig([0.3, 0.4, 0.5].flatMap(y => [
        ray(aspect, [-0.02, y], [0.42, y]),
        ray(aspect, [0.42, y], [0.7, AXIS], {}, true),
    ]), { x: 0.7, y: AXIS, radius: 0.05, intensity: 0.9, streak: 0.6 }),
    lineArt: context => mergeDiagrams(
        lens(context.aspect * 0.42, AXIS, 0.3, true, context.aspect),
        ...[0.3, 0.4, 0.5].map((y, i) => rayArt(context.aspect, [[0.02, y], [0.42, y], [0.7, AXIS], [0.92, AXIS + (AXIS - y) * 0.8]], 0.2 + i * 0.08)),
        focusMark(context.aspect * 0.7, AXIS, { delay: 0.5 }),
        opticsSparks(context),
    ),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 发散（q）：凹透镜把平行光打散，虚焦点在透镜前面（虚线）。 */
const opticsConcave = optics({
    kind: 'optics-concave',
    label: '发散',
    mood: 'quiet',
    light: ({ aspect }) => opticsRig([0.32, 0.4, 0.48].flatMap(y => [
        ray(aspect, [-0.02, y], [0.42, y], { intensity: 0.7 }),
        ray(aspect, [0.42, y], [0.42 + (0.42 - 0.26), y + (y - AXIS) * 1.6], { intensity: 0.7, spread: 0.01 }, true),
    ])),
    lineArt: context => mergeDiagrams(
        lens(context.aspect * 0.42, AXIS, 0.28, false, context.aspect),
        ...[0.32, 0.48].map((y, i) => mergeDiagrams(
            rayArt(context.aspect, [[0.02, y], [0.42, y], [0.62, y + (y - AXIS) * 2.2]], 0.2 + i * 0.1),
            { paths: [segment([context.aspect * 0.42, y], [context.aspect * 0.26, AXIS], { width: 0.0009, alpha: 0.35, delay: 0.5, dash: [0.005, 0.006] })], nodes: [] },
        )),
        focusMark(context.aspect * 0.26, AXIS, { delay: 0.6 }),
        opticsSparks(context),
    ),
    region: { cx: 0.72, cy: 0.56, w: 0.4, h: 0.72 },
    typography: 'vertical',
    decay: { strength: 0.7, delay: 1.4 },
});

/** 反射（q）：光线打在平面镜上，入射角等于反射角，法线与角标。 */
const opticsMirror = optics({
    kind: 'optics-mirror',
    label: '反射',
    mood: 'quiet',
    light: ({ aspect }) => opticsRig([
        ray(aspect, [0.12, 0.08], [0.5, 0.6], { width: 0.02, intensity: 1 }),
        ray(aspect, [0.5, 0.6], [0.88, 0.08], { width: 0.02, intensity: 0.8 }, true),
    ], { x: 0.5, y: 0.6, radius: 0.05, intensity: 0.8, streak: 0.7 }),
    lineArt: context => mergeDiagrams(
        mirror(context.aspect * 0.5, 0.6, 0.6, 0),
        rayArt(context.aspect, [[0.12, 0.08], [0.5, 0.6], [0.88, 0.08]]),
        opticsSparks(context),
    ),
    region: { cx: 0.5, cy: 0.34, w: 0.5, h: 0.36 },
    heroSize: 0.07,
    typography: 'crossed',
    decay: { strength: 0.7, delay: 1.4 },
});

/** 折射（n）：光线穿过介质界面向法线偏折。 */
const opticsRefract = optics({
    kind: 'optics-refract',
    label: '折射',
    mood: 'neutral',
    light: ({ aspect }) => opticsRig([
        ray(aspect, [0.18, 0.05], [0.46, 0.5], { width: 0.02, intensity: 1 }),
        ray(aspect, [0.46, 0.5], [0.58, 1.05], { width: 0.02, intensity: 0.8 }, true),
        ray(aspect, [0.46, 0.5], [0.74, 0.05], { width: 0.01, intensity: 0.3 }, true),
    ], { x: 0.46, y: 0.5, radius: 0.05, intensity: 0.8, streak: 0.8 }),
    lineArt: context => mergeDiagrams(
        interfaceLine(context.aspect, 0.5),
        rayArt(context.aspect, [[0.18, 0.05], [0.46, 0.5], [0.58, 0.98]]),
        { paths: [segment([context.aspect * 0.46, 0.18], [context.aspect * 0.46, 0.82], { width: 0.0009, alpha: 0.35, delay: 0.4, dash: [0.006, 0.006] })], nodes: [] },
        opticsSparks(context),
    ),
    region: { cx: 0.72, cy: 0.3, w: 0.44, h: 0.3 },
    heroSize: 0.07,
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 光具座（n）：横向光学台上一串透镜与刻度尺，一束光依次穿过。 */
const opticsBench = optics({
    kind: 'optics-bench',
    label: '光具座',
    mood: 'neutral',
    light: ({ aspect }) => opticsRig([
        ray(aspect, [-0.02, AXIS], [0.3, AXIS], { width: 0.05, spread: 0.01, intensity: 0.8 }),
        { ...ray(aspect, [0.3, AXIS], [0.5, AXIS], { width: 0.05, intensity: 0.9 }), spread: -0.06 },
        { ...ray(aspect, [0.5, AXIS], [0.7, AXIS], { width: 0.02, intensity: 0.9 }), spread: 0.06 },
        ray(aspect, [0.7, AXIS], [1.02, AXIS], { width: 0.05, intensity: 0.7 }, true),
    ], { x: 0.5, y: AXIS, radius: 0.04, intensity: 0.7, streak: 0.6 }),
    lineArt: context => mergeDiagrams(
        ...[0.3, 0.5, 0.7].map((x, i) => lens(context.aspect * x, AXIS, 0.16 + (i % 2) * 0.04, i !== 1, context.aspect, { delay: i * 0.1 })),
        ruler(context.aspect * 0.06, context.aspect * 0.94, 0.58, 40, { delay: 0.3 }),
        opticsSparks(context),
    ),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 潜望（n）：光线在两面镜之间折返，从上面拐到下面。 */
const opticsPeriscope = optics({
    kind: 'optics-periscope',
    label: '潜望',
    mood: 'neutral',
    light: ({ aspect }) => opticsRig([
        ray(aspect, [1.02, 0.14], [0.3, 0.14], { width: 0.02 }),
        ray(aspect, [0.3, 0.14], [0.3, 0.84], { width: 0.02 }),
        ray(aspect, [0.3, 0.84], [1.02, 0.84], { width: 0.02, intensity: 0.8 }, true),
    ], { x: 0.3, y: 0.14, radius: 0.04, intensity: 0.7, streak: 0.4 }),
    lineArt: context => mergeDiagrams(
        mirror(context.aspect * 0.3, 0.14, 0.14, Math.PI / 4),
        mirror(context.aspect * 0.3, 0.84, 0.14, Math.PI / 4, { delay: 0.1 }),
        rayArt(context.aspect, [[0.98, 0.14], [0.3, 0.14], [0.3, 0.84], [0.98, 0.84]]),
        opticsSparks(context),
    ),
    region: { cx: 0.62, cy: 0.49, w: 0.4, h: 0.5 },
    typography: 'vertical',
    decay: { strength: 0.8, delay: 1.2 },
});

/** 光纤（l）：光在一条弯曲的光纤里全反射前进，从另一头喷出一锥光。 */
const opticsFiber = optics({
    kind: 'optics-fiber',
    label: '光纤',
    mood: 'loud',
    light: () => opticsRig([
        { x: 0.84, y: 0.2, angle: -0.5, spread: 0.3, width: 0.02, length: 0.9, softness: 0.6, intensity: 1.2, streaks: 0.5, streakFreq: 9, streakSpeed: 0.1, core: 0.6,
            pulse: { amplitude: 0.2, period: 2.3, phase: 0 } },
        { x: 0.84, y: 0.2, angle: -0.5, spread: 0.08, width: 0.02, length: 1.2, softness: 0.5, intensity: 0.9, streaks: 0.2, streakFreq: 3, streakSpeed: 0, core: 0.8 },
    ], { x: 0.84, y: 0.2, radius: 0.07, intensity: 1.2, streak: 0.8 }),
    lineArt: context => mergeDiagrams(
        fiber([[context.aspect * 0.04, 0.86], [context.aspect * 0.4, 0.95], [context.aspect * 0.5, 0.1], [context.aspect * 0.84, 0.2]], 0.012),
        opticsSparks(context),
    ),
    region: { cx: 0.46, cy: 0.52, w: 0.6, h: 0.5 },
    typography: 'crossed',
    burst: { mode: 'sung', density: 0.3, every: 2, offset: 0, size: 3.2, tint: [0.8, 0.9, 1] },
    decay: { strength: 1.3, delay: 0.7 },
    starfall: { stars: 380, opening: 3, rain: 60, rainSpeed: 0.3, rainSpread: 0.8, brightness: 1 },
});

/** 暗箱（q）：一道光经小孔穿进暗箱（过孔会聚再散开），背面是倒立的像。 */
const opticsPinhole = optics({
    kind: 'optics-pinhole',
    label: '暗箱',
    mood: 'quiet',
    light: ({ aspect }) => {
        const distance = (0.45 + 0.02) * aspect;
        return opticsRig([
            { x: -0.02, y: AXIS, angle: 0, spread: -Math.atan(0.15 / distance), width: 0.3, length: 3, softness: 0.4, intensity: 0.8, streaks: 0.3, streakFreq: 6, streakSpeed: 0.05, core: 0.3, reach: distance + 0.3 },
        ], { x: 0.45, y: AXIS, radius: 0.03, intensity: 1, streak: 0.3 });
    },
    lineArt: context => mergeDiagrams(pinholeBox(context.aspect * 0.45 + 0.15, AXIS, 0.3, 0.3), opticsSparks(context)),
    region: { cx: 0.2, cy: 0.52, w: 0.3, h: 0.7 },
    heroSize: 0.07,
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 望远（l）：物镜把平行光聚到焦点，目镜再把它变成更细的平行光。 */
const opticsTelescope = optics({
    kind: 'optics-telescope',
    label: '望远',
    mood: 'loud',
    light: ({ aspect }) => opticsRig([0.3, 0.5].flatMap(y => [
        ray(aspect, [-0.02, y], [0.28, y], { width: 0.02 }),
        ray(aspect, [0.28, y], [0.62, AXIS]),
        ray(aspect, [0.72, AXIS + (y - AXIS) * 0.3], [1.02, AXIS + (y - AXIS) * 0.3], { width: 0.02, intensity: 1.1 }, true),
    ]), { x: 0.62, y: AXIS, radius: 0.05, intensity: 1, streak: 0.8 }),
    lineArt: context => mergeDiagrams(
        lens(context.aspect * 0.28, AXIS, 0.36, true, context.aspect),
        lens(context.aspect * 0.72, AXIS, 0.12, true, context.aspect, { delay: 0.1 }),
        ...[0.3, 0.5].map((y, i) => rayArt(context.aspect, [[0.02, y], [0.28, y], [0.62, AXIS], [0.72, AXIS - (y - AXIS) * 0.3], [0.98, AXIS - (y - AXIS) * 0.3]], 0.2 + i * 0.1)),
        focusMark(context.aspect * 0.62, AXIS, { delay: 0.5 }),
        opticsSparks(context),
    ),
    typography: 'horizontal',
    burst: { mode: 'sung', density: 0.25, every: 2, offset: 1, size: 3.2, tint: [1, 0.8, 0.55] },
    decay: { strength: 1.2, delay: 0.8 },
});

/** 追迹（l）：几条光线在画面里反复折射，织成一张网。 */
const opticsRaytrace = optics({
    kind: 'optics-raytrace',
    label: '追迹',
    mood: 'loud',
    light: ({ aspect, random }) => {
        const points = Array.from({ length: 7 }, (_, i) => [0.05 + (i / 6) * 0.9, 0.1 + random() * 0.55]);
        return opticsRig(points.slice(0, 6).map((point, i) => ray(aspect, point, points[i + 1], { intensity: 0.8, width: 0.012 })),
            { x: points[0][0], y: points[0][1], radius: 0.05, intensity: 0.9, streak: 0.6 });
    },
    lineArt: ({ aspect, random }) => {
        const art = [];
        for (let k = 0; k < 4; k += 1) {
            const points = Array.from({ length: 6 }, (_, i) => [0.05 + (i / 5) * 0.9, 0.08 + random() * 0.6]);
            art.push(rayArt(aspect, points, 0.1 + k * 0.1));
        }
        return mergeDiagrams(...art, scatteredSparks({ aspect, count: 16, random, delay: 0.3 }));
    },
    typography: 'crossed',
    decay: { strength: 1.3, delay: 0.7 },
});

const OPTICS_PROFILES = [
    opticsConvex, opticsConcave, opticsMirror, opticsRefract, opticsBench,
    opticsPeriscope, opticsFiber, opticsPinhole, opticsTelescope, opticsRaytrace,
];

  /* ---- rigs/prism.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/prism.ts
// 棱镜族（色散）：白光经棱镜、晶片、水滴分成光谱。光谱色由色散模块按截面位置给出，饱和度受控。
// 排版 4 横 / 3 竖 / 3 纵横。
const prism = familyOf('prism', { starfall: { ...STARFALL, rain: 50 } });

const prismSparks = ({ aspect, random }) => scatteredSparks({ aspect, count: 16, random, delay: 0.3 });

/** 一道光谱色的细光束（谱线、合光用）。 */
const tinted = (tint, overrides) => shaft({
    spread: 0.012, width: 0.012, length: 1.4, intensity: 0.7, streaks: 0.2, streakFreq: 3, core: 0.7, sway: undefined, tint, ...overrides,
});

/** 分光（l）：一束白光从左边射进三棱镜，出射成一扇光谱，字落在光谱上。 */
const prismSplit = prism({
    kind: 'prism-split',
    label: '分光',
    mood: 'loud',
    light: rig([
        shaft({ x: -0.02, y: 0.36, angle: 0.08, spread: 0.01, width: 0.02, length: 3, intensity: 0.9, streaks: 0.2, sway: undefined, reach: 0.78 }),
        shaft({
            x: 0.42, y: 0.4, angle: 0.3, spread: 0.2, width: 0.02, length: 1.1, softness: 0.4,
            intensity: 1.1, streaks: 0.35, streakFreq: 9, core: 0.2, spectrum: 1,
            sway: { amplitude: 0.03, period: 11, phase: 0 },
        }),
    ], { density: 0.9 }, { ...GLARE, x: 0.42, y: 0.4, radius: 0.06, intensity: 1, streak: 0.3 }),
    lineArt: context => mergeSpecs(prismTriangle({ cx: context.aspect * 0.42, cy: 0.42, size: 0.2, alpha: 0.8 }), prismSparks(context)),
    region: { cx: 0.62, cy: 0.66, w: 0.6, h: 0.44 },
    typography: 'horizontal',
    burst: { mode: 'sung', density: 0.3, every: 2, offset: 1, size: 3.4, tint: [0.8, 0.9, 1] },
    decay: { strength: 1.2, delay: 0.8 },
});

/** 光谱带（n）：一条横贯画面的连续光谱带，字在带上。 */
const prismBand = prism({
    kind: 'prism-band',
    label: '光谱带',
    mood: 'neutral',
    light: rig([shaft({ x: -0.05, y: 0.4, angle: 0.12, spread: 0.05, width: 0.16, length: 2.5, softness: 0.4, intensity: 0.9, streaks: 0.25, streakFreq: 6, core: 0.3, spectrum: 1,
        sway: { amplitude: 0.02, period: 14, phase: 0 } })], { density: 0.8 }, null),
    region: { cx: 0.5, cy: 0.56, w: 0.72, h: 0.46 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 虹边（q）：顶光的边缘带一点点色散彩边。 */
const prismFringe = prism({
    kind: 'prism-fringe',
    label: '虹边',
    mood: 'quiet',
    light: rig([
        shaft({ spread: 0.1, softness: 0.3, spectrum: 0.35, intensity: 0.9 }),
        shaft({ spread: 0.3, length: 0.6, softness: 0.9, intensity: 0.25, streaks: 0.8, streakFreq: 24, core: 0.4, spectrum: 0.5 }),
    ]),
    lineArt: context => standardArt(context),
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.7, delay: 1.4 },
});

/** 碎晶（l）：散落的晶片各自折射出一小束光谱。 */
const prismShard = prism({
    kind: 'prism-shard',
    label: '碎晶',
    mood: 'loud',
    light: ({ random }) => ({
        beams: Array.from({ length: 5 }, (_, i) => shaft({
            x: 0.15 + random() * 0.7, y: 0.15 + random() * 0.5, angle: random() * Math.PI * 2, spread: 0.12, width: 0.01, length: 0.5,
            softness: 0.5, intensity: 0.8, streaks: 0.3, streakFreq: 6, core: 0.3, spectrum: 1, reach: 0.5 + random() * 0.3,
            sway: { amplitude: 0.1, period: 9 + i, phase: random() },
        })),
        fog: { density: 0.9, tyndallBase: 0.12, scale: 2.4, driftX: 0.008, driftY: -0.03, warp: 0.9, ambient: 0.03 },
        glare: null,
    }),
    lineArt: ({ aspect, random }) => mergeDiagrams(shards(aspect, random, 8), scatteredSparks({ aspect, count: 18, random, delay: 0.3 })),
    typography: 'crossed',
    burst: { mode: 'sweep', density: 0.4, every: 3, offset: 0, size: 3, tint: [0.85, 0.9, 1] },
    decay: { strength: 1.3, delay: 0.7 },
});

/** 谱线（q）：暗场里一排竖直的发射谱线，字像是谱线的标注。 */
const prismLines = prism({
    kind: 'prism-lines',
    label: '谱线',
    mood: 'quiet',
    light: rig([
        tinted([1, 0.35, 0.3], { x: 0.22, y: -0.05, angle: Math.PI / 2 }),
        tinted([1, 0.8, 0.3], { x: 0.36, y: -0.05, angle: Math.PI / 2, intensity: 0.5 }),
        tinted([0.5, 1, 0.5], { x: 0.47, y: -0.05, angle: Math.PI / 2, intensity: 0.8 }),
        tinted([0.4, 0.8, 1], { x: 0.61, y: -0.05, angle: Math.PI / 2, intensity: 0.6 }),
        tinted([0.6, 0.45, 1], { x: 0.78, y: -0.05, angle: Math.PI / 2, intensity: 0.45 }),
    ], { density: 0.7, ambient: 0.015 }, null),
    lineArt: ({ aspect, random }) => mergeDiagrams(spectrumLines(aspect * 0.12, aspect * 0.88, 0.84, 0.16, random, 18), scatteredSparks({ aspect, count: 10, random, delay: 0.3 })),
    region: { cx: 0.5, cy: 0.48, w: 0.72, h: 0.6 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 合光（n）：红绿蓝三束光汇到一点，合成一束白光往前走。 */
const prismMerge = prism({
    kind: 'prism-merge',
    label: '合光',
    mood: 'neutral',
    light: rig([
        tinted([1, 0.35, 0.3], { x: -0.02, y: 0.18, angle: 0.47, reach: 0.72, intensity: 0.8 }),
        tinted([0.45, 1, 0.45], { x: -0.02, y: 0.4, angle: 0.1, reach: 0.62, intensity: 0.8 }),
        tinted([0.4, 0.6, 1], { x: -0.02, y: 0.66, angle: -0.29, reach: 0.68, intensity: 0.8 }),
        shaft({ x: 0.36, y: 0.46, angle: 0.02, spread: 0.02, width: 0.02, length: 2, intensity: 1.1, streaks: 0.2, streakFreq: 3, core: 0.7, sway: undefined }),
    ], { density: 0.9 }, { ...GLARE, x: 0.36, y: 0.46, radius: 0.06, intensity: 1.1, streak: 0.5 }),
    lineArt: context => mergeSpecs(prismTriangle({ cx: context.aspect * 0.34, cy: 0.46, size: 0.12, alpha: 0.6 }), prismSparks(context)),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 分束（n）：一束光进入立方分光镜，一路直行、一路向下。 */
const prismCube = prism({
    kind: 'prism-cube',
    label: '分束',
    mood: 'neutral',
    // 射程按高度单位算，光源 x 是画面宽度的比例：入射光要走到分光镜中心，得乘画幅比。
    light: ({ aspect }) => rig([
        shaft({ x: -0.02, y: 0.34, angle: 0, spread: 0.01, width: 0.03, length: 3, intensity: 0.9, streaks: 0.2, sway: undefined, reach: (0.42 + 0.02) * aspect }),
        shaft({ x: 0.42, y: 0.34, angle: 0, spread: 0.01, width: 0.03, length: 3, intensity: 0.7, streaks: 0.2, sway: undefined, spectrum: 0.3 }),
        shaft({ x: 0.42, y: 0.34, angle: Math.PI / 2, spread: 0.01, width: 0.03, length: 3, intensity: 0.6, streaks: 0.2, sway: undefined, spectrum: 0.3 }),
    ], { density: 0.9 }, { ...GLARE, x: 0.42, y: 0.34, radius: 0.05, intensity: 0.9, streak: 0.4 })(),
    lineArt: context => mergeDiagrams(cubeSplitter(context.aspect * 0.42, 0.34, 0.08), scatteredSparks({ aspect: context.aspect, count: 12, random: context.random, delay: 0.3 })),
    region: { cx: 0.6, cy: 0.62, w: 0.6, h: 0.44 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 虹扇（l）：色散光扇绕光源缓慢转动。 */
const prismWheel = prism({
    kind: 'prism-wheel',
    label: '虹扇',
    mood: 'loud',
    light: rig([0, 1, 2].map(k => shaft({
        x: 0.5, y: 0.08, angle: Math.PI / 2 + (k - 1) * 0.7, spread: 0.18, width: 0.01, length: 1.1, softness: 0.4, intensity: 0.8,
        streaks: 0.3, streakFreq: 8, core: 0.2, spectrum: 1, sway: { amplitude: 0.5, period: 16, phase: k / 3 },
    })), { density: 0.9 }, { ...GLARE, y: 0.08, radius: 0.1, intensity: 1.1, streak: 0.4 }),
    lineArt: context => mergeSpecs(prismTriangle({ cx: context.aspect * 0.5, cy: 0.1, size: 0.1, alpha: 0.6 }), prismSparks(context)),
    typography: 'crossed',
    decay: { strength: 1.2, delay: 0.8 },
});

/** 虹霓（q）：雨后的光，一道淡淡的虹与霓。 */
const prismDroplet = prism({
    kind: 'prism-droplet',
    label: '虹霓',
    mood: 'quiet',
    light: rig([shaft({ x: 0.5, y: 1.2, angle: -Math.PI / 2, spread: 0.55, width: 0.1, length: 1.1, softness: 0.25, intensity: 0.55, streaks: 0.1, core: 0, spectrum: 1, sway: undefined })],
        { density: 0.7, driftY: 0.02 }, null),
    lineArt: ({ aspect, random }) => mergeDiagrams(rainbowArcs(aspect * 0.5, 1.02, 0.62), scatteredSparks({ aspect, count: 12, random, delay: 0.3 })),
    starfall: { ...STARFALL, rain: 160, rainSpeed: 0.5, rainSpread: 1.6, brightness: 0.8 },
    region: { cx: 0.5, cy: 0.46, w: 0.72, h: 0.6 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 扫谱（n）：光谱带像扫描一样沿字行扫过。 */
const prismSweep = prism({
    kind: 'prism-sweep',
    label: '扫谱',
    mood: 'neutral',
    light: rig([shaft({ x: 0.5, y: -0.1, angle: Math.PI / 2, spread: 0.08, width: 0.1, length: 1.4, softness: 0.4, intensity: 0.95, streaks: 0.2, core: 0.3, spectrum: 1,
        sway: { amplitude: 0.35, period: 8, phase: 0 } })], { density: 0.9 }, { ...GLARE, y: -0.05, intensity: 0.6 }),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

const PRISM_PROFILES = [
    prismSplit, prismBand, prismFringe, prismShard, prismLines,
    prismMerge, prismCube, prismWheel, prismDroplet, prismSweep,
];

  /* ---- rigs/stage.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/stage.ts
// 追光族（舞台）：聚光灯、探照、脚光、逆光、频闪、激光、放映机。烟机的烟更浓，光源处画灯头。
// 排版 4 横 / 3 竖 / 3 纵横。
const stage = familyOf('stage', {
    motes: { ...MOTES, count: 200 },
});

const HAZE = { ...FOG, density: 1.25, tyndallBase: 0.08, scale: 2, driftX: 0.01, driftY: -0.015, warp: 1.1, ambient: 0.035 };


/** 从 a 指向 b（画面比例）的一盏灯。 */
const lamp = (aspect, a, b, overrides = {}) => shaft({
    x: a[0], y: a[1], angle: Math.atan2(b[1] - a[1], (b[0] - a[0]) * aspect), spread: 0.08, width: 0.03, length: 1.3, softness: 0.55,
    intensity: 1, streaks: 0.4, streakFreq: 6, core: 0.6, sway: undefined,
    ...overrides,
});

const stageRig = (beams, glare = null, fog = {}) => ({ beams, fog: { ...HAZE, ...fog }, glare });

/** 每盏灯的灯头线稿 + 闪点。 */
const lampsArt = (context, beams) => mergeDiagrams(
    ...beams.map((beam, i) => lampHead(beam.x * context.aspect, beam.y, beam.angle, 0.035, { delay: i * 0.05 })),
    scatteredSparks({ aspect: context.aspect, count: 10, random: context.random, delay: 0.3 }),
);

const withLamps = (build) => ({
    light: build,
    lineArt: (context) => lampsArt(context, build(context).beams),
});

const CENTER = [0.5, 0.56];

/** 独光（n）：一束追光从左上斜打在字上。 */
const stageSpot = stage({
    kind: 'stage-spot',
    label: '独光',
    mood: 'neutral',
    ...withLamps(({ aspect }) => stageRig([lamp(aspect, [0.14, 0.02], CENTER, { sway: { amplitude: 0.02, period: 12, phase: 0 } })], { x: 0.14, y: 0.02, radius: 0.08, intensity: 0.9, streak: 0.5 })),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 交叉（l）：两束光从上方两角打下，交点正是字。 */
const stageCross = stage({
    kind: 'stage-cross',
    label: '交叉',
    mood: 'loud',
    ...withLamps(({ aspect }) => stageRig([
        lamp(aspect, [0.06, 0.02], CENTER, { sway: { amplitude: 0.03, period: 9, phase: 0 } }),
        lamp(aspect, [0.94, 0.02], CENTER, { sway: { amplitude: 0.03, period: 9, phase: 0.5 } }),
    ], { x: 0.5, y: 0.56, radius: 0.06, intensity: 0.6, streak: 0.6 })),
    typography: 'crossed',
    burst: { mode: 'sung', density: 0.3, every: 2, offset: 1, size: 3.4, tint: [1, 0.75, 0.5] },
    decay: { strength: 1.3, delay: 0.7 },
});

/** 探照（l）：底下几盏探照灯在烟里来回扫。 */
const stageSearch = stage({
    kind: 'stage-search',
    label: '探照',
    mood: 'loud',
    ...withLamps(() => stageRig([0.15, 0.38, 0.62, 0.85].map((x, i) => shaft({
        x, y: 1.02, angle: -Math.PI / 2, spread: 0.035, width: 0.03, length: 1.4, softness: 0.5, intensity: 0.8, streaks: 0.3, streakFreq: 5, core: 0.6,
        sway: { amplitude: 0.45, period: 7 + i * 1.3, phase: i * 0.27 },
    })))),
    region: { cx: 0.5, cy: 0.44, w: 0.72, h: 0.46 },
    typography: 'horizontal',
    decay: { strength: 1.3, delay: 0.7 },
});

/** 脚光（q）：台口的一排暖光自下而上。 */
const stageFootlight = stage({
    kind: 'stage-footlight',
    label: '脚光',
    mood: 'quiet',
    ...withLamps(() => stageRig([0.25, 0.5, 0.75].map(x => shaft({
        x, y: 1.03, angle: -Math.PI / 2, spread: 0.22, width: 0.08, length: 0.7, softness: 0.9, intensity: 0.6, streaks: 0.4, streakFreq: 10, core: 0.3,
        tint: [1, 0.8, 0.6], sway: undefined,
    })), null, { driftY: -0.03 })),
    region: { cx: 0.5, cy: 0.46, w: 0.5, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 逆光（n）：字后面一团强光，光束从背后往外放射，字像剪影。 */
const stageBacklight = stage({
    kind: 'stage-backlight',
    label: '逆光',
    mood: 'neutral',
    light: () => stageRig(Array.from({ length: 6 }, (_, k) => shaft({
        x: 0.5, y: 0.5, angle: (k / 6) * Math.PI * 2 + 0.5, spread: 0.12, width: 0.02, length: 0.8, softness: 0.7, intensity: 0.6,
        streaks: 0.6, streakFreq: 10, core: 0.4, sway: { amplitude: 0.05, period: 11, phase: k / 6 },
    })), { x: 0.5, y: 0.5, radius: 0.22, intensity: 1.2, streak: 0.8 }),
    lineArt: ({ aspect, random }) => scatteredSparks({ aspect, count: 18, random, delay: 0.3 }),
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.5 },
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 针光（q）：一道极窄的光锥，只照亮字那一小块。 */
const stagePinspot = stage({
    kind: 'stage-pinspot',
    label: '针光',
    mood: 'quiet',
    ...withLamps(({ aspect }) => stageRig([lamp(aspect, [0.5, 0.02], CENTER, { spread: 0.03, width: 0.01, intensity: 0.9, core: 0.9 })], null, { ambient: 0.015 })),
    typography: 'horizontal',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 频闪（l）：几盏灯随节拍一明一灭地频闪。 */
const stageStrobe = stage({
    kind: 'stage-strobe',
    label: '频闪',
    mood: 'loud',
    ...withLamps(({ aspect }) => stageRig([0.1, 0.36, 0.64, 0.9].map((x, i) => lamp(aspect, [x, 0.02], [0.5, 0.6], {
        spread: 0.08, intensity: 0.55, pulse: { amplitude: 0.95, period: 0.5, phase: i * 0.25 },
    })), { x: 0.5, y: 0.02, radius: 0.2, intensity: 0.6, streak: 0.4 })),
    typography: 'crossed',
    burst: { mode: 'sweep', density: 0.5, every: 2, offset: 0, size: 3, tint: [1, 0.9, 0.8] },
    decay: { strength: 1.4, delay: 0.6 },
});

/** 幕缝（q）：帷幕的缝隙里透出一道竖直的光。 */
const stageCurtain = stage({
    kind: 'stage-curtain',
    label: '幕缝',
    mood: 'quiet',
    light: () => stageRig([shaft({ spread: 0.01, width: 0.04, length: 1.6, softness: 0.5, intensity: 0.9, streaks: 0.3, core: 0.7, sway: undefined })],
        { x: 0.5, y: -0.02, radius: 0.08, intensity: 0.8, streak: 0.5 }, { ambient: 0.02 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(curtains(aspect, 0.06), scatteredSparks({ aspect, count: 8, random, delay: 0.3, region: [0.3, 0.2, 0.7, 0.9] })),
    region: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.66 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 激光（l）：台底一扇细锐的激光线，在烟里扫动。 */
const stageLaser = stage({
    kind: 'stage-laser',
    label: '激光',
    mood: 'loud',
    ...withLamps(() => stageRig(Array.from({ length: 6 }, (_, k) => shaft({
        x: 0.5, y: 1.02, angle: -Math.PI / 2 + (k - 2.5) * 0.22, spread: 0.002, width: 0.004, length: 2, softness: 0.3, intensity: 1.2,
        streaks: 0, core: 0.9, sway: { amplitude: 0.25, period: 4.5, phase: k * 0.08 },
    })), { x: 0.5, y: 1.0, radius: 0.06, intensity: 1, streak: 0.6 }, { density: 1.4 })),
    region: { cx: 0.5, cy: 0.4, w: 0.72, h: 0.46 },
    typography: 'horizontal',
    decay: { strength: 1.3, delay: 0.7 },
});

/** 放映（n）：左边一台放映机，光锥里满是浮尘，字像投在光里。 */
const stageProjector = stage({
    kind: 'stage-projector',
    label: '放映',
    mood: 'neutral',
    light: () => stageRig([shaft({ x: 0.12, y: 0.4, angle: 0.05, spread: 0.2, width: 0.02, length: 1.8, softness: 0.4, intensity: 1, streaks: 0.5, streakFreq: 9, core: 0.4, sway: undefined,
        pulse: { amplitude: 0.05, period: 0.12, phase: 0 } })], { x: 0.12, y: 0.4, radius: 0.05, intensity: 1, streak: 0.4 }),
    lineArt: ({ aspect, random }) => mergeDiagrams(projector(aspect * 0.12, 0.4, 0.1), scatteredSparks({ aspect, count: 10, random, delay: 0.3 })),
    motes: { ...MOTES, count: 380, driftX: 0.004, swirl: 0.03, gain: 1.8 },
    region: { cx: 0.62, cy: 0.5, w: 0.44, h: 0.58 },
    typography: 'vertical',
    decay: { strength: 1, delay: 1 },
});

const STAGE_PROFILES = [
    stageSpot, stageCross, stageSearch, stageFootlight, stageBacklight,
    stagePinspot, stageStrobe, stageCurtain, stageLaser, stageProjector,
];

  /* ---- rigs/wave.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/wave.ts
// 衍射族（干涉与衍射）：条纹、光环、莫尔、虹彩。干涉模块在一块区域里发光，窗影与色散做光栅、莫尔、薄膜。
// 排版 4 横 / 3 竖 / 3 纵横。
const wave = familyOf('wave', { starfall: { ...STARFALL, rain: 40 } });

const waveSparks = ({ aspect, random }) => scatteredSparks({ aspect, count: 12, random, delay: 0.3 });
const fringes = (spec) => ({ wave: spec });

/** 双缝（n）：顶光穿过挡板上的两道缝，下方屏上是明暗相间的干涉条纹。 */
const waveSlits = wave({
    kind: 'wave-slits',
    label: '双缝',
    mood: 'neutral',
    light: rig([shaft({ spread: 0.05, width: 0.04, length: 0.6, intensity: 0.9 })], { density: 0.9 }, GLARE,
        fringes({ mode: 'slits', cx: 0.5, cy: 0.72, radius: 0.3, frequency: 5, speed: 0.4, strength: 0.55 })),
    lineArt: context => mergeSpecs(
        slitBarrier({ cx: context.aspect * 0.5, y: 0.3, width: context.aspect * 0.5, gap: 0.012, separation: 0.08 }),
        viewfinderFrame({ aspect: context.aspect, left: 0.2, top: 0.52, right: 0.8, bottom: 0.92, delay: 0.2, alpha: 0.28 }),
        waveSparks(context),
    ),
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.5 },
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 牛顿环（q）：一圈圈明暗相间的同心环，字在环心。 */
const waveNewton = wave({
    kind: 'wave-newton',
    label: '牛顿环',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.06, width: 0.04, length: 0.6, intensity: 0.6 })], { density: 0.7 }, { ...GLARE, intensity: 0.5 },
        fringes({ mode: 'rings', cx: 0.5, cy: 0.5, radius: 0.4, frequency: 5, speed: 0.3, strength: 0.5, shield: 0.75 })),
    lineArt: context => mergeDiagrams(rings(context.aspect * 0.5, 0.5, 0.4, 6), waveSparks(context)),
    region: { cx: 0.5, cy: 0.5, w: 0.4, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 艾里斑（q）：一个点光源的衍射亮斑与一圈圈淡淡的外环。 */
const waveAiry = wave({
    kind: 'wave-airy',
    label: '艾里斑',
    mood: 'quiet',
    light: rig([shaft({ x: 0.5, y: -0.05, spread: 0.02, width: 0.01, length: 0.6, intensity: 0.5, reach: 0.4 })], { density: 0.6 },
        { x: 0.5, y: 0.4, radius: 0.04, intensity: 1, streak: 0.4 },
        fringes({ mode: 'airy', cx: 0.5, cy: 0.4, radius: 0.3, frequency: 3, speed: 0, strength: 0.7 })),
    lineArt: context => mergeDiagrams(rings(context.aspect * 0.5, 0.4, 0.3, 4, { alpha: 0.3 }), waveSparks(context)),
    region: { cx: 0.5, cy: 0.72, w: 0.72, h: 0.36 },
    typography: 'horizontal',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 光栅（n）：一束光打到光栅上，下面分出几级带彩边的衍射光。 */
const waveGrating = wave({
    kind: 'wave-grating',
    label: '光栅',
    mood: 'neutral',
    light: rig([
        shaft({ spread: 0.01, width: 0.03, length: 2, intensity: 0.9, reach: 0.32, sway: undefined }),
        ...[-2, -1, 0, 1, 2].map(k => shaft({
            y: 0.3, angle: Math.PI / 2 + k * 0.32, spread: 0.02, width: 0.02, length: 1.2, intensity: 0.8 - Math.abs(k) * 0.15,
            streaks: 0.2, core: 0.6, spectrum: k === 0 ? 0 : 0.8, sway: undefined,
        })),
    ], { density: 0.9 }, { ...GLARE, y: 0.3, radius: 0.05, intensity: 0.9, streak: 0.6 }),
    lineArt: context => mergeDiagrams(grating(context.aspect * 0.5, 0.3, context.aspect * 0.4, 16), waveSparks(context)),
    region: { cx: 0.5, cy: 0.7, w: 0.72, h: 0.38 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 波叠（l）：两个点源的圆波相互干涉，明暗的双曲线条纹。 */
const waveSources = wave({
    kind: 'wave-sources',
    label: '波叠',
    mood: 'loud',
    light: rig([shaft({ spread: 0.15, intensity: 0.4 })], { density: 0.8 }, { ...GLARE, intensity: 0.5 },
        fringes({ mode: 'sources', cx: 0.5, cy: 0.5, radius: 0.46, frequency: 4, speed: 1.2, strength: 0.6, separation: 0.14 })),
    lineArt: context => mergeDiagrams(twoSources(context.aspect * 0.5, 0.5, 0.14, 0.3), waveSparks(context)),
    typography: 'crossed',
    burst: { mode: 'sung', density: 0.3, every: 2, offset: 0, size: 3.2, tint: [0.85, 0.9, 1] },
    decay: { strength: 1.3, delay: 0.7 },
});

/** 莫尔（n）：两层细光栅错开一点角度，叠出缓慢流动的莫尔光纹。 */
const waveMoire = wave({
    kind: 'wave-moire',
    label: '莫尔',
    mood: 'neutral',
    light: rig([
        shaft({ spread: 0.2, width: 0.3, length: 1.3, softness: 0.6, intensity: 0.6, streaks: 0, core: 0.2, gobo: { pattern: 'blinds', frequency: 22, duty: 0.5, drift: 0.02 }, sway: undefined }),
        shaft({ angle: Math.PI / 2 + 0.06, spread: 0.2, width: 0.3, length: 1.3, softness: 0.6, intensity: 0.6, streaks: 0, core: 0.2, gobo: { pattern: 'blinds', frequency: 23, duty: 0.5, drift: -0.02 }, sway: { amplitude: 0.03, period: 14, phase: 0 } }),
    ], { density: 0.8 }, { ...GLARE, intensity: 0.5 }),
    lineArt: context => mergeDiagrams(moire(context.aspect * 0.5, 0.32, 0.4, 24, 0.08), waveSparks(context)),
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 薄膜（q）：肥皂泡一样流动的虹彩。 */
const waveFilm = wave({
    kind: 'wave-film',
    label: '薄膜',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.4, width: 0.3, length: 1.2, softness: 0.95, intensity: 0.45, streaks: 0.6, streakFreq: 3, streakSpeed: 0.2, core: 0.2, spectrum: 1,
        sway: { amplitude: 0.15, period: 13, phase: 0 } })], { density: 0.7 }, null,
    fringes({ mode: 'rings', cx: 0.5, cy: 0.4, radius: 0.3, frequency: 1.6, speed: 0.6, strength: 0.25 })),
    lineArt: context => mergeDiagrams(
        { paths: [circle(context.aspect * 0.5, 0.4, 0.3, { width: 0.0016, alpha: 0.45 }), circle(context.aspect * 0.5 - 0.08, 0.3, 0.06, { width: 0.001, alpha: 0.3, delay: 0.2 })], nodes: [] },
        waveSparks(context),
    ),
    region: { cx: 0.5, cy: 0.5, w: 0.4, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.6, delay: 1.6 },
});

/** 偏振（n）：两片偏振片一转，透过来的光一明一暗地呼吸。 */
const wavePolar = wave({
    kind: 'wave-polar',
    label: '偏振',
    mood: 'neutral',
    // 第一束穿过第一片、走到第二片；第二束从第二片出发，随偏振片转动一明一暗（按画幅比例定位）。
    light: ({ aspect }) => {
        const second = aspect * 0.5 + 0.12;
        return rig([
            shaft({ x: -0.02, y: 0.36, angle: 0, spread: 0.02, width: 0.14, length: 3, intensity: 0.8, streaks: 0.2, core: 0.4, reach: second + 0.02 * aspect, sway: undefined }),
            shaft({ x: second / aspect, y: 0.36, angle: 0, spread: 0.02, width: 0.14, length: 3, intensity: 0.7, streaks: 0.2, core: 0.4, sway: undefined, pulse: { amplitude: 0.9, period: 6, phase: 0 } }),
        ], { density: 0.8 }, null)();
    },
    lineArt: context => mergeDiagrams(polarizers(context.aspect * 0.5, 0.36, 0.1, 0.24, Math.PI / 3), waveSparks(context)),
    region: { cx: 0.5, cy: 0.7, w: 0.72, h: 0.36 },
    typography: 'horizontal',
    decay: { strength: 1, delay: 1 },
});

/** 驻波（l）：字行上方几条驻波一样的光线，随节拍一起振动。 */
const waveStanding = wave({
    kind: 'wave-standing',
    label: '驻波',
    mood: 'loud',
    light: rig([0.26, 0.34, 0.42].map((y, i) => shaft({
        x: -0.02, y, angle: 0, spread: 0.004, width: 0.01, length: 3, intensity: 0.7, streaks: 0.6, streakFreq: 4, core: 0.8, sway: undefined,
        pulse: { amplitude: 0.6, period: 1.2, phase: i / 3 },
    })), { density: 0.9 }, null),
    lineArt: context => mergeDiagrams(standingWave(context.aspect * 0.08, context.aspect * 0.92, 0.34, 0.07, 6), waveSparks(context)),
    typography: 'crossed',
    decay: { strength: 1.3, delay: 0.7 },
});

/** 全息（l）：字像一张全息片，细密的斜纹与流动的虹彩。 */
const waveHolo = wave({
    kind: 'wave-holo',
    label: '全息',
    mood: 'loud',
    light: rig([shaft({ spread: 0.3, width: 0.3, length: 1.3, softness: 0.8, intensity: 0.8, streaks: 0.3, core: 0.3, spectrum: 0.8,
        gobo: { pattern: 'lattice', frequency: 24, duty: 0.7, drift: 0.15 }, sway: { amplitude: 0.1, period: 10, phase: 0 } })], { density: 0.8 }, { ...GLARE, intensity: 0.6 },
    fringes({ mode: 'rings', cx: 0.5, cy: 0.5, radius: 0.5, frequency: 8, speed: 1, strength: 0.15 })),
    lineArt: context => mergeDiagrams(gridPanel(context.aspect * 0.3, 0.15, context.aspect * 0.4, 0.7, 6, 8, true, { alpha: 0.3 }), waveSparks(context)),
    region: { cx: 0.5, cy: 0.5, w: 0.4, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 1.3, delay: 0.7 },
});

const WAVE_PROFILES = [
    waveSlits, waveNewton, waveAiry, waveGrating, waveSources,
    waveMoire, waveFilm, wavePolar, waveStanding, waveHolo,
];

  /* ---- rigs/zenith.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/rigs/zenith.ts
// 天光族（顶光，参考图的主调）：10 个光位。排版分配 4 横 / 3 竖 / 3 纵横。
const zenith = familyOf('zenith');

/** 天井（n）：顶部单柱光，光内烟雾上升，量角器光环与取景框。参考图。 */
const zenithShaft = zenith({
    kind: 'zenith-shaft',
    label: '天井',
    mood: 'neutral',
    light: rig([shaft(), fan(), fan({ spread: 0.55, length: 0.42, softness: 1, intensity: 0.16, streaks: 0.9, streakFreq: 40, streakSpeed: -0.03, core: 0.2, sway: undefined })]),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
    starfall: STARFALL,
});

/** 扇光（l）：顶部光源散出五道扇形放射细光束，缓慢张合。 */
const zenithFan = zenith({
    kind: 'zenith-fan',
    label: '扇光',
    mood: 'loud',
    light: rig([-2, -1, 0, 1, 2].map(k => shaft({
        angle: DOWN + k * 0.24, spread: 0.035, width: 0.012, length: 0.9, intensity: 0.7 - Math.abs(k) * 0.08,
        streaks: 0.4, streakFreq: 5, sway: { amplitude: 0.05, period: 11, phase: k * 0.1 },
    }))),
    typography: 'horizontal',
    decay: { strength: 1.2, delay: 0.8 },
    starfall: { ...STARFALL, rain: 110, rainSpread: 0.6 },
});

/** 圣环（n）：光柱 + 大号量角器光环，光源眩光更大。 */
const zenithHalo = zenith({
    kind: 'zenith-halo',
    label: '圣环',
    mood: 'neutral',
    light: rig([shaft({ spread: 0.07 }), fan({ spread: 0.42, intensity: 0.24 })], {}, { ...GLARE, radius: 0.2, intensity: 1.2, streak: 0.7 }),
    lineArt: context => mergeSpecs(
        protractorHalo({ cx: context.aspect * 0.5, cy: 0.03, radius: 0.42, alpha: 0.7, spokeStep: Math.PI / 18 }),
        protractorHalo({ cx: context.aspect * 0.5, cy: 0.03, radius: 0.24, alpha: 0.4, delay: 0.2 }),
        scatteredSparks({ aspect: context.aspect, count: 20, random: context.random, delay: 0.3 }),
    ),
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 0.8, delay: 1.2 },
    starfall: STARFALL,
});

/** 游光（q）：一道光柱左右大幅摆动，扫过字行。 */
const zenithDrift = zenith({
    kind: 'zenith-drift',
    label: '游光',
    mood: 'quiet',
    light: rig([shaft({ sway: { amplitude: 0.2, period: 9, phase: 0 }, intensity: 0.85 }), fan({ intensity: 0.2, sway: { amplitude: 0.2, period: 9, phase: 0 } })], { density: 0.9 }),
    typography: 'horizontal',
    decay: { strength: 0.7, delay: 1.4 },
    camera: { push: 0.02, driftX: 0.01, driftY: 0 },
});

/** 双柱（n）：两道平行顶光，字在两柱之间，光柱缓慢相向摆动。 */
const zenithTwin = zenith({
    kind: 'zenith-twin',
    label: '双柱',
    mood: 'neutral',
    light: rig([
        shaft({ x: 0.33, spread: 0.06, sway: { amplitude: 0.06, period: 12, phase: 0 } }),
        shaft({ x: 0.67, spread: 0.06, sway: { amplitude: 0.06, period: 12, phase: 0.5 } }),
    ], {}, null),
    lineArt: context => mergeSpecs(
        viewfinderFrame({ aspect: context.aspect, left: 0.07, top: 0.21, right: 0.93, bottom: 0.8, alpha: 0.32 }),
        scatteredSparks({ aspect: context.aspect, count: 18, random: context.random, delay: 0.2 }),
    ),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
});

/** 光雨（l）：细密的竖直光线如雨落下，光雨很密。 */
const zenithRain = zenith({
    kind: 'zenith-rain',
    label: '光雨',
    mood: 'loud',
    light: rig([0.18, 0.34, 0.5, 0.66, 0.82, 0.42].map((x, i) => shaft({
        x, spread: 0.012, width: 0.01, length: 1.1, intensity: 0.45, streaks: 0.7, streakFreq: 3,
        pulse: { amplitude: 0.35, period: 1.7 + i * 0.37, phase: i * 0.21 }, sway: undefined,
    })), { driftY: 0.05 }, { ...GLARE, intensity: 0.5 }),
    typography: 'vertical',
    decay: { strength: 1.3, delay: 0.6 },
    starfall: { ...STARFALL, rain: 220, rainSpeed: 0.45, rainSpread: 1.4, brightness: 1.1 },
});

/** 光井（q）：窄光柱落在字下的一个圆形光斑上，四周全暗。 */
const zenithWell = zenith({
    kind: 'zenith-well',
    label: '光井',
    mood: 'quiet',
    light: rig([shaft({ spread: 0.05, width: 0.02, length: 1.4, intensity: 0.8, core: 0.9 })], { density: 0.7, ambient: 0.015 }, { ...GLARE, intensity: 0.6 }),
    lineArt: context => ({
        paths: [
            { points: ellipse(context.aspect * 0.5, 0.8, 0.26, 0.05), width: 0.0018, alpha: 0.7, delay: 0.1, span: 0.5 },
            { points: ellipse(context.aspect * 0.5, 0.8, 0.17, 0.032), width: 0.0012, alpha: 0.45, delay: 0.2, span: 0.4, dash: [0.004, 0.008] },
        ],
        nodes: [{ at: [context.aspect * 0.5, 0.8], size: 0.03, delay: 0.3, twinklePhase: 0 }],
    }),
    motes: { ...MOTES, count: 160 },
    typography: 'horizontal',
    decay: { strength: 0.6, delay: 1.6 },
});

/**
 * 冠冕（l）：天井的光位加上更大的光源眩光，唱到的字里约四成各冒出一个小十字（EVA 式），
 * 连成一串，光偏橙红。给副歌与高潮用。
 */
const zenithCrown = zenith({
    kind: 'zenith-crown',
    label: '冠冕',
    mood: 'loud',
    light: context => ({ ...zenithShaft.light(context), glare: { x: 0.5, y: 0.0, radius: 0.18, intensity: 1.3, streak: 0.8 } }),
    burst: { mode: 'sung', density: 0.4, every: 1, offset: 0, size: 4, tint: [1, 0.6, 0.4] },
    typography: 'horizontal',
    decay: { strength: 1.25, delay: 0.7 },
    // 更密更快的光雨。
    starfall: { stars: 520, opening: 2.6, rain: 120, rainSpeed: 0.32, rainSpread: 0.5, brightness: 1.1 },
    camera: { push: 0.05, driftX: 0, driftY: -0.01 },
});

/** 垂降（n）：光柱自上而下伸长（每个镜头开头 3 秒），碰到字时点亮。 */
const zenithDescent = zenith({
    kind: 'zenith-descent',
    label: '垂降',
    mood: 'neutral',
    light: rig([shaft({ reveal: 3 }), fan({ reveal: 3.5 })]),
    typography: 'crossed',
    decay: { strength: 1, delay: 1 },
    starfall: { ...STARFALL, rain: 40 },
});

/** 余烬（q）：光柱将熄，只剩烟里的暖色余光与上飘的火星。 */
const zenithEmber = zenith({
    kind: 'zenith-ember',
    label: '余烬',
    mood: 'quiet',
    light: rig([
        shaft({ intensity: 0.45, tint: [1, 0.7, 0.5], pulse: { amplitude: 0.2, period: 5, phase: 0 } }),
        fan({ intensity: 0.12, tint: [1, 0.6, 0.4] }),
    ], { density: 1.2, ambient: 0.04, driftY: -0.05 }, { ...GLARE, intensity: 0.4 }),
    motes: { ...MOTES, count: 320, driftY: -0.035, swirl: 0.03, gain: 1.6, ambient: 0.04 },
    region: { cx: 0.5, cy: 0.5, w: 0.72, h: 0.62 },
    typography: 'vertical',
    decay: { strength: 1.4, delay: 0.8 },
    camera: { push: 0.02, driftX: 0, driftY: -0.012 },
});

const ZENITH_PROFILES = [
    zenithShaft, zenithFan, zenithHalo, zenithDrift, zenithTwin,
    zenithRain, zenithWell, zenithCrown, zenithDescent, zenithEmber,
];

  /* ---- catalog.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/catalog.ts
// 绘光的光位目录：10 族 × 10 种（设计见 lumisynth 仓库 docs/LUMIERE.md 第二节），按文档的族序排列。
const LUMIERE_FAMILY_LABELS = {
    zenith: '天光',
    lattice: '窗隙',
    prism: '棱镜',
    caustic: '焦散',
    optics: '光路',
    wave: '衍射',
    botany: '叶脉',
    astral: '星象',
    stage: '追光',
    motes: '萤尘',
};

/** 各族的画面，一句话（设置与调试面板里的族说明）。 */
const LUMIERE_FAMILY_DESCRIPTIONS = {
    zenith: '顶光：一束或数束光柱从正上方落下，最标准的绘光画面，哪段都能用',
    lattice: '光穿过百叶、窗格、门缝、树叶，投下条纹与格子影，室内、日常、回忆感',
    prism: '棱镜分光：白光拆成彩虹色的光束与光谱，色彩最多，适合上扬与副歌',
    caustic: '水、玻璃与晶体折出的流动光网，池底与杯影，温柔、流动',
    optics: '光路图解：透镜、焦点、镜面反射、光纤，理性、精密，像实验记录',
    wave: '干涉与衍射：同心环、双缝条纹、光栅、驻波，抽象、有节奏感',
    botany: '金色的叶脉、藤蔓、种子与花的线稿在光里生长，安静、有生命感',
    astral: '星图：轨道、星轨、星座连线、日冕与浑天仪，辽阔、适合副歌与尾声',
    stage: '舞台追光：聚光灯、探照灯、频闪、激光，浓烟，最有演出感和冲击力',
    motes: '以烟与光尘为主、几乎没有光束：浮尘、萤火、光雪、极光，最安静，适合间奏与换气',
};

const LUMIERE_PROFILES = [
    ...ZENITH_PROFILES,
    ...LATTICE_PROFILES,
    ...PRISM_PROFILES,
    ...CAUSTIC_PROFILES,
    ...OPTICS_PROFILES,
    ...WAVE_PROFILES,
    ...BOTANY_PROFILES,
    ...ASTRAL_PROFILES,
    ...STAGE_PROFILES,
    ...MOTES_PROFILES,
];

const BY_KIND = new Map(LUMIERE_PROFILES.map(profile => [profile.kind, profile]));

const LUMIERE_KINDS = LUMIERE_PROFILES.map(profile => profile.kind);

/** 未知的 kind 退回天井。 */
const profileOf = (kind) => BY_KIND.get(kind) ?? LUMIERE_PROFILES[0];

const hasProfile = (kind) => BY_KIND.has(kind);

  window.foliaLumiereRigs = {
    FOG: FOG,
    GLARE: GLARE,
    LUMIERE_KINDS: LUMIERE_KINDS,
    MOTES: MOTES,
    profileOf: profileOf,
    shaft: shaft
  };
}());
