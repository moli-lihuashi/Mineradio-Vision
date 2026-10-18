'use strict';

// 酷狗：推荐。
//
// 第 2 刀从 kugou-api.js 抽出。FM、每日推荐、以及「猜你喜欢」——
// 后者会聚合用户歌单当种子，所以依赖 account + favorite 两个底座。

const {
  kugouDebug,
} = require('./config');

const {
  extractKugouAuth,
  kugouGatewayRequest,
} = require('./http');

const {
  extractKugouGuessSongList,
  mapKugouPlaylistTrack,
} = require('./mapping');

const {
  handleKugouUserPlaylists,
} = require('./account');

const {
  handleKugouPlaylistTracks,
} = require('./favorite');

// 9.18: 接入酷狗真推荐接口
// Tier 1 — 私人FM /v1/class_fm_song (基于听歌历史的真推荐算法)
// Tier 2 — 每日推荐 /everyday_song_recommend
// Tier 3 — 用户歌单聚合保底 (非真推荐，仅 fallback)
async function fetchKugouFmRecommendations(cookie, auth, limit) {
  // /v2/personal_recommend 是酷狗私人FM真推荐 (基于听歌历史)
  // KuGouMusicApi personal_fm.js: POST, encryptType=android, x-router=persnfm.service.kugou.com
  // 不需要显式 body，仅靠 gateway 自动注入的 query params + 签名
  kugouDebug('[KugouFM] userid=%s mid=%s token=%s',
    auth.userid, auth.mid, auth.token ? auth.token.slice(0, 8) + '...' : '(empty)');
  let json;
  try {
    json = await kugouGatewayRequest('/v2/personal_recommend', {
      method: 'POST',
      cookie,
      router: 'persnfm.service.kugou.com',
    });
  } catch (e) {
    // kugouGatewayRequest 对 status===0 抛异常，但 err.body 可能仍含歌曲数据
    if (e && e.body) {
      json = e.body;
      kugouDebug('[KugouFM] gateway threw (status=%s err_code=%s), using err.body', json.status, json.err_code);
    } else {
      console.warn('[KugouFM] gateway threw non-body error:', e.message);
      throw e;
    }
  }
  kugouDebug('[KugouFM] raw response keys:', json ? Object.keys(json).join(',') : '(null)');
  kugouDebug('[KugouFM] status=%s err_code=%s data type=%s',
    json && json.status, json && json.err_code, json && json.data ? (Array.isArray(json.data) ? 'array(' + json.data.length + ')' : typeof json.data) : '(missing)');
  if (json && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    kugouDebug('[KugouFM] data keys:', Object.keys(json.data).join(',').slice(0, 300));
  }
  var rawList = extractKugouGuessSongList(json);
  kugouDebug('[KugouFM] extracted rawList length:', rawList.length);
  if (rawList.length && rawList[0]) {
    kugouDebug('[KugouFM] first raw item keys:', Object.keys(rawList[0]).join(',').slice(0, 200));
  }
  var songs = rawList.slice(0, limit).map(function (item) {
    return mapKugouPlaylistTrack(item);
  }).filter(function (s) {
    return s && s.name && (s.hash || s.id);
  });
  kugouDebug('[KugouFM] mapped songs:', songs.length, songs.length ? 'first=' + songs[0].name : '');
  return songs;
}

async function fetchKugouDailyRecommendations(cookie, auth, limit) {
  let json;
  try {
    json = await kugouGatewayRequest('/everyday_song_recommend', {
      method: 'POST',
      cookie,
      router: 'everydayrec.service.kugou.com',
      params: { platform: 'ios' },
    });
  } catch (e) {
    if (e && e.body) {
      json = e.body;
      kugouDebug('[KugouDaily] gateway threw (status=%s err_code=%s), using err.body', json.status, json.err_code);
    } else {
      console.warn('[KugouDaily] gateway threw non-body error:', e.message);
      throw e;
    }
  }
  kugouDebug('[KugouDaily] raw response keys:', json ? Object.keys(json).join(',') : '(null)');
  kugouDebug('[KugouDaily] status=%s err_code=%s data type=%s',
    json && json.status, json && json.err_code, json && json.data ? (Array.isArray(json.data) ? 'array(' + json.data.length + ')' : typeof json.data) : '(missing)');
  var rawList = extractKugouGuessSongList(json);
  kugouDebug('[KugouDaily] extracted rawList length:', rawList.length);
  if (rawList.length && rawList[0]) {
    kugouDebug('[KugouDaily] first raw item keys:', Object.keys(rawList[0]).join(',').slice(0, 200));
  }
  var songs = rawList.slice(0, limit).map(function (item) {
    return mapKugouPlaylistTrack(item);
  }).filter(function (s) {
    return s && s.name && (s.hash || s.id);
  });
  kugouDebug('[KugouDaily] mapped songs:', songs.length, songs.length ? 'first=' + songs[0].name : '');
  return songs;
}

async function aggregateKugouPlaylistSongs(cookie, limit) {
  const plRes = await handleKugouUserPlaylists(cookie);
  const playlists = (plRes && plRes.playlists) || [];
  if (!playlists.length) return [];
  const collected = [];
  const wantPerList = Math.ceil(limit / Math.min(3, playlists.length)) + 2;
  for (let i = 0; i < Math.min(playlists.length, 3); i++) {
    try {
      const tr = await handleKugouPlaylistTracks(playlists[i].id, cookie, { limit: wantPerList });
      const tracks = (tr && tr.tracks) || [];
      for (let j = 0; j < tracks.length; j++) {
        const t = tracks[j];
        if (t && t.name && (t.hash || t.id)) collected.push(t);
      }
    } catch (e) { console.warn('[KugouGuessLike] playlist', i, 'err:', e.message); }
    if (collected.length >= limit * 2) break;
  }
  const seen = new Set();
  const dedup = [];
  for (let k = 0; k < collected.length; k++) {
    const key = collected[k].hash || collected[k].id;
    if (key && !seen.has(key)) { seen.add(key); dedup.push(collected[k]); }
  }
  for (let m = dedup.length - 1; m > 0; m--) {
    const r = Math.floor(Math.random() * (m + 1));
    const tmp = dedup[m]; dedup[m] = dedup[r]; dedup[r] = tmp;
  }
  kugouDebug('[KugouGuessLike] playlist fallback songs:', dedup.length);
  return dedup.slice(0, limit);
}

async function handleKugouGuessLike(cookie, limit) {
  limit = Math.max(1, Math.min(Number(limit) || 12, 20));
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return { provider: 'kugou', loggedIn: false, songs: [], error: 'KUGOU_AUTH_REQUIRED' };
  }
  // Tier 1: 私人FM 真推荐 (基于听歌历史)
  try {
    const fmSongs = await fetchKugouFmRecommendations(cookie, auth, limit);
    if (fmSongs.length) {
      return { provider: 'kugou', loggedIn: true, songs: fmSongs, source: 'kugou-fm', updatedAt: Date.now() };
    }
  } catch (e) { console.warn('[KugouGuessLike] fm failed:', e.message); }
  // Tier 2: 每日推荐
  try {
    const dailySongs = await fetchKugouDailyRecommendations(cookie, auth, limit);
    if (dailySongs.length) {
      return { provider: 'kugou', loggedIn: true, songs: dailySongs, source: 'kugou-daily', updatedAt: Date.now() };
    }
  } catch (e) { console.warn('[KugouGuessLike] daily failed:', e.message); }
  // Tier 3: 用户歌单聚合保底
  try {
    const plSongs = await aggregateKugouPlaylistSongs(cookie, limit);
    if (plSongs.length) {
      return { provider: 'kugou', loggedIn: true, songs: plSongs, source: 'kugou-playlist-fallback', updatedAt: Date.now() };
    }
  } catch (e) { console.warn('[KugouGuessLike] playlist fallback failed:', e.message); }
  return { provider: 'kugou', loggedIn: true, songs: [], error: 'KUGOU_GUESS_EMPTY', updatedAt: Date.now() };
}

module.exports = {
  fetchKugouFmRecommendations,
  fetchKugouDailyRecommendations,
  aggregateKugouPlaylistSongs,
  handleKugouGuessLike,
};
