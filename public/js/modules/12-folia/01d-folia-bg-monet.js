/* Folia 背景 — 莫奈（monet）：封面图烘焙成海报底 + 可调布局/模糊/漂移
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/monet/）：
 *   entry.tsx（71）                     → mode 'monet' / order 20 / 布局快切 chip
 *   MonetBackgroundLayer.tsx（254）      → 两种布局的 DOM（full-overlay / half-pane-gradient）
 *   monetBackgroundDrift.ts（103）       → AE-wiggle 式漂移轨道（噪声采样成 157 帧关键帧）
 *   MonetBackgroundSettingsCard.tsx（457）→ 5 组设置（本轮不做面板，只留 tuning 读写口）
 * 管线（Folia: src/components/visualizer/monet/monetBackgroundPipeline.ts，361 行）：
 *   封面 → 1920×1080 画布（cover 裁切 + 可选 canvas blur）→ 逐像素后处理
 *   （灰度 / 饱和度 / 主题洗色）→ 叠渐变与 1px 竖纹 → toDataURL('image/jpeg', 0.92)
 *
 * 必须照抄的判据
 * --------------
 * 1. 两条布局分支的每一处数值：
 *      full-overlay  ：图铺满 root，backgroundSize cover / position center，
 *                      底色 = theme.backgroundColor，叠 readabilityGradient；
 *      half-pane     ：底色块 = backgroundColor + fallbackGradient，
 *                      图贴在左侧 72%（sm:68% / lg:60%），
 *                      蒙版 linear-gradient(90deg, 1 → .94@48% → .46@74% → 0@100%)，
 *                      图不透明度 = 0.3(夜) + overlay*0.16，位置 = clamp(50+offset, 10, 90)%，
 *                      再叠 scrim（.14/.28@28%/.62@64%/.86）+ bloom（18% 34% 的 accent 0.18）
 *                      + readabilityGradient。
 * 2. fallbackGradient / readabilityGradient 的色标与角度逐字照抄（见 foliaMonetGradients）。
 * 3. 管线输出 1920×1080、jpeg 0.92；canvas 支持 filter 时才在画布上模糊，否则退回
 *    元素级 blur(Npx) + scale(1.1)（Safari 的 ctx.filter 是「有但无效」的）。
 * 4. 逐像素后处理的**顺序**不能换：先灰度、再饱和度、最后洗色；洗色按「本像素亮度」查
 *    shadow→accent→highlight 三段线性（0.55 是折点），shadow/highlight 由主题背景色与主色
 *    的亮度排序决定（暗的当 shadow）。
 * 5. 烘焙 overlay：135° 线性（accent .08+.62·o / bg .16+.58·o / primary .06+.36·o）
 *    + 18% 34% 的 accent 径向（o*0.42）+ 右缘竖幕（0 → .18+.38·o）
 *    + 18 条 1px 竖纹（x=(i*127)%W、y=(i*211)%H-40、高 0.28H、色 bg .1+.08·o），
 *    竖纹受 backgroundStreaksEnabled 控制。
 * 6. 漂移轨道：240s 一圈、76 格噪声、157 个采样、最大位移 3.4%×strength、
 *    呼吸 0.035×strength、预放大 1 + 2·travel/100 + 0.01（防止位移把图边拖进画面）。
 *    交给 Web Animations API，compositor 自己跑，不占主线程帧。
 * 7. 缓存键 = 源 url / 上传图 id / 三个主题色 / 除布局与漂移外的 tuning 字段
 *    （布局与漂移是 DOM 侧的事，不进位图，所以不进键）。
 *
 * 与 Folia 的实现差异（都不是视觉差异）
 * ------------------------------------
 * 1. 没有 React / framer-motion：DOM 手建，交叉淡入用 CSS transition(800ms)，
 *    漂移用 element.animate 的原生关键帧（Folia 也是走 Web Animations，等价）。
 * 2. 两种布局**共用一棵 DOM**（pane 在全幅模式下宽 100% 且去掉蒙版），
 *    避免切布局时重建节点导致图重新淡入一次。Folia 是两棵不同的树。
 * 3. 本项目的主题只有暗色一套：isDaylight 恒为 false（half-pane 的图不透明度取 0.3 档）；
 *    也没有「透明背景」开关，transparentBackground 恒为 false。
 * 4. staticMode（Folia 的「静态模式」）对应本项目的 ctx.paused：暂停时漂移直接停，
 *    图停在当前帧（Folia 也是 `!staticMode` 才开漂移）。
 * 5. 本项目没有「全局上传背景图」的入口，面板上的「上传背景图 / 清空背景图 / 文件名」三件不做；
 *    backgroundSource 的 uploaded-global 档靠 `window.foliaMonetBackgroundImage = {id,url}` 这个
 *    等价钩子启用（与 01f 的 window.foliaNomandCustomImage 同一套约定），没有钩子时该档禁用。
 * 6. 位图缓存是**有界**的（FIFO 8 条）：Folia 的 Map 无上限，长时间换歌会一直涨。
 * 7. 图片来源走本项目的同源代理 coverProxySrc：CDN 直连会污染画布，getImageData 抛 SecurityError。
 * 8. tuning 在创建背景时读一次快照（与 Folia 从 config 取快照同义），面板接上后由
 *    foliaMonetPreviewTuning（拖动中，不落盘）/ foliaMonetSaveTuning（松手落盘）/ foliaMonetSetTuning
 *    （一步到位，控制台与冒烟用）改；改到影响位图的字段会按 180ms 防抖重烘焙。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaBackground !== 'function') return;

  var MONET_PIPELINE_DEBOUNCE_MS = 180;
  var MONET_WIDTH = 1920;
  var MONET_HEIGHT = 1080;
  var MONET_JPEG_QUALITY = 0.92;
  var MONET_CACHE_LIMIT = 8;
  var MONET_CROSSFADE_MS = 800;
  var MONET_TUNING_STORE_KEY = 'mineradio-folia-monet-tuning-v1';

  var MONET_SOURCES = ['cover-derived', 'uploaded-global'];
  var MONET_LAYOUTS = ['full-overlay', 'half-pane-gradient'];
  var MONET_WASH_MODES = ['theme', 'custom'];

  /* 漂移轨道常数（monetBackgroundDrift.ts:6-21）——逐字。 */
  var DRIFT_LOOP_SECONDS = 240;
  var DRIFT_LATTICE_POINTS = 76;
  var DRIFT_SAMPLE_COUNT = 156;
  var DRIFT_MAX_TRAVEL_PERCENT = 3.4;
  var DRIFT_BREATH_AMPLITUDE = 0.035;
  var DRIFT_OVERSCAN_MARGIN = 0.01;
  var DRIFT_SEED_X = 12.9898;
  var DRIFT_SEED_Y = 78.233;
  var DRIFT_SEED_SCALE = 39.425;

  var FALLBACK_DARK = { r: 10, g: 10, b: 12 };
  var FALLBACK_LIGHT = { r: 245, g: 245, b: 245 };

  /* types.ts:1003 DEFAULT_MONET_BACKGROUND_TUNING —— 逐字照抄。 */
  var MONET_TUNING_DEFAULT = {
    backgroundSource: 'cover-derived',
    backgroundLayout: 'full-overlay',
    backgroundBlurPx: 6,
    backgroundOverlayOpacity: 0.74,
    backgroundGrayscale: 0,
    backgroundSaturation: 1.05,
    backgroundWash: 0.34,
    backgroundHalfPaneOffsetX: 0,
    backgroundWashColorMode: 'theme',
    backgroundWashCustomColor: '#8fb7ff',
    backgroundDriftEnabled: true,
    backgroundDriftStrength: 0.5,
    backgroundStreaksEnabled: true
  };

  /* 半幅布局的蒙版（MonetBackgroundLayer.tsx:208-209）——逐字。 */
  var HALF_PANE_MASK = 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)';

  /* ---- 纯数值工具 ---- */

  function foliaMonetClampNumber(value, fallback, min, max) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function foliaMonetClamp01(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  /* 逐像素回写用：四舍五入到 0..255 的整数。 */
  function foliaMonetChannelByte(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    if (n < 0) n = 0;
    if (n > 255) n = 255;
    return Math.round(n);
  }

  function foliaMonetMix(from, to, amount) {
    return from + (to - from) * amount;
  }

  function foliaMonetLuminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function foliaMonetChannels(color) {
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

  /* colorWithAlpha：优先用核心的 foliaColorWithAlpha（与 Folia 的 colorMix 同形）。 */
  function foliaMonetRgba(color, alpha) {
    var a = foliaMonetClamp01(alpha);
    if (typeof foliaColorWithAlpha === 'function') return foliaColorWithAlpha(color, a);
    var channels = foliaMonetChannels(color) || FALLBACK_LIGHT;
    return 'rgba(' + Math.round(channels.r) + ', ' + Math.round(channels.g) + ', '
      + Math.round(channels.b) + ', ' + a + ')';
  }

  function foliaMonetResolveThemeChannel(color, fallback) {
    var parsed = foliaMonetChannels(color);
    if (!parsed) return fallback;
    return {
      r: foliaMonetClampNumber(parsed.r, fallback.r, 0, 255),
      g: foliaMonetClampNumber(parsed.g, fallback.g, 0, 255),
      b: foliaMonetClampNumber(parsed.b, fallback.b, 0, 255)
    };
  }

  /* ---- 洗色（monetBackgroundPipeline.ts:30-140）---- */

  function foliaMonetResolveWashEndpoints(background, primary) {
    var backgroundLuminance = foliaMonetLuminance(background.r, background.g, background.b);
    var primaryLuminance = foliaMonetLuminance(primary.r, primary.g, primary.b);
    return backgroundLuminance <= primaryLuminance
      ? { shadow: background, highlight: primary }
      : { shadow: primary, highlight: background };
  }

  function foliaMonetResolveWashColor(normalizedLuminance, background, accent, primary) {
    var ends = foliaMonetResolveWashEndpoints(background, primary);
    if (normalizedLuminance <= 0.55) {
      var amount = normalizedLuminance / 0.55;
      return {
        r: foliaMonetMix(ends.shadow.r, accent.r, amount),
        g: foliaMonetMix(ends.shadow.g, accent.g, amount),
        b: foliaMonetMix(ends.shadow.b, accent.b, amount)
      };
    }
    var high = (normalizedLuminance - 0.55) / 0.45;
    return {
      r: foliaMonetMix(accent.r, ends.highlight.r, high),
      g: foliaMonetMix(accent.g, ends.highlight.g, high),
      b: foliaMonetMix(accent.b, ends.highlight.b, high)
    };
  }

  /* ---- tuning ---- */

  function foliaMonetNormalizeHex(value, fallback) {
    var text = String(value == null ? '' : value).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(text)) return '#' + text.toLowerCase();
    return fallback;
  }

  /* 区间取 MonetBackgroundSettingsCard 的 min/max —— 逐条。 */
  function foliaMonetNormalizeTuning(value) {
    var raw = (value && typeof value === 'object') ? value : {};
    var d = MONET_TUNING_DEFAULT;
    return {
      backgroundSource: MONET_SOURCES.indexOf(raw.backgroundSource) >= 0 ? raw.backgroundSource : d.backgroundSource,
      backgroundLayout: MONET_LAYOUTS.indexOf(raw.backgroundLayout) >= 0 ? raw.backgroundLayout : d.backgroundLayout,
      backgroundBlurPx: foliaMonetClampNumber(raw.backgroundBlurPx, d.backgroundBlurPx, 0, 60),
      backgroundOverlayOpacity: foliaMonetClampNumber(raw.backgroundOverlayOpacity, d.backgroundOverlayOpacity, 0, 1),
      backgroundGrayscale: foliaMonetClampNumber(raw.backgroundGrayscale, d.backgroundGrayscale, 0, 1),
      backgroundSaturation: foliaMonetClampNumber(raw.backgroundSaturation, d.backgroundSaturation, 0, 2),
      backgroundWash: foliaMonetClampNumber(raw.backgroundWash, d.backgroundWash, 0, 1),
      backgroundHalfPaneOffsetX: foliaMonetClampNumber(raw.backgroundHalfPaneOffsetX, d.backgroundHalfPaneOffsetX, -40, 40),
      backgroundWashColorMode: MONET_WASH_MODES.indexOf(raw.backgroundWashColorMode) >= 0 ? raw.backgroundWashColorMode : d.backgroundWashColorMode,
      backgroundWashCustomColor: foliaMonetNormalizeHex(raw.backgroundWashCustomColor, d.backgroundWashCustomColor),
      backgroundDriftEnabled: typeof raw.backgroundDriftEnabled === 'boolean' ? raw.backgroundDriftEnabled : d.backgroundDriftEnabled,
      backgroundDriftStrength: foliaMonetClampNumber(raw.backgroundDriftStrength, d.backgroundDriftStrength, 0, 1),
      backgroundStreaksEnabled: typeof raw.backgroundStreaksEnabled === 'boolean' ? raw.backgroundStreaksEnabled : d.backgroundStreaksEnabled
    };
  }

  var foliaMonetTuningCache = null;

  function foliaMonetTuning() {
    if (foliaMonetTuningCache) return foliaMonetTuningCache;
    var raw = null;
    try {
      var text = window.localStorage ? window.localStorage.getItem(MONET_TUNING_STORE_KEY) : null;
      if (text) raw = JSON.parse(text);
    } catch (_) { raw = null; }
    foliaMonetTuningCache = foliaMonetNormalizeTuning(raw);
    return foliaMonetTuningCache;
  }

  function foliaMonetClearTuningCache() {
    foliaMonetTuningCache = null;
  }

  /* ---- 源与缓存键 ---- */

  function foliaMonetResolveSourceUrl(coverUrl, monetBackgroundImage, tuning) {
    var uploaded = monetBackgroundImage && monetBackgroundImage.url ? String(monetBackgroundImage.url) : null;
    var cover = coverUrl ? String(coverUrl) : null;
    if (tuning && tuning.backgroundSource === 'uploaded-global') return uploaded || cover || null;
    return cover || uploaded || null;
  }

  /* 上传图的外部入口：本项目还没有「共享自定义背景图」上传器，先留这个等价钩子
   * （与 01f 的 window.foliaNomandCustomImage 同一套约定）。 */
  function foliaMonetUploadedImage() {
    var image = window.foliaMonetBackgroundImage;
    if (!image || !image.url) return null;
    return { id: image.id ? String(image.id) : null, url: String(image.url) };
  }

  /* 同源代理：直连 CDN 的图会污染画布，后面 getImageData / toDataURL 都会抛 SecurityError。 */
  function foliaMonetCoverSrc(url) {
    if (!url) return '';
    try {
      if (typeof coverProxySrc === 'function') {
        var proxied = coverProxySrc(url);
        if (proxied) return proxied;
      }
    } catch (_) {}
    return String(url);
  }

  function foliaMonetCacheKey(options) {
    var theme = options.theme || {};
    var tuning = options.tuning || MONET_TUNING_DEFAULT;
    return JSON.stringify({
      sourceUrl: foliaMonetResolveSourceUrl(options.coverUrl, options.monetBackgroundImage, tuning),
      uploadedId: tuning.backgroundSource === 'uploaded-global'
        ? ((options.monetBackgroundImage && options.monetBackgroundImage.id) || null)
        : null,
      theme: {
        backgroundColor: theme.backgroundColor,
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor
      },
      tuning: {
        backgroundSource: tuning.backgroundSource,
        backgroundBlurPx: tuning.backgroundBlurPx,
        backgroundOverlayOpacity: tuning.backgroundOverlayOpacity,
        backgroundGrayscale: tuning.backgroundGrayscale,
        backgroundSaturation: tuning.backgroundSaturation,
        backgroundWash: tuning.backgroundWash,
        backgroundWashColorMode: tuning.backgroundWashColorMode,
        backgroundWashCustomColor: tuning.backgroundWashCustomColor,
        /* 漂移是 DOM 侧 transform，布局同理，都不进位图键；竖纹是烘进去的，必须进。 */
        backgroundStreaksEnabled: tuning.backgroundStreaksEnabled
      }
    });
  }

  /* ---- 载图 ---- */

  function foliaMonetLoadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      if (/^https?:\/\//i.test(src)) image.crossOrigin = 'anonymous';
      try { image.decoding = 'async'; } catch (_) {}
      var settle = function (fn, arg) {
        if (image.__monetSettled) return;
        image.__monetSettled = true;
        fn(arg);
      };
      image.onload = function () {
        if (typeof image.decode === 'function') {
          image.decode().then(function () { settle(resolve, image); }, function () { settle(resolve, image); });
        } else {
          settle(resolve, image);
        }
      };
      image.onerror = function () { settle(reject, new Error('莫奈背景图加载失败：' + src)); };
      image.src = src;
    });
  }

  /* ---- 画布能力探测（只探一次）---- */

  var foliaMonetCanvasFilterSupported = null;

  function foliaMonetCheckCanvasFilterSupport() {
    if (foliaMonetCanvasFilterSupported !== null) return foliaMonetCanvasFilterSupported;
    if (typeof document === 'undefined') return false;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      var ctx = canvas.getContext('2d');
      if (!ctx || typeof ctx.filter !== 'string') {
        foliaMonetCanvasFilterSupported = false;
        return false;
      }
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 2, 2);
      ctx.filter = 'blur(1px)';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, 1);
      var probe = ctx.getImageData(1, 1, 1, 1);
      foliaMonetCanvasFilterSupported = !!(probe && probe.data && probe.data[0] > 0);
    } catch (_) {
      foliaMonetCanvasFilterSupported = false;
    }
    return foliaMonetCanvasFilterSupported;
  }

  /* iOS Safari 的 ctx.filter 「有定义但无效」：这一步探测决定模糊放在画布还是元素上。 */

  function foliaMonetImageDimension(image, dimension, fallback) {
    var value = image ? image[dimension] : undefined;
    if (value === undefined) value = image ? image['natural' + (dimension === 'width' ? 'Width' : 'Height')] : undefined;
    return (typeof value === 'number' && isFinite(value) && value > 0) ? value : fallback;
  }

  function foliaMonetDrawCoverCropped(context, image, width, height) {
    var imageWidth = foliaMonetImageDimension(image, 'width', width);
    var imageHeight = foliaMonetImageDimension(image, 'height', height);
    if (!imageWidth || !imageHeight) return;
    var scale = Math.max(width / imageWidth, height / imageHeight);
    var drawWidth = imageWidth * scale;
    var drawHeight = imageHeight * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  /* ---- 逐像素后处理（顺序不能换：灰度 → 饱和度 → 洗色）---- */

  function foliaMonetApplyPostProcessing(context, width, height, theme, tuning) {
    var grayscale = foliaMonetClamp01(tuning.backgroundGrayscale);
    var saturation = foliaMonetClampNumber(tuning.backgroundSaturation, 1, 0, 2);
    var wash = foliaMonetClamp01(tuning.backgroundWash);
    if (grayscale <= 0 && Math.abs(saturation - 1) < 0.001 && wash <= 0) return;

    var imageData = context.getImageData(0, 0, width, height);
    var data = imageData.data;
    var background = foliaMonetResolveThemeChannel(theme.backgroundColor, FALLBACK_DARK);
    var accent = foliaMonetResolveThemeChannel(theme.accentColor, background);
    var primary = foliaMonetResolveThemeChannel(theme.primaryColor, FALLBACK_LIGHT);
    var customWash = foliaMonetResolveThemeChannel(tuning.backgroundWashCustomColor, accent);
    var washAccent = tuning.backgroundWashColorMode === 'custom' ? customWash : accent;

    for (var index = 0; index < data.length; index += 4) {
      var r = data[index];
      var g = data[index + 1];
      var b = data[index + 2];
      if (data[index + 3] === 0) continue;

      var luminance = foliaMonetLuminance(r, g, b);
      if (grayscale > 0) {
        r = foliaMonetMix(r, luminance, grayscale);
        g = foliaMonetMix(g, luminance, grayscale);
        b = foliaMonetMix(b, luminance, grayscale);
      }

      if (Math.abs(saturation - 1) >= 0.001) {
        var saturatedLuminance = foliaMonetLuminance(r, g, b);
        r = saturatedLuminance + (r - saturatedLuminance) * saturation;
        g = saturatedLuminance + (g - saturatedLuminance) * saturation;
        b = saturatedLuminance + (b - saturatedLuminance) * saturation;
      }

      if (wash > 0) {
        var washColor = foliaMonetResolveWashColor(foliaMonetClamp01(luminance / 255), background, washAccent, primary);
        r = foliaMonetMix(r, washColor.r, wash);
        g = foliaMonetMix(g, washColor.g, wash);
        b = foliaMonetMix(b, washColor.b, wash);
      }

      data[index] = foliaMonetChannelByte(r);
      data[index + 1] = foliaMonetChannelByte(g);
      data[index + 2] = foliaMonetChannelByte(b);
    }

    context.putImageData(imageData, 0, 0);
  }

  /* ---- 烘焙 overlay ---- */

  function foliaMonetPaintOverlay(context, width, height, theme, tuning) {
    var overlay = foliaMonetClamp01(tuning.backgroundOverlayOpacity);

    var overlayGradient = context.createLinearGradient(0, 0, width, height);
    overlayGradient.addColorStop(0, foliaMonetRgba(theme.accentColor, 0.08 + overlay * 0.62));
    overlayGradient.addColorStop(0.44, foliaMonetRgba(theme.backgroundColor, 0.16 + overlay * 0.58));
    overlayGradient.addColorStop(1, foliaMonetRgba(theme.primaryColor, 0.06 + overlay * 0.36));
    context.fillStyle = overlayGradient;
    context.fillRect(0, 0, width, height);

    var leftBloom = context.createRadialGradient(
      width * 0.18, height * 0.34, 0,
      width * 0.18, height * 0.34, width * 0.55
    );
    leftBloom.addColorStop(0, foliaMonetRgba(theme.accentColor, overlay * 0.42));
    leftBloom.addColorStop(1, foliaMonetRgba(theme.backgroundColor, 0));
    context.fillStyle = leftBloom;
    context.fillRect(0, 0, width, height);

    var rightVeil = context.createLinearGradient(width * 0.45, 0, width, 0);
    rightVeil.addColorStop(0, foliaMonetRgba(theme.backgroundColor, 0));
    rightVeil.addColorStop(1, foliaMonetRgba(theme.backgroundColor, 0.18 + overlay * 0.38));
    context.fillStyle = rightVeil;
    context.fillRect(0, 0, width, height);

    if (tuning.backgroundStreaksEnabled === false) return;

    context.fillStyle = foliaMonetRgba(theme.backgroundColor, 0.1 + overlay * 0.08);
    for (var index = 0; index < 18; index += 1) {
      var x = (index * 127) % width;
      var y = ((index * 211) % height) - 40;
      context.fillRect(x, y, 1, height * 0.28);
    }
  }

  /* ---- 位图构建 ---- */

  function foliaMonetBuildDataUrl(options) {
    var theme = options.theme || {};
    var tuning = options.tuning || MONET_TUNING_DEFAULT;
    var sourceUrl = foliaMonetResolveSourceUrl(options.coverUrl, options.monetBackgroundImage, tuning);
    if (!sourceUrl) return Promise.resolve(null);

    return foliaMonetLoadImage(foliaMonetCoverSrc(sourceUrl)).then(function (image) {
      var canvas = document.createElement('canvas');
      canvas.width = MONET_WIDTH;
      canvas.height = MONET_HEIGHT;
      var context = canvas.getContext('2d');
      if (!context) return null;

      context.fillStyle = theme.backgroundColor || '#05070b';
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.save();
      if (foliaMonetCheckCanvasFilterSupport()) {
        context.filter = 'blur(' + foliaMonetClampNumber(tuning.backgroundBlurPx, 0, 0, 60) + 'px)';
      }
      foliaMonetDrawCoverCropped(context, image, canvas.width, canvas.height);
      context.restore();

      foliaMonetApplyPostProcessing(context, canvas.width, canvas.height, theme, tuning);
      foliaMonetPaintOverlay(context, canvas.width, canvas.height, theme, tuning);

      try { return canvas.toDataURL('image/jpeg', MONET_JPEG_QUALITY); } catch (_) { return null; }
    });
  }

  /* 有界缓存：同一张封面 + 同一套主题/参数只烘焙一次。 */
  var foliaMonetBitmapCache = { keys: [], entries: {} };

  function foliaMonetResolveDataUrl(options) {
    var key = foliaMonetCacheKey(options);
    var entry = foliaMonetBitmapCache.entries[key];
    if (entry) return entry;
    var next = foliaMonetBuildDataUrl(options).catch(function () { return null; });
    foliaMonetBitmapCache.entries[key] = next;
    foliaMonetBitmapCache.keys.push(key);
    while (foliaMonetBitmapCache.keys.length > MONET_CACHE_LIMIT) {
      var oldest = foliaMonetBitmapCache.keys.shift();
      delete foliaMonetBitmapCache.entries[oldest];
    }
    return next;
  }

  /* ---- 漂移轨道（monetBackgroundDrift.ts）---- */

  function foliaMonetWrap(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
  }

  function foliaMonetHash(lattice, seed) {
    var value = Math.sin(lattice * 127.1 + seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function foliaMonetSmoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  /* 每 points 格精确重复一次的值噪声：这是整条轨道能无缝循环的原因。 */
  function foliaMonetPeriodicNoise(t, points, seed) {
    var cell = Math.floor(t);
    var from = foliaMonetHash(foliaMonetWrap(cell, points), seed);
    var to = foliaMonetHash(foliaMonetWrap(cell + 1, points), seed);
    return from + (to - from) * foliaMonetSmoothstep(t - cell);
  }

  /* 两层倍频，第二层给 AE 那种细碎抖动；结果以 0 为中心。 */
  function foliaMonetPeriodicFbm(t, seed) {
    var base = foliaMonetPeriodicNoise(t, DRIFT_LATTICE_POINTS, seed);
    var detail = foliaMonetPeriodicNoise(t * 2, DRIFT_LATTICE_POINTS * 2, seed + 17.31);
    return (base * 0.68 + detail * 0.32) * 2 - 1;
  }

  function foliaMonetNormalizeSamples(samples) {
    var peak = 0;
    for (var i = 0; i < samples.length; i++) {
      var abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    if (!(peak > 0)) return samples;
    var out = [];
    for (var j = 0; j < samples.length; j++) out.push(samples[j] / peak);
    return out;
  }

  /* 预放大必须大于 1 + 2·位移，否则位移会把图边拖进画面（DRIFT_OVERSCAN_MARGIN 是取整余量）。 */
  function foliaMonetBuildDriftTrack(strength) {
    var clamped = foliaMonetClamp01(strength);
    var travelPercent = DRIFT_MAX_TRAVEL_PERCENT * clamped;
    var minScale = 1 + (travelPercent / 100) * 2 + DRIFT_OVERSCAN_MARGIN;
    var breath = DRIFT_BREATH_AMPLITUDE * clamped;

    var rawX = [];
    var rawY = [];
    var rawScale = [];
    for (var index = 0; index <= DRIFT_SAMPLE_COUNT; index += 1) {
      var t = (DRIFT_LATTICE_POINTS * index) / DRIFT_SAMPLE_COUNT;
      rawX.push(foliaMonetPeriodicFbm(t, DRIFT_SEED_X));
      rawY.push(foliaMonetPeriodicFbm(t, DRIFT_SEED_Y));
      rawScale.push(foliaMonetPeriodicFbm(t, DRIFT_SEED_SCALE));
    }

    var x = foliaMonetNormalizeSamples(rawX);
    var y = foliaMonetNormalizeSamples(rawY);
    var scale = foliaMonetNormalizeSamples(rawScale);

    var keyframes = [];
    for (var i = 0; i < x.length; i++) {
      keyframes.push({
        transform: 'translate3d(' + (x[i] * travelPercent).toFixed(4) + '%, '
          + (y[i] * travelPercent).toFixed(4) + '%, 0) '
          + 'scale(' + (minScale + breath * ((scale[i] + 1) / 2)).toFixed(5) + ')'
      });
    }

    return {
      keyframes: keyframes,
      durationMs: DRIFT_LOOP_SECONDS * 1000,
      maxTravelPercent: travelPercent,
      minScale: minScale
    };
  }

  /* ---- 主题 → 两套渐变（MonetBackgroundLayer.tsx:77-84）---- */

  function foliaMonetGradients(theme) {
    var safe = theme || {};
    var bg = safe.backgroundColor || '#05070b';
    var accent = safe.accentColor || '#eef7ff';
    var primary = safe.primaryColor || '#d6f8ff';
    return {
      fallback: 'linear-gradient(135deg, ' + foliaMonetRgba(accent, 0.22) + ', '
        + foliaMonetRgba(bg, 0.96) + ' 50%, ' + foliaMonetRgba(primary, 0.18) + ')',
      readability: 'linear-gradient(90deg, ' + foliaMonetRgba(bg, 0.18) + ' 0%, '
        + foliaMonetRgba(bg, 0.32) + ' 34%, ' + foliaMonetRgba(bg, 0.66) + ' 70%, '
        + foliaMonetRgba(bg, 0.82) + ' 100%)',
      scrim: 'linear-gradient(90deg, ' + foliaMonetRgba(bg, 0.14) + ' 0%, '
        + foliaMonetRgba(bg, 0.28) + ' 28%, ' + foliaMonetRgba(bg, 0.62) + ' 64%, '
        + foliaMonetRgba(bg, 0.86) + ' 100%)',
      bloom: 'radial-gradient(circle at 18% 34%, ' + foliaMonetRgba(accent, 0.18) + ', transparent 36%)',
      /* 有源图但还没烘焙好时，先拿「角向渐变 + 原图」顶一下（同 Folia 的 resolvedBackgroundImage）。 */
      sourcePreview: 'linear-gradient(135deg, ' + foliaMonetRgba(accent, 0.2) + ', '
        + foliaMonetRgba(bg, 0.78) + ')'
    };
  }

  /* ---- DOM ---- */

  function foliaMonetEl(className) {
    var node = document.createElement('div');
    node.className = className;
    return node;
  }

  function foliaMonetDelay(fn, ms) {
    var schedule = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
      ? window.setTimeout
      : (typeof setTimeout === 'function' ? setTimeout : null);
    if (!schedule) { fn(); return null; }
    return schedule(fn, ms);
  }

  function foliaMonetCancelDelay(handle) {
    if (handle === null || handle === undefined) return;
    var cancel = (typeof window !== 'undefined' && typeof window.clearTimeout === 'function')
      ? window.clearTimeout
      : (typeof clearTimeout === 'function' ? clearTimeout : null);
    if (cancel) { try { cancel(handle); } catch (_) {} }
  }

  function foliaMonetBuildDom(inst) {
    var root = foliaMonetEl('folia-bg-monet');
    var base = foliaMonetEl('folia-bg-monet-base');
    var pane = foliaMonetEl('folia-bg-monet-pane');
    var drift = foliaMonetEl('folia-bg-monet-drift');
    var scrim = foliaMonetEl('folia-bg-monet-scrim');
    var bloom = foliaMonetEl('folia-bg-monet-bloom');
    var veil = foliaMonetEl('folia-bg-monet-veil');

    pane.appendChild(drift);
    root.appendChild(base);
    root.appendChild(pane);
    root.appendChild(scrim);
    root.appendChild(bloom);
    root.appendChild(veil);

    inst.root = root;
    inst.base = base;
    inst.pane = pane;
    inst.drift = drift;
    inst.scrim = scrim;
    inst.bloom = bloom;
    inst.veil = veil;
    return root;
  }

  function foliaMonetApplyTheme(inst) {
    var theme = inst.theme || {};
    var g = foliaMonetGradients(theme);
    inst.gradients = g;
    if (inst.root) inst.root.style.backgroundColor = theme.backgroundColor || '#05070b';
    if (inst.base) {
      inst.base.style.backgroundColor = theme.backgroundColor || '#05070b';
      inst.base.style.backgroundImage = g.fallback;
    }
    if (inst.scrim) inst.scrim.style.background = g.scrim;
    if (inst.bloom) inst.bloom.style.backgroundImage = g.bloom;
    if (inst.veil) inst.veil.style.background = g.readability;
  }

  /* 布局只用类切换：pane 在全幅模式下宽 100%、去蒙版，切布局时图不用重新淡入。 */
  function foliaMonetApplyLayout(inst) {
    var full = inst.tuning.backgroundLayout === 'full-overlay';
    if (full) inst.root.classList.add('is-full');
    else inst.root.classList.remove('is-full');
    if (full) inst.root.classList.remove('is-half');
    else inst.root.classList.add('is-half');
    if (full) {
      inst.pane.style.width = '100%';
      inst.pane.style.webkitMaskImage = 'none';
      inst.pane.style.maskImage = 'none';
    } else {
      inst.pane.style.width = '';
      inst.pane.style.webkitMaskImage = HALF_PANE_MASK;
      inst.pane.style.maskImage = HALF_PANE_MASK;
    }
  }

  /* 模糊放在画布上（烘焙时 blur）；画布不支持 filter 时才退回元素级 blur + 1.1 倍预放大。 */
  function foliaMonetBlurStyle(tuning) {
    if (foliaMonetCheckCanvasFilterSupport()) return { filter: '', transform: '' };
    var value = foliaMonetClampNumber(tuning.backgroundBlurPx, 0, 0, 60);
    if (value <= 0) return { filter: '', transform: '' };
    return { filter: 'blur(' + value + 'px)', transform: 'scale(1.1) translateZ(0)' };
  }

  function foliaMonetImageCss(inst) {
    var tuning = inst.tuning;
    var full = tuning.backgroundLayout === 'full-overlay';
    var g = inst.gradients || foliaMonetGradients(inst.theme);
    var blur = foliaMonetBlurStyle(tuning);

    var backgroundImage;
    if (inst.pipelineUrl) {
      backgroundImage = 'url("' + inst.pipelineUrl + '")';
    } else if (inst.sourceUrl) {
      backgroundImage = g.sourcePreview + ', url("' + foliaMonetCoverSrc(inst.sourceUrl) + '")';
    } else {
      backgroundImage = g.fallback;
    }

    var positionX = foliaMonetClampNumber(50 + tuning.backgroundHalfPaneOffsetX, 50, 10, 90);
    var imageOpacity = full
      ? 1
      : 0.3 + foliaMonetClamp01(tuning.backgroundOverlayOpacity) * 0.16;

    return {
      backgroundImage: backgroundImage,
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      backgroundPosition: full ? 'center' : (positionX + '% center'),
      backgroundColor: full ? (inst.theme && inst.theme.backgroundColor) || '#05070b' : '',
      opacity: imageOpacity,
      filter: blur.filter,
      transform: blur.transform
    };
  }

  function foliaMonetImageSignature(css) {
    /* 只有「图本身」变了才需要新建一层做交叉淡入；布局/不透明度/模糊都是就地改。 */
    return String(css.backgroundImage);
  }

  function foliaMonetApplyImageStyle(node, css) {
    node.style.backgroundImage = css.backgroundImage;
    node.style.backgroundRepeat = css.backgroundRepeat;
    node.style.backgroundSize = css.backgroundSize;
    node.style.backgroundPosition = css.backgroundPosition;
    node.style.backgroundColor = css.backgroundColor || 'transparent';
    node.style.filter = css.filter;
    node.style.transform = css.transform;
  }

  /* 换图 = 新建一层 0→目标淡入、旧层目标→0 淡出（Folia 的 AnimatePresence 0.8s）。 */
  function foliaMonetApplyImage(inst) {
    if (!inst.drift) return;
    var css = foliaMonetImageCss(inst);
    var signature = foliaMonetImageSignature(css);

    if (inst.imageNode && inst.imageSignature === signature) {
      foliaMonetApplyImageStyle(inst.imageNode, css);
      inst.imageNode.style.opacity = String(css.opacity);
      return;
    }

    var previous = inst.imageNode;
    var node = foliaMonetEl('folia-bg-monet-image');
    foliaMonetApplyImageStyle(node, css);
    node.style.opacity = '0';
    inst.drift.appendChild(node);
    inst.imageNode = node;
    inst.imageSignature = signature;

    /* 先落地 0 再写目标值，transition 才有起点；没有布局引擎时（单测桩）直接写目标值。 */
    if (typeof node.getBoundingClientRect === 'function') {
      try { node.getBoundingClientRect(); } catch (_) {}
    }
    node.style.transition = 'opacity ' + MONET_CROSSFADE_MS + 'ms ease-in-out';
    node.style.opacity = String(css.opacity);

    if (previous) {
      previous.style.transition = 'opacity ' + MONET_CROSSFADE_MS + 'ms ease-in-out';
      previous.style.opacity = '0';
      foliaMonetCancelDelay(inst.fadeTimer);
      inst.fadeTimer = foliaMonetDelay(function () {
        inst.fadeTimer = null;
        if (previous.parentNode) previous.parentNode.removeChild(previous);
      }, MONET_CROSSFADE_MS);
    }
  }

  /* 漂移：只在「开着 + 强度>0 + 没暂停」时挂 WAAPI 动画，其余情况直接取消（省合成层）。 */
  function foliaMonetSyncDrift(inst) {
    var tuning = inst.tuning;
    var strength = foliaMonetClamp01(tuning.backgroundDriftStrength);
    var enabled = !!tuning.backgroundDriftEnabled && !inst.paused && strength > 0;
    var wanted = enabled ? strength : 0;

    if (inst.driftNode === undefined || inst.driftNode === null) inst.driftNode = inst.drift;

    if (inst.driftAnimation && inst.driftEnvelope === wanted) return;
    if (inst.driftAnimation) {
      try { inst.driftAnimation.cancel(); } catch (_) {}
      inst.driftAnimation = null;
    }
    inst.driftEnvelope = wanted;
    inst.driftTrack = enabled ? foliaMonetBuildDriftTrack(strength) : null;

    if (!enabled || !inst.driftNode || typeof inst.driftNode.animate !== 'function') {
      if (inst.driftNode) inst.driftNode.style.transform = 'none';
      return;
    }

    try {
      inst.driftAnimation = inst.driftNode.animate(inst.driftTrack.keyframes, {
        duration: inst.driftTrack.durationMs,
        iterations: Infinity,
        easing: 'linear'
      });
    } catch (_) {
      inst.driftAnimation = null;
    }
  }

  /* ---- 位图流水线：180ms 防抖 + token 作废 ---- */

  function foliaMonetSchedulePipeline(inst) {
    if (!inst || inst.destroyed) return;
    var options = {
      coverUrl: inst.coverUrl,
      monetBackgroundImage: inst.monetBackgroundImage,
      theme: inst.theme,
      tuning: inst.tuning
    };
    var key = foliaMonetCacheKey(options);
    /* 同一套输入只排一次（无论成功还是失败）：失败重试交给用户换歌/改设置来触发。 */
    if (key === inst.pipelineRequestedKey) return;
    inst.pipelineRequestedKey = key;
    inst.pipelineKey = key;
    inst.pipelinePending = true;
    inst.pipelineToken += 1;
    var token = inst.pipelineToken;

    foliaMonetCancelDelay(inst.pipelineTimer);
    inst.pipelineTimer = foliaMonetDelay(function () {
      inst.pipelineTimer = null;
      if (inst.destroyed || token !== inst.pipelineToken) return;
      var resolved = foliaMonetResolveDataUrl(options);
      if (!resolved || typeof resolved.then !== 'function') return;
      resolved.then(function (url) {
        if (inst.destroyed || token !== inst.pipelineToken) return;
        inst.pipelinePending = false;
        inst.pipelineUrl = url || null;
        foliaMonetApplyImage(inst);
      }, function () {
        if (inst.destroyed || token !== inst.pipelineToken) return;
        inst.pipelinePending = false;
        inst.pipelineUrl = null;
        foliaMonetApplyImage(inst);
      });
    }, MONET_PIPELINE_DEBOUNCE_MS);
  }

  function foliaMonetSetPaused(inst, paused) {
    if (inst.paused === paused) return;
    inst.paused = paused;
    if (paused) inst.root.classList.add('is-paused');
    else inst.root.classList.remove('is-paused');
    foliaMonetSyncDrift(inst);
  }

  /* ---- 生命周期 ---- */

  function foliaMonetCreate(host, ctx) {
    var tuning = foliaMonetTuning();
    var inst = {
      root: null,
      base: null,
      pane: null,
      drift: null,
      scrim: null,
      bloom: null,
      veil: null,
      imageNode: null,
      imageSignature: '',
      driftNode: null,
      driftAnimation: null,
      driftTrack: null,
      driftEnvelope: -1,
      gradients: null,
      tuning: tuning,
      theme: (ctx && ctx.theme) || {},
      coverUrl: String((ctx && ctx.song && ctx.song.coverUrl) || ''),
      monetBackgroundImage: foliaMonetUploadedImage(),
      sourceUrl: '',
      pipelineUrl: null,
      pipelineKey: '',
      pipelineRequestedKey: '',
      pipelinePending: false,
      pipelineTimer: null,
      pipelineToken: 0,
      fadeTimer: null,
      paused: false,
      destroyed: false
    };

    inst.sourceUrl = foliaMonetResolveSourceUrl(inst.coverUrl, inst.monetBackgroundImage, tuning) || '';

    foliaMonetBuildDom(inst);
    foliaMonetApplyTheme(inst);
    foliaMonetApplyLayout(inst);
    host.appendChild(inst.root);

    /* 先把「原图 + 角向渐变」铺上，烘焙结果到了再交叉淡入换掉。 */
    foliaMonetApplyImage(inst);
    foliaMonetSetPaused(inst, !!(ctx && ctx.paused));
    foliaMonetSyncDrift(inst);
    foliaMonetSchedulePipeline(inst);
    return inst;
  }

  function foliaMonetTick(inst, ctx) {
    if (!inst || inst.destroyed) return;

    var theme = (ctx && ctx.theme) || null;
    var coverUrl = String((ctx && ctx.song && ctx.song.coverUrl) || '');
    var dirty = false;

    if (theme && theme !== inst.theme) {
      inst.theme = theme;
      foliaMonetApplyTheme(inst);
      dirty = true;
    }
    if (coverUrl !== inst.coverUrl) {
      inst.coverUrl = coverUrl;
      inst.sourceUrl = foliaMonetResolveSourceUrl(inst.coverUrl, inst.monetBackgroundImage, inst.tuning) || '';
      foliaMonetApplyImage(inst);
      dirty = true;
    }
    if (dirty) foliaMonetSchedulePipeline(inst);

    foliaMonetSetPaused(inst, !!(ctx && ctx.paused));
  }

  function foliaMonetDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    inst.pipelineToken += 1;
    foliaMonetCancelDelay(inst.pipelineTimer);
    foliaMonetCancelDelay(inst.fadeTimer);
    inst.pipelineTimer = null;
    inst.fadeTimer = null;
    if (inst.driftAnimation) {
      try { inst.driftAnimation.cancel(); } catch (_) {}
      inst.driftAnimation = null;
    }
    if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
  }

  /* 设置面板接上后调这里：先落存档，再就地生效（影响位图的字段会重烘焙）。
   * target 只给单测用（指定实例）；正式调用只传 patch，作用在 foliaWorld.bgInstance 上。 */
  function foliaMonetReadStoredTuning() {
    var raw = null;
    try {
      var stored = window.localStorage ? window.localStorage.getItem(MONET_TUNING_STORE_KEY) : null;
      if (stored) raw = JSON.parse(stored);
    } catch (_) { raw = null; }
    return foliaMonetNormalizeTuning(raw);
  }

  function foliaMonetWriteStoredTuning(tuning) {
    try {
      if (window.localStorage) window.localStorage.setItem(MONET_TUNING_STORE_KEY, JSON.stringify(tuning));
    } catch (_) {}
  }

  /* 合并 + 就地生效；persist=false 只改内存（面板拖动中每帧走这条，松手再 Save）。
   * 基准取内存缓存并**克隆一份**（normalize 会生成新对象）：直接改缓存对象会让
   * inst.tuning 与 next 变成同一份，后面按字段比较的「换了哪一类」判断全失效。 */
  function foliaMonetMergeTuning(patch, target, persist) {
    if (!patch || typeof patch !== 'object') return { tuning: null, changed: false };
    var next = foliaMonetNormalizeTuning(foliaMonetTuning());
    var normalized = foliaMonetNormalizeTuning(patch);
    var changed = false;
    for (var key in MONET_TUNING_DEFAULT) {
      if (!Object.prototype.hasOwnProperty.call(MONET_TUNING_DEFAULT, key)) continue;
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      if (next[key] !== normalized[key]) {
        next[key] = normalized[key];
        changed = true;
      }
    }
    if (!changed) return { tuning: next, changed: false };

    if (persist) foliaMonetWriteStoredTuning(next);
    /* 缓存留着新值：preview 不落盘，但紧接着的 get()/重烘焙都要看到它。 */
    foliaMonetTuningCache = next;

    /* 就地生效：布局/图/漂移都不重建实例，只有位图相关字段会重烘焙。 */
    var inst = target || ((typeof foliaWorld !== 'undefined' && foliaWorld) ? foliaWorld.bgInstance : null);
    if (inst && !inst.destroyed && inst.tuning) {
      inst.tuning = next;
      /* 换来源要重解析原图（uploaded-global 优先取上传图，否则封面优先、上传图兜底）。 */
      inst.monetBackgroundImage = foliaMonetUploadedImage();
      var resolvedSource = foliaMonetResolveSourceUrl(inst.coverUrl, inst.monetBackgroundImage, next) || '';
      if (resolvedSource !== inst.sourceUrl) inst.sourceUrl = resolvedSource;
      foliaMonetApplyLayout(inst);
      foliaMonetApplyImage(inst);
      foliaMonetSyncDrift(inst);
      foliaMonetSchedulePipeline(inst);
    }
    return { tuning: next, changed: true };
  }

  /* 对外：set = 改 + 落盘（旧语义不变）；preview = 只改内存（面板拖动中）；
   * save = 把当前缓存落盘（面板松手）；reset = 全键回默认。 */
  function foliaMonetSetTuning(patch, target) {
    return foliaMonetMergeTuning(patch, target, true).tuning;
  }

  function foliaMonetPreviewTuning(patch, target) {
    return foliaMonetMergeTuning(patch, target, false).tuning;
  }

  function foliaMonetSaveTuning() {
    foliaMonetWriteStoredTuning(foliaMonetTuning());
  }

  function foliaMonetResetTuning(target) {
    var defaults = foliaMonetNormalizeTuning(null);
    var patch = {};
    for (var key in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) patch[key] = defaults[key];
    }
    foliaMonetClearTuningCache();
    return foliaMonetMergeTuning(patch, target, true).tuning || defaults;
  }

  /* 设置面板 / 控制台入口：读当前 tuning、写存档并就地生效。
   * （与 foliaWorld* 一样挂在全局上：面板是另一批文件，拿不到本 IIFE 的私有函数。） */
  window.foliaMonetTuning = foliaMonetTuning;
  window.foliaMonetSetTuning = foliaMonetSetTuning;
  window.foliaMonetPreviewTuning = foliaMonetPreviewTuning;
  window.foliaMonetSaveTuning = foliaMonetSaveTuning;
  window.foliaMonetResetTuning = foliaMonetResetTuning;

  /* 名字 / 排序取 Folia 权威值：
   *   options.visualizerBackgroundModeMonet = 莫奈（zh-CN.ts:2083）
   *   monet/entry.tsx: order 20 / labelFallback 'Monet'
   * 描述取 zh-CN.ts:470 的 pickerDescription。 */
  registerFoliaBackground('monet', {
    name: '莫奈',
    desc: '把封面或自定义图铺成背景，可调布局、模糊与漂移',
    order: 20,
    needsWebGL2: false,
    create: foliaMonetCreate,
    tick: foliaMonetTick,
    destroy: foliaMonetDestroy
  });
})();
