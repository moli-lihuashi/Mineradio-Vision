/* Folia 背景 — 空（sora）：GL_POINTS 星空
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/sora/）：
 *   SoraBackground.tsx（208）→ 顶点/片元着色器 + 150 个点精灵
 *   entry.tsx（49）         → mode 'sora' / order 50 / labelFallback 'Sora'
 *   SoraBackgroundSettingsCard.tsx（46）→ 只有一个「空白」开关（面板在 0l-folia-tuning-panel.js）
 *   i18n/locales/zh-CN.ts:2087 → options.visualizerBackgroundModeSora = 空
 *
 * 必须照抄的判据
 * --------------
 * 1. 着色器**逐字搬**：粒子位置/大小/闪烁全部由 a_index 哈希出来（hash2 = fract(sin(dot(p,127.1,311.7))*43758.5453123)），
 *    没有任何随机表。改一个常数，星点的分布就整体漂移。
 * 2. PARTICLE_COUNT = 150，用 gl.POINTS 一次画完（Folia 的注释写明这是为了摆脱逐点模糊的 CPU 开销）。
 * 3. 颜色取主题主色，5% 的点（color_type_rand > 0.90）取强调色。
 * 4. 混合用 gl.ONE / gl.ONE_MINUS_SRC_ALPHA（片元输出已预乘 alpha）。
 * 5. 底色：深色主题纯黑，浅色主题纯白（entry.tsx 的 blank 分支同色）。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 不用 twgl：等价的手写 program / buffer / attribute / uniform（依赖只多一个 WebGL1 上下文）。
 * 2. **不另起 rAF**：本项目禁止第二套循环，时间推进与绘制都由世界 tick 驱动（ctx.dt）。
 *    暂停时 dt 不累加，画面就停在最后一帧——与 Folia 的 pausedRef 一致。
 * 3. isDaylight 由主题背景亮度推出（本项目没有独立的白天开关）：亮度 > 0.6 视为浅色。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaBackground !== 'function') return;

  var PARTICLE_COUNT = 150;

  /* ---- tuning：types.ts:986/1062 —— SoraBackgroundTuning 只有 blank 一项 ----
   * entry.tsx:17 注释与 render 分支：blank=true 时**整个 SoraBackground 不挂载**，
   * 只剩一张静态纯色帧（夜间纯黑 / 日间纯白，与星空底色同一来源）。
   * 存档键沿用本项目惯例（Folia 是 'sora_background_tuning'）。 */
  var SORA_TUNING_STORE_KEY = 'mineradio-folia-sora-tuning-v1';

  var SORA_TUNING_DEFAULT = { blank: false };

  function foliaSoraNormalizeTuning(value) {
    var raw = (value && typeof value === 'object') ? value : {};
    return { blank: typeof raw.blank === 'boolean' ? raw.blank : SORA_TUNING_DEFAULT.blank };
  }

  var foliaSoraTuningCache = null;

  function foliaSoraTuning() {
    if (foliaSoraTuningCache) return foliaSoraTuningCache;
    var raw = null;
    try {
      var text = window.localStorage ? window.localStorage.getItem(SORA_TUNING_STORE_KEY) : null;
      if (text) raw = JSON.parse(text);
    } catch (_) { raw = null; }
    foliaSoraTuningCache = foliaSoraNormalizeTuning(raw);
    return foliaSoraTuningCache;
  }

  /* 面板写入口（0l-folia-tuning-panel.js）：set 合并归一化 / save 落盘 / reset 回默认。
   * blank 切换要挂/摘 WebGL 画布，由面板改完存档后调 foliaWorldRebuildBackground 整体重建。 */
  function foliaSoraSetTuning(patch) {
    var merged = {};
    var base = foliaSoraTuning();
    var k;
    for (k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
    }
    if (patch) {
      for (k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
      }
    }
    foliaSoraTuningCache = foliaSoraNormalizeTuning(merged);
    return foliaSoraTuningCache;
  }

  function foliaSoraSaveTuning() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(SORA_TUNING_STORE_KEY, JSON.stringify(foliaSoraTuning()));
      }
    } catch (_) {}
  }

  function foliaSoraResetTuning() {
    foliaSoraTuningCache = foliaSoraNormalizeTuning(null);
    foliaSoraSaveTuning();
  }

  window.foliaSoraTuning = foliaSoraTuning;
  window.foliaSoraSetTuning = foliaSoraSetTuning;
  window.foliaSoraSaveTuning = foliaSoraSaveTuning;
  window.foliaSoraResetTuning = foliaSoraResetTuning;

  /* SoraBackground.tsx:18-65 —— 逐字照抄。 */
  var VERTEX_SHADER = [
    'attribute float a_index;',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'varying float v_color_type;',
    'varying float v_intensity_base;',
    '',
    'float hash2(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    '',
    'void main() {',
    '  float seed = a_index * 123.456;',
    '',
    '  float speed_rand = hash2(vec2(seed, 1.1));',
    '  float size_rand = hash2(vec2(seed, 2.2));',
    '  float y_rand = hash2(vec2(seed, 3.3));',
    '  float x_rand = hash2(vec2(seed, 4.4));',
    '  float blink_rand = hash2(vec2(seed, 5.5));',
    '  float color_type_rand = hash2(vec2(seed, 6.6));',
    '',
    '  float aspect = u_resolution.x / u_resolution.y;',
    '  float speed = 0.008 + speed_rand * 0.024;',
    '  float size = 0.0006 + 0.0032 * pow(size_rand, 3.8);',
    '',
    '  float y = -0.45 + y_rand * 0.9;',
    '',
    '  float margin = 0.05;',
    '  float width = aspect + margin * 2.0;',
    '  float x = fract(x_rand + u_time * speed);',
    '  x = x * width - (aspect * 0.5 + margin);',
    '',
    '  float wave = sin(u_time * 0.3 + y_rand * 6.283) * 0.005;',
    '',
    '  float ndc_x = x / (aspect * 0.5);',
    '  float ndc_y = (y + wave) / 0.5;',
    '',
    '  gl_Position = vec4(ndc_x, ndc_y, 0.0, 1.0);',
    '',
    '  // Point size in pixels. ',
    '  float pointSize = size * u_resolution.y * 3.5;',
    '  gl_PointSize = max(2.0, pointSize);',
    '',
    '  float blink = 0.3 + 0.7 * sin(u_time * (1.0 + blink_rand * 2.5) + x_rand * 6.283);',
    '  v_intensity_base = blink;',
    '  v_color_type = color_type_rand;',
    '}',
  ].join('\n');

  /* SoraBackground.tsx:67-87 —— 逐字照抄。 */
  var FRAGMENT_SHADER = [
    'precision mediump float;',
    'uniform vec3 u_particle_color;',
    'uniform vec3 u_particle_accent_color;',
    '',
    'varying float v_color_type;',
    'varying float v_intensity_base;',
    '',
    'void main() {',
    '  vec2 pc = gl_PointCoord - 0.5;',
    '  float dist = length(pc);',
    '',
    '  float alpha = smoothstep(0.5, 0.1, dist) * v_intensity_base;',
    '  if (alpha < 0.01) discard;',
    '',
    '  vec3 baseColor = v_color_type > 0.90 ? u_particle_accent_color : u_particle_color;',
    '',
    '  // Pre-multiplied alpha blending',
    '  gl_FragColor = vec4(baseColor * alpha, alpha);',
    '}',
  ].join('\n');

  /* ---- 颜色与亮度 ---- */

  function foliaSoraParseColor(value) {
    var text = String(value == null ? '' : value).trim();
    var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
    if (!m) return null;
    var hex = m[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  /* 主题背景亮度 > 0.6 视为浅色（本项目没有独立 isDaylight）。 */
  function foliaSoraIsDaylight(theme) {
    var channels = foliaSoraParseColor(theme && theme.backgroundColor);
    if (!channels) return false;
    var luma = (0.2126 * channels.r + 0.7152 * channels.g + 0.0722 * channels.b) / 255;
    return luma > 0.6;
  }

  /* ---- WebGL 装配 ---- */

  function foliaSoraCompile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('sora 着色器编译失败：' + (log || 'unknown'));
    }
    return shader;
  }

  function foliaSoraBuildProgram(gl) {
    var vs = foliaSoraCompile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    var fs = foliaSoraCompile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('sora 程序链接失败：' + (log || 'unknown'));
    }
    return program;
  }

  /* 渲染分辨率跟随画布 CSS 尺寸，像素比封顶 2（与 twgl.resizeCanvasToDisplaySize 的意图一致）。 */
  function foliaSoraResize(inst) {
    var ratio = Math.min(2, Math.max(1, (window.devicePixelRatio || 1)));
    var width = Math.max(1, Math.round(inst.canvas.clientWidth * ratio));
    var height = Math.max(1, Math.round(inst.canvas.clientHeight * ratio));
    if (inst.canvas.width === width && inst.canvas.height === height) return false;
    inst.canvas.width = width;
    inst.canvas.height = height;
    return true;
  }

  function foliaSoraApplyColors(inst, theme) {
    var primary = foliaSoraParseColor(theme && theme.primaryColor);
    var daylight = foliaSoraIsDaylight(theme);
    if (!primary) primary = daylight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    var accent = foliaSoraParseColor(theme && theme.accentColor) || primary;
    inst.particleColor = [primary.r / 255, primary.g / 255, primary.b / 255];
    inst.accentColor = [accent.r / 255, accent.g / 255, accent.b / 255];
    /* entry.tsx：浅色纯白、深色纯黑。 */
    inst.bgColor = daylight ? [1, 1, 1] : [0, 0, 0];
    inst.daylight = daylight;
  }

  /* ---- 背景实例 ---- */

  /* entry.tsx:17-23 的 blank 分支：blank=true 时**不挂 WebGL 画布**，
   * 只渲染一张纯色帧（夜间纯黑 / 日间纯白）——连上下文都不创建。 */
  function foliaSoraCreateBlankFrame(host, ctx) {
    var frame = document.createElement('div');
    frame.className = 'folia-bg-canvas';
    frame.setAttribute('data-folia-bg-blank', 'sora');
    host.appendChild(frame);

    var theme = (ctx && ctx.theme) || null;
    var inst = {
      canvas: frame,
      gl: null,
      blankFrame: true,
      daylight: foliaSoraIsDaylight(theme),
      theme: theme,
      destroyed: false,
    };
    frame.style.backgroundColor = inst.daylight ? '#ffffff' : '#000000';
    return inst;
  }

  function foliaSoraCreate(host, ctx) {
    if (foliaSoraTuning().blank) return foliaSoraCreateBlankFrame(host, ctx);

    var canvas = document.createElement('canvas');
    canvas.className = 'folia-bg-canvas';
    canvas.setAttribute('data-folia-bg-canvas', 'sora');
    host.appendChild(canvas);

    var gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: false, depth: false, antialias: false, premultipliedAlpha: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      }) || canvas.getContext('experimental-webgl');
    } catch (_) {
      gl = null;
    }
    if (!gl) {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      throw new Error('「空」背景需要 WebGL，当前环境不可用');
    }

    var program = foliaSoraBuildProgram(gl);
    var indices = new Float32Array(PARTICLE_COUNT);
    for (var i = 0; i < PARTICLE_COUNT; i += 1) indices[i] = i;
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    var inst = {
      canvas: canvas,
      gl: gl,
      program: program,
      buffer: buffer,
      loc: {
        aIndex: gl.getAttribLocation(program, 'a_index'),
        uResolution: gl.getUniformLocation(program, 'u_resolution'),
        uTime: gl.getUniformLocation(program, 'u_time'),
        uParticleColor: gl.getUniformLocation(program, 'u_particle_color'),
        uParticleAccentColor: gl.getUniformLocation(program, 'u_particle_accent_color'),
      },
      time: 0,
      /* 首帧只记基线（不把创建到首帧的墙钟差算进画面时间）；
       * 有 ctx.now 时直接当基线，第一帧就按真实 dt 前进。 */
      lastNow: (ctx && isFinite(ctx.now)) ? Number(ctx.now) : NaN,
      destroyed: false,
      drawCount: 0,
      particleCount: PARTICLE_COUNT,
      particleColor: [1, 1, 1],
      accentColor: [1, 1, 1],
      bgColor: [0, 0, 0],
      daylight: false,
      theme: null,
    };
    foliaSoraApplyColors(inst, ctx && ctx.theme);
    inst.theme = (ctx && ctx.theme) || null;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    foliaSoraResize(inst);
    return inst;
  }

  function foliaSoraTick(inst, ctx) {
    if (!inst || inst.destroyed) return;
    /* blank 帧：没有 WebGL，只跟主题昼夜同步纯色（Folia 的 blank 分支由 React 重渲染兜这个）。 */
    if (inst.blankFrame) {
      var themeB = (ctx && ctx.theme) || null;
      if (themeB !== inst.theme) {
        inst.theme = themeB;
        inst.daylight = foliaSoraIsDaylight(themeB);
        inst.canvas.style.backgroundColor = inst.daylight ? '#ffffff' : '#000000';
      }
      return;
    }
    var gl = inst.gl;
    if (gl.isContextLost && gl.isContextLost()) return;

    /* 主题变了只换颜色，不重建上下文（Folia 靠 ref 每帧覆盖，这里等价）。 */
    if (inst.theme !== (ctx && ctx.theme)) {
      inst.theme = (ctx && ctx.theme) || null;
      foliaSoraApplyColors(inst, inst.theme);
    }

    var now = (ctx && isFinite(ctx.now)) ? Number(ctx.now) : performance.now();
    if (isFinite(inst.lastNow) && !(ctx && ctx.paused)) {
      var delta = (now - inst.lastNow) / 1000;
      if (delta > 0 && delta < 1) inst.time += delta;
    }
    inst.lastNow = now;

    foliaSoraResize(inst);
    var width = inst.canvas.width;
    var height = inst.canvas.height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(inst.bgColor[0], inst.bgColor[1], inst.bgColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(inst.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
    if (inst.loc.aIndex >= 0) {
      gl.enableVertexAttribArray(inst.loc.aIndex);
      gl.vertexAttribPointer(inst.loc.aIndex, 1, gl.FLOAT, false, 0, 0);
    }
    if (inst.loc.uResolution) gl.uniform2f(inst.loc.uResolution, width, height);
    if (inst.loc.uTime) gl.uniform1f(inst.loc.uTime, inst.time);
    if (inst.loc.uParticleColor) {
      gl.uniform3f(inst.loc.uParticleColor, inst.particleColor[0], inst.particleColor[1], inst.particleColor[2]);
    }
    if (inst.loc.uParticleAccentColor) {
      gl.uniform3f(inst.loc.uParticleAccentColor, inst.accentColor[0], inst.accentColor[1], inst.accentColor[2]);
    }
    gl.drawArrays(gl.POINTS, 0, inst.particleCount);
    inst.drawCount += 1;
  }

  function foliaSoraDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    /* blank 帧没有 GL 上下文，只有一张 div 要摘。 */
    if (inst.blankFrame) {
      if (inst.canvas && inst.canvas.parentNode) inst.canvas.parentNode.removeChild(inst.canvas);
      return;
    }
    var gl = inst.gl;
    try {
      if (inst.buffer) gl.deleteBuffer(inst.buffer);
      if (inst.program) gl.deleteProgram(inst.program);
      var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (_) {}
    if (inst.canvas && inst.canvas.parentNode) inst.canvas.parentNode.removeChild(inst.canvas);
  }

  /* 名字 / 排序取 Folia 权威值：
   *   options.visualizerBackgroundModeSora = 空（zh-CN.ts:2087）
   *   sora/entry.tsx: order 50 / labelFallback 'Sora'
   * 描述是本项目补的（Folia 的背景没有 picker 描述）。 */
  registerFoliaBackground('sora', {
    name: '空',
    desc: '深空里缓慢横移的星点',
    order: 50,
    needsWebGL2: false,
    create: foliaSoraCreate,
    tick: foliaSoraTick,
    destroy: foliaSoraDestroy,
  });
})();
