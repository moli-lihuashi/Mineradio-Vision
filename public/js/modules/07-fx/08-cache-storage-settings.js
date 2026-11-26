/* ===== 桌面集成: 关闭/最小化行为 + 缓存目录 (调用 desktopWindow IPC) ===== */
/* 主进程只把这两个值放在内存里，重启就回到默认；真正的持久化在 localStorage，
 * 启动时由 applyStoredClosePrefs() 推给主进程。 */
var CLOSE_BEHAVIOR_STORE_KEY = 'mineradio:close-behavior:v1';
var CLOSE_ACTION_STORE_KEY = 'mineradio:close-action:v1';
var UI_ZOOM_STORE_KEY = 'mineradio:ui-zoom:v1';
var UI_ZOOM_MIN = 0.9;
var UI_ZOOM_MAX = 1.2;
function readClosePref(key) {
  try { return localStorage.getItem(key) === 'tray' ? 'tray' : 'exit'; } catch (_) { return 'exit'; }
}
var desktopCloseBehavior = readClosePref(CLOSE_BEHAVIOR_STORE_KEY);
var desktopCloseAction = readClosePref(CLOSE_ACTION_STORE_KEY);
function readUiZoomPref() {
  try {
    var v = Number(localStorage.getItem(UI_ZOOM_STORE_KEY));
    if (!isFinite(v) || v <= 0) return 1;
    return Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, Math.round(v * 100) / 100));
  } catch (_) { return 1; }
}
var desktopUiZoom = readUiZoomPref();
function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}
function updateCloseBehaviorControls() {
  document.querySelectorAll('#close-behavior-seg [data-close-behavior]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-close-behavior') === desktopCloseBehavior);
  });
}
function setCloseBehaviorMode(mode) {
  var next = (mode === 'tray') ? 'tray' : 'exit';
  if (!window.desktopWindow || typeof desktopWindow.setCloseBehavior !== 'function') {
    showToast('桌面端功能仅在桌面版可用');
    return;
  }
  desktopWindow.setCloseBehavior(next).then(function(res) {
    desktopCloseBehavior = (res && res.behavior) || next;
    try { localStorage.setItem(CLOSE_BEHAVIOR_STORE_KEY, desktopCloseBehavior); } catch (_) { }
    updateCloseBehaviorControls();
    showToast(desktopCloseBehavior === 'tray' ? '最小化行为: 后台托盘' : '最小化行为: 任务栏');
  }).catch(function() {
    showToast('设置最小化行为失败');
  });
}
function updateCloseActionControls() {
  document.querySelectorAll('#close-action-seg [data-close-action]').forEach(function (btn) {
    var active = btn.getAttribute('data-close-action') === desktopCloseAction;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
function setCloseActionMode(mode) {
  var next = (mode === 'tray') ? 'tray' : 'exit';
  if (!window.desktopWindow || typeof desktopWindow.setCloseAction !== 'function') {
    showToast('桌面端功能仅在桌面版可用');
    return;
  }
  desktopWindow.setCloseAction(next).then(function (res) {
    desktopCloseAction = (res && res.action) || next;
    try { localStorage.setItem(CLOSE_ACTION_STORE_KEY, desktopCloseAction); } catch (_) { }
    updateCloseActionControls();
    showToast(desktopCloseAction === 'tray' ? '关闭按钮: 隐藏到托盘' : '关闭按钮: 完全退出');
  }).catch(function () {
    showToast('设置关闭按钮行为失败');
  });
}
function updateUiZoomControls() {
  document.querySelectorAll('#ui-zoom-seg [data-ui-zoom]').forEach(function (btn) {
    var value = Number(btn.getAttribute('data-ui-zoom'));
    var active = Math.abs(value - desktopUiZoom) < 0.001;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
function setUiZoomMode(value) {
  var next = Number(value);
  if (!isFinite(next)) next = 1;
  next = Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, Math.round(next * 100) / 100));
  if (!window.desktopWindow || typeof desktopWindow.setUiZoom !== 'function') {
    showToast('桌面端功能仅在桌面版可用');
    return;
  }
  desktopWindow.setUiZoom(next).then(function (res) {
    desktopUiZoom = (res && res.factor) || next;
    try { localStorage.setItem(UI_ZOOM_STORE_KEY, String(desktopUiZoom)); } catch (_) { }
    updateUiZoomControls();
    showToast('界面缩放: ' + Math.round(desktopUiZoom * 100) + '%');
  }).catch(function () {
    showToast('设置界面缩放失败');
  });
}
/* 备注：控制台里 Ctrl+滚轮 会临时改掉 webContents 的 zoom，但那里的值不会被我们读取；
 * 重新打开设置页或重启后会回到这里存的值，不会被意外值写坏。 */
function applyStoredUiZoom() {
  updateUiZoomControls();
  if (!window.desktopWindow || typeof desktopWindow.setUiZoom !== 'function') return;
  try {
    Promise.resolve(desktopWindow.setUiZoom(desktopUiZoom)).catch(function () { });
  } catch (_) { }
}

/* 启动时把两个偏好推给主进程（主进程不落盘，不推就会退回默认值） */
function applyStoredClosePrefs() {
  updateCloseBehaviorControls();
  updateCloseActionControls();
  if (!window.desktopWindow) return;
  try {
    if (typeof desktopWindow.setCloseBehavior === 'function') {
      Promise.resolve(desktopWindow.setCloseBehavior(desktopCloseBehavior)).catch(function () { });
    }
    if (typeof desktopWindow.setCloseAction === 'function') {
      Promise.resolve(desktopWindow.setCloseAction(desktopCloseAction)).catch(function () { });
    }
  } catch (_) { }
}
function renderCacheSettings(snapshot) {
  var total = document.getElementById('cache-storage-total');
  var root = document.getElementById('cache-storage-root');
  if (!snapshot || snapshot.ok === false) {
    if (total) total.textContent = '不可用';
    if (root) root.textContent = '桌面版启动后读取';
    return;
  }
  var s = snapshot.settings || {};
  var u = snapshot.usage || {};
  if (total) total.textContent = formatBytes(u.totalManagedBytes || 0);
  if (root) root.textContent = s.rootPath || '未配置';
  function setRow(prefix, sizeBytes, pathStr) {
    var sizeEl = document.getElementById('cache-storage-' + prefix + '-size');
    var pathEl = document.getElementById('cache-storage-' + prefix + '-path');
    if (sizeEl) sizeEl.textContent = formatBytes(sizeBytes || 0);
    if (pathEl) pathEl.textContent = pathStr || '—';
  }
  setRow('lyrics', u.lyricsBytes, s.lyricsPath);
  setRow('chromium', u.chromiumBytes, s.chromiumPath);
  setRow('beatmaps', u.beatmapsBytes, s.beatmapsPath);
  setRow('updates', u.updatesBytes, s.updatesPath);
  setRow('wallpaper', u.wallpaperBytes, s.wallpaperPath);
  var userDataPath = s.rootPath ? s.rootPath.replace(/[\\/]?cache$/, '') : '';
  if (userDataPath) {
    setRow('userdata', 0, userDataPath);
    var userDataSizeEl = document.getElementById('cache-storage-userdata-size');
    if (userDataSizeEl) userDataSizeEl.textContent = '固定';
  }
}
function refreshCacheSettings() {
  if (!window.desktopWindow || typeof desktopWindow.getCacheSettings !== 'function') {
    renderCacheSettings(null);
    return;
  }
  var total = document.getElementById('cache-storage-total');
  if (total) total.textContent = '读取中...';
  desktopWindow.getCacheSettings().then(function(snapshot) {
    renderCacheSettings(snapshot);
  }).catch(function() {
    renderCacheSettings(null);
  });
}
function chooseCacheDirectory() {
  if (!window.desktopWindow || typeof desktopWindow.chooseCacheDirectory !== 'function') {
    showToast('缓存目录选择仅桌面版可用');
    return;
  }
  desktopWindow.chooseCacheDirectory().then(function(res) {
    if (!res || res.ok !== true || !res.path) {
      if (res && res.canceled) return; // 用户取消
      showToast('选择目录失败: ' + (res && res.error || '未知错误'));
      return;
    }
    if (!confirm('将缓存目录更改为:\n' + res.path + '\n\n节奏分析与歌词缓存会自动搬到新目录，' +
      '界面设置（桌面歌词、预设布局、音量等）会在重启后一并带过去；\n' +
      'Chromium 缓存（封面/网络/音频分片）不迁移、仍留在旧目录可手动清理。\n\n确认更改?')) return;
    /* 换缓存根 = 换 Chromium profile = localStorage 全空。这里必须在页面还活着时
     * 把设置全量交给主进程，服务端下次返回 index.html 时注入、页面 head 脚本写回。
     * 快照失败不阻塞改目录：最坏结果只是设置回默认，目录本身仍能正常切换。 */
    var snapshotValues = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key) snapshotValues[key] = localStorage.getItem(key);
      }
    } catch (_) {}
    var saving = (window.desktopWindow && typeof desktopWindow.saveSettingsSnapshot === 'function')
      ? desktopWindow.saveSettingsSnapshot({ values: snapshotValues }).catch(function(){ return { ok: false }; })
      : Promise.resolve({ ok: false });
    return saving.then(function() {
      return desktopWindow.setCacheSettings({ rootPath: res.path });
    });
  }).then(function(snapshot) {
    if (!snapshot) return;
    if (snapshot.ok === false) {
      showToast('设置失败: ' + (snapshot.error || '未知错误'));
      return;
    }
    renderCacheSettings(snapshot);
    var m = snapshot.migration;
    if (m && (m.copied || m.failed)) {
      showToast('缓存目录已更新，迁移节奏/歌词 ' + m.copied + ' 个' +
        (m.skipped ? '（跳过 ' + m.skipped + ' 个）' : '') +
        (m.failed ? '，失败 ' + m.failed + ' 个' : '') +
        (snapshot.settingsSnapshotReady ? '，界面设置已备份' : '') + '，重启后完全生效');
    } else {
      showToast('缓存目录已更新' + (snapshot.settingsSnapshotReady ? '，界面设置已备份' : '') + '，重启后完全生效');
    }
  }).catch(function(err) {
    showToast('缓存设置失败: ' + (err && err.message || '未知错误'));
  });
}
function initDesktopIntegrationControls() {
  /* 以 localStorage 为准推给主进程：主进程本来就不落盘，
   * 以前只看 getCloseBehavior() 等于「每次重启都回到默认值」。 */
  if (window.desktopWindow && typeof desktopWindow.setCloseBehavior === 'function') {
    applyStoredClosePrefs();
    applyStoredUiZoom();
  } else {
    // 非桌面端: 隐藏桌面集成控件
    var seg = document.getElementById('close-behavior-seg');
    if (seg) seg.style.display = 'none';
    var actionSeg = document.getElementById('close-action-seg');
    if (actionSeg) actionSeg.style.display = 'none';
    var zoomSeg = document.getElementById('ui-zoom-seg');
    if (zoomSeg) zoomSeg.style.display = 'none';
    var cacheRow = document.querySelector('.fx-cache-row');
    if (cacheRow) cacheRow.style.display = 'none';
  }
  refreshCacheSettings();
  bindSystemMemoryControls();
  bindSonicAudioMonitorControls();
  bindSonicGroundColorPickers();
  initFxConsoleSearch();
}
/* ===== FX 控制台搜索索引 (轻量版，从 DOM 反向构建注册表) ===== */
var fxConsoleRegistry = [];
var fxConsoleSearchHitTimer = 0;
function fxConsoleNormalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_./]+/g, '');
}
function fxConsoleBuildRegistry() {
  fxConsoleRegistry = [];
  var panel = document.getElementById('fx-panel');
  if (!panel) return;
  var folds = panel.querySelectorAll('.fx-fold');
  folds.forEach(function(fold) {
    var foldTitle = '';
    var head = fold.querySelector('.fx-fold-head');
    if (head) {
      var strong = head.querySelector('strong');
      foldTitle = strong ? strong.textContent.trim() : head.textContent.trim();
    }
    var sections = fold.querySelectorAll('.fx-section-label');
    sections.forEach(function(section) {
      var groupLabel = section.textContent.trim();
      var next = section.nextElementSibling;
      while (next && !next.classList.contains('fx-section-label') && !next.classList.contains('fx-fold')) {
        fxConsoleIndexElement(next, foldTitle, groupLabel, fold);
        next = next.nextElementSibling;
      }
    });
  });
  // 顶层非 fold 内容 (视觉预设、用户存档等)
  var topChildren = panel.children;
  var currentGroup = '';
  for (var i = 0; i < topChildren.length; i++) {
    var el = topChildren[i];
    if (el.classList && el.classList.contains('fx-section-label')) {
      currentGroup = el.textContent.trim();
    } else if (el.classList && el.classList.contains('fx-fold')) {
      continue;
    } else if (el.classList && (el.classList.contains('preset-grid') || el.classList.contains('user-archive-grid') || el.classList.contains('fx-actions') || el.tagName === 'BUTTON')) {
      fxConsoleIndexElement(el, '', currentGroup || '预设', null);
    }
  }
}
function fxConsoleIndexElement(container, foldTitle, groupLabel, fold) {
  if (!container) return;
  var controls = container.querySelectorAll('input[id], .fx-toggle[id], .fx-seg[id], .preset-card, .fx-mini-btn[onclick], .cache-storage-panel[id]');
  controls.forEach(function(el) {
    var id = el.id || '';
    var title = '';
    if (el.classList.contains('fx-toggle')) {
      var span = el.querySelector('span:first-child');
      title = span ? span.textContent.trim() : id;
    } else if (el.classList.contains('fx-slider') || el.matches('input[type="range"]')) {
      var label = container.querySelector && container.querySelector('label');
      title = label ? label.textContent.trim() : id;
    } else if (el.classList.contains('preset-card')) {
      title = '预设: ' + ((el.querySelector('.pc-name') || {}).textContent || '').trim();
    } else {
      title = id || groupLabel;
    }
    if (!title && id) title = id;
    if (!title) return;
    fxConsoleRegistry.push({
      id: id,
      title: title,
      aliases: groupLabel + ' ' + foldTitle,
      groupLabel: groupLabel,
      foldLabel: foldTitle,
      element: el,
      fold: fold
    });
  });
  // 整个容器也作为可搜索项 (如 cache-storage-panel, foreground-fps-seg)
  if (container.id && container.id !== 'fx-console-search-results') {
    var existing = fxConsoleRegistry.some(function(e) { return e.element === container; });
    if (!existing) {
      fxConsoleRegistry.push({
        id: container.id,
        title: groupLabel || container.id,
        aliases: foldTitle,
        groupLabel: groupLabel,
        foldLabel: foldTitle,
        element: container,
        fold: fold
      });
    }
  }
}
function fxConsoleCurrentValue(entry) {
  if (!entry || !entry.element) return '';
  var el = entry.element;
  var range = el.matches('input[type="range"]') ? el : el.querySelector('input[type="range"]');
  if (range) {
    var output = range.parentElement && range.parentElement.querySelector('output');
    return output && output.textContent ? output.textContent : range.value;
  }
  if (el.classList.contains('fx-toggle')) return el.classList.contains('on') ? '开启' : '关闭';
  var active = el.querySelector('.active');
  if (active && active.textContent) return active.textContent.trim();
  return '';
}
function fxConsoleFocusEntry(entry) {
  if (!entry || !entry.element) return;
  if (entry.fold) entry.fold.classList.add('open');
  fxConsoleClosePopover();
  requestAnimationFrame(function() {
    entry.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.querySelectorAll('#fx-panel .fx-search-hit').forEach(function(n) { n.classList.remove('fx-search-hit'); });
    if (fxConsoleSearchHitTimer) clearTimeout(fxConsoleSearchHitTimer);
    fxConsoleSearchHitTimer = setTimeout(function() {
      if (!entry.element || !entry.element.isConnected) return;
      entry.element.classList.remove('fx-search-hit');
      void entry.element.offsetWidth;
      entry.element.classList.add('fx-search-hit');
      setTimeout(function() {
        if (entry.element) entry.element.classList.remove('fx-search-hit');
      }, 1650);
    }, 220);
  });
}
function fxConsoleClosePopover() {
  var results = document.getElementById('fx-console-search-results');
  if (results) results.hidden = true;
}
function renderFxConsoleSearchResults(query) {
  var results = document.getElementById('fx-console-search-results');
  if (!results) return;
  var needle = fxConsoleNormalizeSearch(query);
  results.innerHTML = '';
  if (!needle) { results.hidden = true; return; }
  var matches = fxConsoleRegistry.filter(function(entry) {
    var text = [entry.title, entry.aliases, entry.groupLabel, entry.foldLabel, entry.element && entry.element.textContent].join(' ');
    return fxConsoleNormalizeSearch(text).indexOf(needle) >= 0;
  }).slice(0, 18);
  if (!matches.length) {
    var empty = document.createElement('div');
    empty.className = 'fx-console-empty';
    empty.textContent = '没有找到"' + String(query || '').trim().slice(0, 30) + '"';
    results.appendChild(empty);
  } else {
    matches.forEach(function(entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fx-console-search-result';
      var main = document.createElement('span');
      main.className = 'fx-console-result-main';
      var title = document.createElement('strong');
      title.textContent = entry.title;
      var crumb = document.createElement('small');
      crumb.textContent = [entry.foldLabel, entry.groupLabel].filter(Boolean).join(' › ');
      main.appendChild(title);
      if (crumb.textContent) main.appendChild(crumb);
      var value = document.createElement('b');
      value.textContent = fxConsoleCurrentValue(entry);
      btn.appendChild(main);
      if (value.textContent) btn.appendChild(value);
      btn.addEventListener('click', function() { fxConsoleFocusEntry(entry); });
      results.appendChild(btn);
    });
  }
  results.hidden = false;
}
function initFxConsoleSearch() {
  var input = document.getElementById('fx-console-search');
  if (!input || input._fxConsoleSearchBound) return;
  input._fxConsoleSearchBound = true;
  fxConsoleBuildRegistry();
  input.addEventListener('input', function() {
    renderFxConsoleSearchResults(this.value);
  });
  input.addEventListener('focus', function() {
    if (this.value) renderFxConsoleSearchResults(this.value);
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { this.value = ''; fxConsoleClosePopover(); this.blur(); }
    if (e.key === 'Enter') {
      var first = document.querySelector('#fx-console-search-results .fx-console-search-result');
      if (first) first.click();
    }
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.fx-console-search-row')) fxConsoleClosePopover();
  });
}
