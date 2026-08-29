// =============================================================================
// 歌单详情 / 用户歌单列表 / 收藏取消
// =============================================================================

async function refreshUserPlaylists(force) {
  if (!loginStatus.loggedIn && !qqLoginStatus.loggedIn && !kugouLoginStatus.loggedIn && !qishuiLoginStatus.loggedIn && !spotifyLoginStatus.loggedIn) {
    resetPlaylistPanelRenderLimit();
    var podcastListLoggedOut = document.getElementById('podcast-list');
    if (podcastListLoggedOut) podcastListLoggedOut.innerHTML = '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.28);font-size:11.5px">登录后显示我的播客</div>';
    // 未登录也展示本地歌单（AI 歌单保存 / 后续本地收藏的落点）
    if (typeof listLocalPlaylists === 'function' && listLocalPlaylists().length) {
      renderUserPlaylistsList({ reset: true });
      return;
    }
    document.getElementById('pl-list').innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">登录后显示个人歌单</div>';
    return;
  }
  if (force) resetPlaylistPanelRenderLimit();
  var hasCachedQQPlaylists = userPlaylists.some(function(pl){ return pl && pl.provider === 'qq'; });
  var hasCachedKugouPlaylists = userPlaylists.some(function(pl){ return pl && pl.provider === 'kugou'; });
  var hasCachedQishuiPlaylists = userPlaylists.some(function(pl){ return pl && pl.provider === 'qishui'; });
  var hasCachedSpotifyPlaylists = userPlaylists.some(function(pl){ return pl && pl.provider === 'spotify'; });
  var needsQQRefresh = qqLoginStatus.loggedIn && !hasCachedQQPlaylists;
  var needsKugouRefresh = kugouLoginStatus.loggedIn && !hasCachedKugouPlaylists;
  var needsQishuiRefresh = qishuiLoginStatus.loggedIn && !hasCachedQishuiPlaylists;
  var needsSpotifyRefresh = spotifyLoginStatus.loggedIn && !hasCachedSpotifyPlaylists;
  if (!force && !needsQQRefresh && !needsKugouRefresh && !needsQishuiRefresh && !needsSpotifyRefresh && (userPlaylists.length || myPodcastCollections.length)) {
    var cachedAnimate = isPlaylistPanelVisibleForRender();
    renderUserPlaylistsList({ animate: cachedAnimate });
    renderMyPodcastCollections({ animate: cachedAnimate });
    return;
  }
  var $pl = document.getElementById('pl-list');
  if ($pl) {
    $pl.innerHTML = miniQueueSkeleton();
    if (window.gsap) animateListItems($pl, '.mini-queue-skeleton', { x: 0, y: 6, stagger: 0.018, duration: 0.18, limit: 3 });
  }
  var $pod = document.getElementById('podcast-list');
  if ($pod) $pod.innerHTML = miniQueueSkeleton();
  try {
    var result = await Promise.all([
      loginStatus.loggedIn ? apiJson('/api/user/playlists') : Promise.resolve({ playlists: [] }),
      loginStatus.loggedIn ? apiJson('/api/podcast/my') : Promise.resolve({ collections: [], loggedIn: false }),
      qqLoginStatus.loggedIn ? apiJson('/api/qq/user/playlists') : Promise.resolve({ playlists: [] }),
      kugouLoginStatus.loggedIn ? apiJson('/api/kugou/user/playlists') : Promise.resolve({ playlists: [] }),
      qishuiLoginStatus.loggedIn ? apiJson('/api/qishui/user/playlists') : Promise.resolve({ playlists: [] }),
      spotifyLoginStatus.loggedIn ? apiJson('/api/spotify/user/playlists') : Promise.resolve({ playlists: [] })
    ]);
    var neteaseLists = (result[0].playlists || []).map(function(pl){ pl.provider = 'netease'; pl.source = 'netease'; return pl; });
    qqPlaylists = (result[2].playlists || []).map(function(pl){ pl.provider = 'qq'; pl.source = 'qq'; return pl; });
    kugouPlaylists = (result[3].playlists || []).map(function(pl){ pl.provider = 'kugou'; pl.source = 'kugou'; return pl; });
    qishuiPlaylists = (result[4].playlists || []).map(function(pl){ pl.provider = 'qishui'; pl.source = 'qishui'; return pl; });
    spotifyPlaylists = (result[5].playlists || []).map(function(pl){ pl.provider = 'spotify'; pl.source = 'spotify'; return pl; });
    userPlaylists = neteaseLists.concat(qqPlaylists, kugouPlaylists, qishuiPlaylists, spotifyPlaylists);
    myPodcastCollections = result[1].collections || [];
    var animatePanel = isPlaylistPanelVisibleForRender();
    renderUserPlaylistsList({ animate: animatePanel, reset: true });
    renderMyPodcastCollections({ animate: animatePanel });
    if (emptyHomeActive) renderHomeDiscover();
    scheduleShelfRebuild('refresh-user-playlists', true);
  } catch (e) { console.warn(e); }
}
var playlistPanelDetailState = { key: '', loading: false, playlist: null, tracks: [], token: 0, renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER, scrollTop: 0 };
function playlistPanelKey(provider, id) {
  return normalizePlaylistProvider(provider) + ':' + String(id || '');
}
function playlistPanelProviderId(provider, id) {
  provider = normalizePlaylistProvider(provider);
  if (provider === 'qq') return 'qq:' + id;
  if (provider === 'kugou') return 'kugou:' + id;
  if (provider === 'qishui') return 'qishui:' + id;
  if (provider === 'spotify') return 'spotify:' + id;
  return id;
}
function playlistPanelDetailWindowOptions() {
  var panel = document.getElementById('playlist-panel');
  var viewport = Math.max(280, Number(panel && panel.clientHeight) || Math.min(620, Math.round((window.innerHeight || 800) * 0.72)));
  var scrollTop = Math.max(0, Number(playlistPanelDetailState.scrollTop) || 0);
  if (panel) {
    var detail = panel.querySelector('.pl-inline-detail[data-pl-detail]');
    var list = detail && detail.querySelector('.pl-detail-list');
    if (list && list.getBoundingClientRect && panel.getBoundingClientRect) {
      var panelRect = panel.getBoundingClientRect();
      var listRect = list.getBoundingClientRect();
      scrollTop = Math.max(0, panelRect.top - listRect.top);
    } else if (detail) {
      scrollTop = Math.max(0, (Number(panel.scrollTop) || 0) - (Number(detail.offsetTop) || 0) - PLAYLIST_DETAIL_OUTER_CHROME_HEIGHT);
    }
  }
  playlistPanelDetailState.scrollTop = scrollTop;
  return { scrollTop: scrollTop, viewport: viewport };
}
function playlistPanelDetailRowsHtml(options) {
  options = options || {};
  var st = playlistPanelDetailState;
  var tracks = st.tracks || [];
  if (st.loading && !tracks.length) {
    return '<div class="pl-detail-row pl-detail-loading-row"><div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06)"></div><div style="flex:1;min-width:0"><div class="pl-detail-row-title">正在载入歌单</div><div class="pl-detail-row-artist">请稍候</div></div></div>';
  }
  var renderLimit = Math.max(PLAYLIST_DETAIL_INITIAL_RENDER, st.renderLimit || PLAYLIST_DETAIL_INITIAL_RENDER);
  renderLimit = Math.min(tracks.length, renderLimit);
  var visibleTracks = tracks.slice(0, renderLimit);
  if (!visibleTracks.length) {
    return '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.30);font-size:11.5px">歌单暂无可播放歌曲</div>';
  }
  var viewport = Math.max(280, Number(options.viewport) || Math.min(620, Math.round((window.innerHeight || 800) * 0.72)));
  var localScrollTop = Math.max(0, Number(options.scrollTop) || 0);
  var start = Math.max(0, Math.floor(localScrollTop / PLAYLIST_DETAIL_ROW_STEP) - PLAYLIST_DETAIL_VIRTUAL_OVERSCAN);
  var maxRows = Math.ceil(viewport / PLAYLIST_DETAIL_ROW_STEP) + PLAYLIST_DETAIL_VIRTUAL_OVERSCAN * 2;
  var end = Math.min(visibleTracks.length, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, visibleTracks.length - maxRows)));
  end = Math.min(visibleTracks.length, Math.max(end, start + maxRows));
  var rows = '<div class="pl-detail-virtual-spacer" aria-hidden="true" style="height:' + (start * PLAYLIST_DETAIL_ROW_STEP) + 'px"></div>';
  rows += visibleTracks.slice(start, end).map(function (song, localIndex) {
    var i = start + localIndex;
    var thumb = songCoverSrc(song, 60);
    var imgTag = thumb ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="this.style.opacity=0.2"') : '<div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06);flex:0 0 auto"></div>';
    return '<div class="pl-detail-row" data-pl-detail-row="' + i + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-detail-row-title">' + escHtml(song.name || '') + '</div>' +
      '<button type="button" class="pl-detail-row-artist" data-pl-detail-artist="' + i + '">' + escHtml(song.artist || '未知歌手') + '</button></div>' +
      '</div>';
  }).join('');
  rows += '<div class="pl-detail-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, visibleTracks.length - end) * PLAYLIST_DETAIL_ROW_STEP) + 'px"></div>';
  if (tracks.length > renderLimit) {
    rows += '<button type="button" class="fx-mini-btn ghost pl-detail-load-more" data-pl-detail-load-more="1">加载更多 ' + renderLimit + '/' + tracks.length + '</button>';
  } else if (tracks.length > PLAYLIST_DETAIL_INITIAL_RENDER) {
    rows += '<div class="pl-detail-progress">已显示全部 ' + tracks.length + ' 首</div>';
  }
  return rows;
}
function playlistPanelDetailHtml(pl, provider, detailWindow) {
  var key = playlistPanelKey(provider, pl && pl.id);
  if (playlistPanelDetailState.key !== key) return '';
  var tracks = playlistPanelDetailState.tracks || [];
  var loading = playlistPanelDetailState.loading;
  provider = normalizePlaylistProvider(provider);
  var cover = pl && pl.cover ? (provider === 'netease' ? (pl.cover + '?param=96y96') : pl.cover) : '';
  var img = cover ? '<img class="pl-detail-cover" src="' + escAttr(cover) + '" alt="" decoding="async" onerror="this.style.opacity=0.2">' : '<div class="pl-detail-cover"></div>';
  var renderLimit = loading ? 0 : Math.max(PLAYLIST_DETAIL_INITIAL_RENDER, playlistPanelDetailState.renderLimit || PLAYLIST_DETAIL_INITIAL_RENDER);
  renderLimit = Math.min(tracks.length, renderLimit);
  var creatorFallback = provider === 'qq' ? 'QQ Music' : (provider === 'kugou' ? 'Kugou' : (provider === 'qishui' ? '汽水音乐' : (provider === 'spotify' ? 'Spotify' : 'Netease')));
  var rows = playlistPanelDetailRowsHtml(detailWindow || playlistPanelDetailWindowOptions());
  var canUncollect = !!(pl && pl.subscribed && !pl.virtual && (provider === 'netease' || provider === 'qishui' || provider === 'spotify'));
  var collectionButton = canUncollect
    ? '<button class="fx-mini-btn ghost pl-detail-collection-btn" type="button" data-pl-detail-collection="0">取消收藏</button>'
    : '';
  var localDeleteButton = provider === 'local'
    ? '<button class="fx-mini-btn ghost" type="button" data-pl-detail-delete="' + escAttr(key) + '">删除歌单</button>'
    : '';
  return '<div class="pl-inline-detail" data-pl-detail="' + escAttr(key) + '">' +
    '<div class="pl-detail-sticky">' +
      '<div class="pl-detail-head">' + img + '<div style="flex:1;min-width:0"><div class="pl-detail-title">' + escHtml(pl.name || '歌单详情') + '</div><div class="pl-detail-sub">' + escHtml((pl.trackCount || tracks.length || 0) + ' 首 · ' + (pl.creator || creatorFallback)) + '</div></div><div class="pl-detail-count">' + (loading ? '载入中' : (renderLimit + '/' + tracks.length)) + '</div></div>' +
      '<div class="pl-detail-actions"><button class="pl-detail-play" type="button" data-pl-detail-play="' + escAttr(key) + '"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>播放歌单</button>' + collectionButton + localDeleteButton + '<button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-pl-detail-top="1">回到顶部</button></div>' +
    '</div>' +
    '<div class="pl-detail-list" data-pl-detail-scroll="' + escAttr(key) + '">' + rows + '</div>' +
  '</div>';
}
function renderPlaylistPanelDetailRows() {
  if (!playlistPanelDetailState.key) return;
  var list = document.querySelector('.pl-inline-detail[data-pl-detail] .pl-detail-list');
  if (!list) {
    renderUserPlaylistsList({ animate: false, preserveScroll: true });
    return;
  }
  list.innerHTML = playlistPanelDetailRowsHtml(playlistPanelDetailWindowOptions());
}
function schedulePlaylistPanelDetailVirtualRender() {
  if (playlistPanelDetailVirtualState.raf) return;
  playlistPanelDetailVirtualState.raf = requestAnimationFrame(function () {
    playlistPanelDetailVirtualState.raf = 0;
    if (queueViewTab !== 'playlists' || !playlistPanelDetailState.key) return;
    renderPlaylistPanelDetailRows();
  });
}
function renderPlaylistPanelDetailState() {
  renderUserPlaylistsList();
}
function scrollPlaylistPanelToTop() {
  var panel = document.getElementById('playlist-panel');
  if (!panel) return;
  try { panel.scrollTo({ top: 0, behavior: 'smooth' }); }
  catch (e) { panel.scrollTop = 0; }
}
function scrollPlaylistPanelDetailIntoView(key) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || !key) return;
  requestAnimationFrame(function(){
    var detail = null;
    Array.prototype.some.call(panel.querySelectorAll('[data-pl-detail]'), function(node){
      if (node.getAttribute('data-pl-detail') === key) {
        detail = node;
        return true;
      }
      return false;
    });
    if (!detail) return;
    var anchor = detail.previousElementSibling || detail;
    var top = Math.max(0, anchor.offsetTop - 10);
    try { panel.scrollTo({ top: top, behavior: 'smooth' }); }
    catch (e) { panel.scrollTop = top; }
  });
}
async function openPlaylistPanelDetail(provider, pid, title) {
  if (!pid) return;
  provider = normalizePlaylistProvider(provider);
  var key = playlistPanelKey(provider, pid);
  var pl = userPlaylists.find(function(item){ return playlistPanelKey(normalizePlaylistProvider(item.provider), item.id) === key; }) || { id: pid, provider: provider, name: title || 'Playlist Detail' };
  if (playlistPanelDetailState.key === key && !playlistPanelDetailState.loading && playlistPanelDetailState.tracks.length) {
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
    playlistPanelDetailState.renderLimit = PLAYLIST_DETAIL_INITIAL_RENDER;
    renderPlaylistPanelDetailState();
    return;
  }
  // 本地歌单：曲目就在存储里，直接展开，不走平台详情接口
  if (provider === 'local') {
    var localPl = (typeof getLocalPlaylistById === 'function') ? getLocalPlaylistById(pid) : null;
    if (!localPl) { showToast('本地歌单不存在或已被删除'); return; }
    var localToken = ++playlistPanelDetailState.token;
    playlistPanelDetailState = {
      key: key,
      loading: false,
      playlist: { provider: 'local', id: localPl.id, name: localPl.name, cover: localPl.cover, trackCount: localPl.songs.length, creator: '本地歌单' },
      tracks: localPl.songs.map(cloneSong),
      token: localToken,
      renderLimit: Math.min(localPl.songs.length, PLAYLIST_DETAIL_INITIAL_RENDER),
      scrollTop: 0,
    };
    renderPlaylistPanelDetailState();
    scrollPlaylistPanelDetailIntoView(key);
    return;
  }
  var token = ++playlistPanelDetailState.token;
  playlistPanelDetailState = { key: key, loading: true, playlist: pl, tracks: [], token: token, renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER, scrollTop: 0 };
  renderPlaylistPanelDetailState();
  scrollPlaylistPanelDetailIntoView(key);
  try {
    var r = await apiJson(playlistTracksEndpoint(provider, pid));
    if (playlistPanelDetailState.token !== token) return;
    playlistPanelDetailState.loading = false;
    playlistPanelDetailState.tracks = (r && r.tracks || []).map(cloneSong);
    playlistPanelDetailState.renderLimit = Math.min(playlistPanelDetailState.tracks.length, PLAYLIST_DETAIL_INITIAL_RENDER);
    renderPlaylistPanelDetailState();
  } catch (e) {
    console.warn('[PlaylistPanelDetail]', pid, e);
    if (playlistPanelDetailState.token !== token) return;
    playlistPanelDetailState.loading = false;
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.renderLimit = PLAYLIST_DETAIL_INITIAL_RENDER;
    renderPlaylistPanelDetailState();
    showToast('歌单详情加载失败');
  }
}
function playPlaylistPanelDetail() {
  var st = playlistPanelDetailState;
  if (!st || !st.key) return;
  var parts = st.key.split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  if (provider === 'local') {
    var tracks = (st.tracks || []).map(cloneSong);
    if (!tracks.length) { showToast('歌单暂无可播放歌曲'); return; }
    playQueue = tracks;
    currentIdx = 0;
    safeRenderQueuePanel('local-playlist-play');
    safeSwitchPlaylistTab('queue', 'local-playlist-play');
    safeShelfRebuild('local-playlist-play', true);
    forcePlaybackControlsInteractive();
    playQueueAt(0).catch(function(e){ console.warn('[LocalPlaylistPlay]', e); });
    return;
  }
  var pid = parts.slice(1).join(':');
  loadPlaylistIntoQueueById(playlistPanelProviderId(provider, pid), true, st.playlist && st.playlist.name || '');
}
async function togglePlaylistPanelCollection(collected) {
  var state = playlistPanelDetailState;
  if (!state || !state.key || !state.playlist) return;
  var parts = state.key.split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  var id = parts.slice(1).join(':');
  if (typeof collectPlaylistEndpoint === 'function' && !collectPlaylistEndpoint(provider)) {
    showToast((typeof playlistProviderLabel === 'function' ? playlistProviderLabel(provider) : provider) + ' 暂不支持写回歌单收藏');
    return;
  }
  try {
    var result = typeof collectPlaylistRequest === 'function'
      ? await collectPlaylistRequest(provider, id, collected, { spotifyUri: state.playlist.spotifyUri || '' })
      : null;
    if (!result || result.error || result.success === false) throw new Error(result && (result.message || result.error) || 'PLAYLIST_COLLECTION_FAILED');
    showToast(collected ? '歌单已收藏' : '已取消收藏歌单');
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
    await refreshUserPlaylists(true);
    renderPlaylistPanelDetailState();
  } catch (err) {
    showToast(/SCOPE|PERMISSION|LOGIN|UNSUPPORTED/i.test(String(err && err.message || ''))
      ? '请重新登录后再修改歌单收藏'
      : '歌单收藏操作失败');
  }
}
function playPlaylistPanelDetailTrack(index) {
  var tracks = playlistPanelDetailState.tracks || [];
  if (!tracks[index]) return;
  playQueue = tracks.map(cloneSong);
  currentIdx = index;
  safeRenderQueuePanel('playlist-panel-detail');
  safeSwitchPlaylistTab('queue', 'playlist-panel-detail');
  safeShelfRebuild('playlist-panel-detail', true);
  forcePlaybackControlsInteractive();
  playQueueAt(index).catch(function(e){ console.warn('[PlaylistPanelDetailPlay]', e); });
}
function openPlaylistPanelDetailArtist(index) {
  var song = playlistPanelDetailState.tracks && playlistPanelDetailState.tracks[index];
  if (song) openArtistDetailForSong(song);
}
function growPlaylistPanelDetailRenderLimit(amount) {
  var st = playlistPanelDetailState;
  var total = st && st.tracks ? st.tracks.length : 0;
  if (!st || st.loading || !st.key || !total) return false;
  var current = Math.max(PLAYLIST_DETAIL_INITIAL_RENDER, st.renderLimit || PLAYLIST_DETAIL_INITIAL_RENDER);
  var next = Math.min(total, current + (amount || PLAYLIST_DETAIL_BATCH_SIZE));
  if (next <= current) return false;
  var panel = document.getElementById('playlist-panel');
  var keepTop = panel ? panel.scrollTop : 0;
  st.renderLimit = next;
  renderPlaylistPanelDetailState();
  if (panel) panel.scrollTop = keepTop;
  return true;
}
function maybeGrowPlaylistPanelDetailRenderLimit() {
  var panel = document.getElementById('playlist-panel');
  var st = playlistPanelDetailState;
  if (!panel || !st || st.loading || !st.key || !st.tracks || st.renderLimit >= st.tracks.length) return;
  if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 240) {
    growPlaylistPanelDetailRenderLimit();
  }
}
function resetPlaylistPanelRenderLimit() {
  playlistPanelRenderLimit = PLAYLIST_PANEL_BATCH_SIZE;
}
function growPlaylistPanelRenderLimit() {
  if (!userPlaylists.length) return;
  var next = Math.min(userPlaylists.length, (playlistPanelRenderLimit || PLAYLIST_PANEL_BATCH_SIZE) + PLAYLIST_PANEL_BATCH_SIZE);
  if (next <= playlistPanelRenderLimit) return;
  playlistPanelRenderLimit = next;
  renderUserPlaylistsList({ animate: true });
}
function bindPlaylistPanelLazyRender() {
  var panel = document.getElementById('playlist-panel');
  if (!panel || playlistPanelLazyBound) return;
  playlistPanelLazyBound = true;
  panel.addEventListener('scroll', throttle(function(){
    if (queueViewTab === 'playlists' && playlistPanelDetailState.key) {
      schedulePlaylistPanelDetailVirtualRender();
    }
    maybeGrowPlaylistPanelDetailRenderLimit();
    if (queueViewTab !== 'playlists' || playlistPanelRenderLimit >= userPlaylists.length) return;
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 180) growPlaylistPanelRenderLimit();
  }, 16), { passive: true });
}
function renderUserPlaylistsList(opts) {
  opts = opts || {};
  var $pl = document.getElementById('pl-list');
  var seq = ++playlistRenderSeq;
  var localItems = (typeof localPlaylistPanelItems === 'function') ? localPlaylistPanelItems() : [];
  if (!userPlaylists.length && !localItems.length) {
    $pl.innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">未找到歌单</div>';
    return;
  }
  var panel = document.getElementById('playlist-panel');
  var keepTop = panel ? panel.scrollTop : 0;
  var detailWindow = playlistPanelDetailWindowOptions();
  function playlistCardHtml(pl) {
    var provider = normalizePlaylistProvider(pl.provider);
    var providerLabel = playlistProviderLabel(provider);
    var thumb = pl.cover ? (provider === 'netease' ? (pl.cover + '?param=88y88') : pl.cover) : '';
    var imgTag = thumb ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="this.style.opacity=0.2"') : '<div style="width:44px;height:44px;border-radius:8px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
    var key = playlistPanelKey(provider, pl.id);
    var expanded = playlistPanelDetailState.key === key ? ' expanded' : '';
    return '<div class="pl-card' + expanded + '" data-playlist-provider="' + provider + '" data-playlist-id="' + escAttr(String(pl.id || '')) + '" data-playlist-title="' + escAttr(pl.name || '') + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-name">' + escHtml(pl.name) + '<span class="tag-source ' + provider + '" style="margin-left:6px;vertical-align:1px">' + providerLabel + '</span></div><div class="pl-sub">' + pl.trackCount + ' 首 · ' + escHtml(pl.creator || '') + '</div></div>' +
    '</div>' + playlistPanelDetailHtml(pl, provider, detailWindow);
  }
  var groups = [
    { key:'local', label:'本地歌单', items:localItems },
    { key:'netease', label:'Netease Playlists', items:userPlaylists.filter(function(pl){ return pl.provider !== 'qq' && pl.provider !== 'kugou' && pl.provider !== 'qishui' && pl.provider !== 'spotify'; }) },
    { key:'qq', label:'QQ Music Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'qq'; }) },
    { key:'kugou', label:'Kugou Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'kugou'; }) },
    { key:'qishui', label:'Qishui Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'qishui'; }) },
    { key:'spotify', label:'Spotify Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'spotify'; }) }
  ];
  if (opts.reset) resetPlaylistPanelRenderLimit();
  playlistPanelRenderLimit = Math.max(PLAYLIST_PANEL_BATCH_SIZE, Math.min(userPlaylists.length, playlistPanelRenderLimit || PLAYLIST_PANEL_BATCH_SIZE));
  var renderedCount = 0;
  function visibleGroupItems(items) {
    var room = playlistPanelRenderLimit - renderedCount;
    if (room <= 0) return [];
    var visible = items.slice(0, room);
    renderedCount += visible.length;
    return visible;
  }
  $pl.innerHTML = groups.map(function(group){
    var items = visibleGroupItems(group.items);
    if (!items.length) return '';
    return '<div class="pl-section-label">' + group.label + '</div>' + items.map(playlistCardHtml).join('');
  }).join('') || '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">未找到歌单</div>';
  if (userPlaylists.length > renderedCount) {
    $pl.insertAdjacentHTML('beforeend', '<button type="button" class="fx-mini-btn ghost pl-load-more" data-pl-load-more="1">加载更多 ' + renderedCount + '/' + userPlaylists.length + '</button>');
  }
  if (panel && opts.preserveScroll) panel.scrollTop = keepTop;
  if (opts.animate && seq === playlistRenderSeq) animateVisiblePanelList($pl, '.pl-card', document.getElementById('playlist-panel'));
}
function renderMyPodcastCollections(opts) {
  opts = opts || {};
  var $pod = document.getElementById('podcast-list');
  if (!$pod) return;
  if (!loginStatus.loggedIn) {
    $pod.innerHTML = '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.28);font-size:11.5px">登录后显示我的播客</div>';
    return;
  }
  var items = myPodcastCollections || [];
  if (!items.length) {
    $pod.innerHTML = '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.28);font-size:11.5px">暂无播客数据</div>';
    return;
  }
  $pod.innerHTML = items.map(function(pc){
    var thumb = pc.cover ? coverUrlWithSize(pc.cover, 88) : '';
    var imgTag = thumb ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="this.style.opacity=0.2"') : '<div style="width:44px;height:44px;border-radius:8px;background:rgba(0,245,212,.07);flex-shrink:0"></div>';
    return '<div class="pl-card podcast-card" data-podcast-key="' + escAttr(pc.key || '') + '" data-podcast-title="' + escAttr(pc.title || '') + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-name">' + escHtml(pc.title || '') + '</div><div class="pl-sub">' + (pc.count || 0) + ' 项 · ' + escHtml(pc.sub || '') + '</div></div>' +
    '</div>';
  }).join('');
  if (opts.animate) animateVisiblePanelList($pod, '.pl-card', document.getElementById('playlist-panel'));
}
document.getElementById('pl-list').addEventListener('click', function(e){
  var loadMore = e.target && e.target.closest ? e.target.closest('[data-pl-load-more]') : null;
  if (loadMore) {
    e.preventDefault();
    e.stopPropagation();
    growPlaylistPanelRenderLimit();
    return;
  }
  var detailLoadMore = e.target && e.target.closest ? e.target.closest('[data-pl-detail-load-more]') : null;
  if (detailLoadMore) {
    e.preventDefault();
    e.stopPropagation();
    growPlaylistPanelDetailRenderLimit();
    return;
  }
  var detailTop = e.target && e.target.closest ? e.target.closest('[data-pl-detail-top]') : null;
  if (detailTop) {
    e.preventDefault();
    e.stopPropagation();
    scrollPlaylistPanelToTop();
    return;
  }
  var playDetail = e.target && e.target.closest ? e.target.closest('[data-pl-detail-play]') : null;
  if (playDetail) {
    e.preventDefault();
    e.stopPropagation();
    playPlaylistPanelDetail();
    return;
  }
  var collectionBtn = e.target && e.target.closest ? e.target.closest('[data-pl-detail-collection]') : null;
  if (collectionBtn) {
    e.preventDefault();
    e.stopPropagation();
    togglePlaylistPanelCollection(collectionBtn.getAttribute('data-pl-detail-collection') === '1');
    return;
  }
  var artist = e.target && e.target.closest ? e.target.closest('[data-pl-detail-artist]') : null;
  if (artist) {
    e.preventDefault();
    e.stopPropagation();
    openPlaylistPanelDetailArtist(Number(artist.getAttribute('data-pl-detail-artist')));
    return;
  }
  var row = e.target && e.target.closest ? e.target.closest('[data-pl-detail-row]') : null;
  if (row) {
    e.preventDefault();
    e.stopPropagation();
    playPlaylistPanelDetailTrack(Number(row.getAttribute('data-pl-detail-row')));
    return;
  }
  var deleteLocalBtn = e.target && e.target.closest ? e.target.closest('[data-pl-detail-delete]') : null;
  if (deleteLocalBtn) {
    e.preventDefault();
    e.stopPropagation();
    handleLocalPlaylistDetailDelete(
      String(deleteLocalBtn.getAttribute('data-pl-detail-delete') || '').replace(/^local:/, ''),
      deleteLocalBtn
    );
    return;
  }
  var card = e.target && e.target.closest ? e.target.closest('.pl-card') : null;
  if (!card) return;
  var provider = card.getAttribute('data-playlist-provider') || 'netease';
  var pid = card.getAttribute('data-playlist-id') || '';
  openPlaylistPanelDetail(provider, pid, card.getAttribute('data-playlist-title') || '');
});
var podcastListEl = document.getElementById('podcast-list');
if (podcastListEl) {
  podcastListEl.addEventListener('click', function(e){
    if (e.target && e.target.closest && e.target.closest('[data-podcast-back]')) {
      renderMyPodcastCollections({ animate: true });
      return;
    }
    var radioCard = e.target && e.target.closest ? e.target.closest('[data-podcast-radio-id]') : null;
    if (radioCard) {
      loadPodcastRadioIntoQueue(radioCard.getAttribute('data-podcast-radio-id'), true, radioCard.getAttribute('data-podcast-title') || '');
      return;
    }
    var card = e.target && e.target.closest ? e.target.closest('[data-podcast-key]') : null;
    if (!card) return;
    openMyPodcastCollection(card.getAttribute('data-podcast-key'), card.getAttribute('data-podcast-title') || '');
  });
}
