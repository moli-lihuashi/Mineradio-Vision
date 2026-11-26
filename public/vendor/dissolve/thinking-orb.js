/*! dissolve-ui · ThinkingOrb（vanilla 抽取版）
 * MIT License
 *
 * Copyright (c) 2026 Rayan Selmi
 * Source: https://dissolve.rselmi.com/
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * --- Mineradio 接入说明 ---------------------------------------------------
 * 上游发布的是 React + TS + shadow DOM surface 的形态，本项目是 classic script，
 * 所以只抽取 createThinkingOrb（它不依赖 React、不依赖 createSurface），
 * 去掉 demo 控件层与示例数据。对外只暴露 window.DissolveThinkingOrb。
 * 原文件其余部分未改动算法。
 */
(function (global) {
  'use strict';

  // src/lib/motion-core/dissolve/kit.ts
  var reducedMotion = function () {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  function vibrate(pattern) {
    if (typeof navigator === 'undefined' || !navigator.userActivation || !navigator.userActivation.hasBeenActive) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  }
  function injectStyle(id, css, root) {
    var target = root || document;
    if (typeof document === 'undefined' || target.getElementById(id)) return;
    var s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    (root || document.head).appendChild(s);
  }
  function token(node, name, fallback) {
    return getComputedStyle(node).getPropertyValue('--dissolve-' + name).trim() || fallback;
  }
  function onThemeChange(sc, fn) {
    var mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    var mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', fn);
    sc.onDispose(function () {
      mo.disconnect();
      mq.removeEventListener('change', fn);
    });
  }
  var probe = null;
  function rgbOf(color) {
    if (!probe) {
      probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      probe = probe.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    var d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  function propsOf(defaults, initial) {
    var raw = Object.assign({}, initial);
    var resolve = function () {
      var out = Object.assign({}, defaults);
      Object.keys(raw).forEach(function (k) {
        if (raw[k] !== void 0) out[k] = raw[k];
      });
      return out;
    };
    var box = {
      current: resolve(),
      update: function (next) {
        raw = Object.assign({}, raw, next);
        var prev = box.current;
        box.current = resolve();
        var cur = box.current;
        return new Set(Object.keys(Object.assign({}, prev, cur)).filter(function (k) {
          return prev[k] !== cur[k];
        }));
      }
    };
    return box;
  }
  function bezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    var X = function (t) { return ((ax * t + bx) * t + cx) * t; };
    var dX = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };
    var Y = function (t) { return ((ay * t + by) * t + cy) * t; };
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var e = X(t) - x, d = dX(t);
        if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      if (t < 0 || t > 1 || Math.abs(X(t) - x) > 1e-4) {
        var lo = 0, hi = 1;
        t = x;
        for (var j = 0; j < 40; j++) {
          if (X(t) < x) lo = t;
          else hi = t;
          t = (lo + hi) / 2;
        }
      }
      return Y(t);
    };
  }
  var CALM = bezier(0.32, 0.72, 0, 1);
  var clamp = function (x, a, b) {
    if (a === void 0) a = 0;
    if (b === void 0) b = 1;
    return x < a ? a : x > b ? b : x;
  };
  function scope() {
    var timers = new Set(), handles = new Set(), fns = [];
    var sc = {
      alive: true,
      wait: function (ms) {
        return new Promise(function (res) {
          var t = setTimeout(function () {
            timers.delete(t);
            if (sc.alive) res();
          }, ms);
          timers.add(t);
        });
      },
      track: function (h) {
        handles.add(h);
        h.done.then(function () { handles.delete(h); });
        return h;
      },
      onDispose: function (fn) { fns.push(fn); },
      dispose: function () {
        if (!sc.alive) return;
        sc.alive = false;
        timers.forEach(clearTimeout);
        handles.forEach(function (h) { h.cancel(); });
        fns.forEach(function (f) { f(); });
      }
    };
    return sc;
  }
  function value(sc, v0, onChange) {
    var id = 0;
    var a = {
      v: v0,
      vel: 0,
      set: function (x) {
        id++;
        a.v = x;
        a.vel = 0;
        onChange();
      },
      to: function (to, ms, ease, delay) {
        if (ease === void 0) ease = CALM;
        if (delay === void 0) delay = 0;
        var my = ++id, from = a.v;
        return new Promise(function (res) {
          var t0 = performance.now() + delay;
          var lastT = t0;
          var f = function (now) {
            if (my !== id) return res(false);
            if (!sc.alive) return;
            if (now < t0) { requestAnimationFrame(f); return; }
            var k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
            var prev = a.v;
            a.v = from + (to - from) * ease(k);
            var dt = (now - lastT) / 1e3;
            a.vel = dt > 0 ? (a.v - prev) / dt : 0;
            lastT = now;
            onChange();
            if (k < 1) requestAnimationFrame(f);
            else {
              a.vel = 0;
              res(true);
            }
          };
          requestAnimationFrame(f);
        });
      },
      spring: function (to, opts) {
        opts = opts || {};
        var stiffness = opts.stiffness === void 0 ? 260 : opts.stiffness;
        var damping = opts.damping === void 0 ? 31 : opts.damping;
        var mass = opts.mass === void 0 ? 1 : opts.mass;
        var eps = opts.eps === void 0 ? 0.02 : opts.eps;
        var my = ++id;
        return new Promise(function (res) {
          var last = performance.now();
          var f = function (now) {
            if (my !== id) return res(false);
            if (!sc.alive) return;
            var dt = Math.min(0.064, (now - last) / 1e3);
            last = now;
            while (dt > 0) {
              var h = Math.min(1 / 480, dt);
              a.vel += (-stiffness * (a.v - to) - damping * a.vel) / mass * h;
              a.v += a.vel * h;
              dt -= h;
            }
            if (Math.abs(a.v - to) < eps && Math.abs(a.vel) < eps * 10) {
              a.v = to;
              a.vel = 0;
              onChange();
              return res(true);
            }
            onChange();
            requestAnimationFrame(f);
          };
          requestAnimationFrame(f);
        });
      }
    };
    return a;
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }
  function onScreen(sc, node, onChange) {
    var waiting = [];
    var st = {
      on: true,
      shown: function () {
        return st.on ? Promise.resolve() : new Promise(function (res) { waiting.push(res); });
      }
    };
    var io = new IntersectionObserver(function (entries) {
      st.on = entries[0].isIntersecting;
      if (st.on) {
        waiting.forEach(function (res) { res(); });
        waiting = [];
      }
      if (onChange) onChange(st.on);
    });
    io.observe(node);
    sc.onDispose(function () { io.disconnect(); });
    return st;
  }
  function loop(sc, node, fn, active) {
    if (active === void 0) active = function () { return true; };
    var raf = 0;
    var seen;
    var tick = function (now) {
      raf = 0;
      if (!sc.alive) return;
      fn(now);
      if (seen.on && active()) raf = requestAnimationFrame(tick);
    };
    var kick = function () {
      if (!raf && sc.alive) raf = requestAnimationFrame(tick);
    };
    seen = onScreen(sc, node, function (on) { if (on) kick(); });
    kick();
    sc.onDispose(function () { cancelAnimationFrame(raf); });
    return { kick: kick };
  }

  // src/lib/motion-core/dissolve/thinking-orb.core.ts
  var DEFAULTS = { state: 'idle', size: 64, dots: 180, interactive: false, haptics: true };
  var TAU = Math.PI * 2;
  var GA = Math.PI * (3 - Math.sqrt(5));
  var MORPH = 600;
  var STAGGER = 1.5;
  var FALL = 900;
  var FLEE = 40;
  var RING_SPD = [21e-4, -16e-4, 12e-4];
  var RING_TZ = [0, 1.05, -1.05];
  var CHECK = [[-0.52, 0.02], [-0.16, 0.38], [0.56, -0.36]];
  var CSS = '\n:where([data-dissolve="thinking-orb"]) { position: relative; display: block; flex: none; -webkit-tap-highlight-color: transparent; }\n:where(.dissolve-orb-canvas) { display: block; }\n';
  var lerp3 = function (a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  var unit = function (c) {
    var rgb = rgbOf(c);
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  };

  function createThinkingOrb(host, initial) {
    if (initial === void 0) initial = {};
    var root = host.getRootNode();
    injectStyle('dissolve-thinking-orb', CSS, root instanceof ShadowRoot ? root : void 0);
    var props = propsOf(DEFAULTS, initial);
    var p = function () { return props.current; };
    var reduce = function () { return p().reducedMotion === void 0 ? reducedMotion() : p().reducedMotion; };
    var DPR = Math.min(2, window.devicePixelRatio || 1);
    var sc = scope();
    host.dataset.dissolve = 'thinking-orb';
    host.setAttribute('role', 'img');
    var cv = el('canvas', 'dissolve-orb-canvas');
    host.append(cv);
    var ctx = cv.getContext('2d');
    var S = 0, N = 0, R = 0, DOT = 0;
    var r1 = new Float32Array(0), r2 = new Float32Array(0), fib = new Float32Array(0), check = new Float32Array(0);
    var cur = new Float32Array(0), from = new Float32Array(0), vel = new Float32Array(0), off = new Float32Array(0), offV = new Float32Array(0);
    var tg = new Float32Array(4);
    var colors = null;
    var shape = 'idle';
    var t0 = -1e9, fallUntil = 0, level = 0, last = performance.now();
    var epoch = performance.now();
    var ok = value(sc, 0, function () { });
    var bad = value(sc, 0, function () { });
    var ptr = null;

    function layout() {
      S = p().size;
      R = S * 0.4;
      DOT = p().dotSize !== void 0 && p().dotSize !== null ? p().dotSize / 2 : Math.max(1.25, S * 0.0105);
      cv.width = Math.round(S * DPR);
      cv.height = Math.round(S * DPR);
      cv.style.width = cv.style.height = S + 'px';
      host.style.width = host.style.height = S + 'px';
    }
    function seed() {
      N = Math.max(1, Math.round(p().dots));
      r1 = new Float32Array(N);
      r2 = new Float32Array(N);
      fib = new Float32Array(N * 3);
      check = new Float32Array(N * 3);
      for (var i = 0; i < N; i++) {
        r1[i] = Math.random();
        r2[i] = Math.random();
        var y = 1 - (i + 0.5) / N * 2;
        var r = Math.sqrt(1 - y * y);
        var th = i * GA;
        fib[i * 3] = Math.cos(th) * r;
        fib[i * 3 + 1] = y;
        fib[i * 3 + 2] = Math.sin(th) * r;
      }
      var segs = [];
      var tot = 0;
      for (var k = 0; k < 2; k++) {
        var a = CHECK[k], b = CHECK[k + 1];
        var l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        segs.push([a, b, l]);
        tot += l;
      }
      for (var j = 0; j < N; j++) {
        var s = (j + 0.5) / N * tot;
        var kk = 0;
        while (kk < 1 && s > segs[kk][2]) {
          s -= segs[kk][2];
          kk++;
        }
        var sa = segs[kk][0], sb = segs[kk][1], sl = segs[kk][2];
        var u = s / sl;
        var nx = -(sb[1] - sa[1]) / sl, ny = (sb[0] - sa[0]) / sl;
        var jj = (r1[j] - 0.5) * 0.11;
        check[j * 3] = sa[0] + (sb[0] - sa[0]) * u + nx * jj;
        check[j * 3 + 1] = sa[1] + (sb[1] - sa[1]) * u + ny * jj;
        check[j * 3 + 2] = (r2[j] - 0.5) * 0.5;
      }
      cur = new Float32Array(N * 4);
      from = new Float32Array(N * 4);
      vel = new Float32Array(N * 2);
      off = new Float32Array(N * 2);
      offV = new Float32Array(N * 2);
      for (var m = 0; m < N; m++) {
        cur[m * 4] = fib[m * 3];
        cur[m * 4 + 1] = fib[m * 3 + 1];
        cur[m * 4 + 2] = fib[m * 3 + 2];
        cur[m * 4 + 3] = 1;
      }
      from.set(cur);
    }
    function target(st, i, tm, o) {
      var x, y, z, a = 1;
      if (st === 'thinking') {
        var r = i % 3;
        var ang = (i / 3 | 0) / (N / 3) * TAU + tm * RING_SPD[r];
        var x0 = Math.cos(ang) * 0.95, z0 = Math.sin(ang) * 0.95;
        var y1 = -z0 * Math.sin(0.45), z1 = z0 * Math.cos(0.45);
        var c2 = Math.cos(RING_TZ[r]), s2 = Math.sin(RING_TZ[r]);
        x = x0 * c2 - y1 * s2;
        y = x0 * s2 + y1 * c2;
        z = z1;
      } else if (st === 'searching') {
        var rd = 0.95 * Math.sqrt((i + 0.5) / N), th = i * GA;
        x = Math.cos(th) * rd;
        y = Math.sin(th) * rd;
        var d = (tm / 1e3 * TAU - th) % TAU;
        if (d < 0) d += TAU;
        a = 0.3 + 0.7 * Math.exp(-d * 1.4);
        z = a * 0.6 - 0.3;
      } else if (st === 'done') {
        x = check[i * 3];
        y = check[i * 3 + 1];
        z = check[i * 3 + 2];
      } else {
        x = fib[i * 3];
        y = fib[i * 3 + 1];
        z = fib[i * 3 + 2];
        var s = 0.98 + 0.02 * Math.sin(tm / 2400 * TAU);
        if (st === 'listening') s = (0.84 + level * 0.2) * (1 + 0.06 * level * Math.sin(y * 5 - tm * 0.012));
        x *= s;
        y *= s;
        z *= s;
      }
      if (st !== 'done' && st !== 'searching' && st !== 'thinking') {
        var ra = tm * 4e-4, c = Math.cos(ra), sn = Math.sin(ra);
        var xr = x * c + z * sn, zr = -x * sn + z * c;
        var cb = Math.cos(0.3), sb = Math.sin(0.3);
        x = xr;
        z = y * sb + zr * cb;
        y = y * cb - zr * sb;
      }
      o[0] = x;
      o[1] = y;
      o[2] = z;
      o[3] = a;
    }
    function go(next) {
      if (next === shape && next !== 'error') return;
      from.set(cur);
      shape = next;
      t0 = performance.now();
      ok.to(next === 'done' ? 1 : 0, 600, CALM);
      if (next === 'error') {
        bad.to(1, 150, CALM);
        for (var i = 0; i < N; i++) {
          vel[i * 2] = (r1[i] - 0.5) * 0.7;
          vel[i * 2 + 1] = -r2[i] * 0.6;
        }
        fallUntil = t0 + (reduce() ? 0 : FALL);
      } else bad.to(0, 500, CALM);
    }
    function inputLevel(tm) {
      var l = p().level;
      if (l === void 0 || l === null) {
        return clamp(0.3 + 0.35 * Math.sin(tm * 47e-4) * Math.sin(tm * 13e-4 + 1) + 0.3 * Math.abs(Math.sin(tm * 0.011)));
      }
      return clamp(typeof l === 'number' ? l : l.value);
    }
    function draw(now) {
      var dt = Math.min(0.05, (now - last) / 1e3);
      last = now;
      var red = reduce(), tm = red ? 0 : now - epoch;
      var dur = red ? 150 : MORPH, stg = red ? 0 : STAGGER;
      level += (inputLevel(tm) - level) * (red ? 1 : 0.15);
      if (shape === 'error' && fallUntil && (red || now >= fallUntil)) {
        fallUntil = 0;
        go('idle');
      }
      if (!colors) {
        colors = {
          fg: unit(p().color === void 0 || p().color === null ? token(host, 'foreground', 'rgb(28 28 30)') : p().color),
          ok: unit(token(host, 'success', 'rgb(52 199 89)')),
          bad: unit(token(host, 'danger', 'rgb(255 59 48)'))
        };
      }
      var col = lerp3(lerp3(colors.fg, colors.ok, ok.v), colors.bad, bad.v);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = 'rgb(' + col.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
      var falling = shape === 'error' && fallUntil;
      var flee = ptr && !red && p().interactive ? ptr : null;
      for (var i = 0; i < N; i++) {
        var k4 = i * 4;
        if (falling) {
          vel[i * 2 + 1] += 4.2 * dt;
          cur[k4] += vel[i * 2] * dt;
          cur[k4 + 1] += vel[i * 2 + 1] * dt;
          if (cur[k4 + 1] > 1.05) {
            cur[k4 + 1] = 1.05;
            vel[i * 2 + 1] *= -0.28;
            vel[i * 2] *= 0.7;
          }
        } else {
          target(shape, i, tm, tg);
          var e = CALM(clamp((now - t0 - i * stg) / dur));
          for (var c = 0; c < 4; c++) cur[k4 + c] = from[k4 + c] + (tg[c] - from[k4 + c]) * e;
        }
        var px = S / 2 + cur[k4] * R, py = S / 2 + cur[k4 + 1] * R;
        var gx = 0, gy = 0;
        if (flee) {
          var dx = px - flee.x, dy = py - flee.y, d2 = Math.hypot(dx, dy);
          if (d2 < FLEE && d2 > 0.01) {
            gx = dx / d2 * (FLEE - d2) * 0.8;
            gy = dy / d2 * (FLEE - d2) * 0.8;
          }
        }
        for (var c2 = 0; c2 < 2; c2++) {
          var jj = i * 2 + c2, to = c2 ? gy : gx;
          if (red) {
            offV[jj] = off[jj] = 0;
          } else {
            offV[jj] += (260 * (to - off[jj]) - 22 * offV[jj]) * dt;
            off[jj] += offV[jj] * dt;
          }
        }
        px += off[i * 2];
        py += off[i * 2 + 1];
        var dd = clamp((cur[k4 + 2] + 1) / 2);
        ctx.globalAlpha = (0.38 + 0.62 * dd) * cur[k4 + 3];
        ctx.beginPath();
        ctx.arc(px, py, DOT * (0.8 + 0.4 * dd), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    var local = function (e) {
      var b = cv.getBoundingClientRect();
      var s = b.width / S || 1;
      return { x: (e.clientX - b.left) / s, y: (e.clientY - b.top) / s };
    };
    var onMove = function (e) { ptr = local(e); };
    var onLeave = function () { ptr = null; };
    var onUp = function (e) { if (e.pointerType !== 'mouse') ptr = null; };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerdown', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onLeave);
    function decorate() {
      host.setAttribute('aria-label', 'Assistant ' + p().state);
      host.style.touchAction = p().interactive ? 'pan-y' : '';
    }
    layout();
    seed();
    decorate();
    shape = p().state === 'error' ? 'idle' : p().state;
    if (shape === 'done') ok.set(1);
    draw(performance.now());
    if (p().state === 'error') go('error');
    var motion = loop(sc, cv, draw, function () { return !reduce() || last < t0 + MORPH; });
    onThemeChange(sc, function () {
      colors = null;
      motion.kick();
    });
    var media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', motion.kick);
    sc.onDispose(function () { media.removeEventListener('change', motion.kick); });
    return {
      update: function (next) {
        var changed = props.update(next);
        if (!changed.size) return;
        if (changed.has('size') || changed.has('dotSize')) layout();
        if (changed.has('dots')) {
          seed();
          t0 = -1e9;
        }
        if (changed.has('color')) colors = null;
        if (changed.has('state')) {
          var st = p().state;
          if (p().haptics && st === 'done') vibrate(10);
          if (p().haptics && st === 'error') vibrate([20, 60, 20]);
          go(st);
        }
        decorate();
        motion.kick();
      },
      destroy: function () {
        sc.dispose();
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerdown', onMove);
        host.removeEventListener('pointerleave', onLeave);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onLeave);
        cv.remove();
        delete host.dataset.dissolve;
        host.removeAttribute('role');
        host.removeAttribute('aria-label');
        ['width', 'height', 'touch-action'].forEach(function (k) { host.style.removeProperty(k); });
      }
    };
  }

  global.DissolveThinkingOrb = {
    create: createThinkingOrb,
    mount: function (target, options) { return createThinkingOrb(target, options || {}); }
  };
})(window);
