// ====================================================================
//  路由: 网易云音乐 (Netease)
//  - /api/search
//  - /api/podcast/search, /api/podcast/hot, /api/podcast/detail, /api/podcast/programs, /api/podcast/my, /api/podcast/my/items, /api/podcast/dj-beatmap
//  - /api/song/url
//  - /api/login/cookie, /api/login/qr/key, /api/login/qr/create, /api/login/qr/check, /api/login/status, /api/logout
//  - /api/user/playlists
//  - /api/song/like(/check), /api/album/subscribe(/check), /api/playlist/subscribe, /api/playlist/create, /api/playlist/add-song
//  - /api/lyric, /api/song/comments, /api/artist/detail, /api/playlist/tracks
// ====================================================================
module.exports = function register(ctx) {
  const {
    sendJSON, readRequestBody, UA,
    handleSearch, handleSongUrl, getLoginInfo, requireLogin, normalizeLoginInfo,
    readCookieFromResponse, saveCookie, normalizeCookieHeader, parseCookieString,
    normalizeApiCode, normalizeApiMessage, mapSongRecord,
    mapPodcastRadio, mapPodcastProgram, podcastCollectionMeta, fetchMyPodcastItems,
    enqueueDjAnalyze, analyzePodcastDjStream, analyzePodcastDjIntro, assertProxyableMediaUrl,
    cloudsearch, dj_hot, dj_detail, dj_program,
    login_qr_key, login_qr_create, login_qr_check, logout,
    user_playlist, song_like_check, likelist, like_song,
    album_sub, album_sublist, playlist_subscribe,
    playlist_create, playlist_tracks, playlist_track_add,
    playlist_track_all, playlist_detail, comment_music,
    artist_detail, artist_songs, artist_top_song, lyric, lyric_new,
  } = ctx;

  // ---------- 歌词合并辅助 ----------
  function lyricNodeText(body, key) {
    return body && body[key] && typeof body[key].lyric === 'string' ? body[key].lyric : '';
  }
  function lyricBodyHasPrimary(body) {
    return !!(lyricNodeText(body, 'lrc') || lyricNodeText(body, 'yrc'));
  }
  function lyricBodyHasTranslation(body) {
    return !!(lyricNodeText(body, 'tlyric') || lyricNodeText(body, 'ytlrc'));
  }
  function mergeLyricBodies(primary, fallback) {
    const merged = Object.assign({}, fallback || {}, primary || {});
    ['lrc', 'tlyric', 'yrc', 'ytlrc', 'romalrc', 'yromalrc', 'klyric'].forEach((key) => {
      if (!lyricNodeText(merged, key) && fallback && fallback[key]) merged[key] = fallback[key];
    });
    return merged;
  }

  return async function(req, res, url, pn) {
    // ---------- 搜索 ----------
    if (pn === '/api/search') {
      try {
        const kw    = url.searchParams.get('keywords') || '';
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const songs = await handleSearch(kw, limit);
        sendJSON(res, { songs });
      } catch (err) { console.error('[Search]', err); sendJSON(res, { error: err.message, songs: [] }, 500); }
      return;
    }

    if (pn === '/api/podcast/search') {
      try {
        const kw = String(url.searchParams.get('keywords') || '').trim();
        const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
        if (!kw) { sendJSON(res, { podcasts: [] }); return; }
        const r = await cloudsearch({ keywords: kw, type: 1009, limit, cookie: ctx.userCookie, timestamp: Date.now() });
        const result = (r.body && r.body.result) || {};
        const raw = result.djRadios || result.djradios || result.radios || [];
        const podcasts = raw.map(mapPodcastRadio).filter(p => p.id);
        sendJSON(res, { podcasts, total: result.djRadiosCount || result.djradiosCount || podcasts.length });
      } catch (err) {
        console.error('[PodcastSearch]', err);
        sendJSON(res, { error: err.message, podcasts: [] }, 500);
      }
      return;
    }

    if (pn === '/api/podcast/hot') {
      try {
        const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        const r = await dj_hot({ limit, offset, cookie: ctx.userCookie, timestamp: Date.now() });
        const body = r.body || {};
        const raw = body.djRadios || body.djradios || body.radios || body.data || [];
        const podcasts = (Array.isArray(raw) ? raw : []).map(mapPodcastRadio).filter(p => p.id);
        sendJSON(res, { podcasts, more: !!body.hasMore });
      } catch (err) {
        console.error('[PodcastHot]', err);
        sendJSON(res, { error: err.message, podcasts: [] }, 500);
      }
      return;
    }

    if (pn === '/api/podcast/detail') {
      try {
        const rid = url.searchParams.get('id') || url.searchParams.get('rid');
        if (!rid) { sendJSON(res, { error: 'Missing podcast id' }, 400); return; }
        const r = await dj_detail({ rid, cookie: ctx.userCookie, timestamp: Date.now() });
        const body = r.body || {};
        const radio = mapPodcastRadio(body.data || body.djRadio || body.radio || body);
        sendJSON(res, { podcast: radio });
      } catch (err) {
        console.error('[PodcastDetail]', err);
        sendJSON(res, { error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/podcast/programs') {
      try {
        const rid = url.searchParams.get('id') || url.searchParams.get('rid');
        if (!rid) { sendJSON(res, { error: 'Missing podcast id', programs: [] }, 400); return; }
        const limit = Math.max(10, Math.min(60, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        const r = await dj_program({ rid, limit, offset, asc: false, cookie: ctx.userCookie, timestamp: Date.now() });
        const body = r.body || {};
        const raw = body.programs || (body.data && (body.data.list || body.data.programs)) || [];
        const radio = raw[0] && raw[0].radio ? mapPodcastRadio(raw[0].radio) : { id: rid, rid };
        const programs = (Array.isArray(raw) ? raw : [])
          .map(p => mapPodcastProgram(p, radio))
          .filter(p => p.id && p.name);
        sendJSON(res, { radio, programs, more: !!body.more, total: body.count || programs.length });
      } catch (err) {
        console.error('[PodcastPrograms]', err);
        sendJSON(res, { error: err.message, programs: [] }, 500);
      }
      return;
    }

    if (pn === '/api/podcast/my') {
      try {
        const info = await getLoginInfo();
        if (!info.loggedIn || !info.userId) {
          const empty = ['collect', 'created', 'liked'].map(k => podcastCollectionMeta(k, []));
          sendJSON(res, { loggedIn: false, collections: empty });
          return;
        }
        const keys = ['collect', 'created', 'liked'];
        const collections = await Promise.all(keys.map(async key => {
          try {
            const data = await fetchMyPodcastItems(key, info, 12, 0);
            return podcastCollectionMeta(key, data.items || []);
          } catch (e) {
            console.warn('[MyPodcast]', key, e.message);
            return podcastCollectionMeta(key, []);
          }
        }));
        sendJSON(res, { loggedIn: true, collections });
      } catch (err) {
        console.error('[MyPodcast]', err);
        sendJSON(res, { error: err.message, collections: [] }, 500);
      }
      return;
    }

    if (pn === '/api/podcast/my/items') {
      try {
        const info = await getLoginInfo();
        if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, items: [] }); return; }
        const key = String(url.searchParams.get('key') || 'collect');
        const limit = parseInt(url.searchParams.get('limit') || '36', 10) || 36;
        const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
        const data = await fetchMyPodcastItems(key, info, limit, offset);
        sendJSON(res, { loggedIn: true, key, ...podcastCollectionMeta(key, data.items || []), itemType: data.itemType, items: data.items || [] });
      } catch (err) {
        console.error('[MyPodcastItems]', err);
        sendJSON(res, { error: err.message, items: [] }, 500);
      }
      return;
    }

    if (pn === '/api/song/url') {
      try {
        const sid = url.searchParams.get('id');
        const quality = url.searchParams.get('quality') || '';
        const matchHints = {
          name: url.searchParams.get('name') || '',
          artist: url.searchParams.get('artist') || '',
          artistId: url.searchParams.get('artistId') || '',
          artistIds: url.searchParams.get('artistIds') || '',
          artistNames: url.searchParams.get('artistNames') || '',
          album: url.searchParams.get('album') || '',
          duration: url.searchParams.get('duration') || '',
          excludeIds: url.searchParams.get('excludeIds') || '',
          skipDirect: url.searchParams.get('skipDirect') === '1',
        };
        const loginInfo = await getLoginInfo();
        const info = await handleSongUrl(sid, loginInfo, quality, matchHints);
        sendJSON(res, {
          ...info,
          loggedIn: loginInfo.loggedIn,
          vipType: loginInfo.vipType || 0,
          vipLevel: loginInfo.vipLevel || 'none',
          isVip: !!loginInfo.isVip,
          isSvip: !!loginInfo.isSvip,
          vipLabel: loginInfo.vipLabel || '无VIP',
        });
      } catch (err) { console.error('[SongUrl]', err); sendJSON(res, { error: err.message }, 500); }
      return;
    }

    if (pn === '/api/login/cookie') {
      try {
        const body = await readRequestBody(req);
        const raw = body.cookie || body.data || body.text || '';
        const normalized = normalizeCookieHeader(raw);
        const obj = parseCookieString(normalized);
        if (!obj.MUSIC_U) {
          sendJSON(res, { loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400);
          return;
        }
        saveCookie(normalized);
        let info = await getLoginInfo();
        if (!info.loggedIn && ctx.userCookie) {
          info = {
            loggedIn: true,
            pendingProfile: true,
            nickname: '网易云用户',
            avatar: '',
            vipType: 0,
            vipLevel: 'none',
            isVip: false,
            isSvip: false,
            vipLabel: '无VIP',
          };
        }
        sendJSON(res, { ...info, saved: true, hasCookie: !!ctx.userCookie });
      } catch (err) {
        console.error('[LoginCookie]', err);
        sendJSON(res, { loggedIn: false, error: err.message }, 500);
      }
      return;
    }

    // ---------- 登录: QR Key ----------
    // ---------- 播客 DJ 长音频后端离线锁拍 ----------
    if (pn === '/api/podcast/dj-beatmap') {
      try {
        let audioUrl;
        try { audioUrl = await assertProxyableMediaUrl(url.searchParams.get('url'), 'AUDIO'); }
        catch (err) {
          sendJSON(res, { error: err.message || 'Invalid audio url' }, 400);
          return;
        }
        const durationSec = Math.max(0, Number(url.searchParams.get('duration') || 0) || 0);
        console.log('[PodcastDjBeatmap] start', Math.round(durationSec || 0) + 's');
        const started = Date.now();
        const introSec = Math.max(0, Number(url.searchParams.get('intro') || 0) || 0);
        const map = await enqueueDjAnalyze(() => (
          introSec
            ? analyzePodcastDjIntro(audioUrl, { durationSec, introSec, userAgent: UA })
            : analyzePodcastDjStream(audioUrl, { durationSec, userAgent: UA })
        ));
        console.log('[PodcastDjBeatmap] done beats:', map.visualBeatCount || 0, 'ms:', Date.now() - started, 'decode:', map.decode || {});
        sendJSON(res, { ok: true, map });
      } catch (err) {
        console.error('[PodcastDjBeatmap]', err);
        sendJSON(res, { ok: false, error: err.message || String(err) }, 500);
      }
      return;
    }

    if (pn === '/api/login/qr/key') {
      try {
        const r = await login_qr_key({ timestamp: Date.now() });
        const key = r.body && r.body.data && r.body.data.unikey;
        sendJSON(res, { key });
      } catch (err) { sendJSON(res, { error: err.message }, 500); }
      return;
    }

    // ---------- 登录: QR 二维码图片 ----------
    if (pn === '/api/login/qr/create') {
      try {
        const key = url.searchParams.get('key');
        const r = await login_qr_create({ key, qrimg: true, timestamp: Date.now() });
        const d = r.body && r.body.data;
        sendJSON(res, { img: d && d.qrimg, url: d && d.qrurl });
      } catch (err) { sendJSON(res, { error: err.message }, 500); }
      return;
    }

    // ---------- 登录: 轮询扫码状态 ----------
    if (pn === '/api/login/qr/check') {
      try {
        const key = url.searchParams.get('key');
        let r = await login_qr_check({ key, noCookie: true, timestamp: Date.now() });
        let body = r.body || {};
        let code = Number(body.code || r.code);
        let msg  = body.message || r.message || '';
        let cookie = readCookieFromResponse(r);
        if (code === 803 && !cookie) {
          try {
            const retry = await login_qr_check({ key, timestamp: Date.now() });
            const retryCookie = readCookieFromResponse(retry);
            if (retryCookie) {
              r = retry;
              body = retry.body || body;
              code = Number(body.code || retry.code || code);
              msg = body.message || retry.message || msg;
              cookie = retryCookie;
            }
          } catch (retryErr) {
            console.warn('[Login] qr cookie retry failed:', retryErr.message);
          }
        }
        // 803 = 授权成功, 802 = 已扫待确认, 801 = 等待扫码, 800 = 二维码过期
        if (code === 803) {
          if (cookie) saveCookie(cookie);
          let info = await getLoginInfo();
          if (!info.loggedIn) {
            const profile = body.profile || (body.data && body.data.profile) || {};
            info = normalizeLoginInfo(profile, body.account || (body.data && body.data.account), body.data || body);
          }
          if (!info.loggedIn && cookie) {
            info = {
              loggedIn: true,
              pendingProfile: true,
              nickname: (body.nickname || (body.profile && body.profile.nickname) || '网易云用户'),
              avatar: body.avatarUrl || (body.profile && body.profile.avatarUrl) || '',
              vipType: 0,
              vipLevel: 'none',
              isVip: false,
              isSvip: false,
              vipLabel: '无VIP',
            };
          }
          sendJSON(res, { code, message: msg, ...info, hasCookie: !!cookie });
          return;
        }
        sendJSON(res, { code, message: msg, nickname: body.nickname, avatar: body.avatarUrl });
      } catch (err) { sendJSON(res, { error: err.message }, 500); }
      return;
    }

    // ---------- 登录态查询 ----------
    if (pn === '/api/login/status') {
      const info = await getLoginInfo();
      sendJSON(res, info);
      return;
    }

    // ---------- 登出 ----------
    if (pn === '/api/logout') {
      try { await logout({ cookie: ctx.userCookie }); } catch (e) {}
      saveCookie('');
      sendJSON(res, { ok: true });
      return;
    }

    // ---------- 用户歌单 ----------
    if (pn === '/api/user/playlists') {
      try {
        const info = await getLoginInfo();
        if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, playlists: [] }); return; }
        const limit = Math.max(12, Math.min(100, parseInt(url.searchParams.get('limit') || '60', 10) || 60));
        const r = await user_playlist({ uid: info.userId, limit, cookie: ctx.userCookie, timestamp: Date.now() });
        const list = ((r.body && r.body.playlist) || []).map(pl => ({
          id: pl.id,
          name: pl.name,
          cover: pl.coverImgUrl || '',
          trackCount: pl.trackCount || 0,
          playCount: pl.playCount || 0,
          creator: (pl.creator && pl.creator.nickname) || '',
          subscribed: !!pl.subscribed,
          specialType: pl.specialType || 0,
        }));
        sendJSON(res, { loggedIn: true, userId: info.userId, playlists: list });
      } catch (err) {
        console.error('[UserPlaylists]', err);
        sendJSON(res, { error: err.message, loggedIn: false, playlists: [] }, 500);
      }
      return;
    }

    // ---------- 红心状态 ----------
    if (pn === '/api/song/like/check') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        if (!ids.length) { sendJSON(res, { error: 'Missing song id', liked: {}, ids: [] }, 400); return; }
        let likedIds = [];
        try {
          if (typeof song_like_check === 'function') {
            const checked = await song_like_check({ ids: JSON.stringify(ids.map(Number).filter(Boolean)), cookie: ctx.userCookie, timestamp: Date.now() });
            const data = (checked.body && (checked.body.data || checked.body.ids)) || checked.body || {};
            if (Array.isArray(data)) likedIds = data.map(String);
            else if (data && typeof data === 'object') {
              ids.forEach(id => {
                if (data[id] || data[String(id)] || data[Number(id)]) likedIds.push(String(id));
              });
            }
          }
        } catch (e) {
          console.warn('[LikeCheck] direct check failed:', e.message);
        }
        if (!likedIds.length) {
          const r = await likelist({ uid: info.userId, cookie: ctx.userCookie, timestamp: Date.now() });
          likedIds = ((r.body && r.body.ids) || []).map(String);
        }
        const set = new Set(likedIds);
        const liked = {};
        ids.forEach(id => { liked[id] = set.has(String(id)); });
        sendJSON(res, { loggedIn: true, ids, liked });
      } catch (err) {
        console.error('[LikeCheck]', err);
        sendJSON(res, { error: err.message }, 500);
      }
      return;
    }

    // ---------- 红心/取消红心 ----------
    if (pn === '/api/song/like') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const id = body.id || url.searchParams.get('id');
        const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
        if (!id) { sendJSON(res, { error: 'Missing song id' }, 400); return; }
        const r = await like_song({ id, like: String(nextLike), cookie: ctx.userCookie, timestamp: Date.now() });
        const code = (r.body && r.body.code) || r.code || 200;
        sendJSON(res, { loggedIn: true, id, liked: nextLike, code, message: normalizeApiMessage(r) });
      } catch (err) {
        console.error('[Like]', err);
        sendJSON(res, { error: err.message }, 500);
      }
      return;
    }

    // ---------- 网易云专辑/歌单订阅 ----------
    if (pn === '/api/album/subscribe') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const id = body.id || body.albumId || url.searchParams.get('id') || '';
        const subscribed = String(body.subscribed != null ? body.subscribed : (url.searchParams.get('subscribed') || 'true')) !== 'false';
        if (!id) { sendJSON(res, { success: false, error: 'Missing album id' }, 400); return; }
        const result = await album_sub({ id, t: subscribed ? 1 : 0, cookie: ctx.userCookie, timestamp: Date.now() });
        const code = normalizeApiCode(result);
        sendJSON(res, { provider: 'netease', id, subscribed, success: code === 200, code, body: result.body || result });
      } catch (err) {
        console.error('[AlbumSubscribe]', err);
        sendJSON(res, { provider: 'netease', success: false, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/album/subscribe/check') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
          .split(',').map(value => value.trim()).filter(Boolean);
        if (!ids.length) { sendJSON(res, { provider: 'netease', subscribed: {} }); return; }
        const wanted = new Set(ids);
        const found = new Set();
        let offset = 0;
        for (let page = 0; page < 8 && found.size < wanted.size; page++) {
          const result = await album_sublist({ limit: 50, offset, cookie: ctx.userCookie, timestamp: Date.now() });
          const body = result.body || result || {};
          const rows = Array.isArray(body.data) ? body.data : (body.albums || []);
          rows.forEach(item => {
            const id = String(item && item.id || '');
            if (wanted.has(id)) found.add(id);
          });
          if (!body.hasMore || rows.length < 50) break;
          offset += rows.length;
        }
        const subscribed = {};
        ids.forEach(id => { subscribed[id] = found.has(id); });
        sendJSON(res, { provider: 'netease', ids, subscribed });
      } catch (err) {
        console.error('[AlbumSubscribeCheck]', err);
        sendJSON(res, { provider: 'netease', subscribed: {}, error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/playlist/subscribe') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const id = body.id || body.playlistId || url.searchParams.get('id') || '';
        const subscribed = String(body.subscribed != null ? body.subscribed : (url.searchParams.get('subscribed') || 'true')) !== 'false';
        if (!id) { sendJSON(res, { success: false, error: 'Missing playlist id' }, 400); return; }
        const result = await playlist_subscribe({ id, t: subscribed ? 1 : 0, cookie: ctx.userCookie, timestamp: Date.now() });
        const code = normalizeApiCode(result);
        sendJSON(res, { provider: 'netease', id, subscribed, success: code === 200, code, body: result.body || result });
      } catch (err) {
        console.error('[PlaylistSubscribe]', err);
        sendJSON(res, { provider: 'netease', success: false, error: err.message }, 500);
      }
      return;
    }

    // ---------- 创建歌单 ----------
    if (pn === '/api/playlist/create') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const name = String(body.name || url.searchParams.get('name') || '').trim();
        const privacy = String(body.privacy || url.searchParams.get('privacy') || '0');
        if (!name) { sendJSON(res, { error: 'Missing playlist name' }, 400); return; }
        const r = await playlist_create({ name, privacy, cookie: ctx.userCookie, timestamp: Date.now() });
        const created = (r.body && (r.body.playlist || r.body.data)) || {};
        sendJSON(res, {
          loggedIn: true,
          playlist: {
            id: created.id,
            name: created.name || name,
            cover: created.coverImgUrl || created.cover || '',
            trackCount: created.trackCount || 0,
          },
          code: normalizeApiCode(r),
        });
      } catch (err) {
        console.error('[PlaylistCreate]', err);
        sendJSON(res, { error: err.message }, 500);
      }
      return;
    }

    // ---------- 收藏歌曲到歌单 ----------
    if (pn === '/api/playlist/add-song') {
      try {
        const info = await requireLogin(res);
        if (!info) return;
        const body = req.method === 'POST' ? await readRequestBody(req) : {};
        const pid = body.pid || url.searchParams.get('pid');
        const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids');
        if (!pid || !id) { sendJSON(res, { error: 'Missing playlist id or song id' }, 400); return; }
        const attempts = [];
        let finalBody = null;
        let finalCode = 0;
        let finalMessage = '';
        let success = false;

        const primary = await playlist_tracks({ op: 'add', pid, tracks: String(id), cookie: ctx.userCookie, timestamp: Date.now() });
        finalBody = primary.body || primary;
        finalCode = normalizeApiCode(primary);
        finalMessage = normalizeApiMessage(primary);
        success = finalCode === 200 && !(finalBody && finalBody.error);
        attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody });

        if (!success && typeof playlist_track_add === 'function') {
          try {
            const fallback = await playlist_track_add({ pid, ids: String(id), cookie: ctx.userCookie, timestamp: Date.now() });
            finalBody = fallback.body || fallback;
            finalCode = normalizeApiCode(fallback);
            finalMessage = normalizeApiMessage(fallback);
            success = finalCode === 200 && !(finalBody && finalBody.error);
            attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody });
          } catch (fallbackErr) {
            const errBody = fallbackErr.body || fallbackErr.response || {};
            finalBody = errBody;
            finalCode = normalizeApiCode(errBody);
            finalMessage = normalizeApiMessage(errBody) || fallbackErr.message || '';
            attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody });
          }
        }

        if (!success) {
          sendJSON(res, { loggedIn: true, pid, id, success: false, code: finalCode, error: finalMessage || 'PLAYLIST_ADD_FAILED', attempts }, finalCode === 401 ? 401 : 409);
          return;
        }
        sendJSON(res, { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody, attempts });
      } catch (err) {
        console.error('[PlaylistAddSong]', err);
        sendJSON(res, { error: err.message }, 500);
      }
      return;
    }

    // ---------- 歌词 ----------
    if (pn === '/api/lyric') {
      try {
        const id = url.searchParams.get('id');
        if (!id) { sendJSON(res, { error: 'Missing song id', lyric: '' }, 400); return; }
        let body = {};
        let source = 'lyric';
        try {
          if (typeof lyric_new === 'function') {
            const nr = await lyric_new({ id, cookie: ctx.userCookie, timestamp: Date.now() });
            body = nr.body || {};
            source = 'lyric_new';
          }
        } catch (errNew) {
          console.warn('[LyricNew]', errNew.message);
        }
        if (!lyricBodyHasPrimary(body) || !lyricBodyHasTranslation(body)) {
          const r = await lyric({ id, cookie: ctx.userCookie, timestamp: Date.now() });
          body = mergeLyricBodies(body, r.body || {});
          source = source === 'lyric_new' ? 'lyric_new+lyric' : 'lyric';
        }
        sendJSON(res, {
          lyric: (body.lrc && body.lrc.lyric) || '',
          tlyric: (body.tlyric && body.tlyric.lyric) || '',
          yrc: (body.yrc && body.yrc.lyric) || '',
          ytlrc: (body.ytlrc && body.ytlrc.lyric) || '',
          romalrc: (body.romalrc && body.romalrc.lyric) || '',
          yromalrc: (body.yromalrc && body.yromalrc.lyric) || '',
          source,
        });
      } catch (err) {
        console.error('[Lyric]', err);
        sendJSON(res, { error: err.message, lyric: '' }, 500);
      }
      return;
    }

    // ---------- 歌曲评论 ----------
    if (pn === '/api/song/comments') {
      try {
        const id = url.searchParams.get('id');
        const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        if (!id) { sendJSON(res, { error: 'Missing song id', comments: [] }, 400); return; }
        const r = await comment_music({ id, limit, offset, cookie: ctx.userCookie, timestamp: Date.now() });
        const body = r.body || r || {};
        const raw = body.hotComments && offset === 0 ? body.hotComments : (body.comments || []);
        const comments = (raw || []).map(c => ({
          id: c.commentId,
          content: c.content || '',
          likedCount: c.likedCount || 0,
          time: c.time || 0,
          user: c.user ? { id: c.user.userId, nickname: c.user.nickname || '', avatar: c.user.avatarUrl || '' } : null,
        })).filter(c => c.content);
        sendJSON(res, { id, total: body.total || 0, comments, hot: !!(body.hotComments && offset === 0) });
      } catch (err) {
        console.error('[SongComments]', err);
        sendJSON(res, { error: err.message, comments: [] }, 500);
      }
      return;
    }

    // ---------- 歌手主页 / 热门歌曲 ----------
    if (pn === '/api/artist/detail') {
      try {
        const id = url.searchParams.get('id');
        const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
        if (!id) { sendJSON(res, { error: 'Missing artist id', songs: [] }, 400); return; }
        let detailBody = {};
        try {
          const detail = await artist_detail({ id, cookie: ctx.userCookie, timestamp: Date.now() });
          detailBody = detail.body || detail || {};
        } catch (e) {
          console.warn('[ArtistDetail] detail failed:', e.message);
        }
        let rawSongs = [];
        try {
          const list = await artist_songs({ id, order: 'hot', limit, offset: 0, cookie: ctx.userCookie, timestamp: Date.now() });
          const b = list.body || list || {};
          rawSongs = (b.songs || (b.data && b.data.songs) || []);
        } catch (e) {
          console.warn('[ArtistSongs] hot failed:', e.message);
        }
        if (!rawSongs.length) {
          const top = await artist_top_song({ id, cookie: ctx.userCookie, timestamp: Date.now() });
          const b = top.body || top || {};
          rawSongs = b.songs || [];
        }
        const artist = detailBody.artist || (detailBody.data && (detailBody.data.artist || detailBody.data)) || {};
        const songs = rawSongs.map(mapSongRecord).filter(s => s.id).slice(0, limit);
        sendJSON(res, {
          id,
          artist: {
            id: artist.id || id,
            name: artist.name || artist.artistName || '',
            avatar: artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url || '',
            brief: artist.briefDesc || artist.description || artist.desc || '',
            musicSize: artist.musicSize || artist.songSize || 0,
            albumSize: artist.albumSize || 0,
          },
          songs,
        });
      } catch (err) {
        console.error('[ArtistDetail]', err);
        sendJSON(res, { error: err.message, songs: [] }, 500);
      }
      return;
    }

    // ---------- 歌单曲目详情 ----------
    if (pn === '/api/playlist/tracks') {
      try {
        const id = url.searchParams.get('id');
        if (!id) { sendJSON(res, { error: 'Missing playlist id', tracks: [] }, 400); return; }

        let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
        let rawTracks = [];

        // 新版本 NeteaseCloudMusicApi 通常提供 playlist_track_all；旧版本退回 playlist_detail。
        if (typeof playlist_track_all === 'function') {
          try {
            const all = await playlist_track_all({ id, limit: 500, offset: 0, cookie: ctx.userCookie, timestamp: Date.now() });
            rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
          } catch (err) {
            console.warn('[PlaylistTracks] playlist_track_all failed, fallback to detail:', err.message);
          }
        }

        if (!rawTracks.length && typeof playlist_detail === 'function') {
          const detail = await playlist_detail({ id, s: 0, cookie: ctx.userCookie, timestamp: Date.now() });
          const pl = (detail.body && detail.body.playlist) || {};
          playlistMeta = { id: pl.id || id, name: pl.name || '', cover: pl.coverImgUrl || '', trackCount: pl.trackCount || 0 };
          rawTracks = pl.tracks || [];
        }

        const tracks = rawTracks.map(mapSongRecord).filter(t => t.id);

        if (!playlistMeta.trackCount) playlistMeta.trackCount = tracks.length;
        sendJSON(res, { playlist: playlistMeta, tracks });
      } catch (err) {
        console.error('[PlaylistTracks]', err);
        sendJSON(res, { error: err.message, tracks: [] }, 500);
      }
      return;
    }
  };
};
