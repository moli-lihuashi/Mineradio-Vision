/* Home dashboard subset: platform recommendation panel + entry hooks.
 * Full author MP4 hero / quick-grid rewrite is deferred; this wires the existing
 * #home-platform-recommend shell to discover/feed data. */
var homePlatformRecommendationControlsBound = false;
var homePlatformRecommendationDailyRenderRaf = 0;
var HOME_PLATFORM_DAILY_ROW_HEIGHT = 84;
var HOME_PLATFORM_DAILY_OVERSCAN_ROWS = 3;
var HOME_PLATFORM_DAILY_MAX_RENDERED_CARDS = 24;
var homePlatformRecommendationState = {
  open: false,
  source: 'netease',
  previousFocus: null,
  neteaseLoading: false,
  feeds: {
    qishui: { loading: false, loaded: false, songs: [], error: '', message: '', mode: '', source: '', fallback: false, provenance: '' },
    qq: { loading: false, loaded: false, songs: [], error: '', message: '', mode: '', source: '', fallback: false, provenance: '' },
    kugou: { loading: false, loaded: false, songs: [], error: '', message: '', mode: '', source: '', fallback: false, provenance: '' },
    spotify: { loading: false, loaded: false, songs: [], error: '', message: '', mode: '', source: '', fallback: false, provenance: '' },
  },
  likedAffinitySongs: [],
};

var homeDashboardDiscoveryCache = [];
var homeDashboardDiscoveryFingerprint = '';
function homeDashboardDayNumber() {
  var now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86400000);
}
function homeDashboardSongKey(song) {
  if (!song) return '';
  try {
    var queueKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
    if (queueKey) return String(queueKey);
  } catch (_error) { }
  var provider = song.provider || song.source || song.type || '';
  var id = song.id || song.mid || song.songmid || song.mediaMid || song.localPath || song.url || '';
  if (id) return provider + '|' + id;
  return provider + '|' + (song.name || song.title || '') + '|' + homeDashboardSubtitle(song);
}
function homeDashboardLocalSongs() {
  var pool = [];
  if (Array.isArray(playQueue)) pool = pool.concat(playQueue);
  if (Array.isArray(playlist)) pool = pool.concat(playlist);
  if (Array.isArray(userPlaylists)) {
    userPlaylists.forEach(function (item) {
      if (item && Array.isArray(item.songs)) pool = pool.concat(item.songs);
    });
  }
  var seen = Object.create(null);
  return pool.filter(function (song) {
    if (!song || song.type !== 'local') return false;
    var key = '';
    try { key = queueItemKey(song); } catch (_error) { }
    key = key || song.localPath || song.id || ((song.name || song.title || '') + '|' + (song.artist || ''));
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
function homeDashboardDiscoverySongs() {
  var candidates = [];
  var seen = Object.create(null);
  function addSongs(songs) {
    (Array.isArray(songs) ? songs : []).forEach(function (song) {
      if (!song) return;
      var key = homeDashboardSongKey(song);
      if (!key || seen[key]) return;
      seen[key] = true;
      candidates.push(song);
    });
  }
  addSongs(homeDiscoverState && homeDiscoverState.songs);
  addSongs(playQueue);
  if (Array.isArray(userPlaylists)) {
    userPlaylists.forEach(function (item) { addSongs(item && item.songs); });
  }
  addSongs(playlist);
  addSongs(homeDashboardLocalSongs());
  if (candidates.length <= 3) return candidates.slice();
  var day = homeDashboardDayNumber();
  var step = Math.max(1, Math.floor(candidates.length / 3));
  var picked = [];
  var pickedKeys = Object.create(null);
  for (var index = 0; index < candidates.length && picked.length < 3; index += 1) {
    var candidate = candidates[(day * 17 + index * step + index * 7) % candidates.length];
    var candidateKey = homeDashboardSongKey(candidate);
    if (!candidateKey || pickedKeys[candidateKey]) continue;
    pickedKeys[candidateKey] = true;
    picked.push(candidate);
  }
  return picked;
}
function homeDiscoverySongCardHtml(song, index) {
  var cover = homeDashboardSongCover(song, 180);
  var coverStyle = cover ? ' style="background-image:url(&quot;' + escHtml(cssImageUrl(cover)) + '&quot;)"' : '';
  return '<button class="home-discovery-song" type="button" data-discovery-index="' + index + '" onclick="playHomeDashboardDiscoverySong(' + index + ')">' +
    '<span class="home-discovery-cover"' + coverStyle + '></span>' +
    '<span class="home-discovery-song-copy"><span class="home-discovery-song-name">' + escHtml(song.name || song.title || '未知歌曲') + '</span>' +
    '<span class="home-discovery-song-artist">' + escHtml(homeDashboardSubtitle(song) || 'Mineradio 推荐') + '</span></span></button>';
}
var homeDiscoveryVirtualState = {
  root: null,
  start: 0,
  end: 0,
  itemH: 72,
  overscan: 6,
  bound: false
};
function homeDiscoveryVirtualWindow(root, total) {
  var viewH = Math.max(180, root.clientHeight || 360);
  var itemH = homeDiscoveryVirtualState.itemH;
  var scrollTop = root.scrollTop || 0;
  var visible = Math.ceil(viewH / itemH) + homeDiscoveryVirtualState.overscan * 2;
  var start = Math.max(0, Math.floor(scrollTop / itemH) - homeDiscoveryVirtualState.overscan);
  var end = Math.min(total, start + visible);
  return { start: start, end: end, itemH: itemH, total: total };
}
function paintHomeDiscoveryVirtualWindow(force) {
  var root = homeDiscoveryVirtualState.root || document.getElementById('home-discovery-list');
  if (!root || !homeDashboardDiscoveryCache.length) return;
  var win = homeDiscoveryVirtualWindow(root, homeDashboardDiscoveryCache.length);
  if (!force && win.start === homeDiscoveryVirtualState.start && win.end === homeDiscoveryVirtualState.end) return;
  homeDiscoveryVirtualState.start = win.start;
  homeDiscoveryVirtualState.end = win.end;
  homeDiscoveryVirtualState.root = root;
  var topPad = win.start * win.itemH;
  var bottomPad = Math.max(0, (win.total - win.end) * win.itemH);
  var html = ['<div class="home-discovery-virt-pad" style="height:' + topPad + 'px"></div>'];
  for (var i = win.start; i < win.end; i++) {
    html.push(homeDiscoverySongCardHtml(homeDashboardDiscoveryCache[i], i));
  }
  html.push('<div class="home-discovery-virt-pad" style="height:' + bottomPad + 'px"></div>');
  root.innerHTML = html.join('');
}
function bindHomeDiscoveryVirtualScroll(root) {
  if (!root || homeDiscoveryVirtualState.bound === root) return;
  homeDiscoveryVirtualState.bound = root;
  root.addEventListener('scroll', function () {
    paintHomeDiscoveryVirtualWindow(false);
  }, { passive: true });
}
function renderHomeDashboardDiscovery() {
  var root = document.getElementById('home-discovery-list');
  if (!root) return;
  homeDashboardDiscoveryCache = homeDashboardDiscoverySongs();
  var fingerprint = homeDashboardDiscoveryCache.map(function (song) {
    return [homeDashboardSongKey(song), song.name || song.title || '', homeDashboardSubtitle(song), homeDashboardSongCover(song, 180)].join('|');
  }).join('||');
  if (!fingerprint) fingerprint = 'empty';
  if (fingerprint === homeDashboardDiscoveryFingerprint) return;
  homeDashboardDiscoveryFingerprint = fingerprint;
  root.classList.toggle('is-empty', !homeDashboardDiscoveryCache.length);
  if (!homeDashboardDiscoveryCache.length) {
    root.innerHTML = '<button class="home-discovery-empty" type="button" onclick="openHomeLibrary()">' +
      '<strong>等待你的音乐</strong><span>登录平台或导入本地音乐后生成推荐</span></button>';
    homeDiscoveryVirtualState.start = 0;
    homeDiscoveryVirtualState.end = 0;
    return;
  }
  // C：长列表虚拟化，避免一次灌入全部 DOM
  if (homeDashboardDiscoveryCache.length > 24) {
    bindHomeDiscoveryVirtualScroll(root);
    homeDiscoveryVirtualState.root = root;
    homeDiscoveryVirtualState.start = -1;
    paintHomeDiscoveryVirtualWindow(true);
    return;
  }
  root.innerHTML = homeDashboardDiscoveryCache.map(function (song, index) {
    return homeDiscoverySongCardHtml(song, index);
  }).join('');
}
function playHomeDashboardDiscoverySong(index) {
  if (!homeDashboardDiscoveryCache.length) homeDashboardDiscoveryCache = homeDashboardDiscoverySongs();
  if (!homeDashboardDiscoveryCache.length) {
    if (typeof openHomeLibrary === 'function') openHomeLibrary();
    return;
  }
  playQueue = homeDashboardDiscoveryCache.map(function (song) { return cloneSong(song); });
  currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(index) || 0));
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('home-dashboard-discovery', { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('home-dashboard-discovery', true);
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  Promise.resolve(playQueueAt(currentIdx, {
    manual: true,
    context: { type: 'home-discovery', playlistName: '为你挑选' },
  })).catch(function (error) { console.warn('[HomeDashboardDiscovery]', error); });
}
function homeDashboardSubtitle(song) {
  if (!song) return '';
  if (song.artist) return String(song.artist);
  if (Array.isArray(song.artists) && song.artists[0]) {
    return song.artists.map(function (a) { return a && a.name || ''; }).filter(Boolean).join(' / ');
  }
  return String(song.album || song.albumName || '');
}

function homeDashboardSongCover(song, size) {
  if (!song) return '';
  var cover = song.cover || song.picUrl || song.albumCover || '';
  if (!cover) return '';
  return typeof coverUrlWithSize === 'function' ? coverUrlWithSize(cover, size || 180) : cover;
}

// 红心亲和推荐：从当前可见的歌曲池里取已标红心的歌（首页首页签名 = liked-affinity）
function homePlatformLikedAffinitySongs() {
  var pool = [];
  if (homeDiscoverState && Array.isArray(homeDiscoverState.songs)) pool = pool.concat(homeDiscoverState.songs);
  if (Array.isArray(playQueue)) pool = pool.concat(playQueue);
  if (Array.isArray(playlist)) pool = pool.concat(playlist);
  var seen = Object.create(null);
  var picked = [];
  for (var i = 0; i < pool.length && picked.length < 6; i++) {
    var song = pool[i];
    if (!song || typeof isSongLiked !== 'function' || !isSongLiked(song)) continue;
    var key = homeDashboardSongKey(song);
    if (!key || seen[key]) continue;
    seen[key] = true;
    picked.push(song);
  }
  return picked;
}

function playHomePlatformLikedAffinitySong(index) {
  var songs = homePlatformRecommendationState.likedAffinitySongs || [];
  if (!songs.length) return;
  playQueue = songs.map(function (song) { return typeof cloneSong === 'function' ? cloneSong(song) : song; });
  currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(index) || 0));
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('home-liked-affinity', { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('home-liked-affinity', true);
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  Promise.resolve(playQueueAt(currentIdx, {
    manual: true,
    context: { type: 'home-liked-affinity', playlistName: '红心亲和推荐' },
  })).catch(function (error) { console.warn('[HomeLikedAffinityPlay]', error); });
}

// ===== 稳定封面：先 Image 预加载再上背景，避免封面切换闪烁；同一元素同源请求去重 =====
var homeDashboardStableCoverRequests = new Map();
function homeDashboardSetStableBackgroundImage(element, source) {
  if (!element) return;
  var requested = String(source || '');
  var current = element.getAttribute('data-stable-cover-key') || '';
  var painted = element.style.backgroundImage || '';
  if (requested === current && painted) return;
  element.setAttribute('data-stable-cover-key', requested);
  if (!requested) {
    element.style.backgroundImage = '';
    return;
  }
  var image = new Image();
  image.onload = function () {
    if (element.getAttribute('data-stable-cover-key') !== requested) return;
    element.style.backgroundImage = 'url("' + requested + '")';
  };
  image.src = requested;
}

function applyHomeDashboardStableCovers(root) {
  if (!root || !root.querySelectorAll) return;
  var nodes = root.querySelectorAll('[data-cover-src]');
  for (var i = 0; i < nodes.length; i++) {
    homeDashboardSetStableBackgroundImage(nodes[i], nodes[i].getAttribute('data-cover-src'));
  }
}

function compactHomeCount(value) {
  var n = Number(value) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}

function homePlatformRecommendationSourceLabel(source) {
  return {
    netease: '网易云',
    qishui: '汽水',
    qq: 'QQ 音乐',
    kugou: '酷狗音乐',
    spotify: 'Spotify',
  }[source] || '当前平台';
}

function homePlatformRecommendationFeedConfig(source) {
  return {
    qishui: {
      endpoint: '/api/qishui/feed?limit=12',
      sectionTitle: '推荐 Feed',
      cardLabel: '汽水推荐 Feed',
      readyText: '来自汽水推荐 Feed',
      playlistName: '汽水推荐 Feed',
    },
    qq: {
      endpoint: '/api/qq/recommendations?limit=12',
      sectionTitle: 'QQ 推荐',
      cardLabel: 'QQ 音乐推荐',
      readyText: '来自 QQ 音乐推荐',
      playlistName: 'QQ 音乐推荐',
    },
    kugou: {
      endpoint: '/api/kugou/recommendations?limit=12',
      sectionTitle: '猜你喜欢',
      cardLabel: '酷狗私人FM推荐',
      readyText: '来自酷狗私人FM推荐',
      playlistName: '酷狗猜你喜欢',
    },
    spotify: {
      endpoint: '/api/spotify/recommendations?limit=12',
      sectionTitle: '个性化推荐',
      cardLabel: 'Spotify 推荐',
      readyText: '来自 Spotify 个性化推荐',
      playlistName: 'Spotify 个性化推荐',
    },
  }[source] || null;
}

function homePlatformRecommendationEmptyHtml(source, message) {
  return '<div class="home-platform-recommend-empty"><strong>' + escHtml(homePlatformRecommendationSourceLabel(source)) +
    '暂无推荐</strong><span>' + escHtml(message || '当前没有可展示的平台推荐内容。') + '</span></div>';
}

function homePlatformRecommendationCard(kind, index, item, label) {
  item = item || {};
  var title = item.name || item.title || '未命名内容';
  var sub = '';
  if (kind === 'netease-playlist') {
    sub = (item.trackCount ? item.trackCount + ' 首' : '推荐歌单') +
      (item.playCount ? ' · ' + compactHomeCount(item.playCount) + ' 播放' : '');
  } else {
    sub = homeDashboardSubtitle(item) || label;
  }
  var cover = item.cover || item.picUrl || homeDashboardSongCover(item, 180) || '';
  var coverAttr = cover ? ' data-cover-src="' + escHtml(cssImageUrl(cover)) + '"' : '';
  return '<button class="home-platform-recommend-card" type="button" data-home-recommend-kind="' + kind +
    '" data-home-recommend-index="' + index + '">' +
    '<span class="home-platform-recommend-cover"' + coverAttr + '></span>' +
    '<span class="home-platform-recommend-copy"><span class="home-platform-recommend-label">' + escHtml(label) +
    '</span><strong>' + escHtml(title) + '</strong><small>' + escHtml(sub) + '</small></span>' +
    '<span class="home-platform-recommend-arrow" aria-hidden="true">›</span></button>';
}

function homePlatformRecommendationDailyRange(total, columns, scrollTop, viewportHeight, gridOffsetTop) {
  total = Math.max(0, Number(total) || 0);
  columns = Math.max(1, Number(columns) || 1);
  var totalRows = Math.ceil(total / columns);
  if (!totalRows) return { start: 0, end: 0, topRows: 0, bottomRows: 0 };
  var localScrollTop = Math.max(0, (Number(scrollTop) || 0) - (Number(gridOffsetTop) || 0));
  var firstVisibleRow = Math.floor(localScrollTop / HOME_PLATFORM_DAILY_ROW_HEIGHT);
  var visibleRows = Math.max(1, Math.ceil((Number(viewportHeight) || 500) / HOME_PLATFORM_DAILY_ROW_HEIGHT));
  var maxRows = Math.max(1, Math.floor(HOME_PLATFORM_DAILY_MAX_RENDERED_CARDS / columns));
  var startRow = Math.max(0, firstVisibleRow - HOME_PLATFORM_DAILY_OVERSCAN_ROWS);
  var renderRows = Math.min(maxRows, visibleRows + HOME_PLATFORM_DAILY_OVERSCAN_ROWS * 2);
  var endRow = Math.min(totalRows, startRow + renderRows);
  if (endRow === totalRows) startRow = Math.max(0, endRow - renderRows);
  return {
    start: startRow * columns,
    end: Math.min(total, endRow * columns),
    topRows: startRow,
    bottomRows: Math.max(0, totalRows - endRow),
  };
}

function homePlatformRecommendationGridColumns(grid) {
  if (!grid) return 1;
  try {
    var template = window.getComputedStyle(grid).gridTemplateColumns;
    var columns = String(template || '').trim().split(/\s+/).filter(Boolean).length;
    if (columns > 0) return columns;
  } catch (_error) { }
  return grid.clientWidth > 560 ? 2 : 1;
}

function homePlatformRecommendationSpacer(rows, position) {
  if (!rows) return '';
  var height = Math.max(0, rows * HOME_PLATFORM_DAILY_ROW_HEIGHT - 8);
  return '<span class="home-platform-recommend-spacer" data-home-recommend-spacer="' + position +
    '" aria-hidden="true" style="grid-column:1/-1;height:' + height + 'px"></span>';
}

function paintHomePlatformCovers(root) {
  if (!root || !root.querySelectorAll) return;
  var nodes = root.querySelectorAll('.home-platform-recommend-cover[data-cover-src]');
  for (var i = 0; i < nodes.length; i++) {
    homeDashboardSetStableBackgroundImage(nodes[i], nodes[i].getAttribute('data-cover-src'));
  }
}

function renderHomePlatformDailyWindow(force) {
  if (homePlatformRecommendationState.source !== 'netease') return;
  var list = document.getElementById('home-platform-recommend-list');
  var grid = document.getElementById('home-platform-daily-grid');
  if (!list || !grid) return;
  var songs = Array.isArray(homeDiscoverState && homeDiscoverState.songs) ? homeDiscoverState.songs : [];
  var columns = homePlatformRecommendationGridColumns(grid);
  var range = homePlatformRecommendationDailyRange(
    songs.length,
    columns,
    list.scrollTop,
    list.clientHeight,
    grid.offsetTop
  );
  var signature = songs.length + '|' + columns + '|' + range.start + '|' + range.end;
  if (!force && grid.getAttribute('data-render-window') === signature) return;
  var html = [homePlatformRecommendationSpacer(range.topRows, 'top')];
  for (var index = range.start; index < range.end; index += 1) {
    html.push(homePlatformRecommendationCard('netease-song', index, songs[index], '网易云每日推荐'));
  }
  html.push(homePlatformRecommendationSpacer(range.bottomRows, 'bottom'));
  grid.innerHTML = html.join('');
  paintHomePlatformCovers(grid);
  grid.setAttribute('data-render-window', signature);
  var count = document.getElementById('home-platform-daily-count');
  if (count) count.textContent = songs.length ? ' · ' + songs.length + ' 首' : '';
}

function scheduleHomePlatformDailyWindowRender() {
  if (homePlatformRecommendationDailyRenderRaf) cancelAnimationFrame(homePlatformRecommendationDailyRenderRaf);
  homePlatformRecommendationDailyRenderRaf = requestAnimationFrame(function () {
    homePlatformRecommendationDailyRenderRaf = 0;
    renderHomePlatformDailyWindow(false);
  });
}

function renderHomePlatformRecommendations() {
  var panel = document.getElementById('home-platform-recommend');
  var list = document.getElementById('home-platform-recommend-list');
  var status = document.getElementById('home-platform-recommend-status');
  if (!panel || !list || !status) return;
  var source = homePlatformRecommendationState.source;
  var tabs = document.querySelectorAll('[data-home-recommend-source]');
  Array.prototype.forEach.call(tabs, function (tab) {
    var selected = tab.getAttribute('data-home-recommend-source') === source;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.classList.toggle('active', selected);
  });
  status.classList.remove('is-error');

  if (source === 'netease') {
    if ((homeDiscoverState && homeDiscoverState.loading) || homePlatformRecommendationState.neteaseLoading) {
      status.textContent = '正在读取网易云平台推荐…';
      list.innerHTML = '<div class="home-platform-recommend-loading">正在同步推荐内容</div>';
      return;
    }
    var sections = [];
    var playlists = homeDiscoverState && Array.isArray(homeDiscoverState.playlists) ? homeDiscoverState.playlists.slice(0, 6) : [];
    var songs = Array.isArray(homeDiscoverState.songs) ? homeDiscoverState.songs : [];
    var likedAffinitySongs = homePlatformLikedAffinitySongs();
    if (likedAffinitySongs.length) {
      sections.push('<section data-recommend-block="liked-affinity"><h3>红心亲和推荐</h3><div class="home-platform-recommend-grid">' +
        likedAffinitySongs.map(function (item, index) {
          return homePlatformRecommendationCard('liked-affinity-song', index, item, '红心亲和');
        }).join('') + '</div></section>');
    }
    if (playlists.length) {
      sections.push('<section><h3>推荐歌单</h3><div class="home-platform-recommend-grid">' + playlists.map(function (item, index) {
        return homePlatformRecommendationCard('netease-playlist', index, item, '网易云推荐歌单');
      }).join('') + '</div></section>');
    }
    if (songs.length) {
      sections.push('<section data-recommend-block="personal-top"><h3>每日推荐<span id="home-platform-daily-count"></span></h3>' +
        '<div id="home-platform-daily-grid" class="home-platform-recommend-grid" role="list" aria-label="全部每日推荐"></div></section>');
    }
    if (sections.length) {
      status.textContent = songs.length
        ? '已读取全部 ' + songs.length + ' 首每日推荐'
        : '来自网易云推荐歌单';
      list.innerHTML = sections.join('');
      if (songs.length) renderHomePlatformDailyWindow(true);
      paintHomePlatformCovers(list);
    } else {
      status.textContent = homeDiscoverState && homeDiscoverState.error ? '网易云推荐读取失败' : '网易云暂未返回推荐内容';
      status.classList.toggle('is-error', !!(homeDiscoverState && homeDiscoverState.error));
      list.innerHTML = homePlatformRecommendationEmptyHtml('netease',
        homeDiscoverState && homeDiscoverState.loggedIn
          ? '平台本次没有返回推荐内容。'
          : '登录网易云后可读取推荐歌单与每日推荐。');
    }
    homePlatformRecommendationState.likedAffinitySongs = likedAffinitySongs;
    paintHomePlatformCovers(list);
    return;
  }

  if (source === 'qq') {
    status.textContent = homePlatformRecommendationSourceLabel(source) + '推荐接口尚未接入本构建';
    list.innerHTML = homePlatformRecommendationEmptyHtml(source, '当前版本没有可验证的平台推荐接口，未使用关键词搜索替代。');
    return;
  }

  var feedConfig = homePlatformRecommendationFeedConfig(source);
  var feedState = homePlatformRecommendationState.feeds[source];
  if (feedConfig && feedState) {
    if (feedState.loading) {
      status.textContent = '正在读取' + homePlatformRecommendationSourceLabel(source) + '推荐…';
      list.innerHTML = '<div class="home-platform-recommend-loading">正在同步推荐内容</div>';
      return;
    }
    if (feedState.songs && feedState.songs.length) {
      status.textContent = feedState.message || feedConfig.readyText;
      list.innerHTML = '<section><h3>' + escHtml(feedConfig.sectionTitle) + '</h3><div class="home-platform-recommend-grid">' +
        feedState.songs.map(function (item, index) {
          return homePlatformRecommendationCard(source + '-song', index, item, feedConfig.cardLabel);
        }).join('') + '</div></section>';
      paintHomePlatformCovers(list);
      return;
    }
    status.textContent = feedState.error ? (homePlatformRecommendationSourceLabel(source) + '推荐读取失败') : (homePlatformRecommendationSourceLabel(source) + '暂无推荐');
    status.classList.toggle('is-error', !!feedState.error);
    list.innerHTML = homePlatformRecommendationEmptyHtml(source, feedState.message || feedState.error || '没有可展示的推荐内容。');
    return;
  }

  status.textContent = '未知平台';
  list.innerHTML = homePlatformRecommendationEmptyHtml(source, '不支持的推荐来源。');
}

async function loadHomePlatformNeteaseRecommendations(force) {
  homePlatformRecommendationState.neteaseLoading = true;
  renderHomePlatformRecommendations();
  try {
    if (typeof loadHomeDiscover === 'function') {
      await loadHomeDiscover(!!force);
    } else if (typeof renderHomeDiscover === 'function') {
      renderHomeDiscover(force ? { forceRefresh: true } : undefined);
    }
    // 播客推荐已从 /api/discover-home 下线，这里按需单独拉取热门播客供首页 Rail 展示
    if (typeof loginStatus !== 'undefined' && loginStatus && loginStatus.loggedIn && typeof apiJson === 'function') {
      apiJson('/api/podcast/hot?limit=4', { timeoutMs: 9000 }).then(function (data) {
        if (!homeDiscoverState) return;
        homeDiscoverState.podcasts = (data && (data.podcasts || data.djRadios)) || [];
        if (typeof renderHomeDiscover === 'function') renderHomeDiscover();
      }).catch(function () { });
    }
  } catch (error) {
    console.warn('[HomePlatformNetease]', error);
  } finally {
    homePlatformRecommendationState.neteaseLoading = false;
    renderHomePlatformRecommendations();
  }
}

async function loadHomePlatformFeedRecommendations(source, force) {
  var config = homePlatformRecommendationFeedConfig(source);
  var feedState = homePlatformRecommendationState.feeds[source];
  if (!config || !feedState || feedState.loading) return;
  if (feedState.loaded && !force) return;
  feedState.loading = true;
  feedState.error = '';
  feedState.message = '';
  renderHomePlatformRecommendations();
  try {
    var separator = config.endpoint.indexOf('?') >= 0 ? '&' : '?';
    var data = await apiJson(config.endpoint + separator + 't=' + Date.now(), { timeoutMs: 14000 });
    var rawSongs = data && (data.songs || data.tracks || data.items || data.recommendations);
    feedState.songs = (Array.isArray(rawSongs) ? rawSongs : []).map(function (song) {
      return typeof cloneSong === 'function' ? cloneSong(song) : song;
    });
    feedState.error = data && data.error ? String(data.error) : '';
    feedState.message = data && data.message ? String(data.message) : '';
    feedState.mode = data && data.mode ? String(data.mode) : '';
    feedState.source = data && data.source ? String(data.source) : '';
    feedState.fallback = !!(data && data.fallback);
    feedState.provenance = data && data.provenance ? String(data.provenance) : '';
    feedState.loaded = true;
  } catch (error) {
    console.warn('[HomePlatformFeed:' + source + ']', error);
    feedState.songs = [];
    feedState.error = String(error && error.message || 'PLATFORM_FEED_FAILED');
    feedState.message = '';
    feedState.loaded = true;
  } finally {
    feedState.loading = false;
    renderHomePlatformRecommendations();
  }
}

async function loadHomePlatformRecommendations(source, force) {
  homePlatformRecommendationState.source = source || 'netease';
  renderHomePlatformRecommendations();
  try {
    if (homePlatformRecommendationState.source === 'netease') {
      await loadHomePlatformNeteaseRecommendations(force);
    } else if (homePlatformRecommendationFeedConfig(homePlatformRecommendationState.source)) {
      await loadHomePlatformFeedRecommendations(homePlatformRecommendationState.source, force);
    } else {
      renderHomePlatformRecommendations();
    }
  } catch (error) {
    console.warn('[HomePlatformRecommendations]', error);
  }
  renderHomePlatformRecommendations();
}

function playHomePlatformFeedSong(source, index) {
  var config = homePlatformRecommendationFeedConfig(source);
  var feedState = homePlatformRecommendationState.feeds[source];
  var songs = feedState && feedState.songs || [];
  if (!config || !songs.length) return;
  playQueue = songs.map(function (song) { return typeof cloneSong === 'function' ? cloneSong(song) : song; });
  currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(index) || 0));
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('home-platform-' + source, { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('home-platform-' + source, true);
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  Promise.resolve(playQueueAt(currentIdx, {
    manual: true,
    context: { type: 'home-platform-recommendation', playlistName: config.playlistName },
  })).catch(function (error) { console.warn('[HomePlatformFeedPlay:' + source + ']', error); });
}

function closeHomePlatformRecommendations() {
  var panel = document.getElementById('home-platform-recommend');
  if (!panel) return;
  panel.classList.remove('show');
  panel.style.display = 'none';
  panel.setAttribute('aria-hidden', 'true');
  homePlatformRecommendationState.open = false;
  var focusTarget = homePlatformRecommendationState.previousFocus;
  homePlatformRecommendationState.previousFocus = null;
  if (focusTarget && typeof focusTarget.focus === 'function') {
    setTimeout(function () { focusTarget.focus(); }, 0);
  }
}

function bindHomePlatformRecommendationControls() {
  if (homePlatformRecommendationControlsBound) return;
  homePlatformRecommendationControlsBound = true;
  var panel = document.getElementById('home-platform-recommend');
  var tabs = document.getElementById('home-platform-recommend-tabs');
  var list = document.getElementById('home-platform-recommend-list');
  var close = document.getElementById('home-platform-recommend-close');
  var done = document.getElementById('home-platform-recommend-done');
  var refresh = document.getElementById('home-platform-recommend-refresh');
  if (tabs) tabs.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-home-recommend-source]');
    if (!tab || !tabs.contains(tab)) return;
    loadHomePlatformRecommendations(tab.getAttribute('data-home-recommend-source'), false);
  });
  if (list) list.addEventListener('click', function (event) {
    var card = event.target.closest('[data-home-recommend-kind]');
    if (!card || !list.contains(card)) return;
    var kind = card.getAttribute('data-home-recommend-kind');
    var index = Number(card.getAttribute('data-home-recommend-index')) || 0;
    closeHomePlatformRecommendations();
    if (kind === 'netease-playlist' && typeof openHomePlaylist === 'function') openHomePlaylist(index);
    else if (kind === 'netease-song' && typeof playHomeSong === 'function') playHomeSong(index);
    else if (kind === 'liked-affinity-song') playHomePlatformLikedAffinitySong(index);
    else if (/^(qishui|qq|spotify)-song$/.test(kind)) playHomePlatformFeedSong(kind.replace(/-song$/, ''), index);
  });
  if (list) list.addEventListener('scroll', scheduleHomePlatformDailyWindowRender, { passive: true });
  window.addEventListener('resize', scheduleHomePlatformDailyWindowRender, { passive: true });
  if (close) close.addEventListener('click', closeHomePlatformRecommendations);
  if (done) done.addEventListener('click', closeHomePlatformRecommendations);
  if (refresh) refresh.addEventListener('click', function () {
    loadHomePlatformRecommendations(homePlatformRecommendationState.source, true);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && homePlatformRecommendationState.open) closeHomePlatformRecommendations();
  });
  if (panel) panel.addEventListener('click', function (event) {
    if (event.target === panel) closeHomePlatformRecommendations();
  });
}

function openHomePlatformRecommendations(preferredSource) {
  bindHomePlatformRecommendationControls();
  var panel = document.getElementById('home-platform-recommend');
  if (!panel) return;
  homePlatformRecommendationState.previousFocus = document.activeElement;
  homePlatformRecommendationState.open = true;
  panel.style.display = '';
  panel.classList.add('show');
  panel.setAttribute('aria-hidden', 'false');
  var defaultSource = loginStatus && loginStatus.loggedIn
    ? 'netease'
    : (typeof qishuiLoginStatus !== 'undefined' && qishuiLoginStatus && (qishuiLoginStatus.loggedIn || qishuiLoginStatus.configured)
      ? 'qishui'
      : (typeof spotifyLoginStatus !== 'undefined' && spotifyLoginStatus && (spotifyLoginStatus.loggedIn || spotifyLoginStatus.configured)
        ? 'spotify'
        : 'netease'));
  var source = /^(netease|qishui|qq|kugou|spotify)$/.test(String(preferredSource || '')) ? preferredSource : defaultSource;
  loadHomePlatformRecommendations(source, false);
  setTimeout(function () {
    var activeTab = panel.querySelector('[data-home-recommend-source="' + source + '"]');
    if (activeTab) activeTab.focus();
  }, 0);
}

function openHomeDashboardCharts() {
  openHomePlatformRecommendations('netease');
}

function openHomeDashboardRadio() {
  openHomePlatformRecommendations();
}
