import { SETTINGS_KEY, MODES, CIRCUIT_MODE_INDEX, LAYOUTS, WHEEL_BEHAVIORS, FONT_SIZES, ALIGNMENTS, isLayout, clampOffset, serializeSettings, sizePresets } from './widget-state.mjs';
import { applyLyricStyle, lyricStyleValue } from './widget-lyric-style.mjs';
import { normalizeCircuitStyle, circuitInformation } from './widget-circuit-style.mjs';

export function createSettingsController({
  state, elements, sendWindowCommand, onChange, onBeforeChange = () => {},
}) {
  const { card, badges, btnPin, btnLock, btnZen, checkPin, checkLock, checkZen,
    setLock, setImmersive, setAutoShrink, setSongToast, setEdgeDock, checkEdgeDock, setKaraoke, setLyricTranslation, setLyricToolbar, setBadges, layoutPicker, sizePicker, fontPicker,
    themePicker, menuPaletteName, menuLayoutText, alignPicker, linesPicker,
    offsetRange, offsetValue, offsetEarlier, offsetLater, offsetReset } = elements;
  const disposers = [];
  let saveTimer = null;
  let initialized = false;
  const bind = (element, event, handler) => {
    element.addEventListener(event, handler);
    disposers.push(() => element.removeEventListener(event, handler));
  };
  const select = (picker, predicate) => picker.querySelectorAll('button').forEach(button => {
    const active = Boolean(predicate(button));
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { localStorage.setItem(SETTINGS_KEY, serializeSettings(state)); } catch {}
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 150);
  }
  function applyMode() {
    for (const mode of MODES) {
      card.classList.toggle(mode.cls, mode === MODES[state.modeIndex]);
      document.body.classList.toggle(mode.cls, mode === MODES[state.modeIndex]);
    }
    select(themePicker, button => Number(button.dataset.mode) === state.modeIndex);
    menuPaletteName.textContent = MODES[state.modeIndex].name;
  }
  function updateSizePicker() {
    const presets = sizePresets(state.layout, state.windowWorkArea);
    const key = `${state.layout}:${presets.map(size => size.join('x')).join(':')}`;
    if (sizePicker.dataset.layout !== key) {
      sizePicker.dataset.layout = key;
      sizePicker.replaceChildren(...presets.map(([width, height], index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'seg';
        button.dataset.w = width;
        button.dataset.h = height;
        button.textContent = ['小巧', '推荐', '宽裕'][index];
        return button;
      }));
    }
    const bounds = state.windowBounds;
    select(sizePicker, button => bounds && Number(button.dataset.w) === bounds.width && Number(button.dataset.h) === bounds.height);
  }
  function applyProfile() {
    const profile = state.profiles[state.layout];
    document.documentElement.style.setProperty('--lyric-font-size', profile.font);
    document.documentElement.style.setProperty('--lyric-align', profile.align);
    document.documentElement.style.setProperty('--lyric-justify', { left: 'flex-start', center: 'center', right: 'flex-end' }[profile.align]);
    card.classList.toggle('lyrics-single-line', profile.lines === 1);
    select(fontPicker, button => button.dataset.size === profile.font);
    select(alignPicker, button => button.dataset.align === profile.align);
    select(linesPicker, button => Number(button.dataset.lines) === profile.lines);
    alignPicker.closest('.row').hidden = state.layout !== 'lyrics';
    linesPicker.closest('.row').hidden = state.layout !== 'lyrics';
    updateSizePicker();
  }
  function applyUIState() {
    applyMode();
    applyLyricStyle(card, state.lyricStyle);
    if (card) {
      for (const layout of Object.keys(LAYOUTS)) card.classList.toggle('layout-' + layout, layout === state.layout);
      card.classList.toggle('mode-immersive', state.isImmersive);
      card.classList.toggle('is-locked', state.isLocked);
      card.classList.toggle('metadata-hidden', !state.showBadges);
      card.classList.toggle('lyric-toolbar-hidden', !state.showLyricToolbar);
    }
    for (const [button, check, input, value] of [
      [btnPin, checkPin, null, state.isPinned],
      [btnLock, checkLock, setLock, state.isLocked],
      [btnZen, checkZen, setImmersive, state.isImmersive]
    ]) {
      if (button) button.classList.toggle('active', value);
      if (check) check.style.display = value ? 'inline' : 'none';
      if (input) input.checked = value;
    }
    if (setSongToast) setSongToast.checked = state.songToast;
    if (setAutoShrink) setAutoShrink.checked = state.autoHideWhenPaused;
    if (setEdgeDock) setEdgeDock.checked = state.edgeDock === true;
    if (checkEdgeDock) checkEdgeDock.style.display = state.edgeDock ? 'inline' : 'none';
    if (setKaraoke) setKaraoke.checked = state.wordKaraoke;
    if (setLyricTranslation) setLyricTranslation.checked = state.showLyricTranslation;
    if (setLyricToolbar) setLyricToolbar.checked = state.showLyricToolbar;
    if (setBadges) setBadges.checked = state.showBadges;
    for (const [id, checked] of [
      ['menu-zen', state.isImmersive], ['menu-edge-dock', state.edgeDock],
      ['menu-lock', state.isLocked], ['menu-pin', state.isPinned]
    ]) document.getElementById(id)?.setAttribute('aria-checked', String(Boolean(checked)));
    if (badges) badges.style.display = state.showBadges ? '' : 'none';
    if (layoutPicker) select(layoutPicker, button => button.dataset.layout === state.layout);
    if (menuLayoutText) menuLayoutText.textContent = '切换为' + LAYOUTS[nextLayout()].name + '布局';
    applyProfile();
    updateOffsetUI();
  }
  function nextLayout() {
    const layouts = Object.keys(LAYOUTS);
    return layouts[(layouts.indexOf(state.layout) + 1) % layouts.length];
  }
  function applyLayout(layout) {
    if (!isLayout(layout) || layout === state.layout) return;
    onBeforeChange();
    if (layout === 'circuit') {
      state.circuitReturnLayout = state.layout;
      if (state.modeIndex !== CIRCUIT_MODE_INDEX) state.circuitReturnMode = state.modeIndex;
      state.modeIndex = CIRCUIT_MODE_INDEX;
    } else if (state.layout === 'circuit' && state.modeIndex === CIRCUIT_MODE_INDEX) {
      state.modeIndex = state.circuitReturnMode;
    }
    state.layout = layout;
    if (layout !== 'circuit') state.circuitEditing = false;
    state.windowBounds = null;
    applyUIState();
    sendWindowCommand('layout', {
      layout,
      animate: !matchMedia('(prefers-reduced-motion: reduce)').matches
    });
    onChange('layout');
    save();
  }
  function selectPalette(mode) {
    if (!Number.isInteger(mode) || !MODES[mode] || mode === state.modeIndex) return;
    onBeforeChange();
    if (mode === CIRCUIT_MODE_INDEX && state.layout !== 'circuit') {
      state.circuitReturnMode = state.modeIndex;
      applyLayout('circuit');
      onChange('theme');
      return;
    }
    state.modeIndex = mode;
    if (state.layout === 'circuit' && mode !== CIRCUIT_MODE_INDEX) {
      applyLayout(state.circuitReturnLayout);
    }
    applyMode();
    onChange('theme');
    save();
  }
  function setOption(name, value) {
    if (state[name] === value) return;
    onBeforeChange();
    state[name] = value;
    applyUIState();
    if (name === 'isPinned') sendWindowCommand('pin', value);
    if (name === 'autoHideWhenPaused') sendWindowCommand('auto-hide', value);
    if (name === 'songToast') sendWindowCommand('song-announcement', value);
    onChange(name);
    save();
  }
  function setProfile(name, value) {
    if (!['font', 'align', 'lines'].includes(name)) return;
    const profile = state.profiles[state.layout];
    if (name === 'font' && !FONT_SIZES.includes(value)) return;
    if (name === 'align' && !ALIGNMENTS.includes(value)) return;
    if (name === 'lines' && value !== 1 && value !== 2) return;
    if (profile[name] === value) return;
    onBeforeChange();
    profile[name] = value;
    applyProfile();
    onChange(name);
    save();
  }
  function setWheelBehavior(value) {
    if (!Object.prototype.hasOwnProperty.call(WHEEL_BEHAVIORS, value) || state.wheelBehavior === value) return;
    state.wheelBehavior = value;
    onChange('wheel');
    save();
  }
  function setCircuitTitlePosition(value) {
    if (!['top', 'bottom'].includes(value) || state.circuitTitlePosition === value) return;
    onBeforeChange();
    state.circuitTitlePosition = value;
    onChange('circuitTitlePosition');
    save();
  }
  function setCircuitStyle(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    const next = normalizeCircuitStyle({ ...state.circuitStyle, ...patch });
    if (JSON.stringify(next) === JSON.stringify(state.circuitStyle)) return;
    state.circuitStyle = next;
    onChange('circuitStyle');
    save();
  }
  function setCircuitInformation(position, patch) {
    if (!['top', 'bottom'].includes(position) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    const current = circuitInformation(state.circuitStyle, position);
    setCircuitStyle({ information: { ...state.circuitStyle.information, [position]: { ...current, ...patch } } });
  }
  function setCircuitEditing(value) {
    if (state.layout !== 'circuit' || typeof value !== 'boolean' || value === state.circuitEditing) return;
    onBeforeChange();
    state.circuitEditing = value;
    onChange('circuitEditing');
  }
  function resetCircuitStyle() {
    onBeforeChange();
    state.circuitStyle = normalizeCircuitStyle();
    onChange('circuitStyle');
    save();
  }
  function setLyricStyle(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    const next = { ...state.lyricStyle };
    for (const [name, value] of Object.entries(patch)) {
      const normalized = lyricStyleValue(name, value);
      if (normalized === undefined) return;
      next[name] = normalized;
    }
    if (Object.keys(next).every(name => next[name] === state.lyricStyle[name])) return;
    state.lyricStyle = next;
    applyLyricStyle(card, next);
    onChange('lyricStyle');
    save();
  }
  function updateOffsetUI() {
    offsetRange.value = state.lyricOffsetMs;
    const seconds = Math.abs(state.lyricOffsetMs / 1000).toFixed(2);
    const text = state.lyricOffsetMs > 0 ? `提前 ${seconds} 秒` : state.lyricOffsetMs < 0 ? `延后 ${seconds} 秒` : '无偏移';
    offsetValue.textContent = text;
    offsetRange.setAttribute('aria-valuetext', text);
    for (const element of [offsetRange, offsetEarlier, offsetLater, offsetReset]) element.disabled = !state.songPersistentKey;
  }
  function setOffset(value) {
    if (!state.songPersistentKey) return;
    state.lyricOffsetMs = clampOffset(value);
    state.offsets.delete(state.songPersistentKey);
    if (state.lyricOffsetMs) state.offsets.set(state.songPersistentKey, state.lyricOffsetMs);
    while (state.offsets.size > 256) state.offsets.delete(state.offsets.keys().next().value);
    updateOffsetUI();
    onChange('offset');
    save();
  }
  function updateSong(key) {
    const next = typeof key === 'string' ? key : '';
    if (next === state.songPersistentKey) return;
    state.songPersistentKey = next;
    state.lyricOffsetMs = state.offsets.get(next) || 0;
    updateOffsetUI();
    onChange('offset');
  }
  function updateWindow(snapshot) {
    if (!snapshot || !snapshot.bounds) return;
    if (!initialized) {
      initialized = true;
      if (isLayout(snapshot.layout) && state.modeIndex !== CIRCUIT_MODE_INDEX) {
        state.layout = snapshot.layout;
        if (state.layout === 'circuit') state.modeIndex = CIRCUIT_MODE_INDEX;
        applyUIState();
        onChange('layout');
      }
      sendWindowCommand('layout', { layout: state.layout, initialize: state.layout !== 'circuit' });
      save();
    }
    if (snapshot.layout && snapshot.layout !== state.layout) return;
    state.windowBounds = snapshot.bounds;
    if (snapshot.workArea) state.windowWorkArea = snapshot.workArea;
    updateSizePicker();
  }

  function setSizePreset(width, height) {
    if (!sizePresets(state.layout, state.windowWorkArea).some(([w, h]) => w === width && h === height)) return;
    onBeforeChange();
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    sendWindowCommand('resize', { width, height, animate, save: true });
    onChange('size');
    save();
  }

  bind(themePicker, 'click', event => {
    const button = event.target.closest('[data-mode]');
    if (button) selectPalette(Number(button.dataset.mode));
  });
  bind(layoutPicker, 'click', event => {
    const button = event.target.closest('[data-layout]');
    if (button) applyLayout(button.dataset.layout);
  });
  bind(sizePicker, 'click', event => {
    const button = event.target.closest('[data-w]');
    if (button) setSizePreset(Number(button.dataset.w), Number(button.dataset.h));
  });
  bind(fontPicker, 'click', event => {
    const button = event.target.closest('[data-size]');
    if (button) setProfile('font', button.dataset.size);
  });
  bind(alignPicker, 'click', event => {
    const button = event.target.closest('[data-align]');
    if (button) setProfile('align', button.dataset.align);
  });
  bind(linesPicker, 'click', event => {
    const button = event.target.closest('[data-lines]');
    if (button) setProfile('lines', Number(button.dataset.lines));
  });
  for (const [input, name] of [[setLock, 'isLocked'], [setImmersive, 'isImmersive'], [setAutoShrink, 'autoHideWhenPaused'], [setSongToast, 'songToast'], [setEdgeDock, 'edgeDock'], [setKaraoke, 'wordKaraoke'], [setLyricTranslation, 'showLyricTranslation'], [setLyricToolbar, 'showLyricToolbar'], [setBadges, 'showBadges']]) {
    if (input) bind(input, 'change', event => setOption(name, event.target.checked));
  }
  bind(offsetRange, 'input', event => setOffset(Number(event.target.value)));
  bind(offsetEarlier, 'click', () => setOffset(state.lyricOffsetMs + 100));
  bind(offsetLater, 'click', () => setOffset(state.lyricOffsetMs - 100));
  bind(offsetReset, 'click', () => setOffset(0));
  window.addEventListener('pagehide', flush);
  applyUIState();
  return {
    applyLayout, nextLayout, selectPalette, setOption, setProfile, setOffset, setSizePreset, setWheelBehavior, setLyricStyle, setCircuitTitlePosition,
    setCircuitStyle, setCircuitInformation, setCircuitEditing, resetCircuitStyle,
    updateSong, updateWindow, applyUIState,
    cyclePalette: () => selectPalette((state.modeIndex + 1) % MODES.length),
    dispose() {
      flush();
      window.removeEventListener('pagehide', flush);
      disposers.forEach(dispose => dispose());
    }
  };
}
