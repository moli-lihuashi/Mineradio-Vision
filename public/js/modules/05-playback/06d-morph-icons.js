// ====================================================================
//  控制台图标 Morph 接入层（morphicons 1.7.1）
//  - 依赖 public/vendor/morphicons/morphicons.global.js → window.Morphicons
//  - 管理三个有状态切换的控制台图标：播放/暂停、播放顺序、音量档位
//  - 红心按钮仅颜色/光晕切换（path 不变），不接入 morph
//  - 库缺失或 DOM 未就绪时返回 false，调用方回退 innerHTML 旧逻辑
// ====================================================================
var MorphiconCtl = (function () {
  'use strict';

  // 24×24 stroke 图标（Lucide 风格 d 字符串，与控制台 stroke 按钮同一网格）
  var ICONS = {
    play: 'M8 5 19 12 8 19Z',
    pause: 'M8 5v14M16 5v14',
    modeLoop: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    modeShuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
    modeSingle: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3M12 9v6M10.5 10.5 12 9l1.5 1.5',
    volHigh: 'M11 5 6 9 2 9 2 15 6 15 11 19 11 5ZM15 9.5a4 4 0 0 1 0 5M18 7a7 7 0 0 1 0 10',
    volLow: 'M11 5 6 9 2 9 2 15 6 15 11 19 11 5ZM15 10.5a2 2 0 0 1 0 3',
    volMute: 'M11 5 6 9 2 9 2 15 6 15 11 19 11 5ZM17 9 22 14M22 9 17 14'
  };

  // slot：图标槽位。cur 记录逻辑态，inst 惰性创建（首次 morph 时绑定 DOM path）
  var SLOTS = {
    play: { elId: 'play-icon', cur: 'play', inst: null },
    mode: { elId: 'play-mode-icon', cur: 'modeLoop', inst: null },
    vol: { elId: 'volume-icon', cur: 'volHigh', inst: null }
  };

  function ensureInstance(key) {
    var slot = SLOTS[key];
    if (!slot || slot.inst) return slot || null;
    if (!window.Morphicons || typeof window.Morphicons.createMorph !== 'function') return null;
    var svg = document.getElementById(slot.elId);
    if (!svg) return null;
    var pathEl = svg.querySelector('path');
    if (!pathEl) {
      pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.appendChild(pathEl);
    }
    try {
      slot.inst = window.Morphicons.createMorph(pathEl, ICONS[slot.cur] || ICONS.play);
    } catch (err) {
      console.warn('[MorphiconCtl] createMorph failed:', err);
      slot.inst = null;
    }
    return slot;
  }

  // 切换图标（带弹簧动画）。成功返回 true；失败返回 false 由调用方回退。
  function set(key, iconName, opts) {
    var slot = SLOTS[key];
    if (!slot || !ICONS[iconName]) return false;
    var changed = slot.cur !== iconName;
    slot.cur = iconName;
    if (!window.Morphicons) return false;
    var s = ensureInstance(key);
    if (!s || !s.inst) return false;
    if (changed) s.inst.morphTo(ICONS[iconName], (opts && opts.spring) || 'snappy');
    return true;
  }

  // 无动画同步（初始态校准；morph 中途直接落位）
  function sync(key, iconName) {
    var slot = SLOTS[key];
    if (slot && ICONS[iconName]) slot.cur = iconName;
    var s = ensureInstance(key);
    if (s && s.inst && ICONS[iconName]) s.inst.set(ICONS[iconName]);
  }

  function available() {
    return !!(window.Morphicons && typeof window.Morphicons.createMorph === 'function');
  }

  return { ICONS: ICONS, set: set, sync: sync, available: available };
})();
window.MorphiconCtl = MorphiconCtl;
