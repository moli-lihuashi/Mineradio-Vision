'use strict';

// 酷狗：取址（四条通道）。
//
// 第 2 刀从 kugou-api.js 抽出。mobile / web / h5 / gateway 四条通道按顺序降级，
// 外加「一首歌可能对应多个 hash」的候选展开与播放态附加。
// 依赖 account（会员判定决定能不能拿 hires）。

const {
  KUGOU_APPID,
  KUGOU_CLIENTVER,
  KUGOU_GATEWAY,
  KUGOU_GATEWAY_UA,
  KUGOU_H5_UA,
  KUGOU_HEADERS,
  KUGOU_PLAY_MOBILE,
  KUGOU_PLAY_WEB,
  KUGOU_QUALITY_CHAIN,
  KUGOU_WEB_APPID,
  kugouDebug,
} = require('./config');

const {
  buildKugouH5Params,
  buildKugouRequestCookie,
  extractKugouAuth,
  kugouCloudKey,
  kugouSongUrlCache,
  requestJson,
  signKey,
  signatureH5Params,
} = require('./http');

const {
  kugouPlaybackCacheScope,
  kugouPlaybackParamsRequireVip,
  kugouQualityFromParam,
  kugouQualityParam,
  normalizeKugouVipPayloadV2,
  normalizeQualityPreference,
  pickKugouPlayUrl,
  resolveKugouAlbumAudioId,
} = require('./mapping');

const {
  fetchKugouVipInfo,
} = require('./account');

async function kugouPlayViaMobile(hash, albumId, cookie, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  const key = kugouCloudKey(hash);
  const u = new URL(KUGOU_PLAY_MOBILE);
  u.searchParams.set('cmd', 'playInfo');
  u.searchParams.set('hash', hash);
  u.searchParams.set('key', key);
  u.searchParams.set('album_id', albumId || '0');
  u.searchParams.set('pid', '1');
  u.searchParams.set('forceDown', '0');
  u.searchParams.set('vip', membership.isVip ? '1' : '65530');
  if (auth.userid) u.searchParams.set('userid', auth.userid);
  if (auth.token) u.searchParams.set('token', auth.token);
  const json = await requestJson(u.toString(), {
    headers: { ...KUGOU_HEADERS, Referer: 'https://m.kugou.com/', Cookie: buildKugouRequestCookie(cookie) },
  });
  const url = json && (json.url || json.backup_url);
  if (json && Number(json.status) === 1 && url) {
    return { url: String(url).trim(), level: 'standard', quality: '标准', trial: false, source: 'mobile' };
  }
  const err = json && (json.error || json.errmsg || '');
  if (/付费|会员|vip/i.test(String(err))) {
    return { restricted: true, category: 'vip_required', message: '酷狗歌曲需要会员或付费权限', error: err };
  }
  if (err) return { restricted: true, category: 'url_unavailable', message: err || '酷狗未返回播放地址', error: err };
  return { restricted: true, category: 'url_unavailable', message: '酷狗未返回播放地址' };
}

async function kugouPlayViaWeb(hash, albumId, albumAudioId, cookie) {
  const auth = extractKugouAuth(cookie);
  const u = new URL(KUGOU_PLAY_WEB);
  u.searchParams.set('r', 'play/getdata');
  u.searchParams.set('hash', hash);
  u.searchParams.set('album_id', albumId || '0');
  if (albumAudioId) u.searchParams.set('album_audio_id', albumAudioId);
  u.searchParams.set('appid', String(KUGOU_WEB_APPID));
  u.searchParams.set('platid', '4');
  u.searchParams.set('mid', auth.mid);
  u.searchParams.set('dfid', auth.dfid || '-');
  u.searchParams.set('userid', auth.userid || '0');
  u.searchParams.set('token', auth.token || '');
  const json = await requestJson(u.toString(), {
    headers: { ...KUGOU_HEADERS, Cookie: buildKugouRequestCookie(cookie) },
  });
  const data = json && json.data;
  const url = data && (data.play_url || data.play_backup_url);
  if (json && Number(json.status) === 1 && url) {
    const bitrate = Number(data.bitrate) || 0;
    const level = bitrate >= 900 ? 'lossless' : (bitrate >= 300 ? 'exhigh' : 'standard');
    return { url: String(url).replace(/\\\//g, '/').trim(), level, quality: data.quality || level, trial: false, source: 'web' };
  }
  const errMsg = String((json && (json.error || json.msg || (data && data.msg))) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要登录会员后播放', error: errMsg };
  }
  return null;
}

async function kugouPlayViaH5(hash, albumId, albumAudioId, cookie, requestedQuality, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  if (!auth.playbackReady) return null;
  const quality = kugouQualityParam(requestedQuality);
  const fileHash = String(hash || '').toLowerCase();
  const params = buildKugouH5Params(auth, {
    album_id: Number(albumId || 0),
    area_code: 1,
    hash: fileHash,
    ssa_flag: 'is_fromtrack',
    version: 11430,
    quality,
    album_audio_id: Number(albumAudioId || 0),
    behavior: 'play',
    pid: 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: membership.isVip ? 0 : 1,
    cdnBackup: 1,
    module: '',
  });
  params.key = signKey(fileHash, auth.mid, auth.userid, KUGOU_WEB_APPID);
  params.signature = signatureH5Params(params, null);
  const u = new URL('/v5/url', KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const json = await requestJson(u.toString(), {
    headers: {
      ...KUGOU_HEADERS,
      'User-Agent': KUGOU_H5_UA,
      'x-router': 'trackercdn.kugou.com',
      Cookie: buildKugouRequestCookie(cookie),
    },
  });
  const url = pickKugouPlayUrl(json);
  if (json && Number(json.status) === 1 && url) {
    const level = kugouQualityFromParam(quality, requestedQuality);
    return { url, level, quality: level, trial: false, source: 'h5' };
  }
  const errMsg = String((json && (json.error || json.msg)) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要会员权限', error: errMsg };
  }
  return null;
}

async function kugouPlayViaGateway(hash, albumId, albumAudioId, cookie, requestedQuality, membership) {
  const auth = extractKugouAuth(cookie);
  membership = membership || normalizeKugouVipPayloadV2(null, auth);
  if (!auth.playbackReady) return null;
  const quality = kugouQualityParam(requestedQuality);
  const clienttime = Math.floor(Date.now() / 1000);
  const params = {
    dfid: auth.dfid || '-',
    mid: auth.mid,
    uuid: '-',
    appid: KUGOU_APPID,
    clientver: KUGOU_CLIENTVER,
    clienttime,
    token: auth.token,
    userid: auth.userid,
    album_id: Number(albumId || 0),
    area_code: 1,
    hash: String(hash || '').toLowerCase(),
    ssa_flag: 'is_fromtrack',
    version: 11430,
    quality,
    album_audio_id: Number(albumAudioId || 0),
    behavior: 'play',
    pid: 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: membership.isVip ? 0 : 1,
    cdnBackup: 1,
    module: '',
  };
  params.key = signKey(params.hash, auth.mid, auth.userid, KUGOU_APPID);
  const u = new URL('/v5/url', KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const json = await requestJson(u.toString(), {
    headers: {
      ...KUGOU_HEADERS,
      'User-Agent': KUGOU_GATEWAY_UA,
      dfid: auth.dfid || '-',
      mid: auth.mid,
      clienttime: String(clienttime),
      'x-router': 'trackercdn.kugou.com',
      Cookie: buildKugouRequestCookie(cookie),
    },
  });
  const data = json && (json.data || json);
  const url = data && (data.url || data.play_url || data.play_backup_url || (Array.isArray(data.url) && data.url[0]));
  if (url) {
    const level = kugouQualityFromParam(quality, requestedQuality);
    return { url: String(url).replace(/\\\//g, '/').trim(), level, quality: level, trial: false, source: 'gateway' };
  }
  const errMsg = String((json && (json.error || json.msg)) || '');
  if (/付费|会员|vip|登录/i.test(errMsg)) {
    return { restricted: true, category: auth.playbackReady ? 'vip_required' : 'login_required', message: errMsg || '酷狗歌曲需要会员权限', error: errMsg };
  }
  return null;
}

function hashCandidatesFromSong(song, requestedQuality) {
  song = song || {};
  const requested = normalizeQualityPreference(requestedQuality);
  const startIdx = Math.max(0, KUGOU_QUALITY_CHAIN.findIndex(item => item.key === requested));
  const chain = KUGOU_QUALITY_CHAIN.slice(startIdx);
  const out = [];
  const seen = new Set();
  chain.forEach(item => {
    const hash = song[item.field] || (item.field === 'FileHash' ? song.hash : '');
    if (!hash || seen.has(hash)) return;
    seen.add(hash);
    out.push({ hash, level: item.key, label: item.label });
  });
  if (song.hash && !seen.has(song.hash)) out.push({ hash: song.hash, level: 'standard', label: '标准' });
  return out;
}

function attachKugouPlaybackStatus(payload, cookie, auth, membership) {
  auth = auth || extractKugouAuth(cookie);
  const vip = membership || normalizeKugouVipPayloadV2(null, auth);
  return Object.assign({}, payload, {
    loggedIn: auth.loggedIn,
    playbackReady: auth.playbackReady,
    vipType: vip.vipType,
    svipType: vip.svipType,
    vipLevel: vip.vipLevel,
    isVip: vip.isVip,
    isSvip: vip.isSvip,
    vipLabel: vip.isSvip ? 'SVIP' : (vip.isVip ? 'VIP' : 'No VIP'),
    membershipVerified: !!vip.membershipVerified,
    membershipSource: vip.membershipSource || 'none',
  });
}

async function handleKugouSongUrl(params, cookie) {
  params = params || {};
  const auth = extractKugouAuth(cookie);
  const hash = String(params.hash || params.fileHash || params.id || '').trim();
  const albumId = String(params.albumId || params.album_id || '').trim();
  const albumAudioId = resolveKugouAlbumAudioId(params);
  const requestedQuality = normalizeQualityPreference(params.quality);
  if (!hash) {
    return { provider: 'kugou', url: '', playable: false, error: 'MISSING_HASH', message: '缺少酷狗歌曲 hash' };
  }
  const vipProbe = auth.playbackReady ? await fetchKugouVipInfo(cookie, auth).catch(() => null) : null;
  const membership = normalizeKugouVipPayloadV2(vipProbe, auth);
  const memberTrack = kugouPlaybackParamsRequireVip(params);
  if (memberTrack && !membership.isVip) {
    const category = auth.playbackReady ? 'vip_required' : 'login_required';
    const message = auth.playbackReady ? '该酷狗歌曲需要有效会员或已购买权限' : '该酷狗歌曲需要先登录并验证播放权益';
    return attachKugouPlaybackStatus({
      provider: 'kugou',
      url: '',
      playable: false,
      reason: category,
      message,
      restriction: { category, message },
      requestedQuality,
      hash,
    }, cookie, auth, membership);
  }
  const effectiveQuality = membership.isVip ? requestedQuality : 'standard';
  const cacheKey = [
    kugouPlaybackCacheScope(auth, membership),
    hash.toLowerCase(),
    albumId,
    albumAudioId,
    effectiveQuality,
  ].join(':');
  const cached = kugouSongUrlCache.get(cacheKey);
  if (cached) {
    return attachKugouPlaybackStatus(cached, cookie, auth, membership);
  }
  kugouDebug('[KugouSongUrl] hash:', hash, 'album:', albumId, 'mix:', albumAudioId, 'auth:', auth.playbackReady ? 'ready' : 'guest', 'tier:', membership.vipLevel);

  const candidates = hashCandidatesFromSong({
    FileHash: hash,
    HQFileHash: params.hqHash || params.hq_hash || '',
    SQFileHash: params.sqHash || params.sq_hash || '',
    ResFileHash: params.resHash || params.res_hash || '',
  }, effectiveQuality);
  if (!candidates.length) candidates.push({ hash, level: 'standard', label: '标准' });

  function rememberKugouSongUrl(payload) {
    if (!payload || !payload.url) return null;
    const resolvedLevel = normalizeQualityPreference(payload.level || payload.__candidate && payload.__candidate.level || 'standard');
    if (!membership.isVip && resolvedLevel !== 'standard') return null;
    payload = Object.assign({}, payload, {
      requestedQuality,
      effectiveQuality,
      qualityDowngraded: requestedQuality !== effectiveQuality,
    });
    if (payload) delete payload.__candidate;
    kugouSongUrlCache.set(cacheKey, payload);
    return attachKugouPlaybackStatus(payload, cookie, auth, membership);
  }

  let lastRestriction = null;
  for (const item of candidates) {
    const h5 = await kugouPlayViaH5(item.hash, albumId, albumAudioId, cookie, item.level || effectiveQuality, membership);
    if (h5 && h5.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: h5.url,
        playable: true,
        trial: false,
        level: h5.level || item.level,
        quality: h5.quality || item.label,
        requestedQuality,
        hash: item.hash,
        __candidate: item,
      });
      if (accepted) return accepted;
      lastRestriction = { category: 'vip_required', message: '普通账号不能使用酷狗高级音质' };
    }
    if (h5 && h5.restricted) lastRestriction = h5;

    const mobile = await kugouPlayViaMobile(item.hash, albumId, cookie, membership);
    if (mobile && mobile.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: mobile.url,
        playable: true,
        trial: false,
        level: item.level,
        quality: item.label,
        requestedQuality,
        hash: item.hash,
        __candidate: item,
      });
      if (accepted) return accepted;
      lastRestriction = { category: 'vip_required', message: '普通账号不能使用酷狗高级音质' };
    }
    if (mobile && mobile.restricted) lastRestriction = mobile;

    const web = await kugouPlayViaWeb(item.hash, albumId, albumAudioId, cookie);
    if (web && web.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: web.url,
        playable: true,
        trial: false,
        level: web.level || item.level,
        quality: web.quality || item.label,
        requestedQuality,
        hash: item.hash,
        __candidate: item,
      });
      if (accepted) return accepted;
      lastRestriction = { category: 'vip_required', message: '普通账号不能使用酷狗高级音质' };
    }
    if (web && web.restricted) lastRestriction = web;

    const gateway = await kugouPlayViaGateway(item.hash, albumId, albumAudioId, cookie, effectiveQuality, membership);
    if (gateway && gateway.url) {
      const accepted = rememberKugouSongUrl({
        provider: 'kugou',
        url: gateway.url,
        playable: true,
        trial: false,
        level: gateway.level || item.level,
        quality: gateway.quality || item.label,
        requestedQuality,
        hash: item.hash,
        __candidate: item,
      });
      if (accepted) return accepted;
      lastRestriction = { category: 'vip_required', message: '普通账号不能使用酷狗高级音质' };
    }
    if (gateway && gateway.restricted) lastRestriction = gateway;
  }

  const restriction = lastRestriction || {
    category: auth.playbackReady ? 'vip_required' : 'login_required',
    message: auth.playbackReady ? '酷狗歌曲需要会员或付费权限' : '酷狗歌曲需要登录后再播放，请重新打开官方登录窗口',
  };
  return attachKugouPlaybackStatus({
    provider: 'kugou',
    url: '',
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction: { category: restriction.category, message: restriction.message },
    requestedQuality,
    effectiveQuality,
    qualityDowngraded: requestedQuality !== effectiveQuality,
    hash,
  }, cookie, auth, membership);
}

module.exports = {
  kugouPlayViaMobile,
  kugouPlayViaWeb,
  kugouPlayViaH5,
  kugouPlayViaGateway,
  hashCandidatesFromSong,
  attachKugouPlaybackStatus,
  handleKugouSongUrl,
};
