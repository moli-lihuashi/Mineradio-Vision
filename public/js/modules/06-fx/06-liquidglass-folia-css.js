/* LiquidGlass × Folia 世界：切 CSS 玻璃桥。
 *
 * 背景（2026-11-10 实测）：Folia 世界下 WebGL 玻璃的镜像拿不到画面。
 *  - 模组（Pixi / three）自驱 rAF，主循环在另一个 rAF 里 blit；主循环排在模组之前时，
 *    drawImage 读到的是已被合成清空的缓冲，而画布是 preserveDrawingBuffer:false。
 *    实测 hanabi 下 blit 了 71 次（源 1923×1251），镜像仍是 std=0 / colors=1。
 *  - 镜像按设计只收 canvas，Folia 的歌词文字 / 贴纸 / monet 底图是 DOM，永远进不去。
 *
 * 所以 Folia 世界改成 CSS backdrop-filter：合成器直接采样「舞台 + DOM 歌词」的合成结果。
 * 代价是失去折射与色散，只有模糊 / 饱和 / 亮度可映射（公式与首页 CSS 玻璃同源）。
 * 退出世界时恢复 WebGL 实例，非 Folia 世界的折射/色散不受影响。
 *
 * 状态切换靠 body.folia-world-active（03-folia-world-runtime.js 维护），
 * 不改 Folia 任何代码，也不碰模组。 */
(function () {
  'use strict';

  var CSS_CLASS = 'lg-folia-css';
  var stoppedNames = [];
  var enabled = false;
  /* 宿主自己的可见性观察器（homeObserver / ltObserver / bbObserver）会在 body class
   * 变化时再调 ensureLiquidGlassRunning，把刚停掉的 rAF 又拉起来。光停一次不够，
   * Folia 期间每 600ms 压一次；实例数 ≤ 5，成本可忽略。 */
  var guardTimer = 0;

  function clamp(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  /* 只有 blur / saturation / brightness 对 CSS 玻璃有意义。
   * 与 applyHomeLiquidGlassConfig 的换算同源：面板数值改到哪，观感连续。 */
  function buildFoliaGlassVars(fx) {
    var s = fx || {};
    var blurAmount = clamp(s.liquidGlassBlur, 0, 1, 0.70);
    var saturation = clamp(s.liquidGlassSaturation, 0, 1, 0.34);
    var brightness = clamp(s.liquidGlassBrightness, -0.5, 0.5, 0.04);
    var blurPx = Math.round(6 + blurAmount * 26);
    var sat = (1 + saturation * 2).toFixed(2);
    var bri = (0.94 + brightness).toFixed(2);
    /* 底色浓度跟着模糊走：越模糊底色越淡，否则 CSS 玻璃会比 WebGL 版发灰 */
    var alpha = (0.50 - blurAmount * 0.16).toFixed(2);
    return {
      filter: 'blur(' + blurPx + 'px) saturate(' + sat + ') brightness(' + bri + ')',
      bg: 'rgba(20,22,28,' + alpha + ')'
    };
  }

  function stopAllInstances() {
    var mgr = window._liquidGlassMgr;
    if (!mgr || !mgr._instances) return;
    Object.keys(mgr._instances).forEach(function (name) {
      var entry = mgr._instances[name];
      if (!entry || !entry.instance || !entry.instance._running) return;
      if (stoppedNames.indexOf(name) < 0) stoppedNames.push(name);
      entry.instance._running = false;
      if (entry.instance._rafId) {
        try { cancelAnimationFrame(entry.instance._rafId); } catch (_) {}
        entry.instance._rafId = null;
      }
    });
  }

  function startGuard() {
    if (guardTimer) return;
    guardTimer = setInterval(stopAllInstances, 600);
  }

  function stopGuard() {
    if (!guardTimer) return;
    clearInterval(guardTimer);
    guardTimer = 0;
  }

  function resumeInstances() {
    var mgr = window._liquidGlassMgr;
    var names = stoppedNames.slice();
    stoppedNames = [];
    if (!mgr || !mgr._instances) return;
    names.forEach(function (name) {
      var entry = mgr._instances[name];
      if (entry && entry.instance && typeof window.ensureLiquidGlassRunning === 'function') {
        window.ensureLiquidGlassRunning(entry.instance);
      }
    });
  }

  /* 拖滑块时由 applyAllLiquidGlassConfig 调用；非 Folia 世界直接返回 false。 */
  function applyFoliaCssGlass() {
    if (!enabled) return false;
    var vars = buildFoliaGlassVars(window.fx || {});
    try {
      var root = document.documentElement;
      root.style.setProperty('--lg-folia-filter', vars.filter);
      root.style.setProperty('--lg-folia-bg', vars.bg);
    } catch (_) {}
    // 面板是新打开的话实例可能刚被预热起来，再停一次（幂等）
    stopAllInstances();
    return true;
  }

  /* 面板里的说明条：Folia 下只有三维参数生效，不说清楚会被当成控件坏了 */
  function setHint(on) {
    var el = document.getElementById('fx-folia-glass-hint');
    if (el) el.hidden = !on;
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    document.body.classList.add(CSS_CLASS);
    applyFoliaCssGlass();
    startGuard();
    setHint(true);
    console.log('[LiquidGlass] Folia 世界：切 CSS backdrop-filter 玻璃');
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    stopGuard();
    setHint(false);
    document.body.classList.remove(CSS_CLASS);
    try {
      var root = document.documentElement;
      root.style.removeProperty('--lg-folia-filter');
      root.style.removeProperty('--lg-folia-bg');
    } catch (_) {}
    resumeInstances();
    // 用最后一次参数重建 data-config，别让停 rAF 期间改的值丢到下一帧
    if (typeof window.applyAllLiquidGlassConfig === 'function') {
      try { window.applyAllLiquidGlassConfig(); } catch (_) {}
    }
    console.log('[LiquidGlass] Folia 世界：恢复 WebGL 玻璃');
  }

  function sync() {
    if (!document.body) return;
    if (document.body.classList.contains('folia-world-active')) enable();
    else disable();
  }

  function start() {
    sync();
    var observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return observer;
  }

  window.applyFoliaCssGlass = applyFoliaCssGlass;
  window.buildFoliaGlassVars = buildFoliaGlassVars;
  window.__liquidGlassFoliaCss = {
    enable: enable,
    disable: disable,
    sync: sync,
    isEnabled: function () { return enabled; },
    stoppedCount: function () { return stoppedNames.length; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
