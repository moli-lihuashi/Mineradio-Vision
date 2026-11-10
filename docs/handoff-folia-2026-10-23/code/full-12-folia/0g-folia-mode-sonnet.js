/* Folia 世界 — 歌词样式：商籁（sonnet）
 *
 * 移植自 Folia src/components/visualizer/sonnet/ 的运行时（MG 图库在 0g-folia-sonnet-mg.js）：
 *   types.ts 95 + tuning.ts 10 + entry.tsx 45 + sonnetProgram.ts 265 +
 *   sonnetSceneBuilder.ts 367 + sonnetSceneFrame.ts 74 + sonnetShotFrame.ts 310 +
 *   sonnetTransitions.ts 152 + sonnetMotion.ts 282 + sonnetSemantic.ts 74 +
 *   sonnetCameraTracking.ts 45 + sonnetTypographyLayout.ts 425 +
 *   sonnetTypographyRoles.ts 114 + sonnetShotFlowLayouts.ts 557 +
 *   sonnetPosterBlocksLayout.ts 331 + sonnetGlyphLayout.ts 77 +
 *   sonnetTextViewBuilder.ts 433 + sonnetTextFixedGeo.ts 190 +
 *   sonnetStaffNotation.ts 41 + sonnetStaffView.ts 163 + sonnetGuides.ts 279 +
 *   sonnetFrameDecor.ts 308 + sonnetFrameOverlay.ts 60 + sonnetPostProcess.ts 154 +
 *   sonnetGlitchFilter.ts 70 + sonnetLensFilter.ts 92 + sonnetPrintFilters.ts 128 +
 *   sonnetOutroBlur.ts 49 + sonnetCredits.ts 153 + sonnetTexturePool.ts 67 +
 *   createSonnetPixiRuntime.ts 661 + pixiTextureBudget.ts + pixiSceneCache.ts +
 *   pixiDisplayResources.ts + pixiFilterVertex.ts + pixiFilterPoolCompat.ts +
 *   VisualizerSonnet.tsx 249 + songHandover.ts（换歌闸门）。
 *
 * 画面 = 确定性 PV 导演：整首歌先编译成「段落 → 镜头」两级时间轴（seek 安全、同种子同构图），
 * 每个镜头按 7 种模板之一排版（社论专栏 / 巨字冲击 / 碎片拼贴 / 追踪缎带 / 遮罩揭示 /
 * 海报块 / 静物台），文字是 parser 时序驱动的逐字入场（ExpoOut 打击感 + 法线方向回声鬼影 +
 * 屏幕混合色差），MG 图库（100 个 geo 变体 + 8 HUD + 8 fixedGeo + 6 装饰编排）按 seed 选中，
 * 段落之间用 fast-blur / mono-glitch / camera-pull 三种转场，最后一曲落幕后升起片尾海报。
 *
 * 必须照抄的判据（改一处就整体走形）：
 *   - 段落切分：gap 阈值 = clamp(中位 gap × 2.5, 1.25, 3.5)；超长草稿递归二分
 *     （>6 行或 >18s，取最大 gap 处切，loopGuard 1000）
 *   - 段落分类：chorus（isChorus/songPart）→ break → 最后一段 outro → breath(≤3.5s 或 ≤3 词)
 *     → lift（标点≥2 或 词/秒>2.5）→ verse
 *   - 镜头选型：chooseWithoutRepeat(seed:段:镜:签名)，breath 首镜 ≤2 词强制 quiet-tableau，
 *     chorus 里的 quiet-tableau 改 type-impact
 *   - 镜头参数：x ∈ ±0.09 / y ∈ ±0.07 / rot ∈ ±0.04；zoom 基准 poster 1.02 / tableau 1.12 /
 *     其它 1.22，跨度 0.16 / 0.2 / 0.26
 *   - 字号：max(24, min(112, width / max(7, 词数×2.15) × heroScale × fontScale))，
 *     heroScale = type-impact 1.55 / quiet-tableau 0.82 / 其它 1
 *   - 逐字入场：settle = start + min(1.8, max(0.65, 镜头时长×0.42))，再被 0.72×镜头时长截断；
 *     coreAlpha 0.16→1，haloAlpha 1→0.72，scale 0.86→1（强调角色 + type-impact 时 0.52→1）
 *   - 镜头运动：7 种 kind 各自的 x/y/scale/rotation 帧表；tracking-ribbon / fragment-collage /
 *     quiet-tableau / poster-blocks 走 0.55 匀速 + 0.45 inout 混合，其余三段式（0.18 ExpoOut /
 *     0.6 匀速 / 0.22 二次收尾）
 *   - 呼吸浮动：revealDone 之后 1.2s 淡入，三层不可通约正弦（0.13/0.31、0.11/0.29、0.09、0.07）
 *   - 焦点跟踪：5 点高斯核（1/4/6/4/1，窗 0.12s），>96px 的跳变不被平均
 *   - 转场：shot 边界 enter 时长 clamp(0.14, 0.24, 间隔×0.18)；段落 enter 取前段 transitionOut 时长
 *   - 片尾：lyricExit 1.25s / posterEnter (elapsed-0.38)/1.55s，lyricBlur 上限 18
 *   - 换歌溶解：560ms 盖罩，0.35 进度时 staged 新场景，0.5 时提交
 *
 * 与 Folia 的实现差异（宿主适配，非公式差异）：
 *   1) 帧驱动来自主循环的 foliaWorldTick（本项目铁律：不另起 rAF），pixi app 用
 *      autoStart:false + sharedTicker:false，由 tick 里手动 renderer.render。
 *      暂停时停画（最后一帧留在画布上），但换歌溶解照走完，否则盖子冻在半路。
 *   2) currentTime / audioPower / audioBands 由 ctx 直接给数值（Folia 是 MotionValue）。
 *   3) theme 恒无 name / description / lyricsIcons，wordColors 恒 [] →
 *      [ THEME ] 装饰文字与关键词着色路径存在但永不命中。
 *   4) 本项目没有 React / mod 层 → 换歌闸门（songHandover）与 setTuning / setModulation
 *      由宿主内联实现；tuning 取 DEFAULT_SONNET_TUNING（调参 UI 是后续路线项）。
 *   5) theme.weight 已经是 100~900 的整十数，foliaNormalizeFontWeight 仍照调（幂等）。
 *   6) measureText 用 foliaLoadPretext() 常驻模块，失败即 create reject（无可重算兜底）。
 */
(function () {
  'use strict';

  if (typeof registerFoliaMode !== 'function') return;
  if (typeof PIXI === 'undefined') return; /* vendor/folia/pixi/pixi.min.js 未加载 */

  /* ============================== 1. 常量 ============================== */

  var SONNET_SONG_SWAP_MS = 560;
  var SONNET_SWAP_STAGE_PROGRESS = 0.35;

  var SONNET_SHOT_KINDS = [
    'editorial-column',
    'type-impact',
    'fragment-collage',
    'tracking-ribbon',
    'mask-reveal',
    'poster-blocks',
    'quiet-tableau'
  ];

  var SONNET_TRANSITION_KINDS = ['fast-blur', 'mono-glitch', 'camera-pull'];

  /* Folia types.ts:560 DEFAULT_SONNET_TUNING —— 面板（0l1）与归一化（0l0）用的同一份基准。 */
  var SONNET_TUNING_DEFAULT = {
    cameraIntensity: 1,
    typographyMotion: 1,
    mgDensity: 1,
    showOnlyText: false,
    showGuide: true,
    showBackgroundMg: true,
    showFixedGeo: true,
    showGiantDecorativeText: true,
    showBackgroundDecor: true,
    enableTransitions: true,
    outerFrameMode: 'full',
    textureResolution: 1.5,
    postProcessEnabled: false,
    postProcessGrain: 0.2,
    postProcessContrast: 0,
    postProcessRgbShift: 0,
    postProcessHalftone: 0,
    postProcessVignette: 0.85,
    postProcessLensDistortion: 0.3,
    postProcessLensDispersion: 0.6
  };

  /* 当前生效的调参：面板写在 0l0（共用存档），这里只读。0l0 还没加载时回落默认值。 */
  function sonnetTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('sonnet')
      : SONNET_TUNING_DEFAULT;
  }

  /* VisualizerSonnet.tsx：纯器乐生成 60 条 ♪ 虚词，每条 8s（= La Folia 循环）。 */
  var SONNET_INSTRUMENTAL_LINE_COUNT = 60;
  var SONNET_INSTRUMENTAL_CYCLE_SECONDS = 8;

  /* songHandover.ts */
  var SONNET_INSTRUMENTAL_COMMIT_SECONDS = 2;
  var SONNET_READY_GRACE_MS = 8000;

  /* pixiTextureBudget.ts */
  var SONNET_TEXTURE_POOL_MAX_RESOLUTION_DROP = 0.25;

  /* pixiFilterVertex.ts：Pixi 8 自定义 Filter 共用的顶点着色器。 */
  var SONNET_FILTER_VERTEX = [
    'in vec2 aPosition;',
    'out vec2 vTextureCoord;',
    '',
    'uniform vec4 uInputSize;',
    'uniform vec4 uOutputFrame;',
    'uniform vec4 uOutputTexture;',
    '',
    'void main(void) {',
    '    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;',
    '    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;',
    '    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;',
    '    gl_Position = vec4(position, 0.0, 1.0);',
    '    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);',
    '}'
  ].join('\n');

  /* ============================== 2. 共享工具 ============================== */

  function sonnetClamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function sonnetClamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  /* Folia hashSonnetSeed = visualizerSeedHash.hashVisualizerSeed，本项目 foliaHashString 同构。 */
  function sonnetHashSeed(value) {
    return foliaHashString(value);
  }

  function sonnetMaxOf(values, fallback) {
    var best = fallback;
    for (var i = 0; i < values.length; i++) {
      if (!isFinite(Number(values[i]))) continue;
      if (best === undefined || values[i] > best) best = values[i];
    }
    return best === undefined ? 0 : best;
  }

  /* ---- 纹理池分辨率吸附（pixiTextureBudget.ts，逐字同构） ---- */

  function sonnetNextPow2(value) {
    var v = value + (value === 0 ? 1 : 0);
    v -= 1;
    v |= v >>> 1;
    v |= v >>> 2;
    v |= v >>> 4;
    v |= v >>> 8;
    v |= v >>> 16;
    return v + 1;
  }

  function sonnetTexturePoolAxis(cssSize, resolution) {
    return sonnetNextPow2(Math.ceil(cssSize * resolution - 1e-6));
  }

  function sonnetStepDownCandidate(cssSize, resolution) {
    var bucket = sonnetTexturePoolAxis(cssSize, resolution);
    if (bucket < 2) return null;
    return bucket / 2 / cssSize;
  }

  function sonnetSnapResolution(cssWidth, cssHeight, resolution, maxDrop) {
    var drop = maxDrop === undefined ? SONNET_TEXTURE_POOL_MAX_RESOLUTION_DROP : maxDrop;
    if (![cssWidth, cssHeight, resolution].every(function (v) {
      return isFinite(Number(v)) && Number(v) > 0;
    })) return resolution;
    var lowest = resolution * (1 - Math.min(Math.max(drop, 0), 1));
    var candidates = [
      sonnetStepDownCandidate(cssWidth, resolution),
      sonnetStepDownCandidate(cssHeight, resolution)
    ].filter(function (candidate) {
      return candidate !== null && candidate > 0 && candidate < resolution && candidate >= lowest;
    });
    var best = resolution;
    var bestArea = sonnetTexturePoolAxis(cssWidth, resolution) * sonnetTexturePoolAxis(cssHeight, resolution);
    candidates.forEach(function (candidate) {
      var area = sonnetTexturePoolAxis(cssWidth, candidate) * sonnetTexturePoolAxis(cssHeight, candidate);
      if (area >= bestArea) return;
      bestArea = area;
      best = candidate;
    });
    return best;
  }

  /* ---- 显示树释放（pixiDisplayResources.ts） ---- */

  function sonnetUnloadDisplayTree(root) {
    var stack = (root && root.children) ? root.children.slice() : [];
    while (stack.length > 0) {
      var node = stack.pop();
      if (node.children && node.children.length) {
        for (var i = 0; i < node.children.length; i++) stack.push(node.children[i]);
      }
      if (node.context && typeof node.context.unload === 'function') node.context.unload();
      if (typeof node.unload === 'function') node.unload();
    }
  }

  function sonnetDestroyDisplayTree(root) {
    var order = [];
    var stack = [root];
    while (stack.length > 0) {
      var node = stack.pop();
      order.push(node);
      if (node.children && node.children.length) {
        for (var i = 0; i < node.children.length; i++) stack.push(node.children[i]);
      }
    }
    for (var j = order.length - 1; j >= 0; j--) {
      if (typeof order[j].destroy === 'function') order[j].destroy();
    }
  }

  function sonnetDestroyContainerChildren(container) {
    var removed = container.removeChildren();
    for (var i = 0; i < removed.length; i++) sonnetDestroyDisplayTree(removed[i]);
  }

  /* ---- 量字宽（sonnetTypographyLayout.ts 的带缓存版，值与非缓存版逐字节相同） ---- */

  var SONNET_MEASURE_CACHE_LIMIT = 20000;
  var sonnetMeasureCache = new Map();
  var sonnetPretext = null;

  function sonnetMeasureText(text, fontSpec, fontSize) {
    var key = fontSpec + '|' + fontSize + '|' + text;
    var cached = sonnetMeasureCache.get(key);
    if (cached !== undefined) return cached;
    var width;
    try {
      var layout = sonnetPretext.layoutWithLines(
        sonnetPretext.prepareWithSegments(text || ' ', fontSpec),
        99999,
        fontSize * 1.2
      );
      width = (layout.lines[0] && layout.lines[0].width) != null
        ? layout.lines[0].width
        : text.length * fontSize * 0.6;
    } catch (_) {
      width = text.length * fontSize * 0.6;
    }
    if (sonnetMeasureCache.size >= SONNET_MEASURE_CACHE_LIMIT) {
      var oldest = sonnetMeasureCache.keys().next();
      if (!oldest.done) sonnetMeasureCache.delete(oldest.value);
    }
    sonnetMeasureCache.set(key, width);
    return width;
  }

  /* ============================== 3. 语义分段与字素时间轴 ============================== */
  /* sonnetSemantic.ts + graphemeTiming.ts：把词级时序无损映射回整行（含间隔与标点）。 */

  /* Folia buildEvenGraphemeTimings：等分时长，最后一格吃满 endTime。 */
  function sonnetBuildEvenGraphemeTimings(text, startTime, endTime, wordIndex) {
    var graphemes = foliaSplitGraphemes(text);
    if (graphemes.length === 0) return [];
    var duration = Math.max(endTime - startTime, 0);
    var unit = duration / graphemes.length;
    var out = [];
    for (var i = 0; i < graphemes.length; i++) {
      var item = {
        char: graphemes[i],
        startTime: startTime + unit * i,
        endTime: i === graphemes.length - 1 ? endTime : startTime + unit * (i + 1)
      };
      if (typeof wordIndex === 'number') item.wordIndex = wordIndex;
      out.push(item);
    }
    return out;
  }

  /* Folia buildWordGraphemeTimings：有音节按音节等分，否则整词等分。 */
  function sonnetBuildWordGraphemeTimings(word, wordIndex) {
    if (!word) return [];
    if (word.syllables && word.syllables.length) {
      var out = [];
      for (var i = 0; i < word.syllables.length; i++) {
        var syl = word.syllables[i];
        var timings = sonnetBuildEvenGraphemeTimings(syl.text, syl.startTime, syl.endTime);
        for (var k = 0; k < timings.length; k++) out.push(timings[k]);
      }
      return out;
    }
    return sonnetBuildEvenGraphemeTimings(word.text, word.startTime, word.endTime, wordIndex);
  }

  /* Folia findGraphemeSequence：在 source 里从 fromIndex 起找 target 序列。 */
  function sonnetFindGraphemeSequence(source, target, fromIndex) {
    if (target.length === 0) return fromIndex;
    for (var index = fromIndex; index <= source.length - target.length; index++) {
      var matched = true;
      for (var t = 0; t < target.length; t++) {
        if (source[index + t] !== target[t]) { matched = false; break; }
      }
      if (matched) return index;
    }
    return -1;
  }

  /* Folia buildLineGraphemeTimeline：词级时序映射回整行。 */
  function sonnetBuildLineGraphemeTimeline(line) {
    var lineGraphemes = foliaSplitGraphemes(line ? line.fullText : '');
    if (lineGraphemes.length === 0) return [];
    var words = (line && line.words) ? line.words : [];
    if (words.length === 0) {
      return sonnetBuildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }

    var timeline = new Array(lineGraphemes.length);
    var cursor = 0;
    var lastResolvedTime = line.startTime;

    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      var wordGraphemes = foliaSplitGraphemes(word.text);
      if (wordGraphemes.length === 0) continue;

      var matchedStart = sonnetFindGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

      for (var gap = cursor; gap < start; gap++) {
        timeline[gap] = { char: lineGraphemes[gap], startTime: word.startTime, endTime: word.startTime };
      }

      var wordTimings = sonnetBuildWordGraphemeTimings(word, w);
      for (var local = 0; local < end - start; local++) {
        var timing = wordTimings[local]
          || sonnetBuildEvenGraphemeTimings(wordGraphemes[local] || '', word.startTime, word.endTime, w)[0];
        if (!timing) continue;
        var entry = {
          char: lineGraphemes[start + local],
          startTime: timing.startTime,
          endTime: timing.endTime
        };
        if (typeof timing.wordIndex === 'number') entry.wordIndex = timing.wordIndex;
        timeline[start + local] = entry;
        if (timing.endTime > lastResolvedTime) lastResolvedTime = timing.endTime;
      }
      if (end > cursor) cursor = end;
    }

    for (var i = 0; i < lineGraphemes.length; i++) {
      if (timeline[i]) continue;
      timeline[i] = { char: lineGraphemes[i], startTime: lastResolvedTime, endTime: lastResolvedTime };
    }
    return timeline;
  }

  /* sonnetSemantic.timingForRange：显示偏移 → parser 字素时序。 */
  function sonnetTimingForRange(line, startOffset, endOffset, timeline, ranges) {
    var indices = [];
    for (var i = 0; i < ranges.length; i++) {
      if (ranges[i].end > startOffset && ranges[i].start < endOffset) indices.push(i);
    }
    var graphemes = [];
    for (var g = 0; g < indices.length; g++) {
      if (timeline[indices[g]]) graphemes.push(timeline[indices[g]]);
    }
    var wordIndices = [];
    for (var h = 0; h < graphemes.length; h++) {
      if (typeof graphemes[h].wordIndex === 'number' && wordIndices.indexOf(graphemes[h].wordIndex) < 0) {
        wordIndices.push(graphemes[h].wordIndex);
      }
    }
    return {
      graphemes: graphemes,
      wordIndices: wordIndices,
      startTime: graphemes.length ? graphemes[0].startTime : line.startTime,
      endTime: graphemes.length ? graphemes[graphemes.length - 1].endTime : line.endTime
    };
  }

  /* sonnetSemantic.buildSonnetSemanticSegments：无损语义分段。 */
  function sonnetBuildSemanticSegments(line) {
    if (!line.fullText) return [];
    var timeline = sonnetBuildLineGraphemeTimeline(line);
    var ranges = [];
    var cursor = 0;
    var graphemeList = foliaSplitGraphemes(line.fullText);
    for (var i = 0; i < graphemeList.length; i++) {
      ranges.push({ start: cursor, end: cursor + graphemeList[i].length });
      cursor += graphemeList[i].length;
    }
    var parts = foliaSegmentLyricWords(line);
    var segments = [];
    for (var index = 0; index < parts.length; index++) {
      var startOffset = parts[index].index;
      var endOffset = index + 1 < parts.length ? parts[index + 1].index : line.fullText.length;
      var timing = sonnetTimingForRange(line, startOffset, endOffset, timeline, ranges);
      segments.push({
        text: line.fullText.slice(startOffset, endOffset),
        startOffset: startOffset,
        endOffset: endOffset,
        startTime: timing.startTime,
        endTime: timing.endTime,
        wordIndices: timing.wordIndices,
        graphemes: timing.graphemes,
        isWordLike: parts[index].isWordLike
      });
    }

    /* 非词样的粘连段并入前一段（标点/空白不单独成段）。 */
    var sticky = [];
    for (var s = 0; s < segments.length; s++) {
      var segment = segments[s];
      var previous = sticky.length ? sticky[sticky.length - 1] : null;
      if (previous && !segment.isWordLike && !/^\s+$/u.test(segment.text)) {
        previous.text += segment.text;
        previous.endOffset = segment.endOffset;
        previous.endTime = Math.max(previous.endTime, segment.endTime);
        previous.graphemes = previous.graphemes.concat(segment.graphemes);
        var merged = previous.wordIndices;
        for (var m = 0; m < segment.wordIndices.length; m++) {
          if (merged.indexOf(segment.wordIndices[m]) < 0) merged.push(segment.wordIndices[m]);
        }
        previous.wordIndices = merged;
      } else {
        sticky.push({
          text: segment.text,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          startTime: segment.startTime,
          endTime: segment.endTime,
          wordIndices: segment.wordIndices.slice(),
          graphemes: segment.graphemes.slice(),
          isWordLike: segment.isWordLike
        });
      }
    }
    return sticky;
  }

  /* ============================== 4. 节目编译 ============================== */
  /* sonnetProgram.ts：整首歌编译成 seek 安全、确定性的 PV 时间轴。 */

  var SONNET_DEBUG_SHOT_KIND = null;

  function sonnetMedian(values) {
    if (values.length === 0) return 0.5;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] != null ? sorted[middle - 1] : sorted[middle]) + sorted[middle]) / 2
      : sorted[middle];
  }

  function sonnetResolveParagraphGapThreshold(lines) {
    var gaps = [];
    for (var index = 1; index < lines.length; index++) {
      var line = lines[index];
      var prevEnd = foliaGetLineRenderEndTime(lines[index - 1]);
      var gap = line.startTime - Math.min(prevEnd, line.startTime);
      if (gap > 0) gaps.push(gap);
    }
    return sonnetClamp(sonnetMedian(gaps) * 2.5, 1.25, 3.5);
  }

  /* 本项目 lines 没有 blockIndex / songPart → metadata 边界永不命中，只剩 time-gap。 */
  function sonnetMetadataChanged(previous, next) {
    return (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
      || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart);
  }

  function sonnetSplitOversizedDraft(draft) {
    var output = [];
    var remaining = draft.lines;
    var boundary = draft.boundary;
    var loopGuard = 0;
    while (remaining.length > 6
      || (remaining.length > 1 && remaining[remaining.length - 1].renderEndTime - remaining[0].line.startTime > 18)) {
      if (loopGuard++ > 1000) {
        console.error('sonnetSplitOversizedDraft: Infinite loop detected, breaking');
        break;
      }
      var middle = remaining.slice(2, -1);
      var candidates = [];
      for (var offset = 0; offset < middle.length; offset++) {
        candidates.push({
          splitIndex: offset + 2,
          gap: middle[offset].line.startTime - remaining[offset + 1].renderEndTime
        });
      }
      var valid = candidates.filter(function (c) { return !Number.isNaN(c.gap); });
      var best = null;
      for (var v = 0; v < valid.length; v++) {
        if (!best || valid[v].gap > best.gap) best = valid[v];
      }
      var rawSplitIndex = best ? best.splitIndex : Math.min(4, remaining.length - 1);
      var splitIndex = Math.max(1, rawSplitIndex);

      output.push({ lines: remaining.slice(0, splitIndex), boundary: boundary });
      remaining = remaining.slice(splitIndex);
      boundary = output[output.length - 1].lines.length >= 6 ? 'line-cap' : 'duration-cap';
    }
    output.push({ lines: remaining, boundary: boundary });
    return output;
  }

  function sonnetClassifyParagraph(lines, index, total) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].line.isChorus || /chorus|副歌/i.test(lines[i].line.songPart || '')) return 'chorus';
    }
    for (var b = 0; b < lines.length; b++) {
      if (/bridge|break|間奏|ブリッジ/i.test(lines[b].line.songPart || '')) return 'break';
    }
    if (index === total - 1) return 'outro';
    var duration = lines[lines.length - 1].renderEndTime - lines[0].line.startTime;
    var segmentCount = 0;
    for (var s = 0; s < lines.length; s++) {
      for (var g = 0; g < lines[s].segments.length; g++) {
        if (lines[s].segments[g].isWordLike) segmentCount += 1;
      }
    }
    var punctuationCount = 0;
    for (var p = 0; p < lines.length; p++) {
      var hits = lines[p].line.fullText.match(/[!?！？…]/g);
      punctuationCount += hits ? hits.length : 0;
    }
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
  }

  function sonnetChooseWithoutRepeat(choices, seed, previous) {
    var start = sonnetHashSeed(seed) % choices.length;
    for (var offset = 0; offset < choices.length; offset++) {
      var candidate = choices[(start + offset) % choices.length];
      if (candidate !== previous) return candidate;
    }
    return choices[start];
  }

  function sonnetBuildCues(lines) {
    var segments = [];
    for (var i = 0; i < lines.length; i++) {
      for (var j = 0; j < lines[i].segments.length; j++) {
        if (lines[i].segments[j].text.length > 0) segments.push(lines[i].segments[j]);
      }
    }
    var cues = [];
    for (var index = 0; index < segments.length; index++) {
      cues.push({
        at: segments[index].startTime,
        duration: Math.max(0.08, segments[index].endTime - segments[index].startTime),
        kind: index === segments.length - 1 ? 'accent' : 'enter',
        segmentStart: index,
        segmentEnd: index + 1
      });
    }
    return cues;
  }

  function sonnetGroupShotLines(lines) {
    var groups = [];
    var currentGroup = [];
    var groupStartTime = 0;

    for (var index = 0; index < lines.length; index++) {
      var line = lines[index];
      if (currentGroup.length === 0) {
        currentGroup.push(line);
        groupStartTime = line.line.startTime;
      } else {
        var durationSoFar = line.renderEndTime - groupStartTime;
        /* 最多 4 行、总时长 6 秒，超过就换镜（复用背景 MG）。 */
        if (currentGroup.length < 4 && durationSoFar <= 6.0) {
          currentGroup.push(line);
        } else {
          groups.push(currentGroup);
          currentGroup = [line];
          groupStartTime = line.line.startTime;
        }
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }

  function sonnetBuildShots(lines, kind, paragraphIndex, seed, previousKind) {
    var lastKind = previousKind;
    var groups = sonnetGroupShotLines(lines);
    var shots = [];
    for (var shotIndex = 0; shotIndex < groups.length; shotIndex++) {
      var group = groups[shotIndex];
      var signature = [];
      for (var s = 0; s < group.length; s++) signature.push(group[s].line.fullText);
      var debugShotKind = SONNET_DEBUG_SHOT_KIND;
      var shotKind = debugShotKind
        || sonnetChooseWithoutRepeat(
          SONNET_SHOT_KINDS,
          seed + ':' + paragraphIndex + ':' + shotIndex + ':' + signature.join('|'),
          lastKind
        );
      var wordCount = 0;
      for (var w = 0; w < group.length; w++) {
        for (var g = 0; g < group[w].segments.length; g++) {
          if (group[w].segments[g].isWordLike) wordCount += 1;
        }
      }
      if (debugShotKind === null) {
        if (kind === 'breath' && shotIndex === 0 && wordCount <= 2) shotKind = 'quiet-tableau';
        if (kind === 'chorus' && shotKind === 'quiet-tableau') shotKind = 'type-impact';
      }
      lastKind = shotKind;
      var random = sonnetHashSeed(seed + ':' + paragraphIndex + ':' + shotIndex + ':camera');
      var zoomRandom = ((random >>> 16) & 255) / 255;
      /* 中近景偏置：只有构图优先的版式（poster 分区、静物台）留广角。 */
      var zoomBase = shotKind === 'poster-blocks' ? 1.02 : shotKind === 'quiet-tableau' ? 1.12 : 1.22;
      var zoomSpan = shotKind === 'poster-blocks' ? 0.16 : shotKind === 'quiet-tableau' ? 0.2 : 0.26;
      shots.push({
        id: 'p' + paragraphIndex + '-s' + shotIndex,
        kind: shotKind,
        startTime: group[0].line.startTime,
        endTime: group[group.length - 1].renderEndTime,
        lineIndices: group.map(function (item) { return item.sourceIndex; }),
        cues: sonnetBuildCues(group),
        camera: {
          x: ((random & 255) / 255 - 0.5) * 0.18,
          y: (((random >>> 8) & 255) / 255 - 0.5) * 0.14,
          zoom: zoomBase + zoomRandom * zoomSpan,
          rotation: (((random >>> 24) & 255) / 255 - 0.5) * 0.08
        }
      });
    }
    return shots;
  }

  function sonnetCompileProgram(lines, seed) {
    var compiled = [];
    for (var sourceIndex = 0; sourceIndex < lines.length; sourceIndex++) {
      var line = lines[sourceIndex];
      /* 视觉尾可以超过谱面时长，但绝不伸进下一行。 */
      var nextStart = sourceIndex + 1 < lines.length ? lines[sourceIndex + 1].startTime : Number.POSITIVE_INFINITY;
      compiled.push({
        sourceIndex: sourceIndex,
        line: line,
        renderEndTime: Math.max(line.startTime, Math.min(foliaGetLineRenderEndTime(line), nextStart)),
        segments: sonnetBuildSemanticSegments(line)
      });
    }
    var paragraphGapThreshold = sonnetResolveParagraphGapThreshold(lines);
    var drafts = [];
    var current = { lines: [], boundary: 'song-start' };

    for (var index = 0; index < compiled.length; index++) {
      var previous = compiled[index - 1];
      var gap = previous ? compiled[index].line.startTime - previous.renderEndTime : 0;
      var boundary = previous && sonnetMetadataChanged(previous.line, compiled[index].line)
        ? 'metadata'
        : previous && gap >= paragraphGapThreshold
          ? 'time-gap'
          : null;
      if (boundary && current.lines.length > 0) {
        drafts = drafts.concat(sonnetSplitOversizedDraft(current));
        current = { lines: [], boundary: boundary };
      }
      current.lines.push(compiled[index]);
    }
    if (current.lines.length > 0) drafts = drafts.concat(sonnetSplitOversizedDraft(current));

    var resolvedSeed = String(seed);
    var previousShot = null;
    var previousTransition = null;
    var paragraphs = [];
    for (var d = 0; d < drafts.length; d++) {
      var draft = drafts[d];
      var kind = sonnetClassifyParagraph(draft.lines, d, drafts.length);
      var shots = sonnetBuildShots(draft.lines, kind, d, resolvedSeed, previousShot);
      previousShot = shots.length ? shots[shots.length - 1].kind : previousShot;
      var next = drafts[d + 1];
      var endTime = draft.lines[draft.lines.length - 1].renderEndTime;
      var nextGap = next ? next.lines[0].line.startTime - endTime : 0;
      var transitionKind = next
        ? sonnetChooseWithoutRepeat(SONNET_TRANSITION_KINDS, resolvedSeed + ':' + d + ':transition', previousTransition)
        : null;
      if (transitionKind) previousTransition = transitionKind;
      var transitionDuration = next ? Math.min(0.3, Math.max(0.16, nextGap > 0 ? nextGap * 0.5 : 0.2)) : 0;
      var transitionEndTime = next ? next.lines[0].line.startTime : endTime;
      paragraphs.push({
        id: 'sonnet-p' + d,
        kind: kind,
        boundary: draft.boundary,
        startTime: draft.lines[0].line.startTime,
        endTime: endTime,
        lines: draft.lines,
        shots: shots,
        transitionOut: transitionKind ? {
          kind: transitionKind,
          startTime: Math.max(draft.lines[0].line.startTime, transitionEndTime - transitionDuration),
          endTime: transitionEndTime
        } : null
      });
    }

    return { version: 1, seed: resolvedSeed, paragraphGapThreshold: paragraphGapThreshold, paragraphs: paragraphs };
  }

  function sonnetFindParagraphIndexAtTime(program, time) {
    for (var index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index;
    }
    return 0;
  }

  /* ============================== 5. 运动曲线 ============================== */
  /* sonnetMotion.ts：纯绝对时间求值，直跳 seek 与连续播放完全一致。 */

  function sonnetCubicCoordinate(point1, point2, time) {
    var inverse = 1 - time;
    return 3 * inverse * inverse * time * point1
      + 3 * inverse * time * time * point2
      + time * time * time;
  }

  /* 解 x 曲线再采 y，复刻 CSS cubic-bezier。 */
  function sonnetResolveCubicBezier(x1, y1, x2, y2, value) {
    var target = sonnetClamp01(value);
    if (target === 0 || target === 1) return target;
    var low = 0;
    var high = 1;
    var parameter = target;
    for (var iteration = 0; iteration < 12; iteration += 1) {
      var x = sonnetCubicCoordinate(x1, x2, parameter);
      if (x < target) low = parameter;
      else high = parameter;
      parameter = (low + high) / 2;
    }
    return sonnetCubicCoordinate(y1, y2, parameter);
  }

  function sonnetEaseInOut(value) {
    return sonnetResolveCubicBezier(0.65, 0, 0.35, 1, value);
  }

  function sonnetEaseEnter(value) {
    return sonnetResolveCubicBezier(0.22, 1, 0.36, 1, value);
  }

  /* 高张力 PV 风格缓动 */
  function sonnetEaseExpoOut(value) {
    return value === 1 ? 1 : 1 - Math.pow(2, -10 * value);
  }

  function sonnetEaseElasticOut(value) {
    var p = 0.3;
    return Math.pow(2, -10 * value) * Math.sin((value - p / 4) * (2 * Math.PI) / p) + 1;
  }

  function sonnetResolveAnimationScale(theme) {
    return theme.animationIntensity === 'calm' ? 0.65 : theme.animationIntensity === 'chaotic' ? 1.35 : 1;
  }

  function sonnetResolveShotProgress(shot, time) {
    return sonnetClamp01((time - shot.startTime) / Math.max(shot.endTime - shot.startTime, 0.001));
  }

  function sonnetResolveSegmentProgress(startTime, endTime, time) {
    /* ExpoOut 产生「打击感」的单字入场。 */
    return sonnetEaseExpoOut(sonnetClamp01((time - startTime) / Math.max(endTime - startTime, 0.08)));
  }

  function sonnetResolveSegmentDepth(role, randomValue) {
    if (role !== 'decoration') return 0;
    return randomValue > 0.5
      ? 0.5 + randomValue * 0.8
      : -0.5 - randomValue * 0.8;
  }

  function sonnetResolveSegmentNormalOffset(role, layoutDirection, rotation, fontSize, randomValue) {
    if (role !== 'support') return { x: 0, y: 0 };
    var distance = (Math.min(1, Math.max(0, randomValue)) * 2 - 1) * fontSize * 0.3;
    var normalAngle = rotation + (layoutDirection === 'vertical' ? 0 : Math.PI / 2);
    return {
      x: Math.cos(normalAngle) * distance,
      y: Math.sin(normalAngle) * distance
    };
  }

  var SONNET_CAMERA_SMOOTHING_SAMPLES = [
    { offset: -1, weight: 1 },
    { offset: -0.5, weight: 4 },
    { offset: 0, weight: 6 },
    { offset: 0.5, weight: 4 },
    { offset: 1, weight: 1 }
  ];

  /* 确定性的保边时序平滑，不把镜头运动绑到帧率上。 */
  function sonnetResolveSmoothedCameraFocus(time, startTime, endTime, sampleFocus, smoothingWindow, maxBlendDistance) {
    var window = smoothingWindow === undefined ? 0.12 : smoothingWindow;
    var maxDistance = maxBlendDistance === undefined ? 96 : maxBlendDistance;
    var safeStart = Math.min(startTime, endTime);
    var safeEnd = Math.max(startTime, endTime);
    var radius = Math.max(0, window);
    if (radius === 0 || safeStart === safeEnd) {
      return sampleFocus(Math.min(safeEnd, Math.max(safeStart, time)));
    }

    var samples = SONNET_CAMERA_SMOOTHING_SAMPLES.map(function (entry) {
      var sampleTime = Math.min(safeEnd, Math.max(safeStart, time + entry.offset * radius));
      return { point: sampleFocus(sampleTime), weight: entry.weight };
    });
    var center = samples[2].point;
    var maxDistanceSquared = Math.max(0, maxDistance) * Math.max(0, maxDistance);
    var x = 0;
    var y = 0;
    var totalWeight = 0;
    samples.forEach(function (entry) {
      var dx = entry.point.x - center.x;
      var dy = entry.point.y - center.y;
      var distanceSquared = dx * dx + dy * dy;
      /* 保留有意的构图跳变，不把两个远处的焦点平均掉。 */
      if (distanceSquared > maxDistanceSquared) return;
      x += entry.point.x * entry.weight;
      y += entry.point.y * entry.weight;
      totalWeight += entry.weight;
    });
    if (totalWeight === 0) return { x: center.x, y: center.y };
    return { x: x / totalWeight, y: y / totalWeight };
  }

  /* 稳定的归一化焦点权重，含静默间隙与最后一个字之后的尾巴。 */
  function sonnetResolveFocusWeights(ranges, time, sigma) {
    if (ranges.length === 0) return [];
    var safeSigma = Math.max(0.001, sigma === undefined ? 0.35 : sigma);
    var logWeights = ranges.map(function (range) {
      var startTime = Math.min(range.startTime, range.endTime);
      var endTime = Math.max(range.startTime, range.endTime);
      var distance = time < startTime
        ? startTime - time
        : time > endTime
          ? time - endTime
          : 0;
      return -(distance * distance) / (2 * safeSigma * safeSigma);
    });
    var maxLogWeight = -Infinity;
    for (var i = 0; i < logWeights.length; i++) {
      if (logWeights[i] > maxLogWeight) maxLogWeight = logWeights[i];
    }
    var weights = logWeights.map(function (weight) { return Math.exp(weight - maxLogWeight); });
    var totalWeight = 0;
    for (var t = 0; t < weights.length; t++) totalWeight += weights[t];
    if (totalWeight === 0) {
      var even = [];
      for (var e = 0; e < weights.length; e++) even.push(1 / weights.length);
      return even;
    }
    return weights.map(function (weight) { return weight / totalWeight; });
  }

  /* PV 风格镜头路径：ExpoOut 快速入场、中段近匀速漂移（速度永不为 0）、末段柔和收尾让速给转场。 */
  function sonnetResolveShotPathProgress(kind, progress) {
    var linear = sonnetClamp01(progress);
    if (kind === 'tracking-ribbon' || kind === 'fragment-collage' || kind === 'quiet-tableau' || kind === 'poster-blocks') {
      /* 把匀速漂移混进 inout 曲线，中段永不停滞。 */
      return linear * 0.55 + sonnetEaseInOut(linear) * 0.45;
    }
    if (linear < 0.18) return sonnetEaseExpoOut(linear / 0.18) * 0.22;
    if (linear < 0.78) return 0.22 + ((linear - 0.18) / 0.6) * 0.56;
    var settle = (linear - 0.78) / 0.22;
    return 0.78 + (1 - (1 - settle) * (1 - settle)) * 0.22;
  }

  /* 每个镜头一条刻意设计的、seek 安全的运动路径，不靠音频抖动。
   * 帧表逐字照抄 Folia 的 resolveShotMotionFrame（fragment-collage 的 y 走正弦，
   * type-impact 的 scale 入场过冲，都不是线性插值）。 */
  var SONNET_SHOT_MOTION_FRAMES = {
    'editorial-column': function (eased) {
      return {
        x: -0.055 + eased * 0.095,
        y: 0.025 - eased * 0.04,
        scale: 0.98 + eased * 0.07,
        rotation: -0.006 + eased * 0.01
      };
    },
    'type-impact': function (eased, linear) {
      return {
        x: -0.035 + eased * 0.07,
        y: 0.018 - eased * 0.028,
        scale: 1 + (1 - sonnetEaseExpoOut(Math.min(linear / 0.18, 1))) * 0.22 + eased * 0.08,
        rotation: -0.01 + eased * 0.016
      };
    },
    'fragment-collage': function (eased) {
      return {
        x: -0.045 + eased * 0.085,
        y: 0.028 - Math.sin(eased * Math.PI) * 0.055,
        scale: 0.97 + eased * 0.09,
        rotation: -0.014 + eased * 0.028
      };
    },
    'tracking-ribbon': function (eased) {
      return {
        x: -0.16 + eased * 0.28,
        y: 0.05 - eased * 0.085,
        scale: 0.98 + eased * 0.07,
        rotation: 0.008 - eased * 0.014
      };
    },
    'mask-reveal': function (eased) {
      return {
        x: 0.035 - eased * 0.065,
        y: 0.1 - eased * 0.135,
        scale: 0.96 + eased * 0.12,
        rotation: -0.006 + eased * 0.009
      };
    },
    'poster-blocks': function (eased) {
      return {
        x: -0.012 + eased * 0.024,
        y: 0.008 - eased * 0.016,
        scale: 0.99 + eased * 0.025,
        rotation: -0.0015 + eased * 0.003
      };
    },
    'quiet-tableau': function (eased) {
      return {
        x: -0.022 + eased * 0.04,
        y: 0.014 - eased * 0.025,
        scale: 1 + eased * 0.028,
        rotation: -0.002 + eased * 0.003
      };
    }
  };

  function sonnetResolveShotMotionFrame(kind, progress) {
    var linear = sonnetClamp01(progress);
    var eased = sonnetResolveShotPathProgress(kind, linear);
    var frame = SONNET_SHOT_MOTION_FRAMES[kind] || SONNET_SHOT_MOTION_FRAMES['editorial-column'];
    return frame(eased, linear);
  }

  var SONNET_CAMERA_BREATH_MAX_OFFSET = 0.006;
  var SONNET_CAMERA_BREATH_MAX_SCALE = 0.002;
  var SONNET_CAMERA_BREATH_MAX_ROTATION = 0.0015;

  /* 确定性的手持呼吸浮动：多层不可通约正弦让漂移有有机感，绝对时间求值让直跳一致。 */
  function sonnetResolveCameraBreath(time, phase) {
    var tau = time * Math.PI * 2;
    var p = phase === undefined ? 0 : phase;
    return {
      x: (Math.sin(tau * 0.13 + p) * 0.65 + Math.sin(tau * 0.31 + p * 1.7) * 0.35)
        * SONNET_CAMERA_BREATH_MAX_OFFSET,
      y: (Math.cos(tau * 0.11 + p * 2.3) * 0.65 + Math.sin(tau * 0.29 + p * 0.9) * 0.35)
        * SONNET_CAMERA_BREATH_MAX_OFFSET,
      scale: Math.sin(tau * 0.09 + p * 1.3) * SONNET_CAMERA_BREATH_MAX_SCALE,
      rotation: Math.sin(tau * 0.07 + p * 2.9) * SONNET_CAMERA_BREATH_MAX_ROTATION
    };
  }

  /* 歌词揭示完成后才把呼吸浮动淡入，避免在一行中间突然出现。 */
  function sonnetResolveBreathWeight(time, revealDoneTime, rampDuration) {
    var ramp = rampDuration === undefined ? 1.2 : rampDuration;
    if (ramp <= 0) return time >= revealDoneTime ? 1 : 0;
    return sonnetEaseInOut(sonnetClamp01((time - revealDoneTime) / ramp));
  }

  /* 纯时间轴伪随机震颤 */
  function sonnetResolveTimelineShake(time, intensity) {
    if (intensity <= 0) return { x: 0, y: 0, rotation: 0 };
    var shakeX = Math.sin(time * 123.456) * Math.cos(time * 789.123);
    var shakeY = Math.cos(time * 345.678) * Math.sin(time * 901.234);
    var shakeRot = Math.sin(time * 567.890);
    return {
      x: shakeX * 0.02 * intensity,
      y: shakeY * 0.02 * intensity,
      rotation: shakeRot * 0.005 * intensity
    };
  }

  /* ============================== 6. 排版：角色 ============================== */
  /* sonnetTypographyRoles.ts：确定性的强调角色选择，与版式模板解耦。 */

  function sonnetIsEmphasisRole(role) {
    return role === 'hero' || role === 'semi-hero';
  }

  /* 自动模式用 Sonnet 设计的角色字重，用户全局手动覆盖优先。 */
  function sonnetResolveRoleFontWeight(configuredFontWeight, role) {
    var manualWeight = foliaNormalizeFontWeight(configuredFontWeight);
    if (manualWeight !== null) return manualWeight;
    if (sonnetIsEmphasisRole(role)) return 900;
    return role === 'decoration' ? 300 : 700;
  }

  function sonnetGetVisibleSegmentLength(segment) {
    var count = 0;
    for (var i = 0; i < segment.graphemes.length; i++) {
      if (segment.graphemes[i].char.trim().length > 0) count += 1;
    }
    return count;
  }

  function sonnetScoreHeroSegment(segment) {
    var lengthScore = Math.min(sonnetGetVisibleSegmentLength(segment), 8) * 14;
    var durationScore = Math.min(2.5, Math.max(0, segment.endTime - segment.startTime)) * 18;
    return lengthScore + durationScore;
  }

  function sonnetFindHeroSegmentIndex(segments) {
    var bestIndex = -1;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].isWordLike) { bestIndex = i; break; }
    }
    var bestScore = -Infinity;
    for (var index = 0; index < segments.length; index++) {
      var segment = segments[index];
      if (!segment.isWordLike || sonnetGetVisibleSegmentLength(segment) === 0) continue;
      var score = sonnetScoreHeroSegment(segment);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return Math.max(0, bestIndex);
  }

  /* 半英雄约束：强调词需要间距、真词胜过虚词、足够长的行才配二级强调。 */
  var SONNET_SEMI_HERO_MIN_GAP = 2;
  var SONNET_SEMI_HERO_MIN_VISIBLE_LENGTH = 2;
  var SONNET_SEMI_HERO_MIN_LINE_WORDS = 4;
  var SONNET_SEMI_HERO_SCORE_RATIO = 0.35;
  var SONNET_SEMI_HERO_MULTI_WORD_COUNT = 9;

  /* 在英雄倾向的对面挑二级强调，构图才平衡；长行在另一侧再拿一个。 */
  function sonnetFindSemiHeroSegmentIndices(segments, heroIndex) {
    var hero = segments[heroIndex];
    if (!hero) return [];
    var wordLikeCount = 0;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].isWordLike && sonnetGetVisibleSegmentLength(segments[i]) > 0) wordLikeCount += 1;
    }
    if (wordLikeCount < SONNET_SEMI_HERO_MIN_LINE_WORDS) return [];

    var threshold = sonnetScoreHeroSegment(hero) * SONNET_SEMI_HERO_SCORE_RATIO;
    var candidates = [];
    for (var index = 0; index < segments.length; index++) {
      var segment = segments[index];
      if (index === heroIndex
        || !segment.isWordLike
        || sonnetGetVisibleSegmentLength(segment) < SONNET_SEMI_HERO_MIN_VISIBLE_LENGTH
        || Math.abs(index - heroIndex) < SONNET_SEMI_HERO_MIN_GAP
        || sonnetScoreHeroSegment(segment) < threshold) continue;
      candidates.push({ segment: segment, index: index });
    }
    if (candidates.length === 0) return [];

    var bestOf = function (list) {
      var best = null;
      for (var b = 0; b < list.length; b++) {
        if (!best || sonnetScoreHeroSegment(list[b].segment) > sonnetScoreHeroSegment(best.segment)) best = list[b];
      }
      return best;
    };

    var heroLeansEarly = heroIndex <= (segments.length - 1) / 2;
    var primarySide = candidates.filter(function (entry) {
      return heroLeansEarly ? entry.index > heroIndex : entry.index < heroIndex;
    });
    var secondarySide = candidates.filter(function (entry) {
      return heroLeansEarly ? entry.index < heroIndex : entry.index > heroIndex;
    });

    var picks = [];
    var primary = bestOf(primarySide) || bestOf(secondarySide);
    if (primary) picks.push(primary.index);
    if (wordLikeCount >= SONNET_SEMI_HERO_MULTI_WORD_COUNT && primary) {
      var secondary = bestOf(secondarySide.filter(function (entry) {
        return Math.abs(entry.index - primary.index) >= SONNET_SEMI_HERO_MIN_GAP;
      }));
      if (secondary) picks.push(secondary.index);
    }
    return picks.sort(function (first, second) { return first - second; });
  }

  function sonnetFindSemiHeroSegmentIndex(segments, heroIndex) {
    var picks = sonnetFindSemiHeroSegmentIndices(segments, heroIndex);
    return picks.length ? picks[0] : -1;
  }

  /* ============================== 7. 排版：字素布局 ============================== */
  /* sonnetGlyphLayout.ts：parser 字素时序 → 最终字形坐标与入场向量。 */

  function sonnetResolveGlyphMotionDuration(startTime, endTime) {
    var shotDuration = Math.max(0.001, endTime - startTime);
    var preferred = Math.min(1.8, Math.max(0.65, shotDuration * 0.42));
    return Math.min(preferred, shotDuration * 0.72);
  }

  function sonnetBuildGlyphLayout(segment, placement, fontSize, measureGlyph, motionStartTime, motionEndTime) {
    var fallbackChars = Array.from(segment.text);
    var graphemes = segment.graphemes.length
      ? segment.graphemes
      : fallbackChars.map(function (char, index) {
        var span = (segment.endTime - segment.startTime) / Math.max(1, fallbackChars.length);
        return {
          char: char,
          startTime: segment.startTime + span * index,
          endTime: segment.startTime + span * (index + 1)
        };
      });
    var advances = graphemes.map(function (item) {
      return placement.vertical ? fontSize * 0.9 : Math.max(fontSize * 0.2, measureGlyph(item.char));
    });
    var totalAdvance = 0;
    for (var a = 0; a < advances.length; a++) totalAdvance += advances[a];
    var motionDuration = sonnetResolveGlyphMotionDuration(motionStartTime, motionEndTime);
    var cursor = -totalAdvance / 2;
    return graphemes.map(function (grapheme, index) {
      var advance = advances[index];
      var localX = placement.vertical ? 0 : cursor + advance / 2;
      var localY = placement.vertical ? cursor + advance / 2 : 0;
      cursor += advance;
      var cosine = Math.cos(placement.rotation);
      var sine = Math.sin(placement.rotation);
      var stagger = index % 2 === 0 ? -1 : 1;
      var startTime = grapheme.startTime;
      var settleTime = startTime + motionDuration;
      return {
        char: grapheme.char,
        baseX: placement.x + localX * cosine - localY * sine,
        baseY: placement.y + localX * sine + localY * cosine,
        enterX: placement.enterX + (placement.vertical ? stagger * fontSize * 0.28 : 0),
        enterY: placement.enterY + (placement.vertical ? 0 : stagger * fontSize * 0.24),
        entryRotation: stagger * (sonnetIsEmphasisRole(placement.role) ? 0.055 : 0.035),
        startTime: startTime,
        settleTime: Math.max(startTime, settleTime)
      };
    });
  }

  /* ============================== 8. 排版：流动版式公共件 ============================== */
  /* sonnetShotFlowLayouts.ts 的公共部分：词间距 / 行间距 / 全局适配重试。 */

  /* 词间距（flowGap）与行 / 列间距（stackGap），所有分支共用。 */
  function sonnetResolveFlowGaps(baseFontSize) {
    var flowGap = sonnetClamp(baseFontSize * 0.35, 16, 40);
    return { flowGap: flowGap, stackGap: Math.max(24, flowGap * 1.35) };
  }

  /* 在逐级收缩的全局缩放上重跑布点，直到每个实测盒子都落进舞台安全区。
   * 所有角色一起缩，hero > semi-hero > support 的层级与「support 从不放大」在每次重试后都成立。 */
  function sonnetPlaceWithGlobalFit(ctx, place) {
    var snapshot = ctx.boxes.map(function (box) {
      return {
        fontScale: box.fontScale,
        measuredWidth: box.measuredWidth,
        measuredHeight: box.measuredHeight
      };
    });
    var safeHalfW = ctx.width * 0.48;
    var safeHalfH = ctx.height * 0.46;
    var ladder = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52];
    for (var rung = 0; rung < ladder.length; rung++) {
      var globalScale = ladder[rung];
      ctx.boxes.forEach(function (box, index) {
        box.fontScale = snapshot[index].fontScale * globalScale;
        box.measuredWidth = snapshot[index].measuredWidth * globalScale;
        box.measuredHeight = snapshot[index].measuredHeight * globalScale;
      });
      place(globalScale);
      var fits = ctx.boxes.every(function (box) {
        return Math.abs(box.x) + box.measuredWidth / 2 <= safeHalfW + 0.5
          && Math.abs(box.y) + box.measuredHeight / 2 <= safeHalfH + 0.5;
      });
      if (fits) return;
    }
  }

  /* 静物台：一列平静的堆叠，英雄之前的词在上方、之后的在下方，整列按时间顺序自上而下读。
   * 超出安全高度时不缩字号，改成向两侧换列：之前的词向右蔓延、之后的向左蔓延，
   * 列与列之间按时间顺序从右往左读。 */
  function sonnetLayoutQuietTableau(ctx, variant) {
    var boxes = ctx.boxes;
    var heroIndex = ctx.heroIndex;
    var height = ctx.height;
    var stackGap = ctx.stackGap;
    var heroBox = boxes[heroIndex];
    var horizontalCard = variant === 2 || variant === 3;
    boxes.forEach(function (box) { box.layoutDirection = horizontalCard ? 'horizontal' : 'vertical'; });
    var safeHalfH = height * 0.46;
    sonnetPlaceWithGlobalFit(ctx, function () {
      heroBox.x = 0;
      heroBox.y = horizontalCard ? 0 : -height * 0.1;
      var stagger = variant === 3 ? 70 : 0;
      var columnStep = sonnetMaxOf(boxes.map(function (box) { return box.measuredWidth; }), 0) + stackGap + stagger;
      var xFor = function (box, index) {
        if (variant === 1) return heroBox.x - heroBox.measuredWidth / 2 + box.measuredWidth / 2;
        if (variant === 3) return heroBox.x + ((index % 2 === 0) ? 1 : -1) * 35;
        return heroBox.x;
      };
      /* 前段：从英雄往上排；溢出就换到右边一列。 */
      var column = 0;
      var currentY = heroBox.y - heroBox.measuredHeight / 2 - stackGap;
      for (var i = heroIndex - 1; i >= 0; i--) {
        var box = boxes[i];
        if (currentY - box.measuredHeight < -safeHalfH) {
          column += 1;
          currentY = safeHalfH;
        }
        box.x = xFor(box, i) + column * columnStep;
        box.y = currentY - box.measuredHeight / 2;
        currentY -= box.measuredHeight + stackGap;
        if (variant === 1) { box.enterX = 20; box.enterY = 0; }
        else if (variant === 3) { box.enterX = box.x > heroBox.x ? 30 : -30; box.enterY = 0; }
        else { box.enterX = 0; box.enterY = 20; }
      }
      /* 后段：从英雄往下排；溢出就换到左边一列。 */
      column = 0;
      currentY = heroBox.y + heroBox.measuredHeight / 2 + stackGap;
      for (var j = heroIndex + 1; j < boxes.length; j++) {
        var after = boxes[j];
        if (currentY + after.measuredHeight > safeHalfH) {
          column += 1;
          currentY = -safeHalfH;
        }
        after.x = xFor(after, j) - column * columnStep;
        after.y = currentY + after.measuredHeight / 2;
        currentY += after.measuredHeight + stackGap;
        if (variant === 1) { after.enterX = -20; after.enterY = 0; }
        else if (variant === 3) { after.enterX = after.x > heroBox.x ? 30 : -30; after.enterY = 0; }
        else { after.enterX = 0; after.enterY = -20; }
      }
    });
  }

  /* 追踪缎带：一条水平线；英雄之前的词向左伸（最早的在最左），之后的向右伸——严格阅读顺序。 */
  function sonnetLayoutTrackingRibbon(ctx, variant) {
    var boxes = ctx.boxes;
    var heroIndex = ctx.heroIndex;
    var flowGap = ctx.flowGap;
    var heroBox = boxes[heroIndex];
    boxes.forEach(function (box) { box.layoutDirection = 'horizontal'; });
    sonnetPlaceWithGlobalFit(ctx, function () {
      heroBox.x = 0;
      heroBox.y = 0;
      var alignY = function (box, index) {
        if (variant === 1) return heroBox.y + heroBox.measuredHeight / 2 - box.measuredHeight / 2;
        if (variant === 2) return heroBox.y - heroBox.measuredHeight / 2 + box.measuredHeight / 2;
        return heroBox.y + (index % 2 === 0 ? 10 : -10);
      };
      var enter = variant === 2 ? 20 : 30;
      var currentX = heroBox.x - heroBox.measuredWidth / 2 - flowGap;
      for (var i = heroIndex - 1; i >= 0; i--) {
        var box = boxes[i];
        box.x = currentX - box.measuredWidth / 2;
        box.y = alignY(box, i);
        currentX -= box.measuredWidth + flowGap;
        box.enterX = enter;
        box.enterY = 0;
      }
      currentX = heroBox.x + heroBox.measuredWidth / 2 + flowGap;
      for (var j = heroIndex + 1; j < boxes.length; j++) {
        var after = boxes[j];
        after.x = currentX + after.measuredWidth / 2;
        after.y = alignY(after, j);
        currentX += after.measuredWidth + flowGap;
        after.enterX = -enter;
        after.enterY = 0;
      }
    });
  }

  /* 社论专栏族：五种杂志构图，全部围绕实测流重建，列不颠倒时间、行不重叠。 */
  function sonnetLayoutEditorialColumn(ctx, variant, secondaryHeroIndex) {
    var boxes = ctx.boxes;
    var heroIndex = ctx.heroIndex;
    var width = ctx.width;
    var height = ctx.height;
    var flowGap = ctx.flowGap;
    var stackGap = ctx.stackGap;
    var heroBox = boxes[heroIndex];

    if (variant === 0) {
      boxes.forEach(function (box) { box.layoutDirection = 'vertical'; });
      /* 传统竖排：英雄柱右侧一列放较早的词、左侧一列放较晚的（列从右往左读，列内自上而下）。 */
      sonnetPlaceWithGlobalFit(ctx, function () {
        heroBox.x = -width * 0.15;
        heroBox.y = 0;
        var currentY = heroBox.y - heroBox.measuredHeight / 2 + stackGap * 0.5;
        for (var i = 0; i < heroIndex; i++) {
          var box = boxes[i];
          box.x = heroBox.x + heroBox.measuredWidth / 2 + flowGap + box.measuredWidth / 2;
          box.y = currentY + box.measuredHeight / 2;
          currentY += box.measuredHeight + stackGap;
          box.enterX = -20;
          box.enterY = 0;
        }
        currentY = heroBox.y - heroBox.measuredHeight / 2 + stackGap * 0.5;
        for (var j = heroIndex + 1; j < boxes.length; j++) {
          var after = boxes[j];
          after.x = heroBox.x - heroBox.measuredWidth / 2 - flowGap - after.measuredWidth / 2;
          after.y = currentY + after.measuredHeight / 2;
          currentY += after.measuredHeight + stackGap;
          after.enterX = 20;
          after.enterY = 0;
        }
      });
    } else if (variant === 1) {
      boxes.forEach(function (box) { box.layoutDirection = 'vertical'; });
      /* 右对齐杂志轨，自上而下按时间顺序读。一轨超出安全高度就继续往左换轨（列从右往左读）。 */
      sonnetPlaceWithGlobalFit(ctx, function () {
        var rightEdge = width * 0.28;
        var safeHalfH = height * 0.46;
        var railStep = sonnetMaxOf(boxes.map(function (box) { return box.measuredWidth; }), 0) + stackGap;
        var totalHeight = 0;
        for (var t = 0; t < boxes.length; t++) totalHeight += boxes[t].measuredHeight;
        totalHeight += stackGap * (boxes.length - 1);
        /* 只要梯子最小缩放下能单轨居中就保持单轨；只有真正长的镜头才换轨。 */
        var singleRailHeight = 0;
        for (var s = 0; s < boxes.length; s++) singleRailHeight += boxes[s].measuredHeight;
        var fitsSingleRail = singleRailHeight * 0.52 + stackGap * (boxes.length - 1) <= safeHalfH * 2;
        if (fitsSingleRail) {
          var currentY = -totalHeight / 2;
          boxes.forEach(function (box) {
            box.x = rightEdge - box.measuredWidth / 2;
            box.y = currentY + box.measuredHeight / 2;
            currentY += box.measuredHeight + stackGap;
            box.enterX = 20;
            box.enterY = 0;
          });
          return;
        }
        var rail = 0;
        var y = -safeHalfH;
        boxes.forEach(function (box) {
          if (y + box.measuredHeight > safeHalfH) {
            rail += 1;
            y = -safeHalfH;
          }
          box.x = (rightEdge - rail * railStep) - box.measuredWidth / 2;
          box.y = y + box.measuredHeight / 2;
          y += box.measuredHeight + stackGap;
          box.enterX = 20;
          box.enterY = 0;
        });
      });
    } else if (variant === 2) {
      boxes.forEach(function (box) { box.layoutDirection = 'horizontal'; });
      /* 杂志刊头：较早的词在英雄上方排成 kicker 行，较晚的词在刊头下方两列成对。 */
      sonnetPlaceWithGlobalFit(ctx, function () {
        heroBox.x = 0;
        heroBox.y = -height * 0.25;
        var before = boxes.slice(0, heroIndex);
        var after = boxes.slice(heroIndex + 1);
        if (before.length > 0) {
          var kickerHeight = sonnetMaxOf(before.map(function (box) { return box.measuredHeight; }), 0);
          var kickerWidth = 0;
          for (var b = 0; b < before.length; b++) kickerWidth += before[b].measuredWidth;
          kickerWidth += flowGap * (before.length - 1);
          var kickerY = heroBox.y - heroBox.measuredHeight / 2 - stackGap - kickerHeight / 2;
          var currentX = heroBox.x - kickerWidth / 2;
          before.forEach(function (box) {
            box.x = currentX + box.measuredWidth / 2;
            box.y = kickerY;
            currentX += box.measuredWidth + flowGap;
            box.enterX = 0;
            box.enterY = -20;
          });
        }
        var leftAnchor = heroBox.x - heroBox.measuredWidth * 0.25 - flowGap;
        var rightAnchor = heroBox.x + heroBox.measuredWidth * 0.25 + flowGap;
        var currentY = heroBox.y + heroBox.measuredHeight / 2 + stackGap;
        for (var pair = 0; pair < after.length; pair += 2) {
          var left = after[pair];
          var right = after[pair + 1];
          var rowHeight = Math.max(left.measuredHeight, right ? right.measuredHeight : 0);
          left.x = leftAnchor - left.measuredWidth / 2;
          left.y = currentY + left.measuredHeight / 2;
          left.enterX = -20;
          left.enterY = 0;
          if (right) {
            right.x = rightAnchor + right.measuredWidth / 2;
            right.y = currentY + right.measuredHeight / 2;
            right.enterX = 20;
            right.enterY = 0;
          }
          currentY += rowHeight + stackGap;
        }
      });
    } else if (variant === 3) {
      boxes.forEach(function (box) { box.layoutDirection = 'horizontal'; });
      /* 双英雄行：两条错位行，各行自左向右按时间顺序排，间距用真实行高而非固定微调。 */
      sonnetPlaceWithGlobalFit(ctx, function () {
        heroBox.x = 0;
        heroBox.y = 0;
        var firstHero = Math.min(heroIndex, secondaryHeroIndex);
        var line1 = boxes.slice(0, firstHero + 1);
        var line2 = boxes.slice(firstHero + 1);
        var line1Height = sonnetMaxOf(line1.map(function (box) { return box.measuredHeight; }), 0);
        var line2Height = sonnetMaxOf(line2.map(function (box) { return box.measuredHeight; }), 0);
        var totalHeight = line1Height + stackGap + line2Height;
        var line1Y = heroBox.y - totalHeight / 2 + line1Height / 2;
        var line2Y = line1Y + line1Height / 2 + stackGap + line2Height / 2;
        var layLine = function (line, lineY, enterX) {
          var lineWidth = 0;
          for (var i = 0; i < line.length; i++) lineWidth += line[i].measuredWidth;
          lineWidth += flowGap * (line.length - 1);
          var currentX = -lineWidth / 2;
          line.forEach(function (box) {
            box.x = currentX + box.measuredWidth / 2;
            box.y = lineY;
            currentX += box.measuredWidth + flowGap;
            box.enterX = enterX;
            box.enterY = 0;
          });
          return lineWidth;
        };
        var line1Width = layLine(line1, line1Y, 30);
        var line2Width = layLine(line2, line2Y, -30);
        /* 两行之间的错位阶梯偏移。 */
        var offsetAmount = Math.max(line1Width, line2Width) * 0.12;
        line1.forEach(function (box) { box.x -= offsetAmount; });
        line2.forEach(function (box) { box.x += offsetAmount; });
      });
    } else if (variant === 4) {
      boxes.forEach(function (box, index) {
        box.layoutDirection = index === heroIndex ? 'vertical' : 'horizontal';
      });
      /* Logo 徽章：英雄柱浮在流的起始侧。较早的词在它上方占整行，较晚的词先排在它旁边，
       * 之后继续整行向下——海报流里的区域浮动规则。 */
      sonnetPlaceWithGlobalFit(ctx, function () {
        var heroOnRight = heroIndex === boxes.length - 1;
        var blockLeft = -width * 0.40;
        var blockRight = width * 0.40;
        var currentY = -height * 0.34;

        /* 把下标从左到右装进行；行的区域在柱旁可以收缩、过去后又变宽。 */
        var flowWords = function (indices, regionFor) {
          var region = regionFor(currentY);
          var left = region[0];
          var right = region[1];
          var currentX = left;
          var rowHeight = 0;
          indices.forEach(function (index) {
            var box = boxes[index];
            if (currentX > left && currentX + box.measuredWidth > right) {
              currentY += rowHeight + stackGap;
              region = regionFor(currentY);
              left = region[0];
              right = region[1];
              currentX = left;
              rowHeight = 0;
            }
            box.x = currentX + box.measuredWidth / 2;
            box.y = currentY + box.measuredHeight / 2;
            box.enterX = heroOnRight ? -25 : 25;
            box.enterY = 0;
            currentX += box.measuredWidth + flowGap;
            rowHeight = Math.max(rowHeight, box.measuredHeight);
          });
          if (indices.length > 0) currentY += rowHeight;
        };

        var beforeIndices = boxes.slice(0, heroIndex).map(function (box) { return box.index; });
        var afterIndices = boxes.slice(heroIndex + 1).map(function (box) { return box.index; });
        flowWords(beforeIndices, function () { return [blockLeft, blockRight]; });
        currentY += stackGap;

        var pillarLeft = heroOnRight ? blockRight - heroBox.measuredWidth : blockLeft;
        heroBox.x = pillarLeft + heroBox.measuredWidth / 2;
        heroBox.y = currentY + heroBox.measuredHeight / 2;
        var pillarBottom = currentY + heroBox.measuredHeight + stackGap;
        var besideLeft = heroOnRight ? blockLeft : pillarLeft + heroBox.measuredWidth + flowGap;
        var besideRight = heroOnRight ? pillarLeft - flowGap : blockRight;
        flowWords(afterIndices, function (rowTop) {
          return rowTop < pillarBottom - 0.5 ? [besideLeft, besideRight] : [blockLeft, blockRight];
        });
      });
    }
  }

  /* 碎片拼贴：严格顺时针的极轨排布。每个 support 推进自己的角度，直到实测矩形
   * 避开已放的每个矩形（含英雄），环因此保持混沌外观而实际零重叠。 */
  function sonnetLayoutFragmentCollage(ctx, variant) {
    var boxes = ctx.boxes;
    var heroIndex = ctx.heroIndex;
    var flowGap = ctx.flowGap;
    var stackGap = ctx.stackGap;
    var heroBox = boxes[heroIndex];
    var rectSeparation = function (a, b) {
      return Math.max(
        Math.max(a.left - b.right, b.left - a.right),
        Math.max(a.top - b.bottom, b.top - a.bottom)
      );
    };
    /* 旋转过的非 CJK 块是按竖朝向量的；拼贴把它们压回水平。在全局适配重试快照之前
     * 压平一次，之后每级都按水平占位打包，画框装饰也不会把水平文字裹进竖盒子。 */
    boxes.forEach(function (box, index) {
      if (index === heroIndex) return;
      if (Math.abs(Math.round(box.rotation / (Math.PI / 2)) % 2) === 1) {
        var rotatedWidth = box.measuredHeight;
        box.measuredHeight = box.measuredWidth;
        box.measuredWidth = rotatedWidth;
      }
      box.rotation = 0;
    });
    sonnetPlaceWithGlobalFit(ctx, function (globalScale) {
      heroBox.x = 0;
      heroBox.y = 0;
      var baseRadius = Math.hypot(heroBox.measuredWidth, heroBox.measuredHeight) / 2 + stackGap;
      var count = Math.max(1, boxes.length - 1);
      var squash = 0.65;
      var placed = [{
        left: heroBox.x - heroBox.measuredWidth / 2,
        right: heroBox.x + heroBox.measuredWidth / 2,
        top: heroBox.y - heroBox.measuredHeight / 2,
        bottom: heroBox.y + heroBox.measuredHeight / 2
      }];
      var angle = Math.PI / 4;
      var supportIndex = 0;
      for (var i = 0; i < boxes.length; i++) {
        if (i === heroIndex) continue;
        var box = boxes[i];
        var radius = baseRadius;
        if (variant === 1) {
          /* 随 Timeline 向外漂移的阿基米德螺线。 */
          radius += (35 + (supportIndex / count) * 150) * globalScale;
        } else if (variant === 2) {
          /* 交错双环。 */
          radius += ((supportIndex % 2 === 1) ? 140 : 50) * globalScale;
        } else {
          /* 经典环 + 确定性径向抖动。 */
          radius += (45 + ((supportIndex * 23) % 90)) * globalScale;
        }
        supportIndex += 1;
        var candidate = angle;
        var rect = { left: 0, right: 0, top: 0, bottom: 0 };
        /* 扫环找空位；整圈都找不到就往外再迈一级半径继续扫，拥挤的镜头也不会把盒子堆到已占的位置。 */
        var resolvedRadius = radius;
        var placedClear = false;
        for (var ring = 0; ring < 14 && !placedClear; ring += 1) {
          for (var attempt = 0; attempt < 400; attempt++) {
            rect = {
              left: Math.cos(candidate) * resolvedRadius - box.measuredWidth / 2,
              right: Math.cos(candidate) * resolvedRadius + box.measuredWidth / 2,
              top: Math.sin(candidate) * resolvedRadius * squash - box.measuredHeight / 2,
              bottom: Math.sin(candidate) * resolvedRadius * squash + box.measuredHeight / 2
            };
            var clear = true;
            for (var p = 0; p < placed.length; p++) {
              if (rectSeparation(placed[p], rect) < flowGap) { clear = false; break; }
            }
            if (clear) { placedClear = true; break; }
            candidate += 0.07;
          }
          if (!placedClear) resolvedRadius += (36 + ring * 12) * globalScale;
        }
        angle = candidate + 0.02;
        placed.push(rect);
        box.x = heroBox.x + Math.cos(candidate) * resolvedRadius;
        box.y = heroBox.y + Math.sin(candidate) * resolvedRadius * squash;
        box.layoutDirection = Math.abs(Math.cos(candidate)) >= Math.abs(Math.sin(candidate))
          ? 'vertical'
          : 'horizontal';
        box.enterX = Math.cos(candidate) * -60;
        box.enterY = Math.sin(candidate) * -60;
      }
    });
  }

  /* 动态十字（type-impact / mask-reveal）：上列 → 左行 → 英雄 → 右行 → 下列。
   * 分段方式保证扫描顺序与时间顺序在构造上一致。 */
  function sonnetLayoutCrossStack(ctx) {
    var boxes = ctx.boxes;
    var heroIndex = ctx.heroIndex;
    var height = ctx.height;
    var flowGap = ctx.flowGap;
    var stackGap = ctx.stackGap;
    var heroBox = boxes[heroIndex];
    var beforeCount = heroIndex;
    var topCount = Math.floor(beforeCount / 2);
    var afterCount = boxes.length - 1 - heroIndex;
    var rightCount = Math.ceil(afterCount / 2);

    /* 用来把 support 级词紧紧贴在英雄两侧的列带。短列会剩一大段竖向空白，
     * 所以把偏小的列词养大（仍压在英雄层级之下）并把列在可用跨度上撑开。
     * 跑在适配回调里：只有当前这一级（可能已缩过的）英雄高度能说明还剩多少带。 */
    var fillColumn = function (column) {
      if (column.length === 0) return 0;
      var available = Math.max(0, height * 0.46 - heroBox.measuredHeight / 2 - stackGap);
      if (available <= 0) return 0;
      var gaps = stackGap * (column.length - 1);
      var contentHeight = 0;
      for (var c = 0; c < column.length; c++) contentHeight += column[c].measuredHeight;
      var target = available * 0.72;
      if (contentHeight + gaps < target) {
        var boost = Math.min(2.2, (target - gaps) / Math.max(1, contentHeight));
        column.forEach(function (box) {
          /* 绝不让养大的词超过英雄层级。 */
          var capped = Math.min(boost, (heroBox.fontScale * 0.6) / box.fontScale);
          if (capped > 1.05) {
            box.fontScale *= capped;
            box.measuredWidth *= capped;
            box.measuredHeight *= capped;
          }
        });
      }
      if (column.length < 2) return 0;
      var grown = 0;
      for (var g = 0; g < column.length; g++) grown += column[g].measuredHeight;
      var pitch = (available * 0.95 - grown) / (column.length - 1);
      return Math.max(0, Math.min(stackGap * 2, pitch - stackGap));
    };

    sonnetPlaceWithGlobalFit(ctx, function () {
      heroBox.x = 0;
      heroBox.y = 0;
      var topStretch = fillColumn(boxes.slice(0, topCount));
      var bottomStretch = fillColumn(boxes.slice(heroIndex + rightCount + 1));

      /* 左行：下标 topCount..heroIndex-1，最早的在最左。 */
      var currentX = heroBox.x - heroBox.measuredWidth / 2 - stackGap;
      for (var i = heroIndex - 1; i >= topCount; i--) {
        var box = boxes[i];
        box.layoutDirection = 'horizontal';
        box.x = currentX - box.measuredWidth / 2;
        box.y = heroBox.y + (i % 2 === 0 ? 10 : -10);
        currentX -= box.measuredWidth + flowGap;
        box.enterX = -30;
        box.enterY = 0;
      }

      /* 上列：下标 0..topCount-1，最早的在最上。 */
      var currentY = heroBox.y - heroBox.measuredHeight / 2 - stackGap;
      for (var t = topCount - 1; t >= 0; t--) {
        var top = boxes[t];
        top.layoutDirection = 'vertical';
        top.x = heroBox.x + (t % 2 === 0 ? 15 : -15);
        top.y = currentY - top.measuredHeight / 2;
        currentY -= top.measuredHeight + stackGap + topStretch;
        top.enterX = 0;
        top.enterY = -30;
      }

      /* 右行：紧接英雄之后的词，自左向右。 */
      currentX = heroBox.x + heroBox.measuredWidth / 2 + stackGap;
      for (var r = heroIndex + 1; r <= heroIndex + rightCount; r++) {
        var right = boxes[r];
        right.layoutDirection = 'horizontal';
        right.x = currentX + right.measuredWidth / 2;
        right.y = heroBox.y + (r % 2 === 0 ? 10 : -10);
        currentX += right.measuredWidth + flowGap;
        right.enterX = 30;
        right.enterY = 0;
      }

      /* 下列：剩下的词，自上而下。 */
      currentY = heroBox.y + heroBox.measuredHeight / 2 + stackGap;
      for (var b = heroIndex + rightCount + 1; b < boxes.length; b++) {
        var bottom = boxes[b];
        bottom.layoutDirection = 'vertical';
        bottom.x = heroBox.x + (b % 2 === 0 ? 15 : -15);
        bottom.y = currentY + bottom.measuredHeight / 2;
        currentY += bottom.measuredHeight + stackGap + bottomStretch;
        bottom.enterX = 0;
        bottom.enterY = 30;
      }
    });
  }

  /* ============================== 9. 排版：海报块 ============================== */
  /* sonnetPosterBlocksLayout.ts：PV 风区域流。强调词（hero / semi-hero）占固定区块，
   * 其余 support 按严格阅读顺序填区块之间的空当——构图看起来大小混沌，但视线永不回头。 */

  /* 把阅读序列切成强调区块与 support 串。 */
  function sonnetPartitionFlowItems(boxes) {
    var items = [];
    var group = [];
    boxes.forEach(function (box) {
      if (box.isHero || box.isSemiHero) {
        if (group.length > 0) items.push({ kind: 'group', group: group });
        group = [];
        items.push({ kind: 'zone', zone: box });
      } else {
        group.push(box);
      }
    });
    if (group.length > 0) items.push({ kind: 'group', group: group });
    return items;
  }

  /* 流空间矩形 → 屏幕坐标。竖变体的列从右往左推进，对应传统日式排版。 */
  function sonnetFlowToScreen(space, rect, canvas) {
    if (space.orientation === 'horizontal') {
      return {
        x: canvas.x + rect.u,
        y: canvas.y + rect.v,
        width: rect.uSize,
        height: rect.vSize
      };
    }
    return {
      x: canvas.x + canvas.width - rect.v - rect.vSize,
      y: canvas.y + rect.u,
      width: rect.vSize,
      height: rect.uSize
    };
  }

  /* 在给定全局缩放下把整个镜头排一遍。即使堆叠溢出画布也一定返回这次尝试
   * （调用方好挑第一个装得下的缩放，或对最后一次做紧急适配）——盒子绝不能被留在原点。 */
  function sonnetAttemptFlowLayout(boxes, space, globalScale, chipGap, lineGap, seed) {
    var items = sonnetPartitionFlowItems(boxes);
    var placements = [];
    var floats = [];
    var vCursor = 0;
    var ownBandOnEndSide = ((seed >> 1) & 1) === 1;

    /* 当前缩放下的屏幕尺寸；只有镜头是竖的且存在精确列实测时才选竖列朝向。 */
    var measure = function (box) {
      var useVertical = space.orientation === 'vertical'
        && typeof box.verticalMeasuredWidth === 'number'
        && typeof box.verticalMeasuredHeight === 'number'
        && typeof box.verticalFontScale === 'number';
      var baseScale = useVertical ? box.verticalFontScale : box.fontScale;
      var width = (useVertical ? box.verticalMeasuredWidth : box.measuredWidth) * globalScale;
      var height = (useVertical ? box.verticalMeasuredHeight : box.measuredHeight) * globalScale;
      return { useVertical: useVertical, baseScale: baseScale, width: width, height: height };
    };
    var toFlowSize = function (width, height) {
      return space.orientation === 'horizontal'
        ? { uSize: width, vSize: height }
        : { uSize: height, vSize: width };
    };

    var pruneFloats = function () {
      for (var index = floats.length - 1; index >= 0; index--) {
        if (floats[index].vBottom <= vCursor) floats.splice(index, 1);
      }
    };

    items.forEach(function (item, itemIndex) {
      pruneFloats();
      if (item.kind === 'group') {
        var reservedU = 0;
        for (var f = 0; f < floats.length; f++) reservedU += floats[f].extent;
        var capacity = Math.max(chipGap * 2, space.u - reservedU);
        var uStart = reservedU;
        var chips = item.group.map(function (box) {
          var dims = measure(box);
          var flow = toFlowSize(dims.width, dims.height);
          return { box: box, dims: dims, uSize: flow.uSize, vSize: flow.vSize, shrink: 1 };
        });

        /* 按阅读顺序贪心换行，然后把每行撑开，让 support 铺满整条带而不是挤在一侧。 */
        var line = [];
        var lineUsedU = 0;
        var flushLine = function () {
          if (line.length === 0) return;
          var lineV = sonnetMaxOf(line.map(function (chip) { return chip.vSize * chip.shrink; }), 0);
          var leftover = capacity - lineUsedU;
          var spread = line.length > 1 && leftover > 0
            ? Math.min(leftover / (line.length - 1), chipGap * 2.5)
            : 0;
          var uCursor = uStart;
          line.forEach(function (chip) {
            var finalScale = chip.dims.baseScale * globalScale * chip.shrink;
            placements.push({
              box: chip.box,
              rect: {
                u: uCursor,
                v: vCursor,
                uSize: chip.uSize * chip.shrink,
                vSize: chip.vSize * chip.shrink
              },
              scale: finalScale,
              vertical: chip.dims.useVertical
            });
            uCursor += chip.uSize * chip.shrink + chipGap + spread;
          });
          vCursor += lineV + lineGap;
          pruneFloats();
          line = [];
          lineUsedU = 0;
        };

        chips.forEach(function (chip) {
          var needed = lineUsedU + (line.length > 0 ? chipGap : 0) + chip.uSize;
          if (needed > capacity && line.length > 0) flushLine();
          if (chip.uSize > capacity) {
            /* 单个超大 chip 缩进这条带，而不是换行。 */
            chip.shrink = Math.max(0.5, capacity / chip.uSize);
            lineUsedU = 0;
            line.push(chip);
            flushLine();
            return;
          }
          lineUsedU += (line.length > 0 ? chipGap : 0) + chip.uSize;
          line.push(chip);
        });
        flushLine();
        return;
      }

      /* 区块布点：绝不压住前一个区块的浮动跨度。 */
      var zone = item.zone;
      var floatBottom = 0;
      for (var fb = 0; fb < floats.length; fb++) {
        if (floats[fb].vBottom > floatBottom) floatBottom = floats[fb].vBottom;
      }
      vCursor = Math.max(vCursor, floatBottom, 0);
      floats.length = 0;

      var dims = measure(zone);
      var flow = toFlowSize(dims.width, dims.height);
      var followedByGroup = items[itemIndex + 1] && items[itemIndex + 1].kind === 'group';
      var zoneShrink = Math.min(
        1,
        (space.u * (followedByGroup ? 0.62 : 0.9)) / flow.uSize,
        (space.v * 0.66) / flow.vSize
      );
      var uSize = flow.uSize * zoneShrink;
      var vSize = flow.vSize * zoneShrink;
      var onlyZone = items.length === 1;
      var u = onlyZone
        ? (space.u - uSize) / 2
        : followedByGroup
          ? 0
          : ownBandOnEndSide
            ? space.u - uSize
            : 0;
      placements.push({
        box: zone,
        rect: { u: u, v: vCursor, uSize: uSize, vSize: vSize },
        scale: dims.baseScale * globalScale * zoneShrink,
        vertical: dims.useVertical
      });
      if (followedByGroup) {
        floats.push({ extent: uSize + chipGap, vBottom: vCursor + vSize + lineGap });
      } else {
        vCursor += vSize + lineGap;
        ownBandOnEndSide = !ownBandOnEndSide;
      }
    });

    var vTotal = 0;
    for (var p = 0; p < placements.length; p++) {
      var bottom = placements[p].rect.v + placements[p].rect.vSize;
      if (bottom > vTotal) vTotal = bottom;
    }
    return { placements: placements, vTotal: vTotal };
  }

  function sonnetLayoutPosterBlocks(boxes, width, height, baseFontSize, seed) {
    if (boxes.length === 0) return { placements: [], width: 0, height: 0, gap: 0 };
    var safeSeed = seed === undefined ? 0 : seed;
    var gap = sonnetClamp(baseFontSize * 0.35, 16, 40);
    var chipGap = gap;
    var lineGap = gap * 1.15;
    /* 画布即使在海报相机的最大缩放（约 1.18）下也留在舞台内，但又足够大，
     * 让回落构图仍保可读字号。 */
    var canvas = {
      x: -width * 0.42,
      y: -height * 0.40,
      width: width * 0.84,
      height: height * 0.80
    };
    var orientation = (safeSeed % 2 === 0) ? 'horizontal' : 'vertical';
    /* 流 u 是阅读方向（行=屏幕 x，列=屏幕 y），流 v 是堆叠方向——竖变体把容量对调。 */
    var space = orientation === 'horizontal'
      ? { orientation: orientation, u: canvas.width, v: canvas.height }
      : { orientation: orientation, u: canvas.height, v: canvas.width };

    /* support 从不被放大超过角色尺寸；全局重试只缩不放。 */
    var attempt = sonnetAttemptFlowLayout(boxes, space, 1, chipGap, lineGap, safeSeed);
    var ladder = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52];
    for (var rung = 0; rung < ladder.length; rung++) {
      if (attempt.vTotal <= space.v + 0.5) break;
      attempt = sonnetAttemptFlowLayout(boxes, space, ladder[rung], chipGap, lineGap, safeSeed);
    }
    /* 紧急均匀适配：每一级都溢出时，把整幅构图缩进画布，而不是把盒子留在原点。 */
    if (attempt.vTotal > space.v) {
      var fitScale = space.v / attempt.vTotal;
      attempt.placements.forEach(function (placement) {
        placement.rect.u *= fitScale;
        placement.rect.v *= fitScale;
        placement.rect.uSize *= fitScale;
        placement.rect.vSize *= fitScale;
        placement.scale *= fitScale;
      });
      attempt.vTotal = space.v;
    }

    var vShift = Math.max(0, (space.v - attempt.vTotal) / 2);
    attempt.placements.forEach(function (placement) {
      var box = placement.box;
      var rect = {
        u: placement.rect.u,
        v: placement.rect.v + vShift,
        uSize: placement.rect.uSize,
        vSize: placement.rect.vSize
      };
      var screen = sonnetFlowToScreen(space, rect, canvas);
      box.fontScale = placement.scale;
      box.measuredWidth = screen.width;
      box.measuredHeight = screen.height;
      box.x = screen.x + screen.width / 2;
      box.y = screen.y + screen.height / 2;
      box.rotation = 0;
      box.vertical = placement.vertical;
      if (placement.vertical && box.verticalDisplayText) box.displayText = box.verticalDisplayText;
      box.layoutDirection = orientation === 'vertical' ? 'vertical' : 'horizontal';
      if (orientation === 'horizontal') {
        box.enterX = (screen.x + screen.width / 2 < 0 ? -1 : 1) * Math.min(28, baseFontSize * 0.45);
        box.enterY = Math.min(18, baseFontSize * 0.25);
      } else {
        box.enterX = Math.min(18, baseFontSize * 0.25);
        box.enterY = (screen.y + screen.height / 2 < 0 ? -1 : 1) * Math.min(28, baseFontSize * 0.45);
      }
    });
    return { placements: boxes, width: canvas.width, height: canvas.height, gap: gap };
  }

  /* ============================== 10. 排版：主布局 ============================== */
  /* sonnetTypographyLayout.ts：基于精确盒子实测的 PV 风动态排版。 */

  var SONNET_CJK_TEXT = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;

  function sonnetIsLayoutSegment(segment) {
    return segment.text.trim().length > 0;
  }

  /* 非 CJK 词用水平字形步进，在竖构图里整块旋转。
   * 在测量之前定好书写模式，打包才用渲染出来的边界。 */
  function sonnetShouldRotateNonCjkSegment(segment, vertical) {
    if (!vertical) return false;
    var visible = 0;
    for (var i = 0; i < segment.graphemes.length; i++) {
      if (segment.graphemes[i].char.trim().length > 0) visible += 1;
    }
    return visible > 1 && !SONNET_CJK_TEXT.test(segment.text);
  }

  function sonnetVerticalText(segment) {
    var chars = segment.graphemes.length
      ? segment.graphemes.map(function (item) { return item.char; })
      : Array.from(segment.text);
    return chars.join('\n');
  }

  function sonnetResolveTypographyLayout(options) {
    var lines = options.lines;
    var shotKind = options.shotKind;
    var paragraphKind = options.paragraphKind;
    var width = options.width;
    var height = options.height;
    var baseFontSize = options.baseFontSize;
    var fontFamily = options.fontFamily;
    var fontWeight = options.fontWeight;

    var segments = [];
    for (var l = 0; l < lines.length; l++) segments = segments.concat(lines[l]);

    var offset = 0;
    var heroIndices = [];
    var semiHeroIndices = [];
    lines.forEach(function (lineSegs) {
      var localHero = sonnetFindHeroSegmentIndex(lineSegs);
      var globalHero = offset + localHero;
      var localSemiHeroes = sonnetFindSemiHeroSegmentIndices(lineSegs, localHero);
      heroIndices.push(globalHero);
      localSemiHeroes.forEach(function (localSemiHero) { semiHeroIndices.push(offset + localSemiHero); });
      offset += lineSegs.length;
    });

    var heroIndex = sonnetFindHeroSegmentIndex(segments);
    var midpoints = segments.map(function (segment) { return (segment.startTime + segment.endTime) / 2; });
    var timelineStart = Infinity;
    var timelineEnd = -Infinity;
    for (var m = 0; m < midpoints.length; m++) {
      if (midpoints[m] < timelineStart) timelineStart = midpoints[m];
      if (midpoints[m] > timelineEnd) timelineEnd = midpoints[m];
    }
    var timelineDuration = timelineEnd - timelineStart;
    var phases = midpoints.map(function (midpoint, index) {
      return timelineDuration > 0.001
        ? (midpoint - timelineStart) / timelineDuration
        : index / Math.max(1, segments.length - 1);
    });
    var heroPhase = phases[heroIndex] != null ? phases[heroIndex] : 0.5;

    /* 布局变化的确定性伪随机 */
    var layoutVariantSeed = 0;
    for (var s = 0; s < segments.length; s++) {
      layoutVariantSeed += segments[s].text.trim().length || 1;
    }
    layoutVariantSeed += segments.length;
    var posterTexts = [];
    for (var pt = 0; pt < segments.length; pt++) posterTexts.push(segments[pt].text);
    var posterLayoutSeed = sonnetHashSeed(posterTexts.join('\u241f'));
    var editorialVariant = layoutVariantSeed % 5; /* 扩到 5 种（0-4，含 Logo Badge） */
    var ribbonVariant = layoutVariantSeed % 3;
    var tableauVariant = layoutVariantSeed % 4; /* 扩到 4 种（0-3，含横向卡片） */
    var collageVariant = layoutVariantSeed % 3; /* 扩到 3 种环 / 螺线拼贴变体 */

    var secondaryHeroIndex = -1;
    if (editorialVariant === 3 && segments.length > 2) {
      var bestScore = -Infinity;
      segments.forEach(function (segment, index) {
        if (index === heroIndex || !segment.isWordLike || sonnetGetVisibleSegmentLength(segment) === 0) return;
        var distanceBonus = Math.abs(index - heroIndex) > 1 ? 50 : 0;
        var score = sonnetScoreHeroSegment(segment) + distanceBonus;
        if (score > bestScore) {
          bestScore = score;
          secondaryHeroIndex = index;
        }
      });
      if (secondaryHeroIndex === -1) editorialVariant = 0;
    } else if (editorialVariant === 3) {
      editorialVariant = 0;
    } else if (editorialVariant === 4 && segments.length < 2) {
      editorialVariant = 2; /* 句子太短放不下 Logo Badge，回落杂志刊头 */
    }

    /* 1. 定样式、量盒子 */
    var boxes = segments.map(function (segment, index) {
      var isHero = heroIndices.indexOf(index) >= 0
        || (index === secondaryHeroIndex && shotKind === 'editorial-column' && editorialVariant === 3);
      var isSemiHero = semiHeroIndices.indexOf(index) >= 0 && !isHero;
      var isEmphasized = isHero || isSemiHero;
      var heroFontScale = 1.0;
      var supportFontScale = 1.0;
      var vertical = false;
      var rotation = 0;

      switch (shotKind) {
        case 'editorial-column':
          if (editorialVariant === 3) {
            heroFontScale = 3.8;
            supportFontScale = 1.3;
            vertical = false;
          } else if (editorialVariant === 4) {
            /* Logo Badge：英雄巨柱在左 / 右，support 文字多行横块在另一侧 */
            heroFontScale = 4.2;
            supportFontScale = 1.25;
            vertical = isEmphasized;
          } else {
            heroFontScale = editorialVariant === 2 ? 3.2 : 4.0;
            supportFontScale = 1.2;
            vertical = isEmphasized && editorialVariant !== 2;
          }
          break;
        case 'type-impact':
          heroFontScale = 5.5;
          supportFontScale = 1.5;
          break;
        case 'fragment-collage':
          heroFontScale = 3.2;
          supportFontScale = 1.35;
          vertical = isSemiHero || (index % 4) === 0;
          break;
        case 'tracking-ribbon':
          heroFontScale = 3.5;
          supportFontScale = 1.5;
          break;
        case 'mask-reveal':
          heroFontScale = 4.5;
          supportFontScale = 1.6;
          vertical = isEmphasized;
          break;
        case 'poster-blocks':
          heroFontScale = 4.4;
          supportFontScale = 1.15;
          break;
        case 'quiet-tableau':
        default:
          heroFontScale = 3.0;
          supportFontScale = 1.15;
          vertical = isEmphasized && (tableauVariant === 0 || tableauVariant === 1);
          break;
      }

      var fontScale = isHero
        ? heroFontScale
        : isSemiHero
          ? Math.max(supportFontScale * 1.35, heroFontScale * 0.72)
          : supportFontScale;

      /* 非 CJK 词用水平字形步进、竖构图里整块旋转。
       * 在测量之前定好书写模式，打包才用渲染出来的边界。 */
      var rotatesNonCjkSegment = sonnetShouldRotateNonCjkSegment(segment, vertical);
      if (rotatesNonCjkSegment) {
        vertical = false;
        rotation += Math.PI / 2;
      }

      /* 防止巨大文字溢出 82% 屏宽，算一个 fitScale */
      var displayText = vertical ? sonnetVerticalText(segment) : segment.text;
      var renderRole = isHero ? 'hero' : isSemiHero ? 'semi-hero' : 'support';
      var renderWeight = sonnetResolveRoleFontWeight(fontWeight, renderRole);

      var targetFontSize = baseFontSize * fontScale;
      var fontSpec = renderWeight + ' ' + targetFontSize + 'px ' + fontFamily;

      var horizontalAdvance;
      if (rotatesNonCjkSegment) {
        horizontalAdvance = 0;
        for (var g = 0; g < segment.graphemes.length; g++) {
          if (segment.graphemes[g].char.trim().length === 0) continue;
          var charWidth = Math.max(targetFontSize * 0.2, sonnetMeasureText(segment.graphemes[g].char, fontSpec, targetFontSize));
          horizontalAdvance += charWidth;
        }
      } else {
        horizontalAdvance = sonnetMeasureText(displayText, fontSpec, targetFontSize);
      }

      var measuredWidth = rotatesNonCjkSegment ? targetFontSize * 1.2 : horizontalAdvance;
      var measuredHeight = rotatesNonCjkSegment ? horizontalAdvance : targetFontSize * 1.2;

      if (vertical) {
        /* CJK 叠列：逐字测量，打包才与字形渲染器产出的边界一致——
         * 字形沿列以 fontSize * 0.9 步进并保持居中于列轴。 */
        var columnChars = segment.graphemes.length
          ? segment.graphemes.map(function (item) { return item.char; })
          : Array.from(segment.text);
        var glyphAdvances = [];
        for (var c = 0; c < columnChars.length; c++) {
          if (columnChars[c].trim().length === 0) continue;
          glyphAdvances.push(Math.max(targetFontSize * 0.2, sonnetMeasureText(columnChars[c], fontSpec, targetFontSize)));
        }
        measuredWidth = glyphAdvances.length ? Math.max.apply(null, glyphAdvances) : targetFontSize;
        measuredHeight = Math.max(1, columnChars.length) * targetFontSize * 0.9;
      }

      /* 超出屏幕边界就安全降档 */
      var maxW = width * 0.82;
      var maxH = height * 0.82;
      var fitScale = 1.0;
      if (measuredWidth > maxW) fitScale = Math.min(fitScale, maxW / measuredWidth);
      if (measuredHeight > maxH) fitScale = Math.min(fitScale, maxH / measuredHeight);

      if (fitScale < 1.0) {
        targetFontSize *= fitScale;
        fontScale *= fitScale;
        measuredWidth *= fitScale;
        measuredHeight *= fitScale;
      }

      /* 海报块可能把 CJK 段翻成竖列。按逐字测量那个朝向，
       * 打包才与字形渲染器产出的边界一致：字形沿列以 fontSize * 0.9 步进并居中于列轴。 */
      var posterVerticalDisplayText;
      var posterVerticalMeasuredWidth;
      var posterVerticalMeasuredHeight;
      var posterVerticalFontScale;
      if (shotKind === 'poster-blocks' && SONNET_CJK_TEXT.test(segment.text)) {
        var posterChars = segment.graphemes.length
          ? segment.graphemes.map(function (item) { return item.char; })
          : Array.from(segment.text);
        var posterAdvances = [];
        for (var pc = 0; pc < posterChars.length; pc++) {
          if (posterChars[pc].trim().length === 0) continue;
          posterAdvances.push(Math.max(targetFontSize * 0.2, sonnetMeasureText(posterChars[pc], fontSpec, targetFontSize)));
        }
        var columnWidth = posterAdvances.length ? Math.max.apply(null, posterAdvances) : targetFontSize;
        var columnHeight = Math.max(1, posterChars.length) * targetFontSize * 0.9;
        var verticalFit = Math.min(1, maxW / columnWidth, maxH / columnHeight);
        columnWidth *= verticalFit;
        columnHeight *= verticalFit;
        posterVerticalDisplayText = sonnetVerticalText(segment);
        posterVerticalMeasuredWidth = columnWidth;
        posterVerticalMeasuredHeight = columnHeight;
        posterVerticalFontScale = fontScale * verticalFit;
      }

      return {
        index: index,
        isHero: isHero,
        isSemiHero: isSemiHero,
        displayText: displayText,
        verticalDisplayText: posterVerticalDisplayText,
        verticalMeasuredWidth: posterVerticalMeasuredWidth,
        verticalMeasuredHeight: posterVerticalMeasuredHeight,
        verticalFontScale: posterVerticalFontScale,
        fontScale: fontScale,
        vertical: vertical,
        layoutDirection: 'horizontal',
        rotation: rotation,
        measuredWidth: measuredWidth,
        measuredHeight: measuredHeight,
        timingPhase: phases[index],
        relativePhase: phases[index] - heroPhase,
        role: undefined,
        x: 0,
        y: 0,
        enterX: 0,
        enterY: 0
      };
    });

    /* 2. 精确布局打包：每种 shotKind 都按时间扫描顺序流送实测盒子；
     * 非 poster 分支共用间距常量与全局适配重试。 */
    var heroBox = boxes[heroIndex];
    if (heroBox) {
      if (shotKind === 'poster-blocks') {
        sonnetLayoutPosterBlocks(boxes, width, height, baseFontSize, posterLayoutSeed);
      } else {
        var gaps = sonnetResolveFlowGaps(baseFontSize);
        var flowCtx = {
          boxes: boxes,
          heroIndex: heroIndex,
          width: width,
          height: height,
          flowGap: gaps.flowGap,
          stackGap: gaps.stackGap
        };
        if (shotKind === 'quiet-tableau') sonnetLayoutQuietTableau(flowCtx, tableauVariant);
        else if (shotKind === 'tracking-ribbon') sonnetLayoutTrackingRibbon(flowCtx, ribbonVariant);
        else if (shotKind === 'editorial-column') sonnetLayoutEditorialColumn(flowCtx, editorialVariant, secondaryHeroIndex);
        else if (shotKind === 'fragment-collage') sonnetLayoutFragmentCollage(flowCtx, collageVariant);
        else sonnetLayoutCrossStack(flowCtx);
      }

      heroBox.enterX = 0;
      heroBox.enterY = height * 0.15;

      var decorations = [];
      if (shotKind !== 'quiet-tableau' && shotKind !== 'poster-blocks') {
        var allHeroes = boxes.filter(function (b) { return b.isHero; });
        allHeroes.forEach(function (hBox, idx) {
          decorations.push({
            index: hBox.index,
            isHero: false,
            isSemiHero: false,
            displayText: hBox.displayText,
            verticalDisplayText: undefined,
            verticalMeasuredWidth: undefined,
            verticalMeasuredHeight: undefined,
            verticalFontScale: undefined,
            fontScale: Math.max(2.8, Math.min(hBox.fontScale * 3.5, 5.5)),
            vertical: false,
            layoutDirection: 'horizontal',
            rotation: -0.15 + (idx % 2 === 0 ? 0 : 0.05),
            measuredWidth: hBox.measuredWidth,
            measuredHeight: hBox.measuredHeight,
            timingPhase: hBox.timingPhase,
            relativePhase: hBox.relativePhase,
            role: 'decoration',
            x: hBox.x - width * (0.1 - idx * 0.03),
            y: hBox.y - height * (0.05 - idx * 0.02),
            enterX: -width * 0.05,
            enterY: -height * 0.05
          });
        });
        if (boxes.length > 1 && allHeroes.length > 0) {
          var last = boxes[boxes.length - 1];
          var dec2 = last.isHero ? boxes[0] : last;
          decorations.push({
            index: dec2.index,
            isHero: false,
            isSemiHero: false,
            displayText: dec2.displayText,
            verticalDisplayText: undefined,
            verticalMeasuredWidth: undefined,
            verticalMeasuredHeight: undefined,
            verticalFontScale: undefined,
            fontScale: Math.max(1.8, Math.min(allHeroes[0].fontScale * 2.2, 3.5)),
            vertical: false,
            layoutDirection: 'horizontal',
            rotation: 0.08,
            measuredWidth: dec2.measuredWidth,
            measuredHeight: dec2.measuredHeight,
            timingPhase: dec2.timingPhase,
            relativePhase: dec2.relativePhase,
            role: 'decoration',
            x: allHeroes[0].x + width * 0.25,
            y: allHeroes[0].y + height * 0.15,
            enterX: width * 0.05,
            enterY: height * 0.05
          });
        }
      }

      boxes = decorations.concat(boxes);
    }

    return boxes.map(function (box) {
      return {
        segmentIndex: box.index,
        displayText: box.displayText,
        role: box.role || (box.isHero ? 'hero' : box.isSemiHero ? 'semi-hero' : 'support'),
        fontScale: box.fontScale,
        measuredWidth: box.measuredWidth,
        measuredHeight: box.measuredHeight,
        x: box.x,
        y: box.y,
        rotation: box.rotation,
        enterX: box.enterX,
        enterY: box.enterY,
        vertical: box.vertical,
        layoutDirection: box.layoutDirection,
        timingPhase: box.timingPhase
      };
    });
  }

  /* ============================== 11. 引导线 ============================== */
  /* sonnetGuides.ts：文字到达前的短命语义引入曲线与定位标记。 */

  function sonnetResolveGuideCue(segment, textStartTime) {
    var start = textStartTime === undefined ? segment.startTime : textStartTime;
    var leadDuration = Math.min(
      0.38,
      Math.max(0.2, 0.18 + (segment.endTime - segment.startTime) * 0.1)
    );
    return {
      startTime: start - leadDuration,
      endTime: start + 0.65 /* 延长，让装饰爆开和曲线淡出 */
    };
  }

  function sonnetCreateGuide(pixi, segment, placement, theme, fontSize, textStartTime) {
    var container = new pixi.Container();
    var graphics = new pixi.Graphics();
    var shapesContainer = new pixi.Container();

    var isHero = sonnetIsEmphasisRole(placement.role);
    var fallbackDirection = placement.timingPhase < 0.5 ? -1 : 1;
    var startX = placement.enterX || fallbackDirection * fontSize * 1.8;
    var startY = placement.enterY || -fontSize * 0.9;

    var color = pixi.Color.shared.setValue(isHero ? theme.accentColor : theme.secondaryColor).toNumber();

    var strokeProps = {
      color: color,
      width: isHero ? 1.8 : 1,
      alpha: isHero ? 0.82 : 0.55
    };

    /* 三次贝塞尔控制点 */
    var p0 = { x: startX, y: startY };
    var p1 = { x: startX * 0.6, y: startY * 0.4 };
    var p2 = { x: startX * 0.2, y: startY * 0.1 };
    var p3 = { x: 0, y: 0 };

    var getBezier = function (q0, q1, q2, q3, t) {
      var mt = 1 - t;
      return {
        x: mt * mt * mt * q0.x + 3 * mt * mt * t * q1.x + 3 * mt * t * t * q2.x + t * t * t * q3.x,
        y: mt * mt * mt * q0.y + 3 * mt * mt * t * q1.y + 3 * mt * t * t * q2.y + t * t * t * q3.y
      };
    };

    /* 随机小几何形状 */
    var numShapes = isHero ? 6 : 3;
    var shapeData = [];

    for (var i = 0; i < numShapes; i++) {
      var shape = new pixi.Graphics();
      var type = Math.floor(Math.random() * 4);
      var size = (isHero ? 3 : 1.5) + Math.random() * 3.5;
      var sAlpha = isHero ? 0.8 : 0.6;

      if (type === 0) {
        shape.circle(0, 0, size).fill({ color: color, alpha: sAlpha });
      } else if (type === 1) {
        shape.rect(-size, -size, size * 2, size * 2).fill({ color: color, alpha: sAlpha });
      } else if (type === 2) {
        shape.moveTo(-size, 0).lineTo(size, 0).moveTo(0, -size).lineTo(0, size).stroke({ color: color, width: 2, alpha: sAlpha });
      } else {
        shape.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).fill({ color: color, alpha: sAlpha });
      }

      shapesContainer.addChild(shape);
      shapeData.push({
        obj: shape,
        angle: Math.random() * Math.PI * 2,
        speed: (15 + Math.random() * 45) * (isHero ? 1 : 0.7),
        rotSpeed: (Math.random() - 0.5) * 8
      });
    }

    /* 文字周围编织的近距离丝线 */
    var trackingTrails = [];
    if (isHero || Math.random() > 0.4) {
      /* 线 1：穿过文字的紧绷 S 曲线 */
      var d = Math.random() > 0.5 ? 1 : -1;
      var yOffset = (Math.random() - 0.5) * fontSize * 0.8;
      trackingTrails.push({
        p0: { x: -d * fontSize * 2.5, y: yOffset + fontSize * 1.5 },
        p1: { x: -d * fontSize * 0.8, y: yOffset - fontSize * 2.0 },
        p2: { x: d * fontSize * 0.8, y: yOffset + fontSize * 2.0 },
        p3: { x: d * fontSize * 2.5, y: yOffset - fontSize * 1.5 },
        delay: Math.random() * 0.15
      });
    }
    if (isHero || Math.random() > 0.6) {
      /* 线 2：缠绕文字的紧绷相交环（缎带） */
      var d2 = Math.random() > 0.5 ? 1 : -1;
      trackingTrails.push({
        p0: { x: -fontSize * 2.0, y: -d2 * fontSize * 1.8 },
        p1: { x: fontSize * 2.0, y: d2 * fontSize * 1.8 },
        p2: { x: -fontSize * 2.0, y: d2 * fontSize * 1.8 },
        p3: { x: fontSize * 2.0, y: -d2 * fontSize * 1.8 },
        delay: Math.random() * 0.1
      });
    }
    /* 生长的矩形样条（现代 HUD 风） */
    var rectSpline = null;
    if (Math.random() > 0.4) {
      var length = fontSize * (1.2 + Math.random() * 1.5);
      var thickness = (isHero ? 6 : 3) + Math.random() * 8;
      var angle = (Math.random() - 0.5) * Math.PI; /* 随机角度 */
      var rx = (Math.random() - 0.5) * fontSize * 1.2;
      var ry = (Math.random() - 0.5) * fontSize * 1.2;
      rectSpline = {
        p0: { x: rx, y: ry },
        p1: { x: rx + Math.cos(angle) * length, y: ry + Math.sin(angle) * length },
        thickness: thickness,
        delay: Math.random() * 0.15,
        duration: 0.25 + Math.random() * 0.2
      };
    }

    container.addChild(graphics, shapesContainer);
    container.position.set(placement.x, placement.y);
    container.alpha = 0;

    var cue = sonnetResolveGuideCue(segment, textStartTime);

    var graphicsEmpty = true;
    var update = function (progress) {
      /* 曲线 0→0.35 快速画入，0.4→0.7 淡出 */
      var drawProgress = Math.min(1, Math.max(0, progress / 0.35));
      var fadeOut = 1 - Math.min(1, Math.max(0, (progress - 0.4) / 0.3));

      /* 淡完后曲线层就空了；清一个空 Graphics 仍会弄脏它的 context 并重新合批，
       * 所以只在出去的路上清。 */
      if (fadeOut > 0) {
        graphics.clear();
        graphicsEmpty = false;
      } else if (!graphicsEmpty) {
        graphics.clear();
        graphicsEmpty = true;
      }
      if (drawProgress > 0 && fadeOut > 0) {
        var steps = 20;
        var prevP = p0;
        for (var i = 1; i <= steps; i++) {
          /* 画成带渐隐锥形尾巴的星轨 */
          var t = (i / steps) * drawProgress;
          var p = getBezier(p0, p1, p2, p3, t);
          var intensity = Math.pow(i / steps, 2); /* 二次曲线：尾 0 头 1 */

          /* 加粗加亮的笔触 */
          var segmentAlpha = Math.min(1, intensity * strokeProps.alpha * fadeOut * 1.6);
          var segmentWidth = (isHero ? 2.5 : 1.5) + intensity * (isHero ? 5.0 : 3.0);

          graphics.moveTo(prevP.x, prevP.y);
          graphics.lineTo(p.x, p.y);
          graphics.stroke({ color: color, width: segmentWidth, alpha: segmentAlpha });
          prevP = p;
        }

        /* 星头（核心 + 辉光）——做得更醒目 */
        var head = getBezier(p0, p1, p2, p3, drawProgress);
        graphics.circle(head.x, head.y, isHero ? 14 : 9).fill({ color: color, alpha: 0.5 * fadeOut });
        graphics.circle(head.x, head.y, isHero ? 4.5 : 3).fill({ color: 0xffffff, alpha: 1 * fadeOut });
      }

      /* 音游风丝线轨 */
      trackingTrails.forEach(function (trail) {
        var localProg = (progress - trail.delay) / 0.55;
        if (localProg > -0.15 && fadeOut > 0) {
          /* 头尾扫过而不预先画出整条轨迹 */
          if (localProg > 0 && localProg < 1.3) {
            var headT = Math.min(1, localProg);
            var tailT = Math.max(0, localProg - 0.35); /* 彗尾长度 */

            if (headT > tailT) {
              var steps = 25;
              var prevP = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, tailT);

              for (var i = 1; i <= steps; i++) {
                var stepT = tailT + (i / steps) * (headT - tailT);
                var pos = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, stepT);
                var intensity = Math.pow(i / steps, 2);
                var alpha = intensity * strokeProps.alpha * fadeOut * 0.9;
                var width = (isHero ? 2 : 1) + intensity * (isHero ? 5 : 2.5);

                graphics.moveTo(prevP.x, prevP.y);
                graphics.lineTo(pos.x, pos.y);
                graphics.stroke({ color: color, width: width, alpha: alpha });
                prevP = pos;
              }
            }

            /* 发光头与跟随圆 */
            if (headT > 0 && headT < 1) {
              var headPos = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, headT);
              graphics.circle(headPos.x, headPos.y, isHero ? 7 : 4).fill({ color: color, alpha: 0.9 * fadeOut });
              graphics.circle(headPos.x, headPos.y, isHero ? 2.5 : 1.5).fill({ color: 0xffffff, alpha: 1 * fadeOut });

              /* 外层「跟随圆」辉光，音游氛围 */
              graphics.circle(headPos.x, headPos.y, isHero ? 20 : 12).stroke({ color: color, width: isHero ? 2 : 1, alpha: 0.4 * fadeOut });
            }
          }
        }
      });

      /* 矩形样条（现代 HUD 风） */
      if (rectSpline) {
        var localProg = (progress - rectSpline.delay) / rectSpline.duration;
        if (localProg > 0 && localProg < 1.3 && fadeOut > 0) {
          /* 生长阶段：头从 p0 走到 p1 */
          var headT = Math.min(1, Math.max(0, localProg * 1.5));
          /* 收缩阶段：尾从 p0 追上来，跟在头后面 */
          var tailT = Math.min(1, Math.max(0, (localProg - 0.3) * 1.5));

          if (headT > tailT) {
            var hx = rectSpline.p0.x + (rectSpline.p1.x - rectSpline.p0.x) * headT;
            var hy = rectSpline.p0.y + (rectSpline.p1.y - rectSpline.p0.y) * headT;
            var tx = rectSpline.p0.x + (rectSpline.p1.x - rectSpline.p0.x) * tailT;
            var ty = rectSpline.p0.y + (rectSpline.p1.y - rectSpline.p0.y) * tailT;

            graphics.moveTo(tx, ty);
            graphics.lineTo(hx, hy);
            graphics.stroke({ color: color, width: rectSpline.thickness, alpha: strokeProps.alpha * fadeOut * 0.7 });

            /* 再画一条亮芯 */
            graphics.moveTo(tx, ty);
            graphics.lineTo(hx, hy);
            graphics.stroke({ color: 0xffffff, width: rectSpline.thickness * 0.3, alpha: strokeProps.alpha * fadeOut * 0.9 });
          }
        }
      }

      /* 文字开始落定（progress ~ 0.3）时形状向外爆开 */
      var burstProgress = Math.min(1, Math.max(0, (progress - 0.3) / 0.7));
      shapeData.forEach(function (s) {
        var ease = 1 - Math.pow(1 - burstProgress, 3); /* Expo out */
        s.obj.x = p3.x + Math.cos(s.angle) * s.speed * ease;
        s.obj.y = p3.y + Math.sin(s.angle) * s.speed * ease;
        s.obj.rotation = s.rotSpeed * burstProgress;
        s.obj.alpha = (1 - burstProgress) * (isHero ? 1 : 0.8);
        s.obj.scale.set(1 - burstProgress * 0.4);
      });
    };

    return {
      container: container,
      startTime: cue.startTime,
      endTime: cue.endTime,
      maxAlpha: isHero ? 0.95 : 0.7,
      update: update
    };
  }

  /* ============================== 12. 文字装饰框 ============================== */
  /* sonnetFrameDecor.ts：确定性 30% 子集的段落的装饰性开放框。每个框把自己的四边
   * 用生长动画描出来，拐角处故意不闭死，最后在每个角上补一朵小花 / 几何饰物。 */

  var SONNET_FRAME_DECOR_PROBABILITY = 0.4;
  var SONNET_FRAME_DECOR_VARIANTS = 4;

  /* 逐段确定性选择，seek 与重放都拿到同一批框。 */
  function sonnetResolveFrameDecorSpec(segment) {
    var hash = sonnetHashSeed([
      segment.text,
      segment.startOffset,
      segment.endOffset,
      'frame-decor'
    ].join(':'));
    return {
      applied: (hash & 1023) / 1024 < SONNET_FRAME_DECOR_PROBABILITY,
      variant: (hash >>> 10) % SONNET_FRAME_DECOR_VARIANTS
    };
  }

  /* 把文字颜色压暗，让框读成安静的次级层。 */
  function sonnetDimmedColor(pixi, color, multiplier) {
    var base = pixi.Color.shared.setValue(color).toNumber();
    var r = Math.round(((base >> 16) & 255) * multiplier);
    var g = Math.round(((base >> 8) & 255) * multiplier);
    var b = Math.round((base & 255) * multiplier);
    return (r << 16) | (g << 8) | b;
  }

  function sonnetResolveFrameCorners(halfW, halfH) {
    return [
      { x: -halfW, y: -halfH, sx: -1, sy: -1 },
      { x: halfW, y: -halfH, sx: 1, sy: -1 },
      { x: halfW, y: halfH, sx: 1, sy: 1 },
      { x: -halfW, y: halfH, sx: -1, sy: 1 }
    ];
  }

  /* 四边从每个角顺时针跑，按角gap 内缩，轮廓因此刻意不闭。 */
  function sonnetResolveFrameSideEnds(halfW, halfH, cornerGap, corners, side) {
    var from = corners[side];
    var to = corners[(side + 1) % 4];
    var insetX = to.x === from.x ? 0 : cornerGap * (to.x > from.x ? 1 : -1);
    var insetY = to.y === from.y ? 0 : cornerGap * (to.y > from.y ? 1 : -1);
    return {
      startX: from.x + insetX,
      startY: from.y + insetY,
      endX: to.x - insetX,
      endY: to.y - insetY
    };
  }

  /* 还原框容器施加旋转之前的文字局部尺寸。 */
  function sonnetResolveFrameLocalDimensions(placement) {
    var quarterTurns = Math.round(placement.rotation / (Math.PI / 2));
    var snappedRotation = quarterTurns * (Math.PI / 2);
    var isOddQuarterTurn = (
      Math.abs(placement.rotation - snappedRotation) < 1e-6
      && Math.abs(quarterTurns % 2) === 1
    );
    return isOddQuarterTurn
      ? { width: placement.measuredHeight, height: placement.measuredWidth }
      : { width: placement.measuredWidth, height: placement.measuredHeight };
  }

  function sonnetBuildFrameDecor(pixi, options) {
    if (options.placement.role === 'decoration') return null;
    var segment = options.segment;
    var spec = sonnetResolveFrameDecorSpec(segment);
    if (!spec.applied) return null;

    var placement = options.placement;
    var fontSize = options.fontSize;
    var pad = sonnetClamp(fontSize * 0.22, 8, 20);
    var frameDimensions = sonnetResolveFrameLocalDimensions(placement);
    var halfW = frameDimensions.width / 2 + pad;
    var halfH = frameDimensions.height / 2 + pad;
    var cornerGap = sonnetClamp(Math.min(halfW, halfH) * (spec.variant === 1 ? 0.42 : 0.3), 6, 30);

    var color = sonnetDimmedColor(pixi, options.theme.primaryColor, 0.55);
    var corners = sonnetResolveFrameCorners(halfW, halfH);
    var container = new pixi.Container();
    container.position.set(placement.x, placement.y);
    container.rotation = placement.rotation;
    var graphics = new pixi.Graphics();
    container.addChild(graphics);
    container.alpha = 0;

    var strokeWidth = sonnetClamp(fontSize * 0.03, 1.2, 2.2);

    /* 顺时针描四条边，每条边在自己的窗口里生长。 */
    var traceSides = function (eased, dashed) {
      for (var side = 0; side < 4; side++) {
        var sideProgress = sonnetClamp01((eased - side * 0.2) / 0.4);
        if (sideProgress <= 0) continue;
        var ends = sonnetResolveFrameSideEnds(halfW, halfH, cornerGap, corners, side);
        var tipX = ends.startX + (ends.endX - ends.startX) * sideProgress;
        var tipY = ends.startY + (ends.endY - ends.startY) * sideProgress;
        if (!dashed) {
          graphics.moveTo(ends.startX, ends.startY).lineTo(tipX, tipY)
            .stroke({ color: color, width: strokeWidth, alpha: 0.85 });
          continue;
        }
        /* 虚线变体：只画完整落在已描尖端之内的虚线段。 */
        var sideLength = Math.hypot(ends.endX - ends.startX, ends.endY - ends.startY);
        if (sideLength < 1) continue;
        var ux = (ends.endX - ends.startX) / sideLength;
        var uy = (ends.endY - ends.startY) / sideLength;
        var dash = sonnetClamp(fontSize * 0.14, 5, 8);
        var gap = dash * 0.7;
        var traced = sideLength * sideProgress;
        for (var offset = 0; offset + dash <= traced + 0.001; offset += dash + gap) {
          graphics
            .moveTo(ends.startX + ux * offset, ends.startY + uy * offset)
            .lineTo(ends.startX + ux * (offset + dash), ends.startY + uy * (offset + dash))
            .stroke({ color: color, width: strokeWidth, alpha: 0.85 });
        }
      }
    };

    var ornamentProgress = function (eased, corner) {
      return sonnetEaseElasticOut(sonnetClamp01((eased - 0.35 - corner * 0.14) / 0.3));
    };

    /* 变体 0：坐在每个角外侧的裁切标记。 */
    var drawCornerTicks = function (eased) {
      var arm = sonnetClamp(pad * 0.8, 5, 12);
      var offset = 3;
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index);
        if (op <= 0.02) return;
        var innerX = corner.x + corner.sx * offset;
        var innerY = corner.y + corner.sy * offset;
        graphics
          .moveTo(innerX + corner.sx * arm * op, innerY)
          .lineTo(innerX, innerY)
          .lineTo(innerX, innerY + corner.sy * arm * op)
          .stroke({ color: color, width: strokeWidth, alpha: 0.9 * Math.min(1, op) });
      });
    };

    /* 变体 1：每个角开一朵四瓣花。 */
    var drawCornerFlowers = function (eased) {
      var radius = sonnetClamp(pad * 0.55, 4, 9);
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index);
        if (op <= 0.02) return;
        var petal = radius * 0.44 * op;
        graphics.circle(corner.x - radius, corner.y, petal).fill({ color: color, alpha: 0.8 });
        graphics.circle(corner.x + radius, corner.y, petal).fill({ color: color, alpha: 0.8 });
        graphics.circle(corner.x, corner.y - radius, petal).fill({ color: color, alpha: 0.8 });
        graphics.circle(corner.x, corner.y + radius, petal).fill({ color: color, alpha: 0.8 });
        graphics.circle(corner.x, corner.y, radius * 0.3 * op).fill({ color: 0xffffff, alpha: 0.5 });
      });
    };

    /* 变体 2：嵌套直角括号 + 每边中点一个菱形。 */
    var drawBrackets = function (eased) {
      var arm = sonnetClamp(pad, 6, 14);
      var offset = 2.5;
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index);
        if (op <= 0.02) return;
        var innerX = corner.x + corner.sx * offset;
        var innerY = corner.y + corner.sy * offset;
        graphics
          .moveTo(innerX + corner.sx * arm * op, innerY)
          .lineTo(innerX, innerY)
          .lineTo(innerX, innerY + corner.sy * arm * op)
          .stroke({ color: color, width: strokeWidth * 1.4, alpha: 0.9 });
        graphics
          .moveTo(innerX + corner.sx * (arm * op + 4), innerY + corner.sy * 4)
          .lineTo(innerX + corner.sx * 4, innerY + corner.sy * 4)
          .lineTo(innerX + corner.sx * 4, innerY + corner.sy * (arm * op + 4))
          .stroke({ color: color, width: strokeWidth * 0.8, alpha: 0.5 });
      });
      var diamond = sonnetClamp(pad * 0.45, 3.5, 7);
      for (var side = 0; side < 4; side++) {
        var op = ornamentProgress(eased, side);
        if (op <= 0.02) continue;
        var ends = sonnetResolveFrameSideEnds(halfW, halfH, cornerGap, corners, side);
        var midX = (ends.startX + ends.endX) / 2;
        var midY = (ends.startY + ends.endY) / 2;
        var size = diamond * op;
        graphics
          .poly([midX, midY - size, midX + size, midY, midX, midY + size, midX - size, midY])
          .fill({ color: color, alpha: 0.85 });
      }
    };

    /* 变体 3：每个角上沿对角向外的小三角。 */
    var drawCornerTriangles = function (eased) {
      var size = sonnetClamp(pad * 0.6, 4, 9);
      var offset = 2;
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index);
        if (op <= 0.02) return;
        var diagX = corner.sx / Math.SQRT2;
        var diagY = corner.sy / Math.SQRT2;
        var perpX = corner.sy / Math.SQRT2;
        var perpY = -corner.sx / Math.SQRT2;
        var tipX = corner.x + diagX * (offset + size * op);
        var tipY = corner.y + diagY * (offset + size * op);
        var baseX = corner.x + diagX * offset;
        var baseY = corner.y + diagY * offset;
        var half = size * 0.7 * op;
        graphics
          .poly([
            tipX, tipY,
            baseX + perpX * half, baseY + perpY * half,
            baseX - perpX * half, baseY - perpY * half
          ])
          .fill({ color: color, alpha: 0.85 });
        graphics.circle(corner.x, corner.y, strokeWidth).fill({ color: color, alpha: 0.9 });
      });
    };

    /* 按动画进度重绘框；纯函数、seek 安全。
     * 长成之后这一段的剩余时间框都保持不动，所以进度没变时保留已三角化的几何。 */
    var drawnProgress = Number.NaN;
    var update = function (progress) {
      var clamped = sonnetClamp01(progress);
      if (clamped === drawnProgress) return;
      drawnProgress = clamped;
      var eased = sonnetEaseExpoOut(clamped);
      graphics.clear();
      container.alpha = eased <= 0 ? 0 : 1;
      if (eased <= 0) return;
      traceSides(eased, spec.variant === 3);
      if (spec.variant === 0) drawCornerTicks(eased);
      else if (spec.variant === 1) drawCornerFlowers(eased);
      else if (spec.variant === 2) drawBrackets(eased);
      else drawCornerTriangles(eased);
    };

    var growDuration = sonnetResolveGlyphMotionDuration(options.shotStartTime, options.shotEndTime) * 1.25;
    var startTime = options.firstGlyphStartTime;
    return {
      container: container,
      startTime: startTime,
      endTime: startTime + growDuration,
      update: update
    };
  }

  /* ============================== 13. 文字背景几何 ============================== */
  /* sonnetTextFixedGeo.ts：规划并画普通 Sonnet 文字背后的确定性固定几何。 */

  var SONNET_TEXT_FIXED_HOLLOW_VARIANTS = ['straight-frame', 'rotated-frame', 'orbit-crosshair', 'split-arches'];
  var SONNET_TEXT_FIXED_SOLID_VARIANTS = ['orb-hatch', 'music-steps', 'bent-lines'];

  function sonnetResolveHollowVariant(seed, divisor, offset) {
    var index = Math.floor(seed / divisor) + offset;
    var list = SONNET_TEXT_FIXED_HOLLOW_VARIANTS;
    return list[((index % list.length) + list.length) % list.length];
  }

  function sonnetResolveTextFixedGeoPlan(seed, isChorusEffect) {
    if (isChorusEffect) {
      var chorusSeed = ((seed % 10) + 10) % 10;
      if (chorusSeed < 9) {
        return { category: 'hollow', variant: sonnetResolveHollowVariant(seed, 10, chorusSeed) };
      }
      var chorusSolid = SONNET_TEXT_FIXED_SOLID_VARIANTS;
      return { category: 'solid', variant: chorusSolid[Math.floor(seed / 10) % chorusSolid.length] };
    }

    var legacyType = ((seed % 4) + 4) % 4;
    if (legacyType === 1 || legacyType === 2) {
      return { category: 'hollow', variant: sonnetResolveHollowVariant(seed, 4, legacyType) };
    }
    var solid = SONNET_TEXT_FIXED_SOLID_VARIANTS;
    return { category: 'solid', variant: solid[Math.floor(seed / 4) % solid.length] };
  }

  function sonnetDrawMusicSteps(graphic, width, height, alpha, theme) {
    var heights = [0.24, 0.35, 0.2, 0.82, 0.3, 0.1, 0.23, 0.16];
    var spacing = width / (heights.length + 1);
    heights.forEach(function (heightRatio, index) {
      var x = -width / 2 + spacing * (index + 1);
      var baseline = height * (0.12 - index * 0.035);
      var color = index % 2 === 0 ? theme.accentColor : theme.secondaryColor;
      graphic
        .moveTo(x - spacing * 0.12, baseline - height * heightRatio * 0.5)
        .lineTo(x + spacing * 0.12, baseline + height * heightRatio * 0.5)
        .stroke({ color: color, width: Math.max(2, height * 0.025), alpha: alpha * 0.52 });
    });
  }

  function sonnetDrawBentLines(graphic, width, height, alpha, theme) {
    var lineCount = 5;
    for (var index = 0; index < lineCount; index += 1) {
      var x = -width * 0.34 + index * width * 0.17;
      var topY = -height * (0.42 - index * 0.035);
      var elbowY = -height * (0.08 - index * 0.025);
      var bottomY = height * (0.35 + index * 0.035);
      var color = index % 2 === 0 ? theme.accentColor : theme.secondaryColor;
      graphic
        .moveTo(x - width * 0.16, topY)
        .lineTo(x, elbowY)
        .lineTo(x - width * 0.015, bottomY)
        .stroke({ color: color, width: Math.max(2, height * 0.022), alpha: alpha * 0.52 });
    }
  }

  function sonnetDrawOrbitCrosshair(graphic, width, height, alpha, color, secondaryColor) {
    var radius = Math.min(width, height) * 0.46;
    graphic.circle(0, 0, radius).stroke({ color: color, width: 1.5, alpha: alpha });
    graphic.circle(-width * 0.17, 0, radius * 0.72).stroke({ color: secondaryColor, width: 1, alpha: alpha * 0.72 });
    graphic.circle(width * 0.17, 0, radius * 0.72).stroke({ color: secondaryColor, width: 1, alpha: alpha * 0.72 });
    graphic.moveTo(-width * 0.62, 0).lineTo(width * 0.62, 0).stroke({ color: color, width: 1, alpha: alpha * 0.64 });
    graphic.moveTo(0, -height * 0.62).lineTo(0, height * 0.62).stroke({ color: color, width: 1, alpha: alpha * 0.64 });
  }

  function sonnetDrawSplitArches(graphic, width, height, alpha, color, secondaryColor) {
    var halfWidth = width * 0.46;
    var archRadius = Math.min(width * 0.34, height * 0.52);
    [-1, 1].forEach(function (direction, index) {
      var x = direction * halfWidth * 0.42;
      graphic.moveTo(x - archRadius * 0.72, height * 0.42)
        .lineTo(x - archRadius * 0.72, 0)
        .arc(x, 0, archRadius * 0.72, Math.PI, 0)
        .lineTo(x + archRadius * 0.72, height * 0.42)
        .stroke({ color: index === 0 ? color : secondaryColor, width: 1.5, alpha: alpha });
      graphic.moveTo(x - archRadius * 0.48, height * 0.42)
        .lineTo(x - archRadius * 0.48, 0)
        .arc(x, 0, archRadius * 0.48, Math.PI, 0)
        .lineTo(x + archRadius * 0.48, height * 0.42)
        .stroke({ color: index === 0 ? secondaryColor : color, width: 1, alpha: alpha * 0.58 });
    });
    graphic.moveTo(-halfWidth, height * 0.42).lineTo(halfWidth, height * 0.42)
      .stroke({ color: color, width: 2, alpha: alpha * 0.72 });
  }

  /* 保留旧版空心 / 实心两类的概率，只在每一类里换 artwork。 */
  function sonnetBuildTextFixedGeo(pixi, options) {
    var seed = options.seed;
    var isChorusEffect = options.isChorusEffect;
    var fontSize = options.fontSize;
    var layoutWidth = options.layoutWidth;
    var theme = options.theme;
    var plan = sonnetResolveTextFixedGeoPlan(seed, isChorusEffect);
    var graphic = new pixi.Graphics();
    var color = seed % 2 === 0 ? theme.primaryColor : theme.secondaryColor;
    var alpha = (isChorusEffect ? 0.4 : 0.25) + (seed % 10) * 0.03;
    var scaleMultiplier = isChorusEffect ? 1.5 + (seed % 5) * 0.3 : 1;
    var width = Math.max(fontSize * 2.5 * scaleMultiplier, layoutWidth * 0.12 * scaleMultiplier);
    var height = Math.max(fontSize * 1.8 * scaleMultiplier, layoutWidth * 0.08 * scaleMultiplier);

    if (plan.category === 'hollow') {
      if (plan.variant === 'orbit-crosshair') {
        sonnetDrawOrbitCrosshair(graphic, width, height, alpha, color, theme.secondaryColor);
        return graphic;
      }
      if (plan.variant === 'split-arches') {
        sonnetDrawSplitArches(graphic, width, height, alpha, color, theme.secondaryColor);
        return graphic;
      }
      var frameWidth = plan.variant === 'rotated-frame' ? width * 0.8 : width;
      var frameHeight = plan.variant === 'rotated-frame' ? height * 0.8 : height;
      graphic
        .rect(-frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight)
        .stroke({ color: color, width: Math.max(1.5, fontSize * 0.02), alpha: alpha });
      if (isChorusEffect && seed % 2 === 0) {
        graphic
          .rect(-frameWidth * 0.6, -frameHeight * 0.6, frameWidth * 1.2, frameHeight * 1.2)
          .stroke({ color: color, width: 1, alpha: alpha * 0.5 });
      }
      if (plan.variant === 'rotated-frame') graphic.rotation = Math.PI / 4;
      return graphic;
    }

    if (plan.variant === 'music-steps') {
      sonnetDrawMusicSteps(graphic, width, height, alpha, theme);
      return graphic;
    }
    if (plan.variant === 'bent-lines') {
      sonnetDrawBentLines(graphic, width, height, alpha, theme);
      return graphic;
    }

    var radius = width * 0.5;
    graphic.circle(0, 0, radius).fill({ color: color, alpha: alpha * 0.15 });
    var hatch = new pixi.Graphics();
    var hatchSpacing = Math.max(4, width * 0.05);
    for (var offset = -radius; offset < radius; offset += hatchSpacing) {
      var lineHeight = Math.sqrt(Math.max(0, radius * radius - offset * offset));
      hatch.moveTo(offset + radius * 0.4, -lineHeight + radius * 0.4);
      hatch.lineTo(offset + radius * 0.4, lineHeight + radius * 0.4);
    }
    hatch.stroke({ color: color, width: 1.5, alpha: alpha * 0.6 });
    graphic.addChild(hatch);
    return graphic;
  }

  /* ============================== 14. 五线谱 ============================== */
  /* sonnetStaffNotation.ts + sonnetStaffView.ts：La Folia 公有领域 D 小调主题，
   * 按它的 3/4 LilyPond 记谱转写。 */

  /* La Folia 公有领域 D 小调主题，从 3/4 LilyPond 记谱转写。 */
  var SONNET_LA_FOLIA_STAFF_NOTES = [
    { pitch: 'D5', staffStep: 6, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1.5 },
    { pitch: 'E5', staffStep: 7, beats: 0.5 },
    { pitch: 'C#5', staffStep: 5, beats: 1, accidental: 'sharp' },
    { pitch: 'C#5', staffStep: 5, beats: 1, accidental: 'sharp' },
    { pitch: 'C#5', staffStep: 5, beats: 1, accidental: 'sharp' },
    { pitch: 'D5', staffStep: 6, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1.5 },
    { pitch: 'D5', staffStep: 6, beats: 0.5 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'F5', staffStep: 8, beats: 1 },
    { pitch: 'F5', staffStep: 8, beats: 1.5 },
    { pitch: 'F5', staffStep: 8, beats: 0.5 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1.5 },
    { pitch: 'C#5', staffStep: 5, beats: 0.5, accidental: 'sharp' },
    { pitch: 'D5', staffStep: 6, beats: 3 }
  ];

  var SONNET_LA_FOLIA_TOTAL_BEATS = (function () {
    var total = 0;
    for (var i = 0; i < SONNET_LA_FOLIA_STAFF_NOTES.length; i++) total += SONNET_LA_FOLIA_STAFF_NOTES[i].beats;
    return total;
  })();

  var SONNET_LA_FOLIA_CYCLE_SECONDS = 8;

  function sonnetPositiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function sonnetBuildStaffView(pixi, placement, theme, baseFontSize, shotStartTime, width, containerLayer) {
    var wrapper = new pixi.Container();
    wrapper.rotation = placement.rotation;
    wrapper.position.set(placement.x, placement.y);
    wrapper.alpha = 0;

    var staffWidth = Math.max(300, width * 0.6);
    var lineSpacing = baseFontSize * 0.25;
    var totalHeight = lineSpacing * 4;
    var halfWidth = staffWidth / 2;
    var halfHeight = totalHeight / 2;
    var playableWidth = staffWidth * 0.92;
    var beatWidth = playableWidth / SONNET_LA_FOLIA_TOTAL_BEATS;
    var timedNotes = [];
    var beatCursor = 0;
    for (var i = 0; i < SONNET_LA_FOLIA_STAFF_NOTES.length; i++) {
      var note = SONNET_LA_FOLIA_STAFF_NOTES[i];
      timedNotes.push({
        pitch: note.pitch,
        staffStep: note.staffStep,
        beats: note.beats,
        accidental: note.accidental,
        startBeat: beatCursor
      });
      beatCursor += note.beats;
    }

    var primaryColor = pixi.Color.shared.setValue(theme.primaryColor).toNumber();
    var accentColor = pixi.Color.shared.setValue(theme.accentColor).toNumber();

    var staffGraphics = new pixi.Graphics();

    /* 画五条谱线 */
    for (var line = 0; line < 5; line++) {
      var y = -halfHeight + line * lineSpacing;
      staffGraphics.moveTo(-halfWidth, y);
      staffGraphics.lineTo(halfWidth, y);
    }
    staffGraphics.stroke({ color: primaryColor, width: 2, alpha: 0.3 });

    /* 保持写好的 3/4 小节结构可见，音符自行循环。 */
    for (var bar = 1; bar < 8; bar += 1) {
      var x = -playableWidth / 2 + beatWidth * bar * 3;
      staffGraphics.moveTo(x, -halfHeight);
      staffGraphics.lineTo(x, halfHeight);
    }
    staffGraphics.stroke({ color: primaryColor, width: 1, alpha: 0.16 });

    /* 装饰性谱号 / 终止线 */
    staffGraphics.moveTo(-halfWidth + 10, -halfHeight);
    staffGraphics.lineTo(-halfWidth + 10, halfHeight);
    staffGraphics.stroke({ color: primaryColor, width: 4, alpha: 0.5 });

    staffGraphics.moveTo(halfWidth - 10, -halfHeight);
    staffGraphics.lineTo(halfWidth - 10, halfHeight);
    staffGraphics.stroke({ color: primaryColor, width: 2, alpha: 0.5 });
    staffGraphics.moveTo(halfWidth - 4, -halfHeight);
    staffGraphics.lineTo(halfWidth - 4, halfHeight);
    staffGraphics.stroke({ color: primaryColor, width: 6, alpha: 0.5 });

    var noteGraphics = new pixi.Graphics();
    wrapper.addChild(staffGraphics, noteGraphics);

    containerLayer.addChild(wrapper);

    /* 画固定的 La Folia 乐句，并在普通时间循环上推进播放光标。 */
    var updateAnimation = function (time) {
      var cycleElapsed = sonnetPositiveModulo(time - shotStartTime, SONNET_LA_FOLIA_CYCLE_SECONDS);
      var beatPosition = (cycleElapsed / SONNET_LA_FOLIA_CYCLE_SECONDS) * SONNET_LA_FOLIA_TOTAL_BEATS;
      var cursorX = -playableWidth / 2 + beatWidth * beatPosition;

      noteGraphics.clear();
      noteGraphics.moveTo(cursorX, -halfHeight - lineSpacing * 0.8);
      noteGraphics.lineTo(cursorX, halfHeight + lineSpacing * 0.8);
      noteGraphics.stroke({ color: accentColor, width: 1.5, alpha: 0.34 });

      timedNotes.forEach(function (note, index) {
        var isActive = beatPosition >= note.startBeat
          && beatPosition < note.startBeat + note.beats;
        var pulse = isActive
          ? (Math.sin(cycleElapsed * Math.PI * 5 + index * 0.4) + 1) * 0.5
          : 0;
        var noteScale = isActive ? 1 + pulse * 0.12 : 1;
        var noteRadiusX = lineSpacing * 0.42 * noteScale;
        var noteRadiusY = lineSpacing * 0.29 * noteScale;
        var nx = -playableWidth / 2 + beatWidth * (note.startBeat + note.beats * 0.5);
        var ny = halfHeight - note.staffStep * lineSpacing * 0.5;
        var noteAlpha = isActive ? 0.78 + pulse * 0.16 : 0.28 + (index % 3) * 0.03;
        var stemDown = note.staffStep >= 6;
        var stemX = nx + (stemDown ? -noteRadiusX : noteRadiusX);
        var stemEndY = ny + (stemDown ? lineSpacing * 3.1 : -lineSpacing * 3.1);

        noteGraphics.ellipse(nx, ny, noteRadiusX, noteRadiusY)
          .fill({ color: accentColor, alpha: noteAlpha });
        noteGraphics.moveTo(stemX, ny);
        noteGraphics.lineTo(stemX, stemEndY);
        noteGraphics.stroke({ color: primaryColor, width: 1.6, alpha: Math.min(0.9, noteAlpha + 0.08) });

        if (note.beats <= 0.5) {
          var flagY = stemEndY;
          var flagDirection = stemDown ? -1 : 1;
          noteGraphics.moveTo(stemX, flagY)
            .quadraticCurveTo(
              stemX + lineSpacing * 1.1,
              flagY + lineSpacing * 0.55 * flagDirection,
              stemX + lineSpacing * 0.1,
              flagY + lineSpacing * flagDirection
            )
            .stroke({ color: primaryColor, width: 1.6, alpha: Math.min(0.9, noteAlpha + 0.08) });
        }

        if (note.accidental === 'sharp') {
          var sharpX = nx - noteRadiusX * 2.3;
          var sharpHeight = lineSpacing * 1.15;
          noteGraphics.moveTo(sharpX - lineSpacing * 0.16, ny - sharpHeight * 0.5)
            .lineTo(sharpX - lineSpacing * 0.16, ny + sharpHeight * 0.5)
            .moveTo(sharpX + lineSpacing * 0.16, ny - sharpHeight * 0.5)
            .lineTo(sharpX + lineSpacing * 0.16, ny + sharpHeight * 0.5)
            .moveTo(sharpX - lineSpacing * 0.34, ny - lineSpacing * 0.12)
            .lineTo(sharpX + lineSpacing * 0.34, ny - lineSpacing * 0.28)
            .moveTo(sharpX - lineSpacing * 0.34, ny + lineSpacing * 0.28)
            .lineTo(sharpX + lineSpacing * 0.34, ny + lineSpacing * 0.12)
            .stroke({ color: primaryColor, width: 1.2, alpha: Math.min(0.86, noteAlpha + 0.08) });
        }
      });
    };

    return {
      display: wrapper,
      halo: null,
      baseX: placement.x,
      baseY: placement.y,
      enterX: placement.enterX,
      enterY: placement.enterY,
      entryRotation: 0,
      finalRotation: placement.rotation,
      startTime: shotStartTime,
      settleTime: shotStartTime + 0.5,
      zDepth: 0,
      isTextGlyph: false,
      updateAnimation: updateAnimation
    };
  }

  /* ============================== 15. 文本视图 ============================== */
  /* sonnetTextViewBuilder.ts：创建 parser 定时的核心 / 辉光字形对及其语义引导视图。 */

  /* Folia 的 dev overlay 调试件（sonnetDebug.ts）本项目不移植，返回 null 即可——
   * 场景构建里对它们的调用全部按「可为空」处理。 */
  /* sonnetDebug.ts：布局开发期的调试覆盖层。Folia 的 DEBUG_SONNET_MEASURED_BOUNDS 恒 false，
   * 但仍返回一个「空且不可见」的 Container —— 场景构建会无条件把它 addChild 进去，
   * 返回 null 会让 pixi 的 addChild 读 child.parent 时炸掉。 */
  var SONNET_DEBUG_MEASURED_BOUNDS = false;

  function sonnetBuildMeasuredBoundsDebug(pixi) {
    var layer = new pixi.Container();
    layer.visible = SONNET_DEBUG_MEASURED_BOUNDS;
    /* 调试关闭时到此为止：不建 rect / dot，也不读取 placement（省一次逐段遍历）。 */
    return layer;
  }

  /* 调试读数快照：本项目没有 DevDebugOverlay 的 Sonnet 页，无人消费 → 恒 null。
   * 保留函数与调用点是为了让「以后要加调试页」时接线位置已经在原位。 */
  function sonnetCreateShotDebugInfo() {
    return null;
  }

  function sonnetResolveCameraTrackingGlyphs(glyphs) {
    return glyphs.filter(function (glyph) { return glyph.isBackgroundShape !== true; });
  }

  function sonnetBuildTextView(pixi, options) {
    var Text = pixi.Text;
    var TextStyle = pixi.TextStyle;
    var segment = options.segment;
    var placement = {
      segmentIndex: options.placement.segmentIndex,
      displayText: options.placement.displayText,
      role: options.placement.role,
      fontScale: options.placement.fontScale,
      measuredWidth: options.placement.measuredWidth,
      measuredHeight: options.placement.measuredHeight,
      x: options.placement.x,
      y: options.placement.y,
      rotation: options.placement.rotation,
      enterX: options.placement.enterX,
      enterY: options.placement.enterY,
      vertical: options.placement.vertical,
      layoutDirection: options.placement.layoutDirection,
      timingPhase: options.placement.timingPhase
    };

    var fontSize = options.baseFontSize * placement.fontScale;
    var normalOffsetSeed = sonnetHashSeed([
      segment.text,
      segment.startOffset,
      segment.endOffset,
      options.segmentIndex,
      'normal-offset'
    ].join(':'));
    var normalOffset = sonnetResolveSegmentNormalOffset(
      placement.role,
      placement.layoutDirection,
      placement.rotation,
      fontSize,
      normalOffsetSeed / 0xffffffff
    );
    placement.x += normalOffset.x;
    placement.y += normalOffset.y;
    /* 本项目 theme.wordColors 恒 [] → 关键词着色永不命中。 */
    var isKeyword = null;
    if (options.theme.wordColors && options.theme.wordColors.length) {
      for (var k = 0; k < options.theme.wordColors.length; k++) {
        var entry = options.theme.wordColors[k];
        if (entry && String(entry.word).toLowerCase() === segment.text.toLowerCase()) {
          isKeyword = entry;
          break;
        }
      }
    }

    /* 正文保持主色 */
    var bodyColor = options.theme.primaryColor;

    /* 辉光与装饰边用关键词色，support 文字用强调色 */
    var glowColor = isKeyword
      ? isKeyword.color
      : (sonnetIsEmphasisRole(placement.role) ? options.theme.primaryColor : options.theme.accentColor);

    var isDecoration = placement.role === 'decoration';
    var renderWeight = sonnetResolveRoleFontWeight(options.fontWeight, placement.role);
    var fontSpec = renderWeight + ' ' + fontSize + 'px ' + options.fontFamily;

    /* 视差深度分配 */
    var zDepth = sonnetResolveSegmentDepth(placement.role, normalOffsetSeed / 0xffffffff);

    var blurAmount = Math.abs(zDepth) * fontSize * 0.12;
    var isBlurry = blurAmount > 2;

    var baseDropShadow = options.glowEnabled && !isDecoration ? {
      color: glowColor,
      alpha: 0.8,
      blur: Math.max(12, fontSize * 0.18),
      distance: 0
    } : undefined;

    var style = new TextStyle({
      fontFamily: options.fontFamily,
      fontWeight: String(renderWeight),
      fontSize: fontSize,
      fill: (isDecoration ? 'transparent' : bodyColor),
      stroke: isDecoration ? { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) } : undefined,
      align: 'center',
      dropShadow: baseDropShadow,
      padding: baseDropShadow ? Math.max(20, baseDropShadow.blur * 2.5) : 0
    });

    /* 半英雄回声鬼影：空心（仅描边）副本沿流向法线撕开，快速淡入再迅速消失。
     * 峰值 alpha 压得很低，读成淡淡的余像，绝不与核心竞争。 */
    var isSemiHero = placement.role === 'semi-hero';
    var ghostStyle = isSemiHero ? new TextStyle({
      fontFamily: options.fontFamily,
      fontWeight: String(renderWeight),
      fontSize: fontSize,
      fill: 'transparent',
      stroke: { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) },
      align: 'center'
    }) : undefined;
    /* 屏幕空间里流向的法线，转成 wrapper 局部坐标，鬼影才跟着 wrapper 的旋转走。 */
    var ghostNormal = (function () {
      var screen = placement.layoutDirection === 'vertical' ? { x: 1, y: 0 } : { x: 0, y: 1 };
      var cosine = Math.cos(-placement.rotation);
      var sine = Math.sin(-placement.rotation);
      return {
        x: screen.x * cosine - screen.y * sine,
        y: screen.x * sine + screen.y * cosine
      };
    })();
    var ghostSpread = fontSize * 0.85;
    var ghostDuration = Math.min(
      0.7,
      Math.max(0.4, (options.shotEndTime - options.shotStartTime) * 0.12 + 0.1)
    );

    if (segment.text === '♪') {
      var staffView = sonnetBuildStaffView(
        pixi,
        placement,
        options.theme,
        options.baseFontSize,
        options.shotStartTime,
        options.width,
        options.textLayer
      );
      var staffGuide = sonnetCreateGuide(
        pixi,
        segment,
        placement,
        options.theme,
        fontSize,
        staffView.startTime
      );
      if (!isDecoration) {
        options.guideLayer.addChild(staffGuide.container);
      }
      return {
        segmentIndex: options.segmentIndex,
        displayText: segment.text,
        role: placement.role,
        fontScale: placement.fontScale,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        enterX: placement.enterX,
        enterY: placement.enterY,
        vertical: placement.vertical,
        timingPhase: placement.timingPhase,
        guide: staffGuide,
        glyphs: [staffView],
        trackingGlyphs: [staffView]
      };
    }

    var glyphs = sonnetBuildGlyphLayout(
      segment,
      placement,
      fontSize,
      function (char) { return sonnetMeasureText(char, fontSpec, fontSize); },
      options.shotStartTime,
      options.shotEndTime
    ).map(function (glyph) {
      var display = new Text({ text: glyph.char, style: style });
      display.anchor.set(0.5);
      if (isDecoration) display.alpha = 0.2;

      var wrapper = new pixi.Container();
      wrapper.rotation = placement.rotation;
      wrapper.position.set(glyph.baseX, glyph.baseY);
      wrapper.alpha = 0;

      /* 色散（Chromatic Aberration）效果 */
      var caWrapperNode;
      var caCyanNode;
      var caRedNode;
      var caOffsetValue;

      if (!isDecoration) {
        var isHero = sonnetIsEmphasisRole(placement.role);
        var offset = fontSize * (isHero ? 0.025 : 0.010);
        caOffsetValue = offset;

        var caCyan = new Text({ text: glyph.char, style: style });
        caCyan.tint = 0x00ffff;
        caCyan.blendMode = 'screen';
        caCyan.anchor.set(0.5);
        caCyan.alpha = isHero ? 0.8 : 0.5;

        var caRed = new Text({ text: glyph.char, style: style });
        caRed.tint = 0xff0044;
        caRed.blendMode = 'screen';
        caRed.anchor.set(0.5);
        caRed.alpha = isHero ? 0.8 : 0.5;

        var caWrapper = new pixi.Container();
        caWrapper.rotation = wrapper.rotation;
        caWrapper.position.copyFrom(wrapper.position);
        caWrapper.alpha = 0;
        caWrapper.addChild(caCyan, caRed);
        options.caLayer.addChild(caWrapper);
        caWrapperNode = caWrapper;
        caCyanNode = caCyan;
        caRedNode = caRed;
      }

      wrapper.addChild(display);

      /* 回声鬼影坐在核心字形背后；每个鬼影的方向 / alpha 预先算好。
       * 两个回声都叠在法线的同一侧（逐段确定性），余像因此读成一道有方向的拖尾
       * 而不是对称的模糊。 */
      var ghosts;
      if (ghostStyle) {
        ghosts = [];
        var side = normalOffsetSeed % 2 === 0 ? 1 : -1;
        for (var layer = 1; layer <= 2; layer++) {
          var ghost = new Text({ text: glyph.char, style: ghostStyle });
          ghost.anchor.set(0.5);
          ghost.alpha = 0;
          ghost.visible = false;
          wrapper.addChildAt(ghost, 0);
          var factor = layer === 1 ? 1 : 1.7;
          ghosts.push({
            node: ghost,
            dirX: ghostNormal.x * side * factor * ghostSpread,
            dirY: ghostNormal.y * side * factor * ghostSpread,
            alphaBase: layer === 1 ? 0.3 : 0.16
          });
        }
      }

      options.textLayer.addChild(wrapper);

      return {
        display: wrapper,
        halo: null,
        caWrapper: caWrapperNode,
        caCyan: caCyanNode,
        caRed: caRedNode,
        caOffset: caOffsetValue,
        ghosts: ghosts,
        ghostDuration: ghosts ? ghostDuration : undefined,
        baseX: glyph.baseX,
        baseY: glyph.baseY,
        enterX: glyph.enterX,
        enterY: glyph.enterY,
        entryRotation: glyph.entryRotation,
        finalRotation: placement.rotation,
        startTime: glyph.startTime,
        settleTime: glyph.settleTime,
        zDepth: zDepth,
        isTextGlyph: true
      };
    });

    /* 伴随特定文字段的随机背景几何。
     * 比以往更稀有，且与画框装饰互斥——两种描边风格的层绝不叠在同一段上。 */
    var isChorusParagraph = options.paragraphKind === 'chorus';
    var textSeed = 0;
    for (var c = 0; c < segment.text.length; c++) textSeed += segment.text.charCodeAt(c);
    textSeed += options.segmentIndex * 13;
    var isChorusEffect = isChorusParagraph || ((textSeed % 100) < 35);
    var shapeThreshold = isChorusEffect ? 26 : 15; /* 副歌段落里概率更高 */
    var hasFrameDecor = sonnetResolveFrameDecorSpec(segment).applied;
    var shouldAddBgShape = options.showFixedGeo
      && (textSeed % 100) < shapeThreshold
      && !isDecoration
      && segment.isWordLike
      && !hasFrameDecor
      && glyphs.length > 0;

    if (shouldAddBgShape) {
      var bgWrapper = new pixi.Container();
      bgWrapper.position.set(placement.x, placement.y);
      bgWrapper.rotation = placement.rotation;
      bgWrapper.alpha = 0;

      var bgShape = sonnetBuildTextFixedGeo(pixi, {
        seed: textSeed,
        isChorusEffect: isChorusEffect,
        fontSize: fontSize,
        layoutWidth: options.width,
        theme: options.theme
      });

      bgWrapper.addChild(bgShape);
      options.textLayer.addChildAt(bgWrapper, 0); /* 保证留在文字背后 */

      var firstGlyph = glyphs[0];
      glyphs.unshift({
        display: bgWrapper,
        halo: null,
        baseX: placement.x,
        baseY: placement.y,
        enterX: placement.enterX,
        enterY: placement.enterY,
        entryRotation: 0,
        finalRotation: placement.rotation,
        startTime: firstGlyph.startTime,
        settleTime: firstGlyph.settleTime,
        zDepth: -0.5 - (textSeed % 5) * 0.1, /* 背景深度，供视差用 */
        isBackgroundShape: true,
        isTextGlyph: false
      });
    }

    var guide = sonnetCreateGuide(
      pixi,
      segment,
      placement,
      options.theme,
      fontSize,
      glyphs.length ? glyphs[0].startTime : options.shotStartTime
    );
    if (!isDecoration) {
      options.guideLayer.addChild(guide.container);
    }

    /* 装饰性开放框（30% 的段），留在字形背后。 */
    var frameDecor = sonnetBuildFrameDecor(pixi, {
      segment: segment,
      placement: placement,
      theme: options.theme,
      fontSize: fontSize,
      shotStartTime: options.shotStartTime,
      shotEndTime: options.shotEndTime,
      firstGlyphStartTime: (function () {
        for (var f = 0; f < glyphs.length; f++) {
          if (glyphs[f].isTextGlyph !== false) return glyphs[f].startTime;
        }
        return segment.startTime;
      })()
    });
    if (frameDecor) options.textLayer.addChildAt(frameDecor.container, 0);

    return {
      segmentIndex: options.segmentIndex,
      displayText: segment.text,
      role: placement.role,
      fontScale: placement.fontScale,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      enterX: placement.enterX,
      enterY: placement.enterY,
      vertical: placement.vertical,
      timingPhase: placement.timingPhase,
      guide: guide,
      frameDecor: frameDecor,
      glyphs: glyphs,
      trackingGlyphs: sonnetResolveCameraTrackingGlyphs(glyphs)
    };
  }

  /* ============================== 16. 特效：后处理链 ============================== */
  /* sonnetPostProcess.ts：PV 风后处理（噪点、色移、高对比）。 */

  var SONNET_NO_PRINT_EFFECTS = { rgbShift: 0, halftone: 0, vignette: 0 };

  function sonnetResolvePostProcessProfile(theme, tuning, staticMode) {
    if (staticMode) {
      return {
        glowStrength: 0,
        glowAlpha: 0,
        noise: 0,
        contrast: 0,
        glitchIntensity: 0,
        lensDistortion: 0,
        lensDispersion: 0,
        printEffects: SONNET_NO_PRINT_EFFECTS
      };
    }
    var motion = tuning.typographyMotion * sonnetResolveAnimationScale(theme);
    var postEnabled = tuning.postProcessEnabled;
    return {
      glowStrength: 2.8 + motion * 1.8,
      glowAlpha: Math.min(0.62, 0.28 + motion * 0.12),
      noise: postEnabled ? tuning.postProcessGrain * 0.35 : 0, /* 可选胶片颗粒，压到很 subtle，文字保持锐利 */
      contrast: postEnabled ? tuning.postProcessContrast * 0.5 : 0, /* Pixi 的 contrast 是加性量：0 为中性，0.5 产生 1.5 倍矩阵 */
      glitchIntensity: 1, /* 转场时用 */
      lensDistortion: postEnabled ? tuning.postProcessLensDistortion : 0,
      lensDispersion: postEnabled ? tuning.postProcessLensDispersion : 0,
      /* 固定的印刷风 pass 搭在主开关上，每一路按自己的 0..1 滑杆缩放。 */
      printEffects: postEnabled
        ? {
          rgbShift: tuning.postProcessRgbShift,
          halftone: tuning.postProcessHalftone,
          vignette: tuning.postProcessVignette
        }
        : SONNET_NO_PRINT_EFFECTS
    };
  }

  function sonnetCreateHaloLayer(pixi, profile) {
    var layer = new pixi.Container();
    var filters = [];
    if (profile.glowStrength > 0) {
      var blur = new pixi.BlurFilter({
        strength: profile.glowStrength,
        quality: 2,
        kernelSize: 5,
        resolution: 0.75
      });
      layer.filters = [blur];
      layer.alpha = profile.glowAlpha;
      layer.blendMode = 'screen';
      filters.push(blur);
    }
    return { layer: layer, filters: filters };
  }

  /* ============================== 17. 特效：镜头畸变 ============================== */
  /* sonnetLensFilter.ts：单趟径向镜头滤镜，带屏幕空间色散。 */

  var SONNET_LENS_FRAGMENT = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    '',
    'uniform sampler2D uTexture;',
    'uniform highp vec4 uInputSize;',
    'uniform vec4 uInputClamp;',
    'uniform highp vec4 uOutputFrame;',
    'uniform float uDistortion;',
    'uniform float uDispersion;',
    '',
    'vec2 screenToTextureUv(vec2 screenUv) {',
    '    return screenUv * uOutputFrame.zw * uInputSize.zw;',
    '}',
    '',
    'vec4 sampleInside(vec2 uv) {',
    '    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y',
    '        || uv.x > uInputClamp.z || uv.y > uInputClamp.w) {',
    '        return vec4(0.0);',
    '    }',
    '    return texture(uTexture, uv);',
    '}',
    '',
    'void main(void) {',
    '    vec2 screenUv = vTextureCoord * uInputSize.xy / max(uOutputFrame.zw, vec2(1.0));',
    '    vec2 centered = screenUv - 0.5;',
    '    float aspect = uOutputFrame.z / max(uOutputFrame.w, 1.0);',
    '    centered.x *= aspect;',
    '',
    '    float radiusSquared = dot(centered, centered);',
    '    float curvature = uDistortion * 0.32;',
    '    float radialScale = 1.0 - curvature * radiusSquared',
    '        + curvature * 0.16 * radiusSquared * radiusSquared;',
    '    vec2 lensCentered = centered * radialScale;',
    '    lensCentered.x /= aspect;',
    '    vec2 lensUv = lensCentered + 0.5;',
    '',
    '    float radius = sqrt(radiusSquared);',
    '    vec2 radialDirection = radius > 0.0001 ? centered / radius : vec2(0.0);',
    '    float edgeWeight = smoothstep(0.12, 0.9, radius);',
    '    vec2 dispersion = radialDirection * uDispersion * 0.012 * edgeWeight;',
    '    dispersion.x /= aspect;',
    '',
    '    vec4 center = sampleInside(screenToTextureUv(lensUv));',
    '    vec4 redSample = sampleInside(screenToTextureUv(lensUv + dispersion));',
    '    vec4 blueSample = sampleInside(screenToTextureUv(lensUv - dispersion));',
    '    float alpha = max(center.a, max(redSample.a, blueSample.a));',
    '    float coreWeight = 0.84 - clamp(uDispersion, 0.0, 1.0) * 0.18;',
    '    vec3 core = center.rgb * coreWeight;',
    '    vec3 separated = vec3(redSample.r, center.g, blueSample.b);',
    '    vec3 color = max(core, separated);',
    '',
    '    finalColor = vec4(color, alpha);',
    '}'
  ].join('\n');

  function sonnetCreateLensFilter(pixi, amounts) {
    var uniforms = new pixi.UniformGroup({
      uDistortion: { value: amounts.distortion, type: 'f32' },
      uDispersion: { value: amounts.dispersion, type: 'f32' }
    });
    return new pixi.Filter({
      glProgram: pixi.GlProgram.from({
        vertex: SONNET_FILTER_VERTEX,
        fragment: SONNET_LENS_FRAGMENT,
        name: 'sonnet-lens-distortion'
      }),
      resources: { lensUniforms: uniforms },
      antialias: 'on'
    });
  }

  /* ============================== 18. 特效：印刷风 pass ============================== */
  /* sonnetPrintFilters.ts：固定参数的印刷风场景滤镜（RGB 偏移、半调网屏、有序抖动、暗角）。
   * 每路一个全屏 pass，无运行时 uniform——后处理开关整体启停这一组。 */

  /* 细微的恒定色差：沿固定 25 度轴约 1.25px 的分裂。 */
  var SONNET_RGB_SHIFT_FRAGMENT = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    '',
    'uniform sampler2D uTexture;',
    'uniform highp vec4 uInputSize;',
    'uniform vec4 uInputClamp;',
    'uniform float uAmount;',
    '',
    'vec4 sampleInside(vec2 uv) {',
    '    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y',
    '        || uv.x > uInputClamp.z || uv.y > uInputClamp.w) {',
    '        return vec4(0.0);',
    '    }',
    '    return texture(uTexture, uv);',
    '}',
    '',
    'void main(void) {',
    '    vec2 offset = vec2(0.9063, 0.4226) * uAmount * 3.0 * uInputSize.zw;',
    '    vec4 redSample = sampleInside(vTextureCoord + offset);',
    '    vec4 center = sampleInside(vTextureCoord);',
    '    vec4 blueSample = sampleInside(vTextureCoord - offset);',
    '    float alpha = max(center.a, max(redSample.a, blueSample.a));',
    '    float coreWeight = 0.84 - clamp(uAmount, 0.0, 1.0) * 0.18;',
    '    vec3 core = center.rgb * coreWeight;',
    '    vec3 separated = vec3(redSample.r, center.g, blueSample.b);',
    '    finalColor = vec4(max(core, separated), alpha);',
    '}'
  ].join('\n');

  /* 单采样半调网屏：按经典 CMYK 角度对每个 RGB 通道过网，暗部保持暗，不引入纸色。 */
  var SONNET_HALFTONE_FRAGMENT = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    '',
    'uniform sampler2D uTexture;',
    'uniform float uAmount;',
    '',
    'float dotScreen(vec2 fragCoord, float angle, float value, float cellSize) {',
    '    float c = cos(angle);',
    '    float s = sin(angle);',
    '    vec2 rotated = mat2(c, s, -s, c) * fragCoord;',
    '    float dist = length(fract(rotated / cellSize) - 0.5) * cellSize;',
    '    float radius = sqrt(clamp(value, 0.0, 1.0)) * cellSize * 0.62;',
    '    return 1.0 - smoothstep(radius - 1.2, radius + 1.2, dist);',
    '}',
    '',
    'void main(void) {',
    '    vec4 color = texture(uTexture, vTextureCoord);',
    '    if (color.a > 0.0) {',
    '        color.rgb /= color.a;',
    '    }',
    '    float cellSize = 5.0;',
    '    vec3 screened = vec3(',
    '        dotScreen(gl_FragCoord.xy, radians(15.0), color.r, cellSize),',
    '        dotScreen(gl_FragCoord.xy, radians(75.0), color.g, cellSize),',
    '        dotScreen(gl_FragCoord.xy, radians(0.0), color.b, cellSize)',
    '    );',
    '    color.rgb = mix(color.rgb, screened, uAmount);',
    '    color.rgb *= color.a;',
    '    finalColor = color;',
    '}'
  ].join('\n');

  /* 固定暗角：向屏幕边缘压暗。在屏幕空间计算（相机平移时输入纹理可能超出视口），
   * 并向不透明黑混合，这样在场景的透明背景上也读得出来。 */
  var SONNET_VIGNETTE_FRAGMENT = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    '',
    'uniform sampler2D uTexture;',
    'uniform highp vec4 uInputSize;',
    'uniform highp vec4 uOutputFrame;',
    'uniform float uAmount;',
    '',
    'void main(void) {',
    '    vec4 color = texture(uTexture, vTextureCoord);',
    '    vec2 screenUv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;',
    '    vec2 centered = screenUv - 0.5;',
    '    centered.x *= uOutputFrame.z / uOutputFrame.w;',
    '    float vignette = clamp(smoothstep(0.52, 1.08, length(centered)) * uAmount * 0.6, 0.0, 1.0);',
    '    finalColor = mix(color, vec4(0.0, 0.0, 0.0, 1.0), vignette);',
    '}'
  ].join('\n');

  function sonnetCreateFilterPass(pixi, name, fragment, amount) {
    return new pixi.Filter({
      glProgram: pixi.GlProgram.from({ vertex: SONNET_FILTER_VERTEX, fragment: fragment, name: name }),
      resources: {
        printUniforms: new pixi.UniformGroup({
          uAmount: { value: amount, type: 'f32' }
        })
      },
      /* app 画布开了 MSAA（antialias: true），但滤镜 pass 默认渲染进一个不做多重采样的
       * 离屏纹理——细线会丢抗锯齿变成锯齿。这些全场景 pass 保持 MSAA 开。 */
      antialias: 'on'
    });
  }

  function sonnetCreatePrintFilters(pixi, amounts) {
    var filters = [];
    if (amounts.rgbShift > 0) filters.push(sonnetCreateFilterPass(pixi, 'sonnet-print-rgb-shift', SONNET_RGB_SHIFT_FRAGMENT, amounts.rgbShift));
    if (amounts.halftone > 0) filters.push(sonnetCreateFilterPass(pixi, 'sonnet-print-halftone', SONNET_HALFTONE_FRAGMENT, amounts.halftone));
    if (amounts.vignette > 0) filters.push(sonnetCreateFilterPass(pixi, 'sonnet-print-vignette', SONNET_VIGNETTE_FRAGMENT, amounts.vignette));
    return filters;
  }

  /* 建场景后处理链——镜头、颗粒、对比度，最后印刷风 pass——挂不挂由调用方决定。
   * 与 tempera 共用（它设自己的 pass 分辨率）。 */
  function sonnetCreatePostProcessFilters(pixi, amounts, seed) {
    var filters = [];

    /* 镜头曲率跑在调色与印刷 pass 之前，半调 / 暗角跟着扭曲后的画面走。 */
    if (amounts.lensDistortion > 0 || amounts.lensDispersion > 0) {
      filters.push(sonnetCreateLensFilter(pixi, {
        distortion: amounts.lensDistortion,
        dispersion: amounts.lensDispersion
      }));
    }

    /* 噪点滤镜，出印刷 / 胶片颗粒质感 */
    if (amounts.noise > 0) {
      var noise = new pixi.NoiseFilter({
        noise: amounts.noise,
        seed: (seed % 10000) / 10000,
        antialias: 'on' /* 滤镜纹理跳过画布 MSAA；细线需要它回来 */
      });
      filters.push(noise);
    }

    /* ColorMatrix 对比度保持可选（profile.contrast 默认 0），因为它会让细背景线出现锯齿——
     * 用户通过调参开。 */
    if (amounts.contrast > 0) {
      var colorMatrix = new pixi.ColorMatrixFilter();
      colorMatrix.contrast(amounts.contrast, false);
      colorMatrix.antialias = 'on';
      filters.push(colorMatrix);
    }

    /* 固定的印刷风 pass（RGB 偏移、半调、抖动、暗角）放最后，
     * 让半调网屏与暗角框住已经调过色的画面。 */
    var printFilters = sonnetCreatePrintFilters(pixi, amounts.printEffects);
    for (var i = 0; i < printFilters.length; i++) filters.push(printFilters[i]);
    return filters;
  }

  function sonnetApplyScenePostProcess(pixi, container, profile, seed) {
    var filters = sonnetCreatePostProcessFilters(pixi, profile, seed);
    if (filters.length > 0) {
      container.filters = filters;
    }
    return filters;
  }

  /* ============================== 19. 特效：转场故障 ============================== */
  /* sonnetGlitchFilter.ts：单色安全的水平切片 / 撕裂滤镜，给短暂的故障艺术转场用。 */

  var SONNET_GLITCH_FRAGMENT = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    '',
    'uniform sampler2D uTexture;',
    'uniform vec4 uInputClamp;',
    'uniform float uAmount;',
    'uniform float uSeed;',
    '',
    'float hash(vec2 value) {',
    '    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);',
    '}',
    '',
    'void main(void) {',
    '    float coarseBand = floor(vTextureCoord.y * 26.0);',
    '    float fineBand = floor(vTextureCoord.y * 110.0);',
    '    float coarseNoise = hash(vec2(coarseBand, uSeed));',
    '    float fineNoise = hash(vec2(fineBand + 41.0, uSeed * 1.37));',
    '    float coarseGate = step(0.58, coarseNoise);',
    '    float fineGate = step(0.88, fineNoise);',
    '    float coarseShift = (hash(vec2(coarseBand + 17.0, uSeed)) * 2.0 - 1.0)',
    '        * coarseGate * uAmount * 0.095;',
    '    float fineShift = (hash(vec2(fineBand + 73.0, uSeed)) * 2.0 - 1.0)',
    '        * fineGate * uAmount * 0.035;',
    '    vec2 sampleUv = vec2(vTextureCoord.x + coarseShift + fineShift, vTextureCoord.y);',
    '    vec4 color = texture(uTexture, clamp(sampleUv, uInputClamp.xy, uInputClamp.zw));',
    '',
    '    float tear = (coarseGate * (coarseNoise - 0.58) + fineGate * 0.12) * uAmount;',
    '    color.rgb *= 1.0 + tear * 0.42;',
    '    finalColor = color;',
    '}'
  ].join('\n');

  function sonnetCreateGlitchEffect(pixi) {
    var uniforms = new pixi.UniformGroup({
      uAmount: { value: 0, type: 'f32' },
      uSeed: { value: 0, type: 'f32' }
    });
    var filter = new pixi.Filter({
      glProgram: pixi.GlProgram.from({
        vertex: SONNET_FILTER_VERTEX,
        fragment: SONNET_GLITCH_FRAGMENT,
        name: 'sonnet-mono-glitch'
      }),
      resources: { glitchUniforms: uniforms },
      /* padding 必须保持 0：Pixi 会把链上每个启用滤镜的 padding 求和，在把共享渲染帧
       * 裁到视口之后再把它撑大，所以这里的 padding 只会添加屏幕外像素——同时还会挪动
       * 场景暗角 pass 推导屏幕坐标用的那一帧，导致每次故障转场暗角都向外弹。
       * 撕裂用 uInputClamp 采样，从来不需要那份额外边距。 */
      padding: 0
    });
    filter.enabled = false;
    return {
      filter: filter,
      update: function (amount, seed) {
        uniforms.uniforms.uAmount = amount;
        uniforms.uniforms.uSeed = seed;
      }
    };
  }

  /* ============================== 20. 特效：片尾模糊与画框 ============================== */
  /* sonnetOutroBlur.ts：片尾海报升起时给最后一段场景挂一个 BlurFilter，
   * 强度随片尾帧变化；回到 0 或换场景时摘下销毁。 */

  function SonnetOutroBlur(pixi) {
    this.pixi = pixi;
    this.filter = null;
    this.scene = null;
  }

  SonnetOutroBlur.prototype.isOn = function (scene) {
    return this.scene === scene;
  };

  SonnetOutroBlur.prototype.clear = function () {
    var self = this;
    if (this.filter && this.scene) {
      this.scene.container.filters = (this.scene.container.filters || [])
        .filter(function (filter) { return filter !== self.filter; });
      this.filter.destroy();
    }
    this.filter = null;
    this.scene = null;
  };

  SonnetOutroBlur.prototype.update = function (scene, strength) {
    if (strength <= 0) {
      this.clear();
      return;
    }
    if (this.scene !== scene) this.clear();
    if (!this.filter) {
      this.filter = new this.pixi.BlurFilter({
        strength: 0,
        quality: 2,
        kernelSize: 5,
        resolution: 0.75
      });
      /* 与场景的滤镜链（含后处理暗角）共享，它的 padding 会撑大共享渲染帧，
       * 片尾模糊爬升时把暗角向外带。 */
      this.filter.repeatEdgePixels = true;
      scene.container.filters = (scene.container.filters || []).concat([this.filter]);
      this.scene = scene;
    }
    this.filter.strength = strength;
  };

  /* sonnetFrameOverlay.ts：场景之上的画框层：左上 / 右下的非对称角标、十字、菱形与 ✦。
   * 随 outerFrameMode 与仅文字模式开关。 */

  function sonnetDrawFrameOverlay(pixi, container, width, height, tuning, theme) {
    sonnetDestroyContainerChildren(container);
    if (tuning.showOnlyText || tuning.outerFrameMode === 'none') return;
    var g = new pixi.Graphics();

    var paddingX = Math.max(30, width * 0.05);
    var paddingY = Math.max(30, height * 0.05);

    var primary = pixi.Color.shared.setValue(theme.primaryColor).toNumber();
    var alpha = 0.5;

    /* 非对称的部分周界（不框住整个屏幕）
     * 1. 左上簇 */
    g.rect(paddingX, paddingY, 30, 4).fill({ color: primary, alpha: 0.8 }); /* 粗条 */
    g.moveTo(paddingX, paddingY + 16).lineTo(paddingX, paddingY + 120).stroke({ color: primary, width: 1, alpha: alpha }); /* 下垂线 */

    /* 2. 右下簇 */
    g.rect(width - paddingX - 4, height - paddingY - 16, 4, 16).fill({ color: primary, alpha: 0.8 }); /* 粗竖条 */
    g.moveTo(width - paddingX - 160, height - paddingY).lineTo(width - paddingX - 20, height - paddingY).stroke({ color: primary, width: 1, alpha: alpha }); /* 水平线 */
    g.moveTo(width - paddingX, height - paddingY - 180).lineTo(width - paddingX, height - paddingY - 30).stroke({ color: primary, width: 1, alpha: alpha }); /* 上抬线 */

    /* 3. 浮动点缀 */
    var drawCross = function (cx, cy, size) {
      g.moveTo(cx - size, cy).lineTo(cx + size, cy).stroke({ color: primary, width: 1, alpha: 0.8 });
      g.moveTo(cx, cy - size).lineTo(cx, cy + size).stroke({ color: primary, width: 1, alpha: 0.8 });
    };
    /* 右上十字 */
    drawCross(width - paddingX, paddingY + 20, 6);

    /* 左下菱形 */
    g.moveTo(paddingX, height - paddingY - 4).lineTo(paddingX + 4, height - paddingY).lineTo(paddingX, height - paddingY + 4).lineTo(paddingX - 4, height - paddingY).fill({ color: primary, alpha: 0.7 });

    /* 排字星 ✦ */
    var starStyle = new pixi.TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 12,
      fill: primary
    });
    var starText = new pixi.Text({ text: '✦', style: starStyle });
    starText.alpha = 0.6;
    starText.position.set(width - paddingX - 10, height - paddingY);
    starText.anchor.set(1, 0.5);

    container.addChild(g, starText);
  }

  /* ============================== 21. 片尾字幕 ============================== */
  /* sonnetCredits.ts：最后一句唱完之后登场的曲目海报（标题 / 艺人 / 专辑）。
   * 歌词失焦与海报入场错开起跑，且完全由绝对时间推导 → 拖动进度条也稳定。 */

  function sonnetResolveCreditsFrame(time, finalLyricEndTime) {
    var elapsed = time - finalLyricEndTime;
    if (!(elapsed > 0)) {
      return {
        active: false,
        lyricAlpha: 1,
        lyricBlur: 0,
        posterAlpha: 0,
        posterOffsetY: 0.04,
        posterScale: 0.965
      };
    }
    var lyricExit = sonnetEaseInOut(sonnetClamp01(elapsed / 1.25));
    var posterEnter = sonnetEaseInOut(sonnetClamp01((elapsed - 0.38) / 1.55));
    return {
      active: true,
      lyricAlpha: 1 - lyricExit,
      lyricBlur: lyricExit * 18,
      posterAlpha: posterEnter,
      posterOffsetY: (1 - posterEnter) * 0.04,
      posterScale: 0.965 + posterEnter * 0.035
    };
  }

  function sonnetHasCreditsMetadata(metadata) {
    var title = metadata && metadata.title != null ? String(metadata.title).trim() : '';
    var artist = metadata && metadata.artist != null ? String(metadata.artist).trim() : '';
    var album = metadata && metadata.album != null ? String(metadata.album).trim() : '';
    return Boolean(title || artist || album);
  }

  function sonnetBuildCreditsPoster(pixi, theme, metadata, width, height, lyricsFontScale) {
    var container = new pixi.Container();
    var title = metadata && metadata.title != null ? String(metadata.title).trim() : '';
    var artist = metadata && metadata.artist != null ? String(metadata.artist).trim() : '';
    var album = metadata && metadata.album != null ? String(metadata.album).trim() : '';
    var fontFamily = foliaResolveThemeFontStack(theme);
    var titleWeight = foliaResolveThemeFontWeight(theme, 700);
    var detailWeight = foliaResolveThemeFontWeight(theme, 500);
    var left = Math.max(38, width * 0.105);
    var right = Math.max(38, width * 0.09);
    var contentWidth = Math.max(220, width - left - right);
    var titleSize = Math.max(42, Math.min(118, width * 0.088 * lyricsFontScale));
    var detailSize = Math.max(13, Math.min(25, width * 0.018 * lyricsFontScale));
    var accent = pixi.Color.shared.setValue(theme.accentColor).toNumber();
    var primary = pixi.Color.shared.setValue(theme.primaryColor).toNumber();
    var secondary = pixi.Color.shared.setValue(theme.secondaryColor).toNumber();
    var geometry = new pixi.Graphics();

    geometry
      .rect(left, height * 0.155, Math.max(42, width * 0.075), 5)
      .fill({ color: accent, alpha: 0.95 })
      .rect(left, height * 0.155, 2, height * 0.57)
      .fill({ color: primary, alpha: 0.22 })
      .rect(width - right - 8, height * 0.225, 8, height * 0.34)
      .fill({ color: secondary, alpha: 0.32 })
      .moveTo(left, height * 0.79)
      .lineTo(width - right, height * 0.79)
      .stroke({ color: primary, width: 1, alpha: 0.36 });
    container.addChild(geometry);

    if (artist) {
      var artistText = new pixi.Text({
        text: artist.toLocaleUpperCase(),
        style: new pixi.TextStyle({
          fontFamily: fontFamily,
          fontWeight: String(detailWeight),
          fontSize: detailSize,
          fill: theme.accentColor,
          letterSpacing: Math.max(2, detailSize * 0.18),
          wordWrap: true,
          wordWrapWidth: contentWidth * 0.72
        })
      });
      artistText.position.set(left + 20, height * 0.205);
      container.addChild(artistText);
    }

    if (title) {
      var titleText = new pixi.Text({
        text: title,
        style: new pixi.TextStyle({
          fontFamily: fontFamily,
          fontWeight: String(titleWeight),
          fontSize: titleSize,
          fill: theme.primaryColor,
          leading: -Math.max(2, titleSize * 0.08),
          letterSpacing: -Math.max(0.5, titleSize * 0.018),
          wordWrap: true,
          wordWrapWidth: contentWidth * 0.88,
          breakWords: true
        })
      });
      titleText.position.set(left + 16, height * 0.285);
      container.addChild(titleText);
    }

    if (album) {
      var albumText = new pixi.Text({
        text: '— ' + album,
        style: new pixi.TextStyle({
          fontFamily: fontFamily,
          fontWeight: String(detailWeight),
          fontSize: detailSize * 0.92,
          fill: theme.secondaryColor,
          letterSpacing: Math.max(1, detailSize * 0.1),
          wordWrap: true,
          wordWrapWidth: contentWidth * 0.72
        })
      });
      albumText.position.set(left + 18, height * 0.825);
      container.addChild(albumText);
    }

    container.pivot.set(width / 2, height / 2);
    container.position.set(width / 2, height / 2);
    return container;
  }

  /* ============================== 22. 纹理池 ============================== */
  /* sonnetTexturePool.ts：按 url 引用计数，跨重叠的场景重建共享贴图；归零后延时卸载。 */

  function SonnetTexturePool(load, unload, unloadDelayMs) {
    this.entries = new Map();
    this.load = load;
    this.unload = unload;
    this.unloadDelayMs = typeof unloadDelayMs === 'number' ? unloadDelayMs : 750;
  }

  SonnetTexturePool.prototype.acquire = function (url) {
    var self = this;
    var entry = this.entries.get(url);
    if (!entry) {
      entry = {
        refs: 0,
        value: null,
        promise: null,
        unloadTimer: null
      };
      /* 把「值」记在条目上：卸载回调只拿得到 url，
       * 得靠这里的引用才能把具体贴图销毁掉。 */
      entry.promise = new Promise(function (resolve) {
        resolve(self.load(url));
      }).then(function (value) {
        entry.value = value;
        return value;
      }, function (error) {
        if (self.entries.get(url) === entry) self.entries.delete(url);
        throw error;
      });
      this.entries.set(url, entry);
    }
    entry.refs += 1;
    if (entry.unloadTimer) {
      clearTimeout(entry.unloadTimer);
      entry.unloadTimer = null;
    }
    return entry.promise.then(function (value) { return value; }, function (error) {
      if (self.entries.get(url) === entry) self.entries.delete(url);
      throw error;
    });
  };

  SonnetTexturePool.prototype.release = function (url) {
    var entry = this.entries.get(url);
    if (!entry) return;
    var self = this;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0 || entry.unloadTimer) return;
    entry.unloadTimer = setTimeout(function () {
      if (entry.refs > 0 || self.entries.get(url) !== entry) return;
      self.entries.delete(url);
      try {
        var ret = self.unload(url, entry.value);
        if (ret && typeof ret.then === 'function') ret.then(null, function () { return undefined; });
      } catch (error) { /* 卸载失败不影响引用计数 */ }
    }, this.unloadDelayMs);
  };

  var sonnetPixiPools = new WeakMap();

  /* 图标是 svg data URL。index.html 的 CSP 有 img-src … data: 但**没有** connect-src data:，
   * 所以 pixi.Assets.load(url) 内部走 fetch 会被拦成 "Failed to fetch"（实测 icons=0）。
   * 换成 <img> 加载（走 img-src 放行）再交给 Texture.from 接管，路径同样得到 192x192 的
   * 正常贴图，且同一 img 重复 from 返回同一实例、destroy(true) 不抛。 */
  function sonnetLoadIconTexture(pixi, url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        image.onload = null;
        image.onerror = null;
        var texture;
        try {
          texture = pixi.Texture.from(image);
        } catch (error) {
          reject(error);
          return;
        }
        resolve(texture);
      };
      image.onerror = function () {
        image.onload = null;
        image.onerror = null;
        reject(new Error('icon texture failed to load'));
      };
      image.src = url;
    });
  }

  function sonnetGetTexturePool(pixi) {
    /* 池按 Texture 类挂：同一份 pixi 只留一个池，跨实例共享引用计数。 */
    var key = pixi.Texture;
    var cached = sonnetPixiPools.get(key);
    if (cached) return cached;
    var pool = new SonnetTexturePool(
      function (url) { return sonnetLoadIconTexture(pixi, url); },
      function (url, texture) {
        if (texture && typeof texture.destroy === 'function') texture.destroy(true);
      }
    );
    sonnetPixiPools.set(key, pool);
    return pool;
  }

  /* ============================== 23. 段落场景缓存 ============================== */
  /* pixiSceneCache.ts：按段落下标缓存「当前段 ±1」的场景；换歌时整批换下（retire），
   * 换下的场景由调用方在空闲帧一帧销毁一个。缓存只管存取与销毁；哪一帧建什么、
   * 按什么优先级预建邻段，仍由运行时自己的 renderFrame 决定。 */

  function SonnetSceneCache(hooks) {
    this.hooks = hooks;
    this.scenes = new Map();
    /* 换歌时换下来的场景，之后一帧销毁一个，免得交接那一帧卡住。
     * 销毁一个场景要遍历每个 shot、每个 glyph 的 Text，整批压在盖子落下的那一帧就是
     * 本要被擦除动作藏起来的那个卡顿。 */
    this.retired = [];
  }

  Object.defineProperty(SonnetSceneCache.prototype, 'size', {
    get: function () { return this.scenes.size; }
  });

  Object.defineProperty(SonnetSceneCache.prototype, 'hasRetired', {
    get: function () { return this.retired.length > 0; }
  });

  SonnetSceneCache.prototype.has = function (index) {
    return this.scenes.has(index);
  };

  SonnetSceneCache.prototype.get = function (index) {
    return this.scenes.get(index);
  };

  SonnetSceneCache.prototype.forEach = function (callback) {
    var self = this;
    this.scenes.forEach(function (scene, index) { callback(scene, index, self); });
  };

  /** 取缓存里的场景，没有就建；越界返回 null。 */
  SonnetSceneCache.prototype.ensure = function (index) {
    if (index < 0 || index >= this.hooks.count()) return null;
    var cached = this.scenes.get(index);
    if (cached) return cached;
    var scene = this.hooks.build(index);
    this.scenes.set(index, scene);
    return scene;
  };

  /** 收下一个在缓存外建好的场景（换歌交接的 staged）。 */
  SonnetSceneCache.prototype.adopt = function (index, scene) {
    this.scenes.set(index, scene);
  };

  /** 销毁离 index 超过一段、且不在 keep 里的场景。 */
  SonnetSceneCache.prototype.prune = function (index, keep) {
    var self = this;
    var victims = [];
    this.scenes.forEach(function (scene, sceneIndex) {
      if (Math.abs(sceneIndex - index) <= 1) return;
      if (keep && keep.has && keep.has(sceneIndex)) return;
      victims.push([sceneIndex, scene]);
    });
    for (var i = 0; i < victims.length; i++) {
      self.hooks.destroy(victims[i][1]);
      self.scenes.delete(victims[i][0]);
    }
  };

  /** 立即销毁全部缓存场景（不含已换下的）。 */
  SonnetSceneCache.prototype.clear = function () {
    var self = this;
    this.scenes.forEach(function (scene) { self.hooks.destroy(scene); });
    this.scenes.clear();
  };

  /** 整批换下：摘离场景层但不销毁，留给 drainRetired 一帧一个地释放。 */
  SonnetSceneCache.prototype.retireAll = function () {
    var self = this;
    this.scenes.forEach(function (scene) {
      if (self.hooks.detach) self.hooks.detach(scene);
      self.retired.push(scene);
    });
    this.scenes.clear();
  };

  /** 销毁一个换下的场景；没有可销毁的返回 false。 */
  SonnetSceneCache.prototype.drainRetired = function () {
    var scene = this.retired.shift();
    if (scene === undefined) return false;
    this.hooks.destroy(scene);
    return true;
  };

  /** 运行时销毁：缓存与换下的场景全部释放。 */
  SonnetSceneCache.prototype.destroyAll = function () {
    this.clear();
    var self = this;
    this.retired.forEach(function (scene) { self.hooks.destroy(scene); });
    this.retired.length = 0;
  };

  /* ============================== 24. 转场帧 ============================== */
  /* sonnetTransitions.ts：快而无色散的场景转场帧解析。全部由绝对时间推导 → seek 稳定。
   * 三种 kind：fast-blur / mono-glitch / camera-pull（段落间 + shot 间共用）。 */

  var SONNET_IDLE_TRANSITION_FRAME = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    alpha: 1,
    blur: 0,
    glitch: 0,
    glitchSeed: 0
  };

  function sonnetResolveBoundaryKind(seed, boundaryIndex) {
    var mixed = (seed ^ Math.imul(boundaryIndex + 1, 0x9e3779b1)) >>> 0;
    return SONNET_TRANSITION_KINDS[mixed % SONNET_TRANSITION_KINDS.length];
  }

  function sonnetResolveTransitionEffectFrame(kind, phase, progress, seed) {
    var linear = sonnetClamp01(progress);
    var eased = sonnetEaseInOut(linear);
    var amount = phase === 'exit' ? eased : 1 - eased;

    if (kind === 'fast-blur') {
      return {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.82,
        blur: amount * 14,
        glitch: 0,
        glitchSeed: 0
      };
    }

    if (kind === 'mono-glitch') {
      var step = Math.floor(linear * 14);
      return {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        alpha: phase === 'exit' && linear > 0.86 ? 1 - (linear - 0.86) / 0.14 : 1,
        blur: 0,
        glitch: amount,
        glitchSeed: seed * 0.0001 + step * 0.173
      };
    }

    return {
      x: 0,
      y: 0,
      /* 场景滤镜用视口尺寸的渲染面，所以转场缩放会暴露它的边界 → scale 恒 1。 */
      scale: 1,
      rotation: 0,
      alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.72,
      blur: 0,
      glitch: 0,
      glitchSeed: 0
    };
  }

  function sonnetResolveExitTransitionFrame(paragraph, time, enabled, seed) {
    var transition = paragraph.transitionOut;
    if (!enabled || !transition || time < transition.startTime) return SONNET_IDLE_TRANSITION_FRAME;
    var progress = (time - transition.startTime) / Math.max(transition.endTime - transition.startTime, 0.001);
    return sonnetResolveTransitionEffectFrame(transition.kind, 'exit', progress, seed);
  }

  function sonnetResolveEnterTransitionFrame(kind, timeSinceStart, duration, enabled, seed) {
    if (!enabled || !kind || timeSinceStart < 0 || timeSinceStart > duration) {
      return SONNET_IDLE_TRANSITION_FRAME;
    }
    return sonnetResolveTransitionEffectFrame(kind, 'enter', timeSinceStart / Math.max(duration, 0.001), seed);
  }

  /* 每个版式边界都给一段短转场；一个段落里常常有好几个 shot。 */
  function sonnetResolveShotTransitionFrame(shots, activeShotIndex, time, enabled, seed) {
    if (!enabled || shots.length < 2) return SONNET_IDLE_TRANSITION_FRAME;
    var current = shots[activeShotIndex];
    if (!current) return SONNET_IDLE_TRANSITION_FRAME;

    if (activeShotIndex > 0) {
      var previous = shots[activeShotIndex - 1];
      var duration = Math.min(0.24, Math.max(0.14, (current.startTime - previous.startTime) * 0.18));
      if (time <= current.startTime + duration) {
        return sonnetResolveEnterTransitionFrame(
          sonnetResolveBoundaryKind(seed, activeShotIndex - 1),
          time - current.startTime,
          duration,
          true,
          seed + activeShotIndex * 97
        );
      }
    }

    var next = shots[activeShotIndex + 1];
    if (!next) return SONNET_IDLE_TRANSITION_FRAME;
    var exitDuration = Math.min(0.24, Math.max(0.14, (next.startTime - current.startTime) * 0.18));
    var transitionStart = next.startTime - exitDuration;
    if (time < transitionStart) return SONNET_IDLE_TRANSITION_FRAME;
    return sonnetResolveTransitionEffectFrame(
      sonnetResolveBoundaryKind(seed, activeShotIndex),
      'exit',
      (time - transitionStart) / exitDuration,
      seed + (activeShotIndex + 1) * 97
    );
  }

  /* ============================== 25. 场景帧 ============================== */
  /* sonnetSceneFrame.ts：段落场景级的逐帧决策（纯函数）：场景内哪个 shot 可见，
   * 以及这一帧用 shot 转场还是段落入场 / 出场转场。 */

  /** 严格判定场景内唯一可见的 shot，避免场景内残留。 */
  function sonnetFindActiveShotIndex(scene, time) {
    var activeShotIndex = 0;
    for (var i = scene.shots.length - 1; i >= 0; i--) {
      if (time >= scene.shots[i].shot.startTime) {
        activeShotIndex = i;
        break;
      }
    }
    return activeShotIndex;
  }

  /**
   * 活动段落场景这一帧摆出的转场帧：有 shot 转场在跑就用它，
   * 否则用段落自己的入场 / 出场转场。
   */
  function sonnetResolveSceneTransitionFrame(program, scene, index, visibleShotIndex, time, transitionsEnabled) {
    var transitionSeed = sonnetHashSeed(program.seed + ':' + scene.paragraph.id + ':transition-frame');
    var previousTransition = index > 0 && program.paragraphs[index - 1]
      ? program.paragraphs[index - 1].transitionOut
      : null;
    var enterDuration = previousTransition
      ? Math.max(0.16, Math.min(0.3, previousTransition.endTime - previousTransition.startTime))
      : 0;
    var entering = transitionsEnabled
      && previousTransition !== null
      && time >= scene.paragraph.startTime
      && time <= scene.paragraph.startTime + enterDuration;
    var paragraphTransitionFrame = entering
      ? sonnetResolveEnterTransitionFrame(
        previousTransition.kind,
        time - scene.paragraph.startTime,
        enterDuration,
        true,
        transitionSeed
      )
      : sonnetResolveExitTransitionFrame(
        scene.paragraph,
        time,
        transitionsEnabled,
        transitionSeed
      );

    var shotTransitionFrame = sonnetResolveShotTransitionFrame(
      scene.shotTimeline,
      visibleShotIndex,
      time,
      transitionsEnabled,
      transitionSeed
    );
    return shotTransitionFrame !== SONNET_IDLE_TRANSITION_FRAME
      ? shotTransitionFrame
      : paragraphTransitionFrame;
  }

  /* ============================== 26. 场景构建 ============================== */
  /* sonnetSceneBuilder.ts：建一个有界的段落场景；播放期的逐帧变异归运行时管。
   * 这是整个运行时里最贵的一次调用：对每个字素跑一遍排版，再给每个字素建一个 pixi.Text。
   * 一帧里绝不该跑两次。 */

  function sonnetShouldDrawSceneBackdrop(showBackgroundMg, transparentBackground) {
    return showBackgroundMg && !transparentBackground;
  }

  function sonnetBuildScene(pixi, options, iconTextures, paragraph) {
    var Container = pixi.Container;
    var Graphics = pixi.Graphics;
    var width = Math.max(options.host.clientWidth, 320);
    var height = Math.max(options.host.clientHeight, 240);
    var container = new Container();
    var sceneBackgroundLayer = new Container();
    /* 可见性在构建时一次定死；播放期只改动画状态。 */
    var showOnlyText = options.tuning.showOnlyText;
    var showBackgroundMg = !showOnlyText && options.tuning.showBackgroundMg;
    var showFixedGeo = !showOnlyText && options.tuning.showFixedGeo;
    var showBackgroundDecor = !showOnlyText && options.tuning.showBackgroundDecor;
    var showGuide = !showOnlyText && options.tuning.showGuide;
    var showOuterMetadata = !showOnlyText && options.tuning.outerFrameMode === 'full';
    var sceneSeed = sonnetHashSeed(options.programSeed + ':' + paragraph.id);
    var postProcessProfile = sonnetResolvePostProcessProfile(
      options.theme,
      options.tuning,
      options.staticMode
    );
    var fontFamily = foliaResolveThemeFontStack(options.theme);
    var manualFontWeight = foliaNormalizeFontWeight(options.theme.weight);
    var postProcessFilters = [];
    if (showBackgroundMg) {
      var density = Math.round(4 + options.tuning.mgDensity * 5);
      if (sonnetShouldDrawSceneBackdrop(showBackgroundMg, options.transparentBackground)) {
        sceneBackgroundLayer.addChild(new Graphics()
          .rect(0, 0, width, height)
          .fill({ color: pixi.Color.shared.setValue(options.theme.backgroundColor).toNumber(), alpha: 0.10 }));
      }

      for (var index = 0; index < density; index += 1) {
        var x = ((sceneSeed + index * 97) % 997) / 997 * width;
        var y = ((sceneSeed + index * 193) % 991) / 991 * height;
        var length = 32 + ((sceneSeed + index * 43) % 180);
        sceneBackgroundLayer.addChild(new Graphics()
          .moveTo(x, y)
          .lineTo(Math.min(width, x + length), y)
          .stroke({
            color: pixi.Color.shared.setValue(index % 2 ? options.theme.secondaryColor : options.theme.accentColor).toNumber(),
            width: index % 3 === 0 ? 2 : 1,
            alpha: 0.12 + (index % 4) * 0.04
          }));
      }
    }

    var Text = pixi.Text;
    var TextStyle = pixi.TextStyle;
    /* 装饰性主题元数据文字（本项目 theme 无 name/description → 永不命中，照抄保留） */
    if (options.theme.name) {
      var nameText = new Text({
        text: '[ THEME ] ' + String(options.theme.name).toUpperCase(),
        style: new TextStyle({
          fontFamily: fontFamily,
          fontWeight: manualFontWeight === null ? 'bold' : String(manualFontWeight),
          fontSize: 14,
          fill: options.theme.primaryColor,
          letterSpacing: 4
        })
      });
      nameText.alpha = 0.2;
      nameText.rotation = -Math.PI / 2;
      nameText.position.set(20, height - 20);
      nameText.anchor.set(0, 1);
      if (showOuterMetadata) sceneBackgroundLayer.addChild(nameText);
    }

    if (options.theme.description) {
      var descText = new Text({
        text: options.theme.description,
        style: new TextStyle({
          fontFamily: fontFamily,
          fontWeight: manualFontWeight === null ? undefined : String(manualFontWeight),
          fontSize: 12,
          fill: options.theme.secondaryColor,
          wordWrap: true,
          wordWrapWidth: width * 0.3
        })
      });
      descText.alpha = 0.3;
      descText.position.set(width - 20, 20);
      descText.anchor.set(1, 0);
      if (showOuterMetadata) sceneBackgroundLayer.addChild(descText);
    }
    container.addChild(sceneBackgroundLayer);
    var shots = paragraph.shots.map(function (shot, shotIndex) {
      var shotContainer = new Container();
      var compiledLines = [];
      for (var li = 0; li < shot.lineIndices.length; li++) {
        var found = null;
        for (var pj = 0; pj < paragraph.lines.length; pj++) {
          if (paragraph.lines[pj].sourceIndex === shot.lineIndices[li]) { found = paragraph.lines[pj]; break; }
        }
        if (found) compiledLines.push(found);
      }
      var linesSegments = [];
      for (var ls = 0; ls < compiledLines.length; ls++) {
        var kept = [];
        for (var sg = 0; sg < compiledLines[ls].segments.length; sg++) {
          if (sonnetIsLayoutSegment(compiledLines[ls].segments[sg])) kept.push(compiledLines[ls].segments[sg]);
        }
        if (kept.length > 0) linesSegments.push(kept);
      }
      var segments = [];
      for (var fl = 0; fl < linesSegments.length; fl++) {
        for (var fs = 0; fs < linesSegments[fl].length; fs++) segments.push(linesSegments[fl][fs]);
      }
      var wordCount = 0;
      for (var wc = 0; wc < segments.length; wc++) {
        if (segments[wc].isWordLike) wordCount += 1;
      }
      wordCount = Math.max(1, wordCount);
      var heroScale = shot.kind === 'type-impact' ? 1.55 : shot.kind === 'quiet-tableau' ? 0.82 : 1;
      var fontSize = Math.max(24, Math.min(112, (
        width / Math.max(7, wordCount * 2.15)
      ) * heroScale * options.lyricsFontScale));
      var views = [];
      var placements = sonnetResolveTypographyLayout({
        lines: linesSegments,
        shotKind: shot.kind,
        paragraphKind: paragraph.kind,
        width: width,
        height: height,
        baseFontSize: fontSize,
        fontFamily: fontFamily,
        fontWeight: manualFontWeight
      });
      var shotSeed = sceneSeed + shotIndex * 97;
      var mgLayer = window.foliaSonnetMg.buildShotMg(
        pixi,
        shot.kind,
        options.theme,
        width,
        height,
        shotSeed,
        iconTextures
      );
      shotContainer.addChild(mgLayer);
      var mgBackgroundLayer = mgLayer.bgLayer;
      var mgGeoLayer = mgLayer.geoLayer;
      var mgParticleLayer = mgLayer.particleLayer;
      var mgFixedGeoLayer = mgLayer.fixedGeoLayer;
      mgLayer.visible = showBackgroundMg || showFixedGeo || showBackgroundDecor;
      if (mgBackgroundLayer) mgBackgroundLayer.visible = showBackgroundMg;
      if (mgGeoLayer) mgGeoLayer.visible = showBackgroundMg;
      if (mgParticleLayer) mgParticleLayer.visible = showBackgroundDecor;
      if (mgFixedGeoLayer) mgFixedGeoLayer.visible = showFixedGeo;
      var halo = sonnetCreateHaloLayer(pixi, postProcessProfile);
      var haloLayer = halo.layer;
      var guideLayer = new Container();
      var textLayer = new Container();
      /* 每个字素的 screen 混合色散副本共用这一层，而不是各自挂在 glyph wrapper 里。
       * 交错出现的 screen / normal 子节点会让 Pixi 每次切换都断批，把一个 shot 变成
       * 每字素约 2 次 draw；Intel 集显正是在这种流上挂过，而失败的引擎重置会把
       * 合成器一起带走。加在最前，好让后插入到 index 0 的背景形状与文字装饰框
       * 仍然压在色散下面。 */
      var caLayer = new Container();
      textLayer.addChild(caLayer);
      guideLayer.visible = showGuide;
      haloLayer.visible = !showOnlyText;
      shotContainer.addChild(guideLayer, haloLayer, textLayer);
      for (var hf = 0; hf < halo.filters.length; hf++) postProcessFilters.push(halo.filters[hf]);
      /* 虚词器乐行可以共用同一个 shot；整份五线谱属于 shot，不属于每一行。 */
      var staffViewAdded = false;
      placements.forEach(function (placement, placementIndex) {
        var segment = segments[placement.segmentIndex];
        if (segment.text === '♪') {
          if (staffViewAdded) return;
          staffViewAdded = true;
        }
        views.push(sonnetBuildTextView(
          pixi,
          {
            segment: segment,
            placement: placement,
            segmentIndex: placement.segmentIndex,
            baseFontSize: fontSize,
            shotStartTime: shot.startTime,
            shotEndTime: shot.endTime,
            paragraphKind: paragraph.kind,
            width: width,
            fontFamily: fontFamily,
            fontWeight: manualFontWeight,
            theme: options.theme,
            glowEnabled: postProcessProfile.glowStrength > 0,
            showFixedGeo: showFixedGeo,
            guideLayer: guideLayer,
            haloLayer: haloLayer,
            textLayer: textLayer,
            caLayer: caLayer
          }
        ));
      });
      var bounds = shotContainer.getLocalBounds();
      /* `mask-reveal` 由字素时间轴揭晓。按 bounds 尺寸做遮罩会在相机跟踪与视差
       * 移动 shot 时保持静止，从而切开展开的 MG 画面。
       * 调试覆盖层留在文字之上，且绝不参与 bounds / focus 计算。 */
      shotContainer.addChild(sonnetBuildMeasuredBoundsDebug(pixi, placements));
      var usesGeoMg = shot.kind === 'type-impact' || shot.kind === 'fragment-collage';
      var debugInfo = sonnetCreateShotDebugInfo({
        programSeed: options.programSeed,
        paragraphId: paragraph.id,
        paragraphKind: paragraph.kind,
        shot: shot,
        shotIndex: shotIndex,
        shotCount: paragraph.shots.length,
        baseFontSize: fontSize,
        wordCount: wordCount,
        geoVariant: usesGeoMg ? window.foliaSonnetMg.resolveGeoVariant(shotSeed) : null,
        backgroundMgVariant: window.foliaSonnetMg.resolveBackgroundMgVariant(shotSeed),
        fixedGeoVariant: usesGeoMg ? window.foliaSonnetMg.resolveFixedGeoVariant(shotSeed) : null,
        backgroundDecorVariant: window.foliaSonnetMg.resolveBackgroundDecorVariant(shotSeed),
        placements: placements,
        segmentTexts: segments.map(function (segment) { return segment.text; })
      });

      /* 海报块在运行时跟踪之前先居中；其他版式从主词开始。 */
      var heroPlacement = null;
      for (var hp = 0; hp < placements.length; hp++) {
        if (placements[hp].role === 'hero') { heroPlacement = placements[hp]; break; }
      }
      var focusX = shot.kind === 'poster-blocks'
        ? 0
        : heroPlacement ? heroPlacement.x : (bounds.x + bounds.width / 2);
      var focusY = shot.kind === 'poster-blocks'
        ? 0
        : heroPlacement ? heroPlacement.y : (bounds.y + bounds.height / 2);

      shotContainer.pivot.set(focusX, focusY);
      shotContainer.position.set(
        width * (shot.kind === 'poster-blocks' ? 0.5 : 0.5 + shot.camera.x),
        height * (shot.kind === 'poster-blocks'
          ? 0.5
          : 0.48 + shot.camera.y + (shotIndex % 2 ? 0.025 : -0.025))
      );
      container.addChild(shotContainer);
      return {
        shot: shot,
        container: shotContainer,
        segments: views,
        debugInfo: debugInfo,
        baseX: shotContainer.x,
        baseY: shotContainer.y,
        basePivotX: focusX,
        basePivotY: focusY,
        haloLayer: haloLayer,
        mgLayer: mgLayer,
        mgBackgroundLayer: mgBackgroundLayer,
        mgGeoLayer: mgGeoLayer,
        mgParticleLayer: mgParticleLayer,
        mgFixedGeoLayer: mgFixedGeoLayer
      };
    });

    if (!showOnlyText) {
      var sceneFilters = sonnetApplyScenePostProcess(pixi, container, postProcessProfile, sceneSeed);
      if (sceneFilters.length > 0) {
        /* 让整景 shader 留在视口空间，即使可见歌词 / 装饰的 bounds 更小。 */
        container.filterArea = new pixi.Rectangle(0, 0, width, height);
        for (var sf = 0; sf < sceneFilters.length; sf++) postProcessFilters.push(sceneFilters[sf]);
      }
    }
    var transitionBlurFilter = options.tuning.enableTransitions && !options.staticMode
      ? new pixi.BlurFilter({ strength: 0, quality: 1, kernelSize: 5, resolution: 0.5 })
      : null;
    if (transitionBlurFilter) {
      /* BlurFilter 的 padding 是 strength * 2，而 Pixi 会把链上每个启用滤镜的 padding
       * 求和，在把共享渲染帧（已经裁到视口）撑大。不断变大的帧会重算暗角 pass 的屏幕
       * 坐标，于是转场中逐渐加重的模糊会把暗角擦亮。repeatEdgePixels 把 padding 钉在 0；
       * 那份额外边距本来就在屏幕外。 */
      transitionBlurFilter.repeatEdgePixels = true;
      transitionBlurFilter.enabled = false;
      container.filters = (container.filters || []).concat([transitionBlurFilter]);
      postProcessFilters.push(transitionBlurFilter);
    }
    var transitionGlitchEffect = options.tuning.enableTransitions && !options.staticMode
      ? sonnetCreateGlitchEffect(pixi)
      : null;
    if (transitionGlitchEffect) {
      container.filters = (container.filters || []).concat([transitionGlitchEffect.filter]);
      postProcessFilters.push(transitionGlitchEffect.filter);
    }
    container.visible = false;
    return {
      paragraph: paragraph,
      container: container,
      shots: shots,
      shotTimeline: shots.map(function (shot) { return shot.shot; }),
      postProcessFilters: postProcessFilters,
      transitionBlurFilter: transitionBlurFilter,
      transitionGlitchEffect: transitionGlitchEffect,
      activeShotIndex: -1
    };
  }

  /* ============================== 27. 镜头跟踪与 shot 逐帧 ============================== */
  /* sonnetCameraTracking.ts + sonnetShotFrame.ts：单个 shot 的逐帧姿态。
   * 镜头运动、间隙漂移与呼吸、逐段焦点跟踪、MG / 引导线 / 开放画框时间，
   * 以及逐字入场、视差、色差与回声。只按绝对播放时间与传入的设置写 view，不持有状态。 */

  /* 只插值语义相机字素；装饰性渲染节点必须先滤掉。 */
  function sonnetResolveSegmentCameraFocus(glyphs, time, trackingFactor) {
    var factor = trackingFactor === undefined ? 0.5 : trackingFactor;
    if (glyphs.length === 0) return { x: 0, y: 0 };
    var first = glyphs[0];
    var last = glyphs[glyphs.length - 1];
    var segCenterX = (first.baseX + last.baseX) / 2;
    var segCenterY = (first.baseY + last.baseY) / 2;
    var applyFactor = function (exactX, exactY) {
      return {
        x: segCenterX + (exactX - segCenterX) * factor,
        y: segCenterY + (exactY - segCenterY) * factor
      };
    };

    if (time <= first.startTime) return applyFactor(first.baseX, first.baseY);
    if (time >= last.startTime) return applyFactor(last.baseX, last.baseY);

    for (var index = 0; index < glyphs.length - 1; index += 1) {
      var current = glyphs[index];
      var next = glyphs[index + 1];
      if (time < current.startTime || time > next.startTime) continue;
      var progress = (time - current.startTime) / Math.max(0.001, next.startTime - current.startTime);
      return applyFactor(
        current.baseX + (next.baseX - current.baseX) * progress,
        current.baseY + (next.baseY - current.baseY) * progress
      );
    }
    return applyFactor(first.baseX, first.baseY);
  }

  /** 读一个 mod 调制键，缺省给 1 → 键不存在时这一帧不变。 */
  function sonnetReadModulation(modulation, key) {
    var value = modulation ? modulation[key] : undefined;
    return typeof value === 'number' && isFinite(value) ? value : 1;
  }

  var sonnetShotTrackingCache = new WeakMap();

  /* 被相机跟踪的段与它们的焦点窗口在 shot 建好时就定死了，
   * 所以在 shot 的第一帧算一次，之后一直复用。 */
  function sonnetResolveShotTracking(view) {
    var cached = sonnetShotTrackingCache.get(view);
    if (cached) return cached;
    var trackSegments = view.segments.filter(function (s) {
      return s.role !== 'decoration' && s.trackingGlyphs.length > 0;
    });
    if (trackSegments.length === 0) {
      trackSegments = view.segments.filter(function (s) { return s.trackingGlyphs.length > 0; });
    }
    var revealDoneTime;
    if (trackSegments.length > 0) {
      revealDoneTime = view.shot.endTime;
      for (var r = 0; r < trackSegments.length; r++) {
        var glyphs = trackSegments[r].trackingGlyphs;
        var lastGlyph = glyphs.length ? glyphs[glyphs.length - 1] : null;
        var candidate = lastGlyph ? lastGlyph.startTime : view.shot.endTime;
        if (candidate > revealDoneTime) revealDoneTime = candidate;
      }
    } else {
      revealDoneTime = view.shot.endTime;
    }
    var focusRanges = trackSegments.map(function (segment) {
      var segGlyphs = segment.trackingGlyphs;
      var firstGlyph = segGlyphs.length ? segGlyphs[0] : null;
      var lastOne = segGlyphs.length ? segGlyphs[segGlyphs.length - 1] : null;
      return {
        startTime: firstGlyph ? firstGlyph.startTime : view.shot.startTime,
        endTime: lastOne ? lastOne.startTime : view.shot.endTime
      };
    });
    var tracking = { trackSegments: trackSegments, revealDoneTime: revealDoneTime, focusRanges: focusRanges };
    sonnetShotTrackingCache.set(view, tracking);
    return tracking;
  }

  function sonnetUpdateShot(view, time, width, height, shakeIntensity, context) {
    var tuning = context.tuning;
    var theme = context.theme;
    var audioBands = context.audioBands;
    var audioPowerValue = context.audioPower;
    var mod = context.mod;
    var progress = sonnetResolveShotProgress(view.shot, time);
    var motion = tuning.typographyMotion * sonnetResolveAnimationScale(theme) * mod('motionScale');
    var camera = tuning.cameraIntensity * sonnetResolveAnimationScale(theme) * mod('cameraScale');
    var cameraFrame = sonnetResolveShotMotionFrame(view.shot.kind, progress);

    /* 间隙期加一段缓慢连续的平移，免得场景看起来冻住。 */
    var gapTime = Math.max(0, time - view.shot.endTime);
    if (gapTime > 0) {
      /* 沿用 shot 尾部（progress 0.8~1.0）的运动方向。 */
      var tailStart = sonnetResolveShotMotionFrame(view.shot.kind, 0.8);
      var dx = cameraFrame.x - tailStart.x;
      var dy = cameraFrame.y - tailStart.y;
      var dScale = cameraFrame.scale - tailStart.scale;
      var dRot = cameraFrame.rotation - tailStart.rotation;

      /* 按那个方向以缓慢放松的 PV 速度继续漂。
       * speed = 0.8 表示漂过相机在 shot 最后 20% 里走过的同样距离要 1.25 秒。 */
      var maxDrift = 2.0;
      var driftSpeed = (1 - Math.exp(-gapTime * 0.4)) * maxDrift * mod('driftScale');
      cameraFrame.x += dx * driftSpeed;
      cameraFrame.y += dy * driftSpeed;
      cameraFrame.scale += dScale * driftSpeed;
      cameraFrame.rotation += dRot * driftSpeed;
    }

    var shake = sonnetResolveTimelineShake(time, shakeIntensity);

    var tracking = sonnetResolveShotTracking(view);
    var trackSegments = tracking.trackSegments;
    var revealDoneTime = tracking.revealDoneTime;
    var focusRanges = tracking.focusRanges;

    /* 歌词揭晓完成后叠一层确定性的呼吸浮动，于是 shot 保持或漂过间隙时
     * 画面绝不会彻底静止。 */
    var breathWeight = sonnetResolveBreathWeight(time, revealDoneTime);
    if (breathWeight > 0) {
      var breathPhase = (sonnetHashSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2;
      var breath = sonnetResolveCameraBreath(time, breathPhase);
      var breathScale = mod('breathScale');
      cameraFrame.x += breath.x * breathWeight * breathScale;
      cameraFrame.y += breath.y * breathWeight * breathScale;
      cameraFrame.scale += breath.scale * breathWeight * breathScale;
      cameraFrame.rotation += breath.rotation * breathWeight * breathScale;
    }

    var currentFocusX = view.basePivotX;
    var currentFocusY = view.basePivotY;

    if (trackSegments.length > 0) {
      var resolveFocusAtTime = function (focusTime) {
        var focusX = 0;
        var focusY = 0;
        var focusWeights = sonnetResolveFocusWeights(focusRanges, focusTime);
        for (var i = 0; i < trackSegments.length; i++) {
          var seg = trackSegments[i];
          if (seg.trackingGlyphs.length === 0) continue;
          var weight = focusWeights.length > i ? focusWeights[i] : 0;
          if (weight === undefined) weight = 0;
          var pos = sonnetResolveSegmentCameraFocus(seg.trackingGlyphs, focusTime);
          focusX += pos.x * weight;
          focusY += pos.y * weight;
        }
        return { x: focusX, y: focusY };
      };
      var focusTime = Math.max(view.shot.startTime, Math.min(time, view.shot.endTime));
      var smoothedFocus = sonnetResolveSmoothedCameraFocus(
        focusTime,
        view.shot.startTime,
        view.shot.endTime,
        resolveFocusAtTime
      );

      currentFocusX = smoothedFocus.x;
      currentFocusY = smoothedFocus.y;
    }

    view.container.pivot.set(
      view.basePivotX + (currentFocusX - view.basePivotX) * camera,
      view.basePivotY + (currentFocusY - view.basePivotY) * camera
    );

    view.container.scale.set(
      view.shot.camera.zoom * (1 + (cameraFrame.scale - 1) * camera)
    );
    view.container.rotation = (
      view.shot.camera.rotation + cameraFrame.rotation + shake.rotation
    ) * camera;
    view.container.x = view.baseX + (cameraFrame.x * width + shake.x * width) * camera;
    view.container.y = view.baseY + (cameraFrame.y * height + shake.y * height) * camera;

    if (view.mgParticleLayer) {
      /* 给装饰元素一点时间差 / 视差。 */
      var particleParallaxX = (cameraFrame.x * width + shake.x * width) * camera * 0.4 * mod('parallaxScale');
      var particleParallaxY = (cameraFrame.y * height + shake.y * height) * camera * 0.4 * mod('parallaxScale');
      view.mgParticleLayer.position.set(particleParallaxX, particleParallaxY);

      /* 按 shot 时间持续独立旋转。 */
      view.mgParticleLayer.rotation = (time - view.shot.startTime) * 0.05 * mod('mgSwimScale');
      /* 更慢的缩放响应制造深度错觉。 */
      view.mgParticleLayer.scale.set(1 + (cameraFrame.scale - 1) * 0.3);
    }

    if (view.mgFixedGeoLayer) {
      /* 固定几何不管相机怎么转都保持竖直。 */
      view.mgFixedGeoLayer.rotation = -view.container.rotation;
    }

    /* 本项目 audioBands / audioPower 是裸数值（Folia 是 MotionValue）。 */
    var audioBass = audioBands && typeof audioBands.bass === 'number' ? audioBands.bass : 0;
    var audioPower = typeof audioPowerValue === 'number' ? audioPowerValue : 0;
    var audioVocal = audioBands && typeof audioBands.vocal === 'number' ? audioBands.vocal : 0;

    if (view.mgLayer.updateTime) {
      view.mgLayer.updateTime(
        time,
        view.shot.cues,
        view.shot.startTime,
        view.shot.endTime,
        audioBass,
        audioPower,
        audioVocal
      );
    }

    view.segments.forEach(function (segmentView) {
      var guide = segmentView.guide;
      var guideActive = time >= guide.startTime && time <= guide.endTime;
      guide.container.visible = guideActive && tuning.showGuide && !tuning.showOnlyText;
      if (guideActive) {
        var guideProgress = sonnetClamp01(
          (time - guide.startTime) / Math.max(0.001, guide.endTime - guide.startTime)
        );
        if (guide.update) {
          guide.container.alpha = guide.maxAlpha;
          guide.update(guideProgress);
        } else {
          var eased = sonnetEaseInOut(guideProgress);
          guide.container.alpha = Math.sin(eased * Math.PI) * guide.maxAlpha;
          guide.container.scale.set(0.76 + eased * 0.24);
        }
      }

      /* 装饰性开放画框与「文字浮标」（showFixedGeo）共用开关。 */
      var frameDecor = segmentView.frameDecor;
      if (frameDecor) {
        var frameVisible = tuning.showFixedGeo && !tuning.showOnlyText;
        frameDecor.container.visible = frameVisible;
        if (frameVisible) {
          frameDecor.update(sonnetClamp01(
            (time - frameDecor.startTime) / Math.max(0.001, frameDecor.endTime - frameDecor.startTime)
          ));
        }
      }

      segmentView.glyphs.forEach(function (glyph) {
        var glyphProgress = sonnetResolveSegmentProgress(glyph.startTime, glyph.settleTime, time);
        var waiting = time < glyph.startTime;
        var offset = (1 - glyphProgress) * motion;
        var coreAlpha = waiting ? 0 : 0.16 + glyphProgress * 0.84;
        var haloAlpha = waiting ? 0 : 1 - glyphProgress * 0.28;
        var scale = sonnetIsEmphasisRole(segmentView.role) && view.shot.kind === 'type-impact'
          ? 0.52 + glyphProgress * 0.48
          : 0.86 + glyphProgress * 0.14;
        var x = glyph.baseX + glyph.enterX * offset;
        var y = glyph.baseY + glyph.enterY * offset;
        var rotation = glyph.finalRotation + glyph.entryRotation * offset;
        var isGiantDecorativeText = segmentView.role === 'decoration';
        var showTextGlyph = glyph.isTextGlyph !== false;
        var glyphVisible = tuning.showOnlyText
          ? showTextGlyph && (!isGiantDecorativeText || tuning.showGiantDecorativeText)
          : (!glyph.isBackgroundShape || tuning.showBackgroundDecor)
            && (!isGiantDecorativeText || tuning.showGiantDecorativeText);

        /* 模拟视差 3D 效果。 */
        var depth = glyph.zDepth || 0;
        var parallaxScale = mod('parallaxScale');
        /* 比相机走得快 / 慢。 */
        var parallaxX = (cameraFrame.x * width + shake.x * width) * camera * depth * 2.5 * parallaxScale;
        var parallaxY = (cameraFrame.y * height + shake.y * height) * camera * depth * 2.5 * parallaxScale;
        /* 越近（正 depth）放得越大。 */
        var depthScale = 1 + depth * 0.45 * parallaxScale;

        glyph.display.alpha = coreAlpha;
        glyph.display.visible = glyphVisible;
        glyph.display.scale.set(scale * depthScale);
        glyph.display.position.set(x + parallaxX, y + parallaxY);
        glyph.display.rotation = rotation;
        if (glyph.halo) {
          glyph.halo.alpha = haloAlpha;
          glyph.halo.scale.set(scale * (1.08 - glyphProgress * 0.08));
          glyph.halo.position.set(x, y);
          glyph.halo.rotation = rotation;
        }

        /* 让色散分离与合并都动起来。 */
        if (glyph.caWrapper && glyph.caCyan && glyph.caRed && glyph.caOffset !== undefined) {
          var ca = glyph.caWrapper;
          ca.visible = glyphVisible && !tuning.showOnlyText;
          ca.alpha = coreAlpha;
          ca.scale.copyFrom(glyph.display.scale);
          ca.position.copyFrom(glyph.display.position);
          ca.rotation = rotation;
          /* 起步是分离的（冲击感），然后轻轻并到一个很淡的基础偏移上。 */
          var mergeEased = sonnetEaseInOut(glyphProgress);
          var currentOffset = glyph.caOffset * (1 - mergeEased * 0.8) * mod('caScale'); /* 1.0 -> 0.2 */

          glyph.caCyan.position.set(-currentOffset, currentOffset * 0.5);
          glyph.caRed.position.set(currentOffset, -currentOffset * 0.5);
        }

        /* 半英雄回声鬼影：字素入场时沿版式法线撕开，
         * 前四分之一淡入，然后迅速消失。一次性。 */
        if (glyph.ghosts && glyph.ghostDuration) {
          var ghostProgress = sonnetClamp01((time - glyph.startTime) / glyph.ghostDuration);
          var ghostActive = glyphVisible && ghostProgress > 0 && ghostProgress < 1;
          /* 快淡入，然后平方衰减，让回声死得快。 */
          var envelope = ghostProgress <= 0.2
            ? ghostProgress / 0.2
            : Math.pow(1 - (ghostProgress - 0.2) / 0.8, 2);
          var spread = (1 - Math.pow(1 - ghostProgress, 3)) * mod('ghostScale');
          for (var gi = 0; gi < glyph.ghosts.length; gi++) {
            var ghost = glyph.ghosts[gi];
            ghost.node.visible = ghostActive;
            if (!ghostActive) continue;
            ghost.node.position.set(ghost.dirX * spread, ghost.dirY * spread);
            ghost.node.alpha = envelope * ghost.alphaBase;
          }
        }

        if (glyph.updateAnimation) glyph.updateAnimation(time);
      });
    });
  }

  /* ============================== 28. 换歌闸门与器乐虚词 ============================== */
  /* songHandover.ts：共享的「屏幕上到底是哪首歌」闸门。父层在切歌时会把歌词清成 []，
   * 几个渲染后再填上，于是一路跟着 seed 走的模式会对着空歌重建、再把词弹出来。
   * 下面全部跑在一个「已提交歌」上，它在新歌就绪前一直滞后于真歌。 */

  /* 已存分词在集合上的折叠，混进下面的签名里。
   * 本项目 lines 恒无 wordSegments → 每行一次 null 检查，恒定折到同一个常数。 */
  function sonnetHashWordSegments(lines) {
    var hash = 2166136261;
    var mix = function (value) { hash = Math.imul(hash ^ value, 16777619); };
    for (var index = 0; index < lines.length; index++) {
      var line = lines[index];
      if (!line || !line.wordSegments) continue;
      mix(index);
      for (var s = 0; s < line.wordSegments.length; s++) mix(line.wordSegments[s].length);
    }
    return hash >>> 0;
  }

  /* 一组歌词的内容签名。空串表示「没有词」，刻意让「还在加载」与「纯器乐」保持歧义，
   * 只有播放进度能区分这两者。 */
  function sonnetLyricsSignature(lines) {
    var list = lines || [];
    if (list.length === 0) return '';
    return list.length + '|' + (list[0] && list[0].fullText != null ? list[0].fullText : '')
      + '|' + sonnetHashWordSegments(list);
  }

  /* 整个闸门，作为一个纯决策。 */
  function sonnetDecideSongCommit(input) {
    var seed = input.seed;
    var committedSeed = input.committedSeed;
    var lyricsSignature = input.lyricsSignature;
    var committedSignature = input.committedSignature;
    var isCommittedInstrumental = input.isCommittedInstrumental;

    if (seed === committedSeed) {
      if (lyricsSignature === '') {
        /* 词消失从来不是关于这首歌的新消息：那是父层正站在两首歌之间，
         * 而 seed 比歌词早一个渲染到达可视化层。在这里提交空集，
         * 正是过去会在歌词已缓存的歌上闪一下「等待播放」占位的原因。 */
        if (isCommittedInstrumental) return { action: 'idle' };
        /* 于是让已提交的词留在屏幕上，改为观察播放进度。若集合一直是空的
         * （听众的歌词过滤器滤掉了每一行，或歌词被重处理到什么都不剩），
         * 这首歌就安顿成器乐；在这里直接 idle 会让被删掉的行在整首歌里留在屏幕上。
         * 新词落地会取消这次观察。 */
        return { action: 'watch' };
      }
      /* 同一首歌，不同的词：迟到加载或重处理。就地收下 —— 在这里按住不放，
       * 会让模式继续画播放器已经走过去的歌词。 */
      if (lyricsSignature !== committedSignature) return { action: 'commit', isInstrumental: false };
      return { action: 'idle' };
    }

    /* 新歌要等它的词落地才登台，而且必须是「不同的词」：
     * seed 比 lines 早一个渲染翻转，所以签名相同只说明那是上一首歌的歌词
     * 还挂在 prop 里，不是新歌的。 */
    if (lyricsSignature !== '' && lyricsSignature !== committedSignature) {
      return { action: 'commit', isInstrumental: false };
    }
    return { action: 'watch' };
  }

  /* 绑定播放进度而不是墙钟：一首 merely 在加载的歌还没往前走，于是继续等它的词；
   * 而一首真的已经播了这么远却仍然没有词的，按器乐处理。
   * readyGraceMs 是「一首永不开始的歌」的逃生口。 */
  function sonnetIsInstrumentalConfirmed(state, limits) {
    return (state.sawPlaybackReset && state.playbackTime >= limits.instrumentalCommitSeconds)
      || state.elapsedMs >= limits.readyGraceMs;
  }

  /* VisualizerSonnet.tsx：纯器乐生成 60 条 ♪ 虚词，每条 8s（= La Folia 循环）。 */
  function sonnetBuildVirtualLines() {
    var generated = [];
    for (var i = 0; i < SONNET_INSTRUMENTAL_LINE_COUNT; i++) {
      generated.push({
        id: 'virtual-staff-' + i,
        startTime: i * SONNET_INSTRUMENTAL_CYCLE_SECONDS,
        endTime: i * SONNET_INSTRUMENTAL_CYCLE_SECONDS + 6,
        fullText: '♪',
        words: [],
        isChorus: false
      });
    }
    return generated;
  }

  /* ============================== 29. 运行时 ============================== */
  /* createSonnetPixiRuntime.ts：持有 Pixi 生命周期，并按绝对播放时间直接改有界的场景视图。
   * shot 逐帧姿态、场景转场选择、画框、片尾模糊与主题图标纹理在相邻模块；这里只管生命周期、
   * 段落场景缓存、换歌溶解和每帧调度。
   *
   * 与 Folia 的实现差异：
   * 1. 本项目铁律禁止另起 rAF → pixi 用 autoStart:false + sharedTicker:false，
   *    由 foliaWorldTick 手动 renderer.render；暂停停画，但换歌溶解照走完
   *    （否则盖子冻在半路）。
   * 2. currentTime / audioPower / audioBands 是裸数值，不是 framer-motion 的 MotionValue。
   * 3. 无 AbortSignal，用 destroyed 标志代替。
   * 4. tuning 由 0l0 提供（面板 0l1 写在那里），创建时读一次、之后走 setTuning 热更；
   *    modulation 恒 {}（所有 mod = 1）。
   * 5. staticMode / transparentBackground 暂无来源，恒 false。
   * 6. MG 经 window.foliaSonnetMg 取用（0g-folia-sonnet-mg.js）。 */

  function SonnetPixiRuntime(pixi, options, app) {
    var self = this;
    this.pixi = pixi;
    this.options = options;
    this.app = app;
    this.sceneCache = new SonnetSceneCache({
      count: function () { return self.options.program.paragraphs.length; },
      build: function (index) {
        var scene = self.buildScene(self.liveSong(), self.iconTextures, index);
        self.sceneContainer.addChild(scene.container);
        return scene;
      },
      destroy: function (scene) { self.destroyScene(scene); }
    });
    this.iconTextures = new Map();
    this.iconUrls = new Set();
    this.activeParagraphIndex = -1;
    this.destroyed = false;
    /* 一次在飞的换歌。由墙钟驱动，不像这里其他转场：那些从绝对播放时间推导进度，
     * 于是 seek 之后依然稳定，可那个时钟属于 outgoing 那首歌，说明不了这次交接何时开始。 */
    this.songSwap = null;
    this.swapCover = null;
    this.resizeObserver = null;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.sceneContainer = null;
    this.creditsContainer = null;
    this.overlayContainer = null;
    this.outroBlur = null;
  }

  SonnetPixiRuntime.create = function (options) {
    var pixi = (typeof PIXI !== 'undefined') ? PIXI : null;
    if (!pixi) return Promise.reject(new Error('商籁需要 pixi.js（vendor/folia/pixi/pixi.min.js 未加载）'));
    /* measureText 决定排版，Folia 侧没有可重算的兜底 —— 所以 pretext 加载失败即 reject，
     * 由运行时退出世界并给出可见原因（不静默白屏）。全仓共用一个 Promise。 */
    return foliaLoadPretext().then(function (pretext) {
      sonnetPretext = pretext;
      var app = new pixi.Application();
      var width = Math.max(options.host.clientWidth, 320);
      var height = Math.max(options.host.clientHeight, 240);
      return app.init({
        width: width,
        height: height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: sonnetSnapResolution(width, height, options.tuning.textureResolution),
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true
      }).then(function () {
        var runtime = new SonnetPixiRuntime(pixi, options, app);
        runtime.sceneContainer = new pixi.Container();
        runtime.creditsContainer = new pixi.Container();
        runtime.overlayContainer = new pixi.Container();
        runtime.outroBlur = new SonnetOutroBlur(pixi);
        app.stage.addChild(runtime.sceneContainer, runtime.creditsContainer, runtime.overlayContainer);

        options.host.appendChild(app.canvas);
        app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        return runtime.preloadIcons().then(function () {
          runtime.install();
          return runtime;
        });
      });
    });
  };

  SonnetPixiRuntime.prototype.install = function () {
    this.resizeToHost();
    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(function () {
        if (self.destroyed || !self.resizeToHost()) return;
        if (self.options.paused) self.renderOnce();
      });
      this.resizeObserver.observe(this.options.host);
    }
    this.renderOnce();
  };

  SonnetPixiRuntime.prototype.resizeToHost = function () {
    if (this.destroyed) return false;
    var width = Math.max(this.options.host.clientWidth, 320);
    var height = Math.max(this.options.host.clientHeight, 240);
    if (width === this.lastWidth && height === this.lastHeight) return false;
    this.lastWidth = width;
    this.lastHeight = height;
    /* 纹理池的吸附取决于视口，所以一次 resize 能让合并后的滤镜目标跨过桶边界，
     * 即使设置从未变过。Sonnet 自己的 pass 带固定分辨率，所以只有画布需要跟随。 */
    this.app.renderer.resize(
      width,
      height,
      sonnetSnapResolution(width, height, this.options.tuning.textureResolution)
    );
    /* staged 是照旧视口摆的，它的布局不再合身。 */
    if (this.songSwap && this.songSwap.staged) {
      this.destroyScene(this.songSwap.staged.scene);
      this.songSwap.staged = null;
    }
    this.clearScenes();
    this.drawCredits(width, height);
    this.drawOverlay(width, height);
    return true;
  };

  SonnetPixiRuntime.prototype.drawCredits = function (width, height) {
    sonnetDestroyContainerChildren(this.creditsContainer);
    if (this.options.tuning.showOnlyText) return;
    var metadata = {
      title: this.options.songTitle,
      artist: this.options.songArtist,
      album: this.options.songAlbum
    };
    if (!sonnetHasCreditsMetadata(metadata)) return;
    this.creditsContainer.addChild(sonnetBuildCreditsPoster(
      this.pixi,
      this.options.theme,
      metadata,
      width,
      height,
      this.options.lyricsFontScale
    ));
    this.creditsContainer.pivot.set(width / 2, height / 2);
    this.creditsContainer.position.set(width / 2, height / 2);
    this.creditsContainer.visible = false;
  };

  SonnetPixiRuntime.prototype.setSongMetadata = function (metadata) {
    if (this.destroyed) return;
    var changed = this.options.songTitle !== metadata.title
      || this.options.songArtist !== metadata.artist
      || this.options.songAlbum !== metadata.album;
    if (!changed) return;

    this.options.songTitle = metadata.title;
    this.options.songArtist = metadata.artist;
    this.options.songAlbum = metadata.album;
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawCredits(this.lastWidth, this.lastHeight);
      if (this.options.paused) this.renderOnce();
    }
  };

  SonnetPixiRuntime.prototype.drawOverlay = function (width, height) {
    sonnetDrawFrameOverlay(this.pixi, this.overlayContainer, width, height, this.options.tuning, this.options.theme);
  };

  /* 主题图标纹理：按主题从共享纹理池引用计数地取用。
   * 与 live map 分开保管，好让一次换歌能在上一首歌还在演的时候预热新主题的图标，
   * 只在盖子遮住交接之后才正式 adopt。 */
  SonnetPixiRuntime.prototype.loadIconTextures = function (theme) {
    var loaded = { textures: new Map(), urls: new Set() };
    if (this.options.tuning.showOnlyText || !this.options.tuning.showBackgroundDecor) {
      return Promise.resolve(loaded);
    }
    var names = window.foliaSonnetMg.resolveIconNames(theme.lyricsIcons);
    var resolution = this.options.tuning.textureResolution;
    var texturePool = sonnetGetTexturePool(this.pixi);
    var jobs = names.map(function (name, index) {
      var size = 192 + (index % 4) * 32;
      var colors = [theme.accentColor, theme.secondaryColor, theme.primaryColor];
      var color = colors[index % colors.length];
      var key = window.foliaSonnetMg.buildIconTextureKey(name, color, 3.5, size, resolution);
      var url = window.foliaSonnetMg.buildIconDataUrl(name, color, 3.5, size);
      if (!url) return Promise.resolve();
      return texturePool.acquire(url).then(function (texture) {
        loaded.textures.set(key, texture);
        loaded.urls.add(url);
      }, function () {
        /* 无效的主题图标是可选项；几何 MG 仍然可用。 */
      });
    });
    return Promise.all(jobs).then(function () { return loaded; });
  };

  SonnetPixiRuntime.prototype.releaseIconUrls = function (urls) {
    var texturePool = sonnetGetTexturePool(this.pixi);
    urls.forEach(function (url) { texturePool.release(url); });
    urls.clear();
  };

  SonnetPixiRuntime.prototype.preloadIcons = function () {
    var self = this;
    return this.loadIconTextures(this.options.theme).then(function (loaded) {
      loaded.textures.forEach(function (texture, key) { self.iconTextures.set(key, texture); });
      loaded.urls.forEach(function (url) { self.iconUrls.add(url); });
    });
  };

  SonnetPixiRuntime.prototype.clearScenes = function () {
    this.outroBlur.clear();
    this.sceneCache.clear();
    this.activeParagraphIndex = -1;
  };

  SonnetPixiRuntime.prototype.destroyScene = function (scene) {
    if (this.outroBlur.isOn(scene)) this.outroBlur.clear();
    this.sceneContainer.removeChild(scene.container);
    sonnetUnloadDisplayTree(scene.container);
    scene.container.filters = null;
    scene.shots.forEach(function (shot) { shot.haloLayer.filters = null; });
    scene.postProcessFilters.forEach(function (filter) { filter.destroy(); });
    /* 逐节点销毁：destroy({ children: true }) 会留下每个 Graphics 自建的
     * GraphicsContext 与它的 GPU 缓冲。 */
    sonnetDestroyDisplayTree(scene.container);
  };

  SonnetPixiRuntime.prototype.buildScene = function (song, iconTextures, index) {
    return sonnetBuildScene(this.pixi, {
      programSeed: song.program.seed,
      host: this.options.host,
      theme: song.theme,
      tuning: this.options.tuning,
      lyricsFontScale: this.options.lyricsFontScale,
      staticMode: this.options.staticMode,
      transparentBackground: this.options.transparentBackground
    }, iconTextures, song.program.paragraphs[index]);
  };

  /* 当前在屏幕上的歌，作为一个上下文，用于照着它建场景。 */
  SonnetPixiRuntime.prototype.liveSong = function () {
    return {
      seed: this.options.songSeed,
      program: this.options.program,
      theme: this.options.theme
    };
  };

  SonnetPixiRuntime.prototype.renderFrame = function () {
    if (this.destroyed) return;
    /* 在段落查找之前推进，好让提交落在这一帧的场景选择上，
     * 而不是在新场景上留一帧旧节目。 */
    this.advanceSongSwap();
    if (this.options.program.paragraphs.length === 0) {
      return;
    }
    var time = this.options.time;
    var paragraphIndex = sonnetFindParagraphIndexAtTime(this.options.program, time);
    if (paragraphIndex !== this.activeParagraphIndex) {
      this.activeParagraphIndex = paragraphIndex;
      this.sceneCache.ensure(paragraphIndex);
      this.sceneCache.prune(paragraphIndex);
    } else if (!this.songSwap) {
      /* 邻段是给一个还没到的边界做的预滚，所以一帧最多建一个，
       * 而不是把三个一起堆到刚换段落的那一帧上。建一个场景要对每个字素跑一遍布局
       * 再给每个字素建一个 pixi.Text；一次三个就是掉一帧。 */
      var next = paragraphIndex + 1;
      var previous = paragraphIndex - 1;
      if (next < this.options.program.paragraphs.length && !this.sceneCache.has(next)) {
        this.sceneCache.ensure(next);
      } else if (previous >= 0 && !this.sceneCache.has(previous)) {
        this.sceneCache.ensure(previous);
      }
    }
    /* 渲染器最后一次贴合到的尺寸。在这里读 host 会每帧强制一次同步布局，
     * 而 ResizeObserver 反正会把两者一起重新贴合。 */
    var width = this.lastWidth;
    var height = this.lastHeight;
    var paragraphs = this.options.program.paragraphs;
    var finalParagraph = paragraphs[paragraphs.length - 1];
    var creditsFrame = sonnetResolveCreditsFrame(
      time,
      finalParagraph ? finalParagraph.endTime : Number.POSITIVE_INFINITY
    );
    var hasCredits = this.creditsContainer.children.length > 0;
    var self = this;
    var shotFrameContext = {
      tuning: this.options.tuning,
      theme: this.options.theme,
      audioBands: this.options.audioBands,
      audioPower: this.options.audioPower,
      mod: function (key) { return sonnetReadModulation(self.options.modulation, key); }
    };

    this.sceneCache.forEach(function (scene, index) {
      var isActive = index === paragraphIndex;

      /* 严格可见性：只有活动场景会被画。场景之间零重叠。 */
      scene.container.visible = isActive;
      if (!isActive) {
        var previousShot = scene.shots[scene.activeShotIndex];
        if (previousShot) sonnetUnloadDisplayTree(previousShot.container);
        scene.activeShotIndex = -1;
        return;
      }

      var transitionsEnabled = self.options.tuning.enableTransitions && !self.options.staticMode;
      var visibleShotIndex = sonnetFindActiveShotIndex(scene, time);
      var transitionFrame = sonnetResolveSceneTransitionFrame(
        self.options.program,
        scene,
        index,
        visibleShotIndex,
        time,
        transitionsEnabled
      );
      scene.shots.forEach(function (shot, shotIndex) {
        var isShotActive = shotIndex === visibleShotIndex;
        shot.container.visible = isShotActive;
        if (!isShotActive) return;
        sonnetUpdateShot(shot, time, width, height, 0, shotFrameContext);
      });
      if (scene.activeShotIndex !== visibleShotIndex) {
        var oldShot = scene.shots[scene.activeShotIndex];
        if (oldShot) sonnetUnloadDisplayTree(oldShot.container);
        scene.activeShotIndex = visibleShotIndex;
      }

      var isFinalScene = index === paragraphs.length - 1;
      var lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1;
      var transitionMotionScale = sonnetReadModulation(self.options.modulation, 'transitionMotionScale');
      var transitionBlurScale = sonnetReadModulation(self.options.modulation, 'transitionBlurScale');
      var transitionGlitchScale = sonnetReadModulation(self.options.modulation, 'transitionGlitchScale');
      scene.container.alpha = transitionFrame.alpha * lyricAlpha;
      scene.container.pivot.set(width / 2, height / 2);
      scene.container.position.set(
        width / 2 + transitionFrame.x * width * transitionMotionScale,
        height / 2 + transitionFrame.y * height * transitionMotionScale
      );
      scene.container.scale.set(1 + (transitionFrame.scale - 1) * transitionMotionScale);
      scene.container.rotation = transitionFrame.rotation * transitionMotionScale;
      if (scene.transitionBlurFilter) {
        scene.transitionBlurFilter.strength = transitionFrame.blur * transitionBlurScale;
        scene.transitionBlurFilter.enabled = transitionFrame.blur > 0.01;
      }
      if (scene.transitionGlitchEffect) {
        scene.transitionGlitchEffect.update(transitionFrame.glitch * transitionGlitchScale, transitionFrame.glitchSeed);
        scene.transitionGlitchEffect.filter.enabled = transitionFrame.glitch > 0.01;
      }

      if (isFinalScene && hasCredits) {
        self.outroBlur.update(scene, creditsFrame.lyricBlur);
      }
    });

    if (!creditsFrame.active || !hasCredits) this.outroBlur.clear();
    this.creditsContainer.visible = creditsFrame.active && hasCredits && !this.options.tuning.showOnlyText;
    this.creditsContainer.alpha = creditsFrame.posterAlpha;
    this.creditsContainer.position.set(
      width / 2,
      height / 2 + creditsFrame.posterOffsetY * height
    );
    this.creditsContainer.scale.set(creditsFrame.posterScale);
  };

  SonnetPixiRuntime.prototype.renderOnce = function () {
    if (this.destroyed || !this.app.canvas.isConnected) return;
    this.renderFrame();
    if (this.destroyed) return;
    this.app.renderer.render(this.app.stage);
  };

  /**
   * 把一首新歌交给渲染器而不重建它。一次重建会在画布离开 DOM 的情况下
   * 重新初始化 WebGL 与图标纹理池，于是整个异步构建期间那一帧是空的。
   * 这里在上一首歌还在演的时候预热新主题的图标，只有场景层会变 ——
   * 而且在盖子之下，所以这个切换永远不会是个洞。
   *
   * 在盖子淡出去之后 resolve。
   */
  SonnetPixiRuntime.prototype.swapSong = function (next) {
    var self = this;
    if (this.destroyed) return Promise.resolve();
    /* 屏幕上没有要保护的东西：还没有场景被定尺寸，或者 outgoing 节目一个段落都没有。
     * 遮一个空帧只会多一次闪。而一次不是换歌的交接根本不该有溶解 ——
     * 见 SonnetSongContext.seed。 */
    var isCoverWorthwhile = next.seed !== this.options.songSeed
      && !this.songSwap
      && this.lastWidth > 0
      && this.options.program.paragraphs.length > 0;

    /* 在盖子开始之前预热，好让溶解永远不用等一次解码。 */
    return this.loadIconTextures(next.theme).then(function (pendingIcons) {
      if (self.destroyed) {
        self.releaseIconUrls(pendingIcons.urls);
        return;
      }
      if (!isCoverWorthwhile) {
        self.commitSongContext(next, pendingIcons);
        return;
      }

      return new Promise(function (resolve) {
        self.songSwap = {
          pending: next,
          pendingIcons: pendingIcons,
          staged: null,
          startedAt: performance.now(),
          settle: resolve,
          detachAbort: function () { /* 本项目无 AbortSignal */ }
        };
        /* 暂停时 ticker 是停的，盖子会冻在半路。为溶解的这段时间跑起来，
         * 结束时把暂停还回去 —— 本项目由 foliaWorldTick 在 songSwap 非空时照常驱动。 */
      });
    });
  };

  /** 交接本身，在盖子不透明的那个瞬间。 */
  SonnetPixiRuntime.prototype.commitSongContext = function (next, icons, staged) {
    this.options.songSeed = next.seed;
    this.options.program = next.program;
    this.options.theme = next.theme;
    /* 先取后放：两个主题都想要的 url 全程保持一个活引用计数。 */
    this.releaseIconUrls(this.iconUrls);
    this.iconTextures.clear();
    var self = this;
    icons.textures.forEach(function (texture, key) { self.iconTextures.set(key, texture); });
    icons.urls.forEach(function (url) { self.iconUrls.add(url); });
    /* clearScenes 只走缓存，而 staged 场景是刻意还不在缓存里的，
     * 所以它能在它要替换的那首歌的拆除中活下来。 */
    this.clearScenes();
    if (staged) {
      staged.scene.container.visible = true;
      this.sceneCache.adopt(staged.index, staged.scene);
      /* 收下为活动段落，好让提交那一帧什么都不建。 */
      this.activeParagraphIndex = staged.index;
    }
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawCredits(this.lastWidth, this.lastHeight);
      this.drawOverlay(this.lastWidth, this.lastHeight);
    }
  };

  /** 立刻结束一次在飞的交接，提交它当时还攥着的东西。 */
  SonnetPixiRuntime.prototype.settleSongSwap = function () {
    var swap = this.songSwap;
    if (!swap) return;
    this.songSwap = null;
    swap.detachAbort();
    if (this.destroyed) {
      if (swap.pendingIcons) this.releaseIconUrls(swap.pendingIcons.urls);
      /* 从未被 adopt，所以不会有别的东西来释放它。 */
      if (swap.staged) this.destroyScene(swap.staged.scene);
    } else {
      if (swap.pending && swap.pendingIcons) {
        this.commitSongContext(swap.pending, swap.pendingIcons, swap.staged);
      } else if (swap.staged) {
        this.destroyScene(swap.staged.scene);
      }
    }
    this.disposeSwapCover();
    swap.settle();
  };

  SonnetPixiRuntime.prototype.disposeSwapCover = function () {
    if (!this.swapCover) return;
    this.app.stage.removeChild(this.swapCover);
    this.swapCover.destroy();
    this.swapCover = null;
  };

  /**
   * 把墙钟驱动的溶解推进一帧。盖子是一个铺满全屏的普通矩形，
   * 加在每个容器之上 —— 不是滤镜 —— 所以它不会与逐场景的模糊和故障滤镜互相作用，
   * 而且交接过程中画面在任何时刻都不会透明。
   */
  SonnetPixiRuntime.prototype.advanceSongSwap = function () {
    var swap = this.songSwap;
    if (!swap) return;
    var progress = (performance.now() - swap.startedAt) / SONNET_SONG_SWAP_MS;
    if (swap.pending && swap.pendingIcons && !swap.staged && progress >= SONNET_SWAP_STAGE_PROGRESS) {
      /* 在这里建，而不是在提交时建：这是一个场景分量的布局与字素栅格化，
       * 它消耗的那一帧花在盖子已经大半落下的时候，而不是花在听者正看着新歌的那一帧。 */
      var index = sonnetFindParagraphIndexAtTime(
        swap.pending.program,
        this.options.time
      );
      if (index >= 0 && index < swap.pending.program.paragraphs.length) {
        var scene = this.buildScene(swap.pending, swap.pendingIcons.textures, index);
        scene.container.visible = false;
        this.sceneContainer.addChild(scene.container);
        swap.staged = { scene: scene, index: index };
      }
    }
    if (swap.pending && swap.pendingIcons && progress >= 0.5) {
      this.commitSongContext(swap.pending, swap.pendingIcons, swap.staged);
      swap.pending = null;
      swap.pendingIcons = null;
      swap.staged = null;
    }
    if (progress >= 1) {
      this.settleSongSwap();
      return;
    }

    if (!this.swapCover) {
      this.swapCover = new this.pixi.Graphics();
      /* 最后加，好让它压在场景、字幕与画框容器之上。 */
      this.app.stage.addChild(this.swapCover);
    }
    var cover = this.swapCover;
    /* 整个溶解中 0 -> 1 -> 0，恰在提交落点处不透明。 */
    cover.alpha = 1 - Math.abs(progress * 2 - 1);
    cover.clear();
    cover
      .rect(0, 0, this.lastWidth, this.lastHeight)
      .fill({ color: this.pixi.Color.shared.setValue(this.options.theme.backgroundColor).toNumber() });
  };

  /**
   * 把一次设置变更应用到活的运行时。每个场景都照着新 tuning 重建，
   * 但 WebGL 上下文、画布与图标纹理留着；塑造它们的那些设置
   * （textureResolution、showOnlyText、showBackgroundDecor）属于宿主的重建键。
   */
  SonnetPixiRuntime.prototype.setTuning = function (tuning) {
    if (this.destroyed || this.options.tuning === tuning) return;
    this.options.tuning = tuning;
    /* staged 是照旧 tuning 摆的，它再也无法被 adopt。 */
    if (this.songSwap && this.songSwap.staged) {
      this.destroyScene(this.songSwap.staged.scene);
      this.songSwap.staged = null;
    }
    this.clearScenes();
    /* 在第一次 resize 之前没有已定尺寸的东西可重画；install 那一遍
     * 会照着真实尺寸把两者都画出来。 */
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawCredits(this.lastWidth, this.lastHeight);
      this.drawOverlay(this.lastWidth, this.lastHeight);
    }
    if (this.options.paused) this.renderOnce();
  };

  SonnetPixiRuntime.prototype.setModulation = function (modulation) {
    if (this.destroyed) return;
    this.options.modulation = modulation;
    if (this.options.paused) this.renderOnce();
  };

  SonnetPixiRuntime.prototype.setPaused = function (paused) {
    if (this.destroyed) return;
    this.options.paused = paused;
    if (paused) {
      this.renderOnce();
    }
  };

  SonnetPixiRuntime.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    /* 在把 app 拆掉之前释放正在等交接的人，否则那个 promise 永不 settle，
    * 调用方的排空循环会一直卡在它上面。 */
    this.settleSongSwap();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.clearScenes();
    sonnetDestroyContainerChildren(this.creditsContainer);
    this.iconTextures.clear();
    this.releaseIconUrls(this.iconUrls);
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  };

  /* ============================== 30. 注册 ============================== */

  /* 模式实例：换歌闸门状态 + 运行时 + 等待播放占位。 */
  function sonnetCreateInstance(host, ctx) {
    return {
      host: host,
      runtime: null,
      gate: null,
      program: null,
      committedSeed: null,
      committedLines: null,
      lyricsSig: '',
      isInstrumental: false,
      themeKey: '',
      /* 建实例时的调参快照：tick 里比对对象身份，变了就热更（见 sonnetApplyTuning）。 */
      tuning: sonnetTuning(),
      swapInFlight: false,
      watch: null,
      waiting: null,
      subtitle: null,
      destroyed: false
    };
  }

  function sonnetThemeKey(theme) {
    return [
      theme.primaryColor, theme.secondaryColor, theme.accentColor, theme.backgroundColor,
      theme.fontStack, theme.translationFontStack, theme.weight, theme.fontStyle,
      theme.animationIntensity
    ].join('|');
  }

  /* 当前已提交歌的上下文（seed + program + theme），供换歌用。 */
  function sonnetSongContext(inst) {
    return {
      seed: inst.committedSeed,
      program: inst.program,
      theme: inst.theme
    };
  }

  function sonnetApplyCommitted(inst) {
    var programLines = inst.committedLines && inst.committedLines.length > 0
      ? inst.committedLines
      : (inst.isInstrumental ? sonnetBuildVirtualLines() : []);
    inst.program = sonnetCompileProgram(programLines, inst.committedSeed);
  }

  /* 调试读数（与镜台/monet 同一约定）：冒烟与控制台用同一套 tick 产物判据，
   * 不另算一遍，避免「断言自证」。无副作用、无写操作。 */
  function sonnetDebugState(inst) {
    var rt = inst.runtime;
    if (!rt) return { ready: false };
    var program = rt.options.program;
    var active = rt.sceneCache.get(rt.activeParagraphIndex);
    var shots = [];
    if (active) {
      for (var i = 0; i < active.shots.length; i++) {
        var sh = active.shots[i];
        shots.push({
          kind: sh.shot.kind,
          id: sh.shot.id,
          startTime: sh.shot.startTime,
          endTime: sh.shot.endTime,
          visible: sh.container.visible,
          segments: sh.segments.length,
          glyphs: sh.segments.reduce(function (a, s) { return a + s.glyphs.length; }, 0),
          alpha: sh.container.alpha,
          scale: sh.container.scale.x,
          x: sh.container.x,
          y: sh.container.y
        });
      }
    }
    return {
      ready: true,
      destroyed: rt.destroyed,
      seed: rt.options.songSeed,
      paragraphs: program.paragraphs.length,
      paragraphKinds: program.paragraphs.map(function (p) { return p.kind; }),
      shotKinds: program.paragraphs.map(function (p) {
        return p.shots.map(function (s) { return s.kind; });
      }),
      committedSeed: inst.committedSeed,
      committedLines: inst.committedLines ? inst.committedLines.length : -1,
      isInstrumental: inst.isInstrumental,
      activeParagraphIndex: rt.activeParagraphIndex,
      sceneCount: rt.sceneCache.size,
      cachedIndices: (function () {
        var out = [];
        rt.sceneCache.forEach(function (scene, index) { out.push(index); });
        return out.sort(function (a, b) { return a - b; });
      })(),
      icons: rt.iconTextures.size,
      iconUrls: rt.iconUrls.size,
      swapActive: !!rt.songSwap,
      swapInFlight: inst.swapInFlight,
      paused: !!rt.options.paused,
      width: rt.lastWidth,
      height: rt.lastHeight,
      resolution: rt.app.renderer.resolution,
      canvasCount: inst.host.querySelectorAll('canvas').length,
      creditsChildren: rt.creditsContainer.children.length,
      creditsVisible: rt.creditsContainer.visible,
      overlayChildren: rt.overlayContainer.children.length,
      sceneContainerChildren: rt.sceneContainer.children.length,
      sceneFilters: active ? (active.container.filters ? active.container.filters.length : 0) : 0,
      transitionHasBlur: !!(active && active.transitionBlurFilter),
      transitionHasGlitch: !!(active && active.transitionGlitchEffect),
      sceneAlpha: active ? active.container.alpha : -1,
      activeShots: shots,
      waitingDisplay: inst.waiting ? inst.waiting.style.display : '',
      rendererType: rt.app.renderer.type
    };
  }

  /* 调参变化：热更到活的运行时（Folia VisualizerSonnet.tsx:185 的 setTuning effect）。
   * 纹素分辨率是**渲染器级别**的量，setTuning 管不着，跟着重设一次 renderer ——
   * Folia 把它列进重建键（整组件重挂），这里用一次 renderer.resize + clearScenes 等价收口。 */
  function sonnetApplyTuning(inst) {
    var runtime = inst.runtime;
    if (!runtime || runtime.destroyed) return;
    var next = inst.tuning;
    var prevRes = runtime.options.tuning ? runtime.options.tuning.textureResolution : next.textureResolution;
    runtime.setTuning(next);
    if (prevRes !== next.textureResolution && runtime.lastWidth > 0 && runtime.lastHeight > 0) {
      runtime.app.renderer.resize(
        runtime.lastWidth,
        runtime.lastHeight,
        sonnetSnapResolution(runtime.lastWidth, runtime.lastHeight, next.textureResolution)
      );
      /* 纹理池的尺寸变了，旧场景的贴图不再合身。 */
      runtime.clearScenes();
    }
  }

  /* 把新歌交给运行时；主题变化（同 seed）走同一条路但不溶解。 */
  function sonnetHandOver(inst) {
    if (inst.swapInFlight || !inst.runtime) return;
    inst.swapInFlight = true;
    inst.runtime.swapSong(sonnetSongContext(inst)).then(function () {
      inst.swapInFlight = false;
    }, function () {
      inst.swapInFlight = false;
    });
  }

  function sonnetCreate(host, ctx) {
    var theme = ctx.theme || {};
    var inst = sonnetCreateInstance(host, ctx);
    var seed = ctx.seed == null ? '' : String(ctx.seed);

    /* 等待播放占位（首行之前） */
    var waiting = document.createElement('div');
    waiting.className = 'folia-sonnet-waiting';
    waiting.textContent = '等待播放';
    waiting.style.display = 'none';
    host.appendChild(waiting);
    inst.waiting = waiting;

    /* 副标题层（译文 / 下一句预览）——pixi 场景不复制它 */
    try {
      if (typeof foliaCreateSubtitleOverlay === 'function') {
        inst.subtitle = foliaCreateSubtitleOverlay(
          host, theme, typeof foliaResolveSubtitleFontSizes === 'function'
            ? foliaResolveSubtitleFontSizes(ctx.fontScale || 1) : undefined
        );
      }
    } catch (_) {}

    /* 闸门初值 = 建 instance 当时的 seed/lines
     * （Folia: useState(() => ({ seed, lines })）），所以 committedLines 永不为 null。 */
    inst.committedSeed = seed;
    inst.committedLines = (ctx.lines || []).slice();
    inst.lyricsSig = sonnetLyricsSignature(ctx.lines);
    inst.isInstrumental = false;
    inst.theme = theme;
    inst.themeKey = sonnetThemeKey(theme);
    inst.gate = {
      committedSeed: seed,
      committedLines: inst.committedLines,
      committedSignature: inst.lyricsSig,
      isCommittedInstrumental: false
    };
    sonnetApplyCommitted(inst);

    return SonnetPixiRuntime.create({
      host: host,
      songSeed: seed,
      program: inst.program,
      theme: theme,
      tuning: sonnetTuning(),
      time: Number(ctx.time) || 0,
      audioPower: ctx.audio && typeof ctx.audio.power === 'number' ? ctx.audio.power : 0,
      audioBands: ctx.audioBands || {},
      lyricsFontScale: (ctx.fontScale === undefined || ctx.fontScale === null) ? 1 : ctx.fontScale,
      staticMode: false,
      transparentBackground: false,
      paused: !!ctx.paused,
      songTitle: ctx.song ? ctx.song.title : '',
      songArtist: ctx.song ? ctx.song.artist : '',
      songAlbum: ctx.song ? ctx.song.album : '',
      modulation: {}
    }).then(function (runtime) {
      inst.runtime = runtime;
      inst.waiting.style.display = inst.program.paragraphs.length === 0 ? 'flex' : 'none';
      inst.debug = function () { return sonnetDebugState(inst); };
      return inst;
    }, function (err) {
      if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
      throw err;
    });
  }

  function sonnetTick(inst, ctx) {
    if (inst.destroyed || !inst.runtime) return;
    var time = Number(ctx.time) || 0;
    var seed = ctx.seed == null ? '' : String(ctx.seed);
    var lines = ctx.lines || [];
    var lyricsSig = sonnetLyricsSignature(lines);
    var gate = inst.gate;

    /* ---- 就绪闸门（逐字对应 Folia 的 committedSong effect） ---- */
    var decision = sonnetDecideSongCommit({
      seed: seed,
      committedSeed: gate.committedSeed,
      lyricsSignature: lyricsSig,
      committedSignature: gate.committedSignature,
      isCommittedInstrumental: gate.isCommittedInstrumental
    });

    if (decision.action === 'commit') {
      gate.committedSeed = seed;
      gate.committedLines = lines.slice();
      gate.committedSignature = lyricsSig;
      gate.isCommittedInstrumental = decision.isInstrumental;
      inst.committedSeed = seed;
      inst.committedLines = gate.committedLines;
      inst.lyricsSig = lyricsSig;
      inst.isInstrumental = decision.isInstrumental;
      sonnetApplyCommitted(inst);
      sonnetHandOver(inst);
    } else if (decision.action === 'watch') {
      if (!inst.watch || inst.watch.seed !== seed) {
        inst.watch = { seed: seed, startedAt: performance.now(), sawPlaybackReset: false };
      }
      if (!inst.watch.sawPlaybackReset && time < 1) inst.watch.sawPlaybackReset = true;
      var settled = sonnetIsInstrumentalConfirmed(
        {
          sawPlaybackReset: inst.watch.sawPlaybackReset,
          playbackTime: time,
          elapsedMs: performance.now() - inst.watch.startedAt
        },
        {
          instrumentalCommitSeconds: SONNET_INSTRUMENTAL_COMMIT_SECONDS,
          readyGraceMs: SONNET_READY_GRACE_MS
        }
      );
      if (settled) {
        inst.watch = null;
        gate.committedSeed = seed;
        gate.committedLines = [];
        gate.committedSignature = '';
        gate.isCommittedInstrumental = true;
        inst.committedSeed = seed;
        inst.committedLines = [];
        inst.lyricsSig = '';
        inst.isInstrumental = true;
        sonnetApplyCommitted(inst);
        sonnetHandOver(inst);
      }
    } else {
      inst.watch = null;
    }

    /* 主题变化：同 seed，静默重建场景（不走溶解）。 */
    var nextThemeKey = sonnetThemeKey(ctx.theme || {});
    if (nextThemeKey !== inst.themeKey) {
      inst.themeKey = nextThemeKey;
      inst.theme = ctx.theme || {};
      if (!inst.swapInFlight) sonnetHandOver(inst);
    }

    /* 调参变化：同 seed，热更到活运行时（不重挂场景，分辨率变了顺带重设 renderer）。 */
    var nextTuning = sonnetTuning();
    if (nextTuning !== inst.tuning) {
      inst.tuning = nextTuning;
      sonnetApplyTuning(inst);
    }

    /* 运行时按当前 ctx 刷新每帧输入。 */
    inst.runtime.options.time = time;
    inst.runtime.options.audioPower = ctx.audio && typeof ctx.audio.power === 'number' ? ctx.audio.power : 0;
    inst.runtime.options.audioBands = ctx.audioBands || {};
    inst.runtime.options.paused = !!ctx.paused;
    inst.runtime.options.lyricsFontScale = (ctx.fontScale === undefined || ctx.fontScale === null)
      ? 1 : ctx.fontScale;
    var meta = ctx.song || {};
    inst.runtime.setSongMetadata({ title: meta.title, artist: meta.artist, album: meta.album });

    /* 暂停时停画；但换歌溶解照走完，否则盖子冻在半路。 */
    if (ctx.paused && !inst.runtime.songSwap) return;

    if (inst.waiting) {
      var showWaiting = inst.runtime.options.program.paragraphs.length === 0;
      inst.waiting.style.display = showWaiting ? 'flex' : 'none';
    }

    inst.runtime.renderFrame();
    inst.runtime.app.renderer.render(inst.runtime.app.stage);
  }

  function sonnetDestroy(inst) {
    if (inst.destroyed) return;
    inst.destroyed = true;
    if (inst.runtime) {
      try { inst.runtime.destroy(); } catch (_) {}
      inst.runtime = null;
    }
    if (inst.subtitle && typeof inst.subtitle.destroy === 'function') {
      try { inst.subtitle.destroy(); } catch (_) {}
    }
    if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
    if (inst.host && inst.host.parentNode) inst.host.parentNode.removeChild(inst.host);
  }

  registerFoliaMode('sonnet', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerSonnet = 商籁，order 10，
     * pickerDescription.visualizer.sonnet =
     * 短线、边框与镂空巨字轮番铺开，歌词像被排进一页页翻动的诗稿。 */
    name: '商籁',
    desc: '短线、边框与镂空巨字轮番铺开，歌词像被排进一页页翻动的诗稿',
    order: 10,
    create: sonnetCreate,
    tick: sonnetTick,
    destroy: sonnetDestroy
  });
})();
