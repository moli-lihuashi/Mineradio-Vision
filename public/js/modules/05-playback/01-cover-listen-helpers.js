function isTypingTarget(target) {
  if (!target) return false;
  var tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!(target.isContentEditable || (target.closest && target.closest('[contenteditable="true"]')));
}
function readCustomCoverMap() {
  try {
    var raw = localStorage.getItem(CUSTOM_COVER_STORE_KEY);
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}
function saveCustomCoverMap() {
  try {
    localStorage.setItem(CUSTOM_COVER_STORE_KEY, JSON.stringify(customCoverMap || {}));
    return true;
  } catch (e) {
    console.warn('custom cover save failed:', e);
    return false;
  }
}
function isInlineCoverSrc(src) {
  return typeof src === 'string' && (/^data:image\//i.test(src) || /^blob:/i.test(src));
}
function isProxyableCoverUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}
function coverProxySrc(url, cacheBust) {
  if (!url) return '';
  if (isInlineCoverSrc(url)) return url;
  if (!isProxyableCoverUrl(url)) return '';
  var params = { url: url };
  if (cacheBust) params.v = Date.now();
  return Mineradio.api.apiMediaProxyUrl('/api/cover', params);
}
function coverUrlWithSize(url, size) {
  if (!url || isInlineCoverSrc(url) || !/^https?:\/\//i.test(url)) return url || '';
  if (!size) return url;
  var param = 'param=' + size + 'y' + size;
  if (/[?&]param=\d+y\d+/i.test(url)) return url.replace(/([?&])param=\d+y\d+/i, '$1' + param);
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + param;
}
function songCustomCoverKey(song) {
  if (!song) return '';
  if (song.customCoverKey) return String(song.customCoverKey);
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq:' + (song.mid || song.songmid || song.id || (song.name + '|' + song.artist));
  if (song.localKey) return 'local:' + song.localKey;
  if (song.type === 'podcast' && song.programId) return 'podcast:' + song.programId;
  if (song.id != null && song.id !== '') return 'id:' + song.id;
  var title = String(song.name || song.title || '').trim();
  var artist = String(song.artist || '').trim();
  return (title || artist) ? ('meta:' + (title + '|' + artist).slice(0, 220)) : '';
}
function getCustomCoverForSong(song) {
  if (!song) return '';
  if (song.customCover) return song.customCover;
  var key = songCustomCoverKey(song);
  return key && customCoverMap[key] ? customCoverMap[key] : '';
}
function hydrateCustomCover(song) {
  if (!song) return song;
  var custom = getCustomCoverForSong(song);
  if (custom) song.customCover = custom;
  return song;
}
function songCoverSrc(song, size) {
  var custom = getCustomCoverForSong(song);
  if (custom) return custom;
  return song && song.cover ? coverUrlWithSize(song.cover, size) : '';
}
function cssImageUrl(url) {
  return String(url || '').replace(/\\/g, '\\\\').replace(/"/g, '%22');
}
function setHomeArt(id, url, size) {
  var el = document.getElementById(id);
  if (!el) return;
  var src = url ? coverUrlWithSize(url, size || 260) : '';
  el.style.backgroundImage = src ? 'url("' + cssImageUrl(src) + '")' : '';
  el.classList.toggle('has-cover', !!src);
  var skipSkeleton = id === 'home-continue-art' && (!!src || !!(readPlaybackSession() && readPlaybackSession().song));
  el.classList.toggle('home-skeleton', !src && homeDiscoverState.loading && !skipSkeleton);
  // 封面是 style 变更，LiquidGlass 子树 observer 默认不监听 style；延迟标脏避免漏刷新
  if (typeof window._liquidGlassMgr !== 'undefined' && window._liquidGlassMgr && window._liquidGlassMgr.markChanged) {
    clearTimeout(setHomeArt._lgTimer);
    setHomeArt._lgTimer = setTimeout(function () {
      try { window._liquidGlassMgr.markChanged('homeCard'); } catch (_) {}
    }, 120);
  }
}
function compactHomeCount(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 10000) return Math.round(n / 10000) + '万';
  return n ? String(n) : '';
}
function loadListenStatsState() {
  try {
    var raw = localStorage.getItem(HOME_LISTEN_STATS_KEY);
    if (!raw) return { history: [], songs: {}, artists: {}, updatedAt: 0 };
    var data = JSON.parse(raw);
    return {
      history: Array.isArray(data.history) ? data.history.slice(0, 180) : [],
      songs: data.songs && typeof data.songs === 'object' ? data.songs : {},
      artists: data.artists && typeof data.artists === 'object' ? data.artists : {},
      updatedAt: Number(data.updatedAt) || 0,
    };
  } catch (e) {
    return { history: [], songs: {}, artists: {}, updatedAt: 0 };
  }
}
function saveListenStatsState() {
  try {
    listenStatsState.updatedAt = Date.now();
    localStorage.setItem(HOME_LISTEN_STATS_KEY, JSON.stringify(listenStatsState));
  } catch (e) {}
}
function listenSongSnapshot(song) {
  song = song || {};
  return {
    key: queueItemKey(song),
    id: song.id || '',
    mid: song.mid || song.songmid || '',
    mediaMid: song.mediaMid || song.media_mid || '',
    type: song.type || 'song',
    sourceKey: song.source || song.provider || '',
    name: song.name || song.title || '未知歌曲',
    artist: song.artist || '',
    cover: songCoverSrc(song, 220) || song.cover || '',
    source: songSourceLabel(song),
    provider: song.provider || song.source || song.type || '',
    hash: song.hash || '',
    albumAudioId: song.albumAudioId || song.album_audio_id || '',
    duration: Number(song.duration) || 0,
  };
}
function beginListenSession(song, context) {
  if (!song) return;
  var snap = listenSongSnapshot(song);
  if (!snap.key) return;
  if (listenSession && listenSession.key !== snap.key) finalizeListenSession(false);
  listenSession = {
    key: snap.key,
    song: snap,
    context: context || activeRadioContext || null,
    startedAt: Date.now(),
    lastWallAt: Date.now(),
    lastAudioTime: audio && isFinite(audio.currentTime) ? audio.currentTime : 0,
    listenMs: 0,
    maxProgress: 0,
  };
}
function updateListenStatsTick(force) {
  if (!audio || !audio.duration || audio.paused) return;
  var song = currentCoverSong();
  if (!song) return;
  var key = queueItemKey(song);
  if (!listenSession || listenSession.key !== key) beginListenSession(song, activeRadioContext);
  if (!listenSession) return;
  var now = Date.now();
  var audioTime = isFinite(audio.currentTime) ? audio.currentTime : 0;
  var deltaByAudio = Math.max(0, audioTime - (listenSession.lastAudioTime || 0)) * 1000;
  var deltaByWall = Math.max(0, now - (listenSession.lastWallAt || now));
  var delta = deltaByAudio > 0 ? Math.min(deltaByAudio, deltaByWall || deltaByAudio, 4200) : 0;
  if (force && delta <= 0) delta = Math.min(deltaByWall, 1500);
  if (delta > 0 && delta < 8000) listenSession.listenMs += delta;
  listenSession.lastWallAt = now;
  listenSession.lastAudioTime = audioTime;
  listenSession.maxProgress = Math.max(listenSession.maxProgress || 0, audio.duration ? audioTime / audio.duration : 0);
}
function finalizeListenSession(completed) {
  if (!listenSession) return;
  updateListenStatsTick(true);
  var session = listenSession;
  listenSession = null;
  var effective = completed || session.listenMs >= 45000 || session.maxProgress >= 0.5 || (!audio || !audio.duration ? session.listenMs >= 30000 : false);
  if (!effective) return;
  var now = Date.now();
  var snap = session.song || {};
  var record = {
    key: session.key,
    id: snap.id || '',
    mid: snap.mid || '',
    mediaMid: snap.mediaMid || '',
    type: snap.type || 'song',
    sourceKey: snap.sourceKey || '',
    name: snap.name || '未知歌曲',
    artist: snap.artist || '',
    cover: snap.cover || '',
    source: snap.source || '',
    provider: snap.provider || snap.sourceKey || '',
    hash: snap.hash || '',
    albumAudioId: snap.albumAudioId || '',
    duration: Number(snap.duration) || 0,
    playedAt: now,
    listenMs: Math.round(session.listenMs),
    completed: !!completed,
    context: session.context || null,
  };
  listenStatsState.history = [record].concat((listenStatsState.history || []).filter(function(item){ return item && item.key !== record.key; })).slice(0, 180);
  var songStat = listenStatsState.songs[record.key] || { key: record.key, name: record.name, artist: record.artist, cover: record.cover, source: record.source, plays: 0, listenMs: 0, completed: 0, lastPlayedAt: 0 };
  songStat.name = record.name;
  songStat.artist = record.artist;
  songStat.cover = record.cover || songStat.cover || '';
  songStat.source = record.source || songStat.source || '';
  songStat.plays += 1;
  songStat.listenMs += record.listenMs;
  songStat.completed += completed ? 1 : 0;
  songStat.lastPlayedAt = now;
  listenStatsState.songs[record.key] = songStat;
  String(record.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function(name){
    name = name.trim();
    if (!name) return;
    var artistStat = listenStatsState.artists[name] || { name: name, plays: 0, listenMs: 0, lastPlayedAt: 0 };
    artistStat.plays += 1;
    artistStat.listenMs += record.listenMs;
    artistStat.lastPlayedAt = now;
    listenStatsState.artists[name] = artistStat;
  });
  saveListenStatsState();
  if (emptyHomeActive) renderHomeDiscover();
}
function mostPlayedSong() {
  var list = Object.keys(listenStatsState.songs || {}).map(function(key){ return listenStatsState.songs[key]; });
  list.sort(function(a, b){ return (b.plays - a.plays) || (b.listenMs - a.listenMs) || (b.lastPlayedAt - a.lastPlayedAt); });
  return list[0] || null;
}
function topListenArtist() {
  var list = Object.keys(listenStatsState.artists || {}).map(function(key){ return listenStatsState.artists[key]; });
  list.sort(function(a, b){ return (b.plays - a.plays) || (b.listenMs - a.listenMs) || (b.lastPlayedAt - a.lastPlayedAt); });
  return list[0] || null;
}
function homeListenSummary() {
  var recent = (listenStatsState.history || [])[0] || null;
  var topSong = mostPlayedSong();
  var topArtist = topListenArtist();
  var totalPlays = Object.keys(listenStatsState.songs || {}).reduce(function(sum, key){ return sum + ((listenStatsState.songs[key] && listenStatsState.songs[key].plays) || 0); }, 0);
  return { recent: recent, topSong: topSong, topArtist: topArtist, totalPlays: totalPlays };
}
