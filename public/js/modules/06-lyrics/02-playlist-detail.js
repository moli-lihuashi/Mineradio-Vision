// =============================================================================
// 歌单详情 / 用户歌单列表 / 收藏取消
// =============================================================================

// 封面加载失败的兜底函数是 mineradioCoverFallback（定义在 01-api/00-mineradio-api.js，
// 由 05-playback/00a-api-quality.js 提升成全局），全站 <img> 共用。

// ---- 「我的歌单」面板左上角那个 chip：按真实登录态显示有哪些音源 ----
// 以前是一句写死的「登录后显示网易云 / QQ / 酷狗歌单」，与实际登录的账号无关。
var PLAYLIST_SOURCE_CHIP_ORDER = ['netease', 'qq', 'kugou', 'qishui', 'spotify'];
var PLAYLIST_SOURCE_CHIP_SHORT = { netease: '网易云', qq: 'QQ', kugou: '酷狗', qishui: '汽水', spotify: 'Spotify' };
var PLAYLIST_SOURCE_CHIP_LOGGED_OUT = '登录后显示网易云 / QQ / 酷狗歌单';
var playlistSourceChipLastText = '';

function playlistSourceChipSnapshot() {
  var canCheckLogin = typeof hasPlatformLogin === 'function';
  var logged = PLAYLIST_SOURCE_CHIP_ORDER.filter(function (provider) {
    return canCheckLogin && !!hasPlatformLogin(provider);
  });
  if (!logged.length) {
    return { text: PLAYLIST_SOURCE_CHIP_LOGGED_OUT, title: '登录任意音源后，这里会实时显示已登录的音源', logged: 0 };
  }
  // 只列音源名，不带任何数量（数量会让人误读成「账号里有多少歌单」）
  var names = logged.map(function (provider) { return PLAYLIST_SOURCE_CHIP_SHORT[provider]; });
  var labels = logged.map(function (provider) {
    return typeof platformMeta === 'function' ? platformMeta(provider).label : PLAYLIST_SOURCE_CHIP_SHORT[provider];
  });
  return {
    text: names.join(' · '),
    title: '已登录音源：' + labels.join(' / '),
    logged: logged.length,
  };
}

function renderPlaylistSourceChip() {
  var el = document.getElementById('pl-source-chip');
  if (!el) return;
  var snap;
  try { snap = playlistSourceChipSnapshot(); } catch (e) { return; }
  if (snap.title) el.setAttribute('title', snap.title); else el.removeAttribute('title');
  el.classList.toggle('is-live', snap.logged > 0);
  if (snap.text === playlistSourceChipLastText && el.textContent === snap.text) return;
  playlistSourceChipLastText = snap.text;
  el.textContent = snap.text;
}

var PLAYLIST_FETCH_TIMEOUT_MS = 15000;
var PLAYLIST_LIST_CACHE_KEY = 'mineradio-user-playlists-cache-v1';
/* 所有音源都没拿到 + 手上一条个人歌单都没有 = 这次是加载失败，不是「账号里没有歌单」。
   两者在界面上必须长得不一样，否则用户会以为歌单被清空了。 */
var playlistListLoadFailed = false;

function playlistListErrorNoticeHtml() {
  return '<div class="pl-detail-empty pl-list-error" data-pl-list-error="1">' +
      '<div class="pl-detail-empty-title">个人歌单加载失败</div>' +
      '<div class="pl-detail-empty-hint">上游超时了，歌单没有丢，点下面重新加载</div>' +
      '<button type="button" class="fx-mini-btn ghost pl-detail-retry-btn" data-pl-list-retry="1">重新加载</button>' +
    '</div>';
}

function playlistListEmptyHtml() {
  if (playlistListLoadFailed) return playlistListErrorNoticeHtml();
  return '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">未找到歌单</div>';
}

/* 失败提示要压在列表最上面：内置歌单照常显示，但用户得知道自己那批没加载出来。 */
function playlistListBodyHtml(listHtml) {
  var notice = playlistListLoadFailed ? playlistListErrorNoticeHtml() : '';
  return notice + (listHtml || playlistListEmptyHtml());
}

/* 单个音源的歌单请求：超时/失败都只返回 null（=「这次没拿到」，保留上一轮）；
   未登录时返回空列表（=「这个音源确实没有歌单」，要把旧数据清掉）。
   两种「没数据」必须区分，否则登出后旧歌单会一直挂在列表里。 */
function fetchPlaylistSource(url) {
  if (!url) return Promise.resolve({ playlists: [], collections: [] });
  return apiJson(url, { timeoutMs: PLAYLIST_FETCH_TIMEOUT_MS }).catch(function (e) {
    console.warn('[Playlists] source failed:', url, e && (e.message || e));
    return null;
  });
}

function playlistRowsFromPayload(payload, provider) {
  if (!payload || !Array.isArray(payload.playlists)) return null;
  return payload.playlists.map(function (pl) {
    if (!pl) return pl;
    pl.provider = provider;
    pl.source = provider;
    return pl;
  });
}

/* 列表缓存：下次启动先拿缓存渲染，网络回来再覆盖。
   只存各平台的个人歌单，内置歌单由主进程 JSON 提供，不掺进来。 */
function readPlaylistListCache() {
  /* 带版本读取：老档（无 v 字段）按 v0 处理，迁移只补版本号，结构一直是 { at, playlists }。
     迁移结果由 00-storage-migration 回写；解析失败 / 未来版本一律当作没有缓存。 */
  if (typeof readVersionedJson === 'function') {
    var restored = readVersionedJson(PLAYLIST_LIST_CACHE_KEY, {
      version: 1,
      migrate: function (parsed) { return { at: parsed.at, playlists: parsed.playlists }; }
    });
    if (!restored.ok) return null;
    var list = restored.value.playlists;
    if (!Array.isArray(list) || !list.length) return null;
    return restored.value;
  }
  try {
    var raw = localStorage.getItem(PLAYLIST_LIST_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.playlists) || !parsed.playlists.length) return null;
    return parsed;
  } catch (e) { return null; }
}

function writePlaylistListCache() {
  try {
    var list = (userPlaylists || []).filter(function (pl) {
      var provider = pl && (pl.provider || pl.source);
      return provider && provider !== 'mineradio' && provider !== 'local';
    });
    if (!list.length) return;
    if (typeof writeVersionedJson === 'function') {
      writeVersionedJson(PLAYLIST_LIST_CACHE_KEY, { at: Date.now(), playlists: list }, 1);
      return;
    }
    localStorage.setItem(PLAYLIST_LIST_CACHE_KEY, JSON.stringify({ at: Date.now(), playlists: list }));
  } catch (e) {}
}

/* 用缓存把各平台数组灌回去，供首屏直接渲染。 */
function hydrateUserPlaylistsFromCache() {
  var cached = readPlaylistListCache();
  if (!cached) return false;
  var buckets = { netease: [], qq: [], kugou: [], qishui: [], spotify: [] };
  cached.playlists.forEach(function (pl) {
    var provider = pl && (pl.provider || pl.source);
    if (provider && buckets[provider]) buckets[provider].push(pl);
  });
  if (buckets.netease.length) neteasePlaylists = buckets.netease;
  if (buckets.qq.length) qqPlaylists = buckets.qq;
  if (buckets.kugou.length) kugouPlaylists = buckets.kugou;
  if (buckets.qishui.length) qishuiPlaylists = buckets.qishui;
  if (buckets.spotify.length) spotifyPlaylists = buckets.spotify;
  userPlaylists = builtInPlaylists.concat(neteasePlaylists, qqPlaylists, kugouPlaylists, qishuiPlaylists, spotifyPlaylists);
  return true;
}

/* 歌单曲目的会话内缓存（按 provider:id，60s）。只用于「秒开」，不参与持久化。 */
var playlistPanelTracksCache = Object.create(null);
var PLAYLIST_TRACKS_CACHE_TTL_MS = 60 * 1000;

function readPlaylistTracksCache(key) {
  var hit = playlistPanelTracksCache[key];
  if (!hit || !hit.tracks || !hit.tracks.length) return null;
  if (Date.now() - hit.at > PLAYLIST_TRACKS_CACHE_TTL_MS) { delete playlistPanelTracksCache[key]; return null; }
  return hit.tracks;
}

function writePlaylistTracksCache(key, tracks) {
  if (!key || !tracks || !tracks.length) return;
  playlistPanelTracksCache[key] = { at: Date.now(), tracks: tracks.slice() };
  var keys = Object.keys(playlistPanelTracksCache);
  if (keys.length > 24) delete playlistPanelTracksCache[keys[0]];
}

async function refreshUserPlaylists(force) {
  renderPlaylistSourceChip();
  // 内置歌单不依赖任何平台登录：未登录也要能看见 / 展开 / 播放
  if (typeof refreshBuiltInPlaylists === 'function' && (force || !builtInPlaylists.length)) {
    try { await refreshBuiltInPlaylists(!!force); } catch (e) { console.warn('[BuiltInPlaylists]', e); }
  }
  /* 首屏先用上一次的列表顶上：上游慢的时候面板也有内容可看，
     网络回来后再用新数据覆盖（这次没拿到就保留缓存，不清空）。 */
  var hydratedFromCache = false;
  if (!userPlaylists.length && hydrateUserPlaylistsFromCache()) {
    hydratedFromCache = true;
    renderUserPlaylistsList({ reset: true });
    renderPlaylistSourceChip();
    scheduleShelfRebuild('refresh-user-playlists-cache', true);
  }
  if (!loginStatus.loggedIn && !qqLoginStatus.loggedIn && !kugouLoginStatus.loggedIn && !qishuiLoginStatus.loggedIn && !spotifyLoginStatus.loggedIn) {
    playlistListLoadFailed = false;
    resetPlaylistPanelRenderLimit();
    var podcastListLoggedOut = document.getElementById('podcast-list');
    if (podcastListLoggedOut) podcastListLoggedOut.innerHTML = '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.28);font-size:11.5px">登录后显示我的播客</div>';
    // 未登录也展示本地歌单（AI 歌单保存 / 后续本地收藏的落点）与内置歌单
    var hasLocalLoggedOut = (typeof listLocalPlaylists === 'function' && listLocalPlaylists().length);
    if (builtInPlaylists.length || hasLocalLoggedOut) {
      userPlaylists = builtInPlaylists.slice();
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
  if (!force && !hydratedFromCache && !needsQQRefresh && !needsKugouRefresh && !needsQishuiRefresh && !needsSpotifyRefresh && (userPlaylists.length || myPodcastCollections.length)) {
    var cachedAnimate = isPlaylistPanelVisibleForRender();
    renderPlaylistSourceChip();
    renderUserPlaylistsList({ animate: cachedAnimate });
    renderMyPodcastCollections({ animate: cachedAnimate });
    return;
  }
  var $pl = document.getElementById('pl-list');
  var hasCachedPlaylists = !!(userPlaylists.length || (typeof localPlaylistPanelItems === 'function' && localPlaylistPanelItems().length));
  if ($pl && !hasCachedPlaylists) {
    $pl.innerHTML = miniQueueSkeleton();
    if (window.gsap) animateListItems($pl, '.mini-queue-skeleton', { x: 0, y: 6, stagger: 0.018, duration: 0.18, limit: 3 });
  }
  var $pod = document.getElementById('podcast-list');
  if ($pod && !(myPodcastCollections && myPodcastCollections.length)) $pod.innerHTML = miniQueueSkeleton();
  try {
    /* 一次上游抖动不该让整张歌单列表消失：
       - 每个音源单独超时（服务端 6s + 这里兜底 15s），失败只返回 null；
       - 返回 null 的音源保留上一轮拿到的列表，其余照常刷新；
       - 全部失败时页面仍是「上一份列表」，而不是空白或永远转圈。 */
    var result = await Promise.all([
      fetchPlaylistSource(loginStatus.loggedIn ? '/api/user/playlists' : ''),
      fetchPlaylistSource(loginStatus.loggedIn ? '/api/podcast/my' : ''),
      fetchPlaylistSource(qqLoginStatus.loggedIn ? '/api/qq/user/playlists' : ''),
      fetchPlaylistSource(kugouLoginStatus.loggedIn ? '/api/kugou/user/playlists' : ''),
      fetchPlaylistSource(qishuiLoginStatus.loggedIn ? '/api/qishui/user/playlists' : ''),
      fetchPlaylistSource(spotifyLoginStatus.loggedIn ? '/api/spotify/user/playlists' : '')
    ]);
    var nextNetease = playlistRowsFromPayload(result[0], 'netease');
    if (nextNetease) neteasePlaylists = nextNetease;
    var nextQQ = playlistRowsFromPayload(result[2], 'qq');
    if (nextQQ) qqPlaylists = nextQQ;
    var nextKugou = playlistRowsFromPayload(result[3], 'kugou');
    if (nextKugou) kugouPlaylists = nextKugou;
    var nextQishui = playlistRowsFromPayload(result[4], 'qishui');
    if (nextQishui) qishuiPlaylists = nextQishui;
    var nextSpotify = playlistRowsFromPayload(result[5], 'spotify');
    if (nextSpotify) spotifyPlaylists = nextSpotify;
    userPlaylists = builtInPlaylists.concat(neteasePlaylists, qqPlaylists, kugouPlaylists, qishuiPlaylists, spotifyPlaylists);
    if (result[1] && Array.isArray(result[1].collections)) myPodcastCollections = result[1].collections;
    var sourceResults = [result[0], result[2], result[3], result[4], result[5]];
    var failedSources = sourceResults.filter(function (r) { return r === null; }).length;
    playlistListLoadFailed = failedSources > 0 && !neteasePlaylists.length && !qqPlaylists.length &&
      !kugouPlaylists.length && !qishuiPlaylists.length && !spotifyPlaylists.length;
    writePlaylistListCache();
    // 数据落地之后再刷一次 chip：此时才知道每个音源实际拿到几个歌单
    renderPlaylistSourceChip();
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
  if (provider === 'mineradio') return 'mineradio:' + id;
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
/* 失败态的文案要说出「这次没拿到」，不能让人以为歌单被清空了。 */
function playlistPanelDetailErrorText(error) {
  var code = String(error || '');
  if (code === 'KUGOU_AUTH_REQUIRED') return '酷狗登录态已失效，请重新登录';
  if (code === 'KUGOU_PLAYLIST_EMPTY') return '这次没取到歌单曲目';
  if (code === 'KUGOU_PLAYLIST_LOAD_FAILED') return '歌单详情加载失败';
  return '歌单加载失败';
}
function playlistPanelDetailRowsHtml(options) {
  options = options || {};
  var st = playlistPanelDetailState;
  var tracks = st.tracks || [];
  if (st.loading && !tracks.length) {
    return '<div class="pl-detail-row pl-detail-loading-row"><div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06)"></div><div style="flex:1;min-width:0"><div class="pl-detail-row-title">正在载入歌单</div><div class="pl-detail-row-artist">请稍候</div></div></div>';
  }
  if (!tracks.length) {
    /* 关键分支：请求失败绝不能渲染成「暂无可播放歌曲」——那是把一次网络抖动
       说成歌单事实，用户会以为自己的歌没了。只有真的空歌单才走下面那句。 */
    if (st.error) {
      return '<div class="pl-detail-empty" data-pl-detail-error="' + escAttr(String(st.error)) + '">' +
        '<div class="pl-detail-empty-title">' + escHtml(playlistPanelDetailErrorText(st.error)) + '</div>' +
        '<div class="pl-detail-empty-hint">只是这次没取到，歌单里的歌还在</div>' +
        '<button type="button" class="fx-mini-btn ghost pl-detail-retry-btn" data-pl-detail-retry="1">重新加载</button>' +
        '</div>';
    }
    return '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.30);font-size:11.5px">歌单暂无可播放歌曲</div>';
  }
  var viewport = Math.max(280, Number(options.viewport) || Math.min(620, Math.round((window.innerHeight || 800) * 0.72)));
  var localScrollTop = Math.max(0, Number(options.scrollTop) || 0);
  var start = Math.max(0, Math.floor(localScrollTop / PLAYLIST_DETAIL_ROW_STEP) - PLAYLIST_DETAIL_VIRTUAL_OVERSCAN);
  var maxRows = Math.ceil(viewport / PLAYLIST_DETAIL_ROW_STEP) + PLAYLIST_DETAIL_VIRTUAL_OVERSCAN * 2;
  var end = Math.min(tracks.length, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, tracks.length - maxRows)));
  end = Math.min(tracks.length, Math.max(end, start + maxRows));
  var rows = '<div class="pl-detail-virtual-spacer" aria-hidden="true" style="height:' + (start * PLAYLIST_DETAIL_ROW_STEP) + 'px"></div>';
  // 内置歌单详情：行尾给「移出本歌单」按钮（不碰平台/本地歌曲本身）
  var builtInDetail = String(st.key || '').indexOf('mineradio:') === 0;
  rows += tracks.slice(start, end).map(function (song, localIndex) {
    var i = start + localIndex;
    var thumb = songCoverSrc(song, 60);
    var imgTag = thumb ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="mineradioCoverFallback(this)"') : '<div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06);flex:0 0 auto"></div>';
    var removeBtn = builtInDetail
      ? '<button type="button" class="pl-detail-row-remove" data-pl-detail-remove="' + i + '" title="从内置歌单移除">×</button>'
      : '';
    return '<div class="pl-detail-row" data-pl-detail-row="' + i + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-detail-row-title">' + escHtml(song.name || '') + '</div>' +
      '<button type="button" class="pl-detail-row-artist" data-pl-detail-artist="' + i + '">' + escHtml(song.artist || '未知歌手') + '</button></div>' +
      removeBtn +
      '</div>';
  }).join('');
  rows += '<div class="pl-detail-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, tracks.length - end) * PLAYLIST_DETAIL_ROW_STEP) + 'px"></div>';
  return rows;
}
function playlistPanelDetailHtml(pl, provider, detailWindow) {
  var key = playlistPanelKey(provider, pl && pl.id);
  if (playlistPanelDetailState.key !== key) return '';
  var tracks = playlistPanelDetailState.tracks || [];
  var loading = playlistPanelDetailState.loading;
  provider = normalizePlaylistProvider(provider);
  var cover = pl && pl.cover ? (provider === 'netease' ? (pl.cover + '?param=96y96') : pl.cover) : '';
  var img = cover
    ? '<img class="pl-detail-cover" src="' + escAttr(cover) + '" alt="" decoding="async" onerror="mineradioCoverFallback(this)">'
    : (provider === 'mineradio'
      ? '<div class="pl-detail-cover pl-built-in-placeholder">MR</div>'
      : '<div class="pl-detail-cover"></div>');
  var creatorFallback = provider === 'qq' ? 'QQ Music' : (provider === 'kugou' ? 'Kugou' : (provider === 'qishui' ? '汽水音乐' : (provider === 'spotify' ? 'Spotify' : (provider === 'mineradio' ? 'Mineradio 内置歌单' : 'Netease'))));
  var rows = playlistPanelDetailRowsHtml(detailWindow || playlistPanelDetailWindowOptions());
  var detailError = String(playlistPanelDetailState.error || '');
  // 失败时曲目可能是上一次成功的内容，标题右侧要标出来，别让人以为是最新的
  var countText = loading
    ? '载入中'
    : (detailError ? (tracks.length ? tracks.length + ' 首（上次）' : '加载失败') : (tracks.length + ' 首'));
  var retryButton = detailError
    ? '<button class="fx-mini-btn ghost pl-detail-retry-btn" type="button" data-pl-detail-retry="1">重新加载</button>'
    : '';
  var canUncollect = !!(pl && pl.subscribed && !pl.virtual && (provider === 'netease' || provider === 'qishui' || provider === 'spotify'));
  var collectionButton = canUncollect
    ? '<button class="fx-mini-btn ghost pl-detail-collection-btn" type="button" data-pl-detail-collection="0">取消收藏</button>'
    : '';
  // local 与 mineradio 的歌单都在本机，可重命名 / 删除；mineradio 的曲目在主进程，
  // 没有可导出的浏览器端数据，因而不给「导出」。
  var localDeleteButton = provider === 'local'
    ? '<button class="fx-mini-btn ghost" type="button" data-pl-detail-rename="1">重命名</button>' +
      '<button class="fx-mini-btn ghost" type="button" data-pl-detail-export="1">导出</button>' +
      '<button class="fx-mini-btn ghost" type="button" data-pl-detail-delete="' + escAttr(key) + '">删除歌单</button>'
    : (provider === 'mineradio'
      ? '<button class="fx-mini-btn ghost" type="button" data-pl-detail-rename="1">重命名</button>' +
        '<button class="fx-mini-btn ghost" type="button" data-pl-detail-delete="' + escAttr(key) + '">删除歌单</button>'
      : '');
  return '<div class="pl-inline-detail" data-pl-detail="' + escAttr(key) + '">' +
    '<div class="pl-detail-sticky">' +
      '<div class="pl-detail-head">' + img + '<div style="flex:1;min-width:0"><div class="pl-detail-title">' + escHtml(pl.name || '歌单详情') + '</div><div class="pl-detail-sub">' + escHtml((pl.trackCount || tracks.length || 0) + ' 首 · ' + (pl.creator || creatorFallback)) + '</div></div><div class="pl-detail-count">' + countText + '</div></div>' +
      '<div class="pl-detail-actions"><button class="pl-detail-play" type="button" data-pl-detail-play="' + escAttr(key) + '"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>播放歌单</button>' + collectionButton + localDeleteButton + retryButton + '<button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-pl-detail-top="1">回到顶部</button></div>' +
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
async function openPlaylistPanelDetail(provider, pid, title, opts) {
  opts = opts || {};
  if (!pid) return;
  provider = normalizePlaylistProvider(provider);
  var key = playlistPanelKey(provider, pid);
  var pl = userPlaylists.find(function(item){ return playlistPanelKey(normalizePlaylistProvider(item.provider), item.id) === key; }) || { id: pid, provider: provider, name: title || 'Playlist Detail' };
  if (!opts.skipCache && playlistPanelDetailState.key === key && !playlistPanelDetailState.loading && playlistPanelDetailState.tracks.length) {
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
  // 内置歌单：曲目在主进程，走 desktopWindow IPC 分页拉取（歌单可容纳 5000 首）
  if (provider === 'mineradio') {
    if (typeof builtInPlaylistTracksPage !== 'function') { showToast('当前环境无法读取内置歌单'); return; }
    var biToken = ++playlistPanelDetailState.token;
    playlistPanelDetailState = {
      key: key,
      loading: true,
      playlist: pl,
      tracks: [],
      token: biToken,
      renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER,
      scrollTop: 0,
      total: 0,
      nextOffset: 0,
      hasMore: false,
    };
    renderPlaylistPanelDetailState();
    scrollPlaylistPanelDetailIntoView(key);
    try {
      var biPage = await builtInPlaylistTracksPage(pid, { limit: BUILT_IN_PLAYLIST_PAGE_SIZE, offset: 0 });
      if (playlistPanelDetailState.token !== biToken) return;
      if (!biPage || biPage.ok !== true) throw new Error((biPage && biPage.error) || 'BUILT_IN_PLAYLIST_READ_FAILED');
      playlistPanelDetailState.loading = false;
      playlistPanelDetailState.playlist = biPage.playlist || playlistPanelDetailState.playlist;
      playlistPanelDetailState.tracks = (biPage.tracks || []).map(cloneSong);
      playlistPanelDetailState.total = Number(biPage.total) || playlistPanelDetailState.tracks.length;
      playlistPanelDetailState.nextOffset = Number(biPage.nextOffset) || playlistPanelDetailState.tracks.length;
      playlistPanelDetailState.hasMore = !!biPage.hasMore;
      playlistPanelDetailState.renderLimit = Math.min(playlistPanelDetailState.tracks.length, PLAYLIST_DETAIL_INITIAL_RENDER);
      renderPlaylistPanelDetailState();
    } catch (biErr) {
      console.warn('[BuiltInPlaylistDetail]', pid, biErr);
      if (playlistPanelDetailState.token !== biToken) return;
      playlistPanelDetailState.loading = false;
      playlistPanelDetailState.tracks = [];
      playlistPanelDetailState.error = String((biErr && biErr.message) || 'BUILT_IN_PLAYLIST_READ_FAILED');
      renderPlaylistPanelDetailState();
      showToast('内置歌单加载失败');
    }
    return;
  }
  // 合并内置歌单分支时曾把这行弄丢：token 未声明 → 通用分支一执行就
  // ReferenceError，netease/qq/kugou/qishui/spotify 的歌单卡片全部静默无反应。
  var token = ++playlistPanelDetailState.token;
  playlistPanelDetailState = { key: key, loading: true, playlist: pl, tracks: [], token: token, renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER, scrollTop: 0 };
  renderPlaylistPanelDetailState();
  scrollPlaylistPanelDetailIntoView(key);
  /* 60s 内重开同一个歌单直接出内容：既省一次往返，也避免上游抖动时
     明明刚看过却只能盯着「正在载入歌单」。重试时跳过这一步（skipCache），
     但缓存本身要留着 —— 这次再失败还得靠它显示上一次的曲目。 */
  var cachedTracks = opts.skipCache ? null : readPlaylistTracksCache(key);
  if (cachedTracks) {
    playlistPanelDetailState.loading = false;
    playlistPanelDetailState.tracks = cachedTracks.map(cloneSong);
    playlistPanelDetailState.renderLimit = Math.min(playlistPanelDetailState.tracks.length, PLAYLIST_DETAIL_INITIAL_RENDER);
    renderPlaylistPanelDetailState();
    return;
  }
  try {
    var r = await apiJson(playlistTracksEndpoint(provider, pid), { timeoutMs: PLAYLIST_FETCH_TIMEOUT_MS });
    if (playlistPanelDetailState.token !== token) return;
    playlistPanelDetailState.loading = false;
    playlistPanelDetailState.tracks = (r && r.tracks || []).map(cloneSong);
    playlistPanelDetailState.renderLimit = Math.min(playlistPanelDetailState.tracks.length, PLAYLIST_DETAIL_INITIAL_RENDER);
    /* 服务端明确说「这次没拿到 / 需要重试」时不能装成空歌单：
       否则界面会给出「0 首 / 暂无可播放歌曲」这种错误结论。 */
    playlistPanelDetailState.error = (!playlistPanelDetailState.tracks.length && r && (r.retryable || r.error))
      ? String(r.error || 'KUGOU_PLAYLIST_EMPTY')
      : '';
    if (!playlistPanelDetailState.error) writePlaylistTracksCache(key, playlistPanelDetailState.tracks);
    renderPlaylistPanelDetailState();
  } catch (e) {
    console.warn('[PlaylistPanelDetail]', pid, e);
    if (playlistPanelDetailState.token !== token) return;
    playlistPanelDetailState.loading = false;
    /* 这次失败不等于歌单没歌：能拿到上一次成功的曲目就继续显示，
       拿不到才进入「可重试」状态 —— 绝不能直接把 0 首当成事实摆给用户。 */
    var previous = readPlaylistTracksCache(key);
    playlistPanelDetailState.tracks = previous ? previous.map(cloneSong) : [];
    playlistPanelDetailState.renderLimit = Math.min(playlistPanelDetailState.tracks.length, PLAYLIST_DETAIL_INITIAL_RENDER);
    playlistPanelDetailState.error = 'KUGOU_PLAYLIST_LOAD_FAILED';
    renderPlaylistPanelDetailState();
    showToast(previous ? '歌单刷新失败，先显示上次的内容' : '歌单详情加载失败，可点重试');
  }
}
/* 失败态的重试入口：必须真的重新走一次网络，不能命中「60s 秒开」缓存，
   否则点了没反应（缓存里本来就没有曲目，但状态也一起被保留了）。 */
async function retryPlaylistPanelDetail() {
  var st = playlistPanelDetailState;
  if (!st || !st.key) return;
  var parts = String(st.key).split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  var pid = parts.slice(1).join(':');
  var name = (st.playlist && st.playlist.name) || '';
  st.error = '';
  st.tracks = [];
  st.loading = true;
  st.renderLimit = PLAYLIST_DETAIL_INITIAL_RENDER;
  renderPlaylistPanelDetailState();
  /* skipCache 只是「别再走秒开分支」，不删缓存：万一这次又失败，
     catch 里还能拿它把上一次的曲目显示出来。 */
  await openPlaylistPanelDetail(provider, pid, name, { skipCache: true });
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
  // 内置歌单是分页的：点的行可能还没拉到，先补页再播
  if (String(playlistPanelDetailState.key || '').indexOf('mineradio:') === 0 &&
      !tracks[index] && playlistPanelDetailState.hasMore && typeof loadMoreBuiltInPlaylistDetail === 'function') {
    loadMoreBuiltInPlaylistDetail().then(function () {
      var after = playlistPanelDetailState.tracks || [];
      if (!after[index]) { showToast('这首歌还没加载出来，请滚动到它再试'); return; }
      startPlaylistPanelDetailPlayback(index);
    }).catch(function (e) { console.warn('[BuiltInPlaylistDetail]', e); });
    return;
  }
  if (!tracks[index]) return;
  startPlaylistPanelDetailPlayback(index);
}
function startPlaylistPanelDetailPlayback(index) {
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
// 内置歌单详情滚动到底时再拉一页；同一时刻只允许一个在途请求
var builtInPlaylistDetailLoading = false;
async function loadMoreBuiltInPlaylistDetail() {
  var st = playlistPanelDetailState;
  if (builtInPlaylistDetailLoading) return false;
  if (!st || String(st.key || '').indexOf('mineradio:') !== 0 || !st.hasMore) return false;
  if (typeof builtInPlaylistTracksPage !== 'function') return false;
  builtInPlaylistDetailLoading = true;
  try {
    var page = await builtInPlaylistTracksPage(String(st.key).slice('mineradio:'.length), {
      limit: BUILT_IN_PLAYLIST_PAGE_SIZE,
      offset: st.nextOffset || st.tracks.length,
    });
    if (!page || page.ok !== true) throw new Error((page && page.error) || 'BUILT_IN_PLAYLIST_READ_FAILED');
    if (playlistPanelDetailState.key !== st.key) return false;
    playlistPanelDetailState.tracks = (st.tracks || []).concat((page.tracks || []).map(cloneSong));
    playlistPanelDetailState.nextOffset = Number(page.nextOffset) || (st.nextOffset || 0) + (page.tracks || []).length;
    playlistPanelDetailState.hasMore = !!page.hasMore;
    renderPlaylistPanelDetailRows();
    return true;
  } catch (e) {
    console.warn('[BuiltInPlaylistDetail] load more failed', e);
    return false;
  } finally {
    builtInPlaylistDetailLoading = false;
  }
}
function maybeLoadMoreBuiltInPlaylistDetail() {
  var st = playlistPanelDetailState;
  if (!st || String(st.key || '').indexOf('mineradio:') !== 0 || !st.hasMore) return;
  var panel = document.getElementById('playlist-panel');
  if (!panel) return;
  if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 220) loadMoreBuiltInPlaylistDetail();
}
function openPlaylistPanelDetailArtist(index) {
  var song = playlistPanelDetailState.tracks && playlistPanelDetailState.tracks[index];
  if (song) openArtistDetailForSong(song);
}
function growPlaylistPanelDetailRenderLimit() {
  // 详情已改为全量数据源 + spacer 虚拟窗口，不再增长 renderLimit
  return false;
}
function maybeGrowPlaylistPanelDetailRenderLimit() {}
function resetPlaylistPanelRenderLimit() {
  playlistPanelRenderLimit = PLAYLIST_PANEL_BATCH_SIZE;
}
function growPlaylistPanelRenderLimit() {
  if (!userPlaylists.length) return;
  var prev = playlistPanelRenderLimit || PLAYLIST_PANEL_BATCH_SIZE;
  var next = Math.min(userPlaylists.length, prev + PLAYLIST_PANEL_BATCH_SIZE);
  if (next <= prev) return;
  playlistPanelRenderLimit = next;
  if (!appendUserPlaylistsBatch(prev, next, { animate: true })) {
    renderUserPlaylistsList({ animate: false, preserveScroll: true });
  }
}
function playlistPanelGroups() {
  var localItems = (typeof localPlaylistPanelItems === 'function') ? localPlaylistPanelItems() : [];
  var isPlatformPlaylist = function (pl) {
    return pl.provider === 'qq' || pl.provider === 'kugou' || pl.provider === 'qishui' || pl.provider === 'spotify' || pl.provider === 'mineradio';
  };
  return [
    { key:'mineradio', label:'Mineradio 内置歌单', items:userPlaylists.filter(function(pl){ return pl.provider === 'mineradio'; }) },
    { key:'local', label:'本地歌单', items:localItems },
    { key:'netease', label:'Netease Playlists', items:userPlaylists.filter(function(pl){ return !isPlatformPlaylist(pl); }) },
    { key:'qq', label:'QQ Music Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'qq'; }) },
    { key:'kugou', label:'Kugou Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'kugou'; }) },
    { key:'qishui', label:'Qishui Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'qishui'; }) },
    { key:'spotify', label:'Spotify Playlists', items:userPlaylists.filter(function(pl){ return pl.provider === 'spotify'; }) }
  ];
}
// ---- 没有封面的歌单：用「爱心 / 五角星」占位，而不是一块空白灰 ----
// 判据优先级：先认「喜欢」（沿用 isLikedPlaylistContext 的既有口径：specialType 5 /
// qishui-liked / 标题含「我喜欢 / 喜欢的音乐 / liked」），再认「收藏」（subscribed
// 或标题含「收藏」）。两条都不命中的无封面歌单保持原灰块，不硬塞图案。
var PLAYLIST_COVER_MARK_PATHS = {
  // 爱心：设计稿 code (1).html 的 path，填充色交给 CSS（currentColor）以便统一主题
  liked: '<path d="M50 88 C20 62, 2 46, 2 27 C2 12, 14 2, 27 2 C37 2, 45.5 7.5, 50 16 C54.5 7.5, 63 2, 73 2 C86 2, 98 12, 98 27 C98 46, 80 62, 50 88 Z" fill="currentColor"/>' +
    '<ellipse cx="32" cy="25" rx="8" ry="5" fill="rgba(255,255,255,.45)" transform="rotate(-30 32 25)"/>',
  // 五角星：设计稿 code.html 的圆角星 path（Q 曲线把所有角磨圆）
  collected: '<path d="M 53.3 11.5 L 59.3 28.9 Q 61.2 34.6 67.2 34.7 L 85.6 35 Q 95.6 35.2 87.6 41.2 L 72.9 52.3 Q 68.1 55.9 69.9 61.6 L 75.3 79.2 Q 78.2 88.8 70 83.1 L 54.9 72.5 Q 50 69 45.1 72.5 L 30 83.1 Q 21.8 88.8 24.7 79.2 L 30.1 61.6 Q 31.9 55.9 27.1 52.3 L 12.4 41.2 Q 4.4 35.2 14.4 35 L 32.8 34.7 Q 38.8 34.6 40.8 28.9 L 46.8 11.5 Q 50 2 53.3 11.5 Z" fill="currentColor"/>' +
    '<ellipse cx="36" cy="30" rx="7" ry="4.5" fill="rgba(255,255,255,.38)" transform="rotate(-38 36 30)"/>'
};

function playlistCoverMarkKind(pl) {
  pl = pl || {};
  var id = String(pl.id || '');
  var name = String(pl.name || '');
  try {
    if (typeof isLikedPlaylistContext === 'function' && isLikedPlaylistContext(id, name, pl)) return 'liked';
  } catch (_) {}
  if (pl.subscribed === true) return 'collected';
  if (/收藏/.test(name)) return 'collected';
  return '';
}

function playlistCoverMarkSvg(kind) {
  if (!kind || !PLAYLIST_COVER_MARK_PATHS[kind]) return '';
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    PLAYLIST_COVER_MARK_PATHS[kind] + '</svg>';
}

// 尺寸走 CSS 变量：卡片里是 44px，`#playlist-panel` 下由 CSS 覆盖成 50px，
// 跟 `.pl-card img` 的既有尺寸保持一致（之前写死 44px 会比封面小一圈）。
function playlistCoverBoxStyle(size, radius) {
  return '--pl-cover-size:' + size + 'px;--pl-cover-radius:' + radius + 'px';
}

function playlistCoverMarkHtml(pl, size, radius) {
  var kind = playlistCoverMarkKind(pl);
  var boxStyle = playlistCoverBoxStyle(size, radius);
  if (!kind) return '<div class="pl-cover-mark" style="' + boxStyle + '"></div>';
  return '<div class="pl-cover-mark is-' + kind + '" style="' + boxStyle + '">' + playlistCoverMarkSvg(kind) + '</div>';
}

// 封面槽：img 与「加载失败用的标记」叠在同一格里，标记平时 display:none。
// 为什么要这层：这张「Ta在抖音收藏的音乐」其实**有** cover URL，只是加载不出来 ——
// 只做「无封面」分支的话它永远是一块灰。对用户来说「拿不到封面」和「没有封面」
// 应该长一样：都显示那枚爱心/五角星。onerror 时由 mineradioCoverFallback
// 把 img 藏掉、把兄弟标记亮出来。
function playlistCoverHtml(pl, thumb, size, radius) {
  if (!thumb) return playlistCoverMarkHtml(pl, size, radius);
  var kind = playlistCoverMarkKind(pl);
  var style = playlistCoverBoxStyle(size, radius);
  var mark = kind
    ? '<span class="pl-cover-mark is-' + kind + '" style="display:none">' + playlistCoverMarkSvg(kind) + '</span>'
    : '';
  return '<span class="pl-cover-slot" style="' + style + '">' +
    '<img src="' + escAttr(thumb) + '" alt="" loading="lazy" decoding="async" onerror="mineradioCoverFallback(this)">' +
    mark + '</span>';
}

function playlistCardHtmlForPanel(pl, detailWindow) {
  var provider = normalizePlaylistProvider(pl.provider);
  var providerLabel = playlistProviderLabel(provider);
  var thumb = pl.cover ? (provider === 'netease' ? (pl.cover + '?param=88y88') : pl.cover) : '';
  var imgTag = playlistCoverHtml(pl, thumb, 44, 8);
  var key = playlistPanelKey(provider, pl.id);
  var expanded = playlistPanelDetailState.key === key ? ' expanded' : '';
  return '<div class="pl-card' + expanded + '" data-playlist-provider="' + provider + '" data-playlist-id="' + escAttr(String(pl.id || '')) + '" data-playlist-title="' + escAttr(pl.name || '') + '">' +
    imgTag +
    '<div style="flex:1;min-width:0"><div class="pl-name">' + escHtml(pl.name) + '<span class="tag-source ' + provider + '" style="margin-left:6px;vertical-align:1px">' + providerLabel + '</span></div><div class="pl-sub">' + pl.trackCount + ' 首 · ' + escHtml(pl.creator || '') + '</div></div>' +
  '</div>' + playlistPanelDetailHtml(pl, provider, detailWindow);
}
function appendUserPlaylistsBatch(fromCount, toCount, opts) {
  opts = opts || {};
  var $pl = document.getElementById('pl-list');
  if (!$pl || toCount <= fromCount) return false;
  // 展开详情时结构复杂，回退全量重渲更安全
  if (playlistPanelDetailState.key) return false;
  var loadMore = $pl.querySelector('[data-pl-load-more]');
  if (loadMore) loadMore.remove();
  var detailWindow = playlistPanelDetailWindowOptions();
  var groups = playlistPanelGroups();
  var renderedCount = 0;
  var chunk = '';
  var appended = 0;
  groups.forEach(function(group){
    if (!group.items.length) return;
    var roomBefore = Math.max(0, fromCount - renderedCount);
    var roomAfter = Math.max(0, toCount - renderedCount);
    if (roomAfter <= 0) return;
    var visible = group.items.slice(0, roomAfter);
    var start = Math.min(visible.length, roomBefore);
    var batch = visible.slice(start);
    if (!batch.length) {
      renderedCount += visible.length;
      return;
    }
    if (start === 0 && !$pl.querySelector('[data-pl-section="' + group.key + '"]')) {
      chunk += '<div class="pl-section-label" data-pl-section="' + group.key + '">' + group.label + (group.key === 'local'
        ? '<button class="fx-mini-btn ghost" type="button" data-pl-local-import="1" style="margin-left:8px">导入歌单</button>'
        : '') + '</div>';
    }
    chunk += batch.map(function(pl){ return playlistCardHtmlForPanel(pl, detailWindow); }).join('');
    appended += batch.length;
    renderedCount += visible.length;
  });
  if (!chunk || !appended) return false;
  $pl.insertAdjacentHTML('beforeend', chunk);
  if (userPlaylists.length > toCount) {
    $pl.insertAdjacentHTML('beforeend', '<button type="button" class="fx-mini-btn ghost pl-load-more" data-pl-load-more="1">加载更多 ' + toCount + '/' + userPlaylists.length + '</button>');
  }
  if (opts.animate && window.gsap) {
    var cards = $pl.querySelectorAll('.pl-card');
    var fresh = Array.prototype.slice.call(cards, Math.max(0, cards.length - appended));
    if (fresh.length) {
      window.gsap.fromTo(fresh, { autoAlpha: 0, y: 6, x: -6 }, { autoAlpha: 1, y: 0, x: 0, duration: 0.20, stagger: 0.01, ease: 'power2.out', force3D: true, overwrite: true });
    }
  }
  return true;
}
function bindPlaylistPanelLazyRender() {
  var panel = document.getElementById('playlist-panel');
  if (!panel || playlistPanelLazyBound) return;
  playlistPanelLazyBound = true;
  panel.addEventListener('scroll', throttle(function(){
    if (queueViewTab === 'queue' && playQueue.length) {
      scheduleQueuePanelVirtualRender();
    }
    if (queueViewTab === 'playlists' && playlistPanelDetailState.key) {
      schedulePlaylistPanelDetailVirtualRender();
      maybeLoadMoreBuiltInPlaylistDetail();
    }
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
    /* 加载失败 ≠ 没有歌单：失败的这一次要给重试入口，不能一句「未找到歌单」了事。 */
    $pl.innerHTML = playlistListEmptyHtml();
    return;
  }
  var panel = document.getElementById('playlist-panel');
  var keepTop = panel ? panel.scrollTop : 0;
  var detailWindow = playlistPanelDetailWindowOptions();
  var groups = playlistPanelGroups();
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
  var listHtml = groups.map(function(group){
    var items = visibleGroupItems(group.items);
    if (!items.length) return '';
    return '<div class="pl-section-label" data-pl-section="' + group.key + '">' + group.label + (group.key === 'local'
      ? '<button class="fx-mini-btn ghost" type="button" data-pl-local-import="1" style="margin-left:8px">导入歌单</button>'
      : '') + '</div>' + items.map(function(pl){ return playlistCardHtmlForPanel(pl, detailWindow); }).join('');
  }).join('');
  /* 个人歌单没加载出来时，内置歌单通常还在 —— 所以错误提示要能叠在列表上方，
     不能只在「整页空」时才出现。 */
  $pl.innerHTML = playlistListBodyHtml(listHtml);
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
    var imgTag = thumb ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="mineradioCoverFallback(this)"') : '<div style="width:44px;height:44px;border-radius:8px;background:rgba(0,245,212,.07);flex-shrink:0"></div>';
    return '<div class="pl-card podcast-card" data-podcast-key="' + escAttr(pc.key || '') + '" data-podcast-title="' + escAttr(pc.title || '') + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-name">' + escHtml(pc.title || '') + '</div><div class="pl-sub">' + (pc.count || 0) + ' 项 · ' + escHtml(pc.sub || '') + '</div></div>' +
    '</div>';
  }).join('');
  if (opts.animate) animateVisiblePanelList($pod, '.pl-card', document.getElementById('playlist-panel'));
}
document.getElementById('pl-list').addEventListener('click', function(e){
  var listRetry = e.target && e.target.closest ? e.target.closest('[data-pl-list-retry]') : null;
  if (listRetry) {
    e.preventDefault();
    e.stopPropagation();
    playlistListLoadFailed = false;
    var listEl = document.getElementById('pl-list');
    if (listEl) listEl.innerHTML = typeof miniQueueSkeleton === 'function' ? miniQueueSkeleton() : '';
    refreshUserPlaylists(true);
    return;
  }
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
  var detailRetry = e.target && e.target.closest ? e.target.closest('[data-pl-detail-retry]') : null;
  if (detailRetry) {
    e.preventDefault();
    e.stopPropagation();
    retryPlaylistPanelDetail();
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
  var renameLocalBtn = e.target && e.target.closest ? e.target.closest('[data-pl-detail-rename]') : null;
  if (renameLocalBtn) {
    e.preventDefault();
    e.stopPropagation();
    var renameParts = String(playlistPanelDetailState.key || '').split(':');
    if (renameParts[0] === 'mineradio') {
      renameBuiltInPlaylist(renameParts.slice(1).join(':'), playlistPanelDetailState.playlist && playlistPanelDetailState.playlist.name || '');
      return;
    }
    startLocalPlaylistRename(playlistPanelDetailState.key);
    return;
  }
  var exportLocalBtn = e.target && e.target.closest ? e.target.closest('[data-pl-detail-export]') : null;
  if (exportLocalBtn) {
    e.preventDefault();
    e.stopPropagation();
    exportLocalPlaylistFile(String(playlistPanelDetailState.key || '').replace(/^local:/, ''));
    return;
  }
  var importLocalBtn = e.target && e.target.closest ? e.target.closest('[data-pl-local-import]') : null;
  if (importLocalBtn) {
    e.preventDefault();
    e.stopPropagation();
    pickLocalPlaylistImportFile();
    return;
  }
  var deleteLocalBtn = e.target && e.target.closest ? e.target.closest('[data-pl-detail-delete]') : null;
  if (deleteLocalBtn) {
    e.preventDefault();
    e.stopPropagation();
    var delKey = String(deleteLocalBtn.getAttribute('data-pl-detail-delete') || '');
    var delParts = delKey.split(':');
    if (delParts[0] === 'mineradio') {
      deleteBuiltInPlaylist(delParts.slice(1).join(':'), playlistPanelDetailState.playlist && playlistPanelDetailState.playlist.name || '');
      return;
    }
    handleLocalPlaylistDetailDelete(
      String(delKey || '').replace(/^local:/, ''),
      deleteLocalBtn
    );
    return;
  }
  var removeTrackBtn = e.target && e.target.closest ? e.target.closest('[data-pl-detail-remove]') : null;
  if (removeTrackBtn) {
    e.preventDefault();
    e.stopPropagation();
    var rmParts = String(playlistPanelDetailState.key || '').split(':');
    if (rmParts[0] === 'mineradio') {
      removeTrackFromBuiltInPlaylist(rmParts.slice(1).join(':'), Number(removeTrackBtn.getAttribute('data-pl-detail-remove')));
      return;
    }
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
