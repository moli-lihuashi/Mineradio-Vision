// =============================================================================
// 播放源版本指纹（借 Folia sourceRevision 的「去凭据身份」思路）
//
// 与 Folia 的差别要说清楚：Folia 把 revision 拼进分析缓存键，源一变旧分析结果自动失效；
// Mineradio 的节拍 / 歌词缓存是按歌（song id）而不是按 URL 记账的，硬把 revision 拼进键
// 会让用户已有的分析缓存全部失效、重算节拍。所以这里只做诊断与换链有效性判定：
//   · 指纹只保留 origin + pathname + 音质类参数，签名/cookie/token 全部丢掉；
//   · 换链前后各算一次，用来回答「这次换链到底有没有换到新源」。
// =============================================================================

var PLAYBACK_SOURCE_REVISION_PARAMS = ['format', 'maxBitRate', 'quality', 'br', 'level'];

/** 去掉凭据的 URL 身份；blob/data/file 这类不解析，按前缀截断避免把整段内容记账。 */
function safePlaybackSourceIdentity(src) {
  if (!src) return '';
  var raw = String(src);
  if (/^(blob:|data:|file:)/i.test(raw)) return raw.slice(0, 40);
  try {
    var u = new URL(raw, 'http://localhost');
    if (!/^https?:$/i.test(u.protocol)) return raw.slice(0, 80);
    var parts = [];
    for (var i = 0; i < PLAYBACK_SOURCE_REVISION_PARAMS.length; i++) {
      var key = PLAYBACK_SOURCE_REVISION_PARAMS[i];
      var value = u.searchParams.get(key);
      if (value) parts.push(key + '=' + value);
    }
    return u.origin + u.pathname + (parts.length ? '?' + parts.join('&') : '');
  } catch (_) { return raw.slice(0, 80); }
}

function playbackSourceProviderOf(song) {
  try {
    if (typeof getMusicProviderKey === 'function') return String(getMusicProviderKey(song) || '');
  } catch (_) {}
  if (!song) return '';
  return String(song.provider || song.source || '');
}

/** provider | 歌曲标识 | 时长 | 去凭据源身份 —— 任何一段变化都算换了源。 */
function buildPlaybackSourceRevision(song, src) {
  var id = song && (song.id || song.mid || song.hash || song.songmid || song.localId) || '';
  var duration = Number(song && (song.duration || song.dt || song.interval || 0)) || 0;
  return [
    playbackSourceProviderOf(song),
    String(id),
    String(duration),
    safePlaybackSourceIdentity(src),
  ].join('|');
}

function playbackSourceRevisionChanged(previous, next) {
  if (!previous || !next) return false;
  return previous !== next;
}

/** 诊断用快照：当前曲目的源版本，以及最近一次换链是否真的换了源。 */
function playbackSourceRevisionSnapshot() {
  var out = { songKey: '', src: '', revision: '', lastRevision: '', changedAfterRecovery: null };
  try {
    var song = (typeof playQueue !== 'undefined' && playQueue && typeof currentIdx === 'number' &&
      currentIdx >= 0 && currentIdx < playQueue.length) ? playQueue[currentIdx] : null;
    var src = (typeof audio !== 'undefined' && audio) ? (audio.currentSrc || audio.src || '') : '';
    out.songKey = (typeof queueItemKey === 'function') ? String(queueItemKey(song) || '') : '';
    out.src = safePlaybackSourceIdentity(src);
    out.revision = buildPlaybackSourceRevision(song, src);
  } catch (_) {}
  try {
    if (typeof playbackResumeRecovery !== 'undefined' && playbackResumeRecovery) {
      out.lastRevision = playbackResumeRecovery.lastSourceRevision || '';
      out.changedAfterRecovery = playbackResumeRecovery.recoveryRevisionChanged;
    }
  } catch (_) {}
  return out;
}
