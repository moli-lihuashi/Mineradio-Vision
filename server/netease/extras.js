'use strict';

// ====================================================================
//  网易云增补能力（2026-11-12 批次 1）
//
//  上游：NeteaseCloudMusicApi 4.32.0，方法名 / 参数对应
//        node_modules/NeteaseCloudMusicApi/module/<name>.js
//
//  约定（与 server/routes/netease.js 保持一致）：
//   - 带「我的」语义的接口一律由路由层 requireLogin，cookie 从 ctx.userCookie 动态取；
//   - 歌曲统一走 mapSongRecord，上游字段层级多路径兜底；
//   - 空结果必须带 message 说明原因，不静默返回空数组（回落可见）；
//   - 私人 FM / 探索是流式接口，不做本地去重缓存；
//   - 每个 handler 只返回数据对象，HTTP 状态与 catch 由路由层统一处理。
// ====================================================================

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function intInRange(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function bodyOf(result) {
  return (result && (result.body || result)) || {};
}

function songsOf(result, mapSongRecord) {
  // 上游在不同接口里把歌曲放在 data / songs / data.songs / data.list 四种位置；
  // 多路径兜底会重复命中同一首，必须按 id 去重（tests/netease-extras.test.js 用合成正例守着）。
  const body = bodyOf(result);
  const raw = asArray(body.data)
    .concat(asArray(body.songs))
    .concat(asArray(body.data && body.data.songs))
    .concat(asArray(body.data && body.data.list));
  const seen = new Set();
  return raw.map(mapSongRecord).filter(s => {
    if (!s || !(s.id || s.name)) return false;
    const key = String(s.id || s.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapNeteaseAlbum(album) {
  const a = album || {};
  const artist = a.artist || a.artists && a.artists[0] || {};
  return {
    id: a.id || a.albumId || '',
    name: a.name || a.albumName || '',
    artist: text(artist.name) || text(a.artistName),
    cover: a.picUrl || a.coverImgUrl || a.cover || '',
    publishDate: a.publishTime ? new Date(Number(a.publishTime)).toISOString().slice(0, 10) : '',
    songCount: Number(a.size || a.songCount || 0) || 0,
    subType: text(a.subType),
  };
}

function mapNeteaseCollection(item) {
  const c = item || {};
  const creator = c.creator || c.user || {};
  return {
    id: c.id || c.resourceId || c.vid || '',
    name: c.name || c.title || '',
    cover: c.picUrl || c.coverImgUrl || c.coverUrl || '',
    trackCount: Number(c.trackCount || c.songCount || 0) || 0,
    playCount: Number(c.playCount || c.playcount || 0) || 0,
    creator: text(creator.nickname) || text(creator.name),
    description: text(c.description) || text(c.copywriter),
  };
}

function mapCloudRow(row, mapSongRecord) {
  const r = row || {};
  const song = r.simpleSong || r.song || r;
  const mapped = mapSongRecord(song);
  return Object.assign({}, mapped, {
    cloudId: r.songId || r.id || mapped.id,
    fileName: text(r.fileName),
    fileSize: Number(r.fileSize || 0) || 0,
    cloudFee: r.fee,
  });
}

module.exports = function createNeteaseExtras(ctx) {
  const {
    mapSongRecord,
    personal_fm, personal_fm_mode, fm_trash,
    user_cloud, user_cloud_detail, user_record,
    history_recommend_songs, history_recommend_songs_detail,
    style_list, style_preference, style_detail,
    recommend_songs_dislike, scrobble,
    homepage_block_page, homepage_dragon_ball,
    artist_album, album_sublist, cloudsearch,
    playlist_tracks, playlist_track_delete,
  } = ctx;

  const cookieArgs = () => ({ cookie: ctx.userCookie, timestamp: Date.now() });
  const withCookie = (extra) => Object.assign(cookieArgs(), extra || {});

  // ---------- 私人 FM（可按模式） ----------
  // personal_fm_mode 支持 mode: aidj/DEFAULT/FAMILIAR/EXPLORE/SCENE_RCMD，
  // submode: EXERCISE/FOCUS/NIGHT_EMO 等；不带 mode 时走默认 personal_fm。
  async function personalFm(info, q) {
    const limit = intInRange(q.get('limit'), 1, 30, 3);
    const mode = text(q.get('mode'));
    const submode = text(q.get('submode'));
    let result;
    let usedMode = '';
    if (mode && typeof personal_fm_mode === 'function') {
      result = await personal_fm_mode(withCookie({ mode, submode, limit }));
      usedMode = mode;
    } else {
      result = await personal_fm(withCookie());
    }
    const body = bodyOf(result);
    const songs = songsOf(result, mapSongRecord).slice(0, limit);
    return {
      provider: 'netease',
      loggedIn: !!(info && info.loggedIn),
      mode: usedMode || 'DEFAULT',
      submode,
      songs,
      source: usedMode ? 'personal_fm_mode' : 'personal_fm',
      code: body.code || 200,
      message: songs.length ? '' : '私人 FM 本次没有返回歌曲，可稍后重试。',
    };
  }

  async function fmTrash(body) {
    const id = text(body.id || body.songId);
    if (!id) return { provider: 'netease', success: false, error: 'MISSING_SONG_ID' };
    const result = await fm_trash(withCookie({ id, time: intInRange(body.time, 0, 600, 25) }));
    const b = bodyOf(result);
    return {
      provider: 'netease',
      id,
      success: (b.code || 200) === 200,
      code: b.code || 200,
      message: b.message || '',
    };
  }

  // ---------- 音乐云盘 ----------
  async function userCloud(info, q) {
    const limit = intInRange(q.get('limit'), 1, 100, 30);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const result = await user_cloud(withCookie({ limit, offset }));
    const b = bodyOf(result);
    const rows = asArray(b.data).concat(asArray(b.songs));
    const songs = rows.map(row => mapCloudRow(row, mapSongRecord)).filter(s => s.id);
    return {
      provider: 'netease',
      loggedIn: true,
      songs,
      total: Number(b.count || b.total || songs.length) || songs.length,
      limit,
      offset,
      hasMore: !!b.hasMore,
      maxSize: b.maxSize || 0,
      size: b.size || 0,
      message: songs.length ? '' : '云盘为空，或上游未返回云盘曲目。',
    };
  }

  async function userCloudDetail(info, q) {
    const ids = text(q.get('id') || q.get('ids'));
    if (!ids) return { provider: 'netease', error: 'MISSING_CLOUD_ID', songs: [] };
    const result = await user_cloud_detail(withCookie({ id: ids }));
    const b = bodyOf(result);
    const rows = asArray(b.data).concat(asArray(b.songs));
    return {
      provider: 'netease',
      loggedIn: true,
      songs: rows.map(row => mapCloudRow(row, mapSongRecord)).filter(s => s.id),
      message: rows.length ? '' : '该云盘曲目没有返回详情。',
    };
  }

  // ---------- 账号听歌排行 ----------
  // user_record type: 1=最近一周，0=所有时间
  async function listenRank(info, q) {
    const type = q.get('type') === '1' ? 1 : 0;
    const result = await user_record(withCookie({ uid: info.userId, type }));
    const b = bodyOf(result);
    const rows = type === 1 ? asArray(b.weekData) : asArray(b.allData);
    const songs = rows.map(row => {
      const mapped = mapSongRecord((row && row.song) || row);
      return Object.assign({}, mapped, {
        playCount: Number(row && row.playCount || 0) || 0,
        score: Number(row && row.score || 0) || 0,
      });
    }).filter(s => s.id);
    return {
      provider: 'netease',
      loggedIn: true,
      range: type === 1 ? 'week' : 'all',
      songs,
      message: songs.length ? '' : '上游没有返回听歌排行数据。',
    };
  }

  // ---------- 历史每日推荐 ----------
  // history_recommend_songs 取「最近有推荐记录的日期」，
  // history_recommend_songs_detail 才是按 date 取当天歌曲。
  async function recommendHistory(info) {
    const result = await history_recommend_songs(withCookie());
    const b = bodyOf(result);
    const data = b.data || b || {};
    const rawDays = asArray(data.days).concat(asArray(data.dates)).concat(asArray(b.days));
    const dates = rawDays.map(d => text(typeof d === 'object' ? (d.date || d.day) : d)).filter(Boolean);
    return {
      provider: 'netease',
      loggedIn: true,
      dates,
      data,
      message: dates.length ? '' : '上游没有返回历史推荐日期。',
    };
  }

  async function recommendHistoryDetail(info, q) {
    const date = text(q.get('date'));
    const result = await history_recommend_songs_detail(withCookie({ date }));
    const b = bodyOf(result);
    const songs = songsOf(result, mapSongRecord);
    return {
      provider: 'netease',
      loggedIn: true,
      date,
      songs,
      message: songs.length ? '' : '该日期没有返回每日推荐歌曲。',
    };
  }

  // ---------- 日推风格 / 曲风偏好 ----------
  async function styleList() {
    const result = await style_list(withCookie());
    const b = bodyOf(result);
    const tags = asArray(b.data).concat(asArray(b.tags)).map(tag => ({
      id: tag.id || tag.tagId || '',
      name: text(tag.name) || text(tag.tagName),
      category: tag.category || '',
      cover: tag.picUrl || tag.cover || '',
    })).filter(t => t.name);
    return { provider: 'netease', tags, message: tags.length ? '' : '上游没有返回曲风列表。' };
  }

  async function stylePreference() {
    const result = await style_preference(withCookie());
    const b = bodyOf(result);
    return { provider: 'netease', preference: b.data || b, code: b.code || 200 };
  }

  async function styleDetail(q) {
    const tagId = text(q.get('tagId') || q.get('id'));
    if (!tagId) return { provider: 'netease', error: 'MISSING_TAG_ID', songs: [] };
    const result = await style_detail(withCookie({ tagId }));
    const b = bodyOf(result);
    const songs = songsOf(result, mapSongRecord);
    return { provider: 'netease', tagId, songs, detail: b.data || b, message: songs.length ? '' : '该曲风没有返回歌曲。' };
  }

  // ---------- 推荐反馈 ----------
  async function recommendDislike(body) {
    const id = text(body.id || body.songId);
    if (!id) return { provider: 'netease', success: false, error: 'MISSING_SONG_ID' };
    const result = await recommend_songs_dislike(withCookie({ id }));
    const b = bodyOf(result);
    return { provider: 'netease', id, success: (b.code || 200) === 200, code: b.code || 200, message: b.message || '' };
  }

  // ---------- 播放记录上报 ----------
  // 幂等由前端保证（trackId + playSessionId），这里只透传，失败不重试以免污染账号推荐。
  async function scrobblePlay(body) {
    const id = text(body.id || body.songId);
    if (!id) return { provider: 'netease', success: false, error: 'MISSING_SONG_ID' };
    const result = await scrobble(withCookie({
      id,
      sourceid: text(body.sourceid || body.sourceId || body.playlistId || ''),
      time: intInRange(body.time, 0, 86400, 0),
    }));
    const b = bodyOf(result);
    return { provider: 'netease', id, success: (b.code || 200) === 200, code: b.code || 200, message: b.message || '' };
  }

  // ---------- 平台探索页 ----------
  // homepage/block/page 的 block 结构随版本变化，这里做宽松提取并保留 raw 计数，
  // 解析不出内容时明确写 message，不把空数组当成功。
  async function exploreHome(q) {
    const refresh = q.get('refresh') === '1' || q.get('refresh') === 'true';
    const cursor = text(q.get('cursor'));
    const result = await homepage_block_page(withCookie({ refresh, cursor }));
    const b = bodyOf(result);
    const data = b.data || b || {};
    const blocks = asArray(data.blocks).concat(asArray(data.blockList));
    const sections = blocks.map((block, index) => {
      const ui = block.uiElement || {};
      const title = text(block.blockTitle && block.blockTitle.title) || text(block.title) ||
        text(ui.mainTitle && ui.mainTitle.title) || ('区块 ' + (index + 1));
      const creatives = asArray(block.creatives).concat(asArray(block.resources));
      const items = [];
      creatives.forEach(creative => {
        const resources = asArray(creative.resources);
        (resources.length ? resources : [creative]).forEach(resource => {
          const rui = resource.uiElement || {};
          const name = text(rui.mainTitle && rui.mainTitle.title) || text(resource.name) || text(resource.title);
          if (!name) return;
          items.push({
            id: text(resource.resourceId || resource.id),
            name,
            sub: text(rui.subTitle && rui.subTitle.title) || text(resource.alg),
            cover: text(rui.image && rui.image.imageUrl) || text(resource.picUrl) || text(resource.coverImgUrl),
            type: text(resource.resourceType),
          });
        });
      });
      return { title, blockCode: text(block.blockCode), items };
    }).filter(section => section.items.length);
    return {
      provider: 'netease',
      sections,
      cursor: text(data.cursor) || cursor,
      hasMore: !!data.hasMore,
      blocksRawCount: blocks.length,
      source: 'homepage_block_page',
      message: sections.length ? '' : '上游返回了 ' + blocks.length + ' 个区块，但没有可解析的卡片内容。',
    };
  }

  async function exploreEntries() {
    const result = await homepage_dragon_ball(withCookie());
    const b = bodyOf(result);
    const entries = asArray(b.data).concat(asArray(b.iconList)).map(item => ({
      id: text(item.id),
      name: text(item.name) || text(item.title),
      icon: text(item.iconUrl) || text(item.picUrl),
      url: text(item.url),
    })).filter(e => e.name);
    return { provider: 'netease', entries, message: entries.length ? '' : '上游没有返回探索入口。' };
  }

  // ---------- 歌手专辑列表 ----------
  async function artistAlbums(q) {
    const id = text(q.get('id') || q.get('artistId'));
    if (!id) return { provider: 'netease', error: 'MISSING_ARTIST_ID', albums: [] };
    const limit = intInRange(q.get('limit'), 1, 60, 30);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    let result;
    try {
      result = await artist_album(withCookie({ id, limit, offset }));
    } catch (err) {
      // 歌手不存在时上游抛对象错误（无 message），这是正常业务结果，不是服务故障：
      // 返回空列表 + 明确原因，别让前端只看到 500。
      const code = Number(err && (err.status || (err.body && err.body.code))) || 0;
      if (code === 404) {
        return { provider: 'netease', id, artist: '', albums: [], more: false, limit, offset,
          message: '未找到该歌手（上游 404），请检查歌手 ID。' };
      }
      throw err;
    }
    const b = bodyOf(result);
    const albums = asArray(b.hotAlbums).concat(asArray(b.albums)).map(mapNeteaseAlbum).filter(a => a.id);
    return {
      provider: 'netease',
      id,
      artist: text(b.artist && b.artist.name),
      albums,
      more: !!b.more,
      limit,
      offset,
      message: albums.length ? '' : '该歌手没有返回专辑列表。',
    };
  }

  // ---------- 收藏专辑库 ----------
  // 与 /api/album/subscribe/check 共用 album_sublist，但这里是独立列表入口（带分页）。
  async function userAlbums(info, q) {
    const limit = intInRange(q.get('limit'), 1, 100, 25);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const result = await album_sublist(withCookie({ limit, offset }));
    const b = bodyOf(result);
    const albums = asArray(b.data).concat(asArray(b.albums)).map(mapNeteaseAlbum).filter(a => a.id);
    return {
      provider: 'netease',
      loggedIn: true,
      albums,
      total: Number(b.count || b.total || albums.length) || albums.length,
      limit,
      offset,
      hasMore: !!b.hasMore,
      message: albums.length ? '' : '收藏专辑库为空，或上游未返回列表。',
    };
  }

  // ---------- 专辑 / 歌单分类搜索 ----------
  // cloudsearch type: 10=专辑, 1000=歌单, 100=歌手
  async function searchCollections(q) {
    const keywords = text(q.get('keywords') || q.get('q'));
    if (!keywords) return { provider: 'netease', error: 'MISSING_KEYWORDS', albums: [], playlists: [] };
    const kind = text(q.get('kind') || q.get('type') || 'album').toLowerCase();
    const type = kind === 'playlist' ? 1000 : (kind === 'artist' ? 100 : 10);
    const limit = intInRange(q.get('limit'), 1, 50, 30);
    const offset = intInRange(q.get('offset'), 0, 100000, 0);
    const result = await cloudsearch(withCookie({ keywords, type, limit, offset, total: true }));
    const b = bodyOf(result);
    const r = b.result || b || {};
    const albums = type === 10 ? asArray(r.albums).map(mapNeteaseAlbum).filter(a => a.id) : [];
    const playlists = type === 1000 ? asArray(r.playlists).map(mapNeteaseCollection).filter(p => p.id) : [];
    const artists = type === 100 ? asArray(r.artists).map(a => ({
      id: a.id, name: text(a.name), cover: a.picUrl || a.img1v1Url || '', albumSize: a.albumSize || 0,
    })).filter(a => a.id) : [];
    return {
      provider: 'netease',
      keywords,
      kind,
      albums,
      playlists,
      artists,
      total: Number(r.albumCount || r.playlistCount || r.artistCount || 0) || 0,
      limit,
      offset,
      message: (albums.length || playlists.length || artists.length) ? '' : '没有匹配的' + kind + '结果。',
    };
  }

  // ---------- 从平台歌单移除歌曲 ----------
  async function removePlaylistSong(body) {
    const pid = text(body.pid || body.playlistId);
    const ids = text(body.id || body.ids || body.tracks);
    if (!pid || !ids) return { provider: 'netease', success: false, error: 'MISSING_PID_OR_IDS' };
    const attempts = [];
    let success = false;
    let lastCode = 0;
    let lastMessage = '';
    try {
      const primary = await playlist_tracks(withCookie({ op: 'del', pid, tracks: ids }));
      const b = bodyOf(primary);
      lastCode = b.code || 200;
      lastMessage = b.message || '';
      success = lastCode === 200 && !b.error;
      attempts.push({ api: 'playlist_tracks', code: lastCode, message: lastMessage });
    } catch (err) {
      lastMessage = err.message || 'PLAYLIST_TRACKS_FAILED';
      attempts.push({ api: 'playlist_tracks', code: 0, message: lastMessage });
    }
    if (!success && typeof playlist_track_delete === 'function') {
      try {
        const fallback = await playlist_track_delete(withCookie({ id: pid, ids }));
        const b = bodyOf(fallback);
        lastCode = b.code || 200;
        lastMessage = b.message || '';
        success = lastCode === 200 && !b.error;
        attempts.push({ api: 'playlist_track_delete', code: lastCode, message: lastMessage });
      } catch (err) {
        lastMessage = err.message || 'PLAYLIST_TRACK_DELETE_FAILED';
        attempts.push({ api: 'playlist_track_delete', code: 0, message: lastMessage });
      }
    }
    return {
      provider: 'netease',
      pid,
      ids,
      success,
      code: lastCode,
      message: success ? '' : (lastMessage || '从歌单移除歌曲失败'),
      attempts,
    };
  }

  return {
    personalFm,
    fmTrash,
    userCloud,
    userCloudDetail,
    listenRank,
    recommendHistory,
    recommendHistoryDetail,
    styleList,
    stylePreference,
    styleDetail,
    recommendDislike,
    scrobblePlay,
    exploreHome,
    exploreEntries,
    artistAlbums,
    userAlbums,
    searchCollections,
    removePlaylistSong,
  };
};
