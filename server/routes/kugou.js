// ====================================================================
//  路由: 酷狗音乐
//  - /api/kugou/login/status, /api/kugou/login/qr/key, /api/kugou/login/qr/check
//  - /api/kugou/login/cookie, /api/kugou/logout
//  - /api/kugou/user/playlists, /api/kugou/playlist/tracks
//  - /api/kugou/song/url, /api/kugou/lyric
//  - /api/kugou/song/like(/check), /api/kugou/playlist/add-song
// ====================================================================
module.exports = function register(ctx) {
  const {
    sendJSON, readRequestBody,
    getKugouLoginInfoFresh, getKugouLoginInfo,
    handleKugouLoginQrKey, handleKugouLoginQrCheck,
    normalizeKugouCookieInput, saveKugouCookie,
    handleKugouUserPlaylists, handleKugouPlaylistTracks,
    handleKugouSongUrl, handleKugouLyric, handleKugouGuessLike,
    handleKugouLikeCheck, handleKugouLikeToggle, handleKugouPlaylistAddSong,
  } = ctx;

  return async function(req, res, url, pn) {
    if (pn === '/api/kugou/login/status') {
      try {
        sendJSON(res, await getKugouLoginInfoFresh());
      } catch (err) {
        console.error('[KugouLoginStatus]', err);
        sendJSON(res, getKugouLoginInfo());
      }
      return;
    }

    if (pn === '/api/kugou/login/qr/key') {
      try {
        const data = await handleKugouLoginQrKey();
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouLoginQrKey]', err);
        sendJSON(res, { provider: 'kugou', error: err.message, loggedIn: false }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/login/qr/check') {
      try {
        const key = url.searchParams.get('key') || url.searchParams.get('qrcode') || '';
        const data = await handleKugouLoginQrCheck(key);
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouLoginQrCheck]', err);
        sendJSON(res, { provider: 'kugou', error: err.message, loggedIn: false, code: 500 }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/login/cookie') {
      try {
        const body = await readRequestBody(req);
        const raw = body.cookie || body.data || body.text || '';
        const normalized = normalizeKugouCookieInput(raw);
        if (!normalized) {
          sendJSON(res, { provider: 'kugou', loggedIn: false, error: 'INVALID_KUGOU_COOKIE', message: '酷狗 cookie 为空' }, 400);
          return;
        }
        saveKugouCookie(normalized);
        const info = await getKugouLoginInfoFresh();
        if (!info.loggedIn) {
          saveKugouCookie('');
          sendJSON(res, {
            provider: 'kugou',
            loggedIn: false,
            error: 'KUGOU_LOGIN_REQUIRED',
            message: '酷狗登录未完成，请扫码或输入账号后再同步',
          }, 400);
          return;
        }
        sendJSON(res, { ...info, saved: true });
      } catch (err) {
        console.error('[KugouLoginCookie]', err);
        sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/logout') {
      saveKugouCookie('');
      sendJSON(res, { provider: 'kugou', ok: true, loggedIn: false });
      return;
    }

    if (pn === '/api/kugou/user/playlists') {
      try {
        const data = await handleKugouUserPlaylists();
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouUserPlaylists]', err);
        sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message, playlists: [] }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/playlist/tracks') {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('listid') || '';
        const data = await handleKugouPlaylistTracks(id);
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouPlaylistTracks]', err);
        sendJSON(res, { provider: 'kugou', error: err.message, tracks: [] }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/song/like/check') {
      try {
        const hashes = url.searchParams.get('hashes') || url.searchParams.get('hash') || url.searchParams.get('ids') || '';
        const data = await handleKugouLikeCheck({ hashes }, ctx.kugouCookie);
        const status = data && data.error === 'KUGOU_AUTH_REQUIRED' ? 401 : 200;
        sendJSON(res, data, status);
      } catch (err) {
        console.error('[KugouLikeCheck]', err);
        sendJSON(res, { provider: 'kugou', liked: {}, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/song/like') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'kugou', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const song = body.song || { hash: body.id || body.hash };
        const like = String(body.like != null ? body.like : 'true') !== 'false';
        const data = await handleKugouLikeToggle(song, like, ctx.kugouCookie);
        if (data && data.success === false) {
          const authFail = /KUGOU_AUTH_REQUIRED/i.test(String(data.error || ''));
          sendJSON(res, data, authFail ? 401 : 400);
          return;
        }
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouLike]', err);
        sendJSON(res, { provider: 'kugou', success: false, error: err.message }, /KUGOU_AUTH_REQUIRED|login/i.test(String(err.message)) ? 401 : 500);
      }
      return;
    }

    if (pn === '/api/kugou/playlist/add-song') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'kugou', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const pid = body.pid || body.playlistId || body.listid || '';
        const song = body.song || { hash: body.id || body.hash };
        const data = await handleKugouPlaylistAddSong(pid, song, ctx.kugouCookie);
        if (data && data.success === false) {
          const authFail = /KUGOU_AUTH_REQUIRED/i.test(String(data.error || ''));
          sendJSON(res, data, authFail ? 401 : 400);
          return;
        }
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouPlaylistAddSong]', err);
        sendJSON(res, { provider: 'kugou', success: false, error: err.message }, /KUGOU_AUTH_REQUIRED|login/i.test(String(err.message)) ? 401 : 500);
      }
      return;
    }

    if (pn === '/api/kugou/song/url') {
      try {
        const hash = url.searchParams.get('hash') || url.searchParams.get('id') || '';
        const albumAudioId = url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id') || '';
        const albumId = url.searchParams.get('albumId') || url.searchParams.get('album_id') || '';
        const quality = url.searchParams.get('quality') || '';
        let qualityHashes = null;
        try {
          const rawQualityHashes = url.searchParams.get('qualityHashes') || '';
          qualityHashes = rawQualityHashes ? JSON.parse(rawQualityHashes) : null;
        } catch (_) {
          qualityHashes = null;
        }
        const data = await handleKugouSongUrl(hash, albumAudioId, albumId, quality, qualityHashes);
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouSongUrl]', err);
        sendJSON(res, { provider: 'kugou', url: '', playable: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/lyric') {
      try {
        const hash = url.searchParams.get('hash') || url.searchParams.get('id') || '';
        const albumAudioId = url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id') || '';
        const duration = url.searchParams.get('duration') || url.searchParams.get('timelength') || '';
        const data = await handleKugouLyric(hash, albumAudioId, duration);
        sendJSON(res, data);
      } catch (err) {
        console.error('[KugouLyric]', err);
        sendJSON(res, { provider: 'kugou', error: err.message, lyric: '' }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/recommend') {
      // 9.18: 猜你喜欢 — 真推荐 (私人FM > 每日推荐 > 歌单聚合保底)
      try {
        const limit = parseInt(url.searchParams.get('limit') || '12', 10) || 12;
        const result = await handleKugouGuessLike(ctx.kugouCookie, limit);
        sendJSON(res, result);
      } catch (err) {
        console.error('[KugouRecommend]', err);
        sendJSON(res, { provider: 'kugou', loggedIn: false, songs: [], error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/kugou/recommendations') {
      // 平台推荐面板的酷狗源：与猜你喜欢同一推荐链路
      try {
        const limit = parseInt(url.searchParams.get('limit') || '12', 10) || 12;
        const result = await handleKugouGuessLike(ctx.kugouCookie, limit);
        sendJSON(res, result);
      } catch (err) {
        console.error('[KugouRecommendations]', err);
        sendJSON(res, { provider: 'kugou', loggedIn: false, songs: [], error: err.message }, 500);
      }
      return;
    }
  };
};
