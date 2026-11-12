'use strict';

// QQ 登录窗口收尾判定的单测。
// 守的是 2026-11-13 实号反馈的 bug：账号登录成功但没有播放态 key 时，
// 窗口 Promise 永不 resolve → QQ 音乐窗口停在 player 页、登录弹窗也不退。

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideQQLoginOutcome, DEFAULT_PARTIAL_GRACE_MS } = require('../server/lib/qq-login-decision');

test('拿到播放态 key 就立刻 done（完整成功）', () => {
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: true, hasLogin: true, warmupStarted: true, warmupAt: 1, now: 2,
  }), 'done');
  // 播放态 key 优先于一切，哪怕还没 warmup
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: true, hasLogin: false, warmupStarted: false, warmupAt: 0, now: 0,
  }), 'done');
});

test('还没登录就继续等（不关窗、不导航）', () => {
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: false, hasLogin: false, warmupStarted: false, warmupAt: 0, now: Date.now(),
  }), 'wait');
});

test('已登录但没 warmup 过 → 先导航播放页', () => {
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: false, hasLogin: true, warmupStarted: false, warmupAt: 0, now: Date.now(),
  }), 'warmup');
});

test('warmup 后在宽限内继续等播放态 key', () => {
  const now = 1_000_000;
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: false, hasLogin: true, warmupStarted: true,
    warmupAt: now - (DEFAULT_PARTIAL_GRACE_MS - 1), now,
  }), 'wait');
});

test('warmup 后超过宽限仍无播放态 key → partial 收尾（这是本次 bug 的修复点）', () => {
  const now = 1_000_000;
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: false, hasLogin: true, warmupStarted: true,
    warmupAt: now - DEFAULT_PARTIAL_GRACE_MS, now,
  }), 'partial');
  // 自定义宽限也生效
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: false, hasLogin: true, warmupStarted: true,
    warmupAt: now - 100, now, graceMs: 50,
  }), 'partial');
});

test('warmupAt 缺失时不会误判 partial（防止参数缺失导致立刻关窗）', () => {
  assert.equal(decideQQLoginOutcome({
    hasPlaybackKey: false, hasLogin: true, warmupStarted: true, warmupAt: 0, now: Date.now(),
  }), 'wait');
});
