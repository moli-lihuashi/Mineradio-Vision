// ====================================================================
//  路由: 汽水音乐 (Qishui)
//  - /api/qishui/status(/login/status), /api/qishui/login/token, /api/qishui/login/cookie
//  - /api/qishui/logout, /api/qishui/search, /api/qishui/feed
//  - /api/qishui/user/playlists, /api/qishui/playlist/tracks
//  - /api/qishui/song/like(/check), /api/qishui/playlist/collect, /api/qishui/playlist/add-song
//  - /api/qishui/album/collect, /api/qishui/song/url, /api/qishui/lyric
// ====================================================================
module.exports = function register(ctx) {
  const {
    sendJSON, readRequestBody,
    handleQishuiStatus, saveQishuiAccessToken, getQishuiStatus, clearQishuiAccessToken,
    normalizeQishuiCookieInput, qishuiCookieHasLogin, saveQishuiCookie,
    handleQishuiSearch, handleQishuiFeed, handleQishuiUserPlaylists,
    handleQishuiPlaylistTracks, handleQishuiCheckTracksLiked, handleQishuiSetTrackLiked,
    handleQishuiSetPlaylistCollected, handleQishuiPlaylistAddSong, handleQishuiSetAlbumCollected,
    handleQishuiSongUrl, handleQishuiLyric,
  } = ctx;

  // 汽水音乐 v6 二维码登录桥接（仅主进程运行时懒加载，避免非 electron 上下文 require 失败）
  // 注意：本路由文件位于 server/routes/，桥接文件位于项目根目录，需向上两级定位。
  let _qishuiQrLogin = null;
  function getQishuiQrLogin() {
    if (!_qishuiQrLogin) {
      try { _qishuiQrLogin = require('../../qishui-qr-login'); }
      catch (e) { console.error('[QishuiQR] failed to load bridge:', e && e.message); throw e; }
    }
    return _qishuiQrLogin;
  }

  return async function(req, res, url, pn) {
    // ========== Qishui (汽水音乐) API ==========

    if (pn === '/api/qishui/login/qrcode') {
      try {
        const qrLogin = getQishuiQrLogin();
        const result = await qrLogin.createQrCode();
        const data = result && result.data || {};
        sendJSON(res, {
          provider: 'qishui',
          token: String(data.token || ''),
          qrcode: String(data.qrcode || ''),
          qrcodeIndexUrl: String(data.qrcode_index_url || ''),
          expireTime: Number(data.expire_time || 0),
          message: '请使用抖音 / 汽水音乐 App 扫码并确认登录',
        });
      } catch (err) {
        console.error('[QishuiQRCode]', err);
        sendJSON(res, {
          provider: 'qishui',
          token: '',
          qrcode: '',
          error: err && err.code || 'QISHUI_QR_CREATE_FAILED',
          message: err && err.message || '汽水音乐二维码生成失败',
        }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/login/check') {
      try {
        const token = String(url.searchParams.get('token') || '').trim();
        if (!token) {
          sendJSON(res, {
            provider: 'qishui',
            loggedIn: false,
            status: 'missing_token',
            error: 'QISHUI_QR_TOKEN_REQUIRED',
            message: '二维码登录 token 缺失',
          }, 400);
          return;
        }
        const qrLogin = getQishuiQrLogin();
        const result = await qrLogin.checkQrConnect(token);
        const data = result && result.data || {};
        const errorCode = Number(data.error_code || 0);
        const bridgeStatus = qrLogin.getStatus();
        if (data.confirmed === true && errorCode === 0 && bridgeStatus.loggedIn) {
          const cookie = qrLogin.getCookie();
          if (!qishuiCookieHasLogin(cookie)) throw new Error('QISHUI_QR_SESSION_COOKIE_MISSING');
          const status = await handleQishuiStatus(cookie);
          if (status.reauthRequired) {
            sendJSON(res, { ...status, ok: false, status: 'reauth_required' });
            return;
          }
          if (status.loggedIn !== true) {
            sendJSON(res, { ...status, ok: false, status: 'verifying' });
            return;
          }
          saveQishuiCookie(cookie);
          sendJSON(res, {
            ...status,
            provider: 'qishui',
            ok: true,
            loggedIn: true,
            webSession: true,
            cookieReady: true,
            status: 'confirmed',
            errorCode: 0,
            error_code: 0,
            message: '登录成功',
          });
          return;
        }
        let status = String(data.status || '').trim();
        if (errorCode === 2) status = 'expired';
        else if (errorCode === 7) status = 'rate_limited';
        else if (status === '2') status = 'scanned';
        else if (!status || status === '1') status = 'waiting';
        sendJSON(res, {
          provider: 'qishui',
          loggedIn: false,
          status,
          errorCode,
          error_code: errorCode,
          retryAfterMs: errorCode === 7 ? 60000 : 0,
          message: result && result.message || data.description || '',
        });
      } catch (err) {
        console.error('[QishuiLoginCheck]', err);
        const code = err && err.code;
        const cancelled = code === 'QISHUI_MFA_CANCELLED';
        const mfaFailed = code === 'QISHUI_MFA_FAILED';
        sendJSON(res, {
          provider: 'qishui',
          loggedIn: false,
          status: cancelled ? 'mfa_cancelled' : (mfaFailed ? 'mfa_failed' : 'error'),
          error: code || 'QISHUI_QR_CHECK_FAILED',
          message: err && err.message || '汽水音乐登录状态检查失败',
        }, (cancelled || mfaFailed) ? 409 : 500);
      }
      return;
    }


    if (pn === '/api/qishui/status' || pn === '/api/qishui/login/status') {
      try {
        sendJSON(res, await handleQishuiStatus(ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiStatus]', err);
        sendJSON(res, { provider: 'qishui', configured: false, loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/login/token') {
      try {
        const body = await readRequestBody(req);
        const token = body.token || body.accessToken || body.access_token || body.data || body.text || '';
        sendJSON(res, saveQishuiAccessToken(token));
      } catch (err) {
        console.error('[QishuiLoginToken]', err);
        const invalid = err && (err.code === 'INVALID_QISHUI_TOKEN' || err.message === 'INVALID_QISHUI_TOKEN');
        sendJSON(res, {
          provider: 'qishui',
          configured: getQishuiStatus(ctx.qishuiCookie).configured,
          loggedIn: getQishuiStatus(ctx.qishuiCookie).loggedIn,
          error: invalid ? 'INVALID_QISHUI_TOKEN' : err.message,
          message: invalid ? '汽水 OpenAPI token 无效或太短' : err.message,
        }, invalid ? 400 : 500);
      }
      return;
    }

    if (pn === '/api/qishui/login/cookie') {
      try {
        const body = await readRequestBody(req);
        const raw = body.cookie || body.data || body.text || '';
        const normalized = normalizeQishuiCookieInput(raw);
        if (!qishuiCookieHasLogin(normalized)) {
          sendJSON(res, { provider: 'qishui', loggedIn: false, error: 'INVALID_QISHUI_COOKIE', message: '汽水 cookie 无效或缺少登录态' }, 400);
          return;
        }
        saveQishuiCookie(normalized);
        sendJSON(res, { ...await handleQishuiStatus(ctx.qishuiCookie), saved: true });
      } catch (err) {
        console.error('[QishuiLoginCookie]', err);
        sendJSON(res, { provider: 'qishui', loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/logout') {
      try {
        try {
          const qrLogin = getQishuiQrLogin();
          await qrLogin.clear();
        } catch (_) { /* 桥接未初始化时忽略 */ }
        saveQishuiCookie('');
        sendJSON(res, {
          ...clearQishuiAccessToken(),
          webSession: false,
          cookieReady: false,
          configured: getQishuiStatus('').configured,
          loggedIn: getQishuiStatus('').loggedIn,
        });
      } catch (err) {
        console.error('[QishuiLogout]', err);
        sendJSON(res, { provider: 'qishui', ok: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/search') {
      try {
        const kw = url.searchParams.get('keywords') || '';
        const limit = Math.max(4, Math.min(20, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        sendJSON(res, await handleQishuiSearch(kw, limit, ctx.qishuiCookie, offset));
      } catch (err) {
        console.error('[QishuiSearch]', err);
        sendJSON(res, { provider: 'qishui', configured: getQishuiStatus(ctx.qishuiCookie).configured, error: err.message, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/feed') {
      try {
        const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8));
        sendJSON(res, await handleQishuiFeed(limit, ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiFeed]', err);
        sendJSON(res, { provider: 'qishui', configured: getQishuiStatus(ctx.qishuiCookie).configured, error: err.message, songs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/user/playlists') {
      try {
        sendJSON(res, await handleQishuiUserPlaylists(ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiUserPlaylists]', err);
        sendJSON(res, {
          provider: 'qishui',
          loggedIn: getQishuiStatus(ctx.qishuiCookie).configured,
          configured: getQishuiStatus(ctx.qishuiCookie).configured,
          error: err.message,
          playlists: [],
        }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/playlist/tracks') {
      try {
        const id = url.searchParams.get('id') || 'qishui-feed';
        const limit = Math.max(0, parseInt(url.searchParams.get('limit') || '0', 10) || 0);
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        sendJSON(res, await handleQishuiPlaylistTracks(id, limit || offset ? { limit: limit || 50, offset } : {}, ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiPlaylistTracks]', err);
        sendJSON(res, { provider: 'qishui', configured: getQishuiStatus(ctx.qishuiCookie).configured, error: err.message, tracks: [] }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/song/like/check') {
      try {
        const ids = url.searchParams.get('ids') || url.searchParams.get('id') || '';
        sendJSON(res, await handleQishuiCheckTracksLiked(ids, ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiLikeCheck]', err);
        sendJSON(res, { provider: 'qishui', liked: {}, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/song/like') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'qishui', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const song = body.song || body;
        const id = song.providerSongId || song.trackId || song.id || '';
        const liked = String(body.like != null ? body.like : 'true') !== 'false';
        const result = await handleQishuiSetTrackLiked(id, liked, ctx.qishuiCookie);
        sendJSON(res, Object.assign({ success: true }, result));
      } catch (err) {
        console.error('[QishuiLike]', err);
        sendJSON(res, { provider: 'qishui', success: false, error: err.message }, /COOKIE_REQUIRED|login/i.test(String(err.message)) ? 401 : 500);
      }
      return;
    }

    if (pn === '/api/qishui/playlist/collect') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'qishui', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const collected = String(body.collected != null ? body.collected : 'true') !== 'false';
        const result = await handleQishuiSetPlaylistCollected(body.id || body.playlistId || '', collected, ctx.qishuiCookie);
        sendJSON(res, Object.assign({ success: true }, result));
      } catch (err) {
        console.error('[QishuiPlaylistCollect]', err);
        sendJSON(res, { provider: 'qishui', success: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/playlist/add-song') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'qishui', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        sendJSON(res, await handleQishuiPlaylistAddSong(body.pid || body.playlistId || '', body.song || body, ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiPlaylistAddSong]', err);
        sendJSON(res, { provider: 'qishui', success: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/album/collect') {
      try {
        if (req.method !== 'POST') {
          sendJSON(res, { provider: 'qishui', success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
          return;
        }
        const body = await readRequestBody(req);
        const collected = String(body.collected != null ? body.collected : 'true') !== 'false';
        const result = await handleQishuiSetAlbumCollected(body.id || body.albumId || '', collected, ctx.qishuiCookie);
        sendJSON(res, Object.assign({ success: true }, result));
      } catch (err) {
        console.error('[QishuiAlbumCollect]', err);
        sendJSON(res, { provider: 'qishui', success: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/song/url') {
      try {
        sendJSON(res, await handleQishuiSongUrl({
          id: url.searchParams.get('id') || url.searchParams.get('trackId') || '',
          quality: url.searchParams.get('quality') || '',
          vipRequired: url.searchParams.get('vipRequired') || '',
          needVip: url.searchParams.get('needVip') || url.searchParams.get('need_vip') || '',
          onlyVipPlayable: url.searchParams.get('onlyVipPlayable') || url.searchParams.get('only_vip_playable') || '',
          privilege: url.searchParams.get('privilege') || url.searchParams.get('mediaPrivilege') || url.searchParams.get('media_privilege') || '',
          fee: url.searchParams.get('fee') || '',
        }, ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiSongUrl]', err);
        sendJSON(res, { provider: 'qishui', url: '', playable: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qishui/lyric') {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('trackId') || '';
        sendJSON(res, await handleQishuiLyric(id, ctx.qishuiCookie));
      } catch (err) {
        console.error('[QishuiLyric]', err);
        sendJSON(res, { provider: 'qishui', error: err.message, lyric: '', tlyric: '' }, 500);
      }
      return;
    }
  };
};
