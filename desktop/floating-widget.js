'use strict';
/**
 * 悬浮小组件（Enhanced Remote Widget）主进程宿主。
 *
 * 来源：D:\Mineradio\enhanced-remote-widget-1.15.5.zip（MIT）。
 * 原版是「官方 Folia 桌面版」的模组：index.cjs 由 Folia 的主进程模组沙箱调用，
 * 通过 api.rpc / api.runtime 与页面侧 client.mjs 通信。
 *
 * 本项目没有主进程模组沙箱（public/js/modules/12-folia/17-folia-mod-host.js 是纯渲染进程宿主，
 * 且 stageLayers 等接口仍是 v1 未实现），所以这里用我们自己的基础设施重建同一套三层结构：
 *
 *   页面桥接模块 (public/js/modules/10-shell/30-floating-widget-bridge.js)
 *        │  ipcRenderer.invoke('mineradio-floating-widget-sync')      ← 状态上行
 *        │  ipcRenderer.on('mineradio-floating-widget-action')        ← 操作下行
 *        ▼
 *   本模块（主进程）
 *        │  webContents.send('widget-update' / 'widget-visibility' …)
 *        ▼
 *   小组件窗口（desktop/floating-widget/widget.html，前端零改动）
 *
 * widget 前端的唯一宿主契约是 window.foliaWidget.send/on 两个方法，
 * 由原版 widget-preload.cjs 提供，这里原样复用。
 *
 * 与 index.cjs 的差异（有意为之）：
 *  - 存储改用稳定 userData 下的 JSON 文件，不用 api.storage（本项目 setPath('cache') 会篡改 userData）；
 *  - 操作下发用事件推送，不实现 RPC 长轮询（单窗口场景没有多消费者需求）；
 *  - 增加 CSP 需要的本地封面协议。
 */

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const createWindowLayouts = require('./floating-widget/window-layouts.cjs');
const createWidgetVisibility = require('./floating-widget/widget-visibility.cjs');

const WIDGET_DIR = path.join(__dirname, 'floating-widget');
const WIDGET_HTML = path.join(WIDGET_DIR, 'widget.html');
const STORE_FILE = 'floating-widget-store.json';

const TRANSIENT_INTERACTIONS = ['pointer', 'menu', 'editor'];
const WIDGET_ACTIONS = ['play', 'pause', 'toggle', 'next', 'previous', 'seek', 'volumeDelta', 'toggleLike', 'shuffle'];

// ---------------------------------------------------------------------------
// 存储：稳定 userData 下的单文件 JSON（布局 + 偏好）
// ---------------------------------------------------------------------------

let storeCache = null;
let storeWriting = false;
let storePathResolved = '';
let stableUserDataDir = '';

function resolveStorePath() {
  if (storePathResolved) return storePathResolved;
  /* main.js 在 setPath('cache') 之后会把 userData 篡改成 <cacheRoot>/<APP>，
   * 布局文件必须落在真实 AppData（由 main.js 传入 setPath 之前捕获的路径），
   * 否则改缓存目录后小组件位置会重置。 */
  const stable = stableUserDataDir || app.getPath('userData');
  storePathResolved = path.join(stable, STORE_FILE);
  return storePathResolved;
}

function readStore() {
  if (storeCache) return storeCache;
  storeCache = {};
  try {
    const raw = fs.readFileSync(resolveStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') storeCache = parsed;
  } catch (_) { /* 首次运行或文件损坏：空存档 */ }
  return storeCache;
}

function persistStore() {
  if (storeWriting) return;
  storeWriting = true;
  setImmediate(() => {
    storeWriting = false;
    try {
      const file = resolveStorePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(readStore()), 'utf8');
    } catch (err) {
      console.warn('[floating-widget] 保存布局失败:', err && err.message);
    }
  });
}

/** window-layouts.cjs 需要的 api 面：storage.get/set + log.warn。 */
const layoutApi = {
  storage: {
    get(key) {
      const store = readStore();
      return Promise.resolve(store[key] == null ? null : store[key]);
    },
    set(key, value) {
      const store = readStore();
      store[key] = value;
      persistStore();
      return Promise.resolve(true);
    },
  },
  log: {
    warn: (...args) => console.warn('[floating-widget]', ...args),
    error: (...args) => console.error('[floating-widget]', ...args),
  },
};

// ---------------------------------------------------------------------------
// 运行时状态
// ---------------------------------------------------------------------------

let widgetWindow = null;
let settingsWindow = null;
let disposed = false;
let creationPromise = null;
let shouldShowWidget = false;
let isAlwaysOnTop = true;
let pendingLayoutAnchor = null;
let latestState = {};
let visibility = null;
let windowLayouts = null;
let boundsAnimTimer = null;
let mainWindowGetter = () => null;
let trustedCheck = () => false;
/** 最近一次来自小组件窗口的设置快照：主窗（皮肤面板挂件页）与新开的设置窗都要用。 */
let widgetSettingsSnapshot = null;

const transientHolds = { pointer: false, menu: false, editor: false };

function getMainWindow() {
  try {
    const win = mainWindowGetter();
    return win && !win.isDestroyed() ? win : null;
  } catch (_) { return null; }
}
// ---------------------------------------------------------------------------
// 窗口尺寸工具（磁吸 + 平滑动画）
// ---------------------------------------------------------------------------

function snappedPosition(bounds) {
  let { x, y } = bounds;
  try {
    const area = screen.getDisplayMatching(bounds).workArea;
    const threshold = 18;
    if (Math.abs(x - area.x) < threshold) x = area.x;
    else if (Math.abs(x + bounds.width - area.x - area.width) < threshold) x = area.x + area.width - bounds.width;
    if (Math.abs(y - area.y) < threshold) y = area.y;
    else if (Math.abs(y + bounds.height - area.y - area.height) < threshold) y = area.y + area.height - bounds.height;
  } catch (_) {}
  return { x, y };
}

function stopBoundsAnimation() {
  if (boundsAnimTimer) {
    clearInterval(boundsAnimTimer);
    boundsAnimTimer = null;
  }
}

/** 与 index.cjs 同款：240ms cubic-bezier(.2,.8,.2,1) 近似插值。 */
function animateWindowBounds(target, duration, onComplete, shouldSave) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  stopBoundsAnimation();
  if (!duration || duration <= 0) {
    widgetWindow.setBounds(target);
    if (shouldSave !== false) saveBounds(widgetWindow.getBounds());
    if (typeof onComplete === 'function') onComplete();
    return;
  }
  const start = widgetWindow.getBounds();
  const startedAt = Date.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  boundsAnimTimer = setInterval(() => {
    if (!widgetWindow || widgetWindow.isDestroyed()) { stopBoundsAnimation(); return; }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const k = ease(progress);
    const next = {
      x: Math.round(start.x + (target.x - start.x) * k),
      y: Math.round(start.y + (target.y - start.y) * k),
      width: Math.max(1, Math.round(start.width + (target.width - start.width) * k)),
      height: Math.max(1, Math.round(start.height + (target.height - start.height) * k)),
    };
    try { widgetWindow.setBounds(next); } catch (_) { stopBoundsAnimation(); return; }
    if (progress >= 1) {
      stopBoundsAnimation();
      if (shouldSave !== false) saveBounds(widgetWindow.getBounds());
      if (typeof onComplete === 'function') onComplete();
    }
  }, 16);
}

function saveBounds(bounds, profileMode) {
  try { windowLayouts.remember(bounds, profileMode || 'full'); } catch (_) {}
}

function notifyWindowState() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  try {
    widgetWindow.webContents.send('widget-window-state', windowLayouts.snapshot(widgetWindow.getBounds()));
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// 可见性（播放态自动隐藏 / 切歌播报 / 手动开关）
// ---------------------------------------------------------------------------

function initVisibility() {
  if (visibility) return visibility;
  visibility = createWidgetVisibility({
    presentAnnouncement(active) {
      if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('widget-announcement', active);
    },
    present(phase) {
      if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('widget-visibility', phase);
    },
    show() {
      if (disposed || !widgetWindow || widgetWindow.isDestroyed()) return;
      try {
        widgetWindow.webContents.send('widget-announcement', visibility.isAnnouncing());
        widgetWindow.webContents.send('widget-update', latestState);
      } catch (_) {}
      widgetWindow.showInactive();
    },
    hide() {
      if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide();
    },
  });
  return visibility;
}

// ---------------------------------------------------------------------------
// 桌面背景捕获（供液态玻璃折射真实桌面）
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function windowPreferences() {
  return {
    preload: path.join(WIDGET_DIR, 'widget-preload.cjs'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: true,
  };
}

/** 只允许重载自身文档，禁止导航到别处或开新窗。 */
function restrictWindowNavigation(win, settingsPage) {
  const entry = pathToFileURL(WIDGET_HTML);
  if (settingsPage) entry.searchParams.set('settings', '1');
  win.webContents.on('will-navigate', (event, url) => {
    if ((event && event.url ? event.url : url) !== entry.href && url !== entry.href) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    /* 封面/来源链接可能在小组件里被点开：交给系统浏览器，不在应用内开窗。 */
    if (/^https?:/i.test(url || '')) { try { shell.openExternal(url); } catch (_) {} }
    return { action: 'deny' };
  });
}

function releaseTransientHolds() {
  if (!visibility) return;
  visibility.releaseHolds(TRANSIENT_INTERACTIONS);
}

function createWidgetWindow() {
  return creationPromise || (creationPromise = (async () => {
    const bounds = await windowLayouts.load();
    if (disposed) return null;
    const [minimumWidth, minimumHeight] = windowLayouts.minimumSize();

    widgetWindow = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      /* 透明窗口（已验证可见、不再发黑）。
       * 关于「真玻璃」：Windows 11 的 backgroundMaterial 亚克力对**不抢焦点的窗口无效**
       * —— 我们这个窗是 showInactive()，永远 inactive，DWM 直接退化成纯色板
       * （实测窗口变成白灰板）。所以玻璃质感只能由页面 CSS 表达：
       * 半透明白 + 顶部高光 + 极淡边缘 + 落影，见 widget.css 的 mode-liquid。 */
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      title: 'Mineradio 悬浮小组件',
      alwaysOnTop: isAlwaysOnTop,
      resizable: true,
      minWidth: minimumWidth,
      minHeight: minimumHeight,
      maxWidth: 800,
      maxHeight: 600,
      minimizable: false,
      maximizable: false,
      /* 这里**不该**跟桌面歌词/壁纸层一样用 type:'toolbar'：toolbar 会带
       * WS_EX_NOACTIVATE（实测 ex=0x08200080），窗口拿不到焦点 →
       * 小组件的 S/L/T 快捷键与 Circuit 排版编辑全部失效。
       * 小组件是用户主动打开、要交互的工具窗，出现在任务栏是预期行为；
       * 用户抱怨过的「两个任务窗口」指的是隐藏覆盖层被动出现，不是这一类。 */
      skipTaskbar: false,
      webPreferences: windowPreferences(),
    });

    restrictWindowNavigation(widgetWindow, false);
    widgetWindow.setAlwaysOnTop(isAlwaysOnTop, 'floating');
    /* 绝对不要再调 setContentProtection：它会让透明窗口在 Windows 上整体发黑
     * （用户实测「所有主题都是黑的」）。之前为了桌面抓屏不拍到自己加过，
     * 抓屏链路已整体移除，这里也不需要任何内容保护。 */

    /* Windows：-webkit-app-region: drag 会让区域变成 HTCAPTION，DOM 收不到原生 contextmenu。
     * 必须 hook Win32 消息把右键坐标补回页面（原版 index.cjs 同款做法）。 */
    if (process.platform === 'win32' && typeof widgetWindow.hookWindowMessage === 'function') {
      const forwardRightClick = () => {
        if (disposed || !widgetWindow || widgetWindow.isDestroyed()) return;
        try {
          const cursor = screen.getCursorScreenPoint();
          const b = widgetWindow.getBounds();
          widgetWindow.webContents.send('show-context-menu', {
            x: Math.round(cursor.x - b.x), y: Math.round(cursor.y - b.y),
          });
        } catch (_) {}
      };
      widgetWindow.hookWindowMessage(0x00A5, forwardRightClick); // WM_NCRBUTTONUP
      widgetWindow.hookWindowMessage(0x007B, forwardRightClick); // WM_CONTEXTMENU
    }
    widgetWindow.webContents.on('context-menu', (event, params) => {
      if (disposed || !widgetWindow || widgetWindow.isDestroyed()) return;
      widgetWindow.webContents.send('show-context-menu', { x: params.x, y: params.y });
    });

    const created = widgetWindow;
    created.loadFile(WIDGET_HTML).catch((err) => {
      if (!disposed) console.error('[floating-widget] 加载小组件界面失败:', err && err.message);
    });

    created.once('ready-to-show', () => {
      if (disposed || created.isDestroyed() || !shouldShowWidget) return;
      try {
        created.webContents.send('widget-announcement', visibility.isAnnouncing());
        created.webContents.send('widget-update', latestState);
        created.webContents.send('widget-window-state', windowLayouts.snapshot(created.getBounds()));
      } catch (_) {}
      created.showInactive();
      notifyRendererVisibility(true);
    });

    created.webContents.on('did-start-navigation', (details, _url, inPlace, mainFrame) => {
      const isMainFrame = details && details.isMainFrame != null ? details.isMainFrame : mainFrame;
      const isSameDocument = details && details.isSameDocument != null ? details.isSameDocument : inPlace;
      if (isMainFrame && !isSameDocument) releaseTransientHolds();
    });
    created.webContents.on('render-process-gone', releaseTransientHolds);
    created.webContents.on('did-finish-load', () => {
      if (disposed || created.isDestroyed()) return;
      try { created.webContents.send('widget-window-state', windowLayouts.snapshot(created.getBounds())); } catch (_) {}
    });

    created.on('closed', () => {
      releaseTransientHolds();
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
      if (widgetWindow === created) widgetWindow = null;
      notifyRendererVisibility(false);
    });

    return created;
  })().finally(() => { creationPromise = null; }));
}

function createOrShowSettingsWindow() {
  if (disposed || !widgetWindow || widgetWindow.isDestroyed()) return;
  if (visibility) visibility.hold('settings', true);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!settingsWindow.webContents.isLoading()) settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 480,
    title: '悬浮小组件偏好设置',
    parent: widgetWindow,
    modal: false,
    show: false,
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    webPreferences: windowPreferences(),
  });
  restrictWindowNavigation(settingsWindow, true);
  const created = settingsWindow;
  created.loadFile(WIDGET_HTML, { query: { settings: '1' } }).catch((err) => {
    if (!disposed) console.error('[floating-widget] 加载设置窗口失败:', err && err.message);
  });
  created.once('ready-to-show', () => { if (!created.isDestroyed()) created.show(); });
  created.on('closed', () => {
    if (settingsWindow === created) settingsWindow = null;
    if (visibility) visibility.hold('settings', false);
  });
}

// ---------------------------------------------------------------------------
// 页面 ↔ 主进程
// ---------------------------------------------------------------------------

function notifyRendererVisibility(visible) {
  const win = getMainWindow();
  if (!win) return;
  try { win.webContents.send('mineradio-floating-widget-visibility', { visible: !!visible }); } catch (_) {}
}

/** 把小组件操作转给页面执行（页面持有播放器实例）。 */
function dispatchActionToRenderer(action) {
  const win = getMainWindow();
  if (!win) return;
  try { win.webContents.send('mineradio-floating-widget-action', action); } catch (_) {}
}

function isWidgetSender(event) {
  return !disposed && widgetWindow && !widgetWindow.isDestroyed()
    && event && event.sender === widgetWindow.webContents;
}
function isSettingsSender(event) {
  return !disposed && settingsWindow && !settingsWindow.isDestroyed()
    && event && event.sender === settingsWindow.webContents;
}

// ---------------------------------------------------------------------------
// widget 窗口的 IPC（通道名与 widget-preload.cjs 完全一致）
// ---------------------------------------------------------------------------

const onWidgetAction = (event, payload) => {
  if (!isWidgetSender(event) || !payload || !WIDGET_ACTIONS.includes(payload.action)) return;
  if (payload.action === 'seek' && !Number.isFinite(payload.value)) return;
  let action = payload;
  if (action.action === 'volumeDelta') {
    if (!Number.isFinite(action.value) || action.value === 0) return;
    action = { action: 'volumeDelta', value: Math.max(-0.1, Math.min(0.1, action.value)) };
  }
  dispatchActionToRenderer(action);
};

const onWidgetWindowCmd = (event, payload) => {
  if (!isWidgetSender(event) || !payload || typeof payload !== 'object') return;
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const { cmd, value } = payload;

  if (cmd === 'renderer-ready') {
    releaseTransientHolds();
  } else if (cmd === 'close') {
    shouldShowWidget = false;
    if (visibility) visibility.manual(false);
  } else if (cmd === 'open-settings') {
    createOrShowSettingsWindow();
  } else if (cmd === 'auto-hide') {
    if (visibility) visibility.setEnabled(value);
  } else if (cmd === 'song-announcement') {
    if (visibility) visibility.setAnnouncementEnabled(value);
  } else if (cmd === 'interaction') {
    if (value && TRANSIENT_INTERACTIONS.includes(value.kind) && typeof value.active === 'boolean') {
      if (visibility) visibility.hold(value.kind, value.active);
    }
  } else if (cmd === 'pin') {
    isAlwaysOnTop = Boolean(value);
    try { widgetWindow.setAlwaysOnTop(isAlwaysOnTop, 'floating'); } catch (_) {}
    const store = readStore();
    store.widget_pin = isAlwaysOnTop;
    persistStore();
  } else if (cmd === 'layout') {
    if (!value || typeof value !== 'object') return;
    const anchorSource = pendingLayoutAnchor || widgetWindow.getBounds();
    const bounds = windowLayouts.switchLayout(value.layout, anchorSource, value.initialize === true);
    if (!bounds) return;
    if (value.initialize === true) {
      pendingLayoutAnchor = null;
      try {
        widgetWindow.setMinimumSize(...windowLayouts.minimumSize());
        widgetWindow.setBounds(bounds);
      } catch (_) {}
      saveBounds(widgetWindow.getBounds());
      notifyWindowState();
    } else {
      pendingLayoutAnchor = anchorSource;
      animateWindowBounds(bounds, value.animate === false ? 0 : 240, () => { pendingLayoutAnchor = null; });
    }
  } else if (cmd === 'resize') {
    pendingLayoutAnchor = null;
    if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)) return;
    const [minW, minH] = windowLayouts.minimumSize();
    const w = Math.max(minW, Math.min(800, Math.round(value.width)));
    const h = Math.max(minH, Math.min(600, Math.round(value.height)));
    const [curW, curH] = widgetWindow.getSize();
    if (curW === w && curH === h) return;
    const shouldSave = value.save !== false;
    if (value.animate) {
      const cur = widgetWindow.getBounds();
      animateWindowBounds(windowLayouts.clampBounds({ ...cur, width: w, height: h }), 240, undefined, shouldSave);
    } else {
      stopBoundsAnimation();
      widgetWindow.setSize(w, h, false);
      const cur = widgetWindow.getBounds();
      if (shouldSave) saveBounds(cur, 'full');
      try { widgetWindow.webContents.send('widget-resized', cur); } catch (_) {}
      notifyWindowState();
    }
  } else if (cmd === 'move') {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    pendingLayoutAnchor = null;
    stopBoundsAnimation();
    const current = widgetWindow.getBounds();
    const shouldSave = value.save !== false;
    let position = { x: Math.round(value.x), y: Math.round(value.y) };
    if (shouldSave) position = snappedPosition({ ...current, ...position });
    widgetWindow.setPosition(position.x, position.y, false);
    if (shouldSave) saveBounds(widgetWindow.getBounds(), 'position');
    notifyWindowState();
  } else if (cmd === 'set-bounds') {
    pendingLayoutAnchor = null;
    if (!value || typeof value !== 'object') return;
    const bounds = widgetWindow.getBounds();
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Number.isFinite(value[key])) bounds[key] = Math.round(value[key]);
    }
    const [minW, minH] = windowLayouts.minimumSize();
    bounds.width = Math.max(minW, Math.min(800, bounds.width));
    bounds.height = Math.max(minH, Math.min(600, bounds.height));
    const shouldSave = value.save !== false;
    if (value.animate) {
      animateWindowBounds(windowLayouts.clampBounds(bounds), 240, undefined, shouldSave);
    } else {
      stopBoundsAnimation();
      widgetWindow.setBounds(bounds);
      if (shouldSave) saveBounds(widgetWindow.getBounds());
      notifyWindowState();
    }
  }
};

const onWidgetRequestSnapshot = (event) => {
  if (!isWidgetSender(event)) return;
  try {
    event.reply('widget-announcement', visibility ? visibility.isAnnouncing() : false);
    event.reply('widget-update', latestState);
  } catch (_) {}
};

/* 桌面帧按需返回：push 通道在这个窗口里发不到页面（widget-update 却能到），
 * 改用「页面请求 → event.reply」——这条路径在 window-state/update 上都验证过。 */

const onWidgetRequestWindowState = (event) => {
  if (!isWidgetSender(event) || !widgetWindow || widgetWindow.isDestroyed()) return;
  try { event.reply('widget-window-state', windowLayouts.snapshot(widgetWindow.getBounds())); } catch (_) {}
};

const onSettingsReady = (event) => {
  if (isSettingsSender(event) && widgetWindow && !widgetWindow.isDestroyed()) {
    try { widgetWindow.webContents.send('widget-settings-request-state'); } catch (_) {}
  }
};
const onSettingsState = (event, state) => {
  if (!isWidgetSender(event) || !state || typeof state !== 'object') return;
  /* 2026-11-23：皮肤面板的「挂件」页要直接渲染这些值，所以主窗也收一份。
     原先只推给独立设置窗口，主窗拿不到当前配置就只能干瞪眼。 */
  widgetSettingsSnapshot = state;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try { settingsWindow.webContents.send('widget-settings-state', state); } catch (_) {}
  }
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    try { main.webContents.send('mineradio-floating-widget-settings-state', state); } catch (_) {}
  }
};
const onSettingsAction = (event, payload) => {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  /* sender 白名单：独立设置窗口，或主窗（皮肤面板）。 */
  const fromMain = (() => {
    const main = getMainWindow();
    return !!(main && event && event.sender === main.webContents);
  })();
  if (!isSettingsSender(event) && !fromMain) return;
  try { widgetWindow.webContents.send('widget-settings-action', payload); } catch (_) {}
};
const onSettingsClose = (event) => {
  if (isSettingsSender(event) && settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
};

// ---------------------------------------------------------------------------
// 页面侧 IPC（状态上行 / 开关）
// ---------------------------------------------------------------------------

function registerRendererIpc() {
  ipcMain.handle('mineradio-floating-widget-status', (event) => {
    if (!trustedCheck(event)) return { ok: false };
    return {
      ok: true,
      visible: !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()),
      alwaysOnTop: isAlwaysOnTop,
    };
  });

  ipcMain.handle('mineradio-floating-widget-toggle', async (event, payload) => {
    if (!trustedCheck(event)) return { ok: false };
    const want = payload && typeof payload.visible === 'boolean'
      ? payload.visible
      : !(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
    if (want) {
      shouldShowWidget = true;
      if (visibility) visibility.manual(true);
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        try {
          widgetWindow.webContents.send('widget-update', latestState);
          widgetWindow.showInactive();
        } catch (_) {}
        notifyRendererVisibility(true);
      } else {
        await createWidgetWindow();
      }
      return { ok: true, visible: true };
    }
    shouldShowWidget = false;
    if (visibility) visibility.manual(false);
    return { ok: true, visible: false };
  });

  /* 主窗口直达「偏好设置」：布局 / 主题 / 歌词样式 / 尺寸 / 滚轮行为都在
   * 那个独立窗口里，原本只能从小组件右键菜单进；三条杠改版后用户找不到入口，
   * 这里补一条通道——没开小组件就先把它拉起来，再开设置窗。 */
  ipcMain.handle('mineradio-floating-widget-open-settings', async (event) => {
    if (!trustedCheck(event)) return { ok: false };
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      shouldShowWidget = true;
      if (visibility) visibility.manual(true);
      await createWidgetWindow();
    }
    if (!widgetWindow || widgetWindow.isDestroyed()) return { ok: false };
    createOrShowSettingsWindow();
    return { ok: true, visible: true };
  });

  /* 皮肤面板的「挂件」页用这两条通道，不再弹独立设置窗口：
   *   open-settings-panel → 确保有一个（隐藏的）widget 窗口并取回当前配置快照；
   *   apply-settings      → 把面板里的改动直接转给 widget。
   * 隐藏创建是安全的：createWidgetWindow 的 did-finish-load 只在 shouldShowWidget
   * 为真时才 showInactive，所以用户不会看到一个凭空冒出来的小窗。 */
  ipcMain.handle('mineradio-floating-widget-open-settings-panel', async (event) => {
    if (!trustedCheck(event)) return { ok: false };
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      shouldShowWidget = false;
      if (visibility) visibility.manual(false);
      await createWidgetWindow();
      // widget 初始化时会 publishSettingsSnapshot()，等它到；最多 2s
      for (let i = 0; i < 40 && !widgetSettingsSnapshot; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } else {
      try { widgetWindow.webContents.send('widget-settings-request-state'); } catch (_) {}
    }
    return {
      ok: true,
      snapshot: widgetSettingsSnapshot || null,
      visible: !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()),
    };
  });

  ipcMain.handle('mineradio-floating-widget-apply-settings', (event, payload) => {
    if (!trustedCheck(event)) return { ok: false };
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'bad-payload' };
    if (!widgetWindow || widgetWindow.isDestroyed()) return { ok: false, reason: 'widget-not-ready' };
    try { widgetWindow.webContents.send('widget-settings-action', payload); } catch (_) {}
    return { ok: true };
  });

  /* 状态上行：页面把播放/歌词快照推过来，主进程转发给小组件窗口并缓存
   * （窗口重开时用缓存补首帧，不必等页面下一次推送）。 */
  ipcMain.on('mineradio-floating-widget-sync', (event, state) => {
    if (!trustedCheck(event) || !state || typeof state !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(state, 'songKey') && state.songKey !== latestState.songKey) {
      latestState = { ...latestState, lyrics: null, currentLyric: '', songPersistentKey: '' };
    }
    latestState = { ...latestState, ...state };
    delete latestState.wheelFeedback;
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      try { widgetWindow.webContents.send('widget-update', state); } catch (_) {}
    }
    if (visibility) visibility.updatePlayback(latestState.state, latestState.songKey);
  });

  /* 页面请求把小组件窗口置顶/取消置顶（右键菜单里的“窗口置顶”） */
  ipcMain.handle('mineradio-floating-widget-set-always-on-top', (event, value) => {
    if (!trustedCheck(event)) return { ok: false };
    isAlwaysOnTop = Boolean(value);
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      try { widgetWindow.setAlwaysOnTop(isAlwaysOnTop, 'floating'); } catch (_) {}
    }
    return { ok: true, alwaysOnTop: isAlwaysOnTop };
  });
}

function registerWidgetIpc() {
  ipcMain.on('widget-action', onWidgetAction);
  ipcMain.on('widget-window-cmd', onWidgetWindowCmd);
  ipcMain.on('widget-request-snapshot', onWidgetRequestSnapshot);
  ipcMain.on('widget-request-window-state', onWidgetRequestWindowState);
  ipcMain.on('widget-settings-ready', onSettingsReady);
  ipcMain.on('widget-settings-state', onSettingsState);
  ipcMain.on('widget-settings-action', onSettingsAction);
  ipcMain.on('widget-settings-close', onSettingsClose);
}

function unregisterWidgetIpc() {
  ipcMain.removeListener('widget-action', onWidgetAction);
  ipcMain.removeListener('widget-window-cmd', onWidgetWindowCmd);
  ipcMain.removeListener('widget-request-snapshot', onWidgetRequestSnapshot);
  ipcMain.removeListener('widget-request-window-state', onWidgetRequestWindowState);
  ipcMain.removeListener('widget-settings-ready', onSettingsReady);
  ipcMain.removeListener('widget-settings-state', onSettingsState);
  ipcMain.removeListener('widget-settings-action', onSettingsAction);
  ipcMain.removeListener('widget-settings-close', onSettingsClose);
}

// ---------------------------------------------------------------------------
// 对外生命周期
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {() => BrowserWindow|null} opts.getMainWindow 取主播放器窗口
 * @param {(event) => boolean} opts.isTrustedIpc 主窗口可信 IPC 校验
 * @param {boolean} [opts.autoShow] 初始化后是否立刻显示
 */
function initFloatingWidget(opts = {}) {
  if (windowLayouts) return; // 幂等
  mainWindowGetter = typeof opts.getMainWindow === 'function' ? opts.getMainWindow : () => null;
  trustedCheck = typeof opts.isTrustedIpc === 'function' ? opts.isTrustedIpc : () => false;
  if (typeof opts.stableUserData === 'string' && opts.stableUserData) stableUserDataDir = opts.stableUserData;
  windowLayouts = createWindowLayouts(layoutApi, screen);
  initVisibility();
  registerWidgetIpc();
  registerRendererIpc();
  const store = readStore();
  if (store && store.widget_pin === false) isAlwaysOnTop = false;
  if (opts.autoShow === true) {
    shouldShowWidget = true;
    if (visibility) visibility.manual(true);
    createWidgetWindow().catch((err) => console.warn('[floating-widget] 创建失败:', err && err.message));
  }
}

function toggleFloatingWidget(visible) {
  if (!windowLayouts) return Promise.resolve({ ok: false, visible: false });
  const win = getMainWindow();
  const want = typeof visible === 'boolean'
    ? visible
    : !(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
  if (want) {
    shouldShowWidget = true;
    if (visibility) visibility.manual(true);
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      try { widgetWindow.webContents.send('widget-update', latestState); widgetWindow.showInactive(); } catch (_) {}
      notifyRendererVisibility(true);
      return Promise.resolve({ ok: true, visible: true });
    }
    return createWidgetWindow()
      .then(() => ({ ok: true, visible: true }))
      .catch((err) => ({ ok: false, visible: false, error: err && err.message }));
  }
  shouldShowWidget = false;
  if (visibility) visibility.manual(false);
  return Promise.resolve({ ok: true, visible: false });
}

function isFloatingWidgetVisible() {
  return !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
}

function disposeFloatingWidget() {
  disposed = true;
  stopBoundsAnimation();
  unregisterWidgetIpc();
  try { ipcMain.removeHandler('mineradio-floating-widget-status'); } catch (_) {}
  try { ipcMain.removeHandler('mineradio-floating-widget-toggle'); } catch (_) {}
  try { ipcMain.removeHandler('mineradio-floating-widget-set-always-on-top'); } catch (_) {}
  try { ipcMain.removeAllListeners('mineradio-floating-widget-sync'); } catch (_) {}
  if (settingsWindow && !settingsWindow.isDestroyed()) { try { settingsWindow.close(); } catch (_) {} }
  if (widgetWindow && !widgetWindow.isDestroyed()) { try { widgetWindow.close(); } catch (_) {} }
  settingsWindow = null;
  widgetWindow = null;
  visibility = null;
  windowLayouts = null;
}

module.exports = {
  initFloatingWidget,
  toggleFloatingWidget,
  isFloatingWidgetVisible,
  disposeFloatingWidget,
};
