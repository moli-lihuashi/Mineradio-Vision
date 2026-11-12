'use strict';

// 批次1 网易云增补能力的「真接入」证明。
//
// 起因：上一轮清单里三处「接口已存在但固定返回空」的教训（QQ 推荐、QQ 账号只读、
// Spotify 取址/歌词）。静态对账只能证明路径存在，证明不了取数。
// 本测试用合成上游（mock NeteaseCloudMusicApi 方法）逐一验证：
//   ① 每个 handler 真的 await 了对应上游方法；
//   ② cookie / 关键参数（mode、date、type、op、uid）确实透传；
//   ③ 上游返回内容时能映射出非空结果；上游返回空时带 message 说明原因。
// 这不是在线实测（没有账号），但它把「写了个空壳路由」这条路堵死了。

const test = require('node:test');
const assert = require('node:assert/strict');
const createNeteaseExtras = require('../server/netease/extras');

const UPSTREAM_NAMES = [
  'personal_fm', 'personal_fm_mode', 'fm_trash', 'user_cloud', 'user_cloud_detail',
  'user_record', 'history_recommend_songs', 'history_recommend_songs_detail',
  'style_list', 'style_preference', 'style_detail', 'recommend_songs_dislike',
  'scrobble', 'homepage_block_page', 'homepage_dragon_ball',
  'artist_album', 'album_sublist', 'cloudsearch', 'playlist_tracks', 'playlist_track_delete',
];

function song(id, name) {
  return { id, name, ar: [{ id: 1, name: '歌手' }], al: { name: '专辑', picUrl: 'cover.jpg' }, dt: 210000 };
}

function makeHarness(responses) {
  const calls = [];
  const ctx = {
    mapSongRecord(s) {
      s = s || {};
      return { provider: 'netease', id: s.id, name: s.name, duration: s.dt || 0 };
    },
    get userCookie() { return 'MUSIC_U=synthetic-cookie'; },
  };
  UPSTREAM_NAMES.forEach(function (name) {
    ctx[name] = async function (args) {
      calls.push({ name: name, args: args });
      const entry = responses && responses[name];
      if (typeof entry === 'function') return entry(args);
      if (entry === 'throw') throw new Error('upstream-down');
      return entry || { body: { code: 200, data: [] } };
    };
  });
  return { extras: createNeteaseExtras(ctx), calls: calls };
}

function params(obj) {
  return new URLSearchParams(obj || {});
}

function lastCall(h, name) {
  const found = h.calls.filter(c => c.name === name);
  return found[found.length - 1];
}

const ACCOUNT = { loggedIn: true, userId: 4242 };

test('私人 FM：默认走 personal_fm，带 mode 走 personal_fm_mode，歌曲非空', async () => {
  const h = makeHarness({
    personal_fm: { body: { code: 200, data: [song(1, 'A'), song(2, 'B')] } },
    personal_fm_mode: { body: { code: 200, data: [song(3, 'C')] } },
  });
  const plain = await h.extras.personalFm(ACCOUNT, params());
  assert.equal(plain.songs.length, 2);
  assert.equal(plain.source, 'personal_fm');
  assert.equal(lastCall(h, 'personal_fm').args.cookie, 'MUSIC_U=synthetic-cookie');

  const themed = await h.extras.personalFm(ACCOUNT, params({ mode: 'EXPLORE', submode: 'FOCUS', limit: '5' }));
  assert.equal(themed.songs.length, 1);
  assert.equal(themed.mode, 'EXPLORE');
  assert.equal(themed.source, 'personal_fm_mode');
  const modeCall = lastCall(h, 'personal_fm_mode');
  assert.equal(modeCall.args.mode, 'EXPLORE');
  assert.equal(modeCall.args.submode, 'FOCUS');
  assert.equal(modeCall.args.limit, 5);
  assert.equal(modeCall.args.cookie, 'MUSIC_U=synthetic-cookie');
});

test('私人 FM 不喜欢：fm_trash 带 id 与 cookie', async () => {
  const h = makeHarness({ fm_trash: { body: { code: 200 } } });
  const r = await h.extras.fmTrash({ id: '77' });
  assert.equal(r.success, true);
  assert.equal(lastCall(h, 'fm_trash').args.id, '77');
  assert.ok(lastCall(h, 'fm_trash').args.cookie);
});

test('音乐云盘：user_cloud 分页参数 + simpleSong 映射 + 空结果带 message', async () => {
  const h = makeHarness({
    user_cloud: { body: { code: 200, count: 1, data: [{ songId: 900, fileName: 'x.mp3', fileSize: 1024, simpleSong: song(9, '云盘曲') }] } },
  });
  const r = await h.extras.userCloud(ACCOUNT, params({ limit: '12', offset: '6' }));
  assert.equal(r.songs.length, 1);
  assert.equal(r.songs[0].cloudId, 900);
  assert.equal(r.total, 1);
  const c = lastCall(h, 'user_cloud');
  assert.equal(c.args.limit, 12);
  assert.equal(c.args.offset, 6);
  assert.ok(c.args.cookie);

  const empty = await makeHarness().extras.userCloud(ACCOUNT, params());
  assert.equal(empty.songs.length, 0);
  assert.ok(empty.message && empty.message.length > 0, '空云盘要写原因，不能静默');
});

test('云盘详情：user_cloud_detail 透传 id', async () => {
  const h = makeHarness({ user_cloud_detail: { body: { code: 200, data: [{ songId: 5, simpleSong: song(5, 'D') }] } } });
  const r = await h.extras.userCloudDetail(ACCOUNT, params({ id: '5,6' }));
  assert.equal(r.songs.length, 1);
  assert.equal(lastCall(h, 'user_cloud_detail').args.id, '5,6');
});

test('听歌排行：user_record 用账号 uid，type=1 取 weekData', async () => {
  const h = makeHarness({
    user_record: { body: { code: 200, weekData: [{ playCount: 12, score: 90, song: song(11, '常听') }], allData: [{ playCount: 99, song: song(12, '总榜') }] } },
  });
  const week = await h.extras.listenRank(ACCOUNT, params({ type: '1' }));
  assert.equal(week.range, 'week');
  assert.equal(week.songs[0].playCount, 12);
  const c = lastCall(h, 'user_record');
  assert.equal(c.args.uid, 4242);
  assert.equal(c.args.type, 1);
  assert.ok(c.args.cookie);

  const all = await h.extras.listenRank(ACCOUNT, params());
  assert.equal(all.range, 'all');
  assert.equal(all.songs[0].playCount, 99);
});

test('历史日推：history 取日期，detail 按 date 取歌曲', async () => {
  const h = makeHarness({
    history_recommend_songs: { body: { code: 200, data: { days: ['2026-11-10', '2026-11-11'] } } },
    history_recommend_songs_detail: { body: { code: 200, data: [song(21, '那天推的歌')] } },
  });
  const days = await h.extras.recommendHistory(ACCOUNT);
  assert.deepEqual(days.dates, ['2026-11-10', '2026-11-11']);
  const detail = await h.extras.recommendHistoryDetail(ACCOUNT, params({ date: '2026-11-11' }));
  assert.equal(detail.songs.length, 1);
  assert.equal(lastCall(h, 'history_recommend_songs_detail').args.date, '2026-11-11');
});

test('曲风：style_list / style_preference / style_detail 各自接上游', async () => {
  const h = makeHarness({
    style_list: { body: { code: 200, data: [{ id: 7, name: 'City Pop' }] } },
    style_preference: { body: { code: 200, data: { tags: [7] } } },
    style_detail: { body: { code: 200, data: { songs: [song(31, '风格曲')] } } },
  });
  const list = await h.extras.styleList();
  assert.equal(list.tags.length, 1);
  assert.equal(list.tags[0].name, 'City Pop');
  const pref = await h.extras.stylePreference();
  assert.deepEqual(pref.preference, { tags: [7] });
  const detail = await h.extras.styleDetail(params({ tagId: '7' }));
  assert.equal(detail.songs.length, 1);
  assert.equal(lastCall(h, 'style_detail').args.tagId, '7');
});

test('推荐反馈与播放上报：dislike / scrobble 参数完整', async () => {
  const h = makeHarness({
    recommend_songs_dislike: { body: { code: 200 } },
    scrobble: { body: { code: 200 } },
  });
  const dislike = await h.extras.recommendDislike({ id: '41' });
  assert.equal(dislike.success, true);
  assert.equal(lastCall(h, 'recommend_songs_dislike').args.id, '41');

  const report = await h.extras.scrobblePlay({ id: '42', sourceid: 'pl-1', time: '180' });
  assert.equal(report.success, true);
  const c = lastCall(h, 'scrobble');
  assert.equal(c.args.id, '42');
  assert.equal(c.args.sourceid, 'pl-1');
  assert.equal(c.args.time, 180);
  assert.ok(c.args.cookie);
});

test('探索页：block/creatives 解析成 sections，解析不出时写 message', async () => {
  const h = makeHarness({
    homepage_block_page: {
      body: {
        code: 200,
        data: {
          hasMore: true,
          cursor: 'next-1',
          blocks: [{
            blockCode: 'HOMEPAGE_BLOCK_PLAYLIST_RCMD',
            blockTitle: { title: '为你推荐' },
            creatives: [{
              resources: [{
                resourceId: 'pl-8',
                resourceType: 'PLAYLIST',
                uiElement: {
                  mainTitle: { title: '深夜歌单' },
                  subTitle: { title: '12 首' },
                  image: { imageUrl: 'p.jpg' },
                },
              }],
            }],
          }],
        },
      },
    },
    homepage_dragon_ball: { body: { code: 200, data: [{ id: 1, name: '每日推荐', iconUrl: 'i.png' }] } },
  });
  const home = await h.extras.exploreHome(params({ refresh: '1', cursor: 'c0' }));
  assert.equal(home.sections.length, 1);
  assert.equal(home.sections[0].title, '为你推荐');
  assert.equal(home.sections[0].items[0].name, '深夜歌单');
  assert.equal(home.cursor, 'next-1');
  const c = lastCall(h, 'homepage_block_page');
  assert.equal(c.args.refresh, true);
  assert.equal(c.args.cursor, 'c0');

  const entries = await h.extras.exploreEntries();
  assert.equal(entries.entries[0].name, '每日推荐');

  const empty = await makeHarness().extras.exploreHome(params());
  assert.equal(empty.sections.length, 0);
  assert.ok(empty.message.includes('没有可解析'), '解析不出内容要明说');
});

test('歌手专辑 / 收藏专辑库：hotAlbums 与 album_sublist 都能映射', async () => {
  const h = makeHarness({
    artist_album: { body: { code: 200, hotAlbums: [{ id: 51, name: '专辑A', artist: { name: '某歌手' }, size: 10, picUrl: 'a.jpg', publishTime: 0 }], more: true } },
    album_sublist: { body: { code: 200, count: 1, data: [{ id: 52, name: '收藏专辑', picUrl: 'b.jpg' }] } },
  });
  const byArtist = await h.extras.artistAlbums(params({ id: '8', limit: '10' }));
  assert.equal(byArtist.albums.length, 1);
  assert.equal(byArtist.albums[0].artist, '某歌手');
  assert.equal(lastCall(h, 'artist_album').args.id, '8');

  const mine = await h.extras.userAlbums(ACCOUNT, params({ limit: '25' }));
  assert.equal(mine.albums.length, 1);
  assert.equal(lastCall(h, 'album_sublist').args.limit, 25);
});

test('分类搜索：kind=album→type 10，playlist→1000，artist→100', async () => {
  const h = makeHarness({
    cloudsearch: function (args) {
      if (args.type === 10) return { body: { result: { albums: [{ id: 61, name: '搜到的专辑' }], albumCount: 1 } } };
      if (args.type === 1000) return { body: { result: { playlists: [{ id: 62, name: '搜到的歌单' }], playlistCount: 1 } } };
      return { body: { result: { artists: [{ id: 63, name: '搜到的歌手' }], artistCount: 1 } } };
    },
  });
  const albums = await h.extras.searchCollections(params({ keywords: '夜', kind: 'album' }));
  assert.equal(albums.albums.length, 1);
  assert.equal(lastCall(h, 'cloudsearch').args.type, 10);
  const playlists = await h.extras.searchCollections(params({ keywords: '夜', kind: 'playlist' }));
  assert.equal(playlists.playlists.length, 1);
  assert.equal(lastCall(h, 'cloudsearch').args.type, 1000);
  const artists = await h.extras.searchCollections(params({ keywords: '夜', kind: 'artist' }));
  assert.equal(artists.artists.length, 1);
  assert.equal(lastCall(h, 'cloudsearch').args.type, 100);
});

test('从歌单移除歌曲：op=del，主路失败回落 playlist_track_delete', async () => {
  const ok = makeHarness({ playlist_tracks: { body: { code: 200 } } });
  const r1 = await ok.extras.removePlaylistSong({ pid: '900', ids: '1,2' });
  assert.equal(r1.success, true);
  assert.equal(lastCall(ok, 'playlist_tracks').args.op, 'del');
  assert.equal(lastCall(ok, 'playlist_tracks').args.tracks, '1,2');
  assert.equal(ok.calls.filter(c => c.name === 'playlist_track_delete').length, 0, '主路成功不该回落');

  const fallback = makeHarness({
    playlist_tracks: { body: { code: 400, message: 'not allowed' } },
    playlist_track_delete: { body: { code: 200 } },
  });
  const r2 = await fallback.extras.removePlaylistSong({ pid: '900', ids: '3' });
  assert.equal(r2.success, true);
  assert.equal(r2.attempts.length, 2);
  assert.equal(lastCall(fallback, 'playlist_track_delete').args.id, '900');
});

test('歌手不存在：上游抛无 message 的对象错误，返回空列表 + 明确原因', async () => {
  // 真实探针：NeteaseCloudMusicApi.artist_album({id:'1'}) 抛
  // { status:404, body:{ code:404, hotAlbums:null }, cookie:[] }，err.message 为 undefined。
  // 之前路由层只取 err.message，响应退化成 {"provider":"netease"}（原因不可见）。
  const h = makeHarness({
    artist_album: function () {
      throw { status: 404, body: { code: 404, hotAlbums: null }, cookie: [] };
    },
  });
  const r = await h.extras.artistAlbums(params({ id: '1' }));
  assert.equal(r.albums.length, 0);
  assert.match(r.message, /404/);
  assert.match(r.message, /歌手 ID/);
});

test('上游抛错时 handler 不外泄未处理异常，缺少必填参数返回明确 error', async () => {
  const h = makeHarness();
  assert.equal((await h.extras.fmTrash({})).error, 'MISSING_SONG_ID');
  assert.equal((await h.extras.removePlaylistSong({ pid: '1' })).error, 'MISSING_PID_OR_IDS');
  assert.equal((await h.extras.searchCollections(params())).error, 'MISSING_KEYWORDS');
  assert.equal((await h.extras.artistAlbums(params())).error, 'MISSING_ARTIST_ID');
  assert.equal((await h.extras.styleDetail(params())).error, 'MISSING_TAG_ID');
  assert.equal((await h.extras.userCloudDetail(ACCOUNT, params())).error, 'MISSING_CLOUD_ID');
});
