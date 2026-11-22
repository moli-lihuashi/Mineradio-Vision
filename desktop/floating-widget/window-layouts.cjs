'use strict';

const DEFAULT_SIZES = Object.freeze({
  poster: { width: 320, height: 384 },
  capsule: { width: 384, height: 160 },
  standard: { width: 528, height: 272 },
  lyrics: { width: 512, height: 160 },
  circuit: { width: 304, height: 488 }
});
const MINIMUM_SIZES = Object.freeze({
  poster: [240, 200], capsule: [300, 112], standard: [360, 240], lyrics: [360, 100], circuit: [208, 336]
});
const isLayout = value => Object.prototype.hasOwnProperty.call(DEFAULT_SIZES, value);

// 原生窗口负责位置和尺寸，渲染层负责字号、对齐和歌词行数。
module.exports = function createWindowLayouts(api, screen) {
  let activeLayout = null;
  const profiles = {};
  let pending = null;
  let timer = null;
  let writes = Promise.resolve();
  let lastSaved = '';
  let loaded = false;
  let lastBounds = null;

  function minimumSize() { return MINIMUM_SIZES[activeLayout || 'poster']; }
  function recommendedSize(layout, area) {
    const base = DEFAULT_SIZES[layout];
    const [minimumWidth, minimumHeight] = MINIMUM_SIZES[layout];
    if (layout === 'circuit') {
      const scale = Math.max(minimumWidth / base.width, minimumHeight / base.height,
        Math.min(1, (area.width - 32) / base.width, area.height * .6 / base.height));
      return { width: Math.round(base.width * scale), height: Math.round(base.height * scale) };
    }
    return {
      width: Math.max(minimumWidth, Math.min(base.width, Math.floor((area.width - 32) / 8) * 8)),
      height: Math.max(minimumHeight, Math.min(base.height, Math.floor(area.height * 0.6 / 8) * 8))
    };
  }
  function anchoredBounds(current, size, area, fixedTop = false) {
    const width = Math.min(size.width, area.width);
    const height = Math.min(size.height, area.height);
    const left = current.x - area.x;
    const right = area.x + area.width - current.x - current.width;
    const top = current.y - area.y;
    const bottom = area.y + area.height - current.y - current.height;
    const near = gap => gap >= 0 && gap <= 96;
    const x = near(left) && left <= right ? area.x + left
      : near(right) ? area.x + area.width - width - right
        : current.x + (current.width - width) / 2;
    const y = fixedTop ? current.y : near(top) && top <= bottom ? area.y + top
      : near(bottom) ? area.y + area.height - height - bottom
        : current.y + (current.height - height) / 2;
    return {
      x: Math.max(area.x, Math.min(Math.round(x), area.x + area.width - width)),
      y: Math.max(area.y, Math.min(Math.round(y), area.y + area.height - height)),
      width, height
    };
  }
  function clampBounds(bounds) {
    const [minimumWidth, minimumHeight] = minimumSize();
    const normalized = {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(minimumWidth, Math.min(800, Math.round(bounds.width))),
      height: Math.max(minimumHeight, Math.min(600, Math.round(bounds.height)))
    };
    const area = screen.getDisplayMatching(normalized).workArea;
    const width = Math.min(normalized.width, Math.max(200, area.width));
    const height = Math.min(normalized.height, Math.max(120, area.height));
    return {
      width, height,
      x: Math.max(area.x, Math.min(Math.round(bounds.x), area.x + area.width - width)),
      y: Math.max(area.y, Math.min(Math.round(bounds.y), area.y + area.height - height))
    };
  }
  function validBounds(value) {
    return value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]));
  }
  async function load() {
    if (loaded && lastBounds) return clampBounds(lastBounds);
    const primary = screen.getPrimaryDisplay().workArea;
    const firstSize = recommendedSize('poster', primary);
    let initial = {
      ...firstSize,
      x: primary.x + primary.width - firstSize.width - 24,
      y: primary.y + primary.height - firstSize.height - 32
    };
    const [legacy, saved] = await Promise.allSettled([
      Promise.resolve().then(() => api.storage.get('widget_bounds')),
      Promise.resolve().then(() => api.storage.get('widget_layouts'))
    ]);
    if (legacy.status === 'fulfilled') {
      const value = legacy.value;
      if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
        initial = { ...initial, x: value.x, y: value.y };
        if (Number.isFinite(value.width)) initial.width = value.width;
        if (Number.isFinite(value.height)) initial.height = value.height;
      }
    }
    if (saved.status === 'fulfilled' && saved.value && typeof saved.value === 'object') {
      const value = saved.value;
      for (const key of Object.keys(DEFAULT_SIZES)) {
        if (validBounds(value.profiles?.[key])) profiles[key] = { ...value.profiles[key] };
      }
      if (isLayout(value.activeLayout)) {
        activeLayout = value.activeLayout;
        if (profiles[activeLayout]) initial = profiles[activeLayout];
      }
    }
    loaded = true;
    lastBounds = clampBounds(initial);
    return { ...lastBounds };
  }
  function remember(bounds, profileMode = 'full') {
    const copy = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    lastBounds = copy;
    if (activeLayout && profileMode === 'full') {
      profiles[activeLayout] = { ...copy };
    } else if (activeLayout && profileMode === 'position') {
      const normal = profiles[activeLayout] || { ...copy, height: DEFAULT_SIZES[activeLayout].height };
      profiles[activeLayout] = { ...normal, x: copy.x, y: copy.y, width: copy.width };
    }
    const snapshot = { bounds: copy, activeLayout, profiles: Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, { ...value }])) };
    const key = JSON.stringify(snapshot);
    if (key === lastSaved) return;
    lastSaved = key;
    pending = snapshot;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, 200);
  }
  function flush() {
    if (!pending) return writes;
    const snapshot = pending;
    pending = null;
    writes = writes.then(async () => {
      await api.storage.set('widget_bounds', snapshot.bounds);
      await api.storage.set('widget_layouts', { activeLayout: snapshot.activeLayout, profiles: snapshot.profiles });
    }).catch(error => {
      lastSaved = '';
      api.log.warn('保存布局位置失败: ' + error.message);
    });
    return writes;
  }
  function switchLayout(next, current, initialize = false) {
    if (!isLayout(next)) return null;
    if (next === activeLayout) return clampBounds(current);
    if (!activeLayout && initialize) {
      // 升级时将旧版的窗口位置与尺寸保留给已有布局。
      activeLayout = next;
      return clampBounds(current);
    }
    const area = screen.getDisplayMatching(current).workArea;
    if (activeLayout && !profiles[activeLayout]) {
      profiles[activeLayout] = { ...current, height: current.height };
    }
    activeLayout = next;
    const base = profiles[next] || recommendedSize(next, area);
    const placed = anchoredBounds(current, base, area);
    profiles[next] = { ...placed };
    return clampBounds(placed);
  }
  return {
    load, remember, switchLayout, minimumSize, clampBounds,
    defaultSize(layout) { return DEFAULT_SIZES[layout || activeLayout || 'capsule']; },
    snapshot(bounds) {
      let workArea = null;
      try {
        const display = screen.getDisplayMatching(bounds);
        if (display && display.workArea) workArea = { ...display.workArea };
      } catch {}
      return {
        layout: activeLayout, bounds: { ...bounds }, workArea,
        profile: profiles[activeLayout] ? { ...profiles[activeLayout] } : null,
        profiles: Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, { ...value }]))
      };
    },
    dispose() { clearTimeout(timer); return flush(); }
  };
};
