// =============================================================================
// Mineradio 内置歌单库（本机持久化，可混存五个平台的歌曲）
// 数据在主进程 built-in-playlists.json，IPC 通道 desktopWindow.*BuiltInPlaylist*
// 合并自上游 Mineradio-paused；差异适配：
//   - 本仓库没有 neteasePlaylists 全局（网易云歌单是 refreshUserPlaylists 里的
//     局部变量 neteaseLists），所以快照合并不能照搬上游的 concat 五数组写法；
//   - 本仓库没有 rebuildUserPlaylistsFromCatalog / cancelPlaylistPanelDetailRequest，
//     一律 typeof 守卫，缺失时退到本地合并；
//   - playlistPanelDetailState 没有 total/nextOffset/hasMore 字段，读取处全部 ?? 兜底。
// =============================================================================

function normalizeBuiltInPlaylistRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (playlist) {
    return Object.assign({}, playlist, {
      provider: 'mineradio',
      source: 'mineradio',
      builtin: true,
      creator: playlist.creator || 'Mineradio',
      shelfPane: 'mine',
      subscribed: false
    });
  }).filter(function (playlist) { return !!playlist.id; });
}

function applyBuiltInPlaylistSnapshot(result, opts) {
  opts = opts || {};
  if (!result || result.ok !== true) return false;
  builtInPlaylists = normalizeBuiltInPlaylistRows(result.playlists);
  if (typeof refreshUserPlaylists === 'function') {
    // 本仓库的合并逻辑集中在 refreshUserPlaylists（网易云歌单是那里的局部变量），
    // 由它负责把 builtInPlaylists 与平台歌单重新拼成 userPlaylists 并重渲染面板。
    try {
      var ret = refreshUserPlaylists(false);
      if (ret && typeof ret.catch === 'function') ret.catch(function (e) { console.warn('[BuiltInPlaylists] refresh failed', e); });
    } catch (e) { console.warn('[BuiltInPlaylists] refresh failed', e); }
  } else {
    // 兜底：只动 userPlaylists 里非内置的部分，避免重复堆叠
    var others = (userPlaylists || []).filter(function (pl) { return !(pl && pl.builtin); });
    userPlaylists = builtInPlaylists.concat(others);
    playlistCatalogRevision += 1;
  }
  return true;
}

function builtInPlaylistApiAvailable() {
  return !!(window.desktopWindow && typeof window.desktopWindow.listBuiltInPlaylists === 'function');
}

function builtInPlaylistErrorMessage(result, fallback) {
  var code = String(result && result.error || '');
  if (code === 'BUILT_IN_PLAYLIST_LIMIT_REACHED') return '内置歌单数量已达到上限';
  if (code === 'BUILT_IN_PLAYLIST_TRACK_LIMIT_REACHED') return '这个内置歌单已经装满了';
  if (code === 'BUILT_IN_PLAYLIST_INDEX_TOO_LARGE') return '内置歌单数据已达到存储上限';
  if (code === 'BUILT_IN_PLAYLIST_TRACK_INVALID') return '这首歌缺少可保存的音源标识';
  if (code === 'BUILT_IN_PLAYLIST_NOT_FOUND') return '内置歌单已不存在';
  return fallback || '内置歌单操作失败';
}

function refreshBuiltInPlaylists(force) {
  if (!builtInPlaylistApiAvailable()) return Promise.resolve(false);
  if (builtInPlaylistLoadPromise && !force) return builtInPlaylistLoadPromise;
  var request = window.desktopWindow.listBuiltInPlaylists().then(function (result) {
    if (!result || result.ok !== true) throw new Error(result && result.error || 'BUILT_IN_PLAYLIST_READ_FAILED');
    applyBuiltInPlaylistSnapshot(result, { preserveScroll: true, reason: 'built-in-playlists-refresh' });
    return true;
  }).catch(function (error) {
    console.warn('[BuiltInPlaylists]', error);
    return false;
  }).finally(function () {
    if (builtInPlaylistLoadPromise === request) builtInPlaylistLoadPromise = null;
  });
  builtInPlaylistLoadPromise = request;
  return request;
}

async function builtInPlaylistTracksPage(id, options) {
  if (!builtInPlaylistApiAvailable() || typeof window.desktopWindow.readBuiltInPlaylist !== 'function') {
    return { ok: false, playlist: null, tracks: [], total: 0, hasMore: false, error: 'BUILT_IN_PLAYLIST_UNAVAILABLE' };
  }
  return window.desktopWindow.readBuiltInPlaylist(String(id || ''), options || {});
}

async function createBuiltInPlaylist(name, initialTrack) {
  name = String(name || '').trim();
  if (!name) {
    if (typeof showToast === 'function') showToast('先输入内置歌单名称');
    return null;
  }
  if (!builtInPlaylistApiAvailable() || typeof window.desktopWindow.createBuiltInPlaylist !== 'function') {
    if (typeof showToast === 'function') showToast('当前环境无法保存内置歌单');
    return null;
  }
  var result = await window.desktopWindow.createBuiltInPlaylist(name);
  if (!result || result.ok !== true || !result.playlist) {
    if (typeof showToast === 'function') showToast(builtInPlaylistErrorMessage(result, '创建内置歌单失败'));
    return null;
  }
  applyBuiltInPlaylistSnapshot(result, { animate: true, reason: 'built-in-playlist-create' });
  if (initialTrack) {
    var added = await addTrackToBuiltInPlaylist(result.playlist.id, initialTrack, { silentSuccess: true });
    if (!added) return result.playlist;
  }
  if (typeof showToast === 'function') showToast('内置歌单已创建');
  return result.playlist;
}

// ---------------------------------------------------------------------------
// 应用内 prompt / confirm 模态
// Electron 渲染进程默认禁用 window.prompt / window.confirm（前者恒返回 null、
// 后者恒返回 false），直接调用会让「新建 / 重命名 / 删除内置歌单」静默无反应。
// 主进程 dialog.showMessageBox 又没有输入框，所以这里复用 .modal-mask 外壳
// （account.css）自建一个 Promise 化模态：openGsapModal/closeGsapModal 存在时
// 走同一套动效，缺失时直接退 classList，不依赖 08-account 模块的加载时序。
// ---------------------------------------------------------------------------
var builtinPromptState = null;

function openBuiltInPromptModal(options) {
  options = options || {};
  var mask = document.getElementById('builtin-prompt-modal');
  var titleEl = document.getElementById('builtin-prompt-title');
  var messageEl = document.getElementById('builtin-prompt-message');
  var inputEl = document.getElementById('builtin-prompt-input');
  var okBtn = document.getElementById('builtin-prompt-ok');
  var cancelBtn = document.getElementById('builtin-prompt-cancel');
  if (!mask || !titleEl || !inputEl || !okBtn || !cancelBtn) return Promise.resolve(null);
  // 重入保护：上一个还没关就按取消收掉，避免两个模态状态串台
  if (builtinPromptState) {
    var previous = builtinPromptState;
    builtinPromptState = null;
    previous.resolve(null);
  }
  var withInput = options.withInput !== false;
  return new Promise(function (resolve) {
    builtinPromptState = { resolve: resolve };
    titleEl.textContent = String(options.title || '请输入');
    if (messageEl) {
      messageEl.textContent = String(options.message || '');
      messageEl.hidden = !messageEl.textContent;
    }
    okBtn.textContent = String(options.okText || '确定');
    inputEl.hidden = !withInput;
    if (withInput) {
      inputEl.value = String(options.value || '');
      inputEl.placeholder = String(options.placeholder || '');
    }
    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      mask.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown, true);
    }
    function settle(value) {
      if (!builtinPromptState) return;
      cleanup();
      builtinPromptState = null;
      if (typeof closeGsapModal === 'function') closeGsapModal(mask);
      else mask.classList.remove('show');
      resolve(value);
    }
    function onOk() {
      if (!withInput) { settle(true); return; }
      var name = inputEl.value.trim();
      if (!name) {
        if (typeof showToast === 'function') showToast('先输入名称');
        inputEl.focus();
        return;
      }
      settle(name);
    }
    function onCancel() { settle(null); }
    function onBackdrop(event) { if (event.target === mask) settle(null); }
    function onKeydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); settle(null); }
      else if (event.key === 'Enter' && withInput) { event.preventDefault(); onOk(); }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    mask.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown, true);
    if (typeof openGsapModal === 'function') openGsapModal(mask);
    else mask.classList.add('show');
    setTimeout(function () {
      if (withInput) { inputEl.focus(); inputEl.select(); }
      else okBtn.focus();
    }, 60);
  });
}

function promptCreateBuiltInPlaylist() {
  openBuiltInPromptModal({
    title: '新建 Mineradio 内置歌单',
    placeholder: '我的歌单',
    okText: '创建'
  }).then(function (name) {
    if (name == null) return;
    createBuiltInPlaylist(name).catch(function (error) {
      console.warn('[BuiltInPlaylistCreate]', error);
      if (typeof showToast === 'function') showToast('创建内置歌单失败');
    });
  });
}

async function addTrackToBuiltInPlaylist(id, track, opts) {
  opts = opts || {};
  if (!builtInPlaylistApiAvailable() || typeof window.desktopWindow.addBuiltInPlaylistTrack !== 'function') return false;
  var result = await window.desktopWindow.addBuiltInPlaylistTrack(String(id || ''), track || {});
  if (!result || result.ok !== true) {
    if (typeof showToast === 'function') showToast(builtInPlaylistErrorMessage(result, '加入内置歌单失败'));
    return false;
  }
  applyBuiltInPlaylistSnapshot(result, { preserveScroll: true, reason: 'built-in-playlist-add-track' });
  if (typeof showToast === 'function' && !opts.silentSuccess) showToast(result.duplicate ? '歌曲已在这个内置歌单中' : '已加入内置歌单');
  return result.duplicate ? 'duplicate' : true;
}

async function removeTrackFromBuiltInPlaylist(id, index) {
  if (!builtInPlaylistApiAvailable() || typeof window.desktopWindow.removeBuiltInPlaylistTrack !== 'function') return false;
  var result = await window.desktopWindow.removeBuiltInPlaylistTrack(String(id || ''), Number(index));
  if (!result || result.ok !== true) {
    if (typeof showToast === 'function') showToast(builtInPlaylistErrorMessage(result, '移除歌曲失败'));
    return false;
  }
  // 正在展开的内置歌单详情：就地摘掉这一行，不等整面板重渲
  if (playlistPanelDetailState && playlistPanelDetailState.key === 'mineradio:' + String(id || '')) {
    playlistPanelDetailState.tracks.splice(Number(index), 1);
    playlistPanelDetailState.total = Math.max(0, playlistPanelDetailState.tracks.length);
    playlistPanelDetailState.nextOffset = playlistPanelDetailState.tracks.length;
    playlistPanelDetailState.hasMore = false;
  }
  applyBuiltInPlaylistSnapshot(result, { preserveScroll: true, reason: 'built-in-playlist-remove-track' });
  if (typeof showToast === 'function') showToast('已从内置歌单移除');
  return true;
}

async function renameBuiltInPlaylist(id, currentName) {
  var name = await openBuiltInPromptModal({
    title: '重命名内置歌单',
    value: String(currentName || ''),
    placeholder: '输入新名称',
    okText: '保存'
  });
  if (name == null || !String(name).trim()) return false;
  if (!builtInPlaylistApiAvailable() || typeof window.desktopWindow.renameBuiltInPlaylist !== 'function') return false;
  var result = await window.desktopWindow.renameBuiltInPlaylist(String(id || ''), String(name).trim());
  if (!result || result.ok !== true) {
    if (typeof showToast === 'function') showToast(builtInPlaylistErrorMessage(result, '重命名失败'));
    return false;
  }
  if (playlistPanelDetailState && playlistPanelDetailState.key === 'mineradio:' + String(id || '') && playlistPanelDetailState.playlist) {
    playlistPanelDetailState.playlist.name = String(name).trim();
  }
  applyBuiltInPlaylistSnapshot(result, { preserveScroll: true, reason: 'built-in-playlist-rename' });
  if (typeof showToast === 'function') showToast('内置歌单已重命名');
  return true;
}

async function deleteBuiltInPlaylist(id, currentName) {
  var confirmed = await openBuiltInPromptModal({
    title: '删除内置歌单',
    message: '删除“' + String(currentName || '未命名歌单') + '”？\n只删除歌单，不会删除平台或本地歌曲。',
    withInput: false,
    okText: '删除'
  });
  if (!confirmed) return false;
  if (!builtInPlaylistApiAvailable() || typeof window.desktopWindow.deleteBuiltInPlaylist !== 'function') return false;
  var result = await window.desktopWindow.deleteBuiltInPlaylist(String(id || ''));
  if (!result || result.ok !== true) {
    if (typeof showToast === 'function') showToast(builtInPlaylistErrorMessage(result, '删除内置歌单失败'));
    return false;
  }
  if (playlistPanelDetailState && playlistPanelDetailState.key === 'mineradio:' + String(id || '')) {
    if (typeof cancelPlaylistPanelDetailRequest === 'function') cancelPlaylistPanelDetailRequest();
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
  }
  applyBuiltInPlaylistSnapshot(result, { preserveScroll: true, reason: 'built-in-playlist-delete' });
  if (typeof showToast === 'function') showToast('内置歌单已删除');
  return true;
}
