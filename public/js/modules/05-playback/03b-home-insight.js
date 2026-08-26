/* Home insight dock: 本周听歌时长 / 顶 5 歌曲 / 顶 5 曲风 / 连续播放天数。
 * 数据来自 listenStatsState（已由 01-cover-listen-helpers 累积并持久化）。
 * 9.11 Home dashboard 完整版 — insight dock 部分。 */
'use strict';

var HOME_INSIGHT_WEEK_DAYS = 7;
var HOME_INSIGHT_TOP_LIMIT = 5;
var homeInsightDockState = { open: false, raf: 0 };

function formatListenDuration(ms) {
  var totalMin = Math.floor((ms || 0) / 60000);
  if (totalMin < 1) return '不足 1 分钟';
  if (totalMin < 60) return totalMin + ' 分钟';
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h < 24) return m > 0 ? (h + ' 小时 ' + m + ' 分') : (h + ' 小时');
  var d = Math.floor(h / 24);
  var remH = h % 24;
  return remH > 0 ? (d + ' 天 ' + remH + ' 小时') : (d + ' 天');
}

function computeWeeklyListenMs() {
  var now = Date.now();
  var weekAgo = now - HOME_INSIGHT_WEEK_DAYS * 86400000;
  var history = (listenStatsState && listenStatsState.history) || [];
  var total = 0;
  for (var i = 0; i < history.length; i++) {
    var rec = history[i];
    if (rec && rec.playedAt >= weekAgo) total += (rec.listenMs || 0);
  }
  return total;
}

function computeStreakDays() {
  var history = (listenStatsState && listenStatsState.history) || [];
  if (!history.length) return 0;
  var dayBuckets = {};
  for (var i = 0; i < history.length; i++) {
    var rec = history[i];
    if (!rec || !rec.playedAt) continue;
    var d = new Date(rec.playedAt);
    var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    dayBuckets[key] = true;
  }
  var streak = 0;
  var cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (streak < 365) {
    var key = cursor.getFullYear() + '-' + (cursor.getMonth() + 1) + '-' + cursor.getDate();
    if (dayBuckets[key]) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function topSongsForInsight() {
  var list = Object.keys(listenStatsState.songs || {}).map(function (key) { return listenStatsState.songs[key]; });
  list.sort(function (a, b) { return (b.listenMs - a.listenMs) || (b.plays - a.plays); });
  return list.slice(0, HOME_INSIGHT_TOP_LIMIT);
}

function topArtistsForInsight() {
  var list = Object.keys(listenStatsState.artists || {}).map(function (key) { return listenStatsState.artists[key]; });
  list.sort(function (a, b) { return (b.listenMs - a.listenMs) || (b.plays - a.plays); });
  return list.slice(0, HOME_INSIGHT_TOP_LIMIT);
}

function buildInsightDockHtml() {
  var weeklyMs = computeWeeklyListenMs();
  var streak = computeStreakDays();
  var topSongs = topSongsForInsight();
  var topArtists = topArtistsForInsight();
  var totalPlays = homeListenSummary().totalPlays;

  var html = '<div class="home-insight-dock" id="home-insight-dock" role="dialog" aria-label="听歌画像">';
  html += '<div class="home-insight-backdrop" onclick="closeHomeInsightDock()"></div>';
  html += '<div class="home-insight-panel">';
  html += '<div class="home-insight-header">';
  html += '<div class="home-insight-title">听歌画像</div>';
  html += '<button class="home-insight-close" type="button" onclick="closeHomeInsightDock()" aria-label="关闭">×</button>';
  html += '</div>';

  html += '<div class="home-insight-stats">';
  html += '<div class="home-insight-stat"><div class="home-insight-stat-value">' + formatListenDuration(weeklyMs) + '</div><div class="home-insight-stat-label">本周时长</div></div>';
  html += '<div class="home-insight-stat"><div class="home-insight-stat-value">' + streak + ' 天</div><div class="home-insight-stat-label">连续播放</div></div>';
  html += '<div class="home-insight-stat"><div class="home-insight-stat-value">' + totalPlays + '</div><div class="home-insight-stat-label">累计播放</div></div>';
  html += '</div>';

  if (topSongs.length) {
    html += '<div class="home-insight-section"><div class="home-insight-section-title">最常听</div>';
    for (var i = 0; i < topSongs.length; i++) {
      var s = topSongs[i];
      html += '<div class="home-insight-row" onclick="closeHomeInsightDock(); runHomeSearch(' + JSON.stringify(s.name) + ')">';
      html += '<div class="home-insight-rank">' + (i + 1) + '</div>';
      var cover = s.cover ? (typeof coverUrlWithSize === 'function' ? coverUrlWithSize(s.cover, 64) : s.cover) : '';
      html += '<div class="home-insight-row-art"' + (cover ? (' style="background-image:url(\'' + escAttr(cover) + '\')"') : '') + '></div>';
      html += '<div class="home-insight-row-info"><div class="home-insight-row-name">' + escHtml(s.name || '未知') + '</div>';
      html += '<div class="home-insight-row-meta">' + escHtml(s.artist || '') + ' · ' + s.plays + ' 次 · ' + formatListenDuration(s.listenMs) + '</div></div>';
      html += '</div>';
    }
    html += '</div>';
  }

  if (topArtists.length) {
    html += '<div class="home-insight-section"><div class="home-insight-section-title">顶曲风</div>';
    for (var j = 0; j < topArtists.length; j++) {
      var a = topArtists[j];
      html += '<div class="home-insight-row" onclick="closeHomeInsightDock(); runHomeSearch(' + JSON.stringify(a.name) + ')">';
      html += '<div class="home-insight-rank">' + (j + 1) + '</div>';
      html += '<div class="home-insight-row-art home-insight-artist-art">' + escHtml((a.name || '?').charAt(0)) + '</div>';
      html += '<div class="home-insight-row-info"><div class="home-insight-row-name">' + escHtml(a.name || '未知') + '</div>';
      html += '<div class="home-insight-row-meta">' + a.plays + ' 次 · ' + formatListenDuration(a.listenMs) + '</div></div>';
      html += '</div>';
    }
    html += '</div>';
  }

  if (!topSongs.length && !topArtists.length) {
    html += '<div class="home-insight-empty">播放几首歌后，这里会生成本周听歌时长、最常听歌曲和顶曲风画像。</div>';
  }

  html += '<div class="home-insight-ai-entry">';
  html += '<button type="button" onclick="openAiPlaylistModal()" title="AI 根据你的听歌画像生成歌单">';
  html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5z"/></svg>';
  html += '<span>AI 歌单</span>';
  html += '</button>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

function openHomeInsightDock() {
  if (homeInsightDockState.open) return;
  homeInsightDockState.open = true;
  var container = document.createElement('div');
  container.id = 'home-insight-dock-container';
  container.innerHTML = buildInsightDockHtml();
  document.body.appendChild(container);
  document.body.classList.add('home-insight-active');
  try {
    var panel = container.querySelector('.home-insight-panel');
    if (panel) panel.scrollTop = 0;
  } catch (_) {}
}

function closeHomeInsightDock() {
  if (!homeInsightDockState.open) return;
  homeInsightDockState.open = false;
  var container = document.getElementById('home-insight-dock-container');
  if (container) container.remove();
  document.body.classList.remove('home-insight-active');
}
