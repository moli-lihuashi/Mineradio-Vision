(function (global) {
  'use strict';

  // ====================================================================
  //  平台能力面板（2026-11-13 批次2/3/4 新增接口的统一前端入口）
  //
  //  挂点：#home-platform-recommend（平台推荐）弹窗 → 底部「平台能力」按钮。
  //  按当前选中的平台 tab 渲染对应能力；结果统一渲染成可点列表，歌曲可播放。
  //  整个模块用 IIFE + pfx 前缀，避免与 125+ 个合并到同一 script 的模块重名。
  //  服务端落点：server/{qq,kugou,spotify,qishui}/extras.js 与对应 routes/*.js。
  // ====================================================================

  var pfxState = { open: false, bound: false, boundAttempts: 0, rows: [], songs: [] };

  // needs: 'keywords' | 'id' | 'pid' —— 从输入区取值拼到 url / body 上。
  var PFX_ACTIONS = {
    qq: [
      { label: '推荐歌单', url: '/api/qq/recommend/playlists?page=0&limit=12', kind: 'playlists' },
      { label: '榜单分组', url: '/api/qq/toplist/groups', kind: 'groups' },
      { label: '私人雷达', url: '/api/qq/recommend/radar?page=2', kind: 'songs' },
      { label: '每日推荐区块', url: '/api/qq/recommend/feed?page=1', kind: 'shelves' },
      { label: '相似歌曲', url: '/api/qq/song/similar?songid=', needs: 'id', kind: 'songs' },
      { label: '歌手专辑', url: '/api/qq/artist/albums?id=', needs: 'id', kind: 'albums' },
      { label: '分类搜索', url: '/api/qq/search/collections?keywords=', needs: 'keywords', kind: 'collections' }
    ],
    kugou: [
      { label: '专辑详情', url: '/api/kugou/album/detail?albumId=', needs: 'id', kind: 'albumDetail' },
      { label: '歌手页', url: '/api/kugou/artist/detail?singerId=', needs: 'id', kind: 'artistDetail' },
      { label: '歌手专辑', url: '/api/kugou/artist/albums?singerId=', needs: 'id', kind: 'albums' },
      { label: '分类搜索', url: '/api/kugou/search/collections?keywords=', needs: 'keywords', kind: 'collections' },
      { label: '推荐卡片', url: '/api/kugou/recommend/cards?pagesize=12', kind: 'cards' },
      { label: '历史日推', url: '/api/kugou/recommend/history?mode=list', kind: 'entries' },
      { label: '歌单移除', url: '/api/kugou/playlist/remove-song', method: 'POST', needs: 'pid', kind: 'write' }
    ],
    spotify: [
      { label: '收藏专辑库', url: '/api/spotify/user/albums?limit=20', kind: 'albums' },
      { label: '歌手页', url: '/api/spotify/artist/detail?id=', needs: 'id', kind: 'artistDetail' },
      { label: '歌手专辑', url: '/api/spotify/artist/albums?id=', needs: 'id', kind: 'albums' },
      { label: '探索分类', url: '/api/spotify/explore/categories?limit=20', kind: 'categories' },
      { label: '分类歌单', url: '/api/spotify/explore/playlists?id=', needs: 'id', kind: 'playlists' },
      { label: '个性化推荐', url: '/api/spotify/recommend/made-for-you?limit=20', kind: 'madeForYou' },
      { label: '每日混合', url: '/api/spotify/recommend/daily-mix?limit=30', kind: 'dailyMix' },
      { label: '歌单移除', url: '/api/spotify/playlist/remove-song', method: 'POST', needs: 'pid', kind: 'write' }
    ],
    qishui: [
      { label: '歌单搜索', url: '/api/qishui/search/playlists?keywords=', needs: 'keywords', kind: 'playlists' },
      { label: '场景模式', url: '/api/qishui/feed/modes', kind: 'modes' }
    ],
    netease: []
  };

  function pfxEl(id) { return document.getElementById(id); }
  function pfxEsc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pfxInput(id) { var n = pfxEl(id); return n ? String(n.value || '').trim() : ''; }
  function pfxApi() { return global.Mineradio && global.Mineradio.api && global.Mineradio.api.apiJson; }

  function pfxCurrentProvider() {
    var active = document.querySelector('#home-platform-recommend-tabs [aria-selected="true"]');
    return active ? active.getAttribute('data-home-recommend-source') : 'netease';
  }

  function pfxStatus(message, kind) {
    var node = pfxEl('platform-extras-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'netease-features-status' + (kind ? ' is-' + kind : '');
  }

  function pfxBuildPanel() {
    var panel = pfxEl('platform-extras-panel');
    if (!panel || panel.getAttribute('data-pfx-built') === '1') return panel;
    panel.setAttribute('data-pfx-built', '1');
    var inputs = [
      '<input id="platform-extras-keywords" placeholder="关键词" size="14">',
      '<input id="platform-extras-id" placeholder="歌手/专辑 ID" size="16">',
      '<input id="platform-extras-pid" placeholder="歌单 ID" size="12">',
      '<input id="platform-extras-ids" placeholder="歌曲 ID(逗号分隔)" size="16">',
      '<select id="platform-extras-kind" title="搜索类型"><option value="album">专辑</option><option value="playlist">歌单</option><option value="artist">歌手</option></select>'
    ].join('');
    panel.innerHTML =
      '<div class="netease-features-toolbar" id="platform-extras-toolbar"></div>' +
      '<div class="netease-features-inputs">' + inputs + '</div>' +
      '<div class="netease-features-status" id="platform-extras-status"></div>' +
      '<div class="netease-features-result" id="platform-extras-result"></div>' +
      '<div class="netease-features-note">按当前平台 tab 显示可用能力。带「我的」语义的接口需要先登录对应平台账号；' +
      '失败原因会直接显示，不会伪装成空结果。实现见 server/{qq,kugou,spotify,qishui}/extras.js。</div>';
    panel.addEventListener('click', function (event) {
      var button = event.target.closest('[data-pfx-act]');
      if (button && panel.contains(button)) {
        pfxRun(Number(button.getAttribute('data-pfx-act')) || 0);
        return;
      }
      var row = event.target.closest('[data-pfx-row]');
      if (row && panel.contains(row)) {
        var item = pfxState.rows[Number(row.getAttribute('data-pfx-row')) || 0];
        // 右侧「全部」按钮 = 从这首开始连播整批；点行本身 = 只播这一首。
        if (item && item.kind === 'song') pfxPlaySong(item, row.hasAttribute('data-pfx-all'));
      }
    });
    return panel;
  }

  function pfxRenderButtons() {
    var bar = pfxEl('platform-extras-toolbar');
    if (!bar) return;
    var provider = pfxCurrentProvider();
    var actions = PFX_ACTIONS[provider] || [];
    if (!actions.length) {
      bar.innerHTML = '<span class="netease-features-status">网易云的增补能力在「网易云账户能力」面板；其他平台请先切到对应 tab。</span>';
      return;
    }
    bar.innerHTML = actions.map(function (a, i) {
      return '<button type="button" data-pfx-act="' + i + '">' + pfxEsc(a.label) + '</button>';
    }).join('');
  }

  function pfxRowsFrom(data, kind) {
    var rows = [];
    function song(s) { return { kind: 'song', name: s.name || '未命名', sub: [s.artist, s.album].filter(Boolean).join(' · '), song: s }; }
    function album(a) { return { kind: 'text', name: a.name || a.title, sub: [a.artist, a.publishDate, a.songCount ? a.songCount + ' 首' : ''].filter(Boolean).join(' · ') }; }
    function playlist(p) { return { kind: 'text', name: p.name || p.title, sub: [p.trackCount ? p.trackCount + ' 首' : '', p.creator].filter(Boolean).join(' · ') }; }
    if (kind === 'songs' || kind === 'albumDetail' || kind === 'artistDetail' || kind === 'dailyMix') {
      (data.songs || []).forEach(function (s) { rows.push(song(s)); });
    }
    if (kind === 'categories') {
      (data.categories || []).forEach(function (c) { rows.push({ kind: 'text', name: c.name, sub: '探索分类' }); });
    }
    if (kind === 'modes') {
      (data.modes || []).forEach(function (m) {
        rows.push({ kind: 'text', name: m.name, sub: [m.group, m.subQueueType].filter(Boolean).join(' · ') });
      });
    }
    if (kind === 'madeForYou') {
      (data.personalized && data.personalized.length ? data.personalized : (data.playlists || [])).forEach(function (p) { rows.push(playlist(p)); });
    }
    if (kind === 'albums' || kind === 'collections' || kind === 'cards' || kind === 'albumDetail' || kind === 'artistDetail') {
      (data.albums || []).forEach(function (a) { rows.push(album(a)); });
      (data.cards || []).forEach(function (a) { rows.push(album(a)); });
    }
    if (kind === 'playlists' || kind === 'collections' || kind === 'artistDetail') {
      (data.playlists || []).forEach(function (p) { rows.push(playlist(p)); });
    }
    if (kind === 'groups') {
      (data.groups || []).forEach(function (g) { (g.toplists || []).forEach(function (t) { rows.push({ kind: 'text', name: t.name, sub: g.name + (t.updateTime ? ' · ' + t.updateTime : '') }); }); });
    }
    if (kind === 'shelves') {
      (data.shelves || []).forEach(function (s) { rows.push({ kind: 'text', name: s.title, sub: s.group || '推荐区块' }); });
    }
    if (kind === 'entries') {
      (data.entries || []).forEach(function (e) { rows.push({ kind: 'text', name: e.date || e.name, sub: e.name || '历史日推' }); });
    }
    if (!rows.length && data.categories) {
      data.categories.forEach(function (c) { rows.push({ kind: 'text', name: c.name, sub: '分类' }); });
    }
    if (!rows.length && data.artist) {
      rows.push({ kind: 'text', name: data.artist.name, sub: [data.artist.brief, data.artist.musicSize ? data.artist.musicSize + ' 首' : ''].filter(Boolean).join(' · ').slice(0, 120) });
    }
    return rows;
  }

  function pfxRender(rows) {
    pfxState.rows = rows || [];
    pfxState.songs = rows.filter(function (r) { return r.kind === 'song'; });
    var box = pfxEl('platform-extras-result');
    if (!box) return;
    if (!rows.length) { box.innerHTML = '<div class="netease-features-status">没有返回内容</div>'; return; }
    box.innerHTML = rows.map(function (row, i) {
      return '<div class="netease-features-row"><div class="netease-features-row-main" data-pfx-row="' + i + '">' +
        '<strong>' + pfxEsc(row.name || '未命名') + '</strong><small>' + pfxEsc(row.sub || row.kind) + '</small></div>' +
        (row.kind === 'song' ? '<button type="button" data-pfx-row="' + i + '" data-pfx-all="1" title="从这首开始连续播放全部">全部</button>' : '') + '</div>';
    }).join('');
  }

  // all=true：整批入队、从这首开始连续播；否则只播这一首。
  // 旧实现两个入口都是整批入队，状态却写「已把 N 首加入播放队列」—— 点行会以为没起播。
  function pfxPlaySong(item, all) {
    if (typeof global.playQueueAt !== 'function') { pfxStatus('播放链路尚未就绪', 'error'); return; }
    var at = Math.max(0, pfxState.songs.indexOf(item));
    var list = all ? pfxState.songs : [pfxState.songs[at]].filter(Boolean);
    if (!list.length) { pfxStatus('没有可播放的歌曲', 'error'); return; }
    global.playQueue = list.map(function (r) {
      var song = r && r.song ? r.song : r;
      return typeof global.cloneSong === 'function' ? global.cloneSong(song) : Object.assign({}, song);
    });
    global.currentIdx = Math.min(global.playQueue.length - 1, all ? at : 0);
    var playing = global.playQueue[global.currentIdx] || {};
    var title = playing.name || playing.title || '这首';
    Promise.resolve(global.playQueueAt(global.currentIdx, {
      manual: true, context: { type: 'platform-extras', playlistName: '平台能力' }
    })).catch(function (err) { pfxStatus('起播失败：' + (err && err.message || err), 'error'); });
    pfxStatus(all ? ('正在播放「' + title + '」· 队列 ' + list.length + ' 首') : ('正在播放「' + title + '」'), 'ok');
  }

  async function pfxRun(index) {
    var provider = pfxCurrentProvider();
    var action = (PFX_ACTIONS[provider] || [])[index];
    if (!action) return;
    var api = pfxApi();
    if (!api) { pfxStatus('API 封装未就绪', 'error'); return; }
    var keywords = pfxInput('platform-extras-keywords');
    var id = pfxInput('platform-extras-id');
    var pid = pfxInput('platform-extras-pid');
    var ids = pfxInput('platform-extras-ids');
    var kind = pfxInput('platform-extras-kind') || 'album';
    if (action.needs === 'keywords' && !keywords) { pfxStatus('先填关键词', 'error'); return; }
    if (action.needs === 'id' && !id) { pfxStatus('先填歌手/专辑 ID', 'error'); return; }
    if (action.needs === 'pid' && !pid) { pfxStatus('先填歌单 ID', 'error'); return; }

    var url = action.url;
    if (action.needs === 'keywords') {
      url += encodeURIComponent(keywords) + (action.kind === 'collections' ? '&kind=' + encodeURIComponent(kind) + '&limit=20' : '&limit=20');
    } else if (action.needs === 'id') {
      url += encodeURIComponent(id) + (action.kind === 'collections' ? '' : '&limit=20');
    }
    pfxStatus('正在读取 ' + action.label + '…');
    try {
      var opts = action.method === 'POST' ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: pid, ids: ids, id: ids })
      } : { timeoutMs: 14000 };
      var data = await api(url, opts);
      if (data.error) { pfxStatus(data.message || data.error, 'error'); pfxRender([]); return; }
      if (action.kind === 'write') {
        pfxStatus(data.success ? (action.label + ' 成功' + (data.verified === false ? '（读回未确认）' : '')) : (data.message || '操作失败'), data.success ? 'ok' : 'error');
        pfxRender([]);
        return;
      }
      var rows = pfxRowsFrom(data, action.kind);
      pfxRender(rows);
      pfxStatus(data.message || (action.label + '：' + rows.length + ' 条'), rows.length ? 'ok' : '');
    } catch (err) {
      pfxStatus('请求失败：' + (err && err.message || err), 'error');
    }
  }

  function pfxToggle() {
    var panel = pfxBuildPanel();
    if (!panel) return;
    pfxState.open = !pfxState.open;
    panel.hidden = !pfxState.open;
    var toggle = pfxEl('home-platform-recommend-extras');
    if (toggle) toggle.classList.toggle('netease-features-active', pfxState.open);
    if (pfxState.open) {
      pfxRenderButtons();
      pfxStatus('选一个能力；带「我的」语义的会校验登录态。');
    }
  }

  function pfxBind() {
    if (pfxState.bound) return;
    var toggle = pfxEl('home-platform-recommend-extras');
    if (!toggle) {
      pfxBind.boundAttempts = (pfxBind.boundAttempts || 0) + 1;
      if (pfxBind.boundAttempts < 25) setTimeout(pfxBind, 200);
      return;
    }
    pfxState.bound = true;
    toggle.addEventListener('click', pfxToggle);
    var tabs = pfxEl('home-platform-recommend-tabs');
    if (tabs) tabs.addEventListener('click', function () {
      setTimeout(function () { if (pfxState.open) pfxRenderButtons(); }, 0);
    });
    var close = pfxEl('home-platform-recommend-close');
    if (close) close.addEventListener('click', function () {
      pfxState.open = false;
      var panel = pfxEl('platform-extras-panel');
      if (panel) panel.hidden = true;
      toggle.classList.remove('netease-features-active');
    });
  }

  global.openPlatformExtrasPanel = pfxToggle;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pfxBind);
  else pfxBind();
})(typeof window !== 'undefined' ? window : globalThis);
