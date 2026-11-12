// ====================================================================
//  路由: QQ 音乐
//  - /api/qq/search, /api/qq/song/url, /api/qq/lyric
//  - /api/qq/login/status, /api/qq/login/cookie, /api/qq/logout
//  - /api/qq/user/playlists, /api/qq/playlist/tracks
//  - /api/qq/artist/detail, /api/qq/song/comments
//  - 批次2 增补（实现见 server/qq/extras.js）：
//    /api/qq/recommendations（改为真推荐）、/api/qq/recommend/feed, /api/qq/recommend/playlists,
//    /api/qq/recommend/radar, /api/qq/song/similar, /api/qq/song/related-playlists,
//    /api/qq/song/like/check, /api/qq/toplist/groups, /api/qq/toplist/detail,
//    /api/qq/artist/albums, /api/qq/artist/songs, /api/qq/search/collections,
//    /api/qq/user/recent, /api/qq/playlist/create, /api/qq/playlist/add-song,
//    /api/qq/playlist/remove-song
// ====================================================================
const createQQExtras = require('../qq/extras');

module.exports = function register(ctx) {
  const {
    sendJSON, readRequestBody,
    handleQQSearch, handleQQSongUrl, handleQQLyric,
    getQQLoginInfo, normalizeQQCookieInput, parseCookieString,
    qqCookieUin, qqCookieMusicKey, saveQQCookie, bumpQQCookieEpoch, withQQCookieWriteLock, refreshQQCookieSession,
    handleQQUserPlaylists, handleQQPlaylistTracks,
    handleQQArtistDetail, handleQQAlbumDetail, handleQQSongComments,
  } = ctx;
  const extras = createQQExtras(ctx);

  // 批次2 公共包装：统一错误形态，空结果必须带 message，不静默返回空数组。
  async function runExtra(res, label, fn) {
    try {
      sendJSON(res, await fn());
    } catch (err) {
      console.error('[' + label + ']', err);
      const reason = String(err && (err.message || (err.body && err.body.message)) || err || 'QQ_UPSTREAM_ERROR');
      sendJSON(res, { provider: 'qq', error: reason, message: reason }, 500);
    }
  }

  async function runAccountExtra(req, res, label, fn) {
    let info;
    try { info = await getQQLoginInfo(); } catch (err) { info = null; }
    if (!info || !info.loggedIn) {
      sendJSON(res, { provider: 'qq', loggedIn: false, error: 'LOGIN_REQUIRED', message: '需要登录 QQ 音乐账号' }, 401);
      return;
    }
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      sendJSON(res, await fn(info, body || {}));
    } catch (err) {
      console.error('[' + label + ']', err);
      const reason = String(err && (err.message || (err.body && err.body.message)) || err || 'QQ_UPSTREAM_ERROR');
      sendJSON(res, { provider: 'qq', loggedIn: true, error: reason, message: reason }, 500);
    }
  }

  return async function(req, res, url, pn) {
    if (pn === '/api/qq/search') {
      try {
        const kw = url.searchParams.get('keywords') || '';
        const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        const songs = await handleQQSearch(kw, limit, offset);
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
        const forceVip = /^(1|true|yes)$/i.test(String(url.searchParams.get('forceVip') || url.searchParams.get('force') || ''));
        const forceRenew = forceVip || url.searchParams.get('renew') === '1' || url.searchParams.get('refresh') === '1';
        const info = await getQQLoginInfo({
          autoRenew: true,
          forceRenew,
          forceVip,
          forceCookie: forceVip,
        });
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
          refreshOk: !!(result && (result.ok || result.skipped)),
          refreshSkipped: !!(result && result.skipped),
          refreshVia: result && result.via,
          refreshReason: result && result.reason,
          reauthRequired: !!(info && info.reauthRequired) || !!(result && result.reauthRequired && !result.skipped),
        }), 200);
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
        // 写锁 + 代际递增：与后台刷新互斥，且让在途刷新发现“用户刚保存过”而放弃旧值写回。
        // bump 必须在锁内，否则“写盘→释放锁→bump”之间刷新可插入并覆盖
        await withQQCookieWriteLock(() => { saveQQCookie(normalized); bumpQQCookieEpoch(); });
        const info = await getQQLoginInfo();
        sendJSON(res, { ...info, saved: true });
      } catch (err) {
        console.error('[QQLoginCookie]', err);
        sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/qq/logout') {
      // 登出也是外部写入：锁内清空并作废在途刷新的写回，防止退完又“被登录”
      await withQQCookieWriteLock(() => { saveQQCookie(''); bumpQQCookieEpoch(); });
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

    /* 专辑详情：前端 05-home-track-detail.js:370 早就请求这个路由，
       服务端此前没有实现 → 点「专辑」永远显示「专辑详情加载失败」。 */
    if (pn === '/api/qq/album/detail') {
      try {
        const mid = url.searchParams.get('mid') || url.searchParams.get('albummid') || url.searchParams.get('albumMid') || '';
        const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '120', 10) || 120));
        if (!mid) {
          sendJSON(res, { provider: 'qq', error: 'MISSING_ALBUM_MID', album: null, songs: [] }, 400);
          return;
        }
        sendJSON(res, await handleQQAlbumDetail(mid, limit));
      } catch (err) {
        console.error('[QQAlbumDetail]', err);
        sendJSON(res, { provider: 'qq', error: err.message, album: null, songs: [] }, 500);
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

    // ==================================================================
    //  批次2：QQ 真实推荐 / 发现 / 账号写回（2026-11-12）
    //  每条都 await 真实 musicu.fcg 上游，协议见 server/qq/extras.js 头注释。
    //  空壳接口 /api/qq/recommendations 在此替换为真实推荐，不再用关键词搜索替代。
    // ==================================================================

    if (pn === '/api/qq/recommendations') {
      await runExtra(res, 'QQRecommendations', () => extras.guessYouLike(url.searchParams));
      return;
    }

    if (pn === '/api/qq/recommend/feed') {
      await runExtra(res, 'QQRecommendFeed', () => extras.dailyFeed(url.searchParams));
      return;
    }

    if (pn === '/api/qq/recommend/playlists') {
      await runExtra(res, 'QQRecommendPlaylists', () => extras.recommendPlaylists(url.searchParams));
      return;
    }

    if (pn === '/api/qq/recommend/radar') {
      await runExtra(res, 'QQRadar', () => extras.radarSongs(url.searchParams));
      return;
    }

    if (pn === '/api/qq/song/similar') {
      await runExtra(res, 'QQSimilarSongs', () => extras.similarSongs(url.searchParams));
      return;
    }

    if (pn === '/api/qq/song/related-playlists') {
      await runExtra(res, 'QQRelatedPlaylists', () => extras.relatedPlaylists(url.searchParams));
      return;
    }

    if (pn === '/api/qq/toplist/groups') {
      await runExtra(res, 'QQToplistGroups', () => extras.toplistGroups());
      return;
    }

    if (pn === '/api/qq/toplist/detail') {
      await runExtra(res, 'QQToplistDetail', () => extras.toplistDetail(url.searchParams));
      return;
    }

    if (pn === '/api/qq/artist/albums') {
      await runExtra(res, 'QQArtistAlbums', () => extras.artistAlbums(url.searchParams));
      return;
    }

    if (pn === '/api/qq/artist/songs') {
      await runExtra(res, 'QQArtistSongs', () => extras.artistSongs(url.searchParams));
      return;
    }

    if (pn === '/api/qq/search/collections') {
      await runExtra(res, 'QQSearchCollections', () => extras.searchCollections(url.searchParams));
      return;
    }

    // ---------- 带「我的」语义：登录态由 runAccountExtra 校验 ----------
    if (pn === '/api/qq/user/recent') {
      await runAccountExtra(req, res, 'QQRecentPlayed', (info) => extras.recentPlayed(info, url.searchParams));
      return;
    }

    if (pn === '/api/qq/song/like/check') {
      await runAccountExtra(req, res, 'QQSongLikeCheck', (info) => extras.songLikeCheck(info, url.searchParams));
      return;
    }

    if (pn === '/api/qq/playlist/create') {
      await runAccountExtra(req, res, 'QQPlaylistCreate', (info, body) => extras.playlistCreate(info, body));
      return;
    }

    if (pn === '/api/qq/playlist/add-song') {
      await runAccountExtra(req, res, 'QQPlaylistAddSong', (info, body) => extras.playlistAddSong(info, body));
      return;
    }

    if (pn === '/api/qq/playlist/remove-song') {
      await runAccountExtra(req, res, 'QQPlaylistRemoveSong', (info, body) => extras.playlistRemoveSong(info, body));
      return;
    }
  };
};
