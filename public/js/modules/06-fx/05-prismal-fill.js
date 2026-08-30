'use strict';

/* Sync --prism-fill for glass FX/volume sliders. Never touches particle-count fire track. */
(function () {
  var SELECTOR = '#fx-panel .fx-slider:not(.fx-fire-slider-row) input[type=range], #volume-slider';

  function syncFill(input) {
    if (!input || input.type !== 'range') return;
    if (input.id === 'fx-particlecount') return;
    if (input.closest && input.closest('.fx-fire-track-wrapper, .fx-fire-slider-row')) return;
    var min = Number(input.min);
    var max = Number(input.max);
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 100;
    var val = Number(input.value);
    if (!isFinite(val)) val = min;
    var pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    input.style.setProperty('--prism-fill', pct + '%');
  }

  function syncAll() {
    var list = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) syncFill(list[i]);
  }

  function onInput(ev) {
    var t = ev.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'range') return;
    syncFill(t);
  }

  function boot() {
    syncAll();
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    // FX panel values may be applied after boot
    setTimeout(syncAll, 600);
    setTimeout(syncAll, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.MineradioPrismalFill = { sync: syncAll, syncOne: syncFill };
})();
