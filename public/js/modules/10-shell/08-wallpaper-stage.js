/* 桌面效果层（壁纸模式）呈现层 —— 2026-11-21 重写
 *
 * 结构变了，这个模块的职责也变了：
 *   以前：主窗口被挂进 WorkerW，这个模块负责把播放器 chrome 藏掉、把画布铺满；
 *   现在：主窗口不动，效果是**另一张透明窗口**（desktop/desktop-stage-window.js）
 *         加载同一份 index.html（?stage=1）。这个模块只在效果层里生效，
 *         维持两个 class 给 wallpaper-stage.css 用。
 *
 * 用户定案（2026-11-21）：
 *   - 原世界只要粒子和歌词，不显示内置壁纸（要和用户自己的 Wallpaper Engine 共生）；
 *   - Folia 世界只要歌词，Folia 自己的背景壳层一并摘掉；
 *   - 取消双击 Esc 退出：效果层没有可聚焦表面，退出就是再点一次播放器里的开关。
 *
 * 判据只有两个事实：
 *   html.wp-stage（首帧闸门，index.html head 内联脚本按 ?stage=1 打上）
 *   foliaWorldActive()（是否在 Folia 世界，由 12-folia 维护）
 * 推出来的 body.wallpaper-stage / body.wallpaper-stage-folia 供 CSS 使用；
 * 真正的隐藏规则全在 css/10-shell/wallpaper-stage.css，JS 里不写 style.display。
 */
(function (global) {
  'use strict';

  /* 与 css/10-shell/wallpaper-stage.css 的隐藏清单镜像。测试会逐条比对两边，
   * 防止只改一边（见 tests/wallpaper-stage.test.js）。 */
  var WALLPAPER_STAGE_CHROME_SELECTORS = [
    '#desktop-titlebar',
    '#fullscreen-diy-zone',
    '#search-area',
    '#upload-actions',
    '#empty-home',
    '#home-platform-recommend',
    '#top-right',
    '#player-quick-menu-popover',
    '#skin-popover',
    '#mini-queue-popover',
    '#fx-fab',
    '#fx-fab-hide-btn',
    '#fx-panel',
    '#playlist-panel',
    '#trial-banner',
    '#ai-depth-chip',
    '#beat-chip',
    '#cover-color-pop',
    '#color-lab-pop',
    '#control-source-switcher',
    '#lyric-timing-popover',
    '#cookie-export-prompt',
    '#classic-player',
    '#gesture-hud',
    '#hand-canvas',
    '#thumb-wrap',
    '#bottom-handle',
    '#bottom-bar',
    '#free-camera-hint',
    '#hint',
    '#loading-overlay',
    '#login-guide-canvas',
    '#cuefield-feedback',
    '#source-fallback-notice',
    '#visual-guide',
    '#break-reminder',
    '#desktop-mode-control-dock',
    '#drop-overlay',
    '#splash',
    '.modal-mask',
    '.quality-popover',
    '.volume-popover',
    '.player-quick-menu',
    '.skin-popover-panel'
  ];

  /* 两个世界都要摘掉的「背景层」：内置壁纸、封面模糊底、泛光/过渡遮罩。
   * 保留的只有 three 画布（粒子）与 #stage-lyrics。 */
  var WALLPAPER_STAGE_BACKDROP_LAYERS = [
    '#custom-bg',
    '#album-bg',
    '#album-bg-next',
    '#beat-glow-overlay',
    '#preset-transition-overlay',
    '#interlude-wave-canvas',
    '#idle-guide-canvas',
    '#sonic-topography-frame',
    '#wallpaper-engine-layer',
    '#wallpaper-engine-glass-mirror'
  ];

  /* Folia 世界里额外要摘掉的「原生舞台」层（Folia 自己画歌词）。 */
  var WALLPAPER_STAGE_NATIVE_LAYERS = [
    '#canvas-container',
    '#stage-lyrics'
  ];

  var wallpaperStageObserver = null;
  var wallpaperStageSyncing = false;
  var wallpaperStageLastSignature = '';

  /* 效果层页面标记：head 内联脚本在模块求值前就写好了（?stage=1）。
   * 主窗口永远为 false —— 主窗口不再进入舞台态。 */
  function wallpaperStagePage() {
    return !!(global.__MINERADIO_STAGE_PAGE__ || (typeof document !== 'undefined'
      && document.documentElement && document.documentElement.classList.contains('wp-stage')));
  }

  function wallpaperStageRoot() {
    return typeof document !== 'undefined' ? document.documentElement : null;
  }

  function wallpaperStageBody() {
    return typeof document !== 'undefined' ? document.body : null;
  }

  /* 当前是哪个世界。用 foliaWorldActive()（真在渲染）而不是 wantActive：
   * 存档里「想开」但实例没建起来时，画面其实还是原生的。
   * 函数不在（延迟波还没注入）时退回 body 上的 folia-world-active。 */
  function wallpaperStageWorld() {
    if (typeof foliaWorldActive === 'function') {
      try { return foliaWorldActive() ? 'folia' : 'native'; } catch (_) {}
    }
    var body = wallpaperStageBody();
    if (body && body.classList.contains('folia-world-active')) return 'folia';
    return 'native';
  }

  function wallpaperStageOnly() {
    return wallpaperStagePage();
  }

  /* 玻璃镜像画布：效果层里必须真的关掉。
   *
   * 它是一张把合成结果回读进 canvas 的快照（LiquidGlass 用它做 backdrop-filter 采样），
   * 全屏 fixed、z-index 0、pointer-events:none。桌面上的表现就是一块「上次界面的半透明
   * 卡片」（实测是「我的歌单 / 汽水推荐」），而且它 z-index 在画布下面，粒子压不住。
   * 它每次玻璃重建都会把 display 改回去，所以这里用内联 !important 再压一次，
   * 退出时把内联值清干净（不清的话玻璃效果在普通模式里就废了）。 */
  var WALLPAPER_STAGE_MIRROR_ID = 'wallpaper-engine-glass-mirror';

  function applyWallpaperStageMirrorSuppression(only) {
    var mirror = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById(WALLPAPER_STAGE_MIRROR_ID) : null;
    if (!mirror) return false;
    try {
      if (only) {
        mirror.setAttribute('data-wp-stage-hidden', '1');
        mirror.style.setProperty('display', 'none', 'important');
        mirror.style.setProperty('opacity', '0', 'important');
        mirror.style.setProperty('pointer-events', 'none', 'important');
      } else if (mirror.getAttribute('data-wp-stage-hidden') === '1') {
        mirror.removeAttribute('data-wp-stage-hidden');
        mirror.style.removeProperty('display');
        mirror.style.removeProperty('opacity');
        mirror.style.removeProperty('pointer-events');
      }
    } catch (_) {}
    return true;
  }

  /* 镜像可能比本模块晚建（LiquidGlass 在分批波里初始化），而且每次玻璃重建都会把
   * 自己的 display 改回去。效果层里挂一条 900ms 的轻巡检（只有一次 getElementById +
   * 三行内联 !important）。 */
  var wallpaperStageMirrorRetryTimer = 0;
  function ensureWallpaperStageMirrorHidden() {
    if (wallpaperStageMirrorRetryTimer) return;
    wallpaperStageMirrorRetryTimer = setInterval(function () {
      if (!wallpaperStageOnly()) {
        applyWallpaperStageMirrorSuppression(false);
        clearInterval(wallpaperStageMirrorRetryTimer);
        wallpaperStageMirrorRetryTimer = 0;
        return;
      }
      applyWallpaperStageMirrorSuppression(true);
    }, 900);
  }

  function syncWallpaperStagePresentation() {
    var body = wallpaperStageBody();
    if (!body) return false;
    var only = wallpaperStageOnly();
    var folia = only && wallpaperStageWorld() === 'folia';
    applyWallpaperStageMirrorSuppression(only);
    if (only) ensureWallpaperStageMirrorHidden();
    var root = wallpaperStageRoot();
    var signature = (only ? '1' : '0') + (folia ? '1' : '0');
    if (signature === wallpaperStageLastSignature
      && body.classList.contains('wallpaper-stage') === only
      && body.classList.contains('wallpaper-stage-folia') === folia) {
      return only;
    }
    wallpaperStageLastSignature = signature;
    wallpaperStageSyncing = true;
    try {
      body.classList.toggle('wallpaper-stage', only);
      body.classList.toggle('wallpaper-stage-folia', folia);
      if (root && root.classList) {
        root.classList.toggle('wp-stage', only);
        root.classList.toggle('wp-stage-folia', folia);
      }
    } finally {
      wallpaperStageSyncing = false;
    }
    return only;
  }

  function bindWallpaperStageObserver() {
    if (wallpaperStageObserver || typeof MutationObserver !== 'function') return false;
    var body = wallpaperStageBody();
    if (!body) return false;
    wallpaperStageObserver = new MutationObserver(function () {
      if (wallpaperStageSyncing) return;
      syncWallpaperStagePresentation();
    });
    wallpaperStageObserver.observe(body, { attributes: true, attributeFilter: ['class'] });
    return true;
  }

  function initWallpaperStagePresentation() {
    if (!wallpaperStageBody()) {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', function () {
          bindWallpaperStageObserver();
          syncWallpaperStagePresentation();
        }, { once: true });
      }
      return false;
    }
    bindWallpaperStageObserver();
    syncWallpaperStagePresentation();
    return true;
  }

  var api = {
    CHROME_SELECTORS: WALLPAPER_STAGE_CHROME_SELECTORS,
    BACKDROP_LAYERS: WALLPAPER_STAGE_BACKDROP_LAYERS,
    NATIVE_LAYERS: WALLPAPER_STAGE_NATIVE_LAYERS,
    wallpaperStagePage: wallpaperStagePage,
    wallpaperStageWorld: wallpaperStageWorld,
    wallpaperStageOnly: wallpaperStageOnly,
    syncWallpaperStagePresentation: syncWallpaperStagePresentation,
    initWallpaperStagePresentation: initWallpaperStagePresentation
  };

  global.MineradioWallpaperStage = api;
  /* 125 个模块合并进同一个作用域，别处要能直接按名字调到这几个判定函数；
   * 只导出函数，不带 CHROME_SELECTORS / NATIVE_LAYERS 这类通用名，避免撞名遮蔽。 */
  [
    'wallpaperStagePage',
    'wallpaperStageWorld',
    'wallpaperStageOnly',
    'syncWallpaperStagePresentation'
  ].forEach(function (key) {
    if (typeof global[key] === 'undefined') global[key] = api[key];
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  initWallpaperStagePresentation();
})(typeof window !== 'undefined' ? window : globalThis);
