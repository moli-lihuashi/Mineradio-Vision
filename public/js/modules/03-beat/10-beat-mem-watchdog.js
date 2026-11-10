// ============================================================
//  渲染进程内存看门狗（诊断用，零功能耦合）
//  为什么存在：2026-10-25 06:10 那次 reason=oom 崩溃，minidump 只能看出
//  "7.7GB committed / 三大分配区"，但分不清是 V8 堆还是 ArrayBuffer 外部内存，
//  也没有任何时间序列能说明内存是什么时候、以什么速率涨上去的。
//  这个模块把 performance.memory + 音频分配计数按 5s 采样写进 localStorage
//  （崩溃后 leveldb 里还在），下次再崩就能直接读到增长曲线。
//  全程 fail-silent：任何异常都不能影响播放。
// ============================================================

(function (global) {
  'use strict';

  var KEY = 'mineradio-mem-watchdog-v1';
  var INTERVAL_MS = 5000;
  var MAX_SAMPLES = 144; // 5s × 144 = 12 分钟

  var stats = {
    offlineCtx: 0,     // OfflineAudioContext 构造次数（累计）
    decodeCalls: 0,    // decodeAudioData 调用次数
    decodeErrors: 0,
    decodeBytes: 0,    // 送进解码器的压缩字节总量
    decodedCount: 0,   // 成功解码次数
    decodedSec: 0,     // 解码出来的音频总时长（秒）
    workers: 0,        // new Worker 次数
    startedAt: Date.now()
  };

  // ---- 计数插桩（全部 try/catch 包裹，失败就退回原行为）----
  try {
    var RealOff = global.OfflineAudioContext;
    if (typeof RealOff === 'function') {
      var WrappedOff = function () {
        stats.offlineCtx++;
        return Reflect.construct(RealOff, arguments);
      };
      WrappedOff.prototype = RealOff.prototype;
      global.OfflineAudioContext = WrappedOff;
      if (global.webkitOfflineAudioContext) global.webkitOfflineAudioContext = WrappedOff;
    }
  } catch (_) {}

  try {
    var RealWorker = global.Worker;
    if (typeof RealWorker === 'function') {
      var WrappedWorker = function (url, opts) {
        stats.workers++;
        return new RealWorker(url, opts);
      };
      WrappedWorker.prototype = RealWorker.prototype;
      global.Worker = WrappedWorker;
    }
  } catch (_) {}

  try {
    var AudioCtx = global.AudioContext || global.webkitAudioContext;
    var proto = AudioCtx && AudioCtx.prototype;
    var origDecode = proto && proto.decodeAudioData;
    if (typeof origDecode === 'function') {
      proto.decodeAudioData = function (audioData, scb, ecb) {
        stats.decodeCalls++;
        var bytes = 0;
        try { bytes = (audioData && audioData.byteLength) || 0; } catch (_) {}
        stats.decodeBytes += bytes;
        function onOk(buf) {
          try {
            stats.decodedCount++;
            stats.decodedSec += (buf && isFinite(buf.duration) ? buf.duration : 0);
          } catch (_) {}
          if (typeof scb === 'function') { try { scb(buf); } catch (_) {} }
        }
        function onErr(e) {
          stats.decodeErrors++;
          if (typeof ecb === 'function') { try { ecb(e); } catch (_) {} }
        }
        if (typeof scb === 'function' || typeof ecb === 'function') {
          return origDecode.call(this, audioData, onOk, onErr);
        }
        var p = origDecode.call(this, audioData);
        if (p && typeof p.then === 'function') return p.then(onOk, onErr);
        return p;
      };
    }
  } catch (_) {}

  function currentSongTag() {
    try {
      if (typeof currentSong !== 'undefined' && currentSong) {
        return String(currentSong.name || currentSong.id || '') .slice(0, 40);
      }
    } catch (_) {}
    return '';
  }

  function sample() {
    var pm = null;
    try { pm = global.performance && global.performance.memory; } catch (_) {}
    if (!pm) return;
    var row = {
      t: Date.now(),
      heap: Math.round((pm.usedJSHeapSize || 0) / 1048576),
      total: Math.round((pm.totalJSHeapSize || 0) / 1048576),
      limit: Math.round((pm.jsHeapSizeLimit || 0) / 1048576),
      off: stats.offlineCtx,
      dec: stats.decodeCalls,
      derr: stats.decodeErrors,
      dmb: Math.round(stats.decodeBytes / 1048576),
      dsec: Math.round(stats.decodedSec),
      wrk: stats.workers,
      song: currentSongTag()
    };
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      var buf = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(buf)) buf = [];
      buf.push(row);
      while (buf.length > MAX_SAMPLES) buf.shift();
      global.localStorage.setItem(KEY, JSON.stringify(buf));
    } catch (_) {}
  }

  function start() {
    try {
      sample();
      setInterval(sample, INTERVAL_MS);
    } catch (_) {}
  }

  if (global.document && (global.document.readyState === 'complete' || global.document.readyState === 'interactive')) {
    start();
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  // 供控制台/诊断脚本手动读取
  global.Mineradio = global.Mineradio || {};
  global.Mineradio.memWatchdog = {
    stats: stats,
    sample: sample,
    read: function () {
      try {
        var raw = global.localStorage && global.localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (_) { return []; }
    },
    clear: function () {
      try { global.localStorage && global.localStorage.removeItem(KEY); } catch (_) {}
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
