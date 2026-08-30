function songFromListenRecord(record) {
  if (!record) return null;
  var provider = String(record.sourceKey || record.provider || '').toLowerCase();
  if (!provider && record.type === 'qq') provider = 'qq';
  if (!provider && (record.type === 'kugou' || record.hash)) provider = 'kugou';
  if (!provider && record.mid) provider = 'qq';
  if (!provider) provider = 'netease';
  return {
    provider: provider,
    source: provider,
    type: record.type || (provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : 'song')),
    id: record.id || record.hash || record.mid || record.key || '',
    mid: record.mid || '',
    songmid: record.mid || '',
    mediaMid: record.mediaMid || '',
    hash: record.hash || '',
    albumAudioId: record.albumAudioId || '',
    name: record.name || '继续听',
    artist: record.artist || '',
    cover: record.cover || '',
  };
}
async function playHomeRecent(record) {
  var session = readPlaybackSession();
  if (session && session.song) {
    var shouldRestore = !record;
    if (record) {
      var recordSong = songFromListenRecord(record);
      shouldRestore = queueItemKey(session.song) && queueItemKey(recordSong) && queueItemKey(session.song) === queueItemKey(recordSong);
    }
    if (shouldRestore) {
      var restored = await applyPlaybackSession(session, {
        force: true,
        toast: true,
        holdPaused: false,
        preserveHomeState: false,
        silent: false,
        manual: true
      });
      if (restored) {
        prepareLeaveHomeForPlayback();
        updateEmptyHomeVisibility();
        return;
      }
    }
  }
  record = record || (function(){ var p = getContinuePresentation(); return p && p.record; })() || homeListenSummary().recent;
  if (!record) {
    showToast('还没有听歌记录');
    return;
  }
  var song = songFromListenRecord(record);
  if (!song || (!song.id && !song.mid)) {
    runHomeSearch(record.name || '');
    return;
  }
  activeRadioContext = null;
  playQueue = [cloneSong(song)];
  currentIdx = 0;
  safeRenderQueuePanel('home-recent-song');
  safeShelfRebuild('home-recent-song', true);
  forcePlaybackControlsInteractive();
  await playQueueAt(0);
}
function openHomeInsight() {
  // 9.11: 优先打开 insight dock；无数据时也打开（显示空状态提示）
  if (typeof openHomeInsightDock === 'function') {
    openHomeInsightDock();
    return;
  }
  var summary = homeListenSummary();
  if (summary.topArtist && summary.topArtist.name) {
    runHomeSearch(summary.topArtist.name);
    return;
  }
  if (summary.topSong && summary.topSong.name) {
    runHomeSearch(summary.topSong.name);
    return;
  }
  showToast('播放几首歌后会生成听歌画像');
}
async function playWeatherSong(index) {
  var radio = homeWeatherRadioState.radio;
  var songs = radio && radio.songs || [];
  if (!songs[index]) {
    startWeatherRadio();
    return;
  }
  activeRadioContext = weatherRadioContext();
  playQueue = songs.map(function(song){
    var cloned = cloneSong(song);
    cloned.radioContext = activeRadioContext;
    return cloned;
  });
  currentIdx = index;
  safeRenderQueuePanel('weather-radio-song');
  safeShelfRebuild('weather-radio-song', true);
  forcePlaybackControlsInteractive();
  await playQueueAt(index, { context: activeRadioContext });
}
async function playSceneSong(index) {
  var radio = homeSceneRadioState.radio;
  var songs = radio && radio.songs || [];
  if (!songs[index]) {
    startSceneRadio(homeSceneRadioState.sceneId || 'focus');
    return;
  }
  activeRadioContext = sceneRadioContext();
  playQueue = songs.map(function(song){
    var cloned = cloneSong(song);
    cloned.radioContext = activeRadioContext;
    return cloned;
  });
  currentIdx = index;
  safeRenderQueuePanel('scene-radio-song');
  safeShelfRebuild('scene-radio-song', true);
  forcePlaybackControlsInteractive();
  await playQueueAt(index, { context: activeRadioContext });
}
function handleHomeTileClick(index) {
  var row = document.getElementById('home-tile-row');
  var item = row && row._homeTiles && row._homeTiles[index];
  if (!item) return;
  if (item.kind === 'sceneSong') playSceneSong(item.index);
  else if (item.kind === 'weatherSong') playWeatherSong(item.index);
  else if (item.kind === 'recent') playHomeRecent(item.record);
  else if (item.kind === 'profile') openHomeInsight();
  else if (item.kind === 'song') playHomeSong(item.index);
  else if (item.kind === 'login') showLoginModal({ source: 'home-tile' });
  else if (item.kind === 'local') openHomeLocalImport();
  else if (item.kind === 'guide') openHomeProductGuide();
  else if (item.kind === 'playlist') openHomePlaylist(item.index);
  else if (item.kind === 'podcast') openHomePodcast(item.index);
  else if (item.kind === 'podcastSearch') { setSearchMode('podcast'); loadPodcastHot(); }
  else if (item.kind === 'library') openHomeLibrary();
  else runHomeSearch(item.query || item.title || '');
}
function currentCoverSong() {
  if (currentIdx >= 0 && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}
function songDurationLabel(song) {
  var sec = playbackDurationFromSong(song);
  if (!sec && audio && isFinite(audio.duration) && audio.duration > 0) sec = audio.duration;
  if (!sec) return '未知';
  return formatProgramTime(sec);
}
function songSourceLabel(song) {
  if (!song) return '未知';
  if (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash) return '酷狗音乐';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'QQ 音乐';
  if (song.type === 'local') return '本地上传';
  if (song.type === 'podcast' || song.source === 'podcast') return '网易云播客';
  return '网易云音乐';
}
function detailRow(label, value) {
  value = value == null || value === '' ? '未知' : value;
  return '<div class="detail-k">' + escHtml(label) + '</div><div class="detail-v">' + escHtml(String(value)) + '</div>';
}
function currentArtistNames(song) {
  var text = String((song && song.artist) || '').trim();
  if (!text) return [];
  return text.split(/\s*\/\s*|\s*,\s*|、/).map(function(s){ return s.trim(); }).filter(Boolean);
}
var trackDetailSeq = 0;
var detailArtistSongs = [];
function normalizeArtistNameForMatch(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s·・,，、/\\|&＋+_-]+/g, '')
    .replace(/[()（）\[\]【】"'“”‘’]/g, '');
}
function artistNameMatches(expectedNames, actualName) {
  var actual = normalizeArtistNameForMatch(actualName);
  if (!actual) return false;
  return (expectedNames || []).some(function(name){
    var expected = normalizeArtistNameForMatch(name);
    return expected && (expected === actual || expected.indexOf(actual) >= 0 || actual.indexOf(expected) >= 0);
  });
}
function currentArtistId(song) {
  if (!song) return '';
  if (!isCloudSong(song)) return '';
  if (song.artistId) return String(song.artistId);
  var artists = song.artists || [];
  for (var i = 0; i < artists.length; i++) {
    if (artists[i] && artists[i].id) return String(artists[i].id);
  }
  return '';
}
function currentQQArtistMid(song) {
  if (!song || songProviderKey(song) !== 'qq') return '';
  if (song.artistMid) return String(song.artistMid);
  if (song.singerMid) return String(song.singerMid);
  if (song.artistId && !/^\d+$/.test(String(song.artistId))) return String(song.artistId);
  var artists = song.artists || [];
  for (var i = 0; i < artists.length; i++) {
    if (artists[i] && artists[i].mid) return String(artists[i].mid);
    if (artists[i] && artists[i].id && !/^\d+$/.test(String(artists[i].id))) return String(artists[i].id);
  }
  return '';
}
function commentTimeLabel(ms) {
  var t = Number(ms) || 0;
  if (!t) return '';
  try {
    return new Date(t).toLocaleDateString('zh-CN', { month:'short', day:'numeric' });
  } catch (e) {
    return '';
  }
}
function renderDetailComments(comments) {
  if (!comments || !comments.length) return '<div class="detail-empty">暂无评论</div>';
  return '<div class="detail-scroll">' + comments.map(function(c){
    var user = c.user || {};
    var avatar = user.avatar ? coverUrlWithSize(user.avatar, 64) : '';
    return '<div class="comment-item">' +
      (avatar ? '<img class="comment-avatar" src="' + avatar + '" alt="">' : '<div class="comment-avatar"></div>') +
      '<div class="comment-main"><div class="comment-meta">' + escHtml(user.nickname || '音乐用户') + (c.likedCount ? (' · ' + c.likedCount + ' 赞') : '') + (c.time ? (' · ' + escHtml(commentTimeLabel(c.time))) : '') + '</div>' +
      '<div class="comment-text">' + escHtml(c.content || '') + '</div></div>' +
    '</div>';
  }).join('') + '</div>';
}
function renderArtistSongList(songs) {
  detailArtistSongs = (songs || []).map(cloneSong);
  if (!detailArtistSongs.length) return '<div class="detail-empty">暂无热门歌曲</div>';
  return '<div class="detail-scroll detail-song-virtual" data-detail-song-kind="artist">' +
    detailSongRowsHtml(detailArtistSongs, 'artist') +
  '</div>';
}
function renderAlbumSongList(songs) {
  if (!songs || !songs.length) return '<div class="detail-empty">暂无专辑曲目</div>';
  return '<div class="detail-scroll detail-song-virtual" data-detail-song-kind="album">' +
    detailSongRowsHtml(songs, 'album') +
  '</div>';
}
var DETAIL_SONG_ROW_STEP = 72;
var DETAIL_SONG_VIRTUAL_OVERSCAN = 6;
var detailSongVirtualState = { raf: 0 };
function detailSongRowsHtml(songs, kind) {
  songs = songs || [];
  var body = document.getElementById('track-detail-body');
  var list = body && body.querySelector('.detail-song-virtual[data-detail-song-kind="' + kind + '"]');
  var viewport = Math.max(240, Number(body && body.clientHeight) || 420);
  var scrollTop = 0;
  if (body && list && body.getBoundingClientRect && list.getBoundingClientRect) {
    var bodyRect = body.getBoundingClientRect();
    var listRect = list.getBoundingClientRect();
    scrollTop = Math.max(0, bodyRect.top - listRect.top);
  } else if (body) {
    scrollTop = Math.max(0, Number(body.scrollTop) || 0);
  }
  var start = Math.max(0, Math.floor(scrollTop / DETAIL_SONG_ROW_STEP) - DETAIL_SONG_VIRTUAL_OVERSCAN);
  var maxRows = Math.ceil(viewport / DETAIL_SONG_ROW_STEP) + DETAIL_SONG_VIRTUAL_OVERSCAN * 2;
  var end = Math.min(songs.length, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, songs.length - maxRows)));
  end = Math.min(songs.length, Math.max(end, start + maxRows));
  var html = '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (start * DETAIL_SONG_ROW_STEP) + 'px"></div>';
  html += songs.slice(start, end).map(function(s, localIndex){
    var i = start + localIndex;
    var cover = songCoverSrc(s, 80);
    var coverHtml = cover ? '<img class="artist-song-cover" src="' + escAttr(cover) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.18">' : '<div class="artist-song-cover"></div>';
    if (kind === 'artist') {
      var actionsHtml = '<div class="artist-song-actions">' +
        '<button class="artist-song-action collect" type="button" title="收藏到歌单" aria-label="收藏到歌单" onclick="event.stopPropagation();collectArtistDetailSong(' + i + ')">' + artistCollectTrayIconSvg() + '</button>' +
        '<button class="artist-song-action next" type="button" title="下一首播放" aria-label="下一首播放" onclick="event.stopPropagation();queueArtistDetailSongNext(' + i + ')">' + artistNextPlusIconSvg() + '</button>' +
      '</div>';
      return '<div class="artist-song-item" data-detail-song-index="' + i + '" onclick="playArtistDetailSong(' + i + ')">' +
        '<div class="artist-song-rank">' + String(i + 1).padStart(2, '0') + '</div>' +
        coverHtml +
        '<div class="artist-song-main"><div class="artist-song-name">' + escHtml(s.name || '') + '</div>' +
        '<div class="artist-song-meta">' + escHtml((s.album || '未知专辑') + (s.duration ? (' · ' + songDurationLabel(s)) : '')) + '</div></div>' +
        actionsHtml +
      '</div>';
    }
    return '<div class="artist-song-item" data-detail-song-index="' + i + '" onclick="playAlbumDetailSong(' + i + ')">' +
      '<div class="artist-song-rank">' + String(i + 1).padStart(2, '0') + '</div>' +
      coverHtml +
      '<div class="artist-song-main"><div class="artist-song-name">' + escHtml(s.name || '') + '</div>' +
      '<div class="artist-song-meta">' + escHtml((s.artist || '未知歌手') + (s.duration ? (' · ' + songDurationLabel(s)) : '')) + '</div></div>' +
    '</div>';
  }).join('');
  html += '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, songs.length - end) * DETAIL_SONG_ROW_STEP) + 'px"></div>';
  return html;
}
function scheduleDetailSongVirtualRender() {
  if (detailSongVirtualState.raf) return;
  detailSongVirtualState.raf = requestAnimationFrame(function(){
    detailSongVirtualState.raf = 0;
    var list = document.querySelector('#track-detail-body .detail-song-virtual');
    if (!list) return;
    var kind = list.getAttribute('data-detail-song-kind') || 'artist';
    var songs = kind === 'album' ? detailAlbumSongs : detailArtistSongs;
    if (!songs || !songs.length) return;
    list.innerHTML = detailSongRowsHtml(songs, kind);
  });
}
function bindTrackDetailScrollers() {
  var body = document.getElementById('track-detail-body');
  bindSmoothWheelScroll(body);
  if (body) {
    body.querySelectorAll('.detail-scroll').forEach(bindSmoothWheelScroll);
    if (!body.__detailSongVirtualBound) {
      body.__detailSongVirtualBound = true;
      body.addEventListener('scroll', throttle(function(){
        scheduleDetailSongVirtualRender();
      }, 16), { passive: true });
    }
  }
}
function playArtistDetailSong(i) {
  var song = detailArtistSongs[i];
  if (!song) return;
  playQueue = detailArtistSongs.map(cloneSong);
  currentIdx = i;
  safeRenderQueuePanel('artist-detail-play');
  safeShelfRebuild('artist-detail-play', true);
  closeTrackDetailModal();
  playQueueAt(i).catch(function(e){ console.warn('[ArtistDetailPlay]', e); });
}
function collectArtistDetailSong(i) {
  var song = detailArtistSongs[i];
  if (!song) return;
  collectDetailSong(song);
}
function queueArtistDetailSongNext(i) {
  var song = detailArtistSongs[i];
  if (!song) return;
  queueDetailSongNext(song);
}
function closeTrackDetailModal() {
  closeGsapModal(document.getElementById('track-detail-modal'));
}
var detailAlbumCollectionState = {};
var detailCommentSong = null;
var detailAlbumSongs = [];
function albumCollectionConfig(song) {
  var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : '';
  var albumId = song && (song.albumId || song.album_id || song.spotifyAlbumId || '');
  if (!albumId) return null;
  if (provider === 'netease') return { provider: provider, id: String(albumId), endpoint: '/api/album/subscribe', field: 'subscribed', label: '网易云' };
  if (provider === 'spotify') return { provider: provider, id: String(albumId), endpoint: '/api/spotify/album/like', field: 'like', label: 'Spotify' };
  if (provider === 'qishui') return { provider: provider, id: String(albumId), endpoint: '/api/qishui/album/collect', field: 'collected', label: '汽水音乐' };
  return null;
}
function albumCollectionKey(song) {
  var config = albumCollectionConfig(song);
  return config ? (config.provider + ':' + config.id) : '';
}
function albumDetailMissingText(song) {
  var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : '';
  if (provider === 'kugou') return '酷狗暂不支持按当前音源打开完整专辑详情，可收藏歌曲到歌单。';
  if (provider === 'qishui') return '汽水暂不提供完整专辑曲目列表，可直接收藏专辑。';
  if (provider === 'qq') return '当前 QQ 歌曲缺少 albumMid，无法打开专辑曲目。';
  return '当前歌曲缺少可用专辑 ID。';
}
function albumDetailUrlForSong(song) {
  var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : '';
  if (provider === 'qq') {
    var qqAlbumMid = song && (song.albumMid || song.albummid || song.album_mid || '');
    return qqAlbumMid ? '/api/qq/album/detail?mid=' + encodeURIComponent(qqAlbumMid) + '&limit=120' : '';
  }
  if (provider === 'spotify') {
    var spotifyAlbumId = song && (song.albumId || song.spotifyAlbumId || '');
    return spotifyAlbumId ? '/api/spotify/album/detail?id=' + encodeURIComponent(spotifyAlbumId) + '&limit=100' : '';
  }
  if (provider === 'netease') {
    var albumId = song && (song.albumId || song.album_id || '');
    return albumId ? '/api/album?id=' + encodeURIComponent(albumId) : '';
  }
  return '';
}
function renderAlbumCollectionButton(song) {
  var config = albumCollectionConfig(song);
  if (!config) return '';
  var collected = !!detailAlbumCollectionState[albumCollectionKey(song)];
  return '<button id="album-collection-toggle" class="detail-action-toggle' + (collected ? ' on' : '') + '" type="button" onclick="toggleAlbumCollection()">' +
    (collected ? '已收藏专辑' : '收藏专辑') +
    '</button>';
}
function syncAlbumCollectionButton(song) {
  song = song || detailCommentSong || currentCoverSong();
  var btn = document.getElementById('album-collection-toggle');
  if (!btn) return;
  var collected = !!detailAlbumCollectionState[albumCollectionKey(song)];
  btn.classList.toggle('on', collected);
  btn.textContent = collected ? '已收藏专辑' : '收藏专辑';
}
function syncAlbumCollectionState(song) {
  var config = albumCollectionConfig(song);
  if (!config) return;
  if (typeof isSongAccountLoggedIn === 'function' && !isSongAccountLoggedIn(config.provider)) return;
  var url = '';
  var responseField = 'liked';
  if (config.provider === 'netease') {
    url = '/api/album/subscribe/check?ids=' + encodeURIComponent(config.id);
    responseField = 'subscribed';
  } else if (config.provider === 'spotify') {
    url = '/api/spotify/album/like/check?ids=' + encodeURIComponent(config.id);
    responseField = 'liked';
  } else {
    return;
  }
  apiJson(url).then(function (result) {
    if (!result || result.error || !result[responseField]) return;
    detailAlbumCollectionState[albumCollectionKey(song)] = !!result[responseField][config.id];
    syncAlbumCollectionButton(song);
  }).catch(function () {});
}
async function toggleAlbumCollection() {
  var song = detailCommentSong || currentCoverSong();
  var config = albumCollectionConfig(song);
  if (!config) { showToast('当前平台暂不支持收藏专辑'); return; }
  if (typeof ensureLoggedInForAction === 'function' && !ensureLoggedInForAction(config.provider)) return;
  var key = albumCollectionKey(song);
  var next = !detailAlbumCollectionState[key];
  var payload = { id: config.id, albumId: config.id };
  payload[config.field] = next;
  var btn = document.getElementById('album-collection-toggle');
  if (btn) btn.classList.add('busy');
  try {
    var result = await apiJson(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!result || result.error || result.success === false) throw new Error(result && (result.message || result.error) || 'ALBUM_COLLECTION_FAILED');
    detailAlbumCollectionState[key] = next;
    syncAlbumCollectionButton(song);
    showToast(next ? '专辑已收藏到' + config.label : '已取消收藏专辑');
  } catch (err) {
    showToast(/SCOPE|PERMISSION|LOGIN/i.test(String(err && err.message || ''))
      ? '请重新登录后再收藏专辑'
      : '专辑收藏操作失败');
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}
function playAlbumDetailSong(i) {
  var song = detailAlbumSongs[i];
  if (!song) return;
  playQueue = detailAlbumSongs.map(cloneSong);
  currentIdx = i;
  safeRenderQueuePanel('album-detail-play');
  safeShelfRebuild('album-detail-play', true);
  closeTrackDetailModal();
  forcePlaybackControlsInteractive();
  playQueueAt(i).catch(function (e) { console.warn('[AlbumDetailPlay]', e); });
}
function openTrackDetailModal(type, songOverride) {
  var song = songOverride || currentCoverSong();
  if (!song) { showToast('先播放或选择一首歌'); return; }
  if (immersiveMode) setImmersiveMode(false);
  var heading = document.getElementById('track-detail-heading');
  var body = document.getElementById('track-detail-body');
  if (!heading || !body) return;
  var cover = songCoverSrc(song, 180);
  var coverHtml = cover ? '<img class="detail-cover" src="' + cover + '" alt="">' : '<div class="detail-cover"></div>';
  var title = song.name || '当前歌曲';
  var artists = currentArtistNames(song);
  var seq = ++trackDetailSeq;
  detailCommentSong = song;
  if (type === 'album') {
    var albumUrl = albumDetailUrlForSong(song);
    var albumTitle = song.album || (song.type === 'podcast' ? (song.radioName || 'Podcast') : '未知专辑');
    detailAlbumSongs = [];
    heading.textContent = '专辑详情';
    body.innerHTML =
      '<div class="detail-hero">' + coverHtml +
        '<div style="min-width:0;flex:1"><div class="detail-title" id="album-detail-title">' + escHtml(albumTitle) + '</div>' +
        '<div class="detail-sub" id="album-detail-sub">' + escHtml(song.artist || '未知歌手') + ' · ' + escHtml(songSourceLabel(song)) + '</div></div>' +
      '</div>' +
      '<div class="detail-grid">' +
        detailRow('当前歌曲', title) +
        detailRow('专辑', albumTitle) +
        detailRow('歌手', song.artist || '未知歌手') +
        detailRow('来源', songSourceLabel(song)) +
      '</div>' +
      '<div class="detail-section"><div class="detail-section-head"><div class="detail-section-title">专辑曲目</div><div class="detail-section-actions">' + renderAlbumCollectionButton(song) + '</div></div><div id="album-song-list">' +
        (albumUrl ? '<div class="detail-loading">正在载入专辑曲目...</div>' : '<div class="detail-empty">' + escHtml(albumDetailMissingText(song)) + '</div>') +
      '</div></div>';
    syncAlbumCollectionState(song);
    if (albumUrl) {
      apiJson(albumUrl).then(function (r) {
        if (seq !== trackDetailSeq) return;
        var target = document.getElementById('album-song-list');
        if (!r || r.error) {
          if (target) target.innerHTML = '<div class="detail-empty">专辑详情加载失败</div>';
          bindTrackDetailScrollers();
          return;
        }
        var albumInfo = r.album || {};
        detailAlbumSongs = (r.songs || []).map(cloneSong);
        var titleEl = document.getElementById('album-detail-title');
        var subEl = document.getElementById('album-detail-sub');
        if (titleEl && albumInfo.name) titleEl.textContent = albumInfo.name;
        if (subEl) subEl.textContent = (albumInfo.artist || song.artist || '未知歌手') + ' · ' + songSourceLabel(song);
        if (target) target.innerHTML = renderAlbumSongList(detailAlbumSongs);
        bindTrackDetailScrollers();
      }).catch(function () {
        var target = document.getElementById('album-song-list');
        if (seq === trackDetailSeq && target) target.innerHTML = '<div class="detail-empty">专辑详情加载失败</div>';
        bindTrackDetailScrollers();
      });
    }
    bindTrackDetailScrollers();
    openGsapModal(document.getElementById('track-detail-modal'));
    return;
  }
  if (type === 'artist') {
    var artistId = currentArtistId(song);
    var qqArtistMid = currentQQArtistMid(song);
    var artistDetailUrl = artistId
      ? ('/api/artist/detail?id=' + encodeURIComponent(artistId) + '&limit=36')
      : (qqArtistMid ? ('/api/qq/artist/detail?mid=' + encodeURIComponent(qqArtistMid) + '&limit=36') : '');
    var artistName = artists.join(' / ') || song.artist || '未知歌手';
    var artistNamesForMatch = artists.length ? artists : (song.artist ? [song.artist] : []);
    var artistInitial = artistName && artistName !== '未知歌手' ? artistName.slice(0, 1) : '歌';
    var artistCoverHtml = '<div id="artist-detail-cover" class="detail-cover detail-artist-avatar">' + escHtml(artistInitial) + '</div>';
    var artistEmptyText = songProviderKey(song) === 'qq'
      ? '当前 QQ 歌曲缺少 singerMid，无法打开 QQ 歌手主页。'
      : '当前歌曲缺少可用的歌手主页信息';
    var artistLoadingText = songProviderKey(song) === 'qq' ? '正在载入 QQ 歌手主页...' : '正在载入歌手主页...';
    heading.textContent = '歌手详情';
    body.innerHTML =
      '<div class="detail-hero">' + artistCoverHtml +
        '<div style="min-width:0;flex:1"><div class="detail-title">' + escHtml(artistName) + '</div>' +
        '<div class="detail-sub">来自当前播放 · ' + escHtml(title) + '</div></div>' +
      '</div>' +
      '<div class="detail-grid">' +
        detailRow('当前歌曲', title) +
        detailRow('关联歌手', artistName) +
        detailRow('所属专辑', song.album || (song.type === 'podcast' ? (song.radioName || 'Podcast') : '未知')) +
        detailRow('来源', songSourceLabel(song)) +
      '</div>' +
      '<div class="detail-chip-row">' + (artists.length ? artists.map(function(name){ return '<span class="detail-chip">' + escHtml(name) + '</span>'; }).join('') : '<span class="detail-chip">未知歌手</span>') + '</div>' +
      '<div class="detail-section"><div class="detail-section-head"><div class="detail-section-title">热门歌曲</div></div><div id="artist-hot-songs">' + (artistDetailUrl ? '<div class="detail-loading">' + escHtml(artistLoadingText) + '</div>' : '<div class="detail-empty">' + escHtml(artistEmptyText) + '</div>') + '</div></div>';
    if (artistDetailUrl) {
      apiJson(artistDetailUrl).then(function(r){
        if (seq !== trackDetailSeq) return;
        var returnedName = r && r.artist && r.artist.name;
        var target = document.getElementById('artist-hot-songs');
        if (returnedName && artistNamesForMatch.length && !artistNameMatches(artistNamesForMatch, returnedName)) {
          if (target) target.innerHTML = '<div class="detail-empty">歌手资料与当前歌曲不匹配，已停止展示错误主页。</div>';
          bindTrackDetailScrollers();
          return;
        }
        if (returnedName) {
          var titleEl = body.querySelector('.detail-title');
          if (titleEl) titleEl.textContent = r.artist.name;
        }
        if (r && r.artist && r.artist.avatar) {
          var avatarEl = document.getElementById('artist-detail-cover');
          if (avatarEl) {
            avatarEl.textContent = '';
            avatarEl.style.backgroundImage = 'url("' + coverUrlWithSize(r.artist.avatar, 180).replace(/"/g, '\\"') + '")';
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
          }
        }
        if (target) target.innerHTML = r && !r.error ? renderArtistSongList(r.songs || []) : '<div class="detail-empty">歌手主页加载失败</div>';
        bindTrackDetailScrollers();
      }).catch(function(){
        var target = document.getElementById('artist-hot-songs');
        if (seq === trackDetailSeq && target) target.innerHTML = '<div class="detail-empty">歌手主页加载失败</div>';
        bindTrackDetailScrollers();
      });
    }
  } else {
    heading.textContent = '歌曲详情';
    var detailIsQQ = songProviderKey(song) === 'qq';
    var detailCanLoadComments = isCloudSong(song) || detailIsQQ;
    var detailCommentTitle = detailIsQQ ? 'QQ 音乐评论' : '网易云评论';
    var detailEmptyText = detailIsQQ ? '当前 QQ 歌曲暂无评论' : '本地文件暂无网易云评论';
    body.innerHTML =
      '<div class="detail-hero">' + coverHtml +
        '<div style="min-width:0;flex:1"><div class="detail-title">' + escHtml(title) + '</div>' +
        '<div class="detail-sub">' + escHtml(song.artist || (song.type === 'local' ? '本地文件' : '未知歌手')) + '</div></div>' +
      '</div>' +
      '<div class="detail-grid">' +
        detailRow('歌曲名', title) +
        detailRow('歌手', song.artist || '未知歌手') +
        detailRow('专辑', song.album || (song.type === 'podcast' ? (song.radioName || 'Podcast') : '未知')) +
        detailRow('时长', songDurationLabel(song)) +
        detailRow('来源', songSourceLabel(song)) +
        detailRow('歌词源', lyricSourceMode === 'custom' ? '自定义歌词' : (lyricsTimingSource === 'fallback' ? '占位歌词' : '原词')) +
      '</div>' +
      '<div class="detail-chip-row">' +
        '<span class="detail-chip">' + escHtml(songSourceLabel(song)) + '</span>' +
        (isSongLiked(song) ? '<span class="detail-chip">红心喜欢</span>' : '') +
        (getCustomCoverForSong(song) ? '<span class="detail-chip">自定义封面</span>' : '') +
        (hasCustomLyricForSong(song) ? '<span class="detail-chip">自定义歌词</span>' : '') +
      '</div>' +
      '<div class="detail-section"><div class="detail-section-head"><div class="detail-section-title">' + detailCommentTitle + '</div></div><div id="song-comments">' + (detailCanLoadComments ? '<div class="detail-loading">正在载入评论...</div>' : '<div class="detail-empty">' + detailEmptyText + '</div>') + '</div></div>';
    if (detailCanLoadComments) {
      var commentUrl = detailIsQQ
        ? ('/api/qq/song/comments?id=' + encodeURIComponent(song.qqId || '') + '&mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&limit=18')
        : ('/api/song/comments?id=' + encodeURIComponent(song.id) + '&limit=18');
      apiJson(commentUrl).then(function(r){
        if (seq !== trackDetailSeq) return;
        var target = document.getElementById('song-comments');
        if (target) target.innerHTML = r && !r.error ? renderDetailComments(r.comments || []) : '<div class="detail-empty">评论加载失败</div>';
        bindTrackDetailScrollers();
      }).catch(function(){
        var target = document.getElementById('song-comments');
        if (seq === trackDetailSeq && target) target.innerHTML = '<div class="detail-empty">评论加载失败</div>';
        bindTrackDetailScrollers();
      });
    }
  }
  bindTrackDetailScrollers();
  openGsapModal(document.getElementById('track-detail-modal'));
}
function openArtistDetailForSong(song) {
  if (!song) { showToast('未找到歌手信息'); return; }
  if (currentArtistId(song) || currentQQArtistMid(song)) {
    openTrackDetailModal('artist', song);
    return;
  }
  var artist = String(song.artist || '').split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i).filter(Boolean)[0] || '';
  if (artist) {
    resolveArtistSongForDetail(song, artist).then(function(found){
      openTrackDetailModal('artist', found || Object.assign({}, song, { artist: artist }));
    }).catch(function(){
      openTrackDetailModal('artist', Object.assign({}, song, { artist: artist }));
    });
    showToast('正在查找歌手主页: ' + artist);
  } else {
    showToast('当前歌曲缺少歌手主页信息');
  }
}
function resolveArtistSongForDetail(song, artist) {
  var provider = songProviderKey(song) === 'qq' ? 'qq' : 'netease';
  var url = provider === 'qq'
    ? '/api/qq/search?keywords=' + encodeURIComponent(artist) + '&limit=8'
    : '/api/search?keywords=' + encodeURIComponent(artist) + '&limit=10';
  return apiJson(url).then(function(r){
    var songs = (r && r.songs) || [];
    for (var i = 0; i < songs.length; i++) {
      var candidate = songs[i];
      if (!candidate) continue;
      if (!artistNameMatches([artist], candidate.artist || '')) continue;
      if (currentArtistId(candidate) || currentQQArtistMid(candidate)) return candidate;
    }
    return null;
  });
}
function setCustomCoverForCurrent(dataUrl, opts) {
  if (!dataUrl) return;
  var song = currentCoverSong();
  var saved = false;
  var hasKey = false;
  if (song) {
    var key = songCustomCoverKey(song);
    song.customCover = dataUrl;
    if (key) {
      hasKey = true;
      customCoverMap[key] = dataUrl;
      saved = saveCustomCoverMap();
      for (var i = 0; i < playQueue.length; i++) {
        if (songCustomCoverKey(playQueue[i]) === key) playQueue[i].customCover = dataUrl;
      }
      if (currentLocalSong && songCustomCoverKey(currentLocalSong) === key) currentLocalSong.customCover = dataUrl;
    }
  }
  applyCoverDataUrl(dataUrl, opts);
  safeRenderQueuePanel('custom-cover-apply', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('custom-cover-apply');
  updateCustomCoverButton();
  showToast(song ? (!hasKey ? '封面已应用' : (saved ? '封面已保存' : '封面已应用，存储空间不足')) : '已应用临时封面');
}
function updateCustomCoverButton() {
  var btn = document.getElementById('clear-cover-btn');
  var hasCover = !!getCustomCoverForSong(currentCoverSong());
  var area = document.getElementById('search-area');
  if (area) area.classList.toggle('has-cover-action', hasCover);
  if (!btn) return;
  btn.classList.toggle('has-cover', hasCover);
  btn.title = hasCover ? '取消自定义封面' : '当前没有自定义封面';
  btn.setAttribute('aria-label', btn.title);
}
function clearCustomCoverForCurrent() {
  var song = currentCoverSong();
  if (!song) {
    showToast('先播放或选择一首歌');
    updateCustomCoverButton();
    return;
  }
  var custom = getCustomCoverForSong(song);
  if (!custom) {
    showToast('当前没有自定义封面');
    updateCustomCoverButton();
    return;
  }
  var key = songCustomCoverKey(song);
  if (key && customCoverMap[key]) {
    delete customCoverMap[key];
    saveCustomCoverMap();
  }
  delete playlistCoverCache[custom];
  delete song.customCover;
  if (key) {
    for (var i = 0; i < playQueue.length; i++) {
      if (songCustomCoverKey(playQueue[i]) === key) delete playQueue[i].customCover;
    }
  }
  if (key && currentLocalSong && songCustomCoverKey(currentLocalSong) === key) delete currentLocalSong.customCover;
  if (currentIdx >= 0 && playQueue[currentIdx] && playQueue[currentIdx].cover) loadCoverFromUrl(coverUrlWithSize(playQueue[currentIdx].cover, 400));
  else loadCoverFromUrl('');
  safeRenderQueuePanel('custom-cover-clear', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('custom-cover-clear');
  updateCustomCoverButton();
  showToast('已恢复默认封面');
}
function readCustomLyricMap() {
  try {
    var raw = JSON.parse(localStorage.getItem(CUSTOM_LYRIC_STORE_KEY) || '{}') || {};
    var out = {};
    Object.keys(raw).forEach(function(key){
      var item = raw[key];
      if (typeof item === 'string') out[key] = { text: item, updatedAt: 0 };
      else if (item && typeof item.text === 'string') out[key] = { text: item.text, updatedAt: item.updatedAt || 0 };
    });
    return out;
  } catch (e) {
    return {};
  }
}
function saveCustomLyricMap() {
  try {
    localStorage.setItem(CUSTOM_LYRIC_STORE_KEY, JSON.stringify(customLyricMap || {}));
    return true;
  } catch (e) {
    console.warn('custom lyric save failed:', e);
    return false;
  }
}
function readCustomLyricPrefs() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_LYRIC_PREF_STORE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function saveCustomLyricPrefs() {
  try { localStorage.setItem(CUSTOM_LYRIC_PREF_STORE_KEY, JSON.stringify(customLyricPrefs || {})); } catch (e) {}
}
function songCustomLyricKey(song) {
  return songCustomCoverKey(song);
}
function currentLyricSong() {
  if (currentIdx >= 0 && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}
function getCustomLyricEntry(song) {
  var key = songCustomLyricKey(song);
  return key && customLyricMap[key] ? customLyricMap[key] : null;
}
function hasCustomLyricForSong(song) {
  var entry = getCustomLyricEntry(song);
  return !!(entry && String(entry.text || '').trim());
}
function cloneLyricLine(line) {
  var copy = Object.assign({}, line || {});
  if (line && Array.isArray(line.words)) copy.words = line.words.map(function(w){ return Object.assign({}, w); });
  return copy;
}
function cloneLyricLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(cloneLyricLine);
}
function setOriginalLyricsState(lines, hasNativeKaraoke, timingSource, translationLines, translationSource) {
  originalLyricsState = {
    lines: cloneLyricLines(lines || []),
    hasNativeKaraoke: !!hasNativeKaraoke,
    timingSource: timingSource || 'fallback',
    translationLines: cloneLyricLines(translationLines || []),
    translationSource: translationSource || 'none'
  };
}
function applyLyricsState(lines, hasNativeKaraoke, timingSource) {
  lyricsHasNativeKaraoke = !!hasNativeKaraoke;
  lyricsTimingSource = timingSource || 'fallback';
  lyricsLines = cloneLyricLines(lines || []);
  if (!lyricsLines.length) lyricsLines = withLyricFallback([]);
  if (lyricsLines.length && lyricsLines[0].fallback) lyricsTimingSource = 'fallback';
  renderLyrics();
  refreshStageDualLyricPreview();
  updateCustomLyricControls();
  if (isClassicPresetActive()) {
    classicPlayer.currentLyricIdx = -1;
    renderClassicPlayerLyrics();
    updateClassicPlayerLyrics();
  }
}
function applyOriginalLyricsState() {
  lyricSourceMode = 'original';
  applyLyricsState(originalLyricsState.lines, originalLyricsState.hasNativeKaraoke, originalLyricsState.timingSource);
}
function parseCustomLyricText(text) {
  var raw = String(text || '').trim();
  if (!raw) return [];
  var lrcLines = parseLyricText(raw);
  if (lrcLines.length && !lrcLines.every(function(line){ return isNoLyricText(line.text); })) {
    return lrcLines.map(function(line){
      var copy = cloneLyricLine(line);
      copy.source = 'custom-lrc';
      return copy;
    });
  }
  var rows = raw.split(/\r?\n/).map(function(line){ return line.trim(); }).filter(function(line){ return line && !isNoLyricText(line); });
  if (!rows.length) return [];
  var duration = audio && isFinite(audio.duration) && audio.duration > 8 ? audio.duration : 0;
  var gap = duration ? Math.max(2.8, Math.min(7.2, duration / Math.max(1, rows.length))) : 4.8;
  return finalizeLyricLineDurations(rows.map(function(line, i){
    return { t: i * gap, duration: gap, text: line, source: 'custom-text', charCount: Math.max(1, line.length) };
  }));
}
function applyCustomLyricState(song, silent) {
  song = song || currentLyricSong();
  var entry = getCustomLyricEntry(song);
  if (!entry || !String(entry.text || '').trim()) {
    if (!silent) openCustomLyricModal();
    updateCustomLyricControls();
    return false;
  }
  var lines = parseCustomLyricText(entry.text);
  if (!lines.length) {
    if (!silent) showToast('自定义歌词内容为空');
    updateCustomLyricControls();
    return false;
  }
  lyricSourceMode = 'custom';
  lyricsHasNativeKaraoke = false;
  lyricsTimingSource = lines[0] && lines[0].source === 'custom-lrc' ? 'custom-lrc' : 'custom-text';
  lyricsLines = withLyricFallback(lines);
  if (lyricsLines.length && lyricsLines[0].fallback) lyricsTimingSource = 'fallback';
  renderLyrics();
  updateCustomLyricControls();
  return true;
}
function preferredLyricSourceForSong(song) {
  var key = songCustomLyricKey(song);
  var hasCustom = hasCustomLyricForSong(song);
  if (!hasCustom) return 'original';
  var pref = key ? customLyricPrefs[key] : '';
  if (pref === 'custom') return 'custom';
  if (pref === 'original') return 'original';
  return originalLyricsState.timingSource === 'fallback' ? 'custom' : 'original';
}
function applyPreferredLyricsForCurrent(silent) {
  var song = currentLyricSong();
  if (preferredLyricSourceForSong(song) === 'custom' && applyCustomLyricState(song, true)) return;
  applyOriginalLyricsState();
  if (!silent) updateCustomLyricControls();
}
function setLyricSourceMode(mode, silent) {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  mode = mode === 'custom' ? 'custom' : 'original';
  if (mode === 'custom') {
    if (!applyCustomLyricState(song, true)) {
      if (!silent) openCustomLyricModal();
      return false;
    }
    if (!silent) openCustomLyricModal();
  } else {
    applyOriginalLyricsState();
  }
  if (key) {
    customLyricPrefs[key] = mode;
    saveCustomLyricPrefs();
  }
  if (!silent) showToast(mode === 'custom' ? '已切换到自定义歌词' : '已切换到原歌词');
  updateCustomLyricControls();
  return true;
}
function updateCustomLyricControls() {
  var song = currentLyricSong();
  var hasCustom = hasCustomLyricForSong(song);
  var originalBtn = document.getElementById('lyric-source-original');
  var customBtn = document.getElementById('lyric-source-custom');
  if (originalBtn) {
    originalBtn.classList.toggle('active', lyricSourceMode !== 'custom');
    originalBtn.title = '使用网易云或本地解析歌词';
  }
  if (customBtn) {
    customBtn.classList.toggle('active', lyricSourceMode === 'custom');
    customBtn.classList.toggle('has-custom', hasCustom);
    customBtn.title = hasCustom ? '打开并编辑自定义歌词' : '新增自定义歌词';
  }
}
function setCustomLyricStatus(text, tone) {
  var el = document.getElementById('custom-lyric-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('good', tone === 'good');
  el.classList.toggle('fail', tone === 'fail');
}
