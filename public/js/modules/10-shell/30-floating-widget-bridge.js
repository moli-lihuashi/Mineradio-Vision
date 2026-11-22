// =============================================================================
// 悬浮小组件桥接（Enhanced Remote Widget 1.15.5，MIT）
//
// 原版是「官方 Folia 桌面版」的模组：页面侧 client.mjs 通过 folium.rpc 把播放状态
// 推给模组主进程，主进程再转发给小组件窗口；窗口操作走 pollActions 回传。
//
// 本项目没有主进程模组沙箱，这里用 desktop/preload.js 暴露的 desktopWindow.floatingWidget
// 重建同一套数据流（主进程宿主见 desktop/floating-widget.js）：
//   本模块  ──sync(payload)──▶  主进程  ──widget-update──▶  小组件窗口
//   本模块  ◀──onAction──       主进程  ◀──widget-action──   小组件窗口
//
// 数据契约与原版 client.mjs 的 pushCurrentState 保持一致，小组件前端零改动。
// =============================================================================

var floatingWidgetBridgeStarted = false;
var floatingWidgetBridgeTimer = 0;
var floatingWidgetBridgeVisible = false;
var floatingWidgetBridgeLastSongKey = '';
var floatingWidgetBridgeLyricsSongKey = '';
var floatingWidgetBridgeLyricsSignature = '';
var floatingWidgetBridgeUnsubAction = null;
var floatingWidgetBridgeUnsubVisibility = null;
/* 歌词时钟推送间隔：小组件自己按 lyricPosition + 本地时间插值，4Hz 足够平滑。 */
var FLOATING_WIDGET_CLOCK_INTERVAL_MS = 250;

/** 歌词数组签名：长度 + 首末行时间。歌词异步晚到时签名会变，触发一次完整重推。 */
function floatingWidgetBridgeLyricSignature() {
  var lines = (typeof lyricsLines !== 'undefined' && Array.isArray(lyricsLines)) ? lyricsLines : [];
  if (!lines.length) return '0';
  var first = lines[0] && isFinite(lines[0].t) ? Number(lines[0].t) : -1;
  var last = lines[lines.length - 1];
  var lastT = last && isFinite(last.t) ? Number(last.t) : -1;
  return lines.length + ':' + first + ':' + lastT;
}

function floatingWidgetBridgeHost() {
  try {
    if (typeof desktopWindow !== 'undefined' && desktopWindow && desktopWindow.floatingWidget) {
      return desktopWindow.floatingWidget;
    }
  } catch (_) {}
  return null;
}

function floatingWidgetBridgeSong() {
  try {
    if (typeof currentCoverSong === 'function') return currentCoverSong();
  } catch (_) {}
  if (typeof currentIdx !== 'undefined' && currentIdx >= 0 && typeof playQueue !== 'undefined' && playQueue[currentIdx]) {
    return playQueue[currentIdx];
  }
  return null;
}

/* 各平台把专辑/歌手放在不同字段里（本项目 song.album 是主字段，
 * 但列表项常见 albumName / album_name；歌手有 artist / artists / singer）。
 * 小组件显示「未知专辑」几乎都是这里漏了别名。 */
function floatingWidgetBridgeAlbum(song) {
  if (!song) return '';
  const raw = song.album || song.albumName || song.album_name || song.albumname
    || song.albumTitle || song.album_title
    /* 网易云风格 al.name、部分平台把元信息塞在 data 里 */
    || (song.al && (song.al.name || song.al.title))
    || (song.data && (song.data.album || song.data.albumName))
    || '';
  if (raw && typeof raw === 'object') {
    return String(raw.name || raw.title || raw.albumName || '');
  }
  return String(raw || '');
}

/* 专辑补全：源数据大面积缺专辑（用户实测「全部歌曲都是未知专辑」），
 * 拿歌名+歌手去 /api/search 查一次，成功就写缓存并重推。
 * 每首歌只查一次，失败静默——不能因为补全把小组件拖慢。 */
var floatingWidgetAlbumCache = {};
var floatingWidgetAlbumPending = {};

function floatingWidgetBridgeAlbumFromCache(song) {
  if (!song) return '';
  var key = String(song.name || song.title || '') + '|' + String(song.artist || '');
  return floatingWidgetAlbumCache[key] || '';
}

function floatingWidgetBridgeCompleteAlbum(song) {
  if (!song) return;
  var title = String(song.name || song.title || '').trim();
  if (!title) return;
  var key = title + '|' + String(song.artist || '');
  if (floatingWidgetAlbumCache[key] || floatingWidgetAlbumPending[key]) return;
  if (typeof fetch !== 'function') return;
  floatingWidgetAlbumPending[key] = true;
  var url = '/api/search?keywords=' + encodeURIComponent(title) + '&limit=6';
  Promise.resolve()
    .then(function () { return fetch(url); })
    .then(function (res) { return res && res.ok ? res.json() : null; })
    .then(function (json) {
      var list = (json && (json.songs || json.data || json.result)) || [];
      var wantArtist = String(song.artist || '').toLowerCase();
      for (var i = 0; i < list.length; i++) {
        var cand = list[i];
        if (!cand) continue;
        var candTitle = String(cand.name || cand.title || '').trim();
        if (candTitle !== title) continue;
        if (wantArtist) {
          var candArtist = floatingWidgetBridgeArtist(cand).toLowerCase();
          if (candArtist && candArtist.indexOf(wantArtist) < 0 && wantArtist.indexOf(candArtist) < 0) continue;
        }
        var album = floatingWidgetBridgeAlbum(cand);
        if (!album) continue;
        floatingWidgetAlbumCache[key] = album;
        /* 补全到手：重推一次，小组件立刻换掉「未知专辑」 */
        floatingWidgetBridgePush(false);
        return;
      }
    })
    .catch(function () { /* 网络/未登录：静默，下次播放再说 */ })
    .then(function () { delete floatingWidgetAlbumPending[key]; });
}

function floatingWidgetBridgeArtist(song) {
  if (!song) return '';
  const raw = song.artist || song.artists || song.singer || song.artistName || song.artist_name || '';
  if (Array.isArray(raw)) {
    return raw.map((a) => (a && typeof a === 'object') ? (a.name || a.title || '') : String(a || ''))
      .filter(Boolean).join(' / ');
  }
  if (raw && typeof raw === 'object') return String(raw.name || raw.title || '');
  return String(raw || '');
}

/** 与原版 getSongKey 同构：优先 ref，其次 source/id/文本。 */
function floatingWidgetBridgeSongKey(song) {
  if (!song) return '';
  if (song.ref) return String(song.ref);
  return JSON.stringify([
    song.source || '', song.id || '',
    song.name || song.title || '', song.artist || '', song.album || '',
  ]);
}

/** 跨重启稳定的歌曲身份：id 优先，否则用文本三元组。 */
function floatingWidgetBridgePersistentKey(song) {
  if (!song) return '';
  return JSON.stringify(song.id
    ? [song.source || '', song.id]
    : [song.source || '', song.name || song.title || '', song.artist || '', song.album || '']);
}

function floatingWidgetBridgePlaybackState() {
  var isPlaying = false;
  try { isPlaying = !!playing && !!audio && !audio.paused; } catch (_) {}
  if (isPlaying) return 'playing';
  var hasSource = false;
  try { hasSource = !!(audio && (audio.src || audio.currentSrc)); } catch (_) {}
  return hasSource ? 'paused' : 'stopped';
}

function floatingWidgetBridgePosition() {
  try { return audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0; } catch (_) { return 0; }
}

function floatingWidgetBridgeDuration() {
  try {
    if (audio && isFinite(audio.duration) && audio.duration > 0) return Number(audio.duration);
  } catch (_) {}
  var song = floatingWidgetBridgeSong();
  if (song) {
    try {
      if (typeof playbackDurationFromSong === 'function') {
        var d = playbackDurationFromSong(song);
        if (isFinite(d) && d > 0) return d;
      }
    } catch (_) {}
  }
  return 0;
}

/** 歌词行：本项目的 {t, duration, text, words:[{text,t,d}]} → 小组件的 {startTime,…,fullText}。 */
function floatingWidgetBridgeLyrics() {
  var lines = (typeof lyricsLines !== 'undefined' && Array.isArray(lyricsLines)) ? lyricsLines : [];
  if (!lines.length) return null;
  var trans = (typeof lyricsTranslationLines !== 'undefined' && Array.isArray(lyricsTranslationLines))
    ? lyricsTranslationLines : [];
  /* 译文按时间分桶（0.1s 精度），避免逐行线性扫描 O(n²) */
  var transByBucket = null;
  if (trans.length) {
    transByBucket = {};
    for (var t = 0; t < trans.length; t++) {
      var tl = trans[t];
      if (!tl || !isFinite(tl.t) || !tl.text) continue;
      transByBucket[Math.round(Number(tl.t) * 10)] = String(tl.text);
    }
  }
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || !isFinite(line.t)) continue;
    var start = Number(line.t);
    var next = lines[i + 1];
    var end = (isFinite(line.duration) && line.duration > 0)
      ? start + Number(line.duration)
      : (next && next.t > start ? Number(next.t) : start + 6);
    var translation = '';
    if (transByBucket) {
      var bucket = Math.round(start * 10);
      translation = transByBucket[bucket] || transByBucket[bucket - 1] || transByBucket[bucket + 1] || '';
    }
    var words = [];
    if (Array.isArray(line.words)) {
      for (var w = 0; w < line.words.length; w++) {
        var word = line.words[w];
        if (!word || !isFinite(word.t)) continue;
        words.push({
          text: String(word.text || ''),
          startTime: Number(word.t),
          endTime: Number(word.t) + (isFinite(word.d) && word.d > 0 ? Number(word.d) : 0),
        });
      }
    }
    var entry = {
      startTime: start,
      endTime: end,
      fullText: String(line.text || ''),
    };
    if (translation && translation !== entry.fullText) entry.translation = translation;
    if (words.length) entry.words = words;
    out.push(entry);
  }
  if (!out.length) return null;
  var isWordByWord = false;
  try { isWordByWord = !!lyricsHasNativeKaraoke; } catch (_) {}
  return { isWordByWord: isWordByWord, lines: out };
}

function floatingWidgetBridgeActiveLineText(position) {
  var lines = (typeof lyricsLines !== 'undefined' && Array.isArray(lyricsLines)) ? lyricsLines : [];
  if (!lines.length) {
    try { if (typeof currentLyricFallbackText === 'function') return String(currentLyricFallbackText() || ''); } catch (_) {}
    return '';
  }
  var idx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (isFinite(lines[i].t) && Number(lines[i].t) <= position + 0.05) idx = i;
    else break;
  }
  if (idx < 0) return '';
  return String(lines[idx].text || '');
}

/**
 * 构造与原版 client.mjs 一致的 payload。
 * 完整歌词只在切歌后首次推送（体积大）；其余走增量，小组件用 lyricPosition 插值。
 * 歌词是异步加载的，切歌瞬间 lyricsLines 可能还是上一首 —— 用歌词签名兜住晚到。
 */
function floatingWidgetBridgePayload(includeLyrics) {
  var song = floatingWidgetBridgeSong();
  var songKey = floatingWidgetBridgeSongKey(song);
  var position = floatingWidgetBridgePosition();
  var lyricPosition = position;
  try {
    if (typeof getAdjustedLyricPlaybackTime === 'function') lyricPosition = getAdjustedLyricPlaybackTime(position);
  } catch (_) {}
  var payload = {
    songKey: songKey,
    songPersistentKey: floatingWidgetBridgePersistentKey(song),
    title: song ? String(song.name || song.title || '') : '',
    artist: floatingWidgetBridgeArtist(song),
    /* 源数据缺专辑时先看补全缓存，缓存也没有就触发一次后台补全（成功后重推）。 */
    album: (function () {
      var direct = floatingWidgetBridgeAlbum(song);
      if (direct) return direct;
      var cached = floatingWidgetBridgeAlbumFromCache(song);
      if (cached) return cached;
      floatingWidgetBridgeCompleteAlbum(song);
      return '';
    })(),
    coverUrl: '',
    position: position,
    duration: floatingWidgetBridgeDuration(),
    state: floatingWidgetBridgePlaybackState(),
    lyricPosition: isFinite(lyricPosition) ? lyricPosition : position,
    lyricRate: floatingWidgetBridgePlaybackState() === 'playing' ? 1 : 0,
    liked: false,
    canLike: !!song,
    currentLyric: floatingWidgetBridgeActiveLineText(lyricPosition),
  };
  try {
    if (song && typeof songCoverSrc === 'function') payload.coverUrl = String(songCoverSrc(song, 300) || '');
  } catch (_) {}
  try {
    if (song && typeof isSongLiked === 'function') payload.liked = !!isSongLiked(song);
  } catch (_) {}
  var signature = floatingWidgetBridgeLyricSignature();
  if (includeLyrics || songKey !== floatingWidgetBridgeLyricsSongKey
      || signature !== floatingWidgetBridgeLyricsSignature) {
    var lyrics = floatingWidgetBridgeLyrics();
    if (lyrics) {
      payload.lyrics = lyrics;
      floatingWidgetBridgeLyricsSongKey = songKey;
      floatingWidgetBridgeLyricsSignature = signature;
    } else {
      /* 歌词还没到：明确给 null，让小组件清掉上一首的歌词，避免串词。 */
      payload.lyrics = null;
      floatingWidgetBridgeLyricsSongKey = '';
      floatingWidgetBridgeLyricsSignature = '';
    }
  }
  return payload;
}

function floatingWidgetBridgePush(includeLyrics) {
  var host = floatingWidgetBridgeHost();
  if (!host || typeof host.sync !== 'function') return false;
  try {
    var payload = floatingWidgetBridgePayload(!!includeLyrics);
    floatingWidgetBridgeLastSongKey = payload.songKey;
    host.sync(payload);
    return true;
  } catch (_) { return false; }
}

function floatingWidgetBridgeStartClock() {
  if (floatingWidgetBridgeTimer) return;
  floatingWidgetBridgeTimer = setInterval(function () {
    if (!floatingWidgetBridgeVisible) return;
    floatingWidgetBridgePush(false);
  }, FLOATING_WIDGET_CLOCK_INTERVAL_MS);
}

function floatingWidgetBridgeStopClock() {
  if (!floatingWidgetBridgeTimer) return;
  clearInterval(floatingWidgetBridgeTimer);
  floatingWidgetBridgeTimer = 0;
}

/* ---- 小组件操作 → 现有播放控制 ---- */

function floatingWidgetBridgeSetVolume(delta) {
  try {
    if (!audio) return;
    var next = Math.max(0, Math.min(1, (Number(audio.volume) || 0) + Number(delta || 0)));
    audio.volume = next;
    if (typeof showToast === 'function') showToast('音量 ' + Math.round(next * 100) + '%');
    if (typeof saveLyricLayout === 'function') { try { saveLyricLayout(); } catch (_) {} }
  } catch (_) {}
}

function floatingWidgetBridgeHandleAction(action) {
  if (!action || !action.action) return;
  var verb = action.action;
  try {
    if (verb === 'play') {
      if (!playing && typeof togglePlay === 'function') togglePlay();
    } else if (verb === 'pause') {
      if (playing && typeof togglePlay === 'function') togglePlay();
    } else if (verb === 'toggle') {
      if (typeof togglePlay === 'function') togglePlay();
    } else if (verb === 'next') {
      if (typeof nextTrack === 'function') nextTrack();
    } else if (verb === 'previous') {
      if (typeof prevTrack === 'function') prevTrack();
    } else if (verb === 'seek') {
      if (audio && isFinite(action.value)) {
        var duration = floatingWidgetBridgeDuration();
        var target = Number(action.value);
        if (duration > 0) target = Math.max(0, Math.min(duration, target));
        else target = Math.max(0, target);
        audio.currentTime = target;
      }
    } else if (verb === 'toggleLike') {
      if (typeof toggleLikeCurrent === 'function') toggleLikeCurrent();
    } else if (verb === 'shuffle') {
      if (typeof shuffleQueue === 'function') shuffleQueue();
    } else if (verb === 'volumeDelta') {
      floatingWidgetBridgeSetVolume(action.value);
    }
  } catch (err) {
    console.warn('[floating-widget] 执行操作失败:', verb, err && err.message);
  }
  /* 操作后立刻回推一次，小组件不等下一个时钟周期。 */
  setTimeout(function () { floatingWidgetBridgePush(false); }, 60);
}

function startFloatingWidgetBridge() {
  if (floatingWidgetBridgeStarted) return;
  var host = floatingWidgetBridgeHost();
  if (!host) return; // 浏览器/探针环境没有桌面壳：静默跳过
  floatingWidgetBridgeStarted = true;

  try {
    floatingWidgetBridgeUnsubAction = host.onAction(floatingWidgetBridgeHandleAction);
  } catch (_) {}
  try {
    floatingWidgetBridgeUnsubVisibility = host.onVisibility(function (payload) {
      floatingWidgetBridgeVisible = !!(payload && payload.visible);
      floatingWidgetBridgeUpdateToggleUi(floatingWidgetBridgeVisible);
      if (floatingWidgetBridgeVisible) {
        /* 窗口刚显示：立刻推完整快照（含歌词），再走 4Hz 时钟。 */
        floatingWidgetBridgePush(true);
        floatingWidgetBridgeStartClock();
      } else {
        floatingWidgetBridgeStopClock();
      }
    });
  } catch (_) {}

  try {
    var statusPromise = host.status();
    if (statusPromise && typeof statusPromise.then === 'function') {
      statusPromise.then(function (res) {
        var shown = !!(res && res.visible);
        floatingWidgetBridgeUpdateToggleUi(shown);
        if (shown) {
          floatingWidgetBridgeVisible = true;
          floatingWidgetBridgePush(true);
          floatingWidgetBridgeStartClock();
        }
      }).catch(function () {});
    }
  } catch (_) {}

  /* 状态同步靠 4Hz 时钟轮询 —— 本项目没有播放状态事件总线（grep 确认
   * playback-state-changed / track-changed 都不存在），所以不要在这里
   * 挂 window 监听假装有事件。250ms 的切歌延迟人眼不可感知，
   * 歌词晚到由 floatingWidgetBridgeLyricSignature 兜住。 */
}

function stopFloatingWidgetBridge() {
  floatingWidgetBridgeStopClock();
  if (typeof floatingWidgetBridgeUnsubAction === 'function') {
    try { floatingWidgetBridgeUnsubAction(); } catch (_) {}
  }
  if (typeof floatingWidgetBridgeUnsubVisibility === 'function') {
    try { floatingWidgetBridgeUnsubVisibility(); } catch (_) {}
  }
  floatingWidgetBridgeUnsubAction = null;
  floatingWidgetBridgeUnsubVisibility = null;
  floatingWidgetBridgeStarted = false;
}

/** 开关的视觉状态（.fx-toggle / 三条杠快捷格都用 .on 表示启用）。
 *  2026-11-23：视觉控制台里那份 toggle 已删除（与快捷格重复），
 *  所以这里同时照顾 #qm-shortcut-floating；两个都找不到时静默跳过。 */
function floatingWidgetBridgeUpdateToggleUi(visible) {
  try {
    var el = document.getElementById('t-floatingWidget');
    if (el) el.classList.toggle('on', !!visible);
    var shortcut = document.getElementById('qm-shortcut-floating');
    if (shortcut) shortcut.classList.toggle('on', !!visible);
  } catch (_) {}
}

/** 供 FX 面板/快捷键切换小组件显示。 */
function toggleFloatingWidgetPanel(visible) {
  var host = floatingWidgetBridgeHost();
  if (!host || typeof host.toggle !== 'function') {
    if (typeof showToast === 'function') showToast('悬浮小组件仅在桌面客户端可用');
    return Promise.resolve({ ok: false });
  }
  return host.toggle(visible).then(function (res) {
    var shown = !!(res && res.visible);
    floatingWidgetBridgeUpdateToggleUi(shown);
    if (shown) {
      floatingWidgetBridgeVisible = true;
      setTimeout(function () { floatingWidgetBridgePush(true); }, 120);
      floatingWidgetBridgeStartClock();
    } else {
      floatingWidgetBridgeVisible = false;
      floatingWidgetBridgeStopClock();
    }
    return res;
  }).catch(function () { return { ok: false }; });
}

startFloatingWidgetBridge();
