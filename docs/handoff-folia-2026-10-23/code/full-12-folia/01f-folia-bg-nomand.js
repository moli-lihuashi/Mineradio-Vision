/* Folia 背景 — 漫游（nomand）：把封面喂给五种 Paper 图片效果（像素画 / 纹理玻璃 / 纸张纹理 / 半调网点 / 镜头畸变）
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/nomand/）：
 *   entry.tsx（71）                     → mode 'nomand' / order 30 / 默认背景 / 快捷开关只有 overlay
 *   NomandBackgroundLayer.tsx（1019… 实为 169）→ 五个 @paper-design/shaders-react 组件 + overlay 纯色压暗
 *   nomandShaderAdjustments.ts（122）   → 明暗自适应反色、纸张预放大、镜头预放大
 *   NomandBackgroundSettingsCard.tsx（288）/ 5 个效果面板 → 本轮不做面板
 *
 * 着色器原文来自 @paper-design/shaders 0.0.80（package-lock.json 里 Folia 锁的版本）：
 *   dist/vertex-shader.js          → v_imageUV（fit=cover、scale=1、rotation=0、offset=0、origin=.5 的特化）
 *   dist/shaders/image-dithering.js → imageDitheringFragmentShader（2x2/4x4/8x8 Bayer + 色阶量化）
 *   dist/shaders/fluted-glass.js    → flutedGlassFragmentShader（线条 + prism 扭曲 + 竖直高斯模糊）
 *   dist/shaders/paper-texture.js   → paperTextureFragmentShader（折痕 / 褶皱 / 水滴 / 纤维法线）
 *   dist/shaders/halftone-dots.js   → halftoneDotsFragmentShader（hex 网格 gooey 网点）
 *   dist/shaders/lens-distortion.js → lensDistortionFragmentShader（20 次色散采样 + tan 凸透镜）
 *   dist/shader-utils.js            → declarePI / rotate / hash21
 *   dist/get-shader-noise-texture.js → 128×128 噪声贴图（本仓库 01e-folia-bg-noise-texture.js）
 *   dist/shader-mount.js            → 尺寸换算（minPixelRatio 1 / maxPixelCount 1920×1080）、
 *                                     u_imageAspectRatio = naturalWidth/naturalHeight、u_image 带 mipmap
 *
 * 必须照抄的判据
 * --------------
 * 1. 着色器**逐字搬**（Bayer 表、hash 常数、mipmap、prism 的 pow(1.5x,3)、纸纹的 0.02 法线位移、
 *    网点的 mix(300,7,pow(size,.7)) 与 stepMultiplier 2/6、镜头畸变的 tan 映射与 1.45 淡出阈值）。
 * 2. 每档效果的**固定参数**不是可调项，必须写死（NomandBackgroundLayer.tsx:64-145）：
 *       fluted-glass：shape=lines、distortionShape=prism、shadows .25、highlights .1、edges .25
 *       paper-texture：fiberSize .2、crumples .35、crumpleSize .35、folds .65、foldCount 5、drops .2、seed 5.8
 *       halftone-dots：grid=hex、type=gooey、grainMixer .12、grainOverlay .06、grainSize .5
 *       lens-distortion：perspective .4、count 20、focusCenter .55、focusEdges .8、swirl .08、lensCircle .1
 *     其余未指定的 uniform 取 shaders-react 的 defaultPreset（lens 的 bias=1、dispersionColor=.6 等）。
 * 3. 配色只取主题四个色：背景色 / 主色 / 次色 / 强调色 —— 逐档照 entry 里的传参（见 foliaNomandApplyColors）。
 * 4. 明暗自适应反色（nomandShaderAdjustments.ts:51-67）：
 *       像素画 inverted' = isDaylight && !originalColors ? !inverted : inverted
 *       半调网点 inverted' = 上面那条**再取反一次**（网点画的是 colorFront，与像素画亮度约定相反）
 * 5. 预放大（防止扭曲采样跑到图外露底色）：
 *       纸张 scale = 1 / (1 - 2·clamp(0.02·maxNormal, 0, .45)) + 0.01，上限 1.8；
 *       镜头 scale 先抬到「四角不被淡出」的下界再二分，上限 1.8；bulge<=0 时只按 headroom 兜底。
 * 6. 没有封面时 Folia 只画一块主题背景色（不挂着色器），这里同样不建画布。
 * 7. speed=0 / frame=0（Folia 没传 speed，默认就是 0）：五档效果**都是静态图**，
 *    u_time 恒为 0，只在尺寸或参数变化时重画一次 —— 不占每帧渲染预算。
 *
 * 与 Folia 的实现差异（都不是视觉差异）
 * ------------------------------------
 * 1. 不用 @paper-design/shaders-react（React 组件 + 自带 rAF）：这里手写 WebGL2 上下文，
 *    画布**不另起循环**，由世界 tick 在 needsDraw 为真时画一帧。
 * 2. 图片来源走本项目的同源代理 coverProxySrc：跨源图没带 CORS 时 texImage2D 会抛 SecurityError。
 * 3. 上传图（imageSource='uploaded-global'）在 Folia 里是共享的「自定义背景图」资产；
 *    本项目还没有上传器，先用 window.foliaNomandCustomImage = { id, url } 这个外部入口等价替代，
 *    解析顺序与 Folia 一致（uploaded 优先，取不到回落封面）。
 * 4. tuning 在创建背景时读一次快照（与 Folia 从 config 取 tuning 同义），面板接上后由
 *    foliaNomandSetTuning 即时改；换效果会重建画布（Folia 是 key={url:effect} 重挂组件）。
 * 5. shader-mount 的 setMinImageSize 只把 <img> 的 width/height 属性抬到 1024（给 2D 绘制用），
 *    不影响 texImage2D 取的原始尺寸 —— 这里不做，视觉与贴图内容完全一致。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaBackground !== 'function') return;

  /* NomandBackgroundLayer.tsx:58-59 —— commonProps 的尺寸约束（minPixelRatio 1 / maxPixelCount 1920×1080）。 */
  var MAX_SHADER_PIXELS = 1920 * 1080;
  /* 源码里没有独立上限，但同一档效果的预放大本身以 1.8 封顶（nomandShaderAdjustments.ts:7）。 */
  var MAX_OVERSCAN = 1.8;
  var OVERSCAN_MARGIN = 0.01;
  var REFERENCE_ASPECT = 16 / 9;

  /* paper-texture 里不开放给用户的固定形状参数（nomandShaderAdjustments.ts:17-25）。 */
  var NOMAND_PAPER_TEXTURE_SHAPE = {
    fiberSize: 0.2,
    crumples: 0.35,
    crumpleSize: 0.35,
    folds: 0.65,
    foldCount: 5,
    drops: 0.2,
    seed: 5.8
  };

  /* LensDistortion 里固定的镜头形状参数（nomandShaderAdjustments.ts:28-35）。 */
  var NOMAND_LENS_SHAPE = {
    perspective: 0.4,
    count: 20,
    focusCenter: 0.55,
    focusEdges: 0.8,
    swirl: 0.08,
    lensCircle: 0.1
  };

  /* 枚举 → uniform 数值（shaders 包里 DitheringTypes / GlassGridShapes / GlassDistortionShapes /
   * HalftoneDotsTypes / HalftoneDotsGrids 的原始取值，不是下标）。 */
  var NOMAND_DITHERING_TYPES = { '2x2': 2, '4x4': 3, '8x8': 4 };
  var NOMAND_DITHERING_TYPE_KEYS = ['2x2', '4x4', '8x8'];
  var NOMAND_GLASS_SHAPE_LINES = 1;
  var NOMAND_GLASS_DISTORTION_PRISM = 1;
  var NOMAND_HALFTONE_TYPE_GOOEY = 1;
  var NOMAND_HALFTONE_GRID_HEX = 1;
  /* fit（shader-sizing.js）：none 0 / contain 1 / cover 2。五档效果都是 cover。 */
  var NOMAND_FIT_COVER = 2;

  var NOMAND_EFFECTS = ['dithering', 'fluted-glass', 'paper-texture', 'halftone-dots', 'lens-distortion'];
  var NOMAND_SOURCES = ['cover-derived', 'uploaded-global'];
  var NOMAND_TUNING_STORE_KEY = 'mineradio-folia-nomand-tuning-v1';

  /* types.ts:1019 DEFAULT_NOMAND_BACKGROUND_TUNING —— 22 项逐字。 */
  var NOMAND_TUNING_DEFAULT = {
    imageSource: 'cover-derived',
    effect: 'dithering',
    ditheringType: '8x8',
    size: 3,
    colorSteps: 4,
    originalColors: false,
    inverted: false,
    flutedGlassSize: 0.5,
    flutedGlassDistortion: 0.5,
    flutedGlassBlur: 0.08,
    paperTextureContrast: 0.32,
    paperTextureRoughness: 0.42,
    paperTextureFiber: 0.3,
    halftoneDotsSize: 0.5,
    halftoneDotsRadius: 1.25,
    halftoneDotsContrast: 0.4,
    halftoneDotsOriginalColors: false,
    halftoneDotsInverted: false,
    lensDistortionSpread: 0.45,
    lensDistortionBulge: 0.3,
    lensDistortionDispersion: 0.65,
    overlayEnabled: true,
    overlayOpacity: 0.35
  };

  /* ================= 着色器原文 ================= */

  /* vertex-shader.js:46-156 的特化：origin (.5,.5) / scale 1 / rotation 0 / offset 0 / fit cover，
   * 于是 boxOrigin 与 graphicOffset 都是 0、graphicRotation 是单位阵、u_scale 是 1，
   * v_imageUV 只剩「imageBoxScale → +.5 → 翻 y」三步。五档效果都只用这一个 varying。 */
  var FOLIA_NOMAND_VERTEX_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'layout(location = 0) in vec4 a_position;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_imageAspectRatio;',
    '',
    'out vec2 v_imageUV;',
    '',
    'void main() {',
    '  gl_Position = a_position;',
    '',
    '  vec2 uv = gl_Position.xy * .5;',
    '',
    '  vec2 imageBoxSize;',
    '  imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;',
    '  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;',
    '  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;',
    '',
    '  v_imageUV = uv;',
    '  v_imageUV *= imageBoxScale;',
    '  v_imageUV += .5;',
    '  v_imageUV.y = 1. - v_imageUV.y;',
    '}'
  ].join('\n');

  /* shader-utils.js:6-9 declarePI。 */
  var FOLIA_NOMAND_GLSL_PI = [
    '#define TWO_PI 6.28318530718',
    '#define PI 3.14159265358979323846'
  ].join('\n');

  /* shader-utils.js:10-14 rotation2。 */
  var FOLIA_NOMAND_GLSL_ROTATE = [
    'vec2 rotate(vec2 uv, float th) {',
    '  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;',
    '}'
  ].join('\n');

  /* shader-utils.js:22-28 proceduralHash21。 */
  var FOLIA_NOMAND_GLSL_HASH21 = [
    '  float hash21(vec2 p) {',
    '    p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;',
    '    p += dot(p, p + 19.19);',
    '    return fract(p.x * p.y);',
    '  }'
  ].join('\n');

  /* image-dithering / halftone-dots 共用的 valueNoise（两处原文相同）。 */
  var FOLIA_NOMAND_GLSL_VALUE_NOISE = [
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
    '}'
  ].join('\n');

  /* image-dithering.js:43-52 / halftone-dots.js:113-122 的 getUvFrame(vec2, vec2) —— 两份原文逐字相同。 */
  var FOLIA_NOMAND_GLSL_UV_FRAME_PAD = [
    'float getUvFrame(vec2 uv, vec2 pad) {',
    '  float aa = 0.0001;',
    '',
    '  float left   = smoothstep(-pad.x, -pad.x + aa, uv.x);',
    '  float right  = smoothstep(1.0 + pad.x, 1.0 + pad.x - aa, uv.x);',
    '  float bottom = smoothstep(-pad.y, -pad.y + aa, uv.y);',
    '  float top    = smoothstep(1.0 + pad.y, 1.0 + pad.y - aa, uv.y);',
    '',
    '  return left * right * bottom * top;',
    '}'
  ].join('\n');

  /* image-dithering.js:8-190 —— 逐字（含 bayer2x2/4x4/8x8 三张表与色阶量化）。 */
  var FOLIA_NOMAND_DITHERING_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_pixelRatio;',
    'uniform float u_originX;',
    'uniform float u_originY;',
    'uniform float u_worldWidth;',
    'uniform float u_worldHeight;',
    'uniform float u_fit;',
    '',
    'uniform float u_scale;',
    'uniform float u_rotation;',
    'uniform float u_offsetX;',
    'uniform float u_offsetY;',
    '',
    'uniform vec4 u_colorFront;',
    'uniform vec4 u_colorBack;',
    'uniform vec4 u_colorHighlight;',
    '',
    'uniform sampler2D u_image;',
    'uniform float u_imageAspectRatio;',
    '',
    'uniform float u_type;',
    'uniform float u_pxSize;',
    'uniform bool u_originalColors;',
    'uniform bool u_inverted;',
    'uniform float u_colorSteps;',
    '',
    'out vec4 fragColor;',
    '',
    '',
    FOLIA_NOMAND_GLSL_HASH21,
    FOLIA_NOMAND_GLSL_PI,
    '',
    FOLIA_NOMAND_GLSL_UV_FRAME_PAD,
    '',
    'vec2 getImageUV(vec2 uv) {',
    '  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);',
    '  float r = u_rotation * PI / 180.;',
    '  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));',
    '  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);',
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
    '  vec2 imageUV = uv;',
    '  imageUV *= imageBoxScale;',
    '  imageUV += boxOrigin * (imageBoxScale - 1.);',
    '  imageUV += graphicOffset;',
    '  imageUV /= u_scale;',
    '  imageUV.x *= u_imageAspectRatio;',
    '  imageUV = graphicRotation * imageUV;',
    '  imageUV.x /= u_imageAspectRatio;',
    '',
    '  imageUV += .5;',
    '  imageUV.y = 1. - imageUV.y;',
    '',
    '  return imageUV;',
    '}',
    '',
    'const int bayer2x2[4] = int[4](0, 2, 3, 1);',
    'const int bayer4x4[16] = int[16](',
    '0, 8, 2, 10,',
    '12, 4, 14, 6,',
    '3, 11, 1, 9,',
    '15, 7, 13, 5',
    ');',
    '',
    'const int bayer8x8[64] = int[64](',
    '0, 32, 8, 40, 2, 34, 10, 42,',
    '48, 16, 56, 24, 50, 18, 58, 26,',
    '12, 44, 4, 36, 14, 46, 6, 38,',
    '60, 28, 52, 20, 62, 30, 54, 22,',
    '3, 35, 11, 43, 1, 33, 9, 41,',
    '51, 19, 59, 27, 49, 17, 57, 25,',
    '15, 47, 7, 39, 13, 45, 5, 37,',
    '63, 31, 55, 23, 61, 29, 53, 21',
    ');',
    '',
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
    '}',
    '',
    '',
    'void main() {',
    '',
    '  float pxSize = u_pxSize * u_pixelRatio;',
    '  vec2 pxSizeUV = gl_FragCoord.xy - .5 * u_resolution;',
    '  pxSizeUV /= pxSize;',
    '  vec2 canvasPixelizedUV = (floor(pxSizeUV) + .5) * pxSize;',
    '  vec2 normalizedUV = canvasPixelizedUV / u_resolution;',
    '',
    '  vec2 imageUV = getImageUV(normalizedUV);',
    '  vec2 ditheringNoiseUV = canvasPixelizedUV;',
    '  vec4 image = texture(u_image, imageUV);',
    '  float frame = getUvFrame(imageUV, pxSize / u_resolution);',
    '',
    '  int type = int(floor(u_type));',
    '  float dithering = 0.0;',
    '',
    '  float lum = dot(vec3(.2126, .7152, .0722), image.rgb);',
    '  lum = u_inverted ? (1. - lum) : lum;',
    '',
    '  switch (type) {',
    '    case 1: {',
    '      dithering = step(hash21(ditheringNoiseUV), lum);',
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
    '  float colorSteps = max(floor(u_colorSteps), 1.);',
    '  vec3 color = vec3(0.0);',
    '  float opacity = 1.;',
    '',
    '  dithering -= .5;',
    '  float brightness = clamp(lum + dithering / colorSteps, 0.0, 1.0);',
    '  brightness = mix(0.0, brightness, frame);',
    '  brightness = mix(0.0, brightness, image.a);',
    '  float quantLum = floor(brightness * colorSteps + 0.5) / colorSteps;',
    '  quantLum = mix(0.0, quantLum, frame);',
    '',
    '  if (u_originalColors == true) {',
    '    vec3 normColor = image.rgb / max(lum, 0.001);',
    '    color = normColor * quantLum;',
    '',
    '    float quantAlpha = floor(image.a * colorSteps + 0.5) / colorSteps;',
    '    opacity = mix(quantLum, 1., quantAlpha);',
    '  } else {',
    '    vec3 fgColor = u_colorFront.rgb * u_colorFront.a;',
    '    float fgOpacity = u_colorFront.a;',
    '    vec3 bgColor = u_colorBack.rgb * u_colorBack.a;',
    '    float bgOpacity = u_colorBack.a;',
    '    vec3 hlColor = u_colorHighlight.rgb * u_colorHighlight.a;',
    '    float hlOpacity = u_colorHighlight.a;',
    '',
    '    fgColor = mix(fgColor, hlColor, step(1.02 - .02 * u_colorSteps, brightness));',
    '    fgOpacity = mix(fgOpacity, hlOpacity, step(1.02 - .02 * u_colorSteps, brightness));',
    '',
    '    color = fgColor * quantLum;',
    '    opacity = fgOpacity * quantLum;',
    '    color += bgColor * (1.0 - opacity);',
    '    opacity += bgOpacity * (1.0 - opacity);',
    '  }',
    '',
    '  fragColor = vec4(color, opacity);',
    '}',
    ''
  ].join('\n');

  /* fluted-glass.js:8-338 —— 逐字（prism 扭曲 + 竖直高斯模糊 + 15 折痕）。 */
  var FOLIA_NOMAND_FLUTED_GLASS_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_pixelRatio;',
    'uniform float u_rotation;',
    '',
    'uniform vec4 u_colorBack;',
    'uniform vec4 u_colorShadow;',
    'uniform vec4 u_colorHighlight;',
    '',
    'uniform sampler2D u_image;',
    'uniform float u_imageAspectRatio;',
    '',
    'uniform float u_size;',
    'uniform float u_shadows;',
    'uniform float u_angle;',
    'uniform float u_stretch;',
    'uniform float u_shape;',
    'uniform float u_distortion;',
    'uniform float u_highlights;',
    'uniform float u_distortionShape;',
    'uniform float u_shift;',
    'uniform float u_blur;',
    'uniform float u_edges;',
    'uniform float u_marginLeft;',
    'uniform float u_marginRight;',
    'uniform float u_marginTop;',
    'uniform float u_marginBottom;',
    'uniform float u_grainMixer;',
    'uniform float u_grainOverlay;',
    '',
    'in vec2 v_imageUV;',
    '',
    'out vec4 fragColor;',
    '',
    FOLIA_NOMAND_GLSL_PI,
    FOLIA_NOMAND_GLSL_ROTATE,
    FOLIA_NOMAND_GLSL_HASH21,
    '',
    FOLIA_NOMAND_GLSL_VALUE_NOISE,
    '',
    'float getUvFrame(vec2 uv, float softness) {',
    '  float aax = 2. * fwidth(uv.x);',
    '  float aay = 2. * fwidth(uv.y);',
    '  float left   = smoothstep(0., aax + softness, uv.x);',
    '  float right  = 1. - smoothstep(1. - softness - aax, 1., uv.x);',
    '  float bottom = smoothstep(0., aay + softness, uv.y);',
    '  float top    = 1. - smoothstep(1. - softness - aay, 1., uv.y);',
    '  return left * right * bottom * top;',
    '}',
    '',
    'const int MAX_RADIUS = 50;',
    'vec4 samplePremultiplied(sampler2D tex, vec2 uv) {',
    '  vec4 c = texture(tex, uv);',
    '  c.rgb *= c.a;',
    '  return c;',
    '}',
    'vec4 getBlur(sampler2D tex, vec2 uv, vec2 texelSize, vec2 dir, float sigma) {',
    '  if (sigma <= .5) return texture(tex, uv);',
    '  int radius = int(min(float(MAX_RADIUS), ceil(3.0 * sigma)));',
    '',
    '  float twoSigma2 = 2.0 * sigma * sigma;',
    '  float gaussianNorm = 1.0 / sqrt(TWO_PI * sigma * sigma);',
    '',
    '  vec4 sum = samplePremultiplied(tex, uv) * gaussianNorm;',
    '  float weightSum = gaussianNorm;',
    '',
    '  for (int i = 1; i <= MAX_RADIUS; i++) {',
    '    if (i > radius) break;',
    '',
    '    float x = float(i);',
    '    float w = exp(-(x * x) / twoSigma2) * gaussianNorm;',
    '',
    '    vec2 offset = dir * texelSize * x;',
    '    vec4 s1 = samplePremultiplied(tex, uv + offset);',
    '    vec4 s2 = samplePremultiplied(tex, uv - offset);',
    '',
    '    sum += (s1 + s2) * w;',
    '    weightSum += 2.0 * w;',
    '  }',
    '',
    '  vec4 result = sum / weightSum;',
    '  if (result.a > 0.) {',
    '    result.rgb /= result.a;',
    '  }',
    '',
    '  return result;',
    '}',
    '',
    'vec2 rotateAspect(vec2 p, float a, float aspect) {',
    '  p.x *= aspect;',
    '  p = rotate(p, a);',
    '  p.x /= aspect;',
    '  return p;',
    '}',
    '',
    'float smoothFract(float x) {',
    '  float f = fract(x);',
    '  float w = fwidth(x);',
    '',
    '  float edge = abs(f - 0.5) - 0.5;',
    '  float band = smoothstep(-w, w, edge);',
    '',
    '  return mix(f, 1.0 - f, band);',
    '}',
    '',
    'void main() {',
    '',
    '  float patternRotation = -u_angle * PI / 180.;',
    '  float patternSize = mix(200., 5., u_size);',
    '',
    '  vec2 uv = v_imageUV;',
    '',
    '  vec2 uvMask = gl_FragCoord.xy / u_resolution.xy;',
    '  vec2 sw = vec2(.005);',
    '  vec4 margins = vec4(u_marginLeft, u_marginTop, u_marginRight, u_marginBottom);',
    '  float mask =',
    '  smoothstep(margins[0], margins[0] + sw.x, uvMask.x + sw.x) *',
    '  smoothstep(margins[2], margins[2] + sw.x, 1.0 - uvMask.x + sw.x) *',
    '  smoothstep(margins[1], margins[1] + sw.y, uvMask.y + sw.y) *',
    '  smoothstep(margins[3], margins[3] + sw.y, 1.0 - uvMask.y + sw.y);',
    '  float maskOuter =',
    '  smoothstep(margins[0] - sw.x, margins[0], uvMask.x + sw.x) *',
    '  smoothstep(margins[2] - sw.x, margins[2], 1.0 - uvMask.x + sw.x) *',
    '  smoothstep(margins[1] - sw.y, margins[1], uvMask.y + sw.y) *',
    '  smoothstep(margins[3] - sw.y, margins[3], 1.0 - uvMask.y + sw.y);',
    '  float maskStroke = maskOuter - mask;',
    '  float maskInner =',
    '  smoothstep(margins[0] - 2. * sw.x, margins[0], uvMask.x) *',
    '  smoothstep(margins[2] - 2. * sw.x, margins[2], 1.0 - uvMask.x) *',
    '  smoothstep(margins[1] - 2. * sw.y, margins[1], uvMask.y) *',
    '  smoothstep(margins[3] - 2. * sw.y, margins[3], 1.0 - uvMask.y);',
    '  float maskStrokeInner = maskInner - mask;',
    '',
    '  uv -= .5;',
    '  uv *= patternSize;',
    '  uv = rotateAspect(uv, patternRotation, u_imageAspectRatio);',
    '',
    '  float curve = 0.;',
    '  float patternY = uv.y / u_imageAspectRatio;',
    '  if (u_shape > 4.5) {',
    '    // pattern',
    '    curve = .5 + .5 * sin(.5 * PI * uv.x) * cos(.5 * PI * patternY);',
    '  } else if (u_shape > 3.5) {',
    '    // zigzag',
    '    curve = 10. * abs(fract(.1 * patternY) - .5);',
    '  } else if (u_shape > 2.5) {',
    '    // wave',
    '    curve = 4. * sin(.23 * patternY);',
    '  } else if (u_shape > 1.5) {',
    '    // lines irregular',
    '    curve = .5 + .5 * sin(.5 * uv.x) * sin(1.7 * uv.x);',
    '  } else {',
    '    // lines',
    '  }',
    '',
    '  vec2 UvToFract = uv + curve;',
    '  vec2 fractOrigUV = fract(uv);',
    '  vec2 floorOrigUV = floor(uv);',
    '',
    '  float x = smoothFract(UvToFract.x);',
    '  float xNonSmooth = fract(UvToFract.x) + .0001;',
    '',
    '  float highlightsWidth = 2. * max(.001, fwidth(UvToFract.x));',
    '  highlightsWidth += 2. * maskStrokeInner;',
    '  float highlights = smoothstep(0., highlightsWidth, xNonSmooth);',
    '  highlights *= smoothstep(1., 1. - highlightsWidth, xNonSmooth);',
    '  highlights = 1. - highlights;',
    '  highlights *= u_highlights;',
    '  highlights = clamp(highlights, 0., 1.);',
    '  highlights *= mask;',
    '',
    '  float shadows = pow(x, 1.3);',
    '  float distortion = 0.;',
    '  float fadeX = 1.;',
    '  float frameFade = 0.;',
    '',
    '  float aa = fwidth(xNonSmooth);',
    '  aa = max(aa, fwidth(uv.x));',
    '  aa = max(aa, fwidth(UvToFract.x));',
    '  aa = max(aa, .0001);',
    '',
    '  if (u_distortionShape == 1.) {',
    '    distortion = -pow(1.5 * x, 3.);',
    '    distortion += (.5 - u_shift);',
    '',
    '    frameFade = pow(1.5 * x, 3.);',
    '    aa = max(.2, aa);',
    '    aa += mix(.2, 0., u_size);',
    '    fadeX = smoothstep(0., aa, xNonSmooth) * smoothstep(1., 1. - aa, xNonSmooth);',
    '    distortion = mix(.5, distortion, fadeX);',
    '  } else if (u_distortionShape == 2.) {',
    '    distortion = 2. * pow(x, 2.);',
    '    distortion -= (.5 + u_shift);',
    '',
    '    frameFade = pow(abs(x - .5), 4.);',
    '    aa = max(.2, aa);',
    '    aa += mix(.2, 0., u_size);',
    '    fadeX = smoothstep(0., aa, xNonSmooth) * smoothstep(1., 1. - aa, xNonSmooth);',
    '    distortion = mix(.5, distortion, fadeX);',
    '    frameFade = mix(1., frameFade, .5 * fadeX);',
    '  } else if (u_distortionShape == 3.) {',
    '    distortion = pow(2. * (xNonSmooth - .5), 6.);',
    '    distortion -= .25;',
    '    distortion -= u_shift;',
    '',
    '    frameFade = 1. - 2. * pow(abs(x - .4), 2.);',
    '    aa = .15;',
    '    aa += mix(.1, 0., u_size);',
    '    fadeX = smoothstep(0., aa, xNonSmooth) * smoothstep(1., 1. - aa, xNonSmooth);',
    '    frameFade = mix(1., frameFade, fadeX);',
    '',
    '  } else if (u_distortionShape == 4.) {',
    '    x = xNonSmooth;',
    '    distortion = sin((x + .25) * TWO_PI);',
    '    shadows = .5 + .5 * asin(distortion) / (.5 * PI);',
    '    distortion *= .5;',
    '    distortion -= u_shift;',
    '    frameFade = .5 + .5 * sin(x * TWO_PI);',
    '  } else if (u_distortionShape == 5.) {',
    '    distortion -= pow(abs(x), .2) * x;',
    '    distortion += .33;',
    '    distortion -= 3. * u_shift;',
    '    distortion *= .33;',
    '',
    '    frameFade = .3 * (smoothstep(.0, 1., x));',
    '    shadows = pow(x, 2.5);',
    '',
    '    aa = max(.1, aa);',
    '    aa += mix(.1, 0., u_size);',
    '    fadeX = smoothstep(0., aa, xNonSmooth) * smoothstep(1., 1. - aa, xNonSmooth);',
    '    distortion *= fadeX;',
    '  }',
    '',
    '  vec2 dudx = dFdx(v_imageUV);',
    '  vec2 dudy = dFdy(v_imageUV);',
    '  vec2 grainUV = v_imageUV - .5;',
    '  grainUV *= (.8 / vec2(length(dudx), length(dudy)));',
    '  grainUV += .5;',
    '  float grain = valueNoise(grainUV);',
    '  grain = smoothstep(.4, .7, grain);',
    '  grain *= u_grainMixer;',
    '  distortion = mix(distortion, 0., grain);',
    '',
    '  shadows = min(shadows, 1.);',
    '  shadows += maskStrokeInner;',
    '  shadows *= mask;',
    '  shadows = min(shadows, 1.);',
    '  shadows *= pow(u_shadows, 2.);',
    '  shadows = clamp(shadows, 0., 1.);',
    '',
    '  distortion *= 3. * u_distortion;',
    '  frameFade *= u_distortion;',
    '',
    '  fractOrigUV.x += distortion;',
    '  floorOrigUV = rotateAspect(floorOrigUV, -patternRotation, u_imageAspectRatio);',
    '  fractOrigUV = rotateAspect(fractOrigUV, -patternRotation, u_imageAspectRatio);',
    '',
    '  uv = (floorOrigUV + fractOrigUV) / patternSize;',
    '  uv += pow(maskStroke, 4.);',
    '',
    '  uv += vec2(.5);',
    '',
    '  uv = mix(v_imageUV, uv, smoothstep(0., .7, mask));',
    '  float blur = mix(0., 50., u_blur);',
    '  blur = mix(0., blur, smoothstep(.5, 1., mask));',
    '',
    '  float edgeDistortion = mix(.0, .04, u_edges);',
    '  edgeDistortion += .06 * frameFade * u_edges;',
    '  edgeDistortion *= mask;',
    '  float frame = getUvFrame(uv, edgeDistortion);',
    '',
    '  float stretch = 1. - smoothstep(0., .5, xNonSmooth) * smoothstep(1., 1. - .5, xNonSmooth);',
    '  stretch = pow(stretch, 2.);',
    '  stretch *= mask;',
    '  stretch *= getUvFrame(uv, .1 + .05 * mask * frameFade);',
    '  uv.y = mix(uv.y, .5, u_stretch * stretch);',
    '',
    '  vec4 image = getBlur(u_image, uv, 1. / u_resolution / u_pixelRatio, vec2(0., 1.), blur);',
    '  image.rgb *= image.a;',
    '  vec4 backColor = u_colorBack;',
    '  backColor.rgb *= backColor.a;',
    '  vec4 highlightColor = u_colorHighlight;',
    '  highlightColor.rgb *= highlightColor.a;',
    '  vec4 shadowColor = u_colorShadow;',
    '',
    '  vec3 color = highlightColor.rgb * highlights;',
    '  float opacity = highlightColor.a * highlights;',
    '',
    '  shadows = mix(shadows * shadowColor.a, 0., highlights);',
    '  color = mix(color, shadowColor.rgb * shadowColor.a, .5 * shadows);',
    '  color += .5 * pow(shadows, .5) * shadowColor.rgb;',
    '  opacity += shadows;',
    '  color = clamp(color, vec3(0.), vec3(1.));',
    '  opacity = clamp(opacity, 0., 1.);',
    '',
    '  color += image.rgb * (1. - opacity) * frame;',
    '  opacity += image.a * (1. - opacity) * frame;',
    '',
    '  color += backColor.rgb * (1. - opacity);',
    '  opacity += backColor.a * (1. - opacity);',
    '',
    '  float grainOverlay = valueNoise(rotate(grainUV, 1.) + vec2(3.));',
    '  grainOverlay = mix(grainOverlay, valueNoise(rotate(grainUV, 2.) + vec2(-1.)), .5);',
    '  grainOverlay = pow(grainOverlay, 1.3);',
    '',
    '  float grainOverlayV = grainOverlay * 2. - 1.;',
    '  vec3 grainOverlayColor = vec3(step(0., grainOverlayV));',
    '  float grainOverlayStrength = u_grainOverlay * abs(grainOverlayV);',
    '  grainOverlayStrength = pow(grainOverlayStrength, .8);',
    '  grainOverlayStrength *= mask;',
    '  color = mix(color, grainOverlayColor, .35 * grainOverlayStrength);',
    '',
    '  opacity += .5 * grainOverlayStrength;',
    '  opacity = clamp(opacity, 0., 1.);',
    '',
    '  fragColor = vec4(color, opacity);',
    '}',
    ''
  ].join('\n');

  /* paper-texture.js:8-244 —— 逐字（纸纹法线 + 折痕 + 水滴 + 纤维，全部从 u_noiseTexture 取噪声）。 */
  var FOLIA_NOMAND_PAPER_TEXTURE_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_pixelRatio;',
    '',
    'uniform vec4 u_colorFront;',
    'uniform vec4 u_colorBack;',
    '',
    'uniform sampler2D u_image;',
    'uniform float u_imageAspectRatio;',
    '',
    'uniform float u_contrast;',
    'uniform float u_roughness;',
    'uniform float u_fiber;',
    'uniform float u_fiberSize;',
    'uniform float u_crumples;',
    'uniform float u_crumpleSize;',
    'uniform float u_folds;',
    'uniform float u_foldCount;',
    'uniform float u_drops;',
    'uniform float u_seed;',
    'uniform float u_fade;',
    '',
    'uniform sampler2D u_noiseTexture;',
    '',
    'in vec2 v_imageUV;',
    '',
    'out vec4 fragColor;',
    '',
    'float getUvFrame(vec2 uv) {',
    '  float aax = 2. * fwidth(uv.x);',
    '  float aay = 2. * fwidth(uv.y);',
    '',
    '  float left   = smoothstep(0., aax, uv.x);',
    '  float right = 1. - smoothstep(1. - aax, 1., uv.x);',
    '  float bottom = smoothstep(0., aay, uv.y);',
    '  float top = 1. - smoothstep(1. - aay, 1., uv.y);',
    '',
    '  return left * right * bottom * top;',
    '}',
    '',
    FOLIA_NOMAND_GLSL_PI,
    FOLIA_NOMAND_GLSL_ROTATE,
    /* shader-utils.js:36-41 textureRandomizerR */
    '  float randomR(vec2 p) {',
    '    vec2 uv = floor(p) / 100. + .5;',
    '    return texture(u_noiseTexture, fract(uv)).r;',
    '  }',
    '',
    'float valueNoise(vec2 st) {',
    '  vec2 i = floor(st);',
    '  vec2 f = fract(st);',
    '  float a = randomR(i);',
    '  float b = randomR(i + vec2(1.0, 0.0));',
    '  float c = randomR(i + vec2(0.0, 1.0));',
    '  float d = randomR(i + vec2(1.0, 1.0));',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float x1 = mix(a, b, u.x);',
    '  float x2 = mix(c, d, u.x);',
    '  return mix(x1, x2, u.y);',
    '}',
    'float fbm(vec2 n) {',
    '  float total = 0.0, amplitude = .4;',
    '  for (int i = 0; i < 3; i++) {',
    '    total += valueNoise(n) * amplitude;',
    '    n *= 1.99;',
    '    amplitude *= 0.65;',
    '  }',
    '  return total;',
    '}',
    '',
    '',
    'float randomG(vec2 p) {',
    '  vec2 uv = floor(p) / 50. + .5;',
    '  return texture(u_noiseTexture, fract(uv)).g;',
    '}',
    'float roughness(vec2 p) {',
    '  p *= .1;',
    '  float o = 0.;',
    '  for (float i = 0.; ++i < 4.; p *= 2.1) {',
    '    vec4 w = vec4(floor(p), ceil(p));',
    '    vec2 f = fract(p);',
    '    o += mix(',
    '    mix(randomG(w.xy), randomG(w.xw), f.y),',
    '    mix(randomG(w.zy), randomG(w.zw), f.y),',
    '    f.x);',
    '    o += .2 / exp(2. * abs(sin(.2 * p.x + .5 * p.y)));',
    '  }',
    '  return o / 3.;',
    '}',
    '',
    /* shader-utils.js:80-118 fiberNoise */
    'float fiberRandom(vec2 p) {',
    '  vec2 uv = floor(p) / 100.;',
    '  return texture(u_noiseTexture, fract(uv)).b;',
    '}',
    '',
    'float fiberValueNoise(vec2 st) {',
    '  vec2 i = floor(st);',
    '  vec2 f = fract(st);',
    '  float a = fiberRandom(i);',
    '  float b = fiberRandom(i + vec2(1.0, 0.0));',
    '  float c = fiberRandom(i + vec2(0.0, 1.0));',
    '  float d = fiberRandom(i + vec2(1.0, 1.0));',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float x1 = mix(a, b, u.x);',
    '  float x2 = mix(c, d, u.x);',
    '  return mix(x1, x2, u.y);',
    '}',
    '',
    'float fiberNoiseFbm(in vec2 n, vec2 seedOffset) {',
    '  float total = 0.0, amplitude = 1.;',
    '  for (int i = 0; i < 4; i++) {',
    '    n = rotate(n, .7);',
    '    total += fiberValueNoise(n + seedOffset) * amplitude;',
    '    n *= 2.;',
    '    amplitude *= 0.6;',
    '  }',
    '  return total;',
    '}',
    '',
    'float fiberNoise(vec2 uv, vec2 seedOffset) {',
    '  float epsilon = 0.001;',
    '  float n1 = fiberNoiseFbm(uv + vec2(epsilon, 0.0), seedOffset);',
    '  float n2 = fiberNoiseFbm(uv - vec2(epsilon, 0.0), seedOffset);',
    '  float n3 = fiberNoiseFbm(uv + vec2(0.0, epsilon), seedOffset);',
    '  float n4 = fiberNoiseFbm(uv - vec2(0.0, epsilon), seedOffset);',
    '  return length(vec2(n1 - n2, n3 - n4)) / (2.0 * epsilon);',
    '}',
    '',
    'vec2 randomGB(vec2 p) {',
    '  vec2 uv = floor(p) / 50. + .5;',
    '  return texture(u_noiseTexture, fract(uv)).gb;',
    '}',
    'float crumpledNoise(vec2 t, float pw) {',
    '  vec2 p = floor(t);',
    '  float wsum = 0.;',
    '  float cl = 0.;',
    '  for (int y = -1; y < 2; y += 1) {',
    '    for (int x = -1; x < 2; x += 1) {',
    '      vec2 b = vec2(float(x), float(y));',
    '      vec2 q = b + p;',
    '      vec2 q2 = q - floor(q / 8.) * 8.;',
    '      vec2 c = q + randomGB(q2);',
    '      vec2 r = c - t;',
    '      float w = pow(smoothstep(0., 1., 1. - abs(r.x)), pw) * pow(smoothstep(0., 1., 1. - abs(r.y)), pw);',
    '      cl += (.5 + .5 * sin((q2.x + q2.y * 5.) * 8.)) * w;',
    '      wsum += w;',
    '    }',
    '  }',
    '  return pow(wsum != 0.0 ? cl / wsum : 0.0, .5) * 2.;',
    '}',
    'float crumplesShape(vec2 uv) {',
    '  return crumpledNoise(uv * .25, 16.) * crumpledNoise(uv * .5, 2.);',
    '}',
    '',
    '',
    'vec2 folds(vec2 uv) {',
    '  vec3 pp = vec3(0.);',
    '  float l = 9.;',
    '  for (float i = 0.; i < 15.; i++) {',
    '    if (i >= u_foldCount) break;',
    '    vec2 rand = randomGB(vec2(i, i * u_seed));',
    '    float an = rand.x * TWO_PI;',
    '    vec2 p = vec2(cos(an), sin(an)) * rand.y;',
    '    float dist = distance(uv, p);',
    '    l = min(l, dist);',
    '',
    '    if (l == dist) {',
    '      pp.xy = (uv - p.xy);',
    '      pp.z = dist;',
    '    }',
    '  }',
    '  return mix(pp.xy, vec2(0.), pow(pp.z, .25));',
    '}',
    '',
    'float drops(vec2 uv) {',
    '  vec2 iDropsUV = floor(uv);',
    '  vec2 fDropsUV = fract(uv);',
    '  float dropsMinDist = 1.;',
    '  for (int j = -1; j <= 1; j++) {',
    '    for (int i = -1; i <= 1; i++) {',
    '      vec2 neighbor = vec2(float(i), float(j));',
    '      vec2 offset = randomGB(iDropsUV + neighbor);',
    '      offset = .5 + .5 * sin(10. * u_seed + TWO_PI * offset);',
    '      vec2 pos = neighbor + offset - fDropsUV;',
    '      float dist = length(pos);',
    '      dropsMinDist = min(dropsMinDist, dropsMinDist*dist);',
    '    }',
    '  }',
    '  return 1. - smoothstep(.05, .09, pow(dropsMinDist, .5));',
    '}',
    '',
    'float lst(float edge0, float edge1, float x) {',
    '  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '',
    '  vec2 imageUV = v_imageUV;',
    '  vec2 patternUV = v_imageUV - .5;',
    '  patternUV = 5. * (patternUV * vec2(u_imageAspectRatio, 1.));',
    '',
    '  vec2 roughnessUv = 1.5 * (gl_FragCoord.xy - .5 * u_resolution) / u_pixelRatio;',
    '  float roughness = roughness(roughnessUv + vec2(1., 0.)) - roughness(roughnessUv - vec2(1., 0.));',
    '',
    '  vec2 crumplesUV = fract(patternUV * .02 / u_crumpleSize - u_seed) * 32.;',
    '  float crumples = u_crumples * (crumplesShape(crumplesUV + vec2(.05, 0.)) - crumplesShape(crumplesUV));',
    '',
    '  vec2 fiberUV = 2. / u_fiberSize * patternUV;',
    '  float fiber = fiberNoise(fiberUV, vec2(0.));',
    '  fiber = .5 * u_fiber * (fiber - 1.);',
    '',
    '  vec2 normal = vec2(0.);',
    '  vec2 normalImage = vec2(0.);',
    '',
    '  vec2 foldsUV = patternUV * .12;',
    '  foldsUV = rotate(foldsUV, 4. * u_seed);',
    '  vec2 w = folds(foldsUV);',
    '  foldsUV = rotate(foldsUV + .007 * cos(u_seed), .01 * sin(u_seed));',
    '  vec2 w2 = folds(foldsUV);',
    '',
    '  float drops = u_drops * drops(patternUV * 2.);',
    '',
    '  float fade = u_fade * fbm(.17 * patternUV + 10. * u_seed);',
    '  fade = clamp(8. * fade * fade * fade, 0., 1.);',
    '',
    '  w = mix(w, vec2(0.), fade);',
    '  w2 = mix(w2, vec2(0.), fade);',
    '  crumples = mix(crumples, 0., fade);',
    '  drops = mix(drops, 0., fade);',
    '  fiber *= mix(1., .5, fade);',
    '  roughness *= mix(1., .5, fade);',
    '',
    '  normal.xy += u_folds * min(5. * u_contrast, 1.) * 4. * max(vec2(0.), w + w2);',
    '  normalImage.xy += u_folds * 2. * w;',
    '',
    '  normal.xy += crumples;',
    '  normalImage.xy += 1.5 * crumples;',
    '',
    '  normal.xy += 3. * drops;',
    '  normalImage.xy += .2 * drops;',
    '',
    '  normal.xy += u_roughness * 1.5 * roughness;',
    '  normal.xy += fiber;',
    '',
    '  normalImage += u_roughness * .75 * roughness;',
    '  normalImage += .2 * fiber;',
    '',
    '  vec3 lightPos = vec3(1., 2., 1.);',
    '  float res = dot(normalize(vec3(normal, 9.5 - 9. * pow(u_contrast, .1))), normalize(lightPos));',
    '',
    '  vec3 fgColor = u_colorFront.rgb * u_colorFront.a;',
    '  float fgOpacity = u_colorFront.a;',
    '  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;',
    '  float bgOpacity = u_colorBack.a;',
    '',
    '  imageUV += .02 * normalImage;',
    '  float frame = getUvFrame(imageUV);',
    '  vec4 image = texture(u_image, imageUV);',
    '  image.rgb += .6 * pow(u_contrast, .4) * (res - .7);',
    '',
    '  frame *= image.a;',
    '',
    '  vec3 color = fgColor * res;',
    '  float opacity = fgOpacity * res;',
    '',
    '  color += bgColor * (1. - opacity);',
    '  opacity += bgOpacity * (1. - opacity);',
    '  opacity = mix(opacity, 1., frame);',
    '',
    '  color -= .007 * drops;',
    '',
    '  color.rgb = mix(color, image.rgb, frame);',
    '',
    '  fragColor = vec4(color, opacity);',
    '}',
    ''
  ].join('\n');

  /* halftone-dots.js:8-304 —— 逐字（hex gooey 网点 + 双 grain）。 */
  var FOLIA_NOMAND_HALFTONE_DOTS_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform float u_rotation;',
    '',
    'uniform float u_time;',
    '',
    'uniform vec4 u_colorFront;',
    'uniform vec4 u_colorBack;',
    'uniform float u_radius;',
    'uniform float u_contrast;',
    '',
    'uniform sampler2D u_image;',
    'uniform float u_imageAspectRatio;',
    '',
    'uniform float u_size;',
    'uniform float u_grainMixer;',
    'uniform float u_grainOverlay;',
    'uniform float u_grainSize;',
    'uniform float u_grid;',
    'uniform bool u_originalColors;',
    'uniform bool u_inverted;',
    'uniform float u_type;',
    '',
    'in vec2 v_imageUV;',
    '',
    'out vec4 fragColor;',
    '',
    FOLIA_NOMAND_GLSL_PI,
    FOLIA_NOMAND_GLSL_ROTATE,
    FOLIA_NOMAND_GLSL_HASH21,
    '',
    FOLIA_NOMAND_GLSL_VALUE_NOISE,
    '',
    'float lst(float edge0, float edge1, float x) {',
    '  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);',
    '}',
    '',
    'float sst(float edge0, float edge1, float x) {',
    '  return smoothstep(edge0, edge1, x);',
    '}',
    '',
    'float getCircle(vec2 uv, float r, float baseR) {',
    '  r = mix(.25 * baseR, 0., r);',
    '  float d = length(uv - .5);',
    '  float aa = fwidth(d);',
    '  return 1. - smoothstep(r - aa, r + aa, d);',
    '}',
    '',
    'float getCell(vec2 uv) {',
    '  float insideX = step(0.0, uv.x) * (1.0 - step(1.0, uv.x));',
    '  float insideY = step(0.0, uv.y) * (1.0 - step(1.0, uv.y));',
    '  return insideX * insideY;',
    '}',
    '',
    'float getCircleWithHole(vec2 uv, float r, float baseR) {',
    '  float cell = getCell(uv);',
    '',
    '  r = mix(.75 * baseR, 0., r);',
    '  float rMod = mod(r, .5);',
    '',
    '  float d = length(uv - .5);',
    '  float aa = fwidth(d);',
    '  float circle = 1. - smoothstep(rMod - aa, rMod + aa, d);',
    '  if (r < .5) {',
    '    return circle;',
    '  } else {',
    '    return cell - circle;',
    '  }',
    '}',
    '',
    'float getGooeyBall(vec2 uv, float r, float baseR) {',
    '  float d = length(uv - .5);',
    '  float sizeRadius = .3;',
    '  if (u_grid == 1.) {',
    '    sizeRadius = .42;',
    '  }',
    '  sizeRadius = mix(sizeRadius * baseR, 0., r);',
    '  d = 1. - sst(0., sizeRadius, d);',
    '',
    '  d = pow(d, 2. + baseR);',
    '  return d;',
    '}',
    '',
    'float getSoftBall(vec2 uv, float r, float baseR) {',
    '  float d = length(uv - .5);',
    '  float sizeRadius = clamp(baseR, 0., 1.);',
    '  sizeRadius = mix(.5 * sizeRadius, 0., r);',
    '  d = 1. - lst(0., sizeRadius, d);',
    '  float powRadius = 1. - lst(0., 2., baseR);',
    '  d = pow(d, 4. + 3. * powRadius);',
    '  return d;',
    '}',
    '',
    FOLIA_NOMAND_GLSL_UV_FRAME_PAD,
    '',
    'float sigmoid(float x, float k) {',
    '  return 1.0 / (1.0 + exp(-k * (x - 0.5)));',
    '}',
    '',
    'float getLumAtPx(vec2 uv, float contrast) {',
    '  vec4 tex = texture(u_image, uv);',
    '  vec3 color = vec3(',
    '  sigmoid(tex.r, contrast),',
    '  sigmoid(tex.g, contrast),',
    '  sigmoid(tex.b, contrast)',
    '  );',
    '  float lum = dot(vec3(0.2126, 0.7152, 0.0722), color);',
    '  lum = mix(1., lum, tex.a);',
    '  lum = u_inverted ? (1. - lum) : lum;',
    '  return lum;',
    '}',
    '',
    'float getLumBall(vec2 p, vec2 pad, vec2 inCellOffset, float contrast, float baseR, float stepSize, out vec4 ballColor) {',
    '  p += inCellOffset;',
    '  vec2 uv_i = floor(p);',
    '  vec2 uv_f = fract(p);',
    '  vec2 samplingUV = (uv_i + .5 - inCellOffset) * pad + vec2(.5);',
    '  float outOfFrame = getUvFrame(samplingUV, pad * stepSize);',
    '',
    '  float lum = getLumAtPx(samplingUV, contrast);',
    '  ballColor = texture(u_image, samplingUV);',
    '  ballColor.rgb *= ballColor.a;',
    '  ballColor *= outOfFrame;',
    '',
    '  float ball = 0.;',
    '  if (u_type == 0.) {',
    '    // classic',
    '    ball = getCircle(uv_f, lum, baseR);',
    '  } else if (u_type == 1.) {',
    '    // gooey',
    '    ball = getGooeyBall(uv_f, lum, baseR);',
    '  } else if (u_type == 2.) {',
    '    // holes',
    '    ball = getCircleWithHole(uv_f, lum, baseR);',
    '  } else if (u_type == 3.) {',
    '    // soft',
    '    ball = getSoftBall(uv_f, lum, baseR);',
    '  }',
    '',
    '  return ball * outOfFrame;',
    '}',
    '',
    '',
    'void main() {',
    '',
    '  float stepMultiplier = 1.;',
    '  if (u_type == 0.) {',
    '    // classic',
    '    stepMultiplier = 2.;',
    '  } else if (u_type == 1. || u_type == 3.) {',
    '    // gooey & soft',
    '    stepMultiplier = 6.;',
    '  }',
    '',
    '  float cellsPerSide = mix(300., 7., pow(u_size, .7));',
    '  cellsPerSide /= stepMultiplier;',
    '  float cellSizeY = 1. / cellsPerSide;',
    '  vec2 pad = cellSizeY * vec2(1. / u_imageAspectRatio, 1.);',
    '  if (u_type == 1. && u_grid == 1.) {',
    '    // gooey diagonal grid works differently',
    '    pad *= .7;',
    '  }',
    '',
    '  vec2 uv = v_imageUV;',
    '  uv -= vec2(.5);',
    '  uv /= pad;',
    '',
    '  float contrast = mix(0., 15., pow(u_contrast, 1.5));',
    '  float baseRadius = u_radius;',
    '  if (u_originalColors == true) {',
    '    contrast = mix(.1, 4., pow(u_contrast, 2.));',
    '    baseRadius = 2. * pow(.5 * u_radius, .3);',
    '  }',
    '',
    '  float totalShape = 0.;',
    '  vec3 totalColor = vec3(0.);',
    '  float totalOpacity = 0.;',
    '',
    '  vec4 ballColor;',
    '  float shape;',
    '  float stepSize = 1. / stepMultiplier;',
    '  for (float x = -0.5; x < 0.5; x += stepSize) {',
    '    for (float y = -0.5; y < 0.5; y += stepSize) {',
    '      vec2 offset = vec2(x, y);',
    '',
    '      if (u_grid == 1.) {',
    '        float rowIndex = floor((y + .5) / stepSize);',
    '        float colIndex = floor((x + .5) / stepSize);',
    '        if (stepSize == 1.) {',
    '          rowIndex = floor(uv.y + y + 1.);',
    '          if (u_type == 1.) {',
    '            colIndex = floor(uv.x + x + 1.);',
    '          }',
    '        }',
    '        if (u_type == 1.) {',
    '          if (mod(rowIndex + colIndex, 2.) == 1.) {',
    '            continue;',
    '          }',
    '        } else {',
    '          if (mod(rowIndex, 2.) == 1.) {',
    '            offset.x += .5 * stepSize;',
    '          }',
    '        }',
    '      }',
    '',
    '      shape = getLumBall(uv, pad, offset, contrast, baseRadius, stepSize, ballColor);',
    '      totalColor   += ballColor.rgb * shape;',
    '      totalShape   += shape;',
    '      totalOpacity += shape;',
    '    }',
    '  }',
    '',
    '  const float eps = 1e-4;',
    '',
    '  totalColor /= max(totalShape, eps);',
    '  totalOpacity /= max(totalShape, eps);',
    '',
    '  float finalShape = 0.;',
    '  if (u_type == 0.) {',
    '    finalShape = min(1., totalShape);',
    '  } else if (u_type == 1.) {',
    '    float aa = fwidth(totalShape);',
    '    float th = .5;',
    '    finalShape = smoothstep(th - aa, th + aa, totalShape);',
    '  } else if (u_type == 2.) {',
    '    finalShape = min(1., totalShape);',
    '  } else if (u_type == 3.) {',
    '    finalShape = totalShape;',
    '  }',
    '',
    '  vec2 grainSize = mix(2000., 200., u_grainSize) * vec2(1., 1. / u_imageAspectRatio);',
    '  vec2 grainUV = v_imageUV - .5;',
    '  grainUV *= grainSize;',
    '  grainUV += .5;',
    '  float grain = valueNoise(grainUV);',
    '  grain = smoothstep(.55, .7 + .2 * u_grainMixer, grain);',
    '  grain *= u_grainMixer;',
    '  finalShape = mix(finalShape, 0., grain);',
    '',
    '  vec3 color = vec3(0.);',
    '  float opacity = 0.;',
    '',
    '  if (u_originalColors == true) {',
    '    color = totalColor * finalShape;',
    '    opacity = totalOpacity * finalShape;',
    '',
    '    vec3 bgColor = u_colorBack.rgb * u_colorBack.a;',
    '    color = color + bgColor * (1. - opacity);',
    '    opacity = opacity + u_colorBack.a * (1. - opacity);',
    '  } else {',
    '    vec3 fgColor = u_colorFront.rgb * u_colorFront.a;',
    '    float fgOpacity = u_colorFront.a;',
    '    vec3 bgColor = u_colorBack.rgb * u_colorBack.a;',
    '    float bgOpacity = u_colorBack.a;',
    '',
    '    color = fgColor * finalShape;',
    '    opacity = fgOpacity * finalShape;',
    '    color += bgColor * (1. - opacity);',
    '    opacity += bgOpacity * (1. - opacity);',
    '  }',
    '',
    '  float grainOverlay = valueNoise(rotate(grainUV, 1.) + vec2(3.));',
    '  grainOverlay = mix(grainOverlay, valueNoise(rotate(grainUV, 2.) + vec2(-1.)), .5);',
    '  grainOverlay = pow(grainOverlay, 1.3);',
    '',
    '  float grainOverlayV = grainOverlay * 2. - 1.;',
    '  vec3 grainOverlayColor = vec3(step(0., grainOverlayV));',
    '  float grainOverlayStrength = u_grainOverlay * abs(grainOverlayV);',
    '  grainOverlayStrength = pow(grainOverlayStrength, .8);',
    '  color = mix(color, grainOverlayColor, .5 * grainOverlayStrength);',
    '',
    '  opacity += .5 * grainOverlayStrength;',
    '  opacity = clamp(opacity, 0., 1.);',
    '',
    '  fragColor = vec4(color, opacity);',
    '}',
    ''
  ].join('\n');

  /* lens-distortion.js:11-270 —— 逐字（20 次色散采样 / tan 凸透镜 / 色相分光）。循环上限 50 取 meta.maxSamples。 */
  var FOLIA_NOMAND_LENS_DISTORTION_SHADER = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform sampler2D u_image;',
    'uniform float u_imageAspectRatio;',
    'uniform float u_spread;',
    'uniform float u_bias;',
    'uniform float u_angle;',
    'uniform float u_perspective;',
    'uniform float u_count;',
    'uniform float u_dispersion;',
    'uniform float u_dispersionShift;',
    'uniform float u_dispersionColor;',
    'uniform float u_focusCenter;',
    'uniform float u_focusEdges;',
    'uniform float u_swirl;',
    'uniform float u_noise;',
    'uniform float u_noiseFrequency;',
    'uniform float u_noiseOffset;',
    'uniform float u_lensBulge;',
    'uniform float u_lensCircle;',
    'uniform float u_grainMixer;',
    'uniform float u_grainOverlay;',
    'uniform float u_imageX;',
    'uniform float u_imageY;',
    '',
    'in vec2 v_imageUV;',
    '',
    'out vec4 fragColor;',
    '',
    FOLIA_NOMAND_GLSL_PI,
    FOLIA_NOMAND_GLSL_HASH21,
    FOLIA_NOMAND_GLSL_ROTATE,
    '',
    'float valueNoise(vec2 st) {',
    '  vec2 i = floor(st);',
    '  vec2 f = fract(st);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1., 0.));',
    '  float c = hash21(i + vec2(0., 1.));',
    '  float d = hash21(i + vec2(1., 1.));',
    '  vec2 u = f * f * (3. - 2. * f);',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float getUvFrame(vec2 uv) {',
    '  vec2 invAA = 1. / clamp(fwidth(uv), 1e-5, .02);',
    '  vec2 lo = clamp(uv * invAA + .5, 0., 1.);',
    '  vec2 hi = clamp((1. - uv) * invAA + .5, 0., 1.);',
    '  return lo.x * hi.x * lo.y * hi.y;',
    '}',
    '',
    'vec4 sampleOverWhite(vec2 uv) {',
    '  vec4 img = texture(u_image, uv);',
    '  float cover = img.a * getUvFrame(uv);',
    '  vec3 colorOverWhite = mix(vec3(1.), img.rgb, cover);',
    '  return vec4(colorOverWhite, cover);',
    '}',
    '',
    'vec3 hueColor(float hue) {',
    '  vec3 rgb = clamp(abs(mod(hue * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);',
    '  rgb = rgb * rgb * (3. - 2. * rgb);',
    '  return rgb;',
    '}',
    '',
    'float boxInradius() {',
    '  return .5 * min(u_imageAspectRatio, 1.);',
    '}',
    '',
    'float boxOutradius() {',
    '  return .5 * length(vec2(u_imageAspectRatio, 1.));',
    '}',
    '',
    'float spreadReach() {',
    '  return .7 * pow(u_spread, 1.3 + 2.7 * u_spread);',
    '}',
    '',
    'float innerCircleMask(float radius, float inradius) {',
    '  return 1. - smoothstep(.5 * inradius, 1.1 * inradius, radius);',
    '}',
    '',
    'float dispersionCurve(float t, float biasPow) {',
    '  float mirroredT = u_bias < 0. ? 1. - t : t;',
    '  float curved = pow(mirroredT, biasPow);',
    '  return u_bias < 0. ? 1. - curved : curved;',
    '}',
    '',
    'vec2 getSpread(vec2 fromCenter, float radius, vec2 warpedUV, float edgeAA, float inradius, float outradius, float reach, out float outStrength) {',
    '  float angleRad = radians(u_angle);',
    '  vec2 uniformDir = vec2(cos(angleRad), sin(angleRad));',
    '',
    '  float invInradius = 1. / inradius;',
    '  vec2 radialDir = fromCenter * invInradius;',
    '  float maxLen = (outradius + reach) * invInradius;',
    '  float radialLen = radius * invInradius;',
    '  if (radialLen > maxLen) radialDir *= maxLen / radialLen;',
    '  vec2 spreadDir = mix(uniformDir, radialDir, u_perspective);',
    '',
    '  float bandProximity = smoothstep(inradius * .8, inradius, radius);',
    '  float lensCircleMaxing = bandProximity * u_lensCircle * u_lensCircle * u_lensCircle;',
    '  spreadDir = mix(spreadDir, radialDir, lensCircleMaxing);',
    '',
    '  vec2 warpedAbs = abs(warpedUV - .5);',
    '  float inner = mix(1., smoothstep(0., mix(inradius, outradius, u_focusCenter), radius), u_focusCenter);',
    '  float boxDist = max(warpedAbs.x, warpedAbs.y) * 2.;',
    '  float outer = mix(1., 1. - min(boxDist, 1.), u_focusEdges);',
    '  float strength = inner * outer;',
    '',
    '  strength *= mix(1., mix(.15, .03, max(-u_lensBulge, 0.)), lensCircleMaxing);',
    '',
    '  vec2 outside = max(warpedAbs - .5, 0.);',
    '  float margin = max(reach * length(spreadDir) * (1. - u_lensCircle), edgeAA);',
    '  strength *= 1. - smoothstep(0., margin, length(outside));',
    '',
    '  outStrength = strength;',
    '  vec2 axis = spreadDir * (reach * strength);',
    '',
    '  if (u_noise > 0.) {',
    '    float turn = (valueNoise(fromCenter * u_noiseFrequency * 18. + u_noiseOffset * 30.) - .5) * 2. * u_noise;',
    '    float cs = cos(turn), sn = sin(turn);',
    '    axis = mat2(cs, -sn, sn, cs) * axis;',
    '  }',
    '',
    '  axis.x /= u_imageAspectRatio;',
    '  return axis;',
    '}',
    '',
    'vec2 lensWarp(vec2 fromCenter, float radius, float inradius, out float bulgeFade) {',
    '  bulgeFade = 1.;',
    '  if (u_lensBulge == 0. && u_lensCircle <= 0.) return fromCenter;',
    '  if (radius < 1e-5) return fromCenter;',
    '',
    '  float r = radius;',
    '',
    '  if (u_lensBulge != 0.) {',
    '    float rn = radius / inradius;',
    '    float bulge = abs(u_lensBulge) * (u_lensBulge > 0. ? 1.4 : 1.2);',
    '    if (u_lensBulge > 0.) bulgeFade = 1. - smoothstep(1.45, 1.53, rn * bulge);',
    '    float map = u_lensBulge > 0.',
    '      ? tan(min(rn * bulge, 1.53)) / tan(bulge)',
    '      : atan(rn * tan(bulge)) / bulge;',
    '    float bulgeScale = map / rn;',
    '    fromCenter *= bulgeScale;',
    '    r *= bulgeScale;',
    '  }',
    '',
    '  if (u_lensCircle > 0.) {',
    '    vec2 dir = fromCenter / max(r, 1e-5);',
    '    vec2 halfBox = vec2(u_imageAspectRatio, 1.) * .5;',
    '    float rBox = min(halfBox.x / max(abs(dir.x), 1e-4), halfBox.y / max(abs(dir.y), 1e-4));',
    '    float band = inradius * mix(.03, .2, .5 * (u_lensBulge + 1.));',
    '    float innerEdge = inradius - band;',
    '    float over = smoothstep(0., 1., (r - innerEdge) / band);',
    '    float g = r + (rBox - inradius) * pow(over, 14.);',
    '    fromCenter = dir * mix(r, g, u_lensCircle);',
    '  }',
    '',
    '  return fromCenter;',
    '}',
    '',
    'void main() {',
    '  vec2 uv = v_imageUV;',
    '',
    '  float invAspect = 1. / u_imageAspectRatio;',
    '  float inradius = boxInradius();',
    '  float outradius = boxOutradius();',
    '  float reach = spreadReach();',
    '',
    '  vec2 fromCenter = uv - .5;',
    '  fromCenter.x *= u_imageAspectRatio;',
    '  float radius = length(fromCenter);',
    '',
    '  float bulgeFade;',
    '  vec2 warpedFromCenter = lensWarp(fromCenter, radius, inradius, bulgeFade);',
    '  vec2 baseUV = vec2(warpedFromCenter.x * invAspect, warpedFromCenter.y) + .5;',
    '',
    '  vec2 baseDerivative = fwidth(baseUV);',
    '  float edgeAA = clamp(2. * max(baseDerivative.x, baseDerivative.y), .001, .02);',
    '',
    '  float spreadStrength;',
    '  vec2 spreadAxis = getSpread(fromCenter, radius, baseUV, edgeAA, inradius, outradius, reach, spreadStrength);',
    '',
    '  vec2 grainUV = vec2(0.);',
    '  if (u_grainMixer > 0. || u_grainOverlay > 0.) {',
    '    vec2 dudx = dFdx(v_imageUV);',
    '    vec2 dudy = dFdy(v_imageUV);',
    '    grainUV = (v_imageUV - .5) * (.8 / vec2(length(dudx), length(dudy))) + .5;',
    '  }',
    '',
    '  if (u_grainMixer > 0.) {',
    '    float grainSeed = valueNoise(grainUV);',
    '    vec2 jit = fract(grainSeed * vec2(157.31, 113.57)) * 2. - 1.;',
    '    spreadAxis += jit * .3 * u_grainMixer * length(spreadAxis);',
    '  }',
    '',
    '  float count = floor(u_count);',
    '  int countInteger = int(count);',
    '',
    '  float invCount = 1. / count;',
    '  float invSpan = 1. / max(count - 1., 1.);',
    '  float hueBase = u_dispersionColor + .5;',
    '  float biasPower = 1. + 2. * abs(u_bias);',
    '  vec2 tapBias = .5 - vec2(u_imageX, u_imageY);',
    '',
    '  float centerAmount = clamp(1. - u_dispersionShift, 0., 1.);',
    '  float edgesAmount = clamp(1. + u_dispersionShift, 0., 1.);',
    '  float dispersion = u_dispersion * mix(edgesAmount, centerAmount, innerCircleMask(radius, inradius));',
    '  float dispersionPower = pow(dispersion, .8);',
    '',
    '  float warpedRadius = length(warpedFromCenter);',
    '  float swirlAngle = u_swirl * .4 * PI * spreadStrength * u_spread * min(1., inradius / max(warpedRadius, 1e-4));',
    '',
    '  vec3 colorSum = vec3(0.);',
    '  vec3 weightSum = vec3(0.);',
    '  float coverSum = 0.;',
    '',
    '  for (int i = 0; i < 50; i++) {',
    '    if (i >= countInteger) break;',
    '',
    '    float layer = float(i);',
    '    float hue = hueBase + layer * invCount;',
    '',
    '    float spread = layer * invSpan;',
    '    if (u_bias != 0.) spread = dispersionCurve(spread, biasPower);',
    '',
    '    // mix(axis, -axis, spread) is axis scaled by the signed position along the fan',
    '    float fanPos = 1. - 2. * spread;',
    '    vec2 tapUV = baseUV + spreadAxis * fanPos - .5;',
    '',
    '    if (u_swirl != 0.) {',
    '      tapUV.x *= u_imageAspectRatio;',
    '      tapUV = rotate(tapUV, swirlAngle * fanPos);',
    '      tapUV.x *= invAspect;',
    '    }',
    '',
    '    vec4 tap = sampleOverWhite(tapUV + tapBias);',
    '    vec3 weight = 1. - dispersionPower * hueColor(hue);',
    '',
    '    colorSum += tap.rgb * weight;',
    '    weightSum += weight;',
    '    coverSum += tap.a;',
    '  }',
    '',
    '  vec3 color = colorSum / max(weightSum, 1e-4);',
    '  float coverAvg = coverSum * invCount;',
    '',
    '  float ground = min(color.r, min(color.g, color.b));',
    '  float alpha = max(coverAvg, 1. - ground);',
    '  vec3 premult = max(color - (1. - alpha), 0.);',
    '  fragColor = vec4(premult, alpha) * bulgeFade;',
    '',
    '  if (u_grainOverlay > 0.) {',
    '    float grain = valueNoise(rotate(grainUV, 1.) + vec2(3.));',
    '    grain = mix(grain, valueNoise(rotate(grainUV, 2.) + vec2(-1.)), .5);',
    '    grain = pow(grain, 1.3);',
    '    float grainV = grain * 2. - 1.;',
    '    float grainStrength = pow(u_grainOverlay * abs(grainV), .8) * fragColor.a;',
    '    fragColor.rgb = mix(fragColor.rgb, vec3(step(0., grainV)) * fragColor.a, .35 * grainStrength);',
    '  }',
    '}',
    ''
  ].join('\n');

  var FOLIA_NOMAND_FRAGMENT_SHADERS = {
    'dithering': FOLIA_NOMAND_DITHERING_SHADER,
    'fluted-glass': FOLIA_NOMAND_FLUTED_GLASS_SHADER,
    'paper-texture': FOLIA_NOMAND_PAPER_TEXTURE_SHADER,
    'halftone-dots': FOLIA_NOMAND_HALFTONE_DOTS_SHADER,
    'lens-distortion': FOLIA_NOMAND_LENS_DISTORTION_SHADER
  };

  /* 五档效果用到的 uniform 并集（取不到位置的会自动跳过，见 foliaNomandCollectLocations）。 */
  var FOLIA_NOMAND_UNIFORM_NAMES = [
    /* 顶点侧 */
    'u_resolution', 'u_pixelRatio', 'u_imageAspectRatio',
    /* 尺寸类（只有 image-dithering 的片元里也用到） */
    'u_originX', 'u_originY', 'u_worldWidth', 'u_worldHeight',
    'u_fit', 'u_scale', 'u_rotation', 'u_offsetX', 'u_offsetY',
    /* 贴图 */
    'u_image', 'u_noiseTexture',
    /* 颜色 */
    'u_colorFront', 'u_colorBack', 'u_colorHighlight', 'u_colorShadow',
    /* 像素画 */
    'u_type', 'u_pxSize', 'u_originalColors', 'u_inverted', 'u_colorSteps',
    /* 纹理玻璃 */
    'u_size', 'u_shadows', 'u_angle', 'u_stretch', 'u_shape', 'u_distortion',
    'u_highlights', 'u_distortionShape', 'u_shift', 'u_blur', 'u_edges',
    'u_marginLeft', 'u_marginRight', 'u_marginTop', 'u_marginBottom',
    'u_grainMixer', 'u_grainOverlay',
    /* 纸张纹理 */
    'u_contrast', 'u_roughness', 'u_fiber', 'u_fiberSize', 'u_crumples',
    'u_crumpleSize', 'u_folds', 'u_foldCount', 'u_drops', 'u_seed', 'u_fade',
    /* 半调网点 */
    'u_radius', 'u_grainSize', 'u_grid',
    /* 镜头畸变 */
    'u_spread', 'u_bias', 'u_perspective', 'u_count', 'u_dispersion',
    'u_dispersionShift', 'u_dispersionColor', 'u_focusCenter', 'u_focusEdges',
    'u_swirl', 'u_noise', 'u_noiseFrequency', 'u_noiseOffset', 'u_lensBulge',
    'u_lensCircle', 'u_imageX', 'u_imageY',
    /* 时间（Folia 的 speed 是 0，恒为 0） */
    'u_time'
  ];

  /* ---- 小工具 ---- */

  function foliaNomandClampNumber(value, fallback, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function foliaNomandClamp01(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  function foliaNomandChannels(color) {
    if (typeof foliaParseColorChannels === 'function') {
      try {
        var viaCore = foliaParseColorChannels(color);
        if (viaCore) return viaCore;
      } catch (_) {}
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

  /* getShaderColorFromString 的等价物：hex → 0..1 的 vec4（alpha 默认 1，不透明）。 */
  function foliaNomandColorVec4(color, alpha) {
    var a = isFinite(Number(alpha)) ? Math.min(1, Math.max(0, Number(alpha))) : 1;
    var channels = foliaNomandChannels(color);
    if (!channels) return [0, 0, 0, a];
    return [channels.r / 255, channels.g / 255, channels.b / 255, a];
  }

  /* 主题背景亮度 > 0.6 视为浅色（与 sora 背景同一套判定；本项目没有独立 isDaylight）。 */
  function foliaNomandIsDaylight(theme) {
    var channels = foliaNomandChannels(theme && theme.backgroundColor);
    if (!channels) return false;
    var luma = (0.2126 * channels.r + 0.7152 * channels.g + 0.0722 * channels.b) / 255;
    return luma > 0.6;
  }

  /* nomandShaderAdjustments.ts:51-55 —— 逐字。 */
  function foliaNomandResolveDaylightInversion(inverted, originalColors, isDaylight) {
    return isDaylight && !originalColors ? !inverted : !!inverted;
  }

  /* nomandShaderAdjustments.ts:63-67 —— 半调网点的亮度约定与像素画相反，基准值先翻一次。 */
  function foliaNomandResolveHalftoneInversion(inverted, originalColors, isDaylight) {
    return foliaNomandResolveDaylightInversion(!inverted, originalColors, isDaylight);
  }

  /* ---- 预放大：把「采样跑出图外」的位移换算成画布放大倍率 ---- */

  function foliaNomandClampOverscan(scale) {
    return Math.min(MAX_OVERSCAN, Math.max(1, scale));
  }

  /* 只在确实需要放大时才补余量，免得不产生位移的参数组合也被无谓地裁掉一圈。 */
  function foliaNomandApplyOverscanMargin(scale) {
    return scale <= 1 ? 1 : foliaNomandClampOverscan(scale + OVERSCAN_MARGIN);
  }

  function foliaNomandOverscanForMargin(margin) {
    return foliaNomandApplyOverscanMargin(1 / (1 - 2 * Math.min(Math.max(margin, 0), 0.45)));
  }

  /* nomandShaderAdjustments.ts:75-83 —— 按 shader 里 normalImage 各项的系数估最大位移。 */
  function foliaNomandPaperOverscan(roughness, fiber) {
    var shape = NOMAND_PAPER_TEXTURE_SHAPE;
    var maxNormal = 2 * shape.folds
      + 1.5 * shape.crumples
      + 0.2 * shape.drops
      + 0.75 * foliaNomandClamp01(roughness)
      + 0.1 * foliaNomandClamp01(fiber);
    return foliaNomandOverscanForMargin(0.02 * maxNormal);
  }

  /* nomandShaderAdjustments.ts:94-122 —— 反解「可见区域四角仍落在图内」的倍率，单调所以直接二分。 */
  function foliaNomandLensOverscan(bulge, spread) {
    var outRadius = 0.5 * Math.hypot(REFERENCE_ASPECT, 1);
    var clampedSpread = foliaNomandClamp01(spread);
    var reach = 0.7 * Math.pow(clampedSpread, 1.3 + 2.7 * clampedSpread);
    /* focusEdges 已经把边缘处的色散压到 (1 - focusEdges)，只需为这点残量留位置。 */
    var edgeReach = reach * (1 - NOMAND_LENS_SHAPE.focusEdges);
    var headroom = Math.max(0.35, 1 - edgeReach / outRadius);

    if (bulge <= 0) return foliaNomandApplyOverscanMargin(1 / headroom);

    var bulgeAmount = Math.min(bulge, 1) * 1.4;
    var cornerPush = function (scale) {
      var cornerRn = (2 * outRadius) / scale;
      return Math.tan(cornerRn * bulgeAmount) / Math.tan(bulgeAmount) / cornerRn;
    };

    var low = Math.max(1, (2 * outRadius * bulgeAmount) / 1.45);
    if (low >= MAX_OVERSCAN || cornerPush(MAX_OVERSCAN) > MAX_OVERSCAN * headroom) return MAX_OVERSCAN;
    if (low === 1 && cornerPush(1) <= headroom) return foliaNomandApplyOverscanMargin(1 / headroom);

    var high = MAX_OVERSCAN;
    for (var step = 0; step < 32; step += 1) {
      var mid = (low + high) / 2;
      if (cornerPush(mid) > mid * headroom) low = mid;
      else high = mid;
    }
    return foliaNomandApplyOverscanMargin(high);
  }

  /* ---- tuning：存档键与面板共用；没有存档就是 types.ts 的默认值 ---- */

  function foliaNomandNormalizeTuning(value) {
    var raw = (value && typeof value === 'object') ? value : {};
    var d = NOMAND_TUNING_DEFAULT;
    return {
      imageSource: NOMAND_SOURCES.indexOf(raw.imageSource) >= 0 ? raw.imageSource : d.imageSource,
      effect: NOMAND_EFFECTS.indexOf(raw.effect) >= 0 ? raw.effect : d.effect,
      ditheringType: NOMAND_DITHERING_TYPE_KEYS.indexOf(raw.ditheringType) >= 0 ? raw.ditheringType : d.ditheringType,
      /* 面板区间：size 0.5~20（步长 0.5）、colorSteps 1~7（整数）。 */
      size: foliaNomandClampNumber(raw.size, d.size, 0.5, 20),
      colorSteps: Math.round(foliaNomandClampNumber(raw.colorSteps, d.colorSteps, 1, 7)),
      originalColors: typeof raw.originalColors === 'boolean' ? raw.originalColors : d.originalColors,
      inverted: typeof raw.inverted === 'boolean' ? raw.inverted : d.inverted,
      flutedGlassSize: foliaNomandClampNumber(raw.flutedGlassSize, d.flutedGlassSize, 0.1, 1),
      flutedGlassDistortion: foliaNomandClampNumber(raw.flutedGlassDistortion, d.flutedGlassDistortion, 0, 1),
      flutedGlassBlur: foliaNomandClampNumber(raw.flutedGlassBlur, d.flutedGlassBlur, 0, 1),
      paperTextureContrast: foliaNomandClampNumber(raw.paperTextureContrast, d.paperTextureContrast, 0, 1),
      paperTextureRoughness: foliaNomandClampNumber(raw.paperTextureRoughness, d.paperTextureRoughness, 0, 1),
      paperTextureFiber: foliaNomandClampNumber(raw.paperTextureFiber, d.paperTextureFiber, 0, 1),
      halftoneDotsSize: foliaNomandClampNumber(raw.halftoneDotsSize, d.halftoneDotsSize, 0.1, 1),
      halftoneDotsRadius: foliaNomandClampNumber(raw.halftoneDotsRadius, d.halftoneDotsRadius, 0.1, 2),
      halftoneDotsContrast: foliaNomandClampNumber(raw.halftoneDotsContrast, d.halftoneDotsContrast, 0, 1),
      halftoneDotsOriginalColors: typeof raw.halftoneDotsOriginalColors === 'boolean'
        ? raw.halftoneDotsOriginalColors : d.halftoneDotsOriginalColors,
      halftoneDotsInverted: typeof raw.halftoneDotsInverted === 'boolean'
        ? raw.halftoneDotsInverted : d.halftoneDotsInverted,
      lensDistortionSpread: foliaNomandClampNumber(raw.lensDistortionSpread, d.lensDistortionSpread, 0, 1),
      lensDistortionBulge: foliaNomandClampNumber(raw.lensDistortionBulge, d.lensDistortionBulge, -1, 1),
      lensDistortionDispersion: foliaNomandClampNumber(raw.lensDistortionDispersion, d.lensDistortionDispersion, 0, 1),
      overlayEnabled: typeof raw.overlayEnabled === 'boolean' ? raw.overlayEnabled : d.overlayEnabled,
      overlayOpacity: foliaNomandClampNumber(raw.overlayOpacity, d.overlayOpacity, 0, 1)
    };
  }

  function foliaNomandReadStoredTuning() {
    var raw = null;
    try {
      var text = window.localStorage ? window.localStorage.getItem(NOMAND_TUNING_STORE_KEY) : null;
      if (text) raw = JSON.parse(text);
    } catch (_) { raw = null; }
    return foliaNomandNormalizeTuning(raw);
  }

  var foliaNomandTuningCache = null;

  function foliaNomandTuning() {
    if (!foliaNomandTuningCache) foliaNomandTuningCache = foliaNomandReadStoredTuning();
    return foliaNomandTuningCache;
  }

  /* ---- 图片来源 ---- */

  /* 上传图的外部入口：本项目还没有「共享自定义背景图」上传器，先留这个等价钩子。 */
  function foliaNomandCustomImage() {
    var image = window.foliaNomandCustomImage;
    if (!image || !image.url) return null;
    return { id: image.id ? String(image.id) : null, url: String(image.url) };
  }

  /* NomandBackgroundLayer.tsx:38-40 —— uploaded-global 时上传图优先，否则封面优先、上传图兜底。 */
  function foliaNomandResolveSourceUrl(coverUrl, customImage, tuning) {
    var uploaded = customImage && customImage.url ? String(customImage.url) : null;
    var cover = coverUrl ? String(coverUrl) : null;
    if (tuning && tuning.imageSource === 'uploaded-global') return uploaded || cover || null;
    return cover || uploaded || null;
  }

  /* 同源代理：跨源封面没带 CORS 时 texImage2D 会抛 SecurityError，整块背景就起不来。 */
  function foliaNomandCoverSrc(url) {
    if (!url) return '';
    try {
      if (typeof coverProxySrc === 'function') {
        var proxied = coverProxySrc(url);
        if (proxied) return proxied;
      }
    } catch (_) {}
    return String(url);
  }

  function foliaNomandLoadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var image = new Image();
      image.crossOrigin = 'Anonymous';
      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      image.onload = function () {
        var w = Number(image.naturalWidth) || 0;
        var h = Number(image.naturalHeight) || 0;
        if (!w || !h) { finish(null); return; }
        finish({ image: image, aspect: w / h });
      };
      image.onerror = function () { finish(null); };
      image.src = src;
    });
  }

  /* paper-texture 的 u_noiseTexture：与 Folia 一样每个挂载实例自己 new 一张 Image。 */
  function foliaNomandLoadNoise() {
    return new Promise(function (resolve) {
      var src = window.FOLIA_BG_NOISE_TEXTURE_SRC;
      if (!src) { resolve(null); return; }
      var image = new Image();
      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      image.onload = function () { finish(image); };
      image.onerror = function () { finish(null); };
      image.src = src;
    });
  }

  /* ---- WebGL2 装配 ---- */

  function foliaNomandCompile(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) throw new Error('漫游着色器创建失败');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('漫游着色器编译失败：' + (log || 'unknown'));
    }
    return shader;
  }

  function foliaNomandBuildProgram(gl, fragmentSource) {
    var vs = foliaNomandCompile(gl, gl.VERTEX_SHADER, FOLIA_NOMAND_VERTEX_SHADER);
    var fs = foliaNomandCompile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    if (!program) throw new Error('漫游着色器程序创建失败');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('漫游着色器链接失败：' + (log || 'unknown'));
    }
    return program;
  }

  function foliaNomandCollectLocations(gl, program) {
    var loc = {};
    for (var i = 0; i < FOLIA_NOMAND_UNIFORM_NAMES.length; i++) {
      var name = FOLIA_NOMAND_UNIFORM_NAMES[i];
      loc[name] = gl.getUniformLocation(program, name);
    }
    return loc;
  }

  function foliaNomandSet1f(layer, name, value) {
    var location = layer.loc[name];
    if (location) layer.gl.uniform1f(location, value);
  }

  function foliaNomandSet2f(layer, name, x, y) {
    var location = layer.loc[name];
    if (location) layer.gl.uniform2f(location, x, y);
  }

  function foliaNomandSet4fv(layer, name, value) {
    var location = layer.loc[name];
    if (location) layer.gl.uniform4fv(location, value);
  }

  /* ShaderMount.handleResize：minPixelRatio=1、maxPixelCount=1920*1080，
   * 于是缩放系数 = min(1, sqrt(maxPixelCount / (css×dpr 的像素数)))。 */
  function foliaNomandResize(layer) {
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

  /* shader-mount.js:236-268 setTextureUniform —— 纹理参数逐条照抄；
   * 差别只在 u_image（paper-texture 声明了 mipmaps:['u_image']）多一个 generateMipmap。 */
  function foliaNomandUploadTexture(layer, uniformName, image, unit, mipmaps) {
    var gl = layer.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (mipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    var location = layer.loc[uniformName];
    if (location) gl.uniform1i(location, unit);
    layer.textures[uniformName] = texture;
  }

  function foliaNomandDeleteTextures(layer) {
    if (!layer || !layer.gl) return;
    var gl = layer.gl;
    for (var name in layer.textures) {
      if (!Object.prototype.hasOwnProperty.call(layer.textures, name)) continue;
      try { gl.deleteTexture(layer.textures[name]); } catch (_) {}
    }
    layer.textures = {};
  }

  /* ---- DOM ---- */

  function foliaNomandEl(className) {
    var node = document.createElement('div');
    node.className = className;
    return node;
  }

  function foliaNomandCreateLayer(effect) {
    var el = foliaNomandEl('folia-bg-nomand-shader');
    var canvas = document.createElement('canvas');
    canvas.className = 'folia-bg-canvas';
    canvas.setAttribute('data-folia-bg-canvas', 'nomand-' + effect);
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
      throw new Error('「漫游」背景需要 WebGL2，当前环境不可用');
    }

    var prog = foliaNomandBuildProgram(gl, FOLIA_NOMAND_FRAGMENT_SHADERS[effect]);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    /* 两个三角形铺满裁剪空间（ShaderMount.setupPositionAttribute 的同一组顶点）。 */
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    return {
      effect: effect,
      el: el,
      canvas: canvas,
      gl: gl,
      prog: prog,
      buffer: buffer,
      loc: foliaNomandCollectLocations(gl, prog),
      textures: {},
      drawCount: 0,
      pixelRatio: 0,
      resolutionDirty: true
    };
  }

  function foliaNomandDestroyLayer(layer) {
    if (!layer) return;
    var gl = layer.gl;
    try {
      foliaNomandDeleteTextures(layer);
      if (layer.buffer) gl.deleteBuffer(layer.buffer);
      if (layer.prog) gl.deleteProgram(layer.prog);
      var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (_) {}
    if (layer.el && layer.el.parentNode) layer.el.parentNode.removeChild(layer.el);
  }

  /* ---- uniform 落值 ---- */

  /* 尺寸类 uniform 是常量（origin .5 / world 0 / scale 1 / rotation 0 / offset 0 / fit cover）——
   * 见 shader-sizing.js 的 defaultObjectSizing 与 NomandBackgroundLayer.tsx:57 的 fit:'cover'。 */
  function foliaNomandApplySizing(inst) {
    var layer = inst.layer;
    foliaNomandSet1f(layer, 'u_originX', 0.5);
    foliaNomandSet1f(layer, 'u_originY', 0.5);
    foliaNomandSet1f(layer, 'u_worldWidth', 0);
    foliaNomandSet1f(layer, 'u_worldHeight', 0);
    foliaNomandSet1f(layer, 'u_fit', NOMAND_FIT_COVER);
    foliaNomandSet1f(layer, 'u_scale', 1);
    foliaNomandSet1f(layer, 'u_rotation', 0);
    foliaNomandSet1f(layer, 'u_offsetX', 0);
    foliaNomandSet1f(layer, 'u_offsetY', 0);
    /* 图还没落地时先给 1，免得顶点着色器拿 0 做除数把 imageBoxSize 算成 NaN。 */
    foliaNomandSet1f(layer, 'u_imageAspectRatio',
      isFinite(inst.imageAspect) && inst.imageAspect > 0 ? inst.imageAspect : 1);
    /* speed 0 / frame 0（shaders-react 的默认值，Folia 没覆盖）→ u_time 恒为 0。 */
    foliaNomandSet1f(layer, 'u_time', 0);
  }

  /* NomandBackgroundLayer.tsx:63-145 —— 每档效果的固定参数与主题配色，逐条照抄。 */
  function foliaNomandApplyColors(inst) {
    var layer = inst.layer;
    if (!layer) return;
    var t = inst.tuning;
    var theme = inst.theme || {};
    var bg = theme.backgroundColor || '#000000';
    var primary = theme.primaryColor || '#ffffff';
    var secondary = theme.secondaryColor || '#888888';
    var accent = theme.accentColor || '#ffffff';
    var gl = layer.gl;

    gl.useProgram(layer.prog);
    foliaNomandApplySizing(inst);

    if (inst.effect === 'fluted-glass') {
      foliaNomandSet4fv(layer, 'u_colorBack', foliaNomandColorVec4(bg));
      foliaNomandSet4fv(layer, 'u_colorShadow', foliaNomandColorVec4(secondary));
      foliaNomandSet4fv(layer, 'u_colorHighlight', foliaNomandColorVec4(primary));
      foliaNomandSet1f(layer, 'u_shadows', 0.25);
      foliaNomandSet1f(layer, 'u_size', t.flutedGlassSize);
      foliaNomandSet1f(layer, 'u_distortion', t.flutedGlassDistortion);
      foliaNomandSet1f(layer, 'u_blur', t.flutedGlassBlur);
      foliaNomandSet1f(layer, 'u_shape', NOMAND_GLASS_SHAPE_LINES);
      foliaNomandSet1f(layer, 'u_distortionShape', NOMAND_GLASS_DISTORTION_PRISM);
      foliaNomandSet1f(layer, 'u_highlights', 0.1);
      foliaNomandSet1f(layer, 'u_edges', 0.25);
      foliaNomandSet1f(layer, 'u_angle', 0);
      foliaNomandSet1f(layer, 'u_shift', 0);
      foliaNomandSet1f(layer, 'u_stretch', 0);
      foliaNomandSet1f(layer, 'u_marginLeft', 0);
      foliaNomandSet1f(layer, 'u_marginRight', 0);
      foliaNomandSet1f(layer, 'u_marginTop', 0);
      foliaNomandSet1f(layer, 'u_marginBottom', 0);
      foliaNomandSet1f(layer, 'u_grainMixer', 0);
      foliaNomandSet1f(layer, 'u_grainOverlay', 0);
      return;
    }

    if (inst.effect === 'paper-texture') {
      var shape = NOMAND_PAPER_TEXTURE_SHAPE;
      foliaNomandSet4fv(layer, 'u_colorFront', foliaNomandColorVec4(accent));
      foliaNomandSet4fv(layer, 'u_colorBack', foliaNomandColorVec4(bg));
      foliaNomandSet1f(layer, 'u_contrast', t.paperTextureContrast);
      foliaNomandSet1f(layer, 'u_roughness', t.paperTextureRoughness);
      foliaNomandSet1f(layer, 'u_fiber', t.paperTextureFiber);
      foliaNomandSet1f(layer, 'u_fiberSize', shape.fiberSize);
      foliaNomandSet1f(layer, 'u_crumples', shape.crumples);
      foliaNomandSet1f(layer, 'u_crumpleSize', shape.crumpleSize);
      foliaNomandSet1f(layer, 'u_folds', shape.folds);
      foliaNomandSet1f(layer, 'u_foldCount', shape.foldCount);
      foliaNomandSet1f(layer, 'u_drops', shape.drops);
      foliaNomandSet1f(layer, 'u_seed', shape.seed);
      /* fade 没传 → defaultPreset 的 0（NomandBackgroundLayer 只覆盖 NOMAND_PAPER_TEXTURE_SHAPE）。 */
      foliaNomandSet1f(layer, 'u_fade', 0);
      /* scale 不是可调项，而是按纸张法线位移算出来的预放大。 */
      foliaNomandSet1f(layer, 'u_scale', foliaNomandPaperOverscan(t.paperTextureRoughness, t.paperTextureFiber));
      return;
    }

    if (inst.effect === 'halftone-dots') {
      var inverted = foliaNomandResolveHalftoneInversion(
        t.halftoneDotsInverted,
        t.halftoneDotsOriginalColors,
        inst.daylight
      );
      foliaNomandSet4fv(layer, 'u_colorBack', foliaNomandColorVec4(bg));
      foliaNomandSet4fv(layer, 'u_colorFront', foliaNomandColorVec4(accent));
      foliaNomandSet1f(layer, 'u_size', t.halftoneDotsSize);
      foliaNomandSet1f(layer, 'u_radius', t.halftoneDotsRadius);
      foliaNomandSet1f(layer, 'u_contrast', t.halftoneDotsContrast);
      foliaNomandSet1f(layer, 'u_originalColors', t.halftoneDotsOriginalColors ? 1 : 0);
      foliaNomandSet1f(layer, 'u_inverted', inverted ? 1 : 0);
      foliaNomandSet1f(layer, 'u_grid', NOMAND_HALFTONE_GRID_HEX);
      foliaNomandSet1f(layer, 'u_type', NOMAND_HALFTONE_TYPE_GOOEY);
      foliaNomandSet1f(layer, 'u_grainMixer', 0.12);
      foliaNomandSet1f(layer, 'u_grainOverlay', 0.06);
      foliaNomandSet1f(layer, 'u_grainSize', 0.5);
      return;
    }

    if (inst.effect === 'lens-distortion') {
      var lens = NOMAND_LENS_SHAPE;
      foliaNomandSet1f(layer, 'u_spread', t.lensDistortionSpread);
      foliaNomandSet1f(layer, 'u_dispersion', t.lensDistortionDispersion);
      foliaNomandSet1f(layer, 'u_lensBulge', t.lensDistortionBulge);
      /* 其余镜头参数走 defaultPreset：bias 1 / angle 0 / dispersionColor .6 / dispersionShift 0 等。 */
      foliaNomandSet1f(layer, 'u_bias', 1);
      foliaNomandSet1f(layer, 'u_angle', 0);
      foliaNomandSet1f(layer, 'u_perspective', lens.perspective);
      foliaNomandSet1f(layer, 'u_count', lens.count);
      foliaNomandSet1f(layer, 'u_dispersionShift', 0);
      foliaNomandSet1f(layer, 'u_dispersionColor', 0.6);
      foliaNomandSet1f(layer, 'u_focusCenter', lens.focusCenter);
      foliaNomandSet1f(layer, 'u_focusEdges', lens.focusEdges);
      foliaNomandSet1f(layer, 'u_swirl', lens.swirl);
      foliaNomandSet1f(layer, 'u_noise', 0);
      foliaNomandSet1f(layer, 'u_noiseFrequency', 0.25);
      foliaNomandSet1f(layer, 'u_noiseOffset', 0);
      foliaNomandSet1f(layer, 'u_lensCircle', lens.lensCircle);
      foliaNomandSet1f(layer, 'u_grainMixer', 0);
      foliaNomandSet1f(layer, 'u_grainOverlay', 0);
      foliaNomandSet1f(layer, 'u_imageX', 0);
      foliaNomandSet1f(layer, 'u_imageY', 0);
      /* 预放大：bulge 会把采样推出图外，四角会淡出（lensWarp 的 1.45~1.53 阈值）。 */
      foliaNomandSet1f(layer, 'u_scale', foliaNomandLensOverscan(t.lensDistortionBulge, t.lensDistortionSpread));
      return;
    }

    /* 默认 = 像素画（entry 的 fallback 分支）。 */
    var ditheringInverted = foliaNomandResolveDaylightInversion(t.inverted, t.originalColors, inst.daylight);
    foliaNomandSet4fv(layer, 'u_colorBack', foliaNomandColorVec4(bg));
    foliaNomandSet4fv(layer, 'u_colorFront', foliaNomandColorVec4(accent));
    foliaNomandSet4fv(layer, 'u_colorHighlight', foliaNomandColorVec4(primary));
    foliaNomandSet1f(layer, 'u_originalColors', t.originalColors ? 1 : 0);
    foliaNomandSet1f(layer, 'u_inverted', ditheringInverted ? 1 : 0);
    foliaNomandSet1f(layer, 'u_type', NOMAND_DITHERING_TYPES[t.ditheringType]);
    foliaNomandSet1f(layer, 'u_pxSize', t.size);
    foliaNomandSet1f(layer, 'u_colorSteps', t.colorSteps);
  }

  function foliaNomandApplyOverlay(inst) {
    var overlay = inst.overlay;
    if (!overlay) return;
    var t = inst.tuning;
    /* 没有图源时 Folia 直接 return 一块纯色底，overlay 根本不存在。 */
    var visible = !!inst.sourceUrl && !!t.overlayEnabled && t.overlayOpacity > 0;
    overlay.style.display = visible ? '' : 'none';
    overlay.style.opacity = String(visible ? t.overlayOpacity : 0);
  }

  function foliaNomandApplyTheme(inst) {
    var theme = inst.theme || {};
    var bg = theme.backgroundColor || '#05070b';
    inst.root.style.backgroundColor = bg;
    if (inst.overlay) inst.overlay.style.backgroundColor = bg;
  }

  /* ---- 绘制 ---- */

  function foliaNomandDraw(inst) {
    var layer = inst.layer;
    if (!layer || inst.destroyed) return;
    /* 图没落地就不画：Folia 在图片加载完之前根本没挂 ShaderMount（画布是空的）。 */
    if (!inst.imageReady) return;
    if (inst.effect === 'paper-texture' && !inst.noiseReady) return;

    var gl = layer.gl;
    if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return;

    var resized = foliaNomandResize(layer);
    gl.viewport(0, 0, layer.canvas.width, layer.canvas.height);
    gl.useProgram(layer.prog);
    if (resized || layer.resolutionDirty) {
      foliaNomandSet2f(layer, 'u_resolution', layer.canvas.width, layer.canvas.height);
      foliaNomandSet1f(layer, 'u_pixelRatio', layer.pixelRatio);
      layer.resolutionDirty = false;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    layer.drawCount += 1;
    inst.needsDraw = false;
  }

  /* ---- 图层生命周期 ---- */

  function foliaNomandDestroyLayers(inst) {
    if (inst.layer) foliaNomandDestroyLayer(inst.layer);
    inst.layer = null;
  }

  /* 与 Folia 的 key={sourceUrl:effect} 等价：换效果就整块重挂（连同画布与程序）。 */
  function foliaNomandBuildLayers(inst) {
    foliaNomandDestroyLayers(inst);
    if (!inst.sourceUrl) return;
    var layer = foliaNomandCreateLayer(inst.effect);
    inst.root.insertBefore(layer.el, inst.overlay);
    inst.layer = layer;
    foliaNomandApplyColors(inst);
    foliaNomandUploadImageTexture(inst);
    foliaNomandUploadNoiseTexture(inst);
    inst.needsDraw = true;
  }

  function foliaNomandUploadImageTexture(inst) {
    var layer = inst.layer;
    if (!layer || !inst.image) return;
    foliaNomandUploadTexture(layer, 'u_image', inst.image, 0, inst.effect === 'paper-texture');
    foliaNomandSet1f(layer, 'u_imageAspectRatio', inst.imageAspect);
    inst.imageReady = true;
    inst.needsDraw = true;
  }

  function foliaNomandUploadNoiseTexture(inst) {
    var layer = inst.layer;
    if (!layer || inst.effect !== 'paper-texture') return;
    if (!inst.noiseImage) return;
    foliaNomandUploadTexture(layer, 'u_noiseTexture', inst.noiseImage, 1, false);
    inst.noiseReady = true;
    inst.needsDraw = true;
  }

  function foliaNomandEnsureNoise(inst) {
    if (inst.noiseRequested || inst.effect !== 'paper-texture') return;
    inst.noiseRequested = true;
    foliaNomandLoadNoise().then(function (image) {
      if (inst.destroyed || inst.effect !== 'paper-texture') return;
      if (!image) return;
      inst.noiseImage = image;
      foliaNomandUploadNoiseTexture(inst);
      foliaNomandDraw(inst);
    }, function () {});
  }

  function foliaNomandLoadCover(inst) {
    inst.imageToken = (inst.imageToken || 0) + 1;
    var token = inst.imageToken;
    inst.imageReady = false;
    var src = foliaNomandCoverSrc(inst.sourceUrl);
    if (!src) {
      inst.image = null;
      inst.imageAspect = 1;
      return;
    }
    foliaNomandLoadImage(src).then(function (loaded) {
      if (inst.destroyed || token !== inst.imageToken) return;
      if (!loaded) {
        inst.image = null;
        return;
      }
      inst.image = loaded.image;
      inst.imageAspect = loaded.aspect;
      /* 换效果后画布是新的，纹理要重传（uploadImageTexture 会一并把 aspect 写进 uniform）。 */
      foliaNomandUploadImageTexture(inst);
      foliaNomandDraw(inst);
    }, function () {
      if (inst.destroyed || token !== inst.imageToken) return;
      inst.image = null;
    });
  }

  /* 封面 / 图片来源变了：重解析 URL，变了才重新加载。 */
  function foliaNomandSyncSource(inst, coverUrl, tuning) {
    var nextUrl = foliaNomandResolveSourceUrl(coverUrl, inst.customImage, tuning);
    var nextSrc = foliaNomandCoverSrc(nextUrl);
    var prevSrc = foliaNomandCoverSrc(inst.sourceUrl);
    inst.sourceUrl = nextUrl;
    if (nextSrc === prevSrc) return false;

    /* 换图就是换一张：先作废旧图（Folia 的 key 变了会整块重挂，旧纹理不再参与绘制）。 */
    inst.image = null;
    inst.imageReady = false;
    if (!nextUrl) {
      foliaNomandDestroyLayers(inst);
      foliaNomandApplyOverlay(inst);
      return true;
    }
    if (!inst.layer) foliaNomandBuildLayers(inst);
    foliaNomandApplyOverlay(inst);
    foliaNomandLoadCover(inst);
    return true;
  }

  /* ---- 生命周期 ---- */

  function foliaNomandCreate(host, ctx) {
    var tuning = foliaNomandTuning();
    var root = foliaNomandEl('folia-bg-nomand');
    var overlay = foliaNomandEl('folia-bg-nomand-overlay');
    root.appendChild(overlay);

    var theme = (ctx && ctx.theme) || null;
    var customImage = foliaNomandCustomImage();
    var coverUrl = String((ctx && ctx.song && ctx.song.coverUrl) || '');
    var inst = {
      root: root,
      overlay: overlay,
      layer: null,
      tuning: tuning,
      effect: tuning.effect,
      theme: theme,
      daylight: foliaNomandIsDaylight(theme),
      customImage: customImage,
      coverUrl: coverUrl,
      sourceUrl: null,
      image: null,
      imageAspect: 1,
      imageReady: false,
      imageToken: 0,
      noiseImage: null,
      noiseReady: false,
      noiseRequested: false,
      needsDraw: true,
      observer: null,
      destroyed: false
    };
    inst.sourceUrl = foliaNomandResolveSourceUrl(coverUrl, customImage, tuning);

    /* 主题色先落地，再建图层：create 阶段就要有底色，否则首帧是空白。 */
    foliaNomandApplyTheme(inst);
    if (inst.sourceUrl) {
      try {
        foliaNomandBuildLayers(inst);
      } catch (err) {
        foliaNomandDestroyLayers(inst);
        if (root.parentNode) root.parentNode.removeChild(root);
        throw err;
      }
    }
    host.appendChild(root);
    foliaNomandApplyOverlay(inst);

    /* 尺寸变化只在真的变了的时候重画一帧（五档效果都是静态图，没有动画循环）。 */
    if (typeof ResizeObserver === 'function') {
      var schedule = function () {
        if (inst.destroyed) return;
        inst.needsDraw = true;
      };
      try {
        inst.observer = new ResizeObserver(schedule);
        inst.observer.observe(root);
      } catch (_) { inst.observer = null; }
    }

    foliaNomandEnsureNoise(inst);
    if (inst.sourceUrl) foliaNomandLoadCover(inst);
    return inst;
  }

  function foliaNomandTick(inst, ctx) {
    if (!inst || inst.destroyed || !ctx) return;

    /* 换肤：主题四个色直接决定 uniform，换主题要重落一次。 */
    var theme = ctx.theme || null;
    if (theme && theme !== inst.theme) {
      inst.theme = theme;
      inst.daylight = foliaNomandIsDaylight(theme);
      foliaNomandApplyTheme(inst);
      if (inst.layer) {
        foliaNomandApplyColors(inst);
        inst.needsDraw = true;
      }
    }

    /* 换歌：封面 URL 变了就重新取图（Folia 是 coverUrl prop 变化重挂组件）。 */
    var coverUrl = String((ctx.song && ctx.song.coverUrl) || '');
    if (coverUrl !== inst.coverUrl) {
      inst.coverUrl = coverUrl;
      foliaNomandSyncSource(inst, coverUrl, inst.tuning);
    }

    if (inst.needsDraw) foliaNomandDraw(inst);
  }

  function foliaNomandDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    if (inst.observer) {
      try { inst.observer.disconnect(); } catch (_) {}
      inst.observer = null;
    }
    inst.imageToken = (inst.imageToken || 0) + 1;
    foliaNomandDestroyLayers(inst);
    if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
  }

  /* ---- 对外入口（面板 / 控制台） ---- */

  function foliaNomandWriteStoredTuning(tuning) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(NOMAND_TUNING_STORE_KEY, JSON.stringify(tuning));
      }
    } catch (_) {}
  }

  /* 合并 + 就地生效；persist=false 时只改内存（滑块拖动中每帧走这条，松手再 Save）。
   * 基准取内存缓存并**克隆一份**：直接改缓存对象会让下面的 sourceModeChanged 比较失效
   * （inst.tuning 与 next 是同一份对象时永远相等，切上传图就不刷新来源了）。 */
  function foliaNomandMergeTuning(patch, target, persist) {
    if (!patch || typeof patch !== 'object') return { tuning: null, changed: false };
    var next = foliaNomandNormalizeTuning(foliaNomandTuningCache || foliaNomandReadStoredTuning());
    var normalized = foliaNomandNormalizeTuning(patch);
    var changed = false;
    for (var key in NOMAND_TUNING_DEFAULT) {
      if (!Object.prototype.hasOwnProperty.call(NOMAND_TUNING_DEFAULT, key)) continue;
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      if (next[key] !== normalized[key]) {
        next[key] = normalized[key];
        changed = true;
      }
    }
    if (!changed) return { tuning: next, changed: false };

    if (persist) foliaNomandWriteStoredTuning(next);
    foliaNomandTuningCache = next;

    /* 就地生效：换效果要重建画布（Folia 是 key 变化重挂组件），其余只重落 uniform。 */
    var inst = target || ((typeof foliaWorld !== 'undefined' && foliaWorld) ? foliaWorld.bgInstance : null);
    if (inst && !inst.destroyed && inst.tuning) {
      var effectChanged = inst.effect !== next.effect;
      var sourceModeChanged = inst.tuning.imageSource !== next.imageSource;
      inst.tuning = next;
      foliaNomandApplyTheme(inst);
      foliaNomandApplyOverlay(inst);
      if (effectChanged) {
        inst.effect = next.effect;
        inst.noiseReady = false;
        inst.noiseRequested = false;
        if (inst.sourceUrl) foliaNomandBuildLayers(inst);
        else foliaNomandDestroyLayers(inst);
        foliaNomandEnsureNoise(inst);
      } else if (inst.layer) {
        foliaNomandApplyColors(inst);
        inst.needsDraw = true;
      }
      if (sourceModeChanged) foliaNomandSyncSource(inst, inst.coverUrl, next);
      foliaNomandDraw(inst);
    }
    return { tuning: next, changed: true };
  }

  /* 对外：set = 改 + 落盘（旧语义不变，冒烟与控制台都按它断言「设一次就写存档」）；
   * preview = 只改内存（面板拖动中）；save = 把当前缓存落盘（面板松手）。 */
  function foliaNomandSetTuning(patch, target) {
    return foliaNomandMergeTuning(patch, target, true).tuning;
  }

  function foliaNomandPreviewTuning(patch, target) {
    return foliaNomandMergeTuning(patch, target, false).tuning;
  }

  function foliaNomandSaveTuning() {
    foliaNomandWriteStoredTuning(foliaNomandTuning());
  }

  /* 回默认（types.ts:1019）。和另外三个背景的 Reset 同语义：改内存 + 落盘 + 就地生效。 */
  function foliaNomandResetTuning(target) {
    var defaults = foliaNomandNormalizeTuning(null);
    var patch = {};
    for (var key in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) patch[key] = defaults[key];
    }
    foliaNomandTuningCache = null;
    return foliaNomandMergeTuning(patch, target, true).tuning || defaults;
  }

  window.foliaNomandTuning = foliaNomandTuning;
  window.foliaNomandSetTuning = foliaNomandSetTuning;
  window.foliaNomandPreviewTuning = foliaNomandPreviewTuning;
  window.foliaNomandSaveTuning = foliaNomandSaveTuning;
  window.foliaNomandResetTuning = foliaNomandResetTuning;
  /* 预放大与反色是纯数学，单独暴露出来给冒烟/突变做判据（面板不会用）。 */
  window.foliaNomandPaperOverscan = foliaNomandPaperOverscan;
  window.foliaNomandLensOverscan = foliaNomandLensOverscan;
  window.foliaNomandResolveDaylightInversion = foliaNomandResolveDaylightInversion;
  window.foliaNomandResolveHalftoneInversion = foliaNomandResolveHalftoneInversion;

  /* 名字 / 排序取 Folia 权威值：
   *   options.visualizerBackgroundModeNomand = 漫游（zh-CN.ts:2084）
   *   nomand/entry.tsx: order 30 / labelFallback 'Nomand'
   * 描述取 zh-CN.ts:472 的 pickerDescription。 */
  registerFoliaBackground('nomand', {
    name: '漫游',
    desc: '给封面或自定义图罩上 Paper 纸感效果',
    order: 30,
    needsWebGL2: true,
    create: foliaNomandCreate,
    tick: foliaNomandTick,
    destroy: foliaNomandDestroy
  });
})();
