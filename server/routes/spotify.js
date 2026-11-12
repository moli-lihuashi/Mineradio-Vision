// ====================================================================
//  路由: Spotify
//  - /api/spotify/status, /api/spotify/config, /api/spotify/logout
//  - /api/spotify/user/playlists
//  - /api/spotify/song/like(/check), /api/spotify/album/like(/check)
//  - /api/spotify/playlist/add-song, /api/spotify/playlist/create, /api/spotify/playlist/collect, /api/spotify/playlist/tracks
//  - /api/spotify/album/detail, /api/spotify/search, /api/spotify/recommendations
//  - /api/spotify/song/url, /api/spotify/lyric
//  - 批次4 增补（实现见 server/spotify/extras.js）：
//    /api/spotify/user/albums, /api/spotify/artist/albums, /api/spotify/artist/detail,
//    /api/spotify/playlist/remove-song
//  - 批次5 增补：/api/spotify/explore/categories, /api/spotify/explore/playlists,
//    /api/spotify/recommend/made-for-you, /api/spotify/recommend/daily-mix
// ====================================================================
const createSpotifyExtras = require('../spotify/extras');

module.exports = function register(ctx) {
  const extras = createSpotifyExtras(ctx);
  const {
    sendJSON, readRequestBody,
    handleSpotifyStatus, saveSpotifyConfig, clearSpotifyToken, getSpotifyConfig,
    handleSpotifyUserPlaylists, handleSpotifyLibraryCheck, handleSpotifyLibrarySet,
    handleSpotifyPlaylistAddSong, handleSpotifyCreatePlaylist,
    handleSpotifyPlaylistTracks, handleSpotifyAlbumDetail,
    handleSpotifySearch, handleSpotifyRecommendations,
    handleSpotifySongUrl, handleSpotifyLyric,
  } = ctx;

  // 批次4 公共包装：统一错误形态，scope 不足时前端可直接看到缺哪个权限。
  const SPOTIFY_EXTRA_ERROR_TEXT = {
    SPOTIFY_REFRESH_TOKEN_MISSING: '尚未连接 Spotify 账号或登录态已过期，请在「连接 Spotify」重新授权。',
    SPOTIFY_WRITE_SCOPE_REQUIRED: 'Spotify 授权范围不足，请重新连接并授予所需权限。',
  };
  async function runSpotifyExtra(res, label, fn) {
    try {
      sendJSON(res, await fn());
    } catch (err) {
      console.error('[' + label + ']', err);
      const code = err.code || err.message;
      sendJSON(res, {
        provider: 'spotify', error: code,
        message: SPOTIFY_EXTRA_ERROR_TEXT[code] || err.message,
        missingScopes: err.missingScopes || [],
      }, Number(err.statusCode) || 500);
    }
  }

  return async function(req, res, url, pn) {
    // ========== Spotify API ==========

    if (pn === '/api/spotify/status') {
      try {
        sendJSON(res, await handleSpotifyStatus());
      } catch (err) {
        console.error('[SpotifyStatus]', err);
        sendJSON(res, { provider: 'spotify', configured: false, loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/config') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'spotify', ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const saved = saveSpotifyConfig(body);
        const status = await handleSpotifyStatus();
        sendJSON(res, Object.assign({}, status, saved, {
          ok: true,
          configured: true,
          oauthConfigured: true,
          message: status.loggedIn
            ? status.message
            : 'Spotify Client ID 已保存，可打开官方 OAuth 授权。'
        }));
      } catch (err) {
        console.error('[SpotifyConfig]', err);
        const missing = err && err.missing || [];
        sendJSON(res, {
          provider: 'spotify',
          ok: false,
          configured: getSpotifyConfig().configured,
          loggedIn: false,
          error: err.code || err.message,
          message: err.code === 'SPOTIFY_CLIENT_ID_REQUIRED' || err.message === 'SPOTIFY_CLIENT_ID_REQUIRED'
            ? '请先粘贴 Spotify Client ID。'
            : err.message,
          missing,
        }, err && err.code === 'SPOTIFY_CLIENT_ID_REQUIRED' ? 400 : 500);
      }
      return;
    }

    if (pn === '/api/spotify/logout') {
      try {
        sendJSON(res, clearSpotifyToken());
      } catch (err) {
        console.error('[SpotifyLogout]', err);
        sendJSON(res, { provider: 'spotify', ok: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/user/playlists') {
      try {
        const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '300', 10) || 300));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        sendJSON(res, await handleSpotifyUserPlaylists({ limit, offset }));
      } catch (err) {
        console.error('[SpotifyUserPlaylists]', err);
        sendJSON(res, { provider: 'spotify', loggedIn: false, error: err.message, playlists: [] }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/song/like/check') {
      try {
        const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
          .split(',').map(value => value.trim()).filter(Boolean);
        sendJSON(res, await handleSpotifyLibraryCheck('track', ids));
      } catch (err) {
        console.error('[SpotifyLikeCheck]', err);
        sendJSON(res, { provider: 'spotify', liked: {}, error: err.code || err.message, message: err.message }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/song/like') {
      try {
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const song = body.song || {
          id: body.id || url.searchParams.get('id') || '',
          spotifyId: body.spotifyId || url.searchParams.get('spotifyId') || '',
          spotifyUri: body.spotifyUri || body.uri || url.searchParams.get('uri') || '',
        };
        const liked = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
        sendJSON(res, await handleSpotifyLibrarySet('track', song, liked));
      } catch (err) {
        console.error('[SpotifyLike]', err);
        sendJSON(res, {
          provider: 'spotify',
          success: false,
          error: err.code || err.message,
          message: err.code === 'SPOTIFY_WRITE_SCOPE_REQUIRED'
            ? '请在账号面板重新连接 Spotify，授予资料库写入权限。'
            : err.message,
          missingScopes: err.missingScopes || [],
        }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/album/like/check') {
      try {
        const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
          .split(',').map(value => value.trim()).filter(Boolean);
        sendJSON(res, await handleSpotifyLibraryCheck('album', ids));
      } catch (err) {
        console.error('[SpotifyAlbumLikeCheck]', err);
        sendJSON(res, { provider: 'spotify', liked: {}, error: err.code || err.message, message: err.message }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/album/like') {
      try {
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const album = body.album || {
          id: body.id || body.albumId || url.searchParams.get('id') || '',
          albumId: body.albumId || '',
          spotifyUri: body.spotifyUri || body.uri || '',
        };
        const liked = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
        sendJSON(res, await handleSpotifyLibrarySet('album', album, liked));
      } catch (err) {
        console.error('[SpotifyAlbumLike]', err);
        sendJSON(res, { provider: 'spotify', success: false, error: err.code || err.message, message: err.message, missingScopes: err.missingScopes || [] }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/playlist/add-song') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'spotify', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        sendJSON(res, await handleSpotifyPlaylistAddSong(body.pid || body.playlistId || '', body.song || body));
      } catch (err) {
        console.error('[SpotifyPlaylistAddSong]', err);
        sendJSON(res, {
          provider: 'spotify',
          success: false,
          error: err.code || err.message,
          message: err.code === 'SPOTIFY_WRITE_SCOPE_REQUIRED'
            ? '请重新连接 Spotify，授予歌单写入权限。'
            : err.message,
          missingScopes: err.missingScopes || [],
        }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/playlist/create') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'spotify', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        sendJSON(res, await handleSpotifyCreatePlaylist(body.name || '', {
          public: body.public === true,
          description: body.description || '',
        }));
      } catch (err) {
        console.error('[SpotifyPlaylistCreate]', err);
        sendJSON(res, { provider: 'spotify', success: false, error: err.code || err.message, message: err.message, missingScopes: err.missingScopes || [] }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/playlist/collect') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'spotify', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const collected = String(body.collected != null ? body.collected : 'true') !== 'false';
        const result = await handleSpotifyLibrarySet('playlist', {
          id: body.id || body.playlistId || '',
          spotifyUri: body.spotifyUri || body.uri || '',
        }, collected);
        sendJSON(res, Object.assign({ collected, success: true }, result));
      } catch (err) {
        console.error('[SpotifyPlaylistCollect]', err);
        sendJSON(res, { provider: 'spotify', success: false, error: err.code || err.message, message: err.message, missingScopes: err.missingScopes || [] }, Number(err.statusCode) || 500);
      }
      return;
    }

    if (pn === '/api/spotify/playlist/tracks') {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('playlistId') || '';
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '48', 10) || 48));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        sendJSON(res, await handleSpotifyPlaylistTracks(id, { limit, offset, market: url.searchParams.get('market') || '' }));
      } catch (err) {
        console.error('[SpotifyPlaylistTracks]', err);
        sendJSON(res, { provider: 'spotify', error: err.message, tracks: [] }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/album/detail') {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('albumId') || '';
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '80', 10) || 80));
        sendJSON(res, await handleSpotifyAlbumDetail(id, { limit, market: url.searchParams.get('market') || '' }));
      } catch (err) {
        console.error('[SpotifyAlbumDetail]', err);
        sendJSON(res, { provider: 'spotify', error: err.message, album: null, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/search') {
      try {
        const kw = url.searchParams.get('keywords') || '';
        const limit = Math.max(4, Math.min(20, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        sendJSON(res, await handleSpotifySearch(kw, limit, offset));
      } catch (err) {
        console.error('[SpotifySearch]', err);
        sendJSON(res, { provider: 'spotify', configured: getSpotifyConfig().configured, error: err.message, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/recommendations') {
      try {
        const limit = Math.max(4, Math.min(10, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
        sendJSON(res, await handleSpotifyRecommendations(limit));
      } catch (err) {
        console.error('[SpotifyRecommendations]', err);
        sendJSON(res, { provider: 'spotify', error: err.message, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/song/url') {
      try {
        sendJSON(res, await handleSpotifySongUrl({
          id: url.searchParams.get('id') || '',
          providerSongId: url.searchParams.get('providerSongId') || '',
          spotifyId: url.searchParams.get('spotifyId') || '',
          uri: url.searchParams.get('uri') || '',
        }));
      } catch (err) {
        console.error('[SpotifySongUrl]', err);
        sendJSON(res, { provider: 'spotify', url: '', playable: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/spotify/lyric') {
      try {
        const id = url.searchParams.get('id') || '';
        sendJSON(res, await handleSpotifyLyric(id));
      } catch (err) {
        console.error('[SpotifyLyric]', err);
        sendJSON(res, { provider: 'spotify', error: err.message, lyric: '', tlyric: '', yrc: '', ytlrc: '' }, 500);
      }
      return;
    }

    // ==================================================================
    //  批次4：Spotify 收藏专辑库 / 歌手页 / 歌手专辑 / 歌单移除
    //  契约是 Spotify Web API 官方端点，权限不足由 extras 返回明确 scope 说明。
    // ==================================================================

    if (pn === '/api/spotify/user/albums') {
      await runSpotifyExtra(res, 'SpotifyUserAlbums', () => extras.userAlbums(url.searchParams));
      return;
    }

    if (pn === '/api/spotify/artist/albums') {
      await runSpotifyExtra(res, 'SpotifyArtistAlbums', () => extras.artistAlbums(url.searchParams));
      return;
    }

    if (pn === '/api/spotify/artist/detail') {
      await runSpotifyExtra(res, 'SpotifyArtistDetail', () => extras.artistDetail(url.searchParams));
      return;
    }

    if (pn === '/api/spotify/playlist/remove-song') {
      await runSpotifyExtra(res, 'SpotifyPlaylistRemoveSong', async () => {
        if (req.method !== 'POST') {
          return { provider: 'spotify', success: false, error: 'METHOD_NOT_ALLOWED', message: '需要 POST' };
        }
        return extras.playlistRemoveSong(await readRequestBody(req));
      });
      return;
    }

    // 批次5：官方 Web API 的探索页与账号个性化推荐（私人电台不在此列，见 extras.js 头注释）。
    if (pn === '/api/spotify/explore/categories') {
      await runSpotifyExtra(res, 'SpotifyExploreCategories', () => extras.exploreCategories(url.searchParams));
      return;
    }

    if (pn === '/api/spotify/explore/playlists') {
      await runSpotifyExtra(res, 'SpotifyCategoryPlaylists', () => extras.categoryPlaylists(url.searchParams));
      return;
    }

    if (pn === '/api/spotify/recommend/made-for-you') {
      await runSpotifyExtra(res, 'SpotifyMadeForYou', () => extras.madeForYou(url.searchParams));
      return;
    }

    if (pn === '/api/spotify/recommend/daily-mix') {
      await runSpotifyExtra(res, 'SpotifyDailyMixTracks', () => extras.dailyMixTracks(url.searchParams));
      return;
    }
  };
};
