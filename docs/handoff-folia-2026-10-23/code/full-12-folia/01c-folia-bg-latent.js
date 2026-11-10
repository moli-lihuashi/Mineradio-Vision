/* Folia 背景 — 隐现（latent）：封面取色的「像素 + 流体」双层着色器
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/latent/）：
 *   LatentBackground.tsx（349）        → 两层 Paper 着色器 + 音频响应
 *   LatentBackgroundSettingsCard.tsx（288）→ 显示图层 / 颜色来源 / 两组滑杆（本轮不做面板）
 *   entry.tsx（73）                    → mode 'latent' / order 35 / 默认背景
 *
 * 着色器原文来自 @paper-design/shaders 0.0.80（package-lock.json 里 Folia 锁的版本）：
 *   dist/shaders/dithering.js      → ditheringFragmentShader（warp + 4x4 Bayer）
 *   dist/shaders/mesh-gradient.js  → meshGradientFragmentShader（6 色网格渐变）
 *   dist/vertex-shader.js          → 两层共用的顶点着色器（算 v_objectUV / v_patternUV）
 *   dist/shader-utils.js           → simplexNoise / declarePI / rotation2 / hash11 / hash21
 *   dist/shader-mount.js           → render()：currentFrame += dt*speed，u_time = currentFrame*1e-3
 *
 * 必须照抄的判据
 * --------------
 * 1. 着色器**逐字搬**（含 Bayer 表、hash 常数、grainOverlay 0.01、firstFrameOffset 41.5）。
 * 2. 双层顺序：流体在下、像素在上；像素层在「有流体」时用 mix-blend-mode: soft-light 且透明度取
 *    tuning.ditheringOpacity，只有像素时用 normal + 满透明。overlay 是最后一层纯色压暗。
 * 3. 音频响应**逐条照抄**（LatentBackground.tsx:189-269）：
 *      宽带能量 = bass*.22 + lowMid*.18 + mid*.22 + vocal*.28 + treble*.1，再开 0.55 次方；
 *      起音脉冲 = max(上一帧*0.84, clamp((本帧-上一帧)*7))；
 *      节拍目标 = 宽带*0.42 + 脉冲*0.85（增强节拍响应关掉时直接用宽带）；
 *      平滑速度 = ease(smoothed, target, target>smoothed ? 0.42 : 0.14)；
 *      平滑系数 power .12 / bass .16 / mid .13；暂停时目标全归零、速度降到 0.12×。
 *      像素 u_pxSize = max(0.5, size - bass*size*0.34)；
 *      流体 u_distortion = distortion + power*0.62、u_swirl = swirl + mid*0.38。
 * 4. 层变换：像素 scale(1.015 + bass*0.025)、流体 scale(1.025 + power*0.018)，
 *    流体滤镜 saturate(1.04 + mid*0.34) brightness(0.94 + power*0.16)。
 * 5. 取色：6 个代表色用加权中位切分（colorPalette.ts 的 extractRepresentativeColorsFromPixels），
 *    颜色来源 cover-theme 时末两色换成主题背景色与强调色、像素底用背景色；
 *    cover-only 时全部从封面推。没有封面时 primary 回落 theme.secondaryColor。
 *
 * 与 Folia 的实现差异（都不是视觉差异）
 * ------------------------------------
 * 1. 不用 @paper-design/shaders（那是 React 组件 + 自带 rAF）：这里手写 WebGL2 上下文，
 *    **不另起循环**，时间由世界 tick 的 ctx.dt 推进（等价于 ShaderMount 的 currentFrame 累加）。
 * 2. 取色走本项目的同源代理 coverProxySrc（CDN 直连会污染 canvas，getImageData 抛错）。
 * 3. 频段 0..1（本项目 11-main-loop 的归一化值），Folia 是 0..255：normalizeAudio 从 /255 变成 clamp01，
 *    两边的动作幅度因此完全一致。
 * 4. dt 按 100ms 封顶：世界 tick 在页面切回来时会给出几秒的 dt，不封顶会让着色器一次跳过整段动画。
 * 5. tuning 在**创建背景时**读一次（与 Folia 从 config 取 tuning 快照的语义一致）；
 *    面板接入后由 foliaLatentSetTuning 写入存档，重建背景即生效。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaBackground !== 'function') return;

  var MAX_SHADER_PIXELS = 1280 * 720;
  var PAUSED_SPEED_SCALE = 0.12;
  var MAX_FRAME_STEP_MS = 100;
  var MESH_MAX_COLORS = 10;
  var DITHERING_SHAPE_WARP = 2;
  var DITHERING_TYPE_4X4 = 3;
  var PALETTE_COUNT = 6;
  var PALETTE_SAMPLE_SIZE = 50;
  var TUNING_STORE_KEY = 'mineradio-folia-latent-tuning-v1';

  var LATENT_DISPLAY_MODES = ['dithering', 'mesh', 'both'];
  var LATENT_COLOR_SOURCES = ['cover-theme', 'cover-only'];

  /* types.ts:1045 —— 逐字照抄。 */
  var LATENT_TUNING_DEFAULT = {
    displayMode: 'both',
    colorSource: 'cover-theme',
    dynamicOnlyInPlayer: true,
    enhancedBeatResponse: true,
    ditheringSpeed: 0.1,
    ditheringAudioSpeed: 1.2,
    ditheringSize: 2.5,
    ditheringOpacity: 0.55,
    meshSpeed: 0.3,
    meshAudioSpeed: 2,
    meshDistortion: 0.8,
    meshSwirl: 0.1,
    overlayEnabled: true,
    overlayOpacity: 0.35
  };

  /* ---- 着色器：@paper-design/shaders 0.0.80 原文 ----
   * 顶点着色器两层共用（dithering 的 SIZING NOTE 说明它的尺寸在片元里算，不用顶点输出，
   * 但用同一个 program 更省事，也保证两层的命中区域完全一致）。
   * 唯一删掉的是 #ifdef ADD_HELPERS 段：它只在编译带那个宏时生成 v_responsiveHelperBox，
   * Folia 不传这个宏，属于编译期死代码。 */

  var FOLIA_LATENT_VERTEX_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'layout(location = 0) in vec4 a_position;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_pixelRatio;',
    'uniform float u_imageAspectRatio;',
    'uniform float u_originX;',
    'uniform float u_originY;',
    'uniform float u_worldWidth;',
    'uniform float u_worldHeight;',
    'uniform float u_fit;',
    'uniform float u_scale;',
    'uniform float u_rotation;',
    'uniform float u_offsetX;',
    'uniform float u_offsetY;',
    '',
    'out vec2 v_objectUV;',
    'out vec2 v_objectBoxSize;',
    'out vec2 v_responsiveUV;',
    'out vec2 v_responsiveBoxGivenSize;',
    'out vec2 v_patternUV;',
    'out vec2 v_patternBoxSize;',
    'out vec2 v_imageUV;',
    '',
    'vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {',
    '  vec2 box = vec2(0.);',
    '  // fit = none',
    '  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);',
    '  float noFitBoxWidth = box.x;',
    '  if (u_fit == 1.) { // fit = contain',
    '    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);',
    '  } else if (u_fit == 2.) { // fit = cover',
    '    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);',
    '  }',
    '  box.y = box.x / boxRatio;',
    '  return vec3(box, noFitBoxWidth);',
    '}',
    '',
    'void main() {',
    '  gl_Position = a_position;',
    '',
    '  vec2 uv = gl_Position.xy * .5;',
    '  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);',
    '  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);',
    '  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;',
    '  float r = u_rotation * 3.14159265358979323846 / 180.;',
    '  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));',
    '  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);',
    '',
    '  float fixedRatio = 1.;',
    '  vec2 fixedRatioBoxGivenSize = vec2(',
    '  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,',
    '  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y',
    '  );',
    '',
    '  v_objectBoxSize = getBoxSize(fixedRatio, fixedRatioBoxGivenSize).xy;',
    '  vec2 objectWorldScale = u_resolution.xy / v_objectBoxSize;',
    '',
    '  v_objectUV = uv;',
    '  v_objectUV *= objectWorldScale;',
    '  v_objectUV += boxOrigin * (objectWorldScale - 1.);',
    '  v_objectUV += graphicOffset;',
    '  v_objectUV /= u_scale;',
    '  v_objectUV = graphicRotation * v_objectUV;',
    '',
    '  v_responsiveBoxGivenSize = vec2(',
    '  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,',
    '  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y',
    '  );',
    '  float responsiveRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;',
    '  vec2 responsiveBoxSize = getBoxSize(responsiveRatio, v_responsiveBoxGivenSize).xy;',
    '  vec2 responsiveBoxScale = u_resolution.xy / responsiveBoxSize;',
    '',
    '  v_responsiveUV = uv;',
    '  v_responsiveUV *= responsiveBoxScale;',
    '  v_responsiveUV += boxOrigin * (responsiveBoxScale - 1.);',
    '  v_responsiveUV += graphicOffset;',
    '  v_responsiveUV /= u_scale;',
    '  v_responsiveUV.x *= responsiveRatio;',
    '  v_responsiveUV = graphicRotation * v_responsiveUV;',
    '  v_responsiveUV.x /= responsiveRatio;',
    '',
    '  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;',
    '  vec2 patternBoxGivenSize = vec2(',
    '  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,',
    '  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y',
    '  );',
    '  patternBoxRatio = patternBoxGivenSize.x / patternBoxGivenSize.y;',
    '',
    '  vec3 boxSizeData = getBoxSize(patternBoxRatio, patternBoxGivenSize);',
    '  v_patternBoxSize = boxSizeData.xy;',
    '  float patternBoxNoFitBoxWidth = boxSizeData.z;',
    '  vec2 patternBoxScale = u_resolution.xy / v_patternBoxSize;',
    '',
    '  v_patternUV = uv;',
    '  v_patternUV += graphicOffset / patternBoxScale;',
    '  v_patternUV += boxOrigin;',
    '  v_patternUV -= boxOrigin / patternBoxScale;',
    '  v_patternUV *= u_resolution.xy;',
    '  v_patternUV /= u_pixelRatio;',
    '  if (u_fit > 0.) {',
    '    v_patternUV *= (patternBoxNoFitBoxWidth / v_patternBoxSize.x);',
    '  }',
    '  v_patternUV /= u_scale;',
    '  v_patternUV = graphicRotation * v_patternUV;',
    '  v_patternUV += boxOrigin / patternBoxScale;',
    '  v_patternUV -= boxOrigin;',
    '  // x100 is a default multiplier between vertex and fragmant shaders',
    '  // we use it to avoid UV presision issues',
    '  v_patternUV *= .01;',
    '',
    '  vec2 imageBoxSize;',
    '  if (u_fit == 1.) { // contain',
    '    imageBoxSize.x = min(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;',
    '  } else if (u_fit == 2.) { // cover',
    '    imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;',
    '  } else {',
    '    imageBoxSize.x = min(10.0, 10.0 / u_imageAspectRatio * u_imageAspectRatio);',
    '  }',
    '  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;',
    '  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;',
    '',
    '  v_imageUV = uv;',
    '  v_imageUV *= imageBoxScale;',
    '  v_imageUV += boxOrigin * (imageBoxScale - 1.);',
    '  v_imageUV += graphicOffset;',
    '  v_imageUV /= u_scale;',
    '  v_imageUV.x *= u_imageAspectRatio;',
    '  v_imageUV = graphicRotation * v_imageUV;',
    '  v_imageUV.x /= u_imageAspectRatio;',
    '',
    '  v_imageUV += .5;',
    '  v_imageUV.y = 1. - v_imageUV.y;',
    '}'
  ].join('\n');

  /* shader-utils.js 的公共片段 —— 逐字。 */
  var FOLIA_LATENT_GLSL_PI = [
    '#define TWO_PI 6.28318530718',
    '#define PI 3.14159265358979323846'
  ].join('\n');

  var FOLIA_LATENT_GLSL_ROTATE = [
    'vec2 rotate(vec2 uv, float th) {',
    '  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;',
    '}'
  ].join('\n');

  var FOLIA_LATENT_GLSL_HASH21 = [
    'float hash21(vec2 p) {',
    '  p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;',
    '  p += dot(p, p + 19.19);',
    '  return fract(p.x * p.y);',
    '}'
  ].join('\n');

  var FOLIA_LATENT_GLSL_HASH11 = [
    'float hash11(float p) {',
    '  p = fract(p * 0.3183099) + 0.1;',
    '  p *= p + 19.19;',
    '  return fract(p * p);',
    '}'
  ].join('\n');

  var FOLIA_LATENT_GLSL_SIMPLEX = [
    'vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }',
    'float snoise(vec2 v) {',
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439,',
    '    -0.577350269189626, 0.024390243902439);',
    '  vec2 i = floor(v + dot(v, C.yy));',
    '  vec2 x0 = v - i + dot(i, C.xx);',
    '  vec2 i1;',
    '  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec4 x12 = x0.xyxy + C.xxzz;',
    '  x12.xy -= i1;',
    '  i = mod(i, 289.0);',
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))',
    '    + i.x + vec3(0.0, i1.x, 1.0));',
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),',
    '      dot(x12.zw, x12.zw)), 0.0);',
    '  m = m * m;',
    '  m = m * m;',
    '  vec3 x = 2.0 * fract(p * C.www) - 1.0;',
    '  vec3 h = abs(x) - 0.5;',
    '  vec3 ox = floor(x + 0.5);',
    '  vec3 a0 = x - ox;',
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);',
    '  vec3 g;',
    '  g.x = a0.x * x0.x + h.x * x0.y;',
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '  return 130.0 * dot(m, g);',
    '}'
  ].join('\n');

  /* mesh-gradient.js:12-122 —— 逐字（u_colors 定长 10，由 u_colorsCount 截断）。 */
  var FOLIA_LATENT_MESH_SHADER = ['#version 300 es', 'precision mediump float;', '',
    'uniform float u_time;', '',
    'uniform vec4 u_colors[' + MESH_MAX_COLORS + '];',
    'uniform float u_colorsCount;', '',
    'uniform float u_distortion;',
    'uniform float u_swirl;',
    'uniform float u_grainMixer;',
    'uniform float u_grainOverlay;', '',
    'in vec2 v_objectUV;',
    'out vec4 fragColor;', '',
    FOLIA_LATENT_GLSL_PI, '',
    FOLIA_LATENT_GLSL_ROTATE, '',
    FOLIA_LATENT_GLSL_HASH21, '',
    'float valueNoise(vec2 st) {',
    '  vec2 i = floor(st);',
    '  vec2 f = fract(st);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0));',
    '  float d = hash21(i + vec2(1.0, 1.0));',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float x1 = mix(a, b, u.x);',
    '  float x2 = mix(c, d, u.x);',
    '  return mix(x1, x2, u.y);',
    '}', '',
    'float noise(vec2 n, vec2 seedOffset) {',
    '  return valueNoise(n + seedOffset);',
    '}', '',
    'vec2 getPosition(int i, float t) {',
    '  float a = float(i) * .37;',
    '  float b = .6 + fract(float(i) / 3.) * .9;',
    '  float c = .8 + fract(float(i + 1) / 4.);',
    '',
    '  float x = sin(t * b + a);',
    '  float y = cos(t * c + a * 1.5);',
    '',
    '  return .5 + .5 * vec2(x, y);',
    '}', '',
    'void main() {',
    '  vec2 uv = v_objectUV;',
    '  uv += .5;',
    '  vec2 grainUV = uv * 1000.;',
    '',
    '  float grain = noise(grainUV, vec2(0.));',
    '  float mixerGrain = .4 * u_grainMixer * (grain - .5);',
    '',
    '  const float firstFrameOffset = 41.5;',
    '  float t = .5 * (u_time + firstFrameOffset);',
    '',
    '  float radius = smoothstep(0., 1., length(uv - .5));',
    '  float center = 1. - radius;',
    '  for (float i = 1.; i <= 2.; i++) {',
    '    uv.x += u_distortion * center / i * sin(t + i * .4 * smoothstep(.0, 1., uv.y)) * cos(.2 * t + i * 2.4 * smoothstep(.0, 1., uv.y));',
    '    uv.y += u_distortion * center / i * cos(t + i * 2. * smoothstep(.0, 1., uv.x));',
    '  }',
    '',
    '  vec2 uvRotated = uv;',
    '  uvRotated -= vec2(.5);',
    '  float angle = 3. * u_swirl * radius;',
    '  uvRotated = rotate(uvRotated, -angle);',
    '  uvRotated += vec2(.5);',
    '',
    '  vec3 color = vec3(0.);',
    '  float opacity = 0.;',
    '  float totalWeight = 0.;',
    '',
    '  for (int i = 0; i < ' + MESH_MAX_COLORS + '; i++) {',
    '    if (i >= int(u_colorsCount)) break;',
    '',
    '    vec2 pos = getPosition(i, t) + mixerGrain;',
    '    vec3 colorFraction = u_colors[i].rgb * u_colors[i].a;',
    '    float opacityFraction = u_colors[i].a;',
    '',
    '    float dist = length(uvRotated - pos);',
    '',
    '    dist = pow(dist, 3.5);',
    '    float weight = 1. / (dist + 1e-3);',
    '    color += colorFraction * weight;',
    '    opacity += opacityFraction * weight;',
    '    totalWeight += weight;',
    '  }',
    '',
    '  color /= max(1e-4, totalWeight);',
    '  opacity /= max(1e-4, totalWeight);',
    '',
    '  float grainOverlay = valueNoise(rotate(grainUV, 1.) + vec2(3.));',
    '  grainOverlay = mix(grainOverlay, valueNoise(rotate(grainUV, 2.) + vec2(-1.)), .5);',
    '  grainOverlay = pow(grainOverlay, 1.3);',
    '',
    '  float grainOverlayV = grainOverlay * 2. - 1.;',
    '  vec3 grainOverlayColor = vec3(step(0., grainOverlayV));',
    '  float grainOverlayStrength = u_grainOverlay * abs(grainOverlayV);',
    '  grainOverlayStrength = pow(grainOverlayStrength, .8);',
    '  color = mix(color, grainOverlayColor, .35 * grainOverlayStrength);',
    '',
    '  opacity += .5 * grainOverlayStrength;',
    '  opacity = clamp(opacity, 0., 1.);',
    '',
    '  fragColor = vec4(color, opacity);',
    '}'
  ].join('\n');

  /* dithering.js:9-250 —— 逐字（warp 形状 + 4x4 Bayer，Bayer 表与 hash 常数不可动）。 */
  var FOLIA_LATENT_DITHERING_SHADER = ['#version 300 es', 'precision mediump float;', '',
    'uniform float u_time;', '',
    'uniform vec2 u_resolution;',
    'uniform float u_pixelRatio;',
    'uniform float u_originX;',
    'uniform float u_originY;',
    'uniform float u_worldWidth;',
    'uniform float u_worldHeight;',
    'uniform float u_fit;',
    'uniform float u_scale;',
    'uniform float u_rotation;',
    'uniform float u_offsetX;',
    'uniform float u_offsetY;', '',
    'uniform float u_pxSize;',
    'uniform vec4 u_colorBack;',
    'uniform vec4 u_colorFront;',
    'uniform float u_shape;',
    'uniform float u_type;', '',
    'out vec4 fragColor;', '',
    FOLIA_LATENT_GLSL_SIMPLEX, '',
    FOLIA_LATENT_GLSL_PI, '',
    FOLIA_LATENT_GLSL_HASH11, '',
    FOLIA_LATENT_GLSL_HASH21, '',
    'float getSimplexNoise(vec2 uv, float t) {',
    '  float noise = .5 * snoise(uv - vec2(0., .3 * t));',
    '  noise += .5 * snoise(2. * uv + vec2(0., .32 * t));',
    '',
    '  return noise;',
    '}', '',
    'const int bayer2x2[4] = int[4](0, 2, 3, 1);',
    'const int bayer4x4[16] = int[16](',
    '0, 8, 2, 10,',
    '12, 4, 14, 6,',
    '3, 11, 1, 9,',
    '15, 7, 13, 5',
    ');', '',
    'const int bayer8x8[64] = int[64](',
    '0, 32, 8, 40, 2, 34, 10, 42,',
    '48, 16, 56, 24, 50, 18, 58, 26,',
    '12, 44, 4, 36, 14, 46, 6, 38,',
    '60, 28, 52, 20, 62, 30, 54, 22,',
    '3, 35, 11, 43, 1, 33, 9, 41,',
    '51, 19, 59, 27, 49, 17, 57, 25,',
    '15, 47, 7, 39, 13, 45, 5, 37,',
    '63, 31, 55, 23, 61, 29, 53, 21',
    ');', '',
    'float getBayerValue(vec2 uv, int size) {',
    '  ivec2 pos = ivec2(fract(uv / float(size)) * float(size));',
    '  int index = pos.y * size + pos.x;',
    '',
    '  if (size == 2) {',
    '    return float(bayer2x2[index]) / 4.0;',
    '  } else if (size == 4) {',
    '    return float(bayer4x4[index]) / 16.0;',
    '  } else if (size == 8) {',
    '    return float(bayer8x8[index]) / 64.0;',
    '  }',
    '  return 0.0;',
    '}', '',
    'void main() {',
    '  float t = .5 * u_time;',
    '',
    '  float pxSize = u_pxSize * u_pixelRatio;',
    '  vec2 pxSizeUV = gl_FragCoord.xy - .5 * u_resolution;',
    '  pxSizeUV /= pxSize;',
    '  vec2 canvasPixelizedUV = (floor(pxSizeUV) + .5) * pxSize;',
    '  vec2 normalizedUV = canvasPixelizedUV / u_resolution;',
    '',
    '  vec2 ditheringNoiseUV = canvasPixelizedUV;',
    '  vec2 shapeUV = normalizedUV;',
    '',
    '  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);',
    '  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);',
    '  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;',
    '  float r = u_rotation * PI / 180.;',
    '  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));',
    '  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);',
    '',
    '  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;',
    '  vec2 boxSize = vec2(',
    '  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,',
    '  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y',
    '  );',
    '',
    '  if (u_shape > 3.5) {',
    '    vec2 objectBoxSize = vec2(0.);',
    '    // fit = none',
    '    objectBoxSize.x = min(boxSize.x, boxSize.y);',
    '    if (u_fit == 1.) { // fit = contain',
    '      objectBoxSize.x = min(u_resolution.x, u_resolution.y);',
    '    } else if (u_fit == 2.) { // fit = cover',
    '      objectBoxSize.x = max(u_resolution.x, u_resolution.y);',
    '    }',
    '    objectBoxSize.y = objectBoxSize.x;',
    '    vec2 objectWorldScale = u_resolution.xy / objectBoxSize;',
    '',
    '    shapeUV *= objectWorldScale;',
    '    shapeUV += boxOrigin * (objectWorldScale - 1.);',
    '    shapeUV += vec2(-u_offsetX, u_offsetY);',
    '    shapeUV /= u_scale;',
    '    shapeUV = graphicRotation * shapeUV;',
    '  } else {',
    '    vec2 patternBoxSize = vec2(0.);',
    '    // fit = none',
    '    patternBoxSize.x = patternBoxRatio * min(boxSize.x / patternBoxRatio, boxSize.y);',
    '    float patternWorldNoFitBoxWidth = patternBoxSize.x;',
    '    if (u_fit == 1.) { // fit = contain',
    '      patternBoxSize.x = patternBoxRatio * min(u_resolution.x / patternBoxRatio, u_resolution.y);',
    '    } else if (u_fit == 2.) { // fit = cover',
    '      patternBoxSize.x = patternBoxRatio * max(u_resolution.x / patternBoxRatio, u_resolution.y);',
    '    }',
    '    patternBoxSize.y = patternBoxSize.x / patternBoxRatio;',
    '    vec2 patternWorldScale = u_resolution.xy / patternBoxSize;',
    '',
    '    shapeUV += vec2(-u_offsetX, u_offsetY) / patternWorldScale;',
    '    shapeUV += boxOrigin;',
    '    shapeUV -= boxOrigin / patternWorldScale;',
    '    shapeUV *= u_resolution.xy;',
    '    shapeUV /= u_pixelRatio;',
    '    if (u_fit > 0.) {',
    '      shapeUV *= (patternWorldNoFitBoxWidth / patternBoxSize.x);',
    '    }',
    '    shapeUV /= u_scale;',
    '    shapeUV = graphicRotation * shapeUV;',
    '    shapeUV += boxOrigin / patternWorldScale;',
    '    shapeUV -= boxOrigin;',
    '    shapeUV += .5;',
    '  }',
    '',
    '  float shape = 0.;',
    '  if (u_shape < 1.5) {',
    '    // Simplex noise',
    '    shapeUV *= .001;',
    '',
    '    shape = 0.5 + 0.5 * getSimplexNoise(shapeUV, t);',
    '    shape = smoothstep(0.3, 0.9, shape);',
    '',
    '  } else if (u_shape < 2.5) {',
    '    // Warp',
    '    shapeUV *= .003;',
    '',
    '    for (float i = 1.0; i < 6.0; i++) {',
    '      shapeUV.x += 0.6 / i * cos(i * 2.5 * shapeUV.y + t);',
    '      shapeUV.y += 0.6 / i * cos(i * 1.5 * shapeUV.x + t);',
    '    }',
    '',
    '    shape = .15 / max(0.001, abs(sin(t - shapeUV.y - shapeUV.x)));',
    '    shape = smoothstep(0.02, 1., shape);',
    '',
    '  } else if (u_shape < 3.5) {',
    '    // Dots',
    '    shapeUV *= .05;',
    '',
    '    float stripeIdx = floor(2. * shapeUV.x / TWO_PI);',
    '    float rand = hash11(stripeIdx * 10.);',
    '    rand = sign(rand - .5) * pow(.1 + abs(rand), .4);',
    '    shape = sin(shapeUV.x) * cos(shapeUV.y - 5. * rand * t);',
    '    shape = pow(abs(shape), 6.);',
    '',
    '  } else if (u_shape < 4.5) {',
    '    // Sine wave',
    '    shapeUV *= 4.;',
    '',
    '    float wave = cos(.5 * shapeUV.x - 2. * t) * sin(1.5 * shapeUV.x + t) * (.75 + .25 * cos(3. * t));',
    '    shape = 1. - smoothstep(-1., 1., shapeUV.y + wave);',
    '',
    '  } else if (u_shape < 5.5) {',
    '    // Ripple',
    '',
    '    float dist = length(shapeUV);',
    '    float waves = sin(pow(dist, 1.7) * 7. - 3. * t) * .5 + .5;',
    '    shape = waves;',
    '',
    '  } else if (u_shape < 6.5) {',
    '    // Swirl',
    '',
    '    float l = length(shapeUV);',
    '    float angle = 6. * atan(shapeUV.y, shapeUV.x) + 4. * t;',
    '    float twist = 1.2;',
    '    float offset = 1. / pow(max(l, 1e-6), twist) + angle / TWO_PI;',
    '    float mid = smoothstep(0., 1., pow(l, twist));',
    '    shape = mix(0., fract(offset), mid);',
    '',
    '  } else {',
    '    // Sphere',
    '    shapeUV *= 2.;',
    '',
    '    float d = 1. - pow(length(shapeUV), 2.);',
    '    vec3 pos = vec3(shapeUV, sqrt(max(0., d)));',
    '    vec3 lightPos = normalize(vec3(cos(1.5 * t), .8, sin(1.25 * t)));',
    '    shape = .5 + .5 * dot(lightPos, pos);',
    '    shape *= step(0., d);',
    '  }',
    '',
    '  int type = int(floor(u_type));',
    '  float dithering = 0.0;',
    '',
    '  switch (type) {',
    '    case 1: {',
    '      dithering = step(hash21(ditheringNoiseUV), shape);',
    '    } break;',
    '    case 2:',
    '    dithering = getBayerValue(pxSizeUV, 2);',
    '    break;',
    '    case 3:',
    '    dithering = getBayerValue(pxSizeUV, 4);',
    '    break;',
    '    default :',
    '    dithering = getBayerValue(pxSizeUV, 8);',
    '    break;',
    '  }',
    '',
    '  dithering -= .5;',
    '  float res = step(.5, shape + dithering);',
    '',
    '  vec3 fgColor = u_colorFront.rgb * u_colorFront.a;',
    '  float fgOpacity = u_colorFront.a;',
    '  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;',
    '  float bgOpacity = u_colorBack.a;',
    '',
    '  vec3 color = fgColor * res;',
    '  float opacity = fgOpacity * res;',
    '',
    '  color += bgColor * (1. - opacity);',
    '  opacity += bgOpacity * (1. - opacity);',
    '',
    '  fragColor = vec4(color, opacity);',
    '}'
  ].join('\n');

  /* ---- 纯数值：LatentBackground.tsx:30-81 —— 逐字 ---- */

  function foliaLatentClampNumber(value, fallback, min, max) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  /* 本项目频段已经是 0..1（Folia 是 0..255，故原式是 value/255）。 */
  function foliaLatentNormalizeAudio(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  function foliaLatentClampShaderSpeed(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(2, Math.max(0, n));
  }

  function foliaLatentClampAudioAmount(value) {
    return foliaLatentNormalizeAudio(value);
  }

  function foliaLatentEaseTowards(current, target, amount) {
    return current + (target - current) * amount;
  }

  function foliaLatentBroadbandEnergy(bass, lowMid, mid, vocal, treble) {
    var broadband = foliaLatentNormalizeAudio(bass) * 0.22
      + foliaLatentNormalizeAudio(lowMid) * 0.18
      + foliaLatentNormalizeAudio(mid) * 0.22
      + foliaLatentNormalizeAudio(vocal) * 0.28
      + foliaLatentNormalizeAudio(treble) * 0.1;
    return Math.pow(broadband, 0.55);
  }

  function foliaLatentOnsetPulse(currentEnergy, previousEnergy, previousPulse) {
    return Math.max(
      previousPulse * 0.84,
      foliaLatentClampAudioAmount((currentEnergy - previousEnergy) * 7)
    );
  }

  function foliaLatentBeatSpeedTarget(broadbandEnergy, onsetPulse) {
    return foliaLatentClampAudioAmount(broadbandEnergy * 0.42 + onsetPulse * 0.85);
  }

  function foliaLatentAudioSpeedTarget(broadbandEnergy, onsetPulse, enhancedBeatResponse) {
    return enhancedBeatResponse
      ? foliaLatentBeatSpeedTarget(broadbandEnergy, onsetPulse)
      : foliaLatentClampAudioAmount(broadbandEnergy);
  }

  function foliaLatentShaderSpeed(baseSpeed, audioSpeed, audioAmount, paused) {
    return foliaLatentClampShaderSpeed(
      paused
        ? baseSpeed * PAUSED_SPEED_SCALE
        : foliaLatentEaseTowards(baseSpeed, audioSpeed, audioAmount)
    );
  }

  /* ---- 颜色 ---- */

  function foliaLatentChannels(color) {
    if (typeof foliaParseColorChannels === 'function') {
      var viaCore = foliaParseColorChannels(color);
      if (viaCore) return viaCore;
    }
    var text = String(color == null ? '' : color).trim();
    var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
    if (!m) return null;
    var hex = m[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function foliaLatentColorVec4(color, alpha) {
    var a = isFinite(Number(alpha)) ? Math.min(1, Math.max(0, Number(alpha))) : 1;
    var channels = foliaLatentChannels(color);
    if (!channels) return [0, 0, 0, a];
    return [channels.r / 255, channels.g / 255, channels.b / 255, a];
  }

  /* LatentBackground.tsx:82-108 —— 逐字（primary 的兜底是 theme.secondaryColor，不是 primaryColor）。 */
  function foliaLatentResolveColors(coverColors, theme, colorSource) {
    var list = coverColors || [];
    var safeTheme = theme || {};
    var primary = list[0] || safeTheme.secondaryColor;
    if (colorSource === 'cover-only') {
      var secondaryOnly = list[1] || primary;
      var tertiaryOnly = list[2] || secondaryOnly;
      var quaternaryOnly = list[3] || primary;
      var quinary = list[4] || secondaryOnly;
      var senary = list[5] || tertiaryOnly;
      return {
        ditheringBack: tertiaryOnly,
        ditheringFront: primary,
        mesh: [primary, secondaryOnly, tertiaryOnly, quaternaryOnly, quinary, senary]
      };
    }
    var secondary = list[1] || safeTheme.primaryColor;
    var tertiary = list[2] || primary;
    var quaternary = list[3] || secondary;
    return {
      ditheringBack: safeTheme.backgroundColor,
      ditheringFront: primary,
      mesh: [primary, secondary, tertiary, quaternary, safeTheme.backgroundColor, safeTheme.accentColor]
    };
  }

  /* ---- 取色：colorPalette.ts 的加权中位切分 —— 逐字 ---- */

  var FOLIA_LATENT_QUANTIZATION_SHIFT = 4;
  var FOLIA_LATENT_MIN_ALPHA = 128;

  function foliaLatentChannelRange(colors, channel) {
    var min = 255;
    var max = 0;
    for (var i = 0; i < colors.length; i++) {
      if (colors[i][channel] < min) min = colors[i][channel];
      if (colors[i][channel] > max) max = colors[i][channel];
    }
    return max - min;
  }

  function foliaLatentSplitBucket(bucket) {
    if (bucket.colors.length < 2) return null;
    var ranges = {
      r: foliaLatentChannelRange(bucket.colors, 'r'),
      g: foliaLatentChannelRange(bucket.colors, 'g'),
      b: foliaLatentChannelRange(bucket.colors, 'b')
    };
    var channel = 'r';
    if (ranges.g > ranges[channel]) channel = 'g';
    if (ranges.b > ranges[channel]) channel = 'b';
    var sorted = bucket.colors.slice().sort(function (a, b) { return a[channel] - b[channel]; });
    var midpoint = bucket.weight / 2;
    var accumulatedWeight = 0;
    var splitIndex = 1;
    for (var index = 0; index < sorted.length - 1; index += 1) {
      accumulatedWeight += sorted[index].weight;
      splitIndex = index + 1;
      if (accumulatedWeight >= midpoint) break;
    }
    var left = sorted.slice(0, splitIndex);
    var right = sorted.slice(splitIndex);
    var sum = function (group) {
      var total = 0;
      for (var i = 0; i < group.length; i++) total += group[i].weight;
      return total;
    };
    return [
      { colors: left, weight: sum(left) },
      { colors: right, weight: sum(right) }
    ];
  }

  function foliaLatentAverageBucket(bucket) {
    var r = 0;
    var g = 0;
    var b = 0;
    for (var i = 0; i < bucket.colors.length; i++) {
      var color = bucket.colors[i];
      r += color.r * color.weight;
      g += color.g * color.weight;
      b += color.b * color.weight;
    }
    return {
      r: Math.round(r / bucket.weight),
      g: Math.round(g / bucket.weight),
      b: Math.round(b / bucket.weight),
      weight: bucket.weight
    };
  }

  function foliaLatentHex(channels) {
    var pair = function (value) {
      var text = Math.round(Math.min(255, Math.max(0, value))).toString(16);
      return text.length < 2 ? '0' + text : text;
    };
    return '#' + pair(channels.r) + pair(channels.g) + pair(channels.b);
  }

  function foliaLatentPaletteFromPixels(pixels, count) {
    var want = isFinite(Number(count)) ? Number(count) : PALETTE_COUNT;
    if (!pixels || want <= 0) return [];
    var histogram = {};
    var order = [];
    for (var index = 0; index + 3 < pixels.length; index += 4) {
      if (pixels[index + 3] < FOLIA_LATENT_MIN_ALPHA) continue;
      var r = pixels[index];
      var g = pixels[index + 1];
      var b = pixels[index + 2];
      var key = ((r >> FOLIA_LATENT_QUANTIZATION_SHIFT) << 8)
        | ((g >> FOLIA_LATENT_QUANTIZATION_SHIFT) << 4)
        | (b >> FOLIA_LATENT_QUANTIZATION_SHIFT);
      var existing = histogram[key];
      if (existing) {
        existing.r += r;
        existing.g += g;
        existing.b += b;
        existing.weight += 1;
      } else {
        histogram[key] = { r: r, g: g, b: b, weight: 1 };
        order.push(key);
      }
    }
    if (!order.length) return [];
    var colors = [];
    var totalWeight = 0;
    for (var o = 0; o < order.length; o++) {
      var bucketColor = histogram[order[o]];
      colors.push({
        r: Math.round(bucketColor.r / bucketColor.weight),
        g: Math.round(bucketColor.g / bucketColor.weight),
        b: Math.round(bucketColor.b / bucketColor.weight),
        weight: bucketColor.weight
      });
      totalWeight += bucketColor.weight;
    }
    var buckets = [{ colors: colors, weight: totalWeight }];
    var limit = Math.min(want, colors.length);
    while (buckets.length < limit) {
      var bucketIndex = -1;
      var bestScore = -1;
      for (var bi = 0; bi < buckets.length; bi += 1) {
        if (buckets[bi].colors.length < 2) continue;
        var widest = Math.max(
          foliaLatentChannelRange(buckets[bi].colors, 'r'),
          foliaLatentChannelRange(buckets[bi].colors, 'g'),
          foliaLatentChannelRange(buckets[bi].colors, 'b')
        );
        var score = widest * Math.sqrt(buckets[bi].weight);
        if (score > bestScore) {
          bestScore = score;
          bucketIndex = bi;
        }
      }
      if (bucketIndex < 0) break;
      var split = foliaLatentSplitBucket(buckets[bucketIndex]);
      if (!split) break;
      buckets.splice.apply(buckets, [bucketIndex, 1].concat(split));
    }
    var averaged = [];
    for (var ai = 0; ai < buckets.length; ai++) averaged.push(foliaLatentAverageBucket(buckets[ai]));
    averaged.sort(function (a, b) { return b.weight - a.weight; });
    var out = [];
    for (var hi = 0; hi < averaged.length; hi++) out.push(foliaLatentHex(averaged[hi]));
    return out;
  }

  /* 同源代理读出来的画布才是干净的：直接打 CDN 会污染 canvas，getImageData 抛 SecurityError。 */
  function foliaLatentCoverSrc(url) {
    if (!url) return '';
    try {
      if (typeof coverProxySrc === 'function') {
        var proxied = coverProxySrc(url);
        if (proxied) return proxied;
      }
    } catch (_) {}
    return String(url);
  }

  function foliaLatentLoadImagePixels(src) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.crossOrigin = 'Anonymous';
      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      image.onload = function () {
        var canvas = document.createElement('canvas');
        var context = null;
        try { context = canvas.getContext('2d'); } catch (_) { context = null; }
        if (!context) { finish(null); return; }
        canvas.width = PALETTE_SAMPLE_SIZE;
        canvas.height = PALETTE_SAMPLE_SIZE;
        try {
          context.drawImage(image, 0, 0, PALETTE_SAMPLE_SIZE, PALETTE_SAMPLE_SIZE);
          finish(context.getImageData(0, 0, PALETTE_SAMPLE_SIZE, PALETTE_SAMPLE_SIZE).data);
        } catch (err) {
          /* 跨源污染时 getImageData 抛错：不吞掉的话这个 Promise 永远不 resolve。 */
          finish(null);
        }
      };
      image.onerror = function () { finish(null); };
      image.src = src;
    });
  }

  /* ---- tuning：存档键与面板共用；没有存档就是 types.ts 的默认值 ---- */

  function foliaLatentNormalizeTuning(value) {
    var raw = (value && typeof value === 'object') ? value : {};
    var d = LATENT_TUNING_DEFAULT;
    return {
      displayMode: LATENT_DISPLAY_MODES.indexOf(raw.displayMode) >= 0 ? raw.displayMode : d.displayMode,
      colorSource: LATENT_COLOR_SOURCES.indexOf(raw.colorSource) >= 0 ? raw.colorSource : d.colorSource,
      dynamicOnlyInPlayer: typeof raw.dynamicOnlyInPlayer === 'boolean' ? raw.dynamicOnlyInPlayer : d.dynamicOnlyInPlayer,
      enhancedBeatResponse: typeof raw.enhancedBeatResponse === 'boolean' ? raw.enhancedBeatResponse : d.enhancedBeatResponse,
      ditheringSpeed: foliaLatentClampNumber(raw.ditheringSpeed, d.ditheringSpeed, 0, 2),
      ditheringAudioSpeed: foliaLatentClampNumber(raw.ditheringAudioSpeed, d.ditheringAudioSpeed, 0, 2),
      ditheringSize: foliaLatentClampNumber(raw.ditheringSize, d.ditheringSize, 0.5, 8),
      ditheringOpacity: foliaLatentClampNumber(raw.ditheringOpacity, d.ditheringOpacity, 0, 1),
      meshSpeed: foliaLatentClampNumber(raw.meshSpeed, d.meshSpeed, 0, 2),
      meshAudioSpeed: foliaLatentClampNumber(raw.meshAudioSpeed, d.meshAudioSpeed, 0, 2),
      meshDistortion: foliaLatentClampNumber(raw.meshDistortion, d.meshDistortion, 0, 2),
      meshSwirl: foliaLatentClampNumber(raw.meshSwirl, d.meshSwirl, 0, 1),
      overlayEnabled: typeof raw.overlayEnabled === 'boolean' ? raw.overlayEnabled : d.overlayEnabled,
      overlayOpacity: foliaLatentClampNumber(raw.overlayOpacity, d.overlayOpacity, 0, 1)
    };
  }

  var foliaLatentTuningCache = null;

  function foliaLatentTuning() {
    if (foliaLatentTuningCache) return foliaLatentTuningCache;
    var raw = null;
    try {
      var text = window.localStorage ? window.localStorage.getItem(TUNING_STORE_KEY) : null;
      if (text) raw = JSON.parse(text);
    } catch (_) { raw = null; }
    foliaLatentTuningCache = foliaLatentNormalizeTuning(raw);
    return foliaLatentTuningCache;
  }

  /* ---- 面板写入口（0l-folia-tuning-panel.js 经 window 调用）----
   * 语义与 lumiere 一致：set 合并后整份再归一化（tuning 对象不可变，运行时靠身份早退），
   * save 落盘，reset 回默认。改完由面板负责 foliaWorldRebuildBackground（tuning 在创建时读一次）。 */
  function foliaLatentSetTuning(patch) {
    var merged = {};
    var base = foliaLatentTuning();
    var k;
    for (k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
    }
    if (patch) {
      for (k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
      }
    }
    foliaLatentTuningCache = foliaLatentNormalizeTuning(merged);
    return foliaLatentTuningCache;
  }

  function foliaLatentSaveTuning() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(TUNING_STORE_KEY, JSON.stringify(foliaLatentTuning()));
      }
    } catch (_) {}
  }

  function foliaLatentResetTuning() {
    foliaLatentTuningCache = foliaLatentNormalizeTuning(null);
    foliaLatentSaveTuning();
  }

  window.foliaLatentTuning = foliaLatentTuning;
  window.foliaLatentSetTuning = foliaLatentSetTuning;
  window.foliaLatentSaveTuning = foliaLatentSaveTuning;
  window.foliaLatentResetTuning = foliaLatentResetTuning;

  /* ---- WebGL2 装配 ---- */

  function foliaLatentCompile(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) throw new Error('隐现着色器创建失败');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('隐现着色器编译失败：' + (log || 'unknown'));
    }
    return shader;
  }

  function foliaLatentBuildProgram(gl, fragmentSource) {
    var vs = foliaLatentCompile(gl, gl.VERTEX_SHADER, FOLIA_LATENT_VERTEX_SHADER);
    var fs = foliaLatentCompile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    if (!program) throw new Error('隐现着色器程序创建失败');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('隐现着色器链接失败：' + (log || 'unknown'));
    }
    return program;
  }

  var FOLIA_LATENT_UNIFORM_NAMES = [
    'u_time', 'u_resolution', 'u_pixelRatio', 'u_imageAspectRatio',
    'u_originX', 'u_originY', 'u_worldWidth', 'u_worldHeight',
    'u_fit', 'u_scale', 'u_rotation', 'u_offsetX', 'u_offsetY',
    'u_pxSize', 'u_colorBack', 'u_colorFront', 'u_shape', 'u_type',
    'u_colors', 'u_colorsCount', 'u_distortion', 'u_swirl', 'u_grainMixer', 'u_grainOverlay'
  ];

  function foliaLatentCollectLocations(gl, program) {
    var loc = {};
    for (var i = 0; i < FOLIA_LATENT_UNIFORM_NAMES.length; i++) {
      var name = FOLIA_LATENT_UNIFORM_NAMES[i];
      loc[name] = gl.getUniformLocation(program, name);
    }
    return loc;
  }

  function foliaLatentSet1f(layer, name, value) {
    var location = layer.loc[name];
    if (location) layer.gl.uniform1f(location, value);
  }

  function foliaLatentSet4fv(layer, name, value) {
    var location = layer.loc[name];
    if (location) layer.gl.uniform4fv(location, value);
  }

  /* ShaderMount.handleResize：minPixelRatio=1、maxPixelCount=1280*720，
   * 于是缩放系数 = min(1, sqrt(maxPixelCount / (css×dpr 的像素数)))。 */
  function foliaLatentResize(layer) {
    var canvas = layer.canvas;
    var cssWidth = Math.max(1, Math.round(Number(canvas.clientWidth) || 0));
    var cssHeight = Math.max(1, Math.round(Number(canvas.clientHeight) || 0));
    var dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    var targetWidth = cssWidth * dpr;
    var targetHeight = cssHeight * dpr;
    var headroom = Math.sqrt(MAX_SHADER_PIXELS) / Math.sqrt(Math.max(1, targetWidth * targetHeight));
    var scale = Math.min(1, headroom);
    var width = Math.max(1, Math.round(targetWidth * scale));
    var height = Math.max(1, Math.round(targetHeight * scale));
    var ratio = width / cssWidth;
    if (canvas.width === width && canvas.height === height && layer.pixelRatio === ratio) return false;
    canvas.width = width;
    canvas.height = height;
    layer.pixelRatio = ratio;
    return true;
  }

  /* 尺寸类 uniform 是常量（origin 0.5 / world 0 / scale 1 / rotation 0 / offset 0），
   * fit：流体是 object 系（contain=1），像素是 pattern 系（none=0）—— 见 shader-sizing.js。
   * grain 两个值也是构造参数（LatentBackground.tsx:296-297 写死 0 / 0.01），不是每帧量。 */
  function foliaLatentApplySizing(layer, fit) {
    layer.gl.useProgram(layer.prog);
    foliaLatentSet1f(layer, 'u_originX', 0.5);
    foliaLatentSet1f(layer, 'u_originY', 0.5);
    foliaLatentSet1f(layer, 'u_worldWidth', 0);
    foliaLatentSet1f(layer, 'u_worldHeight', 0);
    foliaLatentSet1f(layer, 'u_fit', fit);
    foliaLatentSet1f(layer, 'u_scale', 1);
    foliaLatentSet1f(layer, 'u_rotation', 0);
    foliaLatentSet1f(layer, 'u_offsetX', 0);
    foliaLatentSet1f(layer, 'u_offsetY', 0);
    foliaLatentSet1f(layer, 'u_imageAspectRatio', 1);
    foliaLatentSet1f(layer, 'u_grainMixer', 0);
    foliaLatentSet1f(layer, 'u_grainOverlay', 0.01);
  }

  function foliaLatentDraw(layer) {
    var gl = layer.gl;
    if (!gl) return;
    if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return;
    var resized = foliaLatentResize(layer);
    gl.viewport(0, 0, layer.canvas.width, layer.canvas.height);
    gl.useProgram(layer.prog);
    /* ShaderMount.render：u_time 是毫秒累加值的千分之一。 */
    foliaLatentSet1f(layer, 'u_time', layer.frame * 1e-3);
    if (resized || layer.resolutionDirty) {
      var res = layer.loc.u_resolution;
      if (res) gl.uniform2f(res, layer.canvas.width, layer.canvas.height);
      foliaLatentSet1f(layer, 'u_pixelRatio', layer.pixelRatio);
      layer.resolutionDirty = false;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    layer.drawCount += 1;
  }

  function foliaLatentDestroyLayer(layer) {
    if (!layer) return;
    var gl = layer.gl;
    try {
      if (layer.buffer) gl.deleteBuffer(layer.buffer);
      if (layer.prog) gl.deleteProgram(layer.prog);
      var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (_) {}
    if (layer.el && layer.el.parentNode) layer.el.parentNode.removeChild(layer.el);
  }

  function foliaLatentCreateLayer(className, canvasName, fit, fragmentSource) {
    var el = document.createElement('div');
    el.className = className;
    var canvas = document.createElement('canvas');
    canvas.className = 'folia-bg-canvas';
    canvas.setAttribute('data-folia-bg-canvas', canvasName);
    el.appendChild(canvas);

    var gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: true, powerPreference: 'low-power',
        preserveDrawingBuffer: true
      }) || null;
    } catch (_) { gl = null; }
    if (!gl) {
      if (el.parentNode) el.parentNode.removeChild(el);
      throw new Error('「隐现」背景需要 WebGL2，当前环境不可用');
    }

    var prog = foliaLatentBuildProgram(gl, fragmentSource);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    /* 两个三角形铺满裁剪空间（ShaderMount.setupPositionAttribute 的同一组顶点）。 */
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var layer = {
      key: canvasName,
      el: el,
      canvas: canvas,
      gl: gl,
      prog: prog,
      buffer: buffer,
      loc: foliaLatentCollectLocations(gl, prog),
      frame: 0,
      speed: 0,
      drawCount: 0,
      pixelRatio: 0,
      resolutionDirty: true
    };
    foliaLatentApplySizing(layer, fit);
    return layer;
  }

  /* ---- DOM ---- */

  function foliaLatentEl(className) {
    var node = document.createElement('div');
    node.className = className;
    return node;
  }

  function foliaLatentApplyBlend(inst) {
    var dither = inst.layers.dither;
    if (!dither) return;
    dither.el.style.mixBlendMode = inst.showMesh ? 'soft-light' : 'normal';
    dither.el.style.opacity = String(inst.showMesh ? inst.tuning.ditheringOpacity : 1);
  }

  function foliaLatentApplyOverlay(inst) {
    var overlay = inst.overlay;
    if (!overlay) return;
    var tuning = inst.tuning;
    var visible = !!tuning.overlayEnabled && tuning.overlayOpacity > 0;
    overlay.style.display = visible ? '' : 'none';
    overlay.style.opacity = String(visible ? tuning.overlayOpacity : 0);
  }

  function foliaLatentApplyTheme(inst) {
    var theme = inst.theme || {};
    inst.root.style.backgroundColor = theme.backgroundColor || '#05070b';
    inst.overlay.style.backgroundColor = theme.backgroundColor || '#05070b';
    foliaLatentApplyColors(inst);
  }

  function foliaLatentApplyColors(inst) {
    var colors = foliaLatentResolveColors(inst.coverColors, inst.theme || {}, inst.tuning.colorSource);
    inst.colors = colors;

    var mesh = inst.layers.mesh;
    if (mesh) {
      var flat = new Float32Array(MESH_MAX_COLORS * 4);
      var count = Math.min(MESH_MAX_COLORS, colors.mesh.length);
      for (var i = 0; i < count; i++) {
        var vec = foliaLatentColorVec4(colors.mesh[i]);
        flat[i * 4] = vec[0];
        flat[i * 4 + 1] = vec[1];
        flat[i * 4 + 2] = vec[2];
        flat[i * 4 + 3] = vec[3];
      }
      mesh.gl.useProgram(mesh.prog);
      foliaLatentSet4fv(mesh, 'u_colors', flat);
      foliaLatentSet1f(mesh, 'u_colorsCount', count);
    }

    var dither = inst.layers.dither;
    if (dither) {
      dither.gl.useProgram(dither.prog);
      foliaLatentSet4fv(dither, 'u_colorBack', foliaLatentColorVec4(colors.ditheringBack));
      foliaLatentSet4fv(dither, 'u_colorFront', foliaLatentColorVec4(colors.ditheringFront));
      foliaLatentSet1f(dither, 'u_shape', DITHERING_SHAPE_WARP);
      foliaLatentSet1f(dither, 'u_type', DITHERING_TYPE_4X4);
    }
  }

  function foliaLatentBuildLayers(inst) {
    foliaLatentDestroyLayers(inst);
    inst.layers = {};
    if (inst.showMesh) {
      var mesh = foliaLatentCreateLayer('folia-bg-latent-mesh', 'latent-mesh', 1, FOLIA_LATENT_MESH_SHADER);
      mesh.el.style.transform = 'scale(1.025)';
      inst.root.insertBefore(mesh.el, inst.overlay);
      inst.layers.mesh = mesh;
    }
    if (inst.showDithering) {
      var dither = foliaLatentCreateLayer('folia-bg-latent-dither', 'latent-dither', 0, FOLIA_LATENT_DITHERING_SHADER);
      dither.el.style.transform = 'scale(1.015)';
      inst.root.insertBefore(dither.el, inst.overlay);
      inst.layers.dither = dither;
    }
    foliaLatentApplyBlend(inst);
    foliaLatentApplyColors(inst);
  }

  function foliaLatentDestroyLayers(inst) {
    if (!inst.layers) return;
    if (inst.layers.mesh) foliaLatentDestroyLayer(inst.layers.mesh);
    if (inst.layers.dither) foliaLatentDestroyLayer(inst.layers.dither);
    inst.layers = {};
  }

  function foliaLatentRefreshSizes(inst) {
    if (inst.layers.mesh) foliaLatentResize(inst.layers.mesh);
    if (inst.layers.dither) foliaLatentResize(inst.layers.dither);
  }

  /* ---- 取色（异步，落地后换 uniform；销毁或换封面时旧结果作废） ---- */

  function foliaLatentLoadPalette(inst) {
    var src = foliaLatentCoverSrc(inst.coverUrl);
    inst.paletteToken = (inst.paletteToken || 0) + 1;
    var token = inst.paletteToken;
    if (!src) {
      inst.coverColors = [];
      inst.paletteReady = true;
      foliaLatentApplyColors(inst);
      return;
    }
    foliaLatentLoadImagePixels(src).then(function (pixels) {
      if (inst.destroyed || token !== inst.paletteToken) return;
      inst.coverColors = pixels ? foliaLatentPaletteFromPixels(pixels, PALETTE_COUNT) : [];
      inst.paletteReady = true;
      foliaLatentApplyColors(inst);
    }, function () {
      if (inst.destroyed || token !== inst.paletteToken) return;
      inst.coverColors = [];
      inst.paletteReady = true;
      foliaLatentApplyColors(inst);
    });
  }

  /* ---- 生命周期 ---- */

  function foliaLatentCreate(host, ctx) {
    var tuning = foliaLatentTuning();
    var root = foliaLatentEl('folia-bg-latent');
    var overlay = foliaLatentEl('folia-bg-latent-overlay');
    root.appendChild(overlay);

    var inst = {
      root: root,
      overlay: overlay,
      layers: {},
      tuning: tuning,
      showMesh: tuning.displayMode !== 'dithering',
      showDithering: tuning.displayMode !== 'mesh',
      theme: (ctx && ctx.theme) || null,
      coverUrl: String((ctx && ctx.song && ctx.song.coverUrl) || ''),
      coverColors: [],
      colors: null,
      paletteToken: 0,
      paletteReady: false,
      smooth: { power: 0, bass: 0, mid: 0, beatSpeed: 0 },
      previousBeatEnergy: 0,
      onsetPulse: 0,
      paused: false,
      styleCache: {},
      destroyed: false
    };

    /* 主题色先落地，再建图层：create 阶段就要有底色，否则首帧是空白。 */
    foliaLatentApplyTheme(inst);
    try {
      foliaLatentBuildLayers(inst);
    } catch (err) {
      foliaLatentDestroyLayers(inst);
      if (root.parentNode) root.parentNode.removeChild(root);
      throw err;
    }
    host.appendChild(root);
    /* ShaderMount 在构造函数里就做过一次 handleResize：宿主一进 DOM 就取尺寸，
     * 否则首帧是按 300×150（canvas 默认值）画的，要等下一帧才纠正。 */
    foliaLatentRefreshSizes(inst);
    foliaLatentApplyOverlay(inst);
    foliaLatentSetPaused(inst, !!(ctx && ctx.paused));
    foliaLatentLoadPalette(inst);
    return inst;
  }

  function foliaLatentSetPaused(inst, paused) {
    if (inst.paused === paused) return;
    inst.paused = paused;
    if (paused) inst.root.classList.add('is-paused');
    else inst.root.classList.remove('is-paused');
  }

  function foliaLatentSetStyle(inst, key, prop, value) {
    var cache = inst.styleCache[key];
    if (!cache) {
      cache = {};
      inst.styleCache[key] = cache;
    }
    if (cache[prop] === value) return;
    cache[prop] = value;
    var layer = inst.layers[key];
    if (layer) layer.el.style[prop] = value;
  }

  function foliaLatentAdvance(layer, speed, dtMs) {
    layer.speed = speed;
    if (speed === 0 || !(dtMs > 0)) return;
    layer.frame += dtMs * speed;
  }

  function foliaLatentTick(inst, ctx) {
    if (!inst || inst.destroyed) return;

    var theme = (ctx && ctx.theme) || null;
    if (theme && theme !== inst.theme) {
      inst.theme = theme;
      foliaLatentApplyTheme(inst);
    }

    foliaLatentSetPaused(inst, !!(ctx && ctx.paused));

    var dt = (ctx && isFinite(ctx.dt)) ? Number(ctx.dt) : 0;
    var dtMs = dt * 1000;
    if (dtMs > MAX_FRAME_STEP_MS) dtMs = MAX_FRAME_STEP_MS;
    if (dtMs < 0) dtMs = 0;

    var paused = inst.paused;
    var bands = (ctx && ctx.audioBands) || {};
    var power = (ctx && ctx.audio && ctx.audio.power) || 0;
    var tuning = inst.tuning;

    var targetPower = paused ? 0 : foliaLatentNormalizeAudio(power);
    var targetBass = paused ? 0 : foliaLatentNormalizeAudio(bands.bass);
    var targetBeatEnergy = paused
      ? 0
      : foliaLatentBroadbandEnergy(bands.bass, bands.lowMid, bands.mid, bands.vocal, bands.treble);
    var targetMid = paused
      ? 0
      : foliaLatentNormalizeAudio(Math.max(Number(bands.mid) || 0, Number(bands.vocal) || 0));

    inst.smooth.power = foliaLatentEaseTowards(inst.smooth.power, targetPower, 0.12);
    inst.smooth.bass = foliaLatentEaseTowards(inst.smooth.bass, targetBass, 0.16);
    inst.smooth.mid = foliaLatentEaseTowards(inst.smooth.mid, targetMid, 0.13);
    inst.onsetPulse = tuning.enhancedBeatResponse
      ? foliaLatentOnsetPulse(targetBeatEnergy, inst.previousBeatEnergy, inst.onsetPulse)
      : 0;
    inst.previousBeatEnergy = targetBeatEnergy;
    var beatSpeedTarget = foliaLatentAudioSpeedTarget(
      targetBeatEnergy,
      inst.onsetPulse,
      tuning.enhancedBeatResponse
    );
    inst.smooth.beatSpeed = foliaLatentEaseTowards(
      inst.smooth.beatSpeed,
      beatSpeedTarget,
      beatSpeedTarget > inst.smooth.beatSpeed ? 0.42 : 0.14
    );

    var smoothed = inst.smooth;

    if (inst.layers.mesh) {
      var meshSpeed = foliaLatentShaderSpeed(
        tuning.meshSpeed,
        tuning.meshAudioSpeed,
        smoothed.beatSpeed,
        paused
      );
      foliaLatentSet1f(inst.layers.mesh, 'u_distortion', tuning.meshDistortion + smoothed.power * 0.62);
      foliaLatentSet1f(inst.layers.mesh, 'u_swirl', tuning.meshSwirl + smoothed.mid * 0.38);
      foliaLatentAdvance(inst.layers.mesh, meshSpeed, dtMs);
      foliaLatentSetStyle(inst, 'mesh', 'filter',
        'saturate(' + (1.04 + smoothed.mid * 0.34) + ') brightness(' + (0.94 + smoothed.power * 0.16) + ')');
      foliaLatentSetStyle(inst, 'mesh', 'transform', 'scale(' + (1.025 + smoothed.power * 0.018) + ')');
    }

    if (inst.layers.dither) {
      var ditherSpeed = foliaLatentShaderSpeed(
        tuning.ditheringSpeed,
        tuning.ditheringAudioSpeed,
        smoothed.beatSpeed,
        paused
      );
      foliaLatentSet1f(inst.layers.dither, 'u_pxSize',
        Math.max(0.5, tuning.ditheringSize - smoothed.bass * tuning.ditheringSize * 0.34));
      foliaLatentAdvance(inst.layers.dither, ditherSpeed, dtMs);
      foliaLatentSetStyle(inst, 'dither', 'opacity',
        String(inst.showMesh ? Math.min(1, tuning.ditheringOpacity + smoothed.bass * 0.25) : 1));
      foliaLatentSetStyle(inst, 'dither', 'transform', 'scale(' + (1.015 + smoothed.bass * 0.025) + ')');
    }

    if (inst.layers.mesh) foliaLatentDraw(inst.layers.mesh);
    if (inst.layers.dither) foliaLatentDraw(inst.layers.dither);
  }

  function foliaLatentDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    foliaLatentDestroyLayers(inst);
    if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
  }

  /* 名字 / 排序取 Folia 权威值：
   *   options.visualizerBackgroundModeLatent = 隐现（zh-CN.ts:2085）
   *   latent/entry.tsx: order 35 / labelFallback 'Latent' / Folia 的默认背景
   * 描述取 zh-CN.ts:470 的 pickerDescription。 */
  registerFoliaBackground('latent', {
    name: '隐现',
    desc: '封面取色的像素与流体双层着色器，随音频起伏涨落',
    order: 35,
    needsWebGL2: true,
    create: foliaLatentCreate,
    tick: foliaLatentTick,
    destroy: foliaLatentDestroy
  });
})();
