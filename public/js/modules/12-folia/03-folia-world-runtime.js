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

/* ---- Pixi 8.21 滤镜纹理池兼容补丁（世界级，所有 Pixi 模式生效）----
 * Pixi 8.21.0 在窗口 resize / renderer.resolution 变化时会把「屏幕大小的空闲池纹理」
 * destroy(true) 回收（source 置 null），但 FilterSystem 侧仍可能持有这些引用：
 *   a) _globalFilterBindGroup 的槽位 1/2/3（tempera 的 pixiFilterPoolCompat 已修）；
 *   b) _filterStack 里上一趟 pass 留下的 inputTexture —— 原版 _findFilterResolution
 *      直接读 source._resolution，就会抛「Cannot read properties of null
 *      (reading '_resolution')」，世界层 catch 后整局退出（用户所见）。
 * 这里在创建任何模式实例之前安装完整补丁（绑定组解绑 + _findFilterResolution 空安全），
 * 幂等标志与 tempera 的 pixiFilterPoolCompat 共用：tempera 自装时看到标志已设即跳过。
 */
function foliaWorldInstallPixi821FilterPoolCompat(pixi) {
  if (!pixi || pixi.VERSION !== '8.21.0') return false;
  var prototype = pixi.FilterSystem.prototype;
  if (prototype.__foliaPixi821FilterPoolCompat) return false;
  prototype.__foliaPixi821FilterPoolCompat = true;

  var groups = new Set();
  var pool = pixi.TexturePool;
  var unbindPassTextures = function () {
    var source = pixi.Texture.EMPTY.source;
    groups.forEach(function (group) {
      group.setResource(source, 1);
      group.setResource(source.style, 2);
      group.setResource(source, 3);
    });
  };

  /* init 会被 Pixi 的 renderer runner 在任何滤镜渲染之前执行 */
  var init = prototype.init;
  prototype.init = function () {
    if (init) init.call(this);
    groups.add(this._globalFilterBindGroup);
  };
  var destroy = prototype.destroy;
  prototype.destroy = function () {
    groups.delete(this._globalFilterBindGroup);
    this._globalFilterBindGroup.destroy();
    destroy.call(this);
  };

  /* resize / renderer 销毁 / clear() 都会从这里丢弃空闲纹理 */
  var dropTextures = pool._dropTextures;
  pool._dropTextures = function (textures, shouldDestroy) {
    if (shouldDestroy && textures.length > 0) unbindPassTextures();
    dropTextures.call(this, textures, shouldDestroy);
  };
  var returnTexture = pool.returnTexture;
  pool.returnTexture = function (texture, resetStyle) {
    var key = this._poolKey[texture.uid];
    if (key !== undefined && !this._buckets.has(key)) unbindPassTextures();
    returnTexture.call(this, texture, resetStyle);
  };

  /* _findFilterResolution 空安全：_filterStack 里的 inputTexture 可能是已被池回收
   * （source=null）的纹理，原实现直接读 source._resolution 抛错。跳过空引用继续
   * 往栈底找，找不到再退回 fallback —— 与绑定组解绑是同一缺陷的另一半。 */
  var findFilterResolution = prototype._findFilterResolution;
  prototype._findFilterResolution = function (fallback) {
    var index = (this._filterStackIndex || 0) - 1;
    while (index > 0) {
      var entry = this._filterStack[index];
      if (!entry || entry.skip) { index -= 1; continue; }
      var texture = entry.inputTexture;
      if (texture && texture.source) return texture.source._resolution;
      index -= 1;
    }
    return fallback;
  };
  void findFilterResolution;
  return true;
}

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
    /* 歌词表版本：换歌 / 歌词异步加载完 / 译文补齐都会 +1。
     * 模组宿主用它判断「挂载时抓住的那份歌词已经变了」。 */
    linesRev: (typeof foliaWorldLineCache !== 'undefined' && foliaWorldLineCache)
      ? Number(foliaWorldLineCache.rev) || 0
      : 0,
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
/* 切样式时把上一个样式的最后一帧先留在下层（等新样式画出第一帧再销毁）。
 * 异步样式（花笺/52Hz 要先 init PIXI）初始化要几百毫秒，立刻摘掉旧实例会露出
 * 背景层，看起来就是「点一下闪一下」。 */
var foliaWorldPrevInstance = null;
var foliaWorldPrevTimer = 0;

function foliaWorldRetirePrevInstance() {
  if (foliaWorldPrevTimer) {
    clearTimeout(foliaWorldPrevTimer);
    foliaWorldPrevTimer = 0;
  }
  var prev = foliaWorldPrevInstance;
  foliaWorldPrevInstance = null;
  if (!prev) return;
  try {
    if (prev.__def && typeof prev.__def.destroy === 'function') prev.__def.destroy(prev);
  } catch (_) {}
  try {
    if (prev.__host && prev.__host.parentNode) prev.__host.parentNode.removeChild(prev.__host);
  } catch (_) {}
}

/* 新实例已经接上：等它的第一帧 tick 画完再撤旧帧。
 * DOM 型样式没有 tick，创建完就是最终画面，直接排 180ms 后撤。 */
function foliaWorldArmPrevRetire(inst, def) {
  if (!inst) return;
  inst.__needsFirstFrame = true;
  /* DOM 型样式没有 tick：创建完就是最终画面，180ms 后撤旧帧，别让旧画面多留 2.5s。 */
  if (!def || typeof def.tick !== 'function') {
    if (foliaWorldPrevTimer) clearTimeout(foliaWorldPrevTimer);
    foliaWorldPrevTimer = setTimeout(foliaWorldRetirePrevInstance, 180);
  }
}

/* 兜底：新实例迟迟没有第一帧（异步初始化卡住）也不能一直留着旧实例。 */
function foliaWorldScheduleRetirePrev() {
  if (!foliaWorldPrevInstance) return;
  if (foliaWorldPrevTimer) clearTimeout(foliaWorldPrevTimer);
  foliaWorldPrevTimer = setTimeout(foliaWorldRetirePrevInstance, 2500);
}

function foliaWorldDestroyInstance() {
  var inst = foliaWorld.instance;
  foliaWorld.instance = null;
  foliaWorldCreateToken += 1;
  foliaWorldRetirePrevInstance();
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
  foliaWorldArmPrevRetire(real, def);
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
  foliaWorldRetirePrevInstance();
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
  /* Pixi 8.21 滤镜池兼容补丁必须在任何模式创建 App 之前装上（幂等）。 */
  try {
    if (typeof PIXI !== 'undefined') foliaWorldInstallPixi821FilterPoolCompat(PIXI);
  } catch (compatErr) {
    console.warn('[FoliaWorld] pixi filter-pool compat skipped:', compatErr);
  }
  var prev = foliaWorld.instance;
  if (prev && prev.__pending) {
    /* 上一次异步创建还没完成：没有可保留的画面，按原逻辑销毁。 */
    foliaWorldDestroyInstance();
  } else if (prev) {
    /* 先把旧样式的最后一帧垫在下层，新样式画出第一帧后再撤（异步 init 不闪）。 */
    foliaWorldRetirePrevInstance();
    foliaWorld.instance = null;
    foliaWorldPrevInstance = prev;
    foliaWorldScheduleRetirePrev();
  }
  foliaWorldCreateToken += 1;
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
    foliaWorldArmPrevRetire(inst, def);
    return true;
  } catch (err) {
    foliaWorld.failReason = 'Folia 初始化失败：' + ((err && err.message) || String(err));
    try { if (host.parentNode) host.parentNode.removeChild(host); } catch (_) {}
    foliaWorld.instance = null;
    foliaWorldRetirePrevInstance();
    return false;
  }
}

/* 同一样式静默重建：给「挂载时还没有歌词」的模组一次重新挂载的机会。
 *
 * 为什么需要：Folia 模组拿歌词是 mount 时一次快照（花笺 director.attach({lines})），
 * 之后宿主再改 ctx.lines 它也不会重新 attach。启动时世界比歌词先就绪 →
 * 模组带着空歌词挂上去 → 画面永远没有词，直到用户切一下样式。
 * foliaWorldCreateInstance 会把旧实例的最后一帧垫在下面、等新实例画出第一帧再撤，
 * 所以这次重建在视觉上是「原地换一版」，不会闪白。 */
function foliaWorldRelinkCurrentMode(reason) {
  if (!foliaWorld.active || !foliaWorld.instance) return false;
  /* 上一次异步创建还没落地：等它自己完成，别再叠一层。 */
  if (foliaWorld.instance.__pending) return false;
  var def = getFoliaMode(foliaWorld.mode);
  if (!def) return false;
  try {
    var ok = foliaWorldCreateInstance();
    if (ok) console.log('[FoliaWorld] 歌词就绪后重建样式实例:', foliaWorld.mode, reason || '');
    return ok;
  } catch (err) {
    console.warn('[FoliaWorld] 歌词就绪后重建失败:', err);
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

/* 进入世界前把被禁样式换掉：存档里可能还是花火/町景/雾笺/凝彩，
 * 壁纸模式开着时直接切流光，避免一进来桌面就被整屏场景盖住。 */
function foliaWorldSanitizeModeForWallpaper() {
  if (typeof fx === 'undefined' || !fx || !fx.wallpaperMode) return;
  if (typeof FOLIA_WALLPAPER_BLOCKED_MODES === 'undefined') return;
  if (FOLIA_WALLPAPER_BLOCKED_MODES.indexOf(String(foliaWorld.mode || '')) < 0) return;
  foliaWorld.mode = 'classic';
  saveFoliaWorldPrefs();
}

function foliaWorldSetMode(id) {
  if (!getFoliaMode(id)) return;
  /* 2026-11-23：样式卡片常显但未开启时禁用 —— CSS 的 pointer-events:none 只挡真实指针，
     键盘/脚本调用仍会改存档，这里补一道语义拦截。 */
  if (!foliaWorld.active) {
    if (typeof showToast === 'function') showToast('先打开上方的「开启 Folia 世界」');
    return;
  }
  /* 壁纸模式下禁止切到整屏场景样式（花火/町景/雾笺/凝彩）：面板置灰之外再兜一层，
   * 免得快捷键、脚本或旧存档把桌面切成一块不透明场景。 */
  if (typeof foliaModeBlockedInWallpaper === 'function' && foliaModeBlockedInWallpaper(id)) {
    if (typeof showToast === 'function') showToast('壁纸模式下不可用该样式');
    return;
  }
  /* 走到这里说明 id 真的存在（用户点的 / 模组恢复的）：存档里那个「待恢复」
   * 的旧 id 作废，之后落盘按当前 mode 走。 */
  if (typeof clearFoliaWorldPendingMode === 'function') clearFoliaWorldPendingMode();
  if (foliaWorld.mode === id) {
    if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
    return;
  }
  var prevMode = foliaWorld.mode;
  foliaWorld.mode = id;
  if (foliaWorld.active) {
    /* 销毁交给 foliaWorldCreateInstance：它会把旧样式的最后一帧留着垫底，
     * 等新样式画出第一帧再撤 —— 异步 init 的样式切换不再闪一下。 */
    if (!foliaWorldCreateInstance()) {
      foliaWorldDestroyInstance();
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
  if (!foliaWorld.active) {
    if (typeof showToast === 'function') showToast('先打开上方的「开启 Folia 世界」');
    return;
  }
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
// 同一次暂停只记录一次（见 foliaWorldPauseWallpaperVideos 的注释）
var foliaWorldVideosPauseHeld = false;

function foliaWorldPauseWallpaperVideos() {
  var cv = document.getElementById('custom-bg-video');
  var wv = document.getElementById('wallpaper-engine-video');
  /* 同一次世界会话只在第一次暂停时记录当时的播放状态。暂停被重入时若继续用
   * 当前状态覆盖，第二次会记成 false（此时视频已经 paused），退出世界时就不再
   * resume → 壁纸停在暂停帧。 */
  if (!foliaWorldVideosPauseHeld) {
    foliaWorldVideoPauseState.custom = !!(cv && !cv.paused);
    foliaWorldVideoPauseState.engine = !!(wv && !wv.paused);
    foliaWorldVideosPauseHeld = true;
  }
  try { if (cv && !cv.paused) cv.pause(); } catch (_) {}
  try { if (wv && !wv.paused) wv.pause(); } catch (_) {}
  // 同步内置壁纸的玻璃镜像循环：Folia 盖住壁纸时不再每帧上传纹理
  if (typeof wallpaperEngineSyncMediaRuntime === 'function') {
    try { wallpaperEngineSyncMediaRuntime(); } catch (_) {}
  }
}

function foliaWorldResumeWallpaperVideos() {
  var wasCustom = foliaWorldVideoPauseState.custom;
  var wasEngine = foliaWorldVideoPauseState.engine;
  foliaWorldVideoPauseState.custom = false;
  foliaWorldVideoPauseState.engine = false;
  foliaWorldVideosPauseHeld = false;
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
  // 退出 Folia 后主动唤醒镜像循环（后台 rAF 可能已被节流），并统一按当前
  // 窗口可见性 / 后台保持策略决定要不要继续跑壁纸媒体
  if (typeof wallpaperEngineSyncMediaRuntime === 'function') {
    try { wallpaperEngineSyncMediaRuntime(); } catch (_) {}
  }
}

/* 主循环每帧调用一次；出错立即退出世界，避免半死状态。 */
function foliaWorldCompactStackHead(err, limit) {
  var stack = (err && err.stack) ? String(err.stack) : '';
  if (!stack) return '';
  var lines = stack.split(/\r?\n/).slice(0, 3).map(function (line) { return line.trim(); }).filter(Boolean);
  return lines.join(' | ').slice(0, limit || 200);
}
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
    /* 模式名 + 堆栈首行进 failReason：面板里就能看出是哪个模式、哪条内部路径，
     * 不用再连 CDP 抓一遍。完整堆栈仍进 console。 */
    var stackHead = foliaWorldCompactStackHead(err);
    foliaWorld.failReason = 'Folia 渲染异常（' + (def.name || foliaWorld.mode) + '）：'
      + ((err && err.message) || String(err))
      + (stackHead ? ' · ' + stackHead : '');
    foliaWorldExit({ silent: true });
    if (typeof showToast === 'function') showToast('Folia 渲染异常（' + (def.name || foliaWorld.mode) + '）：' + ((err && err.message) || String(err)));
    console.error('[FoliaWorld]', err);
    return;
  }
  /* 新样式的第一帧已经画完：现在撤掉垫在下面的旧帧，中间不会露背景。 */
  if (inst.__needsFirstFrame) {
    inst.__needsFirstFrame = false;
    foliaWorldRetirePrevInstance();
  }
  foliaWorldTickBackground(ctx);
}
