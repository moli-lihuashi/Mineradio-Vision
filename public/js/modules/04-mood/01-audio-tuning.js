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

  /* 3D 丽音：没有拿到酷狗的原始参数（商业闭源），这条曲线是按公开听感描述
     反推的初始值——低频抬、中频退、高频提亮，配合下面的差分延迟级使用。
     单独点这个预设会把 EQ 和 3D 级一起打开，等价于酷狗那个「一键音效」。 */
  var PRESETS = {
    flat:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop:    [-1, 1, 3, 4, 2, -1, -1, 1, 3, 3],
    rock:   [4, 3, 1, -2, -3, 1, 3, 4, 4, 3],
    vocal:  [-2, -1, 0, 1, 3, 5, 4, 2, 0, -1],
    live3d: [4, 4.5, 2.5, 0, -1.5, -2, -0.5, 1.5, 3, 2]
  };
  var PRESET_LABELS = { flat: '平坦', pop: '流行', rock: '摇滚', vocal: '人声', live3d: '3D丽音' };
  /* 预设附带的音效级：点预设等于「整套一键音效」，不只是改 EQ */
  var PRESET_FX = {
    live3d: { haasDelayMs: 22, haasMix: 0.28 }
  };

  /* ── 3D 丽音（差分延迟环绕）参数边界 ───────────────────────────────
   * 延迟落在 8~35ms：短于 8ms 听成梳状染色而不是空间感，长于 35ms
   * 会和原始声部分离成「回声」（Haas 融合区上限约 35~40ms）。
   * 混合量上限 60%：再高会把居中人声削出金属声（相减导致的中频抵消）。 */
  var HAAS_DELAY_MIN = 8;
  var HAAS_DELAY_MAX = 35;
  var HAAS_MIX_LIMIT = 0.6;
  /* 延迟支路的高通：低频不参与相减，否则 bass 被梳状滤波削掉 */
  var HAAS_FOCUS_HZ = 300;

  /* ── 虚拟低音（心理声学低音增强）参数边界 ───────────────────────────
   * 分频点决定「哪一段低频被拿去造谐波」：小耳机 150~300，书架箱 80~120，
   * 更低的分频点没有意义（那一段本来就能重放，不需要补）。
   * 谐波带宽取分频点的 6 倍：再往上会碰到人声齿音区，听起来是「刺」不是「厚」。 */
  var VB_FC_MIN = 60;
  var VB_FC_MAX = 300;
  var VB_HARMONIC_RATIO = 6;
  /* 支路输出的归一化系数：整流后的谐波比原信号弱，直接按 1:1 混进去听不出来 */
  var VB_MIX_SCALE = 0.55;
  var VB_DRIVE = 2;
  var VB_CURVE_POINTS = 2048;
  var vbCurveCache = null;

  /* 半波软整流的查表曲线：正半周做饱和、负半周归零。
   * 负半周归零 → 产生全偶次 + 奇次谐波（大脑靠这组谐波「补」出缺失的基频）；
   * 用 1-exp 而不是硬削，是为了避免把低频直接变成方波（那是失真，不是低音）。
   * 代价是会引入直流偏移，所以后面必须跟一级 highpass。 */
  function virtualBassCurve() {
    if (vbCurveCache) return vbCurveCache;
    var c = new Float32Array(VB_CURVE_POINTS);
    var k = 3;
    var norm = 1 - Math.exp(-k);
    for (var i = 0; i < VB_CURVE_POINTS; i++) {
      var x = (i / (VB_CURVE_POINTS - 1)) * 2 - 1;
      c[i] = x > 0 ? (1 - Math.exp(-k * x)) / norm : 0;
    }
    vbCurveCache = c;
    return c;
  }

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
      preset: 'flat',
      /* 立体环绕（默认关；width=1 / ambience=0 时与直通逐样本等价） */
      surroundEnabled: false,
      surroundWidth: 1,
      surroundAmbience: 0,
      /* 中置分离（人声 / 伴奏双推子）：1 = 原样，0 = 完全去掉 */
      centerEnabled: false,
      midGain: 1,
      sideGain: 1,
      /* 3D 丽音：交叉差分延迟，默认关（mix=0 时逐样本直通） */
      haasEnabled: false,
      haasDelayMs: 22,
      haasMix: 0.28,
      /* 虚拟低音：并联支路，关闭时 mix=0，总和节点只剩原信号 */
      vbEnabled: false,
      vbCrossoverHz: 150,
      vbAmount: 0.45
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
      if (raw.surroundEnabled === true) out.surroundEnabled = true;
      if (raw.surroundWidth != null) out.surroundWidth = clamp(raw.surroundWidth, 0, 2);
      if (raw.surroundAmbience != null) out.surroundAmbience = clamp(raw.surroundAmbience, 0, 1);
      if (raw.centerEnabled === true) out.centerEnabled = true;
      if (raw.midGain != null) out.midGain = clamp(raw.midGain, 0, 2);
      if (raw.sideGain != null) out.sideGain = clamp(raw.sideGain, 0, 2);
      if (raw.haasEnabled === true) out.haasEnabled = true;
      if (raw.haasDelayMs != null) out.haasDelayMs = clamp(raw.haasDelayMs, HAAS_DELAY_MIN, HAAS_DELAY_MAX);
      if (raw.haasMix != null) out.haasMix = clamp(raw.haasMix, 0, HAAS_MIX_LIMIT);
      if (raw.vbEnabled === true) out.vbEnabled = true;
      if (raw.vbCrossoverHz != null) out.vbCrossoverHz = clamp(raw.vbCrossoverHz, VB_FC_MIN, VB_FC_MAX);
      if (raw.vbAmount != null) out.vbAmount = clamp(raw.vbAmount, 0, 1);
      // 'custom' 也要能回读：拖过 EQ 后预设名是 custom，否则刷新会显示「平坦」却是自定义曲线
      if (typeof raw.preset === 'string' && (PRESETS[raw.preset] || raw.preset === 'custom')) out.preset = raw.preset;
    } catch (_) {}
    return out;
  }

  function saveSettings() {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  /* ── 拖动期间的节流 ────────────────────────────────────────────────
   * 推子拖动时 input 事件可达每秒上百次。原来每次都 saveSettings()（同步写盘）
   * + applyAll()（十几处 AudioParam 排程）+ syncUi()（全量 DOM 回写），
   * 在 Windows 上（Defender 扫 localStorage 文件）足以把主线程压死：
   * 表现就是「界面卡住但音频照常播放」。
   * 现在：写入每帧最多一次、落盘 300ms 合并；界面只更新被拖动的那一个控件。 */
  var applyRaf = 0;
  function scheduleApply() {
    if (applyRaf) return;
    var raf = global.requestAnimationFrame;
    function flush() {
      applyRaf = 0;
      /* 用 try/finally 兜住：applyAll 一旦抛错就把标志位卡住，
         之后拖动会永远不再生效（看起来像「推子失灵」），这条必须保证复位。 */
      try { applyAll(); } catch (err) { try { console.warn('[AudioTuning] applyAll failed', err); } catch (_) {} }
    }
    applyRaf = raf ? raf(flush) : setTimeout(flush, 16);
  }
  var saveTimer = 0;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = 0; saveSettings(); }, 300);
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
    if (chain.surround) {
      /* 关闭时把宽度拉回 1、反射归零 —— 这两个值下 M/S 重建与直通逐样本等价，
         不需要断开/重连节点（重连会有一帧爆音）。 */
      var surOn = !!settings.surroundEnabled;
      setParam(chain.surround.width.gain, surOn ? settings.surroundWidth : 1, ramp);
      setParam(chain.surround.g1.gain, surOn ? 0.55 * settings.surroundAmbience : 0, ramp);
      setParam(chain.surround.g2.gain, surOn ? 0.35 * settings.surroundAmbience : 0, ramp);
      /* 中置分离与人声/伴奏推子不受 surroundEnabled 控制：它们是独立的一组。
         mid=side=1 时与直通等价；压低 mid 时按比例给低音补偿（0 → 0dB，0.5 → +2dB）。 */
      /* 中置分离有独立开关：关掉时 mid/side 回 1、补偿回 0dB（严格中性），
         滑块保持原值不丢，下次打开还是上次那组参数。 */
      var cenOn = !!settings.centerEnabled;
      var effMid = cenOn ? settings.midGain : 1;
      var effSide = cenOn ? settings.sideGain : 1;
      setParam(chain.surround.midGain.gain, effMid, ramp);
      setParam(chain.surround.sideGain.gain, effSide, ramp);
      setParam(chain.surround.bassComp.gain, (1 - effMid) * 4, ramp);
    }
    if (chain.haas) {
      /* 关闭时 k=0：xLR/xRL 两个负增益归零，输出等于两路 dry 直通，
         与输入逐样本相同 —— 和 surround 用同一套「关掉必须严格中性」的约束。 */
      var hOn = !!settings.haasEnabled;
      var k = hOn ? clamp(settings.haasMix, 0, HAAS_MIX_LIMIT) : 0;
      /* k=0 时给 0 而不是 -0：-0 在 Web Audio 里等价，但读出来会让探针误判成「非零」 */
      var kGain = k > 0 ? -k : 0;
      setParam(chain.haas.xLR.gain, kGain, ramp);
      setParam(chain.haas.xRL.gain, kGain, ramp);
      var dSec = clamp(settings.haasDelayMs, HAAS_DELAY_MIN, HAAS_DELAY_MAX) / 1000;
      /* delayTime 拉长 ramp 会被听成变调（读取指针平滑移动 = doppler）：
         拖滑块时给 20ms 以内的小平滑，别用 30ms 的通用 ramp。 */
      setParam(chain.haas.delayL.delayTime, dSec, Math.min(ramp, 20));
      setParam(chain.haas.delayR.delayTime, dSec, Math.min(ramp, 20));
    }
    if (chain.vbs) {
      /* 关闭时 mix=0：总和节点只剩原信号（vbSum.gain=1 且只有直连那一路），逐样本直通。 */
      var vOn = !!settings.vbEnabled;
      var vFc = clamp(settings.vbCrossoverHz, VB_FC_MIN, VB_FC_MAX);
      var nyq = (Number(chain.ctx && chain.ctx.sampleRate) || 44100) / 2 - 200;
      setParam(chain.vbs.lowpass.frequency, Math.min(vFc, nyq), ramp);
      setParam(chain.vbs.dcBlock.frequency, Math.min(vFc * 1.1, nyq), ramp);
      setParam(chain.vbs.bandLimit.frequency, Math.min(vFc * VB_HARMONIC_RATIO, nyq), ramp);
      setParam(chain.vbs.mix.gain,
        (vOn && chain.vbs.shaper) ? clamp(settings.vbAmount, 0, 1) * VB_MIX_SCALE : 0, ramp);
    }
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

    /* ── 立体环绕：M/S 矩阵 + 侧声道早期反射 ──────────────────────────
     * 只处理 side，mid（人声、bass）原地不动：
     * 对两声道整体加延迟会触发 Haas 效应，幻象中心被拉偏（ViPER 差分环绕那人声偏左的老毛病）。
     * 关闭态必须严格直通 —— width=1、ambience=0 时 outL/outR 与输入逐样本相同。
     * 插在 loudness 之后、限幅器之前：宽度拉满时多出来的峰值由 safetyLimiter 兜住。 */
    var surSplitter = ctx.createChannelSplitter(2);
    var surMidL = ctx.createGain(); surMidL.gain.value = 0.5;
    var surMidR = ctx.createGain(); surMidR.gain.value = 0.5;
    var surSideL = ctx.createGain(); surSideL.gain.value = 0.5;
    var surSideR = ctx.createGain(); surSideR.gain.value = -0.5;
    var surMid = ctx.createGain(); surMid.gain.value = 1;
    var surSide = ctx.createGain(); surSide.gain.value = 1;
    var surWidth = ctx.createGain(); surWidth.gain.value = 1;
    /* 中置分离双推子：mid=1/side=1 时与原信号完全一致 */
    var surMidGain = ctx.createGain(); surMidGain.gain.value = 1;
    var surSideGain = ctx.createGain(); surSideGain.gain.value = 1;
    /* 压低 mid 会连带削掉居中定位的 bass（bass 基本都在 mid 里），用低架补偿找回来；
       补偿量跟 midGain 联动，mid=100% 时补偿为 0dB，保证默认严格中性。 */
    var surBassComp = ctx.createBiquadFilter();
    surBassComp.type = 'lowshelf';
    surBassComp.frequency.value = 120;
    surBassComp.gain.value = 0;
    var surHp = ctx.createBiquadFilter(); surHp.type = 'highpass'; surHp.frequency.value = 180; surHp.Q.value = 0.707;
    var surD1 = ctx.createDelay(0.08); surD1.delayTime.value = 0.011;
    var surD2 = ctx.createDelay(0.08); surD2.delayTime.value = 0.019;
    var surG1 = ctx.createGain(); surG1.gain.value = 0;
    var surG2 = ctx.createGain(); surG2.gain.value = 0;
    var surInvert = ctx.createGain(); surInvert.gain.value = -1;
    var surSum = ctx.createGain(); surSum.gain.value = 1;
    var surSumNeg = ctx.createGain(); surSumNeg.gain.value = -1;
    var surOutL = ctx.createGain();
    var surOutR = ctx.createGain();
    var surMerger = ctx.createChannelMerger(2);

    loudness.connect(surSplitter);
    surSplitter.connect(surMidL, 0);
    surSplitter.connect(surMidR, 1);
    surSplitter.connect(surSideL, 0);
    surSplitter.connect(surSideR, 1);
    surMidL.connect(surMid);
    surMidR.connect(surMid);
    surSideL.connect(surSide);
    surSideR.connect(surSide);
    surSide.connect(surWidth);
    surWidth.connect(surSideGain);
    surSideGain.connect(surSum);
    surSideGain.connect(surHp);
    surHp.connect(surD1); surD1.connect(surG1); surG1.connect(surSum);
    surHp.connect(surD2); surD2.connect(surG2); surG2.connect(surInvert); surInvert.connect(surSum);
    surMid.connect(surMidGain);
    surMidGain.connect(surOutL);
    surSum.connect(surOutL);
    surMidGain.connect(surOutR);
    surSum.connect(surSumNeg); surSumNeg.connect(surOutR);
    surOutL.connect(surMerger, 0, 0);
    surOutR.connect(surMerger, 0, 1);
    surMerger.connect(surBassComp);

    /* ── 3D 丽音：交叉差分延迟（ViPER 差分环绕的同构实现）──────────────
     *   out_L = in_L − k·HP(delay(in_R, d))
     *   out_R = in_R − k·HP(delay(in_L, d))
     * 相减而不是相加：侧向能量被放大、总能量不涨，所以不会像「只延迟一路」
     * 那样糊成一坨；也不做单边延迟——那套会让幻象中心偏向先到的一侧
     * （酷狗 3D 丽音被吐槽「左耳声音更大」就是这个代价）。
     * 延迟支路先过 300Hz 高通：低频不参与差分，bass 不会被梳状滤波削掉。
     * 关掉时 k=0，两路 dry 原样合流，与输入逐样本相同。 */
    var haasSplitter = ctx.createChannelSplitter(2);
    var haasDryL = ctx.createGain(); haasDryL.gain.value = 1;
    var haasDryR = ctx.createGain(); haasDryR.gain.value = 1;
    var haasHpL = ctx.createBiquadFilter();
    haasHpL.type = 'highpass'; haasHpL.frequency.value = HAAS_FOCUS_HZ; haasHpL.Q.value = 0.707;
    var haasHpR = ctx.createBiquadFilter();
    haasHpR.type = 'highpass'; haasHpR.frequency.value = HAAS_FOCUS_HZ; haasHpR.Q.value = 0.707;
    /* maxDelayTime 给 50ms：上限 35ms 留余量，写超了 Chromium 会抛 RangeError */
    var haasDelayL = ctx.createDelay(0.05); haasDelayL.delayTime.value = settings.haasDelayMs / 1000;
    var haasDelayR = ctx.createDelay(0.05); haasDelayR.delayTime.value = settings.haasDelayMs / 1000;
    /* 两个负增益的初值是 0（=关闭）；符号在 applyAll 里给，这里只是占位 */
    var haasXLR = ctx.createGain(); haasXLR.gain.value = 0;
    var haasXRL = ctx.createGain(); haasXRL.gain.value = 0;
    var haasMerger = ctx.createChannelMerger(2);

    /* ── 虚拟低音（心理声学低音增强）：并联谐波支路 ──────────────────────
     * 原信号照常走 vbSum；另一路取低频 → 软整流造谐波 → 掐掉基频和直流 →
     * 限带后按比例混回。耳朵听到的是 2f/3f/4f 这组谐波，「补」出纸盆根本
     * 推不出来的那个基频——这是小耳机/笔记本外放唯一能真正「有低频」的办法，
     * 用 EQ 抬 62Hz 只会让它更响更糊。
     * 关掉时 vbMix=0，vbSum 只剩直连那一路，与输入逐样本相同。 */
    var vbSum = ctx.createGain(); vbSum.gain.value = 1;
    var vbLowpass = ctx.createBiquadFilter();
    vbLowpass.type = 'lowpass'; vbLowpass.frequency.value = settings.vbCrossoverHz; vbLowpass.Q.value = 0.707;
    var vbPre = ctx.createGain(); vbPre.gain.value = VB_DRIVE;
    var vbShaper = typeof ctx.createWaveShaper === 'function' ? ctx.createWaveShaper() : null;
    if (vbShaper) { vbShaper.curve = virtualBassCurve(); vbShaper.oversample = '2x'; }
    /* 整流会引入直流偏移：这一级必须存在，否则会往功放灌直流 */
    var vbDcBlock = ctx.createBiquadFilter();
    vbDcBlock.type = 'highpass'; vbDcBlock.frequency.value = settings.vbCrossoverHz * 1.1; vbDcBlock.Q.value = 0.707;
    var vbBandLimit = ctx.createBiquadFilter();
    vbBandLimit.type = 'lowpass';
    vbBandLimit.frequency.value = Math.min(settings.vbCrossoverHz * VB_HARMONIC_RATIO, nyquistGuard);
    vbBandLimit.Q.value = 0.707;
    var vbMix = ctx.createGain(); vbMix.gain.value = 0;

    surBassComp.connect(vbSum);
    surBassComp.connect(vbLowpass);
    vbLowpass.connect(vbPre);
    if (vbShaper) {
      vbPre.connect(vbShaper);
      vbShaper.connect(vbDcBlock);
    } else {
      /* 没有 WaveShaperNode 的内核上整条支路无效，主信号仍直通（applyAll 会把 mix 压成 0） */
      vbPre.connect(vbDcBlock);
    }
    vbDcBlock.connect(vbBandLimit);
    vbBandLimit.connect(vbMix);
    vbMix.connect(vbSum);
    vbSum.connect(haasSplitter);
    haasSplitter.connect(haasDryL, 0);
    haasSplitter.connect(haasDryR, 1);
    haasDryL.connect(haasMerger, 0, 0);
    haasDryR.connect(haasMerger, 0, 1);
    haasSplitter.connect(haasHpL, 0);
    haasHpL.connect(haasDelayL);
    haasDelayL.connect(haasXLR);
    haasXLR.connect(haasMerger, 0, 1);
    haasSplitter.connect(haasHpR, 1);
    haasHpR.connect(haasDelayR);
    haasDelayR.connect(haasXRL);
    haasXRL.connect(haasMerger, 0, 0);

    if (safetyLimiter) { haasMerger.connect(safetyLimiter); safetyLimiter.connect(antiClick); }
    else haasMerger.connect(antiClick);
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
      surround: {
        width: surWidth,
        g1: surG1,
        g2: surG2,
        midGain: surMidGain,
        sideGain: surSideGain,
        bassComp: surBassComp,
        delay1: surD1,
        delay2: surD2,
        nodes: [surSplitter, surMidL, surMidR, surSideL, surSideR, surMid, surSide,
          surWidth, surMidGain, surSideGain, surBassComp, surHp, surD1, surD2,
          surG1, surG2, surInvert, surSum, surSumNeg, surOutL, surOutR, surMerger]
      },
      haas: {
        splitter: haasSplitter,
        dryL: haasDryL,
        dryR: haasDryR,
        hpL: haasHpL,
        hpR: haasHpR,
        delayL: haasDelayL,
        delayR: haasDelayR,
        xLR: haasXLR,
        xRL: haasXRL,
        merger: haasMerger,
        nodes: [haasSplitter, haasDryL, haasDryR, haasHpL, haasHpR,
          haasDelayL, haasDelayR, haasXLR, haasXRL, haasMerger]
      },
      vbs: {
        sum: vbSum,
        lowpass: vbLowpass,
        pre: vbPre,
        shaper: vbShaper,
        dcBlock: vbDcBlock,
        bandLimit: vbBandLimit,
        mix: vbMix,
        nodes: [vbSum, vbLowpass, vbPre, vbShaper, vbDcBlock, vbBandLimit, vbMix]
      },
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
    if (chain.surround && chain.surround.nodes) nodes = nodes.concat(chain.surround.nodes);
    if (chain.haas && chain.haas.nodes) nodes = nodes.concat(chain.haas.nodes);
    if (chain.vbs && chain.vbs.nodes) nodes = nodes.concat(chain.vbs.nodes);
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
    toggleButton('audio-tuning-surround-toggle', settings.surroundEnabled);
    toggleButton('audio-tuning-haas-toggle', settings.haasEnabled);
    toggleButton('audio-tuning-bass-toggle', settings.vbEnabled);
    var active = global.document.activeElement;
    var surW = el('at-surround-width');
    var surWV = el('at-surround-width-v');
    if (surW && surW !== active) {
      surW.value = String(Math.round(settings.surroundWidth * 100));
      if (surW.style && typeof surW.style.setProperty === 'function') {
        surW.style.setProperty('--at-fill', Math.round((settings.surroundWidth / 2) * 100) + '%');
      }
    }
    if (surWV) surWV.textContent = Math.round(settings.surroundWidth * 100) + '%';
    /* 空间推子统一走「轻量 input」：只刷新自己这一根的外观，音频与落盘都交给调度器 */
    function bindSpatialSlider(id, applyValue) {
      var input = el(id);
      if (!input || input.getAttribute('data-bound') === '1') return;
      input.setAttribute('data-bound', '1');
      input.addEventListener('input', function (e) {
        var v = clamp(e.target.value, 0, 200);
        applyValue(v);
        var pct = Math.round(v);
        if (input.style && typeof input.style.setProperty === 'function') {
          input.style.setProperty('--at-fill', Math.round((v / 200) * 100) + '%');
        }
        var valEl = el(id + '-v');
        if (valEl) valEl.textContent = pct + '%';
        scheduleApply();
        scheduleSave();
      });
      /* 松手时才落盘一次，保证中途崩溃也不丢（低频、不阻塞拖动） */
      input.addEventListener('change', function () { saveSettings(); });
    }
    bindSpatialSlider('at-center-mid', function (v) { settings.midGain = v / 100; });
    bindSpatialSlider('at-center-side', function (v) { settings.sideGain = v / 100; });
    var surA = el('at-surround-ambience');
    var surAV = el('at-surround-ambience-v');
    if (surA && surA !== active) {
      surA.value = String(Math.round(settings.surroundAmbience * 100));
      if (surA.style && typeof surA.style.setProperty === 'function') {
        surA.style.setProperty('--at-fill', Math.round(settings.surroundAmbience * 100) + '%');
      }
    }
    if (surAV) surAV.textContent = Math.round(settings.surroundAmbience * 100) + '%';
    /* 开关联动展开/收起：开着才把滑块摊开，关掉收起（保留数值，下次打开还是上次那组） */
    toggleButton('audio-tuning-center-toggle', settings.centerEnabled);
    var surSliders = el('audio-tuning-surround-sliders');
    if (surSliders) surSliders.classList.toggle('is-open', !!settings.surroundEnabled);
    var cenSliders = el('audio-tuning-center-sliders');
    if (cenSliders) cenSliders.classList.toggle('is-open', !!settings.centerEnabled);
    var haasSliders = el('audio-tuning-haas-sliders');
    if (haasSliders) haasSliders.classList.toggle('is-open', !!settings.haasEnabled);
    var bassSliders = el('audio-tuning-bass-sliders');
    if (bassSliders) bassSliders.classList.toggle('is-open', !!settings.vbEnabled);
    var surBody = el('audio-tuning-surround-body');
    if (surBody) surBody.classList.toggle('is-off', !settings.surroundEnabled);
    var haasBody = el('audio-tuning-haas-body');
    if (haasBody) haasBody.classList.toggle('is-off', !settings.haasEnabled);
    var bassBody = el('audio-tuning-bass-body');
    if (bassBody) bassBody.classList.toggle('is-off', !settings.vbEnabled);
    var midEl = el('at-center-mid');
    var midV = el('at-center-mid-v');
    if (midEl && midEl !== active) {
      midEl.value = String(Math.round(settings.midGain * 100));
      if (midEl.style && typeof midEl.style.setProperty === 'function') {
        midEl.style.setProperty('--at-fill', Math.round((settings.midGain / 2) * 100) + '%');
      }
    }
    if (midV) midV.textContent = Math.round(settings.midGain * 100) + '%';
    var sideEl = el('at-center-side');
    var sideV = el('at-center-side-v');
    if (sideEl && sideEl !== active) {
      sideEl.value = String(Math.round(settings.sideGain * 100));
      if (sideEl.style && typeof sideEl.style.setProperty === 'function') {
        sideEl.style.setProperty('--at-fill', Math.round((settings.sideGain / 2) * 100) + '%');
      }
    }
    if (sideV) sideV.textContent = Math.round(settings.sideGain * 100) + '%';
    var haasMixEl = el('at-haas-mix');
    var haasMixV = el('at-haas-mix-v');
    if (haasMixEl && haasMixEl !== active) {
      haasMixEl.value = String(Math.round(settings.haasMix * 100));
      if (haasMixEl.style && typeof haasMixEl.style.setProperty === 'function') {
        haasMixEl.style.setProperty('--at-fill', Math.round((settings.haasMix / HAAS_MIX_LIMIT) * 100) + '%');
      }
    }
    if (haasMixV) haasMixV.textContent = Math.round(settings.haasMix * 100) + '%';
    var haasDelayEl = el('at-haas-delay');
    var haasDelayV = el('at-haas-delay-v');
    if (haasDelayEl && haasDelayEl !== active) {
      haasDelayEl.value = String(Math.round(settings.haasDelayMs));
      if (haasDelayEl.style && typeof haasDelayEl.style.setProperty === 'function') {
        haasDelayEl.style.setProperty('--at-fill',
          Math.round(((settings.haasDelayMs - HAAS_DELAY_MIN) / (HAAS_DELAY_MAX - HAAS_DELAY_MIN)) * 100) + '%');
      }
    }
    if (haasDelayV) haasDelayV.textContent = Math.round(settings.haasDelayMs) + 'ms';
    var bassFcEl = el('at-bass-freq');
    var bassFcV = el('at-bass-freq-v');
    if (bassFcEl && bassFcEl !== active) {
      bassFcEl.value = String(Math.round(settings.vbCrossoverHz));
      if (bassFcEl.style && typeof bassFcEl.style.setProperty === 'function') {
        bassFcEl.style.setProperty('--at-fill',
          Math.round(((settings.vbCrossoverHz - VB_FC_MIN) / (VB_FC_MAX - VB_FC_MIN)) * 100) + '%');
      }
    }
    if (bassFcV) bassFcV.textContent = Math.round(settings.vbCrossoverHz) + 'Hz';
    var bassAmtEl = el('at-bass-amount');
    var bassAmtV = el('at-bass-amount-v');
    if (bassAmtEl && bassAmtEl !== active) {
      bassAmtEl.value = String(Math.round(settings.vbAmount * 100));
      if (bassAmtEl.style && typeof bassAmtEl.style.setProperty === 'function') {
        bassAmtEl.style.setProperty('--at-fill', Math.round(settings.vbAmount * 100) + '%');
      }
    }
    if (bassAmtV) bassAmtV.textContent = Math.round(settings.vbAmount * 100) + '%';
    for (var i = 0; i < EQ_BANDS.length; i++) {
      var input = el('at-eq-' + i);
      var label = el('at-eq-v-' + i);
      if (input && input !== active) {
        input.value = String(settings.eq[i]);
        // 竖向推子：--at-fill 是从底部算起的填充高度，-12dB 为 0%、+12dB 为 100%
        if (input.style && typeof input.style.setProperty === 'function') {
          input.style.setProperty('--at-fill', Math.round(((settings.eq[i] + EQ_LIMIT_DB) / (EQ_LIMIT_DB * 2)) * 100) + '%');
        }
      }
      if (label) label.textContent = fmtDb(settings.eq[i]);
      var bandNode = input && input.closest ? input.closest('.at-eq-band') : null;
      if (bandNode) {
        bandNode.classList.toggle('is-boost', settings.eq[i] > 0.25);
        bandNode.classList.toggle('is-cut', settings.eq[i] < -0.25);
      }
    }
    var preamp = el('at-preamp');
    var preampV = el('at-preamp-v');
    if (preamp && preamp !== active) preamp.value = String(settings.preampDb);
    if (preampV) preampV.textContent = fmtDb(settings.preampDb) + 'dB';
    var balance = el('at-balance');
    var balanceV = el('at-balance-v');
    if (balance && balance !== active) balance.value = String(Math.round(settings.balance * 100));
    if (balanceV) {
      var pct = Math.round(settings.balance * 100);
      balanceV.textContent = pct === 0 ? '中' : (pct < 0 ? 'L' + Math.abs(pct) : 'R' + pct);
    }
    var summary = el('audio-tuning-summary');
    if (summary) {
      /* 折叠起来时摘要要能看出「还有哪些效果开着」，否则合并到一体后会被忘掉 */
      var parts = [
        (PRESET_LABELS[settings.preset] || '自定义'),
        '响度' + (settings.replayGainEnabled ? fmtDb(runtime.appliedDb) + 'dB' : '关')
      ];
      if (settings.surroundEnabled) parts.push('环绕' + Math.round(settings.surroundWidth * 100) + '%');
      if (settings.haasEnabled) parts.push('3D' + Math.round(settings.haasMix * 100) + '%');
      if (settings.vbEnabled) parts.push('低音' + Math.round(settings.vbAmount * 100) + '%');
      if (Math.abs(settings.midGain - 1) > 0.001 || Math.abs(settings.sideGain - 1) > 0.001) {
        parts.push('人声' + Math.round(settings.midGain * 100) + '/' + Math.round(settings.sideGain * 100));
      }
      summary.textContent = parts.join(' · ');
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
    var html = '<div class="at-eq-rack">';
    for (var i = 0; i < EQ_BANDS.length; i++) {
      var fill = Math.round(((settings.eq[i] + EQ_LIMIT_DB) / (EQ_LIMIT_DB * 2)) * 100);
      html += '<div class="at-eq-band">' +
        '<div class="at-eq-slot">' +
        '<input id="at-eq-' + i + '" class="at-eq-range" type="range" min="-' + EQ_LIMIT_DB + '" max="' + EQ_LIMIT_DB +
        '" step="0.5" value="' + settings.eq[i] + '" data-band="' + i + '" style="--at-fill:' + fill + '%"' +
        ' aria-label="' + EQ_BANDS[i] + '赫兹均衡增益">' +
        '</div>' +
        '<span class="at-eq-freq">' + EQ_LABELS[i] + '</span>' +
        '<span class="at-eq-val" id="at-eq-v-' + i + '">' + fmtDb(settings.eq[i]) + '</span>' +
        '</div>';
    }
    html += '</div>';
    rows.innerHTML = html;

    /* 预设卡片的频谱缩略：按预设自己的曲线画十根柱子。
     * 整块包 try/catch —— 单测里的 document/元素是能力极简的桩，
     * 少一个 querySelector 就把 buildUi 整个打断，得不偿失。 */
    try {
      /* 走宿主元素 + 能力检测，不直接 document.querySelectorAll —— 单测里的 document
       * 是只有 getElementById 的桩，直接调会 TypeError 把整个 buildUi 打断。 */
      var presetHost = el('audio-tuning-presets');
      if (presetHost && typeof presetHost.querySelectorAll === 'function') Array.prototype.forEach.call(presetHost.querySelectorAll('button[data-preset]'), function (btn) {
        var wave = btn.querySelector('.at-preset-wave');
        var preset = PRESETS[btn.getAttribute('data-preset')];
        if (!wave || !preset || wave.childElementCount) return;
        var bars = '';
        for (var k = 0; k < preset.length; k++) {
          var h = 24 + ((preset[k] + EQ_LIMIT_DB) / (EQ_LIMIT_DB * 2)) * 56;
          bars += '<i style="height:' + h.toFixed(0) + '%"></i>';
        }
        wave.innerHTML = bars;
      });
    } catch (_) {}

    /* 十段 EQ 的输入委托：整排共用一处监听（之前误删过一次，别再动） */
    rows.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.getAttribute('data-band') == null) return;
      var idx = clamp(t.getAttribute('data-band'), 0, EQ_BANDS.length - 1);
      settings.eq[idx] = clamp(t.value, -EQ_LIMIT_DB, EQ_LIMIT_DB);
      settings.preset = 'custom';
      if (t.style && typeof t.style.setProperty === 'function') {
        t.style.setProperty('--at-fill', Math.round(((settings.eq[idx] + EQ_LIMIT_DB) / (EQ_LIMIT_DB * 2)) * 100) + '%');
      }
      var valueEl = el('at-eq-v-' + idx);
      if (valueEl) valueEl.textContent = fmtDb(settings.eq[idx]);
      var band = t.closest ? t.closest('.at-eq-band') : null;
      if (band) {
        band.classList.toggle('is-boost', settings.eq[idx] > 0.25);
        band.classList.toggle('is-cut', settings.eq[idx] < -0.25);
      }
      var presetWrap = el('audio-tuning-presets');
      if (presetWrap && typeof presetWrap.querySelectorAll === 'function') {
        Array.prototype.forEach.call(presetWrap.querySelectorAll('button[data-preset]'), function (b) {
          b.classList.toggle('active', false);
        });
      }
      scheduleApply();
      scheduleSave();
    });
    rows.addEventListener('change', function () { saveSettings(); syncUi(); });
    var preamp = el('at-preamp');
    if (preamp) preamp.addEventListener('input', function (e) {
      settings.preampDb = clamp(e.target.value, -PREAMP_LIMIT_DB, PREAMP_LIMIT_DB);
      var valueEl = el('at-preamp-v');
      if (valueEl) valueEl.textContent = fmtDb(settings.preampDb) + 'dB';
      scheduleApply();
      scheduleSave();
    });
    if (preamp) preamp.addEventListener('change', function () { saveSettings(); syncUi(); });
    var balance = el('at-balance');
    if (balance) balance.addEventListener('input', function (e) {
      settings.balance = clamp(e.target.value, -100, 100) / 100;
      var pct = Math.round(settings.balance * 100);
      var valueEl = el('at-balance-v');
      if (valueEl) valueEl.textContent = pct === 0 ? '中' : (pct < 0 ? 'L' + Math.abs(pct) : 'R' + pct);
      scheduleApply();
      scheduleSave();
    });
    if (balance) balance.addEventListener('change', function () { saveSettings(); syncUi(); });
    var surW = el('at-surround-width');
    if (surW) surW.addEventListener('input', function (e) {
      settings.surroundWidth = clamp(e.target.value, 0, 200) / 100;
      /* 拖滑块视为想听效果：自动开开关，避免「拖了没反应」 */
      if (!settings.surroundEnabled && settings.surroundWidth !== 1) settings.surroundEnabled = true;
      if (surW.style && typeof surW.style.setProperty === 'function') {
        surW.style.setProperty('--at-fill', Math.round((settings.surroundWidth / 2) * 100) + '%');
      }
      var wv = el('at-surround-width-v');
      if (wv) wv.textContent = Math.round(settings.surroundWidth * 100) + '%';
      scheduleApply();
      scheduleSave();
    });
    if (surW) surW.addEventListener('change', function () { saveSettings(); });
    var surA = el('at-surround-ambience');
    if (surA) surA.addEventListener('input', function (e) {
      settings.surroundAmbience = clamp(e.target.value, 0, 100) / 100;
      if (!settings.surroundEnabled && settings.surroundAmbience > 0) settings.surroundEnabled = true;
      if (surA.style && typeof surA.style.setProperty === 'function') {
        surA.style.setProperty('--at-fill', Math.round(settings.surroundAmbience * 100) + '%');
      }
      var av = el('at-surround-ambience-v');
      if (av) av.textContent = Math.round(settings.surroundAmbience * 100) + '%';
      scheduleApply();
      scheduleSave();
    });
    if (surA) surA.addEventListener('change', function () { saveSettings(); });
    /* 3D 丽音两根滑块：拖动视为想听效果（与 surround 同一套语义），
     * 但强度为 0 时不自动开——0 等于没效果，开了只会让人以为坏了。 */
    var haasMix = el('at-haas-mix');
    if (haasMix) haasMix.addEventListener('input', function (e) {
      settings.haasMix = clamp(e.target.value, 0, HAAS_MIX_LIMIT * 100) / 100;
      if (!settings.haasEnabled && settings.haasMix > 0.001) settings.haasEnabled = true;
      if (haasMix.style && typeof haasMix.style.setProperty === 'function') {
        haasMix.style.setProperty('--at-fill', Math.round((settings.haasMix / HAAS_MIX_LIMIT) * 100) + '%');
      }
      var mv = el('at-haas-mix-v');
      if (mv) mv.textContent = Math.round(settings.haasMix * 100) + '%';
      scheduleApply();
      scheduleSave();
    });
    if (haasMix) haasMix.addEventListener('change', function () { saveSettings(); });
    var haasDelay = el('at-haas-delay');
    if (haasDelay) haasDelay.addEventListener('input', function (e) {
      settings.haasDelayMs = clamp(e.target.value, HAAS_DELAY_MIN, HAAS_DELAY_MAX);
      if (!settings.haasEnabled && settings.haasMix > 0.001) settings.haasEnabled = true;
      if (haasDelay.style && typeof haasDelay.style.setProperty === 'function') {
        haasDelay.style.setProperty('--at-fill',
          Math.round(((settings.haasDelayMs - HAAS_DELAY_MIN) / (HAAS_DELAY_MAX - HAAS_DELAY_MIN)) * 100) + '%');
      }
      var dv = el('at-haas-delay-v');
      if (dv) dv.textContent = Math.round(settings.haasDelayMs) + 'ms';
      scheduleApply();
      scheduleSave();
    });
    if (haasDelay) haasDelay.addEventListener('change', function () { saveSettings(); });
    /* 虚拟低音两根滑块：分频点跟设备走（笔记本 150–300，书架箱 80–120），
       动了就视为要用这个效果，自动开开关。 */
    var bassFc = el('at-bass-freq');
    if (bassFc) bassFc.addEventListener('input', function (e) {
      settings.vbCrossoverHz = clamp(e.target.value, VB_FC_MIN, VB_FC_MAX);
      if (!settings.vbEnabled && settings.vbAmount > 0.001) settings.vbEnabled = true;
      if (bassFc.style && typeof bassFc.style.setProperty === 'function') {
        bassFc.style.setProperty('--at-fill',
          Math.round(((settings.vbCrossoverHz - VB_FC_MIN) / (VB_FC_MAX - VB_FC_MIN)) * 100) + '%');
      }
      var fv = el('at-bass-freq-v');
      if (fv) fv.textContent = Math.round(settings.vbCrossoverHz) + 'Hz';
      scheduleApply();
      scheduleSave();
    });
    if (bassFc) bassFc.addEventListener('change', function () { saveSettings(); });
    var bassAmt = el('at-bass-amount');
    if (bassAmt) bassAmt.addEventListener('input', function (e) {
      settings.vbAmount = clamp(e.target.value, 0, 100) / 100;
      if (!settings.vbEnabled && settings.vbAmount > 0.001) settings.vbEnabled = true;
      if (bassAmt.style && typeof bassAmt.style.setProperty === 'function') {
        bassAmt.style.setProperty('--at-fill', Math.round(settings.vbAmount * 100) + '%');
      }
      var av = el('at-bass-amount-v');
      if (av) av.textContent = Math.round(settings.vbAmount * 100) + '%';
      scheduleApply();
      scheduleSave();
    });
    if (bassAmt) bassAmt.addEventListener('change', function () { saveSettings(); });
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
    /* 3D 丽音这类预设自带音效级：点一下 = 整套一键音效，不只是改 EQ 曲线。
       普通预设（flat/pop/rock/vocal）没有这一项，行为保持不变。 */
    var fx = PRESET_FX[name];
    if (fx) {
      settings.haasEnabled = true;
      if (fx.haasDelayMs != null) settings.haasDelayMs = clamp(fx.haasDelayMs, HAAS_DELAY_MIN, HAAS_DELAY_MAX);
      if (fx.haasMix != null) settings.haasMix = clamp(fx.haasMix, 0, HAAS_MIX_LIMIT);
    }
    saveSettings();
    applyAll();
    syncUi();
  }
  function toggleOption(key) {
    settings[key] = !settings[key];
    /* 打开立体环绕时，如果两个参数还在中性位（声场 100% / 反射 0%），
     * 这一级在数学上是严格直通的 —— 开关本身不会有任何可听变化。
     * 所以首次打开给一组「听得出来但不夸张」的默认值。 */
    if (key === 'surroundEnabled' && settings.surroundEnabled &&
        Math.abs(settings.surroundWidth - 1) < 0.001 && settings.surroundAmbience < 0.001) {
      settings.surroundWidth = 1.3;
      settings.surroundAmbience = 0.12;
    }
    /* 同理：人声/伴奏 100% / 100% 等于没开，首次打开压一点人声让效果可见 */
    if (key === 'centerEnabled' && settings.centerEnabled &&
        Math.abs(settings.midGain - 1) < 0.001 && Math.abs(settings.sideGain - 1) < 0.001) {
      settings.midGain = 0.6;
    }
    /* 3D 丽音同理：强度 0 时开关本身没有可听变化，打开时补一组默认值 */
    if (key === 'haasEnabled' && settings.haasEnabled && settings.haasMix < 0.001) {
      settings.haasMix = 0.28;
      settings.haasDelayMs = 22;
    }
    /* 虚拟低音：强度 0 时开了等于没效果，补一组默认值 */
    if (key === 'vbEnabled' && settings.vbEnabled && settings.vbAmount < 0.001) {
      settings.vbAmount = 0.45;
      settings.vbCrossoverHz = 150;
    }
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
    /* 立体环绕：给设置页之外（快捷键 / 探针 / 以后的三条杠快捷项）用的最小接口 */
    setSurround: function (cfg) {
      cfg = cfg || {};
      if (cfg.enabled != null) settings.surroundEnabled = !!cfg.enabled;
      if (cfg.width != null) settings.surroundWidth = clamp(cfg.width, 0, 2);
      if (cfg.ambience != null) settings.surroundAmbience = clamp(cfg.ambience, 0, 1);
      saveSettings();
      applyAll();
      syncUi();
      return settings.surroundEnabled;
    },
    /* 中置分离：mid 主要是人声与居中乐器，side 主要是铺开的伴奏。
       这是 M/S 原理，不是真分轨 —— 会连带影响居中定位的 bass / 军鼓。 */
    setCenter: function (cfg) {
      cfg = cfg || {};
      if (cfg.mid != null) settings.midGain = clamp(cfg.mid, 0, 2);
      if (cfg.side != null) settings.sideGain = clamp(cfg.side, 0, 2);
      /* 明确改了参数就视为要用这个效果；保持与「拖滑块自动开」同一套语义 */
      if ((cfg.mid != null && Math.abs(settings.midGain - 1) > 0.001) ||
          (cfg.side != null && Math.abs(settings.sideGain - 1) > 0.001)) {
        settings.centerEnabled = true;
      }
      saveSettings();
      applyAll();
      syncUi();
      return { mid: settings.midGain, side: settings.sideGain };
    },
    getCenter: function () {
      return { mid: settings.midGain, side: settings.sideGain };
    },
    /* 3D 丽音（差分延迟环绕）：delayMs 8~35，mix 0~0.6 */
    setHaas: function (cfg) {
      cfg = cfg || {};
      if (cfg.enabled != null) settings.haasEnabled = !!cfg.enabled;
      if (cfg.delayMs != null) settings.haasDelayMs = clamp(cfg.delayMs, HAAS_DELAY_MIN, HAAS_DELAY_MAX);
      if (cfg.mix != null) settings.haasMix = clamp(cfg.mix, 0, HAAS_MIX_LIMIT);
      saveSettings();
      applyAll();
      syncUi();
      return settings.haasEnabled;
    },
    getHaas: function () {
      return {
        enabled: !!settings.haasEnabled,
        delayMs: settings.haasDelayMs,
        mix: settings.haasMix
      };
    },
    /* 虚拟低音（心理声学低音增强）：crossoverHz 60~300，amount 0~1 */
    setVirtualBass: function (cfg) {
      cfg = cfg || {};
      if (cfg.enabled != null) settings.vbEnabled = !!cfg.enabled;
      if (cfg.crossoverHz != null) settings.vbCrossoverHz = clamp(cfg.crossoverHz, VB_FC_MIN, VB_FC_MAX);
      if (cfg.amount != null) settings.vbAmount = clamp(cfg.amount, 0, 1);
      saveSettings();
      applyAll();
      syncUi();
      return settings.vbEnabled;
    },
    getVirtualBass: function () {
      return {
        enabled: !!settings.vbEnabled,
        crossoverHz: settings.vbCrossoverHz,
        amount: settings.vbAmount
      };
    },
    getSurround: function () {
      return {
        enabled: !!settings.surroundEnabled,
        width: settings.surroundWidth,
        ambience: settings.surroundAmbience
      };
    },
    /* 运行时自检：控制台里跑 Mineradio.audioTuning.debugSurround()
     * 一次看清「节点在不在、增益是多少、声音到底走没走 Web Audio」。
     * 「开了没感觉」时先用它排掉链路问题，别靠耳朵猜。 */
    debugSurround: function () {
      var c = chain;
      var out = {
        chainBuilt: !!c,
        surroundInChain: !!(c && c.surround),
        settings: {
          enabled: !!settings.surroundEnabled,
          width: settings.surroundWidth,
          ambience: settings.surroundAmbience
        },
        gains: c && c.surround ? {
          width: c.surround.width.gain.value,
          reflect1: c.surround.g1.gain.value,
          reflect2: c.surround.g2.gain.value,
          mid: c.surround.midGain.gain.value,
          side: c.surround.sideGain.gain.value,
          bassCompDb: c.surround.bassComp.gain.value
        } : null,
        center: { mid: settings.midGain, side: settings.sideGain },
        /* 3D 丽音的实读值：crossLR / crossRL 是负增益，为 0 就说明这一级等于没开 */
        haas: c && c.haas ? {
          enabled: !!settings.haasEnabled,
          dry: [c.haas.dryL.gain.value, c.haas.dryR.gain.value],
          crossLR: c.haas.xLR.gain.value,
          crossRL: c.haas.xRL.gain.value,
          delayMs: Math.round(c.haas.delayL.delayTime.value * 1000)
        } : null,
        /* 虚拟低音：mix 为 0 就说明支路没接通；shaper 为 null 说明内核不支持、已强制静音 */
        vbs: c && c.vbs ? {
          enabled: !!settings.vbEnabled,
          mix: c.vbs.mix.gain.value,
          crossoverHz: Math.round(c.vbs.lowpass.frequency.value),
          dcBlockHz: Math.round(c.vbs.dcBlock.frequency.value),
          bandLimitHz: Math.round(c.vbs.bandLimit.frequency.value),
          hasShaper: !!c.vbs.shaper
        } : null,
        /* 这三项决定「有没有声音走进 Web Audio」：
           audioRouted=false 说明元素还没接到图里（没开始播放或换过源）；
           wasapiActive=true 时声音走的是 WASAPI，但取样点在 gainNode 之后，
           所以调音链仍然生效 —— 若这里 true 而听不出变化，就不是链路的问题。 */
        audioRouted: !!(boundMedia && typeof source !== 'undefined' && source),
        wasapiActive: !!(global.Mineradio && global.Mineradio.wasapiOutput &&
          typeof global.Mineradio.wasapiOutput.isActive === 'function' &&
          global.Mineradio.wasapiOutput.isActive()),
        eqEnabled: !!settings.eqEnabled,
        replayGainEnabled: !!settings.replayGainEnabled,
        antiClickEnabled: !!settings.antiClickEnabled,
        sampleRate: c && c.ctx ? c.ctx.sampleRate : null
      };
      try { console.log('[audioTuning] surround debug', out); } catch (_) { }
      return out;
    },
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
        preset: settings.preset,
        haasEnabled: settings.haasEnabled,
        haasDelayMs: settings.haasDelayMs,
        haasMix: settings.haasMix,
        vbEnabled: settings.vbEnabled,
        vbCrossoverHz: settings.vbCrossoverHz,
        vbAmount: settings.vbAmount
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
  global.toggleAudioTuningSurround = function () { return toggleOption('surroundEnabled'); };
  global.toggleAudioTuningCenter = function () { return toggleOption('centerEnabled'); };
  global.toggleAudioTuningHaas = function () { return toggleOption('haasEnabled'); };
  global.toggleAudioTuningBass = function () { return toggleOption('vbEnabled'); };
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
