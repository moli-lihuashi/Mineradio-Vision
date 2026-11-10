/* Folia 世界 — 运行时与生命周期
 *
 * 进出世界是显式互斥：进入 → body 加 folia-world-active（CSS 隐藏 #canvas-container），
 * 主循环停止原生画面渲染但保留音频/歌词推进；退出 → 销毁模式实例、恢复原生画面。
 *
 * 铁律：
 *   - 模式实例必须真销毁（不能只藏着，显存/定时器会漏）
 *   - 初始化或每帧抛错 → 立即退出并给出可见原因（不静默、不留半死状态）
 *   - 主循环只调 foliaWorldTick()，不在这里另起 rAF（避免双循环抢帧）
 */
'use strict';

function foliaWorldEnsureRoot() {
  if (foliaWorld.root && foliaWorld.root.isConnected) return foliaWorld.root;
  var root = document.createElement('div');
  root.id = 'folia-world-root';
  // 必须挂在 desktop-window-shell 内：#desktop-window-shell 有 transform，是独立层叠上下文；
  // 挂到 body 上会盖住整个 UI（面板/底栏都点不到）。放在 canvas-container 之后同层。
  var shell = document.getElementById('desktop-window-shell');
  var canvasHost = document.getElementById('canvas-container');
  if (shell) {
    if (canvasHost && canvasHost.parentNode === shell) shell.insertBefore(root, canvasHost.nextSibling);
    else shell.appendChild(root);
  } else {
    document.body.appendChild(root);
  }
  foliaWorld.root = root;
  return root;
}

function foliaWorldBuildContext(now, dt) {
  var lines = foliaWorldLines();
  var time = foliaWorldPlaybackTime();
  var index = foliaWorldLineIndexAt(time, lines);
  var paused = false;
  try { paused = !!(typeof audio !== 'undefined' && audio && audio.paused); } catch (_) {}
  var showTranslation = true;
  try { if (fx && fx.lyricTranslationMode === 'off') showTranslation = false; } catch (_) {}
  var fontScale = 1;
  try {
    var ls = Number(fx && fx.lyricScale);
    if (isFinite(ls) && ls > 0) fontScale = Math.max(0.4, Math.min(2.4, ls));
  } catch (_) {}
  /* 几何种子：Folia 用「展示中的歌曲 id」（App.tsx 的 visualizerGeometrySeed，
   * 无歌曲时回落 geometry-<mode>）。本项目等价物 = 播放队列里当前这首歌的 id。 */
  var seed = '';
  var song = null;
  try {
    if (typeof playQueue !== 'undefined' && playQueue && currentIdx >= 0 && currentIdx < playQueue.length) {
      song = playQueue[currentIdx] || null;
      if (song && song.id != null) seed = String(song.id);
    }
  } catch (_) {}
  /* 歌曲元数据：monet 的海报要「封面 + 曲名 / 歌手 / 专辑」。取不到给空串，
   * 由样式侧自己回落（不许在这里抛，否则整个世界进不去）。 */
  var meta = { title: '', artist: '', album: '', coverUrl: '' };
  if (song) {
    meta.title = String(song.name || song.title || song.songName || '');
    meta.artist = String(song.artist || song.singer || '');
    meta.album = String(song.album || '');
    try {
      if (typeof songCoverSrc === 'function') meta.coverUrl = String(songCoverSrc(song, 1024) || '');
    } catch (_) {}
    if (!meta.coverUrl) meta.coverUrl = String(song.customCover || song.cover || '');
  }
  var audioState = foliaWorldAudio();
  return {
    now: now || performance.now(),
    dt: isFinite(Number(dt)) ? Number(dt) : 0,
    time: time,
    index: index,
    lines: lines,
    theme: foliaWorldTheme(),
    audio: audioState,
    audioBands: audioState.bands,
    song: meta,
    paused: paused,
    showText: true,
    showTranslation: showTranslation,
    fontScale: fontScale,
    seed: seed
  };
}

/* create 允许返回 Promise（需要动态 import 的样式，如 tilt 要 pretext）。
 * token 单调递增：任何一次 destroy / 再次 create 都让在飞的旧 Promise 结果作废，
 * 否则用户快速切样式时会往已经拆掉的宿主里塞节点。 */
var foliaWorldCreateToken = 0;

function foliaWorldDestroyInstance() {
  var inst = foliaWorld.instance;
  foliaWorld.instance = null;
  foliaWorldCreateToken += 1;
  if (!inst) return;
  try {
    if (!inst.__pending && inst.__def && typeof inst.__def.destroy === 'function') inst.__def.destroy(inst);
  } catch (_) {}
  try {
    if (inst.__host && inst.__host.parentNode) inst.__host.parentNode.removeChild(inst.__host);
  } catch (_) {}
}

function foliaWorldApplyAsyncInstance(token, def, host, real) {
  if (token !== foliaWorldCreateToken) {
    try { if (real && typeof def.destroy === 'function') def.destroy(real); } catch (_) {}
    try { if (host.parentNode) host.parentNode.removeChild(host); } catch (_) {}
    return;
  }
  real = real || {};
  real.__def = def;
  real.__host = host;
  real.__pending = false;
  foliaWorld.instance = real;
  foliaWorld.failReason = '';
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
}

function foliaWorldFailAsyncInstance(token, host, err) {
  if (token !== foliaWorldCreateToken) return;
  var reason = 'Folia 初始化失败：' + ((err && err.message) || String(err));
  foliaWorld.instance = null;
  foliaWorld.failReason = reason;
  foliaWorld.active = false;
  foliaWorld.wantActive = false;
  document.body.classList.remove('folia-world-active');
  try { if (host.parentNode) host.parentNode.removeChild(host); } catch (_) {}
  saveFoliaWorldPrefs();
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
  if (typeof showToast === 'function') showToast(reason);
  console.error('[FoliaWorld]', err);
}

function foliaWorldCreateInstance() {
  var root = foliaWorldEnsureRoot();
  var def = getFoliaMode(foliaWorld.mode) || getFoliaMode('still');
  if (!def) {
    foliaWorld.failReason = '没有可用的 Folia 歌词样式';
    return false;
  }
  if (def.needsWebGL2 && !foliaWorldSupportsWebGL2()) {
    foliaWorld.failReason = '「' + def.name + '」需要 WebGL2，当前设备不支持';
    return false;
  }
  foliaWorldDestroyInstance();
  var token = foliaWorldCreateToken;

  var host = document.createElement('div');
  host.className = 'folia-mode-host';
  host.setAttribute('data-folia-mode', def.id);
  root.appendChild(host);

  try {
    var ctx = foliaWorldBuildContext(performance.now(), 0);
    var result = def.create(host, ctx);

    if (result && typeof result.then === 'function') {
      foliaWorld.instance = { __def: def, __host: host, __pending: true };
      foliaWorld.failReason = '';
      result.then(function (real) {
        foliaWorldApplyAsyncInstance(token, def, host, real);
      }).catch(function (err) {
        foliaWorldFailAsyncInstance(token, host, err);
      });
      return true;
    }

    var inst = result || {};
    inst.__def = def;
    inst.__host = host;
    foliaWorld.instance = inst;
    foliaWorld.failReason = '';
    return true;
  } catch (err) {
    foliaWorld.failReason = 'Folia 初始化失败：' + ((err && err.message) || String(err));
    try { if (host.parentNode) host.parentNode.removeChild(host); } catch (_) {}
    foliaWorld.instance = null;
    return false;
  }
}

function foliaWorldEnter(opts) {
  opts = opts || {};
  /* 只有「真的在渲染」才早退。半死状态（active 有、instance 没有）必须继续往下建，
   * 否则用户会看到开关是开的、画面却是原生，点一下又变成关。
   * 早退也要刷一次 UI：调用方可能刚改过 foliaWorld.mode，不刷就会留一张对不上的卡片高亮。 */
  if (foliaWorld.active && foliaWorld.instance) {
    if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
    return true;
  }
  var def = getFoliaMode(foliaWorld.mode) || getFoliaMode('still');
  if (def && def.needsWebGL2 && !foliaWorldSupportsWebGL2()) {
    foliaWorld.failReason = '「' + def.name + '」需要 WebGL2，当前设备不支持';
    foliaWorld.active = false;
    foliaWorld.wantActive = false;
    saveFoliaWorldPrefs();
    if (!opts.silent && typeof showToast === 'function') showToast(foliaWorld.failReason);
    if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
    return false;
  }

  foliaWorld.active = true;
  foliaWorld.wantActive = true;
  document.body.classList.add('folia-world-active');
  var ok = foliaWorldCreateInstance();
  if (ok) foliaWorldApplyBackground();
  if (!ok) {
    foliaWorld.active = false;
    foliaWorld.wantActive = false;
    document.body.classList.remove('folia-world-active');
  }
  /* 世界把壁纸整块盖住了（玻璃镜像也不采样视频）：暂停两个壁纸视频省解码开销。 */
  if (ok) foliaWorldPauseWallpaperVideos();
  saveFoliaWorldPrefs();
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
  if (!opts.silent && typeof showToast === 'function') {
    showToast(ok ? '已进入 Folia 世界' : (foliaWorld.failReason || 'Folia 世界开启失败'));
  }
  return ok;
}

function foliaWorldExit(opts) {
  opts = opts || {};
  if (!foliaWorld.active && !foliaWorld.instance) {
    foliaWorld.wantActive = false;
    saveFoliaWorldPrefs();
    return;
  }
  foliaWorld.active = false;
  foliaWorld.wantActive = false;
  document.body.classList.remove('folia-world-active');
  foliaWorldDestroyBackground();
  foliaWorldDestroyInstance();
  foliaWorldResumeWallpaperVideos();
  saveFoliaWorldPrefs();
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
  if (!opts.silent && typeof showToast === 'function') showToast('已退出 Folia 世界');
}

function foliaWorldToggle() {
  if (foliaWorld.active) foliaWorldExit();
  else foliaWorldEnter();
}

function foliaWorldSetMode(id) {
  if (!getFoliaMode(id)) return;
  if (foliaWorld.mode === id) {
    if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
    return;
  }
  var prevMode = foliaWorld.mode;
  foliaWorld.mode = id;
  if (foliaWorld.active) {
    foliaWorldDestroyInstance();
    if (!foliaWorldCreateInstance()) {
      foliaWorld.active = false;
      document.body.classList.remove('folia-world-active');
      if (typeof showToast === 'function') showToast(foliaWorld.failReason || '切换样式失败');
    }
  }
  saveFoliaWorldPrefs();
  /* 浮名会把自己的「通用几何图形」开关 OR 到共享背景上（01b 的有效判据看 foliaWorld.mode），
   * 而背景实例只在创建时读一次 —— 进出浮名时重建一次，否则几何图形会停在切换前的状态。 */
  if ((prevMode === 'fume' || id === 'fume') && foliaWorld.bgInstance) foliaWorldRebuildBackground();
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
}

function foliaWorldSetBackground(id) {
  var bg = getFoliaBackground(id);
  if (!bg) return;
  var changed = foliaWorld.background !== bg.id;
  foliaWorld.background = bg.id;
  if (changed && foliaWorld.active) foliaWorldApplyBackground();
  else if (foliaWorld.bgHost) foliaWorld.bgHost.setAttribute('data-folia-bg', bg.id);
  saveFoliaWorldPrefs();
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
}

/* ---- 背景（壳层）----
 * 背景画在模式下面：.folia-bg-host 是 root 的第一个子节点，模式宿主盖在它上面。
 * 背景是**装饰**：建不出来或每帧抛错都不该带走整个世界（模式还在正常画），
 * 所以这里一律吞错并退回「无背景」，与模式实例「出错即退出」的策略相反。 */
var foliaWorldBackgroundToken = 0;

function foliaWorldBackgroundHost() {
  var root = foliaWorldEnsureRoot();
  if (foliaWorld.bgHost && foliaWorld.bgHost.isConnected) return foliaWorld.bgHost;
  var host = document.createElement('div');
  host.className = 'folia-bg-host';
  host.setAttribute('data-folia-bg', foliaWorld.background || 'none');
  root.insertBefore(host, root.firstChild);
  foliaWorld.bgHost = host;
  return host;
}

/* tuning 改动后的重建入口：SetBackground 同 id 会早退（changed=false），不触发重建；
 * 面板改完存档后调这里，直接销毁再按当前 tuning 重建实例。
 * 不活跃时什么都不做（下次 enter 自然按新 tuning 创建）。 */
function foliaWorldRebuildBackground() {
  if (!foliaWorld.active) return;
  foliaWorldApplyBackground();
}

function foliaWorldDestroyBackground() {
  var inst = foliaWorld.bgInstance;
  var host = foliaWorld.bgHost;
  foliaWorld.bgInstance = null;
  foliaWorld.bgDef = null;
  foliaWorld.bgHost = null;
  foliaWorldBackgroundToken += 1;
  if (inst) {
    try {
      var def = inst.__def;
      if (def && typeof def.destroy === 'function') def.destroy(inst);
    } catch (_) {}
  }
  /* 宿主一起摘掉：退出世界后 root 里不该留下任何背景节点（零残留）。 */
  try { if (host && host.parentNode) host.parentNode.removeChild(host); } catch (_) {}
}

function foliaWorldApplyBackground() {
  foliaWorldDestroyBackground();
  if (!foliaWorld.active) return;
  var def = getFoliaBackground(foliaWorld.background);
  if (!def || typeof def.create !== 'function') {
    if (foliaWorld.bgHost) foliaWorld.bgHost.setAttribute('data-folia-bg', 'none');
    return;
  }
  if (def.needsWebGL2 && !foliaWorldSupportsWebGL2()) {
    console.warn('[FoliaWorld] 背景「' + def.name + '」需要 WebGL2，已退回无背景');
    return;
  }
  var token = foliaWorldBackgroundToken;
  var host = foliaWorldBackgroundHost();
  host.setAttribute('data-folia-bg', def.id);
  try {
    var result = def.create(host, foliaWorldBuildContext(performance.now(), 0));
    if (result && typeof result.then === 'function') {
      result.then(function (real) {
        if (token !== foliaWorldBackgroundToken) {
          try { if (real && typeof def.destroy === 'function') def.destroy(real); } catch (_) {}
          return;
        }
        real = real || {};
        real.__def = def;
        foliaWorld.bgInstance = real;
        foliaWorld.bgDef = def;
      }, function (err) {
        if (token !== foliaWorldBackgroundToken) return;
        console.error('[FoliaWorld] 背景初始化失败', err);
      });
      return;
    }
    var inst = result || {};
    inst.__def = def;
    foliaWorld.bgInstance = inst;
    foliaWorld.bgDef = def;
  } catch (err) {
    console.error('[FoliaWorld] 背景初始化失败', err);
    if (host.parentNode) host.parentNode.removeChild(host);
    foliaWorld.bgHost = null;
    foliaWorld.bgInstance = null;
    foliaWorld.bgDef = null;
  }
}

function foliaWorldTickBackground(ctx) {
  var inst = foliaWorld.bgInstance;
  var def = foliaWorld.bgDef;
  if (!inst || !def || typeof def.tick !== 'function') return;
  try {
    def.tick(inst, ctx);
  } catch (err) {
    console.error('[FoliaWorld] 背景渲染异常，已退回无背景', err);
    foliaWorldDestroyBackground();
    if (foliaWorld.bgHost) foliaWorld.bgHost.setAttribute('data-folia-bg', 'none');
  }
}

/* ---- 壁纸视频的暂停/恢复 ----
 * 世界把壁纸整块盖住，玻璃镜像也不采样视频帧（Folia 镜像只收 folia root 的画布），
 * 视频继续解码纯属浪费。enter 时记录「进入前是否在播」并暂停；exit 时恢复。
 * Folia 激活中用户换壁纸：applyCustomBackground / requestWallpaperEngineVideoPlayback
 * 的播放点有 foliaWorldActive() 守卫，不会把视频重新拉起来（退出时统一恢复）。 */
var foliaWorldVideoPauseState = { custom: false, engine: false };

function foliaWorldPauseWallpaperVideos() {
  var cv = document.getElementById('custom-bg-video');
  var wv = document.getElementById('wallpaper-engine-video');
  foliaWorldVideoPauseState.custom = !!(cv && !cv.paused);
  foliaWorldVideoPauseState.engine = !!(wv && !wv.paused);
  try { if (cv && !cv.paused) cv.pause(); } catch (_) {}
  try { if (wv && !wv.paused) wv.pause(); } catch (_) {}
}

function foliaWorldResumeWallpaperVideos() {
  var wasCustom = foliaWorldVideoPauseState.custom;
  var wasEngine = foliaWorldVideoPauseState.engine;
  foliaWorldVideoPauseState.custom = false;
  foliaWorldVideoPauseState.engine = false;
  var cv = document.getElementById('custom-bg-video');
  var wv = document.getElementById('wallpaper-engine-video');
  /* custom 走 applyCustomBackground 重入：Folia 激活中换过壁纸也能按当前选择正确拉起。 */
  if (wasCustom && typeof applyCustomBackground === 'function') {
    try { applyCustomBackground(); } catch (_) {}
  }
  try {
    if (wasEngine && wv && !document.hidden) {
      var p = wv.play();
      if (p && p.catch) p.catch(function () {});
    }
  } catch (_) {}
}

/* 主循环每帧调用一次；出错立即退出世界，避免半死状态。 */
function foliaWorldTick(now, dt) {
  if (!foliaWorld.active) return;
  var inst = foliaWorld.instance;
  if (!inst) return;
  if (inst.__pending) return;
  var def = inst.__def;
  if (!def || typeof def.tick !== 'function') return;
  var ctx = foliaWorldBuildContext(now, dt);
  try {
    def.tick(inst, ctx);
  } catch (err) {
    foliaWorld.failReason = 'Folia 渲染异常：' + ((err && err.message) || String(err));
    foliaWorldExit({ silent: true });
    if (typeof showToast === 'function') showToast(foliaWorld.failReason);
    console.error('[FoliaWorld]', err);
    return;
  }
  foliaWorldTickBackground(ctx);
}
