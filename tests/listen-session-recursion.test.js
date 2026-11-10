'use strict';

/* =============================================================================
 * 收听会话计量的重入回归
 *
 * 原始 BUG：finalizeListenSession 先用 listenSession 统计、再把它置空，而统计走的
 * updateListenStatsTick 在「当前曲目 ≠ 会话曲目」时会调 beginListenSession，后者又回头
 * 调 finalizeListenSession —— 三者互递归。切歌时 currentIdx 已经前进、listenSession 还
 * 记着上一首，正好命中：实测 1687 层后 RangeError，异常被 safePlaybackStep 吞掉，
 * 换源链路半途中断（audio.src 被清空，界面停在「播放失败」）。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '01-cover-listen-helpers.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function createSandbox(options) {
  const opts = options || {};
  const stats = { beginCalls: 0, finalizeCalls: 0, maxNesting: 0 };
  let nesting = 0;
  const queue = [
    { id: 'a', name: 'A', artist: 'x', provider: 'kugou', hash: 'HASHA' },
    { id: 'b', name: 'B', artist: 'y', provider: 'kugou', hash: 'HASHB' },
  ];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    isFinite,
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    // 播放器状态
    audio: opts.audio || { duration: 200, paused: false, currentTime: 12 },
    playQueue: queue,
    currentIdx: 0,
    activeRadioContext: null,
    emptyHomeActive: false,
    // 依赖桩（listenSession / listenStatsState / currentCoverSong 由 00-state 与播放核心提供）
    listenSession: null,
    listenStatsState: { history: [], songs: {}, artists: {}, updatedAt: 0 },
    currentCoverSong() { return queue[sandbox.currentIdx] || null; },
    CUSTOM_COVER_STORE_KEY: 'mineradio-custom-cover-v1',
    customCoverMap: {},
    queueItemKey(song) { return song && (song.hash ? 'kugou:' + song.hash : 'song:' + song.id); },
    songCoverSrc() { return ''; },
    songSourceLabel() { return '酷狗音乐'; },
    renderHomeDiscover() {},
    updateListenStatsTick: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: sourcePath });

  // 包一层计数：验证「统计链路里不会再回到 finalize」
  const realBegin = sandbox.beginListenSession;
  const realFinalize = sandbox.finalizeListenSession;
  sandbox.beginListenSession = function () {
    stats.beginCalls += 1;
    nesting += 1;
    stats.maxNesting = Math.max(stats.maxNesting, nesting);
    try { return realBegin.apply(this, arguments); } finally { nesting -= 1; }
  };
  sandbox.finalizeListenSession = function () {
    stats.finalizeCalls += 1;
    nesting += 1;
    stats.maxNesting = Math.max(stats.maxNesting, nesting);
    try { return realFinalize.apply(this, arguments); } finally { nesting -= 1; }
  };
  sandbox.__stats = stats;
  return sandbox;
}

test('finalizing a session for the previous track does not recurse into itself', () => {
  const sandbox = createSandbox();
  // 上一首的会话还在，但 currentIdx 已经切到下一首了 —— 切歌瞬间就是这个状态
  sandbox.listenSession = {
    key: 'kugou:HASHA',
    song: { name: 'A', hash: 'HASHA' },
    startedAt: Date.now(),
    lastWallAt: Date.now(),
    lastAudioTime: 10,
    listenMs: 1000,
    maxProgress: 0.1,
  };
  sandbox.currentIdx = 1;

  assert.doesNotThrow(() => sandbox.finalizeListenSession(false),
    '切歌时结算上一首会话不得抛 RangeError（互递归会打穿调用栈）');
  assert.equal(sandbox.listenSession, null, '结算后会话必须清空');
  assert.ok(sandbox.__stats.maxNesting <= 3,
    '统计链路不得反复回到 finalize，实际嵌套 ' + sandbox.__stats.maxNesting + ' 层');
});

test('ticking while the current track changed closes the old session exactly once', () => {
  const sandbox = createSandbox();
  sandbox.listenSession = {
    key: 'kugou:HASHA',
    song: { name: 'A', hash: 'HASHA' },
    startedAt: Date.now(),
    lastWallAt: Date.now(),
    lastAudioTime: 10,
    listenMs: 5000,
    maxProgress: 0.2,
  };
  sandbox.currentIdx = 1;

  sandbox.updateListenStatsTick(true);
  assert.equal(sandbox.__stats.maxNesting <= 3, true,
    'tick 换会话时只能 finalize 一次，实际嵌套 ' + sandbox.__stats.maxNesting);
  sandbox.updateListenStatsTick(true);
  sandbox.updateListenStatsTick(true);
  assert.equal(sandbox.__stats.maxNesting <= 3, true, '连续 tick 也不得累积嵌套');
  assert.ok(sandbox.listenSession && sandbox.listenSession.key === 'kugou:HASHB',
    '换歌后会话应指向新曲目');
});

test('the finished session still records the listen time it had accumulated', () => {
  const sandbox = createSandbox();
  sandbox.listenSession = {
    key: 'kugou:HASHA',
    song: { name: 'A', hash: 'HASHA' },
    startedAt: Date.now() - 60000,
    lastWallAt: Date.now() - 1000,
    lastAudioTime: 50,
    listenMs: 44000,   // 再补 1.5s 就过 45s 有效阈值
    maxProgress: 0.3,
  };
  sandbox.audio.currentTime = 51.5; // 又听了 1.5s
  sandbox.currentIdx = 1;
  const before = sandbox.listenSession.listenMs;
  sandbox.finalizeListenSession(false);
  // 会话被清空，但时长已经写进听歌统计
  const history = (sandbox.listenStatsState.history || []);
  assert.equal(history.length, 1, '超过 45s 的会话应落一条历史');
  assert.ok(history[0].listenMs > before, '结算时要把最后一段时长补进 listenMs');
});

test('a paused media element is not counted as listening', () => {
  const sandbox = createSandbox({ audio: { duration: 200, paused: true, currentTime: 12 } });
  sandbox.listenSession = null;
  sandbox.updateListenStatsTick(true);
  assert.equal(sandbox.listenSession, null, '暂停状态不该凭空开会话');
});
