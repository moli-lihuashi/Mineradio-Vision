/* Folia 世界 — 歌词样式：隐喻（metaphor）· 墨场绘制层
 *
 * 移植自 Folia 0.8.x（AGPL-3.0，chthollyphile/folia-major）的
 * src/components/visualizer/metaphor/metaphorPalette.ts + metaphorShaders.ts + metaphorShapes.ts。
 * 上游原作者把这套样式描述为：字形与装饰都是无定形的墨——融球和字写进同一张场里一起切阈值，
 * 所以它们会融在一起又分开；再经过流场、半调网点和粗砂纸颗粒。画面靠「剪辑」推进，不靠补间。
 *
 * 与上游的差异（都是输入能力差异，公式一字未改）：
 *   1) 上游用多目标渲染（第二张图存强调色的墨是什么颜色，供关键字着色）；本项目主题没有
 *      wordColors（恒为 []），所以去掉第二张目标，显影时直接用主题强调色。少一次 MRT，
 *      也不再需要 WebGL2 的 drawBuffers —— 但 fwidth 仍要求 WebGL2，模式仍标 needsWebGL2。
 *   2) 字形顶点里上游用 gl_VertexID 推四个角（WebGL2 专属），这里换成 aCorner 顶点属性，
 *      由 CPU 写死（-1/-1、1/-1、1/1、-1/1），行为等价。
 *   3) 字形片元里的 textureLod(...,0.0) 换成 texture2D：GLSL1 下没有 textureLod，
 *      而图集本来就带 mipmap，显影这一遍的取样差异看不出来。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var F = window.FoliaMetaphor = window.FoliaMetaphor || {};

  /* ============================== 1. 配色（metaphorPalette.ts） ============================== */

  var FALLBACK_PALETTE = { paper: [0.06, 0.06, 0.07], ink: [0.95, 0.94, 0.9], accent: [0.9, 0.3, 0.2], tone: [0.5, 0.5, 0.52] };

  function readColor(color, fallback) {
    try {
      var hex = String(color || '').trim();
      var match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
      if (!match) return fallback;
      var raw = match[1];
      if (raw.length === 3) raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
      return [parseInt(raw.slice(0, 2), 16) / 255, parseInt(raw.slice(2, 4), 16) / 255, parseInt(raw.slice(4, 6), 16) / 255];
    } catch (_) { return fallback; }
  }

  function luma(color) { return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]; }
  function mixColor(from, to, amount) {
    return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
  }
  function colorDistance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

  /* 往墨那边拉，直到和纸拉开 min 这么远（最多拉到七成）。 */
  function awayFromPaper(color, paper, ink, min) {
    var out = color;
    for (var amount = 0.2; colorDistance(out, paper) < min && amount <= 0.7; amount += 0.1) out = mixColor(color, ink, amount);
    return out;
  }

  /* 主题 → 纸、墨、强调色、网点四个颜色（0..1 的 sRGB，着色器里直接混）。 */
  function resolvePalette(theme, flip) {
    theme = theme || {};
    var paper = readColor(theme.backgroundColor, FALLBACK_PALETTE.paper);
    var ink = readColor(theme.primaryColor, FALLBACK_PALETTE.ink);
    if (Math.abs(luma(ink) - luma(paper)) < 0.18) ink = luma(paper) > 0.5 ? [0.08, 0.08, 0.09] : [0.95, 0.94, 0.9];
    if (flip) { var swap = paper; paper = ink; ink = swap; }
    var tone = awayFromPaper(readColor(theme.secondaryColor, FALLBACK_PALETTE.tone), paper, ink, 0.22);
    var accent = awayFromPaper(readColor(theme.accentColor, FALLBACK_PALETTE.accent), paper, ink, 0.25);
    /* 强调色和墨是同一个颜色（默认主题就是）：压在字上的融球会和字糊成一片，换成纸墨之间的一档灰 */
    if (colorDistance(accent, ink) < 0.25) accent = mixColor(paper, ink, 0.42);
    return { paper: paper, ink: ink, accent: accent, tone: tone };
  }

  /* ============================== 2. 着色器（metaphorShaders.ts） ============================== */
  /* 画面分两步：墨场（字形 + 融球 + 线稿用加法混合画进半浮点离屏图，R 墨 / G 网点 / B 强调色墨），
   * 再全屏显影（流场推歪取样位置 → 切阈值 → 阈值下的模糊变半调网点 → 砂纸颗粒）。 */

  var GLYPH_VERTEX = [
    'attribute vec2 aOffset;',
    'attribute vec2 aTime;',
    'attribute vec3 aMeta;',
    'attribute vec3 aTint;',
    'attribute vec2 aCorner;',
    'uniform float uTime;',
    'uniform float uMelt;',
    'uniform float uPop;',
    'varying vec2 vUv;',
    'varying vec2 vTime;',
    'varying vec3 vMeta;',
    'varying vec2 vWorld;',
    'varying vec2 vQuad;',
    'varying vec3 vTint;',
    'void main() {',
    '    float dt = uTime - aTime.x;',
    '    float on = step(0.0, dt);',
    '    float scale = mix(0.94, 1.0 + uPop * 0.18 * exp(-max(dt, 0.0) * 2.2), on);',
    '    vec3 p = position;',
    '    float away = aMeta.x * 6.2832;',
    '    p.xy += vec2(cos(away), sin(away)) * uMelt * uMelt * (0.4 + fract(aMeta.x * 7.31) * 0.9) * aMeta.z;',
    '    scale *= 1.0 + uMelt * 0.25;',
    '    p.xy += aOffset * scale;',
    '    vUv = uv;',
    '    vTime = aTime;',
    '    vMeta = aMeta;',
    '    vTint = aTint;',
    '    vWorld = (modelMatrix * vec4(p, 1.0)).xy;',
    '    vQuad = aCorner;',
    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var GLYPH_FRAGMENT = [
    'uniform sampler2D uAtlas;',
    'uniform float uTime;',
    'uniform float uReveal;',
    'uniform float uMelt;',
    'uniform float uShakeTime;',
    'uniform float uWobble;',
    'varying vec2 vUv;',
    'varying vec2 vTime;',
    'varying vec3 vMeta;',
    'varying vec2 vWorld;',
    'varying vec2 vQuad;',
    'varying vec3 vTint;',
    /* 注记的字比线细，抖得比线小一点，不然笔画会断 */
    'const float NOTE_SHAKE = 0.6;',
    /* 注记周围那圈网点往外探多远（世界单位） */
    'const float NOTE_FRINGE = 0.05;',
    'void main() {',
    '    float note = step(vTime.y, -10000.0);',
    '    vec2 w = vWorld;',
    '    vec2 shake = vec2(sin(w.y * 1.7 + uShakeTime * 0.35) + sin(w.x * 0.9 - uShakeTime * 0.2), sin(w.x * 1.3 - uShakeTime * 0.3) + sin(w.y * 1.1 + uShakeTime * 0.25)) * 0.5',
    '        + 0.32 * vec2(sin(w.y * 7.1 + w.x * 2.3 + uShakeTime * 0.6), sin(w.x * 6.3 - w.y * 1.9 - uShakeTime * 0.5))',
    '        + 0.12 * vec2(sin(w.y * 37.0 + w.x * 17.0) + sin(w.x * 53.0), sin(w.x * 41.0 - w.y * 13.0) + sin(w.y * 59.0));',
    '    shake *= uWobble * NOTE_SHAKE * note;',
    '    vec2 wx = dFdx(vWorld);',
    '    vec2 wy = dFdy(vWorld);',
    '    float det = wx.x * wy.y - wx.y * wy.x;',
    '    float inv = abs(det) > 1e-12 ? 1.0 / det : 0.0;',
    '    vec2 ux = dFdx(vUv);',
    '    vec2 uy = dFdy(vUv);',
    '    vec2 qx = dFdx(vQuad);',
    '    vec2 qy = dFdy(vQuad);',
    '    vec2 step2 = vec2(shake.x * wy.y - shake.y * wy.x, shake.y * wx.x - shake.x * wx.y) * inv;',
    '    vec2 uv = vUv + ux * step2.x + uy * step2.y;',
    '    vec2 s = texture2D(uAtlas, uv).rg;',
    '    float fringe = 0.0;',
    '    if (note > 0.5) {',
    '        for (int i = 0; i < 6; i++) {',
    '            float a = float(i) * 1.0472 + 0.3;',
    '            vec2 o = vec2(cos(a), sin(a)) * NOTE_FRINGE;',
    '            vec2 k = vec2(o.x * wy.y - o.y * wy.x, o.y * wx.x - o.x * wx.y) * inv;',
    '            vec2 q = vQuad + qx * k.x + qy * k.y;',
    '            float inside = step(max(abs(q.x), abs(q.y)), 1.0);',
    '            fringe = max(fringe, texture2D(uAtlas, uv + ux * k.x + uy * k.y).g * inside);',
    '        }',
    '    }',
    '    float dt = uTime - vTime.x;',
    '    float on = step(0.0, dt);',
    '    float age = max(dt, 0.0);',
    '    float set = on * (1.0 - exp(-age * 4.5));',
    '    float bulge = on * exp(-age * 1.5);',
    '    float keep = 1.0 - uMelt;',
    '    float ink = s.r * set * keep * keep + s.g * (bulge * 1.25 + 0.3 * set + 0.9 * uMelt * set) * keep;',
    '    float tone = (s.r * (1.0 - set) * 0.85 + s.g * (0.3 + 0.45 * set)) * uReveal * keep;',
    '    ink = mix(ink, s.r * on * keep * keep * 1.12, note);',
    '    tone = mix(tone, min(0.55, max(s.g, fringe) * 1.6) * on * keep, note);',
    '    gl_FragColor = vec4(ink * (1.0 - vMeta.y), tone, ink * vMeta.y, 1.0);',
    '}'
  ].join('\n');

  var SHAPE_VERTEX = [
    'attribute vec2 iPos;',
    'attribute vec2 iScale;',
    'attribute float iRot;',
    'attribute vec3 iMix;',
    'attribute float iShape;',
    'attribute float iParam;',
    'varying vec2 vL;',
    'varying vec2 vWorld;',
    'varying vec2 vTurn;',
    'varying vec3 vMix;',
    'varying float vShape;',
    'varying float vParam;',
    'varying vec2 vScale;',
    /* 每一格四周多留的边（世界单位）：给抖动和线两边那圈网点留地方 */
    'const float MARGIN = 0.2;',
    'void main() {',
    '    vec2 scale = iShape > 2.5 && iShape < 3.5 ? vec2(iScale.x) : iScale;',
    '    vec2 local = position.xy * (scale + MARGIN);',
    '    float c = cos(iRot);',
    '    float s = sin(iRot);',
    '    vec2 o = vec2(local.x * c - local.y * s, local.x * s + local.y * c);',
    '    vL = local;',
    '    vWorld = iPos + o;',
    '    vTurn = vec2(c, s);',
    '    vMix = iMix;',
    '    vShape = iShape;',
    '    vParam = iParam;',
    '    vScale = iScale;',
    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + o, 0.0, 1.0);',
    '}'
  ].join('\n');

  var SHAPE_FRAGMENT = [
    'uniform float uTime;',
    'uniform float uWobble;',
    'uniform vec3 uAccent;',
    'varying vec2 vL;',
    'varying vec2 vWorld;',
    'varying vec2 vTurn;',
    'varying vec3 vMix;',
    'varying float vShape;',
    'varying float vParam;',
    'varying vec2 vScale;',
    /* 线稿的线的半宽（世界单位），和绘制层 STROKE 一致 */
    'const float STROKE = 0.016;',
    'const float FRINGE = 0.11;',
    'void main() {',
    '    vec2 w = vWorld;',
    '    vec2 shake = vec2(sin(w.y * 1.7 + uTime * 0.35) + sin(w.x * 0.9 - uTime * 0.2), sin(w.x * 1.3 - uTime * 0.3) + sin(w.y * 1.1 + uTime * 0.25)) * 0.5',
    '        + 0.32 * vec2(sin(w.y * 7.1 + w.x * 2.3 + uTime * 0.6), sin(w.x * 6.3 - w.y * 1.9 - uTime * 0.5))',
    '        + 0.12 * vec2(sin(w.y * 37.0 + w.x * 17.0) + sin(w.x * 53.0), sin(w.x * 41.0 - w.y * 13.0) + sin(w.y * 59.0));',
    '    shake *= uWobble;',
    '    vec2 L = vL + vec2(shake.x * vTurn.x + shake.y * vTurn.y, shake.y * vTurn.x - shake.x * vTurn.y);',
    '    float inked = min(1.0, vMix.x + vMix.z);',
    '    float core;',
    '    float halo;',
    '    if (vShape < 0.5) {',
    '        vec2 q = L / vScale;',
    '        float k = max(0.0, 1.0 - dot(q, q));',
    '        core = k * k * k * 1.45;',
    '        halo = k * k * 0.55;',
    '        gl_FragColor = vec4(core * vMix.x, k * k * vMix.y * 0.6 + halo * (vMix.x + vMix.z), core * vMix.z, 1.0);',
    '        return;',
    '    }',
    '    if (vShape < 1.5) {',
    '        float band = abs(length(L / vScale) - 0.88);',
    '        core = 1.0 - smoothstep(0.012, 0.03, band);',
    '        halo = 1.0 - smoothstep(0.02, 0.12, band);',
    '        gl_FragColor = vec4(core * vMix.x, core * vMix.y + halo * 0.35, core * vMix.z, 1.0);',
    '        return;',
    '    }',
    '    float d;',
    '    float reach = STROKE;',
    '    float cut = 1.0;',
    '    if (vShape < 2.5) {',
    '        reach = vScale.y;',
    '        d = max(abs(L.y), abs(L.x) - vScale.x + reach);',
    '        if (vParam > 0.5) cut = step(fract((L.x / vScale.x * 0.5 + 0.5) * vParam + 0.25), 0.55);',
    '    } else if (vShape < 3.5) {',
    '        reach = STROKE * vScale.y;',
    '        d = abs(length(L) - 0.9 * vScale.x);',
    '        cut = step(abs(atan(L.y, L.x)), vParam * 3.14159 + 0.001);',
    '    } else {',
    '        float phase = 1.5708 * vParam * (L.x / vScale.x + 1.0);',
    '        float amp = vScale.y * 0.75;',
    '        float slope = amp * cos(phase) * 1.5708 * vParam / vScale.x;',
    '        d = abs(L.y - amp * sin(phase)) / sqrt(1.0 + slope * slope);',
    '        cut = step(abs(L.x), vScale.x);',
    '    }',
    '    float soft = min(reach, STROKE);',
    '    core = (1.0 - smoothstep(reach - soft * 0.8, reach + soft * 1.4, d)) * cut;',
    '    halo = (1.0 - smoothstep(reach, reach + FRINGE, d)) * cut * max(inked * 0.55, vMix.y * 0.4);',
    '    gl_FragColor = vec4(core * vMix.x, core * vMix.y + halo, core * vMix.z, 1.0);',
    '}'
  ].join('\n');

  var DEVELOP_VERTEX = [
    'varying vec2 vUv;',
    'void main() {',
    '    vUv = position.xy * 0.5 + 0.5;',
    '    gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  var DEVELOP_FRAGMENT = [
    'uniform sampler2D uField;',
    'uniform vec2 uRes;',
    'uniform float uPixelRatio;',
    'uniform float uTime;',
    'uniform float uFlow;',
    'uniform float uGrain;',
    'uniform float uDot;',
    'uniform float uAngle;',
    'uniform float uFlood;',
    'uniform float uInvert;',
    'uniform float uSeed;',
    'uniform float uSeeThrough;',
    'uniform vec3 uPaper;',
    'uniform vec3 uInk;',
    'uniform vec3 uAccent;',
    'uniform vec3 uTone;',
    'varying vec2 vUv;',
    /* 坐标是整像素、数值大：用这个不带 sin 的散列，便宜的那种在大坐标上会排出一列列竖纹 */
    'float hash(vec2 p) {',
    '    vec3 q = fract(vec3(p.xyx) * 0.1031);',
    '    q += dot(q, q.yzx + 33.33);',
    '    return fract((q.x + q.y) * q.z);',
    '}',
    'float vnoise(vec2 p) {',
    '    vec2 i = floor(p);',
    '    vec2 f = fract(p);',
    '    f = f * f * (3.0 - 2.0 * f);',
    '    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'void main() {',
    '    vec2 frag = vUv * uRes / uPixelRatio;',
    '    float aspect = uRes.x / uRes.y;',
    '    vec2 p = vec2(vUv.x * aspect, vUv.y);',
    '    float tq = floor(uTime * 8.0) / 8.0;',
    '    float beat = floor(uTime * 6.0);',
    '    vec2 warp = (vec2(vnoise(p * 3.2 + vec2(0.0, tq * 0.16)), vnoise(p * 3.2 + vec2(17.3, -tq * 0.13))) - 0.5) * 0.024',
    '        + (vec2(vnoise(p * 9.0 + vec2(tq * 0.3, 3.0)), vnoise(p * 9.0 + vec2(31.7, -tq * 0.27))) - 0.5) * 0.007;',
    '    warp *= uFlow;',
    '    warp.x /= aspect;',
    '    vec2 uv = vUv + warp;',
    '    vec4 field = texture2D(uField, uv);',
    '    vec3 accentColor = uAccent;',
    '    float rough = (vnoise(frag * 0.45 + uSeed * 91.0) - 0.5) * 0.16 + (hash(floor(frag * 0.9) + uSeed * 13.0) - 0.5) * 0.08;',
    '    float threshold = 0.5 + rough * uGrain;',
    '    float inkField = field.r + uFlood;',
    '    float inkEdge = max(fwidth(inkField), 0.0001) * 0.75;',
    '    float ink = smoothstep(threshold - inkEdge, threshold + inkEdge, inkField);',
    '    float accentEdge = max(fwidth(field.b), 0.0001) * 0.75;',
    '    float accent = smoothstep(threshold - accentEdge, threshold + accentEdge, field.b);',
    '    vec2 centered = vUv - 0.5;',
    '    float vignette = smoothstep(0.42, 1.0, length(centered) * 1.3);',
    '    float tone = clamp(field.g * 0.9 + (field.r + field.b) * 0.5 + vignette * 0.3, 0.0, 1.0);',
    '    float ca = cos(uAngle);',
    '    float sa = sin(uAngle);',
    '    vec2 grid = vec2(frag.x * ca - frag.y * sa, frag.x * sa + frag.y * ca) / uDot;',
    '    float radius = sqrt(tone) * 0.58;',
    '    float soft = 0.9 / uDot;',
    '    float dots = (1.0 - smoothstep(radius - soft, radius + soft, length(fract(grid) - 0.5))) * step(0.015, tone);',
    '    vec3 paper = mix(uPaper, uInk, uInvert);',
    '    vec3 inkColor = mix(uInk, uPaper, uInvert);',
    '    vec3 color = mix(paper, mix(paper, uTone, 0.82), dots);',
    '    color = mix(color, accentColor, accent);',
    '    color = mix(color, mix(accentColor, inkColor, 0.4), dots * accent * smoothstep(0.85, 1.0, field.g));',
    '    color = mix(color, inkColor, ink);',
    '    vec2 edge = min(frag, uRes / uPixelRatio - frag);',
    '    float mark = max(',
    '        step(abs(edge.x - 18.0), 0.75) * step(18.0, edge.y) * step(edge.y, 34.0),',
    '        step(abs(edge.y - 18.0), 0.75) * step(18.0, edge.x) * step(edge.x, 34.0));',
    '    color = mix(color, inkColor, mark * 0.85);',
    '    float fine = hash(floor(frag / 1.4) + beat * 7.13 + uSeed * 3.0);',
    '    float mottle = vnoise(frag * 0.12 + uSeed * 50.0);',
    '    float speck = step(0.988, hash(floor(frag / 2.2) + beat * 3.7 + 0.5));',
    '    color *= 1.0 + ((fine - 0.5) * 0.22 + (mottle - 0.5) * 0.1) * uGrain;',
    '    color = mix(color, mix(inkColor, paper, ink), speck * 0.55 * min(uGrain, 1.5));',
    '    float alpha = mix(1.0, max(max(ink, accent), max(max(dots * 0.82, mark), uInvert)), uSeeThrough);',
    '    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);',
    '}'
  ].join('\n');

  /* ============================== 3. 图形规划（metaphorShapes.ts） ============================== */

  var SHAPE_STRIDE = 10;
  var SHAPE_CAPACITY = 1024;
  /* 留给每帧现算的那些（字放出的粒子、对撞、拍上的小环）的名额 */
  var DYNAMIC_RESERVE = 384;
  var PLAN_LIMIT = 80;

  var SHAPE_BLOB = 0;
  var SHAPE_RING = 1;
  var SHAPE_BAR = 2;
  var SHAPE_ARC = 3;
  var SHAPE_WAVE = 4;

  var TAU = Math.PI * 2;
  var MAX_FLOW = 2;

  function baseShape(shape, patch) {
    var out = {
      shape: shape, x: 0, y: 0, sx: 1, sy: 1, param: 0, born: 0, rot: 0, ink: 0, tone: 0, accent: 0,
      ampX: 0, ampY: 0, w1: 0, w2: 0, p1: 0, p2: 0, parent: -1, orbit: 0, orbitSpeed: 0, steady: false, pulse: 0
    };
    if (patch) for (var key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key];
    return out;
  }

  /* 一个不漂、不鼓的图形（线稿用）。 */
  function staticShape(shape, patch) { return baseShape(shape, patch); }

  function makeShape(rng, shape, patch) {
    var out = baseShape(shape, patch);
    // 漂一个来回要四十秒到一百秒
    out.w1 = 0.06 + rng() * 0.1;
    out.w2 = 0.06 + rng() * 0.1;
    out.p1 = rng() * TAU;
    out.p2 = rng() * TAU;
    if (patch) for (var key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key];
    return out;
  }

  function stageOf(bounds) {
    var halfW = (bounds.x1 - bounds.x0) / 2;
    var halfH = (bounds.y1 - bounds.y0) / 2;
    return { halfW: halfW, halfH: halfH, reach: Math.max(halfW, halfH, 2) };
  }

  /* 从中心朝随机方向走到字的包围盒外面 pad 这么远，再往外 0..far。 */
  function outsidePoint(stage, rng, pad, far) {
    var angle = rng() * TAU;
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var edge = Math.min((stage.halfW + pad) / Math.max(0.001, Math.abs(cos)), (stage.halfH + pad) / Math.max(0.001, Math.abs(sin)));
    var radius = edge + rng() * far;
    return { x: cos * radius, y: sin * radius };
  }

  /* 一个 cue 的图形规划：墨团都摆在字的包围盒外面，压在字上的只有强调色融球。 */
  function planShapes(bounds, rng, amount, interlude) {
    var shapes = [];
    var stage = stageOf(bounds);
    var halfW = stage.halfW, halfH = stage.halfH, reach = stage.reach;
    var scale = amount * (interlude ? 1.5 : 1);
    function count(base) { return Math.round(base * scale + rng() * 0.6 * Math.min(1, scale)); }
    function span(min, max) { return min + rng() * (max - min); }
    function around(min, max) {
      var angle = rng() * TAU;
      var radius = span(min, max);
      return { x: Math.cos(angle) * radius * (halfW / reach + 0.6), y: Math.sin(angle) * radius * (halfH / reach + 0.6) };
    }

    for (var index = count(4); index > 0; index -= 1) {
      var radius = span(0.5, 1.4) * reach;
      var place = around(reach * 0.5, reach * 2.4);
      shapes.push(makeShape(rng, SHAPE_BLOB, {
        x: place.x, y: place.y, sx: radius, sy: radius, tone: span(0.5, 1),
        ampX: span(0.3, 1.2), ampY: span(0.3, 1), pulse: 0.5
      }));
    }

    for (var group = interlude ? Math.min(2, count(1.2)) : count(3); group > 0; group -= 1) {
      var big = (interlude ? span(0.1, 0.24) : span(0.25, 0.7)) * reach;
      var ampX = span(0.2, 0.9);
      var ampY = span(0.2, 0.8);
      var spot = interlude
        ? around(reach * 0.2, reach * 1.6)
        : outsidePoint(stage, rng, big * 1.4 + 0.2 + Math.max(ampX, ampY) * MAX_FLOW, reach);
      var parent = shapes.length;
      shapes.push(makeShape(rng, SHAPE_BLOB, {
        x: spot.x, y: spot.y, sx: big, sy: big, ink: 1, tone: 0.6, ampX: ampX, ampY: ampY, pulse: 1
      }));
      for (var drop = 2 + Math.floor(rng() * 2); drop > 0; drop -= 1) {
        var small = big * span(0.12, 0.3);
        shapes.push(makeShape(rng, SHAPE_BLOB, {
          sx: small, sy: small, ink: 1, parent: parent, orbit: big * span(0.55, 0.85),
          orbitSpeed: (rng() < 0.5 ? -1 : 1) * span(0.08, 0.22), pulse: 0.4
        }));
      }
    }

    if (!interlude) {
      for (var edgeIndex = count(4); edgeIndex > 0; edgeIndex -= 1) {
        var radius2 = span(0.18, 0.45);
        var side = Math.floor(rng() * 4);
        var along = span(-1, 1);
        var out = span(0.35, 0.9);
        shapes.push(makeShape(rng, SHAPE_BLOB, {
          x: side < 2 ? along * halfW : (side === 2 ? -1 : 1) * (halfW + out),
          y: side < 2 ? (side === 0 ? -1 : 1) * (halfH + out) : along * halfH,
          sx: radius2, sy: radius2, ink: 1, ampX: span(0.1, 0.45), ampY: span(0.1, 0.45), pulse: 0.8
        }));
      }
    }

    for (var accentIndex = count(1.6); accentIndex > 0; accentIndex -= 1) {
      var accentRadius = span(0.9, 1.5) * Math.min(1.6, Math.max(0.45, Math.min(halfW, halfH) * 0.9));
      shapes.push(makeShape(rng, SHAPE_BLOB, {
        x: span(-0.9, 0.9) * halfW, y: span(-0.9, 0.9) * halfH, sx: accentRadius, sy: accentRadius, accent: 1, tone: 0.4,
        ampX: span(0.3, 0.9) * Math.min(1.5, halfW), ampY: span(0.2, 0.6) * Math.min(1.5, halfH), pulse: 1
      }));
    }

    for (var ringIndex = count(0.8); ringIndex > 0; ringIndex -= 1) {
      var ringRadius = span(0.5, 1.5) * reach;
      var isAccent = rng() < 0.35;
      var ringPlace = around(0, reach * 2);
      shapes.push(makeShape(rng, SHAPE_RING, {
        x: ringPlace.x, y: ringPlace.y, sx: ringRadius, sy: ringRadius,
        ink: isAccent ? 0 : 1, accent: isAccent ? 1 : 0, ampX: span(0, 0.4), ampY: span(0, 0.4)
      }));
    }

    return shapes.slice(0, PLAN_LIMIT);
  }

  /* 几份规划拼成一份；小墨滴的 parent 要加上前面的长度。 */
  function joinShapes() {
    var joined = [];
    for (var groupIndex = 0; groupIndex < arguments.length; groupIndex += 1) {
      var group = arguments[groupIndex] || [];
      var base = joined.length;
      for (var i = 0; i < group.length; i += 1) {
        var shape = group[i];
        if (shape.parent >= 0 && base > 0) {
          var shifted = {};
          for (var key in shape) if (Object.prototype.hasOwnProperty.call(shape, key)) shifted[key] = shape[key];
          shifted.parent = shape.parent + base;
          joined.push(shifted);
        } else joined.push(shape);
      }
    }
    return joined;
  }

  function putShape(out, count, shape, x, y, sx, sy, rot, ink, tone, accent, param) {
    if (count >= SHAPE_CAPACITY) return count;
    var at = count * SHAPE_STRIDE;
    out[at] = x;
    out[at + 1] = y;
    out[at + 2] = sx;
    out[at + 3] = sy;
    out[at + 4] = rot;
    out[at + 5] = ink;
    out[at + 6] = tone;
    out[at + 7] = accent;
    out[at + 8] = shape;
    out[at + 9] = param || 0;
    return count + 1;
  }

  /* 把规划在 time 这一刻的样子写进实例数据。 */
  function writeShapes(shapes, time, audio, flow, out, since, limit) {
    var count = 0;
    var cap = isFinite(limit) ? limit : SHAPE_CAPACITY - DYNAMIC_RESERVE;
    var xs = [];
    var ys = [];
    for (var i = 0; i < shapes.length; i += 1) {
      if (count >= cap) break;
      var shape = shapes[i];
      var x = shape.x + shape.ampX * flow * Math.sin(time * shape.w1 + shape.p1);
      var y = shape.y + shape.ampY * flow * Math.cos(time * shape.w2 + shape.p2);
      if (shape.orbit > 0) {
        var angle = time * shape.orbitSpeed + shape.p1;
        var radius = shape.steady ? shape.orbit : shape.orbit * (0.8 + 0.35 * Math.sin(time * 0.3 + shape.p2));
        x = (shape.parent >= 0 ? xs[shape.parent] : x) + Math.cos(angle) * radius;
        y = (shape.parent >= 0 ? ys[shape.parent] : y) + Math.sin(angle) * radius;
      }
      xs.push(x);
      ys.push(y);
      if (shape.born > since) continue;
      var swell = 1 + shape.pulse * (0.06 * Math.sin(time * 0.4 + shape.p2) + 0.14 * audio);
      count = putShape(out, count, shape.shape, x, y, shape.sx * swell, shape.sy * swell, shape.rot, shape.ink, shape.tone, shape.accent, shape.param);
    }
    return count;
  }

  /* 两颗墨球从出发到撞上用多久：开头几乎不动，越来越快。 */
  var COLLISION_APPROACH = 2.6;
  var COLLISION_LIFE = 6.5;
  var TRAIL_DOTS = 5;
  var TRAIL_GAP = 0.3;

  function planCollisions(bounds, rng, times, amount, interlude) {
    if (amount <= 0) return [];
    var stage = stageOf(bounds);
    function span(min, max) { return min + rng() * (max - min); }
    var out = [];
    for (var i = 0; i < times.length; i += 1) {
      var time = times[i];
      var unit = Math.max(1, stage.reach * 0.32) * span(0.8, 1.2);
      var place = interlude
        ? { x: span(-0.5, 0.5) * stage.halfW, y: span(-0.5, 0.5) * stage.halfH }
        : outsidePoint(stage, rng, unit * 0.9, stage.reach * 0.5);
      var total = Math.max(3, Math.round(span(5, 9) * Math.min(1.5, amount)));
      var fragments = [];
      for (var index = 0; index < total; index += 1) {
        var size = span(0.05, 0.15);
        fragments.push({
          dir: rng() * TAU,
          curl: (rng() < 0.5 ? -1 : 1) * span(0.5, 1.2) * (0.16 / (size + 0.04)),
          range: unit * span(1.2, 3.2),
          size: unit * size,
          life: span(3.5, COLLISION_LIFE)
        });
      }
      out.push({ time: time, x: place.x, y: place.y, angle: rng() * TAU, unit: unit, fragments: fragments });
    }
    return out;
  }

  function writeCollisions(collisions, time, out, offset) {
    var count = offset;
    for (var i = 0; i < collisions.length; i += 1) {
      var hit = collisions[i];
      var since = time - hit.time;
      if (since < -COLLISION_APPROACH || since >= COLLISION_LIFE) continue;
      var cos = Math.cos(hit.angle);
      var sin = Math.sin(hit.angle);
      if (since < 0) {
        for (var dot = 0; dot <= 3; dot += 1) {
          var u = 1 + since / COLLISION_APPROACH - dot * 0.035;
          if (u < 0) continue;
          var left = hit.unit * 5 * (1 - u * u * u);
          var radius = hit.unit * (dot === 0 ? 0.22 : 0.13 - dot * 0.025);
          count = putShape(out, count, SHAPE_BLOB, hit.x + cos * left, hit.y + sin * left, radius, radius, 0, 1, 0.3, 0);
          count = putShape(out, count, SHAPE_BLOB, hit.x - cos * left, hit.y - sin * left, radius, radius, 0, 1, 0.3, 0);
        }
        continue;
      }
      var burst = hit.unit * 0.95 * Math.exp(-since * 1.6);
      if (burst > hit.unit * 0.04) count = putShape(out, count, SHAPE_BLOB, hit.x, hit.y, burst, burst, 0, 1, 0.8, 0);
      if (since < 4) {
        var ring = hit.unit * (0.35 + 2.6 * (1 - Math.exp(-since * 0.55)));
        count = putShape(out, count, SHAPE_RING, hit.x, hit.y, ring, ring, 0, since < 2.2 ? 1 : 0, 1, 0);
      }
      for (var f = 0; f < hit.fragments.length; f += 1) {
        var fragment = hit.fragments[f];
        for (var trail = 0; trail <= TRAIL_DOTS; trail += 1) {
          var age = since - trail * TRAIL_GAP;
          if (age < 0 || age >= fragment.life) continue;
          var travelled = fragment.range * (1 - Math.exp(-age * 0.6));
          var angle = fragment.dir + (fragment.curl * travelled) / hit.unit;
          var fade = 1 - age / fragment.life;
          var radius2 = fragment.size * fade * (trail === 0 ? 1 : 0.6 - trail * 0.07);
          count = putShape(out, count, SHAPE_BLOB, hit.x + Math.cos(angle) * travelled, hit.y + Math.sin(angle) * travelled, radius2, radius2, 0, 1, 0.25, 0);
        }
      }
    }
    return count;
  }

  var PAIR_LIFE = 3.6;

  /* 刚唱到的字放出一对粒子：朝相反的方向出发、各往相反的一边打转。 */
  function writePairs(glyphs, time, out, offset) {
    var count = offset;
    for (var i = 0; i < glyphs.length; i += 1) {
      var glyph = glyphs[i];
      var age = time - glyph.t0;
      if (age < 0 || age >= PAIR_LIFE) continue;
      var life = age / PAIR_LIFE;
      var travelled = glyph.size * (0.4 + 1.5 * (1 - Math.exp(-age * 0.7)));
      var radius = glyph.size * (0.07 + glyph.seed * 0.05) * (1 - life * life);
      var curl = 0.9 + glyph.seed * 1.4;
      var ink = glyph.accent ? 0 : 1;
      var accent = glyph.accent ? 1 : 0;
      for (var side = 0; side < 2; side += 1) {
        var sign = side === 0 ? 1 : -1;
        var angle = glyph.seed * TAU + (sign > 0 ? 0 : Math.PI) + (sign * curl * travelled) / glyph.size;
        count = putShape(out, count, SHAPE_BLOB, glyph.x + Math.cos(angle) * travelled, glyph.y + Math.sin(angle) * travelled, radius, radius, 0, ink, 0.3, accent);
      }
    }
    return count;
  }

  F.paint = {
    resolvePalette: resolvePalette,
    readColor: readColor,
    shaders: {
      glyphVertex: GLYPH_VERTEX,
      glyphFragment: GLYPH_FRAGMENT,
      shapeVertex: SHAPE_VERTEX,
      shapeFragment: SHAPE_FRAGMENT,
      developVertex: DEVELOP_VERTEX,
      developFragment: DEVELOP_FRAGMENT
    },
    constants: {
      SHAPE_STRIDE: SHAPE_STRIDE,
      SHAPE_CAPACITY: SHAPE_CAPACITY,
      DYNAMIC_RESERVE: DYNAMIC_RESERVE,
      SHAPE_BLOB: SHAPE_BLOB,
      SHAPE_RING: SHAPE_RING,
      SHAPE_BAR: SHAPE_BAR,
      SHAPE_ARC: SHAPE_ARC,
      SHAPE_WAVE: SHAPE_WAVE,
      COLLISION_APPROACH: COLLISION_APPROACH,
      COLLISION_LIFE: COLLISION_LIFE
    },
    staticShape: staticShape,
    planShapes: planShapes,
    joinShapes: joinShapes,
    writeShapes: writeShapes,
    planCollisions: planCollisions,
    writeCollisions: writeCollisions,
    writePairs: writePairs,
    putShape: putShape
  };
})();
