export const LYRIC_STYLE_DEFAULTS = Object.freeze({
  rendering: 'grayscale', fontWeight: 400, strokeWidth: .5,
  borderColor: '#8f8f8f', backgroundColor: '#2c2c2c', backgroundOpacity: 76,
  textColor: '#ffffff', highlightColor: '#ffa04d',
  textStrokeColor: '#101010', highlightStrokeColor: '#101010'
});

export const LYRIC_STYLE_PRESETS = Object.freeze({
  classic: { name: '经典橙白', values: LYRIC_STYLE_DEFAULTS },
  light: { name: '清爽浅色', values: { ...LYRIC_STYLE_DEFAULTS,
    borderColor: '#d1d1d6', backgroundColor: '#f5f5f7', backgroundOpacity: 96,
    textColor: '#29292d', highlightColor: '#0066cc', strokeWidth: 0 } }
});

const colors = new Set(['borderColor', 'backgroundColor', 'textColor', 'highlightColor', 'textStrokeColor', 'highlightStrokeColor']);
export function lyricStyleValue(name, value) {
  if (colors.has(name)) return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
  if (name === 'rendering') return ['grayscale', 'system'].includes(value) ? value : undefined;
  if (name === 'fontWeight') return [400, 500, 600].includes(value) ? value : undefined;
  if (name === 'strokeWidth') return [0, .5, 1, 1.5, 2].includes(value) ? value : undefined;
  if (name === 'backgroundOpacity') return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : undefined;
  return undefined;
}
export function normalizeLyricStyle(value) {
  const style = { ...LYRIC_STYLE_DEFAULTS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return style;
  for (const name of Object.keys(style)) style[name] = lyricStyleValue(name, value[name]) ?? style[name];
  return style;
}
export function lyricStylePreset(style) {
  return Object.entries(LYRIC_STYLE_PRESETS).find(([, preset]) =>
    Object.entries(preset.values).every(([name, value]) => ['rendering', 'fontWeight'].includes(name) || style[name] === value))?.[0] || 'custom';
}
export function applyLyricStyle(element, style) {
  const clearWindow = style.backgroundOpacity === 0;
  element.classList.toggle('lyric-window-clear', clearWindow);
  for (const [name, value] of Object.entries({
    '--lyric-active': style.highlightColor, '--lyric-base': style.textColor,
    '--lyric-text-stroke': style.textStrokeColor, '--lyric-highlight-stroke': style.highlightStrokeColor,
    '--lyric-stroke-width': style.strokeWidth + 'px', '--lyric-weight': style.fontWeight,
    '--lyric-window-border': style.borderColor + (clearWindow ? '00' : '57'),
    '--lyric-window-background': style.backgroundColor + Math.round(style.backgroundOpacity * 2.55).toString(16).padStart(2, '0')
  })) element.style.setProperty(name, String(value));
}
