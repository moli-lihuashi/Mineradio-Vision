'use strict';

/* =============================================================================
 * 歌曲过渡效果矩阵回归测试
 *
 * 覆盖：混音 / 渐进 / 无缝 / 立体声四种交接配方、默认关闭零影响、
 * Cuefield 让路、与 16 预载的依赖还原、临时声像扫入扫出与回收、
 * 试听绝不碰主播放链、08 的三个可选 getter 钩子、01 的 balance 存档不被改。
 *
 * 18-track-transition.js 整份真实源码进 vm；08 / 01 的关键函数用大括号配对
 * 从真实源码原样切片执行，不重写实现。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8').replace(/\r\n/g, '\n');

const directorSource = read('public/js/modules/05-playback/18-track-transition.js');
const artSource = read('public/js/modules/05-playback/19-track-transition-art.js');
const graphSource = read('public/js/modules/05-playback/08-audio-graph-controls.js');
const tuningSource = read('public/js/modules/04-mood/01-audio-tuning.js');
const loaderSource = read('public/js/index-loader.js');
const htmlSource = read('public/index.html');
const cssSource = read('public/css/10-shell/shell.css');
const cuefieldSource = read('public/js/modules/05-cuefield/02-cuefield-automix-integration.js');

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  assert.ok(m, '源码里找不到函数 ' + name);
  const open = src.indexOf('{', m.index);
  let depth = 0, inStr = null, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error('函数大括号不配对：' + name);
}

function makeParam(name, log) {
  return {
    value: 0,
    setValueAtTime(v, t) { log.push([name, 'setValueAtTime', v, t]); this.value = v; return this; },
    setValueCurveAtTime(c, t, d) { log.push([name, 'setValueCurveAtTime', c.length, t, d]); return this; },
    linearRampToValueAtTime(v, t) { log.push([name, 'linearRampToValueAtTime', v, t]); this.value = v; return this; },
    setTargetAtTime(v, t, c) { log.push([name, 'setTargetAtTime', v, t, c]); return this; },
    cancelScheduledValues(t) { log.push([name, 'cancelScheduledValues', t]); return this; }
  };
}

function uiEl(id) {
  return {
    id, textContent: '', value: '',
    attrs: Object.create(null),
    classList: {
      _on: Object.create(null),
      toggle(k, on) { this._on[k] = !!on; },
      contains(k) { return !!this._on[k]; }
    },
    setAttribute(k, v) { this.attrs[k] = v; }
  };
}

function makeAudioContext(log) {
  const nodes = [];
  const ctx = {
    currentTime: 1.25,
    destination: { id: 'destination' },
    closed: false,
    createOscillator() {
      const n = { type: '', frequency: { value: 0 }, started: null, stopped: null,
        connect() {}, start(t) { n.started = t; }, stop(t) { n.stopped = t; } };
      nodes.push(n); return n;
    },
    createGain() {
      const n = { gain: makeParam('gain', log), connect() {} };
      nodes.push(n); return n;
    },
    createStereoPanner() {
      const n = { pan: makeParam('pan', log), connect() {} };
      nodes.push(n); return n;
    },
    close() { ctx.closed = true; log.push(['ctx', 'close']); }
  };
  return { ctx, nodes };
}

/* 建一个 18 的独立运行环境。opts：
 *   stored        localStorage 初始存档
 *   cuefield      是否模拟 Cuefield 开启
 *   gaplessOn     16 预载初始状态
 *   withTuning    是否挂 01 的声像 API 桩
 *   withAudio     是否挂 AudioContext 桩
 *   withUi        是否挂快捷菜单 DOM 桩                                    */
function makeRig(opts) {
  opts = opts || {};
  const store = Object.create(null);
  if (opts.stored) store['mineradio-track-transition-v1'] = opts.stored;
  const toasts = [];
  const elements = Object.create(null);
  const panCalls = [];
  const paramLog = [];
  const timers = [];
  let gaplessOn = !!opts.gaplessOn;
  let gaplessToggleCount = 0;
  const gaplessToggles = [];
  const audio = opts.withAudio ? makeAudioContext(paramLog) : null;

  const sandbox = {
    console,
    setTimeout(fn, ms) { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); }
    },
    document: {
      readyState: 'complete',
      getElementById(id) { return elements[id] || null; },
      addEventListener() {}
    },
    Mineradio: {},
    showToast(msg) { toasts.push(msg); },
    __mineradioGaplessHandoff: {
      getStatus() { return { enabled: gaplessOn, toggleCount: gaplessToggleCount }; },
      toggle() {
        gaplessOn = !gaplessOn;
        gaplessToggleCount++;
        gaplessToggles.push(gaplessOn);
        return gaplessOn;
      }
    }
  };
  if (opts.cuefield) sandbox.cuefieldAutoMixEnabled = true;
  if (opts.withTuning) {
    sandbox.Mineradio.audioTuning = {
      setTransitionPan(pan, ramp) { panCalls.push(['set', pan, ramp]); return true; },
      clearTransitionPan(ramp) { panCalls.push(['clear', ramp]); return true; }
    };
  }
  if (audio) sandbox.AudioContext = function () { return audio.ctx; };
  if (opts.withUi) {
    const ids = [
      'track-transition-toggle', 'track-transition-summary', 'track-transition-desc',
      'track-transition-status', 'track-transition-fold', 'track-transition-scene',
      'track-transition-caption', 'track-transition-reset', 'track-transition-preview',
      'track-transition-card-mix', 'track-transition-card-gradual',
      'track-transition-card-seamless', 'track-transition-card-stereo'
    ];
    const paramKeys = {
      mix: ['durationSec', 'curve'], gradual: ['durationSec', 'inRatio'],
      seamless: ['tailMs', 'headMs'], stereo: ['durationSec', 'panPct']
    };
    Object.keys(paramKeys).forEach((mode) => {
      ids.push('track-transition-art-' + mode, 'tt-group-' + mode);
      paramKeys[mode].forEach((key) => {
        ids.push('tt-p-' + mode + '-' + key, 'tt-p-' + mode + '-' + key + '-v');
      });
    });
    ids.push('tt-p-mix-curve-equal-power', 'tt-p-mix-curve-linear');
    ids.forEach((id) => { elements[id] = uiEl(id); });
  }

  vm.createContext(sandbox);
  vm.runInContext(directorSource, sandbox, { filename: '18-track-transition.js' });
  const d = sandbox.Mineradio.trackTransition;
  assert.ok(d, '18 必须挂到 Mineradio.trackTransition');
  return {
    sandbox, d, store, toasts, elements, panCalls, paramLog, timers, audio,
    gaplessToggles,
    isGaplessOn() { return gaplessOn; },
    setGaplessOn(v) { gaplessOn = !!v; gaplessToggleCount++; }
  };
}

/* 08 的钩子在独立沙箱里跑真实源码切片 */
function makeGraphRig(director, mediaOverrides) {
  const rampCalls = [];
  const notifyCalls = [];
  const timers = [];
  const media = Object.assign({
    duration: 100, currentTime: 95, paused: false, ended: false
  }, mediaOverrides || {});
  const d = Object.assign({}, director || {}, {
    onEndFadeStart() { notifyCalls.push('onEndFadeStart'); },
    onTrackStart() { notifyCalls.push('onTrackStart'); }
  });
  const sandbox = {
    console,
    Mineradio: { trackTransition: director || null, playbackAdvanced: { getLookaheadSec: () => 1.8 } },
    AUDIO_FADE_IN_MS: 460,
    AUDIO_FADE_OUT_MS: 420,
    TRACK_END_FADE_LOOKAHEAD_SEC: 1.8,
    audio: media,
    targetVolume: 1,
    audioFadeSerial: 0,
    trackEndFadeToken: 0,
    trackEndFadeTimer: 0,
    trackEndFadeScheduled: false,
    isFinite, Number, Math, Object, Float32Array,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    rampAudioOutputGain(value, ms) { rampCalls.push([value, ms]); },
    setAudioOutputGainImmediate() {},
    cancelTrackEndFade() {},
    trackEndFadeTakenOver() { return false; },
    playbackWallRate() { return 1; },
    requestAnimationFrame() { return 1; },
    performance: { now: () => 0 }
  };
  // onEndFadeStart / onTrackStart 由 transitionNotify 转发，覆盖为记录版
  if (director) {
    sandbox.Mineradio.trackTransition = Object.assign({}, director, {
      onEndFadeStart() { notifyCalls.push('onEndFadeStart'); },
      onTrackStart() { notifyCalls.push('onTrackStart'); }
    });
  }
  const names = ['transitionDirector', 'transitionFadeInMs', 'transitionFadeOutMs',
    'transitionSkipTrackEndFade', 'transitionNotify', 'playbackWallRate',
    'trackEndFadeLookaheadSec', 'scheduleTrackEndFade',
    'startPlaybackFadeIn', 'restorePlaybackGain'];
  vm.createContext(sandbox);
  names.forEach((n) => vm.runInContext(extractFunction(graphSource, n), sandbox, { filename: '08#' + n }));
  return { sandbox, media, rampCalls, notifyCalls, timers, d };
}

// ── 1. 默认关闭 / 配方 ──────────────────────────────────────────────────

test('T01 默认关闭：enabled=false、mode=seamless、所有 getter 不干预', () => {
  const r = makeRig();
  assert.equal(r.d.getStatus().enabled, false);
  assert.equal(r.d.getStatus().mode, 'seamless');
  assert.equal(r.d.getFadeInMs(), null);
  assert.equal(r.d.getFadeOutMs(), null);
  assert.equal(r.d.shouldSkipTrackEndFade(), false);
  assert.equal(r.d.getExtraLookaheadSec(), 0);
  assert.equal(r.d.getStatus().active, false);
  assert.equal(r.gaplessToggles.length, 0, '默认关闭不得偷偷打开 16');
});

test('T02 四种模式都有配方，卡片顺序与截图一致', () => {
  const r = makeRig();
  assert.deepEqual(Array.from(r.d.MODE_ORDER), ['mix', 'gradual', 'seamless', 'stereo']);
  assert.equal(Object.keys(r.d.MODES).length, 4);
});

test('T03 无缝过渡：零淡入零淡出 + 跳过曲末淡出', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'seamless' }), gaplessOn: true });
  assert.equal(r.d.getFadeInMs(), 0);
  assert.equal(r.d.getFadeOutMs(), 0);
  assert.equal(r.d.shouldSkipTrackEndFade(), true);
  assert.equal(r.d.getExtraLookaheadSec(), 0);
  assert.equal(r.d.getStatus().blocked, '');
});

test('T04 渐进过渡：沿用用户淡入淡出设置（null = 不覆盖）', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'gradual' }), gaplessOn: true });
  assert.equal(r.d.getFadeInMs(), null);
  assert.equal(r.d.getFadeOutMs(), null);
  assert.equal(r.d.shouldSkipTrackEndFade(), false);
});

test('T05 混音过渡：长淡变 + 放大排程窗口', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), gaplessOn: true });
  assert.equal(r.d.getFadeInMs(), 1100);
  assert.equal(r.d.getFadeOutMs(), 2400);
  assert.equal(r.d.shouldSkipTrackEndFade(), false);
  assert.ok(Math.abs(r.d.getExtraLookaheadSec() - 4.2) < 1e-9);
});

test('T06 立体声过渡：带声像轨迹 + 放大排程窗口', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), gaplessOn: true });
  assert.equal(r.d.getFadeInMs(), 900);
  assert.equal(r.d.getFadeOutMs(), 2200);
  assert.ok(Math.abs(r.d.MODES.stereo.panOut + 0.85) < 1e-9);
  assert.ok(Math.abs(r.d.MODES.stereo.panIn - 0.85) < 1e-9);
  assert.ok(r.d.getExtraLookaheadSec() > 1.8);
});

// ── 2. 存档 / 开关 / 互斥 ───────────────────────────────────────────────

test('T07 存档读写并持久化，非法 mode 回落到 seamless', () => {
  const r = makeRig();
  r.d.setMode('stereo');
  r.d.toggle();
  const saved = JSON.parse(r.store['mineradio-track-transition-v1']);
  assert.equal(saved.enabled, true);
  assert.equal(saved.mode, 'stereo');
  const r2 = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'not-a-mode' }), gaplessOn: true });
  assert.equal(r2.d.getStatus().mode, 'seamless');
});

test('T08 开启时自动拉起 16 预载，关闭时只还原我们代开的那一次', () => {
  const r = makeRig();
  assert.equal(r.isGaplessOn(), false);
  r.d.toggle();
  assert.equal(r.isGaplessOn(), true);
  assert.equal(r.d.getStatus().autoEnabledGapless, true);
  assert.deepEqual(r.gaplessToggles, [true]);
  r.d.toggle();
  assert.equal(r.isGaplessOn(), false);
  assert.equal(r.d.getStatus().autoEnabledGapless, false);
  assert.deepEqual(r.gaplessToggles, [true, false]);
});

test('T09 用户本来就开着 16：不代开、关闭时也不许关掉它', () => {
  const r = makeRig({ gaplessOn: true });
  r.d.toggle();
  assert.equal(r.d.getStatus().autoEnabledGapless, false);
  assert.deepEqual(r.gaplessToggles, []);
  r.d.toggle();
  assert.equal(r.isGaplessOn(), true);
  assert.deepEqual(r.gaplessToggles, []);
});

test('T10 用户在我们代开后自己又手动操作过：不越权还原', () => {
  const r = makeRig();
  r.d.toggle();                 // 我们代开 -> true
  r.setGaplessOn(false);        // 用户手动关掉
  r.setGaplessOn(true);         // 用户又手动开回来
  r.d.toggle();                 // 关闭编排器
  assert.equal(r.isGaplessOn(), true, '用户显式开着的 16 必须保留');
});

test('T11 Cuefield 开启时整体让路：getter 全部回退到不干预', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), cuefield: true, gaplessOn: true });
  assert.equal(r.d.getStatus().blocked, 'cuefield');
  assert.equal(r.d.getStatus().active, false);
  assert.equal(r.d.getFadeInMs(), null);
  assert.equal(r.d.getFadeOutMs(), null);
  assert.equal(r.d.shouldSkipTrackEndFade(), false);
  assert.equal(r.d.getExtraLookaheadSec(), 0);
});

test('T12 Cuefield 执行中同样让路', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), gaplessOn: true });
  r.sandbox.cuefieldAutoMixExecuting = true;
  assert.equal(r.d.getStatus().blocked, 'cuefield-running');
  assert.equal(r.d.getFadeInMs(), null);
});

// ── 3. 临时声像 ─────────────────────────────────────────────────────────

test('T13 立体声交接：扫左 -> 从右进 -> 收回用户 balance', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), withTuning: true, gaplessOn: true });
  r.d.onEndFadeStart();
  assert.deepEqual(r.panCalls.slice(), [['set', -0.85, 2200]]);
  assert.equal(r.d.getStatus().handoffPending, true);
  r.d.onTrackStart();
  assert.deepEqual(r.panCalls.slice(), [
    ['set', -0.85, 2200], ['set', 0.85, 0], ['clear', 900]
  ]);
  assert.equal(r.d.getStatus().handoffPending, false);
  assert.equal(r.d.getStatus().panOverridden, false);
});

test('T14 非立体声模式交接不产生任何声像扫动', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), withTuning: true, gaplessOn: true });
  r.d.onEndFadeStart();
  r.d.onTrackStart();
  assert.deepEqual(r.panCalls.slice(), []);
});

test('T15 handoffPending 把真交接与 seek / 暂停恢复区分开', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), withTuning: true, gaplessOn: true });
  r.d.onTrackStart();   // 没有曲末淡出先发生
  assert.deepEqual(r.panCalls.slice(), [], 'restorePlaybackGain 不该把声像甩到右边');
  r.d.onEndFadeStart();
  r.d.onTrackStart();
  assert.equal(r.panCalls.length, 3);
});

test('T16 从立体声切走 / 关闭编排器，都把偏声收回', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), withTuning: true, gaplessOn: true });
  r.d.onEndFadeStart();
  assert.equal(r.d.getStatus().panOverridden, true);
  r.d.setMode('seamless');
  assert.deepEqual(r.panCalls.slice(), [['set', -0.85, 2200], ['clear', 240]]);
  assert.equal(r.d.getStatus().panOverridden, false);
  assert.equal(r.d.getStatus().handoffPending, false);
});

test('T17 没有 01 的 panner 时声像 API 优雅降级，不抛错', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), gaplessOn: true });
  assert.equal(r.d.onEndFadeStart(), false);
  assert.equal(r.d.getStatus().panOverridden, false);
  assert.doesNotThrow(() => r.d.onTrackStart());
});

// ── 4. 试听 ─────────────────────────────────────────────────────────────

test('T18 previewPlan 四种模式：真实切歌一律零重叠', () => {
  const r = makeRig();
  ['mix', 'gradual', 'seamless', 'stereo'].forEach((id) => {
    const p = r.d.previewPlan(id);
    assert.equal(p.mode, id);
    assert.equal(p.audibleNextDeck, false, id + ' 真实切歌不得有可闻第二音源');
    assert.ok(p.durationSec > 0);
  });
  const seamless = r.d.previewPlan('seamless');
  assert.equal(seamless.fadeOutSec, 0);
  assert.equal(seamless.fadeInSec, 0);
  assert.equal(seamless.overlapSec, 0);
  assert.ok(r.d.previewPlan('mix').overlapSec > 0, '混音试听应有短重叠演示');
  assert.ok(r.d.previewPlan('stereo').panOut < 0 && r.d.previewPlan('stereo').panIn > 0);
});

test('T19 preview 用独立 AudioContext，绝不碰主链 / 绝不 setTargetAtTime', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), withAudio: true, gaplessOn: true });
  const result = r.d.preview('stereo');
  assert.equal(result.ok, true);
  assert.equal(result.usedMainAudio, false);
  assert.equal(result.usedGainNode, false);
  assert.equal(r.d.getStatus().previewCount, 1);
  assert.equal(r.paramLog.filter((x) => x[1] === 'setTargetAtTime').length, 0);
  assert.ok(r.paramLog.some((x) => x[1] === 'setValueCurveAtTime'), '应使用显式曲线排程');
  assert.ok(r.paramLog.some((x) => x[1] === 'linearRampToValueAtTime'), '立体声应有声像 ramp');
  assert.ok(r.audio.nodes.filter((n) => n.started != null).length === 2, '两段合成音都要启动');
});

test('T20 试听不修改主 audio.volume / 不调用 08 的 ramp', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), withAudio: true, gaplessOn: true });
  r.sandbox.audio = { volume: 0.77 };
  r.sandbox.rampAudioOutputGain = () => { throw new Error('试听不许写主链增益'); };
  assert.doesNotThrow(() => r.d.preview('mix'));
  assert.equal(r.sandbox.audio.volume, 0.77);
});

test('T21 连续试听会先拆掉上一次 ctx，stopPreview 幂等', () => {
  const r = makeRig({ withAudio: true });
  r.d.preview('mix');
  r.d.preview('gradual');
  assert.equal(r.d.getStatus().previewCount, 2);
  r.d.stopPreview();
  assert.equal(r.audio.ctx.closed, true);
  assert.equal(r.d.stopPreview(), false);
});

test('T22 无 AudioContext 时优雅降级', () => {
  const r = makeRig();
  const result = r.d.preview('mix');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-webaudio');
});

// ── 5. 08 的真实源码钩子 ────────────────────────────────────────────────

test('T23 编排器缺席时 08 三个 getter 与改造前完全一致', () => {
  const g = makeGraphRig(null);
  assert.equal(g.sandbox.transitionFadeInMs(), 460);
  assert.equal(g.sandbox.transitionFadeOutMs(), 420);
  assert.ok(Math.abs(g.sandbox.trackEndFadeLookaheadSec() - 1.8) < 1e-9);
  assert.equal(g.sandbox.transitionSkipTrackEndFade(), false);
});

test('T24 编排器关闭时 08 也不受影响', () => {
  const r = makeRig();
  const g = makeGraphRig(r.d);
  assert.equal(g.sandbox.transitionFadeInMs(), 460);
  assert.equal(g.sandbox.transitionFadeOutMs(), 420);
});

test('T25 无缝模式：08 跳过曲末淡出，新曲零淡入', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'seamless' }), gaplessOn: true });
  const g = makeGraphRig(r.d);
  assert.equal(g.sandbox.transitionFadeInMs(), 0);
  assert.equal(g.sandbox.transitionSkipTrackEndFade(), true);
  assert.equal(g.sandbox.scheduleTrackEndFade(g.media), false);
  assert.equal(g.timers.length, 0);
  g.sandbox.startPlaybackFadeIn();
  assert.deepEqual(g.rampCalls.slice(), [[1, 0]]);
});

test('T26 混音模式：08 按 2400ms 排程且放大窗口，执行时走 rampAudioOutputGain', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), gaplessOn: true });
  const g = makeGraphRig(r.d, { duration: 100, currentTime: 95 });  // wallRemain = 5s
  assert.equal(g.sandbox.transitionFadeOutMs(), 2400);
  assert.ok(Math.abs(g.sandbox.trackEndFadeLookaheadSec() - 4.2) < 1e-9);
  assert.equal(g.sandbox.scheduleTrackEndFade(g.media), true);
  assert.equal(g.timers.length, 1);
  assert.equal(g.timers[0].ms, 2600);   // (5 - 2.4) * 1000
  g.timers[0].fn();
  assert.deepEqual(g.rampCalls.slice(), [[0, 2400]]);
  assert.ok(g.notifyCalls.includes('onEndFadeStart'));
});

test('T27 默认 1.8s 窗口若不放大，会把 2.4s 的长淡出整段挡掉', () => {
  // 反证：把编排器的 extraLookahead 摘掉，同一个 media 就排不上
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), gaplessOn: true });
  const partial = Object.assign({}, r.d, { getExtraLookaheadSec: () => 0 });
  const g = makeGraphRig(partial, { duration: 100, currentTime: 95 });
  assert.ok(Math.abs(g.sandbox.trackEndFadeLookaheadSec() - 1.8) < 1e-9);
  assert.equal(g.sandbox.scheduleTrackEndFade(g.media), false);
});

test('T28 立体声模式：startPlaybackFadeIn 走 900ms 并通知编排器', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), gaplessOn: true });
  const g = makeGraphRig(r.d);
  g.sandbox.startPlaybackFadeIn();
  assert.deepEqual(g.rampCalls.slice(), [[1, 900]]);
  assert.ok(g.notifyCalls.includes('onTrackStart'));
});

// ── 6. 01 的真实源码：临时声像不改 balance 存档 ─────────────────────────

test('T29 01 的 setTransitionPan / clearTransitionPan 只写节点，不动 settings.balance', () => {
  const log = [];
  const pan = makeParam('pan', log);
  const sandbox = {
    console, Math, Number, Object, isFinite,
    clamp(v, min, max) { v = Number(v); return isFinite(v) ? Math.max(min, Math.min(max, v)) : 0; },
    settings: { balance: 0.35 },
    chain: { ctx: { currentTime: 2 }, panner: { pan } }
  };
  vm.createContext(sandbox);
  ['clamp', 'setParam', 'setTransitionPan', 'clearTransitionPan'].forEach((n) => {
    vm.runInContext(extractFunction(tuningSource, n), sandbox, { filename: '01#' + n });
  });
  assert.equal(sandbox.setTransitionPan(-0.85, 2200), true);
  assert.ok(log.some((x) => x[1] === 'linearRampToValueAtTime' && x[2] === -0.85));
  assert.equal(sandbox.clearTransitionPan(240), true);
  assert.ok(log.some((x) => x[1] === 'linearRampToValueAtTime' && x[2] === 0.35), '必须收回用户设定值');
  assert.equal(sandbox.settings.balance, 0.35);
  assert.equal(log.filter((x) => x[1] === 'setTargetAtTime').length, 0);
});

test('T30 01 无 panner 时返回 false', () => {
  const sandbox = { console, Math, Number, Object, isFinite, settings: { balance: 0 }, chain: null };
  vm.createContext(sandbox);
  ['clamp', 'setParam', 'setTransitionPan', 'clearTransitionPan'].forEach((n) => {
    vm.runInContext(extractFunction(tuningSource, n), sandbox, { filename: '01#' + n });
  });
  assert.equal(sandbox.setTransitionPan(0.5, 0), false);
  assert.equal(sandbox.clearTransitionPan(0), false);
});

// ── 7. 接线与硬约束 ─────────────────────────────────────────────────────

test('T31 index-loader 挂载 18，且排在 16 之后', () => {
  assert.ok(loaderSource.includes("'js/modules/05-playback/18-track-transition.js'"));
  assert.ok(loaderSource.indexOf("'js/modules/05-playback/16-gapless-handoff.js'")
    < loaderSource.indexOf("'js/modules/05-playback/18-track-transition.js'"));
});

test('T32 快捷菜单有总开关、试听、四张卡片与状态位', () => {
  ['track-transition-fold', 'track-transition-toggle', 'track-transition-preview',
    'track-transition-desc', 'track-transition-status',
    'track-transition-card-mix', 'track-transition-card-gradual',
    'track-transition-card-seamless', 'track-transition-card-stereo'
  ].forEach((id) => assert.ok(htmlSource.includes('id="' + id + '"'), '缺少 ' + id));
  assert.ok(cssSource.includes('.tt-card.active'));
  assert.ok(cssSource.includes('.tt-scene-art.active'), '四套光效要有显隐规则');
  assert.ok(!cssSource.includes('.tt-banner-glow'), '被裁切的椭圆弧必须删掉');
  assert.ok(!htmlSource.includes('tt-banner-glow'));
});

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('T33 硬约束：不改 Cuefield 源码、不碰 gainNode、绝不 setTargetAtTime', () => {
  const code = stripComments(directorSource);   // 只检查真实代码，注释里的说明不算
  assert.ok(!code.includes('setTargetAtTime'));
  assert.ok(!code.includes('gainNode'));
  assert.ok(!cuefieldSource.includes('trackTransition'), '05-cuefield 源码一行都不许改');
  // 只允许「收编旧存档」用到它自己的公开开关：一次 typeof 检查 + 一次调用，
  // 不许碰混音 / 淡变 / 节拍图等任何内部实现。
  assert.equal((code.match(/toggleCuefieldAutoMix/g) || []).length, 2);
  assert.ok(!code.includes('cuefieldMediaFade') && !code.includes('tickCuefieldAutoMix')
    && !code.includes('cuefieldAutoMixPrepare'));
  // 曲末淡出仍需通过 08 的既有 ramp 入口，08 里只新增 getter，不新增第二条写增益路径
  assert.ok(graphSource.includes("rampAudioOutputGain(0, fadeOutMs, { transition: true })"));
});

test('T34 顶层重复按钮已删，Cuefield 入口收编到面板内仍可用', () => {
  assert.ok(!htmlSource.includes('id="quick-menu-gapless-toggle"'));
  assert.ok(!htmlSource.includes('id="quick-menu-gapless-status"'));
  assert.ok(htmlSource.includes('id="track-transition-status"'), '状态文案必须由面板接管');
  const foldIdx = htmlSource.indexOf('id="track-transition-fold"');
  const automixIdx = htmlSource.indexOf('id="quick-menu-automix-toggle"');
  assert.ok(foldIdx > 0 && automixIdx > foldIdx, 'Cuefield 入口在面板内而非顶层');
  assert.ok(htmlSource.includes('onclick="toggleCuefieldAutoMix()"'), '入口必须真能开关');
  assert.ok(htmlSource.includes('id="quick-menu-automix-status"'), '02 的状态文案要有落点');
  assert.ok(cssSource.includes('cuefield-ready-pulse'), '02 的 ready 态样式要保留');
  assert.ok(cssSource.includes('.tt-legacy-row'), '面板内次级入口要有独立样式');
});

test('T35 旧存档里的幽灵 Cuefield 只在按钮已移除时被收编', () => {
  const r = makeRig({ cuefield: true });
  let calls = 0;
  r.sandbox.toggleCuefieldAutoMix = function () {
    calls++;
    r.sandbox.cuefieldAutoMixEnabled = false;
  };
  assert.equal(r.d._test.retireLegacyCuefieldSwitch(), true);
  assert.equal(calls, 1);
  assert.equal(r.sandbox.cuefieldAutoMixEnabled, false);
  assert.equal(r.d.getStatus().legacyCuefieldRetired, true);
  assert.equal(r.d._test.retireLegacyCuefieldSwitch(), false, '已是关闭态不应重复调用');
  assert.equal(calls, 1);

  // 按钮还在（旧布局 / 探针环境）时绝不越权关掉用户开着的 Cuefield
  const r2 = makeRig({ cuefield: true });
  r2.elements['quick-menu-automix-toggle'] = uiEl('quick-menu-automix-toggle');
  let calls2 = 0;
  r2.sandbox.toggleCuefieldAutoMix = function () {
    calls2++;
    r2.sandbox.cuefieldAutoMixEnabled = false;
  };
  assert.equal(r2.d._test.retireLegacyCuefieldSwitch(), false);
  assert.equal(calls2, 0);
  assert.equal(r2.sandbox.cuefieldAutoMixEnabled, true);
});

test('T36 面板状态行接管旧「无缝衔接」按钮的预载文案', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'seamless' }), gaplessOn: true });
  assert.match(r.d.getStatus().statusText, /无缝过渡/);
  assert.match(r.d.getStatus().statusText, /等待曲末/);
  r.sandbox.__mineradioGaplessHandoff.getStatus = function () {
    return { enabled: true, pending: false, ready: true };
  };
  assert.match(r.d.getStatus().statusText, /下一首已预载/);
  r.sandbox.__mineradioGaplessHandoff.getStatus = function () {
    return { enabled: true, pending: true, ready: false };
  };
  assert.match(r.d.getStatus().statusText, /正在预载下一首/);
});

// ── 8. 每模式可调参数（对齐 Gapless-5 / Tone.js 的参数语义）────────────────

test('T37 四模式默认参数逐毫秒还原改造前配方，老行为零回归', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), gaplessOn: true });
  assert.equal(r.d.getFadeInMs(), 1100);
  assert.equal(r.d.getFadeOutMs(), 2400);
  assert.equal(r.d.getFadeCurve(), 'equal-power');
  r.d.setMode('gradual');
  assert.equal(r.d.getFadeInMs(), null, '渐进仍沿用用户淡入淡出');
  assert.equal(r.d.getFadeOutMs(), null);
  r.d.setMode('seamless');
  assert.equal(r.d.getFadeInMs(), 0);
  assert.equal(r.d.getFadeOutMs(), 0);
  assert.equal(r.d.shouldSkipTrackEndFade(), true);
  r.d.setMode('stereo');
  assert.equal(r.d.getFadeInMs(), 900);
  assert.equal(r.d.getFadeOutMs(), 2200);
  assert.ok(Math.abs(r.d.resolveMode('stereo').panOut + 0.85) < 1e-9);
  assert.ok(Math.abs(r.d.resolveMode('stereo').panIn - 0.85) < 1e-9);
});

test('T38 参数 clamp / step 吸附 / 非法值回落', () => {
  const r = makeRig();
  assert.equal(r.d.setParam('mix', 'durationSec', 999), 8);
  assert.equal(r.d.setParam('mix', 'durationSec', -5), 0.4);
  assert.equal(r.d.setParam('mix', 'durationSec', 'abc'), 2.4);
  assert.equal(r.d.setParam('mix', 'durationSec', 1.27), 1.3, 'step=0.1 吸附');
  assert.equal(r.d.setParam('mix', 'curve', 'nope'), 'equal-power');
  assert.equal(r.d.setParam('mix', 'curve', 'linear'), 'linear');
  assert.equal(r.d.setParam('mix', 'not-a-key', 1), null);
  assert.equal(r.d.setParam('stereo', 'panPct', 250), 100);
  assert.equal(r.d.setParam('seamless', 'headMs', 999), 300);
});

test('T39 混音过渡：过渡时长按比例缩放，曲线形状切换', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'mix' }), gaplessOn: true });
  r.d.setParam('mix', 'durationSec', 4.8);
  assert.equal(r.d.getFadeOutMs(), 4800);
  assert.equal(r.d.getFadeInMs(), 2200);
  assert.ok(Math.abs(r.d.getExtraLookaheadSec() - 6.6) < 1e-9, '长淡出必须同步放大排程窗口');
  r.d.setParam('mix', 'curve', 'linear');
  assert.equal(r.d.getFadeCurve(), 'linear');
  assert.equal(r.d.previewPlan('mix').curve, 'linear', '试听也要听得出曲线变化');
});

test('T40 渐进过渡：0 = 跟随用户设置，非 0 = 覆盖且淡入比例生效', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'gradual' }), gaplessOn: true });
  assert.equal(r.d.getFadeOutMs(), null);
  r.d.setParam('gradual', 'durationSec', 6);
  assert.equal(r.d.getFadeOutMs(), 6000);
  assert.equal(r.d.getFadeInMs(), 4800);
  r.d.setParam('gradual', 'inRatio', 50);
  assert.equal(r.d.getFadeInMs(), 3000);
  r.d.setParam('gradual', 'durationSec', 0);
  assert.equal(r.d.getFadeOutMs(), null, '回到 0 必须交还给用户设置');
  assert.equal(r.d.getFadeInMs(), null);
});

test('T41 无缝过渡：曲尾收尾 / 新曲微淡入都真实作用于 08 的 getter', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'seamless' }), gaplessOn: true });
  r.d.setParam('seamless', 'tailMs', 300);
  assert.equal(r.d.getFadeOutMs(), 300);
  assert.equal(r.d.shouldSkipTrackEndFade(), false, '有收尾时不能跳过曲末淡出');
  assert.ok(Math.abs(r.d.getExtraLookaheadSec() - 2.1) < 1e-9);
  r.d.setParam('seamless', 'headMs', 50);
  assert.equal(r.d.getFadeInMs(), 50);
  assert.equal(r.d.getFadeCurve(), 'linear', '短防爆音用线性更自然');
  r.d.resetParams('seamless');
  assert.equal(r.d.shouldSkipTrackEndFade(), true);
  assert.equal(r.d.getFadeInMs(), 0);
});

test('T42 立体声转场：时长与声像幅度都写进真实声像调用', () => {
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }), gaplessOn: true });
  r.d.setParam('stereo', 'durationSec', 4.4);
  assert.equal(r.d.getFadeOutMs(), 4400);
  assert.equal(r.d.getFadeInMs(), 1800);
  r.d.setParam('stereo', 'panPct', 40);
  assert.ok(Math.abs(r.d.resolveMode('stereo').panOut + 0.4) < 1e-9);

  const r2 = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'stereo' }),
    withTuning: true, gaplessOn: true });
  r2.d.setParam('stereo', 'panPct', 40);
  r2.d.onEndFadeStart();
  assert.deepEqual(r2.panCalls.slice(), [['set', -0.4, 2200]]);
});

test('T43 参数持久化、四模式互不干扰、恢复默认', () => {
  const r = makeRig();
  r.d.setParam('mix', 'durationSec', 5);
  r.d.setParam('stereo', 'panPct', 30);
  r.d.setMode('seamless');
  const saved = JSON.parse(r.store['mineradio-track-transition-v1']);
  assert.equal(saved.params.mix.durationSec, 5);
  assert.equal(saved.params.stereo.panPct, 30);
  assert.equal(saved.params.gradual.durationSec, 0);
  assert.equal(saved.params.seamless.tailMs, 0);

  const r2 = makeRig({ stored: JSON.stringify(Object.assign({}, saved, { enabled: true })), gaplessOn: true });
  r2.d.setMode('mix');
  assert.equal(r2.d.getFadeOutMs(), 5000);
  assert.equal(r2.d.getParams('stereo').panPct, 30, '别的模式参数不能被串改');
  r2.d.resetParams('mix');
  assert.equal(r2.d.getFadeOutMs(), 2400);
  assert.equal(r2.d.getParams('stereo').panPct, 30, '恢复默认只作用于当前模式');
  assert.equal(r2.d.getStatus().lastParamChange.mode, 'mix');
});

test('T44 旧存档 / 脏数据里的参数会被 sanitize', () => {
  const bad = { enabled: true, mode: 'mix', params: {
    mix: { durationSec: 999, curve: 'xxx' }, stereo: { panPct: -50, durationSec: 'NaN' }
  } };
  const r = makeRig({ stored: JSON.stringify(bad), gaplessOn: true });
  assert.equal(r.d.getParams('mix').durationSec, 8);
  assert.equal(r.d.getParams('mix').curve, 'equal-power');
  assert.equal(r.d.getParams('stereo').panPct, 0);
  assert.equal(r.d.getParams('stereo').durationSec, 2.2);
  assert.equal(r.d.getFadeOutMs(), 8000);    // 2400 * 8/2.4
});

test('T45 曲线 getter 默认不干预；开启后按模式给值', () => {
  assert.equal(makeRig().d.getFadeCurve(), null, '关闭时 08 必须完全保持原等功率曲线');
  const r = makeRig({ stored: JSON.stringify({ enabled: true, mode: 'seamless' }), gaplessOn: true });
  assert.equal(r.d.getFadeCurve(), 'linear');
  r.d.setMode('mix');
  assert.equal(r.d.getFadeCurve(), 'equal-power');
});

// ── 9. 视觉：图标 / 光效 / 文案 / 参数行随模式整组切换 ──────────────────

test('T46 syncUi 让光效、参数组、文案与数值一起跟着模式走', () => {
  const r = makeRig({ withUi: true });
  r.d.setMode('mix');
  const e = r.elements;
  assert.equal(e['track-transition-scene'].attrs['data-mode'], 'mix');
  assert.equal(e['track-transition-art-mix'].classList.contains('active'), true);
  assert.equal(e['track-transition-art-seamless'].classList.contains('active'), false);
  assert.equal(e['tt-group-mix'].classList.contains('is-hidden'), false);
  assert.equal(e['tt-group-stereo'].classList.contains('is-hidden'), true);
  assert.match(e['track-transition-desc'].textContent, /长等功率淡变/);
  assert.match(e['track-transition-caption'].textContent, /2\.4s/);

  r.d.setParam('mix', 'durationSec', 4.8);
  assert.equal(e['tt-p-mix-durationSec'].value, '4.8');
  assert.equal(e['tt-p-mix-durationSec-v'].textContent, '4.8s');
  assert.match(e['track-transition-caption'].textContent, /4\.8s/);
  r.d.setParam('mix', 'curve', 'linear');
  assert.equal(e['tt-p-mix-curve-linear'].classList.contains('active'), true);
  assert.equal(e['tt-p-mix-curve-equal-power'].classList.contains('active'), false);
  assert.equal(e['tt-p-mix-curve-linear'].attrs['aria-pressed'], 'true');

  r.d.setMode('stereo');
  assert.equal(e['track-transition-art-stereo'].classList.contains('active'), true);
  assert.equal(e['tt-group-mix'].classList.contains('is-hidden'), true);
  assert.equal(e['tt-group-stereo'].classList.contains('is-hidden'), false);
  assert.match(e['track-transition-desc'].textContent, /左右声道/);
  assert.equal(e['tt-p-stereo-panPct-v'].textContent, '85%');

  r.d.setMode('gradual');
  assert.equal(e['tt-p-gradual-durationSec-v'].textContent, '跟随设置', '0 要显示语义而不是 0s');
  r.d.setParam('gradual', 'durationSec', 3);
  assert.equal(e['tt-p-gradual-durationSec-v'].textContent, '3.0s');
});

test('T47 四张 Canvas 光效 + 四张卡片图标两两不同，旧 SVG / 裁切椭圆已清除', () => {
  ['mix', 'gradual', 'seamless', 'stereo'].forEach((m) => {
    assert.ok(htmlSource.includes('id="track-transition-art-' + m + '"'), '缺光效 ' + m);
    assert.ok(htmlSource.includes('id="tt-group-' + m + '"'), '缺参数组 ' + m);
    assert.ok(htmlSource.includes('data-scene="' + m + '"'), '缺光效场景标记 ' + m);
  });
  // 四张 canvas 分别指向四份不同的来源 HTML / 逐像素算法
  // （选中那张带 active class，所以用正则而非固定字符串匹配）
  const sceneTags = ['mix', 'gradual', 'seamless', 'stereo'].map((m) => {
    const re = new RegExp('<canvas[^>]*id="track-transition-art-' + m + '"[^>]*>');
    const mm = re.exec(htmlSource);
    assert.ok(mm, m + ' 光效必须是 canvas 而不是 SVG');
    assert.ok(mm[0].includes('class="tt-scene-art'), m + ' 缺 tt-scene-art class');
    return mm[0];
  });
  assert.equal(new Set(sceneTags).size, 4);
  ['index.html', 'golden-rings.html', 'golden-divider.html', 'golden-band.html'].forEach((file) => {
    assert.ok(artSource.includes("source: '" + file + "'"), '19 缺来源 ' + file);
    assert.ok(htmlSource.includes(file), '面板注释缺来源 ' + file);
  });
  ['makeHalos', 'makeRings', 'makeBand', 'makeDivider'].forEach((fn) => {
    assert.ok(artSource.includes('function ' + fn + '('), '19 缺算法 ' + fn);
  });
  assert.ok(!htmlSource.includes('tt-scene-base') && !cssSource.includes('.tt-scene-base'),
    '上一版手绘 SVG 底光必须清干净');
  assert.ok(!htmlSource.includes('tt-moire-a') && !htmlSource.includes('tt-halo'));

  // 卡片图标仍是四套独立 SVG
  const icons = ['mix', 'gradual', 'seamless', 'stereo'].map((m) => {
    const re = new RegExp('id="track-transition-card-' + m + '"[^>]*>([\\s\\S]*?)<\\/svg>');
    const mm = re.exec(htmlSource);
    assert.ok(mm, '卡片图标 SVG 不完整：' + m);
    return mm[1].replace(/\s+/g, '');
  });
  assert.equal(new Set(icons).size, 4, '四张卡片图标必须两两不同');
  assert.ok(!htmlSource.includes('tt-banner-glow') && !cssSource.includes('.tt-banner-glow'));
  assert.ok(cssSource.includes('.tt-scene-art.active'));
  assert.ok(cssSource.includes('.tt-param-group.is-hidden'));
  assert.ok(cssSource.includes('.tt-choice button.active'));
  assert.ok(htmlSource.includes('id="track-transition-reset"'), '要有恢复默认入口');
  ['tt-p-mix-durationSec', 'tt-p-gradual-inRatio', 'tt-p-seamless-tailMs', 'tt-p-stereo-panPct']
    .forEach((id) => assert.ok(htmlSource.includes('id="' + id + '"'), '缺参数控件 ' + id));
});

test('T48 08 的曲线接线只在交接淡变生效，暂停淡变不受影响', () => {
  assert.ok(graphSource.includes('curveDirector.getFadeCurve()'));
  assert.ok(graphSource.includes("typeof transitionDirector === 'function'"), '沙箱切片缺席时要安全回退');
  assert.ok(graphSource.includes('buildAudioFadeCurve(from, value, curveKind)'));
  assert.ok(graphSource.includes("rampAudioOutputGain(targetVolume, transitionFadeInMs(), { transition: true })"));
  assert.ok(graphSource.includes("rampAudioOutputGain(0, fadeOutMs, { transition: true })"));
  assert.ok(graphSource.includes('rampAudioOutputGain(0, AUDIO_FADE_OUT_MS);'),
    '暂停淡变绝对不许带 transition 标记');
});

test('T49 试听读实时配方，且真实切歌永远零重叠', () => {
  const r = makeRig({ withAudio: true });
  assert.equal(r.d.previewPlan('mix').curve, 'equal-power');
  r.d.setParam('mix', 'curve', 'linear');
  r.d.setParam('mix', 'durationSec', 6);
  assert.equal(r.d.previewPlan('mix').curve, 'linear');
  assert.ok(r.d.previewPlan('mix').fadeOutSec <= 0.95);
  assert.equal(r.d.preview('mix').plan.curve, 'linear');
  ['mix', 'gradual', 'seamless', 'stereo'].forEach((m) => {
    assert.equal(r.d.previewPlan(m).audibleNextDeck, false, m + ' 真实切歌不得叠音');
  });
  r.d.stopPreview();
});

test('T50 只借鉴开源参数语义，不引入外部依赖、不破坏既有硬约束', () => {
  const code = stripComments(directorSource);
  assert.ok(!code.includes('setTargetAtTime'));
  assert.ok(!code.includes('gainNode'));
  assert.ok(!htmlSource.includes('tone.js') && !htmlSource.includes('Gapless5.js'),
    '不引入 CDN 脚本，只对齐参数语义');
  assert.ok(htmlSource.includes('Gapless-5') && htmlSource.includes('Tone.js'),
    '面板说明要如实标注参考来源');
  assert.ok(!cuefieldSource.includes('trackTransition'), '05-cuefield 源码仍一行未改');
});

// ── 10. 四份 HTML 的 Canvas 光效：真实逐像素渲染 ──────────────────────────

test('T51 index-loader 挂载 19 且排在 18 之后，syncUi 会触发渲染', () => {
  assert.ok(loaderSource.includes("'js/modules/05-playback/19-track-transition-art.js'"));
  assert.ok(loaderSource.indexOf("'js/modules/05-playback/18-track-transition.js'")
    < loaderSource.indexOf("'js/modules/05-playback/19-track-transition-art.js'"));
  assert.ok(directorSource.includes('NS.trackTransitionArt.render(id)'));
  assert.ok(artSource.includes('global.renderTrackTransitionArt = refresh'));
  assert.ok(artSource.includes("fold.addEventListener('toggle'"), '面板展开要重绘');
  assert.ok(!artSource.includes('<iframe') && !artSource.includes('fetch(')
    && !artSource.includes('new Image('), '光效模块不许引入嵌套文档或外部资源');
});

function makeArtRig() {
  const canvases = Object.create(null);
  let renderCount = 0;
  ['mix', 'gradual', 'seamless', 'stereo'].forEach((m) => {
    const cv = {
      id: 'track-transition-art-' + m,
      clientWidth: 306, clientHeight: 104, width: 0, height: 0,
      attrs: Object.create(null), calls: 0, lastImage: null,
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getContext() {
        const self = this;
        return {
          createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
          putImageData(img) { self.calls++; self.lastImage = img; renderCount++; }
        };
      }
    };
    canvases[cv.id] = cv;
  });
  const scene = {
    attrs: { 'data-mode': 'seamless' },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); }
  };
  const fold = { open: true, addEventListener() {} };
  const sandbox = {
    console, Math, Object, Number, Uint8ClampedArray, isFinite,
    devicePixelRatio: 1,
    document: {
      readyState: 'complete',
      getElementById(id) {
        if (canvases[id]) return canvases[id];
        if (id === 'track-transition-scene') return scene;
        if (id === 'track-transition-fold') return fold;
        return null;
      },
      addEventListener() {}
    },
    Mineradio: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(artSource, sandbox, { filename: '19-track-transition-art.js' });
  return {
    sandbox, canvases, scene,
    api: sandbox.Mineradio.trackTransitionArt,
    renderCount() { return renderCount; }
  };
}
function centerSum(cv) {
  assert.ok(cv.lastImage, cv.id + ' 没画出像素');
  const w = cv.lastImage.width, h = cv.lastImage.height;
  const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
  const d = cv.lastImage.data;
  return d[i] + d[i + 1] + d[i + 2];
}
function rowSignature(cv) {
  const d = cv.lastImage.data;
  const w = cv.lastImage.width, h = cv.lastImage.height;
  const row = Math.floor(h / 2) * w * 4;
  let sum = 0;
  for (let x = 4; x < w - 4; x += 9) sum += d[row + x * 4];
  return Math.round(sum);
}

test('T52 四份 HTML 的算法真的画出四张不同画面，且缓存 / 尺寸变化行为正确', () => {
  const r = makeArtRig();
  assert.ok(r.api && r.api.SCENES, '19 必须挂到 Mineradio.trackTransitionArt');
  assert.deepEqual(Object.keys(r.api.SCENES).sort(), ['gradual', 'mix', 'seamless', 'stereo']);
  ['mix', 'gradual', 'seamless', 'stereo'].forEach((m) => {
    assert.deepEqual(Array.from(r.api.SCENES[m].color), Array.from(r.api.VIOLET_WHITE),
      m + ' 必须统一紫白（含 index.html 那张）');
  });
  assert.equal(r.renderCount(), 1, '启动时只渲染当前 active 模式');
  const first = r.canvases['track-transition-art-seamless'];
  assert.equal(first.width, 306);
  assert.equal(first.height, 104);
  assert.ok(centerSum(first) > 60, '中心像素必须真的亮起来');
  assert.equal(first.calls, 1);

  r.api.refresh();
  assert.equal(r.renderCount(), 1, '同尺寸重复 syncUi 必须命中缓存，不重跑逐像素循环');
  r.api.refresh(true);
  assert.equal(r.renderCount(), 2, 'force 才重绘');
  first.clientWidth = 400;
  r.api.refresh();
  assert.equal(r.renderCount(), 3, '面板尺寸变化要自动重绘');
  assert.equal(first.width, 400);

  // 四种模式各自渲染并比较像素签名
  ['mix', 'gradual', 'seamless', 'stereo'].forEach((m) => {
    r.scene.setAttribute('data-mode', m);
    assert.equal(r.api.activeMode(), m);
    assert.equal(r.api.refresh(true), true, m + ' 渲染失败');
  });
  const sigs = ['mix', 'gradual', 'seamless', 'stereo'].map((m) => {
    const cv = r.canvases['track-transition-art-' + m];
    assert.ok(centerSum(cv) > 30, m + ' 画面不该是黑的');
    return rowSignature(cv);
  });
  assert.equal(new Set(sigs).size, 4, '四套光效的真实像素必须两两不同：' + sigs.join(','));
  assert.ok(!Number.isNaN(sigs[0]));
});
