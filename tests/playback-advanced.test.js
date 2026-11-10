'use strict';

/* =============================================================================
 * 播放高级设置 + 桌面歌词悬停控制条回归测试
 *
 * 四项：变速不变调、输出设备切换、曲末淡出与预载时长可调、桌面歌词控制条。
 * 17-playback-advanced.js 整份真实源码进 vm 沙箱；08 / 16 的两个关键函数
 * 用括号配对从真实源码原样切片执行，专测「媒体秒 → 墙钟秒」换算的正确性。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8').replace(/\r\n/g, '\n');

const tuningSource = read('public/js/modules/05-playback/17-playback-advanced.js');
const graphSource = read('public/js/modules/05-playback/08-audio-graph-controls.js');
const gaplessSource = read('public/js/modules/05-playback/16-gapless-handoff.js');
const loaderSource = read('public/js/index-loader.js');
const htmlSource = read('public/index.html');
const cssSource = read('public/css/10-shell/shell.css');
const lyricsPageSource = read('public/desktop-lyrics.html');
const overlayPreloadSource = read('desktop/overlay-preload.js');
const mainSource = read('desktop/main.js');

/* 从真实源码按大括号配对原样切出一个函数，不重写实现 */
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

function makeMedia(overrides) {
  const m = Object.assign({
    playbackRate: 1, defaultPlaybackRate: 1, preservesPitch: true,
    volume: 1, paused: false, _listeners: Object.create(null),
    sinkCalls: [],
    addEventListener(n, fn) { (m._listeners[n] = m._listeners[n] || []).push(fn); },
    removeEventListener(n, fn) {
      const arr = m._listeners[n] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(n) { (m._listeners[n] || []).slice().forEach((fn) => fn({ type: n })); },
    setSinkId(id) { m.sinkCalls.push(id); return Promise.resolve(); },
  }, overrides || {});
  return m;
}

function uiEl(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false,
    attrs: Object.create(null), _listeners: Object.create(null),
    classList: {
      _on: Object.create(null),
      toggle(k, on) { this._on[k] = !!on; },
      contains(k) { return !!this._on[k]; },
    },
    getAttribute(k) { return this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); },
    querySelectorAll() { return presetButtons; },
    contains() { return true; },
    fire(n, e) { (this._listeners[n] || []).slice().forEach((fn) => fn(e)); },
  };
}

const presetButtons = ['0.75', '1', '1.25', '1.5'].map((v) => ({
  attrs: { 'data-rate': v },
  classList: { toggle(k, on) { this['_' + k] = !!on; } },
  getAttribute(k) { return this.attrs[k]; },
}));

function createSandbox(overrides) {
  const o = overrides || {};
  const store = Object.assign({}, o.storage || {});
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
  };
  const elements = Object.create(null);
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) {
      if (!elements[id]) elements[id] = uiEl(id);
      return elements[id];
    },
  };
  const deviceList = o.devices == null
    ? [{ kind: 'audiooutput', deviceId: 'default', label: '扬声器', groupId: 'g1' },
       { kind: 'audiooutput', deviceId: 'spk2', label: '耳机', groupId: 'g2' },
       { kind: 'audioinput', deviceId: 'mic', label: '麦克风', groupId: 'g3' }]
    : o.devices;
  const mediaDevices = {
    enumerateDevices() { return Promise.resolve(deviceList.slice()); },
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); },
    _listeners: Object.create(null),
  };
  if (o.selectAudioOutput !== false) {
    mediaDevices.selectAudioOutput = () => Promise.resolve({ deviceId: 'spk2' });
  }
  const audio = o.audio || makeMedia();
  if (o.noSink) delete audio.setSinkId;
  const sandbox = {
    localStorage, document, audio,
    navigator: o.noMediaDevices ? {} : { mediaDevices },
    cuefieldAutoMixExecuting: false,
    setTimeout: (fn, ms) => { sandbox._timers.push({ fn, ms }); return sandbox._timers.length; },
    clearTimeout: () => {},
    _timers: [],
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(tuningSource, sandbox, { filename: '17-playback-advanced.js' });
  return { sandbox, api: sandbox.Mineradio.playbackAdvanced, audio, store, elements, mediaDevices, deviceList };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// =============================================================================
// A. 变速不变调
// =============================================================================

test('A1 默认 1.0x + 保持音调，不改变既有播放行为', () => {
  const s = createSandbox();
  assert.equal(s.api.getRate(), 1);
  assert.equal(s.api.getSettings().preservePitch, true);
  assert.equal(s.audio.playbackRate, 1);
  assert.equal(s.audio.defaultPlaybackRate, 1);
  assert.equal(s.audio.preservesPitch, true);
  assert.equal(s.api.getSettings().lookaheadSec, 1.8);
  assert.equal(s.api.getSettings().gaplessLeadSec, 18);
  assert.equal(s.api.getSettings().outputDeviceId, '');
});

test('A2 变速同时写 playbackRate 与 defaultPlaybackRate（换源 load 后不被清零）', () => {
  const s = createSandbox();
  s.api.setRate(1.5);
  assert.equal(s.audio.playbackRate, 1.5);
  assert.equal(s.audio.defaultPlaybackRate, 1.5);
  assert.equal(s.api.getRate(), 1.5);
  // 模拟 load() 把速率恢复成 defaultPlaybackRate，再由 loadedmetadata 重挂
  s.audio.playbackRate = s.audio.defaultPlaybackRate;
  s.audio.fire('loadedmetadata');
  assert.equal(s.audio.playbackRate, 1.5);
});

test('A3 preservesPitch 关掉后随速变调，moz/webkit 前缀兜底也写入', () => {
  const s = createSandbox();
  s.api.togglePreservePitch();
  assert.equal(s.audio.preservesPitch, false);
  assert.equal(s.audio.mozPreservesPitch, false);
  assert.equal(s.audio.webkitPreservesPitch, false);
  s.api.setRate(0.75);
  s.api.togglePreservePitch();
  assert.equal(s.audio.playbackRate, 0.75);
  assert.equal(s.audio.preservesPitch, true);
});

test('A4 速率 clamp 到 0.5–2.0，非法值回落 1', () => {
  const s = createSandbox();
  assert.equal(s.api.setRate(9), 2);
  assert.equal(s.api.setRate(-3), 0.5);
  assert.equal(s.api.setRate('nonsense'), 1);
  assert.equal(s.api.setRate(1.234), 1.23);
});

test('A5 存档回读：刷新后速率/音调/两个时长都还原', () => {
  const s = createSandbox();
  s.api.setRate(1.25);
  s.api.togglePreservePitch();
  s.api.setLookaheadSec(3.5);
  s.api.setGaplessLeadSec(42);
  const saved = s.store['mineradio-playback-advanced-v1'];
  const s2 = createSandbox({ storage: { 'mineradio-playback-advanced-v1': saved } });
  assert.equal(s2.api.getRate(), 1.25);
  assert.equal(s2.audio.playbackRate, 1.25);
  assert.equal(s2.api.getSettings().preservePitch, false);
  assert.equal(s2.api.getLookaheadSec(), 3.5);
  assert.equal(s2.api.getGaplessLeadSec(), 42);
});

test('A6 存档里的越界值在回读时被夹回合法区间', () => {
  const raw = JSON.stringify({ rate: 99, lookaheadSec: -5, gaplessLeadSec: 999, preservePitch: false });
  const s = createSandbox({ storage: { 'mineradio-playback-advanced-v1': raw } });
  assert.equal(s.api.getRate(), 2);
  assert.equal(s.api.getLookaheadSec(), 0.5);
  assert.equal(s.api.getGaplessLeadSec(), 60);
  assert.equal(s.api.getSettings().preservePitch, false);
});

test('A7 ratechange 被别的逻辑改掉时自动纠正，AutoMix 执行期间让路', () => {
  const s = createSandbox();
  s.api.setRate(1.4);
  s.audio.playbackRate = 0.98;
  s.audio.fire('ratechange');
  assert.equal(s.audio.playbackRate, 1.4, '普通场景要纠正');
  s.sandbox.cuefieldAutoMixExecuting = true;
  s.audio.playbackRate = 0.98;
  s.audio.fire('ratechange');
  assert.equal(s.audio.playbackRate, 0.98, 'AutoMix beatmatch 期间不抢写');
  s.sandbox.cuefieldAutoMixExecuting = false;
});

test('A8 bindMedia 换元素时解绑旧监听，不泄漏', () => {
  const s = createSandbox();
  const oldAudio = s.audio;
  const nextAudio = makeMedia();
  s.api.bindMedia(nextAudio);
  assert.equal(nextAudio.playbackRate, 1);
  assert.equal(oldAudio._listeners.loadedmetadata.length, 0);
  assert.equal(nextAudio._listeners.loadedmetadata.length, 1);
  s.api.setRate(1.5);
  assert.equal(nextAudio.playbackRate, 1.5);
});

test('A9 wallSeconds 把媒体秒换算成墙钟秒', () => {
  const s = createSandbox();
  s.api.setRate(2);
  assert.equal(s.api.wallSeconds(10), 5);
  s.api.setRate(0.5);
  assert.equal(s.api.wallSeconds(10), 20);
});

// =============================================================================
// B. 输出设备切换
// =============================================================================

test('B1 枚举只保留 audiooutput，并补「跟随系统默认」', async () => {
  const s = createSandbox();
  await flush();
  const list = s.api._test.devices();
  assert.equal(list.length, 3);
  assert.equal(list[0].deviceId, '');
  assert.equal(list[0].label, '跟随系统默认');
  assert.ok(list.every((d) => d.deviceId !== 'mic'));
  assert.equal(s.api.getStatus().devices, 3);
});

test('B2 切换设备调 setSinkId 并落盘 deviceId', async () => {
  const s = createSandbox();
  await flush();
  const ok = await s.api.applyOutputDevice('spk2');
  assert.equal(ok, true);
  assert.deepEqual(Array.from(s.audio.sinkCalls), ['spk2']);
  assert.equal(s.api.getSettings().outputDeviceId, 'spk2');
  assert.equal(s.api.getSettings().outputDeviceLabel, '耳机');
});

test('B3 「跟随系统」传空 id，selectAudioOutput 流程也能落地', async () => {
  const s = createSandbox();
  await flush();
  await s.api.applyOutputDevice('spk2');
  await s.sandbox.followSystemOutputDevice();
  assert.equal(s.audio.sinkCalls[s.audio.sinkCalls.length - 1], '');
  assert.equal(s.api.getSettings().outputDeviceId, '');
  assert.equal(s.api.getSettings().outputDeviceLabel, '跟随系统默认');
  await s.sandbox.pickPlaybackOutputDevice();
  assert.equal(s.api.getSettings().outputDeviceId, 'spk2');
});

test('B4 设备被拔掉后回落默认（刷新时或 devicechange 时）', async () => {
  const s = createSandbox();
  await flush();
  await s.api.applyOutputDevice('spk2');
  s.deviceList.splice(1, 1); // 拔掉耳机
  await s.api.refreshDevices();
  assert.equal(s.api.getSettings().outputDeviceId, '');
});

test('B5 setSinkId 不可用时明确降级，不抛异常', async () => {
  const s = createSandbox({ noSink: true });
  await flush();
  const ok = await s.api.applyOutputDevice('spk2');
  assert.equal(ok, false);
  assert.equal(s.api.getStatus().sinkSupported, false);
  assert.ok(s.api.getStatus().deviceStatus.includes('不支持'));
  assert.equal(s.elements['playback-output-device'].disabled, true);
});

test('B6 没有 mediaDevices 时也不炸，给出明确状态', async () => {
  const s = createSandbox({ noMediaDevices: true });
  await flush();
  assert.equal(s.api.getStatus().unsupportedSink, true);
  assert.ok(s.api.getStatus().deviceStatus.includes('不提供'));
});

test('B7 setSinkId reject 时状态可读、不覆盖存档', async () => {
  const s = createSandbox();
  s.audio.setSinkId = () => Promise.reject(new Error('NotAllowedError'));
  await flush();
  const ok = await s.api.applyOutputDevice('spk2');
  assert.equal(ok, false);
  assert.equal(s.api.getSettings().outputDeviceId, '');
  assert.ok(s.api.getStatus().deviceStatus.includes('切换失败'));
});

// =============================================================================
// C. 时长可调 + 墙钟换算（真实源码切片）
// =============================================================================

test('C1 两个时长 clamp 到各自区间', () => {
  const s = createSandbox();
  assert.equal(s.api.setLookaheadSec(99), 6);
  assert.equal(s.api.setLookaheadSec(-1), 0.5);
  assert.equal(s.api.setGaplessLeadSec(999), 60);
  assert.equal(s.api.setGaplessLeadSec(1), 5);
});

function fadeSandbox(rate, lookaheadSec, media) {
  const sandbox = {
    // 18 歌曲过渡编排器缺席时，新增钩子必须整体回落到改造前的默认行为
    Mineradio: { trackTransition: null, playbackAdvanced: {
      getRate: () => rate,
      getLookaheadSec: () => lookaheadSec,
    } },
    AUDIO_FADE_OUT_MS: 420,
    TRACK_END_FADE_LOOKAHEAD_SEC: 1.8,
    trackEndFadeToken: 0, trackEndFadeTimer: 0, trackEndFadeScheduled: false,
    audio: media,
    cuefieldAutoMixExecuting: false,
    playbackTransitionHasAudibleNextDeck: () => false,
    rampAudioOutputGain: () => {},
    delays: [],
    setTimeout(fn, ms) { sandbox.delays.push(ms); return 1; },
    clearTimeout() {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(graphSource, 'playbackWallRate'),
    // 08 的曲末淡出现在会读 18 的可选钩子，一并切真实源码进沙箱，
    // 这样 C2~C6 验证的仍是真实现而不是手写的替身。
    extractFunction(graphSource, 'transitionDirector'),
    extractFunction(graphSource, 'transitionFadeOutMs'),
    extractFunction(graphSource, 'transitionSkipTrackEndFade'),
    extractFunction(graphSource, 'transitionNotify'),
    extractFunction(graphSource, 'trackEndFadeLookaheadSec'),
    extractFunction(graphSource, 'trackEndFadeTakenOver'),
    extractFunction(graphSource, 'cancelTrackEndFade'),
    extractFunction(graphSource, 'scheduleTrackEndFade'),
  ].join('\n\n'), sandbox, { filename: '08-fade.slice.js' });
  return sandbox;
}

function near(actual, expected, eps) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) < (eps || 0.01),
    '期望约 ' + expected + '，实际 ' + actual);
}

test('C2 曲末淡出按墙钟换算：1.0x 距曲末 1s → 580ms 后启动', () => {
  const media = makeMedia({ duration: 200, currentTime: 199 });
  const s = fadeSandbox(1, 1.8, media);
  assert.equal(s.scheduleTrackEndFade(media), true);
  near(s.delays[0], 580);
});

test('C3 2.0x 时同样的媒体剩余秒只等 80ms，不会迟到', () => {
  const media = makeMedia({ duration: 200, currentTime: 199 });
  const s = fadeSandbox(2, 1.8, media);
  assert.equal(s.scheduleTrackEndFade(media), true);
  near(s.delays[0], 80);
});

test('C4 0.5x 时 4 媒体秒 = 8 墙钟秒，超出排程窗口不提前排', () => {
  const media = makeMedia({ duration: 200, currentTime: 196 });
  const s = fadeSandbox(0.5, 1.8, media);
  assert.equal(s.scheduleTrackEndFade(media), false);
  assert.equal(s.delays.length, 0);
});

test('C5 可调 lookahead 生效：窗口放大到 6s 后 5 媒体秒也能排程', () => {
  const media = makeMedia({ duration: 200, currentTime: 195 });
  assert.equal(fadeSandbox(1, 1.8, media).scheduleTrackEndFade(media), false);
  const s = fadeSandbox(1, 6, media);
  assert.equal(s.scheduleTrackEndFade(media), true);
  near(s.delays[0], 4580);
});

test('C6 没有调音模块时回落原常量，行为不变', () => {
  const media = makeMedia({ duration: 200, currentTime: 199 });
  const s = fadeSandbox(1, 1.8, media);
  s.Mineradio = {};
  assert.equal(s.scheduleTrackEndFade(media), true);
  near(s.delays[0], 580);
});

function gaplessSandbox(rate, leadSec, media) {
  const sandbox = {
    Mineradio: { playbackAdvanced: {
      getRate: () => rate,
      getGaplessLeadSec: () => leadSec,
    } },
    GAPLESS_HANDOFF_LEAD_SEC: 18,
    GAPLESS_HANDOFF_MIN_REMAIN_SEC: 2.5,
    gaplessHandoffEnabled: true,
    gaplessHandoffState: { pending: false, ready: false, blockedKey: '' },
    playQueue: [{ id: 'B' }],
    queueItemKey: () => 'B',
    gaplessHandoffStarts: [],
    gaplessHandoffBlockedReason: () => '',
    gaplessHandoffNextIndex: () => 0,
    gaplessHandoffStart(idx) { sandbox.gaplessHandoffStarts.push(idx); },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(gaplessSource, 'gaplessHandoffWallRate'),
    extractFunction(gaplessSource, 'gaplessHandoffLeadSec'),
    extractFunction(gaplessSource, 'gaplessHandoffMaybePrefetch'),
  ].join('\n\n'), sandbox, { filename: '16-gapless.slice.js' });
  return { sandbox, media };
}

test('C7 2.0x 时 24 媒体秒 = 12 墙钟秒，仍在 18s 预载窗口内', () => {
  const media = makeMedia({ duration: 200, currentTime: 176 });
  const { sandbox } = gaplessSandbox(2, 18, media);
  assert.equal(sandbox.gaplessHandoffMaybePrefetch(media), true);
  assert.equal(sandbox.gaplessHandoffStarts.length, 1);
});

test('C8 1.0x 时 24 媒体秒超出 18s 窗口，不预取', () => {
  const media = makeMedia({ duration: 200, currentTime: 176 });
  const { sandbox } = gaplessSandbox(1, 18, media);
  assert.equal(sandbox.gaplessHandoffMaybePrefetch(media), false);
});

test('C9 可调预载窗口生效：40s 时 30 媒体秒就提前预取', () => {
  const media = makeMedia({ duration: 200, currentTime: 170 });
  assert.equal(gaplessSandbox(1, 18, media).sandbox.gaplessHandoffMaybePrefetch(media), false);
  const { sandbox } = gaplessSandbox(1, 40, media);
  assert.equal(sandbox.gaplessHandoffMaybePrefetch(media), true);
});

test('C10 太贴近 ended 仍不发起新请求（2.5 墙钟秒下限）', () => {
  const media = makeMedia({ duration: 200, currentTime: 199 });
  const { sandbox } = gaplessSandbox(2, 18, media);
  assert.equal(sandbox.gaplessHandoffMaybePrefetch(media), false);
});

// =============================================================================
// D. 桌面歌词悬停播放控制条
// =============================================================================

test('D1 页面有三个控制按钮与 hint-visible 门控样式', () => {
  for (const id of ['desktopLyricsPrevBtn', 'desktopLyricsPlayBtn', 'desktopLyricsNextBtn', 'lyricsControls']) {
    assert.ok(lyricsPageSource.includes('id="' + id + '"'), '缺少 ' + id);
  }
  for (const action of ['prevTrack', 'togglePlay', 'nextTrack']) {
    assert.ok(lyricsPageSource.includes('data-playback-action="' + action + '"'));
  }
  assert.ok(lyricsPageSource.includes('body.unlocked .stage.hint-visible .lyrics-controls'));
  assert.ok(lyricsPageSource.includes('body:not(.paused) .lyrics-control-btn .icon-pause'));
  assert.ok(lyricsPageSource.includes('icon-play'), '播放/暂停图标要随 state.playing 切换');
});

test('D2 控制按钮不触发拖拽，热区把 lockHint 并进来', () => {
  assert.ok(lyricsPageSource.includes('function isControlTarget(target)'));
  assert.ok(lyricsPageSource.includes('if (isControlTarget(evt.target)) return;'));
  assert.ok(lyricsPageSource.includes('lyricsControls.contains(target)'));
  const bound = extractFunction(lyricsPageSource, 'sendHotBounds');
  assert.ok(bound.includes('lockHint.getBoundingClientRect()'), '热区必须包含控制条所在胶囊');
  assert.ok(bound.includes('Math.min(left, hintRect.left)'));
  assert.ok(bound.includes('Math.max(bottom, hintRect.bottom)'));
});

test('D3 click 走 sendPlaybackAction，且暴露探针便于验证', () => {
  assert.ok(lyricsPageSource.includes("closest('button[data-playback-action]')"));
  assert.ok(lyricsPageSource.includes('sendPlaybackAction(btn.getAttribute'));
  assert.ok(lyricsPageSource.includes('window.__mineradioDesktopLyricsSendPlaybackAction'));
});

test('D4 overlay-preload 暴露新 IPC 方法', () => {
  assert.ok(overlayPreloadSource.includes('sendPlaybackAction:'));
  assert.ok(overlayPreloadSource.includes("'mineradio-desktop-lyrics-playback-action'"));
  assert.ok(overlayPreloadSource.includes('String(action ||'));
});

test('D5 main.js 白名单 handler 复用全局热键转发，且不碰主窗口渲染层', () => {
  assert.ok(mainSource.includes("ipcMain.handle('mineradio-desktop-lyrics-playback-action'"));
  assert.ok(mainSource.includes('sendGlobalHotkeyAction(key)'));
  assert.ok(mainSource.includes("'DESKTOP_LYRICS_ACTION_UNSUPPORTED'"));
  assert.ok(mainSource.includes("new Set(['togglePlay', 'prevTrack', 'nextTrack'])"));
  assert.ok(mainSource.includes('function sendGlobalHotkeyAction(action)'));
});

test('D6 真实 handler 只放行三个 action，未授权的既不转发也不报错', async () => {
  const start = mainSource.indexOf('const DESKTOP_LYRICS_PLAYBACK_ACTIONS');
  const end = mainSource.indexOf("ipcMain.handle('mineradio-desktop-lyrics-update'");
  assert.ok(start > 0 && end > start);
  const body = mainSource.slice(start, end);
  const dispatched = [];
  let captured = null;
  const sandbox = {
    ipcMain: {
      handle(channel, fn) {
        if (channel === 'mineradio-desktop-lyrics-playback-action') captured = fn;
      },
    },
    sendGlobalHotkeyAction: (a) => dispatched.push(a),
    Set, String, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox, { filename: 'main-playback-handler.slice.js' });
  assert.ok(captured, 'handler 应被注册');
  // 返回值来自 vm realm，逐字段比避免 deepStrictEqual 的跨 realm 原型差异
  for (const action of ['nextTrack', 'togglePlay', 'prevTrack']) {
    const r = await captured({}, action);
    assert.equal(r.ok, true);
    assert.equal(r.action, action);
  }
  for (const action of ['volumeUp', '']) {
    const r = await captured({}, action);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'DESKTOP_LYRICS_ACTION_UNSUPPORTED');
  }
  assert.deepEqual(Array.from(dispatched), ['nextTrack', 'togglePlay', 'prevTrack']);
});

// =============================================================================
// E. 接线与边界静态断言
// =============================================================================

test('E1 loader 把新模块排在 08 之前，08 重挂变速', () => {
  const at = loaderSource.indexOf("'js/modules/05-playback/17-playback-advanced.js'");
  const graphAt = loaderSource.indexOf("'js/modules/05-playback/08-audio-graph-controls.js'");
  assert.ok(at > 0 && graphAt > at, 'getter 提供方必须先加载');
  assert.ok(graphSource.includes('Mineradio.playbackAdvanced.bindMedia(audio)'));
});

test('E2 08 / 16 都走 getter 且带常量兜底', () => {
  assert.ok(graphSource.includes('function playbackWallRate()'));
  assert.ok(graphSource.includes('function trackEndFadeLookaheadSec()'));
  // 18 加入后窗口是「用户设置值 / 编排器放大值」取较大者，兜底常量仍是起点
  assert.ok(graphSource.includes('var base = TRACK_END_FADE_LOOKAHEAD_SEC;'));
  assert.ok(graphSource.includes('return base;'));
  assert.ok(graphSource.includes('Mineradio.playbackAdvanced.getLookaheadSec'));
  assert.ok(gaplessSource.includes('function gaplessHandoffWallRate()'));
  assert.ok(gaplessSource.includes('function gaplessHandoffLeadSec()'));
  assert.ok(gaplessSource.includes('return GAPLESS_HANDOFF_LEAD_SEC;'));
  assert.ok(graphSource.includes('var wallRemain = remain / playbackWallRate();'));
  assert.ok(gaplessSource.includes('var wallRemain = (duration - currentTime) / gaplessHandoffWallRate();'));
});

test('E3 快捷菜单 UI 载体与 CSS 齐备', () => {
  const ids = [
    'playback-advanced-fold', 'playback-advanced-summary',
    'playback-speed-range', 'playback-speed-value', 'playback-speed-presets',
    'playback-preserve-pitch-toggle', 'playback-lookahead-range', 'playback-lookahead-value',
    'playback-lead-range', 'playback-lead-value', 'playback-output-device',
    'playback-output-pick', 'playback-output-default', 'playback-output-status',
  ];
  for (const id of ids) assert.ok(htmlSource.includes('id="' + id + '"'), '缺少 ' + id);
  assert.ok(cssSource.includes('.playback-advanced-fold > summary'));
  assert.ok(cssSource.includes('.playback-speed-presets button.active'));
  assert.ok(cssSource.includes('#playback-output-device'));
});

test('E4 上一轮功能零回归：gainNode 淡变、调音链、Cuefield、无缝衔接', () => {
  assert.ok(graphSource.includes('Mineradio.audioTuning.install(audioCtx, audioTap)'));
  assert.ok(graphSource.includes('gainNode.gain.setValueCurveAtTime('));
  assert.ok(graphSource.includes('function writeAudioOutputGain'));
  assert.ok(gaplessSource.includes('永不 play()'));
  const cuefield = read('public/js/modules/05-cuefield/02-cuefield-automix-integration.js');
  assert.ok(!cuefield.includes('playbackAdvanced'), 'Cuefield 集成层不应引用新模块');
});
