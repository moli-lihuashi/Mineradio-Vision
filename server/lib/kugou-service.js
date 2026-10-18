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
    return { ...info, loggedIn: true, provider: 'kugou', userId: info.userId, playlists, rawStatus: data && (data.status || data.errcode || data.error_code) };
  }
  async function handleKugouPlaylistTracks(id) {
    const info = getKugouLoginInfo();
    if (!info.loggedIn) return { loggedIn: false, provider: 'kugou', tracks: [] };
    const pid = String(id || '').trim();
    if (!pid) return { loggedIn: true, provider: 'kugou', error: 'Missing Kugou playlist id', tracks: [] };
    let detail = null;
    let rawTracks = [];
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
        if (!pageTracks.length || rawTracks.length >= total) break;
        page++;
      } while (page <= 10);
    } catch (err) {
      detail = await kugouGatewayRequest('/pubsongs/v2/get_other_list_file_nofilt', {
        params: { id: pid, global_collection_id: pid, page: 1, pagesize: 500, area_code: 1, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization' },
        headers: { 'x-router': 'pubsongscdn.kugou.com' },
      });
      rawTracks = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data']);
    }
    const tracks = sortKugouCloudTracks(rawTracks).map(mapKugouTrack).filter(s => s.name && (s.hash || s.id));
    return {
      loggedIn: true,
      provider: 'kugou',
      playlist: { provider: 'kugou', id: pid, name: '', trackCount: tracks.length },
      tracks,
    };
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
    });
    const cleanText = String(text || '')
      .replace('<!--KG_TAG_RES_START-->', '')
      .replace('<!--KG_TAG_RES_END-->', '')
      .trim();
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
        const apiInfo = await getKugouLoginInfoFromApi(getKugouCookie());
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
    const restriction = playableUrl ? null : playbackRestriction('kugou',
      loginInfo.loggedIn ? 'paid_required' : 'login_required',
      loginInfo.loggedIn ? '酷狗没有返回当前账号可播放地址，可能需要会员、购买或官方客户端权限' : '酷狗歌曲需要登录后获取播放地址',
      loginInfo.loggedIn ? 'upgrade' : 'login',
      { code, rawMessage: json && (json.error || json.errmsg || json.message || '') });
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
    kugouTrackercdnPlayUrl,
    kugouPlayableUrlFromResponse,
    getKugouLoginInfoFresh,
    handleKugouSongUrl,
  };
};
