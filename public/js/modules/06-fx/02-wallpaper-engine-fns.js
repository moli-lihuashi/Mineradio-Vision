/**
 * Wallpaper Engine 前端函数（库浏览 + 视频/图片背景）
 *

 * 已剥离：玻璃采样器 (GlassSampler) / native scene capture / desktop overlay /
 * host bounds recovery / freeze frame / capture viewport / pointer activity 相关代码。
 * 只保留 Wallpaper Engine 库浏览与 video/image 媒体背景能力。
 *
 * 适配点：
 *  - applyWallpaperEngineBackground 仅保留 kind === 'media'（video/image）分支，
 *    kind === 'engine'（native scene）分支已删除。
 *  - 所有被剥离函数的内部调用改为安全 fallback（return false / 空操作）。
 *  - IPC 通过 window.desktopWindow 暴露的方法调用。
 */

// ===== 状态变量与常量 =====
var WALLPAPER_ENGINE_SELECTION_STORE_KEY = 'mineradio-wallpaper-engine-selection-v1';
var WALLPAPER_ENGINE_HIDDEN_STORE_KEY = 'mineradio-wallpaper-engine-hidden-v1';
var WALLPAPER_ENGINE_FAVORITE_STORE_KEY = 'mineradio-wallpaper-engine-favorites-v1';
var wallpaperEngineProjects = [];
var wallpaperEngineLibrarySnapshot = null;
var wallpaperEngineMediaToken = '';
var wallpaperEngineLibraryBusy = false;
var wallpaperEngineLayerToken = 0;
var wallpaperEnginePreviewObserver = null;
var wallpaperEngineSearchRenderTimer = 0;
var wallpaperEnginePreviewScrollTimer = 0;
var wallpaperEngineSwitchTimer = 0;
var wallpaperEngineVideoRetryTimer = 0;
var wallpaperEngineFirstFrameWait = null;
var wallpaperEngineNativeSessionId = '';
var wallpaperEngineDesktopPreviewActive = false;
var wallpaperEngineDesktopPreviewUsesAsset = false;
var wallpaperEngineRenderLimit = 240;
var wallpaperEngineRuntimeError = '';
var wallpaperEngineProjectDetailsId = '';
var WALLPAPER_ENGINE_SWITCH_FADE_MS = 440;
var WALLPAPER_ENGINE_RENDER_BATCH = 240;
var WALLPAPER_ENGINE_FIRST_FRAME_TIMEOUT_MS = 8000;

// ===== 工具函数 =====

function wallpaperEngineDesktopApi() {
  try {
    if (typeof getDesktopWindowApi === 'function') return getDesktopWindowApi();
    return window.desktopWindow || null;
  } catch (e) {
    return null;
  }
}

function readWallpaperEngineIdSet(key) {
  try {
    var raw = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set((Array.isArray(raw) ? raw : []).map(String).filter(function (id) { return /^[a-f0-9]{24}$/i.test(id); }));
  } catch (e) {
    return new Set();
  }
}

var hiddenWallpaperEngineIds = readWallpaperEngineIdSet(WALLPAPER_ENGINE_HIDDEN_STORE_KEY);
var favoriteWallpaperEngineIds = readWallpaperEngineIdSet(WALLPAPER_ENGINE_FAVORITE_STORE_KEY);

function saveWallpaperEngineIdSet(key, values) {
  try { localStorage.setItem(key, JSON.stringify(Array.from(values))); } catch (e) { }
}

function normalizeWallpaperEngineSelection(value) {
  value = value && typeof value === 'object' ? value : {};
  var id = String(value.id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
  return {
    version: 1,
    active: value.active === true && id.length === 24,
    id: id,
    title: String(value.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160),
    kind: value.kind === 'engine' ? 'engine' : (value.kind === 'media' ? 'media' : 'preview'),
    mediaType: value.mediaType === 'video' ? 'video' : 'image',
    mediaAnimated: value.mediaAnimated === true,
    projectType: String(value.projectType || 'unknown').slice(0, 32),
    hasPreview: value.hasPreview === true,
    previewAnimated: value.previewAnimated === true,
    updatedAt: Math.max(0, Number(value.updatedAt) || 0)
  };
}

function readWallpaperEngineSelection() {
  try { return normalizeWallpaperEngineSelection(JSON.parse(localStorage.getItem(WALLPAPER_ENGINE_SELECTION_STORE_KEY) || '{}')); }
  catch (e) { return normalizeWallpaperEngineSelection({}); }
}

var wallpaperEngineSelection = readWallpaperEngineSelection();

function saveWallpaperEngineSelection() {
  try { localStorage.setItem(WALLPAPER_ENGINE_SELECTION_STORE_KEY, JSON.stringify(normalizeWallpaperEngineSelection(wallpaperEngineSelection))); }
  catch (e) { }
}

// ===== 项目归一化 =====

function normalizeWallpaperEngineProject(item) {
  item = item && typeof item === 'object' ? item : {};
  var id = String(item.id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
  if (id.length !== 24) return null;
  var projectType = String(item.projectType || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unknown';
  var mediaType = item.mediaType === 'video' ? 'video' : (item.mediaType === 'image' ? 'image' : '');
  return {
    id: id,
    title: String(item.title || 'Wallpaper Engine').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Wallpaper Engine',
    projectType: projectType,
    mediaType: mediaType,
    mediaAnimated: item.mediaAnimated === true,
    playable: item.playable === true && !!mediaType,
    enginePlayable: item.enginePlayable === true && projectType === 'scene',
    previewOnly: item.previewOnly === true || (item.playable !== true && item.enginePlayable !== true),
    hasPreview: item.hasPreview === true,
    previewAnimated: item.previewAnimated === true,
    source: String(item.source || '').slice(0, 32),
    sourceLabel: String(item.sourceLabel || '本地项目').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80),
    workshopId: String(item.workshopId || '').replace(/\D/g, '').slice(0, 32),
    propertyCount: Math.max(0, Math.min(256, Number(item.propertyCount) || 0)),
    audioPropertyCount: Math.max(0, Math.min(256, Number(item.audioPropertyCount) || 0)),
    mutedAudioPropertyCount: Math.max(0, Math.min(256, Number(item.mutedAudioPropertyCount) || 0)),
    updatedAt: Math.max(0, Number(item.updatedAt) || 0),
    safetyMode: item.safetyMode === 'native-engine' ? 'native-engine' : (item.safetyMode === 'direct-media' ? 'direct-media' : 'preview-only')
  };
}

function wallpaperEngineProjectById(id) {
  id = String(id || '');
  for (var i = 0; i < wallpaperEngineProjects.length; i++) {
    if (wallpaperEngineProjects[i].id === id) return wallpaperEngineProjects[i];
  }
  return null;
}

function wallpaperEngineMediaUrl(item, kind) {
  item = item || {};
  kind = kind === 'media' ? 'media' : 'preview';
  return 'mineradio-wallpaper://' + kind + '/' + encodeURIComponent(item.id || '') + '?v=' + encodeURIComponent(String(item.updatedAt || 0)) + '&token=' + encodeURIComponent(wallpaperEngineMediaToken);
}

function wallpaperEngineProjectLabel(item) {
  item = item || {};
  if (item.playable && item.mediaType === 'video') return 'Video · 动态播放';
  if (item.playable && item.mediaType === 'image') return '图片 · 原图显示';
  if (item.projectType === 'scene' && item.enginePlayable) return 'Scene · Wallpaper Engine 原生实时运行';
  if (item.projectType === 'scene') return 'Scene · 预览（未找到有效 PKGV 场景包）';
  if (item.projectType === 'web') return 'Web · 安全预览（未执行 HTML）';
  if (item.projectType === 'application') return 'Application · 安全预览（未运行程序）';
  return '本地项目 · 安全预览';
}

// ===== UI 更新 =====

function updateWallpaperEngineEntryUi(message) {
  var value = document.getElementById('wallpaper-engine-value');
  var restore = document.getElementById('wallpaper-engine-restore-btn');
  var active = !!wallpaperEngineSelection.active;
  if (value) {
    if (message) value.textContent = message;
    else if (active && wallpaperEngineRuntimeError) value.textContent = wallpaperEngineRuntimeError + ' · 已显示原背景';
    else if (active && wallpaperEngineSelection.kind === 'engine' && wallpaperEngineDesktopPreviewActive) {
      value.textContent = (wallpaperEngineSelection.title || '已选择')
        + (wallpaperEngineDesktopPreviewUsesAsset ? ' · 桌面被动模式 · 项目预览' : ' · 桌面被动模式 · 原背景');
    }
    else if (active && wallpaperEngineSelection.kind === 'engine') value.textContent = (wallpaperEngineSelection.title || '已选择') + ' · WE 引擎实时运行';
    else if (active) value.textContent = (wallpaperEngineSelection.title || '已选择') + ' · 原背景保留';
    else value.textContent = '未启用 · 原背景保留';
  }
  if (restore) restore.disabled = !active;
}

// ===== 定时器取消 =====

function cancelWallpaperEngineSwitchTimer() {
  if (wallpaperEngineSwitchTimer) clearTimeout(wallpaperEngineSwitchTimer);
  wallpaperEngineSwitchTimer = 0;
}

function cancelWallpaperEngineVideoRetry() {
  if (wallpaperEngineVideoRetryTimer) clearTimeout(wallpaperEngineVideoRetryTimer);
  wallpaperEngineVideoRetryTimer = 0;
}

function cancelWallpaperEngineFirstFrameWait() {
  var wait = wallpaperEngineFirstFrameWait;
  wallpaperEngineFirstFrameWait = null;
  if (!wait) return;
  if (wait.timer) clearTimeout(wait.timer);
  if (wait.video && wait.callbackId && typeof wait.video.cancelVideoFrameCallback === 'function') {
    try { wait.video.cancelVideoFrameCallback(wait.callbackId); } catch (e) { }
  }
  if (wait.video && wait.loadedDataHandler) {
    try { wait.video.removeEventListener('loadeddata', wait.loadedDataHandler); } catch (e2) { }
  }
  if (wait.raf1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf1);
  if (wait.raf2 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf2);
}

// ===== 层管理 =====

function wallpaperEngineLayerReady(kind, token) {
  if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
  var layer = document.getElementById('wallpaper-engine-layer');
  if (!layer) return;
  layer.classList.remove('ready', 'image-ready', 'video-ready', 'engine-ready', 'freeze-ready');
  document.body.classList.toggle('wallpaper-engine-dwm-active', kind === 'dwm');
  if (kind !== 'dwm') {
    layer.classList.add(kind === 'video' ? 'video-ready' : 'image-ready', 'ready');
    if (kind === 'video' && wallpaperEngineSelection.kind === 'engine') layer.classList.add('engine-ready');
  }
  document.body.classList.add('wallpaper-engine-active');
  suspendOriginalBackgroundForWallpaperEngine();
  wallpaperEngineRuntimeError = '';
  updateWallpaperEngineEntryUi();
  renderWallpaperEngineLibrary();
}

function wallpaperEngineLayerFailed(item, attemptedKind, token) {
  if (token !== wallpaperEngineLayerToken) return;
  if ((attemptedKind === 'media' || attemptedKind === 'engine') && item && item.hasPreview) {
    wallpaperEngineSelection.kind = 'preview';
    wallpaperEngineSelection.mediaType = 'image';
    showToast(attemptedKind === 'engine' ? ((wallpaperEngineRuntimeError || 'Wallpaper Engine 实时运行失败') + '，已切换到项目预览；再次点击可重试') : '动态媒体解码失败，已切换到安全预览');
    applyWallpaperEngineBackground(item, true);
    return;
  }
  wallpaperEngineRuntimeError = attemptedKind === 'engine' ? 'WE 引擎运行失败' : '媒体不可用';
  restoreOriginalBackgroundAfterWallpaperEngine();
  clearWallpaperEngineLayerMedia(0);
  updateWallpaperEngineEntryUi();
  showToast('壁纸媒体不可用，已恢复原背景');
}

function clearWallpaperEngineLayerMedia(delay) {
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  var token = wallpaperEngineLayerToken;
  var layer = document.getElementById('wallpaper-engine-layer');
  var image = document.getElementById('wallpaper-engine-image');
  var video = document.getElementById('wallpaper-engine-video');
  function release() {
    if (token !== wallpaperEngineLayerToken) return;
    if (layer) layer.classList.remove('ready', 'image-ready', 'video-ready', 'engine-ready', 'freeze-ready');
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    if (video) {
      video.onloadeddata = null;
      video.onerror = null;
      try { video.pause(); } catch (e) { }
      if (video.srcObject) {
        try { video.srcObject = null; } catch (e2) { }
      }
      video.removeAttribute('poster');
      video.removeAttribute('src');
      try { video.load(); } catch (e3) { }
    }
  }
  if (delay) setTimeout(release, delay);
  else release();
}

function restoreOriginalBackgroundAfterWallpaperEngine() {
  document.body.classList.remove('wallpaper-engine-active', 'wallpaper-engine-dwm-active');
  try {
    if (typeof applyCustomBackground === 'function') applyCustomBackground();
  } catch (e) { }
}

function suspendOriginalBackgroundForWallpaperEngine() {
  var video = document.getElementById('custom-bg-video');
  if (video) {
    try { video.pause(); } catch (e) { }
  }
}

// ===== 视频播放 =====

function wallpaperEnginePlayWasInterrupted(error) {
  var name = String(error && error.name || '');
  var message = String(error && error.message || error || '');
  return name === 'AbortError' || /interrupted|pause\(\)|new load request/i.test(message);
}

function wallpaperEngineRuntimeErrorText(error) {
  var code = String(error && (error.code || error.message) || error || '');
  if (/WALLPAPER_ENGINE_HOST_ELEVATED/.test(code)) return 'Mineradio 正以管理员身份运行，无法捕获 WE 实时窗口；请取消"以管理员身份运行"后重启播放器';
  if (/WALLPAPER_ENGINE_NOT_INSTALLED/.test(code)) return '未找到 Wallpaper Engine 本体';
  if (/WALLPAPER_ENGINE_SIGNATURE_INVALID/.test(code)) return 'Wallpaper Engine 运行时签名无效';
  if (/WALLPAPER_ENGINE_WINDOW_CLOSE_FAILED/.test(code)) return '上一次 Mineradio 实时壁纸窗口仍在收尾，请稍后重试；Wallpaper Engine 本体会保留';
  if (/WALLPAPER_ENGINE_DWM_SURFACE_FAILED|WALLPAPER_ENGINE_PARALLAX_RELAY_FAILED/.test(code)) return 'WE 原生鼠标视差连接失败，本次会话已关闭；请再次点击重连';
  if (/WALLPAPER_ENGINE_CONTROL_FAILED/.test(code)) return 'WE 场景控制暂时未就绪，请稍后重试';
  if (/WALLPAPER_ENGINE_WINDOW_TIMEOUT/.test(code)) return 'WE 场景窗口启动超时';
  if (/WALLPAPER_ENGINE_CAPTURE_UNAVAILABLE|WALLPAPER_CAPTURE_UNSUPPORTED/.test(code)) return '当前系统不支持实时窗口捕获';
  if (/InvalidStateError/.test(code)) return 'WE 实时画面连接需要 Mineradio 保持在前台';
  if (/NotAllowedError|Permission denied|PermissionDismissed/i.test(code)) return 'WE 实时画面捕获权限被拒绝';
  if (/NotReadableError/.test(code)) return 'WE 实时捕获通道暂时忙，已清理本次会话；请再次点击重连';
  if (/WALLPAPER_ENGINE_REFRESH_SUPERSEDED/.test(code)) return 'WE 实时窗口正在切换，请重试';
  if (/WALLPAPER_CAPTURE_PREPARE_TIMEOUT/.test(code)) return 'WE 实时画面连接超时';
  if (/WALLPAPER_CAPTURE_PREPARE_HANDLER_MISSING|WALLPAPER_CAPTURE_PREPARED_STREAM_MISSING/.test(code)) return 'WE 实时画面连接尚未准备完成';
  if (/WALLPAPER_CAPTURE_FAILED|WALLPAPER_CAPTURE_STREAM_EMPTY/.test(code)) return 'WE 实时画面连接失败';
  if (/WALLPAPER_SCENE_PACKAGE_INVALID/.test(code)) return '所选 .pkg/.pak 不是有效的 Wallpaper Engine PKGV 场景包';
  if (/WALLPAPER_SCENE_MANIFEST_INVALID/.test(code)) return '该场景缺少有效的 project.json';
  if (/WALLPAPER_SCENE_NOT_FOUND/.test(code)) return '没有找到该项目的有效场景包';
  return 'WE 引擎运行失败';
}

function requestWallpaperEngineVideoPlayback(video, item, kind, token, revealLayer, attempt) {
  cancelWallpaperEngineVideoRetry();
  if (!video || token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
  // 玻璃采样器 / host 生命周期已剥离，统一回退到 document.hidden
  var hostUnavailable = document.hidden;
  if (hostUnavailable) {
    try { video.pause(); } catch (e) { }
    if (revealLayer) wallpaperEngineLayerReady('video', token);
    return;
  }
  var promise;
  try {
    promise = video.play();
  } catch (error) {
    handleWallpaperEngineVideoPlayFailure(error, video, item, kind, token, revealLayer, attempt);
    return;
  }
  if (!promise || !promise.then) {
    if (revealLayer) wallpaperEngineLayerReady('video', token);
    return;
  }
  promise.then(function () {
    if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
    if (revealLayer) wallpaperEngineLayerReady('video', token);
  }).catch(function (error) {
    handleWallpaperEngineVideoPlayFailure(error, video, item, kind, token, revealLayer, attempt);
  });
}

function handleWallpaperEngineVideoPlayFailure(error, video, item, kind, token, revealLayer, attempt) {
  if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
  // 玻璃采样器 / host 生命周期已剥离，统一回退到 document.hidden
  var hostUnavailable = document.hidden;
  var interrupted = hostUnavailable || wallpaperEnginePlayWasInterrupted(error);
  if (!interrupted) {
    wallpaperEngineLayerFailed(item, kind, token);
    return;
  }
  if (revealLayer) wallpaperEngineLayerReady('video', token);
  if (hostUnavailable || Number(attempt) >= 2) return;
  wallpaperEngineVideoRetryTimer = setTimeout(function () {
    wallpaperEngineVideoRetryTimer = 0;
    requestWallpaperEngineVideoPlayback(video, item, kind, token, false, Number(attempt) + 1);
  }, 160);
}

function waitForWallpaperEngineVideoFirstFrame(video, item, token, sessionId, runtime) {
  cancelWallpaperEngineFirstFrameWait();
  var wait = {
    video: video,
    callbackId: 0,
    loadedDataHandler: null,
    timer: 0,
    raf1: 0,
    raf2: 0
  };
  wallpaperEngineFirstFrameWait = wait;

  function releaseWait() {
    if (wallpaperEngineFirstFrameWait !== wait) return false;
    wallpaperEngineFirstFrameWait = null;
    if (wait.timer) clearTimeout(wait.timer);
    wait.timer = 0;
    if (wait.video && wait.loadedDataHandler) {
      try { wait.video.removeEventListener('loadeddata', wait.loadedDataHandler); } catch (e) { }
    }
    if (wait.raf1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf1);
    if (wait.raf2 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf2);
    wait.raf1 = 0;
    wait.raf2 = 0;
    wait.loadedDataHandler = null;
    return true;
  }

  // wallpaperEngineNativeStartIsCurrent 已随玻璃采样器剥离，
  // 此处保留 token + selection 校验部分作为安全 fallback。
  function nativeStartIsCurrent() {
    return token === wallpaperEngineLayerToken
      && wallpaperEngineSelection.active
      && wallpaperEngineSelection.id === item.id;
  }

  function firstFrameReady() {
    if (!releaseWait()) return;
    if (!nativeStartIsCurrent()
      || wallpaperEngineNativeSessionId !== sessionId) return;
    // reportWallpaperEngineCaptureResult / calibrateWallpaperEngineCaptureViewport
    // / clearWallpaperEngineFreezeFrame 已随玻璃采样器剥离，此处仅完成首帧确认。
    wallpaperEngineLayerReady('video', token);
  }

  function firstFrameTimedOut() {
    if (!releaseWait()) return;
    if (!nativeStartIsCurrent() || wallpaperEngineNativeSessionId !== sessionId) return;
    wallpaperEngineLayerFailed(item, 'engine', token);
  }

  wait.timer = setTimeout(firstFrameTimedOut, WALLPAPER_ENGINE_FIRST_FRAME_TIMEOUT_MS);
  if (typeof video.requestVideoFrameCallback === 'function') {
    wait.callbackId = video.requestVideoFrameCallback(function () { firstFrameReady(); });
  } else {
    wait.loadedDataHandler = function () {
      wait.raf1 = requestAnimationFrame(function () {
        wait.raf2 = requestAnimationFrame(function () { firstFrameReady(); });
      });
    };
    video.addEventListener('loadeddata', wait.loadedDataHandler, { once: true });
  }
}

// ===== 背景应用（仅 media: video / image）=====

function applyWallpaperEngineBackground(item, quiet) {
  item = item || wallpaperEngineProjectById(wallpaperEngineSelection.id);
  if (!item || !wallpaperEngineSelection.active) {
    wallpaperEngineRuntimeError = item ? '' : '项目离线';
    restoreOriginalBackgroundAfterWallpaperEngine();
    clearWallpaperEngineLayerMedia(0);
    updateWallpaperEngineEntryUi(item ? '' : '项目离线 · 已显示原背景');
    return false;
  }
  // kind === 'engine'（native scene）依赖玻璃采样器，已剥离；engine 选择回退到安全预览。
  var kind = wallpaperEngineSelection.kind === 'media' && item.playable ? 'media' : 'preview';
  if (kind === 'preview' && !item.hasPreview) {
    wallpaperEngineLayerFailed(item, kind, wallpaperEngineLayerToken);
    return false;
  }
  var layer = document.getElementById('wallpaper-engine-layer');
  var image = document.getElementById('wallpaper-engine-image');
  var video = document.getElementById('wallpaper-engine-video');
  var preserveOutgoingFrame = !!(layer && (layer.classList.contains('ready') || wallpaperEngineSwitchTimer));
  cancelWallpaperEngineSwitchTimer();
  var token = ++wallpaperEngineLayerToken;
  restoreOriginalBackgroundAfterWallpaperEngine();
  if (!layer || !image || !video) return false;
  updateWallpaperEngineEntryUi('正在加载 ' + (item.title || '壁纸') + '…');

  function beginWallpaperEngineMediaLoad() {
    if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active || wallpaperEngineSelection.id !== item.id) return;
    clearWallpaperEngineLayerMedia(0);
    if (kind === 'media' && item.mediaType === 'video') {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      if (item.hasPreview) video.poster = wallpaperEngineMediaUrl(item, 'preview');
      video.onloadeddata = function () {
        if (token !== wallpaperEngineLayerToken) return;
        requestWallpaperEngineVideoPlayback(video, item, kind, token, true, 0);
      };
      video.onerror = function () { wallpaperEngineLayerFailed(item, kind, token); };
      video.src = wallpaperEngineMediaUrl(item, 'media');
      video.load();
    } else {
      image.onload = function () { wallpaperEngineLayerReady('image', token); };
      image.onerror = function () { wallpaperEngineLayerFailed(item, kind, token); };
      image.src = wallpaperEngineMediaUrl(item, kind === 'media' ? 'media' : 'preview');
    }
  }

  if (preserveOutgoingFrame) {
    clearWallpaperEngineLayerMedia(WALLPAPER_ENGINE_SWITCH_FADE_MS);
    wallpaperEngineSwitchTimer = setTimeout(function () {
      wallpaperEngineSwitchTimer = 0;
      beginWallpaperEngineMediaLoad();
    }, WALLPAPER_ENGINE_SWITCH_FADE_MS + 20);
  } else {
    clearWallpaperEngineLayerMedia(0);
    beginWallpaperEngineMediaLoad();
  }
  if (!quiet) showToast(kind === 'media' ? 'Wallpaper Engine 壁纸已启用' : '已启用安全预览，原背景仍保留');
  return true;
}

function activateWallpaperEngineItem(id) {
  var item = wallpaperEngineProjectById(id);
  if (!item || (!item.playable && !item.enginePlayable && !item.hasPreview)) {
    showToast('该项目没有可安全导入的媒体');
    return;
  }
  wallpaperEngineSelection = normalizeWallpaperEngineSelection({
    active: true,
    id: item.id,
    title: item.title,
    kind: item.enginePlayable ? 'engine' : (item.playable ? 'media' : 'preview'),
    mediaType: item.enginePlayable ? 'video' : (item.playable ? item.mediaType : 'image'),
    mediaAnimated: item.mediaAnimated,
    projectType: item.projectType,
    hasPreview: item.hasPreview,
    previewAnimated: item.previewAnimated,
    updatedAt: item.updatedAt
  });
  wallpaperEngineDesktopPreviewActive = false;
  wallpaperEngineDesktopPreviewUsesAsset = false;
  saveWallpaperEngineSelection();
  wallpaperEngineRuntimeError = '';
  applyWallpaperEngineBackground(item, false);
  closeWallpaperEngineLibrary();
}

function deactivateWallpaperEngineBackground(quiet) {
  wallpaperEngineDesktopPreviewActive = false;
  wallpaperEngineDesktopPreviewUsesAsset = false;
  wallpaperEngineSelection.active = false;
  saveWallpaperEngineSelection();
  wallpaperEngineRuntimeError = '';
  cancelWallpaperEngineSwitchTimer();
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  ++wallpaperEngineLayerToken;
  restoreOriginalBackgroundAfterWallpaperEngine();
  clearWallpaperEngineLayerMedia(0);
  updateWallpaperEngineEntryUi();
  renderWallpaperEngineLibrary();
  if (!quiet) showToast('已恢复原背景媒体，原设置没有被覆盖');
}

// ===== 库渲染 =====

function wallpaperEngineFilteredProjects() {
  var search = document.getElementById('wallpaper-engine-search');
  var query = String(search && search.value || '').trim().toLowerCase();
  return wallpaperEngineProjects.filter(function (item) {
    if (hiddenWallpaperEngineIds.has(item.id)) return false;
    if (!query) return true;
    return (item.title + ' ' + item.projectType + ' ' + item.sourceLabel + ' ' + item.workshopId).toLowerCase().indexOf(query) >= 0;
  }).sort(function (a, b) {
    var activeA = wallpaperEngineSelection.active && wallpaperEngineSelection.id === a.id ? 1 : 0;
    var activeB = wallpaperEngineSelection.active && wallpaperEngineSelection.id === b.id ? 1 : 0;
    var favA = favoriteWallpaperEngineIds.has(a.id) ? 1 : 0;
    var favB = favoriteWallpaperEngineIds.has(b.id) ? 1 : 0;
    return activeB - activeA || favB - favA || Number(b.playable) - Number(a.playable) || Number(b.enginePlayable) - Number(a.enginePlayable) || a.title.localeCompare(b.title, 'zh-CN');
  });
}

function disconnectWallpaperEnginePreviewObserver() {
  if (wallpaperEnginePreviewObserver) wallpaperEnginePreviewObserver.disconnect();
  wallpaperEnginePreviewObserver = null;
}

function loadWallpaperEnginePreviewsNearViewport() {
  var grid = document.getElementById('wallpaper-engine-grid');
  var modal = document.getElementById('wallpaper-engine-modal');
  if (!grid || (modal && !modal.classList.contains('show'))) return;
  var viewport = grid.getBoundingClientRect();
  grid.querySelectorAll('img[data-src]').forEach(function (image) {
    var rect = image.getBoundingClientRect();
    var nearby = rect.bottom >= viewport.top - 220 && rect.top <= viewport.bottom + 220;
    if (nearby) {
      if (!image.getAttribute('src')) image.src = image.dataset.src || '';
    } else if (image.dataset.animated === '1') {
      image.removeAttribute('src');
      image.classList.remove('loaded');
    }
  });
}

function extendWallpaperEngineLibraryNearEnd() {
  var grid = document.getElementById('wallpaper-engine-grid');
  if (!grid || !grid.querySelector('[data-wallpaper-action="load-more"]')) return;
  var remaining = grid.scrollHeight - grid.scrollTop - grid.clientHeight;
  if (remaining > Math.max(280, grid.clientHeight * 0.7)) return;
  wallpaperEngineRenderLimit += WALLPAPER_ENGINE_RENDER_BATCH;
  renderWallpaperEngineLibrary(true);
}

function scheduleWallpaperEnginePreviewViewportUpdate() {
  if (wallpaperEnginePreviewObserver) {
    extendWallpaperEngineLibraryNearEnd();
    return;
  }
  if (wallpaperEnginePreviewScrollTimer) return;
  wallpaperEnginePreviewScrollTimer = setTimeout(function () {
    wallpaperEnginePreviewScrollTimer = 0;
    loadWallpaperEnginePreviewsNearViewport();
    extendWallpaperEngineLibraryNearEnd();
  }, 60);
}

function observeWallpaperEnginePreviews() {
  disconnectWallpaperEnginePreviewObserver();
  var grid = document.getElementById('wallpaper-engine-grid');
  if (!grid || typeof IntersectionObserver === 'undefined') {
    if (grid) {
      grid.querySelectorAll('img[data-src]').forEach(function (img) {
        img.onload = function () { img.classList.add('loaded'); };
      });
      loadWallpaperEnginePreviewsNearViewport();
    }
    return;
  }
  wallpaperEnginePreviewObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var img = entry.target;
      if (entry.isIntersecting) {
        if (!img.getAttribute('src')) img.src = img.dataset.src || '';
      } else if (img.dataset.animated === '1') {
        img.removeAttribute('src');
        img.classList.remove('loaded');
      }
    });
  }, { root: grid, rootMargin: '220px 0px', threshold: 0.01 });
  grid.querySelectorAll('img[data-src]').forEach(function (img) {
    img.onload = function () { img.classList.add('loaded'); };
    wallpaperEnginePreviewObserver.observe(img);
  });
  loadWallpaperEnginePreviewsNearViewport();
}

function renderWallpaperEngineManualRoots() {
  var host = document.getElementById('wallpaper-engine-manual-roots');
  if (!host) return;
  var roots = wallpaperEngineLibrarySnapshot && Array.isArray(wallpaperEngineLibrarySnapshot.manualRoots)
    ? wallpaperEngineLibrarySnapshot.manualRoots : [];
  host.innerHTML = roots.map(function (root) {
    return '<span class="wallpaper-engine-root-chip"><span title="手动导入目录">' + escHtml(root.name || '导入目录') + '</span>' +
      '<button type="button" data-wallpaper-action="remove-root" data-root-id="' + escHtml(root.id || '') + '" title="移除此索引目录">×</button></span>';
  }).join('');
}

function renderWallpaperEngineLibrary(preserveRenderLimit) {
  var grid = document.getElementById('wallpaper-engine-grid');
  if (!grid) return;
  var modal = document.getElementById('wallpaper-engine-modal');
  if (modal && !modal.classList.contains('show')) {
    disconnectWallpaperEnginePreviewObserver();
    return;
  }
  if (!preserveRenderLimit) wallpaperEngineRenderLimit = WALLPAPER_ENGINE_RENDER_BATCH;
  disconnectWallpaperEnginePreviewObserver();
  if (wallpaperEngineLibraryBusy) {
    grid.innerHTML = '<div class="wallpaper-engine-empty">正在读取 project.json 元数据，不扫描 94GB 素材文件…</div>';
    return;
  }
  var items = wallpaperEngineFilteredProjects();
  if (!items.length) {
    grid.innerHTML = '<div class="wallpaper-engine-empty">' + (wallpaperEngineProjects.length ? '没有符合筛选条件的壁纸' : '没有识别到 Wallpaper Engine 项目<br>可以点击"导入目录"手动选择项目或素材库') + '</div>';
    return;
  }
  var visibleItems = items.slice(0, wallpaperEngineRenderLimit);
  grid.innerHTML = visibleItems.map(function (item) {
    var favorite = favoriteWallpaperEngineIds.has(item.id);
    var active = wallpaperEngineSelection.active && wallpaperEngineSelection.id === item.id;
    var preview = item.hasPreview ? wallpaperEngineMediaUrl(item, 'preview') : '';
    return '<article class="wallpaper-engine-card' + (favorite ? ' favorite' : '') + (active ? ' active' : '') + '" tabindex="0" role="button" data-wallpaper-id="' + item.id + '">' +
      (preview ? '<img class="wallpaper-engine-card-preview" data-src="' + escHtml(preview) + '" data-animated="' + (item.previewAnimated ? '1' : '0') + '" alt="" loading="lazy" decoding="async">' : '<div class="wallpaper-engine-card-placeholder"></div>') +
      '<button class="wallpaper-engine-card-star' + (favorite ? ' active' : '') + '" type="button" data-wallpaper-action="favorite" data-wallpaper-id="' + item.id + '" title="' + (favorite ? '取消星标' : '星标并置顶') + '">' + (favorite ? '★' : '☆') + '</button>' +
      '<button class="wallpaper-engine-card-settings" type="button" data-wallpaper-action="details" data-wallpaper-id="' + item.id + '" title="读取项目设置">⚙</button>' +
      '<button class="wallpaper-engine-card-hide" type="button" data-wallpaper-action="hide" data-wallpaper-id="' + item.id + '" title="从列表隐藏">×</button>' +
      '<div class="wallpaper-engine-card-meta">' + escHtml(item.title) + '<small>' + escHtml(wallpaperEngineProjectLabel(item)) + '</small></div>' +
      '</article>';
  }).join('') + (visibleItems.length < items.length
    ? '<button type="button" class="wallpaper-engine-load-more" data-wallpaper-action="load-more">继续加载 ' + visibleItems.length + ' / ' + items.length + '</button>'
    : '');
  observeWallpaperEnginePreviews();
}

function scheduleWallpaperEngineLibraryRender() {
  clearTimeout(wallpaperEngineSearchRenderTimer);
  wallpaperEngineSearchRenderTimer = setTimeout(function () {
    wallpaperEngineSearchRenderTimer = 0;
    renderWallpaperEngineLibrary();
  }, 90);
}

function updateWallpaperEngineLibraryStatus(snapshot, error) {
  var status = document.getElementById('wallpaper-engine-library-status');
  if (!status) return;
  status.classList.toggle('loading', wallpaperEngineLibraryBusy);
  if (wallpaperEngineLibraryBusy) {
    status.textContent = '正在识别 Steam 创意工坊与本地项目…';
  } else if (error) {
    status.textContent = '识别失败：' + error;
  } else if (snapshot) {
    var runtimeText = snapshot.runtime && snapshot.runtime.available === false ? ' · 未找到可用的 Wallpaper Engine 本体' : '';
    status.textContent = '已识别 ' + (snapshot.count || 0) + ' 个项目 · ' + (snapshot.dynamicCount || 0) + ' 个媒体动态 · ' +
      (snapshot.enginePlayableCount || 0) + ' 个 Scene 原生运行 · ' + (snapshot.previewOnlyCount || 0) + ' 个安全预览 · 用时 ' + (snapshot.elapsedMs || 0) + 'ms' + runtimeText;
  } else {
    status.textContent = '等待识别本机 Wallpaper Engine 库';
  }
}

// ===== 项目详情 =====

function normalizeWallpaperEngineProjectDetails(details) {
  details = details && typeof details === 'object' ? details : {};
  var id = String(details.id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
  if (id.length !== 24) return null;
  var properties = Array.isArray(details.properties) ? details.properties.slice(0, 256).map(function (property) {
    property = property && typeof property === 'object' ? property : {};
    var key = String(property.key || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 128);
    if (!key) return null;
    var value = property.value;
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') value = null;
    if (typeof value === 'string') value = value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512);
    var options = Array.isArray(property.options) ? property.options.slice(0, 64).map(function (option) {
      option = option && typeof option === 'object' ? option : {};
      var optionValue = option.value;
      if (typeof optionValue !== 'boolean' && typeof optionValue !== 'number' && typeof optionValue !== 'string') return null;
      return {
        label: String(option.label || '选项').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160),
        value: optionValue
      };
    }).filter(Boolean) : [];
    return {
      key: key,
      label: String(property.label || key).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || key,
      type: String(property.type || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'unknown',
      value: value,
      options: options,
      audio: property.audio === true,
      autoMuted: property.autoMuted === true
    };
  }).filter(Boolean) : [];
  return {
    id: id,
    title: String(details.title || 'Wallpaper Engine').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Wallpaper Engine',
    projectType: String(details.projectType || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'unknown',
    workshopId: String(details.workshopId || '').replace(/\D/g, '').slice(0, 32),
    propertyCount: Math.max(0, Math.min(256, Number(details.propertyCount) || properties.length)),
    audioPropertyCount: Math.max(0, Math.min(256, Number(details.audioPropertyCount) || 0)),
    mutedAudioPropertyCount: Math.max(0, Math.min(256, Number(details.mutedAudioPropertyCount) || 0)),
    properties: properties
  };
}

function wallpaperEnginePropertyValueLabel(property) {
  if (property.options && property.options.length) {
    var selected = property.options.find(function (option) { return String(option.value) === String(property.value); });
    if (selected) return selected.label;
  }
  if (typeof property.value === 'boolean') return property.value ? '开启' : '关闭';
  if (typeof property.value === 'number') return String(Math.round(property.value * 1000) / 1000);
  if (typeof property.value === 'string' && property.value) return property.value;
  return '未设置';
}

function renderWallpaperEngineProjectDetails(details, error) {
  var drawer = document.getElementById('wallpaper-engine-details-drawer');
  var title = document.getElementById('wallpaper-engine-details-title');
  var summary = document.getElementById('wallpaper-engine-details-summary');
  var properties = document.getElementById('wallpaper-engine-details-properties');
  var weButton = document.getElementById('wallpaper-engine-details-we');
  var workshopButton = document.getElementById('wallpaper-engine-details-workshop');
  if (!drawer || !title || !summary || !properties) return;
  drawer.classList.add('show');
  drawer.setAttribute('aria-hidden', 'false');
  if (error) {
    title.textContent = '项目设置';
    summary.textContent = error;
    properties.innerHTML = '<div class="wallpaper-engine-details-empty">无法读取此项目的 project.json 设置。</div>';
    if (weButton) weButton.disabled = true;
    if (workshopButton) workshopButton.disabled = true;
    return;
  }
  if (!details) {
    title.textContent = '正在读取项目设置…';
    summary.textContent = '只读取 project.json 元数据，不解包大型 Scene 文件。';
    properties.innerHTML = '<div class="wallpaper-engine-details-empty">读取中…</div>';
    if (weButton) weButton.disabled = true;
    if (workshopButton) workshopButton.disabled = true;
    return;
  }
  title.textContent = details.title;
  summary.textContent = '已读取 ' + details.propertyCount + ' 项设置 · 检测到 ' + details.audioPropertyCount +
    ' 项音频控制 · 每次加载自动静音 ' + details.mutedAudioPropertyCount + ' 项';
  properties.innerHTML = details.properties.length ? details.properties.map(function (property) {
    var badge = property.audio
      ? '<span class="wallpaper-engine-property-badge' + (property.autoMuted ? '' : ' warning') + '">' + (property.autoMuted ? '加载时静音' : '音频相关') + '</span>'
      : '';
    return '<div class="wallpaper-engine-property-row">' +
      '<div class="wallpaper-engine-property-copy"><strong>' + escHtml(property.label) + '</strong><small>' +
      escHtml(property.key + ' · ' + property.type) + '</small></div>' +
      badge + '<span class="wallpaper-engine-property-value">' + escHtml(wallpaperEnginePropertyValueLabel(property)) + '</span></div>';
  }).join('') : '<div class="wallpaper-engine-details-empty">这个项目没有声明可调整的用户属性。</div>';
  var canOpen = /^\d{5,32}$/.test(details.workshopId);
  if (weButton) weButton.disabled = !canOpen;
  if (workshopButton) workshopButton.disabled = !canOpen;
}

async function showWallpaperEngineProjectDetails(id) {
  id = String(id || '');
  var api = wallpaperEngineDesktopApi();
  wallpaperEngineProjectDetailsId = id;
  renderWallpaperEngineProjectDetails(null, '');
  if (!api || typeof api.getWallpaperEngineProjectDetails !== 'function') {
    renderWallpaperEngineProjectDetails(null, '当前环境不支持读取 Wallpaper Engine 项目设置');
    return;
  }
  try {
    var response = await api.getWallpaperEngineProjectDetails(id);
    if (wallpaperEngineProjectDetailsId !== id) return;
    if (!response || response.ok === false) throw new Error(response && response.error || '读取失败');
    var details = normalizeWallpaperEngineProjectDetails(response);
    if (!details) throw new Error('项目设置格式无效');
    renderWallpaperEngineProjectDetails(details, '');
  } catch (error) {
    if (wallpaperEngineProjectDetailsId === id) renderWallpaperEngineProjectDetails(null, error.message || '读取失败');
  }
}

function closeWallpaperEngineProjectDetails() {
  wallpaperEngineProjectDetailsId = '';
  var drawer = document.getElementById('wallpaper-engine-details-drawer');
  if (drawer) {
    drawer.classList.remove('show');
    drawer.setAttribute('aria-hidden', 'true');
  }
}

async function launchWallpaperEngineProjectDetails(target) {
  var id = wallpaperEngineProjectDetailsId;
  var api = wallpaperEngineDesktopApi();
  if (!id || !api || typeof api.openWallpaperEngineProjectDetails !== 'function') return;
  try {
    var response = await api.openWallpaperEngineProjectDetails(id, target === 'workshop' ? 'workshop' : 'we');
    if (!response || response.ok === false) throw new Error(response && response.error || '打开失败');
    if (response.opened === 'wallpaper-engine') showToast('已在 Wallpaper Engine 中定位此壁纸；可打开项目设置栏调整');
    else if (response.fallback) showToast('当前 WE 版本无法直接定位，已打开创意工坊详情');
    else showToast('已打开创意工坊详情');
  } catch (error) {
    showToast(error.message === 'WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE'
      ? '手动导入项目没有 Workshop ID，暂时无法在 WE 中定位'
      : (error.message || '无法打开 Wallpaper Engine 项目详情'));
  }
}

// ===== 库加载 / 打开 / 刷新 =====

function consumeWallpaperEngineSnapshot(snapshot) {
  wallpaperEngineLibrarySnapshot = snapshot || null;
  wallpaperEngineMediaToken = /^[a-f0-9]{48}$/i.test(String(snapshot && snapshot.mediaToken || ''))
    ? String(snapshot.mediaToken).toLowerCase() : '';
  wallpaperEngineProjects = snapshot && Array.isArray(snapshot.projects)
    ? snapshot.projects.map(normalizeWallpaperEngineProject).filter(Boolean)
    : [];
  renderWallpaperEngineManualRoots();
  updateWallpaperEngineLibraryStatus(snapshot, '');
  renderWallpaperEngineLibrary();
  if (wallpaperEngineSelection.active) {
    var selected = wallpaperEngineProjectById(wallpaperEngineSelection.id);
    if (selected) {
      wallpaperEngineSelection = normalizeWallpaperEngineSelection(Object.assign({}, wallpaperEngineSelection, {
        title: selected.title,
        kind: wallpaperEngineSelection.kind === 'engine' && !selected.enginePlayable ? (selected.playable ? 'media' : 'preview') : wallpaperEngineSelection.kind,
        mediaType: wallpaperEngineSelection.kind === 'engine' && selected.enginePlayable ? 'video' : (wallpaperEngineSelection.kind === 'media' ? selected.mediaType : 'image'),
        mediaAnimated: selected.mediaAnimated,
        projectType: selected.projectType,
        hasPreview: selected.hasPreview,
        previewAnimated: selected.previewAnimated,
        updatedAt: selected.updatedAt
      }));
      saveWallpaperEngineSelection();
    }
  }
}

async function loadWallpaperEngineLibrary(force, showNotice) {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.listWallpaperEngineProjects !== 'function') {
    updateWallpaperEngineLibraryStatus(null, '仅桌面版支持本地壁纸识别');
    if (showNotice) showToast('当前环境不支持 Wallpaper Engine 本地识别');
    return [];
  }
  if (wallpaperEngineLibraryBusy) return wallpaperEngineProjects;
  wallpaperEngineLibraryBusy = true;
  var failure = '';
  updateWallpaperEngineLibraryStatus(null, '');
  renderWallpaperEngineLibrary();
  try {
    var snapshot = await api.listWallpaperEngineProjects({ force: force === true });
    if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '扫描失败');
    consumeWallpaperEngineSnapshot(snapshot);
    if (showNotice) showToast(snapshot.count ? ('已识别 ' + snapshot.count + ' 个 Wallpaper Engine 项目') : '没有识别到 Wallpaper Engine 项目');
    return wallpaperEngineProjects;
  } catch (e) {
    failure = e.message || '扫描失败';
    wallpaperEngineProjects = [];
    wallpaperEngineLibrarySnapshot = null;
    wallpaperEngineMediaToken = '';
    if (showNotice) showToast('Wallpaper Engine 识别失败');
    return [];
  } finally {
    wallpaperEngineLibraryBusy = false;
    updateWallpaperEngineLibraryStatus(wallpaperEngineLibrarySnapshot, failure);
    renderWallpaperEngineLibrary();
  }
}

async function openWallpaperEngineLibrary() {
  var modal = document.getElementById('wallpaper-engine-modal');
  if (modal) modal.classList.add('show');
  if (!wallpaperEngineLibrarySnapshot) await loadWallpaperEngineLibrary(false, false);
  else renderWallpaperEngineLibrary();
}

function closeWallpaperEngineLibrary() {
  closeWallpaperEngineProjectDetails();
  var modal = document.getElementById('wallpaper-engine-modal');
  if (modal) modal.classList.remove('show');
  clearTimeout(wallpaperEngineSearchRenderTimer);
  wallpaperEngineSearchRenderTimer = 0;
  clearTimeout(wallpaperEnginePreviewScrollTimer);
  wallpaperEnginePreviewScrollTimer = 0;
  disconnectWallpaperEnginePreviewObserver();
  document.querySelectorAll('#wallpaper-engine-grid img[data-animated="1"]').forEach(function (image) {
    image.removeAttribute('src');
    image.classList.remove('loaded');
  });
}

async function refreshWallpaperEngineLibrary() {
  await loadWallpaperEngineLibrary(true, true);
}

// ===== 导入管理 =====

async function chooseWallpaperEngineDirectory() {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.chooseWallpaperEngineDirectory !== 'function') {
    showToast('当前环境不支持目录导入');
    return;
  }
  if (wallpaperEngineLibraryBusy) return;
  wallpaperEngineLibraryBusy = true;
  var failure = '';
  updateWallpaperEngineLibraryStatus(null, '');
  renderWallpaperEngineLibrary();
  try {
    var snapshot = await api.chooseWallpaperEngineDirectory();
    if (snapshot && snapshot.canceled) return;
    if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '导入失败');
    consumeWallpaperEngineSnapshot(snapshot);
    showToast('目录已加入壁纸索引，共识别 ' + (snapshot.count || 0) + ' 个项目');
  } catch (e) {
    failure = e.message || '导入失败';
    showToast(e.message || 'Wallpaper Engine 目录导入失败');
  } finally {
    wallpaperEngineLibraryBusy = false;
    updateWallpaperEngineLibraryStatus(wallpaperEngineLibrarySnapshot, failure);
    renderWallpaperEngineLibrary();
  }
}

async function chooseWallpaperEngineProjectFile() {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.chooseWallpaperEngineProjectFile !== 'function') {
    showToast('当前环境不支持 Wallpaper Engine 场景包导入');
    return;
  }
  if (wallpaperEngineLibraryBusy) return;
  wallpaperEngineLibraryBusy = true;
  var failure = '';
  updateWallpaperEngineLibraryStatus(null, '');
  renderWallpaperEngineLibrary();
  try {
    var snapshot = await api.chooseWallpaperEngineProjectFile();
    if (snapshot && snapshot.canceled) return;
    if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '导入失败');
    consumeWallpaperEngineSnapshot(snapshot);
    showToast('Wallpaper Engine 项目已加入索引；Scene 将由本机官方引擎实时运行');
  } catch (e) {
    failure = e.message || '项目文件导入失败';
    showToast(failure);
  } finally {
    wallpaperEngineLibraryBusy = false;
    updateWallpaperEngineLibraryStatus(wallpaperEngineLibrarySnapshot, failure);
    renderWallpaperEngineLibrary();
  }
}

async function removeWallpaperEngineDirectory(rootId) {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.removeWallpaperEngineDirectory !== 'function') return;
  if (wallpaperEngineLibraryBusy) return;
  wallpaperEngineLibraryBusy = true;
  updateWallpaperEngineLibraryStatus(null, '');
  renderWallpaperEngineLibrary();
  var failure = '';
  try {
    var snapshot = await api.removeWallpaperEngineDirectory(rootId);
    if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '移除失败');
    consumeWallpaperEngineSnapshot(snapshot);
    showToast('已移除手动导入目录，Steam 自动识别不受影响');
  } catch (e) {
    failure = e.message || '目录移除失败';
    showToast(e.message || '目录移除失败');
  } finally {
    wallpaperEngineLibraryBusy = false;
    updateWallpaperEngineLibraryStatus(wallpaperEngineLibrarySnapshot, failure);
    renderWallpaperEngineLibrary();
  }
}

// ===== 收藏 / 隐藏 =====

function toggleFavoriteWallpaperEngineItem(id) {
  id = String(id || '');
  if (favoriteWallpaperEngineIds.has(id)) favoriteWallpaperEngineIds.delete(id);
  else favoriteWallpaperEngineIds.add(id);
  saveWallpaperEngineIdSet(WALLPAPER_ENGINE_FAVORITE_STORE_KEY, favoriteWallpaperEngineIds);
  renderWallpaperEngineLibrary();
}

function hideWallpaperEngineItem(id) {
  id = String(id || '');
  hiddenWallpaperEngineIds.add(id);
  saveWallpaperEngineIdSet(WALLPAPER_ENGINE_HIDDEN_STORE_KEY, hiddenWallpaperEngineIds);
  renderWallpaperEngineLibrary();
}

function restoreHiddenWallpaperEngineItems() {
  if (!hiddenWallpaperEngineIds.size) {
    showToast('没有已隐藏的壁纸');
    return;
  }
  hiddenWallpaperEngineIds.clear();
  saveWallpaperEngineIdSet(WALLPAPER_ENGINE_HIDDEN_STORE_KEY, hiddenWallpaperEngineIds);
  renderWallpaperEngineLibrary();
  showToast('已恢复全部隐藏壁纸');
}

// ===== 初始化 =====

function bindWallpaperEngineLibraryEvents() {
  var grid = document.getElementById('wallpaper-engine-grid');
  if (grid && !grid._wallpaperEngineBound) {
    grid._wallpaperEngineBound = true;
    grid.addEventListener('scroll', scheduleWallpaperEnginePreviewViewportUpdate, { passive: true });
    grid.addEventListener('click', function (event) {
      var action = event.target && event.target.closest ? event.target.closest('[data-wallpaper-action]') : null;
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        var actionName = action.getAttribute('data-wallpaper-action');
        var id = action.getAttribute('data-wallpaper-id');
        if (actionName === 'favorite') toggleFavoriteWallpaperEngineItem(id);
        else if (actionName === 'hide') hideWallpaperEngineItem(id);
        else if (actionName === 'details') showWallpaperEngineProjectDetails(id);
        else if (actionName === 'load-more') {
          wallpaperEngineRenderLimit += WALLPAPER_ENGINE_RENDER_BATCH;
          renderWallpaperEngineLibrary(true);
        }
        return;
      }
      var card = event.target && event.target.closest ? event.target.closest('[data-wallpaper-id]') : null;
      if (card) activateWallpaperEngineItem(card.getAttribute('data-wallpaper-id'));
    });
    grid.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target && event.target.closest && event.target.closest('[data-wallpaper-action]')) return;
      var card = event.target && event.target.closest ? event.target.closest('.wallpaper-engine-card[data-wallpaper-id]') : null;
      if (!card || event.target !== card) return;
      event.preventDefault();
      activateWallpaperEngineItem(card.getAttribute('data-wallpaper-id'));
    });
  }
  var roots = document.getElementById('wallpaper-engine-manual-roots');
  if (roots && !roots._wallpaperEngineBound) {
    roots._wallpaperEngineBound = true;
    roots.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-wallpaper-action="remove-root"]') : null;
      if (button) removeWallpaperEngineDirectory(button.getAttribute('data-root-id'));
    });
  }
  if (!document._wallpaperEngineKeyBound) {
    document._wallpaperEngineKeyBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var drawer = document.getElementById('wallpaper-engine-details-drawer');
        if (drawer && drawer.classList.contains('show')) closeWallpaperEngineProjectDetails();
        else closeWallpaperEngineLibrary();
      }
    });
    document.addEventListener('visibilitychange', function () {
      var video = document.getElementById('wallpaper-engine-video');
      if (!wallpaperEngineSelection.active) return;
      var item = wallpaperEngineProjectById(wallpaperEngineSelection.id);
      if (wallpaperEngineSelection.kind === 'engine') {
        // native scene 已剥离，engine 选择在 applyWallpaperEngineBackground 中回退到安全预览
        return;
      }
      if (wallpaperEngineSelection.mediaType === 'video') {
        if (!video) return;
        if (document.hidden) {
          cancelWallpaperEngineVideoRetry();
          try { video.pause(); } catch (e) { }
        } else if (document.body.classList.contains('wallpaper-engine-active')) {
          var token = wallpaperEngineLayerToken;
          requestWallpaperEngineVideoPlayback(video, item, 'media', token, false, 0);
        }
        return;
      }
      var animatedImage = wallpaperEngineSelection.kind === 'preview'
        ? wallpaperEngineSelection.previewAnimated : wallpaperEngineSelection.mediaAnimated;
      if (!animatedImage || !item) return;
      if (document.hidden) {
        ++wallpaperEngineLayerToken;
        clearWallpaperEngineLayerMedia(0);
      } else {
        applyWallpaperEngineBackground(item, true);
      }
    });
    window.addEventListener('pagehide', function () {
      cancelWallpaperEngineSwitchTimer();
      cancelWallpaperEngineVideoRetry();
      cancelWallpaperEngineFirstFrameWait();
      ++wallpaperEngineLayerToken;
      clearWallpaperEngineLayerMedia(0);
    });
  }
}

function initializeWallpaperEngineLibrary() {
  bindWallpaperEngineLibraryEvents();
  updateWallpaperEngineEntryUi();
  if (!wallpaperEngineSelection.active) return;
  setTimeout(function () {
    loadWallpaperEngineLibrary(false, false).then(function () {
      var item = wallpaperEngineProjectById(wallpaperEngineSelection.id);
      if (item) applyWallpaperEngineBackground(item, true);
      else {
        wallpaperEngineRuntimeError = '项目离线';
        updateWallpaperEngineEntryUi('项目离线 · 已显示原背景');
      }
    });
  }, 120);
}

// 延迟到 DOMContentLoaded 后初始化，并用 try/catch 兜底，
// 避免模块加载阶段因 DOM 未就绪或异常中断后续脚本（含歌词渲染链）。
function safeInitWallpaperEngineLibrary() {
  try { initializeWallpaperEngineLibrary(); }
  catch (e) { console.warn('[WallpaperEngine] init failed:', e); }
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(safeInitWallpaperEngineLibrary, 0);
} else {
  document.addEventListener('DOMContentLoaded', safeInitWallpaperEngineLibrary);
}
