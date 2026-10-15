// ============================================================
//  休息提醒 · Break Reminder（10-shell/06）
//  连续聆听到达间隔后，整屏浮出一层柔和的休息提示（参考 ChatGPT 的「想休息一下吗？」）。
//  - 计时口径：只在「正在播放」时累计；暂停满 BREAK_REMINDER_IDLE_RESET_MS 视为已经休息，计数归零。
//  - 存档：mineradio-break-reminder-v1（enabled / intervalMin / snoozeMin），与 fx 视觉存档分离，
//    FX 面板「恢复默认」不会动它。
//  - 入口：FX 控制台「高级参数 → 休息提醒」+ 播放选项菜单快捷开关。
//  - 手动预览：showBreakReminder()（等价 window.Mineradio.breakReminder.preview()）。
// ============================================================
var BREAK_REMINDER_STORE_KEY = 'mineradio-break-reminder-v1';
// 暂停这么久 = 用户已经休息过，连续聆听计数归零
var BREAK_REMINDER_IDLE_RESET_MS = 10 * 60 * 1000;
// 面板里的间隔档位是 30 / 45 / 60 / 90 分钟（见 index.html 的 #break-reminder-interval-seg）；
// 存档本身接受 10~240 任意整数，clampBreakReminderMinutes 负责夹取。
var breakReminder = {
  enabled: true,
  intervalMin: 60,
  snoozeMin: 20,
  accumulatedMs: 0,
  snoozeUntil: 0,
  snoozeStreak: 0,
  visible: false,
  pausedAt: 0,
  lastShownAt: 0,
  tickTimer: 0,
  lastTickAt: 0,
  lastStatusText: '',
  bound: false
};

function clampBreakReminderMinutes(value, fallback) {
  var num = Number(value);
  if (!isFinite(num) || num <= 0) num = fallback;
  return Math.round(Math.max(10, Math.min(240, num)));
}

// 连续忽略提醒时让步：20 → 40 → 80 → 160 → 240 分钟封顶，真正休息过（暂停满 10 分钟）后重置
function breakReminderSnoozeMinutes() {
  var base = Math.max(1, breakReminder.snoozeMin);
  var steps = Math.max(0, Math.min(4, breakReminder.snoozeStreak));
  return Math.min(240, Math.round(base * Math.pow(2, steps)));
}

function readBreakReminderPreference() {
  try {
    var raw = JSON.parse(localStorage.getItem(BREAK_REMINDER_STORE_KEY) || '{}') || {};
    breakReminder.enabled = raw.enabled !== false;
    breakReminder.intervalMin = clampBreakReminderMinutes(raw.intervalMin, 60);
    breakReminder.snoozeMin = clampBreakReminderMinutes(raw.snoozeMin, 20);
  } catch (e) {}
}

function saveBreakReminderPreference() {
  try {
    localStorage.setItem(BREAK_REMINDER_STORE_KEY, JSON.stringify({
      enabled: !!breakReminder.enabled,
      intervalMin: breakReminder.intervalMin,
      snoozeMin: breakReminder.snoozeMin
    }));
  } catch (e) {}
}

function breakReminderIntervalMs() {
  return Math.max(1, breakReminder.intervalMin) * 60000;
}

function formatBreakReminderDuration(ms) {
  var totalMin = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  var hours = Math.floor(totalMin / 60);
  var minutes = totalMin % 60;
  if (hours > 0) return minutes > 0 ? (hours + ' 小时 ' + minutes + ' 分钟') : (hours + ' 小时');
  if (totalMin > 0) return totalMin + ' 分钟';
  return '不到 1 分钟';
}

function breakReminderIsPlaying() {
  try {
    if (typeof playing !== 'undefined' && playing) return true;
    if (typeof audio !== 'undefined' && audio && !audio.paused && !audio.ended) return true;
  } catch (e) {}
  return false;
}

// 已经休息够久：计数与 snooze 一起归零，下一轮从 0 开始
function resetBreakReminderSession(now) {
  breakReminder.accumulatedMs = 0;
  breakReminder.snoozeUntil = 0;
  breakReminder.snoozeStreak = 0;
  breakReminder.lastStatusText = '';
  breakReminder.pausedAt = breakReminderIsPlaying() ? 0 : (Number(now) || Date.now());
}

// 别的整屏浮层（引导 / 弹窗 / 平台推荐）在前台时不抢焦点，tick 会每秒重试
function breakReminderSuppressedBySurface() {
  var body = document.body;
  if (!body) return true;
  if (body.classList.contains('splash-active')) return true;
  if (body.classList.contains('visual-guide-active')) return true;
  if (body.classList.contains('break-reminder-active')) return true;
  try {
    if (document.querySelector('.modal-mask.show')) return true;
    var recommend = document.getElementById('home-platform-recommend');
    if (recommend && recommend.style && recommend.style.display && recommend.style.display !== 'none') return true;
  } catch (e) {}
  return false;
}

function breakReminderShouldFire(now) {
  if (!breakReminder.enabled || breakReminder.visible) return false;
  if (breakReminder.accumulatedMs < breakReminderIntervalMs()) return false;
  if (now < breakReminder.snoozeUntil) return false;
  if (document.hidden) return false;
  return !breakReminderSuppressedBySurface();
}

function breakReminderTick() {
  var now = Date.now();
  var delta = breakReminder.lastTickAt ? (now - breakReminder.lastTickAt) : 1000;
  breakReminder.lastTickAt = now;
  // 休眠 / 后台节流导致的长间隔：最多按 90s 计入，别把挂机时长算成连续聆听
  delta = Math.max(0, Math.min(delta, 90000));
  if (breakReminderIsPlaying()) {
    breakReminder.pausedAt = 0;
    breakReminder.accumulatedMs += delta;
  } else if (!breakReminder.pausedAt) {
    breakReminder.pausedAt = now;
  } else if (now - breakReminder.pausedAt >= BREAK_REMINDER_IDLE_RESET_MS) {
    resetBreakReminderSession(now);
  }
  updateBreakReminderStatusUi();
  if (breakReminderShouldFire(now)) showBreakReminder();
}

function startBreakReminderTick() {
  if (breakReminder.tickTimer) return;
  breakReminder.lastTickAt = Date.now();
  breakReminder.tickTimer = setInterval(breakReminderTick, 1000);
}

function stopBreakReminderTick() {
  if (!breakReminder.tickTimer) return;
  clearInterval(breakReminder.tickTimer);
  breakReminder.tickTimer = 0;
}

function renderBreakReminderCopy() {
  var lead = document.getElementById('break-reminder-text-lead');
  var snooze = document.getElementById('break-reminder-snooze');
  if (lead) {
    lead.textContent = breakReminder.accumulatedMs >= 60000
      ? ('你已经连续听了 ' + formatBreakReminderDuration(breakReminder.accumulatedMs) + '。')
      : '耳朵也需要歇一歇。';
  }
  if (snooze) snooze.textContent = '再听 ' + breakReminderSnoozeMinutes() + ' 分钟';
}

function showBreakReminder(options) {
  options = options || {};
  var overlay = document.getElementById('break-reminder');
  if (!overlay) return false;
  if (breakReminder.visible) return false;
  if (!options.force && breakReminderSuppressedBySurface()) return false;
  breakReminder.visible = true;
  breakReminder.lastShownAt = Date.now();
  renderBreakReminderCopy();
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  if (document.body) document.body.classList.add('break-reminder-active');
  if (typeof closePlayerQuickMenu === 'function') {
    try { closePlayerQuickMenu(); } catch (e) {}
  }
  updateBreakReminderControls();
  return true;
}

function hideBreakReminder() {
  if (!breakReminder.visible) return false;
  var overlay = document.getElementById('break-reminder');
  breakReminder.visible = false;
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }
  if (document.body) document.body.classList.remove('break-reminder-active');
  updateBreakReminderControls();
  return true;
}

// × / 空白处 / Esc：保留累计时长，只把下次提醒推后 snoozeMin 分钟
function snoozeBreakReminder() {
  if (!breakReminder.visible) return;
  var waitMin = breakReminderSnoozeMinutes();
  breakReminder.snoozeUntil = Date.now() + waitMin * 60000;
  breakReminder.snoozeStreak += 1;
  hideBreakReminder();
  updateBreakReminderStatusUi(true);
  if (typeof showToast === 'function') showToast(waitMin + ' 分钟后如果还在听，我再提醒你');
}

// 「好，我去休息」：暂停播放 + 计数归零，下一轮重新开始
function restBreakReminder() {
  var wasPlaying = breakReminderIsPlaying();
  hideBreakReminder();
  resetBreakReminderSession();
  updateBreakReminderStatusUi(true);
  if (wasPlaying) {
    if (typeof stopPlaybackPreserveState === 'function') {
      try { stopPlaybackPreserveState(); } catch (e) {}
    } else if (typeof fadeOutAndPauseAudio === 'function') {
      try { fadeOutAndPauseAudio(); } catch (e) {}
    }
    if (typeof showToast === 'function') showToast('已暂停播放 · 休息好了再回来听');
  } else if (typeof showToast === 'function') {
    showToast('好，记得回来听');
  }
}

function setBreakReminderEnabled(on) {
  breakReminder.enabled = on == null ? !breakReminder.enabled : !!on;
  if (breakReminder.enabled) {
    if (breakReminder.accumulatedMs >= breakReminderIntervalMs()) resetBreakReminderSession();
    startBreakReminderTick();
  } else {
    stopBreakReminderTick();
    hideBreakReminder();
  }
  saveBreakReminderPreference();
  updateBreakReminderControls();
  if (typeof showToast === 'function') {
    showToast(breakReminder.enabled
      ? ('休听提醒已开启：连续聆听 ' + breakReminder.intervalMin + ' 分钟提醒一次')
      : '休息提醒已关闭');
  }
}

function toggleBreakReminderEnabled() {
  setBreakReminderEnabled(!breakReminder.enabled);
}

function setBreakReminderInterval(minutes) {
  breakReminder.intervalMin = clampBreakReminderMinutes(minutes, 60);
  breakReminder.lastStatusText = '';
  saveBreakReminderPreference();
  updateBreakReminderControls();
  if (typeof showToast === 'function') showToast('休息提醒间隔：' + breakReminder.intervalMin + ' 分钟');
}

function previewBreakReminder() {
  showBreakReminder({ force: true });
}

function updateBreakReminderStatusUi(force) {
  var el = document.getElementById('break-reminder-status');
  if (!el) return;
  var text;
  if (!breakReminder.enabled) {
    text = '已关闭';
  } else if (breakReminder.visible) {
    text = '正在等你休息一下';
  } else {
    var now = Date.now();
    if (now < breakReminder.snoozeUntil) {
      var waitMin = Math.max(1, Math.ceil((breakReminder.snoozeUntil - now) / 60000));
      text = '已提醒过 · ' + waitMin + ' 分钟后可再提醒';
    } else if (breakReminderIsPlaying()) {
      var remainMs = Math.max(0, breakReminderIntervalMs() - breakReminder.accumulatedMs);
      text = '已连续聆听 ' + formatBreakReminderDuration(breakReminder.accumulatedMs) +
        ' · 还剩 ' + formatBreakReminderDuration(remainMs);
    } else {
      text = breakReminder.accumulatedMs > 60000
        ? ('已暂停 · 连续聆听 ' + formatBreakReminderDuration(breakReminder.accumulatedMs))
        : '暂停中 · 播放后开始计时';
    }
  }
  if (!force && text === breakReminder.lastStatusText) return;
  breakReminder.lastStatusText = text;
  el.textContent = text;
  el.classList.toggle('on', breakReminder.enabled && !breakReminder.visible);
  el.classList.toggle('muted', !breakReminder.enabled);
}

function updateBreakReminderControls() {
  var enabled = !!breakReminder.enabled;
  var panelToggle = document.getElementById('t-breakReminderEnabled');
  if (panelToggle) panelToggle.classList.toggle('on', enabled);
  var quickToggle = document.getElementById('quick-menu-break-reminder-toggle');
  if (quickToggle) {
    quickToggle.classList.toggle('on', enabled);
    quickToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }
  var seg = document.getElementById('break-reminder-interval-seg');
  if (seg) {
    var buttons = seg.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var min = Number(buttons[i].getAttribute('data-break-reminder-interval')) || 0;
      buttons[i].classList.toggle('active', min === breakReminder.intervalMin);
    }
    seg.classList.toggle('disabled', !enabled);
  }
  var snoozeBtn = document.getElementById('break-reminder-snooze');
  if (snoozeBtn) snoozeBtn.textContent = '再听 ' + breakReminderSnoozeMinutes() + ' 分钟';
  updateBreakReminderStatusUi(true);
}

function bindBreakReminderControls() {
  if (breakReminder.bound) return;
  breakReminder.bound = true;
  var overlay = document.getElementById('break-reminder');
  var scrim = overlay ? overlay.querySelector('.break-reminder-scrim') : null;
  if (scrim) scrim.addEventListener('click', function () { snoozeBreakReminder(); });
  document.addEventListener('keydown', function (e) {
    if (!breakReminder.visible) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      snoozeBreakReminder();
    }
  });
  // 回到前台再对表：后台被节流的时间不算连续聆听，也可能正好该弹提醒
  document.addEventListener('visibilitychange', function () {
    breakReminder.lastTickAt = 0;
    if (document.hidden) return;
    updateBreakReminderStatusUi(true);
    if (breakReminderShouldFire(Date.now())) showBreakReminder();
  });
}

function initBreakReminder() {
  readBreakReminderPreference();
  bindBreakReminderControls();
  updateBreakReminderControls();
  if (breakReminder.enabled) startBreakReminderTick();
  try {
    if (typeof window !== 'undefined') {
      var api = {
        state: breakReminder,
        show: function () { return showBreakReminder({ force: true }); },
        preview: function () { return showBreakReminder({ force: true }); },
        hide: hideBreakReminder,
        snooze: snoozeBreakReminder,
        rest: restBreakReminder,
        setEnabled: setBreakReminderEnabled,
        setIntervalMin: setBreakReminderInterval,
        resetSession: function () { resetBreakReminderSession(); updateBreakReminderStatusUi(true); }
      };
      window.MineradioBreakReminder = api;
      if (window.Mineradio && typeof window.Mineradio === 'object') window.Mineradio.breakReminder = api;
    }
  } catch (e) {}
}

(function bootBreakReminder() {
  if (typeof document === 'undefined') return;
  var start = function () {
    try { initBreakReminder(); } catch (e) { console.warn('[BreakReminder] init failed', e); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
