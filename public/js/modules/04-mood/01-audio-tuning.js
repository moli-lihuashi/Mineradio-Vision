// ============================================================
//  音频调音链（对标酷狗 DSPPlugin / EQSection / ReplayGainCalc）
// ------------------------------------------------------------
//  四项能力全部落在**独立节点链**上，插在 audioTap 与既有 gainNode 之间：
//
//    input → [10×Biquad] → preamp → loudness → antiClick → panner → exit → gainNode
//
//  ★ 绝不碰 gainNode：音量、播放/暂停淡变、曲末淡出、Cuefield A deck 淡出
//    全都挂在 gainNode 上，本模块只管自己的节点，互不干扰。
//
//  - 10 段 EQ + 前级增益：对标 KuGou.ini 的 EQGain0..9 / Preamp / EnableEQ
//  - 响度对齐 ReplayGain：优先曲目元数据，缺省时用 analyser 时域 RMS 自适应
//  - 声道平衡：对标 KuGou.ini 的 Balance=50
//  - 防爆音：对标 BQResampler 的 ratio changed fade + AudioFading::Refresh
//
//  实现全部是自己的 Web Audio 代码，只借鉴机制与参数结构。
// ============================================================

(function (global) {
  'use strict';

  var NS = global.Mineradio = global.Mineradio || {};
  var STORE_KEY = 'mineradio-audio-tuning-v1';
  var EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  var EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  var EQ_LIMIT_DB = 12;
  var PREAMP_LIMIT_DB = 12;
  var LOUDNESS_LIMIT_DB = 6;
  var TARGET_RMS_DB = -18;
  var RMS_DELAY_MS = 420;
  var RMS_INTERVAL_MS = 180;
  var RMS_SAMPLES = 10;
  var ANTICLICK_OUT_MS = 8;
  var ANTICLICK_IN_MS = 12;
  var ANTICLICK_TIMEOUT_MS = 900;

  var PRESETS = {
    flat:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop:    [-1, 1, 3, 4, 2, -1, -1, 1, 3, 3],
    rock:   [4, 3, 1, -2, -3, 1, 3, 4, 4, 3],
    vocal:  [-2, -1, 0, 1, 3, 5, 4, 2, 0, -1]
  };
  var PRESET_LABELS = { flat: '平坦', pop: '流行', rock: '摇滚', vocal: '人声' };

  function clamp(v, min, max) {
    v = Number(v);
    if (!isFinite(v)) v = 0;
    return Math.max(min, Math.min(max, v));
  }
  function dbToLinear(db) { return Math.pow(10, clamp(db, -60, 60) / 20); }
  function fmtDb(db) {
    var v = Math.round(Number(db) * 10) / 10;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  }
  function zeros() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function parseGainDb(raw) {
    if (raw == null || raw === '') return null;
    // music-metadata 某些版本给 { dB }，tag 字符串给 "-6.54 dB"，两者都要能吃
    if (typeof raw === 'object') {
      raw = isFinite(raw.dB) ? raw.dB : (isFinite(raw.gain) ? raw.gain : null);
      if (raw == null) return null;
    }
    var n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/dB/gi, '').trim());
    if (!isFinite(n)) return null;
    return clamp(n, -24, 24);
  }

  function defaultSettings() {
    return {
      eqEnabled: true,
      replayGainEnabled: true,
      antiClickEnabled: true,
      eq: zeros(),
      preampDb: 0,
      balance: 0,
      preset: 'flat'
    };
  }

  function readSettings() {
    var out = defaultSettings();
    try {
      var raw = JSON.parse(global.localStorage.getItem(STORE_KEY) || '{}') || {};
      if (raw.eqEnabled === false) out.eqEnabled = false;
      if (raw.replayGainEnabled === false) out.replayGainEnabled = false;
      if (raw.antiClickEnabled === false) out.antiClickEnabled = false;
      if (Array.isArray(raw.eq)) {
        for (var i = 0; i < EQ_BANDS.length; i++) out.eq[i] = clamp(raw.eq[i], -EQ_LIMIT_DB, EQ_LIMIT_DB);
      }
      out.preampDb = clamp(raw.preampDb, -PREAMP_LIMIT_DB, PREAMP_LIMIT_DB);
      out.balance = clamp(raw.balance, -1, 1);
      // 'custom' 也要能回读：拖过 EQ 后预设名是 custom，否则刷新会显示「平坦」却是自定义曲线
      if (typeof raw.preset === 'string' && (PRESETS[raw.preset] || raw.preset === 'custom')) out.preset = raw.preset;
    } catch (_) {}
    return out;
  }

  function saveSettings() {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  var settings = readSettings();
  var chain = null;
  var boundMedia = null;
  var analyserNode = null;
  var sampleBuf = null;
  var runtime = {
    session: 0,
    measured: false,
    metaDb: null,
    appliedDb: 0,
    samples: [],
    startTimer: 0,
    sampleTimer: 0,
    antiClickTimer: 0
  };

  /* 显式清排程 + 短 ramp：绝不留下永不结束的自动化。
     上一轮 applyVolumeToAudio 的 setTargetAtTime 就是被它盖掉淡变的。 */
  function setParam(param, value, rampMs) {
    if (!param) return;
    var now = chain && chain.ctx ? (chain.ctx.currentTime || 0) : 0;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      if (rampMs > 0) param.linearRampToValueAtTime(value, now + rampMs / 1000);
      else param.value = value;
    } catch (_) {
      try { param.value = value; } catch (__) {}
    }
  }

  function applyAll(rampMs) {
    if (!chain) return;
    var ramp = rampMs == null ? 30 : rampMs;
    for (var i = 0; i < chain.eq.length; i++) {
      setParam(chain.eq[i].gain, settings.eqEnabled ? settings.eq[i] : 0, ramp);
    }
    setParam(chain.preamp.gain, dbToLinear(settings.eqEnabled ? settings.preampDb : 0), ramp);
    setParam(chain.loudness.gain, dbToLinear(settings.replayGainEnabled ? runtime.appliedDb : 0), ramp);
    if (chain.panner) setParam(chain.panner.pan, settings.balance, ramp);
    /* 故意不碰 antiClick.gain：它是 seek/换源的 8ms 短淡变，
       用户拖 EQ 或响度自适应收敛时都不能把它强行拉回 1。 */
  }

  /* ── 歌曲过渡的临时声像（18-track-transition.js 调用）──────────────────
     只借 panner 节点做一次短扫，绝不写 settings.balance / localStorage：
     过渡结束后 clearTransitionPan 会把声像收回用户设定的平衡值。
     这样「立体声过渡」不会悄悄改掉用户调音面板里的平衡存档。 */
  function setTransitionPan(pan, rampMs) {
    if (!chain || !chain.panner) return false;
    setParam(chain.panner.pan, clamp(pan, -1, 1), Math.max(0, Number(rampMs) || 0));
    return true;
  }
  function clearTransitionPan(rampMs) {
    if (!chain || !chain.panner) return false;
    setParam(chain.panner.pan, settings.balance, Math.max(0, Number(rampMs) || 0));
    return true;
  }

  /* 测量旁路必须挂在调音链【之前】。若挂在链后，响度增益会改变被测 RMS，
     自适应算法就会追着自己改出来的值跑，形成正反馈。 */
  function connectMeter(inputNode) {
    if (!chain.meter || !chain.ctx) return;
    try { inputNode.connect(chain.meter); } catch (_) {}
  }
  function disconnectMeter(inputNode) {
    if (!chain.meter || !inputNode) return;
    try { inputNode.disconnect(chain.meter); } catch (_) {}
  }

  function install(ctx, inputNode) {
    if (!ctx || !inputNode) return inputNode;
    // initAudio() 每次都 new AudioContext()：ctx 变了必须先拆旧链，
    // 否则旧链节点仍挂在废弃 ctx 上造成泄漏（且旧 input 连边残留）
    if (chain && chain.ctx !== ctx) detach();
    if (chain && chain.ctx === ctx && chain.exit) {
      // 换源重建音频图时 source 可能是新的 MediaElementSource：只重接首段，不重建整链
      if (chain.input !== inputNode) {
        try { chain.input.disconnect(chain.eq[0]); } catch (_) {}
        disconnectMeter(chain.input);
        try { inputNode.connect(chain.eq[0]); } catch (_) {}
        connectMeter(inputNode);
        chain.input = inputNode;
      }
      return chain.exit;
    }
    var nyquistGuard = Math.max(1000, (Number(ctx.sampleRate) || 44100) / 2 - 200);
    var eq = [];
    for (var i = 0; i < EQ_BANDS.length; i++) {
      var f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : (i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking');
      f.frequency.value = Math.min(EQ_BANDS[i], nyquistGuard);
      f.Q.value = 1;
      f.gain.value = 0;
      eq.push(f);
    }
    var preamp = ctx.createGain();
    var loudness = ctx.createGain();
    var safetyLimiter = typeof ctx.createDynamicsCompressor === 'function' ? ctx.createDynamicsCompressor() : null;
    if (safetyLimiter) {
      // 只在 EQ/响度叠加抬到 -1dB 以上时动作，防止「响度对齐提升」把波形削平
      safetyLimiter.threshold.value = -1;
      safetyLimiter.knee.value = 0;
      safetyLimiter.ratio.value = 20;
      safetyLimiter.attack.value = 0.003;
      safetyLimiter.release.value = 0.08;
    }
    var antiClick = ctx.createGain();
    antiClick.gain.value = 1;
    var panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    var meter = typeof ctx.createAnalyser === 'function' ? ctx.createAnalyser() : null;
    if (meter) { meter.fftSize = 2048; meter.smoothingTimeConstant = 0; }
    var node = inputNode;
    for (var j = 0; j < eq.length; j++) { node.connect(eq[j]); node = eq[j]; }
    node.connect(preamp);
    preamp.connect(loudness);
    if (safetyLimiter) { loudness.connect(safetyLimiter); safetyLimiter.connect(antiClick); }
    else loudness.connect(antiClick);
    // antiClick 必须在 limiter 之后：否则压缩器 release 会把 8ms 淡出的尾巴补响
    if (panner) antiClick.connect(panner);
    chain = {
      ctx: ctx,
      input: inputNode,
      eq: eq,
      preamp: preamp,
      loudness: loudness,
      safetyLimiter: safetyLimiter,
      antiClick: antiClick,
      panner: panner,
      meter: meter,
      exit: panner || antiClick
    };
    connectMeter(inputNode);
    analyserNode = meter || analyserNode;
    applyAll(0);
    return chain.exit;
  }

  function detach() {
    if (!chain) return;
    try { chain.input.disconnect(chain.eq[0]); } catch (_) {}
    disconnectMeter(chain.input);
    var nodes = chain.eq.concat([chain.preamp, chain.loudness, chain.safetyLimiter, chain.antiClick, chain.panner, chain.meter]);
    nodes.forEach(function (n) { if (n) { try { n.disconnect(); } catch (_) {} } });
    chain = null;
    analyserNode = null;
  }

  // ---- 响度对齐 --------------------------------------------------------
  function applyLoudness(db, reason) {
    runtime.appliedDb = clamp(db, -LOUDNESS_LIMIT_DB, LOUDNESS_LIMIT_DB);
    if (chain) setParam(chain.loudness.gain, dbToLinear(settings.replayGainEnabled ? runtime.appliedDb : 0), 60);
    syncUi();
    return runtime.appliedDb;
  }

  /* keepMeta=true 用于 audio.src 变更触发的 loadstart / emptied：
     同一首歌换 CDN 源时，曲目元数据仍然有效，不能把刚注入的 gain 清掉。 */
  function newSession(keepMeta) {
    var meta = keepMeta ? runtime.metaDb : null;
    runtime.session++;
    runtime.measured = meta != null;
    runtime.metaDb = meta;
    runtime.samples = [];
    runtime.appliedDb = 0;
    if (runtime.startTimer) { clearTimeout(runtime.startTimer); runtime.startTimer = 0; }
    if (runtime.sampleTimer) { clearTimeout(runtime.sampleTimer); runtime.sampleTimer = 0; }
    applyLoudness(meta != null ? meta : 0, 'session');
  }

  /* 曲目切换时由播放核心调用。song.replayGainTrackDb 可来自本地文件 tag，
     在线音源通常没有该字段，此时回落到起播后的自适应 RMS 测量。 */
  function onTrackChanged(song) {
    newSession(false);
    var raw = song && (song.replayGainTrackDb != null ? song.replayGainTrackDb : song.replayGainTrackGain);
    var meta = parseGainDb(raw);
    runtime.metaDb = meta;
    if (meta != null) {
      runtime.measured = true;
      applyLoudness(meta, 'metadata');
    }
    return runtime.metaDb;
  }

  function measureRmsDb() {
    if (!analyserNode || typeof analyserNode.getByteTimeDomainData !== 'function') return null;
    var size = Number(analyserNode.fftSize) || 2048;
    if (!sampleBuf || sampleBuf.length !== size) sampleBuf = new Uint8Array(size);
    try { analyserNode.getByteTimeDomainData(sampleBuf); } catch (_) { return null; }
    var sum = 0;
    for (var i = 0; i < sampleBuf.length; i++) {
      var v = (sampleBuf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / sampleBuf.length);
    if (rms < 0.001) return null;
    return 20 * Math.log10(rms);
  }

  function finishSampling() {
    if (runtime.sampleTimer) { clearTimeout(runtime.sampleTimer); runtime.sampleTimer = 0; }
    if (!runtime.samples.length) return;
    var sorted = runtime.samples.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    runtime.measured = true;
    applyLoudness(TARGET_RMS_DB - median, 'adaptive');
  }

  function startSampling() {
    if (!settings.replayGainEnabled || runtime.measured || !analyserNode) return;
    if (runtime.startTimer || runtime.sampleTimer) return;
    var session = runtime.session;
    runtime.startTimer = setTimeout(function () {
      runtime.startTimer = 0;
      if (session !== runtime.session || runtime.measured) return;
      var taken = 0;
      function take() {
        if (session !== runtime.session || runtime.measured) return;
        var db = measureRmsDb();
        if (db != null) runtime.samples.push(db);
        taken++;
        if (taken >= RMS_SAMPLES) { finishSampling(); return; }
        runtime.sampleTimer = setTimeout(take, RMS_INTERVAL_MS);
      }
      take();
    }, RMS_DELAY_MS);
  }

  // ---- 防爆音 ----------------------------------------------------------
  function antiClickIn(reason) {
    if (!chain) return;
    if (runtime.antiClickTimer) { clearTimeout(runtime.antiClickTimer); runtime.antiClickTimer = 0; }
    setParam(chain.antiClick.gain, 1, ANTICLICK_IN_MS);
  }

  function antiClickOut(reason) {
    if (!settings.antiClickEnabled || !chain) return;
    setParam(chain.antiClick.gain, 0, ANTICLICK_OUT_MS);
    if (runtime.antiClickTimer) clearTimeout(runtime.antiClickTimer);
    var session = runtime.session;
    // 兜底：换源后可能永远等不到 playing（例如 holdPaused），不能一直静音
    runtime.antiClickTimer = setTimeout(function () {
      runtime.antiClickTimer = 0;
      if (session !== runtime.session) return;
      antiClickIn('timeout');
    }, ANTICLICK_TIMEOUT_MS);
  }

  function onSourceChange() {
    newSession(true);
    antiClickOut('source-change');
  }
  function onSeek() {
    antiClickOut('seek');
  }
  function onPlaybackResumed(e) {
    antiClickIn('resumed');
    if (e && e.type === 'playing') startSampling();
  }

  function unbindMedia() {
    if (!boundMedia) return;
    ['emptied', 'loadstart'].forEach(function (n) { boundMedia.removeEventListener(n, onSourceChange); });
    boundMedia.removeEventListener('seeking', onSeek);
    ['seeked', 'playing'].forEach(function (n) { boundMedia.removeEventListener(n, onPlaybackResumed); });
    boundMedia = null;
  }

  function bindMedia(mediaEl, analyserEl) {
    if (analyserEl) analyserNode = analyserEl;
    if (boundMedia === mediaEl) return;
    unbindMedia();
    if (!mediaEl) return;
    boundMedia = mediaEl;
    ['emptied', 'loadstart'].forEach(function (n) { mediaEl.addEventListener(n, onSourceChange); });
    mediaEl.addEventListener('seeking', onSeek);
    ['seeked', 'playing'].forEach(function (n) { mediaEl.addEventListener(n, onPlaybackResumed); });
  }

  // ---- UI --------------------------------------------------------------
  function el(id) { return global.document.getElementById(id); }
  function toggleButton(id, on) {
    var b = el(id);
    if (!b) return;
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function syncUi() {
    if (typeof global.document === 'undefined' || !global.document.getElementById) return;
    toggleButton('audio-tuning-eq-toggle', settings.eqEnabled);
    toggleButton('audio-tuning-replaygain-toggle', settings.replayGainEnabled);
    toggleButton('audio-tuning-anticlick-toggle', settings.antiClickEnabled);
    for (var i = 0; i < EQ_BANDS.length; i++) {
      var input = el('at-eq-' + i);
      var label = el('at-eq-v-' + i);
      if (input) input.value = String(settings.eq[i]);
      if (label) label.textContent = fmtDb(settings.eq[i]);
    }
    var preamp = el('at-preamp');
    var preampV = el('at-preamp-v');
    if (preamp) preamp.value = String(settings.preampDb);
    if (preampV) preampV.textContent = fmtDb(settings.preampDb) + 'dB';
    var balance = el('at-balance');
    var balanceV = el('at-balance-v');
    if (balance) balance.value = String(Math.round(settings.balance * 100));
    if (balanceV) {
      var pct = Math.round(settings.balance * 100);
      balanceV.textContent = pct === 0 ? '中' : (pct < 0 ? 'L' + Math.abs(pct) : 'R' + pct);
    }
    var summary = el('audio-tuning-summary');
    if (summary) {
      summary.textContent = (PRESET_LABELS[settings.preset] || '自定义') +
        ' · 响度' + (settings.replayGainEnabled ? fmtDb(runtime.appliedDb) + 'dB' : '关');
    }
    var presetWrap = el('audio-tuning-presets');
    if (presetWrap) {
      Array.prototype.forEach.call(presetWrap.querySelectorAll('button[data-preset]'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-preset') === settings.preset);
      });
    }
  }

  function buildUi() {
    var rows = el('audio-tuning-eq-rows');
    if (!rows || rows.getAttribute('data-built') === '1') return;
    rows.setAttribute('data-built', '1');
    var html = '';
    for (var i = 0; i < EQ_BANDS.length; i++) {
      html += '<div class="at-control-row">' +
        '<label for="at-eq-' + i + '">' + EQ_LABELS[i] + '</label>' +
        '<input id="at-eq-' + i + '" type="range" min="-12" max="12" step="0.5" value="' + settings.eq[i] +
        '" data-band="' + i + '" aria-label="' + EQ_LABELS[i] + '赫兹均衡增益">' +
        '<span id="at-eq-v-' + i + '">' + fmtDb(settings.eq[i]) + '</span></div>';
    }
    rows.innerHTML = html;
    rows.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.getAttribute('data-band') == null) return;
      var idx = clamp(t.getAttribute('data-band'), 0, EQ_BANDS.length - 1);
      settings.eq[idx] = clamp(t.value, -EQ_LIMIT_DB, EQ_LIMIT_DB);
      settings.preset = 'custom';
      saveSettings();
      applyAll();
      syncUi();
    });
    var preamp = el('at-preamp');
    if (preamp) preamp.addEventListener('input', function (e) {
      settings.preampDb = clamp(e.target.value, -PREAMP_LIMIT_DB, PREAMP_LIMIT_DB);
      saveSettings(); applyAll(); syncUi();
    });
    var balance = el('at-balance');
    if (balance) balance.addEventListener('input', function (e) {
      settings.balance = clamp(e.target.value, -100, 100) / 100;
      saveSettings(); applyAll(); syncUi();
    });
    var presets = el('audio-tuning-presets');
    if (presets) presets.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-preset]') : null;
      if (b) setPreset(b.getAttribute('data-preset'));
    });
    syncUi();
  }

  function setPreset(name) {
    if (!PRESETS[name]) return;
    settings.eq = PRESETS[name].slice();
    settings.preset = name;
    saveSettings();
    applyAll();
    syncUi();
  }
  function toggleOption(key) {
    settings[key] = !settings[key];
    saveSettings();
    if (key === 'replayGainEnabled' && !settings.replayGainEnabled) applyLoudness(0, 'disabled');
    if (key === 'antiClickEnabled' && !settings.antiClickEnabled) antiClickIn('disabled');
    applyAll();
    syncUi();
    return settings[key];
  }

  NS.audioTuning = {
    install: install,
    detach: detach,
    bindMedia: bindMedia,
    onTrackChanged: onTrackChanged,
    applyAll: applyAll,
    setTransitionPan: setTransitionPan,
    clearTransitionPan: clearTransitionPan,
    setPreset: setPreset,
    syncUi: syncUi,
    buildUi: buildUi,
    getSettings: function () {
      return {
        eqEnabled: settings.eqEnabled,
        replayGainEnabled: settings.replayGainEnabled,
        antiClickEnabled: settings.antiClickEnabled,
        eq: settings.eq.slice(),
        preampDb: settings.preampDb,
        balance: settings.balance,
        preset: settings.preset
      };
    },
    getStatus: function () {
      return {
        installed: !!chain,
        eqBands: chain ? chain.eq.length : 0,
        hasPanner: !!(chain && chain.panner),
        hasLimiter: !!(chain && chain.safetyLimiter),
        hasMeter: !!(chain && chain.meter),
        eqEnabled: settings.eqEnabled,
        replayGainEnabled: settings.replayGainEnabled,
        antiClickEnabled: settings.antiClickEnabled,
        appliedDb: runtime.appliedDb,
        metaDb: runtime.metaDb,
        measured: runtime.measured,
        samples: runtime.samples.length,
        antiClickGain: chain ? chain.antiClick.gain.value : null,
        loudnessGain: chain ? chain.loudness.gain.value : null,
        preampGain: chain ? chain.preamp.gain.value : null,
        balance: chain && chain.panner ? chain.panner.pan.value : null
      };
    },
    _test: {
      getChain: function () { return chain; },
      dbToLinear: dbToLinear,
      parseGainDb: parseGainDb,
      measureRmsDb: measureRmsDb,
      finishSampling: finishSampling,
      applyLoudness: applyLoudness,
      antiClickIn: antiClickIn,
      antiClickOut: antiClickOut,
      runtime: runtime,
      settings: settings
    }
  };

  global.toggleAudioTuningEq = function () { return toggleOption('eqEnabled'); };
  global.toggleAudioTuningReplayGain = function () { return toggleOption('replayGainEnabled'); };
  global.toggleAudioTuningAntiClick = function () { return toggleOption('antiClickEnabled'); };
  global.setAudioTuningPreset = setPreset;
  global.resetAudioTuning = function () { setPreset('flat'); };

  if (typeof global.document !== 'undefined') {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', buildUi, { once: true });
    } else {
      buildUi();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
