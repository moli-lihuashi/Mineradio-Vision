// ============================================================
//  性能仪表盘（FX 面板折叠区）
//  数据源：window.__mineradioRenderPerf（主循环帧率采样）
//         getGpuThrottleSnapshot()（GPU 节流状态）
//         performance.memory（Chromium JS 堆）
// ============================================================
var perfDashSampleAt = 0;
var perfDashLastText = '';

function perfDashHeapText() {
  var mem = performance.memory;
  if (!mem || !mem.usedJSHeapSize) return '';
  var used = mem.usedJSHeapSize / 1048576;
  return ' · JS堆 ' + used.toFixed(0) + 'MB';
}

function perfDashThrottleText() {
  if (typeof getGpuThrottleSnapshot !== 'function') return '';
  var snap = getGpuThrottleSnapshot() || {};
  if (!snap.active) return '';
  var reasonMap = {
    'battery-low': '电池电量低',
    'battery-lowspec': '电池+低端GPU',
    'forced': '手动强制',
    'gpu-pressure': '帧压偏高',
    'lowspec': '低端GPU'
  };
  var parts = String(snap.reason || '').split(',').filter(Boolean)
    .map(function (key) { return reasonMap[key] || key; });
  return ' · 节流中(' + (parts.join('+') || '未知') + ')';
}

function perfDashHintText(fps, targetFps) {
  if (!fps || !targetFps) return '';
  if (fps < Math.max(20, targetFps * 0.55)) {
    return '\n提示：帧率明显低于目标，可开启 GPU 节流或降低画质档位';
  }
  return '';
}

function updatePerfDashboard(force) {
  var el = document.getElementById('perf-dashboard-body');
  if (!el) return;
  var nowMs = performance.now();
  if (!force && nowMs - perfDashSampleAt < 1000) return;
  perfDashSampleAt = nowMs;
  var rp = window.__mineradioRenderPerf || {};
  var fps = Number(rp.fps) || 0;
  var targetFps = Number(rp.targetFps) || 0;
  var modeLabel = rp.mode === 'vsync' ? '跟随屏幕' : (rp.mode ? (String(rp.mode).replace('fps', ' fps')) : '--');
  var lines = 'FPS ' + (fps > 0 ? String(fps) : '--') +
    (targetFps > 0 ? ' / 目标 ' + targetFps : '') +
    ' · 渲染模式 ' + modeLabel +
    perfDashThrottleText() +
    perfDashHeapText() +
    perfDashHintText(fps, targetFps);
  if (lines !== perfDashLastText) {
    el.textContent = lines;
    perfDashLastText = lines;
  }
}

setInterval(function () {
  if (document.hidden) return;
  if (!document.getElementById('perf-dashboard-body')) return;
  updatePerfDashboard(true);
}, 1000);
