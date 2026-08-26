var controlGlassState = { key: '', searchBoxKey: '', searchPillKey: '' };
function normalizeControlGlassChromaticOffset(value) {
  var n = Number(value);
  if (!isFinite(n)) n = fxDefaults.controlGlassChromaticOffset;
  return clampRange(n, 0, 140);
}
function applyControlGlassChromaticOffset() {
  if (!fx) return;
  fx.controlGlassChromaticOffset = normalizeControlGlassChromaticOffset(fx.controlGlassChromaticOffset);
  var filter = document.getElementById('mineradio-control-glass-filter');
  if (!filter) return;
  var dx = String(-Math.round(fx.controlGlassChromaticOffset));
  filter.querySelectorAll('feOffset').forEach(function(node){
    node.setAttribute('dx', dx);
    node.setAttribute('dy', '0');
  });
}
function supportsControlGlassSvgFilter() {
  try {
    var ua = navigator.userAgent || '';
    if ((/Safari/.test(ua) && !/Chrome/.test(ua)) || /Firefox/.test(ua)) return false;
    var div = document.createElement('div');
    div.style.backdropFilter = 'url(#mineradio-control-glass-filter)';
    return div.style.backdropFilter !== '';
  } catch (e) {
    return false;
  }
}
function generateControlGlassDisplacementMap(width, height, radius) {
  width = Math.max(240, Math.round(width || 400));
  height = Math.max(48, Math.round(height || 92));
  radius = Math.max(12, Math.round(radius || 50));
  var borderWidth = 0.07;
  var edge = Math.min(width, height) * (borderWidth * 0.5);
  var innerW = Math.max(1, width - edge * 2);
  var innerH = Math.max(1, height - edge * 2);
  var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="glass-red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
    '<linearGradient id="glass-blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
    '</defs>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="black"/>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="url(#glass-red)"/>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="url(#glass-blue)" style="mix-blend-mode:difference"/>' +
    '<rect x="' + edge.toFixed(2) + '" y="' + edge.toFixed(2) + '" width="' + innerW.toFixed(2) + '" height="' + innerH.toFixed(2) + '" rx="' + radius + '" fill="hsl(0 0% 50% / 1)" style="filter:blur(11px)"/>' +
    '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function updateGlassDisplacementMapForElement(el, img, stateKey) {
  if (!el || !img) return;
  var rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  var radius = parseFloat(getComputedStyle(el).borderRadius) || 24;
  var key = Math.round(rect.width) + 'x' + Math.round(rect.height) + ':' + Math.round(radius);
  if (key === controlGlassState[stateKey]) return;
  controlGlassState[stateKey] = key;
  var href = generateControlGlassDisplacementMap(rect.width, rect.height, radius);
  img.setAttribute('href', href);
  try { img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href); } catch (e) {}
}
function updateControlGlassDisplacementMap() {
  if (document.documentElement.classList.contains('lg-controls-webgl')) return;
  updateGlassDisplacementMapForElement(
    document.getElementById('bottom-bar'),
    document.getElementById('control-glass-map'),
    'key'
  );
}
function updateSearchBoxGlassDisplacementMap() {
  if (document.documentElement.classList.contains('lg-controls-webgl')) return;
  updateGlassDisplacementMapForElement(
    document.getElementById('search-box'),
    document.getElementById('search-box-glass-map'),
    'searchBoxKey'
  );
}
function updateSearchPillGlassDisplacementMap() {
  var img = document.getElementById('search-pill-glass-map');
  if (!img) return;
  var nodes = Array.prototype.slice.call(document.querySelectorAll('.search-mode-tabs button,.search-history-chip'));
  if (!nodes.length) return;
  var maxW = 0, maxH = 0, maxRadius = 14;
  nodes.forEach(function(el){
    if (!el || el.offsetParent === null) return;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    maxW = Math.max(maxW, rect.width);
    maxH = Math.max(maxH, rect.height);
    maxRadius = Math.max(maxRadius, parseFloat(getComputedStyle(el).borderRadius) || Math.round(rect.height / 2) || 14);
  });
  if (maxW < 2 || maxH < 2) return;
  var width = Math.max(96, Math.round(maxW));
  var height = Math.max(32, Math.round(maxH));
  var radius = Math.max(12, Math.min(Math.round(maxRadius), Math.round(height / 2) + 10));
  var key = width + 'x' + height + ':' + radius;
  if (key === controlGlassState.searchPillKey) return;
  controlGlassState.searchPillKey = key;
  var href = generateControlGlassDisplacementMap(width, height, radius);
  img.setAttribute('href', href);
  try { img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href); } catch (e) {}
}
function initControlGlassSurface() {
  if (supportsControlGlassSvgFilter()) document.documentElement.classList.add('control-glass-svg-ok');
  applyControlGlassChromaticOffset();
  updateControlGlassDisplacementMap();
  updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  var bar = document.getElementById('bottom-bar');
  var searchBox = document.getElementById('search-box');
  var searchTabs = document.getElementById('search-mode-tabs');
  var searchResults = document.getElementById('search-results');
  if (window.ResizeObserver && (bar || searchBox || searchTabs || searchResults)) {
    var ro = new ResizeObserver(function(){
      requestAnimationFrame(function() {
        updateControlGlassDisplacementMap();
        updateSearchBoxGlassDisplacementMap();
        updateSearchPillGlassDisplacementMap();
      });
    });
    if (bar) ro.observe(bar);
    if (searchBox) ro.observe(searchBox);
    if (searchTabs) ro.observe(searchTabs);
    if (searchResults) ro.observe(searchResults);
  }
  if (window.MutationObserver && (searchTabs || searchResults)) {
    var mo = new MutationObserver(function(){
      requestAnimationFrame(updateSearchPillGlassDisplacementMap);
    });
    if (searchTabs) mo.observe(searchTabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (searchResults) mo.observe(searchResults, { childList: true, subtree: true });
  }
  window.addEventListener('resize', debounce(function(){
    requestAnimationFrame(function() {
      updateControlGlassDisplacementMap();
      updateSearchBoxGlassDisplacementMap();
      updateSearchPillGlassDisplacementMap();
    });
  }, 100));
}

function bindPlayerControlAnimations() {
  if (!window.gsap) return;
  document.querySelectorAll('#bottom-bar .ctrl-btn').forEach(function(btn){
    if (!btn || btn.dataset.controlAnimBound === '1') return;
    btn.dataset.controlAnimBound = '1';
    var isPlay = btn.id === 'play-btn';
    var iconTarget = btn.querySelector('svg,.lyrics-word-icon,#quality-btn-label');
    var M = window.MineradioMotion;
    // btn 的 hover/press/release 交真 spring（persist 持续托管，settle 后保留内联 transform 避免 :hover 闪烁）；
    // icon 保留 GSAP——clickPulse 也用 GSAP rotate，同一元素不混用两套引擎以免互踩。
    function springBtn(scaleVal, yVal, preset) {
      if (M) {
        M.springTo(btn, 'scale', scaleVal, { preset: preset, persist: true });
        M.springTo(btn, 'y', yVal, { preset: preset, persist: true });
      } else {
        window.gsap.to(btn, { y: yVal, scale: scaleVal, duration: 0.20, ease: 'power2.out', overwrite: 'auto' });
      }
    }
    function canAnimate() {
      return !btn.disabled && !btn.classList.contains('busy');
    }
    function hoverIn(e) {
      if (!canAnimate() || (e && e.pointerType === 'touch')) return;
      springBtn(isPlay ? 1.07 : 1.08, -2, M ? M.SPRING.standard : null);
      if (iconTarget) window.gsap.to(iconTarget, { scale: isPlay ? 1.08 : 1.10, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
    }
    function hoverOut() {
      springBtn(1, 0, M ? M.SPRING.standard : null);
      if (iconTarget) window.gsap.to(iconTarget, { scale: 1, rotate: 0, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
    }
    function pressDown() {
      if (!canAnimate()) return;
      springBtn(isPlay ? 0.91 : 0.90, 0, M ? M.SPRING.snappy : null);
      if (iconTarget) window.gsap.to(iconTarget, { scale: 0.88, duration: 0.10, ease: 'power2.out', overwrite: 'auto' });
    }
    function release(e) {
      if (!canAnimate()) return;
      var hovered = e && e.pointerType !== 'touch' && btn.matches(':hover');
      springBtn(hovered ? (isPlay ? 1.07 : 1.08) : 1, hovered ? -2 : 0, M ? M.SPRING.bouncy : null);
      if (iconTarget) window.gsap.to(iconTarget, { scale: hovered ? 1.06 : 1, duration: 0.22, ease: 'back.out(1.8)', overwrite: 'auto' });
    }
    function clickPulse() {
      if (!canAnimate() || btn.id === 'play-mode-btn') return;
      var pulseSize = isPlay ? 18 : 10;
      var pulseColor = isPlay ? 'rgba(255,63,85,.34)' : 'rgba(255,255,255,.22)';
      window.gsap.killTweensOf(btn, 'boxShadow');
      window.gsap.fromTo(btn,
        { boxShadow: '0 0 0 0 ' + pulseColor },
        { boxShadow: '0 0 0 ' + pulseSize + 'px rgba(255,63,85,0)', duration: isPlay ? 0.58 : 0.42, ease: 'sine.out', overwrite: false, onComplete: function(){ window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
      );
      if (iconTarget) window.gsap.fromTo(iconTarget, { rotate: isPlay ? 0 : -5 }, { rotate: 0, duration: 0.34, ease: 'elastic.out(1,0.55)', overwrite: 'auto' });
    }
    btn.addEventListener('pointerenter', hoverIn);
    btn.addEventListener('pointerleave', hoverOut);
    btn.addEventListener('pointercancel', hoverOut);
    btn.addEventListener('mousedown', function(e){ e.preventDefault(); });
    btn.addEventListener('pointerdown', pressDown);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('click', clickPulse);
    btn.addEventListener('focus', function(){ hoverIn(); });
    btn.addEventListener('blur', hoverOut);
  });
}

function clearPlayerControlFocusState(reason) {
  try {
    document.querySelectorAll('#bottom-bar .ctrl-btn').forEach(function(btn){
      if (!btn) return;
      if (document.activeElement === btn) btn.blur();
      btn.classList.remove('focus-visible');
      if (window.gsap) {
        window.gsap.killTweensOf(btn);
        if (window.MineradioMotion) window.MineradioMotion.killAll(btn); // 停 btn 的 spring，交还 transform 给 GSAP set
        window.gsap.set(btn, { y: 0, scale: 1, rotate: 0, clearProps: 'boxShadow' });
        var iconTarget = btn.querySelector('svg,.lyrics-word-icon,#quality-btn-label');
        if (iconTarget) {
          window.gsap.killTweensOf(iconTarget);
          window.gsap.set(iconTarget, { scale: 1, rotate: 0 });
        }
      } else {
        if (window.MineradioMotion) window.MineradioMotion.killAll(btn);
        btn.style.transform = '';
        btn.style.boxShadow = '';
      }
    });
  } catch (e) {
    console.warn('[ControlFocusClear]', reason || 'unknown', e);
  }
}
