// ====================================================================
//  红心点击动效引擎（四套 + 随机）
//  ------------------------------------------------------------------
//  四套形态：
//    folia  纸片楔形扇   —— 14 个楔形扇隔一画一 + 纸色圆盘 + 双同心环（自家 Folia 构图）
//    riso   油墨灌满     —— 心形从下往上灌色 + 香槟版错位套准 + 12 半调点（arslanagayev 手法）
//    ring   冲击波粒子   —— 双环扩散 + 12 粒小心/星芒/光点径向炸开再上浮（Twitter 心形时序）
//    star   极简星芒     —— 四向十字星 + 细环，380ms 收尾
//    off    关闭         —— 只变色，连心形跳动都不做
//  选择存在 fx.heartFx（默认 random），入口在顶栏「皮肤」弹层的红心动效六格
//  （视觉控制台「外观」页那一组已删除）。
//
//  取用参考（MIT / 纯前端，未直接引代码）：
//    · frogermcs/LikeAnimation —— Twitter 心形点赞「先扩散圆环、再炸光点」两段式
//    · arslanagayev/like-button-animation —— 每粒一次 WAAPI 调用、播完自删；clip-path 灌色
//
//  两条硬约束：
//    1. 粒子图层挂 document.body —— #bottom-bar.visible 带 backdrop-filter，
//       会成为 position:fixed 后代的包含块，挂在底栏里粒子会被裁进圆角矩形。
//    2. 只动 transform / opacity。prefers-reduced-motion 时四套全部降级成「只变色 + 一次极短缩放」。
// ====================================================================

var HEART_FX_MODES = ['random', 'folia', 'riso', 'ring', 'star'];
var HEART_FX_SOLO_MODES = ['folia', 'riso', 'ring', 'star'];
var HEART_FX_HEART_PATH = 'M12 21.45c-.32 0-.62-.12-.86-.34l-1.23-1.12C5.54 16.03 2.25 13.05 2.25 8.9 2.25 5.48 4.88 2.9 8.28 2.9c1.7 0 3.35.72 4.52 1.96C13.97 3.62 15.62 2.9 17.32 2.9c3.4 0 6.03 2.58 6.03 6 0 4.15-3.29 7.13-7.66 11.09l-1.23 1.12c-.24.22-.54.34-.86.34z';
var HEART_FX_STAR_PATH = 'M12 1.6l1.9 6.1 6.5 2.3-6.5 2.3L12 18.4l-1.9-6.1L3.6 10l6.5-2.3z';
/* 主色沿用 .ctrl-btn.liked 的 #ff7a90；掺香槟 #f4d28a 与薄荷 #7ee2a8
 * （后者就是节拍角标陀螺花的绿），跟底栏的绿/香槟点缀同源，不出重彩。 */
var HEART_FX_COLORS = ['#ff7a90', '#ffa3b4', '#ff7a90', '#f4d28a', '#ff8fa3', '#7ee2a8'];
/* "random" 连续两次不重复：记住上一次用过的单套 */
var heartFxLastSolo = '';

function heartFxReduceMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}

function heartFxConfiguredMode() {
  try {
    if (typeof fx !== 'undefined' && fx && HEART_FX_MODES.indexOf(String(fx.heartFx)) >= 0) {
      return String(fx.heartFx);
    }
  } catch (_) {}
  return 'random';
}

/* random → 抽一套，且不跟上次重复；其余原样返回 */
function heartFxResolveMode(mode) {
  mode = String(mode || heartFxConfiguredMode());
  if (HEART_FX_MODES.indexOf(mode) < 0) mode = 'random';
  if (mode !== 'random') return mode;
  var pool = HEART_FX_SOLO_MODES.filter(function (m) { return m !== heartFxLastSolo; });
  if (!pool.length) pool = HEART_FX_SOLO_MODES.slice();
  var picked = pool[Math.floor(Math.random() * pool.length)];
  heartFxLastSolo = picked;
  return picked;
}

function heartFxLayer() {
  var layer = document.getElementById('heart-fx-layer');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = 'heart-fx-layer';
  layer.className = 'heart-fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

function heartFxRand(min, max) {
  return min + Math.random() * (max - min);
}

/* 播完自删：WAAPI 的 finished 在 cancel 时会 reject，两条路都要回收节点 */
function heartFxRecycle(anim, node) {
  var done = function () {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  };
  try {
    if (anim && anim.finished) anim.finished.then(done, done);
    else setTimeout(done, 1500);
  } catch (_) {
    setTimeout(done, 1500);
  }
}

function heartFxCenter(anchor, layer) {
  var a = anchor.getBoundingClientRect();
  var b = layer.getBoundingClientRect();
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
}

function heartFxHeartSvg(size, color, opts) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.color = color;
  if (!opts || opts.glow !== false) {
    svg.style.filter = 'drop-shadow(0 0 ' + Math.round(size * 0.45) + 'px ' + color + ')';
  }
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', HEART_FX_HEART_PATH);
  path.setAttribute('fill', (opts && opts.stroke) ? 'none' : 'currentColor');
  if (opts && opts.stroke) {
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(opts.strokeWidth || 1.1));
  }
  svg.appendChild(path);
  return svg;
}

function heartFxStarSvg(size, color) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.color = color;
  svg.style.filter = 'drop-shadow(0 0 ' + Math.round(size * 0.5) + 'px ' + color + ')';
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', HEART_FX_STAR_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function heartFxDot(size, color) {
  var dot = document.createElement('i');
  dot.style.width = size + 'px';
  dot.style.height = size + 'px';
  dot.style.borderRadius = '50%';
  dot.style.background = color;
  dot.style.boxShadow = '0 0 ' + Math.round(size * 1.8) + 'px ' + color;
  return dot;
}

/* 冲击环：left/top 给左上角，transform 只留 scale，避免和居中位移打架 */
function heartFxRing(layer, cx, cy, size, color, delay, spread) {
  var ring = document.createElement('span');
  ring.setAttribute('class', 'heart-fx-dot');
  ring.style.width = size + 'px';
  ring.style.height = size + 'px';
  ring.style.left = (cx - size / 2) + 'px';
  ring.style.top = (cy - size / 2) + 'px';
  ring.style.borderRadius = '50%';
  ring.style.border = '1.2px solid ' + color;
  ring.style.boxShadow = '0 0 ' + Math.round(size * 0.42) + 'px ' + color + ', inset 0 0 ' + Math.round(size * 0.26) + 'px ' + color;
  layer.appendChild(ring);
  heartFxRecycle(ring.animate([
    { transform: 'scale(.28)', opacity: 0 },
    { transform: 'scale(.62)', opacity: .92, offset: .22 },
    { transform: 'scale(' + (spread || 1.86) + ')', opacity: 0 }
  ], { duration: 640, delay: delay || 0, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }), ring);
}

/* 给按钮挂一次性动画类：先摘再挂并强制回流，连点两次才会重新起跳 */
function heartFxBeat(anchor, cls, ms) {
  if (!anchor || !anchor.classList) return;
  anchor.classList.remove(cls);
  void anchor.offsetWidth;
  anchor.classList.add(cls);
  if (anchor.__heartFxTimer) clearTimeout(anchor.__heartFxTimer);
  anchor.__heartFxTimer = setTimeout(function () {
    anchor.classList.remove(cls);
    anchor.__heartFxTimer = null;
  }, ms);
}

/* ---------------- folia · 纸片楔形扇 ---------------- */
function heartFxPlayFolia(anchor, layer, scale) {
  var c = heartFxCenter(anchor, layer);
  var R = 74 * scale;
  var box = R * 2, cx = R, cy = R;
  /* SVG 的 fill/stroke 是表现属性，写 var(--x) 在 Chromium 里解析不出来会退回黑色，
   * 所以这套配色直接用字面量，别引 CSS 变量。 */
  var PAPER = '#f7e9d2', TERRA = '#e2705a';
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'heart-fx-svg');
  svg.setAttribute('viewBox', '0 0 ' + box + ' ' + box);
  svg.setAttribute('width', String(box));
  svg.setAttribute('height', String(box));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.left = (c.x - R) + 'px';
  svg.style.top = (c.y - R) + 'px';

  var fan = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  var wedges = 14;
  for (var i = 0; i < wedges; i += 2) {
    var ang = (i / wedges) * Math.PI * 2 + heartFxRand(-0.04, 0.04);
    var spread = 0.115;
    var reach = R * 0.96;
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M' + cx + ',' + cy
      + 'L' + (cx + Math.cos(ang - spread) * reach).toFixed(2) + ',' + (cy + Math.sin(ang - spread) * reach).toFixed(2)
      + 'L' + (cx + Math.cos(ang + spread) * reach).toFixed(2) + ',' + (cy + Math.sin(ang + spread) * reach).toFixed(2) + 'Z');
    p.setAttribute('fill', i % 4 === 0 ? TERRA : PAPER);
    fan.appendChild(p);
    // 子元素不单独回收：父 svg 走的时候一起走
    p.animate([{ opacity: 0 }, { opacity: i % 4 === 0 ? .9 : .78 }],
      { duration: 200, delay: 40 + i * 11, easing: 'ease-out', fill: 'both' });
  }
  svg.appendChild(fan);

  var disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  disc.setAttribute('cx', cx);
  disc.setAttribute('cy', cy);
  disc.setAttribute('r', 23 * scale);
  disc.setAttribute('fill', PAPER);
  disc.style.transformOrigin = cx + 'px ' + cy + 'px';
  disc.style.transformBox = 'view-box';
  svg.appendChild(disc);
  disc.animate([{ opacity: 0, transform: 'scale(.2)' }, { opacity: .98, offset: .35 }, { opacity: 0 }],
    { duration: 720, easing: 'ease-out', fill: 'both' });

  [[27 * scale, 2.6, PAPER, .58], [35 * scale, 1.3, TERRA, .62]].forEach(function (spec, idx) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', cx);
    el.setAttribute('cy', cy);
    el.setAttribute('r', spec[0].toFixed(2));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', spec[2]);
    el.setAttribute('stroke-width', String(spec[1]));
    el.style.transformOrigin = cx + 'px ' + cy + 'px';
    el.style.transformBox = 'view-box';
    svg.appendChild(el);
    el.animate([
      { opacity: 0, transform: 'scale(.45)' },
      { opacity: spec[3], offset: .3 },
      { opacity: 0, transform: 'scale(1.38)' }
    ], { duration: 640, delay: 70 + idx * 70, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
  });

  layer.appendChild(svg);
  heartFxRecycle(svg.animate([
    { opacity: 0, transform: 'scale(.45) rotate(-9deg)' },
    { opacity: 1, offset: .18 },
    { opacity: 1, offset: .58, transform: 'scale(1.04) rotate(1deg)' },
    { opacity: 0, transform: 'scale(1.16) rotate(3deg)' }
  ], { duration: 820, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }), svg);
}

/* ---------------- riso · 油墨灌满 + 半调点 ---------------- */
function heartFxPlayRiso(anchor, layer, scale) {
  var c = heartFxCenter(anchor, layer);
  var size = 40 * scale;
  var wrap = document.createElement('div');
  wrap.className = 'heart-fx-face';
  wrap.style.left = (c.x - size / 2) + 'px';
  wrap.style.top = (c.y - size / 2) + 'px';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  // 底版：只有描边，像还没上墨的印版
  var plate = heartFxHeartSvg(size, 'rgba(255,122,144,.55)', { glow: false, stroke: 1.1 });
  plate.style.position = 'absolute';
  plate.style.inset = '0';
  wrap.appendChild(plate);

  // 两版油墨：从底部灌上来，香槟那版先偏出去再弹回套准
  [
    { color: '#ff5a78', dx: 0, dy: 0, delay: 60, dur: 340 },
    { color: '#f4d28a', dx: 3.5 * scale, dy: -2.5 * scale, delay: 60, dur: 380, from: [13 * scale, -9 * scale] }
  ].forEach(function (ink) {
    var face = document.createElement('div');
    face.style.position = 'absolute';
    face.style.inset = '0';
    face.style.clipPath = 'inset(100% 0 0 0)';
    face.appendChild(heartFxHeartSvg(size, ink.color, { glow: false }));
    wrap.appendChild(face);
    // face 不单独回收：它得留到 wrap 整体淡出，早删会「墨水半路消失」
    if (ink.from) {
      face.animate([
        { transform: 'translate(' + ink.from[0] + 'px,' + ink.from[1] + 'px)' },
        { transform: 'translate(' + ink.dx + 'px,' + ink.dy + 'px)' }
      ], { duration: 560, delay: ink.delay, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
    }
    face.animate([
      { clipPath: 'inset(100% 0 0 0)' },
      { clipPath: 'inset(0% 0 0 0)' }
    ], { duration: ink.dur, delay: ink.delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
  });

  layer.appendChild(wrap);
  heartFxRecycle(wrap.animate([{ opacity: 1 }, { opacity: 1, offset: .66 }, { opacity: 0 }],
    { duration: 920, easing: 'linear', fill: 'both' }), wrap);

  // 12 个半调点绕环飞出，两种墨交替
  for (var i = 0; i < 12; i++) {
    var ang = (i / 12) * Math.PI * 2 + heartFxRand(-.1, .1);
    var dist = heartFxRand(26, 46) * scale;
    var dotSize = Math.round(heartFxRand(4, 7) * scale);
    var node = heartFxDot(dotSize, i % 2 ? '#f4d28a' : '#ff5a78');
    node.setAttribute('class', 'heart-fx-dot');
    node.style.left = (c.x - dotSize / 2) + 'px';
    node.style.top = (c.y - dotSize / 2) + 'px';
    layer.appendChild(node);
    var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * .86;
    heartFxRecycle(node.animate([
      { transform: 'translate(0,0) scale(.2)', opacity: 0 },
      { transform: 'translate(' + (dx * .5).toFixed(1) + 'px,' + (dy * .5).toFixed(1) + 'px) scale(1)', opacity: .95, offset: .3 },
      { transform: 'translate(' + dx.toFixed(1) + 'px,' + (dy - 10 * scale).toFixed(1) + 'px) scale(.5)', opacity: 0 }
    ], { duration: heartFxRand(560, 780), delay: 90 + i * 6, easing: 'cubic-bezier(.14,.72,.24,1)', fill: 'backwards' }), node);
  }
}

/* ---------------- ring · 冲击波 + 上浮粒子 ---------------- */
function heartFxPlayRing(anchor, layer, scale) {
  var c = heartFxCenter(anchor, layer);
  heartFxRing(layer, c, 34 * scale, 'rgba(255,122,144,.9)', 0);
  heartFxRing(layer, c, 26 * scale, 'rgba(244,210,138,.72)', 70);

  for (var i = 0; i < 12; i++) {
    var ang = (i / 12) * Math.PI * 2 + heartFxRand(-.16, .16);
    var dist = heartFxRand(26, 52) * scale;
    var kind = i % 4 === 0 ? 'heart' : (i % 4 === 1 ? 'star' : 'dot');
    var base = kind === 'heart' ? heartFxRand(9, 12) : (kind === 'star' ? heartFxRand(8, 10) : heartFxRand(3, 5));
    var px = Math.round(base * scale);
    var color = HEART_FX_COLORS[i % HEART_FX_COLORS.length];
    var node;
    if (kind === 'heart') node = heartFxHeartSvg(px, color);
    else if (kind === 'star') node = heartFxStarSvg(px, color);
    else node = heartFxDot(px, color);
    node.setAttribute('class', 'heart-fx-dot');
    node.style.left = (c.x - px / 2) + 'px';
    node.style.top = (c.y - px / 2) + 'px';
    layer.appendChild(node);

    var dx = Math.cos(ang) * dist;
    var dy = Math.sin(ang) * dist * .82;
    var rise = 18 + heartFxRand(0, 14);
    var rot = heartFxRand(-140, 140);
    heartFxRecycle(node.animate([
      { transform: 'translate(0,0) scale(.35) rotate(0deg)', opacity: 0 },
      {
        transform: 'translate(' + (dx * .58).toFixed(1) + 'px,' + (dy * .58).toFixed(1) + 'px) scale(1) rotate(' + (rot * .5).toFixed(0) + 'deg)',
        opacity: 1,
        offset: .26
      },
      {
        transform: 'translate(' + dx.toFixed(1) + 'px,' + (dy - rise * .4).toFixed(1) + 'px) scale(.92) rotate(' + rot.toFixed(0) + 'deg)',
        opacity: .88,
        offset: .62
      },
      {
        // 末尾再往上飘一段：这一下是「浮出」的观感来源，纯径向炸开会像碎片
        transform: 'translate(' + (dx * 1.08).toFixed(1) + 'px,' + (dy - rise).toFixed(1) + 'px) scale(.2) rotate(' + (rot * 1.3).toFixed(0) + 'deg)',
        opacity: 0
      }
    ], {
      duration: heartFxRand(620, 880),
      delay: i % 3 === 0 ? heartFxRand(0, 40) : 0,
      easing: 'cubic-bezier(.14,.72,.24,1)',
      fill: 'backwards'
    }), node);
  }
}

/* ---------------- star · 极简星芒 ---------------- */
function heartFxPlayStar(anchor, layer, scale) {
  var c = heartFxCenter(anchor, layer);
  heartFxRing(layer, c, 30 * scale, 'rgba(255,122,144,.75)', 0, 1.5);
  for (var i = 0; i < 4; i++) {
    var ang = (i / 4) * Math.PI * 2 - Math.PI / 4;
    var px = Math.round(11 * scale);
    var node = heartFxStarSvg(px, i % 2 ? '#f4d28a' : '#ffd0da');
    node.setAttribute('class', 'heart-fx-dot');
    node.style.left = (c.x - px / 2) + 'px';
    node.style.top = (c.y - px / 2) + 'px';
    layer.appendChild(node);
    var dx = Math.cos(ang) * 24 * scale, dy = Math.sin(ang) * 24 * scale;
    heartFxRecycle(node.animate([
      { transform: 'translate(0,0) scale(.3) rotate(-45deg)', opacity: 0 },
      { transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(1) rotate(0deg)', opacity: 1, offset: .42 },
      { transform: 'translate(' + (dx * 1.3).toFixed(1) + 'px,' + (dy * 1.3).toFixed(1) + 'px) scale(.2) rotate(35deg)', opacity: 0 }
    ], { duration: 380, delay: i * 18, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }), node);
  }
}

var HEART_FX_BEAT = {
  folia: ['heart-beat-soft', 420],
  riso: ['heart-beat-bloom', 480],
  ring: ['heart-beat-pop', 760],
  star: ['heart-beat-quick', 360]
};

var HEART_FX_PLAYERS = {
  folia: heartFxPlayFolia,
  riso: heartFxPlayRiso,
  ring: heartFxPlayRing,
  star: heartFxPlayStar
};

/**
 * 点亮红心时播一套动效。
 * @param {Element} anchor 被点的那颗心（#heart-btn 或控制台里的预览心）
 * @param {{mode?: string, scale?: number, preview?: boolean}} [opts]
 *        mode 显式指定；scale 粒子幅度缩放（控制台预览格用 0.5）；preview 为真是预览，不写存档
 * @returns {boolean} 是否真的播了
 */
function heartFxPlay(anchor, opts) {
  if (!anchor || typeof anchor.getBoundingClientRect !== 'function' || !document.body) return false;
  var rect = anchor.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;   // 隐藏（沉浸模式）时不播

  opts = opts || {};
  var mode = heartFxResolveMode(opts.mode || heartFxConfiguredMode());
  if (mode === 'off') return false;

  var beat = HEART_FX_BEAT[mode];
  if (beat) heartFxBeat(anchor, beat[0], beat[1]);
  if (heartFxReduceMotion()) return true;

  var scale = typeof opts.scale === 'number' ? opts.scale : 1;
  var player = HEART_FX_PLAYERS[mode];
  if (!player) return false;
  player(anchor, heartFxLayer(), scale);
  return true;
}

/* 取消红心：只下沉一下，四套都不参与（庆祝动作不该奖励「取消」） */
function heartFxDip(anchor) {
  if (!anchor || !anchor.classList) return false;
  heartFxBeat(anchor, 'heart-beat-dip', 400);
  return true;
}

function heartFxFeedback(anchor, liked, opts) {
  if (!anchor) return false;
  return liked ? heartFxPlay(anchor, opts) : heartFxDip(anchor);
}

window.HeartFx = {
  MODES: HEART_FX_MODES,
  mode: heartFxConfiguredMode,
  resolve: heartFxResolveMode,
  play: heartFxPlay,
  dip: heartFxDip,
  feedback: heartFxFeedback
};
