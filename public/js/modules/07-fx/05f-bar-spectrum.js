// ====================================================================
//  控制条底层频谱（Mineradio / LiquidGlass 专用）
//  ------------------------------------------------------------------
//  层级：#bottom-bar 内部的 .lg-glass-shell（WebGL 玻璃）之后、
//        #progress-bar / #controls 之前，挂一层独立 2D canvas。
//        它不抢 backdrop-filter、不改 background、不碰 gainNode，
//        只是在液态玻璃之上、控件之下画一条贴底频谱。
//        canvas 除柱阵/光点外必须保持全透明：控制条自己的颜色、
//        玻璃和 #progress-bar 进度条都由原有 CSS/DOM 负责，本层不复制、
//        不覆盖、不重画（2026-11-12 修正：曾误把酷狗「预览卡片」的
//        整卡渐变底色和底部白线一起画进来，导致控制条变色 + 多一条进度条）。
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
  { id: 'ripple', name: '迷幻水波', sub: '单丘细柱',
    icon: '<path d="M2 13c3-4 5-4 8 0s5 4 8 0 3-3 4-3"/><path d="M4 17h.01M8 17h.01M12 17h.01M16 17h.01M20 17h.01"/>' },
  { id: 'pulse', name: '动感律动', sub: '双峰密柱',
    icon: '<path d="M4 19v-5M8 19V9M12 19V5M16 19v-7M20 19v-4"/>' },
  { id: 'ribbon', name: '流光丝带', sub: '流动光带',
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

/* ==================================================================
 * 酷狗频谱「绘制手法」移植（2026-11-12 修正）
 * ------------------------------------------------------------------
 * 取证：kugou.skn 内 PlaybackVisualRadioBox 的 Caption -> NormalBack
 *   迷幻水波 wave_spectrum   -> wave.2x.avif   (620x160, 1445B)
 *   节奏音阶 beat_spectrum   -> beat.2x.avif   (620x160, 1261B)
 *   动感律动 rhythm_spectrum -> rhythm.2x.avif (620x160, 1379B)
 *   名字表里的 u32 资源长度与 AVIF box 长度逐一吻合，不是按视觉猜的。
 *
 * 关键结论：这三张是「皮肤选择弹窗里的预览卡片」，不是播放页实时频谱。
 *   卡片自带的整幅渐变底色、底部那条白色播放进度线，都是卡片装饰；
 *   真正播放时 kugou.dll 只在页面上画一层半透明白色细柱阵，
 *   控制条颜色、进度条由播放器自己的控件负责。
 *   11-11 误把整张卡片搬进 #bottom-bar，导致控制条被染成棕黄色、
 *   频谱下面又多出一条假进度线。11-12 起只保留柱阵，其余全透明。
 *
 * 三格是用户确认过的 迷幻水波 / 动感律动 / 流光丝带 + 关闭；
 * 官方第三套「节奏音阶」此前已被用户明确排除，不复活。对应关系：
 *   ripple -> 官方 wave：单丘包络 + 青白柱色
 *   pulse  -> 官方 rhythm：双大峰 + 暖白柱色
 *   ribbon -> 自有「流光丝带」：连续流动波形 + 粉白柱色 + 光晕粒子
 * 柱色取自官方卡里柱体像素反解的本色（近白），不是卡片底色；
 * 三套共用 KG 手法：固定包络 × 实时能量小幅调制、贴底细柱、水平渐变。
 * ================================================================== */
function barSpectrumKgTheme(mode) {
  var g = function (x, mu, s) { var d = (x - mu) / s; return Math.exp(-0.5 * d * d); };
  var sm = function (a, b, x) {
    var u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  if (mode === 'pulse') return {
    /* rhythm.2x.avif 柱体本色：暖白 -> 灰白 */
    bar: [[0, '#d8cdbb'], [0.3, '#f2ece0'], [0.62, '#bcb6a9'], [1, '#8a8880']],
    gap: 3.0, barW: 1.4, amp: 0.46, particles: 0,
    env: function (x) {
      return 0.02 + 0.44 * g(x, 0.23, 0.070) + 0.86 * g(x, 0.39, 0.078)
        + 1.0 * g(x, 0.55, 0.078) + 0.44 * g(x, 0.71, 0.070);
    }
  };
  if (mode === 'ribbon') return {
    /* beat.2x.avif 柱体本色：粉白 -> 冷灰白 */
    bar: [[0, '#b2a4a6'], [0.4, '#efe2e2'], [0.68, '#dcd6de'], [1, '#929a9e']],
    gap: 8.0, barW: 2.6, amp: 0.44, particles: 14,
    /* 丝带是连续流动的波，不是官方 beat 的四段鼓点峰 */
    env: function (x) {
      var flow = 0.5 + 0.5 * Math.sin(x * Math.PI * 4.2 - 0.6);
      return 0.10 + 0.54 * flow * sm(0.02, 0.12, x) * (1 - sm(0.88, 0.99, x));
    }
  };
  return {
    /* wave.2x.avif 柱体本色：青白 -> 灰白 */
    bar: [[0, '#a9c3bb'], [0.3, '#e6f2ea'], [0.58, '#bfdcd0'], [0.8, '#c9cfcb'], [1, '#aeb6b4']],
    gap: 7.0, barW: 2.2, amp: 0.46, particles: 0,
    env: function (x) {
      return 0.02 + 1.0 * g(x, 0.43, 0.25) * sm(0.02, 0.18, x) * (1 - sm(0.78, 0.98, x));
    }
  };
}

function barSpectrumKgGradient(ctx, stops, w) {
  var g = ctx.createLinearGradient(0, 0, w, 0);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  return g;
}

function barSpectrumKgParticles(ctx, w, h, theme, t) {
  ctx.shadowColor = 'rgba(255,245,225,0.95)';
  for (var k = 0; k < theme.particles; k++) {
    var seed = k * 97.13;
    var px = (seed + t * (9 + (k % 4) * 3)) % (w + 60) - 30;
    var py = h - 6 - h * theme.amp * (0.35 + 0.62 * Math.abs(Math.sin(seed * 0.017 + t * 0.55)));
    var twinkle = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.9 + k * 1.7));
    ctx.shadowBlur = 10 + 5 * twinkle;
    ctx.globalAlpha = 0.55 * twinkle;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(px, py, 1.1 + 0.9 * (k % 3) / 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function barSpectrumKgBars(ctx, w, cy, maxA, theme) {
  ctx.fillStyle = barSpectrumKgGradient(ctx, theme.bar, w);
  ctx.globalAlpha = 0.86;
  var cols = Math.max(64, Math.floor(w / theme.gap));
  for (var j = 0; j < cols; j++) {
    var xn = j / cols;
    /* 固定包络定形态，实时能量只做呼吸调制：形态稳定但不会一直顶在同一高度 */
    var live = 0.38 + 0.62 * Math.min(1, barSpectrumBinAt(xn) * 1.6);
    var hh = 2 + maxA * theme.env(xn) * live;
    ctx.fillRect(j * theme.gap + 1, cy - hh, theme.barW, hh);
  }
  ctx.globalAlpha = 1;
}

/* ---- 迷幻水波：青白细柱 + 中间偏左单丘 ---- */
function barSpectrumDrawRipple(ctx, w, cy, maxA, c, t) {
  ctx.globalAlpha = 0.86;
  barSpectrumKgBars(ctx, w, cy, maxA, barSpectrumKgTheme('ripple'));
}

/* ---- 动感律动：暖白密柱 + 双大峰 ---- */
function barSpectrumDrawPulse(ctx, w, cy, maxA, c, t) {
  ctx.globalAlpha = 0.86;
  barSpectrumKgBars(ctx, w, cy, maxA, barSpectrumKgTheme('pulse'));
}

/* ---- 流光丝带：粉白细柱 + 连续流动波形 + 光晕粒子 ---- */
function barSpectrumDrawRibbon(ctx, w, cy, maxA, c, t) {
  ctx.globalAlpha = 0.86;
  barSpectrumKgBars(ctx, w, cy, maxA, barSpectrumKgTheme('ribbon'));
}

function barSpectrumPaint(ctx, w, h, t, mode) {
  ctx.clearRect(0, 0, w, h);
  var theme = barSpectrumKgTheme(mode);
  /* 只画柱阵与光点：不铺整幅渐变、不画进度线。
     控制条的颜色 / 玻璃 / #progress-bar 全部由原有 CSS 与 DOM 负责，
     本 canvas 的其余像素必须保持透明（见文件头说明）。 */
  var cy = h - 6;
  var maxA = Math.min(h * theme.amp, 52);
  var c = BAR_SPECTRUM_COLORS;
  if (mode === 'pulse') barSpectrumDrawPulse(ctx, w, cy, maxA, c, t);
  else if (mode === 'ripple') barSpectrumDrawRipple(ctx, w, cy, maxA, c, t);
  else barSpectrumDrawRibbon(ctx, w, cy, maxA, c, t);
  if (theme.particles) barSpectrumKgParticles(ctx, w, h, theme, t);
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
