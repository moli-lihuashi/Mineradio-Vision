// =============================================================================
// 首页发现 / 天气电台
// =============================================================================

function homeSongVisualKey(song) {
  if (!song) return '';
  var key = queueItemKey(song);
  if (key) return key;
  return String(song.name || '').trim().toLowerCase() + '|' + String(song.artist || '').trim().toLowerCase();
}
function uniqueHomeSongs(candidates, maxCount) {
  var out = [];
  var seen = {};
  (candidates || []).forEach(function(song) {
    if (out.length >= maxCount) return;
    if (!song || !song.name) return;
    var key = homeSongVisualKey(song);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(song);
  });
  return out;
}
function buildHomeFeaturedSongs() {
  var candidates = [];
  (homeDiscoverState.songs || []).forEach(function(s){ candidates.push(s); });
  var radioSongs = (homeSceneRadioState.loaded && homeSceneRadioState.radio && homeSceneRadioState.radio.songs) ||
    (homeWeatherRadioState.radio && homeWeatherRadioState.radio.songs) || [];
  radioSongs.forEach(function(s){ candidates.push(s); });
  (listenStatsState.history || []).forEach(function(rec) {
    candidates.push(songFromListenRecord(rec));
  });
  return uniqueHomeSongs(candidates, 3);
}
function homeTileEntryKey(item) {
  if (!item) return '';
  if (item.song) return homeSongVisualKey(item.song);
  if (item.record) return homeSongVisualKey(songFromListenRecord(item.record));
  if (item.kind === 'profile') return 'artist:' + String(item.query || item.title || '').trim().toLowerCase();
  if (item.kind === 'playlist') return 'pl:' + String(item.title || item.index || '').trim().toLowerCase();
  if (item.kind === 'podcast') return 'pod:' + String(item.title || item.index || '').trim().toLowerCase();
  return String(item.kind || 'tile') + ':' + String(item.title || '').trim().toLowerCase();
}
function pushHomeTileUnique(tiles, item, seen) {
  if (!item || tiles.length >= 5) return false;
  var key = homeTileEntryKey(item);
  if (key && seen[key]) return false;
  if (key) seen[key] = true;
  tiles.push(item);
  return true;
}
function fallbackHomeTiles() {
  return [
    { kind: 'login', title: '登录同步歌单', sub: '网易云 / QQ 音乐' },
    { kind: 'search', title: '搜索一首歌', sub: '原唱优先', query: '' },
    { kind: 'local', title: '导入本地音乐', sub: '本地文件也能可视化' },
    { kind: 'podcastSearch', title: '搜索播客', sub: '长内容 / 电台' },
    { kind: 'guide', title: '看看视觉舞台', sub: '粒子 / 歌词 / 封面' },
  ];
}
function homeTileCover(item) {
  if (!item) return '';
  if (item.kind === 'song' || item.kind === 'weatherSong' || item.kind === 'sceneSong') return songCoverSrc(item.song, 220);
  if (item.cover) return coverUrlWithSize(item.cover, 220);
  if (item.record && item.record.cover) return coverUrlWithSize(item.record.cover, 220);
  return '';
}
function pushHomeHistoryTile(tiles, rec, sessionSongKey) {
  if (!rec || tiles.length >= 5) return false;
  var recSong = songFromListenRecord(rec);
  var recKey = queueItemKey(recSong);
  if (!recKey || (sessionSongKey && recKey === sessionSongKey)) return false;
  if (tiles.some(function(t) {
    if (t.kind !== 'recent') return false;
    var tKey = t.record ? queueItemKey(songFromListenRecord(t.record)) : (t.song ? queueItemKey(t.song) : '');
    return tKey && tKey === recKey;
  })) return false;
  tiles.push({
    kind: 'recent',
    title: rec.name || '继续听',
    sub: formatContinueSub({ artist: rec.artist || '', platform: homePlatformKey(recSong), song: recSong }),
    cover: rec.cover || '',
    record: rec,
    song: recSong,
    platform: homePlatformKey(recSong),
    local: true
  });
  return true;
}
function homeTilesSignature(tiles, loading) {
  return JSON.stringify({
    loading: !!loading,
    tiles: (tiles || []).map(function(item, index) {
      return {
        kind: item.kind || '',
        title: item.title || '',
        sub: item.sub || '',
        cover: homeTileCover(item) || '',
        index: item.index != null ? item.index : null,
        query: item.query || '',
        progressPercent: item.progressPercent != null ? item.progressPercent : null,
        platform: item.platform || '',
      };
    }),
  });
}
function homeToneForItem(item, index) {
  if (!item) return 'daily';
  if (item.kind === 'weatherSong' || item.kind === 'sceneSong') return 'daily';
  if (item.kind === 'recent') return 'search';
  if (item.kind === 'profile') return 'local';
  if (item.tone) return item.tone;
  if (item.kind === 'song') return index % 2 ? 'search' : 'daily';
  if (item.kind === 'playlist') return 'playlist';
  if (item.kind === 'podcast' || item.kind === 'podcastSearch') return 'podcast';
  if (item.kind === 'local') return 'local';
  if (item.kind === 'guide') return 'guide';
  if (item.kind === 'login') return 'library';
  if (item.kind === 'search') return 'search';
  return ['daily', 'playlist', 'local', 'guide', 'search'][index % 5];
}
function renderHomeMosaic(items) {
  var cells = document.querySelectorAll('#home-mosaic .home-mosaic-cell');
  if (!cells.length) return;
  var covers = [];
  (items || []).forEach(function(item){
    var cover = homeTileCover(item);
    if (cover) covers.push(cover);
  });
  for (var i = 0; i < cells.length; i++) {
    var src = covers[i] || '';
    cells[i].style.backgroundImage = src ? 'url("' + cssImageUrl(src) + '")' : '';
    cells[i].classList.toggle('has-cover', !!src);
    cells[i].classList.toggle('home-skeleton', !src && homeDiscoverState.loading);
  }
}
function renderHomeTiles() {
  var row = document.getElementById('home-tile-row');
  var title = document.getElementById('home-rail-title');
  var note = document.getElementById('home-rail-note');
  if (!row) return;
  var tiles = [];
  var tileSeen = {};
  var loggedOutHome = !homeDiscoverState.loggedIn && !hasAnyPlatformLogin();
  var weatherSongs = homeWeatherRadioState.radio && homeWeatherRadioState.radio.songs || [];
  var sceneSongs = homeSceneRadioState.loaded && homeSceneRadioState.radio && homeSceneRadioState.radio.songs || [];
  var radioSongs = sceneSongs.length ? sceneSongs : weatherSongs;
  var summary = homeListenSummary();
  var continuePres = getContinuePresentation();
  var hasSession = !!(readPlaybackSession() && readPlaybackSession().song);
  var sessionSongKey = hasSession && continuePres && continuePres.song ? queueItemKey(continuePres.song) : '';
  (listenStatsState.history || []).some(function(rec) {
    if (tiles.length >= 5) return true;
    var recSong = songFromListenRecord(rec);
    var recKey = queueItemKey(recSong);
    if (!recKey || (sessionSongKey && recKey === sessionSongKey)) return false;
    pushHomeTileUnique(tiles, {
      kind: 'recent',
      title: rec.name || '继续听',
      sub: formatContinueSub({ artist: rec.artist || '', platform: homePlatformKey(recSong), song: recSong }),
      cover: rec.cover || '',
      record: rec,
      song: recSong,
      platform: homePlatformKey(recSong),
      local: true
    }, tileSeen);
    return false;
  });
  if (!hasSession && continuePres && tiles.length < 5 && continuePres.song) {
    pushHomeTileUnique(tiles, {
      kind: 'recent',
      title: continuePres.title,
      sub: formatContinueSub(continuePres),
      cover: continuePres.cover,
      record: continuePres.record,
      song: continuePres.song,
      platform: continuePres.platform,
      progressPercent: continueProgressPercent(continuePres),
      local: true
    }, tileSeen);
  }
  if (summary.topArtist && tiles.length < 5) {
    pushHomeTileUnique(tiles, { kind: 'profile', title: summary.topArtist.name, sub: '常听歌手 · ' + summary.topArtist.plays + ' 次', query: summary.topArtist.name }, tileSeen);
  }
  if (!loggedOutHome) {
    homeDiscoverState.songs.slice(0, 8).forEach(function(song, i){
      if (tiles.length >= 5) return;
      pushHomeTileUnique(tiles, { kind: 'song', index: i, song: song, title: song.name || '今日歌曲', sub: song.artist || songSourceLabel(song) }, tileSeen);
    });
    homeDiscoverState.playlists.slice(0, 6).forEach(function(pl, i){
      if (tiles.length >= 5) return;
      pushHomeTileUnique(tiles, { kind: 'playlist', index: i, title: pl.name || '推荐歌单', sub: (pl.trackCount ? pl.trackCount + ' 首' : 'Playlist') + (pl.playCount ? ' · ' + compactHomeCount(pl.playCount) + ' 播放' : ''), cover: pl.cover }, tileSeen);
    });
    homeDiscoverState.podcasts.slice(0, 4).forEach(function(p, i){
      if (tiles.length >= 5) return;
      pushHomeTileUnique(tiles, { kind: 'podcast', index: i, title: p.name || '热门播客', sub: p.djName || p.category || 'Podcast', cover: p.cover }, tileSeen);
    });
  }
  if (tiles.length < 5) {
    radioSongs.slice(0, 8).forEach(function(song, i){
      if (tiles.length >= 5) return;
      pushHomeTileUnique(tiles, { kind: sceneSongs.length ? 'sceneSong' : 'weatherSong', index: i, song: song, title: song.name || (sceneSongs.length ? '场景电台歌曲' : '天气电台歌曲'), sub: song.artist || songSourceLabel(song) }, tileSeen);
    });
  }
  if (!tiles.length) tiles = fallbackHomeTiles();
  tiles = tiles.slice(0, 5);
  if (title) title.textContent = hasSession ? '最近还听过' : (continuePres ? '接着听' : (loggedOutHome ? '先从这里开始' : '你的歌单与推荐'));
  applyHomeRailNote(note, hasSession, loggedOutHome, radioSongs);
  var tileSig = homeTilesSignature(tiles, homeDiscoverState.loading);
  if (row._homeTilesSig === tileSig) {
    row._homeTiles = tiles;
    return;
  }
  row._homeTilesSig = tileSig;
  row.innerHTML = tiles.map(function(item, i){
    var cover = homeTileCover(item);
    var tone = homeToneForItem(item, i);
    var coverClass = 'home-tile-cover' + (cover ? ' has-cover' : '');
    var platformHtml = item.platform ? '<span class="home-tile-platform is-visible" data-platform="' + escAttr(item.platform) + '">' + escHtml(homePlatformShortLabel(item.song)) + '</span>' : '';
    var progressHtml = item.progressPercent > 0 ? '<div class="home-tile-continue-progress is-visible"><div class="home-tile-continue-progress-fill" style="width:' + item.progressPercent + '%"></div></div>' : '';
    return '<button class="home-tile' + (!cover && homeDiscoverState.loading && !item.local ? ' home-skeleton' : '') + '" data-home-tone="' + escAttr(tone) + '" type="button" onclick="handleHomeTileClick(' + i + ')">' +
      '<div class="' + coverClass + '" style="' + (cover ? 'background-image:url(&quot;' + escHtml(cssImageUrl(cover)) + '&quot;)' : '') + '">' + platformHtml + progressHtml + '</div>' +
      '<div class="home-tile-title">' + escHtml(item.title || '') + '</div>' +
      '<div class="home-tile-sub">' + escHtml(item.sub || '') + '</div>' +
    '</button>';
  }).join('');
  row._homeTiles = tiles;
  renderHomeMosaic(tiles);
}
function renderHomeDiscover(opts) {
  opts = opts || {};
  var sub = document.getElementById('home-subtitle');
  var loggedOutHome = !homeDiscoverState.loggedIn && !hasAnyPlatformLogin();
  var weather = homeWeatherRadioState.weather;
  var radio = homeWeatherRadioState.radio;
  var weatherLocation = weather && weather.location && weather.location.name || homeWeatherRadioState.city || '上海';
  if (weatherLocation === '当前位置' || weatherLocation === '定位中') {
    var savedLocate = hasSavedWeatherLocate();
    if (savedLocate && savedLocate.city && savedLocate.city !== '当前位置' && savedLocate.city !== '定位中') {
      weatherLocation = savedLocate.city;
    }
  }
  var weatherTitle = document.getElementById('home-weather-title');
  var weatherKicker = document.getElementById('home-weather-kicker');
  var weatherMeta = document.getElementById('home-weather-meta');
  if (weatherTitle) weatherTitle.textContent = '我的音乐库';
  if (weatherKicker) weatherKicker.textContent = 'Mineradio · Your Library';
  if (sub) {
    if (loggedOutHome) sub.textContent = '登录后会把你的歌单、常听歌手和最近播放放在这里；也可以直接搜索或导入本地音乐。';
    else sub.textContent = '从你的歌单、最近播放和常听歌手开始，天气电台放在需要氛围的时候再开。';
  }
  if (weatherMeta) renderHomeWeatherMeta(weatherMeta, weather, weatherLocation);
  var daily = null;
  var cardSongB = null;
  var cardSongC = null;
  var playlistItem = homeDiscoverState.playlists[0] || null;
  var playlistItemB = homeDiscoverState.playlists[1] || null;
  var podcastItem = homeDiscoverState.podcasts[0] || null;
  var summary = homeListenSummary();
  var featuredSongs = buildHomeFeaturedSongs();
  daily = featuredSongs[0] || null;
  cardSongB = featuredSongs[1] || null;
  cardSongC = featuredSongs[2] || null;
  var profileCover = '';
  if (podcastItem && podcastItem.cover) profileCover = podcastItem.cover;
  else if (summary.topSong && summary.topSong.cover && homeSongVisualKey(summary.topSong) !== homeSongVisualKey(daily)) profileCover = summary.topSong.cover;
  var libraryPlaylistCover = (userPlaylists[0] && userPlaylists[0].cover) || '';
  var privateCover = (cardSongB && cardSongB.cover) || (playlistItemB && playlistItemB.cover) || '';
  var librarySongCover = (cardSongC && cardSongC.cover) || (summary.recent && summary.recent.cover) || '';
  var weatherCardTitle = document.getElementById('home-weather-card-title');
  var weatherCardSub = document.getElementById('home-weather-card-sub');
  var dailyTitle = document.getElementById('home-daily-title');
  var dailySub = document.getElementById('home-daily-sub');
  var privateTitle = document.getElementById('home-private-title');
  var privateSub = document.getElementById('home-private-sub');
  var continueTitle = document.getElementById('home-continue-title');
  var continueSub = document.getElementById('home-continue-sub');
  var profileTitle = document.getElementById('home-profile-title');
  var profileSub = document.getElementById('home-profile-sub');
  var libTitle = document.getElementById('home-library-title');
  var libSub = document.getElementById('home-library-sub');
  if (weatherCardTitle) weatherCardTitle.textContent = '我的歌单';
  if (weatherCardSub) {
    weatherCardSub.textContent = playlistItem ? (((playlistItem.trackCount || 0) ? playlistItem.trackCount + ' 首 · ' : '') + (playlistItem.creator || '打开左侧歌单库')) : '打开左侧歌单库';
  }
  var continuePres = getContinuePresentation();
  if (continueTitle) continueTitle.textContent = continuePres ? continuePres.title : '继续听';
  if (continueSub) continueSub.textContent = continuePres ? formatContinueCardSub(continuePres) : '最近播放会出现在这里';
  if (profileTitle) profileTitle.textContent = summary.topArtist ? summary.topArtist.name : (summary.topSong ? summary.topSong.name : '听歌画像');
  if (profileSub) profileSub.textContent = summary.topArtist ? ('常听歌手 · ' + summary.topArtist.plays + ' 次') : (summary.totalPlays ? summary.totalPlays + ' 次有效播放' : '播放几首后生成偏好');
  if (loggedOutHome) {
    if (dailyTitle) dailyTitle.textContent = '每日推荐';
    if (dailySub) dailySub.textContent = '登录后同步你的今日歌曲';
    if (privateTitle) privateTitle.textContent = '推荐歌曲';
    if (privateSub) privateSub.textContent = '登录后同步更多歌曲';
    if (libTitle) libTitle.textContent = '平台推荐';
    if (libSub) libSub.textContent = '网易云 / 汽水 / Spotify 热门与个性化';
    setHomeArt('home-weather-art', '', 280);
    setHomeArt('home-daily-art', '', 280);
    setHomeArt('home-private-art', '', 280);
    setHomeArt('home-continue-art', continuePres && continuePres.cover, 280);
    setHomeArt('home-profile-art', summary.topSong && summary.topSong.cover || summary.recent && summary.recent.cover, 280);
    setHomeArt('home-library-art', (homeDiscoverState.songs[0] && homeDiscoverState.songs[0].cover) || '', 280);
  } else {
    if (dailyTitle) dailyTitle.textContent = daily ? daily.name : '每日推荐';
    if (dailySub) dailySub.textContent = daily ? ((daily.artist || songSourceLabel(daily) || '今日歌曲') + ' · 点击播放今日队列') : '同步你的今日歌曲';
    if (privateTitle) privateTitle.textContent = cardSongB ? cardSongB.name : (playlistItem ? playlistItem.name : '私人雷达');
    if (privateSub) privateSub.textContent = cardSongB ? (cardSongB.artist || songSourceLabel(cardSongB) || '推荐歌曲') : (playlistItem ? ((playlistItem.trackCount ? playlistItem.trackCount + ' 首 · ' : '') + (playlistItem.creator || '推荐歌单')) : (homeDiscoverState.songs.length + ' 首 · 根据今日推荐与常听偏好'));
    if (libTitle) libTitle.textContent = '平台推荐';
    if (libSub) {
      var platformBits = [];
      if (homeDiscoverState.songs && homeDiscoverState.songs.length) platformBits.push(homeDiscoverState.songs.length + ' 首可播');
      if (homeDiscoverState.playlists && homeDiscoverState.playlists.length) platformBits.push(homeDiscoverState.playlists.length + ' 个歌单');
      libSub.textContent = platformBits.length ? platformBits.join(' · ') : '打开各平台推荐中心';
    }
    setHomeArt('home-weather-art', libraryPlaylistCover, 280);
    setHomeArt('home-daily-art', daily && daily.cover, 280);
    setHomeArt('home-private-art', privateCover, 280);
    setHomeArt('home-continue-art', continuePres && continuePres.cover || playlistItem && playlistItem.cover, 280);
    setHomeArt('home-profile-art', profileCover, 280);
    setHomeArt('home-library-art', librarySongCover || (daily && daily.cover) || '', 280);
  }
  renderHomeTiles();
  if (typeof renderHomeDashboardDiscovery === 'function') renderHomeDashboardDiscovery();
  syncContinueCard();
  if (typeof syncHomeWeatherFx === 'function') syncHomeWeatherFx();
  maybeResolveWeatherLocationLabel();
}
function maybeResolveWeatherLocationLabel() {
  if (homeWeatherRadioState.testMode || homeWeatherRadioState.loading) return false;
  var weather = homeWeatherRadioState.weather;
  var loc = weather && weather.location;
  if (!loc || !isFinite(Number(loc.latitude)) || !isFinite(Number(loc.longitude))) return false;
  if (!isGenericWeatherCityName(loc.name) && !isGenericWeatherCityName(homeWeatherRadioState.city)) return false;
  if (homeWeatherLabelResolveAttempted >= 3) return false;
  homeWeatherLabelResolveAttempted++;
  loadHomeWeatherRadio(true, {
    lat: Number(loc.latitude),
    lon: Number(loc.longitude),
    city: '当前位置',
    timezone: loc.timezone || ''
  });
  return true;
}
async function loadHomeDiscover(force) {
  if (homeDiscoverState.loading) {
    if (!force) return;
    ++homeDiscoverToken;
  }
  if (homeDiscoverState.loaded && !force) return;
  if (!force && !homeDiscoverState.loaded) {
    if (hydrateHomeDiscoverFromCache()) renderHomeDiscover();
  }
  var token = ++homeDiscoverToken;
  homeDiscoverState.loading = true;
  homeDiscoverState.error = '';
  try {
    var qishuiReady = !!(typeof qishuiLoginStatus !== 'undefined' && qishuiLoginStatus.loggedIn && (qishuiLoginStatus.webSession || qishuiLoginStatus.cookieReady));
    var requests = [apiJson('/api/discover/home?t=' + Date.now())];
    if (qishuiReady) requests.push(apiJson('/api/qishui/feed?limit=12').catch(function () { return null; }));
    var settled = await Promise.all(requests);
    if (token !== homeDiscoverToken) return;
    var data = settled[0];
    var qishuiFeed = settled[1];
    homeDiscoverState.loggedIn = !!(data && data.loggedIn) || qishuiReady || hasAnyPlatformLogin();
    homeDiscoverState.mode = data && data.mode || (homeDiscoverState.loggedIn ? 'member' : 'starter');
    var neteaseSongs = (data && data.loggedIn ? (data.dailySongs || []) : []).map(cloneSong);
    var qishuiSongs = ((qishuiFeed && (qishuiFeed.songs || qishuiFeed.tracks)) || []).map(function (song) {
      var cloned = cloneSong(song);
      cloned.provider = cloned.provider || 'qishui';
      cloned.source = cloned.source || 'qishui';
      return cloned;
    });
    // 汽水已登录时优先展示汽水日推/feed，再补网易云日推
    homeDiscoverState.songs = qishuiSongs.length
      ? qishuiSongs.concat(neteaseSongs).slice(0, 18)
      : neteaseSongs;
    homeDiscoverState.playlists = (data && data.loggedIn ? (data.playlists || []) : []).slice();
    if (qishuiReady && qishuiSongs.length) {
      homeDiscoverState.playlists.unshift({
        id: 'qishui-feed',
        provider: 'qishui',
        source: 'qishui',
        name: '汽水推荐',
        cover: qishuiSongs[0] && qishuiSongs[0].cover || '',
        trackCount: qishuiSongs.length,
        creator: '汽水音乐',
        virtual: true
      });
    }
    homeDiscoverState.podcasts = data && data.loggedIn ? (data.podcasts || []) : [];
    homeDiscoverState.updatedAt = Number(data && data.updatedAt) || Date.now();
    homeDiscoverState.loaded = true;
    homeDiscoverState.stale = false;
    persistHomeDiscoverCache();
  } catch (e) {
    console.warn('home discover failed:', e);
    if (token === homeDiscoverToken) homeDiscoverState.error = 'DISCOVER_FAILED';
  } finally {
    if (token === homeDiscoverToken) {
      homeDiscoverState.loading = false;
      renderHomeDiscover();
    }
  }
}
function homePlaylistQueueId(item) {
  if (!item || !item.id) return '';
  var id = String(item.id);
  var provider = String(item.provider || item.source || '').toLowerCase();
  if (provider === 'qishui' && id.indexOf('qishui:') !== 0) return 'qishui:' + id;
  if (provider === 'qq' && id.indexOf('qq:') !== 0) return 'qq:' + id;
  if (provider === 'kugou' && id.indexOf('kugou:') !== 0) return 'kugou:' + id;
  if (provider === 'spotify' && id.indexOf('spotify:') !== 0) return 'spotify:' + id;
  return id;
}
function homeWeatherRadioUrl(opts) {
  opts = opts || {};
  var params = [];
  if (opts.lat != null && opts.lon != null) {
    params.push('lat=' + encodeURIComponent(opts.lat));
    params.push('lon=' + encodeURIComponent(opts.lon));
    params.push('city=' + encodeURIComponent(opts.city || '当前位置'));
  } else {
    params.push('city=' + encodeURIComponent(opts.city || homeWeatherRadioState.city || '上海'));
  }
  params.push('timezone=' + encodeURIComponent(opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto'));
  params.push('t=' + Date.now());
  return '/api/weather/radio?' + params.join('&');
}
async function loadHomeWeatherRadio(force, opts) {
  opts = opts || {};
  if (homeWeatherRadioState.testMode && !force) return homeWeatherRadioState;
  if (homeWeatherRadioState.loading && homeWeatherLoadPromise && opts.lat == null && opts.lon == null && !opts.city) {
    return homeWeatherLoadPromise;
  }
  if (homeWeatherRadioState.loading && !force) return homeWeatherRadioState;
  var staleMs = 45 * 60 * 1000;
  var isStale = !homeWeatherRadioState.updatedAt || (Date.now() - homeWeatherRadioState.updatedAt > staleMs);
  if (homeWeatherRadioState.loaded && !force && !opts.lat && !opts.city && !isStale && !homeWeatherRadioState.error) return homeWeatherRadioState;
  var token = ++homeWeatherToken;
  homeWeatherRadioState.loading = true;
  homeWeatherRadioState.error = '';
  var loadPromise = (async function(){
    try {
      var data = await apiJson(homeWeatherRadioUrl(opts), { timeoutMs: 14000 });
      if (token !== homeWeatherToken) return homeWeatherRadioState;
      if (homeWeatherRadioState.testMode) return homeWeatherRadioState;
      homeWeatherRadioState.weather = data && data.weather || null;
      homeWeatherRadioState.radio = data && data.radio || null;
      homeWeatherRadioState.loaded = true;
      homeWeatherRadioState.updatedAt = Date.now();
      homeWeatherRadioState.error = (homeWeatherRadioState.weather && homeWeatherRadioState.weather.fallback) ? 'WEATHER_FALLBACK' : '';
      persistHomeWeatherCache();
      if (homeWeatherRadioState.weather && homeWeatherRadioState.weather.location && homeWeatherRadioState.weather.location.name) {
        var resolvedCity = homeWeatherRadioState.weather.location.name;
        if (resolvedCity !== '当前位置' && resolvedCity !== '定位中') {
          homeWeatherRadioState.city = resolvedCity;
          homeWeatherLabelResolveAttempted = 0;
          localStorage.setItem(HOME_WEATHER_CITY_KEY, homeWeatherRadioState.city);
          var loc = homeWeatherRadioState.weather.location;
          if (isFinite(Number(loc.latitude)) && isFinite(Number(loc.longitude))) {
            saveWeatherLocate({
              lat: Number(loc.latitude),
              lon: Number(loc.longitude),
              city: resolvedCity,
              timezone: loc.timezone || ''
            });
          }
        }
      } else if (opts.city) {
        homeWeatherRadioState.city = opts.city;
        localStorage.setItem(HOME_WEATHER_CITY_KEY, homeWeatherRadioState.city);
      }
    } catch (e) {
      console.warn('weather radio failed:', e);
      if (token === homeWeatherToken) homeWeatherRadioState.error = 'WEATHER_FAILED';
    } finally {
      if (token === homeWeatherToken) {
        homeWeatherRadioState.loading = false;
        if (!homeWeatherRadioState.testMode && emptyHomeActive) renderHomeDiscover({ forceRefresh: true });
      }
    }
    return homeWeatherRadioState;
  })();
  homeWeatherLoadPromise = loadPromise;
  try {
    return await loadPromise;
  } finally {
    if (homeWeatherLoadPromise === loadPromise) homeWeatherLoadPromise = null;
  }
}
function hasManualWeatherCity() {
  try { return localStorage.getItem(HOME_WEATHER_MANUAL_KEY) === '1'; } catch (e) { return false; }
}
function hasSavedWeatherLocate() {
  try {
    var raw = localStorage.getItem(HOME_WEATHER_LOCATE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data || !isFinite(Number(data.lat)) || !isFinite(Number(data.lon))) return null;
    return data;
  } catch (e) { return null; }
}
function saveWeatherLocate(data) {
  try {
    localStorage.setItem(HOME_WEATHER_LOCATE_KEY, JSON.stringify({
      lat: data.lat,
      lon: data.lon,
      city: data.city || '当前位置',
      timezone: data.timezone || '',
      updatedAt: Date.now()
    }));
  } catch (e) {}
}
function markManualWeatherCity() {
  try { localStorage.setItem(HOME_WEATHER_MANUAL_KEY, '1'); } catch (e) {}
}
function clearManualWeatherCity() {
  try { localStorage.removeItem(HOME_WEATHER_MANUAL_KEY); } catch (e) {}
}
function shouldAutoLocateWeatherCity() {
  if (hasManualWeatherCity()) return false;
  if (hasSavedWeatherLocate() && !hasManualWeatherCity()) return false;
  var city = String(homeWeatherRadioState.city || localStorage.getItem(HOME_WEATHER_CITY_KEY) || '上海').trim();
  if (city && city !== '上海' && city !== '当前位置' && city !== '定位中') return false;
  if (homeWeatherRadioState.error === 'WEATHER_FAILED' || homeWeatherRadioState.error === 'LOCATION_FAILED') return true;
  return city === '上海' && !homeWeatherAutoLocateAttempted;
}
function maybeAutoLocateWeatherCity() {
  var saved = hasSavedWeatherLocate();
  if (saved && !hasManualWeatherCity()) {
    loadHomeWeatherRadio(false, {
      lat: saved.lat,
      lon: saved.lon,
      city: isGenericWeatherCityName(saved.city) ? '当前位置' : (saved.city || '当前位置'),
      timezone: saved.timezone || ''
    });
    return true;
  }
  var city = String(homeWeatherRadioState.city || localStorage.getItem(HOME_WEATHER_CITY_KEY) || '上海').trim();
  if (!shouldAutoLocateWeatherCity()) {
    if (!homeWeatherRadioState.loaded && city && city !== '定位中') {
      loadHomeWeatherRadio(false, { city: city });
      return true;
    }
    return false;
  }
  if (homeWeatherAutoLocateAttempted) return false;
  homeWeatherAutoLocateAttempted = true;
  loadHomeWeatherRadio(false, { city: '上海' });
  setTimeout(function(){
    if (!emptyHomeActive || hasManualWeatherCity()) return;
    locateWeatherRadio();
  }, 1200);
  return true;
}
function isGenericWeatherCityName(name) {
  var raw = String(name || '').trim();
  return !raw || raw === '当前位置' || raw === '定位中';
}
function renderHomeWeatherMeta(weatherMeta, weather, weatherLocation) {
  if (!weatherMeta) return;
  var html = '';
  html += '<button type="button" class="home-weather-pill home-weather-pill-action" onclick="changeWeatherCity(event)" title="点击换城市">' + escHtml(weatherLocation) + '</button>';
  if (weather && weather.weatherCode != null && isFinite(weather.temperature)) {
    html += '<span class="home-weather-pill">' + escHtml(weather.label + ' · ' + Math.round(weather.temperature || 0) + '°') + '</span>';
    html += '<span class="home-weather-pill">' + escHtml('体感 ' + Math.round(weather.apparentTemperature || weather.temperature || 0) + '°') + '</span>';
    if (isFinite(weather.humidity)) html += '<span class="home-weather-pill">' + escHtml('湿度 ' + Math.round(weather.humidity) + '%') + '</span>';
  } else if (homeWeatherRadioState.loading) {
    html += '<span class="home-weather-pill">正在获取天气</span>';
  } else if (homeWeatherRadioState.error) {
    html += '<button type="button" class="home-weather-pill home-weather-pill-action" onclick="retryHomeWeatherRadio(event)" title="重新拉取天气">天气暂不可用 · 点击重试</button>';
  } else {
    html += '<span class="home-weather-pill">正在整理天气</span>';
  }
  html += '<button type="button" class="home-weather-pill home-weather-pill-action home-weather-pill-locate" onclick="locateWeatherRadio(event)" title="优先 GPS，失败则使用网络 IP 定位">定位</button>';
  html += '<span class="home-weather-pill home-weather-pill-note" title="Open-Meteo 网格数据，仅供参考">仅供参考</span>';
  weatherMeta.innerHTML = html;
}
function retryHomeWeatherRadio(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  homeWeatherRadioState.loaded = false;
  homeWeatherRadioState.error = '';
  var saved = hasSavedWeatherLocate();
  if (saved && !hasManualWeatherCity()) {
    loadHomeWeatherRadio(true, { lat: saved.lat, lon: saved.lon, city: saved.city || '当前位置', timezone: saved.timezone || '' });
    return;
  }
  loadHomeWeatherRadio(true, { city: homeWeatherRadioState.city || localStorage.getItem(HOME_WEATHER_CITY_KEY) || '上海' });
}
function cancelHomeWeatherTestLoads() {
  if (homeWeatherLoadTimer) {
    clearTimeout(homeWeatherLoadTimer);
    homeWeatherLoadTimer = null;
  }
  homeWeatherToken++;
  homeWeatherRadioState.loading = false;
  homeWeatherLoadPromise = null;
}
window.cancelHomeWeatherTestLoads = cancelHomeWeatherTestLoads;
function scheduleHomeWeatherLoad(delay) {
  if (homeWeatherRadioState.testMode) return;
  if (homeWeatherLoadTimer) return;
  homeWeatherLoadTimer = setTimeout(function(){
    homeWeatherLoadTimer = null;
    if (!emptyHomeActive) return;
    if (!maybeAutoLocateWeatherCity()) loadHomeWeatherRadio(false);
  }, delay || 420);
}
function weatherRadioContext() {
  var weather = homeWeatherRadioState.weather || {};
  var radio = homeWeatherRadioState.radio || {};
  return {
    type: 'weather-radio',
    provider: 'open-meteo',
    title: radio.title || '天气电台',
    location: weather.location && weather.location.name || homeWeatherRadioState.city || '',
    weather: weather.label || '',
    temperature: weather.temperature,
    mood: weather.mood && weather.mood.key || '',
  };
}
async function startWeatherRadio(opts) {
  opts = opts || {};
  if (homeRadioStartBusy) return;
  if (isSceneRadioActive()) clearSceneRadioState();
  homeRadioStartBusy = true;
  try {
  if (!homeWeatherRadioState.loaded || !(homeWeatherRadioState.radio && homeWeatherRadioState.radio.songs && homeWeatherRadioState.radio.songs.length)) {
    showToast('正在生成天气电台');
    await loadHomeWeatherRadio(true);
  }
  var radio = homeWeatherRadioState.radio;
  if (!radio || !radio.songs || !radio.songs.length) {
    var seed = radio && radio.seedQueries && radio.seedQueries[0] || '雨天 R&B';
    showToast('天气队列暂时为空，先打开搜索');
    runHomeSearch(seed);
    return;
  }
  activeRadioContext = weatherRadioContext();
  playQueue = radio.songs.map(function(song){
    var cloned = cloneSong(song);
    cloned.radioContext = activeRadioContext;
    return cloned;
  });
  currentIdx = 0;
  prepareLeaveHomeForPlayback({ unsuppress: !opts.preserveHomeState });
  safeRenderQueuePanel('weather-radio-start');
  safeShelfRebuild('weather-radio-start', true);
  forcePlaybackControlsInteractive();
  try {
    await playQueueAt(0, { context: activeRadioContext });
  } catch (e) {
    console.warn('[WeatherRadioStartPlay]', e);
    showToast('天气电台已载入，播放启动失败');
  }
  forcePlaybackControlsInteractive();
  showToast((radio.title || '天气电台') + ' · ' + playQueue.length + ' 首');
  } finally {
    homeRadioStartBusy = false;
  }
}
var emptyHomeStartEl = document.getElementById('empty-home');
if (emptyHomeStartEl) {
  emptyHomeStartEl.addEventListener('click', function(e){
    var start = e.target && e.target.closest ? e.target.closest('[data-home-radio-start]') : null;
    if (!start || !emptyHomeStartEl.contains(start)) return;
    e.preventDefault();
    e.stopPropagation();
    startWeatherRadio();
  }, true);
}
function locateWeatherRadio(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  var previousWeatherCity = homeWeatherRadioState.city || '上海';
  homeWeatherToken++;
  homeWeatherRadioState.loading = true;
  homeWeatherRadioState.loaded = false;
  homeWeatherRadioState.error = '';
  homeWeatherRadioState.weather = null;
  homeWeatherRadioState.radio = null;
  clearSceneRadioState();
  clearManualWeatherCity();
  homeWeatherRadioState.city = '定位中';
  homeWeatherLabelResolveAttempted = 0;
  renderHomeDiscover();
  var locationSettled = false;
  var ipFallbackStarted = false;
  var ipFallbackTimer = null;
  function settleLocation(loc, sourceLabel) {
    if (locationSettled || !loc || !isFinite(Number(loc.latitude)) || !isFinite(Number(loc.longitude))) return false;
    locationSettled = true;
    if (ipFallbackTimer) {
      clearTimeout(ipFallbackTimer);
      ipFallbackTimer = null;
    }
    var city = loc.city || loc.name || '当前位置';
    homeWeatherRadioState.city = city;
    localStorage.setItem(HOME_WEATHER_CITY_KEY, city);
    saveWeatherLocate({
      lat: Number(loc.latitude),
      lon: Number(loc.longitude),
      city: city,
      timezone: loc.timezone || ''
    });
    renderHomeDiscover();
    showToast('已定位到 ' + city + (sourceLabel ? ' · ' + sourceLabel : ''));
    loadHomeWeatherRadio(true, {
      lat: Number(loc.latitude),
      lon: Number(loc.longitude),
      city: city,
      timezone: loc.timezone || ''
    });
    return true;
  }
  function useIpFallback() {
    if (locationSettled || ipFallbackStarted) return;
    ipFallbackStarted = true;
    apiJson('/api/weather/ip-location?t=' + Date.now(), { timeoutMs: 12000 }).then(function(data){
      var loc = data && data.location;
      if (!loc || !isFinite(Number(loc.latitude)) || !isFinite(Number(loc.longitude))) throw new Error(data && data.error || 'IP_LOCATION_FAILED');
      settleLocation({
        latitude: loc.latitude,
        longitude: loc.longitude,
        city: loc.city || '当前位置',
        timezone: loc.timezone || ''
      }, '网络定位');
    }).catch(function(err){
      console.warn('weather ip location failed:', err);
      if (locationSettled) return;
      homeWeatherRadioState.loading = false;
      homeWeatherRadioState.error = 'LOCATION_FAILED';
      homeWeatherRadioState.city = previousWeatherCity;
      renderHomeDiscover();
      showToast('定位失败，可以手动输入城市');
    });
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(pos){
      settleLocation({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        city: '当前位置',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto'
      }, 'GPS');
    }, function(err){
      console.warn('weather gps location failed:', err);
      useIpFallback();
    }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 });
    ipFallbackTimer = setTimeout(function(){
      ipFallbackTimer = null;
      if (!locationSettled && !ipFallbackStarted) useIpFallback();
    }, 9500);
    return;
  }
  useIpFallback();
}
function changeWeatherCity(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  var city = window.prompt('输入城市名', homeWeatherRadioState.city || '上海');
  city = String(city || '').trim();
  if (!city) return;
  markManualWeatherCity();
  homeWeatherRadioState.city = city;
  localStorage.setItem(HOME_WEATHER_CITY_KEY, city);
  homeWeatherRadioState.loaded = false;
  loadHomeWeatherRadio(true, { city: city });
}
