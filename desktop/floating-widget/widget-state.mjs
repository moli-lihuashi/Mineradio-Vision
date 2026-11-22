import { normalizeLyricStyle } from './widget-lyric-style.mjs';
import { normalizeCircuitStyle } from './widget-circuit-style.mjs';
export const SETTINGS_KEY = 'folia_enhanced_widget_config';
export const WHEEL_BEHAVIORS = Object.freeze({
  volume: { name: '调整音量', description: '向上增大音量，向下减小音量，每次调整 5%。' },
  seek: { name: '调整歌曲进度', description: '向上快进 5 秒，向下后退 5 秒。' },
  track: { name: '上一首 / 下一首', description: '向上切换上一首，向下切换下一首。连续滚动会限制切歌频率。' }
});
export const MODES = Object.freeze([
  { cls: 'mode-paper', name: '暖白纸质' },
  { cls: 'mode-dark', name: '石墨深色' },
  { cls: 'mode-cover', name: '封面自适应' },
  { cls: 'mode-light', name: '极简浅色' },
  { cls: 'mode-transparent', name: '悬浮透明' },
  { cls: 'mode-circuit', name: 'Circuit 封面海报' },
  /* 液态玻璃：卡片本身是玻璃，折射身后的封面模糊背景层（见 widget-liquid.mjs）。
   * 折射源必须是窗口内可读的内容——透明窗口读不到桌面像素。 */
  { cls: 'mode-liquid', name: '液态玻璃' }
]);
export const CIRCUIT_MODE_INDEX = MODES.findIndex(mode => mode.cls === 'mode-circuit');
export const LAYOUTS = Object.freeze({
  poster: { name: '海报款', font: '16px', minimum: [240, 200], sizes: [[288, 352], [320, 384], [352, 432]] },
  capsule: { name: '紧凑胶囊', font: '16px', minimum: [300, 112], sizes: [[320, 128], [384, 160], [480, 208]] },
  standard: { name: '全功能', font: '16px', minimum: [360, 240], sizes: [[480, 256], [528, 272], [608, 320]] },
  lyrics: { name: '纯歌词', font: '28px', minimum: [360, 100], sizes: [[400, 144], [512, 160], [640, 208]] },
  circuit: { name: 'Circuit 海报', font: '16px', minimum: [208, 336], sizes: [[208, 336], [304, 488], [368, 592]] }
});

function fitCircuitSize(size, maximumWidth, maximumHeight) {
  const [width, height] = size;
  const [minimumWidth, minimumHeight] = LAYOUTS.circuit.minimum;
  const scale = Math.max(minimumWidth / width, minimumHeight / height,
    Math.min(1, maximumWidth / width, maximumHeight / height));
  return [Math.round(width * scale), Math.round(height * scale)];
}

export function recommendedSize(layout, workArea) {
  const [width, height] = LAYOUTS[layout].sizes[1];
  if (!workArea || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) return [width, height];
  const [minimumWidth, minimumHeight] = LAYOUTS[layout].minimum;
  if (layout === 'circuit') return fitCircuitSize([width, height], workArea.width - 32, workArea.height * .6);
  return [
    Math.max(minimumWidth, Math.min(width, Math.floor((workArea.width - 32) / 8) * 8)),
    Math.max(minimumHeight, Math.min(height, Math.floor(workArea.height * 0.6 / 8) * 8))
  ];
}

export function sizePresets(layout, workArea) {
  const presets = LAYOUTS[layout].sizes.map(size => [...size]);
  if (!workArea || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) return presets;
  const [minimumWidth, minimumHeight] = LAYOUTS[layout].minimum;
  const [recommendedWidth, recommendedHeight] = recommendedSize(layout, workArea);
  if (layout === 'circuit') return [presets[0], [recommendedWidth, recommendedHeight],
    fitCircuitSize(presets[2], workArea.width - 16, workArea.height - 16)];
  presets[0] = [
    Math.max(minimumWidth, Math.min(presets[0][0], recommendedWidth - 8)),
    Math.max(minimumHeight, Math.min(presets[0][1], recommendedHeight - 16))
  ];
  presets[1] = [recommendedWidth, recommendedHeight];
  presets[2] = [
    Math.max(recommendedWidth, Math.min(presets[2][0], Math.floor((workArea.width - 16) / 8) * 8)),
    Math.max(recommendedHeight, Math.min(presets[2][1], Math.floor((workArea.height - 16) / 8) * 8))
  ];
  return presets;
}

export const FONT_SIZES = ['12.5px', '14px', '16px', '20px', '24px', '28px', '32px'];
export const ALIGNMENTS = ['left', 'center', 'right'];
export const isLayout = value => Object.prototype.hasOwnProperty.call(LAYOUTS, value);
export const clampOffset = value => Number.isFinite(value) ? Math.max(-5000, Math.min(5000, Math.round(value / 50) * 50)) : 0;

export function createWidgetState() {
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch {}
  let layout = isLayout(saved.layoutMode) ? saved.layoutMode : 'poster';
  let modeIndex = Number.isInteger(saved.modeIndex) ? ((saved.modeIndex % MODES.length) + MODES.length) % MODES.length : 0;
  if (modeIndex === CIRCUIT_MODE_INDEX || layout === 'circuit') { layout = 'circuit'; modeIndex = CIRCUIT_MODE_INDEX; }
  const profiles = {};
  for (const [key, defaults] of Object.entries(LAYOUTS)) {
    const profile = saved.profiles?.[key];
    const legacyFont = key === 'lyrics' ? defaults.font : saved.lyricFontSize;
    profiles[key] = {
      font: FONT_SIZES.includes(profile?.font) ? profile.font : FONT_SIZES.includes(legacyFont) ? legacyFont : defaults.font,
      align: ALIGNMENTS.includes(profile?.align) ? profile.align : key === 'lyrics' ? 'center' : 'left',
      lines: profile?.lines === 1 ? 1 : 2
    };
  }
  const offsets = new Map();
  if (Array.isArray(saved.songOffsets)) {
    for (const entry of saved.songOffsets.slice(-256)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].length <= 2000 && Number.isFinite(entry[1])) {
        const offset = clampOffset(entry[1]);
        if (offset) offsets.set(entry[0], offset);
      }
    }
  }
  return {
    layout, profiles, offsets, lyricStyle: normalizeLyricStyle(saved.lyricStyle),
    circuitStyle: normalizeCircuitStyle(saved.circuitStyle), circuitEditing: false,
    circuitTitlePosition: saved.circuitTitlePosition === 'bottom' ? 'bottom' : 'top',
    circuitReturnLayout: isLayout(saved.circuitReturnLayout) && saved.circuitReturnLayout !== 'circuit' ? saved.circuitReturnLayout : 'poster',
    circuitReturnMode: Number.isInteger(saved.circuitReturnMode) && saved.circuitReturnMode >= 0 && saved.circuitReturnMode < CIRCUIT_MODE_INDEX ? saved.circuitReturnMode : 0,
    isPinned: saved.isPinned !== false,
    isLocked: saved.isLocked === true,
    isImmersive: saved.isImmersive === true,
    restoreExpandedBounds: saved.autoShrink === true && typeof saved.autoHideWhenPaused !== 'boolean',
    autoHideWhenPaused: typeof saved.autoHideWhenPaused === 'boolean' ? saved.autoHideWhenPaused : saved.autoShrink === true,
    songToast: saved.songToast === true, isAnnouncing: false,
    edgeDock: saved.edgeDock === true,
    wordKaraoke: saved.enableWordKaraoke !== false,
    showLyricTranslation: saved.showLyricTranslation !== false,
    showLyricToolbar: saved.showLyricToolbar !== false,
    showBadges: saved.showBadges !== false,
    wheelBehavior: Object.prototype.hasOwnProperty.call(WHEEL_BEHAVIORS, saved.wheelBehavior) ? saved.wheelBehavior : 'seek',
    modeIndex,
    currentDuration: 0, currentPosition: 0, isPlaying: false, isScrubbing: false,
    songPersistentKey: '', lyricOffsetMs: 0, windowBounds: null, windowWorkArea: null
  };
}

export function serializeSettings(state) {
  return JSON.stringify({
    schemaVersion: 10,
    layoutMode: state.layout,
    profiles: state.profiles,
    songOffsets: [...state.offsets.entries()].slice(-256),
    isPinned: state.isPinned,
    isLocked: state.isLocked,
    isImmersive: state.isImmersive,
    autoHideWhenPaused: state.autoHideWhenPaused,
    songToast: state.songToast,
    edgeDock: state.edgeDock,
    enableWordKaraoke: state.wordKaraoke,
    showLyricTranslation: state.showLyricTranslation,
    showLyricToolbar: state.showLyricToolbar,
    showBadges: state.showBadges,
    wheelBehavior: state.wheelBehavior,
    lyricStyle: state.lyricStyle,
    circuitStyle: state.circuitStyle,
    circuitTitlePosition: state.circuitTitlePosition,
    circuitReturnLayout: state.circuitReturnLayout,
    circuitReturnMode: state.circuitReturnMode,
    modeIndex: state.modeIndex
  });
}

export function formatTime(sec) {
  const time = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  return `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
}
