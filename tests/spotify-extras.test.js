'use strict';

// 批次4 Spotify 增补能力的合成正例。
// 守的是官方 Web API 契约：端点、参数、字段映射、scope 检查、URI 归一化。
// 没有账号在线实测（无凭据），公开读取接口由真起服务探针进一步验证。

const test = require('node:test');
const assert = require('node:assert/strict');
const createSpotifyExtras = require('../server/spotify/extras');

function album(id, name) {
  return { id, name, uri: 'spotify:album:' + id, artists: [{ id: 'a1', name: '歌手' }], images: [{ url: 'https://img/' + id + '.jpg' }], release_date: '2026-03-25', total_tracks: 12, album_type: 'album', external_urls: { spotify: 'https://open.spotify.com/album/' + id } };
}
function track(id, name) { return { id, name, uri: 'spotify:track:' + id, artists: [{ name: '歌手' }], duration_ms: 200000 }; }

function makeHarness(options) {
  const opts = options || {};
  const calls = [];
  const responses = opts.responses || {};
  const scopes = opts.scopes === undefined
    ? ['user-library-read', 'playlist-modify-public', 'playlist-modify-private']
    : opts.scopes;
  const ctx = {
    spotifyUserGet: async function (path, params, reqOpts) {
      calls.push({ kind: 'get', path, params, reqOpts });
      const entry = responses['GET ' + path];
      if (typeof entry === 'function') return entry(params);
      if (entry === 'throw') throw new Error('spotify-upstream-down');
      return entry || { items: [], total: 0 };
    },
    spotifyUserRequest: async function (path, method, params, payload, reqOpts) {
      calls.push({ kind: 'request', path, method, params, payload, reqOpts });
      const entry = responses[method + ' ' + path];
      if (typeof entry === 'function') return entry(payload);
      return entry || { snapshot_id: 'snap-1' };
    },
    readStoredSpotifyToken: function () { return { scope: (scopes || []).join(' ') }; },
    spotifyMapping: {
      spotifyImage: (images) => (Array.isArray(images) && images[0] && images[0].url) || '',
      mapSpotifyTrack: (t) => t ? { provider: 'spotify', id: t.id, name: t.name, spotifyUri: t.uri } : null,
    },
    spotifyConfig: {
      getSpotifyConfig: () => ({ market: 'US' }),
      normalizeScopes: (s) => String(s || '').split(/[\s,]+/).filter(Boolean),
    },
  };
  return { extras: createSpotifyExtras(ctx), calls: calls };
}

function params(obj) { return new URLSearchParams(obj || {}); }
function getCall(h, path) { return h.calls.filter(c => c.kind === 'get' && c.path === path).pop(); }

test('收藏专辑库：GET /me/albums + user-library-read scope + 字段映射', async () => {
  const h = makeHarness({
    responses: { 'GET /me/albums': { items: [{ added_at: '2026-01-01', album: album('al1', '收藏专辑') }], total: 1, next: null } },
  });
  const r = await h.extras.userAlbums(params({ limit: '10', offset: '5' }));
  assert.equal(r.albums.length, 1);
  assert.equal(r.albums[0].name, '收藏专辑');
  assert.equal(r.albums[0].artist, '歌手');
  assert.equal(r.albums[0].cover, 'https://img/al1.jpg');
  assert.equal(r.albums[0].songCount, 12);
  assert.equal(r.total, 1);
  const c = getCall(h, '/me/albums');
  assert.equal(c.params.limit, 10);
  assert.equal(c.params.offset, 5);
  assert.equal(c.params.market, 'US');
});

test('收藏专辑库缺少 user-library-read 时明确要求重新授权，且不打上游', async () => {
  const h = makeHarness({ scopes: ['playlist-modify-public'] });
  const r = await h.extras.userAlbums(params());
  assert.equal(r.error, 'SPOTIFY_WRITE_SCOPE_REQUIRED');
  assert.equal(r.reauthRequired, true);
  assert.deepEqual(r.requiredScopes, ['user-library-read']);
  assert.match(r.message, /重新授权/);
  assert.equal(h.calls.length, 0);
});

test('歌手专辑列表：/artists/{id}/albums 分页与 include_groups', async () => {
  const h = makeHarness({
    responses: { 'GET /artists/ar1/albums': { items: [album('al2', '新专辑')], total: 7, next: 'next-url' } },
  });
  const r = await h.extras.artistAlbums(params({ id: 'ar1', limit: '5', offset: '2' }));
  assert.equal(r.albums[0].name, '新专辑');
  assert.equal(r.total, 7);
  assert.equal(r.hasMore, true);
  const c = getCall(h, '/artists/ar1/albums');
  assert.equal(c.params.limit, 5);
  assert.equal(c.params.offset, 2);
  assert.equal(c.params.include_groups, 'album,single,appears_on,compilation');
});

test('歌手页：信息 + 热门歌曲 + 专辑，部分失败要可见', async () => {
  const h = makeHarness({
    responses: {
      'GET /artists/ar1': { id: 'ar1', name: '某歌手', images: [{ url: 'https://img/artist.jpg' }], genres: ['pop', 'rock'], followers: { total: 999 }, popularity: 82, external_urls: { spotify: 'https://open.spotify.com/artist/ar1' } },
      'GET /artists/ar1/top-tracks': { tracks: [track('t1', '热门曲')] },
      'GET /artists/ar1/albums': { items: [album('al3', '专辑三')], total: 3 },
    },
  });
  const r = await h.extras.artistDetail(params({ id: 'ar1' }));
  assert.equal(r.artist.name, '某歌手');
  assert.equal(r.artist.brief, 'pop / rock');
  assert.equal(r.artist.followers, 999);
  assert.equal(r.artist.albumSize, 3);
  assert.equal(r.songs[0].name, '热门曲');
  assert.equal(r.albums[0].name, '专辑三');
  assert.equal(r.message, '');
  assert.equal(getCall(h, '/artists/ar1/top-tracks').params.market, 'US');

  const degraded = makeHarness({
    responses: { 'GET /artists/ar1': { id: 'ar1', name: '某歌手' }, 'GET /artists/ar1/top-tracks': 'throw' },
  });
  const r2 = await degraded.extras.artistDetail(params({ id: 'ar1' }));
  assert.match(r2.message, /热门歌曲/);
  assert.equal(r2.artist.name, '某歌手', '局部失败不该丢掉歌手信息');
});

test('从歌单移除歌曲：DELETE + 裸 ID 归一化成 spotify:track URI + scope 任一即可', async () => {
  const h = makeHarness({ scopes: ['playlist-modify-private'] });
  const r = await h.extras.playlistRemoveSong({ pid: 'pl1', ids: 't1,spotify:track:t2' });
  assert.equal(r.success, true);
  assert.equal(r.snapshotId, 'snap-1');
  const c = h.calls.filter(x => x.kind === 'request')[0];
  assert.equal(c.method, 'DELETE');
  assert.equal(c.path, '/playlists/pl1/tracks');
  assert.deepEqual(c.payload, { tracks: [{ uri: 'spotify:track:t1' }, { uri: 'spotify:track:t2' }] });

  const noScope = makeHarness({ scopes: [] });
  const denied = await noScope.extras.playlistRemoveSong({ pid: 'pl1', ids: 't1' });
  assert.equal(denied.error, 'SPOTIFY_WRITE_SCOPE_REQUIRED');
  assert.equal(denied.reauthRequired, true);
  assert.equal(noScope.calls.filter(x => x.kind === 'request').length, 0);
});

test('从 song 对象取 URI；缺少必填参数时不打上游', async () => {
  const h = makeHarness({});
  const r = await h.extras.playlistRemoveSong({ pid: 'pl1', song: { spotifyUri: 'spotify:track:t9' } });
  assert.equal(r.success, true);
  assert.deepEqual(r.uris, ['spotify:track:t9']);
  assert.equal((await h.extras.playlistRemoveSong({ ids: 't1' })).error, 'MISSING_PLAYLIST_ID');
  assert.equal((await h.extras.playlistRemoveSong({ pid: 'pl1' })).error, 'MISSING_TRACK_ID');
});

test('批次5 探索页：/browse/categories 与分类歌单', async () => {
  const h = makeHarness({
    responses: {
      'GET /browse/categories': { categories: { items: [{ id: 'pop', name: '流行', icons: [{ url: 'https://img/pop.jpg' }] }], total: 1 } },
      'GET /browse/categories/pop/playlists': { playlists: { items: [{ id: 'pl9', name: '流行精选', tracks: { total: 50 }, images: [{ url: 'https://img/pl9.jpg' }], uri: 'spotify:playlist:pl9' }], total: 1 } },
    },
  });
  const cats = await h.extras.exploreCategories(params({ limit: '5' }));
  assert.equal(cats.categories[0].name, '流行');
  assert.equal(cats.categories[0].cover, 'https://img/pop.jpg');
  assert.equal(getCall(h, '/browse/categories').params.country, 'US');

  const lists = await h.extras.categoryPlaylists(params({ id: 'pop' }));
  assert.equal(lists.playlists[0].name, '流行精选');
  assert.equal(lists.playlists[0].trackCount, 50);
  assert.equal(getCall(h, '/browse/categories/pop/playlists').path, '/browse/categories/pop/playlists');
  assert.equal((await h.extras.categoryPlaylists(params())).error, 'MISSING_CATEGORY_ID');
});

test('批次5 个性化推荐：从 /me/playlists 识别 Daily Mix 与 made-for-you', async () => {
  const h = makeHarness({
    responses: {
      'GET /me/playlists': { total: 3, next: null, items: [
        { id: 'dm1', name: 'Daily Mix 1', tracks: { total: 50 }, images: [{ url: 'https://img/dm.jpg' }], uri: 'spotify:playlist:dm1' },
        { id: 'dw1', name: 'Discover Weekly', tracks: { total: 30 }, images: [], uri: 'spotify:playlist:dw1' },
        { id: 'own', name: '我自己的歌单', tracks: { total: 10 }, images: [], uri: 'spotify:playlist:own' },
      ] },
    },
  });
  const r = await h.extras.madeForYou(params({ limit: '10' }));
  assert.equal(r.playlists.length, 3);
  assert.equal(r.personalized.length, 2);
  assert.equal(r.dailyMixes.length, 1);
  assert.equal(r.dailyMixes[0].id, 'dm1');
  assert.equal(getCall(h, '/me/playlists').params.limit, 10);
});

test('批次5 每日混合曲目：自动选第一个 Daily Mix，或按传入歌单取曲目', async () => {
  const h = makeHarness({
    responses: {
      'GET /me/playlists': { total: 1, items: [{ id: 'dm1', name: 'Daily Mix 1', images: [], tracks: { total: 2 } }] },
      'GET /playlists/dm1/tracks': { total: 2, items: [{ track: track('t1', '曲一') }, { track: track('t2', '曲二') }] },
      'GET /playlists/plX/tracks': { total: 1, items: [{ track: track('t3', '曲三') }] },
    },
  });
  const auto = await h.extras.dailyMixTracks(params({ limit: '10' }));
  assert.equal(auto.playlistId, 'dm1');
  assert.equal(auto.songs.length, 2);
  assert.equal(getCall(h, '/playlists/dm1/tracks').params.fields.includes('items(track)'), true);

  const explicit = await h.extras.dailyMixTracks(params({ playlistId: 'plX' }));
  assert.equal(explicit.songs[0].name, '曲三');
  assert.equal(h.calls.filter(c => c.path === '/me/playlists').length, 1, '显式指定歌单时不该再去列账号歌单');
});

test('账号里没有每日混合时返回明确原因，不假装成功', async () => {
  const h = makeHarness({ responses: { 'GET /me/playlists': { total: 1, items: [{ id: 'own', name: '我自己的歌单', images: [], tracks: { total: 1 } }] } } });
  const r = await h.extras.dailyMixTracks(params());
  assert.equal(r.songs.length, 0);
  assert.equal(r.playlist, null);
  assert.match(r.message, /没有找到每日混合/);
});

test('缺少必填 id 时返回明确 error，不打上游', async () => {
  const h = makeHarness({});
  assert.equal((await h.extras.artistAlbums(params())).error, 'MISSING_ARTIST_ID');
  assert.equal((await h.extras.artistDetail(params())).error, 'MISSING_ARTIST_ID');
  assert.equal(h.calls.length, 0);
});
