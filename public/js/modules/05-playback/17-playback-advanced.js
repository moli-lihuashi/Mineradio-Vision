// ============================================================
//  播放高级设置（对标酷狗：变速不变调 / 输出设备 / 淡出与预载时长）
// ------------------------------------------------------------
//  三项能力共用一份存档与一个快捷菜单折叠面板：
//
//    - 变速不变调：HTMLMediaElement.playbackRate + preservesPitch
//    - 输出设备切换：navigator.mediaDevices.enumerateDevices + setSinkId
//    - 曲末淡出提前量 / 无缝预载窗口：由本模块持有数值，08 与 16 通过
//      getter 读取，不改动它们各自的存档结构。
//
//  ★ 变速不只是写一个属性：媒体时间是「歌曲秒」，墙钟时间是「真实秒」。
//    曲末淡出与无缝预载都用 setTimeout 排程，必须把剩余媒体秒除以 rate，
//    否则 1.5x 时淡出会迟到、预载窗口会缩水。这两处换算在 08 / 16 里。
//
//  默认全部不改变既有行为：rate=1、跟随系统默认设备、时长沿用原常量。
// ============================================================

(function (global) {
  'use strict';

  var NS = global.Mineradio = global.Mineradio || {};
  var STORE_KEY = 'mineradio-playback-advanced-v1';
  var RATE_MIN = 0.5, RATE_MAX = 2;
  var LOOKAHEAD_MIN_SEC = 0.5, LOOKAHEAD_MAX_SEC = 6;
  var LEAD_MIN_SEC = 5, LEAD_MAX_SEC = 60;
  var DEFAULT_LOOKAHEAD_SEC = 1.8;   // 与 08 的 TRACK_END_FADE_LOOKAHEAD_SEC 一致
  var DEFAULT_LEAD_SEC = 18;         // 与 16 的 GAPLESS_HANDOFF_LEAD_SEC 一致
  var RATE_PRESETS = [
    { name: '0.75x', value: 0.75 },
    { name: '1.0x', value: 1 },
    { name: '1.25x', value: 1.25 },
    { name: '1.5x', value: 1.5 }
  ];

  function clamp(v, min, max, fallback) {
    v = Number(v);
    if (!isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }
  function round2(v) { return Math.round(Number(v) * 100) / 100; }
  function el(id) {
    return global.document && global.document.getElementById
      ? global.document.getElementById(id) : null;
  }
  function doc() { return global.document; }

  function defaultSettings() {
    return {
      rate: 1,
      preservePitch: true,
      lookaheadSec: DEFAULT_LOOKAHEAD_SEC,
      gaplessLeadSec: DEFAULT_LEAD_SEC,
      outputDeviceId: '',
      outputDeviceLabel: ''
    };
  }

  function readSettings() {
    var out = defaultSettings();
    try {
      var raw = JSON.parse(global.localStorage.getItem(STORE_KEY) || '{}') || {};
      out.rate = round2(clamp(raw.rate, RATE_MIN, RATE_MAX, 1));
      out.preservePitch = raw.preservePitch !== false;
      out.lookaheadSec = round2(clamp(raw.lookaheadSec, LOOKAHEAD_MIN_SEC, LOOKAHEAD_MAX_SEC, DEFAULT_LOOKAHEAD_SEC));
      out.gaplessLeadSec = Math.round(clamp(raw.gaplessLeadSec, LEAD_MIN_SEC, LEAD_MAX_SEC, DEFAULT_LEAD_SEC));
      if (typeof raw.outputDeviceId === 'string') out.outputDeviceId = raw.outputDeviceId.slice(0, 256);
      if (typeof raw.outputDeviceLabel === 'string') out.outputDeviceLabel = raw.outputDeviceLabel.slice(0, 120);
    } catch (_) {}
    return out;
  }

  function saveSettings() {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  var settings = readSettings();
  var boundMedia = null;
  var applyingRate = false;
  var devices = [];
  var unsupportedSink = false;
  var deviceStatus = '';

  // ---- 变速 --------------------------------------------------------------

  /* 只对主 audio 元素写速率。Cuefield 的 B deck 是独立 new Audio()，
     AutoMix 执行期间会自己设 0.94~1.06 做 beatmatch，不归本模块管。 */
  function currentMedia() {
    return (typeof audio !== 'undefined' && audio) ? audio : null;
  }

  function applyToMedia(media) {
    // 优先用已绑定的元素：音频图重建时 bindMedia 可能先于全局 audio 变量切换
    media = media || boundMedia || currentMedia();
    if (!media) return false;
    applyingRate = true;
    try {
      media.playbackRate = settings.rate;
      // defaultPlaybackRate 决定 load() 之后恢复成多少：只写 playbackRate 会被换源清空
      media.defaultPlaybackRate = settings.rate;
      media.preservesPitch = settings.preservePitch;
      // 老前缀兜底（部分 WebKit / 旧 Chromium）
      try { media.mozPreservesPitch = settings.preservePitch; } catch (__) {}
      try { media.webkitPreservesPitch = settings.preservePitch; } catch (__) {}
    } catch (_) {
      applyingRate = false;
      return false;
    }
    applyingRate = false;
    return true;
  }

  function onMediaEvent() { applyToMedia(boundMedia); }

  function onRateChange() {
    if (applyingRate) return;
    // AutoMix 执行期间让路给 beatmatch，避免两边来回抢写 playbackRate
    if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return;
    var media = boundMedia || currentMedia();
    if (media && Math.abs(Number(media.playbackRate) - settings.rate) > 0.001) applyToMedia(media);
  }

  function unbindMedia() {
    if (!boundMedia) return;
    ['loadedmetadata', 'play', 'emptied', 'durationchange'].forEach(function (n) {
      boundMedia.removeEventListener(n, onMediaEvent);
    });
    boundMedia.removeEventListener('ratechange', onRateChange);
    boundMedia = null;
  }

  function bindMedia(media) {
    if (media && boundMedia === media) { applyToMedia(media); return; }
    unbindMedia();
    if (!media) return;
    boundMedia = media;
    ['loadedmetadata', 'play', 'emptied', 'durationchange'].forEach(function (n) {
      media.addEventListener(n, onMediaEvent);
    });
    media.addEventListener('ratechange', onRateChange);
    applyToMedia(media);
  }

  function setRate(value) {
    settings.rate = round2(clamp(value, RATE_MIN, RATE_MAX, 1));
    saveSettings();
    applyToMedia();
    syncUi();
    return settings.rate;
  }
  function setPreset(value) { return setRate(value); }
  function togglePreservePitch() {
    settings.preservePitch = !settings.preservePitch;
    saveSettings();
    applyToMedia();
    syncUi();
    return settings.preservePitch;
  }

  // ---- 时长 --------------------------------------------------------------
  function setLookaheadSec(value) {
    settings.lookaheadSec = round2(clamp(value, LOOKAHEAD_MIN_SEC, LOOKAHEAD_MAX_SEC, DEFAULT_LOOKAHEAD_SEC));
    saveSettings(); syncUi();
    return settings.lookaheadSec;
  }
  function setGaplessLeadSec(value) {
    settings.gaplessLeadSec = Math.round(clamp(value, LEAD_MIN_SEC, LEAD_MAX_SEC, DEFAULT_LEAD_SEC));
    saveSettings(); syncUi();
    return settings.gaplessLeadSec;
  }

  /* 08 / 16 通过这几个 getter 取值，不碰它们各自的存档结构 */
  function getRate() { return settings.rate; }
  function getLookaheadSec() { return settings.lookaheadSec; }
  function getGaplessLeadSec() { return settings.gaplessLeadSec; }
  function wallSeconds(mediaSeconds) {
    var r = Number(settings.rate);
    return mediaSeconds / (isFinite(r) && r > 0 ? r : 1);
  }

  // ---- 输出设备 ----------------------------------------------------------
  function mediaDevices() {
    return (global.navigator && global.navigator.mediaDevices) ? global.navigator.mediaDevices : null;
  }
  function sinkSupported(media) {
    media = media || currentMedia();
    return !!(media && typeof media.setSinkId === 'function');
  }

  function applyOutputDevice(id) {
    id = typeof id === 'string' ? id : '';
    var media = currentMedia();
    if (!media || !sinkSupported(media)) {
      unsupportedSink = true;
      deviceStatus = '当前环境不支持输出设备切换，使用系统默认设备';
      syncUi();
      return Promise.resolve(false);
    }
    unsupportedSink = false;
    var pending;
    try { pending = media.setSinkId(id); } catch (e) {
      deviceStatus = '切换失败：' + (e && e.name ? e.name : 'unknown');
      syncUi();
      return Promise.resolve(false);
    }
    return Promise.resolve(pending).then(function () {
      settings.outputDeviceId = id;
      var found = devices.filter(function (d) { return d.deviceId === id; })[0];
      settings.outputDeviceLabel = id === '' ? '跟随系统默认' : (found && found.label) || '已选输出设备';
      saveSettings();
      deviceStatus = id === '' ? '跟随系统默认设备' : ('已切换到 ' + settings.outputDeviceLabel);
      syncUi();
      return true;
    }).catch(function (e) {
      deviceStatus = '切换失败：' + (e && e.name ? e.name : 'unknown') + '（需设备权限或未连接）';
      syncUi();
      return false;
    });
  }

  function refreshDevices() {
    var md = mediaDevices();
    if (!md || typeof md.enumerateDevices !== 'function') {
      unsupportedSink = true;
      devices = [];
      deviceStatus = '当前环境不提供设备枚举';
      syncUi();
      return Promise.resolve(devices);
    }
    return Promise.resolve(md.enumerateDevices()).then(function (list) {
      devices = (list || []).filter(function (d) { return d && d.kind === 'audiooutput'; })
        .map(function (d, i) {
          return {
            deviceId: String(d.deviceId || ''),
            label: String(d.label || '') || ('扬声器 ' + (i + 1)),
            groupId: String(d.groupId || '')
          };
        });
      // 权限未授予时 enumerateDevices 只给 '' 占位；保留「跟随系统默认」
      if (!devices.some(function (d) { return d.deviceId === ''; })) {
        devices.unshift({ deviceId: '', label: '跟随系统默认', groupId: '' });
      }
      if (settings.outputDeviceId && !devices.some(function (d) { return d.deviceId === settings.outputDeviceId; })) {
        // 设备被拔掉：回落默认，避免下次启动指向不存在的 id
        settings.outputDeviceId = '';
        settings.outputDeviceLabel = '跟随系统默认';
        saveSettings();
      }
      syncUi();
      return devices;
    }).catch(function () {
      devices = [{ deviceId: '', label: '跟随系统默认', groupId: '' }];
      deviceStatus = '设备枚举失败';
      syncUi();
      return devices;
    });
  }

  /* Chromium 需要 selectAudioOutput 才能拿到非默认设备的 label/权限。
     不可用时仍可用 enumerateDevices 得到的 deviceId 列表。 */
  function pickOutputDevice() {
    var md = mediaDevices();
    if (md && typeof md.selectAudioOutput === 'function') {
      try {
        return Promise.resolve(md.selectAudioOutput()).then(function (picked) {
          var id = picked && picked.deviceId ? String(picked.deviceId) : '';
          return refreshDevices().then(function () { return applyOutputDevice(id); });
        }).catch(function () { return refreshDevices(); });
      } catch (_) {}
    }
    return refreshDevices();
  }

  function onDeviceChange() {
    refreshDevices().then(function () {
      if (settings.outputDeviceId) applyOutputDevice(settings.outputDeviceId);
    });
  }

  function bindDeviceEvents() {
    var md = mediaDevices();
    if (md && typeof md.addEventListener === 'function') {
      try { md.addEventListener('devicechange', onDeviceChange); } catch (_) {}
    }
  }

  // ---- UI ----------------------------------------------------------------
  function toggleButton(id, on) {
    var b = el(id);
    if (!b) return;
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function setText(id, text) {
    var n = el(id);
    if (n) n.textContent = String(text);
  }

  function renderDeviceOptions() {
    var select = el('playback-output-device');
    if (!select) return;
    var wanted = settings.outputDeviceId;
    var html = '';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      html += '<option value="' + d.deviceId.replace(/"/g, '&quot;') + '"' +
        (d.deviceId === wanted ? ' selected' : '') + '>' +
        String(d.label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
    }
    if (!html) html = '<option value="">跟随系统默认</option>';
    select.innerHTML = html;
    select.disabled = unsupportedSink;
  }

  function syncUi() {
    if (!doc() || !doc().getElementById) return;
    var rate = el('playback-speed-range');
    if (rate) rate.value = String(settings.rate);
    setText('playback-speed-value', settings.rate.toFixed(2) + 'x');
    toggleButton('playback-preserve-pitch-toggle', settings.preservePitch);
    var presets = el('playback-speed-presets');
    if (presets && presets.querySelectorAll) {
      Array.prototype.forEach.call(presets.querySelectorAll('button[data-rate]'), function (b) {
        b.classList.toggle('active', Math.abs(Number(b.getAttribute('data-rate')) - settings.rate) < 0.001);
      });
    }
    var look = el('playback-lookahead-range');
    if (look) look.value = String(settings.lookaheadSec);
    setText('playback-lookahead-value', settings.lookaheadSec.toFixed(1) + 's');
    var lead = el('playback-lead-range');
    if (lead) lead.value = String(settings.gaplessLeadSec);
    setText('playback-lead-value', settings.gaplessLeadSec + 's');
    renderDeviceOptions();
    setText('playback-output-status', deviceStatus || (settings.outputDeviceId
      ? '当前：' + (settings.outputDeviceLabel || '已选输出设备')
      : '跟随系统默认设备'));
    var summary = el('playback-advanced-summary');
    if (summary) summary.textContent = settings.rate.toFixed(2) + 'x · ' +
      (settings.preservePitch ? '保持音调' : '随速变调');
  }

  function buildUi() {
    var root = el('playback-advanced-fold');
    if (!root || root.getAttribute('data-built') === '1') return;
    root.setAttribute('data-built', '1');

    var rate = el('playback-speed-range');
    if (rate) rate.addEventListener('input', function (e) { setRate(e.target.value); });
    var presets = el('playback-speed-presets');
    if (presets) presets.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-rate]') : null;
      if (b) setPreset(b.getAttribute('data-rate'));
    });
    var pitch = el('playback-preserve-pitch-toggle');
    if (pitch) pitch.addEventListener('click', togglePreservePitch);
    var look = el('playback-lookahead-range');
    if (look) look.addEventListener('input', function (e) { setLookaheadSec(e.target.value); });
    var lead = el('playback-lead-range');
    if (lead) lead.addEventListener('input', function (e) { setGaplessLeadSec(e.target.value); });
    var select = el('playback-output-device');
    if (select) select.addEventListener('change', function (e) { applyOutputDevice(e.target.value); });
    var pick = el('playback-output-pick');
    if (pick) pick.addEventListener('click', pickOutputDevice);
    var reset = el('playback-output-default');
    if (reset) reset.addEventListener('click', function () { applyOutputDevice(''); });

    devices = [{ deviceId: '', label: '跟随系统默认', groupId: '' }];
    syncUi();
    bindDeviceEvents();
    refreshDevices().then(function () {
      if (settings.outputDeviceId) applyOutputDevice(settings.outputDeviceId);
    });
    bindMedia(currentMedia());
  }

  NS.playbackAdvanced = {
    applyToMedia: applyToMedia,
    bindMedia: bindMedia,
    getRate: getRate,
    getLookaheadSec: getLookaheadSec,
    getGaplessLeadSec: getGaplessLeadSec,
    wallSeconds: wallSeconds,
    setRate: setRate,
    setPreset: setPreset,
    togglePreservePitch: togglePreservePitch,
    setLookaheadSec: setLookaheadSec,
    setGaplessLeadSec: setGaplessLeadSec,
    refreshDevices: refreshDevices,
    applyOutputDevice: applyOutputDevice,
    pickOutputDevice: pickOutputDevice,
    buildUi: buildUi,
    syncUi: syncUi,
    getSettings: function () {
      return {
        rate: settings.rate,
        preservePitch: settings.preservePitch,
        lookaheadSec: settings.lookaheadSec,
        gaplessLeadSec: settings.gaplessLeadSec,
        outputDeviceId: settings.outputDeviceId,
        outputDeviceLabel: settings.outputDeviceLabel
      };
    },
    getStatus: function () {
      return {
        rate: settings.rate,
        preservePitch: settings.preservePitch,
        mediaRate: currentMedia() ? Number(currentMedia().playbackRate) : null,
        mediaDefaultRate: currentMedia() ? Number(currentMedia().defaultPlaybackRate) : null,
        hasMedia: !!currentMedia(),
        boundMedia: !!boundMedia,
        sinkSupported: sinkSupported(),
        unsupportedSink: unsupportedSink,
        devices: devices.length,
        deviceStatus: deviceStatus,
        lookaheadSec: settings.lookaheadSec,
        gaplessLeadSec: settings.gaplessLeadSec
      };
    },
    _test: { settings: settings, devices: function () { return devices; } }
  };

  // 供 index.html 内联事件与自动化探针使用
  global.setPlaybackSpeedRate = setRate;
  global.setPlaybackSpeedPreset = setPreset;
  global.togglePlaybackPreservePitch = togglePreservePitch;
  global.setTrackEndLookaheadSec = setLookaheadSec;
  global.setGaplessLeadSec = setGaplessLeadSec;
  global.refreshPlaybackOutputDevices = refreshDevices;
  global.pickPlaybackOutputDevice = pickOutputDevice;
  global.followSystemOutputDevice = function () { return applyOutputDevice(''); };

  if (doc()) {
    if (doc().readyState === 'loading') {
      doc().addEventListener('DOMContentLoaded', buildUi, { once: true });
    } else {
      buildUi();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
