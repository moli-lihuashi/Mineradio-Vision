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
