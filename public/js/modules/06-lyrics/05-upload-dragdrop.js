// ============================================================
//  文件拖放 / 本地音乐导入（会话内 blob + 持久化本地曲库双路）
// ============================================================
document.getElementById('file-input').addEventListener('change', function(e){ handleFiles(e.target.files); e.target.value = ''; });
var _coverInput = document.getElementById('cover-input');
if (_coverInput) _coverInput.addEventListener('change', function(e){ handleCoverFiles(e.target.files); e.target.value = ''; });
var _folderInput = document.getElementById('folder-input');
if (_folderInput) _folderInput.addEventListener('change', function(e){ handleFiles(e.target.files); e.target.value = ''; });

// ---- 文件分类 / 排序（上游 05-upload-dragdrop.js 移植）----
var AUDIO_UPLOAD_EXT_RE = /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i;
var IMAGE_UPLOAD_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;
function isAudioUploadFile(file) {
  if (!file) return false;
  return /^audio\//i.test(file.type || '') || AUDIO_UPLOAD_EXT_RE.test(file.name || '');
}
function isImageUploadFile(file) {
  if (!file) return false;
  return /^image\//i.test(file.type || '') || IMAGE_UPLOAD_EXT_RE.test(file.name || '');
}
function uploadFileSortKey(file) {
  return String((file && (file.webkitRelativePath || file.name)) || '').toLowerCase();
}
function sortedAudioUploadFiles(files) {
  return Array.prototype.slice.call(files || [])
    .filter(isAudioUploadFile)
    .sort(function (a, b) {
      return uploadFileSortKey(a).localeCompare(uploadFileSortKey(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
    });
}
function firstImageUploadFile(files) {
  var list = Array.prototype.slice.call(files || []);
  for (var i = 0; i < list.length; i++) if (isImageUploadFile(list[i])) return list[i];
  return null;
}
function localSongFromAudioFile(file) {
  var rel = String(file.webkitRelativePath || file.name || '');
  var filename = String(file.name || rel || '本地音乐');
  var title = filename.replace(/\.[^.]+$/, '');
  return hydrateCustomCover({
    type: 'local',
    source: 'local',
    provider: 'local',
    name: title || '本地音乐',
    artist: '本地文件',
    album: rel && rel !== filename ? rel.split(/[\\/]/).slice(0, -1).join(' / ') : '',
    localKey: [rel || filename, file.size || 0, file.lastModified || 0].join(':'),
    localUrl: URL.createObjectURL(file),
    localPath: rel,
    duration: 0
  });
}

// ---- 持久化本地曲库（desktop 主进程索引，mineradio-local:// 播放）----
function canUsePersistentLocalMusicLibrary() {
  return !!(
    window.desktopWindow &&
    typeof window.desktopWindow.importLocalMusicFiles === 'function'
  );
}
async function importPersistentLocalAudioFiles(files) {
  if (!canUsePersistentLocalMusicLibrary()) return null;
  var selectedFiles = Array.prototype.slice.call(files || []);
  if (!selectedFiles.length) return null;
  var result = await window.desktopWindow.importLocalMusicFiles(selectedFiles);
  if (!result || result.ok !== true || !Array.isArray(result.tracks) || !result.tracks.length) {
    throw new Error((result && result.error) || 'LOCAL_LIBRARY_IMPORT_FAILED');
  }
  return result;
}
function isLocalSessionSong(song) {
  return !!(song && (song.type === 'local' || song.source === 'local' || song.localKey || song.localFileId));
}
function persistedLocalTrackKey(song) {
  if (!song) return '';
  return String(song.localFileId || song.localKey || '').replace(/^local:/, '');
}
// 会话快照里的本地曲目只存 localKey（blob URL 活不过重启）；
// 从启动时拉到的持久化曲库里换回带 mineradio-local:// 实时地址的那一条。
function findPersistedLocalTrack(song) {
  var key = persistedLocalTrackKey(song);
  if (!key || !Array.isArray(persistentLocalLibraryTracks)) return null;
  for (var i = 0; i < persistentLocalLibraryTracks.length; i++) {
    var track = persistentLocalLibraryTracks[i];
    if (track && persistedLocalTrackKey(track) === key) return track;
  }
  return null;
}
function rehydrateLocalSession(session) {
  if (!session || !isLocalSessionSong(session.song)) return session;
  var fresh = findPersistedLocalTrack(session.song);
  if (!fresh) return null;
  var next = Object.assign({}, session, { song: cloneSong(fresh) });
  if (Array.isArray(session.queue) && session.queue.length) {
    next.queue = session.queue.map(function (item) {
      if (!isLocalSessionSong(item)) return item;
      var freshItem = findPersistedLocalTrack(item);
      return freshItem ? cloneSong(freshItem) : item;
    });
  }
  return next;
}
function isLocalPlaybackSnapshot(snapshot) {
  var song = snapshot && (snapshot.song || snapshot.current);
  return isLocalSessionSong(song);
}
function restoredLocalTrackIndex(tracks, snapshot) {
  var current = (snapshot && (snapshot.song || snapshot.current)) || {};
  var localId = persistedLocalTrackKey(current);
  if (localId) {
    for (var i = 0; i < tracks.length; i++) {
      if (persistedLocalTrackKey(tracks[i]) === localId) return i;
    }
    return -1;
  }
  var fallback = Number(snapshot && snapshot.currentIdx);
  return isFinite(fallback) && fallback >= 0 && fallback < tracks.length ? Math.round(fallback) : 0;
}
// 启动时把持久化本地曲库读进内存；上一次播放的是本地曲目时，顺带把队列/进度恢复出来。
// 返回 true 表示「本地恢复已接管」，调用方不要再走普通会话恢复。
async function restorePersistedLocalLibrary() {
  if (!window.desktopWindow || typeof window.desktopWindow.listLocalMusicLibrary !== 'function') return false;
  var result;
  try { result = await window.desktopWindow.listLocalMusicLibrary(); } catch (e) { return false; }
  if (!result || result.ok !== true || !Array.isArray(result.tracks)) return false;
  var tracks = result.tracks.map(function (song) {
    var copy = hydrateCustomCover(Object.assign({}, song));
    copy.localMissing = false;
    return copy;
  }).filter(function (song) { return song && song.localUrl && song.localKey; });
  persistentLocalLibraryTracks = tracks.map(cloneSong);
  var session = typeof readPlaybackSession === 'function' ? readPlaybackSession() : null;
  if (!session || !session.song || !isLocalSessionSong(session.song)) return false;
  if (typeof restoredLastPlaybackSnapshot !== 'undefined' && restoredLastPlaybackSnapshot) return false;
  // 恢复期间用户已经手动放上了别的内容：不抢 playback
  if (typeof currentIdx !== 'undefined' && currentIdx >= 0 && typeof playing !== 'undefined' && playing) return false;
  var restoredIndex = restoredLocalTrackIndex(tracks, session);
  if (restoredIndex < 0 || !tracks[restoredIndex]) {
    // 曲库已不含这首（文件被删/移动）：清掉会话，别让恢复路径去放一个死地址
    try { localStorage.removeItem(PLAYBACK_SESSION_STORE_KEY); } catch (e) { }
    return false;
  }
  var resumeAt = (typeof startupResumeModePreference !== 'undefined' && startupResumeModePreference === 'beginning')
    ? 0
    : (Number(session.currentTime) || 0);
  if (typeof restoredLastPlaybackSnapshot !== 'undefined') restoredLastPlaybackSnapshot = session;
  if (typeof pendingPlaybackResumeAt !== 'undefined') pendingPlaybackResumeAt = resumeAt;
  var sessionForApply = resumeAt === (Number(session.currentTime) || 0)
    ? session
    : Object.assign({}, session, { currentTime: resumeAt });
  sessionForApply = rehydrateLocalSession(sessionForApply) || sessionForApply;
  var applyPromise = (typeof applyPlaybackSession === 'function')
    ? applyPlaybackSession(sessionForApply, { holdPaused: true, toast: false, manual: false, preserveHomeState: true, force: true })
    : Promise.resolve(false);
  Promise.resolve(applyPromise).then(function (applied) {
    if (!applied && typeof applyRestoredPlaybackProgressUi === 'function') {
      applyRestoredPlaybackProgressUi({ currentTime: resumeAt, duration: Number(session.duration) || 0, song: session.song });
    }
  }).catch(function (e) { console.warn('[LocalLibraryRestore]', e); });
  return true;
}
// 首页「导入本地音乐」：曲库非空直接排队播放，否则才开文件选择器
function loadPersistedLocalLibraryIntoQueue() {
  if (!Array.isArray(persistentLocalLibraryTracks) || !persistentLocalLibraryTracks.length) return false;
  return importLocalAudioSongs(persistentLocalLibraryTracks.map(cloneSong), { mode: 'persistent-library' });
}
function handleCoverFiles(files) {
  var imgFile = firstImageUploadFile(files);
  if (!imgFile) { showToast('没有找到可用的封面图片'); return; }
  loadCoverFromFile(imgFile, null);
  updateCustomCoverButton();
}
function openUploadPanel() {
  closeUploadTip(false);
  var actions = document.getElementById('upload-actions');
  var panel = document.getElementById('upload-panel');
  if (!panel) return;
  var hidden = !actions;
  if (!hidden) {
    try {
      var style = getComputedStyle(actions);
      hidden = style.display === 'none' || style.visibility === 'hidden' || actions.getClientRects().length === 0;
    } catch (e) { }
  }
  if (hidden) { triggerUploadInput('audio'); return; }
  panel.classList.add('show');
  var area = document.getElementById('search-area');
  if (area && typeof setPeek === 'function') setPeek(area, true, 'search');
}
function closeUploadPanel() {
  var panel = document.getElementById('upload-panel');
  if (panel) panel.classList.remove('show');
}
function toggleUploadPanel(event) {
  if (event) event.stopPropagation();
  var panel = document.getElementById('upload-panel');
  if (!panel) return;
  if (panel.classList.contains('show')) closeUploadPanel();
  else openUploadPanel();
}
function triggerUploadInput(kind) {
  var id = kind === 'cover' ? 'cover-input' : (kind === 'folder' ? 'folder-input' : 'file-input');
  var input = document.getElementById(id);
  closeUploadPanel();
  if (!input) return;
  try { input.click(); } catch (e) { console.warn('[LocalImport] failed to open file picker', e); }
}
document.addEventListener('click', function(e) {
  var panel = document.getElementById('upload-panel');
  if (!panel || !panel.classList.contains('show')) return;
  if (e.target && e.target.closest && e.target.closest('#upload-actions')) return;
  closeUploadPanel();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeUploadPanel();
});
function handleFiles(files) {
  var audioFiles = sortedAudioUploadFiles(files);
  var imgFile = firstImageUploadFile(files);
  if (audioFiles.length) {
    if (canUsePersistentLocalMusicLibrary()) {
      // desktop：写入持久化本地曲库（重启后仍在），失败才回落到会话内 blob
      showToast('正在读取 ' + audioFiles.length + ' 首本地音乐的标签与歌词…');
      importPersistentLocalAudioFiles(audioFiles).then(function (persisted) {
        var songs = persisted && persisted.tracks;
        if (!songs || !songs.length) throw new Error('LOCAL_LIBRARY_IMPORT_EMPTY');
        persistentLocalLibraryTracks = songs.map(cloneSong);
        if (persisted && Array.isArray(persisted.failures) && persisted.failures.length) {
          setTimeout(function () { showToast('有 ' + persisted.failures.length + ' 个文件无法读取，其余歌曲已保存'); }, 900);
        }
        importLocalAudioSongs(songs, { coverFile: audioFiles.length === 1 ? imgFile : null, mode: 'persistent-library' });
      }).catch(function (e) {
        console.warn('[LocalImport] persistent library unavailable, using this session only', e);
        importLocalAudioSongs(audioFiles.map(localSongFromAudioFile), { coverFile: audioFiles.length === 1 ? imgFile : null, mode: 'session-only' });
        setTimeout(function () { showToast('本地曲库保存失败：这些歌曲仅本次可用，重启后不会保留'); }, 260);
      });
      return;
    }
    // web / 非 desktop：blob URL 只活本次会话
    importLocalAudioSongs(audioFiles.map(localSongFromAudioFile), { coverFile: audioFiles.length === 1 ? imgFile : null, mode: 'session-only' });
    return;
  }
  if (imgFile) {
    handleCoverFiles([imgFile]);
    return;
  }
  showToast('没有找到可导入的音乐或封面文件');
}
var dropOv = document.getElementById('drop-overlay'), dragCount = 0;
document.addEventListener('dragenter', function(e){ e.preventDefault(); dragCount++; dropOv.classList.add('show'); });
document.addEventListener('dragleave', function(e){ e.preventDefault(); dragCount--; if (dragCount<=0){ dragCount=0; dropOv.classList.remove('show'); } });
document.addEventListener('dragover',  function(e){ e.preventDefault(); });
document.addEventListener('drop', function(e){
  e.preventDefault(); dragCount = 0; dropOv.classList.remove('show');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});
