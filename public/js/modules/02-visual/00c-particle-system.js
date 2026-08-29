var PLANE_SIZE = 4.8;
var RIPPLE_MAX = 12;

var GRID_X = coverParticleGridForResolution(fx.coverResolution), GRID_Y = GRID_X;
var PCOUNT = GRID_X * GRID_Y;
var positions = null, uvs = null, aRand = null;
var coverResolutionReloadTimer = null;
var currentCoverSource = null;
var coverPickerCanvas = null;

function buildCoverParticleGeometry(grid) {
  grid = coverParticleGridForResolution(grid / 118);
  var count = grid * grid;
  var rawPositions = new Float32Array(count * 3);
  var rawUvs = new Float32Array(count * 2);
  var rawRand = new Float32Array(count);
  var texelStep = 1 / grid;
  for (var i = 0; i < count; i++) {
    var gx = i % grid, gy = Math.floor(i / grid);
    var u = (gx + 0.5) * texelStep, v = (gy + 0.5) * texelStep;
    var px = gx / (grid - 1), py = gy / (grid - 1);
    rawPositions[i*3]   = (px - 0.5) * PLANE_SIZE;
    rawPositions[i*3+1] = (py - 0.5) * PLANE_SIZE;
    rawPositions[i*3+2] = 0;
    rawUvs[i*2]   = u;
    rawUvs[i*2+1] = v;
    rawRand[i]   = Math.random();
  }
  // P1.5：棋盘奇偶分区，前半 even / 后半 odd，便于 setDrawRange 真减提交顶点
  var evenCount = 0;
  for (var ei = 0; ei < count; ei++) {
    var egx = ei % grid, egy = Math.floor(ei / grid);
    if (((egx + egy) & 1) === 0) evenCount++;
  }
  var nextPositions = new Float32Array(count * 3);
  var nextUvs = new Float32Array(count * 2);
  var nextRand = new Float32Array(count);
  var evenWrite = 0;
  var oddWrite = evenCount;
  for (var pi = 0; pi < count; pi++) {
    var pgx = pi % grid, pgy = Math.floor(pi / grid);
    var dst = (((pgx + pgy) & 1) === 0) ? evenWrite++ : oddWrite++;
    nextPositions[dst * 3] = rawPositions[pi * 3];
    nextPositions[dst * 3 + 1] = rawPositions[pi * 3 + 1];
    nextPositions[dst * 3 + 2] = rawPositions[pi * 3 + 2];
    nextUvs[dst * 2] = rawUvs[pi * 2];
    nextUvs[dst * 2 + 1] = rawUvs[pi * 2 + 1];
    nextRand[dst] = rawRand[pi];
  }
  var nextGeo = new THREE.BufferGeometry();
  nextGeo.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
  nextGeo.setAttribute('aUv',      new THREE.BufferAttribute(nextUvs, 2));
  nextGeo.setAttribute('aRand',    new THREE.BufferAttribute(nextRand, 1));
  nextGeo.userData.grid = grid;
  nextGeo.userData.count = count;
  nextGeo.userData.evenCount = evenCount;
  nextGeo.userData.oddCount = count - evenCount;
  nextGeo.userData.parityPartition = true;
  nextGeo.setDrawRange(0, count);
  positions = nextPositions;
  uvs = nextUvs;
  aRand = nextRand;
  return nextGeo;
}

function applyCoverParticleTemporalDrawRange(wantSubset, parity) {
  if (!geo || !geo.userData || !geo.userData.parityPartition) {
    if (geo) geo.setDrawRange(0, PCOUNT);
    return false;
  }
  if (!wantSubset) {
    geo.setDrawRange(0, PCOUNT);
    return false;
  }
  var evenCount = geo.userData.evenCount | 0;
  var oddCount = geo.userData.oddCount | 0;
  if (parity > 0.5) geo.setDrawRange(evenCount, oddCount);
  else geo.setDrawRange(0, evenCount);
  return true;
}

var geo = buildCoverParticleGeometry(GRID_X);

function applyCoverParticleResolution(value, opts) {
  opts = opts || {};
  fx.coverResolution = normalizeCoverResolution(value);
  var grid = coverParticleGridForResolution(fx.coverResolution);
  if (grid === GRID_X && geo && geo.userData && geo.userData.grid === grid) return;
  var oldGeo = geo;
  var nextGeo = buildCoverParticleGeometry(grid);
  geo = nextGeo;
  GRID_X = GRID_Y = grid;
  PCOUNT = grid * grid;
  if (particles) particles.geometry = nextGeo;
  if (bloomParticles) bloomParticles.geometry = nextGeo;
  if (oldGeo && oldGeo !== nextGeo) oldGeo.dispose();
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.18);
  if (opts.reload !== false) scheduleCoverResolutionReload();
}

function scheduleCoverResolutionReload() {
  if (!currentCoverSource || !currentCoverSource.src) return;
  if (coverResolutionReloadTimer) clearTimeout(coverResolutionReloadTimer);
  coverResolutionReloadTimer = setTimeout(function(){
    coverResolutionReloadTimer = null;
    if (!currentCoverSource || !currentCoverSource.src) return;
    if (currentCoverSource.kind === 'url') {
      loadCoverFromUrl(currentCoverSource.src, { trackToken: trackSwitchToken, fromResolutionChange: true });
    } else if (currentCoverSource.kind === 'data') {
      applyCoverDataUrl(currentCoverSource.src, { trackToken: trackSwitchToken, fromResolutionChange: true });
    }
  }, 260);
}

// 涟漪数据纹理 (1×N, RGBA: x, y, age, str)
var rippleData = new Float32Array(RIPPLE_MAX * 4);
var rippleTex  = new THREE.DataTexture(rippleData, 1, RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType);
rippleTex.magFilter = THREE.NearestFilter; rippleTex.minFilter = THREE.NearestFilter;
var ripples = [];
for (var ri = 0; ri < RIPPLE_MAX; ri++) ripples.push({ x:0, y:0, age:-10, str:0 });

// 封面纹理 + 边缘/深度纹理
var coverTex = new THREE.Texture();
coverTex.minFilter = THREE.LinearFilter; coverTex.magFilter = THREE.LinearFilter;
coverTex.wrapS = THREE.ClampToEdgeWrapping; coverTex.wrapT = THREE.ClampToEdgeWrapping;

var coverEdgeTex = new THREE.Texture();  // R=depth, G=edge, B=fg-mask, A=lum
coverEdgeTex.minFilter = THREE.LinearFilter; coverEdgeTex.magFilter = THREE.LinearFilter;

// 初始 1×1 像素
(function(){
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0,0,4,4);
  coverTex.image = c; coverTex.needsUpdate = true;
  var d = document.createElement('canvas'); d.width = d.height = 4;
  var dx = d.getContext('2d'); dx.fillStyle = 'rgba(128,0,0,255)'; dx.fillRect(0,0,4,4);
  coverEdgeTex.image = d; coverEdgeTex.needsUpdate = true;
})();

// 前一首封面纹理 (用于切歌渐变)
var prevCoverTex = new THREE.Texture();
prevCoverTex.minFilter = THREE.LinearFilter; prevCoverTex.magFilter = THREE.LinearFilter;
(function(){
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0,0,4,4);
  prevCoverTex.image = c; prevCoverTex.needsUpdate = true;
})();

// ============================================================
//  FFT 频谱纹理 (Spectrum Texture Architecture)
//  抄自 GitHub 高星音频可视化引擎的核心架构：
//   analyser 1024-bin 线性频谱 → 256-texel 对数频谱纹理 → GPU 采样
//  每个粒子按自身径向位置绑定专属频段（内圈=bass，外圈=treble），
//  整个吸积盘按旋律分层律动，而非整体统一脉冲。
//  JS 侧做 attack/release 时间平滑（快起慢落），GPU 只负责双线性采样。
//  纹理数据不经主循环的 wallpaperAudio 压制——preset 5/8/9 下
//  uBass/uMid/uTreble 被减法压制时，频谱纹理仍保留真实频段能量。
// ============================================================
var SPECTRUM_TEX_BINS = 256;
var spectrumSmooth = new Float32Array(SPECTRUM_TEX_BINS);
var spectrumTexData = new Uint8Array(SPECTRUM_TEX_BINS * 4);
var spectrumTexture = new THREE.DataTexture(spectrumTexData, SPECTRUM_TEX_BINS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
spectrumTexture.minFilter = THREE.LinearFilter;
spectrumTexture.magFilter = THREE.LinearFilter;
spectrumTexture.wrapS = THREE.ClampToEdgeWrapping;
spectrumTexture.generateMipmaps = false;
spectrumTexture.needsUpdate = true;

// texel → 源 bin 映射（对数频率轴：每个八度占等宽 texel，高频不被稀释）
var spectrumBinLo = new Uint16Array(SPECTRUM_TEX_BINS);
var spectrumBinHi = new Uint16Array(SPECTRUM_TEX_BINS);
var spectrumMapSrcLen = 0;
function buildSpectrumBinMap(srcLen) {
  var minBin = 1;
  var maxBin = Math.max(minBin + 8, Math.floor(srcLen * 0.68)); // ~15kHz 截断，顶部空段不浪费 texel
  var ratio = maxBin / minBin;
  for (var i = 0; i < SPECTRUM_TEX_BINS; i++) {
    var f0 = i / SPECTRUM_TEX_BINS;
    var f1 = (i + 1) / SPECTRUM_TEX_BINS;
    var lo = Math.floor(minBin * Math.pow(ratio, f0));
    var hi = Math.max(lo + 1, Math.floor(minBin * Math.pow(ratio, f1)));
    spectrumBinLo[i] = Math.min(lo, srcLen - 1);
    spectrumBinHi[i] = Math.min(hi, srcLen);
  }
  spectrumMapSrcLen = srcLen;
}

// 每帧调用：读 frequencyData（全局，可能被 08-audio-graph-controls 重分配），
// 平滑后写入 256×1 纹理。暂停时自然衰减归零。
function updateParticleSpectrumTexture(dt) {
  var src = frequencyData;
  var srcLen = src ? src.length : 0;
  if (srcLen < 16) return;
  if (srcLen !== spectrumMapSrcLen) buildSpectrumBinMap(srcLen);
  var live = (typeof playing !== 'undefined') && playing && audio && !audio.paused;
  // attack 快(~0.62/帧@60fps)、release 慢(~0.13/帧@60fps)，帧率无关化
  var kf = Math.max(0.05, Math.min(0.9, (dt || 0.016) * 60));
  var attackK = 1 - Math.pow(1 - 0.62, kf);
  var releaseK = 1 - Math.pow(1 - 0.13, kf);
  var spectrumTexChanged = false;
  for (var i = 0; i < SPECTRUM_TEX_BINS; i++) {
    var x = 0;
    if (live) {
      var lo = spectrumBinLo[i], hi = spectrumBinHi[i];
      var peak = 0; // 取区间峰值而非均值：高频窄带不被稀释
      for (var b = lo; b < hi; b++) { var v = src[b]; if (v > peak) peak = v; }
      x = Math.pow(peak / 255, 0.72); // gamma 补偿高频能量
    }
    var prev = spectrumSmooth[i];
    spectrumSmooth[i] = prev + (x - prev) * (x > prev ? attackK : releaseK);
    var b8 = Math.round(spectrumSmooth[i] * 255);
    var o = i * 4;
    if (spectrumTexData[o] !== b8) {
      spectrumTexData[o] = b8; spectrumTexData[o + 1] = b8; spectrumTexData[o + 2] = b8;
      spectrumTexChanged = true;
    }
    spectrumTexData[o + 3] = 255;
  }
  // 衰减归零/静音后数据不再变化，跳过每帧纹理上传（首帧上传由 DataTexture 构造保证）
  if (spectrumTexChanged) spectrumTexture.needsUpdate = true;
}

var uniforms = {
  uTime:       { value: 0 },
  uBass:       { value: 0 },
  uMid:        { value: 0 },
  uTreble:     { value: 0 },
  uBeat:       { value: 0 },
  uEnergy:     { value: 0 },
  uBurstAmt:   { value: 0 },          // 通用预设切换脉冲 0..1
  uVinylSpin:  { value: 0 },
  uPreset:     { value: 0 },
  uIntensity:  { value: 0.85 },
  uDepth:      { value: 1.0 },
  uPointScale: { value: 1.0 },
  uSpeed:      { value: 1.0 },
  uTwist:      { value: 0 },
  uColorBoost: { value: 1.1 },
  uScatter:    { value: 0 },
  uCoverRes:   { value: 1.0 },
  uBgFade:     { value: 0.20 },
  uBloomStrength:{ value: 0.62 },
  uBloomSize:  { value: 2.65 },
  uTintColor:  { value: new THREE.Color('#9db8cf') },
  uTintStrength:{ value: 0 },
  uCoverTex:   { value: coverTex },
  uPrevCoverTex:{ value: prevCoverTex },
  uColorMixT:  { value: 1.0 },        // 0=显示旧封面 → 1=显示新封面
  uEdgeTex:    { value: coverEdgeTex },
  uRippleTex:  { value: rippleTex },
  uRippleCount:{ value: 0 },
  uDotTex:     { value: dotTexture },
  uHasCover:   { value: 0 },
  uHasDepth:   { value: 0 },
  uEdgeEnabled:{ value: 1 },
  uAiBoost:    { value: 0 },          // AI 深度增益, 当 AI 接管时升至 1
  uMouseXY:    { value: new THREE.Vector2(-999, -999) },
  uMouseActive:{ value: 0 },
  uHandXY:     { value: new THREE.Vector2(-999, -999) },
  uHandActive: { value: 0 },
  uGestureGrip:{ value: 0 },
  uPixel:      { value: renderer.getPixelRatio() },
  uAlpha:      { value: 0 },          // 整体粒子透明度 (启动 fade-in)
  uParticleDim:{ value: 1 },          // 覆盖层打开时只压低粒子背景, 不影响 3D 卡片
  uParticleDensity:{ value: 1 },      // 粒子密度 0.3..1.0, 低于阈值的粒子被裁剪
  uTemporalSubset:{ value: 0 },       // P0/P1.5: 隔帧子集时抬点径；真裁剪靠 drawRange
  uFrameParity:{ value: 0 },          // 0/1 交替
  uUseDrawRange:{ value: 0 },         // P1.5: 1=已用 drawRange，shader 不再 discard
  uFloatAlpha: { value: 0 },          // 空场/浮空粒子透明度
  uLoading:    { value: 0 },          // 加载动画混合度 0..1 (1 = 完全聚成圆环)
  uFreqTex:    { value: spectrumTexture },  // FFT 对数频谱纹理 (256×1)
  uAccretion:  { value: 0.35 },             // 黑洞长时标吸积水平 0..1（响=喂食，静=蒸发）
  uJetStrength:{ value: 0 },                // 黑洞喷流强度（包络能量驱动：暂停→0 消失，响=粗）
};
installRenderPowerHooks();
applyRendererPowerMode();

// ----- 顶点 Shader -----
//   v7.1: 律动幅度 ×2.5, Tunnel 自旋, 虚空预设, 切歌颜色渐变
var vs = `
precision highp float;
uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uBurstAmt;
uniform float uPreset, uIntensity, uDepth, uPointScale, uSpeed, uTwist;
uniform float uVinylSpin;
uniform float uColorBoost, uScatter, uCoverRes, uBgFade;
uniform float uHasCover, uHasDepth, uEdgeEnabled, uAiBoost;
uniform float uMouseActive, uPixel, uColorMixT, uLoading;
uniform float uParticleDensity;
uniform float uTemporalSubset, uFrameParity, uUseDrawRange;
uniform sampler2D uCoverTex, uPrevCoverTex, uEdgeTex, uRippleTex;
uniform sampler2D uFreqTex;   // FFT 频谱纹理：x=对数频率轴 (0=bass → 1=treble)
uniform float uAccretion;     // 黑洞长时标吸积水平 0..1（响=喂食，静=蒸发）
uniform float uJetStrength;   // 黑洞喷流强度（包络能量驱动：暂停→0 消失，响=粗）
uniform int uRippleCount;
uniform vec2 uMouseXY, uHandXY;
uniform float uHandActive, uGestureGrip;
uniform vec3 uTintColor;
uniform float uTintStrength;
attribute vec2 aUv;
attribute float aRand;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

#define PI 3.14159265359

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 perm(vec4 x){return mod289v(((x*34.0)+1.0)*x);}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=perm(perm(perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

// 频谱纹理采样：x∈[0,1] 对数频率轴能量（0=bass, 1=treble），双线性平滑
float specAt(float x) {
  return texture2D(uFreqTex, vec2(clamp(x, 0.0, 1.0) * 0.92 + 0.03, 0.5)).r;
}

vec2 safeCoverUv(vec2 uv) {
  return clamp(uv, vec2(0.0012), vec2(0.9988));
}

vec3 sampleNewCoverColor(vec2 uv) {
  return texture2D(uCoverTex, safeCoverUv(uv)).rgb;
}

vec3 samplePrevCoverColor(vec2 uv) {
  return texture2D(uPrevCoverTex, safeCoverUv(uv)).rgb;
}

vec4 sampleEdgeColor(vec2 uv) {
  return texture2D(uEdgeTex, safeCoverUv(uv));
}

float rippleSumAt(vec2 p, out float maxAmp) {
  float sum = 0.0; maxAmp = 0.0;
  for (int ri = 0; ri < 12; ri++) {
    if (ri >= uRippleCount) break;
    float vCoord = (float(ri) + 0.5) / 12.0;
    vec4 rd = texture2D(uRippleTex, vec2(0.5, vCoord));
    float age = rd.z; float str = rd.w;
    if (str < 0.005 || age < 0.0 || age > 2.0) continue;
    float dx = p.x - rd.x, dy = p.y - rd.y;
    float dist = sqrt(dx*dx + dy*dy);
    float lifeN = age / 2.0;
    float fadeIn  = smoothstep(0.0, 0.06, age);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeN);
    float env = fadeIn * fadeOut;
    // v7.1: 把幅度放大 — 中心凸起更高更宽
    float bulgeW = 0.55 + age * 0.80;
    float bulge  = exp(-dist*dist / (2.0 * bulgeW * bulgeW)) * (1.0 - smoothstep(0.0, 0.55, lifeN));
    float waveR  = age * 2.10;
    float ringW  = 0.40 + age * 0.22;
    float ring   = exp(-pow((dist - waveR) / ringW, 2.0));
    // v7.1: 提升整体幅度 ×2
    float local  = (bulge * 2.4 + ring * 1.30) * env * str;
    sum += local;
    maxAmp = max(maxAmp, abs(local));
  }
  return sum;
}

vec3 getCoverColor(vec2 uv) {
  return mix(samplePrevCoverColor(uv), sampleNewCoverColor(uv), clamp(uColorMixT, 0.0, 1.0));
}

void applyTransitionBurst(inout vec3 pos, inout float alpha, inout float maxAmp, float transition, float aRand, float timeSpeed) {
  if (transition <= 0.001) return;
  float bloom = smoothstep(0.0, 1.0, transition);
  vec2 burstVec = pos.xy + vec2(hash11(aRand * 31.0) - 0.5, hash11(aRand * 47.0) - 0.5) * 0.75;
  vec2 burstDir = burstVec / max(length(burstVec), 0.001);
  pos.xy += burstDir * bloom * 0.026;
  pos.xy += vec2(snoise(vec3(aRand, timeSpeed * 0.014, 1.0)), snoise(vec3(aRand, timeSpeed * 0.014, 5.0))) * bloom * 0.06;
  pos.xy *= 1.0 + bloom * 0.014;
  pos.z += (hash11(aRand * 123.0) - 0.5) * bloom * 0.18;
  alpha *= 0.86 + bloom * 0.22;
  maxAmp = max(maxAmp, bloom * 0.10);
}

void main(){
  if (aRand > uParticleDensity) {
    gl_Position = vec4(0.0, 0.0, -9999.0, 1.0);
    return;
  }
  // P0 兜底：无 drawRange 时仍在 VS 里丢一半；P1.5 有 drawRange 则跳过（少跑半量重 VS）
  if (uTemporalSubset > 0.5 && uUseDrawRange < 0.5) {
    float bit = step(0.5, hash11(aRand * 917.0 + aUv.x * 31.0 + aUv.y * 17.0));
    if (abs(bit - uFrameParity) > 0.25) {
      gl_Position = vec4(0.0, 0.0, -9999.0, 1.0);
      return;
    }
  }
  float t = uTime * uSpeed;
  vec3 pos;
  vec2 sampleUv = safeCoverUv(aUv);
  // 切歌颜色渐变: 在新旧封面间 mix
  vec3 coverColor = getCoverColor(sampleUv);
  vec4 edge = sampleEdgeColor(sampleUv);
  float depthVal = edge.r;
  float edgeVal  = edge.g;
  float fgMask   = edge.b;
  float lumVal   = edge.a;
  float maxRippleAmp = 0.0;
  float rippleZ = 0.0;

  vec3 defaultColor = mix(
    vec3(0.36, 0.28, 0.72),
    mix(vec3(0.85, 0.55, 0.95), vec3(0.45, 0.78, 0.95), aUv.x),
    aUv.y
  );
  vColor = mix(defaultColor, coverColor, uHasCover);
  vAlpha = 1.0;

  // 律动强度的真实倍数 (放大 intensity 滑块的影响)
  float K = uIntensity * 1.6;   // 滑块 1.0 → K=1.6, 滑块 1.6 → K=2.56

  // ====================================================
  //  Preset 0: SILK — 丝绸 (xy 平面, z 涟漪)
  //  v7.1: 全部位移 ×2.5
  // ====================================================
  if (uPreset < 0.5) {
    pos = position;
    rippleZ = rippleSumAt(pos.xy, maxRippleAmp);

    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * K;       // 0.20 → 0.55

    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;  // 0.06→0.18
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.42 * K;          // 0.14→0.42

    // AI 深度: 显著强化 (0.85 → 1.4)
    float depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth;

    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath + depthZ;
  }

  // ====================================================
  //  Preset 1: TUNNEL — 隧道 + 自旋
  // ====================================================
  else if (uPreset < 1.5) {
    // v7.1: 整体自旋 — 整管缓慢绕 Z 轴
    float spin = t * 0.12;
    float angle = aUv.x * 2.0 * PI + spin;
    float flow = aUv.y - t * 0.08 * (1.0 + uBass * 0.55);
    flow = fract(flow);
    float zPos = (flow - 0.5) * 9.0;
    float baseR = 2.0 - uBass * 0.28 * K;                  // bass 收缩更明显
    float ripG  = sin(angle * 5.0 + zPos * 1.4 + t * 2.2) * 0.10 * (uMid + uTreble) * K;   // 0.04→0.10
    float r = baseR + ripG;
    pos.x = cos(angle) * r;
    pos.y = sin(angle) * r;
    pos.z = zPos;

    sampleUv = vec2(aUv.x, flow);
    sampleUv = safeCoverUv(sampleUv);
    coverColor = getCoverColor(sampleUv);
    vColor = mix(defaultColor, coverColor, uHasCover);

    float depthFade = smoothstep(-4.5, 4.5, zPos);
    vColor *= 0.4 + depthFade * 0.7;
  }

  // ====================================================
  //  Preset 2: ORBIT — 星球 (保留自转)
  //  v7.1: 律动幅度加大
  // ====================================================
  else if (uPreset < 2.5) {
    float theta = aUv.x * 2.0 * PI;
    float phi   = (aUv.y - 0.5) * PI;
    float baseR = 2.2;
    float trebFlare = snoise(vec3(theta * 1.5, phi * 1.5, t * 0.7)) * uTreble * 0.85 * K;   // 0.40→0.85
    float bassExpand = uBass * 0.35 * K;                                                      // 0.18→0.35
    float r = baseR * (1.0 + bassExpand) + trebFlare;

    pos.x = r * cos(phi) * cos(theta);
    pos.y = r * sin(phi);
    pos.z = r * cos(phi) * sin(theta);

    float yaw = t * 0.18;
    float cy = cos(yaw), sy = sin(yaw);
    pos.xz = mat2(cy, -sy, sy, cy) * pos.xz;
  }

  // ====================================================
  //  Preset 3: VOID — 虚空 (无粒子, 适合自定义背景)
  // ====================================================
  else if (uPreset < 3.5) {
    pos = vec3((aUv.x - 0.5) * 0.01, (aUv.y - 0.5) * 0.01, -90.0);
    vAlpha = 0.0;
    vColor = vec3(0.0);
    maxRippleAmp = 0.0;
  }

  // ====================================================
  //  Preset 4: VINYL RECORD
  //  A real record layout: circular album cover in the center, black vinyl
  //  grooves outside, and a complete white particle rim.
  // ====================================================
  else if (uPreset < 4.5) {
    float bassDrive = smoothstep(0.08, 0.78, uBass + uBeat * 0.82);
    float highDrive = smoothstep(0.05, 0.46, uTreble);
    float hiResGuard = smoothstep(1.08, 1.55, uCoverRes);
    float edgeGuard = mix(1.0, 0.38, hiResGuard);
    float depthGuard = mix(1.0, 0.44, hiResGuard);
    float grooveGuard = mix(1.0, 0.48, hiResGuard);
    float beatGuard = mix(1.0, 0.36, hiResGuard);

    vec2 p = (aUv - 0.5) * 5.12;
    float spin = uVinylSpin;
    float cs = cos(spin), sn = sin(spin);
    vec2 rp = mat2(cs, -sn, sn, cs) * p;
    float d = length(p);
    float angle0 = atan(p.y, p.x);
    float recordR = 2.46;
    float coverR = 1.18;
    float recordAlpha = 1.0 - smoothstep(recordR - 0.02, recordR + 0.05, d);
    float coverMask = 1.0 - smoothstep(coverR - 0.012, coverR + 0.018, d);
    float border = exp(-pow((d - coverR) / 0.064, 2.0)) * edgeGuard;
    float outerRim = exp(-pow((d - (recordR - 0.050)) / 0.055, 2.0)) * edgeGuard;
    float vinylN = clamp((d - coverR) / max(0.001, recordR - coverR), 0.0, 1.0);

    pos = vec3(rp * (1.0 + bassDrive * 0.012 * beatGuard + uBeat * 0.026 * beatGuard), 0.0);
    vAlpha = recordAlpha;

    if (coverMask > 0.02) {
      vec2 coverUv = p / (coverR * 2.0) + 0.5;
      coverColor = getCoverColor(coverUv);
      if (hiResGuard > 0.001) {
        vec2 sx = vec2(0.0026, 0.0);
        vec2 sy = vec2(0.0, 0.0026);
        vec3 softNew = (sampleNewCoverColor(coverUv + sx) + sampleNewCoverColor(coverUv - sx) + sampleNewCoverColor(coverUv + sy) + sampleNewCoverColor(coverUv - sy)) * 0.25;
        vec3 softPrev = (samplePrevCoverColor(coverUv + sx) + samplePrevCoverColor(coverUv - sx) + samplePrevCoverColor(coverUv + sy) + samplePrevCoverColor(coverUv - sy)) * 0.25;
        coverColor = mix(coverColor, mix(softPrev, softNew, clamp(uColorMixT, 0.0, 1.0)), hiResGuard * 0.42);
      }
      vColor = mix(defaultColor, coverColor, uHasCover);
      float coverShade = 1.02 + 0.10 * (1.0 - smoothstep(0.0, coverR, d));
      vColor *= coverShade;
      vColor = mix(vColor, vec3(1.0), border * 0.54);
      pos.z = 0.040 + border * 0.026 * depthGuard + uBeat * 0.018 * beatGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.30 + bassDrive * 0.075 * beatGuard + uBeat * 0.075 * beatGuard);
    } else {
      float groove = 0.5 + 0.5 * sin((d - coverR) * mix(98.0, 58.0, hiResGuard));
      float fineGroove = 0.5 + 0.5 * sin((d - coverR) * mix(170.0, 92.0, hiResGuard) + aRand * 3.0);
      float tick = smoothstep(0.82, 0.995, hash11(floor((angle0 + PI) * 38.0) + floor(d * 72.0) * 2.1));
      vec3 vinyl = vec3(0.052, 0.054, 0.058) + vec3(0.052 * grooveGuard) * groove + vec3(0.026 * grooveGuard) * fineGroove;
      vinyl = mix(vinyl, coverColor * 0.32, 0.18 * (1.0 - vinylN));
      float whiteRing = max(border * 0.92, outerRim * 0.26);
      vColor = mix(vinyl, vec3(0.92, 0.94, 0.94), whiteRing);
      vColor = mix(vColor, vec3(1.0), tick * highDrive * (0.06 + border * 0.12) * grooveGuard);
      pos.z = groove * 0.010 * grooveGuard + border * 0.024 * depthGuard + bassDrive * vinylN * 0.016 * K * beatGuard + tick * highDrive * 0.010 * grooveGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.32 + outerRim * 0.12 + bassDrive * vinylN * 0.11 * beatGuard + tick * highDrive * 0.10 * grooveGuard + uBeat * vinylN * 0.08 * beatGuard);
    }
  }

  // ====================================================
  //  Preset 5: WALLPAPER PULSE
  //  Layered music-particle wallpaper: aurora ribbons, depth sparks,
  //  and cover-colored audio flow.
  // ====================================================
  else if (uPreset < 5.5) {
    float bassGlow = smoothstep(0.07, 0.78, uBass) * 0.34 + uBeat * 0.014;
    float midGlow = smoothstep(0.07, 0.62, uMid) * 0.42;
    float highGlow = smoothstep(0.04, 0.46, uTreble) * 0.46;
    float lane = aUv.y;
    float transition = clamp(uBurstAmt, 0.0, 1.0);

    if (lane < 0.80) {
      float laneWarp = snoise(vec3(aUv.x * 0.42, lane * 1.7, t * 0.026)) * 0.11 + (hash11(aRand * 73.1) - 0.5) * 0.045;
      float warpedLane = clamp(lane + laneWarp, 0.0, 0.80);
      float bandCoord = warpedLane / 0.80 * 5.65 + snoise(vec3(aUv.x * 0.82, lane * 2.25, t * 0.032)) * 0.62;
      float band = floor(bandCoord);
      float local = fract(bandCoord + hash11(band * 9.13 + aRand * 2.4) * 0.18);
      float bandN = clamp((band + 0.5) / 5.65, 0.0, 1.0);
      float seed = hash11(band * 19.17 + aRand * 31.0);
      float flow = fract(aUv.x + t * (0.0034 + bandN * 0.0038 + seed * 0.0022) + seed * 0.53);
      float arc = (flow - 0.5) * PI * (1.35 + bandN * 0.72 + seed * 0.24);
      float armCurve = sin(arc + bandN * 2.2 + seed * 5.3);
      float spiralRadius = 9.2 + bandN * 11.8 + seed * 6.0 + local * 2.9;
      float x = cos(arc * 0.72 + bandN * 0.92 + seed * 1.3) * spiralRadius + (flow - 0.5) * (13.5 + bandN * 9.5);
      float ribbonPhase = flow * PI * 2.0 * (0.55 + bandN * 0.24 + seed * 0.10) + t * (0.010 + bandN * 0.007) + seed * 5.7;
      float broadWave = sin(ribbonPhase) * 0.92;
      float fineWave = sin(ribbonPhase * (1.36 + seed * 0.62) - t * 0.044 + seed * 5.0) * 0.045;
      float yBase = (bandN - 0.5) * 13.2 + armCurve * (2.3 + bandN * 1.6) + (seed - 0.5) * 1.85 + snoise(vec3(bandN * 2.0, flow * 0.62, seed)) * 0.92;
      float ridgeCenter = 0.43 + (seed - 0.5) * 0.18;
      float ridge = exp(-pow((local - ridgeCenter) / (0.25 + seed * 0.04), 2.0));
      float softMask = smoothstep(0.010, 0.12, lane) * (1.0 - smoothstep(0.72, 0.81, lane));
      float ribbonNoise = snoise(vec3(flow * 1.18 + seed, bandN * 2.0, t * 0.018)) * 0.74;
      float zLayer = mix(-23.5, 15.5, bandN) + (seed - 0.5) * 6.0;

      pos.x = x + ribbonNoise * 1.40 + sin(t * 0.012 + seed * 8.0) * 0.22;
      pos.y = yBase + broadWave + fineWave + (local - 0.5) * (0.58 + ridge * 0.14);
      pos.z = zLayer + broadWave * 1.35 + ribbonNoise * 1.85;

      float pulseLine = 0.5 + 0.5 * sin(ribbonPhase * (1.7 + seed * 0.9) - t * 0.32 + seed * 6.0);
      vec3 aurora = mix(vec3(0.52, 0.86, 1.0), vec3(0.70, 0.58, 1.0), bandN);
      aurora = mix(aurora, vec3(0.96, 0.98, 0.92), bassGlow * 0.05);
      vAlpha = (0.18 + ridge * 0.78 + pulseLine * highGlow * 0.035 + bassGlow * 0.025) * softMask * (0.96 + transition * 0.02);
      vColor = mix(coverColor, aurora, 0.62 + ridge * 0.22) * (0.76 + ridge * 0.86 + pulseLine * highGlow * 0.05 + bassGlow * 0.04);
      maxRippleAmp = max(maxRippleAmp, ridge * (0.12 + midGlow * 0.05) + pulseLine * highGlow * 0.045 + bassGlow * 0.030);
    } else {
      float q = (lane - 0.80) / 0.20;
      float seed = hash11(aRand * 917.0 + floor(q * 130.0));
      float depth = mix(-32.0, 18.0, seed);
      float drift = fract(aUv.x + t * (0.0014 + seed * 0.0048) + seed * 0.63);
      float cluster = snoise(vec3(seed * 2.0, q * 3.2, t * 0.007));
      float x = (drift - 0.5) * (45.0 + seed * 22.0) + cluster * 3.4;
      float y = (hash11(aRand * 331.0 + seed * 5.0) - 0.5) * 22.0 + sin(t * (0.018 + seed * 0.028) + seed * 7.0) * 0.86;
      float z = depth + sin(t * (0.020 + seed * 0.032) + aRand * 8.0) * 1.05;
      float twinkle = pow(0.5 + 0.5 * sin(t * (0.24 + seed * 0.42) + aRand * 17.0), 5.0);
      float dust = smoothstep(0.22, 0.98, hash11(aRand * 661.0 + floor(q * 160.0)));

      pos = vec3(x, y, z);
      vAlpha = dust * (0.16 + twinkle * 0.46 + highGlow * 0.025 + bassGlow * 0.018) * (1.0 - q * 0.06);
      vColor = mix(coverColor, vec3(0.92, 0.97, 1.0), 0.62 + twinkle * 0.14) * (0.72 + twinkle * 0.62 + bassGlow * 0.025);
      maxRippleAmp = max(maxRippleAmp, twinkle * highGlow * 0.055 + dust * bassGlow * 0.030);
    }

    applyTransitionBurst(pos, vAlpha, maxRippleAmp, transition, aRand, t);
  }

  // ====================================================
  //  Preset 6: FIREFLY SWARM
  //  Warm pink-gold fireflies with cover-color harmony.
  //  - Lyrics (mid/high) dim particles so text stays focal
  //  - Beat transitions trigger local spark bursts
  //  - 3 size tiers with unique phases; near-center = brighter/slower
  //  - Mouse hover spawns mini sparkles (memory point interaction)
  // ====================================================
  else if (uPreset< 6.5) {
    // === Firefly Swarm ===
    float bassDrive  = smoothstep(0.15, 0.75, uBass);
    float midDrive   = smoothstep(0.1,  0.6,  uMid);
    float highDrive  = smoothstep(0.1,  0.55, uTreble);
    float vocalDrive = smoothstep(0.2,  0.72, uMid * 0.6+ uTreble * 0.4);
    float beatPulse  = smoothstep(0.3,  0.95, uBeat);
    float transition = clamp(uBurstAmt, 0.0, 1.0);

    float lane = aUv.y;

    // ──粒子减少 85%：保留约15% ──────────────────────────
    float densityCutoff = uParticleDensity * 0.081;
    if (aRand > densityCutoff) {
      gl_Position = vec4(0.0, 0.0, -9999.0, 1.0);
      vAlpha = 0.0;
      return;
    }

    // 粒子种子
    float seed  = hash11(aRand * 9876.54);
    float seed2 = hash11(aRand * 543.21);
    float seed3 = hash11(aRand * 1234.56);

    if (lane < 0.82) {
      // === 主萤火虫群 ===

      // 尺寸分层
      float tierRand = hash11(seed3 * 678.9);
      float sizeTier = tierRand < 0.25 ? 2.0 : (tierRand < 0.70 ? 1.0 : 0.5);

      // home锚点
      float normLane = lane / 0.82;
      float homeX = (aUv.x - 0.5) * 18.0 + (seed  - 0.5) * 4.0;
      float homeY = mix(-1.5, 3.5, normLane * normLane) + (seed2 - 0.5) * 2.5;
      float homeZ = mix(-5.0, 2.0, normLane) + (seed3 - 0.5) * 3.0;

      // 群聚中心
      vec3 swarmNoisePos = vec3(t * 0.08, seed * 5.0, 0.0);
      float swarmOffsetX = snoise(swarmNoisePos) * 2.5* midDrive;
      float swarmOffsetY = snoise(swarmNoisePos + vec3(10.0, 0.0, 0.0)) * 1.2 * midDrive;
      vec2 swarmCenter = vec2(homeX + swarmOffsetX, homeY + swarmOffsetY);

      float distToCenter = length(vec2(homeX, homeY) - swarmCenter);
      float centerInfluence = 1.0 / (1.0 + distToCenter * 0.25);

      // 轨道
      float orbitSpeed = mix(0.6, 1.8, 1.0 - centerInfluence) * (0.8 + seed * 0.4);
      float orbitAngle = t * orbitSpeed + seed * PI * 2.0;
      float orbitR = (0.4 + seed2 * 0.6) * sizeTier * (1.0 + bassDrive * 0.3);
      vec2 orbitOffset = vec2(cos(orbitAngle) * orbitR * 0.7, sin(orbitAngle) * orbitR);

      // 噪声漂移
      vec3 noisePos = vec3(homeX * 0.15, homeY * 0.15, t * 0.12+ seed * 100.0);
      float driftX = snoise(noisePos) * 1.5 * (1.0 + midDrive * 0.5);
      float driftY = snoise(noisePos + vec3(20.0, 0.0, 0.0)) * 1.2 * (1.0 + midDrive * 0.4);
      float driftZ = snoise(noisePos + vec3(0.0, 30.0, 0.0)) * 2.0;

      // 高频 wobble
      float wobbleFreq = mix(1.5, 3.5, 1.0 - sizeTier / 2.0);
      float wobbleX = sin(t * wobbleFreq + seed  * 6.28) * 0.35 * highDrive;
      float wobbleY = cos(t * wobbleFreq * 1.3 + seed2 * 6.28) * 0.25 * highDrive;

      float x = homeX + orbitOffset.x + driftX + wobbleX;
      float y = homeY + orbitOffset.y + driftY + wobbleY;
      float z = homeZ + driftZ;

      // bass burst扩散
      vec2 pushDir = normalize(vec2(x, y) - swarmCenter + vec2(0.001));
      float burstDist = length(vec2(x, y) - swarmCenter);
      float burstMask = smoothstep(6.0, 3.0, burstDist);
      float burstPush = bassDrive * burstMask * (1.5 + seed * 1.0);
      x += pushDir.x * burstPush;
      y += pushDir.y * burstPush;

      // 上下软遮罩 &歌词区域 suppress
      float softMask     = smoothstep(-2.0, -0.5, y) * smoothstep(5.0, 4.0, y);
      float lyricSuppress = 1.0 - smoothstep(1.2, 2.2, y) * smoothstep(3.2, 2.4, y)* vocalDrive * 0.32;

      // ── 独立闪烁 glow ─────────────────────────────────────
      float glowPhase = seed * 6.28;
      float glowSpeed = mix(0.8, 2.2, 1.0 - sizeTier / 2.0) * (1.0 + beatPulse * 0.5);
      float glowCurve = mix(2.5, 4.5, sizeTier / 2.0);
      float glow = pow(0.5 + 0.5 * sin(t * glowSpeed + glowPhase), glowCurve);

      // ── 音乐律动亮度 ──────────────────────────────────────
      // 每只虫的响应系数不同，避免整体同步
      float responseFactor = 0.55 + seed  * 0.90;   // 0.55 ~ 1.45
      float responseDelay  = seed2 * 0.35;           // 0~0.35 相位延迟感

      // beat闪光：短促、各虫独立强度
      float beatFlash = beatPulse* responseFactor
                        * (0.5 + seed3 * 0.5)        // 50%~100% 响应深度
                        * (0.8 + sin(glowPhase + responseDelay) * 0.2);

      // bass 呼吸：缓慢膨胀，近中心的虫更明显
      float bassBreath = bassDrive* centerInfluence
                         * (0.4 + seed2 * 0.4)
                         * responseFactor;

      // 整体能量：安静时变暗，热闹时变亮
      float quietDamp = mix(0.45, 1.0, smoothstep(0.05, 0.35, uEnergy));
      float energyBright = smoothstep(0.4, 0.9, uEnergy) * 0.3* responseFactor;

      // mid 调制：人声律动时中速呼吸
      float midPulse = sin(t * 1.8 * (1.0 + midDrive) + seed * 4.0) * 0.5+ 0.5;
      float midBreath = midDrive * midPulse * 0.25* responseFactor;

      // 合并律动系数(避免爆曝：clamped to 0.3~ 2.4)
      float musicLuminance = clamp(
        quietDamp * (1.0 + beatFlash + bassBreath + energyBright + midBreath),
        0.30, 2.40
      );
      // 同步到自身 glow 曲线，让律动与呼吸叠加而非覆盖
      glow = clamp(glow * musicLuminance, 0.0, 1.0);

      // 基础透明度
      float baseAlpha = mix(0.35, 0.75, sizeTier / 2.0) * centerInfluence;
      baseAlpha *= (0.65 + midDrive * 0.35);

      // 封面采样
      vec2 fireflyCoverUv = safeCoverUv(vec2(0.3 + seed * 0.4, 0.4 + seed2 * 0.3));
      vec3 coverSample = mix(
        samplePrevCoverColor(fireflyCoverUv),
        sampleNewCoverColor(fireflyCoverUv),
        uColorMixT
      );

      // 暖色主色
      vec3 amberTint = vec3(1.0, 0.75, 0.35);
      vec3 goldTint  = vec3(1.0, 0.88, 0.55);
      vec3 cyanAccent = vec3(0.4, 0.85, 0.75);
      float warmMix  = seed3;
      vec3 warmBase  = mix(amberTint, goldTint, warmMix);
      float cyanChance = seed2 < 0.22 ? 1.0 : 0.0;
      vec3 baseColorLocal = mix(warmBase, cyanAccent, cyanChance * 0.75);

      // 封面融合
      vec3 finalColor = mix(baseColorLocal, coverSample * baseColorLocal * 1.35, 0.75);
      finalColor = mix(finalColor, coverSample, 0.25);

      // transition burst
      if (transition > 0.001) {
        float sparkDist = length(vec2(x, y));
        float sparkMask = smoothstep(8.0, 3.0, sparkDist) * transition * (0.5 + seed * 0.5);
        finalColor = mix(finalColor, vec3(1.0, 0.95, 0.7), sparkMask * 0.6);
        glow = mix(glow,1.0, sparkMask);
      }

      vAlpha = baseAlpha * glow * softMask * lyricSuppress;
      vAlpha = clamp(vAlpha, 0.0, 0.92);

      // 音乐律动影响明暗：安静时暗、强律动时亮
      finalColor *= 0.2 + musicLuminance * 0.4;

      vColor = mix(defaultColor, finalColor, uHasCover);
      pos = vec3(x, y, z);

      //粒子大小也随律动微变
      gl_PointSize = clamp(
        (sizeTier * 2.0 + 1.5) * (1.0 + bassDrive * 0.4+ beatFlash * 0.3),
        1.5, 9.0
      );
    } else {
      // === 背景远距星尘 ===
      float dustLane = (lane - 0.82) / 0.18;
      float dustX = (aUv.x - 0.5) * 60.0 + (seed  - 0.5) * 20.0;
      float dustY = mix(-5.0, 8.0, dustLane) + (seed2 - 0.5) * 6.0;
      float dustZ = mix(-26.0, -10.0, dustLane * dustLane) + (seed3 - 0.5) * 8.0;

      dustX += snoise(vec3(dustX * 0.02, t * 0.03, seed  * 50.0)) * 2.0;
      dustY += snoise(vec3(dustY * 0.02, t * 0.03, seed2 * 50.0)) * 1.5;

      float dustGlow = pow(0.5 + 0.5 * sin(t * 0.5 + seed * 6.28), 3.0);
      // 星尘也随能量呼吸，但幅度小
      float dustEnergy = mix(0.5, 1.0, smoothstep(0.1, 0.6, uEnergy));
      float dustBeat = beatPulse * (0.3 + seed3 * 0.3);

      vAlpha = (0.06 + dustGlow * 0.10) * dustEnergy * (1.0 + dustBeat);
      vColor = mix(vec3(0.6, 0.7, 0.8), vec3(0.8, 0.75, 0.6), seed2);
      pos = vec3(dustX, dustY, dustZ);
      gl_PointSize = 1.5;
    }

    maxRippleAmp = 0.0;
  }

  // ====================================================
  //  Preset 7: DNA HELIX
  //  Counter-rotating double helix with strand identity.
  //  Strand A = bass (warm pink), Strand B = treble (cool blue).
  //  Strands have phase-offset breathing for "pulling" tension.
  //  Particles flicker with melody; beat = bright trail elongation.
  //  Transitions: helix briefly uncoils then re-twists.
  // ====================================================
  else if (uPreset < 7.5) {
    float K = uIntensity * 1.35;
    float bassDrive = smoothstep(0.02, 0.58, uBass + uBeat * 0.72);
    float midDrive  = smoothstep(0.03, 0.48, uMid + uBeat * 0.28);
    float lane = aUv.y;
    float transition = clamp(uBurstAmt, 0.0, 1.0);

    if (lane < 0.84) {
      // --- 主 DNA 双螺旋 ---
      float normalizedLane = lane / 0.84;
      float helixY = (normalizedLane - 0.5) * 7.0;

      // 粒子角色分配
      float role = aUv.x;
      // 0.0~0.38: 链A管壁, 0.38~0.76: 链B管壁, 0.76~1.0: 横档
      float isStrandA = step(0.0, role) * step(role, 0.38);
      float isStrandB = step(0.38, role) * step(role, 0.76);
      float isRung = step(0.76, role);

      // 螺旋参数
      float twistPitch = 1.2;
      float baseRadius = 2.3 + bassDrive * 0.5 + uBeat * 0.25;

      // 时间驱动
      float slowSpin = t * 0.3;
      float beatWave = sin(helixY * 0.8 - t * 2.0) * uBeat * 0.15;

      // 螺旋角度
      float angle = helixY * twistPitch + slowSpin + beatWave;

      // 两条链的中心线 (相位差 PI)
      float angleA = angle;
      float angleB = angle + PI;

      vec3 centerA = vec3(cos(angleA) * baseRadius, helixY, sin(angleA) * baseRadius);
      vec3 centerB = vec3(cos(angleB) * baseRadius, helixY, sin(angleB) * baseRadius);

      // Frenet 框架近似 — tangent 沿螺旋方向
      float dAngle = twistPitch;
      vec3 tangentA = normalize(vec3(-sin(angleA) * dAngle * baseRadius, 1.0, cos(angleA) * dAngle * baseRadius));
      vec3 tangentB = normalize(vec3(-sin(angleB) * dAngle * baseRadius, 1.0, cos(angleB) * dAngle * baseRadius));

      // Normal & Binormal for tube cross-section
      vec3 normalA = normalize(vec3(cos(angleA), 0.0, sin(angleA)));
      vec3 binormalA = cross(tangentA, normalA);
      vec3 normalB = normalize(vec3(cos(angleB), 0.0, sin(angleB)));
      vec3 binormalB = cross(tangentB, normalB);

      // 管壁厚度参数
      float tubeRadius = 0.28 + uBass * 0.08;
      float tubeAngle = hash11(aRand * 137.0 + normalizedLane * 53.0) * 2.0 * PI;
      float tubeR = tubeRadius * (0.5 + 0.5 * hash11(aRand * 91.0 + 7.0));

      // 高频抖动
      float trebleJitter = uTreble * 0.06;
      vec3 jitter = vec3(
        snoise(vec3(aRand * 10.0, t * 1.5, 0.0)),
        snoise(vec3(aRand * 10.0 + 50.0, t * 1.5, 0.0)),
        snoise(vec3(aRand * 10.0 + 100.0, t * 1.5, 0.0))
      ) * trebleJitter;

      if (isStrandA > 0.5) {
        // 链 A 管壁粒子
        vec3 offset = normalA * cos(tubeAngle) * tubeR + binormalA * sin(tubeAngle) * tubeR;
        pos = centerA + offset + jitter;
      } else if (isStrandB > 0.5) {
        // 链 B 管壁粒子
        vec3 offset = normalB * cos(tubeAngle) * tubeR + binormalB * sin(tubeAngle) * tubeR;
        pos = centerB + offset + jitter;
      } else {
        // 横档粒子 — 连接两条链
        float rungParam = fract(aRand * 3.7 + role * 2.1);
        // 横档只出现在特定相位窗口（模拟碱基对间距）
        float rungPhase = fract(helixY * twistPitch / (2.0 * PI) + slowSpin / (2.0 * PI));
        float rungSpacing = fract(normalizedLane * 12.0);
        float rungWindow = smoothstep(0.0, 0.08, rungSpacing) * smoothstep(0.2, 0.12, rungSpacing);
        // 沿两链间插值
        vec3 rungPos = mix(centerA, centerB, rungParam);
        // 少量法向厚度
        float rungThick = 0.1 * (hash11(aRand * 233.0) - 0.5);
        vec3 rungNormal = normalize(centerB - centerA);
        vec3 rungBinorm = normalize(cross(rungNormal, vec3(0.0, 1.0, 0.0)));
        rungPos += rungBinorm * rungThick;
        rungPos += jitter * 0.5;
        // 横档 beat 闪烁
        float rungFlash = uBeat * rungWindow * 0.3;
        pos = rungPos;
      }

      // 整体倾斜增强 3D 感 (绕 X 轴约 0.38 rad)
      float tiltAngle = 0.38;
      float cosT = cos(tiltAngle);
      float sinT = sin(tiltAngle);
      vec3 tilted = vec3(pos.x, pos.y * cosT - pos.z * sinT, pos.y * sinT + pos.z * cosT);
      pos = tilted;

      // --- 中段扫描光带 (uMid 驱动) ---
      float scanY = sin(t * 0.8) * 3.0;
      float scanDist = abs(helixY - scanY);
      float scanGlow = smoothstep(1.2, 0.0, scanDist) * midDrive * 0.6;

      // --- 封面颜色采样 ---
      float coverU = fract(normalizedLane + aRand * 0.1);
      float coverV = fract(aUv.x * 0.8 + normalizedLane * 0.5);
      vec2 dnaCoverUv = safeCoverUv(vec2(coverU, coverV));
      vec3 particleCover = mix(samplePrevCoverColor(dnaCoverUv), sampleNewCoverColor(dnaCoverUv), clamp(uColorMixT, 0.0, 1.0));

      // 冷暖区分两条链
      vec3 col = particleCover;
      if (isStrandA > 0.5) {
        col = mix(col, col * vec3(1.05, 0.97, 0.93), 0.3); // 微暖
      } else if (isStrandB > 0.5) {
        col = mix(col, col * vec3(0.93, 0.97, 1.06), 0.3); // 微冷
      } else {
        // 横档 beat 时闪白
        float rungSpacing2 = fract(normalizedLane * 12.0);
        float rungWindow2 = smoothstep(0.0, 0.08, rungSpacing2) * smoothstep(0.2, 0.12, rungSpacing2);
        col = mix(col, vec3(1.0), uBeat * rungWindow2 * 0.4);
      }

      // 扫描光带高亮
      col += vec3(0.15, 0.25, 0.0) * scanGlow;

      // beat 高亮
      col = mix(col, col * 1.3 + vec3(0.05), uBeat * 0.2);

      vColor = mix(defaultColor, col, uHasCover);

      // Alpha
      float edgeMask = smoothstep(0.0, 0.06, normalizedLane) * smoothstep(1.0, 0.94, normalizedLane);
      float baseAlpha = 0.55 + bassDrive * 0.15 + scanGlow * 0.2;
      if (isRung > 0.5) {
        float rungSpacing3 = fract(normalizedLane * 12.0);
        float rungWindow3 = smoothstep(0.0, 0.08, rungSpacing3) * smoothstep(0.2, 0.12, rungSpacing3);
        baseAlpha = mix(0.12, 0.7, rungWindow3) + uBeat * rungWindow3 * 0.2;
      }
      vAlpha = clamp(baseAlpha * edgeMask * K, 0.12, 0.85);

      maxRippleAmp = max(maxRippleAmp, bassDrive * 0.5 + uBeat * 0.3);

    } else {
      // --- 背景星尘 ---
      float dustLane = (lane - 0.84) / 0.16;
      float dustAngle = hash11(aRand * 77.0) * 2.0 * PI;
      float dustRadius = 4.5 + hash11(aRand * 123.0) * 3.5;
      float dustY = (hash11(aRand * 199.0) - 0.5) * 8.0;
      float dustDrift = t * 0.05* (0.5 + hash11(aRand * 311.0));

      pos = vec3(
        cos(dustAngle + dustDrift) * dustRadius,
        dustY + sin(t * 0.2+ aRand * 6.28) * 0.3,
        sin(dustAngle + dustDrift) * dustRadius
      );

      //倾斜与主螺旋一致
      float tiltAngle2 = 0.38;
      float cosT2 = cos(tiltAngle2);
      float sinT2 = sin(tiltAngle2);
      pos = vec3(pos.x, pos.y * cosT2 - pos.z * sinT2, pos.y * sinT2 + pos.z * cosT2);

      // 封面色采样
      vec2 dustCoverUv = safeCoverUv(vec2(hash11(aRand * 57.0), hash11(aRand * 89.0)));
      vec3 dustCover = mix(samplePrevCoverColor(dustCoverUv), sampleNewCoverColor(dustCoverUv), clamp(uColorMixT, 0.0, 1.0));
      vec3 dustCol = mix(dustCover, dustCover * 0.6 + vec3(0.1, 0.1, 0.15), 0.3);
      vColor = mix(defaultColor, dustCol, uHasCover);

      vAlpha = clamp((0.15 + uEnergy * 0.1) * K, 0.12, 0.45);
      maxRippleAmp = max(maxRippleAmp, 0.05);
    }

    if (transition > 0.001) {
      vAlpha *= mix(1.0, 0.4 + 0.6 * hash11(aRand * 431.0), transition);
    }
  }

  // ====================================================
  //  Preset 8: GRAVITY WELL
  //  Accretion disk with strong radial stratification.
  //  - Outer collapse first -> inner delay (gravity wave feel)
  //  - Core dark-red glow pulses with bass (energy surging)
  //  - Near disk = fast & chaotic, far = slow & drifting
  //  - Bass beat: core inhales particles then jets them out
  //  - Bottom gravity bias: lower particles sink slower
  // ====================================================
  else if (uPreset < 8.5) {
    // ---- 1. 音频驱动平滑化 ----
    float bassDrive = smoothstep(0.05, 0.70, uBass + uBeat * 0.80);
    float midDrive  = smoothstep(0.05, 0.60, uMid);
    float highDrive = smoothstep(0.03, 0.45, uTreble);
    float beatPulse = clamp(uBeat, 0.0, 1.0);

    float lane = aUv.y;                 // 0..1 径向分层
    float ang  = aUv.x * 2.0 * PI;      // 环向角
    float seed = aRand;
    float transition = clamp(uBurstAmt, 0.0, 1.0);
    float jetLen = 0.0;

    if (lane < 0.82) {
      // =====================================================
      //  吸积盘主体 (ACCRETION DISK)
      // =====================================================
      float laneN = lane / 0.82;
      float radialLayer = smoothstep(0.0, 1.0, laneN);
      // FFT 频谱纹理：每粒子绑定专属频段（内圈=bass kick，外圈=treble），
      // 旋律直接雕刻盘面——哪个频段响，哪圈环就律动
      float spec = specAt(laneN);

      // ==== 重新设计半径分布（黑洞放大版） ====
      // 把视界半径从 0.55 放大到 1.05，让黑洞阴影在屏幕上占更大面积，气势更强。
      // 吸积盘起点远离视界（3.2 倍），盘体加宽、外缘缩短，消灭"钢丝圈"。
      float eventHorizon = 1.05 * mix(0.92, 1.06, uAccretion);
      float photonRing  = eventHorizon * 2.6;   // 理论光子球半径
      float diskInner  = eventHorizon * 3.2;   // 吸积盘可见部分的内起点
      float diskOuter  = 8.5;                  // 外缘缩短，避免撑满全屏
      // 用 pow(laneN, 0.62) 让粒子在径向更均匀填充，内圈也有足够密度，形成弥漫盘状
      float initialR = mix(diskInner, diskOuter, pow(laneN, 0.62));
      // 长时标吸积/蒸发：响 → 盘外缘扩张+内缘内收(盘变宽)；静 → 整体收缩变弱
      initialR *= mix(0.88, 1.08, uAccretion);

      // 波动延迟：引力波向外扩散
      float beatDelay = radialLayer * 0.8;
      float delayedBeat = clamp(uBeat - beatDelay, 0.0, 1.0);
      delayedBeat = smoothstep(0.0, 0.5, delayedBeat) * (1.0 - beatDelay * 0.3);

      // 开普勒旋转：内圈极快（速度 ~ 1/√r）
      float orbSpeed = 1.15 / sqrt(initialR * 0.55 + 0.25);
      float orbitalPhase = t * orbSpeed + seed * 6.2831;
      orbitalPhase += t * (bassDrive * 0.18 + spec * 0.14) * (1.0 - radialLayer * 0.4);

      // 向心吸积螺旋运动（温和螺旋，不要把粒子猛推到视界）
      float fallSpeed = mix(0.06, 0.015, radialLayer);
      float spiralCycle = fract(seed * 0.88 + t * fallSpeed * 0.05);
      float spiralIn = -spiralCycle * initialR * 0.55;

      float decayR = initialR + spiralIn;
      decayR -= bassDrive * 0.35 * (1.0 - radialLayer * 0.5);
      decayR -= delayedBeat * 0.45;
      decayR -= spec * 0.30 * (1.0 - radialLayer * 0.4);

      // 内缘软过渡：粒子可以进入 diskInner 以内，但在光子环附近逐渐淡出，形成弥漫内边界
      float belowDisk = smoothstep(diskInner * 0.82, diskInner * 1.18, decayR);

      float baseAngle = ang + orbitalPhase;
      float cx = cos(baseAngle);
      float sz = sin(baseAngle);

      // 【内薄外厚 + 整体更厚的吸积盘剖面】
      //  Shakura-Sunyaev：H/R ∝ r^(9/8)，外圈更厚；基础厚度放大并加宽内缘，形成弥漫饼状
      float hOverR = 0.10 + pow(radialLayer, 0.95) * 0.72;
      float baseThickness = initialR * hOverR * mix(1.0, 1.35, uAccretion);
      // Y 方向近似高斯分布，盘中心密、上下边缘自然淡出
      float gaussY = hash11(seed * 23.3) * 2.0 - 1.0;
      float diskY = gaussY * (0.45 + 0.55 * abs(gaussY)) * baseThickness;
      
      // 中频 + 专属频段驱动的盘面波动
      float ripple = sin(decayR * 2.5 - t * 3.5) * (midDrive * 0.06 + spec * 0.09) * (0.3 + radialLayer);
      diskY += ripple;
      maxRippleAmp = max(maxRippleAmp, abs(ripple));

      pos.x = cx * decayR;
      pos.z = sz * decayR;
      pos.y = diskY;

      // 高频抖动
      float jit = highDrive * 0.04;
      pos.x += snoise(vec3(seed * 4.0, t * 0.8, decayR)) * jit;
      pos.z += snoise(vec3(seed * 6.0, decayR, t * 0.8)) * jit;

      // ==== 相对论多普勒集束 (Doppler Beaming，大幅度强化版) ====
      // 朝向观察者一侧 = 切向速度点乘 -视线方向 为正 → 蓝移、增亮 3~4 倍
      // 远离一侧 = 该点积为负 → 红移、压暗到 0.35 倍
      // 这样盘面会呈现明显的"左亮右暗"月牙形不对称，不再是均匀的甜甜圈光圈
      vec3 tangentDir = vec3(-sz, 0.0, cx);
      vec4 mvDop = modelViewMatrix * vec4(pos, 1.0);
      vec3 velView = normalize((modelViewMatrix * vec4(tangentDir, 0.0)).xyz + vec3(1e-5));
      float dopp = dot(velView, normalize(-mvDop.xyz));
      // 内圈速度快 → 相对论效应线性放大到外圈 (ISCO 附近 γ 因子最大)
      float relativFactor = mix(1.15, 0.35, radialLayer);
      dopp = clamp(dopp * relativFactor * 1.8, -1.0, 1.0);

      // =====================================================
      //  螺旋臂密度调制 (Spiral Density Modulation)
      // =====================================================
      // 使用正弦波与噪声在盘面上制造双臂旋涡，打破均匀的圆环感
      float armCount = 2.0;
      float armTightness = 1.0;
      float spiralPattern = sin(baseAngle * armCount - decayR * armTightness + t * 0.5);
      float localNoise = snoise(vec3(pos.xz * 0.4, t * 0.2));
      float densityMod = smoothstep(-0.6, 0.8, spiralPattern * 0.4 + localNoise * 0.6);

      // =====================================================
      //  高能准直喷流 (HIGH ENERGY JET)
      // =====================================================
      // 调高喷流粒子比例，渲染为亮蓝色/白色的高能光束
      // 设计意图 "Bass beat: core inhales particles then jets them out"：
      // 喷流由低音重击驱动（bassDrive），叠加 treble 与 beatPulse。
      // 旧公式只看 uTreble+beatPulse*0.3——但 wallpaperAudio 分支(preset 5/8/9)里
      // ringTreble 会被 smoothBass 减法压制、beatPulse 还要 *0.46，导致低音强的歌
      // uTreble 恒 0、jetInput < 0.10，喷流在数学上永不出现。
      // 提高喷流粒子比例（约 12%），让喷流从细线变成可见光柱
      float jetChance = step(0.88, hash11(seed * 417.0));
      // 喷流驱动叠加频谱纹理高频段原始能量：wallpaperAudio 分支压低 uTreble 时仍能触发。
      // 强度 = uJetStrength（JS 包络能量，播放中带 0.18 保底）：暂停→0 喷流消失。
      // 活动度 smoothstep 只调制 0.35~1.0 强度（旧版整体门限在安静段把 jetDrive 压为 0，喷流熄灭）
      float hiSpec = specAt(0.88);
      float jetDrive = (0.35 + 0.65 * smoothstep(0.05, 0.50, uTreble + beatPulse * 0.3 + bassDrive * 0.35 + hiSpec * 0.30)) * uJetStrength;
      bool isJet = (jetChance > 0.5 && jetDrive > 0.015);

      if (isJet) {
        jetLen = fract(seed * 13.0 + t * (0.5 + jetDrive * 0.7));
        float jetDir = (hash11(seed * 812.0) < 0.5) ? -1.0 : 1.0;
        float jetHeight = jetLen * (5.0 + jetDrive * 9.0);

        // 喷流：更粗锥形 + 更强湍流散开 + 顶部羽状消散；粗细随音乐（包络能量）调制
        float coneR = mix(0.78, 0.18, jetLen) * (0.85 + highDrive * 0.7 + jetDrive * 0.5) * (0.60 + uJetStrength * 0.75);
        // 随高度加入径向湍流，让喷流成为可见光柱
        float jetSpread = pow(jetLen, 0.70) * (0.45 + jetDrive * 0.55);
        coneR += jetSpread;
        float ja = seed * 6.2831 + t * 5.0;
        float jr = coneR * (0.85 + 0.30 * snoise(vec3(seed * 3.0, t * 2.0, jetLen * 4.0)));
        pos.x = cos(ja) * jr;
        pos.z = sin(ja) * jr;
        pos.y = jetDir * jetHeight;
      }

      // =====================================================
      //  色彩与温度渐变
      // =====================================================
      vec2 diskCoverUv = safeCoverUv(vec2(
        0.5 + cx * (0.15 + radialLayer * 0.30),
        0.5 + sz * (0.15 + radialLayer * 0.30)
      ));
      vec3 particleCover = mix(
        samplePrevCoverColor(diskCoverUv),
        sampleNewCoverColor(diskCoverUv),
        clamp(uColorMixT, 0.0, 1.0)
      );

      // 物理配色：外圈冷暗灰紫 -> 中圈橙红 -> 内圈极亮白炽
      vec3 colOuter  = vec3(0.22, 0.08, 0.32);  // 外边缘冷暗红紫
      vec3 colWarm   = vec3(1.00, 0.42, 0.10);  // 约 4000K 橙红
      vec3 colHot    = vec3(1.00, 0.82, 0.38);  // 约 6500K 金橙
      vec3 colIncand = vec3(1.55, 1.48, 1.35);  // 超 1.0 物理白炽

      float rN = clamp((decayR - photonRing * 0.9) / (diskOuter - photonRing * 0.9), 0.0, 1.0);
      vec3 physCol;
      if (rN > 0.55) {
        physCol = mix(colWarm, colOuter, smoothstep(0.55, 1.0, rN));
      } else if (rN > 0.18) {
        physCol = mix(colHot, colWarm, smoothstep(0.18, 0.55, rN));
      } else {
        physCol = mix(colIncand, colHot, smoothstep(0.0, 0.18, rN));
      }

      // 融合封面色
      vec3 col = mix(physCol * (0.4 + particleCover), particleCover * (0.7 + physCol * 1.2), 0.55);
      col += col * spec * 0.35;

      // ==== 多普勒集束（可见但不过曝） ====
      // 逼近侧 (dopp > 0)：亮度 ×3.2 + 温和蓝白；远离侧 (dopp < 0)：亮度 ×0.35 + 红化
      // 两侧亮度差 ~9 倍，月牙明显但不刺眼
      col *= 1.0 + max(dopp, 0.0) * 2.20 + min(dopp, 0.0) * 0.65;
      col = mix(col, col * vec3(0.82, 0.92, 1.28), max(dopp, 0.0) * 0.42);
      col = mix(col, col * vec3(1.25, 0.82, 0.62), max(-dopp, 0.0) * 0.45);
      col *= mix(0.80, 1.25, uAccretion);

      // ==== 光子环与内盘热辐射（raymarch 层已有真实光子环，粒子只留微弱叠加）====
      float distFromPhoton = decayR - photonRing;
      float photonGlow = exp(-abs(distFromPhoton) * 12.0);
      float bassSpec = specAt(0.06);
      col += vec3(1.25, 1.10, 0.85) * photonGlow * (0.24 + bassDrive * 0.45 + bassSpec * 0.45);
      float photonFlash = beatPulse * exp(-abs(distFromPhoton) * 8.0);
      col += vec3(1.4, 1.3, 1.1) * photonFlash * 0.50;

      // 内盘整体软辉光
      float innerGlow = exp(-max(distFromPhoton, 0.0) * 2.0);
      col += vec3(0.9, 0.30, 0.08) * innerGlow * belowDisk * (0.12 + bassDrive * 0.24);

      float distFromHorizon = decayR - eventHorizon;

      // 喷流颜色：冰蓝/白炽，根部更亮
      if (isJet) {
        col = mix(vec3(1.55, 1.70, 1.95), vec3(0.45, 0.12, 0.95), jetLen);
      }

      // 【黑洞中心绝对虚无 + 大过渡软边】
      float blackHoleMask = smoothstep(0.0, photonRing * 0.55, distFromHorizon);
      blackHoleMask = min(blackHoleMask, belowDisk);
      col *= blackHoleMask;

      vec3 finalCol = mix(defaultColor, col, uHasCover);
      if (uHasCover < 0.5) finalCol = col;
      vColor = finalCol;

      // ---- 透明度与软边缘 ----
      // raymarch 透镜层接管盘主体后，粒子只提供颗粒质感（整体约 30% 强度）
      float thickFade = exp(-pow(abs(diskY) / max(baseThickness * 0.65, 0.01), 2.0));
      float a = mix(0.115, 0.028, pow(radialLayer, 0.75));
      a *= (0.30 + 0.70 * densityMod);
      a *= thickFade;
      a *= (0.50 + spec * 0.65);
      a += photonFlash * 0.18;

      if (isJet) {
        a = (1.0 - pow(clamp(pos.y / 15.0, -1.0, 1.0), 2.0)) * (0.92 + jetDrive * 0.18);
      }

      a *= blackHoleMask;
      a *= (0.62 + uIntensity * 0.48);
      // 多普勒：逼近侧更实，远离侧更虚（控制亮度差，避免过曝）
      a *= 1.0 + max(dopp, 0.0) * 0.85 + min(dopp, 0.0) * 0.30;
      a *= mix(0.86, 1.15, uAccretion);
      vAlpha = clamp(a, 0.0, 0.85);

    } else {
      // =====================================================
      //  深空背景星尘 (STARDUST)
      // =====================================================
      float dN = (lane - 0.82) / 0.18;
      float dr = mix(9.0, 32.0, hash11(seed * 17.7));
      float da = seed * 6.2831 + t * 0.010 * (0.4 + dN);

      float depth = mix(-32.0, 22.0, hash11(seed * 61.3));
      da += t * 0.008;

      pos.x = cos(da) * dr;
      pos.z = sin(da) * dr * 0.75 + depth * 0.1;
      pos.y = (hash11(seed * 97.0) - 0.5) * 16.0;
      pos.z += depth;

      pos.x += snoise(vec3(seed * 1.5, t * 0.03, 0.0)) * 0.3;
      pos.y += snoise(vec3(t * 0.03, seed * 3.5, 1.0)) * 0.3;

      // ==== 引力透镜弯曲（爱因斯坦环集中版） ====
      // 洞后方星尘被强弯到爱因斯坦半径附近，形成明亮细环；其余区域星尘压暗，减少杂乱噪点
      float lensGain = 1.0;
      {
        vec3 rayDir = normalize(-cameraPosition);
        vec3 camToStar = pos - cameraPosition;
        float tAlong = dot(camToStar, rayDir);
        vec3 perp = camToStar - rayDir * tAlong;
        float perpLen = max(length(perp), 1e-3);
        float camDist = length(cameraPosition);
        float behind = smoothstep(camDist * 0.70, camDist * 2.0, tAlong);
        // 质量放大后 einstein 半径同步放大
        float einstein = 4.2;
        float bend = behind * einstein * einstein / (perpLen + 0.55);
        bend = min(bend, 7.0);
        pos += (perp / perpLen) * bend;
        // 只有在弯曲强度接近爱因斯坦环处才明显增亮，其他区域压暗
        float ringBoost = exp(-pow(bend - einstein * 1.35, 2.0) / (einstein * 0.55));
        lensGain = 0.40 + behind * (ringBoost * 1.6 + min(bend * 0.18, 0.35));
        // 星尘也要躲黑洞
        float starR = length(pos);
        if (starR < 2.8) lensGain *= smoothstep(0.0, 2.8, starR);
      }

      vec2 dustUv = safeCoverUv(vec2(fract(seed * 4.3), fract(seed * 7.9)));
      vec3 dustCover = mix(samplePrevCoverColor(dustUv), sampleNewCoverColor(dustUv), clamp(uColorMixT, 0.0, 1.0));

      vec3 dustBase = mix(vec3(0.08, 0.05, 0.22), vec3(0.22, 0.18, 0.40), hash11(seed * 7.3));
      vColor = mix(dustBase, dustCover * 0.5 + dustBase * 0.5, uHasCover * 0.5);

      float tw = 0.3 + 0.7 * sin(t * (1.0 + seed * 2.5) + seed * 45.0);
      float dustSpec = specAt(0.30 + hash11(seed * 29.1) * 0.62);
      // 星尘由 raymarch 星场替代，粒子星尘只留极微弱点缀
      vAlpha = clamp(0.008 + tw * 0.05 + highDrive * 0.02 + dustSpec * 0.08, 0.005, 0.06) * lensGain;
    }

    // ---- 切歌过渡效果 ----
    if (transition > 0.001) {
      vec3 outward = normalize(pos + vec3(0.001));
      pos += outward * transition * (1.2 + hash11(seed * 19.0) * 1.8);
      vAlpha *= (1.0 - transition * 0.5);
    }
  }

  // ====================================================================
  // Preset 9: 涟漪 (Ripple)
  // 网易云同款：纯平面2D两侧水波纹，弧形扩散，中间平静
  // ====================================================================
  else if (uPreset < 9.5) {
    float lane = aUv.y;
    float id = aUv.x;

    float jitterX = (hash11(aRand * 71.3) - 0.5) * 0.015;
    float jitterY = (hash11(aRand * 47.9) - 0.5) * 0.015;
    float px = mix(-1.5, 1.5, id) + jitterX;
    float py = mix(-1.5, 1.5, lane) + jitterY;
    vec2 gridPos = vec2(px, py);

    vec2 srcLeft  = vec2(-2.2, 0.0);
    vec2 srcRight = vec2( 2.2, 0.0);
    float distLeft  = length(gridPos - srcLeft);
    float distRight = length(gridPos - srcRight);

    float t = uTime * uSpeed;

    float bassDrive = 0.5 + uBass * 1.2 + uBeat * 0.5;
    float midDrive = 0.6 + uMid * 0.8;
    float trebleDrive = uTreble;

    float freq1 = mix(3.5, 5.5, uTreble);
    float freq2 = freq1 * 1.85;
    float freq3 = freq1 * 3.2;

    float speed1 = mix(0.8, 2.2, uBass);
    float speed2 = speed1 * 1.3;
    float speed3 = speed1 * 1.7;

    float phase1L = distLeft  * freq1 - t * speed1;
    float phase2L = distLeft  * freq2 - t * speed2 + 0.6;
    float phase3L = distLeft  * freq3 - t * speed3 + 1.2;

    float phase1R = distRight * freq1 - t * speed1 + 0.3;
    float phase2R = distRight * freq2 - t * speed2 + 0.9;
    float phase3R = distRight * freq3 - t * speed3 + 1.5;

    float wave1L = 0.5 + 0.5 * sin(phase1L);
    float wave2L = 0.5 + 0.5 * sin(phase2L);
    float wave3L = 0.5 + 0.5 * sin(phase3L);

    float wave1R = 0.5 + 0.5 * sin(phase1R);
    float wave2R = 0.5 + 0.5 * sin(phase2R);
    float wave3R = 0.5 + 0.5 * sin(phase3R);

    wave1L = pow(wave1L, 3.0);
    wave2L = pow(wave2L, 2.5) * 0.7;
    wave3L = pow(wave3L, 2.0) * 0.4 * trebleDrive;

    wave1R = pow(wave1R, 3.0);
    wave2R = pow(wave2R, 2.5) * 0.7;
    wave3R = pow(wave3R, 2.0) * 0.4 * trebleDrive;

    float waveL = wave1L + wave2L + wave3L;
    float waveR = wave1R + wave2R + wave3R;

    float edgeFalloffL = exp(-distLeft * 0.55);
    float edgeFalloffR = exp(-distRight * 0.55);

    float sideBoostL = smoothstep(-1.5, -0.4, -gridPos.x);
    float sideBoostR = smoothstep( 1.5,  0.4,  gridPos.x);

    float rippleL = waveL * edgeFalloffL * sideBoostL;
    float rippleR = waveR * edgeFalloffR * sideBoostR;

    float centerCalm = smoothstep(0.0, 0.45, abs(gridPos.x));
    float ripple = (rippleL + rippleR) * centerCalm;

    float flowNoise = snoise(vec3(gridPos * 1.6, t * 0.2)) * 0.5 + 0.5;
    ripple *= 0.82 + 0.18 * flowNoise;

    float rippleAmp = ripple * bassDrive * midDrive;

    pos = vec3(gridPos, 0.0);

    vec3 baseTint = vec3(0.10, 0.28, 0.42);
    vec3 midTint  = vec3(0.22, 0.52, 0.72);
    vec3 glowTint = vec3(0.45, 0.78, 0.96);

    vec3 col;
    if (uHasCover > 0.5) {
      vec2 cuv = safeCoverUv(gridPos * 0.5 + 0.5);
      vec3 coverCol = getCoverColor(cuv);
      float coverLum = dot(coverCol, vec3(0.299, 0.587, 0.114));

      vec3 desaturatedCover = vec3(coverLum) * 0.6 + coverCol * 0.4;

      vec3 darkBase = mix(baseTint * 0.7, desaturatedCover * 0.5, 0.5);
      vec3 midBase  = mix(midTint,  desaturatedCover * 0.8 + midTint * 0.4, 0.6);
      vec3 brightTop  = mix(glowTint, coverCol + glowTint * 0.5, 0.5);

      float waveBand = smoothstep(0.0, 0.4, rippleAmp);
      float glowBand = smoothstep(0.35, 0.9, rippleAmp);

      col = mix(darkBase, midBase, waveBand);
      col = mix(col, brightTop, glowBand);

      col += coverCol * uBeat * ripple * 0.25;
    } else {
      float waveBand = smoothstep(0.0, 0.4, rippleAmp);
      float glowBand = smoothstep(0.35, 0.9, rippleAmp);

      col = mix(baseTint, midTint, waveBand);
      col = mix(col, glowTint, glowBand);

      col += glowTint * uBeat * ripple * 0.3;
    }

    vColor = col;

    float density = 0.45 + uParticleDensity * 0.55;
    float a = (0.10 + rippleAmp * 0.9) * density;
    a *= 0.55 + 0.45 * centerCalm;
    a += uBurstAmt * 0.15;
    vAlpha = clamp(a, 0.0, 1.0);

    maxRippleAmp = clamp(0.12 + rippleAmp * 0.9 + uBeat * 0.18, 0.1, 1.2);
  }

  // ====================================================
  //  Preset 10: TIDAL
  // ====================================================
  else if (uPreset < 10.5) {
    float waveAmp = 0.6 + uBass * 0.4 + uBeat * 0.1;
    float waveSpeed = 1.0 + uMid * 0.5;
    float foamAmount = uTreble * 0.8 + uBeat * 0.3;
    float lane = aUv.y;

    if (lane < 0.7) {
      float waveN = lane / 0.7;
      float seed = hash11(aRand * 89.2 + floor(waveN * 8.0));
      float waveX = (aUv.x - 0.5) * 20.0 + sin(t * 0.3 * waveSpeed + seed * 6.28) * 2.0;
      float waveY = waveN * 8.0 - 2.0 + sin(waveX * 0.8 + t * waveSpeed + seed * 3.14) * waveAmp
                   + snoise(vec3(waveX * 0.3, waveN * 2.0, t * 0.2)) * 0.8;

      pos.x = waveX;
      pos.y = waveY;
      pos.z = (seed - 0.5) * 2.0 + snoise(vec3(waveX * 0.2, t * 0.15, seed * 2.0)) * 1.0;

      vec3 deepBlue = vec3(0.02, 0.15, 0.4);
      vec3 cyan = vec3(0.0, 0.6, 0.8);
      vec3 foamWhite = vec3(0.95, 0.98, 1.0);

      float depthFactor = waveN;
      vec3 waterCol = mix(cyan, deepBlue, depthFactor);

      float foam = smoothstep(0.3, 0.9, snoise(vec3(waveX * 0.5, t * 0.4, seed * 5.0))) * foamAmount;
      foam += pow(max(0.0, sin(waveX * 1.2 + t * waveSpeed * 1.5)), 8.0) * foamAmount * 0.5;

      float alpha = 0.7 + foam * 0.3;
      alpha *= smoothstep(0.0, 0.05, lane) * (1.0 - smoothstep(0.65, 0.72, lane));

      vColor = mix(waterCol, foamWhite, foam) * (0.7 + uBass * 0.3);
      vAlpha = alpha * (0.8 + uBass * 0.2);
      maxRippleAmp = max(maxRippleAmp, foam * uTreble * 0.08 + uBass * 0.03);
    } else {
      float q = (lane - 0.7) / 0.3;
      float seed = hash11(aRand * 347.0 + floor(q * 60.0));
      float bubbleR = mix(0.1, 0.5, seed) + uBass * 0.2;
      float bubbleSpeed = mix(0.5, 1.5, seed) + uMid * 0.5;
      float bubbleX = (hash11(seed * 13.0) - 0.5) * 18.0 + sin(t * 0.2 + seed * 10.0) * 1.5;
      float bubbleY = -2.0 + q * 6.0 + t * bubbleSpeed * 0.5;
      float bubbleZ = (hash11(seed * 17.0) - 0.5) * 3.0;

      float wobble = sin(t * 2.0 + seed * 8.0) * 0.1;
      pos.x = bubbleX + wobble;
      pos.y = mod(bubbleY, 8.0) - 3.0;
      pos.z = bubbleZ;

      float bubbleAlpha = (0.3 + uTreble * 0.3) * (1.0 - q * 0.5);
      bubbleAlpha *= smoothstep(0.0, 0.1, q) * (1.0 - smoothstep(0.9, 1.0, q));

      vColor = mix(coverColor, vec3(0.8, 0.95, 1.0), 0.7) * (0.6 + uBass * 0.2);
      vAlpha = bubbleAlpha;
      maxRippleAmp = max(maxRippleAmp, bubbleAlpha * uTreble * 0.05);
    }

    if (uBurstAmt > 0.001) {
      float burst = smoothstep(0.0, 1.0, uBurstAmt);
      pos.y += burst * 1.5;
      pos.xy *= 1.0 + burst * 0.1;
      vAlpha *= 1.0 + burst * 0.3;
      maxRippleAmp = max(maxRippleAmp, burst * 0.12);
    }
  }

  // ====================================================
  //  鼠标交互 (仅 SILK)
  // ====================================================
  if (uMouseActive > 0.5 && uPreset < 0.5) {
    float mdx = pos.x - uMouseXY.x;
    float mdy = pos.y - uMouseXY.y;
    float md = sqrt(mdx*mdx + mdy*mdy);
    if (md < 1.0) {
      float push = (1.0 - md) * (1.0 - md);
      pos.z += push * 0.55;
    }
  }

  // ====================================================
  //  v8 手势遮挡 — uHandActive 是 0..1 平滑过渡, 大半径推开
  // ====================================================
  if (uHandActive > 0.01) {
    float hdx = pos.x - uHandXY.x;
    float hdy = pos.y - uHandXY.y;
    float hd = sqrt(hdx*hdx + hdy*hdy);
    float rad = 1.55;
    if (hd < rad) {
      float push = (rad - hd) / rad;
      push = push * push * uHandActive;
      pos.z += push * 1.10;
      vec2 outDir = vec2(hdx, hdy) / max(0.001, hd);
      pos.xy += outDir * push * 0.28;
    }
  }
  if (uGestureGrip > 0.001) {
    float grip = clamp(uGestureGrip, 0.0, 1.0);
    float gripWave = 0.5 + 0.5 * sin(uTime * 2.2 + aRand * 6.2831);
    pos.xy *= mix(1.0, 0.66 + gripWave * 0.035, grip);
    pos.z += grip * (0.18 + uBass * 0.22 + gripWave * 0.10);
  }

  // ====================================================
  //  通用: 离散感 / 扭曲
  // ====================================================
  if (uScatter > 0.001) {
    vec2 jdir = vec2(cos(aRand * 6.2831), sin(aRand * 6.2831));
    pos.xy += jdir * uScatter * (0.05 + uTreble * 0.10);
  }
  if (uTwist > 0.001 && uPreset < 0.5) {
    float ta = uTwist * pos.z * 0.6;
    float cs = cos(ta), sn = sin(ta);
    pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
  }

  // 颜色
  float vinylHiResGuard = smoothstep(1.08, 1.55, uCoverRes) * step(3.5, uPreset) * (1.0 - step(4.5, uPreset));
  float edgeBoost = uEdgeEnabled * edgeVal * mix(1.0, 0.42, vinylHiResGuard);
  vSourceLum = dot(max(vColor, vec3(0.0)), vec3(0.299, 0.587, 0.114));
  float blackParticleGuard = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  vEdgeBoost = edgeBoost * (uPreset > 3.5 ? 0.22 : 1.0) * (1.0 - blackParticleGuard);
  vColor = pow(max(vColor, vec3(0.0)), vec3(1.0 / max(0.35, uColorBoost)));
  float edgeColorMix = edgeBoost * (uPreset > 3.5 ? 0.20 : 0.50) * (1.0 - blackParticleGuard);
  vColor = mix(vColor, vColor + vec3(0.20), edgeColorMix);
  float tintLum = max(max(vColor.r, vColor.g), vColor.b);
  vec3 tintedColor = uTintColor * max(0.24, tintLum * 1.12);
  vColor = mix(vColor, tintedColor, clamp(uTintStrength, 0.0, 1.0) * (1.0 - blackParticleGuard));

  vBright = 0.82 + maxRippleAmp * 0.55 + uBass * 0.10 + edgeBoost * 0.30 + uEnergy * 0.05 + uBurstAmt * 0.40;
  if (uPreset > 4.5) {
    vBright = 0.94 + maxRippleAmp * 0.34 + uBass * 0.020 + uEnergy * 0.026 + uBurstAmt * 0.025;
  } else if (uPreset > 3.5) {
    vBright = 0.94 + maxRippleAmp * 0.64 + uBass * 0.08 + edgeBoost * 0.12 + uEnergy * 0.05 + uBeat * 0.16 + uBurstAmt * 0.16;
  }
  vRipple = clamp(maxRippleAmp * 1.5, 0.0, 1.0);

  if (uHasDepth > 0.5 && uPreset < 0.5) {
    float bgMul = mix(1.0, 0.55, uBgFade * (1.0 - fgMask));
    vBright *= bgMul;
  }
  vBright += uGestureGrip * 0.22;
  float loadingMistSize = 1.0;

  // 加载形态: 雾状微尘流，避免廉价旋转圆环
  if (uLoading > 0.001) {
    float mistSeed = hash11(aRand * 931.7);
    float mistLayer = floor(mistSeed * 4.0);
    float layerN = (mistLayer + 0.5) / 4.0;
    float mistAngle = aRand * 6.2831 + uTime * (0.16 + mistSeed * 0.18) + snoise(vec3(aRand * 2.1, uTime * 0.24, 2.0)) * 1.85;
    float mistR = mix(1.35, 3.15, sqrt(hash11(aRand * 127.3))) * (1.0 + sin(uTime * 0.42 + aRand * 7.0) * 0.13);
    vec2 mistCurl = vec2(
      snoise(vec3(aRand * 4.1, uTime * 0.32, 3.0)),
      snoise(vec3(aRand * 4.7, uTime * 0.30, 8.0))
    );
    float mistBreath = 0.5 + 0.5 * sin(uTime * (0.82 + mistSeed * 0.55) + aRand * 17.0);
    float mistRibbon = sin(mistAngle * (1.35 + layerN * 0.55) + uTime * 0.34 + mistSeed * 4.0);
    float glowPick = smoothstep(0.88, 0.997, hash11(aRand * 1501.0 + mistLayer * 17.0));
    float dustPick = 0.34 + glowPick * 0.66;
    vec3 mistPos = vec3(
      cos(mistAngle) * mistR * (1.24 + mistCurl.x * 0.16) + mistCurl.x * 0.72,
      sin(mistAngle * 0.82 + mistRibbon * 0.25) * mistR * (0.56 + layerN * 0.10) + mistCurl.y * 0.62,
      (layerN - 0.5) * 4.85 + mistCurl.x * 0.56 + mistBreath * 0.36 + mistRibbon * 0.24
    );
    vec3 mistCol = mix(vec3(0.62, 0.86, 0.84), vec3(0.36, 0.46, 0.78), mistSeed);
    mistCol = mix(mistCol, vec3(0.94, 1.0, 0.97), glowPick * (0.45 + mistBreath * 0.35));
    vColor = mix(vColor, mistCol, uLoading * 0.78);
    vBright = mix(vBright, 0.20 + mistBreath * 0.18 + abs(mistCurl.x) * 0.06 + glowPick * (0.72 + abs(mistRibbon) * 0.24), uLoading);
    vAlpha = mix(vAlpha, 0.08 + mistBreath * 0.11 + dustPick * 0.11 + glowPick * 0.30, uLoading);
    pos = mix(pos, mistPos, uLoading);
    loadingMistSize = 1.26 + mistBreath * 0.24 + abs(mistRibbon) * 0.14 + glowPick * 0.78;
  }

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 36.0 / max(0.5, -mvPos.z);
  float audioBoost = 1.0 + maxRippleAmp * 0.7 + edgeBoost * 0.55 + uBeat * 0.30 + uBurstAmt * 0.5;
  float sz = clamp(depthSize * audioBoost, 1.05, 4.95);
  if (uPreset > 4.5) {
    float flowDrive = uBass * 0.070 + uMid * 0.046 + uTreble * 0.060 + uBurstAmt * 0.090 + uBeat * 0.055;
    sz = clamp(depthSize * (1.05 + flowDrive), 1.00, 5.45);
    // 黑洞预设：粒子稍大更软，提供颗粒质感（raymarch 层是主体）
    if (uPreset > 7.5 && uPreset < 8.5) {
      sz = clamp(depthSize * (1.30 + flowDrive * 0.7), 1.35, 5.60);
    }
  } else if (uPreset > 3.5) {
    float ringDrive = uBass * 0.30 + uMid * 0.18 + uTreble * 0.22 + uBeat * 0.30;
    sz = clamp(depthSize * (0.90 + ringDrive * 0.62), 1.05, 3.90);
  }
  // 加载态下粒子稍大
  sz = mix(sz, sz * loadingMistSize, uLoading);
  // 隔帧子集时略放大，抵消半量点带来的稀疏感（P1.5 网格更稀时补偿稍强）
  sz *= mix(1.0, 1.18, step(0.5, uTemporalSubset));
  gl_PointSize = sz * uPixel * uPointScale;

  gl_Position = projectionMatrix * mvPos;
}
`;

// ----- 片元 Shader -----
var fs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uPreset, uParticleDim;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = vColor * vBright;
  col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
  col = mix(col, col * 1.2, vRipple * 0.4);
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float nonBlack = 1.0 - keepBlack;
  float dotDist = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float readableRim = smoothstep(0.44, 0.94, dotDist) * (1.0 - smoothstep(0.94, 1.08, dotDist)) * tex.a;
  float outLum = dot(col, vec3(0.299, 0.587, 0.114));
  float lightParticle = smoothstep(0.50, 0.82, outLum) * nonBlack;
  float darkParticle = (1.0 - smoothstep(0.20, 0.50, outLum)) * nonBlack;
  col = mix(col, vec3(0.0), readableRim * lightParticle * 0.38);
  col = mix(col, vec3(1.0), readableRim * darkParticle * 0.20);
  col = clamp(col, vec3(0.0), vec3(1.6));
  gl_FragColor = vec4(col, tex.a * uAlpha * uParticleDim * vAlpha);
}
`;

var material = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: vs, fragmentShader: fs,
  transparent: true, depthWrite: false, blending: THREE.NormalBlending,
});

var bloomVs = vs
  .replace('uniform float uMouseActive, uPixel, uColorMixT, uLoading;', 'uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;')
  .replace('gl_PointSize = sz * uPixel * uPointScale;', 'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;');
var bloomFs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uBloomStrength, uPreset, uParticleDim;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.01) discard;
  float soft = tex.a * tex.a;
  vec3 col = vColor * (0.55 + vBright * 0.62);
  col = mix(col, col + vec3(0.22, 0.18, 0.10), vEdgeBoost * 0.35);
  col = clamp(col, vec3(0.0), vec3(1.8));
  float pulse = 1.0 + vRipple * 0.65;
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float bloomKeep = 1.0 - keepBlack * 0.92;
  gl_FragColor = vec4(col, soft * uAlpha * uBloomStrength * uParticleDim * pulse * 0.55 * vAlpha * bloomKeep);
}
`;
var bloomMaterial = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: bloomVs, fragmentShader: bloomFs,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});
var bloomParticles = new THREE.Points(geo, bloomMaterial);
bloomParticles.frustumCulled = false;
bloomParticles.renderOrder = 0;
scene.add(bloomParticles);
var particles = new THREE.Points(geo, material);
particles.frustumCulled = false;
particles.renderOrder = 1;
scene.add(particles);

// ============================================================
//  黑洞预设 (Preset 8)：完整移植 dgreenheck/webgpu-black-hole（WebGL+GLSL 版）
//  引擎：THREE.ShaderMaterial 全屏 raymarching → 离屏半分辨率 RT → 主场景采样放大
//  物理：史瓦西时空光线弯曲（a = -rs/r² · lensing）、黑体辐射 LUT（Mitchell Charity 表）、
//        多普勒集束 D³、开普勒差速湍流（FBM 4 octaves, lacunarity 3, persistence 0.8）
//  固定值（参考版 defaultConfig，不暴露 UI）：mass 0.4(rs=0.8)、盘 4.1~14.5、
//        峰温 49780K / falloff 5.22、亮度 5、转速 -8.7、湍流 scale 1.81 / stretch 0.75 /
//        sharpness 7.4 / cycle 5、边缘软 0.18/0.5、lensing 2.4、步长 1 × 64 步
//  音乐律动系统（AGC 自适应增益 + 多层联动）：
//    AGC：JS 慢速跟踪歌曲能量 min/max 实时归一化 0~1，任何歌曲/音量用满动态范围。
//    黑洞本体：rs 随 bass 脉动（阴影呼吸）+ 光子环（轮廓亮环）随 bass/beat 脉冲。
//    阴影半透（78%）：被吞光线按最终弯曲方向采样星场——中心透出被引力扭曲的背景，
//    越靠边缘扭曲越强（物理透镜漩涡）；吸积盘线条鲜艳度 = 饱和度 1.45x + 弧线高亮 1.9x。
//    吸积盘：亮度包络（能量）+ 宽度呼吸（能量/beat）+ 转速调制（能量）。
//    湍流防缠绕：周期交叉淡化（JS 跟踪周期边界相位，传有界剪切值），任何转速变化下无缝。
//    beat 补偿：主循环 wallpaperAudio 组压制 46%，JS 侧恢复原始冲击幅度。
//    背景星空/星云保持参考版原味，不随音频/封面变化。
//  封面色：仅吸积盘取封面调色板双色 ramp（primary=内缘热区 / rawWarm=外缘冷区），
//        无封面时回退参考版暖橙默认色。
//  性能：0.5x 离屏渲染（raymarch 像素成本 ÷4，不受高 DPR 屏放大）、64 步上限 +
//        逃逸/捕获/不透明早退、星场单层网格（参考版原样）。
// ============================================================

// ---- 黑体辐射 LUT（Mitchell Charity 表，1000K-40000K，sRGB）----
var BLACKBODY_COLORS = {
  1000: [1, 0.0337, 0], 1100: [1, 0.0592, 0], 1200: [1, 0.0846, 0], 1300: [1, 0.1096, 0], 1400: [1, 0.1341, 0],
  1500: [1, 0.1578, 0], 1600: [1, 0.1806, 0], 1700: [1, 0.2025, 0], 1800: [1, 0.2235, 0], 1900: [1, 0.2434, 0],
  2000: [1, 0.2647, 0.0033], 2100: [1, 0.2889, 0.012], 2200: [1, 0.3126, 0.0219], 2300: [1, 0.336, 0.0331], 2400: [1, 0.3589, 0.0454],
  2500: [1, 0.3814, 0.0588], 2600: [1, 0.4034, 0.0734], 2700: [1, 0.425, 0.0889], 2800: [1, 0.4461, 0.1054], 2900: [1, 0.4668, 0.1229],
  3000: [1, 0.487, 0.1411], 3100: [1, 0.5067, 0.1602], 3200: [1, 0.5259, 0.18], 3300: [1, 0.5447, 0.2005], 3400: [1, 0.563, 0.2216],
  3500: [1, 0.5809, 0.2433], 3600: [1, 0.5983, 0.2655], 3700: [1, 0.6153, 0.2881], 3800: [1, 0.6318, 0.3112], 3900: [1, 0.648, 0.3346],
  4000: [1, 0.6636, 0.3583], 4100: [1, 0.6789, 0.3823], 4200: [1, 0.6938, 0.4066], 4300: [1, 0.7083, 0.431], 4400: [1, 0.7223, 0.4556],
  4500: [1, 0.736, 0.4803], 4600: [1, 0.7494, 0.5051], 4700: [1, 0.7623, 0.5299], 4800: [1, 0.775, 0.5548], 4900: [1, 0.7872, 0.5797],
  5000: [1, 0.7992, 0.6045], 5100: [1, 0.8108, 0.6293], 5200: [1, 0.8221, 0.6541], 5300: [1, 0.833, 0.6787], 5400: [1, 0.8437, 0.7032],
  5500: [1, 0.8541, 0.7277], 5600: [1, 0.8642, 0.7519], 5700: [1, 0.874, 0.776], 5800: [1, 0.8836, 0.8], 5900: [1, 0.8929, 0.8238],
  6000: [1, 0.9019, 0.8473], 6100: [1, 0.9107, 0.8707], 6200: [1, 0.9193, 0.8939], 6300: [1, 0.9276, 0.9168], 6400: [1, 0.9357, 0.9396],
  6500: [1, 0.9436, 0.9621], 6600: [1, 0.9513, 0.9844], 6700: [0.9937, 0.9526, 1], 6800: [0.9726, 0.9395, 1], 6900: [0.9526, 0.927, 1],
  7000: [0.9337, 0.915, 1], 7100: [0.9157, 0.9035, 1], 7200: [0.8986, 0.8925, 1], 7300: [0.8823, 0.8819, 1], 7400: [0.8668, 0.8718, 1],
  7500: [0.852, 0.8621, 1], 7600: [0.8379, 0.8527, 1], 7700: [0.8244, 0.8437, 1], 7800: [0.8115, 0.8351, 1], 7900: [0.7992, 0.8268, 1],
  8000: [0.7874, 0.8187, 1], 8100: [0.7761, 0.811, 1], 8200: [0.7652, 0.8035, 1], 8300: [0.7548, 0.7963, 1], 8400: [0.7449, 0.7894, 1],
  8500: [0.7353, 0.7827, 1], 8600: [0.726, 0.7762, 1], 8700: [0.7172, 0.7699, 1], 8800: [0.7086, 0.7638, 1], 8900: [0.7004, 0.7579, 1],
  9000: [0.6925, 0.7522, 1], 9100: [0.6848, 0.7467, 1], 9200: [0.6774, 0.7414, 1], 9300: [0.6703, 0.7362, 1], 9400: [0.6635, 0.7311, 1],
  9500: [0.6568, 0.7263, 1], 9600: [0.6504, 0.7215, 1], 9700: [0.6442, 0.7169, 1], 9800: [0.6382, 0.7124, 1], 9900: [0.6324, 0.7081, 1],
  10000: [0.6268, 0.7039, 1], 11000: [0.5791, 0.6674, 1], 12000: [0.5431, 0.6389, 1], 13000: [0.5152, 0.6162, 1], 14000: [0.493, 0.5978, 1],
  15000: [0.4749, 0.5824, 1], 16000: [0.4599, 0.5696, 1], 17000: [0.4474, 0.5586, 1], 18000: [0.4367, 0.5492, 1], 19000: [0.4275, 0.541, 1],
  20000: [0.4196, 0.5339, 1], 25000: [0.3917, 0.5083, 1], 30000: [0.3751, 0.4926, 1], 35000: [0.3641, 0.4821, 1], 40000: [0.3563, 0.4745, 1]
};
var _bbTempsSorted = null;
function _bbLookup(tempK) {
  if (!_bbTempsSorted) {
    _bbTempsSorted = Object.keys(BLACKBODY_COLORS).map(Number).sort(function (a, b) { return a - b; });
  }
  var c = Math.max(1000, Math.min(40000, tempK));
  var lo = _bbTempsSorted[0], hi = _bbTempsSorted[0];
  for (var i = 0; i < _bbTempsSorted.length - 1; i++) {
    if (c >= _bbTempsSorted[i] && c <= _bbTempsSorted[i + 1]) {
      lo = _bbTempsSorted[i]; hi = _bbTempsSorted[i + 1];
      break;
    }
  }
  var t = hi === lo ? 0 : (c - lo) / (hi - lo);
  var a = BLACKBODY_COLORS[lo], b = BLACKBODY_COLORS[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
// 1D LUT 纹理（256x1 RGBA）：温度 → 黑体 RGB，线性采样
function _createBlackbodyLUT(samples) {
  samples = samples || 256;
  var data = new Uint8Array(samples * 4);
  for (var i = 0; i < samples; i++) {
    var tempK = 1000 + 39000 * i / (samples - 1);
    var c = _bbLookup(tempK);
    data[i * 4] = Math.round(c[0] * 255);
    data[i * 4 + 1] = Math.round(c[1] * 255);
    data[i * 4 + 2] = Math.round(c[2] * 255);
    data[i * 4 + 3] = 255;
  }
  var tex = new THREE.DataTexture(data, samples, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---- 全屏 NDC quad 顶点着色器（raymarch 与显示层共用）----
var _bhVert = 'varying vec2 vUv;\n' +
  'void main() {\n' +
  '  vUv = uv;\n' +
  '  gl_Position = vec4(position.xy, 0.0, 1.0);\n' +
  '}\n';

// ---- Raymarching 材质（渲染到离屏 RT，参考版 blackhole-shader.js 完整移植）----
var blackHoleLensGeo = new THREE.PlaneGeometry(2, 2);
var bhRaymarchMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:       { value: 0 },
    uBass:       { value: 0 },
    uBeat:       { value: 0 },
    uEnergy:     { value: 0 },
    uSpinShearNew: { value: 0 },   // 本湍流周期实例的剪切相位（有界，防缠绕）
    uSpinShearOld: { value: 0 },   // 上一周期实例的剪切相位（有界）
    uCycleBlend:   { value: 0 },   // 周期内交叉淡化进度 0→1
    uAccretion:  { value: 0.35 },
    uResolution: { value: new THREE.Vector2(960, 540) },
    uCamPos:     { value: new THREE.Vector3(0, -5, 20) },
    uCamFwd:     { value: new THREE.Vector3(0, 0, -1) },
    uCamRight:   { value: new THREE.Vector3(1, 0, 0) },
    uCamUp:      { value: new THREE.Vector3(0, 1, 0) },
    uFocal:      { value: 1.732 },
    uTintColor:  { value: new THREE.Color('#ff8c42') },   // 封面主色（内缘热区）
    uTint2Color: { value: new THREE.Color('#7f1b00') },   // 封面暖副色（外缘冷区）
    uTintStrength: { value: 0.78 },                        // 盘色向封面 ramp 的混合强度
    uBlackbodyLUT: { value: _createBlackbodyLUT(256) },
  },
  vertexShader: _bhVert,
  fragmentShader:
    'precision highp float;\n' +
    'varying vec2 vUv;\n' +
    'uniform vec2 uResolution;\n' +
    'uniform float uTime, uBass, uBeat, uEnergy, uAccretion, uFocal, uTintStrength;\n' +
    'uniform float uSpinShearNew, uSpinShearOld, uCycleBlend;\n' +
    'uniform vec3 uCamPos, uCamFwd, uCamRight, uCamUp;\n' +
    'uniform vec3 uTintColor, uTint2Color;\n' +
    'uniform sampler2D uBlackbodyLUT;\n' +
    '\n' +
    '// ---- 哈希 / 噪声（参考版原样）----\n' +
    'float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float hash31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\n' +
    'vec2 hash22(vec2 p) {\n' +
    '  return vec2(fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),\n' +
    '              fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453));\n' +
    '}\n' +
    'float noise3D(vec3 p) {\n' +
    '  vec3 i = floor(p);\n' +
    '  vec3 f = fract(p);\n' +
    '  vec3 u = f * f * (3.0 - 2.0 * f);\n' +
    '  float a = hash31(i);\n' +
    '  float b = hash31(i + vec3(1.0, 0.0, 0.0));\n' +
    '  float c = hash31(i + vec3(0.0, 1.0, 0.0));\n' +
    '  float d = hash31(i + vec3(1.0, 1.0, 0.0));\n' +
    '  float e = hash31(i + vec3(0.0, 0.0, 1.0));\n' +
    '  float f2 = hash31(i + vec3(1.0, 0.0, 1.0));\n' +
    '  float g = hash31(i + vec3(0.0, 1.0, 1.0));\n' +
    '  float h = hash31(i + vec3(1.0, 1.0, 1.0));\n' +
    '  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),\n' +
    '             mix(mix(e, f2, u.x), mix(g, h, u.x), u.y), u.z);\n' +
    '}\n' +
    '// FBM：4 octaves，lacunarity 3.0 / persistence 0.8（参考版默认）\n' +
    'float fbm(vec3 p) {\n' +
    '  float value = 0.0;\n' +
    '  float amplitude = 0.5;\n' +
    '  value += amplitude * noise3D(p); p *= 3.0; amplitude *= 0.8;\n' +
    '  value += amplitude * noise3D(p); p *= 3.0; amplitude *= 0.8;\n' +
    '  value += amplitude * noise3D(p); p *= 3.0; amplitude *= 0.8;\n' +
    '  value += amplitude * noise3D(p);\n' +
    '  return value;\n' +
    '}\n' +
    '\n' +
    '// ---- 黑体辐射配色（LUT 采样，1000K-40000K）----\n' +
    'vec3 blackbodyColor(float tempK) {\n' +
    '  float temp = clamp(tempK, 1000.0, 40000.0);\n' +
    '  float t = (temp - 1000.0) / 39000.0;\n' +
    '  return texture2D(uBlackbodyLUT, vec2(t, 0.5)).rgb;\n' +
    '}\n' +
    '\n' +
    '// ---- 程序化星场（单层网格，密度 0.1 / 尺寸 1.2 / 亮度 0.1）----\n' +
    'vec3 starField(vec3 rayDir) {\n' +
    '  float theta = atan(rayDir.z, rayDir.x);\n' +
    '  float phi = asin(clamp(rayDir.y, -1.0, 1.0));\n' +
    '  float gridScale = 50.0;\n' +
    '  vec2 scaledCoord = vec2(theta, phi) * gridScale;\n' +
    '  vec2 cell = floor(scaledCoord);\n' +
    '  vec2 cellUV = fract(scaledCoord);\n' +
    '  float cellHash = hash21(cell);\n' +
    '  float starProb = step(0.9, cellHash);\n' +
    '  vec2 starPos = hash22(cell + 42.0) * 0.8 + 0.1;\n' +
    '  float distToStar = length(cellUV - starPos);\n' +
    '  float baseSizeVar = hash21(cell + 100.0) * 0.03 + 0.01;\n' +
    '  float finalStarSize = baseSizeVar * 1.2;\n' +
    '  float starCore = smoothstep(finalStarSize, 0.0, distToStar);\n' +
    '  float starGlow = smoothstep(finalStarSize * 3.0, 0.0, distToStar) * 0.3;\n' +
    '  float starIntensity = (starCore + starGlow) * starProb;\n' +
    '  float colorTemp = hash21(cell + 200.0);\n' +
    '  vec3 starColor = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.95, 0.8), colorTemp);\n' +
    '  return starColor * starIntensity * 0.1;\n' +
    '}\n' +
    '\n' +
    '// ---- 双层星云（参考版原味配色，不随封面/音频变化）----\n' +
    'vec3 nebulaField(vec3 rayDir) {\n' +
    '  float n1 = fbm(rayDir * 2.0) * 2.0 - 1.0;\n' +
    '  float layer1 = clamp(n1 + 0.5, 0.0, 1.0);\n' +
    '  float n2 = fbm(rayDir * 5.5) * 2.0 - 1.0;\n' +
    '  float layer2 = clamp(n2 + 0.05, 0.0, 1.0);\n' +
    '  return vec3(0.027, 0.122, 0.267) * layer1 * 0.01 + vec3(0.004, 0.024, 0.082) * layer2 * 0.21;\n' +
    '}\n' +
    '\n' +
    '// ---- 吸积盘：封面色 ramp + 音频亮度 + 多普勒集束 D³ + 开普勒差速湍流 ----\n' +
    'vec4 accretionDiskColor(float hitR, float hitAngle, float time, vec3 rayDir, float innerR, float outerR) {\n' +
    '  float normR = clamp((hitR - innerR) / (outerR - innerR), 0.0, 1.0);\n' +
    '  float peakTempK = 49780.0 + uBass * 3600.0;\n' +
    '  float tempK = peakTempK * pow(innerR / hitR, 5.22);\n' +
    '  vec3 diskCol = blackbodyColor(tempK);\n' +
    '  // 封面色卡映射：黑体温度梯度 → 封面双色 ramp（内热=主色，外冷=暖副色），保留 22% 物理黑体\n' +
    '  float tempNorm = clamp(tempK / 40000.0, 0.0, 1.0);\n' +
    '  vec3 coverRamp = mix(uTint2Color * 0.32, uTintColor * 1.18, tempNorm);\n' +
    '  diskCol = mix(diskCol, coverRamp, uTintStrength);\n' +
    '  // 线条鲜艳度：饱和度增强（ACES 色调映射会压饱和，先超配 45% 补偿）\n' +
    '  float satLum = dot(diskCol, vec3(0.299, 0.587, 0.114));\n' +
    '  diskCol = mix(vec3(satLum), diskCol, 1.45);\n' +
    '  float rotationSign = -1.0;\n' +
    '  vec3 velocityDir = vec3(-sin(hitAngle) * rotationSign, 0.0, cos(hitAngle) * rotationSign);\n' +
    '  float velocityMagnitude = 1.0 / sqrt(hitR / innerR);\n' +
    '  float beta = velocityMagnitude * 0.3;\n' +
    '  float cosTheta = dot(velocityDir, rayDir);\n' +
    '  float dopplerFactor = 1.0 / (1.0 - beta * cosTheta);\n' +
    '  float dopplerBoost = pow(dopplerFactor, 3.0);\n' +
    '  diskCol *= clamp(dopplerBoost, 0.1, 5.0);\n' +
    '  float edgeFalloff = smoothstep(0.0, 0.18, normR) * smoothstep(1.0, 0.5, normR);\n' +
    '  // 湍流周期交叉淡化（无缝构造）：新实例（本周期起点起算，淡入）与旧实例\n' +
    '  // （上一周期起点起算，淡出）。周期边界 blend 1→0 时，两侧显示同一剪切值 Δ，\n' +
    '  // 数学上无缝；剪切始终有界（≤2 个周期量），转速随音频变化也不跳变。\n' +
    '  float blendFactor = uCycleBlend;\n' +
    '  float k1 = uSpinShearNew / pow(hitR, 1.5);\n' +
    '  float k2 = uSpinShearOld / pow(hitR, 1.5);\n' +
    '  float a1 = hitAngle + k1;\n' +
    '  float a2 = hitAngle + k2;\n' +
    '  float stretch = 0.75;\n' +
    '  vec3 nc1 = vec3(hitR * 1.81, cos(a1) / stretch, sin(a1) / stretch);\n' +
    '  vec3 nc2 = vec3(hitR * 1.81, cos(a2) / stretch, sin(a2) / stretch);\n' +
    '  float turb = mix(fbm(nc2), fbm(nc1), blendFactor);\n' +
    '  float ringOpacity = pow(clamp(turb, 0.0, 1.0), 8.0);\n' +
    '  float finalOpacity = ringOpacity * edgeFalloff;\n' +
    '  // 明亮弧线高亮：湍流峰值处提亮，让"线条"从弥漫盘中跳出来\n' +
    '  float filament = smoothstep(0.40, 0.92, turb);\n' +
    '  // 音频亮度：smoothstep 重映射拉大能量动态范围（audioEnergy 平滑重、范围窄），\n' +
    '  // 安静段 = 深暗（0.85x），副歌 = 炽亮（7.6x），节拍瞬间再短促提亮\n' +
    '  float energyCurve = smoothstep(0.06, 0.52, uEnergy);\n' +
    '  float energyBright = 0.85 + energyCurve * 6.8 + uBeat * 1.15;\n' +
    '  float accretionDim = 0.42 + uAccretion * 0.72;\n' +
    '  vec3 finalColor = diskCol * energyBright * accretionDim * (1.0 + filament * 0.90);\n' +
    '  return vec4(finalColor, finalOpacity);\n' +
    '}\n' +
    '\n' +
    'void main() {\n' +
    '  // 黑洞本体呼吸：史瓦西半径随 bass 脉动（鼓点黑洞膨胀），节拍瞬间再冲击\n' +
    '  float rs = 0.8 * (1.0 + uBass * 0.22 + uBeat * 0.08);\n' +
    '  float aspect = uResolution.x / uResolution.y;\n' +
    '  vec2 ndc = vUv * 2.0 - 1.0;\n' +
    '  vec3 rayDir = normalize(uCamFwd * uFocal + uCamRight * ndc.x * aspect + uCamUp * ndc.y);\n' +
    '  vec3 rayPos = uCamPos;\n' +
    '  vec3 prevPos = uCamPos;\n' +
    '  vec3 col = vec3(0.0);\n' +
    '  float alpha = 0.0;\n' +
    '  float escaped = 0.0;\n' +
    '  float captured = 0.0;\n' +
    '  vec3 capturedDir = rayDir;\n' +   // 捕获时刻的弯曲方向（阴影内扭曲背景采样）
    '  float minR = 1e9;\n' +   // 光线最接近点（光子环检测）
    '  // 盘宽度音频联动：外缘随能量扩张（副歌宽/安静窄），内缘轻微内收增强宽度感；\n' +
    '  // 节拍叠加瞬时膨胀脉冲（与亮度提亮同步，形成呼吸感）。\n' +
    '  float energyCurve = smoothstep(0.10, 0.80, uEnergy);\n' +
    '  float innerR = 4.1 - uAccretion * 0.5 - energyCurve * 0.45;\n' +
    '  float outerR = 14.5 + uAccretion * 1.2 + (energyCurve - 0.30) * 2.8 + uBeat * 0.40;\n' +
    '  for (int i = 0; i < 64; i++) {\n' +
    '    if (escaped > 0.5 || captured > 0.5 || alpha > 0.99) break;\n' +
    '    float r = length(rayPos);\n' +
    '    minR = min(minR, r);\n' +
    '    if (r < rs * 1.01) { captured = 1.0; capturedDir = rayDir; break; }\n' +
    '    if (r > 100.0) { escaped = 1.0; break; }\n' +
    '    vec3 toCenter = -rayPos / r;\n' +
    '    float bendStrength = rs / (r * r) * 2.4;\n' +
    '    rayDir += toCenter * bendStrength;\n' +
    '    rayDir = normalize(rayDir);\n' +
    '    prevPos = rayPos;\n' +
    '    rayPos += rayDir * 1.0;\n' +
    '    if (prevPos.y * rayPos.y < 0.0 && alpha < 0.99) {\n' +
    '      float t = -prevPos.y / (rayPos.y - prevPos.y);\n' +
    '      vec3 hitPos = mix(prevPos, rayPos, t);\n' +
    '      float hitR = sqrt(hitPos.x * hitPos.x + hitPos.z * hitPos.z);\n' +
    '      if (hitR > innerR && hitR < outerR) {\n' +
    '        float hitAngle = atan(hitPos.z, hitPos.x);\n' +
    '        vec4 diskResult = accretionDiskColor(hitR, hitAngle, uTime, rayDir, innerR, outerR);\n' +
    '        float remainingAlpha = 1.0 - alpha;\n' +
    '        col += diskResult.rgb * diskResult.a * remainingAlpha;\n' +
    '        alpha += remainingAlpha * diskResult.a;\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '  if (captured < 0.5) escaped = 1.0;   // 64 步用完的绕行光线也按逃逸处理\n' +
    '  // 光子环律动：逃逸光线中曾贴着光子球（~1.5rs）绕行的，屏幕投影在阴影边缘，\n' +
    '  // 形成黑洞轮廓亮环（爱因斯坦环）；亮度随 bass 呼吸、节拍闪光——最直观的律动部位\n' +
    '  if (escaped > 0.5) {\n' +
    '    float photonBand = smoothstep(2.4 * rs, 1.7 * rs, minR) * smoothstep(1.08 * rs, 1.35 * rs, minR);\n' +
    '    float ringPulse = 0.35 + uBass * 1.40 + uBeat * 0.70;\n' +
    '    vec3 ringCol = mix(uTintColor, vec3(1.0), 0.30) * ringPulse;\n' +
    '    col += ringCol * photonBand * (1.0 - alpha * 0.75) * 0.85;\n' +
    '  }\n' +
    '  if (captured > 0.5) {\n' +
    '    // 阴影半透：被吞光线按最终弯曲方向采样星场——中心透出被引力扭曲的背景。\n' +
    '    // 越靠近阴影边缘，光线绕行越多、方向偏转越大，扭曲越明显（物理真实的透镜漩涡）\n' +
    '    col += starField(capturedDir) * 0.55;\n' +
    '  }\n' +
    '  if (escaped > 0.5 && alpha < 0.99) {\n' +
    '    // 背景透明化：只保留星星（不占 alpha，叠加发光），星云移除\n' +
    '    col += starField(rayDir) * (1.0 - alpha);\n' +
    '  }\n' +
    '  // Narkowicz ACES 近似（替代参考版 renderer ACESFilmic）+ gamma\n' +
    '  col = clamp(col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);\n' +
    '  col = pow(col, vec3(1.0 / 2.2));\n' +
    '  // 阴影 78% 不透明：透出 22% 场景背景 + 弯曲方向采样的扭曲星场幽灵像\n' +
    '  gl_FragColor = vec4(col, max(alpha, captured * 0.78));\n' +
    '}\n',
  depthTest: false,
  depthWrite: false,
});

// ---- 离屏降分辨率 RT：raymarch 逐像素成本高，0.75x + 线性放大（锐度与负载的平衡点）----
var BH_RT_SCALE = 0.75;
var bhRT = null;
var bhRTScene = new THREE.Scene();
var bhRTCam = new THREE.Camera();
var bhRTQuad = new THREE.Mesh(blackHoleLensGeo, bhRaymarchMat);
bhRTQuad.frustumCulled = false;
bhRTScene.add(bhRTQuad);
function ensureBlackHoleRT(w, h) {
  // 基于主 canvas drawingBuffer（物理像素）：与 DPR 无关，放大倍数恒定 1/BH_RT_SCALE
  var rw = Math.max(320, Math.round(w * BH_RT_SCALE));
  var rh = Math.max(240, Math.round(h * BH_RT_SCALE));
  var cur = bhRaymarchMat.uniforms.uResolution.value;
  if (bhRT && cur.x === rw && cur.y === rh) return;
  if (bhRT) bhRT.dispose();
  bhRT = new THREE.WebGLRenderTarget(rw, rh, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  blackHoleLensMat.uniforms.uTex.value = bhRT.texture;
  bhRaymarchMat.uniforms.uResolution.value.set(rw, rh);
}

// ---- 显示层：主场景中的全屏 quad，采样 RT 纹理（renderOrder -10，先于粒子）----
// 预乘 alpha 混合：RT 的 rgb 是按覆盖率预累积的（盘/环），背景 alpha=0 处纯叠加（星星发光
// 透在场景背景上），盘/阴影处按 alpha 遮罩——黑洞本体实、背景透明。
var blackHoleLensMat = new THREE.ShaderMaterial({
  uniforms: {
    uTex:   { value: null },
    uAlpha: { value: 0 },
  },
  vertexShader: _bhVert,
  fragmentShader:
    'precision highp float;\n' +
    'varying vec2 vUv;\n' +
    'uniform sampler2D uTex;\n' +
    'uniform float uAlpha;\n' +
    'void main() {\n' +
    '  vec4 t = texture2D(uTex, vUv);\n' +
    '  gl_FragColor = vec4(t.rgb * uAlpha, t.a * uAlpha);\n' +
    '}\n',
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
});
var blackHoleLensPlane = new THREE.Mesh(blackHoleLensGeo, blackHoleLensMat);
blackHoleLensPlane.renderOrder = -10;   // 先渲染：作为所有粒子背后的背景层
blackHoleLensPlane.frustumCulled = false;
blackHoleLensPlane.visible = false;
scene.add(blackHoleLensPlane);
var blackHoleLensFadeStart = 0;
var BLACKHOLE_LENS_FADE_DURATION = 1600; // ms
var _bhLensTintCache = { key: null };

// 长时标吸积/蒸发状态（音画叙事保留）：
// 音频能量 = 喂食率（副歌段盘壮大炽盛），安静 = 霍金蒸发（间奏/暂停缓慢坍缩黯淡）。
var _bhAccretion = 0.35;
var _bhAccretionLast = 0;

// AGC 自适应增益：慢速跟踪歌曲实际能量 min/max，实时归一化到 0~1 全域。
// 解决不同歌曲/音量下 audioEnergy 动态范围窄、律动不可感知的问题。
var _bhAgc = { min: 0.06, max: 0.42, norm: 0 };
function _bhAgcUpdate(e) {
  if (e > _bhAgc.max) _bhAgc.max += (e - _bhAgc.max) * 0.10;      // 快速上跟
  else _bhAgc.max += (e - _bhAgc.max) * 0.006;                     // 慢速下落
  if (e < _bhAgc.min) _bhAgc.min += (e - _bhAgc.min) * 0.10;
  else _bhAgc.min += (e - _bhAgc.min) * 0.006;
  _bhAgc.max = Math.max(_bhAgc.max, _bhAgc.min + 0.10);            // 防范围塌缩
  var n = (e - _bhAgc.min) / (_bhAgc.max - _bhAgc.min);
  _bhAgc.norm = n < 0 ? 0 : (n > 1 ? 1 : n);
}
var _bhSpinPhase = 0;
var _bhSpinLast = 0;
// 湍流周期状态：跟踪本周期/上一周期起点的积分相位（周期边界时移位），
// shader 只接收有界剪切差值，避免大数相减精度损失与图案缠绕。
var _bhCycleIndex = -1;
var _bhCycleStartPhase = 0;
var _bhPrevCycleStartPhase = 0;

// 平滑包络（VU 表动力学：快起慢落）：beat/energy/bass 原始信号是快衰减尖峰，
// 直接驱动亮度/宽度会造成高频闪烁抖动。包络化后变成"绽放→缓缓消退"的丝滑呼吸。
var _bhEnv = { beat: 0, energy: 0, bass: 0, last: 0 };
function _bhEnvUpdate(rawBeat, rawEnergy, rawBass) {
  var nowS = performance.now() / 1000;
  if (!_bhEnv.last) _bhEnv.last = nowS;
  var dt = Math.min(0.10, nowS - _bhEnv.last);
  _bhEnv.last = nowS;
  // beat：80ms 快起（冲击感保留）→ 550ms 慢落（无闪烁）
  var bUp = 1 - Math.exp(-dt / 0.080);
  var bDown = 1 - Math.exp(-dt / 0.550);
  _bhEnv.beat += (rawBeat - _bhEnv.beat) * (rawBeat > _bhEnv.beat ? bUp : bDown);
  // energy：400ms 低通——整体明暗是"呼吸"不是"闪"
  var eK = 1 - Math.exp(-dt / 0.400);
  _bhEnv.energy += (rawEnergy - _bhEnv.energy) * eK;
  // bass：120ms 起 → 380ms 落
  var sUp = 1 - Math.exp(-dt / 0.120);
  var sDown = 1 - Math.exp(-dt / 0.380);
  _bhEnv.bass += (rawBass - _bhEnv.bass) * (rawBass > _bhEnv.bass ? sUp : sDown);
}

// 每帧调用（preset 8 可见时）：音频 uniform + 吸积积分 + RT 尺寸 + fade-in。
// 读取全局 bass/beatPulse/audioEnergy（主循环已算好）。
function updateBlackHoleLensFrame(camera) {
  var u = bhRaymarchMat.uniforms;
  u.uTime.value = uniforms.uTime.value;
  // beat 补偿：preset 8 属 wallpaperAudio 组，主循环把 beatPulse 压到 46%，恢复原始冲击幅度；
  // 再经包络平滑（快起慢落），冲击保留、衰减丝滑
  var rawBeat = Math.min(1, beatPulse / 0.46);
  var rawBass = Math.min(1, bass / Math.max(0.35, fx.intensity || 1));
  _bhAgcUpdate(audioEnergy);
  _bhEnvUpdate(rawBeat, _bhAgc.norm, rawBass);
  u.uBeat.value = _bhEnv.beat;
  u.uEnergy.value = _bhEnv.energy;
  u.uBass.value = _bhEnv.bass;
  // 喷流强度 = 包络能量经温和增益（真实播放能量偏低时喷流仍可见）：
  // 暂停→0（喷流消失）；播放中保底 0.18——间奏/安静段喷流变细但不熄灭，副歌粗壮。
  // （此前无保底：AGC 慢适应 + 安静段能量贴 0 → uJetStrength 归零 → 喷流在间奏整段消失）
  var jetS = _bhEnv.energy / 0.55;
  var jetLive = (typeof playing !== 'undefined') && playing && audio && !audio.paused;
  if (jetLive && jetS < 0.18) jetS = 0.18;
  uniforms.uJetStrength.value = jetS < 0 ? 0 : (jetS > 1 ? 1 : jetS);

  // ---- 转速律动积分器：能量驱动盘转速（能量高转快），积分相位保证平滑无跳变 ----
  var nowS = performance.now() / 1000;
  if (!_bhSpinLast) _bhSpinLast = nowS;
  var dtS = Math.min(0.10, nowS - _bhSpinLast);
  _bhSpinLast = nowS;
  var rotSpeed = -8.7 * (0.65 + _bhEnv.energy * 0.80);
  _bhSpinPhase += rotSpeed * dtS;
  // ---- 湍流周期交叉淡化（无缝）：JS 跟踪周期边界（基于 uTime，与 shader 同源）----
  // 周期边界时移位起点相位：旧实例 = 上周期起点起算（淡出），新实例 = 本周期起点起算（淡入）。
  // 边界两侧显示同一剪切值 → 无缝；转速随音频任意变化也不破坏衔接。
  var cycIdx = Math.floor(u.uTime.value / 5.0);
  if (cycIdx !== _bhCycleIndex) {
    if (_bhCycleIndex === -1 || cycIdx - _bhCycleIndex > 1) {
      // 首次激活 / 中断后重返：两实例同相位，全新开始
      _bhPrevCycleStartPhase = _bhSpinPhase;
      _bhCycleStartPhase = _bhSpinPhase;
    } else {
      _bhPrevCycleStartPhase = _bhCycleStartPhase;
      _bhCycleStartPhase = _bhSpinPhase;
    }
    _bhCycleIndex = cycIdx;
  }
  u.uSpinShearNew.value = _bhSpinPhase - _bhCycleStartPhase;
  u.uSpinShearOld.value = _bhSpinPhase - _bhPrevCycleStartPhase;
  u.uCycleBlend.value = u.uTime.value / 5.0 - cycIdx;

  // ---- 吸积/蒸发积分器 ----
  var nowMs = performance.now();
  var dtA = _bhAccretionLast > 0 ? Math.min(0.10, (nowMs - _bhAccretionLast) / 1000) : 0.016;
  _bhAccretionLast = nowMs;
  var feed = (audioEnergy - 0.10) / 0.45;                 // 喂食率：能量超过阈值开始吸积
  feed = feed < 0 ? 0 : (feed > 1 ? 1 : feed);
  var accRate = feed > 0.02 ? feed * 0.16 : -0.014;       // 吸积快，蒸发慢
  _bhAccretion += accRate * dtA;
  if (_bhAccretion < 0) _bhAccretion = 0;
  else if (_bhAccretion > 1) _bhAccretion = 1;
  uniforms.uAccretion.value = _bhAccretion;               // 粒子层联动
  u.uAccretion.value = _bhAccretion;

  var w = (renderer && renderer.domElement && renderer.domElement.width) || (window.innerWidth || 1);
  var h = (renderer && renderer.domElement && renderer.domElement.height) || (window.innerHeight || 1);
  ensureBlackHoleRT(w, h);

  // 封面色联动：吸积盘 ramp 取封面双色（主色=内缘热区，暖副色=外缘冷区），星云同源微染
  var pal = (typeof stageLyrics !== 'undefined' && stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette)) || null;
  if (pal && pal.primary) {
    var tint2 = pal.rawWarm || pal.secondary || pal.primary;
    var cacheKey = pal.primary + '|' + tint2;
    if (_bhLensTintCache.key !== cacheKey) {
      _bhLensTintCache.key = cacheKey;
      try {
        u.uTintColor.value.set(pal.primary);
        u.uTint2Color.value.set(tint2);
      } catch (_) {}
    }
  }
  var fade = blackHoleLensFadeStart > 0
    ? (performance.now() - blackHoleLensFadeStart) / BLACKHOLE_LENS_FADE_DURATION
    : 1;
  blackHoleLensMat.uniforms.uAlpha.value = Math.max(0, Math.min(1, fade));
}

// 主渲染前调用：相机位姿传入 raymarch + 离屏 RT 渲染。
// BH_CAM_SCALE：粒子相机轨道半径 ~9 → raymarch 有效相机距离 ~32，
// 与参考版构图匹配（fov 60° 下盘占视场 ~80%，参考版 fov 90° 下 ~78%）。
var BH_CAM_SCALE = 3.6;
function renderBlackHoleLensRT(camera) {
  if (!bhRT) return;
  var u = bhRaymarchMat.uniforms;
  try {
    camera.updateMatrixWorld();
    u.uCamPos.value.copy(camera.position).multiplyScalar(BH_CAM_SCALE);
    // Three.js 相机看 -Z：matrixWorld 第 0/1/2 列 = right/up/back
    u.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    u.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    u.uCamFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).normalize().multiplyScalar(-1.0);
    var fovRad = (camera.fov || 60) * Math.PI / 180;
    u.uFocal.value = 1.0 / Math.tan(fovRad * 0.5);
  } catch (_) {}
  var prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(bhRT);
  renderer.render(bhRTScene, bhRTCam);
  renderer.setRenderTarget(prevRT);
}
console.log('v7 shell loaded, JS pending');

