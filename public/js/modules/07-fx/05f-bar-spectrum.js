// ====================================================================
//  控制条底层频谱（Mineradio / LiquidGlass 专用）
//  ------------------------------------------------------------------
//  层级：#bottom-bar 内部的 .lg-glass-shell（WebGL 玻璃）之后、
//        #progress-bar / #controls 之前，挂一层独立 2D canvas。
//        它不抢 backdrop-filter、不改 background、不碰 gainNode，
//        只是在液态玻璃之上、控件之下画一条贴底频谱。
//
//  门控：只要 #bottom-bar 有 visible 就绘制 —— CSS 玻璃（backdrop-filter）
//        与 LiquidGlass（lg-active，WebGL shell）两种分支都要生效；
//        控制条隐藏 / 空房间态时停绘并收起画布。
//
//  数据：只读主循环 11-main-loop.js 已经按 ~30fps 刷新的 frequencyData
//        （Uint8Array，来自 analyser.getByteFrequencyData）。这里只做
//        频段的对数取样 + attack/release 平滑，不新建 AnalyserNode、
//        不改音频链、不覆盖淡变曲线。
//
//  选择：顶栏「皮肤」弹层里的四格，存 fx.barSpectrum，
//        与 heartFx / heartScene 共用 mineradio-lyric-layout-v1 存档。
// ====================================================================

var BAR_SPECTRUM_TILES = [
  { id: 'ripple', name: '迷幻水波', sub: '点阵水波',
    icon: '<path d="M2 13c3-4 5-4 8 0s5 4 8 0 3-3 4-3"/><path d="M4 17h.01M8 17h.01M12 17h.01M16 17h.01M20 17h.01"/>' },
  { id: 'pulse', name: '动感律动', sub: '贴底柱状',
    icon: '<path d="M4 19v-5M8 19V9M12 19V5M16 19v-7M20 19v-4"/>' },
  { id: 'ribbon', name: '流光丝带', sub: '双曲线带',
    icon: '<path d="M2 14c4-6 6 3 10-2s6 3 10-3"/><path d="M2 18c4-6 6 3 10-2s6 3 10-3"/>' },
  { id: 'off', name: '关闭', sub: '不显示',
    icon: '<circle cx="12" cy="12" r="7.4"/><path d="M7.2 16.8 16.8 7.2"/>' }
];

/* 配色沿用已确认的预览效果（青绿 -> 蓝），与紫白玻璃对比清楚又不刺眼 */
var BAR_SPECTRUM_COLORS = { a: '#8ff7e4', b: '#37a9cf' };

var barSpectrumBins = new Float64Array(64);
var barSpectrumTestData = null;
var barSpectrumFloatData = null;
var barSpectrumShown = false;
var barSpectrumIdleFrames = 0;
var barSpectrumLastRead = 0;

/* 白名单写在函数体内：本文件在延迟波，被单测用 vm 切片真跑时不能依赖文件级常量 */
function barSpectrumNormalize(value, fallback) {
  var allowed = ['ripple', 'pulse', 'ribbon', 'off'];
  var v = String(value == null ? '' : value);
  if (allowed.indexOf(v) >= 0) return v;
  var f = String(fallback == null ? '' : fallback);
  return allowed.indexOf(f) >= 0 ? f : 'ripple';
}

function barSpectrumMode() {
  var v = (typeof fx !== 'undefined' && fx) ? fx.barSpectrum : null;
  var f = (typeof fxDefaults !== 'undefined' && fxDefaults) ? fxDefaults.barSpectrum : null;
  return barSpectrumNormalize(v, f);
}

function barSpectrumActive() {
  var bar = document.getElementById('bottom-bar');
  if (!bar) return false;
  /* 只要控制条可见就画：CSS 玻璃（backdrop-filter）与 LiquidGlass 都要生效。
     频谱是控制条内的独立子层，两种玻璃下都排在玻璃之上、控件之下。 */
  return bar.classList.contains('visible');
}

function barSpectrumCanvas() {
  var el = document.getElementById('bar-spectrum-canvas');
  if (el) return el;
  var bar = document.getElementById('bottom-bar');
  if (!bar) return null;
  el = document.createElement('canvas');
  el.id = 'bar-spectrum-canvas';
  el.className = 'bar-spectrum-canvas';
  el.setAttribute('aria-hidden', 'true');
  /* 排在玻璃 shell 之后；shell 若稍后才由 LiquidGlass 插到 firstChild，
     也会自动落在本画布之前，层级结论不变。 */
  var shell = bar.querySelector(':scope > .lg-glass-shell');
  if (shell && shell.nextSibling) bar.insertBefore(el, shell.nextSibling);
  else bar.insertBefore(el, bar.firstChild);
  return el;
}

function barSpectrumClear() {
  var cv = barSpectrumCanvas();
  if (cv) {
    var cx = cv.getContext('2d');
    if (cx) cx.clearRect(0, 0, cv.width, cv.height);
  }
  document.body.classList.remove('bar-spectrum-on');
  barSpectrumShown = false;
}

/* 取频段能量：按「对数频率」分组 + dB 域映射。
 *
 * 依据（Web Audio 可视化通用做法）：
 *   1) 频率轴要按对数分组（40Hz~16kHz 等比），否则低频挤在左边几根柱、高频占掉大半宽度；
 *   2) 高度要用 dB 映射，不能用线性幅度 —— 人耳是对数的，线性映射会让所有柱子挤在高位；
 *   3) analyser 默认 minDecibels=-100 / maxDecibels=-30，getByteFrequencyData 会在 -30dB
 *      就饱和成 255，音乐的中高频几乎全被压平 —— 这正是「一直同一个高度」的根因之一。
 *      所以这里优先用 getFloatFrequencyData 拿真实 dB（只读同一个 analyser，不改它的配置，
 *      也就不会影响 Sonic Topography / 黑洞纹理等同样读 frequencyData 的模块）；
 *   4) 时间平滑交给 AnalyserNode 自己的 smoothingTimeConstant（项目设 0.58），外层只做轻量
 *      attack/release，避免双重平滑把瞬态吃掉。
 */
function barSpectrumReadData() {
  var n = barSpectrumBins.length;
  var src8 = barSpectrumTestData;
  var an = (!src8 && typeof analyser !== 'undefined' && analyser) ? analyser : null;
  var useFloat = !!(an && typeof an.getFloatFrequencyData === 'function');
  var binCount = 0;
  var nyquist = 16000;

  if (useFloat) {
    binCount = an.frequencyBinCount || 0;
    if (!binCount) {
      useFloat = false;
    } else {
      if (barSpectrumFloatData && barSpectrumFloatData.length !== binCount) barSpectrumFloatData = null;
      if (!barSpectrumFloatData) barSpectrumFloatData = new Float32Array(binCount);
      try {
        an.getFloatFrequencyData(barSpectrumFloatData);
        if (an.context && an.context.sampleRate) nyquist = an.context.sampleRate / 2;
      } catch (_) {
        useFloat = false;
        barSpectrumFloatData = null;
      }
    }
  }
  if (!useFloat) {
    if (!src8 && typeof frequencyData !== 'undefined' && frequencyData && frequencyData.length) src8 = frequencyData;
    binCount = src8 ? src8.length : 0;
    /* 兜底（没有 analyser，或测试注入）：把 0~16kHz 铺满整条 */
    nyquist = 16000;
  }

  var fMin = 40, fMax = 16000;
  var fRatio = fMax / fMin;
  for (var i = 0; i < n; i++) {
    var v = 0;
    if (binCount > 1) {
      /* 第 i 根柱覆盖 [f0, f1) 这段等比频带 */
      var f0 = fMin * Math.pow(fRatio, i / n);
      var f1 = fMin * Math.pow(fRatio, (i + 1) / n);
      var b0 = Math.floor(f0 / nyquist * binCount);
      var b1 = Math.ceil(f1 / nyquist * binCount) - 1;
      if (b0 < 0) b0 = 0;
      if (b1 < b0) b1 = b0;
      if (b1 > binCount - 1) b1 = binCount - 1;
      var sum = 0, cnt = 0;
      if (useFloat) {
        for (var jf = b0; jf <= b1; jf++) {
          var db = barSpectrumFloatData[jf];
          if (!isFinite(db)) db = -100;
          if (db < -100) db = -100;
          sum += db; cnt++;
        }
        /* -80dB ~ -20dB 映射到 0..1：低于 -80 视为静音，-20 以上到顶 */
        v = (sum / cnt + 80) / 60;
      } else {
        for (var jb = b0; jb <= b1; jb++) {
          sum += Number(src8[jb]) || 0; cnt++;
        }
        v = (sum / cnt) / 255;
      }
      if (v < 0) v = 0;
      if (v > 1) v = 1;
    }
    var cur = barSpectrumBins[i];
    /* attack 快、release 稍慢；AnalyserNode 已做 0.58 平滑，这里不能再重 */
    barSpectrumBins[i] = cur + (v - cur) * (v > cur ? 0.50 : 0.28);
  }
}

function barSpectrumBinAt(xn) {
  var n = barSpectrumBins.length;
  var i = Math.min(n - 1, Math.max(0, Math.floor(xn * n)));
  return barSpectrumBins[i] || 0;
}

/* 暂停 / 播完时主循环不再刷新 frequencyData；如果不主动收，频谱会停在最后一帧装成还在播。 */
function barSpectrumPlaying() {
  try {
    if (typeof audio !== 'undefined' && audio) return !audio.paused && !audio.ended;
  } catch (_) {}
  return true;
}

function barSpectrumIdleDecay() {
  var n = barSpectrumBins.length;
  for (var i = 0; i < n; i++) barSpectrumBins[i] *= 0.82;
}

/* ---- 迷幻水波：贴底的点阵水波带 ---- */
function barSpectrumDrawRipple(ctx, w, cy, maxA, c, t) {
  ctx.fillStyle = c.a;
  var cols = Math.max(1, Math.floor(w / 4.2));
  for (var j = 0; j < cols; j++) {
    var xn = j / cols, x = j * 4.2 + 2;
    var fade = Math.pow(Math.sin(Math.PI * xn), 0.65);
    var energy = 0.30 + 0.70 * Math.min(1, barSpectrumBinAt(xn) * 1.8);
    var wave = Math.sin(xn * 18 - t * 2.6) * 9 + Math.sin(xn * 34 + t * 1.4) * 4;
    for (var k = -3; k <= 3; k++) {
      var yy = cy + wave * 0.38 + (k / 3) * (4 + 9 * energy);
      var a = fade * (0.78 - Math.abs(k) * 0.10);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x, yy, k === 0 ? 1.1 : 0.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 0.20; ctx.strokeStyle = c.b; ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  ctx.setLineDash([]);
}

/* ---- 动感律动：柱子从控制条底沿向上长 ----
   列密度必须与已确认的预览一致：每 4.2px 一根 2.2px 细柱，
   把 64 个频段线性插值到这些列；只画 64 根粗柱会变成完全不同的效果。
   透明度整条统一（0.86），不按播放进度分深浅 —— 之前左亮右暗看着像两种颜色。 */
function barSpectrumDrawPulse(ctx, w, cy, maxA, c) {
  var cols = Math.max(64, Math.floor(w / 4.2));
  var n = barSpectrumBins.length;
  var g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, c.b); g.addColorStop(0.5, c.a); g.addColorStop(1, c.b);
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.86;
  for (var j = 0; j < cols; j++) {
    var xn = j / cols;
    var pos = xn * (n - 1);
    var i0 = Math.floor(pos), i1 = Math.min(n - 1, i0 + 1), f = pos - i0;
    var v = Math.min(1, (barSpectrumBins[i0] * (1 - f) + barSpectrumBins[i1] * f) * 1.6);
    var hh = 2 + v * maxA;
    ctx.fillRect(j * 4.2 + 1, cy - hh, 2.2, hh);
  }
  ctx.globalAlpha = 0.62; ctx.fillStyle = c.a;
  ctx.fillRect(0, cy - 1, w, 1);
}

/* ---- 流光丝带：贴底的双平滑曲线 + 渐变带 + 漂浮光点 ---- */
function barSpectrumDrawRibbon(ctx, w, cy, maxA, c, t) {
  function wave(x) {
    var xn = x / w;
    var env = Math.sin(Math.PI * Math.max(0, Math.min(1, xn)));
    var amt = 0.35 + 0.65 * Math.min(1, barSpectrumBinAt(xn) * 1.5);
    return (Math.sin(xn * 11 - t * 1.9) * 0.46 + Math.sin(xn * 23 + t * 1.25) * 0.22 +
            Math.sin(xn * 5 - t * 0.7) * 0.30) * maxA * 0.52 * amt * env;
  }
  var g = ctx.createLinearGradient(0, cy - maxA, 0, cy + maxA);
  g.addColorStop(0, c.a); g.addColorStop(0.5, c.b); g.addColorStop(1, c.a);
  ctx.beginPath(); ctx.moveTo(0, cy - wave(0));
  for (var x = 0; x <= w; x += 4) ctx.lineTo(x, cy - wave(x));
  for (var x2 = w; x2 >= 0; x2 -= 4) ctx.lineTo(x2, cy + wave(x2) * 0.7);
  ctx.closePath(); ctx.globalAlpha = 0.28; ctx.fillStyle = g; ctx.fill();
  ctx.globalAlpha = 0.80; ctx.strokeStyle = c.a; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (var x3 = 0; x3 <= w; x3 += 4) { var y3 = cy - wave(x3); x3 ? ctx.lineTo(x3, y3) : ctx.moveTo(x3, y3); }
  ctx.stroke();
  ctx.globalAlpha = 0.38;
  ctx.beginPath();
  for (var x4 = 0; x4 <= w; x4 += 4) { var y4 = cy + wave(x4) * 0.7; x4 ? ctx.lineTo(x4, y4) : ctx.moveTo(x4, y4); }
  ctx.stroke();
  ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff';
  for (var k = 0; k < 12; k++) {
    var px = ((k * 97 + t * 22) % (w + 40)) - 20;
    var py = cy + Math.sin(k * 2.3 + t * 1.4) * maxA * 0.55;
    ctx.beginPath(); ctx.arc(px, py, k % 3 === 0 ? 1.4 : 0.85, 0, Math.PI * 2); ctx.fill();
  }
}

function barSpectrumPaint(ctx, w, h, t, mode) {
  ctx.clearRect(0, 0, w, h);
  var isBar = (mode === 'pulse');
  /* 柱状：基线钉在底沿内 6px；波形：整条带压在底部三分之一，下沿离底 7px */
  var cy = isBar ? h - 6 : h - 20;
  var maxA = isBar ? Math.min(h * 0.52, 46) : Math.min(h * 0.30, 26);
  var c = BAR_SPECTRUM_COLORS;
  if (mode === 'pulse') barSpectrumDrawPulse(ctx, w, cy, maxA, c);
  else if (mode === 'ripple') barSpectrumDrawRipple(ctx, w, cy, maxA, c, t);
  else barSpectrumDrawRibbon(ctx, w, cy, maxA, c, t);
}

function barSpectrumTick(now) {
  requestAnimationFrame(barSpectrumTick);
  var mode = barSpectrumMode();
  var draw = barSpectrumActive() && mode !== 'off';
  if (!draw) {
    /* 不显示时把检查降到约 10fps，空房间 / 控制条隐藏时不空转画布 */
    if ((barSpectrumIdleFrames++ % 6) !== 0) return;
    if (barSpectrumShown) barSpectrumClear();
    return;
  }
  barSpectrumIdleFrames = 0;
  var cv = barSpectrumCanvas();
  if (!cv) return;
  var rect = cv.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  if (w < 2 || h < 2) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  var ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  /* frequencyData 由主循环约 30fps 刷新；60fps 重复读同一帧会让平滑变成两倍速，
     这里按 33ms 节流，保证 attack/release 的时间常数稳定。 */
  if (now - barSpectrumLastRead >= 33) {
    if (barSpectrumPlaying()) barSpectrumReadData();
    else barSpectrumIdleDecay();
    barSpectrumLastRead = now;
  }
  barSpectrumPaint(ctx, w, h, now / 1000, mode);
  if (!barSpectrumShown) {
    document.body.classList.add('bar-spectrum-on');
    barSpectrumShown = true;
  }
}

/* ---- 皮肤弹层里的四格 ---- */
function barSpectrumGrid() {
  return document.getElementById('skin-bar-spectrum-grid');
}

function paintBarSpectrumSelection(mode) {
  var grid = barSpectrumGrid();
  if (!grid) return;
  Array.prototype.forEach.call(grid.querySelectorAll('.bar-spectrum-tile'), function (tile) {
    var on = tile.getAttribute('data-bar-spectrum') === mode;
    tile.classList.toggle('active', on);
    tile.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function pickBarSpectrum(mode) {
  var allowed = ['ripple', 'pulse', 'ribbon', 'off'];
  if (allowed.indexOf(mode) < 0) return false;
  var next = barSpectrumNormalize(mode, null);
  try {
    if (typeof fx !== 'undefined' && fx) {
      fx.barSpectrum = next;
      if (typeof saveLyricLayout === 'function') saveLyricLayout();
    }
  } catch (err) {
    console.warn('[barSpectrum] save failed:', err);
  }
  paintBarSpectrumSelection(next);
  if (next === 'off') barSpectrumClear();
  return true;
}

function renderBarSpectrumGrid() {
  var grid = barSpectrumGrid();
  if (!grid) return false;
  if (!grid.childElementCount) {
    grid.innerHTML = BAR_SPECTRUM_TILES.map(function (m) {
      return '<button type="button" class="bar-spectrum-tile" data-bar-spectrum="' + m.id + '" aria-pressed="false">' +
        '<span class="bsfx-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + m.icon + '</svg></span>' +
        '<b>' + m.name + '</b><small>' + m.sub + '</small></button>';
    }).join('');
    grid.addEventListener('click', function (e) {
      var tile = e.target && e.target.closest ? e.target.closest('.bar-spectrum-tile') : null;
      if (tile) pickBarSpectrum(tile.getAttribute('data-bar-spectrum'));
    });
  }
  paintBarSpectrumSelection(barSpectrumMode());
  return true;
}

function syncBarSpectrumGrid() {
  return renderBarSpectrumGrid();
}

function barSpectrumBoot() {
  barSpectrumCanvas();
  syncBarSpectrumGrid();
  requestAnimationFrame(barSpectrumTick);
}

/* 给真机 / 单测探针用的只读快照与数据注入口；产品逻辑不依赖它 */
window.__barSpectrumProbe = {
  snapshot: function () {
    var cv = barSpectrumCanvas();
    return {
      mode: barSpectrumMode(),
      active: barSpectrumActive(),
      shown: barSpectrumShown,
      width: cv ? cv.width : 0,
      height: cv ? cv.height : 0,
      bins: Array.prototype.slice.call(barSpectrumBins),
      bodyClass: document.body.classList.contains('bar-spectrum-on'),
      gridTiles: barSpectrumGrid() ? barSpectrumGrid().childElementCount : 0,
      afterShell: !!(cv && cv.previousElementSibling && cv.previousElementSibling.classList.contains('lg-glass-shell'))
    };
  },
  setTestData: function (arr) {
    if (!arr) { barSpectrumTestData = null; return true; }
    var u = new Uint8Array(arr.length);
    for (var i = 0; i < arr.length; i++) u[i] = Math.max(0, Math.min(255, Math.round(arr[i])));
    barSpectrumTestData = u;
    return true;
  },
  pick: function (m) { return pickBarSpectrum(m); },
  clear: function () { barSpectrumClear(); return true; }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', barSpectrumBoot);
} else {
  barSpectrumBoot();
}
