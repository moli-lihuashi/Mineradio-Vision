/* Folia 世界 — 模式调参存储内核（所有「歌词样式」共用的那一套）
 *
 * 权威源（Folia）：
 *   src/components/visualizer/<mode>/tuning.ts        → 每个模式的 settingsKey（'classicTuning' 等）
 *   src/stores/useVisualizerSettingsStore.ts          → handleSet<Mode>Tuning / handleReset<Mode>Tuning
 *   src/stores/visualizerSettingsPersistence.ts        → 各模式的 STORAGE_KEY（'classic_tuning' 等）
 *   src/types.ts                                       → DEFAULT_<MODE>_TUNING 与各 *Tuning 接口
 *   src/components/visualizer/settingsPanels.tsx       → 每个面板里的钳制函数（clamp*）
 *
 * 这里只做「存 + 归一化」两件事，不碰 DOM：面板（0l1）与运行时（05/06/07/08…）各自取用。
 *
 * 必须照抄的判据
 * --------------
 * 1. 一份存档、按模式分桶：存档键与绘光共用一个（Folia 也是同一份 settings 对象里放
 *    classicTuning / partitaTuning / … 十几个键，只是它把每个键单独序列化）。桶名 = 模式 id。
 * 2. 归一化只有一套：localStorage 读入、面板拖动、重置三处共用同一份钳制。
 *    数值钳区间（区间表逐项抄 settingsPanels.tsx 的 clamp* 与 input 的 min/max）、
 *    类型不对回落默认、枚举只认白名单。
 * 3. tuning 对象**不可变**：每次修改换一个新对象。运行时靠对象身份判断「这一帧要不要重建」，
 *    原地改字段会让面板拖动不出效果（与 0l 的绘光同一套约定）。
 * 4. 跨字段耦合写在 spec.adjustPatch 里（partita 的错位最小值/最大值互相顶）。
 *    耦合必须在**写入口**处理：面板只管发单字段 patch，不该知道另一头怎么动。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. Folia 的 handleSet<Mode>Tuning 每改一步就整份落盘；这里拆成
 *    set（只改内存，画面跟手）/ save（松手落盘），与 0l 的绘光、01d 的莫奈一致。
 * 2. Folia 的钳制散落在各面板组件里（每渲染一次算一遍）；这里是存储层算一遍，
 *    面板只负责把数值显示出来，两边不会各算一份。
 */
'use strict';

/* 与 0l 的绘光同一份物理存档：`{ lumiere: {...}, classic: {...}, partita: {...}, ... }`。
 * （绘光那份常量叫 FOLIA_TUNING_STORE_KEY，值相同、名字不同 —— 两个引擎各自读同一份 JSON。） */
var FOLIA_MODE_TUNING_STORE_KEY = 'mineradio-folia-tuning-v1';

/* 各模式规格：defaults 逐字抄 types.ts 的 DEFAULT_<MODE>_TUNING；
 * ranges 抄 settingsPanels.tsx 里的 clamp*（没有 clamp 的按 input 的 min/max）；
 * flags = 布尔字段；enums = 枚举白名单；integers = 取整字段。
 * 面板文案与控件顺序在 0l1 里，这里只管值的合法域。 */
var FOLIA_MODE_TUNING_SPECS = {
  /* types.ts:398 DEFAULT_CLASSIC_TUNING + settingsPanels.tsx:18-19 的
   * clampClassicBreathingFloatMultiplier[0,2] / clampClassicWordSpacing[0,2]。 */
  classic: {
    defaults: { enableWordRotation: true, breathingFloatMultiplier: 1, useLegacyLayout: false, wordSpacing: 0.7 },
    ranges: { breathingFloatMultiplier: [0, 2], wordSpacing: [0, 2] },
    flags: ['enableWordRotation', 'useLegacyLayout']
  },

  /* types.ts:428 DEFAULT_PARTITA_TUNING（20 / 100）+ settingsPanels.tsx:17
   * clampPartitaStagger[0,180]；141-148 的 resolve：min 与 max 反了就交换。 */
  partita: {
    defaults: { showGuideLines: true, useSemanticLayout: true, staggerMin: 20, staggerMax: 100 },
    ranges: { staggerMin: [0, 180], staggerMax: [0, 180] },
    flags: ['showGuideLines', 'useSemanticLayout'],
    integers: ['staggerMin', 'staggerMax'],
    post: function (tuning) {
      /* settingsPanels.tsx:143-148：staggerMin: Math.min(rawMin, rawMax)。 */
      if (tuning.staggerMin > tuning.staggerMax) {
        var swap = tuning.staggerMin;
        tuning.staggerMin = tuning.staggerMax;
        tuning.staggerMax = swap;
      }
      return tuning;
    },
    /* settingsPanels.tsx:157-170 handlePartitaMinChange / MaxChange：
     * 抬最小值时把最大值一起顶上去，压低最大值时把最小值一起带下来。 */
    adjustPatch: function (tuning, patch) {
      if (patch.staggerMin !== undefined) {
        var min = Math.min(180, Math.max(0, Number(patch.staggerMin)));
        patch.staggerMin = min;
        patch.staggerMax = Math.max(min, Number(patch.staggerMax !== undefined ? patch.staggerMax : tuning.staggerMax));
      }
      if (patch.staggerMax !== undefined) {
        var max = Math.min(180, Math.max(0, Number(patch.staggerMax)));
        patch.staggerMax = max;
        patch.staggerMin = Math.min(Number(patch.staggerMin !== undefined ? patch.staggerMin : tuning.staggerMin), max);
      }
      return patch;
    }
  },

  /* types.ts:496 DEFAULT_TILT_TUNING（0.75 / 0.35 / 'default'）+ settingsPanels.tsx:816-820
   * 的 [0,1] 钳制；colorScheme 只认 types.ts:488 的四个值。 */
  tilt: {
    defaults: { splitProbability: 0.75, tiltStyleProbability: 0.35, colorScheme: 'default' },
    ranges: { splitProbability: [0, 1], tiltStyleProbability: [0, 1] },
    enums: { colorScheme: ['default', 'swap', 'accentAll', 'primaryAll'] }
  },

  /* types.ts:465 DEFAULT_CLADDAGH_TUNING（0.65 / 1.0 / 45 / true / 0）+
   * settingsPanels.tsx:20-22 clamp：focusScaleRatio[0,1.5] / radiusScale[0.5,1.5] /
   * ellipseTiltDeg[0,60]；1140 clampCladdaghLetterSpacingOffset[-5,20]。 */
  claddagh: {
    defaults: {
      focusScaleRatio: 0.65,
      radiusScale: 1,
      ellipseTiltDeg: 45,
      showAxisLine: true,
      letterSpacingOffset: 0
    },
    ranges: {
      focusScaleRatio: [0, 1.5],
      radiusScale: [0.5, 1.5],
      ellipseTiltDeg: [0, 60],
      letterSpacingOffset: [-5, 20]
    },
    flags: ['showAxisLine'],
    integers: ['ellipseTiltDeg']
  },

  /* types.ts:515 DEFAULT_PENDOLO_TUNING；ranges 抄 PendoloSettingsPanel.tsx 每个 input 的
   * min/max（-0.20~0.40 / 0.25~0.80 / 40~160 / 0.5~2.0 / 1.00~1.60）。
   * wheelCenterY 面板上没有控件，但运行时要读，照样进规格表参与归一化。 */
  pendolo: {
    defaults: {
      arcRadius: 0.42,
      arcAngleDeg: 100,
      wheelCenterX: 0,
      wheelCenterY: 0.5,
      tickSnappiness: 2,
      activeScale: 1.25,
      showGearDecor: 'subtle',
      showCenterGradient: true,
      showCoverOnWatchFace: false,
      enableLineGlow: false
    },
    ranges: {
      arcRadius: [0.25, 0.8],
      arcAngleDeg: [40, 160],
      wheelCenterX: [-0.2, 0.4],
      wheelCenterY: [0, 1],
      tickSnappiness: [0.5, 2],
      activeScale: [1, 1.6]
    },
    flags: ['showCenterGradient', 'showCoverOnWatchFace', 'enableLineGlow'],
    enums: { showGearDecor: ['none', 'subtle', 'full'] }
  },

  /* types.ts:560 DEFAULT_SONNET_TUNING + SonnetSettingsPanel.tsx 里每个控件的 min/max：
   * 三个运动滑块与 SonnetRangeControl 的默认区间都是 [0,2]；纹素分辨率 [0.5,4]；
   * 后期七项里 grain/contrast/rgbShift/lensDispersion/halftone 是 [0,1]、
   * lensDistortion/vignette 是 [0,2]。 */
  sonnet: {
    defaults: {
      cameraIntensity: 1,
      typographyMotion: 1,
      mgDensity: 1,
      showOnlyText: false,
      showGuide: true,
      showBackgroundMg: true,
      showFixedGeo: true,
      showGiantDecorativeText: true,
      showBackgroundDecor: true,
      enableTransitions: true,
      outerFrameMode: 'full',
      textureResolution: 1.5,
      postProcessEnabled: false,
      postProcessGrain: 0.2,
      postProcessContrast: 0,
      postProcessRgbShift: 0,
      postProcessHalftone: 0,
      postProcessVignette: 0.85,
      postProcessLensDistortion: 0.3,
      postProcessLensDispersion: 0.6
    },
    ranges: {
      cameraIntensity: [0, 2],
      typographyMotion: [0, 2],
      mgDensity: [0, 2],
      textureResolution: [0.5, 4],
      postProcessGrain: [0, 1],
      postProcessContrast: [0, 1],
      postProcessRgbShift: [0, 1],
      postProcessHalftone: [0, 1],
      postProcessVignette: [0, 2],
      postProcessLensDistortion: [0, 2],
      postProcessLensDispersion: [0, 1]
    },
    flags: [
      'showOnlyText', 'showGuide', 'showBackgroundMg', 'showFixedGeo',
      'showGiantDecorativeText', 'showBackgroundDecor', 'enableTransitions',
      'postProcessEnabled'
    ],
    enums: { outerFrameMode: ['none', 'frame', 'full'] }
  },

  /* types.ts:674 DEFAULT_TEMPERA_TUNING + TemperaSettingsPanel.tsx 各控件区间：
   * 运动两项与 TemperaRangeControl 的默认 [0,2]；入场时序 [0,1]；纹素分辨率 [0.5,4]；
   * 后期 grain/contrast/rgbShift 是 [0,1]、vignette/lensDistortion 是 [0,2]。
   * layerImages 只是透传（图池在 IndexedDB，本项目没有上传器），layerImageDepth/Frequency
   * 保留是因为运行时读它们。 */
  tempera: {
    defaults: {
      cameraIntensity: 1,
      glyphMotion: 1,
      wholeLineLyrics: false,
      glyphSettleStretch: 0.5,
      colorMode: 'duo',
      showBlocks: true,
      showDecor: true,
      showCornerMarks: true,
      textInversion: true,
      layerImages: [],
      layerImageDepth: 'back',
      layerImageFrequency: 0.6,
      enableTransitions: true,
      textureResolution: 1.5,
      postProcessEnabled: true,
      postProcessTextureCompression: false,
      postProcessGrain: 0.2,
      postProcessContrast: 0,
      postProcessRgbShift: 0,
      postProcessVignette: 0.85,
      postProcessLensDistortion: 0.3
    },
    ranges: {
      cameraIntensity: [0, 2],
      glyphMotion: [0, 2],
      glyphSettleStretch: [0, 1],
      layerImageFrequency: [0, 1],
      textureResolution: [0.5, 4],
      postProcessGrain: [0, 1],
      postProcessContrast: [0, 1],
      postProcessRgbShift: [0, 1],
      postProcessVignette: [0, 2],
      postProcessLensDistortion: [0, 2]
    },
    flags: [
      'wholeLineLyrics', 'showBlocks', 'showDecor', 'showCornerMarks', 'textInversion',
      'enableTransitions', 'postProcessEnabled', 'postProcessTextureCompression'
    ],
    enums: {
      colorMode: ['duo', 'mono', 'gradient'],
      layerImageDepth: ['back', 'front']
    }
  },

  /* types.ts:446 DEFAULT_FUME_TUNING + settingsPanels.tsx:262-273 的 resolveFumeTuning：
   * backgroundObjectOpacity/textHoldRatio [0,1]；cameraSpeed [0.55,1.85]；
   * glowIntensity [0,1.8]；heroScale [0.82,1.32]；cameraTrackingMode 只认 stepped|smooth。 */
  fume: {
    defaults: {
      hidePrintSymbols: false,
      disableGeometricBackground: true,
      backgroundObjectOpacity: 0.5,
      textHoldRatio: 1,
      cameraTrackingMode: 'smooth',
      cameraSpeed: 1,
      glowIntensity: 1,
      heroScale: 1
    },
    ranges: {
      backgroundObjectOpacity: [0, 1],
      textHoldRatio: [0, 1],
      cameraSpeed: [0.55, 1.85],
      glowIntensity: [0, 1.8],
      heroScale: [0.82, 1.32]
    },
    flags: ['hidePrintSymbols', 'disableGeometricBackground'],
    enums: { cameraTrackingMode: ['stepped', 'smooth'] }
  },

  /* types.ts:883 DEFAULT_DIORAMA_TUNING + settingsPanels.tsx:899-901 的 clamp：
   * cameraSpeed[0.55,1.85] / motionAmount[0.4,1.6] / audioReactivity[0,1.5]；
   * 粒子密度与尺度、尘埃两轴抄 types.ts:821-844 的常量区间；三个「跟唱效果」强度 [0.1,1.5]。
   * geometryVisibility 是**嵌套对象**（types.ts:812），走 spec.nested：Folia 每次都是
   * `{...DEFAULT.geometryVisibility, ...tuning.geometryVisibility}`，所以这里也按默认值补齐。 */
  diorama: {
    defaults: {
      cameraSpeed: 1,
      motionAmount: 1,
      audioReactivity: 1,
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
    },
    ranges: {
      cameraSpeed: [0.55, 1.85],
      motionAmount: [0.4, 1.6],
      audioReactivity: [0, 1.5],
      particleDensity: [96, 1536],
      particleScale: [0.65, 1.6],
      particleGlowIntensity: [0.1, 1.5],
      backgroundParticleCircumference: [4, 48],
      backgroundParticleRadial: [1, 4],
      glowIntensity: [0.1, 1.5],
      soulIntensity: [0.1, 1.5],
      gradientIntensity: [0.1, 1.5]
    },
    flags: [
      'particleGlowEnabled', 'showParticles', 'glowEnabled', 'soulEnabled',
      'soulActiveEnabled', 'gradientEnabled', 'keywordColoringEnabled'
    ],
    integers: ['particleDensity', 'backgroundParticleCircumference', 'backgroundParticleRadial'],
    nested: {
      geometryVisibility: {
        defaults: {
          enabled: true,
          mode: 'clouds',
          strands: true,
          blobs: true,
          ribbons: true,
          rings: true
        },
        flags: ['enabled', 'strands', 'blobs', 'ribbons', 'rings'],
        enums: { mode: ['clouds', 'corridor'] }
      }
    }
  },

  /* types.ts:1066 DEFAULT_MONET_TUNING（**样式**那份，背景那份在 01d）。
   * 面板只暴露其中八项；portraitOffsetX 也进规格表（运行时读它）。 */
  monet: {
    defaults: {
      keywordColoringEnabled: true,
      showDescription: true,
      showAudioVisualization: true,
      audioStyle: 'bar',
      fontScale: 1.2,
      portraitSource: 'cover',
      portraitOffsetX: 0,
      portraitStyle: 'square',
      showPortraitDragHanger: true
    },
    ranges: {
      fontScale: [0.7, 1.5],
      portraitOffsetX: [-1, 1]
    },
    flags: ['keywordColoringEnabled', 'showDescription', 'showAudioVisualization', 'showPortraitDragHanger'],
    enums: {
      audioStyle: ['bar', 'line'],
      portraitSource: ['cover', 'custom'],
      portraitStyle: ['rectangular', 'square']
    }
  },

  /* types.ts:482 DEFAULT_CAPPELLA_TUNING。三档头像来源与两档表情包来源都是枚举
   * （'custom' 在面板上需要已上传的资源才可选，这里只保证取值合法）。 */
  cappella: {
    defaults: { showEmoMessages: true, emojiPackSource: 'builtin', avatarSource: 'cover' },
    flags: ['showEmoMessages'],
    enums: {
      emojiPackSource: ['builtin', 'custom'],
      avatarSource: ['cover', 'builtin', 'color', 'custom']
    }
  }
};

/* 嵌套块（一层就够：目前只有立体的 geometryVisibility）：
 * 缺项按默认补齐、布尔只认布尔、枚举只认白名单、数值钳区间。 */
function foliaModeNormalizeNested(shape, value) {
  var raw = (value && typeof value === 'object') ? value : {};
  var out = {};
  for (var k in shape.defaults) {
    if (!Object.prototype.hasOwnProperty.call(shape.defaults, k)) continue;
    var fallback = shape.defaults[k];
    var v = raw[k];
    if (typeof fallback === 'boolean') {
      out[k] = (typeof v === 'boolean') ? v : fallback;
    } else if (typeof fallback === 'number') {
      var range = shape.ranges && shape.ranges[k];
      var n = (typeof v === 'number' && isFinite(v)) ? v : fallback;
      if (range) n = Math.min(range[1], Math.max(range[0], n));
      if (shape.integers && shape.integers.indexOf(k) >= 0) n = Math.round(n);
      out[k] = n;
    } else if (typeof fallback === 'string') {
      var allowed = (shape.enums && shape.enums[k]) || [fallback];
      out[k] = allowed.indexOf(v) >= 0 ? v : fallback;
    }
  }
  return out;
}

function foliaModeTuningSpec(mode) {
  return (mode && FOLIA_MODE_TUNING_SPECS[mode]) ? FOLIA_MODE_TUNING_SPECS[mode] : null;
}

function foliaModeTuningDefaults(mode) {
  var spec = foliaModeTuningSpec(mode);
  if (!spec) return {};
  var out = {};
  for (var k in spec.defaults) {
    if (Object.prototype.hasOwnProperty.call(spec.defaults, k)) out[k] = spec.defaults[k];
  }
  return foliaModeNormalizeTuning(mode, out);
}

/* 把任意输入收敛成该模式的合法 tuning：
 * 布尔 → 类型不对回落默认；数值 → 类型不对回落默认、否则钳区间（整数再取整）；
 * 枚举 → 只认白名单；最后跑 spec.post 的跨字段修正。输入不是对象等价于「全默认」。 */
function foliaModeNormalizeTuning(mode, value) {
  var spec = foliaModeTuningSpec(mode);
  if (!spec) return {};
  var raw = (value && typeof value === 'object') ? value : {};
  var out = {};
  var k;
  for (k in spec.defaults) {
    if (!Object.prototype.hasOwnProperty.call(spec.defaults, k)) continue;
    var fallback = spec.defaults[k];
    var v = raw[k];
    if (typeof fallback === 'boolean') {
      out[k] = (typeof v === 'boolean') ? v : fallback;
    } else if (Array.isArray(fallback)) {
      /* 数组项原样透传（凝彩的 layerImages 是「已放置图片」的清单，不是数值，
       * 归一化管不着它的内容；类型不对就回落空清单）。 */
      out[k] = Array.isArray(v) ? v.slice() : fallback.slice();
    } else if (typeof fallback === 'number') {
      var range = spec.ranges && spec.ranges[k];
      var n = (typeof v === 'number' && isFinite(v)) ? v : fallback;
      if (range) n = Math.min(range[1], Math.max(range[0], n));
      if (spec.integers && spec.integers.indexOf(k) >= 0) n = Math.round(n);
      out[k] = n;
    } else if (typeof fallback === 'string') {
      var allowed = (spec.enums && spec.enums[k]) || [fallback];
      out[k] = allowed.indexOf(v) >= 0 ? v : fallback;
    }
  }
  if (spec.nested) {
    for (var n in spec.nested) {
      if (!Object.prototype.hasOwnProperty.call(spec.nested, n)) continue;
      out[n] = foliaModeNormalizeNested(spec.nested[n], raw[n]);
    }
  }
  return spec.post ? spec.post(out) : out;
}

/* 缓存的是「当前生效的那一份」：运行时靠对象身份判断要不要重建，
 * 所以每次修改必须换新对象（原地改字段会让 setTuning 静默失效）。 */
var foliaModeTuningCache = {};

function foliaModeTuningReadAll() {
  try {
    var all = JSON.parse(localStorage.getItem(FOLIA_MODE_TUNING_STORE_KEY) || '{}');
    return (all && typeof all === 'object') ? all : {};
  } catch (_) {
    return {};
  }
}

function foliaModeTuning(mode) {
  var spec = foliaModeTuningSpec(mode);
  if (!spec) return {};
  if (!foliaModeTuningCache[mode]) {
    foliaModeTuningCache[mode] = foliaModeNormalizeTuning(mode, foliaModeTuningReadAll()[mode]);
  }
  return foliaModeTuningCache[mode];
}

/* 改一项（或一组）：先过 spec.adjustPatch 的跨字段耦合，合并后再整份归一化。
 * persist=true 直接落盘（重置走这条）；面板拖动走 set（persist=false）+ save。 */
function foliaModeMergeTuning(mode, patch, persist) {
  var spec = foliaModeTuningSpec(mode);
  if (!spec) return {};
  var base = foliaModeTuning(mode);
  var merged = {};
  var k;
  for (k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
  }
  if (patch) {
    /* 耦合以「当前生效的那一份」为基准（partita 抬最小值时看的是当前最大值）。 */
    var applied = spec.adjustPatch ? spec.adjustPatch(base, patch) : patch;
    for (k in applied) {
      if (Object.prototype.hasOwnProperty.call(applied, k)) merged[k] = applied[k];
    }
  }
  foliaModeTuningCache[mode] = foliaModeNormalizeTuning(mode, merged);
  if (persist) foliaModeSaveTuning(mode);
  return foliaModeTuningCache[mode];
}

function foliaModeSetTuning(mode, patch) {
  return foliaModeMergeTuning(mode, patch, false);
}

function foliaModeSaveTuning(mode) {
  if (!foliaModeTuningSpec(mode)) return;
  try {
    var all = foliaModeTuningReadAll();
    all[mode] = foliaModeTuning(mode);
    localStorage.setItem(FOLIA_MODE_TUNING_STORE_KEY, JSON.stringify(all));
  } catch (_) {}
}

function foliaModeResetTuning(mode) {
  var spec = foliaModeTuningSpec(mode);
  if (!spec) return {};
  /* 重置 = 「用默认值再过一遍归一化」，不是直接把 defaults 塞进缓存：
   * defaults 里的枚举/整数还没校验过，绕过归一化会让 post 的跨字段修正漏掉。 */
  foliaModeTuningCache[mode] = foliaModeNormalizeTuning(mode, spec.defaults);
  foliaModeSaveTuning(mode);
  return foliaModeTuningCache[mode];
}

/* 面板与运行时都从 window 上取（运行时文件早于本文件加载，只能在函数里拿）。 */
window.foliaModeTuningSpecs = FOLIA_MODE_TUNING_SPECS;
window.foliaModeTuningDefaults = foliaModeTuningDefaults;
window.foliaModeNormalizeTuning = foliaModeNormalizeTuning;
window.foliaModeTuning = foliaModeTuning;
window.foliaModeSetTuning = foliaModeSetTuning;
window.foliaModeSaveTuning = foliaModeSaveTuning;
window.foliaModeResetTuning = foliaModeResetTuning;
