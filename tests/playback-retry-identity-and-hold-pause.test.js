'use strict';

// =============================================================================
// 音质重试 / 同曲重试的队列项身份 + holdPaused 残留约束 + 本地元数据写回（回归）
// 覆盖：
//   1. QQ 音质兼容重试：取址等待期间删掉 A，B 前移到 0 —— 重试必须播 B，不能播 C
//   2. 网易同曲候选重试：换候选等待期间删掉 A —— 必须选中 B 并把候选音源装到 B 上
//   3. 目标已不在队列：两条重试都必须中止，不得起播任何歌
//   4. holdPaused 残留监听：用户手动播放后 canplay 不得再把播放 pause 掉（线上 + 本地）
//   5. 用户没操作时仍保持暂停
//   6. 本地元数据回调：删除前项 / 随机重排后按时长写回正确的队列项，不动其它歌
// 说明：加载 index-loader 实际加载的 09a / 13 / 11 / 01 四个文件并共用单脚本作用域，
// 跑的是真实 playQueueAt / retryQQPlaybackWithCompatibleQuality /
// retryNeteaseSourceMatchPlayback / attemptAudioPlay / 本地 onloadedmetadata 回调。
// 媒体元素与 DOM 为可控模拟对象（事件顺序由测试驱动），不是桌面端实测。
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const queueOpsPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '09a-queue-ops.js');
const startPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const fallbackPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '11-provider-fallback.js');
const registryPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '01-music-provider-registry.js');
const loaderPath = path.join(appRoot, 'public', 'js', 'index-loader.js');

const queueOpsText = fs.readFileSync(queueOpsPath, 'utf8');
const startText = fs.readFileSync(startPath, 'utf8');
const fallbackText = fs.readFileSync(fallbackPath, 'utf8');
const registryText = fs.readFileSync(registryPath, 'utf8');

const TIMEOUT_MS = 2000;

function withTimeout(promise, label, ms) {
  const limit = ms || TIMEOUT_MS;
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

async function flush(times) {
  const rounds = times || 24;
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

function song(id, extra) {
  return Object.assign({ provider: 'netease', id: id, name: 'Song ' + id, artist: 'Artist ' + id, duration: 300 }, extra || {});
}

function localSong(id, extra) {
  return Object.assign({
    provider: 'local',
    type: 'local',
    source: 'local',
    localKey: 'lk-' + id,
    localUrl: 'mineradio-local://' + id + '.mp3',
    id: id,
    name: 'Local ' + id,
    artist: 'Local Artist',
    duration: 300,
  }, extra || {});
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
    style: {}, dataset: {}, textContent: '', innerHTML: '', hidden: false, offsetWidth: 0,
    appendChild() {}, insertBefore() {}, removeChild() {},
    setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, addEventListener() {},
  };
}

/* 可驱动事件的媒体对象：holdPaused 的暂停约束依赖 loadedmetadata / canplay / play
 * 的触发顺序，必须由测试显式控制（真实浏览器里这些事件是异步且顺序不定的）。 */
function createMedia() {
  const listeners = {};
  const media = {
    src: '', paused: true, ended: false, duration: 300, currentTime: 0,
    onended: null, onloadedmetadata: null,
    __mineradioQueueItemKey: '', __mineradioTrackSwitchToken: 0,
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    listenerCount(type) { return (listeners[type] || []).length; },
    emit(type) {
      const event = { type: type, target: media };
      (listeners[type] || []).slice().forEach(function (fn) { fn(event); });
    },
    pause() { media.pauseCalls += 1; media.paused = true; },
    play() {
      media.playCalls += 1;
      media.paused = false;
      media.emit('play');
      return Promise.resolve();
    },
    load() {},
    removeAttribute(name) { if (name === 'src') media.src = ''; },
    setAttribute() {},
  };
  return media;
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

/* 09a + 13 + 11 + 01 合并沙箱：与 index-loader 的单脚本拼接保持一致，
 * 这样重试 → playQueueAt → attemptAudioPlay / playLocalQueueSong 走的是真实链路。 */
function createPipelineSandbox(queue, config) {
  config = config || {};
  const toasts = [];
  const notices = [];
  const playAudioCalls = [];
  const audio = createMedia();
  const statuses = {
    netease: { loggedIn: true },
    qq: { loggedIn: true, playbackKeyReady: true, membershipKnown: true },
    kugou: { loggedIn: false, playbackKeyReady: false },
  };
  const sandbox = {
    console, Promise, Date, Math, Object, Array, Number, String, JSON, isFinite, encodeURIComponent,
    setTimeout(fn) { sandbox.timers.push(fn); return sandbox.timers.length; },
    clearTimeout() {},
    timers: [],
    requestIdleCallback() {},
    playQueue: queue,
    currentIdx: 0,
    trackSwitchToken: 1,
    playMode: 'loop',
    playing: false,
    playToggleBusy: false,
    miniQueueOpen: false,
    activeRadioContext: null,
    currentLocalSong: null,
    playbackQuality: 'hires',
    lyricSourceMode: 'default',
    audioFadeSerial: 0,
    coverProcessToken: 0,
    beatMapToken: 0,
    djBeatMapToken: 0,
    beatMapNextIdx: 0,
    currentBeatMap: null, currentDjBeatMap: null,
    beatMapCache: {}, djBeatMapCache: {},
    localBeatAnalysis: { active: false },
    uniforms: { uAlpha: { value: 1 } },
    sleepTimer: { pendingStop: false },
    playbackResumeRecovery: { serial: 0, pending: false },
    shelfManager: null,
    pendingPlaybackResumeAt: 0,
    audio,
    toasts, notices, playAudioCalls,
    audioReady: true,
    initAudio() {},
    // --- provider / fallback 依赖 ---
    songProviderKey(item) { return (item && item.provider) || 'netease'; },
    platformStatus(provider) { return statuses[provider] || { loggedIn: false }; },
    providerVipLevel() { return 'none'; },
    accountProviderOrder() { return ['netease', 'qq', 'kugou']; },
    normalizePlaybackQuality(value) { return value || 'hires'; },
    normalizePlaybackQualityForProvider(value) { return value || 'hires'; },
    getProviderPlaybackQuality() { return 'hires'; },
    playbackQualityLabel(value) { return value; },
    playbackQualityWasDowngraded() { return false; },
    playbackResolvedQualityText() { return 'hires'; },
    markPlaybackQualityRuntimeCap() {},
    sourceCandidateRejectReason() { return ''; },
    searchAlternatePlatformSong: async function () { return null; },
    // --- 13 依赖 ---
    resolveProviderRequestedQuality() { return { quality: 'hires' }; },
    resolveProviderPlayUrlData: async function (item, opts) {
      if (opts && opts.preResolvedPlaybackData && opts.preResolvedPlaybackData.url) return opts.preResolvedPlaybackData;
      if (typeof config.playUrl === 'function') return config.playUrl(item, opts);
      return { url: 'origin://' + item.id, level: 'hires', sourceMatch: false };
    },
    apiJson: function (url) {
      if (typeof config.apiJson === 'function') return config.apiJson(url);
      return Promise.resolve({});
    },
    Mineradio: {
      api: {
        apiMediaProxyUrlAsync(route, params) {
          return Promise.resolve('proxy://' + (params && params.url || ''));
        },
      },
    },
    getCustomCoverForSong() { return ''; },
    hydrateCustomCover(item) { return item; },
    cloneSong(item) { return Object.assign({}, item); },
    coverUrlWithSize(url) { return url; },
    applyCoverDataUrl() {},
    loadCoverFromUrl() {},
    tryAutoPlaybackFallback: async function () { return null; },
    skipFailedQueueItem() {},
    resumeAudioAnalysis: async function () {},
    preparePlaybackFadeIn() {},
    startPlaybackFadeIn() {},
    restorePlaybackGain() {},
    bindPlaybackProgressEvents() {},
    applyVolumeToAudio() {},
    updatePlaybackProgressUi() {},
    setPlaybackBufferingState() {},
    clearPlaybackResumeWatchdogs() {},
    clearAlbumGaplessPreload() {},
    forcePlaybackControlsInteractive() {},
    hideLoading() {}, showLoading() {},
    showToast(message) { toasts.push(String(message)); },
    showSourceFallbackNotice(title, body) { notices.push({ title, body }); },
    handlePlaybackUnavailable() {},
    finalizeListenSession() {},
    beginListenSession() {},
    prepareLeaveHomeForPlayback() {},
    resetCuefieldAutoMix() {},
    cancelBeatAnalysisTimer() {}, cancelBeatPrefetchTimer() {}, cancelLocalBeatAnalysis() {},
    cancelDjBeatAnalysisTimer() {},
    closeGsapModal() {},
    syncSceneRadioPlaybackContext() {},
    suppressShelfPreviewForPlaybackSwitch() {},
    beatMapSongKey() { return ''; },
    isPodcastSong() { return false; },
    setDjModeActive() {},
    switchPlaybackVisualToEmily() {},
    updateCustomCoverButton() {},
    updateLikeButtons() {}, syncLikeStatusForSong() {},
    updatePlaybackQualityUi() {}, resetCinemaTrackProfile() {},
    updateEmptyHomeVisibility() {}, updateControlTrackInfo() {}, updateCustomLyricControls() {},
    withLyricFallback() { return []; },
    setOriginalLyricsState() {}, applyPreferredLyricsForCurrent() {}, applyCustomLyricState() {},
    applyLyricApiResponse() {},
    tweenParticleAlpha() {},
    resetAudioVisualState() {}, resetBeatCameraSync() {}, resetDjBeatMapState() {},
    syncBeatMapPlaybackCursor() {}, syncPodcastDjMapCursor() {},
    applyCinemaProfileFromBeatMap() {}, applyPodcastDjProfileFromMap() {},
    hideBeatChip() {}, showBeatChip() {}, notifyDesktopLyricsBeatMapReady() {},
    schedulePodcastDjAnalysis() {}, maybeAnnounceDjMode() {},
    scheduleQueueBeatPrefetch() {}, scheduleQueueLyricPrefetch() {},
    readBeatDiskCache: async function () { return null; },
    scheduleBeatAnalysis() {}, fetchLyric() {},
    safeRenderQueuePanel() {}, safeShelfRebuild() {}, scheduleShelfRebuild() {},
    savePlaybackSession() {}, saveLastPlaybackSnapshot() {}, updateLyricTimingOffsetUi() {},
    clearAudioFadeTimers() {},
    exitSceneRadioIfNeeded() {},
    scenePlaybackContextForTrackSwitch() { return null; },
    markRenderInteraction() {},
    markStageLyricsPlaybackResume() {},
    resetPlaybackFreshUrlRecoveryBudget() {},
    updatePlaybackResumePauseMarker() {},
    getPlaybackDurationSeconds() { return 300; },
    normalizePlaybackDurationSeconds() { return 300; },
    scheduleCuefieldAutoMixPrepare() {}, schedulePlaybackStallRecovery() {},
    updateListenStatsTick() {},
    document: {
      getElementById() { return stubElement(); },
      createElement() { return stubElement(); },
      body: { appendChild() {}, removeChild() {}, classList: { contains() { return false; } } },
      addEventListener() {}, removeEventListener() {},
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  [queueOpsPath, startPath, fallbackPath, registryPath].forEach(function (file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });
  // 模块自身声明的 playAudio（真实 attemptAudioPlay）换成可观测桩：
  // 断言直接反映「实际起播的是哪首」，结果由用例控制成功 / 失败。
  sandbox.playAudio = async function (opts) {
    playAudioCalls.push(sandbox.currentIdx);
    const ok = typeof config.playAudioResult === 'function' ? config.playAudioResult(sandbox, opts) : true;
    if (ok) sandbox.playing = true;
    return ok;
  };
  // 01 自身声明了真实的 resolveProviderPlayUrlData（走 apiJson 取址）：
  // 这里换成用例控制的取址结果，断言才能精确落在「重试把哪首歌的地址装了进去」。
  sandbox.resolveProviderPlayUrlData = async function (item, opts) {
    if (opts && opts.preResolvedPlaybackData && opts.preResolvedPlaybackData.url) return opts.preResolvedPlaybackData;
    if (typeof config.playUrl === 'function') return config.playUrl(item, opts);
    return { url: 'origin://' + item.id, level: 'hires', sourceMatch: false };
  };
  sandbox.showSourceFallbackNotice = function (title, body) { notices.push({ title, body }); };
  // 11 自身声明了真实的换源/跳歌链路：本用例只关心重试路径，
  // 换源与跳歌改为无副作用桩，避免把递归链路混进断言。
  sandbox.tryAutoPlaybackFallback = async function () { return null; };
  sandbox.skipFailedQueueItem = function () {};
  sandbox.timers.length = 0;
  return sandbox;
}

function ids(queue) {
  return queue.map(item => item && item.id);
}

// --- 1. QQ 音质兼容重试：必须按队列项身份重新定位 ---------------------------
async function testQQQualityRetryUsesLiveIndex() {
  const A = song('a'), B = song('b', { provider: 'qq' }), C = song('c', { provider: 'qq' });
  const firstResolve = deferred();
  const attempts = { b: 0 };
  const sandbox = createPipelineSandbox([A, B, C], {
    playUrl: function (item, opts) {
      // B 第一次取址「还在路上」（用户正是在这个窗口里删队列项），返回失败触发音质兼容重试
      if (item.id === 'b' && attempts.b === 0) { attempts.b += 1; return firstResolve.promise; }
      return { url: 'origin://' + item.id + ':' + ((opts && opts.qualityOverride) || 'hires'), level: 'hires', sourceMatch: false };
    },
  });
  sandbox.currentIdx = 1;

  const pending = sandbox.playQueueAt(1, { manual: true });
  await flush();
  assert.strictEqual(attempts.b, 1, 'B 必须停在「取址未返回」的窗口');

  // 用户删掉 A：队列变 [B, C]，B 的位置从 1 变成 0
  sandbox.removeFromQueue(0);
  assert.strictEqual(sandbox.currentIdx, 0, '删除当前项之前的歌后索引必须左移');
  assert.strictEqual(sandbox.playQueue[sandbox.currentIdx], B);

  firstResolve.resolve({ level: 'hires', reason: 'url_unavailable' });
  const started = await withTimeout(pending, 'qq quality retry');

  assert.notStrictEqual(started, false, '重试应当继续把 B 播下去');
  assert.strictEqual(sandbox.playQueue[0], B, '队列项身份不变');
  assert.strictEqual(sandbox.currentIdx, 0, '重试必须起播重定位后的 B（索引 0）');
  assert.strictEqual(sandbox.audio.src, 'proxy://origin://b:exhigh', '必须装入 B 的新音质音源，不能是 C');
  assert.deepStrictEqual(sandbox.playAudioCalls, [0], '实际起播的必须是 B');
}

// --- 2. 网易同曲候选重试：同样按身份重新定位 --------------------------------
async function testNeteaseSameTrackRetryUsesLiveIndex() {
  const A = song('a'), B = song('b'), C = song('c');
  const nextCandidate = deferred();
  const sandbox = createPipelineSandbox([A, B, C], {
    playUrl: function (item) {
      if (item.id === 'b') return { url: 'origin://b', level: 'hires', sourceMatch: true, resolvedNeteaseId: 'n1' };
      return { url: 'origin://' + item.id, level: 'hires', sourceMatch: false };
    },
    apiJson: function () { return nextCandidate.promise; },
    // 首次起播失败才进入同曲候选重试；重试时起播成功
    playAudioResult: function () { return sandbox_ref.playAudioCalls.length > 1; },
  });
  let sandbox_ref = sandbox;
  sandbox.currentIdx = 1;

  const pending = sandbox.playQueueAt(1, { manual: true });
  await flush();
  assert.strictEqual(sandbox.audio.src, 'proxy://origin://b', 'B 先装入原曲音源');
  assert.strictEqual(sandbox.playAudioCalls.length, 1, '第一次起播必须失败并进入候选重试');

  // 换候选的请求还在路上时删掉 A：B 前移到 0
  sandbox.removeFromQueue(0);
  assert.strictEqual(sandbox.currentIdx, 0);

  nextCandidate.resolve({ url: 'origin://b-match', level: 'hires', sourceMatch: true, resolvedNeteaseId: 'n2' });
  await withTimeout(pending, 'netease same-track retry');

  assert.strictEqual(sandbox.playQueue[0], B, '重试必须落在 B 的新位置');
  assert.strictEqual(sandbox.currentIdx, 0, '不能选中 C');
  assert.strictEqual(sandbox.audio.src, 'proxy://origin://b-match', '候选音源必须装到 B 上');
  assert.deepStrictEqual(sandbox.playAudioCalls, [1, 0], '第二次起播必须针对 B（索引 0）');
}

// --- 3. 目标已不在队列：两条重试都必须中止 ----------------------------------
async function testQQRetryAbortsWhenTargetRemoved() {
  const A = song('a'), B = song('b', { provider: 'qq' }), C = song('c', { provider: 'qq' });
  const firstResolve = deferred();
  let bCalls = 0;
  const sandbox = createPipelineSandbox([A, B, C], {
    playUrl: function (item, opts) {
      if (item.id === 'b' && bCalls === 0) { bCalls += 1; return firstResolve.promise; }
      return { url: 'origin://' + item.id + ':' + ((opts && opts.qualityOverride) || 'hires'), level: 'hires', sourceMatch: false };
    },
  });
  sandbox.currentIdx = 1;

  const pending = sandbox.playQueueAt(1, { manual: true });
  await flush();

  sandbox.playQueue.splice(1, 1); // 删掉正在等取址的 B
  sandbox.currentIdx = 0;

  firstResolve.resolve({ level: 'hires', reason: 'url_unavailable' });
  await withTimeout(pending, 'qq retry after removal');

  assert.deepStrictEqual(ids(sandbox.playQueue), ['a', 'c'], '不得把任何歌换成别的');
  assert.strictEqual(sandbox.audio.src, '', '不得起播任何音源');
  assert.deepStrictEqual(sandbox.playAudioCalls, [], '不得起播任何歌');
}

async function testNeteaseRetryAbortsWhenTargetRemoved() {
  const A = song('a'), B = song('b'), C = song('c');
  const nextCandidate = deferred();
  const sandbox = createPipelineSandbox([A, B, C], {
    playUrl: function (item) {
      if (item.id === 'b') return { url: 'origin://b', level: 'hires', sourceMatch: true, resolvedNeteaseId: 'n1' };
      return { url: 'origin://' + item.id, level: 'hires', sourceMatch: false };
    },
    apiJson: function () { return nextCandidate.promise; },
    playAudioResult: function () { return false; },
  });
  sandbox.currentIdx = 1;

  const pending = sandbox.playQueueAt(1, { manual: true });
  await flush();

  sandbox.playQueue.splice(1, 1); // 删掉正在等候选的 B
  sandbox.currentIdx = 0;

  nextCandidate.resolve({ url: 'origin://b-match', level: 'hires', sourceMatch: true, resolvedNeteaseId: 'n2' });
  await withTimeout(pending, 'netease retry after removal');

  assert.deepStrictEqual(ids(sandbox.playQueue), ['a', 'c']);
  assert.deepStrictEqual(sandbox.playAudioCalls, [1], '只有第一次起播（失败）被调用，重试不得起播任何歌');
  assert.notStrictEqual(sandbox.audio.src, 'proxy://origin://b-match', '候选音源不得装到别的歌上');
}

// --- 4. holdPaused 残留监听不得覆盖用户的新播放（线上路径） ------------------
async function testHoldPausedResidualCannotPauseUserPlay() {
  const A = song('a'), B = song('b');
  const sandbox = createPipelineSandbox([A, B]);
  sandbox.currentIdx = 1;

  const loaded = await withTimeout(sandbox.playQueueAt(1, { holdPaused: true }), 'holdPaused load');
  assert(loaded, '暂停装载应当成功');
  assert.strictEqual(sandbox.audio.paused, true, '装载后必须保持暂停');
  assert.strictEqual(sandbox.audio.playCalls, 0, '不得出声');
  assert.strictEqual(sandbox.audio.listenerCount('canplay'), 1, '应当挂上暂停约束');

  // 元数据到达 → 约束生效并撤销
  sandbox.audio.emit('loadedmetadata');
  assert.strictEqual(sandbox.audio.paused, true);
  assert.strictEqual(sandbox.audio.listenerCount('canplay'), 0, '约束生效后两条监听都必须摘掉');
  assert.strictEqual(sandbox.audio.listenerCount('loadedmetadata'), 0);

  // 用户点播放
  const played = await withTimeout(sandbox.attemptAudioPlay({ manual: true }), 'manual play after holdPaused');
  assert.strictEqual(played, true);
  assert.strictEqual(sandbox.audio.paused, false);
  assert.strictEqual(sandbox.playing, true);

  const pauseCallsAfterPlay = sandbox.audio.pauseCalls;
  // 迟到的 canplay：不得再把播放暂停掉
  sandbox.audio.emit('canplay');
  assert.strictEqual(sandbox.audio.paused, false, '残留 canplay 不得取消用户刚发起的播放');
  assert.strictEqual(sandbox.playing, true, '播放状态不得被残留监听改回暂停');
  assert.strictEqual(sandbox.audio.pauseCalls, pauseCallsAfterPlay, '不得再调用 pause()');
}

// --- 4b. holdPaused 残留监听（本地路径） ------------------------------------
async function testHoldPausedResidualCannotPauseUserPlayLocal() {
  const A = localSong('a'), B = localSong('b');
  const sandbox = createPipelineSandbox([A, B]);
  sandbox.currentIdx = 1;

  await withTimeout(sandbox.playQueueAt(1, { holdPaused: true }), 'local holdPaused load');
  assert.strictEqual(sandbox.audio.src, B.localUrl);
  assert.strictEqual(sandbox.audio.paused, true);
  assert.strictEqual(sandbox.audio.playCalls, 0);

  sandbox.audio.emit('loadedmetadata');
  assert.strictEqual(sandbox.audio.paused, true);
  assert.strictEqual(sandbox.audio.listenerCount('canplay'), 0, '本地路径同样必须撤销另一条监听');

  const played = await withTimeout(sandbox.attemptAudioPlay({ manual: true }), 'local manual play');
  assert.strictEqual(played, true);
  assert.strictEqual(sandbox.audio.paused, false);

  const pauseCallsAfterPlay = sandbox.audio.pauseCalls;
  sandbox.audio.emit('canplay');
  assert.strictEqual(sandbox.audio.paused, false, '本地路径残留 canplay 不得取消播放');
  assert.strictEqual(sandbox.audio.pauseCalls, pauseCallsAfterPlay);
}

// --- 5. 用户没操作时仍保持暂停（约束不能被提前撤销） ------------------------
async function testHoldPausedStaysPausedWithoutUserAction() {
  const sandbox = createPipelineSandbox([song('a'), song('b')]);
  sandbox.currentIdx = 1;

  await withTimeout(sandbox.playQueueAt(1, { holdPaused: true }), 'holdPaused load');

  // canplay 先到：暂停并撤销
  sandbox.audio.emit('canplay');
  assert.strictEqual(sandbox.audio.paused, true, 'canplay 到来自动暂停');
  assert.strictEqual(sandbox.playing, false);
  assert.strictEqual(sandbox.audio.playCalls, 0);

  // 再补一次 loadedmetadata：不得因为监听已摘而反向开始播放
  sandbox.audio.emit('loadedmetadata');
  assert.strictEqual(sandbox.audio.paused, true, '用户没操作时必须一直保持暂停');
  assert.strictEqual(sandbox.playing, false);
}

// --- 6. 本地元数据按时长写回身份定位后的队列项 ------------------------------
async function testLocalMetadataWritesBackByQueueIdentity() {
  const A = localSong('a'), B = localSong('b'), C = localSong('c');
  const sandbox = createPipelineSandbox([A, B, C]);
  sandbox.currentIdx = 1;

  await withTimeout(sandbox.playQueueAt(1, { holdPaused: true }), 'local metadata load');
  assert.strictEqual(sandbox.currentLocalSong, B);

  sandbox.removeFromQueue(0); // [B, C]，B 前移到 0
  assert.deepStrictEqual(ids(sandbox.playQueue), ['b', 'c']);
  assert.strictEqual(sandbox.currentIdx, 0);

  // 元数据现在才回来
  sandbox.audio.duration = 123;
  assert.strictEqual(typeof sandbox.audio.onloadedmetadata, 'function');
  sandbox.audio.onloadedmetadata();

  assert.strictEqual(B.duration, 123, 'B 的时长必须更新');
  assert.strictEqual(sandbox.playQueue[0].duration, 123);
  assert.strictEqual(C.duration, 300, 'C 的时长不能被写成 B 的（旧实现会写到旧 idx）');
  assert.strictEqual(A.duration, 300);
}

// --- 6b. 随机重排后元数据写回新位置 ----------------------------------------
async function testLocalMetadataWritesBackAfterShuffle() {
  const A = localSong('a'), B = localSong('b'), C = localSong('c'), D = localSong('d');
  const sandbox = createPipelineSandbox([A, B, C, D]);
  sandbox.currentIdx = 1;

  await withTimeout(sandbox.playQueueAt(1, { holdPaused: true }), 'local metadata load');
  // 随机重排后的队列形态（确定性构造，避免 Math.random 让用例时灵时不灵）：B 被挪到末尾
  sandbox.playQueue.splice(sandbox.playQueue.indexOf(B), 1);
  sandbox.playQueue.push(B);
  sandbox.currentIdx = sandbox.playQueue.indexOf(B);
  const liveIdx = sandbox.playQueue.indexOf(B);
  assert.strictEqual(liveIdx, 3, 'B 已被重排到末尾');
  assert.strictEqual(sandbox.currentIdx, 3);

  sandbox.audio.duration = 123;
  sandbox.audio.onloadedmetadata();

  assert.strictEqual(sandbox.playQueue[liveIdx], B);
  assert.strictEqual(B.duration, 123, '时长必须写到 B 重排后的位置');
  [A, C, D].forEach(function (other) {
    assert.strictEqual(other.duration, 300, other.id + ' 的时长不能被改写');
  });
}

// --- 6c. 目标已不在队列：不得改到别的歌 ------------------------------------
async function testLocalMetadataIgnoresRemovedTarget() {
  const A = localSong('a'), B = localSong('b'), C = localSong('c');
  const sandbox = createPipelineSandbox([A, B, C]);
  sandbox.currentIdx = 1;

  await withTimeout(sandbox.playQueueAt(1, { holdPaused: true }), 'local metadata load');

  sandbox.playQueue.splice(1, 1); // 删掉 B 自己
  sandbox.currentIdx = 0;
  assert.deepStrictEqual(ids(sandbox.playQueue), ['a', 'c']);

  sandbox.currentLocalSong = B; // 回调守卫仍认这首（极端情况下媒体还没换）
  sandbox.audio.duration = 123;
  sandbox.audio.onloadedmetadata();

  assert.strictEqual(C.duration, 300, '目标已不在队列时不得把时长写到别的歌');
  assert.strictEqual(A.duration, 300);
  assert.strictEqual(sandbox.playQueue[0], A);
  assert.strictEqual(sandbox.playQueue[1], C);
}

// --- 静态接线 --------------------------------------------------------------
function testWiring() {
  assert(/function queueIndexForItem\(song\)/.test(queueOpsText), '必须提供通用的队列项身份定位');
  assert(/var retryIdx = typeof queueIndexForItem === 'function' \? queueIndexForItem\(song\)/.test(fallbackText), 'QQ 音质重试必须按身份重新定位');
  assert(!/playQueueAt\(idx, Object\.assign\(\{\}, opts, \{\s*qualityOverride: nextQuality/.test(fallbackText), 'QQ 重试不得再信任旧 idx');
  assert(/var retryIdx = typeof queueIndexForItem === 'function' \? queueIndexForItem\(song\) : playQueue\.indexOf\(song\)/.test(registryText), '网易同曲重试必须按身份重新定位');
  assert(/var retryStarted = await playQueueAt\(retryIdx, retryOpts\)/.test(registryText), '网易同曲重试必须用重定位后的索引');
  assert(/armHoldPauseConstraint\(token, audio\)/.test(startText), '两条起播路径都必须走统一的 holdPaused 约束');
  assert(!/holdPauseOnce/.test(startText), '不得再各自挂 once 监听（漏摘另一条就是本缺陷）');
  assert(/if \(opts\.manual\) releaseHoldPauseConstraint\('user-play'\)/.test(startText), '用户明确播放必须撤销暂停约束');
  assert(/var durationIdx = typeof queueIndexForItem === 'function' \? queueIndexForItem\(song\) : playQueue\.indexOf\(song\)/.test(startText), '本地元数据必须按身份写回');
  assert(!/if \(playQueue\[idx\]\) playQueue\[idx\]\.duration = duration;/.test(startText), '不得再用旧 idx 写时长');
  const loaderText = fs.readFileSync(loaderPath, 'utf8');
  assert(/'js\/modules\/05-playback\/09a-queue-ops\.js'/.test(loaderText), 'index-loader 必须加载 09a-queue-ops.js');
}

async function run() {
  await testQQQualityRetryUsesLiveIndex();
  await testNeteaseSameTrackRetryUsesLiveIndex();
  await testQQRetryAbortsWhenTargetRemoved();
  await testNeteaseRetryAbortsWhenTargetRemoved();
  await testHoldPausedResidualCannotPauseUserPlay();
  await testHoldPausedResidualCannotPauseUserPlayLocal();
  await testHoldPausedStaysPausedWithoutUserAction();
  await testLocalMetadataWritesBackByQueueIdentity();
  await testLocalMetadataWritesBackAfterShuffle();
  await testLocalMetadataIgnoresRemovedTarget();
  testWiring();
  console.log('OK playback-retry-identity-and-hold-pause');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
