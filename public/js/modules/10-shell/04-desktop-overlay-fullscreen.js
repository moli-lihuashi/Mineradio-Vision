var desktopOverlayPushState = {
  lyricsAt: 0,
  wallpaperAt: 0,
  lastLyricsKey: '',
  lastLyricsBeatKey: '',
  lastLyricsCustomFontId: '',
  lastWallpaperKey: ''
};
var desktopWallpaperRuntimeState = {
  supported: true,
  active: false,
  enabled: false,
  attaching: false,
  generation: -1,
  lastError: ''
};
var desktopWallpaperStatusGeneration = -1;
var desktopWallpaperStatusUnsubscribe = null;
var desktopWallpaperEscapeBound = false;
var desktopPlaybackSnapshotFlushBound = false;
var wallpaperStageBootToastShown = false;
var desktopWallpaperRendererOperation = 0;
var desktopWallpaperUiActivationState = false;
var desktopWallpaperHudPrimeTimer = 0;
/* 效果层没能压到 z 序最底时只提示一次：那意味着它会浮在其他窗口上面（仍然鼠标穿透），
 * 用户看到的是「粒子盖住整个屏幕」。状态里 zOrder='none' 是失败的唯一显式信号。 */
var desktopWallpaperZOrderWarned = false;
/* 主窗口「只控不渲染」态的当前值：只在翻转时做重活（渲染器尺寸/主循环）。 */
var wallpaperHostCastLast = false;
/* 视觉控制台的控件交互（滑块/开关/预设卡）给 1.2s 预览：
 * 面板只是打开、不动控件时不恢复渲染；拖动滑块会连续续期，松手 1.2s 后回到只控态。
 * 这样「点 FX」不会把整块舞台又拉起来，但调参数时仍有画面反馈。 */
var wallpaperHostCastPreviewUntil = 0;
var wallpaperHostCastPreviewTimer = 0;
var wallpaperHostCastPanelBound = false;
var desktopIconVisibilityOperation = 0;
var desktopIconVisibilityPending = false;
var desktopSoftwareLockOperation = 0;
var desktopSoftwareLockPending = false;
var desktopModeControlDockState = {
  open: false,
  hideTimer: 0,
  peek: false,
  peekTimer: 0
};
// 控制器 DOM 还没解析出来时挂的 DOMContentLoaded 重试（index-loader 用 fetch 注入模块，
// 执行时机可能早于 body 解析完成）
var desktopModeControlsInitPending = false;
var desktopPointerRouteReporter = {
  timer: 0,
  x: 0,
  y: 0,
  hasPointer: false,
  lastKey: '',
  forcePending: false,
  overControls: false
};
var desktopIconShieldReporter = {
  timer: 0,
  forceEmptyPending: false,
  lastKey: '',
  mutationObserver: null,
  resizeObserver: null,
  shelfTimer: 0,
  observedElements: []
};
var DESKTOP_ICON_SHIELD_TARGETS = [
  { selector: '#bottom-bar', kind: 'player-control' },
  { selector: '#search-area', kind: 'search' },
  { selector: '#top-right', kind: 'account-actions' },
  { selector: '#desktop-mode-control-handle', kind: 'desktop-controls' },
  { selector: '#desktop-mode-control-panel', kind: 'desktop-controls' },
  { selector: '#fx-panel', kind: 'fx-panel' },
  { selector: '#fx-fab', kind: 'fx-launcher' },
  { selector: '#fx-fab-hide-btn', kind: 'fx-launcher-toggle' },
  { selector: '#playlist-panel', kind: 'playlist-panel' },
  { selector: '#empty-home', kind: 'home' },
  { selector: '#desktop-titlebar', kind: 'window-controls' },
  { selector: '#fullscreen-diy-zone', kind: 'fullscreen-tools', ignoreAriaHidden: true },
  { selector: '#upload-panel', kind: 'upload-panel' },
  { selector: '#upload-tip', kind: 'upload-tip' },
  { selector: '#bottom-handle', kind: 'player-handle' },
  { selector: '#mini-queue-popover', kind: 'mini-queue' },
  { selector: '#thumb-wrap', kind: 'cover-control' },
  { selector: '#trial-banner', kind: 'trial-banner' },
  { selector: '#source-fallback-notice', kind: 'source-notice' },
  { selector: '#ai-depth-chip', kind: 'depth-chip' },
  { selector: '#beat-chip', kind: 'beat-chip' },
  { selector: '#cover-color-pop', kind: 'cover-color' },
  { selector: '#color-lab-pop', kind: 'color-lab' },
  { selector: '.quality-popover', kind: 'quality-popover' },
  { selector: '.volume-popover', kind: 'volume-popover' },
  { selector: '#lyric-timing-popover', kind: 'lyric-timing-popover' },
  { selector: '#control-source-switcher', kind: 'source-switcher' },
  { selector: '#cuefield-feedback', kind: 'cuefield-feedback' },
  { selector: '#cookie-export-prompt', kind: 'cookie-export' },
  { selector: '.modal-mask', kind: 'modal', visual: true },
  { selector: '#toast', kind: 'toast', visual: true },
  { selector: '#visual-guide', kind: 'guide', visual: true },
  { selector: '#drop-overlay', kind: 'drop', visual: true },
  { selector: '#splash', kind: 'splash', visual: true }
];
var DESKTOP_ICON_SHIELD_SELECTOR = DESKTOP_ICON_SHIELD_TARGETS.map(function (target) {
  return target.selector;
}).join(',');
function getDesktopWindowApi() {
  return window.desktopWindow && window.desktopWindow.isDesktop ? window.desktopWindow : null;
}

function desktopIconShieldModeState() {
  var status = desktopWallpaperRuntimeState || {};
  var windowState = desktopWindowState || {};
  var body = document.body;
  var hasWindowEnabled = typeof windowState.isDesktopEmbedded === 'boolean';
  var hasWindowInteractive = typeof windowState.isDesktopInteractive === 'boolean';
  var hasStatusEnabled = typeof status.enabled === 'boolean' || typeof status.active === 'boolean';
  var hasStatusInteractive = typeof status.interactive === 'boolean';
  var enabled = hasWindowEnabled
    ? windowState.isDesktopEmbedded === true
    : (hasStatusEnabled
      ? (status.enabled === true || status.active === true)
      : !!(body && body.classList.contains('desktop-wallpaper-mode')));
  var interactive = hasWindowInteractive
    ? windowState.isDesktopInteractive === true
    : (hasStatusInteractive
      ? status.interactive === true
      : !!(body && body.classList.contains('desktop-wallpaper-interactive')));
  var visible = document.visibilityState !== 'hidden'
    && windowState.isVisible !== false
    && windowState.isMinimized !== true;
  return {
    enabled: !!enabled,
    interactive: !!interactive,
    active: !!(enabled && interactive && visible)
  };
}

function desktopIconShieldElementVisible(element, target) {
  if (!element || element.nodeType !== 1 || element.hidden) return false;
  if ((!target || target.ignoreAriaHidden !== true)
    && String(element.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return false;
  var style;
  try {
    style = window.getComputedStyle ? window.getComputedStyle(element) : element.currentStyle;
  } catch (_) {
    style = null;
  }
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.contentVisibility === 'hidden') return false;
    var opacity = parseFloat(style.opacity);
    if (isFinite(opacity) && opacity <= 0.01) return false;
    if ((!target || target.visual !== true) && style.pointerEvents === 'none') return false;
  }
  if (!element.getClientRects || element.getClientRects().length < 1) return false;
  return true;
}

function desktopIconShieldClippedRect(rect, viewportWidth, viewportHeight, kind) {
  if (!rect) return null;
  var left = Math.max(0, Math.floor(Number(rect.left) || 0));
  var top = Math.max(0, Math.floor(Number(rect.top) || 0));
  var right = Math.min(viewportWidth, Math.ceil(Number(rect.right)));
  var bottom = Math.min(viewportHeight, Math.ceil(Number(rect.bottom)));
  if (!isFinite(right) || !isFinite(bottom) || right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    kind: kind || 'ui'
  };
}

function desktopIconShieldMeshRect(mesh, viewportWidth, viewportHeight, kind, pad) {
  if (!mesh || !mesh.geometry || typeof THREE === 'undefined' || typeof camera === 'undefined' || !camera) return null;
  var current = mesh;
  while (current) {
    if (current.visible === false) return null;
    current = current.parent;
  }
  var params = mesh.geometry.parameters || {};
  var halfWidth = Math.max(0.02, Number(params.width) || 0) / 2;
  var halfHeight = Math.max(0.02, Number(params.height) || 0) / 2;
  if (!isFinite(halfWidth) || !isFinite(halfHeight)) return null;
  var points = [
    new THREE.Vector3(-halfWidth, -halfHeight, 0),
    new THREE.Vector3(halfWidth, -halfHeight, 0),
    new THREE.Vector3(halfWidth, halfHeight, 0),
    new THREE.Vector3(-halfWidth, halfHeight, 0)
  ];
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  try {
    mesh.updateMatrixWorld(true);
    for (var i = 0; i < points.length; i++) {
      points[i].applyMatrix4(mesh.matrixWorld).project(camera);
      var x = (points[i].x + 1) * viewportWidth / 2;
      var y = (1 - points[i].y) * viewportHeight / 2;
      if (!isFinite(x) || !isFinite(y)) return null;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  } catch (_) {
    return null;
  }
  var safePad = Math.max(12, Math.min(96, Number(pad) || 32));
  return desktopIconShieldClippedRect({
    left: minX - safePad,
    top: minY - safePad,
    right: maxX + safePad,
    bottom: maxY + safePad
  }, viewportWidth, viewportHeight, kind);
}

function desktopIconShieldUnionRects(rects, viewportWidth, viewportHeight, kind) {
  if (!rects || !rects.length) return null;
  var left = viewportWidth;
  var top = viewportHeight;
  var right = 0;
  var bottom = 0;
  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return desktopIconShieldClippedRect({ left: left, top: top, right: right, bottom: bottom }, viewportWidth, viewportHeight, kind);
}

function desktopIconShieldShelfRects(viewportWidth, viewportHeight) {
  var pinned = typeof shelfPinnedOpen !== 'undefined' && shelfPinnedOpen === true;
  var contentOpen = false;
  var mode = 'off';
  var canInteract = false;
  var alwaysVisible = false;
  var previewVisible = false;
  try {
    contentOpen = !!(typeof shelfManager !== 'undefined' && shelfManager
      && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
    mode = String(shelfManager && shelfManager.getMode && shelfManager.getMode() || 'off');
    canInteract = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
    alwaysVisible = typeof shelfAlwaysVisible === 'function' && shelfAlwaysVisible();
    previewVisible = typeof shelfPreviewIsVisible === 'function' && shelfPreviewIsVisible();
  } catch (_) {
    contentOpen = false;
  }
  var sideActive = mode === 'side' && canInteract && (pinned || contentOpen || alwaysVisible || previewVisible);
  var stageActive = mode === 'stage' && canInteract;
  if (!sideActive && !stageActive && !contentOpen) return [];

  var projected = [];
  try {
    var cards = shelfManager && shelfManager.getCards ? shelfManager.getCards() : [];
    for (var i = 0; i < cards.length && projected.length < 28; i++) {
      var cardRect = desktopIconShieldMeshRect(cards[i] && cards[i].mesh, viewportWidth, viewportHeight, 'shelf-card', 42);
      if (cardRect) projected.push(cardRect);
    }
    var content = shelfManager && shelfManager.getContentList ? shelfManager.getContentList() : null;
    var rows = contentOpen && content && content.getRows ? content.getRows() : [];
    for (var j = 0; j < rows.length && projected.length < 52; j++) {
      var rowRect = desktopIconShieldMeshRect(rows[j] && rows[j].mesh, viewportWidth, viewportHeight, 'shelf-detail-row', 28);
      if (rowRect) projected.push(rowRect);
    }
  } catch (_) {
    projected = [];
  }
  var union = desktopIconShieldUnionRects(projected, viewportWidth, viewportHeight,
    contentOpen ? 'shelf-detail' : (mode === 'stage' ? 'shelf-stage' : 'shelf-side'));
  if (union) return [union];

  if (mode === 'stage') {
    return [desktopIconShieldClippedRect({
      left: 0,
      top: Math.round(viewportHeight * 0.46),
      right: viewportWidth,
      bottom: viewportHeight
    }, viewportWidth, viewportHeight, 'shelf-stage-fallback')].filter(Boolean);
  }
  var width = contentOpen
    ? Math.min(viewportWidth, Math.max(560, Math.round(viewportWidth * 0.68)))
    : Math.min(viewportWidth, Math.max(390, Math.round(viewportWidth * 0.42)));
  return [desktopIconShieldClippedRect({
    left: viewportWidth - width,
    top: Math.max(56, Math.round(viewportHeight * 0.04)),
    right: viewportWidth,
    bottom: viewportHeight - Math.max(84, Math.round(viewportHeight * 0.08))
  }, viewportWidth, viewportHeight, contentOpen ? 'shelf-detail-fallback' : 'shelf-side-fallback')].filter(Boolean);
}

function desktopIconShieldShelfNeedsGeometryTracking() {
  try {
    if (typeof shelfManager === 'undefined' || !shelfManager || !shelfManager.getMode
      || !shelfManager.canInteract || !shelfManager.canInteract()) return false;
    var mode = String(shelfManager.getMode() || 'off');
    if (mode === 'stage') return true;
    if (mode !== 'side') return false;
    return (typeof shelfPinnedOpen !== 'undefined' && shelfPinnedOpen === true)
      || !!(shelfManager.hasOpenContent && shelfManager.hasOpenContent())
      || (typeof shelfAlwaysVisible === 'function' && shelfAlwaysVisible())
      || (typeof shelfPreviewIsVisible === 'function' && shelfPreviewIsVisible());
  } catch (_) {
    return false;
  }
}

function collectDesktopIconShieldRects() {
  var viewportWidth = Math.max(0, Math.round(window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0));
  var viewportHeight = Math.max(0, Math.round(window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0));
  var rects = [];
  if (!viewportWidth || !viewportHeight) return { width: viewportWidth, height: viewportHeight, rects: rects };
  for (var i = 0; i < DESKTOP_ICON_SHIELD_TARGETS.length && rects.length < 64; i++) {
    var target = DESKTOP_ICON_SHIELD_TARGETS[i];
    var elements;
    try {
      elements = document.querySelectorAll(target.selector);
    } catch (_) {
      elements = [];
    }
    for (var j = 0; j < elements.length && rects.length < 64; j++) {
      var element = elements[j];
      if (!desktopIconShieldElementVisible(element, target)) continue;
      var clientRects = element.getClientRects ? element.getClientRects() : [];
      for (var k = 0; k < clientRects.length && rects.length < 64; k++) {
        var clipped = desktopIconShieldClippedRect(clientRects[k], viewportWidth, viewportHeight, target.kind);
        if (clipped) rects.push(clipped);
      }
    }
  }
  if (rects.length < 64) {
    var shelfRects = desktopIconShieldShelfRects(viewportWidth, viewportHeight);
    for (var shelfIndex = 0; shelfIndex < shelfRects.length && rects.length < 64; shelfIndex++) {
      if (shelfRects[shelfIndex]) rects.push(shelfRects[shelfIndex]);
    }
  }
  return { width: viewportWidth, height: viewportHeight, rects: rects };
}

function desktopIconsAreVisible(status) {
  status = status || desktopWallpaperRuntimeState || {};
  return !Object.prototype.hasOwnProperty.call(status, 'desktopIconsVisible')
    || status.desktopIconsVisible !== false;
}

function desktopUsesLayeredExplorerColorkey(status) {
  return !!(status && status.iconLayerMode === 'explorer-layered-colorkey');
}

function clearDesktopIconRevealMask() {
  var shell = document.getElementById('desktop-window-shell');
  if (!shell) return;
  shell.style.removeProperty('-webkit-mask-image');
  shell.style.removeProperty('-webkit-mask-repeat');
  shell.style.removeProperty('-webkit-mask-position');
  shell.style.removeProperty('-webkit-mask-size');
  shell.style.removeProperty('mask-image');
  shell.style.removeProperty('mask-repeat');
  shell.style.removeProperty('mask-position');
  shell.style.removeProperty('mask-size');
}

function applyDesktopIconRevealMask(shieldRects) {
  document.body.classList.remove('desktop-icons-locked');
  clearDesktopIconRevealMask();
}

function updateDesktopModeControl(status) {
  status = status || desktopWallpaperRuntimeState || {};
  var api = getDesktopWindowApi();
  var active = desktopIconShieldModeState().active;
  var softwareLocked = status.softwareInteractionLocked === true;
  var softwareLockButton = document.getElementById('desktop-software-lock-toggle');
  var softwareLockState = document.getElementById('desktop-software-lock-state');
  var iconsVisible = desktopIconsAreVisible(status);
  var iconsButton = document.getElementById('desktop-icons-visible-toggle');
  var iconsState = document.getElementById('desktop-icons-visible-state');
  if (softwareLockButton) {
    var softwareLockSupported = !!(api && typeof api.setDesktopSoftwareLocked === 'function');
    softwareLockButton.setAttribute('aria-checked', softwareLocked ? 'true' : 'false');
    softwareLockButton.setAttribute('aria-busy', desktopSoftwareLockPending ? 'true' : 'false');
    softwareLockButton.disabled = desktopSoftwareLockPending || !active || !softwareLockSupported;
    softwareLockButton.title = softwareLocked ? '恢复 Mineradio 操作' : '暂时把操作交给 Windows 桌面';
  }
  if (softwareLockState) softwareLockState.textContent = softwareLocked ? '软件操作已锁定，可在此解锁' : '软件可正常操作';
  if (document.body) document.body.classList.toggle('desktop-software-locked', active && softwareLocked);
  if (iconsButton) {
    var iconsSupported = !!(api && typeof api.setDesktopIconsVisible === 'function');
    iconsButton.setAttribute('aria-checked', iconsVisible ? 'true' : 'false');
    iconsButton.setAttribute('aria-busy', desktopIconVisibilityPending ? 'true' : 'false');
    iconsButton.disabled = desktopIconVisibilityPending || !active || !iconsSupported;
    iconsButton.title = iconsVisible ? '隐藏 Windows 桌面图标' : '显示 Windows 桌面图标';
  }
  if (iconsState) iconsState.textContent = iconsVisible ? '图标已显示' : '图标已隐藏';
}

function updateDesktopIconLockControl(status) {
  updateDesktopModeControl(status);
}

function consumeDesktopModeControlEvent(event) {
  if (!event) return;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
}

function setDesktopIconsVisibility(desired, event) {
  consumeDesktopModeControlEvent(event);
  var api = getDesktopWindowApi();
  var mode = desktopIconShieldModeState();
  if (!api || typeof api.setDesktopIconsVisible !== 'function' || !mode.active) {
    if (typeof showToast === 'function') showToast('当前桌面图标显示控制不可用');
    return Promise.resolve({ ok: false, error: 'DESKTOP_ICON_VISIBILITY_INACTIVE' });
  }
  if (desktopIconVisibilityPending) return Promise.resolve({ ok: false, error: 'DESKTOP_ICON_VISIBILITY_BUSY' });
  desired = desired !== false;
  var operation = ++desktopIconVisibilityOperation;
  desktopIconVisibilityPending = true;
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  return Promise.resolve(api.setDesktopIconsVisible(desired)).then(function (result) {
    if (operation !== desktopIconVisibilityOperation) return result;
    result = result && typeof result === 'object' ? result : { ok: false, error: 'DESKTOP_ICON_VISIBILITY_RESULT_INVALID' };
    if (result.status) {
      applyDesktopWallpaperRuntimeStatus(result.status);
    } else if (result.ok === true) {
      desktopWallpaperRuntimeState.desktopIconsVisible = desired;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
    }
    if (typeof showToast === 'function') {
      showToast(result.ok === true
        ? (desired ? '桌面图标已显示' : '桌面图标已隐藏')
        : (desired ? '桌面图标显示失败' : '桌面图标隐藏失败'));
    }
    return result;
  }).catch(function (error) {
    if (operation !== desktopIconVisibilityOperation) return { ok: false, error: String(error && error.message || error) };
    if (typeof showToast === 'function') showToast(desired ? '桌面图标显示失败' : '桌面图标隐藏失败');
    return { ok: false, error: String(error && error.message || error) };
  }).then(function (result) {
    if (operation === desktopIconVisibilityOperation) {
      desktopIconVisibilityPending = false;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
      scheduleDesktopIconShieldReport(false);
    }
    return result;
  });
}

function toggleDesktopIconsVisibility(event) {
  return setDesktopIconsVisibility(!desktopIconsAreVisible(desktopWallpaperRuntimeState), event);
}

function requestDesktopKeyboardFocus(reason) {
  var api = getDesktopWindowApi();
  var mode = desktopIconShieldModeState();
  if (!api || typeof api.requestDesktopKeyboardFocus !== 'function'
    || !mode.active
    || desktopWallpaperRuntimeState.softwareInteractionLocked === true) return false;
  try {
    api.requestDesktopKeyboardFocus(reason || 'renderer-pointerdown');
    return true;
  } catch (_) {
    return false;
  }
}

function setDesktopSoftwareInteractionLocked(desired, event) {
  var restoreKeyboardFocus = desired !== true && !!(event && event.isTrusted);
  consumeDesktopModeControlEvent(event);
  var api = getDesktopWindowApi();
  var mode = desktopIconShieldModeState();
  if (!api || typeof api.setDesktopSoftwareLocked !== 'function' || !mode.active) {
    if (typeof showToast === 'function') showToast('当前软件操作锁定不可用');
    return Promise.resolve({ ok: false, error: 'DESKTOP_SOFTWARE_LOCK_INACTIVE' });
  }
  if (desktopSoftwareLockPending) return Promise.resolve({ ok: false, error: 'DESKTOP_SOFTWARE_LOCK_BUSY' });
  desired = desired === true;
  var operation = ++desktopSoftwareLockOperation;
  desktopSoftwareLockPending = true;
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  return Promise.resolve(api.setDesktopSoftwareLocked(desired)).then(function (result) {
    if (operation !== desktopSoftwareLockOperation) return result;
    result = result && typeof result === 'object' ? result : { ok: false, error: 'DESKTOP_SOFTWARE_LOCK_RESULT_INVALID' };
    if (result.status) {
      applyDesktopWallpaperRuntimeStatus(result.status);
    } else if (result.ok === true) {
      desktopWallpaperRuntimeState.softwareInteractionLocked = desired;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
    }
    if (typeof showToast === 'function') {
      showToast(result.ok === true
        ? (desired ? '软件操作已锁定；移到右上角可随时解锁' : '软件操作已恢复')
        : (desired ? '软件操作锁定失败' : '软件操作解锁失败'));
    }
    if (result.ok === true && restoreKeyboardFocus) {
      requestDesktopKeyboardFocus('software-unlocked');
    }
    return result;
  }).catch(function (error) {
    if (operation !== desktopSoftwareLockOperation) return { ok: false, error: String(error && error.message || error) };
    if (typeof showToast === 'function') showToast(desired ? '软件操作锁定失败' : '软件操作解锁失败');
    return { ok: false, error: String(error && error.message || error) };
  }).then(function (result) {
    if (operation === desktopSoftwareLockOperation) {
      desktopSoftwareLockPending = false;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
      scheduleDesktopPointerRouteReport(null, true);
    }
    return result;
  });
}

function toggleDesktopSoftwareInteractionLocked(event) {
  return setDesktopSoftwareInteractionLocked(!(desktopWallpaperRuntimeState
    && desktopWallpaperRuntimeState.softwareInteractionLocked === true), event);
}

function cancelDesktopModeControlHide() {
  if (!desktopModeControlDockState.hideTimer) return;
  clearTimeout(desktopModeControlDockState.hideTimer);
  desktopModeControlDockState.hideTimer = 0;
}

function cancelDesktopModeControlPeekHide() {
  if (!desktopModeControlDockState.peekTimer) return;
  clearTimeout(desktopModeControlDockState.peekTimer);
  desktopModeControlDockState.peekTimer = 0;
}

function setDesktopModeControlPeek(peek) {
  peek = peek === true && desktopIconShieldModeState().active;
  if (peek) cancelDesktopModeControlPeekHide();
  if (desktopModeControlDockState.peek === peek) return;
  desktopModeControlDockState.peek = peek;
  if (document.body) document.body.classList.toggle('desktop-mode-control-peek', peek);
  scheduleDesktopIconShieldReport(false);
}

function scheduleDesktopModeControlPeekHide(delay) {
  cancelDesktopModeControlPeekHide();
  desktopModeControlDockState.peekTimer = setTimeout(function () {
    desktopModeControlDockState.peekTimer = 0;
    var dock = document.getElementById('desktop-mode-control-dock');
    if (desktopModeControlDockState.open
      || (dock && (dock.matches(':hover') || dock.contains(document.activeElement)))) return;
    setDesktopModeControlPeek(false);
  }, Math.max(180, Number(delay) || 980));
}

function setDesktopModeControlsOpen(open) {
  open = open === true && desktopIconShieldModeState().active;
  cancelDesktopModeControlHide();
  if (open) setDesktopModeControlPeek(true);
  if (desktopModeControlDockState.open === open) return;
  desktopModeControlDockState.open = open;
  var dock = document.getElementById('desktop-mode-control-dock');
  var handle = document.getElementById('desktop-mode-control-handle');
  var panel = document.getElementById('desktop-mode-control-panel');
  if (dock) dock.classList.toggle('is-open', open);
  if (handle) handle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) {
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) panel.removeAttribute('inert');
    else panel.setAttribute('inert', '');
    panel.querySelectorAll('button').forEach(function (button) {
      button.tabIndex = open ? 0 : -1;
    });
  }
  document.body.classList.toggle('desktop-mode-controls-open', open);
  if (!open) scheduleDesktopModeControlPeekHide(900);
  scheduleDesktopIconShieldReport(false);
  scheduleDesktopPointerRouteReport(null, true);
}

function scheduleDesktopModeControlHide(delay) {
  cancelDesktopModeControlHide();
  desktopModeControlDockState.hideTimer = setTimeout(function () {
    desktopModeControlDockState.hideTimer = 0;
    var dock = document.getElementById('desktop-mode-control-dock');
    if (dock && (dock.matches(':hover') || dock.contains(document.activeElement))) return;
    setDesktopModeControlsOpen(false);
  }, Math.max(120, Number(delay) || 680));
}

function desktopPointInClientRect(x, y, rect) {
  return !!rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function desktopControlPointState(x, y) {
  var handle = document.getElementById('desktop-mode-control-handle');
  var panel = document.getElementById('desktop-mode-control-panel');
  var rootStyle = null;
  try { rootStyle = window.getComputedStyle(document.documentElement); } catch (_) { }
  var safeTop = rootStyle ? parseFloat(rootStyle.getPropertyValue('--desktop-safe-top')) || 0 : 0;
  var safeRight = rootStyle ? parseFloat(rootStyle.getPropertyValue('--desktop-safe-right')) || 0 : 0;
  var overRevealEdge = x >= Math.max(0, window.innerWidth - safeRight - 92)
    && x < Math.max(0, window.innerWidth - safeRight)
    && y >= safeTop && y < safeTop + 104;
  var overHotspot = !!(handle && desktopIconShieldElementVisible(handle, { ignoreAriaHidden: true })
    && desktopPointInClientRect(x, y, handle.getBoundingClientRect()));
  var overPanel = !!(desktopModeControlDockState.open && panel
    && desktopIconShieldElementVisible(panel, { ignoreAriaHidden: true })
    && desktopPointInClientRect(x, y, panel.getBoundingClientRect()));
  return {
    overRevealEdge: overRevealEdge,
    overHotspot: overHotspot,
    overPanel: overPanel,
    overControls: overRevealEdge || overHotspot || overPanel
  };
}

function desktopPointerOverSoftwareUi(x, y) {
  var collected = collectDesktopIconShieldRects();
  for (var i = 0; i < collected.rects.length; i++) {
    var rect = collected.rects[i];
    if (!rect || rect.kind === 'desktop-controls') continue;
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) return true;
  }
  return false;
}

function flushDesktopPointerRouteReport(force) {
  if (desktopPointerRouteReporter.timer) {
    clearTimeout(desktopPointerRouteReporter.timer);
    desktopPointerRouteReporter.timer = 0;
  }
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopPointerRoute !== 'function') return;
  var mode = desktopIconShieldModeState();
  var overSoftwareUi = false;
  var overDesktopControls = false;
  if (mode.active && desktopPointerRouteReporter.hasPointer) {
    var pointState = desktopControlPointState(desktopPointerRouteReporter.x, desktopPointerRouteReporter.y);
    overDesktopControls = pointState.overControls;
    if (overDesktopControls) {
      setDesktopModeControlPeek(true);
      cancelDesktopModeControlHide();
      cancelDesktopModeControlPeekHide();
    }
    else if (desktopModeControlDockState.open) {
      scheduleDesktopModeControlHide(desktopWallpaperRuntimeState
        && desktopWallpaperRuntimeState.softwareInteractionLocked === true ? 120 : 680);
    }
    else scheduleDesktopModeControlPeekHide(980);
    overSoftwareUi = desktopPointerOverSoftwareUi(desktopPointerRouteReporter.x, desktopPointerRouteReporter.y);
  }
  var key = (overSoftwareUi ? '1' : '0') + '|' + (overDesktopControls ? '1' : '0');
  if (!force && key === desktopPointerRouteReporter.lastKey) return;
  desktopPointerRouteReporter.lastKey = key;
  try {
    api.updateDesktopPointerRoute({
      overSoftwareUi: overSoftwareUi,
      overDesktopControls: overDesktopControls
    });
  } catch (_) { }
}

function scheduleDesktopPointerRouteReport(event, force) {
  if (event && isFinite(event.clientX) && isFinite(event.clientY)) {
    desktopPointerRouteReporter.x = Number(event.clientX);
    desktopPointerRouteReporter.y = Number(event.clientY);
    desktopPointerRouteReporter.hasPointer = true;
    var mode = desktopIconShieldModeState();
    var nextOverControls = mode.active
      && desktopControlPointState(desktopPointerRouteReporter.x, desktopPointerRouteReporter.y).overControls;
    if (nextOverControls !== desktopPointerRouteReporter.overControls) force = true;
    desktopPointerRouteReporter.overControls = nextOverControls;
  }
  if (force === true) desktopPointerRouteReporter.forcePending = true;
  if (desktopPointerRouteReporter.timer) {
    if (force !== true) return;
    clearTimeout(desktopPointerRouteReporter.timer);
    desktopPointerRouteReporter.timer = 0;
  }
  desktopPointerRouteReporter.timer = setTimeout(function () {
    var forcePending = desktopPointerRouteReporter.forcePending;
    desktopPointerRouteReporter.forcePending = false;
    flushDesktopPointerRouteReport(forcePending);
  }, force === true ? 0 : 48);
}

function initDesktopModeControls(api) {
  var dock = document.getElementById('desktop-mode-control-dock');
  var handle = document.getElementById('desktop-mode-control-handle');
  var panel = document.getElementById('desktop-mode-control-panel');
  var softwareLockButton = document.getElementById('desktop-software-lock-toggle');
  var iconsButton = document.getElementById('desktop-icons-visible-toggle');
  if (!dock || !handle || !panel) {
    /* 模块可能先于 body 解析执行（index-loader 是 fetch 注入），DOM 还没到就等一次，
       否则控制器永远不初始化 —— 用户进了壁纸模式看不到任何按钮。 */
    if (document.readyState === 'loading' && !desktopModeControlsInitPending) {
      desktopModeControlsInitPending = true;
      document.addEventListener('DOMContentLoaded', function () {
        desktopModeControlsInitPending = false;
        initDesktopModeControls(api);
      }, { once: true });
    }
    return;
  }
  setDesktopModeControlsOpen(false);
  handle.addEventListener('click', function (event) {
    consumeDesktopModeControlEvent(event);
    setDesktopModeControlsOpen(!desktopModeControlDockState.open);
  });
  handle.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      consumeDesktopModeControlEvent(event);
      setDesktopModeControlsOpen(true);
      if (softwareLockButton) softwareLockButton.focus();
      else if (iconsButton) iconsButton.focus();
    }
  });
  dock.addEventListener('mouseenter', function () {
    setDesktopModeControlPeek(true);
    cancelDesktopModeControlHide();
    cancelDesktopModeControlPeekHide();
  });
  dock.addEventListener('mouseleave', function () {
    scheduleDesktopModeControlHide(680);
    scheduleDesktopModeControlPeekHide(980);
  });
  dock.addEventListener('focusin', function () {
    setDesktopModeControlPeek(true);
    cancelDesktopModeControlHide();
    cancelDesktopModeControlPeekHide();
  });
  dock.addEventListener('focusout', function () {
    scheduleDesktopModeControlHide(680);
    scheduleDesktopModeControlPeekHide(980);
  });
  dock.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    consumeDesktopModeControlEvent(event);
    setDesktopModeControlsOpen(false);
    handle.focus();
  });
  if (softwareLockButton) softwareLockButton.addEventListener('click', toggleDesktopSoftwareInteractionLocked);
  if (iconsButton) iconsButton.addEventListener('click', toggleDesktopIconsVisibility);
  /* 控制器里的退出按钮：桌面模式下任务栏点不到窗口，这是唯一「看得见」的退出入口 */
  var exitButton = document.getElementById('desktop-exit-wallpaper-toggle');
  if (exitButton) exitButton.addEventListener('click', function (event) {
    consumeDesktopModeControlEvent(event);
    setDesktopModeControlsOpen(false);
    if (fx) fx.wallpaperMode = false;
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
    applyWallpaperModeState(true);
  });
  document.addEventListener('pointerdown', function (event) {
    if (event && event.isTrusted) requestDesktopKeyboardFocus('pointerdown');
    if (!desktopModeControlDockState.open || dock.contains(event.target)) return;
    var focused = document.activeElement;
    if (focused && panel.contains(focused) && typeof focused.blur === 'function') focused.blur();
    setDesktopModeControlsOpen(false);
  }, true);
  document.addEventListener('mousemove', function (event) {
    scheduleDesktopPointerRouteReport(event, false);
  }, { passive: true });
  window.addEventListener('blur', function () {
    setDesktopModeControlsOpen(false);
    scheduleDesktopModeControlPeekHide(360);
  });
  window.addEventListener('pagehide', function () {
    cancelDesktopModeControlHide();
    cancelDesktopModeControlPeekHide();
    desktopPointerRouteReporter.hasPointer = false;
    desktopPointerRouteReporter.overControls = false;
    flushDesktopPointerRouteReport(true);
  }, { once: true });
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  setDesktopModeControlPeek(false);
  scheduleDesktopPointerRouteReport(null, true);
}

function desktopIconShieldPayloadKey(payload) {
  var rectKey = [];
  var rects = payload.rects || [];
  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    rectKey.push([rect.x, rect.y, rect.width, rect.height, rect.kind || ''].join(','));
  }
  return [
    payload.enabled ? 1 : 0,
    payload.interactive ? 1 : 0,
    payload.viewport.width,
    payload.viewport.height,
    payload.viewport.scaleFactor,
    payload.runtimeGeneration,
    rectKey.join(';')
  ].join('|');
}

function flushDesktopIconShieldReport(forceEmpty) {
  if (desktopIconShieldReporter.timer) {
    clearTimeout(desktopIconShieldReporter.timer);
    desktopIconShieldReporter.timer = 0;
  }
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopIconShields !== 'function') return;
  var mode = desktopIconShieldModeState();
  var collected = mode.active && !forceEmpty
    ? collectDesktopIconShieldRects()
    : {
      width: Math.max(0, Math.round(window.innerWidth || 0)),
      height: Math.max(0, Math.round(window.innerHeight || 0)),
      rects: []
    };
  applyDesktopIconRevealMask(forceEmpty ? [] : collected.rects);
  var payload = {
    enabled: mode.enabled,
    interactive: mode.interactive,
    viewport: {
      width: collected.width,
      height: collected.height,
      scaleFactor: Math.max(0.25, Number(window.devicePixelRatio) || 1)
    },
    runtimeGeneration: Math.max(-1, Number(desktopWallpaperRuntimeState && desktopWallpaperRuntimeState.generation) || 0),
    rects: forceEmpty ? [] : collected.rects.slice(0, 64)
  };
  var key = desktopIconShieldPayloadKey(payload);
  if (key === desktopIconShieldReporter.lastKey) return;
  desktopIconShieldReporter.lastKey = key;
  try {
    api.updateDesktopIconShields(payload);
  } catch (_) { }
}

function scheduleDesktopIconShieldReport(forceEmpty) {
  desktopIconShieldReporter.forceEmptyPending = forceEmpty === true;
  if (desktopIconShieldReporter.timer) return;
  desktopIconShieldReporter.timer = setTimeout(function () {
    var pendingForceEmpty = desktopIconShieldReporter.forceEmptyPending;
    desktopIconShieldReporter.forceEmptyPending = false;
    flushDesktopIconShieldReport(pendingForceEmpty);
  }, 100);
}

function desktopIconShieldMutationRelevant(mutation) {
  if (!mutation) return false;
  var target = mutation.target && mutation.target.nodeType === 1 ? mutation.target : null;
  if (target === document.documentElement || target === document.body) return true;
  try {
    if (target && (target.matches(DESKTOP_ICON_SHIELD_SELECTOR) || target.closest(DESKTOP_ICON_SHIELD_SELECTOR))) return true;
  } catch (_) { }
  if (mutation.type !== 'childList') return false;
  var nodes = [];
  if (mutation.addedNodes) nodes = nodes.concat(Array.prototype.slice.call(mutation.addedNodes));
  if (mutation.removedNodes) nodes = nodes.concat(Array.prototype.slice.call(mutation.removedNodes));
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (!node || node.nodeType !== 1) continue;
    try {
      if (node.matches(DESKTOP_ICON_SHIELD_SELECTOR) || node.querySelector(DESKTOP_ICON_SHIELD_SELECTOR)) return true;
    } catch (_) { }
  }
  return false;
}

function refreshDesktopIconShieldResizeTargets() {
  var observer = desktopIconShieldReporter.resizeObserver;
  if (!observer) return;
  var next = [];
  for (var i = 0; i < DESKTOP_ICON_SHIELD_TARGETS.length; i++) {
    var elements;
    try {
      elements = document.querySelectorAll(DESKTOP_ICON_SHIELD_TARGETS[i].selector);
    } catch (_) {
      elements = [];
    }
    for (var j = 0; j < elements.length; j++) {
      if (next.indexOf(elements[j]) < 0) next.push(elements[j]);
    }
  }
  var previous = desktopIconShieldReporter.observedElements;
  for (var p = 0; p < previous.length; p++) {
    if (next.indexOf(previous[p]) < 0 && observer.unobserve) {
      try { observer.unobserve(previous[p]); } catch (_) { }
    }
  }
  for (var n = 0; n < next.length; n++) {
    if (previous.indexOf(next[n]) < 0) {
      try { observer.observe(next[n]); } catch (_) { }
    }
  }
  desktopIconShieldReporter.observedElements = next;
}

function initDesktopIconShieldReporter(api) {
  if (!api || typeof api.updateDesktopIconShields !== 'function') return;
  if (typeof window.ResizeObserver === 'function') {
    desktopIconShieldReporter.resizeObserver = new ResizeObserver(function () {
      scheduleDesktopIconShieldReport(false);
    });
    refreshDesktopIconShieldResizeTargets();
  }
  if (typeof window.MutationObserver === 'function') {
    desktopIconShieldReporter.mutationObserver = new MutationObserver(function (mutations) {
      var relevant = false;
      var refreshTargets = false;
      for (var i = 0; i < mutations.length; i++) {
        if (!desktopIconShieldMutationRelevant(mutations[i])) continue;
        relevant = true;
        if (mutations[i].type === 'childList') refreshTargets = true;
      }
      if (!relevant) return;
      if (refreshTargets) refreshDesktopIconShieldResizeTargets();
      scheduleDesktopIconShieldReport(false);
    });
    desktopIconShieldReporter.mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden']
    });
  }
  window.addEventListener('resize', function () { scheduleDesktopIconShieldReport(false); }, { passive: true });
  document.addEventListener('transitionend', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('animationend', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('click', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('contextmenu', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('input', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('change', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('visibilitychange', function () {
    scheduleDesktopIconShieldReport(document.visibilityState === 'hidden');
  });
  // Three.js shelf cards move without DOM mutations. A low-rate timer follows
  // only an actually interactive shelf; it is not a mouse loop or an rAF and
  // dedupe prevents IPC when the projected hit envelope has not changed.
  desktopIconShieldReporter.shelfTimer = setInterval(function () {
    if (!desktopIconShieldModeState().active || !desktopIconShieldShelfNeedsGeometryTracking()) return;
    scheduleDesktopIconShieldReport(false);
  }, 250);
  window.addEventListener('pagehide', function () {
    if (desktopIconShieldReporter.shelfTimer) clearInterval(desktopIconShieldReporter.shelfTimer);
    desktopIconShieldReporter.shelfTimer = 0;
    flushDesktopIconShieldReport(true);
  }, { once: true });
  scheduleDesktopIconShieldReport(false);
}
function currentDesktopSongMeta() {
  var song = playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null;
  song = song || currentLyricSong && currentLyricSong() || {};
  return {
    title: song.name || song.title || 'Mineradio',
    artist: song.artist || song.ar || song.author || '',
    cover: (typeof songCoverSrc === 'function' && song) ? (songCoverSrc(song, 360) || song.cover || '') : (song.cover || '')
  };
}
function normalizeDesktopLyricText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
/* 桌面歌词多行窗口：以当前句为中心取 count 行，两端不足时用空行补齐，
 * 保证当前句永远落在第 floor(count/2) 行 —— 换行时整块不上下跳。
 * entries: [{ text, progress }]；返回 null 表示仍走原来的单行渲染。 */
function desktopLyricWindow(entries, activeIdx, count) {
  count = normalizeDesktopLyricsLineCount(count);
  if (count <= 1) return null;
  var list = Array.isArray(entries) ? entries : [];
  var half = Math.floor(count / 2);
  var rows = [];
  for (var k = 0; k < count; k++) {
    var source = list[activeIdx - half + k];
    rows.push({
      text: source && source.text ? String(source.text) : '',
      progress: source ? clampRange(Number(source.progress) || 0, 0, 1) : 0,
      active: activeIdx - half + k === activeIdx
    });
  }
  return rows;
}
function currentDesktopLyricSnapshot() {
  var rawT = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  var t = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(rawT) : rawT;
  var lines = Array.isArray(lyricsLines) ? lyricsLines : [];
  var lineCount = normalizeDesktopLyricsLineCount(fx.desktopLyricsLines);
  function withWindow(snapshot, entries, activeIdx) {
    snapshot.lineCount = lineCount;
    snapshot.lines = desktopLyricWindow(entries, activeIdx, lineCount);
    return snapshot;
  }
  if (playing && audio && lines.length) {
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.05) idx = i;
      else break;
    }
    if (idx >= 0) {
      var curLine = lines[idx] || { t: t, text: '' };
      var nextLine = lines[idx + 1];
      var nextT = nextLine && nextLine.t > curLine.t ? nextLine.t : Math.min((audio && audio.duration) || t + 4, curLine.t + (curLine.duration || 4.8));
      var span = Math.max(0.75, nextT - curLine.t);
      var entries = [];
      for (var j = 0; j < lines.length; j++) {
        entries.push({
          text: normalizeDesktopLyricText((lines[j] && lines[j].text) || ''),
          progress: j < idx ? 1 : (j > idx ? 0 : getLyricLineProgress(curLine, nextLine, t))
        });
      }
      return withWindow({
        text: normalizeDesktopLyricText(curLine.text || currentLyricFallbackText()),
        nextText: normalizeDesktopLyricText(nextLine && nextLine.text ? nextLine.text : ''),
        progress: getLyricLineProgress(curLine, nextLine, t),
        progressSpan: span
      }, entries, idx);
    }
    var introText = normalizeDesktopLyricText(currentLyricFallbackText());
    if (introText) {
      var firstLine = lines[0];
      var introEnd = firstLine && firstLine.t > 0 ? firstLine.t : Math.min((audio && audio.duration) || 4.8, 4.8);
      var introProgress = getLyricLineProgress({ t: 0, text: introText, duration: Math.max(0.8, introEnd), charCount: Math.max(1, introText.length), fallback: true }, null, t);
      return withWindow({
        text: introText,
        nextText: normalizeDesktopLyricText(firstLine && firstLine.text ? firstLine.text : ''),
        progress: introProgress,
        progressSpan: Math.max(0.8, introEnd)
      }, [{ text: introText, progress: introProgress }], 0);
    }
  }
  if (stageLyrics && stageLyrics.currentText) {
    var stageText = normalizeDesktopLyricText(stageLyrics.currentText);
    var stageProgress = stageLyrics.current && stageLyrics.current.userData ? clampRange(Number(stageLyrics.current.userData.lastLyricProgress) || 0, 0, 1) : 0;
    return withWindow({
      text: stageText,
      nextText: '',
      progress: stageProgress,
      progressSpan: 4.8
    }, [{ text: stageText, progress: stageProgress }], 0);
  }
  // 没有歌词时退化成歌名（有歌在播时）；连歌都没有就留空，
  // 否则桌面上会一直挂一个 "Mineradio" 的品牌名，看起来像渲染坏了。
  var fallbackMeta = currentDesktopSongMeta();
  var hasSong = !!(playQueue && currentIdx >= 0 && playQueue[currentIdx])
    || !!(typeof currentLyricSong === 'function' && currentLyricSong());
  var fallbackText = normalizeDesktopLyricText(hasSong ? (fallbackMeta.title || '') : '');
  return withWindow({ text: fallbackText, nextText: '', progress: 0, progressSpan: 4.8 }, [{ text: fallbackText, progress: 0 }], 0);
}
function desktopOverlayColorValue(value, fallback) {
  var raw = String(value || '').trim();
  fallback = String(fallback || '#d6f8ff').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return normalizeHexColor(raw, fallback);
  if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
  return normalizeHexColor(raw, fallback);
}
function desktopOverlayColors() {
  var pal = stageLyrics && stageLyrics.palette || {};
  return {
    primary: desktopOverlayColorValue(pal.primary || fx.lyricColor || '#d6f8ff', '#d6f8ff'),
    secondary: desktopOverlayColorValue(pal.secondary || fx.visualTintColor || '#9cffdf', '#9cffdf'),
    highlight: desktopOverlayColorValue(pal.highlight || fx.lyricHighlightColor || '#fff0b8', '#fff0b8'),
    glow: desktopOverlayColorValue(pal.glowColor || pal.secondary || pal.primary || fx.lyricGlowColor || '#9cffdf', '#9cffdf')
  };
}
function desktopLyricsMotionPayload() {
  return {
    lyricGlow: !!fx.lyricGlow,
    lyricGlowBeat: !!fx.lyricGlowBeat,
    lyricGlowStrength: fx.lyricGlow ? clampRange(Number(fx.lyricGlowStrength) || 0, 0, 0.85) : 0,
    highBloom: stageLyrics && isFinite(stageLyrics.highBloom) ? clampRange(stageLyrics.highBloom, 0, 1.45) : 0,
    beatGlow: stageLyrics && isFinite(stageLyrics.beatGlow) ? clampRange(stageLyrics.beatGlow, 0, 1.7) : 0,
    beatPulse: isFinite(beatPulse) ? clampRange(beatPulse, 0, 1.4) : 0,
    bass: isFinite(bass) ? clampRange(bass, 0, 1.2) : 0
  };
}
function desktopLyricsPlaybackPayload() {
  var time = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  var duration = audio && isFinite(audio.duration) ? Number(audio.duration) : 0;
  var rate = audio && isFinite(audio.playbackRate) && audio.playbackRate > 0 ? Number(audio.playbackRate) : 1;
  return {
    time: Math.max(0, time),
    duration: Math.max(0, duration),
    rate: clampRange(rate, 0.25, 4)
  };
}
function desktopLyricsActiveBeatMap() {
  var useDj = !!(djMode && djMode.active && currentDjBeatMap);
  return {
    source: useDj ? 'dj' : 'mr',
    map: useDj ? currentDjBeatMap : currentBeatMap
  };
}
function desktopLyricsBeatMapPayload(force) {
  var selected = desktopLyricsActiveBeatMap();
  var map = selected && selected.map;
  var source = selected && selected.source || 'mr';
  var cameraCount = map ? ((map.cameraBeats && map.cameraBeats.length) || (map.beats && map.beats.length) || (map.kicks && map.kicks.length) || 0) : 0;
  var pulseCount = map ? ((map.pulseBeats && map.pulseBeats.length) || (map.kicks && map.kicks.length) || 0) : 0;
  var duration = map && isFinite(map.duration) ? Number(map.duration) : 0;
  var partialUntil = map && isFinite(map.partialUntilSec) ? Number(map.partialUntilSec) : 0;
  var key = map
    ? [source, map.analyzedAt || 0, cameraCount, pulseCount, Math.round(duration * 10), Math.round(partialUntil * 10), map.tempoSource || 'local'].join('|')
    : 'none';
  var shouldSendMap = !!force || key !== desktopOverlayPushState.lastLyricsBeatKey;
  desktopOverlayPushState.lastLyricsBeatKey = key;
  var payload = { beatMapKey: key };
  if (shouldSendMap) payload.beatMap = map ? packLocalBeatMap(map) : null;
  return payload;
}
function notifyDesktopLyricsBeatMapReady() {
  try {
    if (fx && fx.desktopLyrics) pushDesktopLyricsState(true);
  } catch (e) { }
}
function desktopLyricsPushInterval() {
  var fps = normalizeDesktopLyricsFps(fx && fx.desktopLyricsFps);
  if (!fps) return 8;
  return Math.max(8, Math.min(42, 1000 / fps));
}
function desktopLyricsCurrentCustomFontId() {
  var font = customLyricFontRecordForKey(fx && fx.lyricFont);
  return font ? font.id : '';
}
function desktopLyricsCustomFontPayload(includeDataUrl) {
  var font = customLyricFontRecordForKey(fx && fx.lyricFont);
  if (!font) return null;
  var payload = {
    id: font.id,
    family: font.family,
    name: font.name
  };
  if (includeDataUrl !== false) payload.dataUrl = font.dataUrl;
  return payload;
}
function desktopLyricsPayload(forceBeatMap, includeCustomFontData) {
  var lyric = currentDesktopLyricSnapshot();
  var beatPayload = desktopLyricsBeatMapPayload(!!forceBeatMap);
  var payload = {
    enabled: !!fx.desktopLyrics && !isDevelopmentLockedFx('desktopLyrics'),
    text: lyric.text,
    // 下一句：单行模式在主题下面用 .line-next 显示（多行栈自己有完整窗口，不用它）
    nextText: lyric.nextText || '',
    progress: lyric.progress,
    progressSpan: lyric.progressSpan,
    playing: !!playing,
    size: clampRange(Number(fx.desktopLyricsSize) || fxDefaults.desktopLyricsSize, DESKTOP_LYRICS_SIZE_MIN, DESKTOP_LYRICS_SIZE_MAX),
    opacity: clampRange(fx.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(fx.desktopLyricsOpacity), 0.28, 1),
    lineCount: normalizeDesktopLyricsLineCount(fx.desktopLyricsLines == null ? fxDefaults.desktopLyricsLines : fx.desktopLyricsLines),
    tilt: clampRange(fx.desktopLyricsTilt == null ? fxDefaults.desktopLyricsTilt : Number(fx.desktopLyricsTilt), DESKTOP_LYRICS_TILT_MIN, DESKTOP_LYRICS_TILT_MAX),
    lyricMotion: normalizeDesktopLyricsMotion(fx.desktopLyricsMotion || fxDefaults.desktopLyricsMotion),
    align: normalizeDesktopLyricsAlign(fx.desktopLyricsAlign || fxDefaults.desktopLyricsAlign),
    lines: lyric.lines || null,
    clickThrough: isDevelopmentLockedFx('desktopLyricsClickThrough') ? true : fx.desktopLyricsClickThrough !== false,
    cinema: fx.desktopLyricsCinema !== false,
    highlightFollow: fx.desktopLyricsHighlight === true,
    frameRate: normalizeDesktopLyricsFps(fx.desktopLyricsFps),
    fontFamily: lyricFontStackForKey(fx.lyricFont),
    customFont: desktopLyricsCustomFontPayload(includeCustomFontData),
    fontWeight: lyricFontWeightValue(),
    letterSpacing: clampRange(Number(fx.lyricLetterSpacing) || 0, -0.04, 0.18),
    lineHeight: lyricLineHeightFactor(),
    feather: lyricsHasNativeKaraoke ? 0.030 : 0.055,
    motion: desktopLyricsMotionPayload(),
    playback: desktopLyricsPlaybackPayload(),
    beatMapKey: beatPayload.beatMapKey,
    colors: desktopOverlayColors()
  };
  if (Object.prototype.hasOwnProperty.call(beatPayload, 'beatMap')) payload.beatMap = beatPayload.beatMap;
  return payload;
}
function normalizeWallpaperFps(fps) {
  fps = Math.round(Number(fps) || 0);
  // 默认 60：与 03c 的 normalizeWallpaperFrameRate / fxDefaults.wallpaperFps 一致
  if (fps <= 0) return 60;
  return Math.max(1, Math.min(60, fps));
}
function wallpaperPayload() {
  var meta = currentDesktopSongMeta();
  return {
    enabled: !!fx.wallpaperMode && !isDevelopmentLockedFx('wallpaperMode'),
    title: meta.title,
    artist: meta.artist,
    cover: meta.cover,
    playing: !!playing,
    preset: fx.preset,
    opacity: clampRange(fx.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(fx.wallpaperOpacity), 0.35, 1),
    frameRate: normalizeWallpaperFps(fx.wallpaperFps),
    colors: desktopOverlayColors(),
    /* 进壁纸模式会销毁重建窗口、页面整页重载。重建出来的那一页要在**第一次绘制之前**
     * 就知道自己该走哪套最小画面（原世界：粒子+歌词 / Folia：只留歌词），所以这个值
     * 由主进程写进导航 URL（?stageWorld=…），index.html 的 head 内联脚本读它。
     * 只有发起切换的这一侧知道当前世界，所以必须在这里带出去。 */
    stageWorld: typeof wallpaperStageWorld === 'function' ? wallpaperStageWorld() : 'native'
  };
}
function desktopWallpaperStatusPayload(payload) {
  if (payload && payload.status && typeof payload.status === 'object') return payload.status;
  return payload && typeof payload === 'object' ? payload : {};
}
function updateDesktopWallpaperRuntimeControls(status) {
  status = status || desktopWallpaperRuntimeState || {};
  var supported = status.supported !== false;
  var attaching = status.attaching === true;
  var toggle = document.getElementById('t-wallpaperMode');
  if (toggle) {
    toggle.classList.toggle('runtime-pending', attaching);
    toggle.classList.toggle('runtime-unavailable', !supported);
    toggle.classList.toggle('runtime-interactive', status.interactive === true);
    toggle.setAttribute('aria-busy', attaching ? 'true' : 'false');
    if (!supported) toggle.setAttribute('aria-disabled', 'true');
    else toggle.removeAttribute('aria-disabled');
    toggle.title = !supported
      ? '当前系统不支持桌面效果层'
      : (attaching
        ? '正在显示桌面效果层'
        : '把粒子与歌词放到桌面上（原世界：粒子+歌词 / Folia：只留歌词）；播放器窗口和任务栏保持原样，再点一次关闭');
  }
  var opacity = document.getElementById('fx-wallpaperopacity');
  if (opacity) opacity.disabled = !supported;
  document.querySelectorAll('#wallpaper-fps-seg [data-wallpaper-fps]').forEach(function (btn) {
    btn.disabled = !supported;
  });
}

function applyDesktopWallpaperSafeArea(status, enabled) {
  var root = document.documentElement;
  if (!root || !root.style) return;
  var insets = status && status.safeInsets && typeof status.safeInsets === 'object'
    ? status.safeInsets
    : null;
  if (!insets && status && status.bounds && status.workArea) {
    var bounds = status.bounds;
    var workArea = status.workArea;
    insets = {
      top: Math.max(0, Number(workArea.y) - Number(bounds.y)),
      right: Math.max(0, Number(bounds.x) + Number(bounds.width) - Number(workArea.x) - Number(workArea.width)),
      bottom: Math.max(0, Number(bounds.y) + Number(bounds.height) - Number(workArea.y) - Number(workArea.height)),
      left: Math.max(0, Number(workArea.x) - Number(bounds.x))
    };
  }
  var names = ['top', 'right', 'bottom', 'left'];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var value = enabled === true && insets ? Math.max(0, Number(insets[name]) || 0) : 0;
    root.style.setProperty('--desktop-safe-' + name, value + 'px');
  }
}

function wallpaperHostCastPreviewRequested() {
  return performance.now() < wallpaperHostCastPreviewUntil;
}

/* 在视觉控制台里真正动了一个控件：给 1.2s 的播放器预览窗口。
 * 只挂 input/change/click 且只在控件上生效 —— 打开面板、点空白处都不算。 */
function noteWallpaperHostCastPreview() {
  if (typeof isWallpaperHostCastMode !== 'function' || !isWallpaperHostCastMode()) return;
  wallpaperHostCastPreviewUntil = performance.now() + 1200;
  syncWallpaperHostCastPresentation();
  if (wallpaperHostCastPreviewTimer) clearTimeout(wallpaperHostCastPreviewTimer);
  wallpaperHostCastPreviewTimer = setTimeout(function () {
    wallpaperHostCastPreviewTimer = 0;
    wallpaperHostCastPreviewUntil = 0;
    syncWallpaperHostCastPresentation();
  }, 1320);
}

function bindWallpaperHostCastPanel() {
  if (wallpaperHostCastPanelBound) return;
  var panel = document.getElementById('fx-panel');
  if (!panel || typeof panel.addEventListener !== 'function') return;
  wallpaperHostCastPanelBound = true;
  var onInteraction = function (event) {
    var target = event && event.target;
    if (!target || typeof target.closest !== 'function') return;
    /* 只认「不随壁纸状态下发」的参数：滑块（input）与开关（t-*）。
     * 预设卡不在此列 —— 预设本来就会经 stage 同步到桌面，预览它只会把
     * 只控态的 #wallpaper-cast-hint 一起摘掉 1.2s，用户看到的就是
     * 「切换预设时提示卡消失一会儿再回来」。 */
    if (event.type === 'input') {
      if (target.closest('input')) noteWallpaperHostCastPreview();
      return;
    }
    if (target.closest('[id^="t-"]')) {
      noteWallpaperHostCastPreview();
    }
  };
  ['input', 'change', 'click'].forEach(function (name) {
    panel.addEventListener(name, onInteraction, true);
  });
}

/* 真正的「不渲染」判据：壁纸模式 + 主窗口 + 没在预览。
 * 主循环与渲染器尺寸都读这一条，避免两处判据打架（面板开着预览时不能缩成 4×4）。 */
function isWallpaperHostCastRenderSuppressed() {
  if (typeof isWallpaperHostCastMode !== 'function' || !isWallpaperHostCastMode()) return false;
  return !wallpaperHostCastPreviewRequested();
}

/* 主窗口「只控不渲染」态的呈现开关。
 * class 给 CSS（wallpaper-stage.css 摘掉画布/歌词/背景特效，露出提示卡）；
 * 翻转时把渲染器缩到 4×4 —— 画面已经在桌面效果层里，播放器这张 canvas 不再需要像素。
 * 只在状态变化时做重活，每帧/每次面板回填调用都安全。 */
function syncWallpaperHostCastPresentation() {
  var applied = typeof isWallpaperHostCastRenderSuppressed === 'function' && isWallpaperHostCastRenderSuppressed();
  if (document.body) document.body.classList.toggle('wallpaper-host-cast', applied);
  if (applied === wallpaperHostCastLast) return applied;
  wallpaperHostCastLast = applied;
  if (typeof applyRendererPowerMode === 'function') {
    try { applyRendererPowerMode(); } catch (_) {}
  }
  /* 切到只控不渲染时补拍一次玻璃镜面：渲染器已经缩到 4×4，这一拍得到的是
   * 一张近似纯色的底，底部控制条的玻璃不会永远冻在最后一帧粒子上。
   * 之后每帧的镜面更新被主循环跳过（省掉一次全屏 GPU 回读）。 */
  if (applied) {
    /* 背景层被 CSS 摘掉，但自定义背景视频仍会继续解码 —— 顺手停掉。 */
    var castBgVideo = document.getElementById('custom-bg-video');
    if (castBgVideo) { try { castBgVideo.pause(); } catch (_) {} }
  } else if (typeof applyCustomBackground === 'function') {
    /* 退出只控态：把背景视频/图片重新按用户设置应用一次（幂等）。 */
    try { applyCustomBackground(); } catch (_) {}
  }
  if (applied && typeof updateLiquidGlassBackdropMirror === 'function') {
    try { updateLiquidGlassBackdropMirror(); } catch (_) {}
  }
  return applied;
}

function syncDesktopWallpaperBodyClasses(status, enabled, interactive) {
  status = status || desktopWallpaperRuntimeState || {};
  /* 壁纸模式不再改主窗口的任何呈现：效果是另一张透明窗口（桌面效果层）。
   * 这里只负责把旧版本可能留在 body 上的 class 清干净 —— 升级后第一帧如果还带着
   * desktop-wallpaper-mode，玻璃圆角与控制条显隐会被按「挂在桌面上」的规则改掉。 */
  document.documentElement.classList.remove('desktop-explorer-layered-colorkey-root');
  document.body.classList.remove('desktop-wallpaper-mode');
  document.body.classList.remove('desktop-wallpaper-interactive');
  document.body.classList.remove('desktop-explorer-layered-colorkey');
  document.body.classList.remove('desktop-software-locked');
  document.body.classList.remove('desktop-icons-hidden');
  if (interactive !== true) {
    setDesktopModeControlsOpen(false);
    setDesktopModeControlPeek(false);
  }
}

function releaseDesktopWallpaperStartupVisibilityGate() {
  var root = document.documentElement;
  if (!root || !root.classList.contains('startup-fast-skip-preload')) return false;
  if (typeof releaseStartupFastSkipPreload === 'function') {
    try { releaseStartupFastSkipPreload(); } catch (_) { }
  }
  // Fail open even if the splash helper was interrupted. This class hides the
  // canvas, Home, search and bottom console, so it must never survive a native
  // desktop-mode activation.
  root.classList.remove('startup-fast-skip-preload');
  return true;
}

function ensureDesktopWallpaperFunctionalUi(reason) {
  var body = document.body;
  if (!body
    || !body.classList.contains('desktop-wallpaper-mode')
    || !body.classList.contains('desktop-wallpaper-interactive')) return false;

  releaseDesktopWallpaperStartupVisibilityGate();
  /* 壁纸模式现在只留舞台（粒子 + 歌词 / 仅 Folia 歌词），播放器面板与底部控制条
   * 按设计全部隐藏（css/10-shell/wallpaper-stage.css）。这里不能再把它们「拉起来」，
   * 否则每 320ms 的健康巡检会跟 CSS 对着改内联样式。开屏门闩上面已经放开，不欠什么。 */
  if (typeof wallpaperStageOnly === 'function' && wallpaperStageOnly()) return true;
  if (typeof immersiveMode !== 'undefined' && immersiveMode
    && typeof setImmersiveMode === 'function') {
    setImmersiveMode(false);
  }

  var homeActive = body.classList.contains('empty-home-active');
  if (homeActive) {
    if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
    return true;
  }

  var shelfSuppressesConsole = false;
  try {
    shelfSuppressesConsole = typeof isBottomControlsSuppressedForShelf === 'function'
      && isBottomControlsSuppressedForShelf();
  } catch (_) { }
  if (shelfSuppressesConsole) return true;

  if (body.classList.contains('home-controls-locked')) {
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
    else body.classList.remove('home-controls-locked');
  }
  if (typeof controlsHideTimer !== 'undefined' && controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }
  if (typeof controlsRevealHoldUntil !== 'undefined') {
    controlsRevealHoldUntil = Math.max(controlsRevealHoldUntil || 0, performance.now() + 900);
  }
  var bar = document.getElementById('bottom-bar');
  if (bar) {
    bar.classList.add('visible');
    bar.classList.remove('soft-hidden');
    bar.style.pointerEvents = '';
  }
  if (typeof setControlsHidden === 'function') setControlsHidden(false);
  if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
  return !!bar;
}

function revealDesktopWallpaperUiOnActivation(enabled, interactive) {
  var nextActive = enabled === true && interactive === true;
  var wasActive = desktopWallpaperUiActivationState === true;
  desktopWallpaperUiActivationState = nextActive;
  if (!nextActive) {
    if (desktopWallpaperHudPrimeTimer) {
      clearTimeout(desktopWallpaperHudPrimeTimer);
      desktopWallpaperHudPrimeTimer = 0;
    }
    if (document.body) document.body.classList.remove('desktop-wallpaper-hud-prime');
    if (typeof controlsRevealHoldUntil !== 'undefined') controlsRevealHoldUntil = 0;
    setDesktopModeControlsOpen(false);
    setDesktopModeControlPeek(false);
    return false;
  }
  // Status can arrive after the native HWND was hidden/reparented or after a
  // throttled first paint. Reassert the actual functional surface on every
  // active status, not only on the first false -> true edge.
  ensureDesktopWallpaperFunctionalUi('runtime-status');
  /* 只留舞台的壁纸模式没有可操作的表面：不再弹控制器、不再 hold 底部控制条、
   * 不再打断沉浸模式。这里把「HUD 预热」相关的残留清干净就返回。 */
  if (typeof wallpaperStageOnly === 'function' && wallpaperStageOnly()) {
    if (desktopWallpaperHudPrimeTimer) {
      clearTimeout(desktopWallpaperHudPrimeTimer);
      desktopWallpaperHudPrimeTimer = 0;
    }
    if (document.body) document.body.classList.remove('desktop-wallpaper-hud-prime');
    if (typeof controlsRevealHoldUntil !== 'undefined') controlsRevealHoldUntil = 0;
    setDesktopModeControlsOpen(false);
    setDesktopModeControlPeek(false);
    return false;
  }
  if (wasActive) return false;

  setDesktopModeControlPeek(true);
  scheduleDesktopModeControlPeekHide(1800);

  var body = document.body;
  if (body) body.classList.add('desktop-wallpaper-hud-prime');

  // Full desktop mode is the complete Mineradio workspace. Do not inherit the
  // ordinary stage's immersive chrome suppression, which otherwise leaves only
  // the desktop-mode hotspot visible after the native attach finishes.
  if (typeof immersiveMode !== 'undefined' && immersiveMode
    && typeof setImmersiveMode === 'function') {
    setImmersiveMode(false);
  }

  var homeActive = !!(body && body.classList.contains('empty-home-active'));
  if (homeActive) {
    if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
  } else {
    // A Home transition can leave this lock behind while Home itself is no
    // longer visible. Clear only that stale combination; a real Home page keeps
    // its existing player-console policy.
    if (body && body.classList.contains('home-controls-locked')) {
      if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
      else body.classList.remove('home-controls-locked');
    }
    if (typeof controlsHideTimer !== 'undefined' && controlsHideTimer) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
    if (typeof holdBottomControlsVisible === 'function') {
      holdBottomControlsVisible(4200);
    } else if (typeof revealBottomControls === 'function') {
      revealBottomControls(4200);
    } else {
      var bar = document.getElementById('bottom-bar');
      if (bar) {
        bar.classList.add('visible');
        bar.classList.remove('soft-hidden');
      }
      if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
    }
  }

  // The HWND is briefly hidden/reparented below Explorer while this status is
  // applied. Commit the target HUD frame without relying on an opacity
  // transition that Chromium may leave at its transparent first sample.
  var activeSurface = document.getElementById(homeActive ? 'empty-home' : 'bottom-bar');
  if (activeSurface) {
    void activeSurface.offsetWidth;
    try { window.getComputedStyle(activeSurface).opacity; } catch (_) { }
  }
  if (desktopWallpaperHudPrimeTimer) clearTimeout(desktopWallpaperHudPrimeTimer);
  desktopWallpaperHudPrimeTimer = setTimeout(function () {
    desktopWallpaperHudPrimeTimer = 0;
    if (document.body) document.body.classList.remove('desktop-wallpaper-hud-prime');
  }, 900);
  return true;
}

function applyDesktopWallpaperRuntimeStatus(payload) {
  var status = desktopWallpaperStatusPayload(payload);
  var generation = Number(status.generation);
  if (isFinite(generation) && generation < desktopWallpaperStatusGeneration) return desktopWallpaperRuntimeState;
  if (isFinite(generation)) desktopWallpaperStatusGeneration = generation;
  desktopWallpaperRuntimeState = Object.assign({}, desktopWallpaperRuntimeState, status);
  var nextEnabled = status.enabled === true || status.active === true
    ? true
    : (status.attaching === true ? !!fx.wallpaperMode : false);
  if (fx.wallpaperMode !== nextEnabled) {
    fx.wallpaperMode = nextEnabled;
    updateFxInputs();
  }
  /* 从主进程那侧来的状态（托盘退出 / 效果层渲染崩溃 / 重开）也要把只控不渲染态同步掉：
   * 上面那条只在值变化时走，值没变时（例如重建窗口）这里兜底。 */
  if (typeof syncWallpaperHostCastPresentation === 'function') {
    try { syncWallpaperHostCastPresentation(); } catch (_) {}
  }
  /* 回落必须可见：原生脚本没把效果层压到最底时，它是「浮在所有窗口之上但鼠标穿透」，
   * 画面会盖住整个屏幕。状态里 zOrder='none' 只在真实失败后写入，这里提示一次。 */
  if (nextEnabled && status.zOrder === 'none' && !desktopWallpaperZOrderWarned) {
    desktopWallpaperZOrderWarned = true;
    if (typeof showToast === 'function') showToast('桌面效果层未能置于最底层，可能盖住其他窗口');
  }
  if (!nextEnabled) desktopWallpaperZOrderWarned = false;
  /* 主窗口从不进入舞台态，这段只剩「把旧版本可能留在 DOM 上的痕迹清掉」。
   * 从主进程那侧退出的（托盘 / 效果层渲染崩溃）也会走到这里。 */
  if (!nextEnabled && typeof syncWallpaperStagePresentation === 'function') {
    try { syncWallpaperStagePresentation(); } catch (_) {}
  }
  if (desktopWindowState && typeof desktopWindowState === 'object') {
    desktopWindowState.isDesktopEmbedded = nextEnabled;
    desktopWindowState.isDesktopInteractive = nextEnabled && status.interactive === true;
  }
  syncDesktopWallpaperBodyClasses(desktopWallpaperRuntimeState, nextEnabled, status.interactive === true);
  applyDesktopWallpaperSafeArea(desktopWallpaperRuntimeState, nextEnabled);
  revealDesktopWallpaperUiOnActivation(nextEnabled, status.interactive === true);
  if (!nextEnabled) {
    desktopIconVisibilityPending = false;
    desktopSoftwareLockPending = false;
  }
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  applyDesktopIconRevealMask();
  updateDesktopWallpaperRuntimeControls(desktopWallpaperRuntimeState);
  scheduleDesktopIconShieldReport(!(nextEnabled && status.interactive === true));
  scheduleDesktopPointerRouteReport(null, true);
  return desktopWallpaperRuntimeState;
}
function desktopWallpaperErrorLabel(error) {
  var code = String(error || 'WALLPAPER_FAILED');
  if (code.indexOf('WALLPAPER_PLATFORM_UNSUPPORTED') >= 0) return '当前系统不支持';
  if (code.indexOf('WALLPAPER_WORKERW_NOT_FOUND') >= 0) return '未找到桌面 WorkerW';
  if (code.indexOf('WALLPAPER_PROGMAN_NOT_FOUND') >= 0) return '未找到 Windows 桌面宿主';
  if (code.indexOf('WALLPAPER_NATIVE_ATTACH_ABORTED') >= 0 || code.indexOf('WALLPAPER_START_SUPERSEDED') >= 0) return '启动已取消';
  if (code.indexOf('FULL_DESKTOP_RECOVERY_TRAY_UNAVAILABLE') >= 0) return '无法创建桌面模式恢复入口';
  if (code.indexOf('FULL_DESKTOP_WALLPAPER_ENGINE_SUSPEND_FAILED') >= 0
    || code.indexOf('FULL_DESKTOP_WALLPAPER_ENGINE_HELPER_EXIT_TIMEOUT') >= 0
    || code.indexOf('WALLPAPER_ENGINE_DESKTOP_TRANSITION_BUSY') >= 0
    || code.indexOf('WALLPAPER_DESKTOP_PREVIEW') >= 0
    || code.indexOf('WALLPAPER_ENGINE_SESSION_MISMATCH') >= 0) return 'Wallpaper Engine 项目未能安全切换到桌面预览';
  if (code.indexOf('DESKTOP_MODE_DETACH') >= 0 || code.indexOf('FULL_DESKTOP_DETACH') >= 0) return '主窗口恢复失败';
  return '无法进入完整桌面模式';
}
/* 效果层页面不需要任何「怎么出去」的提示：它没有可交互表面，
 * 退出开关在播放器窗口里。这里保留一个空实现，避免旧的启动分支引用出错。 */
function maybeShowWallpaperStageBootToast() {
  return false;
}
function initDesktopWallpaperRuntimeBridge(api) {
  if (!api) return;
  if (typeof api.onWallpaperModeState === 'function' && !desktopWallpaperStatusUnsubscribe) {
    try {
      desktopWallpaperStatusUnsubscribe = api.onWallpaperModeState(applyDesktopWallpaperRuntimeStatus);
    } catch (_) {
      desktopWallpaperStatusUnsubscribe = null;
    }
  }
  /* 壁纸模式切换会销毁重建窗口 → 这一页是被重建出来的，进来时已经不弹「已开启」了
   * （发起切换的那一页已经被销毁，它的 then 永远等不到）。所以提示要在这一页补上。 */
  if (typeof api.onPlaybackSnapshotFlushRequest === 'function' && !desktopPlaybackSnapshotFlushBound) {
    desktopPlaybackSnapshotFlushBound = true;
    try {
      api.onPlaybackSnapshotFlushRequest(function () {
        // 重建前主进程喊一声：立刻把当前进度写进 localStorage，否则接回来会倒退几秒
        if (typeof savePlaybackSession === 'function') savePlaybackSession(true);
      });
    } catch (_) {}
  }
  if (typeof api.getWallpaperModeStatus === 'function') {
    Promise.resolve().then(function () {
      return api.getWallpaperModeStatus();
    }).then(function (result) {
      applyDesktopWallpaperRuntimeStatus(result);
      maybeShowWallpaperStageBootToast(result);
    }).catch(function () { });
  }
  /* 视觉控制台的控件交互会临时恢复 1.2s 预览（见 noteWallpaperHostCastPreview）。
   * 只绑一次；面板是静态 DOM，不存在重建。 */
  bindWallpaperHostCastPanel();
  syncWallpaperHostCastPresentation();
  /* 2026-11-21 用户定案：取消「双击 Esc 退出壁纸模式」。
   * 壁纸模式现在是另一张桌面效果层窗口，主窗口一直可用，退出就是再点一次开关；
   * 这里不再拦截 Esc，Esc 回到它本来的语义（关弹层 / 退出全屏 / 取消输入）。 */
}
function pushDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopLyrics !== 'function') return;
  var now = performance.now();
  if (!force && now - desktopOverlayPushState.lyricsAt < desktopLyricsPushInterval()) return;
  var currentCustomFontId = desktopLyricsCurrentCustomFontId();
  var includeCustomFontData = !!currentCustomFontId && currentCustomFontId !== desktopOverlayPushState.lastLyricsCustomFontId;
  var payload = desktopLyricsPayload(!!force, includeCustomFontData);
  var colors = payload.colors || {};
  var motion = payload.motion || {};
  var payloadCustomFontId = payload.customFont ? payload.customFont.id : '';
  var linesKey = Array.isArray(payload.lines)
    ? payload.lines.map(function (row) { return (row.active ? '*' : '') + row.text; }).join('\u001f')
    : '';
  var key = payload.enabled + '|' + payload.text + '|' + Math.round(payload.progress * 1000) + '|' + Math.round((payload.progressSpan || 0) * 100) + '|' + payload.playing + '|' + payload.size + '|' + payload.opacity + '|' + payload.lineCount + '|' + payload.tilt + '|' + payload.lyricMotion + '|' + payload.align + '|' + linesKey + '|' + payload.clickThrough + '|' + payload.cinema + '|' + payload.highlightFollow + '|' + payload.frameRate + '|' + payload.fontFamily + '|' + payloadCustomFontId + '|' + payload.fontWeight + '|' + payload.letterSpacing + '|' + payload.lineHeight + '|' + payload.lyricScale + '|' + payload.feather + '|' + payload.beatMapKey + '|' + colors.primary + '|' + colors.secondary + '|' + colors.highlight + '|' + colors.glow + '|' + motion.lyricGlow + '|' + motion.lyricGlowBeat + '|' + Math.round((motion.lyricGlowStrength || 0) * 100) + '|' + Math.round((motion.highBloom || 0) * 100) + '|' + Math.round((motion.beatGlow || 0) * 100) + '|' + Math.round((motion.beatPulse || 0) * 100) + '|' + Math.round((motion.bass || 0) * 100);
  if (!force && key === desktopOverlayPushState.lastLyricsKey && now - desktopOverlayPushState.lyricsAt < 900) return;
  desktopOverlayPushState.lyricsAt = now;
  desktopOverlayPushState.lastLyricsKey = key;
  desktopOverlayPushState.lastLyricsCustomFontId = payloadCustomFontId;
  api.updateDesktopLyrics(payload).catch(function (e) { console.warn('desktop lyrics update failed:', e); });
}
function applyDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api) return;
  normalizeDevelopmentLockedFxState();
  var payload = desktopLyricsPayload(true, true);
  var payloadCustomFontId = payload.customFont ? payload.customFont.id : '';
  if (typeof api.setDesktopLyricsEnabled === 'function') {
    desktopOverlayPushState.lastLyricsCustomFontId = payloadCustomFontId;
    api.setDesktopLyricsEnabled(!!payload.enabled, payload).catch(function (e) { console.warn('desktop lyrics state failed:', e); });
  } else {
    desktopOverlayPushState.lastLyricsCustomFontId = '';
  }
  pushDesktopLyricsState(!!force);
}
/* 快捷菜单里的「桌面歌词」重复按钮已移除（2026-11-08）：功能完整保留在
 * 视觉控制台 #t-desktopLyrics 与 Alt+L / Ctrl+Alt+L 热键，二者走 toggleFx('desktopLyrics')
 * 同一条开关逻辑，状态、存档、窗口创建/关闭不受影响。 */
function pushWallpaperState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateWallpaperMode !== 'function') return;
  /* 与桌面歌词同款的按键节流：主循环每 250ms 会不带 force 地调一次，
     内容没变就不发，歌名 / 封面 / 播放状态 / 透明度 / 帧率变了才推。 */
  var payload = wallpaperPayload();
  var now = performance.now();
  var colors = payload.colors || {};
  var key = [payload.enabled, payload.title, payload.artist, payload.cover, payload.playing,
    payload.preset, payload.opacity, payload.frameRate,
    colors.primary, colors.secondary, colors.highlight, colors.glow].join('\u001f');
  if (!force && key === desktopOverlayPushState.lastWallpaperKey && now - desktopOverlayPushState.wallpaperAt < 900) return;
  desktopOverlayPushState.wallpaperAt = now;
  desktopOverlayPushState.lastWallpaperKey = key;
  api.updateWallpaperMode(Object.assign(payload, { reason: 'renderer-status-refresh' })).then(function (result) {
    if (result && result.status) applyDesktopWallpaperRuntimeStatus(result.status);
    if (result && result.ok === false) console.warn('wallpaper update failed:', result.error || 'WALLPAPER_UPDATE_FAILED');
  }).catch(function (e) { console.warn('wallpaper update failed:', e); });
}
function applyWallpaperModeState(force) {
  if (typeof updateWallpaperPanelVisibility === 'function') updateWallpaperPanelVisibility();
  /* toggleFx 已经先把 fx.wallpaperMode 翻过来了；这里第一时间把主窗口的只控不渲染态
   * 跟上（class + 渲染器尺寸），不依赖后面那条异步 setWallpaperMode 的返回。 */
  if (typeof syncWallpaperHostCastPresentation === 'function') {
    try { syncWallpaperHostCastPresentation(); } catch (_) {}
  }
  /* 壁纸模式要开了，而当前 Folia 样式是整屏场景（花火/町景/雾笺/凝彩）：
   * 先切回流光，避免桌面立刻被一整块不透明场景盖住。 */
  if (fx.wallpaperMode === true && typeof foliaWorld !== 'undefined' && foliaWorld
      && typeof FOLIA_WALLPAPER_BLOCKED_MODES !== 'undefined'
      && FOLIA_WALLPAPER_BLOCKED_MODES.indexOf(String(foliaWorld.mode || '')) >= 0) {
    try { foliaWorldSetMode('classic'); } catch (_) {}
    if (typeof showToast === 'function') showToast('壁纸模式下已切回流光');
  }
  /* 壁纸模式要开了，而当前是经典预设（index 11）：经典是一整套 DOM 播放器界面，
   * 桌面效果层同步也会跳过它（STAGE_PRESET_SKIP_INDICES）。先切回默认预设，
   * 再把预设卡置灰；否则桌面会停在「上一个可显示预设」，主窗口还留着经典界面。 */
  if (fx.wallpaperMode === true
      && typeof CLASSIC_PRESET_INDEX !== 'undefined'
      && Number(fx.preset) === CLASSIC_PRESET_INDEX) {
    try { setPreset(0, { silent: true, preserveCamera: true }); } catch (_) {}
    if (typeof showToast === 'function') showToast('壁纸模式下不可用经典预设，已切回默认');
  }
  /* 预设卡要立刻反映「壁纸模式下经典禁用」的新状态。 */
  if (typeof refreshPresetGrid === 'function') {
    try { refreshPresetGrid(); } catch (_) {}
  }
  /* 面板里的样式卡片要立刻反映「壁纸模式下禁用」的新状态。
   * refreshFoliaWorldUi 只在 Folia 激活时重建网格，未激活时直接建一次，否则卡片停在旧状态。 */
  if (typeof foliaWorldBuildModeGrid === 'function') {
    try { foliaWorldBuildModeGrid(); } catch (_) {}
  }
  if (typeof refreshFoliaWorldUi === 'function') {
    try { refreshFoliaWorldUi(); } catch (_) {}
  }
  var api = getDesktopWindowApi();
  if (!api) {
    fx.wallpaperMode = false;
    updateFxInputs();
    return Promise.resolve({ ok: false, enabled: false, error: 'WALLPAPER_DESKTOP_API_UNAVAILABLE' });
  }
  normalizeDevelopmentLockedFxState();
  var payload = wallpaperPayload();
  if (typeof api.setWallpaperMode !== 'function') return Promise.resolve({ ok: false, enabled: false, error: 'WALLPAPER_DESKTOP_API_UNAVAILABLE' });
  var operation = ++desktopWallpaperRendererOperation;
  /* 主窗口不再切「只留舞台」：壁纸模式的画面在另一张透明窗口里，
   * 这里只是通知主进程开/关那张窗口。主窗口从头到尾保持可用。 */
  if (payload.enabled) {
    desktopWallpaperRuntimeState = Object.assign({}, desktopWallpaperRuntimeState, { attaching: true, enabled: true, lastError: '' });
    updateDesktopWallpaperRuntimeControls(desktopWallpaperRuntimeState);
  }
  return Promise.resolve().then(function () {
    return api.setWallpaperMode(!!payload.enabled, payload);
  }).then(function (result) {
    result = result && typeof result === 'object' ? result : { ok: false, enabled: false, error: 'WALLPAPER_RESULT_INVALID' };
    if (operation !== desktopWallpaperRendererOperation) return Object.assign({}, result, { rendererStale: true });
    if (result.status) applyDesktopWallpaperRuntimeStatus(result.status);
    else {
      fx.wallpaperMode = result.ok === true && result.enabled === true;
      updateFxInputs();
    }
    /* 开启后给一句明确的说明。效果层在桌面上、播放器窗口与任务栏都还在，
     * 退出就是再点一次这个开关（托盘菜单里也有同一个入口）。 */
    if (result.ok === true && payload.enabled && typeof showToast === 'function') {
      showToast('壁纸模式已开启 · 再点一次开关即可关闭');
    }
    if (result.ok !== true) {
      var failedStatus = result.status && typeof result.status === 'object' ? result.status : {};
      fx.wallpaperMode = result.enabled === true || failedStatus.enabled === true || failedStatus.active === true;
      updateFxInputs();
      /* 用户点了开关但没挂上桌面（非 Windows / 资源管理器重启中 / 权限失败）：
         开关会自己弹回去，这里必须给一句话，否则用户以为点了没反应。 */
      if (payload.enabled && !fx.wallpaperMode && typeof showToast === 'function') {
        var failReason = String(failedStatus.lastError || result.error || '').trim();
        showToast('壁纸模式启动失败' + (failReason ? '：' + failReason : '，请稍后重试'));
      }
    }
    return result;
  }).catch(function (error) {
    if (operation !== desktopWallpaperRendererOperation) return { ok: false, enabled: false, rendererStale: true, error: String(error && error.message || error) };
    var wasEnabling = payload.enabled === true;
    fx.wallpaperMode = false;
    desktopWallpaperRuntimeState = Object.assign({}, desktopWallpaperRuntimeState, { active: false, enabled: false, attaching: false, lastError: String(error && error.message || error) });
    updateFxInputs();
    updateDesktopWallpaperRuntimeControls(desktopWallpaperRuntimeState);
    if (wasEnabling && typeof showToast === 'function') showToast('壁纸模式启动失败，请稍后重试');
    return { ok: false, enabled: false, error: desktopWallpaperRuntimeState.lastError };
  });
}
function syncDesktopOverlayState() {
  /* 效果层只接收状态，不往主进程推：它的 IPC 来源不是主窗口，推过去也只会被拒；
   * 更糟的是会每 320ms 白跑一轮序列化。 */
  if (typeof isWallpaperStagePage === 'function' && isWallpaperStagePage()) return;
  if (fx.desktopLyrics) pushDesktopLyricsState(false);
  if (fx.wallpaperMode && typeof pushWallpaperState === 'function') pushWallpaperState(false);
  if (typeof isSonicTopographyPresetActive === 'function' && isSonicTopographyPresetActive() && typeof pushSonicTopographyMediaState === 'function') {
    pushSonicTopographyMediaState(false);
  }
}
/* 覆盖层状态守护是应用级常驻巡检（首行已做廉价短路），但要留下可 dispose
 * 的句柄：页面卸载时清掉，避免窗口复用 / 热重载场景下残留多个 320ms 定时器。 */
var desktopOverlayHealthTimer = setInterval(function () {
  if (fx && (fx.desktopLyrics || fx.wallpaperMode || (typeof isSonicTopographyPresetActive === 'function' && isSonicTopographyPresetActive()))) {
    syncDesktopOverlayState();
  }
  if (fx && fx.wallpaperMode && typeof ensureDesktopWallpaperFunctionalUi === 'function') ensureDesktopWallpaperFunctionalUi('health-watch');
}, 320);
window.addEventListener('pagehide', function () {
  if (desktopOverlayHealthTimer) {
    clearInterval(desktopOverlayHealthTimer);
    desktopOverlayHealthTimer = 0;
  }
}, { once: true });

// 全屏
var desktopFullscreenActive = false;
var documentFullscreenActive = false;
var desktopWindowState = {};
var desktopWindowMinimizeTimer = 0;
var desktopWindowRestoreTimer = 0;

function desktopWindowReducedMotion() {
  return prefersReducedMotionNow();
}

function clearDesktopWindowTransitionClasses() {
  document.body.classList.remove('desktop-window-minimizing');
  document.body.classList.remove('desktop-window-restoring');
}

function animateDesktopWindowMinimize(api) {
  if (!api || typeof api.minimize !== 'function') return;
  if (desktopWindowReducedMotion()) {
    api.minimize();
    return;
  }
  clearTimeout(desktopWindowMinimizeTimer);
  clearTimeout(desktopWindowRestoreTimer);
  document.body.classList.remove('desktop-window-restoring');
  document.body.classList.add('desktop-window-minimizing');
  desktopWindowMinimizeTimer = setTimeout(function () {
    document.body.classList.remove('desktop-window-minimizing');
    api.minimize();
  }, 150);
}

function animateDesktopWindowRestore() {
  if (desktopWindowReducedMotion()) {
    clearDesktopWindowTransitionClasses();
    return;
  }
  clearTimeout(desktopWindowMinimizeTimer);
  clearTimeout(desktopWindowRestoreTimer);
  document.body.classList.remove('desktop-window-minimizing');
  document.body.classList.add('desktop-window-restoring');
  desktopWindowRestoreTimer = setTimeout(function () {
    document.body.classList.remove('desktop-window-restoring');
  }, 280);
}

function toggleFullscreen() {
  var api = window.desktopWindow;
  if (api && api.isDesktop && typeof api.toggleFullscreen === 'function') {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { });
      scheduleMainRendererViewportRefresh('document-fullscreen-exit');
      return;
    }
    api.toggleFullscreen();
    scheduleMainRendererViewportRefresh('desktop-fullscreen-toggle');
    return;
  }
  if (api && api.isDesktop && desktopFullscreenActive && !document.fullscreenElement && typeof api.exitFullscreenWindowed === 'function') {
    api.exitFullscreenWindowed();
    scheduleMainRendererViewportRefresh('desktop-fullscreen-exit');
    return;
  }
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function () {
      if (api && api.isDesktop && typeof api.toggleFullscreen === 'function') api.toggleFullscreen();
      else showToast('全屏被浏览器拒绝');
    });
  } else {
    document.exitFullscreen();
    scheduleMainRendererViewportRefresh('document-fullscreen-exit');
  }
}

(function initDesktopWindowShell() {
  var api = window.desktopWindow;
  if (!api || !api.isDesktop) return;

  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
  document.body.classList.remove('desktop-fullscreen');
  desktopFullscreenActive = false;
  syncCursorAutoHideMode();

  var maxBtn = document.querySelector('[data-window-action="maximize"]');
  var maxIcon = maxBtn && maxBtn.querySelector('.icon-maximize');
  var restoreIcon = maxBtn && maxBtn.querySelector('.icon-restore');
  function applyState(state) {
    var wasHidden = !!desktopWindowState.isMinimized || desktopWindowState.isVisible === false;
    desktopWindowState = Object.assign(desktopWindowState, state || {});
    var isHidden = !!desktopWindowState.isMinimized || desktopWindowState.isVisible === false;
    if (wasHidden && !isHidden) animateDesktopWindowRestore();
    var isMaximized = !!desktopWindowState.isMaximized;
    var isFullScreen = !!desktopWindowState.isFullScreen || !!desktopWindowState.isNativeFullScreen || !!desktopWindowState.isHtmlFullScreen || !!desktopWindowState.isWindowFullScreen || !!document.fullscreenElement;
    var wasFullScreen = desktopFullscreenActive;
    desktopFullscreenActive = isFullScreen;
    document.body.classList.toggle('desktop-maximized', isMaximized);
    document.body.classList.toggle('desktop-fullscreen', isFullScreen);
    syncDesktopWallpaperBodyClasses(
      desktopWallpaperRuntimeState,
      desktopWindowState.isDesktopEmbedded === true,
      desktopWindowState.isDesktopInteractive === true
    );
    applyDesktopWallpaperSafeArea(desktopWallpaperRuntimeState, desktopWindowState.isDesktopEmbedded === true);
    scheduleDesktopIconShieldReport(!(desktopWindowState.isDesktopEmbedded === true && desktopWindowState.isDesktopInteractive === true));
    updateDesktopModeControl(desktopWallpaperRuntimeState);
    scheduleDesktopPointerRouteReport(null, true);
    desktopRuntimeState.fullscreen = isFullScreen;
    if (isFullScreen) layoutFullscreenDiyZone();
    if (isFullScreen !== wasFullScreen) {
      scheduleMainRendererViewportRefresh('desktop-shell-state');
      if (!isFullScreen) {
        document.body.classList.remove('fullscreen-diy-peek');
        setTimeout(function () { clearPlayerControlFocusState('desktop-fullscreen-exit'); }, 80);
      }
    }
    syncCursorAutoHideMode();
    if (maxBtn) {
      maxBtn.title = isFullScreen ? '退出全屏' : '全屏';
      maxBtn.setAttribute('aria-label', maxBtn.title);
    }
    if (maxIcon) maxIcon.style.display = isFullScreen ? 'none' : '';
    if (restoreIcon) restoreIcon.style.display = isFullScreen ? '' : 'none';
  }

  document.querySelectorAll('[data-window-action]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var action = btn.getAttribute('data-window-action');
      if (action === 'minimize') animateDesktopWindowMinimize(api);
      if (action === 'maximize') toggleFullscreen();
      if (action === 'close') {
        if (typeof saveLastPlaybackSnapshot === 'function') saveLastPlaybackSnapshot(true, 'window-close');
        /* 关闭按钮 = 完全退出。closeBehaviorPreference 全项目从未定义过，
           旧写法恒传 undefined；主进程现在也一律忽略 behavior，
           「后台托盘」只由最小化按钮承担，避免关了窗口却留下 7 个进程。 */
        api.close();
      }
    });
  });

  if (typeof api.onDesktopLyricsLockState === 'function') {
    api.onDesktopLyricsLockState(function (payload) {
      var locked = !payload || payload.locked !== false;
      if (fx.desktopLyricsClickThrough === locked) return;
      fx.desktopLyricsClickThrough = locked;
      updateFxInputs();
      saveLyricLayout({ user: true, reason: 'desktopLyricsClickThrough' });
      pushDesktopLyricsState(true);
      showToast(locked ? '桌面歌词已锁定' : '桌面歌词可移动');
    });
  }
  if (typeof api.onDesktopLyricsEnabledState === 'function') {
    api.onDesktopLyricsEnabledState(function (payload) {
      var enabled = !!(payload && payload.enabled);
      if (fx.desktopLyrics === enabled) return;
      fx.desktopLyrics = enabled;
      updateFxInputs();
      saveLyricLayout({ user: true, reason: 'desktopLyrics' });
      showToast(enabled ? '桌面歌词已开启' : '桌面歌词已关闭');
    });
  }

  initDesktopModeControls(api);
  initDesktopIconShieldReporter(api);
  initDesktopWallpaperRuntimeBridge(api);
  api.onStateChange(applyState);
  if (typeof api.getState === 'function') {
    api.getState().then(applyState).catch(function () { applyState({}); });
  } else {
    applyState({});
  }
  document.addEventListener('fullscreenchange', function () {
    var wasDocumentFullscreen = documentFullscreenActive;
    documentFullscreenActive = !!document.fullscreenElement;
    desktopWindowState.isHtmlFullScreen = documentFullscreenActive;
    if (wasDocumentFullscreen && !documentFullscreenActive && typeof api.exitFullscreenWindowed === 'function') {
      api.exitFullscreenWindowed();
    }
    applyState({});
  });
})();

// ============================================================
//  启动
// ============================================================
/* 进程启动之后又同步 / 改过程序文件时，界面里跑的仍是旧代码。
 * 这种状态最容易被误判成「功能失效」（同一个坑已经踩过几轮），
 * 所以启动后主动问一次主进程：磁盘上的文件是不是比本进程还新。 */
function checkAppBuildFreshness(attempt) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.getBuildFreshness !== 'function') return;
  api.getBuildFreshness().then(function (state) {
    if (!state || !state.stale) return;
    console.warn('[Mineradio] 程序文件比当前进程新，需重启才会生效，最新改动文件：', state.newestFile || '');
    if (typeof showToast === 'function') {
      showToast('程序文件已更新，请从托盘完全退出后重新启动');
      return;
    }
    if ((attempt || 0) < 6) {
      setTimeout(function () { checkAppBuildFreshness((attempt || 0) + 1); }, 2500);
    }
  }).catch(function () {});
}
setTimeout(function () { checkAppBuildFreshness(0); }, 5000);
