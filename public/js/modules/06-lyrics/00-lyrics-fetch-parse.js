// ============================================================
//  歌词
// ============================================================
async function fetchLyric(songOrId, token) {
  try {
    var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
    var cached = song ? await readPersistentLyricCache(song) : null;
    if (token !== trackSwitchToken) return;
    if (cached) {
      applyLyricApiResponse(cached, token, song);
      refreshPersistentLyricCache(song, token);
      return;
    }
    var endpoint = typeof lyricEndpointForSong === 'function'
      ? lyricEndpointForSong(song || songOrId)
      : ('/api/lyric?id=' + encodeURIComponent(song ? song.id : songOrId));
    var r = await apiJson(endpoint);
    if (token !== trackSwitchToken) return;
    applyLyricApiResponse(r, token, song);
    if (song) writePersistentLyricCache(song, r);
  } catch (e) {
    if (token !== trackSwitchToken) return;
    var fallbackLines = withLyricFallback([]);
    lyricsTransLines = [];
    lyricsTranslationLines = lyricsTransLines;
    setOriginalLyricsState(fallbackLines, false, 'fallback');
    applyPreferredLyricsForCurrent(true);
  }
}
function persistentLyricCacheKey(song) {
  song = song || {};
  var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : (song.source || song.provider || 'netease');
  var id = song.id || song.mid || song.songmid || song.hash || '';
  var artist = song.artist || song.singer || song.artists || '';
  return ['lyrics-v1', provider, id, song.name || song.title || '', artist].join('|');
}
function readPersistentLyricCache(song) {
  if (!window.desktopWindow || typeof window.desktopWindow.readLyricCache !== 'function') return Promise.resolve(null);
  return window.desktopWindow.readLyricCache(persistentLyricCacheKey(song)).then(function (result) {
    return result && result.ok && result.hit && result.payload ? result.payload : null;
  }).catch(function () { return null; });
}
function writePersistentLyricCache(song, payload) {
  if (!window.desktopWindow || typeof window.desktopWindow.writeLyricCache !== 'function' || !payload || typeof payload !== 'object') return;
  window.desktopWindow.writeLyricCache(persistentLyricCacheKey(song), payload).catch(function () {});
}
var lyricQueuePrefetchTimer = 0;
var lyricQueuePrefetchToken = 0;
var lyricQueuePrefetchBusy = false;
var lyricQueuePrefetchKeys = {};
function lyricQueuePrefetchCandidate(song) {
  if (!song || song.type === 'podcast' || song.type === 'local' || song.source === 'local' || song.localUrl) return false;
  return !!(song.id || song.mid || song.songmid || song.hash || song.name || song.title);
}
function nextQueueLyricPrefetchSong(fromIndex) {
  if (!Array.isArray(playQueue) || playQueue.length < 2) return null;
  var total = playQueue.length;
  var from = isFinite(Number(fromIndex)) ? Math.round(Number(fromIndex)) : currentIdx;
  for (var step = 1; step < total; step++) {
    var index = (from + step + total) % total;
    if (index === currentIdx) continue;
    var song = playQueue[index];
    if (!lyricQueuePrefetchCandidate(song)) continue;
    var key = persistentLyricCacheKey(song);
    if (!key || lyricQueuePrefetchKeys[key]) continue;
    return { song: song, key: key };
  }
  return null;
}
function scheduleQueueLyricPrefetch(fromIndex, delay) {
  if (lyricQueuePrefetchTimer) clearTimeout(lyricQueuePrefetchTimer);
  lyricQueuePrefetchTimer = 0;
  if (lyricQueuePrefetchBusy || !Array.isArray(playQueue) || playQueue.length < 2) return false;
  var token = ++lyricQueuePrefetchToken;
  var wait = Math.max(1200, Number(delay) || 2400);
  lyricQueuePrefetchTimer = setTimeout(function () {
    lyricQueuePrefetchTimer = 0;
    runQueueLyricPrefetch(fromIndex, token);
  }, wait);
  return true;
}
async function runQueueLyricPrefetch(fromIndex, token) {
  if (token !== lyricQueuePrefetchToken || lyricQueuePrefetchBusy) return false;
  if (audio && audio.paused) return false;
  var candidate = nextQueueLyricPrefetchSong(fromIndex);
  if (!candidate) return false;
  lyricQueuePrefetchKeys[candidate.key] = true;
  lyricQueuePrefetchBusy = true;
  try {
    var cached = await readPersistentLyricCache(candidate.song);
    if (token !== lyricQueuePrefetchToken) return false;
    if (cached) return true;
    var endpoint = typeof lyricEndpointForSong === 'function'
      ? lyricEndpointForSong(candidate.song)
      : ('/api/lyric?id=' + encodeURIComponent(candidate.song.id || ''));
    var response = await apiJson(endpoint);
    if (token !== lyricQueuePrefetchToken) return false;
    if (!response || response.error) return false;
    writePersistentLyricCache(candidate.song, response);
    return true;
  } catch (_) {
    return false;
  } finally {
    lyricQueuePrefetchBusy = false;
  }
}
function refreshPersistentLyricCache(song, token) {
  if (!song) return;
  var endpoint = typeof lyricEndpointForSong === 'function'
    ? lyricEndpointForSong(song)
    : ('/api/lyric?id=' + encodeURIComponent(song.id || ''));
  apiJson(endpoint).then(function (response) {
    if (!response || response.error) return;
    writePersistentLyricCache(song, response);
    // 缓存补翻译：旧持久缓存无译文（如酷狗翻译修复前写入的缓存），
    // 刷新响应带译文且仍是同一首歌时，重新应用让当前显示立即更新
    if (typeof token === 'number' && token !== trackSwitchToken) return;
    if (lyricsTranslationLines && lyricsTranslationLines.length) return;
    var hasFreshTrans = !!(String(response.trans || '') || String(response.tlyric || '') || String(response.ytlrc || ''));
    if (hasFreshTrans) applyLyricApiResponse(response, token, song);
  }).catch(function () {});
}
function applyLyricApiResponse(r, token, song) {
  if (token !== trackSwitchToken) return;
  r = r || {};
  var nativeLines = parseYrcText(r.yrc || '');
  var lrcLines = parseLyricText(r.lyric || '');
  var translationPayload = buildLyricTranslationPayload(r);
  lyricsTransLines = translationPayload.lines || [];
  lyricsTranslationLines = lyricsTransLines;
  var hasNativeKaraoke = nativeLines.some(function(line){ return line.words && line.words.length; });
  var timingSource = hasNativeKaraoke ? 'yrc-word' : (nativeLines.length ? 'yrc-line' : (lrcLines.length ? 'lrc-line' : 'fallback'));
  var lines = withLyricFallback(nativeLines.length ? nativeLines : lrcLines);
  if (lines.length && lines[0].fallback) timingSource = 'fallback';
  lines = attachLyricTranslations(lines, lyricsTransLines);
  var translationSource = translationPayload.lines.length ? translationPayload.source : 'none';
  // [LYRIC-DIAG] 临时诊断：定位双语翻译不显示的根因。验证后删除。
  try {
    var _matched = lines.filter(function(l){ return l && l.translation; }).length;
    console.warn('[LYRIC-DIAG]', JSON.stringify({
      provider: song && (song.source || song.provider),
      name: song && (song.name || song.title),
      rawTransLen: (r.trans || '').length,
      rawTlyricLen: (r.tlyric || '').length,
      rawYtlrcLen: (r.ytlrc || '').length,
      transLines: lyricsTransLines.length,
      primaryLines: lines.length,
      matched: _matched,
      source: translationSource,
      mode: fx && fx.lyricTranslationMode,
      timing: timingSource
    }));
  } catch (_) {}
  setOriginalLyricsState(lines, hasNativeKaraoke, timingSource, lyricsTransLines, translationSource);
  applyPreferredLyricsForCurrent(true);
  // 网易歌词译文回落：非网易源歌曲缺译文时，延迟从网易搜索同名歌曲补译文
  if (song) scheduleNeteaseLyricTranslationFallback(song, token, originalLyricsState);
}
// ---- 网易歌词译文回落：非网易源歌曲缺译文时，从网易搜索同名歌曲补译文 ----
var lyricTranslationFallbackCache = {};
var lyricTranslationFallbackMissCache = {};
function lyricTranslationFallbackKey(song) {
  song = song || {};
  return [
    simpleSearchNorm(song.name || song.title || ''),
    simpleSearchNorm(song.artist || ''),
    simpleSearchNorm(song.album || '')
  ].join('|');
}
function shouldFetchNeteaseLyricTranslationFallback(song, state) {
  if (!song || !state) return false;
  var usable = state.lines && state.lines.some(function (line) { return line && !line.fallback; });
  if (!usable) return false;
  if (song.type === 'local' || song.source === 'local' || song.localUrl || song.type === 'podcast') return false;
  if (songProviderKey(song) === 'netease') return false;
  if (state.translationLines && state.translationLines.length) return false;
  if (!String(song.name || song.title || '').trim()) return false;
  var key = lyricTranslationFallbackKey(song);
  var missedAt = lyricTranslationFallbackMissCache[key] || 0;
  return !missedAt || Date.now() - missedAt > 10 * 60 * 1000;
}
function lyricNeteaseFallbackSearchQuery(song) {
  song = song || {};
  var artist = String(song.artist || '').split(/\s*\/\s*|\s*,\s*|\s*&\s*/)[0] || '';
  return [song.name || song.title || '', artist].filter(Boolean).join(' ').trim();
}
async function findNeteaseLyricFallbackCandidate(song) {
  var query = lyricNeteaseFallbackSearchQuery(song);
  if (!query) return null;
  var data = await apiJson('/api/search?keywords=' + encodeURIComponent(query) + '&limit=8', { timeoutMs: 4800 });
  var list = data && (data.songs || data.result || []);
  if (!Array.isArray(list) || !list.length) return null;
  list = list.filter(function (candidate) {
    return !(typeof sourceCandidateRejectReason === 'function' && sourceCandidateRejectReason(song, candidate, 'netease'));
  });
  if (!list.length) return null;
  for (var i = 0; i < list.length; i++) {
    if (typeof isSameTitleArtist === 'function' && isSameTitleArtist(song, list[i])) return list[i];
  }
  list = list.slice().sort(function (a, b) {
    var sa = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(a, query, 0) : 0;
    var sb = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(b, query, 0) : 0;
    if (a && a.playable === false) sa -= 20;
    if (b && b.playable === false) sb -= 20;
    return sb - sa;
  });
  var best = list[0];
  var bestScore = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(best, query, 0) : 0;
  return best && best.id && bestScore >= 28 ? best : null;
}
function mergeNeteaseFallbackTranslationsIntoCurrent(song, token, payload, cacheKey) {
  if (!payload || !payload.lines || !payload.lines.length) return false;
  if (token !== trackSwitchToken) return false;
  var currentSong = typeof currentLyricSong === 'function' ? currentLyricSong() : null;
  if (lyricTranslationFallbackKey(currentSong) !== cacheKey) return false;
  if (originalLyricsState && originalLyricsState.translationLines && originalLyricsState.translationLines.length) return false;
  var mergedLines = attachLyricTranslations(originalLyricsState.lines || [], payload.lines);
  var attached = mergedLines.some(function (line) { return line && line.translation; });
  if (!attached) return false;
  setOriginalLyricsState(
    mergedLines,
    originalLyricsState.hasNativeKaraoke,
    originalLyricsState.timingSource,
    payload.lines,
    'netease-fallback+' + (payload.source || 'tlyric')
  );
  applyPreferredLyricsForCurrent(true);
  return true;
}
async function fetchNeteaseLyricTranslationFallbackCore(song, token, cacheKey) {
  if (!song || token !== trackSwitchToken) return false;
  var cached = lyricTranslationFallbackCache[cacheKey];
  if (cached) return mergeNeteaseFallbackTranslationsIntoCurrent(song, token, cached, cacheKey);
  try {
    var candidate = await findNeteaseLyricFallbackCandidate(song);
    if (token !== trackSwitchToken || !candidate || !candidate.id) return false;
    var response = await apiJson('/api/lyric?id=' + encodeURIComponent(candidate.id), { timeoutMs: 5200 });
    if (token !== trackSwitchToken) return false;
    var translationPayload = buildLyricTranslationPayload(response || {});
    if (!translationPayload.lines.length) {
      lyricTranslationFallbackMissCache[cacheKey] = Date.now();
      return false;
    }
    cached = {
      lines: cloneLyricLines(translationPayload.lines),
      source: translationPayload.source,
      candidateId: candidate.id,
      cachedAt: Date.now()
    };
    lyricTranslationFallbackCache[cacheKey] = cached;
    return mergeNeteaseFallbackTranslationsIntoCurrent(song, token, cached, cacheKey);
  } catch (err) {
    lyricTranslationFallbackMissCache[cacheKey] = Date.now();
    console.warn('[LyricTranslationFallback]', err);
    return false;
  }
}
// 网易回落失败时，继续走 AI 补译文（默认关：AI_LYRIC_TRANSLATE_STORE_KEY）
async function fetchNeteaseLyricTranslationFallback(song, token, cacheKey) {
  var ok = false;
  try {
    ok = await fetchNeteaseLyricTranslationFallbackCore(song, token, cacheKey);
  } finally {
    if (!ok && token === trackSwitchToken) scheduleAiLyricTranslationFallback(song, token);
  }
  return ok;
}
function scheduleNeteaseLyricTranslationFallback(song, token, state) {
  if (!shouldFetchNeteaseLyricTranslationFallback(song, state)) return;
  var cacheKey = lyricTranslationFallbackKey(song);
  var cached = lyricTranslationFallbackCache[cacheKey];
  if (cached) {
    setTimeout(function () { mergeNeteaseFallbackTranslationsIntoCurrent(song, token, cached, cacheKey); }, 0);
    return;
  }
  var start = function () {
    if (token === trackSwitchToken) fetchNeteaseLyricTranslationFallback(song, token, cacheKey);
  };
  setTimeout(function () {
    if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1800 });
    else start();
  }, 420);
}
function currentLyricFallbackText() {
  var song = currentLyricSong() || {};
  var title = (song.name || document.getElementById('thumb-title').textContent || '').trim();
  var artist = (song.artist || document.getElementById('thumb-artist').textContent || '').trim();
  if (!title) return '';
  return artist ? title + ' - ' + artist : title;
}
function normalizeLyricLineText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
function lyricTranslationTextFromAliases(source) {
  source = source || {};
  return source.tlyric || source.trans || source.translatedLyric || source.translation || source.translated_lyric || '';
}
function normalizeLyricTranslationText(text) {
  return normalizeLyricLineText(String(text || '').replace(/^\s*\/+\s*/, ''));
}
function normalizeStageLyricText(text) {
  return normalizeLyricLineText(text);
}
function isLyricCreditLineText(text) {
  var value = normalizeLyricTranslationText(text);
  if (!value) return true;
  return /^(作词|作曲|编曲|制作|出品|混音|母带|录音|吉他|贝斯|鼓|弦乐|和声|监制|出品人|版权|copyright|lyrics?|music|composed|arrangement)\b/i.test(value);
}
function markLyricLineSource(lines, source) {
  return (lines || []).map(function (line) {
    var next = Object.assign({}, line);
    next.source = source || line.source || '';
    return next;
  });
}
function mergeLyricTranslationLineSources() {
  var seen = {};
  var out = [];
  Array.prototype.forEach.call(arguments, function (group) {
    (group || []).forEach(function (line) {
      if (!line) return;
      var key = (Number(line.t) || 0).toFixed(2) + '|' + normalizeLyricTranslationText(line.text);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(line);
    });
  });
  out.sort(function (a, b) { return (Number(a.t) || 0) - (Number(b.t) || 0); });
  return out;
}
function usableLyricTranslationLines(lines) {
  return (lines || []).filter(function (line) {
    var text = normalizeLyricTranslationText(line && line.text);
    return !!(line && text && !isLyricCreditLineText(text));
  });
}
function cloneLyricLines(lines) {
  return (lines || []).map(function (line) {
    var next = Object.assign({}, line);
    if (line && line.words) next.words = line.words.slice();
    return next;
  });
}
function buildLyricTranslationPayload(response) {
  response = response || {};
  var lrcTranslations = markLyricLineSource(parseLyricText(lyricTranslationTextFromAliases(response)), 'tlyric');
  var yrcTranslations = markLyricLineSource(parseYrcText(response.ytlrc || ''), 'ytlrc');
  var lines = mergeLyricTranslationLineSources(lrcTranslations, yrcTranslations);
  var sources = [];
  if (lrcTranslations.length) sources.push('tlyric');
  if (yrcTranslations.length) sources.push('ytlrc');
  return { lines: lines, source: sources.length ? sources.join('+') : 'none' };
}
function attachLyricTranslations(primaryLines, translationLines) {
  var primary = cloneLyricLines(primaryLines || []);
  var translations = usableLyricTranslationLines(translationLines || []);
  if (!primary.length || !translations.length) return primary;
  var assignments = {};
  var usedTranslations = {};
  function translationToleranceForLine(line) {
    var lineDuration = Math.max(0.9, Math.min(5.5, Number(line && line.duration) || 3.2));
    return Math.max(0.55, Math.min(2.4, lineDuration * 0.62 + 0.18));
  }
  function canUseTranslation(line, tr) {
    var translated = normalizeLyricTranslationText(tr && tr.text);
    return !!(line && tr && translated &&
      !isLyricCreditLineText(line.text) &&
      !isLyricCreditLineText(translated) &&
      translated !== normalizeStageLyricText(line.text));
  }
  function assignTranslation(lineIndex, trIndex, delta, phase) {
    var line = primary[lineIndex];
    var tr = translations[trIndex];
    if (!canUseTranslation(line, tr) || usedTranslations[trIndex]) return false;
    assignments[lineIndex] = { line: tr, delta: delta, index: trIndex, phase: phase || 'time' };
    usedTranslations[trIndex] = true;
    return true;
  }
  primary.forEach(function (line, lineIndex) {
    if (!line || line.fallback) return;
    var bestIndex = -1;
    var bestDelta = Infinity;
    for (var trIndex = 0; trIndex < translations.length; trIndex++) {
      if (usedTranslations[trIndex]) continue;
      var tr = translations[trIndex];
      if (!canUseTranslation(line, tr)) continue;
      var delta = Math.abs((Number(tr.t) || 0) - (Number(line.t) || 0));
      if (delta > translationToleranceForLine(line)) continue;
      if (delta < bestDelta) {
        bestIndex = trIndex;
        bestDelta = delta;
      }
    }
    if (bestIndex >= 0) assignTranslation(lineIndex, bestIndex, bestDelta, 'time');
  });
  if (translations.length >= Math.max(2, primary.length * 0.58)) {
    var orderedPrimaryIndexes = [];
    primary.forEach(function (line, lineIndex) {
      if (line && !line.fallback && !isLyricCreditLineText(line.text)) orderedPrimaryIndexes.push(lineIndex);
    });
    var primaryDen = Math.max(1, orderedPrimaryIndexes.length - 1);
    var translationDen = Math.max(1, translations.length - 1);
    orderedPrimaryIndexes.forEach(function (lineIndex, orderPos) {
      var line = primary[lineIndex];
      if (!line || line.fallback || assignments[lineIndex]) return;
      var expected = Math.round((orderPos / primaryDen) * translationDen);
      var bestIndex = -1;
      var bestScore = Infinity;
      var bestDelta = Infinity;
      for (var trIndex = 0; trIndex < translations.length; trIndex++) {
        if (usedTranslations[trIndex]) continue;
        var tr = translations[trIndex];
        if (!canUseTranslation(line, tr)) continue;
        var orderGap = Math.abs(trIndex - expected);
        if (orderGap > 5 && translations.length <= primary.length * 1.25) continue;
        var delta = Math.abs((Number(tr.t) || 0) - (Number(line.t) || 0));
        var fallbackTolerance = Math.max(translationToleranceForLine(line) * 1.35, 2.8);
        if (delta > fallbackTolerance && orderGap > 2) continue;
        var score = orderGap * 0.72 + Math.min(delta, 8) * 0.22;
        if (score < bestScore) {
          bestIndex = trIndex;
          bestScore = score;
          bestDelta = delta;
        }
      }
      if (bestIndex >= 0) assignTranslation(lineIndex, bestIndex, bestDelta, 'order');
    });
  }
  // 兜底：时间/order 匹配后仍有未匹配翻译行 + 未匹配歌词行时，按行序剩余对齐。
  // 处理跨平台时间轴错位或翻译行数与歌词行数不等（如酷狗 trans 与 yrc 时间轴错位，
  // 时间匹配只命中一两句的情况）。行序对齐在时间错位时往往比时间匹配更准。
  var unmatchedTransIdx = [];
  for (var ti = 0; ti < translations.length; ti++) {
    if (!usedTranslations[ti]) unmatchedTransIdx.push(ti);
  }
  if (unmatchedTransIdx.length) {
    var unmatchedPrimaryIdx = [];
    primary.forEach(function (line, lineIndex) {
      if (line && !line.fallback && !assignments[lineIndex] && !isLyricCreditLineText(line.text)) {
        unmatchedPrimaryIdx.push(lineIndex);
      }
    });
    var fallbackLimit = Math.min(unmatchedTransIdx.length, unmatchedPrimaryIdx.length);
    for (var fk = 0; fk < fallbackLimit; fk++) {
      assignTranslation(unmatchedPrimaryIdx[fk], unmatchedTransIdx[fk], 0, 'order-fallback');
    }
  }
  Object.keys(assignments).forEach(function (key) {
    var lineIndex = Number(key);
    var line = primary[lineIndex];
    var best = assignments[key] && assignments[key].line;
    if (line && best) {
      var translated = normalizeLyricTranslationText(best.text);
      if (translated && translated !== normalizeStageLyricText(line.text)) {
        line.translation = translated;
        line.translationTime = best.t;
        line.translationSource = best.source || 'tlyric';
        line.translationMatch = assignments[key].phase || 'time';
      }
    }
  });
  return primary;
}
function getLyricTranslation(time, lineHint) {
  if (lineHint && lineHint.translation) return lineHint.translation;
  if (lyricsLines && lyricsLines.length) {
    var lo = 0, hi = lyricsLines.length - 1, nearest = null, nearestDist = Infinity;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var candidate = lyricsLines[mid];
      var mt = Number(candidate && candidate.t) || 0;
      var md = Math.abs(mt - time);
      if (md < nearestDist) { nearestDist = md; nearest = candidate; }
      if (mt < time) lo = mid + 1; else hi = mid - 1;
    }
    if (nearest && nearest.translation && nearestDist < 2.8) return nearest.translation;
  }
  if (!lyricsTransLines || !lyricsTransLines.length) return '';
  var n = lyricsTransLines.length;
  var lo2 = 0, hi2 = n - 1, best = null, bestDist = Infinity;
  if (lyricsTransLines[0].t <= lyricsTransLines[n - 1].t) {
    while (lo2 <= hi2) {
      var mid2 = (lo2 + hi2) >> 1;
      var mt2 = lyricsTransLines[mid2].t;
      var md2 = Math.abs(mt2 - time);
      if (md2 < bestDist) { bestDist = md2; best = lyricsTransLines[mid2]; }
      if (mt2 < time) lo2 = mid2 + 1; else hi2 = mid2 - 1;
    }
  } else {
    for (var i = 0; i < n; i++) {
      var d = Math.abs(lyricsTransLines[i].t - time);
      if (d < bestDist) { bestDist = d; best = lyricsTransLines[i]; }
    }
  }
  return best && bestDist < 3.2 ? (best.text || '') : '';
}
function normalizeLyricStageLineText(text) {
  // 保留 \n 强制换行（原文在上、译文在下的上下布局），仅段内压缩空白
  var segs = String(text || '').split(/\n/);
  for (var i = 0; i < segs.length; i++) segs[i] = segs[i].replace(/\s+/g, ' ').trim();
  segs = segs.filter(function (s) { return s.length > 0; });
  return segs.join('\n');
}
function enrichLyricText(original, lineIdx) {
  var mode = fx.lyricTranslationMode || 'off';
  if (mode === 'off') return original;
  var line = (lineIdx >= 0 && lyricsLines[lineIdx]) ? lyricsLines[lineIdx] : null;
  var trans = line && line.translation
    ? line.translation
    : (line ? getLyricTranslation(line.t, line) : '');
  if (!trans) return original;
  // 译文统一排原文下方（\n 分两行），不再横排拼接（旧 dual 用 " | " 左右排）
  switch (mode) {
    case 'current': return original + '\n' + trans;
    case 'dual': return original + '\n' + trans;
    case 'multi': return original + '\n' + trans;
    default: return original;
  }
}
function currentStageLyricLineText(currentIdx) {
  if (currentIdx === -2) return normalizeLyricLineText(currentLyricFallbackText());
  if (currentIdx >= 0 && lyricsLines[currentIdx]) return normalizeLyricLineText(lyricsLines[currentIdx].text || '');
  return normalizeLyricLineText(stageLyrics.currentText || '');
}
function findUpcomingLyricIndex(currentIdx, currentText) {
  if (!lyricsLines || !lyricsLines.length) return -1;
  var start = currentIdx === -2 ? 0 : currentIdx + 1;
  // 允许调用方传入已规范化的 currentText，避免多行查找时重复 normalize
  if (currentText == null) currentText = currentStageLyricLineText(currentIdx);
  for (var i = start; i < lyricsLines.length; i++) {
    var text = normalizeLyricLineText(lyricsLines[i].text || '');
    if (!text || isNoLyricText(text)) continue;
    if (currentText && text === currentText) continue;
    return i;
  }
  return -1;
}
function getUpcomingLyricIndexAt(currentIdx, depth) {
  depth = Math.max(1, Math.round(Number(depth) || 1));
  var idx = currentIdx;
  var curText = currentStageLyricLineText(currentIdx);
  for (var d = 0; d < depth; d++) {
    idx = findUpcomingLyricIndex(idx, curText);
    if (idx < 0) return -1;
    curText = normalizeLyricLineText(lyricsLines[idx].text || '');
  }
  return idx;
}
function getUpcomingLyricTextAt(currentIdx, depth) {
  var idx = getUpcomingLyricIndexAt(currentIdx, depth);
  if (idx < 0) return '';
  return enrichLyricText(normalizeLyricLineText(lyricsLines[idx].text || ''), idx);
}
function getUpcomingLyricText(currentIdx) {
  var lineCount = getLyricLineCount();
  if (lineCount <= 1) return '';
  return getUpcomingLyricTextAt(currentIdx, 1);
}
function refreshStageDualLyricPreview() {
  if (!isLyricDualLine() || !fx.particleLyrics) {
    if (typeof hideStageNextLineSmooth === 'function') hideStageNextLineSmooth();
    if (typeof hideStageNext2LineSmooth === 'function') hideStageNext2LineSmooth();
    return;
  }
  if (typeof syncStageLyricPreviewLines === 'function') {
    syncStageLyricPreviewLines(stageLyrics.currentIdx);
    return;
  }
  var idx = stageLyrics.currentIdx;
  var text = getUpcomingLyricText(idx);
  if (text) {
    stageLyrics.nextIdx = findUpcomingLyricIndex(idx);
    showStageNextLine(text);
  } else {
    hideStageNextLineSmooth();
  }
}
function isNoLyricText(text) {
  var compact = String(text || '').replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '');
  return !compact ||
    compact === '纯音乐请欣赏' ||
    compact === '暂无歌词' ||
    compact === '暂无歌词敬请期待' ||
    compact === '此歌曲为没有填词的纯音乐请您欣赏';
}
function withLyricFallback(lines) {
  lines = Array.isArray(lines) ? lines.filter(function(line){ return line && String(line.text || '').trim(); }) : [];
  if (lines.length && !lines.every(function(line){ return isNoLyricText(line.text); })) return lines;
  var text = currentLyricFallbackText();
  return text ? [{ t:0, text:text, duration:9999, charCount:Math.max(1, text.length), fallback:true }] : [];
}
function lyricTagTimeToSeconds(min, sec, frac) {
  var t = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  if (frac) t += (parseInt(frac, 10) || 0) / Math.pow(10, Math.min(3, frac.length));
  return t;
}
function finalizeLyricLineDurations(lines) {
  lines.sort(function(a, b){ return a.t - b.t; });
  for (var i = 0; i < lines.length; i++) {
    var next = lines[i + 1];
    var inferred = next && next.t > lines[i].t ? next.t - lines[i].t : 4.8;
    if (!isFinite(lines[i].duration) || lines[i].duration <= 0) lines[i].duration = inferred;
    lines[i].duration = Math.max(0.45, Math.min(12, lines[i].duration));
    lines[i].charCount = Math.max(1, lines[i].charCount || String(lines[i].text || '').length);
  }
  return lines;
}
function parseLyricText(text) {
  var lines = [], reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  text.split(/\r?\n/).forEach(function(line){
    var times = [], m;
    reg.lastIndex = 0;
    while ((m = reg.exec(line))) times.push(lyricTagTimeToSeconds(m[1], m[2], m[3]));
    if (!times.length) return;
    var txt = line.replace(reg, '').trim();
    if (!txt) return;
    times.forEach(function(t){ lines.push({ t: t, text: txt, source:'lrc' }); });
  });
  return finalizeLyricLineDurations(lines);
}
function parseYrcText(text) {
  var lines = [];
  String(text || '').split(/\r?\n/).forEach(function(line){
    var m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) return;
    var lineStartMs = parseInt(m[1], 10) || 0;
    var lineDurMs = parseInt(m[2], 10) || 0;
    var body = m[3] || '';
    var words = [], fullText = '';
    var reg = /\((\d+),(\d+),\d+\)([^()]*)/g, wm;
    while ((wm = reg.exec(body))) {
      var txt = (wm[3] || '').replace(/\s+/g, ' ');
      if (!txt) continue;
      var rawStart = parseInt(wm[1], 10) || 0;
      var rawDur = parseInt(wm[2], 10) || 0;
      var absStartMs = rawStart >= lineStartMs - 500 ? rawStart : lineStartMs + rawStart;
      var c0 = fullText.length;
      fullText += txt;
      words.push({ text:txt, t:absStartMs / 1000, d:Math.max(0.06, rawDur / 1000), c0:c0, c1:fullText.length });
    }
    if (!fullText) fullText = body.replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
    var leading = (fullText.match(/^\s+/) || [''])[0].length;
    fullText = fullText.replace(/\s+/g, ' ').trim();
    if (!fullText) return;
    if (words.length) {
      words.forEach(function(w){
        w.c0 = Math.max(0, Math.min(fullText.length, w.c0 - leading));
        w.c1 = Math.max(w.c0, Math.min(fullText.length, w.c1 - leading));
      });
      words = words.filter(function(w){ return w.c1 > w.c0; });
    }
    lines.push({ t:lineStartMs / 1000, duration:lineDurMs / 1000, text:fullText, words:words, charCount:Math.max(1, fullText.length), source: words.length ? 'yrc-word' : 'yrc-line' });
  });
  return finalizeLyricLineDurations(lines);
}
function renderLyrics() {
  // v8: 歌词渲染由 stageLyrics 在每帧 tickLyricsParticles 里推动
  clearStageLyrics();
}
function toggleLyricsPanel(force) {
  if (classicPlayer.active) {
    if (force === true || (force == null && !fx.particleLyrics)) {
      showToast('经典预设已使用内置歌词');
      updatePlayerQuickMenuUi();
      return;
    }
    if (force === false || (force == null && fx.particleLyrics)) {
      setParticleLyricsSilently(false);
      if (force == null) showToast('歌词已关闭');
      return;
    }
  }
  if (force === false) fx.particleLyrics = false;
  else if (force === true) fx.particleLyrics = true;
  else fx.particleLyrics = !fx.particleLyrics;
  if (fx.particleLyrics) {
    createLyricsParticles();
    showToast('歌词已开启');
  } else {
    clearStageLyrics();
    showToast('歌词已关闭');
  }
  lyricsVisible = fx.particleLyrics;
  updatePlayerQuickMenuUi();
}
function toggleLyricsFromQuickMenu() {
  toggleLyricsPanel();
}
function updatePlayerQuickMenuUi() {
  var lyricsToggle = document.getElementById('quick-menu-lyrics-toggle');
  var timerActive = !!(sleepTimer && (sleepTimer.active || sleepTimer.pendingStop));
  var menuOpen = document.body.classList.contains('player-quick-menu-open');
  if (lyricsToggle) {
    var lyricsUiOn = !classicPlayer.active && !!fx.particleLyrics;
    lyricsToggle.classList.toggle('on', lyricsUiOn);
    lyricsToggle.classList.toggle('disabled', !!classicPlayer.active);
    lyricsToggle.title = classicPlayer.active ? '经典预设已使用内置歌词' : '歌词显示';
  }
  ['player-quick-menu-btn', 'player-quick-menu-btn-fs'].forEach(function(id){
    var menuBtn = document.getElementById(id);
    if (!menuBtn) return;
    menuBtn.classList.toggle('has-timer', timerActive);
    menuBtn.classList.toggle('active', menuOpen);
    menuBtn.title = timerActive ? '播放选项 · 定时关闭进行中' : '播放选项';
  });
}
function updateDualLyricsToggleButton() {
  updatePlayerQuickMenuUi();
}
function isLyricDualLine() {
  var mode = fx.lyricDisplayMode || 'dual';
  return mode !== 'single' && mode !== 'cinema';
}
function getLyricLineCount() {
  var mode = fx.lyricDisplayMode || 'dual';
  switch (mode) {
    case 'single': return 1;
    case 'cinema': return 1;
    case 'triple': return 3;
    case 'custom': return clampRange(Math.round(Number(fx.lyricCustomLines) || 3), 1, 10);
    case 'dual':
    default: return 2;
  }
}
function isLyricCinemaMode() {
  return (fx.lyricDisplayMode || 'dual') === 'cinema';
}
function stageNextLyricText(text) {
  if (!isLyricDualLine()) {
    hideStageNextLineSmooth();
    hideStageNext2LineSmooth();
    return;
  }
  if (!text) {
    hideStageNextLineSmooth();
    hideStageNext2LineSmooth();
    return;
  }
  showStageNextLine(text);
}
function updateLyricsHighlight() { /* v8: 由 tickLyricsParticles 接管 */ }

// ============================================================
//  AI 补译文：网易回落失败后，用已配置的 LLM 逐行翻译（默认关）
//  - 开关：localStorage mineradio-ai-translate-v1 === '1'（FX 面板「AI 补译文」）
//  - 服务端：POST /api/ai/translate（行数校验 + LRU 缓存）
//  - 回填：复用网易回落的 attachLyricTranslations + applyPreferredLyricsForCurrent 链路
// ============================================================
var AI_LYRIC_TRANSLATE_STORE_KEY = 'mineradio-ai-translate-v1';
var aiLyricTranslationCache = {};
var aiLyricTranslateInflight = {};
var aiLyricTranslateConfigState = { checkedAt: 0, configured: false };

function aiLyricTranslateEnabled() {
  try { return localStorage.getItem(AI_LYRIC_TRANSLATE_STORE_KEY) === '1'; } catch (_) { return false; }
}

function updateAiLyricTranslateToggle() {
  var el = document.getElementById('t-aiLyricTranslate');
  if (el) el.classList.toggle('on', aiLyricTranslateEnabled());
}

function toggleAiLyricTranslate() {
  var next = !aiLyricTranslateEnabled();
  try { localStorage.setItem(AI_LYRIC_TRANSLATE_STORE_KEY, next ? '1' : '0'); } catch (_) {}
  updateAiLyricTranslateToggle();
  if (typeof showToast === 'function') {
    showToast(next ? 'AI 补译文：已开启（歌词缺译文时自动翻译）' : 'AI 补译文：已关闭');
  }
  if (next) {
    var song = (typeof currentLyricSong === 'function') ? currentLyricSong() : null;
    if (song) scheduleAiLyricTranslationFallback(song, trackSwitchToken);
  }
}

function lyricLineMostlyCjk(text) {
  var s = String(text || '');
  if (!s) return false;
  var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  var letters = (s.match(/[A-Za-z]/g) || []).length;
  return cjk >= Math.max(2, letters);
}

async function aiLyricTranslateConfigured() {
  var now = Date.now();
  if (now - aiLyricTranslateConfigState.checkedAt < 300000) return aiLyricTranslateConfigState.configured;
  try {
    var data = await apiJson('/api/ai/config', { method: 'GET', timeoutMs: 6000 });
    aiLyricTranslateConfigState.configured = !!(data && data.configured);
  } catch (_) {
    aiLyricTranslateConfigState.configured = false;
  }
  aiLyricTranslateConfigState.checkedAt = now;
  return aiLyricTranslateConfigState.configured;
}

function buildAiTranslateSourceLines(lines) {
  var out = [];
  (lines || []).forEach(function (line) {
    if (!line || line.fallback) return;
    var text = normalizeLyricLineText(line.text);
    if (!text || text.length > 200 || (typeof isLyricCreditLineText === 'function' && isLyricCreditLineText(text))) return;
    out.push({ t: Number(line.t) || 0, text: text });
  });
  return out.slice(0, 100);
}

function mergeAiLyricTranslation(token, cacheKey, payload) {
  if (!payload || !payload.lines || !payload.lines.length) return false;
  if (token !== trackSwitchToken) return false;
  var currentSong = (typeof currentLyricSong === 'function') ? currentLyricSong() : null;
  if (lyricTranslationFallbackKey(currentSong) !== cacheKey) return false;
  if (originalLyricsState && originalLyricsState.translationLines && originalLyricsState.translationLines.length) return false;
  var mergedLines = attachLyricTranslations(originalLyricsState.lines || [], payload.lines);
  var attached = mergedLines.some(function (line) { return line && line.translation; });
  if (!attached) return false;
  setOriginalLyricsState(
    mergedLines,
    originalLyricsState.hasNativeKaraoke,
    originalLyricsState.timingSource,
    payload.lines,
    'ai-translate'
  );
  applyPreferredLyricsForCurrent(true);
  return true;
}

async function fetchAiLyricTranslation(song, token, cacheKey) {
  if (!song || token !== trackSwitchToken || !aiLyricTranslateEnabled()) return false;
  if (aiLyricTranslationCache[cacheKey]) return mergeAiLyricTranslation(token, cacheKey, aiLyricTranslationCache[cacheKey]);
  if (aiLyricTranslateInflight[cacheKey]) return false;
  var state = originalLyricsState;
  if (!state || !state.lines || !state.lines.length) return false;
  if (state.translationLines && state.translationLines.length) return false;
  var srcLines = buildAiTranslateSourceLines(state.lines);
  if (srcLines.length < 4) return false;
  // 已经主要是中文的歌词不需要翻译
  var cjkCount = 0;
  srcLines.forEach(function (l) { if (lyricLineMostlyCjk(l.text)) cjkCount++; });
  if (cjkCount > srcLines.length * 0.6) return false;
  if (!(await aiLyricTranslateConfigured())) return false;
  aiLyricTranslateInflight[cacheKey] = true;
  try {
    var data = await apiJson('/api/ai/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: srcLines, lang: 'zh' }),
      timeoutMs: 45000,
    });
    if (token !== trackSwitchToken) return false;
    var translations = data && data.translations;
    if (!Array.isArray(translations) || translations.length !== srcLines.length) return false;
    var payloadLines = [];
    for (var i = 0; i < srcLines.length; i++) {
      var text = normalizeLyricTranslationText(translations[i]);
      if (!text || text === srcLines[i].text) continue;
      payloadLines.push({ t: srcLines[i].t, text: text, source: 'ai' });
    }
    if (payloadLines.length < 4) return false;
    var payload = { lines: payloadLines };
    aiLyricTranslationCache[cacheKey] = payload;
    return mergeAiLyricTranslation(token, cacheKey, payload);
  } catch (_) {
    return false;
  } finally {
    delete aiLyricTranslateInflight[cacheKey];
  }
}

function scheduleAiLyricTranslationFallback(song, token) {
  if (!song || token !== trackSwitchToken) return;
  if (!aiLyricTranslateEnabled()) return;
  var cacheKey = lyricTranslationFallbackKey(song);
  setTimeout(function () {
    if (token !== trackSwitchToken) return;
    var start = function () { fetchAiLyricTranslation(song, token, cacheKey); };
    if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 2500 });
    else start();
  }, 1500);
}
