'use strict';

/* =============================================================================
 * A1 媒体元素错误分类 — 行为测试
 *
 * 跑真实源码切片（09e + 09d 合并进 vm），断言的是「看门狗有没有被安排」，
 * 不是源码里有没有某行文字。旧行为里 MEDIA_ERR_ABORTED 也会安排恢复定时器，
 * 随后的软重试会打断新一次起播的 play()。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const classifierSrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/05-playback/09e-media-failure-classifier.js'), 'utf8');
const recoverySrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/05-playback/09d-playback-stall-recovery.js'), 'utf8');

function loadCombined(extra, withClassifier) {
  const src = (withClassifier === false ? '' : classifierSrc + '\n') + recoverySrc;
  const timers = [];
  const sandbox = Object.assign({
    console,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    document: { getElementById: () => null },
    performance: { now: () => 0 },
    showLoading() {}, hideLoading() {},
    showSourceFallbackNotice() {}, showToast() {},
    forcePlaybackControlsInteractive() {},
    playQueueAt: async () => true,
    PLAYBACK_RESUME_STALL_DELAYS: [1600, 3600],
    PLAYBACK_RESUME_LONG_PAUSE_MS: 8 * 60 * 1000,
    PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS: {},
    trackSwitchToken: 7,
    playQueue: [],
    currentIdx: -1,
    audio: null,
    playbackResumeRecovery: {
      timerIds: [], serial: 0, buffering: false, pending: false,
      lastAttemptAt: 0, freshUrlAttemptCount: 0, softRetryCount: 0, pausedAt: 0,
    },
  }, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, timers };
}

function mediaWith(code, src) {
  return {
    error: code == null ? null : { code },
    currentSrc: src || 'http://cdn.example/a.mp3',
    src: src || 'http://cdn.example/a.mp3',
    networkState: 3,
    readyState: 0,
  };
}

test('MEDIA_ERR_ABORTED 归类为用户操作中断，没有恢复资格', () => {
  const { sandbox } = loadCombined({});
  const v = sandbox.classifyMediaElementFailure({ code: 1 }, 'http://cdn/a.mp3');
  assert.equal(v.kind, 'aborted');
  assert.equal(v.eligibleForRecovery, false);
});

test('network / decode / unsupported 都有恢复资格，unknown 保守不恢复', () => {
  const { sandbox } = loadCombined({});
  for (const [code, kind] of [[2, 'network'], [3, 'decode'], [4, 'unsupported']]) {
    const v = sandbox.classifyMediaElementFailure({ code }, 'http://cdn/a.mp3');
    assert.equal(v.kind, kind);
    assert.equal(v.eligibleForRecovery, true);
  }
  const unknown = sandbox.classifyMediaElementFailure(null, '');
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.eligibleForRecovery, false);
});

test('恢复产物仍报 unsupported 时不再换源，避免循环', () => {
  const { sandbox } = loadCombined({});
  const v = sandbox.classifyMediaElementFailure(
    { code: 4 }, 'http://cdn/a.mp3?mineradio-recovered=1');
  assert.equal(v.kind, 'unsupported');
  assert.equal(v.eligibleForRecovery, false);
});

test('waiting / stalled 与读不到 MediaError 的情况都不被新闸门否决', () => {
  const { sandbox } = loadCombined({});
  assert.equal(sandbox.mediaFailureBlocksStallRecovery('waiting', mediaWith(1)), false);
  assert.equal(sandbox.mediaFailureBlocksStallRecovery('stalled', mediaWith(1)), false);
  assert.equal(sandbox.mediaFailureBlocksStallRecovery('error', mediaWith(null)), false);
  assert.equal(sandbox.mediaFailureBlocksStallRecovery('error', null), false);
});

test('行为：切歌产生的 aborted 不安排任何恢复定时器', () => {
  const media = mediaWith(1);
  const { sandbox, timers } = loadCombined({ audio: media });
  sandbox.schedulePlaybackStallRecovery('error', { ownerMedia: media, silent: true });
  assert.equal(timers.length, 0, 'aborted 绝不能触发软重试 / 重新取链');
  assert.equal(sandbox.playbackResumeRecovery.serial, 0, '看门狗序号不应自增');
});

test('行为：真实的 network 错误仍保留原有卡顿恢复能力', () => {
  const media = mediaWith(2);
  const { sandbox, timers } = loadCombined({ audio: media });
  sandbox.schedulePlaybackStallRecovery('error', { ownerMedia: media, silent: true });
  assert.equal(timers.length, 2, '两档延迟看门狗照常安排');
  assert.equal(sandbox.playbackResumeRecovery.timerIds.length, 2);
});

test('行为：waiting 事件不受分类闸门影响', () => {
  const media = mediaWith(1);
  const { sandbox, timers } = loadCombined({ audio: media });
  sandbox.schedulePlaybackStallRecovery('waiting', { ownerMedia: media, silent: true });
  assert.equal(timers.length, 2);
});

test('行为：分类器缺席时 typeof 兜底，恢复能力不被关掉', () => {
  const media = mediaWith(1);
  const { sandbox, timers } = loadCombined({ audio: media }, false);
  sandbox.schedulePlaybackStallRecovery('error', { ownerMedia: media, silent: true });
  assert.equal(timers.length, 2);
});
