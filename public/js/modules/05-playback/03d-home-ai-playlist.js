// =============================================================================
// AI 歌单推荐（云端 LLM 增强 / 9.15）
// - openAiPlaylistModal()        打开 AI 歌单弹窗
// - generateAiPlaylist()         调用 /api/ai/playlist 生成歌单
// - saveAiPlaylistConfig()       保存 LLM API Key / baseUrl / model
// 入口：首页「听歌画像」卡片 → AI 歌单按钮；或 openAiPlaylistModal()
// =============================================================================

var _aiPlaylistState = {
  loading: false,
  songs: [],
  config: null,
};

function _buildAiProfile() {
  try {
    if (typeof listenStatsState === 'undefined' || !listenStatsState) return null;
    var summary = (typeof homeListenSummary === 'function') ? homeListenSummary() : null;
    if (!summary) return null;
    var topSongs = [];
    var topArtists = [];
    // 取 Top 5 歌曲
    if (listenStatsState.songs) {
      topSongs = Object.keys(listenStatsState.songs).map(function (key) {
        var s = listenStatsState.songs[key];
        return s ? { name: s.name, artist: s.artist, plays: s.plays || 0, listenMs: s.listenMs || 0 } : null;
      }).filter(Boolean).sort(function (a, b) {
        return (b.plays || 0) - (a.plays || 0) || (b.listenMs || 0) - (a.listenMs || 0);
      }).slice(0, 5);
    }
    // 取 Top 5 歌手
    if (listenStatsState.artists) {
      topArtists = Object.keys(listenStatsState.artists).map(function (name) {
        var a = listenStatsState.artists[name];
        return a ? { name: name, plays: a.plays || 0, listenMs: a.listenMs || 0 } : null;
      }).filter(Boolean).sort(function (a, b) {
        return (b.plays || 0) - (a.plays || 0) || (b.listenMs || 0) - (a.listenMs || 0);
      }).slice(0, 5);
    }
    if (!topSongs.length && !topArtists.length) return null;
    return { topSongs: topSongs, topArtists: topArtists, totalPlays: summary.totalPlays || 0 };
  } catch (_) {
    return null;
  }
}

function _renderAiPlaylistResults() {
  var container = document.getElementById('ai-playlist-results');
  if (!container) return;
  if (_aiPlaylistState.loading) {
    container.innerHTML = '<div class="ai-playlist-loading"><div class="ai-playlist-spinner"></div><span>AI 正在为你挑选歌曲…</span></div>';
    return;
  }
  var songs = _aiPlaylistState.songs;
  if (!songs.length) {
    container.innerHTML = '<div class="ai-playlist-empty">输入你的心情或场景，让 AI 为你生成歌单</div>';
    return;
  }
  container.innerHTML = songs.map(function (song, i) {
    var title = (typeof escHtml === 'function') ? escHtml(song.title) : song.title;
    var artist = (typeof escHtml === 'function') ? escHtml(song.artist || '') : (song.artist || '');
    var reason = (typeof escHtml === 'function') ? escHtml(song.reason || '') : (song.reason || '');
    return '<div class="ai-playlist-item">' +
      '<div class="ai-playlist-item-index">' + (i + 1) + '</div>' +
      '<div class="ai-playlist-item-info">' +
        '<div class="ai-playlist-item-title">' + title + (artist ? ' <span class="ai-playlist-item-artist">— ' + artist + '</span>' : '') + '</div>' +
        (reason ? '<div class="ai-playlist-item-reason">' + reason + '</div>' : '') +
      '</div>' +
      '<button class="ai-playlist-item-btn" type="button" onclick="searchAiPlaylistSong(' + i + ')">搜索播放</button>' +
    '</div>';
  }).join('');
}

function searchAiPlaylistSong(index) {
  var song = _aiPlaylistState.songs[index];
  if (!song) return;
  var query = song.title + (song.artist ? ' ' + song.artist : '');
  closeAiPlaylistModal();
  if (typeof showToast === 'function') showToast('搜索: ' + query);
  var input = document.getElementById('search-input');
  if (input) {
    input.value = query;
    input.focus();
  }
  if (typeof doSearch === 'function') doSearch(query);
}

async function generateAiPlaylist() {
  if (_aiPlaylistState.loading) return;
  var promptInput = document.getElementById('ai-playlist-prompt');
  var prompt = (promptInput && promptInput.value || '').trim();
  if (!prompt) {
    if (typeof showToast === 'function') showToast('请输入你想听的场景或心情');
    if (promptInput) promptInput.focus();
    return;
  }
  _aiPlaylistState.loading = true;
  _aiPlaylistState.songs = [];
  _renderAiPlaylistResults();
  var btn = document.getElementById('ai-playlist-generate-btn');
  if (btn) btn.disabled = true;
  try {
    var profile = _buildAiProfile();
    var data = await apiJson('/api/ai/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, profile: profile }),
      timeoutMs: 35000,
    });
    _aiPlaylistState.songs = (data && data.songs) || [];
    if (!_aiPlaylistState.songs.length) {
      if (typeof showToast === 'function') showToast('未能生成推荐，请重试');
    } else if (data && data.engine === 'llm') {
      if (typeof showToast === 'function') showToast('AI 推荐了 ' + _aiPlaylistState.songs.length + ' 首歌');
    } else {
      if (typeof showToast === 'function') showToast('本地智能推荐 ' + _aiPlaylistState.songs.length + ' 首歌（配置 LLM 可获得更强个性化）');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('AI 歌单生成失败: ' + (e.message || e));
    var container = document.getElementById('ai-playlist-results');
    if (container) container.innerHTML = '<div class="ai-playlist-error">生成失败：' + (typeof escHtml === 'function' ? escHtml(e.message || String(e)) : (e.message || e)) + '</div>';
  } finally {
    _aiPlaylistState.loading = false;
    if (btn) btn.disabled = false;
    _renderAiPlaylistResults();
  }
}

async function loadAiPlaylistConfig() {
  try {
    var data = await apiJson('/api/ai/config', { method: 'GET' });
    _aiPlaylistState.config = data;
    var statusEl = document.getElementById('ai-playlist-config-status');
    if (statusEl) {
      statusEl.textContent = data.configured ? 'LLM 增强已启用 ✓' : '本地智能推荐 · 无需配置';
      statusEl.className = 'ai-playlist-config-status' + (data.configured ? ' configured' : '');
    }
    var urlInput = document.getElementById('ai-playlist-baseurl');
    if (urlInput) urlInput.value = data.baseUrl || '';
    var modelInput = document.getElementById('ai-playlist-model');
    if (modelInput) modelInput.value = data.model || '';
    // LLM 是可选增强，未配置不再自动展开配置区（默认本地引擎即可用）
  } catch (_) {}
}

async function saveAiPlaylistConfig() {
  var urlInput = document.getElementById('ai-playlist-baseurl');
  var modelInput = document.getElementById('ai-playlist-model');
  var keyInput = document.getElementById('ai-playlist-apikey');
  var payload = {
    baseUrl: (urlInput && urlInput.value || '').trim(),
    model: (modelInput && modelInput.value || '').trim(),
    apiKey: (keyInput && keyInput.value || '').trim(),
  };
  if (!payload.baseUrl) { if (typeof showToast === 'function') showToast('请填写 API Base URL'); return; }
  try {
    await apiJson('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (keyInput) keyInput.value = '';
    if (typeof showToast === 'function') showToast('配置已保存');
    loadAiPlaylistConfig();
  } catch (e) {
    if (typeof showToast === 'function') showToast('保存失败: ' + (e.message || e));
  }
}

function toggleAiPlaylistConfig() {
  var panel = document.getElementById('ai-playlist-config-panel');
  if (panel) panel.classList.toggle('open');
}

function openAiPlaylistModal() {
  var modal = document.getElementById('ai-playlist-modal');
  if (!modal) return;
  modal.classList.add('show');
  if (typeof closeHomeInsightDock === 'function') closeHomeInsightDock();
  loadAiPlaylistConfig();
  _renderAiPlaylistResults();
  setTimeout(function () {
    var input = document.getElementById('ai-playlist-prompt');
    if (input) input.focus();
  }, 100);
}

function closeAiPlaylistModal() {
  var modal = document.getElementById('ai-playlist-modal');
  if (modal) modal.classList.remove('show');
}

function _fillAiPrompt(text) {
  var input = document.getElementById('ai-playlist-prompt');
  if (input) {
    input.value = text;
    input.focus();
  }
}

// ---- 全部加入队列：逐首搜索解析为真实曲目后入队 ----
async function _resolveAiPlaylistSong(song) {
  var query = (song.title + (song.artist ? ' ' + song.artist : '')).trim();
  if (!query) return null;
  var url = (typeof searchProviderUrl === 'function')
    ? searchProviderUrl('netease', query, 3, 0)
    : ('/api/search?keywords=' + encodeURIComponent(query) + '&limit=3');
  var data = await apiJson(url, { timeoutMs: 8000 });
  var list = data && (data.songs || data.result || []);
  if (!Array.isArray(list) || !list.length) return null;
  for (var i = 0; i < list.length; i++) {
    if (typeof isSameTitleArtist === 'function' &&
        isSameTitleArtist({ name: song.title, artist: song.artist }, list[i])) return list[i];
  }
  return list[0];
}

// ---- 逐首搜索解析：入队 / 存为歌单共用 ----
async function _resolveAiPlaylistSongs(songs, onProgress) {
  var resolved = [];
  for (var i = 0; i < songs.length; i++) {
    try {
      var hit = await _resolveAiPlaylistSong(songs[i]);
      if (hit) resolved.push(hit);
    } catch (_) {}
    if (onProgress) onProgress(i + 1, songs.length);
  }
  return resolved;
}

var _aiQueueAllBusy = false;
async function queueAllAiPlaylistSongs() {
  if (_aiQueueAllBusy) return;
  var songs = (_aiPlaylistState.songs || []).slice();
  if (!songs.length) {
    if (typeof showToast === 'function') showToast('先生成 AI 歌单，再加入队列');
    return;
  }
  _aiQueueAllBusy = true;
  var btn = document.getElementById('ai-playlist-queue-btn');
  if (btn) { btn.disabled = true; btn.textContent = '解析中…'; }
  try {
    var resolved = await _resolveAiPlaylistSongs(songs, function (done, total) {
      if (btn) btn.textContent = '加入队列 ' + done + '/' + total;
    });
    var added = 0;
    if (typeof queueSong === 'function') {
      resolved.forEach(function (s) { if (queueSong(s) >= 0) added++; });
    }
    if (typeof showToast === 'function') {
      showToast('已加入 ' + added + ' 首到播放队列' + (songs.length > added ? '（' + (songs.length - added) + ' 首未匹配/重复）' : ''));
    }
  } finally {
    _aiQueueAllBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '全部加入队列'; }
  }
}

// ---- 存为本地歌单：解析为可播放曲目后落库，左侧「歌单」面板「本地歌单」分组查看 ----
var _aiSaveBusy = false;
async function saveAiPlaylistToLocal() {
  if (_aiSaveBusy) return;
  var songs = (_aiPlaylistState.songs || []).slice();
  if (!songs.length) {
    if (typeof showToast === 'function') showToast('先生成 AI 歌单，再保存');
    return;
  }
  if (typeof createLocalPlaylist !== 'function') return;
  var nameInput = document.getElementById('ai-playlist-save-name');
  var name = (nameInput && nameInput.value || '').trim();
  if (!name) {
    var promptInput = document.getElementById('ai-playlist-prompt');
    name = (promptInput && promptInput.value || '').trim().slice(0, 24) || 'AI 歌单';
  }
  _aiSaveBusy = true;
  var btn = document.getElementById('ai-playlist-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '解析中…'; }
  try {
    var resolved = await _resolveAiPlaylistSongs(songs, function (done, total) {
      if (btn) btn.textContent = '解析 ' + done + '/' + total;
    });
    if (!resolved.length) {
      if (typeof showToast === 'function') showToast('没有匹配到可播放的歌曲，保存取消');
      return;
    }
    var pl = createLocalPlaylist(name, resolved);
    if (!pl) return;
    if (nameInput) nameInput.value = '';
    if (typeof renderUserPlaylistsList === 'function' && document.getElementById('pl-list')) {
      try { renderUserPlaylistsList({ reset: true }); } catch (_) {}
    }
    if (typeof showToast === 'function') {
      showToast('已保存本地歌单「' + pl.name + '」· ' + resolved.length + ' 首（左侧歌单面板查看）');
    }
  } finally {
    _aiSaveBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '存为歌单'; }
  }
}
