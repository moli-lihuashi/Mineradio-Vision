const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  openQQMusicLogin: (options) => ipcRenderer.invoke('qq-music-open-login', options || {}),
  clearQQMusicLogin: () => ipcRenderer.invoke('qq-music-clear-login'),
  openKugouMusicLogin: () => ipcRenderer.invoke('kugou-music-open-login'),
  clearKugouMusicLogin: () => ipcRenderer.invoke('kugou-music-clear-login'),
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
  setBackgroundThrottling: (enabled) => ipcRenderer.invoke('mineradio-set-background-throttling', !!enabled),
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
  // 内置歌单库（Mineradio 本机歌单，可混存五个平台的歌曲）
  listBuiltInPlaylists: () => ipcRenderer.invoke('mineradio-built-in-playlists-list'),
  readBuiltInPlaylist: (id, options) => ipcRenderer.invoke('mineradio-built-in-playlist-page', String(id || ''), options || {}),
  createBuiltInPlaylist: (name) => ipcRenderer.invoke('mineradio-built-in-playlist-create', String(name || '')),
  renameBuiltInPlaylist: (id, name) => ipcRenderer.invoke('mineradio-built-in-playlist-rename', String(id || ''), String(name || '')),
  deleteBuiltInPlaylist: (id) => ipcRenderer.invoke('mineradio-built-in-playlist-delete', String(id || '')),
  addBuiltInPlaylistTrack: (id, track) => ipcRenderer.invoke('mineradio-built-in-playlist-add-track', String(id || ''), track || {}),
  removeBuiltInPlaylistTrack: (id, index) => ipcRenderer.invoke('mineradio-built-in-playlist-remove-track', String(id || ''), Number(index)),
  reorderBuiltInPlaylistTrack: (id, fromIndex, toIndex) => ipcRenderer.invoke('mineradio-built-in-playlist-reorder-track', String(id || ''), Number(fromIndex), Number(toIndex)),
  // 本地音乐库（用户主动导入的音频，经 mineradio-local:// 播放）
  listLocalMusicLibrary: () => ipcRenderer.invoke('mineradio-local-library-list'),
  readLocalMusicLyric: (localFileId) => ipcRenderer.invoke('mineradio-local-library-lyric', String(localFileId || '')),
  importLocalMusicFiles: async (files) => {
    const entries = [];
    for (const file of Array.from(files || [])) {
      let filePath = '';
      try {
        filePath = webUtils && typeof webUtils.getPathForFile === 'function' ? webUtils.getPathForFile(file) : '';
      } catch (_) {}
      if (!filePath) continue;
      entries.push({
        path: filePath,
        relativePath: String((file && (file.webkitRelativePath || file.name)) || ''),
      });
    }
    if (!entries.length) return { ok: false, count: 0, tracks: [], error: 'NO_AUTHORIZED_LOCAL_AUDIO' };
    const authorization = await ipcRenderer.invoke('mineradio-local-library-authorize', { files: entries });
    if (!authorization || authorization.ok !== true || !authorization.token) return authorization;
    return ipcRenderer.invoke('mineradio-local-library-import', { token: authorization.token });
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
