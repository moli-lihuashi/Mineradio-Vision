/* Folia 世界 — 歌词样式：流光（classic）
 *
 * 移植自 Folia src/components/visualizer/classic/Visualizer.tsx（+ tuning.ts 默认值）。
 * 这是 Folia 最基础的一套逐词管线，其它模式的时序思路都从它借：
 *   1. 先问运行时「此刻哪一行」→ 2. 读这一行的 renderHints → 3. 按词建松散布局，
 *      每个词自己动，不依赖整行重排。
 *
 * 逐词三态：waiting（未唱到，轻姿态）→ active（正在唱：辉光/正文/涟漪）→ passed（唱完，余辉+漂移）。
 *
 * 布局完全照搬（改动即走形）：
 *   - 容器 70vh 居中、padding 2rem、flex-wrap、max-width 72rem、min-height 300px、perspective
 *   - justify / align / perspective 由「行开始时间」当种子决定（calm 收敛，chaotic 放开）
 *   - 词偏移 x/y 用 sin 哈希的确定性随机；chaotic 时缩放/右边距/对齐更乱
 *   - 非 legacy 布局下按实测字宽算 marginRight，防止缩放+位移时压字
 *   - 整行还有一层呼吸浮动（y/scale 关键帧循环，calm 8.5s / normal 7s / chaotic 5.8s）
 */
'use strict';

(function registerFoliaClassicMode() {
  if (typeof registerFoliaMode !== 'function') return;

  var CLASSIC_TUNING_DEFAULT = {
    enableWordRotation: true,
    breathingFloatMultiplier: 1,
    useLegacyLayout: false,
    wordSpacing: 0.7
  };

  /* 调参（types.ts:398 DEFAULT_CLASSIC_TUNING + 面板 0l1 的流光组）。
   * 每次现取而不是抄一份局部常量：面板改完立刻生效，钳制只在 0l0 的归一化里做一遍。
   * 0l0 没加载（单独跑本文件的逻辑冒烟）时回落到默认值。 */
  function classicTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('classic')
      : CLASSIC_TUNING_DEFAULT;
  }

  function classicJustify(token) {
    if (token === 'justify-start') return 'flex-start';
    if (token === 'justify-end') return 'flex-end';
    if (token === 'justify-around') return 'space-around';
    if (token === 'justify-between') return 'space-between';
    return 'center';
  }

  function classicAlign(token) {
    if (token === 'items-start') return 'flex-start';
    if (token === 'items-end') return 'flex-end';
    return 'center';
  }

  /* Folia 的确定性哈希随机：同一个 seed 每次算出同样的值，时间只影响状态不影响几何。 */
  function classicRandom(seed, offset) {
    var x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  }

  function classicPixelFontSize(fontScale, viewportWidth) {
    var rem = 16;
    var minPx = 2.25 * fontScale * rem;
    var valPx = (6 * fontScale * viewportWidth) / 100;
    var maxPx = 4.5 * fontScale * rem;
    return Math.max(minPx, Math.min(valPx, maxPx));
  }

  /* 一气算出整行的词配置（与 Folia useMemo 的产物一一对应）。 */
  function classicBuildLayout(line, displayWords, theme, fontScale, viewportWidth) {
    var tuning = classicTuning();
    var seed = line.startTime;
    var intensity = theme.animationIntensity || 'normal';
    var isChaotic = intensity === 'chaotic';
    var isCalm = intensity === 'calm';

    var justifyOptions = isCalm
      ? ['justify-center']
      : ['justify-start', 'justify-center', 'justify-end', 'justify-around', 'justify-between'];
    var alignOptions = isCalm ? ['items-center'] : ['items-start', 'items-center', 'items-end'];

    var isInterlude = line.fullText === '......';

    var lineConfig = {
      justifyContent: isInterlude ? 'justify-center' : justifyOptions[Math.floor(seed % justifyOptions.length)],
      alignItems: alignOptions[Math.floor((seed * 2) % alignOptions.length)],
      perspective: isChaotic ? 500 + (seed % 500) : 1000
    };

    var fontStack = theme.fontStack;
    var fontWeight = foliaResolveThemeFontWeight(theme, 700);
    var pxFontSize = classicPixelFontSize(fontScale, viewportWidth);
    var wordWidths = displayWords.map(function (w) {
      return foliaMeasureWordWidth(w.text, pxFontSize, fontStack, fontWeight);
    });

    var baseSpread = isChaotic ? 60 : (isCalm ? 0 : 20);
    var baseRotate = isChaotic ? 30 : (isCalm ? 0 : 5);

    var wordConfigs = displayWords.map(function (w, i) {
      var wordSeed = seed + i;
      var rnd = function (offset) { return classicRandom(wordSeed, offset); };

      if (isInterlude) {
        return {
          id: w.text + '-' + i + '-' + seed,
          x: 0,
          y: (rnd(2) - 0.5) * 15,
          rotate: 0,
          scale: 1.5,
          marginRight: '3rem',
          alignSelf: 'center',
          passedRotate: 0
        };
      }

      var wordConfigScale = isChaotic ? 0.8 + rnd(4) * 0.6 : 1.1 + rnd(4) * 0.2;
      var xVal = (rnd(1) - 0.5) * baseSpread * 2;
      var yVal = (rnd(2) - 0.5) * baseSpread * 2;
      var marginRight = isChaotic ? (rnd(5) * 1.5) + 'rem' : '0.8rem';

      if (!tuning.useLegacyLayout) {
        var w_i = wordWidths[i] || 0;
        var s_i = wordConfigScale * 1.4;

        var w_next = 0;
        var s_next = 1.0;
        var x_next = 0;

        if (i + 1 < displayWords.length) {
          var nextSeed = seed + (i + 1);
          var nextRnd = function (offset) { return classicRandom(nextSeed, offset); };
          var nextConfigScale = isChaotic ? 0.8 + nextRnd(4) * 0.6 : 1.1 + nextRnd(4) * 0.2;
          s_next = nextConfigScale * 1.4;
          x_next = (nextRnd(1) - 0.5) * baseSpread * 2;
          w_next = wordWidths[i + 1] || 0;
        }

        var spacingMultiplier = tuning.wordSpacing;
        var gap = 0.05 * pxFontSize;
        var halfOverflowI = w_i * (s_i - 1) / 2;
        var halfOverflowNext = w_next * (s_next - 1) / 2;
        var xOffsetDiff = xVal - x_next;

        var calculatedMargin = (halfOverflowI + halfOverflowNext + xOffsetDiff + gap) * spacingMultiplier;
        var minMargin = (isChaotic ? 0.08 * pxFontSize : 0.12 * pxFontSize) * spacingMultiplier;
        var finalMargin = Math.max(minMargin, calculatedMargin);
        marginRight = finalMargin.toFixed(1) + 'px';
      }

      return {
        id: w.text + '-' + i + '-' + seed,
        x: xVal,
        y: yVal,
        rotate: tuning.enableWordRotation ? (rnd(3) - 0.5) * baseRotate * 2 : 0,
        scale: wordConfigScale,
        marginRight: marginRight,
        alignSelf: (isChaotic && rnd(6) > 0.7) ? (rnd(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
        passedRotate: tuning.enableWordRotation ? (rnd(8) - 0.5) * 45 : 0
      };
    });

    return { lineConfig: lineConfig, wordConfigs: wordConfigs };
  }

  /* 整行呼吸浮动：Folia 是 motion.div 的 y/scale 关键帧循环。 */
  var CLASSIC_FLOAT = {
    calm: { distance: 10, duration: 8.5 },
    normal: { distance: 14, duration: 7 },
    chaotic: { distance: 18, duration: 5.8 }
  };

  function classicApplyFloat(inst, ctx, dt) {
    var intensity = ctx.theme.animationIntensity || 'normal';
    var cfg = CLASSIC_FLOAT[intensity] || CLASSIC_FLOAT.normal;
    var multiplier = classicTuning().breathingFloatMultiplier;
    if (!(multiplier > 0)) {
      inst.stage.style.transform = 'none';
      return;
    }
    var distance = cfg.distance * multiplier;
    inst.floatClock = (inst.floatClock + dt) % cfg.duration;
    var p = inst.floatClock / cfg.duration;
    var y = foliaSampleKeyframes(
      [0, -distance, 0, distance * 0.45, 0],
      [0, 0.25, 0.5, 0.75, 1],
      foliaEase('easeInOut'),
      p
    );
    var sc = foliaSampleKeyframes(
      [1, 1 + 0.01 * multiplier, 1, 1 - 0.005 * multiplier, 1],
      [0, 0.25, 0.5, 0.75, 1],
      foliaEase('easeInOut'),
      p
    );
    inst.stage.style.transform = 'translate3d(0, ' + y.toFixed(2) + 'px, 0) scale(' + sc.toFixed(4) + ')';
  }

  function classicBuildLine(inst, ctx) {
    var line = ctx.lines[ctx.index];
    if (!line) return null;

    var displayWords = foliaDisplayWordsForLine(line, classicTuning().useLegacyLayout);
    if (!displayWords.length) return null;

    var viewportWidth = window.innerWidth || 1200;
    var layout = classicBuildLayout(line, displayWords, ctx.theme, ctx.fontScale || 1, viewportWidth);
    var profile = foliaResolveGlowWordRenderProfile(line);

    var el = document.createElement('div');
    el.className = 'folia-classic-line';
    el.style.justifyContent = classicJustify(layout.lineConfig.justifyContent);
    el.style.alignItems = classicAlign(layout.lineConfig.alignItems);
    el.style.perspective = layout.lineConfig.perspective + 'px';

    var mainFontSize = foliaClampFontSize(2.25, 6, 4.5, ctx.fontScale || 1);
    var words = [];

    for (var i = 0; i < displayWords.length; i++) {
      var word = displayWords[i];
      var config = layout.wordConfigs[i];
      if (!config) continue;
      var gw = foliaCreateGlowWord({
        word: word,
        config: config,
        theme: ctx.theme,
        renderProfile: profile,
        fontSize: mainFontSize,
        layoutStyle: { marginRight: config.marginRight, alignSelf: config.alignSelf },
        baseColor: ctx.theme.primaryColor,
        activeColor: foliaResolveWordColor(word.text, ctx.theme.wordColors, ctx.theme.accentColor),
        isChorus: !!line.isChorus,
        enableWordRotation: classicTuning().enableWordRotation
      });
      el.appendChild(gw.el);
      words.push(gw);
    }

    var motion = foliaGlowLineContainerMotion(profile).enter;
    var anim = foliaAnimCreate();
    anim.snap('opacity', motion.opacity);
    anim.snap('scale', motion.scale);
    anim.snap('blur', motion.blur);
    el.style.transformOrigin = 'center';
    anim.to('opacity', 1, { duration: motion.duration, ease: motion.ease });
    anim.to('scale', 1, { duration: motion.duration, ease: motion.ease });
    anim.to('blur', 0, { duration: motion.duration, ease: motion.ease });

    return { el: el, words: words, anim: anim, profile: profile };
  }

  function classicWriteLineFrame(entry) {
    var o = entry.anim.v.opacity;
    var s = entry.anim.v.scale;
    var b = entry.anim.v.blur;
    entry.el.style.opacity = String(isFinite(o) ? o : 1);
    entry.el.style.transform = 'scale(' + (isFinite(s) ? s : 1).toFixed(4) + ')';
    entry.el.style.filter = b > 0.05 ? 'blur(' + b.toFixed(2) + 'px)' : 'none';
  }

  function classicRetireLine(inst, entry) {
    var exit = foliaGlowLineContainerMotion(entry.profile).exit;
    entry.exiting = true;
    entry.exitLeft = exit.duration || 0.01;
    entry.anim.to('opacity', exit.opacity, { duration: exit.duration, ease: exit.ease });
    entry.anim.to('scale', exit.scale, { duration: exit.duration, ease: exit.ease });
    entry.anim.to('blur', exit.blur, { duration: exit.duration, ease: exit.ease });
    inst.exiting.push(entry);
  }

  registerFoliaMode('classic', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerClassic = 流光，entry.tsx order 30。 */
    name: '流光',
    desc: '单行大字居中，逐字旋转点亮，整行随呼吸轻浮',
    order: 30,

    create: function (host, ctx) {
      var root = document.createElement('div');
      root.className = 'folia-classic';

      var stage = document.createElement('div');
      stage.className = 'folia-classic-stage';
      root.appendChild(stage);

      var waiting = document.createElement('div');
      waiting.className = 'folia-classic-waiting';
      waiting.style.color = ctx.theme.secondaryColor;
      waiting.style.fontFamily = ctx.theme.fontStack;
      waiting.style.fontSize = foliaClampFontSize(1.5, 3.5, 2.25, ctx.fontScale || 1);
      waiting.textContent = '等待播放';
      root.appendChild(waiting);

      host.appendChild(root);

      var inst = {
        root: root,
        stage: stage,
        waiting: waiting,
        subtitle: foliaCreateSubtitleOverlay(host, ctx.theme),
        current: null,
        exiting: [],
        lineIndex: -2,
        floatClock: 0,
        theme: ctx.theme,
        tuning: classicTuning()
      };

      return inst;
    },

    tick: function (inst, ctx) {
      classicApplyFloat(inst, ctx, ctx.dt);

      /* 调参改过：词距 / 旋转 / 排版都要重算，当前行按新参数重建一次。
       * 按对象身份判（0l0 每次修改都换新对象），不比字段——比字段会漏「改回同值」的那次。 */
      var tuning = classicTuning();
      if (tuning !== inst.tuning) {
        inst.tuning = tuning;
        inst.forceRebuild = true;
      }

      if (ctx.theme !== inst.theme || ctx.index !== inst.lineIndex || inst.forceRebuild) {
        inst.theme = ctx.theme;
        inst.forceRebuild = false;
        inst.lineIndex = ctx.index;
        if (inst.current) {
          classicRetireLine(inst, inst.current);
          inst.current = null;
        }
        if (ctx.index >= 0) {
          inst.current = classicBuildLine(inst, ctx);
          if (inst.current) inst.stage.appendChild(inst.current.el);
        }
      }

      inst.waiting.style.display = (inst.current || !ctx.showText) ? 'none' : '';

      if (inst.current) {
        if (inst.current.anim.step(ctx.dt)) classicWriteLineFrame(inst.current);
        for (var i = 0; i < inst.current.words.length; i++) {
          inst.current.words[i].update(ctx.time, ctx.dt);
        }
      }

      for (var k = inst.exiting.length - 1; k >= 0; k--) {
        var entry = inst.exiting[k];
        entry.anim.step(ctx.dt);
        classicWriteLineFrame(entry);
        entry.exitLeft -= ctx.dt;
        if (entry.exitLeft <= 0) {
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
          inst.exiting.splice(k, 1);
        }
      }

      inst.subtitle.update(ctx, ctx.dt);
    },

    destroy: function (inst) {
      if (!inst) return;
      if (inst.subtitle) inst.subtitle.destroy();
      if (inst.current && inst.current.words) {
        for (var i = 0; i < inst.current.words.length; i++) inst.current.words[i].destroy();
      }
      if (inst.exiting) {
        for (var k = 0; k < inst.exiting.length; k++) {
          if (inst.exiting[k].el.parentNode) inst.exiting[k].el.parentNode.removeChild(inst.exiting[k].el);
        }
        inst.exiting.length = 0;
      }
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.current = null;
      inst.root = null;
      inst.stage = null;
      inst.waiting = null;
    }
  });
})();
