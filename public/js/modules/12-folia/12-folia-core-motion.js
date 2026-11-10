/* Folia 世界 — 动画内核
 *
 * Folia 的模式用 framer-motion 写动画（spring / tween / keyframes + custom variant）。
 * 本项目是 classic script + 全局 rAF 主循环，没有 React，也没有必要为了这些曲线把
 * framer-motion 整套搬进来（它是 React 绑定；vanilla 部分要另外 vendor ESM 再动态 import）。
 * 所以这里重写一个等价的最小内核：
 *
 *   1. cubic-bezier 求值，参数与 framer 的 easeIn / easeOut / easeInOut 完全一致
 *   2. spring 用同样的物理参数（stiffness / damping / mass）数值积分，采样成表后逐帧查表，
 *      过冲量、稳定时间与 framer 一致（framer 自己也是每帧数值积分）
 *   3. 动画节点按属性独立计时：framer 的 transition 允许每个属性自己的 duration，
 *      classic 的 passed 状态里 transform 0.5s、rotate 5s 就是靠这个
 *   4. 关键帧采样（times + 单一 ease，逐段套用），给逐字辉光的 0→1→0 用
 *
 * 所有函数带 folia 前缀；不读写任何 DOM（只返回数值，由调用方写样式）。
 */
'use strict';

var FOLIA_EASE_BEZIERS = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1]
};

/* 标准 cubic-bezier 求值：Newton-Raphson 求 t，再算 y(t)。与浏览器 transition 的曲线一致。 */
function foliaCubicBezierEase(x1, y1, x2, y2) {
  function bezier(t, a, b) {
    var u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  }
  function slope(t, a, b) {
    var u = 1 - t;
    return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  }
  return function (x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var t = x;
    for (var i = 0; i < 8; i++) {
      var err = bezier(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) return bezier(t, y1, y2);
      var d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    var lo = 0, hi = 1;
    t = x;
    for (var k = 0; k < 24; k++) {
      var xv = bezier(t, x1, x2);
      if (Math.abs(xv - x) < 1e-6) break;
      if (xv < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return bezier(t, y1, y2);
  };
}

var foliaEaseCache = {};

/* name 可以是内置名，也可以是 [x1,y1,x2,y2]（framer 允许直接写贝塞尔数组，tilt 的
 * [0.25,0.46,0.45,0.94] 就是这种）。 */
function foliaEase(name) {
  if (Array.isArray(name) && name.length === 4) {
    var key4 = 'c' + name.join(',');
    if (foliaEaseCache[key4]) return foliaEaseCache[key4];
    var custom = foliaCubicBezierEase(name[0], name[1], name[2], name[3]);
    foliaEaseCache[key4] = custom;
    return custom;
  }
  var key = String(name || 'easeOut');
  if (foliaEaseCache[key]) return foliaEaseCache[key];
  var def = FOLIA_EASE_BEZIERS[key] || FOLIA_EASE_BEZIERS.easeOut;
  var fn = foliaCubicBezierEase(def[0], def[1], def[2], def[3]);
  foliaEaseCache[key] = fn;
  return fn;
}

/* ---- spring：归一化位移表（0 → 1，含过冲）。按 dt 与帧率无关地积分，查表时线性插值。 ---- */
var FOLIA_SPRING_STEP = 1 / 480;
var FOLIA_SPRING_TABLE_SECONDS = 3;
var foliaSpringTableCache = {};

function foliaSpringTable(stiffness, damping, mass) {
  var k = isFinite(stiffness) ? stiffness : 200;
  var c = isFinite(damping) ? damping : 20;
  var m = isFinite(mass) && mass > 0 ? mass : 1;
  var key = k + '|' + c + '|' + m;
  var cached = foliaSpringTableCache[key];
  if (cached) return cached;

  var samples = [];
  var x = 0;
  var v = 0;
  var steps = Math.ceil(FOLIA_SPRING_TABLE_SECONDS / FOLIA_SPRING_STEP);
  var restAt = -1;
  for (var i = 0; i <= steps; i++) {
    samples.push(x);
    var accel = (-k * (x - 1) - c * v) / m;
    v += accel * FOLIA_SPRING_STEP;
    x += v * FOLIA_SPRING_STEP;
    if (restAt < 0 && i > 5 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) {
      restAt = i * FOLIA_SPRING_STEP;
    }
  }

  var table = {
    samples: samples,
    step: FOLIA_SPRING_STEP,
    restAt: restAt > 0 ? restAt : FOLIA_SPRING_TABLE_SECONDS
  };
  foliaSpringTableCache[key] = table;
  return table;
}

function foliaSpringProgress(table, elapsed) {
  if (elapsed <= 0) return 0;
  var pos = elapsed / table.step;
  var i = Math.floor(pos);
  if (i >= table.samples.length - 1) return 1;
  var frac = pos - i;
  return table.samples[i] + (table.samples[i + 1] - table.samples[i]) * frac;
}

/* ---- 关键帧采样：values 为数值数组，times 为 0..1 的对应位置，单一 ease 逐段套用 ---- */
function foliaSampleKeyframes(values, times, easeFn, t) {
  var n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  var p = Math.min(Math.max(t, 0), 1);
  var i = 0;
  while (i < n - 2 && p > times[i + 1]) i += 1;
  var span = times[i + 1] - times[i];
  var local = span > 0 ? (p - times[i]) / span : 1;
  local = Math.min(Math.max(local, 0), 1);
  var eased = easeFn ? easeFn(local) : local;
  return values[i] + (values[i + 1] - values[i]) * eased;
}

/* ---- 动画节点：每属性独立计时 ---- */
function foliaAnimCreate() {
  var node = { v: {}, tr: {} };

  node.snap = function (name, value) {
    node.v[name] = value;
    if (node.tr[name]) delete node.tr[name];
  };

  /* opts: { duration, ease, delay, spring:{stiffness,damping,mass} } */
  node.to = function (name, value, opts) {
    opts = opts || {};
    var from = node.v[name];
    if (typeof from !== 'number' || !isFinite(from)) {
      node.snap(name, value);
      return;
    }
    var delay = isFinite(opts.delay) ? Math.max(0, opts.delay) : 0;
    if (opts.spring) {
      node.tr[name] = {
        kind: 'spring',
        from: from,
        to: value,
        table: foliaSpringTable(opts.spring.stiffness, opts.spring.damping, opts.spring.mass),
        t: -delay
      };
      return;
    }
    var duration = opts.duration == null ? 0.3 : Number(opts.duration);
    if (!(duration > 0)) {
      node.snap(name, value);
      return;
    }
    node.tr[name] = {
      kind: 'tween',
      from: from,
      to: value,
      dur: duration,
      ease: foliaEase(opts.ease || 'easeOut'),
      t: -delay
    };
  };

  /* 返回 true 表示本帧仍有属性在动 */
  node.step = function (dt) {
    var moving = false;
    for (var name in node.tr) {
      var tr = node.tr[name];
      if (!tr) continue;
      tr.t += dt;
      if (tr.t < 0) { moving = true; continue; }
      if (tr.kind === 'spring') {
        var p = foliaSpringProgress(tr.table, tr.t);
        node.v[name] = tr.from + (tr.to - tr.from) * p;
        if (tr.t >= tr.table.restAt) {
          node.v[name] = tr.to;
          delete node.tr[name];
        } else {
          moving = true;
        }
      } else {
        var q = tr.dur > 0 ? Math.min(1, tr.t / tr.dur) : 1;
        node.v[name] = tr.from + (tr.to - tr.from) * tr.ease(q);
        if (q >= 1) {
          node.v[name] = tr.to;
          delete node.tr[name];
        } else {
          moving = true;
        }
      }
    }
    return moving;
  };

  node.isMoving = function () {
    for (var name in node.tr) { if (node.tr[name]) return true; }
    return false;
  };

  return node;
}

/* ---- 颜色工具（与 Folia colorMix 同语义） ----
 * 三种结果：hex/rgb 解析成功 → {r,g,b}；'passthrough' 认不出是颜色（命名色 / hsl）→ 原样返回；
 * null 该是颜色但解析失败（空串 / 坏 hex）→ 白底兜底（Folia 的行为；返回空串会让整条声明无效）。 */
var FOLIA_FALLBACK_RGB = { r: 255, g: 255, b: 255 };
var foliaColorParseCache = new Map();
var FOLIA_COLOR_PARSE_CACHE_LIMIT = 512;

function foliaReadColorChannels(normalized) {
  if (!normalized) return null;
  if (normalized.charAt(0) === '#') {
    var hex = normalized.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
    return null;
  }
  var m = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    var parts = m[1].split(',').slice(0, 3).map(function (p) { return parseFloat(p.trim()); });
    if (parts.every(isFinite)) return { r: parts[0], g: parts[1], b: parts[2] };
    return null;
  }
  return 'passthrough';
}

/* 主题色每帧每字都要问一次，解析（正则 + parseInt）才是贵的部分，按字符串缓存。 */
function foliaParseColor(color) {
  var normalized = typeof color === 'string' ? color.trim() : '';
  var cached = foliaColorParseCache.get(normalized);
  if (cached !== undefined) return { normalized: normalized, parsed: cached };
  var parsed = foliaReadColorChannels(normalized);
  if (foliaColorParseCache.size >= FOLIA_COLOR_PARSE_CACHE_LIMIT) foliaColorParseCache.clear();
  foliaColorParseCache.set(normalized, parsed);
  return { normalized: normalized, parsed: parsed };
}

function foliaParseColorChannels(color) {
  var parsed = foliaParseColor(color).parsed;
  if (!parsed || parsed === 'passthrough') return null;
  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

function foliaFormatRgba(channels, alpha) {
  var clampChannel = function (v) { return Math.round(Math.min(255, Math.max(0, v))); };
  var a = Math.min(1, Math.max(0, Number(alpha)));
  if (!isFinite(a)) a = 1;
  return 'rgba(' + clampChannel(channels.r) + ', ' + clampChannel(channels.g) + ', '
    + clampChannel(channels.b) + ', ' + a + ')';
}

function foliaColorWithAlpha(color, alpha) {
  var r = foliaParseColor(color);
  if (r.parsed === 'passthrough') return r.normalized;
  return foliaFormatRgba(r.parsed || FOLIA_FALLBACK_RGB, alpha);
}

/* amount=0 取 from、1 取 to；alpha 默认 1。任一端不是 hex/rgb 时退化成二选一（与 Folia 一致）。 */
function foliaMixColors(from, to, amount, alpha) {
  var a = (alpha === undefined || alpha === null) ? 1 : alpha;
  var n = Number(amount);
  var clamped = isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  var fromParsed = foliaParseColor(from).parsed;
  var toParsed = foliaParseColor(to).parsed;
  if (typeof fromParsed === 'string' || typeof toParsed === 'string') {
    return foliaColorWithAlpha(clamped >= 0.5 ? to : from, a);
  }
  var f = fromParsed || FOLIA_FALLBACK_RGB;
  var t = toParsed || FOLIA_FALLBACK_RGB;
  var mix = function (x, y) { return x + (y - x) * clamped; };
  return foliaFormatRgba({ r: mix(f.r, t.r), g: mix(f.g, t.g), b: mix(f.b, t.b) }, a);
}

/* ---- 逐帧跟随型弹簧（framer 的 useSpring） ----
 * 与 foliaAnimCreate 的 spring 不同：那个是「一次到位」的过渡，这个是每帧把当前值往
 * 新目标推，用于音频能量平滑（claddagh 的低频 / 人声）。半隐式欧拉 + 1/240 子步，
 * stiffness / damping / mass 与 framer 同义。 */
function foliaSpringFollower(stiffness, damping, mass) {
  var k = isFinite(stiffness) ? Number(stiffness) : 100;
  var c = isFinite(damping) ? Number(damping) : 10;
  var m = (isFinite(mass) && Number(mass) > 0) ? Number(mass) : 1;
  var x = 0;
  var v = 0;
  return {
    get: function () { return x; },
    set: function (value) {
      if (!isFinite(value)) return;
      x = Number(value);
      v = 0;
    },
    step: function (target, dt) {
      if (!isFinite(target) || !(dt > 0)) return x;
      var steps = Math.min(16, Math.max(1, Math.ceil(dt / (1 / 240))));
      var h = dt / steps;
      for (var i = 0; i < steps; i++) {
        var accel = (-k * (x - target) - c * v) / m;
        v += accel * h;
        x += v * h;
      }
      return x;
    }
  };
}

/* ---- 字形缓存泄漏防护（Folia utils/glowBlurQuantize.ts） ----
 * 逐帧变化的 text-shadow 半径会让 Chromium 每帧铸一个新的字形缓存，4KiB 共享内存块不归还；
 * Linux 渲染进程 1024 fd 软上限约 35 分钟耗尽 → 画面冻结。开着时半径取整像素。
 * 键与平台默认都沿用 Folia：Linux 默认开，其余平台默认关。 */
var FOLIA_GLOW_QUANTIZE_KEY = 'visualizer_glow_blur_quantize';
var foliaGlowQuantizedCache = null;

function foliaGlowBlurQuantized() {
  if (foliaGlowQuantizedCache !== null) return foliaGlowQuantizedCache;
  var value;
  try {
    var stored = localStorage.getItem(FOLIA_GLOW_QUANTIZE_KEY);
    if (stored === 'true' || stored === 'false') value = stored === 'true';
  } catch (_) {}
  if (value === undefined) {
    var isLinux = false;
    try {
      var platform = window.electron && window.electron.platform;
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      isLinux = platform ? platform === 'linux' : (/Linux/.test(ua) && !/Android/.test(ua));
    } catch (_) {}
    value = isLinux;
  }
  foliaGlowQuantizedCache = value;
  return value;
}

function foliaQuantizeShadowBlur(px) {
  var n = Number(px);
  if (!isFinite(n)) return 0;
  return foliaGlowBlurQuantized() ? Math.max(0, Math.round(n)) : n;
}

/* ---- canvas 辉光（Folia utils/glowBlurQuantize.ts 的 set/clear/fill） ---- */

/* 关：canvas shadow；开（Linux 默认）：同参数换成 drop-shadow() filter
 * （sigma = blur/2，都不跟随 CTM，误差 <1/255），绕开每帧新铸字形缓存的泄漏。 */
function foliaSetCanvasTextGlow(context, blur, color) {
  if (!foliaGlowBlurQuantized()) {
    context.shadowBlur = blur;
    context.shadowColor = color;
    return;
  }
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.filter = blur > 0 ? 'drop-shadow(0 0 ' + (blur / 2) + 'px ' + color + ')' : 'none';
}

function foliaClearCanvasTextGlow(context) {
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  if (foliaGlowBlurQuantized()) context.filter = 'none';
}

/* 带辉光的 fillText：辉光是 filter 时把绘制裁剪到文字+辉光的包围盒，
 * 否则 Chromium 会把 filter 应用到整块画布（fume 实测 120fps → 90fps）。 */
function foliaFillGlowText(context, text, x, y) {
  var sigma = 0;
  var m = /^drop-shadow\(0 0 ([\d.]+)px /.exec(context.filter || '');
  if (m) sigma = Number(m[1]);
  if (!sigma) {
    context.fillText(text, x, y);
    return;
  }
  var metrics = context.measureText(text);
  var pad = sigma * 4 + 4;
  var left = x - metrics.actualBoundingBoxLeft - pad;
  var top = y - metrics.actualBoundingBoxAscent - pad;
  context.save();
  context.beginPath();
  context.rect(
    left,
    top,
    metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight + pad * 2,
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + pad * 2
  );
  context.clip();
  context.fillText(text, x, y);
  context.restore();
}

/* ---- 标量缓动 / 数值（Folia fumeMath.ts） ---- */
function foliaMix(from, to, amount) {
  return from + (to - from) * amount;
}

function foliaEaseOutCubic(value) {
  var n = foliaClamp(value, 0, 1);
  return 1 - Math.pow(1 - n, 3);
}

function foliaEaseInCubic(value) {
  return Math.pow(foliaClamp(value, 0, 1), 3);
}

function foliaEaseInOutCubic(value) {
  var n = foliaClamp(value, 0, 1);
  return n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2;
}

function foliaQuadraticBezier(from, control, to, amount) {
  var n = foliaClamp(amount, 0, 1);
  var inverse = 1 - n;
  return inverse * inverse * from + 2 * inverse * n * control + n * n * to;
}

/* 延迟辉光包络：前 peakProgress  easeOut 起，之后 easeIn 收（逐字辉光 / 行辉光共用）。 */
function foliaDelayedGlowEnvelope(progress, peakProgress) {
  var n = foliaClamp(progress, 0, 1);
  var clampedPeak = foliaClamp(peakProgress == null ? 0.8 : peakProgress, 0.05, 0.95);
  if (n <= clampedPeak) return foliaEaseOutCubic(n / clampedPeak);
  return 1 - foliaEaseInCubic((n - clampedPeak) / (1 - clampedPeak));
}

/* Folia fumeMath.ts 的 isCJK（注意与 10-text 的 foliaHasCjk 故意不同：
 * 那边对应 Folia wordColoring.ts 的 \u9fa5 上界，这边对应 fumeMath.ts 的 \u9fff）。 */
var FOLIA_FUME_CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
function foliaIsCjk(text) {
  return FOLIA_FUME_CJK_RE.test(String(text == null ? '' : text));
}
