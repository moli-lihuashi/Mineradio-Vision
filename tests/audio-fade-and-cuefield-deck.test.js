'use strict';

/* =============================================================================
 * 淡变基础层 / Cuefield 双 deck 交叉淡入 回归测试
 *
 * 两个真实缺陷：
 *  1) `writeAudioOutputGain` 在 05-cuefield/02-...integration.js 里被调用 5 次，
 *     但全项目从未定义 → A deck（当前曲）在交叉淡入时完全不淡出，只有 B deck
 *     淡入，两首歌满音量叠加、浑浊爆音，结束时旧曲也不归零。
 *  2) `applyVolumeToAudio()` 用 setTargetAtTime 留下一条永不结束的自动化，
 *     与淡变排程叠加后把 gain 拉回 targetVolume → 「暂停/播放没有淡入淡出」。
 *
 * 这里直接把 08-audio-graph-controls.js 的淡变函数切片出来，在 vm 沙箱里
 * 用可控的 AudioParam / 定时器桩验证真实源码行为，不是重写一遍逻辑。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const graphPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '08-audio-graph-controls.js');
const cuefieldPath = path.join(appRoot, 'public', 'js', 'modules', '05-cuefield', '02-cuefield-automix-integration.js');
const seekPath = path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '04-progress-seek.js');
const graphSource = fs.readFileSync(graphPath, 'utf8');
const cuefieldSource = fs.readFileSync(cuefieldPath, 'utf8');
const seekSource = fs.readFileSync(seekPath, 'utf8');

function sliceFadeBlock(text) {
  const start = text.indexOf('function clearAudioFadeTimers()');
  const end = text.indexOf('/** 音量 UI/听感 spring 状态');
  assert.ok(start > 0, '找不到淡变函数块起点');
  assert.ok(end > start, '找不到淡变函数块终点');
  return text.slice(start, end);
}

function sliceApplyVolumeToAudio(text) {
  const start = text.indexOf('function applyVolumeToAudio()');
  const end = text.indexOf('function updateVolumeUiFrom');
  assert.ok(start > 0 && end > start, '找不到 applyVolumeToAudio 边界');
  return text.slice(start, end);
}

const FADE_SOURCE = sliceFadeBlock(graphSource) + '\n' + sliceApplyVolumeToAudio(graphSource);

function makeParam() {
  return {
    value: 0.8,
    calls: [],
    cancelScheduledValues(t) { this.calls.push(['cancelScheduledValues', t]); },
    cancelAndHoldAtTime(t) { this.calls.push(['cancelAndHoldAtTime', t]); },
    setValueAtTime(v, t) { this.calls.push(['setValueAtTime', v, t]); this.value = v; },
    linearRampToValueAtTime(v, t) { this.calls.push(['linearRampToValueAtTime', v, t]); this.value = v; },
    setTargetAtTime(v, t, c) { this.calls.push(['setTargetAtTime', v, t, c]); this.value = v; },
    setValueCurveAtTime(curve, t, dur) {
      this.calls.push(['setValueCurveAtTime', curve, t, dur]);
      this.value = curve[curve.length - 1];
    }
  };
}

function createSandbox(options) {
  const opts = options || {};
  const timers = [];
  const param = makeParam();
  const media = opts.media || { duration: 200, currentTime: 198.8, paused: false, ended: false, volume: 1 };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Number, String, Promise, Float32Array, isFinite,
    clampRange(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
    performance: { now() { return 1000; } },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    setTimeout(fn, delay) { timers.push({ fn, delay, cancelled: false }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    audioFadeTimer: 0,
    audioElementFadeFrame: 0,
    audioFadeSerial: 0,
    AUDIO_FADE_IN_MS: 460,
    AUDIO_FADE_OUT_MS: 420,
    AUDIO_SILENCE_GAIN: 0.0001,
    targetVolume: 0.8,
    audio: media,
    audioCtx: { currentTime: 10, sampleRate: 48000 },
    gainNode: { gain: param },
    cuefieldAutoMixExecuting: !!opts.cuefieldExecuting,
    playbackTransitionHasAudibleNextDeck() { return !!opts.audibleNextDeck; }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(FADE_SOURCE, sandbox);
  return { sandbox, param, timers, media };
}

function fireTimers(timers) {
  // 只跑未取消的、当前快照里的定时器，模拟时间流逝
  timers.filter(t => !t.cancelled).forEach(t => t.fn());
}

// ── 1. writeAudioOutputGain：定义存在且 Cuefield 的 A deck 真能写入 ──────────
test('writeAudioOutputGain 在音频图模块中有定义，且能把增益钉到目标值', () => {
  assert.match(graphSource, /function\s+writeAudioOutputGain\s*\(/, '音频图模块必须定义 writeAudioOutputGain');
  const { sandbox, param } = createSandbox();
  assert.equal(typeof sandbox.writeAudioOutputGain, 'function');
  const written = sandbox.writeAudioOutputGain(0.25);
  assert.equal(written, 0.25);
  assert.ok(Math.abs(param.value - 0.25) < 1e-6, 'A deck 增益应被真正写入');
});

test('Cuefield 交叉淡入的 A deck 调用点全部有全局定义可命中', () => {
  const callCount = (cuefieldSource.match(/writeAudioOutputGain\s*\(/g) || []).length;
  assert.ok(callCount >= 4, `期望至少 4 处 A deck 调用，实际 ${callCount}`);
  // 合并脚本是全局 classic script（index-loader.js 不加 IIFE 包裹），
  // 所以 08 里的函数声明对 head 里的 cuefield 脚本可见。
  assert.match(cuefieldSource, /typeof writeAudioOutputGain === 'function'/);
  assert.match(graphSource, /function\s+writeAudioOutputGain\s*\(/);
});

// ── 2. applyVolumeToAudio：不再留永久自动化 ────────────────────────────────
test('applyVolumeToAudio 一次性写入，不再使用永不结束的 setTargetAtTime', () => {
  const body = sliceApplyVolumeToAudio(graphSource);
  assert.doesNotMatch(body, /\.setTargetAtTime\s*\(/, 'setTargetAtTime 会持续把 gain 拉回 targetVolume，盖掉淡变');
  const { sandbox, param } = createSandbox();
  param.calls.length = 0;
  sandbox.targetVolume = 0.65;
  sandbox.applyVolumeToAudio();
  assert.ok(param.calls.some(c => c[0] === 'setValueAtTime' && Math.abs(c[1] - 0.65) < 1e-6));
  assert.ok(!param.calls.some(c => c[0] === 'setTargetAtTime'));
});

// ── 3. rampAudioOutputGain：显式等功率曲线 ─────────────────────────────────
test('淡入用 setValueCurveAtTime 排整条等功率曲线，端点精确', () => {
  const { sandbox, param } = createSandbox();
  param.value = 0.0001;
  sandbox.rampAudioOutputGain(0.8, 460);
  const curveCall = param.calls.find(c => c[0] === 'setValueCurveAtTime');
  assert.ok(curveCall, '必须使用 setValueCurveAtTime 显式排程');
  const curve = curveCall[1];
  assert.equal(curve.length, 96);
  assert.ok(Math.abs(curve[0] - 0.0001) < 1e-6, '曲线起点必须等于当前增益快照');
  assert.ok(Math.abs(curve[curve.length - 1] - 0.8) < 1e-6, '曲线终点必须等于目标增益');
  assert.ok(Math.abs(curveCall[3] - 0.46) < 1e-6, 'duration 必须是秒');
  const mid = curve[Math.floor(curve.length / 2)];
  const equalPowerMid = 0.0001 + (0.8 - 0.0001) * Math.sin(Math.PI / 4);
  assert.ok(Math.abs(mid - equalPowerMid) < 0.01, '中点应落在等功率曲线上，不是线性斜坡');
});

test('显式指定 linear 时退回线性曲线', () => {
  const { sandbox, param } = createSandbox();
  param.value = 0;
  sandbox.rampAudioOutputGain(1, 400, { curve: 'linear' });
  const curve = param.calls.find(c => c[0] === 'setValueCurveAtTime')[1];
  const mid = curve[Math.floor(curve.length / 2)];
  assert.ok(Math.abs(mid - 0.5) < 0.02, `线性中点应接近 0.5，实际 ${mid}`);
});

test('淡出曲线单调下降到静音地板', () => {
  const { sandbox, param } = createSandbox();
  param.value = 0.8;
  sandbox.rampAudioOutputGain(0, 420);
  const curve = param.calls.find(c => c[0] === 'setValueCurveAtTime')[1];
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i] <= curve[i - 1] + 1e-6, `第 ${i} 点不应回升`);
  }
  assert.ok(Math.abs(curve[curve.length - 1] - 0.0001) < 1e-6);
});

test('打断淡变后，旧曲线的收尾定时器不得把增益改回旧目标', () => {
  const { sandbox, param, timers } = createSandbox();
  param.value = 0.0001;
  sandbox.rampAudioOutputGain(0.8, 460);
  sandbox.setAudioOutputGainImmediate(0.35);
  param.value = 0.35;
  fireTimers(timers);
  assert.ok(Math.abs(param.value - 0.35) < 1e-6, '旧淡入的收尾回调必须已被 token 作废');
});

// ── 4. 曲末提前淡出：窗口 / 取消 / 互斥 ────────────────────────────────────
test('曲末排程落在 duration - fadeOut，不在窗口内不排', () => {
  const { sandbox, timers } = createSandbox({ media: { duration: 200, currentTime: 198.8, paused: false, ended: false } });
  assert.equal(sandbox.scheduleTrackEndFade(sandbox.audio), true);
  assert.ok(Math.abs(timers[0].delay - (1.2 - 0.42) * 1000) < 1e-6, '应在曲末前 fadeOut 秒触发');
});

test('离曲末还远时不排程；暂停/结束的媒体不排程', () => {
  const far = createSandbox({ media: { duration: 200, currentTime: 10, paused: false, ended: false } });
  assert.equal(far.sandbox.scheduleTrackEndFade(far.sandbox.audio), false);
  assert.equal(far.timers.length, 0);
  const paused = createSandbox({ media: { duration: 200, currentTime: 198.8, paused: true, ended: false } });
  assert.equal(paused.sandbox.scheduleTrackEndFade(paused.sandbox.audio), false);
});

test('曲末排程触发时执行淡出；Cuefield 接管时让位', () => {
  const plain = createSandbox();
  plain.sandbox.scheduleTrackEndFade(plain.sandbox.audio);
  plain.param.calls.length = 0;
  fireTimers(plain.timers);
  assert.ok(plain.param.calls.some(c => c[0] === 'setValueCurveAtTime'), '应触发 A deck 淡出');

  const takenOver = createSandbox({ cuefieldExecuting: true });
  takenOver.sandbox.scheduleTrackEndFade(takenOver.sandbox.audio);
  takenOver.param.calls.length = 0;
  fireTimers(takenOver.timers);
  assert.equal(takenOver.param.calls.length, 0, 'Cuefield 正在交叉淡入时不应重复淡出');
});

test('seek / 换源取消旧的曲末排程', () => {
  const { sandbox, timers } = createSandbox();
  sandbox.scheduleTrackEndFade(sandbox.audio);
  sandbox.cancelTrackEndFade();
  const curveCallsBefore = timers.filter(t => !t.cancelled).length;
  assert.equal(curveCallsBefore, 0, '取消后不应还有存活的曲末定时器');
  // 取消后可重新排程
  assert.equal(sandbox.scheduleTrackEndFade(sandbox.audio), true);
});

// ── 5. 挂载：timeupdate 排程、play/seeked/emptied 取消 ─────────────────────
test('进度事件里挂了曲末排程与取消', () => {
  assert.match(seekSource, /scheduleTrackEndFade\(audioEl\)/, 'timeupdate 必须排程曲末淡出');
  assert.match(seekSource, /\['play', 'seeked', 'emptied', 'loadedmetadata', 'durationchange', 'pause'\]/,
    '起播/拖动/换源必须取消旧的曲末排程');
  assert.match(seekSource, /cancelTrackEndFade\(\)/);
});

test('合流：曲末淡出与暂停淡出互斥（暂停时先取消曲末排程）', () => {
  const { sandbox, timers } = createSandbox();
  assert.equal(sandbox.scheduleTrackEndFade(sandbox.audio), true);
  const endFadeTimer = timers[0];           // 曲末排程是第一个定时器
  assert.ok(endFadeTimer.delay > 600, '曲末排程应明显晚于淡变自身收尾');
  sandbox.fadeOutAndPauseAudio();
  assert.equal(endFadeTimer.cancelled, true, '暂停淡出必须作废旧曲末排程');
  // 暂停自己的淡出曲线与 pause 定时器仍在
  assert.ok(timers.some(t => !t.cancelled && t.delay === 500), '暂停定时器应保留');
});
