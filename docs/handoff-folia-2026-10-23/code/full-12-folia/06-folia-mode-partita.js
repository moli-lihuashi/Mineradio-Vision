/* Folia 世界 — 歌词样式：云阶（partita）
 *
 * 移植自 Folia src/components/visualizer/partita/（VisualizerPartita + partitaLayout + PartitaChunk）。
 * 和 classic 一样是逐词管线，但**先把整行切成 chunk 排进列**，再让词在结构里动：
 *   运行时给当前行 → 预热下一行 → 切 chunk → 排进列 → 词在 chunk 内各自起落
 * 结构稳定、词在动，是这个样式的全部要点。
 *
 * 照搬的关键数值：
 *   - 行数 = min(布局单元数, floor(窗口高*0.65 / 100))，chunk 长度故意不等分（等分会显得机械）
 *   - 错位：偶数行往左、奇数行往右，幅度 staggerMin..staggerMax 之间随机（默认 20..100）
 *   - 每行相对中心的垂直偏移 rowBias*2.5；chaotic 才有旋转 ±3° 与字数量带来的缩放
 *   - 引导线：偶数行画左侧、奇数行画右侧（竖线 32px + 横线 100%+36px），
 *     active 时用高亮色并带辉光，passed 时退成 0.22 白，waiting 时 0.14 白且不显示
 *   - 字号按整行字素密度整体降 0.8（>40 字素），否则长句会溢出
 */
'use strict';

(function registerFoliaPartitaMode() {
  if (typeof registerFoliaMode !== 'function') return;

  var PARTITA_TUNING_DEFAULT = {
    showGuideLines: true,
    useSemanticLayout: true,
    staggerMin: 20,
    staggerMax: 100
  };

  /* 调参（types.ts:428 DEFAULT_PARTITA_TUNING + 面板 0l1 的云阶组）。
   * 现取，不抄局部常量：面板改完立刻生效；0l0 未加载时回落默认值。 */
  function partitaTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('partita')
      : PARTITA_TUNING_DEFAULT;
  }

  var PARTITA_WORD_LAYOUT_STYLE = { marginRight: '0.8rem' };

  function partitaCache(layoutCache, key, build) {
    var hit = layoutCache.get(key);
    if (hit) return hit;
    var value = build();
    if (layoutCache.size > 48) layoutCache.clear();
    layoutCache.set(key, value);
    return value;
  }

  function partitaLayoutKey(line, theme, windowHeight) {
    var tuning = partitaTuning();
    return [
      line.startTime,
      line.endTime,
      (line.words || []).length,
      line.fullText,
      theme.animationIntensity,
      theme.weight,
      Math.round(windowHeight / 24),
      tuning.showGuideLines ? 1 : 0,
      tuning.useSemanticLayout ? 1 : 0,
      tuning.staggerMin,
      tuning.staggerMax
    ].join('|');
  }

  /* 把一行切成 chunk 并排进列（Folia buildSequentialColumns 的逐行对应）。 */
  function partitaBuildLayout(line, theme, windowHeight) {
    var intensity = theme.animationIntensity || 'normal';
    var isChaotic = intensity === 'chaotic';
    var isCalm = intensity === 'calm';

    var totalGraphemes = Math.max(
      foliaSplitGraphemes(String(line.fullText || '').replace(/\s+/g, '')).length,
      (line.words || []).length,
      1
    );

    var layoutUnits = foliaBuildPostLyricLayoutUnits(line, {
      semantic: partitaTuning().useSemanticLayout,
      sticky: true
    });
    if (!layoutUnits.length) layoutUnits = foliaCreateSingleWordLayoutUnits(foliaSynthesizeWordsForLine(line));

    var baseRowHeight = 100;
    var availableHeight = windowHeight * 0.65;
    var targetRowCount = Math.max(1, Math.floor(availableHeight / baseRowHeight));
    var actualRowCount = Math.min(layoutUnits.length, targetRowCount);

    var seed = line.startTime;
    var random = function () {
      var x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    var chunks = [];
    var remainingUnits = layoutUnits.length;
    var remainingChunks = actualRowCount;
    var unitIndex = 0;

    for (var c = 0; c < actualRowCount; c++) {
      var isLastChunk = c === actualRowCount - 1;
      var avg = remainingUnits / remainingChunks;
      var chunkLength = 1;
      if (isLastChunk) {
        chunkLength = remainingUnits;
      } else {
        var maxLen = Math.ceil(avg * 1.5);
        var randVal = random();
        chunkLength = Math.max(1, Math.min(maxLen, Math.round(avg + (randVal - 0.5) * avg)));
      }
      chunkLength = Math.max(1, Math.min(chunkLength, remainingUnits - (remainingChunks - 1)));
      chunks.push(layoutUnits.slice(unitIndex, unitIndex + chunkLength));
      unitIndex += chunkLength;
      remainingUnits -= chunkLength;
      remainingChunks--;
    }

    var rows = [];
    for (var rowIndex = 0; rowIndex < chunks.length; rowIndex++) {
      var chunkUnits = chunks[rowIndex];
      var chunkWords = [];
      for (var u = 0; u < chunkUnits.length; u++) {
        for (var w = 0; w < chunkUnits[u].words.length; w++) chunkWords.push(chunkUnits[u].words[w]);
      }
      var displayWords = foliaBuildDisplayWordsFromLayoutUnits(chunkUnits);
      if (chunkWords.length === 0) continue;

      var mergedText = chunkWords.map(function (word) { return String(word.text || '').trim(); }).join('');
      var graphemeCount = foliaSplitGraphemes(mergedText.replace(/\s+/g, '')).length;
      var rowBias = rowIndex - (actualRowCount - 1) / 2;
      var isStaggeredLeft = rowIndex % 2 === 0;

      var partitaT = partitaTuning();
      var staggerMagnitude = partitaT.staggerMin + random() * Math.max(partitaT.staggerMax - partitaT.staggerMin, 0);
      var staggerX = isStaggeredLeft ? -staggerMagnitude : staggerMagnitude;
      var staggerScale = isCalm ? 1 : 0.8 + random() * 0.9;

      rows.push({
        chunkUnits: chunkUnits,
        chunkWords: chunkWords,
        displayWords: displayWords,
        rowIndex: rowIndex,
        config: {
          id: rowIndex + '-' + chunkWords[0].startTime,
          x: staggerX,
          y: isCalm ? 0 : rowBias * 2.5,
          rotate: isChaotic ? (isStaggeredLeft ? -3 : 3) : 0,
          scale: (isChaotic ? 1 + Math.min(graphemeCount * 0.01, 0.05) : 1) * staggerScale,
          marginBottom: isChaotic ? '0.4rem' : '0.6rem',
          alignSelf: 'center',
          passedRotate: (rowIndex % 2 === 0 ? 1 : -1) * (isChaotic ? 6 : 3)
        }
      });
    }

    return {
      rows: rows,
      totalGraphemes: totalGraphemes,
      perspective: isChaotic ? 720 : 1000
    };
  }

  function partitaGuideColor(status, activeColor) {
    if (status === 'active') return activeColor;
    if (status === 'passed') return 'rgba(255,255,255,0.22)';
    return 'rgba(255,255,255,0.14)';
  }

  /* 一个 chunk：容器位置动画 + 两根引导线 + 内部逐词。 */
  function partitaCreateChunk(row, ctx, fontSize, profile) {
    var theme = ctx.theme;
    var config = row.config;
    var guidePosition = row.rowIndex % 2 === 0 ? 'left' : 'right';
    var activeColor = foliaResolveWordColor(
      row.displayWords.map(function (w) { return w.text; }).join(' '),
      theme.wordColors,
      theme.accentColor
    );

    var el = document.createElement('div');
    el.className = 'folia-partita-chunk';
    el.setAttribute('data-folia-chunk-status', 'waiting');
    el.style.marginBottom = config.marginBottom;
    el.style.alignSelf = config.alignSelf;
    el.style.lineHeight = '1';

    var guideV = null;
    var guideH = null;
    if (partitaTuning().showGuideLines) {
      guideV = document.createElement('span');
      guideV.className = 'folia-partita-guide-v';
      guideV.setAttribute('aria-hidden', 'true');
      guideV.style[guidePosition] = '-8px';
      guideV.style.transformOrigin = 'bottom';
      el.appendChild(guideV);

      guideH = document.createElement('span');
      guideH.className = 'folia-partita-guide-h';
      guideH.setAttribute('aria-hidden', 'true');
      guideH.style[guidePosition] = '-16px';
      guideH.style.transformOrigin = guidePosition;
      el.appendChild(guideH);
    }

    var words = [];
    for (var i = 0; i < row.displayWords.length; i++) {
      var word = row.displayWords[i];
      var wordSeed = row.displayWords[0].startTime + i * 7.13;
      var rnd = function (offset) {
        var v = Math.sin(wordSeed + offset) * 10000;
        return v - Math.floor(v);
      };
      var intensity = theme.animationIntensity || 'normal';
      var isCalm = intensity === 'calm';
      var isChaotic = intensity === 'chaotic';
      var baseSpread = isChaotic ? 15 : (isCalm ? 0 : 6);
      var baseRotate = isChaotic ? 8 : (isCalm ? 0 : 3);

      var gw = foliaCreateGlowWord({
        word: word,
        config: {
          id: config.id + '-w' + i,
          x: (rnd(1) - 0.5) * baseSpread * 2,
          y: (rnd(2) - 0.5) * baseSpread * 2,
          rotate: (rnd(3) - 0.5) * baseRotate * 2,
          scale: config.scale,
          marginBottom: '0',
          alignSelf: 'auto',
          passedRotate: (rnd(8) - 0.5) * 20
        },
        theme: theme,
        renderProfile: profile,
        fontSize: fontSize,
        layoutStyle: PARTITA_WORD_LAYOUT_STYLE,
        baseColor: theme.primaryColor,
        activeColor: foliaResolveWordColor(word.text, theme.wordColors, theme.accentColor),
        isChorus: false,
        enableWordRotation: true
      });
      el.appendChild(gw.el);
      words.push(gw);
    }

    var chunkStartTime = row.chunkWords[0].startTime;
    var lastChunkWord = row.chunkWords[row.chunkWords.length - 1];
    var chunkEndTime = foliaGlowWordActiveEndTime(lastChunkWord, profile);

    var anim = foliaAnimCreate();
    var guideAnim = foliaAnimCreate();
    anim.snap('opacity', 0);
    anim.snap('scale', 0.85);
    anim.snap('x', config.x + (guidePosition === 'left' ? -40 : 40));
    anim.snap('y', config.y);
    anim.snap('rotate', config.rotate);
    guideAnim.snap('scaleAxis', 0);
    guideAnim.snap('opacity', 0);

    function writeFrame() {
      el.style.opacity = String(isFinite(anim.v.opacity) ? anim.v.opacity : 1);
      el.style.transform = 'translate3d(' + (anim.v.x || 0).toFixed(2) + 'px, ' + (anim.v.y || 0).toFixed(2) + 'px, 0)'
        + ' scale(' + (isFinite(anim.v.scale) ? anim.v.scale : 1).toFixed(4) + ')'
        + ' rotate(' + (anim.v.rotate || 0).toFixed(2) + 'deg)';
      var op = String(isFinite(guideAnim.v.opacity) ? guideAnim.v.opacity : 0);
      var axis = (isFinite(guideAnim.v.scaleAxis) ? guideAnim.v.scaleAxis : 0).toFixed(4);
      if (guideV) {
        guideV.style.opacity = op;
        guideV.style.transform = 'scaleY(' + axis + ')';
      }
      if (guideH) {
        guideH.style.opacity = op;
        guideH.style.transform = 'scaleX(' + axis + ')';
      }
    }

    function applyStatus(status) {
      el.setAttribute('data-folia-chunk-status', status);
      var isWaiting = status === 'waiting';
      var isActive = status === 'active';

      var transitionOpts = isActive
        ? { spring: { stiffness: 200, damping: 20, mass: 1 } }
        : { duration: 0.4, ease: 'easeOut' };

      anim.to('opacity', isWaiting ? 0 : 1, isActive ? { duration: 0.1 } : transitionOpts);
      anim.to('scale', isWaiting ? 0.85 : 1, transitionOpts);
      anim.to('x', isWaiting ? (config.x + (guidePosition === 'left' ? -40 : 40)) : config.x, transitionOpts);
      anim.to('y', config.y, transitionOpts);
      anim.to('rotate', config.rotate, transitionOpts);

      var color = partitaGuideColor(status, activeColor);
      var shadowV = isActive ? ('0 0 10px ' + activeColor + '45') : 'none';
      var shadowH = isActive ? ('0 0 10px ' + activeColor + '35') : 'none';
      if (guideV) {
        guideV.style.backgroundColor = color;
        guideV.style.boxShadow = shadowV;
      }
      if (guideH) {
        guideH.style.backgroundColor = color;
        guideH.style.boxShadow = shadowH;
      }
      guideAnim.to('scaleAxis', isWaiting ? 0 : 1, { duration: 0.4, ease: 'easeOut' });
      guideAnim.to('opacity', isWaiting ? 0 : 1, { duration: 0.4, ease: 'easeOut' });
    }

    var status = 'waiting';

    return {
      el: el,
      words: words,
      chunkStartTime: chunkStartTime,
      chunkEndTime: chunkEndTime,
      update: function (time, dt) {
        var next = 'waiting';
        if (time >= chunkStartTime - profile.wordLookahead && time <= chunkEndTime) next = 'active';
        else if (time > chunkEndTime) next = 'passed';
        if (next !== status) {
          status = next;
          applyStatus(status);
        }
        anim.step(dt);
        guideAnim.step(dt);
        writeFrame();
        for (var i = 0; i < words.length; i++) words[i].update(time, dt);
      },
      destroy: function () {
        for (var i = 0; i < words.length; i++) words[i].destroy();
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  /* 整行的呼吸浮动：partita 的 scale 关键帧没有 multiplier（与 classic 不同）。 */
  var PARTITA_FLOAT = {
    calm: { distance: 10, duration: 8.5 },
    normal: { distance: 14, duration: 7 },
    chaotic: { distance: 18, duration: 5.8 }
  };

  function partitaApplyFloat(inst, ctx, dt) {
    var cfg = PARTITA_FLOAT[ctx.theme.animationIntensity] || PARTITA_FLOAT.normal;
    inst.floatClock = (inst.floatClock + dt) % cfg.duration;
    var p = inst.floatClock / cfg.duration;
    var y = foliaSampleKeyframes([0, -cfg.distance, 0, cfg.distance * 0.45, 0], [0, 0.25, 0.5, 0.75, 1], foliaEase('easeInOut'), p);
    var sc = foliaSampleKeyframes([1, 1.01, 1, 0.995, 1], [0, 0.25, 0.5, 0.75, 1], foliaEase('easeInOut'), p);
    inst.stage.style.transform = 'translate3d(0, ' + y.toFixed(2) + 'px, 0) scale(' + sc.toFixed(4) + ')';
  }

  function partitaBuildLine(inst, ctx) {
    var line = ctx.lines[ctx.index];
    if (!line) return null;

    var windowHeight = window.innerHeight || 800;
    var layout = partitaCache(inst.layoutCache, partitaLayoutKey(line, ctx.theme, windowHeight), function () {
      return partitaBuildLayout(line, ctx.theme, windowHeight);
    });
    if (!layout.rows.length) return null;

    var profile = foliaResolveGlowWordRenderProfile(line);
    var densityScale = layout.totalGraphemes > 40 ? 0.8 : 1;
    var fontScale = ctx.fontScale || 1;
    var mainFontSize = foliaClampFontSize(2.5 * densityScale, 5.5 * densityScale, 4.5 * densityScale, fontScale);

    var el = document.createElement('div');
    el.className = 'folia-partita-line';
    el.style.perspective = layout.perspective + 'px';
    el.style.gap = '2rem';
    el.setAttribute('data-folia-partita-density', String(densityScale));

    var column = document.createElement('div');
    column.className = 'folia-partita-column';
    var inner = document.createElement('div');
    inner.className = 'folia-partita-column-inner';
    column.appendChild(inner);
    el.appendChild(column);

    var chunks = [];
    for (var i = 0; i < layout.rows.length; i++) {
      var chunk = partitaCreateChunk(layout.rows[i], ctx, mainFontSize, profile);
      inner.appendChild(chunk.el);
      chunks.push(chunk);
    }

    var motion = foliaGlowLineContainerMotion(profile).enter;
    var anim = foliaAnimCreate();
    anim.snap('opacity', motion.opacity);
    anim.snap('scale', motion.scale);
    anim.snap('blur', motion.blur);
    anim.to('opacity', 1, { duration: motion.duration, ease: motion.ease });
    anim.to('scale', 1, { duration: motion.duration, ease: motion.ease });
    anim.to('blur', 0, { duration: motion.duration, ease: motion.ease });

    return { el: el, chunks: chunks, anim: anim, profile: profile };
  }

  function partitaWriteLineFrame(entry) {
    var o = entry.anim.v.opacity;
    var s = entry.anim.v.scale;
    var b = entry.anim.v.blur;
    entry.el.style.opacity = String(isFinite(o) ? o : 1);
    entry.el.style.transform = 'scale(' + (isFinite(s) ? s : 1).toFixed(4) + ')';
    entry.el.style.filter = b > 0.05 ? 'blur(' + b.toFixed(2) + 'px)' : 'none';
  }

  function partitaRetireLine(inst, entry) {
    var exit = foliaGlowLineContainerMotion(entry.profile).exit;
    entry.exitLeft = exit.duration || 0.01;
    entry.anim.to('opacity', exit.opacity, { duration: exit.duration, ease: exit.ease });
    entry.anim.to('scale', exit.scale, { duration: exit.duration, ease: exit.ease });
    entry.anim.to('blur', exit.blur, { duration: exit.duration, ease: exit.ease });
    inst.exiting.push(entry);
  }

  registerFoliaMode('partita', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerPartita = 云阶，entry.tsx order 50。 */
    name: '云阶',
    desc: '歌词沿引导线逐块错落下行，像一级级云中阶梯',
    order: 50,

    create: function (host, ctx) {
      var root = document.createElement('div');
      root.className = 'folia-partita';

      var stage = document.createElement('div');
      stage.className = 'folia-partita-stage';
      root.appendChild(stage);

      var waiting = document.createElement('div');
      waiting.className = 'folia-partita-waiting';
      waiting.style.color = ctx.theme.secondaryColor;
      waiting.style.fontFamily = ctx.theme.fontStack;
      waiting.style.fontSize = foliaClampFontSize(1.2, 2.8, 1.9, ctx.fontScale || 1);
      waiting.textContent = '等待播放';
      root.appendChild(waiting);

      host.appendChild(root);

      return {
        root: root,
        stage: stage,
        waiting: waiting,
        layoutCache: new Map(),
        subtitle: foliaCreateSubtitleOverlay(host, ctx.theme, {
          translationFontSize: foliaClampFontSize(1.05, 2.2, 1.2, ctx.fontScale || 1),
          upcomingFontSize: foliaClampFontSize(0.875, 1.8, 1, ctx.fontScale || 1)
        }),
        current: null,
        exiting: [],
        lineIndex: -2,
        floatClock: 0,
        theme: ctx.theme,
        tuning: partitaTuning()
      };
    },

    tick: function (inst, ctx) {
      partitaApplyFloat(inst, ctx, ctx.dt);

      /* 调参改过：引导线 / 语义排列 / 错位幅度都会改布局，缓存整块作废并重建当前行。
       * 按对象身份判（0l0 每次修改换新对象）。 */
      var tuning = partitaTuning();
      if (tuning !== inst.tuning) {
        inst.tuning = tuning;
        if (inst.layoutCache) inst.layoutCache.clear();
        inst.forceRebuild = true;
      }

      if (ctx.theme !== inst.theme || ctx.index !== inst.lineIndex || inst.forceRebuild) {
        inst.forceRebuild = false;
        inst.theme = ctx.theme;
        inst.lineIndex = ctx.index;
        if (inst.current) {
          partitaRetireLine(inst, inst.current);
          inst.current = null;
        }
        if (ctx.index >= 0) {
          inst.current = partitaBuildLine(inst, ctx);
          if (inst.current) inst.stage.appendChild(inst.current.el);
        }
      }

      inst.waiting.style.display = (inst.current || !ctx.showText) ? 'none' : '';

      if (inst.current) {
        if (inst.current.anim.step(ctx.dt)) partitaWriteLineFrame(inst.current);
        for (var i = 0; i < inst.current.chunks.length; i++) {
          inst.current.chunks[i].update(ctx.time, ctx.dt);
        }
      }

      for (var k = inst.exiting.length - 1; k >= 0; k--) {
        var entry = inst.exiting[k];
        entry.anim.step(ctx.dt);
        partitaWriteLineFrame(entry);
        entry.exitLeft -= ctx.dt;
        if (entry.exitLeft <= 0) {
          for (var c = 0; c < entry.chunks.length; c++) entry.chunks[c].destroy();
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
          inst.exiting.splice(k, 1);
        }
      }

      inst.subtitle.update(ctx, ctx.dt);
    },

    destroy: function (inst) {
      if (!inst) return;
      if (inst.subtitle) inst.subtitle.destroy();
      if (inst.current && inst.current.chunks) {
        for (var i = 0; i < inst.current.chunks.length; i++) inst.current.chunks[i].destroy();
      }
      if (inst.exiting) {
        for (var k = 0; k < inst.exiting.length; k++) {
          var entry = inst.exiting[k];
          for (var c = 0; c < entry.chunks.length; c++) entry.chunks[c].destroy();
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        }
        inst.exiting.length = 0;
      }
      if (inst.layoutCache) inst.layoutCache.clear();
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.current = null;
      inst.root = null;
      inst.stage = null;
      inst.waiting = null;
    }
  });
})();
