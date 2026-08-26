function updateMoodAudioUi() {
  var mode = Mineradio.moodAudio ? Mineradio.moodAudio.getMode() : 'auto';
  var visualLink = Mineradio.moodAudio && Mineradio.moodAudio.getVisualLink ? Mineradio.moodAudio.getVisualLink() : true;
  var label = document.getElementById('mood-audio-btn-label');
  var btn = document.getElementById('mood-audio-btn');
  var text = Mineradio.moodAudio ? Mineradio.moodAudio.modeLabel(mode) : '自动';
  if (label) label.textContent = text;
  if (btn) {
    btn.classList.toggle('active', mode === 'auto' && !(Mineradio.moodAudio.isAbHold && Mineradio.moodAudio.isAbHold()));
    btn.classList.toggle('ab-hold', !!(Mineradio.moodAudio.isAbHold && Mineradio.moodAudio.isAbHold()));
    btn.title = mode === 'auto'
      ? ('情绪音效: 自动 · 轻微 · ' + (visualLink ? '联动视觉' : '仅音效') + ' · 按住对比原声')
      : (mode === 'raw' ? '情绪音效: 原声' : '情绪音效: 关闭');
  }
  document.querySelectorAll('.mood-option').forEach(function(option){
    option.classList.toggle('active', String(option.dataset.mood || '') === mode);
  });
  var autoDesc = document.getElementById('mood-auto-desc');
  if (autoDesc) autoDesc.textContent = visualLink ? 'EQ + 动态 · 联动视觉' : 'EQ + 动态 · 仅音效';
  var visualRow = document.getElementById('mood-visual-row');
  if (visualRow) visualRow.classList.toggle('disabled', mode !== 'auto');
  document.querySelectorAll('.mood-visual-chip').forEach(function(chip){
    var on = String(chip.getAttribute('data-visual-link') || '') === '1';
    chip.classList.toggle('active', on === visualLink);
  });
}
var moodMeterUiLast = 0;
function updateMoodAudioMeterUi(force) {
  if (!Mineradio.moodAudio) return;
  var now = performance.now();
  if (!force && now - moodMeterUiLast < 180) return;
  moodMeterUiLast = now;
  var params = Mineradio.moodAudio.getParams();
  document.querySelectorAll('.mood-meter-fill').forEach(function(el){
    var key = el.getAttribute('data-mood-key');
    var val = clamp01(params[key] || 0);
    el.style.transform = 'scaleX(' + val.toFixed(3) + ')';
  });
  var styleTag = document.getElementById('mood-style-tag');
  if (styleTag && Mineradio.moodAudio.getStyleProfile) {
    var sp = Mineradio.moodAudio.getStyleProfile();
    var suffix = Mineradio.moodAudio.getMode() === 'auto' && Mineradio.moodAudio.getVisualLink && !Mineradio.moodAudio.getVisualLink() ? ' · 仅音效' : '';
    styleTag.textContent = '曲风策略 · ' + (sp.label || '综合') + suffix;
  }
}
function setMoodVisualLink(on, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!Mineradio.moodAudio || Mineradio.moodAudio.getMode() !== 'auto') return;
  Mineradio.moodAudio.setVisualLink(!!on);
  updateMoodAudioUi();
  updateMoodAudioMeterUi(true);
  showToast(on ? '情绪音效: 联动视觉已开启' : '情绪音效: 仅音效（不联动画面）');
}
var moodAbHoldTimer = null;
var moodAbSuppressClick = false;
function endMoodAbHold() {
  if (moodAbHoldTimer) {
    clearTimeout(moodAbHoldTimer);
    moodAbHoldTimer = null;
  }
  if (Mineradio.moodAudio && Mineradio.moodAudio.isAbHold && Mineradio.moodAudio.isAbHold()) {
    Mineradio.moodAudio.endAbHold();
    updateMoodAudioUi();
  }
}
function beginMoodAbHoldSoon() {
  if (moodAbHoldTimer) return;
  moodAbHoldTimer = setTimeout(function(){
    moodAbHoldTimer = null;
    if (!Mineradio.moodAudio || Mineradio.moodAudio.getMode() !== 'auto') return;
    if (Mineradio.moodAudio.beginAbHold()) {
      moodAbSuppressClick = true;
      updateMoodAudioUi();
    }
  }, 260);
}
function setMoodAudioMode(mode) {
  if (!Mineradio.moodAudio) return;
  Mineradio.moodAudio.setMode(mode);
  updateMoodAudioUi();
  var wrap = document.getElementById('mood-audio-control');
  if (wrap) {
    wrap.classList.remove('open');
    var pop = wrap.querySelector('.mood-popover');
    if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
      window.MineradioMotion.springPopover(pop, false);
    }
  }
  var toastMap = { auto: '情绪音效: 自动 · 轻微', raw: '情绪音效: 原声', off: '情绪音效: 关闭' };
  if (mode === 'auto' && Mineradio.moodAudio.getVisualLink && !Mineradio.moodAudio.getVisualLink()) {
    toastMap.auto = '情绪音效: 自动 · 轻微 · 仅音效';
  }
  showToast(toastMap[mode] || toastMap.auto);
}
function toggleMoodAudioPanel(e) {
  if (e) e.stopPropagation();
  var wrap = document.getElementById('mood-audio-control');
  if (!wrap) return;
  var open = !wrap.classList.contains('open');
  wrap.classList.toggle('open', open);
  var pop = wrap.querySelector('.mood-popover');
  if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
    window.MineradioMotion.springPopover(pop, open);
  }
  updateMoodAudioMeterUi(true);
}
function bindMoodAudioControl() {
  if (Mineradio.moodAudio && Mineradio.moodAudio.readPreference) Mineradio.moodAudio.readPreference();
  var wrap = document.getElementById('mood-audio-control');
  var btn = document.getElementById('mood-audio-btn');
  if (wrap) {
    wrap.addEventListener('mouseenter', function(){
      wrap.classList.add('open');
      var pop = wrap.querySelector('.mood-popover');
      if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
        window.MineradioMotion.springPopover(pop, true);
      }
      updateMoodAudioMeterUi(true);
    });
    wrap.addEventListener('mouseleave', function(){
      endMoodAbHold();
      setTimeout(function(){
        if (!wrap.matches(':hover')) {
          wrap.classList.remove('open');
          var pop = wrap.querySelector('.mood-popover');
          if (pop && window.MineradioMotion && typeof window.MineradioMotion.springPopover === 'function') {
            window.MineradioMotion.springPopover(pop, false);
          }
        }
      }, 260);
    });
  }
  if (btn) {
    btn.addEventListener('mousedown', function(e){
      if (e.button !== 0) return;
      moodAbSuppressClick = false;
      beginMoodAbHoldSoon();
    });
    btn.addEventListener('mouseup', endMoodAbHold);
    btn.addEventListener('mouseleave', endMoodAbHold);
    btn.addEventListener('click', function(e){
      if (moodAbSuppressClick) {
        moodAbSuppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleMoodAudioPanel(e);
    });
    btn.addEventListener('touchstart', function(){
      moodAbSuppressClick = false;
      beginMoodAbHoldSoon();
    }, { passive: true });
    btn.addEventListener('touchend', endMoodAbHold);
    btn.addEventListener('touchcancel', endMoodAbHold);
  }
  document.addEventListener('click', function(e){
    if (wrap && !wrap.contains(e.target)) wrap.classList.remove('open');
  });
  updateMoodAudioUi();
}
function readSleepTimerState() {
  try {
    var raw = JSON.parse(localStorage.getItem(SLEEP_TIMER_STORE_KEY) || '{}') || {};
    sleepTimer.durationMin = clampRange(Number(raw.durationMin) || 30, 1, 480);
    sleepTimer.finishSong = raw.finishSong === true;
    sleepTimer.closeApp = raw.closeApp === true;
    if (raw.active && raw.endsAt && Number(raw.endsAt) > Date.now()) {
      sleepTimer.active = true;
      sleepTimer.endsAt = Number(raw.endsAt);
      sleepTimer.pendingStop = raw.pendingStop === true;
    } else {
      sleepTimer.active = false;
      sleepTimer.endsAt = 0;
      sleepTimer.pendingStop = false;
    }
  } catch (e) {}
}
function saveSleepTimerState() {
  try {
    localStorage.setItem(SLEEP_TIMER_STORE_KEY, JSON.stringify({
      active: !!sleepTimer.active,
      endsAt: sleepTimer.endsAt || 0,
      durationMin: clampRange(Number(sleepTimer.durationMin) || 30, 1, 480),
      finishSong: !!sleepTimer.finishSong,
      closeApp: !!sleepTimer.closeApp,
      pendingStop: !!sleepTimer.pendingStop
    }));
  } catch (e) {}
}
function formatSleepTimerRemain(ms) {
  ms = Math.max(0, Number(ms) || 0);
  var totalSec = Math.ceil(ms / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function updateSleepTimerUi() {
  var remainEl = document.getElementById('sleep-timer-remain');
  var custom = document.getElementById('sleep-timer-custom-min');
  var finishEl = document.getElementById('sleep-timer-finish-song');
  var closeEl = document.getElementById('sleep-timer-close-app');
  if (custom) custom.value = String(clampRange(Number(sleepTimer.durationMin) || 30, 1, 480));
  if (finishEl) finishEl.classList.toggle('on', !!sleepTimer.finishSong);
  if (closeEl) closeEl.classList.toggle('on', !!sleepTimer.closeApp);
  document.querySelectorAll('.sleep-timer-presets button').forEach(function (node) {
    var min = Number(node.getAttribute('data-sleep-min')) || 0;
    node.classList.toggle('active', min === clampRange(Number(sleepTimer.durationMin) || 0, 1, 480));
  });
  if (remainEl) {
    if (sleepTimer.pendingStop) remainEl.textContent = '等待当前歌曲结束';
    else if (sleepTimer.active && sleepTimer.endsAt) remainEl.textContent = '剩余 ' + formatSleepTimerRemain(sleepTimer.endsAt - Date.now());
    else remainEl.textContent = '未开启';
  }
  updatePlayerQuickMenuUi();
}
function positionPlayerQuickMenuPopover() {
  var pop = document.getElementById('player-quick-menu-popover');
  var anchor = document.getElementById('top-right');
  if (!pop || !anchor) return;
  var rect = anchor.getBoundingClientRect();
  pop.style.top = Math.round(rect.top) + 'px';
  pop.style.right = Math.round(Math.max(12, window.innerWidth - rect.right)) + 'px';
  pop.style.left = 'auto';
  pop.style.bottom = 'auto';
}
function syncPlayerQuickMenuTriggers(opening) {
  ['player-quick-menu-btn', 'player-quick-menu-btn-fs'].forEach(function(id){
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('active', !!opening);
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
}
function togglePlayerQuickMenu(e) {
  if (e) e.stopPropagation();
  var opening = !document.body.classList.contains('player-quick-menu-open');
  document.body.classList.toggle('player-quick-menu-open', opening);
  syncPlayerQuickMenuTriggers(opening);
  if (opening) {
    positionPlayerQuickMenuPopover();
    updateSleepTimerUi();
    updatePlayerQuickMenuUi();
    updateAudioFadeUi();
  }
}
function closePlayerQuickMenu() {
  document.body.classList.remove('player-quick-menu-open');
  syncPlayerQuickMenuTriggers(false);
}
function closePlayerQuickMenuUnless(target) {
  if (!document.body.classList.contains('player-quick-menu-open')) return;
  var pop = document.getElementById('player-quick-menu-popover');
  var btn = document.getElementById('player-quick-menu-btn');
  var btnFs = document.getElementById('player-quick-menu-btn-fs');
  if ((pop && pop.contains(target)) || (btn && btn.contains(target)) || (btnFs && btnFs.contains(target))) return;
  closePlayerQuickMenu();
}
function bindPlayerQuickMenu() {
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closePlayerQuickMenu();
  });
  window.addEventListener('resize', function(){
    if (!document.body.classList.contains('player-quick-menu-open')) return;
    positionPlayerQuickMenuPopover();
  });
  updatePlayerQuickMenuUi();
}
function selectSleepTimerPreset(minutes) {
  sleepTimer.durationMin = clampRange(Number(minutes) || 30, 1, 480);
  updateSleepTimerUi();
}
function toggleSleepTimerOption(key) {
  if (key === 'finishSong') sleepTimer.finishSong = !sleepTimer.finishSong;
  else if (key === 'closeApp') sleepTimer.closeApp = !sleepTimer.closeApp;
  saveSleepTimerState();
  updateSleepTimerUi();
}
function bindSleepTimerControl() {
  readSleepTimerState();
  updateSleepTimerUi();
  if (sleepTimer.active || sleepTimer.pendingStop) scheduleSleepTimerTick();
  var custom = document.getElementById('sleep-timer-custom-min');
  if (custom) {
    custom.addEventListener('change', function(){
      sleepTimer.durationMin = clampRange(Number(custom.value) || 30, 1, 480);
      updateSleepTimerUi();
    });
  }
  bindPlayerQuickMenu();
}
function startSleepTimerFromUi() {
  var custom = document.getElementById('sleep-timer-custom-min');
  var minutes = clampRange(Number(custom && custom.value) || sleepTimer.durationMin || 30, 1, 480);
  startSleepTimer(minutes);
}
function startSleepTimer(minutes) {
  minutes = clampRange(Number(minutes) || sleepTimer.durationMin || 30, 1, 480);
  sleepTimer.durationMin = minutes;
  sleepTimer.endsAt = Date.now() + minutes * 60000;
  sleepTimer.active = true;
  sleepTimer.pendingStop = false;
  saveSleepTimerState();
  scheduleSleepTimerTick();
  updateSleepTimerUi();
  showToast('定时关闭已开启：' + minutes + ' 分钟');
}
function cancelSleepTimer(showTip) {
  sleepTimer.active = false;
  sleepTimer.pendingStop = false;
  sleepTimer.endsAt = 0;
  if (sleepTimer.tickTimer) {
    clearInterval(sleepTimer.tickTimer);
    sleepTimer.tickTimer = null;
  }
  saveSleepTimerState();
  updateSleepTimerUi();
  if (showTip) showToast('定时关闭已取消');
}
function scheduleSleepTimerTick() {
  if (sleepTimer.tickTimer) return;
  sleepTimer.tickTimer = setInterval(tickSleepTimer, 1000);
  tickSleepTimer();
}
function tickSleepTimer() {
  if (!sleepTimer.active && !sleepTimer.pendingStop) {
    if (sleepTimer.tickTimer) {
      clearInterval(sleepTimer.tickTimer);
      sleepTimer.tickTimer = null;
    }
    updateSleepTimerUi();
    return;
  }
  if (sleepTimer.pendingStop) {
    updateSleepTimerUi();
    return;
  }
  if (Date.now() >= sleepTimer.endsAt) onSleepTimerExpired();
  else updateSleepTimerUi();
}
function onSleepTimerExpired() {
  if (sleepTimer.finishSong && playing && audio && !audio.paused && !audio.ended) {
    sleepTimer.pendingStop = true;
    saveSleepTimerState();
    updateSleepTimerUi();
    showToast('定时已到，将在当前歌曲播放完毕后停止');
    return;
  }
  executeSleepTimerStop();
}
function closePlayerApp() {
  var api = window.desktopWindow;
  if (api && api.isDesktop && typeof api.close === 'function') {
    api.close();
    return;
  }
  try { window.close(); } catch (e) {}
}
function executeSleepTimerStop() {
  var shouldClose = !!sleepTimer.closeApp;
  cancelSleepTimer(false);
  stopPlaybackPreserveState().then(function(){
    showToast('定时关闭已停止播放');
    if (shouldClose) setTimeout(closePlayerApp, 700);
  });
}
function stopPlaybackPreserveState() {
  return Promise.resolve(fadeOutAndPauseAudio()).then(function(){
    playing = false;
    setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    savePlaybackSession(true);
    updatePlaybackProgressUi();
    syncPlaybackStateFromAudioEvent('sleep-timer-stop');
  });
}