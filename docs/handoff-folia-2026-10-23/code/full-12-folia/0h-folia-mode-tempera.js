/* Folia 凝彩（tempera）节目编排层 —— 把歌词编译成 seek-safe 的确定性时间轴。
 *
 * 源文件（Folia: src/components/visualizer/tempera/）：
 *   types.ts            → §1 枚举（121 种 shot / 3 种转场 / 5 种装饰母题）
 *   temperaShotProfiles.ts → §1 逐 kind 的版式区、入场向量、相机、情绪
 *   graphemeTiming.ts   → §3 字素时间轴
 *   temperaProgram.ts   → §4 语义分段、§5 节目编译
 *
 * 必须照抄的判据：
 *  1. 分段必须**无损**：`segments` 拼接 == 整行原文；粘连标点并入前一段，
 *     且只有「无自身时序」的字素才被钉到前一段的尾巴上（否则逗号会跟着下一个词到）。
 *  2. 段落切分：`blockIndex`/`songPart` 任一变 → 'metadata'；间隔 ≥ 阈值 → 'time-gap'；
 *     阈值 = clamp(间隔中位数 × 2.5, 1.25, 3.5)。
 *  3. 过长草稿必须再切：> 6 行、或跨度 > 18s；切点取最大间隔（次行到倒数第二行之间），
 *     切完的边界记 'line-cap'（前段 ≥6 行）或 'duration-cap'。
 *  4. 一段里每个 shot 显示 2..4 个词或 ~2.2s（seed 决定 target），
 *     整行模式则一整行一个 shot。
 *  5. shot 的 `endTime` 必须**铺满**到下一个 shot 的 `startTime`（否则运行时的
 *     「最后一个已开始的 shot」会落进空洞）；`lyricEndTime` 故意不铺 —— 入场错峰要用它。
 *  6. 收尾 shot 的 `endTime` 抬到段落自己的 render 尾巴。
 *  7. 相机方向永远来自 `flowAngle`，profile 只给行程长度与变焦区间。
 *  8. flowAngle 竖直轴为主：首 shot 取 ±π/2 + 抖动，之后每次向轴回拉 0.3 再加 ±0.25 抖动。
 *  9. 装饰素材（边距碎字、超大 watermark）只能取自**本 shot 没在显示**的词；
 *     整行模式下一行一段会取空 → 退到整首歌其余的片段。
 * 10. 段间乐器空档 ≥ 1.2s 要补 bridge shot（最多 3 个，每个 ≤5s），
 *     否则长间奏会冻在最后一句画面上。
 * 11. 转场时长 = clamp(间隔 + 0.3, 0.35, 1)，且 `block-wipe` 不提前开场下一个 shot。
 *
 * 与 Folia 的实现差异：
 *  - 全 ES5 + var；`??`/默认参数换成等价三元。
 *  - 散列不另抄一份，直接取 `window.foliaTemperaMg` 的同一实现。
 *  - 本文件只到「节目」为止：不建 pixi、不注册模式。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  var mg = window.foliaTemperaMg;
  /* 图库没加载时本文件不产出任何东西（也不会把后续模块带崩）。 */
  if (!mg) return;

  /* 同一份确定性散列，调用形式与 Folia 一致。 */
  var temperaHashSeed = mg.hashSeed;
  var temperaMixSeed = mg.mixSeed;
  var temperaHash01 = mg.hash01;
  var temperaChoose = mg.chooseWithoutRepeat;

  /* ====== 以下由 .workbuddy/tmp/extract-tempera-profiles.js 从 Folia TS 源逐字抽取 ====== */

  var TEMPERA_SHOT_KINDS = [
    'duo-split', 'quad-split', 'tri-column', 'thirds-stack',
    'checker-quad', 'corner-wedge', 'diagonal-halves', 'cross-axis',
    'offset-halves', 'stair-blocks', 'pillar-gap', 'corner-quad',
    'sliver-stack', 'band-strip', 'horizon-band', 'deep-dive',
    'tone-ramp', 'double-band', 'tilt-band', 'edge-rails',
    'gradient-wall', 'terrace', 'frame-window', 'double-frame',
    'circle-window', 'ladder-frame', 'corner-brackets', 'inset-box',
    'bracket-pair', 'arch-window', 'grid-cells', 'keyhole',
    'poster-panel', 'diamond-stack', 'slash-poster', 'arrow-wedge',
    'edge-bleed', 'triangle-mass', 'ribbon-cross', 'half-disc',
    'stacked-slabs', 'wedge-pair', 'quiet-line', 'starfield-dots',
    'ripple-lines', 'hair-grid', 'margin-rule', 'dot-drift',
    'arc-sweep', 'blank-page', 'cinema-scope', 'cinema-wide',
    'cinema-academy', 'cinema-square', 'cinema-portrait', 'cinema-tall',
    'cinema-twin', 'bubble-drift', 'cloud-window', 'heart-burst',
    'sparkle-field', 'petal-arc', 'scallop-band', 'ribbon-loop',
    'round-plate', 'halo-burst', 'iris-hole', 'slot-rail',
    'punch-row', 'film-gate', 'cross-vent', 'louvre-slats',
    'ring-eye', 'notch-stack', 'wedge-gap', 'dot-sieve',
    'sight-mark', 'dial-scale', 'chevron-run', 'tally-column',
    'grid-focus', 'axis-caps', 'strobe-slats', 'offset-plate',
    'radial-comb', 'bracket-target', 'flow-channel', 'twin-channel',
    'reed-run', 'taper-channel', 'chain-ports', 'dash-channel',
    'window-run', 'bridge-span', 'braid-channel', 'port-ladder',
    'apex-mass', 'ziggurat', 'slab-wall', 'cantilever',
    'pylon-pair', 'bunker-slit', 'plinth-stack', 'buttress-run',
    'void-core', 'shear-block', 'ridge-line', 'chasm',
    'overhang', 'step-well', 'pier-row', 'revetment',
    'tower-crop', 'lintel', 'rubble-fan', 'gnomon',
    'monogatari-card', 'monogatari-rule', 'monogatari-edge', 'monogatari-stack',
    'monogatari-flash'
  ];

  var TEMPERA_TRANSITION_KINDS = [
    'block-wipe', 'camera-pan', 'shape-carry'
  ];

  var TEMPERA_DECOR_MOTIFS = [
    'diamonds', 'hatch-twin', 'band-cross', 'poster-diamond', 'doodle'
  ];

  /* Shot regions are fractions of the viewport; align 缺省 center，rotation 缺省 0，
   * fontScale 缺省 1（原式用默认参数与 ??，这里换成 ES5 的三元，语义一致）。 */
  function temperaRegion(cx, cy, w, h, options) {
    var opt = options || {};
    return {
      cx: cx,
      cy: cy,
      w: w,
      h: h,
      align: opt.align == null ? 'center' : opt.align,
      rotation: opt.rotation == null ? 0 : opt.rotation,
      fontScale: opt.fontScale == null ? 1 : opt.fontScale
    };
  }

    var TEMPERA_SHOT_PROFILES = {
      'duo-split': {
          region: temperaRegion(0.5, 0.52, 0.86, 0.46),
          enter: { x: 0, y: 1.3 },
          camera: { travel: 0.11, zoomStart: 1.06, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'quad-split': {
          // Sits dead on the crossing of the four panels, so every glyph straddles two tones.
          region: temperaRegion(0.5, 0.5, 0.82, 0.4),
          enter: { x: 0.9, y: 0.9 },
          camera: { travel: 0.09, zoomStart: 1.08, zoomEnd: 1.16 },
          mood: 'loud',
      },
      'tri-column': {
          region: temperaRegion(0.5, 0.5, 0.7, 0.5, { fontScale: 0.95 }),
          enter: { x: -1.2, y: 0 },
          camera: { travel: 0.12, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'thirds-stack': {
          region: temperaRegion(0.5, 0.5, 0.8, 0.28),
          enter: { x: 0, y: 1.1 },
          camera: { travel: 0.13, zoomStart: 1.03, zoomEnd: 1.11 },
          mood: 'neutral',
      },
      'checker-quad': {
          region: temperaRegion(0.5, 0.5, 0.76, 0.36),
          enter: { x: 0.8, y: -0.8 },
          camera: { travel: 0.1, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'corner-wedge': {
          region: temperaRegion(0.44, 0.56, 0.68, 0.4, { align: 'left', rotation: -0.03 }),
          enter: { x: -1.4, y: 0.5 },
          camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'diagonal-halves': {
          region: temperaRegion(0.5, 0.5, 0.78, 0.4, { rotation: -0.075 }),
          enter: { x: 1.1, y: 1.1 },
          camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'neutral',
      },
      'cross-axis': {
          region: temperaRegion(0.5, 0.5, 0.66, 0.3),
          enter: { x: 0, y: 1.2 },
          camera: { travel: 0.08, zoomStart: 1.12, zoomEnd: 1.03 },
          mood: 'loud',
      },
      'offset-halves': {
          region: temperaRegion(0.5, 0.5, 0.8, 0.4),
          enter: { x: 0.9, y: 0.6 },
          camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'stair-blocks': {
          region: temperaRegion(0.5, 0.5, 0.72, 0.38, { rotation: -0.03 }),
          enter: { x: -1, y: 0.8 },
          camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'pillar-gap': {
          // The lyric lives in the bright slot the two masses leave between them.
          region: temperaRegion(0.5, 0.5, 0.34, 0.62, { fontScale: 0.8 }),
          enter: { x: 0, y: 1.2 },
          camera: { travel: 0.07, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'corner-quad': {
          region: temperaRegion(0.46, 0.46, 0.68, 0.36),
          enter: { x: -0.9, y: -0.9 },
          camera: { travel: 0.1, zoomStart: 1.07, zoomEnd: 1.15 },
          mood: 'neutral',
      },
      'sliver-stack': {
          region: temperaRegion(0.5, 0.5, 0.76, 0.3),
          enter: { x: 1.2, y: 0 },
          camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'band-strip': {
          region: temperaRegion(0.5, 0.52, 0.78, 0.26, { fontScale: 0.92 }),
          enter: { x: 0.5, y: 1.05 },
          camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'neutral',
      },
      'horizon-band': {
          // Type rides just above the waterline; the vertical flow then reads as a descent.
          region: temperaRegion(0.5, 0.36, 0.8, 0.3),
          enter: { x: 0, y: -1.1 },
          camera: { travel: 0.14, zoomStart: 1.02, zoomEnd: 1.1 },
          mood: 'neutral',
      },
      'deep-dive': {
          region: temperaRegion(0.5, 0.58, 0.76, 0.34),
          enter: { x: 0, y: 1.6 },
          camera: { travel: 0.16, zoomStart: 1.04, zoomEnd: 1.14 },
          mood: 'neutral',
      },
      'tone-ramp': {
          region: temperaRegion(0.5, 0.5, 0.82, 0.38),
          enter: { x: 1.2, y: 0.4 },
          camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'double-band': {
          region: temperaRegion(0.5, 0.5, 0.78, 0.22, { fontScale: 0.88 }),
          enter: { x: 0.8, y: 0 },
          camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.11 },
          mood: 'neutral',
      },
      'tilt-band': {
          region: temperaRegion(0.5, 0.5, 0.8, 0.26, { rotation: -0.1 }),
          enter: { x: -1.1, y: 0.5 },
          camera: { travel: 0.13, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'edge-rails': {
          region: temperaRegion(0.5, 0.5, 0.74, 0.4),
          enter: { x: 0, y: 1 },
          camera: { travel: 0.09, zoomStart: 1.02, zoomEnd: 1.09 },
          mood: 'quiet',
      },
      'gradient-wall': {
          region: temperaRegion(0.5, 0.44, 0.82, 0.36),
          enter: { x: 0.5, y: -0.9 },
          camera: { travel: 0.15, zoomStart: 1.04, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'terrace': {
          region: temperaRegion(0.46, 0.52, 0.72, 0.34, { align: 'left' }),
          enter: { x: -1.2, y: 0.4 },
          camera: { travel: 0.14, zoomStart: 1.05, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'frame-window': {
          region: temperaRegion(0.5, 0.5, 0.64, 0.5, { fontScale: 0.95 }),
          enter: { x: 0, y: 0.95 },
          camera: { travel: 0.05, zoomStart: 1.14, zoomEnd: 1.03 },
          mood: 'neutral',
      },
      'double-frame': {
          region: temperaRegion(0.5, 0.5, 0.58, 0.4, { fontScale: 0.9 }),
          enter: { x: 0.6, y: 0.6 },
          camera: { travel: 0.06, zoomStart: 1.12, zoomEnd: 1.02 },
          mood: 'neutral',
      },
      'circle-window': {
          region: temperaRegion(0.5, 0.5, 0.5, 0.34, { fontScale: 0.88 }),
          enter: { x: 0, y: 0.8 },
          camera: { travel: 0.05, zoomStart: 1.16, zoomEnd: 1.04 },
          mood: 'quiet',
      },
      'ladder-frame': {
          region: temperaRegion(0.52, 0.5, 0.6, 0.4, { align: 'left', fontScale: 0.9 }),
          enter: { x: -0.9, y: 0.6 },
          camera: { travel: 0.07, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'quiet',
      },
      'corner-brackets': {
          region: temperaRegion(0.5, 0.5, 0.56, 0.3, { fontScale: 0.85 }),
          enter: { x: 0, y: 0.6 },
          camera: { travel: 0.04, zoomStart: 1.06, zoomEnd: 1.01 },
          mood: 'quiet',
      },
      'inset-box': {
          region: temperaRegion(0.5, 0.5, 0.6, 0.42, { fontScale: 0.92 }),
          enter: { x: 0, y: 0.8 },
          camera: { travel: 0.06, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'quiet',
      },
      'bracket-pair': {
          region: temperaRegion(0.5, 0.5, 0.54, 0.34, { fontScale: 0.88 }),
          enter: { x: 1, y: 0 },
          camera: { travel: 0.05, zoomStart: 1.08, zoomEnd: 1.01 },
          mood: 'quiet',
      },
      'arch-window': {
          region: temperaRegion(0.5, 0.54, 0.5, 0.34, { fontScale: 0.86 }),
          enter: { x: 0, y: 0.9 },
          camera: { travel: 0.06, zoomStart: 1.14, zoomEnd: 1.03 },
          mood: 'quiet',
      },
      'grid-cells': {
          region: temperaRegion(0.5, 0.5, 0.72, 0.22, { fontScale: 0.8 }),
          enter: { x: 0.7, y: 0.7 },
          camera: { travel: 0.07, zoomStart: 1.06, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'keyhole': {
          region: temperaRegion(0.5, 0.6, 0.42, 0.3, { fontScale: 0.78 }),
          enter: { x: 0, y: 1 },
          camera: { travel: 0.05, zoomStart: 1.12, zoomEnd: 1.02 },
          mood: 'quiet',
      },
      'poster-panel': {
          region: temperaRegion(0.4, 0.5, 0.58, 0.62, { align: 'left', rotation: -0.045 }),
          enter: { x: -1.5, y: 0.35 },
          camera: { travel: 0.08, zoomStart: 1.05, zoomEnd: 1.12 },
          mood: 'loud',
      },
      'diamond-stack': {
          region: temperaRegion(0.54, 0.5, 0.6, 0.42, { align: 'right', rotation: 0.035 }),
          enter: { x: 1.3, y: -0.5 },
          camera: { travel: 0.09, zoomStart: 1.07, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'slash-poster': {
          region: temperaRegion(0.46, 0.5, 0.66, 0.44, { align: 'left', rotation: -0.09 }),
          enter: { x: -1.2, y: 1 },
          camera: { travel: 0.11, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'arrow-wedge': {
          region: temperaRegion(0.5, 0.34, 0.72, 0.26),
          enter: { x: 0, y: -1.2 },
          camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.13 },
          mood: 'loud',
      },
      'edge-bleed': {
          region: temperaRegion(0.56, 0.5, 0.6, 0.44, { align: 'left' }),
          enter: { x: 1.4, y: 0.3 },
          camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'triangle-mass': {
          region: temperaRegion(0.5, 0.42, 0.68, 0.3),
          enter: { x: 0.8, y: -1 },
          camera: { travel: 0.12, zoomStart: 1.05, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'ribbon-cross': {
          region: temperaRegion(0.5, 0.5, 0.62, 0.3, { rotation: 0.05 }),
          enter: { x: -1, y: -0.8 },
          camera: { travel: 0.11, zoomStart: 1.08, zoomEnd: 1.16 },
          mood: 'loud',
      },
      'half-disc': {
          region: temperaRegion(0.44, 0.44, 0.6, 0.34, { align: 'left' }),
          enter: { x: -1.3, y: 0.4 },
          camera: { travel: 0.1, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'stacked-slabs': {
          region: temperaRegion(0.52, 0.5, 0.62, 0.4, { rotation: -0.05 }),
          enter: { x: 1.1, y: 0.6 },
          camera: { travel: 0.1, zoomStart: 1.07, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'wedge-pair': {
          region: temperaRegion(0.5, 0.5, 0.44, 0.44, { fontScale: 0.82 }),
          enter: { x: 0, y: 1.1 },
          camera: { travel: 0.09, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'quiet-line': {
          region: temperaRegion(0.5, 0.5, 0.6, 0.28, { fontScale: 0.58 }),
          enter: { x: 0, y: 0.7 },
          camera: { travel: 0.03, zoomStart: 1, zoomEnd: 1.04 },
          mood: 'quiet',
      },
      'starfield-dots': {
          region: temperaRegion(0.5, 0.5, 0.62, 0.26, { fontScale: 0.66 }),
          enter: { x: 0.4, y: 0.5 },
          camera: { travel: 0.04, zoomStart: 1.02, zoomEnd: 1.08 },
          mood: 'quiet',
      },
      'ripple-lines': {
          region: temperaRegion(0.5, 0.46, 0.66, 0.28, { fontScale: 0.72 }),
          enter: { x: 0, y: 0.9 },
          camera: { travel: 0.06, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'quiet',
      },
      'hair-grid': {
          region: temperaRegion(0.5, 0.5, 0.64, 0.26, { fontScale: 0.62 }),
          enter: { x: 0.4, y: 0.6 },
          camera: { travel: 0.04, zoomStart: 1.01, zoomEnd: 1.06 },
          mood: 'quiet',
      },
      'margin-rule': {
          region: temperaRegion(0.54, 0.5, 0.62, 0.26, { align: 'left', fontScale: 0.66 }),
          enter: { x: -0.8, y: 0.3 },
          camera: { travel: 0.05, zoomStart: 1.02, zoomEnd: 1.07 },
          mood: 'quiet',
      },
      'dot-drift': {
          region: temperaRegion(0.5, 0.48, 0.6, 0.26, { fontScale: 0.68 }),
          enter: { x: 0.6, y: 0.6 },
          camera: { travel: 0.05, zoomStart: 1.03, zoomEnd: 1.09 },
          mood: 'quiet',
      },
      'arc-sweep': {
          region: temperaRegion(0.5, 0.5, 0.6, 0.26, { fontScale: 0.7 }),
          enter: { x: 0, y: 0.8 },
          camera: { travel: 0.06, zoomStart: 1.04, zoomEnd: 1.1 },
          mood: 'quiet',
      },
      'blank-page': {
          region: temperaRegion(0.5, 0.5, 0.56, 0.24, { fontScale: 0.6 }),
          enter: { x: 0, y: 0.5 },
          camera: { travel: 0.03, zoomStart: 1, zoomEnd: 1.03 },
          mood: 'quiet',
      },
      // Cinema mattes. The regions are conservative boxes that stay inside the window on any
      // viewport aspect; the composition aspect-fits the actual window from the real size.
      'cinema-scope': {
          region: temperaRegion(0.5, 0.5, 0.74, 0.22, { fontScale: 0.86 }),
          enter: { x: 0.9, y: 0 },
          camera: { travel: 0.09, zoomStart: 1.04, zoomEnd: 1.11 },
          mood: 'neutral',
      },
      'cinema-wide': {
          region: temperaRegion(0.5, 0.5, 0.7, 0.3, { fontScale: 0.9 }),
          enter: { x: 0, y: 0.9 },
          camera: { travel: 0.08, zoomStart: 1.06, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'cinema-academy': {
          region: temperaRegion(0.5, 0.5, 0.5, 0.4, { fontScale: 0.88 }),
          enter: { x: 0, y: 0.8 },
          camera: { travel: 0.06, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'quiet',
      },
      'cinema-square': {
          region: temperaRegion(0.5, 0.5, 0.42, 0.4, { fontScale: 0.84 }),
          enter: { x: 0.7, y: 0.7 },
          camera: { travel: 0.05, zoomStart: 1.12, zoomEnd: 1.03 },
          mood: 'quiet',
      },
      'cinema-portrait': {
          region: temperaRegion(0.5, 0.5, 0.32, 0.46, { fontScale: 0.8 }),
          enter: { x: 0, y: 1 },
          camera: { travel: 0.06, zoomStart: 1.08, zoomEnd: 1.16 },
          mood: 'neutral',
      },
      'cinema-tall': {
          region: temperaRegion(0.5, 0.5, 0.24, 0.5, { fontScale: 0.72 }),
          enter: { x: 0.8, y: 0.4 },
          camera: { travel: 0.07, zoomStart: 1.05, zoomEnd: 1.14 },
          mood: 'neutral',
      },
      'cinema-twin': {
          // Two windows; the lyric takes the wider one, which the composition keeps on the left.
          region: temperaRegion(0.33, 0.5, 0.3, 0.32, { fontScale: 0.76 }),
          enter: { x: -0.9, y: 0.3 },
          camera: { travel: 0.08, zoomStart: 1.06, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      // Rounded family. The type sits inside a curved shape rather than across a seam, so the
      // regions track that shape and the camera stays gentler than the poster family's.
      'bubble-drift': {
          region: temperaRegion(0.5, 0.5, 0.72, 0.36, { fontScale: 0.92 }),
          enter: { x: 0.5, y: 1 },
          camera: { travel: 0.09, zoomStart: 1.05, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'cloud-window': {
          // Inside the medallion, which the composition centres slightly below the frame centre.
          region: temperaRegion(0.5, 0.52, 0.46, 0.3, { fontScale: 0.84 }),
          enter: { x: 0, y: 0.8 },
          camera: { travel: 0.05, zoomStart: 1.14, zoomEnd: 1.03 },
          mood: 'quiet',
      },
      'heart-burst': {
          region: temperaRegion(0.5, 0.52, 0.5, 0.3, { fontScale: 0.95 }),
          enter: { x: 0.8, y: 0.8 },
          camera: { travel: 0.1, zoomStart: 1.08, zoomEnd: 1.16 },
          mood: 'loud',
      },
      'sparkle-field': {
          region: temperaRegion(0.5, 0.48, 0.64, 0.26, { fontScale: 0.7 }),
          enter: { x: 0.4, y: 0.6 },
          camera: { travel: 0.04, zoomStart: 1.02, zoomEnd: 1.08 },
          mood: 'quiet',
      },
      'petal-arc': {
          // Low in the frame: the petal fan owns the top corner it swings out of.
          region: temperaRegion(0.5, 0.6, 0.7, 0.3, { fontScale: 0.9 }),
          enter: { x: 0, y: 1.1 },
          camera: { travel: 0.1, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'scallop-band': {
          region: temperaRegion(0.5, 0.5, 0.76, 0.24, { fontScale: 0.88 }),
          enter: { x: 0.7, y: 0 },
          camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'neutral',
      },
      'ribbon-loop': {
          region: temperaRegion(0.5, 0.5, 0.68, 0.22, { rotation: 0.04, fontScale: 0.86 }),
          enter: { x: -1.1, y: 0.6 },
          camera: { travel: 0.11, zoomStart: 1.07, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'round-plate': {
          region: temperaRegion(0.5, 0.5, 0.56, 0.36, { fontScale: 0.86 }),
          enter: { x: 0, y: 0.7 },
          camera: { travel: 0.05, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'quiet',
      },
      'halo-burst': {
          region: temperaRegion(0.5, 0.5, 0.46, 0.3, { fontScale: 0.95 }),
          enter: { x: 0, y: 0.9 },
          camera: { travel: 0.08, zoomStart: 1.12, zoomEnd: 1.02 },
          mood: 'loud',
      },
      // Punched plates. Every region here is placed against the opening the composition cuts:
      // the inversion filter reads the Pixi render target, and a hole shows the DOM background
      // layer, which WebGL cannot see - so type over an opening would be judged against the bare
      // paper wash and left to fend for itself on whatever the background happens to be.
      'iris-hole': {
          // Bottom-left of the port, which sits high on the right.
          region: temperaRegion(0.28, 0.68, 0.44, 0.28, { fontScale: 0.78 }),
          enter: { x: -1, y: 0.6 },
          camera: { travel: 0.09, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'slot-rail': {
          region: temperaRegion(0.5, 0.66, 0.72, 0.3, { fontScale: 0.9 }),
          enter: { x: 0.6, y: 0.9 },
          camera: { travel: 0.12, zoomStart: 1.04, zoomEnd: 1.11 },
          mood: 'neutral',
      },
      'punch-row': {
          region: temperaRegion(0.5, 0.5, 0.76, 0.34, { fontScale: 0.92 }),
          enter: { x: 1.1, y: 0 },
          camera: { travel: 0.13, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'neutral',
      },
      'film-gate': {
          region: temperaRegion(0.5, 0.82, 0.66, 0.2, { fontScale: 0.8 }),
          enter: { x: 0, y: 1.1 },
          camera: { travel: 0.08, zoomStart: 1.08, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'cross-vent': {
          region: temperaRegion(0.5, 0.82, 0.66, 0.2, { fontScale: 0.8 }),
          enter: { x: 0, y: 1 },
          camera: { travel: 0.07, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'louvre-slats': {
          region: temperaRegion(0.5, 0.8, 0.7, 0.22, { fontScale: 0.82 }),
          enter: { x: 0.8, y: 0.7 },
          camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'ring-eye': {
          // On the island left standing inside the ring; nothing else in the frame is solid.
          region: temperaRegion(0.5, 0.5, 0.26, 0.18, { fontScale: 0.62 }),
          enter: { x: 0, y: 0.7 },
          camera: { travel: 0.05, zoomStart: 1.14, zoomEnd: 1.03 },
          mood: 'quiet',
      },
      'notch-stack': {
          region: temperaRegion(0.32, 0.5, 0.5, 0.34, { fontScale: 0.84 }),
          enter: { x: -1.1, y: 0.5 },
          camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'wedge-gap': {
          region: temperaRegion(0.5, 0.78, 0.7, 0.24, { fontScale: 0.82 }),
          enter: { x: 0, y: 1.2 },
          camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'dot-sieve': {
          region: temperaRegion(0.75, 0.5, 0.38, 0.3, { fontScale: 0.78 }),
          enter: { x: 0.9, y: 0.4 },
          camera: { travel: 0.06, zoomStart: 1.03, zoomEnd: 1.09 },
          mood: 'quiet',
      },
      // Instrument panels. The type shares the frame with the focal mass rather than hiding from
      // it, so these regions sit on the mass itself wherever the composition leaves it solid.
      'sight-mark': {
          region: temperaRegion(0.5, 0.5, 0.46, 0.2, { fontScale: 0.85 }),
          enter: { x: 0, y: 0.8 },
          camera: { travel: 0.06, zoomStart: 1.12, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'dial-scale': {
          region: temperaRegion(0.5, 0.5, 0.36, 0.2, { fontScale: 0.8 }),
          enter: { x: 0.7, y: 0.5 },
          camera: { travel: 0.05, zoomStart: 1.1, zoomEnd: 1.02 },
          mood: 'neutral',
      },
      'chevron-run': {
          region: temperaRegion(0.5, 0.52, 0.72, 0.3, { fontScale: 0.9 }),
          enter: { x: 0, y: -1.1 },
          camera: { travel: 0.14, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'tally-column': {
          region: temperaRegion(0.38, 0.5, 0.6, 0.32, { align: 'left', fontScale: 0.76 }),
          enter: { x: -0.9, y: 0.3 },
          camera: { travel: 0.05, zoomStart: 1.02, zoomEnd: 1.08 },
          mood: 'quiet',
      },
      'grid-focus': {
          region: temperaRegion(0.5, 0.5, 0.62, 0.22, { fontScale: 0.85 }),
          enter: { x: 0.8, y: 0.6 },
          camera: { travel: 0.09, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'axis-caps': {
          // Below the port bored through the bar, still on the bar itself.
          region: temperaRegion(0.5, 0.72, 0.66, 0.24, { fontScale: 0.82 }),
          enter: { x: 0, y: 1.2 },
          camera: { travel: 0.13, zoomStart: 1.06, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'strobe-slats': {
          region: temperaRegion(0.5, 0.5, 0.3, 0.36, { fontScale: 0.8 }),
          enter: { x: 1, y: 0 },
          camera: { travel: 0.1, zoomStart: 1.08, zoomEnd: 1.16 },
          mood: 'loud',
      },
      'offset-plate': {
          region: temperaRegion(0.48, 0.62, 0.4, 0.2, { fontScale: 0.85 }),
          enter: { x: -0.9, y: -0.6 },
          camera: { travel: 0.09, zoomStart: 1.07, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'radial-comb': {
          region: temperaRegion(0.42, 0.4, 0.62, 0.3, { fontScale: 0.88 }),
          enter: { x: -1.2, y: -0.4 },
          camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'bracket-target': {
          region: temperaRegion(0.5, 0.28, 0.66, 0.24, { fontScale: 0.85 }),
          enter: { x: 0, y: -0.9 },
          camera: { travel: 0.06, zoomStart: 1.04, zoomEnd: 1.1 },
          mood: 'quiet',
      },
      // Corridors. The channels lean with the flow, so every region here is kept clear of the
      // sideways walk a long tilted opening makes across the frame (see `temperaCutout.ts`).
      'flow-channel': {
          region: temperaRegion(0.32, 0.5, 0.5, 0.3, { fontScale: 0.85 }),
          enter: { x: -1, y: 0.5 },
          camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'twin-channel': {
          // On the rib between the two corridors.
          region: temperaRegion(0.5, 0.5, 0.4, 0.3, { fontScale: 0.85 }),
          enter: { x: 0, y: 1.2 },
          camera: { travel: 0.14, zoomStart: 1.03, zoomEnd: 1.11 },
          mood: 'neutral',
      },
      'reed-run': {
          region: temperaRegion(0.5, 0.5, 0.3, 0.3, { fontScale: 0.72 }),
          enter: { x: 0, y: 0.9 },
          camera: { travel: 0.1, zoomStart: 1.02, zoomEnd: 1.09 },
          mood: 'quiet',
      },
      'taper-channel': {
          region: temperaRegion(0.28, 0.5, 0.42, 0.3, { fontScale: 0.82 }),
          enter: { x: -1.1, y: 0.6 },
          camera: { travel: 0.12, zoomStart: 1.05, zoomEnd: 1.14 },
          mood: 'neutral',
      },
      'chain-ports': {
          region: temperaRegion(0.32, 0.5, 0.5, 0.32, { fontScale: 0.8 }),
          enter: { x: -0.8, y: 0.7 },
          camera: { travel: 0.11, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'quiet',
      },
      'dash-channel': {
          region: temperaRegion(0.3, 0.5, 0.46, 0.3, { fontScale: 0.84 }),
          enter: { x: 0, y: 1.3 },
          camera: { travel: 0.15, zoomStart: 1.04, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'window-run': {
          region: temperaRegion(0.28, 0.5, 0.42, 0.3, { fontScale: 0.82 }),
          enter: { x: 0, y: 1.2 },
          camera: { travel: 0.14, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'bridge-span': {
          // On the band crossing the corridor - the widest opening in the family runs under it.
          region: temperaRegion(0.5, 0.5, 0.72, 0.16, { fontScale: 0.85 }),
          enter: { x: 1.2, y: 0 },
          camera: { travel: 0.12, zoomStart: 1.08, zoomEnd: 1.16 },
          mood: 'loud',
      },
      'braid-channel': {
          region: temperaRegion(0.5, 0.5, 0.34, 0.3, { fontScale: 0.8 }),
          enter: { x: 0, y: 1.1 },
          camera: { travel: 0.13, zoomStart: 1.06, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'port-ladder': {
          region: temperaRegion(0.3, 0.5, 0.46, 0.3, { fontScale: 0.78 }),
          enter: { x: -0.9, y: 0.4 },
          camera: { travel: 0.09, zoomStart: 1.02, zoomEnd: 1.09 },
          mood: 'quiet',
      },
      // Brutalist monoliths. Where the ground behind the type is solid, the region is placed to
      // straddle the mass's silhouette - a glyph half on the mass and half off it is the whole
      // point of the inversion filter. Where the composition opens the ground to the background
      // instead, the region moves fully onto the mass.
      'apex-mass': {
          // Sits just above the apex, which pushes into the bottom of the box.
          region: temperaRegion(0.5, 0.3, 0.62, 0.2, { fontScale: 0.9 }),
          enter: { x: 0, y: -1 },
          camera: { travel: 0.12, zoomStart: 1.04, zoomEnd: 1.13 },
          mood: 'loud',
      },
      'ziggurat': {
          region: temperaRegion(0.5, 0.32, 0.5, 0.18, { fontScale: 0.85 }),
          enter: { x: 0, y: -0.9 },
          camera: { travel: 0.1, zoomStart: 1.06, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'slab-wall': {
          region: temperaRegion(0.36, 0.5, 0.5, 0.24, { fontScale: 0.88 }),
          enter: { x: 1.2, y: 0 },
          camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'cantilever': {
          region: temperaRegion(0.42, 0.42, 0.6, 0.14, { fontScale: 0.8 }),
          enter: { x: -1.3, y: 0 },
          camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'loud',
      },
      'pylon-pair': {
          // On the lintel; the bay below it is open to the background.
          region: temperaRegion(0.5, 0.22, 0.7, 0.12, { fontScale: 0.75 }),
          enter: { x: 0, y: -0.8 },
          camera: { travel: 0.09, zoomStart: 1.08, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'bunker-slit': {
          region: temperaRegion(0.5, 0.48, 0.72, 0.2, { fontScale: 0.86 }),
          enter: { x: 0.9, y: 0.4 },
          camera: { travel: 0.08, zoomStart: 1.06, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'plinth-stack': {
          region: temperaRegion(0.5, 0.32, 0.44, 0.16, { fontScale: 0.82 }),
          enter: { x: 0, y: -0.8 },
          camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'buttress-run': {
          region: temperaRegion(0.5, 0.26, 0.7, 0.2, { fontScale: 0.86 }),
          enter: { x: 0.8, y: -0.8 },
          camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.11 },
          mood: 'loud',
      },
      'void-core': {
          region: temperaRegion(0.5, 0.2, 0.66, 0.18, { fontScale: 0.84 }),
          enter: { x: 0, y: -1.1 },
          camera: { travel: 0.11, zoomStart: 1.07, zoomEnd: 1.15 },
          mood: 'loud',
      },
      'shear-block': {
          region: temperaRegion(0.5, 0.5, 0.56, 0.2, { fontScale: 0.88 }),
          enter: { x: 1, y: 0.5 },
          camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'neutral',
      },
      'ridge-line': {
          region: temperaRegion(0.5, 0.42, 0.72, 0.2, { fontScale: 0.9 }),
          enter: { x: 0, y: -1 },
          camera: { travel: 0.14, zoomStart: 1.03, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'chasm': {
          region: temperaRegion(0.25, 0.5, 0.38, 0.24, { fontScale: 0.82 }),
          enter: { x: -1.2, y: 0.4 },
          camera: { travel: 0.1, zoomStart: 1.06, zoomEnd: 1.14 },
          mood: 'loud',
      },
      'overhang': {
          region: temperaRegion(0.44, 0.58, 0.6, 0.22, { fontScale: 0.88 }),
          enter: { x: 0, y: 1.1 },
          camera: { travel: 0.11, zoomStart: 1.08, zoomEnd: 1.02 },
          mood: 'loud',
      },
      'step-well': {
          region: temperaRegion(0.5, 0.26, 0.66, 0.2, { fontScale: 0.85 }),
          enter: { x: 0, y: -0.9 },
          camera: { travel: 0.09, zoomStart: 1.04, zoomEnd: 1.12 },
          mood: 'neutral',
      },
      'pier-row': {
          region: temperaRegion(0.5, 0.4, 0.76, 0.14, { fontScale: 0.82 }),
          enter: { x: 1.1, y: 0 },
          camera: { travel: 0.13, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'neutral',
      },
      'revetment': {
          region: temperaRegion(0.46, 0.3, 0.6, 0.2, { fontScale: 0.86 }),
          enter: { x: -1, y: -0.6 },
          camera: { travel: 0.12, zoomStart: 1.05, zoomEnd: 1.13 },
          mood: 'neutral',
      },
      'tower-crop': {
          region: temperaRegion(0.28, 0.5, 0.44, 0.24, { align: 'left', fontScale: 0.74 }),
          enter: { x: -0.8, y: 0.3 },
          camera: { travel: 0.06, zoomStart: 1.02, zoomEnd: 1.09 },
          mood: 'quiet',
      },
      'lintel': {
          region: temperaRegion(0.5, 0.5, 0.76, 0.16, { fontScale: 0.9 }),
          enter: { x: -1.1, y: 0 },
          camera: { travel: 0.1, zoomStart: 1.02, zoomEnd: 1.08 },
          mood: 'quiet',
      },
      'rubble-fan': {
          region: temperaRegion(0.56, 0.4, 0.5, 0.22, { fontScale: 0.84 }),
          enter: { x: 1.2, y: -0.5 },
          camera: { travel: 0.13, zoomStart: 1.07, zoomEnd: 1.16 },
          mood: 'loud',
      },
      'gnomon': {
          region: temperaRegion(0.66, 0.34, 0.46, 0.2, { fontScale: 0.78 }),
          enter: { x: 0.9, y: -0.4 },
          camera: { travel: 0.07, zoomStart: 1.03, zoomEnd: 1.1 },
          mood: 'quiet',
      },
      // Monogatari interstitials: one flat field and the type *is* the picture, so the regions
      // are large and the type runs big.
      'monogatari-card': {
          region: temperaRegion(0.5, 0.5, 0.78, 0.5, { fontScale: 1.15 }),
          enter: { x: 0, y: 0.7 },
          camera: { travel: 0.03, zoomStart: 1.02, zoomEnd: 1.07 },
          mood: 'quiet',
          sharedDecor: false,
      },
      'monogatari-rule': {
          region: temperaRegion(0.5, 0.46, 0.76, 0.4, { fontScale: 1.05 }),
          enter: { x: 0.6, y: 0 },
          camera: { travel: 0.04, zoomStart: 1.03, zoomEnd: 1.09 },
          mood: 'quiet',
          sharedDecor: false,
      },
      'monogatari-edge': {
          region: temperaRegion(0.52, 0.5, 0.72, 0.46, { align: 'left', fontScale: 1.05 }),
          enter: { x: -0.8, y: 0 },
          camera: { travel: 0.05, zoomStart: 1.02, zoomEnd: 1.08 },
          mood: 'neutral',
          sharedDecor: false,
      },
      'monogatari-stack': {
          region: temperaRegion(0.5, 0.5, 0.44, 0.62, { fontScale: 1 }),
          enter: { x: 0, y: 0.9 },
          camera: { travel: 0.04, zoomStart: 1.05, zoomEnd: 1.12 },
          mood: 'quiet',
          sharedDecor: false,
      },
      'monogatari-flash': {
          region: temperaRegion(0.5, 0.5, 0.82, 0.44, { fontScale: 1.3 }),
          enter: { x: 0, y: 0.5 },
          camera: { travel: 0.02, zoomStart: 1.08, zoomEnd: 1.01 },
          mood: 'loud',
          sharedDecor: false,
      },
  };

  /* ============================== 2. profile 解析 ============================== */

  var TEMPERA_DEFAULT_SHOT_KIND = 'duo-split';

  function temperaResolveShotProfile(kind) {
    return TEMPERA_SHOT_PROFILES[kind] || TEMPERA_SHOT_PROFILES[TEMPERA_DEFAULT_SHOT_KIND];
  }

  /* 某种段落性格允许切到哪些构图。 */
  function temperaResolveShotCandidates(moods) {
    var candidates = [];
    for (var index = 0; index < TEMPERA_SHOT_KINDS.length; index += 1) {
      var kind = TEMPERA_SHOT_KINDS[index];
      if (moods.indexOf(temperaResolveShotProfile(kind).mood) >= 0) candidates.push(kind);
    }
    return candidates.length > 0 ? candidates : TEMPERA_SHOT_KINDS;
  }

  /* ============================== 3. 字素时间轴 ============================== */
  /* graphemeTiming.ts：把词级时序无损映射回整行（含词间空隙与标点）。 */

  /* 等分时长，最后一格吃满 endTime。 */
  function temperaBuildEvenGraphemeTimings(text, startTime, endTime, wordIndex) {
    var graphemes = foliaSplitGraphemes(text);
    if (graphemes.length === 0) return [];
    var duration = Math.max(endTime - startTime, 0);
    var unit = duration / graphemes.length;
    var out = [];
    for (var i = 0; i < graphemes.length; i += 1) {
      var item = {
        char: graphemes[i],
        startTime: startTime + unit * i,
        endTime: i === graphemes.length - 1 ? endTime : startTime + unit * (i + 1)
      };
      if (typeof wordIndex === 'number') item.wordIndex = wordIndex;
      out.push(item);
    }
    return out;
  }

  /* 有音节就按音节等分，否则整词等分。 */
  function temperaBuildWordGraphemeTimings(word, wordIndex) {
    if (!word) return [];
    if (word.syllables && word.syllables.length) {
      var out = [];
      for (var i = 0; i < word.syllables.length; i += 1) {
        var syl = word.syllables[i];
        var timings = temperaBuildEvenGraphemeTimings(syl.text, syl.startTime, syl.endTime);
        for (var k = 0; k < timings.length; k += 1) out.push(timings[k]);
      }
      return out;
    }
    return temperaBuildEvenGraphemeTimings(word.text, word.startTime, word.endTime, wordIndex);
  }

  /* 在 source 里从 fromIndex 起找 target 序列。 */
  function temperaFindGraphemeSequence(source, target, fromIndex) {
    if (target.length === 0) return fromIndex;
    for (var index = fromIndex; index <= source.length - target.length; index += 1) {
      var matched = true;
      for (var t = 0; t < target.length; t += 1) {
        if (source[index + t] !== target[t]) { matched = false; break; }
      }
      if (matched) return index;
    }
    return -1;
  }

  function temperaBuildLineGraphemeTimeline(line) {
    var lineGraphemes = foliaSplitGraphemes(line ? line.fullText : '');
    if (lineGraphemes.length === 0) return [];
    var words = (line && line.words) ? line.words : [];
    if (words.length === 0) {
      return temperaBuildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }

    var timeline = new Array(lineGraphemes.length);
    var cursor = 0;
    var lastResolvedTime = line.startTime;

    for (var w = 0; w < words.length; w += 1) {
      var word = words[w];
      var wordGraphemes = foliaSplitGraphemes(word.text);
      if (wordGraphemes.length === 0) continue;

      var matchedStart = temperaFindGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

      /* 词间空隙：钉到该词的起点（零长度）。 */
      for (var gap = cursor; gap < start; gap += 1) {
        timeline[gap] = { char: lineGraphemes[gap], startTime: word.startTime, endTime: word.startTime };
      }

      var wordTimings = temperaBuildWordGraphemeTimings(word, w);
      for (var local = 0; local < end - start; local += 1) {
        var timing = wordTimings[local]
          || temperaBuildEvenGraphemeTimings(wordGraphemes[local] || '', word.startTime, word.endTime, w)[0];
        if (!timing) continue;
        var entry = {
          char: lineGraphemes[start + local],
          startTime: timing.startTime,
          endTime: timing.endTime
        };
        if (typeof timing.wordIndex === 'number') entry.wordIndex = timing.wordIndex;
        timeline[start + local] = entry;
        if (timing.endTime > lastResolvedTime) lastResolvedTime = timing.endTime;
      }
      if (end > cursor) cursor = end;
    }

    /* 没被任何词覆盖的字素：零长度钉在已解析的尾巴上。 */
    for (var i = 0; i < lineGraphemes.length; i += 1) {
      if (timeline[i]) continue;
      timeline[i] = { char: lineGraphemes[i], startTime: lastResolvedTime, endTime: lastResolvedTime };
    }
    return timeline;
  }

  /* ============================== 4. 语义分段 ============================== */

  var TEMPERA_PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]+$/u;

  /* 无损词级分段：显示偏移 → parser 字素时序；粘连标点并入前一段。 */
  function temperaBuildSegments(line) {
    if (!line.fullText) return [];
    var timeline = temperaBuildLineGraphemeTimeline(line);
    var cursor = 0;
    var ranges = [];
    var graphemeList = foliaSplitGraphemes(line.fullText);
    for (var g = 0; g < graphemeList.length; g += 1) {
      ranges.push({ start: cursor, end: cursor + graphemeList[g].length });
      cursor += graphemeList[g].length;
    }

    var parts = foliaSegmentLyricWords(line);
    var segments = [];
    for (var index = 0; index < parts.length; index += 1) {
      var startOffset = parts[index].index;
      var endOffset = index + 1 < parts.length ? parts[index + 1].index : line.fullText.length;
      var indices = [];
      for (var r = 0; r < ranges.length; r += 1) {
        if (ranges[r].end > startOffset && ranges[r].start < endOffset) indices.push(r);
      }
      var graphemes = [];
      for (var h = 0; h < indices.length; h += 1) {
        if (timeline[indices[h]]) graphemes.push(timeline[indices[h]]);
      }
      segments.push({
        text: line.fullText.slice(startOffset, endOffset),
        startOffset: startOffset,
        endOffset: endOffset,
        graphemes: graphemes,
        startTime: graphemes.length ? graphemes[0].startTime : line.startTime,
        endTime: graphemes.length ? graphemes[graphemes.length - 1].endTime : line.endTime,
        isWordLike: parts[index].isWordLike
      });
    }

    var sticky = [];
    for (var s = 0; s < segments.length; s += 1) {
      var segment = segments[s];
      var previous = sticky.length ? sticky[sticky.length - 1] : null;
      if (previous && !segment.isWordLike && !/^\s+$/u.test(segment.text)) {
        previous.text += segment.text;
        previous.endOffset = segment.endOffset;
        /* 标点自己没有时序：parser 的词从不覆盖它，字素时间轴把它零长度钉在**下一个词**的起点。
         * 直接并进来而不重新计时，逗号就会跟着它后面那个词一起到，
         * 还会把本段的 endTime 拖到那个词的起点。只有「没有时序」的那些才改；
         * parser 真正覆盖过的标点保留自己的时序。 */
        var tail = previous.endTime;
        var mergedMax = previous.endTime;
        for (var m = 0; m < segment.graphemes.length; m += 1) {
          var grapheme = segment.graphemes[m];
          var normalized = grapheme.endTime > grapheme.startTime
            ? grapheme
            : { char: grapheme.char, startTime: tail, endTime: tail, wordIndex: grapheme.wordIndex };
          previous.graphemes.push(normalized);
          if (normalized.endTime > mergedMax) mergedMax = normalized.endTime;
        }
        previous.endTime = Math.max(previous.endTime, mergedMax);
      } else {
        sticky.push({
          text: segment.text,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          graphemes: segment.graphemes.slice(),
          startTime: segment.startTime,
          endTime: segment.endTime,
          isWordLike: segment.isWordLike
        });
      }
    }
    return sticky;
  }

  /* ============================== 5. 节目编译 ============================== */

  function temperaClamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function temperaMedian(values) {
    if (values.length === 0) return 0.5;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      var low = sorted[middle - 1] === undefined ? sorted[middle] : sorted[middle - 1];
      return (low + sorted[middle]) / 2;
    }
    return sorted[middle];
  }

  /* 间隔阈值 = 中位间隔 × 2.5，夹在 [1.25, 3.5]。 */
  function temperaResolveParagraphGapThreshold(lines) {
    var gaps = [];
    for (var index = 1; index < lines.length; index += 1) {
      var gap = lines[index].startTime - Math.min(
        foliaGetLineRenderEndTime(lines[index - 1]), lines[index].startTime
      );
      if (gap > 0) gaps.push(gap);
    }
    return temperaClamp(temperaMedian(gaps) * 2.5, 1.25, 3.5);
  }

  function temperaMetadataChanged(previous, next) {
    return (previous.blockIndex !== undefined && next.blockIndex !== undefined
      && previous.blockIndex !== next.blockIndex)
      || (previous.songPart !== undefined && next.songPart !== undefined
        && previous.songPart !== next.songPart);
  }

  /* 过长草稿再切：> 6 行、或跨度 > 18s。切点取最大间隔。 */
  function temperaSplitOversizedDraft(draft) {
    var output = [];
    var remaining = draft.lines;
    var boundary = draft.boundary;
    var loopGuard = 0;

    function span() {
      if (remaining.length < 2) return 0;
      return remaining[remaining.length - 1].renderEndTime - remaining[0].line.startTime;
    }

    while (remaining.length > 6 || (remaining.length > 1 && span() > 18)) {
      loopGuard += 1;
      if (loopGuard > 1000) {
        /* 无限循环保护：照 Folia 记一条错误后跳出。 */
        if (typeof console !== 'undefined' && console.error) {
          console.error('splitOversizedDraft: Infinite loop detected, breaking');
        }
        break;
      }
      var candidates = [];
      for (var offset = 2; offset < remaining.length - 1; offset += 1) {
        candidates.push({
          splitIndex: offset,
          gap: remaining[offset].line.startTime - remaining[offset - 1].renderEndTime
        });
      }
      var valid = candidates.filter(function (candidate) { return !isNaN(candidate.gap); });
      valid.sort(function (a, b) { return b.gap - a.gap; });
      var rawSplitIndex = valid.length ? valid[0].splitIndex : Math.min(4, remaining.length - 1);
      var splitIndex = Math.max(1, rawSplitIndex);

      output.push({ lines: remaining.slice(0, splitIndex), boundary: boundary });
      remaining = remaining.slice(splitIndex);
      boundary = output[output.length - 1].lines.length >= 6 ? 'line-cap' : 'duration-cap';
    }
    output.push({ lines: remaining, boundary: boundary });
    return output;
  }

  function temperaClassifyParagraph(lines, index, total) {
    var i;
    for (i = 0; i < lines.length; i += 1) {
      if (lines[i].line.isChorus || /chorus|副歌/i.test(lines[i].line.songPart || '')) return 'chorus';
    }
    for (i = 0; i < lines.length; i += 1) {
      if (/bridge|break|間奏|ブリッジ/i.test(lines[i].line.songPart || '')) return 'break';
    }
    if (index === total - 1) return 'outro';
    var duration = lines[lines.length - 1].renderEndTime - lines[0].line.startTime;
    var segmentCount = 0;
    var punctuationCount = 0;
    for (i = 0; i < lines.length; i += 1) {
      var segs = lines[i].segments;
      for (var s = 0; s < segs.length; s += 1) if (segs[s].isWordLike) segmentCount += 1;
      var marks = lines[i].line.fullText.match(/[!?！？…]/g);
      if (marks) punctuationCount += marks.length;
    }
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
  }

  function temperaIsRenderableSegment(segment) {
    return segment.text.trim().length > 0 && segment.graphemes.length > 0;
  }

  /* 把行切成 shot 用的块：默认满 2..4 个词或 ~2.2s 就收；整行模式一行一块。 */
  function temperaBuildShotChunks(lines, seed, paragraphIndex, wholeLineLyrics) {
    var chunks = [];
    for (var l = 0; l < lines.length; l += 1) {
      var line = lines[l];
      var usable = [];
      for (var index = 0; index < line.segments.length; index += 1) {
        if (temperaIsRenderableSegment(line.segments[index])) {
          usable.push({ segment: line.segments[index], index: index });
        }
      }
      if (usable.length === 0) continue;

      if (wholeLineLyrics) {
        var first = usable[0];
        var last = usable[usable.length - 1];
        chunks.push({
          lineIndex: line.sourceIndex,
          segmentStart: first.index,
          segmentEnd: last.index + 1,
          startTime: first.segment.startTime,
          endTime: Math.max(last.segment.endTime, first.segment.startTime + 0.2),
          lyricEndTime: Math.max(last.segment.endTime, first.segment.startTime + 0.2)
        });
        continue;
      }

      var segmentStart = usable[0].index;
      var startTime = usable[0].segment.startTime;
      var words = 0;
      for (var order = 0; order < usable.length; order += 1) {
        var entry = usable[order];
        words += 1;
        var chunkSeed = temperaHashSeed(
          seed + ':' + paragraphIndex + ':' + line.sourceIndex + ':' + chunks.length
        );
        var target = 2 + Math.floor(temperaHash01(chunkSeed, 1, 179) * 3);
        var spent = entry.segment.endTime - startTime;
        var isLast = order === usable.length - 1;
        if (!isLast && words < target && spent < 2.2) continue;

        chunks.push({
          lineIndex: line.sourceIndex,
          segmentStart: segmentStart,
          segmentEnd: entry.index + 1,
          startTime: startTime,
          endTime: Math.max(entry.segment.endTime, startTime + 0.2),
          lyricEndTime: Math.max(entry.segment.endTime, startTime + 0.2)
        });
        var next = usable[order + 1];
        if (next) {
          segmentStart = next.index;
          startTime = next.segment.startTime;
          words = 0;
        }
      }
    }

    /* 铺满时间轴：每个 shot 跑到下一个开场为止，运行时的「最后一个已开始的 shot」不会落进空洞。
     * `lyricEndTime` 故意不铺 —— 它是这一块最后一个字素停下的时刻，入场错峰按它排。 */
    return chunks.map(function (chunk, index) {
      var nextChunk = chunks[index + 1];
      return {
        lineIndex: chunk.lineIndex,
        segmentStart: chunk.segmentStart,
        segmentEnd: chunk.segmentEnd,
        startTime: chunk.startTime,
        lyricEndTime: chunk.lyricEndTime,
        endTime: Math.max(chunk.startTime + 0.2, nextChunk ? nextChunk.startTime : chunk.endTime)
      };
    });
  }

  /* 方向永远来自 flowAngle；profile 只决定沿它走多远、变焦怎么走。 */
  function temperaBuildCameraKeys(kind, seed, flowAngle) {
    var jitterX = (temperaHash01(seed, 1, 11) - 0.5) * 0.02;
    var jitterY = (temperaHash01(seed, 2, 23) - 0.5) * 0.02;
    var jitterZoom = temperaHash01(seed, 3, 37) * 0.025;
    var jitterRotation = (temperaHash01(seed, 4, 51) - 0.5) * 0.012;
    var camera = temperaResolveShotProfile(kind).camera;
    var travelX = Math.cos(flowAngle) * camera.travel;
    var travelY = Math.sin(flowAngle) * camera.travel;
    return {
      start: {
        x: -travelX / 2 + jitterX,
        y: -travelY / 2 + jitterY,
        zoom: camera.zoomStart + jitterZoom,
        rotation: jitterRotation
      },
      end: {
        x: travelX / 2 + jitterX,
        y: travelY / 2 + jitterY,
        zoom: camera.zoomEnd + jitterZoom,
        rotation: -jitterRotation
      }
    };
  }

  /* 稀疏构图里漂在边距的碎字：取自本 shot **没在显示**的歌词，
   * 这样碎片永远属于这首歌，又不会和屏幕上已有的字重复。池子空就没有碎片。 */
  function temperaBuildDecorFragments(pool, count, seed) {
    var all = Array.from(pool);
    var chars = all.filter(function (char) {
      return char.trim().length > 0 && !TEMPERA_PUNCTUATION_ONLY.test(char);
    });
    if (chars.length === 0 || count <= 0) return [];
    var out = [];
    for (var index = 0; index < count; index += 1) {
      var char = chars[Math.floor(temperaHash01(seed, index, 13) * chars.length) % chars.length];
      var onLeft = temperaHash01(seed, index, 29) > 0.5;
      var edge = 0.03 + temperaHash01(seed, index, 41) * 0.13;
      out.push({
        char: char,
        x: onLeft ? edge : 1 - edge,
        y: 0.08 + temperaHash01(seed, index, 53) * 0.84,
        rotation: (temperaHash01(seed, index, 67) - 0.5) * 0.5,
        scale: 0.26 + temperaHash01(seed, index, 71) * 0.2
      });
    }
    return out;
  }

  /* 背后的超大装饰词（海报水印式）。喧闹构图跳过 —— 它们已经有主导形。 */
  function temperaBuildDecorWatermark(pool, seed, allowed) {
    var words = pool.map(function (word) { return word.trim(); })
      .filter(function (word) { return word.length > 0 && word.length <= 12; });
    if (!allowed || words.length === 0 || temperaHash01(seed, 4, 107) > 0.62) return null;
    return {
      text: words[Math.floor(temperaHash01(seed, 5, 109) * words.length) % words.length],
      x: 0.28 + temperaHash01(seed, 6, 113) * 0.44,
      y: 0.26 + temperaHash01(seed, 7, 127) * 0.48,
      rotation: (temperaHash01(seed, 8, 131) - 0.5) * 0.5,
      scale: 2.6 + temperaHash01(seed, 9, 137) * 1.9
    };
  }

  /* 一个 shot 的网点装饰，全在编译期定死：母题、网纹角、横线数、边距碎字都由 seed 推出。 */
  function temperaBuildDecorSpec(
    paragraphKind, shotKind, seedKey, fragmentPool, watermarkPool, previousMotif
  ) {
    var seed = temperaHashSeed(seedKey);
    var motif = temperaChoose(TEMPERA_DECOR_MOTIFS, seedKey, previousMotif);
    var profile = temperaResolveShotProfile(shotKind);
    var sparse = profile.mood === 'quiet' || paragraphKind === 'break' || paragraphKind === 'outro';
    return {
      motif: motif,
      /* 只给浅斜角；后处理颗粒落上去以后，陡网纹会读成噪点。 */
      hatchAngle: (temperaHash01(seed, 1, 83) - 0.5) * (Math.PI / 2),
      crossCount: 1 + Math.floor(temperaHash01(seed, 2, 89) * 3),
      scribbleSeed: temperaMixSeed(seed, 97),
      fragments: sparse
        ? temperaBuildDecorFragments(
          fragmentPool, 3 + Math.floor(temperaHash01(seed, 3, 101) * 3), seed
        )
        : [],
      watermark: temperaBuildDecorWatermark(watermarkPool, seed, profile.mood !== 'loud')
    };
  }

  /* 竖直是凝彩的主轴：构图靠互相滑过来交接，竖直方向的流动才读成「穿过场景」而不是横向幻灯片。
   * 每个 shot 转一点，再往轴回拉。 */
  function temperaResolveFlowAngle(previous, seed) {
    if (previous === null) {
      var sign = temperaHash01(seed, 6, 71) > 0.5 ? 1 : -1;
      return sign * Math.PI / 2 + (temperaHash01(seed, 8, 79) - 0.5) * 0.4;
    }
    var axis = (Math.sin(previous) >= 0 ? 1 : -1) * Math.PI / 2;
    return previous + (axis - previous) * 0.3 + (temperaHash01(seed, 7, 73) - 0.5) * 0.5;
  }

  function temperaBuildShots(
    lines, songLines, kind, paragraphIndex, seed,
    previousKind, previousMotif, previousFlow, wholeLineLyrics
  ) {
    var lastKind = previousKind;
    var lastMotif = previousMotif;
    var lastFlow = previousFlow;
    var paragraphEnd = lines.length ? lines[lines.length - 1].renderEndTime : 0;
    var chunks = temperaBuildShotChunks(lines, seed, paragraphIndex, wholeLineLyrics);
    var byIndex = new Map();
    for (var l = 0; l < lines.length; l += 1) byIndex.set(lines[l].sourceIndex, lines[l]);

    var shots = [];
    for (var shotIndex = 0; shotIndex < chunks.length; shotIndex += 1) {
      var chunk = chunks[shotIndex];
      var line = byIndex.get(chunk.lineIndex);
      var sliceSegments = line ? line.segments.slice(chunk.segmentStart, chunk.segmentEnd) : [];
      var sliceText = '';
      var wordCount = 0;
      for (var s = 0; s < sliceSegments.length; s += 1) {
        sliceText += sliceSegments[s].text;
        if (sliceSegments[s].isWordLike) wordCount += 1;
      }
      /* 呼吸段落读成稀疏构图；副歌从不低声。 */
      var sparse = kind === 'breath' || (kind !== 'chorus' && wordCount <= 2);
      var moods = sparse
        ? ['quiet']
        : (kind === 'chorus' ? ['neutral', 'loud'] : ['quiet', 'neutral', 'loud']);
      var shotKind = temperaChoose(
        temperaResolveShotCandidates(moods),
        seed + ':' + paragraphIndex + ':' + shotIndex + ':' + sliceText,
        lastKind
      );
      lastKind = shotKind;

      var cameraSeed = temperaHashSeed(seed + ':' + paragraphIndex + ':' + shotIndex + ':camera');
      var flowAngle = temperaResolveFlowAngle(lastFlow, cameraSeed);
      lastFlow = flowAngle;
      var keys = temperaBuildCameraKeys(shotKind, cameraSeed, flowAngle);

      /* 边距碎片与水印取自本段的其余部分，绝不取本 shot 正在显示的词。
       * 一行一段且 shot 覆盖整行（整行模式的常态）时没有剩余 → 借用整首歌的其余片段；
       * 连那个也空就让池子空着，装饰自然丢掉碎片与水印。 */
      var outsideSlice = [];
      for (var oi = 0; oi < lines.length; oi += 1) {
        var item = lines[oi];
        if (item.sourceIndex === chunk.lineIndex) {
          for (var si = 0; si < item.segments.length; si += 1) {
            if (si < chunk.segmentStart || si >= chunk.segmentEnd) outsideSlice.push(item.segments[si]);
          }
        } else {
          for (var sj = 0; sj < item.segments.length; sj += 1) outsideSlice.push(item.segments[sj]);
        }
      }
      var decorPool = outsideSlice;
      if (decorPool.length === 0) {
        decorPool = [];
        for (var di = 0; di < songLines.length; di += 1) {
          if (songLines[di].sourceIndex === chunk.lineIndex) continue;
          for (var dj = 0; dj < songLines[di].segments.length; dj += 1) {
            decorPool.push(songLines[di].segments[dj]);
          }
        }
      }
      var fragmentPool = '';
      var watermarkPool = [];
      for (var fp = 0; fp < decorPool.length; fp += 1) {
        fragmentPool += decorPool[fp].text;
        if (decorPool[fp].isWordLike) watermarkPool.push(decorPool[fp].text);
      }

      var decor = temperaBuildDecorSpec(
        kind, shotKind,
        seed + ':' + paragraphIndex + ':' + shotIndex + ':decor',
        fragmentPool, watermarkPool, lastMotif
      );
      lastMotif = decor.motif;

      shots.push({
        id: 'p' + paragraphIndex + '-s' + shotIndex,
        kind: shotKind,
        startTime: chunk.startTime,
        /* 收尾 shot 撑到段落自己的 render 尾巴。 */
        endTime: shotIndex === chunks.length - 1
          ? Math.max(chunk.endTime, paragraphEnd)
          : chunk.endTime,
        lyricEndTime: chunk.lyricEndTime,
        slices: [{
          lineIndex: chunk.lineIndex,
          segmentStart: chunk.segmentStart,
          segmentEnd: chunk.segmentEnd
        }],
        isBridge: false,
        camera: keys.start,
        cameraEnd: keys.end,
        flowAngle: flowAngle,
        decor: decor
      });
    }
    return shots;
  }

  /* 短于这个的空档由段落转场本身覆盖。 */
  var TEMPERA_BRIDGE_MIN_GAP = 1.2;
  var TEMPERA_BRIDGE_MAX_LENGTH = 5;

  /* 给乐器空档补无词 shot：走同一套交接、相机、装饰机器，
   * 长空档就一直动，而不是冻在最后一句上；远端那个段落转场也有东西可带。 */
  function temperaBuildBridgeShots(
    paragraphKind, paragraphIndex, seed, fragmentPool, gapStart, gapEnd,
    previousKind, previousMotif, previousFlow
  ) {
    var gap = gapEnd - gapStart;
    if (gap < TEMPERA_BRIDGE_MIN_GAP) return [];
    var count = Math.min(3, Math.max(1, Math.ceil(gap / TEMPERA_BRIDGE_MAX_LENGTH)));
    var step = gap / count;
    var lastKind = previousKind;
    var lastMotif = previousMotif;
    var lastFlow = previousFlow;
    var shots = [];

    for (var index = 0; index < count; index += 1) {
      /* 器乐拍永远不是整首歌最响的地方。 */
      var shotKind = temperaChoose(
        temperaResolveShotCandidates(['quiet', 'neutral']),
        seed + ':' + paragraphIndex + ':bridge' + index,
        lastKind
      );
      lastKind = shotKind;
      var cameraSeed = temperaHashSeed(seed + ':' + paragraphIndex + ':bridge' + index + ':camera');
      var flowAngle = temperaResolveFlowAngle(lastFlow, cameraSeed);
      lastFlow = flowAngle;
      var keys = temperaBuildCameraKeys(shotKind, cameraSeed, flowAngle);
      var decor = temperaBuildDecorSpec(
        paragraphKind, shotKind,
        seed + ':' + paragraphIndex + ':bridge' + index + ':decor',
        fragmentPool, [], lastMotif
      );
      lastMotif = decor.motif;
      shots.push({
        id: 'p' + paragraphIndex + '-b' + index,
        kind: shotKind,
        startTime: gapStart + step * index,
        endTime: gapStart + step * (index + 1),
        /* bridge 没有词，图形按整个空档排。 */
        lyricEndTime: gapStart + step * (index + 1),
        slices: [],
        isBridge: true,
        camera: keys.start,
        cameraEnd: keys.end,
        flowAngle: flowAngle,
        decor: decor
      });
    }
    return shots;
  }

  function temperaCompileProgram(lines, seed, options) {
    var sourceLines = lines || [];
    var seedValue = seed === undefined || seed === null ? 'tempera' : seed;
    var opts = options || {};
    var wholeLineLyrics = opts.wholeLineLyrics === true;

    var compiled = sourceLines.map(function (line, sourceIndex) {
      var nextStart = sourceIndex + 1 < sourceLines.length
        ? sourceLines[sourceIndex + 1].startTime
        : Number.POSITIVE_INFINITY;
      return {
        sourceIndex: sourceIndex,
        line: line,
        /* 视觉尾巴可以超出谱面时序，但绝不越进下一行。 */
        renderEndTime: Math.max(
          line.startTime,
          Math.min(foliaGetLineRenderEndTime(line), nextStart)
        ),
        segments: temperaBuildSegments(line)
      };
    });

    var paragraphGapThreshold = temperaResolveParagraphGapThreshold(sourceLines);
    var drafts = [];
    var current = { lines: [], boundary: 'song-start' };

    for (var index = 0; index < compiled.length; index += 1) {
      var line = compiled[index];
      var previous = index > 0 ? compiled[index - 1] : null;
      var gap = previous ? line.line.startTime - previous.renderEndTime : 0;
      var boundary = null;
      if (previous && temperaMetadataChanged(previous.line, line.line)) boundary = 'metadata';
      else if (previous && gap >= paragraphGapThreshold) boundary = 'time-gap';

      if (boundary && current.lines.length > 0) {
        var split = temperaSplitOversizedDraft(current);
        for (var sp = 0; sp < split.length; sp += 1) drafts.push(split[sp]);
        current = { lines: [], boundary: boundary };
      }
      current.lines.push(line);
    }
    if (current.lines.length > 0) {
      var tail = temperaSplitOversizedDraft(current);
      for (var tp = 0; tp < tail.length; tp += 1) drafts.push(tail[tp]);
    }

    var resolvedSeed = String(seedValue);
    var previousShot = null;
    var previousMotif = null;
    var previousFlow = null;
    var previousTransition = null;
    var paragraphs = [];

    for (var d = 0; d < drafts.length; d += 1) {
      var draft = drafts[d];
      var kind = temperaClassifyParagraph(draft.lines, d, drafts.length);
      var lyricShots = temperaBuildShots(
        draft.lines, compiled, kind, d, resolvedSeed,
        previousShot, previousMotif, previousFlow, wholeLineLyrics
      );
      var lastLyric = lyricShots.length ? lyricShots[lyricShots.length - 1] : null;
      if (lastLyric) {
        previousShot = lastLyric.kind;
        previousMotif = lastLyric.decor.motif;
        previousFlow = lastLyric.flowAngle;
      }

      var nextDraft = drafts[d + 1];
      var endTime = draft.lines[draft.lines.length - 1].renderEndTime;
      var nextStart = nextDraft ? nextDraft.lines[0].line.startTime : endTime;
      var gapToNext = nextDraft ? nextStart - endTime : 0;

      /* 这一段的乐器空档变成它自己的无词 shot。 */
      var bridgeShots = nextDraft
        ? temperaBuildBridgeShots(
          kind, d, resolvedSeed,
          draft.lines.map(function (item) { return item.line.fullText; }).join(''),
          endTime, nextStart,
          previousShot, previousMotif, previousFlow
        )
        : [];

      var shots = lyricShots.concat(bridgeShots);
      if (shots.length) {
        var lastShot = shots[shots.length - 1];
        previousShot = lastShot.kind;
        previousMotif = lastShot.decor.motif;
        previousFlow = lastShot.flowAngle;
      }

      var transitionKind = nextDraft
        ? temperaChoose(TEMPERA_TRANSITION_KINDS, resolvedSeed + ':' + d + ':transition', previousTransition)
        : null;
      if (transitionKind) previousTransition = transitionKind;

      /* 够长让图形带住这一刀，但吃进上一段尾巴的时间永远不超过 ~0.3s。 */
      var transitionDuration = nextDraft
        ? Math.min(1, Math.max(0.35, Math.max(gapToNext, 0) + 0.3))
        : 0;
      var transitionEndTime = nextDraft ? nextStart : endTime;

      paragraphs.push({
        id: 'tempera-p' + d,
        kind: kind,
        boundary: draft.boundary,
        startTime: draft.lines[0].line.startTime,
        endTime: endTime,
        lines: draft.lines,
        shots: shots,
        transitionOut: transitionKind ? {
          kind: transitionKind,
          startTime: Math.max(draft.lines[0].line.startTime, transitionEndTime - transitionDuration),
          endTime: transitionEndTime
        } : null
      });
    }

    /* 下一段的开场构图在上一段还在转出时就开始建。
     * 少了这一步，落在歌词空隙里的边界会让进来的场景只有纸底 ——
     * 平移类转场就滑进一个空壳里。字素时序不动：只挪 shot 自己的时钟，
     * 字还是恰好在被唱到时落位。 */
    for (var p = 0; p < paragraphs.length; p += 1) {
      var incoming = paragraphs[p].shots[0];
      var prevParagraph = paragraphs[p - 1];
      var transition = prevParagraph ? prevParagraph.transitionOut : null;
      if (!incoming || !transition || transition.kind === 'block-wipe') continue;
      incoming.startTime = Math.min(
        incoming.startTime,
        Math.max(transition.startTime, prevParagraph.endTime)
      );
    }

    return {
      version: 1,
      seed: resolvedSeed,
      paragraphGapThreshold: paragraphGapThreshold,
      paragraphs: paragraphs
    };
  }

  function temperaFindParagraphIndexAtTime(program, time) {
    for (var index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index;
    }
    return 0;
  }

  window.foliaTemperaProgram = {
    SHOT_KINDS: TEMPERA_SHOT_KINDS,
    TRANSITION_KINDS: TEMPERA_TRANSITION_KINDS,
    DECOR_MOTIFS: TEMPERA_DECOR_MOTIFS,
    SHOT_PROFILES: TEMPERA_SHOT_PROFILES,
    resolveShotProfile: temperaResolveShotProfile,
    resolveShotCandidates: temperaResolveShotCandidates,
    buildEvenGraphemeTimings: temperaBuildEvenGraphemeTimings,
    buildWordGraphemeTimings: temperaBuildWordGraphemeTimings,
    findGraphemeSequence: temperaFindGraphemeSequence,
    buildLineGraphemeTimeline: temperaBuildLineGraphemeTimeline,
    buildSegments: temperaBuildSegments,
    resolveParagraphGapThreshold: temperaResolveParagraphGapThreshold,
    splitOversizedDraft: temperaSplitOversizedDraft,
    classifyParagraph: temperaClassifyParagraph,
    buildDecorFragments: temperaBuildDecorFragments,
    buildDecorWatermark: temperaBuildDecorWatermark,
    buildDecorSpec: temperaBuildDecorSpec,
    resolveFlowAngle: temperaResolveFlowAngle,
    buildCameraKeys: temperaBuildCameraKeys,
    buildShotChunks: temperaBuildShotChunks,
    buildShots: temperaBuildShots,
    buildBridgeShots: temperaBuildBridgeShots,
    compileProgram: temperaCompileProgram,
    findParagraphIndexAtTime: temperaFindParagraphIndexAtTime
  };
})();
