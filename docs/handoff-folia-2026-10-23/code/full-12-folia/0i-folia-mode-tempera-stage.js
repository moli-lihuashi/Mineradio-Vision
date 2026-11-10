/* Folia 凝彩（tempera）上屏驱动 —— 挂 pixi 宿主、按绝对时间推进、换歌就地交接、注册模式。
 *
 * 源文件（Folia: src/components/visualizer/tempera/）：
 *   VisualizerTempera.tsx（291）→ 挂载、换歌、参数推送、暂停
 *   songHandover.ts（236）      → 「屏幕上到底是哪首歌」的闸门
 *   上级共享件：pixiRuntimeHost.ts（重建时机）/ runtime.ts / pixiDisplayResources.ts
 *
 * 必须照抄的判据
 * --------------
 * 1. 歌曲级的输入（seed / program / theme / coverColors）**只从闸门取**，不从 ctx 直取。
 *    父层在切歌时先把歌词清成空数组、几帧后才填进来；跟着 ctx.seed 重建的模式会拿空歌
 *    去建场景，然后卡在原地等字。
 * 2. 闸门的空集判定是**有歧义**的：「还在加载」和「本来就是纯器乐」都表现为空。
 *    所以空集不提交，而是去看播放位置：真的从头放过了 2s 仍然没词，才判器乐；
 *    另有 8s 墙钟上限兜底（播放时间不前进时闸门不会永远挂着）。
 * 3. 换歌**不重建 runtime**：`swapSong` 用两帧交接（stage → commit），换下来的场景
 *    排进 retired 队列一帧销毁一个。整机重建会丢 WebGL 上下文，画面会空掉整个 async 构建期。
 * 4. 重建只在两件事上发生：`lyricsFontScale` 与 `staticMode` 变化 —— 它们被烘进每个字的
 *    排版里（settleTime / 字号），改不了就得重建；其余参数（镜头、字动效）每帧现读。
 * 5. `paused` 时**只画一帧**：时间没动、又没有交接在跑，就直接 return，不重复提交同一帧。
 *    这是本项目「不启自带 ticker」的配套约束 —— 渲染由世界 tick 驱动，暂停就该真的停。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 没有 React：闸门从 `useEffect + rAF` 改成在 `tick` 里推进，判断函数逐条照搬。
 * 2. `currentTime` 是 MotionValue，这里给运行时一个 `{ get: fn }` 形状的时钟，
 *    运行时里两处 `options.currentTime.get()` 因此不用改。
 * 3. `temperaTuning` 从 0l0 取（面板 0l1 写在那里），建实例时读一次、之后在 tick 里
 *    按对象身份热更（见 temperaApplyTuning）。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaMode !== 'function') return;

  var RUNTIME = window.foliaTemperaRuntime;
  var PROGRAM = window.foliaTemperaProgram;
  var TEXT = window.foliaTemperaText;
  /* 依赖没加载时本文件不产出任何东西（也不会把后续模块带崩）。 */
  if (!RUNTIME || !PROGRAM || !TEXT) return;

  /* Folia types.ts:674 DEFAULT_TEMPERA_TUNING：调参被面板（0l1）改过就以存档为准。 */
  var DEFAULT_TUNING = RUNTIME.DEFAULT_TEMPERA_TUNING;

  function temperaTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('tempera')
      : DEFAULT_TUNING;
  }

  /* songHandover.ts 的两个上限：2s 播放确认判器乐，8s 墙钟兜底。 */
  var INSTRUMENTAL_COMMIT_SECONDS = 2;
  var READY_GRACE_MS = 8000;

  /* ---------------- 换歌闸门（逐条对应 Folia songHandover.ts） ---------------- */

  /* 分词结果的折叠哈希：保存分词会**原地重写** lines（行数、正文都不变，只多出
   * wordSegments），只比行数/首行文本的签名看不见这种变化，新的分词就进不了屏幕。
   * 折的是各段**长度**：边界拼回去必然等于整行原文，所以长度就够描述这次切分。 */
  function temperaHashWordSegments(lines) {
    var hash = 2166136261;
    function mix(value) {
      hash = Math.imul(hash ^ value, 16777619);
    }
    for (var i = 0; i < lines.length; i++) {
      var segments = lines[i] && lines[i].wordSegments;
      if (!segments) continue;
      mix(i);
      for (var j = 0; j < segments.length; j++) mix(segments[j].length);
    }
    return hash >>> 0;
  }

  /* 空串 = 「没有词」，故意不区分「还在加载」与「器乐」——那只能靠播放来分辨。 */
  function temperaLyricsSignature(lines) {
    if (!lines || lines.length === 0) return '';
    var first = lines[0] && lines[0].fullText != null ? lines[0].fullText : '';
    return lines.length + '|' + first + '|' + temperaHashWordSegments(lines);
  }

  function temperaDecideSongCommit(input) {
    var seed = input.seed;
    var committedSeed = input.committedSeed;
    var lyricsSignature = input.lyricsSignature;
    var committedSignature = input.committedSignature;
    var isCommittedInstrumental = input.isCommittedInstrumental;

    if (seed === committedSeed) {
      if (lyricsSignature === '') {
        /* 词的消失永远不是关于这首歌的消息，那是父层夹在两首之间；
         * 在这里提交空集会闪一下「等待播放」，而这首歌的歌词其实早就缓存好了。 */
        if (isCommittedInstrumental) return { action: 'idle' };
        /* 已提交的词继续挂在屏幕上，同时观察播放：一直是空集（歌词被过滤光 / 重新处理成空）
         * 就落成器乐；新词落地则取消观察。 */
        return { action: 'watch' };
      }
      /* 同一首歌、不同的词：迟到的加载或重新处理，就地接进来。 */
      if (lyricsSignature !== committedSignature) return { action: 'commit', isInstrumental: false };
      return { action: 'idle' };
    }

    /* 新歌要等它的词**真的不同**才上台：seed 比 lines 早一帧翻转，
     * 相同的签名说明那是上一首的歌还躺在入参里。 */
    if (lyricsSignature !== '' && lyricsSignature !== committedSignature) {
      return { action: 'commit', isInstrumental: false };
    }
    return { action: 'watch' };
  }

  /* 挂的是**播放时间**而不是墙钟：还在加载的歌没前进过，就继续等它的词；
   * 真放过了这段还没词，才当成器乐。readyGraceMs 是「永远不开始」的逃生口。 */
  function temperaIsInstrumentalConfirmed(state, limits) {
    return (state.sawPlaybackReset && state.playbackTime >= limits.instrumentalCommitSeconds)
      || state.elapsedMs >= limits.readyGraceMs;
  }

  /* 器乐虚词：60 个 ♪ 块，8s 一格、每格 6s —— 给构图层有东西可排，不至于空场。
   * 与 Folia VisualizerTempera 的 virtualLines 同参数。 */
  function temperaBuildVirtualLines() {
    var out = [];
    for (var i = 0; i < 60; i++) {
      out.push({
        id: 'virtual-block-' + i,
        startTime: i * 8,
        endTime: i * 8 + 6,
        fullText: '♪',
        words: [],
        isChorus: false
      });
    }
    return out;
  }

  /* 主题里真正影响画面的字段。字体栈变了要重建场景（字宽参与排版），
   * 所以不能只把 theme 塞进每帧输入。 */
  function temperaThemeKey(theme) {
    return [
      theme.primaryColor, theme.secondaryColor, theme.accentColor, theme.backgroundColor,
      theme.fontStack, theme.translationFontStack, theme.weight, theme.fontStyle,
      theme.animationIntensity
    ].join('|');
  }

  /* ---------------- 实例 ---------------- */

  function temperaCreateInstance(host, ctx) {
    var seed = ctx.seed == null ? '' : String(ctx.seed);
    var lines = (ctx.lines || []).slice();
    var inst = {
      host: host,
      runtime: null,
      subtitle: null,
      waiting: null,
      program: null,
      /* 运行时通过 currentTime.get() 读时间，这里给一个可写的时钟盒，
       * 免得为了本项目去改运行时里那两处读取。 */
      clock: { value: Number(ctx.time) || 0 },
      committedSeed: seed,
      committedLines: lines,
      lyricsSig: temperaLyricsSignature(lines),
      isInstrumental: false,
      theme: ctx.theme || {},
      themeKey: temperaThemeKey(ctx.theme || {}),
      /* 建实例时的调参快照：tick 里比对对象身份，变了就热更（见 temperaApplyTuning）。 */
      tuning: temperaTuning(),
      fontScale: (ctx.fontScale === undefined || ctx.fontScale === null) ? 1 : ctx.fontScale,
      swapInFlight: false,
      /* 交接在飞时又被要求交接：记下来，等这次落地再补一次，否则那次换歌会被静默丢掉。 */
      swapPending: false,
      watch: null,
      lastDrawnTime: NaN,
      destroyed: false
    };
    return inst;
  }

  function temperaApplyCommitted(inst) {
    var lines = (inst.committedLines && inst.committedLines.length > 0)
      ? inst.committedLines
      : (inst.isInstrumental ? temperaBuildVirtualLines() : []);
    inst.program = PROGRAM.compileProgram(lines, inst.committedSeed, {
      wholeLineLyrics: !!temperaTuning().wholeLineLyrics
    });
  }

  function temperaSongContext(inst) {
    return {
      seed: inst.committedSeed,
      program: inst.program,
      theme: inst.theme,
      coverColors: []
    };
  }

  function temperaHandOver(inst) {
    if (!inst.runtime) return;
    if (inst.swapInFlight) { inst.swapPending = true; return; }
    inst.swapInFlight = true;
    var done = function () {
      inst.swapInFlight = false;
      if (inst.swapPending && !inst.destroyed) {
        inst.swapPending = false;
        temperaHandOver(inst);
      }
    };
    inst.runtime.swapSong(temperaSongContext(inst)).then(done, done);
  }

  /* 调参变化：热更到活的运行时（Folia VisualizerTempera.tsx:205 的 setTuning effect）。
   * 「整句显示歌词」是**节目编排**的输入（compileProgram 按它切分镜），运行时管不了 ——
   * 它变了要重编节目、再走一次交接，与换歌同一条路（Folia 是 useMemo 依赖它重算 program）。 */
  function temperaApplyTuning(inst) {
    if (!inst.runtime) return;
    var next = inst.tuning;
    var prevWholeLine = !!(inst.runtime.options.tuning && inst.runtime.options.tuning.wholeLineLyrics);
    inst.runtime.setTuning(next);
    if (prevWholeLine !== !!next.wholeLineLyrics) {
      temperaApplyCommitted(inst);
      temperaHandOver(inst);
    }
  }

  /* 闸门的观察段：在这里推进，代替 Folia 的 rAF 循环。 */
  function temperaAdvanceWatch(inst, ctx, time, now) {
    var watch = inst.watch;
    if (!watch) return;
    if (!watch.sawPlaybackReset && time < 1) watch.sawPlaybackReset = true;
    var settled = temperaIsInstrumentalConfirmed(
      { sawPlaybackReset: watch.sawPlaybackReset, playbackTime: time, elapsedMs: now - watch.startedAt },
      { instrumentalCommitSeconds: INSTRUMENTAL_COMMIT_SECONDS, readyGraceMs: READY_GRACE_MS }
    );
    if (!settled) return;
    /* 到这里提交的必然是没有词的歌：这一刻入参里若有这歌的词，上面的判断早就 commit 了。 */
    inst.watch = null;
    inst.committedSeed = ctx.seed == null ? '' : String(ctx.seed);
    inst.committedLines = [];
    inst.lyricsSig = '';
    inst.isInstrumental = true;
    temperaApplyCommitted(inst);
    temperaHandOver(inst);
  }

  /* ---------------- 只读调试读数 ----------------
   * 与镜台 / 商籁同一约定：exe 冒烟和控制台读的是**同一份**运行时状态，不另算一遍，
   * 否则断言就是在自证。无副作用、不写任何字段。 */
  function temperaDebugState(inst) {
    if (!inst) return { ready: false };
    var rt = inst.runtime;
    if (!rt) return { ready: false, pending: true };
    var program = rt.options.program;
    var paragraphs = (program && program.paragraphs) ? program.paragraphs.length : 0;
    var out = {
      ready: true,
      paragraphs: paragraphs,
      activeParagraph: rt.activeParagraphIndex,
      renderResolution: rt.renderResolution,
      width: rt.lastWidth,
      height: rt.lastHeight,
      stageChildren: (rt.app && rt.app.stage) ? rt.app.stage.children.length : -1,
      sceneChildren: rt.sceneContainer ? rt.sceneContainer.children.length : -1,
      canvasConnected: !!(rt.app && rt.app.canvas && rt.app.canvas.isConnected),
      swapActive: !!(rt.songSwap && rt.songSwap.active),
      shot: null
    };
    var scene = null;
    if (rt.sceneCache && typeof rt.sceneCache.forEach === 'function') {
      rt.sceneCache.forEach(function (s, index) { if (index === rt.activeParagraphIndex) scene = s; });
    }
    if (!scene || !scene.shots || !scene.shots.length) return out;
    var shotIndex = scene.activeShotIndex;
    var shot = (shotIndex >= 0 && scene.shots[shotIndex]) ? scene.shots[shotIndex] : scene.shots[0];
    var filters = (shot.textLayer && shot.textLayer.filters) ? shot.textLayer.filters : null;
    var filter = filters && filters.length ? filters[0] : null;
    var rootFilters = (scene.container.filters && scene.container.filters.length) ? scene.container.filters : null;
    /* 内容级读数只认 glyph 的 display：文字层里还混着阴影片、回声和装饰/水印碎字，
     * 把 children 的 text 全拼起来会得到「候时的的时候座一一」这种串，看不出是不是这一句。 */
    var glyphTexts = [];
    if (shot.glyphs) {
      for (var gi = 0; gi < shot.glyphs.length; gi += 1) {
        var g = shot.glyphs[gi];
        if (g && g.display && typeof g.display.text === 'string') glyphTexts.push(g.display.text);
      }
    }
    out.shot = {
      index: shotIndex,
      visible: !!shot.container.visible,
      glyphs: shot.glyphs ? shot.glyphs.length : -1,
      textChildren: shot.textLayer ? shot.textLayer.children.length : -1,
      blockChildren: (shot.blocks && shot.blocks.container) ? shot.blocks.container.children.length : -1,
      glyphTexts: glyphTexts,
      textFilterCount: filters ? filters.length : 0,
      /* 反色滤镜必须是 'inherit'：写成固定 1，输入纹理与 uBackTexture 像素尺寸不一致，
       * vTextureCoord 在两张图上索到不同位置，细网点上会出现成片的错误翻色。 */
      textFilterResolution: filter ? String(filter.resolution) : 'none',
      textFilterBlendRequired: filter ? !!filter.blendRequired : false,
      /* 后处理链（grain / contrast / vignette / rgbShift / lens）本来就挂在场景根上，
       * 所以「根上有滤镜」是对的；要断言的是**反色滤镜不在根上** —— 它在根上就是视口大小的 blit。 */
      rootFilterCount: rootFilters ? rootFilters.length : 0,
      postProcessFilterCount: scene.postProcessFilters ? scene.postProcessFilters.length : -1,
      rootHasTextFilter: !!(rootFilters && filter && rootFilters.indexOf(filter) >= 0),
      x: shot.container.position.x,
      y: shot.container.position.y,
      rotation: shot.container.rotation,
      scale: shot.container.scale.x,
      revealDoneTime: shot.revealDoneTime
    };
    return out;
  }

  /* ---------------- create / tick / destroy ---------------- */

  function temperaCreate(host, ctx) {
    var theme = ctx.theme || {};
    var inst = temperaCreateInstance(host, ctx);

    /* 等待播放占位（首行之前 / 纯器乐确认之前是隐藏的，由 tick 切） */
    var waiting = document.createElement('div');
    waiting.className = 'folia-tempera-waiting';
    waiting.textContent = '等待播放';
    waiting.style.display = 'none';
    host.appendChild(waiting);
    inst.waiting = waiting;

    /* 副标题层（译文 / 下一句预览）——pixi 场景里不复制它 */
    try {
      if (typeof foliaCreateSubtitleOverlay === 'function') {
        inst.subtitle = foliaCreateSubtitleOverlay(
          host, theme, typeof foliaResolveSubtitleFontSizes === 'function'
            ? foliaResolveSubtitleFontSizes(ctx.fontScale || 1) : undefined
        );
      }
    } catch (_) {}

    temperaApplyCommitted(inst);

    var meta = ctx.song || {};

    /* pretext 只有 ESM 构建，必须先动态取回并注入测量层，否则第一句话量词就会抛错。
     * 全仓只此一个 Promise（16-folia-core-pretext.js），反复切样式不会重复拉取。 */
    var pretextReady = (typeof foliaLoadPretext === 'function')
      ? foliaLoadPretext().then(function (mod) {
        TEXT.setTemperaPretext(mod);
        return null;
      })
      : Promise.reject(new Error('tempera 需要 foliaLoadPretext'));

    return pretextReady.then(function () {
      return RUNTIME.TemperaPixiRuntime.create({
        host: host,
        songSeed: inst.committedSeed,
        program: inst.program,
        theme: theme,
        tuning: temperaTuning(),
        /* 运行时要的就是 `{ get(): number }`。 */
        currentTime: { get: function () { return inst.clock.value; } },
        lyricsFontScale: inst.fontScale,
        staticMode: false,
        coverColors: [],
        imageBlobs: undefined,
        paused: !!ctx.paused,
        songTitle: meta.title || '',
        songArtist: meta.artist || '',
        songAlbum: meta.album || ''
      });
    }).then(function (runtime) {
      inst.runtime = runtime;
      inst.lastDrawnTime = NaN;
      inst.debug = function () { return temperaDebugState(inst); };
      if (inst.waiting) {
        inst.waiting.style.display = inst.program.paragraphs.length === 0 ? 'flex' : 'none';
      }
      return inst;
    }, function (err) {
      if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
      throw err;
    });
  }

  function temperaTick(inst, ctx) {
    if (!inst || inst.destroyed || !inst.runtime) return;

    var time = Number(ctx.time) || 0;
    var now = Number(ctx.now);
    /* 闸门的 8s 兜底挂的是墙钟；ctx.now 缺失（用例里可能不给）时退回 performance.now，
     * 否则 elapsedMs 会是 NaN，兜底永远不触发 —— 那就是一个永不落地的观察段。 */
    if (!isFinite(now)) now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var lines = ctx.lines || [];
    var seed = ctx.seed == null ? '' : String(ctx.seed);
    inst.clock.value = time;

    /* ---- 闸门 ---- */
    var lyricsSig = temperaLyricsSignature(lines);
    if (inst.watch) temperaAdvanceWatch(inst, ctx, time, now);

    var decision = temperaDecideSongCommit({
      seed: seed,
      committedSeed: inst.committedSeed,
      lyricsSignature: lyricsSig,
      committedSignature: temperaLyricsSignature(inst.committedLines),
      isCommittedInstrumental: inst.isInstrumental
    });

    if (decision.action === 'commit') {
      inst.watch = null;
      inst.committedSeed = seed;
      inst.committedLines = lines.slice();
      inst.lyricsSig = lyricsSig;
      inst.isInstrumental = !!decision.isInstrumental;
      temperaApplyCommitted(inst);
      temperaHandOver(inst);
    } else if (decision.action === 'watch' && !inst.watch) {
      inst.watch = { startedAt: now, sawPlaybackReset: false };
    } else if (decision.action === 'idle') {
      inst.watch = null;
    }

    /* ---- 主题变化：同 seed，就地提交（swapSong 的同 seed 快路径不走交接）。 ---- */
    var nextThemeKey = temperaThemeKey(ctx.theme || {});
    if (nextThemeKey !== inst.themeKey) {
      inst.themeKey = nextThemeKey;
      inst.theme = ctx.theme || {};
      temperaHandOver(inst);
    }

    /* ---- 调参变化：热更到活的运行时（整句显示变了要重编节目，见 temperaApplyTuning）。 ---- */
    var nextTuning = temperaTuning();
    if (nextTuning !== inst.tuning) {
      inst.tuning = nextTuning;
      temperaApplyTuning(inst);
    }

    /* ---- 每帧输入 ---- */
    inst.runtime.options.paused = !!ctx.paused;
    inst.runtime.options.lyricsFontScale = inst.fontScale;
    var meta = ctx.song || {};
    inst.runtime.setSongMetadata({ title: meta.title, artist: meta.artist, album: meta.album });

    if (inst.waiting) {
      /* 只在「有字要显示但节目里一个段落都没有」时提示；
       * 已确认器乐时不提示 —— 那时候画面本来就是 ♪ 块，再压一行字反而乱。 */
      var showWaiting = ctx.showText !== false && !inst.isInstrumental
        && inst.runtime.options.program.paragraphs.length === 0;
      inst.waiting.style.display = showWaiting ? 'flex' : 'none';
    }

    if (inst.subtitle && typeof inst.subtitle.update === 'function') {
      try { inst.subtitle.update(ctx, ctx.dt); } catch (_) {}
    }

    /* 暂停且时间没动、又没有交接在飞：这一帧与上一帧完全一样，不必重复提交。
     * （尺寸变化由运行时的 ResizeObserver 自己补画一帧。） */
    var swapActive = !!(inst.runtime.songSwap && inst.runtime.songSwap.active);
    if (ctx.paused && !swapActive && inst.lastDrawnTime === time) return;
    inst.lastDrawnTime = time;
    inst.runtime.renderOnce();
  }

  function temperaDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    inst.watch = null;
    if (inst.runtime) {
      try { inst.runtime.destroy(); } catch (_) {}
      inst.runtime = null;
    }
    if (inst.subtitle && typeof inst.subtitle.destroy === 'function') {
      try { inst.subtitle.destroy(); } catch (_) {}
    }
    if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
  }

  /* 名字 / 描述 / 排序取 Folia 权威值：
   *   ui.visualizerTempera = 凝彩（zh-CN.ts:850）
   *   pickerDescription.visualizer.tempera = 成片的色块与细密网点缓缓重组，歌词压过颜色时翻出反色
   *   entry.tsx: order 20 / previewSeed 'tempera' / usesWordSegmentation true */
  registerFoliaMode('tempera', {
    name: '凝彩',
    desc: '成片的色块与细密网点缓缓重组，歌词压过颜色时翻出反色',
    order: 20,
    create: temperaCreate,
    tick: temperaTick,
    destroy: temperaDestroy
  });
})();
