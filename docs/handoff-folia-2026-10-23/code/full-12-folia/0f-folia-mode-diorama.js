/* Folia 世界 — 歌词样式：镜台（diorama）
 *
 * 移植自 Folia src/components/visualizer/diorama/（VisualizerDiorama 497 +
 * DioramaScene 641 + CameraRig 640 + cameraPath 1040 + dioramaSceneFrame 286 +
 * dioramaSceneLayout 213 + dioramaSceneUnits 137 + dioramaSceneConstants 115 +
 * dioramaTextRaster 171 + dioramaLineRasterCache 98 + dioramaSequencer 153 +
 * dioramaTransition 102 + dioramaGeometry 86 + dioramaKeywordColor 180 +
 * dioramaMoteField 164 + dioramaParticleModel 507 + dioramaParticleShaders 360 +
 * dioramaParticleSurfaces 242 + dioramaParticleMaterials 178 +
 * dioramaParticleCorridor 100 + DioramaParticleField 382 +
 * DioramaActiveUnitPlanes 48 + entry 23 + tuning 4）。
 *
 * 画面 = 一条蜿蜒 3D 走廊：每行歌词是自己路径锚点上的「活字」（当前行拆成逐字/逐词平面，
 * 带普通辉光 / 灵魂出窍 / 渐变三条独立跟唱路径），镜头按该行的运镜手法（13 种）+ 读数对齐
 * 物理跟随；点阵层（formation 云 / 路径隧道）由音频瞬态在 GPU 上激起涟漪。切歌不黑屏：
 * 新歌走廊生成在 46 单位外，镜头飞一条 eased Bezier 弧过去，旧走廊退进雾里。
 *
 * 必须照抄的判据（改一处就整体走形）：
 *   - 路径：步距 8，yaw 0.5 / pitch 0.32 上限的正弦 Turtle；right = forward × worldUp
 *   - 英雄距离 5.2，相机抬升 0.5，安全帧 0.92，漂移 0.4/0.4/0.5，超 24 直接 snap
 *   - 文本摆放：offsetR 1.8 / offsetU 1.2 / roll 0.2 / yaw 0.16 / look 1.1（weave 缩放）
 *   - 字号 0.62 em/行，帧占比 0.72，最小 fit 0.28；邻行 opacity 按符号偏移表 + 距离生命周期
 *   - 雾 12→30，文字淡入 32→40 / 近融 2.0→0.9，形状淡入 27→20 / 近溶 3.0→1.2
 *   - 运镜权重表（13 种 × 副模式）+ 前两行去重；回正权重 × 镜头天花板；朝向低通 4.2
 *   - 跟唱：未唱 0.5 / 当前 0.92；辉光 envelope 14/4.5；灵魂 12/2.2 + 0.5s 交接；
 *     渐变能量 = smoothstep(唱段) → 保持 0.35s → 衰减 1.8s
 *   - 点阵：密度 96~1536 步进 24；云簇 1024 / 隧道段 2048 点；波数上限 = 2π/(间距×4)
 *   - 涟漪：三频段 × 3 槽；bass 1.45/0.9/0.66/3.4，mid 0.9/1.6/0.36/5.5，treble 0.5/2.5/0.22/9
 *   - 隧道半径 7.4，云振幅 0.34 / 隧道 0.45（半径分数），d 满量程 = 0.85 × 振幅
 *   - 尘埃：窗口 8 行（-2/+5），内半径 2.4 + 径向跨 5.2，垂直压缩 0.64
 *
 * 色彩管线（r128 精确复刻 Folia 的 three 0.185 + ColorManagement）：
 *   renderer.outputEncoding = sRGBEncoding；CanvasTexture.encoding = sRGBEncoding；
 *   所有 THREE.Color 由 CSS 串经 sRGB→linear 换算后写入；自定义粒子着色器自带
 *   linearToSRGB（Folia 同款，因为 ShaderMaterial 不包含 colorspace_fragment）。
 *   两者在混合前都是 sRGB 编码值，与 Folia 注释里「framebuffer is sRGB-encoded」一致。
 *
 * 与 Folia 的实现差异（输入数据缺失，非公式差异）：
 *   1) 本项目 lines 没有 renderHints → dioramaLineRenderEndTime 回落 endTime
 *      （Folia getLineRenderEndTime 的 fallback 也是 endTime；monet 同样处理）。
 *   2) 本项目 lines 没有 blockIndex / songPart / isChorus → 运镜权重里这些特征取中性值，
 *      公式本身一字不改。
 *   3) theme.wordColors 恒为 [] → 关键字着色路径照常存在但永不命中（回落 accent）。
 *   4) React 渲染结构（memo / useFrame）换成每帧按签名差量重建；rAF 分批栅格化换成
 *      每帧预算 2 行（本模式的 tick 就是主循环的帧）。
 *   5) Folia 侧 three 0.185 + R3F；本项目用 vendor/three.r128.min.js（UMD 全局），
 *      不需要 WebGL2，所以不置 needsWebGL2。
 */
(function () {
  'use strict';

  if (typeof registerFoliaMode !== 'function') return;

  /* ============================== 1. 常量 ============================== */

  /* cameraPath.ts */
  var DIORAMA_STEP_DISTANCE = 8;
  var DIORAMA_MAX_YAW = 0.5;
  var DIORAMA_MAX_PITCH = 0.32;
  var DIORAMA_HERO_DISTANCE = 5.2;
  var DIORAMA_CAMERA_LIFT = 0.5;
  var DIORAMA_SAFE_FRAME_FRACTION = 0.92;
  var DIORAMA_SWAY_AMP = 0.4;
  var DIORAMA_LIFT_AMP = 0.4;
  var DIORAMA_DIST_AMP = 0.5;
  var DIORAMA_SNAP_DISTANCE = 24;
  var DIORAMA_TEXT_OFFSET_R = 1.8;
  var DIORAMA_TEXT_OFFSET_U = 1.2;
  var DIORAMA_TEXT_ROLL = 0.2;
  var DIORAMA_TEXT_YAW = 0.16;
  var DIORAMA_TEXT_LOOK = 1.1;
  var DIORAMA_SHAPE_FADE_IN_START = 20;
  var DIORAMA_SHAPE_FADE_IN_END = 27;
  var DIORAMA_SHAPE_DISSOLVE_START = 3.0;
  var DIORAMA_SHAPE_DISSOLVE_END = 1.2;
  var DIORAMA_PARTICLE_AUDIO_SCALE_MAX = 1.44;
  var DEG_TO_RAD = Math.PI / 180;

  /* dioramaSceneConstants.ts */
  var LINES_AHEAD = 3;
  var LINES_BEHIND = 2;
  var OUTGOING_LINES_BEHIND = 2;
  var OUTGOING_LINES_AHEAD = 1;
  var CORRIDOR_LINES_AHEAD = 7;
  var CORRIDOR_LINES_BEHIND = 6;
  var NEIGHBOR_RASTER_BUDGET = 2;
  var LINE_FONT_SIZE = 0.62;
  var TARGET_FRAME_WIDTH_FRACTION = 0.72;
  var MIN_FIT_SCALE = 0.28;
  var FOG_NEAR = 12;
  var FOG_FAR = 30;
  var TEXT_DISSOLVE_START = 2.0;
  var TEXT_DISSOLVE_END = 0.9;
  var TEXT_FADE_IN_START = 32;
  var TEXT_FADE_IN_END = 40;
  var COLOR_DAMP_RATE = 1.2;
  var ACTIVE_LINE_OPACITY = 0.92;
  var UNSUNG_UNIT_OPACITY = 0.5;
  var UNIT_GLOW_MAX_OPACITY = 0.9;
  var SOUL_MAX_OPACITY = 0.6;
  var SOUL_ACTIVE_LIFT_EM = 0.06;
  var SOUL_DETACH_LIFT_EM = 0.5;
  var SOUL_ACTIVE_SWELL = 0.1;
  var SOUL_DETACH_SWELL = 0.3;
  var SOUL_HANDOFF_SECONDS = 0.5;
  var GRADIENT_HOLD_SECONDS = 0.35;
  var GRADIENT_TRAIL_SECONDS = 1.8;

  /* dioramaTransition.ts */
  var TRANSITION_DURATION = 3.2;
  var TRANSITION_DISTANCE = 46;
  var TRANSITION_BANK = 0.14;
  var TRANSITION_AIM_SWEEP = 0.14;

  /* dioramaMoteField.ts */
  var DIORAMA_MOTE_LINES_BEHIND = 2;
  var DIORAMA_MOTE_LINES_AHEAD = 5;
  var DIORAMA_MOTE_WINDOW_LINES = DIORAMA_MOTE_LINES_BEHIND + DIORAMA_MOTE_LINES_AHEAD + 1;
  var DIORAMA_MOTE_CIRCUMFERENCE_MIN = 4;
  var DIORAMA_MOTE_CIRCUMFERENCE_MAX = 48;
  var DIORAMA_MOTE_RADIAL_MIN = 1;
  var DIORAMA_MOTE_RADIAL_MAX = 4;
  var MOTE_INNER_RADIUS = 2.4;
  var MOTE_RADIAL_SPAN = 5.2;
  var MOTE_VERTICAL_SQUASH = 0.64;

  /* types.ts（DioramaTuning 默认值 + 粒子密度范围） */
  var DIORAMA_PARTICLE_DENSITY_MIN = 96;
  var DIORAMA_PARTICLE_DENSITY_MAX = 1536;
  var DIORAMA_PARTICLE_DENSITY_STEP = 24;

  /* dioramaParticleCorridor.ts */
  var DIORAMA_PARTICLE_CORRIDOR_RADIUS = 7.4;

  /* dioramaParticleModel.ts */
  var DIORAMA_MAX_PARTICLE_POINTS = 65536;
  var DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER = 1024;
  var DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN = 2048;
  var DIORAMA_RIPPLE_BANDS = [
    { band: 'bass', strength: 1.45, speed: 0.9, width: 0.66, wavenumber: 3.4 },
    { band: 'mid', strength: 0.9, speed: 1.6, width: 0.36, wavenumber: 5.5 },
    { band: 'treble', strength: 0.5, speed: 2.5, width: 0.22, wavenumber: 9 }
  ];
  var RIPPLE_SLOTS_PER_BAND = 3;
  var DIORAMA_RIPPLE_COUNT = DIORAMA_RIPPLE_BANDS.length * RIPPLE_SLOTS_PER_BAND;
  var FAST_ATTACK = 22;
  var FAST_RELEASE = 7;
  var FLOOR_RISE = 2.5;
  var FLOOR_FALL = 4;
  var PEAK_RISE = 9;
  var PEAK_FALL = 0.28;
  var MIN_RANGE = 0.12;
  var MIN_PEAK = 0.22;
  var TRIGGER_HIGH = 0.42;
  var TRIGGER_LOW = 0.2;
  var DIORAMA_CORRIDOR_PULSE_SHARE = 0.12;

  /* dioramaParticleSurfaces.ts */
  var BOX_HALF = 0.55;
  var CYLINDER_RADIUS = 0.58;
  var CYLINDER_HALF_HEIGHT = 0.75;
  var TORUS_MAJOR = 0.68;
  var TORUS_TUBE = 0.12;
  var TETRA_VERTICES = [
    [0, 0.86, 0],
    [-0.81, -0.5, 0.47],
    [0.81, -0.5, 0.47],
    [0, -0.5, -0.94]
  ];
  var TETRA_FACES = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];
  var TETRA_CENTER = [0, -0.16, 0];

  /* dioramaTextRaster.ts */
  var DIORAMA_RASTER_FONT_PX = 128;
  var DIORAMA_DEFAULT_FONT_WEIGHT = 700;
  var LINE_BAND_EM = 1.4;
  var GLOW_PAD_EM = 0.7;
  var PLAIN_PAD_EM = 0.2;
  var MAX_CANVAS_PX = 4096;
  var GLOW_BLUR_EM = 0.16;

  /* CameraRig.tsx */
  var ALIGN_SHOT_CEILING = {
    hold: 0.9, pushIn: 0.85, track: 0.85, swell: 0.8, float: 0.78, glide: 0.72,
    crane: 0.7, pullBack: 0.7, arc: 0.62, pendulum: 0.6, orbit: 0.55, spiral: 0.5, flyby: 0.5
  };
  var ALIGN_LEAD_IN = 0.6;
  var ALIGN_SETTLE = 0.35;
  var ALIGN_RELEASE = 1.0;
  var ALIGN_RATE = 1.2;
  var ALIGN_TURN_RATE = 2.6;
  var FRAME_KEEP_FRACTION = 0.7;
  var FLIGHT_SMOOTH_TIME = 1.1;
  var FLIGHT_ARC_FRAC = 0.16;
  var ORIENT_FOLLOW_RATE = 4.2;

  /* VisualizerDiorama.tsx */
  var PRUNE_MARGIN_BEHIND = 4;
  var LOOP_RESTART_MAX_INDEX = 1;
  var INSTRUMENTAL_FRAMES = 96;
  var INSTRUMENTAL_SECONDS_PER_FRAME = 5;
  var INSTRUMENTAL_COMMIT_SECONDS = 2;
  var READY_GRACE_MS = 8000;

  /* DioramaParticleField.tsx */
  var FORMATION_SETTLE_SECONDS = 0.4;
  var CLOUD_SWELL = 0.34;
  var CORRIDOR_MAX_SWELL = 0.45;
  var CORRIDOR_QUIET_SWELL = 0.1;
  var MAX_WAVE = 0.85;
  var CLOUD_MAX_SWELL = MAX_WAVE * CLOUD_SWELL;
  var CORRIDOR_MAX_SWELL_REACH = MAX_WAVE * CORRIDOR_MAX_SWELL;
  var CORRIDOR_UNITS_PER_LINE = DIORAMA_STEP_DISTANCE / DIORAMA_PARTICLE_CORRIDOR_RADIUS;

  /* types.ts:883 DEFAULT_DIORAMA_TUNING —— 面板（0l1）与归一化（0l0）用的同一份基准。 */
  var DIORAMA_TUNING_DEFAULT = {
    cameraSpeed: 1,
    motionAmount: 1,
    audioReactivity: 1,
    geometryVisibility: {
      enabled: true, mode: 'clouds',
      strands: true, blobs: true, ribbons: true, rings: true
    },
    particleDensity: 576,
    particleScale: 1,
    particleGlowEnabled: true,
    particleGlowIntensity: 0.65,
    showParticles: true,
    backgroundParticleCircumference: 28,
    backgroundParticleRadial: 2,
    glowEnabled: true,
    glowIntensity: 1,
    soulEnabled: true,
    soulIntensity: 1,
    soulActiveEnabled: false,
    gradientEnabled: false,
    gradientIntensity: 1,
    keywordColoringEnabled: true
  };

  /* 当前生效的调参：面板写在 0l0（共用存档），这里只读；0l0 没加载时回落默认值。 */
  function dioramaTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('diorama')
      : DIORAMA_TUNING_DEFAULT;
  }

  var DIORAMA_INTERLUDE_TEXT = '......';
  var SHOT_KINDS = [
    'pushIn', 'pullBack', 'orbit', 'track', 'crane', 'hold', 'swell', 'spiral', 'pendulum', 'flyby',
    'arc', 'float', 'glide'
  ];
  var CHORUS_PART = /chorus|hook|refrain|drop/i;
  var CJK_GRAPHEME_RE = /[⺀-鿿぀-ヿ豈-﫿ｦ-ﾟ•·■-◿]/;
  var WORLD_UP = { x: 0, y: 1, z: 0 };
  var DEFAULT_FRAME = {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }
  };

  /* ============================== 2. 色彩管线 ============================== */

  /* 精确 sRGB 传递函数（与 three r128 encodings chunk / Folia 着色器同款）。 */
  function dioramaSrgbToLinear(v) {
    var c = v < 0 ? 0 : (v > 1 ? 1 : v);
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function dioramaLinearToSrgb(v) {
    var c = v < 0 ? 0 : v;
    return c <= 0.0031308 ? c * 12.92 : Math.pow(c, 1 / 2.4) * 1.055 - 0.055;
  }

  /* CSS 串 → 线性 THREE.Color（复刻 ColorManagement.enabled 时的 setStyle 行为）。 */
  function dioramaColorFromCss(color) {
    var channels = null;
    try {
      if (typeof foliaParseColorChannels === 'function') channels = foliaParseColorChannels(color);
    } catch (_) {}
    var out = new THREE.Color(0, 0, 0);
    if (!channels) return out;
    out.setRGB(
      dioramaSrgbToLinear(channels.r / 255),
      dioramaSrgbToLinear(channels.g / 255),
      dioramaSrgbToLinear(channels.b / 255)
    );
    return out;
  }

  /* THREE.Color 上的 convertLinearToSRGB / convertSRGBToLinear（r152+ 才有，这里自己算）。 */
  function dioramaColorLinearToSrgb(color) {
    color.setRGB(
      dioramaLinearToSrgb(color.r),
      dioramaLinearToSrgb(color.g),
      dioramaLinearToSrgb(color.b)
    );
    return color;
  }

  function dioramaColorSrgbToLinear(color) {
    color.setRGB(
      dioramaSrgbToLinear(color.r),
      dioramaSrgbToLinear(color.g),
      dioramaSrgbToLinear(color.b)
    );
    return color;
  }

  /* WCAG 相对亮度（输入必须是线性色）。 */
  function dioramaRelativeLuminance(color) {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  }

  function dioramaContrastRatio(foreground, background) {
    var fl = dioramaRelativeLuminance(foreground);
    var bl = dioramaRelativeLuminance(background);
    var lighter = Math.max(fl, bl);
    var darker = Math.min(fl, bl);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /* ============================== 3. 纯数学 ============================== */

  function dioramaClamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function dioramaClamp01(value) { return Math.min(1, Math.max(0, value)); }
  function dioramaSmoothstep01(t) {
    var c = dioramaClamp01(t);
    return c * c * (3 - 2 * c);
  }
  function dioramaSmoothstep(edge0, edge1, value) {
    var amount = dioramaClamp01((value - edge0) / (edge1 - edge0));
    return amount * amount * (3 - 2 * amount);
  }
  function dioramaStepEnvelope(current, target, attack, release, delta) {
    return current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta));
  }

  function dioramaSeededUnit(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function dioramaHashSeed(seed) {
    if (typeof seed === 'number') return seed;
    if (!seed) return 1;
    var hash = 0;
    for (var i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
    }
    return hash || 1;
  }

  /* Unity 式临界阻尼 SmoothDamp（带速度，进出都不带折角）。 */
  function dioramaSmoothDamp(current, target, velocity, smoothTime, deltaSeconds) {
    var t = Math.max(0.0001, smoothTime);
    var omega = 2 / t;
    var x = omega * deltaSeconds;
    var exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var change = current - target;
    var temp = (velocity + omega * change) * deltaSeconds;
    var newVelocity = (velocity - omega * temp) * exp;
    var value = target + (change + temp) * exp;
    return { value: value, velocity: newVelocity };
  }

  function dioramaFrameHalfWidth(distance, verticalFovDeg, aspect) {
    return distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect;
  }

  function dioramaVecSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dioramaVecCross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function dioramaVecNorm(a) {
    var len = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / len, y: a.y / len, z: a.z / len };
  }
  function dioramaVecAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function dioramaVecLen(a) { return Math.hypot(a.x, a.y, a.z); }
  function dioramaVecScaleTo(a, target) {
    var l = dioramaVecLen(a) || 1;
    return { x: (a.x / l) * target, y: (a.y / l) * target, z: (a.z / l) * target };
  }

  /* ---- 运动参数：tuning + 主题强度 → 一捆缩放 ---- */
  var DIORAMA_SUB_MODE_PRESETS = {
    normal: { move: 1, drift: 0.62, smooth: 0.42, audio: 1, weave: 1 },
    calm: { move: 0.6, drift: 0.4, smooth: 0.56, audio: 0.5, weave: 0.5 },
    chaotic: { move: 1.35, drift: 0.85, smooth: 0.33, audio: 1.35, weave: 1.35 }
  };

  function dioramaResolveMotionParams(tuning, themeIntensity) {
    var t = tuning || DIORAMA_TUNING_DEFAULT;
    var mode = themeIntensity === 'calm' ? 'calm' : (themeIntensity === 'chaotic' ? 'chaotic' : 'normal');
    var preset = DIORAMA_SUB_MODE_PRESETS[mode];
    var motion = dioramaClamp(t.motionAmount, 0.4, 1.6);
    var speed = dioramaClamp(t.cameraSpeed, 0.55, 1.85);
    var audio = dioramaClamp(t.audioReactivity, 0, 1.5);
    return {
      moveScale: preset.move * motion,
      driftScale: preset.drift * motion,
      smoothTime: preset.smooth / speed,
      audioLevel: preset.audio * audio,
      weaveScale: preset.weave * motion,
      subMode: mode
    };
  }

  /* ---- 蜿蜒路径 + 每行本地坐标 ---- */
  function dioramaBuildPath(count, seed) {
    var base = dioramaHashSeed(seed);
    var n = Math.max(count, 1);
    var positions = [];
    var pos = { x: 0, y: 0, z: 0 };
    var i;
    for (i = 0; i <= n; i += 1) {
      positions.push({ x: pos.x, y: pos.y, z: pos.z });
      var yaw = DIORAMA_MAX_YAW * (Math.sin(i * 0.23 + base * 0.017) * 0.62 + Math.sin(i * 0.11 + base * 0.041 + 1.3) * 0.38);
      var pitch = DIORAMA_MAX_PITCH * Math.sin(i * 0.17 + base * 0.029 + 0.7);
      var cp = Math.cos(pitch);
      var dir = { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
      pos = {
        x: pos.x + dir.x * DIORAMA_STEP_DISTANCE,
        y: pos.y + dir.y * DIORAMA_STEP_DISTANCE,
        z: pos.z + dir.z * DIORAMA_STEP_DISTANCE
      };
    }
    var frames = [];
    for (i = 0; i < n; i += 1) {
      var forward = dioramaVecNorm(dioramaVecSub(positions[i + 1], positions[i]));
      var right = dioramaVecNorm(dioramaVecCross(forward, WORLD_UP));
      var up = dioramaVecNorm(dioramaVecCross(right, forward));
      frames.push({ position: positions[i], forward: forward, right: right, up: up });
    }
    return frames;
  }

  function dioramaGetFrame(frames, index) {
    if (!frames || frames.length === 0) return DEFAULT_FRAME;
    var i = dioramaClamp(index, 0, frames.length - 1);
    return frames[i] || DEFAULT_FRAME;
  }

  function dioramaTranslateFrames(frames, offset) {
    return frames.map(function (f) {
      return {
        position: dioramaVecAdd(f.position, offset),
        forward: f.forward, right: f.right, up: f.up
      };
    });
  }

  function dioramaComposeLocal(frame, right, up, depth) {
    return {
      x: frame.position.x + frame.right.x * right + frame.up.x * up + frame.forward.x * depth,
      y: frame.position.y + frame.right.y * right + frame.up.y * up + frame.forward.y * depth,
      z: frame.position.z + frame.right.z * right + frame.up.z * up + frame.forward.z * depth
    };
  }

  /* 直线延伸一帧（歌词范围之外的尘埃 / 隧道用）。 */
  function dioramaExtendFrame(frame, steps) {
    if (steps === 0) return frame;
    return {
      position: {
        x: frame.position.x + frame.forward.x * DIORAMA_STEP_DISTANCE * steps,
        y: frame.position.y + frame.forward.y * DIORAMA_STEP_DISTANCE * steps,
        z: frame.position.z + frame.forward.z * DIORAMA_STEP_DISTANCE * steps
      },
      forward: frame.forward,
      right: frame.right,
      up: frame.up
    };
  }

  /* 文字朝向四元数：+X→right / +Y→up / +Z→-forward，再乘 yaw / roll。 */
  var _basisRight = new THREE.Vector3();
  var _basisUp = new THREE.Vector3();
  var _basisFwd = new THREE.Vector3();
  var _basisMatrix = new THREE.Matrix4();
  var _basisQuat = new THREE.Quaternion();
  var _tiltQuat = new THREE.Quaternion();
  var _axisY = new THREE.Vector3(0, 1, 0);
  var _axisZ = new THREE.Vector3(0, 0, 1);

  function dioramaFrameQuaternion(frame, roll, yaw) {
    _basisRight.set(frame.right.x, frame.right.y, frame.right.z);
    _basisUp.set(frame.up.x, frame.up.y, frame.up.z);
    _basisFwd.set(-frame.forward.x, -frame.forward.y, -frame.forward.z);
    _basisMatrix.makeBasis(_basisRight, _basisUp, _basisFwd);
    _basisQuat.setFromRotationMatrix(_basisMatrix);
    if (yaw) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisY, yaw));
    if (roll) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisZ, roll));
    return [_basisQuat.x, _basisQuat.y, _basisQuat.z, _basisQuat.w];
  }

  function dioramaResolveReadHeadTruck(wordProgress, trackWidth, visibleHalfWidth) {
    if (trackWidth <= 0) return 0;
    var wordOffset = (dioramaClamp01(wordProgress) - 0.5) * trackWidth;
    var allowed = Math.max(Math.abs(visibleHalfWidth - trackWidth / 2), 0.001);
    return allowed * Math.tanh(wordOffset / allowed);
  }

  /* ---- 每行自由文本摆放 ---- */
  function dioramaTextPlacement(lineIndex, seed, weave) {
    var base = dioramaHashSeed(seed);
    var i = Math.max(lineIndex, 0);
    var w = weave === undefined ? 1 : weave;
    var jitterR = (dioramaSeededUnit(base + i * 11 + 2) - 0.5) * 0.6;
    var jitterU = (dioramaSeededUnit(base + i * 11 + 4) - 0.5) * 0.6;
    var wanderR = Math.sin(i * 0.47 + base * 0.019) * 0.7 + jitterR;
    var wanderU = Math.sin(i * 0.29 + base * 0.027 + 0.9) * 0.7 + jitterU;
    return {
      offsetR: wanderR * DIORAMA_TEXT_OFFSET_R * w,
      offsetU: wanderU * DIORAMA_TEXT_OFFSET_U * w,
      scale: 0.82 + dioramaSeededUnit(base + i * 11 + 5) * 0.46,
      roll: (dioramaSeededUnit(base + i * 11 + 6) - 0.5) * 2 * DIORAMA_TEXT_ROLL * w,
      yaw: (dioramaSeededUnit(base + i * 11 + 7) - 0.5) * 2 * DIORAMA_TEXT_YAW * w,
      lookR: (dioramaSeededUnit(base + i * 11 + 8) - 0.5) * 2 * DIORAMA_TEXT_LOOK * w
    };
  }

  /* ---- 运镜语言 ---- */
  function dioramaEaseInOut(p) {
    var c = dioramaClamp01(p);
    return c * c * (3 - 2 * c);
  }

  function dioramaShotDir(lineIndex, seed) {
    return dioramaSeededUnit(dioramaHashSeed(seed) + lineIndex * 7 + 3) < 0.5 ? -1 : 1;
  }

  function dioramaLineNoteProfile(line) {
    var maxNote = 0;
    var sum = 0;
    var noteCount = 0;
    var words = (line && line.words) || [];
    for (var i = 0; i < words.length; i += 1) {
      var d = words[i].endTime - words[i].startTime;
      if (d > 0) {
        maxNote = Math.max(maxNote, d);
        sum += d;
        noteCount += 1;
      }
    }
    return { maxNote: maxNote, avgNote: noteCount > 0 ? sum / noteCount : 0, noteCount: noteCount };
  }

  function dioramaComputeShotWeights(lineIndex, lines, subMode) {
    var line = lines[lineIndex];
    var prev = lineIndex > 0 ? lines[lineIndex - 1] : undefined;
    var wordCount = (line && line.words && line.words.length) || 0;
    var isChorus = !!(line && line.isChorus) || CHORUS_PART.test((line && line.songPart) || '');
    var sectionStart = !!line && !!prev
      && (line.blockIndex !== prev.blockIndex || (line.songPart || '') !== (prev.songPart || ''));
    var note = dioramaLineNoteProfile(line);
    var hasLongNote = note.maxNote >= 1.3;
    var staccato = note.noteCount >= 4 && note.avgNote > 0 && note.avgNote <= 0.34;

    var w = {
      pushIn: 1, pullBack: 1, orbit: 1, track: 1, crane: 1, hold: 1, swell: 0.85,
      spiral: 0.9, pendulum: 1, flyby: 0.9, arc: 1, float: 0.9, glide: 1
    };
    if (isChorus) {
      w.orbit += 2.4; w.pushIn += 1.8; w.spiral += 1.2; w.crane += 0.8; w.flyby += 0.6;
      w.arc += 1.0; w.glide += 0.6; w.hold -= 0.6; w.track -= 0.2;
    } else {
      w.track += 1.1; w.crane += 0.9; w.hold += 0.9; w.pendulum += 0.8;
      w.float += 0.8; w.glide += 0.6; w.arc += 0.4;
    }
    if (wordCount >= 8) {
      w.track += 1.6; w.pullBack += 1; w.orbit -= 0.4; w.pushIn -= 0.3;
    } else if (wordCount <= 3) {
      w.pushIn += 1.4; w.orbit += 0.9; w.hold += 0.5; w.track -= 0.8;
    }
    if (sectionStart) {
      w.pullBack += 2.2; w.crane += 1.4; w.glide += 1.0; w.pushIn -= 0.4;
    }
    if (hasLongNote) {
      w.swell += 2.4; w.spiral += 1.0; w.float += 1.2; w.pendulum += 0.6;
      w.orbit += 0.8; w.arc += 0.6; w.hold += 0.3; w.track -= 0.5;
    }
    if (staccato) {
      w.track += 1.4; w.flyby += 1.5; w.pushIn += 0.8; w.swell -= 1.6; w.hold -= 0.8; w.crane -= 0.4;
    }
    if (subMode === 'calm') {
      w.hold += 1.4; w.float += 1.3; w.swell += 0.9; w.glide += 0.8; w.arc += 0.5; w.crane += 0.4;
      w.orbit *= 0.4; w.spiral *= 0.35; w.flyby *= 0.3; w.pendulum *= 0.5; w.pushIn *= 0.7;
    } else if (subMode === 'chaotic') {
      w.orbit += 1.3; w.spiral += 1.3; w.flyby += 1.2; w.pendulum += 1.0;
      w.pushIn += 0.8; w.arc += 0.6; w.crane += 0.4;
      w.hold *= 0.35; w.float *= 0.55; w.swell *= 0.7;
    }
    SHOT_KINDS.forEach(function (key) { w[key] = Math.max(0.05, w[key]); });
    return w;
  }

  function dioramaWeightedPickShot(weights, u) {
    var total = 0;
    var k;
    for (k = 0; k < SHOT_KINDS.length; k += 1) total += weights[SHOT_KINDS[k]];
    var acc = dioramaClamp01(u) * total;
    for (k = 0; k < SHOT_KINDS.length; k += 1) {
      acc -= weights[SHOT_KINDS[k]];
      if (acc <= 0) return SHOT_KINDS[k];
    }
    return 'hold';
  }

  function dioramaBasePickShot(lineIndex, lines, seed, subMode) {
    if (!lines[lineIndex]) return 'hold';
    var u = dioramaSeededUnit(dioramaHashSeed(seed) + lineIndex * 101 + 7);
    return dioramaWeightedPickShot(dioramaComputeShotWeights(lineIndex, lines, subMode), u);
  }

  function dioramaGetShot(lineIndex, lines, seed, subMode) {
    var pick = dioramaBasePickShot(lineIndex, lines, seed, subMode);
    var prev1 = lineIndex > 0 ? dioramaBasePickShot(lineIndex - 1, lines, seed, subMode) : null;
    var prev2 = lineIndex > 1 ? dioramaBasePickShot(lineIndex - 2, lines, seed, subMode) : null;
    if (pick === prev1 || pick === prev2) {
      var others = SHOT_KINDS.filter(function (k) { return k !== pick && k !== prev1 && k !== prev2; });
      var pool = others.length > 0 ? others : SHOT_KINDS.filter(function (k) { return k !== pick; });
      var alt = dioramaSeededUnit(dioramaHashSeed(seed) + lineIndex * 53 + 19);
      return pool[Math.floor(dioramaClamp01(alt) * pool.length) % pool.length];
    }
    return pick;
  }

  function dioramaResolveShotOffset(kind, ctx) {
    var hero = ctx.hero;
    var lift = ctx.lift;
    var seed = ctx.seed;
    var lineIndex = ctx.lineIndex;
    var e = dioramaEaseInOut(ctx.progress);
    var dir = dioramaShotDir(lineIndex, seed);
    var right = 0;
    var up = lift;
    var back = hero;

    switch (kind) {
      case 'pushIn':
        back = hero * (1.5 - 0.8 * e);
        up = lift * (1.2 - 0.5 * e) + 0.15;
        break;
      case 'pullBack':
        back = hero * (0.85 + 1.15 * e);
        up = lift + 1.7 * e;
        break;
      case 'orbit': {
        var theta = dir * 0.55 * (2 * e - 1);
        right = hero * Math.sin(theta);
        back = hero * Math.cos(theta);
        up = lift + 0.4;
        break;
      }
      case 'track':
        right = dir * hero * 0.34 * Math.sin(Math.PI * dioramaClamp01(ctx.wordProgress));
        back = hero * 1.06;
        up = lift + 0.12;
        break;
      case 'crane': {
        var from = dir > 0 ? -1.5 : 2.4;
        var to = dir > 0 ? 2.4 : -1.4;
        up = from + (to - from) * e;
        back = hero * 1.05;
        break;
      }
      case 'swell': {
        var st = dir * 0.4 * e;
        right = hero * Math.sin(st) * 1.1;
        back = hero * (1.0 + 0.35 * e);
        up = lift + 1.2 * e + 0.3;
        break;
      }
      case 'spiral': {
        var sp = dir * 0.7 * (2 * e - 1);
        right = hero * Math.sin(sp) * 0.85;
        back = hero * (1.05 - 0.1 * e);
        up = lift - 0.8 + 2.4 * e;
        break;
      }
      case 'pendulum':
        right = dir * hero * 0.45 * (2 * e - 1);
        up = lift + 0.9 - 0.9 * Math.sin(Math.PI * e);
        back = hero * 1.02;
        break;
      case 'flyby':
        right = dir * hero * (0.7 - 1.4 * e);
        back = hero * (0.78 + 0.12 * Math.sin(Math.PI * e));
        up = lift + 0.05;
        break;
      case 'arc': {
        var at = dir * 0.5 * Math.sin(Math.PI * e);
        right = hero * Math.sin(at) * 1.3;
        back = hero * (1.05 + 0.12 * (1 - Math.cos(at)));
        up = lift + 0.5 * Math.sin(Math.PI * e);
        break;
      }
      case 'float':
        right = dir * hero * 0.16 * Math.sin(e * Math.PI * 2);
        up = lift + 0.6 + 0.5 * Math.sin(e * Math.PI * 2 + 1.0);
        back = hero * (1.05 + 0.06 * Math.sin(e * Math.PI));
        break;
      case 'glide':
        right = dir * hero * 0.22 * e;
        up = lift + 1.4 * e;
        back = hero * (1.15 - 0.25 * e);
        break;
      case 'hold':
      default:
        up = lift + 0.3 * Math.sin(ctx.progress * Math.PI);
        back = hero;
        break;
    }

    var m = ctx.moveScale;
    return {
      right: right * m,
      up: lift + (up - lift) * m,
      back: hero + (back - hero) * m
    };
  }

  var HOLD_SETTLE_DELAY = 3;
  var HOLD_SETTLE_EASE = 5;

  function dioramaResolveHoldSettle(secondsHeld) {
    var t = dioramaClamp01((secondsHeld - HOLD_SETTLE_DELAY) / HOLD_SETTLE_EASE);
    return 1 - t * t * (3 - 2 * t);
  }

  function dioramaResolveCameraDrift(time, seed, scale) {
    var ph = dioramaHashSeed(seed) * 0.017;
    return {
      swayX: (Math.sin(time * 0.11 + ph) * 0.6 + Math.sin(time * 0.047 + ph * 1.7) * 0.4) * DIORAMA_SWAY_AMP * scale,
      swayY: Math.sin(time * 0.09 + ph * 0.7) * DIORAMA_SWAY_AMP * 0.5 * scale,
      lift: (Math.sin(time * 0.13 + ph * 1.3) * 0.6 + Math.sin(time * 0.061 + ph * 2.1) * 0.4) * DIORAMA_LIFT_AMP * scale,
      dist: Math.sin(time * 0.05 + ph * 1.1) * DIORAMA_DIST_AMP * scale
    };
  }

  function dioramaResolveShapeLifeOpacity(distanceToCamera) {
    var farT = dioramaClamp01(
      (DIORAMA_SHAPE_FADE_IN_END - distanceToCamera) / (DIORAMA_SHAPE_FADE_IN_END - DIORAMA_SHAPE_FADE_IN_START)
    );
    var nearT = dioramaClamp01(
      (distanceToCamera - DIORAMA_SHAPE_DISSOLVE_END) / (DIORAMA_SHAPE_DISSOLVE_START - DIORAMA_SHAPE_DISSOLVE_END)
    );
    var farS = farT * farT * (3 - 2 * farT);
    var nearS = nearT * nearT * (3 - 2 * nearT);
    return farS * nearS;
  }

  /* ---- 程序化几何 formation ---- */
  function dioramaSpecClearanceRadius(spec) {
    var familyRadius = spec.kind === 'box'
      ? 0.5
      : spec.kind === 'sphere'
        ? 0.74
        : spec.kind === 'cone'
          ? 0.68
          : 0.9;
    return spec.scale * Math.max(familyRadius, spec.stretchY * 0.55);
  }

  function dioramaSeparateSpecs(specs) {
    var iter, a, b, A, B, minDist, dr, du, dd, dist, push;
    for (iter = 0; iter < 6; iter += 1) {
      for (a = 0; a < specs.length; a += 1) {
        for (b = a + 1; b < specs.length; b += 1) {
          A = specs[a];
          B = specs[b];
          minDist = (dioramaSpecClearanceRadius(A) + dioramaSpecClearanceRadius(B)) * 1.3;
          dr = B.r - A.r;
          du = B.u - A.u;
          dd = B.d - A.d;
          dist = Math.hypot(dr, du, dd);
          if (dist >= minDist) continue;
          if (dist < 0.001) {
            dr = 1; du = 0.5; dd = 0.25;
            dist = Math.hypot(dr, du, dd);
          }
          push = (minDist - dist) / 2 / dist;
          A.r -= dr * push; A.u -= du * push; A.d -= dd * push;
          B.r += dr * push; B.u += du * push; B.d += dd * push;
        }
      }
    }
    specs.forEach(function (s) { s.d = Math.max(s.d, 1); });
  }

  var TEXT_CLEAR_LATERAL = 5.2;
  var TEXT_CLEAR_VERTICAL = 1.4;

  function dioramaEnforceTextClearance(specs) {
    specs.forEach(function (s, i) {
      var radius = dioramaSpecClearanceRadius(s) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX;
      if (Math.abs(s.u) - radius < TEXT_CLEAR_VERTICAL && Math.abs(s.r) - radius < TEXT_CLEAR_LATERAL) {
        var side = s.r === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(s.r);
        s.r = side * (TEXT_CLEAR_LATERAL + radius + 0.35);
      }
    });
  }

  function dioramaEnforceRailClearance(specs) {
    specs.forEach(function (s, i) {
      var radius = dioramaSpecClearanceRadius(s) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX;
      var minimum = 2.8 + radius;
      var distance = Math.hypot(s.r, s.u);
      if (distance >= minimum) return;
      var fallbackAngle = (i % 2 === 0 ? 1 : -1) * Math.PI * 0.16;
      var directionR = distance > 0.001 ? s.r / distance : Math.cos(fallbackAngle);
      var directionU = distance > 0.001 ? s.u / distance : Math.sin(fallbackAngle);
      s.r = directionR * minimum;
      s.u = directionU * minimum;
    });
  }

  function dioramaBuildFormation(lineIndex, seed, shot, frame, placement, volumeScale) {
    var salt = dioramaHashSeed(seed) + lineIndex * 97;
    var rnd = function (k) { return dioramaSeededUnit(salt + k); };
    var dir = dioramaShotDir(lineIndex, seed);
    var specs = [];
    var safeVolumeScale = Math.min(1.6, Math.max(0.65, volumeScale === undefined ? 1 : volumeScale));
    var add = function (kind, r, u, d, scale, stretchY, colorSlot) {
      specs.push({
        kind: kind, r: r, u: u, d: d,
        scale: scale * safeVolumeScale,
        stretchY: stretchY === undefined ? 1 : stretchY,
        upright: (stretchY === undefined ? 1 : stretchY) > 1.2,
        colorSlot: colorSlot
      });
    };
    var addPair = function (kind, lateral, u, d, scale, stretchY, colorSlot) {
      add(kind, -Math.abs(lateral), u, d, scale, stretchY, colorSlot);
      add(kind, Math.abs(lateral), u, d, scale, stretchY, colorSlot);
    };

    switch (shot) {
      case 'orbit': {
        var count = 6;
        var radius = 4.4 + rnd(1) * 0.6;
        for (var j = 0; j < count; j += 1) {
          var a = (j / count) * Math.PI * 2 + rnd(2) * 0.6;
          add(j === 0 ? 'torus' : 'sphere', Math.cos(a) * radius, Math.sin(a) * radius,
            0.6 + rnd(10 + j) * 1.4, 0.42 + rnd(20 + j) * 0.32);
        }
        break;
      }
      case 'pushIn': {
        var gate = 4.3 + rnd(1) * 0.5;
        [-1, 1].forEach(function (side, idx) {
          add('box', side * gate, -0.6, 0.5 + rnd(idx) * 0.5, 0.55 + rnd(2 + idx) * 0.2, 2.8 + rnd(6 + idx) * 0.8);
          add('box', side * (gate + 1.6), 0.6, 4.5 + rnd(3 + idx) * 2, 0.7 + rnd(4 + idx) * 0.3, 3.4);
        });
        break;
      }
      case 'track': {
        for (var si = 0; si < 2; si += 1) {
          var sideT = si === 0 ? -1 : 1;
          for (var jt = 0; jt < 3; jt += 1) {
            add('box', sideT * (4.2 + rnd(si * 5 + jt) * 0.4), -0.4 + (rnd(si * 7 + jt) - 0.5) * 0.6,
              0.5 + jt * 2.4, 0.5 + rnd(si * 3 + jt) * 0.15, 2.6 + rnd(si + jt) * 0.6);
          }
        }
        break;
      }
      case 'crane': {
        var cCount = 5;
        var cRadius = 3.6 + rnd(1) * 0.5;
        for (var jc = 0; jc < cCount; jc += 1) {
          var ac = Math.PI * (0.15 + 0.7 * (jc / (cCount - 1)));
          add('box', Math.cos(ac) * cRadius, Math.abs(Math.sin(ac)) * cRadius + 1.2,
            0.6 + rnd(30 + jc) * 0.8, 0.45 + rnd(40 + jc) * 0.25, 1.4);
        }
        break;
      }
      case 'swell': {
        var lat = 4.2 + rnd(2) * 0.5;
        for (var js = 0; js < 2; js += 1) {
          addPair('box', lat, -1.5 + js * 2.1, 1 + js * 1.2, 0.48 - js * 0.06, 1.45, (js % 2));
        }
        addPair('sphere', lat, 2.65, 3.4, 0.5, 1, 0);
        break;
      }
      case 'spiral': {
        var spCount = 7;
        var spRadius = 4.3;
        for (var jp = 0; jp < spCount; jp += 1) {
          var frac = jp / (spCount - 1);
          var ap = dir * frac * Math.PI * 2.2 + rnd(1) * 0.5;
          add('sphere', Math.cos(ap) * spRadius, -2.2 + frac * 5.2, 0.5 + frac * 2.2, 0.32 + rnd(20 + jp) * 0.2);
        }
        break;
      }
      case 'pendulum': {
        for (var jd = 0; jd < 4; jd += 1) {
          add('box', -3.9 + jd * 2.6 + (rnd(jd) - 0.5) * 0.5, 3.0 + rnd(jd * 2) * 1.2,
            0.5 + rnd(jd * 3) * 1.2, 0.3 + rnd(jd * 4) * 0.12, 2.2 + rnd(jd * 5) * 0.8);
        }
        break;
      }
      case 'flyby': {
        for (var jf = 0; jf < 3; jf += 1) {
          addPair('box', 4.25 + rnd(jf) * 0.25, -0.45 + jf * 0.45, 1 + jf * 2.1, 0.42 + rnd(jf * 3) * 0.1, 2.2, (jf % 2));
        }
        break;
      }
      case 'pullBack': {
        addPair('sphere', 5.8 + rnd(9) * 0.5, 1.25, 6.8 + rnd(11), 1.25 + rnd(12) * 0.25, 1, 0);
        for (var jq = 0; jq < 2; jq += 1) {
          addPair(jq === 0 ? 'box' : 'cone', 4.4 + jq * 1.15, -1.4 + jq * 2.2, 2.2 + jq * 2.1,
            0.58 + rnd(jq * 4) * 0.18, jq === 0 ? 1.5 : 1, 1);
        }
        break;
      }
      case 'arc': {
        var aCount = 5;
        var aRadius = 5.2 + rnd(1) * 0.6;
        for (var ja = 0; ja < aCount; ja += 1) {
          var aa = (-0.5 + ja / (aCount - 1)) * 1.5 * dir;
          add(ja === Math.floor(aCount / 2) ? 'torus' : 'sphere', Math.sin(aa) * aRadius,
            0.3 + Math.cos(aa) * 0.7, 1.0 + rnd(20 + ja) * 1.6, 0.45 + rnd(30 + ja) * 0.32);
        }
        break;
      }
      case 'float': {
        for (var jw = 0; jw < 3; jw += 1) {
          addPair('sphere', 4.1 + jw * 0.85, -1.2 + jw * 1.35, 1.2 + jw * 1.55, 0.42 + rnd(jw * 4) * 0.22, 1, (jw % 2));
        }
        break;
      }
      case 'glide': {
        for (var jg = 0; jg < 3; jg += 1) {
          addPair('box', 4.25 + rnd(jg) * 0.3, -1.5 + jg * 1.7, 1 + jg * 1.7, 0.46 + rnd(jg * 2) * 0.12, 1.85, (jg % 2));
        }
        break;
      }
      case 'hold':
      default: {
        addPair('torus', 5.6, 1.55, 7.2 + rnd(1), 1.05 + rnd(2) * 0.2, 1, 0);
        addPair('sphere', 4.45, -1.1, 2.1 + rnd(4), 0.58 + rnd(5) * 0.16, 1, 1);
        break;
      }
    }

    dioramaEnforceRailClearance(specs);
    dioramaEnforceTextClearance(specs);
    dioramaSeparateSpecs(specs);
    dioramaEnforceRailClearance(specs);
    dioramaEnforceTextClearance(specs);

    return specs.map(function (s, j) {
      return {
        kind: s.kind,
        position: dioramaComposeLocal(frame, placement.offsetR + s.r, placement.offsetU + s.u, s.d),
        scale: s.scale,
        stretchY: s.stretchY,
        upright: s.upright,
        spinSpeed: 0.04 + rnd(j * 13 + 5) * 0.1,
        colorSlot: s.colorSlot === undefined ? (j % 2) : s.colorSlot,
        layer: s.d > 3.5 ? 'far' : 'near'
      };
    });
  }

  /* ---- 跨行云簇碰撞剔除 ---- */
  var DIORAMA_CLUSTER_COLLISION_LINE_SPAN = 2;

  function dioramaIsKindVisible(kind, visibility) {
    if (kind === 'box') return visibility.strands;
    if (kind === 'sphere') return visibility.blobs;
    if (kind === 'cone') return visibility.ribbons;
    return visibility.rings;
  }

  function dioramaGetClusterRadius(shape) {
    var familyRadius = shape.kind === 'box'
      ? 0.5
      : shape.kind === 'sphere'
        ? 0.74
        : shape.kind === 'cone'
          ? 0.68
          : 0.9;
    return shape.scale * Math.max(familyRadius, shape.stretchY * 0.55) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX;
  }

  function dioramaSelectVisibleClusters(shapes, visibility) {
    if (!visibility.enabled || visibility.mode !== 'clouds') return [];
    var candidates = shapes.filter(function (shape) { return dioramaIsKindVisible(shape.kind, visibility); });
    return candidates.filter(function (candidate, index) {
      var candidateRadius = dioramaGetClusterRadius(candidate);
      for (var rivalIndex = index - 1; rivalIndex >= 0; rivalIndex -= 1) {
        var rival = candidates[rivalIndex];
        if (candidate.sourceLine - rival.sourceLine > DIORAMA_CLUSTER_COLLISION_LINE_SPAN) break;
        if (rival.sourceLine === candidate.sourceLine) continue;
        var clearance = Math.max(1.8, (dioramaGetClusterRadius(rival) + candidateRadius) * 1.18);
        if (dioramaVecLen(dioramaVecSub(rival.position, candidate.position)) < clearance) return false;
      }
      return true;
    });
  }

  /* ---- 走廊 sequencer（切歌 = 新一段，永不黑屏） ---- */
  function dioramaCreateSequencerState() {
    return { segments: [], nextGlobalStart: 0 };
  }

  /* 就绪闸门辅助：歌词内容签名（Folia: lyricsSig / committedSig） */
  function dioramaLyricsSignature(lines) {
    var list = lines || [];
    return list.length === 0 ? '' : (list.length + '|' + (list[0] ? list[0].fullText : ''));
  }

  function dioramaCreateGate(ctx) {
    var lines = (ctx && ctx.lines) || [];
    return {
      committedSeed: ctx && ctx.seed != null ? String(ctx.seed) : '',
      committedLines: lines.slice(),
      lyricsSig: dioramaLyricsSignature(lines),
      pendingSeed: null,
      startedAt: 0,
      sawReset: false
    };
  }

  function dioramaActiveSegment(state) {
    return state.segments.length ? state.segments[state.segments.length - 1] : null;
  }

  function dioramaAppendSegment(state, input) {
    var raw = dioramaBuildPath(input.lines.length, input.seed);
    var frames = dioramaTranslateFrames(raw, input.placementOrigin);
    var span = Math.max(input.lines.length, 1);
    var segment = {
      key: String(input.seed) + '#' + input.round,
      seed: input.seed,
      round: input.round,
      lines: input.lines,
      frames: frames,
      globalStart: state.nextGlobalStart,
      span: span,
      placementOrigin: input.placementOrigin,
      linesEpoch: 0
    };
    state.segments.push(segment);
    state.nextGlobalStart += span;
    return segment;
  }

  function dioramaUpdateActiveSegmentLines(state, lines) {
    var seg = state.segments[state.segments.length - 1];
    if (!seg) return;
    var raw = dioramaBuildPath(lines.length, seg.seed);
    var span = Math.max(lines.length, 1);
    state.nextGlobalStart += span - seg.span;
    seg.lines = lines;
    seg.frames = dioramaTranslateFrames(raw, seg.placementOrigin);
    seg.span = span;
    seg.linesEpoch += 1;
  }

  function dioramaTotalGlobalLines(state) {
    return state.nextGlobalStart;
  }

  function dioramaResolveGlobal(state, globalIndex) {
    for (var i = 0; i < state.segments.length; i += 1) {
      var segment = state.segments[i];
      var localIndex = globalIndex - segment.globalStart;
      if (localIndex >= 0 && localIndex < segment.span) {
        return {
          segment: segment,
          localIndex: localIndex,
          frame: dioramaGetFrame(segment.frames, localIndex),
          line: segment.lines[localIndex] || null
        };
      }
    }
    return null;
  }

  function dioramaPruneSegments(state, keepFromGlobal) {
    if (state.segments.length <= 1) return;
    state.segments = state.segments.filter(function (segment) {
      return segment.globalStart + segment.span - 1 >= keepFromGlobal;
    });
  }

  /* ---- 切歌飞行（纯函数） ---- */
  function dioramaFlightPerp(from, to) {
    var perp = { x: to.z - from.z, y: 0, z: -(to.x - from.x) };
    var l = Math.hypot(perp.x, perp.y, perp.z);
    return l < 1e-3 ? { x: 1, y: 0, z: 0 } : { x: perp.x / l, y: perp.y / l, z: perp.z / l };
  }

  function dioramaFlightSide(seed, epoch) {
    return dioramaSeededUnit(dioramaHashSeed(seed) + epoch * 17) < 0.5 ? -1 : 1;
  }

  function dioramaPickTransitionOffset(seed, epoch) {
    var base = dioramaHashSeed(seed) + epoch * 131;
    var azimuth = dioramaSeededUnit(base + 1) * Math.PI * 2;
    var elevation = (dioramaSeededUnit(base + 2) - 0.35) * 1.3;
    var ce = Math.cos(elevation);
    var dir = {
      x: Math.sin(azimuth) * ce,
      y: Math.sin(elevation),
      z: -Math.abs(Math.cos(azimuth) * ce) - 0.35
    };
    return dioramaVecScaleTo(dir, TRANSITION_DISTANCE);
  }

  function dioramaTransitionEase(t) {
    var c = dioramaClamp01(t);
    return c * c * c * (c * (c * 6 - 15) + 10);
  }

  function dioramaBezierControl(from, to, seed, epoch) {
    var mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    var flightLen = dioramaVecLen({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }) || 1;
    var perp = dioramaFlightPerp(from, to);
    var side = dioramaFlightSide(seed, epoch);
    var bow = flightLen * 0.32;
    return {
      x: mid.x + perp.x * bow * side,
      y: mid.y + bow * 0.55,
      z: mid.z + perp.z * bow * side
    };
  }

  function dioramaBezierArc(from, control, to, t) {
    var mt = 1 - t;
    var a = mt * mt;
    var b = 2 * mt * t;
    var c = t * t;
    return {
      x: a * from.x + b * control.x + c * to.x,
      y: a * from.y + b * control.y + c * to.y,
      z: a * from.z + b * control.z + c * to.z
    };
  }

  /* ============================== 4. 尘埃 / 隧道 ============================== */

  function dioramaMoteSlot(line) {
    return ((line % DIORAMA_MOTE_WINDOW_LINES) + DIORAMA_MOTE_WINDOW_LINES) % DIORAMA_MOTE_WINDOW_LINES;
  }

  function dioramaRadicalInverse(index, base) {
    var result = 0;
    var fraction = 1 / base;
    var i = index;
    while (i > 0) {
      result += (i % base) * fraction;
      i = Math.floor(i / base);
      fraction /= base;
    }
    return result;
  }

  function dioramaResolveMoteCircumference(requested) {
    var v = isFinite(requested) ? requested : dioramaTuning().backgroundParticleCircumference;
    return Math.round(Math.min(DIORAMA_MOTE_CIRCUMFERENCE_MAX, Math.max(DIORAMA_MOTE_CIRCUMFERENCE_MIN, v)));
  }

  function dioramaResolveMoteRadial(requested) {
    var v = isFinite(requested) ? requested : dioramaTuning().backgroundParticleRadial;
    return Math.round(Math.min(DIORAMA_MOTE_RADIAL_MAX, Math.max(DIORAMA_MOTE_RADIAL_MIN, v)));
  }

  function dioramaWriteMoteLine(out, frame, line, circumference, radial, seed) {
    var base = dioramaHashSeed(seed);
    var goldenAngle = Math.PI * (3 - Math.sqrt(5));
    var twoPi = Math.PI * 2;
    var phase = dioramaSeededUnit(base + 991) * twoPi;
    var total = circumference * radial;
    var write = dioramaMoteSlot(line) * total * 3;
    var ri, ci, p, s, stratum, radius, angle, depth, point;
    for (ri = 0; ri < radial; ri += 1) {
      for (ci = 0; ci < circumference; ci += 1) {
        p = ri * circumference + ci;
        s = base + line * 131 + p * 17;
        stratum = (ri + 0.35 + dioramaSeededUnit(s + 4) * 0.3) / radial;
        radius = MOTE_INNER_RADIUS + Math.sqrt(stratum) * MOTE_RADIAL_SPAN;
        angle = phase + (line + ri) * goldenAngle
          + (ci / circumference) * twoPi
          + (dioramaSeededUnit(s + 3) - 0.5) * (twoPi / circumference);
        depth = (dioramaRadicalInverse(p + 1, 2) + (dioramaSeededUnit(s + 2) - 0.5) / total - 0.5) * DIORAMA_STEP_DISTANCE;
        point = dioramaComposeLocal(
          frame,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * MOTE_VERTICAL_SQUASH,
          depth
        );
        out[write] = point.x;
        out[write + 1] = point.y;
        out[write + 2] = point.z;
        write += 3;
      }
    }
  }

  function dioramaRecycleMoteWindow(input) {
    var lastLine = Math.max(0, input.total - 1);
    var dirty = false;
    for (var line = input.globalIndex - DIORAMA_MOTE_LINES_BEHIND;
      line <= input.globalIndex + DIORAMA_MOTE_LINES_AHEAD; line += 1) {
      var slot = dioramaMoteSlot(line);
      if (input.written[slot] === line) continue;
      var anchorLine = dioramaClamp(line, 0, lastLine);
      var resolved = dioramaResolveGlobal(input.sequencer, anchorLine);
      if (!resolved) continue;
      dioramaWriteMoteLine(
        input.motePositions,
        dioramaExtendFrame(resolved.frame, line - anchorLine),
        line,
        input.moteCircumference,
        input.moteRadial,
        input.seed
      );
      input.written[slot] = line;
      dirty = true;
    }
    return dirty;
  }

  /* ---- 点阵隧道 ---- */
  function dioramaBuildCorridorSpan(frame, nextFrame, pathStart, enabled) {
    var start = { x: frame.position.x, y: frame.position.y, z: frame.position.z };
    var end = nextFrame != null
      ? { x: nextFrame.position.x, y: nextFrame.position.y, z: nextFrame.position.z }
      : {
        x: start.x + frame.forward.x * DIORAMA_STEP_DISTANCE,
        y: start.y + frame.forward.y * DIORAMA_STEP_DISTANCE,
        z: start.z + frame.forward.z * DIORAMA_STEP_DISTANCE
      };
    return {
      start: start,
      end: end,
      startRight: frame.right,
      endRight: nextFrame ? nextFrame.right : frame.right,
      startUp: frame.up,
      endUp: nextFrame ? nextFrame.up : frame.up,
      pathStart: pathStart,
      enabled: enabled
    };
  }

  function dioramaBuildCorridorWindow(sequencer, center, behind, ahead) {
    var anchor = dioramaResolveGlobal(sequencer, center);
    if (!anchor) return [];
    var segment = anchor.segment;
    var first = segment.globalStart;
    var last = segment.globalStart + segment.span - 1;
    var frameAt = function (index) {
      var clamped = dioramaClamp(index, first, last);
      return dioramaExtendFrame(dioramaGetFrame(segment.frames, clamped - first), index - clamped);
    };
    var spans = [];
    for (var i = center - behind; i <= center + ahead; i += 1) {
      spans.push(dioramaBuildCorridorSpan(frameAt(i), frameAt(i + 1), i, true));
    }
    return spans;
  }

  /* ============================== 5. 点阵表面晶格 ============================== */

  var dioramaSurfaceCache = new Map();
  var TWO_PI = Math.PI * 2;

  function dioramaRadialNormal(p, center) {
    var c = center || [0, 0, 0];
    var x = p[0] - c[0];
    var y = p[1] - c[1];
    var z = p[2] - c[2];
    var length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  }

  function dioramaCountBoxShell(across, tall) {
    return 2 * (across * tall + tall * across + across * across) - 4 * (across + tall + across) + 8;
  }

  function dioramaResolveBoxShell(budget, stretchY) {
    var best = [2, 2];
    for (var across = 2; across <= 96; across += 1) {
      var tall = Math.max(2, Math.round(1 + (across - 1) * stretchY));
      if (dioramaCountBoxShell(across, tall) > budget) break;
      best = [across, tall];
    }
    return best;
  }

  function dioramaBuildBoxSurface(budget, stretchY, out) {
    var shell = dioramaResolveBoxShell(budget, stretchY);
    var across = shell[0];
    var tall = shell[1];
    var axis = function (index, steps) { return (index / (steps - 1) - 0.5) * 2 * BOX_HALF; };
    out.spacing = (2 * BOX_HALF) / Math.max(1, Math.min(across, tall) - 1);
    var iy, iz, ix, interior, p, n;
    for (iy = 0; iy < tall; iy += 1) {
      for (iz = 0; iz < across; iz += 1) {
        for (ix = 0; ix < across; ix += 1) {
          interior = ix > 0 && ix < across - 1 && iy > 0 && iy < tall - 1 && iz > 0 && iz < across - 1;
          if (interior) continue;
          p = [axis(ix, across), axis(iy, tall), axis(iz, across)];
          out.positions.push(p[0], p[1], p[2]);
          n = dioramaRadialNormal(p);
          out.normals.push(n[0], n[1], n[2]);
        }
      }
    }
  }

  function dioramaBuildCylinderSurface(budget, stretchY, out) {
    var aspect = (TWO_PI * CYLINDER_RADIUS) / (2 * CYLINDER_HALF_HEIGHT * Math.max(0.2, stretchY));
    var rows = Math.max(2, Math.round(Math.sqrt(budget / Math.max(0.1, aspect))));
    var columns = Math.max(3, Math.floor(budget / rows));
    out.spacing = Math.max(
      (2 * CYLINDER_HALF_HEIGHT) / (rows - 1),
      (TWO_PI * CYLINDER_RADIUS) / columns
    );
    var row, column, y, angle, cosine, sine;
    for (row = 0; row < rows; row += 1) {
      y = (row / (rows - 1) - 0.5) * 2 * CYLINDER_HALF_HEIGHT;
      for (column = 0; column < columns; column += 1) {
        angle = (column / columns) * TWO_PI;
        cosine = Math.cos(angle);
        sine = Math.sin(angle);
        out.positions.push(cosine * CYLINDER_RADIUS, y, sine * CYLINDER_RADIUS);
        out.normals.push(cosine, 0, sine);
      }
    }
  }

  function dioramaBuildTetrahedronSurface(budget, out) {
    var steps = 1;
    while (TETRA_FACES.length * (((steps + 2) * (steps + 3)) / 2) <= budget) steps += 1;
    out.spacing = Math.hypot(
      TETRA_VERTICES[0][0] - TETRA_VERTICES[1][0],
      TETRA_VERTICES[0][1] - TETRA_VERTICES[1][1],
      TETRA_VERTICES[0][2] - TETRA_VERTICES[1][2]
    ) / steps;
    var face, a, b, c, i, j, wa, wb, wc, p, n;
    for (face = 0; face < TETRA_FACES.length; face += 1) {
      a = TETRA_VERTICES[TETRA_FACES[face][0]];
      b = TETRA_VERTICES[TETRA_FACES[face][1]];
      c = TETRA_VERTICES[TETRA_FACES[face][2]];
      for (i = 0; i <= steps; i += 1) {
        for (j = 0; j <= steps - i; j += 1) {
          wa = i / steps;
          wb = j / steps;
          wc = 1 - wa - wb;
          p = [0, 1, 2].map(function (ax) {
            return a[ax] * wa + b[ax] * wb + c[ax] * wc;
          });
          out.positions.push(p[0], p[1], p[2]);
          n = dioramaRadialNormal(p, TETRA_CENTER);
          out.normals.push(n[0], n[1], n[2]);
        }
      }
    }
  }

  function dioramaBuildTorusSurface(budget, out) {
    var minor = Math.max(4, Math.round(Math.sqrt(budget / 4)));
    var major = Math.max(6, Math.floor(budget / minor));
    out.spacing = Math.max(
      (TWO_PI * (TORUS_MAJOR + TORUS_TUBE)) / major,
      (TWO_PI * TORUS_TUBE) / minor
    );
    var i, j, majorAngle, majorCosine, majorSine, minorAngle, minorCosine, minorSine, radius;
    for (i = 0; i < major; i += 1) {
      majorAngle = (i / major) * TWO_PI;
      majorCosine = Math.cos(majorAngle);
      majorSine = Math.sin(majorAngle);
      for (j = 0; j < minor; j += 1) {
        minorAngle = (j / minor) * TWO_PI;
        minorCosine = Math.cos(minorAngle);
        minorSine = Math.sin(minorAngle);
        radius = TORUS_MAJOR + TORUS_TUBE * minorCosine;
        out.positions.push(radius * majorCosine, TORUS_TUBE * minorSine, radius * majorSine);
        out.normals.push(minorCosine * majorCosine, minorSine, minorCosine * majorSine);
      }
    }
  }

  function dioramaBuildStructuredSurface(kind, budget, stretchY) {
    var stretchKey = Math.round(Math.max(0.2, stretchY === undefined ? 1 : stretchY) * 4) / 4;
    var cacheKey = kind + ':' + budget + ':' + stretchKey;
    var cached = dioramaSurfaceCache.get(cacheKey);
    if (cached) return cached;

    var out = { positions: [], normals: [], spacing: 0 };
    if (kind === 'box') dioramaBuildBoxSurface(budget, stretchKey, out);
    else if (kind === 'sphere') dioramaBuildCylinderSurface(budget, stretchKey, out);
    else if (kind === 'cone') dioramaBuildTetrahedronSurface(budget, out);
    else dioramaBuildTorusSurface(budget, out);

    var positions = Float32Array.from(out.positions);
    var normals = Float32Array.from(out.normals);
    var count = positions.length / 3;
    var total = 0;
    var index;
    for (index = 0; index < count; index += 1) {
      total += Math.hypot(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    }
    var radius = count > 0 ? total / count : 1;
    var surface = {
      positions: positions,
      normals: normals,
      radius: radius,
      count: count,
      spacing: out.spacing / radius
    };
    dioramaSurfaceCache.set(cacheKey, surface);
    return surface;
  }

  /* ============================== 6. 点阵缓冲 ============================== */

  var DIORAMA_FAMILY_INDEX = { box: 0, sphere: 1, cone: 2, torus: 3 };

  function dioramaNormalizeDensity(density) {
    var clamped = Math.min(DIORAMA_PARTICLE_DENSITY_MAX, Math.max(DIORAMA_PARTICLE_DENSITY_MIN, density));
    return Math.max(
      DIORAMA_PARTICLE_DENSITY_MIN,
      Math.floor(clamped / DIORAMA_PARTICLE_DENSITY_STEP) * DIORAMA_PARTICLE_DENSITY_STEP
    );
  }

  function dioramaResolveWaveNumberMax(spacing) {
    return (Math.PI * 2) / Math.max(1e-4, spacing * 4);
  }

  function dioramaAllocateParticleData(pointCount, pointsPerUnit, spacing) {
    return {
      positions: new Float32Array(pointCount * 3),
      normals: new Float32Array(pointCount * 3),
      anchors: new Float32Array(pointCount * 3),
      scales: new Float32Array(pointCount * 3),
      phases: new Float32Array(pointCount),
      styles: new Float32Array(pointCount * 3),
      waves: new Float32Array(pointCount * 2),
      pointCount: pointCount,
      pointsPerUnit: pointsPerUnit,
      spacing: spacing
    };
  }

  function dioramaWriteParticleStyle(data, index, family, colorSlot, isFar) {
    var offset = index * 3;
    data.styles[offset] = family;
    data.styles[offset + 1] = colorSlot;
    data.styles[offset + 2] = isFar;
  }

  function dioramaBuildCloudGeometryData(clusters, density) {
    var budget = dioramaNormalizeDensity(Math.min(density, DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER));
    var surfaces = clusters.map(function (cluster) {
      return dioramaBuildStructuredSurface(cluster.kind, budget, cluster.stretchY);
    });
    var pointCount = surfaces.reduce(function (sum, surface) { return sum + surface.count; }, 0);
    var spacing = surfaces.reduce(function (widest, surface) { return Math.max(widest, surface.spacing); }, 0);
    var data = dioramaAllocateParticleData(pointCount, budget, spacing);

    var target = 0;
    clusters.forEach(function (cluster, clusterIndex) {
      var surface = surfaces[clusterIndex];
      var seed = dioramaHashSeed(cluster.particleSeed + '|' + cluster.kind);
      var clusterPhase = dioramaSeededUnit(seed + 31) * Math.PI * 2;
      var family = DIORAMA_FAMILY_INDEX[cluster.kind];
      var isFar = cluster.layer === 'far' ? 1 : 0;
      for (var pointIndex = 0; pointIndex < surface.count; pointIndex += 1, target += 1) {
        var v = target * 3;
        var s = target * 3;
        var px = surface.positions[pointIndex * 3];
        var py = surface.positions[pointIndex * 3 + 1];
        var pz = surface.positions[pointIndex * 3 + 2];
        data.positions[v] = px;
        data.positions[v + 1] = py;
        data.positions[v + 2] = pz;
        data.normals[v] = surface.normals[pointIndex * 3];
        data.normals[v + 1] = surface.normals[pointIndex * 3 + 1];
        data.normals[v + 2] = surface.normals[pointIndex * 3 + 2];
        data.anchors[v] = cluster.position.x;
        data.anchors[v + 1] = cluster.position.y;
        data.anchors[v + 2] = cluster.position.z;
        data.scales[s] = cluster.scale;
        data.scales[s + 1] = cluster.stretchY;
        data.scales[s + 2] = surface.radius;
        data.phases[target] = clusterPhase;
        data.waves[target * 2] = clusterPhase + (px + pz * 0.6) * 2.2;
        data.waves[target * 2 + 1] = clusterPhase * 0.7 + py * 2.6;
        dioramaWriteParticleStyle(data, target, family, cluster.colorSlot, isFar);
      }
    });
    return data;
  }

  function dioramaResolveRingSegments(pointsPerSpan) {
    return Math.max(12, Math.min(256, Math.round(Math.sqrt(pointsPerSpan * 2.4))));
  }

  function dioramaNormalizeVec3(x, y, z) {
    var length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  }

  function dioramaBuildCorridorGeometryData(spans, density, radius) {
    var rad = radius === undefined ? DIORAMA_PARTICLE_CORRIDOR_RADIUS : radius;
    var activeSpans = spans.filter(function (span) { return span.enabled; });
    var spanCount = activeSpans.length;
    var pointsPerSpan = dioramaNormalizeDensity(Math.min(density, DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN));
    var ringSegments = dioramaResolveRingSegments(pointsPerSpan);
    var rings = Math.max(1, Math.floor(pointsPerSpan / ringSegments));
    var perSpan = ringSegments * rings;
    var pointCount = spanCount * perSpan;
    var spanUnits = DIORAMA_STEP_DISTANCE / rad;
    var spacing = Math.max(spanUnits / Math.max(1, rings), (Math.PI * 2) / ringSegments);
    var data = dioramaAllocateParticleData(pointCount, perSpan, spacing);

    var target = 0;
    activeSpans.forEach(function (span) {
      for (var ring = 0; ring < rings; ring += 1) {
        var t = rings > 1 ? ring / (rings - 1) : 0.5;
        var cx = span.start.x + (span.end.x - span.start.x) * t;
        var cy = span.start.y + (span.end.y - span.start.y) * t;
        var cz = span.start.z + (span.end.z - span.start.z) * t;
        var right = dioramaNormalizeVec3(
          span.startRight.x + (span.endRight.x - span.startRight.x) * t,
          span.startRight.y + (span.endRight.y - span.startRight.y) * t,
          span.startRight.z + (span.endRight.z - span.startRight.z) * t
        );
        var up = dioramaNormalizeVec3(
          span.startUp.x + (span.endUp.x - span.startUp.x) * t,
          span.startUp.y + (span.endUp.y - span.startUp.y) * t,
          span.startUp.z + (span.endUp.z - span.startUp.z) * t
        );
        var longitudinal = span.pathStart + t;
        for (var segment = 0; segment < ringSegments; segment += 1) {
          var angle = (segment / ringSegments) * Math.PI * 2;
          var cos = Math.cos(angle);
          var sin = Math.sin(angle);
          var radial = dioramaNormalizeVec3(
            right.x * cos + up.x * sin,
            right.y * cos + up.y * sin,
            right.z * cos + up.z * sin
          );
          var v = target * 3;
          var s = target * 3;
          data.positions[v] = radial.x * rad;
          data.positions[v + 1] = radial.y * rad;
          data.positions[v + 2] = radial.z * rad;
          data.normals[v] = radial.x;
          data.normals[v + 1] = radial.y;
          data.normals[v + 2] = radial.z;
          data.anchors[v] = cx;
          data.anchors[v + 1] = cy;
          data.anchors[v + 2] = cz;
          data.scales[s] = 1;
          data.scales[s + 1] = 1;
          data.scales[s + 2] = rad;
          data.phases[target] = longitudinal * 1.7;
          data.waves[target * 2] = longitudinal * spanUnits;
          data.waves[target * 2 + 1] = angle;
          dioramaWriteParticleStyle(data, target, 3, (Math.round(span.pathStart) + ring) % 2, 0);
          target += 1;
        }
      }
    });
    return data;
  }

  function dioramaCreateParticleBufferGeometry(data) {
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('aAnchor', new THREE.BufferAttribute(data.anchors, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(data.scales, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1));
    geometry.setAttribute('aStyle', new THREE.BufferAttribute(data.styles, 3));
    geometry.setAttribute('aWave', new THREE.BufferAttribute(data.waves, 2));
    geometry.setDrawRange(0, data.pointCount);
    return geometry;
  }

  /* ============================== 7. 音频瞬态 ============================== */

  function dioramaStepBandEnvelope(current, target, attack, release, delta) {
    return current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta));
  }

  function dioramaCreateBandTracker() {
    return { fast: 0, floor: 0, peak: 0, armed: false, primed: false };
  }

  function dioramaStepBandTracker(state, level, delta) {
    var safe = dioramaClamp01(level);
    if (!state.primed) {
      state.fast = safe;
      state.floor = safe;
      state.peak = safe;
      state.primed = true;
    } else {
      state.fast = dioramaStepBandEnvelope(state.fast, safe, FAST_ATTACK, FAST_RELEASE, delta);
      state.floor = dioramaStepBandEnvelope(state.floor, safe, FLOOR_RISE, FLOOR_FALL, delta);
      state.peak = dioramaStepBandEnvelope(state.peak, safe, PEAK_RISE, PEAK_FALL, delta);
    }
    var range = Math.max(MIN_RANGE, state.peak - state.floor);
    var transient = dioramaClamp01((state.fast - state.floor) / range);
    var sustained = dioramaClamp01(state.fast / Math.max(MIN_PEAK, state.peak));
    var onset = false;
    if (!state.armed && transient >= TRIGGER_HIGH) {
      state.armed = true;
      onset = true;
    } else if (state.armed && transient <= TRIGGER_LOW) {
      state.armed = false;
    }
    return { transient: transient, sustained: sustained, onset: onset };
  }

  function dioramaResolveParticleAudioResponse(bass, mid) {
    return {
      flowSpeed: Math.min(1.55, 0.3 + dioramaClamp01(bass.sustained) * 1.25),
      clusterPulse: Math.min(
        DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
        1 + dioramaSmoothstep(0.1, 0.9, bass.transient) * 0.14 + dioramaSmoothstep(0.15, 0.95, mid.transient) * 0.05
      )
    };
  }

  function dioramaResolvePulseTarget(clusterPulse, gain, isCorridor) {
    return 1 + (clusterPulse - 1) * gain * (isCorridor ? DIORAMA_CORRIDOR_PULSE_SHARE : 1);
  }

  function dioramaCreateElasticState() {
    return { value: 1, velocity: 0 };
  }

  function dioramaStepElasticResponse(state, target, delta) {
    var remaining = Math.min(0.1, Math.max(0, delta));
    var safeTarget = Math.min(DIORAMA_PARTICLE_AUDIO_SCALE_MAX, Math.max(0.9, target));
    while (remaining > 0) {
      var step = Math.min(1 / 240, remaining);
      var acceleration = (safeTarget - state.value) * 150 - state.velocity * 15;
      state.velocity += acceleration * step;
      state.value += state.velocity * step;
      remaining -= step;
    }
    state.value = Math.min(DIORAMA_PARTICLE_AUDIO_SCALE_MAX, Math.max(0.9, state.value));
    return state.value;
  }

  function dioramaCreateRipplePool() {
    return {
      sources: new Float32Array(DIORAMA_RIPPLE_COUNT * 4),
      shapes: new Float32Array(DIORAMA_RIPPLE_COUNT * 4),
      cursor: DIORAMA_RIPPLE_BANDS.map(function () { return 0; }),
      spawned: 0
    };
  }

  function dioramaSpawnRipple(pool, bandIndex, strength, now, corridor, readHeadAlong) {
    var seed = dioramaHashSeed('diorama-ripple:' + pool.spawned);
    var preset = DIORAMA_RIPPLE_BANDS[bandIndex];
    var height = dioramaSeededUnit(seed + 1);
    var spread = dioramaSeededUnit(seed + 2);
    var pace = dioramaSeededUnit(seed + 3);
    var cursor = pool.cursor[bandIndex];
    var offset = (bandIndex * RIPPLE_SLOTS_PER_BAND + cursor) * 4;

    if (corridor) {
      pool.sources[offset] = readHeadAlong + 0.4 + dioramaSeededUnit(seed + 4) * 2.2;
      pool.sources[offset + 1] = dioramaSeededUnit(seed + 5) * Math.PI * 2;
      pool.sources[offset + 2] = 0;
    } else {
      var up = dioramaSeededUnit(seed + 4) * 2 - 1;
      var around = dioramaSeededUnit(seed + 5) * Math.PI * 2;
      var ring = Math.sqrt(Math.max(0, 1 - up * up));
      pool.sources[offset] = ring * Math.cos(around);
      pool.sources[offset + 1] = up;
      pool.sources[offset + 2] = ring * Math.sin(around);
    }
    pool.sources[offset + 3] = now;
    pool.shapes[offset] = preset.strength * strength * (0.7 + height * 0.6);
    pool.shapes[offset + 1] = preset.speed * (0.8 + pace * 0.45);
    pool.shapes[offset + 2] = preset.width * (0.78 + spread * 0.5);
    pool.shapes[offset + 3] = preset.wavenumber;

    pool.cursor[bandIndex] = (cursor + 1) % RIPPLE_SLOTS_PER_BAND;
    pool.spawned += 1;
  }

  /* ============================== 8. 着色器 ============================== */

  var DIORAMA_PARTICLE_VERTEX_SHADER = [
    '#define RIPPLE_COUNT ' + DIORAMA_RIPPLE_COUNT,
    '',
    'attribute vec3 aNormal;',
    'attribute vec3 aAnchor;',
    'attribute vec3 aScale;',
    'attribute float aPhase;',
    'attribute vec3 aStyle;',
    'attribute vec2 aWave;',
    '',
    'uniform float uTime;',
    'uniform float uCorridor;',
    'uniform float uAmplitude;',
    'uniform float uMaxSwell;',
    'uniform float uWaveNumberMax;',
    'uniform float uDetail;',
    'uniform vec4 uRippleSource[RIPPLE_COUNT];',
    'uniform vec4 uRippleShape[RIPPLE_COUNT];',
    'uniform float uOffsetGain;',
    'uniform float uFlow;',
    'uniform float uFormation;',
    'uniform float uScatter;',
    'uniform float uPulse;',
    'uniform float uSpectralCentroid;',
    'uniform float uViewportHeight;',
    'uniform float uSizeBase;',
    'uniform float uSizeGain;',
    'uniform float uGlow;',
    'uniform float uGlowPass;',
    'uniform vec3 uPrimaryColor;',
    'uniform vec3 uAccentColor;',
    'uniform vec3 uSecondaryColor;',
    '',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying float vReaction;',
    '',
    'float hermite(float value) { return value * value * (3.0 - 2.0 * value); }',
    'float hash11(float n) { return fract(sin(n) * 43758.5453123); }',
    '',
    'float resolveLife(float distanceToCamera) {',
    '  float farT = clamp((' + DIORAMA_SHAPE_FADE_IN_END.toFixed(1) + ' - distanceToCamera) / '
    + (DIORAMA_SHAPE_FADE_IN_END - DIORAMA_SHAPE_FADE_IN_START).toFixed(1) + ', 0.0, 1.0);',
    '  float nearT = clamp((distanceToCamera - ' + DIORAMA_SHAPE_DISSOLVE_END.toFixed(1) + ') / '
    + (DIORAMA_SHAPE_DISSOLVE_START - DIORAMA_SHAPE_DISSOLVE_END).toFixed(1) + ', 0.0, 1.0);',
    '  return hermite(farT) * hermite(nearT);',
    '}',
    '',
    'float ripplePacket(float r, float age, vec4 shape) {',
    '  float dr = r - age * shape.y;',
    '  float k = min(shape.w, uWaveNumberMax);',
    '  float packet = exp(-(dr * dr) / (shape.z * shape.z)) * sin(dr * k);',
    '  return shape.x * packet * exp(-age * 1.15) * exp(-r * 0.35);',
    '}',
    '',
    'float cloudRipples(vec3 unitPos, float phase) {',
    '  float spin = cos(phase);',
    '  float spun = sin(phase);',
    '  float total = 0.0;',
    '  for (int i = 0; i < RIPPLE_COUNT; i += 1) {',
    '    vec4 source = uRippleSource[i];',
    '    vec4 shape = uRippleShape[i];',
    '    float age = uTime - source.w;',
    '    if (shape.x <= 0.0 || age < 0.0) continue;',
    '    vec3 origin = vec3(',
    '      source.x * spin - source.z * spun,',
    '      source.y,',
    '      source.x * spun + source.z * spin',
    '    );',
    '    total += ripplePacket(distance(unitPos, origin), age, shape);',
    '  }',
    '  return total;',
    '}',
    '',
    'vec2 corridorSurfaceDelta(vec2 w, vec2 origin) {',
    '  float dAngle = w.y - origin.y;',
    '  return vec2(w.x - origin.x, atan(sin(dAngle), cos(dAngle)));',
    '}',
    '',
    'float corridorRipples(vec2 w) {',
    '  float total = 0.0;',
    '  for (int i = 0; i < RIPPLE_COUNT; i += 1) {',
    '    vec4 source = uRippleSource[i];',
    '    vec4 shape = uRippleShape[i];',
    '    float age = uTime - source.w;',
    '    if (shape.x <= 0.0 || age < 0.0) continue;',
    '    total += ripplePacket(length(corridorSurfaceDelta(w, source.xy)), age, shape);',
    '  }',
    '  return total;',
    '}',
    '',
    'float cloudIdle(vec3 unitPos) {',
    '  return 0.11 * sin(unitPos.x * 1.7 + uTime * 0.5) * cos(unitPos.z * 1.4 - uTime * 0.37)',
    '       + 0.06 * sin(unitPos.y * 2.1 - uTime * 0.66);',
    '}',
    '',
    'float corridorIdle(vec2 w) {',
    '  float t = uTime * uFlow;',
    '  float region = 0.6 + 0.4 * sin(w.x * 0.42 - t * 0.33);',
    '  float ripple = 0.62 * sin(w.x * 1.25 - t * 1.15)',
    '               + 0.30 * sin(w.x * 0.8 + w.y * 2.0 - t * 0.8)',
    '               + 0.08 * sin(w.y * 3.0 + t * 0.5);',
    '  return region * ripple;',
    '}',
    '',
    'float cloudDetail(vec3 p) {',
    '  float k = uWaveNumberMax * 0.7;',
    '  return sin(p.x * k + uTime * 3.1)',
    '       * sin(p.y * k - uTime * 2.6)',
    '       * sin(p.z * k + uTime * 2.2);',
    '}',
    '',
    'float corridorDetail(vec2 w) {',
    '  float k = uWaveNumberMax * 0.7;',
    '  float n = max(1.0, floor(k));',
    '  return sin(w.x * k + uTime * 3.1) * sin(w.y * n - uTime * 2.4);',
    '}',
    '',
    'void main() {',
    '  float colorSlot = aStyle.y;',
    '  float isFar = aStyle.z;',
    '  vec3 normalDir = normalize(aNormal);',
    '  float localRadius = aScale.z;',
    '',
    '  vec3 basePos = position;',
    '  basePos.y *= aScale.y;',
    '',
    '  vec3 unitPos = position / localRadius;',
    '  bool corridor = uCorridor > 0.5;',
    '  float audio = corridor ? corridorRipples(aWave) : cloudRipples(unitPos, aPhase);',
    '  float idle = corridor ? corridorIdle(aWave) : cloudIdle(unitPos);',
    '',
    '  float detail = uDetail * smoothstep(0.06, 0.45, abs(audio));',
    '  audio += (corridor ? corridorDetail(aWave) : cloudDetail(unitPos)) * detail * 0.3;',
    '',
    '  float swell = clamp(audio + idle, -1.6, 1.6) * uAmplitude;',
    '  vec3 displaced = basePos + normalDir * (swell * localRadius);',
    '  float d = clamp(abs(clamp(audio, -1.6, 1.6) * uAmplitude) / max(uMaxSwell, 0.0001), 0.0, 1.0);',
    '',
    '  displaced.z += sin(uTime * 0.6 + aPhase) * 0.12 * uOffsetGain * localRadius;',
    '',
    '  float scatter = 1.0 - uFormation;',
    '  if (scatter > 0.001) {',
    '    float r1 = hash11(aPhase * 12.9898 + aWave.x * 78.233);',
    '    float r2 = hash11(aPhase * 39.346 + aWave.y * 11.135 + 3.7);',
    '    float r3 = hash11(r1 * 91.7 + r2 * 47.3);',
    '    vec3 spread = normalize(normalDir * 0.75 + vec3(r1 - 0.5, r2 - 0.5, r3 - 0.5) * 1.6);',
    '    displaced += spread * (scatter * scatter * uScatter * (0.55 + r3 * 0.9));',
    '  }',
    '',
    '  displaced *= aScale.x * uPulse;',
    '  vec3 worldPosition = aAnchor + displaced;',
    '',
    '  float life = resolveLife(distance(worldPosition, cameraPosition));',
    '  vec4 mvPosition = viewMatrix * vec4(worldPosition, 1.0);',
    '',
    '  float glowScale = mix(1.0, 1.9 + uGlow * 1.3, uGlowPass);',
    '  float sizeWorld = (uSizeBase + (pow(d, 3.0) + detail * 0.35) * uSizeGain) * glowScale;',
    '  float projected = sizeWorld * uViewportHeight * projectionMatrix[1][1] * 0.5 / max(-mvPosition.z, 0.1);',
    '  gl_PointSize = clamp(projected, mix(1.4, 2.0, uGlowPass), mix(26.0, 64.0, uGlowPass));',
    '  gl_Position = projectionMatrix * mvPosition;',
    '',
    '  float gradientPhase = (',
    '    dot(basePos, vec3(0.2, 0.16, 0.13))',
    '    + aPhase * 0.05',
    '    + colorSlot * 0.5',
    '    + uTime * 0.02',
    '    + uSpectralCentroid * 0.3',
    '  ) * 6.283;',
    '  vec3 wgt = max(vec3(0.0), 0.5 + 0.5 * cos(gradientPhase - vec3(0.0, 2.094, 4.188)));',
    '  wgt *= wgt; wgt /= max(wgt.x + wgt.y + wgt.z, 0.001);',
    '  vec3 baseColor = uPrimaryColor * wgt.x + uAccentColor * wgt.y + uSecondaryColor * wgt.z;',
    '  vec3 hotColor = mix(uAccentColor, uSecondaryColor, smoothstep(0.2, 0.9, uSpectralCentroid));',
    '  float hot = min(1.0, smoothstep(0.1, 0.75, d) * 0.75 + detail * 0.3);',
    '  vColor = mix(baseColor, hotColor, hot) * (0.92 + d * 0.5);',
    '',
    '  float layerBase = mix(0.72, 0.5, isFar);',
    '  float formed = smoothstep(0.0, 0.45, uFormation);',
    '  vAlpha = formed * (uGlowPass > 0.5',
    '    ? life * smoothstep(0.1, 0.8, d) * 1.15',
    '    : life * min(1.0, layerBase + d * 0.28));',
    '  vReaction = d;',
    '}'
  ].join('\n');

  var DIORAMA_PARTICLE_FRAGMENT_SHADER = [
    'uniform float uGlow;',
    'uniform float uGlowPass;',
    '',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying float vReaction;',
    '',
    'vec3 dioramaLinearToSRGB(vec3 linear) {',
    '  vec3 safe = max(linear, vec3(0.0));',
    '  return mix(',
    '    pow(safe, vec3(0.41666)) * 1.055 - vec3(0.055),',
    '    safe * 12.92,',
    '    vec3(lessThanEqual(safe, vec3(0.0031308)))',
    '  );',
    '}',
    '',
    'void main() {',
    '  vec2 point = gl_PointCoord - vec2(0.5);',
    '  float radius = length(point);',
    '',
    '  if (uGlowPass > 0.5) {',
    '    float halo = pow(clamp(1.0 - radius * 2.0, 0.0, 1.0), 1.7);',
    '    float alpha = min(0.5, halo * vAlpha * uGlow * 0.4);',
    '    if (alpha < 0.003) discard;',
    '    gl_FragColor = vec4(dioramaLinearToSRGB(vColor * (1.0 + uGlow * 0.25)), alpha);',
    '    return;',
    '  }',
    '',
    '  float core = 1.0 - smoothstep(0.14, 0.48, radius);',
    '  float alpha = core * vAlpha;',
    '  if (alpha < 0.01) discard;',
    '  float emission = 0.95 + vReaction * 0.22;',
    '  gl_FragColor = vec4(dioramaLinearToSRGB(vColor * emission), alpha);',
    '}'
  ].join('\n');

  /* ---- 点阵材质（对比层 + 辉光层，共用一个着色器） ---- */
  var CALM_EMISSION = 0.92 * 0.95;
  var CONTRAST_LAYER_ALPHA = 0.72;

  function dioramaAsDisplayed(color, background) {
    var src = color.clone().multiplyScalar(CALM_EMISSION);
    dioramaColorLinearToSrgb(src);
    var dst = background.clone();
    dioramaColorLinearToSrgb(dst);
    var blend = function (s, d) { return s * CONTRAST_LAYER_ALPHA + d * (1 - CONTRAST_LAYER_ALPHA); };
    var out = new THREE.Color(blend(src.r, dst.r), blend(src.g, dst.g), blend(src.b, dst.b));
    dioramaColorSrgbToLinear(out);
    return out;
  }

  function dioramaDisplayedContrastRatio(color, background) {
    return dioramaContrastRatio(dioramaAsDisplayed(color, background), background);
  }

  function dioramaAdaptColorToBackground(color, background, minimumContrast) {
    if (dioramaDisplayedContrastRatio(color, background) >= minimumContrast) return color.clone();
    var lightTarget = dioramaColorFromCss('#ffffff');
    var darkTarget = dioramaColorFromCss('#050505');
    var target = dioramaDisplayedContrastRatio(lightTarget, background)
      >= dioramaDisplayedContrastRatio(darkTarget, background) ? lightTarget : darkTarget;
    var low = 0;
    var high = 1;
    for (var iteration = 0; iteration < 10; iteration += 1) {
      var amount = (low + high) * 0.5;
      var candidate = color.clone().lerp(target, amount);
      if (dioramaDisplayedContrastRatio(candidate, background) >= minimumContrast) high = amount;
      else low = amount;
    }
    return color.clone().lerp(target, high);
  }

  function dioramaResolveParticleContrastColors(colors, background) {
    return {
      primary: dioramaAdaptColorToBackground(colors.primary, background, 4.6),
      accent: dioramaAdaptColorToBackground(colors.accent, background, 4.1),
      secondary: dioramaAdaptColorToBackground(colors.secondary, background, 4.6)
    };
  }

  function dioramaBuildParticleUniforms(colors, glowPass, glowIntensity) {
    return {
      uTime: { value: 0 },
      uCorridor: { value: 0 },
      uAmplitude: { value: 0.34 },
      uMaxSwell: { value: 0.29 },
      uWaveNumberMax: { value: 8 },
      uDetail: { value: 0 },
      uRippleSource: { value: new Float32Array(DIORAMA_RIPPLE_COUNT * 4) },
      uRippleShape: { value: new Float32Array(DIORAMA_RIPPLE_COUNT * 4) },
      uOffsetGain: { value: 0 },
      uFlow: { value: 1 },
      uFormation: { value: 1 },
      uScatter: { value: 4 },
      uSizeBase: { value: 0.052 },
      uSizeGain: { value: 0.3 },
      uPulse: { value: 1 },
      uSpectralCentroid: { value: 0.5 },
      uViewportHeight: { value: 1 },
      uGlow: { value: glowIntensity },
      uGlowPass: { value: glowPass },
      uPrimaryColor: { value: colors.primary.clone() },
      uAccentColor: { value: colors.accent.clone() },
      uSecondaryColor: { value: colors.secondary.clone() }
    };
  }

  function dioramaCreateParticleMaterial(colors) {
    return new THREE.ShaderMaterial({
      vertexShader: DIORAMA_PARTICLE_VERTEX_SHADER,
      fragmentShader: DIORAMA_PARTICLE_FRAGMENT_SHADER,
      uniforms: dioramaBuildParticleUniforms(colors, 0, 0),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false
    });
  }

  function dioramaCreateParticleGlowMaterial(colors, glowIntensity) {
    return new THREE.ShaderMaterial({
      vertexShader: DIORAMA_PARTICLE_VERTEX_SHADER,
      fragmentShader: DIORAMA_PARTICLE_FRAGMENT_SHADER,
      uniforms: dioramaBuildParticleUniforms(colors, 1, glowIntensity),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
  }

  function dioramaLerpParticleMaterialColors(material, colors, amount) {
    material.uniforms.uPrimaryColor.value.lerp(colors.primary, amount);
    material.uniforms.uAccentColor.value.lerp(colors.accent, amount);
    material.uniforms.uSecondaryColor.value.lerp(colors.secondary, amount);
  }

  /* ============================== 9. 文字栅格 ============================== */

  var dioramaMeasureCanvas = null;
  var dioramaMeasureCtx = null;

  function dioramaGetMeasureCtx() {
    if (!dioramaMeasureCtx) {
      dioramaMeasureCanvas = document.createElement('canvas');
      dioramaMeasureCanvas.width = 1;
      dioramaMeasureCanvas.height = 1;
      dioramaMeasureCtx = dioramaMeasureCanvas.getContext('2d');
    }
    return dioramaMeasureCtx;
  }

  function dioramaBuildFontSpec(fontStack, fontWeight) {
    return (fontWeight === undefined ? DIORAMA_DEFAULT_FONT_WEIGHT : fontWeight) + ' '
      + DIORAMA_RASTER_FONT_PX + 'px ' + fontStack;
  }

  function dioramaMeasureText(text, fontSpec) {
    var ctx = dioramaGetMeasureCtx();
    if (!ctx) return 0;
    ctx.font = fontSpec;
    return ctx.measureText(text).width;
  }

  function dioramaMakeTexture(canvas) {
    var texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  /* 纯光晕 Glyph（心象的模糊阶梯：紧核 / 中环 / 外空气），全强度烘进纹理。 */
  var DIORAMA_GLOW_OFFSCREEN = 10000;

  function dioramaDrawGlowGlyph(ctx, text, x, y, blur) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    var haloPass = function (passBlur, alpha) {
      ctx.shadowColor = 'rgba(255,255,255,' + alpha + ')';
      ctx.shadowBlur = passBlur;
      ctx.shadowOffsetX = DIORAMA_GLOW_OFFSCREEN;
      ctx.shadowOffsetY = 0;
      ctx.fillText(text, x - DIORAMA_GLOW_OFFSCREEN, y);
    };
    haloPass(blur, 0.95);
    haloPass(blur, 0.85);
    haloPass(blur * 2, 0.55);
    haloPass(blur * 2.9, 0.3);
    ctx.restore();
  }

  /* 一个单元（字 / 词）栅格化两遍：字身 + 辉光，同一画布几何 → 严格重合。 */
  function dioramaRasterUnit(text, fontSpec) {
    var em = DIORAMA_RASTER_FONT_PX;
    var pad = Math.ceil(em * GLOW_PAD_EM);
    var advancePx = Math.max(1, Math.ceil(dioramaMeasureText(text, fontSpec)));
    var canvasWidthPx = advancePx + pad * 2;
    var canvasHeightPx = Math.ceil(em * LINE_BAND_EM) + pad * 2;
    var drawX = pad;
    var drawY = canvasHeightPx / 2;

    var draw = function (paint) {
      var canvas = document.createElement('canvas');
      canvas.width = canvasWidthPx;
      canvas.height = canvasHeightPx;
      var ctx = canvas.getContext('2d');
      ctx.font = fontSpec;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      paint(ctx);
      return dioramaMakeTexture(canvas);
    };

    var baseTexture = draw(function (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, drawX, drawY);
    });
    var glowTexture = draw(function (ctx) {
      dioramaDrawGlowGlyph(ctx, text, drawX, drawY, em * GLOW_BLUR_EM);
    });

    return {
      baseTexture: baseTexture,
      glowTexture: glowTexture,
      canvasWidthPx: canvasWidthPx,
      canvasHeightPx: canvasHeightPx,
      advancePx: advancePx
    };
  }

  /* 邻行整行栅格（无辉光、小 padding；超长行先缩字号再画）。 */
  function dioramaRasterLine(text, fontStack, fontWeight) {
    var fontPx = DIORAMA_RASTER_FONT_PX;
    var fontSpec = dioramaBuildFontSpec(fontStack, fontWeight);
    var advancePx = Math.max(1, Math.ceil(dioramaMeasureText(text, fontSpec)));
    var pad = Math.ceil(fontPx * PLAIN_PAD_EM);
    if (advancePx + pad * 2 > MAX_CANVAS_PX) {
      var shrink = (MAX_CANVAS_PX - pad * 2) / advancePx;
      fontPx = Math.max(24, Math.floor(fontPx * shrink));
      fontSpec = (fontWeight === undefined ? DIORAMA_DEFAULT_FONT_WEIGHT : fontWeight) + ' ' + fontPx + 'px ' + fontStack;
      advancePx = Math.max(1, Math.ceil(dioramaMeasureText(text, fontSpec)));
    }
    var canvasWidthPx = advancePx + pad * 2;
    var canvasHeightPx = Math.ceil(fontPx * LINE_BAND_EM) + pad * 2;

    var canvas = document.createElement('canvas');
    canvas.width = canvasWidthPx;
    canvas.height = canvasHeightPx;
    var ctx = canvas.getContext('2d');
    ctx.font = fontSpec;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, pad, canvasHeightPx / 2);

    return {
      texture: dioramaMakeTexture(canvas),
      canvasWidthPx: canvasWidthPx,
      canvasHeightPx: canvasHeightPx,
      advancePx: advancePx,
      fontPx: fontPx
    };
  }

  /* ============================== 10. 字素时间轴 ============================== */

  /* 本项目 lines 没有 renderHints → 回落 endTime（Folia getLineRenderEndTime 的 fallback）。 */
  function dioramaLineRenderEndTime(line) {
    if (!line) return Number.NEGATIVE_INFINITY;
    return line.endTime;
  }

  function dioramaFindGraphemeSequence(source, target, fromIndex) {
    if (target.length === 0) return fromIndex;
    for (var index = fromIndex; index <= source.length - target.length; index += 1) {
      var matched = true;
      for (var targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
        if (source[index + targetIndex] !== target[targetIndex]) {
          matched = false;
          break;
        }
      }
      if (matched) return index;
    }
    return -1;
  }

  /* Folia graphemeTiming.buildLineGraphemeTimeline：词级时序映射回整行。 */
  function dioramaBuildLineTimeline(line) {
    var lineGraphemes = foliaSplitGraphemes(line ? line.fullText : '');
    if (lineGraphemes.length === 0) return [];
    if (!line.words || line.words.length === 0) {
      return foliaBuildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }
    var timeline = new Array(lineGraphemes.length);
    var cursor = 0;
    line.words.forEach(function (word, wordIndex) {
      var wordGraphemes = foliaSplitGraphemes(word.text);
      if (wordGraphemes.length === 0) return;
      var matchedStart = dioramaFindGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);
      var gap;
      for (gap = cursor; gap < start; gap += 1) {
        timeline[gap] = { char: lineGraphemes[gap], startTime: word.startTime, endTime: word.startTime };
      }
      var wordTimings = foliaBuildWordGraphemeTimings(word);
      for (var local = 0; local < end - start; local += 1) {
        var timing = wordTimings[local]
          || foliaBuildEvenGraphemeTimings(wordGraphemes[local] || '', word.startTime, word.endTime)[0];
        timeline[start + local] = {
          char: lineGraphemes[start + local],
          startTime: timing.startTime,
          endTime: timing.endTime,
          wordIndex: wordIndex
        };
      }
      cursor = end;
    });
    for (var i = cursor; i < lineGraphemes.length; i += 1) {
      if (!timeline[i]) {
        timeline[i] = { char: lineGraphemes[i], startTime: line.endTime, endTime: line.endTime };
      }
    }
    return timeline;
  }

  /* 与画面高亮同一套读数（行内插值，连续）。 */
  function dioramaResolveWordProgress(line, timeline, now) {
    if (!line || timeline.length === 0) return 0;
    var renderEndTime = dioramaLineRenderEndTime(line);
    if (now >= renderEndTime) return 1;
    if (now <= line.startTime) return 0;
    var revealed = 0;
    for (var i = 0; i < timeline.length; i += 1) {
      var timing = timeline[i];
      if (now >= timing.endTime) {
        revealed = i + 1;
      } else if (now >= timing.startTime) {
        var span = Math.max(timing.endTime - timing.startTime, 0.001);
        revealed = i + dioramaClamp01((now - timing.startTime) / span);
        break;
      } else {
        break;
      }
    }
    return revealed / timeline.length;
  }

  /* 拆单元：CJK 每字一个，非 CJK 同词一串；空白永远不是单元。 */
  function dioramaSplitLyricUnits(activeLine, timeline) {
    if (!activeLine || timeline.length === 0) return [];
    var graphemes = foliaSplitGraphemes(activeLine.fullText);
    var charOffsets = [];
    var acc = 0;
    var g;
    for (g = 0; g < graphemes.length; g += 1) {
      charOffsets.push(acc);
      acc += graphemes[g].length;
    }
    var units = [];
    var pushUnit = function (from, to) {
      var text = graphemes.slice(from, to).join('');
      if (text.trim().length === 0) return;
      units.push({
        text: text,
        charStart: charOffsets[from] !== undefined ? charOffsets[from] : 0,
        charEnd: (charOffsets[to - 1] !== undefined ? charOffsets[to - 1] : 0)
          + (graphemes[to - 1] !== undefined ? graphemes[to - 1].length : 1),
        startTime: timeline[from].startTime,
        endTime: timeline[to - 1].endTime
      });
    };
    var i = 0;
    while (i < timeline.length) {
      var grapheme = graphemes[i] || '';
      if (grapheme.trim().length === 0) { i += 1; continue; }
      if (CJK_GRAPHEME_RE.test(grapheme)) {
        pushUnit(i, i + 1);
        i += 1;
        continue;
      }
      var wordIndex = timeline[i].wordIndex;
      var j = i + 1;
      while (
        j < timeline.length
        && timeline[j].wordIndex === wordIndex
        && (graphemes[j] || '').trim().length > 0
        && !CJK_GRAPHEME_RE.test(graphemes[j] || '')
      ) {
        j += 1;
      }
      pushUnit(i, j);
      i = j;
    }
    return units;
  }

  /* 当前行按整行测量排布（保留字距），每个单元栅格化。 */
  function dioramaLayoutActiveUnits(activeLine, units, fontSpec) {
    if (!activeLine || !activeLine.fullText || units.length === 0) return null;
    var worldPerPx = LINE_FONT_SIZE / DIORAMA_RASTER_FONT_PX;
    var full = activeLine.fullText;
    var totalPx = dioramaMeasureText(full, fontSpec);
    var placed = units.map(function (unit) {
      var prefixPx = dioramaMeasureText(full.slice(0, unit.charStart), fontSpec);
      var raster = dioramaRasterUnit(full.slice(unit.charStart, unit.charEnd), fontSpec);
      return {
        raster: raster,
        centerX: (-totalPx / 2 + prefixPx + raster.advancePx / 2) * worldPerPx,
        width: raster.canvasWidthPx * worldPerPx,
        height: raster.canvasHeightPx * worldPerPx
      };
    });
    return { units: placed, lineWidth: totalPx * worldPerPx };
  }

  /* ============================== 11. 场景结构推导 ============================== */

  function dioramaResolveMountedIndices(globalIndex, transitionOutgoingIndex, total) {
    var indices = {};
    var addWindow = function (center, behind, ahead) {
      var start = Math.max(center - behind, 0);
      var end = Math.min(center + ahead, total - 1);
      for (var i = start; i <= end; i += 1) indices[i] = true;
    };
    addWindow(globalIndex, LINES_BEHIND, LINES_AHEAD);
    if (transitionOutgoingIndex != null) {
      addWindow(transitionOutgoingIndex, OUTGOING_LINES_BEHIND, OUTGOING_LINES_AHEAD);
    }
    return Object.keys(indices).map(Number).sort(function (a, b) { return a - b; });
  }

  function dioramaBuildVisibleLines(sequencer, mountedIndices, globalIndex, transitionOutgoingIndex, weaveScale) {
    var result = [];
    mountedIndices.forEach(function (i) {
      var resolved = dioramaResolveGlobal(sequencer, i);
      if (!resolved || !resolved.line) return;
      var frame = resolved.frame;
      var placement = dioramaTextPlacement(resolved.localIndex, resolved.segment.seed, weaveScale);
      var position = {
        x: frame.position.x + frame.right.x * placement.offsetR + frame.up.x * placement.offsetU,
        y: frame.position.y + frame.right.y * placement.offsetR + frame.up.y * placement.offsetU,
        z: frame.position.z + frame.right.z * placement.offsetR + frame.up.z * placement.offsetU
      };
      result.push({
        index: i,
        line: resolved.line,
        placement: placement,
        position: [position.x, position.y, position.z],
        quaternion: dioramaFrameQuaternion(frame, placement.roll, placement.yaw),
        isOutgoing: transitionOutgoingIndex != null
          && Math.abs(i - transitionOutgoingIndex) <= Math.abs(i - globalIndex)
      });
    });
    return result;
  }

  function dioramaBuildCorridorSpans(sequencer, globalIndex, transitionOutgoingIndex, geometryVisibility, geometryMode) {
    if (!geometryVisibility.enabled || geometryMode !== 'corridor') return [];
    var live = dioramaBuildCorridorWindow(sequencer, globalIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD);
    if (transitionOutgoingIndex == null) return live;
    return [].concat(
      dioramaBuildCorridorWindow(sequencer, transitionOutgoingIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD),
      live
    );
  }

  function dioramaBuildParticleClusters(sequencer, mountedIndices, geometryMode, motion, geometryVisibility, particleScale) {
    if (geometryMode !== 'clouds') return [];
    var result = [];
    var mounted = {};
    mountedIndices.forEach(function (i) { mounted[i] = true; });
    var clusterIndices = {};
    mountedIndices.forEach(function (i) {
      for (var back = 0; back <= DIORAMA_CLUSTER_COLLISION_LINE_SPAN; back += 1) {
        if (i - back >= 0) clusterIndices[i - back] = true;
      }
    });
    var ordered = Object.keys(clusterIndices).map(Number).sort(function (a, b) { return a - b; });
    ordered.forEach(function (i) {
      var resolved = dioramaResolveGlobal(sequencer, i);
      if (!resolved) return;
      var frame = resolved.frame;
      var localIndex = resolved.localIndex;
      var segment = resolved.segment;
      var placement = dioramaTextPlacement(localIndex, segment.seed, motion.weaveScale);
      var shot = dioramaGetShot(localIndex, segment.lines, segment.seed, motion.subMode);
      dioramaBuildFormation(localIndex, segment.seed, shot, frame, placement, particleScale).forEach(function (piece, slot) {
        result.push({
          kind: piece.kind,
          position: piece.position,
          scale: piece.scale,
          stretchY: piece.stretchY,
          upright: piece.upright,
          spinSpeed: piece.spinSpeed,
          colorSlot: piece.colorSlot,
          layer: piece.layer,
          key: i + '-' + slot,
          sourceLine: i,
          particleSeed: (segment.seed == null ? 'seed' : String(segment.seed)) + ':' + localIndex + ':' + slot + ':' + piece.kind,
          role: 'formation'
        });
      });
    });
    return dioramaSelectVisibleClusters(result, geometryVisibility)
      .filter(function (cluster) { return !!mounted[cluster.sourceLine]; });
  }

  /* ---- 逐单元跟唱纯函数 ---- */
  function dioramaResolveNeighborLineOpacity(offset) {
    if (offset === -1) return 0.3;
    if (offset === -2) return 0.1;
    if (offset === 1) return 0.34;
    if (offset === 2) return 0.16;
    if (offset === 3) return 0.06;
    return 0;
  }

  function dioramaResolveOutgoingLineOpacity(offsetFromOutgoing) {
    return offsetFromOutgoing === 0 ? 0.7 : Math.abs(offsetFromOutgoing) <= 2 ? 0.45 : 0.25;
  }

  function dioramaResolveGradientEnergy(now, unit) {
    if (now <= unit.startTime) return 0;
    if (now < unit.endTime) {
      var span = Math.max(unit.endTime - unit.startTime, 0.001);
      return dioramaSmoothstep01(dioramaClamp01((now - unit.startTime) / span));
    }
    var sinceSung = now - unit.endTime;
    if (sinceSung <= GRADIENT_HOLD_SECONDS) return 1;
    return 1 - dioramaSmoothstep01(dioramaClamp01((sinceSung - GRADIENT_HOLD_SECONDS) / GRADIENT_TRAIL_SECONDS));
  }

  function dioramaResolveTextLife(distanceToCamera) {
    var farT = dioramaClamp01((TEXT_FADE_IN_END - distanceToCamera) / (TEXT_FADE_IN_END - TEXT_FADE_IN_START));
    var nearT = dioramaClamp01((distanceToCamera - TEXT_DISSOLVE_END) / (TEXT_DISSOLVE_START - TEXT_DISSOLVE_END));
    return (farT * farT * (3 - 2 * farT)) * (nearT * nearT * (3 - 2 * nearT));
  }

  function dioramaResolveFrameFitScale(renderedWidth, distance, verticalFovDeg, aspect) {
    if (renderedWidth <= 0 || distance <= 0) return 1;
    var frameWidth = 2 * distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect;
    var targetWidth = frameWidth * TARGET_FRAME_WIDTH_FRACTION;
    return Math.min(1, Math.max(MIN_FIT_SCALE, targetWidth / renderedWidth));
  }

  function dioramaShouldResetUnitState(previousGlobalIndex, globalIndex, unitStateLength, unitCount) {
    return previousGlobalIndex !== globalIndex || unitStateLength !== unitCount;
  }

  /* ============================== 12. 关键字着色 ============================== */

  var KEYWORD_MIN_BG_CONTRAST = 4.5;
  var KEYWORD_MIN_PRIMARY_SEPARATION = 0.4;
  var KEYWORD_CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

  function dioramaKeywordSeparationFromPrimary(color, primary) {
    return Math.abs(color.r - primary.r) + Math.abs(color.g - primary.g) + Math.abs(color.b - primary.b);
  }

  var KEYWORD_ACTIVE_LINE_OPACITY = ACTIVE_LINE_OPACITY;

  function dioramaAsDisplayedText(color, background) {
    var src = color.clone();
    dioramaColorLinearToSrgb(src);
    var dst = background.clone();
    dioramaColorLinearToSrgb(dst);
    var blend = function (s, d) { return s * KEYWORD_ACTIVE_LINE_OPACITY + d * (1 - KEYWORD_ACTIVE_LINE_OPACITY); };
    var out = new THREE.Color(blend(src.r, dst.r), blend(src.g, dst.g), blend(src.b, dst.b));
    dioramaColorSrgbToLinear(out);
    return out;
  }

  function dioramaKeywordDisplayedContrastRatio(color, background) {
    return dioramaContrastRatio(dioramaAsDisplayedText(color, background), background);
  }

  function dioramaNudgeUntil(color, target, minimum, measure) {
    if (measure(color) >= minimum) return color.clone();
    var low = 0;
    var high = 1;
    for (var iteration = 0; iteration < 10; iteration += 1) {
      var amount = (low + high) * 0.5;
      if (measure(color.clone().lerp(target, amount)) >= minimum) high = amount;
      else low = amount;
    }
    return color.clone().lerp(target, high);
  }

  function dioramaResolveKeywordColor(keyword, primary, accent, background) {
    var separated = dioramaNudgeUntil(
      keyword, accent, KEYWORD_MIN_PRIMARY_SEPARATION,
      function (candidate) { return dioramaKeywordSeparationFromPrimary(candidate, primary); }
    );
    var lightTarget = dioramaColorFromCss('#ffffff');
    var darkTarget = dioramaColorFromCss('#050505');
    var pole = dioramaKeywordDisplayedContrastRatio(lightTarget, background)
      >= dioramaKeywordDisplayedContrastRatio(darkTarget, background) ? lightTarget : darkTarget;
    return dioramaNudgeUntil(
      separated, pole, KEYWORD_MIN_BG_CONTRAST,
      function (candidate) { return dioramaKeywordDisplayedContrastRatio(candidate, background); }
    );
  }

  function dioramaNormalizeKeywordToken(text) {
    return String(text || '').toLowerCase().replace(/[^\w]/g, '');
  }

  function dioramaPrepareKeywordMatchers(wordColors, enabled) {
    if (!enabled || !wordColors || wordColors.length === 0) return [];
    var matchers = [];
    wordColors.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var target = typeof entry.word === 'string' ? entry.word.trim() : '';
      if (!target) return;
      var color = typeof entry.color === 'string' ? entry.color : '';
      if (!color) return;
      if (KEYWORD_CJK_RE.test(target)) {
        matchers.push({ color: color, cjkPhrases: [target], englishWords: [], priority: target.length });
        return;
      }
      var englishWords = target.split(/\s+/).map(dioramaNormalizeKeywordToken).filter(Boolean);
      if (englishWords.length === 0) return;
      matchers.push({
        color: color,
        cjkPhrases: [],
        englishWords: englishWords,
        priority: Math.max.apply(null, englishWords.map(function (word) { return word.length; }))
      });
    });
    return matchers;
  }

  function dioramaKeywordRangesOverlap(a, b) {
    return a.startOffset < b.endOffset && b.startOffset < a.endOffset;
  }

  function dioramaSelectNonOverlappingRanges(ranges) {
    var selected = [];
    var prioritySorted = ranges.slice().sort(function (a, b) {
      return b.priority - a.priority || a.startOffset - b.startOffset || a.endOffset - b.endOffset;
    });
    prioritySorted.forEach(function (range) {
      var overlaps = selected.some(function (current) { return dioramaKeywordRangesOverlap(current, range); });
      if (!overlaps) selected.push(range);
    });
    return selected.sort(function (a, b) { return a.startOffset - b.startOffset || a.endOffset - b.endOffset; });
  }

  function dioramaBuildKeywordRanges(lineText, matchers) {
    if (!lineText || matchers.length === 0) return [];
    var ranges = [];
    var englishColorByWord = new Map();
    matchers.forEach(function (matcher) {
      matcher.cjkPhrases.forEach(function (target) {
        var cursor = 0;
        while (cursor < lineText.length) {
          var startOffset = lineText.indexOf(target, cursor);
          if (startOffset < 0) break;
          ranges.push({
            startOffset: startOffset,
            endOffset: startOffset + target.length,
            color: matcher.color,
            priority: matcher.priority
          });
          cursor = startOffset + Math.max(target.length, 1);
        }
      });
      matcher.englishWords.forEach(function (word) {
        var current = englishColorByWord.get(word);
        if (!current || matcher.priority > current.priority) {
          englishColorByWord.set(word, { color: matcher.color, priority: matcher.priority });
        }
      });
    });
    if (englishColorByWord.size > 0) {
      var wordRegex = /\w+/g;
      var match = wordRegex.exec(lineText);
      while (match !== null) {
        var wordColor = englishColorByWord.get(dioramaNormalizeKeywordToken(match[0]));
        if (wordColor) {
          ranges.push({
            startOffset: match.index,
            endOffset: match.index + match[0].length,
            color: wordColor.color,
            priority: wordColor.priority
          });
        }
        match = wordRegex.exec(lineText);
      }
    }
    return dioramaSelectNonOverlappingRanges(ranges);
  }

  function dioramaResolveTokenColorMap(tokens, ranges) {
    var colors = new Map();
    var rangeIndex = 0;
    tokens.forEach(function (token) {
      if (!token.timed) return;
      while (rangeIndex < ranges.length && ranges[rangeIndex].endOffset <= token.startOffset) {
        rangeIndex += 1;
      }
      var range = ranges[rangeIndex];
      if (range && dioramaKeywordRangesOverlap(range, token)) {
        colors.set(token.key, range.color);
      }
    });
    return colors;
  }

  function dioramaResolveKeywordUnitColors(lineText, units, matchers, primary, accent, background) {
    var resolved = new Map();
    if (!lineText || units.length === 0 || matchers.length === 0) return resolved;
    var ranges = dioramaBuildKeywordRanges(lineText, matchers);
    if (ranges.length === 0) return resolved;
    var colorByKey = dioramaResolveTokenColorMap(
      units.map(function (unit, index) {
        return {
          key: String(index),
          timed: true,
          startOffset: unit.charStart,
          endOffset: unit.charEnd
        };
      }),
      ranges
    );
    var adapted = new Map();
    colorByKey.forEach(function (hex, key) {
      var color = adapted.get(hex);
      if (!color) {
        color = dioramaResolveKeywordColor(dioramaColorFromCss(hex), primary, accent, background);
        adapted.set(hex, color);
      }
      resolved.set(Number(key), color);
    });
    return resolved;
  }

  /* ============================== 13. 实例 ============================== */

  function dioramaResolveThemeTargets(theme) {
    return {
      primary: dioramaColorFromCss(theme.primaryColor),
      accent: dioramaColorFromCss(theme.accentColor || theme.primaryColor),
      secondary: dioramaColorFromCss(theme.secondaryColor),
      bg: dioramaColorFromCss(theme.backgroundColor)
    };
  }

  /* 邻行整行栅格缓存（按全局行号；每帧预算 2 行）。 */
  function dioramaCreateLineRasterCache() {
    return { rasters: new Map(), font: '', epoch: -1 };
  }

  function dioramaSyncLineRasters(cache, visibleLines, globalIndex, fontSpec, fontStack, fontWeight, linesEpoch) {
    var changed = false;
    if (cache.font !== fontSpec || cache.epoch !== linesEpoch) {
      cache.rasters.forEach(function (raster) { raster.texture.dispose(); });
      cache.rasters.clear();
      cache.font = fontSpec;
      cache.epoch = linesEpoch;
      changed = true;
    }
    var wanted = {};
    visibleLines.forEach(function (entry) {
      if (entry.line && entry.line.fullText && entry.index !== globalIndex) wanted[entry.index] = true;
    });
    cache.rasters.forEach(function (raster, index) {
      if (!wanted[index]) {
        raster.texture.dispose();
        cache.rasters.delete(index);
        changed = true;
      }
    });
    var missing = [];
    Object.keys(wanted).forEach(function (key) {
      var index = Number(key);
      if (!cache.rasters.has(index)) missing.push(index);
    });
    missing.sort(function (a, b) { return a - b; });
    var built = 0;
    for (var i = 0; i < missing.length && built < NEIGHBOR_RASTER_BUDGET; i += 1) {
      var entry = null;
      for (var k = 0; k < visibleLines.length; k += 1) {
        if (visibleLines[k].index === missing[i]) { entry = visibleLines[k]; break; }
      }
      if (entry && entry.line && entry.line.fullText && !cache.rasters.has(missing[i])) {
        cache.rasters.set(missing[i], dioramaRasterLine(entry.line.fullText, fontStack, fontWeight));
        built += 1;
        changed = true;
      }
    }
    return changed;
  }

  function dioramaEnsureOutgoingRaster(cache, transitionOutgoingIndex, visibleLines, fontStack, fontWeight) {
    if (transitionOutgoingIndex == null) return;
    if (cache.rasters.has(transitionOutgoingIndex)) return;
    for (var i = 0; i < visibleLines.length; i += 1) {
      if (visibleLines[i].index === transitionOutgoingIndex) {
        var entry = visibleLines[i];
        if (entry.line && entry.line.fullText) {
          cache.rasters.set(transitionOutgoingIndex, dioramaRasterLine(entry.line.fullText, fontStack, fontWeight));
        }
        return;
      }
    }
  }

  /* ---- 资源销毁 ---- */
  function dioramaDisposeUnitPlanes(inst) {
    var planes = inst.unitPlanes;
    if (!planes) return;
    planes.forEach(function (entry) {
      [entry.base, entry.glow, entry.soul].forEach(function (mesh) {
        if (!mesh) return;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
        if (mesh.parent) mesh.parent.remove(mesh);
      });
      if (entry.baseTexture) entry.baseTexture.dispose();
      if (entry.glowTexture) entry.glowTexture.dispose();
    });
    planes.length = 0;
  }

  function dioramaDisposeLineMeshes(inst) {
    inst.lineMeshes.forEach(function (record) {
      if (record.mesh.geometry) record.mesh.geometry.dispose();
      if (record.mesh.material) record.mesh.material.dispose();
      if (record.mesh.parent) record.mesh.parent.remove(record.mesh);
    });
    inst.lineMeshes.clear();
  }

  function dioramaDisposeParticles(inst) {
    if (inst.particleContrast && inst.particleContrast.parent) {
      inst.particleContrast.parent.remove(inst.particleContrast);
    }
    if (inst.particleGlow && inst.particleGlow.parent) {
      inst.particleGlow.parent.remove(inst.particleGlow);
    }
    if (inst.particleGeometry) inst.particleGeometry.dispose();
    if (inst.particleMaterial) inst.particleMaterial.dispose();
    if (inst.particleGlowMaterial) inst.particleGlowMaterial.dispose();
    inst.particleContrast = null;
    inst.particleGlow = null;
    inst.particleGeometry = null;
    inst.particleMaterial = null;
    inst.particleGlowMaterial = null;
  }

  /* ---- create ---- */
  function dioramaCreate(host, ctx) {
    if (typeof THREE === 'undefined') {
      throw new Error('镜台需要 three.js（vendor/three.r128.min.js 未加载）');
    }
    var theme = ctx.theme || {};
    var inst = {
      host: host,
      clock: 0,
      lastDt: 0,
      fontScaleValue: 1,
      seq: dioramaCreateSequencerState(),
      lineMeshes: new Map(),
      lineRasters: dioramaCreateLineRasterCache(),
      unitPlanes: [],
      unitGroup: null,
      unitKey: '',
      unitBuiltKey: '',
      unitLayout: null,
      unitLightVals: null,
      unitSoulVals: null,
      prevActiveGlobal: -1,
      powerEnv: 0,
      trebleEnv: 0,
      activeLineWidth: 0,
      hasEverActive: false,
      lastLocalIndex: 0,
      lastActiveKey: null,
      transitionEpoch: 0,
      transition: null,
      transitionElapsed: 0,
      /* 就绪闸门：committed 滞后于真实 seed —— 与 Folia 的 committedSong 同构。
       * 初值 = 建 instance 当时的 seed/lines（Folia: useState(() => ({ seed, lines })）），
       * 所以 committedLines 永不为 null；换歌时先留在旧场景，等新歌就绪才飞。 */
      gate: dioramaCreateGate(ctx),
      instrumentalIndex: 0,
      instrumentalSeed: undefined,
      phantomLines: null,
      phantomSeed: undefined,
      fontSpec: '',
      fontStack: '',
      fontWeight: DIORAMA_DEFAULT_FONT_WEIGHT,
      fontsEpoch: 0,
      structKey: '',
      particleKey: '',
      particleMode: '',
      particlePointCount: 0,
      particleWaveNumberMax: 0,
      particleSpacing: 0,
      particlePointsPerUnit: 0,
      particleClusters: [],
      corridorSpans: [],
      structure: null,
      activeShot: 'hold',
      activePlacement: null,
      activeLocalIndex: 0,
      activeGlobalIndex: 0,
      activeLineText: '',
      activeTimeline: [],
      activeTimelineKey: '',
      activeUnits: [],
      keywordColors: new Map(),
      keywordColorsKey: '',
      trackers: DIORAMA_RIPPLE_BANDS.map(function () { return dioramaCreateBandTracker(); }),
      ripples: dioramaCreateRipplePool(),
      flowTime: 0,
      previousPlaybackTime: null,
      elastic: dioramaCreateElasticState(),
      formation: 1,
      lockedSeconds: FORMATION_SETTLE_SECONDS,
      moteCircumference: dioramaResolveMoteCircumference(dioramaTuning().backgroundParticleCircumference),
      moteRadial: dioramaResolveMoteRadial(dioramaTuning().backgroundParticleRadial),
      moteWritten: [],
      drawingSize: new THREE.Vector2(),
      /* 建实例时的调参快照：tick 里比对对象身份，变了清掉两个几何键并重开尘埃层。 */
      tuning: dioramaTuning(),
      motion: dioramaResolveMotionParams(dioramaTuning(), theme.animationIntensity),
      camera: {
        pos: new THREE.Vector3(0, 0.6, 9),
        posVel: new THREE.Vector3(0, 0, 0),
        look: new THREE.Vector3(0, 0, -10),
        lookVel: new THREE.Vector3(0, 0, 0),
        align: 0,
        alignQuat: new THREE.Quaternion(),
        alignQuatInit: false,
        orient: new THREE.Quaternion(),
        orientInit: false,
        flight: {
          flying: false, epoch: 0, start: 0,
          perp: new THREE.Vector3(), side: 1, flightLen: 1
        }
      }
    };

    /* three 舞台 */
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (err) {
      throw new Error('镜台无法创建 WebGL 渲染器：' + ((err && err.message) || String(err)));
    }
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x05070b, 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);
    inst.renderer = renderer;

    inst.scene = new THREE.Scene();
    inst.scene.fog = new THREE.Fog(0x05070b, FOG_NEAR, FOG_FAR);
    inst.camera3d = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
    inst.camera3d.position.set(0, 0.6, 9);
    inst.rootGroup = new THREE.Group();
    inst.scene.add(inst.rootGroup);

    inst.themeTargets = dioramaResolveThemeTargets(theme);
    inst.damped = {
      primary: inst.themeTargets.primary.clone(),
      accent: inst.themeTargets.accent.clone(),
      secondary: inst.themeTargets.secondary.clone(),
      bg: inst.themeTargets.bg.clone()
    };
    inst.themeKey = [
      theme.primaryColor, theme.accentColor, theme.secondaryColor, theme.backgroundColor
    ].join('|');

    /* 尘埃层 */
    var moteDensity = inst.moteCircumference * inst.moteRadial;
    inst.motePositions = new Float32Array(DIORAMA_MOTE_WINDOW_LINES * moteDensity * 3);
    var moteGeometry = new THREE.BufferGeometry();
    inst.moteAttribute = new THREE.BufferAttribute(inst.motePositions, 3);
    moteGeometry.setAttribute('position', inst.moteAttribute);
    var moteMaterial = new THREE.PointsMaterial({
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    moteMaterial.color.copy(inst.damped.secondary);
    inst.motePoints = new THREE.Points(moteGeometry, moteMaterial);
    inst.motePoints.frustumCulled = false;
    inst.rootGroup.add(inst.motePoints);
    inst.moteMaterial = moteMaterial;

    /* 副标题层（译文 / 下一句预览）——3D 场景不复制它 */
    inst.subtitle = null;
    try {
      if (typeof foliaCreateSubtitleOverlay === 'function') {
        inst.subtitle = foliaCreateSubtitleOverlay(
          host, theme, typeof foliaResolveSubtitleFontSizes === 'function'
            ? foliaResolveSubtitleFontSizes(ctx.fontScale || 1) : undefined
        );
      }
    } catch (_) {}

    /* 等待播放占位（首行之前） */
    var waiting = document.createElement('div');
    waiting.className = 'folia-diorama-waiting';
    waiting.textContent = '等待播放';
    waiting.style.display = 'none';
    host.appendChild(waiting);
    inst.waiting = waiting;

    /* 字体就绪后重栅格 */
    try {
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(function () {
          inst.fontsEpoch += 1;
        });
      }
    } catch (_) {}

    inst.debug = function () { return dioramaDebugState(inst); };
    return inst;
  }

  /* ---- 结构签名（React memo 的等价物） ---- */
  function dioramaStructureKey(inst, effectiveLineIndex) {
    var vis = dioramaTuning().geometryVisibility;
    return [
      inst.gate.committedSeed,
      inst.lyricsSig,
      inst.activeSegKey,
      inst.linesEpoch,
      effectiveLineIndex,
      inst.transition ? inst.transition.epoch : 0,
      inst.motion.weaveScale,
      inst.motion.subMode,
      inst.fontSpec,
      inst.fontsEpoch
    ].join('|');
  }

  /* 尘埃层的顶点缓冲是按「圆周 × 径向」在创建时一次性分配的：这两个数变了必须重开一层。
   * 材质留着（颜色 / 透明度每帧都在刷），只换 geometry 与 points 节点。 */
  function dioramaRebuildMoteField(inst) {
    var tuning = dioramaTuning();
    inst.moteCircumference = dioramaResolveMoteCircumference(tuning.backgroundParticleCircumference);
    inst.moteRadial = dioramaResolveMoteRadial(tuning.backgroundParticleRadial);
    var density = inst.moteCircumference * inst.moteRadial;
    inst.motePositions = new Float32Array(DIORAMA_MOTE_WINDOW_LINES * density * 3);
    inst.moteAttribute = new THREE.BufferAttribute(inst.motePositions, 3);
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', inst.moteAttribute);
    var previous = inst.motePoints;
    inst.motePoints = new THREE.Points(geometry, inst.moteMaterial);
    inst.motePoints.frustumCulled = false;
    if (previous && previous.parent) previous.parent.remove(previous);
    if (previous && previous.geometry) previous.geometry.dispose();
    inst.moteWritten = [];
    inst.rootGroup.add(inst.motePoints);
  }

  function dioramaParticleKey(inst, globalIndex, transitionOutgoing, activeSeg, total) {
    var vis = dioramaTuning().geometryVisibility;
    var mode = vis.mode || 'clouds';
    var geometryPart;
    if (mode === 'corridor') {
      geometryPart = [
        activeSeg.key, globalIndex,
        transitionOutgoing == null ? -1 : transitionOutgoing,
        inst.linesEpoch
      ].join(',');
    } else {
      geometryPart = dioramaResolveMountedIndices(globalIndex, transitionOutgoing, total).join(',');
    }
    return [
      mode, geometryPart, inst.linesEpoch,
      dioramaTuning().particleDensity, dioramaTuning().particleScale,
      vis.enabled ? 1 : 0,
      vis.strands ? 1 : 0, vis.blobs ? 1 : 0, vis.ribbons ? 1 : 0, vis.rings ? 1 : 0
    ].join('|');
  }

  /* ---- tick ---- */
  function dioramaTick(inst, ctx) {
    var dt = isFinite(Number(ctx.dt)) ? Math.min(Math.max(Number(ctx.dt), 0), 0.1) : 0;
    inst.lastDt = dt;
    inst.clock += dt;
    inst.fontScaleValue = (ctx.fontScale === undefined || ctx.fontScale === null) ? 1 : ctx.fontScale;

    var theme = ctx.theme || {};

    /* 调参变化：密度 / 体积 / 几何开关都参与两个几何键，清键即重建；
     * 尘埃两轴要重开顶点缓冲；运动三项每帧现读，不用管。 */
    var tuningNow = dioramaTuning();
    if (tuningNow !== inst.tuning) {
      var prevTuning = inst.tuning || {};
      inst.tuning = tuningNow;
      if (prevTuning.backgroundParticleCircumference !== tuningNow.backgroundParticleCircumference
          || prevTuning.backgroundParticleRadial !== tuningNow.backgroundParticleRadial) {
        dioramaRebuildMoteField(inst);
      }
      inst.particleKey = '';
      inst.structKey = '';
    }

    inst.motion = dioramaResolveMotionParams(tuningNow, theme.animationIntensity);

    /* 主题目标色（只在串变化时重解析） */
    var themeKey = [theme.primaryColor, theme.accentColor, theme.secondaryColor, theme.backgroundColor].join('|');
    if (themeKey !== inst.themeKey) {
      inst.themeKey = themeKey;
      inst.themeTargets = dioramaResolveThemeTargets(theme);
    }
    var colorK = 1 - Math.exp(-COLOR_DAMP_RATE * dt);
    inst.damped.primary.lerp(inst.themeTargets.primary, colorK);
    inst.damped.accent.lerp(inst.themeTargets.accent, colorK);
    inst.damped.secondary.lerp(inst.themeTargets.secondary, colorK);
    inst.damped.bg.lerp(inst.themeTargets.bg, colorK);
    if (inst.scene.fog) inst.scene.fog.color.copy(inst.damped.bg);
    inst.renderer.setClearColor(inst.damped.bg, 1);

    /* 音频包络（几何 / 辉光 / 尘埃用；镜头永不接音频） */
    var bands = ctx.audioBands || (ctx.audio && ctx.audio.bands) || {};
    var audioK = inst.motion.audioLevel;
    var trebleTarget = dioramaClamp01((Number(bands.treble) || 0) / 255) * audioK;
    var powerTarget = dioramaClamp01((Number(ctx.audio && ctx.audio.power) || 0) / 255) * audioK;
    inst.trebleEnv = dioramaStepEnvelope(inst.trebleEnv, trebleTarget, 14, 3.2, dt);
    inst.powerEnv = dioramaStepEnvelope(inst.powerEnv, powerTarget, 18, 3.5, dt);

    /* ---- 就绪闸门（逐字对应 Folia 的 committedSong effect） ---- */
    var lines = ctx.lines || [];
    var seed = ctx.seed == null ? '' : String(ctx.seed);
    var lyricsSig = dioramaLyricsSignature(lines);
    var gate = inst.gate;
    if (seed === gate.committedSeed) {
      /* 同一首歌：只有歌词内容真变了才重提交（迟到歌词 / 重处理），
       * 不对「每次渲染都发新的空数组」提交 —— 否则纯音乐歌的过渡永远不触发。 */
      if (lyricsSig !== gate.lyricsSig) {
        gate.committedLines = lines;
        gate.lyricsSig = lyricsSig;
      }
      gate.pendingSeed = null;
    } else if (lyricsSig !== '') {
      /* 新歌歌词已到位：立刻提交并飞过去 */
      gate.committedSeed = seed;
      gate.committedLines = lines;
      gate.lyricsSig = lyricsSig;
      gate.pendingSeed = null;
    } else {
      /* 没有歌词：可能是纯音乐、也可能还在加载 —— 此刻不可区分。
       * 看播放进度：新歌真的走过 INSTRUMENTAL_COMMIT_SECONDS 仍无歌词才当纯音乐飞；
       * 墙钟 READY_GRACE_MS 兜底，闸门永不挂死。 */
      if (gate.pendingSeed !== seed) {
        gate.pendingSeed = seed;
        gate.sawReset = false;
        gate.startedAt = performance.now();
      }
      var gateTime = Number(ctx.time) || 0;
      if (!gate.sawReset && gateTime < 1) gate.sawReset = true;
      if ((gate.sawReset && gateTime >= INSTRUMENTAL_COMMIT_SECONDS)
        || (performance.now() - gate.startedAt >= READY_GRACE_MS)) {
        gate.committedSeed = seed;
        gate.committedLines = lines;
        gate.lyricsSig = lyricsSig;
        gate.pendingSeed = null;
      }
    }

    var isInstrumental = gate.committedLines.length === 0;
    var effectiveLines = isInstrumental ? dioramaPhantomLines(inst, gate.committedSeed) : gate.committedLines;
    if (isInstrumental) {
      if (inst.instrumentalSeed !== seed) {
        inst.instrumentalSeed = seed;
        inst.instrumentalIndex = 0;
      }
      var frameIdx = dioramaClamp(
        Math.floor((Number(ctx.time) || 0) / INSTRUMENTAL_SECONDS_PER_FRAME), 0, INSTRUMENTAL_FRAMES - 1
      );
      if (frameIdx !== inst.instrumentalIndex) inst.instrumentalIndex = frameIdx;
    }

    /* ---- sequencer 状态机 ---- */
    var currentLineIndex = ctx.index;
    var onInterlude = !isInstrumental && currentLineIndex >= 0
      && !!gate.committedLines[currentLineIndex]
      && gate.committedLines[currentLineIndex].fullText === DIORAMA_INTERLUDE_TEXT;
    var effectiveLineIndex = isInstrumental ? inst.instrumentalIndex : (onInterlude ? -1 : currentLineIndex);

    var outgoingSeg = dioramaActiveSegment(inst.seq);
    var outgoingLocal = outgoingSeg
      ? dioramaClamp(Math.max(inst.lastLocalIndex, 0), 0, outgoingSeg.span - 1)
      : 0;
    var outgoingGlobal = outgoingSeg ? outgoingSeg.globalStart + outgoingLocal : 0;

    /* 段种子规范化：只对 null/undefined 回落 'diorama'（与 Folia 的 `?? 'diorama'` 一致，
     * 空串保持空串）。比较与写入必须用同一个值，否则每帧都被判成「新歌」→ 每帧追加一段。 */
    var segSeed = seed == null ? 'diorama' : seed;
    var isNewSong = !outgoingSeg || String(outgoingSeg.seed) !== String(segSeed);
    var lyricsChanged = !isNewSong && !!outgoingSeg && outgoingSeg.lines !== effectiveLines;

    if (isNewSong) {
      var placementOrigin = { x: 0, y: 0, z: 0 };
      if (outgoingSeg) {
        var anchor = dioramaGetFrame(outgoingSeg.frames, outgoingLocal).position;
        var off = dioramaPickTransitionOffset(segSeed, inst.transitionEpoch + 1);
        placementOrigin = { x: anchor.x + off.x, y: anchor.y + off.y, z: anchor.z + off.z };
      }
      dioramaAppendSegment(inst.seq, {
        seed: segSeed, lines: effectiveLines, round: 0, placementOrigin: placementOrigin
      });
    } else if (lyricsChanged) {
      dioramaUpdateActiveSegmentLines(inst.seq, effectiveLines);
    }

    var activeSeg = dioramaActiveSegment(inst.seq);
    /* 结构键要用的两个派生值必须在这里就更新（不能等 rebuild），
     * 否则迟到歌词只改 committedLines 不改签名 → 永不重建成新行。 */
    inst.linesEpoch = activeSeg ? activeSeg.linesEpoch : 0;
    inst.lyricsSig = lyricsSig;
    var keyChanged = activeSeg.key !== inst.lastActiveKey;
    var hadPrevious = inst.lastActiveKey !== null;
    if (keyChanged) {
      inst.lastActiveKey = activeSeg.key;
      inst.lastLocalIndex = 0;
      inst.hasEverActive = false;
    }
    var isLoopRestart = !!outgoingSeg && !isNewSong && effectiveLineIndex >= 0
      && effectiveLineIndex <= LOOP_RESTART_MAX_INDEX && inst.lastLocalIndex > effectiveLineIndex;
    if (isLoopRestart) {
      inst.lastLocalIndex = 0;
      inst.hasEverActive = false;
    }
    var startingTransition = (keyChanged && hadPrevious) || isLoopRestart;
    if (startingTransition) {
      inst.transitionEpoch += 1;
      inst.transition = { epoch: inst.transitionEpoch, outgoingIndex: outgoingGlobal };
      inst.transitionElapsed = 0;
    }
    if (effectiveLineIndex >= 0) {
      inst.lastLocalIndex = effectiveLineIndex;
      inst.hasEverActive = true;
    }
    var rawLocalIndex = effectiveLineIndex >= 0 ? effectiveLineIndex : inst.lastLocalIndex;
    var localPositionIndex = dioramaClamp(rawLocalIndex, 0, Math.max(activeSeg.span - 1, 0));
    var globalIndex = activeSeg.globalStart + localPositionIndex;
    var total = dioramaTotalGlobalLines(inst.seq);

    var activeOutgoingIndex = startingTransition
      ? outgoingGlobal
      : (inst.transition ? inst.transition.outgoingIndex : null);
    var pruneFrom = activeOutgoingIndex != null ? Math.min(globalIndex, activeOutgoingIndex) : globalIndex;
    dioramaPruneSegments(inst.seq, pruneFrom - PRUNE_MARGIN_BEHIND);

    if (inst.transition) {
      inst.transitionElapsed += dt;
      if (inst.transitionElapsed >= TRANSITION_DURATION) inst.transition = null;
    }

    inst.activeGlobalIndex = globalIndex;
    inst.activeLocalIndex = localPositionIndex;

    /* 等待播放占位 */
    var realActiveLine = currentLineIndex >= 0 ? (lines[currentLineIndex] || null) : null;
    var showWaiting = ctx.showText !== false && !realActiveLine && !inst.hasEverActive;
    if (inst.waiting) {
      if (showWaiting && inst.waiting.style.display === 'none') {
        var scale = inst.fontScaleValue;
        inst.waiting.style.fontSize = 'clamp(' + (1.5 * scale).toFixed(3) + 'rem, '
          + (3.5 * scale).toFixed(3) + 'vw, ' + (2.25 * scale).toFixed(3) + 'rem)';
        inst.waiting.style.color = theme.secondaryColor || '#ffffff';
        inst.waiting.style.display = '';
      } else if (!showWaiting && inst.waiting.style.display !== 'none') {
        inst.waiting.style.display = 'none';
      }
    }

    /* ---- 点阵层（键变才重建几何） ---- */
    var transitionOutgoing = inst.transition ? inst.transition.outgoingIndex : null;
    var particleKey = dioramaParticleKey(inst, globalIndex, transitionOutgoing, activeSeg, total);
    if (particleKey !== inst.particleKey) {
      inst.particleKey = particleKey;
      var vis = dioramaTuning().geometryVisibility;
      var geometryMode = vis.mode || 'clouds';
      var mountedIndices = dioramaResolveMountedIndices(globalIndex, transitionOutgoing, total);
      inst.particleClusters = dioramaBuildParticleClusters(
        inst.seq, mountedIndices, geometryMode, inst.motion, vis, dioramaTuning().particleScale
      );
      inst.corridorSpans = dioramaBuildCorridorSpans(
        inst.seq, globalIndex, transitionOutgoing, vis, geometryMode
      );
      dioramaRebuildParticleGeometry(inst, geometryMode, inst.particleClusters, inst.corridorSpans);
    }

    /* ---- 结构签名变化才重建（可见行 / 当前行单元 / 字体） ---- */
    var structKey = dioramaStructureKey(inst, effectiveLineIndex);
    if (structKey !== inst.structKey) {
      inst.structKey = structKey;
      dioramaRebuildStructure(inst, theme, globalIndex, activeSeg);
    }

    var structure = inst.structure;
    var visibleLines = structure.visibleLines;

    /* ---- 当前行字素时间轴 / 单元 ---- */
    var activeResolved = dioramaResolveGlobal(inst.seq, globalIndex);
    var activeLine = activeResolved ? activeResolved.line : null;
    inst.activeLineText = activeLine && activeLine.fullText ? activeLine.fullText : '';
    var activeEntry = null;
    for (var vi = 0; vi < visibleLines.length; vi += 1) {
      if (visibleLines[vi].index === globalIndex) { activeEntry = visibleLines[vi]; break; }
    }
    var timelineKey = activeSeg.key + '|' + globalIndex + '|' + inst.linesEpoch;
    if (timelineKey !== inst.activeTimelineKey) {
      inst.activeTimelineKey = timelineKey;
      inst.activeTimeline = activeLine ? dioramaBuildLineTimeline(activeLine) : [];
      inst.activeUnits = activeLine ? dioramaSplitLyricUnits(activeLine, inst.activeTimeline) : [];
    }

    /* ---- 邻行栅格（每帧预算） ---- */
    dioramaSyncLineRasters(
      inst.lineRasters, visibleLines, globalIndex, inst.fontSpec, inst.fontStack, inst.fontWeight, inst.linesEpoch
    );
    if (inst.transition) {
      dioramaEnsureOutgoingRaster(
        inst.lineRasters, inst.transition.outgoingIndex, visibleLines, inst.fontStack, inst.fontWeight
      );
    }

    /* ---- 尘埃窗口回收 ---- */
    if (dioramaTuning().showParticles) {
      var dirty = dioramaRecycleMoteWindow({
        written: inst.moteWritten,
        motePositions: inst.motePositions,
        sequencer: inst.seq,
        globalIndex: globalIndex,
        total: total,
        moteCircumference: inst.moteCircumference,
        moteRadial: inst.moteRadial,
        seed: activeSeg.seed
      });
      if (dirty && inst.moteAttribute) inst.moteAttribute.needsUpdate = true;
    }
    if (inst.motePoints) {
      inst.motePoints.visible = !!dioramaTuning().showParticles;
      var tClock = inst.clock;
      inst.motePoints.position.set(
        Math.sin(tClock * 0.17) * 0.12,
        Math.sin(tClock * 0.11 + 1.7) * 0.09,
        Math.cos(tClock * 0.13) * 0.12
      );
    }
    if (inst.moteMaterial) {
      inst.moteMaterial.size = 0.03 * (1 + 0.42 * inst.trebleEnv);
      inst.moteMaterial.opacity = 0.16 + 0.18 * inst.powerEnv;
      inst.moteMaterial.color.copy(inst.damped.secondary).lerp(inst.damped.accent, 0.3);
    }

    /* ---- 画布尺寸 ---- */
    var width = inst.host.clientWidth || window.innerWidth;
    var height = inst.host.clientHeight || window.innerHeight;
    if (inst.viewWidth !== width || inst.viewHeight !== height) {
      inst.viewWidth = width;
      inst.viewHeight = height;
      inst.renderer.setSize(width, height, false);
      inst.camera3d.aspect = width / Math.max(1, height);
      inst.camera3d.updateProjectionMatrix();
    }
    var aspect = inst.camera3d.aspect;
    var fov = inst.camera3d.fov;
    var camPos = inst.camera3d.position;

    /* ---- 邻行逐帧写入 ---- */
    dioramaUpdateNeighborLines(inst, ctx, visibleLines, globalIndex, aspect, fov, camPos);

    /* ---- 当前行逐单元 ---- */
    dioramaUpdateActiveUnits(inst, ctx, activeEntry, activeLine, globalIndex, aspect, fov, camPos);

    /* ---- 点阵层逐帧 ---- */
    dioramaUpdateParticles(inst, ctx, globalIndex, dt);

    /* ---- 镜头 ---- */
    dioramaUpdateCamera(inst, ctx, activeResolved, activeLine, aspect, fov, dt);

    /* ---- 字幕层 ---- */
    if (inst.subtitle) {
      try { inst.subtitle.update(ctx, dt); } catch (_) {}
    }

    inst.renderer.render(inst.scene, inst.camera3d);
  }

  /* 纯音乐幻影行：空文本但带段落结构，让运镜 / 几何继续表演。 */
  function dioramaPhantomLines(inst, seed) {
    if (inst.phantomLines && inst.phantomSeed === seed) return inst.phantomLines;
    var result = [];
    for (var i = 0; i < INSTRUMENTAL_FRAMES; i += 1) {
      var block = Math.floor(i / 4);
      var isChorus = block % 3 === 2;
      result.push({
        words: [],
        startTime: i * INSTRUMENTAL_SECONDS_PER_FRAME,
        endTime: (i + 1) * INSTRUMENTAL_SECONDS_PER_FRAME,
        fullText: '',
        blockIndex: block,
        songPart: isChorus ? 'chorus' : 'verse',
        isChorus: isChorus
      });
    }
    inst.phantomLines = result;
    inst.phantomSeed = seed;
    return result;
  }

  /* ---- 结构重建（可见行 / 当前行运镜 / 字体） ---- */
  function dioramaRebuildStructure(inst, theme, globalIndex, activeSeg) {
    var fontStack = '';
    try {
      if (typeof foliaResolveThemeFontStack === 'function') fontStack = foliaResolveThemeFontStack(theme);
    } catch (_) {}
    if (!fontStack) fontStack = theme.fontStack || 'system-ui, "Noto Sans SC", "Microsoft YaHei", sans-serif';
    var fontWeight = DIORAMA_DEFAULT_FONT_WEIGHT;
    try {
      if (typeof foliaResolveThemeFontWeight === 'function') {
        fontWeight = foliaResolveThemeFontWeight(theme, DIORAMA_DEFAULT_FONT_WEIGHT);
      }
    } catch (_) {}
    inst.fontStack = fontStack;
    inst.fontWeight = fontWeight;
    inst.fontSpec = dioramaBuildFontSpec(fontStack, fontWeight);

    inst.activeSegKey = activeSeg.key;
    inst.linesEpoch = activeSeg.linesEpoch;

    var transitionOutgoing = inst.transition ? inst.transition.outgoingIndex : null;
    var mountedIndices = dioramaResolveMountedIndices(globalIndex, transitionOutgoing, dioramaTotalGlobalLines(inst.seq));
    var visibleLines = dioramaBuildVisibleLines(
      inst.seq, mountedIndices, globalIndex, transitionOutgoing, inst.motion.weaveScale
    );

    /* 当前行的运镜手法 / 文本摆放（签名的一部分：副模式与 weave 变了就重算） */
    var activeResolved = dioramaResolveGlobal(inst.seq, globalIndex);
    if (activeResolved) {
      inst.activeShot = dioramaGetShot(
        activeResolved.localIndex, activeResolved.segment.lines, activeResolved.segment.seed, inst.motion.subMode
      );
      inst.activePlacement = dioramaTextPlacement(
        activeResolved.localIndex, activeResolved.segment.seed, inst.motion.weaveScale
      );
    }

    inst.structure = {
      mountedIndices: mountedIndices,
      visibleLines: visibleLines
    };
  }

  function dioramaRebuildParticleGeometry(inst, mode, clusters, spans) {
    dioramaDisposeParticles(inst);
    var data;
    if (mode === 'corridor') {
      data = dioramaBuildCorridorGeometryData(spans, dioramaTuning().particleDensity);
    } else {
      data = dioramaBuildCloudGeometryData(clusters, dioramaTuning().particleDensity);
    }
    inst.particleMode = mode;
    inst.particlePointCount = data.pointCount;
    inst.particleWaveNumberMax = dioramaResolveWaveNumberMax(data.spacing);
    inst.particleSpacing = data.spacing;
    inst.particlePointsPerUnit = data.pointsPerUnit;
    if (data.pointCount <= 0) return;

    inst.particleGeometry = dioramaCreateParticleBufferGeometry(data);
    var contrastColors = dioramaResolveParticleContrastColors(
      {
        primary: inst.themeTargets.primary,
        accent: inst.themeTargets.accent,
        secondary: inst.themeTargets.secondary
      },
      inst.themeTargets.bg
    );
    inst.particleColors = contrastColors;
    inst.particleMaterial = dioramaCreateParticleMaterial(contrastColors);
    inst.particleGlowMaterial = dioramaCreateParticleGlowMaterial(
      contrastColors, dioramaTuning().particleGlowIntensity
    );
    inst.particleContrast = new THREE.Points(inst.particleGeometry, inst.particleMaterial);
    inst.particleContrast.frustumCulled = false;
    inst.particleContrast.renderOrder = 4;
    inst.rootGroup.add(inst.particleContrast);
    inst.particleGlow = new THREE.Points(inst.particleGeometry, inst.particleGlowMaterial);
    inst.particleGlow.frustumCulled = false;
    inst.particleGlow.renderOrder = 3;
    inst.particleGlow.visible = !!dioramaTuning().particleGlowEnabled;
    inst.rootGroup.add(inst.particleGlow);
  }

  /* ---- 邻行逐帧 ---- */
  function dioramaUpdateNeighborLines(inst, ctx, visibleLines, globalIndex, aspect, fov, camPos) {
    if (ctx.showText === false) {
      dioramaDisposeLineMeshes(inst);
      return;
    }
    var wanted = {};
    var i;
    for (i = 0; i < visibleLines.length; i += 1) wanted[visibleLines[i].index] = visibleLines[i];

    inst.lineMeshes.forEach(function (record, index) {
      if (!wanted[index]) {
        if (record.mesh.geometry) record.mesh.geometry.dispose();
        if (record.mesh.material) record.mesh.material.dispose();
        if (record.mesh.parent) record.mesh.parent.remove(record.mesh);
        inst.lineMeshes.delete(index);
      }
    });

    visibleLines.forEach(function (entry) {
      if (entry.index === globalIndex) return;
      if (!entry.line || !entry.line.fullText) return;
      var offset = entry.index - globalIndex;
      var outgoingBase = inst.transition ? inst.transition.outgoingIndex : entry.index;
      var initialOpacity = entry.isOutgoing
        ? dioramaResolveOutgoingLineOpacity(entry.index - outgoingBase)
        : dioramaResolveNeighborLineOpacity(offset);
      if (initialOpacity <= 0) return;
      var raster = inst.lineRasters.rasters.get(entry.index);
      if (!raster) return;

      var record = inst.lineMeshes.get(entry.index);
      var worldPerPx = LINE_FONT_SIZE / raster.fontPx;
      var geoKey = raster.canvasWidthPx + 'x' + raster.canvasHeightPx + '@' + raster.fontPx;
      if (!record || record.raster !== raster || record.geoKey !== geoKey) {
        if (record) {
          if (record.mesh.geometry) record.mesh.geometry.dispose();
          if (record.mesh.material) record.mesh.material.dispose();
          if (record.mesh.parent) record.mesh.parent.remove(record.mesh);
        }
        var geometry = new THREE.PlaneGeometry(raster.canvasWidthPx * worldPerPx, raster.canvasHeightPx * worldPerPx);
        var material = new THREE.MeshBasicMaterial({
          map: raster.texture,
          transparent: true,
          opacity: initialOpacity,
          depthWrite: false
        });
        var mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(entry.position[0], entry.position[1], entry.position[2]);
        mesh.quaternion.set(
          entry.quaternion[0], entry.quaternion[1], entry.quaternion[2], entry.quaternion[3]
        );
        mesh.renderOrder = 0;
        inst.rootGroup.add(mesh);
        record = { mesh: mesh, raster: raster, geoKey: geoKey };
        inst.lineMeshes.set(entry.index, record);
      }

      var worldWidth = raster.advancePx * (LINE_FONT_SIZE / raster.fontPx);
      var fit = dioramaResolveFrameFitScale(worldWidth, DIORAMA_HERO_DISTANCE, fov, aspect)
        * entry.placement.scale * inst.fontScaleValue;
      record.mesh.scale.setScalar(fit);
      var life = dioramaResolveTextLife(record.mesh.position.distanceTo(camPos));
      var material = record.mesh.material;
      if (entry.isOutgoing) {
        material.opacity = dioramaResolveOutgoingLineOpacity(entry.index - outgoingBase) * life;
        material.color.copy(inst.damped.primary);
      } else {
        material.opacity = dioramaResolveNeighborLineOpacity(offset) * life;
        material.color.copy(offset < 0 ? inst.damped.primary : inst.damped.secondary);
      }
    });
  }

  /* ---- 当前行逐单元 ---- */
  function dioramaUpdateActiveUnits(inst, ctx, activeEntry, activeLine, globalIndex, aspect, fov, camPos) {
    var showLyrics = ctx.showText !== false;
    var unitCount = inst.activeUnits ? inst.activeUnits.length : 0;

    if (dioramaShouldResetUnitState(
      inst.prevActiveGlobal, globalIndex, inst.unitLightVals ? inst.unitLightVals.length : undefined, unitCount
    )) {
      inst.prevActiveGlobal = globalIndex;
      inst.unitLightVals = new Float32Array(unitCount);
      inst.unitSoulVals = new Float32Array(unitCount);
    }

    if (!showLyrics || !activeLine || !activeLine.fullText || !activeEntry || unitCount === 0) {
      if (inst.unitBuiltKey !== '') {
        dioramaDisposeUnitPlanes(inst);
        if (inst.unitGroup && inst.unitGroup.parent) inst.unitGroup.parent.remove(inst.unitGroup);
        inst.unitGroup = null;
        inst.unitBuiltKey = '';
        inst.unitLayout = null;
        inst.activeLineWidth = 0;
      } else {
        inst.activeLineWidth = 0;
      }
      return;
    }

    /* 行 / 字体 / 单元数变了 → 重新栅格 + 重建平面 */
    var unitKey = [
      inst.activeSegKey, globalIndex, inst.linesEpoch, inst.fontSpec, inst.fontsEpoch, unitCount
    ].join('|');
    if (unitKey !== inst.unitBuiltKey || !inst.unitGroup || inst.unitPlanes.length !== unitCount) {
      dioramaDisposeUnitPlanes(inst);
      if (inst.unitGroup && inst.unitGroup.parent) inst.unitGroup.parent.remove(inst.unitGroup);
      var group = new THREE.Group();
      group.position.set(activeEntry.position[0], activeEntry.position[1], activeEntry.position[2]);
      group.quaternion.set(
        activeEntry.quaternion[0], activeEntry.quaternion[1],
        activeEntry.quaternion[2], activeEntry.quaternion[3]
      );
      inst.rootGroup.add(group);
      inst.unitGroup = group;
      inst.unitBuiltKey = unitKey;
      inst.unitLayout = dioramaLayoutActiveUnits(activeLine, inst.activeUnits, inst.fontSpec);
      if (inst.unitLayout) {
        var planes = inst.unitPlanes;
        inst.unitLayout.units.forEach(function (placed) {
          var glowGeometry = new THREE.PlaneGeometry(placed.width, placed.height);
          var glowMaterial = new THREE.MeshBasicMaterial({
            map: placed.raster.glowTexture,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });
          var glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
          glowMesh.position.set(placed.centerX, 0, -0.01);
          glowMesh.renderOrder = 17;
          glowMesh.visible = false;
          group.add(glowMesh);

          var soulGeometry = new THREE.PlaneGeometry(placed.width, placed.height);
          var soulMaterial = new THREE.MeshBasicMaterial({
            map: placed.raster.baseTexture,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });
          var soulMesh = new THREE.Mesh(soulGeometry, soulMaterial);
          soulMesh.position.set(placed.centerX, 0, -0.005);
          soulMesh.renderOrder = 18;
          soulMesh.visible = false;
          group.add(soulMesh);

          var baseGeometry = new THREE.PlaneGeometry(placed.width, placed.height);
          var baseMaterial = new THREE.MeshBasicMaterial({
            map: placed.raster.baseTexture,
            transparent: true,
            opacity: UNSUNG_UNIT_OPACITY,
            depthTest: false,
            depthWrite: false
          });
          var baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
          baseMesh.position.set(placed.centerX, 0, 0);
          baseMesh.renderOrder = 19;
          group.add(baseMesh);

          planes.push({
            base: baseMesh, glow: glowMesh, soul: soulMesh,
            baseTexture: placed.raster.baseTexture,
            glowTexture: placed.raster.glowTexture
          });
        });
      }
    }
    if (!inst.unitLayout) {
      inst.activeLineWidth = 0;
      return;
    }

    var fit = dioramaResolveFrameFitScale(inst.unitLayout.lineWidth, DIORAMA_HERO_DISTANCE, fov, aspect)
      * activeEntry.placement.scale * inst.fontScaleValue;
    inst.unitGroup.scale.setScalar(fit);
    inst.activeLineWidth = inst.unitLayout.lineWidth * fit;

    var life = dioramaResolveTextLife(inst.unitGroup.position.distanceTo(camPos));
    var now = Number(ctx.time) || 0;
    var breath = 0.9 + 0.1 * Math.sin(inst.clock * 1.9);

    /* 渐变 / 辉光 / 灵魂 的有效强度 */
    var tuning = dioramaTuning();
    var glowIntensity = tuning.glowEnabled ? tuning.glowIntensity : 0;
    var soulIntensity = tuning.soulEnabled ? tuning.soulIntensity : 0;
    var soulActiveEnabled = tuning.soulEnabled && tuning.soulActiveEnabled;
    var gradientIntensity = tuning.gradientEnabled ? tuning.gradientIntensity : 0;

    /* 关键字着色（本项目 wordColors 恒空 → 空 Map；按行 + 主题缓存） */
    var keywordUnitColors = new Map();
    if (tuning.keywordColoringEnabled) {
      var keywordKey = [
        inst.activeSegKey, globalIndex, inst.linesEpoch, inst.themeKey, unitCount
      ].join('|');
      if (keywordKey !== inst.keywordColorsKey) {
        inst.keywordColorsKey = keywordKey;
        inst.keywordColors = new Map();
        try {
          var matchers = dioramaPrepareKeywordMatchers(ctx.theme ? ctx.theme.wordColors : [], true);
          if (matchers.length) {
            inst.keywordColors = dioramaResolveKeywordUnitColors(
              activeLine.fullText, inst.activeUnits, matchers,
              inst.themeTargets.primary, inst.themeTargets.accent, inst.themeTargets.bg
            );
          }
        } catch (_) {}
      }
      keywordUnitColors = inst.keywordColors;
    }

    dioramaWriteActiveUnits(
      inst, now, life, breath,
      glowIntensity, soulIntensity, soulActiveEnabled, gradientIntensity, keywordUnitColors
    );
  }

  function dioramaWriteActiveUnits(inst, now, life, breath, glowIntensity,
    soulIntensity, soulActiveEnabled, gradientIntensity, keywordUnitColors) {
    var planes = inst.unitPlanes;
    var lightVals = inst.unitLightVals;
    var soulVals = inst.unitSoulVals;
    if (!planes.length || !lightVals || !soulVals) return;
    var delta = inst.lastDt;
    var damped = inst.damped;
    var units = inst.activeUnits;

    /* 退化调色板（accent ≈ primary）时把 sungTint 推向中性灰，否则染色不可见 */
    var tintSeparation = Math.abs(damped.accent.r - damped.primary.r)
      + Math.abs(damped.accent.g - damped.primary.g)
      + Math.abs(damped.accent.b - damped.primary.b);
    var sungTint = damped.accent.clone();
    if (tintSeparation < 0.4) {
      var deficit = 1 - tintSeparation / 0.4;
      var primaryLum = (damped.primary.r + damped.primary.g + damped.primary.b) / 3;
      var accentLum = (damped.accent.r + damped.accent.g + damped.accent.b) / 3;
      var targetLum = primaryLum > 0.5 ? accentLum * (1 - 0.5 * deficit) : accentLum + (1 - accentLum) * 0.55 * deficit;
      var neutral = new THREE.Color(targetLum, targetLum, targetLum);
      sungTint.lerp(neutral, deficit);
    }
    var gradientStrength = Math.min(1.5, gradientIntensity);
    var gradHot01 = dioramaClamp01((gradientStrength - 0.1) / 1.4);
    var gradDeep = sungTint.clone().multiplyScalar(0.8 - 0.18 * gradHot01);

    for (var i = 0; i < units.length; i += 1) {
      var unit = units[i];
      var entry = planes[i];
      if (!entry || !entry.base) continue;
      var isCurrent = now >= unit.startTime && now < unit.endTime;
      var sung = now >= unit.endTime;
      var span = Math.max(unit.endTime - unit.startTime, 0.001);
      var sungMix = sung ? 1 : (isCurrent ? dioramaClamp01((now - unit.startTime) / span) : 0);

      lightVals[i] = dioramaStepEnvelope(lightVals[i], isCurrent ? 1 : 0, 14, 4.5, delta);
      var gradientEnergy = dioramaResolveGradientEnergy(now, unit) * gradientStrength;

      entry.base.material.opacity = Math.min(
        1,
        (UNSUNG_UNIT_OPACITY + (ACTIVE_LINE_OPACITY - UNSUNG_UNIT_OPACITY) * sungMix
          + 0.08 * Math.min(1, gradientEnergy)) * life
      );

      var unitTarget = keywordUnitColors.get(i)
        || (gradientIntensity > 0 ? gradDeep : sungTint);
      var unitProgress = gradientIntensity > 0 ? gradientEnergy : lightVals[i] * 1.15;
      entry.base.material.color.copy(damped.primary).lerp(unitTarget, dioramaClamp01(unitProgress));

      /* 普通辉光：只读统一色，永不缩放 / 位移 */
      var glowStrength = Math.min(1.5, glowIntensity);
      var glowLevel = lightVals[i] * life * breath * (0.6 + 0.4 * inst.powerEnv) * glowStrength;
      entry.glow.material.opacity = Math.min(1, UNIT_GLOW_MAX_OPACITY * glowLevel);
      entry.glow.material.color.copy(entry.base.material.color);
      entry.glow.visible = glowLevel > 0.012;

      /* 灵魂出窍：唱着的字贴身在字上（受「当前字漂移」开关），唱完的字起飞 */
      soulVals[i] = dioramaStepEnvelope(soulVals[i], isCurrent ? 1 : 0, 12, 2.2, delta);
      var soulStrength = Math.min(1.5, soulIntensity);
      var flightMix = sung ? dioramaSmoothstep01(dioramaClamp01((now - unit.endTime) / SOUL_HANDOFF_SECONDS)) : 0;
      var activeReach = soulActiveEnabled ? soulStrength : 0;
      var onGlyph = (1 - flightMix) * activeReach;
      var flown = flightMix * soulStrength;
      entry.soul.material.color.copy(entry.base.material.color);
      entry.soul.material.opacity = Math.min(1, SOUL_MAX_OPACITY * life * soulVals[i] * (onGlyph + flown));
      entry.soul.position.y = LINE_FONT_SIZE * (SOUL_ACTIVE_LIFT_EM * onGlyph + SOUL_DETACH_LIFT_EM * flown);
      var soulSwell = 1 + SOUL_ACTIVE_SWELL * onGlyph + SOUL_DETACH_SWELL * flown;
      entry.soul.scale.set(soulSwell, soulSwell, 1);
      entry.soul.visible = entry.soul.material.opacity > 0.015;
    }
  }

  /* ---- 点阵层逐帧 ---- */
  function dioramaUpdateParticles(inst, ctx, globalIndex, delta) {
    var bands = ctx.audioBands || (ctx.audio && ctx.audio.bands) || {};
    var bassTarget = dioramaClamp01((Number(bands.bass) || 0) / 255);
    var midTarget = dioramaClamp01(((Number(bands.lowMid) || 0) * 0.5 + (Number(bands.mid) || 0) * 0.5) / 255);
    var trebleTarget = dioramaClamp01((Number(bands.treble) || 0) / 255);
    var bass = dioramaStepBandTracker(inst.trackers[0], bassTarget, delta);
    var mid = dioramaStepBandTracker(inst.trackers[1], midTarget, delta);
    var treble = dioramaStepBandTracker(inst.trackers[2], trebleTarget, delta);
    var response = dioramaResolveParticleAudioResponse(bass, mid);
    var gain = Math.max(0, inst.motion.audioLevel);

    var playbackTime = Math.max(0, Number(ctx.time) || 0);
    var previousPlaybackTime = inst.previousPlaybackTime;
    var playbackDelta = previousPlaybackTime == null ? 0 : playbackTime - previousPlaybackTime;
    var playbackDiscontinuity = previousPlaybackTime == null
      || playbackDelta < -0.05
      || playbackDelta > 0.5;
    if (playbackDiscontinuity) {
      inst.flowTime = playbackTime * 0.28;
      inst.ripples = dioramaCreateRipplePool();
    } else if (playbackDelta > 0) {
      inst.flowTime += playbackDelta * response.flowSpeed;
    }
    inst.previousPlaybackTime = playbackTime;

    var isCorridor = inst.particleMode === 'corridor';
    var readHeadAlong = globalIndex * CORRIDOR_UNITS_PER_LINE;
    if (gain > 0.001) {
      var signals = [bass, mid, treble];
      for (var b = 0; b < signals.length; b += 1) {
        if (signals[b].onset) {
          dioramaSpawnRipple(inst.ripples, b, signals[b].transient, inst.flowTime, isCorridor, readHeadAlong);
        }
      }
    }

    var elasticPulse = dioramaStepElasticResponse(
      inst.elastic,
      dioramaResolvePulseTarget(response.clusterPulse, gain, isCorridor),
      delta
    );

    inst.renderer.getDrawingBufferSize(inst.drawingSize);
    var colorAmount = 1 - Math.exp(-1.2 * delta);

    inst.lockedSeconds = inst.transition
      ? 0
      : Math.min(FORMATION_SETTLE_SECONDS, inst.lockedSeconds + delta);
    var formationTarget = !inst.transition && inst.lockedSeconds >= FORMATION_SETTLE_SECONDS ? 1 : 0;
    inst.formation = dioramaStepEnvelope(inst.formation, formationTarget, 1.5, 3.2, delta);

    var amplitude = gain * (isCorridor
      ? Math.min(CORRIDOR_MAX_SWELL, CORRIDOR_QUIET_SWELL + bass.sustained * 0.18 + mid.sustained * 0.08)
      : CLOUD_SWELL);
    var flow = isCorridor ? 1 : 0;
    var scatterDistance = isCorridor ? 6 : 1.4;
    var sizeBase = isCorridor ? 0.072 : 0.05;
    var sizeGain = isCorridor ? 0.34 : 0.3;
    var centroid = Math.min(1, 0.2 + treble.sustained * 0.8);

    var targets = [];
    if (inst.particleMaterial) targets.push(inst.particleMaterial);
    if (inst.particleGlowMaterial && dioramaTuning().particleGlowEnabled) targets.push(inst.particleGlowMaterial);
    for (var m = 0; m < targets.length; m += 1) {
      var u = targets[m].uniforms;
      u.uTime.value = inst.flowTime;
      u.uCorridor.value = isCorridor ? 1 : 0;
      u.uAmplitude.value = amplitude;
      u.uMaxSwell.value = isCorridor ? CORRIDOR_MAX_SWELL_REACH : CLOUD_MAX_SWELL;
      u.uWaveNumberMax.value = inst.particleWaveNumberMax;
      u.uDetail.value = Math.min(1, treble.sustained * gain);
      u.uRippleSource.value = inst.ripples.sources;
      u.uRippleShape.value = inst.ripples.shapes;
      u.uOffsetGain.value = mid.sustained * gain;
      u.uFlow.value = flow;
      u.uFormation.value = inst.formation;
      u.uScatter.value = scatterDistance;
      u.uSizeBase.value = sizeBase;
      u.uSizeGain.value = sizeGain;
      u.uPulse.value = elasticPulse;
      u.uSpectralCentroid.value = centroid;
      u.uViewportHeight.value = inst.drawingSize.y;
      if (inst.particleColors) {
        dioramaLerpParticleMaterialColors(targets[m], inst.particleColors, colorAmount);
      }
    }
    if (inst.particleGlow) inst.particleGlow.visible = !!dioramaTuning().particleGlowEnabled;
    if (inst.particleContrast) inst.particleContrast.visible = inst.particlePointCount > 0;
  }

  /* ---- 镜头 ---- */
  var UP_VEC = new THREE.Vector3(0, 1, 0);
  var _alignRight = new THREE.Vector3();
  var _alignUp = new THREE.Vector3();
  var _alignFwd = new THREE.Vector3();
  var _alignMatrix = new THREE.Matrix4();
  var _alignQuat = new THREE.Quaternion();
  var _lookQuat = new THREE.Quaternion();
  var _targetQuat = new THREE.Quaternion();
  var _viewDir = new THREE.Vector3();
  var _camForward = new THREE.Vector3();
  var _flightTo = new THREE.Vector3();

  function dioramaUpdateCamera(inst, ctx, resolved, line, aspect, fov, delta) {
    if (!resolved) return;
    var cam = inst.camera;
    var camera = inst.camera3d;
    var now = Number(ctx.time) || 0;
    var timeline = inst.activeTimeline;
    var wordProgress = line ? dioramaResolveWordProgress(line, timeline, now) : 0;
    var progress = line ? 1 : 0;
    if (line) {
      var renderEndTime = dioramaLineRenderEndTime(line);
      var spanP = renderEndTime - line.startTime;
      progress = spanP > 0 ? dioramaClamp01((now - line.startTime) / spanP) : (now >= line.startTime ? 1 : 0);
    }

    var visibleHalf = dioramaFrameHalfWidth(DIORAMA_HERO_DISTANCE, fov, aspect) * DIORAMA_SAFE_FRAME_FRACTION;
    var frame = resolved.frame;
    var R = frame.right;
    var U = frame.up;
    var F = frame.forward;
    var placement = inst.activePlacement || dioramaTextPlacement(
      resolved.localIndex, resolved.segment.seed, inst.motion.weaveScale
    );

    var settle = line ? dioramaResolveHoldSettle(now - dioramaLineRenderEndTime(line)) : 1;

    var truck = dioramaResolveReadHeadTruck(wordProgress, inst.activeLineWidth, visibleHalf) * settle;
    var headR = placement.offsetR + truck;
    var headU = placement.offsetU;
    var baseX = frame.position.x + R.x * headR + U.x * headU;
    var baseY = frame.position.y + R.y * headR + U.y * headU;
    var baseZ = frame.position.z + R.z * headR + U.z * headU;

    var shotSeed = resolved.segment.seed;
    var shot = dioramaResolveShotOffset(inst.activeShot, {
      progress: progress,
      wordProgress: wordProgress,
      hero: DIORAMA_HERO_DISTANCE,
      lift: DIORAMA_CAMERA_LIFT,
      seed: shotSeed,
      lineIndex: resolved.localIndex,
      moveScale: inst.motion.moveScale * settle
    });
    var drift = dioramaResolveCameraDrift(now, shotSeed, inst.motion.driftScale);
    var offRight = shot.right + drift.swayX;
    var offUp = shot.up + drift.swayY + drift.lift;
    var offBack = shot.back + drift.dist;
    var poseX = baseX + R.x * offRight + U.x * offUp - F.x * offBack;
    var poseY = baseY + R.y * offRight + U.y * offUp - F.y * offBack;
    var poseZ = baseZ + R.z * offRight + U.z * offUp - F.z * offBack;
    inst.pose = { x: poseX, y: poseY, z: poseZ };

    /* 切歌飞行：拉长 smooth-time + 垂直弧 + 侧扫 + 侧倾 */
    var flight = cam.flight;
    if (inst.transitionEpoch !== flight.epoch && inst.transitionEpoch > 0) {
      flight.epoch = inst.transitionEpoch;
      flight.flying = true;
      flight.start = inst.clock;
      _flightTo.set(poseX, poseY, poseZ);
      var perp = dioramaFlightPerp(
        { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z },
        { x: poseX, y: poseY, z: poseZ }
      );
      flight.perp.set(perp.x, perp.y, perp.z);
      flight.side = dioramaFlightSide(shotSeed, inst.transitionEpoch);
      flight.flightLen = cam.pos.distanceTo(_flightTo);
    }
    var flying = false;
    var te = 1;
    if (flight.flying) {
      te = (inst.clock - flight.start) / TRANSITION_DURATION;
      if (te >= 1) flight.flying = false;
      else flying = true;
    }
    var followSmooth = flying
      ? FLIGHT_SMOOTH_TIME + (inst.motion.smoothTime - FLIGHT_SMOOTH_TIME) * dioramaTransitionEase(te)
      : inst.motion.smoothTime;
    var swayEnv = flying ? Math.pow(Math.sin(Math.PI * te), 2) : 0;
    var arcMag = swayEnv * flight.flightLen * FLIGHT_ARC_FRAC;
    var sweepMag = swayEnv * flight.flightLen * TRANSITION_AIM_SWEEP * flight.side;
    var bank = swayEnv * TRANSITION_BANK * flight.side;

    var posGap = Math.hypot(poseX - cam.pos.x, poseY - cam.pos.y, poseZ - cam.pos.z);
    var snapped = !flying && posGap > DIORAMA_SNAP_DISTANCE;
    if (snapped) {
      cam.pos.set(poseX, poseY, poseZ);
      cam.posVel.set(0, 0, 0);
    } else {
      var sx = dioramaSmoothDamp(cam.pos.x, poseX, cam.posVel.x, followSmooth, delta);
      var sy = dioramaSmoothDamp(cam.pos.y, poseY, cam.posVel.y, followSmooth, delta);
      var sz = dioramaSmoothDamp(cam.pos.z, poseZ, cam.posVel.z, followSmooth, delta);
      cam.pos.set(sx.value, sy.value, sz.value);
      cam.posVel.set(sx.velocity, sy.velocity, sz.velocity);
    }
    camera.position.set(
      cam.pos.x + flight.perp.x * arcMag,
      cam.pos.y + flight.perp.y * arcMag + arcMag * 0.5,
      cam.pos.z + flight.perp.z * arcMag
    );

    var lookOff = placement.lookR * settle;
    var lookX = baseX + R.x * lookOff + flight.perp.x * sweepMag;
    var lookY = baseY + R.y * lookOff + flight.perp.y * sweepMag;
    var lookZ = baseZ + R.z * lookOff + flight.perp.z * sweepMag;
    var lookGap = Math.hypot(lookX - cam.look.x, lookY - cam.look.y, lookZ - cam.look.z);
    if (!flying && lookGap > DIORAMA_SNAP_DISTANCE) {
      cam.look.set(lookX, lookY, lookZ);
      cam.lookVel.set(0, 0, 0);
    } else {
      var lx = dioramaSmoothDamp(cam.look.x, lookX, cam.lookVel.x, followSmooth, delta);
      var ly = dioramaSmoothDamp(cam.look.y, lookY, cam.lookVel.y, followSmooth, delta);
      var lz = dioramaSmoothDamp(cam.look.z, lookZ, cam.lookVel.z, followSmooth, delta);
      cam.look.set(lx.value, ly.value, lz.value);
      cam.lookVel.set(lx.velocity, ly.velocity, lz.velocity);
    }

    camera.up.copy(UP_VEC);
    camera.lookAt(cam.look);

    /* 读数对齐（回正） */
    _alignRight.set(R.x, R.y, R.z);
    _alignUp.set(U.x, U.y, U.z);
    _alignFwd.set(-F.x, -F.y, -F.z);
    _alignMatrix.makeBasis(_alignRight, _alignUp, _alignFwd);
    _alignQuat.setFromRotationMatrix(_alignMatrix);
    if (placement.yaw) _alignQuat.multiply(_tiltQuat.setFromAxisAngle(_axisY, placement.yaw));
    if (placement.roll) _alignQuat.multiply(_tiltQuat.setFromAxisAngle(_axisZ, placement.roll));
    if (snapped || !cam.alignQuatInit) {
      cam.alignQuat.copy(_alignQuat);
      cam.alignQuatInit = true;
    } else {
      cam.alignQuat.slerp(_alignQuat, 1 - Math.exp(-ALIGN_TURN_RATE * delta));
    }

    var readTarget = 0;
    if (line) {
      var renderEnd = dioramaLineRenderEndTime(line);
      var rampIn = dioramaSmoothstep01((now - (line.startTime - ALIGN_LEAD_IN)) / (ALIGN_LEAD_IN + ALIGN_SETTLE));
      var rampOut = 1 - dioramaSmoothstep01((now - renderEnd) / ALIGN_RELEASE);
      var ceiling = ALIGN_SHOT_CEILING[inst.activeShot] !== undefined ? ALIGN_SHOT_CEILING[inst.activeShot] : 0.7;
      readTarget = Math.min(rampIn, rampOut) * ceiling;
    }
    cam.align += (readTarget - cam.align) * (1 - Math.exp(-ALIGN_RATE * delta));

    _lookQuat.copy(camera.quaternion);
    _targetQuat.copy(_lookQuat).slerp(cam.alignQuat, cam.align);

    _viewDir.subVectors(cam.look, camera.position).normalize();
    _camForward.set(0, 0, -1).applyQuaternion(_targetQuat);
    var offAxisAngle = _camForward.angleTo(_viewDir);
    var halfV = THREE.MathUtils.degToRad(fov) / 2;
    var halfH = Math.atan(Math.tan(halfV) * aspect);
    var maxOffAxis = Math.min(halfV, halfH) * FRAME_KEEP_FRACTION;
    if (offAxisAngle > maxOffAxis) {
      _targetQuat.slerp(_lookQuat, 1 - maxOffAxis / offAxisAngle);
    }

    if (snapped || !cam.orientInit) {
      cam.orient.copy(_targetQuat);
      cam.orientInit = true;
    } else {
      cam.orient.slerp(_targetQuat, 1 - Math.exp(-ORIENT_FOLLOW_RATE * delta));
    }
    camera.quaternion.copy(cam.orient);
    if (bank) camera.rotateZ(bank);
  }

  /* ---- destroy ---- */
  function dioramaDestroy(inst) {
    if (!inst) return;
    try {
      dioramaDisposeUnitPlanes(inst);
      dioramaDisposeLineMeshes(inst);
      dioramaDisposeParticles(inst);
      if (inst.lineRasters && inst.lineRasters.rasters) {
        inst.lineRasters.rasters.forEach(function (raster) { raster.texture.dispose(); });
        inst.lineRasters.rasters.clear();
      }
      if (inst.motePoints) {
        if (inst.motePoints.geometry) inst.motePoints.geometry.dispose();
        if (inst.moteMaterial) inst.moteMaterial.dispose();
        if (inst.motePoints.parent) inst.motePoints.parent.remove(inst.motePoints);
      }
      if (inst.subtitle && typeof inst.subtitle.destroy === 'function') inst.subtitle.destroy();
      if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
      if (inst.renderer) {
        inst.renderer.dispose();
        if (inst.renderer.domElement && inst.renderer.domElement.parentNode) {
          inst.renderer.domElement.parentNode.removeChild(inst.renderer.domElement);
        }
      }
    } catch (_) {}
  }

  /* ---- debug ---- */
  function dioramaDebugState(inst) {
    var segs = inst.seq.segments.map(function (seg) {
      return {
        key: seg.key,
        seed: String(seg.seed),
        span: seg.span,
        globalStart: seg.globalStart,
        linesEpoch: seg.linesEpoch
      };
    });
    var structure = inst.structure;
    var visible = [];
    if (structure) {
      structure.visibleLines.forEach(function (entry) {
        var record = inst.lineMeshes.get(entry.index);
        visible.push({
          index: entry.index,
          position: entry.position,
          quaternion: entry.quaternion,
          isOutgoing: entry.isOutgoing,
          placement: {
            offsetR: entry.placement.offsetR,
            offsetU: entry.placement.offsetU,
            scale: entry.placement.scale,
            roll: entry.placement.roll,
            yaw: entry.placement.yaw,
            lookR: entry.placement.lookR
          },
          opacity: record ? record.mesh.material.opacity : null,
          scale: record ? record.mesh.scale.x : null,
          worldWidth: record ? (record.raster.advancePx * (LINE_FONT_SIZE / record.raster.fontPx)) : null,
          color: record ? [
            record.mesh.material.color.r,
            record.mesh.material.color.g,
            record.mesh.material.color.b
          ] : null,
          raster: inst.lineRasters.rasters.has(entry.index)
        });
      });
    }
    var units = [];
    if (inst.unitPlanes && inst.unitPlanes.length) {
      for (var i = 0; i < inst.unitPlanes.length; i += 1) {
        var entry = inst.unitPlanes[i];
        if (!entry.base) continue;
        units.push({
          text: inst.activeUnits && inst.activeUnits[i] ? inst.activeUnits[i].text : '',
          startTime: inst.activeUnits && inst.activeUnits[i] ? inst.activeUnits[i].startTime : null,
          endTime: inst.activeUnits && inst.activeUnits[i] ? inst.activeUnits[i].endTime : null,
          centerX: entry.base.position.x,
          width: entry.base.geometry.parameters.width,
          height: entry.base.geometry.parameters.height,
          baseOpacity: entry.base.material.opacity,
          baseColor: [
            entry.base.material.color.r,
            entry.base.material.color.g,
            entry.base.material.color.b
          ],
          glowOpacity: entry.glow.material.opacity,
          glowVisible: entry.glow.visible,
          glowX: entry.glow.position.x,
          glowY: entry.glow.position.y,
          glowColor: [
            entry.glow.material.color.r,
            entry.glow.material.color.g,
            entry.glow.material.color.b
          ],
          soulOpacity: entry.soul.material.opacity,
          soulVisible: entry.soul.visible,
          soulY: entry.soul.position.y,
          soulX: entry.soul.position.x,
          lightVal: inst.unitLightVals ? inst.unitLightVals[i] : null,
          soulVal: inst.unitSoulVals ? inst.unitSoulVals[i] : null
        });
      }
    }
    var cam = inst.camera;
    return {
      seed: inst.gate.committedSeed,
      instrumental: inst.gate.committedLines.length === 0,
      activeGlobalIndex: inst.activeGlobalIndex,
      activeLocalIndex: inst.activeLocalIndex,
      total: dioramaTotalGlobalLines(inst.seq),
      segments: segs,
      transition: inst.transition
        ? {
          epoch: inst.transition.epoch,
          outgoingIndex: inst.transition.outgoingIndex,
          elapsed: inst.transitionElapsed
        }
        : null,
      camera: {
        x: inst.camera3d.position.x, y: inst.camera3d.position.y, z: inst.camera3d.position.z,
        lookX: cam.look.x, lookY: cam.look.y, lookZ: cam.look.z,
        fov: inst.camera3d.fov, aspect: inst.camera3d.aspect,
        pose: inst.pose || null,
        align: cam.align,
        flying: cam.flight.flying,
        flightLen: cam.flight.flightLen
      },
      mounted: structure ? structure.mountedIndices : [],
      visible: visible,
      active: {
        lineText: inst.activeLineText,
        unitCount: inst.activeUnits ? inst.activeUnits.length : 0,
        units: units,
        lineWidth: inst.activeLineWidth,
        groupScale: inst.unitGroup ? inst.unitGroup.scale.x : null
      },
      motes: {
        circumference: inst.moteCircumference,
        radial: inst.moteRadial,
        written: inst.moteWritten.slice(),
        points: inst.motePositions.length / 3
      },
      particles: {
        mode: inst.particleMode,
        pointCount: inst.particlePointCount,
        pointsPerUnit: inst.particlePointsPerUnit,
        waveNumberMax: inst.particleWaveNumberMax,
        spacing: inst.particleSpacing,
        formation: inst.formation,
        flowTime: inst.flowTime,
        ripplesSpawned: inst.ripples.spawned,
        clusters: inst.particleClusters.length,
        spans: inst.corridorSpans.length,
        uniforms: inst.particleMaterial ? {
          uAmplitude: inst.particleMaterial.uniforms.uAmplitude.value,
          uMaxSwell: inst.particleMaterial.uniforms.uMaxSwell.value,
          uWaveNumberMax: inst.particleMaterial.uniforms.uWaveNumberMax.value,
          uCorridor: inst.particleMaterial.uniforms.uCorridor.value,
          uTime: inst.particleMaterial.uniforms.uTime.value,
          uFormation: inst.particleMaterial.uniforms.uFormation.value,
          uSizeBase: inst.particleMaterial.uniforms.uSizeBase.value,
          uSizeGain: inst.particleMaterial.uniforms.uSizeGain.value,
          uViewportHeight: inst.particleMaterial.uniforms.uViewportHeight.value,
          uPrimaryColor: [
            inst.particleMaterial.uniforms.uPrimaryColor.value.r,
            inst.particleMaterial.uniforms.uPrimaryColor.value.g,
            inst.particleMaterial.uniforms.uPrimaryColor.value.b
          ]
        } : null
      },
      fog: {
        near: inst.scene.fog ? inst.scene.fog.near : null,
        far: inst.scene.fog ? inst.scene.fog.far : null
      },
      fontSpec: inst.fontSpec,
      rasters: inst.lineRasters.rasters.size,
      shot: inst.activeShot,
      motion: {
        moveScale: inst.motion ? inst.motion.moveScale : null,
        weaveScale: inst.motion ? inst.motion.weaveScale : null,
        smoothTime: inst.motion ? inst.motion.smoothTime : null,
        audioLevel: inst.motion ? inst.motion.audioLevel : null,
        subMode: inst.motion ? inst.motion.subMode : null
      },
      drawCalls: inst.renderer && inst.renderer.info ? inst.renderer.info.render.calls : null,
      points: inst.renderer && inst.renderer.info ? inst.renderer.info.render.points : null,
      viewport: [inst.viewWidth || 0, inst.viewHeight || 0],
      failReason: ''
    };
  }

  /* ============================== 14. 注册 ============================== */

  registerFoliaMode('diorama', {
    name: '镜台',
    desc: '点阵化的文字在 3D 空间里穿行，镜头跟着歌词运镜',
    order: 120,
    create: dioramaCreate,
    tick: dioramaTick,
    destroy: dioramaDestroy
  });
})();
