// =============================================================================
// 统一音乐源适配层（netease / qq / kugou / qishui / spotify）
// 运行期调用；身份字段 / VIP / 解密等仍保持各平台特化。
// =============================================================================
var MUSIC_PROVIDER_KEYS = ['netease', 'qq', 'kugou', 'qishui', 'spotify'];

function normalizeMusicProviderKey(provider) {
  if (provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify') return provider;
  return 'netease';
}

function getMusicProviderKey(keyOrSong) {
  if (keyOrSong && typeof keyOrSong === 'object') {
    return normalizeMusicProviderKey(typeof songProviderKey === 'function' ? songProviderKey(keyOrSong) : (keyOrSong.source || keyOrSong.provider || 'netease'));
  }
  return normalizeMusicProviderKey(keyOrSong);
}

function providerLabel(key) {
  key = normalizeMusicProviderKey(key);
  if (typeof platformMeta === 'function') {
    var meta = platformMeta(key);
    if (meta && meta.label) return meta.label;
  }
  return key === 'qq' ? 'QQ 音乐'
    : (key === 'kugou' ? '酷狗音乐'
      : (key === 'qishui' ? '汽水音乐'
        : (key === 'spotify' ? 'Spotify' : '网易云音乐')));
}

function normalizePlaylistProvider(provider) {
  return normalizeMusicProviderKey(provider);
}

function playlistProviderLabel(provider) {
  provider = normalizePlaylistProvider(provider);
  return provider === 'qq' ? 'QQ' : (provider === 'kugou' ? 'KG' : (provider === 'qishui' ? 'QS' : (provider === 'spotify' ? 'SP' : 'NE')));
}

function playlistTracksEndpoint(provider, pid, params) {
  provider = normalizePlaylistProvider(provider);
  var query = 'id=' + encodeURIComponent(pid || '');
  if (params && typeof params === 'object') {
    Object.keys(params).forEach(function (key) {
      if (params[key] == null || params[key] === '') return;
      query += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    });
  }
  if (provider === 'qq') return '/api/qq/playlist/tracks?' + query;
  if (provider === 'kugou') return '/api/kugou/playlist/tracks?' + query;
  if (provider === 'qishui') return '/api/qishui/playlist/tracks?' + query;
  if (provider === 'spotify') return '/api/spotify/playlist/tracks?' + query;
  return '/api/playlist/tracks?' + query;
}

function lyricEndpointForSong(songOrId) {
  var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
  var provider = song ? getMusicProviderKey(song) : 'netease';
  if (provider === 'qq') {
    var mid = song.mid || song.songmid || song.id || '';
    var qqId = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
    return '/api/qq/lyric?mid=' + encodeURIComponent(mid) + '&id=' + encodeURIComponent(qqId);
  }
  if (provider === 'kugou') {
    var duration = 0;
    if (typeof playbackDurationFromSong === 'function') duration = playbackDurationFromSong(song) || 0;
    else duration = song.duration || song.timelength || '';
    return '/api/kugou/lyric?hash=' + encodeURIComponent(song.hash || song.fileHash || song.audioHash || song.id || '') +
      '&albumAudioId=' + encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || '') +
      '&duration=' + encodeURIComponent(duration || '');
  }
  if (provider === 'qishui') {
    return '/api/qishui/lyric?id=' + encodeURIComponent(song.id || song.providerSongId || '');
  }
  if (provider === 'spotify') {
    return '/api/spotify/lyric?id=' + encodeURIComponent(song.id || song.providerSongId || song.spotifyId || '');
  }
  var songId = song ? song.id : songOrId;
  return '/api/lyric?id=' + encodeURIComponent(songId);
}

function resolveProviderRequestedQuality(song, opts) {
  opts = opts || {};
  var provider = getMusicProviderKey(song);
  var requestedQuality = typeof normalizePlaybackQuality === 'function'
    ? normalizePlaybackQuality(opts.qualityOverride || (typeof playbackQuality !== 'undefined' ? playbackQuality : 'standard'))
    : (opts.qualityOverride || 'standard');
  if (provider === 'netease' && requestedQuality === 'jymaster' && typeof hasProviderSvip === 'function' && typeof loginStatus !== 'undefined' && !hasProviderSvip('netease', loginStatus)) {
    requestedQuality = 'hires';
  }
  if (provider === 'qq' && typeof qqPlaybackQualityCeiling !== 'undefined' && qqPlaybackQualityCeiling &&
      (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless')) {
    requestedQuality = qqPlaybackQualityCeiling;
  }
  return { provider: provider, quality: requestedQuality, qualityParam: '&quality=' + encodeURIComponent(requestedQuality) };
}

function providerPlayUrlEndpoint(song, opts) {
  if (!song) return '';
  var resolved = resolveProviderRequestedQuality(song, opts);
  var provider = resolved.provider;
  var qualityParam = resolved.qualityParam;
  if (provider === 'qq') {
    return '/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') +
      '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam;
  }
  if (provider === 'kugou') {
    var hashExtra = typeof kugouQualityHashesParam === 'function' ? kugouQualityHashesParam(song) : '';
    return '/api/kugou/song/url?hash=' + encodeURIComponent(song.hash || song.fileHash || song.audioHash || song.id || '') +
      '&albumAudioId=' + encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || '') +
      '&albumId=' + encodeURIComponent(song.albumId || song.album_id || '') + qualityParam + hashExtra;
  }
  if (provider === 'qishui') {
    return '/api/qishui/song/url?id=' + encodeURIComponent(song.id || song.providerSongId || '') + qualityParam;
  }
  if (provider === 'spotify') {
    return '/api/spotify/song/url?id=' + encodeURIComponent(song.id || song.providerSongId || song.spotifyId || '') +
      '&spotifyId=' + encodeURIComponent(song.spotifyId || '') +
      '&uri=' + encodeURIComponent(song.spotifyUri || song.uri || '') + qualityParam;
  }
  var matchQuery = typeof neteasePlaybackMatchQuery === 'function' ? neteasePlaybackMatchQuery(song, opts) : '';
  return '/api/song/url?id=' + encodeURIComponent(song.id || '') + matchQuery + qualityParam;
}

async function resolveProviderPlayUrlData(song, opts) {
  opts = opts || {};
  if (opts.preResolvedPlaybackData && opts.preResolvedPlaybackData.url) {
    return opts.preResolvedPlaybackData;
  }
  var endpoint = providerPlayUrlEndpoint(song, opts);
  if (!endpoint) return null;
  return apiJson(endpoint);
}

function neteasePlaybackMatchQuery(song, opts) {
  song = song || {};
  opts = opts || {};
  var excludeIds = Array.isArray(opts.excludeIds)
    ? opts.excludeIds.join(',')
    : String(opts.excludeIds || '');
  var artistId = song.artistId || song.artist_id || '';
  if (!artistId && Array.isArray(song.artists) && song.artists[0]) artistId = song.artists[0].id || '';
  if (!artistId && Array.isArray(song.ar) && song.ar[0]) artistId = song.ar[0].id || '';
  var artistRecords = Array.isArray(song.artists) && song.artists.length ? song.artists : (Array.isArray(song.ar) ? song.ar : []);
  var artistIds = artistRecords.map(function (artist) { return artist && artist.id || ''; }).filter(Boolean);
  var artistNames = artistRecords.map(function (artist) { return artist && artist.name || ''; }).filter(Boolean);
  if (!artistIds.length && artistId) artistIds = [artistId];
  if (!artistNames.length && (song.artist || song.artistName)) artistNames = [song.artist || song.artistName];
  var albumName = song.album || song.albumName || '';
  if (albumName && typeof albumName === 'object') albumName = albumName.name || '';
  return '&name=' + encodeURIComponent(song.name || song.title || '') +
    '&artist=' + encodeURIComponent(song.artist || song.artistName || '') +
    '&artistId=' + encodeURIComponent(artistId) +
    '&artistIds=' + encodeURIComponent(artistIds.join(',')) +
    '&artistNames=' + encodeURIComponent(artistNames.join('\u001f')) +
    '&album=' + encodeURIComponent(albumName) +
    '&duration=' + encodeURIComponent(song.durationMs || song.dt || song.duration || 0) +
    '&excludeIds=' + encodeURIComponent(excludeIds) +
    '&skipDirect=' + (opts.skipDirect ? '1' : '');
}

function clearNeteaseSourceMatchMetadata(song) {
  if (!song) return song;
  song.neteaseSourceMatched = false;
  song.resolvedNeteaseId = '';
  song.neteaseSourceMatchKind = '';
  song.neteaseSourceMatchScore = 0;
  song.neteaseSourceMatchAlbum = '';
  song.neteaseSourceMatchNotified = false;
  return song;
}

function applyNeteaseSourceMatchMetadata(song, data) {
  if (!song || !data || !data.sourceMatch) return song;
  song.neteaseSourceMatched = true;
  song.resolvedNeteaseId = data.resolvedNeteaseId || data.resolvedSongId || song.resolvedNeteaseId || '';
  song.neteaseSourceMatchKind = data.matchKind || 'netease_same_track_metadata';
  song.neteaseSourceMatchScore = Number(data.matchScore || 0) || 0;
  song.neteaseSourceMatchAlbum = data.matchedSong && data.matchedSong.album || '';
  song.playbackSource = data.source || 'netease-same-track';
  return song;
}

function neteaseSourceMatchTriedIds(data) {
  var tried = Array.isArray(data && data.sourceMatchTriedIds) ? data.sourceMatchTriedIds.slice() : [];
  var resolved = data && (data.resolvedNeteaseId || data.resolvedSongId);
  if (resolved && tried.map(String).indexOf(String(resolved)) < 0) tried.push(String(resolved));
  return tried.filter(Boolean).slice(0, 4);
}

async function retryNeteaseSourceMatchPlayback(song, data, idx, token, opts, requestedQuality) {
  if (!song || !data || !data.sourceMatch) return null;
  opts = opts || {};
  var retryDepth = Math.max(0, Number(opts.neteaseSourceMatchRetryDepth) || 0);
  var triedIds = neteaseSourceMatchTriedIds(data);
  if (retryDepth >= 3 || triedIds.length >= 4) return null;
  var nextData = null;
  try {
    nextData = await apiJson(
      '/api/song/url?id=' + encodeURIComponent(song.id || '') +
      neteasePlaybackMatchQuery(song, { excludeIds: triedIds, skipDirect: true }) +
      '&quality=' + encodeURIComponent(requestedQuality),
      { timeoutMs: 10000 }
    );
  } catch (err) {
    console.warn('[NeteaseSourceMatch] next candidate lookup failed:', err);
    return token === trackSwitchToken ? null : false;
  }
  if (token !== trackSwitchToken) return false;
  if (!nextData || !nextData.url || !nextData.sourceMatch) return null;
  var retryOpts = Object.assign({}, opts, {
    preResolvedPlaybackData: nextData,
    neteaseSourceMatchRetryDepth: retryDepth + 1,
    qualityOverride: requestedQuality,
    suppressPlayFailureNotice: true,
  });
  var retryStarted = await playQueueAt(idx, retryOpts);
  if (token !== trackSwitchToken) return false;
  return retryStarted === true;
}

function searchProviderUrl(provider, q, limit, offset) {
  provider = normalizeMusicProviderKey(provider);
  var query = 'keywords=' + encodeURIComponent(q || '') +
    '&limit=' + encodeURIComponent(limit || 30) +
    '&offset=' + encodeURIComponent(offset || 0);
  if (provider === 'qq') return '/api/qq/search?' + query;
  if (provider === 'kugou') return '/api/kugou/search?' + query;
  if (provider === 'qishui') return '/api/qishui/search?' + query;
  if (provider === 'spotify') return '/api/spotify/search?' + query;
  return '/api/search?' + query;
}

function collectPlaylistEndpoint(provider) {
  provider = normalizePlaylistProvider(provider);
  if (provider === 'qishui') return '/api/qishui/playlist/collect';
  if (provider === 'spotify') return '/api/spotify/playlist/collect';
  if (provider === 'netease') return '/api/playlist/subscribe';
  return '';
}

function collectPlaylistRequest(provider, id, collected, extra) {
  var endpoint = collectPlaylistEndpoint(provider);
  if (!endpoint) return Promise.reject(new Error('PLAYLIST_COLLECTION_UNSUPPORTED'));
  extra = extra || {};
  return apiJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: id,
      playlistId: id,
      subscribed: !!collected,
      collected: !!collected,
      spotifyUri: extra.spotifyUri || ''
    })
  });
}

function getMusicProvider(keyOrSong) {
  var key = getMusicProviderKey(keyOrSong);
  return {
    key: key,
    label: providerLabel(key),
    short: playlistProviderLabel(key),
    playUrlEndpoint: function (song, opts) { return providerPlayUrlEndpoint(song || keyOrSong, opts); },
    resolvePlayUrl: function (song, opts) { return resolveProviderPlayUrlData(song || keyOrSong, opts); },
    lyricUrl: function (song) { return lyricEndpointForSong(song || keyOrSong); },
    playlistTracksUrl: function (id, params) { return playlistTracksEndpoint(key, id, params); },
    searchUrl: function (q, limit, offset) { return searchProviderUrl(key, q, limit, offset); },
    collectPlaylistUrl: collectPlaylistEndpoint(key)
  };
}
