// ============================================================
//  启动页 (splash) 控制
// ============================================================

document.body.classList.add('splash-active');
var splashAnimating = true;
var splashCanvas = null, splashCtx = null;
var splashW = 0, splashH = 0;
var splashPixelRatio = 1;
var splashStartedAt = performance.now();
var splashSoundPlayed = false;
var splashAudioCtx = null;
var splashSoundFallbackArmed = false;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;
// 树枝生长 + 粒子飘散专用状态
var splashBranches = [];        // L 系统生成的树枝段数组
var splashParticles = [];       // 从枝桠末端飘散的音符/星芒粒子
var splashStaves = [];          // 从枝端延伸的五线谱组（音符附着其上）
var splashBranchesBuilt = false;
var splashLastSpawnAt = 0;      // 上一次粒子生成时刻（秒）

function splashClamp01(v) { return Math.max(0, Math.min(1, v)); }
function splashSmoothstep(edge0, edge1, x) {
  var t = splashClamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function splashEaseOutCubic(t) {
  t = splashClamp01(t);
  return 1 - Math.pow(1 - t, 3);
}
// 种子随机数：保证每次启动树枝形状一致
var splashSeed = 0;
function splashRandom() {
  splashSeed = (splashSeed * 16807 + 0) % 2147483647;
  return (splashSeed - 1) / 2147483646;
}

// L 系统生成树枝：种子随机数固定形状，稀疏优雅
function buildSplashBranches() {
  splashBranches = [];
  splashStaves = [];
  splashSeed = 42; // 固定种子，每次启动一样
  var baseLen = splashH * 0.18;
  var maxDepth = 8;
  var startAngle = -Math.PI / 2 + 0.08;
  function grow(x1, y1, angle, length, depth) {
    if (depth > maxDepth || length < 4) return;
    var curve = (splashRandom() - 0.5) * 0.08;
    var finalAngle = angle + curve;
    var lenJitter = length * (0.95 + splashRandom() * 0.10);
    var x2 = x1 + Math.cos(finalAngle) * lenJitter;
    var y2 = y1 + Math.sin(finalAngle) * lenJitter;
    var thickness = Math.max(0.2, (maxDepth - depth) * 0.30);
    var growthDelay = (depth / maxDepth) * 1.3;
    splashBranches.push({
      x1: x1, y1: y1, x2: x2, y2: y2,
      thickness: thickness,
      delay: growthDelay, duration: 0.5,
      depth: depth,
      isTip: (depth >= maxDepth - 1)
    });
    if (depth < maxDepth) {
      var branches = 2;
      if (splashRandom() > 0.85 && depth < maxDepth - 3) branches = 3;
      for (var i = 0; i < branches; i++) {
        var spread = 0.22 + splashRandom() * 0.18;
        var dir = (i === 0) ? -1 : (i === 1 ? 1 : 0);
        var nextAngle = finalAngle + dir * spread;
        var nextLen = lenJitter * (0.70 + splashRandom() * 0.10);
        grow(x2, y2, nextAngle, nextLen, depth + 1);
      }
    }
  }
  grow(splashW * 0.18, splashH * 0.77, startAngle, baseLen, 0);
  splashBranchesBuilt = true;
}

// 从枝桠末端生成粒子：音符/星芒/圆点，被风水平向右吹
function spawnSplashParticle(x, y) {
  // 速度极大偏向 X 轴正方向 (向右)，模拟风吹
  var vx = 80 + Math.random() * 150;
  var vy = (Math.random() - 0.5) * 30 - 10; // Y轴上下微弱浮动
  var typeRand = Math.random();
  var type = typeRand < 0.50 ? 'note' : (typeRand < 0.75 ? 'star' : 'circle');
  var noteType = Math.floor(Math.random() * 4);
  var s = 6 + Math.random() * 8; // 稍微再大一点
  // 随机分配颜色：白、淡粉、淡蓝
  var colorRand = Math.random();
  var pColor = '255,255,255'; // 默认白
  if (colorRand < 0.3) pColor = '255,200,215'; // 淡粉
  else if (colorRand < 0.6) pColor = '200,240,255'; // 淡蓝
  splashParticles.push({
    x: x, y: y,
    vx: vx, vy: vy,
    size: s,
    color: pColor,
    life: 0, maxLife: 5.0 + Math.random() * 4.0,
    seed: Math.random() * Math.PI * 2,
    type: type,
    noteType: noteType,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.05,
    swayAmp: 1.0 + Math.random() * 2.0,
    swayFreq: 0.8 + Math.random() * 1.5
  });
  if (splashParticles.length > 300) splashParticles.shift();
}

// 在画面任意位置生成环境粒子（让音符布满整个画面，不仅从树枝来）
function spawnAmbientSplashParticle() {
  var x = -30 + Math.random() * (splashW + 60);
  var y = splashH + 20 + Math.random() * 80;
  spawnSplashParticle(x, y);
}

// 在五线谱组上生成音符：用沿线距离驱动位置，严格贴着线条运动
function spawnStaveNote(stave) {
  var lineIdx = Math.floor(Math.random() * 5);
  var typeRand = Math.random();
  var type = typeRand < 0.65 ? 'note' : (typeRand < 0.85 ? 'star' : 'circle');
  var noteType = Math.floor(Math.random() * 4);
  var s = 5 + Math.random() * 5;
  var colorRand = Math.random();
  var pColor = '255,255,255';
  if (colorRand < 0.3) pColor = '255,200,215';
  else if (colorRand < 0.6) pColor = '200,240,255';
  var speed = 40 + Math.random() * 70;
  splashParticles.push({
    stave: stave,          // 所属五线谱
    lineIdx: lineIdx,      // 在哪条线上（0-4）
    dist: 0,               // 沿线条方向的距离（从起点开始）
    speed: speed,          // 沿线速度
    size: s,
    color: pColor,
    life: 0, maxLife: 5.0 + Math.random() * 3.0,
    seed: Math.random() * Math.PI * 2,
    type: type,
    noteType: noteType,
    rot: (type === 'note') ? stave.angle : Math.random() * Math.PI * 2,
    rotSpeed: 0,
    swayAmp: 0.4 + Math.random() * 0.8,
    swayFreq: 1.0 + Math.random() * 1.5
  });
  if (splashParticles.length > 300) splashParticles.shift();
}

function initMineradioSplashWebgl(canvas) {
  // 新版启动动画使用 2D canvas 绘制树枝+粒子，不再使用 WebGL
  return false;
}

// 等 Caveat 字体加载完成后，再触发手写文字动画（避免先用系统 cursive 回退字渲染）
(function armSplashHandwrite() {
  var hwEl = document.querySelector('.splash-handwrite');
  if (!hwEl) return;
  function reveal() { hwEl.classList.add('ready'); }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('600 100px Caveat').then(reveal).catch(function(){
      // 字体加载失败：1.5s 后兜底显示，避免文字一直不可见
      setTimeout(reveal, 1500);
    });
  } else {
    setTimeout(reveal, 800);
  }
})();

(function initMineradioSplashCanvas() {
  var canvas = document.getElementById('splash-gl');
  if (!canvas) return;
  var gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) return;

  // ===== 编译 shader =====
  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('splash shader compile error:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }
  var vsSrc = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
  var fsSrc = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec2 uMouse;',
    'uniform float uMouseForce;',
    'uniform float uIntro;',
    'uniform float uExit;',
    'vec2 hash2(vec2 p){',
    '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
    '  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);',
    '}',
    'float noise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(dot(hash2(i + vec2(0.0,0.0)), f - vec2(0.0,0.0)),',
    '        dot(hash2(i + vec2(1.0,0.0)), f - vec2(1.0,0.0)), u.x),',
    '    mix(dot(hash2(i + vec2(0.0,1.0)), f - vec2(0.0,1.0)),',
    '        dot(hash2(i + vec2(1.0,1.0)), f - vec2(1.0,1.0)), u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0; float a = 0.5;',
    '  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);',
    '  for(int i = 0; i < 6; i++){ v += a * noise(p); p = rot * p * 2.0; a *= 0.5; }',
    '  return v;',
    '}',
    'float field(vec2 uv, vec2 mouse){',
    '  float t = uTime * 0.08;',
    '  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3) - t));',
    '  vec2 r = vec2(',
    '    fbm(uv + 3.0 * q + vec2(1.7, 9.2) + 0.15 * t),',
    '    fbm(uv + 3.0 * q + vec2(8.3, 2.8) + 0.12 * t)',
    '  );',
    '  float pattern = fbm(uv + 3.5 * r);',
    '  float md = length(uv - mouse);',
    '  float ripple = sin(md * 14.0 - uTime * 2.0) * exp(-md * 3.0);',
    '  float attract = exp(-md * 2.2) * (0.6 + 0.4 * uMouseForce);',
    '  float introScale = mix(0.15, 1.0, smoothstep(0.0, 1.0, uIntro));',
    '  float d = length(uv) / introScale;',
    '  float breathe = 0.9 + 0.1 * sin(uTime * 0.5);',
    '  float coreGlow = exp(-d * 2.3) * 1.4 * breathe;',
    '  float haloGlow = exp(-d * 0.9) * 0.6;',
    '  float intensity = pattern * 0.55 + coreGlow + haloGlow + attract * 0.6 + ripple * 0.18 * uMouseForce;',
    '  return intensity * mix(0.2, 1.0, uIntro);',
    '}',
    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes.xy) / uRes.y;',
    '  vec2 mouse = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0);',
    '  float rd = length(uv);',
    '  vec2 dir = uv * rd * 0.012;',
    '  float iR = field(uv + dir, mouse);',
    '  float iG = field(uv, mouse);',
    '  float iB = field(uv - dir, mouse);',
    '  vec3 paper = vec3(0.93, 0.95, 0.99);',
    '  vec3 soft  = vec3(0.62, 0.79, 0.98);',
    '  vec3 blue  = vec3(0.24, 0.54, 0.94);',
    '  vec3 core  = vec3(0.98, 0.99, 1.00);',
    '  vec3 col;',
    '  col.r = mix(paper.r, mix(soft.r, mix(blue.r, core.r, smoothstep(0.9, 1.35, iR)), smoothstep(0.4, 0.95, iR)), smoothstep(0.05, 0.5, iR));',
    '  col.g = mix(paper.g, mix(soft.g, mix(blue.g, core.g, smoothstep(0.9, 1.35, iG)), smoothstep(0.4, 0.95, iG)), smoothstep(0.05, 0.5, iG));',
    '  col.b = mix(paper.b, mix(soft.b, mix(blue.b, core.b, smoothstep(0.9, 1.35, iB)), smoothstep(0.4, 0.95, iB)), smoothstep(0.05, 0.5, iB));',
    '  float md = length(uv - mouse);',
    '  float attract = exp(-md * 2.4);',
    '  col = mix(col, blue, attract * 0.25 * uMouseForce);',
    '  float sparkle = 0.0;',
    '  for(int i = 0; i < 5; i++){',
    '    float fi = float(i);',
    '    vec2 sp = hash2(vec2(fi * 12.3, fi * 7.1));',
    '    sp.x += sin(uTime * (0.1 + fi * 0.03) + fi) * 0.35;',
    '    sp.y += cos(uTime * (0.08 + fi * 0.04) + fi * 2.0) * 0.35;',
    '    float sd = length(uv - sp * vec2(uRes.x / uRes.y, 1.0) * 0.5);',
    '    sparkle += 0.005 / (sd + 0.004);',
    '  }',
    '  col = mix(col, blue, clamp(sparkle * 0.15 * uIntro, 0.0, 0.5));',
    '  float grain = hash2(gl_FragCoord.xy + uTime).x;',
    '  col += (grain - 0.5) * 0.018;',
    '  float vign = 1.0 - 0.12 * dot(uv, uv);',
    '  col *= vign;',
    '  if (uExit > 0.0) {',
    '    float e = uExit;',
    '    float d = length(uv);',
    '    float burst = exp(-d * mix(2.3, 0.2, e)) * (1.0 + e * 4.0);',
    '    col = mix(col, vec3(1.0), smoothstep(0.0, 1.0, burst * e));',
    '    col = mix(col, vec3(1.0), smoothstep(0.6, 1.0, e));',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var vs = compile(gl.VERTEX_SHADER, vsSrc);
  var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('splash program link error:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  // 确保首帧有颜色，避免 WebGL 失败时 canvas 显示为黑/透明
  gl.clearColor(0.93, 0.95, 0.99, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'uRes');
  var uTime = gl.getUniformLocation(prog, 'uTime');
  var uMouse = gl.getUniformLocation(prog, 'uMouse');
  var uMouseForce = gl.getUniformLocation(prog, 'uMouseForce');
  var uIntro = gl.getUniformLocation(prog, 'uIntro');
  var uExit = gl.getUniformLocation(prog, 'uExit');

  // 性能检测
  var quality = 1.0;
  (function detectPerf() {
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var cores = navigator.hardwareConcurrency || 4;
    if (isMobile || cores <= 4) quality = 0.65;
  })();

  var dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  // 鼠标交互
  var mx = 0.5, my = 0.5, cmx = 0.5, cmy = 0.5, force = 0;
  function setPointer(x, y) {
    mx = x / window.innerWidth;
    my = 1.0 - y / window.innerHeight;
    force = 1.0;
  }
  window.addEventListener('mousemove', function(e) { setPointer(e.clientX, e.clientY); });
  window.addEventListener('touchmove', function(e) {
    if (e.touches[0]) setPointer(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  // 渲染循环
  var start = performance.now();
  var frameCount = 0, lastCheck = performance.now(), degraded = false;

  // 暴露退出接口给 dismissSplash
  window.splashGlExit = { started: false, startAt: 0 };

  function frame(now) {
    if (!splashAnimating) return;
    var t = (now - start) / 1000;

    cmx += (mx - cmx) * 0.06;
    cmy += (my - cmy) * 0.06;
    force *= 0.96;

    var intro = Math.min(t / 2.5, 1.0);
    var introEased = intro * intro * (3.0 - 2.0 * intro);

    var exit = 0;
    if (window.splashGlExit && window.splashGlExit.started) {
      exit = Math.min((now - window.splashGlExit.startAt) / 1400, 1.0);
    }

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, cmx, cmy);
    gl.uniform1f(uMouseForce, force);
    gl.uniform1f(uIntro, introEased);
    gl.uniform1f(uExit, exit);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    frameCount++;
    if (now - lastCheck >= 1000) {
      var fps = frameCount * 1000 / (now - lastCheck);
      frameCount = 0; lastCheck = now;
      if (fps < 40 && !degraded) {
        degraded = true;
        quality = Math.max(0.5, quality * 0.7);
        resize();
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

function playMineradioIntroSound() {
  if (splashSoundPlayed) return;
  try {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    var ctx = splashAudioCtx || new AudioContextCtor();
    splashAudioCtx = ctx;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().then(function(){
        if (!splashSoundPlayed) playMineradioIntroSound();
      }).catch(function(){});
      if (ctx.state === 'suspended') return;
    }
    splashSoundPlayed = true;

    var now = ctx.currentTime + 0.02;
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.062, now + 0.16);
    master.gain.exponentialRampToValueAtTime(0.040, now + 3.35);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 5.28);
    master.connect(ctx.destination);

    var noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.45), ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      var tail = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(tail, 1.35);
    }
    var noise = ctx.createBufferSource();
    var noiseGain = ctx.createGain();
    var noiseFilter = ctx.createBiquadFilter();
    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(720, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(2400, now + 2.2);
    noiseFilter.Q.setValueAtTime(0.72, now);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.020, now + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.010, now + 1.60);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.42);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);
    noise.start(now); noise.stop(now + 2.46);

    var low = ctx.createOscillator();
    var lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(86, now + 0.18);
    low.frequency.exponentialRampToValueAtTime(43, now + 1.18);
    lowGain.gain.setValueAtTime(0.0001, now + 0.12);
    lowGain.gain.exponentialRampToValueAtTime(0.032, now + 0.30);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.34);
    low.connect(lowGain); lowGain.connect(master);
    low.start(now + 0.12); low.stop(now + 1.40);

    function softTone(type, f0, f1, startAt, dur, peak) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var filter = ctx.createBiquadFilter();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, now + startAt);
      osc.frequency.exponentialRampToValueAtTime(f1, now + startAt + dur * 0.72);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3400, now + startAt);
      gain.gain.setValueAtTime(0.0001, now + startAt);
      gain.gain.exponentialRampToValueAtTime(peak, now + startAt + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startAt + dur);
      osc.connect(filter); filter.connect(gain); gain.connect(master);
      osc.start(now + startAt);
      osc.stop(now + startAt + dur + 0.04);
    }
    softTone('triangle', 440, 660, 1.05, 0.72, 0.018);
    softTone('sine', 880, 1320, 2.10, 0.86, 0.013);
    softTone('triangle', 1180, 1760, 2.72, 0.52, 0.010);
    softTone('triangle', 660, 1180, 3.32, 0.82, 0.014);
    softTone('sine', 1760, 1040, 3.64, 0.46, 0.010);
  } catch (e) {}
}
function armSplashSoundFallback() {
  if (splashSoundFallbackArmed) return;
  splashSoundFallbackArmed = true;
  function unlock() {
    if (!splashSoundPlayed) playMineradioIntroSound();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}

function dismissSplash() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-dismiss');
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashReadyToEnter = false;
  s.classList.remove('ready');
  if (typeof shouldUseIdleWallpaperPreview === 'function'
    ? shouldUseIdleWallpaperPreview(true)
    : (typeof shouldShowEmptyHomeAfterSplash === 'function' && shouldShowEmptyHomeAfterSplash())) {
    activateHomeWallpaperPreview();
  }
  revealIdleParticles(0, reduceSplashMotion ? 700 : 2400);
  document.body.classList.add('splash-revealing');
  s.classList.add('exiting');
  // 触发 Aurora shader 的退出动画（向中心汇聚过曝到白）
  if (window.splashGlExit) {
    window.splashGlExit.started = true;
    window.splashGlExit.startAt = performance.now();
  }

  var content = s.querySelector('.splash-content');
  if (content) {
    content.style.transition = 'opacity 680ms cubic-bezier(.22,1,.36,1), transform 980ms cubic-bezier(.22,1,.36,1)';
    content.style.opacity = '0';
    content.style.transform = 'translateY(-14px) scale(.986)';
  }

  setTimeout(function() {
    s.classList.add('hide');
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    markAppPerf('home-revealed');
    if (s && s.parentNode) s.style.display = 'none';
    requestAnimationFrame(function(){
      var homeShown = updateEmptyHomeVisibility({ forceLoad: true });
      if (!homeShown && shouldForceEmptyHomeAfterSplash()) {
        homeSuppressed = false;
        homeForcedOpen = true;
        homeShown = updateEmptyHomeVisibility({ forceLoad: true });
      }
      requestAnimationFrame(function(){
        updateVisualGuideButtonVisibility();
        var guideStarted = maybeRunStartupVisualGuide('splash');
        scheduleStartupLoginGuide('splash', guideStarted);
        setTimeout(maybeShowUploadTipOnce, 5200);
      });
    });
  }, 1180);
}

function markSplashReadyToEnter() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-ready');
  splashReadyToEnter = true;
  splashTimer = null;
  s.classList.add('ready');
  s.setAttribute('role', 'button');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', '点击进入 Mineradio');
}

function initSplashDomBindings() {
  updateVisualGuideButtonVisibility();
  paintHomeLocalSnapshot();
  var s = document.getElementById('splash');
  if (!s) return;
  markAppPerf('dom-content-loaded');
  armSplashSoundFallback();
  prewarmHomeWallpaperPreview();
  function requestSplashEnter() {
    playMineradioIntroSound();
    if (splashReadyToEnter) dismissSplash();
  }
  s.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function(e){
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter();
    }
  });
  if (reduceSplashMotion) {
    s.classList.add('reduce-motion');
    splashTimer = setTimeout(markSplashReadyToEnter, 900);
    return;
  }
  playMineradioIntroSound();
  splashTimer = setTimeout(markSplashReadyToEnter, 4000);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSplashDomBindings);
} else {
  initSplashDomBindings();
}

// ============================================================
//  启动（单条语句失败不得阻断后续模块，尤其是 11-main-loop）
// ============================================================
try {
applyDiyMode(diyPlayerMode, { save: false });
bindFxPanel();
if (typeof migratePerformanceQualityTowardAutoOnce === 'function') migratePerformanceQualityTowardAutoOnce();
// 低配 auto→eco 时把封面粒子网格压下来（默认 1.55≈183² 是播放 CPU 大头）
if (typeof applyCoverParticleResolution === 'function' && fx) {
  try { applyCoverParticleResolution(fx.coverResolution, { reload: false }); } catch (_) {}
}
applySavedLyricPaletteState();
// 加载已保存的淡入淡出偏好
(function(){
  try {
    var saved = JSON.parse(localStorage.getItem('mineradio-audio-fade-v1'));
    if (saved && saved.in) AUDIO_FADE_IN_MS = normalizeAudioFadeMs(saved.in, 460);
    if (saved && saved.out) AUDIO_FADE_OUT_MS = normalizeAudioFadeMs(saved.out, 420);
  } catch (_) {}
})();
bindQualityControl();
bindMoodAudioControl();
bindSleepTimerControl();
bindVolumeControls();
initControlGlassSurface();
bindPlayerControlAnimations();
scheduleUiWarmTask(function(){
  updateControlGlassDisplacementMap();
  updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  try {
    if (renderer && renderer.compile && scene && camera) renderer.compile(scene, camera);
  } catch (e) {}
}, 900);
applyUserCapsuleAutoHideState();
applyFxFabAutoHideState();
applyControlsAutoHidePreference();
applyDesktopLyricsState(false);
applyWallpaperModeState(false);
setShelfMode(fx.shelf);
applyStartupStarfieldPreset();
applyPlaylistPanelPinState(false);
if (fx.floatLayer) {
  try { createFloatLayer(); } catch (err) { console.warn('[boot] createFloatLayer failed:', err); }
}
if (fx.particleLyrics && !isClassicPresetActive()) {
  try { createLyricsParticles(); } catch (err) { console.warn('[boot] createLyricsParticles failed:', err); }
}
if (fx.backCover) {
  try { createBackCoverLayer(); } catch (err) { console.warn('[boot] createBackCoverLayer failed:', err); }
}
initIdleGuideCanvas();
} catch (bootErr) {
  console.error('[boot] startup block failed (continuing to main-loop):', bootErr);
}
function bootstrapStartupLoginStatus() {
  startupLoginStatusPromise = Promise.all([
    typeof refreshLoginStatus === 'function' ? refreshLoginStatus() : Promise.resolve(null),
    typeof refreshQQLoginStatus === 'function' ? refreshQQLoginStatus({ forceVip: true, reason: 'startup' }) : Promise.resolve(null),
    typeof refreshKugouLoginStatus === 'function' ? refreshKugouLoginStatus() : Promise.resolve(null),
    typeof refreshQishuiLoginStatus === 'function' ? refreshQishuiLoginStatus() : Promise.resolve(null),
    typeof refreshSpotifyLoginStatus === 'function' ? refreshSpotifyLoginStatus() : Promise.resolve(null)
  ]);
  // Keep a named hook for 05-startup-bindings.js / guards.
  if (typeof ensureStartupQQVipRecheck === 'function') { /* already included above */ }
  return startupLoginStatusPromise;
}
function paintHomeLocalSnapshot() {
  if (!homeDiscoverState.loaded && Mineradio.home && typeof Mineradio.home.readCache === 'function') {
    hydrateHomeDiscoverFromCache();
  }
  if (!homeWeatherRadioState.loaded) hydrateHomeWeatherFromCache();
  syncContinueCard();
  renderHomeDiscover();
  refreshContinueCardLive();
  bootstrapScenePresets(false);
}
function handleStartupLoginReady() {
  if (hasAnyPlatformLogin()) {
    homeDiscoverState.loggedIn = true;
    refreshUserPlaylists(true);
    if (!homeDiscoverState.loaded) {
      if (hydrateHomeDiscoverFromCache()) { /* cached */ }
    }
    if (!homeDiscoverState.loading) loadHomeDiscover(true);
  }
  maybeRestorePlaybackSessionOnStartup();
  initHomeSceneRow();
  bootstrapScenePresets(false);
  paintHomeLocalSnapshot();
  if (document.body.classList.contains('splash-active')) return;
  var homeShown = updateEmptyHomeVisibility({ forceLoad: hasAnyPlatformLogin() });
  if (!hasAnyPlatformLogin()) scheduleStartupLoginGuide('status', false);
  else if (homeShown) renderHomeDiscover();
}
bootstrapStartupLoginStatus();
startQQLoginStatusAutoRefresh();
if (typeof startKugouLoginStatusAutoRefresh === 'function') startKugouLoginStatusAutoRefresh();
if (typeof startQishuiLoginStatusAutoRefresh === 'function') startQishuiLoginStatusAutoRefresh();
if (typeof startSpotifyLoginStatusAutoRefresh === 'function') startSpotifyLoginStatusAutoRefresh();
if (startupLoginStatusPromise && startupLoginStatusPromise.then) {
  startupLoginStatusPromise.then(handleStartupLoginReady).catch(function(e){
    console.warn('[StartupLogin]', e);
    handleStartupLoginReady();
  });
}
var collectNameInput = document.getElementById('collect-new-name');
if (collectNameInput) {
  collectNameInput.addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      e.preventDefault();
      createPlaylistFromCollect();
    }
  });
}
var customLyricInput = document.getElementById('custom-lyric-input');
if (customLyricInput) {
  customLyricInput.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveCustomLyricForCurrent();
    }
  });
}
safeRenderQueuePanel('startup');
updateCustomCoverButton();
updateCustomLyricControls();
updateLikeButtons();
setTimeout(initUpdatePreview, 9000);

