// ====================================================================
//  路由: QQ 音乐
//  - /api/qq/search, /api/qq/song/url, /api/qq/lyric
//  - /api/qq/login/status, /api/qq/login/cookie, /api/qq/logout
//  - /api/qq/user/playlists, /api/qq/playlist/tracks
//  - /api/qq/artist/detail, /api/qq/song/comments
// ====================================================================
module.exports = function register(ctx) {
  const {
    sendJSON, readRequestBody,
    handleQQSearch, handleQQSongUrl, handleQQLyric,
    getQQLoginInfo, normalizeQQCookieInput, parseCookieString,
    qqCookieUin, qqCookieMusicKey, saveQQCookie, refreshQQCookieSession,
    handleQQUserPlaylists, handleQQPlaylistTracks,
    handleQQArtistDetail, handleQQSongComments,
  } = ctx;

  return async function(req, res, url, pn) {
    if (pn === '/api/qq/search') {
      try {
        const kw = url.searchParams.get('keywords') || '';
        const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8));
        const songs = await handleQQSearch(kw, limit);
        sendJSON(res, { provider: 'qq', songs });
      } catch (err) {
        console.error('[QQSearch]', err);
        sendJSON(res, { provider: 'qq', error: err.message, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qq/song/url') {
      try {
        const mid = url.searchParams.get('mid') || url.searchParams.get('id') || '';
        const mediaMid = url.searchParams.get('mediaMid') || url.searchParams.get('media_mid') || '';
        const quality = url.searchParams.get('quality') || '';
        const info = await handleQQSongUrl(mid, mediaMid, quality);
        sendJSON(res, info);
      } catch (err) {
        console.error('[QQSongUrl]', err);
        sendJSON(res, { provider: 'qq', url: '', playable: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qq/lyric') {
      try {
        const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
        const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
        if (!mid && !id) { sendJSON(res, { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400); return; }
        const data = await handleQQLyric(mid, id);
        sendJSON(res, data);
      } catch (err) {
        console.error('[QQLyric]', err);
        sendJSON(res, { provider: 'qq', error: err.message, lyric: '' }, 500);
      }
      return;
    }

    // ---------- 歌曲URL ----------
    if (pn === '/api/qq/login/status') {
      try {
        const forceRenew = url.searchParams.get('renew') === '1' || url.searchParams.get('refresh') === '1';
        const info = await getQQLoginInfo({ autoRenew: true, forceRenew });
        sendJSON(res, info);
      } catch (err) {
        console.error('[QQLoginStatus]', err);
        sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qq/login/refresh') {
      try {
        const body = (req.method === 'POST') ? await readRequestBody(req) : {};
        const force = !!(body && (body.force || body.forceRenew)) || url.searchParams.get('force') === '1';
        const result = await refreshQQCookieSession({ force, reason: 'api-refresh' });
        const info = (result && result.info) || await getQQLoginInfo({ autoRenew: false });
        sendJSON(res, Object.assign({}, info, {
          refreshed: !!(result && result.refreshed),
          refreshOk: !!(result && result.ok),
          refreshVia: result && result.via,
          refreshReason: result && result.reason,
          reauthRequired: !!(result && result.reauthRequired) || !!(info && info.reauthRequired),
        }), (result && result.ok) ? 200 : 200);
      } catch (err) {
        console.error('[QQLoginRefresh]', err);
        sendJSON(res, { provider: 'qq', loggedIn: false, refreshOk: false, reauthRequired: true, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qq/login/cookie') {
      try {
        const body = await readRequestBody(req);
        const raw = body.cookie || body.data || body.text || '';
        const normalized = normalizeQQCookieInput(raw);
        const obj = parseCookieString(normalized);
        if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
          sendJSON(res, { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' }, 400);
          return;
        }
        saveQQCookie(normalized);
        const info = await getQQLoginInfo();
        sendJSON(res, { ...info, saved: true });
      } catch (err) {
        console.error('[QQLoginCookie]', err);
        sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qq/logout') {
      saveQQCookie('');
      sendJSON(res, { provider: 'qq', ok: true, loggedIn: false });
      return;
    }

    if (pn === '/api/qq/user/playlists') {
      try {
        const data = await handleQQUserPlaylists();
        sendJSON(res, data);
      } catch (err) {
        console.error('[QQUserPlaylists]', err);
        sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message, playlists: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qq/playlist/tracks') {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('disstid') || '';
        const data = await handleQQPlaylistTracks(id);
        sendJSON(res, data);
      } catch (err) {
        console.error('[QQPlaylistTracks]', err);
        sendJSON(res, { provider: 'qq', error: err.message, tracks: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qq/artist/detail') {
      try {
        const mid = url.searchParams.get('mid') || url.searchParams.get('singermid') || '';
        const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '36', 10) || 36));
        if (!mid) {
          sendJSON(res, { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }, 400);
          return;
        }
        const data = await handleQQArtistDetail(mid, limit);
        sendJSON(res, data);
      } catch (err) {
        console.error('[QQArtistDetail]', err);
        sendJSON(res, { provider: 'qq', error: err.message, artist: null, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qq/song/comments') {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
        const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
        const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        const data = await handleQQSongComments(id, mid, limit, offset);
        sendJSON(res, data);
      } catch (err) {
        console.error('[QQSongComments]', err);
        sendJSON(res, { provider: 'qq', error: err.message, comments: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qq/recommendations') {
      // QQ 音乐推荐接口尚未接入（面板显示友好空态，不使用关键词搜索替代）
      sendJSON(res, {
        provider: 'qq',
        songs: [],
        message: '当前版本没有可验证的 QQ 音乐推荐接口，未使用关键词搜索替代',
      });
      return;
    }
  };
};
