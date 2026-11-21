/* 壁纸模式「播放状态镜像」—— 2026-11-21
 *
 * 结构：主窗口（唯一播放器）+ 桌面效果层窗口（?stage=1，只画粒子/歌词）。
 * 效果层不能自己找歌、不能自己走自动续播，否则两份页面会各放各的（双声、双统计、
 * 随机播放选到不同的下一首）。所以：
 *
 *   主窗口  → 每秒把「同一首歌同一秒」推给主进程，由主进程转给效果层：
 *              曲目/队列变化时发 full（含 queue 窗口，最多 120 首）
 *              其余时候只发 pulse（songKey + position + playing + preset）
 *   效果层  → 收到 full：调 applyPlaybackSession（真实管线：取址/封面/歌词/调色板），
 *              然后按 pulse 只做位置与播放态纠偏（±0.6s 内不动，避免每帧 seek）
 *
 * 效果层里 `audio` 由 webContents.setAudioMuted(true) 静音：音频图照常跑，
 * 粒子/歌词拿到的频谱与主窗口同源同秒；但用户听不到第二份声音。
 */
(function (global) {
  'use strict';

  var STAGE_PULSE_INTERVAL_MS = 1000;
  var STAGE_FULL_REFRESH_MS = 15000;
  var STAGE_DRIFT_TOLERANCE_S = 0.6;

  function stagePageApi() {
    return (typeof window !== 'undefined' && window.desktopWindow) ? window.desktopWindow : null;
  }

  function stageNumber(value, fallback) {
    var numeric = Number(value);
    return isFinite(numeric) ? numeric : fallback;
  }

  /* ==================== 主窗口：下发 ==================== */

  function stageSongKeyOf(song) {
    if (!song) return '';
    try {
      if (typeof queueItemKey === 'function') return queueItemKey(song) || '';
    } catch (_) {}
    return String(song.id || song.mid || song.localKey || song.name || '');
  }

  function buildStageFullSession() {
    if (!playQueue || !playQueue.length || currentIdx < 0 || !playQueue[currentIdx]) return null;
    var song = playQueue[currentIdx];
    var queuePayload = null;
    try {
      queuePayload = typeof playbackSessionQueuePayload === 'function' ? playbackSessionQueuePayload() : null;
    } catch (_) {}
    var queue = [];
    if (queuePayload && queuePayload.json) {
      try { queue = JSON.parse(queuePayload.json); } catch (_) { queue = []; }
    }
    var serializedSong = song;
    try {
      if (typeof serializeSongForSession === 'function') serializedSong = serializeSongForSession(song) || song;
    } catch (_) {}
    /* 本地曲目的实时地址（mineradio-local://）只存在于当前会话里：serializeSongForSession
     * 会把它剥掉，效果层就得回头查曲库索引 —— 那一页可能还没读完。这里原样带上。 */
    if (serializedSong && song && song.localUrl) {
      try { serializedSong.localUrl = song.localUrl; } catch (_) {}
      /* 恢复时 playQueueAt 用的是队列项而不是 session.song：队列窗口里同一首也要带上地址。 */
      try {
        var liveKey = stageSongKeyOf(song);
        for (var qi = 0; qi < queue.length; qi++) {
          if (stageSongKeyOf(queue[qi]) === liveKey) queue[qi].localUrl = song.localUrl;
        }
      } catch (_) {}
    }
    return {
      version: 3,
      song: serializedSong,
      queue: queue,
      currentIdx: currentIdx,
      queueStart: queuePayload && isFinite(queuePayload.start) ? queuePayload.start : 0,
      currentTime: audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0,
      duration: (typeof getPlaybackDurationSeconds === 'function' ? getPlaybackDurationSeconds() : 0)
        || stageNumber(song.duration, 0),
      playing: !!playing,
      playMode: typeof playMode !== 'undefined' ? playMode : 'loop',
      visualPreset: (typeof fx !== 'undefined' && fx) ? fx.preset : 0,
      /* 主窗口当前在哪个世界：效果层要跟着切（原生 = 粒子+歌词 / Folia = 只留歌词）。 */
      world: typeof wallpaperStageWorld === 'function' ? wallpaperStageWorld() : 'native',
      folia: buildFoliaStageState()
    };
  }

  /* Folia 世界是「状态机 + 样式 + 背景」三件套：只同步 active 不够。
   * 用户在播放器里换样式（classic/fume/nebbia/…）或背景，桌面必须跟着换。 */
  function buildFoliaStageState() {
    if (typeof foliaWorld === 'undefined' || !foliaWorld) return null;
    return {
      active: typeof foliaWorldActive === 'function' ? !!foliaWorldActive() : false,
      mode: String(foliaWorld.mode || ''),
      background: String(foliaWorld.background || ''),
      intensity: String(foliaWorld.intensity || '')
    };
  }

  /* 效果层页面刚加载完：主窗口要立刻补一条 full。只等 15s 定时刷新的话，
   * 桌面会先空十几秒（实测 12s 才出声）。 */
  var stagePumpForceFull = false;
  function bindStageReadyForceFull() {
    var api = stagePageApi();
    if (!api || typeof api.onStageWindowReady !== 'function') return false;
    api.onStageWindowReady(function () { stagePumpForceFull = true; });
    return true;
  }

  function startStageSessionPump() {
    var fullKey = '';
    var fullSentAt = 0;
    var lastEnabled = false;
    /* 没有播放会话时也要同步「世界 / Folia 样式 / 预设」：这些与放歌无关，
     * 旧实现 `if (!session) return` 会让「没歌时切换 Folia 样式」完全到不了桌面。 */
    var noSessionKey = '';
    bindStageReadyForceFull();
    function tick() {
      var api = stagePageApi();
      if (!api || typeof api.pushStageSession !== 'function') return;
      var enabled = !!(typeof fx !== 'undefined' && fx && fx.wallpaperMode);
      if (!enabled) {
        lastEnabled = false;
        fullKey = '';
        noSessionKey = '';
        return;
      }
      var session = buildStageFullSession();
      if (!session) {
        var world = typeof wallpaperStageWorld === 'function' ? wallpaperStageWorld() : 'native';
        var folia = buildFoliaStageState();
        var preset = (typeof fx !== 'undefined' && fx) ? fx.preset : 0;
        var idleKey = world + '|' + preset + '|' + (folia
          ? [folia.active ? 1 : 0, folia.mode, folia.background, folia.intensity].join(',')
          : '-');
        if (stagePumpForceFull || idleKey !== noSessionKey) {
          stagePumpForceFull = false;
          noSessionKey = idleKey;
          lastEnabled = false; // 下一首歌来时强制发 full
          Promise.resolve(api.pushStageSession({
            kind: 'pulse',
            songKey: '',
            world: world,
            folia: folia,
            preset: preset
          })).catch(function () {});
        }
        return;
      }
      noSessionKey = '';
      var key = stageSongKeyOf(session.song) + '|' + session.queue.length + '|' + session.queueStart
        + '|' + (session.visualPreset || 0);
      var now = Date.now();
      var needFull = stagePumpForceFull || !lastEnabled || key !== fullKey || (now - fullSentAt) > STAGE_FULL_REFRESH_MS;
      lastEnabled = true;
      if (needFull) {
        stagePumpForceFull = false;
        fullKey = key;
        fullSentAt = now;
        Promise.resolve(api.pushStageSession({ kind: 'full', full: session })).catch(function () {});
        return;
      }
      Promise.resolve(api.pushStageSession({
        kind: 'pulse',
        songKey: stageSongKeyOf(session.song),
        position: session.currentTime,
        playing: session.playing,
        preset: session.visualPreset,
        duration: session.duration,
        world: session.world,
        folia: session.folia
      })).catch(function () {});
    }
    setInterval(function () {
      /* 镜像失败绝不能反过来拖垮播放器：这一段每秒都跑，任何一次异常都只记一行。 */
      try { tick(); } catch (error) {
        try { console.warn('[StageSync] push failed:', error); } catch (_) {}
      }
    }, STAGE_PULSE_INTERVAL_MS);
    try { tick(); } catch (_) {}
  }

  /* ==================== 效果层：接收 ==================== */

  function stageCurrentKey() {
    if (!playQueue || currentIdx < 0 || !playQueue[currentIdx]) return '';
    return stageSongKeyOf(playQueue[currentIdx]);
  }

  function stageAudioPlaying() {
    return !!(audio && audio.src && !audio.paused && !audio.ended);
  }

  function stageSetPlaying(want) {
    if (!audio || !audio.src) return;
    var isPlaying = stageAudioPlaying();
    if (want === isPlaying) return;
    try {
      if (want) {
        if (audio.ended) return;
        var result = audio.play();
        if (result && typeof result.catch === 'function') result.catch(function () {});
        playing = true;
        if (typeof setPlayIcon === 'function') setPlayIcon(true);
      } else {
        audio.pause();
        playing = false;
        if (typeof setPlayIcon === 'function') setPlayIcon(false);
      }
    } catch (_) {}
  }

  function stageSyncPosition(position, wantPlaying) {
    if (!audio || !audio.src) return;
    var target = Number(position);
    if (isFinite(target) && target >= 0) {
      var drift = Math.abs(Number(audio.currentTime) - target);
      if (drift > STAGE_DRIFT_TOLERANCE_S) {
        try { audio.currentTime = target; } catch (_) {}
      }
    }
    if (typeof wantPlaying === 'boolean') stageSetPlaying(wantPlaying);
  }

  /* 效果层永远不自己「下一首」：曲目切换由主窗口决定并通过 full 下发。
   * playQueueAt 每次都会重绑 onended，所以每个 full 应用完都要再清一次。 */
  function stageDetachEndedHandler() {
    if (audio) { try { audio.onended = null; } catch (_) {} }
  }

  /* 世界跟着主窗口走：原生 ↔ Folia 由主窗口决定，效果层只负责切自己的画面。
   * Folia 运行时是延迟波注入的，早到的 world 事件直接跳过（boot 自己的恢复会处理）。 */
  function stageApplyWorld(world) {
    if (world !== 'folia' && world !== 'native') return false;
    var wantFolia = world === 'folia';
    var isFolia = typeof foliaWorldActive === 'function' ? !!foliaWorldActive() : false;
    if (wantFolia === isFolia) return true;
    try {
      /* silent：foliaWorldEnter 默认会弹「已进入 Folia 世界」，那会在桌面上闪一条
       * 提示；这一页只跟随播放器，不要自己的提示条。 */
      if (wantFolia && typeof foliaWorldEnter === 'function') { foliaWorldEnter({ silent: true }); return true; }
      if (!wantFolia && typeof foliaWorldExit === 'function') { foliaWorldExit({ silent: true }); return true; }
    } catch (_) {}
    return false;
  }

  /* 预设同步：主窗口换预设，桌面效果必须跟着换。
   * 唯一跳过的是 11 经典：它是纯 DOM 播放器界面（#classic-player），效果层按设计把它
   * 隐藏了，照搬只会让桌面空白 —— 遇到它保留上一个粒子预设。
   * 10 音域回响**不跳过**：它由 sonic-topography-preset.js 把地形组挂进共享 three 场景，
   * 效果层跑的是同一套主循环，能原样渲染（旧 iframe #sonic-topography-frame 是遗留实现，
   * 一直处于 opacity:0 隐藏态，与本预设无关）。 */
  var STAGE_PRESET_SKIP_INDICES = [11];
  function stageApplyPreset(preset) {
    var p = Number(preset);
    if (!isFinite(p) || p < 0) return false;
    if (STAGE_PRESET_SKIP_INDICES.indexOf(Math.round(p)) >= 0) return false;
    p = Math.round(p);
    if (typeof fx !== 'undefined' && fx && Number(fx.preset) === p) return false;
    if (typeof setPreset !== 'function') return false;
    try {
      /* 与播放器点预设卡同一条路径：相机也跟到该预设的基线，效果才是「一模一样」。
       * 过渡动效保留（播放器默认也播）。silent 必须给：setPreset 默认会弹
       * 「视觉预设: xxx」，那一条会直接浮在桌面上（效果层没有可交互表面，只该有画面）。 */
      setPreset(p, { preserveCamera: false, silent: true });
      /* 换预设会重排粒子可见性（虚空/涟漪/经典会改 visible），补一次总透明度，
       * 保证「换完预设桌面还有东西」。 */
      stageEnsureParticleAlpha();
      return true;
    } catch (error) {
      try { console.warn('[StageSync] preset failed:', error); } catch (_) {}
      return false;
    }
  }

  /* 应用 Folia 状态：先同步世界开关，再同步样式/背景/强度。
   * 全部走 Folia 自己的 setter，所以实例、面板高亮、存档口径与播放器完全一致。 */
  /* 桌面效果层不能使用的 Folia 样式：它们自己画整屏画面，去掉背景壳层就不成立，
   * 桌面会被一整块场景盖住（用户装的 Wallpaper Engine 就看不见了）。
   *
   * 判据来自效果层页面的实测非透明像素占比（harness/out-folia-alpha.txt）：
   *   monet 99.94%、pendolo 33.97%（左半屏白色齿轮光斑）；machi「町景」/ hanabi「花火」
   *   是 3D 场景；nebbia / tempera 是整屏场景样式（播放器侧已禁）。
   * 透明的那批（sonnet 0.10 / classic 0.13 / partita 0.10 / fume 0.42 / tilt 0.06 /
   * lumiere 1.15 / diorama 2.34 / still 0 / cappella 1.73 …）照常跟随。
   *
   * 分两层：
   *   播放器已禁的四种（花火/町景/雾笺/凝彩）→ 面板置灰，谁都切不过去；
   *   monet / pendolo → 播放器里仍可选（它们是合法样式），只拦效果层：
   *     桌面保持上一个可透明样式（默认 classic 流光），不会被整块盖住。 */
  var STAGE_FOLIA_EXTRA_OPAQUE_MODES = ['monet', 'pendolo'];
  var STAGE_FOLIA_OPAQUE_MODES = STAGE_FOLIA_EXTRA_OPAQUE_MODES.concat(
    (typeof FOLIA_WALLPAPER_BLOCKED_MODES !== 'undefined' && FOLIA_WALLPAPER_BLOCKED_MODES.length)
      ? FOLIA_WALLPAPER_BLOCKED_MODES.slice()
      : ['hanabi', 'machi', 'nebbia', 'tempera']
  );
  function stageFoliaAllowedMode(desired) {
    var current = (typeof foliaWorld !== 'undefined' && foliaWorld) ? String(foliaWorld.mode || '') : '';
    if (desired && STAGE_FOLIA_OPAQUE_MODES.indexOf(desired) < 0) return desired;
    if (current && STAGE_FOLIA_OPAQUE_MODES.indexOf(current) < 0) return current;
    return 'classic';
  }

  function stageApplyFolia(folia) {
    if (!folia || typeof foliaWorldActive !== 'function') return false;
    var wantActive = folia.active === true;
    if (wantActive !== !!foliaWorldActive()) {
      try {
        /* 进出都必须 silent：失败时 foliaWorldEnter 会弹失败原因，而 pulse 每秒都带
         * world/folia —— 不静音的话「设备不支持 WebGL2」这种情况会每秒在桌面上闪一条。 */
        if (wantActive) foliaWorldEnter({ silent: true });
        else foliaWorldExit({ silent: true });
      } catch (error) {
        try { console.warn('[StageSync] folia active failed:', error); } catch (_) {}
      }
    }
    if (!wantActive || !foliaWorldActive()) return true;
    try {
      var wantedMode = stageFoliaAllowedMode(folia.mode);
      if (wantedMode && typeof foliaWorldSetMode === 'function' && foliaWorld.mode !== wantedMode) {
        foliaWorldSetMode(wantedMode);
      }
      if (folia.background && typeof foliaWorldSetBackground === 'function' && foliaWorld.background !== folia.background) {
        foliaWorldSetBackground(folia.background);
      }
      if (folia.intensity && typeof foliaWorldSetIntensity === 'function' && foliaWorld.intensity !== folia.intensity) {
        foliaWorldSetIntensity(folia.intensity);
      }
    } catch (error) {
      try { console.warn('[StageSync] folia detail failed:', error); } catch (_) {}
    }
    return true;
  }

  var stageApplyToken = 0;
  function stageApplyFull(full) {
    if (!full || !full.song) return Promise.resolve(false);
    var key = stageSongKeyOf(full.song);
    var sameSong = key && key === stageCurrentKey() && audio && audio.src;
    if (sameSong) {
      /* 同一首歌也可能只是「主窗口换了预设」：这条分支以前直接 return，
       * 于是 full 虽然准时到了、预设却被丢掉（用户实测：切预设桌面不动）。 */
      stageApplyPreset(full.visualPreset);
      stageSyncPosition(full.currentTime, full.playing === true);
      return Promise.resolve(true);
    }
    if (typeof applyPlaybackSession !== 'function') return Promise.resolve(false);
    var token = ++stageApplyToken;
    /* Promise.resolve(fn()) 不能兜同步抛错（实参先求值）——这里必须包一层 .then，
     * 否则一次同步异常会冒到 IPC 监听器里，把整条消息链打断。 */
    return Promise.resolve().then(function () {
      return applyPlaybackSession(full, {
        force: true,
        toast: false,
        silent: true,
        manual: false,
        preserveHomeState: true,
        holdPaused: full.playing !== true
      });
    }).then(function (ok) {
      if (token !== stageApplyToken) return false;
      if (ok === false) return false;
      stageDetachEndedHandler();
      stageEnsureParticleAlpha();
      stageSyncPosition(full.currentTime, full.playing === true);
      stageApplyPreset(full.visualPreset);
      return true;
    }).catch(function (error) {
      console.warn('[StageSync] apply session failed:', error);
      return false;
    });
  }

  function stageHandleState(state) {
    try {
      if (!state || state.enabled !== true) return;
      /* 设置类消息（只有 opacity/frameRate、没有 session）以前在这里被整个丢掉：
       * 开着壁纸模式在面板里改 24/30/60 帧，效果层要关掉重开才会换。这里就地写进
       * fx.wallpaperFps，主循环的整帧节流（11-main-loop）下一帧就按新值走。
       * 只改运行时，不落盘（效果层不拥有这份设置）。 */
      if (state.frameRate != null && typeof fx !== 'undefined' && fx) {
        var stageFps = Math.round(Number(state.frameRate));
        if (isFinite(stageFps) && stageFps > 0) {
          fx.wallpaperFps = Math.max(1, Math.min(60, stageFps));
        }
      }
      var session = state.session;
      if (!session) return;
      if (session.kind === 'full' && session.full) {
        stageApplyWorld(session.full.world);
        stageApplyFolia(session.full.folia);
        stageApplyFull(session.full);
        return;
      }
      if (session.kind === 'pulse') {
        stageApplyWorld(session.world);
        /* Folia 的样式/背景与放歌无关：没有播放会话时也要跟随（pulse 每秒都带）。 */
        stageApplyFolia(session.folia);
        /* 主窗口已经换歌、但 full 还在路上：先不动，等 full（自己乱找歌会双放）。 */
        if (session.songKey && session.songKey !== stageCurrentKey()) return;
        /* 预设每秒都在 pulse 里：主窗口切预设时最多 1s 桌面就跟上（full 15s 才刷一次）。 */
        stageApplyPreset(session.preset);
        stageSyncPosition(session.position, session.playing === true);
      }
    } catch (error) {
      /* 效果层出问题不能反过来影响主窗口：这里只记录，不抛。 */
      try { console.warn('[StageSync] state failed:', error); } catch (_) {}
    }
  }

  /* 效果层只要「粒子 + 歌词」：三维歌单架（3D 歌单卡片）也画在同一个 WebGL 画布上，
   * 不摘掉的话壁纸上会飘着一叠歌单卡（实测截图：右侧「汽水我的喜欢」整组卡片）。
   * 这里直接 shelfManager.setMode('off')：它只从场景里移除 group，不写存档，
   * 不会改用户在主窗口里的歌单架设置。shelfManager 在延迟波里才建，所以要短轮询。 */
  function stageHideThreeShelf() {
    var startedAt = Date.now();
    function attempt() {
      var manager = (typeof shelfManager !== 'undefined') ? shelfManager : null;
      if (!manager || typeof manager.setMode !== 'function') return false;
      try {
        if (typeof manager.getMode === 'function' && manager.getMode() === 'off') return true;
        manager.setMode('off');
      } catch (_) {}
      return true;
    }
    attempt();
    /* 启动阶段 boot 里还会跑一次 setShelfMode(fx.shelf)，会把歌单架重新建出来。
     * 所以不能「成功一次就收工」，用一个 30s 的低频看门狗把它压住。
     * 30s 之后不会再有人动模式（效果层里没有任何 UI 入口）。 */
    var timer = setInterval(function () {
      var done = attempt() && Date.now() - startedAt > 12000;
      if (done || Date.now() - startedAt > 30000) {
        clearInterval(timer);
        timer = 0;
      }
    }, 600);
  }

  /* 效果层必须自带「粒子在场」：主窗口里 uAlpha 由首页预览/起播才拉到 1，
   * 而效果层没有首页、也可能还没开始放歌 —— 默认 0 的 uAlpha 会让壁纸是纯透明的。
   * 这里把粒子总透明度钉在 1（与首页预览同一条语义），让桌面一开始就有粒子；
   * 有歌时 cover 粒子会照常成形，歌词由播放会话驱动。 */
  function stageEnsureParticleAlpha() {
    try {
      if (typeof uniforms === 'undefined' || !uniforms) return false;
      if (uniforms.uAlpha && Number(uniforms.uAlpha.value) < 0.9) uniforms.uAlpha.value = 1;
      if (uniforms.uFloatAlpha && Number(uniforms.uFloatAlpha.value) < 0.9) uniforms.uFloatAlpha.value = 1;
      return true;
    } catch (_) {
      return false;
    }
  }

  function stageKeepParticlesAlive() {
    stageEnsureParticleAlpha();
    var startedAt = Date.now();
    var timer = setInterval(function () {
      stageEnsureParticleAlpha();
      if (Date.now() - startedAt > 30000) {
        clearInterval(timer);
        timer = 0;
      }
    }, 1000);
  }

  function startStagePageReceiver() {
    var api = stagePageApi();
    if (!api || typeof api.onStageState !== 'function') return false;
    /* 效果层自己必须被当成「壁纸页」：主循环用 fx.wallpaperMode 决定帧率与深度休眠豁免。
     * 只改运行时不落盘 —— 主窗口才是这个开关的所有者。 */
    try { if (typeof fx !== 'undefined' && fx) fx.wallpaperMode = true; } catch (_) {}
    /* 效果层不是开屏：index-loader 在模块注入前会给 html/body 打 splash-active，
     * 这一页没有「点击进入」可点，留着会让依赖它的显隐逻辑（画布透明度、场景 reveal）停在开场态。 */
    try {
      if (document.body) document.body.classList.remove('splash-active');
      document.documentElement.classList.remove('splash-active');
    } catch (_) {}
    api.onStageState(stageHandleState);
    stageHideThreeShelf();
    stageKeepParticlesAlive();
    /* 本地曲库索引只读进来（不抢播放）：本地曲的实时 mineradio-local:// 地址靠它回填，
     * 否则效果层拿到的是主窗口上次的旧地址，放不出声（粒子就静止了）。 */
    if (typeof restorePersistedLocalLibrary === 'function') {
      Promise.resolve(restorePersistedLocalLibrary()).catch(function () {});
    }
    if (typeof api.stageReady === 'function') {
      Promise.resolve(api.stageReady()).catch(function () {});
    }
    /* 曲目切换窗口内主窗口可能还没来得及推 full：500ms 内再要一次当前状态。 */
    setTimeout(function () {
      if (typeof api.stageReady === 'function') Promise.resolve(api.stageReady()).catch(function () {});
    }, 1200);
    return true;
  }

  if (typeof isWallpaperStagePage === 'function' && isWallpaperStagePage()) {
    startStagePageReceiver();
  } else {
    startStageSessionPump();
  }

  var api = {
    STAGE_PULSE_INTERVAL_MS: STAGE_PULSE_INTERVAL_MS,
    STAGE_FULL_REFRESH_MS: STAGE_FULL_REFRESH_MS,
    STAGE_DRIFT_TOLERANCE_S: STAGE_DRIFT_TOLERANCE_S,
    buildStageFullSession: buildStageFullSession,
    stageApplyFull: stageApplyFull,
    stageApplyWorld: stageApplyWorld,
    stageApplyPreset: stageApplyPreset,
    stageApplyFolia: stageApplyFolia,
    buildFoliaStageState: buildFoliaStageState,
    stageHandleState: stageHandleState
  };
  global.MineradioWallpaperStageSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
