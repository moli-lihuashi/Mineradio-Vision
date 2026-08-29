const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog, Tray, Menu, protocol, desktopCapturer } = require('electron');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

// Kugou API 集成
const { extractKugouAuth } = require('../kugou-api');

// Spotify 支持
const { getSpotifyOAuthConfig, buildSpotifyOAuthAuthorizeUrl, exchangeSpotifyOAuthCode, clearSpotifyToken, handleSpotifyStatus, handleSpotifySearch, handleSpotifyRecommendations, handleSpotifyUserPlaylists, handleSpotifyPlaylistTracks, handleSpotifySongUrl, handleSpotifyLyric, saveSpotifyConfig } = require('../spotify-api');

// Qishui (汽水) 本机登录态导入
const {
  openQishuiMusicLoginWindow,
  clearQishuiMusicLoginSession,
} = require('./qishui-local-session-import');
const { buildLoginPack, applyLoginPack } = require('./login-session-pack');
const {
  startLoginPackQrSession,
  stopLoginPackQrSession,
  fetchLoginPackEnvelopeFromUrl,
} = require('./login-pack-qr-sync');
const {
  ensureUserPluginDir,
  readLiquidGlassPluginScripts,
} = require('./liquidglass-plugins');
const secretStore = require('./secret-store');

// Wallpaper Engine 集成
const { WallpaperEngineLibrary, registerWallpaperEngineScheme } = require('./wallpaper-engine-library');
const wasapiOutputRuntime = require('./wasapi-output-runtime');
wasapiOutputRuntime.registerIpc(ipcMain);
const { WallpaperEngineRuntime } = require('./wallpaper-engine-runtime');

// Full Desktop Mode
const { FullDesktopModeRuntime } = require('./full-desktop-mode-runtime');

// Login Easter Egg
const { LoginEasterEggGate, LOGIN_EASTER_EGG_GATE_VERSION, LOGIN_EASTER_EGG_STATE_FILE } = require('./login-easter-egg-gate');

// Desktop icon 模块
const { applyDesktopIconShape, clearDesktopIconShape, probeDesktopIcons } = require('./desktop-icon-shape-runtime');
const { startNativeDesktopIconLayer } = require('./desktop-native-icon-layer-runtime');

// Wallpaper mode
const { attachWallpaperWindowToDesktop } = require('./wallpaper-mode-runtime');

// 注册 Wallpaper Engine 自定义协议
registerWallpaperEngineScheme(protocol);

// 内存管理模块（缓解 WebGL context loss）
const appMemory = require('./app-memory');
const systemMemory = require('./system-memory');

let mainWindow = null;
let localServer = null;
let mainServerPort = 0;
let mineradioApiToken = '';
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
let desktopLyricsMousePoller = null;
let desktopLyricsMousePollerBuffer = '';
let desktopLyricsHotBounds = null;
let desktopLyricsLastMiddleAt = 0;
let wallpaperWindow = null;
let wallpaperState = {};
let htmlFullscreenActive = false;
let windowFullscreenActive = false;
let mainWindowStateTimer = null;
const registeredGlobalHotkeys = new Map();

// Wallpaper Engine / Full Desktop Mode 实例
let wallpaperEngineLibrary = null;
let wallpaperEngineRuntime = null;
let fullDesktopModeRuntime = null;
let loginEasterEggGate = null;
let wallpaperEngineCaptureSourceId = '';
let wallpaperEngineCaptureGrant = null;
let wallpaperEngineCaptureOperation = 0;
let fullDesktopEscapeRegistered = false;
let fullDesktopEnableOperation = 0;

const APP_PACKAGE_INFO = (() => { try { return require('../package.json'); } catch (_) { return {}; } })();
const APP_VERSION = APP_PACKAGE_INFO.version || '0.0.0';
// 内测版通道:electron-builder 的 extraMetadata.mineradio 会在打包时合并进 package.json,
// 运行时读取以让内测版在窗口标题/任务栏/快捷方式显示独立名称,与正式版隔离。
const _BETA_META = (APP_PACKAGE_INFO.mineradio) || {};
const APP_NAME = _BETA_META.runtimeName || APP_PACKAGE_INFO.productName || 'Mineradio';
const APP_USER_MODEL_ID = _BETA_META.appUserModelId || 'com.mineradio.desktop';

// 启动状态追踪：闪屏 + GPU 崩溃检测 + loadURL 重试
const STARTUP_ERROR_LOG_FILE = 'startup-error.log';
const STARTUP_STATE_FILE = 'startup-state.json';
const STARTUP_SERVER_TIMEOUT_MS = 10000;
const STARTUP_HTTP_TIMEOUT_MS = 8000;
const STARTUP_NAVIGATION_TIMEOUT_MS = 15000;
const STARTUP_SHOW_WATCHDOG_MS = 3500;

let startupCompleted = false;
let startupErrorReported = false;
let localServerStartPromise = null;
let mainWindowCreatePromise = null;
let startupState = { pid: process.pid, startedAt: Date.now(), phase: 'module-loaded', events: [] };

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 1236;
const MIN_WINDOWED_HEIGHT = 832;
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
let tray = null;
let closeBehavior = 'exit';
let appQuitting = false;
const CACHE_SETTINGS_FILE = 'cache-settings.json';
const LYRIC_CACHE_VERSION = 1;
const LYRIC_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const LYRIC_CACHE_ENTRY_MAX_BYTES = 1024 * 1024;
const CURRENT_FX_AUTOSAVE_FILE = 'current-fx-autosave.json';
const CURRENT_FX_AUTOSAVE_MAX_BYTES = 12 * 1024 * 1024;
let cacheSettings = null;
const NETEASE_LOGIN_PARTITION = 'persist:mineradio-netease-login';
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';
const QQ_LOGIN_PARTITION = 'persist:mineradio-qqmusic-login';
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile';
const KUGOU_LOGIN_PARTITION = 'persist:mineradio-kugou-login';
const KUGOU_LOGIN_URL = 'https://www.kugou.com/';
const SPOTIFY_LOGIN_PARTITION = 'persist:mineradio-spotify-login';
const SPOTIFY_LOGIN_URL = 'https://accounts.spotify.com/authorize';

const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-oop-rasterization'],
  ['enable-zero-copy'],
  ['enable-accelerated-2d-canvas'],
  ['disable-background-timer-throttling'],
  ['disable-renderer-backgrounding'],
  ['disable-backgrounding-occluded-windows'],
  ['force_high_performance_gpu'],
  ['use-angle', 'd3d11'],
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',
  'qqmusic_uin',
  'wxuin',
  'login_type',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'psrf_qqopenid',
  'psrf_qqunionid',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'wxopenid',
  'wxunionid',
  'wxrefresh_token',
  'wxskey',
  'p_uin',
  'ptcz',
  'RK',
];
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
];
const KUGOU_LOGIN_COOKIE_PRIORITY = [
  'KuGoo',
  'kg_mid',
  'kg_dfid',
  'KugooID',
  'userid',
  'token',
  't',
];

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

function startupDelay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)));
}

function withStartupTimeout(promise, timeoutMs, label, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (typeof onTimeout === 'function') onTimeout(); } catch (_) {}
      const error = new Error(`${label || 'startup operation'} timed out after ${timeoutMs}ms`);
      error.code = 'MINERADIO_STARTUP_TIMEOUT';
      reject(error);
    }, Math.max(1000, Number(timeoutMs) || 1000));
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForServer(server, timeoutMs = STARTUP_SERVER_TIMEOUT_MS) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onListening = () => finish();
    const onError = (error) => finish(error);
    const timer = setTimeout(() => {
      const error = new Error(`waitForServer timed out after ${timeoutMs}ms`);
      error.code = 'MINERADIO_SERVER_TIMEOUT';
      finish(error);
    }, Math.max(1000, Number(timeoutMs) || STARTUP_SERVER_TIMEOUT_MS));
    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function waitForLocalHttpReady(port, timeoutMs = STARTUP_HTTP_TIMEOUT_MS) {
  const deadline = Date.now() + Math.max(1500, Number(timeoutMs) || STARTUP_HTTP_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeRequest = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (activeRequest) {
        try { activeRequest.destroy(); } catch (_) {}
        activeRequest = null;
      }
      if (error) reject(error);
      else resolve();
    };
    const probe = () => {
      if (settled) return;
      if (Date.now() >= deadline) {
        const error = new Error(`local HTTP server did not become ready within ${timeoutMs}ms`);
        error.code = 'MINERADIO_HTTP_TIMEOUT';
        finish(error);
        return;
      }
      activeRequest = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1200 }, (response) => {
        response.resume();
        activeRequest = null;
        if (response.statusCode >= 200 && response.statusCode < 500) {
          finish();
          return;
        }
        setTimeout(probe, 160);
      });
      activeRequest.once('timeout', () => activeRequest && activeRequest.destroy(new Error('HTTP probe timeout')));
      activeRequest.once('error', () => {
        activeRequest = null;
        setTimeout(probe, 160);
      });
    };
    probe();
  });
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('mineradio-global-hotkey', { action });
}

function unregisterMineradioGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureMineradioGlobalHotkeys(bindings = []) {
  unregisterMineradioGlobalHotkeys();
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}
function normalizeCloseBehavior(value) {
  return value === 'tray' ? 'tray' : 'exit';
}
function createOrUpdateTray() {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  if (tray) {
    try { tray.destroy(); } catch (_) {}
    tray = null;
  }
  try {
    tray = new Tray(APP_ICON_ICO);
    tray.setToolTip(APP_NAME);
    tray.on('click', () => focusMainWindow());
    tray.on('double-click', () => focusMainWindow());
    const send = (code) => {
      if (win && !win.isDestroyed()) {
        try { win.webContents.executeJavaScript(code, true); } catch (_) {}
      }
    };
    const menu = Menu.buildFromTemplate([
      { label: '显示 ' + APP_NAME, click: () => focusMainWindow() },
      { type: 'separator' },
      { label: '播放 / 暂停', click: () => send('if(typeof togglePlay==="function")togglePlay();') },
      { label: '上一首', click: () => send('if(typeof prevTrack==="function")prevTrack();') },
      { label: '下一首', click: () => send('if(typeof nextTrack==="function")nextTrack();') },
      { type: 'separator' },
      { label: '退出', click: () => { appQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
  } catch (e) {
    console.warn('[Tray] create failed', e);
  }
}
function destroyTray() {
  if (tray) {
    try { tray.destroy(); } catch (_) {}
    tray = null;
  }
}
/* ===== 缓存目录可配置（保守策略：默认路径= userData，不改变现状）===== */
function cacheSettingsConfigPath() {
  return path.join(app.getPath('userData'), CACHE_SETTINGS_FILE);
}
function defaultCacheRootPath() {
  return path.join(app.getPath('userData'), 'cache');
}
function normalizeCacheRootPath(value) {
  value = String(value || '').trim();
  if (!value) return defaultCacheRootPath();
  try {
    return path.resolve(value);
  } catch (_) {
    return defaultCacheRootPath();
  }
}
function normalizeCacheSettings(value) {
  value = value && typeof value === 'object' ? value : {};
  const rootPath = normalizeCacheRootPath(value.rootPath);
  return {
    version: 1,
    rootPath: rootPath,
    lyricsPath: path.join(rootPath, 'lyrics'),
    chromiumPath: path.join(rootPath, 'chromium'),
    beatmapsPath: path.join(rootPath, 'beatmaps'),
    updatesPath: path.join(rootPath, 'updates'),
    wallpaperPath: path.join(rootPath, 'wallpaper'),
    nativePath: path.join(rootPath, 'native-helper-temp')
  };
}
function chromiumSessionDataPath(settings) {
  return path.join(settings.chromiumPath, APP_NAME);
}
function readCacheSettings() {
  try {
    const raw = fs.readFileSync(cacheSettingsConfigPath(), 'utf8');
    return normalizeCacheSettings(JSON.parse(raw));
  } catch (_) {
    return normalizeCacheSettings(null);
  }
}
function writeCacheSettings(settings) {
  try {
    const tmp = cacheSettingsConfigPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, cacheSettingsConfigPath());
    return true;
  } catch (e) {
    console.warn('[CacheSettings] write failed', e);
    return false;
  }
}
function ensureCacheDirectories(settings) {
  const dirs = [settings.rootPath, settings.lyricsPath, settings.chromiumPath, settings.beatmapsPath, settings.updatesPath, settings.wallpaperPath, settings.nativePath];
  for (const dir of dirs) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
      console.warn('[CacheSettings] mkdir failed for', dir, e);
    }
  }
  return settings;
}
function directoryUsageBytes(directory) {
  return new Promise((resolve) => {
    if (!directory) { resolve(0); return; }
    let total = 0;
    const walk = (dir, done) => {
      fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
        if (err) { done(); return; }
        let pending = entries.length;
        if (!pending) { done(); return; }
        entries.forEach((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full, () => { if (--pending === 0) done(); });
          } else {
            try { total += fs.statSync(full).size; } catch (_) {}
            if (--pending === 0) done();
          }
        });
      });
    };
    walk(directory, () => resolve(total));
  });
}
async function cacheSettingsSnapshot() {
  const settings = cacheSettings || normalizeCacheSettings(null);
  const [lyricsBytes, chromiumBytes, beatmapsBytes, updatesBytes, wallpaperBytes] = await Promise.all([
    directoryUsageBytes(settings.lyricsPath),
    directoryUsageBytes(settings.chromiumPath),
    directoryUsageBytes(settings.beatmapsPath),
    directoryUsageBytes(settings.updatesPath),
    directoryUsageBytes(settings.wallpaperPath)
  ]);
  return {
    ok: true,
    settings: {
      rootPath: settings.rootPath,
      lyricsPath: settings.lyricsPath,
      chromiumPath: settings.chromiumPath,
      beatmapsPath: settings.beatmapsPath,
      updatesPath: settings.updatesPath,
      wallpaperPath: settings.wallpaperPath,
      nativePath: settings.nativePath
    },
    usage: {
      lyricsBytes, chromiumBytes, beatmapsBytes, updatesBytes, wallpaperBytes,
      totalManagedBytes: lyricsBytes + chromiumBytes + beatmapsBytes + updatesBytes + wallpaperBytes
    }
  };
}

/* ===== 歌词缓存 ===== */
function lyricCacheFilePath(key) {
  const digest = crypto.createHash('sha256').update(String(key || '')).digest('hex');
  return path.join(cacheSettings.lyricsPath, `${digest}.json`);
}

async function pruneLyricCache() {
  let entries = [];
  try {
    entries = await fs.promises.readdir(cacheSettings.lyricsPath, { withFileTypes: true });
  } catch (_) {
    return;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/i.test(entry.name)) continue;
    const file = path.join(cacheSettings.lyricsPath, entry.name);
    try {
      const stat = await fs.promises.stat(file);
      files.push({ file, size: Math.max(0, Number(stat.size) || 0), time: Number(stat.mtimeMs) || 0 });
    } catch (_) { }
  }
  let total = files.reduce((sum, item) => sum + item.size, 0);
  files.sort((a, b) => a.time - b.time);
  for (const item of files) {
    if (total <= LYRIC_CACHE_MAX_BYTES) break;
    try {
      await fs.promises.unlink(item.file);
      total -= item.size;
    } catch (_) { }
  }
}

/* ===== FX 自动保存 ===== */
function getCurrentFxAutosavePath() {
  return path.join(app.getPath('userData'), CURRENT_FX_AUTOSAVE_FILE);
}

function readCurrentFxAutosaveFile() {
  try {
    const file = getCurrentFxAutosavePath();
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (!stat || stat.size <= 0 || stat.size > CURRENT_FX_AUTOSAVE_MAX_BYTES) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const payload = JSON.parse(raw);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch (e) {
    console.warn('[FxAutosave] read skipped:', e.message);
    return null;
  }
}

function writeCurrentFxAutosaveFile(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'INVALID_AUTOSAVE_PAYLOAD' };
    }
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text, 'utf8') > CURRENT_FX_AUTOSAVE_MAX_BYTES) {
      return { ok: false, error: 'AUTOSAVE_PAYLOAD_TOO_LARGE' };
    }
    const file = getCurrentFxAutosavePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (e) {
    console.warn('[FxAutosave] write failed:', e.message);
    return { ok: false, error: e.message || 'AUTOSAVE_WRITE_FAILED' };
  }
}

/* ===== 导出登录 Cookie ===== */
function loginCookieExportMeta(provider) {
  const key = String(provider || '').toLowerCase();
  const userData = app.getPath('userData');
  const entries = {
    netease: { label: '网易云音乐', files: [process.env.COOKIE_FILE, path.join(userData, '.cookie')] },
    qq: { label: 'QQ音乐', files: [process.env.QQ_COOKIE_FILE, path.join(userData, '.qq-cookie')] },
    kugou: { label: '酷狗音乐', files: [process.env.KUGOU_COOKIE_FILE, path.join(userData, '.kugou-cookie')] },
    qishui: { label: '汽水音乐', files: [process.env.QISHUI_COOKIE_FILE, path.join(userData, '.qishui-cookie'), process.env.QISHUI_TOKEN_FILE, path.join(userData, '.qishui-token')] },
    spotify: { label: 'Spotify', files: [process.env.SPOTIFY_TOKEN_FILE, path.join(userData, '.spotify-token.json')] },
  };
  return entries[key] || null;
}

/* ===== GPU 诊断 ===== */
async function getGpuDiagnostics() {
  const status = (() => {
    try { return app.getGPUFeatureStatus(); } catch (e) { return { error: e.message || String(e) }; }
  })();
  let basicInfo = null;
  try {
    basicInfo = await app.getGPUInfo('basic');
  } catch (e) {
    basicInfo = { error: e.message || String(e) };
  }
  return {
    status,
    basicInfo,
    switches: {
      safeGpuRasterization: true,
      ignoreGpuBlocklist: process.env.MINERADIO_IGNORE_GPU_BLOCKLIST === '1',
      forceHighPerformanceGpu: process.env.MINERADIO_FORCE_HIGH_PERFORMANCE_GPU === '1',
      angle: 'd3d11',
    },
  };
}

function ensureMainWindowInsideDisplay(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    if (!display) return;
    const workArea = display.workArea;
    let { x, y, width, height } = bounds;
    if (width > workArea.width) width = workArea.width;
    if (height > workArea.height) height = workArea.height;
    if (x < workArea.x || x + width > workArea.x + workArea.width) x = workArea.x + Math.max(0, (workArea.width - width) / 2);
    if (y < workArea.y || y + height > workArea.y + workArea.height) y = workArea.y + Math.max(0, (workArea.height - height) / 2);
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  } catch (_) {}
}

function resetMainWindowZoom(win) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.setZoomFactor(1); } catch (_) {}
  try { win.webContents.setZoomLevel(0); } catch (_) {}
}

function getUpdateDownloadDir() {
  if (cacheSettings && cacheSettings.updatesPath) return cacheSettings.updatesPath;
  return path.join(app.getPath('userData'), 'updates');
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.MINERADIO_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.MINERADIO_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'Mineradio desktop music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

function qqCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const musicKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
  return !!(uin && musicKey);
}

function qqCookieHasPlaybackLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
  return !!(uin && playbackKey);
}

function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U;
}

function kugouCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const userId = String(obj.userid || obj.KugooID || obj.kugou_id || '').replace(/\D/g, '');
  const authToken = obj.token || obj.KuGoo || obj.t || '';
  return !!(userId && authToken);
}

function isQQCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com');
}

function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

function isKugouCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'kugou.com' || normalized.endsWith('.kugou.com') ||
    normalized === 'kgimg.com' || normalized.endsWith('.kgimg.com');
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildCookieHeader(cookies) {
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY);
}

async function readQQLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeader(cookies);
}

async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

async function readKugouLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isKugouCookieDomain, KUGOU_LOGIN_COOKIE_PRIORITY);
}

async function openNeteaseMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession);
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '网易云音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Netease login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const docs = [document];
          document.querySelectorAll('iframe').forEach((frame) => {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          });
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: '网易云登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || '网易云登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function openQQMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  const initialCookie = await readQQLoginCookieHeader(cookieSession);
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let warmupStarted = false;

    const loginWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'QQ 音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: QQ_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        if (qqCookieHasPlaybackLogin(cookie)) {
          finish({ ok: true, cookie });
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          warmupStarted = true;
          setTimeout(() => {
            if (!settled && loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.loadURL('https://y.qq.com/n/ryqq/player').catch((e) => console.warn('QQ login warmup navigation failed:', e.message));
            }
          }, 900);
        }
      } catch (e) {
        console.warn('QQ login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('QQ login popup navigation failed:', e.message));
      } else {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        resolve(qqCookieHasPlaybackLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'QQ 登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'QQ 登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(QQ_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function openKugouMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(KUGOU_LOGIN_PARTITION);
  await clearKugouMusicLoginSession();

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 920,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Kugou Music Login',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: KUGOU_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readKugouLoginCookieHeader(cookieSession);
        if (kugouCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Kugou login cookie check failed:', e.message);
      }
    };

    const localJson = (pathname) => new Promise((ok, fail) => {
      const port = mainServerPort || Number(process.env.PORT) || 3000;
      const headers = mineradioApiToken ? { 'X-Mineradio-Token': mineradioApiToken } : {};
      const req = http.get(`http://127.0.0.1:${port}${pathname}`, { headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const data = body ? JSON.parse(body) : {};
            if (res.statusCode >= 400) {
              const err = new Error(data.message || data.error || `HTTP_${res.statusCode}`);
              err.data = data;
              fail(err);
              return;
            }
            ok(data);
          } catch (e) {
            fail(e);
          }
        });
      });
      req.setTimeout(12000, () => req.destroy(new Error('Kugou login request timeout')));
      req.on('error', fail);
    });

    const startKugouQrLogin = async () => {
      try {
        const qr = await localJson('/api/kugou/login/qr/key?t=' + Date.now());
        const key = qr && (qr.key || qr.qrcode);
        if (!key || !qr.url) throw new Error('Kugou QR login URL missing');
        await loginWindow.loadURL(qr.url);
        const pollLogin = async () => {
          try {
            const data = await localJson('/api/kugou/login/qr/check?key=' + encodeURIComponent(key) + '&t=' + Date.now());
            if (data && data.code === 803 && data.loggedIn) {
              finish(Object.assign({ ok: true }, data));
            } else if (data && data.code === 800) {
              finish({ ok: false, error: data.message || 'Kugou QR expired, please try again' });
            }
          } catch (e) {
            console.warn('Kugou QR login check failed:', e.message);
          }
        };
        pollTimer = setInterval(pollLogin, 1200);
        pollLogin();
      } catch (e) {
        console.warn('Kugou QR login failed, falling back to web home:', e.message);
        pollTimer = setInterval(checkCookies, 1200);
        loginWindow.loadURL(KUGOU_LOGIN_URL).catch((err) => finish({ ok: false, error: err.message }));
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?kugou\.com/i.test(url) || /^https?:\/\/([^/]+\.)?kgimg\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Kugou login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆|立即登录/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readKugouLoginCookieHeader(cookieSession);
        resolve(kugouCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'Kugou login window closed' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'Kugou login window closed' });
      }
    });

    startKugouQrLogin();
  });
}

async function clearQQMusicLoginSession() {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function clearNeteaseMusicLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function clearKugouMusicLoginSession() {
  const cookieSession = session.fromPartition(KUGOU_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function applyWindowedBounds(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  win.setBounds(getWindowedBounds(win), false);
  sendWindowState(win);
}

function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win);
    return;
  }

  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win);
  };

  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500);
}

function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const shouldIgnore = locked || !desktopLyricsPointerCapture;
  if (desktopLyricsMouseIgnored === shouldIgnore) return;
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds;
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return;
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return;
  desktopLyricsLastMiddleAt = now;
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('mineradio-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  if (yChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  startDesktopLyricsMousePoller();
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  if (process.arch === 'x64') return handle.readBigUInt64LE(0).toString();
  return String(handle.readUInt32LE(0));
}

function attachWallpaperToWorkerW(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = nativeWindowHandleDecimal(win);
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("MineradioNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [MineradioNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[MineradioNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [MineradioNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [MineradioNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [MineradioNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[MineradioNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[MineradioNativeWin]::SetParent($target, $script:workerw) | Out-Null
[MineradioNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
  }, (error) => {
    if (error) console.warn('Wallpaper WorkerW attach failed:', error.message);
  });
}

function positionWallpaperWindow() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow.setBounds(bounds, false);
}

function sendWallpaperState() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  wallpaperWindow.webContents.send('mineradio-wallpaper-state', wallpaperState);
}

function createWallpaperWindow(payload = {}) {
  wallpaperState = { ...wallpaperState, ...payload, enabled: true };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    positionWallpaperWindow();
    sendWallpaperState();
    return wallpaperWindow;
  }
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: false,
    backgroundColor: '#050608',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });
  wallpaperWindow.once('ready-to-show', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    positionWallpaperWindow();
    wallpaperWindow.showInactive();
    attachWallpaperToWorkerW(wallpaperWindow);
    sendWallpaperState();
  });
  wallpaperWindow.webContents.once('did-finish-load', sendWallpaperState);
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null;
  });
  wallpaperWindow.loadURL(overlayUrl('wallpaper.html')).catch((e) => console.warn('Wallpaper load failed:', e.message));
  return wallpaperWindow;
}

function closeWallpaperWindow() {
  wallpaperState = { ...wallpaperState, enabled: false };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState();
    wallpaperWindow.close();
  }
  wallpaperWindow = null;
}

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow();
}

// ========== 辅助函数：IPC 信任检查 ==========

function isTrustedMainDocumentUrl(value) {
  try {
    if (!value) return false;
    const url = String(value);
    const port = mainServerPort || process.env.PORT || 3000;
    return url.startsWith(`http://127.0.0.1:${port}/`) || url.startsWith(`http://localhost:${port}/`);
  } catch (_) {
    return false;
  }
}

function isTrustedMainWindowIpc(event) {
  try {
    if (!event || !event.sender || !mainWindow || mainWindow.isDestroyed()) return false;
    if (event.sender !== mainWindow.webContents || event.sender.isDestroyed()) return false;
    if (event.senderFrame && event.senderFrame.parent) return false;
    const sourceUrl = event.senderFrame && event.senderFrame.url || event.sender.getURL();
    return isTrustedMainDocumentUrl(sourceUrl);
  } catch (_) {
    return false;
  }
}

function isTrustedWallpaperEngineIpc(event) {
  return isTrustedMainWindowIpc(event);
}

// ========== Spotify OAuth 辅助函数 ==========

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createSpotifyPkcePair() {
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function spotifyOAuthRedirectMatches(targetUrl, redirectUri) {
  try {
    const target = new URL(String(targetUrl || ''));
    const redirect = new URL(String(redirectUri || ''));
    const normalizePath = (value) => (value || '/').replace(/\/+$/, '') || '/';
    return target.protocol === redirect.protocol &&
      target.host === redirect.host &&
      normalizePath(target.pathname) === normalizePath(redirect.pathname);
  } catch (e) {
    return false;
  }
}

function spotifyOAuthResultHtml(ok, message) {
  const escaped = String(message || '').replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  return [
    '<!doctype html><meta charset="utf-8">',
    '<title>Spotify Login</title>',
    '<style>',
    'html,body{margin:0;height:100%;background:#101414;color:#f3fff6;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    'body{display:grid;place-items:center;}',
    'main{max-width:520px;padding:30px;text-align:center;}',
    '.brand{font-size:12px;letter-spacing:.24em;color:#1ed760;font-weight:900;margin-bottom:14px;}',
    'h1{font-size:26px;margin:0 0 12px;font-weight:850;}',
    'p{margin:0 auto;color:rgba(243,255,246,.72);line-height:1.7;font-size:14px;}',
    '</style>',
    '<main><div class="brand">SPOTIFY</div><h1>' + (ok ? '授权完成' : '授权失败') + '</h1><p>' + escaped + '</p></main>',
  ].join('');
}

function startSpotifyOAuthCallbackServer(redirectUri, onCallback) {
  return new Promise((resolve, reject) => {
    let redirect = null;
    try {
      redirect = new URL(String(redirectUri || ''));
    } catch (e) {
      reject(Object.assign(new Error('SPOTIFY_REDIRECT_URI_INVALID'), { code: 'SPOTIFY_REDIRECT_URI_INVALID' }));
      return;
    }
    if (redirect.protocol !== 'http:') {
      reject(Object.assign(new Error('SPOTIFY_REDIRECT_URI_MUST_BE_HTTP_LOCALHOST'), { code: 'SPOTIFY_REDIRECT_URI_MUST_BE_HTTP_LOCALHOST' }));
      return;
    }
    const port = Number(redirect.port || 80);
    const host = redirect.hostname || '127.0.0.1';
    const normalizePath = (value) => (value || '/').replace(/\/+$/, '') || '/';
    const expectedPath = normalizePath(redirect.pathname);
    const callbackServer = http.createServer(async (req, res) => {
      let current = null;
      try {
        current = new URL(req.url || '/', redirect.origin);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad callback URL');
        return;
      }
      if (normalizePath(current.pathname) !== expectedPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      try {
        const result = await onCallback(current);
        const ok = !!(result && result.ok);
        res.writeHead(ok ? 200 : 500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(spotifyOAuthResultHtml(ok, (result && (result.message || result.error)) || (ok ? '可以回到 Mineradio。' : '请回到 Mineradio 重新尝试。')));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(spotifyOAuthResultHtml(false, e && e.message || 'SPOTIFY_OAUTH_CALLBACK_FAILED'));
      }
    });
    callbackServer.once('error', (err) => {
      const code = err && err.code === 'EADDRINUSE' ? 'SPOTIFY_CALLBACK_PORT_BUSY' : (err && err.code || 'SPOTIFY_CALLBACK_SERVER_FAILED');
      reject(Object.assign(new Error(code), { code, cause: err }));
    });
    callbackServer.listen(port, host, () => {
      resolve({
        server: callbackServer,
        close: () => {
          try { callbackServer.close(); } catch (_) {}
        },
      });
    });
  });
}

async function openSpotifyMusicLoginWindow(owner) {
  const config = getSpotifyOAuthConfig();
  if (!config.configured) {
    return {
      ok: false,
      provider: 'spotify',
      error: 'SPOTIFY_OAUTH_NOT_CONFIGURED',
      missing: config.missing,
      redirectUri: config.redirectUri,
      message: 'Spotify 登录需要先配置 SPOTIFY_CLIENT_ID，并在 Spotify Developer Dashboard 登记本地回调地址 ' + config.redirectUri,
    };
  }

  const oauthState = crypto.randomBytes(16).toString('hex');
  const pkce = createSpotifyPkcePair();
  let authUrl = '';
  try {
    authUrl = buildSpotifyOAuthAuthorizeUrl({
      state: oauthState,
      codeChallenge: pkce.codeChallenge,
      redirectUri: config.redirectUri,
      scope: config.scope,
    });
  } catch (e) {
    return {
      ok: false,
      provider: 'spotify',
      error: e.code || e.message,
      missing: e.missing || config.missing,
      message: e.message || 'Spotify 授权地址生成失败',
    };
  }

  return new Promise(async (resolve) => {
    let settled = false;
    let exchangeStarted = false;
    let callbackServer = null;
    let loginWindow = null;

    const finish = (result) => {
      if (settled) return result;
      settled = true;
      if (callbackServer && typeof callbackServer.close === 'function') callbackServer.close();
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      resolve(result);
      return result;
    };

    const exchangeFromRedirect = async (targetUrl, event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (exchangeStarted) return { ok: true, provider: 'spotify', message: 'Spotify 授权正在处理。' };
      exchangeStarted = true;
      let parsed = null;
      try {
        parsed = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl || ''));
      } catch (e) {
        return finish({ ok: false, provider: 'spotify', error: 'SPOTIFY_OAUTH_BAD_REDIRECT', message: e.message });
      }
      const returnedState = parsed.searchParams.get('state') || '';
      if (returnedState !== oauthState) {
        return finish({ ok: false, provider: 'spotify', error: 'SPOTIFY_OAUTH_STATE_MISMATCH', message: 'Spotify 授权状态校验失败，请重新登录。' });
      }
      const oauthError = parsed.searchParams.get('error') || '';
      if (oauthError) {
        return finish({
          ok: false,
          provider: 'spotify',
          error: oauthError,
          message: parsed.searchParams.get('error_description') || 'Spotify 授权已取消或失败。',
        });
      }
      const code = parsed.searchParams.get('code') || '';
      if (!code) {
        return finish({ ok: false, provider: 'spotify', error: 'SPOTIFY_OAUTH_CODE_MISSING', message: 'Spotify 回调没有返回 code。' });
      }
      try {
        const info = await exchangeSpotifyOAuthCode({
          code,
          codeVerifier: pkce.codeVerifier,
          redirectUri: config.redirectUri,
        });
        return finish(Object.assign({ ok: true, provider: 'spotify', opened: true }, info || {}, {
          redirectUri: config.redirectUri,
          message: 'Spotify 登录成功，会员状态、歌单和 Liked Songs 已可同步。',
        }));
      } catch (e) {
        return finish({
          ok: false,
          provider: 'spotify',
          error: e.code || e.message || 'SPOTIFY_OAUTH_EXCHANGE_FAILED',
          message: e.message || 'Spotify token 换取失败。',
          missing: e.missing || [],
        });
      }
    };

    try {
      callbackServer = await startSpotifyOAuthCallbackServer(config.redirectUri, exchangeFromRedirect);
    } catch (e) {
      resolve({
        ok: false,
        provider: 'spotify',
        error: e.code || e.message || 'SPOTIFY_CALLBACK_SERVER_FAILED',
        redirectUri: config.redirectUri,
        message: (e.code || e.message) === 'SPOTIFY_CALLBACK_PORT_BUSY'
          ? 'Spotify 本地回调端口被占用，请关闭占用 43879 端口的程序后重试。'
          : 'Spotify 本地回调端口启动失败：' + (e.message || e.code || ''),
      });
      return;
    }

    loginWindow = new BrowserWindow({
      width: 900,
      height: 760,
      minWidth: 720,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Spotify 授权',
      backgroundColor: '#101414',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: SPOTIFY_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const handleMaybeRedirect = (targetUrl, event) => {
      if (!spotifyOAuthRedirectMatches(targetUrl, config.redirectUri)) return false;
      exchangeFromRedirect(targetUrl, event).catch((e) => {
        finish({ ok: false, provider: 'spotify', error: e.message || 'SPOTIFY_OAUTH_EXCHANGE_FAILED' });
      });
      return true;
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (handleMaybeRedirect(url)) return { action: 'deny' };
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Spotify login popup navigation failed:', e.message));
      } else {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });
    loginWindow.webContents.on('will-redirect', (event, url) => handleMaybeRedirect(url, event));
    loginWindow.webContents.on('will-navigate', (event, url) => handleMaybeRedirect(url, event));
    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', () => {
      if (!settled) finish({ ok: false, provider: 'spotify', cancelled: true, message: 'Spotify 授权窗口已关闭。' });
    });
    loginWindow.loadURL(authUrl).catch((e) => finish({ ok: false, provider: 'spotify', error: e.message || 'Spotify 授权页打开失败' }));
  });
}

async function clearSpotifyMusicLoginSession() {
  const cookieSession = session.fromPartition(SPOTIFY_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  clearSpotifyToken();
  return { ok: true, provider: 'spotify' };
}

// ========== Login Easter Egg 辅助函数 ==========

function loginEasterEggLockedResult() {
  return {
    ok: false,
    unlocked: false,
    error: 'LOGIN_EASTER_EGG_LOCKED',
    message: '请先完成登录彩蛋解锁。',
  };
}

async function clearAllProviderLoginState(reason) {
  try {
    await clearNeteaseMusicLoginSession();
    await clearQQMusicLoginSession();
    await clearKugouMusicLoginSession();
    await clearQishuiMusicLoginSession();
    await clearSpotifyMusicLoginSession();
    console.log('[LoginEasterEgg] all provider login state cleared:', reason);
    return { ok: true };
  } catch (e) {
    console.warn('[LoginEasterEgg] clear login state failed:', e.message);
    return { ok: false, error: e.message };
  }
}

async function initializeLoginEasterEggGate() {
  if (!loginEasterEggGate) return { ok: false, unlocked: false, error: 'LOGIN_EASTER_EGG_NOT_INITIALIZED' };
  const status = await loginEasterEggGate.initialize(() => clearAllProviderLoginState('startup-gate'));
  if (status.resetPerformed) {
    console.log('[LoginEasterEgg] first-run login credentials reset', {
      gateVersion: LOGIN_EASTER_EGG_GATE_VERSION,
      ok: status.resetComplete,
      error: status.error || '',
    });
  }
  return status;
}

// ========== Wallpaper Engine 辅助函数 ==========

function clearWallpaperEngineCaptureGrant(sessionId = '') {
  const expectedSessionId = String(sessionId || '');
  if (expectedSessionId && !wallpaperEngineCaptureGrant) return false;
  if (expectedSessionId && wallpaperEngineCaptureGrant.sessionId !== expectedSessionId) return false;
  if (!wallpaperEngineCaptureGrant) return false;
  wallpaperEngineCaptureGrant = null;
  wallpaperEngineCaptureSourceId = '';
  return true;
}

function wallpaperEngineProvidesDesktopBackdrop() {
  if (!wallpaperEngineRuntime) return false;
  const status = wallpaperEngineRuntime.getStatus();
  return !!(status && status.active === true
    && status.captureMode === 'dwm-thumbnail'
    && status.dwmSurfaceReady === true
    && status.dwmSurfaceActive === true
    && Number(status.dwmSurfaceWindowId) > 0);
}

async function broadcastDesktopWallpaperStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  const desktopStatus = fullDesktopModeRuntime ? fullDesktopModeRuntime.getStatus('broadcast') : { enabled: false };
  mainWindow.webContents.send('mineradio-wallpaper-runtime-state', {
    ...(status || desktopStatus),
    recoveryTrayAvailable: !!tray,
    escapeShortcutRegistered: fullDesktopEscapeRegistered === true,
  });
  if (tray) createOrUpdateTray();
}

ipcMain.handle('mineradio-get-api-token', () => mineradioApiToken || process.env.MINERADIO_API_TOKEN || '');

ipcMain.handle('desktop-window-minimize', (event) => {
  const win = getSenderWindow(event);
  if (win === mainWindow && fullDesktopModeRuntime && fullDesktopModeRuntime.getStatus('window-minimize').enabled === true) {
    return getWindowState(win);
  }
  win?.minimize();
  return getWindowState(win);
});

ipcMain.handle('desktop-window-restore', async (event) => {
  const win = getSenderWindow(event);
  if (!win || win.isDestroyed()) return null;
  if (win === mainWindow && fullDesktopModeRuntime && fullDesktopModeRuntime.getStatus('window-restore').enabled === true) {
    return getWindowState(win);
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  try { win.moveTop(); } catch (_) { }
  try { win.focus(); } catch (_) { }
  sendWindowState(win);
  return getWindowState(win);
});

ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

ipcMain.handle('desktop-window-close', (event, behavior) => {
  if (behavior) closeBehavior = normalizeCloseBehavior(behavior);
  const win = getSenderWindow(event);
  if (win) win.close();
});

ipcMain.handle('desktop-window-get-close-behavior', () => {
  return { behavior: closeBehavior };
});

ipcMain.handle('desktop-window-set-close-behavior', (_event, behavior) => {
  closeBehavior = normalizeCloseBehavior(behavior);
  if (closeBehavior === 'tray') createOrUpdateTray();
  else destroyTray();
  return { behavior: closeBehavior };
});

ipcMain.handle('mineradio-cache-get-settings', async () => {
  return cacheSettingsSnapshot();
});

ipcMain.handle('mineradio-cache-choose-directory', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '选择 Mineradio 缓存目录',
      defaultPath: cacheSettings ? cacheSettings.rootPath : app.getPath('userData'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-cache-set-settings', async (_event, payload) => {
  try {
    const rootPath = normalizeCacheRootPath(payload && payload.rootPath);
    console.log('[CacheSettings] set-settings called, rootPath:', rootPath);
    const next = normalizeCacheSettings({ rootPath: rootPath });
    // 校验目录可写
    try { fs.mkdirSync(next.rootPath, { recursive: true }); fs.accessSync(next.rootPath, fs.constants.W_OK); }
    catch (e) { return { ok: false, error: '目录不可写: ' + e.message }; }
    ensureCacheDirectories(next);
    const wroteOk = writeCacheSettings(next);
    console.log('[CacheSettings] write result:', wroteOk, 'config path:', cacheSettingsConfigPath());
    cacheSettings = next;
    return cacheSettingsSnapshot();
  } catch (e) {
    console.error('[CacheSettings] set-settings error:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-hotkeys-configure-global', (_event, bindings) => {
  return configureMineradioGlobalHotkeys(bindings);
});

ipcMain.handle('mineradio-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'mineradio-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 Mineradio 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 Mineradio 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

ipcMain.handle('netease-music-open-login', async (event) => {
  return openNeteaseMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('netease-music-clear-login', async () => {
  return clearNeteaseMusicLoginSession();
});

ipcMain.handle('qq-music-open-login', async (event) => {
  return openQQMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('qq-music-clear-login', async () => {
  return clearQQMusicLoginSession();
});

ipcMain.handle('kugou-music-open-login', async (event) => {
  return openKugouMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('kugou-music-clear-login', async () => {
  return clearKugouMusicLoginSession();
});

// ========== Qishui IPC handlers ==========

ipcMain.handle('qishui-music-open-login', async (event) => {
  return openQishuiMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('qishui-music-clear-login', async () => {
  return clearQishuiMusicLoginSession();
});

// ========== Spotify IPC handlers ==========

ipcMain.handle('spotify-music-open-login', async (event) => {
  return openSpotifyMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('spotify-music-clear-login', async () => {
  return clearSpotifyMusicLoginSession();
});

ipcMain.handle('spotify-status', async (_event) => {
  try {
    return await handleSpotifyStatus();
  } catch (e) {
    return { ok: false, error: e.message, loggedIn: false };
  }
});

ipcMain.handle('spotify-config', async (_event) => {
  try {
    const config = getSpotifyOAuthConfig();
    return { ok: true, ...config };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('spotify-save-config', async (_event, payload) => {
  try {
    const result = saveSpotifyConfig(payload || {});
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('spotify-search', async (_event, query, options) => {
  try {
    return await handleSpotifySearch(query, options);
  } catch (e) {
    return { ok: false, error: e.message, songs: [] };
  }
});

ipcMain.handle('spotify-recommendations', async (_event, options) => {
  try {
    return await handleSpotifyRecommendations(options);
  } catch (e) {
    return { ok: false, error: e.message, songs: [] };
  }
});

ipcMain.handle('spotify-user-playlists', async (_event) => {
  try {
    return await handleSpotifyUserPlaylists();
  } catch (e) {
    return { ok: false, error: e.message, playlists: [] };
  }
});

ipcMain.handle('spotify-playlist-tracks', async (_event, playlistId, options) => {
  try {
    return await handleSpotifyPlaylistTracks(playlistId, options);
  } catch (e) {
    return { ok: false, error: e.message, songs: [] };
  }
});

ipcMain.handle('spotify-song-url', async (_event, songId) => {
  try {
    return await handleSpotifySongUrl(songId);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('spotify-lyric', async (_event, songId) => {
  try {
    return await handleSpotifyLyric(songId);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('spotify-logout', async () => {
  clearSpotifyToken();
  return { ok: true };
});

// ========== Wallpaper Engine IPC handlers ==========

ipcMain.handle('mineradio-wallpaper-engine-list', async (event, payload = {}) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineLibrary) return { ok: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const snapshot = await wallpaperEngineLibrary.list({ force: payload && payload.force === true });
    const runtime = wallpaperEngineRuntime ? await wallpaperEngineRuntime.probe(payload && payload.force === true) : { available: false };
    return { ...snapshot, runtime };
  } catch (error) {
    return { ok: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_SCAN_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-project-details', async (event, id) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineLibrary) return { ok: false, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    return await wallpaperEngineLibrary.getProjectDetails(String(id || ''));
  } catch (error) {
    return { ok: false, error: error.message || 'WALLPAPER_ENGINE_PROJECT_DETAILS_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-choose-directory', async (event) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, canceled: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineLibrary) return { ok: false, canceled: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const options = {
      title: '识别并导入 Wallpaper Engine 项目',
      buttonLabel: '识别此目录',
      properties: ['openDirectory'],
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: true, canceled: true };
    const snapshot = await wallpaperEngineLibrary.addManualRoot(result.filePaths[0]);
    const runtime = wallpaperEngineRuntime ? await wallpaperEngineRuntime.probe(false) : { available: false };
    return { ...snapshot, runtime, canceled: false };
  } catch (error) {
    return { ok: false, canceled: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_IMPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-choose-project-file', async (event) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, canceled: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineLibrary) return { ok: false, canceled: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const options = {
      title: '选择 Wallpaper Engine 的 project.json 或场景包（.pkg/.pak）',
      buttonLabel: '导入此项目',
      properties: ['openFile'],
      filters: [
        { name: 'Wallpaper Engine 项目', extensions: ['pkg', 'pak', 'json'] },
      ],
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: true, canceled: true };
    const selected = path.resolve(result.filePaths[0]);
    const snapshot = await wallpaperEngineLibrary.addManualProjectFile(selected);
    const runtime = wallpaperEngineRuntime ? await wallpaperEngineRuntime.probe(false) : { available: false };
    return { ...snapshot, runtime, canceled: false };
  } catch (error) {
    return { ok: false, canceled: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-remove-directory', async (event, rootId) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineLibrary) return { ok: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const snapshot = await wallpaperEngineLibrary.removeManualRoot(rootId);
    const runtime = wallpaperEngineRuntime ? await wallpaperEngineRuntime.probe(false) : { available: false };
    return { ...snapshot, runtime };
  } catch (error) {
    return { ok: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_REMOVE_ROOT_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-runtime-status', async (event, payload = {}) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, available: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineRuntime) return { ok: false, available: false, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const probe = await wallpaperEngineRuntime.probe(payload && payload.force === true);
    return { ...probe, ...wallpaperEngineRuntime.getStatus(), pending: wallpaperEngineRuntime.pending != null };
  } catch (error) {
    return { ok: false, available: false, error: error.message || 'WALLPAPER_ENGINE_RUNTIME_PROBE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-start-scene', async (event, payload = {}) => {
  let operation = 0;
  let startedSessionId = '';
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineRuntime) return { ok: false, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'WALLPAPER_ENGINE_NO_HOST_WINDOW' };
    operation = ++wallpaperEngineCaptureOperation;
    const result = await wallpaperEngineRuntime.start(String(payload.id || ''), {
      width: Math.max(640, Math.min(7680, Number(payload.width) || 1280)),
      height: Math.max(360, Math.min(4320, Number(payload.height) || 720)),
      fps: Math.max(24, Math.min(240, Number(payload.fps) || 60)),
    });
    startedSessionId = String(result && result.sessionId || '');
    if (operation !== wallpaperEngineCaptureOperation) {
      await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
      return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED', sessionId: startedSessionId };
    }
    return { ...result, capturePrepared: true, captureMode: 'dwm-thumbnail' };
  } catch (error) {
    if (startedSessionId) {
      clearWallpaperEngineCaptureGrant(startedSessionId);
      await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
    }
    return { ok: false, error: error.code || error.message || 'WALLPAPER_ENGINE_SCENE_START_FAILED', sessionId: startedSessionId };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-stop-scene', async (event, payload = {}) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineRuntime) return { ok: false, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const sessionId = String(payload.sessionId || '');
    const stopAll = payload && payload.all === true || !sessionId;
    if (stopAll) {
      wallpaperEngineCaptureOperation += 1;
      clearWallpaperEngineCaptureGrant();
    }
    const result = await wallpaperEngineRuntime.stop(stopAll ? '' : sessionId);
    return result;
  } catch (error) {
    return { ok: false, error: error.code || error.message || 'WALLPAPER_ENGINE_SCENE_STOP_FAILED' };
  }
});

// ========== Full Desktop Mode IPC handlers ==========

ipcMain.handle('mineradio-full-desktop-set-icons-visible', async (event, visible) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
  if (!fullDesktopModeRuntime) return { ok: false, error: 'FULL_DESKTOP_NOT_INITIALIZED' };
  return fullDesktopModeRuntime.setDesktopIconsVisible(visible !== false, 'renderer-icons-visible');
});

ipcMain.handle('mineradio-full-desktop-set-software-lock', async (event, locked) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
  if (!fullDesktopModeRuntime) return { ok: false, error: 'FULL_DESKTOP_NOT_INITIALIZED' };
  return fullDesktopModeRuntime.setSoftwareInteractionLocked(locked === true, 'renderer-software-lock');
});

ipcMain.on('mineradio-full-desktop-icon-shields', (event, payload = {}) => {
  if (!isTrustedMainWindowIpc(event)) return;
  if (!fullDesktopModeRuntime) return;
  const rects = payload && payload.enabled === true && payload.interactive === true
    ? payload.rects
    : [];
  fullDesktopModeRuntime.updateIconShields(
    Array.isArray(rects) ? rects : [],
    payload && payload.viewport && typeof payload.viewport === 'object' ? payload.viewport : {}
  );
});

ipcMain.on('mineradio-full-desktop-request-keyboard-focus', (event, reason) => {
  if (!isTrustedMainWindowIpc(event)) return;
  if (!fullDesktopModeRuntime) return;
  const focusResult = fullDesktopModeRuntime.requestKeyboardFocus(
    `renderer-${String(reason || 'pointerdown').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 64)}`
  );
  if (focusResult && focusResult.ok) return;
  const desktopStatus = fullDesktopModeRuntime.getStatus('renderer-keyboard-focus-fallback');
  if (desktopStatus && desktopStatus.enabled) return;
  const webContents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!webContents || webContents.isDestroyed() || typeof webContents.focus !== 'function') return;
  webContents.focus();
});

ipcMain.on('mineradio-full-desktop-pointer-route', (event, payload = {}) => {
  if (!isTrustedMainWindowIpc(event)) return;
  if (!fullDesktopModeRuntime) return;
  fullDesktopModeRuntime.updatePointerRoute({
    overSoftwareUi: payload && payload.overSoftwareUi === true,
    overDesktopControls: payload && payload.overDesktopControls === true,
  }, 'renderer-pointer-route');
});

ipcMain.handle('full-desktop-status', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, enabled: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
  if (!fullDesktopModeRuntime) return { ok: false, enabled: false, error: 'FULL_DESKTOP_NOT_INITIALIZED' };
  return { ok: true, ...fullDesktopModeRuntime.getStatus('renderer-status') };
});

ipcMain.handle('full-desktop-enable', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
  if (!fullDesktopModeRuntime) return { ok: false, error: 'FULL_DESKTOP_NOT_INITIALIZED' };
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'NO_MAIN_WINDOW' };
  try {
    fullDesktopEnableOperation += 1;
    const result = await fullDesktopModeRuntime.enableDesktopMode(mainWindow, 'renderer-enable');
    if (result && result.ok === true) {
      broadcastDesktopWallpaperStatus();
    }
    return result;
  } catch (e) {
    return { ok: false, error: e.message || 'FULL_DESKTOP_ENABLE_FAILED' };
  }
});

ipcMain.handle('full-desktop-disable', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
  if (!fullDesktopModeRuntime) return { ok: false, error: 'FULL_DESKTOP_NOT_INITIALIZED' };
  try {
    fullDesktopEnableOperation += 1;
    const result = await fullDesktopModeRuntime.disableDesktopMode('renderer-disable');
    broadcastDesktopWallpaperStatus({ enabled: false });
    return result;
  } catch (e) {
    return { ok: false, error: e.message || 'FULL_DESKTOP_DISABLE_FAILED' };
  }
});

// ========== Login Easter Egg IPC handlers ==========

ipcMain.handle('mineradio-login-easter-egg-status', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_SENDER', unlocked: false };
  if (!loginEasterEggGate) return { ok: false, error: 'LOGIN_EASTER_EGG_NOT_INITIALIZED', unlocked: false };
  return loginEasterEggGate.publicStatus();
});

ipcMain.handle('mineradio-login-easter-egg-unlock', async (event, value) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_SENDER', unlocked: false };
  if (!loginEasterEggGate) return { ok: false, error: 'LOGIN_EASTER_EGG_NOT_INITIALIZED', unlocked: false };
  return loginEasterEggGate.unlock(value);
});

ipcMain.handle('mineradio-login-easter-egg-reset', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_SENDER', unlocked: false };
  if (!loginEasterEggGate) return { ok: false, error: 'LOGIN_EASTER_EGG_NOT_INITIALIZED', unlocked: false };
  return loginEasterEggGate.resetForReplay(() => clearAllProviderLoginState('renderer-replay-reset'));
});

// ========== Desktop Icon IPC handlers ==========

ipcMain.handle('mineradio-desktop-icon-probe', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_SENDER' };
  try {
    return await probeDesktopIcons();
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-desktop-icon-apply-shape', async (event, shape) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_SENDER' };
  try {
    return await applyDesktopIconShape(shape);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-desktop-icon-clear-shape', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_SENDER' };
  try {
    return await clearDesktopIconShape();
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-open-project-details', async (event, payload = {}) => {
  try {
    if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
    if (!wallpaperEngineLibrary) return { ok: false, error: 'WALLPAPER_ENGINE_NOT_INITIALIZED' };
    const details = await wallpaperEngineLibrary.getProjectDetails(String(payload && payload.id || ''));
    const workshopId = String(details && details.workshopId || '');
    if (!/^\d{5,32}$/.test(workshopId)) {
      return { ok: false, error: 'WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE' };
    }
    const webUrl = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + workshopId;
    await shell.openExternal(webUrl);
    return { ok: true, opened: 'web-workshop', workshopId };
  } catch (error) {
    return { ok: false, error: error.message || 'WALLPAPER_ENGINE_OPEN_PROJECT_DETAILS_FAILED' };
  }
});

ipcMain.handle('mineradio-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

ipcMain.handle('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) createWallpaperWindow(payload || {});
    else closeWallpaperWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-update', async (_event, payload) => {
  try {
    wallpaperState = { ...wallpaperState, ...(payload || {}) };
    if (wallpaperState.enabled) {
      createWallpaperWindow(wallpaperState);
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        positionWallpaperWindow();
        sendWallpaperState();
      }
    } else if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
      sendWallpaperState();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-get-status', async (event) => {
  if (!isTrustedMainWindowIpc(event)) return { ok: false, enabled: false, error: 'WALLPAPER_UNTRUSTED_SENDER' };
  const status = fullDesktopModeRuntime ? fullDesktopModeRuntime.getStatus('renderer-query') : { enabled: false };
  return {
    ok: true,
    status: {
      ...status,
      recoveryTrayAvailable: !!tray,
      escapeShortcutRegistered: fullDesktopEscapeRegistered === true,
    },
  };
});

// ========== 启动状态记录 / 错误日志 / 闪屏重试 ==========

function startupErrorText(error) {
  if (!error) return 'UNKNOWN_ERROR';
  if (typeof error === 'string') return error;
  return String(error.stack || error.message || error);
}

function resolveStartupErrorCode(context, error) {
  const text = `${context || ''}\n${startupErrorText(error)}`;
  if (/EADDRINUSE|address already in use|listen EADDRINUSE|端口/i.test(text)) return 'MR-BOOT-SERVER-PORT';
  if (/waitForServer|server|ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) return 'MR-BOOT-SERVER-START';
  if (/loadURL|ERR_FAILED|ERR_ABORTED|navigation|did-fail-load/i.test(text)) return 'MR-BOOT-WINDOW-LOAD';
  if (/ReferenceError|TypeError|is not defined|Cannot read/i.test(text)) return 'MR-BOOT-MAIN-RUNTIME';
  if (/EPERM|EACCES|access is denied|permission/i.test(text)) return 'MR-BOOT-PERMISSION';
  if (/gpu|angle|d3d|webgl/i.test(text)) return 'MR-BOOT-GPU';
  if (/second/i.test(context || '')) return 'MR-BOOT-SECOND-INSTANCE';
  if (/activate/i.test(context || '')) return 'MR-BOOT-ACTIVATE';
  return 'MR-BOOT-MAIN';
}

function startupErrorLogPath() {
  try {
    return path.join(app.getPath('userData'), STARTUP_ERROR_LOG_FILE);
  } catch (_) {
    return path.join(__dirname, '..', STARTUP_ERROR_LOG_FILE);
  }
}

function writeStartupState(phase, detail = {}) {
  try {
    const now = Date.now();
    startupState = {
      ...startupState,
      ...detail,
      pid: process.pid,
      phase: String(phase || 'unknown'),
      updatedAt: now,
      events: (startupState.events || []).concat({ phase: String(phase || 'unknown'), at: now, ...detail }).slice(-32),
    };
    const file = path.join(app.getPath('userData'), STARTUP_STATE_FILE);
    const tempFile = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(startupState, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
    return true;
  } catch (error) {
    console.warn('[StartupState] write skipped:', error.message);
    return false;
  }
}

function writeStartupErrorLog(context, code, error) {
  const file = startupErrorLogPath();
  const detail = startupErrorText(error);
  const reportId = crypto.createHash('sha1')
    .update(`${Date.now()}:${code}:${context}:${detail}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  const payload = [
    '============================================================',
    `time=${new Date().toISOString()}`,
    `reportId=${reportId}`,
    `code=${code}`,
    `context=${context || 'unknown'}`,
    `app=${APP_NAME}`,
    `version=${APP_VERSION}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `pid=${process.pid}`,
    `userData=${(() => { try { return app.getPath('userData'); } catch (_) { return ''; } })()}`,
    '',
    detail,
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, payload, 'utf8');
  } catch (e) {
    console.warn('[StartupError] log write failed:', e.message);
  }
  return { file, reportId };
}

function startupStageLabel(context) {
  const value = String(context || '').toLowerCase();
  if (value.includes('second')) return '重复启动/唤醒已有窗口';
  if (value.includes('activate')) return '系统激活/恢复窗口';
  if (value.includes('server')) return '本地服务启动';
  if (value.includes('load')) return '主窗口加载';
  return '主窗口创建';
}

function buildStartupErrorMessage(context, code, logInfo, error) {
  const detail = startupErrorText(error);
  const reason = String((error && error.message) || error || '未知错误').split(/\r?\n/)[0].slice(0, 360);
  return [
    `错误代码：${code}`,
    `报告编号：${logInfo.reportId}`,
    `启动阶段：${startupStageLabel(context)}`,
    `简短原因：${reason || '未知错误'}`,
    '',
    '请把错误代码和报告编号发给开发者。',
    `日志文件：${logInfo.file}`,
    '',
    '详细信息：',
    detail.slice(0, 1400),
  ].join('\n');
}

function reportWindowCreationFailure(context, error) {
  const code = resolveStartupErrorCode(context, error);
  const logInfo = writeStartupErrorLog(context, code, error);
  writeStartupState('failed', { context: String(context || ''), code, error: startupErrorText(error).slice(0, 1200) });
  console.error(`[${code}] ${context} window creation failed:`, error);
  if (!startupErrorReported) {
    startupErrorReported = true;
    try {
      dialog.showErrorBox(`Mineradio 启动失败 (${code})`, buildStartupErrorMessage(context, code, logInfo, error));
    } catch (_) {}
  }
  if (!startupCompleted) {
    const failedWindow = mainWindow;
    mainWindow = null;
    if (failedWindow && !failedWindow.isDestroyed()) {
      try { failedWindow.destroy(); } catch (_) {}
    }
    setImmediate(() => app.quit());
  }
}

function bindStartupFailureHandlers() {
  process.on('uncaughtException', (error) => {
    if (startupCompleted) {
      console.error('[UncaughtException]', error);
      return;
    }
    reportWindowCreationFailure('Uncaught exception', error);
  });
  process.on('unhandledRejection', (reason) => {
    if (startupCompleted) {
      console.error('[UnhandledRejection]', reason);
      return;
    }
    reportWindowCreationFailure('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  });
}

bindStartupFailureHandlers();

function showMainWindowSafely(win, reason) {
  if (!win || win.isDestroyed()) return false;
  if (win.__mineradioStartupShowTimer) {
    clearTimeout(win.__mineradioStartupShowTimer);
    win.__mineradioStartupShowTimer = null;
  }
  ensureMainWindowInsideDisplay(win);
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  resetMainWindowZoom(win);
  sendWindowState(win);
  if (!startupState.windowVisibleAt) {
    writeStartupState('window-visible', { windowVisibleAt: Date.now(), visibleReason: String(reason || '') });
  }
  if (reason) console.log('[StartupWindow] visible:', reason);
  return true;
}

async function ensureLocalServerStarted() {
  if (localServer && localServer.listening) return localServer;
  if (localServerStartPromise) return localServerStartPromise;
  localServerStartPromise = (async () => {
    const port = await withStartupTimeout(findOpenPort(3000), 5000, 'findOpenPort');
    mainServerPort = port;

    process.env.HOST = '127.0.0.1';
    process.env.PORT = String(port);
    // 注意: app.setPath('cache', ...) 会篡改 app.getPath('appData') 和 app.getPath('userData')，
    // 导致它们指向 Chromium 缓存目录（会被清理）。用 setPath 之前保存的真实 appData 作为稳定路径。
    const _stableUserData = path.join(_REAL_APP_DATA, 'Mineradio');
    try { fs.mkdirSync(_stableUserData, { recursive: true }); } catch (_) {}
    process.env.COOKIE_FILE = path.join(_stableUserData, '.cookie');
    process.env.QQ_COOKIE_FILE = path.join(_stableUserData, '.qq-cookie');
    process.env.KUGOU_COOKIE_FILE = path.join(_stableUserData, '.kugou-cookie');
    process.env.QISHUI_COOKIE_FILE = path.join(_stableUserData, '.qishui-cookie');
    process.env.QISHUI_TOKEN_FILE = path.join(_stableUserData, '.qishui-token');
    process.env.SPOTIFY_TOKEN_FILE = path.join(_stableUserData, '.spotify-token.json');
    if (!process.env.SPOTIFY_CONFIG_FILE) {
      process.env.SPOTIFY_CONFIG_FILE = path.join(_stableUserData, '.spotify-credentials.json');
    }
    process.env.LLM_SECRET_FILE = path.join(_stableUserData, '.llm-secret.dat');
    process.env.LLM_CONFIG_FILE = path.join(_stableUserData, '.llm-config.json');
    process.env.MINERADIO_LOGIN_EASTER_EGG_GATE_FILE = path.join(_stableUserData, LOGIN_EASTER_EGG_STATE_FILE);
    process.env.MINERADIO_LOGIN_EASTER_EGG_GATE_VERSION = LOGIN_EASTER_EGG_GATE_VERSION;
    process.env.MINERADIO_UPDATE_DIR = (cacheSettings && cacheSettings.updatesPath) || getUpdateDownloadDir();
    process.env.MINERADIO_BEAT_CACHE_DIR = (cacheSettings && cacheSettings.beatmapsPath) || path.join(_stableUserData, 'beatmaps');
    // 迁移: 如果旧的 userData (被 setPath('cache') 篡改的 Chromium 缓存目录) 里有 cookie 文件，搬到稳定路径
    try {
      const _wrongUserData = app.getPath('userData');
      if (_wrongUserData && _wrongUserData !== _stableUserData) {
        ['.cookie', '.qq-cookie', '.kugou-cookie', '.qishui-cookie', '.qishui-token', '.spotify-token.json', '.spotify-credentials.json', LOGIN_EASTER_EGG_STATE_FILE].forEach((fn) => {
          const _old = path.join(_wrongUserData, fn);
          const _new = path.join(_stableUserData, fn);
          if (fs.existsSync(_old) && !fs.existsSync(_new)) {
            fs.copyFileSync(_old, _new);
          }
        });
      }
    } catch (_) {}
    if (!process.env.MINERADIO_API_TOKEN) {
      process.env.MINERADIO_API_TOKEN = crypto.randomBytes(32).toString('hex');
    }
    mineradioApiToken = process.env.MINERADIO_API_TOKEN;

    // 旧 cookie 文件迁移到 userData 目录
    try {
      const legacyQQCookie = path.join(__dirname, '..', '.qq-cookie');
      if (fs.existsSync(legacyQQCookie)) {
        if (!fs.existsSync(process.env.QQ_COOKIE_FILE)) {
          fs.copyFileSync(legacyQQCookie, process.env.QQ_COOKIE_FILE);
        }
        fs.unlinkSync(legacyQQCookie);
      }
      const legacyKugouCookie = path.join(__dirname, '..', '.kugou-cookie');
      if (fs.existsSync(legacyKugouCookie)) {
        if (!fs.existsSync(process.env.KUGOU_COOKIE_FILE)) {
          fs.copyFileSync(legacyKugouCookie, process.env.KUGOU_COOKIE_FILE);
        }
        fs.unlinkSync(legacyKugouCookie);
      }
      const legacyQishuiCookie = path.join(__dirname, '..', '.qishui-cookie');
      if (fs.existsSync(legacyQishuiCookie)) {
        if (!fs.existsSync(process.env.QISHUI_COOKIE_FILE)) {
          fs.copyFileSync(legacyQishuiCookie, process.env.QISHUI_COOKIE_FILE);
        }
        fs.unlinkSync(legacyQishuiCookie);
      }
      const legacyQishuiToken = path.join(__dirname, '..', '.qishui-token');
      if (fs.existsSync(legacyQishuiToken)) {
        if (!fs.existsSync(process.env.QISHUI_TOKEN_FILE)) {
          fs.copyFileSync(legacyQishuiToken, process.env.QISHUI_TOKEN_FILE);
        }
        fs.unlinkSync(legacyQishuiToken);
      }
    } catch (e) {
      console.warn('Cookie migration skipped:', e.message);
    }

    // 旧 Spotify token 文件迁移
    try {
      const legacySpotifyToken = path.join(__dirname, '..', '.spotify-token.json');
      if (fs.existsSync(legacySpotifyToken)) {
        if (!fs.existsSync(process.env.SPOTIFY_TOKEN_FILE)) {
          fs.copyFileSync(legacySpotifyToken, process.env.SPOTIFY_TOKEN_FILE);
        }
        fs.unlinkSync(legacySpotifyToken);
      }
      const spotifyConfigTarget = process.env.SPOTIFY_CONFIG_FILE;
      const legacySpotifyConfigFiles = [
        path.join(__dirname, '..', '.spotify-credentials.json'),
        path.join(__dirname, '..', 'spotify-credentials.json'),
      ];
      for (const legacySpotifyConfig of legacySpotifyConfigFiles) {
        if (spotifyConfigTarget && fs.existsSync(legacySpotifyConfig) && !fs.existsSync(spotifyConfigTarget)) {
          fs.copyFileSync(legacySpotifyConfig, spotifyConfigTarget);
          break;
        }
      }
    } catch (e) {
      console.warn('Spotify token migration skipped:', e.message);
    }

    // 初始化 Login Easter Egg Gate
    if (loginEasterEggGate) {
      await initializeLoginEasterEggGate();
    }

    const serverModulePath = path.join(__dirname, '..', 'server.js');
    try { delete require.cache[require.resolve(serverModulePath)]; } catch (_) {}
    localServer = require(serverModulePath);

    // cookie 加密存储（保持原有 secret-store 集成，加入写入验证与明文兜底）
    if (localServer && typeof localServer.configureCookieStorage === 'function') {
      const secretStore = require('./secret-store');
      const _cookieDebugLogPath = path.join(_stableUserData, 'cookie-debug.log');
      const _cookieLog = (msg) => {
        try {
          // 限幅：超过 512KB 清空重写，防止无限增长
          try {
            const st = fs.statSync(_cookieDebugLogPath);
            if (st.size > 512 * 1024) fs.writeFileSync(_cookieDebugLogPath, '');
          } catch (_) {}
          fs.appendFileSync(_cookieDebugLogPath, '[' + new Date().toISOString() + '] [main] ' + msg + '\n', 'utf8');
        } catch (_) {}
      };
      _cookieLog('configureCookieStorage setup starting, realAppData=' + _REAL_APP_DATA + ' stableUserData=' + _stableUserData + ' wrongUserData=' + app.getPath('userData'));
      _cookieLog('KUGOU_COOKIE_FILE=' + process.env.KUGOU_COOKIE_FILE);
      _cookieLog('safeStorage available=' + (secretStore && typeof require('electron').safeStorage !== 'undefined' ? require('electron').safeStorage.isEncryptionAvailable() : 'unknown'));
      localServer.configureCookieStorage(
        (file) => {
          const val = secretStore.readSecretFile(file);
          _cookieLog('readFn: file=' + file + ' len=' + (val || '').length);
          return val;
        },
        (file, content) => {
          const value = String(content || '');
          _cookieLog('writeFn: file=' + file + ' contentLen=' + value.length);
          if (!file) { _cookieLog('writeFn: no file path, abort'); return; }
          if (!value) {
            _cookieLog('writeFn: empty content, deleting file if exists');
            try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
            return;
          }
          // 1) 尝试加密写入
          try {
            secretStore.writeSecretFile(file, content);
            // 2) 验证文件确实写入了
            if (fs.existsSync(file) && fs.statSync(file).size > 0) {
              _cookieLog('writeFn: encrypted write OK, size=' + fs.statSync(file).size);
              return;
            }
            _cookieLog('writeFn: encrypted write returned but file missing/empty, trying plaintext');
          } catch (e) {
            _cookieLog('writeFn: encrypted write threw: ' + e.message + ', trying plaintext');
          }
          // 3) 明文兜底写入
          try {
            fs.writeFileSync(file, value, 'utf8');
            _cookieLog('writeFn: plaintext fallback OK, size=' + fs.statSync(file).size);
          } catch (e2) {
            _cookieLog('writeFn: plaintext fallback FAILED: ' + e2.message);
            console.error('[Cookie] all write attempts failed:', file, e2.message);
          }
        },
      );
      [process.env.COOKIE_FILE, process.env.QQ_COOKIE_FILE, process.env.KUGOU_COOKIE_FILE, process.env.QISHUI_COOKIE_FILE].forEach((file) => {
        if (!file) return;
        try {
          const value = secretStore.readSecretFile(file);
          if (value) secretStore.writeSecretFile(file, value);
        } catch (e) {
          _cookieLog('migration skipped for ' + file + ': ' + e.message);
          console.warn('Cookie encryption migration skipped:', file, e.message);
        }
      });
      _cookieLog('configureCookieStorage setup done');
    }

    if (localServer && typeof localServer.startHttpServer === 'function') {
      localServer.startHttpServer();
    }
    await waitForServer(localServer, STARTUP_SERVER_TIMEOUT_MS);
    await waitForLocalHttpReady(port, STARTUP_HTTP_TIMEOUT_MS);
    writeStartupState('server-ready', { serverReadyAt: Date.now(), port });
    return localServer;
  })().catch((error) => {
    if (localServer && localServer.close) {
      try { localServer.close(); } catch (_) {}
    }
    localServer = null;
    mainServerPort = 0;
    throw error;
  }).finally(() => {
    localServerStartPromise = null;
  });
  return localServerStartPromise;
}

async function loadMainWindowWithRetry(win) {
  const port = mainServerPort || process.env.PORT || 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (!win || win.isDestroyed()) throw new Error('Main BrowserWindow was destroyed before navigation');
    const targetUrl = `${baseUrl}/?startupAttempt=${attempt}&startupAt=${Date.now()}`;
    try {
      writeStartupState('navigation-attempt', { navigationAttempt: attempt, navigationAt: Date.now(), targetUrl });
      await withStartupTimeout(
        win.loadURL(targetUrl),
        STARTUP_NAVIGATION_TIMEOUT_MS,
        `loadURL attempt ${attempt}`,
        () => { try { win.webContents.stop(); } catch (_) {} },
      );
      return targetUrl;
    } catch (error) {
      lastError = error;
      writeStartupState('navigation-retry', { navigationAttempt: attempt, retryAt: Date.now(), lastNavigationError: String(error && error.message || error) });
      console.warn(`[StartupWindow] navigation attempt ${attempt} failed:`, error.message || error);
      try { win.webContents.stop(); } catch (_) {}
      // stop() 会清掉当前帧，透明窗口立刻变白窗——回填启动页保住深色首屏
      try { win.loadFile(path.join(__dirname, 'startup.html')).catch(() => {}); } catch (_) {}
      if (attempt < 2) await startupDelay(500);
    }
  }
  const error = new Error(`loadURL failed after retry: ${startupErrorText(lastError)}`);
  error.code = (lastError && lastError.code) || 'MINERADIO_NAVIGATION_FAILED';
  throw error;
}

async function createWindow() {
  htmlFullscreenActive = false;
  windowFullscreenActive = false;
  startupCompleted = false;
  startupState = {
    pid: process.pid,
    runtimeName: APP_NAME,
    startedAt: Date.now(),
    phase: 'window-create-start',
    events: [],
  };

  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_WINDOWED_WIDTH,
    minHeight: MIN_WINDOWED_HEIGHT,
    show: false,
    frame: false,
    fullscreen: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      devTools: true,
    },
  });

  const win = mainWindow;
  writeStartupState('window-created', { windowCreatedAt: Date.now() });

  // Watchdog：即使 server 启动慢或 ready-to-show 不触发，3.5 秒后也强制显示窗口
  win.__mineradioStartupShowTimer = setTimeout(() => {
    if (!startupCompleted) showMainWindowSafely(win, 'watchdog');
  }, STARTUP_SHOW_WATCHDOG_MS);

  // 先加载闪屏，让窗口立刻有内容（server 还没起来时不白屏）
  const startupShell = path.join(__dirname, 'startup.html');
  if (fs.existsSync(startupShell)) {
    win.loadFile(startupShell).catch((error) => {
      if (!/ERR_ABORTED|ERR_FAILED/i.test(String(error && error.message || error))) {
        console.warn('[StartupWindow] startup shell skipped:', error.message || error);
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch (e) {}
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    sendWindowState(mainWindow);
    try { ensureUserPluginDir(); } catch (_) {}
  });

  // 首帧合成完成后才显示：透明窗口在未绘制状态下 show 会白屏（dom-ready 早于首帧）
  mainWindow.webContents.once('ready-to-show', () => {
    if (!startupCompleted) showMainWindowSafely(win, 'ready-to-show');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (!startupCompleted) {
      console.warn('[StartupWindow] did-fail-load:', errorCode, errorDescription, validatedURL || '');
      // 主页面导航失败会清掉当前帧（白窗），立即回填启动页保持深色
      if (String(errorCode).toUpperCase() !== 'ERR_ABORTED') {
        try { win.loadFile(startupShell).catch(() => {}); } catch (_) {}
      }
    }
  });

  // GPU / 渲染进程崩溃检测
  win.webContents.on('render-process-gone', (_event, details) => {
    const reason = (details && details.reason) || 'unknown';
    const exitCode = details && details.exitCode;
    console.error('[StartupWindow] render-process-gone:', reason, 'exitCode=', exitCode);
    if (!startupCompleted) {
      const error = new Error(`renderer process gone: ${reason} exitCode=${exitCode}`);
      writeStartupErrorLog('Renderer process gone', 'MR-BOOT-GPU', error);
    } else {
      // 启动完成后崩溃：立即整理内存 + 延迟重载页面恢复（针对 WebGL context loss 场景）
      // 落盘记录崩溃原因（console.error 重载后即丢失，无法事后诊断）
      writeStartupErrorLog(
        'Renderer crashed after startup (auto-reload)',
        'MR-RENDER-CRASH',
        new Error(`reason=${reason} exitCode=${exitCode}`)
      );
      appMemory.trimAppWorkingSets([process.pid]).catch(() => {});
      if (win && !win.isDestroyed()) {
        setTimeout(() => {
          try {
            if (win && !win.isDestroyed()) {
              win.webContents.reload();
            }
          } catch (_) {}
        }, 800);
      }
    }
  });

  win.on('unresponsive', () => {
    console.warn('[StartupWindow] main window unresponsive');
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && mainWindow.isFullScreen()) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
    // F12 或 Ctrl+Shift+I 打开 DevTools
    if (input.type === 'keyDown' && (input.code === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i')))) {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  mainWindow.once('ready-to-show', () => {
    showMainWindowSafely(win, 'ready-to-show');
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('close', (event) => {
    if (!appQuitting && closeBehavior === 'tray') {
      event.preventDefault();
      createOrUpdateTray();
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (typeof appMemory !== 'undefined' && appMemory && typeof appMemory.trimAppWorkingSets === 'function') {
          appMemory.trimAppWorkingSets([process.pid]).catch(() => {});
        }
        mainWindow.hide();
      }
    }
  });
  mainWindow.on('closed', () => {
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });

  // 等待本地 server 启动（含端口探测、cookie 加密、HTTP 探活）
  await ensureLocalServerStarted();

  // 重试加载主页面（最多 2 次，每次 15 秒超时）
  await loadMainWindowWithRetry(win);
  if (win.isDestroyed()) throw new Error('Main BrowserWindow was destroyed after navigation');

  startupCompleted = true;
  showMainWindowSafely(win, 'navigation-complete');
  writeStartupState('ready', { readyAt: Date.now(), port: mainServerPort });
}

// ========== 内存管理 IPC + 自动整理 ==========

let memoryAutoTimer = null;
let memoryAutoState = {
  enabled: true,
  intervalMs: 5 * 60 * 1000,   // 默认 5 分钟检查一次
  thresholdPercent: 78,         // 系统内存使用率超过 78% 时触发整理
  lastTrimAt: 0,
};

function startMemoryAutoTrim() {
  if (memoryAutoTimer) clearInterval(memoryAutoTimer);
  if (!memoryAutoState.enabled) return;
  memoryAutoTimer = setInterval(async () => {
    try {
      const snapshot = appMemory.getMemorySnapshot();
      if (snapshot.usedPercent >= memoryAutoState.thresholdPercent) {
        console.log(`[Memory] auto trim triggered: ${snapshot.usedPercent}% used`);
        await appMemory.trimAppWorkingSets([process.pid]);
        memoryAutoState.lastTrimAt = Date.now();
      }
    } catch (e) {
      console.warn('[Memory] auto trim failed:', e.message);
    }
  }, memoryAutoState.intervalMs);
  // 不阻塞退出
  if (memoryAutoTimer.unref) memoryAutoTimer.unref();
}

// 窗口创建成功后启动自动整理
startMemoryAutoTrim();

ipcMain.handle('mineradio-memory-get-snapshot', async () => {
  try {
    return { ok: true, ...appMemory.getMemorySnapshot() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-memory-trim-app', async (_event, pids) => {
  try {
    const result = await appMemory.trimAppWorkingSets(pids && Array.isArray(pids) ? pids : [process.pid]);
    memoryAutoState.lastTrimAt = Date.now();
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-memory-purge-system', async (_event, options) => {
  try {
    const opts = options || {};
    const result = await systemMemory.purgeSystemMemorySmart(systemMemory.MEMORY_MASK_DEFAULT, {
      manual: true,
      autoElevate: opts.autoElevate === true,
    });
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-memory-configure-auto', async (_event, config) => {
  try {
    if (config && typeof config.enabled === 'boolean') memoryAutoState.enabled = config.enabled;
    if (config && Number.isFinite(config.intervalMs) && config.intervalMs >= 60000) memoryAutoState.intervalMs = config.intervalMs;
    if (config && Number.isFinite(config.thresholdPercent) && config.thresholdPercent >= 50 && config.thresholdPercent <= 95) {
      memoryAutoState.thresholdPercent = config.thresholdPercent;
    }
    startMemoryAutoTrim();
    return { ok: true, ...memoryAutoState };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('mineradio-get-gpu-diagnostics', () => {
  return getGpuDiagnostics();
});

/* ===== 歌词缓存读写 ===== */
ipcMain.handle('mineradio-cache-read-lyric', async (_event, key) => {
  try {
    const file = lyricCacheFilePath(key);
    if (!fs.existsSync(file)) return { ok: true, hit: false };
    const stat = await fs.promises.stat(file);
    if (!stat || stat.size <= 0 || stat.size > LYRIC_CACHE_ENTRY_MAX_BYTES) return { ok: true, hit: false };
    const record = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    if (!record || record.version !== LYRIC_CACHE_VERSION || !record.payload || typeof record.payload !== 'object') return { ok: true, hit: false };
    fs.promises.utimes(file, new Date(), new Date()).catch(() => {});
    return { ok: true, hit: true, payload: record.payload, cachedAt: record.cachedAt || 0 };
  } catch (error) {
    return { ok: false, hit: false, error: error.message || 'LYRIC_CACHE_READ_FAILED' };
  }
});

ipcMain.handle('mineradio-cache-write-lyric', async (_event, key, payload) => {
  try {
    if (!key || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'INVALID_LYRIC_CACHE_PAYLOAD' };
    const record = { version: LYRIC_CACHE_VERSION, cachedAt: Date.now(), payload };
    const text = JSON.stringify(record);
    if (Buffer.byteLength(text, 'utf8') > LYRIC_CACHE_ENTRY_MAX_BYTES) return { ok: false, error: 'LYRIC_CACHE_ENTRY_TOO_LARGE' };
    await fs.promises.mkdir(cacheSettings.lyricsPath, { recursive: true });
    const file = lyricCacheFilePath(key);
    const temporary = `${file}.tmp`;
    await fs.promises.writeFile(temporary, text, 'utf8');
    await fs.promises.rename(temporary, file);
    pruneLyricCache().catch(() => {});
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'LYRIC_CACHE_WRITE_FAILED' };
  }
});

/* ===== 导出登录 Cookie（明文桌面备份，兼容旧入口） ===== */
ipcMain.handle('mineradio-export-login-cookie', async (_event, provider) => {
  try {
    const meta = loginCookieExportMeta(provider);
    if (!meta) return { ok: false, error: 'UNKNOWN_PROVIDER', message: '未知平台，无法导出登录 cookie' };
    const mapped = (meta.files || []).filter(Boolean);
    let text = '';
    let source = '';
    for (const file of mapped) {
      try {
        const value = secretStore.readSecretFile(file);
        if (value) {
          text = value;
          source = file;
          break;
        }
      } catch (_) {}
    }
    if (!text) return { ok: false, error: 'COOKIE_NOT_FOUND', message: `${meta.label} 当前没有可导出的登录 cookie` };
    const safeName = String(`${meta.label}_登录cookie.txt`).replace(/[\\/:*?"<>|]+/g, '-');
    const filePath = path.join(app.getPath('desktop'), safeName);
    fs.writeFileSync(filePath, text, 'utf8');
    return { ok: true, filePath, source };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_LOGIN_COOKIE_FAILED' };
  }
});

/* ===== 跨设备登录包（口令加密） ===== */
ipcMain.handle('mineradio-export-login-pack', async (event, payload = {}) => {
  try {
    const password = String(payload.password || '');
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const built = buildLoginPack({
      providers,
      password,
      loginCookieExportMeta,
      secretStore,
    });
    if (!built.ok) return built;
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win || undefined, {
      title: '导出 Mineradio 登录包',
      defaultPath: path.join(app.getPath('desktop'), `Mineradio登录包_${new Date().toISOString().slice(0, 10)}.mineradio-login`),
      filters: [{ name: 'Mineradio Login Pack', extensions: ['mineradio-login'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(built.envelope, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath, providers: built.providers };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_LOGIN_PACK_FAILED' };
  }
});

ipcMain.handle('mineradio-import-login-pack', async (event, payload = {}) => {
  try {
    const password = String(payload.password || '');
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win || undefined, {
      title: '导入 Mineradio 登录包',
      properties: ['openFile'],
      filters: [{ name: 'Mineradio Login Pack', extensions: ['mineradio-login', 'json'] }],
    });
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { ok: false, cancelled: true };
    const raw = fs.readFileSync(picked.filePaths[0], 'utf8');
    const envelope = JSON.parse(raw);
    const applied = applyLoginPack({
      envelope,
      password,
      loginCookieExportMeta,
      secretStore,
    });
    if (!applied.ok) return applied;
    return { ok: true, providers: applied.providers, filePath: picked.filePaths[0] };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_LOGIN_PACK_FAILED', message: e.message || '导入失败' };
  }
});

ipcMain.handle('mineradio-login-pack-qr-start', async (_event, payload = {}) => {
  try {
    const password = String(payload.password || '');
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const built = buildLoginPack({
      providers,
      password,
      loginCookieExportMeta,
      secretStore,
    });
    if (!built.ok) return built;
    return await startLoginPackQrSession({
      envelope: built.envelope,
      ttlMs: payload.ttlMs,
    });
  } catch (e) {
    return { ok: false, error: e.message || 'LOGIN_PACK_QR_START_FAILED', message: e.message || '二维码同步启动失败' };
  }
});

ipcMain.handle('mineradio-login-pack-qr-stop', async () => {
  try {
    return stopLoginPackQrSession();
  } catch (e) {
    return { ok: false, error: e.message || 'LOGIN_PACK_QR_STOP_FAILED' };
  }
});

ipcMain.handle('mineradio-login-pack-qr-import', async (_event, payload = {}) => {
  try {
    const password = String(payload.password || '');
    const url = String(payload.url || '');
    const fetched = await fetchLoginPackEnvelopeFromUrl(url);
    if (!fetched.ok) return fetched;
    const applied = applyLoginPack({
      envelope: fetched.envelope,
      password,
      loginCookieExportMeta,
      secretStore,
    });
    if (!applied.ok) return applied;
    return { ok: true, providers: applied.providers, url };
  } catch (e) {
    return { ok: false, error: e.message || 'LOGIN_PACK_QR_IMPORT_FAILED', message: e.message || '二维码导入失败' };
  }
});

ipcMain.handle('mineradio-liquidglass-plugins-list', async () => {
  try {
    ensureUserPluginDir();
    return { ok: true, plugins: readLiquidGlassPluginScripts() };
  } catch (e) {
    return { ok: false, error: e.message || 'LIQUIDGLASS_PLUGIN_LIST_FAILED', plugins: [] };
  }
});

/* ===== FX 自动保存 ===== */
ipcMain.on('mineradio-current-fx-autosave-read-sync', (event) => {
  if (!isTrustedMainWindowIpc(event)) return;
  const payload = readCurrentFxAutosaveFile();
  if (payload && event && event.sender && !event.sender.isDestroyed()) {
    event.sender.send('mineradio-current-fx-autosave-loaded', payload);
  }
});

ipcMain.on('mineradio-current-fx-autosave-save-sync', (event, payload) => {
  if (!isTrustedMainWindowIpc(event)) return;
  writeCurrentFxAutosaveFile(payload);
});

ipcMain.handle('mineradio-current-fx-autosave-save', async (_event, payload = {}) => {
  return writeCurrentFxAutosaveFile(payload);
});

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
// 缓存目录可配置：默认根目录 = userData/cache (不改变现有行为，仅提供配置能力)
cacheSettings = ensureCacheDirectories(readCacheSettings());
// 关键：必须在 setPath('cache') 之前保存真实 appData。
// Electron 的 setPath('cache', X) 会把 app.getPath('appData') 也改成 X，导致 app.getPath('userData')
// 变成 X/Mineradio（即 chromium 缓存目录）。cookie 写到那里会被 Chromium 清理，登录状态丢失。
const _REAL_APP_DATA = app.getPath('appData');
try { app.setPath('cache', cacheSettings.chromiumPath); } catch (_) {}
try { process.env.MINERADIO_BEAT_CACHE_DIR = cacheSettings.beatmapsPath; } catch (_) {}
try { process.env.MINERADIO_NATIVE_TEMP_DIR = cacheSettings.nativePath; } catch (_) {}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  writeStartupState('module-loaded', { runtimeName: APP_NAME });

  // 初始化 Login Easter Egg Gate
  const userDataPath = app.getPath('userData');
  loginEasterEggGate = new LoginEasterEggGate({
    userDataPath,
    credentialRoots: () => [
      (() => { try { return app.getPath('sessionData'); } catch (_) { return ''; } })(),
      userDataPath,
      path.join(__dirname, '..'),
    ],
  });

  // 初始化 Wallpaper Engine Library
  wallpaperEngineLibrary = new WallpaperEngineLibrary({ userDataPath });

  // 初始化 Wallpaper Engine Runtime
  const nativeTempPath = (cacheSettings && cacheSettings.nativePath) || path.join(userDataPath, 'cache', 'native-helper-temp');
  try { fs.mkdirSync(nativeTempPath, { recursive: true }); } catch (_) {}
  wallpaperEngineRuntime = new WallpaperEngineRuntime({
    library: wallpaperEngineLibrary,
    desktopCapturer,
    hostElevationProbe: systemMemory.probeProcessElevation ? () => systemMemory.probeProcessElevation().catch(() => false) : () => Promise.resolve(false),
    nativeTempPath,
  });

  // 初始化 Full Desktop Mode Runtime
  fullDesktopModeRuntime = new FullDesktopModeRuntime({
    screen,
    platform: process.platform,
    execFileImpl: execFile,
    nativeTempPath,
    requestReconcile: () => {},
    onStatus: (status) => broadcastDesktopWallpaperStatus(status),
  });

  app.on('second-instance', () => {
    if (startupCompleted && focusMainWindow()) return;
    app.whenReady().then(() => createWindow()).then(() => focusMainWindow())
      .catch((e) => reportWindowCreationFailure('Second instance', e));
  });

  app.whenReady().then(async () => {
    const handleDisplayLayoutChanged = () => {
      positionDesktopLyricsWindow();
      positionWallpaperWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        ensureMainWindowInsideDisplay(mainWindow);
      }
      scheduleWindowStateSend(mainWindow);
    };
    screen.on('display-metrics-changed', handleDisplayLayoutChanged);
    screen.on('display-added', handleDisplayLayoutChanged);
    screen.on('display-removed', handleDisplayLayoutChanged);
    await createWindow();
  }).catch((e) => reportWindowCreationFailure('Main', e));

  app.on('activate', () => {
    if (startupCompleted && focusMainWindow()) return;
    createWindow().then(() => focusMainWindow()).catch((e) => reportWindowCreationFailure('Activate', e));
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    appQuitting = true;
    clearWallpaperEngineCaptureGrant();
    if (wallpaperEngineLibrary && typeof wallpaperEngineLibrary.dispose === 'function') {
      try { wallpaperEngineLibrary.dispose(); } catch (_) {}
    }
    unregisterMineradioGlobalHotkeys();
    closeOverlayWindows();
    destroyTray();
    if (localServer && localServer.close) localServer.close();
  });
}
