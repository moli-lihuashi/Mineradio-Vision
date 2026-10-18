'use strict';

// 播客（网易云「电台 / 声音」）字段映射与收藏夹拉取：
//   · mapPodcastRadio / mapPodcastProgram / mapPodcastVoice：上游字段名极不统一
//     （picUrl / picURL / coverUrl / coverImgUrl / avatarUrl …），统一收敛成内部曲目结构
//   · firstArrayFrom：上游把列表塞在 data / list / resources / djRadios 任意一层 → 逐个候选取第一个数组
//   · mapPodcastCollectionRadio / podcastCollectionMeta：收藏 / 创建 / 喜欢三个集合的元信息
//   · fetchMyPodcastItems：拉集合条目（collect/created/paid 走网易云 dj_* 接口，liked 走 sati 再回落 recent）
// 从 server.js 抽出（原 server.js 2452–2601，7 个函数）。不 require server.js，避免循环依赖。
//
// deps: { mapArtists, dj_sublist, user_audio, dj_paygift, record_recent_voice,
//         sati_resource_sub_list, getUserCookie }
//   后 5 个是 _lazyFn(_neteaseMod, name) 惰性代理；userCookie 是 let，所以注入 getter。

module.exports = function createPodcastMap(deps) {
  const {
    mapArtists,
    dj_sublist,
    user_audio,
    dj_paygift,
    record_recent_voice,
    sati_resource_sub_list,
    getUserCookie,
  } = deps || {};

  function mapPodcastRadio(r) {
    r = r || {};
    const dj = r.dj || r.djSimple || r.djUser || r.creator || {};
    const id = r.id || r.rid || r.radioId;
    return {
      id,
      rid: id,
      name: r.name || r.radioName || '',
      cover: r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl || '',
      desc: r.desc || r.description || r.rcmdText || '',
      djName: dj.nickname || r.djName || r.nickname || '',
      category: r.category || r.categoryName || '',
      programCount: r.programCount || r.programNum || r.programCnt || 0,
      subCount: r.subCount || r.subedCount || r.subscriberCount || 0,
    };
  }

  function mapPodcastProgram(p, fallbackRadio) {
    p = p || {};
    const mainSong = p.mainSong || p.song || p.mainTrack || {};
    const radio = p.radio || fallbackRadio || {};
    const mappedRadio = mapPodcastRadio(radio);
    const artists = mapArtists(mainSong.ar || mainSong.artists || []);
    const album = mainSong.al || mainSong.album || {};
    const dj = p.dj || radio.dj || {};
    const playableId = mainSong.id || p.mainSongId || p.songId;
    return {
      type: 'podcast',
      source: 'podcast',
      id: playableId,
      programId: p.id || p.programId,
      radioId: mappedRadio.id,
      name: p.name || mainSong.name || '',
      artist: mappedRadio.name || dj.nickname || artists.map(a => a.name).join(' / ') || mappedRadio.djName || '',
      artists,
      artistId: artists[0] && artists[0].id,
      album: mappedRadio.name || album.name || 'Podcast',
      cover: p.coverUrl || p.cover || p.blurCoverUrl || mappedRadio.cover || album.picUrl || '',
      duration: p.duration || mainSong.dt || mainSong.duration || 0,
      fee: mainSong.fee,
      djName: mappedRadio.djName || dj.nickname || '',
      radioName: mappedRadio.name || '',
      desc: p.description || p.desc || '',
      createTime: p.createTime || 0,
      serialNum: p.serialNum || p.serial || 0,
    };
  }

  function firstArrayFrom(obj, keys) {
    obj = obj || {};
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.list)) return value.list;
      if (value && Array.isArray(value.data)) return value.data;
      if (value && Array.isArray(value.resources)) return value.resources;
    }
    return [];
  }

  function mapPodcastVoice(v) {
    v = v || {};
    const raw = v.resource || v.voice || v.data || v.program || v;
    const mainSong = raw.mainSong || raw.song || raw.track || {};
    const radio = raw.radio || raw.djRadio || raw.voiceList || raw.podcast || {};
    const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id;
    return {
      type: 'podcast',
      source: 'podcast',
      sourceType: 'podcast-voice',
      id: playableId,
      programId: raw.programId || raw.voiceId || raw.id,
      radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
      name: raw.name || raw.songName || raw.title || mainSong.name || '',
      artist: (radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName || 'Voice'),
      album: radio.name || radio.radioName || raw.podcastName || 'Podcast',
      cover: raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl || '',
      duration: raw.duration || raw.durationMs || mainSong.dt || mainSong.duration || 0,
      djName: raw.djName || (radio.dj && radio.dj.nickname) || '',
      radioName: radio.name || radio.radioName || raw.podcastName || '',
      desc: raw.desc || raw.description || '',
    };
  }

  function mapPodcastCollectionRadio(r, key) {
    const radio = mapPodcastRadio(r);
    return {
      ...radio,
      type: 'podcast-radio',
      sourceType: 'podcast-radio',
      collectionKey: key || '',
      radioId: radio.id,
      name: radio.name,
      artist: radio.djName || radio.category || 'Podcast',
      album: radio.category || 'Podcast',
    };
  }

  function podcastCollectionMeta(key, items) {
    const meta = {
      collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
      created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
      liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
    }[key] || { key, title: key, sub: '', itemType: 'radio' };
    const first = (items || [])[0] || {};
    return {
      ...meta,
      count: (items || []).length,
      cover: first.cover || first.picUrl || first.coverUrl || '',
    };
  }

  async function fetchMyPodcastItems(key, info, limit, offset) {
    limit = Math.max(8, Math.min(60, Number(limit) || 30));
    offset = Math.max(0, Number(offset) || 0);
    if (key === 'collect') {
      const r = await dj_sublist({ limit, offset, cookie: getUserCookie(), timestamp: Date.now() });
      const raw = firstArrayFrom(r.body, ['djRadios', 'djradios', 'radios', 'data']);
      return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
    }
    if (key === 'created') {
      const r = await user_audio({ uid: info.userId, cookie: getUserCookie(), timestamp: Date.now() });
      const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
      return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
    }
    if (key === 'paid') {
      const r = await dj_paygift({ limit, offset, cookie: getUserCookie(), timestamp: Date.now() });
      const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
      return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
    }
    if (key === 'liked') {
      let raw = [];
      try {
        const sati = await sati_resource_sub_list({ cookie: getUserCookie(), timestamp: Date.now() });
        raw = firstArrayFrom(sati.body, ['data', 'resources', 'list']);
      } catch (e) {
        console.warn('[MyPodcastLiked] sati sub list failed:', e.message);
      }
      if (!raw.length) {
        try {
          const recent = await record_recent_voice({ limit, cookie: getUserCookie(), timestamp: Date.now() });
          raw = firstArrayFrom(recent.body, ['data', 'list', 'resources']);
        } catch (e) {
          console.warn('[MyPodcastLiked] recent voice fallback failed:', e.message);
        }
      }
      return { itemType: 'voice', items: raw.map(mapPodcastVoice).filter(x => x.id && x.name) };
    }
    return { itemType: 'radio', items: [] };
  }

  return {
    mapPodcastRadio,
    mapPodcastProgram,
    firstArrayFrom,
    mapPodcastVoice,
    mapPodcastCollectionRadio,
    podcastCollectionMeta,
    fetchMyPodcastItems,
  };
};
