/**
 * LiquidGlass 自适应性能监测器
 *
 * 设计目标：
 *  - 持续监测主线程帧率（rAF 间隔），判断 GPU/CPU 是否过载
 *  - 卡顿持续超过阈值时自动降级：禁用所有 LiquidGlass 实例，回退到 CSS backdrop-filter
 *  - 帧率恢复稳定后自动重新激活 LiquidGlass
 *  - 提供手动 API 供调试与强制控制
 *
 * 触发策略：
 *  - 滑动窗口 60 帧，计算 P95 帧间隔（更稳定，抗瞬时抖动）
 *  - 降级条件：P95 > 40ms（≈25fps）持续 3 秒
 *  - 恢复条件：P95 < 25ms（≈40fps）持续 10 秒
 *  - 冷却期：降级后至少 15 秒才能恢复；恢复后至少 30 秒才能再次降级
 *
 * 公开 API（window）：
 *  - setLiquidGlassAdaptive(bool)        启用/禁用自适应监测
 *  - forceLiquidGlassOff(bool)           强制关闭/恢复 LiquidGlass（覆盖自适应）
 *  - getLiquidGlassPerfInfo()            返回当前状态对象
 *
 * CSS 钩子：
 *  - body.lg-degraded                    降级状态：禁用 .lg-active 的透明背景，恢复 backdrop-filter
 *  - body.lg-adaptive-disabled           自适应已禁用
 */
(function () {
  'use strict';

  if (window._liquidGlassPerfController) return; // 防止重复初始化

  // ===== 参数 =====
  var WINDOW_SIZE = 60;              // 滑动窗口帧数
  var DEGRADE_P95_MS = 55;           // 降级阈值：P95 帧间隔 > 55ms（<18fps 才降级，重负载视觉预设不再误伤）
  var DEGRADE_HOLD_MS = 5000;        // 降级触发持续时长
  var RECOVER_P95_MS = 34;           // 恢复阈值：P95 帧间隔 < 34ms（≈29fps 即可恢复）
  var RECOVER_HOLD_MS = 6000;        // 恢复触发持续时长
  var DEGRADE_COOLDOWN_MS = 30000;   // 恢复后至少 30 秒才能再次降级
  var RECOVER_COOLDOWN_MS = 8000;    // 降级后至少 8 秒才能恢复
  var IDLE_THRESHOLD_MS = 200;       // 帧间隔 > 200ms 视为页面不可见/闲置，不计入统计
  var WARMUP_MS = 8000;              // 启动暖机：加载期帧率抖动不参与统计，避免误降级

  // ===== 状态 =====
  var enabled = true;                // 自适应开关
  var forcedOff = false;             // 手动强制关闭
  var degraded = false;              // 当前是否处于降级状态
  var frameDurations = [];           // 滑动窗口
  var lastFrameTime = 0;
  var degradeStartedAt = 0;          // 降级条件开始满足的时间戳
  var recoverStartedAt = 0;          // 恢复条件开始满足的时间戳
  var lastDegradeAt = 0;             // 上次降级时间戳
  var lastRecoverAt = 0;             // 上次恢复时间戳
  var rafId = null;
  var lastP95 = 0;

  // ===== 工具：计算 P95 =====
  function computeP95(arr) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
  }

  // ===== 实例收集：从 LiquidGlassManager 获取所有已注册实例 =====
  function getManager() {
    return window._liquidGlassMgr || null;
  }

  function getAllInstanceEntries() {
    var mgr = getManager();
    if (!mgr || !mgr._instances) return [];
    return Object.keys(mgr._instances).map(function (k) { return mgr._instances[k]; });
  }

  function ensureInstanceRunning(instance) {
    if (!instance) return;
    if (typeof window.ensureLiquidGlassRunning === 'function') {
      window.ensureLiquidGlassRunning(instance);
      return;
    }
    try {
      instance._running = true;
      if (instance._globalDirty !== undefined) instance._globalDirty = true;
      if (typeof instance._renderLoop === 'function' && !instance._rafId) {
        instance._rafId = requestAnimationFrame(function () { instance._renderLoop(); });
      }
    } catch (_) {}
  }

  // ===== 降级 / 恢复执行 =====
  function applyDegrade() {
    if (degraded) return;
    degraded = true;
    lastDegradeAt = Date.now();
    recoverStartedAt = 0;
    document.body.classList.add('lg-degraded');
    console.warn('[LiquidGlass Perf] Degrading LiquidGlass due to low FPS (P95=' + lastP95.toFixed(1) + 'ms)');

    // 通知所有实例进入低功耗：通过 body 类让 CSS 接管，保留实例但不强制重渲染
    // 这里不直接 destroy 实例，避免恢复时重新捕获的开销
    // 仅标记 _globalDirty=false 让 rAF 循环跳过重渲染
    getAllInstanceEntries().forEach(function (entry) {
      if (entry.instance) {
        if (entry.instance._running !== undefined) entry.instance._running = false;
        if (entry.instance._rafId && typeof entry.instance._stopRender === 'function') {
          try { entry.instance._stopRender(); } catch (e) {}
        } else if (entry.instance._rafId) {
          try { cancelAnimationFrame(entry.instance._rafId); entry.instance._rafId = null; } catch (e) {}
        }
      }
    });
  }

  function applyRecover() {
    if (!degraded) return;
    degraded = false;
    lastRecoverAt = Date.now();
    degradeStartedAt = 0;
    document.body.classList.remove('lg-degraded');
    console.info('[LiquidGlass Perf] Recovering LiquidGlass (P95=' + lastP95.toFixed(1) + 'ms)');

    // 重新启动所有实例的渲染循环
    getAllInstanceEntries().forEach(function (entry) {
      if (entry.instance) {
        ensureInstanceRunning(entry.instance);
        if (entry.elements && entry.instance.markChanged) {
          entry.elements.forEach(function (el) { entry.instance.markChanged(el); });
        }
      }
    });
    // 首页卡片可能在降级时被 detach：显式拉回
    if (typeof window.refreshHomeLiquidGlassAfterPerf === 'function') {
      try { window.refreshHomeLiquidGlassAfterPerf(); } catch (_) {}
    }
  }

  // ===== 主监测循环 =====
  var startedAt = 0;
  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (!startedAt) startedAt = now;

    if (!lastFrameTime) {
      lastFrameTime = now;
      return;
    }
    var dt = now - lastFrameTime;
    lastFrameTime = now;

    // 启动暖机：加载期（splash/首屏构建）帧率抖动不参与统计
    if (now - startedAt < WARMUP_MS) {
      return;
    }

    // 页面不可见或长任务造成的超长帧不计入统计
    if (dt > IDLE_THRESHOLD_MS) {
      return;
    }

    // 滑动窗口
    frameDurations.push(dt);
    if (frameDurations.length > WINDOW_SIZE) frameDurations.shift();

    // 窗口未满，跳过判定
    if (frameDurations.length < WINDOW_SIZE * 0.5) return;

    var p95 = computeP95(frameDurations);
    lastP95 = p95;
    var nowMs = Date.now();

    if (!enabled || forcedOff) return;

    // 降级判定
    if (!degraded) {
      if (p95 > DEGRADE_P95_MS) {
        if (!degradeStartedAt) degradeStartedAt = nowMs;
        if (nowMs - degradeStartedAt >= DEGRADE_HOLD_MS) {
          // 检查冷却期
          if (lastRecoverAt === 0 || nowMs - lastRecoverAt >= DEGRADE_COOLDOWN_MS) {
            applyDegrade();
          }
        }
      } else {
        degradeStartedAt = 0;
      }
    } else {
      // 恢复判定
      if (p95 < RECOVER_P95_MS) {
        if (!recoverStartedAt) recoverStartedAt = nowMs;
        if (nowMs - recoverStartedAt >= RECOVER_HOLD_MS) {
          // 检查冷却期
          if (nowMs - lastDegradeAt >= RECOVER_COOLDOWN_MS) {
            applyRecover();
          }
        }
      } else {
        recoverStartedAt = 0;
      }
    }
  }

  // ===== 强制关闭：立即降级并不再自动恢复 =====
  function applyForceOff() {
    if (forcedOff) {
      applyDegrade();
      document.body.classList.add('lg-forced-off');
    } else {
      document.body.classList.remove('lg-forced-off');
      // 不立即恢复，让自适应循环根据帧率判断
    }
  }

  // ===== 公开 API =====
  window.setLiquidGlassAdaptive = function (on) {
    enabled = !!on;
    if (!enabled) {
      document.body.classList.add('lg-adaptive-disabled');
      // 禁用自适应时，清除已有降级状态（除非强制关闭）
      if (!forcedOff && degraded) {
        applyRecover();
      }
    } else {
      document.body.classList.remove('lg-adaptive-disabled');
    }
    console.info('[LiquidGlass Perf] Adaptive ' + (enabled ? 'enabled' : 'disabled'));
  };

  window.forceLiquidGlassOff = function (off) {
    forcedOff = !!off;
    applyForceOff();
    console.info('[LiquidGlass Perf] Force ' + (forcedOff ? 'OFF' : 'AUTO'));
  };

  window.getLiquidGlassPerfInfo = function () {
    return {
      enabled: enabled,
      forcedOff: forcedOff,
      degraded: degraded,
      p95Ms: Math.round(lastP95 * 10) / 10,
      approxFps: lastP95 > 0 ? Math.round(1000 / lastP95) : 0,
      windowSize: frameDurations.length,
      lastDegradeAt: lastDegradeAt,
      lastRecoverAt: lastRecoverAt,
      instances: Object.keys(window._liquidGlassMgr ? window._liquidGlassMgr._instances : {})
    };
  };

  // ===== 启动 =====
  function startMonitor() {
    if (rafId) return;
    lastFrameTime = 0;
    frameDurations = [];
    rafId = requestAnimationFrame(tick);
    console.info('[LiquidGlass Perf] Monitor started (degrade@P95>' + DEGRADE_P95_MS + 'ms for ' + (DEGRADE_HOLD_MS / 1000) + 's, recover@P95<' + RECOVER_P95_MS + 'ms for ' + (RECOVER_HOLD_MS / 1000) + 's)');
  }

  // 页面可见性变化时重置窗口（避免长时间隐藏后第一帧超长导致误判）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      frameDurations = [];
      lastFrameTime = 0;
      degradeStartedAt = 0;
      recoverStartedAt = 0;
    }
  });

  // 延迟启动，等待 LiquidGlass 实例初始化完成
  if (document.readyState === 'complete') {
    setTimeout(startMonitor, 4000);
  } else {
    window.addEventListener('load', function () {
      setTimeout(startMonitor, 4000);
    });
  }

  window._liquidGlassPerfController = {
    start: startMonitor,
    applyDegrade: applyDegrade,
    applyRecover: applyRecover,
    isDegraded: function () { return degraded; }
  };
})();
