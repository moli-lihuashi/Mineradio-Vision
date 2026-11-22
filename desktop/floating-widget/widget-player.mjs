import { createWidgetState, formatTime, LAYOUTS } from './widget-state.mjs';
import { createSettingsController } from './widget-settings.mjs';
import { createLyricsRenderer } from './widget-lyrics.mjs';
import { createMorphSlot, createIconSlot, createCoverTint } from './widget-ui.mjs';
import { createAdaptiveLayout } from './widget-layout.mjs';
import { createMotionController } from './widget-motion.mjs';
import { createTooltipController } from './widget-tooltip.mjs';
import { createEdgeDockController } from './widget-edge-dock.mjs';
import { createContextMenu } from './widget-context-menu.mjs';
import { createCircuitCard } from './widget-circuit.mjs';
import { createSongAnnouncement } from './widget-announcement.mjs';
const nativeBridge = window.foliaWidget || null;
const ipcRenderer = nativeBridge || { on() {}, send() {} };
const state = createWidgetState();
let hoverTimer = null;
let renderedState = {};
let renderedCoverUrl = null;
const $ = (id) => document.getElementById(id);

const card = $('widget-card');
const cover = $('cover');
const coverImg = $('cover-img');
const coverFallback = $('cover-fallback');
const badges = $('badges');
const albumBadge = $('album-badge');
const dateBadge = $('date-badge');
const karaoke = $('karaoke');
const karaokeViewport = $('karaoke-viewport');
const karaokeLine = $('karaoke-line');
const karaokeNext = $('karaoke-next');
const karaokeTranslation = $('karaoke-translation');
const progress = $('progress');
const track = $('track');
const trackFill = $('track-fill');
const timeCurrent = $('time-current');
const timeDuration = $('time-duration');
const controls = $('controls');

const btnPlay = $('btn-play');
const iconPlay = $('icon-play');
const iconPause = $('icon-pause');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnLike = $('btn-like');
const btnShuffle = $('btn-shuffle');
const btnPin = $('btn-pin');
const btnPalette = $('btn-palette');
const btnClose = $('btn-close');
const btnLock = $('btn-lock');
const iconLock = $('icon-lock');
const iconUnlock = $('icon-unlock');
const btnZen = $('btn-zen');
const btnSettings = $('btn-settings');
const lyricToolbar = $('lyric-toolbar');
const lyricToolbarTitle = $('lyric-toolbar-title');
const btnLyricPrev = $('lyric-prev');
const btnLyricPlay = $('lyric-play');
const btnLyricNext = $('lyric-next');
const btnLyricLock = $('lyric-lock');
const btnLyricSettings = $('lyric-settings');
const btnLyricHide = $('lyric-hide');

const sheet = $('sheet');
const btnSheetDone = $('btn-sheet-done');
const setLock = $('set-lock');
const setImmersive = $('set-immersive');
const setAutoShrink = $('set-auto-shrink');
const setSongToast = $('set-song-toast');
const setEdgeDock = $('set-edge-dock');
const setKaraoke = $('set-karaoke');
const setLyricTranslation = $('set-lyric-translation');
const setLyricToolbar = $('set-lyric-toolbar');
const setBadges = $('set-badges');
const layoutPicker = $('layout-picker');
const sizePicker = $('size-picker');
const fontPicker = $('font-picker');
const themePicker = $('theme-picker');
const posterLine1 = $('poster-lyric-1');
const posterLine2 = $('poster-lyric-2');
const posterTime = $('poster-time');
const posterTranslation = $('poster-translation');
const edgePeekTab = $('edge-peek-tab');

const menu = $('menu');
const checkZen = $('check-zen');
const checkLock = $('check-lock');
const checkPin = $('check-pin');
const checkEdgeDock = $('check-edge-dock');
const menuLikeText = $('menu-like-text');
const menuPaletteName = $('menu-palette-name');
const menuLayoutText = $('menu-layout-text');

const alignPicker = $('align-picker');
const linesPicker = $('lines-picker');
const offsetRange = $('offset-range');
const offsetValue = $('offset-value');
const offsetEarlier = $('offset-earlier');
const offsetLater = $('offset-later');
const offsetReset = $('offset-reset');
const elements = { card, badges, cover, coverImg, coverFallback, karaokeViewport, karaokeLine, karaokeNext, karaokeTranslation,
  timeCurrent, timeDuration, trackFill, posterLine1, posterLine2, posterTime, posterTranslation,
  btnPin, btnLock, btnZen, checkPin, checkLock, checkZen, checkEdgeDock,
  setLock, setImmersive, setAutoShrink, setSongToast, setEdgeDock, setKaraoke, setLyricTranslation, setLyricToolbar, setBadges,
  layoutPicker, sizePicker, fontPicker, themePicker, menuPaletteName, menuLayoutText,
  alignPicker, linesPicker, offsetRange, offsetValue, offsetEarlier, offsetLater, offsetReset };
const motion = createMotionController(card);
const titleSlot = createMorphSlot($('song-title-wrap'), '未在播放', 'song-title-face', motion);
const artistSlot = createMorphSlot($('song-artist-wrap'), '等待播放音乐', 'song-artist-face', motion);
const albumSlot = createMorphSlot($('album-text-wrap'), '未知专辑', 'album-title-face', motion);
const dateSlot = createMorphSlot($('date-text-wrap'), '未知发行时间', 'badge-text-face', motion);
const playIcon = createIconSlot(iconPlay, iconPause, motion);
const posterPlayIcon = createIconSlot($('poster-icon-play'), $('poster-icon-pause'), motion);
const menuPlayIcon = createIconSlot($('menu-icon-play'), $('menu-icon-pause'), motion);
const lockIcon = createIconSlot(iconUnlock, iconLock, motion);
const extractTint = createCoverTint();
coverImg.addEventListener('error', () => {
  coverImg.style.display = 'none';
  coverFallback.style.display = 'grid';
});
coverImg.addEventListener('load', () => {
  if (!renderedCoverUrl) return;
  coverImg.style.display = 'block';
  coverFallback.style.display = 'none';
  motion.reveal(coverImg);
});
const lyrics = createLyricsRenderer({ elements, state, titleSlot, artistSlot, onMeasure: measureToolbar, onContentChange: () => adaptiveLayout.schedule() });
const adaptiveLayout = createAdaptiveLayout({ card, state, motion, onMeasure: lyrics.scheduleMeasure, getEngaged: isImmersionEngaged });
const tooltips = createTooltipController({ card, track, sheet, state, formatTime });
tooltips.attachMetaTooltip(albumBadge, () => renderedState.album || state.album || '未知专辑', () => (renderedState.year || state.year) ? `发行年份 · ${renderedState.year || state.year}` : '专辑详情');
tooltips.attachMetaTooltip(dateBadge, () => (renderedState.year || state.year) ? `${renderedState.year || state.year} 年发行` : '未知年份', () => (renderedState.album || state.album) ? `收录于《${renderedState.album || state.album}》` : '发行时间');
tooltips.attachMetaTooltip($('song-title-wrap'), () => renderedState.title || state.title || '未在播放', () => (renderedState.artist || state.artist) ? `${renderedState.artist || state.artist} · ${renderedState.album || state.album || ''}` : '曲目信息');
tooltips.attachMetaTooltip($('song-artist-wrap'), () => renderedState.artist || state.artist || '等待播放音乐', () => (renderedState.title || state.title) ? `演唱曲目: ${renderedState.title || state.title}` : '艺人信息');
tooltips.attachMetaTooltip($('eq'), () => state.isPlaying ? '正在播放' : '已暂停', () => '音频实时频谱状态');
const edgeDock = createEdgeDockController({ card, edgePeekTab, state, sheet, menu });
let nativeWindowProfiles = {};
let windowResizeTimer = null;
let ignoreHoverUntilLeave = false;
let initialWindowStateReceived = false;
let cancelWindowGesture = null;
let isWindowDragging = false;
let circuit = null;
let circuitPositionRequestId = null;
function beginWindowResizeTransition() {
  cancelWindowGesture?.();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  clearTimeout(windowResizeTimer);
  motion.stopLayout();
  card.classList.add('is-window-animating');
  windowResizeTimer = setTimeout(() => {
    windowResizeTimer = null;
    card.classList.remove('is-window-animating');
    adaptiveLayout.schedule();
  }, 280);
}
function isImmersionEngaged() {
  const pointerEngaged = !ignoreHoverUntilLeave &&
    (isPointerInsideCard || card.classList.contains('is-hovered') || card.matches(':hover'));
  const keyboardEngaged = document.hasFocus() && card.contains(document.activeElement);
  return pointerEngaged || keyboardEngaged || state.keyboardWake || state.circuitEditing ||
    card.classList.contains('has-overlay') || state.isScrubbing || state.isAnnouncing ||
    card.classList.contains('is-resizing') || isWindowDragging;
}
function reconcileImmersive() { adaptiveLayout.schedule(); }
const announcement = createSongAnnouncement({ state, onChange() {
  edgeDock.refresh();
  reconcileImmersive();
} });

const settings = createSettingsController({
  state, elements, sendWindowCommand,
  onBeforeChange() { cancelWindowGesture?.(); motion.prepare(); },
  onChange(reason) {
    if (['theme', 'layout', 'circuitTitlePosition', 'circuitStyle', 'circuitEditing'].includes(reason)) {
      circuit?.sync();
      tooltips.hideAll();
    }
    if (reason === 'isLocked' || reason === 'showLyricToolbar') {
      state.isLocked ? lockIcon.showB() : lockIcon.showA();
      syncLyricToolbar();
    }
    if (reason === 'isImmersive') {
      clearTimeout(hoverTimer);
      hoverTimer = null;
      if (state.isImmersive) {
        if (card.contains(document.activeElement)) document.activeElement.blur();
        ignoreHoverUntilLeave = isPointerInsideCard || card.matches(':hover');
        isPointerInsideCard = false;
        card.classList.remove('is-hovered');
      } else {
        ignoreHoverUntilLeave = false;
        isPointerInsideCard = card.matches(':hover');
        card.classList.toggle('is-hovered', card.matches(':hover'));
      }
      reconcileImmersive();
    }
    if (reason === 'layout') {
      if (initialWindowStateReceived) beginWindowResizeTransition();
      lyrics.invalidate('layout');
      adaptiveLayout.schedule();
    }
    if (reason === 'lines' || reason === 'font' || reason === 'showBadges') {
      lyrics.invalidate(reason);
      adaptiveLayout.schedule();
      reconcileImmersive();
    }
    if (reason === 'circuitEditing' || reason === 'layout') sendWindowCommand('interaction', { kind: 'editor', active: state.circuitEditing });
    if (reason === 'size') beginWindowResizeTransition();
    if (reason === 'edgeDock') {
      edgeDock.refresh();
    }
    lyrics.invalidate(reason);
    adaptiveLayout.schedule();
    publishSettingsSnapshot();
  }
});
circuit = createCircuitCard({
  card, state,
  onPositionChange: value => settings.setCircuitTitlePosition(value),
  onStyleChange: value => settings.setCircuitStyle(value),
  onEditingChange: value => settings.setCircuitEditing(value),
  onGestureStart(cancel) {
    cancelWindowGesture?.();
    cancelWindowGesture = cancel;
    return () => { if (cancelWindowGesture === cancel) cancelWindowGesture = null; };
  }
});
circuit.sync();
state.isLocked ? lockIcon.showB() : lockIcon.showA();
syncLyricToolbar();
function sendWindowCommand(cmd, value) { ipcRenderer.send('widget-window-cmd', { cmd, value }); }
function publishSettingsSnapshot() {
  ipcRenderer.send('widget-settings-state', {
    layout: state.layout, profiles: state.profiles, modeIndex: state.modeIndex,
    isPinned: state.isPinned, isLocked: state.isLocked, isImmersive: state.isImmersive, autoHideWhenPaused: state.autoHideWhenPaused,
    songToast: state.songToast, edgeDock: state.edgeDock, wordKaraoke: state.wordKaraoke,
    showLyricToolbar: state.showLyricToolbar, showLyricTranslation: state.showLyricTranslation,
    showBadges: state.showBadges, lyricOffsetMs: state.lyricOffsetMs,
    wheelBehavior: state.wheelBehavior,
    lyricStyle: state.lyricStyle,
    circuitStyle: state.circuitStyle, circuitEditing: state.circuitEditing, circuitTitlePosition: state.circuitTitlePosition,
    circuitPositionRequestId,
    hasSong: Boolean(state.songPersistentKey), windowBounds: state.windowBounds,
    windowWorkArea: state.windowWorkArea, windowProfiles: nativeWindowProfiles
  });
}
ipcRenderer.on('widget-settings-request-state', publishSettingsSnapshot);
ipcRenderer.on('widget-settings-action', (_event, action) => {
  if (!action || typeof action !== 'object') return;
  const { type, value } = action;
  if (type === 'layout') settings.applyLayout(value);
  else if (type === 'theme') settings.selectPalette(value);
  else if (type === 'size' && value && typeof value === 'object') settings.setSizePreset(value.width, value.height);
  else if (type === 'profile' && value && typeof value === 'object') settings.setProfile(value.name, value.value);
  else if (type === 'wheel') settings.setWheelBehavior(value);
  else if (type === 'lyric-style') settings.setLyricStyle(value);
  else if (type === 'circuit-style') settings.setCircuitStyle(value);
  else if (type === 'circuit-information' && value && typeof value === 'object') settings.setCircuitInformation(value.position, value.patch);
  else if (type === 'circuit-edit') settings.setCircuitEditing(value);
  else if (type === 'circuit-style-reset') settings.resetCircuitStyle();
  else if (type === 'circuit-position') {
    const position = typeof value === 'string' ? value : value?.position;
    if (!['top', 'bottom'].includes(position)) return;
    circuitPositionRequestId = typeof value?.requestId === 'string' && value.requestId.length <= 96 ? value.requestId : null;
    settings.setCircuitTitlePosition(position);
    publishSettingsSnapshot();
  }
  else if (type === 'option' && value && typeof value === 'object' &&
    ['isPinned', 'isLocked', 'isImmersive', 'autoHideWhenPaused', 'songToast', 'edgeDock', 'wordKaraoke', 'showLyricTranslation', 'showLyricToolbar', 'showBadges'].includes(value.name) && typeof value.value === 'boolean') {
    settings.setOption(value.name, value.value);
  } else if (type === 'offset') settings.setOffset(value);
  publishSettingsSnapshot();
});
function measureToolbar() {
  const value = '0px';
  if (card.style.getPropertyValue('--toolbar-w') !== value) card.style.setProperty('--toolbar-w', value);
}

function render(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (typeof patch.wheelFeedback === 'string') showWheelFeedback(patch.wheelFeedback);
  const songChanged = Object.prototype.hasOwnProperty.call(patch, 'songKey') && patch.songKey !== renderedState.songKey;
  if (songChanged) {
    renderedState = { ...renderedState, lyrics: null, currentLyric: '', songPersistentKey: '' };
  }
  renderedState = { ...renderedState, ...patch };
  const data = renderedState;
  circuit.update(data);
  const hasLyrics = Boolean(data.lyrics?.lines?.some(line => String(line.fullText || '').trim()) || String(data.currentLyric || '').trim());
  if (hasLyrics !== state.hasLyrics) {
    state.hasLyrics = hasLyrics;
    adaptiveLayout.schedule();
  }
  const lyricSongLabel = data.title ? [data.title, data.artist].filter(Boolean).join(' - ') : 'Folia Music';
  if (lyricToolbarTitle.textContent !== lyricSongLabel) lyricToolbarTitle.textContent = lyricSongLabel;
  lyricToolbarTitle.title = lyricSongLabel;
  titleSlot.update(data.title || '未在播放');
  artistSlot.update(data.artist || '等待播放音乐');
  albumSlot.update(data.album || '未知专辑');
  dateSlot.update(data.publishTime || '未知发行时间');
  albumBadge.title = '所在专辑：' + (data.album || '未知专辑');
  dateBadge.title = '发行时间：' + (data.publishTime || '未知发行时间');
  $('song-artist-wrap').title = '歌手：' + (data.artist || '等待播放音乐');
  $('song-title-wrap').title = '正在播放：' + (data.title || '未在播放');
  cover.title = (data.album || '未知专辑') + ' · ' + (data.publishTime || '未知发行时间') + '\n' + (data.artist || '等待播放音乐') + ' · ' + (data.title || '未在播放');
  const coverUrl = data.coverUrl || '';
  if (coverUrl !== renderedCoverUrl) {
    renderedCoverUrl = coverUrl;
    if (coverUrl) coverImg.src = coverUrl;
    coverImg.style.display = coverUrl ? 'block' : 'none';
    coverFallback.style.display = coverUrl ? 'none' : 'grid';
    extractTint(coverUrl);
  }
  const nextPlaying = data.state === 'playing';
  if (nextPlaying !== state.isPlaying) {
    state.isPlaying = nextPlaying;
    card.classList.toggle('is-playing', nextPlaying);
    nextPlaying ? playIcon.showB() : playIcon.showA();
    nextPlaying ? posterPlayIcon.showB() : posterPlayIcon.showA();
    if (menuPlayIcon) nextPlaying ? menuPlayIcon.showB() : menuPlayIcon.showA();
  }
  const playLabel = nextPlaying ? '暂停' : '播放';
  btnPlay.setAttribute('aria-label', playLabel);
  btnLyricPlay.setAttribute('aria-label', playLabel);
  btnLyricPlay.title = playLabel;
  const btnPosterAction = $('btn-poster-action');
  if (btnPosterAction) {
    btnPosterAction.setAttribute('aria-label', playLabel);
    btnPosterAction.title = playLabel;
  }
  const menuPlay = $('menu-play');
  if (menuPlay) {
    menuPlay.setAttribute('aria-label', playLabel);
    menuPlay.title = playLabel;
    menuPlay.dataset.label = playLabel;
  }
  btnLike.classList.toggle('liked', Boolean(data.liked));
  const menuLike = $('menu-like');
  if (menuLike) {
    menuLike.classList.toggle('liked', Boolean(data.liked));
    const likeLabel = data.liked ? '取消喜爱' : '添加到喜爱';
    menuLike.title = likeLabel;
    menuLike.setAttribute('aria-label', likeLabel);
    menuLike.disabled = data.canLike === false;
  }
  if (menuLikeText) menuLikeText.textContent = data.liked ? '取消喜爱' : '添加到喜爱';
  btnLike.disabled = data.canLike === false;
  if (!state.isScrubbing) {
    state.currentDuration = Number.isFinite(data.duration) ? Math.max(0, data.duration) : 0;
    state.currentPosition = Number.isFinite(data.position) ? Math.max(0, data.position) : 0;
    timeCurrent.textContent = formatTime(state.currentPosition);
    timeDuration.textContent = state.layout === 'capsule' ? '-' + formatTime(Math.max(0, state.currentDuration - state.currentPosition)) : formatTime(state.currentDuration);
    trackFill.style.width = state.currentDuration > 0 ? Math.min(100, state.currentPosition / state.currentDuration * 100) + '%' : '0%';
  }
  settings.updateSong(data.songPersistentKey);
  lyrics.update(patch);
}

function sendAction(action, value) {
  ipcRenderer.send('widget-action', { action, value });
}

function syncLyricToolbar() {
  if (!state.showLyricToolbar && lyricToolbar.contains(document.activeElement)) document.activeElement.blur();
  lyricToolbar.hidden = !state.showLyricToolbar;
  lyricToolbar.inert = !state.showLyricToolbar || card.classList.contains('is-quiet');
  btnLyricLock.classList.toggle('active', state.isLocked);
  btnLyricLock.setAttribute('aria-pressed', String(state.isLocked));
  btnLyricLock.title = state.isLocked ? '解除位置锁定' : '锁定位置';
  btnLyricLock.setAttribute('aria-label', btnLyricLock.title);
}

// ==========================================================================
// 播放控制
// ==========================================================================
btnPlay.addEventListener('click', () => sendAction('toggle'));
btnPrev.addEventListener('click', () => sendAction('previous'));
btnNext.addEventListener('click', () => sendAction('next'));
btnLyricPrev.addEventListener('click', () => sendAction('previous'));
btnLyricPlay.addEventListener('click', () => sendAction('toggle'));
btnLyricNext.addEventListener('click', () => sendAction('next'));
btnLyricLock.addEventListener('click', () => settings.setOption('isLocked', !state.isLocked));
btnLyricSettings.addEventListener('click', openSheet);
btnLyricHide.addEventListener('click', () => sendWindowCommand('close'));
btnLike.addEventListener('click', () => sendAction('toggleLike'));
btnShuffle.addEventListener('click', () => sendAction('shuffle'));

// 进度拖拽
function scrubTo(e) {
  if (state.currentDuration <= 0) return null;
  const rect = track.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const ratio = rect.width > 0 ? x / rect.width : 0;
  const time = ratio * state.currentDuration;
  trackFill.style.width = (ratio * 100) + '%';
  timeCurrent.textContent = formatTime(time);
  if (state.layout === 'capsule') {
    timeDuration.textContent = '-' + formatTime(Math.max(0, state.currentDuration - time));
  }
  return time;
}

progress.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (state.currentDuration <= 0) return;
  state.isScrubbing = true;
  adaptiveLayout.schedule();
  progress.classList.add('is-scrubbing');
  scrubTo(e);

  const onMove = (ev) => {
    if (state.isScrubbing) scrubTo(ev);
  };
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('blur', onCancel);
  };
  const onCancel = () => {
    state.isScrubbing = false;
    progress.classList.remove('is-scrubbing');
    adaptiveLayout.schedule();
    cleanup();
  };
  const onUp = (ev) => {
    if (state.isScrubbing) {
      state.isScrubbing = false;
      adaptiveLayout.schedule();
      progress.classList.remove('is-scrubbing');
      const time = scrubTo(ev);
      if (typeof time === 'number') {
        sendAction('seek', time);
        lyrics.seek(time);
      }
    }
    cleanup();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('blur', onCancel);
});

let wheelFeedbackTimer = null;
function showWheelFeedback(text) {
  const feedback = $('wheel-feedback');
  feedback.textContent = text;
  feedback.classList.add('visible');
  clearTimeout(wheelFeedbackTimer);
  wheelFeedbackTimer = setTimeout(() => feedback.classList.remove('visible'), 1100);
}

// Accumulate small touchpad deltas and limit repeated actions from one burst.
let wheelAmount = 0;
let lastWheelAt = -Infinity;
let lastWheelActionAt = -Infinity;
let lastWheelBehavior = '';
card.addEventListener('wheel', (e) => {
  if (sheet.classList.contains('active')) return;
  if (menu.style.display === 'flex' || state.isScrubbing || cancelWindowGesture) return;
  if (e.target.closest('#sheet, #menu, input, select, textarea')) return;
  if (e.ctrlKey || e.metaKey || e.altKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = performance.now();
  const amount = Math.max(-120, Math.min(120, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1)));
  if (now - lastWheelAt > 180 || state.wheelBehavior !== lastWheelBehavior || Math.sign(wheelAmount) !== Math.sign(amount)) wheelAmount = 0;
  if (state.wheelBehavior !== lastWheelBehavior) lastWheelActionAt = -Infinity;
  lastWheelAt = now;
  lastWheelBehavior = state.wheelBehavior;
  wheelAmount += amount;
  if (Math.abs(wheelAmount) < 40) return;
  wheelAmount = 0;
  if (now - lastWheelActionAt < (state.wheelBehavior === 'track' ? 700 : 120)) return;
  lastWheelActionAt = now;
  const direction = amount < 0 ? 1 : -1;
  if (state.wheelBehavior === 'volume') {
    sendAction('volumeDelta', direction * .05);
    return;
  }
  if (state.wheelBehavior === 'track') {
    if (!state.songPersistentKey) return;
    sendAction(direction > 0 ? 'previous' : 'next');
    showWheelFeedback(direction > 0 ? '上一首' : '下一首');
    return;
  }
  if (state.currentDuration <= 0) return;
  const target = Math.max(0, Math.min(state.currentDuration, state.currentPosition + direction * 5));
  state.currentPosition = target;
  sendAction('seek', target);
  lyrics.seek(target);
  timeCurrent.textContent = formatTime(target);
  trackFill.style.width = (target / state.currentDuration) * 100 + '%';
  lyrics.requestFrame();
  showWheelFeedback(`进度 ${formatTime(target)}`);
}, { passive: false });

sheet.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
menu.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });

// ==========================================================================
// 窗口与外观
// ==========================================================================
btnPin.addEventListener('click', () => settings.setOption('isPinned', !state.isPinned));
btnLock.addEventListener('click', () => settings.setOption('isLocked', !state.isLocked));
btnZen.addEventListener('click', () => settings.setOption('isImmersive', !state.isImmersive));
btnPalette.addEventListener('click', () => settings.cyclePalette());
btnClose.addEventListener('click', () => sendWindowCommand('close'));
let coverClickTimer = null;
cover.addEventListener('click', () => {
  if (state.layout === 'lyrics') return;
  if (coverClickTimer) {
    clearTimeout(coverClickTimer);
    coverClickTimer = null;
  } else {
    coverClickTimer = setTimeout(() => { coverClickTimer = null; sendAction('toggle'); }, 350);
  }
});
cover.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  clearTimeout(coverClickTimer);
  coverClickTimer = null;
  openSheet();
});
cover.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.repeat) {
    event.preventDefault();
    sendAction('toggle');
  }
});

// 沉浸模式下的悬停展开与防抖
let isPointerInsideCard = false;

function handleMouseEnter() {
  if (ignoreHoverUntilLeave) return;
  isPointerInsideCard = true;
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (!card.classList.contains('is-hovered')) {
    card.classList.add('is-hovered');
    adaptiveLayout.schedule();
  }
  reconcileImmersive();
}

function handleMouseLeave(e) {
  if (e && e.relatedTarget && card.contains(e.relatedTarget)) {
    return;
  }
  ignoreHoverUntilLeave = false;
  isPointerInsideCard = false;
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (isPointerInsideCard || menu.style.display === 'flex') return;
    if (card.matches(':hover')) {
      isPointerInsideCard = true;
      return;
    }
    card.classList.remove('is-hovered');
    adaptiveLayout.schedule();
    reconcileImmersive();
  }, 450);
}

card.addEventListener('mouseenter', handleMouseEnter);
card.addEventListener('mousemove', () => {
  if (ignoreHoverUntilLeave) return;
  if (!isPointerInsideCard || !card.classList.contains('is-hovered')) {
    handleMouseEnter();
  }
});
card.addEventListener('mouseleave', handleMouseLeave);
window.addEventListener('mouseleave', handleMouseLeave);
card.addEventListener('focusin', () => { adaptiveLayout.schedule(); reconcileImmersive(); });
card.addEventListener('focusout', () => {
  requestAnimationFrame(() => {
    if (!card.contains(document.activeElement)) state.keyboardWake = false;
    reconcileImmersive();
  });
});
window.addEventListener('focus', () => { adaptiveLayout.schedule(); reconcileImmersive(); });
window.addEventListener('blur', () => { state.keyboardWake = false; closeMenu(); reconcileImmersive(); });
if (card.matches(':hover')) handleMouseEnter();

// ==========================================================================
// 偏好设置面板
// ==========================================================================
function openSheet() { cancelWindowGesture?.(); closeMenu(); sendWindowCommand('open-settings'); }
btnSettings.addEventListener('click', openSheet);

// ==========================================================================
// 右键菜单
// ==========================================================================
let preMenuBounds = null;
let contextMenu = null;
function prepareMenuWindow() {
  cancelWindowGesture?.();
  // A short lyrics window needs temporary room for the menu; its profile is untouched.
  if (window.innerHeight < 340 && !preMenuBounds) {
    preMenuBounds = {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight
    };
    const workArea = state.windowWorkArea || {
      y: window.screen.availTop || 0,
      height: window.screen.availHeight || 1080
    };
    const targetH = 350;
    const bottom = workArea.y + workArea.height;
    const targetY = Math.max(workArea.y, Math.min(preMenuBounds.y, bottom - targetH - 20));

    sendWindowCommand('set-bounds', {
      x: preMenuBounds.x,
      y: targetY,
      width: Math.max(preMenuBounds.width, 240),
      height: targetH,
      animate: false,
      save: false
    });
  }
}

function afterMenuClose({ selectedId }) {
  updateOverlayState();
  const isHover = !ignoreHoverUntilLeave && (isPointerInsideCard || card.matches(':hover'));
  card.classList.toggle('is-hovered', isHover);
  if (preMenuBounds) {
    const target = { ...preMenuBounds };
    preMenuBounds = null;
    sendWindowCommand('set-bounds', {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
      animate: false,
      save: false
    });
  }
  if (selectedId !== 'menu-zen' && selectedId !== 'menu-layout' && selectedId !== 'menu-settings') reconcileImmersive();
}
function openMenu(x, y, modality = 'pointer') { cancelWindowGesture?.(); contextMenu?.open(x, y, modality); }
function closeMenu() { contextMenu?.close(); }

function updateOverlayState() {
  const active = menu.style.display === 'flex';
  if (card.classList.contains('has-overlay') === active) return;
  card.classList.toggle('has-overlay', active);
  sendWindowCommand('interaction', { kind: 'menu', active });
  adaptiveLayout.schedule();
}

ipcRenderer.on('show-context-menu', (_event, coords) => {
  const x = (coords && typeof coords.x === 'number') ? coords.x : Math.round(window.innerWidth / 2);
  const y = (coords && typeof coords.y === 'number') ? coords.y : Math.round(window.innerHeight / 2);
  openMenu(x, y);
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (sheet.classList.contains('active') || menu.contains(e.target)) return;
  openMenu(e.clientX, e.clientY);
});

const menuActions = {
  'menu-play': () => sendAction('toggle'),
  'menu-prev': () => sendAction('previous'),
  'menu-next': () => sendAction('next'),
  'menu-like': () => sendAction('toggleLike'),
  'menu-zen': () => settings.setOption('isImmersive', !state.isImmersive),
  'menu-edge-dock': () => settings.setOption('edgeDock', !state.edgeDock),
  'menu-lock': () => settings.setOption('isLocked', !state.isLocked),
  'menu-pin': () => settings.setOption('isPinned', !state.isPinned),
  'menu-palette': () => settings.cyclePalette(),
  'menu-layout': () => settings.applyLayout(settings.nextLayout()),
  'menu-settings': () => openSheet(),
  'menu-close': () => ipcRenderer.send('widget-window-cmd', { cmd: 'close' })
};

contextMenu = createContextMenu({
  menu, trigger: card,
  canOpen: () => !sheet.classList.contains('active'),
  onBeforeOpen: prepareMenuWindow,
  onOpen: updateOverlayState,
  onClose: afterMenuClose,
  onSelect: id => menuActions[id]?.()
});

const btnPosterAction = $('btn-poster-action');
if (btnPosterAction) {
  btnPosterAction.addEventListener('click', () => sendAction('toggle'));
}

// ==========================================================================
// 键盘快捷键
// ==========================================================================
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return;
  if (e.key === ' ' && e.target instanceof Element && e.target.closest('button, input, select, textarea')) return;
  const key = e.key.toLowerCase();
  if (key === 'l') {
    settings.applyLayout(settings.nextLayout());
  } else if (key === 'i') {
    settings.setOption('isImmersive', !state.isImmersive);
  } else if (key === 't') {
    settings.cyclePalette();
  } else if (key === 's' || key === ',') {
    openSheet();
  } else if (e.key === 'F5' || (e.ctrlKey && key === 'r')) {
    location.reload();
  } else if (e.key === ' ') {
    e.preventDefault();
    sendAction('toggle');
  } else if (e.key === 'Escape') {
    if (state.circuitEditing && !contextMenu?.isOpen()) { cancelWindowGesture?.(); settings.setCircuitEditing(false); }
    closeMenu();
  }
});

// ==========================================================================
// 歌词布局平滑拖拽窗口 (因 no-drag 释放原生 contextmenu，由 JS 处理左键位移)
// ==========================================================================
card.addEventListener('pointerdown', (e) => {
  if (state.layout !== 'lyrics' || state.isLocked) return;
  if (e.button !== 0 || !e.isPrimary) return;
  if (e.target.closest('button, input, select, textarea, .grip, .sheet, .menu, .edge-peek-tab')) return;
  cancelWindowGesture?.();
  e.preventDefault();
  isWindowDragging = true;
  const pointerId = e.pointerId;
  try { card.setPointerCapture(pointerId); } catch {}

  const startMouseX = e.screenX;
  const startMouseY = e.screenY;
  const startWinX = Number.isFinite(state.windowBounds?.x) ? state.windowBounds.x : window.screenX;
  const startWinY = Number.isFinite(state.windowBounds?.y) ? state.windowBounds.y : window.screenY;
  let dragFrame = 0;
  let pendingPos = null;
  let lastPos = null;
  let isDragging = false;
  let finished = false;

  const flushMove = (save = false) => {
    dragFrame = 0;
    const position = pendingPos || (save ? lastPos : null);
    if (!position) return;
    // Renderer viewport sizes can differ from native bounds at non-default zoom.
    sendWindowCommand('move', { ...position, save });
    pendingPos = null;
  };

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    if (ev.pointerType === 'mouse' && ev.buttons === 0) { onUp(); return; }
    const deltaX = ev.screenX - startMouseX;
    const deltaY = ev.screenY - startMouseY;
    if (!isDragging && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      isDragging = true;
      card.classList.add('is-dragging');
    }
    if (isDragging) {
      pendingPos = {
        x: Math.round(startWinX + deltaX),
        y: Math.round(startWinY + deltaY)
      };
      lastPos = pendingPos;
      if (!dragFrame) dragFrame = requestAnimationFrame(() => flushMove(false));
    }
  };

  const onUp = () => {
    if (finished) return;
    finished = true;
    if (isDragging) {
      card.classList.remove('is-dragging');
      if (dragFrame) cancelAnimationFrame(dragFrame);
      flushMove(true);
      // A move can interrupt a native expand/collapse animation midway.
    }
    if (cancelWindowGesture === onUp) {
      cancelWindowGesture = null;
      isWindowDragging = false;
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onUp);
    card.removeEventListener('lostpointercapture', onUp);
    if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);
    requestAnimationFrame(() => reconcileImmersive());
  };

  cancelWindowGesture = onUp;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', onUp);
  card.addEventListener('lostpointercapture', onUp);
});

// ==========================================================================
// 边缘拉伸缩放
// ==========================================================================
function setupGrip(el, resizeX, resizeY) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    cancelWindowGesture?.();
    const pointerId = e.pointerId;
    try { el.setPointerCapture(pointerId); } catch {}
    card.classList.add('is-resizing');
    const startX = e.screenX;
    const startY = e.screenY;
    const startW = state.windowBounds?.width ?? window.innerWidth;
    const startH = state.windowBounds?.height ?? window.innerHeight;
    const [minimumWidth, minimumHeight] = LAYOUTS[state.layout].minimum;
    let resizeFrame = 0;
    let pendingSize = null;
    let finished = false;
    const flushResize = () => {
      resizeFrame = 0;
      if (!pendingSize) return;
      ipcRenderer.send('widget-window-cmd', { cmd: 'resize', value: pendingSize });
      pendingSize = null;
    };

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.pointerType === 'mouse' && ev.buttons === 0) { onUp(); return; }
      let w = resizeX ? Math.max(minimumWidth, Math.min(800, startW + ev.screenX - startX)) : startW;
      let h = resizeY ? Math.max(minimumHeight, Math.min(600, startH + ev.screenY - startY)) : startH;
      if (state.layout === 'circuit') {
        const horizontal = ev.screenX - startX;
        const vertical = (ev.screenY - startY) * 193 / 308;
        const delta = resizeX && resizeY ? (Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical)
          : resizeX ? horizontal : vertical;
        const maximumWidth = Math.floor(600 * 193 / 308);
        w = Math.max(minimumWidth, Math.min(maximumWidth, Math.round(startW + delta)));
        h = Math.max(minimumHeight, Math.round(w * 308 / 193));
      }
      pendingSize = { width: w, height: h };
      if (!resizeFrame) resizeFrame = requestAnimationFrame(flushResize);
    };
    const onUp = () => {
      if (finished) return;
      finished = true;
      card.classList.remove('is-resizing');
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      flushResize();
      if (cancelWindowGesture === onUp) cancelWindowGesture = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      requestAnimationFrame(() => reconcileImmersive());
    };
    cancelWindowGesture = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    el.addEventListener('lostpointercapture', onUp);
  });
}

setupGrip($('grip-r'), true, false);
setupGrip($('grip-b'), false, true);
setupGrip($('grip-br'), true, true);

window.addEventListener('resize', adaptiveLayout.schedule);

// 主进程返回按布局保存的窗口状态；旧版窗口位置会迁移给当前布局。
ipcRenderer.on('widget-window-state', (event, snapshot) => {
  if (snapshot?.profiles) {
    nativeWindowProfiles = snapshot.profiles;
  }
  settings.updateWindow(snapshot);
  publishSettingsSnapshot();
  edgeDock.updateBounds(snapshot?.bounds, snapshot?.workArea);
  adaptiveLayout.schedule();
  lyrics.scheduleMeasure();
  if (!initialWindowStateReceived) {
    initialWindowStateReceived = true;
    const profile = snapshot?.profiles?.[state.layout];
    if (state.restoreExpandedBounds && Number.isFinite(profile?.width) && Number.isFinite(profile?.height)) {
      sendWindowCommand('resize', { width: profile.width, height: profile.height, animate: false, save: true });
    }
    state.restoreExpandedBounds = false;
    requestAnimationFrame(() => reconcileImmersive());
  }
});
ipcRenderer.on('widget-resized', (event, bounds) => {
  if (bounds) {
    state.windowBounds = bounds;
    publishSettingsSnapshot();
  }
  edgeDock.updateBounds(bounds);
  adaptiveLayout.schedule();
});
ipcRenderer.on('widget-update', (event, data) => render(data));
ipcRenderer.on('widget-announcement', (_event, active) => announcement.setActive(active));
ipcRenderer.on('widget-visibility', (_event, phase) => {
  const visible = phase === 'visible';
  document.body.classList.toggle('widget-auto-hiding', !visible);
  if (!visible) {
    cancelWindowGesture?.();
    closeMenu();
    clearTimeout(hoverTimer);
    state.keyboardWake = false;
    isPointerInsideCard = false;
    card.classList.remove('is-hovered');
    tooltips.hideAll();
  }
  reconcileImmersive();
});
// Keep the current gesture/menu usable until release, even if playback pauses.
let pointerInteraction = false;
const releaseInteraction = () => {
  if (!pointerInteraction) return;
  pointerInteraction = false;
  sendWindowCommand('interaction', { kind: 'pointer', active: false });
};
card.addEventListener('pointerdown', () => {
  pointerInteraction = true;
  sendWindowCommand('interaction', { kind: 'pointer', active: true });
}, true);
window.addEventListener('pointerup', releaseInteraction);
window.addEventListener('pointercancel', releaseInteraction);
document.addEventListener('lostpointercapture', releaseInteraction, true);
window.addEventListener('pointermove', event => { if (event.buttons === 0) releaseInteraction(); });
window.addEventListener('blur', releaseInteraction);
window.addEventListener('keydown', event => {
  if (event.key === 'Tab' && !card.classList.contains('has-overlay')) {
    state.keyboardWake = true;
    adaptiveLayout.refresh();
  }
}, true);
sendWindowCommand('renderer-ready');
sendWindowCommand('auto-hide', state.autoHideWhenPaused);
sendWindowCommand('song-announcement', state.songToast);
sendWindowCommand('pin', state.isPinned);
ipcRenderer.send('widget-request-window-state');
ipcRenderer.send('widget-request-snapshot');
if (!nativeBridge) settings.updateWindow({ layout: state.layout, bounds: { width: innerWidth, height: innerHeight } });
window.addEventListener('pagehide', () => {
  for (const kind of ['pointer', 'menu', 'editor']) sendWindowCommand('interaction', { kind, active: false });
  cancelWindowGesture?.();
  clearTimeout(wheelFeedbackTimer);
  clearTimeout(windowResizeTimer);
  clearTimeout(hoverTimer);
  clearTimeout(coverClickTimer);
  announcement.dispose();
  lyrics.dispose();
  circuit.dispose();
  settings.dispose();
  adaptiveLayout.dispose();
  motion.dispose();
  edgeDock.dispose();
  contextMenu?.dispose();
  tooltips.dispose();
}, { once: true });

