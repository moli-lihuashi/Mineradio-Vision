// ============================================================
//  本地歌单：localStorage 持久化的用户自建歌单
//  - 首个消费方：AI 歌单「存为歌单」；列表展现在左侧「歌单」面板「本地歌单」分组
//  - songs 为搜索结果同构的可播放歌曲对象（provider/id/hash/name/artist/cover）
//  - 详情展开/播放复用 playlist-panel-detail 管线（02-playlist-detail.js 的 local 分支）
// ============================================================
var LOCAL_PLAYLIST_STORE_KEY = 'mineradio-local-playlists-v1';
var LOCAL_PLAYLIST_MAX_COUNT = 50;
var LOCAL_PLAYLIST_MAX_SONGS = 300;

function readLocalPlaylists() {
  try {
    var raw = JSON.parse(localStorage.getItem(LOCAL_PLAYLIST_STORE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.playlists)) return [];
    return raw.playlists.filter(function (pl) { return pl && pl.id && Array.isArray(pl.songs); });
  } catch (_) {
    return [];
  }
}

function writeLocalPlaylists(list) {
  try {
    localStorage.setItem(LOCAL_PLAYLIST_STORE_KEY, JSON.stringify({
      version: 1,
      playlists: list.slice(0, LOCAL_PLAYLIST_MAX_COUNT),
    }));
    return true;
  } catch (e) {
    if (typeof showToast === 'function') showToast('本地歌单保存失败：存储空间不足');
    return false;
  }
}

function listLocalPlaylists() {
  return readLocalPlaylists();
}

// 面板分组用的歌单元信息（不携带全部歌曲，保持渲染轻量）
function localPlaylistPanelItems() {
  return readLocalPlaylists().map(function (pl) {
    var cover = pl.cover || '';
    if (!cover && pl.songs && pl.songs.length) {
      cover = pl.songs[0].cover || pl.songs[0].picUrl || '';
    }
    return {
      provider: 'local',
      id: pl.id,
      name: pl.name,
      cover: cover,
      trackCount: (pl.songs && pl.songs.length) || 0,
      creator: '本地歌单',
    };
  });
}

function getLocalPlaylistById(id) {
  return readLocalPlaylists().find(function (pl) { return pl.id === String(id || ''); }) || null;
}

function createLocalPlaylist(name, songs) {
  var cleanName = String(name || '').trim().slice(0, 40) || '我的本地歌单';
  var list = readLocalPlaylists();
  var base = cleanName;
  var suffix = 2;
  while (list.some(function (pl) { return pl.name === cleanName; })) {
    cleanName = base + ' (' + (suffix++) + ')';
  }
  var firstCover = '';
  (songs || []).some(function (s) {
    firstCover = (s && (s.cover || s.picUrl)) || '';
    return !!firstCover;
  });
  var pl = {
    id: 'lp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: cleanName,
    cover: firstCover,
    creator: '本地歌单',
    provider: 'local',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    songs: (songs || []).slice(0, LOCAL_PLAYLIST_MAX_SONGS).map(cloneSong),
  };
  list.unshift(pl);
  return writeLocalPlaylists(list) ? pl : null;
}

function deleteLocalPlaylistById(id) {
  var list = readLocalPlaylists();
  var next = list.filter(function (pl) { return pl.id !== String(id || ''); });
  if (next.length === list.length) return false;
  return writeLocalPlaylists(next);
}

function renameLocalPlaylistById(id, name) {
  var clean = String(name || '').trim().slice(0, 40);
  if (!clean) return false;
  var list = readLocalPlaylists();
  var pl = list.find(function (p) { return p.id === String(id || ''); });
  if (!pl) return false;
  pl.name = clean;
  pl.updatedAt = Date.now();
  return writeLocalPlaylists(list);
}

function exportLocalPlaylistPayload(id) {
  var pl = getLocalPlaylistById(id);
  if (!pl) return null;
  return {
    app: 'mineradio',
    type: 'local-playlist',
    version: 1,
    exportedAt: new Date().toISOString(),
    name: pl.name,
    songs: pl.songs,
  };
}

// 导入：接受单个歌单对象或数组（本应用导出格式，或含 name+songs 的通用 JSON）
function importLocalPlaylistsFromPayload(payload) {
  var items = Array.isArray(payload) ? payload : [payload];
  var imported = 0;
  items.forEach(function (item) {
    if (!item || !Array.isArray(item.songs)) return;
    var songs = item.songs.filter(function (s) { return s && (s.hash || s.id) && (s.name || s.title); });
    if (!songs.length) return;
    var pl = createLocalPlaylist(item.name || '导入的歌单', songs);
    if (pl) imported += 1;
  });
  return imported;
}

// ===== 详情区操作：重命名 / 导出 / 导入 =====
function startLocalPlaylistRename(key) {
  var panel = document.getElementById('playlist-panel');
  var detail = panel && panel.querySelector('.pl-inline-detail[data-pl-detail="' + String(key).replace(/"/g, '') + '"]');
  var title = detail && detail.querySelector('.pl-detail-title');
  if (!title || title.querySelector('input')) return;
  var id = String(key || '').replace(/^local:/, '');
  var pl = getLocalPlaylistById(id);
  if (!pl) return;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = pl.name;
  input.maxLength = 40;
  input.style.cssText = 'width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#fff;font-size:13px;padding:4px 8px;outline:none';
  title.textContent = '';
  title.appendChild(input);
  input.focus();
  input.select();
  var done = function () {
    var name = input.value.trim();
    if (name && name !== pl.name) renameLocalPlaylistById(id, name);
    if (typeof renderUserPlaylistsList === 'function') renderUserPlaylistsList({ reset: true });
  };
  input.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { if (typeof renderUserPlaylistsList === 'function') renderUserPlaylistsList({ reset: true }); }
  });
  input.addEventListener('blur', done);
  input.addEventListener('click', function (e) { e.stopPropagation(); });
}

function exportLocalPlaylistFile(id) {
  var pl = getLocalPlaylistById(id);
  var payload = exportLocalPlaylistPayload(id);
  if (!pl || !payload) return;
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pl.name + '.mineradio-playlist.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  if (typeof showToast === 'function') showToast('已导出「' + pl.name + '」（' + pl.songs.length + ' 首）');
}

var _localImportInput = null;
function pickLocalPlaylistImportFile() {
  if (!_localImportInput) {
    _localImportInput = document.createElement('input');
    _localImportInput.type = 'file';
    _localImportInput.accept = '.json,application/json';
    _localImportInput.style.display = 'none';
    _localImportInput.addEventListener('change', function () {
      var file = _localImportInput.files && _localImportInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var payload = null;
        try { payload = JSON.parse(String(reader.result || '')); } catch (_) {}
        if (!payload) {
          if (typeof showToast === 'function') showToast('导入失败：不是有效的 JSON 文件');
          return;
        }
        var n = importLocalPlaylistsFromPayload(payload);
        if (typeof renderUserPlaylistsList === 'function') renderUserPlaylistsList({ reset: true });
        if (typeof showToast === 'function') showToast(n ? ('已导入 ' + n + ' 个本地歌单') : '导入失败：文件里没有可识别的歌单');
      };
      reader.readAsText(file, 'utf8');
      _localImportInput.value = '';
    });
    document.body.appendChild(_localImportInput);
  }
  _localImportInput.click();
}

// 详情区「删除歌单」：两段式确认（第一次点击变确认态，3 秒内再点才真删）
function handleLocalPlaylistDetailDelete(id, btn) {
  if (!btn || btn.getAttribute('data-confirming') !== '1') {
    btn.setAttribute('data-confirming', '1');
    btn.textContent = '确认删除？';
    setTimeout(function () {
      if (btn && btn.isConnected) {
        btn.removeAttribute('data-confirming');
        btn.textContent = '删除歌单';
      }
    }, 3000);
    return;
  }
  var pl = getLocalPlaylistById(id);
  if (!pl || !deleteLocalPlaylistById(id)) return;
  if (typeof playlistPanelDetailState !== 'undefined' && playlistPanelDetailState && playlistPanelDetailState.key === 'local:' + id) {
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
  }
  if (typeof renderUserPlaylistsList === 'function') renderUserPlaylistsList({ reset: true });
  if (typeof showToast === 'function') showToast('已删除本地歌单「' + pl.name + '」');
}
