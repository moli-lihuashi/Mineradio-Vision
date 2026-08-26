const { contextBridge, ipcRenderer } = require('electron');

let cachedApiToken = '';
const apiTokenReady = ipcRenderer.invoke('mineradio-get-api-token').then((token) => {
  cachedApiToken = String(token || '');
  return cachedApiToken;
}).catch(() => '');

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  getApiToken: () => cachedApiToken,
  fetchApiToken: () => apiTokenReady,
  minimize: () => ipcRenderer.invoke('desktop-window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop-window-toggle-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop-window-toggle-fullscreen'),
  exitFullscreenWindowed: () => ipcRenderer.invoke('desktop-window-exit-fullscreen-windowed'),
  getState: () => ipcRenderer.invoke('desktop-window-get-state'),
  close: (behavior) => ipcRenderer.invoke('desktop-window-close', behavior),
  getCloseBehavior: () => ipcRenderer.invoke('desktop-window-get-close-behavior'),
  setCloseBehavior: (behavior) => ipcRenderer.invoke('desktop-window-set-close-behavior', behavior),
  openNeteaseMusicLogin: () => ipcRenderer.invoke('netease-music-open-login'),
  clearNeteaseMusicLogin: () => ipcRenderer.invoke('netease-music-clear-login'),
  openQQMusicLogin: () => ipcRenderer.invoke('qq-music-open-login'),
  clearQQMusicLogin: () => ipcRenderer.invoke('qq-music-clear-login'),
  openKugouMusicLogin: () => ipcRenderer.invoke('kugou-music-open-login'),
  clearKugouMusicLogin: () => ipcRenderer.invoke('kugou-music-clear-login'),
  openQishuiMusicLogin: () => ipcRenderer.invoke('qishui-music-open-login'),
  clearQishuiMusicLogin: () => ipcRenderer.invoke('qishui-music-clear-login'),
  openSpotifyMusicLogin: () => ipcRenderer.invoke('spotify-music-open-login'),
  clearSpotifyMusicLogin: () => ipcRenderer.invoke('spotify-music-clear-login'),
  exportLoginCookie: (provider) => ipcRenderer.invoke('mineradio-export-login-cookie', provider),
  exportLoginSessionPack: (payload) => ipcRenderer.invoke('mineradio-export-login-pack', payload || {}),
  importLoginSessionPack: (payload) => ipcRenderer.invoke('mineradio-import-login-pack', payload || {}),
  startLoginPackQrSync: (payload) => ipcRenderer.invoke('mineradio-login-pack-qr-start', payload || {}),
  stopLoginPackQrSync: () => ipcRenderer.invoke('mineradio-login-pack-qr-stop'),
  importLoginPackFromQrUrl: (payload) => ipcRenderer.invoke('mineradio-login-pack-qr-import', payload || {}),
  listLiquidGlassPlugins: () => ipcRenderer.invoke('mineradio-liquidglass-plugins-list'),
  readLyricCache: (key) => ipcRenderer.invoke('mineradio-cache-read-lyric', key),
  writeLyricCache: (key, payload) => ipcRenderer.invoke('mineradio-cache-write-lyric', key, payload),
  openUpdateInstaller: (filePath) => ipcRenderer.invoke('mineradio-open-update-installer', filePath),
  restartApp: () => ipcRenderer.invoke('mineradio-restart-app'),
  configureGlobalHotkeys: (bindings) => ipcRenderer.invoke('mineradio-hotkeys-configure-global', bindings || []),
  exportJsonFile: (payload) => ipcRenderer.invoke('mineradio-export-json-file', payload || {}),
  importJsonFile: () => ipcRenderer.invoke('mineradio-import-json-file'),
  onGlobalHotkey: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-global-hotkey', listener);
    return () => ipcRenderer.removeListener('mineradio-global-hotkey', listener);
  },
  setDesktopLyricsEnabled: (enabled, payload) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-enabled', !!enabled, payload || {}),
  updateDesktopLyrics: (payload) => ipcRenderer.invoke('mineradio-desktop-lyrics-update', payload || {}),
  onDesktopLyricsLockState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-lock-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-lock-state', listener);
  },
  onDesktopLyricsEnabledState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-enabled-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-enabled-state', listener);
  },
  listWallpaperEngineProjects: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-list', payload || {}),
  getWallpaperEngineProjectDetails: (id) => ipcRenderer.invoke('mineradio-wallpaper-engine-project-details', String(id || '')),
  openWallpaperEngineProjectDetails: (id, target) => ipcRenderer.invoke('mineradio-wallpaper-engine-open-project-details', {
    id: String(id || ''),
    target: target === 'workshop' ? 'workshop' : 'we',
  }),
  chooseWallpaperEngineDirectory: () => ipcRenderer.invoke('mineradio-wallpaper-engine-choose-directory'),
  chooseWallpaperEngineProjectFile: () => ipcRenderer.invoke('mineradio-wallpaper-engine-choose-project-file'),
  removeWallpaperEngineDirectory: (rootId) => ipcRenderer.invoke('mineradio-wallpaper-engine-remove-directory', String(rootId || '')),
  getWallpaperEngineRuntimeStatus: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-runtime-status', payload || {}),
  startWallpaperEngineScene: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-start-scene', payload || {}),
  stopWallpaperEngineScene: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-stop-scene', payload || {}),
  onWallpaperEngineHostBoundsChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-wallpaper-engine-host-bounds-changed', listener);
    return () => ipcRenderer.removeListener('mineradio-wallpaper-engine-host-bounds-changed', listener);
  },
  setWallpaperMode: (enabled, payload) => ipcRenderer.invoke('mineradio-wallpaper-set-enabled', !!enabled, payload || {}),
  updateWallpaperMode: (payload) => ipcRenderer.invoke('mineradio-wallpaper-update', payload || {}),
  // 内存管理
  getMemorySnapshot: () => ipcRenderer.invoke('mineradio-memory-get-snapshot'),
  trimAppMemory: (pids) => ipcRenderer.invoke('mineradio-memory-trim-app', pids),
  purgeSystemMemory: (options) => ipcRenderer.invoke('mineradio-memory-purge-system', options || {}),
  configureMemoryAuto: (config) => ipcRenderer.invoke('mineradio-memory-configure-auto', config || {}),
  // 缓存目录可配置
  getCacheSettings: () => ipcRenderer.invoke('mineradio-cache-get-settings'),
  chooseCacheDirectory: () => ipcRenderer.invoke('mineradio-cache-choose-directory'),
  setCacheSettings: (payload) => ipcRenderer.invoke('mineradio-cache-set-settings', payload || {}),
  // 阶段 3A：可选 WASAPI 共享输出（默认关；PCM 由渲染进程旁路推送）
  wasapiAvailable: () => ipcRenderer.invoke('mineradio-wasapi-available'),
  wasapiStatus: () => ipcRenderer.invoke('mineradio-wasapi-status'),
  wasapiOpen: (payload) => ipcRenderer.invoke('mineradio-wasapi-open', payload || {}),
  wasapiClose: () => ipcRenderer.invoke('mineradio-wasapi-close'),
  wasapiSetVolume: (volume) => ipcRenderer.invoke('mineradio-wasapi-set-volume', volume),
  wasapiWrite: (float32Interleaved) => {
    try { ipcRenderer.send('mineradio-wasapi-write', float32Interleaved); } catch (_) {}
  },
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-window-state', listener);
    return () => ipcRenderer.removeListener('desktop-window-state', listener);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
});
