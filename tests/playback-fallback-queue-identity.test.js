'use strict';

// =============================================================================
// 自动换源：队列项身份定位 + 暂停意图穿透（回归）
// 覆盖：
//   1. 搜索等待期间删除前面的歌：候选必须写到 B 的新位置，不能覆盖 C
//   2. 搜索等待期间随机重排：候选写到 B 的新位置，其它项保持原样
//   3. 等待期间 B 被删除：不得写入任何槽位、不得起播
//   4. 换源失败回滚：按身份定位当前槽位，不信任旧 idx
//   5. holdPaused 穿透换源：删除暂停中的当前项 → 换源后只加载不出声
// 说明：第 5 项同时加载 11 + 13（与 index-loader 一致），跑真实的 playQueueAt / attemptAudioPlay。
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const fallbackPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '11-provider-fallback.js');
const startPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const fallbackText = fs.readFileSync(fallbackPath, 'utf8');
const startText = fs.readFileSync(startPath, 'utf8');

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
  return Object.assign({ provider: 'netease', id: id, name: 'Song ' + id, artist: 'Artist ' + id, duration: 180 }, extra || {});
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

function createMedia() {
  return {
    src: '', paused: true, ended: false, duration: 180, currentTime: 0,
    onended: null, onloadedmetadata: null,
    __mineradioQueueItemKey: '', __mineradioTrackSwitchToken: 0,
    playCalls: 0,
    addEventListener() {}, removeEventListener() {},
    pause() { this.paused = true; },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
    load() {},
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    setAttribute() {},
  };
}

/* 11 + 13 合并沙箱：与 index-loader 的「单脚本拼接」保持一致，
 * 这样 tryAutoPlaybackFallback → playQueueAt → attemptAudioPlay 走的是真实链路。 */
function createPipelineSandbox(queue) {
  const toasts = [];
  const notices = [];
  const playAudioCalls = [];
  const audio = createMedia();
  const statuses = {
    netease: { loggedIn: true },
    qq: { loggedIn: true, playbackKeyReady: true },
    kugou: { loggedIn: false, playbackKeyReady: false },
  };
  const sandbox = {
    console, Promise, Date, Math, Object, Array, Number, String, JSON, isFinite,
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
    audio,
    toasts, notices, playAudioCalls,
    audioReady: true,
    initAudio() {},
    // provider / fallback 依赖
    normalizePlaybackProvider(provider) { return ['qq', 'kugou', 'qishui', 'spotify'].includes(provider) ? provider : 'netease'; },
    songProviderKey(item) { return (item && item.provider) || 'netease'; },
    platformStatus(provider) { return statuses[provider] || { loggedIn: false }; },
    accountProviderOrder() { return ['netease', 'qq', 'kugou']; },
    providerVipLevel() { return 'none'; },
    queueItemKey(item) { return (item && item.provider || '') + ':' + (item && item.id || ''); },
    hydrateCustomCover(item) { return item; },
    cloneSong(item) { return Object.assign({}, item); },
    sourceCandidateRejectReason() { return ''; },
    normalizePlaybackQuality(value) { return value || 'hires'; },
    normalizePlaybackQualityForProvider(value) { return value || 'hires'; },
    getProviderPlaybackQuality() { return 'hires'; },
    playbackQualityLabel(value) { return value; },
    playbackQualityWasDowngraded() { return false; },
    playbackResolvedQualityText() { return 'hires'; },
    markPlaybackQualityRuntimeCap() {},
    pendingPlaybackResumeAt: 0,
    // 13 依赖
    getMusicProviderKey() { return 'netease'; },
    resolveProviderRequestedQuality() { return { quality: 'hires' }; },
    resolveProviderPlayUrlData: async function (item, opts) {
      if (opts && opts.preResolvedPlaybackData && opts.preResolvedPlaybackData.url) return opts.preResolvedPlaybackData;
      return { url: 'origin://' + item.id, level: 'hires', sourceMatch: false };
    },
    apiJson: async function () { return { songs: [] }; },
    Mineradio: {
      api: {
        apiMediaProxyUrlAsync(route, params) {
          return Promise.resolve('proxy://' + (params && params.url || ''));
        },
      },
    },
    playAudio: async function () {
      playAudioCalls.push(sandbox.currentIdx);
      sandbox.playing = true;
      return true;
    },
    getCustomCoverForSong() { return ''; },
    coverUrlWithSize(url) { return url; },
    applyCoverDataUrl() {},
    loadCoverFromUrl() {},
    tryAutoPlaybackFallback: async function () { return null; },
    retryQQPlaybackWithCompatibleQuality: async function () { return false; },
    retryNeteaseSourceMatchPlayback: async function () { return null; },
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
    setOriginalLyricsState() {}, applyPreferredLyricsForCurrent() {},
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
    getPlaybackDurationSeconds() { return 180; },
    normalizePlaybackDurationSeconds() { return 180; },
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
  vm.runInContext(fallbackText, context, { filename: fallbackPath });
  const playAudioStub = sandbox.playAudio;
  vm.runInContext(startText, context, { filename: startPath });
  // 13 自身声明了 playAudio（真实 attemptAudioPlay）：这里用可观测桩，
  // 让断言直接反映「有没有真的去起播」。
  sandbox.playAudio = playAudioStub;
  // 11 自带 showSourceFallbackNotice（依赖真实 DOM 结构）：换成只记录不渲染的桩
  sandbox.showSourceFallbackNotice = function (title, body) { notices.push({ title, body }); };
  sandbox.timers.length = 0;
  return sandbox;
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function ids(queue) {
  return queue.map(item => item && item.id);
}

// --- 1. 等待期间删除前面的歌：候选写到新位置，C 必须保留 --------------------
async function testDeleteBeforeCurrentKeepsOtherItems() {
  const A = song('a'), B = song('b'), C = song('c');
  const sandbox = createPipelineSandbox([A, B, C]);
  sandbox.currentIdx = 1;
  const search = deferred();
  sandbox.searchAlternatePlatformSong = function () { return search.promise; };
  const plays = [];
  sandbox.playQueueAt = function (idx, opts) { plays.push({ idx, opts }); sandbox.currentIdx = idx; return Promise.resolve(true); };

  const pending = sandbox.tryAutoPlaybackFallback(B, { category: 'url_unavailable' }, 1, 1, {});
  await flush();

  // 用户删掉 A：队列变 [B,C]，B 的位置变成 0
  sandbox.playQueue.splice(0, 1);
  sandbox.currentIdx = 0;

  search.resolve({ provider: 'qq', id: 'b-qq', name: B.name, artist: B.artist });
  const result = await withTimeout(pending, 'fallback after delete-before');

  assert.strictEqual(result, true);
  assert.deepStrictEqual(ids(sandbox.playQueue), ['b-qq', 'c'], 'C 不能被候选覆盖');
  assert.strictEqual(sandbox.playQueue[0].id, 'b-qq', 'B 的替代版本必须落在 B 的新位置 0');
  assert.strictEqual(plays.length, 1);
  assert.strictEqual(plays[0].idx, 0, '起播必须用重新定位后的索引');
  assert.strictEqual(sandbox.playQueue[1], C, '其它队列项必须保持原对象');
}

// --- 2. 等待期间随机重排：候选写到新位置，其它项不变 ------------------------
async function testShuffleDuringWaitKeepsIdentity() {
  const A = song('a'), B = song('b'), C = song('c'), D = song('d');
  const sandbox = createPipelineSandbox([A, B, C, D]);
  sandbox.currentIdx = 1;
  const search = deferred();
  sandbox.searchAlternatePlatformSong = function () { return search.promise; };
  const plays = [];
  sandbox.playQueueAt = function (idx) { plays.push(idx); sandbox.currentIdx = idx; return Promise.resolve(true); };

  const pending = sandbox.tryAutoPlaybackFallback(B, { category: 'url_unavailable' }, 1, 1, {});
  await flush();

  // 模拟随机重排：B 被挪到末尾
  sandbox.playQueue.splice(sandbox.playQueue.indexOf(B), 1);
  sandbox.playQueue.push(B);
  sandbox.currentIdx = sandbox.playQueue.indexOf(B);

  search.resolve({ provider: 'qq', id: 'b-qq', name: B.name, artist: B.artist });
  const result = await withTimeout(pending, 'fallback after shuffle');

  assert.strictEqual(result, true);
  assert.deepStrictEqual(ids(sandbox.playQueue), ['a', 'c', 'd', 'b-qq']);
  assert.strictEqual(plays[0], 3, '候选必须写在 B 重排后的位置');
  assert.strictEqual(sandbox.playQueue[0], A);
  assert.strictEqual(sandbox.playQueue[1], C);
  assert.strictEqual(sandbox.playQueue[2], D);
}

// --- 3. 等待期间当前项被删除：不写任何槽位、不起播 --------------------------
async function testRemovedItemAbandonsFallback() {
  const A = song('a'), B = song('b'), C = song('c');
  const sandbox = createPipelineSandbox([A, B, C]);
  sandbox.currentIdx = 1;
  const search = deferred();
  sandbox.searchAlternatePlatformSong = function () { return search.promise; };
  const plays = [];
  sandbox.playQueueAt = function (idx) { plays.push(idx); return Promise.resolve(true); };

  const pending = sandbox.tryAutoPlaybackFallback(B, { category: 'url_unavailable' }, 1, 1, {});
  await flush();

  sandbox.playQueue.splice(1, 1); // 删掉正在等换源的 B
  sandbox.currentIdx = 0;

  search.resolve({ provider: 'qq', id: 'b-qq', name: B.name, artist: B.artist });
  const result = await withTimeout(pending, 'fallback after item removal');

  assert.strictEqual(result, false, '队列项已不在队列中必须放弃本次换源');
  assert.deepStrictEqual(ids(sandbox.playQueue), ['a', 'c'], '不得把候选写进别的槽位');
  assert.strictEqual(plays.length, 0, '不得起播任何曲目');
  assert.strictEqual(sandbox.activeSourceFallbackRecovery, null, '必须结算掉在途恢复事务');
}

// --- 4. 换源失败回滚：按身份定位，不信任旧 idx ------------------------------
async function testRollbackUsesLiveIndex() {
  const A = song('a'), B = song('b'), C = song('c');
  const sandbox = createPipelineSandbox([A, B, C]);
  sandbox.currentIdx = 1;
  const search = deferred();
  sandbox.searchAlternatePlatformSong = function () { return search.promise; };
  const plays = [];
  sandbox.playQueueAt = function (idx) { plays.push(idx); sandbox.currentIdx = idx; return Promise.resolve(false); };

  const pending = sandbox.tryAutoPlaybackFallback(B, { category: 'url_unavailable' }, 1, 1, {});
  await flush();

  // 重排：B 挪到末尾
  sandbox.playQueue.splice(sandbox.playQueue.indexOf(B), 1);
  sandbox.playQueue.push(B);
  sandbox.currentIdx = sandbox.playQueue.indexOf(B);

  search.resolve({ provider: 'qq', id: 'b-qq', name: B.name, artist: B.artist });
  await withTimeout(pending, 'fallback rollback');

  assert.deepStrictEqual(ids(sandbox.playQueue), ['a', 'c', 'b'], '候选失败后必须回滚成原曲，其它项不受影响');
  assert.strictEqual(sandbox.playQueue[2], B, '回滚必须落在 B 当前所在的位置');
  assert.strictEqual(plays[0], 2, '起播/回滚都用重排后的索引');
}

// --- 5. holdPaused 穿透换源：只加载、不出声 ---------------------------------
async function testHoldPausedSurvivesAutoFallback() {
  const A = song('a'), B = song('b');
  const sandbox = createPipelineSandbox([A, B]);
  sandbox.currentIdx = 1;
  sandbox.audio.src = 'proxy://origin://b';
  sandbox.audio.paused = true;
  sandbox.playing = false;
  const search = deferred();
  sandbox.searchAlternatePlatformSong = function () { return search.promise; };

  const pending = sandbox.tryAutoPlaybackFallback(B, { category: 'url_unavailable' }, 1, 1, { holdPaused: true });
  await flush();
  search.resolve({ provider: 'qq', id: 'b-qq', name: B.name, artist: B.artist });

  const result = await withTimeout(pending, 'holdPaused fallback');

  assert.strictEqual(result, true, '换源本身应当成功（音源已装载）');
  assert.strictEqual(sandbox.playQueue[1].id, 'b-qq', '候选版本必须落到队列');
  assert.deepStrictEqual(sandbox.playAudioCalls, [], '暂停意图必须穿透换源：不得调用起播');
  assert.strictEqual(sandbox.audio.paused, true, '换源后必须保持暂停');
  assert.strictEqual(sandbox.playing, false);
}

// --- 5b. 对照：非暂停场景仍然正常起播（确保上一条断言不是空的） ------------
async function testFallbackWithoutHoldPausedStillStarts() {
  const A = song('a'), B = song('b');
  const sandbox = createPipelineSandbox([A, B]);
  sandbox.currentIdx = 1;
  sandbox.audio.src = 'proxy://origin://b';
  sandbox.audio.paused = false;
  sandbox.playing = true;
  const search = deferred();
  sandbox.searchAlternatePlatformSong = function () { return search.promise; };

  const pending = sandbox.tryAutoPlaybackFallback(B, { category: 'url_unavailable' }, 1, 1, {});
  await flush();
  search.resolve({ provider: 'qq', id: 'b-qq', name: B.name, artist: B.artist });
  const result = await withTimeout(pending, 'fallback without holdPaused');

  assert.strictEqual(result, true);
  assert.strictEqual(sandbox.playAudioCalls.length, 1, '正常场景应当起播一次');
}

// --- 静态接线 --------------------------------------------------------------
function testWiring() {
  assert(/function sourceFallbackQueueIndexFor\(songs\)/.test(fallbackText), '必须按队列项身份定位');
  assert(/var commitIdx = sourceFallbackQueueIndexFor\(\[queueItemSong\]\)/.test(fallbackText), '提交前必须重新定位索引');
  assert(/playQueue\[commitIdx\] = nextCandidate/.test(fallbackText), '候选写入必须用重新定位的索引');
  assert(/holdPaused: !!opts\.holdPaused/.test(fallbackText), '换源播放参数必须保留暂停意图');
  assert(!/playQueue\[idx\] = committedCandidate/.test(fallbackText), '不得再直接信任旧 idx 写入');
}

async function run() {
  await testDeleteBeforeCurrentKeepsOtherItems();
  await testShuffleDuringWaitKeepsIdentity();
  await testRemovedItemAbandonsFallback();
  await testRollbackUsesLiveIndex();
  await testHoldPausedSurvivesAutoFallback();
  await testFallbackWithoutHoldPausedStillStarts();
  testWiring();
  console.log('OK playback-fallback-queue-identity');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
