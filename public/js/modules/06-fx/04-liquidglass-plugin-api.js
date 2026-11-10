// =============================================================================
// LiquidGlass 插件 SDK（最小可用）
// 供 userData/plugins/liquidglass/*.js 或内置 sample 调用。
// =============================================================================
(function (global) {
  'use strict';

  var pluginRegistry = {};
  var enabledMap = {};
  var pluginCleanup = {};
  /* 最近一次 mount 因为「root 已被宿主占用」被拒的证据。
   * 内置示例插件的 setup 自己 try/catch 吞掉了异常（只打一条 warn），
   * 所以不能只靠抛错来让开关回落到关闭 —— 用这个标记在 setup 返回后判定。 */
  var lastRootBusy = null;
  /* 被宿主区域挡下来的插件：id → 占位者选择器。
   * 面板必须能显示「不可用及其原因」，否则开关点下去弹「已启用」又自己变回「关」，
   * 看起来就像开关坏了。 */
  var pluginBlocked = {};

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
    /* ⚠ 必须优先复用宿主自己的 manager（01-liquidglass-config 里 new 的那个）。
     * 以前这里无条件 new 一个独立 manager，结果插件实例完全脱离宿主的管理：
     * 性能监测的降级/恢复遍历不到、Folia 的 CSS 桥停不掉、销毁时也清不干净。
     * 更糟的是插件和宿主可以各自在同一块 root 上各建一套玻璃（各自一个 WebGL
     * renderer + 各自一帧快照），实测把主循环从 90fps 拖到 45fps、玻璃延迟翻倍，
     * 两张 canvas 互相盖着，看到的永远是更旧的那张。 */
    if (global._liquidGlassMgr) return global._liquidGlassMgr;
    if (!global.__mineradioLiquidGlassManager && global.LiquidGlassManager) {
      global.__mineradioLiquidGlassManager = new global.LiquidGlassManager();
    }
    return global.__mineradioLiquidGlassManager || null;
  }

  /* 宿主自己会做玻璃的 root：插件再挂上去就是「同一块区域两套玻璃」。
   * 判据用静态选择器而不是「已存在的实例」，否则宿主还没预热（bottomBar 是懒加载）
   * 时插件会抢先挂上，等宿主预热起来就变成双份 —— 时序不同、结果一样糟。 */
  var HOST_GLASS_ROOTS = [
    '#bottom-bar', '#search-box', '#fx-panel', '#home-grid', '.home-grid',
    '.home-rail', '#empty-home', '.home-card', '.listening-today-card'
  ];
  function hostOwnsRoot(root) {
    if (!root || !root.matches) return null;
    for (var i = 0; i < HOST_GLASS_ROOTS.length; i++) {
      try {
        if (root.matches(HOST_GLASS_ROOTS[i])) return HOST_GLASS_ROOTS[i];
      } catch (_) {}
    }
    return null;
  }
  function rootBusyError(owner) {
    var err = new Error('LIQUIDGLASS_ROOT_BUSY: 宿主已有玻璃负责 ' + owner);
    err.code = 'LIQUIDGLASS_ROOT_BUSY';
    err.owner = owner;
    return err;
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
    /* 同一块 root 只允许一套玻璃：否则两套 renderer 各跑一遍模糊+折射，
     * 两张 canvas 叠在一起，帧率与延迟双双翻倍。插件要自定义外观请definePreset
     * 到自己的新元素上，不要覆盖宿主已负责的区域。 */
    var busy = hostOwnsRoot(root);
    if (busy) {
      lastRootBusy = busy;
      throw rootBusyError(busy);
    }
    lastRootBusy = null;
    var selector = opts.glassSelector || preset.glassSelector || '';
    var elements = selector ? Array.prototype.slice.call(root.querySelectorAll(selector)) : [root];
    if (!elements.length) elements = [root];
    elements = elements.filter(function (el) {
      return el && (!el.parentElement || el.parentElement === root);
    });
    // 库要求 glass 是 root 的直接子节点，root 自己当 glass 会被跳过。
    // 插件预设多数没写 glassSelector，这里补 backdrop shell，setup 里的 sdk.mount 才挂得上。
    if ((!elements.length || (elements.length === 1 && elements[0] === root))
      && typeof global.ensureLiquidGlassBackdropShell === 'function') {
      var shell = global.ensureLiquidGlassBackdropShell(root);
      if (shell) elements = [shell];
    }
    if (!elements.length) elements = [root];
    var cfg = Object.assign({}, preset, opts.config || {});
    // 构造函数签名是 { root, glassElements, defaults }；以前传 elements，
    // glassSet 为空 → 什么都不画。且 _start() 只有静态 init() 会调，
    // 光 new 一个实例没有 renderer / canvas / rAF。SDK 的 mount 保持同步返回实例。
    var instance = new global.LiquidGlass({
      root: root,
      glassElements: elements,
      defaults: Object.assign({}, cfg)
    });
    if (typeof instance._start === 'function') {
      Promise.resolve(instance._start()).catch(function (e) {
        console.warn('[LiquidGlassPlugin] start failed:', e);
      });
    }
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
        blocked: pluginBlocked[id] || null,
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
    /* 开机就算「这个插件的目标区域是否已被宿主接管」，面板一打开就能显示「不可用 + 原因」，
     * 不必等用户点一次才发现（点一次才提示会被当成开关坏了）。 */
    if (meta.rootSelector) {
      try {
        var target = document.querySelector(meta.rootSelector);
        var owner = target && hostOwnsRoot(target);
        if (owner) pluginBlocked[meta.id] = owner;
        else delete pluginBlocked[meta.id];
      } catch (_) {}
    }
    writeEnabledMap();
    if (enabledMap[meta.id] && typeof setupFn === 'function') {
      lastRootBusy = null;
      try {
        var cleanup = setupFn(api) || null;
        rememberPluginCleanup(meta.id, cleanup);
      } catch (e) {
        disableOnRootBusy(meta.id, e);
      }
      if (lastRootBusy) disableOnRootBusy(meta.id, rootBusyError(lastRootBusy));
    }
    return meta.id;
  }

  /* 插件想挂到宿主已负责的区域：不是「装失败」，是这块地本来就不该插件管。
   * 直接把开关改回关闭并落盘，避免面板显示「已启用」却什么都没发生。 */
  function disableOnRootBusy(id, e) {
    var code = (e && (e.code || '')) || String((e && e.message) || e || '');
    if (code.indexOf('LIQUIDGLASS_ROOT_BUSY') < 0) {
      console.warn('[LiquidGlassPlugin]', id, e);
      return false;
    }
    enabledMap[id] = false;
    writeEnabledMap();
    pluginCleanup[id] = null;
    pluginBlocked[id] = (e && e.owner) || '宿主玻璃区域';
    console.info('[LiquidGlassPlugin] ' + id + ' 不可用：' + pluginBlocked[id] + ' 已由宿主做玻璃');
    return true;
  }

  function setPluginEnabled(id, enabled) {
    if (!pluginRegistry[id]) return false;
    enabledMap[id] = !!enabled;
    writeEnabledMap();
    if (enabled && typeof pluginRegistry[id].setup === 'function') {
      clearPluginArtifacts(id);
      lastRootBusy = null;
      delete pluginBlocked[id];
      try {
        var cleanup = pluginRegistry[id].setup(api) || null;
        rememberPluginCleanup(id, cleanup);
      } catch (e) {
        disableOnRootBusy(id, e);
      }
      if (lastRootBusy) disableOnRootBusy(id, rootBusyError(lastRootBusy));
      /* 被宿主区域挡下：返回 false，面板据此提示真实原因，而不是弹「已启用」 */
      if (enabledMap[id] === false) return false;
    } else if (!enabled) {
      clearPluginArtifacts(id);
      delete pluginBlocked[id];
    }
    return true;
  }

  function getPerf() {
    // 以前读的 __mineradioLiquidGlassPerf 全项目没人赋值，恒为 null，
    // 导致 sample-low-spec 的 lowSpec 判定永远走 false 分支。
    if (typeof global.getLiquidGlassPerfInfo === 'function') return global.getLiquidGlassPerfInfo();
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
    /* 这三个示例（底栏胶囊 / 搜索框轻玻璃 / 首页卡片）已移除：
     * 它们唯一的能力是「在宿主已经做玻璃的区域再挂一套」，而同一块 root 只允许一套玻璃
     * （见 mount() 的 hostOwnsRoot 闸门），实测叠两套会让主循环 90fps→45fps、玻璃延迟翻倍、
     * 每张卡两张 canvas 互相盖。留着只能在面板里显示「不可用」，纯噪音。
     * 要做玻璃外观，走 definePreset + 宿主已暴露的 14 个参数滑块，或写
     * __mineradioLiquidGlassProfile / __mineradioLiquidGlassSurfaceOverrides（参考低配降级插件）。 */

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
      if (typeof window.applyAllLiquidGlassConfig === 'function') window.applyAllLiquidGlassConfig();
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
      list.innerHTML = '<div style="padding:8px 2px;color:rgba(255,255,255,.34);font-size:11px">还没有外部插件。把 .js 放到用户目录 <code>plugins/liquidglass/</code>，重启后出现在这里。</div>';
      return;
    }
    list.innerHTML = plugins.map(function (plugin) {
      var pid = escAttr(plugin.id == null ? '' : String(plugin.id));
      var pname = escHtml(plugin.name || plugin.id || '');
      var pdesc = escHtml(plugin.description || plugin.id || '');
      /* 被宿主区域挡下的插件必须显示成「不可用 + 原因」。
       * 以前这里只有 开/关 两态，挡下后开关会自己弹回「关」而 toast 还说「已启用」，
       * 看起来就是开关坏了。 */
      var blocked = plugin.blocked ? String(plugin.blocked) : '';
      var stateText = blocked ? '不可用' : (plugin.enabled ? '开' : '关');
      var descLine = blocked
        ? '<small style="display:block;margin-top:3px;color:rgba(255,176,120,.85);font-size:10px">宿主已在此做玻璃（' + escHtml(blocked) + '），叠加会让帧率与延迟翻倍</small>'
        : '<small style="display:block;margin-top:3px;color:rgba(255,255,255,.42);font-size:10px">' + pdesc + '</small>';
      return '<label class="fx-toggle' + (plugin.enabled ? ' on' : '') + '" style="justify-content:space-between;gap:10px;padding:8px 10px;opacity:' + (blocked ? '.72' : '1') + '" data-lg-plugin="' + pid + '" data-lg-blocked="' + escAttr(blocked) + '">' +
        '<span style="min-width:0"><strong style="display:block;font-size:11.5px">' + pname + '</strong>' +
        descLine + '</span>' +
        '<span style="flex:0 0 auto;font-size:10.5px' + (blocked ? ';color:rgba(255,176,120,.9)' : '') + '">' + stateText + '</span>' +
        '</label>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-lg-plugin]'), function (node) {
      if (node._lgBound) return;
      node._lgBound = true;
      node.addEventListener('click', function (e) {
        e.preventDefault();
        var id = node.getAttribute('data-lg-plugin');
        var entry = api.listPlugins().filter(function (p) { return p.id === id; })[0] || {};
        /* 已知不可用：直接说明原因，不假装切换 */
        if (entry.blocked) {
          if (typeof showToast === 'function') showToast('「' + (entry.name || id) + '」不可用：' + entry.blocked + ' 已经由宿主做玻璃');
          return;
        }
        var next = !entry.enabled;
        var ok = api.setPluginEnabled(id, next);
        renderLiquidGlassPluginPanel();
        if (next && ok === false) {
          var after = api.listPlugins().filter(function (p) { return p.id === id; })[0] || {};
          if (typeof showToast === 'function') showToast('「' + (entry.name || id) + '」不可用：' + (after.blocked || '宿主玻璃区域') + ' 已经由宿主做玻璃');
          return;
        }
        if (typeof showToast === 'function') showToast((next ? '已启用插件: ' : '已关闭插件: ') + (entry.name || id));
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
