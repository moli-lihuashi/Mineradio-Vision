/* Folia 面板型模组 · 渲染端宿主（2026-11-25）
 *
 * 和 17-folia-mod-host.js 是两条线：
 *   17 = 歌词样式模组（visualizers，注册成 Folia 世界的样式卡）
 *   18 = 面板型模组（homeTabs，一整个统计页面 + 主进程 RPC），本文件
 *
 * 接入的是 listening-archive v1.3.3（听歌档案）：它 activate 时注册 tab、命令、
 * 封面采集层，并开始按秒采样播放状态，通过 rpc 把记录交给主进程落盘。
 * 模组源码一行不改 —— 缺的能力在这里补齐或明确降级。
 *
 * 宿主契约（按模组实际调用面实现，不是抄 Folia 文档）：
 *   host.folium { major:1, minor:7 }   模组硬门槛，低于 7 直接 throw
 *   env.context = 'main'
 *   playback.getState() → { state:'playing'|'paused'|'stopped', song, position, duration }
 *     注意：模组采样器读的是 state 字符串，不是 playing 布尔；song 用 title/artist/album/source/id 五个字段
 *   playback.getQueue({offset,limit}) → { kind, currentIndex, length, items:[{index,song}] }
 *   playback.playSong(song) / enqueue(song)   song 必须带回宿主给的 ref
 *   events.on('playback.songChanged'|'stateChanged'|'seeked'|'failed', cb)
 *   every(ms, cb) / registries.{homeTabs,commands,stageLayers} / ui.{openHomeTab,toast}
 *   rpc.call(method, ...args) → preload → 主进程 index.cjs
 *   account.getState('netease') → null（本机档案不依赖网易云；云端档案需 Folia 1.7 的 platform.raw，本宿主不开放）
 */
'use strict';

var FOLIA_PANEL_HOST_VERSION = '1.0.0';
var FOLIA_PANEL_API = { major: 1, minor: 7 };
var FOLIA_PANEL_MOD_ROOT = 'folia-panel-mods/';

var foliaPanelState = {
  themeLight: null,
  loading: null,
  ready: false,
  mods: Object.create(null),      // modId -> { meta }
  tabs: Object.create(null),      // tabId -> { modId, def, mounted, cleanup, hostEl }
  commands: [],
  layers: [],
  listeners: Object.create(null), // eventName -> [cb]
  timers: [],                     // { ms, at, cb }
  pumping: null,
  last: { key: '', state: '', position: 0, at: 0 },
  errors: []
};

/* ---------------- 小工具 ---------------- */

function foliaPanelEl(id) { return document.getElementById(id); }

function foliaPanelUrl(rel) {
  try { return new URL(rel, document.baseURI).href; } catch (_) { return rel; }
}

function foliaPanelModLabel(label, fallback) {
  if (typeof label === 'string' && label) return label;
  if (label && typeof label === 'object') {
    return String(label['zh-CN'] || label.zh || label.en || fallback || '');
  }
  return String(fallback || '');
}

function foliaPanelNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/* ---------------- 播放状态（模组的唯一数据源） ---------------- */

function foliaPanelCurrentSong() {
  try {
    if (typeof playQueue !== 'undefined' && Array.isArray(playQueue) && typeof currentIdx === 'number'
        && currentIdx >= 0 && currentIdx < playQueue.length) {
      return playQueue[currentIdx] || null;
    }
  } catch (_) {}
  return null;
}

function foliaPanelSongId(song) {
  if (!song) return null;
  var raw = song.hash || song.mid || song.songmid || song.localKey || song.programId
    || (song.id != null && String(song.id) !== '' ? song.id : null);
  return raw == null ? null : String(raw);
}

/* 播放器歌曲 → 模组认的五个字段。
 * title/artist/album/source/id 会被主进程逐字段校验，缺一个整条记录就被丢掉；
 * ref 是模组判断「这首歌还能不能播」的唯一依据（gg / xg 里全是 !!u.ref）。 */
function foliaPanelSongForMod(song) {
  if (!song) return null;
  var title = String(song.name || song.title || '').trim();
  var artist = String(song.artist || song.singers || '').trim();
  if (!title) return null;
  var provider = String(song.provider || song.source || song.sourceKey || song.type || 'local');
  if (!provider || provider === 'undefined') provider = 'local';
  var ref = '';
  try { ref = typeof queueItemKey === 'function' ? String(queueItemKey(song) || '') : ''; } catch (_) {}
  return {
    title: title,
    artist: artist || '未知歌手',
    album: song.album ? String(song.album) : null,
    source: provider,
    id: foliaPanelSongId(song),
    ref: ref || ('idx:' + String(song.name || '') + '|' + artist)
  };
}

function foliaPanelPlaybackSnapshot() {
  var song = foliaPanelCurrentSong();
  var mapped = foliaPanelSongForMod(song);
  /* 局部不能叫 playing：一旦在本函数里声明，typeof playing 永远走局部，读不到全局那个。 */
  var isPlaying = false;
  try { isPlaying = (typeof playing !== 'undefined') && !!playing; } catch (_) {}
  var position = 0;
  var duration = 0;
  var volume = 1;
  var muted = false;
  try {
    if (typeof audio !== 'undefined' && audio) {
      position = isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
      duration = isFinite(audio.duration) ? Number(audio.duration) : 0;
      volume = isFinite(audio.volume) ? Number(audio.volume) : 1;
      muted = !!audio.muted;
      if (!isPlaying && !audio.paused) isPlaying = true;
    }
  } catch (_) {}
  if (!duration && typeof getPlaybackDurationSeconds === 'function') {
    try { duration = Number(getPlaybackDurationSeconds()) || 0; } catch (_) {}
  }
  /* paused 不等于 stopped：stopped 会让模组关闭当前记录（采样器 sample 里判的），
   * 只有真没歌时才该给 stopped。 */
  var state = 'stopped';
  if (mapped) state = isPlaying ? 'playing' : 'paused';
  return {
    kind: 'main',
    state: state,
    playing: state === 'playing',
    song: mapped,
    position: position,
    duration: Math.max(0, duration || 0),
    volume: volume,
    muted: muted
  };
}

/* 模组的 playSong / enqueue 必须靠 ref 反查队列项；队列可能已被重排，按内容 key 找。 */
function foliaPanelIndexForRef(ref, fallbackSong) {
  try {
    if (typeof playQueue !== 'undefined' && Array.isArray(playQueue)) {
      for (var i = 0; i < playQueue.length; i++) {
        var item = playQueue[i];
        if (!item) continue;
        var key = '';
        try { key = typeof queueItemKey === 'function' ? String(queueItemKey(item) || '') : ''; } catch (_) {}
        if (key && key === ref) return i;
      }
      if (fallbackSong) {
        var byRef = playQueue.indexOf(fallbackSong);
        if (byRef >= 0) return byRef;
      }
    }
  } catch (_) {}
  return -1;
}

function foliaPanelPlaySong(song) {
  var index = foliaPanelIndexForRef(song && song.ref, song && song.__raw);
  if (index < 0) return Promise.resolve(false);
  try {
    if (typeof prepareLeaveHomeForPlayback === 'function') prepareLeaveHomeForPlayback();
  } catch (_) {}
  return Promise.resolve()
    .then(function () {
      return playQueueAt(index, { manual: true, context: { type: 'listening-archive', playlistName: '听歌档案' } });
    })
    .then(function () { return true; })
    .catch(function (err) {
      console.warn('[FoliaPanel] playSong 失败:', err);
      return false;
    });
}

function foliaPanelEnqueue(song) {
  var index = foliaPanelIndexForRef(song && song.ref, song && song.__raw);
  if (index < 0) return false;
  try {
    if (typeof queueSong === 'function' && typeof playQueue !== 'undefined' && playQueue) {
      var copy = typeof cloneSong === 'function' ? cloneSong(playQueue[index]) : playQueue[index];
      queueSong(copy);
      if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('listening-archive');
      if (typeof safeShelfRebuild === 'function') safeShelfRebuild('listening-archive', true);
      return true;
    }
  } catch (err) {
    console.warn('[FoliaPanel] enqueue 失败:', err);
  }
  return false;
}

function foliaPanelQueue(opts) {
  var list = [];
  try { list = (typeof playQueue !== 'undefined' && Array.isArray(playQueue)) ? playQueue : []; } catch (_) {}
  var offset = Math.max(0, Math.round(Number(opts && opts.offset) || 0));
  var limit = Math.max(1, Math.round(Number(opts && opts.limit) || list.length || 1));
  var items = [];
  for (var i = offset; i < Math.min(list.length, offset + limit); i++) {
    var mapped = foliaPanelSongForMod(list[i]);
    if (!mapped) continue;
    /* __raw 只是本宿主反查队列项用的，必须不可枚举：模组 open() 时是 {...song} 浅拷贝，
     * 可枚举的话整个播放器歌曲对象会被抹进记录并跨 IPC 传。 */
    try {
      Object.defineProperty(mapped, '__raw', { value: list[i], enumerable: false, configurable: true });
    } catch (_) {}
    items.push({ index: i, song: mapped });
  }
  return {
    kind: 'main',
    currentIndex: (typeof currentIdx !== 'undefined') ? currentIdx : -1,
    length: list.length,
    items: items
  };
}

/* ---------------- 封面兜底捕获 ----------------
 *
 * 模组自带的 stageLayers 捕获实测在真实播放里从不落盘：判据全部成立
 * （song 相等、album 相等、URL 非空，见 diag-folia-live 的 [7c] would-capture），
 * 同样的 Image→canvas→toDataURL 在页面里手动跑也能出 10KB webp，
 * 但它内部 catch 是空的，异常被吞掉，artwork 目录始终为空。
 *
 * 所以宿主自己抓一遍：同一个 /api/cover 代理、同样 640px webp、同一套 be() key，
 * 存进同一个 archive.artwork.save。模组渲染时按 be(song) 查 artwork，自然命中。
 * 模组那一路保留着，谁先成功都一样（同 key 覆盖，内容等价）。
 */

var foliaPanelCoverState = { done: Object.create(null), busy: Object.create(null) };

function foliaPanelNormText(value) {
  return String(value == null ? '' : value).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/* 与模组 be(song) 完全一致：JSON.stringify([规范化标题, 规范化歌手数组排序]) */
function foliaPanelCoverKey(song) {
  if (!song) return '';
  var artists = String(song.artist || '').split(' / ').map(function (a) { return a.trim(); })
    .filter(Boolean).map(foliaPanelNormText).sort();
  return JSON.stringify([foliaPanelNormText(song.title), artists]);
}

function foliaPanelCaptureCover() {
  var raw = foliaPanelCurrentSong();
  if (!raw) return;
  var mapped = foliaPanelSongForMod(raw);
  var key = foliaPanelCoverKey(mapped);
  if (!key) return;
  if (foliaPanelCoverState.done[key] || foliaPanelCoverState.busy[key]) return;
  var cover = String(raw.cover || raw.coverUrl || '');
  if (!cover) return;
  var bridge = window.desktopWindow && window.desktopWindow.foliaPanel;
  if (!bridge || typeof bridge.rpc !== 'function') return;

  var url = cover;
  try { if (typeof coverProxySrc === 'function') url = coverProxySrc(cover) || cover; } catch (_) {}

  foliaPanelCoverState.busy[key] = 1;
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.decode().then(function () {
    var w = img.naturalWidth || 1;
    var h = img.naturalHeight || 1;
    var scale = Math.min(1, 640 / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.86);
  }).then(function (data) {
    if (!data || data.length < 200) throw new Error('封面数据为空');
    if (data.length > 1024 * 1024) throw new Error('封面超过 1MB');
    return bridge.rpc('listening-archive', 'archive.artwork.save', [key, data]);
  }).then(function (res) {
    if (!res || !res.ok) throw new Error((res && res.error) || '保存失败');
    foliaPanelCoverState.done[key] = 1;
    console.log('[FoliaPanel] 封面已缓存：' + mapped.title);
  }).catch(function (err) {
    console.warn('[FoliaPanel] 封面缓存失败：' + mapped.title, String((err && err.message) || err));
  }).then(function () {
    delete foliaPanelCoverState.busy[key];
  });
}

/* ---------------- 事件总线 ---------------- */

function foliaPanelEmit(name, payload) {
  var list = foliaPanelState.listeners[name];
  if (!list || !list.length) return;
  for (var i = list.length - 1; i >= 0; i--) {
    try { list[i](payload); } catch (err) { console.warn('[FoliaPanel] 事件回调失败', name, err); }
  }
}

function foliaPanelOn(name, cb) {
  if (typeof cb !== 'function') return function () {};
  var key = String(name || '');
  if (!foliaPanelState.listeners[key]) foliaPanelState.listeners[key] = [];
  foliaPanelState.listeners[key].push(cb);
  return function () {
    var list = foliaPanelState.listeners[key];
    if (!list) return;
    var i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  };
}

/* 状态泵：模组的 every(1000) 采样与 5s 结算都挂在这上面，
 * 事件（换歌 / 播放暂停 / 拖动 / 失败）也从这里推，避免模组自己去猜。 */
function foliaPanelPump() {
  foliaPanelBindAudioHooks();
  /* 封面兜底：模组那一路不落盘时由这里补。有 busy/done 去重，每 260ms 调一次也不贵。 */
  foliaPanelCaptureCover();
  var snap = foliaPanelPlaybackSnapshot();
  var key = snap.song ? String(snap.song.ref || '') + '|' + snap.song.title + '|' + snap.song.artist : '';
  var last = foliaPanelState.last;
  var now = Date.now();

  if (key !== last.key) {
    last.key = key;
    last.position = snap.position;
    last.at = now;
    last.state = snap.state;
    foliaPanelEmit('playback.songChanged', snap.song);
    foliaPanelEmit('playback.stateChanged', snap);
  } else {
    if (snap.state !== last.state) {
      last.state = snap.state;
      last.position = snap.position;
      last.at = now;
      foliaPanelEmit('playback.stateChanged', snap);
    } else if (snap.state === 'playing') {
      var wall = (now - last.at) / 1000;
      var delta = snap.position - last.position;
      /* 自然推进会贴近墙钟；差出 1.2s 以上只可能是 seek（或缓冲后跳回）。 */
      if (wall > 0 && delta > 0 && Math.abs(delta - wall) > 1.2) {
        foliaPanelEmit('playback.seeked', snap);
      }
      last.position = snap.position;
      last.at = now;
    }
  }

  /* every 定时器 */
  var mono = foliaPanelNow();
  for (var i = foliaPanelState.timers.length - 1; i >= 0; i--) {
    var timer = foliaPanelState.timers[i];
    if (mono >= timer.at) {
      timer.at = mono + timer.ms;
      try { timer.cb(); } catch (err) { console.warn('[FoliaPanel] every 回调失败:', err); }
    }
  }
}

function foliaPanelEvery(ms, cb) {
  if (typeof cb !== 'function') return function () {};
  var step = Math.max(120, Number(ms) || 1000);
  var timer = { ms: step, at: foliaPanelNow() + step, cb: cb };
  foliaPanelState.timers.push(timer);
  return function () {
    var i = foliaPanelState.timers.indexOf(timer);
    if (i >= 0) foliaPanelState.timers.splice(i, 1);
  };
}

/* audio 元素在启动早期可能是 null（12a 里先声明后赋值），所以挂监听做成惰性：
 * 泵每 260ms 跑一次，第一次拿到真元素时才绑，之后靠 audioBound 短路。 */
function foliaPanelBindAudioHooks() {
  if (foliaPanelState.audioBound) return;
  try {
    if (typeof audio === 'undefined' || !audio || !audio.addEventListener) return;
    foliaPanelState.audioBound = true;
    audio.addEventListener('error', function () {
      foliaPanelEmit('playback.failed', foliaPanelPlaybackSnapshot());
    });
    audio.addEventListener('ended', function () {
      foliaPanelEmit('playback.stateChanged', foliaPanelPlaybackSnapshot());
    });
  } catch (_) {}
}

function foliaPanelStartPump() {
  if (foliaPanelState.pumping) return;
  foliaPanelState.pumping = setInterval(foliaPanelPump, 260);
  foliaPanelBindAudioHooks();
}

/* ---------------- 面板 UI ---------------- */

function foliaPanelDom() {
  var root = foliaPanelEl('folia-panel');
  if (!root) return null;
  return root;
}

function foliaPanelMountTab(tabId) {
  var tab = foliaPanelState.tabs[tabId];
  if (!tab || tab.mounted) return true;
  var body = foliaPanelEl('folia-panel-body');
  /* 字段是平铺在 tab 上的（foliaPanelSealTabDef 的产物），不是 tab.def.mount —— 
   * 之前这里读 tab.def 导致永远 return false，面板打开了但一块内容都没挂。 */
  if (!body || typeof tab.mount !== 'function') return false;

  var host = document.createElement('div');
  host.className = 'fp-mount';
  host.setAttribute('data-folia-tab', tabId);
  body.appendChild(host);

  var self = { container: host, themeListeners: [] };
  var ctx = {
    get song() { return foliaPanelSongForMod(foliaPanelCurrentSong()); },
    getCoverUrl: function () {
      var song = foliaPanelCurrentSong();
      return song ? String(song.cover || song.coverUrl || '') : '';
    },
    getTheme: function () { return foliaPanelTheme(); },
    onChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      var list = self.themeListeners;
      list.push(cb);
      return function () {
        var i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
      };
    }
  };
  try {
    tab.cleanup = tab.mount(host, ctx) || null;
    tab.mounted = true;
    return true;
  } catch (err) {
    console.warn('[FoliaPanel] 面板挂载失败:', err);
    host.appendChild(foliaPanelErrorBox('听歌档案渲染失败：' + ((err && err.message) || err)));
    tab.mounted = true;
    return false;
  }
}

function foliaPanelErrorBox(text) {
  var box = document.createElement('div');
  box.className = 'fp-error';
  box.textContent = String(text || '');
  return box;
}


/* ---------------- 累计聆听时长卡（外壳，不碰模组） ----------------
 *
 * 模组只有「日/周/月/年」四个区间维度，没有「全部范围 + 累计 + 日均」。
 * 这张卡完全在宿主外壳里：范围按钮 → archive.query → 累加 summary.seconds。
 * archive.query 单次封顶 367 天（index.cjs 的 $() 里硬校验 end-start > 367*864e5 就抛
 * 「查询时间范围无效」），所以「全部」按 360 天窗口往前滚，其余档位一次查询。
 * 只累加时长：歌曲/歌手数跨窗口不能相加（会重复计数）。
 */
var foliaPanelSummary = {
  range: 'all', busy: false, loaded: false, at: 0, token: 0,
  seconds: 0, days: 1, error: false
};

function foliaPanelFmtDuration(sec) {
  var total = Math.max(0, Math.round(sec));
  var h = Math.floor(total / 3600);
  var m = Math.round((total % 3600) / 60);
  if (m === 60) { h += 1; m = 0; }
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  if (total >= 60) return m + ' 分钟';
  return total + ' 秒';
}

function foliaPanelFmtDay(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function foliaPanelSummaryRender(result) {
  var totalEl = document.getElementById('folia-panel-sum-total');
  var dailyEl = document.getElementById('folia-panel-sum-daily');
  var datesEl = document.getElementById('folia-panel-sum-dates');
  if (!totalEl) return;
  if (result.error) {
    totalEl.textContent = '—';
    if (dailyEl) dailyEl.textContent = '读取失败';
    return;
  }
  var sec = Math.max(0, Number(result.seconds) || 0);
  if (sec >= 3600) {
    var h = Math.floor(sec / 3600);
    var m = Math.round((sec % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    totalEl.innerHTML = h + '<small>小时</small>' + (m ? m + '<small>分</small>' : '');
  } else if (sec >= 60) {
    totalEl.innerHTML = Math.round(sec / 60) + '<small>分</small>';
  } else {
    totalEl.innerHTML = Math.round(sec) + '<small>秒</small>';
  }
  /* 展示用「今天」而不是查询终点（查询要 end=明天才含今天，否则今天的记录会被截掉） */
  var endShow = Math.min(result.end, Date.now());
  var days = Math.max(1, Math.round((endShow - result.first) / 86400000));
  if (dailyEl) {
    var perDay = sec / days;
    /* 只覆盖一天时「日均」等于累计，是废话，不显示 */
    dailyEl.innerHTML = days >= 2
      ? (perDay >= 1 ? '日均 <b>' + foliaPanelFmtDuration(perDay) + '</b> · 覆盖 ' + days + ' 天' : '覆盖 ' + days + ' 天')
      : '今天起记录';
  }
  if (datesEl) datesEl.innerHTML = foliaPanelFmtDay(result.first) + '<i>→</i>' + foliaPanelFmtDay(endShow);
}

function foliaPanelSummaryLoad(force) {
  var st = foliaPanelSummary;
  var bridge = window.desktopWindow && window.desktopWindow.foliaPanel;
  if (!bridge || typeof bridge.rpc !== 'function') return;
  if (st.busy) return;
  if (!force && st.loaded && Date.now() - st.at < 3000) return;

  st.busy = true;
  var token = ++st.token;
  var now = Date.now() + 86400000;   /* 含今天 */
  var range = st.range;
  var WINDOW = 360 * 86400000;

  function finish(result) {
    if (token !== st.token) return;   /* 档位已切走，丢弃这次结果 */
    st.busy = false;
    st.loaded = true;
    st.at = Date.now();
    st.error = !!result.error;
    st.seconds = Number(result.seconds) || 0;
    st.days = Math.max(1, Math.round((Math.min(result.end, Date.now()) - result.first) / 86400000));
    foliaPanelSummaryRender(result);
  }

  if (range === 'all') {
    var total = 0;
    var first = null;
    var guard = 0;
    (function step(end) {
      if (guard++ > 12) { finish({ seconds: total, first: first || end, end: now }); return; }
      var start = Math.max(0, end - WINDOW);
      bridge.rpc('listening-archive', 'archive.query', [{ start: start, end: end, period: 'year' }])
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'query failed');
          var value = res.value || {};
          var summary = value.summary || {};
          total += Number(summary.seconds) || 0;
          if (value.firstRecorded && (!first || value.firstRecorded < first)) first = value.firstRecorded;
          /* recordCount 是整个档案的条数，判断「还有更早数据」会永远为真 */
          var hasData = (Number(summary.seconds) || 0) > 0 || (value.songs || []).length > 0;
          if (start > 0 && hasData) step(start);
          else finish({ seconds: total, first: first || now, end: now });
        })
        .catch(function (err) {
          console.warn('[FoliaPanel] 累计查询失败:', err);
          finish({ seconds: total, first: first || now, end: now, error: true });
        });
    })(now);
    return;
  }

  var from = now - Number(range) * 86400000;
  bridge.rpc('listening-archive', 'archive.query', [{ start: from, end: now, period: 'year' }])
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'query failed');
      var value = res.value || {};
      var summary = value.summary || {};
      finish({ seconds: Number(summary.seconds) || 0, first: from, end: now });
    })
    .catch(function (err) {
      console.warn('[FoliaPanel] 累计查询失败:', err);
      finish({ seconds: 0, first: from, end: now, error: true });
    });
}

function foliaPanelSetRange(range) {
  var st = foliaPanelSummary;
  if (!range || st.range === range) return;
  st.range = range;
  st.loaded = false;
  var root = document.getElementById('folia-panel-summary');
  if (root) {
    var btns = root.querySelectorAll('[data-fp-range]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-fp-range') === range);
    }
  }
  foliaPanelSummaryLoad(true);
}

/* ---------------- 近 30 天趋势 + AI 月度总结 ---------------- */

var foliaPanelMonth = { loaded: false, at: 0, stats: null };
var foliaPanelAi = { busy: false };

function foliaPanelDrawTrend(buckets) {
  var svg = document.querySelector('#folia-panel-sum-trend svg');
  if (!svg) return;
  var lineEl = svg.querySelector('.fp-trend-line');
  var areaEl = svg.querySelector('.fp-trend-area');
  if (!lineEl || !areaEl) return;
  var vals = (buckets || []).map(function (b) { return Number(b.seconds) || 0; });
  if (!vals.length) { lineEl.setAttribute('d', ''); areaEl.setAttribute('d', ''); return; }
  var W = 240;
  var H = 52;
  var PAD = 4;
  var max = Math.max.apply(null, vals.concat([1]));
  var stepX = vals.length > 1 ? (W - PAD * 2) / (vals.length - 1) : 0;
  /* 30 个点里通常只有几天有数据，折线会是「平地→尖峰→平地」。
   * 用二次贝塞尔过中点做平滑，尖峰变成圆顶，看起来才像趋势而不是坏图。 */
  var pts = [];
  for (var i = 0; i < vals.length; i++) {
    pts.push([PAD + i * stepX, H - PAD - (vals[i] / max) * (H - PAD * 2)]);
  }
  var d = 'M' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
  for (var k = 1; k < pts.length - 1; k++) {
    var mx = (pts[k][0] + pts[k + 1][0]) / 2;
    var my = (pts[k][1] + pts[k + 1][1]) / 2;
    d += ' Q' + pts[k][0].toFixed(2) + ' ' + pts[k][1].toFixed(2) + ' ' + mx.toFixed(2) + ' ' + my.toFixed(2);
  }
  var last = pts[pts.length - 1];
  d += ' L' + last[0].toFixed(2) + ' ' + last[1].toFixed(2);
  var baseY = (H - PAD).toFixed(2);
  lineEl.setAttribute('d', d);
  areaEl.setAttribute('d', d + ' L' + last[0].toFixed(2) + ' ' + baseY + ' L' + PAD + ' ' + baseY + ' Z');
}

/* habits 是 168 格（星期×24 小时）：先按小时归并，再取峰值小时 */
function foliaPanelPeakHour(habits) {
  if (!Array.isArray(habits) || !habits.length) return null;
  var byHour = new Array(24).fill(0);
  for (var i = 0; i < habits.length; i++) byHour[i % 24] += Number(habits[i]) || 0;
  var best = 0;
  for (var h = 1; h < 24; h++) if (byHour[h] > byHour[best]) best = h;
  return byHour[best] > 0 ? best : null;
}

function foliaPanelMonthLoad(cb) {
  var bridge = window.desktopWindow && window.desktopWindow.foliaPanel;
  if (!bridge || typeof bridge.rpc !== 'function') return;
  var now = Date.now() + 86400000;
  /* period 用 month：W() 在 month 档按「天」分桶，正好是 30 个柱 */
  bridge.rpc('listening-archive', 'archive.query', [{ start: now - 30 * 86400000, end: now, period: 'month' }])
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'query failed');
      var value = res.value || {};
      foliaPanelMonth.loaded = true;
      foliaPanelMonth.at = Date.now();
      foliaPanelMonth.stats = value;
      foliaPanelDrawTrend(value.buckets || []);
      if (typeof cb === 'function') cb(null, value);
    })
    .catch(function (err) {
      console.warn('[FoliaPanel] 30 天趋势查询失败:', err);
      if (typeof cb === 'function') cb(err);
    });
}

/* 把模型输出（**加粗** + 空行分段）渲染成 HTML：
 * 第一行整块加粗的当人格标签，其余段把 **引导句** 变 <strong>。 */
function foliaPanelAiRenderText(text) {
  var api = window.Mineradio && window.Mineradio.api;
  var esc = (api && typeof api.escHtml === 'function') ? api.escHtml : function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var blocks = String(text || '').split(/\n{2,}/);
  var html = '';
  for (var i = 0; i < blocks.length; i++) {
    var raw = blocks[i].trim();
    if (!raw) continue;
    if (/^\*\*[^*\n]{2,40}\*\*$/.test(raw)) {
      html += '<h3 class="fp-ai-name">' + esc(raw.replace(/^\*\*/, '').replace(/\*\*$/, '')) + '</h3>';
      continue;
    }
    html += '<p>' + esc(raw).replace(/\*\*([^*\n]{1,60})\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
  }
  if (!html) html = '<span class="fp-ai-hint">' + esc(text || '模型没有返回内容') + '</span>';
  return html;
}

/* Dissolve 状态球：生成中转圈、成功变对勾、失败散落。
 * vendor 缺失时返回 null，调用方退回纯文字提示。 */
var foliaPanelAiOrb = null;

function foliaPanelAiOrbDestroy() {
  if (!foliaPanelAiOrb) return;
  try { foliaPanelAiOrb.inst.destroy(); } catch (_) {}
  foliaPanelAiOrb = null;
}

function foliaPanelAiOrbMount(state) {
  var body = document.getElementById('folia-panel-ai-body');
  var api = window.DissolveThinkingOrb;
  if (!body || !api || typeof api.mount !== 'function') return null;
  foliaPanelAiOrbDestroy();
  body.classList.remove('is-error');
  body.innerHTML = '';
  var box = document.createElement('div');
  box.className = 'fp-ai-orb';
  body.appendChild(box);
  var label = document.createElement('p');
  label.className = 'fp-ai-orb-label';
  label.textContent = '正在读最近 30 天的听歌记录…';
  body.appendChild(label);
  /* 颜色跟外壳的强调色走，深浅主题都不会糊在背景里 */
  var color = '#b8a4e7';
  try {
    var host = document.getElementById('folia-panel');
    var v = host && getComputedStyle(host).getPropertyValue('--fp-accent');
    if (v && v.trim()) color = v.trim();
  } catch (_) {}
  try {
    var inst = api.mount(box, {
      state: state || 'thinking',
      size: 92,
      dots: 180,
      interactive: true,
      haptics: false,
      color: color
    });
    foliaPanelAiOrb = { inst: inst, label: label };
  } catch (err) {
    console.warn('[FoliaPanel] 状态球挂载失败:', err);
    foliaPanelAiOrb = null;
  }
  return foliaPanelAiOrb;
}

function foliaPanelAiOrbState(state, text) {
  if (!foliaPanelAiOrb) return;
  try { foliaPanelAiOrb.inst.update({ state: state }); } catch (_) {}
  if (text && foliaPanelAiOrb.label) foliaPanelAiOrb.label.textContent = text;
}

/* ---------------- AI 生成中的点阵动画 ----------------
 *
 * 来源是用户给的「Dot Grid Loader」（React + createSurface/Shadow DOM）。
 * 项目零构建、无 React，所以只把这套动效的数学原样移植到 canvas：
 *   20×20 网格，两个椭圆轨道焦点，距离 < r 时 intensity = (1 - d/r)^1.4 * weight，
 *   scale 0.333→0.65、颜色 base→active 线性插值。
 * 每帧 400 个 arc，比 400 个 div 改 style 便宜得多。
 */
var foliaPanelDots = { raf: 0, canvas: null };

function foliaPanelDotsStop() {
  if (foliaPanelDots.raf) {
    cancelAnimationFrame(foliaPanelDots.raf);
    foliaPanelDots.raf = 0;
  }
  foliaPanelDots.canvas = null;
}

function foliaPanelDotsStart(canvas) {
  foliaPanelDotsStop();
  if (!canvas || typeof canvas.getContext !== 'function') return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var light = foliaPanelThemeIsLight();
  var baseRGB = light ? [228, 228, 231] : [54, 54, 62];
  var activeRGB = light ? [150, 150, 150] : [198, 194, 212];

  var side = Math.max(120, Math.round(canvas.clientWidth || 260));
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(side * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var cols = 20;
  var rows = 20;
  var cell = side / cols;
  var minR = cell * 0.11;
  var maxR = cell * 0.216;
  var effectRadius = side * 0.26;   /* 原版 110 / 420 */
  var half = (cols - 1) / 2;
  var mid = side / 2;

  var dots = [];
  for (var i = 0; i < rows * cols; i++) {
    dots.push({
      x: mid + ((i % cols) - half) * cell,
      y: mid + (Math.floor(i / cols) - half) * cell
    });
  }

  /* 原版 rx/ry 是 90/420、70/420、70/420、95/420，这里按比例换成 side 的倍数 */
  var orbs = [
    { rx: 0.214, ry: 0.167, sx: 0.7, sy: 1.1, px: 0, py: 0, pulse: 0 },
    { rx: 0.167, ry: 0.226, sx: -1.2, sy: 0.8, px: 2, py: 1.5, pulse: 0.35 }
  ];

  foliaPanelDots.canvas = canvas;

  function frame(ts) {
    var time = ts * 0.0012;
    var focus = [];
    for (var k = 0; k < orbs.length; k++) {
      var o = orbs[k];
      focus.push({
        x: mid + Math.sin(time * o.sx + o.px) * side * o.rx,
        y: mid + Math.cos(time * o.sy + o.py) * side * o.ry,
        w: o.pulse > 0 ? (Math.sin(time * o.pulse) + 1) / 2 : 1
      });
    }

    ctx.clearRect(0, 0, side, side);
    for (var n = 0; n < dots.length; n++) {
      var d = dots[n];
      var sum = 0;
      for (var f = 0; f < focus.length; f++) {
        var dx = focus[f].x - d.x;
        var dy = focus[f].y - d.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < effectRadius) {
          sum += Math.pow(1 - dist / effectRadius, 1.4) * focus[f].w;
        }
      }
      if (sum > 1) sum = 1;

      var rr = Math.round(baseRGB[0] + (activeRGB[0] - baseRGB[0]) * sum);
      var gg = Math.round(baseRGB[1] + (activeRGB[1] - baseRGB[1]) * sum);
      var bb = Math.round(baseRGB[2] + (activeRGB[2] - baseRGB[2]) * sum);

      ctx.beginPath();
      ctx.arc(d.x, d.y, minR + (maxR - minR) * sum, 0, 6.2832);
      ctx.fillStyle = 'rgb(' + rr + ',' + gg + ',' + bb + ')';
      ctx.fill();
    }

    foliaPanelDots.raf = requestAnimationFrame(frame);
  }

  foliaPanelDots.raf = requestAnimationFrame(frame);
}

function foliaPanelAiShow(html, isError) {
  var panel = document.getElementById('folia-panel-ai');
  var body = document.getElementById('folia-panel-ai-body');
  if (!panel || !body) return;
  foliaPanelAiOrbDestroy();
  panel.hidden = false;
  body.classList.toggle('is-error', !!isError);
  body.innerHTML = html;
}

function foliaPanelAiClose() {
  var panel = document.getElementById('folia-panel-ai');
  if (panel) panel.hidden = true;
}

function foliaPanelAiBuildStats(value) {
  var s = (value && value.summary) || {};
  return {
    totalText: foliaPanelFmtDuration(Number(s.seconds) || 0),
    plays: Number(s.plays) || 0,
    songs: Number(s.songs) || 0,
    artists: Number(s.artists) || 0,
    albums: Number(s.albums) || 0,
    newShare: Number(s.newShare) || 0,
    topShare: Number(s.topShare) || 0,
    topSongs: (value.songs || []).slice(0, 5).map(function (x) {
      return { name: x.name, artist: x.subtitle, seconds: x.seconds };
    }),
    topArtists: (value.artists || []).slice(0, 3).map(function (x) { return x.name; }),
    peakHour: foliaPanelPeakHour(value.habits)
  };
}

function foliaPanelAiRun() {
  if (foliaPanelAi.busy) return;
  var api = window.Mineradio && window.Mineradio.api;
  if (!api || typeof api.apiJson !== 'function') { foliaPanelAiShow('接口封装不可用', true); return; }
  foliaPanelAi.busy = true;
  /* 先把浮层打开：canvas 要量容器宽度，刚显示那一帧还没布局，量到 0 就画不出来 */
  var aiPanel = document.getElementById('folia-panel-ai');
  if (aiPanel) aiPanel.hidden = false;
  foliaPanelAiShow(
    '<div class="fp-ai-loading">'
    + '<canvas class="fp-ai-dots" width="260" height="260" aria-hidden="true"></canvas>'
    + '<p class="fp-ai-loading-text">正在读你最近 30 天的听歌记录…</p>'
    + '<p class="fp-ai-loading-sub">通常 10–30 秒</p>'
    + '</div>', false);
  requestAnimationFrame(function () {
    foliaPanelDotsStart(document.querySelector('#folia-panel-ai-body .fp-ai-dots'));
  });

  function run(stats) {
    api.apiJson('/api/ai/listen-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: 30, stats: stats }),
      timeoutMs: 70000
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.message) || '生成失败');
      var text = String(res.summary || '').trim();
      if (!text) throw new Error('模型返回为空');
      foliaPanelDotsStop();
      foliaPanelAiShow(foliaPanelAiRenderText(text), false);
    }).catch(function (err) {
      var msg = String((err && err.data && err.data.message) || (err && err.message) || err);
      foliaPanelDotsStop();
      foliaPanelAiShow('生成失败：' + api.escHtml(msg)
        + '<br><span class="fp-ai-hint">在「设置 → AI」里确认 API Key 与模型 ID 已填写并测试通过。</span>', true);
    }).then(function () { foliaPanelAi.busy = false; });
  }

  if (foliaPanelMonth.loaded && Date.now() - foliaPanelMonth.at < 60000) {
    run(foliaPanelAiBuildStats(foliaPanelMonth.stats));
    return;
  }
  foliaPanelMonthLoad(function (err, value) {
    if (err) { foliaPanelAi.busy = false; foliaPanelAiShow('读取最近 30 天统计失败', true); return; }
    run(foliaPanelAiBuildStats(value));
  });
}

function foliaPanelOpenTab(tabId) {
  var root = foliaPanelDom();
  if (!root) return false;
  var tab = foliaPanelState.tabs[tabId];
  if (!tab) {
    if (typeof showToast === 'function') showToast('听歌档案还在加载，稍等一下再点');
    return false;
  }
  /* 先让容器可见再 mount：隐藏容器里量到的尺寸是 0，模组的图表会按 0 宽画。 */
  root.classList.add('show');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('folia-panel-open');
  var lightNow = foliaPanelThemeIsLight();
  if (foliaPanelState.themeLight == null) {
    foliaPanelState.themeLight = lightNow;
  } else if (foliaPanelState.themeLight !== lightNow) {
    foliaPanelState.themeLight = lightNow;
    foliaPanelRemountTab(tabId);   /* 主题变了：重建一次，让它读到新的 isDaylight */
  }
  requestAnimationFrame(function () { foliaPanelMountTab(tabId); });
  foliaPanelSummaryLoad();
  foliaPanelMonthLoad();
  return true;
}

function foliaPanelClose() {
  var root = foliaPanelDom();
  if (!root) return;
  root.classList.remove('show');
  root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('folia-panel-open');
  /* 关闭不销毁 React 树：模组的 tab 状态（筛选、搜索、滚动位置）要留住，
   * 下次打开是接着看而不是从零渲染。真正销毁只在卸载模组时。 */
}

function foliaPanelBindUi() {
  var root = foliaPanelDom();
  if (!root || root.__fpBound) return;
  root.__fpBound = true;
  root.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-fp-close]') || t === root) { foliaPanelClose(); return; }
    var rangeBtn = t.closest('[data-fp-range]');
    if (rangeBtn) {
      foliaPanelSetRange(rangeBtn.getAttribute('data-fp-range'));
      return;
    }
    if (t.closest('[data-fp-ai]')) { foliaPanelAiRun(); return; }
    if (t.closest('[data-fp-ai-close]')) { foliaPanelAiClose(); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!root.classList.contains('show')) return;
    e.preventDefault();
    foliaPanelClose();
  });
}

/* ---------------- 宿主 API ---------------- */

/* 应用「设置 → 外观」把解析后的主题写在 <html data-theme>（system 已解析成 light/dark）。
 * 项目默认深色：没设过这个属性就按深色走。 */
function foliaPanelThemeIsLight() {
  try {
    var root = document.documentElement;
    if (!root) return false;
    return root.getAttribute('data-theme') === 'light';
  } catch (_) { return false; }
}

function foliaPanelTheme() {
  var fontStack = 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif';
  try {
    var probe = document.body ? getComputedStyle(document.body) : null;
    var custom = probe && probe.getPropertyValue('--font-sans');
    if (custom && custom.trim()) fontStack = custom.trim();
  } catch (_) {}
  var light = foliaPanelThemeIsLight();
  /* 模组的 .daylight 只覆盖 --cover-*（封面玻璃/文字），主体配色完全靠宿主给的
   * backgroundColor/primaryColor/secondaryColor/accentColor（它写进 inline 的 --bg/--ink/...）。
   * 少给这几个，daylight 加了也只换封面、主体仍是深色（实测过）。 */
  return {
    fontStack: fontStack,
    mode: light ? 'light' : 'dark',
    isDaylight: light,
    backgroundColor: light ? '#f8f7fc' : '#15171e',
    primaryColor: light ? '#1b1a24' : '#eeeaf7',
    secondaryColor: light ? 'rgba(27,26,36,.60)' : '#9e9baa',
    accentColor: light ? '#6a5ad0' : '#b8a4e7'
  };
}

/* 换主题后模组不会自己重算：它只在挂载时读一次 theme。
 * 所以主题变了要销毁重挂（只在新旧不同时发生，不会每次打开都重建）。 */
function foliaPanelRemountTab(tabId) {
  var tab = foliaPanelState.tabs[tabId];
  if (!tab) return;
  try { if (typeof tab.cleanup === 'function') tab.cleanup(); } catch (_) {}
  var body = foliaPanelEl('folia-panel-body');
  if (body) body.innerHTML = '';
  tab.mounted = false;
  tab.cleanup = null;
  foliaPanelMountTab(tabId);
}

function foliaPanelCreateKv(prefix) {
  return {
    get: function (key) {
      return Promise.resolve().then(function () {
        try {
          var raw = localStorage.getItem(prefix + key);
          return raw == null ? null : JSON.parse(raw);
        } catch (_) { return null; }
      });
    },
    set: function (key, value) {
      return Promise.resolve().then(function () {
        try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
        catch (_) { return false; }
      });
    },
    remove: function (key) {
      return Promise.resolve().then(function () {
        try { localStorage.removeItem(prefix + key); return true; }
        catch (_) { return false; }
      });
    }
  };
}

function foliaPanelBuildHostApi(meta) {
  var modId = String(meta.id || '');
  var rpc = {
    call: function (method) {
      var args = [].slice.call(arguments, 1);
      var bridge = (typeof window !== 'undefined' && window.desktopWindow && window.desktopWindow.foliaPanel) || null;
      if (!bridge || typeof bridge.rpc !== 'function') {
        return Promise.reject(new Error('桌面桥不可用（非 Electron 环境）'));
      }
      return bridge.rpc(modId, method, args).then(function (res) {
        if (res && res.ok) return res.value;
        throw new Error((res && res.error) || '模组接口调用失败');
      });
    }
  };

  return {
    version: FOLIA_PANEL_HOST_VERSION,
    host: { version: FOLIA_PANEL_HOST_VERSION, folium: FOLIA_PANEL_API },
    env: {
      context: 'main',
      platform: 'desktop',
      locale: (typeof navigator !== 'undefined' && navigator.language) || 'zh-CN'
    },
    mod: { id: modId, version: String(meta.version || ''), dir: String(meta.dir || '') },
    storage: foliaPanelCreateKv('folia-panel:' + modId + ':'),
    secrets: foliaPanelCreateKv('folia-panel-secret:' + modId + ':'),
    net: { fetch: function (url, init) { return fetch(url, init); } },
    log: {
      info: function () { console.log.apply(console, ['[FoliaPanel:' + modId + ']'].concat([].slice.call(arguments))); },
      warn: function () { console.warn.apply(console, ['[FoliaPanel:' + modId + ']'].concat([].slice.call(arguments))); },
      error: function () { console.error.apply(console, ['[FoliaPanel:' + modId + ']'].concat([].slice.call(arguments))); }
    },
    theme: {
      resolveFontStack: function () { return foliaPanelTheme().fontStack; },
      resolveTranslationFontStack: function () { return foliaPanelTheme().fontStack; },
      resolveFontWeight: function (_theme, fallback) {
        var f = Number(fallback);
        return isFinite(f) && f > 0 ? f : 600;
      }
    },
    playback: {
      getState: foliaPanelPlaybackSnapshot,
      getQueue: foliaPanelQueue,
      getLoopMode: function () {
        try {
          if (playMode === 'single') return 'one';
          if (playMode === 'shuffle' || playMode === 'loop') return 'all';
        } catch (_) {}
        return 'off';
      },
      play: function () { try { if (typeof togglePlay === 'function' && !foliaPanelPlaybackSnapshot().playing) togglePlay(); } catch (_) {} },
      pause: function () { try { if (typeof togglePlay === 'function' && foliaPanelPlaybackSnapshot().playing) togglePlay(); } catch (_) {} },
      toggle: function () { try { if (typeof togglePlay === 'function') togglePlay(); } catch (_) {} },
      next: function () { try { if (typeof nextTrack === 'function') nextTrack(); } catch (_) {} },
      previous: function () { try { if (typeof prevTrack === 'function') prevTrack(); } catch (_) {} },
      seek: function (t) {
        try {
          if (typeof audio !== 'undefined' && audio && isFinite(t)) audio.currentTime = Math.max(0, Number(t));
        } catch (_) {}
      },
      playSong: foliaPanelPlaySong,
      enqueue: foliaPanelEnqueue
    },
    events: { on: foliaPanelOn },
    every: foliaPanelEvery,
    rpc: rpc,
    ui: {
      openHomeTab: function (tabId) { foliaPanelOpenTab(String(tabId || 'archive')); },
      toast: function (msg, opts) {
        try {
          if (typeof showToast === 'function') showToast(String(msg || ''));
          else console.log('[FoliaPanel] toast:', msg, opts || '');
        } catch (_) {}
      }
    },
    account: {
      /* 本机档案不需要账号。网易云档案要 Folia 1.7 的 platform.raw，本宿主不开放，
       * 返回 null 让模组落到「先在 Folia 登录网易云」的安全分支，不伪造登录态。 */
      getState: function () { return null; },
      onChange: function () { return function () {}; }
    },
    experimental: {},
    registries: {
      homeTabs: {
        register: function (def) {
          if (!def || typeof def.id !== 'string' || !def.id) {
            foliaPanelState.errors.push({ modId: modId, error: 'homeTabs 条目缺少 id' });
            return { unregister: function () {} };
          }
          var copy = foliaPanelSealTabDef(def, modId);
          foliaPanelState.tabs[def.id] = copy;
          console.log('[FoliaPanel] 注册面板标签', def.id, '←', modId);
          return {
            unregister: function () {
              var tab = foliaPanelState.tabs[def.id];
              if (tab && tab.modId === modId) {
                try { if (typeof tab.cleanup === 'function') tab.cleanup(); } catch (_) {}
                delete foliaPanelState.tabs[def.id];
              }
            }
          };
        }
      },
      commands: {
        register: function (def) {
          if (!def || !def.id) return { unregister: function () {} };
          var entry = { modId: modId, def: def };
          foliaPanelState.commands.push(entry);
          return {
            unregister: function () {
              var i = foliaPanelState.commands.indexOf(entry);
              if (i >= 0) foliaPanelState.commands.splice(i, 1);
            }
          };
        }
      },
      stageLayers: {
        register: function (def) {
          if (!def || !def.id || typeof def.mount !== 'function') return { unregister: function () {} };
          var layer = foliaPanelMountLayer(def, modId);
          foliaPanelState.layers.push(layer);
          return { unregister: function () { foliaPanelUnmountLayer(layer); } };
        }
      },
      /* 面板模组不用的面：给空实现，避免 activate 阶段 undefined.register 崩掉。 */
      visualizers: { register: function () { return null; } },
      settingsSections: { register: function () { return { unregister: function () {} }; } },
      progressButtons: { register: function () { return null; } },
      tunings: { register: function () { return null; } },
      backgrounds: { register: function () { return null; } }
    }
  };
}

function foliaPanelSealTabDef(def, modId) {
  return {
    id: String(def.id),
    modId: modId,
    label: def.label,
    order: isFinite(Number(def.order)) ? Number(def.order) : 500,
    mount: def.mount,
    mounted: false,
    cleanup: null
  };
}

/* 封面采集层：模组把当前封面画到 canvas 再存进模组数据目录（跨域封面会静默失败，
 * 这是模组自己的降级，不影响记录）。容器是覆盖全屏但不吃事件的空层。 */
function foliaPanelMountLayer(def, modId) {
  var host = foliaPanelEl('folia-panel-stage');
  var layer = { id: String(def.id), modId: modId, cleanup: null, hostEl: null };
  if (!host) return layer;
  var slot = def.slot === 'app.overlay' ? 'app.overlay' : String(def.slot || 'app.overlay');
  var el = document.createElement('div');
  el.className = 'fp-stage-layer';
  el.setAttribute('data-folia-layer', layer.id);
  el.setAttribute('data-folia-slot', slot);
  host.appendChild(el);
  layer.hostEl = el;

  var listeners = [];
  var ctx = {
    /* 必须是 getter：模组 bg() 每次都读 d.song 与 d.getCoverUrl() 比较是否同一首，
     * 写成固定值的话第二首歌起 song 永远停在挂载时那首，封面再也捕获不到。 */
    get song() { return foliaPanelSongForMod(foliaPanelCurrentSong()); },
    getCoverUrl: function () {
      var song = foliaPanelCurrentSong();
      if (!song) return '';
      var raw = String(song.cover || song.coverUrl || '');
      if (!raw) return '';
      /* 模组要 canvas.toDataURL()，跨域封面会污染画布 → 一律走同源 /api/cover 代理。 */
      try {
        if (typeof coverProxySrc === 'function') return coverProxySrc(raw) || raw;
      } catch (_) {}
      return raw;
    },
    onChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      listeners.push(cb);
      return function () {
        var i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };
  try {
    layer.cleanup = def.mount(el, ctx) || null;
    layer.ctx = ctx;   // 暴露给诊断脚本：模组读到的 d.song / d.getCoverUrl() 是什么
  } catch (err) {
    console.warn('[FoliaPanel] 封面层挂载失败:', err);
  }
  /* 换歌时把新歌推给采集层（模组自己也有 every 轮询，这里是即时的那一路）。 */
  layer.offSong = foliaPanelOn('playback.songChanged', function () {
    try {
      for (var i = 0; i < listeners.length; i++) listeners[i]();
    } catch (_) {}
  });
  return layer;
}

function foliaPanelUnmountLayer(layer) {
  if (!layer) return;
  try { if (typeof layer.offSong === 'function') layer.offSong(); } catch (_) {}
  try { if (typeof layer.cleanup === 'function') layer.cleanup(); } catch (_) {}
  try { if (layer.hostEl && layer.hostEl.parentNode) layer.hostEl.parentNode.removeChild(layer.hostEl); } catch (_) {}
  var i = foliaPanelState.layers.indexOf(layer);
  if (i >= 0) foliaPanelState.layers.splice(i, 1);
}

/* ---------------- 加载 ---------------- */

function foliaPanelLoadOne(item) {
  if (!item || !item.dir || item.enabled === false) return Promise.resolve();
  var dir = FOLIA_PANEL_MOD_ROOT + item.dir + '/';
  var meta = null;
  return fetch(foliaPanelUrl(dir + 'mod.json'), { cache: 'no-cache' })
    .then(function (r) {
      if (!r || !r.ok) throw new Error('mod.json HTTP ' + (r && r.status));
      return r.json();
    })
    .then(function (m) {
      meta = Object.assign({}, m || {});
      meta.dir = String(item.dir || '');
      if (!meta.id) meta.id = String(item.dir);
      return import(foliaPanelUrl(dir + (meta.client || 'client.mjs')));
    })
    .then(function (mod) {
      var activate = mod && (mod.default || mod.activate);
      if (typeof activate !== 'function') throw new Error('client 未导出 activate()');
      /* activate 是同步函数（v1.3.3 实测），但仍按 Promise 接：以后模组改成 async 也不会丢错误。 */
      return Promise.resolve(activate(foliaPanelBuildHostApi(meta)));
    })
    .then(function () {
      foliaPanelState.mods[String(meta.id)] = { meta: meta };
      console.log('[FoliaPanel] 已激活', meta.id, meta.version || '');
    })
    .catch(function (err) {
      var msg = String((err && err.message) || err);
      foliaPanelState.errors.push({ id: (item && item.dir) || '?', error: msg });
      console.warn('[FoliaPanel] 加载失败', item && item.dir, msg);
    });
}

function foliaPanelLoad() {
  if (foliaPanelState.loading) return foliaPanelState.loading;
  foliaPanelState.loading = fetch(foliaPanelUrl(FOLIA_PANEL_MOD_ROOT + 'manifest.json'), { cache: 'no-cache' })
    .then(function (r) {
      if (!r || !r.ok) throw new Error('manifest HTTP ' + (r && r.status));
      return r.json();
    })
    .then(function (manifest) {
      var list = (manifest && manifest.mods) || [];
      var chain = Promise.resolve();
      for (var i = 0; i < list.length; i++) {
        (function (item) {
          chain = chain.then(function () { return foliaPanelLoadOne(item); });
        })(list[i]);
      }
      return chain;
    })
    .then(function () {
      foliaPanelState.ready = true;
      foliaPanelStartPump();
      console.log('[FoliaPanel] 就绪：'
        + Object.keys(foliaPanelState.tabs).length + ' 个面板，'
        + foliaPanelState.errors.length + ' 个失败');
      return foliaPanelState.tabs;
    })
    .catch(function (err) {
      foliaPanelState.errors.push({ id: '(manifest)', error: String((err && err.message) || err) });
      console.warn('[FoliaPanel] 清单加载失败:', err);
      return {};
    });
  return foliaPanelState.loading;
}

/* 全局入口：账号胶囊点开的就是这里。tabId 缺省走 archive。
 * 返回 true = 已受理（加载中也会在就绪后自己打开）；false = 模组确实没起来，
 * 调用方可以回落到账号信息弹窗，别把账号入口彻底堵死。 */
function openFoliaHomeTab(tabId) {
  var id = String(tabId || 'archive');
  if (foliaPanelState.tabs[id]) return foliaPanelOpenTab(id);
  if (!foliaPanelState.ready) {
    if (typeof showToast === 'function') showToast('听歌档案正在加载…');
    foliaPanelLoad().then(function () {
      if (foliaPanelState.tabs[id]) foliaPanelOpenTab(id);
      else if (typeof showToast === 'function') showToast('听歌档案没加载起来，看控制台 [FoliaPanel]');
    });
    return true;
  }
  if (typeof showToast === 'function') showToast('听歌档案没加载起来，看控制台 [FoliaPanel]');
  return false;
}

window.openFoliaHomeTab = openFoliaHomeTab;
window.closeFoliaPanel = foliaPanelClose;
window.foliaPanelHostState = foliaPanelState;

/* 启动：让出首屏再拉模组。模组要开始采样，不能等面板打开才激活；
 * 但也不能压在首屏渲染上 —— 1.2s 后起，DOMContentLoaded 已过就直接排。 */
(function foliaPanelScheduleLoad() {
  function go() {
    try { foliaPanelBindUi(); } catch (err) { console.warn('[FoliaPanel] UI 绑定失败', err); }
    try { foliaPanelLoad(); } catch (err) { console.warn('[FoliaPanel] 启动失败', err); }
  }
  if (document.readyState === 'complete') { setTimeout(go, 1200); return; }
  if (document.readyState !== 'loading') { setTimeout(go, 1500); return; }
  document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 1500); }, { once: true });
  window.addEventListener('load', function () { setTimeout(go, 600); }, { once: true });
})();
