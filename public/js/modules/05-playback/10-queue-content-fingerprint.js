// =============================================================================
// 队列内容指纹去重（本地启发式，非 Chromaprint）
// =============================================================================
function normalizeQueueFingerprintText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/（.*?）|\(.*?\)|【.*?】|\[.*?\]/g, ' ')
    .replace(/\b(live|remix|mix|edit|version|ver\.?|official|audio|mv|cover|karaoke|instrumental)\b/g, ' ')
    .replace(/[^\u4e00-\u9fff\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQueueFingerprintArtists(artist) {
  return String(artist || '')
    .toLowerCase()
    .split(/\s*[,/&+|、；;]\s*/)
    .map(function (part) { return normalizeQueueFingerprintText(part); })
    .filter(Boolean)
    .sort()
    .join('|');
}

function queueContentDurationBucket(song) {
  var sec = 0;
  if (typeof playbackDurationFromSong === 'function') sec = Number(playbackDurationFromSong(song) || 0) || 0;
  else sec = Number(song && (song.duration || song.dt || song.timelength) || 0) || 0;
  if (sec > 1000) sec = sec / 1000;
  if (!sec || !isFinite(sec)) return 0;
  return Math.round(sec / 3) * 3;
}

function simpleQueueFingerprintHash(input) {
  var str = String(input || '');
  var hash = 2166136261;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function queueContentFingerprint(song) {
  if (!song) return '';
  if (song.localKey) return 'local:' + song.localKey;
  if (song.type === 'podcast' && song.programId) return 'podcast:' + song.programId;
  var title = normalizeQueueFingerprintText(song.name || song.title || '');
  var artists = normalizeQueueFingerprintArtists(song.artist || song.artists || song.singer || '');
  var bucket = queueContentDurationBucket(song);
  if (!title && !artists) return '';
  return 'cf:' + simpleQueueFingerprintHash([title, artists, bucket].join('|'));
}

function findQueueIndexByContentFingerprint(song, excludeIndex) {
  var fp = queueContentFingerprint(song);
  if (!fp || !playQueue || !playQueue.length) return -1;
  for (var i = 0; i < playQueue.length; i++) {
    if (excludeIndex != null && i === excludeIndex) continue;
    if (queueContentFingerprint(playQueue[i]) === fp) return i;
  }
  return -1;
}

function queueHasContentDuplicate(song, excludeIndex) {
  return findQueueIndexByContentFingerprint(song, excludeIndex) >= 0;
}
