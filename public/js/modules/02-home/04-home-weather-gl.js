// public/js/modules/02-home/04-home-weather-gl.js
// WebGL2 天气粒子引擎 — 替换 2D Canvas 天气效果
// 暴露 window.HomeWeatherGl，接口：supported / start / resize / stop
(function () {
  'use strict';

  // ---------- 常量 & 预设 ----------
  var RAIN_COLOR = [0.823, 0.894, 0.972];   // 210,228,248
  var SNOW_COLOR = [1.0, 1.0, 1.0];
  var BOLT_WARM = [1.0, 0.972, 0.823];      // 255,248,210

  var RAIN_COUNT = { light: 800, moderate: 1500, heavy: 3000 };
  var SNOW_COUNT = { light: 400, moderate: 700, heavy: 1200 };
  var MAX_SPLASH = 140;

  var FIELD_PRESETS = {
    fogLight:    { color: [0.845, 0.874, 0.914], alpha: 0.92, scale: 1.4,  contrast: [0.05, 0.55], speed: 0.028, density: 1.55, height: 1.2 },
    fogModerate: { color: [0.855, 0.882, 0.918], alpha: 0.98, scale: 1.55, contrast: [0.04, 0.5],  speed: 0.032, density: 2.1,  height: 1.4 },
    fogHeavy:    { color: [0.87, 0.894, 0.922],  alpha: 1.0,  scale: 1.7,  contrast: [0.02, 0.42], speed: 0.036, density: 3.0,  height: 1.6 },
    'partly-cloudy': { color: [0.75, 0.816, 0.894], alpha: 0.88, scale: 1.05, contrast: [0.24, 0.94], speed: 0.014, coverage: 0.48, density: 0.95 },
    overcast:        { color: [0.706, 0.75, 0.83],   alpha: 0.9,  scale: 0.95, contrast: [0.18, 0.9],  speed: 0.011, coverage: 0.78, density: 1.2 },
    haze:            { color: [0.72, 0.686, 0.643],  alpha: 0.72, scale: 1.15, contrast: [0.28, 0.94], speed: 0.016, coverage: 0.38, density: 0.68 },
    clear:           { color: [0.0, 0.0, 0.0], alpha: 0.0, scale: 1.0, contrast: [0.0, 1.0], speed: 0.0, exposure: 0.95 }
  };

  // 卡片之上薄雾/云粒子参数 — 飘过卡片表面，低 alpha 保证可读
  var FOG_ABOVE_COUNT = { light: 18, moderate: 24, heavy: 32 };
  var CLOUD_ABOVE_COUNT = { 'partly-cloudy': 14, 'overcast': 22, 'haze': 10 };

  // ---------- 模块状态 ----------
  var S = null; // 运行时状态对象

  function glsl(lines) { return lines.join('\n'); }

  // ---------- 着色器源 ----------
  var COMMON_NOISE = glsl([
    'float hash21(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0));',
    '  float d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0; float amp = 0.5;',
    '  for (int i = 0; i < 5; i++){',
    '    v += amp * vnoise(p);',
    '    p = p * 2.02 + 11.3;',
    '    amp *= 0.5;',
    '  }',
    '  return v;',
    '}'
  ]);

  // 雨
  var RAIN_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;',   // x:-0.5..0.5, y:0..1
    'layout(location=1) in vec2 iPos;',       // 归一化 0..1，y 向下
    'layout(location=2) in float iLen;',      // 长度（归一化 y）
    'layout(location=3) in float iWidth;',    // 像素宽
    'layout(location=4) in float iAngle;',
    'layout(location=5) in float iAlpha;',
    'layout(location=6) in float iDepth;',
    'uniform vec2 uRes;',
    'out vec2 vUv;',
    'out float vAlpha;',
    'out float vDepth;',
    'void main(){',
    '  float lenPx = iLen * uRes.y;',
    '  vec2 local = vec2(aCorner.x * iWidth, aCorner.y * lenPx);',
    '  float s = sin(iAngle); float c = cos(iAngle);',
    '  vec2 rot = vec2(local.x * c - local.y * s, local.x * s + local.y * c);',
    '  vec2 p = iPos * uRes + rot;',
    '  vec2 clip = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  vUv = vec2(aCorner.x * 2.0, aCorner.y);',
    '  vAlpha = iAlpha; vDepth = iDepth;',
    '}'
  ]);
  var RAIN_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; in float vAlpha; in float vDepth;',
    'uniform vec3 uColor;',
    'out vec4 fragColor;',
    'void main(){',
    '  float edge = 1.0 - abs(vUv.x);',
    '  float core = smoothstep(0.0, 0.55, edge);',
    '  float head = smoothstep(0.0, 0.22, vUv.y);',       // 顶端淡出
    '  float tail = smoothstep(0.0, 0.55, 1.0 - vUv.y);', // 尾端淡出
    '  float a = core * head * tail * vAlpha;',
    '  vec3 col = uColor * (0.75 + 0.25 * vDepth);',
    '  fragColor = vec4(col * a, a);',                     // 预乘 alpha
    '}'
  ]);

  // 雪 — 基于 CK42BB/procedural-weather-threejs 正弦飘动 + 翻滚 + 闪光
  var SNOW_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;',   // -0.5..0.5
    'layout(location=1) in vec2 iPos;',       // 归一化位置
    'layout(location=2) in float iSize;',    // 像素
    'layout(location=3) in float iRot;',
    'layout(location=4) in float iAlpha;',
    'layout(location=5) in float iDepth;',
    'layout(location=6) in float iFlutter;', // 飘动相位
    'uniform vec2 uRes; uniform float uTime;',
    'out vec2 vUv; out float vAlpha; out float vDepth; out float vSize;',
    'void main(){',
    '  float s = sin(iRot); float c = cos(iRot);',
    '  vec2 local = aCorner * iSize;',
    '  vec2 rot = vec2(local.x * c - local.y * s, local.x * s + local.y * c);',
    // CK42BB 正弦飘动：sin(t*(1.5+seed*2.0)+phase) * flutterAmp
    '  float flutter1 = sin(uTime * (1.5 + iDepth * 2.0) + iFlutter) * 0.015 * (0.5 + iDepth);',
    '  float flutter2 = cos(uTime * (1.0 + iDepth * 1.5) + iFlutter * 2.0) * 0.01 * (0.5 + iDepth);',
    '  vec2 pos = iPos + vec2(flutter1, flutter2 * 0.5);',
    '  vec2 p = pos * uRes + rot;',
    '  vec2 clip = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  vUv = aCorner * 2.0; vAlpha = iAlpha; vDepth = iDepth; vSize = iSize;',
    '}'
  ]);
  var SNOW_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; in float vAlpha; in float vDepth; in float vSize;',
    'uniform vec3 uColor;',
    'out vec4 fragColor;',
    'void main(){',
    '  float r = length(vUv);',
    // CK42BB 圆形软点 + 闪光
    '  float alpha = smoothstep(0.5, 0.2, r);',
    '  float sparkle = max(sin(r * 20.0 + vSize * 10.0) * 0.15, 0.0);',
    // 六角形纹理保留
    '  float ang = atan(vUv.y, vUv.x);',
    '  float hex = 0.5 + 0.5 * cos(ang * 6.0);',
    '  float core = smoothstep(0.95, 0.0, r) * (0.6 + 0.4 * hex);',
    '  float glow = exp(-r * r * mix(2.2, 4.5, vDepth));',
    '  float a = clamp(core * 0.7 + glow * 0.55 + sparkle * 0.3, 0.0, 1.0) * vAlpha;',
    '  vec3 col = uColor + vec3(sparkle * 0.05);',
    '  fragColor = vec4(col * a, a * 0.9);',
    '}'
  ]);

  // 溅射环
  var SPLASH_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;',
    'layout(location=1) in vec2 iPos;',
    'layout(location=2) in float iRadius;', // 像素
    'layout(location=3) in float iAlpha;',
    'uniform vec2 uRes;',
    'out vec2 vUv; out float vAlpha;',
    'void main(){',
    '  vec2 local = aCorner * iRadius * 2.0;',
    '  vec2 p = iPos * uRes + local;',
    '  vec2 clip = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  vUv = aCorner * 2.0; vAlpha = iAlpha;',
    '}'
  ]);
  var SPLASH_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; in float vAlpha;',
    'uniform vec3 uColor;',
    'out vec4 fragColor;',
    'void main(){',
    '  float r = length(vUv);',
    '  float ring = smoothstep(0.52, 0.44, r) * smoothstep(0.30, 0.44, r);',
    '  float a = ring * vAlpha;',
    '  fragColor = vec4(uColor * a, a);',
    '}'
  ]);

  // 雾/大气/晴天 全屏场顶点着色器
  var FIELD_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;', // -1..1
    'out vec2 vUv;',
    'void main(){',
    '  gl_Position = vec4(aCorner, 0.0, 1.0);',
    '  vUv = aCorner * 0.5 + 0.5;',
    '}'
  ]);

  // CGS-IITKGP fog-shader 噪声函数
  var FOG_NOISE = glsl([
    'float fogRandom(vec2 p){',
    '  return fract(sin(dot(p.xy,vec2(12.9898,78.233)))*43758.5453123);',
    '}',
    'float fogNoise(vec2 p){',
    '  vec2 i=floor(p); vec2 f=fract(p);',
    '  float a=fogRandom(i);',
    '  float b=fogRandom(i+vec2(1.,.0));',
    '  float c=fogRandom(i+vec2(0.,1.));',
    '  float d=fogRandom(i+vec2(1.,1.));',
    '  vec2 u=smoothstep(0.,1.,f);',
    '  return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;',
    '}',
    'float fogFbm(vec2 p){',
    '  float f=0.;',
    '  f+=.5*fogNoise(p); p*=3.0;',
    '  f+=.25*fogNoise(p); p*=3.0;',
    '  f+=.125*fogNoise(p);',
    '  return f;',
    '}'
  ]);

  // 体积雾着色器 — 基于 CGS-IITKGP/fog-shader Beer-Lambert + 高度密度
  var FOG_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uColor; uniform float uAlpha;',
    'uniform float uScale; uniform vec2 uContrast;',
    'uniform vec2 uWind;',
    'uniform float uDensity; uniform float uHeight;',
    FOG_NOISE,
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = vUv;',
    // 模拟距离：屏幕顶部=远，底部=近
    '  float dist = mix(0.4, 2.5, 1.0 - uv.y);',
    // CGS-IITKGP Beer-Lambert 透射 + 高度衰减
    '  float heightFactor = exp(-uv.y * uHeight);',
    '  float fogFactor = 1.0 - exp(-dist * uDensity * heightFactor);',
    // fBm 噪声湍流
    '  vec2 flow = uWind * uTime;',
    '  float n = fogFbm(uv * uScale * vec2(uRes.x / uRes.y, 1.0) + flow);',
    '  fogFactor *= clamp(mix(0.55, 1.0, n), 0.4, 1.0);',
    // 底部更浓
    '  float vfade = mix(1.0, 0.45, clamp(uv.y * 1.1, 0.0, 1.0));',
    '  float a = smoothstep(uContrast.x, uContrast.y, fogFactor) * vfade * uAlpha;',
    '  fragColor = vec4(uColor * a, a);',
    '}'
  ]);

  // 天空渐变着色器 — 基于 GeorgeKstr/Atmosphere-Simulation 简化为柔和日光渐变
  var SKY_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uSunDir; uniform float uExposure;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = vUv;',
    // 垂直渐变：顶部淡蓝→中部米白→底部微暖
    '  vec3 top    = vec3(0.56, 0.74, 0.94);',   // #8FBDEF 淡蓝
    '  vec3 middle = vec3(0.82, 0.86, 0.93);',   // #D1DCEE 浅灰白
    '  vec3 bottom = vec3(0.97, 0.88, 0.78);',   // #F7E0C6 暖米（底部地平线）
    '  float k = smoothstep(0.0, 1.0, uv.y);',
    '  vec3 grad = mix(bottom, top, k);',
    '  float midT = 1.0 - abs(k - 0.5) * 2.0;',
    '  grad = mix(grad, middle, midT * 0.35);',
    // 太阳方向投影（在天空某处的圆盘 + 辉光）
    '  vec3 rd = normalize(vec3((uv.x - 0.5) * 2.0 * 1.6, (uv.y - 0.5) * 2.0, 1.0));',
    '  float sunDot = max(0.0, dot(rd, normalize(uSunDir)));',
    '  float sunDisk = smoothstep(0.9993, 0.99985, sunDot) * 0.55;',
    '  float sunGlow = pow(sunDot, 48.0) * 0.35 + pow(sunDot, 12.0) * 0.15;',
    '  vec3 sunCol = vec3(1.0, 0.96, 0.82) * (sunDisk + sunGlow);',
    // 阳光染色：靠近太阳的天空偏暖
    '  float warmT = pow(max(0.0, dot(rd, normalize(uSunDir))), 6.0);',
    '  grad = mix(grad, vec3(0.98, 0.82, 0.60), warmT * 0.18);',
    // 曝光 + 最终 alpha（与背景叠加，透明度不高于0.8）
    '  vec3 color = (grad + sunCol) * uExposure;',
    '  float alpha = clamp(0.65 + 0.15 * k, 0.0, 0.8);',
    '  fragColor = vec4(color * alpha, alpha);',
    '}'
  ]);

  // 程序化云着色器 — 基于 CK42BB/procedural-clouds billboard 概念 + 3层云带分层
  var CLOUD_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uColor; uniform float uAlpha;',
    'uniform float uScale; uniform vec2 uWind;',
    'uniform float uCoverage; uniform float uDensity;',
    COMMON_NOISE,
    'float cloudFbm(vec2 p){',
    '  float v = 0.0; float amp = 0.5;',
    '  for (int i = 0; i < 6; i++){',
    '    v += amp * vnoise(p);',
    '    p = p * 2.03 + 11.3;',
    '    amp *= 0.5;',
    '  }',
    '  return v;',
    '}',
    // 单层云带：按 y 中心 + 高度带宽绘制一层
    'float cloudBand(vec2 uv, float yCenter, float bandHalf, vec2 flow, float scale){',
    '  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0) * scale + flow;',
    '  float n = cloudFbm(p);',
    // coverage 阈值降低，让更多区域显示云
    '  float c = smoothstep(uCoverage * 0.45, uCoverage * 0.45 + 0.38, n);',
    // 高度带宽衰减（y 方向高斯）
    '  float band = exp(-pow((uv.y - yCenter) / bandHalf, 2.0));',
    '  return c * band * uDensity;',
    '}',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 flow = uWind * uTime;',
    // 三层云带（高层+中层+低层），流速和高度不同
    '  float high = cloudBand(vUv, 0.18, 0.14, flow * 1.2, uScale * 0.95) * 0.55;',
    '  float mid  = cloudBand(vUv, 0.32, 0.18, flow * 0.85, uScale * 1.1) * 0.85;',
    '  float low  = cloudBand(vUv, 0.48, 0.22, flow * 0.55, uScale * 1.35) * 1.0;',
    '  float dens = high + mid + low;',
    // 顶部额外衰减（避免冲出屏幕）
    '  float topFade = smoothstep(0.0, 0.1, vUv.y);',
    '  dens *= mix(0.6, 1.0, topFade);',
    '  float a = clamp(dens * uAlpha, 0.0, 0.98);',
    // 光照：顶部亮，底部暗（模拟太阳光从上方）
    '  float lightTop = 1.0 - smoothstep(0.0, 1.0, vUv.y) * 0.35;',
    // 云芯更白，边缘稍亮半透明形成云边
    '  float edge = smoothstep(0.05, 0.3, a) * (1.0 - smoothstep(0.35, 0.75, a));',
    '  vec3 col = mix(uColor * 0.72, uColor * 1.18, lightTop);',
    '  col += vec3(1.0, 1.0, 1.0) * edge * 0.18;',
    '  fragColor = vec4(col * a, a);',
    '}'
  ]);

  // 旧版全屏场着色器（保留作为 fallback）
  var FIELD_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uColor; uniform float uAlpha;',
    'uniform float uScale; uniform vec2 uContrast;',
    'uniform vec2 uWind;',
    COMMON_NOISE,
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = vUv * vec2(uRes.x / uRes.y, 1.0) * uScale;',
    '  vec2 flow = uWind * uTime;',
    '  float n1 = fbm(uv * 1.4 + flow);',
    '  float n2 = fbm(uv * 2.7 - flow * 1.5 + 7.0);',
    '  float n3 = fbm(uv * 5.1 + flow * 0.6 + 19.0);',
    '  float dens = n1 * 0.55 + n2 * 0.32 + n3 * 0.13;',
    '  dens = smoothstep(uContrast.x, uContrast.y, dens);',
    '  float vfade = mix(1.0, 0.55, clamp(vUv.y * 1.1, 0.0, 1.0));',
    '  float a = dens * vfade * uAlpha;',
    '  fragColor = vec4(uColor * a, a);',
    '}'
  ]);

  // 闪电（CPU 生成几何 + shader 辉光）
  var BOLT_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aPos;',   // 归一化 0..1，y 向下
    'layout(location=1) in float aCross;',// -1..1
    'layout(location=2) in float aBright;',
    'out float vCross; out float vBright;',
    'void main(){',
    '  vec2 clip = vec2(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  vCross = aCross; vBright = aBright;',
    '}'
  ]);
  var BOLT_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in float vCross; in float vBright;',
    'uniform vec3 uWarm; uniform float uBoltAlpha;',
    'out vec4 fragColor;',
    'void main(){',
    '  float d = 1.0 - abs(vCross);',
    '  float core = smoothstep(0.0, 0.12, d);',
    '  float glow = pow(clamp(d, 0.0, 1.0), 2.6);',
    '  vec3 col = mix(uWarm, vec3(1.0), core);',
    '  float a = (glow * 0.5 + core) * vBright * uBoltAlpha;',
    '  fragColor = vec4(col * a, a);',
    '}'
  ]);

  // 全屏闪光
  var FLASH_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'uniform float uFlash;',
    'out vec4 fragColor;',
    'void main(){',
    '  fragColor = vec4(vec3(1.0) * uFlash * 0.6, uFlash * 0.32);',
    '}'
  ]);

  // 雾粒子着色器 — 基于 MirzaBeig/GPU-Fog-Particles 的无贴图雾团粒子思路
  // 每个实例是一团软粒子，多层噪声衰减形成体积感
  var FOG_PARTICLE_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;',   // -0.5..0.5
    'layout(location=1) in vec2 iPos;',       // 归一化位置
    'layout(location=2) in float iSize;',    // 像素半径
    'layout(location=3) in float iAlpha;',
    'layout(location=4) in float iPhase;',
    'uniform vec2 uRes; uniform float uTime;',
    'out vec2 vUv; out float vAlpha; out float vPhase;',
    'void main(){',
    '  vUv = aCorner * 2.0;',
    '  vec2 pos = iPos * uRes + aCorner * iSize;',
    '  vec2 clip = vec2(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  vAlpha = iAlpha; vPhase = iPhase;',
    '}'
  ]);
  var FOG_PARTICLE_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; in float vAlpha; in float vPhase;',
    'uniform vec3 uColor; uniform float uTime;',
    'uniform vec2 uWind;',
    COMMON_NOISE,
    'out vec4 fragColor;',
    'void main(){',
    '  float r = length(vUv);',
    '  if (r > 1.0) discard;',
    // 软粒子核 + 多层噪声形成云团内部纹理
    '  float core = smoothstep(1.0, 0.0, r);',
    '  vec2 nuv = vUv * 2.0 + uWind * uTime * 0.3 + vPhase;',
    '  float n = fbm(nuv);',
    '  float dens = core * (0.55 + 0.45 * n);',
    // 边缘羽化
    '  float edge = smoothstep(0.9, 0.5, r);',
    '  dens *= mix(0.3, 1.0, edge);',
    '  float a = clamp(dens * vAlpha, 0.0, 0.95);',
    '  fragColor = vec4(uColor * a, a);',
    '}'
  ]);

  // 云团粒子着色器 — 基于 CK42BB/procedural-clouds Mesh Cluster 软粒子球体
  // 每个实例是一个软云团，带光照和噪声纹理
  var CLOUD_PARTICLE_VS = glsl([
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aCorner;',
    'layout(location=1) in vec2 iPos;',
    'layout(location=2) in float iSize;',
    'layout(location=3) in float iAlpha;',
    'layout(location=4) in float iPhase;',
    'layout(location=5) in float iDepth;',
    'uniform vec2 uRes; uniform float uTime;',
    'out vec2 vUv; out float vAlpha; out float vPhase; out float vDepth;',
    'void main(){',
    '  vUv = aCorner * 2.0;',
    '  vec2 pos = iPos * uRes + aCorner * iSize;',
    '  vec2 clip = vec2(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  vAlpha = iAlpha; vPhase = iPhase; vDepth = iDepth;',
    '}'
  ]);
  var CLOUD_PARTICLE_FS = glsl([
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; in float vAlpha; in float vPhase; in float vDepth;',
    'uniform vec3 uColor; uniform float uTime;',
    'uniform vec2 uWind; uniform float uCoverage;',
    COMMON_NOISE,
    'out vec4 fragColor;',
    'void main(){',
    '  float r = length(vUv);',
    '  if (r > 1.0) discard;',
    // 软粒子核
    '  float core = smoothstep(1.0, 0.15, r);',
    // 多层噪声形成云团内部纹理
    '  vec2 nuv = vUv * 1.8 + uWind * uTime * 0.4 + vPhase;',
    '  float n1 = fbm(nuv);',
    '  float n2 = fbm(nuv * 2.2 - uWind * uTime * 0.2 + 7.0);',
    '  float dens = core * (0.5 + 0.4 * n1 + 0.1 * n2);',
    // coverage 控制云团厚度
    '  dens = smoothstep(1.0 - uCoverage, 1.0, dens);',
    // 光照：上方亮（模拟太阳），下方暗
    '  float lit = mix(0.7, 1.15, smoothstep(-0.3, 0.6, vUv.y));',
    // 边缘银边（silver lining）
    '  float edge = smoothstep(0.8, 0.4, r) * (1.0 - smoothstep(0.4, 0.0, r));',
    '  vec3 col = uColor * lit + vec3(1.0) * edge * 0.15;',
    '  float a = clamp(dens * vAlpha * (0.7 + 0.3 * vDepth), 0.0, 0.92);',
    '  fragColor = vec4(col * a, a);',
    '}'
  ]);

  // ---------- WebGL 辅助 ----------
  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      if (window.console) console.warn('[HomeWeatherGl] shader error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc, uniformNames) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (window.console) console.warn('[HomeWeatherGl] link error:', gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return null;
    }
    var u = {};
    for (var i = 0; i < uniformNames.length; i++) {
      u[uniformNames[i]] = gl.getUniformLocation(p, uniformNames[i]);
    }
    return { prog: p, u: u };
  }

  function staticBuffer(gl, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  function dynamicBuffer(gl, byteLength) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
    return b;
  }

  // ---------- 尺寸 / 渲染分辨率 ----------
  function heroEl() { return document.querySelector('.home-hero'); }

  function renderScale(w, h, hybrid) {
    var px = w * h;
    var scale = hybrid ? 0.78 : 0.88;
    if (px > 520000) scale = hybrid ? 0.68 : 0.78;
    else if (px > 360000) scale = hybrid ? 0.72 : 0.82;
    return {
      w: Math.max(1, Math.round(w * scale)),
      h: Math.max(1, Math.round(h * scale))
    };
  }

  function makeCanvas(hero, hybrid) {
    var canvas = document.createElement('canvas');
    canvas.className = 'home-weather-fx-canvas home-weather-gl-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // hybrid：置于玻璃雨滴之上；否则置于 hero 底部
    var glass = document.getElementById('home-weather-raindrop-canvas');
    if (hybrid && glass && glass.parentNode === hero) {
      hero.insertBefore(canvas, glass.nextSibling);
    } else {
      hero.insertBefore(canvas, hero.firstChild);
    }
    return canvas;
  }

  // 卡片之上薄雾/云层 — 2D canvas，挂在 hero 末尾（z-index 5），飘过卡片表面
  function createAboveCanvas(hero, layoutW, layoutH) {
    var canvas = document.createElement('canvas');
    canvas.className = 'home-weather-fx-canvas home-weather-gl-canvas-above';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.max(1, Math.round(layoutW));
    canvas.height = Math.max(1, Math.round(layoutH));
    canvas.style.width = layoutW + 'px';
    canvas.style.height = layoutH + 'px';
    hero.appendChild(canvas);
    S.aboveCanvas = canvas;
    S.aboveCtx = canvas.getContext('2d');
  }

  // ---------- 粒子模拟 ----------
  function rand(a, b) { return a + Math.random() * (b - a); }

  function initRain(intensity, hybrid, wind) {
    var base = RAIN_COUNT[intensity] || RAIN_COUNT.light;
    var count = Math.round(base * (hybrid ? 0.7 : 1));
    var speedBase = intensity === 'heavy' ? 0.95 : intensity === 'moderate' ? 0.72 : 0.55;
    var arr = [];
    for (var i = 0; i < count; i++) {
      arr.push(newRainDrop(speedBase, wind, true));
    }
    S.rain = arr;
    S.rainSpeedBase = speedBase;
    S.rainAlphaMul = intensity === 'heavy' ? 0.9 : intensity === 'moderate' ? 0.82 : 0.7;
    S.rainInst = new Float32Array(count * 7);
  }

  function newRainDrop(speedBase, wind, anywhere) {
    var depth = Math.random();
    var speed = speedBase * (0.5 + depth) * rand(0.9, 1.15);
    var drift = wind * 0.06 * (0.4 + depth);
    return {
      x: rand(-0.05, 1.05),
      y: anywhere ? rand(-0.2, 1.0) : rand(-0.25, -0.02),
      depth: depth,
      speed: speed,
      drift: drift,
      angle: Math.atan2(drift, speed),
      len: rand(0.02, 0.05) * (0.5 + depth),
      width: rand(0.9, 2.4) * (0.5 + depth)
    };
  }

  function initSnow(intensity, wind) {
    var count = SNOW_COUNT[intensity] || SNOW_COUNT.light;
    var speedBase = intensity === 'heavy' ? 0.1 : intensity === 'moderate' ? 0.08 : 0.06;
    var arr = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      arr.push({
        x: Math.random(),
        y: rand(-0.2, 1.0),
        depth: depth,
        speed: speedBase * (0.4 + depth) * rand(0.8, 1.25),
        drift: wind * 0.09,
        size: rand(2.0, 7.0) * (0.45 + depth),
        rot: rand(0, Math.PI * 2),
        rotSpeed: rand(-1.2, 1.2),
        sway: rand(0.4, 1.4),
        swayPhase: rand(0, Math.PI * 2),
        flutter: rand(0, Math.PI * 2),  // CK42BB 正弦飘动相位
        alpha: rand(0.55, 0.95) * (0.4 + depth * 0.6)
      });
    }
    S.snow = arr;
    S.snowInst = new Float32Array(count * 7);  // 增加 flutter (6→7)
  }

  // 雾粒子初始化 — 基于雾团粒子系统，飘动的雾团
  var FOG_PARTICLE_COUNT = { light: 64, moderate: 96, heavy: 140 };
  function initFogParticles(intensity, wind) {
    var count = FOG_PARTICLE_COUNT[intensity] || FOG_PARTICLE_COUNT.light;
    var sizeBase = intensity === 'heavy' ? 320 : intensity === 'moderate' ? 265 : 215;
    var alphaBase = intensity === 'heavy' ? 0.88 : intensity === 'moderate' ? 0.74 : 0.60;
    var arr = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      arr.push({
        x: rand(-0.15, 1.15),
        y: rand(0.05, 0.95),
        size: rand(sizeBase * 0.7, sizeBase * 1.3) * (0.7 + depth * 0.3),
        alpha: rand(alphaBase * 0.72, alphaBase) * (0.78 + depth * 0.22),
        phase: rand(0, 100),
        speedX: wind * 0.012 * (0.4 + depth),
        speedY: rand(-0.004, 0.004),
        wobble: rand(0.5, 1.5),
        wobblePhase: rand(0, Math.PI * 2)
      });
    }
    S.fogParticles = arr;
    S.fogParticleInst = new Float32Array(count * 5);
  }

  // 云团粒子初始化 — Mesh Cluster 软粒子球体
  var CLOUD_PARTICLE_COUNT = { 'partly-cloudy': 42, 'overcast': 64, 'haze': 30 };
  function initCloudParticles(preset, wind) {
    var count = CLOUD_PARTICLE_COUNT[preset] || 42;
    var sizeBase = preset === 'overcast' ? 330 : preset === 'haze' ? 270 : 300;
    var alphaBase = preset === 'overcast' ? 0.82 : preset === 'haze' ? 0.50 : 0.72;
    var arr = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      arr.push({
        x: rand(-0.2, 1.2),
        y: rand(0.08, 0.78),
        size: rand(sizeBase * 0.7, sizeBase * 1.35) * (0.65 + depth * 0.35),
        alpha: rand(alphaBase * 0.68, alphaBase) * (0.78 + depth * 0.22),
        phase: rand(0, 100),
        depth: depth,
        speedX: wind * 0.008 * (0.35 + depth),
        speedY: rand(-0.002, 0.002)
      });
    }
    S.cloudParticles = arr;
    S.cloudParticleInst = new Float32Array(count * 6);
  }

  // 卡片之上薄雾粒子 — 大尺寸、低 alpha、慢速飘过卡片表面
  function initFogAboveParticles(intensity, wind) {
    var count = FOG_ABOVE_COUNT[intensity] || FOG_ABOVE_COUNT.light;
    var sizeBase = intensity === 'heavy' ? 360 : intensity === 'moderate' ? 300 : 240;
    var alphaBase = intensity === 'heavy' ? 0.20 : intensity === 'moderate' ? 0.16 : 0.12;
    var arr = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      arr.push({
        x: rand(-0.2, 1.2),
        y: rand(0.05, 0.95),
        size: rand(sizeBase * 0.7, sizeBase * 1.3) * (0.6 + depth * 0.4),
        alpha: rand(alphaBase * 0.6, alphaBase) * (0.5 + depth * 0.5),
        speedX: wind * 0.008 * (0.3 + depth),
        speedY: rand(-0.002, 0.002),
        wobble: rand(0.3, 0.9),
        wobblePhase: rand(0, Math.PI * 2)
      });
    }
    S.aboveParticles = arr;
  }

  // 卡片之上薄云粒子 — 大尺寸、低 alpha、慢速飘过卡片表面
  function initCloudAboveParticles(preset, wind) {
    var count = CLOUD_ABOVE_COUNT[preset] || 8;
    var sizeBase = preset === 'overcast' ? 400 : preset === 'haze' ? 320 : 360;
    var alphaBase = preset === 'overcast' ? 0.24 : preset === 'haze' ? 0.14 : 0.20;
    var arr = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      arr.push({
        x: rand(-0.25, 1.25),
        y: rand(0.08, 0.82),
        size: rand(sizeBase * 0.7, sizeBase * 1.3) * (0.55 + depth * 0.45),
        alpha: rand(alphaBase * 0.55, alphaBase) * (0.5 + depth * 0.5),
        speedX: wind * 0.006 * (0.3 + depth),
        speedY: rand(-0.001, 0.001)
      });
    }
    S.aboveParticles = arr;
  }

  function updateAboveParticles(dt, t) {
    if (!S.aboveParticles) return;
    var a = S.aboveParticles, i, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      d.x += d.speedX * dt * 10;
      d.y += d.speedY * dt * 10;
      if (d.wobble !== undefined) {
        d.y += Math.sin(t * d.wobble + d.wobblePhase) * 0.0012;
      }
      if (d.x > 1.3) d.x = -0.3;
      else if (d.x < -0.3) d.x = 1.3;
      if (d.y > 1.05) d.y = -0.05;
      else if (d.y < -0.05) d.y = 1.05;
    }
  }

  // 卡片之上 2D canvas 渲染 — 柔边大粒子飘过卡片表面
  function renderAbove2d(t) {
    if (!S.aboveCanvas || !S.aboveParticles || S.aboveParticles.length === 0) return;
    var ctx = S.aboveCtx;
    if (!ctx) return;
    var w = S.aboveCanvas.width, h = S.aboveCanvas.height;
    ctx.clearRect(0, 0, w, h);
    var color = S.fieldPreset.color;
    var r = Math.round(color[0] * 255), g = Math.round(color[1] * 255), b = Math.round(color[2] * 255);
    ctx.globalCompositeOperation = 'source-over';
    for (var i = 0; i < S.aboveParticles.length; i++) {
      var p = S.aboveParticles[i];
      var x = p.x * w, y = p.y * h;
      var size = p.size;
      var grad = ctx.createRadialGradient(x, y, 0, x, y, size);
      grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + p.alpha + ')');
      grad.addColorStop(0.45, 'rgba(' + r + ',' + g + ',' + b + ',' + (p.alpha * 0.45) + ')');
      grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateRain(dt) {
    var a = S.rain, i, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      d.y += d.speed * dt;
      d.x += d.drift * dt;
      if (d.y > 1.0) {
        // 溅射
        if (d.depth > 0.5 && S.splash.length < MAX_SPLASH && Math.random() < 0.5) {
          S.splash.push({
            x: d.x,
            y: rand(0.9, 0.97),
            life: 0,
            maxLife: rand(0.28, 0.5),
            depth: d.depth
          });
        }
        var nd = newRainDrop(S.rainSpeedBase, S.wind, false);
        d.x = nd.x; d.y = nd.y; d.depth = nd.depth;
        d.speed = nd.speed; d.drift = nd.drift; d.angle = nd.angle;
        d.len = nd.len; d.width = nd.width;
      }
      if (d.x > 1.1) d.x -= 1.2;
      else if (d.x < -0.1) d.x += 1.2;
    }
  }

  function updateSplash(dt) {
    var a = S.splash, i = 0;
    while (i < a.length) {
      a[i].life += dt;
      if (a[i].life >= a[i].maxLife) { a.splice(i, 1); }
      else i++;
    }
  }

  function updateSnow(dt, t) {
    var a = S.snow, i, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      d.y += d.speed * dt;
      d.rot += d.rotSpeed * dt;
      var swayX = Math.sin(t * d.sway + d.swayPhase) * 0.02 * d.depth;
      d.x += (d.drift * dt) + swayX * dt;
      if (d.y > 1.05) {
        d.y = rand(-0.15, -0.02);
        d.x = Math.random();
      }
      if (d.x > 1.1) d.x -= 1.2;
      else if (d.x < -0.1) d.x += 1.2;
    }
  }

  // ---------- 闪电 ----------
  function scheduleBolt(t) {
    S.nextBolt = t + rand(3.0, 8.0);
  }

  function fireBolt() {
    // CK42BB 递归中点位移分形闪电
    var verts = [];
    var startX = rand(0.2, 0.8);
    var endX = startX + rand(-0.15, 0.15);
    var endY = rand(0.85, 1.0);
    // generations=5, jitter=0.08（归一化空间）
    buildBolt(verts, startX, 0.0, endX, endY, 5, 0.08, 1.0);
    S.boltVerts = new Float32Array(verts);
    S.boltCount = verts.length / 4;
    S.boltLife = 0;
    S.boltMaxLife = rand(0.16, 0.3);
    S.flash = 1.0;
  }

  // CK42BB 递归中点位移：generations 代细分，中点 lerp(0.4~0.6) + 垂直扰动
  function buildBolt(verts, x1, y1, x2, y2, generations, jitter, bright) {
    if (generations <= 0) {
      pushSeg(verts, x1, y1, x2, y2, bright);
      return;
    }
    // 中点 = lerp(0.4~0.6) + 随机扰动
    var t = 0.4 + Math.random() * 0.2;
    var midX = x1 + (x2 - x1) * t + rand(-jitter, jitter);
    var midY = y1 + (y2 - y1) * t + rand(-jitter * 0.3, jitter * 0.3);
    // 递归左右两段，jitter 衰减 0.6
    buildBolt(verts, x1, y1, midX, midY, generations - 1, jitter * 0.6, bright);
    buildBolt(verts, midX, midY, x2, y2, generations - 1, jitter * 0.6, bright);
    // 30% 概率分支（generations > 2 时）
    if (Math.random() < 0.3 && generations > 2) {
      var branchEndX = midX + rand(-jitter * 2, jitter * 2);
      var branchEndY = midY + rand(0.05, 0.15);
      buildBolt(verts, midX, midY, branchEndX, branchEndY, generations - 2, jitter * 0.4, bright * 0.55);
    }
  }

  function pushSeg(verts, x1, y1, x2, y2, bright) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1e-4;
    // 垂直方向，归一化空间的宽度（含辉光）
    var w = 0.012;
    var nx = -dy / len * w;
    var ny = dx / len * w;
    // 两个三角形，cross ∈ {-1,1}
    verts.push(x1 - nx, y1 - ny, -1, bright);
    verts.push(x1 + nx, y1 + ny, 1, bright);
    verts.push(x2 + nx, y2 + ny, 1, bright);
    verts.push(x1 - nx, y1 - ny, -1, bright);
    verts.push(x2 + nx, y2 + ny, 1, bright);
    verts.push(x2 - nx, y2 - ny, -1, bright);
  }

  function updateStorm(dt, t) {
    updateRain(dt);
    updateSplash(dt);
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 5.0);
    if (S.boltLife >= 0) {
      S.boltLife += dt;
      // 闪烁：随机复燃
      if (S.boltLife < S.boltMaxLife && Math.random() < 0.08) S.flash = Math.max(S.flash, 0.7);
      if (S.boltLife >= S.boltMaxLife) { S.boltLife = -1; S.boltCount = 0; }
    }
    if (t >= S.nextBolt) {
      fireBolt();
      scheduleBolt(t);
    }
  }

  function updateFogParticles(dt, t) {
    var a = S.fogParticles, i, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      d.x += d.speedX * dt * 10;
      d.y += d.speedY * dt * 10 + Math.sin(t * d.wobble + d.wobblePhase) * 0.0015;
      if (d.x > 1.2) d.x = -0.2;
      else if (d.x < -0.2) d.x = 1.2;
      if (d.y > 1.0) d.y = 0.0;
      else if (d.y < 0.0) d.y = 1.0;
    }
  }

  function updateCloudParticles(dt, t) {
    var a = S.cloudParticles, i, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      d.x += d.speedX * dt * 8;
      d.y += d.speedY * dt * 8;
      if (d.x > 1.3) d.x = -0.3;
      else if (d.x < -0.3) d.x = 1.3;
    }
  }

  // ---------- 填充 instance 数据 ----------
  function fillRain() {
    var a = S.rain, buf = S.rainInst, i, o = 0, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      buf[o] = d.x; buf[o + 1] = d.y;
      buf[o + 2] = d.len; buf[o + 3] = d.width;
      buf[o + 4] = d.angle;
      buf[o + 5] = (0.25 + d.depth * 0.6) * S.rainAlphaMul;
      buf[o + 6] = d.depth;
      o += 7;
    }
    return a.length;
  }

  function fillSnow() {
    var a = S.snow, buf = S.snowInst, i, o = 0, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      buf[o] = d.x; buf[o + 1] = d.y;
      buf[o + 2] = d.size; buf[o + 3] = d.rot;
      buf[o + 4] = d.alpha; buf[o + 5] = d.depth;
      buf[o + 6] = d.flutter;  // CK42BB 飘动相位
      o += 7;
    }
    return a.length;
  }

  function fillFogParticles() {
    var a = S.fogParticles, buf = S.fogParticleInst, i, o = 0, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      buf[o] = d.x; buf[o + 1] = d.y;
      buf[o + 2] = d.size; buf[o + 3] = d.alpha;
      buf[o + 4] = d.phase;
      o += 5;
    }
    return a.length;
  }

  function fillCloudParticles() {
    var a = S.cloudParticles, buf = S.cloudParticleInst, i, o = 0, d;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      buf[o] = d.x; buf[o + 1] = d.y;
      buf[o + 2] = d.size; buf[o + 3] = d.alpha;
      buf[o + 4] = d.phase; buf[o + 5] = d.depth;
      o += 6;
    }
    return a.length;
  }

  function fillSplash() {
    var a = S.splash, i, o = 0, d, f;
    if (!S.splashInst || S.splashInst.length < a.length * 4) {
      S.splashInst = new Float32Array(MAX_SPLASH * 4);
    }
    var buf = S.splashInst;
    for (i = 0; i < a.length; i++) {
      d = a[i];
      f = d.life / d.maxLife;
      buf[o] = d.x; buf[o + 1] = d.y;
      buf[o + 2] = (3.0 + 20.0 * f) * (0.5 + d.depth);
      buf[o + 3] = (1.0 - f) * 0.55;
      o += 4;
    }
    return a.length;
  }

  // ---------- VAO 构建 ----------
  function setupRainVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.rainQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.rainInstBuf);
    var stride = 28;
    var specs = [[1, 2, 0], [2, 1, 8], [3, 1, 12], [4, 1, 16], [5, 1, 20], [6, 1, 24]];
    for (var i = 0; i < specs.length; i++) {
      gl.enableVertexAttribArray(specs[i][0]);
      gl.vertexAttribPointer(specs[i][0], specs[i][1], gl.FLOAT, false, stride, specs[i][2]);
      gl.vertexAttribDivisor(specs[i][0], 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  function setupSnowVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.centeredQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.snowInstBuf);
    var stride = 28;  // 7 * 4 字节
    var specs = [[1, 2, 0], [2, 1, 8], [3, 1, 12], [4, 1, 16], [5, 1, 20], [6, 1, 24]];
    for (var i = 0; i < specs.length; i++) {
      gl.enableVertexAttribArray(specs[i][0]);
      gl.vertexAttribPointer(specs[i][0], specs[i][1], gl.FLOAT, false, stride, specs[i][2]);
      gl.vertexAttribDivisor(specs[i][0], 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  function setupFogParticleVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.centeredQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.fogParticleBuf);
    var stride = 20;  // 5 * 4
    var specs = [[1, 2, 0], [2, 1, 8], [3, 1, 12], [4, 1, 16]];
    for (var i = 0; i < specs.length; i++) {
      gl.enableVertexAttribArray(specs[i][0]);
      gl.vertexAttribPointer(specs[i][0], specs[i][1], gl.FLOAT, false, stride, specs[i][2]);
      gl.vertexAttribDivisor(specs[i][0], 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  function setupCloudParticleVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.centeredQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.cloudParticleBuf);
    var stride = 24;  // 6 * 4
    var specs = [[1, 2, 0], [2, 1, 8], [3, 1, 12], [4, 1, 16], [5, 1, 20]];
    for (var i = 0; i < specs.length; i++) {
      gl.enableVertexAttribArray(specs[i][0]);
      gl.vertexAttribPointer(specs[i][0], specs[i][1], gl.FLOAT, false, stride, specs[i][2]);
      gl.vertexAttribDivisor(specs[i][0], 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  function setupSplashVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.centeredQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.splashInstBuf);
    var stride = 16;
    var specs = [[1, 2, 0], [2, 1, 8], [3, 1, 12]];
    for (var i = 0; i < specs.length; i++) {
      gl.enableVertexAttribArray(specs[i][0]);
      gl.vertexAttribPointer(specs[i][0], specs[i][1], gl.FLOAT, false, stride, specs[i][2]);
      gl.vertexAttribDivisor(specs[i][0], 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  function setupFullscreenVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.fullQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  function setupBoltVAO(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.boltBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  // ---------- 渲染 ----------
  function drawRain(gl) {
    var n = fillRain();
    gl.bindBuffer(gl.ARRAY_BUFFER, S.rainInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.rainInst.subarray(0, n * 7));
    var pr = S.progRain;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform3fv(pr.u.uColor, RAIN_COLOR);
    gl.bindVertexArray(S.rainVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  function drawSplash(gl) {
    if (!S.splash.length) return;
    var n = fillSplash();
    gl.bindBuffer(gl.ARRAY_BUFFER, S.splashInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.splashInst.subarray(0, n * 4));
    var pr = S.progSplash;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform3fv(pr.u.uColor, RAIN_COLOR);
    gl.bindVertexArray(S.splashVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  function drawSnow(gl, t) {
    var n = fillSnow();
    gl.bindBuffer(gl.ARRAY_BUFFER, S.snowInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.snowInst.subarray(0, n * 7));
    var pr = S.progSnow;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uColor, SNOW_COLOR);
    gl.bindVertexArray(S.snowVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  function drawField(gl, t) {
    var p = S.fieldPreset;
    var pr = S.progField;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uColor, p.color);
    gl.uniform1f(pr.u.uAlpha, p.alpha);
    gl.uniform1f(pr.u.uScale, p.scale);
    gl.uniform2f(pr.u.uContrast, p.contrast[0], p.contrast[1]);
    gl.uniform2f(pr.u.uWind, S.wind * p.speed, p.speed * 0.4);
    gl.bindVertexArray(S.fullVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  function drawFog(gl, t) {
    var p = S.fieldPreset;
    // 底层全屏雾（保留作为基础雾色）
    var pr = S.progFog;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uColor, p.color);
    gl.uniform1f(pr.u.uAlpha, p.alpha * 0.78);  // 底层浓雾，让磨砂卡片磨到真雾
    gl.uniform1f(pr.u.uScale, p.scale);
    gl.uniform2f(pr.u.uContrast, p.contrast[0], p.contrast[1]);
    gl.uniform2f(pr.u.uWind, S.wind * p.speed, p.speed * 0.4);
    gl.uniform1f(pr.u.uDensity, p.density || 0.7);
    gl.uniform1f(pr.u.uHeight, p.height || 1.5);
    gl.bindVertexArray(S.fullVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    // 上层雾团粒子（视觉主导，像雨一样直接飘动）
    drawFogParticles(gl, t);
  }

  function drawFogParticles(gl, t) {
    if (!S.fogParticles || S.fogParticles.length === 0) return;
    var n = fillFogParticles();
    gl.bindBuffer(gl.ARRAY_BUFFER, S.fogParticleBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.fogParticleInst.subarray(0, n * 5));
    var p = S.fieldPreset;
    var pr = S.progFogParticle;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uColor, p.color);
    gl.uniform2f(pr.u.uWind, S.wind * p.speed, p.speed * 0.4);
    gl.bindVertexArray(S.fogParticleVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  function drawSky(gl, t) {
    var p = S.fieldPreset;
    var pr = S.progSky;
    // 根据时间或天气数据计算太阳方向
    var sunAngle = (t * 0.05) % (Math.PI * 2);
    var sunDir = [Math.sin(sunAngle) * 0.5, Math.cos(sunAngle) * 0.3 + 0.4, Math.cos(sunAngle) * 0.8];
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uSunDir, sunDir);
    gl.uniform1f(pr.u.uExposure, p.exposure || 1.0);
    gl.bindVertexArray(S.fullVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  function drawClouds(gl, t) {
    var p = S.fieldPreset;
    // 底层全屏云（保留作为背景天色）
    var pr = S.progCloud;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uColor, p.color);
    gl.uniform1f(pr.u.uAlpha, p.alpha * 0.68);  // 底层浓云，让磨砂卡片磨到真云
    gl.uniform1f(pr.u.uScale, p.scale);
    gl.uniform2f(pr.u.uWind, S.wind * p.speed, p.speed * 0.4);
    gl.uniform1f(pr.u.uCoverage, p.coverage || 0.42);
    gl.uniform1f(pr.u.uDensity, p.density || 0.55);
    gl.bindVertexArray(S.fullVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    // 上层云团粒子（视觉主导，像雨一样直接飘过）
    drawCloudParticles(gl, t);
  }

  function drawCloudParticles(gl, t) {
    if (!S.cloudParticles || S.cloudParticles.length === 0) return;
    var n = fillCloudParticles();
    gl.bindBuffer(gl.ARRAY_BUFFER, S.cloudParticleBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.cloudParticleInst.subarray(0, n * 6));
    var p = S.fieldPreset;
    var pr = S.progCloudParticle;
    gl.useProgram(pr.prog);
    gl.uniform2f(pr.u.uRes, S.renderW, S.renderH);
    gl.uniform1f(pr.u.uTime, t);
    gl.uniform3fv(pr.u.uColor, p.color);
    gl.uniform2f(pr.u.uWind, S.wind * p.speed, p.speed * 0.4);
    gl.uniform1f(pr.u.uCoverage, p.coverage || 0.42);
    gl.bindVertexArray(S.cloudParticleVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  function drawFlash(gl) {
    if (S.flash <= 0) return;
    var pr = S.progFlash;
    gl.useProgram(pr.prog);
    gl.uniform1f(pr.u.uFlash, S.flash);
    gl.bindVertexArray(S.fullVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  function drawBolt(gl) {
    if (!S.boltCount || S.boltLife < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, S.boltBuf);
    // 复用/扩容
    if (!S.boltBufSize || S.boltVerts.byteLength > S.boltBufSize) {
      S.boltBufSize = S.boltVerts.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, S.boltVerts, gl.DYNAMIC_DRAW);
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.boltVerts);
    }
    var fade = 1.0 - (S.boltLife / S.boltMaxLife);
    var pr = S.progBolt;
    gl.useProgram(pr.prog);
    gl.uniform3fv(pr.u.uWarm, BOLT_WARM);
    gl.uniform1f(pr.u.uBoltAlpha, Math.max(0, fade) * 0.92);
    gl.bindVertexArray(S.boltVAO);
    gl.drawArrays(gl.TRIANGLES, 0, S.boltCount);
    gl.bindVertexArray(null);
  }

  function update(dt, t) {
    switch (S.type) {
      case 'rain': updateRain(dt); updateSplash(dt); break;
      case 'snow': updateSnow(dt, t); break;
      case 'storm': updateStorm(dt, t); break;
      case 'fog': updateFogParticles(dt, t); updateAboveParticles(dt, t); break;
      case 'atmo': updateCloudParticles(dt, t); updateAboveParticles(dt, t); break;
    }
  }

  function render(t) {
    var gl = S.gl;
    gl.viewport(0, 0, S.renderW, S.renderH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    switch (S.type) {
      case 'rain': drawRain(gl); drawSplash(gl); break;
      case 'snow': drawSnow(gl, t); break;
      case 'fog': drawFog(gl, t); break;
      case 'atmo': drawClouds(gl, t); break;
      case 'clear': drawSky(gl, t); break;
      case 'storm':
        drawFlash(gl);
        drawRain(gl);
        drawSplash(gl);
        drawBolt(gl);
        break;
    }
  }

  function frame(now) {
    if (!S || !S.running) return;
    if (document.hidden) { // 后台/最小化：挂起渲染，dt 钳制保证恢复无跳变
      S.raf = window.requestAnimationFrame(frame);
      return;
    }
    var t = now * 0.001;
    var dt = t - S.lastTime;
    if (!(dt > 0) || dt > 0.05) dt = 0.016;
    S.lastTime = t;
    update(dt, t);
    render(t);
    renderAbove2d(t);
    S.raf = window.requestAnimationFrame(frame);
  }

  // ---------- 生命周期 ----------
  function detectSupport() {
    try {
      var c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch (e) {
      return false;
    }
  }

  function buildPrograms(gl) {
    S.progRain = program(gl, RAIN_VS, RAIN_FS, ['uRes', 'uColor']);
    S.progSnow = program(gl, SNOW_VS, SNOW_FS, ['uRes', 'uTime', 'uColor']);
    S.progSplash = program(gl, SPLASH_VS, SPLASH_FS, ['uRes', 'uColor']);
    S.progField = program(gl, FIELD_VS, FIELD_FS, ['uRes', 'uTime', 'uColor', 'uAlpha', 'uScale', 'uContrast', 'uWind']);
    S.progFog = program(gl, FIELD_VS, FOG_FS, ['uRes', 'uTime', 'uColor', 'uAlpha', 'uScale', 'uContrast', 'uWind', 'uDensity', 'uHeight']);
    S.progSky = program(gl, FIELD_VS, SKY_FS, ['uRes', 'uTime', 'uSunDir', 'uExposure']);
    S.progCloud = program(gl, FIELD_VS, CLOUD_FS, ['uRes', 'uTime', 'uColor', 'uAlpha', 'uScale', 'uWind', 'uCoverage', 'uDensity']);
    S.progBolt = program(gl, BOLT_VS, BOLT_FS, ['uWarm', 'uBoltAlpha']);
    S.progFlash = program(gl, FIELD_VS, FLASH_FS, ['uFlash']);
    // 雾团粒子 + 云团粒子程序
    S.progFogParticle = program(gl, FOG_PARTICLE_VS, FOG_PARTICLE_FS, ['uRes', 'uTime', 'uColor', 'uWind']);
    S.progCloudParticle = program(gl, CLOUD_PARTICLE_VS, CLOUD_PARTICLE_FS, ['uRes', 'uTime', 'uColor', 'uWind', 'uCoverage']);
    return S.progRain && S.progSnow && S.progSplash && S.progField && S.progFog && S.progSky && S.progCloud && S.progBolt && S.progFlash && S.progFogParticle && S.progCloudParticle;
  }

  function buildBuffers(gl) {
    S.rainQuad = staticBuffer(gl, new Float32Array([
      -0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1
    ]));
    S.centeredQuad = staticBuffer(gl, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5
    ]));
    S.fullQuad = staticBuffer(gl, new Float32Array([
      -1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1
    ]));
    S.rainInstBuf = dynamicBuffer(gl, RAIN_COUNT.heavy * 7 * 4);
    S.snowInstBuf = dynamicBuffer(gl, SNOW_COUNT.heavy * 7 * 4);
    S.splashInstBuf = dynamicBuffer(gl, MAX_SPLASH * 4 * 4);
    S.fogParticleBuf = dynamicBuffer(gl, FOG_PARTICLE_COUNT.heavy * 5 * 4);
    S.cloudParticleBuf = dynamicBuffer(gl, CLOUD_PARTICLE_COUNT.overcast * 6 * 4);  // 最大云团数 = overcast
    S.boltBuf = gl.createBuffer();
    S.boltBufSize = 0;
  }

  function start(type, intensity, opts) {
    opts = opts || {};
    if (!detectSupport()) return false;
    var hero = heroEl();
    if (!hero) return false;

    stop();

    var hybrid = !!opts.hybrid;
    var weather = opts.weather || {};
    var layoutW = Math.max(1, Math.round(hero.clientWidth || 800));
    var layoutH = Math.max(1, Math.round(hero.clientHeight || 400));
    var r = renderScale(layoutW, layoutH, hybrid);

    var canvas = makeCanvas(hero, hybrid);
    canvas.width = r.w;
    canvas.height = r.h;
    canvas.style.width = layoutW + 'px';
    canvas.style.height = layoutH + 'px';

    var gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    });
    if (!gl) {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return false;
    }

    // 风：magnitude 用于倾斜/漂移
    var windSpeed = Number(weather.windSpeed);
    var wind = Number.isFinite(windSpeed) ? Math.max(-3, Math.min(3, windSpeed / 10)) : 0.5;

    S = {
      gl: gl, canvas: canvas, hero: hero,
      type: type, intensity: intensity, hybrid: hybrid,
      weather: weather, wind: wind,
      layoutW: layoutW, layoutH: layoutH, renderW: r.w, renderH: r.h,
      running: false, raf: 0, lastTime: 0,
      rain: [], snow: [], splash: [], splashInst: null,
      flash: 0, boltCount: 0, boltLife: -1, boltMaxLife: 0, nextBolt: 0,
      boltVerts: new Float32Array(0)
    };

    if (!buildPrograms(gl)) { stop(); return false; }
    buildBuffers(gl);

    S.rainVAO = setupRainVAO(gl);
    S.snowVAO = setupSnowVAO(gl);
    S.splashVAO = setupSplashVAO(gl);
    S.fullVAO = setupFullscreenVAO(gl);
    S.boltVAO = setupBoltVAO(gl);
    S.fogParticleVAO = setupFogParticleVAO(gl);
    S.cloudParticleVAO = setupCloudParticleVAO(gl);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 预乘 alpha

    // 类型初始化
    if (type === 'rain') {
      initRain(intensity, hybrid, wind);
    } else if (type === 'snow') {
      initSnow(intensity, wind);
    } else if (type === 'storm') {
      initRain('heavy', hybrid, wind);
      scheduleBolt(0.5);
    } else if (type === 'fog') {
      var key = 'fog' + (intensity === 'heavy' ? 'Heavy' : intensity === 'moderate' ? 'Moderate' : 'Light');
      S.fieldPreset = FIELD_PRESETS[key];
      initFogParticles(intensity, wind);
      // 卡片之上薄雾层 — 飘过卡片表面，像雨一样直接可见
      initFogAboveParticles(intensity, wind);
      createAboveCanvas(hero, layoutW, layoutH);
    } else if (type === 'atmo') {
      var preset = opts.preset || 'overcast';
      S.fieldPreset = FIELD_PRESETS[preset] || FIELD_PRESETS.overcast;
      initCloudParticles(preset, wind);
      // 卡片之上薄云层 — 飘过卡片表面，像雨一样直接可见
      initCloudAboveParticles(preset, wind);
      createAboveCanvas(hero, layoutW, layoutH);
    } else if (type === 'clear') {
      S.fieldPreset = FIELD_PRESETS.clear;
    } else {
      stop();
      return false;
    }

    S.running = true;
    S.lastTime = 0;
    S.raf = window.requestAnimationFrame(frame);
    return true;
  }

  function resize() {
    if (!S || !S.gl) return;
    var hero = S.hero || heroEl();
    if (!hero) return;
    var layoutW = Math.max(1, Math.round(hero.clientWidth || S.layoutW));
    var layoutH = Math.max(1, Math.round(hero.clientHeight || S.layoutH));
    if (layoutW === S.layoutW && layoutH === S.layoutH) return;
    var r = renderScale(layoutW, layoutH, S.hybrid);
    S.layoutW = layoutW; S.layoutH = layoutH;
    S.renderW = r.w; S.renderH = r.h;
    S.canvas.width = r.w;
    S.canvas.height = r.h;
    S.canvas.style.width = layoutW + 'px';
    S.canvas.style.height = layoutH + 'px';
    // 同步卡片之上薄层 canvas
    if (S.aboveCanvas) {
      S.aboveCanvas.width = layoutW;
      S.aboveCanvas.height = layoutH;
      S.aboveCanvas.style.width = layoutW + 'px';
      S.aboveCanvas.style.height = layoutH + 'px';
    }
  }

  function stop() {
    if (!S) return;
    S.running = false;
    if (S.raf) window.cancelAnimationFrame(S.raf);
    var gl = S.gl;
    if (gl) {
      try {
        // 释放 GL 资源
        [S.rainVAO, S.snowVAO, S.splashVAO, S.fullVAO, S.boltVAO, S.fogParticleVAO, S.cloudParticleVAO].forEach(function (v) {
          if (v) gl.deleteVertexArray(v);
        });
        [S.rainQuad, S.centeredQuad, S.fullQuad, S.rainInstBuf, S.snowInstBuf, S.splashInstBuf, S.boltBuf, S.fogParticleBuf, S.cloudParticleBuf].forEach(function (b) {
          if (b) gl.deleteBuffer(b);
        });
        [S.progRain, S.progSnow, S.progSplash, S.progField, S.progFog, S.progSky, S.progCloud, S.progBolt, S.progFlash, S.progFogParticle, S.progCloudParticle].forEach(function (p) {
          if (p && p.prog) gl.deleteProgram(p.prog);
        });
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e) {}
    }
    if (S.canvas && S.canvas.parentNode) S.canvas.parentNode.removeChild(S.canvas);
    if (S.aboveCanvas && S.aboveCanvas.parentNode) S.aboveCanvas.parentNode.removeChild(S.aboveCanvas);
    S = null;
  }

  window.HomeWeatherGl = {
    supported: detectSupport,
    active: function () { return !!(S && S.running); },
    start: start,
    resize: resize,
    stop: stop
  };
})();
