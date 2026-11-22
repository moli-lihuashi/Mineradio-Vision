export const CIRCUIT_FIELDS = Object.freeze(['title', 'artist', 'album', 'date', 'duration']);
export const CIRCUIT_INFORMATION_DEFAULTS = Object.freeze({
  density: 'auto', showArtist: true, showAlbum: true, showDate: true, showDuration: false
});
export const CIRCUIT_STYLE_DEFAULTS = Object.freeze({
  ...CIRCUIT_INFORMATION_DEFAULTS,
  smallFont: 0, largeFont: 0, metadataFont: 0, fontWeight: 600, animate: true
});

export function circuitInformation(style, position = 'top') {
  const layout = position === 'bottom' ? 'bottom' : 'top';
  return style?.information?.[layout] || {
    density: ['auto', 'full', 'custom'].includes(style?.density) ? style.density : CIRCUIT_INFORMATION_DEFAULTS.density,
    showArtist: typeof style?.showArtist === 'boolean' ? style.showArtist : CIRCUIT_INFORMATION_DEFAULTS.showArtist,
    showAlbum: typeof style?.showAlbum === 'boolean' ? style.showAlbum : CIRCUIT_INFORMATION_DEFAULTS.showAlbum,
    showDate: typeof style?.showDate === 'boolean' ? style.showDate : CIRCUIT_INFORMATION_DEFAULTS.showDate,
    showDuration: typeof style?.showDuration === 'boolean' ? style.showDuration : CIRCUIT_INFORMATION_DEFAULTS.showDuration
  };
}

export function normalizeCircuitStyle(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const style = { ...CIRCUIT_STYLE_DEFAULTS, information: {}, positions: { top: {}, bottom: {} } };
  if (['auto', 'full', 'custom'].includes(source.density)) style.density = source.density;
  for (const name of ['showArtist', 'showAlbum', 'showDate', 'showDuration', 'animate']) {
    if (typeof source[name] === 'boolean') style[name] = source[name];
  }
  for (const [name, minimum, maximum] of [['smallFont', 10, 28], ['largeFont', 24, 120], ['metadataFont', 10, 32]]) {
    if (Number.isFinite(source[name]) && source[name] !== 0) style[name] = Math.max(minimum, Math.min(maximum, Math.round(source[name])));
  }
  if (source.fontWeight === 500) style.fontWeight = 500;
  const migratedInformation = circuitInformation(style);
  for (const layout of ['top', 'bottom']) {
    // Legacy flat settings seed both designs; each new slot can override them independently.
    const information = { ...migratedInformation };
    const slot = source.information?.[layout];
    if (slot && typeof slot === 'object' && !Array.isArray(slot)) {
      if (['auto', 'full', 'custom'].includes(slot.density)) information.density = slot.density;
      for (const name of ['showArtist', 'showAlbum', 'showDate', 'showDuration']) {
        if (typeof slot[name] === 'boolean') information[name] = slot[name];
      }
    }
    style.information[layout] = information;
    for (const field of CIRCUIT_FIELDS) {
      const position = source.positions?.[layout]?.[field];
      if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
        style.positions[layout][field] = {
          x: Math.max(0, Math.min(1, position.x)), y: Math.max(0, Math.min(1, position.y)),
          align: ['left', 'center', 'right'].includes(position.align) ? position.align : 'left'
        };
      }
    }
  }
  return style;
}
