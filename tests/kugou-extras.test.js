'use strict';

// 批次3 酷狗增补能力的合成正例。
//
// 覆盖：公开移动端接口的 path/参数/字段映射、网关通道的 path/x-router/参数、
// 登录守卫、以及「复用已有写实现而不是另写一套」。
// 公开接口的真实数据由 .workbuddy/harness/probe-kugou-protocol.js 与真起服务探针验证。

const test = require('node:test');
const assert = require('node:assert/strict');
const createKugouExtras = require('../server/kugou/extras');

function albumRow(id, name) {
  return { albumid: id, albumname: name, singername: '周杰伦', imgurl: 'https://cover/{size}/a.jpg', publishtime: '2026-03-25 00:00:00', songcount: 13, intro: '简介' };
}
function trackRow(hash, filename) {
  return { hash, filename, duration: 200, album_audio_id: 123 };
}

function makeHarness(options) {
  const opts = options || {};
  const calls = [];
  const responses = opts.responses || {};
  const ctx = {
    get kugouCookie() { return opts.cookie != null ? opts.cookie : 'KuGoo=test;'; },
    kugouPublicRequestText: async function (url, reqOpts) {
      calls.push({ kind: 'public', url, reqOpts });
      const path = String(url).split('/api/v3/')[1] || '';
      const key = path.split('?')[0];
      const entry = responses[key];
      if (typeof entry === 'function') return entry(new URL(url).searchParams);
      if (entry === 'throw') throw new Error('network-down');
      return JSON.stringify({ status: 1, errcode: 0, data: entry || {} });
    },
    kugouGatewayRequest: async function (path, reqOpts) {
      calls.push({ kind: 'gateway', path, reqOpts });
      const entry = responses['gw:' + path];
      if (typeof entry === 'function') return entry(reqOpts);
      return entry || { status: 1, data: {} };
    },
    extractKugouAuth: function () { return { playbackReady: opts.loggedIn !== false, userid: '123', token: 'tk' }; },
    handleKugouRemoveSongFromList: async function (listId, song, cookie) {
      calls.push({ kind: 'remove', listId, song, cookie });
      return opts.removeResult || { success: true, liked: false, listId };
    },
    kugouMapping: {
      decodeKugouDisplayText: (v) => String(v == null ? '' : v).replace(/&amp;/g, '&'),
      kugouCoverUrl: (raw, size) => raw ? String(raw).replace(/\{size\}/g, String(size || 240)) : '',
      mapKugouPlaylistTrack: (row) => row ? { provider: 'kugou', hash: row.hash, name: String(row.filename || '').split(' - ').pop(), id: row.hash } : null,
    },
  };
  return { extras: createKugouExtras(ctx), calls: calls };
}

function params(obj) { return new URLSearchParams(obj || {}); }
function publicCalls(h, key) { return h.calls.filter(c => c.kind === 'public' && (c.url.split('/api/v3/')[1] || '').split('?')[0] === key); }
function gatewayCall(h, path) { return h.calls.filter(c => c.kind === 'gateway' && c.path === path).pop(); }

test('专辑详情：同时取 album/info 与 album/song，返回 { album, songs } 供前端复用', async () => {
  const h = makeHarness({
    responses: {
      'album/info': { albumid: 9, albumname: '太阳之子', singername: '周杰伦', imgurl: 'https://c/{size}/9.jpg', publishtime: '2026-03-25', songcount: 13 },
      'album/song': { total: 2, info: [trackRow('H1', '周杰伦 - A'), trackRow('H2', '周杰伦 - B')] },
    },
  });
  const r = await h.extras.albumDetail(params({ albumId: '9', limit: '30' }));
  assert.equal(r.album.id, '9');
  assert.equal(r.album.name, '太阳之子');
  assert.equal(r.album.cover, 'https://c/300/9.jpg', '{size} 占位符必须替换');
  assert.equal(r.album.songCount, 13);
  assert.equal(r.songs.length, 2);
  assert.equal(r.album.desc, r.album.intro);
  const info = publicCalls(h, 'album/info')[0];
  assert.equal(new URL(info.url).searchParams.get('albumid'), '9');
  const song = publicCalls(h, 'album/song')[0];
  assert.equal(new URL(song.url).searchParams.get('pagesize'), '30');
});

test('专辑曲目：分页参数与去重', async () => {
  const h = makeHarness({ responses: { 'album/song': { total: 3, info: [trackRow('H1', 'a - 1'), trackRow('H1', 'a - 1'), trackRow('H2', 'a - 2')] } } });
  const r = await h.extras.albumSongs(params({ albumId: '9', page: '2', pagesize: '10' }));
  assert.equal(r.songs.length, 2, '重复 hash 要去重');
  assert.equal(r.total, 3);
  const c = publicCalls(h, 'album/song')[0];
  assert.equal(new URL(c.url).searchParams.get('page'), '2');
  assert.equal(new URL(c.url).searchParams.get('pagesize'), '10');
});

test('歌手页 / 歌手专辑：字段与分页', async () => {
  const h = makeHarness({
    responses: {
      'singer/info': { singerid: 3520, singername: '周杰伦', songcount: 1865, albumcount: 49, profile: '简介' },
      'singer/song': { total: 1865, info: [trackRow('HS1', '周杰伦 - 稻香')] },
      'singer/album': { total: 49, info: [albumRow(179652761, '太阳之子')] },
    },
  });
  const artist = await h.extras.artistDetail(params({ singerId: '3520', limit: '5' }));
  assert.equal(artist.artist.name, '周杰伦');
  assert.equal(artist.artist.musicSize, 1865);
  assert.equal(artist.artist.albumSize, 49);
  assert.equal(artist.songs.length, 1);
  assert.equal(publicCalls(h, 'singer/info')[0].reqOpts.headers['User-Agent'].includes('Android'), true);

  const albums = await h.extras.artistAlbums(params({ singerId: '3520', page: '2' }));
  assert.equal(albums.albums[0].name, '太阳之子');
  assert.equal(albums.total, 49);
  assert.equal(new URL(publicCalls(h, 'singer/album')[0].url).searchParams.get('page'), '2');
});

test('分类搜索：album 走 search/album，playlist 走 search/special', async () => {
  const h = makeHarness({
    responses: {
      'search/album': { total: 500, info: [albumRow(960399, '魔杰座')] },
      'search/special': { total: 480, info: [{ specialid: 9856645, specialname: '深夜歌单', songcount: 263, playcount: 4669252, nickname: '小编', imgurl: 'https://c/{size}/p.jpg' }] },
    },
  });
  const albums = await h.extras.searchCollections(params({ keywords: '周杰伦', kind: 'album', page: '2' }));
  assert.equal(albums.albums[0].name, '魔杰座');
  assert.equal(albums.total, 500);
  assert.equal(new URL(publicCalls(h, 'search/album')[0].url).searchParams.get('keyword'), '周杰伦');

  const playlists = await h.extras.searchCollections(params({ keywords: '夜', kind: 'playlist' }));
  assert.equal(playlists.playlists[0].name, '深夜歌单');
  assert.equal(playlists.playlists[0].trackCount, 263);
  assert.equal(playlists.playlists[0].cover, 'https://c/300/p.jpg');
  assert.equal(playlists.albums.length, 0);
});

test('分类推荐卡片：专辑列表 + 歌手分类枚举，分类失败不影响卡片', async () => {
  const h = makeHarness({
    responses: {
      'album/list': { total: 1500, info: [albumRow(36516261, '我们没有爱错')] },
      'singer/list': { enu_list: { types: [{ key: 0, value: '全部' }, { key: 1, value: '华语' }] } },
    },
  });
  const r = await h.extras.recommendCards(params({ pagesize: '5' }));
  assert.equal(r.cards[0].name, '我们没有爱错');
  assert.equal(r.categories.length, 2);
  assert.equal(r.categories[1].name, '华语');

  const degraded = makeHarness({ responses: { 'album/list': { total: 1, info: [albumRow(1, 'A')] }, 'singer/list': 'throw' } });
  const r2 = await degraded.extras.recommendCards(params());
  assert.equal(r2.cards.length, 1);
  assert.match(r2.message, /分类枚举读取失败/);
});

test('公开接口返回 status!=1 时必须抛错（由路由层转成带原因的 500）', async () => {
  const extras = createKugouExtras({
    kugouPublicRequestText: async () => JSON.stringify({ status: 0, errcode: 1001, data: {} }),
    kugouMapping: {
      decodeKugouDisplayText: (v) => String(v || ''),
      kugouCoverUrl: (v) => String(v || ''),
      mapKugouPlaylistTrack: (v) => v,
    },
    extractKugouAuth: () => ({ playbackReady: true }),
  });
  await assert.rejects(() => extras.albumDetail(params({ albumId: '1' })), /KUGOU_PUBLIC_FAILED/);
});

test('历史日推：接 /everyday/api/v1/get_history + 正确 x-router，未登录明确拒绝', async () => {
  const h = makeHarness({
    responses: {
      'gw:/everyday/api/v1/get_history': { status: 1, data: { list: [{ date: '2026-11-10', name: '那天的推荐' }] } },
    },
  });
  const r = await h.extras.recommendHistory(params({ mode: 'list', date: '2026-11-10' }));
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].date, '2026-11-10');
  const c = gatewayCall(h, '/everyday/api/v1/get_history');
  assert.equal(c.reqOpts.router, 'everydayrec.service.kugou.com');
  assert.equal(c.reqOpts.params.mode, 'list');
  assert.equal(c.reqOpts.params.date, '2026-11-10');
  assert.equal(c.reqOpts.params.platform, 'ios');

  const songMode = await h.extras.recommendHistory(params({ mode: 'song' }));
  assert.equal(Array.isArray(songMode.songs), true);

  const anon = makeHarness({ loggedIn: false });
  const denied = await anon.extras.recommendHistory(params());
  assert.equal(denied.error, 'KUGOU_AUTH_REQUIRED');
  assert.equal(gatewayCall(anon, '/everyday/api/v1/get_history'), undefined, '未登录不该打上游');
});

test('FM 不喜欢：/v2/personal_recommend + action=garbage，缺 ID / 未登录都不打上游', async () => {
  const h = makeHarness({ responses: { 'gw:/v2/personal_recommend': { status: 1 } } });
  const r = await h.extras.fmDislike({ hash: 'ABC123', songid: '777', playtime: '120' });
  assert.equal(r.success, true);
  const c = gatewayCall(h, '/v2/personal_recommend');
  assert.equal(c.reqOpts.router, 'persnfm.service.kugou.com');
  assert.equal(c.reqOpts.params.action, 'garbage');
  assert.equal(c.reqOpts.params.hash, 'ABC123');
  assert.equal(c.reqOpts.params.songid, '777');
  assert.equal(c.reqOpts.params.playtime, 120);

  assert.equal((await h.extras.fmDislike({})).error, 'MISSING_SONG_ID');
  const anon = makeHarness({ loggedIn: false });
  assert.equal((await anon.extras.fmDislike({ hash: 'ABC' })).error, 'KUGOU_AUTH_REQUIRED');
  assert.equal(gatewayCall(anon, '/v2/personal_recommend'), undefined);
});

test('歌单移除：复用项目已有 handleKugouRemoveSongFromList，不另写写协议', async () => {
  const h = makeHarness();
  const r = await h.extras.playlistRemoveSong({ pid: '900', song: { hash: 'ABC' } });
  assert.equal(r.success, true);
  const c = h.calls.filter(x => x.kind === 'remove')[0];
  assert.equal(c.listId, '900');
  assert.equal(c.song.hash, 'ABC');
  assert.equal(c.cookie, 'KuGoo=test;');
  assert.equal((await h.extras.playlistRemoveSong({})).error, 'MISSING_LIST_ID');
  assert.equal((await makeHarness({ loggedIn: false }).extras.playlistRemoveSong({ pid: '1' })).error, 'KUGOU_AUTH_REQUIRED');
});

test('缺少必填参数时返回明确 error，不打上游', async () => {
  const h = makeHarness({});
  assert.equal((await h.extras.albumDetail(params())).error, 'MISSING_ALBUM_ID');
  assert.equal((await h.extras.albumSongs(params())).error, 'MISSING_ALBUM_ID');
  assert.equal((await h.extras.artistDetail(params())).error, 'MISSING_ARTIST_ID');
  assert.equal((await h.extras.artistAlbums(params())).error, 'MISSING_ARTIST_ID');
  assert.equal((await h.extras.searchCollections(params())).error, 'MISSING_KEYWORDS');
  assert.equal(h.calls.length, 0);
});
