/* Folia 背景 — 通用（common）：主题纯色底 + 几何图形 + 浮尘 + 暗角
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/common/）：
 *   entry.tsx（89）              → mode 'common' / order 10 / 纯色底 + 可选取色底 + 几何层
 *   GeometricBackground.tsx（433）→ 15 个图形 + 20 个浮尘 + 暗角，按频段做弹簧缩放
 *   FluidBackground.tsx（404）    → 「用封面取色」时的流体渐变（useCoverColorBg=true 才挂）
 *
 * 必须照抄的判据
 * --------------
 * 1. 数量与范围**逐条照抄**（GeometricBackground.tsx:303-344）：
 *    图形 15 个，size 40~140，duration 30~60（图标 20~40），delay 0~5，
 *    opacity 0.11~0.19，reverse 五成，filled 三成，initialRotation 0~360；
 *    浮尘 20 个，size 1~5，left/top 0~100%，opacity 0~0.3，duration 15~35，delay 0~10。
 * 2. 形状 → 频段：circle→bass / square→lowMid / triangle→mid / cross→treble / icon→vocal。
 * 3. 弹簧缩放：useSpring(stiffness 300, damping 30) + useTransform([10,200] → [0.95,1.45])。
 * 4. 动画语言：y 30→-30→30、x -15→15→-15（reverse 取反）、rotate 恒定 +360°/周期、线性无限；
 *    浮尘 y 0→-100px、opacity 0→op→0。暂停时切成**静态场景**（图形停在初始位置与初始角度）。
 * 5. 配色：图形用 secondaryColor（圆/方未填充时是 1px 描边，其余实心），浮尘与图标用 accentColor，
 *    底色用 backgroundColor；暗角是 radial-gradient(transparent 40%, rgba(0,0,0,.6) 100%)。
 *
 * 与 Folia 的实现差异（都不是视觉差异）
 * ------------------------------------
 * 1. 没有 framer-motion：位移/旋转/上浮交给 CSS keyframes（不占 JS 帧），
 *    只有「跟音频的弹簧缩放」每帧在世界 tick 里算（唯一需要 JS 的部分）。
 * 2. 随机源换成「按 seed 播种」的 mulberry32：Folia 用 Math.random，每次挂载都换一套布局；
 *    这里同一首歌每次进来图形位置一致（可断言、可复现），视觉语言不变。
 * 3. 频段是 0..1（本项目 11-main-loop 的归一化值），Folia 是 0..255。
 *    [10,200] 的阈值按 /255 换算后等价，见 FOLIA_BAND_SCALE。
 * 4. 本项目主题没有 lyricsIcons，图标分支不会触发（Folia 在空 lyricsIcons 时同样全走几何形状）。
 * 5. 「用封面取色」(useCoverColorBg) 与 FluidBackground 本轮不做：默认 false 时它本来就不挂。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaBackground !== 'function') return;

  var SHAPE_COUNT = 15;
  var PARTICLE_COUNT = 20;
  var SHAPE_TYPES = ['circle', 'square', 'triangle', 'cross'];

  /* framer 的 useSpring 参数（stiffness / damping，质量 1）。 */
  var SPRING_K = 300;
  var SPRING_C = 30;
  /* Folia 的频段是 0..255，本项目是 0..1：阈值按 /255 换算。 */
  var FOLIA_BAND_SCALE = 255;
  var BAND_MIN = 10 / FOLIA_BAND_SCALE;
  var BAND_MAX = 200 / FOLIA_BAND_SCALE;
  var SCALE_MIN = 0.95;
  var SCALE_MAX = 1.45;

  var CROSS_CLIP = 'polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)';

  /* ---- tuning：CommonBackgroundSettingsCard.tsx 可移植的两项 ----
   * disableVignette（默认 false）→ VignetteOverlay disabled，不渲染暗角节点；
   * disableGeometricBackground（默认 false）→ GeometricBackground.tsx:109 的 !hideShapes，
   *   **同时包住 shapes 与 particles 两个 map**（浮尘跟着图形一起藏），只留纯色底与暗角。
   * useCoverColorBg / opacity 依赖未移植的 FluidBackground，不做。 */
  var COMMON_TUNING_STORE_KEY = 'mineradio-folia-common-tuning-v1';

  var COMMON_TUNING_DEFAULT = { disableVignette: false, disableGeometricBackground: false };

  function foliaCommonNormalizeTuning(value) {
    var raw = (value && typeof value === 'object') ? value : {};
    return {
      disableVignette: typeof raw.disableVignette === 'boolean' ? raw.disableVignette : COMMON_TUNING_DEFAULT.disableVignette,
      disableGeometricBackground: typeof raw.disableGeometricBackground === 'boolean'
        ? raw.disableGeometricBackground
        : COMMON_TUNING_DEFAULT.disableGeometricBackground,
    };
  }

  var foliaCommonTuningCache = null;

  function foliaCommonTuning() {
    if (foliaCommonTuningCache) return foliaCommonTuningCache;
    var raw = null;
    try {
      var text = window.localStorage ? window.localStorage.getItem(COMMON_TUNING_STORE_KEY) : null;
      if (text) raw = JSON.parse(text);
    } catch (_) { raw = null; }
    foliaCommonTuningCache = foliaCommonNormalizeTuning(raw);
    return foliaCommonTuningCache;
  }

  /* 面板写入口（0l-folia-tuning-panel.js）：语义与 latent/sora 一致，改完由面板重建。 */
  function foliaCommonSetTuning(patch) {
    var merged = {};
    var base = foliaCommonTuning();
    var k;
    for (k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
    }
    if (patch) {
      for (k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
      }
    }
    foliaCommonTuningCache = foliaCommonNormalizeTuning(merged);
    return foliaCommonTuningCache;
  }

  function foliaCommonSaveTuning() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(COMMON_TUNING_STORE_KEY, JSON.stringify(foliaCommonTuning()));
      }
    } catch (_) {}
  }

  function foliaCommonResetTuning() {
    foliaCommonTuningCache = foliaCommonNormalizeTuning(null);
    foliaCommonSaveTuning();
  }

  window.foliaCommonTuning = foliaCommonTuning;
  window.foliaCommonSetTuning = foliaCommonSetTuning;
  window.foliaCommonSaveTuning = foliaCommonSaveTuning;
  window.foliaCommonResetTuning = foliaCommonResetTuning;

  /* ---- 确定性随机 ---- */

  function foliaCommonSeed(text) {
    var hash = 2166136261;
    var str = String(text == null ? '' : text);
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function foliaCommonRng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* GeometricBackground.tsx:303-332 —— 范围逐条照抄。 */
  function foliaCommonBuildShapes(rng, icons) {
    var shapes = [];
    var iconCount = 0;
    var availableIcons = icons || [];
    for (var index = 0; index < SHAPE_COUNT; index++) {
      var wantIcon = availableIcons.length > 0 && rng() > 0.7;
      var useIcon = wantIcon && iconCount < 6;
      if (useIcon) iconCount += 1;
      var iconName = useIcon ? availableIcons[Math.floor(rng() * availableIcons.length)] : null;
      shapes.push({
        id: index,
        type: useIcon ? 'icon' : SHAPE_TYPES[Math.floor(rng() * SHAPE_TYPES.length)],
        iconName: iconName,
        initialX: rng() * 100,
        initialY: rng() * 100,
        size: 40 + rng() * 100,
        duration: useIcon ? 20 + rng() * 20 : 30 + rng() * 30,
        delay: rng() * 5,
        opacity: 0.11 + rng() * 0.08,
        reverse: rng() > 0.5,
        filled: rng() < 0.3,
        initialRotation: rng() * 360,
      });
    }
    return shapes;
  }

  /* GeometricBackground.tsx:334-344 —— 范围逐条照抄。 */
  function foliaCommonBuildParticles(rng) {
    var list = [];
    for (var index = 0; index < PARTICLE_COUNT; index++) {
      list.push({
        id: index,
        size: rng() * 4 + 1,
        left: rng() * 100,
        top: rng() * 100,
        opacity: rng() * 0.3,
        duration: 15 + rng() * 20,
        delay: rng() * 10,
      });
    }
    return list;
  }

  /* GeometricBackground.tsx:46-61 */
  function foliaCommonScaleKey(type) {
    if (type === 'circle') return 'bass';
    if (type === 'square') return 'lowMid';
    if (type === 'triangle') return 'mid';
    if (type === 'cross') return 'treble';
    if (type === 'icon') return 'vocal';
    return 'default';
  }

  function foliaCommonShapeStyle(shape, theme) {
    var secondary = (theme && theme.secondaryColor) || '#ffffff';
    var useStroke = (shape.type === 'circle' || shape.type === 'square') && !shape.filled;
    return {
      border: useStroke ? '1px solid ' + secondary : 'none',
      background: useStroke ? 'transparent' : secondary,
      borderRadius: shape.type === 'circle' ? '50%' : '0%',
      clipPath: shape.type === 'triangle'
        ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
        : (shape.type === 'cross' ? CROSS_CLIP : 'none'),
      opacity: String(shape.opacity),
    };
  }

  /* ---- DOM ---- */

  function foliaCommonEl(cls) {
    var node = document.createElement('div');
    node.className = cls;
    return node;
  }

  function foliaCommonApplyTheme(inst, theme) {
    inst.theme = theme || {};
    if (inst.solid) inst.solid.style.backgroundColor = inst.theme.backgroundColor || '#05070b';
    var particleColor = inst.theme.accentColor || '#ffffff';
    for (var p = 0; p < inst.particleNodes.length; p++) {
      inst.particleNodes[p].style.backgroundColor = particleColor;
    }
    for (var i = 0; i < inst.shapeNodes.length; i++) {
      var face = inst.shapeNodes[i].face;
      var style = foliaCommonShapeStyle(inst.shapes[i], inst.theme);
      face.style.border = style.border;
      face.style.background = style.background;
      face.style.borderRadius = style.borderRadius;
      face.style.clipPath = style.clipPath;
      face.style.opacity = style.opacity;
    }
  }

  function foliaCommonBuildLayer(inst) {
    var layer = inst.layer;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    inst.shapeNodes = [];
    inst.particleNodes = [];

    for (var i = 0; i < inst.shapes.length; i++) {
      var shape = inst.shapes[i];
      var holder = foliaCommonEl('folia-bg-shape');
      holder.style.left = shape.initialX + '%';
      holder.style.top = shape.initialY + '%';
      holder.style.width = shape.size + 'px';
      holder.style.height = shape.size + 'px';

      var drift = foliaCommonEl('folia-bg-drift');
      /* 非 reverse：x -15 → 15、y 30 → -30；reverse 取反（GeometricBackground.tsx:248-249）。 */
      drift.style.setProperty('--sx', (shape.reverse ? 15 : -15) + 'px');
      drift.style.setProperty('--sy', (shape.reverse ? -30 : 30) + 'px');
      drift.style.animationDuration = shape.duration + 's';
      drift.style.animationDelay = shape.delay + 's';

      var spin = foliaCommonEl('folia-bg-spin');
      spin.style.setProperty('--rot', shape.initialRotation + 'deg');
      spin.style.animationDuration = shape.duration + 's';
      spin.style.animationDelay = shape.delay + 's';

      var face = foliaCommonEl('folia-bg-face');
      spin.appendChild(face);
      drift.appendChild(spin);
      holder.appendChild(drift);
      layer.appendChild(holder);

      inst.shapeNodes.push({ holder: holder, drift: drift, spin: spin, face: face });
    }

    for (var j = 0; j < inst.particles.length; j++) {
      var particle = inst.particles[j];
      var dot = foliaCommonEl('folia-bg-particle');
      dot.style.width = particle.size + 'px';
      dot.style.height = particle.size + 'px';
      dot.style.left = particle.left + '%';
      dot.style.top = particle.top + '%';
      dot.style.setProperty('--op', String(particle.opacity));
      dot.style.animationDuration = particle.duration + 's';
      dot.style.animationDelay = particle.delay + 's';
      layer.appendChild(dot);
      inst.particleNodes.push(dot);
    }
  }

  function foliaCommonCreate(host, ctx) {
    var tuning = foliaCommonTuning();
    var root = foliaCommonEl('folia-bg-common');
    var solid = foliaCommonEl('folia-bg-solid');
    var layer = foliaCommonEl('folia-bg-geometric');
    var vignette = null;
    root.appendChild(solid);
    root.appendChild(layer);
    /* GeometricBackground.tsx:165 —— VignetteOverlay disabled 时不渲染。 */
    if (!tuning.disableVignette) {
      vignette = foliaCommonEl('folia-bg-vignette');
      root.appendChild(vignette);
    }
    host.appendChild(root);

    var inst = {
      root: root,
      solid: solid,
      layer: layer,
      vignette: vignette,
      shapes: [],
      particles: [],
      shapeNodes: [],
      particleNodes: [],
      seed: null,
      theme: null,
      spring: {
        bass: { x: 1, v: 0 },
        lowMid: { x: 1, v: 0 },
        mid: { x: 1, v: 0 },
        vocal: { x: 1, v: 0 },
        treble: { x: 1, v: 0 },
        default: { x: 1, v: 0 },
      },
      paused: null,
      destroyed: false,
    };

    var theme = (ctx && ctx.theme) || {};
    var seedText = (ctx && ctx.seed != null && ctx.seed !== '') ? String(ctx.seed) : 'default';
    inst.seed = seedText;
    var rng = foliaCommonRng(foliaCommonSeed(seedText));
    /* GeometricBackground.tsx:109 —— !hideShapes 同时包住 shapes 与 particles。 */
    var hideShapes = foliaCommonShapesHidden(tuning);
    inst.shapes = hideShapes ? [] : foliaCommonBuildShapes(rng, theme.lyricsIcons || []);
    inst.particles = hideShapes ? [] : foliaCommonBuildParticles(rng);
    foliaCommonBuildLayer(inst);
    foliaCommonApplyTheme(inst, theme);
    foliaCommonSetPaused(inst, !!(ctx && ctx.paused));
    return inst;
  }

  /* 暂停 = Folia 的 StaticGeometricScene：动画全停，图形停在初始位置与初始角度。 */
  function foliaCommonSetPaused(inst, paused) {
    if (inst.paused === paused) return;
    inst.paused = paused;
    if (paused) inst.root.classList.add('is-paused');
    else inst.root.classList.remove('is-paused');
  }

  /* 有效「隐藏几何图形」判据：common 自己的开关，或**当前样式是浮名且它自己的开关也开着**
   * （Folia VisualizerFume.tsx:308 把 fume 的值 OR 到共享背景的 common 上；
   *  fume 的默认值就是 true，所以切到浮名时几何图形默认不画）。
   * 背景实例只在创建 / 重建时读一次，所以浮名那边改这个开关时会调 foliaWorldRebuildBackground。 */
  function foliaCommonShapesHidden(tuning) {
    if (tuning && tuning.disableGeometricBackground) return true;
    if (typeof foliaWorld === 'undefined' || !foliaWorld || foliaWorld.mode !== 'fume') return false;
    var fume = (typeof foliaModeTuning === 'function') ? foliaModeTuning('fume') : null;
    return !!(fume && fume.disableGeometricBackground);
  }

  function foliaCommonRebuild(inst, ctx) {
    var theme = (ctx && ctx.theme) || {};
    var seedText = (ctx && ctx.seed != null && ctx.seed !== '') ? String(ctx.seed) : 'default';
    inst.seed = seedText;
    var rng = foliaCommonRng(foliaCommonSeed(seedText));
    var tuning = foliaCommonTuning();
    var hideShapes = foliaCommonShapesHidden(tuning);
    inst.shapes = hideShapes ? [] : foliaCommonBuildShapes(rng, theme.lyricsIcons || []);
    inst.particles = hideShapes ? [] : foliaCommonBuildParticles(rng);
    foliaCommonBuildLayer(inst);
    foliaCommonApplyTheme(inst, theme);
  }

  /* useTransform([10,200] → [0.95,1.45])，输入按 0..255 换算到本项目的 0..1。 */
  function foliaCommonScaleOf(band) {
    var value = Number(band);
    if (!isFinite(value)) return SCALE_MIN;
    var t = (value - BAND_MIN) / (BAND_MAX - BAND_MIN);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return SCALE_MIN + t * (SCALE_MAX - SCALE_MIN);
  }

  /* framer 的弹簧：v += (k·(target−x) − c·v)·dt，x += v·dt。dt 封顶 1/30 保证数值稳定。 */
  function foliaCommonStepSpring(spring, target, dt) {
    var step = dt > 1 / 30 ? 1 / 30 : (dt > 0 ? dt : 0);
    if (!(step > 0)) return spring.x;
    spring.v += (SPRING_K * (target - spring.x) - SPRING_C * spring.v) * step;
    spring.x += spring.v * step;
    return spring.x;
  }

  function foliaCommonTick(inst, ctx) {
    if (!inst || inst.destroyed) return;
    var theme = (ctx && ctx.theme) || null;
    if (theme && theme !== inst.theme) {
      /* 颜色就地改（Folia 的 memo 只重渲染样式，不重排布局）。 */
      foliaCommonApplyTheme(inst, theme);
    }
    var seedText = (ctx && ctx.seed != null && ctx.seed !== '') ? String(ctx.seed) : 'default';
    if (seedText !== inst.seed) foliaCommonRebuild(inst, ctx);

    foliaCommonSetPaused(inst, !!(ctx && ctx.paused));
    if (inst.paused) return;

    var dt = (ctx && isFinite(ctx.dt)) ? Number(ctx.dt) : 0;
    var bands = (ctx && ctx.audioBands) || {};
    var targets = {
      bass: foliaCommonScaleOf(bands.bass),
      lowMid: foliaCommonScaleOf(bands.lowMid),
      mid: foliaCommonScaleOf(bands.mid),
      vocal: foliaCommonScaleOf(bands.vocal),
      treble: foliaCommonScaleOf(bands.treble),
      default: foliaCommonScaleOf(ctx && ctx.audio ? ctx.audio.power : 0),
    };
    var scales = {};
    for (var key in inst.spring) {
      if (!Object.prototype.hasOwnProperty.call(inst.spring, key)) continue;
      scales[key] = foliaCommonStepSpring(inst.spring[key], targets[key], dt);
    }
    for (var i = 0; i < inst.shapeNodes.length; i++) {
      var node = inst.shapeNodes[i];
      var scaleKey = foliaCommonScaleKey(inst.shapes[i].type);
      var scale = scales[scaleKey] || scales.default;
      node.face.style.setProperty('--scale', scale.toFixed(4));
      node.face.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }
  }

  function foliaCommonDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
  }

  /* 名字 / 排序取 Folia 权威值：
   *   options.visualizerBackgroundModeCommon = 通用（zh-CN.ts:2082）
   *   common/entry.tsx: order 10 / labelFallback 'Common' */
  registerFoliaBackground('common', {
    name: '通用',
    desc: '主题底色上缓缓漂移的几何图形',
    order: 10,
    needsWebGL2: false,
    create: foliaCommonCreate,
    tick: foliaCommonTick,
    destroy: foliaCommonDestroy,
  });
})();
