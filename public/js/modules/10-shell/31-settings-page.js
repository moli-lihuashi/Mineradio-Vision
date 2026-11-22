// =============================================================================
// 设置页（2026-11-23）
//
// 三条杠里那些参数面板（淡入淡出 / 均衡器 / 变速 / 歌曲过渡 / 休息提醒）与
// 视觉控制台「高级」页（画质 / GPU / 内存 / 缓存 / 输出）整体搬进了 #settings-modal。
// 搬的是同一批 DOM：id、onclick、aria 全不变，所以这里不需要接管任何一个参数的逻辑，
// 只负责三件事：
//   1. 开合与 tab 切换；
//   2. 「搜索设置项」——建索引、过滤、点结果跳到对应控件并高亮；
//   3. 三条杠菜单的快捷开关状态与摘要文案同步。
//
// 所有对外函数都挂到 window 上（onclick 需要），不在顶层写 function 声明 ——
// 整个前端是 125+ 模块合并成一个 script 求值的，同名 function 后声明者会静默覆盖前者。
// =============================================================================
(function (global) {
  'use strict';

  var TAB_ORDER = ['general', 'playback', 'audio', 'desktop-lyrics', 'performance', 'storage', 'about'];
  var TAB_LABEL = {
    general: '常规',
    playback: '播放',
    audio: '音频',
    'desktop-lyrics': '桌面歌词',
    performance: '性能',
    storage: '存储',
    about: '关于'
  };

  var currentTab = 'general';
  var searchEntries = null;
  var aboutState = 'idle';
  var menuObserverBound = false;
  var lastMenuOpen = false;
  var menuSummaryTimer = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = String(text == null ? '' : text);
  }

  /* ---------------- tab ---------------- */

  function paintTabs(tab) {
    var tabs = document.querySelectorAll('#settings-tabs [data-settings-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-settings-tab') === tab;
      tabs[i].classList.toggle('active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var pages = document.querySelectorAll('#settings-modal .settings-page');
    for (var j = 0; j < pages.length; j++) {
      pages[j].classList.toggle('active', pages[j].getAttribute('data-settings-page') === tab);
    }
    var modal = el('settings-modal');
    if (modal) modal.setAttribute('data-active-tab', tab);
  }

  function setSettingsPageTab(tab, keepScroll) {
    var next = TAB_ORDER.indexOf(tab) >= 0 ? tab : 'general';
    currentTab = next;
    paintTabs(next);
    if (!keepScroll) {
      var body = el('settings-body');
      if (body) body.scrollTop = 0;
    }
    // 输出设备列表原本只在用户点「刷新」时才枚举；切到音频页先自己填一次，
    // 否则搬过来之后那一块是空的。
    if (next === 'audio' && typeof global.refreshAudioOutputDevices === 'function') {
      try { global.refreshAudioOutputDevices(false); } catch (_) { }
    }
    // 切过来的这一页刚变 display:block，滑块的 clientWidth 才有值；
    // 进度填充要重新量一次，否则新页里的滑块只有轨道没有填充。
    if (global.MineradioPrismalChrome && typeof global.MineradioPrismalChrome.syncFills === 'function') {
      try { global.MineradioPrismalChrome.syncFills(); } catch (_) { }
    }
  }

  /* 设置页里的三块参数在视觉控制台里是折叠的（444px 宽的面板必须收着）。
   * 搬到这里后 summary 已隐藏（见 settings-page.css），把它们展开，
   * 否则用户点进「播放」只看到三个标题。 */
  var SETTINGS_FOLD_IDS = ['audio-tuning-fold', 'playback-advanced-fold', 'track-transition-fold'];
  function expandSettingsFolds() {
    SETTINGS_FOLD_IDS.forEach(function (id) {
      var node = el(id);
      if (node && !node.open) node.open = true;
    });
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function closeTransientLayers() {
    if (typeof global.closePlayerQuickMenu === 'function') {
      try { global.closePlayerQuickMenu(); } catch (_) { }
    }
    if (typeof global.closeSkinPopover === 'function') {
      try { global.closeSkinPopover(); } catch (_) { }
    }
    if (typeof global.closeFxPanel === 'function') {
      try { global.closeFxPanel(); } catch (_) { }
    }
  }

  function openSettingsPage(tab, focusId) {
    var modal = el('settings-modal');
    if (!modal) return;
    closeTransientLayers();
    setSettingsPageTab(tab || currentTab || 'general');
    expandSettingsFolds();
    document.body.classList.add('settings-page-open');
    modal.setAttribute('aria-hidden', 'false');
    ensureSearchIndex();
    loadSettingsAbout();
    if (focusId) {
      // 等 tab 页先 display:block，再滚到目标控件
      requestAnimationFrame(function () { focusSettingsTarget(focusId); });
    }
  }

  function closeSettingsPage() {
    var modal = el('settings-modal');
    document.body.classList.remove('settings-page-open');
    if (modal) modal.setAttribute('aria-hidden', 'true');
    hideSearchResults();
  }

  function closeSettingsPageIfMask(event) {
    if (!event || !event.target) return;
    if (event.target.id === 'settings-modal') closeSettingsPage();
  }

  /* ---------------- 定位到某个控件 ---------------- */

  function expandAncestorDetails(node) {
    var det = node && node.closest ? node.closest('details') : null;
    while (det) {
      det.open = true;
      var parent = det.parentElement;
      det = parent && parent.closest ? parent.closest('details') : null;
    }
  }

  function highlightNode(node) {
    if (!node) return;
    /* 只能用自己算的偏移滚 .settings-body。
     * scrollIntoView 会连同 document 一起滚 —— 设置页是 fixed 覆盖层，
     * 外层一滚就把「标题 + tab」顶出可视区，底部还会露出窗口底色（实测截到过）。 */
    var body = el('settings-body');
    if (body && body.contains(node)) {
      var bodyRect = body.getBoundingClientRect();
      var nodeRect = node.getBoundingClientRect();
      var delta = (nodeRect.top - bodyRect.top) - Math.max(0, (body.clientHeight - nodeRect.height) / 2);
      var next = Math.max(0, body.scrollTop + delta);
      try { body.scrollTo({ top: next, behavior: 'smooth' }); }
      catch (_) { body.scrollTop = next; }
    } else {
      try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (_) { try { node.scrollIntoView(); } catch (__) { } }
    }
    node.classList.remove('settings-hit');
    // 重启动画：读一次布局让浏览器认账
    void node.offsetWidth;
    node.classList.add('settings-hit');
    setTimeout(function () { node.classList.remove('settings-hit'); }, 1700);
  }

  function focusSettingsTarget(id) {
    if (!id) return;
    var node = el(id);
    if (!node) return;
    var page = node.closest ? node.closest('.settings-page') : null;
    if (page) {
      var tab = page.getAttribute('data-settings-page');
      if (tab && tab !== currentTab) setSettingsPageTab(tab, true);
    }
    expandAncestorDetails(node);
    var block = node.closest ? (node.closest('.fx-slider') || node.closest('.fx-seg') || node.closest('.fx-toggle') || node) : node;
    highlightNode(block);
  }

  /* ---------------- 搜索 ---------------- */

  function entryText(node) {
    if (!node) return '';
    if (node.classList.contains('settings-group-title')) return node.textContent.trim();
    if (node.tagName === 'SUMMARY') {
      return node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    var label = node.querySelector('label');
    if (label && label.textContent.trim()) return label.textContent.trim();
    var firstSpan = node.querySelector('span');
    if (firstSpan && firstSpan.textContent.trim()) {
      return firstSpan.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    var strong = node.querySelector('strong');
    if (strong && strong.textContent.trim()) return strong.textContent.trim();
    return '';
  }

  function ensureSearchIndex() {
    if (searchEntries) return searchEntries;
    var selector = '.fx-slider, .fx-toggle, .fade-control-row, .at-control-row, .tt-param-row, ' +
      '.lyric-color-row, .settings-fact, .settings-group-title, details > summary, .quick-menu-toggle';
    var list = [];
    var seen = {};
    var pages = document.querySelectorAll('#settings-modal .settings-page');
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      var tab = page.getAttribute('data-settings-page') || 'general';
      var nodes = page.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        // 折叠区里的 summary 已经能代表整块，里面的行不再重复登记
        if (node.tagName !== 'SUMMARY' && node.closest && node.closest('details') && !node.closest('.fx-slider')) {
          var summary = node.closest('details').querySelector('summary');
          if (summary && summary !== node) continue;
        }
        var text = entryText(node);
        if (!text || text.length < 2) continue;
        var key = tab + '|' + text;
        if (seen[key]) continue;
        seen[key] = 1;
        list.push({ tab: tab, text: text, node: node });
      }
    }
    searchEntries = list;
    return list;
  }

  function hideSearchResults() {
    var box = el('settings-search-results');
    if (box) {
      box.hidden = true;
      box.textContent = '';
    }
  }

  function renderSearchResults(query) {
    var box = el('settings-search-results');
    if (!box) return;
    var q = String(query || '').trim().toLowerCase();
    if (!q) { hideSearchResults(); return; }
    var entries = ensureSearchIndex();
    var hits = [];
    for (var i = 0; i < entries.length && hits.length < 14; i++) {
      if (entries[i].text.toLowerCase().indexOf(q) >= 0) hits.push(entries[i]);
    }
    box.textContent = '';
    if (!hits.length) {
      var empty = document.createElement('div');
      empty.className = 'settings-empty';
      empty.textContent = '没有匹配「' + query + '」的设置项';
      box.appendChild(empty);
      box.hidden = false;
      return;
    }
    hits.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-search-result';
      var name = document.createElement('span');
      name.textContent = entry.text;
      var where = document.createElement('small');
      where.textContent = TAB_LABEL[entry.tab] || entry.tab;
      btn.appendChild(name);
      btn.appendChild(where);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        focusSettingsEntry(entry);
      });
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function focusSettingsEntry(entry) {
    if (!entry) return;
    if (entry.tab && entry.tab !== currentTab) setSettingsPageTab(entry.tab, true);
    hideSearchResults();
    var input = el('settings-search-input');
    if (input) input.value = entry.text;
    var wrap = el('settings-search-wrap');
    if (wrap) wrap.classList.add('has-value');
    requestAnimationFrame(function () {
      expandAncestorDetails(entry.node);
      highlightNode(entry.node);
    });
  }

  function clearSettingsSearch() {
    var input = el('settings-search-input');
    if (input) input.value = '';
    var wrap = el('settings-search-wrap');
    if (wrap) wrap.classList.remove('has-value');
    hideSearchResults();
    input && input.focus();
  }

  /* ---------------- 关于 ---------------- */

  function readApiToken() {
    try {
      if (global.desktopWindow && typeof global.desktopWindow.getApiToken === 'function') {
        var t = global.desktopWindow.getApiToken();
        if (t) return String(t);
      }
    } catch (_) { }
    return global.__MINERADIO_API_TOKEN__ ? String(global.__MINERADIO_API_TOKEN__) : '';
  }

  function formatBuiltAt(iso) {
    if (!iso) return '未记录（源码树直接运行）';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try { return d.toLocaleString('zh-CN', { hour12: false }); } catch (_) { return String(iso); }
  }

  function loadSettingsAbout(force) {
    if (aboutState === 'loading') return;
    if (aboutState === 'ready' && !force) return;
    aboutState = 'loading';
    setText('settings-about-version', '读取中…');
    setText('settings-about-commit', '读取中…');
    setText('settings-about-built-at', '读取中…');
    var headers = {};
    var token = readApiToken();
    if (token) headers['X-Mineradio-Token'] = token;
    global.fetch('/api/debug/build', { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var build = (data && data.build) || {};
        setText('settings-about-version', 'v' + (build.version || (data && data.version) || '—'));
        var sha = build.commit && build.commit !== 'unknown' ? String(build.commit) : '';
        setText('settings-about-commit', sha ? sha.slice(0, 12) : '—');
        if (sha) el('settings-about-commit').title = sha;
        setText('settings-about-built-at', formatBuiltAt(build.builtAt));
        aboutState = 'ready';
      })
      .catch(function (err) {
        setText('settings-about-version', '读取失败');
        setText('settings-about-commit', '—');
        setText('settings-about-built-at', '接口不可用：' + String(err && err.message || err));
        aboutState = 'idle';
      });
  }

  /* ---------------- 三条杠：快捷开关与摘要 ---------------- */

  function markShortcut(id, on) {
    var node = el(id);
    if (node) node.classList.toggle('on', !!on);
  }

  function shortSummary(text) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var cut = s.indexOf(' · ');
    return cut > 0 ? s.slice(0, cut) : s;
  }

  function copySummary(fromId, toId) {
    var from = el(fromId);
    var to = el(toId);
    if (!from || !to) return;
    var text = shortSummary(from.textContent);
    if (text && to.textContent !== text) to.textContent = text;
  }

  function syncQuickMenuQuickStates() {
    var state = (typeof fx !== 'undefined') ? fx : null;
    if (!state && global.fx) state = global.fx;
    markShortcut('qm-shortcut-desktopLyrics', state && state.desktopLyrics);
    markShortcut('qm-shortcut-wallpaper', state && state.wallpaperMode);
    // 小组件窗口的可见状态由 30-floating-widget-bridge 维护
    var floatingVisible = false;
    try { floatingVisible = typeof floatingWidgetBridgeVisible !== 'undefined' && !!floatingWidgetBridgeVisible; } catch (_) { }
    markShortcut('qm-shortcut-floating', floatingVisible);
    var panel = el('fx-panel');
    markShortcut('qm-shortcut-fx', !!(panel && (panel.classList.contains('show') || panel.classList.contains('peek'))));
    copySummary('audio-tuning-summary', 'qm-eq-summary');
    copySummary('playback-advanced-summary', 'qm-playback-summary');
    copySummary('track-transition-summary', 'qm-transition-summary');
    copySummary('sleep-timer-remain', 'qm-sleep-summary');
    // 未登录时「退出登录」不该出现
    var logout = el('qm-logout-btn');
    if (logout) {
      var logged = false;
      try { logged = typeof global.hasAnyPlatformLogin === 'function' ? !!global.hasAnyPlatformLogin() : false; } catch (_) { }
      logout.hidden = !logged;
    }
  }

  function startMenuSummaryTick() {
    if (menuSummaryTimer) return;
    menuSummaryTimer = setInterval(syncQuickMenuQuickStates, 2000);
  }

  function stopMenuSummaryTick() {
    if (!menuSummaryTimer) return;
    clearInterval(menuSummaryTimer);
    menuSummaryTimer = 0;
  }

  function bindMenuObserver() {
    if (menuObserverBound || !global.MutationObserver || !document.body) return;
    menuObserverBound = true;
    new global.MutationObserver(function () {
      var open = document.body.classList.contains('player-quick-menu-open');
      if (open === lastMenuOpen) return;
      lastMenuOpen = open;
      if (open) {
        syncQuickMenuQuickStates();
        startMenuSummaryTick();
      } else {
        stopMenuSummaryTick();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------------- 退出 ---------------- */

  function quitMineradioFromMenu() {
    closeSettingsPage();
    if (typeof global.closePlayerQuickMenu === 'function') {
      try { global.closePlayerQuickMenu(); } catch (_) { }
    }
    try {
      if (global.desktopWindow && typeof global.desktopWindow.close === 'function') {
        global.desktopWindow.close('exit');
        return;
      }
    } catch (_) { }
    try { global.close(); } catch (_) { }
  }

  /* ---------------- 初始化 ---------------- */

  function onSearchInput(e) {
    var value = e && e.target ? e.target.value : '';
    var wrap = el('settings-search-wrap');
    if (wrap) wrap.classList.toggle('has-value', !!String(value || '').trim());
    renderSearchResults(value);
  }

  function bindSettingsPage() {
    var tabs = el('settings-tabs');
    if (tabs && !tabs._settingsBound) {
      tabs._settingsBound = true;
      tabs.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-settings-tab]') : null;
        if (!btn) return;
        setSettingsPageTab(btn.getAttribute('data-settings-tab'));
      });
    }
    var input = el('settings-search-input');
    if (input && !input._settingsBound) {
      input._settingsBound = true;
      input.addEventListener('input', onSearchInput);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          clearSettingsSearch();
        }
        if (e.key === 'Enter') {
          var first = document.querySelector('#settings-search-results .settings-search-result');
          if (first) first.click();
        }
      });
      input.addEventListener('focus', function () {
        if (input.value.trim()) renderSearchResults(input.value);
      });
    }
    // 点空白收掉搜索结果，但别把设置页关掉
    document.addEventListener('click', function (e) {
      var wrap = el('settings-search-wrap');
      if (!wrap || !wrap.contains(e.target)) hideSearchResults();
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!document.body.classList.contains('settings-page-open')) return;
      var about = el('about-modal');
      if (about && about.classList.contains('show')) return;
      var update = el('update-modal');
      if (update && update.classList.contains('modal-mask') && global.getComputedStyle(update).display !== 'none') return;
      closeSettingsPage();
    });

    bindMenuObserver();
    if (document.body && document.body.classList.contains('player-quick-menu-open')) {
      syncQuickMenuQuickStates();
      startMenuSummaryTick();
    }
  }

  global.openSettingsPage = openSettingsPage;
  global.closeSettingsPage = closeSettingsPage;
  global.closeSettingsPageIfMask = closeSettingsPageIfMask;
  global.setSettingsPageTab = setSettingsPageTab;
  global.clearSettingsSearch = clearSettingsSearch;
  global.syncQuickMenuQuickStates = syncQuickMenuQuickStates;
  global.quitMineradioFromMenu = quitMineradioFromMenu;
  global.loadSettingsAbout = loadSettingsAbout;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSettingsPage);
  } else {
    bindSettingsPage();
  }
})(window);
