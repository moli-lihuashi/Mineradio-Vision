// ====================================================================
//  收藏演出：整屏场景动画（雪窗 / 鸟群）
//  ------------------------------------------------------------------
//  红心粒子（06e）是「围着那颗心炸一圈」，这里换成「整个窗口发生一件事」：
//    snow   雪窗 —— 窗外落雪，一片六角晶体落到玻璃上，贴住、化开、消失
//    birds  鸟群 —— 170 只椋鸟乱飞 → 收拢成形 → 盘旋 → 惊散
//  选择存在 fx.heartScene（默认 snow），入口在顶栏「皮肤」弹层里的「收藏演出」。
//
//  三条硬约束：
//    1. 画布挂 document.body —— #bottom-bar.visible 带 backdrop-filter，
//       会成为 position:fixed 后代的包含块，挂进去会被裁进圆角矩形。
//    2. z-index 压在心形粒子层（14）以下：粒子是主反馈，不能被整屏演出的暗场吞掉。
//    3. 一场演完必须自己清干净：取消 rAF、清画布、摘 .on 类，不留常驻图层。
// ====================================================================

var HEART_SCENE_MODES = ['snow', 'birds', 'off'];
var HEART_SCENE_META = {
  snow: { name: '雪窗', sub: '落雪 · 融化' },
  birds: { name: '鸟群', sub: '聚拢 · 惊散' },
  off: { name: '关闭', sub: '只变色' }
};
var heartSceneState = null;

function heartSceneReduceMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}

/* 白名单写在函数体内，别引用文件级 var —— 这个模块排在主波末尾，
 * 但读到它的地方（03c 归一化 / 面板渲染）可能更早。 */
function heartSceneNormalize(value, fallback) {
  var allowed = ['snow', 'birds', 'off'];
  var v = String(value == null ? '' : value);
  if (allowed.indexOf(v) >= 0) return v;
  var f = String(fallback == null ? '' : fallback);
  return allowed.indexOf(f) >= 0 ? f : 'snow';
}

function heartSceneConfiguredMode() {
  try {
    if (typeof fx !== 'undefined' && fx && HEART_SCENE_MODES.indexOf(String(fx.heartScene)) >= 0) {
      return String(fx.heartScene);
    }
  } catch (_) {}
  return 'snow';
}

function heartSceneRand(min, max) {
  return min + Math.random() * (max - min);
}

function heartSceneClamp(v, a, b) {
  return v < a ? a : (v > b ? b : v);
}

function heartSceneSmooth(a, b, t) {
  var x = heartSceneClamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

function heartSceneCanvas() {
  var c = document.getElementById('heart-scene-canvas');
  if (c) return c;
  c = document.createElement('canvas');
  c.id = 'heart-scene-canvas';
  c.className = 'heart-scene-canvas';
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  return c;
}

/* 离屏层：鸟群的运动残影要留在一个独立画布上，主画布保持透明，
 * 底下的封面、歌词、进度条才不会被一层黑盖住。 */
function heartSceneMakeLayer(dpr, W, H) {
  var c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(W * dpr));
  c.height = Math.max(2, Math.round(H * dpr));
  var g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c: c, g: g };
}

function heartSceneFadeLayer(g, amount, W, H) {
  if (amount <= 0) return;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,' + amount.toFixed(4) + ')';
  g.fillRect(0, 0, W, H);
  g.restore();
}

function heartSceneSoftSprite() {
  var c = document.createElement('canvas');
  c.width = c.height = 32;
  var g = c.getContext('2d');
  var gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.42, 'rgba(222,238,255,0.52)');
  gr.addColorStop(1, 'rgba(222,238,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return c;
}

/* ====================================================================
   一 · 雪窗：落雪 → 贴上 → 融化 → 消失
   ==================================================================== */
function heartSceneBuildSnow(ctx, W, H) {
  var U = Math.min(W, H);
  var landX = W * 0.56, landY = H * 0.40;
  var heroR = Math.max(13, U * 0.062);
  var LAND = 1.45, MELT = 1.62, VANISH = 2.18, END = 3.1;
  var flakes = [], ring = -1;
  var drop = { x: landX, y: landY, r: 0, a: 0 };
  var sprite = heartSceneSoftSprite();
  var i;

  for (i = 0; i < 110; i++) {
    flakes.push({
      x: Math.random() * W, y: Math.random() * (H + 40) - 20,
      z: Math.random(), ph: Math.random() * 100
    });
  }

  function step(dt, t) {
    for (var k = 0; k < flakes.length; k++) {
      var f = flakes[k];
      f.y += (26 + f.z * 96) * dt;
      f.x += Math.sin(t * 0.9 + f.ph) * (10 + f.z * 20) * dt;
      if (f.y > H + 16) { f.y = -16; f.x = Math.random() * W; }
    }
    if (t >= LAND && ring < 0) ring = 0;
    if (ring >= 0) ring += dt * 2.6;

    if (t >= MELT && t < VANISH) {
      var m = (t - MELT) / (VANISH - MELT);
      /* 水珠不能等到最后才「蹦」出来：一开融就要有一小颗托在晶体中心，
         否则真机上只看到「雪花闪一下没了、然后一颗亮点」。
         smoothstep 让它在整段时间里匀速长到 12.5px，alpha 前 0.09s 内起来。 */
      var mm = m * m * (3 - 2 * m);
      drop.r = 12.5 * (0.34 + 0.66 * mm);
      drop.a = Math.min(1, m * 6);
    } else if (t >= VANISH) {
      /* 用户要的是「融化消失」：不往下流，就在原地缩没 */
      var v = heartSceneSmooth(VANISH, END - 0.15, t);
      drop.r = 12.5 * (1 - v * 0.94);
      drop.a = 1 - v;
    }
    return t < END;
  }

  function crystal(x, y, r, rot, al, armK) {
    if (r <= 0.4 || al <= 0.01) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(228,243,255,' + al.toFixed(3) + ')';
    for (var s = 0; s < 6; s++) {
      ctx.save();
      ctx.rotate(s * Math.PI / 3);
      ctx.lineWidth = Math.max(0.9, r * 0.082);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r);
      ctx.stroke();
      for (var b = 1; b <= 3; b++) {
        var yy = -r * (0.30 + b * 0.21);
        var len = r * 0.30 * (1 - b * 0.19) * armK;
        ctx.lineWidth = Math.max(0.6, r * 0.048);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(len, yy - len * 0.92);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(-len, yy - len * 0.92);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(244,251,255,' + (al * 0.95).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.2, r * 0.10), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(t) {
    var fade = 1 - heartSceneSmooth(END - 0.7, END, t);
    var top = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    top.addColorStop(0, 'rgba(96,146,190,' + (0.15 * fade).toFixed(3) + ')');
    top.addColorStop(1, 'rgba(96,146,190,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.75);

    for (var k = 0; k < flakes.length; k++) {
      var f = flakes[k];
      var rr = 0.9 + f.z * 3.2;
      ctx.globalAlpha = (0.22 + f.z * 0.55) * fade;
      ctx.drawImage(sprite, f.x - rr, f.y - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;

    if (ring >= 0 && ring < 1) {
      ctx.strokeStyle = 'rgba(214,236,255,' + ((1 - ring) * 0.42 * fade).toFixed(3) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(landX, landY, 9 + ring * 30, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (t < MELT) {
      var u = Math.min(1, t / LAND);
      var e = u * u;
      var hx = t < LAND ? (landX - 78 + 78 * e + Math.sin(t * 1.7) * 9) : landX;
      var hy = t < LAND ? (-60 + (landY + 60) * e) : landY;
      var hr = heroR * (t < LAND ? (0.55 + 0.45 * e) : 1);
      var squash = 0;
      if (t >= LAND) squash = Math.sin(Math.min(1, (t - LAND) / 0.3) * Math.PI) * 0.12;
      ctx.save();
      ctx.shadowColor = 'rgba(176,216,255,0.85)';
      ctx.shadowBlur = 16 * fade;
      crystal(hx, hy, hr * (1 - squash * 0.5), t * 0.55, 0.92 * fade, 1 - squash);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      var melt = heartSceneSmooth(MELT, VANISH, t);
      if (melt < 1) {
        ctx.save();
        /* 晶体别跟着半径一起秒没：alpha 衰减比半径慢一档（^0.6），
           前半段还能看见「六角骨架在化」，不是凭空消失 */
        ctx.globalAlpha = Math.pow(1 - melt, 0.6) * fade;
        crystal(landX, landY, heroR * (1 - melt), t * 0.55, 0.9, 1 - melt);
        ctx.restore();
      }
      if (drop.r > 0.4 && drop.a > 0.01) {
        var dx = drop.x, dy = drop.y, dr = drop.r;
        ctx.save();
        ctx.globalAlpha = heartSceneClamp(drop.a, 0, 1) * fade;
        var gr = ctx.createRadialGradient(dx - dr * 0.35, dy - dr * 0.42, dr * 0.12, dx, dy, dr * 1.18);
        gr.addColorStop(0, 'rgba(255,255,255,0.95)');
        gr.addColorStop(0.45, 'rgba(200,228,250,0.55)');
        gr.addColorStop(1, 'rgba(150,190,222,0.10)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath();
        ctx.ellipse(dx - dr * 0.34, dy - dr * 0.38, dr * 0.24, dr * 0.15, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      /* 玻璃上最后那点湿印，跟着水珠一起淡掉 */
      var wet = 1 - heartSceneSmooth(VANISH, END, t);
      if (wet > 0.01) {
        ctx.save();
        ctx.globalAlpha = wet * 0.5 * fade;
        var wg = ctx.createRadialGradient(landX, landY, 0, landX, landY, 16);
        wg.addColorStop(0, 'rgba(176,214,244,0.55)');
        wg.addColorStop(1, 'rgba(176,214,244,0)');
        ctx.fillStyle = wg;
        ctx.fillRect(landX - 18, landY - 18, 36, 36);
        ctx.restore();
      }
    }
  }

  return {
    step: step,
    draw: draw,
    veil: function (t) { return 0.16 * heartSceneSmooth(0, 0.4, t) * (1 - heartSceneSmooth(END - 0.8, END, t)); }
  };
}

/* ====================================================================
   二 · 鸟群：boids 乱飞 → 收成心 → 盘旋 → 惊散
   ==================================================================== */
function heartSceneBuildBirds(ctx, W, H, dpr) {
  var U = Math.min(W, H);
  var S = Math.min(U * 0.32, W * 0.42);
  var cx = W * 0.5, cy = H * 0.46;
  var N = 150;
  var FORM = 0.42, HOLD = 1.28, FLEE = 1.88, END = 2.95;
  var list = [], layer = heartSceneMakeLayer(dpr, W, H);
  var canBlur = (W * H) < 2600000;
  var i;

  for (i = 0; i < N; i++) {
    var side = i % 4, m = 40 + Math.random() * 110, sx, sy;
    if (side === 0) { sx = -m; sy = heartSceneRand(-m, H + m); }
    else if (side === 1) { sx = W + m; sy = heartSceneRand(-m, H + m); }
    else if (side === 2) { sx = heartSceneRand(-m, W + m); sy = -m; }
    else { sx = heartSceneRand(-m, W + m); sy = H + m; }
    var inward = Math.atan2(cy - sy, cx - sx) + heartSceneRand(-0.7, 0.7);
    var a, rr, slot;
    if (i < Math.round(N * 0.78)) {
      /* 三层密排的同心轮廓：要把整颗心填满得几百只，画成加粗的边反而一眼认得出 */
      var RINGS = [1.0, 0.958, 0.916];
      var ri = i % 3, idx = Math.floor(i / 3), perRing = Math.ceil(N * 0.78 / 3);
      a = (idx / perRing) * Math.PI * 2 + ri * (Math.PI * 2 / perRing / 3);
      rr = RINGS[ri] + heartSceneRand(-0.008, 0.008);
    } else {
      var k2 = i - Math.round(N * 0.78);
      a = k2 * 2.399963;
      rr = 0.30 + ((k2 * 0.618) % 1) * 0.42;
    }
    slot = heartPointOn(a, rr, S, cx, cy);
    list.push({
      x: sx, y: sy,
      vx: Math.cos(inward) * heartSceneRand(110, 210),
      vy: Math.sin(inward) * heartSceneRand(110, 210),
      tx: slot.x + heartSceneRand(-1.8, 1.8),
      ty: slot.y + heartSceneRand(-1.8, 1.8),
      seed: Math.random() * 100, alpha: 0, out: false, ang: 0
    });
  }

  function step(dt, t) {
    var phase = t < FORM ? 0 : (t < HOLD ? 1 : (t < FLEE ? 2 : 3));
    var maxSp = 430, maxF = 2600;
    var seekK = phase === 0 ? 2.6 : (phase === 1 ? 6.5 : (phase === 2 ? 7.5 : 0));
    var sepR = phase === 3 ? 26 : 15;
    var sepR2 = sepR * sepR;
    var sepW = phase === 3 ? 700 : (phase === 2 ? 300 : 430);

    for (var k = 0; k < N; k++) {
      var b = list[k];
      var sx = 0, sy = 0, sc = 0, ax = 0, ay = 0, ac = 0, mx = 0, my = 0, mc = 0;
      for (var j = 0; j < N; j++) {
        if (j === k) continue;
        var o = list[j];
        var dx = b.x - o.x, dy = b.y - o.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > 6400 || d2 < 0.001) continue;
        if (d2 < sepR2) { var d = Math.sqrt(d2); sx += dx / d; sy += dy / d; sc++; }
        ax += o.vx; ay += o.vy; ac++;
        mx += o.x; my += o.y; mc++;
      }

      var dx2 = b.tx - b.x, dy2 = b.ty - b.y;
      var dd = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      var want = Math.min(maxSp, dd * 5.0);
      var swirl = phase === 2 ? 18 : (phase === 1 ? 10 : 0);
      var dvx = (dx2 / dd) * want - (dy2 / dd) * swirl;
      var dvy = (dy2 / dd) * want + (dx2 / dd) * swirl;
      var fx2 = dvx * seekK, fy2 = dvy * seekK;

      /* 成心那两秒加一道位置弹簧：只靠趋近速度的话，分离力会把整群推成一团毛球 */
      if (phase === 2) { fx2 += dx2 * 65; fy2 += dy2 * 65; }
      if (sc) {
        var sm = Math.sqrt(sx * sx + sy * sy) || 1;
        fx2 += (sx / sm) * sepW;
        fy2 += (sy / sm) * sepW;
      }
      if (ac) { fx2 += ((ax / ac) - b.vx) * 0.55; fy2 += ((ay / ac) - b.vy) * 0.55; }
      if (mc) { fx2 += ((mx / mc) - b.x) * 0.12; fy2 += ((my / mc) - b.y) * 0.12; }
      fx2 += Math.cos(t * 2.4 + b.seed) * 45;
      fy2 += Math.sin(t * 2.0 + b.seed * 1.4) * 45;

      if (phase === 3) {
        if (!b.out) {
          b.out = true;
          var ox = b.x - cx, oy = b.y - cy, od = Math.sqrt(ox * ox + oy * oy) || 1;
          b.vx += (ox / od) * heartSceneRand(150, 380);
          b.vy += (oy / od) * heartSceneRand(150, 380);
        }
        fx2 += Math.cos(b.seed + t * 3) * 420;
        fy2 += Math.sin(b.seed * 1.7 + t * 2.6) * 420;
      }

      var fm = Math.sqrt(fx2 * fx2 + fy2 * fy2);
      if (fm > maxF) { fx2 *= maxF / fm; fy2 *= maxF / fm; }
      b.vx += fx2 * dt;
      b.vy += fy2 * dt;
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > maxSp) { b.vx *= maxSp / sp; b.vy *= maxSp / sp; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      var target = Math.atan2(b.vy, b.vx);
      var diff = ((target - b.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      b.ang += diff * Math.min(1, dt * 7);

      b.alpha = Math.min(1, b.alpha + dt * 2.4);
      if (t > END - 1.0) b.alpha = Math.max(0, b.alpha - dt * 1.15);
    }
    return t < END;
  }

  function draw(t) {
    heartSceneFadeLayer(layer.g, 1 - Math.pow(0.12, 1 / 60), W, H);
    var g = layer.g;
    g.save();
    for (var k = 0; k < N; k++) {
      var b = list[k];
      if (b.alpha <= 0.02) continue;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.ang);
      var fl = 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * 9 + b.seed);
      g.strokeStyle = 'rgba(255,226,236,' + (0.20 * b.alpha).toFixed(3) + ')';
      g.lineWidth = 3.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-6.0, 0);
      g.quadraticCurveTo(-2.4, -3.3 * fl, 0, -0.2);
      g.quadraticCurveTo(2.4, -3.3 * fl, 6.0, 0);
      g.stroke();
      g.strokeStyle = 'rgba(255,232,240,' + (0.90 * b.alpha).toFixed(3) + ')';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-6.0, 0);
      g.quadraticCurveTo(-2.4, -3.3 * fl, 0, -0.2);
      g.quadraticCurveTo(2.4, -3.3 * fl, 6.0, 0);
      g.stroke();
      g.restore();
    }
    g.restore();

    /* 先糊一层再叠实的：整群从「一片小勾」变成发光的云 */
    if (canBlur) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      if ('filter' in ctx) ctx.filter = 'blur(9px)';
      ctx.drawImage(layer.c, 0, 0, W, H);
      ctx.restore();
    }
    ctx.drawImage(layer.c, 0, 0, W, H);
  }

  return {
    step: step,
    draw: draw,
    veil: function (t) {
      return 0.26 * heartSceneSmooth(0, 0.45, t) * (1 - heartSceneSmooth(END - 0.65, END, t));
    }
  };
}

/* 参数心形（归一到 [-1,1] 附近）：a=PI 是底部尖，a=0 附近是顶部凹口 */
function heartPointOn(a, r, S, cx, cy) {
  var s = Math.sin(a), c = Math.cos(a);
  var x = 16 * s * s * s;
  var y = 13 * c - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
  return { x: cx + (x / 17) * S * r, y: cy + (-y / 17) * S * r };
}

/* ====================================================================
   运行器
   ==================================================================== */
function heartSceneStop() {
  var state = heartSceneState;
  heartSceneState = null;
  if (!state) return false;
  if (state.raf) {
    try { cancelAnimationFrame(state.raf); } catch (_) {}
  }
  try {
    state.ctx.clearRect(0, 0, state.W, state.H);
  } catch (_) {}
  if (state.canvas && state.canvas.classList) state.canvas.classList.remove('on');
  return true;
}

function heartScenePlaying() {
  return !!heartSceneState;
}

function heartSceneTick(now) {
  var state = heartSceneState;
  if (!state) return;
  var dt = Math.min(0.05, Math.max(0, (now - state.last) / 1000));
  state.last = now;
  state.t += dt;
  var alive = true;
  try {
    alive = state.scene.step(dt, state.t);
    var ctx = state.ctx;
    ctx.clearRect(0, 0, state.W, state.H);
    var veil = state.scene.veil ? state.scene.veil(state.t) : 0;
    if (veil > 0.004) {
      ctx.fillStyle = 'rgba(6,7,10,' + veil.toFixed(3) + ')';
      ctx.fillRect(0, 0, state.W, state.H);
    }
    state.scene.draw(state.t);
  } catch (err) {
    console.warn('[heartScene] frame failed:', err);
    heartSceneStop();
    return;
  }
  if (!alive) { heartSceneStop(); return; }
  state.raf = requestAnimationFrame(heartSceneTick);
}

/**
 * 播一场整屏演出。
 * @param {string} [mode] 显式指定；不传就读 fx.heartScene
 * @returns {boolean} 是否真的开演
 */
function heartScenePlay(mode) {
  var target = heartSceneNormalize(mode == null ? heartSceneConfiguredMode() : mode, heartSceneConfiguredMode());
  if (target === 'off') return false;
  if (heartSceneReduceMotion()) return false;
  if (!document.body) return false;

  heartSceneStop();
  var canvas = heartSceneCanvas();
  var dpr = Math.min(1.5, window.devicePixelRatio || 1);
  var W = Math.max(2, window.innerWidth);
  var H = Math.max(2, window.innerHeight);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  var ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var scene = target === 'birds'
    ? heartSceneBuildBirds(ctx, W, H, dpr)
    : heartSceneBuildSnow(ctx, W, H);
  if (!scene) return false;

  heartSceneState = {
    canvas: canvas, ctx: ctx, scene: scene,
    W: W, H: H, t: 0, last: performance.now(), raf: 0
  };
  if (canvas.classList) canvas.classList.add('on');
  heartSceneState.raf = requestAnimationFrame(heartSceneTick);
  return true;
}

/* ====================================================================
   皮肤弹层里的「收藏演出」三格
   ==================================================================== */
function heartSceneTileIcon(mode) {
  if (mode === 'snow') {
    return '<path d="M12 2.5v19M4.2 7l15.6 10M19.8 7L4.2 17"/><path d="M12 6.2 10 4.4M12 6.2l2-1.8M12 17.8l-2 1.8M12 17.8l2 1.8"/>';
  }
  if (mode === 'birds') {
    return '<path d="M3 13c2.2-3.4 4.6-3.4 6.8 0 2.2-3.4 4.6-3.4 6.8 0"/><path d="M6.5 7.6c1.6-2.4 3.4-2.4 5 0 1.6-2.4 3.4-2.4 5 0"/>';
  }
  return '<circle cx="12" cy="12" r="7.4"/><path d="M7.2 16.8 16.8 7.2"/>';
}

function heartSceneGrid() {
  return document.getElementById('skin-scene-fx-grid');
}

function paintHeartSceneSelection(mode) {
  var grid = heartSceneGrid();
  if (!grid) return;
  Array.prototype.forEach.call(grid.querySelectorAll('.scene-fx-tile'), function (tile) {
    var on = tile.getAttribute('data-heart-scene') === mode;
    tile.classList.toggle('active', on);
    tile.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderHeartSceneGrid() {
  var grid = heartSceneGrid();
  if (!grid) return false;
  if (grid.childElementCount) {
    paintHeartSceneSelection(heartSceneConfiguredMode());
    return false;
  }
  grid.innerHTML = HEART_SCENE_MODES.map(function (m) {
    var meta = HEART_SCENE_META[m] || { name: m, sub: '' };
    return '<button type="button" class="scene-fx-tile" data-heart-scene="' + m + '" aria-pressed="false">' +
      '<span class="sfx-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      heartSceneTileIcon(m) + '</svg></span>' +
      '<b>' + meta.name + '</b><small>' + meta.sub + '</small></button>';
  }).join('');
  paintHeartSceneSelection(heartSceneConfiguredMode());
  return true;
}

function pickHeartScene(mode, tile) {
  if (HEART_SCENE_MODES.indexOf(mode) < 0) return false;
  try {
    if (typeof fx !== 'undefined' && fx) {
      fx.heartScene = mode;
      if (typeof saveLyricLayout === 'function') saveLyricLayout();
    }
  } catch (err) {
    console.warn('[heartScene] save failed:', err);
  }
  paintHeartSceneSelection(mode);
  if (mode !== 'off') heartScenePlay(mode);
  return true;
}

function syncHeartSceneGrid() {
  var grid = heartSceneGrid();
  if (!grid) return false;
  if (!grid.childElementCount) renderHeartSceneGrid();
  else paintHeartSceneSelection(heartSceneConfiguredMode());
  return true;
}

function bindHeartSceneGrid() {
  var grid = heartSceneGrid();
  if (!grid || grid.getAttribute('data-bound') === '1') return false;
  grid.setAttribute('data-bound', '1');
  grid.addEventListener('click', function (e) {
    var tile = e.target && e.target.closest ? e.target.closest('.scene-fx-tile') : null;
    if (!tile) return;
    pickHeartScene(tile.getAttribute('data-heart-scene'), tile);
  });
  renderHeartSceneGrid();
  return true;
}

(function bootHeartScene() {
  if (!document || !document.body) return;
  var start = function () {
    bindHeartSceneGrid();
    /* 演唱会在跑的时候被关掉 / 切歌，别让暗场一直盖着 */
    window.addEventListener('blur', function () { heartSceneStop(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

window.HeartScene = {
  MODES: HEART_SCENE_MODES,
  mode: heartSceneConfiguredMode,
  normalize: heartSceneNormalize,
  play: heartScenePlay,
  stop: heartSceneStop,
  playing: heartScenePlaying,
  sync: syncHeartSceneGrid
};
