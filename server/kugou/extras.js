'use strict';

// ====================================================================
//  酷狗音乐增补能力（2026-11-12 批次3）
//
//  协议来源（一手，非推断）：
//   · Folia 仓库 docs/ku-go-api-docs.md（KuGouMusicApi 的接口清单）
//   · github.com/MakcRe/KuGouMusicApi 的 module/*.js（网关路径与参数）
//   · .workbuddy/harness/probe-kugou-protocol.js 的匿名实测：
//     mobilecdn.kugou.com 公开移动端接口返回 status:1 / errcode:0 + 真实数据。
//
//  两类通道：
//   A. 公开移动端 JSON（专辑 / 歌手 / 分类搜索 / 推荐卡片）——匿名、已在线验证真实数据。
//   B. 已验收网关通道（历史日推 / FM 不喜欢 / 歌单移除）——与项目现有
//      fetchKugouFmRecommendations、handleKugouRemoveSongFromList 同 path 同 x-router，
//      需要登录 cookie；合成正例验证参数与映射，未做账号在线实测。
//
//  明确不接（不写空壳）：
//   · 用户云盘 / 听歌排行 / 取消收藏歌单：KuGouMusicApi 走 playlistAesEncrypt +
//     rsaEncrypt2 加密链路（mcloudservice / listenservice / v2/delete_list），
//     本项目没有等价实现，也没有账号可验证加解密是否生效。
//   · 收藏专辑：一手文档与源码没有对应接口。
//
//  依赖注入：生产走项目既有模块；测试通过 ctx 注入合成上游，无需改 require.cache。
// ====================================================================

const defaultHttpRequest = require('../lib/http-request');
const defaultKugouHttp = require('./http');
const defaultKugouMapping = require('./mapping');
const defaultKugouFavorite = require('./favorite');

const MOBILE_BASE = 'http://mobilecdn.kugou.com/api/v3/';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const ROUTER_EVERYDAY = 'everydayrec.service.kugou.com';
const ROUTER_PERSONAL_FM = 'persnfm.service.kugou.com';

function asArray(v) { return Array.isArray(v) ? v : []; }
function text(v) { return String(v == null ? '' : v).trim(); }
function intInRange(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

module.exports = function createKugouExtras(ctx) {
  ctx = ctx || {};
  const requestText = ctx.kugouPublicRequestText || defaultHttpRequest.requestText;
  const kugouGatewayRequest = ctx.kugouGatewayRequest || defaultKugouHttp.kugouGatewayRequest;
  const extractKugouAuth = ctx.extractKugouAuth || defaultKugouHttp.extractKugouAuth;
  const removeSongFromList = ctx.handleKugouRemoveSongFromList || defaultKugouFavorite.handleKugouRemoveSongFromList;
  const mapping = ctx.kugouMapping || defaultKugouMapping;

  const decodeText = (value) => mapping.decodeKugouDisplayText(value);
  const coverUrl = (raw, size) => mapping.kugouCoverUrl(raw, size);
  const cookie = () => ctx.kugouCookie || '';

  // ---------- 公开移动端接口 ----------
  // status=1 / errcode=0 才算成功，失败要带原因，不静默返回空数组。
  async function mobileJson(path, params) {
    const u = new URL(path, MOBILE_BASE);
    Object.keys(params || {}).forEach(k => {
      if (params[k] != null && params[k] !== '') u.searchParams.set(k, String(params[k]));
    });
    const raw = await requestText(u.toString(), {
      headers: { 'User-Agent': MOBILE_UA },
      timeoutMs: 12000,
    });
    let json;
    try { json = JSON.parse(raw); } catch (err) {
      throw new Error('KUGOU_PUBLIC_INVALID_JSON: ' + String(raw || '').slice(0, 80));
    }
    const status = Number(json && json.status);
    const errcode = Number(json && json.errcode);
    if (status !== 1 || (Number.isFinite(errcode) && errcode !== 0)) {
      throw new Error('KUGOU_PUBLIC_FAILED status=' + status + ' errcode=' + errcode);
    }
    return (json && json.data) || {};
  }

  function mapAlbumRow(row) {
    const a = row || {};
    return {
      provider: 'kugou', source: 'kugou', type: 'album',
      id: text(a.albumid || a.album_id || a.id),
      name: decodeText(a.albumname || a.album_name || a.name),
      artist: decodeText(a.singername || a.singer_name || a.author_name),
      cover: coverUrl(a.imgurl || a.cover || a.picurl, 300),
      publishDate: text(a.publishtime || a.publish_date).slice(0, 10),
      songCount: Number(a.songcount || a.song_count || 0) || 0,
      intro: decodeText(a.intro || a.description),
    };
  }

  function mapPlaylistRow(row) {
    const p = row || {};
    return {
      provider: 'kugou', source: 'kugou', type: 'playlist',
      id: text(p.specialid || p.special_id || p.id),
      name: decodeText(p.specialname || p.special_name || p.name),
      cover: coverUrl(p.imgurl || p.cover || p.picurl, 300),
      trackCount: Number(p.songcount || p.song_count || 0) || 0,
      playCount: Number(p.playcount || p.play_count || 0) || 0,
      creator: decodeText(p.nickname || p.singername || p.creator),
      intro: decodeText(p.intro),
    };
  }

  function mapSongs(rows, limit) {
    const seen = new Set();
    const songs = [];
    asArray(rows).forEach(row => {
      const mapped = mapping.mapKugouPlaylistTrack(row);
      if (!mapped || !(mapped.hash || mapped.id || mapped.name)) return;
      const key = String(mapped.hash || mapped.id || mapped.name);
      if (seen.has(key)) return;
      seen.add(key);
      songs.push(mapped);
    });
    return limit ? songs.slice(0, limit) : songs;
  }

  function needLogin() {
    const auth = extractKugouAuth(cookie());
    return !!auth.playbackReady;
  }

  function loginRequired() {
    return { provider: 'kugou', loggedIn: false, error: 'KUGOU_AUTH_REQUIRED', message: '需要登录酷狗账号（含播放态）' };
  }

  // ---------- A1. 专辑详情（含曲目，供前端详情面板直接复用） ----------
  async function albumDetail(q) {
    const albumId = text(q.get('albumId') || q.get('id') || q.get('album_id'));
    if (!albumId) return { provider: 'kugou', error: 'MISSING_ALBUM_ID', album: null, songs: [] };
    const limit = intInRange(q.get('limit') || q.get('pagesize'), 1, 100, 60);
    const data = await mobileJson('album/info', { albumid: albumId });
    const album = mapAlbumRow(data);
    let songs = [];
    let total = 0;
    let songsMessage = '';
    try {
      const list = await mobileJson('album/song', { albumid: albumId, page: 1, pagesize: limit });
      songs = mapSongs(list.info, limit);
      total = Number(list.total || songs.length) || songs.length;
    } catch (err) {
      songsMessage = '专辑曲目读取失败：' + err.message;
    }
    return {
      provider: 'kugou',
      album: Object.assign(album, {
        desc: album.intro,
        songCount: Number(data.songcount || total || album.songCount || 0) || 0,
      }),
      songs,
      total,
      message: songsMessage || (album.name ? '' : '该专辑没有返回详情。'),
    };
  }

  // ---------- A2. 专辑曲目 ----------
  async function albumSongs(q) {
    const albumId = text(q.get('albumId') || q.get('id') || q.get('album_id'));
    if (!albumId) return { provider: 'kugou', error: 'MISSING_ALBUM_ID', songs: [] };
    const page = intInRange(q.get('page'), 1, 100, 1);
    const pagesize = intInRange(q.get('pagesize') || q.get('limit'), 1, 100, 30);
    const data = await mobileJson('album/song', { albumid: albumId, page, pagesize });
    return {
      provider: 'kugou', albumId, songs: mapSongs(data.info, pagesize),
      total: Number(data.total || 0) || 0, page, pagesize,
      message: asArray(data.info).length ? '' : '该专辑没有返回曲目。',
    };
  }

  // ---------- A3. 歌手页（信息 + 热门歌曲） ----------
  async function artistDetail(q) {
    const singerId = text(q.get('singerId') || q.get('id') || q.get('singerid'));
    if (!singerId) return { provider: 'kugou', error: 'MISSING_ARTIST_ID', artist: null, songs: [] };
    const limit = intInRange(q.get('limit'), 1, 100, 30);
    const info = await mobileJson('singer/info', { singerid: singerId });
    const artist = {
      id: singerId,
      name: decodeText(info.singername),
      avatar: coverUrl(info.imgurl || info.picurl || info.avatar, 300),
      brief: decodeText(info.profile || info.intro),
      musicSize: Number(info.songcount || 0) || 0,
      albumSize: Number(info.albumcount || 0) || 0,
    };
    let songs = [];
    let message = '';
    try {
      const list = await mobileJson('singer/song', { singerid: singerId, page: 1, pagesize: limit });
      songs = mapSongs(list.info, limit);
      if (!songs.length) message = '该歌手没有返回热门歌曲。';
    } catch (err) {
      message = '歌手热门歌曲读取失败：' + err.message;
    }
    return { provider: 'kugou', artist, songs, message };
  }

  // ---------- A4. 歌手专辑列表 ----------
  async function artistAlbums(q) {
    const singerId = text(q.get('singerId') || q.get('id') || q.get('singerid'));
    if (!singerId) return { provider: 'kugou', error: 'MISSING_ARTIST_ID', albums: [] };
    const page = intInRange(q.get('page'), 1, 100, 1);
    const pagesize = intInRange(q.get('pagesize') || q.get('limit'), 1, 80, 30);
    const data = await mobileJson('singer/album', { singerid: singerId, page, pagesize });
    return {
      provider: 'kugou', singerId,
      albums: asArray(data.info).map(mapAlbumRow).filter(a => a.id),
      total: Number(data.total || 0) || 0, page, pagesize,
      message: asArray(data.info).length ? '' : '该歌手没有返回专辑列表。',
    };
  }

  // ---------- A5. 专辑 / 歌单分类搜索 ----------
  async function searchCollections(q) {
    const keywords = text(q.get('keywords') || q.get('q'));
    if (!keywords) return { provider: 'kugou', error: 'MISSING_KEYWORDS', albums: [], playlists: [] };
    const kind = text(q.get('kind') || q.get('type') || 'album').toLowerCase();
    const page = intInRange(q.get('page'), 1, 100, 1);
    const pagesize = intInRange(q.get('pagesize') || q.get('limit'), 1, 50, 20);
    const path = kind === 'playlist' ? 'search/special' : 'search/album';
    const data = await mobileJson(path, { keyword: keywords, page, pagesize });
    const albums = kind !== 'playlist' ? asArray(data.info).map(mapAlbumRow).filter(a => a.id) : [];
    const playlists = kind === 'playlist' ? asArray(data.info).map(mapPlaylistRow).filter(p => p.id) : [];
    return {
      provider: 'kugou', keywords, kind, albums, playlists,
      total: Number(data.total || 0) || 0, page, pagesize,
      message: (albums.length || playlists.length) ? '' : '没有匹配的' + kind + '结果。',
    };
  }

  // ---------- A6. 分类推荐卡片 ----------
  // album/list 给推荐专辑；singer/list 的 enu_list.types 给分类枚举，不伪造卡片数据。
  async function recommendCards(q) {
    const page = intInRange(q.get('page'), 1, 50, 1);
    const pagesize = intInRange(q.get('pagesize') || q.get('limit'), 1, 30, 12);
    const data = await mobileJson('album/list', { page, pagesize });
    const cards = asArray(data.info).map(mapAlbumRow).filter(a => a.id);
    let categories = [];
    let categoriesMessage = '';
    try {
      const singerData = await mobileJson('singer/list', { classid: 1, page: 1, pagesize: 1 });
      const enu = singerData.enu_list || {};
      categories = asArray(enu.types).map(t => ({
        id: text(t.key != null ? t.key : t.id), name: decodeText(t.value || t.name),
      })).filter(c => c.name);
    } catch (err) {
      categoriesMessage = '分类枚举读取失败：' + err.message;
    }
    return {
      provider: 'kugou', cards, categories, page, pagesize,
      total: Number(data.total || 0) || 0,
      message: cards.length ? categoriesMessage : (categoriesMessage || '推荐专辑本次没有返回内容。'),
    };
  }

  // ---------- B1. 历史每日推荐 ----------
  // 一手源码 module/everyday_history.js：
  //   url /everyday/api/v1/get_history, x-router: everydayrec.service.kugou.com,
  //   params { mode:'list'|'song', platform:'ios', history_name?, date? }
  async function recommendHistory(q) {
    if (!needLogin()) return loginRequired();
    const mode = text(q.get('mode') || 'list') === 'song' ? 'song' : 'list';
    const date = text(q.get('date'));
    const historyName = text(q.get('historyName') || q.get('history_name'));
    const params = { mode, platform: 'ios' };
    if (date) params.date = date;
    if (historyName) params.history_name = historyName;
    const json = await kugouGatewayRequest('/everyday/api/v1/get_history', {
      method: 'POST', router: ROUTER_EVERYDAY, params, cookie: cookie(),
    });
    const data = (json && (json.data || json)) || {};
    let rows = asArray(data.list).concat(asArray(data.songs)).concat(asArray(data.info));
    if (!rows.length) {
      Object.keys(data).forEach(k => { if (Array.isArray(data[k])) rows = rows.concat(data[k]); });
    }
    const songs = mode === 'song' ? mapSongs(rows, 100) : [];
    const entries = mode === 'list' ? rows.map(row => ({
      date: text((row && (row.date || row.day || row.history_name)) || row),
      name: decodeText(row && (row.name || row.title)),
      raw: row,
    })) : [];
    return {
      provider: 'kugou', loggedIn: true, mode, date, songs, entries,
      source: 'everyday_history',
      message: rows.length ? '' : '历史日推本次没有返回内容。',
    };
  }

  // ---------- B2. 私人 FM「不喜欢」 ----------
  // 一手源码 module/personal_fm.js：/v2/personal_recommend + action:'garbage'。
  // 沿用项目已验收的 fetchKugouFmRecommendations 的 query-params 通道，
  // 不引入未验证的 body 通道。
  async function fmDislike(body) {
    if (!needLogin()) return loginRequired();
    const hash = text(body.hash || body.fileHash || (body.song && body.song.hash));
    const songid = text(body.songid || body.songId || (body.song && body.song.audioId));
    if (!hash && !songid) return { provider: 'kugou', success: false, error: 'MISSING_SONG_ID', message: '需要歌曲 hash 或 songid' };
    const params = {
      action: 'garbage', mode: text(body.mode || 'normal'), platform: 'ios',
      remain_songcnt: 0, is_overplay: body.isOverplay ? 1 : 0,
    };
    if (hash) params.hash = hash;
    if (songid) params.songid = songid;
    if (body.playtime != null) params.playtime = intInRange(body.playtime, 0, 86400, 0);
    const json = await kugouGatewayRequest('/v2/personal_recommend', {
      method: 'POST', router: ROUTER_PERSONAL_FM, params, cookie: cookie(),
    });
    const status = Number(json && (json.status || json.err_code)) || 1;
    return {
      provider: 'kugou', success: status !== 0, hash, songid,
      code: status, source: 'personal_fm_garbage',
      message: status !== 0 ? '' : '酷狗网关返回 status=0，不喜欢反馈未生效。',
    };
  }

  // ---------- B3. 从平台歌单移除歌曲 ----------
  // 复用项目已验收的 handleKugouRemoveSongFromList（/v4/delete_songs，cloudlist 通道）。
  async function playlistRemoveSong(body) {
    if (!needLogin()) return loginRequired();
    const listId = text(body.pid || body.listId || body.playlistId);
    const song = body.song || {
      hash: text(body.hash), name: text(body.name), id: text(body.id),
      fileId: text(body.fileId),
    };
    if (!listId) return { provider: 'kugou', success: false, error: 'MISSING_LIST_ID' };
    const result = await removeSongFromList(listId, song, cookie());
    return Object.assign({ provider: 'kugou' }, result, {
      message: result && result.success ? '' : (result && result.error || '从歌单移除歌曲失败'),
    });
  }

  return {
    albumDetail,
    albumSongs,
    artistDetail,
    artistAlbums,
    searchCollections,
    recommendCards,
    recommendHistory,
    fmDislike,
    playlistRemoveSong,
  };
};
