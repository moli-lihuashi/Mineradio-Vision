/* Folia 世界 — 歌词样式调参面板（模式维度）
 *
 * 权威源（Folia）：
 *   src/components/visualizer/settingsPanels.tsx                     → 七个面板（经典/云阶/雾/合唱团/倾诉/立体/回环）
 *   src/components/visualizer/{lumiere,monet,pendolo,sonnet,tempera}/ → 另外五个面板（绘光/莫奈/时计/商籁/凝彩）
 *   src/components/visualizer/<mode>/entry.tsx 的 renderSettingsPanel → 哪个模式挂哪个面板
 *   src/i18n/locales/zh-CN.ts                                      → options.* 文案（逐字抄）
 *
 * 覆盖范围（11 / 11）：lumiere（在 0l）· classic · partita · tilt · claddagh · pendolo ·
 * sonnet · tempera · fume · diorama · monet · cappella。cadenza 没有 renderSettingsPanel，本来就没有面板。
 *
 * 分工：0l0 管「值怎么存、怎么钳」；本文件管「控件长什么样、按什么顺序排」。
 * 面板一律走 0l 的通用控件（slider / pills / switch），binding 指向 0l0 的存储。
 *
 * 必须照抄的判据
 * --------------
 * 1. 组内顺序 = 面板语义，逐项照搬 settingsPanels.tsx（不是「先开关后滑块」那种自己想的顺序）。
 *    classic：逐字旋转 → 排版模式 → 呼吸浮动范围 → （自适应才有的）单词间距。
 *    partita：引导线 → 语义排列 → 错位最小值 → 错位最大值。
 *    tilt   ：配色方案 → 分行概率 → 斜体强调概率。
 *    claddagh：主歌词放大倍率 → 轨道半径 → 轨道倾斜度 → 中间轴线 → 字符间距。
 *    pendolo：轮盘水平位置 → 轮盘半径 → 弧度角度 → 擒纵咬合力度 → 聚焦句缩放 → 齿轮饰线三档 →
 *             中央渐变 → 表盘封面 → 线条发光。
 *    sonnet ：四段（渲染质量 → 动态与构图 → 后处理 → 显示内容），后期关着时那七项整组不出现。
 *    tempera：五段（渲染质量 → 动态与调色 → 后处理 → 歌词分镜 → 显示内容）。
 *    fume   ：两组「显示/隐藏」药丸（取值是**反的**，见该面板注释）→ 三个滑块 → 追焦方式 → 两个滑块。
 *    diorama：三个滑块 → 三个可折叠跟唱效果组（辉光/灵魂出窍/渐变）→ 关键字着色 →
 *             点云几何（可折叠）→ 背景粒子（可折叠）。折叠状态存在模块级表里。
 *    monet  ：三段（歌词样式 → 头像来源 → 频谱样式）。
 *    cappella：显示表情包 → 头像来源四档 → 表情包来源两档。
 * 2. 条件渲染照抄：classic 的「单词间距」只在**自适应**（useLegacyLayout=false）时出现
 *    （settingsPanels.tsx:106 的 `{!resolvedClassicTuning.useLegacyLayout && …}`）。
 *    换排版模式要整面板重建（refreshPanel），否则那一行不会自己消失/冒出来。
 * 3. 数值显示逐项照抄：classic 两个滑块是 `toFixed(2)x`；partita 是 `{值}px`；
 *    tilt 两个概率是 `Math.round(v*100)%`；claddagh 的放大倍率显示 `(v+1).toFixed(2)x`、
 *    倾斜度 `{值}°`、字符间距带正负号一位小数。
 * 4. 文案里的「显示 / 隐藏」「启用 / 关闭」是**共用键**（Folia 的 claddagh 也用
 *    options.partitaGuideLinesOn/Off，classic/cappella 也用 partitaGuideLinesOn/Off 表示开关）——
 *    不要按字面改成「开启/关闭」。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 面板挂在 0l 的注册表上（mode 维度），不是每个模式各建一个 React 组件。
 * 2. 拖动只改内存、松手落盘：与 0l 的绘光、01d 的莫奈同一套草稿语义。
 * 3. 改完不重建实例 —— 各模式运行时在 tick 里比对 tuning 对象身份，自己决定要不要重建，
 *    所以面板这边 commit 只落盘（binding.rebuild = false 的等价物）。
 */
'use strict';

/* zh-CN.ts:2124-2200 逐字抄（键名保留 Folia 的 options.* 原名，方便对照）。 */
var FOLIA_MODE_PANEL_TEXT = {
  classicSettings: '流光参数',
  classicSettingsDesc: '控制逐字旋转和整行呼吸浮动范围。',
  classicWordRotation: '逐字旋转',
  classicWordRotationOn: '启用',
  classicWordRotationOff: '关闭',
  classicBreathingFloatMultiplier: '呼吸浮动范围',
  classicLegacyLayout: '排版模式',
  classicLegacyLayoutOn: '旧版',
  classicLegacyLayoutOff: '自适应',
  classicWordSpacing: '单词间距',

  partitaSettings: '云阶参数',
  partitaSettingsDesc: '控制引导线显示和分块横向错位范围。',
  partitaGuideLines: '引导线',
  partitaGuideLinesOn: '显示',
  partitaGuideLinesOff: '隐藏',
  partitaSemanticLayout: '语义排列',
  partitaSemanticLayoutOn: '启用',
  partitaSemanticLayoutOff: '关闭',
  partitaStaggerMin: '错位最小值',
  partitaStaggerMax: '错位最大值',

  tiltSettings: '倾诉参数',
  tiltSettingsDesc: '控制歌词分行概率和斜体强调样式的出现频率。',
  tiltColorScheme: '配色方案',
  tiltColorSchemeDefault: '双色1',
  tiltColorSchemeSwap: '双色2',
  tiltColorSchemeAccentAll: '单色1',
  tiltColorSchemePrimaryAll: '单色2',
  tiltSplitProbability: '分行概率',
  tiltStyleProbability: '斜体强调概率',

  claddaghSettings: '回环参数',
  claddaghSettingsDesc: '调整歌词大小对比率、轨道半径及倾斜度。',
  claddaghFocusScaleRatio: '主歌词放大倍率',
  claddaghRadiusScale: '轨道半径',
  claddaghEllipseTiltDeg: '轨道倾斜度',
  claddaghShowAxisLine: '中间轴线',
  claddaghLetterSpacingOffset: '字符间距',

  pendoloSettings: '时计参数',
  pendoloSettingsDesc: '调整歌词弧形轮盘圆心位置、轮盘半径、弧度角度与擒纵咬合力度。',
  pendoloWheelCenterX: '轮盘水平位置 (0 = 左边缘)',
  pendoloArcRadius: '轮盘半径',
  pendoloArcAngleDeg: '弧度角度',
  pendoloTickSnappiness: '擒纵咬合力度',
  pendoloActiveScale: '聚焦句缩放',
  pendoloShowGearDecor: '机械齿轮饰线',
  pendoloDecorNone: '无',
  pendoloDecorSubtle: '半透明',
  pendoloDecorFull: '完整',
  pendoloShowCenterGradient: '齿轮中央深色渐变',
  pendoloShowCoverOnWatchFace: '表盘显示专辑封面',
  pendoloShowCoverOnWatchFaceOn: '显示',
  pendoloShowCoverOnWatchFaceOff: '隐藏',
  pendoloEnableLineGlow: '线条发光效果',
  /* options.pendoloCenterGradientOn/Off「开启 / 关闭」是由齿轮渐变与线条发光两组共用的
   * 同两个键（Folia 的 LineGlowOn/Off 也是同样的字），这里合成一份翻译。 */
  pendoloToggleOn: '开启',
  pendoloToggleOff: '关闭',

  sonnetSettings: '商籁参数',
  sonnetSettingsDesc: '调整商籁场景运动、纹理分辨率，以及绘制的图层。建议搭配空 / Sora 背景。',
  sonnetQualitySection: '渲染质量',
  sonnetMotionSection: '动态与构图',
  sonnetPostProcessSection: '后处理',
  sonnetDisplaySection: '显示内容',
  sonnetTextureResolution: '纹理分辨率',
  sonnetTexturePerformanceWarning: '提高纹理分辨率会增加 GPU 显存占用和渲染负载，可能影响性能。',
  sonnetCameraIntensity: '镜头运动强度',
  sonnetTypographyMotion: '文字动势',
  sonnetMgDensity: '背景短线密度',
  sonnetPostProcessEnabled: '整体后处理滤镜',
  sonnetPostProcessGrain: '胶片颗粒',
  sonnetPostProcessContrast: '对比度增强',
  sonnetPostProcessRgbShift: 'RGB 色差',
  sonnetPostProcessLensDistortion: '透镜扭曲',
  sonnetPostProcessLensDispersion: '透镜色散',
  sonnetPostProcessHalftone: '半调网点',
  sonnetPostProcessVignette: '暗角',
  sonnetOuterFrameMode: '外层边框',
  sonnetOuterFrameNone: '完全隐藏',
  sonnetOuterFrameFrame: '仅显示框架',
  sonnetOuterFrameFull: '完全显示',
  sonnetShowOnlyText: '仅显示文字',
  sonnetShowGuide: '轨迹线',
  sonnetShowBackgroundMg: '主场景',
  sonnetShowFixedGeo: '文字浮标',
  sonnetShowGiantDecorativeText: '巨型装饰镂空文字',
  sonnetShowBackgroundDecor: '背景装饰',
  sonnetEnableTransitions: '场景转场',
  sonnetToggleOn: '开启',
  sonnetToggleOff: '关闭',

  temperaSettings: '凝彩参数',
  temperaSettingsDesc: '调整凝彩的色块构图、镜头运动与渲染质量。建议搭配空 / Sora 背景。',
  temperaQualitySection: '渲染质量',
  temperaMotionSection: '动态与调色',
  temperaPostProcessSection: '后处理',
  temperaLyricSection: '歌词分镜',
  temperaDisplaySection: '显示内容',
  temperaTextureResolution: '纹理分辨率',
  temperaTexturePerformanceWarning: '提高纹理分辨率会增加 GPU 显存占用和渲染负载，可能影响性能。',
  temperaCameraIntensity: '镜头运动强度',
  temperaGlyphMotion: '逐字动势',
  temperaGlyphSettleStretch: '逐字入场时序',
  temperaGlyphSettleStretchHint: '0 = 每字用同样的短窗口快速落位，切镜前画面已静止，适合快歌；1 = 整个分镜的字精确落在歌词结束那一刻，全程都在动，适合慢歌。',
  temperaColorMode: '色彩模式',
  temperaColorModeDuo: '主题双色',
  temperaColorModeMono: '黑白灰',
  temperaColorModeGradient: '封面渐变',
  temperaPostProcessEnabled: '整体后处理滤镜',
  temperaPostProcessTextureCompression: '后处理纹理压缩',
  temperaPostProcessTextureCompressionHint: '开启后后处理在 1x 纹理上运算再拉伸到画布，降低GPU和显存压力',
  temperaPostProcessGrain: '胶片颗粒',
  temperaPostProcessContrast: '对比度增强',
  temperaPostProcessRgbShift: 'RGB 色差',
  temperaPostProcessVignette: '暗角',
  temperaPostProcessLensDistortion: '透镜扭曲',
  temperaWholeLineLyrics: '整句显示歌词',
  temperaWholeLineLyricsHint: '关闭时一句歌词按 2~4 词切成多个分镜，字号可以放得很大；开启后整句留在同一个分镜里，长句会自动缩小字号。',
  temperaShowBlocks: '色块场景',
  temperaShowDecor: '装饰元素',
  temperaShowCornerMarks: '边角线框',
  temperaTextInversion: '文字动态反色',
  temperaEnableTransitions: '场景转场',
  temperaToggleOn: '开启',
  temperaToggleOff: '关闭',

  fumeSettings: '浮名参数',
  fumeSettingsDesc: '控制打印方块、镜头节奏、追焦方式、辉光和大标题比例。',
  fumeHidePrintSymbols: '隐藏打印方块',
  fumeGeometricBackground: '通用几何图形',
  fumeBackgroundObjectOpacity: '世界背景物体透明度',
  fumeTextHoldRatio: '文字停留比例',
  fumeCameraSpeed: '摄影机移动速度',
  fumeCameraTrackingMode: '摄影机追焦方式',
  fumeCameraTrackingStepped: '定格',
  fumeCameraTrackingSmooth: '平滑',
  fumeGlowIntensity: '当前句辉光强度',
  fumeHeroScale: '大标题比例',

  dioramaSettings: '镜台参数',
  dioramaSettingsDesc: '',
  dioramaCameraSpeed: '镜头速度',
  dioramaMotionAmount: '运动幅度',
  dioramaAudioReactivity: '点云音频响应',
  dioramaGlowEffect: '普通辉光跟唱',
  dioramaSoulEffect: '灵魂出窍跟唱',
  dioramaSoulActiveEffect: '当前字出窍',
  dioramaGradientEffect: '渐变跟唱',
  dioramaKeywordColoring: '关键字着色',
  dioramaEffectStrength: '强度',
  dioramaStrengthLow: '弱',
  dioramaStrengthMid: '中',
  dioramaStrengthHigh: '强',
  dioramaStrengthCustom: '自定义',
  dioramaCustomStrength: '自定义强度',
  dioramaGeometry: '点云几何',
  dioramaGeometryMode: '几何形态',
  dioramaGeometryModeClouds: '点云',
  dioramaGeometryModeCorridor: '长廊',
  dioramaGeometryStrands: '点云立方体',
  dioramaGeometryBlobs: '点云圆柱体',
  dioramaGeometryRibbons: '三角晶体',
  dioramaGeometryRings: '点云圆环',
  dioramaParticleDensity: '点云密度',
  dioramaParticleScale: '点云整体体积',
  dioramaParticleGlow: '点云整体辉光',
  dioramaParticleGlowIntensity: '辉光强度',
  dioramaShowParticles: '背景粒子',
  dioramaMoteCircumference: '圆周密度',
  dioramaMoteRadial: '径向密度',

  monetSettings: '莫奈参数',
  monetSettingsDesc: '控制关键字、右侧肖像和底部频谱样式。',
  monetLyricsSection: '歌词样式',
  monetPortraitSection: '头像来源',
  monetAudioSection: '频谱样式',
  monetFontScale: '字体缩放',
  monetKeywordColoring: '关键字着色',
  monetKeywordColoringOn: '启用',
  monetKeywordColoringOff: '关闭',
  monetShowDescription: '显示歌曲描述',
  monetPortraitSource: '右侧肖像来源',
  monetPortraitSourceCover: '封面',
  monetPortraitSourceCustom: '自定义图片',
  monetPortraitStyle: '封面形状',
  monetPortraitStyleRectangular: '长方形',
  monetPortraitStyleSquare: '正方形',
  /* 上传肖像图 / 清空肖像图（zh-CN.ts:2654-2655）+ 两条提示（:269-270）。 */
  monetUploadPortrait: '上传肖像图',
  monetClearPortrait: '清空肖像图',
  monetPortraitUpdated: 'Monet 肖像图已更新',
  monetPortraitCleared: 'Monet 肖像图已清空',
  monetPortraitDragHanger: '拖拽调整按钮',
  monetPortraitDragHangerShow: '显示',
  monetPortraitDragHangerHide: '隐藏',
  monetShowAudioVisualization: '音频图案',
  monetAudioVisualizationShow: '显示',
  monetAudioVisualizationHide: '隐藏',
  monetAudioStyle: '频谱样式',
  monetAudioStyleBar: '柱状',
  monetAudioStyleLine: '线条',

  cappellaSettings: '群唱参数',
  cappellaSettingsDesc: '控制头像来源、表情包显示、自定义来源和预览缩略图。',
  cappellaShowEmoMessages: '显示表情包',
  cappellaAvatarSource: '头像来源',
  cappellaAvatarSourceCover: '封面',
  cappellaAvatarSourceBuiltin: '内置头像',
  cappellaAvatarSourceColor: '色块',
  cappellaAvatarSourceCustom: '自定义',
  cappellaEmojiSource: '表情包来源',
  cappellaEmojiSourceBuiltin: '内置',
  cappellaEmojiSourceCustom: '自定义'
};

/* 模式面板的 binding：值与存档都在 0l0，这里只是把四个入口对上号。
 * rebuild 不置真 —— 各模式运行时在 tick 里比对 tuning 对象身份，自己决定要不要重建。 */
function foliaModePanelBinding(mode) {
  return {
    rebuild: false,
    get: function () { return foliaModeTuning(mode); },
    set: function (patch) { return foliaModeSetTuning(mode, patch); },
    commit: function () { foliaModeSaveTuning(mode); }
  };
}

/* 通用开关药丸：on/off 两个值，文案由调用方给（Folia 各面板的开关文案不统一）。 */
function foliaModeTogglePills(label, key, binding, onLabel, offLabel, refreshPanel) {
  return foliaBuildTuningPills(label, [
    { value: true, label: onLabel },
    { value: false, label: offLabel }
  ], key, binding, { refresh: refreshPanel === true });
}

/* ---------------- 流光（classic）----------------
 * settingsPanels.tsx:24-129 ClassicSettingsPanel。 */

function foliaBuildClassicPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('classic');
  var tuning = binding.get();

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.classicSettings, T.classicSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.classicSettings, T.classicSettingsDesc));
  }

  host.appendChild(foliaModeTogglePills(
    T.classicWordRotation, 'enableWordRotation', binding,
    T.classicWordRotationOn, T.classicWordRotationOff, false
  ));

  /* 换排版模式要重建面板：下面那张「单词间距」是按 useLegacyLayout 条件渲染的。 */
  host.appendChild(foliaModeTogglePills(
    T.classicLegacyLayout, 'useLegacyLayout', binding,
    T.classicLegacyLayoutOn, T.classicLegacyLayoutOff, true
  ));

  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'breathingFloatMultiplier', label: T.classicBreathingFloatMultiplier,
    min: 0, max: 2, step: 0.05, format: 'times'
  }, binding));

  if (!tuning.useLegacyLayout) {
    host.appendChild(foliaBuildTuningControl({
      kind: 'slider', key: 'wordSpacing', label: T.classicWordSpacing,
      min: 0, max: 2, step: 0.05, format: 'times'
    }, binding));
  }
}

/* ---------------- 云阶（partita）----------------
 * settingsPanels.tsx:130-245 PartitaSettingsPanel。 */

function foliaBuildPartitaPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('partita');

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.partitaSettings, T.partitaSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.partitaSettings, T.partitaSettingsDesc));
  }

  host.appendChild(foliaModeTogglePills(
    T.partitaGuideLines, 'showGuideLines', binding,
    T.partitaGuideLinesOn, T.partitaGuideLinesOff, false
  ));
  host.appendChild(foliaModeTogglePills(
    T.partitaSemanticLayout, 'useSemanticLayout', binding,
    T.partitaSemanticLayoutOn, T.partitaSemanticLayoutOff, false
  ));

  /* 两个错位滑块互相顶（抬最小值把最大值一起顶上去）：耦合在 0l0 的 adjustPatch 里，
   * 面板只发单字段 patch，不重复算一遍。
   * 但松手后**另一条滑块的读数**要跟着变 —— 那是渲染出来的文本，只能整面板重建一次；
   * Folia 靠 React 重渲染天然做到，这里用一个只多一步刷新的 binding 顶替。 */
  var coupledBinding = {
    rebuild: false,
    get: binding.get,
    set: binding.set,
    commit: function () {
      binding.commit();
      foliaRefreshTuningPanel();
    }
  };
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'staggerMin', label: T.partitaStaggerMin,
    min: 0, max: 180, step: 5, format: 'px'
  }, coupledBinding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'staggerMax', label: T.partitaStaggerMax,
    min: 0, max: 180, step: 5, format: 'px'
  }, coupledBinding));
}

/* ---------------- 倾诉（tilt）----------------
 * settingsPanels.tsx:805-897 TiltSettingsPanel。 */

function foliaBuildTiltPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('tilt');

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.tiltSettings, T.tiltSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.tiltSettings, T.tiltSettingsDesc));
  }

  host.appendChild(foliaBuildTuningPills(T.tiltColorScheme, [
    { value: 'default', label: T.tiltColorSchemeDefault },
    { value: 'swap', label: T.tiltColorSchemeSwap },
    { value: 'accentAll', label: T.tiltColorSchemeAccentAll },
    { value: 'primaryAll', label: T.tiltColorSchemePrimaryAll }
  ], 'colorScheme', binding));

  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'splitProbability', label: T.tiltSplitProbability,
    min: 0, max: 1, step: 0.05, format: 'percent'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'tiltStyleProbability', label: T.tiltStyleProbability,
    min: 0, max: 1, step: 0.05, format: 'percent'
  }, binding));
}

/* ---------------- 回环（claddagh）----------------
 * settingsPanels.tsx:1142-1270 CladdaghSettingsPanel。 */

function foliaBuildCladdaghPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('claddagh');

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.claddaghSettings, T.claddaghSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.claddaghSettings, T.claddaghSettingsDesc));
  }

  /* 放大倍率显示的是「额外倍数 +1」：0.65 的弧长比在面板上读作 1.65x。 */
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'focusScaleRatio', label: T.claddaghFocusScaleRatio,
    min: 0, max: 1.5, step: 0.05, format: 'times', offset: 1
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'radiusScale', label: T.claddaghRadiusScale,
    min: 0.5, max: 1.5, step: 0.05, format: 'times'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'ellipseTiltDeg', label: T.claddaghEllipseTiltDeg,
    min: 0, max: 60, step: 1, format: 'deg'
  }, binding));

  host.appendChild(foliaModeTogglePills(
    T.claddaghShowAxisLine, 'showAxisLine', binding,
    T.partitaGuideLinesOn, T.partitaGuideLinesOff, false
  ));

  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'letterSpacingOffset', label: T.claddaghLetterSpacingOffset,
    min: -5, max: 20, step: 0.5, format: 'spacing'
  }, binding));
}

/* ---------------- 时计（pendolo）----------------
 * src/components/visualizer/pendolo/PendoloSettingsPanel.tsx:37-170。
 * 五项滑块 → 四组分段：齿轮饰线三档、中央渐变开关、封面开关、线条发光开关。 */

function foliaBuildPendoloPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('pendolo');

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.pendoloSettings, T.pendoloSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.pendoloSettings, T.pendoloSettingsDesc));
  }

  /* 轮盘水平位置：读数是 `+20% / 0%`（>0 才带正号），阈值 0 就是屏幕左边缘。 */
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'wheelCenterX', label: T.pendoloWheelCenterX,
    min: -0.2, max: 0.4, step: 0.01, format: 'signPercent'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'arcRadius', label: T.pendoloArcRadius,
    min: 0.25, max: 0.8, step: 0.01, format: 'percent'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'arcAngleDeg', label: T.pendoloArcAngleDeg,
    min: 40, max: 160, step: 5, format: 'deg'
  }, binding));

  /* 擒纵咬合力度是一位小数（Folia 是 `2.0x`），不是两位。 */
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'tickSnappiness', label: T.pendoloTickSnappiness,
    min: 0.5, max: 2, step: 0.1, format: 'times1'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'activeScale', label: T.pendoloActiveScale,
    min: 1, max: 1.6, step: 0.05, format: 'times'
  }, binding));

  host.appendChild(foliaBuildTuningPills(T.pendoloShowGearDecor, [
    { value: 'none', label: T.pendoloDecorNone },
    { value: 'subtle', label: T.pendoloDecorSubtle },
    { value: 'full', label: T.pendoloDecorFull }
  ], 'showGearDecor', binding));

  /* 三组开关的文案不统一（Folia 各用各的键）：开启/关闭、显示/隐藏、开启/关闭。 */
  host.appendChild(foliaModeTogglePills(
    T.pendoloShowCenterGradient, 'showCenterGradient', binding,
    T.pendoloToggleOn, T.pendoloToggleOff, false
  ));
  host.appendChild(foliaModeTogglePills(
    T.pendoloShowCoverOnWatchFace, 'showCoverOnWatchFace', binding,
    T.pendoloShowCoverOnWatchFaceOn, T.pendoloShowCoverOnWatchFaceOff, false
  ));
  host.appendChild(foliaModeTogglePills(
    T.pendoloEnableLineGlow, 'enableLineGlow', binding,
    T.pendoloToggleOn, T.pendoloToggleOff, false
  ));
}

/* ---------------- 商籁（sonnet）----------------
 * src/components/visualizer/sonnet/SonnetSettingsPanel.tsx:54-222。
 * 四段：渲染质量（纹素分辨率 + 性能提示）→ 动态与构图（三个 x 滑块）→
 * 后处理（总开关 + 七项，关着时整组不出现）→ 显示内容（外层边框三档 + 七个开关）。 */

function foliaBuildSonnetPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('sonnet');
  var tuning = binding.get();

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.sonnetSettings, T.sonnetSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.sonnetSettings, T.sonnetSettingsDesc));
  }

  /* 段 1：渲染质量。Folia 在段落里又套了一层圆角小框（:69-90），这里用子框等价。 */
  var quality = foliaTuningEl('div', 'fx-folia-tuning-section');
  quality.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.sonnetQualitySection));
  quality.appendChild(foliaBuildTuningGroup(null, [
    foliaBuildTuningControl({
      kind: 'slider', key: 'textureResolution', label: T.sonnetTextureResolution,
      min: 0.5, max: 4, step: 0.25, format: 'times'
    }, binding)
  ]));
  quality.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', T.sonnetTexturePerformanceWarning));
  host.appendChild(quality);

  /* 段 2：动态与构图。三个滑块都走 SonnetRangeControl 的默认区间 [0,2] / 0.05。 */
  host.appendChild(foliaBuildTuningSection(T.sonnetMotionSection, [
    { kind: 'slider', key: 'cameraIntensity', label: T.sonnetCameraIntensity, min: 0, max: 2, step: 0.05, format: 'times' },
    { kind: 'slider', key: 'typographyMotion', label: T.sonnetTypographyMotion, min: 0, max: 2, step: 0.05, format: 'times' },
    { kind: 'slider', key: 'mgDensity', label: T.sonnetMgDensity, min: 0, max: 2, step: 0.05, format: 'times' }
  ], binding));

  /* 段 3：后处理。开着才有下面七项（SonnetSettingsPanel.tsx:116 的条件渲染）。 */
  var post = foliaTuningEl('div', 'fx-folia-tuning-section');
  post.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.sonnetPostProcessSection));
  post.appendChild(foliaModeTogglePills(
    T.sonnetPostProcessEnabled, 'postProcessEnabled', binding,
    T.sonnetToggleOn, T.sonnetToggleOff, true
  ));
  if (tuning.postProcessEnabled) {
    var postControls = [
      { kind: 'slider', key: 'postProcessGrain', label: T.sonnetPostProcessGrain, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessContrast', label: T.sonnetPostProcessContrast, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessRgbShift', label: T.sonnetPostProcessRgbShift, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessLensDistortion', label: T.sonnetPostProcessLensDistortion, min: 0, max: 2, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessLensDispersion', label: T.sonnetPostProcessLensDispersion, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessHalftone', label: T.sonnetPostProcessHalftone, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessVignette', label: T.sonnetPostProcessVignette, min: 0, max: 2, step: 0.05, format: 'times' }
    ];
    for (var p = 0; p < postControls.length; p++) {
      post.appendChild(foliaBuildTuningControl(postControls[p], binding));
    }
  }
  host.appendChild(post);

  /* 段 4：显示内容。边框三档 → 七个开关（Folia 是两列网格，这里按行铺，顺序不变）。 */
  var display = foliaTuningEl('div', 'fx-folia-tuning-section');
  display.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.sonnetDisplaySection));
  display.appendChild(foliaBuildTuningPills(T.sonnetOuterFrameMode, [
    { value: 'none', label: T.sonnetOuterFrameNone },
    { value: 'frame', label: T.sonnetOuterFrameFrame },
    { value: 'full', label: T.sonnetOuterFrameFull }
  ], 'outerFrameMode', binding));
  var visibility = [
    { key: 'showOnlyText', label: T.sonnetShowOnlyText },
    { key: 'showGuide', label: T.sonnetShowGuide },
    { key: 'showBackgroundMg', label: T.sonnetShowBackgroundMg },
    { key: 'showFixedGeo', label: T.sonnetShowFixedGeo },
    { key: 'showGiantDecorativeText', label: T.sonnetShowGiantDecorativeText },
    { key: 'showBackgroundDecor', label: T.sonnetShowBackgroundDecor },
    { key: 'enableTransitions', label: T.sonnetEnableTransitions }
  ];
  for (var v = 0; v < visibility.length; v++) {
    display.appendChild(foliaModeTogglePills(
      visibility[v].label, visibility[v].key, binding,
      T.sonnetToggleOn, T.sonnetToggleOff, false
    ));
  }
  host.appendChild(display);
}

/* ---------------- 凝彩（tempera）----------------
 * src/components/visualizer/tempera/TemperaSettingsPanel.tsx:52-251。
 * 五段：渲染质量 → 动态与调色（三滑块 + 色彩模式）→ 后处理（总开关 + 六项）→
 * 歌词分镜（整句显示）→ 显示内容（五个开关）。
 *
 * 不做的一段：**画布图片**（TemperaImageLayerControls 506 行）。那一组是 IndexedDB 图池 +
 * 上传/导入/备份弹窗的全部实现，本项目还没有共享的自定义图上传器 —— 与漫游的
 * 「自定义图片」、莫奈的「上传背景图」同一个理由跳过。layerImages / layerImageDepth /
 * layerImageFrequency 仍留在 0l0 的规格表里，运行时照旧读得到（空清单）。 */

function foliaBuildTemperaPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('tempera');
  var tuning = binding.get();

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.temperaSettings, T.temperaSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.temperaSettings, T.temperaSettingsDesc));
  }

  /* 段 1：渲染质量（面板里是一层圆角小框 + 性能提示）。 */
  var quality = foliaTuningEl('div', 'fx-folia-tuning-section');
  quality.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.temperaQualitySection));
  quality.appendChild(foliaBuildTuningGroup(null, [
    foliaBuildTuningControl({
      kind: 'slider', key: 'textureResolution', label: T.temperaTextureResolution,
      min: 0.5, max: 4, step: 0.25, format: 'times'
    }, binding)
  ]));
  quality.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', T.temperaTexturePerformanceWarning));
  host.appendChild(quality);

  /* 段 2：动态与调色。入场时序的提示紧跟在它自己那一行后面（不是段尾）。 */
  var motion = foliaTuningEl('div', 'fx-folia-tuning-section');
  motion.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.temperaMotionSection));
  motion.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'cameraIntensity', label: T.temperaCameraIntensity,
    min: 0, max: 2, step: 0.05, format: 'times'
  }, binding));
  motion.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'glyphMotion', label: T.temperaGlyphMotion,
    min: 0, max: 2, step: 0.05, format: 'times'
  }, binding));
  motion.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'glyphSettleStretch', label: T.temperaGlyphSettleStretch,
    min: 0, max: 1, step: 0.05, format: 'times'
  }, binding));
  motion.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', T.temperaGlyphSettleStretchHint));
  motion.appendChild(foliaBuildTuningPills(T.temperaColorMode, [
    { value: 'duo', label: T.temperaColorModeDuo },
    { value: 'mono', label: T.temperaColorModeMono },
    { value: 'gradient', label: T.temperaColorModeGradient }
  ], 'colorMode', binding));
  host.appendChild(motion);

  /* 段 3：后处理。开关关着时下面六项整块不出现（:148 的条件渲染）。 */
  var post = foliaTuningEl('div', 'fx-folia-tuning-section');
  post.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.temperaPostProcessSection));
  post.appendChild(foliaModeTogglePills(
    T.temperaPostProcessEnabled, 'postProcessEnabled', binding,
    T.temperaToggleOn, T.temperaToggleOff, true
  ));
  if (tuning.postProcessEnabled) {
    post.appendChild(foliaModeTogglePills(
      T.temperaPostProcessTextureCompression, 'postProcessTextureCompression', binding,
      T.temperaToggleOn, T.temperaToggleOff, false
    ));
    post.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', T.temperaPostProcessTextureCompressionHint));
    var postControls = [
      { kind: 'slider', key: 'postProcessGrain', label: T.temperaPostProcessGrain, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessContrast', label: T.temperaPostProcessContrast, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessRgbShift', label: T.temperaPostProcessRgbShift, min: 0, max: 1, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessVignette', label: T.temperaPostProcessVignette, min: 0, max: 2, step: 0.05, format: 'times' },
      { kind: 'slider', key: 'postProcessLensDistortion', label: T.temperaPostProcessLensDistortion, min: 0, max: 2, step: 0.05, format: 'times' }
    ];
    for (var p = 0; p < postControls.length; p++) {
      post.appendChild(foliaBuildTuningControl(postControls[p], binding));
    }
  }
  host.appendChild(post);

  /* 段 4：歌词分镜。 */
  var lyric = foliaTuningEl('div', 'fx-folia-tuning-section');
  lyric.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.temperaLyricSection));
  lyric.appendChild(foliaModeTogglePills(
    T.temperaWholeLineLyrics, 'wholeLineLyrics', binding,
    T.temperaToggleOn, T.temperaToggleOff, false
  ));
  lyric.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', T.temperaWholeLineLyricsHint));
  host.appendChild(lyric);

  /* 段 5：显示内容（Folia 是两列网格，这里按行铺，顺序不变）。 */
  var display = foliaTuningEl('div', 'fx-folia-tuning-section');
  display.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.temperaDisplaySection));
  var visibility = [
    { key: 'showBlocks', label: T.temperaShowBlocks },
    { key: 'showDecor', label: T.temperaShowDecor },
    { key: 'showCornerMarks', label: T.temperaShowCornerMarks },
    { key: 'textInversion', label: T.temperaTextInversion },
    { key: 'enableTransitions', label: T.temperaEnableTransitions }
  ];
  for (var v = 0; v < visibility.length; v++) {
    display.appendChild(foliaModeTogglePills(
      visibility[v].label, visibility[v].key, binding,
      T.temperaToggleOn, T.temperaToggleOff, false
    ));
  }
  host.appendChild(display);
}

/* ---------------- 浮名（fume）----------------
 * settingsPanels.tsx:252-427 FumeSettingsPanel。
 * 顺序：两个「显示/隐藏」药丸 → 透明度 → 停留比例 → 摄影机速度 → 追焦方式（分段）→
 * 辉光 → 大标题比例。
 *
 * 注意这两组药丸的取值是**反的**（settingsPanels.tsx:274-277）：按钮「显示」绑定 false、
 * 「隐藏」绑定 true，因为字段名本身是 `hidePrintSymbols` / `disableGeometricBackground`。
 * 照抄 —— 默认值 disableGeometricBackground=true，所以第二组默认停在「隐藏」。 */

function foliaBuildFumeVisibilityPills(label, key, binding) {
  return foliaBuildTuningPills(label, [
    { value: false, label: FOLIA_MODE_PANEL_TEXT.partitaGuideLinesOn },
    { value: true, label: FOLIA_MODE_PANEL_TEXT.partitaGuideLinesOff }
  ], key, binding);
}

function foliaBuildFumePanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('fume');

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.fumeSettings, T.fumeSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.fumeSettings, T.fumeSettingsDesc));
  }

  host.appendChild(foliaBuildFumeVisibilityPills(T.fumeHidePrintSymbols, 'hidePrintSymbols', binding));
  host.appendChild(foliaBuildFumeVisibilityPills(T.fumeGeometricBackground, 'disableGeometricBackground', binding));

  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'backgroundObjectOpacity', label: T.fumeBackgroundObjectOpacity,
    min: 0, max: 1, step: 0.05, format: 'percent'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'textHoldRatio', label: T.fumeTextHoldRatio,
    min: 0, max: 1, step: 0.05, format: 'percent'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'cameraSpeed', label: T.fumeCameraSpeed,
    min: 0.55, max: 1.85, step: 0.05, format: 'times'
  }, binding));

  host.appendChild(foliaBuildTuningPills(T.fumeCameraTrackingMode, [
    { value: 'stepped', label: T.fumeCameraTrackingStepped },
    { value: 'smooth', label: T.fumeCameraTrackingSmooth }
  ], 'cameraTrackingMode', binding));

  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'glowIntensity', label: T.fumeGlowIntensity,
    min: 0, max: 1.8, step: 0.05, format: 'times'
  }, binding));
  /* 大标题比例是唯一 0.02 步长的滑块（其余都是 0.05）。 */
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'heroScale', label: T.fumeHeroScale,
    min: 0.82, max: 1.32, step: 0.02, format: 'times'
  }, binding));
}

/* ---------------- 镜台（diorama）----------------
 * settingsPanels.tsx:903-1138 + diorama/{DioramaEffectSettings 241, DioramaGeometrySettings 190,
 * DioramaParticleAppearanceSettings 156, DioramaBackgroundParticleSettings 148}。
 *
 * 这个面板比其它样式多两层结构，都照抄：
 * 1. **可折叠组**：标题按钮 + 右侧开关（DioramaSettingsToggle 是 role=switch 的滑钮，不是药丸）。
 *    折叠状态在 React 里是 useState(false)（默认收起），这里放在模块级表里 ——
 *    面板每次改值都会整块重建，状态必须活过重建。
 * 2. **强度四档**：弱/中/强 直接写 0.5/1/1.5，「自定义」只切档不写值，然后才出现 0.1~1.5 的滑块
 *    （DioramaEffectSettings.tsx:96-152）。当前值不在三档上时默认就停在「自定义」。
 *    开关关着时四档全部禁用（disabled={!enabled}）。
 * 3. 灵魂出窍的「当前字出窍」是它的**子开关**（没有自己的强度），画在父组展开体里。
 * 4. 点云几何：形态二选一（点云 / 长廊）→ 点云时四个子几何各一个开关 → 粒子外观三件套；
 *    整组关掉时子项变淡且禁用（Folia 的 opacity .52 + disabled）。
 * 5. 背景粒子：圆周 / 径向两个整数滑块，读数就是整数（不是百分比）。 */

var FOLIA_DIORAMA_PRESETS = [
  { key: 'low', value: 0.5, text: 'dioramaStrengthLow' },
  { key: 'mid', value: 1, text: 'dioramaStrengthMid' },
  { key: 'high', value: 1.5, text: 'dioramaStrengthHigh' }
];

var FOLIA_DIORAMA_CHILDREN = [
  { key: 'strands', text: 'dioramaGeometryStrands' },
  { key: 'blobs', text: 'dioramaGeometryBlobs' },
  { key: 'ribbons', text: 'dioramaGeometryRibbons' },
  { key: 'rings', text: 'dioramaGeometryRings' }
];

/* 折叠状态与「自定义档」状态：React 里是各组件自己的 useState，这里必须有地方存，
 * 否则改任何一项引起的面板重建都会把它们重置。 */
var foliaDioramaFold = {};
var foliaDioramaCustom = {};

function foliaDioramaIsPreset(value) {
  for (var i = 0; i < FOLIA_DIORAMA_PRESETS.length; i++) {
    if (Math.abs(FOLIA_DIORAMA_PRESETS[i].value - value) < 0.001) return true;
  }
  return false;
}

/* 滑钮（DioramaSettingsToggle.tsx 逐条照抄：role=switch + 圆钮）。 */
function foliaModeSwitchButton(checked, disabled, onChange) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-folia-tuning-switch' + (checked ? ' is-on' : '');
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', checked ? 'true' : 'false');
  if (disabled) btn.disabled = true;
  btn.appendChild(foliaTuningEl('span', 'fx-folia-tuning-switch-knob'));
  btn.addEventListener('click', function () {
    if (disabled) return;
    onChange();
  });
  return btn;
}

/* 折叠组：标题按钮（▶ + 标题）+ 右侧开关 + 展开体。foldKey 决定它记在哪一格。 */
function foliaModeFoldGroup(foldKey, title, headSwitch, bodyNodes) {
  var open = !!foliaDioramaFold[foldKey];
  var box = foliaTuningEl('div', 'fx-folia-tuning-fold' + (open ? ' open' : ''));
  box.setAttribute('data-folia-fold', foldKey);

  var head = foliaTuningEl('div', 'fx-folia-tuning-fold-head');
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fx-folia-tuning-fold-btn';
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.appendChild(foliaTuningEl('span', 'fx-folia-tuning-fold-chevron', '▶'));
  toggle.appendChild(foliaTuningEl('span', 'fx-folia-tuning-fold-title', title));
  /* 展开/收起只改 DOM 与模块级状态，不重建面板 —— 它不动任何调参值。 */
  toggle.addEventListener('click', function () {
    var next = !foliaDioramaFold[foldKey];
    foliaDioramaFold[foldKey] = next;
    box.classList.toggle('open', next);
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
  });
  head.appendChild(toggle);
  if (headSwitch) head.appendChild(headSwitch);
  box.appendChild(head);

  if (bodyNodes && bodyNodes.length) {
    var body = foliaTuningEl('div', 'fx-folia-tuning-fold-body');
    for (var i = 0; i < bodyNodes.length; i++) body.appendChild(bodyNodes[i]);
    box.appendChild(body);
  }
  return box;
}

/* 一行小开关（子几何 / 当前字出窍）。dim=true 时降透明度并禁用。 */
function foliaModeMiniSwitchRow(key, label, checked, disabled, onToggle) {
  var row = foliaTuningEl('div', 'fx-folia-tuning-mini-row' + (disabled ? ' is-dim' : ''));
  row.setAttribute('data-folia-tuning-key', key);
  row.appendChild(foliaTuningEl('span', 'fx-folia-tuning-mini-label', label));
  row.appendChild(foliaModeSwitchButton(checked, disabled, onToggle));
  return row;
}

/* 强度四档 + 自定义滑块。 */
function foliaDioramaStrengthBlock(ctlKey, binding, enabledKey, intensityKey) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var tuning = binding.get();
  var enabled = !!tuning[enabledKey];
  var intensity = tuning[intensityKey];
  if (foliaDioramaCustom[ctlKey] === undefined) {
    /* 当前值不在三档上 → 默认停在「自定义」（DioramaEffectSettings.tsx:63）。
     * 之后由用户选择决定，不再跟着数值漂（Folia 的 customMode 也是单向的）。 */
    foliaDioramaCustom[ctlKey] = !foliaDioramaIsPreset(intensity);
  }
  var custom = !!foliaDioramaCustom[ctlKey];

  var box = foliaTuningEl('div', 'fx-folia-tuning-section');
  box.appendChild(foliaTuningEl('div', 'fx-folia-tuning-subtitle', T.dioramaEffectStrength));

  var group = foliaTuningEl('div', 'fx-folia-tuning-pills');
  group.setAttribute('data-folia-tuning-key', intensityKey + 'Preset');
  var buttons = [];
  var paint = function () {
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].__active());
    }
  };
  for (var i = 0; i < FOLIA_DIORAMA_PRESETS.length; i++) {
    (function (preset) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fx-folia-tuning-pill';
      btn.textContent = T[preset.text];
      btn.disabled = !enabled;
      btn.__active = function () {
        return !custom && Math.abs(binding.get()[intensityKey] - preset.value) < 0.001;
      };
      btn.addEventListener('click', function () {
        if (!enabled) return;
        foliaDioramaCustom[ctlKey] = false;
        binding.set(foliaTuningPatch(intensityKey, preset.value));
        binding.commit();
        foliaRefreshTuningPanel();
      });
      buttons.push(btn);
      group.appendChild(btn);
    })(FOLIA_DIORAMA_PRESETS[i]);
  }
  (function () {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fx-folia-tuning-pill';
    btn.textContent = T.dioramaStrengthCustom;
    btn.disabled = !enabled;
    btn.__active = function () { return custom; };
    btn.addEventListener('click', function () {
      if (!enabled) return;
      /* 「自定义」只切档，不动数值（Folia 同：setCustomMode(true) 就返回）。 */
      foliaDioramaCustom[ctlKey] = true;
      foliaRefreshTuningPanel();
    });
    buttons.push(btn);
    group.appendChild(btn);
  })();
  paint();
  box.appendChild(group);

  if (enabled && custom) {
    box.appendChild(foliaBuildTuningControl({
      kind: 'slider', key: intensityKey, label: T.dioramaCustomStrength,
      min: 0.1, max: 1.5, step: 0.05, format: 'percent'
    }, binding));
  }
  return box;
}

/* 一个跟唱效果组：折叠 + 开关 + 强度 + （可选）子开关。 */
function foliaBuildDioramaEffect(ctlKey, title, enabledKey, intensityKey, subEffect) {
  var binding = foliaModePanelBinding('diorama');
  var tuning = binding.get();
  var enabled = !!tuning[enabledKey];

  var headSwitch = foliaModeSwitchButton(enabled, false, function () {
    binding.set(foliaTuningPatch(enabledKey, !enabled));
    binding.commit();
    foliaRefreshTuningPanel();
  });

  var body = [foliaDioramaStrengthBlock(ctlKey, binding, enabledKey, intensityKey)];
  if (subEffect) {
    body.push(foliaModeMiniSwitchRow(
      subEffect.key, subEffect.label, !!tuning[subEffect.key], false,
      function () {
        binding.set(foliaTuningPatch(subEffect.key, !binding.get()[subEffect.key]));
        binding.commit();
        foliaRefreshTuningPanel();
      }
    ));
  }
  return foliaModeFoldGroup('effect:' + ctlKey, title, headSwitch, body);
}

/* 点云几何组：形态二选一 → 四个子几何开关 → 粒子外观三件套。 */
function foliaBuildDioramaGeometry() {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('diorama');
  var tuning = binding.get();
  var vis = tuning.geometryVisibility || {};
  var enabled = !!vis.enabled;

  var headSwitch = foliaModeSwitchButton(enabled, false, function () {
    binding.set({ geometryVisibility: foliaDioramaPatchNested(vis, { enabled: !enabled }) });
    binding.commit();
    foliaRefreshTuningPanel();
  });

  var body = [];

  /* 形态：两粒药丸（Folia 是 flex-1 的两块按钮，语义与药丸一致）。 */
  var modeRow = foliaTuningEl('div', 'fx-folia-tuning-pills');
  modeRow.setAttribute('data-folia-tuning-key', 'geometryMode');
  [['clouds', T.dioramaGeometryModeClouds], ['corridor', T.dioramaGeometryModeCorridor]].forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fx-folia-tuning-pill' + ((vis.mode || 'clouds') === item[0] ? ' active' : '');
    btn.textContent = item[1];
    btn.disabled = !enabled;
    btn.addEventListener('click', function () {
      if (!enabled) return;
      binding.set({ geometryVisibility: foliaDioramaPatchNested(vis, { mode: item[0] }) });
      binding.commit();
      foliaRefreshTuningPanel();
    });
    modeRow.appendChild(btn);
  });
  body.push(modeRow);

  if ((vis.mode || 'clouds') === 'clouds') {
    for (var c = 0; c < FOLIA_DIORAMA_CHILDREN.length; c++) {
      (function (child) {
        body.push(foliaModeMiniSwitchRow(
          child.key, T[child.text], !!vis[child.key], !enabled,
          function () {
            var patch = {};
            patch[child.key] = !binding.get().geometryVisibility[child.key];
            binding.set({ geometryVisibility: foliaDioramaPatchNested(binding.get().geometryVisibility, patch) });
            binding.commit();
            foliaRefreshTuningPanel();
          }
        ));
      })(FOLIA_DIORAMA_CHILDREN[c]);
    }
  }

  /* 粒子外观：密度（整数 96~1536 步 24）、整体体积（0.65~1.60x）、整体辉光（开关 + 强度）。 */
  var appearance = foliaBuildTuningGroup(null, [
    foliaBuildTuningControl({
      kind: 'slider', key: 'particleDensity', label: T.dioramaParticleDensity,
      min: 96, max: 1536, step: 24, format: 'integer', disabledAlways: !enabled
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'particleScale', label: T.dioramaParticleScale,
      min: 0.65, max: 1.6, step: 0.05, format: 'times', disabledAlways: !enabled
    }, binding)
  ]);
  body.push(appearance);

  body.push(foliaModeMiniSwitchRow(
    'particleGlowEnabled', T.dioramaParticleGlow, !!tuning.particleGlowEnabled, !enabled,
    function () {
      binding.set(foliaTuningPatch('particleGlowEnabled', !binding.get().particleGlowEnabled));
      binding.commit();
      foliaRefreshTuningPanel();
    }
  ));
  if (tuning.particleGlowEnabled) {
    body.push(foliaBuildTuningControl({
      kind: 'slider', key: 'particleGlowIntensity', label: T.dioramaParticleGlowIntensity,
      min: 0.1, max: 1.5, step: 0.05, format: 'percent', disabledAlways: !enabled
    }, binding));
  }

  return foliaModeFoldGroup('geometry', T.dioramaGeometry, headSwitch, body);
}

/* geometryVisibility 是嵌套对象：Folia 每次都是 {...value, 改的那一项}，这里同构。 */
function foliaDioramaPatchNested(base, patch) {
  var out = {};
  var k;
  for (k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  }
  for (k in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
  }
  return out;
}

/* 背景粒子组：圆周 / 径向两个整数滑块。 */
function foliaBuildDioramaBackgroundParticles() {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('diorama');
  var tuning = binding.get();
  var enabled = !!tuning.showParticles;

  var headSwitch = foliaModeSwitchButton(enabled, false, function () {
    binding.set(foliaTuningPatch('showParticles', !enabled));
    binding.commit();
    foliaRefreshTuningPanel();
  });

  return foliaModeFoldGroup('particles', T.dioramaShowParticles, headSwitch, [
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundParticleCircumference', label: T.dioramaMoteCircumference,
      min: 4, max: 48, step: 2, format: 'integer', disabledAlways: !enabled
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundParticleRadial', label: T.dioramaMoteRadial,
      min: 1, max: 4, step: 1, format: 'integer', disabledAlways: !enabled
    }, binding)
  ]);
}

function foliaBuildDioramaPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('diorama');

  if (!(opts && opts.useFoldHeader === false)) {
    /* Folia 的镜台面板只有标题，没有说明行。 */
    foliaSetTuningFoldHeader(T.dioramaSettings, '');
  } else {
    host.appendChild(foliaBuildPanelIntro(T.dioramaSettings, ''));
  }

  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'cameraSpeed', label: T.dioramaCameraSpeed,
    min: 0.55, max: 1.85, step: 0.05, format: 'times'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'motionAmount', label: T.dioramaMotionAmount,
    min: 0.4, max: 1.6, step: 0.05, format: 'times'
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'slider', key: 'audioReactivity', label: T.dioramaAudioReactivity,
    min: 0, max: 1.5, step: 0.05, format: 'percent'
  }, binding));

  host.appendChild(foliaBuildDioramaEffect(
    'glow', T.dioramaGlowEffect, 'glowEnabled', 'glowIntensity', null
  ));
  host.appendChild(foliaBuildDioramaEffect(
    'soul', T.dioramaSoulEffect, 'soulEnabled', 'soulIntensity',
    { key: 'soulActiveEnabled', label: T.dioramaSoulActiveEffect }
  ));
  host.appendChild(foliaBuildDioramaEffect(
    'gradient', T.dioramaGradientEffect, 'gradientEnabled', 'gradientIntensity', null
  ));

  /* 关键字着色是普通开关行（不是可折叠组）。 */
  host.appendChild(foliaBuildSwitchRow({
    kind: 'switch', key: 'keywordColoringEnabled', label: T.dioramaKeywordColoring
  }, binding));

  host.appendChild(foliaBuildDioramaGeometry());
  host.appendChild(foliaBuildDioramaBackgroundParticles());
}

/* ---------------- 莫奈（monet，样式那份）----------------
 * src/components/visualizer/monet/MonetSettingsPanel.tsx:238-355（361 行里剩下的 clamp/局部组件）。
 * 三段（Folia 是三个圆角小框）：歌词样式 → 头像来源 → 频谱样式。
 *
 * 肖像图上传 / 清空 / 文件名回显（:264-311）已落地：00b 的图片池 + foliaBuildAssetUploadRow，
 * 落 IndexedDB（键 monet_portrait_image，与 Folia 同名），「自定义图片」这粒药丸按池里有没有图启用。
 * 画面侧由 0d 的 monetSyncPortrait 解析：
 *   portraitSource === 'custom' ? 自定义图 ?? 封面 : 封面 ?? 自定义图（VisualizerMonet.tsx:170）。
 *
 * 已知无画面的开关：关键字着色。本项目莫奈的逐词关键词着色尚未实现（wordColors 恒空），
 * 这一项存值但画面不变；留着是为了面板与 Folia 对齐，等逐词着色落地就自动生效。 */

function foliaBuildMonetModePanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('monet');
  /* 有没有可用肖像图：图片池的同步快照说了算（00b 的 foliaAssetGet('portrait')），
   * 旧的外部钩子 window.foliaMonetPortraitImage 留作兜底。 */
  var hasUploaded = (window.foliaAssetCount ? window.foliaAssetCount('portrait') > 0 : false)
    || !!(typeof window !== 'undefined' && window.foliaMonetPortraitImage
      && window.foliaMonetPortraitImage.url);
  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.monetSettings, T.monetSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.monetSettings, T.monetSettingsDesc));
  }

  /* 段 1：歌词样式。 */
  var lyrics = foliaBuildTuningSection(T.monetLyricsSection, [
    { kind: 'slider', key: 'fontScale', label: T.monetFontScale, min: 0.7, max: 1.5, step: 0.05, format: 'times' }
  ], binding);
  lyrics.appendChild(foliaBuildTuningPills(T.monetKeywordColoring, [
    { value: true, label: T.monetKeywordColoringOn },
    { value: false, label: T.monetKeywordColoringOff }
  ], 'keywordColoringEnabled', binding));
  lyrics.appendChild(foliaBuildTuningPills(T.monetShowDescription, [
    { value: true, label: T.partitaGuideLinesOn },
    { value: false, label: T.partitaGuideLinesOff }
  ], 'showDescription', binding));
  host.appendChild(lyrics);

  /* 段 2：头像来源。段标题用的是 cappella 的「头像来源」键（Folia 的复用）。 */
  var portrait = foliaTuningEl('div', 'fx-folia-tuning-section');
  portrait.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.monetPortraitSection));
  portrait.appendChild(foliaBuildTuningPills(T.monetPortraitSource, [
    { value: 'cover', label: T.monetPortraitSourceCover },
    { value: 'custom', label: T.monetPortraitSourceCustom, disabled: !hasUploaded }
  ], 'portraitSource', binding));
  /* 上传 / 清空 / 文件名（MonetSettingsPanel.tsx:264-311）。
   * Folia：上传成功把来源切到「自定义」；清空时若正停在「自定义」则退回「封面」。 */
  portrait.appendChild(foliaBuildAssetUploadRow('portrait', {
    scope: 'monet-portrait',
    label: '肖像图',
    uploadLabel: T.monetUploadPortrait,
    clearLabel: T.monetClearPortrait,
    successToast: T.monetPortraitUpdated,
    clearToast: T.monetPortraitCleared,
    onUploaded: function () {
      binding.set(foliaTuningPatch('portraitSource', 'custom'));
      binding.commit();
    },
    onCleared: function () {
      if (binding.get().portraitSource === 'custom') {
        binding.set(foliaTuningPatch('portraitSource', 'cover'));
        binding.commit();
      }
    }
  }));
  portrait.appendChild(foliaBuildTuningPills(T.monetPortraitStyle, [
    { value: 'rectangular', label: T.monetPortraitStyleRectangular },
    { value: 'square', label: T.monetPortraitStyleSquare }
  ], 'portraitStyle', binding));
  portrait.appendChild(foliaBuildTuningPills(T.monetPortraitDragHanger, [
    { value: true, label: T.monetPortraitDragHangerShow },
    { value: false, label: T.monetPortraitDragHangerHide }
  ], 'showPortraitDragHanger', binding));
  host.appendChild(portrait);

  /* 段 3：频谱样式（段标题与组标题同名，Folia 原样如此）。 */
  var audio = foliaTuningEl('div', 'fx-folia-tuning-section');
  audio.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', T.monetAudioSection));
  audio.appendChild(foliaBuildTuningPills(T.monetShowAudioVisualization, [
    { value: true, label: T.monetAudioVisualizationShow },
    { value: false, label: T.monetAudioVisualizationHide }
  ], 'showAudioVisualization', binding));
  audio.appendChild(foliaBuildTuningPills(T.monetAudioStyle, [
    { value: 'bar', label: T.monetAudioStyleBar },
    { value: 'line', label: T.monetAudioStyleLine }
  ], 'audioStyle', binding));
  host.appendChild(audio);
}

/* ---------------- 群唱（cappella）----------------
 * settingsPanels.tsx:441-803 CappellaSettingsPanel（363 行是本文件里最大的一块）。
 * 只做三段调参：显示表情包（显示/隐藏）→ 头像来源四档 → 表情包来源两档。
 *
 * 不做的一大段：**头像预览五格 + 表情包预览五格 + 上传 / 清除 / 反馈文案**
 * （:558-790，约占整个面板 2/3）。那一整块都是「自定义图片池」的界面：选文件 → 写 IndexedDB →
 * 出缩略图 → 统计张数。本项目还没有共享的自定义图上传器，与漫游 / 莫奈 / 凝彩画布图片同一个理由跳过。
 * 结果是「自定义」这两粒药丸永远不可选（Folia 在没有资源时也是 disabled），
 * 所以两个来源的实际取值永远落在 封面/内置/色块 与 内置 上。
 *
 * 注意药丸顺序：头像来源是 封面 → 内置头像 → 色块 → 自定义（settingsPanels.tsx:483-488）。 */

function foliaBuildCappellaPanel(host, opts) {
  var T = FOLIA_MODE_PANEL_TEXT;
  var binding = foliaModePanelBinding('cappella');
  /* 自定义头像 / 表情包都存在 IndexedDB 图片池里；本项目没有上传器，所以永远没有资源。 */
  var hasCustomAvatar = !!(typeof window !== 'undefined' && window.foliaCappellaCustomAvatar
    && window.foliaCappellaCustomAvatar.url);
  var hasCustomEmojiPack = !!(typeof window !== 'undefined' && window.foliaCappellaCustomEmojiPack
    && window.foliaCappellaCustomEmojiPack.length);

  if (!(opts && opts.useFoldHeader === false)) {
    foliaSetTuningFoldHeader(T.cappellaSettings, T.cappellaSettingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(T.cappellaSettings, T.cappellaSettingsDesc));
  }

  host.appendChild(foliaBuildTuningPills(T.cappellaShowEmoMessages, [
    { value: true, label: T.partitaGuideLinesOn },
    { value: false, label: T.partitaGuideLinesOff }
  ], 'showEmoMessages', binding));

  host.appendChild(foliaBuildTuningPills(T.cappellaAvatarSource, [
    { value: 'cover', label: T.cappellaAvatarSourceCover },
    { value: 'builtin', label: T.cappellaAvatarSourceBuiltin },
    { value: 'color', label: T.cappellaAvatarSourceColor },
    { value: 'custom', label: T.cappellaAvatarSourceCustom, disabled: !hasCustomAvatar }
  ], 'avatarSource', binding));

  host.appendChild(foliaBuildTuningPills(T.cappellaEmojiSource, [
    { value: 'builtin', label: T.cappellaEmojiSourceBuiltin },
    { value: 'custom', label: T.cappellaEmojiSourceCustom, disabled: !hasCustomEmojiPack }
  ], 'emojiPackSource', binding));
}

/* 注册到 0l 的面板注册表（mode 维度）。0l 先加载、注册表是全局对象，
 * 这里只往里加条目；foliaBuildTuningPanel 每次调用都现查，不需要额外的刷新入口。 */
FOLIA_TUNING_PANEL_REGISTRY.mode.classic = { build: foliaBuildClassicPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.partita = { build: foliaBuildPartitaPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.tilt = { build: foliaBuildTiltPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.claddagh = { build: foliaBuildCladdaghPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.pendolo = { build: foliaBuildPendoloPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.sonnet = { build: foliaBuildSonnetPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.tempera = { build: foliaBuildTemperaPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.fume = { build: foliaBuildFumePanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.diorama = { build: foliaBuildDioramaPanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.monet = { build: foliaBuildMonetModePanel };
FOLIA_TUNING_PANEL_REGISTRY.mode.cappella = { build: foliaBuildCappellaPanel };
