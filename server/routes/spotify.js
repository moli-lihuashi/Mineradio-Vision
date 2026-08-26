// ====================================================================
//  路由: Spotify
//  - /api/spotify/status, /api/spotify/config, /api/spotify/logout
//  - /api/spotify/user/playlists
//  - /api/spotify/song/like(/check), /api/spotify/album/like(/check)
//  - /api/spotify/playlist/add-song, /api/spotify/playlist/create, /api/spotify/playlist/collect, /api/spotify/playlist/tracks
//  - /api/spotify/album/detail, /api/spotify/search, /api/spotify/recommendations
//  - /api/spotify/song/url, /api/spotify/lyric
// ====================================================================
module.exports = function register(ctx) {
  const {
    sendJSON, readRequestBody,
    handleSpotifyStatus, saveSpotifyConfig, clearSpotifyToken, getSpotifyConfig,
    handleSpotifyUserPlaylists, handleSpotifyLibraryCheck, handleSpotifyLibrarySet,
    handleSpotifyPlaylistAddSong, handleSpotifyCreatePlaylist,
    handleSpotifyPlaylistTracks, handleSpotifyAlbumDetail,
    handleSpotifySearch, handleSpotifyRecommendations,
    handleSpotifySongUrl, handleSpotifyLyric,
  } = ctx;

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
  };
};
