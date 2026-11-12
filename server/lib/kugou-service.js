'use strict';

// 酷狗业务编排：登录二维码、设备注册、歌单/云盘、曲目映射与排序、取址（trackercdn）。
// 纯映射函数（mapKugouTrack / mapKugouPlaylist / asArrayDeep / sortKugouCloudTracks）无外部依赖。
// 从 server.js 抽出（原为 server.js 2911–3560 的后半段）。
// 与 kugou-protocol.js 互不引用：两边都只依赖 server.js 注入的符号（依赖图实证）。

module.exports = function createKugouService(deps) {
  const {
    KUGOU_ID,
    KUGOU_LOGIN_BASE_URL,
    KUGOU_PLAY_KEY_SALT,
    KUGOU_QR_APPID,
    KUGOU_QR_SRC_APPID,
    QRCode,
    UA,
    getKugouCookie,
    getKugouLoginInfo,
    getKugouLoginInfoFromApi,
    kugouCookieObject,
    kugouCookieToken,
    kugouCookieUserId,
    kugouCookieVipType,
    kugouVipProbe,
    normalizeQualityPreference,
    parseJSONText,
    playbackRestriction,
    protocol,
    registerKugouCloudDevice,
    requestText,
    serializeCookieObject,
  } = deps || {};
  // 协议层（单向依赖：protocol 不反向引用 service）
  const { kugouMd5, kugouInitDevice, saveKugouAuth, kugouCookieMid, kugouCloudlistCookieHeader, kugouGatewayRequest, kugouCloudlistRequest, kugouSafeGet, kugouDeepFind } = protocol || {};

  const https = require('https');

  /* 取址诊断：主进程 Windows 下 console.log 会被吞，直接写 cookie-debug.log。
     只记参数摘要与上游原始响应，绝不记录 token / key 的值。 */
  function kugouPlayDebugLog(msg) {
    try {
      const fs = require('fs');
      const nodePath = require('path');
      const cookieFile = process.env.KUGOU_COOKIE_FILE || '';
      const dir = cookieFile
        ? nodePath.dirname(cookieFile)
        : (process.env.APPDATA ? nodePath.join(process.env.APPDATA, 'Mineradio') : '');
      if (!dir) return;
      fs.appendFileSync(nodePath.join(dir, 'cookie-debug.log'),
        '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8');
    } catch (_) {}
  }

  /* 上游抖动的兜底：短 TTL 命中直接返回；上游失败时回落到「上一次成功」。
     旧行为是直连上游、失败就把错误抛给路由 → 500 → 渲染层 Promise.all 整体失败，
     面板从「加载中」直接变空白。实测 /api/kugou/user/playlists 在 153ms~25s 之间跳。 */
  function createKugouFallbackCache(maxEntries) {
    const store = new Map();
    return {
      get(key, ttlMs) {
        const hit = store.get(key);
        if (!hit) return null;
        if (typeof ttlMs === 'number' && Date.now() - hit.at > ttlMs) return null;
        return hit.value;
      },
      set(key, value) {
        store.set(key, { at: Date.now(), value });
        if (store.size > maxEntries) {
          const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) store.delete(oldest[0]);
        }
        return value;
      },
      clear() { store.clear(); },
    };
  }
  const kugouUserPlaylistsCache = createKugouFallbackCache(4);
  const kugouPlaylistTracksCache = createKugouFallbackCache(24);
  const KUGOU_USER_PLAYLISTS_TTL_MS = 45 * 1000;
  const KUGOU_PLAYLIST_TRACKS_TTL_MS = 90 * 1000;

  /* 登录态探测也是上游往返：面板每次打开都会问一次。
     60s 内复用，失败时退回上一次成功值（而不是让整个歌单接口 500）。 */
  let kugouLoginApiCache = { at: 0, cookie: '', value: null };
  async function getKugouLoginInfoFromApiCached(cookie) {
    if (!cookie) return null;
    const now = Date.now();
    if (kugouLoginApiCache.value && kugouLoginApiCache.cookie === cookie && now - kugouLoginApiCache.at < 60 * 1000) {
      return kugouLoginApiCache.value;
    }
    try {
      const value = await getKugouLoginInfoFromApi(cookie);
      if (value) kugouLoginApiCache = { at: now, cookie, value };
      return value;
    } catch (err) {
      if (kugouLoginApiCache.value && kugouLoginApiCache.cookie === cookie) return kugouLoginApiCache.value;
      throw err;
    }
  }

  async function handleKugouLoginQrKey() {
    const device = saveKugouAuth(kugouCookieObject());
    const qrcodeText = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=' + KUGOU_ID.APPID + '&';
    const data = await kugouGatewayRequest('/v2/qrcode', {
      baseURL: KUGOU_LOGIN_BASE_URL,
      encryptType: 'web',
      params: {
        appid: KUGOU_QR_APPID,
        type: 1,
        plat: 4,
        qrcode_txt: qrcodeText,
        srcappid: KUGOU_QR_SRC_APPID,
      },
      headers: {
        'User-Agent': UA,
        'x-router': 'login-user.kugou.com',
      },
    });
    const key = kugouSafeGet(data, ['data', 'qrcode'], '') || data.qrcode || data.key || '';
    if (!key) {
      const err = new Error((data && (data.error_msg || data.message || data.msg)) || 'KUGOU_QR_KEY_FAILED');
      err.body = data;
      throw err;
    }
    const loginUrl = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + encodeURIComponent(key);
    const img = await QRCode.toDataURL(loginUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
    return {
      provider: 'kugou',
      key,
      qrcode: key,
      url: loginUrl,
      img,
      deviceId: device.KUGOU_API_GUID,
    };
  }
  async function kugouRegisterDevice(auth) {
    auth = kugouInitDevice(auth || kugouCookieObject());
    // 归口到 kugou-api.js 的单一实现（lite 身份 + lite RSA 公钥）；成功后把 dfid 写回 cookie 存档
    const dfid = await registerKugouCloudDevice(serializeCookieObject(auth));
    auth.dfid = dfid;
    saveKugouAuth(Object.assign(kugouCookieObject(), { dfid }));
    return { status: 1, data: { dfid } };
  }
  async function handleKugouLoginQrCheck(key) {
    const qr = String(key || '').trim();
    if (!qr) return { provider: 'kugou', code: 800, status: 0, message: 'Missing Kugou QR key' };
    const data = await kugouGatewayRequest('/v2/get_userinfo_qrcode', {
      baseURL: KUGOU_LOGIN_BASE_URL,
      encryptType: 'web',
      params: {
        plat: 4,
        appid: KUGOU_ID.APPID,
        srcappid: KUGOU_QR_SRC_APPID,
        qrcode: qr,
      },
      headers: {
        'User-Agent': UA,
        'x-router': 'login-user.kugou.com',
      },
    });
    const status = Number(kugouSafeGet(data, ['data', 'status'], data.status || kugouDeepFind(data, ['status']) || 0)) || 0;
    const token = String(kugouSafeGet(data, ['data', 'token'], '') ||
      kugouDeepFind(data, ['token', 'user_token', 'access_token', 'key']) ||
      data.token || '').trim();
    const userId = String(kugouSafeGet(data, ['data', 'userid'], '') ||
      kugouDeepFind(data, ['userid', 'user_id', 'uid', 'kugooid', 'kugouid']) ||
      data.userid || '').replace(/\D/g, '');
    const nickname = String(kugouSafeGet(data, ['data', 'nickname'], '') ||
      kugouSafeGet(data, ['data', 'username'], '') ||
      kugouDeepFind(data, ['nickname', 'nick', 'username', 'user_name', 'uname']) ||
      '').trim();
    const avatar = String(kugouSafeGet(data, ['data', 'pic'], '') ||
      kugouSafeGet(data, ['data', 'avatar'], '') ||
      kugouSafeGet(data, ['data', 'img'], '') ||
      kugouSafeGet(data, ['data', 'user_pic'], '') ||
      kugouDeepFind(data, ['avatar', 'pic', 'img', 'icon', 'headpic', 'head_img', 'headimg', 'user_pic', 'userpic']) ||
      data.pic || data.avatar || data.img || '').trim();
    const vipType = Number(kugouSafeGet(data, ['data', 'vip_type'], 0) ||
      kugouSafeGet(data, ['data', 'vipType'], 0) ||
      kugouSafeGet(data, ['data', 'viptype'], 0) ||
      kugouDeepFind(data, ['vip_type', 'vipType', 'viptype', 'isvip', 'is_vip', 'vip']) ||
      data.vip_type || data.vipType || data.viptype || 0) || 0;
    if (!(token && userId)) {
      if (status !== 4) {
        const code = status === 2 ? 802 : (status === 3 ? 800 : 801);
        return { provider: 'kugou', loggedIn: false, code, status, rawStatus: status, message: data && (data.message || data.msg || data.error_msg) || '' };
      }
    }
    if (!token || !userId) {
      return { provider: 'kugou', loggedIn: false, code: 803, status, error: 'KUGOU_TOKEN_MISSING', message: 'Kugou login confirmed but token was not returned' };
    }
    const auth = saveKugouAuth(Object.assign({}, kugouCookieObject(), {
      token,
      userid: userId,
      nickname,
      avatar,
      vipType,
    }));
    try {
      await kugouRegisterDevice(auth);
      saveKugouAuth(auth);
    } catch (e) {
      console.warn('[KugouRegisterDevice]', e.message);
    }
    return Object.assign({}, await getKugouLoginInfoFresh(), {
      code: 803,
      status,
      saved: true,
      rawStatus: status,
    });
  }
  function asArrayDeep(value, keys) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key];
    }
    for (const key of Object.keys(value)) {
      if (value[key] && typeof value[key] === 'object') {
        const found = asArrayDeep(value[key], keys);
        if (found.length) return found;
      }
    }
    return [];
  }
  function mapKugouPlaylist(raw) {
    raw = raw || {};
    const id = raw.listid || raw.list_id || raw.global_collection_id || raw.specialid || raw.id || raw.mixsongid || '';
    const name = raw.name || raw.listname || raw.list_name || raw.specialname || raw.title || raw.collection_name || '';
    const cover = raw.pic || raw.img || raw.cover || raw.sizable_cover || raw.list_pic || raw.avatar || '';
    return {
      provider: 'kugou',
      source: 'kugou',
      type: 'kugou',
      id: String(id || ''),
      name: String(name || '酷狗歌单'),
      cover: String(cover || '').replace(/\{size\}/g, '240'),
      trackCount: Number(raw.count || raw.song_count || raw.total || raw.file_count || raw.songcount || 0) || 0,
      creator: raw.username || raw.nickname || raw.user_name || '酷狗音乐',
    };
  }
  function cleanKugouTrackText(value) {
    return String(value || '')
      .replace(/\.(mp3|flac|m4a|aac|ogg|wav)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function normalizeSimpleTitleForCompare(value) {
    return cleanKugouTrackText(value).toLowerCase().replace(/\s+/g, '');
  }
  function mapKugouTrack(raw) {
    raw = raw || {};
    const trans = raw.trans_param || raw.transParam || {};
    const hash = raw.hash || raw.Hash || raw.file_hash || raw.FileHash || raw.audio_hash ||
      raw['320hash'] || raw['128hash'] || raw.sqhash || raw.SQFileHash || raw.HQFileHash ||
      trans.ogg_320_hash || trans.ogg_128_hash || '';
    const qualityHashes = {
      standard: raw['128hash'] || raw.hash || raw.Hash || raw.file_hash || trans.ogg_128_hash || '',
      exhigh: raw['320hash'] || raw.HQFileHash || trans.ogg_320_hash || raw.hash || raw.Hash || raw.file_hash || '',
      lossless: raw.sqhash || raw.SQFileHash || raw.flac_hash || raw.hash || raw.Hash || raw.file_hash || '',
      hires: raw.hrhash || raw.high_hash || raw.sqhash || raw.SQFileHash || raw.hash || raw.Hash || raw.file_hash || '',
      jymaster: raw.masterhash || raw.jymaster_hash || raw.hrhash || raw.sqhash || raw.SQFileHash || raw.hash || raw.Hash || raw.file_hash || '',
    };
    const albumAudioId = raw.album_audio_id || raw.albumAudioId || raw.audio_id || raw.audioid || raw.Audioid || raw.mixsongid || raw.songid || raw.id || '';
    const filename = cleanKugouTrackText(raw.filename || raw.FileName || '');
    let name = cleanKugouTrackText(raw.songname || raw.song_name || raw.name || raw.title || '');
    let artist = cleanKugouTrackText(raw.singername || raw.singer_name || raw.author_name || raw.singer || raw.artist || '');
    if (!artist && Array.isArray(raw.singerinfo) && raw.singerinfo[0]) {
      artist = raw.singerinfo.map(item => item && cleanKugouTrackText(item.name)).filter(Boolean).join(' / ');
    }
    if (filename) {
      const parts = String(filename).split(' - ');
      if (parts.length >= 2) {
        const filenameArtist = cleanKugouTrackText(parts.shift());
        const titleFromFilename = cleanKugouTrackText(parts.join(' - '));
        artist = artist || filenameArtist;
        if (!name || normalizeSimpleTitleForCompare(name) === normalizeSimpleTitleForCompare(filename)) name = titleFromFilename;
      } else {
        name = name || filename;
      }
    }
    if (name && artist && String(name).includes(' - ')) {
      const parts = String(name).split(' - ');
      const maybeArtist = cleanKugouTrackText(parts.shift());
      const maybeTitle = cleanKugouTrackText(parts.join(' - '));
      if (maybeTitle && normalizeSimpleTitleForCompare(maybeArtist) === normalizeSimpleTitleForCompare(artist)) {
        name = maybeTitle;
      }
    }
    const albumInfo = raw.albuminfo || raw.albumInfo || {};
    const album = raw.album_name || raw.albumname || raw.album || albumInfo.name || '';
    const albumId = raw.album_id || raw.albumid || raw.AlbumID || raw.albumId || '';
    const cover = raw.pic || raw.img || raw.image || raw.cover || raw.sizable_cover || trans.union_cover || '';
    const durationMs = Number(raw.timelength || raw.time_length || raw.timelen || raw.duration || raw.interval) || 0;
    const fsort = Number(raw.fsort || raw.sort || raw.position || raw.pos || 0) || 0;
    return {
      provider: 'kugou',
      source: 'kugou',
      type: 'kugou',
      id: String(hash || albumAudioId || name),
      hash: String(hash || ''),
      qualityHashes,
      albumAudioId: String(albumAudioId || ''),
      albumId: String(albumId || ''),
      name: cleanKugouTrackText(name).replace(/\s*-\s*$/, ''),
      artist: String(artist || ''),
      artists: artist ? [{ name: String(artist) }] : [],
      album: String(album || ''),
      cover: String(cover || '').replace(/\{size\}/g, '300'),
      duration: durationMs * (durationMs > 1000 ? 1 : 1000),
      fee: Number(raw.privilege || raw.media_privilege || raw.media_pay_type || raw.pay_type || 0) || 0,
      fsort,
      position: fsort,
      sort: fsort,
      playable: !!hash,
    };
  }
  function kugouHashForQuality(hash, qualityPreference, qualityHashes) {
    const requested = normalizeQualityPreference(qualityPreference);
    const hashes = qualityHashes && typeof qualityHashes === 'object' ? qualityHashes : {};
    const orderMap = {
      jymaster: ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'],
      hires: ['hires', 'lossless', 'exhigh', 'standard'],
      lossless: ['lossless', 'exhigh', 'standard'],
      exhigh: ['exhigh', 'standard'],
      standard: ['standard'],
    };
    const order = orderMap[requested] || orderMap.hires;
    for (const key of order) {
      const candidate = String(hashes[key] || '').trim();
      if (candidate) return { hash: candidate, level: key };
    }
    return { hash: String(hash || '').trim(), level: requested };
  }
  function sortKugouCloudTracks(rawTracks) {
    return (rawTracks || []).slice().sort((a, b) => {
      const af = Number(a && (a.fsort || a.sort || a.position || a.pos || 0)) || 0;
      const bf = Number(b && (b.fsort || b.sort || b.position || b.pos || 0)) || 0;
      if (af || bf) return af - bf;
      const ac = Number(a && (a.collecttime || a.collect_time || 0)) || 0;
      const bc = Number(b && (b.collecttime || b.collect_time || 0)) || 0;
      return ac - bc;
    });
  }
  async function handleKugouUserPlaylists() {
    const info = await getKugouLoginInfoFresh();
    if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'kugou', playlists: [] };
    const cacheKey = 'playlists:' + info.userId;
    const cached = kugouUserPlaylistsCache.get(cacheKey, KUGOU_USER_PLAYLISTS_TTL_MS);
    if (cached) return cached;
    try {
      const data = await kugouCloudlistRequest('/v7/get_all_list', {
        total_ver: 979,
        type: 2,
        page: 1,
        pagesize: 200,
        userid: info.userId,
        token: kugouCookieToken(),
      }, {
        total_ver: 979,
        type: 2,
        page: 1,
        pagesize: 200,
        userid: Number(info.userId) || info.userId,
        token: kugouCookieToken(),
      });
      const rawLists = asArrayDeep(data, ['lists', 'list', 'info', 'data', 'listinfo', 'collection_list', 'playlist']);
      const nested = data && data.data && typeof data.data === 'object' ? asArrayDeep(data.data, ['lists', 'list', 'info', 'listinfo', 'collection_list', 'playlist']) : [];
      const merged = rawLists.length ? rawLists : nested;
      const seen = new Set();
      const playlists = merged.map(mapKugouPlaylist).filter(pl => {
        if (!pl.id || seen.has(pl.id)) return false;
        seen.add(pl.id);
        return true;
      });
      return kugouUserPlaylistsCache.set(cacheKey, { ...info, loggedIn: true, provider: 'kugou', userId: info.userId, playlists, rawStatus: data && (data.status || data.errcode || data.error_code) });
    } catch (err) {
      const stale = kugouUserPlaylistsCache.get(cacheKey);
      if (stale) {
        console.warn('[KugouUserPlaylists] upstream failed, serving cached list:', err && err.message);
        return { ...stale, stale: true, staleReason: 'upstream-error' };
      }
      throw err;
    }
  }
  async function handleKugouPlaylistTracks(id) {
    let info = getKugouLoginInfo();
    const pid = String(id || '').trim();
    /* 同步登录态可能落后于磁盘上的 cookie（刚启动 / 刚切账号）：
       直接拿它会得到 loggedIn:false + 空曲目，界面就变成「0 首 / 暂无可播放歌曲」。
       所以未登录时补一次带 60s 缓存的 fresh 探测再判，避免把「还没就绪」当成「没歌」。 */
    if (!info.loggedIn) {
      try { info = await getKugouLoginInfoFresh(); } catch (_) {}
    }
    if (!info.loggedIn) {
      return { loggedIn: false, provider: 'kugou', error: 'KUGOU_AUTH_REQUIRED', retryable: true, tracks: [] };
    }
    if (!pid) return { loggedIn: true, provider: 'kugou', error: 'Missing Kugou playlist id', tracks: [] };
    const cacheKey = 'tracks:' + (info.userId || 'anon') + ':' + pid;
    const cached = kugouPlaylistTracksCache.get(cacheKey, KUGOU_PLAYLIST_TRACKS_TTL_MS);
    if (cached) return cached;
    let detail = null;
    let rawTracks = [];
    let upstreamExpected = 0;   // 上游自己报的曲目总数（0 且取到 0 首 = 真的空歌单）
    let upstreamFailed = false; // 主通道挂掉、走了兜底（此时空结果一律视为可疑）
    try {
      const pageSize = 200;
      let page = 1;
      let total = 0;
      do {
        detail = await kugouCloudlistRequest('/v4/get_list_all_file',
          { listid: pid, page, pagesize: pageSize },
          { listid: pid, page, pagesize: pageSize, area_code: 1, show_relate_goods: 0, allplatform: 1, show_cover: 1, type: 0, userid: Number(info.userId) || info.userId, token: kugouCookieToken() });
        if (!detail || Number(detail.status) === 0 || Number(detail.error_code || detail.errcode) > 0) {
          throw new Error('KUGOU_CLOUDLIST_DETAIL_FAILED');
        }
        const pageTracks = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data']);
        rawTracks = rawTracks.concat(pageTracks);
        total = Number(detail && detail.data && (detail.data.count || detail.data.total)) || rawTracks.length;
        upstreamExpected = total;
        if (!pageTracks.length || rawTracks.length >= total) break;
        page++;
      } while (page <= 10);
    } catch (err) {
      /* 后面的页失败不该把前面已经拿到的页丢掉（大歌单最容易在这里翻车）。 */
      if (!rawTracks.length) {
        const stale = kugouPlaylistTracksCache.get(cacheKey);
        if (stale) {
          console.warn('[KugouPlaylistTracks] upstream failed, serving cached tracks:', err && err.message);
          return { ...stale, stale: true, staleReason: 'upstream-error' };
        }
        upstreamFailed = true;
        try {
          detail = await kugouGatewayRequest('/pubsongs/v2/get_other_list_file_nofilt', {
            params: { id: pid, global_collection_id: pid, page: 1, pagesize: 500, area_code: 1, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization' },
            headers: { 'x-router': 'pubsongscdn.kugou.com' },
          });
          rawTracks = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data']);
        } catch (fallbackErr) {
          console.warn('[KugouPlaylistTracks] both paths failed:', err && err.message, fallbackErr && fallbackErr.message);
          /* 两条路都挂：把原始错误抛给路由（500），前端据此显示「重试」而不是「暂无歌曲」。 */
          throw err;
        }
      } else {
        console.warn('[KugouPlaylistTracks] page failed, keeping', rawTracks.length, 'tracks:', err && err.message);
      }
    }
    const tracks = sortKugouCloudTracks(rawTracks).map(mapKugouTrack).filter(s => s.name && (s.hash || s.id));
    const playlistMeta = { provider: 'kugou', id: pid, name: '', trackCount: tracks.length };
    if (!tracks.length) {
      /* 「0 首」有两种来源，界面必须能区分：
         - 上游自己报 count=0 且一首都没给 = 这个歌单真的是空的 → 正常空结果；
         - 上游说有 N 首却解析不出曲目、或主通道挂了走兜底还是空 → 这次没拿到，
           带 retryable 让渲染层给「重试」而不是「暂无可播放歌曲」。
         两种情况都不进缓存：一次抖动不该让用户接下来 90s 反复看到「0 首」。 */
      if (upstreamExpected > 0 || upstreamFailed) {
        return {
          loggedIn: true,
          provider: 'kugou',
          error: 'KUGOU_PLAYLIST_EMPTY',
          retryable: true,
          playlist: playlistMeta,
          tracks: [],
        };
      }
      return { loggedIn: true, provider: 'kugou', playlist: playlistMeta, tracks: [] };
    }
    return kugouPlaylistTracksCache.set(cacheKey, {
      loggedIn: true,
      provider: 'kugou',
      playlist: playlistMeta,
      tracks,
    });
  }
  async function kugouTrackercdnPlayUrl(hash, options) {
    options = options || {};
    const h = String(hash || '').trim().toUpperCase();
    const obj = kugouCookieObject();
    const userId = kugouCookieUserId(obj);
    const token = kugouCookieToken(obj);
    const mid = kugouCookieMid(obj);
    const appid = KUGOU_ID.APPID;
    const params = {
      cmd: '26',
      hash: h,
      behavior: 'play',
      appid,
      pid: '2',
      mid,
      userid: userId || '0',
      version: KUGOU_ID.CLIENTVER,
      vipType: String(options.vipType || kugouCookieVipType(obj) || 0),
      token: token || '0',
      key: kugouMd5(h + KUGOU_PLAY_KEY_SALT + appid + mid + (userId || '0')),
    };
    if (options.albumAudioId) params.album_audio_id = String(options.albumAudioId);
    if (options.albumId) params.album_id = String(options.albumId);
    const u = new URL('/i/v2/', 'https://trackercdn.kugou.com');
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && String(params[k]) !== '') u.searchParams.set(k, String(params[k]));
    });
    const text = await requestText(u.toString(), {
      headers: {
        'User-Agent': KUGOU_ID.ANDROID_UA,
        Cookie: kugouCloudlistCookieHeader(obj),
      },
      /* 取址是「点了播放就得等」的前台路径：CDN 一旦不响应，
         12s + 重试 1 次 = 24s 的静默等待比直接失败更糟。
         短超时 + 超时不重试（见 http-request.js）让用户最多等 6s。 */
      timeoutMs: 6000,
    });
    const cleanText = String(text || '')
      .replace('<!--KG_TAG_RES_START-->', '')
      .replace('<!--KG_TAG_RES_END-->', '')
      .trim();
    kugouPlayDebugLog('[KugouTracker] hash=' + h +
      ' albumAudioId=' + String(options.albumAudioId || '') +
      ' userId=' + String(userId || '0') +
      ' hasToken=' + (token ? '1' : '0') +
      ' vipType=' + String(params.vipType) +
      ' resp=' + String(cleanText || '').slice(0, 500).replace(/\s+/g, ' '));
    return parseJSONText(cleanText);
  }
  function kugouPlayableUrlFromResponse(json) {
    const data = json && (json.data || json);
    const rawUrl = data && (data.play_url || data.play_backup_url || data.url || data.src || data.backup_url);
    const url = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
    const backupUrl = data && (Array.isArray(data.backup_url) ? data.backup_url[0] : data.backup_url);
    return url || backupUrl || '';
  }
  async function getKugouLoginInfoFresh() {
    if (getKugouCookie()) {
      try {
        const apiInfo = await getKugouLoginInfoFromApiCached(getKugouCookie());
        if (apiInfo && apiInfo.loggedIn) {
          return Object.assign({}, apiInfo, {
            playbackKeyReady: apiInfo.playbackReady !== false,
            preview: false,
            message: '已保存酷狗网页登录会话',
          });
        }
        if (apiInfo) return Object.assign({}, getKugouLoginInfo(), apiInfo);
      } catch (err) {
        console.warn('[KugouLoginInfoApi]', err && err.message);
      }
    }
    const info = getKugouLoginInfo();
    if (!info.loggedIn || info.isVip) return info;
    const now = Date.now();
    if (kugouVipProbe.current.userId === info.userId && kugouVipProbe.current.info && now - kugouVipProbe.current.checkedAt < 5 * 60 * 1000) {
      return Object.assign({}, info, kugouVipProbe.current.info);
    }
    try {
      const detail = await kugouCloudlistRequest('/v4/get_list_all_file',
        { listid: '2', page: 1, pagesize: 1 },
        { listid: '2', page: 1, pagesize: 1, area_code: 1, show_relate_goods: 0, allplatform: 1, show_cover: 1, type: 0, userid: Number(info.userId) || info.userId, token: kugouCookieToken() });
      const first = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data'])[0] || {};
      const hash = first.hash || first.Hash || first.file_hash || '';
      const probe = hash ? await kugouTrackercdnPlayUrl(hash, {
        albumId: first.album_id || first.albumid || '',
        albumAudioId: first.album_audio_id || first.audio_id || first.mixsongid || '',
        vipType: 1,
      }) : null;
      const playbackReady = !!kugouPlayableUrlFromResponse(probe);
      const probeInfo = playbackReady ? {
        vipType: Math.max(1, Number(info.vipType || 0)),
        vipLevel: 'vip',
        isVip: true,
        isSvip: false,
        vipLabel: 'Kugou VIP',
        playbackKeyReady: true,
      } : { playbackKeyReady: false };
      kugouVipProbe.current = { userId: info.userId, checkedAt: now, info: probeInfo };
      return Object.assign({}, info, probeInfo);
    } catch (_) {
      kugouVipProbe.current = { userId: info.userId, checkedAt: now, info: { playbackKeyReady: false } };
      return info;
    }
  }
  async function handleKugouSongUrl(hash, albumAudioId, albumId, qualityPreference, qualityHashes) {
    const h = String(hash || '').trim();
    if (!h) return { provider: 'kugou', url: '', playable: false, error: 'Missing Kugou hash' };
    const loginInfo = getKugouLoginInfo();
    const selected = kugouHashForQuality(h, qualityPreference, qualityHashes);
    const json = await kugouTrackercdnPlayUrl(selected.hash || h, { albumAudioId, albumId, vipType: loginInfo.vipType });
    const data = json && (json.data || json);
    const playableUrl = kugouPlayableUrlFromResponse(json);
    const code = json && (json.error_code || json.errcode || json.status);
    /* 酷狗 trackercdn 对「第三方拿不到地址」返回 status:3 + trans_param，
       响应里既没有 url 也没有错误消息（实测：
       {"status":3,"trans_param":{"classmap":{"attr0":...},"display":...}}）。
       四通道 h5/mobile/web/gateway 对同一首会明确回「无版权」。
       这类多见于用户上传 / 二创 / Follow 版本：官方客户端用私有协议能播，
       开放接口不给第三方地址。2026-11-12 真机取证：同歌单另外 8 首全部
       status:1 正常，只有这两首 status:3，且四通道识别账号为 VIP。
       旧实现在「已登录 + 没 url」时一律硬编码 paid_required，
       于是提示「需要会员/购买」并触发登录/VIP 引导 —— 提示是错的，
       还会白跑一轮换源与重管线。改成前端已支持的 copyright_unavailable。 */
    const upstreamMessage = String((json && (json.error || json.errmsg || json.message)) || '').trim();
    const thirdPartyCopyrightBlock = !playableUrl && Number(code) === 3 && !upstreamMessage;
    const restriction = playableUrl ? null : playbackRestriction('kugou',
      thirdPartyCopyrightBlock ? 'copyright_unavailable'
        : (loginInfo.loggedIn ? 'paid_required' : 'login_required'),
      thirdPartyCopyrightBlock
        ? '酷狗未向第三方开放该曲目播放地址（常见于用户上传或二创版本），官方客户端可播；可换用其它平台的同名版本'
        : (loginInfo.loggedIn ? '酷狗没有返回当前账号可播放地址，可能需要会员、购买或官方客户端权限' : '酷狗歌曲需要登录后获取播放地址'),
      thirdPartyCopyrightBlock ? 'switch_source' : (loginInfo.loggedIn ? 'upgrade' : 'login'),
      { code, rawMessage: upstreamMessage });
    return {
      provider: 'kugou',
      url: playableUrl,
      playable: !!playableUrl,
      loggedIn: !!loginInfo.loggedIn,
      vipType: loginInfo.vipType || 0,
      vipLevel: loginInfo.vipLevel || 'none',
      level: selected.level || (data && (data.audio_name || data.quality || data.bitRate || data.bitrate || '')),
      quality: data && (data.fileName || data.songName || data.extName || ''),
      requestedQuality: normalizeQualityPreference(qualityPreference),
      resolvedHash: selected.hash || h,
      trial: false,
      message: playableUrl ? '' : restriction.message,
      reason: playableUrl ? '' : restriction.category,
      restriction,
      kugouCode: code,
    };
  }

  /* 歌单内容变了（加歌/删歌/收藏）时要主动作废，否则用户最长会看到 90s 前的旧列表。 */
  function clearKugouPlaylistCache() {
    kugouUserPlaylistsCache.clear();
    kugouPlaylistTracksCache.clear();
  }

  return {
    handleKugouLoginQrKey,
    kugouRegisterDevice,
    handleKugouLoginQrCheck,
    asArrayDeep,
    mapKugouPlaylist,
    cleanKugouTrackText,
    normalizeSimpleTitleForCompare,
    mapKugouTrack,
    kugouHashForQuality,
    sortKugouCloudTracks,
    handleKugouUserPlaylists,
    handleKugouPlaylistTracks,
    clearKugouPlaylistCache,
    kugouTrackercdnPlayUrl,
    kugouPlayableUrlFromResponse,
    getKugouLoginInfoFresh,
    handleKugouSongUrl,
  };
};
