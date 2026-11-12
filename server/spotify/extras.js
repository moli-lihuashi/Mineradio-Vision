'use strict';

// ====================================================================
//  Spotify 增补能力（2026-11-12 批次4）
//
//  契约来源：Spotify Web API 官方端点（不是推断的私有协议）：
//   · GET    /me/albums                     收藏专辑库（scope user-library-read）
//   · GET    /artists/{id}                  歌手信息（公开，用户/客户端 token 均可）
//   · GET    /artists/{id}/top-tracks       歌手热门歌曲
//   · GET    /artists/{id}/albums           歌手专辑列表
//   · DELETE /playlists/{id}/tracks         从歌单移除歌曲
//                                          （scope playlist-modify-public 或 private）
//
//  依赖注入：生产走项目既有 http/mapping/config；测试注入合成上游。
//  与 business.js 保持单向（extras → 底座，不反向），避免循环 require。
//
//  批次5 追加（官方 Web API）：
//   · GET /browse/categories                    探索页分类
//   · GET /browse/categories/{id}/playlists    分类歌单
//   · GET /me/playlists                        账号 made-for-you / Daily Mix 歌单
//   · GET /playlists/{id}/tracks               每日混合曲目
//
//  明确不接（不写空壳）：
//   · 逐词歌词（平台不提供，Folia 同样没有）；
//   · 原平台逐行歌词：Folia 用桌面端私有 lyrics 端点，官方 Web API 没有歌词；
//   · 原平台音频播放：需要桌面端加密音频通道（getAudioSource + keepAudio），本项目没有（business.js:651）；
//   · 私人电台：Folia 用桌面端私有 radio 端点；官方 Web API 无对应端点，
//     GET /recommendations 对新应用已受限，不拿它伪装电台。
// ====================================================================

const defaultHttp = require('./http');
const defaultMapping = require('./mapping');
const defaultConfig = require('./config');

function asArray(v) { return Array.isArray(v) ? v : []; }
function text(v) { return String(v == null ? '' : v).trim(); }
function intInRange(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

module.exports = function createSpotifyExtras(ctx) {
  ctx = ctx || {};
  const userGet = ctx.spotifyUserGet || defaultHttp.spotifyUserGet;
  const userRequest = ctx.spotifyUserRequest || defaultHttp.spotifyUserRequest;
  const readToken = ctx.readStoredSpotifyToken || defaultHttp.readStoredSpotifyToken;
  const mapping = ctx.spotifyMapping || defaultMapping;
  const config = ctx.spotifyConfig || defaultConfig;
  const normalizeScopes = ctx.normalizeScopes || config.normalizeScopes;
  const marketOf = () => (config.getSpotifyConfig ? config.getSpotifyConfig().market : '') || 'US';

  function grantedScopes() {
    const token = readToken() || {};
    return normalizeScopes(token.scope);
  }

  // 与 business.js 的 requireSpotifyScopes 同样的语义，但返回结构而不是抛错，
  // 让前端能直接看到「缺哪个权限、需要重新授权」。
  function scopeCheck(anyOf) {
    const granted = grantedScopes();
    const missing = anyOf.filter(s => !granted.includes(s));
    return {
      ok: missing.length < anyOf.length || anyOf.length === 0,
      missing,
      granted,
    };
  }

  function scopeRequired(anyOf, action) {
    const check = scopeCheck(anyOf);
    return {
      provider: 'spotify',
      success: false,
      error: check.missing.length ? 'SPOTIFY_WRITE_SCOPE_REQUIRED' : 'SPOTIFY_AUTH_REQUIRED',
      reauthRequired: true,
      requiredScopes: anyOf,
      missingScopes: check.missing,
      message: action + ' 需要 Spotify 授权：' + anyOf.join(' 或 ') + '；请在「连接 Spotify」时重新授权。',
    };
  }

  function mapAlbum(album) {
    const a = album || {};
    return {
      provider: 'spotify', source: 'spotify', type: 'album',
      id: text(a.id),
      spotifyId: text(a.id),
      spotifyUri: text(a.uri),
      name: text(a.name),
      artist: asArray(a.artists).map(x => text(x && x.name)).filter(Boolean).join(' / '),
      cover: mapping.spotifyImage ? mapping.spotifyImage(a.images) : (asArray(a.images)[0] && asArray(a.images)[0].url) || '',
      publishDate: text(a.release_date),
      songCount: Number(a.total_tracks || 0) || 0,
      albumType: text(a.album_type),
      spotifyUrl: text(a.external_urls && a.external_urls.spotify),
    };
  }

  function mapSongs(tracks) {
    return asArray(tracks).map(t => mapping.mapSpotifyTrack(t)).filter(s => s && (s.id || s.name));
  }

  // ---------- 1. 收藏专辑库 ----------
  async function userAlbums(q) {
    const limit = intInRange(q.get('limit'), 1, 50, 25);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const check = scopeCheck(['user-library-read']);
    if (!check.ok) return Object.assign(scopeRequired(['user-library-read'], '读取收藏专辑库'), { albums: [] });
    const json = await userGet('/me/albums', { limit, offset, market: marketOf() }, { timeoutMs: 12000 });
    const rows = asArray(json && json.items).map(row => row && row.album).filter(Boolean);
    return {
      provider: 'spotify', loggedIn: true,
      albums: rows.map(mapAlbum).filter(a => a.id),
      total: Number(json && json.total || 0) || 0,
      limit, offset,
      hasMore: !!(json && json.next),
      message: rows.length ? '' : '收藏专辑库为空，或上游没有返回列表。',
    };
  }

  // ---------- 2. 歌手专辑列表 ----------
  async function artistAlbums(q) {
    const artistId = text(q.get('id') || q.get('artistId'));
    if (!artistId) return { provider: 'spotify', error: 'MISSING_ARTIST_ID', albums: [] };
    const limit = intInRange(q.get('limit'), 1, 50, 20);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const group = text(q.get('includeGroups')) || 'album,single,appears_on,compilation';
    const json = await userGet('/artists/' + encodeURIComponent(artistId) + '/albums', {
      include_groups: group, limit, offset, market: marketOf(),
    }, { timeoutMs: 12000 });
    const rows = asArray(json && json.items);
    return {
      provider: 'spotify', artistId,
      albums: rows.map(mapAlbum).filter(a => a.id),
      total: Number(json && json.total || 0) || 0,
      limit, offset, hasMore: !!(json && json.next),
      message: rows.length ? '' : '该歌手没有返回专辑列表。',
    };
  }

  // ---------- 3. 歌手页（信息 + 热门歌曲 + 专辑） ----------
  async function artistDetail(q) {
    const artistId = text(q.get('id') || q.get('artistId'));
    if (!artistId) return { provider: 'spotify', error: 'MISSING_ARTIST_ID', artist: null, songs: [], albums: [] };
    const info = await userGet('/artists/' + encodeURIComponent(artistId), {}, { timeoutMs: 12000 });
    const artist = {
      provider: 'spotify', id: text(info && info.id) || artistId,
      name: text(info && info.name),
      avatar: mapping.spotifyImage ? mapping.spotifyImage(info && info.images) : '',
      brief: asArray(info && info.genres).join(' / '),
      followers: Number(info && info.followers && info.followers.total || 0) || 0,
      popularity: Number(info && info.popularity || 0) || 0,
      musicSize: 0,
      albumSize: 0,
      spotifyUrl: text(info && info.external_urls && info.external_urls.spotify),
    };
    let songs = [];
    let albums = [];
    let failures = [];
    try {
      const top = await userGet('/artists/' + encodeURIComponent(artistId) + '/top-tracks',
        { market: marketOf() }, { timeoutMs: 12000 });
      songs = mapSongs(top && top.tracks);
    } catch (err) {
      failures.push('热门歌曲：' + (err && err.message || err));
    }
    try {
      const list = await userGet('/artists/' + encodeURIComponent(artistId) + '/albums',
        { include_groups: 'album,single', limit: 20, offset: 0, market: marketOf() }, { timeoutMs: 12000 });
      albums = asArray(list && list.items).map(mapAlbum).filter(a => a.id);
      artist.albumSize = Number(list && list.total || albums.length) || albums.length;
    } catch (err) {
      failures.push('专辑列表：' + (err && err.message || err));
    }
    return {
      provider: 'spotify', artist, songs, albums,
      message: failures.length ? ('部分内容读取失败：' + failures.join('；')) : '',
    };
  }

  // ---------- 4. 从平台歌单移除歌曲 ----------
  // 官方 DELETE /playlists/{playlist_id}/tracks，body { tracks: [{ uri }] }。
  // 支持传 URI 或裸 ID；裸 ID 自动补成 spotify:track:<id>。
  async function playlistRemoveSong(body) {
    const playlistId = text(body.pid || body.playlistId || body.id);
    const raw = body.ids || body.id || body.tracks || body.uri || (body.song && (body.song.spotifyUri || body.song.uri || body.song.spotifyId || body.song.id));
    if (!playlistId) return { provider: 'spotify', success: false, error: 'MISSING_PLAYLIST_ID' };
    if (!raw) return { provider: 'spotify', success: false, error: 'MISSING_TRACK_ID' };
    const anyOf = ['playlist-modify-public', 'playlist-modify-private'];
    if (!scopeCheck(anyOf).ok) return scopeRequired(anyOf, '从歌单移除歌曲');

    const values = Array.isArray(raw) ? raw : String(raw).split(',');
    const uris = values.map(v => text(v && typeof v === 'object'
      ? (v.spotifyUri || v.uri || v.spotifyId || v.id)
      : v)).filter(Boolean).map(v => (/^spotify:track:/i.test(v) ? v : 'spotify:track:' + v.replace(/^spotify:track:/i, '')));
    if (!uris.length) return { provider: 'spotify', success: false, error: 'MISSING_TRACK_ID' };

    const json = await userRequest('/playlists/' + encodeURIComponent(playlistId) + '/tracks',
      'DELETE', {}, { tracks: uris.map(uri => ({ uri })) }, { timeoutMs: 12000 });
    return {
      provider: 'spotify', success: true, pid: playlistId, uris,
      snapshotId: text(json && json.snapshot_id),
      message: '',
    };
  }

  // ---------- 5. 探索页分类 ----------
  async function exploreCategories(q) {
    const limit = intInRange(q.get('limit'), 1, 50, 20);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const json = await userGet('/browse/categories', {
      limit, offset, country: marketOf(), locale: 'zh_CN',
    }, { timeoutMs: 12000 });
    const items = asArray(json && json.categories && json.categories.items);
    return {
      provider: 'spotify',
      categories: items.map(c => ({
        id: text(c && c.id), name: text(c && c.name),
        cover: mapping.spotifyImage ? mapping.spotifyImage(c && c.icons) : '',
      })).filter(c => c.id),
      total: Number(json && json.categories && json.categories.total || 0) || 0,
      limit, offset, hasMore: !!(json && json.categories && json.categories.next),
      message: items.length ? '' : 'Spotify 探索分类本次没有返回内容。',
    };
  }

  // ---------- 6. 分类歌单 ----------
  async function categoryPlaylists(q) {
    const categoryId = text(q.get('id') || q.get('categoryId'));
    if (!categoryId) return { provider: 'spotify', error: 'MISSING_CATEGORY_ID', playlists: [] };
    const limit = intInRange(q.get('limit'), 1, 50, 20);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const json = await userGet('/browse/categories/' + encodeURIComponent(categoryId) + '/playlists', {
      limit, offset, country: marketOf(),
    }, { timeoutMs: 12000 });
    const rows = asArray(json && json.playlists && json.playlists.items);
    return {
      provider: 'spotify', categoryId,
      playlists: rows.map(p => ({
        provider: 'spotify', id: text(p && p.id), name: text(p && p.name),
        cover: mapping.spotifyImage ? mapping.spotifyImage(p && p.images) : '',
        trackCount: Number(p && p.tracks && p.tracks.total || 0) || 0,
        spotifyUri: text(p && p.uri),
        spotifyUrl: text(p && p.external_urls && p.external_urls.spotify),
      })).filter(p => p.id),
      total: Number(json && json.playlists && json.playlists.total || 0) || 0,
      limit, offset,
      message: rows.length ? '' : '该分类没有返回歌单。',
    };
  }

  // ---------- 7. 账号个性化推荐歌单 / 每日混合 ----------
  // Folia 也读账号的 made-for-you 歌单；Daily Mix 是 Spotify 为账号生成的歌单，
  // 名字带 "Daily Mix"，其余个性化列表用常见产品名识别。
  const MADE_FOR_YOU_RE = /daily mix|made for|discover weekly|release radar|on repeat|repeat rewind|time capsule|your top songs/i;
  async function madeForYou(q) {
    const limit = intInRange(q.get('limit'), 1, 50, 20);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const json = await userGet('/me/playlists', { limit, offset }, { timeoutMs: 12000 });
    const rows = asArray(json && json.items);
    const playlists = rows.map(p => ({
      provider: 'spotify', id: text(p && p.id), name: text(p && p.name),
      cover: mapping.spotifyImage ? mapping.spotifyImage(p && p.images) : '',
      trackCount: Number(p && p.tracks && p.tracks.total || 0) || 0,
      spotifyUri: text(p && p.uri),
      description: text(p && p.description),
      owner: text(p && p.owner && p.owner.display_name),
      isDailyMix: /daily mix/i.test(text(p && p.name)),
    })).filter(p => p.id);
    const personalized = playlists.filter(p => MADE_FOR_YOU_RE.test(p.name));
    return {
      provider: 'spotify',
      personalized,
      dailyMixes: personalized.filter(p => p.isDailyMix),
      playlists,
      total: Number(json && json.total || 0) || 0,
      limit, offset, hasMore: !!(json && json.next),
      message: personalized.length ? '' : '账号歌单里没有识别到个性化推荐歌单。',
    };
  }

  // ---------- 8. 每日混合曲目 ----------
  async function dailyMixTracks(q) {
    const limit = intInRange(q.get('limit'), 1, 50, 30);
    let playlistId = text(q.get('playlistId') || q.get('id'));
    if (!playlistId) {
      const lists = await madeForYou(new URLSearchParams('limit=50&offset=0'));
      const first = (lists.dailyMixes || [])[0] || (lists.personalized || [])[0];
      if (!first) {
        return {
          provider: 'spotify', songs: [], playlist: null,
          message: '账号里没有找到每日混合或个性化推荐歌单，无法取曲目。',
        };
      }
      playlistId = first.id;
    }
    const json = await userGet('/playlists/' + encodeURIComponent(playlistId) + '/tracks', {
      limit, offset: 0, market: marketOf(), fields: 'items(track),total,next',
    }, { timeoutMs: 12000 });
    const tracks = asArray(json && json.items).map(row => row && row.track).filter(Boolean);
    return {
      provider: 'spotify', playlistId, songs: mapSongs(tracks),
      total: Number(json && json.total || 0) || 0,
      message: tracks.length ? '' : '该歌单没有返回曲目。',
    };
  }

  return {
    userAlbums,
    artistAlbums,
    artistDetail,
    playlistRemoveSong,
    exploreCategories,
    categoryPlaylists,
    madeForYou,
    dailyMixTracks,
  };
};
