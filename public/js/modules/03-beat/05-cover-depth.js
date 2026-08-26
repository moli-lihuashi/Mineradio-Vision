// ============================================================
//  封面 + 边缘 + 启发式深度 处理 (CPU 端)
//   生成 256×256 RGBA 纹理: R=depth G=edge B=fg-mask A=lum
// ============================================================
function coverDepthCacheId(raw) {
  var str = String(raw || '');
  if (!str) return '';
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return str.length + ':' + (h >>> 0).toString(36);
}
function getCoverDepthCache(raw) {
  var id = coverDepthCacheId(raw);
  if (!id || !coverDepthCache[id]) return null;
  coverDepthCache[id].at = Date.now();
  var idx = coverDepthCacheKeys.indexOf(id);
  if (idx >= 0) {
    coverDepthCacheKeys.splice(idx, 1);
    coverDepthCacheKeys.push(id);
  } else coverDepthCacheKeys.push(id);
  return coverDepthCache[id];
}
function setCoverDepthCache(raw, canvas, aiEnhanced) {
  var id = coverDepthCacheId(raw);
  if (!id || !canvas) return;
  var idx = coverDepthCacheKeys.indexOf(id);
  if (idx >= 0) coverDepthCacheKeys.splice(idx, 1);
  coverDepthCacheKeys.push(id);
  coverDepthCache[id] = { canvas: canvas, ai: !!aiEnhanced, at: Date.now() };
  while (coverDepthCacheKeys.length > 18) {
    var drop = coverDepthCacheKeys.shift();
    delete coverDepthCache[drop];
  }
}

function buildEdgeAndDepth(srcCanvas, opts) {
  opts = opts || {};
  // 切歌 defer 时用 128：像素量约 1/4，主线程尖峰明显更小
  var W = Math.max(64, Math.min(256, Number(opts.size) || 256)) | 0;
  var H = W, N = W * H;
  var normalized = document.createElement('canvas');
  normalized.width = W;
  normalized.height = H;
  var sctx = normalized.getContext('2d');
  sctx.drawImage(srcCanvas, 0, 0, W, H);
  var src = sctx.getImageData(0, 0, W, H).data;
  var lum = new Float32Array(N), blur = new Float32Array(N), tmp = new Float32Array(N);
  // 1) Luminance
  for (var i = 0; i < N; i++) {
    var di = i * 4;
    lum[i] = (src[di] * 0.299 + src[di+1] * 0.587 + src[di+2] * 0.114) / 255;
  }
  // 2) Box blur 2 次 (深度基础)
  function blurH(s, d, r) {
    for (var y = 0; y < H; y++) {
      var sum = 0;
      for (var x = -r; x <= r; x++) sum += s[y * W + Math.max(0, Math.min(W-1, x))];
      for (var x = 0; x < W; x++) {
        d[y * W + x] = sum / (2*r + 1);
        var xR = Math.min(W-1, x + r + 1), xL = Math.max(0, x - r);
        sum += s[y * W + xR] - s[y * W + xL];
      }
    }
  }
  function blurV(s, d, r) {
    for (var x = 0; x < W; x++) {
      var sum = 0;
      for (var y = -r; y <= r; y++) sum += s[Math.max(0, Math.min(H-1, y)) * W + x];
      for (var y = 0; y < H; y++) {
        d[y * W + x] = sum / (2*r + 1);
        var yD = Math.min(H-1, y + r + 1), yU = Math.max(0, y - r);
        sum += s[yD * W + x] - s[yU * W + x];
      }
    }
  }
  blurH(lum, tmp, 4); blurV(tmp, blur, 4);

  // 3) Sobel 边缘 (在 blur 上做 - 减少噪声)
  var edge = new Float32Array(N);
  for (var y = 1; y < H-1; y++) for (var x = 1; x < W-1; x++) {
    var gx = -blur[(y-1)*W + (x-1)] - 2*blur[y*W + (x-1)] - blur[(y+1)*W + (x-1)]
            + blur[(y-1)*W + (x+1)] + 2*blur[y*W + (x+1)] + blur[(y+1)*W + (x+1)];
    var gy = -blur[(y-1)*W + (x-1)] - 2*blur[(y-1)*W + x] - blur[(y-1)*W + (x+1)]
            + blur[(y+1)*W + (x-1)] + 2*blur[(y+1)*W + x] + blur[(y+1)*W + (x+1)];
    edge[y*W + x] = Math.min(1.0, Math.sqrt(gx*gx + gy*gy) * 1.4);
  }
  // 4) 启发式深度:亮度 + 中心 mask + 边缘累积
  var depth = new Float32Array(N);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y*W + x;
    var cx = (x / (W-1) - 0.5) * 2.0;
    var cy = (y / (H-1) - 0.5) * 2.0;
    var rr = Math.sqrt(cx*cx + cy*cy);
    var centerBias = 1.0 - Math.min(1, rr * 0.75);
    var bright = blur[i];
    depth[i] = Math.min(1.0, bright * 0.45 + centerBias * 0.55);
  }
  // 5) fg-mask: 中心 + 高对比区
  var fg = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var d = depth[i];
    var e = edge[i];
    fg[i] = Math.min(1.0, d * 0.6 + e * 0.5);
  }

  // 输出 RGBA（尺寸随 opts.size）
  var out = document.createElement('canvas'); out.width = W; out.height = H;
  var octx = out.getContext('2d'), imgOut = octx.createImageData(W, H);
  for (var i = 0; i < N; i++) {
    var di = i * 4;
    imgOut.data[di]   = Math.round(depth[i] * 255);
    imgOut.data[di+1] = Math.round(edge[i] * 255);
    imgOut.data[di+2] = Math.round(fg[i] * 255);
    imgOut.data[di+3] = Math.round(lum[i] * 255);
  }
  octx.putImageData(imgOut, 0, 0);
  return out;
}

// AI 深度估计 (Xenova/depth-anything-small) - 异步加载, 失败回退
async function ensureAIDepthPipeline() {
  if (aiDepthReady && aiDepthPipeline) return aiDepthPipeline;
  if (aiDepthBusy) return null;
  aiDepthBusy = true;
  try {
    showAIDepthChip('加载 AI 深度模型 (首次需下载 50MB)…');
    var mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    mod.env.allowLocalModels = false;
    if (mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm) mod.env.backends.onnx.wasm.numThreads = 1;
    aiDepthPipeline = await mod.pipeline('depth-estimation', 'Xenova/depth-anything-small-hf');
    aiDepthReady = true;
    return aiDepthPipeline;
  } catch (e) {
    console.warn('AI depth pipeline failed:', e);
    return null;
  } finally {
    aiDepthBusy = false;
  }
}

function makeAIDepthInputCanvas(srcCanvas) {
  if (!srcCanvas) return srcCanvas;
  var size = 160;
  var cv = document.createElement('canvas');
  cv.width = cv.height = size;
  var ctx = cv.getContext('2d');
  try {
    ctx.drawImage(srcCanvas, 0, 0, size, size);
    return cv;
  } catch (e) {
    return srcCanvas;
  }
}

async function estimateAIDepth(srcCanvas, token) {
  if (!fx.aiDepth) return null;
  if (performance.now() < aiDepthFailUntil) return null;
  showAIDepthChip('后台增强封面深度…');
  try {
    var pipe = await ensureAIDepthPipeline();
    if (!pipe) { hideAIDepthChip(); return null; }
    if (token !== coverProcessToken) { hideAIDepthChip(); return null; }
    var inputCanvas = makeAIDepthInputCanvas(srcCanvas);
    var input = inputCanvas;
    try {
      if (inputCanvas && inputCanvas.toDataURL) input = inputCanvas.toDataURL('image/jpeg', 0.82);
    } catch (e) {
      input = inputCanvas;
    }
    var result = await pipe(input);
    if (token !== coverProcessToken) { hideAIDepthChip(); return null; }
    var raw = result && (result.depth || result.predicted_depth || result);
    var rawCv = raw && raw.toCanvas ? await raw.toCanvas() : raw;
    hideAIDepthChip();
    return rawCv;
  } catch (e) {
    console.warn('AI depth estimation failed:', e);
    aiDepthFailUntil = performance.now() + 120000;
    hideAIDepthChip();
    return null;
  }
}

function mergeAIDepthIntoEdgeTexture(heuristicCanvas, aiCanvas) {
  // 把 AI 深度 (灰度) 写入 R 通道, 保留启发式的 G/B/A
  var W = heuristicCanvas.width || 256, H = heuristicCanvas.height || 256;
  var hctx = heuristicCanvas.getContext('2d');
  var hImg = hctx.getImageData(0, 0, W, H);

  var aiTmp = document.createElement('canvas'); aiTmp.width = W; aiTmp.height = H;
  var actx = aiTmp.getContext('2d');
  actx.drawImage(aiCanvas, 0, 0, W, H);
  var aData = actx.getImageData(0, 0, W, H).data;

  // 归一化 AI 深度
  var aiVals = new Float32Array(W * H), minV = 1, maxV = 0;
  for (var i = 0; i < aiVals.length; i++) {
    var di = i * 4;
    var v = (aData[di] * 0.299 + aData[di+1] * 0.587 + aData[di+2] * 0.114) / 255;
    aiVals[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  var range = Math.max(0.001, maxV - minV);
  // 判断是否反相 (中心应该比边缘深, 表示前景在中)
  var centerSum = 0, centerCount = 0, edgeSum = 0, edgeCount = 0;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x;
    var cx = x / (W-1) - 0.5, cy = y / (H-1) - 0.5;
    var rr = Math.sqrt(cx*cx + cy*cy);
    if (rr < 0.22) { centerSum += aiVals[i]; centerCount++; }
    else if (rr > 0.46) { edgeSum += aiVals[i]; edgeCount++; }
  }
  var invert = (centerSum / Math.max(1, centerCount)) < (edgeSum / Math.max(1, edgeCount));

  for (var i = 0; i < aiVals.length; i++) {
    var n = (aiVals[i] - minV) / range;
    if (invert) n = 1.0 - n;
    hImg.data[i*4] = Math.round(n * 255);
  }
  hctx.putImageData(hImg, 0, 0);
  return heuristicCanvas;
}

function queueAIDepthForCover(srcCanvas, edgeCanvas, token, opts, cacheSeed, force) {
  opts = opts || {};
  if (!fx.aiDepth || !srcCanvas || !edgeCanvas) return;
  if (!force && isHiddenForBackgroundOptimization()) return;
  if (performance.now() < aiDepthFailUntil || aiDepthBusy) return;
  var now = performance.now();
  if (!force && now - aiDepthLastRunAt < aiDepthMinGapMs) return;
  aiDepthLastRunAt = now;
  scheduleVisualApply(async function(){
    if (!fx.aiDepth || token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    await yieldToIdle(force ? 900 : 2600);
    if (!fx.aiDepth || token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    var aiCanvas = await estimateAIDepth(srcCanvas, token);
    if (!aiCanvas || token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    mergeAIDepthIntoEdgeTexture(edgeCanvas, aiCanvas);
    coverEdgeTex.image = edgeCanvas;
    coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, 1.0, 360);
    setCoverDepthCache(cacheSeed, edgeCanvas, true);
    showToast('AI 深度已后台增强');
  }, force ? 240 : 1800, force ? 1200 : 3000);
}

function queueAIDepthForCurrentCover(force) {
  if (!coverTex || !coverTex.image || !coverEdgeTex || !coverEdgeTex.image) return;
  if (!uniforms.uHasCover.value || !uniforms.uHasDepth.value) return;
  queueAIDepthForCover(coverTex.image, coverEdgeTex.image, coverProcessToken, {}, '', !!force);
}

// 颜色渐变 tween (切歌时旧封面→新封面)
var colorMixTweenRaf = 0;
// 切歌打散重组窗口：临时压帧/隔帧/密度，并把 CPU 深度图挪到过渡后
var coverTransitionReliefUntil = 0;
function beginCoverTransitionRelief(durationMs) {
  var ms = Math.max(400, Number(durationMs) || 900);
  var until = performance.now() + ms;
  if (until > coverTransitionReliefUntil) coverTransitionReliefUntil = until;
  // 切歌只做颜色溶入，不再抬 uBurstAmt（打散/外抛观感太怪）
}
function coverTransitionReliefActive(now) {
  return (now || performance.now()) < coverTransitionReliefUntil;
}
function coverTransitionReliefFpsCap() {
  if (!coverTransitionReliefActive()) return 0;
  // 略压帧即可；过低 + 其它抖动叠在一起更显不稳
  return 45;
}
function startColorMixTween(durationMs) {
  durationMs = Math.max(1, durationMs || 1);
  beginCoverTransitionRelief(durationMs + 180);
  var M = window.MineradioMotion;
  if (colorMixTweenRaf) { cancelAnimationFrame(colorMixTweenRaf); colorMixTweenRaf = 0; }
  if (!window.__coverColorMixState) window.__coverColorMixState = { t: 0 };
  var mixState = window.__coverColorMixState;
  if (M && typeof M.killAll === 'function') M.killAll(mixState);
  uniforms.uColorMixT.value = 0;
  mixState.t = 0;
  // 切歌主运动：仅颜色溶入 spring；粒子打散已禁用（beginCoverTransitionRelief）
  if (M && typeof M.springTo === 'function' && !(M.prefersReducedMotion && M.prefersReducedMotion())) {
    M.springTo(mixState, 't', 1, {
      from: 0,
      preset: M.SPRING.standard,
      apply: function (v) {
        uniforms.uColorMixT.value = Math.max(0, Math.min(1, v));
      },
      onComplete: function () {
        uniforms.uColorMixT.value = 1;
        mixState.t = 1;
      }
    });
    return;
  }
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    t = t * t * (3 - 2 * t);
    uniforms.uColorMixT.value = t;
    if (t < 1) colorMixTweenRaf = requestAnimationFrame(step);
    else colorMixTweenRaf = 0;
  }
  colorMixTweenRaf = requestAnimationFrame(step);
}

// 粒子整体透明度 tween (启动 fade-in)
var alphaTweenRaf = 0;
var floatAlphaTweenRaf = 0;
var IDLE_PARTICLE_ALPHA = 0;
function tweenParticleAlpha(from, to, durationMs) {
  if (alphaTweenRaf) { cancelAnimationFrame(alphaTweenRaf); alphaTweenRaf = 0; }
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    t = visualEase(t);
    uniforms.uAlpha.value = from + (to - from) * t;
    if (t < 1) alphaTweenRaf = requestAnimationFrame(step);
    else alphaTweenRaf = 0;
  }
  alphaTweenRaf = requestAnimationFrame(step);
}
function tweenFloatAlpha(from, to, durationMs) {
  if (floatAlphaTweenRaf) { cancelAnimationFrame(floatAlphaTweenRaf); floatAlphaTweenRaf = 0; }
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    t = visualEase(t);
    uniforms.uFloatAlpha.value = from + (to - from) * t;
    if (t < 1) floatAlphaTweenRaf = requestAnimationFrame(step);
    else floatAlphaTweenRaf = 0;
  }
  floatAlphaTweenRaf = requestAnimationFrame(step);
}
function revealIdleParticles(target, durationMs) {
  if (!uniforms || !uniforms.uFloatAlpha) return;
  if (floatAlphaTweenRaf) { cancelAnimationFrame(floatAlphaTweenRaf); floatAlphaTweenRaf = 0; }
  uniforms.uFloatAlpha.value = 0;
  if (floatGroup) destroyFloatLayer();
  return;
  var next = typeof target === 'number' ? target : IDLE_PARTICLE_ALPHA;
  var from = uniforms.uFloatAlpha.value || 0;
  if (from >= next - 0.01) return;
  tweenFloatAlpha(from, next, durationMs || 1800);
}

// 加载形态 tween (uLoading 0..1)
var loadingTweenRaf = 0;
var loadingShownAt = 0;
var loadingHideTimer = null;
var coverDepthTween = null;
function visualEase(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
function tweenLoading(to, durationMs, onComplete) {
  if (loadingTweenRaf) { cancelAnimationFrame(loadingTweenRaf); loadingTweenRaf = 0; }
  durationMs = Math.max(1, durationMs || 1);
  if (isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
    uniforms.uLoading.value = to;
    loadingTweenRaf = 0;
    if (onComplete) onComplete();
    return;
  }
  var start = performance.now();
  var from = uniforms.uLoading.value;
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    var eased = visualEase(t);
    uniforms.uLoading.value = from + (to - from) * eased;
    if (t < 1) loadingTweenRaf = requestAnimationFrame(step);
    else {
      uniforms.uLoading.value = to;
      loadingTweenRaf = 0;
      if (onComplete) onComplete();
    }
  }
  loadingTweenRaf = requestAnimationFrame(step);
}
function showLoading() {
  loadingShownAt = performance.now();
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  var current = uniforms.uLoading.value || 0;
  tweenLoading(Math.max(current, 0.56), current > 0.04 ? 86 : 118);
}
function hideLoading() {
  if (loadingHideTimer) clearTimeout(loadingHideTimer);
  if (isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
    forceLoadingSettled('background-hide');
    return;
  }
  var elapsed = loadingShownAt ? performance.now() - loadingShownAt : 999;
  var wait = Math.max(0, 72 - elapsed);
  loadingHideTimer = setTimeout(function(){
    loadingHideTimer = null;
    var current = uniforms.uLoading.value || 0;
    if (current <= 0.015 || isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
      if (loadingTweenRaf) {
        cancelAnimationFrame(loadingTweenRaf);
        loadingTweenRaf = 0;
      }
      uniforms.uLoading.value = 0;
      return;
    }
    tweenLoading(0, current > 0.38 ? 126 : 96);
  }, wait);
}
function forceLoadingSettled(reason) {
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  if (loadingTweenRaf) {
    cancelAnimationFrame(loadingTweenRaf);
    loadingTweenRaf = 0;
  }
  uniforms.uLoading.value = 0;
  loadingShownAt = 0;
  if (reason && window.__mineradioDebugLoading) console.log('[LoadingSettled]', reason);
}
function recoverVisualsAfterBackground(reason) {
  applyRendererPowerMode();
  if (typeof scheduleMainRendererViewportRefresh === 'function') scheduleMainRendererViewportRefresh(reason || 'restore');
  if (audio && audio.src && !audio.paused && ((uniforms.uLoading.value || 0) > 0.015 || loadingTweenRaf || loadingHideTimer)) {
    forceLoadingSettled(reason || 'restore');
  }
  if (typeof markRenderInteraction === 'function') markRenderInteraction('restore', 1100);
}

function setCoverDepthState(depthTo, aiTo, durationMs) {
  depthTo = Math.max(0, Math.min(1, Number(depthTo) || 0));
  aiTo = Math.max(0, Math.min(1, Number(aiTo) || 0));
  if (coverDepthTween) {
    cancelAnimationFrame(coverDepthTween.raf);
    coverDepthTween = null;
  }
  durationMs = Math.max(1, durationMs || 1);
  var depthFrom = uniforms.uHasDepth.value || 0;
  var aiFrom = uniforms.uAiBoost.value || 0;
  if (durationMs <= 1 || (Math.abs(depthFrom - depthTo) < 0.001 && Math.abs(aiFrom - aiTo) < 0.001)) {
    uniforms.uHasDepth.value = depthTo;
    uniforms.uAiBoost.value = aiTo;
    return;
  }
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    var eased = visualEase(t);
    uniforms.uHasDepth.value = depthFrom + (depthTo - depthFrom) * eased;
    uniforms.uAiBoost.value = aiFrom + (aiTo - aiFrom) * eased;
    if (t < 1) coverDepthTween = { raf: requestAnimationFrame(step) };
    else {
      uniforms.uHasDepth.value = depthTo;
      uniforms.uAiBoost.value = aiTo;
      coverDepthTween = null;
    }
  }
  coverDepthTween = { raf: requestAnimationFrame(step) };
}

function coverApplyStillCurrent(opts) {
  opts = opts || {};
  return !opts.trackToken || opts.trackToken === trackSwitchToken;
}

function setControlCoverSrc(src) {
  var cover = document.getElementById('control-cover');
  if (!cover) return;
  if (!src) {
    cover.style.backgroundImage = '';
    cover.classList.add('cover-empty');
    return;
  }
  cover.style.backgroundImage = 'url("' + String(src).replace(/"/g, '\\"') + '")';
  cover.classList.remove('cover-empty');
}

function updateControlTrackInfo(song) {
  song = song || {};
  var title = document.getElementById('control-title');
  var artist = document.getElementById('control-artist');
  if (title) {
    var titleText = document.getElementById('control-title-text');
    var titleBadges = document.getElementById('control-title-badges');
    if (!titleText) {
      title.innerHTML = '<span id="control-title-text" class="control-title-text"></span><span id="control-title-badges" class="control-title-badges"></span>';
      titleText = document.getElementById('control-title-text');
      titleBadges = document.getElementById('control-title-badges');
    }
    if (titleText) titleText.textContent = song.name || '';
    else title.textContent = song.name || '';
    if (titleBadges) {
      var sourceTag = typeof songSourceTagHtml === 'function' ? songSourceTagHtml(song, { switcher: true }) : '';
      var vipTag = typeof songVipTagHtml === 'function' ? songVipTagHtml(song) : ((song.fee === 1) ? '<span class="tag-vip">VIP</span>' : '');
      titleBadges.innerHTML = (song && song.name) ? (sourceTag + vipTag) : '';
    }
  }
  if (artist) artist.textContent = song.artist || '';
  if (typeof updatePlaybackQualityUi === 'function') updatePlaybackQualityUi();
  if (typeof updateLyricTimingOffsetUi === 'function') updateLyricTimingOffsetUi(song);
}

function applyCoverCanvas(cv, thumbSrc, opts) {
  opts = opts || {};
  if (!cv || !coverApplyStillCurrent(opts)) return;
  var token = ++coverProcessToken;
  if (opts.coverSource && opts.coverSourceKind) {
    currentCoverSource = { kind: opts.coverSourceKind, src: opts.coverSource };
  }
  var cacheSeed = (opts.coverKey || thumbSrc || '') + '|tex=' + (cv.width || 0) + 'x' + (cv.height || 0);
  var cachedDepth = getCoverDepthCache(cacheSeed);
  // 切歌颜色渐变: 把当前 coverTex 当作 prevCoverTex（缩小拷贝，降低同步尖峰）
  if (uniforms.uHasCover.value > 0.5 && coverTex.image) {
    var prevW = coverTex.image.width || 256;
    var prevH = coverTex.image.height || 256;
    var prevScale = Math.min(1, 128 / Math.max(prevW, prevH, 1));
    var prevCv = document.createElement('canvas');
    prevCv.width = Math.max(1, Math.round(prevW * prevScale));
    prevCv.height = Math.max(1, Math.round(prevH * prevScale));
    try {
      prevCv.getContext('2d').drawImage(coverTex.image, 0, 0, prevCv.width, prevCv.height);
      prevCoverTex.image = prevCv;
      prevCoverTex.needsUpdate = true;
    } catch (e) {}
  }
  coverTex.image = cv; coverTex.needsUpdate = true;
  coverPickerCanvas = cv;
  uniforms.uHasCover.value = 1;
  if (cachedDepth && cachedDepth.canvas) {
    coverEdgeTex.image = cachedDepth.canvas;
    coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, cachedDepth.ai ? 1.0 : 0.55, opts.deferHeavy ? 180 : 120);
  } else {
    setCoverDepthState(opts.deferHeavy ? (uniforms.uHasDepth.value > 0.5 ? 0.22 : 0) : 0, opts.deferHeavy ? 0.20 : 0, opts.deferHeavy ? 120 : 1);
  }

  if (thumbSrc) {
    document.getElementById('thumb-cover').src = thumbSrc;
    setControlCoverSrc(thumbSrc);
  }
  if (shelfManager) shelfManager.onCoverChange(thumbSrc);

  // 切歌：短溶入换封面（不再配粒子打散）
  var colorMixMs = opts.colorMixDuration || (fx.preset === 0 ? 360 : 720);
  startColorMixTween(opts.fromResolutionChange ? (fx.preset === 0 ? 240 : 400) : colorMixMs);

  function refreshCoverDependentColors() {
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    if (floatGroup) refreshFloatColorsFromCover(cv);
    if (backCoverGroup) refreshBackCoverColorsFromCanvas(cv);
    updateLyricPaletteFromCover(cv);
  }

  function runHeavyCoverWork() {
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    // 打散重组 / 交互中：继续让出主线程，避免和粒子过渡抢同一帧
    if (opts.deferHeavy && (
      (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) ||
      (typeof coverTransitionReliefActive === 'function' && coverTransitionReliefActive())
    )) {
      scheduleVisualApply(runHeavyCoverWork, 420, heavyTimeout || 1800);
      return;
    }
    var edgeCv = buildEdgeAndDepth(cv, { size: opts.deferHeavy ? 128 : 256 });
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    setCoverDepthCache(cacheSeed, edgeCv, false);
    coverEdgeTex.image = edgeCv; coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, 0.55, opts.deferHeavy ? 520 : 180);
    // 配色刷新再拆一拍，避免和深度图同帧
    scheduleVisualApply(refreshCoverDependentColors, opts.deferHeavy ? 180 : 40, opts.deferHeavy ? 900 : 420);

    queueAIDepthForCover(cv, edgeCv, token, opts, cacheSeed, false);
  }
  if (cachedDepth && cachedDepth.canvas) {
    scheduleVisualApply(refreshCoverDependentColors, opts.deferHeavy ? 260 : 90, opts.deferHeavy ? 1200 : 700);
    if (!cachedDepth.ai) queueAIDepthForCover(cv, cachedDepth.canvas, token, opts, cacheSeed, false);
    return;
  }
  // 把深度图尽量推到颜色过渡后半段之后
  var heavyDelay = opts.deferHeavy
    ? Math.max(opts.delay || 620, Math.round(colorMixMs * 0.82) + 120)
    : (opts.delay || 120);
  var heavyTimeout = opts.deferHeavy ? (opts.timeout || 2200) : (opts.timeout || 900);
  scheduleVisualApply(runHeavyCoverWork, heavyDelay, heavyTimeout);
}

