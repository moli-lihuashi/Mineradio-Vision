// ====================================================================
//  路由: 酷狗音乐
//  - /api/kugou/search
//  - /api/kugou/login/status, /api/kugou/login/qr/key, /api/kugou/login/qr/check
//  - /api/kugou/login/cookie, /api/kugou/logout
//  - /api/kugou/user/playlists, /api/kugou/playlist/tracks
//  - /api/kugou/song/url, /api/kugou/lyric
//  - /api/kugou/song/like(/check), /api/kugou/playlist/add-song
//  - 批次3 增补（实现见 server/kugou/extras.js）：
//    /api/kugou/album/detail, /api/kugou/album/songs, /api/kugou/artist/detail,
//    /api/kugou/artist/albums, /api/kugou/search/collections, /api/kugou/recommend/cards,
//    /api/kugou/recommend/history, /api/kugou/fm/dislike, /api/kugou/playlist/remove-song
// ====================================================================
const createKugouExtras = require('../kugou/extras');

module.exports = function register(ctx) {
  const extras = createKugouExtras(ctx);

  // 批次3 公共包装：统一错误形态，空结果带 message，不静默返回空数组。
  async function runExtra(res, label, fn) {
    try {
      sendJSON(res, await fn());
    } catch (err) {
      console.error('[' + label + ']', err);
      const reason = String(err && (err.message || (err.body && err.body.message)) || err || 'KUGOU_UPSTREAM_ERROR');
      sendJSON(res, { provider: 'kugou', error: reason, message: reason }, 500);
    }
  }

  async function runWriteExtra(req, res, label, fn) {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const data = await fn(body || {});
      // 登录守卫由 extras 内部按酷狗播放态判定，回 200 + 明确 error，不冒充 5xx。
      sendJSON(res, data);
    } catch (err) {
      console.error('[' + label + ']', err);
      const reason = String(err && (err.message || (err.body && err.body.message)) || err || 'KUGOU_UPSTREAM_ERROR');
      sendJSON(res, { provider: 'kugou', success: false, error: reason, message: reason }, 500);
    }
  }

  const {
    sendJSON, readRequestBody,
    getKugouLoginInfoFresh, getKugouLoginInfo,
    handleKugouLoginQrKey, handleKugouLoginQrCheck,
    normalizeKugouCookieInput, saveKugouCookie,
    handleKugouSearch,
    handleKugouUserPlaylists, handleKugouPlaylistTracks,
    handleKugouSongUrl, handleKugouLyric, handleKugouGuessLike,
    handleKugouLikeCheck, handleKugouLikeToggle, handleKugouPlaylistAddSong,
  } = ctx;

  return async function(req, res, url, pn) {
    if (pn === '/api/kugou/search') {
      try {
        const kw = url.searchParams.get('keywords') || url.searchParams.get('q') || '';
        const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        const songs = await handleKugouSearch(kw, limit, ctx.kugouCookie, offset);
        sendJSON(res, { provider: 'kugou', songs: Array.isArray(songs) ? songs : [] });
      } catch (err) {
        console.error('[KugouSearch]', err);
        sendJSON(res, { provider: 'kugou', error: err.message, songs: [] }, 500);
      }
      return;
    }

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
        // 歌单内容变了：作废服务端歌单缓存，下一次打开拿到的是新列表
        if (typeof ctx.clearKugouPlaylistCache === 'function') ctx.clearKugouPlaylistCache();
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

    // ==================================================================
    //  批次3：酷狗专辑 / 歌手 / 分类搜索 / 推荐卡片 / 历史日推 / 反馈 / 歌单移除
    //  公开移动端接口（A 类）匿名可验证；网关通道（B 类）需登录，由 extras 判定。
    // ==================================================================

    if (pn === '/api/kugou/album/detail') {
      await runExtra(res, 'KugouAlbumDetail', () => extras.albumDetail(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/album/songs') {
      await runExtra(res, 'KugouAlbumSongs', () => extras.albumSongs(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/artist/detail') {
      await runExtra(res, 'KugouArtistDetail', () => extras.artistDetail(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/artist/albums') {
      await runExtra(res, 'KugouArtistAlbums', () => extras.artistAlbums(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/search/collections') {
      await runExtra(res, 'KugouSearchCollections', () => extras.searchCollections(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/recommend/cards') {
      await runExtra(res, 'KugouRecommendCards', () => extras.recommendCards(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/recommend/history') {
      await runExtra(res, 'KugouRecommendHistory', () => extras.recommendHistory(url.searchParams));
      return;
    }

    if (pn === '/api/kugou/fm/dislike') {
      await runWriteExtra(req, res, 'KugouFmDislike', (body) => extras.fmDislike(body));
      return;
    }

    if (pn === '/api/kugou/playlist/remove-song') {
      await runWriteExtra(req, res, 'KugouPlaylistRemoveSong', (body) => extras.playlistRemoveSong(body));
      return;
    }
  };
};
