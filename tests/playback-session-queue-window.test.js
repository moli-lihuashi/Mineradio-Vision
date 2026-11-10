'use strict';

// =============================================================================
// 播放会话快照：队列窗口 / 索引 / 曲目身份必须一致（回归）
// 旧实现：只持久化队列前 120 首，却保存完整队列里的绝对 currentIdx；
// 恢复时把越界索引夹到 119，于是「播放第 151 首」恢复成了「第 120 首 + 77 秒」。
// 现在要求：持久化窗口必须包含当前曲目，索引与窗口对应；
// 历史快照（无 queueStart / 索引越界）也必须按 session.song 恢复同一首歌。
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const sessionPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '00c-home-session.js');
const source = fs.readFileSync(sessionPath, 'utf8');

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function createSandbox() {
  const storage = createStorage();
  const calls = [];
  const sandbox = {
    console,
    Promise,
    JSON,
    Object,
    Array,
    String,
    Number,
    Date,
    Math,
    isFinite,
    localStorage: storage,
    PLAYBACK_SESSION_STORE_KEY: 'mineradio-playback-session-v1',
    playQueue: [],
    currentIdx: -1,
    playing: false,
    playMode: 'loop',
    playbackSessionSaveTimer: 0,
    startupAutoplayPreference: false,
    audio: { currentTime: 0, duration: 200 },
    calls,
    playQueueAt: async function (idx, opts) {
      calls.push({ idx, opts });
      return true;
    },
    safeRenderQueuePanel() {},
    showToast() {},
    syncContinueCard() {},
    setPreset() {},
    cloneSong(song) { return Object.assign({}, song); },
    queueItemKey(song) {
      if (!song) return '';
      return (song.provider || '') + ':' + (song.id || '');
    },
    getPlaybackDurationSeconds() { return 200; },
    normalizePlaybackDurationSeconds(value) { return Number(value) || 200; },
    clampRange(value, min, max) { return Math.min(Math.max(value, min), max); },
    fx: { preset: 2 },
    document: {
      getElementById() {
        const classes = new Set();
        return {
          textContent: '',
          style: {},
          classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            toggle(name, force) { if (force === undefined) { classes.has(name) ? classes.delete(name) : classes.add(name); } else if (force) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); },
          },
          setAttribute() {},
          removeAttribute() {},
        };
      },
      body: { appendChild() {}, classList: { contains() { return false; } } },
    },
    getContinuePresentation() { return null; },
    setHomeArt() {},
    homePlatformKey() { return ''; },
    homePlatformShortLabel() { return ''; },
    formatPlaybackResumeTime(value) { return String(value); },
    formatContinueCardSub() { return ''; },
    continueProgressPercent() { return 0; },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: sessionPath });
  // 该模块自身也声明了这两个函数（依赖首页/听歌统计运行时），这里替换为无副作用桩，
  // 测试只关注「队列 + 索引 + 进度」的对应关系。
  sandbox.getContinuePresentation = function () { return null; };
  sandbox.syncContinueCard = function () { return false; };
  return { sandbox, storage };
}

function buildQueue(count) {
  const queue = [];
  for (let i = 0; i < count; i++) {
    queue.push({
      provider: 'netease',
      id: 'song-' + i,
      name: 'Song ' + i,
      artist: 'Artist ' + i,
      duration: 200,
    });
  }
  return queue;
}

function readStored(storage) {
  return JSON.parse(storage.getItem('mineradio-playback-session-v1') || 'null');
}

async function restoreAndCapture(sandbox, session, opts) {
  sandbox.calls.length = 0;
  sandbox.playQueue = [];
  sandbox.currentIdx = -1;
  sandbox.playing = false;
  const ok = await sandbox.applyPlaybackSession(session, Object.assign({ toast: false, force: true }, opts || {}));
  const last = sandbox.calls[sandbox.calls.length - 1];
  return { ok, call: last, queue: sandbox.playQueue, currentIdx: sandbox.currentIdx };
}

// --- 第 151 首：窗口必须包含当前曲目 ---------------------------------------
async function testWindowIncludesCurrentTrackFarDown() {
  const { sandbox, storage } = createSandbox();
  sandbox.playQueue = buildQueue(160);
  sandbox.currentIdx = 150;
  sandbox.audio.currentTime = 77;

  sandbox.savePlaybackSession(true);
  const stored = readStored(storage);

  assert(stored, '必须写入快照');
  assert.strictEqual(stored.currentIdx, 150, '快照必须记录绝对索引');
  assert.strictEqual(stored.queue.length, 120, '队列数量上限保持 120');
  assert.strictEqual(typeof stored.queueStart, 'number', '必须记录窗口起点');
  assert.strictEqual(stored.queueStart, 40, '窗口应以当前曲目为中心并夹到合法起点');
  assert.strictEqual(stored.queue[stored.currentIdx - stored.queueStart].id, 'song-150', '窗口内必须包含当前曲目');

  const result = await restoreAndCapture(sandbox, stored);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.call.idx, stored.currentIdx - stored.queueStart);
  assert.strictEqual(result.queue[result.call.idx].id, 'song-150', '恢复后必须仍是第 151 首');
  assert.strictEqual(result.call.opts.resumeAt, 77, '进度必须属于同一首歌');
}

// --- 第 120 / 121 首边界 ---------------------------------------------------
async function testWindowAtLimitBoundaries() {
  for (const index of [119, 120]) {
    const { sandbox, storage } = createSandbox();
    sandbox.playQueue = buildQueue(160);
    sandbox.currentIdx = index;
    sandbox.audio.currentTime = 42;
    sandbox.savePlaybackSession(true);
    const stored = readStored(storage);

    assert.strictEqual(stored.queue.length, 120);
    assert.strictEqual(stored.queue[stored.currentIdx - stored.queueStart].id, 'song-' + index);

    const result = await restoreAndCapture(sandbox, stored);
    assert.strictEqual(result.queue[result.call.idx].id, 'song-' + index, '第 ' + (index + 1) + ' 首必须恢复成自己');
    assert.strictEqual(result.call.opts.resumeAt, 42);
  }
}

// --- 历史快照：索引越界时必须按 session.song 恢复 --------------------------
async function testLegacySnapshotOutOfRangeIndex() {
  const { sandbox } = createSandbox();
  const legacy = {
    version: 2,
    song: { provider: 'netease', id: 'song-150', name: 'Song 150', artist: 'Artist 150', duration: 200 },
    currentIdx: 150,
    currentTime: 77,
    queue: buildQueue(120).slice(0, 120),
    updatedAt: 1,
  };

  const result = await restoreAndCapture(sandbox, legacy);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.queue[result.call.idx].id, 'song-150', '历史快照也不能恢复成第 120 首');
  assert.strictEqual(result.call.opts.resumeAt, 77, '进度必须跟上同一首歌');
  assert.strictEqual(result.currentIdx, result.call.idx);
}

// --- 历史快照：索引错位但歌在窗口内，按身份校正 ----------------------------
async function testLegacySnapshotIndexMismatchUsesSongIdentity() {
  const { sandbox } = createSandbox();
  const queue = buildQueue(120);
  const legacy = {
    version: 2,
    song: queue[30],
    currentIdx: 119,
    currentTime: 55,
    queue: queue,
    updatedAt: 1,
  };

  const result = await restoreAndCapture(sandbox, legacy);

  assert.strictEqual(result.queue[result.call.idx].id, 'song-30', '应以 session.song 的身份为准');
  assert.strictEqual(result.call.opts.resumeAt, 55);
}

// --- 历史快照：当前曲目就在窗口里且索引越界 --------------------------------
async function testLegacySnapshotFindsSongByKey() {
  const { sandbox } = createSandbox();
  const queue = buildQueue(120);
  const legacy = {
    version: 2,
    song: queue[119],
    currentIdx: 900,
    currentTime: 12,
    queue: queue,
    updatedAt: 1,
  };

  const result = await restoreAndCapture(sandbox, legacy);

  assert.strictEqual(result.queue[result.call.idx].id, 'song-119');
  assert.strictEqual(result.call.opts.resumeAt, 12);
}

// --- 新快照：song 与窗口索引不一致时仍以身份为准 ---------------------------
async function testNewSnapshotSongWins() {
  const { sandbox } = createSandbox();
  const queue = buildQueue(160);
  const snapshot = {
    version: 3,
    song: queue[130],
    currentIdx: 130,
    queueStart: 40,
    currentTime: 33,
    queue: queue.slice(40, 160),
    updatedAt: 1,
  };

  const result = await restoreAndCapture(sandbox, snapshot);
  assert.strictEqual(result.queue[result.call.idx].id, 'song-130');
  assert.strictEqual(result.call.opts.resumeAt, 33);
}

// --- 空队列 / 缺 song 的兜底 -----------------------------------------------
async function testDegenerateSnapshot() {
  const { sandbox } = createSandbox();
  const result = await restoreAndCapture(sandbox, {
    version: 3,
    song: { provider: 'netease', id: 'only', name: 'Only', artist: 'A' },
    currentIdx: 7,
    queueStart: 0,
    currentTime: 9,
    queue: [],
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.queue.length, 1);
  assert.strictEqual(result.queue[0].id, 'only');
  assert.strictEqual(result.call.idx, 0);
  assert.strictEqual(result.call.opts.resumeAt, 9);
}

// --- 缓存不应在索引变化后返回旧窗口 ----------------------------------------
async function testQueueCacheHonoursWindowStart() {
  const { sandbox, storage } = createSandbox();
  sandbox.playQueue = buildQueue(160);
  sandbox.currentIdx = 10;
  sandbox.audio.currentTime = 20;
  sandbox.savePlaybackSession(true);
  const first = readStored(storage);

  sandbox.currentIdx = 150;
  sandbox.audio.currentTime = 30;
  sandbox.savePlaybackSession(true);
  const second = readStored(storage);

  assert.strictEqual(first.queueStart, 0);
  assert.strictEqual(second.queueStart, 40);
  assert.strictEqual(second.queue[second.currentIdx - second.queueStart].id, 'song-150');
}

async function run() {
  await testWindowIncludesCurrentTrackFarDown();
  await testWindowAtLimitBoundaries();
  await testLegacySnapshotOutOfRangeIndex();
  await testLegacySnapshotIndexMismatchUsesSongIdentity();
  await testLegacySnapshotFindsSongByKey();
  await testNewSnapshotSongWins();
  await testDegenerateSnapshot();
  await testQueueCacheHonoursWindowStart();
  console.log('OK playback-session-queue-window');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
