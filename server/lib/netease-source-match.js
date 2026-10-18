'use strict';

// 网易「同曲匹配」：把一首歌在网易云里找到等价的那一条（用于跨源取址）。
//   · 文本/时长/艺人/版本标记/音质档 多维打分（neteaseSourceMatch* 系列，纯函数）
//   · 候选缓存（正向 12h / 负向 5min TTL，纯内存 Map）
//   · findNeteaseSameTrackCandidates 是唯一打上游的入口（cloudsearch + song_detail）
// 从 server.js 抽出（原 server.js 1109–1370 行）。判分逻辑依赖零 I/O，可直接对拍。
// userCookie 由 server.js 的 cookie 持久化层反复赋值 → 以 getUserCookie() 注入（调用期读）。

module.exports = function createNeteaseSourceMatch(deps) {
  const {
    promiseWithTimeout,
    cloudsearch,
    song_detail,
    mapSongRecord,
    getUserCookie,
  } = deps || {};

  const NETEASE_SOURCE_MATCH_POSITIVE_TTL_MS = 12 * 60 * 60 * 1000;
  const NETEASE_SOURCE_MATCH_NEGATIVE_TTL_MS = 5 * 60 * 1000;
  const NETEASE_SOURCE_MATCH_MAX_CANDIDATES = 4;
  const neteaseSourceMatchCache = new Map();
  const NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS = 4800;

  function neteaseSourceMatchText(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[（(【\[].*?[）)】\]]/g, '')
      .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|!?！？]+/g, '');
  }
  function neteaseSourceMatchDurationMs(value) {
    let duration = Number(value) || 0;
    if (duration > 0 && duration < 10000) duration *= 1000;
    return Math.max(0, duration);
  }
  function neteaseSourceMatchArtists(song) {
    const list = song && (song.ar || song.artists) || [];
    return (Array.isArray(list) ? list : []).map(artist => ({
      id: String(artist && artist.id || ''),
      name: neteaseSourceMatchText(artist && artist.name || ''),
    })).filter(artist => artist.id || artist.name);
  }
  function neteaseSourceMatchVersionTokens(song) {
    const aliases = song && (song.alia || song.alias) || [];
    const text = String((song && song.name || '') + ' ' + (Array.isArray(aliases) ? aliases.join(' ') : aliases || '')).toLowerCase();
    const rules = [
      ['live', /\blive\b|现场|演唱会/],
      ['cover', /\bcover\b|翻唱/],
      ['remix', /\bremix\b|\b(?:pop |radio |club |digital dog )?mix\b|mix版/],
      ['remaster', /\bremaster(?:ed)?\b|重制/],
      ['rerecord', /\bre[ -]?record(?:ed|ing)?\b|重录/],
      ['named-version', /taylor['’]?s version|\bversion\b|\bver\.?\b|版本/],
      ['edit', /\bradio edit\b|\bedit\b|剪辑版/],
      ['alternate-cut', /\bstripped\b|\bmono\b|\bstereo\b|\bcommentary\b/],
      ['instrumental', /\binstrumental\b|伴奏|\bkaraoke\b/],
      ['acoustic', /\bacoustic\b|不插电/],
      ['speed', /\bnightcore\b|\bsped up\b|\bslowed(?: and reverb)?\b|加速|慢速|变速/],
      ['dj', /\bdj\b|dj版/],
      ['demo', /\bdemo\b|试听版/],
    ];
    return rules.filter(rule => rule[1].test(text)).map(rule => rule[0]);
  }
  function neteaseSourceMatchMediaProfiles(song) {
    const profiles = [];
    ['h', 'm', 'l', 'sq', 'hr', 'hMusic', 'mMusic', 'lMusic', 'sqMusic', 'hrMusic'].forEach(key => {
      const item = song && song[key];
      if (!item) return;
      const profile = {
        br: Number(item.br || item.bitrate || 0) || 0,
        size: Number(item.size || 0) || 0,
        duration: Number(item.playTime || item.playtime || item.duration || 0) || 0,
        sr: Number(item.sr || item.sampleRate || 0) || 0,
      };
      if (profile.br || profile.size) profiles.push(profile);
    });
    return profiles;
  }
  function neteaseSourceMatchFingerprintCount(source, candidate) {
    const sourceProfiles = neteaseSourceMatchMediaProfiles(source);
    const candidateProfiles = neteaseSourceMatchMediaProfiles(candidate);
    let matches = 0;
    sourceProfiles.forEach(left => {
      if (candidateProfiles.some(right =>
        left.br && left.br === right.br &&
        left.size && left.size === right.size &&
        (!left.duration || !right.duration || Math.abs(left.duration - right.duration) <= 10) &&
        (!left.sr || !right.sr || left.sr === right.sr)
      )) matches++;
    });
    return matches;
  }
  function neteaseSourceMatchArtistSetEqual(sourceArtists, candidateArtists) {
    const sourceIds = [...new Set(sourceArtists.map(artist => artist.id).filter(Boolean))].sort();
    const candidateIds = [...new Set(candidateArtists.map(artist => artist.id).filter(Boolean))].sort();
    if (sourceIds.length && candidateIds.length) {
      return sourceIds.length === candidateIds.length && sourceIds.every((id, index) => id === candidateIds[index]);
    }
    const sourceNames = [...new Set(sourceArtists.map(artist => artist.name).filter(Boolean))].sort();
    const candidateNames = [...new Set(candidateArtists.map(artist => artist.name).filter(Boolean))].sort();
    return sourceNames.length > 0 && sourceNames.length === candidateNames.length && sourceNames.every((name, index) => name === candidateNames[index]);
  }
  function neteaseSourceMatchCandidateScore(source, candidate) {
    if (!source || !candidate || String(source.id || '') === String(candidate.id || '')) return -1;
    if (neteaseSourceMatchText(source.name) !== neteaseSourceMatchText(candidate.name)) return -1;
    const sourceVersions = neteaseSourceMatchVersionTokens(source);
    const candidateVersions = neteaseSourceMatchVersionTokens(candidate);
    if (sourceVersions.join('|') !== candidateVersions.join('|')) return -1;
    const sourceArtists = neteaseSourceMatchArtists(source);
    const candidateArtists = neteaseSourceMatchArtists(candidate);
    const sourceIds = sourceArtists.map(artist => artist.id).filter(Boolean);
    const candidateIds = candidateArtists.map(artist => artist.id).filter(Boolean);
    const artistIdMatch = sourceIds.length && candidateIds.length && sourceIds.some(id => candidateIds.indexOf(id) >= 0);
    const artistNameMatch = sourceArtists.some(left => candidateArtists.some(right => left.name && right.name && left.name === right.name));
    const artistSetMatch = neteaseSourceMatchArtistSetEqual(sourceArtists, candidateArtists);
    if (!artistIdMatch && !artistNameMatch) return -1;
    const sourceDuration = neteaseSourceMatchDurationMs(source.dt || source.duration);
    const candidateDuration = neteaseSourceMatchDurationMs(candidate.dt || candidate.duration);
    const durationDiff = sourceDuration && candidateDuration ? Math.abs(sourceDuration - candidateDuration) : 0;
    const durationLimit = sourceDuration ? Math.max(1800, sourceDuration * 0.012) : 0;
    if (durationLimit && durationDiff > durationLimit) return -1;
    const fingerprintMatches = neteaseSourceMatchFingerprintCount(source, candidate);
    const officialRecommendation = !!candidate.__officialSourceMatch;
    if (!fingerprintMatches && (!artistSetMatch || !sourceDuration || !candidateDuration || durationDiff > (officialRecommendation ? 1800 : 600))) return -1;
    const privilege = candidate.__privilege || candidate.privilege || {};
    let score = fingerprintMatches * 120;
    if (artistIdMatch) score += 70;
    else if (artistNameMatch) score += 42;
    if (artistSetMatch) score += 18;
    if (officialRecommendation) score += 240;
    if (sourceDuration && candidateDuration) score += Math.max(0, 45 - durationDiff / 100);
    if (Number(privilege.pl || 0) > 0 && String(privilege.plLevel || '').toLowerCase() !== 'none') score += 22;
    score += Math.min(20, Number(candidate.pop || candidate.popularity || candidate.score || 0) / 5 || 0);
    return score;
  }
  function neteaseSourceMatchCacheKey(id, hints) {
    hints = hints || {};
    return [
      String(id || ''),
      neteaseSourceMatchText(hints.name || hints.title),
      neteaseSourceMatchText(hints.artist),
      Math.round(neteaseSourceMatchDurationMs(hints.duration) / 1000),
    ].join('|');
  }
  function readNeteaseSourceMatchCache(key) {
    const entry = neteaseSourceMatchCache.get(key);
    if (!entry) return null;
    const ttl = entry.candidates && entry.candidates.length ? NETEASE_SOURCE_MATCH_POSITIVE_TTL_MS : NETEASE_SOURCE_MATCH_NEGATIVE_TTL_MS;
    if (Date.now() - entry.at > ttl) {
      neteaseSourceMatchCache.delete(key);
      return null;
    }
    return entry.candidates;
  }
  function writeNeteaseSourceMatchCache(key, candidates) {
    neteaseSourceMatchCache.set(key, { at: Date.now(), candidates: candidates || [] });
    while (neteaseSourceMatchCache.size > 256) neteaseSourceMatchCache.delete(neteaseSourceMatchCache.keys().next().value);
  }
  function neteaseSourceMatchHintArtists(hints) {
    hints = hints || {};
    const ids = String(hints.artistIds || hints.artistId || '').split(',').map(value => value.trim()).filter(Boolean);
    let names = String(hints.artistNames || '').split('\u001f').map(value => value.trim()).filter(Boolean);
    if (!names.length && String(hints.artist || '').trim()) names = [String(hints.artist).trim()];
    const count = Math.max(ids.length, names.length);
    const artists = [];
    for (let index = 0; index < count; index++) {
      const id = ids[index] || '';
      const name = names[index] || (count === 1 ? String(hints.artist || '').trim() : '');
      if (id || name) artists.push({ id, name });
    }
    return artists;
  }
  function mergeNeteaseSourceMatchSong(detailSong, searchSong, hints) {
    const detail = detailSong || {};
    const searchItem = searchSong || {};
    const merged = { ...searchItem, ...detail };
    const rawDetailArtists = detail.ar || detail.artists || [];
    const rawSearchArtists = searchItem.ar || searchItem.artists || [];
    const detailArtists = (Array.isArray(rawDetailArtists) ? rawDetailArtists : []).filter(artist => artist && (artist.id || String(artist.name || '').trim()));
    const searchArtists = (Array.isArray(rawSearchArtists) ? rawSearchArtists : []).filter(artist => artist && (artist.id || String(artist.name || '').trim()));
    const hintArtists = neteaseSourceMatchHintArtists(hints);
    const artists = (Array.isArray(detailArtists) && detailArtists.length)
      ? detailArtists
      : ((Array.isArray(searchArtists) && searchArtists.length) ? searchArtists : hintArtists);
    const detailAlbum = detail.al || detail.album || {};
    const searchAlbum = searchItem.al || searchItem.album || {};
    const album = { ...searchAlbum, ...detailAlbum };
    album.name = String(detailAlbum.name || '').trim() || String(searchAlbum.name || '').trim() || hints && hints.album || '';
    merged.id = detail.id || searchItem.id || hints && hints.id || '';
    merged.name = String(detail.name || '').trim() || String(searchItem.name || '').trim() || hints && (hints.name || hints.title) || '';
    merged.ar = artists;
    merged.artists = artists;
    merged.al = album;
    merged.album = album;
    merged.dt = detail.dt || detail.duration || searchItem.dt || searchItem.duration || neteaseSourceMatchDurationMs(hints && hints.duration);
    ['h', 'm', 'l', 'sq', 'hr', 'hMusic', 'mMusic', 'lMusic', 'sqMusic', 'hrMusic'].forEach(key => {
      if (!merged[key] && searchItem[key]) merged[key] = searchItem[key];
    });
    return merged;
  }
  async function findNeteaseSameTrackCandidates(id, hints, lookupDeadline) {
    hints = hints || {};
    const deadline = Number(lookupDeadline) > 0 ? Number(lookupDeadline) : Date.now() + NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS;
    const sourceId = String(id || '').trim();
    const title = String(hints.name || hints.title || '').trim();
    const artist = String(hints.artist || '').trim();
    if (!sourceId || !title || !artist) return [];
    const cacheKey = neteaseSourceMatchCacheKey(sourceId, hints);
    const cached = readNeteaseSourceMatchCache(cacheKey);
    if (cached) return cached;
    const query = [title, artist].filter(Boolean).join(' ');
    let searchSongs = [];
    try {
      const searchBudget = Math.min(3000, Math.max(500, deadline - Date.now()));
      const result = await promiseWithTimeout(cloudsearch({ keywords: query, type: 1, limit: 16, cookie: getUserCookie() }), searchBudget, 'NETEASE_SOURCE_SEARCH_TIMEOUT');
      searchSongs = result.body && result.body.result && Array.isArray(result.body.result.songs) ? result.body.result.songs : [];
    } catch (err) {
      console.warn('[NeteaseSourceMatch] search failed:', err.code || err.message);
      return [];
    }
    const searchById = new Map(searchSongs.map(song => [String(song && song.id || ''), song]));
    const detailIds = [sourceId].concat(searchSongs.slice(0, 12).map(song => String(song && song.id || '')).filter(Boolean));
    let detailSongs = [];
    let privileges = [];
    try {
      const detailBudget = Math.min(2000, Math.max(500, deadline - Date.now()));
      const detail = await promiseWithTimeout(song_detail({ ids: [...new Set(detailIds)].join(','), cookie: getUserCookie() }), detailBudget, 'NETEASE_SOURCE_DETAIL_TIMEOUT');
      detailSongs = detail.body && Array.isArray(detail.body.songs) ? detail.body.songs : [];
      privileges = detail.body && Array.isArray(detail.body.privileges) ? detail.body.privileges : [];
    } catch (err) {
      console.warn('[NeteaseSourceMatch] detail failed:', err.code || err.message);
    }
    const privilegeById = new Map(privileges.map(item => [String(item && item.id || ''), item]));
    const detailById = new Map(detailSongs.map(song => [String(song && song.id || ''), song]));
    const sourceDetail = detailById.get(sourceId) || searchById.get(sourceId) || null;
    const officialRecommendationId = String(sourceDetail && sourceDetail.noCopyrightRcmd && sourceDetail.noCopyrightRcmd.songId || '');
    if (officialRecommendationId && !detailById.has(officialRecommendationId) && !searchById.has(officialRecommendationId) && deadline - Date.now() >= 500) {
      try {
        const officialDetail = await promiseWithTimeout(song_detail({ ids: officialRecommendationId, cookie: getUserCookie() }), Math.min(1000, Math.max(500, deadline - Date.now())), 'NETEASE_OFFICIAL_MATCH_DETAIL_TIMEOUT');
        const officialSongs = officialDetail.body && Array.isArray(officialDetail.body.songs) ? officialDetail.body.songs : [];
        const officialPrivileges = officialDetail.body && Array.isArray(officialDetail.body.privileges) ? officialDetail.body.privileges : [];
        officialSongs.forEach(song => detailById.set(String(song && song.id || ''), song));
        officialPrivileges.forEach(item => privilegeById.set(String(item && item.id || ''), item));
      } catch (err) {
        console.warn('[NeteaseSourceMatch] official alternate detail failed:', err.code || err.message);
      }
    }
    const source = mergeNeteaseSourceMatchSong(detailById.get(sourceId), searchById.get(sourceId), {
      ...hints,
      id: sourceId,
      name: title,
      artist,
    });
    const ranked = [];
    const candidateSeeds = searchSongs.slice();
    if (officialRecommendationId && !candidateSeeds.some(song => String(song && song.id || '') === officialRecommendationId)) {
      const officialSeed = detailById.get(officialRecommendationId) || { id: officialRecommendationId, name: title, ar: neteaseSourceMatchHintArtists(hints), dt: neteaseSourceMatchDurationMs(hints.duration) };
      candidateSeeds.unshift(officialSeed);
    }
    candidateSeeds.forEach(searchSong => {
      const candidateId = String(searchSong && searchSong.id || '');
      if (!candidateId || candidateId === sourceId) return;
      const candidate = mergeNeteaseSourceMatchSong(detailById.get(candidateId), searchSong, {});
      candidate.__privilege = privilegeById.get(candidateId) || searchSong.privilege || {};
      candidate.__officialSourceMatch = !!(officialRecommendationId && candidateId === officialRecommendationId);
      const score = neteaseSourceMatchCandidateScore(source, candidate);
      if (score < 0) return;
      ranked.push({
        song: mapSongRecord(candidate),
        score,
        fingerprintMatches: neteaseSourceMatchFingerprintCount(source, candidate),
        officialRecommendation: !!candidate.__officialSourceMatch,
        durationDiff: Math.abs(neteaseSourceMatchDurationMs(source.dt || source.duration) - neteaseSourceMatchDurationMs(candidate.dt || candidate.duration)),
      });
    });
    ranked.sort((a, b) => b.score - a.score || a.durationDiff - b.durationDiff || Number(b.song.popularity || 0) - Number(a.song.popularity || 0));
    const candidates = ranked.slice(0, NETEASE_SOURCE_MATCH_MAX_CANDIDATES);
    writeNeteaseSourceMatchCache(cacheKey, candidates);
    return candidates;
  }

  return {
    neteaseSourceMatchText,
    neteaseSourceMatchDurationMs,
    neteaseSourceMatchArtists,
    neteaseSourceMatchVersionTokens,
    neteaseSourceMatchMediaProfiles,
    neteaseSourceMatchFingerprintCount,
    neteaseSourceMatchArtistSetEqual,
    neteaseSourceMatchCandidateScore,
    neteaseSourceMatchCacheKey,
    readNeteaseSourceMatchCache,
    writeNeteaseSourceMatchCache,
    neteaseSourceMatchHintArtists,
    mergeNeteaseSourceMatchSong,
    findNeteaseSameTrackCandidates,
    NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS,
  };
};
