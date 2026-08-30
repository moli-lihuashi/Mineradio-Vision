// =============================================================================
// 歌单面板壳：队列滚动 / mini-queue / tab
// =============================================================================

// ============================================================
//  播放列表面板
// ============================================================
function animateListItems(container, selector, opts) {
  if (!container || !window.gsap) return;
  opts = opts || {};
  var items = Array.prototype.slice.call(container.querySelectorAll(selector));
  if (!items.length) return;
  var limit = opts.limit || 18;
  var targets = items.slice(0, limit);
  window.gsap.killTweensOf(targets);
  window.gsap.fromTo(targets, {
    autoAlpha: 0,
    y: opts.y == null ? 8 : opts.y,
    x: opts.x == null ? -6 : opts.x
  }, {
    autoAlpha: 1,
    y: 0,
    x: 0,
    duration: opts.duration || 0.22,
    stagger: opts.stagger || 0.012,
    ease: opts.ease || 'power2.out',
    force3D: true,
    overwrite: true
  });
}
function smoothScrollToItem(scroller, item, opts) {
  if (!scroller || !item) return;
  opts = opts || {};
  var target = item.offsetTop - Math.max(0, (scroller.clientHeight - item.offsetHeight) * (opts.align == null ? 0.42 : opts.align));
  target = Math.max(0, Math.min(target, Math.max(0, scroller.scrollHeight - scroller.clientHeight)));
  if (window.gsap) {
    if (typeof scroller.__syncSmoothWheelTarget === 'function') scroller.__syncSmoothWheelTarget(target);
    window.gsap.killTweensOf(scroller);
    window.gsap.to(scroller, { scrollTop: target, duration: opts.duration || 0.30, ease: opts.ease || 'power2.out', overwrite: true });
  } else if (scroller.scrollTo) {
    scroller.scrollTo({ top: target, behavior: 'smooth' });
  } else {
    scroller.scrollTop = target;
  }
}
function bindSmoothWheelScroll(scroller) {
  if (!scroller || scroller.__smoothWheelBound) return;
  scroller.__smoothWheelBound = true;
  var targetTop = scroller.scrollTop;
  var scrollMotion = { top: scroller.scrollTop };
  var edgeRubber = { y: 0 };
  var edgeRubberTimer = null;
  var EDGE_RUBBER_MAX = 42;
  var usingMotion = !!(window.MineradioMotion && typeof window.MineradioMotion.springTo === 'function');

  function maxScroll() {
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }
  function applyScrollTop(v) {
    var max = maxScroll();
    var clamped = Math.max(0, Math.min(max, v));
    scroller.scrollTop = clamped;
    targetTop = clamped;
    scrollMotion.top = clamped;
  }
  function writeEdgeRubber(v) {
    edgeRubber.y = v;
    try {
      if (Math.abs(v) < 0.15) scroller.style.translate = '';
      else scroller.style.translate = '0 ' + (Math.round(v * 10) / 10) + 'px';
    } catch (_) {}
  }
  function springEdgeRubber(toY) {
    toY = Math.max(-EDGE_RUBBER_MAX, Math.min(EDGE_RUBBER_MAX, toY));
    if (!usingMotion || (window.MineradioMotion.prefersReducedMotion && window.MineradioMotion.prefersReducedMotion())) {
      writeEdgeRubber(toY);
      return;
    }
    var opts = {
      preset: window.MineradioMotion.SPRING.snappy,
      apply: writeEdgeRubber,
      onComplete: function () {
        if (Math.abs(toY) < 0.15) {
          edgeRubber._springRunning = false;
          writeEdgeRubber(0);
        }
      }
    };
    if (!edgeRubber._springRunning) {
      opts.from = edgeRubber.y;
      edgeRubber._springRunning = true;
    }
    window.MineradioMotion.springTo(edgeRubber, 'y', toY, opts);
  }
  function clearEdgeRubberSoon() {
    if (edgeRubberTimer) clearTimeout(edgeRubberTimer);
    edgeRubberTimer = setTimeout(function () {
      edgeRubberTimer = null;
      springEdgeRubber(0);
    }, 90);
  }

  scroller.__syncSmoothWheelTarget = function (top) {
    if (usingMotion) window.MineradioMotion.killAll(scrollMotion);
    scrollMotion._springRunning = false;
    targetTop = isFinite(top) ? top : scroller.scrollTop;
    scrollMotion.top = targetTop;
  };

  scroller.addEventListener('wheel', function (e) {
    if (e.ctrlKey) return;
    var max = maxScroll();
    if (max <= 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    var delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 18;
    else if (e.deltaMode === 2) delta *= scroller.clientHeight;

    var atTop = scroller.scrollTop <= 0;
    var atBottom = scroller.scrollTop >= max - 1;
    if ((atTop && delta < 0) || (atBottom && delta > 0)) {
      e.preventDefault();
      var resistance = 1 / (1 + Math.abs(edgeRubber.y) / 28);
      var pull = edgeRubber.y - delta * 0.28 * resistance;
      springEdgeRubber(pull);
      clearEdgeRubberSoon();
      return;
    }

    var current = scrollMotion._springRunning ? targetTop : scroller.scrollTop;
    var next = Math.max(0, Math.min(max, current + delta));
    if (next === current) return;
    e.preventDefault();
    if (Math.abs(edgeRubber.y) > 0.15) springEdgeRubber(0);
    targetTop = next;

    if (!usingMotion || (window.MineradioMotion.prefersReducedMotion && window.MineradioMotion.prefersReducedMotion())) {
      applyScrollTop(next);
      return;
    }

    var springOpts = {
      preset: window.MineradioMotion.SPRING.standard,
      apply: function (v) { applyScrollTop(v); },
      onComplete: function () {
        scrollMotion._springRunning = false;
        targetTop = scroller.scrollTop;
        scrollMotion.top = targetTop;
      }
    };
    if (!scrollMotion._springRunning) {
      springOpts.from = scroller.scrollTop;
      scrollMotion._springRunning = true;
    }
    window.MineradioMotion.springTo(scrollMotion, 'top', next, springOpts);
  }, { passive: false });

  scroller.addEventListener('scroll', throttle(function () {
    if (!scrollMotion._springRunning) {
      targetTop = scroller.scrollTop;
      scrollMotion.top = targetTop;
    }
  }, 16), { passive: true });
}
function bindSmoothQueueScrolling() {
  if (smoothWheelScrollBound) return;
  smoothWheelScrollBound = true;
  [
    'mini-queue-list',
    'search-results',
    'playlist-panel',
    'track-detail-body'
  ].forEach(function(id){
    bindSmoothWheelScroll(document.getElementById(id));
  });
  // fx-panel 自身 overflow:hidden，实际滚动容器是 .fx-scroll（lg-glass-shell 常驻面板）
  bindSmoothWheelScroll(document.querySelector('#fx-panel .fx-scroll'));
}
function animateVisiblePanelList(listEl, selector, scroller, activeSelector, opts) {
  if (!listEl) return;
  opts = opts || {};
  requestAnimationFrame(function(){
    animateListItems(listEl, selector, { x: -8, y: 6, stagger: 0.01, duration: 0.20, limit: 16 });
    var active = activeSelector ? listEl.querySelector(activeSelector) : null;
    if (active && scroller && opts.scrollActive !== false) smoothScrollToItem(scroller, active, { duration: 0.32 });
  });
}
function miniQueueSkeleton() {
  return '<div class="mini-queue-skeleton"></div><div class="mini-queue-skeleton"></div><div class="mini-queue-skeleton"></div>';
}
function togglePlaylistPanel(force) {
  var el = document.getElementById('playlist-panel');
  if (!el) return;
  var willShow;
  if (force === false) willShow = false;
  else if (force === true) willShow = true;
  else willShow = !el.classList.contains('show');
  if (willShow) {
    el.classList.add('show');
    if (window.MineradioMotion && typeof window.MineradioMotion.springUiIn === 'function') {
      window.MineradioMotion.springUiIn(el, {
        fromX: -14,
        fromY: 0,
        fromScale: 0.985,
        fromOpacity: 0.88,
        preset: window.MineradioMotion.SPRING.standard
      });
    } else if (window.gsap) {
      window.gsap.fromTo(el, { x: -12, autoAlpha: 0.92 }, { x: 0, autoAlpha: 1, duration: 0.22, ease: 'power2.out', overwrite: true });
    }
    scheduleUiWarmTask(function(){
      flushDeferredQueuePanel('playlist-panel-open');
      if (!playQueue.length && queueViewTab === 'queue') switchPlaylistTab('playlists');
      if (playQueue.length && currentIdx >= 0 && queueViewTab !== 'queue') switchPlaylistTab('queue');
      if (queueViewTab === 'queue') animateVisiblePanelList(document.getElementById('queue-list'), '.queue-item', el, '.queue-item.now', { scrollActive: false });
      else if (queueViewTab === 'playlists') animateVisiblePanelList(document.getElementById('pl-list'), '.pl-card', el);
      else animateVisiblePanelList(document.getElementById('podcast-list'), '.pl-card', el);
    }, 180);
  } else {
    if (window.MineradioMotion && typeof window.MineradioMotion.springUiOut === 'function') {
      window.MineradioMotion.springUiOut(el, {
        toX: -10,
        toY: 0,
        toScale: 0.985,
        preset: window.MineradioMotion.SPRING.snappy,
        onComplete: function () { el.classList.remove('show'); }
      });
    } else {
      el.classList.remove('show');
    }
  }
}
function applyPlaylistPanelPinState(openPanel) {
  var panel = document.getElementById('playlist-panel');
  var btn = document.getElementById('playlist-pin-btn');
  if (panel) {
    panel.classList.toggle('pinned', !!playlistPanelPinned);
    if (playlistPanelPinned || openPanel) {
      panel.dataset.preserveTabOnOpen = '1';
      setPeek(panel, true, 'pl');
    }
  }
  if (btn) {
    btn.classList.toggle('active', !!playlistPanelPinned);
    btn.title = playlistPanelPinned ? '取消常开歌单' : '常开歌单';
  }
}
function setPlaylistPanelPinned(on, silent) {
  playlistPanelPinned = !!on;
  saveBooleanPreference(PLAYLIST_PANEL_PIN_STORE_KEY, playlistPanelPinned);
  applyPlaylistPanelPinState(playlistPanelPinned);
  if (!silent) showToast(playlistPanelPinned ? '左侧歌单已常开' : '左侧歌单已恢复自动隐藏');
}
function togglePlaylistPanelPinned() {
  setPlaylistPanelPinned(!playlistPanelPinned);
}
function scrollPlaylistPanelToCurrent() {
  var panel = document.getElementById('playlist-panel');
  var list = document.getElementById('queue-list');
  if (!panel || !list || queueViewTab !== 'queue' || !playQueue.length || currentIdx < 0) return;
  var now = performance.now();
  if (panel.__lastCurrentScrollAt && now - panel.__lastCurrentScrollAt < 650) return;
  panel.__lastCurrentScrollAt = now;
  // 虚拟列表：先跳到估算位置再渲窗口，否则 .now 可能不在 DOM
  var listTop = Math.max(0, Number(list.offsetTop) || 0);
  var approx = listTop + currentIdx * QUEUE_ROW_STEP - Math.max(0, (panel.clientHeight - QUEUE_ROW_STEP) * 0.34);
  panel.scrollTop = Math.max(0, Math.min(approx, Math.max(0, panel.scrollHeight - panel.clientHeight)));
  renderQueuePanelRows();
  requestAnimationFrame(function(){
    var item = list.querySelector('.queue-item.now');
    if (item) smoothScrollToItem(panel, item, { duration: 0.28, align: 0.34 });
  });
}
function switchPlaylistTab(tab) {
  tab = tab === 'podcasts' ? 'podcasts' : (tab === 'playlists' ? 'playlists' : 'queue');
  queueViewTab = tab;
  document.getElementById('tab-queue').classList.toggle('active', tab === 'queue');
  document.getElementById('tab-pl').classList.toggle('active', tab === 'playlists');
  var podcastTab = document.getElementById('tab-podcast');
  if (podcastTab) podcastTab.classList.toggle('active', tab === 'podcasts');
  document.getElementById('queue-pane').style.display = tab === 'queue' ? '' : 'none';
  document.getElementById('pl-pane').style.display = tab === 'playlists' ? '' : 'none';
  var podcastPane = document.getElementById('podcast-pane');
  if (podcastPane) podcastPane.style.display = tab === 'podcasts' ? '' : 'none';
  if (tab === 'playlists' || tab === 'podcasts') refreshUserPlaylists();
  if (tab === 'queue') animateVisiblePanelList(document.getElementById('queue-list'), '.queue-item', document.getElementById('playlist-panel'), '.queue-item.now');
  if (tab === 'playlists') animateVisiblePanelList(document.getElementById('pl-list'), '.pl-card', document.getElementById('playlist-panel'));
  if (tab === 'podcasts') animateVisiblePanelList(document.getElementById('podcast-list'), '.pl-card', document.getElementById('playlist-panel'));
}
function setMiniQueueOpen(open) {
  miniQueueOpen = !!open;
  var pop = document.getElementById('mini-queue-popover');
  var btn = document.getElementById('mini-queue-btn');
  if (pop) {
    if (miniQueueOpen) {
      pop.classList.add('show');
      if (window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
        window.MineradioMotion.springPopover(pop, true, { fromY: 12, fromScale: 0.98 });
      }
    } else if (window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function' && pop.classList.contains('show')) {
      window.MineradioMotion.springPopover(pop, false, {
        toY: 10,
        toScale: 0.98,
        onComplete: function () { pop.classList.remove('show'); }
      });
    } else {
      pop.classList.remove('show');
    }
  }
  if (btn) {
    btn.classList.toggle('active', miniQueueOpen);
    if (miniQueueOpen && window.MineradioMotion && typeof window.MineradioMotion.springTap === 'function') {
      window.MineradioMotion.springTap(btn, { dip: 0.1 });
    }
  }
  if (miniQueueOpen) {
    var seq = ++miniQueueRenderSeq;
    requestAnimationFrame(function(){
      if (seq !== miniQueueRenderSeq || !miniQueueOpen) return;
      renderMiniQueuePanel({ animate: true, scrollCurrent: true });
    });
    revealBottomControls(1300);
  }
}
function toggleMiniQueue(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  setMiniQueueOpen(!miniQueueOpen);
}
function closeMiniQueue() {
  setMiniQueueOpen(false);
}
function openPlaylistPanelTab(tab, preserve) {
  tab = tab === 'podcasts' ? 'podcasts' : (tab === 'playlists' ? 'playlists' : 'queue');
  var panel = document.getElementById('playlist-panel');
  if (panel && panel.dataset && preserve !== false) panel.dataset.preserveTabOnOpen = '1';
  switchPlaylistTab(tab);
  setPeek(panel, true, 'pl');
}
function queuePanelWindowOptions() {
  var panel = document.getElementById('playlist-panel');
  var list = document.getElementById('queue-list');
  var viewport = Math.max(280, Number(panel && panel.clientHeight) || Math.min(620, Math.round((window.innerHeight || 800) * 0.72)));
  var scrollTop = 0;
  if (panel && list && list.getBoundingClientRect && panel.getBoundingClientRect) {
    var panelRect = panel.getBoundingClientRect();
    var listRect = list.getBoundingClientRect();
    scrollTop = Math.max(0, panelRect.top - listRect.top);
  } else if (panel && list) {
    scrollTop = Math.max(0, (Number(panel.scrollTop) || 0) - (Number(list.offsetTop) || 0));
  }
  return { scrollTop: scrollTop, viewport: viewport };
}
function miniQueueWindowOptions() {
  var list = document.getElementById('mini-queue-list');
  var viewport = Math.max(180, Number(list && list.clientHeight) || 260);
  var scrollTop = Math.max(0, Number(list && list.scrollTop) || 0);
  return { scrollTop: scrollTop, viewport: viewport };
}
function queueVirtualRange(total, options, rowStep, overscan) {
  rowStep = rowStep || QUEUE_ROW_STEP;
  overscan = overscan == null ? QUEUE_VIRTUAL_OVERSCAN : overscan;
  var viewport = Math.max(180, Number(options && options.viewport) || 400);
  var scrollTop = Math.max(0, Number(options && options.scrollTop) || 0);
  var maxRows = Math.ceil(viewport / rowStep) + overscan * 2;
  var start = Math.max(0, Math.floor(scrollTop / rowStep) - overscan);
  var end = Math.min(total, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, total - maxRows)));
  end = Math.min(total, Math.max(end, start + maxRows));
  return { start: start, end: end };
}
function queueItemHtml(song, i) {
  var thumb = songCoverSrc(song, 60);
  var imgTag = thumb
    ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="this.style.opacity=0.2"')
    : '<div style="width:38px;height:38px;border-radius:6px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
  return '<div class="queue-item' + (i === currentIdx ? ' now' : '') + '" data-queue-index="' + i + '" onclick="playQueueAt(' + i + ')">' +
    imgTag +
    '<div class="qi-info"><div class="qi-name">' + escHtml(song.name) + '</div><div class="qi-sub"><button class="queue-artist-link" type="button" onclick="event.stopPropagation();openQueueArtist(' + i + ')">' + escHtml(song.artist || '未知歌手') + '</button></div></div>' +
    '<div class="qi-act">' +
      '<button class="' + (isSongLiked(song) ? 'liked' : '') + '" onclick="event.stopPropagation();toggleLikeQueueIndex(' + i + ')" title="' + (isSongLiked(song) ? '取消红心' : '红心喜欢') + '">' + heartIconSvg() + '</button>' +
      '<button class="queue-next" onclick="event.stopPropagation();queueIndexNext(' + i + ')" title="下一首播放">下</button>' +
      '<button onclick="event.stopPropagation();collectQueueIndex(' + i + ')" title="收藏到歌单">' + playlistPlusIconSvg() + '</button>' +
      '<button onclick="event.stopPropagation();removeFromQueue(' + i + ')" title="移除">×</button>' +
    '</div>' +
  '</div>';
}
function miniQueueItemHtml(song, i) {
  var thumb = songCoverSrc(song, 60);
  var imgTag = thumb
    ? imgTagFromSrc(thumb, 'loading="lazy" decoding="async" onerror="this.style.opacity=0.2"')
    : '<div class="mini-queue-cover"></div>';
  return '<div class="mini-queue-item' + (i === currentIdx ? ' now' : '') + '" data-queue-index="' + i + '" onclick="playQueueAt(' + i + ')">' +
    imgTag +
    '<div class="mini-queue-info"><div class="mini-queue-name">' + escHtml(song.name) + '</div><div class="mini-queue-sub">' + escHtml(song.artist || '') + '</div></div>' +
    '<button class="mini-queue-remove mini-queue-next" onclick="event.stopPropagation();queueIndexNext(' + i + ')" title="下一首播放">下</button>' +
    '<button class="mini-queue-remove" onclick="event.stopPropagation();removeFromQueue(' + i + ')" title="移除">×</button>' +
  '</div>';
}
function queueRowsHtml(options) {
  var total = playQueue.length;
  if (!total) {
    return '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">队列为空，搜索后点 + 设为下一首</div>';
  }
  var range = queueVirtualRange(total, options || queuePanelWindowOptions(), QUEUE_ROW_STEP, QUEUE_VIRTUAL_OVERSCAN);
  queueVirtualState.start = range.start;
  queueVirtualState.end = range.end;
  var html = '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (range.start * QUEUE_ROW_STEP) + 'px"></div>';
  html += playQueue.slice(range.start, range.end).map(function(song, localIndex){
    return queueItemHtml(song, range.start + localIndex);
  }).join('');
  html += '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, total - range.end) * QUEUE_ROW_STEP) + 'px"></div>';
  return html;
}
function miniQueueRowsHtml(options) {
  var total = playQueue.length;
  if (!total) return '<div class="mini-queue-empty">队列为空，先搜索或打开歌单</div>';
  var range = queueVirtualRange(total, options || miniQueueWindowOptions(), MINI_QUEUE_ROW_STEP, MINI_QUEUE_VIRTUAL_OVERSCAN);
  miniQueueVirtualState.start = range.start;
  miniQueueVirtualState.end = range.end;
  var html = '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (range.start * MINI_QUEUE_ROW_STEP) + 'px"></div>';
  html += playQueue.slice(range.start, range.end).map(function(song, localIndex){
    return miniQueueItemHtml(song, range.start + localIndex);
  }).join('');
  html += '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, total - range.end) * MINI_QUEUE_ROW_STEP) + 'px"></div>';
  return html;
}
function renderQueuePanelRows() {
  var $ql = document.getElementById('queue-list');
  if (!$ql || !playQueue.length) return;
  $ql.innerHTML = queueRowsHtml(queuePanelWindowOptions());
}
function scheduleQueuePanelVirtualRender() {
  if (queueVirtualState.raf) return;
  queueVirtualState.raf = requestAnimationFrame(function(){
    queueVirtualState.raf = 0;
    if (queueViewTab !== 'queue' || !playQueue.length) return;
    renderQueuePanelRows();
  });
}
function scheduleMiniQueueVirtualRender() {
  if (miniQueueVirtualState.raf) return;
  miniQueueVirtualState.raf = requestAnimationFrame(function(){
    miniQueueVirtualState.raf = 0;
    if (!miniQueueOpen || !playQueue.length) return;
    var $list = document.getElementById('mini-queue-list');
    if (!$list) return;
    $list.innerHTML = miniQueueRowsHtml(miniQueueWindowOptions());
  });
}
function renderMiniQueuePanel(opts) {
  opts = opts || {};
  var $list = document.getElementById('mini-queue-list');
  var $count = document.getElementById('mini-queue-count');
  if (!$list || !$count) return;
  var total = playQueue.length;
  $count.textContent = total ? (total + ' 首' + (currentIdx >= 0 ? ' · 正在播放 ' + (currentIdx + 1) : '')) : '0 首';
  if (!miniQueueOpen && !opts.animate && !opts.scrollCurrent) return;
  if (!total) {
    $list.innerHTML = '<div class="mini-queue-empty">队列为空，先搜索或打开歌单</div>';
    return;
  }
  if (opts.scrollCurrent && currentIdx >= 0) {
    var approx = currentIdx * MINI_QUEUE_ROW_STEP - Math.max(0, ($list.clientHeight - MINI_QUEUE_ROW_STEP) * 0.42);
    $list.scrollTop = Math.max(0, Math.min(approx, Math.max(0, $list.scrollHeight - $list.clientHeight)));
  }
  $list.innerHTML = miniQueueRowsHtml(miniQueueWindowOptions());
  if (opts.animate || opts.scrollCurrent) {
    requestAnimationFrame(function(){
      if (opts.animate) animateListItems($list, '.mini-queue-item', { x: 0, y: 6, stagger: 0.01, duration: 0.20, limit: 16 });
      if (opts.scrollCurrent) {
        var nowItem = $list.querySelector('.mini-queue-item.now');
        if (nowItem) smoothScrollToItem($list, nowItem, { duration: 0.30, align: 0.42 });
      }
    });
  }
}
document.addEventListener('click', function(e){
  if (miniQueueOpen && !(e.target && e.target.closest && e.target.closest('#bottom-bar'))) closeMiniQueue();
});
bindSmoothQueueScrolling();
bindPlaylistPanelLazyRender();
bindModalBackdropClose();
(function bindMiniQueueVirtualScroll(){
  var list = document.getElementById('mini-queue-list');
  if (!list || list.__queueVirtualBound) return;
  list.__queueVirtualBound = true;
  list.addEventListener('scroll', throttle(function(){
    if (!miniQueueOpen) return;
    scheduleMiniQueueVirtualRender();
  }, 16), { passive: true });
})();
function renderQueuePanel(opts) {
  opts = opts || {};
  var $ql = document.getElementById('queue-list');
  var seq = ++queueRenderSeq;
  if (!playQueue.length) {
    $ql.innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">队列为空，搜索后点 + 设为下一首</div>';
    queueVirtualState.start = -1;
    queueVirtualState.end = -1;
    renderMiniQueuePanel();
    var panel = document.getElementById('playlist-panel');
    if (panel && (panel.classList.contains('show') || panel.classList.contains('peek')) && queueViewTab === 'queue') switchPlaylistTab('playlists');
    return;
  }
  if (opts.scrollCurrent && currentIdx >= 0) {
    var panelEl = document.getElementById('playlist-panel');
    if (panelEl) {
      var listTop = Math.max(0, Number($ql.offsetTop) || 0);
      var approx = listTop + currentIdx * QUEUE_ROW_STEP - Math.max(0, (panelEl.clientHeight - QUEUE_ROW_STEP) * 0.34);
      panelEl.scrollTop = Math.max(0, Math.min(approx, Math.max(0, panelEl.scrollHeight - panelEl.clientHeight)));
    }
  }
  $ql.innerHTML = queueRowsHtml(queuePanelWindowOptions());
  if (opts.animate && seq === queueRenderSeq) animateVisiblePanelList($ql, '.queue-item', document.getElementById('playlist-panel'), '.queue-item.now');
  else if (opts.scrollCurrent && seq === queueRenderSeq) {
    requestAnimationFrame(function(){
      var panelEl = document.getElementById('playlist-panel');
      var nowItem = $ql.querySelector('.queue-item.now');
      if (panelEl && nowItem) smoothScrollToItem(panelEl, nowItem, { duration: 0.28, align: 0.34 });
    });
  }
  renderMiniQueuePanel({ scrollCurrent: miniQueueOpen });
}
