/* =============================================================================
 * fx 面板的液态展开 / 吸回
 *
 * 动效来自「液态拉出菜单」那套引擎（设计参考 @imharshin）：黏滞液滴从触发按钮拉出、
 * 目标沿三维空间翻折展开；收起时 175ms 干脆吸回。这里的目标不是菜单，而是
 * **#fx-panel 本身**，触发点是滑杆按钮 #fx-fab。
 *
 * 与面板原有动效的关系：
 *   - 打开：#fx-panel 原本走 CSS 动画 fx-panel-in（从右侧滑入）；
 *   - 收起：原本走 MineradioMotion.springUiOut（弹簧位移）。
 *   由本模块接管后，这两段都跳过（见 07-bindings-shelf-immersive.js 的 toggleFxPanelPin）。
 *   只在「用户点滑杆按钮」这条路径接管；鼠标贴边 peek 仍用原来的轻量逻辑。
 *
 * 关键实现点：
 *   - #fx-panel 是 position:fixed 且默认 right:-460px，直接做 transform 会因为基准位置
 *     在屏幕外而错位 → 加 .fx-genie-run 把 right 钉到 24px 并关掉 CSS 动画/过渡；
 *   - 面板自身要三维倾斜必须有透视，但它的父级是 body，不好加 wrapper →
 *     用 transform 里的 perspective() 函数自带透视；
 *   - transform-origin 取滑杆按钮中心相对面板左上角的坐标，这样「从按钮长出来」才成立。
 * ========================================================================== */
(function () {
  'use strict';

  var OPEN_MS = 470;
  var CLOSE_MS = 175;
  var RUN_CLASS = 'fx-genie-run';
  var DROPLET_MAX = 0.34;

  var raf = null;
  var progress = 0;
  var dir = 1;
  var running = false;
  var geo = null;
  var drop = null;
  var dropRefs = null;

  /* ---------- 数学（与引擎一致） ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function easeOutCubic(t) { var u = clamp(t, 0, 1); return 1 - Math.pow(1 - u, 3); }
  function easeOutQuart(t) { var u = clamp(t, 0, 1); return 1 - Math.pow(1 - u, 4); }
  function easeInOutCubic(t) {
    var u = clamp(t, 0, 1);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  function cubicBezier(x1, y1, x2, y2, t) {
    var u = clamp(t, 0, 1);
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    var x = u;
    for (var i = 0; i < 6; i++) {
      var fx = ((ax * x + bx) * x + cx) * x - u;
      var dfx = (3 * ax * x + 2 * bx) * x + cx;
      if (Math.abs(dfx) < 1e-6) break;
      x -= fx / dfx;
    }
    x = clamp(x, 0, 1);
    return ((ay * x + by) * x + cy) * x;
  }
  function openP(u) { return cubicBezier(0.28, 0.04, 0.14, 1.0, u); }
  function closeP(u) { return 1 - cubicBezier(0.42, 0.0, 0.22, 1.0, u); }
  function invert(fn, target, decreasing) {
    var lo = 0, hi = 1;
    for (var i = 0; i < 14; i++) {
      var mid = (lo + hi) * 0.5;
      var val = fn(mid);
      if (decreasing ? val > target : val < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }
  function prefersReduced() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
  }

  /* 圆角梯形：液滴本体 */
  function trapezoid(tlx, trx, ty, blx, brx, by, r) {
    var topW = trx - tlx, botW = brx - blx, h = Math.abs(by - ty);
    if (topW <= 1 || botW <= 1 || h <= 1) return '';
    var maxR = Math.min(r, topW * 0.48, botW * 0.48, h * 0.48);
    var leftLen = Math.hypot(blx - tlx, by - ty) || 1;
    var rightLen = Math.hypot(brx - trx, by - ty) || 1;
    var lux = (blx - tlx) / leftLen, luy = (by - ty) / leftLen;
    var rux = (brx - trx) / rightLen, ruy = (by - ty) / rightLen;
    return [
      'M ' + (tlx + maxR).toFixed(2) + ' ' + ty.toFixed(2),
      'L ' + (trx - maxR).toFixed(2) + ' ' + ty.toFixed(2),
      'Q ' + trx.toFixed(2) + ' ' + ty.toFixed(2) + ' ' + (trx + rux * maxR).toFixed(2) + ' ' + (ty + ruy * maxR).toFixed(2),
      'L ' + (brx - rux * maxR).toFixed(2) + ' ' + (by - ruy * maxR).toFixed(2),
      'Q ' + brx.toFixed(2) + ' ' + by.toFixed(2) + ' ' + (brx - maxR).toFixed(2) + ' ' + by.toFixed(2),
      'L ' + (blx + maxR).toFixed(2) + ' ' + by.toFixed(2),
      'Q ' + blx.toFixed(2) + ' ' + by.toFixed(2) + ' ' + (blx - lux * maxR).toFixed(2) + ' ' + (by - luy * maxR).toFixed(2),
      'L ' + (tlx + lux * maxR).toFixed(2) + ' ' + (ty + luy * maxR).toFixed(2),
      'Q ' + tlx.toFixed(2) + ' ' + ty.toFixed(2) + ' ' + (tlx + maxR).toFixed(2) + ' ' + ty.toFixed(2),
      'Z'
    ].join(' ');
  }

  /* ---------- 液滴图层 ---------- */
  function ensureDrop() {
    if (drop && document.body.contains(drop)) return drop;
    drop = document.createElement('div');
    drop.id = 'fx-genie-drop';
    drop.innerHTML = [
      '<svg width="100%" height="100%" style="position:absolute;inset:0;overflow:visible" aria-hidden="true">',
      '  <defs>',
      '    <filter id="fx-genie-goo" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">',
      '      <feGaussianBlur data-r="blur" in="SourceGraphic" stdDeviation="0" result="b" />',
      '      <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" />',
      '    </filter>',
      '    <linearGradient id="fx-genie-fill" x1="0" y1="1" x2="0" y2="0">',
      '      <stop offset="0" stop-color="rgb(70,82,96)" stop-opacity="0.92" />',
      '      <stop offset="0.55" stop-color="rgb(126,148,168)" stop-opacity="0.8" />',
      '      <stop offset="1" stop-color="rgb(206,232,242)" stop-opacity="0.78" />',
      '    </linearGradient>',
      '  </defs>',
      '  <g data-g="body">',
      '    <path data-r="path" d="" fill="url(#fx-genie-fill)"',
      '          stroke="rgba(226,255,251,0.92)" stroke-width="1.6" opacity="0" />',
      '  </g>',
      '</svg>'
    ].join('');
    document.body.appendChild(drop);
    dropRefs = {
      path: drop.querySelector('[data-r="path"]'),
      group: drop.querySelector('[data-g="body"]'),
      blur: drop.querySelector('[data-r="blur"]')
    };
    return drop;
  }

  /* 液滴从滑杆按钮向上拉出一段，作为「面板从这里长出来」的视觉来源 */
  function drawDrop(p) {
    if (!dropRefs) return;
    if (p <= 0.004 || p >= DROPLET_MAX + 0.02 || !geo) {
      dropRefs.path.setAttribute('d', '');
      dropRefs.path.setAttribute('opacity', '0');
      dropRefs.group.removeAttribute('filter');
      return;
    }
    var dp = clamp(p / DROPLET_MAX, 0, 1);
    var pull = easeInOutCubic(dp);
    var cx = geo.fx, cy = geo.fy;
    /* 向上拉：底部贴按钮，顶部朝面板方向抬升 */
    var by = cy + 6 - smoothstep(0.18, 1, dp) * 10;
    var ty = cy - 10 - pull * 46;
    var brx = cx + 11;
    var blx = cx - 11;
    var trx = cx + 9 - pull * 6;
    var tlx = cx - 9 - pull * 6;
    var path = trapezoid(tlx, trx, ty, blx, brx, by, lerp(12, 16, pull));
    dropRefs.path.setAttribute('d', path);
    /* 面板本身是深色玻璃：液滴用同族的深色渐变 + 一圈细亮边，
     * 纯白会和面板撞色，看起来像另一套材质。 */
    dropRefs.path.setAttribute('opacity', (1 - smoothstep(0.72, 1, dp)).toFixed(3));

    var gooEnv = dp < 0.88 ? Math.sin(clamp(dp / 0.88, 0, 1) * Math.PI) : 0;
    if (gooEnv * 6.4 > 0.2) {
      dropRefs.blur.setAttribute('stdDeviation', (gooEnv * 6.4).toFixed(2));
      dropRefs.group.setAttribute('filter', 'url(#fx-genie-goo)');
    } else {
      dropRefs.group.removeAttribute('filter');
    }
  }

  /* ---------- 面板变换 ---------- */
  function measure(panel, fab) {
    var pr = panel.getBoundingClientRect();
    var fr = fab.getBoundingClientRect();
    geo = {
      fx: fr.left + fr.width / 2,
      fy: fr.top + fr.height / 2,
      originX: fr.left + fr.width / 2 - pr.left,
      originY: fr.top + fr.height / 2 - pr.top
    };
    panel.style.transformOrigin = geo.originX.toFixed(1) + 'px ' + geo.originY.toFixed(1) + 'px';
  }

  function applyPanel(panel, p) {
    if (p <= 0) {
      panel.style.opacity = '0';
      panel.style.transform =
        'perspective(900px) translate3d(0px, 26px, -110px) rotateX(46deg) scale3d(0.24, 0.32, 1)';
      panel.style.pointerEvents = 'none';
      return;
    }
    var k = clamp(p, 0, 1);
    var opacity = smoothstep(0, 0.34, p);
    var sx = lerp(0.26, 1, easeOutQuart(k));
    var sy = lerp(0.34, 1, easeOutCubic(k));
    var tilt = 1 - Math.pow(smoothstep(0.04, 0.94, k), 0.92);
    var rotX = 46 * tilt;
    var zArc = lerp(-110, 0, easeOutCubic(k)) + 14 * Math.sin(k * Math.PI) * smoothstep(0.2, 0.7, k);
    var dy = lerp(26, 0, easeOutQuart(k)) + 3.5 * Math.sin(clamp((k - 0.25) / 0.75, 0, 1) * Math.PI) * (1 - k * 0.35) * -1;
    panel.style.opacity = opacity.toFixed(3);
    panel.style.transform =
      'perspective(900px) translate3d(0px,' + dy.toFixed(2) + 'px,' + zArc.toFixed(2) + 'px) ' +
      'rotateX(' + rotX.toFixed(2) + 'deg) ' +
      'scale3d(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ',1)';
    panel.style.pointerEvents = p > 0.6 ? 'auto' : 'none';
  }

  function render(p) {
    var panel = document.getElementById('fx-panel');
    if (!panel) return;
    applyPanel(panel, p);
    drawDrop(p);
  }

  function tick(now) {
    var panel = document.getElementById('fx-panel');
    if (!panel) { raf = null; running = false; return; }
    if (!tick.last) tick.last = now;
    var dt = Math.min(now - tick.last, 50);
    tick.last = now;
    var duration = dir > 0 ? OPEN_MS : CLOSE_MS;
    tick.u = clamp((tick.u || 0) + dt / duration, 0, 1);
    progress = dir > 0 ? openP(tick.u) : closeP(tick.u);
    render(progress);
    if (tick.u >= 1) {
      raf = null;
      running = false;
      tick.last = 0;
      progress = dir > 0 ? 1 : 0;
      render(progress);
      if (dir > 0) finishOpen(panel); else finishClose(panel);
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function finishOpen(panel) {
    panel.classList.add('show');
    panel.classList.remove(RUN_CLASS);
    panel.style.transform = '';
    panel.style.opacity = '';
    panel.style.pointerEvents = '';
    panel.style.transformOrigin = '';
    if (drop) drop.style.display = 'none';
  }

  function finishClose(panel) {
    panel.classList.remove('show', 'peek', RUN_CLASS, 'closing');
    panel.style.transform = '';
    panel.style.opacity = '';
    panel.style.pointerEvents = '';
    panel.style.transformOrigin = '';
    if (drop) drop.style.display = 'none';
  }

  function startRunning() {
    running = true;
    if (raf) cancelAnimationFrame(raf);
    tick.last = 0;
    raf = requestAnimationFrame(tick);
  }

  /* 接管前清场：停弹簧、停 CSS 关键帧、摘掉 peek/关闭类 */
  function cancelRivals(panel) {
    try {
      if (window.MineradioMotion && typeof window.MineradioMotion.cancelUi === 'function') {
        window.MineradioMotion.cancelUi(panel);
      } else if (window.MineradioMotion && typeof window.MineradioMotion.releaseUiTransform === 'function') {
        window.MineradioMotion.releaseUiTransform(panel);
      }
    } catch (_) { }
    panel.classList.remove('closing', 'peek');
  }

  /* ---------- 对外 API ---------- */
  function open() {
    var panel = document.getElementById('fx-panel');
    var fab = document.getElementById('fx-fab');
    if (!panel || !fab) return false;
    if (prefersReduced()) return false;          // 交给原逻辑做瞬时显示
    /* 先掐掉可能还在跑的弹簧 / peek 动画：它们每帧写 transform，
     * 不取消就会和液态动画抢同一个属性（旧的 fx-panel-in、springUiIn 都算）。 */
    cancelRivals(panel);
    panel.classList.add(RUN_CLASS, 'show');
    panel.classList.remove('closing', 'peek');
    ensureDrop();
    drop.style.display = 'block';
    measure(panel, fab);
    dir = 1;
    tick.u = invert(openP, progress, false);
    running = true;
    startRunning();
    return true;
  }

  function close() {
    var panel = document.getElementById('fx-panel');
    var fab = document.getElementById('fx-fab');
    if (!panel || !fab) return false;
    if (prefersReduced()) return false;
    if (!panel.classList.contains('show') && !panel.classList.contains('peek')) return false;
    cancelRivals(panel);
    panel.classList.add(RUN_CLASS);
    panel.classList.remove('peek');
    ensureDrop();
    drop.style.display = 'block';
    measure(panel, fab);
    dir = -1;
    tick.u = invert(closeP, progress, true);
    running = true;
    startRunning();
    return true;
  }

  function isRunning() { return running; }

  window.FxPanelGenie = {
    open: open,
    close: close,
    running: isRunning,
    progress: function () { return progress; },
    /* 仅供预览/调试：把面板定格在指定进度 */
    _render: function (p) {
      var panel = document.getElementById('fx-panel');
      var fab = document.getElementById('fx-fab');
      if (!panel || !fab) return false;
      panel.classList.add(RUN_CLASS, 'show');
      ensureDrop();
      drop.style.display = 'block';
      measure(panel, fab);
      progress = p;
      render(p);
      return true;
    }
  };
})();
