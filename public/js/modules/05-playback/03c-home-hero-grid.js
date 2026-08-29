/* Home MP4 英雄区 + quick-grid 拖拽重排。
 * 9.11 Home dashboard 完整版 — MP4 英雄区 + quick-grid 重排部分。
 * MP4 背景：受 fx.homeHeroMp4 控制，低配自动降级为静态封面。
 * Quick-grid：拖拽排序存 localStorage.homeGridLayout。 */
'use strict';

var HOME_HERO_MP4_STORAGE = 'mineradio-home-hero-mp4';
var homeHeroVideoState = { video: null, active: false, degraded: false };

function getHomeHeroMp4Url() {
  try {
    return localStorage.getItem(HOME_HERO_MP4_STORAGE) || (typeof fx !== 'undefined' && fx && fx.homeHeroMp4) || '';
  } catch (_) { return ''; }
}

function shouldDegradeHomeHeroVideo() {
  // 低配自动降级：GPU 节流开启 或 硬件并发 <= 4 或 prefers-reduced-motion
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  if (typeof fx !== 'undefined' && fx && fx.gpuThrottle) return true;
  return false;
}

function applyHomeHeroVideo() {
  var url = getHomeHeroMp4Url();
  if (!url || shouldDegradeHomeHeroVideo()) {
    removeHomeHeroVideo();
    return;
  }
  var heroEl = document.querySelector('.home-hero');
  if (!heroEl) return;
  var existing = document.getElementById('home-hero-video');
  if (existing && existing.src === url) return;
  if (existing) existing.remove();
  var video = document.createElement('video');
  video.id = 'home-hero-video';
  video.src = url;
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0;transition:opacity 0.6s ease;';
  video.addEventListener('loadeddata', function () { video.style.opacity = '0.45'; });
  video.addEventListener('error', function () { removeHomeHeroVideo(); });
  heroEl.insertBefore(video, heroEl.firstChild);
  homeHeroVideoState.video = video;
  homeHeroVideoState.active = true;
  homeHeroVideoState.degraded = false;
}

function removeHomeHeroVideo() {
  var video = document.getElementById('home-hero-video');
  if (video) video.remove();
  homeHeroVideoState.video = null;
  homeHeroVideoState.active = false;
  homeHeroVideoState.degraded = shouldDegradeHomeHeroVideo();
}

function setHomeHeroMp4(url) {
  try {
    if (url) localStorage.setItem(HOME_HERO_MP4_STORAGE, url);
    else localStorage.removeItem(HOME_HERO_MP4_STORAGE);
  } catch (_) {}
  applyHomeHeroVideo();
}

// Quick-grid 拖拽重排
// v2：卡片按唯一 data-card-id 识别（旧版按 data-home-tone，重复 tone 会键冲突导致排序错乱）
var HOME_GRID_LAYOUT_STORAGE = 'homeGridLayout';
var HOME_GRID_LAYOUT_V2_FLAG = 'mineradio-home-grid-layout-v2';
var homeGridState = { dragging: null, draggedOver: null };

function homeGridLayoutV2Ready() {
  try { return localStorage.getItem(HOME_GRID_LAYOUT_V2_FLAG) === '1'; } catch (_error) { return false; }
}

function markHomeGridLayoutV2() {
  try { localStorage.setItem(HOME_GRID_LAYOUT_V2_FLAG, '1'); } catch (_error) { }
}

function getHomeGridLayout() {
  try {
    var raw = JSON.parse(localStorage.getItem(HOME_GRID_LAYOUT_STORAGE) || 'null');
    if (Array.isArray(raw)) return raw;
  } catch (_) {}
  return null;
}

function saveHomeGridLayout(order) {
  try { localStorage.setItem(HOME_GRID_LAYOUT_STORAGE, JSON.stringify(order)); } catch (_) {}
}

function homeGridCardId(card, index) {
  return card.getAttribute('data-card-id') || card.getAttribute('data-home-tone') || ('card-' + index);
}

function applyHomeGridLayout() {
  var grid = document.querySelector('.home-grid');
  if (!grid) return;
  // v2 迁移：旧序列按 tone 记录，与新 ID 体系不兼容，首次升级作废（恢复 DOM 默认序，用户可重新拖排）
  if (!homeGridLayoutV2Ready()) {
    markHomeGridLayoutV2();
    return;
  }
  var order = getHomeGridLayout();
  if (!order) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.home-card, .home-pet-card'));
  var cardMap = {};
  cards.forEach(function (card, i) {
    cardMap[homeGridCardId(card, i)] = card;
  });
  var reordered = [];
  order.forEach(function (id) { if (cardMap[id]) { reordered.push(cardMap[id]); delete cardMap[id]; } });
  // 未在 order 中的卡片追加到末尾
  Object.keys(cardMap).forEach(function (id) { reordered.push(cardMap[id]); });
  reordered.forEach(function (card) { grid.appendChild(card); });
}

function bindHomeGridDragReorder() {
  var grid = document.querySelector('.home-grid');
  if (!grid || grid._homeGridDragBound) return;
  grid._homeGridDragBound = true;

  grid.querySelectorAll('.home-card, .home-pet-card').forEach(function (card) {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', function (e) {
      homeGridState.dragging = card;
      card.classList.add('home-card-dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', homeGridCardId(card, 0)); } catch (_) {} }
    });
    card.addEventListener('dragend', function () {
      card.classList.remove('home-card-dragging');
      if (homeGridState.draggedOver) homeGridState.draggedOver.classList.remove('home-card-drag-over');
      homeGridState.dragging = null;
      homeGridState.draggedOver = null;
      var order = Array.prototype.slice.call(grid.querySelectorAll('.home-card, .home-pet-card')).map(function (c) { return c.getAttribute('data-card-id') || c.getAttribute('data-home-tone') || ''; }).filter(Boolean);
      saveHomeGridLayout(order);
    });
    card.addEventListener('dragover', function (e) {
      if (homeGridState.dragging && homeGridState.dragging !== card) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (homeGridState.draggedOver && homeGridState.draggedOver !== card) homeGridState.draggedOver.classList.remove('home-card-drag-over');
        card.classList.add('home-card-drag-over');
        homeGridState.draggedOver = card;
      }
    });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!homeGridState.dragging || homeGridState.dragging === card) return;
      var gridEl = card.parentNode;
      var dragging = homeGridState.dragging;
      var cards = Array.prototype.slice.call(gridEl.querySelectorAll('.home-card, .home-pet-card'));
      var dragIdx = cards.indexOf(dragging);
      var dropIdx = cards.indexOf(card);
      if (dragIdx < 0 || dropIdx < 0) return;
      if (dragIdx < dropIdx) {
        gridEl.insertBefore(dragging, card.nextSibling);
      } else {
        gridEl.insertBefore(dragging, card);
      }
    });
  });
}

function initHomeHeroAndGrid() {
  applyHomeGridLayout();
  bindHomeGridDragReorder();
  applyHomeHeroVideo();
}
