import { LAYOUTS, MODES, WHEEL_BEHAVIORS, recommendedSize, sizePresets } from './widget-state.mjs';
import { createMotionSelect } from './widget-select.mjs';
import { LYRIC_STYLE_PRESETS, normalizeLyricStyle, lyricStylePreset, lyricStyleValue, applyLyricStyle } from './widget-lyric-style.mjs';
import { drawLyricStylePreview } from './widget-lyric-canvas.mjs';

const ipcRenderer = window.foliaWidget || { on() {}, send() {} };
const $ = id => document.getElementById(id);
const card = $('widget-card');
const sheet = $('sheet');
const sizePicker = $('size-picker');
const offsetRange = $('offset-range');
let snapshot = null;

document.body.classList.add('settings-window');
// Preferences keep fixed surfaces, regardless of the selected player theme.
for (const layout of Object.keys(LAYOUTS)) card.classList.remove('layout-' + layout);
card.classList.remove(...MODES.map(mode => mode.cls));
document.title = '偏好设置 · Folia 增强版悬浮小组件';
sheet.inert = false;
sheet.setAttribute('aria-hidden', 'false');
sheet.setAttribute('aria-modal', 'false');

const send = (type, value) => ipcRenderer.send('widget-settings-action', { type, value });
const wheelSelect = createMotionSelect($('wheel-behavior'), {
  descriptions: { volume: '向上增大 5% · 向下减小 5%', seek: '向上快进 5 秒 · 向下后退 5 秒', track: '向上上一首 · 向下下一首' },
  icons: {
    volume: '<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
    seek: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    track: '<path d="m8 5 10 7-10 7V5ZM4 5v14M20 5v14"/>'
  }
});
const styleSelect = createMotionSelect($('lyric-style-preset'), {
  descriptions: { classic: '白色歌词 · 橙色高亮', light: '浅色背景 · 蓝色高亮', custom: '使用当前颜色与描边' }
});
const renderingSelect = createMotionSelect($('lyric-rendering'), {
  descriptions: { grayscale: '按屏幕像素绘制文字', system: '使用浏览器文字渲染' }
});
const strokeSelect = createMotionSelect($('lyric-stroke-width'));
const circuitDensitySelect = createMotionSelect($('circuit-density'), {
  descriptions: {
    auto: '随空间精简歌手与专辑',
    full: '小卡片也保留选中的信息',
    custom: '按你选中的内容排版'
  }
});
const selectors = [wheelSelect, styleSelect, renderingSelect, strokeSelect, circuitDensitySelect];
$('lyric-style-preset').querySelector('[value="custom"]').disabled = true;
styleSelect.sync();
const tabs = [...document.querySelectorAll('.settings-tab')];
const paneKey = 'folia_enhanced_widget_settings_pane';
const scrollPositions = new Map();
let activePane = '';
function selectPane(name, focus = false) {
  const selected = tabs.find(tab => tab.dataset.pane === name);
  if (!selected || name === activePane) return;
  selectors.forEach(selector => selector.close(false, true));
  scrollPositions.set(activePane, document.querySelector('.sheet-body').scrollTop);
  activePane = name;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  }
  document.querySelector('.sheet-body').scrollTop = scrollPositions.get(name) || 0;
  document.title = `${selected.textContent.trim()} · 小组件偏好设置`;
  try { localStorage.setItem(paneKey, name); } catch {}
  if (focus) selected.focus();
  if (snapshot && name === 'lyrics') drawLyricStylePreview($('lyric-preview-canvas'), normalizeLyricStyle(snapshot.lyricStyle));
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectPane(tab.dataset.pane));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    selectPane(tabs[target].dataset.pane, true);
  });
}
let savedPane = 'appearance';
try { savedPane = localStorage.getItem(paneKey) || savedPane; } catch {}
selectPane(tabs.some(tab => tab.dataset.pane === savedPane) ? savedPane : 'appearance');
const select = (picker, predicate) => picker.querySelectorAll('button').forEach(button => {
  const selected = Boolean(predicate(button));
  button.classList.toggle('active', selected);
  button.setAttribute('aria-pressed', String(selected));
});
function renderLyricStyle(value) {
  const style = normalizeLyricStyle(value);
  for (const input of document.querySelectorAll('[data-lyric-color]')) input.value = style[input.dataset.lyricColor];
  for (const input of document.querySelectorAll('[data-lyric-hex]')) {
    if (input !== document.activeElement) { input.value = style[input.dataset.lyricHex]; input.removeAttribute('aria-invalid'); }
  }
  $('lyric-style-preset').value = lyricStylePreset(style);
  $('lyric-rendering').value = style.rendering;
  $('lyric-stroke-width').value = String(style.strokeWidth);
  $('lyric-background-opacity').value = String(style.backgroundOpacity);
  $('lyric-opacity-value').textContent = style.backgroundOpacity + '%';
  $('lyric-background-opacity').setAttribute('aria-valuetext', style.backgroundOpacity + '%');
  select($('lyric-weight-picker'), button => Number(button.dataset.weight) === style.fontWeight);
  styleSelect.sync(); renderingSelect.sync(); strokeSelect.sync();
  $('lyric-render-help').textContent = style.rendering === 'grayscale'
    ? '按屏幕像素绘制，减少文字光晕与位移发虚。'
    : '使用浏览器默认渲染。独立的卡拉 OK 描边随整词完成切换。';
  applyLyricStyle($('lyric-preview-surface'), style);
  drawLyricStylePreview($('lyric-preview-canvas'), style);
}
const previewResize = new ResizeObserver(() => {
  if (snapshot) drawLyricStylePreview($('lyric-preview-canvas'), normalizeLyricStyle(snapshot.lyricStyle));
});
previewResize.observe($('lyric-preview-canvas'));

const circuitInformationDefaults = Object.freeze({ density: 'auto', showArtist: true, showAlbum: true,
  showDate: true, showDuration: false });
const circuitDefaults = Object.freeze({ smallFont: 0, largeFont: 0, metadataFont: 0, fontWeight: 600, animate: true });
const circuitFonts = [
  { name: 'smallFont', id: 'circuit-small-font', initial: 16 },
  { name: 'largeFont', id: 'circuit-large-font', initial: 72 },
  { name: 'metadataFont', id: 'circuit-metadata-font', initial: 24 }
];
const circuitManualFonts = new Map();
const circuitFontGestures = new Set();
const pendingCircuitStyle = new Map();
const pendingCircuitInformation = { top: new Map(), bottom: new Map() };
let pendingCircuitEdit = null;
let pendingCircuitPosition = null;
let pendingCircuitPositionRequest = null, circuitPositionSequence = 0;
const circuitPositionSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const circuitPosition = state => pendingCircuitPosition || (state?.circuitTitlePosition === 'bottom' ? 'bottom' : 'top');
function circuitInformation(state, position) {
  const style = state?.circuitStyle;
  const information = style?.information?.[position];
  // Older or partial snapshots may still carry the shared, flat information fields.
  return Object.fromEntries(Object.entries(circuitInformationDefaults).map(([name, fallback]) =>
    [name, information?.[name] ?? style?.[name] ?? fallback]));
}
function renderCircuitStyle(state) {
  const visible = state.layout === 'circuit';
  if (!visible) { pendingCircuitPosition = null; pendingCircuitPositionRequest = null; }
  $('circuit-style-section').hidden = !visible;
  if (!visible) circuitDensitySelect.close(false, true);
  const received = { ...circuitDefaults, ...state.circuitStyle };
  // Keep local slider input until the player acknowledges it; other snapshots may arrive first.
  for (const [name, value] of pendingCircuitStyle) {
    if (received[name] === value) pendingCircuitStyle.delete(name);
  }
  const style = { ...received, ...Object.fromEntries(pendingCircuitStyle) };
  // Acknowledgements for one design must never clear the other design's local input.
  const information = {};
  for (const position of ['top', 'bottom']) {
    const receivedInformation = circuitInformation(state, position);
    const pending = pendingCircuitInformation[position];
    for (const [name, value] of pending) {
      if (receivedInformation[name] === value) pending.delete(name);
    }
    information[position] = { ...receivedInformation, ...Object.fromEntries(pending) };
  }
  const position = circuitPosition(state);
  const currentInformation = information[position];
  const positionLabel = position === 'bottom' ? '大歌名' : '小歌名';
  $('circuit-information-heading').textContent = `${positionLabel}的信息`;
  $('circuit-fields-options').setAttribute('aria-label', `${positionLabel}的显示内容`);
  const density = ['auto', 'full', 'custom'].includes(currentInformation.density) ? currentInformation.density : 'auto';
  if ($('circuit-density').value !== density) $('circuit-density').value = density;
  circuitDensitySelect.sync();
  $('circuit-density-description').textContent = {
    auto: '空间变小时依次精简歌手与专辑，保留选中的发行时间。',
    full: '小卡片也保留选中的信息，文字会按可用空间调整。',
    custom: '显示选中的内容，自由调整字号与位置。'
  }[density];
  for (const input of document.querySelectorAll('[data-circuit-field]')) {
    const checked = Boolean(currentInformation[input.dataset.circuitField]);
    if (input.checked !== checked) input.checked = checked;
  }
  for (const { name, id, initial } of circuitFonts) {
    const input = $(id), automatic = $(id + '-auto'), output = $(id + '-value');
    const value = Number.isFinite(style[name]) && style[name] > 0 ? style[name] : 0;
    if (value) circuitManualFonts.set(name, value);
    const isAutomatic = value === 0;
    if (automatic.checked !== isAutomatic) automatic.checked = isAutomatic;
    input.disabled = isAutomatic;
    const next = String(value || circuitManualFonts.get(name) || initial);
    const engaged = circuitFontGestures.has(input) || document.activeElement === input;
    if (!engaged && input.value !== next) input.value = next;
    const description = isAutomatic ? '自适应' : `${engaged ? input.value : value} px`;
    if (output.textContent !== description) output.textContent = description;
    input.setAttribute('aria-valuetext', description);
  }
  select($('circuit-weight-picker'), button => Number(button.dataset.weight) === style.fontWeight);
  if ($('circuit-animate').checked !== Boolean(style.animate)) $('circuit-animate').checked = Boolean(style.animate);
  if (pendingCircuitEdit !== null && Boolean(state.circuitEditing) === pendingCircuitEdit) pendingCircuitEdit = null;
  const editing = pendingCircuitEdit ?? Boolean(state.circuitEditing);
  $('btn-circuit-edit').setAttribute('aria-pressed', String(editing));
  $('btn-circuit-edit').textContent = editing ? '完成编辑' : '编辑排版';
  $('circuit-edit-help').textContent = editing ? '拖动文字，靠近边缘自动对齐' : '在卡片中调整文字位置';
  select($('circuit-position-picker'), button => button.dataset.position === position);
}
function sendCircuitStyle(patch) {
  for (const [name, value] of Object.entries(patch)) pendingCircuitStyle.set(name, value);
  if (snapshot) renderCircuitStyle(snapshot);
  send('circuit-style', patch);
}
function sendCircuitInformation(patch) {
  const position = circuitPosition(snapshot);
  for (const [name, value] of Object.entries(patch)) pendingCircuitInformation[position].set(name, value);
  if (snapshot) renderCircuitStyle(snapshot);
  send('circuit-information', { position, patch });
}

function render(state) {
  if (!state || !LAYOUTS[state.layout] || !MODES[state.modeIndex]) return;
  if (pendingCircuitPositionRequest && state.circuitPositionRequestId === pendingCircuitPositionRequest && state.circuitTitlePosition === pendingCircuitPosition) {
    pendingCircuitPosition = null; pendingCircuitPositionRequest = null;
  }
  snapshot = state;
  renderCircuitStyle(state);
  renderLyricStyle(state.lyricStyle);
  select($('theme-picker'), button => Number(button.dataset.mode) === state.modeIndex);
  $('wheel-behavior').value = Object.prototype.hasOwnProperty.call(WHEEL_BEHAVIORS, state.wheelBehavior) ? state.wheelBehavior : 'seek';
  wheelSelect.sync();
  $('wheel-description').textContent = WHEEL_BEHAVIORS[$('wheel-behavior').value].description;
  select($('layout-picker'), button => button.dataset.layout === state.layout);
  for (const button of $('layout-picker').querySelectorAll('[data-layout]')) {
    const layout = button.dataset.layout;
    const saved = state.windowProfiles?.[layout];
    const [width, height] = saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)
      ? [saved.width, saved.height] : recommendedSize(layout, state.windowWorkArea);
    button.querySelector('.layout-option-size').textContent = `${width} × ${height} · ${saved ? '已保存' : '推荐'}`;
  }
  const presets = sizePresets(state.layout, state.windowWorkArea);
  const sizeKey = `${state.layout}:${presets.map(size => size.join('x')).join(':')}`;
  if (sizePicker.dataset.layout !== sizeKey) {
    sizePicker.dataset.layout = sizeKey;
    sizePicker.replaceChildren(...presets.map(([width, height], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seg';
      button.dataset.w = String(width);
      button.dataset.h = String(height);
      button.textContent = ['小巧', '推荐', '宽裕'][index];
      return button;
    }));
  }
  const normalBounds = state.windowBounds || state.windowProfiles?.[state.layout];
  const [normalWidth, normalHeight] = normalBounds
    ? [normalBounds.width, normalBounds.height] : presets[1];
  const sizeIndex = presets.findIndex(([width, height]) => width === normalWidth && height === normalHeight);
  select(sizePicker, button => Number(button.dataset.w) === normalWidth && Number(button.dataset.h) === normalHeight);
  $('size-current').textContent = `${['小巧', '推荐', '宽裕'][sizeIndex] || '自定义'} · ${normalWidth} × ${normalHeight}`;
  $('btn-size-reset').disabled = normalWidth === presets[1][0] && normalHeight === presets[1][1];
  const profile = state.profiles?.[state.layout];
  if (profile) {
    select($('font-picker'), button => button.dataset.size === profile.font);
    select($('align-picker'), button => button.dataset.align === profile.align);
    select($('lines-picker'), button => Number(button.dataset.lines) === profile.lines);
  }
  $('align-picker').closest('.row').hidden = state.layout !== 'lyrics';
  $('lines-picker').closest('.row').hidden = state.layout !== 'lyrics';
  $('font-picker').closest('.row').hidden = state.layout === 'circuit';
  $('set-badges').closest('.row').hidden = state.layout === 'circuit';
  for (const [id, name] of [
    ['set-lock', 'isLocked'], ['set-immersive', 'isImmersive'],
    ['set-auto-shrink', 'autoHideWhenPaused'],
    ['set-song-toast', 'songToast'], ['set-edge-dock', 'edgeDock'],
    ['set-karaoke', 'wordKaraoke'], ['set-lyric-translation', 'showLyricTranslation'], ['set-lyric-toolbar', 'showLyricToolbar'], ['set-badges', 'showBadges']
  ]) $(id).checked = Boolean(state[name]);
  offsetRange.value = String(state.lyricOffsetMs);
  const seconds = Math.abs(state.lyricOffsetMs / 1000).toFixed(2);
  const offsetText = state.lyricOffsetMs > 0 ? `提前 ${seconds} 秒` : state.lyricOffsetMs < 0 ? `延后 ${seconds} 秒` : '无偏移';
  $('offset-value').textContent = offsetText;
  offsetRange.setAttribute('aria-valuetext', offsetText);
  for (const id of ['offset-range', 'offset-earlier', 'offset-later', 'offset-reset']) $(id).disabled = !state.hasSong;
}

$('theme-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (button) send('theme', Number(button.dataset.mode));
});
$('layout-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-layout]');
  if (button) send('layout', button.dataset.layout);
});
$('wheel-behavior').addEventListener('change', event => {
  $('wheel-description').textContent = WHEEL_BEHAVIORS[event.target.value].description;
  send('wheel', event.target.value);
});
const sendLyricStyle = patch => send('lyric-style', patch);
$('lyric-style-preset').addEventListener('change', event => {
  const preset = LYRIC_STYLE_PRESETS[event.target.value];
  if (preset) sendLyricStyle({ ...preset.values, rendering: snapshot?.lyricStyle?.rendering || 'grayscale', fontWeight: snapshot?.lyricStyle?.fontWeight || 400 });
});
$('lyric-rendering').addEventListener('change', event => sendLyricStyle({ rendering: event.target.value }));
$('lyric-stroke-width').addEventListener('change', event => sendLyricStyle({ strokeWidth: Number(event.target.value) }));
$('lyric-background-opacity').addEventListener('input', event => sendLyricStyle({ backgroundOpacity: Number(event.target.value) }));
$('lyric-weight-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-weight]');
  if (button) sendLyricStyle({ fontWeight: Number(button.dataset.weight) });
});
for (const input of document.querySelectorAll('[data-lyric-color]')) {
  input.addEventListener('input', () => sendLyricStyle({ [input.dataset.lyricColor]: input.value }));
}
for (const input of document.querySelectorAll('[data-lyric-hex]')) {
  input.addEventListener('input', () => {
    const name = input.dataset.lyricHex, value = lyricStyleValue(name, input.value);
    input.setAttribute('aria-invalid', String(value === undefined));
    if (value !== undefined) sendLyricStyle({ [name]: value });
  });
  input.addEventListener('blur', () => {
    input.value = normalizeLyricStyle(snapshot?.lyricStyle)[input.dataset.lyricHex];
    input.removeAttribute('aria-invalid');
  });
}
$('circuit-density').addEventListener('change', event => sendCircuitInformation({ density: event.target.value }));
for (const input of document.querySelectorAll('[data-circuit-field]')) {
  input.addEventListener('change', () => sendCircuitInformation({ [input.dataset.circuitField]: input.checked }));
}
for (const { name, id, initial } of circuitFonts) {
  const input = $(id), automatic = $(id + '-auto');
  input.addEventListener('pointerdown', () => circuitFontGestures.add(input));
  input.addEventListener('blur', () => {
    circuitFontGestures.delete(input);
    if (snapshot) renderCircuitStyle(snapshot);
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    circuitManualFonts.set(name, value);
    sendCircuitStyle({ [name]: value });
  });
  automatic.addEventListener('change', () => {
    sendCircuitStyle({ [name]: automatic.checked ? 0 : circuitManualFonts.get(name) || Number(input.value) || initial });
  });
}
const releaseCircuitFontGestures = () => {
  circuitFontGestures.clear();
  if (snapshot) renderCircuitStyle(snapshot);
};
window.addEventListener('pointerup', releaseCircuitFontGestures);
window.addEventListener('pointercancel', releaseCircuitFontGestures);
window.addEventListener('blur', releaseCircuitFontGestures);
$('circuit-weight-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-weight]');
  if (button) sendCircuitStyle({ fontWeight: Number(button.dataset.weight) });
});
$('circuit-animate').addEventListener('change', event => sendCircuitStyle({ animate: event.target.checked }));
$('circuit-position-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-position]');
  if (!button) return;
  pendingCircuitPosition = button.dataset.position;
  pendingCircuitPositionRequest = `${circuitPositionSession}:${++circuitPositionSequence}`;
  if (snapshot) renderCircuitStyle(snapshot);
  send('circuit-position', { position: button.dataset.position, requestId: pendingCircuitPositionRequest });
});
$('btn-circuit-edit').addEventListener('click', () => {
  pendingCircuitEdit = $('btn-circuit-edit').getAttribute('aria-pressed') !== 'true';
  if (snapshot) renderCircuitStyle(snapshot);
  send('circuit-edit', pendingCircuitEdit ?? Boolean(snapshot?.circuitEditing));
});
$('btn-circuit-style-reset').addEventListener('click', () => {
  circuitManualFonts.clear();
  pendingCircuitStyle.clear();
  for (const [name, value] of Object.entries(circuitDefaults)) pendingCircuitStyle.set(name, value);
  for (const pending of Object.values(pendingCircuitInformation)) {
    pending.clear();
    for (const [name, value] of Object.entries(circuitInformationDefaults)) pending.set(name, value);
  }
  if (snapshot) renderCircuitStyle(snapshot);
  send('circuit-style-reset');
});
sizePicker.addEventListener('click', event => {
  const button = event.target.closest('[data-w]');
  if (button) send('size', { width: Number(button.dataset.w), height: Number(button.dataset.h) });
});
$('btn-size-reset').addEventListener('click', () => {
  if (!snapshot) return;
  const [width, height] = recommendedSize(snapshot.layout, snapshot.windowWorkArea);
  send('size', { width, height });
});
for (const [picker, name, attribute, transform] of [
  ['font-picker', 'font', 'size', String],
  ['align-picker', 'align', 'align', String],
  ['lines-picker', 'lines', 'lines', Number]
]) $(picker).addEventListener('click', event => {
  const button = event.target.closest(`[data-${attribute}]`);
  if (button) send('profile', { name, value: transform(button.dataset[attribute]) });
});
for (const [id, name] of [
  ['set-lock', 'isLocked'], ['set-immersive', 'isImmersive'],
  ['set-auto-shrink', 'autoHideWhenPaused'],
  ['set-song-toast', 'songToast'], ['set-edge-dock', 'edgeDock'],
  ['set-karaoke', 'wordKaraoke'], ['set-lyric-translation', 'showLyricTranslation'], ['set-lyric-toolbar', 'showLyricToolbar'], ['set-badges', 'showBadges']
]) $(id).addEventListener('change', event => send('option', { name, value: event.target.checked }));
offsetRange.addEventListener('input', event => send('offset', Number(event.target.value)));
$('offset-earlier').addEventListener('click', () => { if (snapshot) send('offset', snapshot.lyricOffsetMs + 100); });
$('offset-later').addEventListener('click', () => { if (snapshot) send('offset', snapshot.lyricOffsetMs - 100); });
$('offset-reset').addEventListener('click', () => send('offset', 0));
$('btn-sheet-done').addEventListener('click', () => ipcRenderer.send('widget-settings-close'));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.defaultPrevented) ipcRenderer.send('widget-settings-close');
});
window.addEventListener('pagehide', () => {
  selectors.forEach(selector => selector.dispose()); previewResize.disconnect();
  window.removeEventListener('pointerup', releaseCircuitFontGestures);
  window.removeEventListener('pointercancel', releaseCircuitFontGestures);
  window.removeEventListener('blur', releaseCircuitFontGestures);
}, { once: true });
ipcRenderer.on('widget-settings-state', (_event, state) => render(state));
ipcRenderer.send('widget-settings-ready');
