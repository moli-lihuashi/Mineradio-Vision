(function (global) {
  'use strict';

  // ====================================================================
  //  网易云增补能力前端入口（2026-11-12 批次1）
  //
  //  落点：挂在 #home-platform-recommend（平台推荐）弹窗内，网易云 tab 下
  //        点「网易云账户能力」展开。整个模块用 IIFE + nf 前缀，避免与
  //        125+ 个合并到同一 script 的模块发生重名遮蔽。
  //
  //  服务端对应：server/routes/netease.js 末尾 18 条路由 + server/netease/extras.js。
  //  所有请求走 Mineradio.api.apiJson（自带 x-mineradio-token）。
  // ====================================================================

  var nfState = {
    open: false,
    bound: false,
    scrobbleBound: false,
    songs: [],
    rows: [],
    cursor: '',
    reported: Object.create(null),
  };

  function nfApiJson() {
    return global.Mineradio && global.Mineradio.api && global.Mineradio.api.apiJson;
  }

  function nfGet(path) {
    var api = nfApiJson();
    if (!api) return Promise.reject(new Error('API 封装未就绪'));
    return api(path, { timeoutMs: 14000 });
  }

  function nfPost(path, body) {
    var api = nfApiJson();
    if (!api) return Promise.reject(new Error('API 封装未就绪'));
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      timeoutMs: 14000,
    });
  }

  function nfEsc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nfElement(id) {
    return document.getElementById(id);
  }

  function nfStatus(message, kind) {
    var node = nfElement('netease-features-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'netease-features-status' + (kind ? ' is-' + kind : '');
  }

  function nfInput(id) {
    var node = nfElement(id);
    return node ? String(node.value || '').trim() : '';
  }

  // all=true：整批入队、从这首开始连续播；否则只播这一首。
  // 旧实现无论点行还是点「播放」都是整批入队，状态却写「已把 N 首加入播放队列」——
  // 用户点行会以为只加了队列没起播。语义、按钮和文案必须三者对齐：
  //   点行 = 单曲播放；右侧「全部」= 从这首开始连播整批。
  function nfPlaySongs(songs, index, name, all) {
    if (!songs || !songs.length) { nfStatus('没有可播放的歌曲', 'error'); return; }
    if (typeof global.playQueueAt !== 'function') { nfStatus('播放链路尚未就绪', 'error'); return; }
    var at = Math.max(0, Math.min(songs.length - 1, Number(index) || 0));
    var list = all ? songs : [songs[at]];
    global.playQueue = list.map(function (song) {
      return typeof global.cloneSong === 'function' ? global.cloneSong(song) : Object.assign({}, song);
    });
    global.currentIdx = Math.min(global.playQueue.length - 1, all ? at : 0);
    var playing = global.playQueue[global.currentIdx] || {};
    var title = playing.name || playing.title || '这首';
    Promise.resolve(global.playQueueAt(global.currentIdx, {
      manual: true,
      context: { type: 'netease-features', playlistName: name || '网易云' },
    })).catch(function (err) { nfStatus('起播失败：' + (err && err.message || err), 'error'); });
    nfStatus(all ? ('正在播放「' + title + '」· 队列 ' + list.length + ' 首') : ('正在播放「' + title + '」'), 'ok');
  }

  // ---------- 结果渲染 ----------
  // rows: { kind:'song'|'text', id, name, sub, song, action }
  function nfRenderRows(rows, title) {
    nfState.rows = rows || [];
    nfState.songs = (rows || []).filter(function (r) { return r.kind === 'song'; }).map(function (r) { return r.song; });
    var box = nfElement('netease-features-result');
    if (!box) return;
    var html = title ? '<div class="netease-features-section-title">' + nfEsc(title) + '</div>' : '';
    if (!nfState.rows.length) {
      box.innerHTML = html + '<div class="netease-features-status">没有返回内容</div>';
      return;
    }
    html += nfState.rows.map(function (row, index) {
      var main = '<div class="netease-features-row-main" data-nf-row="' + index + '">' +
        '<strong>' + nfEsc(row.name || row.id || '未命名') + '</strong>' +
        '<small>' + nfEsc(row.sub || row.kind) + '</small></div>';
      var actions = '';
      if (row.kind === 'song') {
        actions += '<button type="button" data-nf-act="play" data-nf-row="' + index + '" title="从这首开始连续播放全部">全部</button>';
        actions += '<button type="button" data-nf-act="dislike" data-nf-row="' + index + '">不喜欢</button>';
        actions += '<button type="button" data-nf-act="fm-trash" data-nf-row="' + index + '">FM 略过</button>';
      } else if (row.action === 'history-date') {
        actions += '<button type="button" data-nf-act="history-detail" data-nf-row="' + index + '">查看当日</button>';
      } else if (row.action === 'style-tag') {
        actions += '<button type="button" data-nf-act="style-detail" data-nf-row="' + index + '">看歌曲</button>';
      }
      return '<div class="netease-features-row">' + main + actions + '</div>';
    }).join('');
    box.innerHTML = html;
  }

  function nfSongRows(songs, label) {
    return (songs || []).map(function (song) {
      return {
        kind: 'song',
        id: song.id,
        name: song.name || '未命名歌曲',
        sub: (label ? label + ' · ' : '') + (song.artist || '') + (song.album ? ' · ' + song.album : ''),
        song: song,
      };
    });
  }

  function nfTextRows(items, mapper, label) {
    return (items || []).map(function (item, index) {
      var mapped = mapper(item, index) || {};
      return Object.assign({ kind: 'text', sub: label || '' }, mapped);
    });
  }

  // ---------- 各能力 ----------
  async function nfRun(action) {
    nfStatus('正在读取…');
    try {
      var data;
      if (action === 'fm') {
        var mode = nfInput('netease-features-mode');
        var submode = nfInput('netease-features-submode');
        data = await nfGet('/api/personal/fm?limit=12&mode=' + encodeURIComponent(mode) + '&submode=' + encodeURIComponent(submode));
        nfRenderRows(nfSongRows(data.songs, '私人FM'), '私人 FM' + (mode ? ' · ' + mode : ''));
        nfStatus(data.message || ('已取得 ' + (data.songs || []).length + ' 首私人 FM'), data.songs && data.songs.length ? 'ok' : '');
        return;
      }
      if (action === 'cloud') {
        data = await nfGet('/api/user/cloud?limit=50');
        nfRenderRows(nfSongRows(data.songs, '云盘'), '音乐云盘（' + (data.total || 0) + '）');
        nfStatus(data.message || ('已取得 ' + (data.songs || []).length + ' 首云盘曲目'), 'ok');
        return;
      }
      if (action === 'rank-week' || action === 'rank-all') {
        data = await nfGet('/api/user/listen/rank?type=' + (action === 'rank-week' ? '1' : '0'));
        nfRenderRows(nfSongRows(data.songs, '听歌排行'), '听歌排行 · ' + (data.range === 'week' ? '最近一周' : '所有时间'));
        nfStatus(data.message || ('已取得 ' + (data.songs || []).length + ' 首排行歌曲'), 'ok');
        return;
      }
      if (action === 'history') {
        data = await nfGet('/api/recommend/history');
        var dates = data.dates || [];
        if (!dates.length) {
          var raw = data.data || {};
          dates = Object.keys(raw).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); });
        }
        nfRenderRows(nfTextRows(dates, function (d) {
          return { id: d, name: d, sub: '历史每日推荐', action: 'history-date' };
        }), '历史日推日期');
        nfStatus(data.message || ('可用日期 ' + dates.length + ' 个'), 'ok');
        return;
      }
      if (action === 'albums') {
        data = await nfGet('/api/user/albums?limit=50');
        nfRenderRows(nfTextRows(data.albums, function (a) {
          return { id: a.id, name: a.name, sub: [a.artist, a.songCount ? a.songCount + ' 首' : '', a.publishDate].filter(Boolean).join(' · ') };
        }), '收藏专辑库（' + (data.total || 0) + '）');
        nfStatus(data.message || ('已取得 ' + (data.albums || []).length + ' 张收藏专辑'), 'ok');
        return;
      }
      if (action === 'explore') {
        var cursor = nfInput('netease-features-cursor');
        data = await nfGet('/api/explore/home?refresh=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        nfState.cursor = data.cursor || '';
        var cursorInput = nfElement('netease-features-cursor');
        if (cursorInput) cursorInput.value = nfState.cursor;
        var rows = [];
        (data.sections || []).forEach(function (section) {
          (section.items || []).forEach(function (item) {
            rows.push({ kind: 'text', id: item.id, name: item.name, sub: section.title + (item.sub ? ' · ' + item.sub : '') });
          });
        });
        nfRenderRows(rows, '探索页（原始区块 ' + (data.blocksRawCount || 0) + '）');
        nfStatus(data.message || ('已解析 ' + rows.length + ' 张卡片，hasMore=' + !!data.hasMore), 'ok');
        return;
      }
      if (action === 'explore-entries') {
        data = await nfGet('/api/explore/entries');
        nfRenderRows(nfTextRows(data.entries, function (e) {
          return { id: e.id, name: e.name, sub: e.url || '探索入口' };
        }), '探索入口');
        nfStatus(data.message || ('已取得 ' + (data.entries || []).length + ' 个入口'), 'ok');
        return;
      }
      if (action === 'style-list') {
        data = await nfGet('/api/recommend/style/list');
        nfRenderRows(nfTextRows(data.tags, function (t) {
          return { id: t.id, name: t.name, sub: t.category || '曲风', action: 'style-tag' };
        }), '曲风列表');
        nfStatus(data.message || ('已取得 ' + (data.tags || []).length + ' 个曲风'), 'ok');
        return;
      }
      if (action === 'style-preference') {
        data = await nfGet('/api/recommend/style/preference');
        nfRenderRows([{ kind: 'text', id: 'preference', name: '我的曲风偏好', sub: JSON.stringify(data.preference || {}).slice(0, 160) }], '曲风偏好');
        nfStatus('已读取账号曲风偏好', 'ok');
        return;
      }
      if (action === 'search') {
        var keywords = nfInput('netease-features-keywords');
        var kind = nfInput('netease-features-kind') || 'album';
        if (!keywords) { nfStatus('先填搜索关键词', 'error'); return; }
        data = await nfGet('/api/search/collections?keywords=' + encodeURIComponent(keywords) + '&kind=' + encodeURIComponent(kind) + '&limit=30');
        var found = (data.albums || []).map(function (a) { return { kind: 'text', id: a.id, name: a.name, sub: '专辑 · ' + (a.artist || '') }; })
          .concat((data.playlists || []).map(function (p) { return { kind: 'text', id: p.id, name: p.name, sub: '歌单 · ' + (p.trackCount || 0) + ' 首' }; }))
          .concat((data.artists || []).map(function (a) { return { kind: 'text', id: a.id, name: a.name, sub: '歌手' }; }));
        nfRenderRows(found, '分类搜索 · ' + kind);
        nfStatus(data.message || ('命中 ' + found.length + ' 条'), 'ok');
        return;
      }
      if (action === 'artist-albums') {
        var artistId = nfInput('netease-features-artist-id');
        if (!artistId) { nfStatus('先填歌手 ID', 'error'); return; }
        data = await nfGet('/api/artist/albums?id=' + encodeURIComponent(artistId) + '&limit=30');
        nfRenderRows(nfTextRows(data.albums, function (a) {
          return { id: a.id, name: a.name, sub: [a.artist, a.publishDate, a.songCount ? a.songCount + ' 首' : ''].filter(Boolean).join(' · ') };
        }), (data.artist || '歌手') + ' 的专辑');
        nfStatus(data.message || ('已取得 ' + (data.albums || []).length + ' 张专辑'), 'ok');
        return;
      }
      if (action === 'remove-song') {
        var pid = nfInput('netease-features-pid');
        var ids = nfInput('netease-features-ids');
        if (!pid || !ids) { nfStatus('先填歌单 ID 和歌曲 ID', 'error'); return; }
        data = await nfPost('/api/playlist/remove-song', { pid: pid, ids: ids });
        nfStatus(data.success ? ('已从歌单 ' + pid + ' 移除 ' + ids) : ('移除失败：' + (data.message || data.error)), data.success ? 'ok' : 'error');
        return;
      }
      if (action === 'scrobble-now') {
        var song = global.playQueue && global.playQueue[global.currentIdx];
        if (!song || !song.id) { nfStatus('当前没有可上报的曲目', 'error'); return; }
        data = await nfPost('/api/scrobble', { id: song.id, time: Math.round((global.audio && global.audio.currentTime) || 0) });
        nfStatus(data.success ? '已上报当前播放' : ('上报失败：' + (data.message || data.error)), data.success ? 'ok' : 'error');
        return;
      }
      nfStatus('未知操作：' + action, 'error');
    } catch (err) {
      nfStatus((err && err.status === 401 ? '需要登录网易云账号：' : '请求失败：') + (err && err.message || err), 'error');
    }
  }

  async function nfRowAction(button) {
    var index = Number(button.getAttribute('data-nf-row')) || 0;
    var row = nfState.rows[index];
    if (!row) return;
    var act = button.getAttribute('data-nf-act');
    try {
      if (act === 'play') {
        nfPlaySongs(nfState.songs, nfState.songs.findIndex(function (s) { return String(s.id) === String(row.id); }), '网易云', true);
        return;
      }
      if (act === 'dislike' || act === 'fm-trash') {
        var path = act === 'dislike' ? '/api/recommend/dislike' : '/api/personal/fm/trash';
        var data = await nfPost(path, { id: row.id });
        nfStatus(data.success ? (act === 'dislike' ? '已反馈不感兴趣' : '已略过') : ('反馈失败：' + (data.message || data.error)), data.success ? 'ok' : 'error');
        return;
      }
      if (act === 'history-detail') {
        nfStatus('正在读取 ' + row.id + ' 的日推…');
        var history = await nfGet('/api/recommend/history/detail?date=' + encodeURIComponent(row.id));
        nfRenderRows(nfSongRows(history.songs, row.id), row.id + ' 每日推荐');
        nfStatus(history.message || ('已取得 ' + (history.songs || []).length + ' 首'), 'ok');
        return;
      }
      if (act === 'style-detail') {
        nfStatus('正在读取曲风歌曲…');
        var style = await nfGet('/api/recommend/style/detail?tagId=' + encodeURIComponent(row.id));
        nfRenderRows(nfSongRows(style.songs, row.name), row.name + ' 曲风歌曲');
        nfStatus(style.message || ('已取得 ' + (style.songs || []).length + ' 首'), 'ok');
        return;
      }
    } catch (err) {
      nfStatus('请求失败：' + (err && err.message || err), 'error');
    }
  }

  // ---------- 播放记录自动上报 ----------
  // 不改核心播放文件：每 5 秒读一次全局 audio/playQueue/currentIdx，
  // 达到「≥50% 或 ≥4 分钟」按 (trackId, audio.src) 去重上报一次，失败静默。
  function nfBindScrobble() {
    if (nfState.scrobbleBound) return;
    nfState.scrobbleBound = true;
    setInterval(function () {
      try {
        var a = global.audio;
        if (!a || a.paused || !a.duration || !isFinite(a.duration) || !a.currentTime) return;
        var song = global.playQueue && global.playQueue[global.currentIdx];
        if (!song || !song.id) return;
        if (!(song.provider === 'netease' || song.source === 'netease' || song.type === 'netease')) return;
        var key = String(song.id) + '|' + String(a.src || '');
        if (nfState.reported[key]) return;
        var listened = a.currentTime;
        if (listened < Math.min(240, a.duration * 0.5)) return;
        nfState.reported[key] = true;
        nfPost('/api/scrobble', { id: song.id, time: Math.round(listened) }).catch(function () {});
      } catch (e) { /* 打点不能影响播放 */ }
    }, 5000);
  }

  // ---------- 面板构建与绑定 ----------
  var NF_BUTTONS = [
    ['fm', '私人 FM'], ['cloud', '音乐云盘'], ['rank-week', '本周排行'], ['rank-all', '总排行'],
    ['history', '历史日推'], ['albums', '收藏专辑库'], ['explore', '探索首页'],
    ['explore-entries', '探索入口'], ['style-list', '曲风列表'], ['style-preference', '我的曲风偏好'],
    ['search', '分类搜索'], ['artist-albums', '歌手专辑'], ['remove-song', '歌单移除'],
    ['scrobble-now', '上报当前播放'],
  ];

  function nfBuild() {
    var panel = nfElement('netease-features-panel');
    if (!panel || panel.getAttribute('data-nf-built') === '1') return panel;
    panel.setAttribute('data-nf-built', '1');
    var buttons = NF_BUTTONS.map(function (entry) {
      return '<button type="button" data-nf-act="' + entry[0] + '">' + nfEsc(entry[1]) + '</button>';
    }).join('');
    var inputs = [
      '<select id="netease-features-mode" title="私人FM 模式"><option value="">默认</option><option value="FAMILIAR">熟悉</option><option value="EXPLORE">探索</option><option value="SCENE_RCMD">场景</option></select>',
      '<select id="netease-features-submode" title="场景子模式"><option value="">无</option><option value="EXERCISE">运动</option><option value="FOCUS">专注</option><option value="NIGHT_EMO">夜深</option></select>',
      '<input id="netease-features-keywords" placeholder="分类搜索关键词" size="14">',
      '<select id="netease-features-kind" title="搜索类型"><option value="album">专辑</option><option value="playlist">歌单</option><option value="artist">歌手</option></select>',
      '<input id="netease-features-artist-id" placeholder="歌手 ID" size="10">',
      '<input id="netease-features-pid" placeholder="歌单 ID" size="10">',
      '<input id="netease-features-ids" placeholder="歌曲 ID(逗号分隔)" size="16">',
      '<input id="netease-features-cursor" placeholder="探索页 cursor" size="14">',
    ].join('');
    panel.innerHTML =
      '<div class="netease-features-toolbar">' + buttons + '</div>' +
      '<div class="netease-features-inputs">' + inputs + '</div>' +
      '<div class="netease-features-status" id="netease-features-status"></div>' +
      '<div class="netease-features-result" id="netease-features-result"></div>' +
      '<div class="netease-features-note">接口实现在 server/routes/netease.js 与 server/netease/extras.js。' +
      '云盘 / 排行 / 历史日推 / 收藏专辑库 / 曲风偏好 / 移除歌曲 / 反馈 / 上报需要登录网易云账号；' +
      '探索页与分类搜索为公开接口。播放上报按「播放过半或满 4 分钟」自动打点一次，每曲仅一次。</div>';
    panel.addEventListener('click', function (event) {
      var button = event.target.closest('[data-nf-act]');
      if (button && panel.contains(button)) {
        if (button.hasAttribute('data-nf-row')) nfRowAction(button);
        else nfRun(button.getAttribute('data-nf-act'));
        return;
      }
      var rowMain = event.target.closest('[data-nf-row]');
      if (rowMain && panel.contains(rowMain)) {
        var row = nfState.rows[Number(rowMain.getAttribute('data-nf-row')) || 0];
        if (row && row.kind === 'song') {
          var idx = nfState.songs.findIndex(function (s) { return String(s.id) === String(row.id); });
          nfPlaySongs(nfState.songs, idx, '网易云');
        }
      }
    });
    return panel;
  }

  function nfToggle() {
    var panel = nfBuild();
    if (!panel) return;
    nfState.open = !nfState.open;
    panel.hidden = !nfState.open;
    var toggle = nfElement('home-platform-recommend-netease-tools');
    if (toggle) toggle.classList.toggle('netease-features-active', nfState.open);
    if (nfState.open) nfStatus('选一个能力开始；带「我的」语义的会校验登录态。');
  }

  function nfSyncTabVisibility() {
    var active = document.querySelector('#home-platform-recommend-tabs [aria-selected="true"]');
    var isNetease = !active || active.getAttribute('data-home-recommend-source') === 'netease';
    var toggle = nfElement('home-platform-recommend-netease-tools');
    if (toggle) toggle.hidden = !isNetease;
    var panel = nfElement('netease-features-panel');
    if (panel && !isNetease) {
      panel.hidden = true;
      nfState.open = false;
      if (toggle) toggle.classList.remove('netease-features-active');
    }
  }

  var nfBindAttempts = 0;
  function nfBind() {
    if (nfState.bound) return;
    // 模块由 index-loader 动态注入，弹窗节点可能尚未解析完；有限次重试后放弃。
    var toggle = nfElement('home-platform-recommend-netease-tools');
    if (!toggle) {
      if (nfBindAttempts++ < 25) setTimeout(nfBind, 200);
      return;
    }
    nfState.bound = true;
    toggle.addEventListener('click', nfToggle);
    var tabs = nfElement('home-platform-recommend-tabs');
    if (tabs) tabs.addEventListener('click', function () { setTimeout(nfSyncTabVisibility, 0); });
    var close = nfElement('home-platform-recommend-close');
    if (close) close.addEventListener('click', function () {
      nfState.open = false;
      var panel = nfElement('netease-features-panel');
      if (panel) panel.hidden = true;
      if (toggle) toggle.classList.remove('netease-features-active');
    });
    nfSyncTabVisibility();
    nfBindScrobble();
  }

  global.openNeteaseFeaturesPanel = nfToggle;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nfBind);
  else nfBind();
})(typeof window !== 'undefined' ? window : globalThis);
