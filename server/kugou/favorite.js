'use strict';

// 酷狗：收藏与喜欢。
//
// 第 2 刀从 kugou-api.js 抽出。收藏歌单 id 解析、like fileid 记忆（酷狗删除喜欢要 fileid，
// 不是 hash）、喜欢检查 / 加歌 / 删歌 / 切换。零出边。

const {
  KUGOU_LIKE_FILEID_MAX,
} = require('./config');

const {
  extractKugouAuth,
  kugouCloudlistRequest,
  kugouPlaylistTracksCache,
} = require('./http');

const {
  extractKugouGatewayPlaylistLists,
  mapKugouPlaylistTrack,
  parseKugouListId,
  pickKugouFavoritePlaylist,
  resolveKugouAlbumAudioId,
  resolveKugouFavoriteListIdFromItem,
} = require('./mapping');

let kugouFavoriteListCache = { listId: '', userId: '', at: 0 };

async function resolveKugouFavoriteListId(cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return '';
  if (kugouFavoriteListCache.listId && kugouFavoriteListCache.userId === auth.userid && Date.now() - kugouFavoriteListCache.at < 300000) {
    return kugouFavoriteListCache.listId;
  }
  const json = await kugouCloudlistRequest('/v7/get_all_list', {
    cookie,
    params: { total_ver: 979, type: 2, page: 1, pagesize: 50, userid: auth.userid, token: auth.token },
    body: {
      userid: Number(auth.userid),
      token: auth.token,
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 50,
    },
  });
  const lists = extractKugouGatewayPlaylistLists(json);
  const fav = pickKugouFavoritePlaylist(lists);
  const listId = resolveKugouFavoriteListIdFromItem(fav);
  if (listId) kugouFavoriteListCache = { listId, userId: auth.userid, at: Date.now() };
  return listId;
}

const kugouLikeFileIdByHash = new Map();

// fileid 缓存上限防御：只增不减的 Map 换成固定容量淘汰（Map 插入序即最旧）
function rememberKugouLikeFileId(hash, fileId) {
  const map = kugouLikeFileIdByHash;
  if (map.size >= KUGOU_LIKE_FILEID_MAX && !map.has(hash)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(hash, String(fileId));
}

function buildKugouSongResource(song) {
  song = song || {};
  const hash = String(song.hash || song.fileHash || song.id || '').trim().toLowerCase();
  const name = String(song.name || song.title || '').trim();
  const albumId = Number(song.albumId || song.album_id || 0) || 0;
  const mixsongid = resolveKugouAlbumAudioId(song) || 0;
  const durationMs = Number(song.duration || 0) || 0;
  return {
    number: 1,
    name,
    hash,
    size: 0,
    sort: 0,
    timelen: durationMs > 1000 ? Math.round(durationMs) : Math.round(durationMs * 1000),
    bitrate: 0,
    album_id: albumId,
    mixsongid: Number(mixsongid) || 0,
  };
}

async function handleKugouPlaylistTracks(playlistId, cookie, opts = {}) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return { provider: 'kugou', tracks: [], total: 0, error: 'KUGOU_AUTH_REQUIRED', message: '酷狗登录未完成' };
  }
  const listid = parseKugouListId(playlistId);
  if (!listid) return { provider: 'kugou', tracks: [], total: 0, error: 'MISSING_PLAYLIST_ID' };
  const paged = !!opts.paged;
  const pagesize = Math.max(1, Math.min(50, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const cacheKey = String(listid) + ':' + String(auth.userid || '0');
  async function fetchPage(pageNo, baseOffset) {
    baseOffset = baseOffset || 0;
    const json = await kugouCloudlistRequest('/v4/get_list_all_file', {
      cookie,
      body: {
        listid: Number(listid) || listid,
        userid: Number(auth.userid),
        area_code: 1,
        show_relate_goods: 0,
        pagesize,
        allplatform: 1,
        show_cover: 1,
        type: 0,
        token: auth.token,
        page: pageNo,
      },
    });
    const data = (json && json.data) || {};
    const chunk = data.info || data.songs || data.lists || data.file || [];
    const list = Array.isArray(chunk) ? chunk : (Array.isArray(chunk.file) ? chunk.file : []);
    const tracks = list.map((item, index) => {
      const mapped = mapKugouPlaylistTrack(item);
      mapped.addedAt = Number(item.addtime || item.add_time || item.collect_time || item.ctime || item.belong_cd_addtime || 0) || 0;
      mapped.playlistIndex = baseOffset + index;
      return mapped;
    }).filter(s => s.name && (s.hash || s.id));
    const total = Number(data.count || 0) || tracks.length;
    return { tracks, total };
  }
  async function fetchOrigRange(origStart, count) {
    const out = [];
    let remaining = count;
    let pos = origStart;
    while (remaining > 0) {
      const pageNo = Math.floor(pos / pagesize) + 1;
      const baseOffset = (pageNo - 1) * pagesize;
      const chunk = await fetchPage(pageNo, baseOffset);
      if (!chunk.tracks.length) break;
      const inPage = pos - baseOffset;
      const take = Math.min(remaining, chunk.tracks.length - inPage);
      if (take <= 0) break;
      out.push(...chunk.tracks.slice(inPage, inPage + take));
      remaining -= take;
      pos += take;
    }
    return out;
  }
  function reverseKugouTracks(tracks, listOffset) {
    tracks.reverse();
    tracks.forEach(function (t, i) {
      t.playlistIndex = listOffset + i;
    });
    return tracks;
  }
  try {
    if (paged) {
      const probe = await fetchPage(1, 0);
      const total = probe.total || probe.tracks.length;
      if (!total) {
        return {
          provider: 'kugou',
          id: String(playlistId || listid),
          tracks: reverseKugouTracks(probe.tracks.slice(), offset),
          total: probe.tracks.length,
          offset,
          limit: pagesize,
          hasMore: false,
        };
      }
      var origStart = Math.max(0, total - offset - pagesize);
      var origEnd = total - offset;
      var count = Math.min(pagesize, Math.max(0, origEnd - origStart));
      if (count <= 0) {
        return {
          provider: 'kugou',
          id: String(playlistId || listid),
          tracks: [],
          total,
          offset,
          limit: pagesize,
          hasMore: false,
        };
      }
      var pageTracks = reverseKugouTracks(await fetchOrigRange(origStart, count), offset);
      return {
        provider: 'kugou',
        id: String(playlistId || listid),
        tracks: pageTracks,
        total,
        offset,
        limit: pagesize,
        hasMore: offset + pageTracks.length < total,
      };
    }
    return kugouPlaylistTracksCache.wrap(cacheKey, null, async () => {
      const tracks = [];
      let total = 0;
      for (let round = 0; round < 500; round++) {
        const chunk = await fetchPage(round + 1, tracks.length);
        total = chunk.total || total;
        if (!chunk.tracks.length) break;
        tracks.push(...chunk.tracks);
        if (chunk.tracks.length < pagesize || (total && tracks.length >= total)) break;
      }
      reverseKugouTracks(tracks, 0);
      return { provider: 'kugou', id: String(playlistId || listid), tracks, total: total || tracks.length };
    });
  } catch (err) {
    return {
      provider: 'kugou',
      id: String(playlistId || listid),
      tracks: [],
      total: 0,
      error: err.message || 'KUGOU_PLAYLIST_TRACKS_FAILED',
      message: '酷狗歌单歌曲加载失败',
    };
  }
}

async function fetchKugouFavoriteHashSet(cookie, hashSet, maxPages) {
  const listId = await resolveKugouFavoriteListId(cookie);
  const liked = {};
  if (!listId || !hashSet || !hashSet.size) return { listId, liked };
  maxPages = Math.max(1, Math.min(16, Number(maxPages) || 8));
  const first = await handleKugouPlaylistTracks(listId, cookie, { limit: 50, offset: 0, paged: true });
  const total = Math.max(Number(first.total || 0), (first.tracks || []).length);
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const pageOrder = [];
  for (let page = totalPages; page >= 1 && pageOrder.length < maxPages; page -= 1) pageOrder.push(page);
  for (let page = 1; page <= totalPages && pageOrder.length < maxPages * 2; page += 1) {
    if (pageOrder.indexOf(page) < 0) pageOrder.push(page);
  }
  for (let i = 0; i < pageOrder.length; i += 1) {
    const page = pageOrder[i];
    const chunk = page === 1 && (first.tracks || []).length
      ? first
      : await handleKugouPlaylistTracks(listId, cookie, { limit: 50, offset: (page - 1) * 50, paged: true });
    const tracks = chunk.tracks || [];
    if (!tracks.length) continue;
    tracks.forEach(track => {
      const hash = String(track.hash || track.fileHash || '').toLowerCase();
      if (!hash || !hashSet.has(hash)) return;
      liked[hash] = true;
      if (track.fileId) rememberKugouLikeFileId(hash, track.fileId);
    });
    if (Object.keys(liked).length >= hashSet.size) break;
  }
  return { listId, liked };
}

async function findKugouFavoriteFileId(song, cookie, listId) {
  const hash = String((song && (song.hash || song.fileHash || song.id)) || '').trim().toLowerCase();
  if (!hash) return '';
  if (kugouLikeFileIdByHash.has(hash)) return kugouLikeFileIdByHash.get(hash);
  listId = String(listId || '').trim() || await resolveKugouFavoriteListId(cookie);
  if (!listId) return '';
  for (let page = 1; page <= 6; page += 1) {
    const chunk = await handleKugouPlaylistTracks(listId, cookie, { limit: 50, offset: (page - 1) * 50, paged: true });
    const tracks = chunk.tracks || [];
    for (let i = 0; i < tracks.length; i += 1) {
      const track = tracks[i];
      const trackHash = String(track.hash || track.fileHash || '').toLowerCase();
      if (trackHash !== hash) continue;
      if (track.fileId) {
        rememberKugouLikeFileId(hash, track.fileId);
        return String(track.fileId);
      }
    }
    if (!tracks.length || tracks.length < 50) break;
  }
  return '';
}

async function handleKugouLikeCheck(params, cookie) {
  const raw = String((params && (params.hashes || params.hash)) || '').trim();
  const hashes = raw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!hashes.length) return { provider: 'kugou', liked: {} };
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return { provider: 'kugou', liked: {}, error: 'KUGOU_AUTH_REQUIRED' };
  const hashSet = new Set(hashes);
  const { liked, listId, error } = await fetchKugouFavoriteHashSet(cookie, hashSet, 6).catch(err => ({ liked: {}, listId: '', error: err.message }));
  if (error && !listId) return { provider: 'kugou', liked: {}, error };
  return { provider: 'kugou', liked, listId };
}

async function handleKugouAddSongToList(listId, song, cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return { provider: 'kugou', success: false, error: 'KUGOU_AUTH_REQUIRED' };
  const targetListId = String(listId || '').trim() || await resolveKugouFavoriteListId(cookie);
  if (!targetListId) return { provider: 'kugou', success: false, error: 'KUGOU_FAVORITE_LIST_NOT_FOUND' };
  const resource = buildKugouSongResource(song);
  const body = {
    userid: Number(auth.userid),
    token: auth.token,
    listid: Number(targetListId) || targetListId,
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: 'false;null',
    data: [resource],
  };
  // 收藏/取消属于写操作：走 lite 客户端身份的 cloudlist 通道（H5/标准版身份会被 20017 拒绝）
  const json = await kugouCloudlistRequest('/v6/add_song', {
    cookie,
    params: {
      last_time: Math.floor(Date.now() / 1000),
      last_area: 'gztx',
      userid: auth.userid,
      token: auth.token,
    },
    body,
  });
  if (resource.hash) kugouLikeFileIdByHash.delete(resource.hash);
  return { provider: 'kugou', success: true, liked: true, listId: targetListId, body: json };
}

async function handleKugouRemoveSongFromList(listId, song, cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) return { provider: 'kugou', success: false, error: 'KUGOU_AUTH_REQUIRED' };
  const targetListId = String(listId || '').trim() || await resolveKugouFavoriteListId(cookie);
  if (!targetListId) return { provider: 'kugou', success: false, error: 'KUGOU_FAVORITE_LIST_NOT_FOUND' };
  const fileId = await findKugouFavoriteFileId(song, cookie, targetListId);
  if (!fileId) return { provider: 'kugou', success: false, error: 'KUGOU_SONG_NOT_IN_LIST' };
  const body = {
    listid: Number(targetListId) || targetListId,
    userid: Number(auth.userid),
    token: auth.token,
    type: 0,
    list_ver: 0,
    data: [{ fileid: Number(fileId) || fileId }],
  };
  const json = await kugouCloudlistRequest('/v4/delete_songs', {
    cookie,
    body,
  });
  const hash = String((song && (song.hash || song.fileHash || song.id)) || '').trim().toLowerCase();
  if (hash) kugouLikeFileIdByHash.delete(hash);
  return { provider: 'kugou', success: true, liked: false, listId: targetListId, body: json };
}

async function handleKugouLikeToggle(song, like, cookie) {
  if (like) return handleKugouAddSongToList('', song, cookie);
  return handleKugouRemoveSongFromList('', song, cookie);
}

async function handleKugouPlaylistAddSong(listId, song, cookie) {
  return handleKugouAddSongToList(listId, song, cookie);
}

module.exports = {
  kugouFavoriteListCache,
  resolveKugouFavoriteListId,
  kugouLikeFileIdByHash,
  rememberKugouLikeFileId,
  buildKugouSongResource,
  handleKugouPlaylistTracks,
  fetchKugouFavoriteHashSet,
  findKugouFavoriteFileId,
  handleKugouLikeCheck,
  handleKugouAddSongToList,
  handleKugouRemoveSongFromList,
  handleKugouLikeToggle,
  handleKugouPlaylistAddSong,
};
