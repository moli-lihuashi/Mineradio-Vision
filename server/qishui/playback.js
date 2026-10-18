'use strict';

// 汽水音乐：播放（歌词 / track_v2 / player / 下载信息 / song-url）。
//
// 第 3 刀从 qishui-api.js 抽出。依赖 account + search（无登录时走公开搜索匹配）+ mapping。

const https = require('https');

const {
  QISHUI_PUBLIC_ENABLED,
  QISHUI_WEB_UA,
} = require('./config');

const {
  normalizeQishuiCookieInput,
  normalizeText,
  qishuiCookieFingerprint,
  qishuiCookieHasLogin,
  qishuiHeadersWithCookie,
  qishuiLyricCache,
  qishuiPcAppParams,
  qishuiPcStatusError,
  qishuiPcUrl,
  qishuiPlaybackCache,
  qishuiTrackMetadataCache,
  qishuiUnavailable,
  qishuiWebCommonParams,
  qishuiWebHeaders,
  requestJson,
  urlWithParams,
} = require('./http');

const {
  cacheQishuiLyric,
  collectQishuiTrackV2Streams,
  extractQishuiLyrics,
  normalizeQishuiH5TrackPayload,
  pickArray,
  pickObject,
  qishuiBestStreamCandidate,
  qishuiBestStreamCandidateForMembership,
  qishuiBitrateForUi,
  qishuiNormalizeDurationSeconds,
  qishuiObjectString,
  qishuiPlaybackLevel,
  qishuiPlaybackMembershipFromPayload,
  qishuiPrimaryTrackFromV2,
  qishuiRestrictionScopeFromPayload,
  qishuiStreamFromObject,
  qishuiTrackPlaybackRestriction,
  qishuiTrackPlayerFromV2,
} = require('./mapping');

const {
  fetchQishuiPlaybackMembership,
} = require('./account');

const {
  fetchQishuiPublicDetail,
  fetchQishuiSeoTrack,
} = require('./search');

async function handleQishuiLyric(id, cookieText) {
  id = normalizeText(id);
  if (!id) return { provider: 'qishui', lyric: '', tlyric: '', source: 'none', error: 'Missing Qishui id' };
  const cached = qishuiLyricCache.get(id);
  if (cached) return cached;
  const errors = [];
  try {
    const seoPayload = await fetchQishuiSeoTrack(id);
    const lyrics = extractQishuiLyrics(seoPayload);
    const cachedSeo = cacheQishuiLyric(id, lyrics.lyric, lyrics.tlyric, 'qishui-beta-seo-track');
    if (cachedSeo) return cachedSeo;
  } catch (err) {
    errors.push('seo:' + (err && err.message || String(err)));
  }
  if (qishuiCookieHasLogin(normalizeQishuiCookieInput(cookieText))) {
    try {
      const trackPayload = await fetchQishuiPcTrackV2Get(id, cookieText);
      const lyrics = extractQishuiLyrics(trackPayload);
      const cachedTrack = cacheQishuiLyric(id, lyrics.lyric, lyrics.tlyric, 'qishui-pc-track-v2');
      if (cachedTrack) return cachedTrack;
    } catch (err) {
      errors.push('track-v2:' + (err && err.message || String(err)));
    }
  }
  if (QISHUI_PUBLIC_ENABLED) {
    try {
      const detail = await fetchQishuiPublicDetail(id);
      const fresh = qishuiLyricCache.get(id);
      if (fresh) return fresh;
      if (detail && (detail.lyric || detail.tlyric)) {
        const cachedPublic = cacheQishuiLyric(id, detail.lyric, detail.tlyric, 'qishui-public-detail');
        if (cachedPublic) return cachedPublic;
      }
    } catch (err) {
      errors.push('public:' + (err && err.message || String(err)));
    }
  }
  return {
    provider: 'qishui',
    lyric: '',
    tlyric: '',
    yrc: '',
    ytlrc: '',
    source: 'none',
    error: errors.join('; '),
  };
}

async function fetchQishuiPcTrackV2Post(trackId, cookieText) {
  const body = JSON.stringify({
    track_id: trackId,
    media_type: 'track',
    queue_type: 'favorite_track_playlist',
    scene_name: 'library',
  });
  const json = await requestJson(qishuiPcUrl('/luna/pc/track_v2', qishuiPcAppParams()), {
    method: 'POST',
    timeoutMs: 10000,
    headers: Object.assign(qishuiWebHeaders(cookieText, { sessionOnly: true, pcApp: true }), {
      'Content-Length': Buffer.byteLength(body),
      'Referer': 'https://www.qishui.com/',
    }),
  }, body);
  const err = qishuiPcStatusError(json, 'QISHUI_PC_TRACK_V2_FAILED');
  if (err) throw err;
  return json;
}

async function fetchQishuiPcTrackV2Get(trackId, cookieText) {
  const json = await requestJson(qishuiPcUrl('/luna/pc/track_v2', qishuiPcAppParams({
    track_id: trackId,
    media_type: 'track',
  })), {
    timeoutMs: 10000,
    headers: Object.assign(qishuiWebHeaders(cookieText, { sessionOnly: true, pcApp: true }), {
      'Referer': 'https://www.qishui.com/',
    }),
  });
  const err = qishuiPcStatusError(json, 'QISHUI_PC_TRACK_V2_GET_FAILED');
  if (err) throw err;
  return json;
}

async function fetchQishuiPcTrackV2(trackId, cookieText) {
  const cookie = normalizeQishuiCookieInput(cookieText);
  const cacheKey = 'track-v2-meta|' + qishuiCookieFingerprint(cookie) + '|' + normalizeText(trackId);
  return qishuiTrackMetadataCache.wrap(cacheKey, 20 * 1000, async () => {
    try {
      return await fetchQishuiPcTrackV2Post(trackId, cookie);
    } catch (postError) {
      try {
        return await fetchQishuiPcTrackV2Get(trackId, cookie);
      } catch (getError) {
        getError.postError = postError && postError.message || String(postError);
        throw getError;
      }
    }
  });
}

const QISHUI_H5_TRACK_BASE = (process.env.QISHUI_H5_API_BASE || 'https://beta-luna.douyin.com').replace(/\/+$/, '');

const QISHUI_H5_TRACK_PATHS = (process.env.QISHUI_H5_TRACK_PATHS || '/luna/h5/track_v2,/luna/h5/seo_track')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

async function fetchQishuiH5TrackV2Once(trackId, apiPath, cookieText) {
  const json = await requestJson(urlWithParams(QISHUI_H5_TRACK_BASE + apiPath, qishuiWebCommonParams({
    track_id: normalizeText(trackId),
  })), {
    timeoutMs: 10000,
    headers: qishuiWebHeaders(cookieText, { sessionOnly: true }),
  });
  const err = qishuiPcStatusError(json, 'QISHUI_H5_TRACK_V2_FAILED');
  if (err) throw err;
  return json;
}

async function fetchQishuiH5TrackV2(trackId, cookieText) {
  const id = normalizeText(trackId);
  if (!id) throw new Error('QISHUI_H5_TRACK_ID_REQUIRED');
  return qishuiTrackMetadataCache.wrap('h5-track|' + id, 20 * 1000, async () => {
    let lastErr = null;
    for (const apiPath of QISHUI_H5_TRACK_PATHS) {
      try {
        const json = normalizeQishuiH5TrackPayload(await fetchQishuiH5TrackV2Once(id, apiPath, cookieText));
        const player = qishuiTrackPlayerFromV2(json, qishuiPrimaryTrackFromV2(json));
        const playerUrl = qishuiObjectString(player, ['url_player_info', 'URLPlayerInfo', 'urlPlayerInfo']);
        if (playerUrl) return json;
        // H5 不认识这首歌时返回 risk_result:0 / status_code:1000091（SEO页面歌曲未知），
        // 没有 url_player_info，换下一条候选。
        lastErr = new Error('QISHUI_H5_NO_PLAYER_INFO');
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('QISHUI_H5_TRACK_UNAVAILABLE');
  });
}

async function fetchQishuiPlayerInfo(playerInfoUrl, cookieText, membership) {
  playerInfoUrl = normalizeText(playerInfoUrl);
  if (!/^https?:\/\//i.test(playerInfoUrl)) return null;
  const json = await requestJson(playerInfoUrl, {
    timeoutMs: 10000,
    headers: qishuiHeadersWithCookie({
      'Accept': 'application/json,text/plain,*/*',
      'User-Agent': QISHUI_WEB_UA,
      'Referer': 'https://api.qishui.com/',
    }, cookieText),
  });
  const result = pickObject(json && json.Result, json && json.result);
  const data = pickObject(result.Data, result.data, json && json.Data, json && json.data);
  const list = pickArray(data.PlayInfoList, data.playInfoList, data.play_info_list, json && json.PlayInfoList);
  const streams = list.map(item => qishuiStreamFromObject(item)).filter(Boolean);
  const best = qishuiBestStreamCandidateForMembership(streams, membership);
  if (best) return best;
  const error = pickObject(json && json.ResponseMetadata && json.ResponseMetadata.Error, json && json.responseMetadata && json.responseMetadata.error);
  if (error && (error.Message || error.message)) throw new Error(normalizeText(error.Message || error.message));
  return null;
}

async function resolveQishuiDownloadInfo(trackId, payload, cookieText, membership) {
  const collected = collectQishuiTrackV2Streams(payload);
  const playerInfoUrl = qishuiObjectString(collected.player, ['url_player_info', 'URLPlayerInfo', 'urlPlayerInfo']);
  if (playerInfoUrl) {
    try {
      const stream = await fetchQishuiPlayerInfo(playerInfoUrl, cookieText, membership);
      if (stream) collected.streams.push(stream);
    } catch (err) {
      collected.playerInfoError = err && err.message || String(err);
    }
  }
  const best = qishuiBestStreamCandidateForMembership(collected.streams, membership) ||
    qishuiBestStreamCandidateForMembership(collected.fallbackStreams, membership);
  if (!best) {
    const unrestricted = qishuiBestStreamCandidate(collected.streams) ||
      qishuiBestStreamCandidate(collected.fallbackStreams);
    const entitlementLimited = !!(unrestricted && !(membership && membership.isVip));
    const err = new Error(entitlementLimited
      ? 'QISHUI_STANDARD_AUDIO_SOURCE_EMPTY'
      : (collected.playerInfoError || 'QISHUI_AUDIO_SOURCE_EMPTY'));
    err.code = entitlementLimited ? 'QISHUI_STANDARD_AUDIO_SOURCE_EMPTY' : 'QISHUI_AUDIO_SOURCE_EMPTY';
    throw err;
  }
  return Object.assign(collected, { best });
}

function qishuiUrlWithAuth(url, auth) {
  url = normalizeText(url);
  auth = normalizeText(auth);
  if (!url || !auth || /#auth=/.test(url)) return url;
  return url + '#auth=' + encodeURIComponent(auth);
}

async function handleQishuiSongUrl(opts, cookieText) {
  opts = opts && typeof opts === 'object' ? opts : { id: opts };
  const id = normalizeText(opts.id || opts.trackId || opts.track_id || '');
  const cookie = normalizeQishuiCookieInput(cookieText || opts.cookie || '');
  if (!id) return qishuiUnavailable('Missing Qishui track id', 'missing_id', { loggedIn: qishuiCookieHasLogin(cookie), playbackKeyReady: false });
  if (!qishuiCookieHasLogin(cookie)) {
    return qishuiUnavailable('Qishui playback requires the local SodaMusic PC login state.', 'login_required', {
      loggedIn: false,
      playbackKeyReady: false,
    });
  }
  const requestedQuality = normalizeText(opts.quality || '');
  let payload;
  let payloadSource = 'qishui-pc-track-v2';
  try {
    payload = await fetchQishuiPcTrackV2(id, cookie);
  } catch (pcTrackError) {
    // PC 端点被风控挖空响应体时走 H5 回退链（详见 fetchQishuiH5TrackV2 上方注释）。
    // PC 端点恢复后这里会自动回到原链路，不需要人工干预。
    try {
      payload = await fetchQishuiH5TrackV2(id, cookie);
      payloadSource = 'qishui-h5-track-v2';
    } catch (h5Error) {
      const rawError = 'h5: ' + (h5Error && h5Error.message || String(h5Error)) +
        ' | pc: ' + (pcTrackError && pcTrackError.message || String(pcTrackError));
      return qishuiUnavailable('Qishui did not return track playback metadata: ' + rawError, 'source_unavailable', {
        loggedIn: true,
        playbackKeyReady: false,
        membershipKnown: false,
        vipType: 0,
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        vipLabel: '无VIP',
        rawError,
      });
    }
  }
  let membership = qishuiPlaybackMembershipFromPayload(payload);
  if (!membership.membershipKnown) membership = await fetchQishuiPlaybackMembership(cookie);
  const membershipKey = membership.isSvip
    ? 'svip'
    : (membership.isVip ? 'vip' : (membership.membershipKnown ? 'free' : 'unknown'));
  const cacheKey = 'track-v2|' + qishuiCookieFingerprint(cookie) + '|' + membershipKey + '|' + id + '|' + requestedQuality;
  return qishuiPlaybackCache.wrap(cacheKey, 4 * 60 * 1000, async () => {
    try {
      const trackRestriction = qishuiTrackPlaybackRestriction(qishuiRestrictionScopeFromPayload(payload));
      const requestRestriction = qishuiTrackPlaybackRestriction(opts);
      if ((trackRestriction.vipRequired || requestRestriction.vipRequired) && !membership.isVip) {
        return qishuiUnavailable('汽水音乐歌曲需要会员权限，当前账号未取得可验证的会员权益。', 'vip_required', {
          loggedIn: true,
          playbackKeyReady: true,
          vipRequired: true,
          membershipKnown: !!membership.membershipKnown,
          vipType: membership.vipType || 0,
          vipLevel: membership.vipLevel || 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
          entitlementEvidence: trackRestriction.evidence.concat(requestRestriction.evidence),
        });
      }
      const resolved = await resolveQishuiDownloadInfo(id, payload, cookie, membership);
      const track = resolved.track || {};
      const stream = resolved.best;
      const duration = stream.duration || qishuiNormalizeDurationSeconds(track.duration_ms || track.duration || 0);
      const level = qishuiPlaybackLevel(stream.quality, stream.format, stream.bitrate);
      const fullDuration = qishuiNormalizeDurationSeconds(track.duration_ms || track.duration || 0);
      const trial = !!(duration > 0 && fullDuration > 0 && duration + 5 < fullDuration);
      return {
        provider: 'qishui',
        playbackMode: 'direct-url',
        url: qishuiUrlWithAuth(stream.url, stream.auth),
        playable: true,
        trial,
        loggedIn: true,
        playbackKeyReady: true,
        membershipKnown: !!membership.membershipKnown,
        vipType: membership.vipType || 0,
        vipLevel: membership.vipLevel || 'none',
        isVip: !!membership.isVip,
        isSvip: !!membership.isSvip,
        vipLabel: membership.vipLabel || (membership.isVip ? 'VIP' : '无VIP'),
        level,
        quality: normalizeText(stream.quality || stream.format || level),
        br: qishuiBitrateForUi(stream.bitrate),
        size: Number(stream.size) || 0,
        duration,
        requestedQuality,
        source: payloadSource,
        encrypted: !!stream.auth,
      };
    } catch (err) {
      const standardOnly = !!(err && err.code === 'QISHUI_STANDARD_AUDIO_SOURCE_EMPTY');
      return qishuiUnavailable(
        standardOnly
          ? '汽水音乐没有为当前普通或未知会员状态返回标准音质的可播放地址。'
          : 'Qishui did not return a playable audio source: ' + (err && err.message || String(err)),
        standardOnly ? 'quality_unavailable' : 'source_unavailable', {
        loggedIn: true,
        playbackKeyReady: true,
        membershipKnown: !!membership.membershipKnown,
        vipType: membership.vipType || 0,
        vipLevel: membership.vipLevel || 'none',
        isVip: !!membership.isVip,
        isSvip: !!membership.isSvip,
        vipLabel: membership.vipLabel || (membership.isVip ? 'VIP' : '无VIP'),
        rawError: err && err.message || String(err),
      });
    }
  });
}

module.exports = {
  handleQishuiLyric,
  fetchQishuiPcTrackV2Post,
  fetchQishuiPcTrackV2Get,
  fetchQishuiPcTrackV2,
  QISHUI_H5_TRACK_BASE,
  QISHUI_H5_TRACK_PATHS,
  fetchQishuiH5TrackV2Once,
  fetchQishuiH5TrackV2,
  fetchQishuiPlayerInfo,
  resolveQishuiDownloadInfo,
  qishuiUrlWithAuth,
  handleQishuiSongUrl,
};
