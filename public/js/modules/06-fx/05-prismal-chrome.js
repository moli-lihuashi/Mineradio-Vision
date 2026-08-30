'use strict';

/* Prismal chrome: sliding glass lens + range fill + iOS press-enlarge thumb.
   Safe: no style MutationObserver. Excludes particle-count fire track. */
(function () {
  var hosts = [];
  var RANGE_SEL = '#fx-panel .fx-slider:not(.fx-fire-slider-row) input[type=range], #volume-slider';

  function isFireRange(input) {
    if (!input) return true;
    if (input.id === 'fx-particlecount') return true;
    return !!(input.closest && input.closest('.fx-fire-track-wrapper, .fx-fire-slider-row'));
  }

  function syncRangeFill(input) {
    if (!input || input.type !== 'range' || isFireRange(input)) return;
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

  function setDragging(input, on) {
    if (!input || isFireRange(input)) return;
    if (on) input.classList.add('is-dragging');
    else input.classList.remove('is-dragging');
  }

  function bindRangeInteractions() {
    if (document._prismRangeBound) return;
    document._prismRangeBound = true;

    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT' || t.type !== 'range') return;
      syncRangeFill(t);
    }, true);

    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT' || t.type !== 'range') return;
      syncRangeFill(t);
      setDragging(t, false);
    }, true);

    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT' || t.type !== 'range') return;
      if (isFireRange(t)) return;
      if (!t.matches(RANGE_SEL)) return;
      setDragging(t, true);
      syncRangeFill(t);
    }, true);

    document.addEventListener('pointerup', function () {
      var list = document.querySelectorAll(RANGE_SEL + '.is-dragging');
      for (var i = 0; i < list.length; i++) setDragging(list[i], false);
    }, true);

    document.addEventListener('pointercancel', function () {
      var list = document.querySelectorAll(RANGE_SEL + '.is-dragging');
      for (var i = 0; i < list.length; i++) setDragging(list[i], false);
    }, true);

    window.addEventListener('blur', function () {
      var list = document.querySelectorAll(RANGE_SEL + '.is-dragging');
      for (var i = 0; i < list.length; i++) setDragging(list[i], false);
    });
  }

  function syncAllFills() {
    var list = document.querySelectorAll(RANGE_SEL);
    for (var i = 0; i < list.length; i++) syncRangeFill(list[i]);
  }

  function ensurePill(host) {
    var pill = null;
    try {
      pill = host.querySelector(':scope > .prism-lens-pill');
    } catch (_) {
      var kids = host.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].classList && kids[i].classList.contains('prism-lens-pill')) {
          pill = kids[i];
          break;
        }
      }
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'prism-lens-pill';
      pill.setAttribute('aria-hidden', 'true');
      host.insertBefore(pill, host.firstChild);
    }
    host.classList.add('prism-lens-host');
    return pill;
  }

  function activeButton(host) {
    return host.querySelector('button.active') || host.querySelector('[aria-selected="true"]');
  }

  function movePill(host, instant) {
    if (host._prismLensMoving) return;
    host._prismLensMoving = true;
    try {
      var pill = ensurePill(host);
      var btn = activeButton(host);
      if (!btn || host.classList.contains('is-hidden') || getComputedStyle(host).display === 'none') {
        pill.classList.remove('is-ready');
        return;
      }
      var hr = host.getBoundingClientRect();
      var br = btn.getBoundingClientRect();
      if (hr.width < 2 || br.width < 2) {
        pill.classList.remove('is-ready');
        return;
      }
      var left = br.left - hr.left;
      var top = br.top - hr.top;
      if (instant) pill.style.transition = 'none';
      pill.style.left = left + 'px';
      pill.style.top = top + 'px';
      pill.style.width = br.width + 'px';
      pill.style.height = br.height + 'px';
      pill.classList.add('is-ready');
      if (instant) {
        void pill.offsetWidth;
        pill.style.transition = '';
      }
    } finally {
      host._prismLensMoving = false;
    }
  }

  function mutationsAffectButtons(mutations, pill) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var t = m.target;
      if (!t || t === pill) continue;
      if (t.classList && t.classList.contains('prism-lens-pill')) continue;
      if (m.type === 'attributes' && m.attributeName === 'class' && (t.tagName === 'BUTTON' || (t.classList && t.classList.contains('login-mode-node')))) return true;
      if (m.type === 'childList') {
        // Ignore pill insert/remove noise
        var nodes = [].concat(Array.from(m.addedNodes || []), Array.from(m.removedNodes || []));
        for (var n = 0; n < nodes.length; n++) {
          if (nodes[n] === pill) continue;
          if (nodes[n].nodeType === 1) return true;
        }
      }
    }
    return false;
  }

  function setPillPress(host, on) {
    var pill = host && host.querySelector && host.querySelector('.prism-lens-pill');
    if (!pill) return;
    if (on) {
      pill.classList.add('is-pressing');
      pill.classList.remove('is-settling');
    } else {
      pill.classList.remove('is-pressing');
      pill.classList.add('is-settling');
      clearTimeout(host._prismPressTimer);
      host._prismPressTimer = setTimeout(function () {
        pill.classList.remove('is-settling');
      }, 360);
    }
  }

  function bindPillPress(host) {
    if (host._prismPressBound) return;
    host._prismPressBound = true;

    host.addEventListener('pointerdown', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn || !host.contains(btn) || btn.disabled) return;
      setPillPress(host, true);
    });

    host.addEventListener('pointerup', function () {
      setPillPress(host, false);
    });
    host.addEventListener('pointerleave', function (ev) {
      // Only release when pointer leaves the whole host while pressed
      if (ev.buttons) setPillPress(host, false);
    });
    host.addEventListener('pointercancel', function () {
      setPillPress(host, false);
    });
  }

  function attachHost(host) {
    if (!host || host._prismLensAttached) return;
    host._prismLensAttached = true;
    var pill = ensurePill(host);
    hosts.push(host);
    bindPillPress(host);

    var mo = new MutationObserver(function (mutations) {
      if (host._prismLensMoving) return;
      if (!mutationsAffectButtons(mutations, pill)) return;
      movePill(host, false);
    });
    // Only class + childList — never observe style (avoids boot freeze)
    mo.observe(host, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
    host._prismLensMo = mo;

    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(function () {
        if (host._prismLensMoving) return;
        movePill(host, true);
      });
      ro.observe(host);
      host._prismLensRo = ro;
    }

    host.addEventListener('click', function () {
      requestAnimationFrame(function () { movePill(host, false); });
    });

    movePill(host, true);
  }

  function scan() {
    try {
      var selectors = [
        '#login-modal #login-platform-tabs',
        '#login-modal .login-method-menu',
        '#fx-panel .fx-seg'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var nodes = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < nodes.length; j++) attachHost(nodes[j]);
      }
      syncAllFills();
      for (var k = 0; k < hosts.length; k++) movePill(hosts[k], false);
    } catch (e) {
      console.warn('[prismal-chrome] scan failed:', e);
    }
  }

  function boot() {
    bindRangeInteractions();
    document.addEventListener('pointerup', function () {
      for (var i = 0; i < hosts.length; i++) setPillPress(hosts[i], false);
    }, true);
    var run = function () {
      scan();
      setTimeout(scan, 700);
      setTimeout(syncAllFills, 1600);
    };
    if (document.body && document.body.classList.contains('splash-active')) {
      setTimeout(run, 1200);
    } else {
      setTimeout(run, 0);
    }
    window.addEventListener('resize', function () {
      for (var i = 0; i < hosts.length; i++) movePill(hosts[i], true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.MineradioPrismalChrome = {
    refresh: scan,
    syncRangeFill: syncRangeFill,
    syncFills: syncAllFills
  };
})();
