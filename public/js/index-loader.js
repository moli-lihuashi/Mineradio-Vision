'use strict';

(function loadMineradioIndexModules() {
  // cache-bust 策略：优先用 <html data-app-version="3.2.12"> 的版本号，生产态模块可长缓存。
  // 开发态强制破缓存：URL 加 ?nocache 或 localStorage 设 mineradio_nocache=1。
  var forceRefresh = (typeof window !== 'undefined' && window.location && window.location.search && window.location.search.indexOf('nocache') >= 0) ||
                     (typeof localStorage !== 'undefined' && localStorage.getItem('mineradio_nocache') === '1');
  var appVersion = (document.documentElement && document.documentElement.getAttribute('data-app-version')) || '';
  var moduleCacheBust = forceRefresh ? String(Date.now()) : (appVersion || String(Date.now()));
  // 版本未改时开发者常踩缓存：URL 带 hotfix=1 也强制破缓存
  try {
    if (typeof window !== 'undefined' && window.location && /(?:\?|&)hotfix=1\b/.test(window.location.search || '')) {
      moduleCacheBust = String(Date.now());
    }
  } catch (_) {}

  // row-layers：3.2.11 Step D 默开（完成 Hold/A/B/C 后）。一次性 force_3210 清掉 force_326 留下的 '0'。
  // ?lyricRows=0 / localStorage=0 / eco 可退 legacy；legacy 10+10c 始终加载。
  function lyricRowLayersBootEnabled() {
    try {
      if (typeof localStorage !== 'undefined') {
        if (localStorage.getItem('mineradio_lyric_row_layers_force_3210') !== '1') {
          localStorage.setItem('mineradio_lyric_row_layers', '1');
          localStorage.setItem('mineradio_lyric_row_layers_force_3210', '1');
          localStorage.removeItem('mineradio_lyric_row_layers_force_326');
          localStorage.removeItem('mineradio_lyric_row_layers_force_325');
          localStorage.removeItem('mineradio_lyric_row_layers_force_322');
        }
        var stored = localStorage.getItem('mineradio_lyric_row_layers');
        if (stored === '0' || stored === 'false') return false;
        if (stored === '1' || stored === 'true') return true;
      }
    } catch (_) {}
    try {
      var q = (typeof window !== 'undefined' && window.location && window.location.search) || '';
      if (q.indexOf('lyricRows=0') >= 0) return false;
      if (q.indexOf('lyricRows=1') >= 0) return true;
    } catch (_) {}
    return true;
  }
  var enableLyricRowLayersBoot = lyricRowLayersBootEnabled();

  // 主应用模块：按领域细拆后的加载顺序（classic 全局作用域）。
  // 并行 fetch 缩短等待；合并为【单个】script 求值，保留跨文件 function 提升（分块求值会打断 hoisting）。
  // 变量名 modulePaths 供 scripts/quick-check.js 的 parseCombinedIndexModules 解析。
  const modulePaths = [
    'js/modules/00-state/00-debug-gate.js',
    'js/modules/00-state/12a-audio-login-globals.js',
    'js/modules/00-state/12b-playlist-queue-globals.js',
    'js/modules/00-state/12c-preference-diy-globals.js',
    'js/modules/00-state/12d-fx-runtime-globals.js',
    'js/modules/00-state/09-performance-probe.js',
    'js/modules/00-state/10-frame-scheduler.js',
    'js/modules/00-state/14-motion-system.js',
    // scene
    'js/modules/01-scene/00-renderer-quality.js',
    'js/modules/01-scene/01-orbit-free-camera.js',
    'js/modules/01-scene/02-beat-camera-runtime.js',
    'js/modules/01-scene/03-focus-cinema-camera.js',
    'js/modules/01-scene/04-bottom-controls-cursor.js',
    'js/modules/01-scene/01-gpu-throttle.js',
    // visual
    'js/modules/02-visual/00a-pointer-interaction.js',
    'js/modules/02-visual/00b-cover-texture.js',
    'js/modules/02-visual/00c-particle-system.js',
    'js/modules/02-visual/01-ripple-classic-float.js',
    'js/modules/02-visual/02-sonic-backcover.js',
    'js/modules/02-visual/03a-lyrics-state.js',
    'js/modules/02-visual/03b-lyrics-color-utils.js',
    'js/modules/02-visual/03c-lyrics-layout-settings.js',
    'js/modules/02-visual/05-lyrics-fonts-texture.js',
    'js/modules/02-visual/06-lyric-measure-colorlab.js',
    'js/modules/02-visual/07-lyrics-palette-three.js',
    // P1：legacy mask 始终在；row 栈可选；10c 适配器统一分发
    'js/modules/02-visual/10-lyrics-mask-shaders.js',
  ].concat(enableLyricRowLayersBoot ? [
    'js/modules/02-visual/08-lyrics-display-modes.js',
    'js/modules/02-visual/09-lyrics-payloads.js',
    'js/modules/02-visual/10b-lyrics-mask-textures.js',
    'js/modules/02-visual/11-lyrics-shaders.js',
    'js/modules/02-visual/12-lyrics-row-layers.js',
    'js/modules/02-visual/13-lyrics-mesh-build.js',
  ] : []).concat([
    'js/modules/02-visual/10c-lyrics-mask-adapter.js',
    'js/modules/02-visual/14-stage-lyrics-rendering.js',
  ]).concat(enableLyricRowLayersBoot ? [
    'js/modules/02-visual/14b-stage-lyric-track.js',
    // P2：resident ensure/trim + reveal-ready + warmup（在 14 之后覆盖 stub initialize）
    'js/modules/02-visual/14c-stage-lyric-resident.js',
    // Step A：demand-prewarm + noSyncBuild helpers
    'js/modules/02-visual/14d-stage-lyric-prewarm.js',
  ] : []).concat([
    // beat
    'js/modules/03-beat/00-ripples.js',
    'js/modules/03-beat/05-cover-depth.js',
    'js/modules/03-beat/00-tempo-worker-cache-prefetch.js',
    'js/modules/03-beat/01-audio-beat-analysis.js',
    'js/modules/03-beat/02-podcast-dj-analysis.js',
    'js/modules/03-beat/03-beat-map-runtime.js',
    'js/modules/03-beat/04-cover-loading-crop.js',
    'js/modules/03-beat/06-sonic-audio-monitor.js',
    'js/modules/03-beat/08-audio-worklet-bridge.js',
    'js/modules/03-beat/09-wasapi-output-bridge.js',
    // shelf
    'js/modules/04-shelf/00a-shelf-layout-profile.js',
    'js/modules/04-shelf/00b-shelf-hover-cue.js',
    'js/modules/04-shelf/00c-shelf-manager.js',
    'js/modules/04-shelf/02-rebuild-panel-sync.js',
    'js/modules/04-shelf/03-content-list-manager.js',
    'js/modules/04-shelf/05-card-interactions.js',
    'js/modules/04-shelf/06-keyboard-camera-events.js',
    // playback
    'js/modules/05-playback/00a-api-quality.js',
    'js/modules/05-playback/00b-mood-sleep-timer.js',
    'js/modules/05-playback/00c-home-session.js',
    'js/modules/05-playback/01-music-provider-registry.js',
    'js/modules/05-playback/01-cover-listen-helpers.js',
    'js/modules/05-playback/03-home-discover-weather.js',
    'js/modules/05-playback/03a-home-dashboard.js',
    'js/modules/05-playback/03b-home-insight.js',
    'js/modules/05-playback/03c-home-hero-grid.js',
    'js/modules/05-playback/03d-home-ai-playlist.js',
    'js/modules/05-playback/04-home-empty-wallpaper.js',
    'js/modules/05-playback/05-home-actions.js',
    'js/modules/05-playback/05-home-track-detail.js',
    'js/modules/05-playback/06a-lyric-display-mode.js',
    'js/modules/05-playback/06b-startup-autoplay-timing.js',
    'js/modules/05-playback/06c-account-actions.js',
    'js/modules/05-playback/07-search.js',
    'js/modules/05-playback/08-audio-graph-controls.js',
    'js/modules/05-playback/09a-queue-ops.js',
    'js/modules/05-playback/09b-playback-core.js',
    'js/modules/05-playback/11-provider-fallback.js',
    'js/modules/05-playback/09c-control-glass.js',
    'js/modules/05-playback/09d-playback-stall-recovery.js',
    'js/modules/05-playback/10-queue-content-fingerprint.js',
    // lyrics / playlists
    'js/modules/06-lyrics/00-lyrics-fetch-parse.js',
    'js/modules/06-lyrics/01-playlist-panel-shell.js',
    'js/modules/06-lyrics/02-playlist-detail.js',
    'js/modules/06-lyrics/03-podcast-playlist-loaders.js',
    'js/modules/06-lyrics/04-progress-seek.js',
    'js/modules/06-lyrics/05-upload-dragdrop.js',
    // fx
    'js/modules/07-fx/06-hotkeys.js',
    'js/modules/07-fx/00-preset-archive-data.js',
    'js/modules/07-fx/01-lyric-color-accent.js',
    'js/modules/07-fx/04-preset-grid-uniforms.js',
    'js/modules/07-fx/05a-fx-panel-inputs.js',
    'js/modules/07-fx/05b-fx-panel-layout.js',
    'js/modules/07-fx/05c-fx-particle-fire.js',
    'js/modules/07-fx/07-bindings-shelf-immersive.js',
    'js/modules/07-fx/08-cache-storage-settings.js',
    'js/modules/07-fx/09-lyric-shader-market.js',
    'js/modules/07-fx/11-system-memory-controls.js',
    // account
    'js/modules/08-account/00-update-preview.js',
    'js/modules/08-account/02-qishui-login.js',
    'js/modules/08-account/01-login-modal-utils.js',
    'js/modules/08-account/03-login-modal-flows.js',
    'js/modules/08-account/04-user-modal-logout.js',
    'js/modules/08-account/08-login-pack-qr-sync.js',
    'js/modules/08-account/05-startup-idle-guide.js',
    'js/modules/08-account/06-toast.js',
    'js/modules/08-account/07-dynamic-libs.js',
    // shell：overlay 须在 splash-and-boot 之前（boot 会同步调用 applyDesktopLyricsState 等）
    'js/modules/10-shell/00-gesture-resize-ui.js',
    'js/modules/10-shell/04-desktop-overlay-fullscreen.js',
    'js/modules/10-shell/01-splash-and-boot.js',
    'js/modules/11-main-loop.js',
    // 延迟初始化
    'js/modules/06-fx/01-liquidglass-config.js',
    'js/modules/06-fx/02-wallpaper-engine-fns.js',
    'js/modules/06-fx/03-liquidglass-perf.js',
    'js/modules/06-fx/04-liquidglass-plugin-api.js',
    'js/modules/07-playback/00-spotify-provider.js',
    'js/modules/08-account/00-login-easter-egg.js'
  ]);

  try {
    if (document.documentElement) document.documentElement.classList.add('splash-active');
    if (document.body) document.body.classList.add('splash-active');
  } catch (_) {}

  function moduleUrl(path) {
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'v=' + moduleCacheBust;
  }

  function fetchModuleText(path) {
    // 生产态（版本号 cache-bust）允许浏览器缓存；开发态（强制刷新）禁用缓存。
    return fetch(moduleUrl(path), { credentials: 'same-origin', cache: forceRefresh ? 'no-cache' : 'default' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load Mineradio module: ' + path + ' (' + res.status + ')');
      return res.text();
    });
  }

  function readModuleSync(path) {
    var request = new XMLHttpRequest();
    request.open('GET', moduleUrl(path), false);
    request.send(null);
    if ((request.status < 200 || request.status >= 300) && request.status !== 0) {
      throw new Error('Failed to load Mineradio module: ' + path + ' (' + request.status + ')');
    }
    return request.responseText || '';
  }

  // 每模块前注入 sourceURL，DevTools Sources 可定位到原始模块文件而非合并后的大文件。
  function wrapModuleText(path, text) {
    return '//# sourceURL=mineradio-' + path + '\n' + text;
  }

  function injectCombined(texts) {
    var script = document.createElement('script');
    script.text = texts.join('\n') + '\n//# sourceURL=mineradio-index-modules.js\n';
    var anchor = document.currentScript;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(script, anchor.nextSibling);
    } else {
      (document.head || document.documentElement).appendChild(script);
    }
  }

  function showLoaderFailure(err) {
    console.error('[MineradioLoader]', err);
    try {
      var fallback = document.createElement('div');
      fallback.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#fff;font:14px/1.5 sans-serif;padding:24px;text-align:center;white-space:pre-wrap';
      var detail = (err && (err.message || String(err))) || 'unknown';
      fallback.textContent = '模块加载失败，请重启应用。\n' + detail;
      document.documentElement.appendChild(fallback);
    } catch (_) {}
  }

  // 优先并行 fetch；失败时回退同步 XHR。无论哪种路径都合并为单个 script，避免分块打断 function 提升。
  if (typeof fetch === 'function' && typeof Promise !== 'undefined') {
    Promise.all(modulePaths.map(function (path) {
      return fetchModuleText(path).then(function (text) { return wrapModuleText(path, text); });
    })).then(injectCombined).catch(function (err) {
      try {
        injectCombined(modulePaths.map(function (path) { return wrapModuleText(path, readModuleSync(path)); }));
      } catch (fallbackErr) {
        showLoaderFailure(fallbackErr || err);
      }
    });
  } else {
    try {
      injectCombined(modulePaths.map(function (path) { return wrapModuleText(path, readModuleSync(path)); }));
    } catch (err) {
      showLoaderFailure(err);
    }
  }
})();
