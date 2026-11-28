// ============================================================
//  歌词
// ============================================================
// ---- LX 音源取词兜底 ----
// 平台歌词接口经常对冷门/版权曲返回空壳。此时如果用户装了 LX 兼容音源，
// 就用同一份 musicInfo 再取一次（与取址兜底同一套映射，见 22a）。
// 只看行级 LRC 与翻译：LX 的 lxlyric 是逐字格式，现有管道解析不了。
function lyricResponseHasContent(r) {
  if (!r || typeof r !== 'object') return false;
  var keys = ['yrc', 'lyric', 'lrc'];
  for (var i = 0; i < keys.length; i++) {
    var value = r[keys[i]];
    if (typeof value === 'string' && value.trim().length > 20) return true;
  }
  return false;
}

async function tryLxSourceLyric(song) {
  if (!song || typeof song !== 'object') return null;
  if (typeof LxSource === 'undefined' || !LxSource || typeof LxSource.resolveLyric !== 'function') return null;
  if (typeof LxMusicInfo === 'undefined' || !LxMusicInfo) return null;
  var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : '';
  var source = LxMusicInfo.lxSourceKeyForProvider(provider);
  if (!source) return null;
  var info;
  try { info = LxMusicInfo.buildLxMusicInfo(provider, song); } catch (_) { return null; }
  if (!LxMusicInfo.hasUsableId(info)) return null;
  try {
    var got = await LxSource.resolveLyric(source, info);
    if (!got || !lyricResponseHasContent(got)) return null;
    return { lyric: got.lyric || '', tlyric: got.tlyric || '', source: 'lx' };
  } catch (_) {
    return null;
  }
}

async function fetchLyric(songOrId, token) {
  try {
    var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
    // 本地曲库曲目：歌词走主进程索引按需读取，不打平台歌词接口
    if (song && (song.type === 'local' || song.source === 'local' || song.localUrl)) {
      if (typeof applyLocalTrackLyricOnDemand === 'function') applyLocalTrackLyricOnDemand(song, token);
      return;
    }
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
    // 平台没给到歌词（空响应/只有占位）→ 有 LX 音源就再取一次
    if (!lyricResponseHasContent(r)) {
      var lxLyric = await tryLxSourceLyric(song);
      if (token !== trackSwitchToken) return;
      if (lxLyric) r = lxLyric;
    }
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
// 整份歌词响应的签名（原文 + 译文 + K 歌逐字），用于判断刷新回来的歌词是否与当前已应用的不同。
// 只比译文不够：缓存里被写错的**原文**（如酷狗因为 album_audio_id 串曲返回了别人的歌词/
// 中文有声书）在没有译文时永远等不到纠正。
var appliedLyricResponseSignature = '';
function lyricResponseSignature(response) {
  response = response || {};
  return [
    String(response.yrc || ''),
    String(response.lyric || response.lrc || ''),
    String(response.trans || response.tlyric || ''),
    String(response.ytlrc || '')
  ].join('\u0002');
}
function refreshPersistentLyricCache(song, token) {
  if (!song) return;
  var endpoint = typeof lyricEndpointForSong === 'function'
    ? lyricEndpointForSong(song)
    : ('/api/lyric?id=' + encodeURIComponent(song.id || ''));
  apiJson(endpoint).then(function (response) {
    if (!response || response.error) return;
    writePersistentLyricCache(song, response);
    // 缓存自愈：旧持久缓存可能是「无歌词」「错歌词」「错译文」
    // （如酷狗把别人的歌词/音译当歌词写进缓存的那批）。
    // 只要刷新响应的内容签名与当前已应用的不同，就重新应用让显示立即更新；
    // 相同则直接返回，避免每次切歌都重排字幕。
    if (typeof token === 'number' && token !== trackSwitchToken) return;
    if (lyricResponseSignature(response) === appliedLyricResponseSignature) return;
    if (!String(response.lyric || response.lrc || response.yrc || '').trim()) return;
    applyLyricApiResponse(response, token, song);
  }).catch(function () {});
}
/* ===== 歌词时间粒度（设置 → 歌词 → 歌词源）=====
 * 'auto'（默认）= 有逐字用逐字；'line' = 强制逐行。
 * 有些平台的 yrc 逐字时间轴是坏的（整句挤在同一个时间点），表现为「不跟着唱」，
 * 这时逐行反而更稳。这是 Folia keepProviderWordTiming 的反面开关。
 * 决策抽成纯函数，方便直接测（tests/lyric-granularity-guard.test.js）。 */
var LYRIC_GRANULARITY_STORE_KEY = 'mineradio:lyric-granularity:v1';
var lyricGranularityPreference = (function () {
  try { return localStorage.getItem(LYRIC_GRANULARITY_STORE_KEY) === 'line' ? 'line' : 'auto'; } catch (_) { return 'auto'; }
})();
/* 上一次真正应用过的响应：切粒度时要就地重算，不能等下一次取歌词 */
var lastAppliedLyricResponse = null;

function lyricLinesHaveWordTiming(lines) {
  for (var i = 0; i < (lines || []).length; i++) {
    if (lines[i] && lines[i].words && lines[i].words.length) return true;
  }
  return false;
}

function chooseLyricLines(nativeLines, lrcLines, mode) {
  nativeLines = nativeLines || [];
  lrcLines = lrcLines || [];
  /* 强制逐行：只有在确实有逐行候选时才生效；某首歌只回了逐字（没有 lyric 字段）
   * 也不能凭空造行级时间轴，那就照旧用逐字。 */
  if (mode === 'line' && lrcLines.length) {
    return {
      lines: lrcLines,
      hasNativeKaraoke: false,
      timingSource: (lrcLines[0] && lrcLines[0].source) || 'lrc-line'
    };
  }
  var lines = nativeLines.length ? nativeLines : lrcLines;
  var nativeWord = lyricLinesHaveWordTiming(nativeLines);
  var anyWord = nativeWord || lyricLinesHaveWordTiming(lrcLines);
  var timingSource;
  if (anyWord) timingSource = nativeWord ? 'yrc-word' : ((lrcLines[0] && lrcLines[0].source) || 'lrc-word');
  else timingSource = nativeLines.length ? 'yrc-line' : (lrcLines.length ? ((lrcLines[0] && lrcLines[0].source) || 'lrc-line') : 'fallback');
  return { lines: lines, hasNativeKaraoke: anyWord, timingSource: timingSource };
}

function applyLyricGranularityUi() {
  var seg = document.getElementById('lyric-granularity-seg');
  if (!seg) return;
  Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
    var active = btn.getAttribute('data-lyric-granularity') === lyricGranularityPreference;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setLyricGranularity(mode) {
  lyricGranularityPreference = mode === 'line' ? 'line' : 'auto';
  try { localStorage.setItem(LYRIC_GRANULARITY_STORE_KEY, lyricGranularityPreference); } catch (_) { }
  applyLyricGranularityUi();
  /* 就地重算：用户正在听这首歌，不该等下次切歌才看到变化 */
  if (lastAppliedLyricResponse) {
    try {
      var song = typeof lyricTimingCurrentSong === 'function' ? lyricTimingCurrentSong() : null;
      applyLyricApiResponse(lastAppliedLyricResponse, trackSwitchToken, song);
      if (typeof showToast === 'function') {
        showToast(lyricGranularityPreference === 'line' ? '歌词已切换为逐行显示' : '歌词已切回自动（优先逐字）');
      }
      return;
    } catch (_) { }
  }
  if (typeof showToast === 'function') {
    showToast(lyricGranularityPreference === 'line' ? '歌词粒度: 逐行' : '歌词粒度: 自动');
  }
}

function applyLyricApiResponse(r, token, song) {
  if (token !== trackSwitchToken) return;
  r = r || {};
  appliedLyricResponseSignature = lyricResponseSignature(r);
  var nativeLines = parseYrcText(r.yrc || '');
  var lrcLines = parseLyricText(r.lyric || '');
  var translationPayload = buildLyricTranslationPayload(r);
  lyricsTransLines = translationPayload.lines || [];
  lyricsTranslationLines = lyricsTransLines;
  /* 2026-11-23：逐字不再只有 YRC 能给 —— TTML / VTT / LDDC 解析出来同样带 words。
   * 原来只查 nativeLines，这些格式的逐字会被当成逐行，动效退化成整行扫过。
   * 2026-11-25：选哪一份交给 chooseLyricLines()，它同时考虑用户的「强制逐行」设置。 */
  var chosenLyrics = chooseLyricLines(nativeLines, lrcLines, lyricGranularityPreference);
  var hasNativeKaraoke = chosenLyrics.hasNativeKaraoke;
  var timingSource = chosenLyrics.timingSource;
  var lines = withLyricFallback(chosenLyrics.lines);
  lastAppliedLyricResponse = r;
  if (lines.length && lines[0].fallback) timingSource = 'fallback';
  lines = attachLyricTranslations(lines, lyricsTransLines);
  var translationSource = translationPayload.lines.length ? translationPayload.source : 'none';
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
/* 歌词兜底候选必须落在「同一录音」上，标题相同不够。
 *
 * 事故形态：同题同艺人但存在 Live / 重录 / remaster / 加速版时，搜索相关性分
 * （scoreSongSearchResult）看不出差别，兜底会把那一版的译文按行序贴到当前曲目上
 * —— 正文没错、译文整段错位，比没有译文更糟（译文是按行序号/时间戳贴的）。
 * 判据与 server/lib/netease-source-match.js 同源：版本标记集合必须完全一致；
 * 双方都有时长时差值不得超过 max(5s, 2%)，上限 10s。
 * 只认「有明确版本标记」的词（live/remaster/重录/伴奏…），不引入泛化的 version：
 * 那会把「正式版 vs 专辑版」这类正常匹配一起拒掉，兜底覆盖率下降等于没有译文。 */
var LYRIC_FALLBACK_VERSION_RULES = [
  ['live', /\blive\b|现场|演唱会/],
  ['cover', /\bcover\b|翻唱/],
  ['remix', /\bremix\b|mix版|\bdj\b|dj版/],
  ['remaster', /\bremaster(?:ed)?\b|重制/],
  ['rerecord', /\bre[ -]?record(?:ed|ing)?\b|重录/],
  ['instrumental', /\binstrumental\b|伴奏|\bkaraoke\b|纯音乐/],
  ['acoustic', /\bacoustic\b|不插电/],
  ['speed', /\bnightcore\b|\bsped[ -]?up\b|\bslowed\b|加速|慢速|变速/],
  ['edit', /\bradio edit\b|\bedit\b|剪辑/],
  ['demo', /\bdemo\b|试听版/]
];
function lyricFallbackVersionTokens(text) {
  var raw = String(text || '').toLowerCase()
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/【/g, '[').replace(/】/g, ']');
  var tokens = [];
  for (var i = 0; i < LYRIC_FALLBACK_VERSION_RULES.length; i++) {
    if (LYRIC_FALLBACK_VERSION_RULES[i][1].test(raw)) tokens.push(LYRIC_FALLBACK_VERSION_RULES[i][0]);
  }
  return tokens.join(',');
}
/* 与 04-progress-seek 的 normalizePlaybackDurationSeconds 同一口径：>1000 视为毫秒。
 * 服务端所有在线曲目（网易/QQ/酷狗/汽水）的 duration 都已归一成毫秒。 */
function lyricFallbackDurationSeconds(song) {
  song = song || {};
  var raw = Number(song.duration || song.durationMs || song.dt || song.interval || 0) || 0;
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 1000 ? raw / 1000 : raw;
}
function lyricFallbackCandidateRejectReason(song, candidate) {
  if (!candidate) return 'no_candidate';
  var wantTokens = lyricFallbackVersionTokens((song && (song.name || song.title)) || '');
  var gotTokens = lyricFallbackVersionTokens(candidate.name || candidate.title || '');
  if (wantTokens !== gotTokens) return 'version_mismatch';
  var want = lyricFallbackDurationSeconds(song);
  var got = lyricFallbackDurationSeconds(candidate);
  if (want > 0 && got > 0) {
    var tolerance = Math.min(10, Math.max(5, want * 0.02));
    if (Math.abs(got - want) > tolerance) return 'duration_mismatch';
  }
  return '';
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
  // 版本/时长闸门：同题翻唱、Live、重录、remaster 不许供译文
  list = list.filter(function (candidate) {
    return !lyricFallbackCandidateRejectReason(song, candidate);
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
/* ===== 歌词译文显示（默认开）=====
 * 译文是通过 attachLyricTranslations() 并进原文行的（原文上、译文下）。
 * 三个调用点全在 06-lyrics 内部，所以只要在这一个函数入口处拦住，
 * 舞台歌词 / 经典歌词 / 桌面歌词 / 悬浮小组件都会一起生效。 */
var LYRIC_TRANSLATION_VISIBLE_STORE_KEY = 'mineradio:lyric-translation-visible:v1';
var lyricTranslationVisiblePreference = (function () {
  try { return localStorage.getItem(LYRIC_TRANSLATION_VISIBLE_STORE_KEY) !== 'false'; } catch (_) { return true; }
})();
function lyricTranslationVisible() {
  return !!lyricTranslationVisiblePreference;
}
function applyLyricTranslationVisibleUi() {
  var node = document.getElementById('t-lyricTranslationVisible');
  if (!node) return;
  node.classList.toggle('on', !!lyricTranslationVisiblePreference);
  var dot = node.querySelector('.dot');
  if (dot) dot.classList.toggle('on', !!lyricTranslationVisiblePreference);
}
function toggleLyricTranslationVisible() {
  lyricTranslationVisiblePreference = !lyricTranslationVisiblePreference;
  try { localStorage.setItem(LYRIC_TRANSLATION_VISIBLE_STORE_KEY, String(lyricTranslationVisiblePreference)); } catch (_) { }
  applyLyricTranslationVisibleUi();
  /* 就地重算：不等下次切歌 */
  if (lastAppliedLyricResponse) {
    try {
      var song = typeof lyricTimingCurrentSong === 'function' ? lyricTimingCurrentSong() : null;
      applyLyricApiResponse(lastAppliedLyricResponse, trackSwitchToken, song);
    } catch (_) { }
  }
  if (typeof showToast === 'function') {
    showToast(lyricTranslationVisiblePreference ? '歌词译文已显示' : '歌词译文已隐藏（原文保留）');
  }
}

function attachLyricTranslations(primaryLines, translationLines) {
  var primary = cloneLyricLines(primaryLines || []);
  /* 关掉译文时直接返回原文行。注意仍然要 clone：调用方会继续往行上写样式字段。 */
  if (!lyricTranslationVisiblePreference) return primary;
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
/* ---------- 多格式歌词解析（2026-11-23） ----------
 * 原来只认 LRC 与 QQ 的 YRC。本地曲库和外部歌词源里还有：
 *   · TTML —— W3C / AMLL 的逐字歌词标准，<p begin><span begin> 两层时间轴；
 *   · WebVTT —— 字幕标准，"00:00:01.000 --> 00:00:03.000" 后跟文本；
 *   · LDDC 增强 LRC —— [mm:ss.xx]<t,d>字<t,d>字，角括号带逐字时间。
 * 这里在 parseLyricText 入口按内容探测格式再分发，所有现有调用点自动受益
 * （包括本地库 sidecar、在线歌词、详情页预览），不用逐个改签名。
 * KRC 不在此列：它是 krc1 头 + base64 + zlib + XOR 的二进制格式，
 * 要先在 Node 侧解密成明文才能进这里。 */

/* 时间值归一：支持 "hh:mm:ss.mmm" / "mm:ss.mmm" / "ss.mmm" / 纯秒数 */
function lyricTimeToSeconds(value) {
  var str = String(value == null ? '' : value).trim();
  if (!str) return NaN;
  var m = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (m) {
    var hours = m[1] ? parseInt(m[1], 10) : 0;
    return hours * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }
  var num = parseFloat(str);
  return isFinite(num) ? num : NaN;
}

function decodeLyricEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(parseInt(code, 10) || 32); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, code) { return String.fromCharCode(parseInt(code, 16) || 32); })
    .replace(/&amp;/g, '&');
}

function stripLyricMarkup(value) {
  return decodeLyricEntities(String(value == null ? '' : value).replace(/<[^>]*>/g, ''));
}

/* 内容探测：宁可回落到 lrc，也不要把普通歌词误判成结构化格式。
 * 判定都要求「格式独有的强特征」出现在文本开头或结构位置。 */
/* words 是按顺序拼进 fullText 的，但拼的过程中会折叠空白、trim 首尾，
 * 之前记下的 c0/c1 就对不上了。逐字动效直接拿 c0/c1 去 slice 文本，
 * 所以这里统一用 indexOf 从头重算一遍，保证 slice 出来的就是该字的文本。 */
function reindexWordRanges(fullText, words) {
  if (!fullText || !words || !words.length) return words || [];
  var cursor = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var text = String(w.text || '').trim();
    w.text = text;
    var idx = text ? fullText.indexOf(text, cursor) : -1;
    if (idx < 0) idx = Math.min(cursor, fullText.length);
    w.c0 = idx;
    w.c1 = Math.min(fullText.length, idx + text.length);
    cursor = w.c1;
  }
  return words;
}

function detectLyricFormat(text) {
  var src = String(text == null ? '' : text);
  var head = src.replace(/^\uFEFF/, '').trimStart();
  if (!head) return 'lrc';
  if (/^WEBVTT\b/i.test(head)) return 'vtt';
  if (/^<\?xml/i.test(head) || /^<tt[\s>]/i.test(head) || /<p\b[^>]*\bbegin\s*=/i.test(head)) return 'ttml';
  if (/^krc1/i.test(head)) return 'krc';
  if (/^\[\d+\s*,\s*\d+\]/.test(head)) return 'yrc';
  /* 增强 LRC：行首时间标签后紧跟逐字时间（角括号，值为 mm:ss 或 数字） */
  if (/^\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\][ \t]*</.test(head)) return 'lddc';
  return 'lrc';
}

/* TTML：<p begin end> 是行，<span begin end> 是字。
 * 时间轴可能是 hh:mm:ss.mmm 或 秒.毫秒；缺 end 时由 finalizeLyricLineDurations 兜底。 */
function parseTtmlText(text) {
  var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  var lines = [];
  var pReg = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  var pm;
  while ((pm = pReg.exec(src))) {
    var attrs = pm[1] || '';
    var inner = pm[2] || '';
    var begin = lyricTimeToSeconds((attrs.match(/\bbegin\s*=\s*"([^"]*)"/i) || [])[1]);
    var end = lyricTimeToSeconds((attrs.match(/\bend\s*=\s*"([^"]*)"/i) || [])[1]);
    if (!isFinite(begin)) continue;

    var words = [];
    var fullText = '';
    var sReg = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
    var sm;
    var sawSpan = false;
    while ((sm = sReg.exec(inner))) {
      var sAttrs = sm[1] || '';
      var txt = stripLyricMarkup(sm[2]).replace(/\s+/g, ' ');
      if (!txt) continue;
      sawSpan = true;
      var st = lyricTimeToSeconds((sAttrs.match(/\bbegin\s*=\s*"([^"]*)"/i) || [])[1]);
      var et = lyricTimeToSeconds((sAttrs.match(/\bend\s*=\s*"([^"]*)"/i) || [])[1]);
      var startAt = isFinite(st) ? st : begin;
      var dur = isFinite(et) && et > startAt ? et - startAt : 0;
      var c0 = fullText.length;
      fullText += txt;
      words.push({
        text: txt,
        t: startAt,
        d: dur > 0 ? Math.max(0.06, dur) : 0.14,
        c0: c0,
        c1: fullText.length
      });
    }
    if (!sawSpan) fullText = stripLyricMarkup(inner);
    fullText = fullText.replace(/\s+/g, ' ').trim();
    if (!fullText) continue;

    /* 折叠空白 + trim 之后原来的偏移不再可靠，按实际文本重算 */
    if (words.length) reindexWordRanges(fullText, words);

    lines.push({
      t: begin,
      duration: isFinite(end) && end > begin ? end - begin : 0,
      text: fullText,
      words: words,
      charCount: Math.max(1, fullText.length),
      source: words.length ? 'ttml-word' : 'ttml-line'
    });
  }
  return finalizeLyricLineDurations(lines);
}

/* WebVTT：按块解析。一个 cue = 时间行 + 其后到空行之间的文本。
 * 支持 cue 标识行、行内 <c>/<v>/<b> 标签，以及行内 <00:00:01.000> 时间戳（保留为逐字）。 */
function parseVttText(text) {
  var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  var blocks = src.split(/\n{2,}/);
  var lines = [];
  var timeLineReg = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}\.\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}\.\d{1,3})/;
  blocks.forEach(function (block) {
    var rows = block.split('\n');
    var idx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (timeLineReg.test(rows[i])) { idx = i; break; }
    }
    if (idx < 0) return;
    var tm = rows[idx].match(timeLineReg);
    var start = lyricTimeToSeconds(tm[1]);
    var end = lyricTimeToSeconds(tm[2]);
    if (!isFinite(start)) return;

    var body = rows.slice(idx + 1).join('\n');
    if (!body.trim()) return;

    /* 行内时间戳：<00:00:12.345>字 —— 有就按逐字处理 */
    var words = [];
    var fullText = '';
    var inlineReg = /<((?:\d+:)?\d{1,2}:\d{1,2}\.\d{1,3})>([^<]*)/g;
    var im;
    var sawInline = false;
    while ((im = inlineReg.exec(body))) {
      var txt = stripLyricMarkup(im[2]).replace(/\s+/g, ' ');
      if (!txt) continue;
      sawInline = true;
      var at = lyricTimeToSeconds(im[1]);
      var c0 = fullText.length;
      fullText += txt;
      words.push({ text: txt, t: isFinite(at) ? at : start, d: 0.14, c0: c0, c1: fullText.length });
    }
    if (!sawInline) fullText = stripLyricMarkup(body).replace(/\s*\n\s*/g, ' ');
    fullText = fullText.replace(/\s+/g, ' ').trim();
    if (!fullText) return;

    /* 逐字的时长交给 finalize 之外再补一层：用下一个字的时间差 */
    if (words.length) {
      for (var w = 0; w < words.length; w++) {
        var nextT = w + 1 < words.length ? words[w + 1].t : (isFinite(end) ? end : words[w].t + 0.4);
        var span = nextT - words[w].t;
        words[w].d = Math.max(0.06, span > 0 ? span : 0.12);
      }
      reindexWordRanges(fullText, words);
    }

    lines.push({
      t: start,
      duration: isFinite(end) && end > start ? end - start : 0,
      text: fullText,
      words: words,
      charCount: Math.max(1, fullText.length),
      source: words.length ? 'vtt-word' : 'vtt-line'
    });
  });
  return finalizeLyricLineDurations(lines);
}

/* LDDC 增强 LRC：[mm:ss.xx]<t,d>字<t,d>字
 * 角括号里的 t 可以是绝对时间（mm:ss.xx）也可以是相对行首的毫秒/秒数字。
 * 判据同 parseYrcText：数值明显小于行起点时视为相对偏移。 */
function parseEnhancedLrcText(text) {
  var lines = [];
  String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach(function (row) {
    var head = row.match(/^\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]([\s\S]*)$/);
    if (!head) return;
    var lineStart = parseInt(head[1], 10) * 60 + parseInt(head[2], 10) +
      (head[3] ? parseFloat('0.' + head[3]) : 0);
    var body = head[4] || '';
    if (!body.trim()) return;

    var words = [];
    var fullText = '';
    var reg = /<([^<>]+)>([^<]*)/g;
    var m;
    while ((m = reg.exec(body))) {
      var stamp = String(m[1] || '').trim();
      var txt = decodeLyricEntities(m[2] || '').replace(/\s+/g, ' ');
      if (!txt) continue;

      var t = NaN;
      var d = 0;
      if (/^\d{1,2}:\d{1,2}/.test(stamp)) {
        t = lyricTimeToSeconds(stamp);
      } else {
        var parts = stamp.split(',');
        var raw = parseFloat(parts[0]);
        if (isFinite(raw)) {
          if (parts.length > 1) {
            /* <t,d>：两个值都是毫秒、相对行首（LDDC / YRC 的共同约定）。
             * 不能靠「数值是否大于行起点」判断 —— 500 既可能是 0.5s 偏移，
             * 也可能被误当成 500 秒绝对时间。 */
            t = lineStart + raw / 1000;
          } else {
            t = raw >= lineStart - 0.5 ? raw : lineStart + raw / 1000;
          }
        }
        var dur = parseFloat(parts[1]);
        if (isFinite(dur)) d = dur / 1000;
      }
      if (!isFinite(t)) t = lineStart;

      var c0 = fullText.length;
      fullText += txt;
      words.push({ text: txt, t: t, d: d > 0 ? Math.max(0.06, d) : 0.14, c0: c0, c1: fullText.length });
    }
    if (!fullText) {
      fullText = decodeLyricEntities(body.replace(/<[^<>]+>/g, '')).replace(/\s+/g, ' ').trim();
      words = [];
    }
    fullText = String(fullText).replace(/\s+/g, ' ').trim();
    if (!fullText) return;

    if (words.length) {
      reindexWordRanges(fullText, words);
      /* 缺时长的字用下一个字补齐 */
      for (var i = 0; i < words.length; i++) {
        if (words[i].d > 0.14) continue;
        var next = i + 1 < words.length ? words[i + 1].t : words[i].t + 0.4;
        var span = next - words[i].t;
        if (span > 0 && span < 3) words[i].d = Math.max(0.06, span);
      }
    }

    lines.push({
      t: lineStart,
      duration: 0,
      text: fullText,
      words: words,
      charCount: Math.max(1, fullText.length),
      source: words.length ? 'lddc-word' : 'lddc-line'
    });
  });
  return finalizeLyricLineDurations(lines);
}

function parseLyricText(text) {
  /* 2026-11-23：先探格式再分发。返回结构与 LRC 分支完全一致，
   * 调用方（本地库/在线歌词/详情页预览）无需改动。 */
  switch (detectLyricFormat(text)) {
    case 'ttml': return parseTtmlText(text);
    case 'vtt': return parseVttText(text);
    case 'lddc': return parseEnhancedLrcText(text);
    case 'yrc': return parseYrcText(text);
    default: break;
  }
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
  // v8: 歌词渲染由 stageLyrics 在每帧 tickLyricsParticles 里推动。
  // 换歌交接（借鉴 Folia 的两帧交接）：旧行不硬清，交给下一帧 showStageLine 走 outgoing 淡出，
  // 避免切歌 / 换歌词源瞬间「旧词消失 → 空窗 → 新词出现」的闪断。
  if (typeof handoffStageLyricsForNewTrack === 'function' && handoffStageLyricsForNewTrack()) return;
  clearStageLyrics();
}
/* 「歌词显示」开关功能已整体移除（2026-11-08）：舞台歌词恒定显示，不再提供
 * 快捷菜单开关、L 键与对应的状态同步。fx.particleLyrics 仍保留给经典预设、
 * 沉浸模式等内部互斥逻辑（setParticleLyricsSilently），并由预设恢复强制为 true，
 * 确保旧存档里的 false 不会再让歌词消失。 */
function updatePlayerQuickMenuUi() {
  var timerActive = !!(sleepTimer && (sleepTimer.active || sleepTimer.pendingStop));
  var menuOpen = document.body.classList.contains('player-quick-menu-open');
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
  /* 两个入口共用同一个开关状态：视觉控制台那个 + 设置 → AI 里那个 */
  var on = aiLyricTranslateEnabled();
  ['t-aiLyricTranslate', 't-aiLyricTranslateSettings'].forEach(function (id) {
    var node = document.getElementById(id);
    if (node) node.classList.toggle('on', on);
  });
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
