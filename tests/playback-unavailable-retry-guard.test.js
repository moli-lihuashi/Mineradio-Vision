'use strict';

/* =============================================================================
 * 「播不了的曲目 + 反复点播放键」崩溃守卫（2026-11-12 第二个报障）
 *
 * 用户：「直接反复点击下一曲，碰到到播不了的反复点击播放就崩了」。
 *
 * 真机探针 scripts/probe-unavailable-track-click-crash.js 取证（隔离 profile + 真 exe，
 * 用确定性桩让取址失败 / 无其它音源，走真实的「不可用 → 终局」链路）：
 *   S1 连点 6 次下一曲：合流闸把 6 次点击合并成 2 轮 playQueueAt，每轮
 *       cancelSourceFallbackRecovery('new-root-playback') → 新建 recovery →
 *       settleSourceFallbackTerminal 清掉 audio.src。
 *   S2 逐次点播放键：
 *       click#1 playQueueAt 3→4 / ensureRecovery 2→3 / settleTerminal 2→3 / token 8→9
 *       click#2 playQueueAt 4→5 / ensureRecovery 3→4 / settleTerminal 3→4 / token 9→10
 *       click#3 页面重载（window.__crashSnap 消失）= 渲染进程崩溃。
 *   JS heap 只有 25→30MB，涨的是 three.js 纹理 / canvas 那类原生内存。
 *
 * 根因：settleSourceFallbackTerminal 把 audio.src 清空后，togglePlay 的
 * (!audio || !audio.src) 分支每次点击都完整重开一轮 root playback。
 *
 * 修复：复用 11-provider-fallback 已写下的 _lastPlaybackFailAt，给
 * 「刚判定不可用的曲目」加冷却 + 重试预算，把连点合并掉。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '..', 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function sliceRetry(text) {
  const start = text.indexOf('var UNAVAILABLE_RETRY_COOLDOWN_MS');
  const end = text.indexOf('function setPlayIcon(p)');
  assert.ok(start > 0, '找不到 UNAVAILABLE_RETRY_COOLDOWN_MS 声明');
  assert.ok(end > start, '找不到 setPlayIcon 边界');
  return text.slice(start, end);
}
const retrySource = sliceRetry(source);

function makeSandbox(opts) {
  const o = opts || {};
  let now = 1700000000000;
  const calls = { playQueueAt: 0, attemptAudioPlay: 0, fadeOutAndPauseAudio: 0, nextTrack: 0, toast: [] };
  const failedAt = o.failedAt == null ? null : now + o.failedAt;
  const queue = (o.queue || [
    { id: 'bad-a', name: 'A', _lastPlaybackFailAt: failedAt },
    { id: 'bad-b', name: 'B', _lastPlaybackFailAt: failedAt },
  ]).map((s) => Object.assign({}, s));
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    Promise, Number, String, Math, isFinite,
    Date: { now() { return now; } },
    audio: o.media || { src: '', ended: false, paused: true, currentTime: 0, duration: NaN },
    playToggleBusy: false, playing: false,
    playQueue: queue,
    currentIdx: 0,
    switchInProgress: !!o.switchInProgress,
    forcePlaybackControlsInteractive() {},
    hideLoading() {}, setPlayIcon() {},
    showToast(text) { calls.toast.push(String(text)); },
    updateListenStatsTick() {}, syncPlaybackStateFromAudioEvent() {},
    scheduleControlsHide() {}, savePlaybackSession() {},
    safePlaybackStep(label, fn) { try { return fn(); } catch (_) { return null; } },
    playbackTrackSwitchInProgress() { return sandbox.switchInProgress; },
    nextTrack() { calls.nextTrack += 1; },
    attemptAudioPlay() { calls.attemptAudioPlay += 1; return Promise.resolve(true); },
    playQueueAt() { calls.playQueueAt += 1; return Promise.resolve(true); },
    fadeOutAndPauseAudio() { calls.fadeOutAndPauseAudio += 1; return Promise.resolve(true); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(retrySource, sandbox, { filename: sourcePath });
  return {
    sandbox, calls,
    advance(ms) { now += ms; },
    retryState() { return JSON.parse(JSON.stringify(sandbox.unavailableRetryState)); },
  };
}

// ---- ① 静态守卫 -------------------------------------------------------------
test('① 无 src 分支必须先过不可用重试闸，且复现链接的失败标记', () => {
  const toggle = source.slice(source.indexOf('async function togglePlay()'), source.indexOf('function setPlayIcon(p)'));
  assert.match(toggle, /claimUnavailablePlaybackRetry\(\)/,
    '无 src 分支必须调用重试闸，否则每次点击都重开一轮 root playback');
  const guard = sliceRetry(source);
  assert.match(guard, /_lastPlaybackFailAt/,
    '必须复用 11-provider-fallback 写下的失败标记，不要另造存档字段');
  assert.match(guard, /UNAVAILABLE_RETRY_BUDGET/);
  assert.match(guard, /UNAVAILABLE_RETRY_COOLDOWN_MS/);
  assert.match(guard, /forcePlaybackControlsInteractive\(\);\s*return;/,
    '被合并掉的点击也要把控件恢复可交互，不能把界面钉成禁用态');
  assert.match(guard, /showToast\(/, '预算耗尽时只提示一次，别静默吞掉用户点击');
});

// ---- ② 正常曲目零回归 -------------------------------------------------------
test('② 正常曲目（无失败标记）连点播放键完全不受限制', async () => {
  const ctx = makeSandbox({ queue: [{ id: 'ok-a' }, { id: 'ok-b' }] });
  for (let i = 0; i < 3; i += 1) await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 3, '正常曲目每次点击都该照常发起起播');
  assert.equal(ctx.calls.toast.length, 0, '正常曲目不该弹「播不了」提示');
});

// ---- ③ 冷却合并 -------------------------------------------------------------
test('③ 刚判定不可用的曲目：连点 5 次只重开一轮 root playback', async () => {
  const ctx = makeSandbox({ failedAt: 0 });
  for (let i = 0; i < 5; i += 1) await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 1,
    '真机是 3 轮就崩；连点必须被冷却合并成 1 轮，实际 ' + ctx.calls.playQueueAt);
  assert.equal(ctx.calls.toast.length, 0, '冷却窗口内属于连点合并，不该刷提示');
  const st = ctx.retryState();
  assert.equal(st.count, 1, '只消耗一次重试预算');
  assert.equal(st.key, 'bad-a');
});

test('④ 冷却窗口内的后续点击一律合并', async () => {
  const ctx = makeSandbox({ failedAt: 0 });
  await ctx.sandbox.togglePlay();
  ctx.advance(1000);
  await ctx.sandbox.togglePlay();
  ctx.advance(1000);
  await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 1);
});

// ---- ⑤ 预算与提示 -----------------------------------------------------------
test('⑤ 冷却过后预算已耗尽：不再重开，且只提示一次', async () => {
  const ctx = makeSandbox({ failedAt: 0 });
  await ctx.sandbox.togglePlay();
  ctx.advance(3100);
  await ctx.sandbox.togglePlay();
  await ctx.sandbox.togglePlay();
  await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 1, '预算不能因为时间流逝被绕过');
  assert.equal(ctx.calls.toast.length, 1, '提示只弹一次，别把 toast 刷屏');
  assert.match(ctx.calls.toast[0], /播不了/);
});

// ---- ⑥ 有效期与换曲目 -------------------------------------------------------
test('⑥ 失败标记过期后恢复可重试（网络/登录态好了仍能重试）', async () => {
  const ctx = makeSandbox({ failedAt: 0 });
  await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 1);
  ctx.advance(18100);
  await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 2, '18s 失败窗口过后不应被旧预算永久挡住');
  assert.equal(ctx.retryState().key, '', '正常曲目应把重试状态清干净');
});

test('⑦ 切到另一首失败曲目时预算重置', async () => {
  const ctx = makeSandbox({ failedAt: 0 });
  await ctx.sandbox.togglePlay();
  ctx.advance(3100);
  ctx.sandbox.currentIdx = 1;
  await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 2, '换曲目是新的一次尝试，不该被上一首的预算挡住');
  assert.equal(ctx.retryState().key, 'bad-b');
});

// ---- ⑧ 其它分支零回归 -------------------------------------------------------
test('⑧ 曲末态 / 普通暂停 / 播放中暂停分支不受重试闸影响', async () => {
  const ended = { src: 'x', ended: true, paused: true, currentTime: 200, duration: 200 };
  const a = makeSandbox({ failedAt: 0, media: ended, queue: [{ id: 'a' }, { id: 'b' }] });
  await a.sandbox.togglePlay();
  assert.equal(a.calls.nextTrack, 1, '曲末态仍应立刻切歌');
  assert.equal(a.calls.playQueueAt, 0);

  const paused = { src: 'x', ended: false, paused: true, currentTime: 10, duration: 200 };
  const b = makeSandbox({ failedAt: 0, media: paused });
  await b.sandbox.togglePlay();
  assert.equal(b.calls.attemptAudioPlay, 1, '普通暂停仍走 attemptAudioPlay');
  assert.equal(b.calls.playQueueAt, 0);

  const playingMedia = { src: 'x', ended: false, paused: false, currentTime: 10, duration: 200 };
  const c = makeSandbox({ failedAt: 0, media: playingMedia });
  await c.sandbox.togglePlay();
  assert.equal(c.calls.fadeOutAndPauseAudio, 1, '播放中仍只是暂停');
});

test('⑨ 辅助判据边界：duration 非法 / 空队列 / 越界索引都不误判', () => {
  const ctx = makeSandbox({ failedAt: 0 });
  const f = ctx.sandbox.unavailableTrackJustFailed;
  assert.equal(f(null), false);
  assert.equal(f({}), false);
  assert.equal(f({ _lastPlaybackFailAt: 1700000000000 }), true);
  ctx.advance(18100);
  assert.equal(f({ _lastPlaybackFailAt: 1700000000000 }), false, '超过失败窗口就不算「刚失败」');

  ctx.sandbox.playQueue.length = 0;
  assert.equal(ctx.sandbox.unavailableRetryCurrentSong(), null);
  ctx.sandbox.playQueue.push({ id: 'x' });
  ctx.sandbox.currentIdx = 9;
  assert.equal(ctx.sandbox.unavailableRetryCurrentSong(), null);
});

// ---- ⑩ 酷狗「未返回歌曲」快速通道与播放键的衔接 ---------------------------
test('⑩ 酷狗刚明确未返回歌曲：连点播放键只提示，不重开 root playback', async () => {
  const ctx = makeSandbox({
    queue: [
      { id: 'k0', name: 'K0', _kugouUnavailableAt: 1700000000000 - 1000 },
      { id: 'k1', name: 'K1' },
    ],
  });
  for (let i = 0; i < 4; i += 1) await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 0,
    '连点不能重置跳过链再跑一整串自动跳（真机实测曾 ΔplayQueueAt=6）');
  assert.equal(ctx.calls.toast.length, 1, '连点只提示一次，不刷屏');
  assert.match(ctx.calls.toast[0], /酷狗未返回歌曲/);
});

test('⑪ 短时效标记过期后仍允许正常重试（不永久锁死）', async () => {
  const ctx = makeSandbox({
    queue: [
      { id: 'k0', name: 'K0', _kugouUnavailableAt: 1700000000000 - 19000 },
      { id: 'k1', name: 'K1' },
    ],
  });
  await ctx.sandbox.togglePlay();
  assert.equal(ctx.calls.playQueueAt, 1, '窗口过期后要能重新尝试');
});
