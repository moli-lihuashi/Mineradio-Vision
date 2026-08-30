// ============================================================
//  Home 右下「LISTENING TODAY · 今日聆听」卡
//  - 三个统计位：聆听时长 / 今日歌曲 / 连续聆听（数据来自 listenStatsState.history）
//  - 点击「今日歌曲」：两侧统计压缩，中间横向展开今日听过的歌曲
//  - 鼠标移出卡片自动收起；点击历史歌曲走标准播放队列
// ============================================================
var listeningTodayState = { expanded: false, recent: [] };

function listeningTodayStats() {
  var history = (typeof listenStatsState !== 'undefined' && listenStatsState && listenStatsState.history) || [];
  var dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  var todayStart = dayStart.getTime();
  var todayMs = 0;
  var todayKeys = Object.create(null);
  var todayArtists = Object.create(null);
  var todayRecent = [];
  var daySet = Object.create(null);
  history.forEach(function (record) {
    var playedAt = Number(record && record.playedAt) || 0;
    if (!playedAt) return;
    var recordDay = new Date(playedAt);
    recordDay.setHours(0, 0, 0, 0);
    daySet[recordDay.getTime()] = true;
    if (playedAt >= todayStart) {
      todayMs += Number(record.listenMs) || 0;
      if (record.key && !todayKeys[record.key]) {
        todayKeys[record.key] = true;
        todayRecent.push(record);
      } else if (!record.key) {
        todayRecent.push(record);
      }
      var artist = String(record.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/)[0].trim();
      if (artist) todayArtists[artist] = (todayArtists[artist] || 0) + (Number(record.listenMs) || 0);
    }
  });
  // 连续聆听天数：从今天（今天还没听则从昨天）起往前数连续有收听记录的天数
  var streak = 0;
  var cursor = dayStart.getTime();
  if (!daySet[cursor]) cursor -= 86400000;
  while (daySet[cursor]) {
    streak += 1;
    cursor -= 86400000;
  }
  var topArtist = '';
  var bestMs = 0;
  Object.keys(todayArtists).forEach(function (name) {
    if (todayArtists[name] > bestMs) { bestMs = todayArtists[name]; topArtist = name; }
  });
  // 今日还没有记录时，降级展示最近 20 首，避免空条无法交互
  var recent = todayRecent.length ? todayRecent.slice(0, 20) : history.slice(0, 20);
  return {
    todayMs: todayMs,
    todayCount: Object.keys(todayKeys).length || todayRecent.length,
    streak: streak,
    topArtist: topArtist,
    recent: recent,
    todayOnly: !!todayRecent.length,
  };
}

function listeningTodayFormatDuration(ms) {
  var minutes = Math.floor((Number(ms) || 0) / 60000);
  if (minutes < 1) return '刚刚开始';
  if (minutes < 60) return minutes + ' 分钟';
  var hours = Math.floor(minutes / 60);
  var rest = minutes % 60;
  return rest ? hours + ' 小时 ' + rest + ' 分钟' : hours + ' 小时';
}

function renderListeningToday() {
  var card = document.getElementById('listening-today-card');
  if (!card) return;
  var stats = listeningTodayStats();
  listeningTodayState.recent = stats.recent;
  var durationEl = document.getElementById('lt-duration-value');
  if (durationEl) durationEl.textContent = listeningTodayFormatDuration(stats.todayMs);
  var countEl = document.getElementById('lt-today-count');
  if (countEl) countEl.textContent = stats.todayCount + ' 首';
  var streakEl = document.getElementById('lt-streak-value');
  if (streakEl) {
    var topArtist = stats.topArtist || (stats.streak > 0 ? stats.streak + ' 天' : '—');
    streakEl.textContent = topArtist;
    streakEl.title = topArtist;
  }
  var streakLabel = document.getElementById('lt-streak-label');
  if (streakLabel) streakLabel.textContent = '连续聆听 ' + stats.streak + ' 天';
  var todayBtn = document.getElementById('lt-stat-today');
  if (todayBtn) {
    var hint = todayBtn.querySelector('span');
    if (hint) hint.textContent = stats.todayOnly ? '今日歌曲 · 点击展开' : '最近听过 · 点击展开';
  }
  if (listeningTodayState.expanded) renderListeningTodayStrip();
}

function notifyListeningTodayGlass() {
  // 内容变化时让液态玻璃实例刷新该卡片的快照
  try {
    var mgr = window._liquidGlassMgr;
    var entry = mgr && mgr.get ? mgr.get('listeningToday') : null;
    var card = document.getElementById('listening-today-card');
    if (entry && entry.instance && entry.instance.markChanged && card) {
      entry.instance.markChanged(card);
      if (entry.instance._glassContentDirty && entry.instance._glassContentDirty.add) entry.instance._glassContentDirty.add(card);
      if (entry.instance._globalDirty !== undefined) entry.instance._globalDirty = true;
    }
  } catch (_error) { }
}

function toggleListeningTodayExpand(force) {
  var card = document.getElementById('listening-today-card');
  if (!card) return;
  var next = force == null ? !listeningTodayState.expanded : !!force;
  if (next) {
    // 展开前刷新一次数据，避免统计已变但条带仍是旧内容
    renderListeningToday();
    renderListeningTodayStrip();
  }
  listeningTodayState.expanded = next;
  card.classList.toggle('expanded', next);
  notifyListeningTodayGlass();
}

function collapseListeningToday() {
  if (!listeningTodayState.expanded) return;
  listeningTodayState.expanded = false;
  var card = document.getElementById('listening-today-card');
  if (card) card.classList.remove('expanded');
}

function renderListeningTodayStrip() {
  var strip = document.getElementById('lt-strip');
  if (!strip) return;
  var recent = listeningTodayState.recent || [];
  if (!recent.length) {
    strip.innerHTML = '<div class="lt-strip-empty">今天还没听过歌 · 播放几首后这里会记录</div>';
    return;
  }
  strip.innerHTML = recent.map(function (record, index) {
    var coverUrl = record.cover ? (typeof cssImageUrl === 'function' ? cssImageUrl(record.cover) : String(record.cover)) : '';
    var cover = coverUrl ? ' data-cover-src="' + escAttr(coverUrl) + '"' : '';
    var title = escAttr((record.name || '未知歌曲') + (record.artist ? ' - ' + record.artist : ''));
    return '<button class="lt-strip-item" type="button" data-lt-index="' + index + '" title="' + title + '">' +
      '<span class="lt-strip-cover"' + cover + '></span>' +
      '<span class="lt-strip-copy"><span class="lt-strip-name">' + escHtml(record.name || '未知歌曲') + '</span>' +
      '<span class="lt-strip-artist">' + escHtml(record.artist || '未知歌手') + '</span></span></button>';
  }).join('');
  var nodes = strip.querySelectorAll('.lt-strip-cover[data-cover-src]');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].style.backgroundImage = 'url("' + nodes[i].getAttribute('data-cover-src') + '")';
  }
  notifyListeningTodayGlass();
}

function listeningTodaySongFromRecord(record) {
  // key 前缀是音源真值（queueItemKey 生成），优先于 songFromListenRecord 的推断
  var key = String(record && record.key || '');
  var song = null;
  if (key.indexOf('kugou:') === 0) {
    song = { hash: key.slice(6), provider: 'kugou', source: 'kugou', type: 'kugou' };
  } else if (key.indexOf('qq:') === 0) {
    song = { mid: key.slice(3), songmid: key.slice(3), provider: 'qq', source: 'qq', type: 'qq' };
  } else if (key.indexOf('local:') === 0) {
    song = { localKey: key.slice(6), type: 'local', source: 'local', provider: 'local' };
  } else if (key.indexOf('podcast:') === 0) {
    song = { programId: key.slice(8), type: 'podcast', source: 'netease', provider: 'netease' };
  } else if (key.indexOf('qishui:') === 0) {
    song = { id: key.slice(7), provider: 'qishui', source: 'qishui', type: 'qishui' };
  } else if (key.indexOf('spotify:') === 0) {
    song = { id: key.slice(8), provider: 'spotify', source: 'spotify', type: 'spotify' };
  } else if (key.indexOf('song:') === 0) {
    song = { id: key.slice(5), provider: 'netease', source: 'netease', type: 'song' };
  }
  if (!song && typeof songFromListenRecord === 'function') {
    song = songFromListenRecord(record) || {};
  }
  song = song || {};
  if (record) {
    if (record.id) song.id = record.id;
    if (record.mid) { song.mid = record.mid; song.songmid = record.mid; }
    if (record.mediaMid) song.mediaMid = record.mediaMid;
    if (record.hash) song.hash = record.hash;
    if (record.albumAudioId) song.albumAudioId = record.albumAudioId;
    if (record.sourceKey) song.sourceKey = record.sourceKey;
    if (record.type && !song.type) song.type = record.type;
    if (record.provider) song.provider = record.provider;
    song.name = record.name || song.name || '';
    song.artist = record.artist || song.artist || '';
    song.cover = record.cover || song.cover || '';
  }
  song.provider = song.provider || song.source || song.sourceKey || 'netease';
  song.source = song.source || song.provider;
  // 避免把 name|artist 这种伪 key 当成网易云 id
  if (song.id && String(song.id).indexOf('|') >= 0 && !song.hash && !song.mid && !song.localKey) {
    song.id = '';
  }
  return song;
}

function listeningTodaySongPlayable(song) {
  if (!song) return false;
  if (song.hash || song.mid || song.songmid || song.localKey || song.programId) return true;
  if (song.id != null && song.id !== '' && String(song.id).indexOf('|') < 0) return true;
  return false;
}

function playListeningTodaySong(index) {
  var recent = listeningTodayState.recent || [];
  var record = recent[index];
  if (!record) return;
  var first = listeningTodaySongFromRecord(record);
  if (!listeningTodaySongPlayable(first)) {
    if (typeof showToast === 'function') showToast('这首暂时无法直接播放');
    if (record.name && typeof runHomeSearch === 'function') runHomeSearch(record.name);
    return;
  }
  if (typeof prepareLeaveHomeForPlayback === 'function') prepareLeaveHomeForPlayback();
  var queue = [];
  var playAt = 0;
  recent.forEach(function (item, i) {
    var song = listeningTodaySongFromRecord(item);
    if (!listeningTodaySongPlayable(song)) return;
    if (i === index) playAt = queue.length;
    queue.push(typeof cloneSong === 'function' ? cloneSong(song) : song);
  });
  if (!queue.length) {
    if (typeof showToast === 'function') showToast('这首暂时无法直接播放');
    return;
  }
  playQueue = queue;
  currentIdx = playAt;
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('listening-today', { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('listening-today', true);
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  collapseListeningToday();
  Promise.resolve(playQueueAt(currentIdx, {
    manual: true,
    context: { type: 'listening-today', playlistName: '今日歌曲' },
  })).catch(function (error) { console.warn('[ListeningTodayPlay]', error); });
}

function bindListeningToday() {
  var card = document.getElementById('listening-today-card');
  if (!card || card._ltBound) return;
  card._ltBound = true;
  card.addEventListener('mouseleave', function () { collapseListeningToday(); });
  bindListeningTodayStripDrag();
}

// 展开条：无滚动条，空白处/按住拖动可横滚；点在歌曲上优先播放，避免微抖吞点击
function bindListeningTodayStripDrag() {
  var strip = document.getElementById('lt-strip');
  if (!strip || strip._ltDragBound) return;
  strip._ltDragBound = true;
  var dragDown = false;
  var dragStartX = 0;
  var dragStartLeft = 0;
  var dragMoved = false;
  var DRAG_THRESHOLD = 14;

  strip.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    dragDown = true;
    dragMoved = false;
    dragStartX = e.pageX;
    dragStartLeft = strip.scrollLeft;
  });
  window.addEventListener('mousemove', function (e) {
    if (!dragDown) return;
    var dx = e.pageX - dragStartX;
    if (!dragMoved && Math.abs(dx) > DRAG_THRESHOLD) {
      dragMoved = true;
      strip.classList.add('dragging');
    }
    if (dragMoved) strip.scrollLeft = dragStartLeft - dx;
  });
  window.addEventListener('mouseup', function () {
    if (!dragDown) return;
    dragDown = false;
    strip.classList.remove('dragging');
    // 延迟清理，让随后的 click 仍能读到 dragMoved
    setTimeout(function () { dragMoved = false; }, 40);
  });
  // 委托点击：不依赖 inline onclick，且拖动后明确吞掉
  strip.addEventListener('click', function (e) {
    if (dragMoved) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    var item = e.target && e.target.closest ? e.target.closest('.lt-strip-item') : null;
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    var index = Number(item.getAttribute('data-lt-index'));
    if (!isFinite(index)) return;
    playListeningTodaySong(index);
  });
  strip.addEventListener('wheel', function (e) {
    if (!listeningTodayState.expanded) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
}

bindListeningToday();
renderListeningToday();
setInterval(function () {
  if (document.hidden || (typeof emptyHomeActive !== 'undefined' && !emptyHomeActive)) return;
  renderListeningToday();
}, 20000);
