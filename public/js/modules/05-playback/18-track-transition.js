// ============================================================
//  歌曲过渡（对标酷狗「歌曲过渡」效果矩阵）
// ------------------------------------------------------------
//  截图里的四张卡片并不是四套引擎，而是「一套曲末交接骨架 + 四组交接瞬间的
//  音频包络配方」。本项目里骨架早就有了：
//
//    - 16-gapless-handoff.js  曲末预载下一首地址 / 媒体字节（ended 后交接）
//    - 08-audio-graph-controls.js  等功率淡出曲线 + 新曲淡入
//    - 01-audio-tuning.js      StereoPannerNode（左右声道平衡）
//
//  本文件只做「编排」：持有总开关、模式与每种模式的可调参数、给 08 提供
//  可选 getter 钩子、给 01 派发过渡期临时声像、提供不依赖网络的 Web Audio
//  试听，并让面板里的光效 / 图标 / 文案 / 参数行随选中模式一起切换。
//
//  ★ 硬约束：
//    1) 不修改 05-cuefield/* 下的任何源码；Cuefield 开启时整体让路。
//       顶层 Cuefield 开关收编进本面板后，只在「旧存档仍开着 + 按钮已移除」时
//       调它自己的公开开关把它关掉，避免留下没有 UI 的幽灵开关。
//    2) 不直接写主音量节点。所有淡变仍走 08 既有的 rampAudioOutputGain，
//       本模块只决定「时长 / 曲线 / 要不要做」，避免重演旧自动化那类冲突。
//    3) 全程只有一个音源发声：四种模式都是串行交接，绝不会在歌还在唱时
//       把下一首叠进来（这是用户明确否掉的行为）。
//    4) 默认关闭。关着时所有 getter 返回 null，既有播放行为一行不变。
//    5) 绝不 setTargetAtTime；所有 AudioParam 变化都是显式排程或即时写。
//    6) 每模式参数的默认值必须逐毫秒还原改造前的配方，老存档 / 老测试零回归。
//
//  参数模型对齐的开源实现（只借鉴参数语义，不引入依赖）：
//    - regosen/Gapless-5：setCrossfade(amountIn, amountOut) 把淡入 / 淡出分开；
//      CrossfadeShape.None / Linear / EqualPower；建议 25–50ms 短交叉补 gap。
//    - Tone.js CrossFade：fade ∈ [0,1] 的等功率混合比，用 StereoPanner 分流。
//  浏览器 <audio> 是黑盒解码，无法裁 encoder delay / padding，所以「无缝」
//  是预加载 + 曲末交接近无缝，不是采样级 gapless；酷狗截图里的「歌曲间隔
//  -1500ms」是原生解码层裁头尾，我们不假装能做，改为「曲尾收尾 / 新曲微淡入」
//  这两个真实作用于 08 的可调量。
// ============================================================

(function (global) {
  'use strict';

  var NS = global.Mineradio = global.Mineradio || {};
  var STORE_KEY = 'mineradio-track-transition-v1';
  var DEFAULT_MODE = 'seamless';
  var PAN_LIMIT = 0.85;

  /* fadeInMs / fadeOutMs：
   *   null = 沿用用户在「淡入淡出」里设置的 AUDIO_FADE_IN_MS / OUT_MS
   *   0    = 不做淡变（曲末保持音量到 ended，新曲直接满音量）
   *   数值 = 覆盖为指定墙钟毫秒
   * panOut / panIn 为 StereoPannerNode.pan 目标值，0 表示不动声像。
   * previewOverlapSec 只作用于「试听」的合成音，试听允许短重叠来演示混音感；
   * 真实切歌永远串行。
   *
   * 下面这组是「默认配方」，同时也是参数缩放的基准：resolveMode() 以默认值
   * 为锚按比例换算，保证参数取默认值时四个 getter 与改造前逐毫秒一致。 */
  var MODES = {
    mix: {
      id: 'mix', label: '混音过渡', hint: '长等功率淡变 · 能量不断层',
      fadeInMs: 1100, fadeOutMs: 2400, skipEndFade: false,
      panOut: 0, panIn: 0, previewOverlapSec: 0.45, curve: 'equal-power',
      desc: '长等功率淡出与淡入，两段能量接成一片'
    },
    gradual: {
      id: 'gradual', label: '渐进过渡', hint: '曲末淡出 + 新曲淡入',
      fadeInMs: null, fadeOutMs: null, skipEndFade: false,
      panOut: 0, panIn: 0, previewOverlapSec: 0, curve: 'equal-power',
      desc: '沿用你设置的淡入淡出时长，柔和交接'
    },
    seamless: {
      id: 'seamless', label: '无缝过渡', hint: '不淡出 · 曲末交接 · 零重叠',
      fadeInMs: 0, fadeOutMs: 0, skipEndFade: true,
      panOut: 0, panIn: 0, previewOverlapSec: 0, curve: 'linear',
      desc: '预载下一首，当前曲播完立刻交接，不做淡变'
    },
    stereo: {
      id: 'stereo', label: '立体声转场', hint: '左右声道渐变 · 沉浸式转场',
      fadeInMs: 900, fadeOutMs: 2200, skipEndFade: false,
      panOut: -PAN_LIMIT, panIn: PAN_LIMIT, previewOverlapSec: 0, curve: 'equal-power',
      desc: '左右声道渐变衔接，沉浸式转场'
    }
  };
  // 与酷狗截图卡片顺序一致：混音 / 渐进 / 无缝 / 立体声
  var MODE_ORDER = ['mix', 'gradual', 'seamless', 'stereo'];

  /* 每种模式两个参数，全部映射到编排器已有的 getter，不新增写增益路径：
   *   mix       过渡时长 → fadeOut/fadeIn；淡变曲线 → 08 的曲线 kind
   *   gradual   渐进时长（0=跟随用户淡入淡出）；淡入比例 → fadeIn/fadeOut 比例
   *   seamless  曲尾收尾 → 曲末淡出；新曲微淡入 → 新曲起播淡入
   *   stereo    转场时长 → fadeOut/fadeIn；声像幅度 → panOut/panIn
   * 对齐 Gapless-5 的 amountIn / amountOut 分离与 CrossfadeShape。 */
  var PARAM_DEFS = {
    mix: [
      { key: 'durationSec', label: '过渡时长', min: 0.4, max: 8, step: 0.1, def: 2.4,
        unit: 's', digits: 1 },
      { key: 'curve', label: '淡变曲线', type: 'choice', def: 'equal-power',
        options: [{ value: 'equal-power', label: '等功率' }, { value: 'linear', label: '线性' }] }
    ],
    gradual: [
      { key: 'durationSec', label: '渐进时长', min: 0, max: 12, step: 0.5, def: 0,
        unit: 's', digits: 1, zeroLabel: '跟随设置' },
      { key: 'inRatio', label: '淡入比例', min: 20, max: 100, step: 5, def: 80, unit: '%' }
    ],
    seamless: [
      { key: 'tailMs', label: '曲尾收尾', min: 0, max: 1500, step: 50, def: 0, unit: 'ms' },
      { key: 'headMs', label: '新曲微淡入', min: 0, max: 300, step: 10, def: 0, unit: 'ms' }
    ],
    stereo: [
      { key: 'durationSec', label: '转场时长', min: 0.5, max: 6, step: 0.1, def: 2.2,
        unit: 's', digits: 1 },
      { key: 'panPct', label: '声像幅度', min: 0, max: 100, step: 5, def: 85, unit: '%' }
    ]
  };

  /* 四套独立文案：选中哪张卡片，banner 光效、卡片图标、说明与参数一起换。 */
  var CAPTIONS = {
    mix: '长等功率淡变，两段能量接成一片',
    gradual: '音量柔和衔接，声音自然融合',
    seamless: '过滤曲尾空白，声音不间断',
    stereo: '左右声道渐变衔接，沉浸式转场'
  };

  function clamp(v, min, max, fallback) {
    v = Number(v);
    if (!isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }
  function normalizeMode(v) {
    return Object.prototype.hasOwnProperty.call(MODES, v) ? v : DEFAULT_MODE;
  }
  function el(id) {
    return global.document && global.document.getElementById
      ? global.document.getElementById(id) : null;
  }
  function paramId(mode, key) { return 'tt-p-' + mode + '-' + key; }
  function findDef(mode, key) {
    var list = PARAM_DEFS[normalizeMode(mode)] || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function defaultParams() {
    var out = {};
    MODE_ORDER.forEach(function (mode) {
      out[mode] = {};
      PARAM_DEFS[mode].forEach(function (def) { out[mode][def.key] = def.def; });
    });
    return out;
  }
  function normalizeParam(def, raw) {
    if (def.type === 'choice') {
      for (var i = 0; i < def.options.length; i++) {
        if (def.options[i].value === raw) return def.options[i].value;
      }
      return def.def;
    }
    var v = clamp(raw, def.min, def.max, def.def);
    var snapped = Math.round(v / def.step) * def.step;
    return Number(Math.max(def.min, Math.min(def.max, snapped)).toFixed(3));
  }
  function formatParam(def, v) {
    if (def.zeroLabel && Number(v) === 0) return def.zeroLabel;
    var text = def.digits ? Number(v).toFixed(def.digits) : String(Math.round(Number(v)));
    return text + (def.unit || '');
  }
  function paramSummary(mode, p) {
    if (mode === 'mix') return p.durationSec.toFixed(1) + 's · ' + (p.curve === 'linear' ? '线性' : '等功率');
    if (mode === 'gradual') {
      return Number(p.durationSec) > 0
        ? p.durationSec.toFixed(1) + 's · 淡入 ' + Math.round(p.inRatio) + '%'
        : '跟随淡入淡出设置';
    }
    if (mode === 'seamless') return '曲尾 ' + Math.round(p.tailMs) + 'ms · 新曲 ' + Math.round(p.headMs) + 'ms';
    return p.durationSec.toFixed(1) + 's · 声像 ' + Math.round(p.panPct) + '%';
  }

  function defaultSettings() {
    return { enabled: false, mode: DEFAULT_MODE, params: defaultParams() };
  }
  function readSettings() {
    var out = defaultSettings();
    try {
      var raw = JSON.parse(global.localStorage.getItem(STORE_KEY) || '{}') || {};
      out.enabled = raw.enabled === true;
      out.mode = normalizeMode(raw.mode);
      if (raw.params && typeof raw.params === 'object') {
        MODE_ORDER.forEach(function (mode) {
          var src = raw.params[mode];
          if (!src || typeof src !== 'object') return;
          PARAM_DEFS[mode].forEach(function (def) {
            if (Object.prototype.hasOwnProperty.call(src, def.key)) {
              out.params[mode][def.key] = normalizeParam(def, src[def.key]);
            }
          });
        });
      }
    } catch (_) {}
    return out;
  }
  function saveSettings() {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  var settings = readSettings();
  var runtime = {
    autoEnabledGapless: false,   // 是我们替用户打开的 16，关闭时负责还原
    autoGaplessToggleCount: -1,  // 代开时 16 的开关序号；-1 = 16 未提供
    panOverridden: false,        // 临时声像是否正在覆盖用户 balance
    handoffPending: false,       // 曲末淡出已触发、正在等新曲起播
    previewCount: 0,
    lastPreview: null,
    previewCtx: null,
    previewTimer: 0,
    lastBlocked: '',
    lastParamChange: null,
    legacyCuefieldRetired: false
  };

  /* 把「静态默认配方」按当前模式参数重算成一份实时配方。所有 getter 都读它，
   * MODES 本身保持静态（外部 / 探针仍能从 MODES 读到出厂默认值）。 */
  function resolveMode(modeId) {
    var id = normalizeMode(modeId);
    var base = MODES[id];
    var p = (settings.params && settings.params[id]) || defaultParams()[id];
    var m = Object.assign({}, base);
    var k;
    if (id === 'mix') {
      k = Number(p.durationSec) / 2.4;
      m.fadeOutMs = Math.round(2400 * k);
      m.fadeInMs = Math.round(1100 * k);
      m.curve = p.curve === 'linear' ? 'linear' : 'equal-power';
    } else if (id === 'gradual') {
      var gd = Number(p.durationSec);
      m.fadeOutMs = gd > 0 ? Math.round(gd * 1000) : null;
      m.fadeInMs = gd > 0 ? Math.round(gd * 1000 * Number(p.inRatio) / 100) : null;
      m.curve = 'equal-power';
    } else if (id === 'seamless') {
      m.fadeOutMs = Math.round(Number(p.tailMs));
      m.fadeInMs = Math.round(Number(p.headMs));
      // 曲尾收尾为 0 时完全跳过曲末淡出（改造前的零淡变交接）
      m.skipEndFade = m.fadeOutMs === 0;
      m.curve = 'linear';
    } else if (id === 'stereo') {
      k = Number(p.durationSec) / 2.2;
      m.fadeOutMs = Math.round(2200 * k);
      m.fadeInMs = Math.round(900 * k);
      var amp = clamp(Number(p.panPct) / 100, 0, 1, PAN_LIMIT);
      m.panOut = -amp;
      m.panIn = amp;
      m.curve = 'equal-power';
    }
    return m;
  }

  /* Cuefield 开着时整体让路：两套衔接逻辑同时跑只会互相抢增益。
   * 这里只读它的公开状态；唯一的写操作是下面针对旧存档的收编。 */
  function blockedReason() {
    if (typeof cuefieldAutoMixEnabled !== 'undefined' && cuefieldAutoMixEnabled) return 'cuefield';
    if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return 'cuefield-running';
    return '';
  }

  /* 顶层两个并列开关移除后：无缝衔接由本面板托管，Cuefield 收编为面板内的
   * 次级实验开关（保留原 id，02 的状态同步照常生效，功能仍可正常开关）。
   * 下面这段只兼容「旧布局 / 按钮确实不存在」的情况：那时 cuefieldAutoMixEnabled
   * 仍会从 localStorage 恢复成开启态，却没有 UI 可关，会让本面板一直让路；
   * 此时才调它自己的公开 toggle 关掉。不改 05-cuefield/* 源码。 */
  function retireLegacyCuefieldSwitch() {
    if (typeof cuefieldAutoMixEnabled === 'undefined' || !cuefieldAutoMixEnabled) return false;
    // DOM 还没解析完时 getElementById 一律返回 null，会误判成「按钮已移除」
    if (global.document && global.document.readyState === 'loading') return false;
    if (global.document && global.document.getElementById
        && global.document.getElementById('quick-menu-automix-toggle')) return false;
    if (typeof toggleCuefieldAutoMix !== 'function') return false;
    try { toggleCuefieldAutoMix(); } catch (_) { return false; }
    runtime.legacyCuefieldRetired = true;
    return true;
  }
  function activeMode() {
    if (!settings.enabled || blockedReason()) return null;
    return resolveMode(settings.mode);
  }

  // ---- 与 16-gapless-handoff 的协作 --------------------------------------

  /* 四种模式都靠提前预载才能「接得住」。若用户没开无缝衔接，我们代开一次并
   * 记下账；关闭本功能时只还原「我们代开的那一次」，不覆盖用户后续手动操作。 */
  function gaplessApi() { return global.__mineradioGaplessHandoff || null; }
  function gaplessIsOn() {
    var api = gaplessApi();
    if (api && typeof api.getStatus === 'function') {
      try { return !!api.getStatus().enabled; } catch (_) {}
    }
    return typeof gaplessHandoffEnabled !== 'undefined' ? !!gaplessHandoffEnabled : false;
  }
  function ensureGaplessDependency() {
    if (!settings.enabled || blockedReason() || gaplessIsOn()) return false;
    var api = gaplessApi();
    if (!api || typeof api.toggle !== 'function') return false;
    api.toggle();
    runtime.autoEnabledGapless = true;
    var st = null;
    try { st = typeof api.getStatus === 'function' ? api.getStatus() : null; } catch (_) {}
    runtime.autoGaplessToggleCount = (st && isFinite(Number(st.toggleCount)))
      ? Number(st.toggleCount) : -1;   // -1 = 16 未提供计数，退回旧行为
    return true;
  }
  function restoreGaplessDependency() {
    if (!runtime.autoEnabledGapless) return false;
    runtime.autoEnabledGapless = false;
    var expected = runtime.autoGaplessToggleCount;
    runtime.autoGaplessToggleCount = -1;
    var api = gaplessApi();
    if (!api || typeof api.toggle !== 'function') return false;
    var st = null;
    try { st = typeof api.getStatus === 'function' ? api.getStatus() : null; } catch (_) {}
    /* 代开之后开关序号变了 = 用户自己动过（哪怕关掉又开回来、最终仍是开），
     * 此时绝不能替他关掉。这也是「不越权还原」的兑现点。 */
    if (expected >= 0 && st && isFinite(Number(st.toggleCount))
        && Number(st.toggleCount) !== expected) return false;
    if (!gaplessIsOn()) return false;
    api.toggle();
    return true;
  }

  // ---- 临时声像（只借 01 的节点，不改它的 settings.balance 存档）--------

  function tuning() {
    return NS.audioTuning && typeof NS.audioTuning.setTransitionPan === 'function'
      ? NS.audioTuning : null;
  }
  function setTransitionPan(pan, rampMs) {
    var t = tuning();
    if (!t) return false;
    try {
      if (!t.setTransitionPan(clamp(pan, -1, 1, 0), rampMs)) return false;
      runtime.panOverridden = true;
      return true;
    } catch (_) { return false; }
  }
  function clearTransitionPan(rampMs) {
    if (!runtime.panOverridden) return false;
    var t = tuning();
    if (t && typeof t.clearTransitionPan === 'function') {
      try { t.clearTransitionPan(rampMs); } catch (_) {}
    }
    runtime.panOverridden = false;
    return true;
  }

  // ---- 给 08-audio-graph-controls.js 的可选 getter 钩子 ------------------
  // 返回 null 表示「不干预，沿用用户原设置」。08 会做 typeof 检查，
  // 因此本模块缺失 / 未启用时，08 的行为与改造前完全一致。

  function getFadeInMs() {
    var m = activeMode();
    return m ? m.fadeInMs : null;
  }
  function getFadeOutMs() {
    var m = activeMode();
    return m ? m.fadeOutMs : null;
  }
  /* 曲线形状对齐 Gapless-5 的 CrossfadeShape：等功率（sin）或线性。
   * 08 只在「交接淡变」的两次调用上读它，暂停 / 播放淡变不受影响。 */
  function getFadeCurve() {
    var m = activeMode();
    return m && m.curve ? m.curve : null;
  }
  /* mix / stereo 的曲末淡出比默认 420ms 长得多，08 的排程窗口
   * （默认 1.8s）会把它们整段挡掉，所以这里把窗口一并放大。 */
  function getExtraLookaheadSec() {
    var m = activeMode();
    if (!m || !m.fadeOutMs) return 0;
    return m.fadeOutMs / 1000 + 1.8;
  }
  function shouldSkipTrackEndFade() {
    var m = activeMode();
    return !!(m && m.skipEndFade);
  }

  /* 曲末淡出真正开始执行的那一刻：立体声模式把当前曲声像扫向一侧。
   * handoffPending 把「真交接」和普通的 seek / 暂停恢复区分开，避免
   * restorePlaybackGain 每次被调用都把声像甩到右边再拉回来。 */
  function onEndFadeStart() {
    var m = activeMode();
    if (!m) return false;
    runtime.handoffPending = true;
    if (m.panOut) return setTransitionPan(m.panOut, m.fadeOutMs || 900);
    return false;
  }
  /* 新曲起播：只有处在真交接里，立体声模式才从另一侧把声像扫回用户设定
   * 的 balance；其它情况只做一次幂等兜底还原（panOverridden 为假时零写入）。 */
  function onTrackStart() {
    var m = activeMode();
    var handoff = runtime.handoffPending;
    runtime.handoffPending = false;
    if (handoff && m && m.panIn) {
      setTransitionPan(m.panIn, 0);
      clearTransitionPan(m.fadeInMs || 900);
      return true;
    }
    return clearTransitionPan(0);
  }

  // ---- 试听：独立 AudioContext 合成两段音，绝不碰主播放链 ----------------

  function curve(from, to, frames, equalPower) {
    var arr = new Float32Array(frames);
    var delta = to - from;
    for (var i = 0; i < frames; i++) {
      var t = i / (frames - 1);
      arr[i] = from + delta * (equalPower ? Math.sin(t * Math.PI * 0.5) : t);
    }
    arr[frames - 1] = to;
    return arr;
  }

  /* previewPlan 是纯数据，便于单测断言而不必构造 AudioContext。
   * 试听也读同一份实时配方，所以调完参数立刻能在试听里听出差别。 */
  function previewPlan(modeId) {
    var m = resolveMode(modeId);
    var switchAt = 1.30;
    var overlap = m.previewOverlapSec;
    var fadeOut = m.fadeOutMs ? Math.min(0.95, m.fadeOutMs / 2600) : (m.skipEndFade ? 0 : 0.55);
    var fadeIn = m.fadeInMs ? Math.min(0.80, m.fadeInMs / 1600) : (m.skipEndFade ? 0 : 0.42);
    return {
      mode: m.id,
      label: m.label,
      switchAt: switchAt,
      overlapSec: overlap,
      fadeOutSec: fadeOut,
      fadeInSec: fadeIn,
      panOut: m.panOut,
      panIn: m.panIn,
      curve: m.curve,
      durationSec: 2.70,
      audibleNextDeck: false   // 真实切歌永远零重叠；试听重叠只是合成音演示
    };
  }

  function preview(modeId) {
    var id = normalizeMode(modeId || settings.mode);
    var plan = previewPlan(id);
    var equalPower = plan.curve !== 'linear';
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (typeof Ctor !== 'function') {
      runtime.lastPreview = { ok: false, reason: 'no-webaudio', mode: id };
      return runtime.lastPreview;
    }
    // 连续点试听时先把上一次拆干净，避免多个 ctx 叠响
    stopPreview();
    var ctx;
    try { ctx = new Ctor(); } catch (_) {
      runtime.lastPreview = { ok: false, reason: 'ctx-failed', mode: id };
      return runtime.lastPreview;
    }
    var now = ctx.currentTime || 0;
    var t0 = now + 0.02;
    var level = 0.16;

    function makeVoice(freq, startAt) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain);
      if (panner) { gain.connect(panner); panner.connect(ctx.destination); }
      else gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(t0 + plan.durationSec);
      return { osc: osc, gain: gain, panner: panner, startAt: startAt };
    }

    var a = makeVoice(220, t0);
    var b = makeVoice(440, t0 + plan.switchAt - plan.overlapSec);

    function applyGain(param, at, dur, from, to) {
      if (!dur) { param.setValueAtTime(to, at); return; }
      try {
        param.setValueAtTime(from, at);
        param.setValueCurveAtTime(curve(from, to, 64, equalPower), at, dur);
      } catch (_) {
        try { param.setValueAtTime(from, at); param.linearRampToValueAtTime(to, at + dur); } catch (__) {}
      }
      param.setValueAtTime(to, at + dur + 0.001);
    }

    // A：全程 level，曲末按配方淡出到 0
    a.gain.gain.setValueAtTime(level, t0);
    var aFadeStart = t0 + plan.switchAt - plan.fadeOutSec;
    applyGain(a.gain.gain, aFadeStart, plan.fadeOutSec, level, 0);
    // B：从 0 按配方淡入
    b.gain.gain.setValueAtTime(0, b.startAt);
    applyGain(b.gain.gain, b.startAt, plan.fadeInSec, 0, level);

    if (plan.panOut && a.panner) {
      a.panner.pan.setValueAtTime(0, aFadeStart);
      a.panner.pan.linearRampToValueAtTime(plan.panOut, aFadeStart + Math.max(0.05, plan.fadeOutSec));
    }
    if (plan.panIn && b.panner) {
      b.panner.pan.setValueAtTime(plan.panIn, b.startAt);
      b.panner.pan.linearRampToValueAtTime(0, b.startAt + Math.max(0.05, plan.fadeInSec));
    }

    runtime.previewCtx = ctx;
    runtime.previewCount++;
    runtime.previewTimer = global.setTimeout(function () {
      runtime.previewTimer = 0;
      stopPreview();
    }, Math.ceil(plan.durationSec * 1000) + 260);
    runtime.lastPreview = {
      ok: true, mode: id, plan: plan,
      usedMainAudio: false,
      usedGainNode: false
    };
    return runtime.lastPreview;
  }

  function stopPreview() {
    if (runtime.previewTimer) { global.clearTimeout(runtime.previewTimer); runtime.previewTimer = 0; }
    var ctx = runtime.previewCtx;
    runtime.previewCtx = null;
    if (!ctx) return false;
    try { ctx.close(); } catch (_) {}
    return true;
  }

  // ---- 参数 API ----------------------------------------------------------

  function getParams(mode) {
    var id = normalizeMode(mode || settings.mode);
    return Object.assign({}, settings.params[id]);
  }
  function setParam(mode, key, raw) {
    var id = normalizeMode(mode);
    var def = findDef(id, key);
    if (!def) return null;
    var v = normalizeParam(def, raw);
    settings.params[id][key] = v;
    runtime.lastParamChange = { mode: id, key: key, value: v };
    saveSettings();
    syncUi();
    return v;
  }
  function resetParams(mode) {
    var id = normalizeMode(mode || settings.mode);
    settings.params[id] = defaultParams()[id];
    runtime.lastParamChange = { mode: id, key: '*', value: null };
    saveSettings();
    syncUi();
    if (global.showToast && typeof global.showToast === 'function') {
      global.showToast(MODES[id].label + '：参数已恢复默认');
    }
    return getParams(id);
  }

  // ---- UI -----------------------------------------------------------------

  /* 顶层「无缝衔接」按钮移除后，它的状态文案由这里接手显示，
   * 避免用户看不到「下一首是否已预载」。 */
  function statusText() {
    if (!settings.enabled) return '关闭 · 不影响现有播放';
    var blocked = blockedReason();
    if (blocked) return 'Cuefield 开启时暂不生效';
    var m = MODES[settings.mode];
    if (!gaplessIsOn()) return m.label + ' · 预载未开启';
    var api = gaplessApi();
    var st = null;
    try { st = api && typeof api.getStatus === 'function' ? api.getStatus() : null; } catch (_) {}
    if (st && st.pending) return m.label + ' · 正在预载下一首';
    if (st && st.ready) return m.label + ' · 下一首已预载';
    return m.label + ' · 已启用 · 等待曲末';
  }

  /* 一个模式 = 一套光效 + 一套图标高亮 + 一句文案 + 一组参数。
   * 全部用 data-mode / class 切换，不重建 DOM，也不依赖任何框架。 */
  function syncUi() {
    if (!global.document) return;
    var id = settings.mode;
    var toggle = el('track-transition-toggle');
    if (toggle) {
      toggle.classList.toggle('on', !!settings.enabled);
      toggle.setAttribute('aria-pressed', settings.enabled ? 'true' : 'false');
    }
    var summary = el('track-transition-summary');
    // 选中态与总开关解耦：没开启时也要让用户看见「我选的是哪一种」
    if (summary) summary.textContent = (settings.enabled ? '' : '待开启 · ') + MODES[id].label;
    var scene = el('track-transition-scene');
    if (scene) scene.setAttribute('data-mode', id);
    MODE_ORDER.forEach(function (mode) {
      var art = el('track-transition-art-' + mode);
      if (art) art.classList.toggle('active', mode === id);
    });
    var caption = el('track-transition-caption');
    if (caption) caption.textContent = paramSummary(id, settings.params[id]);
    var desc = el('track-transition-desc');
    if (desc) desc.textContent = CAPTIONS[id] + (settings.enabled ? '' : '（开启后生效）');
    var status = el('track-transition-status');
    if (status) status.textContent = statusText();
    var panel = el('track-transition-fold');
    if (panel) panel.classList.toggle('tt-off', !settings.enabled);

    // 参数行：四组静态 DOM 按模式显隐，再把控件值与数值回填
    MODE_ORDER.forEach(function (mode) {
      var group = el('tt-group-' + mode);
      if (group) group.classList.toggle('is-hidden', mode !== id);
      PARAM_DEFS[mode].forEach(function (def) {
        var v = settings.params[mode][def.key];
        var base = paramId(mode, def.key);
        if (def.type === 'choice') {
          def.options.forEach(function (op) {
            var btn = el(base + '-' + op.value);
            if (!btn) return;
            var on = v === op.value;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
        } else {
          var input = el(base);
          if (input) input.value = String(v);
          var out = el(base + '-v');
          if (out) out.textContent = formatParam(def, v);
        }
      });
    });

    MODE_ORDER.forEach(function (mode) {
      var card = el('track-transition-card-' + mode);
      if (!card) return;
      var on = settings.mode === mode;
      card.classList.toggle('active', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // 中央光效由 19 的 Canvas 逐像素算法绘制；模块缺席 / vm 沙箱里安全跳过
    if (NS.trackTransitionArt && typeof NS.trackTransitionArt.render === 'function') {
      try { NS.trackTransitionArt.render(id); } catch (_) {}
    }
  }

  function setMode(mode) {
    var next = normalizeMode(mode);
    var prev = settings.mode;
    settings.mode = next;
    runtime.handoffPending = false;
    // 从立体声切走 / 关掉时，必须把偏掉的声像收回用户设定值
    if (prev === 'stereo' && next !== 'stereo') clearTransitionPan(240);
    saveSettings();
    syncUi();
    if (global.showToast && typeof global.showToast === 'function') {
      global.showToast(MODES[next].label + '：' + MODES[next].hint);
    }
    return next;
  }

  function toggle() {
    settings.enabled = !settings.enabled;
    saveSettings();
    if (settings.enabled) {
      // 必须先关掉可能残留的幽灵 Cuefield，否则 ensureGaplessDependency 会被它挡住
      retireLegacyCuefieldSwitch();
      ensureGaplessDependency();
    } else {
      runtime.handoffPending = false;
      restoreGaplessDependency();
      clearTransitionPan(240);
      stopPreview();
    }
    syncUi();
    if (global.showToast && typeof global.showToast === 'function') {
      global.showToast(settings.enabled
        ? '歌曲过渡已开启：' + MODES[settings.mode].label + '（全程不重叠播放）'
        : '歌曲过渡已关闭');
    }
    return settings.enabled;
  }

  function getStatus() {
    var m = activeMode();
    return {
      enabled: !!settings.enabled,
      mode: settings.mode,
      modeLabel: MODES[settings.mode].label,
      blocked: blockedReason(),
      active: !!m,
      gaplessOn: gaplessIsOn(),
      autoEnabledGapless: runtime.autoEnabledGapless,
      panOverridden: runtime.panOverridden,
      handoffPending: runtime.handoffPending,
      legacyCuefieldRetired: runtime.legacyCuefieldRetired,
      fadeInMs: getFadeInMs(),
      fadeOutMs: getFadeOutMs(),
      fadeCurve: getFadeCurve(),
      skipEndFade: shouldSkipTrackEndFade(),
      extraLookaheadSec: getExtraLookaheadSec(),
      params: getParams(settings.mode),
      allParams: JSON.parse(JSON.stringify(settings.params)),
      caption: CAPTIONS[settings.mode],
      summary: paramSummary(settings.mode, settings.params[settings.mode]),
      lastParamChange: runtime.lastParamChange,
      previewCount: runtime.previewCount,
      lastPreview: runtime.lastPreview,
      statusText: statusText()
    };
  }

  NS.trackTransition = {
    MODES: MODES,
    MODE_ORDER: MODE_ORDER,
    PARAM_DEFS: PARAM_DEFS,
    CAPTIONS: CAPTIONS,
    getFadeInMs: getFadeInMs,
    getFadeOutMs: getFadeOutMs,
    getFadeCurve: getFadeCurve,
    getExtraLookaheadSec: getExtraLookaheadSec,
    shouldSkipTrackEndFade: shouldSkipTrackEndFade,
    onEndFadeStart: onEndFadeStart,
    onTrackStart: onTrackStart,
    preview: preview,
    previewPlan: previewPlan,
    stopPreview: stopPreview,
    setMode: setMode,
    setParam: setParam,
    getParams: getParams,
    resetParams: resetParams,
    resolveMode: resolveMode,
    toggle: toggle,
    syncUi: syncUi,
    getStatus: getStatus,
    _test: {
      settings: settings,
      runtime: runtime,
      blockedReason: blockedReason,
      retireLegacyCuefieldSwitch: retireLegacyCuefieldSwitch,
      ensureGaplessDependency: ensureGaplessDependency,
      restoreGaplessDependency: restoreGaplessDependency,
      setTransitionPan: setTransitionPan,
      clearTransitionPan: clearTransitionPan,
      normalizeParam: normalizeParam,
      defaultParams: defaultParams,
      curve: curve
    }
  };

  global.toggleTrackTransition = toggle;
  global.selectTrackTransitionMode = setMode;
  global.previewTrackTransition = function () { return preview(settings.mode); };
  global.setTrackTransitionParam = setParam;
  global.resetTrackTransitionParams = function () { return resetParams(settings.mode); };

  /* 顶层按钮移除后，旧存档里的 Cuefield 会变成看不见却仍在后台生效的开关，
   * 所以无论本功能是否开启都要收掉它；DOM 未就绪时顺延到 DOMContentLoaded。 */
  retireLegacyCuefieldSwitch();
  if (settings.enabled) ensureGaplessDependency();
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () {
        retireLegacyCuefieldSwitch();
        if (settings.enabled) ensureGaplessDependency();
        syncUi();
      });
    } else {
      syncUi();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
