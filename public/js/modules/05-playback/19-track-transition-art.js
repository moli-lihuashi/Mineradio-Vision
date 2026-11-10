// ============================================================
//  歌曲过渡 · 中央光效（Canvas 逐像素生成）
// ------------------------------------------------------------
//  来源：D:/Codex++/2026-11-08/html-2-3-4/outputs/ 下四份独立 HTML
//    index.html           「交晖」              → 混音过渡（按用户要求统一紫白）
//    golden-rings.html    「紫白光环」          → 渐进过渡
//    golden-divider.html  「紫白光缝」          → 无缝过渡
//    golden-band.html     「紫白光带」          → 立体声转场
//
//  这四份页面都是纯算法：Canvas ImageData 逐像素算高斯光晕、椭圆/圆角盒
//  距离场、细密点阵摩尔纹、磨砂噪点与弧形接缝，不加载任何图片 / 字体 / 库，
//  也不发网络请求。本项目不引入四个 iframe（会带进四份嵌套文档和「全屏尺寸」
//  假设），而是把同一套公式原样收进本模块，渲染到面板内四张 canvas 上。
//
//  与原 HTML 的唯一差别：
//    1) 画布尺寸由面板实际尺寸决定（原文件按 window.innerWidth/Height）；
//    2) 场景坐标 s.width/s.height 用 stepX/stepY 独立映射到目标像素，
//       所以宽扁的 banner 会把光效自然压成横向构图，不会留黑边；
//    3) 每张画布只渲染一次并缓存，切模式只是 CSS 换 active。
//
//  与 18-track-transition.js 的关系：18 的 syncUi() 切完 data-mode / active
//  后调用本模块的 render()；本模块缺席时 18 用 typeof 检查安全跳过。
//  面板 <details> 展开时也会重绘一次，避免 display:none 下量到 0 尺寸。
// ============================================================

(function (global) {
  'use strict';

  var NS = global.Mineradio = global.Mineradio || {};
  var DEFAULT_MODE = 'seamless';
  var MIN_W = 180, MIN_H = 72;

  // 与原 HTML 一致的公共数学工具
  function square(v) { return v * v; }
  function gaussian(v) { return Math.exp(-v); }
  function smoothstep(low, high, value) {
    var t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }
  // 对称 hash 磨砂噪点：四份页面的种子与幅度各不相同，原样保留
  function grain(row, col, w, h, cfg) {
    var gx = Math.min(col, w - 1 - col);
    var gy = Math.min(row, h - 1 - row);
    var hash = Math.imul(gx + cfg.x, cfg.m1) ^ Math.imul(gy + cfg.y, cfg.m2);
    if (cfg.m3) hash = Math.imul(hash ^ (hash >>> 13), cfg.m3);
    return ((hash >>> 0) / 4294967295 - 0.5) * cfg.amp;
  }
  // 三层嵌套 bloom 宽度，让清晰弧线从柔雾里自然长出来
  function rim(distance, face, p) {
    return face * (p[0] * gaussian(square(distance / p[3]))
      + p[1] * gaussian(square(distance / p[4]))
      + p[2] * gaussian(square(distance / p[5])));
  }
  function put(pixels, i, light, color) {
    pixels[i]     = 255 * (1 - Math.exp(-light * color[0]));
    pixels[i + 1] = 255 * (1 - Math.exp(-light * color[1]));
    pixels[i + 2] = 255 * (1 - Math.exp(-light * color[2]));
    pixels[i + 3] = 255;
  }

  // ── index.html：两枚暖金椭圆交叠，交汇处透出米白金色 ──────────────────
  function makeHalos(pixels, w, h, s) {
    var stepX = s.width / w, stepY = s.height / h;
    var rx = s.radiusX, ry = s.radiusY, sep = s.separation, ds = s.dotSpacing;
    var color = SCENES.mix.color;
    var rp = [0.15, 0.35, 1.15, 0.052, 0.018, 0.0065];
    var gc = { x: 73, y: 19, m1: 374761393, m2: 668265263, m3: 1274126177, amp: 0.035 };
    for (var row = 0; row < h; row++) {
      var y = (row + 0.5) * stepY - s.height / 2;
      var yn = y / ry;
      var vertical = gaussian(square(y / 179));
      var dotY = y - Math.round(y / ds) * ds;
      for (var col = 0; col < w; col++) {
        var x = (col + 0.5) * stepX - s.width / 2;
        var lx = (x + sep) / rx, rxn = (sep - x) / rx;
        var lr = Math.hypot(lx, yn), rr = Math.hypot(rxn, yn);
        var lf = gaussian(square((lx - 1) / 0.59)), rf = gaussian(square((rxn - 1) / 0.59));
        var li = 1 - smoothstep(0.96, 1.08, lr), ri = 1 - smoothstep(0.96, 1.08, rr);
        var overlap = li * ri;
        var atmosphere = 0.105 * gaussian(1.9 * (square(x / 490) + square(y / 258)));
        var leftBody = 0.29 * gaussian(1.7 * (square((x + 168) / 285) + square(y / 191))) * li;
        var rightBody = 0.29 * gaussian(1.7 * (square((x - 168) / 285) + square(y / 191))) * ri;
        var leftBloom = lf * gaussian(square((lr - 0.95) / 0.18));
        var rightBloom = rf * gaussian(square((rr - 0.95) / 0.18));
        var core = 1.72 * gaussian(square(x / 118) + square(y / 175)) * overlap;
        var spill = 0.32 * gaussian(square(x / 210) + square(y / 183));
        var light = atmosphere + leftBody + rightBody + spill + core + 0.55 * (leftBloom + rightBloom);
        var dotX = x - Math.round(x / ds) * ds;
        var dots = gaussian((square(dotX) + square(dotY)) / 0.64);
        var textureMask = gaussian(square(x / 415) + square(y / 187)) * smoothstep(0.04, 0.4, light);
        light *= 1 + (dots - 0.075) * 0.54 * textureMask;
        light *= 1 + grain(row, col, w, h, gc);
        light += (rim(lr - 1, lf, rp) + rim(rr - 1, rf, rp)) * (0.55 + 0.45 * vertical);
        light *= (1 - smoothstep(472, 595, Math.abs(x)))
          * (1 - smoothstep(245, 350, Math.abs(y))) * s.exposure;
        put(pixels, (row * w + col) * 4, light, color);
      }
    }
  }

  // ── golden-rings.html：两枚光环左右对称相接 ────────────────────────────
  function makeRings(pixels, w, h, s) {
    var stepX = s.width / w, stepY = s.height / h, ds = s.dotSpacing;
    var color = SCENES.gradual.color;
    var rp = [0.22, 0.49, 1.05, 0.055, 0.022, 0.009];
    var gc = { x: 29, y: 11, m1: 374761393, m2: 668265263, m3: 1274126177, amp: 0.028 };
    for (var row = 0; row < h; row++) {
      var y = (row + 0.5) * stepY - s.height / 2;
      var dotY = y - Math.round(y / ds) * ds;
      for (var col = 0; col < w; col++) {
        var x = (col + 0.5) * stepX - s.width / 2;
        var absX = Math.abs(x), absY = Math.abs(y);
        var lx = x + 230, rx = x - 230;
        var lr = Math.hypot(lx / 226, y / 216), rr = Math.hypot(rx / 226, y / 216);
        var li = 1 - smoothstep(0.97, 1.11, lr), ri = 1 - smoothstep(0.97, 1.11, rr);
        var field = Math.max(li, ri);
        var atmosphere = 0.19 * gaussian(square(x / 475) + square(y / 255));
        var leftFace = 0.37 * gaussian(square((x + 112) / 192) + square(y / 168)) * li;
        var rightFace = 0.37 * gaussian(square((x - 112) / 192) + square(y / 168)) * ri;
        var centralBloom = 0.39 * gaussian(square(x / 90) + square(y / 166));
        var light = atmosphere + leftFace + rightFace + centralBloom;
        var dotX = x - Math.round(x / ds) * ds;
        var dot = gaussian((square(dotX) + square(dotY)) / 0.88);
        light *= 1 + (dot - 0.075) * 0.94 * field * smoothstep(0.035, 0.18, light);
        light *= 1 + grain(row, col, w, h, gc);
        var leftWeight = 0.15 + 0.85 * smoothstep(-0.3, 0.91, lx / 226);
        var rightWeight = 0.15 + 0.85 * smoothstep(-0.3, 0.91, -rx / 226);
        light += leftWeight * rim(lr - 1, 1, rp) + rightWeight * rim(rr - 1, 1, rp);
        light *= (1 - smoothstep(465, 590, absX)) * (1 - smoothstep(248, 354, absY));
        put(pixels, (row * w + col) * 4, light, color);
      }
    }
  }

  // ── golden-band.html：横向光带，上下两条纤细弧线勾勒 ──────────────────
  function makeBand(pixels, w, h, s) {
    var stepX = s.width / w, stepY = s.height / h, ds = s.dotSpacing;
    var color = SCENES.stereo.color;
    var ep = [0.14, 0.52, 1.02, 17, 7, 2.7];
    var gc = { x: 53, y: 23, m1: 1274126177, m2: 374761393, m3: 0, amp: 0.024 };
    for (var row = 0; row < h; row++) {
      var y = (row + 0.5) * stepY - s.height / 2;
      var beamY = y + 12, absY = Math.abs(beamY);
      var dotY = beamY - Math.round(beamY / ds) * ds;
      for (var col = 0; col < w; col++) {
        var x = (col + 0.5) * stepX - s.width / 2;
        var absX = Math.abs(x);
        var edgeHeight = 95 + 33 * square(x / 440);
        var distanceToEdge = absY - edgeHeight;
        var insideBand = 1 - smoothstep(edgeHeight - 12, edgeHeight + 34, absY);
        var halo = 0.20 * gaussian(square(x / 505) + square(y / 232));
        var broadBeam = 0.38 * gaussian(square(x / 390) + square(beamY / 96));
        var centerBeam = 0.29 * gaussian(square(x / 206) + square(beamY / 72));
        var core = 0.47 * gaussian(square(x / 126) + square(beamY / 61));
        var light = halo + broadBeam + centerBeam + core;
        var dotX = x - Math.round(x / ds) * ds;
        var dot = gaussian((square(dotX) + square(dotY)) / 1.0);
        light *= 1 + (dot - 0.065) * 0.92 * insideBand * smoothstep(0.035, 0.17, light);
        light *= 1 + grain(row, col, w, h, gc);
        light += rim(distanceToEdge, 1, ep) * (1 - smoothstep(355, 486, absX));
        light *= (1 - smoothstep(480, 592, absX)) * (1 - smoothstep(268, 360, Math.abs(y)));
        put(pixels, (row * w + col) * 4, light, color);
      }
    }
  }

  // ── golden-divider.html：竖向光缝分开左右两块发光面板 ─────────────────
  function roundedBoxDistance(x, y, halfWidth, halfHeight, radius) {
    var qx = Math.abs(x) - (halfWidth - radius);
    var qy = Math.abs(y) - (halfHeight - radius);
    var outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return outside + Math.min(Math.max(qx, qy), 0) - radius;
  }
  function makeDivider(pixels, w, h, s) {
    var stepX = s.width / w, stepY = s.height / h, ds = s.dotSpacing;
    var color = SCENES.seamless.color;
    var sp = [0.18, 0.56, 1.05, 8, 3.7, 1.65];
    var gc = { x: 43, y: 31, m1: 374761393, m2: 668265263, m3: 1274126177, amp: 0.024 };
    for (var row = 0; row < h; row++) {
      var y = (row + 0.5) * stepY - s.height / 2;
      var seamY = y + 36, absY = Math.abs(seamY);
      var dotY = seamY - Math.round(seamY / ds) * ds;
      for (var col = 0; col < w; col++) {
        var x = (col + 0.5) * stepX - s.width / 2;
        var absX = Math.abs(x);
        var ld = roundedBoxDistance(x + 224, seamY, 224, 208, 58);
        var rd = roundedBoxDistance(x - 224, seamY, 224, 208, 58);
        var li = 1 - smoothstep(-15, 14, ld), ri = 1 - smoothstep(-15, 14, rd);
        var field = Math.max(li, ri);
        var outside = Math.max(0, Math.min(ld, rd));
        var atmosphere = 0.17 * gaussian(square(x / 470) + square((y + 24) / 240));
        var outerGlow = 0.16 * gaussian(square(outside / 68));
        var leftPanel = 0.29 * gaussian(square((x + 142) / 192) + square(y / 148)) * li;
        var rightPanel = 0.29 * gaussian(square((x - 142) / 192) + square(y / 148)) * ri;
        var seamCurve = 9 + 7 * Math.pow(Math.min(1, absY / 215), 8);
        var seamLine = (1 - smoothstep(204, 240, absY)) * rim(absX - seamCurve, 1, sp);
        var centerHaze = 0.16 * gaussian(square(absX / 27)) * gaussian(square(seamY / 205));
        var light = atmosphere + outerGlow + leftPanel + rightPanel + seamLine + centerHaze;
        var dotX = x - Math.round(x / ds) * ds;
        var dot = gaussian((square(dotX) + square(dotY)) / 1.05);
        light *= 1 + (dot - 0.07) * 1.00 * field * smoothstep(0.035, 0.16, light);
        light *= 1 + grain(row, col, w, h, gc);
        light *= (1 - smoothstep(470, 596, absX)) * (1 - smoothstep(257, 356, Math.abs(y)));
        put(pixels, (row * w + col) * 4, light, color);
      }
    }
  }

  /* RGB 曝光系数。四份 HTML 原本是「index.html 暖金 + 其余三份紫白」，
     用户要求四张统一紫白，因此 mix 也改用 VIOLET_WHITE。
     只换这一组系数，高斯光晕 / 点阵 / 弧形接缝的公式一个字不动；
     GOLD 仍导出为可选配色，需要暖金时改回一行即可。 */
  var GOLD = [1.48, 0.73, 0.31];
  var VIOLET_WHITE = [2.40, 1.95, 3.20];

  var SCENES = {
    mix: {
      source: 'index.html', title: '交晖 · 紫白光晕',
      settings: { width: 1200, height: 720, radiusX: 330, radiusY: 226,
        separation: 230, dotSpacing: 5.2, exposure: 1.0 },
      color: VIOLET_WHITE, make: makeHalos
    },
    gradual: {
      source: 'golden-rings.html', title: '紫白光环',
      settings: { width: 1200, height: 680, dotSpacing: 7 },
      color: VIOLET_WHITE, make: makeRings
    },
    seamless: {
      source: 'golden-divider.html', title: '紫白光缝',
      settings: { width: 1200, height: 680, dotSpacing: 8 },
      color: VIOLET_WHITE, make: makeDivider
    },
    stereo: {
      source: 'golden-band.html', title: '紫白光带',
      settings: { width: 1200, height: 680, dotSpacing: 8 },
      color: VIOLET_WHITE, make: makeBand
    }
  };

  function documentEl(id) {
    return global.document && global.document.getElementById
      ? global.document.getElementById(id) : null;
  }
  function activeMode() {
    var scene = documentEl('track-transition-scene');
    var mode = scene ? scene.getAttribute('data-mode') : null;
    return Object.prototype.hasOwnProperty.call(SCENES, mode) ? mode : DEFAULT_MODE;
  }

  /* 渲染到指定 canvas。stamp 里带目标像素尺寸与来源文件名：面板展开导致
     clientWidth 变化时会自动重绘，其余情况（含拖参数触发的 syncUi）命中
     缓存直接返回，不重复跑逐像素循环。 */
  function renderInto(canvas, mode, force) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    var scene = SCENES[mode] || SCENES[DEFAULT_MODE];
    var cssW = canvas.clientWidth || canvas.width || 306;
    var cssH = canvas.clientHeight || canvas.height || 104;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.max(MIN_W, Math.round(cssW * dpr));
    var h = Math.max(MIN_H, Math.round(cssH * dpr));
    var stamp = w + 'x' + h + ':' + scene.source;
    if (!force && canvas.getAttribute('data-rendered') === stamp) return true;
    var ctx;
    try { ctx = canvas.getContext('2d', { alpha: false }); } catch (_) { return false; }
    if (!ctx || typeof ctx.createImageData !== 'function') return false;
    canvas.width = w;
    canvas.height = h;
    var image = ctx.createImageData(w, h);
    scene.make(image.data, w, h, scene.settings);
    ctx.putImageData(image, 0, 0);
    canvas.setAttribute('data-rendered', stamp);
    return true;
  }
  function render(mode, force) {
    var id = Object.prototype.hasOwnProperty.call(SCENES, mode) ? mode : activeMode();
    return renderInto(documentEl('track-transition-art-' + id), id, !!force);
  }
  function refresh(force) { return render(activeMode(), !!force); }

  NS.trackTransitionArt = {
    SCENES: SCENES,
    GOLD: GOLD,
    VIOLET_WHITE: VIOLET_WHITE,
    render: render,
    renderInto: renderInto,
    refresh: refresh,
    activeMode: activeMode
  };
  global.renderTrackTransitionArt = refresh;

  function boot() {
    refresh(true);
    var fold = documentEl('track-transition-fold');
    if (fold && typeof fold.addEventListener === 'function') {
      fold.addEventListener('toggle', function () { if (fold.open) refresh(true); });
    }
  }
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
