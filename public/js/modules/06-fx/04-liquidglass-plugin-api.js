// =============================================================================
// LiquidGlass 插件 SDK（最小可用）
// 供 userData/plugins/liquidglass/*.js 或内置 sample 调用。
// =============================================================================
(function (global) {
  'use strict';

  var pluginRegistry = {};
  var enabledMap = {};
  var pluginCleanup = {};

  function readEnabledMap() {
    try {
      var raw = localStorage.getItem('mineradio.liquidglass.plugins') || '{}';
      enabledMap = JSON.parse(raw) || {};
    } catch (_) {
      enabledMap = {};
    }
  }

  function writeEnabledMap() {
    try { localStorage.setItem('mineradio.liquidglass.plugins', JSON.stringify(enabledMap)); } catch (_) {}
  }

  function clearPluginArtifacts(id) {
    var cleanup = pluginCleanup[id];
    pluginCleanup[id] = null;
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (e) { console.warn('[LiquidGlassPluginCleanup]', id, e); }
    }
    unmount(id);
  }

  function rememberPluginCleanup(id, cleanup) {
    if (typeof cleanup === 'function') {
      pluginCleanup[id] = cleanup;
      return;
    }
    if (cleanup && typeof cleanup.cleanup === 'function') {
      pluginCleanup[id] = function () { cleanup.cleanup(); };
      return;
    }
    pluginCleanup[id] = null;
  }

  function ensureManager() {
    if (!global.__mineradioLiquidGlassManager && global.LiquidGlassManager) {
      global.__mineradioLiquidGlassManager = new global.LiquidGlassManager();
    }
    return global.__mineradioLiquidGlassManager || null;
  }

  function definePreset(name, config) {
    if (!name || !config) return false;
    global.LiquidGlassPresets = global.LiquidGlassPresets || {};
    global.LiquidGlassPresets[name] = Object.assign({}, config);
    return true;
  }

  function mount(name, opts) {
    opts = opts || {};
    var presets = global.LiquidGlassPresets || {};
    var preset = presets[name] || opts.config;
    if (!preset) throw new Error('LIQUIDGLASS_PRESET_MISSING:' + name);
    if (!global.LiquidGlass) throw new Error('LIQUIDGLASS_LIB_MISSING');
    var mgr = ensureManager();
    var root = document.querySelector(opts.rootSelector || preset.rootSelector || 'body');
    if (!root) throw new Error('LIQUIDGLASS_ROOT_MISSING');
    var selector = opts.glassSelector || preset.glassSelector || '';
    var elements = selector ? Array.prototype.slice.call(root.querySelectorAll(selector)) : [root];
    if (!elements.length) elements = [root];
    elements = elements.filter(function (el) {
      return el && (!el.parentElement || el.parentElement === root);
    });
    if (!elements.length) elements = [root];
    var cfg = Object.assign({}, preset, opts.config || {});
    var instance = new global.LiquidGlass(Object.assign({}, cfg, {
      root: root,
      elements: elements
    }));
    if (mgr && typeof mgr.register === 'function') {
      mgr.register('plugin:' + name, {
        instance: instance,
        elements: elements,
        config: cfg,
        root: root,
        presetName: name,
        plugin: true
      });
    }
    return instance;
  }

  function unmount(name) {
    var mgr = ensureManager();
    if (mgr && typeof mgr.unregister === 'function') mgr.unregister('plugin:' + name);
  }

  function listPresets() {
    return Object.keys(global.LiquidGlassPresets || {});
  }

  function listPlugins() {
    return Object.keys(pluginRegistry).map(function (id) {
      var meta = pluginRegistry[id] || {};
      return {
        id: id,
        name: meta.name || id,
        description: meta.description || '',
        enabled: !!enabledMap[id],
        version: meta.version || '0.0.0'
      };
    });
  }

  function registerPlugin(meta, setupFn) {
    if (!meta || !meta.id) throw new Error('LIQUIDGLASS_PLUGIN_ID_REQUIRED');
    pluginRegistry[meta.id] = {
      id: meta.id,
      name: meta.name || meta.id,
      description: meta.description || '',
      version: meta.version || '0.1.0',
      setup: setupFn
    };
    if (enabledMap[meta.id] == null) enabledMap[meta.id] = !!meta.enabledByDefault;
    writeEnabledMap();
    if (enabledMap[meta.id] && typeof setupFn === 'function') {
      try {
        var cleanup = setupFn(api) || null;
        rememberPluginCleanup(meta.id, cleanup);
      } catch (e) {
        console.warn('[LiquidGlassPlugin]', meta.id, e);
      }
    }
    return meta.id;
  }

  function setPluginEnabled(id, enabled) {
    if (!pluginRegistry[id]) return false;
    enabledMap[id] = !!enabled;
    writeEnabledMap();
    if (enabled && typeof pluginRegistry[id].setup === 'function') {
      clearPluginArtifacts(id);
      try {
        var cleanup = pluginRegistry[id].setup(api) || null;
        rememberPluginCleanup(id, cleanup);
      } catch (e) {
        console.warn('[LiquidGlassPlugin]', id, e);
      }
    } else if (!enabled) {
      clearPluginArtifacts(id);
    }
    return true;
  }

  function getPerf() {
    return global.__mineradioLiquidGlassPerf || null;
  }

  var api = {
    definePreset: definePreset,
    mount: mount,
    unmount: unmount,
    listPresets: listPresets,
    listPlugins: listPlugins,
    registerPlugin: registerPlugin,
    setPluginEnabled: setPluginEnabled,
    getPerf: getPerf,
    version: '0.1.0'
  };

  readEnabledMap();
  global.MineradioLiquidGlass = api;

  function registerBuiltInLiquidGlassPlugins() {
    registerPlugin({
      id: 'sample-bottom-pill',
      name: '底栏胶囊插件',
      description: '更圆润的播放控制条玻璃，适合底栏。',
      version: '1.1.0',
      enabledByDefault: false
    }, function (sdk) {
      sdk.definePreset('sample-bottom-pill', {
        blurAmount: 0.88,
        refraction: 0.28,
        chromAberration: 0.0,
        edgeHighlight: 0.16,
        specular: 0.08,
        fresnel: 1.0,
        cornerRadius: 58,
        zRadius: 16,
        shadowOpacity: 0.48,
        shadowSpread: 34,
        shadowOffsetY: 7,
        saturation: 0.46,
        brightness: 0.05,
        tintStrength: 0.0,
        bevelMode: 0,
        rootSelector: '#bottom-bar',
        glassSelector: ''
      });
      if (!document.getElementById('bottom-bar')) return null;
      try {
        sdk.mount('sample-bottom-pill');
      } catch (e) {
        console.warn('[LiquidGlassPlugin]', 'sample-bottom-pill', e);
      }
      return function () {
        sdk.unmount('sample-bottom-pill');
      };
    });

    registerPlugin({
      id: 'sample-search-pill',
      name: '搜索框轻玻璃插件',
      description: '更克制的输入态玻璃，减少干扰，提升可读性。',
      version: '1.1.0',
      enabledByDefault: false
    }, function (sdk) {
      sdk.definePreset('sample-search-pill', {
        blurAmount: 0.52,
        refraction: 0.11,
        chromAberration: 0.0,
        edgeHighlight: 0.08,
        specular: 0.03,
        fresnel: 0.82,
        cornerRadius: 16,
        zRadius: 8,
        shadowOpacity: 0.28,
        shadowSpread: 14,
        shadowOffsetY: 3,
        saturation: 0.24,
        brightness: 0.02,
        tintStrength: 0.0,
        bevelMode: 0,
        rootSelector: '#search-box',
        glassSelector: ''
      });
      if (!document.getElementById('search-box')) return null;
      try {
        sdk.mount('sample-search-pill');
      } catch (e) {
        console.warn('[LiquidGlassPlugin]', 'sample-search-pill', e);
      }
      return function () {
        sdk.unmount('sample-search-pill');
      };
    });

    registerPlugin({
      id: 'sample-home-card',
      name: '首页卡片插件',
      description: '更有层次感的首页卡片玻璃，适合专辑、歌单和推荐位。',
      version: '1.1.0',
      enabledByDefault: false
    }, function (sdk) {
      sdk.definePreset('sample-home-card', {
        blurAmount: 0.72,
        refraction: 0.20,
        chromAberration: 0.0,
        edgeHighlight: 0.11,
        specular: 0.05,
        fresnel: 0.95,
        cornerRadius: 20,
        zRadius: 12,
        shadowOpacity: 0.38,
        shadowSpread: 20,
        shadowOffsetY: 4,
        saturation: 0.32,
        brightness: 0.03,
        tintStrength: 0.0,
        bevelMode: 0,
        rootSelector: '.home-grid',
        glassSelector: ':scope > .home-card, :scope > .home-tile, :scope > .home-mosaic-cell'
      });
      if (!document.querySelector('.home-grid')) return null;
      try {
        sdk.mount('sample-home-card');
      } catch (e) {
        console.warn('[LiquidGlassPlugin]', 'sample-home-card', e);
      }
      return function () {
        sdk.unmount('sample-home-card');
      };
    });

    registerPlugin({
      id: 'sample-low-spec',
      name: '低配降级插件',
      description: '自动减弱 blur / refraction，适合旧机器或省电场景。',
      version: '1.1.0',
      enabledByDefault: false
    }, function (sdk) {
      var perf = sdk.getPerf && sdk.getPerf();
      var lowSpec = !!(perf && ((perf.approxFps && perf.approxFps < 45) || perf.degraded || perf.forcedOff));
      var profile = {
        blurMultiplier: lowSpec ? 0.55 : 0.78,
        refractionMultiplier: lowSpec ? 0.62 : 0.85,
        saturationMultiplier: lowSpec ? 0.90 : 0.96,
        brightnessMultiplier: 1,
        edgeHighlightMultiplier: lowSpec ? 0.88 : 0.94,
        specularMultiplier: 0.9,
        fresnelMultiplier: 0.92,
        shadowMultiplier: 0.85,
        shadowSpreadMultiplier: 0.8,
        shadowOffsetYMultiplier: 0.85,
        zRadiusMultiplier: 0.92,
        cornerRadiusMultiplier: 1,
        tintStrengthMultiplier: 1,
        disableChromAberration: true,
        disableTintStrength: true,
        overrides: {
          blurAmount: lowSpec ? 0.48 : 0.62,
          refraction: lowSpec ? 0.10 : 0.14,
          chromAberration: 0,
          saturation: lowSpec ? 0.18 : 0.24,
          brightness: lowSpec ? 0.01 : 0.02
        }
      };
      window.__mineradioLiquidGlassProfile = profile;
      window.__mineradioLiquidGlassSurfaceOverrides = {
        bottomBar: {
          blurAmount: lowSpec ? 0.42 : 0.58,
          refraction: lowSpec ? 0.08 : 0.12,
          cornerRadius: 56,
          zRadius: lowSpec ? 12 : 14
        },
        searchBox: {
          blurAmount: lowSpec ? 0.34 : 0.48,
          refraction: lowSpec ? 0.06 : 0.10,
          cornerRadius: 16,
          zRadius: lowSpec ? 6 : 8
        },
        home: {
          blurAmount: lowSpec ? 0.40 : 0.58,
          refraction: lowSpec ? 0.08 : 0.13,
          cornerRadius: 18,
          zRadius: lowSpec ? 9 : 11
        }
      };
      if (typeof window.applyHomeLiquidGlassConfig === 'function') window.applyHomeLiquidGlassConfig();
      if (typeof window.applyFxLiquidGlassConfig === 'function') window.applyFxLiquidGlassConfig();
      if (typeof window.applySearchLiquidGlassConfig === 'function') window.applySearchLiquidGlassConfig();
      if (typeof window.applyBottomLiquidGlassConfig === 'function') window.applyBottomLiquidGlassConfig();
      if (typeof window.applyHomeLiquidGlassCardConfig === 'function') window.applyHomeLiquidGlassCardConfig();
      if (typeof window.setLiquidGlassAdaptive === 'function') {
        window.setLiquidGlassAdaptive(!lowSpec);
      }
      return function () {
        window.__mineradioLiquidGlassProfile = null;
        window.__mineradioLiquidGlassSurfaceOverrides = {};
        if (typeof window.applyHomeLiquidGlassConfig === 'function') window.applyHomeLiquidGlassConfig();
        if (typeof window.applyFxLiquidGlassConfig === 'function') window.applyFxLiquidGlassConfig();
        if (typeof window.applySearchLiquidGlassConfig === 'function') window.applySearchLiquidGlassConfig();
        if (typeof window.applyBottomLiquidGlassConfig === 'function') window.applyBottomLiquidGlassConfig();
        if (typeof window.applyHomeLiquidGlassCardConfig === 'function') window.applyHomeLiquidGlassCardConfig();
        if (typeof window.setLiquidGlassAdaptive === 'function') {
          window.setLiquidGlassAdaptive(true);
        }
      };
    });
  }

  registerBuiltInLiquidGlassPlugins();

  function renderLiquidGlassPluginPanel() {
    var list = document.getElementById('liquidglass-plugin-list');
    if (!list || !api) return;
    var plugins = api.listPlugins();
    if (!plugins.length) {
      list.innerHTML = '<div style="padding:8px 2px;color:rgba(255,255,255,.34);font-size:11px">暂无插件。可使用内置示例 sample-bottom-pill。</div>';
      return;
    }
    list.innerHTML = plugins.map(function (plugin) {
      return '<label class="fx-toggle' + (plugin.enabled ? ' on' : '') + '" style="justify-content:space-between;gap:10px;padding:8px 10px" data-lg-plugin="' + plugin.id + '">' +
        '<span style="min-width:0"><strong style="display:block;font-size:11.5px">' + (plugin.name || plugin.id) + '</strong>' +
        '<small style="display:block;margin-top:3px;color:rgba(255,255,255,.42);font-size:10px">' + (plugin.description || plugin.id) + '</small></span>' +
        '<span style="flex:0 0 auto;font-size:10.5px">' + (plugin.enabled ? '开' : '关') + '</span>' +
        '</label>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-lg-plugin]'), function (node) {
      if (node._lgBound) return;
      node._lgBound = true;
      node.addEventListener('click', function (e) {
        e.preventDefault();
        var id = node.getAttribute('data-lg-plugin');
        var next = !api.listPlugins().some(function (p) { return p.id === id && p.enabled; });
        api.setPluginEnabled(id, next);
        renderLiquidGlassPluginPanel();
        if (typeof showToast === 'function') showToast((next ? '已启用插件: ' : '已关闭插件: ') + id);
      });
    });
  }
  global.renderLiquidGlassPluginPanel = renderLiquidGlassPluginPanel;

  async function loadDesktopLiquidGlassPlugins() {
    var desktop = global.desktopWindow;
    if (!desktop || typeof desktop.listLiquidGlassPlugins !== 'function') {
      renderLiquidGlassPluginPanel();
      return;
    }
    try {
      var result = await desktop.listLiquidGlassPlugins();
      if (!(result && result.ok)) return;
      (result.plugins || []).forEach(function (plugin) {
        if (!plugin || !plugin.source) return;
        try {
          (0, eval)(plugin.source + '\n//# sourceURL=liquidglass-plugin-' + String(plugin.id || 'unknown') + '.js\n');
        } catch (e) {
          console.warn('[LiquidGlassPluginLoad]', plugin.id, e);
        }
      });
    } catch (e) {
      console.warn('[LiquidGlassPluginLoad]', e);
    }
    renderLiquidGlassPluginPanel();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(loadDesktopLiquidGlassPlugins, 1800);
      });
    } else {
      setTimeout(loadDesktopLiquidGlassPlugins, 1800);
    }
  }
})(window);
