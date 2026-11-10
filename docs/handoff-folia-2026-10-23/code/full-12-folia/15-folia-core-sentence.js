/* Folia 世界 — 句读切分（SentenceLayout.splitIntoSentences 的 vanilla 版）
 *
 * 移植自 Folia utils/lyrics/sentenceLayout.ts。tilt 只用到 splitIntoSentences 一个入口，
 * 但它内部按 5 级逐层切分，最后还要 secondarySplit / mergeSentences 收口，所以整条链都要在。
 *
 * 五级切分（顺序即优先级，级别越高越"硬"）：
 *   1 标点（，。；！？…）  2 成对符号（「」《》【】（）引号）  3 西文词块
 *   4 CJK 空格/全角空格    5 特殊符号（：/ | ~）
 * 切到目标条数为止；不够就用 Intl.Segmenter 找最平衡的词边界（secondarySplit），
 * 超了就合并最短的相邻两条（mergeSentences）。
 *
 * Folia 用 class + private static；这里改成纯函数 + 前缀名，语义一一对应。
 */
'use strict';

var FOLIA_SENT_CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
var FOLIA_SENT_WS_RE = /^\s+$/;
var foliaSentCharCountCache = new Map();

function foliaSentHasCjk(text) {
  return FOLIA_SENT_CJK_RE.test(String(text || ''));
}

function foliaSentFindRegexMatch(regex, text, fromIndex) {
  regex.lastIndex = fromIndex || 0;
  var m = regex.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function foliaSentFindStringMatch(str, text, fromIndex) {
  var idx = text.indexOf(str, fromIndex || 0);
  return idx === -1 ? null : { start: idx, end: idx + str.length };
}

function foliaSentWrapped(text) {
  return { text: String(text) };
}

/* ---- 1 级：标点 ---- */
function foliaSentSplitByPunctuation(text) {
  var allPunctRegex = /[，。；！？、…·\.\,\;\!\?]+/g;
  var matches = [];
  var m;
  while ((m = allPunctRegex.exec(text)) !== null) matches.push(m);
  if (matches.length === 0) return [text];

  var result = [];
  var lastIndex = 0;

  for (var i = 0; i < matches.length; i++) {
    var match = matches[i];
    var punctStart = match.index;
    var punctEnd = punctStart + match[0].length;

    var trailingSpaces = '';
    var afterPunct = text.slice(punctEnd);
    var spaceMatch = afterPunct.match(/^\s+/);
    if (spaceMatch) trailingSpaces = spaceMatch[0];

    var beforePunct = text.slice(lastIndex, punctStart);
    var punctWithSpaces = match[0] + trailingSpaces;

    if (beforePunct.length > 0) {
      result.push(beforePunct + punctWithSpaces);
    } else if (result.length > 0) {
      result[result.length - 1] += punctWithSpaces;
    } else {
      result.push(punctWithSpaces);
    }

    lastIndex = punctEnd + trailingSpaces.length;
  }

  if (lastIndex < text.length) result.push(text.slice(lastIndex));
  return result.filter(function (r) { return r.length > 0; });
}

/* ---- 3 级：西文词块 ---- */
function foliaSentGetGlobalCount(text, ch) {
  var key = text.length + ':' + ch;
  if (foliaSentCharCountCache.has(key)) return foliaSentCharCountCache.get(key);
  var escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var count = (text.match(new RegExp(escaped, 'g')) || []).length;
  if (foliaSentCharCountCache.size > 512) foliaSentCharCountCache.clear();
  foliaSentCharCountCache.set(key, count);
  return count;
}

function foliaSentShouldSkipBoundary(fullText, beforeBlock) {
  if (beforeBlock.length === 0) return false;
  var sepChar = beforeBlock[beforeBlock.length - 1];
  if (sepChar === '-') return true;
  if (sepChar === ':' || sepChar === '：' || sepChar === '/' || sepChar === '／' || sepChar === '|' || sepChar === '｜') {
    return foliaSentGetGlobalCount(fullText, sepChar) >= 2;
  }
  return false;
}

function foliaSentSplitByWesternWords(text) {
  if (!foliaSentHasCjk(text)) return [text];

  var westernBlockRegex = /[a-zA-Z0-9]+(?:[a-zA-Z0-9'\-]*[a-zA-Z0-9]+)?(?:\s+[a-zA-Z0-9]+(?:[a-zA-Z0-9'\-]*[a-zA-Z0-9]+)?)+[.,;:!?。，；：！？]?\s*/g;

  var hasMultipleWordBlock = false;
  var match;
  while ((match = westernBlockRegex.exec(text)) !== null) {
    var wordCount = (match[0].match(/[a-zA-Z0-9]+/g) || []).length;
    if (wordCount > 1) {
      hasMultipleWordBlock = true;
      break;
    }
  }
  if (!hasMultipleWordBlock) return [text];

  westernBlockRegex.lastIndex = 0;

  var parts = [];
  var lastIndex = 0;
  while ((match = westernBlockRegex.exec(text)) !== null) {
    var blockStart = match.index;
    var blockEnd = blockStart + match[0].length;
    var beforeBlock = text.slice(lastIndex, blockStart);

    if (foliaSentShouldSkipBoundary(text, beforeBlock)) {
      parts.push(beforeBlock + match[0]);
    } else if (blockStart > lastIndex) {
      parts.push(beforeBlock);
      parts.push(match[0]);
    } else {
      parts.push(match[0]);
    }

    lastIndex = blockEnd;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 1 ? parts : [text];
}

/* ---- 2 级：成对符号 ---- */
function foliaSentSplitByBracketsQuotes(text) {
  var defs = [
    { open: /「/, close: /」/ },
    { open: /『/, close: /』/ },
    { open: /《/, close: /》/ },
    { open: /【/, close: /】/ },
    { open: /｛/, close: /｝/ },
    { open: /［/, close: /］/ },
    { open: /\[/, close: /\]/ },
    { open: /（/, close: /）/ },
    { open: /\(/, close: /\)/ },
    { openStr: '"', closeStr: '"' },
    { openStr: "'", closeStr: "'" }
  ];
  var result = foliaSentExtractOutermostPairs(text, defs);
  return result.length > 1 ? result : [text];
}

function foliaSentExtractOutermostPairs(text, defs) {
  var best = foliaSentFindOutermostPair(text, defs);
  if (!best) return [text];

  var before = text.slice(0, best.openStart);
  var pairedContent = text.slice(best.openStart, best.closeEnd);
  var remainder = text.slice(best.closeEnd);

  var result = [];
  if (before.length > 0) result = result.concat(foliaSentExtractOutermostPairs(before, defs));
  result.push(pairedContent);
  if (remainder.length > 0) result = result.concat(foliaSentExtractOutermostPairs(remainder, defs));
  return result.filter(function (p) { return p.length > 0; });
}

function foliaSentFindOutermostPair(text, defs) {
  var best = null;

  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    var openMatch = def.openStr !== undefined
      ? foliaSentFindStringMatch(def.openStr, text)
      : foliaSentFindRegexMatch(def.open, text);
    if (!openMatch) continue;

    var searchFrom = openMatch.end;
    var closeMatch = def.closeStr !== undefined
      ? foliaSentFindStringMatch(def.closeStr, text, searchFrom)
      : foliaSentFindRegexMatch(def.close, text, searchFrom);
    if (!closeMatch) continue;

    var candidate = {
      openStart: openMatch.start,
      openEnd: openMatch.end,
      closeStart: closeMatch.start,
      closeEnd: closeMatch.end
    };

    if (!best || candidate.openStart < best.openStart) best = candidate;
    else if (candidate.openStart === best.openStart && candidate.closeEnd > best.closeEnd) best = candidate;
  }

  return best;
}

/* ---- 4 级：CJK 空格 / 全角空格 ---- */
function foliaSentSplitCjkBySpace(text) {
  if (!foliaSentHasCjk(text)) return [text];

  var segments = [];
  var currentSegment = '';
  var inCjkBlock = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var isCjk = FOLIA_SENT_CJK_RE.test(ch);
    var isWestern = /[a-zA-Z0-9]/.test(ch);
    var isSpace = /\s/.test(ch);

    if (isCjk) {
      currentSegment += ch;
      inCjkBlock = true;
    } else if (isWestern) {
      currentSegment += ch;
    } else if (isSpace) {
      var isFullWidthSpace = ch === '\u3000';
      if (isFullWidthSpace && currentSegment.length > 0) {
        currentSegment += ch;
        segments.push(currentSegment);
        currentSegment = '';
        inCjkBlock = false;
      } else if (inCjkBlock && currentSegment.length > 0) {
        var lastChar = currentSegment[currentSegment.length - 1];
        if (FOLIA_SENT_CJK_RE.test(lastChar)) {
          currentSegment += ch;
          segments.push(currentSegment);
          currentSegment = '';
          inCjkBlock = false;
        } else {
          currentSegment += ch;
        }
      } else if (currentSegment.length === 0 && segments.length > 0) {
        segments[segments.length - 1] += ch;
      } else {
        currentSegment += ch;
      }
    } else {
      if (currentSegment.length === 0 && segments.length > 0) segments[segments.length - 1] += ch;
      else currentSegment += ch;
    }
  }

  if (currentSegment) {
    if (segments.length > 0 && FOLIA_SENT_WS_RE.test(currentSegment)) segments[segments.length - 1] += currentSegment;
    else segments.push(currentSegment);
  }

  return segments.length > 1 ? segments : [text];
}

/* ---- 5 级：特殊符号 ---- */
function foliaSentSplitBySpecialChars(text) {
  var specialCharRegex = /[：:\/／\\|｜~～]+/;
  var parts = text.split(specialCharRegex);
  var nonEmpty = parts.filter(function (p) { return p.length > 0; });
  if (nonEmpty.length <= 1) return [text];

  var result = [];
  var lastIndex = 0;

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var index = text.indexOf(part, lastIndex);
    if (index > lastIndex) {
      var specialChar = text.slice(lastIndex, index);
      if (result.length > 0) result[result.length - 1] += specialChar;
      else result.push(specialChar);
    }

    if (part) {
      result.push(part);
      lastIndex = index + part.length;
    } else if (index !== -1) {
      lastIndex = index;
    }
  }

  if (lastIndex < text.length) {
    var tail = text.slice(lastIndex);
    if (tail && result.length > 0) result[result.length - 1] += tail;
    else if (tail) result.push(tail);
  }

  return result.filter(function (r) { return r.length > 0; });
}

function foliaSentSplitByLevel(text, level) {
  if (level === 1) return foliaSentSplitByPunctuation(text);
  if (level === 2) return foliaSentSplitByBracketsQuotes(text);
  if (level === 3) return foliaSentSplitByWesternWords(text);
  if (level === 4) return foliaSentSplitCjkBySpace(text);
  if (level === 5) return foliaSentSplitBySpecialChars(text);
  return [text];
}

/* ---- 不足目标条数：按词边界对半切（挑最平衡的那条） ---- */
function foliaSentSecondarySplit(sentences, targetCount, timeSeed) {
  var Segmenter = (typeof Intl !== 'undefined') ? Intl.Segmenter : null;
  var segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'word' }) : null;

  while (sentences.length < targetCount) {
    var candidates = sentences.filter(function (s) { return s.text.length > 2; });
    if (candidates.length === 0) break;

    if (segmenter) {
      var semanticCandidates = [];

      for (var ci = 0; ci < candidates.length; ci++) {
        var s = candidates[ci];
        try {
          var segments = [];
          var it = segmenter.segment(s.text);
          for (var part of it) segments.push(part);

          var wordPositions = [];
          var offset = 0;
          for (var si = 0; si < segments.length; si++) {
            if (segments[si].isWordLike) wordPositions.push({ start: offset, end: offset + segments[si].segment.length });
            offset += segments[si].segment.length;
          }

          if (wordPositions.length >= 2) {
            var midChar = s.text.length / 2;
            var bestGapIdx = 1;
            var bestDist = Infinity;
            for (var g = 1; g < wordPositions.length; g++) {
              var dist = Math.abs(wordPositions[g].start - midChar);
              if (dist < bestDist) { bestDist = dist; bestGapIdx = g; }
            }
            var splitPos = wordPositions[bestGapIdx].start;
            var balanceScore = 1 - Math.abs(splitPos - midChar) / midChar;
            semanticCandidates.push({
              sentence: s,
              index: sentences.indexOf(s),
              splitPos: splitPos,
              score: balanceScore * 10 + wordPositions.length
            });
          }
        } catch (_) {}
      }

      if (semanticCandidates.length > 0) {
        semanticCandidates.sort(function (a, b) { return b.score - a.score; });
        var best = semanticCandidates[0];
        sentences.splice(best.index, 1,
          foliaSentWrapped(best.sentence.text.slice(0, best.splitPos)),
          foliaSentWrapped(best.sentence.text.slice(best.splitPos)));
        continue;
      }
    }

    var pseudoRandom = function (seed) {
      var x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };

    var textHash = 0;
    for (var hi = 0; hi < sentences.length; hi++) {
      var txt = sentences[hi].text;
      for (var hi2 = 0; hi2 < txt.length; hi2++) textHash += txt.charCodeAt(hi2);
    }
    var seed = textHash + sentences.length + (timeSeed || 0);
    var randomIndex = Math.floor(pseudoRandom(seed) * candidates.length);
    var selectedCandidate = candidates[randomIndex];
    var candidateIndex = sentences.indexOf(selectedCandidate);

    var midPoint = Math.floor(selectedCandidate.text.length / 2);
    sentences.splice(candidateIndex, 1,
      foliaSentWrapped(selectedCandidate.text.slice(0, midPoint)),
      foliaSentWrapped(selectedCandidate.text.slice(midPoint)));
  }

  return sentences;
}

/* ---- 超出目标条数：反复合并最短的相邻两条 ---- */
function foliaSentMergeSentences(sentences, targetCount) {
  while (sentences.length > targetCount) {
    var bestMergeIndex = 0;
    var shortestCombinedLength = Infinity;
    for (var i = 0; i < sentences.length - 1; i++) {
      var combinedLength = sentences[i].text.length + sentences[i + 1].text.length;
      if (combinedLength < shortestCombinedLength) {
        shortestCombinedLength = combinedLength;
        bestMergeIndex = i;
      }
    }
    var merged = foliaSentWrapped(sentences[bestMergeIndex].text + sentences[bestMergeIndex + 1].text);
    sentences.splice(bestMergeIndex, 2, merged);
  }
  return sentences;
}

/* 主入口：把一行切成 targetCount 条（<=0 表示按级别全切）。返回 [{ text }]。 */
function foliaSplitIntoSentences(text, targetCount, timeSeed) {
  if (targetCount <= 1 && targetCount >= 0) return [foliaSentWrapped(text)];

  var maxLevel = targetCount === -1 ? 1
    : targetCount === -2 ? 2
    : targetCount === -3 ? 3
    : targetCount === -4 ? 4
    : 5;

  var sentences = [text];

  for (var level = 1; level <= maxLevel; level++) {
    if (sentences.length >= Math.abs(targetCount) && targetCount > 0) break;
    var next = [];
    for (var i = 0; i < sentences.length; i++) {
      next = next.concat(foliaSentSplitByLevel(sentences[i], level));
    }
    sentences = next;
  }

  var result = sentences.map(foliaSentWrapped);

  if (targetCount > 0 && result.length < targetCount) {
    result = foliaSentSecondarySplit(result, targetCount, timeSeed);
  }
  if (result.length > 1 && result.length > targetCount && targetCount > 0) {
    result = foliaSentMergeSentences(result, targetCount);
  }

  return result;
}
