/* Folia 世界 — FX 面板组件
 *
 * 「Folia 世界」折叠区：总开关 + 歌词样式列表 + 背景列表。
 * 开启时把「视觉预设」格子置灰（pointer-events: none），明确告诉用户预设不参与。
 * 面板是静态 HTML（index.html 里 #fx-folia-fold），本文件只负责填充与状态同步。
 */
'use strict';

function toggleFoliaWorldFold() {
  var fold = document.getElementById('fx-folia-fold');
  if (!fold) return;
  var willOpen = !fold.classList.contains('open');
  fold.classList.toggle('open', willOpen);
  if (willOpen) refreshFoliaWorldUi();
}

/* 参数设置独立折叠：默认合上，点标题才铺开（面板内容由 0l 填充，空的时候顺手补建一次）。 */
function toggleFoliaTuningFold() {
  var fold = document.getElementById('fx-folia-tuning-fold');
  if (!fold) return;
  var willOpen = !fold.classList.contains('open');
  fold.classList.toggle('open', willOpen);
  if (!willOpen) return;
  var host = document.getElementById('fx-folia-tuning');
  if (host && !host.firstChild && typeof foliaBuildTuningPanel === 'function') {
    try { foliaBuildTuningPanel(); } catch (err) { console.error('[FoliaWorld] tuning panel failed', err); }
  }
}

function foliaWorldBuildModeGrid() {
  var grid = document.getElementById('fx-folia-mode-grid');
  if (!grid) return;
  var modes = listFoliaModes();
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  for (var i = 0; i < modes.length; i++) {
    var mode = modes[i];
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'fx-folia-mode-card' + (mode.id === foliaWorld.mode ? ' active' : '');
    card.setAttribute('data-folia-mode-id', mode.id);
    var name = document.createElement('span');
    name.className = 'fx-folia-mode-name';
    name.textContent = mode.name;
    var desc = document.createElement('span');
    desc.className = 'fx-folia-mode-desc';
    desc.textContent = mode.desc;
    card.appendChild(name);
    card.appendChild(desc);
    (function (id) {
      card.addEventListener('click', function () { foliaWorldSetMode(id); });
    })(mode.id);
    grid.appendChild(card);
  }
}

function foliaWorldBuildBackgroundGrid() {
  var grid = document.getElementById('fx-folia-bg-grid');
  if (!grid) return;
  var bgs = listFoliaBackgrounds();
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  for (var i = 0; i < bgs.length; i++) {
    var bg = bgs[i];
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'fx-folia-bg-card' + (bg.id === foliaWorld.background ? ' active' : '');
    card.setAttribute('data-folia-bg-id', bg.id);
    var name = document.createElement('span');
    name.className = 'fx-folia-bg-name';
    name.textContent = bg.name;
    card.appendChild(name);
    (function (id) {
      card.addEventListener('click', function () { foliaWorldSetBackground(id); });
    })(bg.id);
    grid.appendChild(card);
  }
}

/* 调参折叠区的显隐由它自己的构建函数决定（没有可调项的样式整块藏起来）。 */
function foliaTuningFoldHost() {
  return document.getElementById('fx-folia-tuning-fold');
}

function refreshFoliaWorldUi() {
  var active = !!foliaWorld.active;
  var toggle = document.getElementById('fx-folia-world-toggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
    toggle.classList.toggle('is-on', active);
  }
  var lists = document.getElementById('fx-folia-lists');
  if (lists) lists.hidden = !active;
  var hint = document.getElementById('fx-folia-hint');
  if (hint) {
    hint.textContent = active
      ? '画面已交给 Folia：原有预设、3D 歌词与镜头暂停；音频与歌词仍在跑。'
      : '开启后，画面交给 Folia，原有预设与 3D 歌词暂停。';
  }
  var error = document.getElementById('fx-folia-error');
  if (error) {
    var reason = foliaWorld.failReason || '';
    error.hidden = !reason;
    error.textContent = reason;
  }
  var presetGrid = document.getElementById('preset-grid');
  if (presetGrid) presetGrid.classList.toggle('folia-locked', active);
  if (active) {
    foliaWorldBuildModeGrid();
    foliaWorldBuildBackgroundGrid();
    if (typeof foliaBuildTuningPanel === 'function') {
      try { foliaBuildTuningPanel(); } catch (err) { console.error('[FoliaWorld] tuning panel failed', err); }
    }
  } else {
    var tuningHost = document.getElementById('fx-folia-tuning');
    if (tuningHost) tuningHost.hidden = true;
    var tuningFold = foliaTuningFoldHost();
    if (tuningFold) tuningFold.hidden = true;
  }
}

/* 开关启动时若有存档，等开屏结束再进（避免在开屏后面白跑一套渲染）。
 * 判据是 wantActive（用户意图），不是 active（是否真在渲染）——后者在开屏期间本来就是 false。 */
function foliaWorldRestoreWhenReady() {
  if (!foliaWorld.wantActive) return;
  var attempts = 0;
  function attempt() {
    if (!foliaWorld.wantActive) return;
    var splash = document.body.classList.contains('splash-active');
    if (!splash || attempts >= 120) {
      foliaWorldEnter({ silent: true });
      return;
    }
    attempts += 1;
    setTimeout(attempt, 100);
  }
  attempt();
}

function initializeFoliaWorld() {
  readFoliaWorldPrefs();
  refreshFoliaWorldUi();
  foliaWorldRestoreWhenReady();
}

(function foliaWorldBoot() {
  function boot() {
    try { initializeFoliaWorld(); } catch (err) {
      console.error('[FoliaWorld] boot failed', err);
      try { foliaWorld.failReason = 'Folia 世界初始化失败：' + ((err && err.message) || String(err)); } catch (_) {}
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }
})();
