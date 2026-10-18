'use strict';

// 汽水音乐：曲库（web 曲库 / 歌单曲目 / 用户歌单 / 首屏 feed）。
//
// 第 3 刀从 qishui-api.js 抽出。依赖 account（账号态）+ mapping（归一）。

const path = require('path');

const {
  QISHUI_FEED_SONG_TAB_PATH,
  QISHUI_VIRTUAL_FEED_PLAYLIST_ID,
  QISHUI_WEB_LIKED_PLAYLIST_ID,
  QISHUI_WEB_PC_API_BASE,
  QISHUI_WEB_RECENT_PLAYLIST_ID,
} = require('./config');

const {
  normalizeQishuiCookieInput,
  normalizeText,
  qishuiCookieFingerprint,
  qishuiCookieHasLogin,
  qishuiFeedCache,
  qishuiPcAppParams,
  qishuiPost,
  qishuiWebLibraryCache,
  qishuiWebPlaylistCache,
  qishuiWebPlaylistCursorCache,
  qishuiWebRequestJson,
} = require('./http');

const {
  buildQishuiVirtualPlaylist,
  dedupeQishuiSongs,
  extractQishuiMediaList,
  extractQishuiPlaylistCards,
  mapQishuiMedia,
  mapQishuiMediaList,
  pickObject,
  qishuiPlaylistCoverFromItem,
  qishuiPlaylistIsLikedCard,
  qishuiPlaylistNameFromItem,
  qishuiPlaylistPrimaryLikeName,
  qishuiProfileFromMeData,
} = require('./mapping');

const {
  getQishuiStatus,
} = require('./account');

async function fetchQishuiWebFeedSongs(cookieText, limit) {
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) return { provider: 'qishui', configured: false, webSession: false, songs: [], error: 'QISHUI_COOKIE_REQUIRED' };
  limit = Math.max(1, Math.min(50, Number(limit) || 8));
  const cacheKey = 'web-feed|' + qishuiCookieFingerprint(cookie) + '|' + limit;
  return qishuiFeedCache.wrap(cacheKey, 90 * 1000, async () => {
    const candidates = [
      { path: '/luna/feed/song-tab', params: { cursor: 0, cnt: limit, count: limit } },
      { path: '/luna/pc/feed/song-tab', params: { cursor: 0, cnt: limit, count: limit } },
    ];
    let lastErr = null;
    for (const item of candidates) {
      try {
        const json = await qishuiWebRequestJson(item.path, item.params, cookie, { timeoutMs: 8000 });
        const rawItems = extractQishuiMediaList(json);
        const songs = mapQishuiMediaList(rawItems, 'web-feed', { directPlayable: true }).slice(0, limit);
        if (songs.length) return { provider: 'qishui', configured: true, webSession: true, songs, rawCount: rawItems.length };
      } catch (err) {
        lastErr = err;
      }
    }
    try {
      const fallback = await fetchQishuiWebLibraryFeedFallback(cookie, limit);
      if (fallback && fallback.songs && fallback.songs.length) return fallback;
    } catch (fallbackErr) {
      lastErr = fallbackErr || lastErr;
    }
    return { provider: 'qishui', configured: true, webSession: true, songs: [], rawCount: 0, error: lastErr && lastErr.message || '' };
  });
}

async function fetchQishuiWebLibraryFeedFallback(cookieText, limit) {
  const cookie = normalizeQishuiCookieInput(cookieText);
  limit = Math.max(1, Math.min(50, Number(limit) || 8));
  const library = await fetchQishuiWebLibrary(cookie);
  let songs = dedupeQishuiSongs([]
    .concat(library.likedTracks || [])
    .concat(library.recentTracks || []));
  const detailCandidates = []
    .concat(library.likedCard ? [library.likedCard] : [])
    .concat((library.playlists || []).filter(pl => pl && pl.id));
  for (let i = 0; songs.length < limit && i < detailCandidates.length && i < 4; i += 1) {
    const pl = detailCandidates[i];
    if (!pl || !pl.id) continue;
    try {
      const detail = await fetchQishuiWebPlaylistTracks(pl.id, cookie, { limit: Math.max(limit, 12), offset: 0 });
      songs = dedupeQishuiSongs(songs.concat(detail && detail.tracks || []));
    } catch (_) {}
  }
  songs = songs.slice(0, limit);
  return {
    provider: 'qishui',
    configured: true,
    webSession: true,
    songs,
    rawCount: songs.length,
    source: 'qishui-web-library-fallback',
    fallback: true,
    error: songs.length ? '' : ((library.errors || []).join('; ') || 'QISHUI_WEB_FEED_EMPTY'),
  };
}

async function fetchQishuiWebLibrary(cookieText) {
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) {
    return { provider: 'qishui', loggedIn: false, webSession: false, playlists: [], likedTracks: [], recentTracks: [] };
  }
  const cacheKey = 'library|' + qishuiCookieFingerprint(cookie);
  return qishuiWebLibraryCache.wrap(cacheKey, 90 * 1000, async () => {
    const playlists = [];
    const likedTracks = [];
    const recentTracks = [];
    const cardTracks = [];
    const errors = [];
    const addSongs = (target, songs) => {
      target.push(...dedupeQishuiSongs(songs || []));
    };
    const tryRead = async (label, apiPath, params, requestOpts) => {
      requestOpts = requestOpts || {};
      try {
        const json = await qishuiWebRequestJson(apiPath, params || {}, cookie, Object.assign({
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          timeoutMs: 6500,
        }, requestOpts));
        if (/created|collection|collect/i.test(label)) {
          extractQishuiPlaylistCards(json).forEach(pl => {
            const primaryLike = qishuiPlaylistPrimaryLikeName(pl && pl.name);
            if (/created/i.test(label) || primaryLike) {
              pl.shelfPane = 'mine';
              pl.owned = true;
              pl.subscribed = false;
            } else {
              pl.shelfPane = 'fav';
              pl.owned = false;
              pl.subscribed = true;
            }
            playlists.push(pl);
          });
        }
        const songs = mapQishuiMediaList(extractQishuiMediaList(json), label, { directPlayable: true });
        if (/recent/i.test(label)) addSongs(recentTracks, songs);
        else if (/liked|favorite|collect/i.test(label)) addSongs(likedTracks, songs);
        else addSongs(cardTracks, songs);
        return json;
      } catch (err) {
        if (!requestOpts.optional) errors.push(label + ':' + (err && err.message || 'failed'));
        return null;
      }
    };

    const pcRequestOpts = { pcApp: true };
    const meJson = await tryRead('me', '/luna/pc/me', qishuiPcAppParams(), pcRequestOpts);
    const meData = (meJson && meJson.data) || meJson || {};
    const profile = qishuiProfileFromMeData(meData);
    const userId = profile.userId;

    await Promise.all([
      userId
        ? tryRead('created', '/luna/pc/user/playlist', qishuiPcAppParams({
          user_id: userId,
          cursor: '',
          count: 50,
        }), pcRequestOpts)
        : Promise.resolve(null),
      tryRead('collection', '/luna/pc/me/collection/mixed', qishuiPcAppParams({
        cursor: '',
        count: 50,
      }), Object.assign({ optional: true }, pcRequestOpts)),
      tryRead('recent', '/luna/pc/me/recently-played-media', qishuiPcAppParams({
        cursor: '',
        count: 50,
      }), Object.assign({ optional: true }, pcRequestOpts)),
    ]);
    if (!userId) errors.push('me:missing-user-id');

    const uniquePlaylists = [];
    const seenPlaylists = new Set();
    playlists.forEach(pl => {
      if (!pl || !pl.id || seenPlaylists.has(pl.id)) return;
      seenPlaylists.add(pl.id);
      uniquePlaylists.push(pl);
    });

    const likedCard = uniquePlaylists.find(pl => pl && pl.isLiked && qishuiPlaylistPrimaryLikeName(pl.name)) ||
      uniquePlaylists.find(pl => pl && pl.isLiked);
    return {
      provider: 'qishui',
      loggedIn: true,
      configured: true,
      webSession: true,
      playlists: uniquePlaylists,
      likedCard,
      likedTracks: dedupeQishuiSongs(likedTracks),
      recentTracks: dedupeQishuiSongs(recentTracks),
      profile,
      errors,
    };
  });
}

async function fetchQishuiWebPlaylistTracks(playlistId, cookieText, opts) {
  opts = opts || {};
  const cookie = normalizeQishuiCookieInput(cookieText);
  const id = normalizeText(String(playlistId || '').replace(/^qishui:/i, ''));
  if (!qishuiCookieHasLogin(cookie) || !id) {
    return { provider: 'qishui', configured: false, webSession: false, tracks: [], total: 0, error: 'QISHUI_COOKIE_REQUIRED' };
  }
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const cacheKey = 'playlist|' + qishuiCookieFingerprint(cookie) + '|' + id + '|' + limit + '|' + offset;
  return qishuiWebPlaylistCache.wrap(cacheKey, 90 * 1000, async () => {
    const targetCount = offset + limit;
    const cursorKey = qishuiCookieFingerprint(cookie) + '|' + id;
    let cursorState = qishuiWebPlaylistCursorCache.get(cursorKey);
    if (!cursorState || Date.now() - cursorState.updatedAt > 10 * 60 * 1000) {
      cursorState = { rawItems: [], cursor: '', hasMore: true, lastJson: null, updatedAt: Date.now(), promise: null };
      qishuiWebPlaylistCursorCache.set(cursorKey, cursorState);
    }
    while (cursorState.rawItems.length < targetCount && cursorState.hasMore) {
      if (!cursorState.promise) {
        cursorState.promise = qishuiWebRequestJson('/luna/pc/playlist/detail', qishuiPcAppParams({
          playlist_id: id,
          cursor: cursorState.cursor,
          count: Math.min(100, Math.max(1, targetCount - cursorState.rawItems.length)),
        }), cookie, {
          bases: [QISHUI_WEB_PC_API_BASE],
          noDefaultParams: true,
          sessionOnly: true,
          pcApp: true,
          timeoutMs: 9000,
        }).then(json => {
          cursorState.lastJson = json;
          const pageRawItems = extractQishuiMediaList(json);
          cursorState.rawItems.push(...pageRawItems);
          const pageData = (json && json.data) || json || {};
          const nextCursor = normalizeText(pageData.next_cursor || pageData.nextCursor || json && json.next_cursor || '');
          cursorState.cursor = nextCursor;
          cursorState.hasMore = !!(pageData.has_more || pageData.hasMore || json && json.has_more) && !!nextCursor;
          cursorState.updatedAt = Date.now();
          if (!pageRawItems.length) cursorState.hasMore = false;
        }).finally(() => { cursorState.promise = null; });
      }
      await cursorState.promise;
    }
    while (qishuiWebPlaylistCursorCache.size > 12) qishuiWebPlaylistCursorCache.delete(qishuiWebPlaylistCursorCache.keys().next().value);
    const allRawItems = cursorState.rawItems;
    const lastJson = cursorState.lastJson;
    const upstreamHasMore = cursorState.hasMore;
    const data = (lastJson && lastJson.data) || lastJson || {};
    const meta = pickObject(data.playlist, lastJson && lastJson.playlist, data.playlist_info, lastJson && lastJson.playlist_info);
    const playlistCover = qishuiPlaylistCoverFromItem(meta);
    const allTracks = mapQishuiMediaList(allRawItems, 'web-playlist', { directPlayable: true })
      .map(song => song && !song.cover && playlistCover ? Object.assign({}, song, { cover: playlistCover }) : song);
    const tracks = allTracks.slice(offset, offset + limit);
    const total = Number(meta.count_tracks || meta.track_count || data.total || data.count || data.total_num || allRawItems.length || allTracks.length) || allTracks.length;
    const playlist = buildQishuiVirtualPlaylist(id, qishuiPlaylistNameFromItem(meta) || '汽水歌单', tracks, {
      cover: playlistCover,
      trackCount: total,
      subscribed: true,
      webSession: true,
    });
    playlist.virtual = false;
    return {
      provider: 'qishui',
      loggedIn: true,
      configured: true,
      webSession: true,
      playlist,
      tracks,
      total,
      offset,
      limit,
      nextOffset: offset + tracks.length,
      hasMore: upstreamHasMore || offset + tracks.length < total,
      rawCount: allRawItems.length,
    };
  });
}

function buildQishuiFeedPlaylist(songs) {
  songs = Array.isArray(songs) ? songs : [];
  const firstCover = songs.map(song => song && song.cover).find(Boolean) || '';
  return {
    provider: 'qishui',
    source: 'qishui',
    type: 'playlist',
    id: QISHUI_VIRTUAL_FEED_PLAYLIST_ID,
    name: '汽水推荐',
    cover: firstCover,
    trackCount: songs.length,
    playCount: 0,
    creator: '汽水音乐',
    subscribed: false,
    virtual: true,
    playbackMode: 'recommend-match',
  };
}

async function fetchQishuiFeedSongs(limit, cookieText) {
  limit = Math.max(1, Math.min(50, Number(limit) || 8));
  const status = getQishuiStatus(cookieText);
  if (!status.tokenConfigured && status.webSession) return fetchQishuiWebFeedSongs(cookieText, limit);
  if (!status.tokenConfigured) return { provider: 'qishui', configured: false, songs: [], error: 'QISHUI_TOKEN_REQUIRED', message: status.message };
  const cacheKey = 'feed|' + limit;
  return qishuiFeedCache.wrap(cacheKey, 90 * 1000, async () => {
    const json = await qishuiPost(QISHUI_FEED_SONG_TAB_PATH, {
      count: limit,
      played_media: [],
      common_params: {
        trigger_name: 'mineradio_feed',
        scene: 'feed',
        source: 'mineradio',
      },
    });
    const rawItems = extractQishuiMediaList(json);
    const songs = rawItems.map((item, index) => mapQishuiMedia(item, index, 'feed')).filter(Boolean).slice(0, limit);
    return { provider: 'qishui', configured: true, songs, rawCount: rawItems.length };
  });
}

async function handleQishuiFeed(limit, cookieText) {
  return fetchQishuiFeedSongs(Math.max(1, Math.min(18, Number(limit) || 8)), cookieText);
}

async function handleQishuiUserPlaylists(cookieText) {
  const status = getQishuiStatus(cookieText);
  if (status.webSession) {
    try {
      const library = await fetchQishuiWebLibrary(cookieText);
      const feed = await fetchQishuiFeedSongs(24, cookieText).catch(() => ({ songs: [], rawCount: 0 }));
      const likedTracks = library.likedTracks || [];
      const likedCard = library.likedCard || {};
      const likedId = normalizeText(likedCard.id || '');
      const profile = library.profile || {};
      const recentTracks = library.recentTracks || [];
      const playlists = [
        buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, '汽水我的喜欢', likedTracks, {
          subscribed: false,
          shelfPane: 'mine',
          owned: true,
          webSession: true,
          cover: likedCard.cover,
          trackCount: likedTracks.length || likedCard.trackCount || 0,
          creator: profile.nickname || likedCard.creator,
        }),
      ];
      (library.playlists || []).forEach(pl => {
        if (!pl || !pl.id || playlists.some(item => item.id === pl.id)) return;
        // 上游「我喜欢的音乐」与我们合成的虚拟卡片「汽水我的喜欢」(qishui-liked) 是**同一条歌单**：
        // 实测 likedCard.id=7270418412470304808、name='Ta喜欢的音乐'、7 首、封面与虚拟卡片完全一致，
        // 点进去上游自己报的 playlist.name 就是「我喜欢的音乐」。两条都留 = 卡片重复。
        // 保留虚拟卡片（它才走 handleQishuiPlaylistTracks 的 liked 分页分支），丢弃上游这条。
        if (qishuiPlaylistIsLikedCard(pl, likedId)) return;
        playlists.push(pl);
      });
      if (recentTracks.length) {
        playlists.push(buildQishuiVirtualPlaylist(QISHUI_WEB_RECENT_PLAYLIST_ID, '汽水最近播放', recentTracks, {
          subscribed: false,
          shelfPane: 'mine',
          owned: true,
          webSession: true,
        }));
      }
      playlists.push(buildQishuiFeedPlaylist((feed && feed.songs) || []));
      return {
        provider: 'qishui',
        loggedIn: true,
        configured: true,
        webSession: true,
        playlists,
        tracksPreview: likedTracks.slice(0, 8),
        rawCount: (feed && feed.rawCount) || 0,
        libraryErrors: library.errors || [],
        profile,
        userId: profile.userId || '',
        nickname: profile.nickname || '',
        avatar: profile.avatar || '',
      };
    } catch (err) {
      return {
        provider: 'qishui',
        loggedIn: true,
        configured: true,
        webSession: true,
        playlists: [
          buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, '汽水我的喜欢', [], { subscribed: false, shelfPane: 'mine', owned: true, webSession: true }),
          buildQishuiFeedPlaylist([]),
        ],
        error: err && err.message || 'QISHUI_WEB_LIBRARY_FAILED',
        message: '汽水账号已登录，但歌单同步暂时失败，请稍后重试。',
      };
    }
  }
  if (!status.configured) {
    return {
      provider: 'qishui',
      loggedIn: false,
      configured: false,
      playlists: [],
      error: 'QISHUI_TOKEN_REQUIRED',
      message: status.message,
    };
  }
  try {
    const feed = await fetchQishuiFeedSongs(24, cookieText);
    const playlist = buildQishuiFeedPlaylist(feed.songs || []);
    return {
      provider: 'qishui',
      loggedIn: true,
      configured: true,
      playlists: [playlist],
      tracksPreview: (feed.songs || []).slice(0, 8),
      rawCount: feed.rawCount || 0,
    };
  } catch (err) {
    return {
      provider: 'qishui',
      loggedIn: true,
      configured: true,
      playlists: [],
      error: err && err.message || 'QISHUI_FEED_FAILED',
      message: '汽水推荐歌单暂时同步失败，请稍后重试。',
    };
  }
}

async function handleQishuiPlaylistTracks(playlistId, opts, cookieText) {
  opts = opts || {};
  const status = getQishuiStatus(cookieText);
  const id = normalizeText(String(playlistId || '').replace(/^qishui:/i, ''));
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  if (status.webSession) {
    if (id === QISHUI_WEB_LIKED_PLAYLIST_ID || id === 'liked' || id === 'favorite') {
      const library = await fetchQishuiWebLibrary(cookieText);
      let allSongs = library.likedTracks || [];
      if (!allSongs.length && library.likedCard && library.likedCard.id) {
        const detail = await fetchQishuiWebPlaylistTracks(library.likedCard.id, cookieText, opts).catch(() => null);
        if (detail && detail.tracks) {
          const playlist = buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, '汽水我的喜欢', detail.tracks, {
            subscribed: false,
            shelfPane: 'mine',
            owned: true,
            webSession: true,
            cover: library.likedCard.cover || detail.playlist && detail.playlist.cover,
            trackCount: detail.total || library.likedCard.trackCount || detail.tracks.length,
            creator: library.profile && library.profile.nickname,
          });
          return {
            provider: 'qishui',
            loggedIn: true,
            configured: true,
            webSession: true,
            playlist,
            tracks: detail.tracks,
            total: detail.total || detail.tracks.length,
            offset,
            limit,
            nextOffset: detail.nextOffset,
            hasMore: !!detail.hasMore,
          };
        }
      }
      const tracks = allSongs.slice(offset, offset + limit);
      const playlist = buildQishuiVirtualPlaylist(QISHUI_WEB_LIKED_PLAYLIST_ID, '汽水我的喜欢', allSongs, {
        subscribed: false,
        shelfPane: 'mine',
        owned: true,
        webSession: true,
        cover: library.likedCard && library.likedCard.cover,
        trackCount: allSongs.length || library.likedCard && library.likedCard.trackCount || 0,
        creator: library.profile && library.profile.nickname,
      });
      return {
        provider: 'qishui',
        loggedIn: true,
        configured: true,
        webSession: true,
        playlist,
        tracks,
        total: allSongs.length,
        offset,
        limit,
        nextOffset: offset + tracks.length,
        hasMore: offset + tracks.length < allSongs.length,
      };
    }
    if (id === QISHUI_WEB_RECENT_PLAYLIST_ID || id === 'recent') {
      const library = await fetchQishuiWebLibrary(cookieText);
      const allSongs = library.recentTracks || [];
      const tracks = allSongs.slice(offset, offset + limit);
      const playlist = buildQishuiVirtualPlaylist(QISHUI_WEB_RECENT_PLAYLIST_ID, '汽水最近播放', allSongs, {
        subscribed: false,
        shelfPane: 'mine',
        owned: true,
        webSession: true,
      });
      return {
        provider: 'qishui',
        loggedIn: true,
        configured: true,
        webSession: true,
        playlist,
        tracks,
        total: allSongs.length,
        offset,
        limit,
        nextOffset: offset + tracks.length,
        hasMore: offset + tracks.length < allSongs.length,
      };
    }
    if (id && id !== QISHUI_VIRTUAL_FEED_PLAYLIST_ID && id !== 'feed') {
      return fetchQishuiWebPlaylistTracks(id, cookieText, opts);
    }
  }
  if (!status.configured) {
    return {
      provider: 'qishui',
      loggedIn: false,
      configured: false,
      playlist: buildQishuiFeedPlaylist([]),
      tracks: [],
      total: 0,
      error: 'QISHUI_TOKEN_REQUIRED',
      message: status.message,
    };
  }
  if (id && id !== QISHUI_VIRTUAL_FEED_PLAYLIST_ID && id !== 'feed') {
    return {
      provider: 'qishui',
      loggedIn: true,
      configured: true,
      playlist: buildQishuiFeedPlaylist([]),
      tracks: [],
      total: 0,
      error: 'QISHUI_PLAYLIST_NOT_FOUND',
      message: '当前汽水接入只支持官方推荐歌单。',
    };
  }
  const fetchCount = Math.max(limit, Math.min(50, offset + limit));
  const feed = await fetchQishuiFeedSongs(fetchCount, cookieText);
  const allSongs = feed.songs || [];
  const tracks = allSongs.slice(offset, offset + limit);
  const playlist = buildQishuiFeedPlaylist(allSongs);
  return {
    provider: 'qishui',
    loggedIn: true,
    configured: true,
    playlist,
    tracks,
    total: allSongs.length,
    offset,
    limit,
    nextOffset: offset + tracks.length,
    hasMore: false,
    rawCount: feed.rawCount || allSongs.length,
  };
}

module.exports = {
  fetchQishuiWebFeedSongs,
  fetchQishuiWebLibraryFeedFallback,
  fetchQishuiWebLibrary,
  fetchQishuiWebPlaylistTracks,
  buildQishuiFeedPlaylist,
  fetchQishuiFeedSongs,
  handleQishuiFeed,
  handleQishuiUserPlaylists,
  handleQishuiPlaylistTracks,
};
