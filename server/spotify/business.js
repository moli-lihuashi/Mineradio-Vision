'use strict';

// Spotify：业务编排（搜索 / 推荐 / 歌单 / 专辑 / 库操作 / 取址 / 歌词 / OAuth）。
//
// 从 spotify-api.js 抽出。依赖 config + http + mapping 三个底座，不反向回指。

const {
  SPOTIFY_ACCOUNTS_BASE,
  DEFAULT_SPOTIFY_MARKET,
  DEFAULT_SPOTIFY_SCOPES,
  SPOTIFY_LIKED_PLAYLIST_ID,
  SPOTIFY_SEARCH_LIMIT_MAX,
  SPOTIFY_PLAYLIST_PAGE_LIMIT,
  spotifySearchCache,
  SPOTIFY_PROFILE_CACHE_TTL_MS,
  normalizeText,
  uniqueList,
  normalizeScopes,
  getSpotifyOAuthConfig,
  spotifyUrl,
} = require('./config');

const {
  spotifyProfileCache,
  readStoredSpotifyToken,
  saveSpotifyOAuthToken,
  getSpotifyConfig,
  spotifyErrorDetails,
  requestSpotifyToken,
  spotifyUserRequest,
  spotifyGet,
  spotifyUserGet,
  cacheWrap,
} = require('./http');

const {
  spotifyImage,
  mapSpotifyTrack,
  dedupeSpotifySongs,
  normalizeSpotifyProfile,
  mapSpotifyPlaylist,
  spotifyLibraryUri,
} = require('./mapping');

async function getSpotifyProfile(options) {
  options = options || {};
  const now = Date.now();
  if (!options.force && spotifyProfileCache.value && now - spotifyProfileCache.at < SPOTIFY_PROFILE_CACHE_TTL_MS) {
    return spotifyProfileCache.value;
  }
  if (spotifyProfileCache.promise) return spotifyProfileCache.promise;
  spotifyProfileCache.promise = spotifyUserGet('/me', {}, { timeoutMs: options.timeoutMs || 9000 })
    .then((profile) => {
      spotifyProfileCache.value = profile || {};
      spotifyProfileCache.at = Date.now();
      return spotifyProfileCache.value;
    })
    .finally(() => { spotifyProfileCache.promise = null; });
  return spotifyProfileCache.promise;
}

function buildSpotifyOAuthAuthorizeUrl(options) {
  options = options || {};
  const config = getSpotifyOAuthConfig();
  if (!config.configured) {
    const err = new Error('SPOTIFY_OAUTH_NOT_CONFIGURED');
    err.code = 'SPOTIFY_OAUTH_NOT_CONFIGURED';
    err.missing = config.missing;
    throw err;
  }
  const codeChallenge = normalizeText(options.codeChallenge || options.code_challenge);
  if (!codeChallenge) {
    const err = new Error('SPOTIFY_PKCE_CHALLENGE_REQUIRED');
    err.code = 'SPOTIFY_PKCE_CHALLENGE_REQUIRED';
    throw err;
  }
  const redirectUri = normalizeText(options.redirectUri || config.redirectUri);
  const url = new URL('/authorize', SPOTIFY_ACCOUNTS_BASE + '/');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('scope', normalizeText(options.scope || config.scope || DEFAULT_SPOTIFY_SCOPES.join(' ')));
  if (options.state) url.searchParams.set('state', String(options.state));
  if (options.showDialog) url.searchParams.set('show_dialog', 'true');
  return url.toString();
}

async function exchangeSpotifyOAuthCode(options) {
  options = options || {};
  const config = getSpotifyOAuthConfig();
  if (!config.configured) {
    const err = new Error('SPOTIFY_OAUTH_NOT_CONFIGURED');
    err.code = 'SPOTIFY_OAUTH_NOT_CONFIGURED';
    err.missing = config.missing;
    throw err;
  }
  const code = normalizeText(options.code);
  const codeVerifier = normalizeText(options.codeVerifier || options.code_verifier);
  if (!code) throw new Error('SPOTIFY_OAUTH_CODE_MISSING');
  if (!codeVerifier) throw new Error('SPOTIFY_PKCE_VERIFIER_MISSING');
  const json = await requestSpotifyToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: normalizeText(options.redirectUri || config.redirectUri),
    code_verifier: codeVerifier,
  });
  saveSpotifyOAuthToken(Object.assign({}, json, { newAuthorization: true }));
  return handleSpotifyStatus();
}

async function handleSpotifyStatus() {
  const config = getSpotifyConfig();
  const token = readStoredSpotifyToken();
  let profile = null;
  let profileError = '';
  let profileErrorDetail = null;
  let loggedIn = false;
  if (token.accessToken || token.refreshToken) {
    try {
      profile = await getSpotifyProfile({ timeoutMs: 9000 });
      loggedIn = true;
    } catch (err) {
      profileError = err.message || 'SPOTIFY_PROFILE_FAILED';
      profileErrorDetail = spotifyErrorDetails(err);
    }
  }
  const currentToken = readStoredSpotifyToken();
  const tokenScopes = normalizeScopes(currentToken.scope);
  const missingWriteScopes = [
    'user-library-modify',
    'playlist-modify-private',
    'playlist-modify-public',
  ].filter(scope => !tokenScopes.includes(scope));
  const normalized = normalizeSpotifyProfile(profile);
  return Object.assign({}, config, normalized, {
    clientSecret: '',
    loggedIn,
    configured: !!(config.configured || loggedIn),
    profileReady: loggedIn,
    tokenConfigured: !!(currentToken.accessToken || currentToken.refreshToken),
    tokenReady: !!(currentToken.accessToken && Date.now() < currentToken.expiresAt - 30000),
    authorizedAt: currentToken.authorizedAt || 0,
    stale: !!(!loggedIn && (currentToken.accessToken || currentToken.refreshToken)),
    reauthRequired: !!(profileErrorDetail && profileErrorDetail.reauthRequired),
    error: profileErrorDetail && profileErrorDetail.error || profileError || '',
    errorMessage: profileErrorDetail && profileErrorDetail.message || '',
    capabilities: Object.assign({}, config.capabilities, {
      search: !!(config.clientCredentialsConfigured || loggedIn),
      metadata: !!(config.clientCredentialsConfigured || loggedIn),
      userPlaylists: loggedIn,
      likedTracks: loggedIn,
      likeWrite: loggedIn && tokenScopes.includes('user-library-modify'),
      playlistWrite: loggedIn && (
        tokenScopes.includes('playlist-modify-private') ||
        tokenScopes.includes('playlist-modify-public')
      ),
      lyric: false,
      playableUrl: false,
    }),
    missingWriteScopes,
    accountWriteReady: loggedIn && missingWriteScopes.length === 0,
    message: loggedIn
      ? (missingWriteScopes.length
        ? 'Spotify 已连接；重新授权一次后可写入喜欢和歌单。播放仍会自动换源。'
        : 'Spotify 登录态已保存，可同步会员状态、喜欢和歌单；播放仍会自动换源。')
      : config.message,
  });
}

async function handleSpotifySearch(keywords, limit, offset) {
  keywords = normalizeText(keywords);
  limit = Math.max(1, Math.min(20, Number(limit) || 8));
  offset = Math.max(0, Number(offset) || 0);
  const status = getSpotifyConfig();
  if (!keywords) return { provider: 'spotify', configured: status.configured, songs: [], message: status.message };
  if (!status.capabilities.search) {
    return {
      provider: 'spotify',
      configured: status.configured,
      songs: [],
      error: 'SPOTIFY_AUTH_REQUIRED',
      reason: 'missing_spotify_auth',
      message: status.message,
      missing: status.oauthMissing && status.oauthMissing.length ? status.oauthMissing : status.missing,
    };
  }
  const cacheKey = [keywords.toLowerCase(), limit, offset, status.market, status.tokenConfigured ? 'user' : 'client'].join('|');
  return cacheWrap(spotifySearchCache, cacheKey, 2 * 60 * 1000, async () => {
    const pages = [];
    let pageOffset = offset;
    let hasMore = false;
    let total = 0;
    while (pages.length < limit) {
      const pageLimit = Math.min(SPOTIFY_SEARCH_LIMIT_MAX, limit - pages.length);
      const json = await spotifyGet('/search', {
        q: keywords,
        type: 'track',
        market: status.market,
        limit: pageLimit,
        offset: pageOffset,
      }, { timeoutMs: 9000, preferUser: true });
      const items = json && json.tracks && Array.isArray(json.tracks.items) ? json.tracks.items : [];
      pages.push(...items);
      total = Number(json && json.tracks && json.tracks.total) || total;
      hasMore = !!(json && json.tracks && json.tracks.next);
      if (!items.length || !hasMore) break;
      pageOffset += items.length;
    }
    const songs = dedupeSpotifySongs(pages.map((item, index) => mapSpotifyTrack(item, index, keywords)).filter(Boolean)).slice(0, limit);
    return {
      provider: 'spotify',
      configured: true,
      market: status.market,
      songs,
      rawCount: pages.length,
      total,
      offset,
      limit,
      nextOffset: offset + pages.length,
      hasMore,
      message: songs.length ? '' : 'Spotify 没有返回匹配结果。',
    };
  });
}

async function handleSpotifyRecommendations(limit) {
  limit = Math.max(1, Math.min(SPOTIFY_SEARCH_LIMIT_MAX, Number(limit) || 10));
  const status = getSpotifyConfig();
  const token = readStoredSpotifyToken();
  const scopes = normalizeScopes(token.scope);
  if (!token.accessToken && !token.refreshToken) {
    return {
      provider: 'spotify',
      loggedIn: false,
      songs: [],
      mode: 'unavailable',
      provenance: 'spotify-web-api',
      error: 'SPOTIFY_AUTH_REQUIRED',
      message: '连接 Spotify 后显示你的常听歌曲。',
    };
  }
  let items = [];
  let mode = '';
  if (scopes.includes('user-top-read')) {
    try {
      const json = await spotifyUserGet('/me/top/tracks', {
        limit,
        offset: 0,
        time_range: 'medium_term',
      }, { timeoutMs: 9000 });
      items = json && Array.isArray(json.items) ? json.items : [];
      mode = 'personal-top';
    } catch (err) {
      console.warn('[SpotifyRecommendations] top tracks:', err.message);
    }
  }
  if (!items.length && scopes.includes('user-library-read')) {
    try {
      const json = await spotifyUserGet('/me/tracks', {
        limit,
        offset: 0,
        market: status.market,
      }, { timeoutMs: 9000 });
      const rows = json && Array.isArray(json.items) ? json.items : [];
      items = rows.map(row => row && row.track).filter(Boolean);
      mode = 'liked-affinity';
    } catch (err) {
      console.warn('[SpotifyRecommendations] liked tracks:', err.message);
    }
  }
  const songs = dedupeSpotifySongs(items.map((item, index) => mapSpotifyTrack(item, index, 'personal')).filter(Boolean)).slice(0, limit);
  return {
    provider: 'spotify',
    loggedIn: true,
    songs,
    mode: mode || 'unavailable',
    provenance: 'spotify-web-api',
    updatedAt: Date.now(),
    message: songs.length ? '' : '当前授权没有可读取的常听或喜欢歌曲；重新连接 Spotify 可启用个人推荐。',
  };
}

async function buildSpotifyLikedPlaylistCard(profile) {
  try {
    const json = await spotifyUserGet('/me/tracks', { limit: 1, offset: 0, market: getSpotifyConfig().market }, { timeoutMs: 9000 });
    const first = json && Array.isArray(json.items) && json.items[0] && json.items[0].track;
    return {
      provider: 'spotify',
      source: 'spotify',
      id: SPOTIFY_LIKED_PLAYLIST_ID,
      virtual: true,
      name: 'Spotify 喜欢的歌曲',
      cover: first ? spotifyImage(first.album && first.album.images) : '',
      creator: normalizeText(profile && (profile.display_name || profile.id)) || 'Spotify',
      trackCount: Number(json && json.total) || 0,
      playCount: 0,
      subscribed: false,
      shelfPane: 'fav',
    };
  } catch (err) {
    const detail = spotifyErrorDetails(err);
    return {
      provider: 'spotify',
      source: 'spotify',
      id: SPOTIFY_LIKED_PLAYLIST_ID,
      virtual: true,
      name: 'Spotify 喜欢的歌曲',
      cover: '',
      creator: normalizeText(profile && (profile.display_name || profile.id)) || 'Spotify',
      trackCount: 0,
      playCount: 0,
      subscribed: false,
      shelfPane: 'fav',
      warning: detail.message,
      error: detail.error,
      message: detail.message,
    };
  }
}

async function handleSpotifyUserPlaylists(options) {
  options = options || {};
  const status = await handleSpotifyStatus();
  if (!status.loggedIn) {
    return { provider: 'spotify', loggedIn: false, playlists: [], message: status.message, error: status.error || '' };
  }
  const profile = await getSpotifyProfile({ timeoutMs: 9000 });
  const maxTotal = Math.max(1, Math.min(500, Number(options.limit) || 300));
  const playlists = [];
  const startOffset = Math.max(0, Number(options.offset) || 0);
  let offset = startOffset;
  let playlistError = null;
  let lastPage = null;
  try {
    while (playlists.length < maxTotal) {
      const pageLimit = Math.min(SPOTIFY_PLAYLIST_PAGE_LIMIT, maxTotal - playlists.length);
      const json = await spotifyUserGet('/me/playlists', { limit: pageLimit, offset }, { timeoutMs: 9000 });
      lastPage = json;
      const items = Array.isArray(json && json.items) ? json.items : [];
      items.forEach((item) => {
        const mapped = mapSpotifyPlaylist(item, profile);
        if (mapped) playlists.push(mapped);
      });
      if (!items.length || !(json && json.next)) break;
      offset += items.length;
    }
  } catch (err) {
    playlistError = spotifyErrorDetails(err);
  }
  const likedCard = await buildSpotifyLikedPlaylistCard(profile);
  const total = Math.max(playlists.length + startOffset, Number(lastPage && lastPage.total) || 0) + 1;
  const nextOffset = startOffset + playlists.length;
  return {
    provider: 'spotify',
    loggedIn: true,
    userId: normalizeText(profile && profile.id),
    playlists: (startOffset === 0 ? [likedCard] : []).concat(playlists),
    total,
    offset: startOffset,
    limit: maxTotal,
    nextOffset,
    hasMore: !!(lastPage && lastPage.next) && nextOffset < total,
    partial: true,
    error: playlistError && playlistError.error || '',
    message: playlistError && playlistError.message || '',
  };
}

async function handleSpotifyPlaylistTracks(playlistId, opts) {
  opts = opts || {};
  playlistId = normalizeText(playlistId);
  const status = await handleSpotifyStatus();
  if (!status.loggedIn) {
    return { provider: 'spotify', loggedIn: false, playlist: { id: playlistId, provider: 'spotify', name: '' }, tracks: [], message: status.message, error: status.error || '' };
  }
  const limit = Math.max(1, Math.min(SPOTIFY_PLAYLIST_PAGE_LIMIT, Number(opts.limit) || 48));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const market = normalizeText(opts.market || status.market || DEFAULT_SPOTIFY_MARKET);
  if (!playlistId || playlistId === SPOTIFY_LIKED_PLAYLIST_ID || playlistId === 'liked') {
    let json = null;
    try {
      json = await spotifyUserGet('/me/tracks', { limit, offset, market }, { timeoutMs: 12000 });
    } catch (err) {
      const detail = spotifyErrorDetails(err);
      return Object.assign({
        provider: 'spotify',
        loggedIn: true,
        playlist: {
          provider: 'spotify',
          id: SPOTIFY_LIKED_PLAYLIST_ID,
          name: 'Spotify 喜欢的歌曲',
          trackCount: 0,
        },
        tracks: [],
        total: 0,
        offset,
        limit,
        nextOffset: offset,
        hasMore: false,
        partial: true,
      }, detail);
    }
    const items = Array.isArray(json && json.items) ? json.items : [];
    const tracks = items.map((item, index) => mapSpotifyTrack(item && item.track, offset + index, 'liked')).filter(Boolean);
    return {
      provider: 'spotify',
      loggedIn: true,
      playlist: {
        provider: 'spotify',
        id: SPOTIFY_LIKED_PLAYLIST_ID,
        name: 'Spotify 喜欢的歌曲',
        trackCount: Number(json && json.total) || tracks.length,
      },
      tracks,
      total: Number(json && json.total) || tracks.length,
      offset,
      limit,
      nextOffset: offset + items.length,
      hasMore: !!(json && json.next),
      partial: true,
    };
  }
  let json = null;
  try {
    json = await spotifyUserGet('/playlists/' + encodeURIComponent(playlistId) + '/items', { limit, offset, market }, { timeoutMs: 12000 });
  } catch (err) {
    const detail = spotifyErrorDetails(err);
    if (detail.statusCode === 403) {
      const storedScopes = normalizeScopes(readStoredSpotifyToken().scope);
      const requiredScopes = ['playlist-read-private', 'playlist-read-collaborative'];
      const missingScopes = requiredScopes.filter(scope => !storedScopes.includes(scope));
      if (missingScopes.length) {
        detail.message = 'Spotify 当前授权缺少歌单读取范围，请在账号页重新授权后再试。';
        detail.error = 'SPOTIFY_PLAYLIST_SCOPE_REQUIRED';
        detail.missingScopes = missingScopes;
      } else {
        detail.message = 'Spotify 当前只允许展开本账号自己创建或参与协作的歌单；关注的他人歌单只能同步名称和封面。';
        detail.error = 'SPOTIFY_PLAYLIST_ITEMS_RESTRICTED';
      }
    }
    return Object.assign({
      provider: 'spotify',
      loggedIn: true,
      playlist: {
        provider: 'spotify',
        id: playlistId,
        name: '',
        trackCount: 0,
      },
      tracks: [],
      total: 0,
      offset,
      limit,
      nextOffset: offset,
      hasMore: false,
      partial: true,
    }, detail);
  }
  const items = Array.isArray(json && json.items) ? json.items : [];
  const tracks = items.map((entry, index) => {
    const item = entry && (entry.item || entry.track);
    if (item && item.type && item.type !== 'track') return null;
    return mapSpotifyTrack(item, offset + index, playlistId);
  }).filter(Boolean);
  return {
    provider: 'spotify',
    loggedIn: true,
    playlist: {
      provider: 'spotify',
      id: playlistId,
      name: '',
      trackCount: Number(json && json.total) || tracks.length,
    },
    tracks,
    total: Number(json && json.total) || tracks.length,
    offset,
    limit,
    nextOffset: offset + items.length,
    hasMore: !!(json && json.next),
    partial: true,
  };
}

async function handleSpotifyAlbumDetail(albumId, opts) {
  opts = opts || {};
  const id = normalizeText(albumId);
  const limit = Math.max(1, Math.min(100, parseInt(opts.limit || '80', 10) || 80));
  const market = normalizeText(opts.market || getSpotifyConfig().market);
  if (!id) return { provider: 'spotify', error: 'MISSING_ALBUM_ID', album: null, songs: [] };
  const params = market ? { market } : {};
  const album = await spotifyGet('/albums/' + encodeURIComponent(id), params, { timeoutMs: 12000 });
  const albumInfo = {
    provider: 'spotify',
    id: normalizeText(album && album.id) || id,
    albumId: normalizeText(album && album.id) || id,
    name: normalizeText(album && album.name),
    artist: Array.isArray(album && album.artists) ? album.artists.map(artist => normalizeText(artist && artist.name)).filter(Boolean).join(' / ') : '',
    artists: Array.isArray(album && album.artists) ? album.artists.map(artist => ({ id: normalizeText(artist && artist.id), name: normalizeText(artist && artist.name), uri: normalizeText(artist && artist.uri) })).filter(artist => artist.name) : [],
    cover: spotifyImage(album && album.images),
    releaseDate: normalizeText(album && album.release_date),
    trackCount: Number(album && album.total_tracks) || 0,
    spotifyUrl: album && album.external_urls && album.external_urls.spotify || '',
    spotifyUri: normalizeText(album && album.uri),
  };
  let items = album && album.tracks && Array.isArray(album.tracks.items) ? album.tracks.items.slice() : [];
  let offset = items.length;
  while (items.length < limit && album && album.tracks && album.tracks.next) {
    const page = await spotifyGet('/albums/' + encodeURIComponent(id) + '/tracks', {
      limit: Math.min(50, limit - items.length),
      offset,
      ...(market ? { market } : {}),
    }, { timeoutMs: 12000 });
    const pageItems = Array.isArray(page && page.items) ? page.items : [];
    items = items.concat(pageItems);
    offset += pageItems.length;
    if (!page || !page.next || !pageItems.length) break;
  }
  const songs = items.slice(0, limit).map((track, index) => {
    if (!track) return null;
    return mapSpotifyTrack(Object.assign({}, track, {
      album: {
        id: albumInfo.albumId,
        name: albumInfo.name,
        uri: albumInfo.spotifyUri,
        images: album && album.images,
      },
    }), index, 'album:' + id);
  }).filter(Boolean);
  return {
    provider: 'spotify',
    album: albumInfo,
    songs,
    total: albumInfo.trackCount || songs.length,
  };
}

function requireSpotifyScopes(required) {
  required = uniqueList(required);
  const granted = normalizeScopes(readStoredSpotifyToken().scope);
  const missing = required.filter(scope => !granted.includes(scope));
  if (!missing.length) return;
  const err = new Error('SPOTIFY_WRITE_SCOPE_REQUIRED');
  err.code = 'SPOTIFY_WRITE_SCOPE_REQUIRED';
  err.statusCode = 403;
  err.missingScopes = missing;
  err.reauthRequired = true;
  throw err;
}

async function handleSpotifyLibraryCheck(type, values) {
  const raw = Array.isArray(values) ? values : String(values == null ? '' : values).split(',');
  const pairs = raw.map(value => ({
    id: normalizeText(value && typeof value === 'object'
      ? (value.spotifyId || value.providerSongId || value.albumId || value.id || value.spotifyUri || value.uri)
      : value),
    uri: spotifyLibraryUri(type, value),
  })).filter(item => item.id && item.uri).slice(0, 40);
  if (!pairs.length) return { provider: 'spotify', ids: [], liked: {} };
  const result = await spotifyUserGet('/me/library/contains', {
    uris: pairs.map(item => item.uri).join(','),
  }, { timeoutMs: 9000 });
  const valuesOut = Array.isArray(result) ? result : [];
  const liked = {};
  pairs.forEach((item, index) => { liked[item.id] = !!valuesOut[index]; });
  return {
    provider: 'spotify',
    loggedIn: true,
    ids: pairs.map(item => item.id),
    liked,
  };
}

async function handleSpotifyLibrarySet(type, value, saved) {
  requireSpotifyScopes(['user-library-modify']);
  const uri = spotifyLibraryUri(type, value);
  if (!uri) {
    const err = new Error('SPOTIFY_ITEM_ID_REQUIRED');
    err.code = 'SPOTIFY_ITEM_ID_REQUIRED';
    throw err;
  }
  await spotifyUserRequest('/me/library', saved === false ? 'DELETE' : 'PUT', { uris: uri }, null, { timeoutMs: 9000 });
  return {
    provider: 'spotify',
    loggedIn: true,
    id: uri.split(':').pop(),
    uri,
    liked: saved !== false,
    saved: saved !== false,
    success: true,
  };
}

async function handleSpotifyPlaylistAddSong(playlistId, song) {
  const tokenScopes = normalizeScopes(readStoredSpotifyToken().scope);
  if (!tokenScopes.includes('playlist-modify-private') && !tokenScopes.includes('playlist-modify-public')) {
    requireSpotifyScopes(['playlist-modify-private']);
  }
  playlistId = normalizeText(playlistId).replace(/^spotify:/i, '');
  const uri = spotifyLibraryUri('track', song);
  if (!playlistId || !uri) {
    const err = new Error('SPOTIFY_PLAYLIST_OR_TRACK_REQUIRED');
    err.code = 'SPOTIFY_PLAYLIST_OR_TRACK_REQUIRED';
    throw err;
  }
  const result = await spotifyUserRequest(
    '/playlists/' + encodeURIComponent(playlistId) + '/items',
    'POST',
    {},
    { uris: [uri] },
    { timeoutMs: 10000 }
  );
  return {
    provider: 'spotify',
    loggedIn: true,
    pid: playlistId,
    id: uri.split(':').pop(),
    uri,
    snapshotId: normalizeText(result && result.snapshot_id),
    success: true,
  };
}

async function handleSpotifyCreatePlaylist(name, opts) {
  opts = opts || {};
  name = normalizeText(name);
  if (!name) {
    const err = new Error('SPOTIFY_PLAYLIST_NAME_REQUIRED');
    err.code = 'SPOTIFY_PLAYLIST_NAME_REQUIRED';
    throw err;
  }
  const isPublic = opts.public === true;
  requireSpotifyScopes([isPublic ? 'playlist-modify-public' : 'playlist-modify-private']);
  const profile = await getSpotifyProfile({ timeoutMs: 9000 });
  const created = await spotifyUserRequest('/me/playlists', 'POST', {}, {
    name,
    public: isPublic,
    collaborative: false,
    description: normalizeText(opts.description || 'Created with Mineradio'),
  }, { timeoutMs: 10000 });
  return {
    provider: 'spotify',
    loggedIn: true,
    playlist: mapSpotifyPlaylist(created, profile),
    body: created,
    success: true,
  };
}

async function handleSpotifySongUrl(track) {
  const id = normalizeText(track && (track.id || track.providerSongId || track.spotifyId));
  return {
    provider: 'spotify',
    id,
    url: '',
    playable: false,
    playbackMode: 'recommend-match',
    reason: 'provider_limited',
    restriction: {
      category: 'provider_limited',
      reason: 'spotify_metadata_only',
      message: 'Spotify 官方 Web API 不提供可交给 Mineradio 播放的音频直链，正在自动换源。',
      action: 'switch_source',
    },
  };
}

async function handleSpotifyLyric(id) {
  return {
    provider: 'spotify',
    id: normalizeText(id),
    lyric: '',
    tlyric: '',
    yrc: '',
    ytlrc: '',
    source: 'none',
    message: 'Spotify Web API 不提供歌词，Mineradio 会沿用跨平台歌词兜底。',
  };
}

module.exports = {
  getSpotifyProfile,
  buildSpotifyOAuthAuthorizeUrl,
  exchangeSpotifyOAuthCode,
  handleSpotifyStatus,
  handleSpotifySearch,
  handleSpotifyRecommendations,
  buildSpotifyLikedPlaylistCard,
  handleSpotifyUserPlaylists,
  handleSpotifyPlaylistTracks,
  handleSpotifyAlbumDetail,
  requireSpotifyScopes,
  handleSpotifyLibraryCheck,
  handleSpotifyLibrarySet,
  handleSpotifyPlaylistAddSong,
  handleSpotifyCreatePlaylist,
  handleSpotifySongUrl,
  handleSpotifyLyric,
};
