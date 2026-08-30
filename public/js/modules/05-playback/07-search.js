// ============================================================
//  搜索
// ============================================================
var searchTimer = null;
var searchRequestSeq = 0;
var searchLastResultQuery = '';
var SEARCH_HISTORY_STORE_KEY = 'mineradio-search-history';
var $input = document.getElementById('search-input');
var $results = document.getElementById('search-results');
var $loading = document.getElementById('loading-overlay');
function syncSearchAreaResultState() {
  var searchArea = document.getElementById('search-area');
  if (!searchArea || !$results) return;
  var hasVisibleResults = $results.classList.contains('show') && $results.children.length > 0;
  var hasIntent = !!($input && String($input.value || '').trim()) || searchMode === 'podcast';
  searchArea.classList.toggle('has-results', hasVisibleResults && hasIntent);
}
if (window.MutationObserver && $results) {
  new MutationObserver(syncSearchAreaResultState).observe($results, { childList: true, attributes: true, attributeFilter: ['class'] });
}
function isMusicSearchMode(mode) {
  return mode !== 'podcast';
}
function searchResultKey(q, mode) {
  return (mode || searchMode || 'song') + '|' + String(q || '').trim();
}
function clearSearchResults() {
  searchRequestSeq++;
  searchLastResultQuery = '';
  playlist = [];
  podcastResults = [];
  podcastPrograms = [];
  podcastCurrentRadio = null;
  $results.innerHTML = '';
  $results.classList.remove('show');
}
function searchEmptyHtml(message, opts) {
  opts = opts || {};
  if (opts.loading) {
    return '<div class="search-empty search-empty-loading" role="status">' +
      '<div class="search-empty-shimmer"></div><div class="search-empty-shimmer"></div><div class="search-empty-shimmer"></div>' +
      '<div class="search-empty-text">' + escHtml(message || 'Searching...') + '</div></div>';
  }
  return '<div class="search-empty"><div class="search-empty-text">' + escHtml(message || 'No results') + '</div></div>';
}
function readSearchHistory() {
  try {
    var raw = JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(function(v){ return String(v || '').trim(); }).filter(Boolean).slice(0, 10) : [];
  } catch (e) {
    return [];
  }
}
function writeSearchHistory(items) {
  try { localStorage.setItem(SEARCH_HISTORY_STORE_KEY, JSON.stringify((items || []).slice(0, 10))); } catch (e) {}
}
function rememberSearchQuery(q) {
  q = String(q || '').trim();
  if (!q) return;
  var items = readSearchHistory().filter(function(item){ return item.toLowerCase() !== q.toLowerCase(); });
  items.unshift(q);
  writeSearchHistory(items);
}
function renderSearchHistory() {
  if (searchMode !== 'song') return false;
  var items = readSearchHistory();
  if (!items.length) {
    $results.innerHTML = '';
    $results.classList.remove('show');
    return false;
  }
  $results.innerHTML =
    '<div class="search-history">' +
      '<div class="search-history-head"><span>搜索历史</span><button class="search-history-clear" type="button" data-clear-history="1">清空</button></div>' +
      '<div class="search-history-list">' +
        items.map(function(q){ return '<button class="search-history-chip" type="button" data-history-query="' + escAttr(q) + '">' + escHtml(q) + '</button>'; }).join('') +
      '</div>' +
    '</div>';
  $results.classList.add('show');
  requestAnimationFrame(updateSearchPillGlassDisplacementMap);
  return true;
}
function clearSearchHistory() {
  writeSearchHistory([]);
  renderSearchHistory();
}
function runSearchHistory(q) {
  q = String(q || '').trim();
  if (!q) return;
  $input.value = q;
  setPeek(document.getElementById('search-area'), true, 'search');
  doSearch(q);
  $input.focus();
}
function updateSearchModeTabs() {
  var songBtn = document.getElementById('search-mode-song');
  var neteaseBtn = document.getElementById('search-mode-netease');
  var qqBtn = document.getElementById('search-mode-qq');
  var podcastBtn = document.getElementById('search-mode-podcast');
  if (songBtn) {
    songBtn.classList.toggle('active', searchMode === 'song');
    songBtn.setAttribute('aria-selected', searchMode === 'song' ? 'true' : 'false');
  }
  if (neteaseBtn) {
    neteaseBtn.classList.toggle('active', searchMode === 'netease');
    neteaseBtn.setAttribute('aria-selected', searchMode === 'netease' ? 'true' : 'false');
  }
  if (qqBtn) {
    qqBtn.classList.toggle('active', searchMode === 'qq');
    qqBtn.setAttribute('aria-selected', searchMode === 'qq' ? 'true' : 'false');
  }
  if (podcastBtn) {
    podcastBtn.classList.toggle('active', searchMode === 'podcast');
    podcastBtn.setAttribute('aria-selected', searchMode === 'podcast' ? 'true' : 'false');
  }
  if ($input) {
    $input.placeholder = searchMode === 'podcast'
      ? '搜索播客、电台...'
      : (searchMode === 'qq' ? '搜索 QQ 音乐...' : (searchMode === 'netease' ? '搜索网易云音乐...' : '搜索歌曲、歌手...'));
  }
  requestAnimationFrame(updateSearchPillGlassDisplacementMap);
}
function setSearchMode(mode) {
  mode = (mode === 'podcast' || mode === 'netease' || mode === 'qq' || mode === 'kugou' || mode === 'qishui' || mode === 'spotify') ? mode : 'song';
  if (searchMode === mode) return;
  searchMode = mode;
  updateSearchModeTabs();
  clearSearchResults();
  var searchArea = document.getElementById('search-area');
  if (searchArea) setPeek(searchArea, true, 'search');
  var q = $input ? $input.value.trim() : '';
  if (searchMode === 'podcast') {
    if (q) doSearch(q);
    else loadPodcastHot();
  } else if (q) {
    doSearch(q);
  } else {
    renderSearchHistory();
  }
}
function podcastMetaText(item) {
  item = item || {};
  var bits = [];
  if (item.djName) bits.push(item.djName);
  if (item.programCount) bits.push(item.programCount + ' episodes');
  if (item.subCount) bits.push(Math.round(item.subCount / 1000) + 'k follows');
  return bits.join('  ·  ');
}
function formatProgramTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  return h ? (h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')) : (m + ':' + String(s).padStart(2, '0'));
}
function programMetaText(item) {
  item = item || {};
  var bits = [];
  if (item.radioName || item.artist) bits.push(item.radioName || item.artist);
  if (item.djName && item.djName !== item.artist) bits.push(item.djName);
  if (item.duration) bits.push(formatProgramTime(Math.round(item.duration / 1000)));
  return bits.join('  ·  ');
}
function searchThumbHtml(src) {
  return src
    ? imgTagFromSrc(coverUrlWithSize(src, 80), 'loading="lazy" onerror="this.style.opacity=0.2"')
    : '<div style="width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>';
}
function renderPodcastRadios(items, label) {
  podcastResults = items || [];
  podcastPrograms = [];
  playlist = [];
  if (!podcastResults.length) {
    $results.innerHTML = searchEmptyHtml('没有找到播客');
    $results.classList.add('show');
    return;
  }
  $results.innerHTML = podcastResults.map(function(p, i){
    return '<div class="search-result">' +
      '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0" onclick="openPodcastPrograms(' + i + ')">' +
        searchThumbHtml(p.cover) +
        '<div class="search-result-info">' +
          '<div class="search-result-title">' + escHtml(p.name || '') + '<span class="tag-podcast">Podcast</span></div>' +
          '<div class="search-result-meta">' + escHtml(podcastMetaText(p) || label || 'NetEase Radio') + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="add-btn" title="Open" onclick="event.stopPropagation();openPodcastPrograms(' + i + ')">›</button>' +
    '</div>';
  }).join('');
  $results.classList.add('show');
  if (window.gsap) animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
}
async function loadPodcastHot() {
  var requestSeq = ++searchRequestSeq;
  $results.innerHTML = searchEmptyHtml('正在加载播客…', { loading: true });
  $results.classList.add('show');
  try {
    var data = await apiJson('/api/podcast/hot?limit=18');
    if (requestSeq !== searchRequestSeq || searchMode !== 'podcast') return;
    renderPodcastRadios(data.podcasts || [], 'Hot podcasts');
  } catch (err) {
    console.error('Podcast hot:', err);
    if (requestSeq === searchRequestSeq) $results.innerHTML = searchEmptyHtml('播客加载失败');
  }
}
async function doPodcastSearch(q) {
  var requestSeq = ++searchRequestSeq;
  try {
    var data = await apiJson('/api/podcast/search?keywords=' + encodeURIComponent(q) + '&limit=18');
    if (requestSeq !== searchRequestSeq || searchMode !== 'podcast' || $input.value.trim() !== q) return;
    renderPodcastRadios(data.podcasts || [], 'Search results');
  } catch (err) {
    console.error('Podcast search:', err);
  }
}
async function openPodcastPrograms(i) {
  var radio = podcastResults[i]; if (!radio) return;
  var requestSeq = ++searchRequestSeq;
  podcastCurrentRadio = radio;
  $results.innerHTML = searchEmptyHtml('正在加载节目…', { loading: true });
  $results.classList.add('show');
  try {
    var data = await apiJson('/api/podcast/programs?id=' + encodeURIComponent(radio.id) + '&limit=36');
    if (requestSeq !== searchRequestSeq || searchMode !== 'podcast') return;
    podcastCurrentRadio = Object.assign({}, radio, data.radio || {});
    podcastPrograms = data.programs || [];
    playlist = podcastPrograms;
    renderPodcastPrograms();
  } catch (err) {
    console.error('Podcast programs:', err);
    if (requestSeq === searchRequestSeq) $results.innerHTML = searchEmptyHtml('节目加载失败');
  }
}
function renderPodcastPrograms() {
  var radio = podcastCurrentRadio || {};
  if (!podcastPrograms.length) {
    $results.innerHTML = '<div class="podcast-result-head"><button class="podcast-back-btn" onclick="event.stopPropagation();renderPodcastRadios(podcastResults)">‹</button><div class="search-result-info"><div class="search-result-title">' + escHtml(radio.name || 'Podcast') + '</div><div class="search-result-meta">暂无可用节目</div></div></div>';
    $results.classList.add('show');
    return;
  }
  $results.innerHTML =
    '<div class="podcast-result-head">' +
      '<button class="podcast-back-btn" onclick="event.stopPropagation();renderPodcastRadios(podcastResults)">‹</button>' +
      searchThumbHtml(radio.cover) +
      '<div class="search-result-info"><div class="search-result-title">' + escHtml(radio.name || 'Podcast') + '<span class="tag-podcast">Podcast</span></div><div class="search-result-meta">' + escHtml(radio.djName || (podcastPrograms.length + ' episodes')) + '</div></div>' +
    '</div>' +
    '<div class="podcast-program-virtual">' + podcastProgramRowsHtml() + '</div>';
  $results.classList.add('show');
  if (!$results.__podcastVirtualBound) {
    $results.__podcastVirtualBound = true;
    $results.addEventListener('scroll', throttle(function(){
      if (searchMode !== 'podcast' || !podcastPrograms.length) return;
      var wrap = $results.querySelector('.podcast-program-virtual');
      if (wrap) wrap.innerHTML = podcastProgramRowsHtml();
    }, 16), { passive: true });
  }
  if (window.gsap) animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.010, duration: 0.18, limit: 12 });
}
var PODCAST_PROGRAM_ROW_STEP = 62;
var PODCAST_PROGRAM_OVERSCAN = 6;
function podcastProgramRowsHtml() {
  var total = podcastPrograms.length;
  var head = $results.querySelector('.podcast-result-head');
  var headH = head ? (head.offsetHeight || 58) : 58;
  var scrollTop = Math.max(0, (Number($results.scrollTop) || 0) - headH);
  var viewport = Math.max(180, Number($results.clientHeight) || 320);
  var start = Math.max(0, Math.floor(scrollTop / PODCAST_PROGRAM_ROW_STEP) - PODCAST_PROGRAM_OVERSCAN);
  var maxRows = Math.ceil(viewport / PODCAST_PROGRAM_ROW_STEP) + PODCAST_PROGRAM_OVERSCAN * 2;
  var end = Math.min(total, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, total - maxRows)));
  end = Math.min(total, Math.max(end, start + maxRows));
  var html = '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (start * PODCAST_PROGRAM_ROW_STEP) + 'px"></div>';
  html += podcastPrograms.slice(start, end).map(function(p, localIndex){
    var i = start + localIndex;
    return '<div class="search-result">' +
      '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0" onclick="playPodcastProgram(' + i + ')">' +
        searchThumbHtml(p.cover) +
        '<div class="search-result-info">' +
          '<div class="search-result-title">' + escHtml(p.name || '') + '</div>' +
          '<div class="search-result-meta">' + escHtml(programMetaText(p)) + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="add-btn" title="下一首播放" onclick="event.stopPropagation();queuePodcastProgram(' + i + ')">+</button>' +
    '</div>';
  }).join('');
  html += '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, total - end) * PODCAST_PROGRAM_ROW_STEP) + 'px"></div>';
  return html;
}
function queuePodcastProgram(i) {
  var item = podcastPrograms[i]; if (!item) return;
  queueSongNext(item);
  showToast('已设为下一首: ' + item.name);
}
function playPodcastProgram(i) {
  var item = podcastPrograms[i]; if (!item) return;
  playSearchResult(i);
}

$input.addEventListener('input', function(){
  clearTimeout(searchTimer);
  var q = $input.value.trim();
  if (!q) {
    if (searchMode === 'podcast') loadPodcastHot();
    else renderSearchHistory();
    return;
  }
  if (isMusicSearchMode(searchMode)) {
    $results.innerHTML = searchEmptyHtml('正在搜索 “' + q + '”…', { loading: true });
    $results.classList.add('show');
  }
  searchTimer = setTimeout(function(){ doSearch(q); }, 180);
});
$input.addEventListener('focus', function(){
  var searchArea = document.getElementById('search-area');
  if (searchArea) setPeek(searchArea, true, 'search');
  if (!$input.value.trim() && isMusicSearchMode(searchMode)) renderSearchHistory();
  else if ($results.children.length > 0) $results.classList.add('show');
  else if (searchMode === 'podcast') loadPodcastHot();
});
var searchBoxEl = document.getElementById('search-box');
if (searchBoxEl) {
  searchBoxEl.addEventListener('click', function(){
    if ($input) $input.focus();
  });
}
$input.addEventListener('keydown', function(e){
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    var q = $input.value.trim();
    if (isMusicSearchMode(searchMode) && q && playlist.length && searchLastResultQuery === searchResultKey(q)) $results.classList.add('show');
    else doSearch(q, { autoPlayFirst: false });
  } else if (e.key === 'Escape') {
    clearTimeout(searchTimer);
    $input.blur();
    clearSearchResults();
    if (!emptyHomeActive) setPeek(document.getElementById('search-area'), false, 'search');
  }
});
$results.addEventListener('click', function(e){
  var clearBtn = e.target && e.target.closest ? e.target.closest('[data-clear-history]') : null;
  if (clearBtn) {
    e.preventDefault();
    e.stopPropagation();
    clearSearchHistory();
    return;
  }
  var item = e.target && e.target.closest ? e.target.closest('[data-history-query]') : null;
  if (item) {
    e.preventDefault();
    e.stopPropagation();
    runSearchHistory(item.getAttribute('data-history-query') || '');
  }
});
document.addEventListener('click', function(e){
  var searchArea = document.getElementById('search-area');
  if (!searchArea.contains(e.target)) {
    $results.classList.remove('show');
    if (!emptyHomeActive) setPeek(searchArea, false, 'search');
  }
});
updateSearchModeTabs();

function songProviderKey(song) {
  if (song && (song.provider === 'qishui' || song.source === 'qishui' || song.type === 'qishui')) return 'qishui';
  if (song && (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash || song.albumAudioId || song.album_audio_id)) return 'kugou';
  if (song && (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq')) return 'qq';
  if (song && (song.provider === 'spotify' || song.source === 'spotify' || song.type === 'spotify')) return 'spotify';
  return 'netease';
}
function songSourceTagHtml(song, opts) {
  opts = opts || {};
  var rawKey = song && (song.resolvedPlaybackProvider || song.playbackProvider || song.audioProvider || song.providerResolved || '');
  var key = /^(netease|qq|kugou|qishui|spotify)$/.test(String(rawKey || '')) ? String(rawKey) : songProviderKey(song);
  var label = key === 'qq' ? 'QQ' : (key === 'kugou' ? 'KG' : (key === 'qishui' ? 'QS' : (key === 'spotify' ? 'SP' : 'NE')));
  if (opts.switcher) {
    return '<button type="button" class="tag-source ' + key + ' control-source-chip" title="切换音源" aria-haspopup="true" onclick="toggleControlSourceSwitcher(event)">' + label + '</button>';
  }
  return '<span class="tag-source ' + key + '">' + label + '</span>';
}
var controlSourceSwitcherState = { open: false, loading: false, requestId: 0, anchor: null };
function controlSourceProviders() {
  return [
    { key: 'netease', label: 'NE', title: '网易云' },
    { key: 'qq', label: 'QQ', title: 'QQ音乐' },
    { key: 'kugou', label: 'KG', title: '酷狗' },
    { key: 'qishui', label: 'QS', title: '汽水' },
    { key: 'spotify', label: 'SP', title: 'Spotify' }
  ];
}
function controlSourceProviderTitle(provider) {
  var item = controlSourceProviders().filter(function (p) { return p.key === provider; })[0];
  return item ? item.title : provider;
}
function controlSourceSearchUrl(provider, query) {
  if (typeof searchProviderUrl === 'function') {
    return searchProviderUrl(provider, query, provider === 'netease' ? 10 : 8, 0);
  }
  if (provider === 'qq') return '/api/qq/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  if (provider === 'kugou') return '/api/kugou/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  if (provider === 'qishui') return '/api/qishui/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  if (provider === 'spotify') return '/api/spotify/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  return '/api/search?keywords=' + encodeURIComponent(query) + '&limit=10';
}
function currentResumeSeconds(fallback) {
  if (typeof audio !== 'undefined' && audio && isFinite(audio.currentTime) && audio.currentTime > 0) return audio.currentTime;
  return (audio && audio.currentTime) || Math.max(0, Number(fallback) || 0);
}
function ensureControlSourceSwitcher() {
  var el = document.getElementById('control-source-switcher');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'control-source-switcher';
  el.className = 'control-source-switcher';
  el.setAttribute('role', 'menu');
  el.addEventListener('click', function (e) { e.stopPropagation(); });
  document.body.appendChild(el);
  return el;
}
function currentControlSong() {
  return Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
}
function controlSourceSwitchQuery(song) {
  song = song || {};
  var artist = String(song.artist || '').split(/\s*\/\s*|\s*,\s*|\s*&\s*/)[0] || '';
  return [song.name || song.title || '', artist].filter(Boolean).join(' ').trim();
}
function controlSourcePositionSwitcher(anchor) {
  var el = ensureControlSourceSwitcher();
  anchor = anchor || controlSourceSwitcherState.anchor;
  if (!anchor || !anchor.getBoundingClientRect) return;
  var rect = anchor.getBoundingClientRect();
  var width = Math.min(276, window.innerWidth - 24);
  var left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
  el.style.width = width + 'px';
  el.style.left = left + 'px';
  el.style.bottom = Math.max(18, window.innerHeight - rect.top + 10) + 'px';
}
function closeControlSourceSwitcher() {
  var el = document.getElementById('control-source-switcher');
  controlSourceSwitcherState.open = false;
  controlSourceSwitcherState.loading = false;
  controlSourceSwitcherState.anchor = null;
  if (el) el.classList.remove('show', 'loading');
}
function controlSourceMatchSong(entry) {
  if (!entry) return null;
  if (entry.song) return entry.song;
  return entry.name ? entry : null;
}
function controlSourceMatchIssue(entry) {
  return entry && entry.issue ? entry.issue : 'no_source';
}
function renderControlSourceSwitcher(matches) {
  var el = ensureControlSourceSwitcher();
  var song = currentControlSong();
  var current = songProviderKey(song);
  matches = matches || {};
  el.classList.toggle('loading', !!controlSourceSwitcherState.loading);
  el.innerHTML =
    '<div class="control-source-switcher-head"><span>切换音源</span><small>' + (controlSourceSwitcherState.loading ? '正在匹配' : '保留当前进度') + '</small></div>' +
    '<div class="control-source-options">' +
    controlSourceProviders().map(function (provider) {
      var entry = matches[provider.key];
      var match = controlSourceMatchSong(entry);
      var issue = controlSourceMatchIssue(entry);
      var active = provider.key === current;
      var ready = active || !!match;
      var providerLimited = !!(match && provider.key === 'spotify' && match.playable === false);
      var cleanStatus = active ? '当前' : (providerLimited ? '匹配源' : (match ? '可切换' : (controlSourceSwitcherState.loading ? '检测中' : controlSourceIssueLabel(issue))));
      var title = active ? '当前音源' : (providerLimited ? (provider.title + ': 播放将自动换源') : (match ? ('切换到 ' + provider.title) : (provider.title + ': ' + controlSourceIssueLabel(issue))));
      return '<button type="button" class="control-source-option' + (active ? ' active' : '') + (!ready ? ' disabled' : '') + '" data-source-provider="' + provider.key + '" title="' + escHtml(title) + '" ' + (!ready ? 'disabled ' : '') + 'onclick="switchCurrentSongSource(\'' + provider.key + '\')">' +
        '<span class="tag-source ' + provider.key + '">' + provider.label + '</span>' +
        '<span class="control-source-option-title">' + provider.title + '</span>' +
        '<small>' + cleanStatus + '</small>' +
        '</button>';
    }).join('') +
    '</div>';
  controlSourcePositionSwitcher();
}
async function findControlSourceMatchResult(song, provider) {
  var query = controlSourceSwitchQuery(song);
  if (!query) return { song: null, issue: 'no_source' };
  var data = await apiJson(controlSourceSearchUrl(provider, query), { timeoutMs: 6000 });
  var list = data && (data.songs || data.result || []);
  if (!Array.isArray(list) || !list.length) return { song: null, issue: 'no_source' };
  var best = null;
  var bestScore = -Infinity;
  var bestIssue = 'no_source';
  for (var i = 0; i < list.length; i++) {
    var candidate = list[i];
    var issue = sourceCandidateRejectReason(song, candidate, provider);
    if (issue) {
      if (bestIssue === 'no_source' || issue === 'blocked_artist' || issue === 'artist_extra' || issue === 'artist_mismatch') bestIssue = issue;
      continue;
    }
    var score = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(candidate, query, i) : 0;
    if (typeof isSameTitleArtist === 'function' && isSameTitleArtist(song, candidate)) score += 120;
    if (candidate && candidate.playable === false) score -= 18;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore >= 24 ? { song: cloneSong(best), issue: '' } : { song: null, issue: bestIssue };
}
async function findControlSourceMatch(song, provider) {
  var strictResult = await findControlSourceMatchResult(song, provider);
  return strictResult && strictResult.song ? strictResult.song : null;
}
async function loadControlSourceMatches(song, requestId) {
  var matches = {};
  var providers = controlSourceProviders();
  await Promise.all(providers.map(async function (provider) {
    if (songProviderKey(song) === provider.key) {
      matches[provider.key] = { song: song, issue: '' };
      return;
    }
    try {
      matches[provider.key] = await findControlSourceMatchResult(song, provider.key);
    } catch (err) {
      console.warn('[SourceSwitchSearch]', provider.key, err);
      matches[provider.key] = { song: null, issue: 'no_source' };
    }
  }));
  if (requestId !== controlSourceSwitcherState.requestId || !controlSourceSwitcherState.open) return;
  controlSourceSwitcherState.loading = false;
  renderControlSourceSwitcher(matches);
  controlSourceSwitcherState.matches = matches;
}
function toggleControlSourceSwitcher(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  var song = currentControlSong();
  if (!song || song.type === 'local' || song.source === 'local' || song.localUrl || song.type === 'podcast') {
    showToast('当前歌曲不支持切换音源');
    return;
  }
  var anchor = e && e.currentTarget ? e.currentTarget : null;
  var el = ensureControlSourceSwitcher();
  if (controlSourceSwitcherState.open && controlSourceSwitcherState.anchor === anchor) {
    closeControlSourceSwitcher();
    return;
  }
  controlSourceSwitcherState.open = true;
  controlSourceSwitcherState.loading = true;
  controlSourceSwitcherState.anchor = anchor;
  controlSourceSwitcherState.requestId++;
  controlSourceSwitcherState.matches = {};
  var seed = {};
  seed[songProviderKey(song)] = { song: song, issue: '' };
  renderControlSourceSwitcher(seed);
  controlSourcePositionSwitcher(anchor);
  el.classList.add('show');
  loadControlSourceMatches(song, controlSourceSwitcherState.requestId);
}
async function switchCurrentSongSource(provider) {
  provider = (typeof normalizePlaybackProvider === 'function'
    ? normalizePlaybackProvider(provider)
    : (typeof normalizeMusicProviderKey === 'function' ? normalizeMusicProviderKey(provider) : provider));
  var song = currentControlSong();
  if (!song) return;
  var currentProvider = songProviderKey(song);
  var previousSong = cloneSong(song);
  if (provider === currentProvider) {
    closeControlSourceSwitcher();
    return;
  }
  var requestId = ++controlSourceSwitcherState.requestId;
  controlSourceSwitcherState.loading = true;
  renderControlSourceSwitcher(controlSourceSwitcherState.matches || {});
  try {
    var entry = controlSourceSwitcherState.matches && controlSourceSwitcherState.matches[provider];
    var match = controlSourceMatchSong(entry);
    var issue = controlSourceMatchIssue(entry);
    if (!match) {
      var lookup = await findControlSourceMatchResult(song, provider);
      match = lookup && lookup.song ? lookup.song : null;
      issue = lookup && lookup.issue ? lookup.issue : issue;
      if (controlSourceSwitcherState.matches) controlSourceSwitcherState.matches[provider] = lookup || { song: null, issue: issue || 'no_source' };
    }
    if (requestId !== controlSourceSwitcherState.requestId) return;
    if (!match) {
      showSourceFallbackNotice('未找到可切换音源', controlSourceProviderTitle(provider) + ' 暂时没有匹配到同名同歌手版本。');
      showSourceFallbackNotice('该平台无正版音源', controlSourceProviderTitle(provider) + ': ' + controlSourceIssueLabel(issue));
      controlSourceSwitcherState.loading = false;
      renderControlSourceSwitcher(controlSourceSwitcherState.matches || {});
      return;
    }
    match.manualSourceSwitchFrom = currentProvider;
    match.manualSourceSwitchAt = Date.now();
    playQueue[currentIdx] = hydrateCustomCover(match);
    closeControlSourceSwitcher();
    safeRenderQueuePanel('manual-source-switch', { scrollCurrent: miniQueueOpen });
    updateControlTrackInfo(playQueue[currentIdx]);
    showSourceFallbackNotice('正在切换音源', (song.name || '当前歌曲') + ' -> ' + controlSourceProviderTitle(provider));
    await playQueueAt(currentIdx, {
      manual: true,
      resumeAt: currentResumeSeconds(0),
      preserveHomeState: true,
      sourceSwitch: true
    });
  } catch (err) {
    console.warn('[SourceSwitch]', provider, err);
    if (currentIdx >= 0 && currentIdx < playQueue.length) {
      playQueue[currentIdx] = hydrateCustomCover(previousSong);
      safeRenderQueuePanel('manual-source-switch-restore', { scrollCurrent: miniQueueOpen });
      updateControlTrackInfo(playQueue[currentIdx]);
    }
    showSourceFallbackNotice('音源切换失败', '已保留当前播放队列，请稍后再试。');
  } finally {
    controlSourceSwitcherState.loading = false;
    forcePlaybackControlsInteractive();
  }
}
document.addEventListener('click', function (e) {
  var el = document.getElementById('control-source-switcher');
  if (!el || !controlSourceSwitcherState.open) return;
  if (el.contains(e.target)) return;
  if (controlSourceSwitcherState.anchor && controlSourceSwitcherState.anchor.contains && controlSourceSwitcherState.anchor.contains(e.target)) return;
  closeControlSourceSwitcher();
});
window.addEventListener('resize', function () {
  if (controlSourceSwitcherState.open) controlSourcePositionSwitcher();
});
var SOURCE_SWITCH_BLOCKED_ARTIST_TOKENS = ['asablue'];
var SOURCE_SWITCH_STRICT_ARTIST_ALIASES = [
  ['周杰伦', 'jaychou', 'zhoujielun']
];
function sourceSwitchArtistParts(song) {
  if (typeof artistNameParts === 'function') return artistNameParts(song);
  var parts = [];
  if (song && Array.isArray(song.artists)) {
    song.artists.forEach(function (a) { if (a && a.name) parts.push(a.name); });
  }
  if (song && song.artist) {
    String(song.artist).split(/\s*\/\s*|\s*,\s*|\s*&\s*| feat\.? | ft\.? /i).forEach(function (name) {
      if (name && name.trim()) parts.push(name.trim());
    });
  }
  return parts.map(simpleSearchNorm).filter(Boolean);
}
function sourceSwitchPartMatches(a, b) {
  return !!(a && b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0));
}
function sourceSwitchPartsOverlap(sourceParts, candidateParts) {
  return sourceParts.some(function (sourcePart) {
    return candidateParts.some(function (candidatePart) { return sourceSwitchPartMatches(sourcePart, candidatePart); });
  });
}
function sourceSwitchSongHasBlockedArtist(song) {
  var raw = String(((song && song.name) || '') + ' ' + ((song && song.artist) || '') + ' ' + ((song && song.album) || '')).toLowerCase();
  var norm = simpleSearchNorm(raw);
  return SOURCE_SWITCH_BLOCKED_ARTIST_TOKENS.some(function (token) {
    return raw.indexOf(token) >= 0 || norm.indexOf(simpleSearchNorm(token)) >= 0;
  });
}
function sourceSwitchStrictArtistRuleForSong(song) {
  var joined = sourceSwitchArtistParts(song).join('|');
  if (!joined) return null;
  for (var i = 0; i < SOURCE_SWITCH_STRICT_ARTIST_ALIASES.length; i++) {
    var aliases = SOURCE_SWITCH_STRICT_ARTIST_ALIASES[i];
    if (aliases.some(function (alias) { return joined.indexOf(simpleSearchNorm(alias)) >= 0; })) return aliases;
  }
  return null;
}
function sourceSwitchCandidateHasUnexpectedArtist(sourceParts, candidateParts) {
  if (!sourceParts.length || !candidateParts.length) return false;
  return candidateParts.some(function (candidatePart) {
    return !sourceParts.some(function (sourcePart) { return sourceSwitchPartMatches(sourcePart, candidatePart); });
  });
}
function sourceCandidateRejectReason(source, candidate, provider) {
  if (!source || !candidate) return 'no_source';
  var sourceTitle = simpleSearchNorm(source.name || source.title || '');
  var candidateTitle = simpleSearchNorm(candidate.name || candidate.title || '');
  if (!sourceTitle || !candidateTitle || sourceTitle !== candidateTitle) return 'title_mismatch';
  if (sourceSwitchSongHasBlockedArtist(candidate)) return 'blocked_artist';
  var raw = String(((candidate && candidate.name) || '') + ' ' + ((candidate && candidate.artist) || '') + ' ' + ((candidate && candidate.album) || '')).toLowerCase();
  if (searchLooksLikeDerivative(raw)) return 'derivative';
  var sourceParts = sourceSwitchArtistParts(source);
  var candidateParts = sourceSwitchArtistParts(candidate);
  if (!sourceParts.length || !candidateParts.length || !sourceSwitchPartsOverlap(sourceParts, candidateParts)) return 'artist_mismatch';
  if (sourceSwitchStrictArtistRuleForSong(source) && sourceSwitchCandidateHasUnexpectedArtist(sourceParts, candidateParts)) return 'artist_extra';
  return '';
}
function controlSourceIssueLabel(issue) {
  if (issue === 'blocked_artist' || issue === 'derivative') return '翻唱禁用';
  if (issue === 'artist_mismatch' || issue === 'artist_extra') return '非原唱版本';
  return '无正版音源';
}
function searchResultMetaText(song) {
  var bits = [];
  if (song.artist) bits.push(song.artist);
  if (song.album) bits.push(song.album);
  if (songProviderKey(song) === 'qq' && !song.playable) bits.push('QQ playback needs session');
  if (songProviderKey(song) === 'kugou' && !song.playable) bits.push('Kugou playback needs session');
  if (songProviderKey(song) === 'qishui' && !song.playable) bits.push('汽水匹配源 · 播放将自动换源');
  return bits.join('  ·  ') || songSourceLabel(song);
}
function searchResultMetaHtml(song, index) {
  song = song || {};
  var artist = String(song.artist || '').trim();
  var bits = [];
  if (song.album) bits.push(song.album);
  if (songProviderKey(song) === 'qq' && !song.playable) bits.push('QQ 播放需会话/授权');
  if (songProviderKey(song) === 'kugou' && !song.playable) bits.push('酷狗播放需会话/授权');
  if (songProviderKey(song) === 'qishui' && !song.playable) bits.push('汽水匹配源，播放会自动换源');
  var tail = bits.length ? (' · ' + escHtml(bits.join('  ·  '))) : '';
  if (!artist) return escHtml(searchResultMetaText(song));
  return '<button class="search-artist-link" type="button" onclick="event.stopPropagation();openSearchResultArtist(' + index + ')">' + escHtml(artist) + '</button>' + tail;
}
function openSearchResultArtist(index) {
  var song = playlist && playlist[index];
  if (!song) return;
  openArtistDetailForSong(song);
}
function searchIntentPrefersQQ(q) {
  q = String(q || '').toLowerCase();
  return /(^|\s)qq($|\s)|qq音乐|qq音樂|周杰伦|周杰倫|jay\s*chou|jay/.test(q);
}
function simpleSearchNorm(text) {
  return String(text || '').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・,，。.!！?？'"“”‘’|\-_/]+/g, '');
}
function searchMentionsKnownArtist(q, artist) {
  var rawQ = String(q || '').toLowerCase();
  var rawArtist = String(artist || '').toLowerCase();
  if (!rawArtist) return false;
  if (/周杰伦|周杰倫|jay\s*chou/.test(rawQ) && /周杰伦|周杰倫|jay\s*chou/.test(rawArtist)) return true;
  var nq = simpleSearchNorm(q);
  var na = simpleSearchNorm(artist);
  return !!(na && na.length >= 2 && nq.indexOf(na) >= 0);
}
function searchLooksLikeDerivative(text) {
  return /(翻唱|cover|伴奏|instrumental|remix|片段|demo|女声|男声|karaoke|完整版\s*cover|抖音版|dj版|合唱版|改编版|赵露思版|超燃|硬曲|剪辑|二创|tribute|made\s*famous\s*by)/i.test(String(text || ''));
}
var SEARCH_ORIGINAL_ARTIST_HINTS = [
  { titles: ['日落大道'], artists: ['梁博'] },
  { titles: ['beautyandabeat', 'beauty and a beat'], artists: ['justin bieber', 'nicki minaj'] }
];
function canonicalOriginalArtistsForSearch(q, song) {
  var qNorm = simpleSearchNorm(q);
  var titleNorm = simpleSearchNorm(song && song.name);
  var joined = qNorm + ' ' + titleNorm;
  var artists = [];
  SEARCH_ORIGINAL_ARTIST_HINTS.forEach(function(rule){
    var matched = (rule.titles || []).some(function(title){
      var nt = simpleSearchNorm(title);
      var titleMatches = !!(titleNorm && (titleNorm === nt || titleNorm.indexOf(nt) >= 0));
      return !!(nt && (qNorm.indexOf(nt) >= 0 || titleMatches));
    });
    if (matched) {
      (rule.artists || []).forEach(function(artist){
        if (artists.indexOf(artist) < 0) artists.push(artist);
      });
    }
  });
  return artists;
}
function songArtistMatchesAny(song, artists) {
  var songArtist = simpleSearchNorm(song && song.artist);
  if (!songArtist || !artists || !artists.length) return false;
  return artists.some(function(artist){
    var na = simpleSearchNorm(artist);
    return !!(na && (songArtist.indexOf(na) >= 0 || na.indexOf(songArtist) >= 0));
  });
}
function searchLooksLikeSameTitleCover(song, nq, name, album, raw, originalArtistMatch, sourceIndex) {
  if (!song || !nq || !name || originalArtistMatch) return false;
  var sameTitle = name === nq || nq.indexOf(name) >= 0 || name.indexOf(nq) === 0;
  if (!sameTitle) return false;
  var selfTitledSingle = !!(album && (album === name || album === nq || album.indexOf(name) >= 0 || name.indexOf(album) >= 0));
  return selfTitledSingle || searchLooksLikeDerivative(raw) || (sourceIndex || 0) > 0;
}
function scoreSongSearchResult(song, q, sourceIndex) {
  var nq = simpleSearchNorm(q);
  var name = simpleSearchNorm(song && song.name);
  var artist = simpleSearchNorm(song && song.artist);
  var album = simpleSearchNorm(song && song.album);
  var raw = String(((song && song.name) || '') + ' ' + ((song && song.artist) || '') + ' ' + ((song && song.album) || '')).toLowerCase();
  var qAsksDerivative = /(live|现场|翻唱|cover|伴奏|instrumental|remix|dj|片段|demo|女声|男声|karaoke)/i.test(String(q || ''));
  var derivative = searchLooksLikeDerivative(raw);
  var artistMentioned = searchMentionsKnownArtist(q, song && song.artist);
  var originalArtists = canonicalOriginalArtistsForSearch(q, song);
  var originalArtistMatch = songArtistMatchesAny(song, originalArtists);
  var score = 0;
  if (name === nq) score += 90;
  else if (name.indexOf(nq) === 0) score += 55;
  else if (name.indexOf(nq) >= 0) score += 32;
  if (name && nq && nq.indexOf(name) >= 0) score += name.length >= 2 ? 68 : 18;
  if (originalArtistMatch && name && nq && (name === nq || nq.indexOf(name) >= 0 || name.indexOf(nq) >= 0)) score += 122;
  else if (!qAsksDerivative && originalArtists.length && name && nq && (name === nq || nq.indexOf(name) >= 0 || name.indexOf(nq) >= 0)) score -= 58;
  if (artistMentioned) score += 96;
  else if (artist && nq && nq.indexOf(artist) >= 0) score += 64;
  else if (artist && artist.indexOf(nq) >= 0) score += 22;
  if (artistMentioned && name && nq.indexOf(name) >= 0) score += 34;
  if (/周杰伦|周杰倫|jay\s*chou/i.test(String(q || '')) && !artistMentioned) score -= 28;
  if (album && nq && (album.indexOf(nq) >= 0 || nq.indexOf(album) >= 0)) score += 8;
  if (songProviderKey(song) === 'qq') score += searchIntentPrefersQQ(q) ? 48 : 4;
  if (song && song.playable === false) score -= 12;
  if (!qAsksDerivative) {
    if (derivative) score -= artistMentioned ? 76 : 96;
    if (/(live|现场)/i.test(raw)) score -= artistMentioned ? 28 : 42;
    if (originalArtists.length && searchLooksLikeSameTitleCover(song, nq, name, album, raw, originalArtistMatch, sourceIndex)) score -= 46;
  }
  score -= (sourceIndex || 0) * 0.75;
  return score;
}
function mergeSongSearchResults(neteaseSongs, qqSongs, limit, q) {
  var out = [];
  var seen = {};
  function push(song, sourceIndex) {
    if (!song || !song.name) return;
    var key = songProviderKey(song) + ':' + (song.mid || song.id || (song.name + '|' + song.artist));
    if (seen[key]) return;
    seen[key] = true;
    song._searchScore = scoreSongSearchResult(song, q, sourceIndex);
    out.push(song);
  }
  (neteaseSongs || []).forEach(function(song, i){ push(song, i); });
  (qqSongs || []).forEach(function(song, i){ push(song, i); });
  out.sort(function(a, b){ return (b._searchScore || 0) - (a._searchScore || 0); });
  return out.slice(0, limit);
}
async function fetchMusicSearchResults(q, mode) {
  var searchUrl = typeof searchProviderUrl === 'function' ? searchProviderUrl : null;
  if (mode === 'qq') {
    var qqOnly = await apiJson(searchUrl ? searchUrl('qq', q, 12, 0) : ('/api/qq/search?keywords=' + encodeURIComponent(q) + '&limit=12'));
    return mergeSongSearchResults([], qqOnly.songs || [], 18, q);
  }
  if (mode === 'netease') {
    var neOnly = await apiJson(searchUrl ? searchUrl('netease', q, 18, 0) : ('/api/search?keywords=' + encodeURIComponent(q) + '&limit=18'));
    return mergeSongSearchResults(neOnly.songs || [], [], 18, q);
  }
  if (mode === 'qishui') {
    var qsOnly = await apiJson(searchUrl ? searchUrl('qishui', q, 18, 0) : ('/api/qishui/search?keywords=' + encodeURIComponent(q) + '&limit=18'));
    return (qsOnly.songs || []).slice(0, 18);
  }
  if (mode === 'kugou') {
    var kgOnly = await apiJson(searchUrl ? searchUrl('kugou', q, 18, 0) : ('/api/kugou/search?keywords=' + encodeURIComponent(q) + '&limit=18'));
    return (kgOnly.songs || []).slice(0, 18);
  }
  if (mode === 'spotify') {
    var spOnly = await apiJson(searchUrl ? searchUrl('spotify', q, 18, 0) : ('/api/spotify/search?keywords=' + encodeURIComponent(q) + '&limit=18'));
    return (spOnly.songs || []).slice(0, 18);
  }
  var result = await Promise.allSettled([
    apiJson(searchUrl ? searchUrl('netease', q, 14, 0) : ('/api/search?keywords=' + encodeURIComponent(q) + '&limit=14')),
    apiJson(searchUrl ? searchUrl('qq', q, 12, 0) : ('/api/qq/search?keywords=' + encodeURIComponent(q) + '&limit=12'))
  ]);
  var neteaseSongs = result[0].status === 'fulfilled' ? ((result[0].value && result[0].value.songs) || []) : [];
  var qqSongs = result[1].status === 'fulfilled' ? ((result[1].value && result[1].value.songs) || []) : [];
  if (result[1].status === 'rejected') console.warn('QQ search failed:', result[1].reason);
  return mergeSongSearchResults(neteaseSongs, qqSongs, 18, q);
}
function renderSongSearchResults(songs) {
  playlist = songs || [];
  $results.innerHTML = playlist.map(function(s, i){
    var vipTag = (s.fee === 1) ? '<span class="tag-vip">VIP</span>' : '';
    var sourceTag = songSourceTagHtml(s);
    var sourceClass = songProviderKey(s) + '-source';
    var thumb = songCoverSrc(s, 80);
    var imgTag = thumb
      ? imgTagFromSrc(thumb, 'loading="lazy" onerror="this.style.opacity=0.2"')
      : '<div style="width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>';
    return '<div class="search-result ' + sourceClass + '">' +
      '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0" onclick="playSearchResult(' + i + ')">' +
        imgTag +
        '<div class="search-result-info">' +
          '<div class="search-result-title">' + escHtml(s.name) + sourceTag + vipTag + '</div>' +
          '<div class="search-result-meta">' + searchResultMetaHtml(s, i) + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="song-action-btn' + (isSongLiked(s) ? ' liked' : '') + '" data-like-index="' + i + '" title="' + (isSongLiked(s) ? '取消红心' : '红心喜欢') + '" onclick="event.stopPropagation();toggleLikeSearchResult(' + i + ')">' + heartIconSvg() + '</button>' +
      '<button class="song-action-btn" title="收藏到歌单" onclick="event.stopPropagation();collectSearchResult(' + i + ')">' + playlistPlusIconSvg() + '</button>' +
      '<button class="add-btn" title="下一首播放" onclick="event.stopPropagation();queueSearchResult(' + i + ')">+</button>' +
    '</div>';
  }).join('');
  $results.classList.add('show');
  syncLikeStatusForSongs(playlist);
  if (window.gsap) animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
}

async function doSearch(q, opts) {
  opts = opts || {};
  q = String(q || '').trim();
  if (!q) {
    if (searchMode === 'podcast') loadPodcastHot();
    else renderSearchHistory();
    return;
  }
  if (searchMode === 'podcast') {
    doPodcastSearch(q);
    return;
  }
  var requestSeq = ++searchRequestSeq;
  try {
    var mode = searchMode;
    var songs = await fetchMusicSearchResults(q, mode);
    if (requestSeq !== searchRequestSeq || $input.value.trim() !== q) return;
    if (!songs.length) {
      playlist = [];
      searchLastResultQuery = '';
      $results.innerHTML = searchEmptyHtml('没有找到相关歌曲');
      $results.classList.add('show');
      return;
    }
    searchLastResultQuery = searchResultKey(q, mode);
    rememberSearchQuery(q);
    renderSongSearchResults(songs);
    if (opts.autoPlayFirst) playSearchResult(0);
  } catch (err) { console.error('Search:', err); }
}

