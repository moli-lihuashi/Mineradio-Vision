'use strict';

// =============================================================================
// 播放队列身份一致性 + 异步请求归属（回归）
// 覆盖：
//   1. 旧歌曲的代理 URL 晚于新歌曲返回时，不得改写新曲目的 audio.src
//   2. 删除队列项 / 随机重排后，currentIdx 必须仍指向正在播放的那首歌
//   3. 清空队列必须作废在途请求，旧请求返回后不能重新起播
// 说明：加载的是 index-loader 实际加载的 13-playback-start-audio.js，
// 不是未被加载的 09b-playback-core.js 旧副本。
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const startPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const loaderPath = path.join(appRoot, 'public', 'js', 'index-loader.js');
const startText = fs.readFileSync(startPath, 'utf8');

function song(id, extra) {
  return Object.assign({ provider: 'netease', id: id, name: 'Song ' + id, artist: 'Artist ' + id, duration: 180 }, extra || {});
}

function createMedia() {
  return {
    src: '',
    paused: true,
    ended: false,
    duration: 180,
    currentTime: 0,
    onended: null,
    onloadedmetadata: null,
    __mineradioQueueItemKey: '',
    __mineradioTrackSwitchToken: 0,
    playCalls: 0,
    addEventListener() {},
    removeEventListener() {},
    pause() { this.paused = true; },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
    load() {},
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    setAttribute() {},
  };
}

function withTimeout(promise, label, ms) {
  const limit = ms || 2000;
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error('TIMEOUT(' + limit + 'ms): ' + (label || 'promise') + ' 未结束'));
    }, limit);
    Promise.resolve(promise).then(
      function (value) { clearTimeout(timer); resolve(value); },
      function (error) { clearTimeout(timer); reject(error); }
    );
  });
}

function stubElement() {
  const classes = new Set();
  return {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) { if (force === undefined) { classes.has(name) ? classes.delete(name) : classes.add(name); } else if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    hidden: false,
    offsetWidth: 0,
    appendChild() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return null; },
    addEventListener() {},
  };
}

function createSandbox(queue, overrides) {
  const proxyRequests = [];
  const toasts = [];
  const playAudioCalls = [];
  const audio = createMedia();
  const sandbox = {
    console,
    Promise,
    Date,
    Math,
    Object,
    Array,
    Number,
    String,
    JSON,
    isFinite,
    setTimeout(fn) { sandbox.timers.push(fn); return sandbox.timers.length; },
    clearTimeout() {},
    timers: [],
    runTimers() {
      const pending = sandbox.timers.splice(0, sandbox.timers.length);
      pending.forEach(fn => { try { fn(); } catch (_) {} });
    },
    // 空闲任务不自动执行：测试只关心同步主链路
    requestIdleCallback() {},
    trackSwitchToken: 0,
    playQueue: queue,
    currentIdx: 0,
    playMode: 'loop',
    playing: false,
    playToggleBusy: false,
    miniQueueOpen: false,
    activeRadioContext: null,
    currentLocalSong: null,
    playbackQuality: 'hires',
    startPlaybackFadeIn() {},
    restorePlaybackGain() { sandbox.gainRestores += 1; },
    preparePlaybackFadeIn() {},
    resumeAudioAnalysis: async function () {},
    scheduleCuefieldAutoMixPrepare() {},
    schedulePlaybackStallRecovery() {},
    updateListenStatsTick() {},
    audioFadeSerial: 0,
    coverProcessToken: 0,
    beatMapToken: 0,
    djBeatMapToken: 0,
    beatMapNextIdx: 0,
    currentBeatMap: null,
    currentDjBeatMap: null,
    beatMapCache: {},
    djBeatMapCache: {},
    localBeatAnalysis: { active: false },
    uniforms: { uAlpha: { value: 1 } },
    sleepTimer: { pendingStop: false },
    playbackResumeRecovery: { serial: 0, pending: false },
    shelfManager: null,
    audio,
    proxyRequests,
    toasts,
    playAudioCalls,
    iconCalls: [],
    gainRestores: 0,
    Mineradio: {
      api: {
        apiMediaProxyUrlAsync(route, params) {
          let resolve;
          const promise = new Promise(r => { resolve = r; });
          proxyRequests.push({ key: params && params.url, route, resolve, promise });
          return promise;
        },
      },
    },
    queueItemKey(item) { return (item && item.provider || '') + ':' + (item && item.id || ''); },
    cloneSong(item) { return Object.assign({}, item); },
    hydrateCustomCover(item) { return item; },
    getMusicProviderKey() { return 'netease'; },
    songProviderKey() { return 'netease'; },
    resolveProviderRequestedQuality() { return { quality: 'hires' }; },
    normalizePlaybackQuality(value) { return value || 'hires'; },
    playbackQualityLabel(value) { return value; },
    playbackQualityWasDowngraded() { return false; },
    playbackResolvedQualityText() { return 'hires'; },
    resolveProviderPlayUrlData: async function (item) {
      return { url: 'origin://' + item.id, level: 'hires', sourceMatch: false };
    },
    playAudio: async function () {
      playAudioCalls.push(sandbox.currentIdx);
      sandbox.playing = true;
      return true;
    },
    attemptAudioPlay: async function () { return true; },
    audioReady: true,
    initAudio() {},
    getCustomCoverForSong() { return ''; },
    coverUrlWithSize(url) { return url; },
    applyCoverDataUrl() {},
    loadCoverFromUrl() {},
    tryAutoPlaybackFallback: async function () { return null; },
    retryQQPlaybackWithCompatibleQuality: async function () { return false; },
    retryNeteaseSourceMatchPlayback: async function () { return null; },
    skipFailedQueueItem() {},
    recoveryCancels: [],
    cancelSourceFallbackRecovery(reason) { sandbox.recoveryCancels.push(String(reason)); },
    bindPlaybackProgressEvents() {},
    applyVolumeToAudio() {},
    updatePlaybackProgressUi() {},
    setPlaybackBufferingState() {},
    clearPlaybackResumeWatchdogs() {},
    forcePlaybackControlsInteractive() {},
    hideLoading() {},
    showLoading() {},
    showToast(message) { toasts.push(message); },
    showSourceFallbackNotice() {},
    handlePlaybackUnavailable() {},
    finalizeListenSession() {},
    beginListenSession() {},
    prepareLeaveHomeForPlayback() {},
    resetCuefieldAutoMix() {},
    cancelBeatAnalysisTimer() {},
    cancelBeatPrefetchTimer() {},
    cancelLocalBeatAnalysis() {},
    closeGsapModal() {},
    syncSceneRadioPlaybackContext() {},
    suppressShelfPreviewForPlaybackSwitch() {},
    beatMapSongKey() { return ''; },
    isPodcastSong() { return false; },
    setDjModeActive() {},
    switchPlaybackVisualToEmily() {},
    updateCustomCoverButton() {},
    updateLikeButtons() {},
    syncLikeStatusForSong() {},
    updatePlaybackQualityUi() {},
    resetCinemaTrackProfile() {},
    updateEmptyHomeVisibility() {},
    updateControlTrackInfo() {},
    updateCustomLyricControls() {},
    withLyricFallback() { return []; },
    setOriginalLyricsState() {},
    applyPreferredLyricsForCurrent() {},
    tweenParticleAlpha() {},
    resetAudioVisualState() {},
    resetBeatCameraSync() {},
    resetDjBeatMapState() {},
    syncBeatMapPlaybackCursor() {},
    syncPodcastDjMapCursor() {},
    applyCinemaProfileFromBeatMap() {},
    applyPodcastDjProfileFromMap() {},
    hideBeatChip() {},
    showBeatChip() {},
    notifyDesktopLyricsBeatMapReady() {},
    schedulePodcastDjAnalysis() {},
    maybeAnnounceDjMode() {},
    scheduleQueueBeatPrefetch() {},
    scheduleQueueLyricPrefetch() {},
    readBeatDiskCache: async function () { return null; },
    scheduleBeatAnalysis() {},
    fetchLyric() {},
    safeRenderQueuePanel() {},
    safeShelfRebuild() {},
    scheduleShelfRebuild() {},
    savePlaybackSession() {},
    saveLastPlaybackSnapshot() {},
    updateLyricTimingOffsetUi() {},
    clearAudioFadeTimers() {},
    exitSceneRadioIfNeeded() {},
    scenePlaybackContextForTrackSwitch() { return null; },
    markRenderInteraction() {},
    markStageLyricsPlaybackResume() {},
    resetPlaybackFreshUrlRecoveryBudget() {},
    updatePlaybackResumePauseMarker() {},
    getPlaybackDurationSeconds() { return 180; },
    normalizePlaybackDurationSeconds() { return 180; },
    document: {
      getElementById() { return stubElement(); },
      body: { appendChild() {}, classList: { contains() { return false; } } },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  sandbox.window = sandbox;
  Object.keys(overrides || {}).forEach(key => { sandbox[key] = overrides[key]; });
  const playAudioStub = sandbox.playAudio;
  vm.runInNewContext(startText, sandbox, { filename: startPath });
  // 模块自身也声明了 playAudio（真实 attemptAudioPlay 路径）：这里换回可观测的桩，
  // 让测试只关心「谁有权起播」，而不是媒体元素细节。
  sandbox.playAudio = playAudioStub;
  // setPlayIcon 由模块自身声明：包一层以便观察「有没有改新曲目的播放图标」
  const realSetPlayIcon = sandbox.setPlayIcon;
  sandbox.setPlayIcon = function (value) {
    sandbox.iconCalls.push(value);
    return realSetPlayIcon(value);
  };
  sandbox.timers.length = 0;
  return sandbox;
}

async function flush(times) {
  const rounds = times || 24;
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

function findProxy(sandbox, key) {
  const found = sandbox.proxyRequests.filter(item => item.key === key);
  return found[found.length - 1];
}

// --- 1. 旧请求晚到不得改写新曲目 -------------------------------------------
async function testStaleProxyUrlCannotOverrideNewTrack() {
  const queue = [song('a'), song('b')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 0;

  const pendingA = sandbox.playQueueAt(0, { manual: true });
  await flush();
  const requestA = findProxy(sandbox, 'origin://a');
  assert(requestA, 'A 必须停在「取代理 URL」的异步等待阶段');

  const pendingB = sandbox.playQueueAt(1, { manual: true });
  await flush();
  const requestB = findProxy(sandbox, 'origin://b');
  assert(requestB, 'B 也必须到达取代理 URL 阶段');
  requestB.resolve('proxy://b');
  assert.strictEqual(await pendingB, true, 'B 应当正常起播');
  assert.strictEqual(sandbox.audio.src, 'proxy://b');
  assert.strictEqual(sandbox.currentIdx, 1);

  // A 的代理 URL 现在才返回（晚于 B 完成）
  requestA.resolve('proxy://a');
  assert.strictEqual(await pendingA, false, '过期的 A 请求必须自行中止');

  assert.strictEqual(sandbox.audio.src, 'proxy://b', '旧请求晚到不得把 audio.src 改回 A');
  assert.strictEqual(sandbox.currentIdx, 1, '当前曲目必须仍是 B');
  assert.strictEqual(sandbox.playQueue[sandbox.currentIdx].id, 'b');
  assert.strictEqual(sandbox.playing, true, '播放状态必须属于 B');
  assert.deepStrictEqual(sandbox.playAudioCalls, [1], '旧请求不得触发第二次起播');
}

// --- 2. 随机重排保持当前曲目身份 -------------------------------------------
function testShuffleQueueKeepsCurrentTrack() {
  const queue = [song('a'), song('b'), song('c'), song('d'), song('e')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 2;
  sandbox.playing = true;
  sandbox.audio.src = 'proxy://c';
  const playingSong = sandbox.playQueue[2];
  let switches = 0;
  sandbox.playQueueAt = function () { switches += 1; return Promise.resolve(true); };

  sandbox.shuffleQueue();

  assert.strictEqual(sandbox.playQueue.length, 5, '重排不能丢歌');
  assert.strictEqual(sandbox.currentIdx >= 0, true);
  assert.strictEqual(sandbox.playQueue[sandbox.currentIdx], playingSong, '随机后索引必须仍指向正在播放的那首');
  assert.strictEqual(switches, 0, '随机不应切换音频');
  assert.strictEqual(sandbox.audio.src, 'proxy://c', '随机不应改动音频源');
}

// --- 2. 尚未起播时随机：不改变可播放状态 -----------------------------------
function testShuffleWithoutCurrentKeepsPlayable() {
  const queue = [song('a'), song('b')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = -1;
  sandbox.playQueueAt = function () { throw new Error('随机不应切歌'); };

  sandbox.shuffleQueue();

  assert.strictEqual(sandbox.currentIdx, 0, '没有当前曲目时随机应落在第 0 首，保证播放按钮可用');
  assert.strictEqual(sandbox.playQueue.length, 2);
}

// --- 2. 删除当前项前面的歌：索引左移，不切歌 --------------------------------
function testRemoveBeforeCurrentKeepsIdentity() {
  const queue = [song('a'), song('b'), song('c')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 1;
  sandbox.playing = true;
  const playingSong = sandbox.playQueue[1];
  let switches = 0;
  sandbox.playQueueAt = function () { switches += 1; return Promise.resolve(true); };

  sandbox.removeFromQueue(0);

  assert.deepStrictEqual(sandbox.playQueue.map(item => item.id), ['b', 'c']);
  assert.strictEqual(sandbox.currentIdx, 0, '删除当前项之前的歌后索引必须左移');
  assert.strictEqual(sandbox.playQueue[sandbox.currentIdx], playingSong, '当前曲目身份不能变');
  assert.strictEqual(switches, 0, '不涉及当前曲目时不应切歌');
}

// --- 2. 删除当前项：明确切到接替位置的那首 ----------------------------------
function testRemoveCurrentSwitchesToSuccessor() {
  const queue = [song('a'), song('b'), song('c')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 1;
  sandbox.playing = true;
  sandbox.audio.src = 'proxy://b';
  sandbox.audio.paused = false;
  const calls = [];
  sandbox.playQueueAt = function (idx, opts) { calls.push({ idx, opts }); return Promise.resolve(true); };

  sandbox.removeFromQueue(1);

  assert.deepStrictEqual(sandbox.playQueue.map(item => item.id), ['a', 'c']);
  assert.strictEqual(sandbox.currentIdx, 1);
  assert.strictEqual(sandbox.playQueue[sandbox.currentIdx].id, 'c', '删除当前项后必须明确切到接替位置');
  assert.strictEqual(calls.length, 1, '删除当前项必须触发一次切歌');
  assert.strictEqual(calls[0].idx, 1);
  assert.strictEqual(calls[0].opts.holdPaused, false, '正在播放时接续应当继续出声');
}

// --- 2. 删除当前项（末尾）：回退到新的最后一首 ------------------------------
function testRemoveCurrentAtTailFallsBack() {
  const queue = [song('a'), song('b'), song('c')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 2;
  sandbox.playing = true;
  sandbox.audio.src = 'proxy://c';
  sandbox.audio.paused = false;
  const calls = [];
  sandbox.playQueueAt = function (idx) { calls.push(idx); return Promise.resolve(true); };

  sandbox.removeFromQueue(2);

  assert.deepStrictEqual(sandbox.playQueue.map(item => item.id), ['a', 'b']);
  assert.strictEqual(sandbox.currentIdx, 1);
  assert.strictEqual(sandbox.playQueue[sandbox.currentIdx].id, 'b');
  assert.deepStrictEqual(calls, [1]);
}

// --- 2. 删除最后一项（队列只剩一首）：明确停止 ------------------------------
function testRemoveOnlyItemStopsPlayback() {
  const queue = [song('a')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 0;
  sandbox.playing = true;
  sandbox.audio.src = 'proxy://a';
  sandbox.audio.paused = false;
  sandbox.audio.onended = function () {};
  let switches = 0;
  sandbox.playQueueAt = function () { switches += 1; return Promise.resolve(true); };

  sandbox.removeFromQueue(0);

  assert.strictEqual(sandbox.playQueue.length, 0);
  assert.strictEqual(sandbox.currentIdx, -1);
  assert.strictEqual(sandbox.audio.src, '', '队列删空后必须卸掉音频源');
  assert.strictEqual(sandbox.audio.onended, null);
  assert.strictEqual(sandbox.playing, false);
  assert.strictEqual(switches, 0, '队列空了不应再起播');
}

// --- 3. 清空队列作废在途请求（停在取代理 URL 阶段） -------------------------
async function testClearQueueInvalidatesPendingProxyRequest() {
  const queue = [song('a'), song('b')];
  const sandbox = createSandbox(queue);
  sandbox.currentIdx = 0;

  const pending = sandbox.playQueueAt(0, { manual: true });
  await flush();
  const requestA = findProxy(sandbox, 'origin://a');
  assert(requestA, 'A 必须停在取代理 URL 阶段');

  sandbox.clearQueue();
  assert.strictEqual(sandbox.playQueue.length, 0);
  assert.strictEqual(sandbox.currentIdx, -1);
  assert.strictEqual(sandbox.audio.src, '');
  assert.strictEqual(sandbox.playing, false);

  requestA.resolve('proxy://a');
  assert.strictEqual(await pending, false, '清空后旧请求必须中止');
  assert.strictEqual(sandbox.audio.src, '', '清空后旧请求不得把音频源装回去');
  assert.strictEqual(sandbox.playing, false, '清空后旧请求不得重新起播');
  assert.deepStrictEqual(sandbox.playAudioCalls, [], '清空后旧请求不得调用起播');
  assert.strictEqual(sandbox.playQueue.length, 0);
  assert.strictEqual(sandbox.currentIdx, -1);
  assert(sandbox.recoveryCancels.indexOf('clear-queue') >= 0, '清空必须一并作废在途的换源恢复任务');
}

// --- 3. 清空队列作废在途请求（停在取址阶段） -------------------------------
async function testClearQueueInvalidatesPendingResolve() {
  const queue = [song('a')];
  let releaseResolve;
  const sandbox = createSandbox(queue, {
    resolveProviderPlayUrlData: function () {
      return new Promise(resolve => { releaseResolve = resolve; });
    },
  });
  sandbox.currentIdx = 0;

  const pending = sandbox.playQueueAt(0, { manual: true });
  await flush();
  assert.strictEqual(typeof releaseResolve, 'function', 'A 必须停在取址阶段');

  sandbox.clearQueue();
  releaseResolve({ url: 'origin://a', level: 'hires', sourceMatch: false });
  // 过期请求的返回值只要求「不是 true」（调用方一律用 === true 判定成功）
  assert.notStrictEqual(await pending, true, '清空后取址阶段的旧请求必须中止');
  assert.strictEqual(sandbox.audio.src, '');
  assert.strictEqual(sandbox.proxyRequests.length, 0, '过期请求不应再发起代理请求');
  assert.deepStrictEqual(sandbox.playAudioCalls, []);
}

// 第一次 resumeAudioAnalysis 挂起（模拟切歌窗口），之后的调用立即完成，
// 这样「缺少归属校验」时会走到 play/写状态，而不是永远挂住。
function stallingResumeAnalysis() {
  const state = { release: null, calls: 0 };
  state.stub = function () {
    state.calls += 1;
    if (state.calls === 1) return new Promise(resolve => { state.release = resolve; });
    return Promise.resolve();
  };
  return state;
}
function failingResumeAnalysis() {
  const state = { reject: null, calls: 0 };
  state.stub = function () {
    state.calls += 1;
    if (state.calls === 1) return new Promise((resolve, reject) => { state.reject = reject; });
    return Promise.resolve();
  };
  return state;
}

// --- 4. 旧起播流程（真实 attemptAudioPlay）不得播放新媒体 -------------------
async function testStaleAttemptAudioPlayCannotStartNewMedia() {
  const sandbox = createSandbox([song('a'), song('b')]);
  sandbox.currentIdx = 0;
  sandbox.trackSwitchToken = 1;
  sandbox.audio.src = 'proxy://a';
  sandbox.audio.paused = true;
  const analysis = stallingResumeAnalysis();
  sandbox.resumeAudioAnalysis = analysis.stub;

  const pending = sandbox.attemptAudioPlay({ silent: true });
  await flush();
  assert.strictEqual(typeof analysis.release, 'function', 'A 的起播必须停在 resumeAudioAnalysis');

  // 期间 B 以 holdPaused 完成加载：token 前进、媒体换源、保持暂停
  sandbox.trackSwitchToken += 1;
  sandbox.audio.src = 'proxy://b';
  sandbox.audio.paused = true;
  sandbox.playing = false;

  analysis.release();
  assert.strictEqual(
    await withTimeout(pending, 'stale attemptAudioPlay'),
    false,
    '过期起播必须自行中止'
  );

  assert.strictEqual(sandbox.audio.playCalls, 0, '过期流程不得调用 play()（否则放出来的是 B）');
  assert.strictEqual(sandbox.audio.paused, true, 'B 必须保持暂停');
  assert.strictEqual(sandbox.playing, false);
  assert.deepStrictEqual(sandbox.iconCalls, [], '过期流程不得改新曲目的播放图标');
  assert.strictEqual(sandbox.gainRestores, 0, '过期流程不得动增益');
}

// --- 4. 旧起播失败不得把新曲目改成未播放 / 不得弹错误 ----------------------
async function testStaleAttemptAudioPlayFailureLeavesNewTrackAlone() {
  const sandbox = createSandbox([song('a'), song('b')]);
  sandbox.currentIdx = 0;
  sandbox.trackSwitchToken = 1;
  sandbox.audio.src = 'proxy://a';
  sandbox.audio.paused = false;
  sandbox.playing = true;
  const analysis = failingResumeAnalysis();
  sandbox.resumeAudioAnalysis = analysis.stub;

  const pending = sandbox.attemptAudioPlay({ silent: false });
  await flush();
  assert.strictEqual(typeof analysis.reject, 'function');

  // 期间已经切到 B 且 B 正在播放
  sandbox.trackSwitchToken += 1;
  sandbox.audio.src = 'proxy://b';
  sandbox.audio.paused = false;
  sandbox.playing = true;
  sandbox.toasts.length = 0;
  sandbox.iconCalls.length = 0;

  analysis.reject(new Error('late play failure'));
  assert.strictEqual(
    await withTimeout(pending, 'stale attemptAudioPlay error'),
    false
  );

  assert.strictEqual(sandbox.playing, true, '不得把新曲目的播放状态改成 false');
  assert.deepStrictEqual(sandbox.toasts, [], '不得给新曲目弹错误提示');
  assert.deepStrictEqual(sandbox.iconCalls, [], '不得改新曲目的图标');
  assert.strictEqual(sandbox.gainRestores, 0, '不得还原新曲目的增益');
}

// --- 4. 手势路径（manual）在边界后也不得写新曲目状态 ----------------------
async function testStaleManualPlayDoesNotWriteNewState() {
  const sandbox = createSandbox([song('a'), song('b')]);
  sandbox.currentIdx = 0;
  sandbox.trackSwitchToken = 1;
  sandbox.audio.src = 'proxy://a';
  sandbox.audio.paused = true;
  const analysis = stallingResumeAnalysis();
  sandbox.resumeAudioAnalysis = analysis.stub;

  const pending = sandbox.attemptAudioPlay({ manual: true, silent: false });
  await flush();
  assert.strictEqual(sandbox.audio.playCalls, 1, '手势路径会先同步 play 一次（此时仍是 A）');

  sandbox.trackSwitchToken += 1;
  sandbox.audio.src = 'proxy://b';
  sandbox.audio.paused = true;
  sandbox.playing = false;
  sandbox.iconCalls.length = 0;
  analysis.release();

  assert.strictEqual(await withTimeout(pending, 'stale manual attemptAudioPlay'), false);
  assert.strictEqual(sandbox.playing, false, '过期的手势流程不得把新曲目标成正在播放');
  assert.deepStrictEqual(sandbox.iconCalls, []);
  assert.strictEqual(sandbox.audio.paused, true);
}

// --- 4. 对照：归属未变时起播必须照常成功（确保断言不是空的） --------------
async function testAttemptAudioPlayStillStartsWhenOwned() {
  const sandbox = createSandbox([song('a')]);
  sandbox.currentIdx = 0;
  sandbox.trackSwitchToken = 1;
  sandbox.audio.src = 'proxy://a';
  sandbox.audio.paused = true;

  const started = await withTimeout(sandbox.attemptAudioPlay({ silent: true }), 'owned attemptAudioPlay');

  assert.strictEqual(started, true);
  assert.strictEqual(sandbox.audio.playCalls, 1, '归属正确时必须真的起播');
  assert.strictEqual(sandbox.playing, true);
  assert.deepStrictEqual(sandbox.iconCalls, [true]);
}

// --- 静态接线：确保加载的是实际生效文件 ------------------------------------
function testLoaderWiring() {
  const loaderText = fs.readFileSync(loaderPath, 'utf8');
  assert(/'js\/modules\/05-playback\/13-playback-start-audio\.js'/.test(loaderText), 'index-loader 必须加载 13-playback-start-audio.js');
  assert(!/'js\/modules\/05-playback\/09b-playback-core\.js'/.test(loaderText), 'index-loader 不应加载 09b 旧副本');
  assert(/function playbackSwitchRequestStillOwned\(token\)/.test(startText));
  assert(/if \(!playbackSwitchRequestStillOwned\(token\)\) \{\s*dropPendingCoverLoad\('token-expired-proxy'\);/.test(startText), '取代理 URL 之后必须有归属校验');
  assert(/function releaseQueuePlaybackMedia\(reason\)/.test(startText));
  assert(/releaseQueuePlaybackMedia\('clear-queue'\)/.test(startText));
  assert(!/currentIdx = 0; safeRenderQueuePanel\('shuffle-queue'\)/.test(startText), '随机重排不能暴力把索引归零');
}

async function run() {
  await testStaleProxyUrlCannotOverrideNewTrack();
  testShuffleQueueKeepsCurrentTrack();
  testShuffleWithoutCurrentKeepsPlayable();
  testRemoveBeforeCurrentKeepsIdentity();
  testRemoveCurrentSwitchesToSuccessor();
  testRemoveCurrentAtTailFallsBack();
  testRemoveOnlyItemStopsPlayback();
  await testClearQueueInvalidatesPendingProxyRequest();
  await testClearQueueInvalidatesPendingResolve();
  await testStaleAttemptAudioPlayCannotStartNewMedia();
  await testStaleAttemptAudioPlayFailureLeavesNewTrackAlone();
  await testStaleManualPlayDoesNotWriteNewState();
  await testAttemptAudioPlayStillStartsWhenOwned();
  testLoaderWiring();
  console.log('OK playback-queue-identity-and-stale-requests');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
