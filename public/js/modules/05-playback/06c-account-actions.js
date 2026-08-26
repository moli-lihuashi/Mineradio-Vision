var audioOutputDevices = [];
var audioInputDevices = [];
async function refreshAudioOutputDevices(showNotice) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    audioOutputDevices = [];
    if (showNotice) showToast('当前环境不支持输出接口选择');
    return;
  }
  try {
    var devices = await navigator.mediaDevices.enumerateDevices();
    audioOutputDevices = devices.filter(function(d) { return d && d.kind === 'audiooutput' && d.deviceId !== 'default'; });
    audioInputDevices = devices.filter(function(d) { return d && d.kind === 'audioinput' && d.deviceId !== 'default'; });
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('输出接口已刷新');
  } catch (e) {
    audioOutputDevices = [];
    if (showNotice) showToast('输出接口读取失败');
  }
}
function renderAudioOutputDeviceUi() {
  var list = document.getElementById('audio-output-list');
  if (!list) return;
  if (!audioOutputDevices.length) {
    list.innerHTML = '<div class="audio-output-item muted">未检测到输出设备</div>';
    return;
  }
  list.innerHTML = audioOutputDevices.map(function(d) {
    return '<div class="audio-output-item" title="' + escAttr(d.label || d.deviceId) + '">' +
      '<span>' + escHtml(d.label || '未知设备') + '</span>' +
      '<small>' + escHtml(d.groupId ? '已连接' : '') + '</small></div>';
  }).join('');
}
function openAudioOutputWorkflowPanel() {
  refreshAudioOutputDevices(false);
  showToast('输出接口面板：当前 ' + (audioOutputDevices.length || 0) + ' 个设备可用');
}
function openCustomLyricModal() {
  var song = currentLyricSong();
  if (!song) {
    showToast('先播放或选择一首歌');
    return;
  }
  if (immersiveMode) setImmersiveMode(false);
  var entry = getCustomLyricEntry(song);
  var title = document.getElementById('custom-lyric-title');
  var sub = document.getElementById('custom-lyric-sub');
  var input = document.getElementById('custom-lyric-input');
  if (title) title.textContent = song.name || '当前歌曲';
  if (sub) sub.textContent = (song.artist || (song.type === 'podcast' ? 'Podcast' : '')) + (entry ? ' · 已保存自定义歌词' : ' · 可粘贴 LRC 或逐行输入');
  if (input) input.value = entry ? (entry.text || '') : '';
  setCustomLyricStatus(entry ? '已读取本地自定义歌词' : '提示：带 [00:12.00] 时间轴会更精准；纯文本会自动铺开', entry ? 'good' : '');
  openGsapModal(document.getElementById('custom-lyric-modal'));
  setTimeout(function(){ if (input) input.focus(); }, 120);
}
function closeCustomLyricModal() {
  closeGsapModal(document.getElementById('custom-lyric-modal'));
}
function saveCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  var input = document.getElementById('custom-lyric-input');
  var text = input ? String(input.value || '').trim() : '';
  if (!song || !key) {
    setCustomLyricStatus('请先播放或选择一首歌', 'fail');
    showToast('先播放或选择一首歌');
    return;
  }
  if (!text) {
    setCustomLyricStatus('请输入歌词内容', 'fail');
    return;
  }
  var lines = parseCustomLyricText(text);
  if (!lines.length) {
    setCustomLyricStatus('没有识别到可显示的歌词行', 'fail');
    return;
  }
  customLyricMap[key] = { text: text, updatedAt: Date.now() };
  customLyricPrefs[key] = 'custom';
  var saved = saveCustomLyricMap();
  saveCustomLyricPrefs();
  applyCustomLyricState(song, true);
  setCustomLyricStatus(saved ? ('已保存 ' + lines.length + ' 行，并切换为自定义歌词') : '已应用，但本地存储空间不足', saved ? 'good' : 'fail');
  showToast(saved ? '自定义歌词已保存' : '自定义歌词已应用');
  setTimeout(function(){ closeCustomLyricModal(); }, 520);
}
function deleteCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  if (!song || !key) {
    setCustomLyricStatus('请先播放或选择一首歌', 'fail');
    return;
  }
  if (!customLyricMap[key]) {
    setCustomLyricStatus('当前歌曲没有自定义歌词', 'fail');
    return;
  }
  delete customLyricMap[key];
  delete customLyricPrefs[key];
  saveCustomLyricMap();
  saveCustomLyricPrefs();
  applyOriginalLyricsState();
  var input = document.getElementById('custom-lyric-input');
  if (input) input.value = '';
  setCustomLyricStatus('已删除，恢复原歌词', 'good');
  showToast('已恢复原歌词');
}
var QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED = true;
var QISHUI_PLAYLIST_WRITE_ACTIONS_ENABLED = true;
var SONG_ACCOUNT_ACTION_ADAPTERS = {
  netease: {
    provider: 'netease', label: '网易云音乐', like: true, collect: true, createPlaylist: true,
    likeCheckUrl: '/api/song/like/check', likeCheckParam: 'ids', likeUrl: '/api/song/like',
    playlistAddUrl: '/api/playlist/add-song', playlistCreateUrl: '/api/playlist/create', playlistTracksUrl: '/api/playlist/tracks'
  },
  kugou: {
    provider: 'kugou', label: '酷狗音乐', like: true, collect: true, createPlaylist: false,
    likeCheckUrl: '/api/kugou/song/like/check', likeCheckParam: 'hashes', likeUrl: '/api/kugou/song/like',
    playlistAddUrl: '/api/kugou/playlist/add-song', playlistCreateUrl: '', playlistTracksUrl: '/api/kugou/playlist/tracks'
  },
  qishui: {
    provider: 'qishui', label: '汽水音乐',
    like: QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED, collect: QISHUI_PLAYLIST_WRITE_ACTIONS_ENABLED, createPlaylist: false,
    likeCheckUrl: QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED ? '/api/qishui/song/like/check' : '',
    likeCheckParam: 'ids',
    likeUrl: QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED ? '/api/qishui/song/like' : '',
    playlistAddUrl: QISHUI_PLAYLIST_WRITE_ACTIONS_ENABLED ? '/api/qishui/playlist/add-song' : '',
    playlistCreateUrl: '', playlistTracksUrl: '/api/qishui/playlist/tracks'
  },
  spotify: {
    provider: 'spotify', label: 'Spotify', like: true, collect: true, createPlaylist: true,
    likeCheckUrl: '/api/spotify/song/like/check', likeCheckParam: 'ids', likeUrl: '/api/spotify/song/like',
    playlistAddUrl: '/api/spotify/playlist/add-song', playlistCreateUrl: '/api/spotify/playlist/create', playlistTracksUrl: '/api/spotify/playlist/tracks'
  },
  qq: { provider: 'qq', label: 'QQ 音乐', like: false, collect: false, createPlaylist: false, readOnly: true }
};
function songAccountProvider(song) {
  if (!song || song.type === 'local' || song.type === 'podcast' || song.source === 'podcast') return 'local';
  if (typeof songProviderKey === 'function') return songProviderKey(song);
  if (song.provider === 'spotify' || song.source === 'spotify' || song.type === 'spotify') return 'spotify';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq';
  if (song.provider === 'qishui' || song.source === 'qishui' || song.type === 'qishui') return 'qishui';
  if (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash) return 'kugou';
  return 'netease';
}
function songAccountAdapter(songOrProvider) {
  var provider = typeof songOrProvider === 'string' ? songOrProvider : songAccountProvider(songOrProvider);
  return SONG_ACCOUNT_ACTION_ADAPTERS[provider] || null;
}
function songAccountIdentityValues(song, provider) {
  song = song || {};
  provider = provider || songAccountProvider(song);
  var raw = [];
  if (provider === 'kugou') raw = [song.hash, song.audioHash, song.fileHash, song.providerSongId, song.id];
  else if (provider === 'spotify') {
    raw = [song.spotifyId, song.providerSongId, song.id];
    var uri = String(song.spotifyUri || song.uri || '');
    if (/^spotify:track:/i.test(uri)) raw.push(uri.split(':').pop());
  } else if (provider === 'qishui') raw = [song.providerSongId, song.trackId, song.track_id, song.id];
  else raw = [song.id];
  var seen = Object.create(null);
  return raw.map(function (value) {
    var normalized = String(value == null ? '' : value).trim();
    return provider === 'kugou' ? normalized.toLowerCase() : normalized;
  }).filter(function (value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}
function songAccountId(song, provider) {
  return songAccountIdentityValues(song, provider)[0] || '';
}
function songAccountStateKey(song) {
  var provider = songAccountProvider(song);
  var id = songAccountId(song, provider);
  return provider && id ? (provider + ':' + id) : '';
}
function playlistAccountProvider(playlist) {
  var provider = String(playlist && (playlist.provider || playlist.source) || '').toLowerCase();
  return /^(netease|qq|kugou|qishui|spotify)$/.test(provider) ? provider : 'netease';
}
function songAccountLoginStatus(provider) {
  if (provider === 'spotify') return typeof spotifyLoginStatus !== 'undefined' ? spotifyLoginStatus : {};
  if (provider === 'qishui') return typeof qishuiLoginStatus !== 'undefined' ? qishuiLoginStatus : {};
  if (provider === 'kugou') return typeof kugouLoginStatus !== 'undefined' ? kugouLoginStatus : {};
  if (provider === 'qq') return typeof qqLoginStatus !== 'undefined' ? qqLoginStatus : {};
  return typeof loginStatus !== 'undefined' ? loginStatus : {};
}
function isSongAccountLoggedIn(provider) {
  var status = songAccountLoginStatus(provider) || {};
  if (provider === 'kugou') return !!(status.loggedIn && status.playbackKeyReady);
  if (provider === 'qishui') return !!(status.loggedIn && (status.webSession || status.cookieReady));
  return !!status.loggedIn;
}
function songAccountUnsupportedMessage(provider, action) {
  var adapter = songAccountAdapter(provider);
  if (adapter && adapter.readOnly) return adapter.label + '当前仅支持读取账号收藏，暂不支持写回';
  if (provider === 'qishui') return '汽水音乐当前会话暂不支持此账号操作（需本机汽水登录态）';
  if (provider === 'local') return '本地文件暂不支持同步' + (action === 'collect' ? '到歌单' : '红心');
  return (adapter && adapter.label || '当前平台') + '暂不支持此操作';
}
function isCloudSong(song) {
  return !!(song && songAccountProvider(song) === 'netease' && song.id);
}
function isSongLiked(song) {
  var key = songAccountStateKey(song);
  if (key && likedSongMap[key]) return true;
  if (songAccountProvider(song) === 'netease' && song && song.id && likedSongMap[String(song.id)]) return true;
  return false;
}
function ensureLoggedInForAction(provider) {
  provider = provider || 'netease';
  if (isSongAccountLoggedIn(provider)) return true;
  var adapter = songAccountAdapter(provider);
  showToast('登录' + (adapter && adapter.label || '对应平台') + '后可同步账号收藏');
  showLoginModal({ provider: provider });
  return false;
}
function updateLikeButtons(song) {
  song = song || currentCoverSong();
  var liked = isSongLiked(song);
  var stateKey = songAccountStateKey(song);
  var busy = !!(stateKey && likeBusyMap[stateKey]);
  var btn = document.getElementById('heart-btn');
  if (btn) {
    btn.classList.toggle('liked', liked);
    btn.classList.toggle('busy', busy);
    btn.title = liked ? '取消红心' : '红心喜欢';
  }
  var collectBtn = document.getElementById('collect-btn');
  if (collectBtn) collectBtn.classList.toggle('busy', collectBusy);
}
function heartIconSvg() {
  return '<svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.45c-.32 0-.62-.12-.86-.34l-1.23-1.12C5.54 16.03 2.25 13.05 2.25 8.9 2.25 5.48 4.88 2.9 8.28 2.9c1.7 0 3.35.72 4.52 1.96C13.97 3.62 15.62 2.9 17.32 2.9c3.4 0 6.03 2.58 6.03 6 0 4.15-3.29 7.13-7.66 11.09l-1.23 1.12c-.24.22-.54.34-.86.34z"/></svg>';
}
function playlistPlusIconSvg() {
  return '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10"/><path d="M4 11h10"/><path d="M4 16h7"/><path d="M18 14v6"/><path d="M15 17h6"/></svg>';
}
function artistCollectTrayIconSvg() {
  return '<svg fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v9"/><path d="M7.5 9.5h9"/><path d="M4.5 12.5v6h15v-6"/></svg>';
}
function artistNextPlusIconSvg() {
  return '<svg fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13"/><path d="M5.5 12h13"/></svg>';
}
function songActionHtml(kind, source, index, song) {
  var liked = isSongLiked(song);
  if (kind === 'like') {
    return '<button class="song-action-btn' + (liked ? ' liked' : '') + '" title="' + (liked ? '取消红心' : '红心喜欢') + '" onclick="event.stopPropagation();toggleLike' + source + '(' + index + ')">' + heartIconSvg() + '</button>';
  }
  return '<button class="song-action-btn" title="收藏到歌单" onclick="event.stopPropagation();collect' + source + '(' + index + ')">' + playlistPlusIconSvg() + '</button>';
}
function syncLikeStatusForSongs(songs) {
  if (!songs || !songs.length) return;
  var groups = Object.create(null);
  songs.forEach(function (song) {
    var provider = songAccountProvider(song);
    var adapter = songAccountAdapter(provider);
    var id = songAccountId(song, provider);
    if (!adapter || !adapter.like || !adapter.likeCheckUrl || !id || !isSongAccountLoggedIn(provider)) return;
    if (!groups[provider]) groups[provider] = { adapter: adapter, ids: [], seen: Object.create(null) };
    if (groups[provider].seen[id]) return;
    groups[provider].seen[id] = true;
    groups[provider].ids.push(id);
  });
  var providers = Object.keys(groups);
  if (!providers.length) return;
  var token = ++likeStatusToken;
  var requests = [];
  providers.forEach(function (provider) {
    var group = groups[provider];
    var batchSize = provider === 'spotify' || provider === 'qishui' ? 40 : (provider === 'kugou' ? 50 : 200);
    for (var offset = 0; offset < group.ids.length; offset += batchSize) {
      (function (batchIds) {
        var url = group.adapter.likeCheckUrl + '?' + group.adapter.likeCheckParam + '=' + encodeURIComponent(batchIds.join(','));
        requests.push(apiJson(url).then(function (r) {
          if (token < likeStatusToken - 3 || !r || !r.liked) return;
          var responseLiked = r.liked || {};
          batchIds.forEach(function (id) {
            var responseId = provider === 'kugou' ? String(id).toLowerCase() : String(id);
            var liked = responseLiked[responseId];
            if (liked == null) liked = responseLiked[id];
            if (liked == null) return;
            if (provider === 'qishui' && r.complete === false && !liked) return;
            likedSongMap[provider + ':' + responseId] = !!liked;
            if (provider === 'netease') likedSongMap[String(responseId)] = !!liked;
          });
        }).catch(function (err) {
          console.warn(provider + ' like check failed:', err);
        }));
      })(group.ids.slice(offset, offset + batchSize));
    }
  });
  Promise.all(requests).then(function () {
    if (token < likeStatusToken - 3) return;
    safeRenderQueuePanel('like-status-sync', { scrollCurrent: miniQueueOpen });
    if ($results && $results.classList.contains('show')) refreshSearchResultActionStates();
    updateLikeButtons();
  });
}
function syncLikeStatusForSong(song) {
  var adapter = songAccountAdapter(song);
  if (!adapter || !adapter.like) { updateLikeButtons(song); return; }
  syncLikeStatusForSongs([song]);
}
function isLikedPlaylistContext(id, title, meta) {
  var rawId = String(id || '');
  var idParts = rawId.match(/^(netease|qq|kugou|qishui|spotify):(.*)$/);
  var provider = idParts ? idParts[1] : playlistAccountProvider(meta);
  var sid = idParts ? idParts[2] : rawId;
  var text = String(title || (meta && meta.name) || '').trim();
  var hit = userPlaylists.find(function (pl) {
    return playlistAccountProvider(pl) === provider && String(pl.id || '') === sid;
  });
  if (hit) {
    if (Number(hit.specialType || 0) === 5) return true;
    if (hit.virtual && /like|喜欢/i.test(String(hit.id || hit.name || ''))) return true;
    text = text || hit.name || '';
  }
  if (/qishui-liked|liked/i.test(sid)) return true;
  return /我喜欢|喜欢的音乐|liked/i.test(text);
}
function markSongsLiked(songs, liked) {
  (songs || []).forEach(function (song) {
    var key = songAccountStateKey(song);
    if (key) likedSongMap[key] = !!liked;
    if (songAccountProvider(song) === 'netease' && song && song.id) likedSongMap[String(song.id)] = !!liked;
  });
}
function refreshSearchResultActionStates() {
  if (!playlist || !$results || !$results.children.length) return;
  Array.prototype.forEach.call($results.querySelectorAll('[data-like-index]'), function (btn) {
    var i = Number(btn.getAttribute('data-like-index'));
    var song = playlist[i];
    var liked = isSongLiked(song);
    btn.classList.toggle('liked', liked);
    btn.title = liked ? '取消红心' : '红心喜欢';
  });
}
async function toggleLikeSong(song) {
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.like || !adapter.likeUrl) {
    showToast(songAccountUnsupportedMessage(provider, 'like'));
    return;
  }
  if (!ensureLoggedInForAction(provider)) return;
  var id = songAccountId(song, provider);
  var stateKey = songAccountStateKey(song);
  if (!id || !stateKey) {
    showToast('当前歌曲缺少' + adapter.label + '歌曲标识');
    return;
  }
  if (likeBusyMap[stateKey]) return;
  var next = !isSongLiked(song);
  likeBusyMap[stateKey] = true;
  likedSongMap[stateKey] = next;
  if (provider === 'netease') likedSongMap[String(id)] = next;
  updateLikeButtons(song);
  safeRenderQueuePanel('like-toggle-optimistic', { scrollCurrent: miniQueueOpen });
  refreshSearchResultActionStates();
  try {
    var r = await apiJson(adapter.likeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, like: next, song: song })
    });
    if (r && (r.error || r.success === false)) throw new Error(r.error || r.message || 'LIKE_FAILED');
    likedSongMap[stateKey] = r && r.liked != null ? !!r.liked : next;
    if (provider === 'netease') likedSongMap[String(id)] = likedSongMap[stateKey];
    showToast(next ? '已加入红心喜欢' : '已取消红心');
  } catch (err) {
    likedSongMap[stateKey] = !next;
    if (provider === 'netease') likedSongMap[String(id)] = !next;
    var errorText = String(err && err.message || '');
    if (/LOGIN_REQUIRED|AUTH_REQUIRED/i.test(errorText)) showToast(adapter.label + '登录状态已失效，请重新登录');
    else showToast(errorText ? ('红心操作失败: ' + errorText) : '红心操作失败');
  } finally {
    delete likeBusyMap[stateKey];
    updateLikeButtons(song);
    safeRenderQueuePanel('like-toggle-final', { scrollCurrent: miniQueueOpen });
    refreshSearchResultActionStates();
  }
}
function toggleLikeCurrent() { toggleLikeSong(currentCoverSong()); }
function toggleLikeSearchResult(i) { if (playlist[i]) toggleLikeSong(playlist[i]); }
function toggleLikeQueueIndex(i) { if (playQueue[i]) toggleLikeSong(playQueue[i]); }
function toggleLikeDetailSong(song) { toggleLikeSong(song); }
function openCollectModal(song) {
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.collect || !adapter.playlistAddUrl) {
    showToast(songAccountUnsupportedMessage(provider, 'collect'));
    return;
  }
  if (!ensureLoggedInForAction(provider)) return;
  collectTargetSong = song;
  renderCollectModal();
  openGsapModal(document.getElementById('collect-modal'));
  refreshUserPlaylists(true).then(function () { renderCollectModal(); }).catch(function () { renderCollectModal(); });
}
function openCollectModalForCurrent() { openCollectModal(currentCoverSong()); }
function collectSearchResult(i) { if (playlist[i]) openCollectModal(playlist[i]); }
function collectQueueIndex(i) { if (playQueue[i]) openCollectModal(playQueue[i]); }
function collectDetailSong(song) { openCollectModal(song); }
function closeCollectModal() {
  closeGsapModal(document.getElementById('collect-modal'), function () {
    collectTargetSong = null;
    var input = document.getElementById('collect-new-name');
    if (input) input.value = '';
  });
}
function renderCollectModal() {
  var current = document.getElementById('collect-current');
  var list = document.getElementById('collect-list');
  if (!current || !list) return;
  var song = collectTargetSong || {};
  var cover = songCoverSrc(song, 80);
  current.innerHTML = (cover ? imgTagFromSrc(cover) : '<div class="cover-placeholder"></div>') +
    '<div style="min-width:0"><div class="collect-title">' + escHtml(song.name || '当前歌曲') + '</div><div class="collect-sub">' + escHtml(song.artist || '') + '</div></div>';
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.collect) {
    list.innerHTML = '<div class="collect-empty">' + escHtml(songAccountUnsupportedMessage(provider, 'collect')) + '</div>';
    return;
  }
  if (!isSongAccountLoggedIn(provider)) {
    list.innerHTML = '<div class="collect-empty">登录' + escHtml(adapter.label) + '后显示你的歌单</div>';
    return;
  }
  if (!userPlaylists.length) {
    list.innerHTML = miniQueueSkeleton();
    return;
  }
  var mine = userPlaylists.filter(function (pl) {
    return playlistAccountProvider(pl) === provider && !pl.subscribed && !pl.virtual;
  });
  if (!mine.length) {
    list.innerHTML = '<div class="collect-empty">还没有可写入的歌单</div>';
    return;
  }
  list.innerHTML = mine.map(function (pl) {
    var thumb = pl.cover ? coverUrlWithSize(pl.cover, 80) : '';
    return '<div class="collect-item" data-collect-pid="' + escAttr(String(pl.id || '')) + '" onclick="addCollectTargetToPlaylist(this.getAttribute(\'data-collect-pid\'))">' +
      (thumb ? imgTagFromSrc(thumb) : '<div class="cover-placeholder"></div>') +
      '<div style="min-width:0"><div class="collect-title">' + escHtml(pl.name || '') + '</div><div class="collect-sub">' + (pl.trackCount || 0) + ' 首</div></div>' +
    '</div>';
  }).join('');
  if (window.gsap) animateListItems(list, '.collect-item', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
}
function setCollectBusyPid(pid, busy) {
  var list = document.getElementById('collect-list');
  if (!list) return;
  list.querySelectorAll('.collect-item').forEach(function (item) {
    item.classList.toggle('busy', !!busy && item.getAttribute('data-collect-pid') === String(pid));
  });
}
async function createPlaylistFromCollect() {
  var provider = songAccountProvider(collectTargetSong);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.createPlaylist || !adapter.playlistCreateUrl) {
    showToast((adapter && adapter.label || '当前平台') + '暂不支持在 Mineradio 内新建歌单');
    return;
  }
  if (!ensureLoggedInForAction(provider)) return;
  var input = document.getElementById('collect-new-name');
  var name = input ? input.value.trim() : '';
  if (!name) { showToast('先输入歌单名称'); return; }
  try {
    var r = await apiJson(adapter.playlistCreateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    });
    if (r && (r.error || r.success === false)) throw new Error(r.error || r.message || 'PLAYLIST_CREATE_FAILED');
    if (input) input.value = '';
    showToast('歌单已创建');
    await refreshUserPlaylists(true);
    renderCollectModal();
    var created = r && r.playlist;
    var pid = created && created.id;
    if (pid && collectTargetSong) addCollectTargetToPlaylist(pid);
  } catch (err) {
    showToast('创建歌单失败');
  }
}
function collectResultMessage(r) {
  if (!r) return '收藏失败';
  var msg = r.error || r.message || r.msg || '';
  if (/LOGIN_REQUIRED|AUTH_REQUIRED/i.test(String(msg))) return '平台登录状态已失效，请重新登录';
  if (/exist|重复|已存在|already/i.test(String(msg))) return '歌曲已在歌单中';
  return msg ? ('收藏失败: ' + msg) : '收藏失败';
}
function playlistTracksPageUrl(adapter, pid, offset, limit) {
  var url = adapter.playlistTracksUrl + '?id=' + encodeURIComponent(pid);
  if (limit) url += '&limit=' + encodeURIComponent(String(limit));
  if (offset) url += '&offset=' + encodeURIComponent(String(offset));
  return url;
}
function playlistContainsAccountSong(tracks, song, provider) {
  var expected = songAccountIdentityValues(song, provider);
  if (!expected.length) return false;
  var expectedSet = Object.create(null);
  expected.forEach(function (id) { expectedSet[id] = true; });
  return (tracks || []).some(function (track) {
    return songAccountIdentityValues(track, provider).some(function (id) { return !!expectedSet[id]; });
  });
}
async function verifySongInPlaylist(pid, song) {
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  if (!pid || !adapter || !adapter.playlistTracksUrl || !songAccountId(song, provider)) return false;
  var pageLimit = provider === 'spotify' || provider === 'qishui' ? 50 : 200;
  for (var attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(function (resolve) { setTimeout(resolve, attempt === 1 ? 360 : 820); });
    try {
      var detail = await apiJson(playlistTracksPageUrl(adapter, pid, 0, pageLimit));
      if (playlistContainsAccountSong((detail && detail.tracks) || [], song, provider)) return true;
    } catch (e) {
      console.warn(provider + ' collect verify failed:', e);
    }
  }
  return false;
}
async function addCollectTargetToPlaylist(pid) {
  if (collectBusy || !collectTargetSong || !pid) return;
  var targetSong = collectTargetSong;
  var provider = songAccountProvider(targetSong);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.collect || !adapter.playlistAddUrl) {
    showToast(songAccountUnsupportedMessage(provider, 'collect'));
    return;
  }
  if (!ensureLoggedInForAction(provider)) return;
  collectBusy = true;
  setCollectBusyPid(pid, true);
  updateLikeButtons();
  showToast('正在收藏到歌单...');
  try {
    var songId = songAccountId(targetSong, provider);
    if (!songId) throw new Error('当前歌曲缺少' + adapter.label + '歌曲标识');
    var r = await apiJson(adapter.playlistAddUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: pid, id: songId, song: targetSong })
    });
    if (!r || r.error || r.success === false) throw new Error(collectResultMessage(r));
    showToast('已收藏到歌单');
    closeCollectModal();
    refreshUserPlaylists(true);
    setTimeout(function () {
      verifySongInPlaylist(pid, targetSong).then(function (ok) {
        if (!ok) console.warn(provider + ' collect submitted but verify did not find song yet:', pid, songId);
      });
    }, 900);
  } catch (err) {
    showToast(err && err.message ? err.message : '收藏失败');
  } finally {
    collectBusy = false;
    setCollectBusyPid(pid, false);
    updateLikeButtons();
  }
}
function cloneSong(song){ return hydrateCustomCover(Object.assign({}, song)); }
function avatarSrc(url) {
  if (!url) return '';
  return coverProxySrc(url, true);
}

