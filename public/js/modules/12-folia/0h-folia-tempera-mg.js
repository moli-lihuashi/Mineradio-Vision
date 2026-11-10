/* Folia 凝彩（tempera）几何/配色图库 —— 与运行时机零耦合的纯逻辑层。
 *
 * 源文件（Folia: src/components/visualizer/）：
 *   visualizerSeedHash.ts      → §1 确定性散列
 *   colorMix.ts                → §2 颜色混合
 *   tempera/temperaPalette.ts  → §3 调色板（mono / duo / gradient 三模式）
 *   tempera/temperaHatch.ts    → §4 网点/网纹几何（凸多边形裁剪）
 *   tempera/temperaCurves.ts   → §5 曲线几何（凸/凹都出成扁平多边形）
 *   tempera/temperaShapes.ts   → §6 Pixi Graphics 工厂
 *
 * 必须照抄的判据（改动任何一条都会让画面与 Folia 不一致）：
 *  1. 散列是 FNV-1a 32 位 + imul 混合，`>>> 0` 归一；不许换成 Math.random。
 *  2. `mixTemperaSeed` 的盐乘法是 2654435761（Knuth），不是随便一个质数。
 *  3. mono 模式把 ink/paper 都塌成 Rec.709 灰，且 paper/ink 亮度差 < 96 时强制推到
 *     0xf2f2f2 / 0x141414；duo 模式的 ink 对比度下限是 96（MIN_INK_CONTRAST）。
 *  4. tone ladder 的四档混合位置固定 [0.12, 0.30, 0.52, 0.72]；染色后必须
 *     `matchLuminance` 拉回原档亮度，否则档序会被色相打乱。
 *  5. gradient 模式的 ramp 先按亮度排序、再按 paper→ink 方向决定是否 reverse，
 *     每档与色相 0.78 混合后同样 `matchLuminance`。
 *  6. textGradient **不**上 ink 阶梯，只做「离 paper 亮度差 ≥ 88」的可读性推离。
 *  7. `buildHatchLines` 只对凸多边形成立（按边半平面裁剪），凹形状不许喂进来。
 *  8. 网纹扫掠步数是 `min(160, ceil(diag/(spacing*2))+2)`，双向各扫一遍，
 *     上限 MAX_HATCH_LINES=320。
 *  9. `drawPolygonFillWithHoles` 的节点只能有一条 fill 指令 —— `cut()` 会回溯
 *     收集它之前的所有指令，多一条 fill/stroke 就会把洞一起吃掉。
 * 10. 所有工厂返回的节点是**静态成品**：播放期只改变换与 alpha，不再改几何。
 *
 * 与 Folia 的实现差异：
 *  - 项目里没有 TS，全部是 ES5 函数 + var（宿主文件风格一致）。
 *  - `import type` 全部去掉；跨模块调用改成同文件函数。
 *  - 本文件不注册模式、不建 pixi app。宿主（0h-folia-mode-tempera.js）经
 *    `window.foliaTemperaMg` 取用。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  /* ============================== 1. 确定性散列 ============================== */
  /* visualizerSeedHash.ts：不依赖全局随机状态，seek / 重建 / 预热都得到同一帧。 */

  function temperaHashSeed(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function temperaMixSeed(seed, salt) {
    return Math.imul((Math.trunc(seed) ^ salt) >>> 0, 2654435761) >>> 0;
  }

  function temperaHash01(seed, index, salt) {
    return temperaMixSeed(seed + Math.imul(index + 1, 97), salt) / 4294967296;
  }

  /* 挑一个与上一次不同的确定性选项（能不同就不同）。 */
  function temperaChooseWithoutRepeat(choices, seed, previous) {
    var start = temperaHashSeed(seed) % choices.length;
    for (var offset = 0; offset < choices.length; offset += 1) {
      var candidate = choices[(start + offset) % choices.length];
      if (candidate !== previous) return candidate;
    }
    return choices[start];
  }

  /* ============================== 2. 颜色混合 ============================== */
  /* colorMix.ts：渲染色每帧都要，字符串解析是热点，所以逐串缓存。 */

  function temperaClamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function temperaMixNumber(from, to, amount) {
    return from + (to - from) * amount;
  }

  var TEMPERA_FALLBACK_RGB = { r: 255, g: 255, b: 255 };

  function temperaFormatRgba(channels, alpha) {
    return 'rgba(' + Math.round(temperaClamp(channels.r, 0, 255)) + ', '
      + Math.round(temperaClamp(channels.g, 0, 255)) + ', '
      + Math.round(temperaClamp(channels.b, 0, 255)) + ', ' + alpha + ')';
  }

  /* 'fallback' = 想当颜色但解析不出来；'passthrough' = 命名色 / hsl() 等原样返回。 */
  function temperaReadColor(normalizedColor) {
    if (!normalizedColor) return 'fallback';

    if (normalizedColor.charAt(0) === '#') {
      var hex = normalizedColor.slice(1);
      var parse = function (value) { return Number.parseInt(value, 16); };

      if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return {
          r: parse(hex.charAt(0) + hex.charAt(0)),
          g: parse(hex.charAt(1) + hex.charAt(1)),
          b: parse(hex.charAt(2) + hex.charAt(2))
        };
      }

      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return {
          r: parse(hex.slice(0, 2)),
          g: parse(hex.slice(2, 4)),
          b: parse(hex.slice(4, 6))
        };
      }

      return 'fallback';
    }

    var rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
      var parts = rgbMatch[1].split(',').slice(0, 3).map(function (part) {
        return Number.parseFloat(part.trim());
      });
      var allFinite = parts.every(function (value) { return Number.isFinite(value); });
      if (allFinite) return { r: parts[0], g: parts[1], b: parts[2] };
      return 'fallback';
    }

    return 'passthrough';
  }

  var temperaParsedColors = new Map();
  var TEMPERA_PARSED_COLOR_LIMIT = 512;

  function temperaRememberBounded(cache, key, value, limit) {
    if (!cache.has(key) && cache.size >= limit) {
      var oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
  }

  function temperaParseColor(color) {
    var normalized = typeof color === 'string' ? color.trim() : '';
    var parsed = temperaParsedColors.get(normalized);
    if (parsed === undefined) {
      parsed = temperaRememberBounded(
        temperaParsedColors, normalized, temperaReadColor(normalized), TEMPERA_PARSED_COLOR_LIMIT
      );
    }
    return { normalized: normalized, parsed: parsed };
  }

  function temperaColorWithAlpha(color, alpha) {
    var normalizedAlpha = temperaClamp(alpha, 0, 1);
    var read = temperaParseColor(color);
    if (read.parsed === 'passthrough') return read.normalized;
    return temperaFormatRgba(
      read.parsed === 'fallback' ? TEMPERA_FALLBACK_RGB : read.parsed, normalizedAlpha
    );
  }

  /* 返回通道副本或 null（不是 hex / rgb() 色）。 */
  function temperaParseColorChannels(color) {
    var parsed = temperaParseColor(color).parsed;
    if (typeof parsed === 'string') return null;
    return { r: parsed.r, g: parsed.g, b: parsed.b };
  }

  function temperaMixColors(from, to, amount, alpha) {
    var outAlpha = alpha === undefined ? 1 : alpha;
    var normalizedAmount = temperaClamp(amount, 0, 1);
    var fromParsed = temperaParseColor(from).parsed;
    var toParsed = temperaParseColor(to).parsed;

    if (typeof fromParsed === 'string' || typeof toParsed === 'string') {
      return temperaColorWithAlpha(normalizedAmount >= 0.5 ? to : from, outAlpha);
    }

    return 'rgba('
      + Math.round(temperaMixNumber(fromParsed.r, toParsed.r, normalizedAmount)) + ', '
      + Math.round(temperaMixNumber(fromParsed.g, toParsed.g, normalizedAmount)) + ', '
      + Math.round(temperaMixNumber(fromParsed.b, toParsed.b, normalizedAmount)) + ', '
      + temperaClamp(outAlpha, 0, 1) + ')';
  }

  /* ============================== 3. 调色板 ============================== */
  /* temperaPalette.ts：从当前主题侧推出色块调色板；mono 把每一档都塌成灰阶。 */

  /* 固定的 paper→ink 混合位置；网点层按 tone 序号映射到网纹密度。 */
  var TEMPERA_TONE_STOPS = [0.12, 0.3, 0.52, 0.72];

  function temperaPaletteLuminance(color) {
    var channels = temperaParseColorChannels(color);
    if (!channels) return 128;
    return channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722;
  }

  function temperaToGray(color, fallback) {
    var channels = temperaParseColorChannels(color);
    if (!channels) return fallback;
    var luminance = Math.round(channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722);
    return 'rgb(' + luminance + ', ' + luminance + ', ' + luminance + ')';
  }

  function temperaGrayLevel(color) {
    var channels = temperaParseColorChannels(color);
    return channels ? channels.r : 128;
  }

  var TEMPERA_MIN_INK_CONTRAST = 96;

  /* 保证 ink/paper 真的对比：很多主题把浅色主色配浅背景，歌词会读不出来。 */
  function temperaEnsureInkContrast(paper, ink) {
    if (Math.abs(temperaPaletteLuminance(ink) - temperaPaletteLuminance(paper))
      >= TEMPERA_MIN_INK_CONTRAST) return ink;
    var target = temperaPaletteLuminance(paper) < 128 ? '#f4f4f2' : '#141414';
    var tinted = temperaMixColors(target, ink, 0.14);
    return Math.abs(temperaPaletteLuminance(tinted) - temperaPaletteLuminance(paper))
      >= TEMPERA_MIN_INK_CONTRAST ? tinted : target;
  }

  /* 把染色后的颜色拉回未染档位的亮度，加色相就不会打乱档序。 */
  function temperaMatchLuminance(color, target) {
    var channels = temperaParseColorChannels(color);
    if (!channels) return target;
    var current = temperaPaletteLuminance(color);
    var wanted = temperaPaletteLuminance(target);
    if (current <= 0.5) return target;
    var gain = wanted / current;
    var scaled = {
      r: Math.round(Math.min(255, channels.r * gain)),
      g: Math.round(Math.min(255, channels.g * gain)),
      b: Math.round(Math.min(255, channels.b * gain))
    };
    /* 亮通道被截断就会失配，退回中性档。 */
    if (Math.abs(temperaPaletteLuminance(
      'rgb(' + scaled.r + ', ' + scaled.g + ', ' + scaled.b + ')'
    ) - wanted) > 1.5) return target;
    return 'rgb(' + scaled.r + ', ' + scaled.g + ', ' + scaled.b + ')';
  }

  function temperaBuildToneLadder(paper, ink, tintA, tintB) {
    var step = function (index, tint) {
      var base = temperaMixColors(paper, ink, TEMPERA_TONE_STOPS[index]);
      return tint ? temperaMatchLuminance(temperaMixColors(base, tint, 0.3), base) : base;
    };
    return {
      tone1: step(0, tintA),
      tone2: step(1, tintB),
      tone3: step(2, tintA),
      tone4: step(3)
    };
  }

  function temperaBuildGradientRamp(paper, ink, sources) {
    var usable = sources.map(function (color) { return color.trim(); }).filter(Boolean);
    var ranked = usable.slice().sort(function (a, b) {
      return temperaPaletteLuminance(a) - temperaPaletteLuminance(b);
    });
    var towardInk = temperaPaletteLuminance(ink) < temperaPaletteLuminance(paper);
    var ordered = towardInk ? ranked.reverse() : ranked;
    return TEMPERA_TONE_STOPS.map(function (stop, index) {
      var rung = temperaMixColors(paper, ink, stop);
      var hue = ordered[index % Math.max(ordered.length, 1)];
      return hue ? temperaMatchLuminance(temperaMixColors(rung, hue, 0.78), rung) : rung;
    });
  }

  /* 让封面色保持可辨认，同时保证它在 paper 上读得出来 —— 只推离亮度，不上 ink 阶梯。 */
  function temperaEnforceReadable(paper, color) {
    var paperLuminance = temperaPaletteLuminance(paper);
    if (Math.abs(temperaPaletteLuminance(color) - paperLuminance) >= 88) return color;
    var away = paperLuminance < 128 ? '#ffffff' : '#101010';
    for (var step = 1; step <= 5; step += 1) {
      var pushed = temperaMixColors(color, away, step * 0.16);
      if (Math.abs(temperaPaletteLuminance(pushed) - paperLuminance) >= 88) return pushed;
    }
    return temperaMixColors(color, away, 0.8);
  }

  /* 封面色里混入多少主题色：封面占主导，但纯封面 ramp 会完全丢掉用户配色。 */
  var TEMPERA_THEME_HUE_MIX = 0.32;

  function temperaBlendCoverWithTheme(cover, themeHues) {
    return cover.slice(0, 4).map(function (color, index) {
      return temperaMixColors(color, themeHues[index % themeHues.length], TEMPERA_THEME_HUE_MIX);
    });
  }

  function temperaBuildTextGradient(paper, sources) {
    var usable = sources.map(function (color) { return color.trim(); }).filter(Boolean);
    if (usable.length === 0) return null;
    var out = [];
    for (var index = 0; index < 4; index += 1) {
      out.push(temperaEnforceReadable(paper, usable[index % usable.length]));
    }
    return out;
  }

  function temperaResolvePalette(theme, tuning, coverColors) {
    var theme2 = theme || {};
    var mode = tuning && tuning.colorMode;
    var cover = coverColors || [];

    if (mode === 'mono') {
      var paper = temperaToGray(theme2.backgroundColor, '#111111');
      var ink = temperaToGray(theme2.primaryColor, '#f5f5f5');
      /* 主题 ink 是中灰时也要保证可读对比。 */
      if (Math.abs(temperaGrayLevel(ink) - temperaGrayLevel(paper)) < 96) {
        ink = temperaGrayLevel(paper) < 128 ? '#f2f2f2' : '#141414';
      }
      var mono = {
        paper: paper,
        ink: ink,
        blockA: temperaMixColors(paper, ink, 0.08),
        blockB: temperaMixColors(paper, ink, 0.18),
        blockC: temperaMixColors(paper, ink, 0.34),
        accent: temperaMixColors(paper, ink, 0.85),
        line: temperaColorWithAlpha(temperaMixColors(paper, ink, 0.55), 0.55),
        shadow: temperaColorWithAlpha(temperaMixColors(paper, ink, 0.75), 0.35),
        gradient: null,
        textGradient: null
      };
      var monoLadder = temperaBuildToneLadder(paper, ink);
      mono.tone1 = monoLadder.tone1;
      mono.tone2 = monoLadder.tone2;
      mono.tone3 = monoLadder.tone3;
      mono.tone4 = monoLadder.tone4;
      return mono;
    }

    var duoPaper = theme2.backgroundColor;
    var duoInk = temperaEnsureInkContrast(duoPaper, theme2.primaryColor);

    if (mode === 'gradient') {
      var themeHues = [theme2.accentColor, theme2.secondaryColor, theme2.primaryColor, duoInk];
      var hues = cover.length >= 2
        ? temperaBlendCoverWithTheme(cover, themeHues)
        : themeHues;
      var ramp = temperaBuildGradientRamp(duoPaper, duoInk, hues);
      return {
        paper: duoPaper,
        ink: duoInk,
        blockA: ramp[0],
        blockB: ramp[1],
        blockC: ramp[2],
        accent: theme2.accentColor,
        line: temperaColorWithAlpha(temperaMixColors(duoPaper, duoInk, 0.6), 0.5),
        shadow: temperaColorWithAlpha(temperaMixColors(duoPaper, duoInk, 0.8), 0.32),
        tone1: ramp[0],
        tone2: ramp[1],
        tone3: ramp[2],
        tone4: ramp[3],
        gradient: ramp,
        textGradient: temperaBuildTextGradient(duoPaper, hues)
      };
    }

    var duoLadder = temperaBuildToneLadder(
      duoPaper, duoInk, theme2.accentColor, theme2.secondaryColor
    );
    return {
      paper: duoPaper,
      ink: duoInk,
      blockA: temperaMixColors(duoPaper, theme2.accentColor, 0.55),
      blockB: temperaMixColors(duoPaper, theme2.secondaryColor, 0.6),
      blockC: temperaMixColors(duoPaper, duoInk, 0.78),
      accent: theme2.accentColor,
      line: temperaColorWithAlpha(temperaMixColors(duoPaper, duoInk, 0.6), 0.5),
      shadow: temperaColorWithAlpha(temperaMixColors(duoPaper, duoInk, 0.8), 0.32),
      /* duo 用同一套亮度阶梯，只把中间档染上主题色，
       * 这样网点构图在两种染色模式下读起来一致。 */
      tone1: duoLadder.tone1,
      tone2: duoLadder.tone2,
      tone3: duoLadder.tone3,
      tone4: duoLadder.tone4,
      gradient: null,
      textGradient: null
    };
  }

  /* ============================== 4. 网点几何 ============================== */
  /* temperaHatch.ts：纯几何、纯 seed，无 pixi、无 Math.random。 */

  var TEMPERA_TAU = Math.PI * 2;
  var TEMPERA_MAX_HATCH_LINES = 320;

  function temperaBuildHatchSpec(seed, salt, scale) {
    var zoom = scale === undefined ? 1 : scale;
    var angleIndex = Math.floor(temperaHash01(seed, 1, salt) * 4);
    var angles = [-Math.PI / 4, Math.PI / 4, -Math.PI / 3, Math.PI / 6];
    var angle = angles[angleIndex] === undefined ? Math.PI / 4 : angles[angleIndex];
    var density = Math.floor(temperaHash01(seed, 2, salt) * 3);
    var spacings = [9, 13, 18];
    var spacing = (spacings[density] === undefined ? 13 : spacings[density]) * zoom;
    var width = Math.max(0.8, spacing * (0.16 + temperaHash01(seed, 3, salt) * 0.14));
    return { angle: angle, spacing: spacing, width: width };
  }

  function temperaRectPolygon(x, y, width, height) {
    return [x, y, x + width, y, x + width, y + height, x, y + height];
  }

  /* 圆用凸多边形近似，好让网点裁剪器也能填圆窗。 */
  function temperaCirclePolygon(cx, cy, radius, segments) {
    var points = [];
    var count = Math.max(6, Math.round(segments === undefined ? 28 : segments));
    for (var index = 0; index < count; index += 1) {
      var angle = (index / count) * TEMPERA_TAU;
      points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }
    return points;
  }

  function temperaDiamondPolygon(cx, cy, rx, ry) {
    return [cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy];
  }

  /* 按边半平面裁剪一条无限直线；整条打不到形状就返回 null。 */
  function temperaClipToConvex(polygon, ax, ay, dx, dy, span) {
    var count = polygon.length / 2;
    var cx = 0;
    var cy = 0;
    for (var c = 0; c < count; c += 1) {
      cx += polygon[c * 2];
      cy += polygon[c * 2 + 1];
    }
    cx /= count;
    cy /= count;

    var tMin = -span;
    var tMax = span;
    for (var index = 0; index < count; index += 1) {
      var x0 = polygon[index * 2];
      var y0 = polygon[index * 2 + 1];
      var x1 = polygon[((index + 1) % count) * 2];
      var y1 = polygon[((index + 1) % count) * 2 + 1];
      var nx = y1 - y0;
      var ny = -(x1 - x0);
      /* 用质心把法线强制朝外。 */
      if (nx * (cx - x0) + ny * (cy - y0) > 0) {
        nx = -nx;
        ny = -ny;
      }
      var denominator = nx * dx + ny * dy;
      var numerator = nx * (ax - x0) + ny * (ay - y0);
      if (Math.abs(denominator) < 1e-9) {
        if (numerator > 0) return null;
        continue;
      }
      var t = -numerator / denominator;
      if (denominator > 0) tMax = Math.min(tMax, t);
      else tMin = Math.max(tMin, t);
      if (tMin > tMax) return null;
    }
    if (tMax - tMin < 0.5) return null;
    return {
      x1: ax + dx * tMin,
      y1: ay + dy * tMin,
      x2: ax + dx * tMax,
      y2: ay + dy * tMax
    };
  }

  /* 用平行笔画填凸多边形；coverage(0..1) 从中心向外收放，
   * 让网纹可以在 shot 入场时「张开」。 */
  function temperaBuildHatchLines(polygon, spec, coverage) {
    var cover = coverage === undefined ? 1 : coverage;
    if (polygon.length < 6 || spec.spacing <= 0) return [];
    var xs = [];
    var ys = [];
    for (var index = 0; index < polygon.length; index += 2) {
      xs.push(polygon[index]);
      ys.push(polygon[index + 1]);
    }
    var minX = Math.min.apply(null, xs);
    var maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);
    var centerX = (minX + maxX) / 2;
    var centerY = (minY + maxY) / 2;
    var diagonal = Math.hypot(maxX - minX, maxY - minY);
    if (diagonal <= 0) return [];

    var dx = Math.cos(spec.angle);
    var dy = Math.sin(spec.angle);
    /* 沿笔画方向的法线步进，扫完整个形状对角线。 */
    var px = -dy;
    var py = dx;
    /* 扫掠从中心双向进行，半条对角线就够。 */
    var steps = Math.min(
      TEMPERA_MAX_HATCH_LINES / 2,
      Math.ceil(diagonal / (spec.spacing * 2)) + 2
    );
    var clampedCoverage = Math.min(1, Math.max(0, cover));
    var lines = [];
    for (var step = -steps; step <= steps; step += 1) {
      var offset = step * spec.spacing;
      var clipped = temperaClipToConvex(
        polygon, centerX + px * offset, centerY + py * offset, dx, dy, diagonal
      );
      if (!clipped) continue;
      if (clampedCoverage >= 1) {
        lines.push(clipped);
        continue;
      }
      var midX = (clipped.x1 + clipped.x2) / 2;
      var midY = (clipped.y1 + clipped.y2) / 2;
      lines.push({
        x1: midX + (clipped.x1 - midX) * clampedCoverage,
        y1: midY + (clipped.y1 - midY) * clampedCoverage,
        x2: midX + (clipped.x2 - midX) * clampedCoverage,
        y2: midY + (clipped.y2 - midY) * clampedCoverage
      });
    }
    return lines;
  }

  /* 不用贴图的手绘感：带抖动的螺线折线，读起来像随手画的一圈scribble。 */
  function temperaBuildScribblePath(seed, salt, cx, cy, radius, turns) {
    var loops = turns === undefined ? 2 : turns;
    var perTurn = 13;
    var total = Math.max(perTurn, Math.round(perTurn * Math.max(1, loops)));
    var points = [];
    for (var index = 0; index <= total; index += 1) {
      var progress = index / total;
      var angle = progress * TEMPERA_TAU * Math.max(1, loops);
      var jitterR = (temperaHash01(seed, index, salt) - 0.5) * radius * 0.26;
      var jitterA = (temperaHash01(seed, index, salt + 7) - 0.5) * 0.22;
      var currentRadius = radius * (0.52 + 0.48 * progress) + jitterR;
      points.push(
        cx + Math.cos(angle + jitterA) * currentRadius,
        cy + Math.sin(angle + jitterA) * currentRadius * 0.82
      );
    }
    return points;
  }

  /* 海报构图底部的起伏边。 */
  function temperaBuildWavyPath(seed, salt, x0, x1, y, amplitude, steps) {
    var points = [];
    var safeSteps = Math.max(2, Math.round(steps === undefined ? 24 : steps));
    for (var index = 0; index <= safeSteps; index += 1) {
      var progress = index / safeSteps;
      var wave = Math.sin(progress * TEMPERA_TAU * 1.5 + temperaHash01(seed, 0, salt) * TEMPERA_TAU);
      var jitter = (temperaHash01(seed, index, salt) - 0.5) * amplitude * 0.5;
      points.push(x0 + (x1 - x0) * progress, y + wave * amplitude + jitter);
    }
    return points;
  }

  /* 沿一个方向等距排标记，每个标记带 seed 抖动，行不会读成印刷品。 */
  function temperaBuildMarkRow(seed, salt, x, y, count, spacing, size, angle) {
    var marks = [];
    var total = Math.max(0, Math.round(count));
    var dx = Math.cos(angle);
    var dy = Math.sin(angle);
    for (var index = 0; index < total; index += 1) {
      var jitter = (temperaHash01(seed, index, salt) - 0.5) * spacing * 0.16;
      var distance = index * spacing + jitter;
      marks.push({
        x: x + dx * distance,
        y: y + dy * distance,
        size: size * (0.82 + temperaHash01(seed, index, salt + 3) * 0.36),
        rotation: (temperaHash01(seed, index, salt + 11) - 0.5) * 0.3
      });
    }
    return marks;
  }

  function temperaBuildCrossRow(seed, salt, x, y, count, spacing, size, angle) {
    return temperaBuildMarkRow(
      seed, salt, x, y, count, spacing,
      size === undefined ? 9 : size,
      angle === undefined ? 0 : angle
    );
  }

  function temperaBuildDotRow(seed, salt, x, y, count, spacing, size, angle) {
    return temperaBuildMarkRow(
      seed, salt, x, y, count, spacing,
      size === undefined ? 4 : size,
      angle === undefined ? Math.PI / 2 : angle
    );
  }

  /* 整场铺在最底下的淡网点。 */
  function temperaBuildDotGrid(width, height, spacing, size) {
    var marks = [];
    var dotSize = size === undefined ? 1.6 : size;
    if (spacing <= 0 || width <= 0 || height <= 0) return marks;
    var columns = Math.min(200, Math.ceil(width / spacing) + 1);
    var rows = Math.min(200, Math.ceil(height / spacing) + 1);
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        /* 隔行错半格，格子才读成网点而不是网格。 */
        marks.push({
          x: column * spacing + (row % 2 === 0 ? 0 : spacing / 2),
          y: row * spacing,
          size: dotSize,
          rotation: 0
        });
      }
    }
    return marks;
  }

  /* 一到三条跑出画面两端的浅色长线，托住构图。 */
  function temperaBuildCrossingLines(seed, salt, width, height, count) {
    var total = Math.min(3, Math.max(0, Math.round(count)));
    var lines = [];
    for (var index = 0; index < total; index += 1) {
      var anchorY = height * (0.18 + temperaHash01(seed, index, salt) * 0.64);
      var sign = temperaHash01(seed, index, salt + 5) > 0.5 ? 1 : -1;
      var angle = sign * (0.07 + temperaHash01(seed, index, salt + 9) * 0.11);
      /* 伸到两端以外：图层会随构图滑动，停在画面里的线会明显脱开。 */
      var reach = width * 0.9;
      lines.push({
        x1: -width * 0.3,
        y1: anchorY - Math.tan(angle) * reach,
        x2: width * 1.3,
        y2: anchorY + Math.tan(angle) * reach
      });
    }
    return lines;
  }

  /* ============================== 5. 曲线几何 ============================== */
  /* temperaCurves.ts：圆角词汇表。凸性是有意义的 ——
   * `temperaBuildHatchLines` 只对凸形状成立；此处除 ellipse / roundedRect 外都是凹的，
   * 只能填色/描边（pixi 用 earcut 三角化凹多边形，填是安全的）。 */

  /* 凸。 */
  function temperaEllipsePolygon(cx, cy, rx, ry, segments) {
    var count = Math.max(8, Math.round(segments === undefined ? 32 : segments));
    var points = [];
    for (var index = 0; index < count; index += 1) {
      var angle = (index / count) * TEMPERA_TAU;
      points.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
    }
    return points;
  }

  /* 凸。贴纸板：四角是四分之一圆弧的矩形。 */
  function temperaRoundedRectPolygon(x, y, width, height, radius, cornerSegments) {
    var limit = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    var steps = Math.max(1, Math.round(cornerSegments === undefined ? 6 : cornerSegments));
    var corners = [
      [x + width - limit, y + limit, -Math.PI / 2],
      [x + width - limit, y + height - limit, 0],
      [x + limit, y + height - limit, Math.PI / 2],
      [x + limit, y + limit, Math.PI]
    ];
    var points = [];
    for (var c = 0; c < corners.length; c += 1) {
      var ccx = corners[c][0];
      var ccy = corners[c][1];
      var start = corners[c][2];
      for (var step = 0; step <= steps; step += 1) {
        var angle = start + (step / steps) * (Math.PI / 2);
        points.push(ccx + Math.cos(angle) * limit, ccy + Math.sin(angle) * limit);
      }
    }
    return points;
  }

  /* 绕支点旋转多边形。凸性保持，可网纹的形状仍然可网纹。 */
  function temperaRotatePolygon(polygon, cx, cy, angle) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var points = [];
    for (var index = 0; index < polygon.length; index += 2) {
      var dx = polygon[index] - cx;
      var dy = polygon[index + 1] - cy;
      points.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
    }
    return points;
  }

  /* 凹。带 lobes 个正弦凸起的外轮廓，归一化后仍正好落在 rx/ry 内。
   * 小振幅读作云或蕾丝圆章，大振幅读作玫瑰窗。 */
  function temperaLobedPolygon(cx, cy, rx, ry, lobes, amplitude, segments) {
    var count = Math.max(24, Math.round(segments === undefined ? 96 : segments));
    var petals = Math.max(1, Math.round(lobes));
    var swell = Math.max(0, amplitude);
    var points = [];
    for (var index = 0; index < count; index += 1) {
      var angle = (index / count) * TEMPERA_TAU;
      var scale = (1 + Math.cos(angle * petals) * swell) / (1 + swell);
      points.push(cx + Math.cos(angle) * rx * scale, cy + Math.sin(angle) * ry * scale);
    }
    return points;
  }

  /* 凹。平坦边在 flatY，一排相切的半圆凸起从 baseY 挂下来 —— 花边。 */
  function temperaScallopBandPolygon(x0, x1, flatY, baseY, bumps, segmentsPerBump) {
    var count = Math.max(1, Math.round(bumps));
    var steps = Math.max(3, Math.round(segmentsPerBump === undefined ? 10 : segmentsPerBump));
    var span = (x1 - x0) / count;
    var radius = Math.abs(span) / 2;
    var direction = baseY >= flatY ? 1 : -1;
    var points = [x0, flatY, x1, flatY];
    /* 从右往左走，凸起才在同一绕向里接到平边上。 */
    for (var bump = count - 1; bump >= 0; bump -= 1) {
      var cx = x0 + span * (bump + 0.5);
      for (var step = 0; step <= steps; step += 1) {
        var angle = (step / steps) * Math.PI;
        points.push(
          cx + Math.cos(angle) * (span / 2),
          baseY + direction * Math.sin(angle) * radius
        );
      }
    }
    return points;
  }

  /* 凹。经典参数心形，采样后归一化进 rx/ry 盒，调用方像别的形状一样给尺寸。 */
  function temperaHeartPolygon(cx, cy, rx, ry, segments) {
    var count = Math.max(16, Math.round(segments === undefined ? 64 : segments));
    var raw = [];
    var minX = Number.POSITIVE_INFINITY;
    var maxX = Number.NEGATIVE_INFINITY;
    var minY = Number.POSITIVE_INFINITY;
    var maxY = Number.NEGATIVE_INFINITY;
    for (var index = 0; index < count; index += 1) {
      var t = (index / count) * TEMPERA_TAU;
      var x = Math.pow(Math.sin(t), 3) * 16;
      /* 取负：曲线按数学向上写，构图画在屏幕向下空间。 */
      var y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      raw.push(x, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    var halfWidth = Math.max(1e-6, (maxX - minX) / 2);
    var halfHeight = Math.max(1e-6, (maxY - minY) / 2);
    var midX = (minX + maxX) / 2;
    var midY = (minY + maxY) / 2;
    var points = [];
    for (var r = 0; r < raw.length; r += 2) {
      points.push(
        cx + ((raw[r] - midX) / halfWidth) * rx,
        cy + ((raw[r + 1] - midY) / halfHeight) * ry
      );
    }
    return points;
  }

  /* 凹。一环的一段，从 startAngle 到 endAngle。整圈这样的段拼起来就留下辐条与轮心，
   * 这是「从板上冲出环、中心却不掉」的做法。 */
  function temperaAnnularSectorPolygon(cx, cy, innerRadius, outerRadius, startAngle, endAngle, segments) {
    var steps = Math.max(2, Math.round(segments === undefined ? 10 : segments));
    var points = [];
    for (var step = 0; step <= steps; step += 1) {
      var angle = startAngle + ((endAngle - startAngle) * step) / steps;
      points.push(cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius);
    }
    for (var back = steps; back >= 0; back -= 1) {
      var angle2 = startAngle + ((endAngle - startAngle) * back) / steps;
      points.push(cx + Math.cos(angle2) * innerRadius, cy + Math.sin(angle2) * innerRadius);
    }
    return points;
  }

  /* 凹。四个尖加一个收紧的腰是 VN 闪光；尖更多就读成星。 */
  function temperaStarPolygon(cx, cy, outerRadius, innerRadius, points, rotation) {
    var tips = Math.max(3, Math.round(points));
    var spin = rotation === undefined ? 0 : rotation;
    var polygon = [];
    for (var index = 0; index < tips * 2; index += 1) {
      var radius = index % 2 === 0 ? outerRadius : innerRadius;
      var angle = spin - Math.PI / 2 + (index / (tips * 2)) * TEMPERA_TAU;
      polygon.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }
    return polygon;
  }

  /* 凹。中心线沿半个正弦下垂、两端平切的带子，可以跑出画面两端仍读成一条弧带。 */
  function temperaArcRibbonPolygon(x0, x1, y, thickness, sag, steps) {
    var count = Math.max(4, Math.round(steps === undefined ? 28 : steps));
    var half = thickness / 2;
    var top = [];
    var bottom = [];
    for (var index = 0; index <= count; index += 1) {
      var progress = index / count;
      var x = x0 + (x1 - x0) * progress;
      var centre = y + Math.sin(progress * Math.PI) * sag;
      top.push(x, centre - half);
      bottom.push(x, centre + half);
    }
    var points = top.slice();
    for (var back = bottom.length - 2; back >= 0; back -= 2) {
      points.push(bottom[back], bottom[back + 1]);
    }
    return points;
  }

  /* 抖动格点上的 seed 圆场：格点保证覆盖均匀，逐格抖动让它不读成点阵。 */
  function temperaBuildDiscField(seed, salt, width, height, count, radius) {
    var total = Math.max(0, Math.round(count));
    if (total === 0 || width <= 0 || height <= 0) return [];
    var columns = Math.max(1, Math.round(Math.sqrt(total * (width / height))));
    var rows = Math.max(1, Math.ceil(total / columns));
    var cellWidth = width / columns;
    var cellHeight = height / rows;
    var discs = [];
    for (var index = 0; index < total; index += 1) {
      var column = index % columns;
      var row = Math.floor(index / columns);
      discs.push({
        x: cellWidth * (column + 0.15 + temperaHash01(seed, index, salt) * 0.7),
        y: cellHeight * (row + 0.15 + temperaHash01(seed, index, salt + 3) * 0.7),
        radius: radius * (0.55 + temperaHash01(seed, index, salt + 7) * 0.75)
      });
    }
    return discs;
  }

  /* ============================== 6. Graphics 工厂 ============================== */
  /* temperaShapes.ts：每个工厂返回成品静态节点；播放期只写变换与 alpha。 */

  function temperaToPixiColor(pixi, color) {
    return pixi.Color.shared.setValue(color).toNumber();
  }

  function temperaBoundsCenter(polygon) {
    var minX = Number.POSITIVE_INFINITY;
    var maxX = Number.NEGATIVE_INFINITY;
    var minY = Number.POSITIVE_INFINITY;
    var maxY = Number.NEGATIVE_INFINITY;
    for (var index = 0; index < polygon.length; index += 2) {
      minX = Math.min(minX, polygon[index]);
      maxX = Math.max(maxX, polygon[index]);
      minY = Math.min(minY, polygon[index + 1]);
      maxY = Math.max(maxY, polygon[index + 1]);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  /* 每条 ramp × 每个 tone 只建一个渐变。ramp 在形状局部空间，
   * 同一个 shot 里同一 tone 的形状可以共用，而不是各自烘一张贴图。 */
  var temperaGradientFills = new WeakMap();

  function temperaCreateGradientFill(pixi, gradient, color) {
    var half = 0.5;
    var dx = Math.cos(gradient.angle) * half;
    var dy = Math.sin(gradient.angle) * half;
    var stops = gradient.colors.map(function (stop, index) {
      return {
        offset: gradient.colors.length > 1 ? index / (gradient.colors.length - 1) : 0,
        color: temperaMixColors(stop, color, 0.5)
      };
    });
    return new pixi.FillGradient({
      type: 'linear',
      start: { x: half - dx, y: half - dy },
      end: { x: half + dx, y: half + dy },
      colorStops: stops,
      textureSpace: 'local'
    });
  }

  function temperaBuildGradientFill(pixi, gradient, color) {
    var byColor = temperaGradientFills.get(gradient);
    if (!byColor) {
      byColor = new Map();
      temperaGradientFills.set(gradient, byColor);
    }
    var fill = byColor.get(color);
    if (!fill) {
      fill = temperaCreateGradientFill(pixi, gradient, color);
      byColor.set(color, fill);
    }
    return fill;
  }

  /* 销毁一棵显示树用到的渐变填充。Graphics 不会销毁自己 fill 里的贴图，
   * 不这么做，gradient 模式的每个形状都留一张 ramp 贴图给 pixi 的空闲收集器。
   * 必须在销毁树本体之前调用：销毁 Graphics 会丢掉它的指令表，那是唯一能找到 fill 的地方。 */
  function temperaDestroyGradientFills(pixi, root) {
    var fills = new Set();
    var stack = [root];
    while (stack.length > 0) {
      var node = stack.pop();
      if (!node) continue;
      if (node.children && node.children.length > 0) {
        for (var i = 0; i < node.children.length; i += 1) stack.push(node.children[i]);
      }
      if (!(node instanceof pixi.Graphics)) continue;
      var instructions = node.context && node.context.instructions ? node.context.instructions : [];
      for (var k = 0; k < instructions.length; k += 1) {
        var instruction = instructions[k];
        if (instruction.action !== 'fill' && instruction.action !== 'stroke') continue;
        var fill = instruction.data && instruction.data.style ? instruction.data.style.fill : null;
        if (fill instanceof pixi.FillGradient) fills.add(fill);
      }
    }
    fills.forEach(function (fill) { fill.destroy(); });
  }

  function temperaDrawPolygonFill(pixi, polygon, color, alpha, gradient) {
    var opacity = alpha === undefined ? 1 : alpha;
    var node = new pixi.Graphics().poly(polygon);
    return gradient && gradient.colors.length > 1
      ? node.fill({ fill: temperaBuildGradientFill(pixi, gradient, color), alpha: opacity })
      : node.fill({ color: temperaToPixiColor(pixi, color), alpha: opacity });
  }

  /* 带洞的填充多边形。洞是真的透 —— 透出来的是外壳的实时背景层。
   * 本节点必须只有一条 fill 指令：`GraphicsContext.cut` 会往回遍历，
   * 多一条 fill/stroke 就会把洞一起吃掉。洞的描边另建节点。 */
  function temperaDrawPolygonFillWithHoles(pixi, polygon, holes, color, alpha, gradient) {
    var opacity = alpha === undefined ? 1 : alpha;
    var node = new pixi.Graphics().poly(polygon);
    if (gradient && gradient.colors.length > 1) {
      node.fill({ fill: temperaBuildGradientFill(pixi, gradient, color), alpha: opacity });
    } else {
      node.fill({ color: temperaToPixiColor(pixi, color), alpha: opacity });
    }
    for (var index = 0; index < holes.length; index += 1) {
      var hole = holes[index];
      if (hole.length >= 6) node.poly(hole).cut();
    }
    return node;
  }

  function temperaDrawPolygonOutline(pixi, polygon, color, width, alpha) {
    return new pixi.Graphics()
      .poly(polygon)
      .stroke({
        color: temperaToPixiColor(pixi, color),
        width: width,
        alpha: alpha === undefined ? 1 : alpha
      });
  }

  /* 用平行笔画填凸多边形。节点以形状中心为支点，
   * 调用方可以只用横向缩放把它「张开」，不必再碰几何。 */
  function temperaDrawHatchFill(pixi, polygon, spec, color, alpha) {
    var node = new pixi.Graphics();
    var lines = temperaBuildHatchLines(polygon, spec);
    for (var index = 0; index < lines.length; index += 1) {
      node.moveTo(lines[index].x1, lines[index].y1).lineTo(lines[index].x2, lines[index].y2);
    }
    if (lines.length > 0) {
      node.stroke({
        color: temperaToPixiColor(pixi, color),
        width: spec.width,
        alpha: alpha === undefined ? 1 : alpha
      });
    }
    var center = temperaBoundsCenter(polygon);
    node.pivot.set(center.x, center.y);
    node.position.set(center.x, center.y);
    return node;
  }

  function temperaDiscsCenter(discs) {
    if (discs.length === 0) return { x: 0, y: 0 };
    var minX = Number.POSITIVE_INFINITY;
    var maxX = Number.NEGATIVE_INFINITY;
    var minY = Number.POSITIVE_INFINITY;
    var maxY = Number.NEGATIVE_INFINITY;
    for (var index = 0; index < discs.length; index += 1) {
      var disc = discs[index];
      minX = Math.min(minX, disc.x - disc.radius);
      maxX = Math.max(maxX, disc.x + disc.radius);
      minY = Math.min(minY, disc.y - disc.radius);
      maxY = Math.max(maxY, disc.y + disc.radius);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  /* 整片圆场是一个节点：气泡簇要作为一个 item 入场/呼吸，
   * 每个气泡一个 Graphics 会让块动画器里多出十几条。 */
  function temperaBuildDiscNode(pixi, discs) {
    var node = new pixi.Graphics();
    for (var index = 0; index < discs.length; index += 1) {
      var disc = discs[index];
      node.circle(disc.x, disc.y, Math.max(0.5, disc.radius));
    }
    return node;
  }

  function temperaPivotOnSelf(node, center) {
    node.pivot.set(center.x, center.y);
    node.position.set(center.x, center.y);
    return node;
  }

  function temperaDrawDiscs(pixi, discs, color, alpha, gradient) {
    var opacity = alpha === undefined ? 1 : alpha;
    var node = temperaBuildDiscNode(pixi, discs);
    if (discs.length > 0) {
      node.fill(gradient && gradient.colors.length > 1
        ? { fill: temperaBuildGradientFill(pixi, gradient, color), alpha: opacity }
        : { color: temperaToPixiColor(pixi, color), alpha: opacity });
    }
    return temperaPivotOnSelf(node, temperaDiscsCenter(discs));
  }

  function temperaDrawRings(pixi, discs, color, width, alpha) {
    var node = temperaBuildDiscNode(pixi, discs);
    if (discs.length > 0) {
      node.stroke({
        color: temperaToPixiColor(pixi, color),
        width: width,
        alpha: alpha === undefined ? 1 : alpha
      });
    }
    return temperaPivotOnSelf(node, temperaDiscsCenter(discs));
  }

  function temperaDrawLines(pixi, lines, color, width, alpha) {
    var node = new pixi.Graphics();
    for (var index = 0; index < lines.length; index += 1) {
      node.moveTo(lines[index].x1, lines[index].y1).lineTo(lines[index].x2, lines[index].y2);
    }
    if (lines.length > 0) {
      node.stroke({
        color: temperaToPixiColor(pixi, color),
        width: width,
        alpha: alpha === undefined ? 1 : alpha
      });
    }
    return node;
  }

  function temperaDrawPolyline(pixi, points, color, width, alpha) {
    var node = new pixi.Graphics();
    if (points.length < 4) return node;
    node.moveTo(points[0], points[1]);
    for (var index = 2; index < points.length; index += 2) {
      node.lineTo(points[index], points[index + 1]);
    }
    return node.stroke({
      color: temperaToPixiColor(pixi, color),
      width: width,
      alpha: alpha === undefined ? 1 : alpha
    });
  }

  /* 同心 45° 菱形框，描边粗细交替，最外圈最粗。 */
  function temperaDrawConcentricDiamonds(pixi, cx, cy, rx, ry, rings, color, alpha) {
    var node = new pixi.Graphics();
    var stroke = temperaToPixiColor(pixi, color);
    var opacity = alpha === undefined ? 1 : alpha;
    var total = Math.max(1, rings);
    for (var ring = 0; ring < total; ring += 1) {
      var shrink = 1 - ring * 0.22;
      node
        .poly([cx, cy - ry * shrink, cx + rx * shrink, cy, cx, cy + ry * shrink, cx - rx * shrink, cy])
        .stroke({ color: stroke, width: ring % 2 === 0 ? 3.5 : 1.4, alpha: opacity });
    }
    node.pivot.set(cx, cy);
    node.position.set(cx, cy);
    return node;
  }

  function temperaDrawCrossMarks(pixi, marks, color, width, alpha) {
    var node = new pixi.Graphics();
    for (var index = 0; index < marks.length; index += 1) {
      var mark = marks[index];
      var cos = Math.cos(mark.rotation + Math.PI / 4) * mark.size;
      var sin = Math.sin(mark.rotation + Math.PI / 4) * mark.size;
      node.moveTo(mark.x - cos, mark.y - sin).lineTo(mark.x + cos, mark.y + sin);
      node.moveTo(mark.x - sin, mark.y + cos).lineTo(mark.x + sin, mark.y - cos);
    }
    if (marks.length > 0) {
      node.stroke({
        color: temperaToPixiColor(pixi, color),
        width: width,
        alpha: alpha === undefined ? 1 : alpha
      });
    }
    return node;
  }

  function temperaDrawSquareMarks(pixi, marks, color, alpha) {
    var node = new pixi.Graphics();
    for (var index = 0; index < marks.length; index += 1) {
      var mark = marks[index];
      node.rect(mark.x - mark.size / 2, mark.y - mark.size / 2, mark.size, mark.size);
    }
    if (marks.length > 0) {
      node.fill({ color: temperaToPixiColor(pixi, color), alpha: alpha === undefined ? 1 : alpha });
    }
    return node;
  }

  window.foliaTemperaMg = {
    /* §1 */
    hashSeed: temperaHashSeed,
    mixSeed: temperaMixSeed,
    hash01: temperaHash01,
    chooseWithoutRepeat: temperaChooseWithoutRepeat,
    /* §2 */
    colorWithAlpha: temperaColorWithAlpha,
    parseColorChannels: temperaParseColorChannels,
    mixColors: temperaMixColors,
    /* §3 */
    TONE_STOPS: TEMPERA_TONE_STOPS,
    resolvePalette: temperaResolvePalette,
    paletteLuminance: temperaPaletteLuminance,
    /* §4 */
    buildHatchSpec: temperaBuildHatchSpec,
    rectPolygon: temperaRectPolygon,
    circlePolygon: temperaCirclePolygon,
    diamondPolygon: temperaDiamondPolygon,
    buildHatchLines: temperaBuildHatchLines,
    buildScribblePath: temperaBuildScribblePath,
    buildWavyPath: temperaBuildWavyPath,
    buildCrossRow: temperaBuildCrossRow,
    buildDotRow: temperaBuildDotRow,
    buildDotGrid: temperaBuildDotGrid,
    buildCrossingLines: temperaBuildCrossingLines,
    /* §5 */
    ellipsePolygon: temperaEllipsePolygon,
    roundedRectPolygon: temperaRoundedRectPolygon,
    rotatePolygon: temperaRotatePolygon,
    lobedPolygon: temperaLobedPolygon,
    scallopBandPolygon: temperaScallopBandPolygon,
    heartPolygon: temperaHeartPolygon,
    annularSectorPolygon: temperaAnnularSectorPolygon,
    starPolygon: temperaStarPolygon,
    arcRibbonPolygon: temperaArcRibbonPolygon,
    buildDiscField: temperaBuildDiscField,
    /* §6 */
    toPixiColor: temperaToPixiColor,
    destroyGradientFills: temperaDestroyGradientFills,
    drawPolygonFill: temperaDrawPolygonFill,
    drawPolygonFillWithHoles: temperaDrawPolygonFillWithHoles,
    drawPolygonOutline: temperaDrawPolygonOutline,
    drawHatchFill: temperaDrawHatchFill,
    drawDiscs: temperaDrawDiscs,
    drawRings: temperaDrawRings,
    drawLines: temperaDrawLines,
    drawPolyline: temperaDrawPolyline,
    drawConcentricDiamonds: temperaDrawConcentricDiamonds,
    drawCrossMarks: temperaDrawCrossMarks,
    drawSquareMarks: temperaDrawSquareMarks
  };
})();
