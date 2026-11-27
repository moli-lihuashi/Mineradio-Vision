/* Folia 世界 — 歌词样式：隐喻（metaphor）· 排版 / 分镜 / 镜头 / 字形
 *
 * 移植自 Folia 0.8.x 的 metaphorLayout.ts + metaphorProgram.ts + metaphorCamera.ts + metaphorGlyphs.ts。
 *
 * 判据（改一处就整体走形）：
 *   - 排版：一句按词切 token，五种构图（方阵/阶梯/主词/竖排/散置/齐行）；单位是 em，一个字高 = 1
 *   - 分镜：整首编成首尾相接的 cue（一句歌词或一段间奏），每个 cue 里几个**硬切**的镜头，
 *     切点吸到词开唱的时刻；机位按 seed 选，永远正对画面（没有偏航/俯仰，只有平移、远近、绕视线的滚转）
 *   - 镜头：全景 1.1 / 特写 1.3 / 跟字 1.45 / 大特写 0.8 / 留白 1.85 / 拉远三档 / 冲镜三档（0.16s 一格）
 *   - 守字：开唱、跳档这些检查点上，正在唱的词跑出 0.97 视口就硬切平移；挪动小于 0.06 画面短边不动
 *   - 字形：每字 72px + 28px 边距画一次，紧通道（模糊 1）当字形、宽通道（模糊 6 × 1.5）当字周围那团；
 *     笔画密的字（中日韩）用 500 字重、宽通道 × 0.6，免得糊成一团
 *
 * 与上游的差异（输入能力差异，公式未改）：本项目没有 renderHints / isChorus / wordColors，
 * 分别回落 endTime / false / 无关键字着色。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var F = window.FoliaMetaphor = window.FoliaMetaphor || {};
  var paint = F.paint;
  var figures = F.figures;
  if (!paint || !figures) return;

  var SHAPE_STRIDE = paint.constants.SHAPE_STRIDE;
  var SHAPE_CAPACITY = paint.constants.SHAPE_CAPACITY;

  /* ============================== 0. 确定性随机（FNV-1a + mulberry32） ============================== */

  function hashSeed(text) {
    var hash = 2166136261;
    var value = String(text);
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seedRng(seed) {
    var state = hashSeed(seed) || 1;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ============================== 1. 排版（metaphorLayout.ts） ============================== */

  var SPACE_ONLY = /^\s+$/;
  var LINE_HEIGHT = 1.14;

  /* 一句歌词 → token：每个 token 带它那几个字各自的演唱时间。
   * 上游用 buildLineGraphemeTimeline + segmentLyricWords；本项目的行已经是「词 + 词时间」，
   * 词里每个字的时长按字数均分（同一首歌每次都一样）。 */
  function buildTokens(line) {
    line = line || {};
    var tokens = [];
    var start = Number(line.startTime) || 0;
    var end = Number(line.endTime);
    if (!isFinite(end) || end <= start) end = start + Math.max(0.6, String(line.fullText || '').length * 0.18);
    var words = Array.isArray(line.words) ? line.words : [];
    if (words.length) {
      for (var i = 0; i < words.length; i += 1) {
        var word = words[i] || {};
        var text = String(word.text == null ? '' : word.text);
        if (!text) continue;
        var chars = Array.from(text);
        var w0 = Number(word.startTime);
        var w1 = Number(word.endTime);
        if (!isFinite(w0)) w0 = start;
        if (!isFinite(w1) || w1 <= w0) w1 = w0 + Math.max(0.12, chars.length * 0.16);
        var step = (w1 - w0) / Math.max(1, chars.length);
        tokens.push({
          text: text,
          chars: chars.map(function (char, index) {
            return { char: char, t0: w0 + step * index, t1: w0 + step * (index + 1) };
          }),
          wordLike: !SPACE_ONLY.test(text),
          space: SPACE_ONLY.test(text)
        });
      }
      if (tokens.length) return tokens;
    }
    var plain = String(line.fullText || '');
    if (!plain) return [];
    var plainChars = Array.from(plain);
    var plainStep = (end - start) / Math.max(1, plainChars.length);
    return [{
      text: plain,
      chars: plainChars.map(function (char, index) {
        return { char: char, t0: start + plainStep * index, t1: start + plainStep * (index + 1) };
      }),
      wordLike: true,
      space: false
    }];
  }

  /* 没有时间的文字（曲名卡）→ token：全部在 time 这一刻就唱完。 */
  function buildTextTokens(text, time) {
    var parts = String(text || '').split(/(\s+)/).filter(function (part) { return part.length > 0; });
    var tokens = [];
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      var chars = Array.from(part);
      if (!chars.length) continue;
      tokens.push({
        text: part,
        chars: chars.map(function (char) { return { char: char, t0: time, t1: time }; }),
        wordLike: !SPACE_ONLY.test(part),
        space: SPACE_ONLY.test(part)
      });
    }
    return tokens;
  }

  function clampNumber(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function tokenAdvance(token, measure) {
    return token.chars.reduce(function (sum, item) { return sum + measure(item.char); }, 0);
  }

  function wrapRows(tokens, widths, maxWidth) {
    var rows = [];
    var row = [];
    var width = 0;
    tokens.forEach(function (token, index) {
      if (row.length === 0 && token.space) return;
      if (row.length > 0 && !token.space && width + widths[index] > maxWidth) {
        rows.push(row);
        row = [];
        width = 0;
      }
      row.push(index);
      width += widths[index];
    });
    if (row.length > 0) rows.push(row);
    return rows.map(function (indices) {
      var trimmed = indices.slice();
      while (trimmed.length > 0 && tokens[trimmed[trimmed.length - 1]].space) trimmed.pop();
      return trimmed;
    }).filter(function (indices) { return indices.length > 0; });
  }

  function rowWidth(row, widths, sizes) {
    return row.reduce(function (sum, index) { return sum + widths[index] * sizes[index]; }, 0);
  }

  function placeRows(rows, input, widths, sizes, rowLeft, tokenRot) {
    var placed = [];
    var top = 0;
    rows.forEach(function (row, rowIndex) {
      var height = Math.max.apply(null, row.map(function (index) { return sizes[index]; })) * LINE_HEIGHT;
      var x = rowLeft(rowWidth(row, widths, sizes), rowIndex);
      row.forEach(function (index) {
        var width = widths[index] * sizes[index];
        placed.push({ token: input.tokens[index], index: index, x: x, y: top - height / 2, size: sizes[index], rot: tokenRot(index), width: width });
        x += width;
      });
      top -= height;
    });
    return placed;
  }

  function flatRot() { return 0; }

  function placeBlock(input, widths, total) {
    var sizes = widths.map(function () { return 1; });
    var rows = wrapRows(input.tokens, widths, clampNumber(Math.sqrt(total * 2.2), 3.5, 11));
    return placeRows(rows, input, widths, sizes, function (width) { return -width / 2; }, flatRot);
  }

  function placeStair(input, widths, total) {
    var sizes = widths.map(function () { return 1; });
    var rows = wrapRows(input.tokens, widths, clampNumber(Math.sqrt(total * 1.4), 3, 8));
    var step = 0.7 + input.rng() * 0.6;
    return placeRows(rows, input, widths, sizes, function (_width, rowIndex) { return rowIndex * step; }, flatRot);
  }

  function placeHero(input, widths, total) {
    var tokens = input.tokens;
    var hero = -1;
    tokens.forEach(function (token, index) {
      if (token.wordLike && (hero < 0 || widths[index] >= widths[hero])) hero = index;
    });
    if (hero < 0) return placeBlock(input, widths, total);
    var heroSize = clampNumber(7 / Math.max(widths[hero], 0.5), 1.6, 3);
    var heroWidth = widths[hero] * heroSize;
    var sizes = widths.map(function (_, index) { return index === hero ? heroSize : 1; });
    var sideWidth = Math.max(heroWidth, 4.5);
    var before = wrapRows(tokens.slice(0, hero), widths.slice(0, hero), sideWidth);
    var after = wrapRows(tokens.slice(hero + 1), widths.slice(hero + 1), sideWidth).map(function (row) {
      return row.map(function (index) { return index + hero + 1; });
    });
    var rows = before.concat([[hero]], after);
    return placeRows(rows, input, widths, sizes, function (width, rowIndex) {
      return rowIndex <= before.length ? 0 : heroWidth - width;
    }, flatRot);
  }

  function placeScatter(input, widths, total) {
    var sizes = input.tokens.map(function (token) { return token.wordLike ? 0.8 + input.rng() * 0.8 : 1; });
    var scaled = widths.map(function (width, index) { return width * sizes[index]; });
    var rows = wrapRows(input.tokens, scaled, clampNumber(Math.sqrt(total * 2), 3.5, 9));
    var rots = input.tokens.map(function (token) { return token.space ? 0 : (input.rng() - 0.5) * 0.18; });
    var shifts = rows.map(function () { return (input.rng() - 0.5) * 2.2; });
    return placeRows(rows, input, widths, sizes, function (width, rowIndex) { return -width / 2 + shifts[rowIndex]; }, function (index) { return rots[index]; });
  }

  var JUSTIFY_MAX = 2.6;

  function placeJustify(input, widths, total) {
    var rows = wrapRows(input.tokens, widths, clampNumber(Math.sqrt(total * 1.5), 3, 8));
    var unit = widths.map(function () { return 1; });
    var rowWidths = rows.map(function (row) { return rowWidth(row, widths, unit); });
    var target = Math.max.apply(null, rowWidths);
    var sizes = unit.slice();
    rows.forEach(function (row, rowIndex) {
      var size = clampNumber(target / Math.max(0.5, rowWidths[rowIndex]), 1, JUSTIFY_MAX);
      row.forEach(function (index) { sizes[index] = size; });
    });
    return placeRows(rows, input, widths, sizes, function (width, rowIndex) {
      return rowIndex % 2 === 0 ? -target / 2 : target / 2 - width;
    }, flatRot);
  }

  var COLUMN_MAX = 6;
  var COLUMN_PITCH = 1.08;
  var COLUMN_GAP = 1.3;

  function buildLayout(input) {
    var tokens = input.tokens;
    var measure = input.measure;
    var rng = input.rng;
    var widths = tokens.map(function (token) { return tokenAdvance(token, measure); });
    var total = widths.reduce(function (sum, width) { return sum + width; }, 0);
    var glyphs = [];
    var words = [];
    var tints = tokens.map(function (token, index) {
      if (token.space) return null;
      var list = input.tints;
      return (list && list[index]) || null;
    });
    var accents = tokens.map(function (token, index) {
      if (token.space) return false;
      if (tints[index] !== null) return true;
      return !!(input.isAccent && input.isAccent(token.text.trim()));
    });

    function pushWord(slots, accent, tint) {
      if (slots.length === 0) return;
      var word = words.length;
      var rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, t0: Infinity, t1: -Infinity };
      for (var i = 0; i < slots.length; i += 1) {
        var slot = slots[i];
        rect.x0 = Math.min(rect.x0, slot.x - slot.half);
        rect.x1 = Math.max(rect.x1, slot.x + slot.half);
        rect.y0 = Math.min(rect.y0, slot.y - slot.size * 0.55);
        rect.y1 = Math.max(rect.y1, slot.y + slot.size * 0.55);
        rect.t0 = Math.min(rect.t0, slot.t0);
        rect.t1 = Math.max(rect.t1, slot.t1);
        glyphs.push({ char: slot.char, x: slot.x, y: slot.y, size: slot.size, rot: slot.rot, t0: slot.t0, t1: slot.t1, word: word, accent: accent, tint: tint, seed: rng() });
      }
      words.push(rect);
    }

    if (input.composition === 'column') {
      var cells = [];
      tokens.forEach(function (token, index) {
        if (token.space) return;
        token.chars.forEach(function (item) { cells.push({ item: item, index: index }); });
      });
      var columns = Math.max(1, Math.ceil(cells.length / COLUMN_MAX));
      var perColumn = Math.ceil(cells.length / columns);
      var byToken = [];
      cells.forEach(function (cell, order) {
        var column = Math.floor(order / perColumn);
        var slot = {
          char: cell.item.char, t0: cell.item.t0, t1: cell.item.t1,
          x: -column * COLUMN_GAP, y: -(order % perColumn) * COLUMN_PITCH - column * 0.5, size: 1, rot: 0, half: 0.5
        };
        if (byToken[cell.index]) byToken[cell.index].push(slot);
        else byToken[cell.index] = [slot];
      });
      byToken.forEach(function (slots, index) { pushWord(slots, accents[index], tints[index]); });
    } else {
      var place = { block: placeBlock, stair: placeStair, hero: placeHero, scatter: placeScatter, justify: placeJustify }[input.composition] || placeBlock;
      var placedList = place(input, widths, total);
      for (var p = 0; p < placedList.length; p += 1) {
        var placed = placedList[p];
        if (placed.token.space) continue;
        var centerX = placed.x + placed.width / 2;
        var cos = Math.cos(placed.rot);
        var sin = Math.sin(placed.rot);
        var pen = placed.x;
        var slotsOut = placed.token.chars.map(function (item) {
          var advance = measure(item.char) * placed.size;
          var dx = pen + advance / 2 - centerX;
          pen += advance;
          return { char: item.char, t0: item.t0, t1: item.t1, x: centerX + dx * cos, y: placed.y + dx * sin, size: placed.size, rot: placed.rot, half: advance / 2 };
        });
        pushWord(slotsOut, accents[placed.index], tints[placed.index]);
      }
    }

    if (words.length === 0) {
      return { composition: input.composition, glyphs: glyphs, words: words, bounds: { x0: -1, y0: -0.5, x1: 1, y1: 0.5 } };
    }
    var bounds = words.reduce(function (box, word) {
      return {
        x0: Math.min(box.x0, word.x0), y0: Math.min(box.y0, word.y0),
        x1: Math.max(box.x1, word.x1), y1: Math.max(box.y1, word.y1)
      };
    }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    var cx = (bounds.x0 + bounds.x1) / 2;
    var cy = (bounds.y0 + bounds.y1) / 2;
    glyphs.forEach(function (glyph) { glyph.x -= cx; glyph.y -= cy; });
    words.forEach(function (word) { word.x0 -= cx; word.x1 -= cx; word.y0 -= cy; word.y1 -= cy; });
    return { composition: input.composition, glyphs: glyphs, words: words, bounds: { x0: bounds.x0 - cx, y0: bounds.y0 - cy, x1: bounds.x1 - cx, y1: bounds.y1 - cy } };
  }

  /* ============================== 2. 分镜表（metaphorProgram.ts） ============================== */

  var PREROLL = 0.6;
  var TAIL = 2;
  var INTERLUDE_MIN = 2.4;
  var MIN_SHOT = 0.6;
  var MIN_CUE = 0.15;
  var LOOP_SECONDS = 48;
  var INTERLUDE_SEGMENT = 24;
  var INTERLUDE_SPLIT = 36;
  var INTERLUDE_HORIZON = 720;

  var INTENSITY_PACE = { calm: 0.75, normal: 1, chaotic: 1.3 };
  var SAME_ONSET = 0.3;
  var SCREEN_ANGLES = [0.26, 0.52, 0.79, 1.31];
  var CJK = /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uFF66-\uFF9F]/;

  var FIRST_SHOT = { wide: 3, close: 2, dutch: 1.5, void: 0.8, follow: 1.5 };
  var MIDDLE_SHOT = { close: 3, follow: 2, macro: 2, dutch: 1.5, wide: 1, void: 0.6 };
  var INTERLUDE_SHOT = { void: 3, macro: 2, pullback: 1.5, wide: 1.5, dutch: 1 };

  function pickWeighted(rng, weights, avoid) {
    var entries = [];
    for (var key in weights) {
      if (!Object.prototype.hasOwnProperty.call(weights, key)) continue;
      if (weights[key] > 0 && key !== avoid) entries.push([key, weights[key]]);
    }
    var pool = entries.length > 0 ? entries : Object.keys(weights).map(function (name) { return [name, weights[name]]; });
    var total = pool.reduce(function (sum, entry) { return sum + entry[1]; }, 0);
    var roll = rng() * total;
    for (var i = 0; i < pool.length; i += 1) {
      roll -= pool[i][1];
      if (roll <= 0) return pool[i][0];
    }
    return pool[pool.length - 1][0];
  }

  function spanOf(rng, min, max) { return min + rng() * (max - min); }
  function signOf(rng) { return rng() < 0.5 ? -1 : 1; }

  function shotPose(kind, rng) {
    switch (kind) {
      case 'wide': return { roll: spanOf(rng, -0.05, 0.05), offsetX: 0, offsetY: 0 };
      case 'close': return { roll: spanOf(rng, -0.07, 0.07), offsetX: spanOf(rng, -0.08, 0.08), offsetY: spanOf(rng, -0.05, 0.05) };
      case 'follow': return { roll: spanOf(rng, -0.03, 0.03), offsetX: 0, offsetY: 0 };
      case 'macro': return { roll: signOf(rng) * spanOf(rng, 0.25, 0.6), offsetX: spanOf(rng, -0.12, 0.12), offsetY: spanOf(rng, -0.12, 0.12) };
      case 'dutch': return { roll: signOf(rng) * spanOf(rng, 0.2, 0.4), offsetX: spanOf(rng, -0.1, 0.1), offsetY: 0 };
      case 'void': return { roll: spanOf(rng, -0.04, 0.04), offsetX: signOf(rng) * spanOf(rng, 0.18, 0.3), offsetY: signOf(rng) * spanOf(rng, 0.1, 0.22) };
      case 'pullback': return { roll: spanOf(rng, -0.1, 0.1), offsetX: 0, offsetY: 0 };
      case 'pushin': return { roll: spanOf(rng, -0.12, 0.12), offsetX: 0, offsetY: 0 };
      default: return { roll: 0, offsetX: 0, offsetY: 0 };
    }
  }

  function makeShot(context, start, end, kind) {
    var rng = context.rng;
    var chance = context.negative ? (context.chorus ? 0.34 : 0.2) : 0;
    var roll = rng();
    var invert = context.inverted < 2 && roll < chance;
    context.inverted = invert ? context.inverted + 1 : 0;
    context.lastKind = kind;
    var angle = SCREEN_ANGLES[Math.floor(rng() * SCREEN_ANGLES.length)];
    if (angle === context.lastAngle) angle = SCREEN_ANGLES[(SCREEN_ANGLES.indexOf(angle) + 1) % SCREEN_ANGLES.length];
    context.lastAngle = angle;
    var pose = shotPose(kind, rng);
    return { start: start, end: end, kind: kind, roll: pose.roll, offsetX: pose.offsetX, offsetY: pose.offsetY, invert: invert, screenAngle: angle, seed: rng() };
  }

  function planCuts(start, end, count, onsets) {
    var cuts = [];
    var spacing = (end - start) / count;
    for (var index = 1; index < count; index += 1) {
      var ideal = start + spacing * index;
      var near = onsets.reduce(function (best, onset) { return Math.abs(onset - ideal) < Math.abs(best - ideal) ? onset : best; }, Number.POSITIVE_INFINITY);
      var at = Math.abs(near - ideal) <= spacing * 0.4 ? near : ideal;
      var previous = cuts.length > 0 ? cuts[cuts.length - 1] : start;
      if (at - previous >= MIN_SHOT && end - at >= MIN_SHOT) cuts.push(at);
    }
    return cuts;
  }

  function lineShots(context, cue, line, pace) {
    var duration = cue.end - cue.start;
    var count = Math.max(1, Math.min(7, Math.round((duration * pace * (context.chorus ? 1.25 : 1)) / 2.6)));
    var onsets = (line.words || []).map(function (word) { return word.startTime; })
      .filter(function (time) { return time > cue.start + MIN_SHOT && time < cue.end - MIN_SHOT; });
    var edges = [cue.start].concat(planCuts(cue.start, cue.end, count, onsets), [cue.end]);
    var shots = [];
    for (var index = 0; index < edges.length - 1; index += 1) {
      var start = edges[index];
      var end = edges[index + 1];
      var last = index === edges.length - 2;
      var weights = index === 0 ? FIRST_SHOT : MIDDLE_SHOT;
      if (index === 0 && cue.transition === 'smash') {
        shots.push(makeShot(context, start, end, 'pushin'));
        continue;
      }
      if (last && index > 0 && end - start >= 1.4) {
        weights = { close: weights.close, follow: weights.follow, macro: weights.macro, dutch: weights.dutch, wide: weights.wide, void: weights.void, pullback: 5 };
      }
      if (context.chorus) {
        weights = { close: weights.close, follow: weights.follow, macro: (weights.macro || 0) + 1.5, dutch: (weights.dutch || 0) + 1, wide: weights.wide, void: weights.void, pullback: weights.pullback };
      }
      shots.push(makeShot(context, start, end, pickWeighted(context.rng, weights, context.lastKind)));
    }
    return shots;
  }

  function interludeShots(context, start, end, pace) {
    var shots = [];
    var at = start;
    while (end - at > 0.01) {
      var length = spanOf(context.rng, 4.5, 8) / pace;
      var next = end - (at + length) < 2.5 ? end : at + length;
      shots.push(makeShot(context, at, next, pickWeighted(context.rng, INTERLUDE_SHOT, context.lastKind)));
      at = next;
    }
    return shots;
  }

  function pickComposition(rng, text, previous) {
    var chars = Array.from(String(text || '').replace(/\s+/g, ''));
    var cjk = chars.filter(function (char) { return CJK.test(char); }).length / Math.max(1, chars.length);
    var words = cjk > 0.5 ? chars.length / 2 : String(text || '').trim().split(/\s+/).length;
    return pickWeighted(rng, {
      block: 2,
      justify: words >= 3 ? 3 : 0,
      stair: chars.length >= 6 ? 2 : 0,
      hero: words >= 2 ? 2.5 : 0,
      column: cjk > 0.7 && chars.length >= 2 && chars.length <= 16 ? 2 : 0,
      scatter: words >= 3 ? 1.5 : 0
    }, previous);
  }

  function pickTransition(rng, enabled, intoChorus) {
    if (!enabled) return 'cut';
    return intoChorus
      ? pickWeighted(rng, { flood: 3, smash: 3, cut: 1.5 })
      : pickWeighted(rng, { cut: 5.5, flood: 1.5, smash: 1.2 });
  }

  function sungLines(lines) {
    var kept = [];
    (lines || []).map(function (line, lineIndex) { return { line: line, lineIndex: lineIndex }; })
      .filter(function (entry) { return /[A-Za-z0-9\u00C0-\u024F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(String(entry.line.fullText || '')) && isFinite(entry.line.startTime); })
      .sort(function (a, b) { return a.line.startTime - b.line.startTime || a.lineIndex - b.lineIndex; })
      .forEach(function (entry) {
        var previous = kept.length ? kept[kept.length - 1] : null;
        if (!previous || entry.line.startTime - previous.line.startTime >= SAME_ONSET) kept.push(entry);
      });
    return kept;
  }

  function compileProgram(lines, options) {
    var rng = seedRng('metaphor:' + options.seed);
    var composeRng = seedRng('metaphor:' + options.seed + ':compose');
    var transitionRng = seedRng('metaphor:' + options.seed + ':transition');
    var splitRng = seedRng('metaphor:' + options.seed + ':split');
    var pace = options.cutPace * (INTENSITY_PACE[options.intensity] || 1);
    var context = { rng: rng, negative: options.negative, chorus: false, inverted: 0, lastKind: null, lastAngle: -1 };
    var cues = [];
    var title = String(options.title || '').trim();

    function pushInterludeCue(start, end, text, loop) {
      context.chorus = false;
      var shotsEnd = loop > 0 ? start + loop : end;
      cues.push({
        lineIndex: -1, start: start, end: end, singStart: start, singEnd: end, composition: 'block',
        shots: interludeShots(context, start, shotsEnd, pace),
        transition: cues.length === 0 ? 'cut' : pickTransition(transitionRng, options.transitions, false),
        chorus: false, text: text, loop: loop || 0
      });
    }

    function pushInterlude(start, end, text) {
      var endless = !isFinite(end);
      var stop = endless ? start + INTERLUDE_HORIZON : end;
      var length = stop - start;
      var count = length > INTERLUDE_SPLIT ? Math.round(length / INTERLUDE_SEGMENT) : 1;
      var from = start;
      for (var index = 1; index <= count; index += 1) {
        var to = index === count ? stop : start + (length * index) / count + (splitRng() - 0.5) * 6;
        pushInterludeCue(from, to, index === 1 ? text : '');
        from = to;
      }
      if (endless) pushInterludeCue(stop, Number.POSITIVE_INFINITY, '', LOOP_SECONDS);
    }

    var sung = sungLines(lines);
    if (sung.length === 0) {
      pushInterlude(0, Number.POSITIVE_INFINITY, title);
      return { cues: cues };
    }

    var cursor = 0;
    var composition = null;
    sung.forEach(function (entry, order) {
      var line = entry.line;
      var begin = Math.max(cursor, line.startTime - PREROLL);
      if (begin - cursor >= INTERLUDE_MIN || (order === 0 && begin - cursor >= 1.2)) {
        pushInterlude(cursor, begin, order === 0 ? title : '');
        cursor = begin;
      }
      var start = cursor;
      var next = order + 1 < sung.length ? sung[order + 1].line : null;
      var singEnd = isFinite(line.endTime) ? Math.max(line.endTime, line.startTime + 0.2) : line.startTime + 0.2;
      var hold = singEnd + TAIL;
      var nextBegin = next ? next.startTime - PREROLL : Number.POSITIVE_INFINITY;
      var end = nextBegin - hold >= INTERLUDE_MIN ? hold : Math.max(nextBegin, start);
      if (end - start < MIN_CUE) return;
      var chorus = Boolean(line.isChorus);
      var transition = cues.length === 0 ? 'cut' : pickTransition(transitionRng, options.transitions, chorus && !context.chorus);
      context.chorus = chorus;
      composition = pickComposition(composeRng, line.fullText, composition);
      var cue = { lineIndex: entry.lineIndex, start: start, end: end, singStart: line.startTime, singEnd: singEnd, composition: composition, shots: [], transition: transition, chorus: chorus, text: '', loop: 0 };
      cue.shots = lineShots(context, cue, line, pace);
      cues.push(cue);
      cursor = end;
    });
    pushInterlude(cursor, Number.POSITIVE_INFINITY, '');
    return { cues: cues };
  }

  function findCue(program, time) {
    var cues = program.cues;
    var low = 0;
    var high = cues.length - 1;
    while (low < high) {
      var middle = (low + high + 1) >> 1;
      if (cues[middle].start <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function resolveCueTime(cue, time) {
    return cue.loop > 0 ? cue.start + (((time - cue.start) % cue.loop) + cue.loop) % cue.loop : time;
  }

  function findShot(cue, cueTime) {
    var shots = cue.shots;
    for (var index = shots.length - 1; index > 0; index -= 1) {
      if (shots[index].start <= cueTime) return shots[index];
    }
    return shots[0];
  }

  /* ============================== 3. 镜头（metaphorCamera.ts） ============================== */

  var FOV = 30;
  var EMPTY_STAGE = { x0: -4.5, y0: -2.6, x1: 4.5, y1: 2.6 };
  var WIDE_MARGIN = 1.1;
  var PULLBACK_STEPS = 3;
  var PUSHIN_STEPS = 3;
  var MACRO_MARGIN = 0.8;
  var CLOSE_MARGIN = 1.3;
  var MACRO_FOLLOW_ROLL = 0.12;
  var PUSHIN_BEAT = 0.16;
  var KEEP_OUT = 0.97;
  var KEEP_IN = 0.9;
  var MIN_SHIFT = 0.06;
  var LOOK_AHEAD = { close: true, pushin: true };
  var MIN_SUNG = 0.3;

  function clamp01(value) { return Math.min(1, Math.max(0, value)); }
  function lerp(from, to, amount) { return from + (to - from) * amount; }
  function easeOutCubic(u) { return 1 - Math.pow(1 - u, 3); }

  function rectFocus(rect) {
    return {
      x: (rect.x0 + rect.x1) / 2,
      y: (rect.y0 + rect.y1) / 2,
      width: Math.max(1.6, rect.x1 - rect.x0),
      height: Math.max(1.2, rect.y1 - rect.y0)
    };
  }

  function wordIndexAt(layout, time) {
    var found = 0;
    var latest = Number.NEGATIVE_INFINITY;
    layout.words.forEach(function (word, index) {
      if (word.t0 <= time && word.t0 >= latest) {
        latest = word.t0;
        found = index;
      }
    });
    return found;
  }

  function emptyFocus(bounds, seed) {
    var width = bounds.x1 - bounds.x0;
    var height = bounds.y1 - bounds.y0;
    return {
      x: bounds.x0 + width * (0.2 + 0.6 * seed),
      y: bounds.y0 + height * (0.2 + 0.6 * ((seed * 7.31) % 1)),
      width: width * 0.3,
      height: height * 0.3
    };
  }

  function wordFocus(layout, time, seed) {
    if (layout.words.length === 0) return emptyFocus(layout.bounds, seed);
    return rectFocus(layout.words[wordIndexAt(layout, time)]);
  }

  function glyphAt(layout, time) {
    var found = layout.glyphs[0];
    for (var i = 0; i < layout.glyphs.length; i += 1) {
      var glyph = layout.glyphs[i];
      if (glyph.t0 <= time && glyph.t0 >= found.t0) found = glyph;
    }
    return found;
  }

  function glyphFocus(layout, time, seed) {
    if (layout.glyphs.length === 0) return emptyFocus(layout.bounds, seed);
    var found = glyphAt(layout, time);
    return { x: found.x, y: found.y, width: found.size * 0.9, height: found.size * 0.9 };
  }

  function macroWord(layout, shot) {
    return layout.glyphs.length === 0 ? -1 : glyphAt(layout, shot.start).word;
  }

  function macroFollowWord(layout, shot, time) {
    var anchor = macroWord(layout, shot);
    if (anchor < 0) return -1;
    var current = wordIndexAt(layout, time);
    return current !== anchor && layout.words[current].t0 > layout.words[anchor].t0 ? current : -1;
  }

  function fitDistance(focus, margin, aspect) {
    return (Math.max(focus.height / 2, focus.width / (2 * Math.max(0.2, aspect))) * margin) / Math.tan((FOV * Math.PI) / 360);
  }

  function stepAt(shot, layout, time, steps) {
    var seen = {};
    var onsets = [];
    layout.words.forEach(function (word) {
      if (seen[word.t0]) return;
      seen[word.t0] = true;
      if (word.t0 > shot.start + 0.3 && word.t0 < shot.end - 0.3) onsets.push(word.t0);
    });
    onsets.sort(function (a, b) { return a - b; });
    var times = [];
    if (onsets.length >= steps) {
      for (var index = 0; index < steps; index += 1) times.push(onsets[Math.floor((index * onsets.length) / steps)]);
    } else {
      for (var step = 1; step <= steps; step += 1) times.push(shot.start + ((shot.end - shot.start) * step) / (steps + 1));
    }
    return times.filter(function (at) { return at <= time; }).length;
  }

  function wobble(time, phase) { return Math.sin(time * 0.23 + phase) * 0.6 + Math.sin(time * 0.37 + phase * 2.3) * 0.4; }

  function plannedPose(input) {
    var shot = input.shot;
    var layout = input.layout;
    var time = input.time;
    var aspect = input.aspect;
    var motion = input.motion;
    var u = clamp01((time - shot.start) / Math.max(0.001, shot.end - shot.start));
    var creep = 1 - 0.035 * motion * u;
    var whole = rectFocus(layout.bounds);
    var focus = whole;
    var distance;
    var roll = shot.roll;
    switch (shot.kind) {
      case 'wide':
        distance = fitDistance(whole, WIDE_MARGIN, aspect) * creep;
        break;
      case 'close':
        focus = wordFocus(layout, shot.start, shot.seed);
        distance = fitDistance(focus, CLOSE_MARGIN, aspect) * creep;
        break;
      case 'follow':
        focus = wordFocus(layout, time, shot.seed);
        distance = fitDistance(focus, 1.45, aspect);
        break;
      case 'macro': {
        var following = macroFollowWord(layout, shot, time);
        if (following >= 0) {
          focus = rectFocus(layout.words[following]);
          distance = fitDistance(focus, CLOSE_MARGIN, aspect) * creep;
          roll *= MACRO_FOLLOW_ROLL;
          break;
        }
        focus = glyphFocus(layout, shot.start, shot.seed);
        distance = fitDistance(focus, MACRO_MARGIN, aspect) * creep;
        roll += 0.03 * motion * (u - 0.5);
        break;
      }
      case 'dutch':
        distance = fitDistance(whole, 1.1, aspect) * creep;
        break;
      case 'void':
        distance = fitDistance(whole, 1.85, aspect) * (2 - creep);
        break;
      case 'pullback': {
        var near = wordFocus(layout, shot.start, shot.seed);
        var out = stepAt(shot, layout, time, PULLBACK_STEPS) / PULLBACK_STEPS;
        focus = { x: lerp(near.x, whole.x, out), y: lerp(near.y, whole.y, out), width: whole.width, height: whole.height };
        distance = lerp(fitDistance(near, 1.15, aspect), fitDistance(whole, 1.4, aspect), out);
        break;
      }
      case 'pushin': {
        var target = wordFocus(layout, shot.start, shot.seed);
        var into = Math.min(PUSHIN_STEPS, Math.floor(Math.max(0, time - shot.start) / PUSHIN_BEAT)) / PUSHIN_STEPS;
        focus = { x: lerp(whole.x, target.x, into), y: lerp(whole.y, target.y, into), width: target.width, height: target.height };
        distance = lerp(fitDistance(whole, 3.2, aspect), fitDistance(target, 1.3, aspect), into) * creep;
        break;
      }
      default:
        distance = fitDistance(whole, WIDE_MARGIN, aspect) * creep;
    }
    var visible = 2 * distance * Math.tan((FOV * Math.PI) / 360);
    var phase = shot.seed * 40;
    var drift = 0.008 * motion * visible;
    return {
      x: focus.x - shot.offsetX * visible + wobble(time, phase) * drift,
      y: focus.y - shot.offsetY * visible + wobble(time, phase + 11) * drift,
      distance: distance,
      roll: roll + wobble(time, phase + 23) * 0.004 * motion,
      fov: FOV
    };
  }

  function frameOf(pose, rect, aspect, inner) {
    var halfHeight = pose.distance * Math.tan((pose.fov * Math.PI) / 360);
    var half = [halfHeight * aspect * inner, halfHeight * inner];
    var cos = Math.cos(pose.roll);
    var sin = Math.sin(pose.roll);
    var low = [Infinity, Infinity];
    var high = [-Infinity, -Infinity];
    [rect.x0, rect.x1].forEach(function (x) {
      [rect.y0, rect.y1].forEach(function (y) {
        var dx = x - pose.x;
        var dy = y - pose.y;
        var along = [dx * cos + dy * sin, -dx * sin + dy * cos];
        for (var axis = 0; axis < 2; axis += 1) {
          low[axis] = Math.min(low[axis], along[axis]);
          high[axis] = Math.max(high[axis], along[axis]);
        }
      });
    });
    return { half: half, low: low, high: high };
  }

  function fitsWithin(pose, rect, aspect, inner) {
    var box = frameOf(pose, rect, aspect, inner);
    return box.high[0] - box.low[0] <= 2 * box.half[0] && box.high[1] - box.low[1] <= 2 * box.half[1];
  }

  function placeTarget(shot, order, unit, poses, aspect) {
    if (!LOOK_AHEAD[shot.kind]) return unit;
    var target = unit;
    for (var index = order.indexOf(unit) + 1; index < order.length; index += 1) {
      var next = order[index];
      var grown = {
        x0: Math.min(target.x0, next.x0), y0: Math.min(target.y0, next.y0),
        x1: Math.max(target.x1, next.x1), y1: Math.max(target.y1, next.y1)
      };
      var fits = true;
      for (var p = 0; p < poses.length; p += 1) if (!fitsWithin(poses[p], grown, aspect, KEEP_IN)) fits = false;
      if (!fits) break;
      target = grown;
    }
    return target;
  }

  function fitShift(pose, unit, aspect, inner, out) {
    var box = frameOf(pose, unit, aspect, inner);
    var shift = [0, 0];
    for (var axis = 0; axis < 2; axis += 1) {
      var size = box.high[axis] - box.low[axis];
      var full = box.half[axis] / inner;
      if (size > 2 * full) {
        var room = box.half[axis] * 0.5;
        var center = (box.low[axis] + box.high[axis]) / 2;
        shift[axis] = center > room ? center - room : center < -room ? center + room : 0;
      } else {
        var limit = Math.max(box.half[axis], size / 2);
        shift[axis] = box.high[axis] > limit ? box.high[axis] - limit : box.low[axis] < -limit ? box.low[axis] + limit : 0;
      }
    }
    out.x = shift[0];
    out.y = shift[1];
    return out;
  }

  function checkpoints(shot, units) {
    var times = units.map(function (unit) { return unit.t0; });
    if (shot.kind === 'pullback') {
      for (var step = 1; step <= PULLBACK_STEPS; step += 1) times.push(shot.start + ((shot.end - shot.start) * step) / (PULLBACK_STEPS + 1));
    }
    if (shot.kind === 'pushin') times.push(shot.start + PUSHIN_STEPS * PUSHIN_BEAT);
    var unique = [];
    times.forEach(function (at) { if (at > shot.start && unique.indexOf(at) < 0) unique.push(at); });
    unique.sort(function (a, b) { return a - b; });
    return [shot.start].concat(unique);
  }

  var tracks = [];

  /* 拆掉一套 cue 之后要清掉它留下的守字轨道：track 里存着 layout 的引用，
   * 不清就会随着每个 cue 重建一直攒下去（拖进度条时尤其快）。 */
  function clearTracks() { tracks.length = 0; }

  function trackFor(input) {
    var shot = input.shot;
    var layout = input.layout;
    var time = input.time;
    var aspect = input.aspect;
    var motion = input.motion;
    var track = null;
    for (var i = 0; i < tracks.length; i += 1) if (tracks[i].layout === layout) track = tracks[i];
    if (track && track.shot === shot && track.aspect === aspect && track.motion === motion
      && time >= (track.next > 0 ? track.times[track.next - 1] : shot.start)) return track;
    var units = layout.words;
    var anchor = shot.kind === 'macro' ? macroWord(layout, shot) : -1;
    var fresh = {
      layout: layout, shot: shot, aspect: aspect, motion: motion, units: units,
      skip: anchor >= 0 ? units[anchor] : null,
      order: units.slice().sort(function (a, b) { return a.t0 - b.t0; }),
      times: checkpoints(shot, units), next: 0, still: null, shiftX: 0, shiftY: 0
    };
    tracks = tracks.filter(function (item) { return item.layout !== layout; });
    tracks.push(fresh);
    return fresh;
  }

  function shiftPose(pose, shiftX, shiftY) {
    if (shiftX === 0 && shiftY === 0) return pose;
    var cos = Math.cos(pose.roll);
    var sin = Math.sin(pose.roll);
    return { x: pose.x + shiftX * cos - shiftY * sin, y: pose.y + shiftX * sin + shiftY * cos, distance: pose.distance, roll: pose.roll, fov: pose.fov };
  }

  function outside(pose, unit, aspect, out) {
    fitShift(pose, unit, aspect, KEEP_OUT, out);
    return out.x !== 0 || out.y !== 0;
  }

  function sungUnitAt(units, at) {
    var found = null;
    for (var i = 0; i < units.length; i += 1) {
      var unit = units[i];
      if (unit.t0 <= at && (!found || unit.t0 >= found.t0)) found = unit;
    }
    return found && at < Math.max(found.t1, found.t0 + MIN_SUNG) ? found : null;
  }

  var need = { x: 0, y: 0 };

  function advanceTrack(track, input) {
    var shot = input.shot;
    var aspect = input.aspect;
    var at = track.times[track.next];
    track.next += 1;
    var stillInput = { shot: input.shot, layout: input.layout, time: at, aspect: input.aspect, motion: 0 };
    var still = plannedPose(stillInput);
    var previous = track.still;
    track.still = still;
    if (previous && (still.x !== previous.x || still.y !== previous.y || still.distance !== previous.distance)) {
      track.shiftX = 0;
      track.shiftY = 0;
    }
    var unit = sungUnitAt(track.units, at);
    if (!unit || unit === track.skip) return;
    var planned = plannedPose({ shot: shot, layout: input.layout, time: at, aspect: aspect, motion: input.motion });
    var untilTime = Math.min(track.times[track.next] == null ? shot.end : track.times[track.next], Math.max(unit.t1, unit.t0 + MIN_SUNG), shot.end) - 1e-3;
    var later = untilTime > at
      ? plannedPose({ shot: shot, layout: input.layout, time: untilTime, aspect: aspect, motion: input.motion })
      : planned;
    if (!outside(shiftPose(planned, track.shiftX, track.shiftY), unit, aspect, need)
      && !outside(shiftPose(later, track.shiftX, track.shiftY), unit, aspect, need)) return;
    fitShift(planned, placeTarget(shot, track.order, unit, [planned, later], aspect), aspect, KEEP_IN, need);
    if (outside(shiftPose(later, need.x, need.y), unit, aspect, { x: 0, y: 0 })) fitShift(later, unit, aspect, KEEP_IN, need);
    var visible = 2 * planned.distance * Math.tan((planned.fov * Math.PI) / 360) * Math.min(1, aspect);
    if (Math.hypot(need.x - track.shiftX, need.y - track.shiftY) < MIN_SHIFT * visible) return;
    track.shiftX = need.x;
    track.shiftY = need.y;
  }

  function resolvePose(input) {
    var pose = plannedPose(input);
    var shot = input.shot;
    var layout = input.layout;
    if (input.time < shot.start || (layout.words.length === 0 && layout.glyphs.length === 0)) return pose;
    var track = trackFor(input);
    while (track.next < track.times.length && track.times[track.next] <= input.time) advanceTrack(track, input);
    return shiftPose(pose, track.shiftX, track.shiftY);
  }

  function resolveStillPose(layout, aspect) {
    var whole = rectFocus(layout.bounds);
    return { x: whole.x, y: whole.y, distance: fitDistance(whole, WIDE_MARGIN, aspect), roll: 0, fov: FOV };
  }

  var FLOOD_IN = 0.7;
  var FLOOD_OUT = 0.9;

  function resolveTransition(program, cueIndex, time, out) {
    out.flood = 0;
    var cue = program.cues[cueIndex];
    if (!cue) return out;
    var since = time - cue.start;
    if (since >= 0 && cue.transition === 'flood' && since < FLOOD_OUT) out.flood = 1.15 * (1 - easeOutCubic(since / FLOOD_OUT));
    if (cueIndex + 1 < program.cues.length) {
      var next = program.cues[cueIndex + 1];
      var until = next.start - time;
      if (next.transition === 'flood' && until < FLOOD_IN) out.flood = Math.max(out.flood, 1.15 * Math.pow(1 - until / FLOOD_IN, 2));
    }
    return out;
  }

  function resolveReveal(cue, time) {
    return clamp01((time - cue.start) / 0.5 + (cue.lineIndex < 0 ? 1 : 0));
  }

  function resolveMelt(cue, time) {
    if (cue.lineIndex < 0 || cue.end - cue.singEnd < TAIL * 0.6) return 0;
    var from = Math.max(cue.singEnd + 0.3, cue.end - 1.5);
    return clamp01((time - from) / Math.max(0.05, cue.end - from));
  }

  /* ============================== 4. 字形图集（metaphorGlyphs.ts） ============================== */

  var GLYPH_EM = 72;
  var PAD = 28;
  var GLYPH_CELL = GLYPH_EM + PAD * 2;
  var GLYPH_WORLD = GLYPH_CELL / GLYPH_EM;
  var BASELINE = 0.86;
  var TIGHT_RADIUS = 1;
  var WIDE_RADIUS = 6;
  var WIDE_GAIN = 1.5;
  var DENSE_WEIGHT = 500;
  var DENSE_WIDE = 0.6;
  var DENSE_CHAR = /[\u2E80-\u2FDF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
  var CACHE_LIMIT = 400;
  var NOTE_PREFIX = '\u0001';
  var NOTE_FONT = 'italic 500 ' + GLYPH_EM + 'px "Cambria Math", "STIX Two Math", Cambria, Georgia, "Times New Roman", serif';
  var ATLAS_COLUMNS = 8;

  function blurLines(source, target, radius, step, lineStep) {
    var windowSize = radius * 2 + 1;
    for (var line = 0; line < GLYPH_CELL; line += 1) {
      var base = line * lineStep;
      var sum = 0;
      for (var index = 0; index <= radius; index += 1) sum += source[base + index * step];
      for (var at = 0; at < GLYPH_CELL; at += 1) {
        target[base + at * step] = sum / windowSize;
        var add = at + radius + 1;
        var drop = at - radius;
        if (add < GLYPH_CELL) sum += source[base + add * step];
        if (drop >= 0) sum -= source[base + drop * step];
      }
    }
  }

  function blur(buffer, scratch, radius) {
    for (var pass = 0; pass < 3; pass += 1) {
      blurLines(buffer, scratch, radius, 1, GLYPH_CELL);
      blurLines(scratch, buffer, radius, GLYPH_CELL, 1);
    }
  }

  function GlyphSource(stack, weight) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = GLYPH_CELL;
    this.canvas.height = GLYPH_CELL;
    var context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('隐喻无法创建 2D 画布');
    this.context = context;
    this.cells = {};
    this.cellCount = 0;
    this.advances = {};
    this.advanceCount = 0;
    this.work = new Float32Array(GLYPH_CELL * GLYPH_CELL);
    this.wide = new Float32Array(GLYPH_CELL * GLYPH_CELL);
    this.scratch = new Float32Array(GLYPH_CELL * GLYPH_CELL);
    this.font = '';
    this.denseFont = '';
    this.stack = stack;
    this.setFont(stack, weight);
    this.bind();
  }

  GlyphSource.prototype.setFont = function (stack, weight) {
    var font = weight + ' ' + GLYPH_EM + 'px ' + stack;
    if (font === this.font) return false;
    this.font = font;
    this.denseFont = Math.min(weight, DENSE_WEIGHT) + ' ' + GLYPH_EM + 'px ' + stack;
    this.cells = {};
    this.cellCount = 0;
    this.advances = {};
    this.advanceCount = 0;
    return true;
  };

  GlyphSource.prototype.fontReady = function () {
    try { return document.fonts.check(this.font); } catch (_) { return true; }
  };

  GlyphSource.prototype.advance = function (key, char, font) {
    var advance = this.advances[key];
    if (advance === undefined) {
      this.context.font = font;
      advance = Math.max(0.2, this.context.measureText(char).width / GLYPH_EM);
      if (this.advanceCount >= CACHE_LIMIT * 2) {
        this.advances = {};
        this.advanceCount = 0;
      }
      this.advances[key] = advance;
      this.advanceCount += 1;
    }
    return advance;
  };

  /* 量字宽的两个函数会被当成裸函数传出去（buildLayout 的 measure），必须绑住 this ——
   * 原型方法一脱离实例就变成 undefined.advance（2026-11-27 真机探针踩到）。 */
  GlyphSource.prototype.measure = function (char) { return this.advance(char, char, this.font); };
  GlyphSource.prototype.measureNote = function (char) { return this.advance(NOTE_PREFIX + char, char, NOTE_FONT); };
  GlyphSource.prototype.bind = function () {
    var self = this;
    this.measure = function (char) { return self.advance(char, char, self.font); };
    this.measureNote = function (char) { return self.advance(NOTE_PREFIX + char, char, NOTE_FONT); };
    return this;
  };

  GlyphSource.prototype.cell = function (key) {
    var cached = this.cells[key];
    if (cached) return cached;
    var context = this.context;
    var work = this.work;
    var wide = this.wide;
    var scratch = this.scratch;
    var note = key.indexOf(NOTE_PREFIX) === 0;
    var char = note ? key.slice(NOTE_PREFIX.length) : key;
    var dense = !note && DENSE_CHAR.test(char);
    var wideGain = dense ? WIDE_GAIN * DENSE_WIDE : WIDE_GAIN;
    context.clearRect(0, 0, GLYPH_CELL, GLYPH_CELL);
    context.font = note ? NOTE_FONT : (dense ? this.denseFont : this.font);
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#fff';
    context.fillText(char || ' ', GLYPH_CELL / 2, PAD + GLYPH_EM * BASELINE);
    var pixels = context.getImageData(0, 0, GLYPH_CELL, GLYPH_CELL).data;
    for (var index = 0; index < work.length; index += 1) {
      work[index] = pixels[index * 4 + 3] / 255;
      wide[index] = work[index];
    }
    blur(work, scratch, TIGHT_RADIUS);
    blur(wide, scratch, WIDE_RADIUS);
    var cell = new Uint8Array(GLYPH_CELL * GLYPH_CELL * 2);
    for (var at = 0; at < work.length; at += 1) {
      cell[at * 2] = Math.round(Math.min(1, work[at]) * 255);
      cell[at * 2 + 1] = Math.round(Math.min(1, wide[at] * wideGain) * 255);
    }
    if (this.cellCount >= CACHE_LIMIT) {
      this.cells = {};
      this.cellCount = 0;
    }
    this.cells[key] = cell;
    this.cellCount += 1;
    return cell;
  };

  function buildAtlas(source, chars) {
    var unique = [];
    var seen = {};
    for (var i = 0; i < chars.length; i += 1) {
      if (seen[chars[i]]) continue;
      seen[chars[i]] = true;
      unique.push(chars[i]);
    }
    var columns = Math.max(1, Math.min(ATLAS_COLUMNS, unique.length));
    var rows = Math.max(1, Math.ceil(unique.length / columns));
    var width = columns * GLYPH_CELL;
    var height = rows * GLYPH_CELL;
    var data = new Uint8Array(width * height * 4);
    var rects = {};
    unique.forEach(function (char, order) {
      var column = order % columns;
      var row = Math.floor(order / columns);
      var cell = source.cell(char);
      for (var y = 0; y < GLYPH_CELL; y += 1) {
        var to = ((row * GLYPH_CELL + y) * width + column * GLYPH_CELL) * 4;
        var from = y * GLYPH_CELL * 2;
        for (var x = 0; x < GLYPH_CELL; x += 1) {
          data[to] = cell[from];
          data[to + 1] = cell[from + 1];
          data[to + 3] = 255;
          to += 4;
          from += 2;
        }
      }
      rects[char] = [column / columns, row / rows, (column + 1) / columns, (row + 1) / rows];
    });
    return { data: data, width: width, height: height, rects: rects };
  }

  F.plan = {
    seedRng: seedRng,
    buildTokens: buildTokens,
    buildTextTokens: buildTextTokens,
    buildLayout: buildLayout,
    compileProgram: compileProgram,
    findCue: findCue,
    resolveCueTime: resolveCueTime,
    findShot: findShot,
    EMPTY_STAGE: EMPTY_STAGE,
    resolvePose: resolvePose,
    resolveStillPose: resolveStillPose,
    resolveTransition: resolveTransition,
    resolveReveal: resolveReveal,
    resolveMelt: resolveMelt,
    clearTracks: clearTracks,
    GlyphSource: GlyphSource,
    buildAtlas: buildAtlas,
    constants: {
      GLYPH_WORLD: GLYPH_WORLD,
      NOTE_PREFIX: NOTE_PREFIX,
      SHAPE_STRIDE: SHAPE_STRIDE,
      SHAPE_CAPACITY: SHAPE_CAPACITY
    }
  };
})();
