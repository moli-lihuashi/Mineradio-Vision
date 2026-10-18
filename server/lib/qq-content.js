'use strict';

// QQ 音乐（QQMusic）内容层：歌单 / 曲目 / 搜索 / 取址 / 评论 / 歌词。
//   · mapQQ* 把 musicu 的嵌套结构（data.body.song.list、disslist、cdlist、track_info…）收敛成内部结构
//   · handleQQSongUrl：按音质模板（QQ_QUALITY_CANDIDATE_TEMPLATES）拼多个候选 URL 并实测
//   · handleQQLyric：先走 musicu lyric，失败回落 fcg_query_lyric_new，再解码 HTML 实体
// 从 server.js 抽出（原 server.js 851–857 常量、1843–1958 与 2038–2451 函数）。不 require server.js，避免循环依赖。
//
// deps.session 是 server/lib/qq-session.js 的完整导出（单向依赖 content → session）。

module.exports = function createQQContent(deps) {
  const {
    classifyQQPlaybackRestriction,
    normalizeQualityPreference,
    qualityCandidatesFrom,
    isQQFavoritePlaylist,
    isQzoneBackgroundPlaylist,
    requestText,
    qqCookieObject,
    qqCookieUin,
    qqCookieMusicKey,
    qqCookiePlaybackKey,
    session,
  } = deps || {};
  const {
    parseJSONText,
    qqMusicRequest,
    qqGetJSON,
    getQQLoginInfo,
    refreshQQCookieSession,
    QQ_HEADERS,
    QQ_SMARTBOX_URL,
  } = session || {};

  // VKEY 请求超时（原在 server.js 的取址段，只有 handleQQSongUrl 用，随本块搬入）
  const QQ_VKEY_REQUEST_TIMEOUT_MS = 6000;

  const QQ_QUALITY_CANDIDATE_TEMPLATES = [
    { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
    { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
    { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
    { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
    { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
  ];

  function mapQQPlaylist(pl, kind) {
    pl = pl || {};
    const id = pl.dissid || pl.tid || pl.dirid || pl.id || pl.diss_id;
    return {
      provider: 'qq',
      source: 'qq',
      id: id ? String(id) : '',
      name: pl.diss_name || pl.name || pl.title || '',
      cover: pl.diss_cover || pl.logo || pl.picurl || pl.cover || '',
      trackCount: pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count || 0,
      playCount: pl.listen_num || pl.visitnum || pl.play_count || 0,
      creator: pl.hostname || pl.nick || pl.creator || 'QQ 音乐',
      subscribed: kind === 'collect',
      specialType: 0,
    };
  }

  function mapQQPlaylistTrack(raw) {
    raw = raw || {};
    const track = raw.songid || raw.songmid || raw.mid || raw.name ? raw : (raw.track_info || raw.songInfo || raw.songinfo || raw.song || {});
    const album = track.album || {};
    const artists = mapQQArtists(track.singer || track.singers || []);
    const mid = track.mid || track.songmid || raw.mid || raw.songmid || '';
    const albumMid = album.mid || track.albummid || raw.albummid || '';
    return {
      provider: 'qq',
      source: 'qq',
      type: 'qq',
      id: mid || String(track.id || track.songid || raw.id || raw.songid || ''),
      qqId: track.id || track.songid || raw.id || raw.songid || '',
      mid,
      songmid: mid,
      mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || raw.strMediaMid || '',
      name: track.name || track.songname || raw.songname || '',
      artist: artists.map(a => a.name).join(' / ') || track.singername || raw.singername || '',
      artists,
      artistId: artists[0] && (artists[0].id || artists[0].mid),
      artistMid: artists[0] && artists[0].mid,
      album: album.name || album.title || track.albumname || raw.albumname || '',
      albumMid,
      cover: qqAlbumCover(albumMid, 300),
      duration: (Number(track.interval || raw.interval) || 0) * 1000,
      fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
      playable: false,
    };
  }

  async function handleQQUserPlaylists() {
    const info = await getQQLoginInfo();
    if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] };
    const uin = info.userId;
    const createdReq = qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
      hostUin: 0,
      hostuin: uin,
      sin: 0,
      size: 200,
      g_tk: 5381,
      loginUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
    const collectReq = qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
      ct: 20,
      cid: 205360956,
      userid: uin,
      reqtype: 3,
      sin: 0,
      ein: 80,
    }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
    const [createdRaw, collectRaw] = await Promise.allSettled([createdReq, collectReq]);
    const created = createdRaw.status === 'fulfilled' && createdRaw.value && createdRaw.value.data && Array.isArray(createdRaw.value.data.disslist)
      ? createdRaw.value.data.disslist.map(pl => mapQQPlaylist(pl, 'created')) : [];
    const collected = collectRaw.status === 'fulfilled' && collectRaw.value && collectRaw.value.data && Array.isArray(collectRaw.value.data.cdlist)
      ? collectRaw.value.data.cdlist.map(pl => mapQQPlaylist(pl, 'collect')) : [];
    const seen = new Set();
    const playlists = created.concat(collected).filter(pl => {
      if (!pl.id || !pl.name || seen.has(pl.id)) return false;
      if (isQzoneBackgroundPlaylist(pl)) return false;
      seen.add(pl.id);
      return true;
    }).sort((a, b) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)));
    return { loggedIn: true, provider: 'qq', userId: uin, playlists };
  }

  async function handleQQPlaylistTracks(id) {
    const info = await getQQLoginInfo();
    if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] };
    const pid = String(id || '').trim();
    if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] };
    const result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
      type: 1,
      utf8: 1,
      disstid: pid,
      loginUin: info.userId,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    }, { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } });
    const detail = result && result.cdlist && result.cdlist[0] ? result.cdlist[0] : {};
    const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
    const tracks = rawTracks.map(mapQQPlaylistTrack).filter(s => s.name && (s.mid || s.id));
    const playlist = {
      provider: 'qq',
      id: pid,
      name: detail.dissname || detail.diss_name || detail.name || '',
      cover: detail.logo || detail.diss_cover || '',
      trackCount: tracks.length,
    };
    return { loggedIn: true, provider: 'qq', playlist, tracks };
  }

  function qqAlbumCover(albumMid, size) {
    if (!albumMid) return '';
    const px = size || 300;
    return 'https://y.qq.com/music/photo_new/T002R' + px + 'x' + px + 'M000' + albumMid + '.jpg?max_age=2592000';
  }

  function qqSingerAvatar(singerMid, size) {
    if (!singerMid) return '';
    const px = size || 300;
    return 'https://y.qq.com/music/photo_new/T001R' + px + 'x' + px + 'M000' + singerMid + '.jpg?max_age=2592000';
  }

  function mapQQArtists(raw) {
    return (raw || [])
      .map(a => ({
        id: a && a.id,
        mid: a && a.mid,
        name: (a && (a.name || a.title)) || '',
      }))
      .filter(a => a.name);
  }

  function mapQQSmartSong(item) {
    item = item || {};
    const mid = item.mid || item.songmid || item.id || '';
    return {
      provider: 'qq',
      source: 'qq',
      type: 'qq',
      id: mid,
      qqId: item.id || item.docid || '',
      mid,
      songmid: mid,
      name: item.name || item.title || '',
      artist: item.singer || '',
      artists: item.singer ? [{ name: item.singer }] : [],
      album: '',
      cover: '',
      duration: 0,
      fee: 0,
      playable: false,
    };
  }

  function mapQQTrack(track, fallback) {
    track = track || {};
    fallback = fallback || {};
    const album = track.album || {};
    const artists = mapQQArtists(track.singer || []);
    const mid = track.mid || fallback.mid || fallback.songmid || '';
    const albumMid = album.mid || album.pmid || '';
    return {
      provider: 'qq',
      source: 'qq',
      type: 'qq',
      id: mid,
      qqId: track.id || fallback.qqId || fallback.id || '',
      mid,
      songmid: mid,
      mediaMid: track.file && track.file.media_mid,
      name: track.name || track.title || fallback.name || '',
      artist: artists.map(a => a.name).join(' / ') || fallback.artist || '',
      artists: artists.length ? artists : (fallback.artists || []),
      artistId: artists[0] && (artists[0].id || artists[0].mid),
      artistMid: artists[0] && artists[0].mid,
      album: album.name || album.title || fallback.album || '',
      albumMid,
      cover: qqAlbumCover(albumMid, 300) || fallback.cover || '',
      duration: (Number(track.interval) || 0) * 1000,
      fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
      playable: false,
    };
  }

  async function qqSmartboxSearch(keywords, limit) {
    const u = new URL(QQ_SMARTBOX_URL);
    u.searchParams.set('format', 'json');
    u.searchParams.set('key', keywords);
    u.searchParams.set('g_tk', '5381');
    u.searchParams.set('loginUin', '0');
    u.searchParams.set('hostUin', '0');
    u.searchParams.set('inCharset', 'utf8');
    u.searchParams.set('outCharset', 'utf-8');
    u.searchParams.set('notice', '0');
    u.searchParams.set('platform', 'yqq.json');
    u.searchParams.set('needNewCode', '0');
    const text = await requestText(u.toString(), { headers: QQ_HEADERS });
    const json = parseJSONText(text);
    const items = json && json.data && json.data.song && json.data.song.itemlist;
    return (Array.isArray(items) ? items : []).slice(0, Math.max(1, Math.min(limit || 6, 10))).map(mapQQSmartSong);
  }

  async function qqSongDetail(mid, fallback) {
    if (!mid) return fallback;
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      songinfo: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: mid },
      },
    });
    const data = json && json.songinfo && json.songinfo.data;
    return mapQQTrack(data && data.track_info, fallback);
  }

  async function handleQQArtistDetail(mid, limit) {
    const singerMid = String(mid || '').trim();
    const num = Math.max(10, Math.min(80, parseInt(limit || '36', 10) || 36));
    if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      singer: {
        module: 'music.web_singer_info_svr',
        method: 'get_singer_detail_info',
        param: { sort: 5, singermid: singerMid, sin: 0, num },
      },
    }, { cookie: true });
    const block = json && json.singer;
    if (!block || Number(block.code || 0) !== 0) {
      return { provider: 'qq', error: block && (block.message || block.msg || block.code) || 'QQ_ARTIST_DETAIL_FAILED', artist: null, songs: [] };
    }
    const data = block.data || {};
    const info = data.singer_info || data.singerInfo || {};
    const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
    const songs = rawSongs
      .map(raw => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
      .filter(song => song && song.name && (song.mid || song.id));
    const matchedSongArtist = songs[0] && (songs[0].artists || []).find(a => a && a.mid === singerMid);
    const artistMid = info.mid || singerMid;
    const artistName = info.name || info.title || (matchedSongArtist && matchedSongArtist.name) || '';
    const totalSong = Number(data.total_song || data.song_count || 0) || songs.length;
    return {
      provider: 'qq',
      artist: {
        provider: 'qq',
        id: info.id || '',
        mid: artistMid,
        name: artistName,
        avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
        fans: Number(info.fans || 0) || 0,
        musicSize: totalSong,
        albumSize: Number(data.total_album || 0) || 0,
        mvSize: Number(data.total_mv || 0) || 0,
      },
      total: totalSong,
      songs,
    };
  }

  async function handleQQSearch(keywords, limit) {
    const kw = String(keywords || '').trim();
    if (!kw) return [];
    const base = await qqSmartboxSearch(kw, limit);
    const detailed = await Promise.all(base.map(async item => {
      try { return await qqSongDetail(item.mid, item); }
      catch (e) {
        console.warn('[QQSearch] detail failed:', item.mid, e.message);
        return item;
      }
    }));
    const seen = new Set();
    return detailed.filter(song => {
      const key = song && (song.mid || song.id || (song.name + '|' + song.artist));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return !!song.name;
    });
  }

  async function handleQQSongUrl(mid, mediaMid, qualityPreference, opts) {
    opts = opts || {};
    const songmid = String(mid || '').trim();
    if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
    const guid = String(10000000 + Math.floor(Math.random() * 90000000));
    const cookieObj = qqCookieObject();
    const uin = qqCookieUin(cookieObj) || '0';
    const musicKey = qqCookieMusicKey(cookieObj);
    const playbackKey = qqCookiePlaybackKey(cookieObj);
    const fileMediaMid = String(mediaMid || '').trim();
    const requestedQuality = normalizeQualityPreference(qualityPreference);
    const mediaIds = [];
    if (fileMediaMid) mediaIds.push(fileMediaMid);
    if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);
    const fileCandidates = mediaIds.flatMap(mediaId =>
      qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
        .map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
    );
    const filenames = fileCandidates.map(item => item.filename);
    const param = {
      guid,
      songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
      songtype: filenames.length ? filenames.map(() => 0) : [0],
      uin,
      loginflag: 1,
      platform: '20',
    };
    if (filenames.length) param.filename = filenames;
    const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
    if (musicKey) comm.authst = musicKey;
    const json = await qqMusicRequest({
      comm,
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param,
      },
    }, { cookie: true, timeoutMs: QQ_VKEY_REQUEST_TIMEOUT_MS });
    const data = json && json.req_0 && json.req_0.data;
    const infos = (data && Array.isArray(data.midurlinfo)) ? data.midurlinfo : [];
    const info = infos.find(item => item && item.purl) || infos[0];
    const purl = info && info.purl;
    if (purl) {
      const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/';
      const fileMeta = fileCandidates.find(item => item.filename === info.filename) || {};
      return {
        provider: 'qq',
        url: sip + purl,
        trial: false,
        playable: true,
        level: fileMeta.level || info.filename || '',
        quality: fileMeta.label || info.filename || '',
        filename: info.filename || '',
        requestedQuality,
      };
    }
    const restriction = classifyQQPlaybackRestriction(info, {
      hasSession: !!(uin && musicKey),
      hasPlaybackKey: !!(uin && playbackKey),
    });
    if (!opts._renewTried && restriction && restriction.category === 'login_required') {
      const renew = await refreshQQCookieSession({ reason: 'song-url-login-required' });
      if (renew && renew.ok) {
        return handleQQSongUrl(mid, mediaMid, qualityPreference, { _renewTried: true });
      }
    }
    return {
      provider: 'qq',
      url: '',
      playable: false,
      error: 'QQ_URL_UNAVAILABLE',
      loggedIn: !!(uin && musicKey),
      playbackKeyReady: !!(uin && playbackKey),
      restriction,
      reason: restriction.category,
      message: restriction.message,
      qqCode: info && (info.result || info.code || info.errtype),
      rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
      tried: fileCandidates.map(item => item.label + ' · ' + item.filename),
      requestedQuality,
      reauthRequired: !!(restriction && restriction.category === 'login_required'),
    };
  }

  function mapQQComment(raw) {
    raw = raw || {};
    const user = raw.user || raw.uin || {};
    const nickname = raw.nick || raw.nickname || raw.encrypt_uin || user.nick || user.nickname || user.name || 'QQ 音乐用户';
    const avatar = raw.avatarurl || raw.avatar || user.avatarurl || user.avatar || '';
    const timeRaw = Number(raw.time || raw.commenttime || raw.createTime || 0) || 0;
    return {
      id: raw.commentid || raw.commentId || raw.id || '',
      content: raw.rootcommentcontent || raw.content || raw.comment || '',
      likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
      time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
      user: {
        id: raw.encrypt_uin || raw.uin || user.uin || '',
        nickname,
        avatar,
      },
    };
  }

  async function handleQQSongComments(id, mid, limit, offset) {
    let topid = String(id || '').replace(/\D/g, '');
    if (!topid && mid) {
      try {
        const detail = await qqSongDetail(mid, { mid });
        topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
      } catch (e) {
        console.warn('[QQComments] detail fallback failed:', e.message);
      }
    }
    if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
    const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
    const uin = qqCookieUin() || '0';
    const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
      g_tk: '5381',
      loginUin: uin,
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
      cid: '205360772',
      reqtype: '2',
      biztype: '1',
      topid,
      cmd: '8',
      needmusiccrit: '0',
      pagenum: String(page),
      pagesize: String(limit || 20),
    }, { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } });
    const hotList = body && body.hot_comment && body.hot_comment.commentlist;
    const normalList = body && body.comment && body.comment.commentlist;
    const raw = (offset === 0 && Array.isArray(hotList) && hotList.length) ? hotList : (normalList || []);
    const comments = (raw || []).map(mapQQComment).filter(c => c.content);
    const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
    return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) };
  }

  function decodeHtmlEntities(text) {
    return String(text || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ');
  }

  function decodeQQLyricText(text) {
    let raw = decodeHtmlEntities(String(text || '').trim());
    if (!raw) return '';
    const compact = raw.replace(/\s+/g, '');
    const looksBase64 = compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
    if (looksBase64 && !/^\s*\[/.test(raw)) {
      try {
        const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '');
        if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
      } catch (e) {
        console.warn('[QQLyric] base64 decode failed:', e.message);
      }
    }
    return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
  }

  function normalizeQQSongId(id) {
    const n = String(id || '').replace(/\D/g, '');
    return n ? Number(n) : 0;
  }

  async function handleQQLyric(mid, id) {
    const songMID = String(mid || '').trim();
    const songID = normalizeQQSongId(id);
    if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };

    let lyricText = '';
    let transText = '';
    let qrcText = '';
    let romaText = '';
    let source = 'qq-musicu';

    try {
      const param = {};
      if (songMID) param.songMID = songMID;
      if (songID) param.songID = songID;
      const json = await qqMusicRequest({
        comm: { ct: 24, cv: 0 },
        lyric: {
          module: 'music.musichallSong.PlayLyricInfo',
          method: 'GetPlayLyricInfo',
          param,
        },
      }, { cookie: true });
      const data = json && json.lyric && json.lyric.data;
      lyricText = decodeQQLyricText(data && data.lyric);
      transText = decodeQQLyricText(data && data.trans);
      qrcText = decodeQQLyricText(data && data.qrc);
      romaText = decodeQQLyricText(data && data.roma);
    } catch (e) {
      console.warn('[QQLyric] musicu failed:', e.message);
    }

    if (!lyricText && songMID) {
      try {
        const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
          songmid: songMID,
          songtype: '0',
          format: 'json',
          nobase64: '1',
          g_tk: '5381',
          loginUin: qqCookieUin() || '0',
          hostUin: '0',
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: '0',
          platform: 'yqq.json',
          needNewCode: '0',
        }, { headers: { Referer: 'https://y.qq.com/portal/player.html' } });
        lyricText = decodeQQLyricText(body && body.lyric);
        transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
        source = 'qq-legacy';
      } catch (e) {
        console.warn('[QQLyric] legacy failed:', e.message);
      }
    }

    return {
      provider: 'qq',
      id: songID || '',
      mid: songMID,
      lyric: lyricText,
      tlyric: transText,
      yrc: '',
      qrc: qrcText,
      roma: romaText,
      source: lyricText ? source : 'qq-empty',
    };
  }

  return {
    mapQQPlaylist,
    mapQQPlaylistTrack,
    handleQQUserPlaylists,
    handleQQPlaylistTracks,
    qqAlbumCover,
    qqSingerAvatar,
    mapQQArtists,
    mapQQSmartSong,
    mapQQTrack,
    qqSmartboxSearch,
    qqSongDetail,
    handleQQArtistDetail,
    handleQQSearch,
    handleQQSongUrl,
    mapQQComment,
    handleQQSongComments,
    decodeHtmlEntities,
    decodeQQLyricText,
    normalizeQQSongId,
    handleQQLyric,
    QQ_QUALITY_CANDIDATE_TEMPLATES,
    QQ_VKEY_REQUEST_TIMEOUT_MS,
  };
};
