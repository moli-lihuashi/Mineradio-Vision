'use strict';

// 批次2 QQ 增补能力的「真接入」证明。
//
// 重点守住三件事：
//   ① 每个 handler 真的用一手文档的 module/method 打了 musicu.fcg；
//   ② 写入必须检查外层 code / 业务块 code / data.retCode 三层 —— 一手文档
//      明确记录「外层 0、业务块 80105、retCode 0」的假成功；
//   ③ 红心歌单（dirId 201）需要 zzc 签名加密通道，必须明确拒绝，不许硬接。
//
// 这是合成正例（无账号），不证明真实账号下写入生效；公开只读接口的真实数据在
// .workbuddy/harness/probe-qq-protocol.js 与真起服务探针里验证。

const test = require('node:test');
const assert = require('node:assert/strict');
const createQQExtras = require('../server/qq/extras');

function track(id, mid, name) {
  return { id, mid, name, singer: [{ name: '歌手' }], album: { mid: 'alb1', name: '专辑' }, interval: 200 };
}

function makeHarness(blocks, options) {
  const calls = [];
  const opts = options || {};
  const ctx = {
    qqMusicRequest: async function (payload, reqOpts) {
      const key = Object.keys(payload).find(k => k !== 'comm') || 'req_0';
      const req = payload[key];
      calls.push({ key, module: req.module, method: req.method, param: req.param, reqOpts, hasComm: 'comm' in payload });
      const entry = blocks && blocks[req.method];
      if (typeof entry === 'function') return entry(req.param);
      const block = entry || { code: 0, data: {} };
      return { code: (opts.outerCode != null ? opts.outerCode : 0), [key]: block };
    },
    qqGetJSON: async function (targetUrl, params) {
      calls.push({ qqGetJSON: targetUrl, params });
      return opts.createdPlaylists || { data: { disslist: [] } };
    },
    mapQQPlaylistTrack: function (raw) {
      if (!raw) return null;
      return { provider: 'qq', id: raw.mid || String(raw.id || ''), qqId: raw.id, name: raw.name || '' };
    },
    qqAlbumCover: function (mid) { return mid ? 'https://cover/' + mid : ''; },
    getQQLoginInfo: async function () { return { loggedIn: true, userId: 12345 }; },
    handleQQPlaylistTracks: async function (pid) {
      calls.push({ readBack: pid });
      return { tracks: (opts.readBackTracks || []).map(id => ({ qqId: id, id: 'mid' + id })) };
    },
  };
  return { extras: createQQExtras(ctx), calls: calls };
}

function params(obj) { return new URLSearchParams(obj || {}); }

function lastCall(h, method) {
  return h.calls.filter(c => c.method === method).pop();
}

const ACCOUNT = { loggedIn: true, userId: 12345 };

test('真实推荐替换空壳：guessYouLike 调 MbTrackRadioSvr/get_radio_track 并返回歌曲', async () => {
  const h = makeHarness({
    get_radio_track: { code: 0, data: { id: 368, name: '睡前', tracks: [track(101, 'mid101', 'A'), track(102, 'mid102', 'B')] } },
  });
  const r = await h.extras.guessYouLike(params({ limit: '12' }));
  assert.equal(r.songs.length, 2);
  assert.equal(r.source, 'qq-radio');
  assert.equal(r.radioName, '睡前');
  const c = lastCall(h, 'get_radio_track');
  assert.equal(c.module, 'music.radioProxy.MbTrackRadioSvr');
  assert.equal(c.reqOpts.cookie, false, '匿名推荐不该强带 cookie');
});

test('上游业务块报错时推荐返回明确原因，不静默空数组', async () => {
  const h = makeHarness({ get_radio_track: { code: 1000, data: {} } });
  const r = await h.extras.guessYouLike(params());
  assert.equal(r.songs.length, 0);
  assert.match(r.message, /上游校验未通过/);
  assert.equal(r.code, 1000);
});

test('推荐歌单 / 私人雷达 / 相似歌曲 / 榜单分组各自接对 module 与参数', async () => {
  const h = makeHarness({
    GetRecommendFeed: { code: 0, data: { List: [{ Playlist: { basic: { tid: 7, title: '推荐歌单', song_cnt: 12, creator: { nick: '小编' } } } }], HasMore: true } },
    GetRadarSong: { code: 0, data: { VecSongs: [{ Track: track(201, 'mid201', '雷达曲') }], HasMore: true } },
    GetSimilarSongs: { code: 0, data: { vecSong: [{ track: track(301, 'mid301', '相似曲') }] } },
    GetAll: { code: 0, data: { group: [{ groupId: 0, groupName: '巅峰榜', toplist: [{ topId: 26, title: '热歌榜' }] }] } },
  });
  const pl = await h.extras.recommendPlaylists(params({ page: '2', limit: '10' }));
  assert.equal(pl.playlists[0].name, '推荐歌单');
  assert.equal(pl.nextPage, 3);
  assert.deepEqual(lastCall(h, 'GetRecommendFeed').param, { From: 20, Size: 10 });

  const radar = await h.extras.radarSongs(params({ page: '2' }));
  assert.equal(radar.songs[0].name, '雷达曲');
  assert.equal(lastCall(h, 'GetRadarSong').param.Page, 2);

  const similar = await h.extras.similarSongs(params({ songid: '999' }));
  assert.equal(similar.songs[0].name, '相似曲');
  assert.equal(lastCall(h, 'GetSimilarSongs').param.songid, 999);

  const groups = await h.extras.toplistGroups();
  assert.equal(groups.groups[0].toplists[0].name, '热歌榜');
  assert.equal(lastCall(h, 'GetAll').module, 'music.musicToplist.Toplist');
});

test('每日推荐区块：接 get_recommend_feed，标题兼容对象与字符串两种形态', async () => {
  const h = makeHarness({
    get_recommend_feed: {
      code: 0,
      data: {
        load_mark: 'lm-1',
        v_shelf: [
          { id: 's1', title: { title: '每日推荐' }, group: 'daily' },
          { id: 's2', title: '猜你喜欢', group: 'guess' },
          { id: 's3', more: { title: '更多新歌' }, group: 'new' },
          { id: 's4' },
        ],
      },
    },
  });
  const r = await h.extras.dailyFeed(params({ page: '2' }));
  // 第 4 个区块没有任何标题字段：实现按「区块 N」兜底而不是丢弃，避免整块内容消失。
  assert.deepEqual(r.shelves.map(s => s.title), ['每日推荐', '猜你喜欢', '更多新歌', '区块 4']);
  assert.equal(r.loadMark, 'lm-1');
  assert.equal(r.page, 2);
  const c = lastCall(h, 'get_recommend_feed');
  assert.equal(c.module, 'music.recommend.RecommendFeed');
  assert.equal(c.param.page, 2);
  assert.equal(c.param.direction, 0);
  assert.ok(Array.isArray(c.param.v_cache) && Array.isArray(c.param.v_uniq));
});

test('榜单详情必须同时带 offset 与 num（实号实测：只传 topId 返回 0 条）', async () => {
  const h = makeHarness({
    GetDetail: { code: 0, data: { title: '热歌榜', songInfoList: [{ track_info: track(501, 'mid501', '榜单曲') }] } },
  });
  const r = await h.extras.toplistDetail(params({ id: '26', limit: '20', offset: '40' }));
  assert.equal(r.songs.length, 1);
  const c = lastCall(h, 'GetDetail');
  assert.equal(c.param.topId, 26);
  assert.equal(c.param.num, 20, '缺 num 时上游 songInfoList 为空');
  assert.equal(c.param.offset, 40);
});

test('歌手歌曲为空时必须给原因，不能返回空 message', async () => {
  const h = makeHarness({ GetSingerSongList: { code: 0, data: { totalNum: 0, songList: [] } } });
  const r = await h.extras.artistSongs(params({ id: 'not-a-singer' }));
  assert.equal(r.songs.length, 0);
  assert.match(r.message, /没有返回歌曲/);
  assert.match(r.message, /totalNum=0/);
});

test('歌手专辑 / 歌曲 / 分类搜索：参数与搜索特殊信封', async () => {
  const h = makeHarness({
    GetAlbumList: { code: 0, data: { albumList: [{ albumMid: 'alb9', albumName: '专辑九', singerName: '某人', publishDate: '2026-01-02', totalNum: 10 }], total: 1 } },
    GetSingerSongList: { code: 0, data: { songList: [{ songInfo: track(401, 'mid401', '歌手的歌') }], totalNum: 1013 } },
    DoSearchForQQMusicDesktop: { code: 0, data: { body: { album: { list: [{ albumMID: 'albS', albumName: '搜到的专辑' }], totalnum: 1 } } } },
  });
  const albums = await h.extras.artistAlbums(params({ id: 'singer1', limit: '5' }));
  assert.equal(albums.albums[0].name, '专辑九');
  assert.equal(lastCall(h, 'GetAlbumList').param.singerMid, 'singer1');

  const songs = await h.extras.artistSongs(params({ id: 'singer1' }));
  assert.equal(songs.songs[0].name, '歌手的歌');
  assert.equal(songs.total, 1013);

  const found = await h.extras.searchCollections(params({ keywords: '夜', kind: 'album' }));
  assert.equal(found.albums[0].name, '搜到的专辑');
  const c = lastCall(h, 'DoSearchForQQMusicDesktop');
  assert.equal(c.key, 'music.search.SearchCgiService', '搜索信封 key 必须等于 module 名');
  assert.equal(c.hasComm, false, '搜索信封不能带顶层 comm');
  assert.equal(c.param.query, '夜');
  assert.equal(c.param.search_type, 2, 'album 实测是 search_type=2');
  assert.equal('remoteplace' in c.param, false, '多带 remoteplace 会让所有 list 返回空（实测）');
});

test('搜索类型映射与封面对象：song=0/artist=1/album=2/playlist=3，cover 必须是字符串', async () => {
  const h = makeHarness({
    GetRecommendFeed: { code: 0, data: { List: [{ Playlist: { basic: { tid: 8, title: '带对象封面的歌单', picurl: { id: 1, mid: '', medium_url: 'https://cover/medium.jpg', big_url: 'https://cover/big.jpg' } } } }] } },
    DoSearchForQQMusicDesktop: { code: 0, data: { meta: { estimate_sum: 42 }, body: { album: { list: [{ albumMID: 'a1', albumName: '专辑', albumPic: 'https://cover/album.jpg' }] } } } },
  });
  const pl = await h.extras.recommendPlaylists(params());
  assert.equal(pl.playlists[0].cover, 'https://cover/medium.jpg');
  assert.equal(typeof pl.playlists[0].cover, 'string');

  for (const [kind, type] of [['song', 0], ['artist', 1], ['album', 2], ['playlist', 3]]) {
    await h.extras.searchCollections(params({ keywords: '周杰伦', kind }));
    assert.equal(lastCall(h, 'DoSearchForQQMusicDesktop').param.search_type, type, kind + ' 的 search_type');
  }
  const albumSearch = await h.extras.searchCollections(params({ keywords: '周杰伦', kind: 'album' }));
  assert.equal(albumSearch.total, 42, '总数取 data.meta.estimate_sum');
  assert.equal(albumSearch.albums[0].cover, 'https://cover/album.jpg');
});

test('写入三层返回码：业务块 80105 + retCode 0 必须判失败，不能误报成功', async () => {
  // 一手文档记录的真实假成功形态：外层 0、业务块 80105、内层 retCode 0。
  const h = makeHarness({
    AddPlaylist: { code: 80105, data: { retCode: 0, dirId: 555 } },
  });
  const r = await h.extras.playlistCreate(ACCOUNT, { name: '测试歌单' });
  assert.equal(r.success, false);
  assert.match(r.message, /block=80105/);
  assert.equal(r.codes.retCode, 0, 'retCode 是 0 也不能当成功');
  assert.equal(h.calls.filter(c => c.qqGetJSON).length, 0, '判失败后不该继续读回');
});

test('创建歌单：调 AddPlaylist 且读回确认后 verified=true', async () => {
  const h = makeHarness({
    AddPlaylist: { code: 0, data: { retCode: 0, dirId: 555 } },
  }, { createdPlaylists: { data: { disslist: [{ dissid: 555, diss_name: '新歌单' }] } } });
  const r = await h.extras.playlistCreate(ACCOUNT, { name: '新歌单' });
  assert.equal(r.success, true);
  assert.equal(r.verified, true);
  assert.equal(r.playlist.id, '555');
  assert.equal(lastCall(h, 'AddPlaylist').module, 'music.musicasset.PlaylistBaseWrite');
  assert.equal(lastCall(h, 'AddPlaylist').param.dirName, '新歌单');
  assert.ok(h.calls.some(c => c.qqGetJSON && String(c.qqGetJSON).includes('fcg_user_created_diss')), '必须读回确认');
});

test('歌单加删：从 song.qqId 取数字 ID，MID 明确拒绝，读回确认 verified', async () => {
  const added = makeHarness({
    AddSonglist: { code: 0, data: { retCode: 0 } },
  }, { readBackTracks: [777] });
  const r1 = await added.extras.playlistAddSong(ACCOUNT, {
    pid: '900', id: 'mid777', song: { id: 'mid777', qqId: 777 },
  });
  assert.equal(r1.success, true);
  assert.equal(r1.verified, true);
  assert.deepEqual(lastCall(added, 'AddSonglist').param.v_songInfo, [{ songId: 777, songType: 0 }]);

  const removed = makeHarness({ DelSonglist: { code: 0, data: { retCode: 0 } } }, { readBackTracks: [] });
  const r2 = await removed.extras.playlistRemoveSong(ACCOUNT, { pid: '900', ids: '777' });
  assert.equal(r2.success, true);
  assert.equal(r2.verified, true);
  assert.equal(lastCall(removed, 'DelSonglist').module, 'music.musicasset.PlaylistDetailWrite');

  const midOnly = makeHarness({});
  const r3 = await midOnly.extras.playlistAddSong(ACCOUNT, { pid: '900', id: 'mid999' });
  assert.equal(r3.success, false);
  assert.equal(r3.error, 'QQ_SONG_ID_MUST_BE_NUMERIC');
  assert.match(r3.message, /MID/);
  assert.equal(midOnly.calls.length, 0, '没有数字 ID 时根本不该打上游');
});

test('红心歌单 dirId 201 明确拒绝，不硬接签名通道', async () => {
  const h = makeHarness({ AddSonglist: { code: 0, data: { retCode: 0 } } });
  const r = await h.extras.playlistAddSong(ACCOUNT, { pid: '201', ids: '777' });
  assert.equal(r.success, false);
  assert.equal(r.error, 'QQ_LIKED_SONGS_SIGNATURE_REQUIRED');
  assert.match(r.message, /zzc 签名/);
  assert.equal(h.calls.length, 0, '被拒绝时不应发出任何上游写请求');
});

test('最近播放 / 红心状态：需登录，code 1000 时给明确提示', async () => {
  const h = makeHarness({
    GetPlayRecentlyInfo: { code: 1000, data: {} },
    IsSongFanByMid: { code: 0, data: { m_fan: { midA: true, midB: false } } },
  });
  const recent = await h.extras.recentPlayed(ACCOUNT, params());
  assert.equal(recent.songs.length, 0);
  // 实号验证后文案改为「已登录但被拒、参数形态未验证」，不再误导成「需要登录」。
  assert.match(recent.message, /code 1000/);
  assert.match(recent.message, /尚未在实号下验证成功/);
  assert.equal(recent.code, 1000);

  const liked = await h.extras.songLikeCheck(ACCOUNT, params({ mids: 'midA,midB' }));
  assert.deepEqual(liked.liked, { midA: true, midB: false });
  assert.equal(lastCall(h, 'IsSongFanByMid').reqOpts.cookie, true, '账号接口必须带 cookie');
});

test('缺少必填参数时返回明确 error，不打上游', async () => {
  const h = makeHarness({});
  assert.equal((await h.extras.similarSongs(params())).error, 'MISSING_SONG_ID');
  assert.equal((await h.extras.relatedPlaylists(params())).error, 'MISSING_SONG_ID');
  assert.equal((await h.extras.toplistDetail(params())).error, 'MISSING_TOPLIST_ID');
  assert.equal((await h.extras.artistAlbums(params())).error, 'MISSING_ARTIST_ID');
  assert.equal((await h.extras.artistSongs(params())).error, 'MISSING_ARTIST_ID');
  assert.equal((await h.extras.searchCollections(params())).error, 'MISSING_KEYWORDS');
  assert.equal((await h.extras.songLikeCheck(ACCOUNT, params())).error, 'MISSING_MIDS');
  assert.equal((await h.extras.playlistCreate(ACCOUNT, {})).error, 'MISSING_PLAYLIST_NAME');
  assert.equal((await h.extras.playlistRemoveSong(ACCOUNT, {})).error, 'MISSING_DIRID_OR_IDS');
  assert.equal((await h.extras.playlistCreate(ACCOUNT, { name: 'x'.repeat(21) })).error, 'NAME_TOO_LONG');
  assert.equal(h.calls.length, 0, '参数不全时不该发出任何请求');
});
