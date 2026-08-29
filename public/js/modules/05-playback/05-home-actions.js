// =============================================================================
// 首页动作：搜索 / 日推 / 曲库 / 空白关闭
// =============================================================================

function runHomeSearch(query, mode) {
  prepareLeaveHomeForPlayback();
  updateEmptyHomeVisibility();
  if (mode) setSearchMode(mode);
  else if (searchMode === 'podcast') setSearchMode('song');
  var q = String(query || '').trim();
  var area = document.getElementById('search-area');
  if (area) setPeek(area, true, 'search');
  if ($input) {
    $input.value = q;
    $input.focus();
  }
  if (q) doSearch(q);
  else if (searchMode === 'podcast') loadPodcastHot();
  else renderSearchHistory();
}
function skipLoginAndFocusSearch() {
  closeLoginModal();
  setTimeout(function(){ runHomeSearch(''); }, 180);
}
function openHomeLocalImport() {
  prepareLeaveHomeForPlayback();
  updateEmptyHomeVisibility();
  var input = document.getElementById('file-input');
  if (input) input.click();
}
function openHomeProductGuide() {
  closeLoginModal();
  setTimeout(function(){ startVisualGuide({ manual: true, source: 'home' }); }, 160);
}
async function waitForHomeDiscoverIdle(timeout) {
  var started = Date.now();
  while (homeDiscoverState.loading && Date.now() - started < (timeout || 2200)) {
    await new Promise(function(resolve){ setTimeout(resolve, 80); });
  }
}
async function playHomePrivateRadio() {
  prepareLeaveHomeForPlayback();
  if (!hasAnyPlatformLogin() && !homeDiscoverState.loggedIn) {
    showLoginModal({ source: 'home-private' });
    return;
  }
  await waitForHomeDiscoverIdle();
  if (!homeDiscoverState.loaded || ((!homeDiscoverState.playlists.length && !homeDiscoverState.songs.length) && !homeDiscoverState.loading)) {
    await loadHomeDiscover(true);
  }
  if (homeDiscoverState.songs.length) {
    playQueue = homeDiscoverState.songs.map(cloneSong);
    currentIdx = 0;
    safeRenderQueuePanel('home-private-radio');
    safeShelfRebuild('home-private-radio', true);
    forcePlaybackControlsInteractive();
    playQueueAt(0).catch(function(e){ console.warn('[HomePrivatePlay]', e); });
    return;
  }
  var item = homeDiscoverState.playlists[0];
  if (item && item.id) {
    await loadPlaylistIntoQueueById(homePlaylistQueueId(item), true, item.name || '私人雷达');
    return;
  }
  openHomeLibrary();
}
async function playHomeKugouGuessLike() {
  prepareLeaveHomeForPlayback();
  if (typeof showToast === 'function') showToast('正在生成猜你喜欢…');
  try {
    var data = await apiJson('/api/home/recommend', { timeoutMs: 25000 });
    var songs = (data && data.songs) || [];
    if (!songs.length) {
      var msg = (data && data.error === 'NO_PLATFORM_LOGIN')
        ? '登录网易云 / 汽水 / 酷狗后可获取推荐'
        : '猜你喜欢暂无内容，已切换到私人电台';
      if (typeof showToast === 'function') showToast(msg);
      if (data && data.error !== 'NO_PLATFORM_LOGIN') playHomePrivateRadio();
      return;
    }
    playQueue = songs.map(cloneSong);
    currentIdx = 0;
    safeRenderQueuePanel('home-recommend');
    safeShelfRebuild('home-recommend', true);
    forcePlaybackControlsInteractive();
    var srcLabel = (data && data.source === 'netease-daily') ? '网易云日推'
      : (data && data.source === 'qishui-feed') ? '汽水 feed'
      : (data && data.source === 'kugou-playlist-fallback') ? '酷狗歌单'
      : '推荐';
    if (typeof showToast === 'function') showToast('为你推荐 ' + playQueue.length + ' 首歌（' + srcLabel + '）');
    playQueueAt(0).catch(function(e){ console.warn('[HomeRecommendPlay]', e); });
  } catch (e) {
    console.warn('[HomeRecommend]', e);
    if (typeof showToast === 'function') showToast('猜你喜欢加载失败，已切换到私人电台');
    playHomePrivateRadio();
  }
}
function openHomePlaylist(index) {
  prepareLeaveHomeForPlayback();
  if (!hasAnyPlatformLogin() && !homeDiscoverState.loggedIn) {
    runHomeSearch('');
    return;
  }
  openPlaylistPanelTab('playlists', true);
  var item = homeDiscoverState.playlists[index];
  if (!item || !item.id) {
    openHomeLibrary();
    return;
  }
  loadPlaylistIntoQueueById(homePlaylistQueueId(item), true, item.name || '');
}
function openHomePodcast(index) {
  prepareLeaveHomeForPlayback();
  openPlaylistPanelTab('podcasts', true);
  var item = homeDiscoverState.podcasts[index];
  if (!item || !item.id) {
    setSearchMode('podcast');
    loadPodcastHot();
    return;
  }
  loadPodcastRadioIntoQueue(item.id, true, item.name || '');
}
function openHomeThirdCard() {
  if (!hasAnyPlatformLogin() && !homeDiscoverState.loggedIn) {
    openHomeLocalImport();
    return;
  }
  openHomePodcast(0);
}
function openHomeLibrary() {
  if (!hasAnyPlatformLogin() && !homeDiscoverState.loggedIn) {
    openHomeProductGuide();
    return;
  }
  homeSuppressed = false;
  setHomeControlsLocked(false);
  openPlaylistPanelTab('playlists', true);
  refreshUserPlaylists(true);
}
function goHome() {
  // 音域回响激活时，先退出预设再回 Home
  if (document.body.classList.contains('sonic-topography-active')) {
    try { setPreset(0, { silent: true, skipTransition: true }); } catch (_) {}
    document.body.classList.remove('sonic-topography-active');
  }
  if (homeForcedOpen || emptyHomeActive) {
    dismissHomePage({ toast: true });
    showToast('已关闭 Home');
    return;
  }
  showHome({ forceLoad: true, forced: true, closePanels: true });
  showToast('已回到 Home');
}
function dismissHomePage(opts) {
  hideHome({ suppress: true });
  setPeek(document.getElementById('search-area'), false, 'search');
  if (typeof setFocusZone === 'function') setFocusZone(null, true);
}
function isPointInsideRectWithPad(x, y, rect, pad) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  pad = Number(pad) || 0;
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}
function isPointNearHomeContent(x, y) {
  var selectors = [
    '.home-card',
    '.home-tile',
    '.home-chip'
  ];
  for (var i = 0; i < selectors.length; i++) {
    var nodes = document.querySelectorAll(selectors[i]);
    for (var j = 0; j < nodes.length; j++) {
      if (isPointInsideRectWithPad(x, y, nodes[j].getBoundingClientRect(), 12)) return true;
    }
  }
  return false;
}
function isHomeBlankDismissClick(e) {
  // 禁用空白点击关闭 Home：必须点击 Home 按钮才可切换
  return false;
  if (!emptyHomeActive || !e || e.defaultPrevented) return false; /* eslint-disable no-unreachable */
  if (e.button != null && e.button !== 0) return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  var target = e.target;
  if (!target || !target.closest) return false;
  var blockedSelector = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '#desktop-titlebar',
    '#search-area',
    '#top-right',
    '#bottom-bar',
    '#bottom-handle',
    '#fx-fab',
    '#fx-fab-hide-btn',
    '#fx-panel',
    '#playlist-panel',
    '#mini-queue-popover',
    '#visual-guide',
    '#upload-tip',
    '#toast',
    '#trial-banner',
    '#source-fallback-notice',
    '.modal-mask',
    '.modal',
    '.track-detail-modal',
    '.cover-color-pop',
    '.color-lab-pop'
  ].join(',');
  if (target.closest(blockedSelector)) return false;
  var x = e.clientX;
  var y = e.clientY;
  var home = document.getElementById('empty-home');
  if (!home) return false;
  var homeRect = home.getBoundingClientRect();
  if (!isPointInsideRectWithPad(x, y, homeRect, 0)) return false;
  if (isPointNearHomeContent(x, y)) return false;
  return true;
}
document.addEventListener('click', function(e) {
  if (!isHomeBlankDismissClick(e)) return;
  e.preventDefault();
  e.stopPropagation();
  dismissHomePage({ reason: 'blank-click' });
}, true);
