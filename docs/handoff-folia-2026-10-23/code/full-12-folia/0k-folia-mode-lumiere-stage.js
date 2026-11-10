/* Folia 绘光（lumiere）上屏驱动 —— 挂 pixi 宿主、按绝对时间推进、换歌就地交接、注册模式。
 *
 * 源文件（Folia: src/components/visualizer/lumiere/）：
 *   VisualizerLumiere.tsx（209）  → 挂载、换歌闸门、tuning / 暂停 / 元数据推送
 *   entry.tsx（28）              → 注册元数据：mode 'lumiere' / order 25 / labelFallback '绘光'
 *   createLumierePixiRuntime.ts（472）→ 已由 0j-folia-lumiere-runtime.js 机械抽出
 *   lumiereProgram.ts / lumiereRuntimeTuning.ts → 同上级共享件（songHandover.ts / types.ts）
 *
 * 必须照抄的判据
 * --------------
 * 1. 歌曲级输入（seed / program / theme）**只从闸门取**，不从 ctx 直取。父层在切歌时先把歌词
 *    清成空数组、几帧后才填进来；跟着 ctx.seed 重建的模式会拿空歌去建场景，然后卡在原地等字。
 *    （闸门逻辑与 tempera 驱动同一份：songHandover.ts 是跨模式共享件，逐条照搬。）
 * 2. 闸门的空集判定**有歧义**：「还在加载」和「本来就是纯器乐」都表现为空。所以空集不提交，
 *    而是看播放位置：真的从头放过了 2s 仍然没词，才判器乐；另有墙钟上限兜底。
 *    **lumiere 的 React 传的是 readyGraceMs: 3000**（tempera 用默认 8000），这里照抄 3000。
 * 3. 换歌**不重建 runtime**：swapSong 两帧交接（stage → commit），换下来的场景排进 retired 队列
 *    一帧销毁一个。整机重建会丢 WebGL 上下文，画面会空掉整个 async 构建期。
 * 4. **器乐不造 ♪ 虚拟行**（与 tempera 的关键差别）：Folia 的绘光外壳明确「不造 ♪ 虚拟行」，
 *    纯音乐时 committedLines 就是空数组，编译出只有间奏镜头的程序，光照照常，只是没有字。
 * 5. 暂停时**只画一帧**：时间没动、又没有交接在飞，就直接 return。配套约束是本项目
 *    「禁止另起 rAF」——lumiere 运行时的 app.start()/app.stop() 已按 tempera 的先例打补丁去掉，
 *    渲染完全由世界 tick 驱动（见 0j-folia-lumiere-runtime.js 的补丁注释）。
 * 6. 最后一句唱完后字幕里不再重复它（Folia 的 creditsRecentCompletedLine）：传给字幕层的
 *    lines 去掉末行 —— 那一刻 index 已经是 -1（没有当前行），去掉末行只会让「刚唱完」的
 *    回看落到倒数第二句，与 Folia 的 `recentCompletedLine === finalLine ? null : …` 等价。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 没有 React：闸门从 useEffect + rAF 改成在 tick 里推进，判断函数逐条照搬。
 * 2. currentTime / audioPower / audioBands 是 MotionValue，这里给运行时 `{ get: fn }` 形状的
 *    时钟盒 / 音频盒（盒内值每帧更新），运行时里 `.get()` 的读法不用改。
 * 3. lumiereTuning 从 0l-folia-tuning-panel.js 取（调参面板那份，已归一化、对象身份稳定）；
 *    面板模块不在时退回 DEFAULT_LUMIERE_TUNING（types.ts:761，23 项原值照抄）——
 *    依赖缺失也要画得出来。seamlessTransitions 改动会触发重编译 + 交接。
 * 4. pretext 两件套由驱动在 create 之前动态取回并挂到 window.foliaLumierePretext /
 *    window.foliaLumierePretextRich（0j-folia-lumiere-text.js 里是调用时解析的薄包装）。
 * 5. pixi 不走 `await import('pixi.js')`：本项目是 index.html 里的 UMD 全局，
 *    运行时的 loadPixi 桥委托 foliaTemperaRuntime.resolveTemperaPixi()（全局 PIXI + 8.21 补丁）。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaMode !== 'function') return;

  var RUNTIME = window.foliaLumiereRuntime;
  var PROGRAM = window.foliaLumiereProgram;
  /* 依赖没加载时本文件不产出任何东西（也不会把后续模块带崩）。 */
  if (!RUNTIME || !PROGRAM || !RUNTIME.LumierePixiRuntime || !PROGRAM.compileLumiereProgram) return;

  /* types.ts:761 DEFAULT_LUMIERE_TUNING —— 23 项原值，逐字照抄 */
  var DEFAULT_TUNING = {
    lightIntensity: 1,
    audioResponse: 1,
    fogDensity: 1,
    darkField: 0.75,
    moteAmount: 1,
    bloom: 1,
    textBloom: 1,
    unlitOpacity: 0.22,
    windowNeighbors: 2,
    decay: 1,
    echo: 1,
    fogOctaves: 5,
    lineArt: true,
    frontBokeh: true,
    trails: true,
    hideTrails: false,
    seamlessTransitions: true,
    overlayFrame: true,
    textOnly: false,
    keywordColors: true,
    themeIcons: true,
    themeColorMix: 0.3,
    renderQuality: 'full',
  };

  /* songHandover.ts 的两个上限：2s 播放确认判器乐，墙钟兜底。
   * 兜底值取 lumiere 的 React 用法（readyGraceMs: 3000），不是共享缺省 8000。 */
  var INSTRUMENTAL_COMMIT_SECONDS = 2;
  var READY_GRACE_MS = 3000;

  /* 轨迹过渡决定编译结果（整首歌并成一个单元）。它不再是常量：调参面板可以改，
   * 改了就要重编译 + 交接（见 lumiereTick 的 tuning 段）。 */
  function lumiereCompileOptions(tuning) {
    var seamlessTransitions = tuning ? tuning.seamlessTransitions : DEFAULT_TUNING.seamlessTransitions;
    return (RUNTIME.resolveLumiereCompileOptions)
      ? RUNTIME.resolveLumiereCompileOptions({ seamlessTransitions: seamlessTransitions })
      : { seamless: seamlessTransitions };
  }

  /* 当前生效的 tuning：面板模块在时读它的那份（已归一化、对象身份稳定），
   * 不在时退回 DEFAULT_TUNING —— 依赖缺失也不该让样式画不出来。 */
  function lumiereTuning() {
    if (typeof foliaLumiereTuning === 'function') {
      try {
        var tuning = foliaLumiereTuning();
        if (tuning) return tuning;
      } catch (_) {}
    }
    return DEFAULT_TUNING;
  }

  /* ---------------- 换歌闸门（逐条对应 Folia songHandover.ts） ---------------- */

  /* 分词结果的折叠哈希：保存分词会**原地重写** lines（行数、正文都不变，只多出 wordSegments），
   * 只比行数/首行文本的签名看不见这种变化，新的分词就进不了屏幕。
   * 折的是各段**长度**：边界拼回去必然等于整行原文，所以长度就够描述这次切分。 */
  function lumiereHashWordSegments(lines) {
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
  function lumiereLyricsSignature(lines) {
    if (!lines || lines.length === 0) return '';
    var first = lines[0] && lines[0].fullText != null ? lines[0].fullText : '';
    return lines.length + '|' + first + '|' + lumiereHashWordSegments(lines);
  }

  function lumiereDecideSongCommit(input) {
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
  function lumiereIsInstrumentalConfirmed(state, limits) {
    return (state.sawPlaybackReset && state.playbackTime >= limits.instrumentalCommitSeconds)
      || state.elapsedMs >= limits.readyGraceMs;
  }

  /* 主题里真正影响画面的字段。字体栈变了要重建场景（字宽参与排版），
   * 所以不能只把 theme 塞进每帧输入。wordColors / lyricsIcons 也进去：
   * 一个决定关键字着色、一个决定主题图标线稿。 */
  function lumiereThemeKey(theme) {
    var wordColors = (theme && theme.wordColors) || [];
    var icons = (theme && theme.lyricsIcons) || [];
    return [
      theme && theme.primaryColor, theme && theme.secondaryColor, theme && theme.accentColor,
      theme && theme.backgroundColor, theme && theme.fontStack, theme && theme.fontStyle,
      theme && theme.weight, theme && theme.animationIntensity,
      wordColors.join(','), icons.join(','),
    ].join('|');
  }

  /* ---------------- 实例 ---------------- */

  function lumiereCreateInstance(host, ctx) {
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
      /* 音频同理：项目侧 ctx.audio / ctx.audioBands 是每帧重建的普通数字，
       * 包成「读盒」的 MotionValue 形状后一次创建、永久有效（setSources 恒等早退）。 */
      audioBox: { power: 0, bass: 0, treble: 0 },
      committedSeed: seed,
      committedLines: lines,
      lyricsSig: lumiereLyricsSignature(lines),
      isInstrumental: false,
      theme: ctx.theme || {},
      themeKey: lumiereThemeKey(ctx.theme || {}),
      /* 当前生效的 tuning（面板改了就换对象，tick 里比对身份即可）。 */
      tuning: lumiereTuning(),
      showText: ctx.showText !== false,
      swapInFlight: false,
      /* 交接在飞时又被要求交接：记下来，等这次落地再补一次，否则那次换歌会被静默丢掉。 */
      swapPending: false,
      watch: null,
      lastDrawnTime: NaN,
      destroyed: false,
    };
    return inst;
  }

  /* 纯音乐 / 歌词还没到：编译成只有间奏镜头的程序（folia 不给 visualizer 传歌曲时长，
   * 用编译器的缺省时长），光照照常，**不造 ♪ 虚拟行**（与 tempera 的差别，见文件头第 4 条）。
   * showText 关掉时仍按真实歌词编译，镜头节奏跟着歌走，只是不画字。 */
  function lumiereApplyCommitted(inst) {
    var lines = (inst.committedLines && inst.committedLines.length > 0 && !inst.isInstrumental)
      ? inst.committedLines
      : [];
    inst.program = PROGRAM.compileLumiereProgram(lines, inst.committedSeed, {}, lumiereCompileOptions(inst.tuning));
  }

  function lumiereSongContext(inst) {
    return {
      seed: inst.committedSeed,
      program: inst.program,
      theme: inst.theme,
    };
  }

  function lumiereHandOver(inst) {
    if (!inst.runtime) return;
    if (inst.swapInFlight) { inst.swapPending = true; return; }
    inst.swapInFlight = true;
    var done = function () {
      inst.swapInFlight = false;
      if (inst.swapPending && !inst.destroyed) {
        inst.swapPending = false;
        lumiereHandOver(inst);
      }
    };
    inst.runtime.swapSong(lumiereSongContext(inst)).then(done, done);
  }

  /* 闸门的观察段：在这里推进，代替 Folia 的 rAF 循环。 */
  function lumiereAdvanceWatch(inst, ctx, time, now) {
    var watch = inst.watch;
    if (!watch) return;
    if (!watch.sawPlaybackReset && time < 1) watch.sawPlaybackReset = true;
    var settled = lumiereIsInstrumentalConfirmed(
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
    lumiereApplyCommitted(inst);
    lumiereHandOver(inst);
  }

  /* ---------------- 只读调试读数 ----------------
   * 与镜台 / 凝彩同一约定：exe 冒烟和控制台读的是**同一份**运行时状态，不另算一遍，
   * 否则断言就是在自证。无副作用、不写任何字段。
   *
   * 绘光的字是**纹理精灵**（canvas 逐字光栅化后切片，不是 pixi.Text），读不到 .text；
   * 所以内容级判据走显示树：行容器带 `line-N` 标签（text 层建的），其 children 就是逐字精灵，
   * 再加上每个精灵的可见性 / 透明度 / 世界坐标。 */
  function lumiereLineReadings(scene) {
    var out = [];
    var walk = function (node) {
      if (!node || !node.children) return;
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        var label = child.label;
        if (typeof label === 'string' && /^line-\d+$/.test(label)) {
          var glyphs = 0;
          var visible = 0;
          var alphaSum = 0;
          for (var g = 0; g < child.children.length; g++) {
            var sprite = child.children[g];
            glyphs += 1;
            if (sprite.visible && sprite.alpha > 0.004) {
              visible += 1;
              alphaSum += sprite.alpha;
            }
          }
          var first = child.children.length ? child.children[0].getGlobalPosition() : null;
          out.push({
            index: Number(label.slice(5)),
            glyphs: glyphs,
            visible: visible,
            avgAlpha: visible > 0 ? alphaSum / visible : 0,
            holderVisible: !!child.visible,
            x: child.position.x,
            y: child.position.y,
            firstGlyphX: first ? first.x : null,
            firstGlyphY: first ? first.y : null,
          });
          continue;
        }
        walk(child);
      }
    };
    if (scene && scene.text) walk(scene.text);
    return out;
  }

  function lumiereDebugState(inst) {
    if (!inst) return { ready: false };
    var rt = inst.runtime;
    if (!rt) return { ready: false, pending: true };
    var program = rt.options.song.program;
    var paragraphs = (program && program.paragraphs) ? program.paragraphs.length : 0;
    var out = {
      ready: true,
      paragraphs: paragraphs,
      activeParagraph: rt.activeIndex,
      renderResolution: rt.renderResolution,
      width: rt.width,
      height: rt.height,
      stageChildren: (rt.app && rt.app.stage) ? rt.app.stage.children.length : -1,
      canvasConnected: !!(rt.app && rt.app.canvas && rt.app.canvas.isConnected),
      swapActive: !!(rt.songSwap && rt.songSwap.active),
      scenes: (rt.sceneCache && typeof rt.sceneCache.size === 'number') ? rt.sceneCache.size : -1,
      creditsBuilt: !!(rt.credits && rt.credits.built),
      lines: [],
    };
    if (!rt.sceneCache || typeof rt.sceneCache.forEach !== 'function') return out;
    rt.sceneCache.forEach(function (entry, index) {
      if (index !== rt.activeIndex) return;
      var scene = entry.unit && entry.unit.scene;
      out.activeScene = {
        index: index,
        holderVisible: !!entry.holder.visible,
        holderAlpha: entry.holder.alpha,
        textVisible: !!(scene && scene.text && scene.text.visible),
        sceneChildren: (scene && scene.view) ? scene.view.children.length : -1,
      };
      out.lines = lumiereLineReadings(scene);
    });
    return out;
  }

  /* ---------------- create / tick / destroy ---------------- */

  function lumiereCreate(host, ctx) {
    var theme = ctx.theme || {};
    var inst = lumiereCreateInstance(host, ctx);

    /* 等待播放占位（有字要显示但节目里一个段落都没有时才出现；已确认器乐时不提示） */
    var waiting = document.createElement('div');
    waiting.className = 'folia-lumiere-waiting';
    waiting.textContent = '等待播放';
    waiting.style.display = 'none';
    host.appendChild(waiting);
    inst.waiting = waiting;

    /* 副字幕层（译文 / 下一句预览）——pixi 场景里不复制它 */
    try {
      if (typeof foliaCreateSubtitleOverlay === 'function') {
        inst.subtitle = foliaCreateSubtitleOverlay(
          host, theme, typeof foliaResolveSubtitleFontSizes === 'function'
            ? foliaResolveSubtitleFontSizes(ctx.fontScale || 1) : undefined
        );
      }
    } catch (_) {}

    lumiereApplyCommitted(inst);

    var meta = ctx.song || {};

    /* 音频盒：一次性包成 MotionValue 形状，盒内值每帧更新。 */
    var audioBox = inst.audioBox;
    var audioPower = { get: function () { return audioBox.power; } };
    var audioBands = {
      bass: { get: function () { return audioBox.bass; } },
      treble: { get: function () { return audioBox.treble; } },
    };

    /* pretext 两件套只有 ESM 构建，必须先动态取回并注入测量层，否则第一句话量词就抛错。
     * 全仓只此两个 Promise（16-folia-core-pretext.js），反复切样式不会重复拉取。
     * 0j-folia-lumiere-text.js 里的五个包装函数在**调用时**读这两个全局，所以注入必须在
     * 建运行时之前完成（场景构建第一步就是量词）。 */
    var pretextReady = (typeof foliaLoadPretext === 'function' && typeof foliaLoadPretextRich === 'function')
      ? Promise.all([
        foliaLoadPretext().then(function (mod) { window.foliaLumierePretext = mod; }),
        foliaLoadPretextRich().then(function (mod) { window.foliaLumierePretextRich = mod; }),
      ])
      : Promise.reject(new Error('lumiere 需要 foliaLoadPretext / foliaLoadPretextRich'));

    return pretextReady.then(function () {
      return RUNTIME.LumierePixiRuntime.create({
        host: host,
        song: lumiereSongContext(inst),
        tuning: inst.tuning,
        /* 运行时要的就是 `{ get(): number }`。 */
        currentTime: { get: function () { return inst.clock.value; } },
        audioPower: audioPower,
        audioBands: audioBands,
        staticMode: false,
        showText: inst.showText,
        paused: !!ctx.paused,
        metadata: { title: meta.title || '', artist: meta.artist || '', album: meta.album || '' },
      });
    }).then(function (runtime) {
      inst.runtime = runtime;
      inst.lastDrawnTime = NaN;
      inst.debug = function () { return lumiereDebugState(inst); };
      if (inst.waiting) {
        inst.waiting.style.display = inst.program.paragraphs.length === 0 ? 'flex' : 'none';
      }
      return inst;
    }, function (err) {
      if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
      throw err;
    });
  }

  function lumiereTick(inst, ctx) {
    if (!inst || inst.destroyed || !inst.runtime) return;

    var time = Number(ctx.time) || 0;
    var now = Number(ctx.now);
    /* 闸门的兜底挂的是墙钟；ctx.now 缺失（用例里可能不给）时退回 performance.now，
     * 否则 elapsedMs 会是 NaN，兜底永远不触发 —— 那就是一个永不落地的观察段。 */
    if (!isFinite(now)) now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var lines = ctx.lines || [];
    var seed = ctx.seed == null ? '' : String(ctx.seed);
    inst.clock.value = time;
    /* 音频盒：本项目 ctx.audio 是每帧的普通数字，写进盒里即可（MotionValue 包装读盒）。 */
    inst.audioBox.power = (ctx.audio && isFinite(Number(ctx.audio.power))) ? Number(ctx.audio.power) : 0;
    var bands = ctx.audioBands || {};
    inst.audioBox.bass = isFinite(Number(bands.bass)) ? Number(bands.bass) : 0;
    inst.audioBox.treble = isFinite(Number(bands.treble)) ? Number(bands.treble) : 0;

    /* ---- 闸门 ---- */
    var lyricsSig = lumiereLyricsSignature(lines);
    if (inst.watch) lumiereAdvanceWatch(inst, ctx, time, now);

    var decision = lumiereDecideSongCommit({
      seed: seed,
      committedSeed: inst.committedSeed,
      lyricsSignature: lyricsSig,
      committedSignature: lumiereLyricsSignature(inst.committedLines),
      isCommittedInstrumental: inst.isInstrumental
    });

    if (decision.action === 'commit') {
      inst.watch = null;
      inst.committedSeed = seed;
      inst.committedLines = lines.slice();
      inst.lyricsSig = lyricsSig;
      inst.isInstrumental = !!decision.isInstrumental;
      lumiereApplyCommitted(inst);
      lumiereHandOver(inst);
    } else if (decision.action === 'watch' && !inst.watch) {
      inst.watch = { startedAt: now, sawPlaybackReset: false };
    } else if (decision.action === 'idle') {
      inst.watch = null;
    }

    /* ---- 主题变化：同 seed，就地提交（swapSong 的同 seed 快路径不走交接）。 ---- */
    var nextThemeKey = lumiereThemeKey(ctx.theme || {});
    if (nextThemeKey !== inst.themeKey) {
      inst.themeKey = nextThemeKey;
      inst.theme = ctx.theme || {};
      lumiereHandOver(inst);
    }

    /* ---- 调参：面板每次修改都换一个新对象，身份变了才应用（原地改字段会静默失效）。 ---- */
    var tuning = lumiereTuning();
    if (inst.tuning !== tuning) {
      var seamlessChanged = inst.tuning.seamlessTransitions !== tuning.seamlessTransitions;
      inst.tuning = tuning;
      inst.runtime.setTuning(tuning);
      if (seamlessChanged) {
        /* 轨迹过渡折进编译结果（整首歌并成一个单元），改了必须重编译再交接。 */
        lumiereApplyCommitted(inst);
        lumiereHandOver(inst);
      }
    }

    /* ---- 每帧输入 ---- */
    inst.runtime.options.paused = !!ctx.paused;
    if (inst.showText !== (ctx.showText !== false)) {
      inst.showText = ctx.showText !== false;
      inst.runtime.setShowText(inst.showText);
    }
    var meta = ctx.song || {};
    inst.runtime.setSongMetadata({ title: meta.title, artist: meta.artist, album: meta.album });

    if (inst.waiting) {
      /* 只在「有字要显示但节目里一个段落都没有」时提示；
       * 已确认器乐时不提示 —— 那时候画面本来就是间奏光场，再压一行字反而乱。 */
      var showWaiting = ctx.showText !== false && !inst.isInstrumental
        && inst.runtime.options.song.program.paragraphs.length === 0;
      inst.waiting.style.display = showWaiting ? 'flex' : 'none';
    }

    if (inst.subtitle && typeof inst.subtitle.update === 'function') {
      /* 最后一句唱完后字幕不再重复它（Folia 的 creditsRecentCompletedLine）。
       * 判据用渲染结束时间：过了末行的 renderEndTime，「刚唱完」回看必然是末行本身，
       * 这时把末行从传给字幕层的 lines 里去掉；没唱完时一个字都不动。 */
      var subCtx = ctx;
      var finalLine = lines.length ? lines[lines.length - 1] : null;
      if (finalLine && typeof foliaGetLineRenderEndTime === 'function'
        && time > foliaGetLineRenderEndTime(finalLine)) {
        subCtx = {
          now: ctx.now, dt: ctx.dt, time: ctx.time, index: ctx.index,
          lines: lines.slice(0, -1), theme: ctx.theme, audio: ctx.audio,
          audioBands: ctx.audioBands, song: ctx.song, paused: ctx.paused,
          showText: ctx.showText, showTranslation: ctx.showTranslation,
          fontScale: ctx.fontScale, seed: ctx.seed,
        };
      }
      try { inst.subtitle.update(subCtx, ctx.dt); } catch (_) {}
    }

    /* 暂停且时间没动、又没有交接在飞：这一帧与上一帧完全一样，不必重复提交。
     * （尺寸变化由运行时的 ResizeObserver 自己补画一帧。） */
    var swapActive = !!(inst.runtime.songSwap && inst.runtime.songSwap.active);
    if (ctx.paused && !swapActive && inst.lastDrawnTime === time) return;
    inst.lastDrawnTime = time;
    inst.runtime.renderOnce();
  }

  function lumiereDestroy(inst) {
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
   *   ui.visualizerLumiere = 绘光（zh-CN.ts:851）
   *   pickerDescription.visualizer.lumiere = 体积光穿过烟雾与浮尘，歌词像被光一点点照亮的刻字（zh-CN.ts:466）
   *   entry.tsx: order 25 / previewSeed 'lumiere' / usesWordSegmentation true */
  registerFoliaMode('lumiere', {
    name: '绘光',
    desc: '体积光穿过烟雾与浮尘，歌词像被光一点点照亮的刻字',
    order: 25,
    create: lumiereCreate,
    tick: lumiereTick,
    destroy: lumiereDestroy
  });
})();
