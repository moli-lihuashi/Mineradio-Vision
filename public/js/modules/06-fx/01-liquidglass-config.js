'use strict';

/* 几个玻璃根各自 requestIdleCallback 预热，会挤在同一个空闲窗口里同时建 WebGL 上下文、
 * 同时编译整套着色器 —— 实测「点击进入」后 0~4.5s 的掉帧主要来自这里
 * （同一秒内 getContext 162ms / getProgramParameter 120ms / getShaderParameter 79ms）。
 * 只做错峰、不做串行：仍允许重叠，避免把总时长拉长。槽位按「用户先看到谁」排。 */
var LG_WARM_SLOT_MS = 180;
function staggerGlassWarmup(slot, fn) {
  var delay = Math.max(0, slot | 0) * LG_WARM_SLOT_MS;
  if (delay <= 0) { fn(); return; }
  setTimeout(fn, delay);
}

/* 方案 A：进入主界面时先让 .home-card 自带的 CSS 玻璃（backdrop-filter）顶着，
 * 等主界面稳定 HOME_GLASS_ARM_DELAY_MS 之后再换液态玻璃。
 * 为什么现在才切：LiquidGlass.init() 要建 WebGL 上下文 + 编译整套着色器 + 逐元素抓快照，
 * 实测墙钟 1.2s 起（慢机器更久），而它原来正好落在「splash 淡出 → 主界面首帧」这段窗口里，
 * 表现就是「点进播放器卡几秒」。首页卡片本身有完整 CSS 玻璃（home.css .home-card 的
 * linear-gradient + backdrop-filter:blur(24px)），晚切换零视觉空档。 */
var HOME_GLASS_ARM_DELAY_MS = 1500;

/* 库的 WebGL shader 支持这些参数（见 vendor/liquidglass/index.js 的 DEFAULTS 与 uniform 上传）。
 * 以前上层只暴露 7 项，specular / fresnel / tintStrength / distortion / bevelMode 这些分支
 * 虽然编译进了 shader，却因为永远拿不到非零值而形同虚设。
 * 面板控件、fx 存档归一化、滑块绑定三处都用这张表的 key，新增参数只改这里。 */
var LIQUID_GLASS_FX_MAP = {
  liquidGlassBlur: 'blurAmount',
  liquidGlassRefraction: 'refraction',
  liquidGlassAberration: 'chromAberration',
  liquidGlassHighlight: 'edgeHighlight',
  liquidGlassBrightness: 'brightness',
  liquidGlassBevel: 'zRadius',
  liquidGlassSaturation: 'saturation',
  liquidGlassSpecular: 'specular',
  liquidGlassFresnel: 'fresnel',
  liquidGlassShadow: 'shadowOpacity',
  liquidGlassShadowSpread: 'shadowSpread',
  liquidGlassTint: 'tintStrength',
  liquidGlassDistortion: 'distortion',
  liquidGlassBevelMode: 'bevelMode'
};

var LIQUID_GLASS_DEFAULTS = {
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
  distortion: 0,
  bevelMode: 0,
  opacity: 1
};

/* 统一入口：preset 打底 → fx 里用户调过的逐项覆盖。
 * 五个宿主原来各抄一遍 7 行 if，加参数必漏，现全部收敛到这里。
 * 值必须是有限数：存档里被写坏的 NaN / 字符串不能污染 shader uniform。 */
function liquidGlassFxConfig(base) {
  var out = Object.assign({}, base || {});
  var fx = window.fx || {};
  Object.keys(LIQUID_GLASS_FX_MAP).forEach(function (key) {
    var value = fx[key];
    if (value == null || value === '' || !isFinite(Number(value))) return;
    out[LIQUID_GLASS_FX_MAP[key]] = Number(value);
  });
  return out;
}

function getLiquidGlassConfigFromFx() {
  return liquidGlassFxConfig(LIQUID_GLASS_DEFAULTS);
}
window.getLiquidGlassConfigFromFx = getLiquidGlassConfigFromFx;
window.liquidGlassFxConfig = liquidGlassFxConfig;
window.LIQUID_GLASS_FX_MAP = LIQUID_GLASS_FX_MAP;
window.LIQUID_GLASS_DEFAULTS = LIQUID_GLASS_DEFAULTS;

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
  var els = document.querySelectorAll('.home-card, .home-tile, .home-mosaic-cell, .listening-today-card');
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
  // bevelMode 由 fx.liquidGlassBevelMode 决定，不再强制 0：
  // shader 的 biconvex 双界面折射分支本来就在，以前被这里无条件关掉。
  return out;
}

/* init 的 defaults 也要带全参数：data-config 是在 Promise resolve 之后才写上的，
 * 首帧之前 shader 只看得到 defaults。以前这里写死 bevelMode:0 / distortion:0，
 * 高级参数即使后来进了 data-config，也出现过「首帧不对、要等一次 markChanged」的窗口。 */
function liquidGlassInitDefaults(cfg) {
  return Object.assign({}, LIQUID_GLASS_DEFAULTS, cfg || {});
}
window.liquidGlassInitDefaults = liquidGlassInitDefaults;

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
  // 纯 CSS 液态玻璃模式（#fx-panel.fx-css-glass）：不给这个面板建 WebGL 上下文，
  // 省掉一次 shader 编译 + 一轮 html-to-image 抓屏，也避免 canvas 和 CSS 玻璃叠在一起。
  // 开关只是 HTML 上的一个 class，删掉它就完整回到 WebGL 路径；搜索框 / 底栏 / 首页卡片不受影响。
  var fxPanel = document.getElementById('fx-panel');
  var fxPanelCssGlass = !!(fxPanel && fxPanel.classList.contains('fx-css-glass'));
  if (fxPanel && !fxPanelCssGlass) {
    var fxState = 'idle';
    var fxInstance = null;
    var fxCfg = null;
    var fxShell = ensureLiquidGlassBackdropShell(fxPanel, 'lg-glass-shell');

    function buildFxCfg() {
      var fxPreset = window.LiquidGlassPresets && window.LiquidGlassPresets.fxPanel
        ? window.LiquidGlassPresets.fxPanel : {};
      var cfg = liquidGlassFxConfig(fxPreset);
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
        defaults: liquidGlassInitDefaults(fxCfg)
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

    if (fxPanel.classList.contains('show') || fxPanel.classList.contains('peek')) {
      warmupFxGlass();
    } else {
      // 面板关着就别在开机时预热：它整个「点击进入」过程都不可见（right:-460px, opacity:0），
      // 白占一个 WebGL 上下文 + 一整套着色器编译 + 一轮 html-to-image，实测是全流程里最贵的一项之一。
      // activateFxGlass() 在 fxState==='idle' 时会按需预热（带 lg-loading 过渡），首次打开再付这笔钱。
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
      var cfg = liquidGlassFxConfig(preset);
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
        defaults: liquidGlassInitDefaults(sbCfg)
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
      requestIdleCallback(function () { staggerGlassWarmup(3, warmupSearchGlass); }, { timeout: 3000 });
    } else {
      setTimeout(function () { staggerGlassWarmup(3, warmupSearchGlass); }, 2000);
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

    // === 方案 A 的闸门：arm 之前一律不 init、不 lg-active，首页保持 CSS 玻璃 ===
    var homeGlassArmed = false;   // 过了延迟窗口，允许切液态玻璃
    var homeArmTimer = 0;

    function isHomeVisible() {
      return document.body.classList.contains('empty-home-active')
        || document.body.classList.contains('show-home')
        || document.body.classList.contains('home-ready');
    }

    function clearHomeArmTimer() {
      if (homeArmTimer) { clearTimeout(homeArmTimer); homeArmTimer = 0; }
    }

    function armHomeGlass() {
      clearHomeArmTimer();
      if (homeGlassArmed) return;
      if (document.body.classList.contains('splash-active')) return;   // 又回 splash 了，等下次进入
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) return;
      if (!isHomeVisible()) return;
      homeGlassArmed = true;
      if (homeState === 'idle') warmupHomeGlass();
      else activateHomeGlass();
    }

    function scheduleHomeArm() {
      if (homeGlassArmed || homeArmTimer) return;   // 幂等：MutationObserver 每帧都会来，别叠定时器
      if (document.body.classList.contains('splash-active')) return;
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) return;
      homeArmTimer = setTimeout(armHomeGlass, HOME_GLASS_ARM_DELAY_MS);
    }

    function disarmHomeGlass() {
      homeGlassArmed = false;
      clearHomeArmTimer();
    }

    function buildHomeCfg() {
      var preset = window.LiquidGlassPresets && window.LiquidGlassPresets.homeCard
        ? window.LiquidGlassPresets.homeCard : {};
      return applyLiquidGlassProfile(liquidGlassFxConfig(preset), 'home');
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
      // 方案 A：splash 期间 / arm 之前一律不 init。原来 IntersectionObserver 在 splash 刚
      // 「可见」时就触发预热，init 正好压在进入过渡上，这是「点进播放器卡几秒」的直接来源。
      if (!homeGlassArmed) return;
      if (document.body.classList.contains('splash-active')) return;
      homeCards = collectHomeGlassElements(homeGrid);
      if (!homeCards.length) return;
      homeState = 'warming';
      homeCfg = buildHomeCfg();
      LiquidGlass.init({
        root: homeGrid,
        glassElements: homeCards.slice(),
        defaults: liquidGlassInitDefaults(homeCfg)
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
      // 方案 A 闸门：还没到切换时机就继续用 CSS 玻璃，只排一个延时
      if (!homeGlassArmed) { scheduleHomeArm(); return; }
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
        disarmHomeGlass();
        deactivateHomeGlass();
        return;
      }
      // lg-degraded：保留实例与 lg-active，靠 CSS 藏 canvas；恢复时 restart rAF
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) {
        clearHomeArmTimer();
        if (homeInstance) {
          homeInstance._running = false;
          if (homeInstance._rafId) {
            try { cancelAnimationFrame(homeInstance._rafId); } catch (_) {}
            homeInstance._rafId = null;
          }
        }
        return;
      }
      // activateHomeGlass() 内部带方案 A 闸门：arm 之前它只会排一个 1.5s 延时后返回，
      // 首页卡片继续吃 .home-card 自己的 CSS 玻璃。
      if (isHomeVisible()) activateHomeGlass();
      else { clearHomeArmTimer(); deactivateHomeGlass(); }
    });
    homeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    window.refreshHomeLiquidGlassAfterPerf = function () {
      if (homeState === 'active' || homeState === 'ready') activateHomeGlass();
    };

    if ('IntersectionObserver' in window && homeGrid) {
      var homeIo = new IntersectionObserver(function(entries){
        var visible = entries.some(function(e){ return e.isIntersecting && e.intersectionRatio > 0.05; });
        if (visible) {
          homeIo.disconnect();
          if ('requestIdleCallback' in window) requestIdleCallback(function () { staggerGlassWarmup(0, warmupHomeGlass); }, { timeout: 1800 });
          else setTimeout(function () { staggerGlassWarmup(0, warmupHomeGlass); }, 400);
        }
      }, { threshold: [0, 0.05, 0.2] });
      homeIo.observe(homeGrid);
    } else if ('requestIdleCallback' in window) {
      requestIdleCallback(function () { staggerGlassWarmup(0, warmupHomeGlass); }, { timeout: 3500 });
    } else {
      setTimeout(function () { staggerGlassWarmup(0, warmupHomeGlass); }, 2200);
    }
  }

  // === 首页右下「今日聆听」卡：root=.home-rail，glass 必须是其直接子节点（库硬约束）===
  var ltRail = document.querySelector('.home-rail');
  function collectLtGlassElements(root) {
    if (!root) return [];
    return Array.prototype.filter.call(root.children || [], function (el) {
      return el && el.classList && el.classList.contains('listening-today-card');
    });
  }
  var ltCards = collectLtGlassElements(ltRail);
  if (ltRail && ltCards.length) {
    var ltState = 'idle';
    var ltInstance = null;
    var ltCfg = null;

    function buildLtCfg() {
      var preset = window.LiquidGlassPresets && window.LiquidGlassPresets.listeningToday
        ? window.LiquidGlassPresets.listeningToday : {};
      return applyLiquidGlassProfile(liquidGlassFxConfig(preset), 'home');
    }

    function warmupLtGlass() {
      if (ltState !== 'idle') return;
      ltCards = collectLtGlassElements(ltRail);
      if (!ltCards.length) return;
      ltState = 'warming';
      ltCfg = buildLtCfg();
      LiquidGlass.init({
        root: ltRail,
        glassElements: ltCards.slice(),
        defaults: liquidGlassInitDefaults(ltCfg)
      }).then(function (instance) {
        ltInstance = instance;
        ltCards.forEach(function (el) {
          el.dataset.config = JSON.stringify(ltCfg);
        });
        ltState = 'ready';
        console.log('[LiquidGlass] ListeningToday card pre-warmed');
        activateLtGlass();
      }).catch(function (e) {
        console.warn('[LiquidGlass] ListeningToday warmup failed:', e);
        ltState = 'idle';
      });
    }

    function activateLtGlass() {
      if (document.body.classList.contains('splash-active')) return;
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) {
        // 降级交给 CSS 回退；勿 destroy 实例，否则恢复后卡片透明失效
        if (ltInstance) {
          ltInstance._running = false;
          if (ltInstance._rafId) {
            try { cancelAnimationFrame(ltInstance._rafId); } catch (_) {}
            ltInstance._rafId = null;
          }
        }
        return;
      }
      if (ltState === 'active' && ltInstance) {
        ensureLiquidGlassRunning(ltInstance);
        return;
      }
      if (ltState === 'ready' && ltInstance) {
        if (!liquidGlassInstanceAlive(ltInstance, ltCards)) {
          ltInstance = null;
          ltState = 'idle';
          warmupLtGlass();
          return;
        }
        ltCards.forEach(function (el) {
          el.style.background = 'transparent';
          el.style.backdropFilter = 'none';
          el.style.webkitBackdropFilter = 'none';
          el.classList.add('lg-active');
          ltInstance.markChanged(el);
        });
        ltState = 'active';
        ensureLiquidGlassRunning(ltInstance);
        mgr.register('listeningToday', {
          instance: ltInstance,
          elements: ltCards.slice(),
          config: ltCfg,
          root: ltRail,
          presetName: 'listeningToday'
        });
      } else if (ltState === 'idle') {
        warmupLtGlass();
      }
    }

    function deactivateLtGlass() {
      if (ltState !== 'active') return;
      ltCards.forEach(function (el) {
        el.style.background = '';
        el.style.backdropFilter = '';
        el.style.webkitBackdropFilter = '';
        el.classList.remove('lg-active');
      });
      // 只 detach，勿 unregister/destroy：否则降级恢复后会拿死实例把卡片刷成透明
      if (typeof mgr.detach === 'function') mgr.detach('listeningToday');
      else delete mgr._instances.listeningToday;
      if (ltInstance) {
        ltInstance._running = false;
        if (ltInstance._rafId) {
          try { cancelAnimationFrame(ltInstance._rafId); } catch (_) {}
          ltInstance._rafId = null;
        }
      }
      ltState = ltInstance ? 'ready' : 'idle';
    }

    var ltObserver = new MutationObserver(function () {
      if (document.body.classList.contains('splash-active')) {
        deactivateLtGlass();
        return;
      }
      // lg-degraded：保留实例与 lg-active，靠 CSS 藏 canvas；恢复时 restart rAF
      if (document.body.classList.contains('lg-degraded') || document.body.classList.contains('lg-forced-off')) {
        if (ltInstance) {
          ltInstance._running = false;
          if (ltInstance._rafId) {
            try { cancelAnimationFrame(ltInstance._rafId); } catch (_) {}
            ltInstance._rafId = null;
          }
        }
        return;
      }
      var ltVisible = document.body.classList.contains('empty-home-active')
        || document.body.classList.contains('show-home')
        || document.body.classList.contains('home-ready');
      if (ltVisible) activateLtGlass();
      else deactivateLtGlass();
    });
    ltObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // FX 面板滑杆 / 性能档位变化时同步本实例
    var prevApplyHomeCardConfig = window.applyHomeLiquidGlassCardConfig;
    window.applyHomeLiquidGlassCardConfig = function () {
      if (typeof prevApplyHomeCardConfig === 'function') prevApplyHomeCardConfig();
      if (ltInstance) {
        ltCfg = buildLtCfg();
        ltCards.forEach(function (el) {
          el.dataset.config = JSON.stringify(ltCfg);
          ltInstance.markChanged(el);
        });
        if (ltInstance._globalDirty !== undefined) ltInstance._globalDirty = true;
      }
    };
    var prevPerfRefresh = window.refreshHomeLiquidGlassAfterPerf;
    window.refreshHomeLiquidGlassAfterPerf = function () {
      if (typeof prevPerfRefresh === 'function') prevPerfRefresh();
      if (ltState === 'active' || ltState === 'ready') activateLtGlass();
    };

    if ('IntersectionObserver' in window && ltRail) {
      var ltIo = new IntersectionObserver(function(entries){
        var visible = entries.some(function(e){ return e.isIntersecting && e.intersectionRatio > 0.05; });
        if (visible) {
          ltIo.disconnect();
          if ('requestIdleCallback' in window) requestIdleCallback(function () { staggerGlassWarmup(2, warmupLtGlass); }, { timeout: 2200 });
          else setTimeout(function () { staggerGlassWarmup(2, warmupLtGlass); }, 500);
        }
      }, { threshold: [0, 0.05, 0.2] });
      ltIo.observe(ltRail);
    } else if ('requestIdleCallback' in window) {
      requestIdleCallback(function () { staggerGlassWarmup(2, warmupLtGlass); }, { timeout: 4200 });
    } else {
      setTimeout(function () { staggerGlassWarmup(2, warmupLtGlass); }, 2600);
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
      var cfg = liquidGlassFxConfig(preset);
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
        defaults: liquidGlassInitDefaults(bbCfg)
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
      requestIdleCallback(function () { staggerGlassWarmup(1, warmupBottomGlass); }, { timeout: 4000 });
    } else {
      setTimeout(function () { staggerGlassWarmup(1, warmupBottomGlass); }, 2500);
    }
  }

  // 首页大卡 .home-hero 故意不接 LiquidGlass（2026-11-10 撤回）。
  // 它自己有一套完整 CSS 玻璃：glass.css:38-44 / playlist.css:293 的渐变背景 +
  // blur(38px) saturate(1.42) brightness(1.08) + ::before 高光层。挂 WebGL 宿主必须
  // 用 !important 把这些全清成 transparent/none，视觉反而倒退；而且拖任意液态玻璃
  // 滑块时整块首页跟着变，用户会以为面板串了控件。
  // 历史遗留的 LiquidGlassPresets.homeHero（glassSelector 指向不存在的 .hero-card）
  // 已一并删除。真要支持请做成显式、默认关闭的开关，别默认接管。
}

/* 五个 WebGL 宿主 + 首页 CSS 玻璃的统一刷新入口。
 * 以前面板滑块只调 applyHomeLiquidGlassConfig + applyFxLiquidGlassConfig，
 * 搜索框 / 底栏 / 首页卡片的 WebGL 玻璃拖了滑块根本不会更新（data-config 没换）。
 * 插件 API 里那两串手写调用也一并收敛到这里。
 * 注意列表里没有 .home-hero：它是独立 CSS 玻璃，不该跟随液态玻璃参数。 */
function applyAllLiquidGlassConfig() {
  [
    'applyHomeLiquidGlassConfig',
    'applyFxLiquidGlassConfig',
    'applySearchLiquidGlassConfig',
    'applyBottomLiquidGlassConfig',
    'applyHomeLiquidGlassCardConfig',
    /* Folia 世界由 06-liquidglass-folia-css.js 接管成 CSS 玻璃；非 Folia 时它是 no-op。 */
    'applyFoliaCssGlass'
  ].forEach(function (name) {
    if (typeof window[name] !== 'function') return;
    try { window[name](); } catch (e) { console.warn('[LiquidGlass] ' + name, e); }
  });
}
window.applyAllLiquidGlassConfig = applyAllLiquidGlassConfig;

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(function(){ applyHomeLiquidGlassConfig(); bootstrapLiquidGlass(); }, 1500);
} else {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function(){ applyHomeLiquidGlassConfig(); bootstrapLiquidGlass(); }, 1500);
  });
}
