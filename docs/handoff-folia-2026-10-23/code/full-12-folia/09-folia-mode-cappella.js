/* Folia 世界 — 歌词样式：群唱（cappella）
 *
 * 移植自 Folia src/components/visualizer/cappella/（VisualizerCappella 238 +
 * CappellaMessageRow 352 + CappellaBubbleParts 185 + cappellaMessages 228 +
 * cappellaReveal 197 + cappellaMessageLayout 181 + cappellaBubbleMetrics 145 +
 * cappellaIntensity 134 + cappellaMessageSenders 74 + avatarImages 102 + emoImages 48）。
 *
 * 画面是一段「聊天记录」：歌名是第一条右侧气泡，之后每句歌词按确定性规则分到左右两侧、
 * 轮流换头像；间奏（歌词本身是 "......"）会变成一张表情图；唱到的那条气泡放大、逐字浮现、
 * 带扫光；唱过的缩小变淡；时间戳在最后一个字淡入完成后才出现。
 *
 * 必须照抄的判据（改了就整条流水不对）：
 *   - 发送者编排全用 FNV-1a 哈希做种子（seededUnit），同一首歌每次跑出来一模一样；
 *     短句（≤12 字）有概率沿用上一条的发送者，每 forceRightEveryLines 句强制回右侧并重置游标
 *   - 气泡尺寸按「显示前 n 个字素」逐个前缀实测（pretext），文字出现与气泡变宽共用同一张表，
 *     只是气泡用提前 0.2s 的时间轴，让横向扩展先于字符出现，避免临界换行时字符掉到下一行
 *   - 可见消息按视口高度从最新一条往回累加（至少留 2 条上下文、最多 20 条），不滚动
 *   - 头像 40px 圆形；右侧气泡底色 = accent 混 primary 18% / alpha .94，文字用背景色；
 *     左侧按 avatarIndex 在 secondary→accent 上取 0.18~0.80 的混色
 *   - 气泡圆角 24px，靠头像那一角收成 6px；放大用 spring(340/28/0.72)，尺寸动画 0.2s easeOut
 *
 * 与 Folia 的实现差异（都不改画面）：
 *   1) React + framer 换成命令式 DOM：消息按 id 复用行节点，进出用 CSS 动画/过渡；
 *      列表重排用 FLIP 补偿位移（framer 的 layout="position"），退出行走绝对定位（popLayout）。
 *   2) 逐字淡入沿用 Folia 自己的 inline animationName/Duration（每个字一个 span，时长来自词时序）。
 *   3) avatarSource 取 Folia 默认的 'cover'（专辑封面当 3×3 头像精灵裁剪）；没封面时回落内置头像，
 *      内置头像与表情包已原样 vendor 到 public/vendor/folia/cappella/。调参面板未接，先写死默认值。
 *
 * 依赖：@chenglou/pretext（只有 ESM）→ create 返回 Promise，等 import 完再建 DOM。
 */
'use strict';

(function registerFoliaCappellaMode() {
  if (typeof registerFoliaMode !== 'function') return;

  /* Folia types.ts:482 DEFAULT_CAPPELLA_TUNING —— 面板（0l1）与归一化（0l0）用的同一份基准。 */
  var CAPPELLA_TUNING_DEFAULT = {
    showEmoMessages: true,
    emojiPackSource: 'builtin',
    avatarSource: 'cover'
  };

  /* 当前生效的调参：面板写在 0l0（共用存档），这里只读；0l0 没加载时回落默认值。 */
  function cappellaTuning() {
    return (typeof foliaModeTuning === 'function')
      ? foliaModeTuning('cappella')
      : CAPPELLA_TUNING_DEFAULT;
  }

  var SHORT_LINE_CHAR_LIMIT = 12;
  var MAX_VISIBLE_MESSAGES = 20;
  var AVATAR_GRID_SIZE = 3;
  var LEFT_AVATAR_INDICES = [0, 3, 6, 1, 4];
  var RIGHT_AVATAR_INDEX = 8;
  /* Folia CAPPELLA_PREHEAT_WINDOW：下一行开场前 0.18~1.1s 预量气泡，避免开唱那一帧卡住。 */
  var PREHEAT_MIN_LEAD = 0.18;
  var PREHEAT_MAX_LEAD = 1.1;
  var LAYOUT_CACHE_LIMIT = 32;
  var MEASURE_CACHE_LIMIT = 480;
  /* 气泡宽度动画约 0.2s。尺寸用提前后的时间轴，让横向扩展先于字符出现启动。 */
  var WIDTH_LOOKAHEAD_SECONDS = 0.2;
  var BUBBLE_TEXT_OPTIONS = { whiteSpace: 'pre-wrap' };
  var BUBBLE_FONT_WEIGHT = 400;
  var BUBBLE_BORDER_WIDTH = 1;
  var BUBBLE_LINE_HEIGHT = 1.45;
  var INTERLUDE_TEXT = '......';
  var DEFAULT_CHAR_FADE_MS = 220;
  var MIN_CHAR_FADE_MS = 40;
  var TS_FADE_SECONDS = 0.18;
  var FLIP_EASE = 'cubic-bezier(.22, 1, .36, 1)';

  /* ------------------------------------------------------------------ *
   * 资源（Folia 用 import.meta.glob 收集，这里写死同名清单）
   * ------------------------------------------------------------------ */

  /* 顺序必须与 Vite glob 的字典序一致（avatar10 < avatar2），头像按 seed 取下标。 */
  var CAPPELLA_AVATAR_NAMES = [
    'avatar10', 'avatar11', 'avatar12', 'avatar13', 'avatar14',
    'avatar15', 'avatar16', 'avatar17', 'avatar2', 'avatar3',
    'avatar4', 'avatar5', 'avatar6', 'avatar8', 'avatar9'
  ];
  var CAPPELLA_EMO_NAMES = [
    'happy1', 'love1', 'normal1', 'sleepy1', 'sleepy2', 'sleepy3',
    'vibe1', 'vibe2', 'vibe3'
  ];

  function cappellaAssetUrl(dir, name) {
    var rel = 'vendor/folia/cappella/' + dir + '/' + name + '.png';
    try {
      return new URL(rel, document.baseURI).href;
    } catch (_) {
      return rel;
    }
  }

  var cappellaAvatarImages = [];
  var cappellaEmoImages = [];
  (function buildAssetLists() {
    var i;
    for (i = 0; i < CAPPELLA_AVATAR_NAMES.length; i++) {
      var an = CAPPELLA_AVATAR_NAMES[i];
      cappellaAvatarImages.push({ id: 'builtin-avatar-' + an, name: an, url: cappellaAssetUrl('avatar', an) });
    }
    for (i = 0; i < CAPPELLA_EMO_NAMES.length; i++) {
      var en = CAPPELLA_EMO_NAMES[i];
      cappellaEmoImages.push({ id: 'builtin-' + en, name: en, url: cappellaAssetUrl('emo', en) });
    }
  })();

  /* ------------------------------------------------------------------ *
   * 确定性哈希 / 头像与表情挑选
   * ------------------------------------------------------------------ */

  function cappellaHashString(input) {
    var hash = 2166136261;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function cappellaSeededUnit() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(arguments[i]);
    return cappellaHashString(parts.join('|')) / 0xffffffff;
  }

  function cappellaPickStableEmoImage(pool, seedParts) {
    if (!pool || pool.length === 0) return null;
    var index = Math.floor(cappellaSeededUnit.apply(null, seedParts) * pool.length) % pool.length;
    return pool[index] || pool[0] || null;
  }

  function cappellaSeededIndex(seed, side, length) {
    return cappellaHashString(seed + '|' + side + '|' + length) % length;
  }

  /* Folia resolveCappellaAvatarUrl：cover 直接用封面；builtin/custom 按 seed 在池里取；
   * color 返回 null（走渐变底）。右侧头像单独定一个，左侧从剩下的里按 avatarIndex 轮换。 */
  function cappellaResolveAvatarUrl(opts) {
    var source = opts.source;
    if (source === 'color') return null;
    if (source === 'cover' && opts.coverUrl) return opts.coverUrl;
    var pool = opts.pool || cappellaAvatarImages;
    if (!pool.length) return null;
    var rightIndex = cappellaSeededIndex(opts.seed, 'right', pool.length);
    if (opts.side === 'right') return pool[rightIndex] ? pool[rightIndex].url : null;
    var leftPool = [];
    for (var i = 0; i < pool.length; i++) if (i !== rightIndex) leftPool.push(pool[i]);
    if (!leftPool.length) return pool[rightIndex] ? pool[rightIndex].url : null;
    var leftOffset = cappellaSeededIndex(opts.seed, 'left', leftPool.length);
    var idx = Math.abs(Math.trunc(opts.avatarIndex + leftOffset)) % leftPool.length;
    return leftPool[idx] ? leftPool[idx].url : null;
  }

  /* ------------------------------------------------------------------ *
   * 动效强度（cappellaIntensity.ts）：calm / normal / chaotic 三档全量照搬
   * ------------------------------------------------------------------ */

  function cappellaIntensityConfig(animationIntensity) {
    if (animationIntensity === 'calm') {
      return {
        sequencing: {
          forceRightEveryLines: 7,
          shortLineCarryChance: 0.92,
          sideSequence: ['left', 'left', 'right', 'left', 'right'],
          sideFlipChance: 0.08,
          randomEmoChance: 0,
          minLinesBetweenRandomEmos: 6,
          maxRandomEmoRatio: 0
        },
        motion: {
          rowEnterY: 14, rowEnterScale: 0.992, rowEnterDuration: 0.28,
          rowExitY: -10, rowExitScale: 0.985, rowExitDuration: 0.22,
          avatarSpring: { stiffness: 280, damping: 30, mass: 0.78 },
          activeScale: 1.07, passedScale: 0.96, passedOpacity: 0.88,
          activeFontMultiplier: 1.22, inactiveFontMultiplier: 0.96,
          activePaddingX: 18, activePaddingY: 14,
          inactivePaddingX: 16, inactivePaddingY: 12,
          activeMinHeight: 58, inactiveMinHeight: 44,
          glowOpacity: 0.26, glowDuration: 2.2,
          glowRightAlpha: 0.26, glowLeftAlpha: 0.14,
          activeShadowAlpha: 0.24,
          emoActiveSize: 132, emoInactiveSize: 96,
          emoEnterScale: 0.74, emoSizeTransitionDuration: 0.22
        }
      };
    }

    if (animationIntensity === 'chaotic') {
      return {
        sequencing: {
          forceRightEveryLines: 3,
          shortLineCarryChance: 0.36,
          sideSequence: ['left', 'right', 'right', 'left', 'right', 'left'],
          sideFlipChance: 0.42,
          randomEmoChance: 0.22,
          minLinesBetweenRandomEmos: 2,
          maxRandomEmoRatio: 1 / 6
        },
        motion: {
          rowEnterY: 30, rowEnterScale: 0.968, rowEnterDuration: 0.38,
          rowExitY: -26, rowExitScale: 0.94, rowExitDuration: 0.28,
          avatarSpring: { stiffness: 360, damping: 24, mass: 0.68 },
          activeScale: 1.18, passedScale: 0.88, passedOpacity: 0.76,
          activeFontMultiplier: 1.4, inactiveFontMultiplier: 0.92,
          activePaddingX: 22, activePaddingY: 17,
          inactivePaddingX: 15, inactivePaddingY: 11,
          activeMinHeight: 68, inactiveMinHeight: 42,
          glowOpacity: 0.52, glowDuration: 1.35,
          glowRightAlpha: 0.42, glowLeftAlpha: 0.24,
          activeShadowAlpha: 0.42,
          emoActiveSize: 178, emoInactiveSize: 122,
          emoEnterScale: 0.54, emoSizeTransitionDuration: 0.28
        }
      };
    }

    return {
      sequencing: {
        forceRightEveryLines: 5,
        shortLineCarryChance: 0.68,
        sideSequence: ['left', 'right', 'left', 'right', 'right'],
        sideFlipChance: 0.18,
        randomEmoChance: 0.1,
        minLinesBetweenRandomEmos: 3,
        maxRandomEmoRatio: 1 / 8
      },
      motion: {
        rowEnterY: 22, rowEnterScale: 0.98, rowEnterDuration: 0.32,
        rowExitY: -18, rowExitScale: 0.965, rowExitDuration: 0.24,
        avatarSpring: { stiffness: 340, damping: 28, mass: 0.72 },
        activeScale: 1.12, passedScale: 0.92, passedOpacity: 0.82,
        activeFontMultiplier: 1.34, inactiveFontMultiplier: 0.94,
        activePaddingX: 20, activePaddingY: 16,
        inactivePaddingX: 16, inactivePaddingY: 12,
        activeMinHeight: 64, inactiveMinHeight: 44,
        glowOpacity: 0.4, glowDuration: 1.8,
        glowRightAlpha: 0.34, glowLeftAlpha: 0.18,
        activeShadowAlpha: 0.34,
        emoActiveSize: 160, emoInactiveSize: 110,
        emoEnterScale: 0.6, emoSizeTransitionDuration: 0.25
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 消息编排（cappellaMessages.ts + cappellaMessageSenders.ts）
   * ------------------------------------------------------------------ */

  function cappellaCountCompactChars(text) {
    return foliaSplitGraphemes(String(text || '').replace(/\s/g, '')).length;
  }

  /* 带 agentId 的歌词（TTML 对唱）按「首个 agent 站右侧、其余按序站左侧」固定下来。
   * 本项目的歌词没有 agentId，这里恒返回 null，保留逻辑以便将来接 TTML。 */
  function cappellaCreateAgentSenderResolver(lines, opts) {
    var ids = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i] && lines[i].agentId;
      var id = raw == null ? '' : String(raw).trim();
      if (!id || seen[id]) continue;
      seen[id] = true;
      ids.push(id);
    }
    if (ids.length < 2) return null;
    var rightAgentId = ids[0];
    var leftCount = Math.max(1, opts.leftAvatarCount);
    var map = new Map();
    for (var k = 0; k < ids.length; k++) {
      map.set(ids[k], ids[k] === rightAgentId
        ? { side: 'right', avatarIndex: opts.rightAvatarIndex }
        : { side: 'left', avatarIndex: (k - 1) % leftCount });
    }
    return {
      resolve: function (line) {
        var raw = line && line.agentId;
        var id = raw == null ? '' : String(raw).trim();
        return id ? (map.get(id) || null) : null;
      }
    };
  }

  function cappellaEffectiveRenderEndTime(line, nextLine) {
    var end = foliaGetLineRenderEndTime(line);
    var nextStart = nextLine ? nextLine.startTime : Number.POSITIVE_INFINITY;
    return Math.min(end, nextStart);
  }

  /* 把歌词行编排成确定性的聊天消息流。返回数组顺序 = 上屏顺序 = 时间顺序。 */
  function cappellaBuildMessages(lines, titleText, config, tuning, emoPool) {
    var seq = config.sequencing;
    var messages = [{
      id: 'title',
      kind: 'title',
      text: titleText,
      side: 'right',
      avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1
    }];

    var showEmo = !!tuning.showEmoMessages && emoPool.length > 0;

    if (!lines.length) {
      var fallbackEmo = showEmo
        ? cappellaPickStableEmoImage(emoPool, ['no-lyrics', titleText, seq.forceRightEveryLines])
        : null;
      if (fallbackEmo) {
        messages.push({
          id: 'emo-no-lyrics',
          kind: 'emo',
          line: { words: [], startTime: 0, endTime: 0, fullText: INTERLUDE_TEXT },
          lineIndex: 0,
          side: 'right',
          avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1,
          emoImageUrl: fallbackEmo.url,
          activationStartTime: 0,
          activationEndTime: 999999
        });
      }
      return messages;
    }

    var sideCursor = 0;
    var leftAvatarCursor = 0;
    var lastLyricSender = null;
    var linesSinceRandomEmo = Number.POSITIVE_INFINITY;
    var randomEmoCount = 0;
    var randomEmoCap = Math.floor(lines.length * seq.maxRandomEmoRatio);
    var agentResolver = cappellaCreateAgentSenderResolver(lines, {
      rightAvatarIndex: RIGHT_AVATAR_INDEX,
      leftAvatarCount: LEFT_AVATAR_INDICES.length
    });

    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      var line = lines[lineIndex];
      var nextLine = lines[lineIndex + 1];
      var isShortLine = cappellaCountCompactChars(line.fullText) <= SHORT_LINE_CHAR_LIMIT;
      var agentSender = agentResolver ? agentResolver.resolve(line) : null;
      var forceRight = !agentSender && (lineIndex + 1) % seq.forceRightEveryLines === 0;
      var carrySender = !!(!agentSender
        && isShortLine
        && lastLyricSender
        && cappellaSeededUnit('carry', line.startTime, lineIndex) <= seq.shortLineCarryChance);
      var baseSide = seq.sideSequence[sideCursor % seq.sideSequence.length];
      var flipSide = !forceRight && cappellaSeededUnit('flip', line.startTime, lineIndex) < seq.sideFlipChance;
      var resolvedSide = flipSide ? (baseSide === 'left' ? 'right' : 'left') : baseSide;
      var sender;

      if (agentSender) {
        sender = agentSender;
      } else if (forceRight) {
        sender = { side: 'right', avatarIndex: RIGHT_AVATAR_INDEX };
      } else if (carrySender && lastLyricSender) {
        sender = lastLyricSender;
      } else {
        sender = {
          side: resolvedSide,
          avatarIndex: resolvedSide === 'left' ? leftAvatarCursor : RIGHT_AVATAR_INDEX
        };
      }

      var isInterlude = line.fullText === INTERLUDE_TEXT;
      var emoImage = (isInterlude && showEmo)
        ? cappellaPickStableEmoImage(emoPool, ['interlude', line.startTime, lineIndex])
        : null;
      var renderEnd = cappellaEffectiveRenderEndTime(line, nextLine);

      if (isInterlude && emoImage) {
        messages.push({
          id: 'emo-' + line.startTime + '-' + lineIndex,
          kind: 'emo',
          line: line,
          lineIndex: lineIndex,
          side: sender.side,
          avatarIndex: sender.avatarIndex,
          emoImageUrl: emoImage.url,
          activationStartTime: line.startTime,
          activationEndTime: Math.max(line.startTime + 0.12, renderEnd)
        });
      } else {
        messages.push({
          id: 'line-' + line.startTime + '-' + lineIndex,
          kind: 'lyric',
          line: line,
          lineIndex: lineIndex,
          side: sender.side,
          avatarIndex: sender.avatarIndex
        });
      }
      linesSinceRandomEmo += 1;

      /* 随机表情回复：只挂在「正常语速」的行后面，且总条数有上限（maxRandomEmoRatio）。 */
      var hints = foliaGetLineRenderHints(line);
      var canAppendEmo = !isInterlude
        && showEmo
        && seq.randomEmoChance > 0
        && randomEmoCount < randomEmoCap
        && linesSinceRandomEmo >= seq.minLinesBetweenRandomEmos
        && hints
        && hints.timingClass === 'normal';

      if (canAppendEmo) {
        var score = cappellaSeededUnit('random-emo', line.startTime, line.endTime, lineIndex, seq.randomEmoChance);
        if (score < seq.randomEmoChance) {
          var reaction = cappellaPickStableEmoImage(emoPool, ['reaction', line.startTime, line.endTime, lineIndex, sender.side]);
          if (reaction) {
            messages.push({
              id: 'emo-reaction-' + line.startTime + '-' + lineIndex,
              kind: 'emo',
              line: line,
              lineIndex: lineIndex,
              side: sender.side,
              avatarIndex: sender.avatarIndex,
              emoImageUrl: reaction.url,
              activationStartTime: line.endTime,
              activationEndTime: Math.max(line.endTime + 0.08, renderEnd)
            });
            randomEmoCount += 1;
            linesSinceRandomEmo = 0;
          }
        }
      }

      if (agentSender) {
        lastLyricSender = sender;
      } else if (forceRight) {
        sideCursor = 0;
        lastLyricSender = null;
      } else if (!carrySender) {
        if (sender.side === 'left') leftAvatarCursor += 1;
        sideCursor += 1;
        lastLyricSender = sender;
      } else {
        lastLyricSender = sender;
      }
    }

    return messages;
  }

  /* ------------------------------------------------------------------ *
   * 字素时间轴与逐字出现（cappellaReveal.ts + graphemeTiming.ts）
   * ------------------------------------------------------------------ */

  function cappellaFindGraphemeSequence(source, target, fromIndex) {
    if (!target.length) return fromIndex;
    for (var i = fromIndex; i <= source.length - target.length; i++) {
      var matched = true;
      for (var k = 0; k < target.length; k++) {
        if (source[i + k] !== target[k]) { matched = false; break; }
      }
      if (matched) return i;
    }
    return -1;
  }

  /* 整行字素时间轴：词的时序映射回「含空格与标点的完整显示文本」。 */
  function cappellaBuildLineGraphemeTimeline(line) {
    var lineGraphemes = foliaSplitGraphemes(line.fullText);
    if (!lineGraphemes.length) return [];
    if (!line.words || !line.words.length) {
      return foliaBuildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
    }

    var timeline = [];
    var cursor = 0;
    var lastResolved = line.startTime;
    var i, k;

    for (var wi = 0; wi < line.words.length; wi++) {
      var word = line.words[wi];
      var wordGraphemes = foliaSplitGraphemes(word.text);
      if (!wordGraphemes.length) continue;

      var matchedStart = cappellaFindGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

      for (i = cursor; i < start; i++) {
        timeline[i] = { char: lineGraphemes[i], startTime: word.startTime, endTime: word.startTime };
      }

      var wordTimings = foliaBuildWordGraphemeTimings(word);
      for (k = 0; k < end - start; k++) {
        var timing = wordTimings[k];
        if (!timing) {
          var even = foliaBuildEvenGraphemeTimings(wordGraphemes[k] || '', word.startTime, word.endTime);
          timing = even[0];
        }
        if (!timing) continue;
        timeline[start + k] = {
          char: lineGraphemes[start + k],
          startTime: timing.startTime,
          endTime: timing.endTime
        };
        lastResolved = Math.max(lastResolved, timing.endTime);
      }

      cursor = Math.max(cursor, end);
    }

    for (i = 0; i < lineGraphemes.length; i++) {
      if (timeline[i]) continue;
      timeline[i] = { char: lineGraphemes[i], startTime: lastResolved, endTime: lastResolved };
    }
    return timeline;
  }

  function cappellaWordTextRanges(line) {
    var ranges = [];
    var searchCursor = 0;
    for (var i = 0; i < line.words.length; i++) {
      var word = line.words[i];
      var start = line.fullText.indexOf(word.text, searchCursor);
      if (start < 0) { ranges.push(null); continue; }
      var end = start + word.text.length;
      ranges.push({ start: start, end: end });
      searchCursor = end;
    }
    return ranges;
  }

  /* 逐字出现时刻：优先用整行字素时间轴；字素数量对不上时按词回退（空格/标点跟下一个词一起出）。 */
  function cappellaBuildCharacterRevealTimes(line, characters) {
    var revealTimes = [];
    for (var z = 0; z < characters.length; z++) revealTimes.push(Number.POSITIVE_INFINITY);

    var lineTimeline = cappellaBuildLineGraphemeTimeline(line);
    if (lineTimeline.length === characters.length) {
      for (var t = 0; t < lineTimeline.length; t++) revealTimes[t] = lineTimeline[t].startTime;
      return revealTimes;
    }

    var ranges = cappellaWordTextRanges(line);
    var previousWordEnd = 0;
    var lastResolved = line.startTime;
    var hasResolved = false;
    var i, k;

    for (var wi = 0; wi < line.words.length; wi++) {
      var range = ranges[wi];
      if (!range) continue;

      var startCharIndex = foliaSplitGraphemes(line.fullText.slice(0, range.start)).length;
      var endCharIndex = foliaSplitGraphemes(line.fullText.slice(0, range.end)).length;
      var wordTimings = foliaBuildWordGraphemeTimings(line.words[wi]);

      /* 两个计时词之间通常是空格或粘连标点，让它们跟下一个词一起出现，视觉上才连续。 */
      for (i = previousWordEnd; i < startCharIndex; i++) {
        revealTimes[i] = line.words[wi].startTime;
      }

      for (k = 0; k < wordTimings.length; k++) {
        var target = startCharIndex + k;
        if (target >= revealTimes.length) break;
        revealTimes[target] = wordTimings[k].startTime;
        lastResolved = Math.max(lastResolved, revealTimes[target]);
        hasResolved = true;
      }

      previousWordEnd = endCharIndex;
    }

    /* 没匹配上的尾巴仍属于这一行：挂到最后一个计时字上，否则时间戳要等下一行才开始。 */
    var trailing = hasResolved ? lastResolved : line.endTime;
    for (i = previousWordEnd; i < revealTimes.length; i++) revealTimes[i] = trailing;

    return revealTimes;
  }

  /* revealTimes 单调递增 → 二分查出「此刻该显示几个字」。 */
  function cappellaCharacterCountAtTime(times, currentTime) {
    var low = 0;
    var high = times.length;
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      if (times[mid] <= currentTime) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function cappellaBuildCharacterFadeDurations(line, characters) {
    var durations = [];
    var i, k;
    for (i = 0; i < characters.length; i++) durations.push(DEFAULT_CHAR_FADE_MS);

    var lineTimeline = cappellaBuildLineGraphemeTimeline(line);
    if (lineTimeline.length === characters.length) {
      for (i = 0; i < lineTimeline.length; i++) {
        durations[i] = Math.max((lineTimeline[i].endTime - lineTimeline[i].startTime) * 1000, MIN_CHAR_FADE_MS);
      }
      return durations;
    }

    var ranges = cappellaWordTextRanges(line);
    for (var wi = 0; wi < line.words.length; wi++) {
      var range = ranges[wi];
      if (!range) continue;
      var startCharIndex = foliaSplitGraphemes(line.fullText.slice(0, range.start)).length;
      var wordTimings = foliaBuildWordGraphemeTimings(line.words[wi]);
      for (k = 0; k < wordTimings.length; k++) {
        var target = startCharIndex + k;
        if (target >= durations.length) break;
        durations[target] = wordTimings[k]
          ? Math.max((wordTimings[k].endTime - wordTimings[k].startTime) * 1000, MIN_CHAR_FADE_MS)
          : DEFAULT_CHAR_FADE_MS;
      }
    }
    return durations;
  }

  /* 展示用字符（Folia 这里用 Array.from 而不是字素切分，照抄）。 */
  function cappellaCharacterRevealPlan(line) {
    var characters = Array.from(String(line.fullText || ''));
    return { characters: characters, fadeDurationsMs: cappellaBuildCharacterFadeDurations(line, characters) };
  }

  function cappellaTimestampReadyTime(metrics, line) {
    return metrics ? metrics.timestampReadyTime : line.endTime;
  }

  /* ------------------------------------------------------------------ *
   * 气泡测量（cappellaBubbleMetrics.ts）：每个前缀实测一次，缓存起来
   * ------------------------------------------------------------------ */

  function cappellaRememberBounded(cache, key, value, limit) {
    cache.set(key, value);
    if (cache.size > limit) {
      var oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    return value;
  }

  function cappellaFontSpec(theme, fontSize) {
    return foliaResolveThemeFontWeight(theme, BUBBLE_FONT_WEIGHT) + ' ' + fontSize + 'px ' + theme.fontStack;
  }

  function cappellaMeasureBubbleText(inst, opts) {
    var theme = opts.theme;
    var safeText = opts.text || ' ';
    var lineHeightPx = opts.lineHeightPx;
    var cacheKey = [
      safeText, cappellaFontSpec(theme, opts.fontSize), lineHeightPx.toFixed(3),
      opts.maxTextWidth, opts.paddingX, opts.paddingY
    ].join('\u0000');
    var hit = inst.measureCache.get(cacheKey);
    if (hit) return hit;

    var textWidth = 0;
    var lineCount = 1;
    try {
      var prepared = inst.pretext.prepareWithSegments(safeText, cappellaFontSpec(theme, opts.fontSize), BUBBLE_TEXT_OPTIONS);
      var layout = inst.pretext.layoutWithLines(prepared, Math.max(1, opts.maxTextWidth), Math.round(lineHeightPx));
      var lines = (layout && layout.lines) || [];
      for (var i = 0; i < lines.length; i++) {
        var w = Number(lines[i].width);
        if (isFinite(w) && w > textWidth) textWidth = w;
      }
      lineCount = Math.max(lines.length, 1);
    } catch (_) {
      /* pretext 量不出来时按 0.6em 估算，至少不会把气泡压成 0 宽 */
      textWidth = safeText.length * opts.fontSize * 0.6;
      lineCount = 1;
    }
    textWidth = Math.max(textWidth, opts.fontSize);

    var size = {
      width: Math.ceil(Math.min(textWidth, opts.maxTextWidth) + opts.paddingX * 2 + BUBBLE_BORDER_WIDTH * 2),
      height: Math.ceil(lineCount * lineHeightPx + opts.paddingY * 2 + BUBBLE_BORDER_WIDTH * 2)
    };
    return cappellaRememberBounded(inst.measureCache, cacheKey, size, MEASURE_CACHE_LIMIT);
  }

  function cappellaBubbleMetricsKey(line, theme, fontSize, lineHeightPx, maxTextWidth, paddingX, paddingY) {
    return [
      line.startTime, line.endTime, line.words ? line.words.length : 0,
      theme.fontStack, foliaResolveThemeFontWeight(theme, BUBBLE_FONT_WEIGHT),
      fontSize.toFixed(3), lineHeightPx.toFixed(3), maxTextWidth, paddingX, paddingY
    ].join('|');
  }

  /* 一条行的全部前缀尺寸（播放时只做 O(1) 查表）。 */
  function cappellaGetOrBuildBubbleMetrics(inst, opts) {
    var theme = opts.theme;
    var line = opts.line;
    var key = cappellaBubbleMetricsKey(line, theme, opts.fontSize, opts.lineHeightPx, opts.maxTextWidth, opts.paddingX, opts.paddingY);
    var cached = inst.metricsCache.get(key);
    if (cached) {
      /* LRU：命中的挪到队尾 */
      inst.metricsCache.delete(key);
      inst.metricsCache.set(key, cached);
      return cached;
    }

    var characters = foliaSplitGraphemes(line.fullText);
    var revealTimes = cappellaBuildCharacterRevealTimes(line, characters);
    var fadeDurationsMs = cappellaBuildCharacterFadeDurations(line, characters);

    var timestampReadyTime = line.startTime;
    for (var i = 0; i < revealTimes.length; i++) {
      if (!isFinite(revealTimes[i])) continue;
      timestampReadyTime = Math.max(timestampReadyTime, revealTimes[i] + (fadeDurationsMs[i] || DEFAULT_CHAR_FADE_MS) / 1000);
    }

    /* 文字出现与气泡变宽共用这张 sizes 表，只是气泡用提前 0.2s 的时间轴。 */
    var bubbleTargetTimes = [];
    for (i = 0; i < revealTimes.length; i++) bubbleTargetTimes.push(revealTimes[i] - WIDTH_LOOKAHEAD_SECONDS);

    var sizes = [];
    for (var visibleCount = 0; visibleCount <= characters.length; visibleCount++) {
      sizes.push(cappellaMeasureBubbleText(inst, {
        text: characters.slice(0, visibleCount).join(''),
        theme: theme,
        fontSize: opts.fontSize,
        lineHeightPx: opts.lineHeightPx,
        maxTextWidth: opts.maxTextWidth,
        paddingX: opts.paddingX,
        paddingY: opts.paddingY
      }));
    }

    return cappellaRememberBounded(inst.metricsCache, key, {
      characters: characters,
      sizes: sizes,
      revealTimes: revealTimes,
      bubbleTargetTimes: bubbleTargetTimes,
      timestampReadyTime: timestampReadyTime
    }, LAYOUT_CACHE_LIMIT);
  }

  /* ------------------------------------------------------------------ *
   * 视口取舍与状态（cappellaMessageLayout.ts）
   * ------------------------------------------------------------------ */

  function cappellaAvatarPosition(avatarIndex) {
    var safeIndex = ((avatarIndex % 9) + 9) % 9;
    var col = safeIndex % AVATAR_GRID_SIZE;
    var row = Math.floor(safeIndex / AVATAR_GRID_SIZE);
    return {
      backgroundPosition: (col * 50) + '% ' + (row * 50) + '%',
      backgroundSize: (AVATAR_GRID_SIZE * 100) + '% ' + (AVATAR_GRID_SIZE * 100) + '%'
    };
  }

  function cappellaTimedMessageState(message, currentTime, currentLineIndex) {
    if (message.kind === 'emo') {
      return {
        isActive: currentTime >= message.activationStartTime && currentTime < message.activationEndTime,
        isPassed: currentTime >= message.activationEndTime
      };
    }
    return {
      isActive: message.lineIndex === currentLineIndex,
      isPassed: message.lineIndex < currentLineIndex
    };
  }

  /* Folia 左气泡 = mix(secondaryColor, accentColor) 底 + primaryColor 字。
   * Folia 自带深色主题的 secondaryColor 天生偏暗（#71717a），所以「中暗底 + 亮字」成立；
   * 本项目的调色板整套取自封面/歌词（secondary ≈ #9cffdf 这种亮色），照抄公式会得到
   * 浅底浅字（实测对比度 ≈1，字直接看不见）。这里先把两侧色按 0.42~0.5 压回背景色，
   * 得到同色系的 muted 版本再套 Folia 的公式：混色比例、透明度、文字色一律不变。 */
  var cappellaLeftPaletteCache = { key: '', palette: null };

  function cappellaLeftPalette(theme) {
    var key = theme.backgroundColor + '|' + theme.secondaryColor + '|' + theme.accentColor;
    if (cappellaLeftPaletteCache.key === key) return cappellaLeftPaletteCache.palette;
    var palette = {
      secondary: foliaMixColors(theme.backgroundColor, theme.secondaryColor, 0.5, 1),
      accent: foliaMixColors(theme.backgroundColor, theme.accentColor, 0.42, 1)
    };
    cappellaLeftPaletteCache = { key: key, palette: palette };
    return palette;
  }

  function cappellaBubbleColors(message, theme) {
    if (message.side === 'right') {
      return {
        backgroundColor: foliaMixColors(theme.accentColor, theme.primaryColor, 0.18, 0.94),
        borderColor: foliaMixColors(theme.accentColor, theme.primaryColor, 0.34, 0.3),
        textColor: theme.backgroundColor
      };
    }
    var left = cappellaLeftPalette(theme);
    var avatarTone = (message.avatarIndex % (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE)) / (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1);
    var accentMix = 0.18 + avatarTone * 0.62;
    return {
      backgroundColor: foliaMixColors(left.secondary, left.accent, accentMix, 1),
      borderColor: foliaMixColors(left.secondary, left.accent, Math.min(accentMix + 0.18, 1), 0.26),
      textColor: theme.primaryColor
    };
  }

  function cappellaFormatTimestamp(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var total = Math.max(0, Math.floor(seconds));
    var minutes = Math.floor(total / 60);
    var rest = total % 60;
    return minutes + ':' + (rest < 10 ? '0' + rest : String(rest));
  }

  /* 估算一条消息渲染后的高度：决定视口内能放几条，防止底部溢出。 */
  function cappellaEstimateHeight(inst, message, isActive, layout, theme, baseFontSize, maxTextWidth) {
    var motion = layout.motion;
    var cacheKey = message.id + '|' + (isActive ? 1 : 0);
    var cached = layout.heightCache.get(cacheKey);
    if (cached != null) return cached;

    var height;
    if (message.kind === 'emo') {
      var imageSize = isActive ? motion.emoActiveSize : motion.emoInactiveSize;
      var emoOverflow = isActive && motion.activeScale > 1
        ? Math.ceil(imageSize * (motion.activeScale - 1))
        : 0;
      /* 图高 + 缩放上溢 + pt-12(48px) + gap-3(12px) */
      height = imageSize + emoOverflow + 48 + 12;
    } else {
      var fontSize = message.kind === 'title'
        ? baseFontSize
        : baseFontSize * (isActive ? motion.activeFontMultiplier : motion.inactiveFontMultiplier);
      var paddingX = isActive ? motion.activePaddingX : motion.inactivePaddingX;
      var paddingY = isActive ? motion.activePaddingY : motion.inactivePaddingY;
      var lineHeightPx = fontSize * BUBBLE_LINE_HEIGHT;
      var measured = cappellaMeasureBubbleText(inst, {
        text: message.kind === 'title' ? message.text : message.line.fullText,
        theme: theme,
        fontSize: fontSize,
        lineHeightPx: lineHeightPx,
        maxTextWidth: maxTextWidth,
        paddingX: paddingX,
        paddingY: paddingY
      }).height;
      var minHeight = Math.max(
        isActive ? motion.activeMinHeight : motion.inactiveMinHeight,
        lineHeightPx + paddingY * 2
      );
      var rendered = Math.max(measured, minHeight);
      var scaleOverflow = isActive && motion.activeScale > 1
        ? Math.ceil(rendered * (motion.activeScale - 1))
        : 0;
      height = rendered + scaleOverflow + 12;
    }

    layout.heightCache.set(cacheKey, height);
    return height;
  }

  function cappellaVisibleLineIndexAtTime(lines, currentTime) {
    for (var i = lines.length - 1; i >= 0; i--) {
      if (currentTime >= lines[i].startTime) return i;
    }
    return -1;
  }

  /* 从最新一条往回累加高度，直到视口放不下（至少留 2 条上下文，最多 20 条）。 */
  function cappellaGetVisibleMessages(inst, layout, ctx) {
    var messages = layout.messages;
    var motion = layout.motion;
    var theme = ctx.theme;
    var visible = [];
    var i;

    for (i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.kind === 'title') { visible.push(m); continue; }
      if (m.kind === 'emo') {
        if (ctx.time >= m.activationStartTime) visible.push(m);
        continue;
      }
      if (m.lineIndex <= inst.visibleLineIndex) visible.push(m);
    }

    /* 可用高度 = 视口高 - 底部控制条 (~160px) - 顶部状态栏/间距 (~80px) */
    var usableHeight = Math.max(200, layout.viewportHeight - 240);
    var accumulated = 0;
    var result = [];

    for (i = visible.length - 1; i >= 0; i--) {
      var message = visible[i];
      var isActive = false;
      if (message.kind === 'lyric' || message.kind === 'emo') {
        isActive = cappellaTimedMessageState(message, ctx.time, ctx.index).isActive;
      }
      var est = cappellaEstimateHeight(inst, message, isActive, layout, theme, layout.baseFontSize, layout.maxTextWidth);
      if (accumulated + est > usableHeight && result.length >= 2) break;
      accumulated += est;
      result.unshift(message);
      if (result.length >= MAX_VISIBLE_MESSAGES) break;
    }

    return result;
  }

  /* Folia getUpcomingLine：有当前行就是下一行；还没有当前行就是「第一个还没到点的行」。 */
  function cappellaUpcomingLine(lines, currentIndex, currentTime) {
    if (currentIndex >= 0 && lines[currentIndex]) return lines[currentIndex + 1] || null;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startTime > currentTime) return lines[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 布局（视口 / 字号 / 主题 / 消息表）
   * ------------------------------------------------------------------ */

  /* 歌名/封面每帧都要参与布局指纹，但 currentDesktopSongMeta 会算封面地址（有开销）→ 400ms 节流。 */
  var cappellaMetaCache = { at: -1e9, meta: null };

  function cappellaSongMeta() {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (cappellaMetaCache.meta && now - cappellaMetaCache.at < 400) return cappellaMetaCache.meta;
    var meta = { title: '', cover: '' };
    try {
      if (typeof currentDesktopSongMeta === 'function') {
        var live = currentDesktopSongMeta() || {};
        meta.title = String(live.title || '').trim();
        meta.cover = String(live.cover || '').trim();
      }
    } catch (_) {}
    cappellaMetaCache = { at: now, meta: meta };
    return meta;
  }

  function cappellaLayoutKey(ctx, inst) {
    var lines = ctx.lines || [];
    var meta = cappellaSongMeta();
    var first = lines[0];
    var last = lines.length ? lines[lines.length - 1] : null;
    return [
      inst.viewportWidth, inst.viewportHeight, ctx.fontScale || 1,
      ctx.theme.primaryColor, ctx.theme.secondaryColor, ctx.theme.accentColor,
      ctx.theme.backgroundColor, ctx.theme.fontStack, ctx.theme.weight,
      ctx.theme.animationIntensity,
      lines.length, first ? first.startTime : -1, last ? last.startTime : -1,
      meta.title, meta.cover,
      /* 三项调参都参与「消息条 + 头像」的构建：键里带上，改了才会重排。 */
      cappellaTuning().showEmoMessages ? 1 : 0,
      cappellaTuning().emojiPackSource,
      cappellaTuning().avatarSource
    ].join('|');
  }

  function cappellaClearRows(inst) {
    if (!inst.rows) return;
    inst.rows.forEach(function (row) {
      if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
    });
    inst.rows.clear();
    if (inst.exiting) {
      for (var i = 0; i < inst.exiting.length; i++) {
        var el = inst.exiting[i].el;
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
      inst.exiting.length = 0;
    }
  }

  function cappellaRebuildLayout(inst, ctx) {
    var meta = cappellaSongMeta();
    var titleText = meta.title || '未在播放';
    var config = cappellaIntensityConfig(ctx.theme.animationIntensity);
    var messages = cappellaBuildMessages(ctx.lines || [], titleText, config, cappellaTuning(), cappellaEmoImages);

    var baseFontSize = Math.max(15, Math.min(26, 18 * (ctx.fontScale || 1)));
    var maxPanelWidth = Math.min(Math.max(inst.viewportWidth - 32, 1), 896);
    var bubbleGroupRatio = inst.viewportWidth >= 640 ? 0.68 : 0.78;
    var maxTextWidth = Math.max(96, Math.floor(maxPanelWidth * bubbleGroupRatio - 56));

    cappellaClearRows(inst);
    inst.metricsCache.clear();
    inst.measureCache.clear();

    inst.layout = {
      lines: ctx.lines || [],
      messages: messages,
      sequencing: config.sequencing,
      motion: config.motion,
      theme: ctx.theme,
      titleText: titleText,
      coverUrl: meta.cover,
      baseFontSize: baseFontSize,
      maxTextWidth: maxTextWidth,
      viewportHeight: inst.viewportHeight,
      heightCache: new Map()
    };
    inst.layoutKey = cappellaLayoutKey(ctx, inst);
    inst.visibleLineIndex = -2;
    inst.currentLineIndex = -2;
    inst.emoVisibleCount = -1;
    inst.needsVisible = true;
    if (inst.root) {
      inst.root.setAttribute('data-folia-cappella-messages', String(messages.length));
      inst.list.style.maxWidth = Math.min(maxPanelWidth, 896) + 'px';
    }
  }

  /* ------------------------------------------------------------------ *
   * 行节点：建立 / 状态切换 / 逐帧推进 / 进出场
   * ------------------------------------------------------------------ */

  function cappellaBuildAvatar(inst, message, theme) {
    var isRight = message.side === 'right';
    var useGridCrop = cappellaTuning().avatarSource === 'cover' && !!inst.layout.coverUrl;
    var avatarUrl = cappellaResolveAvatarUrl({
      source: cappellaTuning().avatarSource,
      coverUrl: inst.layout.coverUrl,
      avatarIndex: message.avatarIndex,
      side: message.side,
      seed: inst.layout.titleText,
      pool: cappellaAvatarImages
    });
    var shouldCrop = useGridCrop || !avatarUrl;
    var resolvedIndex = shouldCrop
      ? (isRight ? RIGHT_AVATAR_INDEX : LEFT_AVATAR_INDICES[message.avatarIndex % LEFT_AVATAR_INDICES.length])
      : message.avatarIndex;
    var position = cappellaAvatarPosition(resolvedIndex);

    var el = document.createElement('div');
    el.className = 'folia-cappella-avatar';
    el.style.backgroundColor = theme.secondaryColor;
    el.style.backgroundImage = avatarUrl
      ? 'url("' + String(avatarUrl).replace(/["'()\\]/g, function (c) { return '\\' + c; }) + '")'
      : 'linear-gradient(135deg, ' + theme.primaryColor + ', ' + theme.accentColor + ')';
    el.style.backgroundPosition = shouldCrop ? position.backgroundPosition : 'center';
    el.style.backgroundSize = shouldCrop ? position.backgroundSize : 'cover';
    return el;
  }

  function cappellaCreateTimestamp(message, theme, isRight, offsetBottom) {
    var ts = document.createElement('span');
    ts.className = 'folia-cappella-ts';
    ts.style.color = theme.secondaryColor;
    ts.style.bottom = offsetBottom + 'px';
    if (isRight) ts.style.right = 'calc(100% + 8px)';
    else ts.style.left = 'calc(100% + 8px)';
    ts.textContent = cappellaFormatTimestamp(message.line ? message.line.endTime : 0);
    return ts;
  }

  function cappellaCreateRow(inst, message, ctx) {
    var layout = inst.layout;
    var motion = layout.motion;
    var theme = ctx.theme;
    var isRight = message.side === 'right';
    var isEmo = message.kind === 'emo';

    var el = document.createElement('div');
    el.className = 'folia-cappella-row ' + (isRight ? 'is-right' : 'is-left') + (isEmo ? ' is-emo' : '');
    el.setAttribute('data-folia-msg', message.id);
    el.setAttribute('data-folia-msg-kind', message.kind);
    el.style.setProperty('--enter-y', motion.rowEnterY + 'px');
    el.style.setProperty('--enter-scale', String(motion.rowEnterScale));
    el.style.setProperty('--enter-dur', motion.rowEnterDuration + 's');
    el.classList.add('is-entering');

    var counter = document.createElement('div');
    counter.className = 'folia-cappella-counter';
    counter.style.transformOrigin = isRight ? '100% 100%' : '0% 100%';
    el.appendChild(counter);

    counter.appendChild(cappellaBuildAvatar(inst, message, theme));

    var frame = document.createElement('div');
    frame.className = 'folia-cappella-frame';
    counter.appendChild(frame);

    var row = {
      id: message.id,
      message: message,
      el: el,
      counter: counter,
      frame: frame,
      avatarEl: counter.firstChild,
      bubble: null,
      glowEl: null,
      textEl: null,
      emoEl: null,
      tsEl: null,
      isRight: isRight,
      isEmo: isEmo,
      isActive: null,
      isPassed: null,
      fontSize: 0,
      padX: 0,
      padY: 0,
      sizeKey: '',
      visibleCount: 0,
      textMode: '',
      textRendered: 0,
      revealPlan: null,
      metrics: null,
      tsVisible: null,
      enterLeft: motion.rowEnterDuration,
      exiting: false,
      scaleOverflow: 0,
      lastScale: NaN,
      lastOpacity: NaN,
      lastMargin: NaN,
      scaleSpring: foliaSpringFollower(motion.avatarSpring.stiffness, motion.avatarSpring.damping, motion.avatarSpring.mass),
      opacitySpring: foliaSpringFollower(motion.avatarSpring.stiffness, motion.avatarSpring.damping, motion.avatarSpring.mass),
      marginSpring: foliaSpringFollower(motion.avatarSpring.stiffness, motion.avatarSpring.damping, motion.avatarSpring.mass)
    };

    if (isEmo) {
      frame.style.transition = 'width ' + motion.emoSizeTransitionDuration + 's ease-out, height ' + motion.emoSizeTransitionDuration + 's ease-out';
      var emoWrap = document.createElement('div');
      emoWrap.className = 'folia-cappella-emo';
      emoWrap.style.setProperty('--emo-enter-scale', String(motion.emoEnterScale));
      emoWrap.style.setProperty('--emo-enter-dur', motion.rowEnterDuration + 's');
      var img = document.createElement('img');
      img.src = message.emoImageUrl;
      img.alt = 'emo';
      img.draggable = false;
      emoWrap.appendChild(img);
      frame.appendChild(emoWrap);
      row.emoEl = emoWrap;
      row.tsEl = cappellaCreateTimestamp(message, theme, isRight, -2);
      frame.appendChild(row.tsEl);
      tsVisibleSet(row, false);
    } else {
      frame.style.transition = 'width 0.2s ease-out, height 0.2s ease-out';
      var bubble = document.createElement('div');
      bubble.className = 'folia-cappella-bubble';
      var colors = cappellaBubbleColors(message, theme);
      bubble.style.backgroundColor = colors.backgroundColor;
      bubble.style.border = '1px solid ' + colors.borderColor;
      bubble.style.color = colors.textColor;
      bubble.style.whiteSpace = 'pre-wrap';
      bubble.style.overflowWrap = 'anywhere';
      bubble.style.overflow = 'hidden';

      var glowLayer = document.createElement('div');
      glowLayer.className = 'folia-cappella-glow-layer';
      var glow = document.createElement('div');
      glow.className = 'folia-cappella-glow';
      var glowAlpha = isRight ? motion.glowRightAlpha : motion.glowLeftAlpha;
      var glowColor = 'rgba(255,255,255,' + glowAlpha + ')';
      glow.style.opacity = String(motion.glowOpacity);
      glow.style.background = 'linear-gradient(105deg, transparent 0%, ' + glowColor + ' 23%, transparent 34%, transparent 50%, transparent 50%, '
        + glowColor + ' 73%, transparent 84%, transparent 100%)';
      glow.style.animationDuration = motion.glowDuration + 's';
      glow.style.display = 'none';
      glowLayer.appendChild(glow);
      bubble.appendChild(glowLayer);

      var text = document.createElement('span');
      text.className = 'folia-cappella-text';
      if (message.kind === 'title') text.textContent = message.text;
      else text.textContent = message.line.fullText;
      bubble.appendChild(text);

      frame.appendChild(bubble);
      row.bubble = bubble;
      row.glowEl = glow;
      row.textEl = text;
      row.textMode = 'plain';

      if (message.kind === 'lyric') {
        row.tsEl = cappellaCreateTimestamp(message, theme, isRight, 4);
        frame.appendChild(row.tsEl);
        tsVisibleSet(row, false);
      }
    }

    /* 首帧就按当前状态落位（framer 只给 animate 不给 initial 时同样是「立即到目标」）。 */
    cappellaApplyRowState(inst, row, ctx, cappellaRowState(row, ctx));
    var target = cappellaRowTargetSize(inst, row, ctx);
    if (target) {
      row.frame.style.width = target.w + 'px';
      row.frame.style.height = target.h + 'px';
      row.sizeKey = target.key;
    }
    row.scaleSpring.set(row.lastTargetScale);
    row.opacitySpring.set(row.lastTargetOpacity);
    row.marginSpring.set(row.lastTargetMargin);

    return row;
  }

  function tsVisibleSet(row, visible) {
    if (!row || !row.tsEl) return;
    if (row.tsVisible === visible) return;
    row.tsVisible = visible;
    if (visible) {
      row.tsEl.style.transition = 'opacity ' + TS_FADE_SECONDS + 's ease-out, transform ' + TS_FADE_SECONDS + 's ease-out';
      row.tsEl.style.opacity = '0.62';
      row.tsEl.style.transform = 'translateY(0)';
    } else {
      row.tsEl.style.transition = 'none';
      row.tsEl.style.opacity = '0';
      row.tsEl.style.transform = 'translateY(4px)';
    }
  }

  function cappellaRowState(row, ctx) {
    var m = row.message;
    if (m.kind !== 'lyric' && m.kind !== 'emo') return { isActive: false, isPassed: false };
    return cappellaTimedMessageState(m, ctx.time, ctx.index);
  }

  /* 状态（唱到 / 唱过）变化时重写气泡外观；字号/内边距/最小高度/投影都跟着档位走。 */
  function cappellaApplyRowState(inst, row, ctx, state) {
    var motion = inst.layout.motion;
    var theme = ctx.theme;
    var m = row.message;
    var isActive = state.isActive;
    var isPassed = state.isPassed;
    var changed = row.isActive !== isActive || row.isPassed !== isPassed;
    row.isActive = isActive;
    row.isPassed = isPassed;
    row.scaleOverflow = cappellaScaleOverflow(row, isActive, motion);

    if (row.bubble) {
      var fontSize = isActive
        ? inst.layout.baseFontSize * motion.activeFontMultiplier
        : (m.kind === 'title' ? inst.layout.baseFontSize : inst.layout.baseFontSize * motion.inactiveFontMultiplier);
      var padX = isActive ? motion.activePaddingX : motion.inactivePaddingX;
      var padY = isActive ? motion.activePaddingY : motion.inactivePaddingY;
      row.fontSize = fontSize;
      row.padX = padX;
      row.padY = padY;
      row.lineHeightPx = fontSize * BUBBLE_LINE_HEIGHT;

      if (changed || row.appliedFontSize !== fontSize) {
        row.appliedFontSize = fontSize;
        var bs = row.bubble.style;
        bs.fontSize = fontSize + 'px';
        bs.lineHeight = String(BUBBLE_LINE_HEIGHT);
        bs.fontWeight = String(foliaResolveThemeFontWeight(theme, BUBBLE_FONT_WEIGHT));
        bs.padding = padY + 'px ' + padX + 'px';
        bs.minHeight = Math.max(
          isActive ? motion.activeMinHeight : motion.inactiveMinHeight,
          fontSize * BUBBLE_LINE_HEIGHT + padY * 2
        ) + 'px';
        bs.minWidth = isActive ? '72px' : '';
        bs.maxWidth = (inst.layout.maxTextWidth + padX * 2 + 2) + 'px';
        bs.boxShadow = isActive
          ? '0 18px 48px ' + foliaMixColors(theme.backgroundColor, theme.accentColor, 0.2, motion.activeShadowAlpha)
          : '';
        row.sizeKey = '';
      }
      if (row.glowEl) row.glowEl.style.display = isActive ? '' : 'none';
    }

    row.lastTargetScale = isActive ? motion.activeScale : (isPassed ? motion.passedScale : 1);
    row.lastTargetOpacity = isPassed ? motion.passedOpacity : 1;
    row.lastTargetMargin = row.scaleOverflow;
  }

  function cappellaScaleOverflow(row, isActive, motion) {
    if (!isActive || motion.activeScale <= 1) return 0;
    var height = motion.activeMinHeight;
    if (row.isEmo) {
      height = motion.emoActiveSize;
    } else if (row.metrics && row.metrics.sizes.length) {
      var last = row.metrics.sizes[row.metrics.sizes.length - 1];
      if (last && isFinite(last.height)) height = last.height;
    }
    return Math.ceil(Math.max(height, 40) * (motion.activeScale - 1));
  }

  /* 目标尺寸：唱到的行按「此刻该显示几个字」查表；静态行按整行实测；表情是正方形。 */
  function cappellaRowTargetSize(inst, row, ctx) {
    var motion = inst.layout.motion;
    var m = row.message;

    if (m.kind === 'emo') {
      var size = row.isActive ? motion.emoActiveSize : motion.emoInactiveSize;
      return { w: size, h: size, key: 'emo|' + size };
    }
    if (m.kind !== 'lyric') return null;

    if (row.isActive) {
      var metrics = cappellaGetOrBuildBubbleMetrics(inst, {
        line: m.line,
        theme: ctx.theme,
        fontSize: row.fontSize,
        lineHeightPx: row.lineHeightPx,
        maxTextWidth: inst.layout.maxTextWidth,
        paddingX: row.padX,
        paddingY: row.padY
      });
      row.metrics = metrics;
      var count = cappellaCharacterCountAtTime(metrics.bubbleTargetTimes, ctx.time);
      var index = Math.max(0, Math.min(count, metrics.sizes.length - 1));
      var target = metrics.sizes[index];
      if (!target) return null;
      return { w: target.width, h: target.height, key: 'active|' + index };
    }

    var staticSize = cappellaMeasureBubbleText(inst, {
      text: m.line.fullText,
      theme: ctx.theme,
      fontSize: row.fontSize,
      lineHeightPx: row.lineHeightPx,
      maxTextWidth: inst.layout.maxTextWidth,
      paddingX: row.padX,
      paddingY: row.padY
    });
    return { w: staticSize.width, h: staticSize.height, key: 'static|' + row.fontSize };
  }

  function cappellaWriteActiveText(row, visibleCount) {
    var plan = row.revealPlan;
    if (!plan) {
      plan = cappellaCharacterRevealPlan(row.message.line);
      row.revealPlan = plan;
    }
    var target = Math.max(0, visibleCount);
    var span = row.textEl;

    if (row.textMode !== 'active') {
      span.textContent = '';
      row.textMode = 'active';
      row.textRendered = 0;
    }
    if (target < row.textRendered) {
      span.textContent = '';
      row.textRendered = 0;
    }
    for (var i = row.textRendered; i < target && i < plan.characters.length; i++) {
      var ch = document.createElement('span');
      ch.className = 'folia-cappella-char';
      ch.textContent = plan.characters[i];
      ch.style.animationName = 'folia-cappella-char-fade';
      ch.style.animationDuration = (plan.fadeDurationsMs[i] || DEFAULT_CHAR_FADE_MS) + 'ms';
      ch.style.animationTimingFunction = 'ease-out';
      span.appendChild(ch);
    }
    row.textRendered = Math.max(row.textRendered, Math.min(target, plan.characters.length));
  }

  function cappellaWritePlainText(row) {
    if (row.textMode === 'plain') return;
    row.textMode = 'plain';
    row.revealPlan = null;
    row.textRendered = 0;
    row.textEl.textContent = row.message.kind === 'title'
      ? row.message.text
      : row.message.line.fullText;
  }

  function cappellaUpdateRow(inst, row, ctx) {
    var m = row.message;
    var state = cappellaRowState(row, ctx);
    cappellaApplyRowState(inst, row, ctx, state);

    if (m.kind === 'lyric' && row.isActive && row.metrics) {
      var metrics = row.metrics;
      var visibleCount = cappellaCharacterCountAtTime(metrics.revealTimes, ctx.time);
      if (visibleCount !== row.visibleCount) {
        row.visibleCount = visibleCount;
        cappellaWriteActiveText(row, visibleCount);
      }
    } else if (m.kind === 'lyric' || m.kind === 'title') {
      cappellaWritePlainText(row);
    }

    var target = cappellaRowTargetSize(inst, row, ctx);
    if (target && target.key !== row.sizeKey) {
      row.sizeKey = target.key;
      row.frame.style.width = target.w + 'px';
      row.frame.style.height = target.h + 'px';
    }

    /* 时间戳：表情等激活结束；歌词等「最后一个字淡入完成」或整行唱过。 */
    if (row.tsEl) {
      var tsVisible;
      if (m.kind === 'emo') {
        tsVisible = ctx.time >= m.activationEndTime;
      } else {
        tsVisible = row.isPassed || ctx.time >= cappellaTimestampReadyTime(row.metrics, m.line);
      }
      tsVisibleSet(row, tsVisible);
    }

    /* 弹簧：缩放 / 透明度 / 上溢补偿边距，参数与 framer 的 avatarSpring 同义。 */
    var dt = ctx.dt > 0 ? Math.min(ctx.dt, 0.1) : 1 / 60;
    row.scaleSpring.step(row.lastTargetScale, dt);
    row.opacitySpring.step(row.lastTargetOpacity, dt);
    row.marginSpring.step(row.lastTargetMargin, dt);

    var scale = row.scaleSpring.get();
    var opacity = row.opacitySpring.get();
    var margin = row.marginSpring.get();

    if (!(Math.abs(scale - row.lastScale) < 1e-4)) {
      row.lastScale = scale;
      row.counter.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }
    if (!(Math.abs(opacity - row.lastOpacity) < 1e-4)) {
      row.lastOpacity = opacity;
      row.counter.style.opacity = opacity.toFixed(4);
    }
    if (!(Math.abs(margin - row.lastMargin) < 0.05)) {
      row.lastMargin = margin;
      row.counter.style.marginTop = margin.toFixed(2) + 'px';
    }

    row.el.setAttribute('data-folia-msg-active', row.isActive ? '1' : '0');
  }

  /* ------------------------------------------------------------------ *
   * 列表同步：按 id 复用节点，退出行走绝对定位（framer popLayout），重排用 FLIP 补偿
   * ------------------------------------------------------------------ */

  function cappellaBeginExit(inst, row, ctx) {
    var motion = inst.layout.motion;
    var rect = row.el.getBoundingClientRect();
    var listRect = inst.list.getBoundingClientRect();
    row.el.classList.remove('is-entering');
    row.el.classList.add('is-exiting');
    row.el.style.position = 'absolute';
    row.el.style.left = (rect.left - listRect.left) + 'px';
    row.el.style.top = (rect.top - listRect.top) + 'px';
    row.el.style.width = rect.width + 'px';
    row.el.style.height = rect.height + 'px';
    row.el.style.margin = '0';
    /* 先让浏览器认下起始位置，再启动过渡（同帧写入会把起始状态压没） */
    void row.el.offsetWidth;
    row.el.style.transition = 'opacity ' + motion.rowExitDuration + 's ease-in, transform ' + motion.rowExitDuration + 's ease-in';
    row.el.style.opacity = '0';
    row.el.style.transform = 'translateY(' + motion.rowExitY + 'px) scale(' + motion.rowExitScale + ')';
    row.exiting = true;
    row.exitLeft = motion.rowExitDuration;
    inst.exiting.push(row);
  }

  /* 列表里只剩行节点 + 正在退出的行（绝对定位、不影响布局），按序取「还在正常排版的行」。 */
  function cappellaRowElements(list) {
    var out = [];
    for (var el = list.firstElementChild; el; el = el.nextElementSibling) {
      if (el.classList.contains('is-exiting')) continue;
      out.push(el);
    }
    return out;
  }

  function cappellaReconcile(inst, ctx) {
    var list = inst.list;
    var visible = inst.visible;
    var wanted = Object.create(null);
    var i;

    for (i = 0; i < visible.length; i++) wanted[visible[i].id] = true;

    /* FLIP：先记录保留下来的行此刻的位置 */
    var beforeTop = new Map();
    inst.rows.forEach(function (row, id) {
      if (wanted[id]) beforeTop.set(id, row.el.offsetTop);
    });

    var toExit = [];
    inst.rows.forEach(function (row, id) {
      if (!wanted[id]) toExit.push(row);
    });
    for (i = 0; i < toExit.length; i++) {
      inst.rows.delete(toExit[i].id);
      cappellaBeginExit(inst, toExit[i], ctx);
    }

    for (i = 0; i < visible.length; i++) {
      var m = visible[i];
      if (!inst.rows.has(m.id)) inst.rows.set(m.id, cappellaCreateRow(inst, m, ctx));
    }

    var rowEls = cappellaRowElements(list);
    for (i = 0; i < visible.length; i++) {
      var row = inst.rows.get(visible[i].id);
      var current = rowEls[i] || null;
      if (current === row.el) continue;
      list.insertBefore(row.el, current);
      rowEls = cappellaRowElements(list);
    }

    /* 位置变了的行先平移回去再过渡归位，避免整列瞬跳 */
    beforeTop.forEach(function (before, id) {
      var target = inst.rows.get(id);
      if (!target) return;
      var after = target.el.offsetTop;
      var delta = before - after;
      if (Math.abs(delta) < 0.5) return;
      target.el.style.transition = 'none';
      target.el.style.transform = 'translateY(' + delta.toFixed(2) + 'px)';
      void target.el.offsetWidth;
      target.el.style.transition = 'transform 0.28s ' + FLIP_EASE;
      target.el.style.transform = '';
    });
  }

  /* ------------------------------------------------------------------ *
   * 模式注册
   * ------------------------------------------------------------------ */
  registerFoliaMode('cappella', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerCappella = 群唱，entry.tsx order 110。 */
    name: '群唱',
    desc: '歌词化成聊天气泡左右往返，配头像与表情，像一场对唱',
    order: 110,

    create: function (host, ctx) {
      return foliaLoadPretext().then(function (pretext) {
        var root = document.createElement('div');
        root.className = 'folia-cappella';
        root.style.fontFamily = ctx.theme.fontStack;

        var viewport = document.createElement('div');
        viewport.className = 'folia-cappella-viewport';
        var list = document.createElement('div');
        list.className = 'folia-cappella-list';
        viewport.appendChild(list);
        root.appendChild(viewport);
        host.appendChild(root);

        var inst = {
          pretext: pretext,
          root: root,
          viewportEl: viewport,
          list: list,
          rows: new Map(),
          exiting: [],
          metricsCache: new Map(),
          measureCache: new Map(),
          layout: null,
          layoutKey: '',
          visible: [],
          visibleLineIndex: -2,
          currentLineIndex: -2,
          emoVisibleCount: -1,
          needsVisible: true,
          viewportWidth: window.innerWidth || 1280,
          viewportHeight: window.innerHeight || 900,
          subtitle: foliaCreateSubtitleOverlay(host, ctx.theme, {
            /* Folia cappella 的译文字号写死成 px，不跟其它模式共用 clamp。 */
            translationFontSize: Math.max(14, 16 * (ctx.fontScale || 1)) + 'px',
            upcomingFontSize: Math.max(12, 14 * (ctx.fontScale || 1)) + 'px'
          })
        };

        cappellaRebuildLayout(inst, ctx);
        root.setAttribute('data-folia-cappella-rows', '0');
        return inst;
      });
    },

    tick: function (inst, ctx) {
      if (!inst || !inst.root) return;

      var w = window.innerWidth || 1280;
      var h = window.innerHeight || 900;
      if (w !== inst.viewportWidth || h !== inst.viewportHeight) {
        inst.viewportWidth = w;
        inst.viewportHeight = h;
      }

      if (cappellaLayoutKey(ctx, inst) !== inst.layoutKey) cappellaRebuildLayout(inst, ctx);

      var layout = inst.layout;
      if (!layout) return;

      /* 可见集合只在「当前行 / 可见行 / 表情到点 / 列表变化」时重算，不是每帧。 */
      var vIdx = cappellaVisibleLineIndexAtTime(layout.lines, ctx.time);
      if (vIdx !== inst.visibleLineIndex) {
        inst.visibleLineIndex = vIdx;
        inst.needsVisible = true;
      }
      if (ctx.index !== inst.currentLineIndex) {
        inst.currentLineIndex = ctx.index;
        inst.needsVisible = true;
      }
      var emoCount = 0;
      for (var ei = 0; ei < layout.messages.length; ei++) {
        var em = layout.messages[ei];
        if (em.kind === 'emo' && ctx.time >= em.activationStartTime) emoCount += 1;
      }
      if (emoCount !== inst.emoVisibleCount) {
        inst.emoVisibleCount = emoCount;
        inst.needsVisible = true;
      }
      if (inst.needsVisible) {
        inst.needsVisible = false;
        inst.visible = cappellaGetVisibleMessages(inst, layout, ctx);
        cappellaReconcile(inst, ctx);
      }

      /* 预热下一行的气泡尺寸：开唱那一帧直接查表，不现算。 */
      var upcoming = cappellaUpcomingLine(layout.lines, ctx.index, ctx.time);
      if (upcoming) {
        var lead = upcoming.startTime - ctx.time;
        if (lead >= PREHEAT_MIN_LEAD && lead <= PREHEAT_MAX_LEAD) {
          var motion = layout.motion;
          var fontSize = layout.baseFontSize * motion.activeFontMultiplier;
          cappellaGetOrBuildBubbleMetrics(inst, {
            line: upcoming,
            theme: ctx.theme,
            fontSize: fontSize,
            lineHeightPx: fontSize * BUBBLE_LINE_HEIGHT,
            maxTextWidth: layout.maxTextWidth,
            paddingX: motion.activePaddingX,
            paddingY: motion.activePaddingY
          });
        }
      }

      inst.rows.forEach(function (row) {
        cappellaUpdateRow(inst, row, ctx);
      });

      /* 入场动画结束后摘掉 is-entering：留着会盖住 FLIP 的位移补偿（动画优先于 inline transform）。 */
      var dt = ctx.dt > 0 ? ctx.dt : 1 / 60;
      inst.rows.forEach(function (row) {
        if (row.enterLeft <= 0) return;
        row.enterLeft -= dt;
        if (row.enterLeft <= 0) row.el.classList.remove('is-entering');
      });

      /* 退出行到点就真删 */
      for (var k = inst.exiting.length - 1; k >= 0; k--) {
        var ex = inst.exiting[k];
        ex.exitLeft -= dt;
        if (ex.exitLeft <= 0) {
          if (ex.el && ex.el.parentNode) ex.el.parentNode.removeChild(ex.el);
          inst.exiting.splice(k, 1);
        }
      }

      inst.root.setAttribute('data-folia-cappella-rows', String(inst.rows.size));
      inst.root.setAttribute('data-folia-cappella-visible', String(inst.visible.length));
      inst.root.setAttribute('data-folia-cappella-line', String(ctx.index));
      inst.subtitle.update(ctx, ctx.dt);
    },

    destroy: function (inst) {
      if (!inst) return;
      if (inst.subtitle) inst.subtitle.destroy();
      cappellaClearRows(inst);
      if (inst.metricsCache) inst.metricsCache.clear();
      if (inst.measureCache) inst.measureCache.clear();
      if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
      inst.root = null;
      inst.list = null;
      inst.viewportEl = null;
      inst.layout = null;
      inst.pretext = null;
      inst.rows = null;
      inst.exiting = null;
    }
  });
})();
