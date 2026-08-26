'use strict';

function getLiquidGlassConfigFromFx() {
  var fx = window.fx || {};
  var defaults = {
    blurAmount: 0.70,
    refraction: 0.18,
    chromAberration: 0.0,
    edgeHighlight: 0.12,
    specular: 0.05,
    fresnel: 1.0,
    cornerRadius: 18,
    zRadius: 10,
    shadowOpacity: 0.42,
    shadowSpread: 22,
    shadowOffsetY: 4,
    saturation: 0.34,
    brightness: 0.04,
    tintStrength: 0.0,
    bevelMode: 0
  };
  return {
    blurAmount: fx.liquidGlassBlur != null ? Number(fx.liquidGlassBlur) : defaults.blurAmount,
    refraction: fx.liquidGlassRefraction != null ? Number(fx.liquidGlassRefraction) : defaults.refraction,
    chromAberration: fx.liquidGlassAberration != null ? Number(fx.liquidGlassAberration) : defaults.chromAberration,
    edgeHighlight: fx.liquidGlassHighlight != null ? Number(fx.liquidGlassHighlight) : defaults.edgeHighlight,
    specular: defaults.specular,
    fresnel: defaults.fresnel,
    cornerRadius: defaults.cornerRadius,
    zRadius: fx.liquidGlassBevel != null ? Number(fx.liquidGlassBevel) : defaults.zRadius,
    shadowOpacity: defaults.shadowOpacity,
    shadowSpread: defaults.shadowSpread,
    shadowOffsetY: defaults.shadowOffsetY,
    saturation: fx.liquidGlassSaturation != null ? Number(fx.liquidGlassSaturation) : defaults.saturation,
    brightness: fx.liquidGlassBrightness != null ? Number(fx.liquidGlassBrightness) : defaults.brightness,
    tintStrength: defaults.tintStrength,
    bevelMode: defaults.bevelMode
  };
}
window.getLiquidGlassConfigFromFx = getLiquidGlassConfigFromFx;

function getLiquidGlassProfile() {
  return window.__mineradioLiquidGlassProfile || null;
}

function getLiquidGlassSurfaceOverrides() {
  return window.__mineradioLiquidGlassSurfaceOverrides || {};
}

function applyLiquidGlassProfile(cfg, surfaceKey) {
  if (!cfg) return cfg;
  var out = Object.assign({}, cfg);
  var profile = getLiquidGlassProfile() || {};
  var overrides = getLiquidGlassSurfaceOverrides()[surfaceKey] || {};

  function scale(key, factor) {
    if (factor == null) return;
    var num = Number(factor);
    if (!isFinite(num)) return;
    if (out[key] == null || !isFinite(Number(out[key]))) return;
    out[key] = Number(out[key]) * num;
  }

  scale('blurAmount', profile.blurMultiplier);
  scale('refraction', profile.refractionMultiplier);
  scale('chromAberration', profile.chromAberrationMultiplier);
  scale('edgeHighlight', profile.edgeHighlightMultiplier);
  scale('specular', profile.specularMultiplier);
  scale('fresnel', profile.fresnelMultiplier);
  scale('saturation', profile.saturationMultiplier);
  scale('brightness', profile.brightnessMultiplier);
  scale('shadowOpacity', profile.shadowMultiplier);
  scale('shadowSpread', profile.shadowSpreadMultiplier);
  scale('shadowOffsetY', profile.shadowOffsetYMultiplier);
  scale('zRadius', profile.zRadiusMultiplier);
  scale('cornerRadius', profile.cornerRadiusMultiplier);
  scale('tintStrength', profile.tintStrengthMultiplier);

  if (profile.blurDelta != null) out.blurAmount = Number(out.blurAmount || 0) + Number(profile.blurDelta);
  if (profile.refractionDelta != null) out.refraction = Number(out.refraction || 0) + Number(profile.refractionDelta);
  if (profile.brightnessDelta != null) out.brightness = Number(out.brightness || 0) + Number(profile.brightnessDelta);
  if (profile.cornerRadiusDelta != null) out.cornerRadius = Math.max(0, Number(out.cornerRadius || 0) + Number(profile.cornerRadiusDelta));
  if (profile.zRadiusDelta != null) out.zRadius = Math.max(0, Number(out.zRadius || 0) + Number(profile.zRadiusDelta));
  if (profile.shadowSpreadDelta != null) out.shadowSpread = Math.max(0, Number(out.shadowSpread || 0) + Number(profile.shadowSpreadDelta));
  if (profile.shadowOffsetYDelta != null) out.shadowOffsetY = Number(out.shadowOffsetY || 0) + Number(profile.shadowOffsetYDelta);
  if (profile.disableChromAberration) out.chromAberration = 0;
  if (profile.disableTintStrength) out.tintStrength = 0;
  if (profile.forceBlur != null) out.blurAmount = Number(profile.forceBlur);
  if (profile.forceRefraction != null) out.refraction = Number(profile.forceRefraction);
  if (profile.forceSaturation != null) out.saturation = Number(profile.forceSaturation);
  if (profile.forceBrightness != null) out.brightness = Number(profile.forceBrightness);

  Object.keys(profile.overrides || {}).forEach(function (key) {
    if (profile.overrides[key] != null) out[key] = profile.overrides[key];
  });
  Object.keys(overrides || {}).forEach(function (key) {
    if (overrides[key] != null) out[key] = overrides[key];
  });
  return out;
}

window.applyLiquidGlassProfile = applyLiquidGlassProfile;

function applyHomeLiquidGlassConfig() {
  var cfg = applyLiquidGlassProfile(getLiquidGlassConfigFromFx(), 'home');
  var blurPx = Math.round(6 + cfg.blurAmount * 24);
  var sat = (1 + cfg.saturation * 2).toFixed(2);
  var bri = (0.94 + cfg.brightness).toFixed(2);
  var filter = 'blur(' + blurPx + 'px) saturate(' + sat + ') brightness(' + bri + ')';
  var boxShadow = '0 16px 48px rgba(0,0,0,.34),0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.10),inset 0 -12px 28px rgba(0,0,0,.18)';
  var els = document.querySelectorAll('.home-card, .home-tile, .home-mosaic-cell');
  // 注意：不使用 inline !important，否则会盖住 fx-glass.css 里 body.lg-degraded .home-card.lg-active
  // 的 !important 降级磨砂背景，导致 WebGL 失败时卡片透明落回黑色。
  // background 不在这里写死 transparent：lg-active 时由 activateHomeGlass 写普通 inline，
  // 降级时由 CSS !important 接管。
  els.forEach(function(el) {
    el.style.setProperty('backdrop-filter', filter);
    el.style.setProperty('-webkit-backdrop-filter', filter);
    el.style.setProperty('box-shadow', boxShadow);
    el.style.setProperty('border-color', 'transparent');
    el.dataset.lgConfig = JSON.stringify(cfg);
  });
}
window.applyHomeLiquidGlassConfig = applyHomeLiquidGlassConfig;

function ensureLiquidGlassRunning(instance) {
  if (!instance) return;
  try {
    instance._running = true;
    if (instance._globalDirty !== undefined) instance._globalDirty = true;
    if (typeof instance._renderLoop === 'function' && !instance._rafId) {
      instance._rafId = requestAnimationFrame(function () { instance._renderLoop(); });
    }
  } catch (_) {}
}
window.ensureLiquidGlassRunning = ensureLiquidGlassRunning;

function liquidGlassInstanceAlive(instance, elements) {
  if (!instance) return false;
  var els = elements || [];
  for (var i = 0; i < els.length; i++) {
    if (els[i] && els[i].querySelector && els[i].querySelector('canvas')) return true;
  }
  return false;
}

// LiquidGlass 要求 glass 必须是 root 的直接子节点。把 #bottom-bar / #search-box
// 既当 root 又当 glass 会被跳过，结果长期落在 SVG displacement。
// 这里插入空的 backdrop shell：Background(抓屏) → Glass(shell/canvas) → Content(其余 DOM)。
function ensureLiquidGlassBackdropShell(host, shellClass) {
  if (!host) return null;
  var cls = shellClass || 'lg-glass-shell';
  var shell = host.querySelector(':scope > .' + cls);
  if (!shell) {
    shell = document.createElement('div');
    shell.className = cls;
    shell.setAttribute('aria-hidden', 'true');
    host.insertBefore(shell, host.firstChild);
  }
  try {
    var pos = window.getComputedStyle(host).position;
    if (pos === 'static') host.style.position = 'relative';
  } catch (_) {}
  host.classList.add('lg-host');
  return shell;
}

function syncLiquidGlassCornerRadius(host, cfg) {
  var out = Object.assign({}, cfg || {});
  if (!host) return out;
  try {
    var radius = parseFloat(window.getComputedStyle(host).borderRadius);
    if (isFinite(radius) && radius > 0) out.cornerRadius = radius;
  } catch (_) {}
  // tisc：双界面折射（biconvex）
  out.bevelMode = 0;
  return out;
}

function refreshControlsWebglPreferFlag() {
  try {
    var prefer = !!(
      (document.getElementById('bottom-bar') && document.getElementById('bottom-bar').classList.contains('lg-active')) ||
      (document.getElementById('search-box') && document.getElementById('search-box').classList.contains('lg-active'))
    );
    document.documentElement.classList.toggle('lg-controls-webgl', prefer);
  } catch (_) {}
}

window.ensureLiquidGlassBackdropShell = ensureLiquidGlassBackdropShell;

// === fx-panel 预热机制 ===
function bootstrapLiquidGlass() {
  if (!window.LiquidGlass) { console.warn('LiquidGlass lib not loaded, retry in 1s'); setTimeout(bootstrapLiquidGlass, 1000); return; }
  var LiquidGlass = window.LiquidGlass;
  var mgr = new window.LiquidGlassManager();
  window._liquidGlassMgr = mgr;

  // 预热: fx-panel（backdrop shell，避免 glass===root 被跳过）
  var fxPanel = document.getElementById('fx-panel');
  if (fxPanel) {
    var fxState = 'idle';
    var fxInstance = null;
    var fxCfg = null;
    var fxShell = ensureLiquidGlassBackdropShell(fxPanel, 'lg-glass-shell');

    function buildFxCfg() {
      var fxPreset = window.LiquidGlassPresets && window.LiquidGlassPresets.fxPanel
        ? window.LiquidGlassPresets.fxPanel : {};
      var cfg = Object.assign({}, fxPreset);
      var fx = window.fx || {};
      if (fx.liquidGlassBlur != null) cfg.blurAmount = Number(fx.liquidGlassBlur);
      if (fx.liquidGlassRefraction != null) cfg.refraction = Number(fx.liquidGlassRefraction);
      if (fx.liquidGlassAberration != null) cfg.chromAberration = Number(fx.liquidGlassAberration);
      if (fx.liquidGlassHighlight != null) cfg.edgeHighlight = Number(fx.liquidGlassHighlight);
      if (fx.liquidGlassSaturation != null) cfg.saturation = Number(fx.liquidGlassSaturation);
      if (fx.liquidGlassBrightness != null) cfg.brightness = Number(fx.liquidGlassBrightness);
      if (fx.liquidGlassBevel != null) cfg.zRadius = Number(fx.liquidGlassBevel);
      cfg = applyLiquidGlassProfile(cfg, 'fxPanel');
      return syncLiquidGlassCornerRadius(fxPanel, cfg);
    }

    window.applyFxLiquidGlassConfig = function () {
      if (!fxInstance || !fxShell) return;
      var newCfg = buildFxCfg();
      fxCfg = newCfg;
      fxShell.dataset.config = JSON.stringify(newCfg);
      fxInstance.markChanged(fxShell);
      if (fxInstance._globalDirty !== undefined) fxInstance._globalDirty = true;
      if (fxInstance._glassContentDirty && fxInstance._glassContentDirty.add) {
        fxInstance._glassContentDirty.add(fxShell);
      }
    };

    function warmupFxGlass() {
      if (fxState !== 'idle' || !fxShell) return;
      fxState = 'warming';
      fxCfg = buildFxCfg();
      LiquidGlass.init({
        root: fxPanel,
        glassElements: [fxShell],
        defaults: {
          cornerRadius: fxCfg.cornerRadius || 18,
          zRadius: fxCfg.zRadius || 10,
          bevelMode: 0,
          opacity: 1,
          distortion: 0
        }
      }).then(function (instance) {
        fxInstance = instance;
        fxShell.dataset.config = JSON.stringify(fxCfg);
        fxState = 'ready';
        console.log('[LiquidGlass] FX panel pre-warmed (shell)');
        var canvas = fxShell.querySelector('canvas');
        if (canvas) {
          canvas.addEventListener('webglcontextlost', function(e) {
            console.warn('[LiquidGlass] FX panel WebGL context lost, re-warming...');
            e.preventDefault();
            fxState = 'idle';
            fxInstance = null;
            fxPanel.classList.remove('lg-active', 'lg-loading');
            if (fxShell) fxShell.classList.remove('lg-active');
            setTimeout(warmupFxGlass, 300);
          }, { once: true });
        }
        if (fxPanel.classList.contains('show') || fxPanel.classList.contains('peek')) {
          activateFxGlass();
        }
      }).catch(function (e) {
        console.warn('[LiquidGlass] FX panel warmup failed:', e);
        fxState = 'idle';
      });
    }

    function activateFxGlass() {
      if (fxState === 'active') return;
      if (fxState === 'ready' && fxInstance && fxShell) {
        fxPanel.style.background = 'transparent';
        fxPanel.style.backdropFilter = 'none';
        fxPanel.style.webkitBackdropFilter = 'none';
        fxPanel.classList.remove('lg-loading');
        fxPanel.classList.add('lg-active');
        fxShell.classList.add('lg-active');
        fxState = 'active';
        mgr._instances.fxPanel = {
          instance: fxInstance,
          elements: [fxShell],
          config: fxCfg,
          root: fxPanel,
          presetName: 'fxPanel'
        };
        fxInstance.markChanged(fxShell);
      } else if (fxState === 'idle') {
        fxPanel.classList.add('lg-loading');
        warmupFxGlass();
      }
    }

    function deactivateFxGlass() {
      if (fxState !== 'active') return;
      fxPanel.style.background = '';
      fxPanel.style.backdropFilter = '';
      fxPanel.style.webkitBackdropFilter = '';
      fxPanel.style.borderColor = '';
      fxPanel.style.boxShadow = '';
      fxPanel.style.maxHeight = '';
      fxPanel.style.overflow = '';
      fxPanel.classList.remove('lg-active', 'lg-loading');
      if (fxShell) fxShell.classList.remove('lg-active');
      delete mgr._instances.fxPanel;
      fxState = fxInstance ? 'ready' : 'idle';
    }

    var fxObserver = new MutationObserver(function () {
      if (fxPanel.classList.contains('show') || fxPanel.classList.contains('peek')) {
        activateFxGlass();
      } else if (fxPanel.classList.contains('closing') || (!fxPanel.classList.contains('show') && !fxPanel.classList.contains('peek'))) {
        setTimeout(function () {
          if (!fxPanel.classList.contains('show') && !fxPanel.classList.contains('peek')) {
            deactivateFxGlass();
          }
        }, 600);
      }
    });
    fxObserver.observe(fxPanel, { attributes: true, attributeFilter: ['class'] });

    function scheduleWarmup() {
      if (fxState !== 'idle') return;
      if ('requestIdleCallback' in window) {
        requestIdleCallback(warmupFxGlass, { timeout: 2500 });
      } else {
        setTimeout(warmupFxGlass, 1500);
      }
    }

    if (fxPanel.classList.contains('show') || fxPanel.classList.contains('peek')) {
      warmupFxGlass();
    } else {
      scheduleWarmup();
    }
  }

  // === 搜索框 #search-box：常驻 LiquidGlass（backdrop shell = glass） ===
  var searchBox = document.getElementById('search-box');
  if (searchBox) {
    var sbState = 'idle';
    var sbInstance = null;
    var sbCfg = null;
    var sbShell = ensureLiquidGlassBackdropShell(searchBox, 'lg-glass-shell');

    function buildSearchCfg() {
      var preset = window.LiquidGlassPresets && window.LiquidGlassPresets.searchBox
        ? window.LiquidGlassPresets.searchBox : {};
      var cfg = Object.assign({}, preset);
      var fx = window.fx || {};
      if (fx.liquidGlassBlur != null) cfg.blurAmount = Number(fx.liquidGlassBlur);
      if (fx.liquidGlassRefraction != null) cfg.refraction = Number(fx.liquidGlassRefraction);
      if (fx.liquidGlassAberration != null) cfg.chromAberration = Number(fx.liquidGlassAberration);
      if (fx.liquidGlassHighlight != null) cfg.edgeHighlight = Number(fx.liquidGlassHighlight);
      if (fx.liquidGlassSaturation != null) cfg.saturation = Number(fx.liquidGlassSaturation);
      if (fx.liquidGlassBrightness != null) cfg.brightness = Number(fx.liquidGlassBrightness);
      if (fx.liquidGlassBevel != null) cfg.zRadius = Number(fx.liquidGlassBevel);
      cfg = applyLiquidGlassProfile(cfg, 'searchBox');
      return syncLiquidGlassCornerRadius(searchBox, cfg);
    }

    function warmupSearchGlass() {
      if (sbState !== 'idle' || !sbShell) return;
      sbState = 'warming';
      sbCfg = buildSearchCfg();
      LiquidGlass.init({
        root: searchBox,
        glassElements: [sbShell],
        defaults: {
          cornerRadius: sbCfg.cornerRadius || 22,
          zRadius: sbCfg.zRadius || 10,
          bevelMode: 0,
          opacity: 1,
          distortion: 0
        }
      }).then(function (instance) {
        sbInstance = instance;
        sbShell.dataset.config = JSON.stringify(sbCfg);
        sbState = 'ready';
        console.log('[LiquidGlass] Search box pre-warmed (shell)');
        activateSearchGlass();
      }).catch(function (e) {
        console.warn('[LiquidGlass] Search box warmup failed:', e);
        sbState = 'idle';
      });
    }

    function activateSearchGlass() {
      if (sbState === 'active') return;
      if (sbState === 'ready' && sbInstance && sbShell) {
        searchBox.style.background = 'transparent';
        searchBox.style.backdropFilter = 'none';
        searchBox.style.webkitBackdropFilter = 'none';
        searchBox.classList.add('lg-active');
        sbShell.classList.add('lg-active');
        sbState = 'active';
        refreshControlsWebglPreferFlag();
        mgr.register('searchBox', {
          instance: sbInstance,
          elements: [sbShell],
          config: sbCfg,
          root: searchBox,
          presetName: 'searchBox'
        });
        sbInstance.markChanged(sbShell);
      } else if (sbState === 'idle') {
        searchBox.classList.add('lg-loading');
        warmupSearchGlass();
      }
    }

    window.applySearchLiquidGlassConfig = function () {
      if (!sbInstance || !sbShell) return;
      var newCfg = buildSearchCfg();
      sbCfg = newCfg;
      sbShell.dataset.config = JSON.stringify(newCfg);
      sbInstance.markChanged(sbShell);
      if (sbInstance._globalDirty !== undefined) sbInstance._globalDirty = true;
      if (sbInstance._glassContentDirty && sbInstance._glassContentDirty.add) {
        sbInstance._glassContentDirty.add(sbShell);
      }
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(warmupSearchGlass, { timeout: 3000 });
    } else {
      setTimeout(warmupSearchGlass, 2000);
    }
  }

  // === 首页卡片：root=.home-grid，glass 必须是其直接子节点（库硬约束）===
  var homeGrid = document.querySelector('.home-grid');
  function collectHomeGlassElements(root) {
    if (!root) return [];
    return Array.prototype.filter.call(root.children || [], function (el) {
      return el && el.classList && (
        el.classList.contains('home-card') ||
        el.classList.contains('home-tile') ||
        el.classList.contains('home-mosaic-cell')
      );
    });
  }
  var homeCards = collectHomeGlassElements(homeGrid);
  if (homeGrid && homeCards.length) {
    var homeState = 'idle';
    var homeInstance = null;
    var homeCfg = null;

    function buildHomeCfg() {
      var preset = window.LiquidGlassPresets && window.LiquidGlassPresets.homeCard
        ? window.LiquidGlassPresets.homeCard : {};
      var cfg = Object.assign({}, preset);
      var fx = window.fx || {};
      if (fx.liquidGlassBlur != null) cfg.blurAmount = Number(fx.liquidGlassBlur);
      if (fx.liquidGlassRefraction != null) cfg.refraction = Number(fx.liquidGlassRefraction);
      if (fx.liquidGlassAberration != null) cfg.chromAberration = Number(fx.liquidGlassAberration);
      if (fx.liquidGlassHighlight != null) cfg.edgeHighlight = Number(fx.liquidGlassHighlight);
      if (fx.liquidGlassSaturation != null) cfg.saturation = Number(fx.liquidGlassSaturation);
      if (fx.liquidGlassBrightness != null) cfg.brightness = Number(fx.liquidGlassBrightness);
      if (fx.liquidGlassBevel != null) cfg.zRadius = Number(fx.liquidGlassBevel);
      return applyLiquidGlassProfile(cfg, 'home');
    }

    window.applyHomeLiquidGlassCardConfig = function () {
      if (!homeInstance) return;
      var newCfg = buildHomeCfg();
      homeCfg = newCfg;
      homeCards = collectHomeGlassElements(homeGrid);
      homeCards.forEach(function (el) {
        el.dataset.config = JSON.stringify(newCfg);
        homeInstance.markChanged(el);
      });
      if (homeInstance._globalDirty !== undefined) homeInstance._globalDirty = true;
      if (homeInstance._glassContentDirty && homeInstance._glassContentDirty.add) {
        homeCards.forEach(function (el) { homeInstance._glassContentDirty.add(el); });
      }
    };

    function warmupHomeGlass() {
      if (homeState !== 'idle') return;
      homeCards = collectHomeGlassElements(homeGrid);
      if (!homeCards.length) return;
      homeState = 'warming';
      homeCfg = buildHomeCfg();
      LiquidGlass.init({
        root: homeGrid,
        glassElements: homeCards.slice(),
        defaults: {
          cornerRadius: homeCfg.cornerRadius || 18,
          zRadius: homeCfg.zRadius || 10,
          opacity: 1,
          distortion: 0
        }
      }).then(function (instance) {
        homeInstance = instance;
        homeCards.forEach(function (el) {
          el.dataset.config = JSON.stringify(homeCfg);
        });
        homeState = 'ready';
        console.log('[LiquidGlass] Home cards pre-warmed');
        activateHomeGlass();
      }).catch(function (e) {
        console.warn('[LiquidGlass] Home cards warmup failed:', e);
        homeState = 'idle';
      });
    }

    function activateHomeGlass() {
      if (document.body.classList.contains('splash-active')) return;
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) {
        // 降级交给 CSS 回退；勿 destroy 实例，否则恢复后卡片透明失效
        if (homeInstance) {
          homeInstance._running = false;
          if (homeInstance._rafId) {
            try { cancelAnimationFrame(homeInstance._rafId); } catch (_) {}
            homeInstance._rafId = null;
          }
        }
        return;
      }
      if (homeState === 'active' && homeInstance) {
        ensureLiquidGlassRunning(homeInstance);
        return;
      }
      if (homeState === 'ready' && homeInstance) {
        if (!liquidGlassInstanceAlive(homeInstance, homeCards)) {
          homeInstance = null;
          homeState = 'idle';
          warmupHomeGlass();
          return;
        }
        homeCards.forEach(function (el) {
          el.style.background = 'transparent';
          el.style.backdropFilter = 'none';
          el.style.webkitBackdropFilter = 'none';
          el.classList.add('lg-active');
          homeInstance.markChanged(el);
        });
        homeState = 'active';
        ensureLiquidGlassRunning(homeInstance);
        mgr.register('homeCard', {
          instance: homeInstance,
          elements: homeCards.slice(),
          config: homeCfg,
          root: homeGrid,
          presetName: 'homeCard'
        });
      } else if (homeState === 'idle') {
        warmupHomeGlass();
      }
    }

    function deactivateHomeGlass() {
      if (homeState !== 'active') return;
      homeCards.forEach(function (el) {
        el.style.background = '';
        el.style.backdropFilter = '';
        el.style.webkitBackdropFilter = '';
        el.classList.remove('lg-active');
      });
      // 只 detach，勿 unregister/destroy：否则降级恢复后会拿死实例把卡片刷成透明
      if (typeof mgr.detach === 'function') mgr.detach('homeCard');
      else delete mgr._instances.homeCard;
      if (homeInstance) {
        homeInstance._running = false;
        if (homeInstance._rafId) {
          try { cancelAnimationFrame(homeInstance._rafId); } catch (_) {}
          homeInstance._rafId = null;
        }
      }
      homeState = homeInstance ? 'ready' : 'idle';
    }

    var homeObserver = new MutationObserver(function () {
      if (document.body.classList.contains('splash-active')) {
        deactivateHomeGlass();
        return;
      }
      // lg-degraded：保留实例与 lg-active，靠 CSS 藏 canvas；恢复时 restart rAF
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) {
        if (homeInstance) {
          homeInstance._running = false;
          if (homeInstance._rafId) {
            try { cancelAnimationFrame(homeInstance._rafId); } catch (_) {}
            homeInstance._rafId = null;
          }
        }
        return;
      }
      var homeVisible = document.body.classList.contains('empty-home-active')
        || document.body.classList.contains('show-home')
        || document.body.classList.contains('home-ready');
      if (homeVisible) activateHomeGlass();
      else deactivateHomeGlass();
    });
    homeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    window.refreshHomeLiquidGlassAfterPerf = function () {
      if (homeState === 'active' || homeState === 'ready') activateHomeGlass();
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(warmupHomeGlass, { timeout: 3500 });
    } else {
      setTimeout(warmupHomeGlass, 2200);
    }
  }

  // === 底部播放控件 #bottom-bar：visible 时激活（backdrop shell = glass） ===
  var bottomBar = document.getElementById('bottom-bar');
  if (bottomBar) {
    var bbState = 'idle';
    var bbInstance = null;
    var bbCfg = null;
    var bbShell = ensureLiquidGlassBackdropShell(bottomBar, 'lg-glass-shell');

    function buildBottomCfg() {
      var preset = window.LiquidGlassPresets && window.LiquidGlassPresets.bottomBar
        ? window.LiquidGlassPresets.bottomBar : {};
      var cfg = Object.assign({}, preset);
      var fx = window.fx || {};
      if (fx.liquidGlassBlur != null) cfg.blurAmount = Number(fx.liquidGlassBlur);
      if (fx.liquidGlassRefraction != null) cfg.refraction = Number(fx.liquidGlassRefraction);
      if (fx.liquidGlassAberration != null) cfg.chromAberration = Number(fx.liquidGlassAberration);
      if (fx.liquidGlassHighlight != null) cfg.edgeHighlight = Number(fx.liquidGlassHighlight);
      if (fx.liquidGlassSaturation != null) cfg.saturation = Number(fx.liquidGlassSaturation);
      if (fx.liquidGlassBrightness != null) cfg.brightness = Number(fx.liquidGlassBrightness);
      if (fx.liquidGlassBevel != null) cfg.zRadius = Number(fx.liquidGlassBevel);
      cfg = applyLiquidGlassProfile(cfg, 'bottomBar');
      return syncLiquidGlassCornerRadius(bottomBar, cfg);
    }

    function warmupBottomGlass() {
      if (bbState !== 'idle' || !bbShell) return;
      bbState = 'warming';
      bbCfg = buildBottomCfg();
      LiquidGlass.init({
        root: bottomBar,
        glassElements: [bbShell],
        defaults: {
          cornerRadius: bbCfg.cornerRadius || 50,
          zRadius: bbCfg.zRadius || 16,
          bevelMode: 0,
          opacity: 1,
          distortion: 0
        }
      }).then(function (instance) {
        bbInstance = instance;
        bbShell.dataset.config = JSON.stringify(bbCfg);
        bbState = 'ready';
        console.log('[LiquidGlass] Bottom bar pre-warmed (shell)');
        if (bottomBar.classList.contains('visible')) {
          activateBottomGlass();
        }
      }).catch(function (e) {
        console.warn('[LiquidGlass] Bottom bar warmup failed:', e);
        bbState = 'idle';
      });
    }

    function activateBottomGlass() {
      if (bbState === 'active') return;
      if (bbState === 'ready' && bbInstance && bbShell) {
        bottomBar.style.background = 'transparent';
        bottomBar.style.backdropFilter = 'none';
        bottomBar.style.webkitBackdropFilter = 'none';
        bottomBar.classList.add('lg-active');
        bbShell.classList.add('lg-active');
        bbState = 'active';
        refreshControlsWebglPreferFlag();
        mgr.register('bottomBar', {
          instance: bbInstance,
          elements: [bbShell],
          config: bbCfg,
          root: bottomBar,
          presetName: 'bottomBar'
        });
        bbInstance.markChanged(bbShell);
      } else if (bbState === 'idle') {
        bottomBar.classList.add('lg-loading');
        warmupBottomGlass();
      }
    }

    function deactivateBottomGlass() {
      if (bbState !== 'active') return;
      bottomBar.style.background = '';
      bottomBar.style.backdropFilter = '';
      bottomBar.style.webkitBackdropFilter = '';
      bottomBar.classList.remove('lg-active', 'lg-loading');
      if (bbShell) bbShell.classList.remove('lg-active');
      mgr.unregister('bottomBar');
      bbState = bbInstance ? 'ready' : 'idle';
      refreshControlsWebglPreferFlag();
    }

    window.applyBottomLiquidGlassConfig = function () {
      if (!bbInstance || !bbShell) return;
      var newCfg = buildBottomCfg();
      bbCfg = newCfg;
      bbShell.dataset.config = JSON.stringify(newCfg);
      bbInstance.markChanged(bbShell);
      if (bbInstance._globalDirty !== undefined) bbInstance._globalDirty = true;
      if (bbInstance._glassContentDirty && bbInstance._glassContentDirty.add) {
        bbInstance._glassContentDirty.add(bbShell);
      }
    };

    var bbObserver = new MutationObserver(function () {
      if (bottomBar.classList.contains('visible')) {
        activateBottomGlass();
      } else {
        setTimeout(function () {
          if (!bottomBar.classList.contains('visible')) {
            deactivateBottomGlass();
          }
        }, 600);
      }
    });
    bbObserver.observe(bottomBar, { attributes: true, attributeFilter: ['class'] });

    if ('requestIdleCallback' in window) {
      requestIdleCallback(warmupBottomGlass, { timeout: 4000 });
    } else {
      setTimeout(warmupBottomGlass, 2500);
    }
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(function(){ applyHomeLiquidGlassConfig(); bootstrapLiquidGlass(); }, 1500);
} else {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function(){ applyHomeLiquidGlassConfig(); bootstrapLiquidGlass(); }, 1500);
  });
}
