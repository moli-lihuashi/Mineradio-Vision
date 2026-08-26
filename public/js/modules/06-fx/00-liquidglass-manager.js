/**
 * LiquidGlassManager
 * 统一管理多个 LiquidGlass 实例的预设配置与生命周期。
 *
 * 设计：
 *  - 常驻实例：home 卡片 (.home-grid)、搜索栏 (#search-stack) —— 随页面启动初始化
 *  - 懒加载实例：fx-panel —— 仅在可见时初始化，隐藏时销毁
 *
 * 预设配置存储于 LiquidGlassPresets，供 bootstrap 读取。
 * 实例注册表存储于 manager._instances，供调试/统一销毁使用。
 */
(function () {
  'use strict';

  // === 预设配置：与 getLiquidGlassConfigFromFx 的 defaults 保持一致 ===
  var LiquidGlassPresets = {
    // 主页卡片：柔和折射 + 轻磨砂
    homeCard: {
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
      bevelMode: 0,
      rootSelector: '.home-grid',
      glassSelector: '.home-grid > .home-card'
    },
    // 搜索框：偏透明；双折射 + 弱白边（对齐 tisc：先折射背景再少量高光）
    searchBox: {
      blurAmount: 0.58,
      refraction: 0.20,
      chromAberration: 0.0,
      edgeHighlight: 0.06,
      specular: 0.045,
      fresnel: 0.85,
      cornerRadius: 22,
      zRadius: 10,
      shadowOpacity: 0.28,
      shadowSpread: 16,
      shadowOffsetY: 3,
      saturation: 0.26,
      brightness: 0.02,
      tintStrength: 0.0,
      bevelMode: 0,
      rootSelector: '#search-box',
      glassSelector: '#search-box > .lg-glass-shell'
    },
    // 视觉控制台 fx-panel：较强的玻璃质感
    fxPanel: {
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
      bevelMode: 0,
      rootSelector: '#fx-panel',
      glassSelector: '#fx-panel'
    },
    // 搜索结果面板
    searchResults: {
      blurAmount: 0.60,
      refraction: 0.15,
      chromAberration: 0.0,
      edgeHighlight: 0.10,
      specular: 0.04,
      fresnel: 0.9,
      cornerRadius: 16,
      zRadius: 9,
      shadowOpacity: 0.36,
      shadowSpread: 18,
      shadowOffsetY: 3,
      saturation: 0.30,
      brightness: 0.03,
      tintStrength: 0.0,
      bevelMode: 0,
      rootSelector: '#search-results',
      glassSelector: '#search-results .result-card'
    },
    // 底部播放控件栏：胶囊 + 双界面折射；弱描边避免塑料白边
    bottomBar: {
      blurAmount: 0.72,
      refraction: 0.26,
      chromAberration: 0.0,
      edgeHighlight: 0.07,
      specular: 0.05,
      fresnel: 0.92,
      cornerRadius: 50,
      zRadius: 16,
      shadowOpacity: 0.36,
      shadowSpread: 26,
      shadowOffsetY: 5,
      saturation: 0.34,
      brightness: 0.03,
      tintStrength: 0.0,
      bevelMode: 0,
      rootSelector: '#bottom-bar',
      glassSelector: '#bottom-bar > .lg-glass-shell'
    },
    // 主页 Hero 区
    homeHero: {
      blurAmount: 0.50,
      refraction: 0.12,
      chromAberration: 0.0,
      edgeHighlight: 0.08,
      specular: 0.03,
      fresnel: 0.8,
      cornerRadius: 20,
      zRadius: 12,
      shadowOpacity: 0.30,
      shadowSpread: 24,
      shadowOffsetY: 5,
      saturation: 0.24,
      brightness: 0.02,
      tintStrength: 0.0,
      bevelMode: 0,
      rootSelector: '.home-hero',
      glassSelector: '.home-hero .hero-card'
    }
  };

  // === 管理器：实例注册表 ===
  function LiquidGlassManager() {
    this._instances = {};
    this._observers = [];
  }

  LiquidGlassManager.prototype = {
    constructor: LiquidGlassManager,

    /**
     * 注册一个实例到管理器
     * @param {string} name 实例名（与 preset 名对应）
     * @param {object} entry { instance, elements, config, root, presetName }
     */
    register: function (name, entry) {
      this._instances[name] = entry;
    },

    /**
     * 仅从注册表摘掉，不 destroy（降级/隐藏时复用实例）。
     */
    detach: function (name) {
      delete this._instances[name];
    },

    /**
     * 注销并销毁实例
     */
    unregister: function (name) {
      var entry = this._instances[name];
      if (entry && entry.instance && typeof entry.instance.destroy === 'function') {
        try { entry.instance.destroy(); } catch (e) { console.warn('[LiquidGlassManager] destroy failed:', name, e); }
      }
      delete this._instances[name];
    },

    /**
     * 获取实例
     */
    get: function (name) {
      return this._instances[name] || null;
    },

    /**
     * 标记某实例的元素为脏（需要重新渲染）
     */
    markChanged: function (name, elements) {
      var entry = this._instances[name];
      if (!entry || !entry.instance) return;
      var els = elements || entry.elements;
      if (Array.isArray(els)) {
        els.forEach(function (el) {
          if (entry.instance.markChanged) entry.instance.markChanged(el);
        });
      }
    },

    /**
     * 销毁所有实例（页面卸载时调用）
     */
    destroyAll: function () {
      var self = this;
      Object.keys(this._instances).forEach(function (name) {
        self.unregister(name);
      });
      this._observers.forEach(function (obs) {
        try { obs.disconnect(); } catch (e) {}
      });
      this._observers = [];
    }
  };

  // 挂载到全局
  window.LiquidGlassPresets = LiquidGlassPresets;
  window.LiquidGlassManager = LiquidGlassManager;
})();
