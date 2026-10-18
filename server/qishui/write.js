'use strict';

// 汽水音乐：写操作（喜欢 / 收藏 / 加歌 / 最近播放 / 评论）。
//
// 第 3 刀从 qishui-api.js 抽出。依赖 account + library（写前要用基准确认曲目在不在）。


const {
  QISHUI_WEB_PC_API_BASE,
} = require('./config');

const {
  normalizeQishuiCookieInput,
  normalizeText,
  qishuiCookieHasLogin,
  qishuiPcAppParams,
  qishuiPcPostJson,
  qishuiWebLibraryCache,
  qishuiWebRequestJson,
} = require('./http');

const {
  dedupeQishuiSongs,
  extractQishuiCommentList,
  mapQishuiComment,
  normalizeLyricBody,
} = require('./mapping');

const {
  invalidateQishuiLibraryCaches,
} = require('./account');

const {
  fetchQishuiWebLibrary,
  fetchQishuiWebPlaylistTracks,
} = require('./library');

function qishuiCollectionIds(value) {
  const values = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  const seen = new Set();
  const ids = [];
  values.forEach(item => {
    const id = normalizeText(item && typeof item === 'object'
      ? (item.id || item.trackId || item.track_id || item.providerSongId)
      : item);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function qishuiWriteEnabled(value) {
  if (value === false || value === 0) return false;
  return !/^(?:false|0|off|no)$/i.test(normalizeText(value));
}

async function handleQishuiCheckTracksLiked(trackIds, cookieText) {
  const ids = qishuiCollectionIds(trackIds);
  if (!ids.length) return { provider: 'qishui', loggedIn: qishuiCookieHasLogin(cookieText), ids: [], liked: {}, complete: true };
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) {
    return { provider: 'qishui', loggedIn: false, ids, liked: {}, complete: false, error: 'QISHUI_COOKIE_REQUIRED' };
  }
  const library = await fetchQishuiWebLibrary(cookie);
  let knownTracks = dedupeQishuiSongs(library.likedTracks || []);
  let complete = false;
  if (library.likedCard && library.likedCard.id) {
    const detail = await fetchQishuiWebPlaylistTracks(library.likedCard.id, cookie, { limit: 50, offset: 0 }).catch(() => null);
    if (detail && Array.isArray(detail.tracks)) {
      knownTracks = dedupeQishuiSongs(knownTracks.concat(detail.tracks));
      complete = !detail.hasMore;
    } else {
      complete = false;
    }
  }
  const knownLiked = new Set(knownTracks.map(song => String(song.providerSongId || song.id || '')).filter(Boolean));
  const liked = {};
  ids.forEach(id => { liked[id] = knownLiked.has(id); });
  return {
    provider: 'qishui',
    loggedIn: true,
    ids,
    liked,
    complete,
    checkedCount: knownLiked.size,
  };
}

async function handleQishuiSetTrackLiked(trackId, liked, cookieText) {
  const id = normalizeText(trackId);
  if (!id) throw new Error('Missing Qishui track id');
  liked = qishuiWriteEnabled(liked);
  const apiPath = liked
    ? '/luna/pc/me/collection/media'
    : '/luna/pc/me/collection/media/delete';
  await qishuiPcPostJson(apiPath, {
    media: [{ type: 'track', id }],
    scene: '',
  }, cookieText, { errorCode: liked ? 'QISHUI_LIKE_FAILED' : 'QISHUI_UNLIKE_FAILED' });
  invalidateQishuiLibraryCaches();
  return { provider: 'qishui', loggedIn: true, id, liked, ok: true };
}

async function handleQishuiSetPlaylistCollected(playlistId, collected, cookieText) {
  const id = normalizeText(String(playlistId || '').replace(/^qishui:/i, ''));
  if (!id) throw new Error('Missing Qishui playlist id');
  collected = qishuiWriteEnabled(collected);
  await qishuiPcPostJson(
    collected ? '/luna/pc/me/collection/playlist' : '/luna/pc/me/collection/playlist/delete',
    { playlist_ids: [id] },
    cookieText,
    { errorCode: collected ? 'QISHUI_PLAYLIST_COLLECT_FAILED' : 'QISHUI_PLAYLIST_UNCOLLECT_FAILED' }
  );
  invalidateQishuiLibraryCaches();
  return { provider: 'qishui', loggedIn: true, id, collected, ok: true };
}

async function handleQishuiPlaylistAddSong(playlistId, track, cookieText) {
  const playlistIdValue = normalizeText(String(playlistId || '').replace(/^qishui:/i, ''));
  const trackId = normalizeText(track && typeof track === 'object'
    ? (track.providerSongId || track.trackId || track.track_id || track.id)
    : track);
  if (!playlistIdValue || !trackId) throw new Error('Missing Qishui playlist or track id');
  await qishuiPcPostJson('/luna/pc/me/playlist/media/append', {
    playlist_id: playlistIdValue,
    media: [{ id: trackId, type: 'track' }],
  }, cookieText, { errorCode: 'QISHUI_PLAYLIST_ADD_FAILED' });
  invalidateQishuiLibraryCaches();
  return {
    provider: 'qishui',
    loggedIn: true,
    pid: playlistIdValue,
    id: trackId,
    success: true,
    ok: true,
  };
}

async function handleQishuiSetAlbumCollected(albumId, collected, cookieText) {
  const id = normalizeText(albumId);
  if (!id) throw new Error('Missing Qishui album id');
  collected = qishuiWriteEnabled(collected);
  await qishuiPcPostJson(
    collected ? '/luna/pc/me/collection/album' : '/luna/pc/me/collection/album/delete',
    { album_ids: [id] },
    cookieText,
    { errorCode: collected ? 'QISHUI_ALBUM_COLLECT_FAILED' : 'QISHUI_ALBUM_UNCOLLECT_FAILED' }
  );
  invalidateQishuiLibraryCaches();
  return { provider: 'qishui', loggedIn: true, id, collected, ok: true };
}

async function handleQishuiReportRecentlyPlayed(trackId, cookieText) {
  const id = normalizeText(trackId);
  if (!id) throw new Error('Missing Qishui track id');
  await qishuiPcPostJson('/luna/pc/me/recently-played-media', {
    media: [{ type: 'track', id }],
  }, cookieText, { errorCode: 'QISHUI_RECENT_PLAY_REPORT_FAILED', timeoutMs: 6500 });
  qishuiWebLibraryCache.clear();
  return { provider: 'qishui', loggedIn: true, id, reported: true, ok: true };
}

async function handleQishuiComments(trackId, opts, cookieText) {
  const id = normalizeText(trackId);
  if (!id) return { provider: 'qishui', id: '', comments: [], total: 0, error: 'Missing Qishui track id' };
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) {
    return { provider: 'qishui', id, loggedIn: false, comments: [], total: 0, error: 'QISHUI_COOKIE_REQUIRED' };
  }
  opts = opts || {};
  const count = Math.max(1, Math.min(50, Number(opts.count || opts.limit) || 20));
  const cursor = normalizeText(opts.cursor != null ? opts.cursor : (opts.offset || ''));
  const json = await qishuiWebRequestJson('/luna/pc/comments', qishuiPcAppParams({
    group_id: id,
    cursor,
    count,
    group_type: 0,
  }), cookie, {
    bases: [QISHUI_WEB_PC_API_BASE],
    noDefaultParams: true,
    sessionOnly: true,
    pcApp: true,
    timeoutMs: 8500,
  });
  const rawComments = extractQishuiCommentList(json);
  const comments = rawComments.map(mapQishuiComment).filter(comment => comment.content);
  const data = (json && json.data) || json || {};
  const nextCursor = normalizeText(data.next_cursor || data.nextCursor || data.cursor || json && (json.next_cursor || json.cursor) || '');
  const total = Number(data.total || data.total_count || data.totalCount || data.count || json && (json.total || json.count) || comments.length) || comments.length;
  return {
    provider: 'qishui',
    id,
    loggedIn: true,
    comments,
    total,
    cursor,
    nextCursor,
    hasMore: !!(data.has_more || data.hasMore || nextCursor),
  };
}

async function handleQishuiCreateComment(trackId, text, cookieText) {
  const id = normalizeText(trackId);
  text = normalizeLyricBody(text);
  if (!id) throw new Error('Missing Qishui track id');
  if (!text) throw new Error('Missing Qishui comment text');
  const json = await qishuiPcPostJson('/luna/pc/comments/create', {
    group_id: id,
    text,
    group_type: 0,
  }, cookieText, { errorCode: 'QISHUI_COMMENT_CREATE_FAILED' });
  const rawComments = extractQishuiCommentList(json);
  const comment = rawComments.length
    ? mapQishuiComment(rawComments[0])
    : mapQishuiComment((json && json.data) || json);
  return {
    provider: 'qishui',
    id,
    loggedIn: true,
    created: true,
    ok: true,
    comment: comment.content ? comment : null,
  };
}

module.exports = {
  qishuiCollectionIds,
  qishuiWriteEnabled,
  handleQishuiCheckTracksLiked,
  handleQishuiSetTrackLiked,
  handleQishuiSetPlaylistCollected,
  handleQishuiPlaylistAddSong,
  handleQishuiSetAlbumCollected,
  handleQishuiReportRecentlyPlayed,
  handleQishuiComments,
  handleQishuiCreateComment,
};
