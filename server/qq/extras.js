'use strict';

// ====================================================================
//  QQ 音乐增补能力（2026-11-12 批次2）
//
//  协议依据（一手，非推断）：
//   · https://github.com/Yyyangshenghao/simple-music/blob/master/docs/qq-music-api.md
//   · .workbuddy/harness/probe-qq-protocol.js 的匿名实测：10 个只读候选中 9 个
//     返回外层 code:0 + 业务块 code:0 + 真实数据；仅「最近播放」需登录（code 1000）。
//
//  判定口径：只接有可验证 module/method 的能力。写入类严格检查
//  外层 code=0 / 业务块 code=0 / data.retCode=0 三层，并尽量读回确认。
//  以下能力**明确不接**（不写空壳）：
//   · 红心写入（dirId 201 的 AddSonglist/DelSonglist 需 zzc 签名 + ag-1 的 musics 通道，
//     明文 musicu.fcg 实测返回 80105 且不生效）；
//   · 收藏歌单 / 收藏专辑、用户云盘、听歌排行：一手文档没有可用协议与参数契约。
//
//  写接口未在真实账号下验证生效（无凭据）：响应带 verified 字段如实标注。
// ====================================================================

const COMM_ANON = {
  ct: 24, cv: 4747474, platform: 'yqq.json', uin: '0',
  format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, need_new_code: 1,
};

function asArray(v) { return Array.isArray(v) ? v : []; }
function text(v) { return String(v == null ? '' : v).trim(); }
function intInRange(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

module.exports = function createQQExtras(ctx) {
  const {
    qqMusicRequest, qqGetJSON,
    mapQQPlaylistTrack, qqAlbumCover,
    getQQLoginInfo, handleQQPlaylistTracks,
  } = ctx;

  function commFor(info) {
    return Object.assign({}, COMM_ANON, { uin: String((info && info.userId) || '0') });
  }

  // 统一信封：业务块 key 固定 req_0；搜索接口例外（见 searchCollections）。
  async function call(mod, method, param, opts) {
    const key = 'req_0';
    const payload = {
      comm: commFor(opts && opts.info),
      [key]: { module: mod, method, param: param || {} },
    };
    const json = await qqMusicRequest(payload, { cookie: !!(opts && opts.auth) });
    const block = json && json[key];
    return { json, block, data: (block && block.data) || {} };
  }

  function describeFailure(label, r) {
    const outer = Number(r.json && r.json.code) || 0;
    const blockCode = Number(r.block && r.block.code) || 0;
    const data = r.data || {};
    const retCode = data.retCode != null ? Number(data.retCode)
      : (data.retcode != null ? Number(data.retcode) : 0);
    return {
      outer, blockCode, retCode,
      ok: outer === 0 && blockCode === 0 && retCode === 0,
      reason: label + ' 上游校验未通过：outer=' + outer + ' block=' + blockCode + ' retCode=' + retCode,
    };
  }

  function mapSongs(rawTracks, mapTrack, limit) {
    const seen = new Set();
    const songs = [];
    asArray(rawTracks).forEach(track => {
      const mapped = mapTrack(track);
      if (!mapped || !(mapped.id || mapped.name)) return;
      const key = String(mapped.id || mapped.mid || mapped.name);
      if (seen.has(key)) return;
      seen.add(key);
      songs.push(mapped);
    });
    return limit ? songs.slice(0, limit) : songs;
  }

  function mapQQFeedPlaylist(row) {
    const basic = (row && (row.Playlist || row.playlist || row)) || {};
    const b = basic.basic || basic;
    const id = b.tid || b.disstid || b.dirid || b.dissid || b.id || '';
    // 真实抓包：PlaylistSquare 的 basic.picurl 是对象
    // { id, mid, small_url, medium_url, big_url }，不是字符串。直接透传会让前端拿到 [object Object]。
    const rawCover = b.picurl || b.cover || b.logo || b.diss_cover || '';
    const cover = typeof rawCover === 'string' ? rawCover
      : (rawCover && (rawCover.medium_url || rawCover.big_url || rawCover.small_url)) || '';
    return {
      provider: 'qq', source: 'qq', type: 'playlist',
      id: id ? String(id) : '',
      name: text(b.title || b.name || b.diss_name),
      cover,
      trackCount: Number(b.song_cnt || b.songnum || b.total_song_num || 0) || 0,
      playCount: Number(b.listen_num || b.visitnum || 0) || 0,
      creator: text((b.creator && (b.creator.nick || b.creator.name)) || b.nick || b.hostname),
    };
  }

  // ---------- 1. 真实推荐（替换 /api/qq/recommendations 的空壳） ----------
  // music.radioProxy.MbTrackRadioSvr/get_radio_track：匿名实测返回 data.tracks（真实歌曲）。
  async function guessYouLike(q) {
    const limit = intInRange(q.get('limit'), 1, 30, 12);
    const r = await call('music.radioProxy.MbTrackRadioSvr', 'get_radio_track', {});
    const check = describeFailure('猜你喜欢', r);
    if (!check.ok) return { provider: 'qq', songs: [], message: check.reason, code: check.blockCode };
    const songs = mapSongs(r.data.tracks, mapQQPlaylistTrack, limit);
    return {
      provider: 'qq',
      songs,
      source: 'qq-radio',
      radioName: text(r.data.name),
      message: songs.length ? '' : 'QQ 音乐本次没有返回推荐歌曲。',
    };
  }

  // ---------- 2. 每日推荐 feed ----------
  async function dailyFeed(q) {
    const page = intInRange(q.get('page'), 1, 20, 1);
    const r = await call('music.recommend.RecommendFeed', 'get_recommend_feed', {
      direction: 0, page, v_cache: [], v_uniq: [], s_num: 0,
    });
    const check = describeFailure('每日推荐', r);
    if (!check.ok) return { provider: 'qq', shelves: [], message: check.reason, code: check.blockCode };
    const shelves = asArray(r.data.v_shelf).map((s, i) => ({
      id: text(s.id || s.shelfId),
      title: text((s.title && (s.title.title || s.title)) || (s.more && s.more.title) || ('区块 ' + (i + 1))),
      group: text(s.group),
      raw: s,
    })).filter(s => s.title);
    return {
      provider: 'qq', shelves, page,
      loadMark: text(r.data.load_mark),
      message: shelves.length ? '' : 'QQ 主页推荐本次没有返回区块。',
    };
  }

  // ---------- 3. 推荐歌单 ----------
  async function recommendPlaylists(q) {
    const page = intInRange(q.get('page'), 0, 100, 0);
    const size = intInRange(q.get('limit'), 1, 30, 20);
    const r = await call('music.playlist.PlaylistSquare', 'GetRecommendFeed', { From: page * size, Size: size });
    const check = describeFailure('推荐歌单', r);
    if (!check.ok) return { provider: 'qq', playlists: [], message: check.reason, code: check.blockCode };
    const playlists = asArray(r.data.List).map(mapQQFeedPlaylist).filter(p => p.id && p.name);
    return {
      provider: 'qq', playlists, page, hasMore: !!r.data.HasMore,
      nextPage: r.data.HasMore ? page + 1 : null,
      message: playlists.length ? '' : 'QQ 推荐歌单本次没有返回内容。',
    };
  }

  // ---------- 4. 私人雷达 ----------
  async function radarSongs(q) {
    const page = intInRange(q.get('page'), 1, 20, 2);
    const r = await call('music.recommend.TrackRelationServer', 'GetRadarSong', { Page: page });
    const check = describeFailure('私人雷达', r);
    if (!check.ok) return { provider: 'qq', songs: [], message: check.reason, code: check.blockCode };
    const tracks = asArray(r.data.VecSongs).map(row => row && (row.Track || row.track));
    return {
      provider: 'qq', songs: mapSongs(tracks, mapQQPlaylistTrack, 30),
      page, hasMore: !!r.data.HasMore, nextPage: r.data.HasMore ? page + 1 : null,
      message: '',
    };
  }

  // ---------- 5. 相似歌曲 ----------
  async function similarSongs(q) {
    const songid = text(q.get('songid') || q.get('id'));
    if (!songid) return { provider: 'qq', error: 'MISSING_SONG_ID', songs: [] };
    const r = await call('music.recommend.TrackRelationServer', 'GetSimilarSongs', { songid: Number(songid) || songid });
    const check = describeFailure('相似歌曲', r);
    if (!check.ok) return { provider: 'qq', songs: [], message: check.reason, code: check.blockCode };
    let tracks = asArray(r.data.vecSong).map(row => row && (row.track || row.Track));
    if (!tracks.length) {
      asArray(r.data.vecSongNew).forEach(group => {
        asArray(group && (group.songs || group.vecSong)).forEach(row => tracks.push(row && (row.track || row.Track)));
      });
    }
    return {
      provider: 'qq', songid,
      songs: mapSongs(tracks, mapQQPlaylistTrack, intInRange(q.get('limit'), 1, 30, 10)),
      message: '',
    };
  }

  // ---------- 6. 相关歌单 ----------
  async function relatedPlaylists(q) {
    const songid = text(q.get('songid') || q.get('id'));
    if (!songid) return { provider: 'qq', error: 'MISSING_SONG_ID', playlists: [] };
    const previous = text(q.get('previousIds')).split(',').map(Number).filter(Boolean);
    const r = await call('music.recommend.TrackRelationServer', 'GetRelatedPlaylist', {
      songid: Number(songid) || songid, vecPlaylist: previous,
    });
    const check = describeFailure('相关歌单', r);
    if (!check.ok) return { provider: 'qq', playlists: [], message: check.reason, code: check.blockCode };
    let rows = asArray(r.data.vecPlaylist);
    if (!rows.length) {
      asArray(r.data.vecPlaylistNew).forEach(group => rows = rows.concat(asArray(group && (group.playlists || group.vecPlaylist))));
    }
    return {
      provider: 'qq', songid, playlists: rows.filter(Boolean), hasMore: !!r.data.hasMore,
      message: rows.length ? '' : '该歌曲没有返回相关歌单。',
    };
  }

  // ---------- 7/8. 排行榜 ----------
  async function toplistGroups() {
    const r = await call('music.musicToplist.Toplist', 'GetAll', {});
    const check = describeFailure('排行榜分组', r);
    if (!check.ok) return { provider: 'qq', groups: [], message: check.reason, code: check.blockCode };
    const groups = asArray(r.data.group).map(g => ({
      id: g.groupId, name: text(g.groupName),
      toplists: asArray(g.toplist).map(t => ({
        id: t.topId || t.id, name: text(t.title || t.name),
        cover: text(t.picUrl || t.frontPicUrl || t.pic),
        updateTime: text(t.updateTime || t.date),
      })).filter(t => t.id),
    })).filter(g => g.name);
    return { provider: 'qq', groups, message: groups.length ? '' : 'QQ 排行榜本次没有返回分组。' };
  }

  async function toplistDetail(q) {
    const id = text(q.get('id'));
    if (!id) return { provider: 'qq', error: 'MISSING_TOPLIST_ID', songs: [] };
    // 实测（2026-11-13 实号）：只传 topId 时 songInfoList 返回 0 条；
    // 带上 num（或 page）才有数据。必须两个都传。
    const limit = intInRange(q.get('limit'), 1, 100, 50);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const r = await call('music.musicToplist.Toplist', 'GetDetail', {
      topId: Number(id) || id, offset, num: limit,
    });
    const check = describeFailure('榜单详情', r);
    if (!check.ok) return { provider: 'qq', songs: [], message: check.reason, code: check.blockCode };
    const d = r.data || {};
    let tracks = asArray(d.songInfoList).map(row => row && (row.track_info || row));
    if (!tracks.length) tracks = asArray(d.song);
    const songs = mapSongs(tracks, mapQQPlaylistTrack, limit);
    return {
      provider: 'qq', id,
      name: text(d.title || d.topTitle || d.name),
      songs,
      message: songs.length ? '' : '该榜单没有返回曲目（需同时带 offset 与 num，缺一会返回空）。',
    };
  }

  // ---------- 9/10. 歌手专辑 / 歌曲（批次4 的 QQ 部分） ----------
  async function artistAlbums(q) {
    const singerMid = text(q.get('id') || q.get('singerMid'));
    if (!singerMid) return { provider: 'qq', error: 'MISSING_ARTIST_ID', albums: [] };
    const limit = intInRange(q.get('limit'), 1, 80, 30);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const r = await call('music.musichallAlbum.AlbumListServer', 'GetAlbumList', {
      singerMid, begin: offset, num: limit, order: 0,
    });
    const check = describeFailure('歌手专辑', r);
    if (!check.ok) return { provider: 'qq', albums: [], message: check.reason, code: check.blockCode };
    const albums = asArray(r.data.albumList).map(a => ({
      provider: 'qq', id: text(a.albumMid || a.albumID),
      name: text(a.albumName), artist: text(a.singerName),
      cover: qqAlbumCover(a.albumMid, 300),
      publishDate: text(a.publishDate).slice(0, 10),
      songCount: Number(a.totalNum || 0) || 0,
      subType: text(a.albumType),
    })).filter(a => a.id);
    return {
      provider: 'qq', singerMid, albums,
      total: Number(r.data.total || albums.length) || albums.length,
      limit, offset,
      message: albums.length ? '' : '该歌手没有返回专辑列表。',
    };
  }

  async function artistSongs(q) {
    const singerMid = text(q.get('id') || q.get('singerMid'));
    if (!singerMid) return { provider: 'qq', error: 'MISSING_ARTIST_ID', songs: [] };
    const limit = intInRange(q.get('limit'), 1, 100, 30);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const r = await call('musichall.song_list_server', 'GetSingerSongList', {
      singerMid, begin: offset, num: limit, order: 1,
    });
    const check = describeFailure('歌手歌曲', r);
    if (!check.ok) return { provider: 'qq', songs: [], message: check.reason, code: check.blockCode };
    const tracks = asArray(r.data.songList).map(row => row && (row.songInfo || row));
    const songs = mapSongs(tracks, mapQQPlaylistTrack, limit);
    return {
      provider: 'qq', singerMid,
      songs,
      total: Number(r.data.totalNum || 0) || 0, limit, offset,
      // 空结果必须说明原因：常见是该 mid 不是歌手（例如推荐里的 AI/合集账号）或没有公开作品。
      message: songs.length ? '' : '该歌手没有返回歌曲：上游 totalNum=' + (Number(r.data.totalNum || 0) || 0) + '，可确认传入的 mid 是否为歌手 MID。',
    };
  }

  // ---------- 11. 分类搜索 ----------
  // 搜索接口信封特殊：业务块 key 必须等于 module 名，且不带顶层 comm。
  async function searchCollections(q) {
    const keywords = text(q.get('keywords') || q.get('q'));
    if (!keywords) return { provider: 'qq', error: 'MISSING_KEYWORDS', songs: [], albums: [], playlists: [], artists: [] };
    const kind = text(q.get('kind') || q.get('type') || 'album').toLowerCase();
    // search_type → 返回块（2026-11-12 逐个实测）：0=song, 1=singer, 2=album, 3=songlist, 4=mv, 8=user。
    // 另：param 里多带 remoteplace 会让所有 list 返回空；信封也不能带顶层 comm。
    const SEARCH_TYPE = { song: 0, artist: 1, album: 2, playlist: 3 };
    const LIST_KEY = { song: 'song', artist: 'singer', album: 'album', playlist: 'songlist' };
    const searchType = SEARCH_TYPE[kind] != null ? SEARCH_TYPE[kind] : 2;
    const listKey = LIST_KEY[kind] || 'album';
    const limit = intInRange(q.get('limit'), 1, 30, 20);
    const page = intInRange(q.get('page'), 1, 100, 1);
    const mod = 'music.search.SearchCgiService';
    const json = await qqMusicRequest({
      [mod]: {
        module: mod, method: 'DoSearchForQQMusicDesktop',
        param: { search_type: searchType, query: keywords, page_num: page, num_per_page: limit },
      },
    }, { cookie: false });
    const block = json && json[mod];
    const data = (block && block.data) || {};
    const body = data.body || data || {};
    const rows = asArray((body[listKey] && body[listKey].list) || body[listKey] || []);
    const songs = kind === 'song' ? mapSongs(rows, mapQQPlaylistTrack, limit) : [];
    const albums = kind === 'album' ? rows.map(a => ({
      id: text(a.albumMID || a.albumMid || a.albumID), name: text(a.albumName || a.albumTitle),
      artist: text(a.singerName || (asArray(a.singer_list).map(s => s.name).join(' / '))),
      cover: text(a.albumPic) || qqAlbumCover(a.albumMID || a.albumMid, 300),
      publishDate: text(a.publicTime).slice(0, 10),
      songCount: Number(a.song_count || 0) || 0,
    })).filter(a => a.name) : [];
    const playlists = kind === 'playlist' ? rows.map(p => ({
      id: text(p.dissid || p.disstid), name: text(p.dissname || p.title),
      cover: text(p.imgurl || p.picurl), trackCount: Number(p.song_count || 0) || 0,
      playCount: Number(p.listennum || 0) || 0,
      creator: text((p.creator && (p.creator.name || p.creator.nick)) || p.creator),
    })).filter(p => p.name) : [];
    const artists = kind === 'artist' ? rows.map(a => ({
      id: text(a.singerMID || a.singerMid || a.singerID), name: text(a.singerName),
      cover: text(a.singerPic), albumSize: Number(a.albumNum || 0) || 0,
      songCount: Number(a.songNum || 0) || 0,
    })).filter(a => a.name) : [];
    return {
      provider: 'qq', keywords, kind, songs, albums, playlists, artists,
      total: Number((data.meta && data.meta.estimate_sum) || (body[listKey] && body[listKey].totalnum) || 0) || 0,
      code: block && block.code,
      message: (songs.length || albums.length || playlists.length || artists.length) ? '' : '没有匹配的' + kind + '结果。',
    };
  }

  // ---------- 12. 账号最近播放（需登录） ----------
  async function recentPlayed(info, q) {
    const r = await call('music.musicasset.PlayRecentlyRead', 'GetPlayRecentlyInfo', {
      requestCnt: intInRange(q.get('limit'), 1, 2500, 100), type: 2, updateTime: 0, lastTime: 0,
    }, { auth: true, info });
    const check = describeFailure('最近播放', r);
    if (!check.ok) {
      return { provider: 'qq', loggedIn: true, songs: [],
        // 实号（2026-11-13）验证：账号已登录仍返回 1000，说明问题不在登录态，
        // 而在该接口的鉴权字段或 param 形态（一手文档未给出上游 param）。不谎称参数正确。
        message: check.blockCode === 1000
          ? '上游返回 code 1000：账号已登录但该接口拒绝请求，鉴权字段与 param 形态尚未在实号下验证成功。'
          : check.reason,
        code: check.blockCode };
    }
    const rows = asArray(r.data.data && r.data.data.songList).concat(asArray(r.data.songList));
    const songs = mapSongs(rows.map(row => row && (row.track || row.songInfo || row)), mapQQPlaylistTrack, 100);
    return { provider: 'qq', loggedIn: true, songs, message: songs.length ? '' : '账号最近播放为空。' };
  }

  // ---------- 13. 红心状态（只读；写入需签名通道，不接） ----------
  async function songLikeCheck(info, q) {
    const mids = text(q.get('mids') || q.get('ids')).split(',').map(s => s.trim()).filter(Boolean);
    if (!mids.length) return { provider: 'qq', error: 'MISSING_MIDS', liked: {} };
    const r = await call('music.musicasset.SongFavRead', 'IsSongFanByMid', { v_mid: mids }, { auth: true, info });
    const check = describeFailure('红心状态', r);
    if (!check.ok) {
      return { provider: 'qq', loggedIn: true, liked: {}, mids,
        message: check.blockCode === 1000
          ? '上游返回 code 1000：账号已登录但该接口拒绝请求，鉴权字段与 param 形态（v_mid）尚未在实号下验证成功。'
          : check.reason,
        code: check.blockCode };
    }
    const fan = r.data.m_fan || r.data.mFan || {};
    const liked = {};
    mids.forEach(mid => { liked[mid] = fan[mid] === true || fan[mid] === 1; });
    return { provider: 'qq', loggedIn: true, mids, liked };
  }

  // ---------- 14/15/16. 账号写回 ----------
  // 一手文档：普通歌单写入走明文 musicu.fcg（ct:24 / cv:4747474）已验收；
  // 必须检查外层 code / 业务块 code / data.retCode 三层——只查 retCode 会把
  // 「业务块 80105、retCode 0」的失败误报成成功。
  async function playlistCreate(info, body) {
    const name = text(body.name || body.dirName);
    if (!name) return { provider: 'qq', success: false, error: 'MISSING_PLAYLIST_NAME' };
    if (name.length > 20) return { provider: 'qq', success: false, error: 'NAME_TOO_LONG', message: 'QQ 音乐歌单名最多 20 个字符' };
    const r = await call('music.musicasset.PlaylistBaseWrite', 'AddPlaylist', {
      dirName: name, dirDesc: '', dirPicUrl: '', taglist: '', dirShow: 2,
    }, { auth: true, info });
    const check = describeFailure('创建歌单', r);
    if (!check.ok) return {
      provider: 'qq', success: false, error: 'QQ_CREATE_PLAYLIST_FAILED',
      message: check.reason, codes: { outer: check.outer, block: check.blockCode, retCode: check.retCode },
    };
    const created = r.data || {};
    const id = text(created.dirId || created.dirid || created.tid || created.id);
    // 读回确认：查本人创建的歌单，命中才算 verified。
    let verified = false;
    try {
      const listed = await qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
        hostUin: 0, hostuin: info.userId, sin: 0, size: 100,
        g_tk: 5381, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8',
      });
      const rows = asArray(listed && (listed.data && (listed.data.disslist || listed.data.dissList)))
        .concat(asArray(listed && listed.disslist));
      verified = id ? rows.some(row => String(row.dissid || row.dirid || row.tid) === id)
        : rows.some(row => text(row.diss_name || row.name) === name);
    } catch (err) {
      // 读回失败不等于写入失败，但必须如实标注未确认。
    }
    return {
      provider: 'qq', success: true, verified,
      playlist: { id, name, trackCount: 0 },
      codes: { outer: check.outer, block: check.blockCode, retCode: check.retCode },
      message: verified ? '' : '上游已返回成功，但读回未确认；请刷新歌单列表核对。',
    };
  }

  async function playlistTracksWrite(info, body, operation) {
    const dirId = text(body.pid || body.dirId || body.playlistId);
    // 前端 06c-account-actions.js 的 addCollectTargetToPlaylist 传的是
    // { pid, id: songAccountId(song), song }，QQ 的 song.id 通常是 MID，
    // 而上游 AddSonglist/DelSonglist 要的是数字 songId（qqId）。
    // 所以优先从完整 song 对象里取数字 ID，前端无需改动。
    const songObj = body.song || {};
    const numericFromSong = songObj.qqId || songObj.songid ||
      (/^\d+$/.test(String(songObj.id || '')) ? songObj.id : '');
    const rawIds = text(body.ids || numericFromSong || body.id || body.songs);
    if (!dirId || !rawIds) return { provider: 'qq', success: false, error: 'MISSING_DIRID_OR_IDS' };
    const songIds = rawIds.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
    if (!songIds.length) {
      return { provider: 'qq', success: false, error: 'QQ_SONG_ID_MUST_BE_NUMERIC',
        message: 'QQ 歌单增删需要数字歌曲 ID（qqId），当前只拿到了 MID，无法写入。' };
    }
    if (Number(dirId) === 201) {
      return { provider: 'qq', success: false, error: 'QQ_LIKED_SONGS_SIGNATURE_REQUIRED',
        message: '红心歌单（dirId 201）的增删需要 zzc 签名加密通道，本构建未接入，不写空壳。' };
    }
    const method = operation === 'add' ? 'AddSonglist' : 'DelSonglist';
    const r = await call('music.musicasset.PlaylistDetailWrite', method, {
      dirId: Number(dirId) || dirId, tid: Number(dirId) || dirId, bFmtUtf8: true,
      v_songInfo: songIds.map(id => ({ songId: id, songType: 0 })),
    }, { auth: true, info });
    const check = describeFailure(method, r);
    if (!check.ok) return {
      provider: 'qq', success: false, error: 'QQ_PLAYLIST_WRITE_FAILED',
      message: check.reason, codes: { outer: check.outer, block: check.blockCode, retCode: check.retCode },
    };
    // 读回确认：重新拉歌单曲目，检查目标 ID 是否存在。
    let verified = false;
    let readBackError = '';
    try {
      const after = await handleQQPlaylistTracks(dirId);
      const tracks = asArray(after && (after.tracks || after.songs));
      const present = new Set(tracks.map(t => String(t.qqId || t.id)).filter(Boolean));
      verified = songIds.every(id => operation === 'add' ? present.has(String(id)) : !present.has(String(id)));
      if (!verified) readBackError = '读回的曲目集合与预期不一致';
    } catch (err) {
      readBackError = err && err.message || '读回失败';
    }
    return {
      provider: 'qq', success: true, verified, operation, dirId, ids: songIds,
      codes: { outer: check.outer, block: check.blockCode, retCode: check.retCode },
      message: verified ? '' : ('上游已返回成功，但读回未确认' + (readBackError ? '：' + readBackError : '') + '；请刷新歌单核对。'),
    };
  }

  return {
    guessYouLike,
    dailyFeed,
    recommendPlaylists,
    radarSongs,
    similarSongs,
    relatedPlaylists,
    toplistGroups,
    toplistDetail,
    artistAlbums,
    artistSongs,
    searchCollections,
    recentPlayed,
    songLikeCheck,
    playlistCreate,
    playlistAddSong: (info, body) => playlistTracksWrite(info, body, 'add'),
    playlistRemoveSong: (info, body) => playlistTracksWrite(info, body, 'del'),
  };
};
