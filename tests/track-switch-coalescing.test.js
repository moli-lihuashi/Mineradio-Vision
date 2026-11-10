'use strict';

/* =============================================================================
 * 连点下一曲的合流闸（requestTrackSwitch / drainTrackSwitches）
 *
 * 原始 BUG：每次点击都直接起一次 playQueueAt。连点 6 下 = 6 个并行取址请求，
 * 实测 /api/song/url 耗时随点击线性恶化（103→190→225→791→1693→4196ms），
 * 最后一个请求拿到地址时已经排到 4s 之后，起播失败后还走「没有可用音源」分支
 * 把 audio.src 清掉 —— 表现就是「快速点下一曲有概率播放失败且彻底没声音」。
 *
 * 现在的语义：点击只登记最新目标，同一时刻只有一次换源在飞，中间被跨过的曲目不发请求。
 * 这里直接跑真实源码里的这几个函数（从 13-playback-start-audio.js 切出来），
 * 用可控的 playQueueAt 桩验证调用次数与最终目标。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function sliceScheduler(text) {
  const start = text.indexOf('var pendingTrackSwitch = null;');
  assert.ok(start > 0, '找不到 pendingTrackSwitch 声明，切歌合流闸被改过');
  const end = text.indexOf('function releaseQueuePlaybackMedia');
  assert.ok(end > start, '找不到 releaseQueuePlaybackMedia 边界');
  return text.slice(start, end);
}

const schedulerSource = sliceScheduler(source);

function createSandbox(queueLength, options) {
  const opts = options || {};
  const calls = [];
  const pending = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Promise,
    Number,
    String,
    Math,
    isFinite,
    playMode: opts.playMode || 'loop',
    playQueue: Array.from({ length: queueLength }, (_, i) => ({ id: 's' + i, name: 'S' + i })),
    currentIdx: opts.currentIdx == null ? 0 : opts.currentIdx,
    trackSwitchToken: 0,
    playToggleBusy: false,
    forcePlaybackControlsInteractive() {},
    scenePlaybackContextForTrackSwitch() { return null; },
    playQueueAt(idx, playOpts) {
      calls.push(idx);
      if (typeof sandbox.__onPlayQueueAt === 'function') sandbox.__onPlayQueueAt(idx, playOpts);
      const slot = {};
      slot.promise = new Promise((resolve) => { slot.resolve = resolve; });
      pending.push(slot);
      return slot.promise;
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(schedulerSource, sandbox, { filename: sourcePath });
  return {
    sandbox,
    calls,
    resolveAll(value) {
      while (pending.length) pending.shift().resolve(value === undefined ? true : value);
    },
    resolveOne(value) {
      const slot = pending.shift();
      if (slot) slot.resolve(value === undefined ? true : value);
      return !!slot;
    },
    pendingCount: () => pending.length,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('six rapid next clicks collapse into one request for the final target', async () => {
  const ctx = createSandbox(10);
  for (let i = 0; i < 6; i += 1) ctx.sandbox.nextTrack();
  assert.equal(ctx.sandbox.currentIdx, 6, '点几下就前进几首（界面索引要跟手）');
  assert.deepEqual(ctx.calls, [1], '连点期间只允许一次换源在飞，实际 ' + JSON.stringify(ctx.calls));

  ctx.resolveAll(true);
  await flush();
  assert.deepEqual(ctx.calls, [1, 6], '在飞那次落地后只补跑最后一个目标，实际 ' + JSON.stringify(ctx.calls));

  ctx.resolveAll(true);
  await flush();
  assert.equal(ctx.calls.length, 2, '中间被跨过的曲目不得再发请求，实际 ' + JSON.stringify(ctx.calls));
});

test('a click that lands while a switch is in flight supersedes it', async () => {
  const ctx = createSandbox(10);
  ctx.sandbox.nextTrack();
  const tokenAfterFirst = ctx.sandbox.trackSwitchToken;
  assert.equal(ctx.calls.length, 1);

  ctx.sandbox.nextTrack();
  assert.ok(ctx.sandbox.trackSwitchToken > tokenAfterFirst,
    '新点击必须让在飞的那次立刻失去归属，否则它会把中间那首装载进去');
  assert.equal(ctx.calls.length, 1, '在飞期间不许再起第二个请求');
});

test('the last requested index always wins, even with clicks interleaved with settles', async () => {
  const ctx = createSandbox(7);
  let lastRequested = 0;
  // 0/1/1/0/1 的节拍：有的点击落在换源途中，有的落在刚结算后
  const beats = [1, 1, 0, 1, 1, 0];
  for (const settle of beats) {
    for (let i = 0; i < 3; i += 1) {
      const before = ctx.sandbox.currentIdx;
      ctx.sandbox.nextTrack();
      const after = ctx.sandbox.currentIdx;
      lastRequested = after;
      assert.equal(after, (before + 1) % 7, 'nextTrack 必须按队列长度推进索引');
    }
    if (settle) { ctx.resolveAll(true); await flush(); }
  }
  // 收尾：把剩下的都放行
  for (let i = 0; i < 6; i += 1) { ctx.resolveAll(true); await flush(); }

  assert.ok(ctx.calls.length > 0, '最终必须真的起一次换源');
  assert.equal(ctx.calls[ctx.calls.length - 1], lastRequested,
    '最后一次换源必须落在用户最后点到的曲目上，实际 ' + JSON.stringify(ctx.calls));
  assert.ok(ctx.calls.length < 18, '18 次点击不该发 18 个请求，实际 ' + ctx.calls.length);
});

test('an empty or out of range queue never starts a switch', async () => {
  const empty = createSandbox(0);
  empty.sandbox.nextTrack();
  assert.deepEqual(empty.calls, [], '队列为空时点下一曲不应发请求');

  const one = createSandbox(1);
  one.sandbox.nextTrack();
  one.sandbox.nextTrack();
  assert.deepEqual(one.calls, [0], '单曲队列连点也只该起一次换源');
  assert.equal(one.sandbox.currentIdx, 0, '单曲队列的索引应当绕回自己');
});

test('a pending target that disappeared while queued is dropped instead of loaded', async () => {
  const ctx = createSandbox(10);
  for (let i = 0; i < 4; i += 1) ctx.sandbox.nextTrack();
  assert.deepEqual(ctx.calls, [1]);
  // 排队期间队列被清空（clearQueue / 换队列）
  ctx.sandbox.playQueue.length = 0;
  ctx.resolveAll(true);
  await flush();
  ctx.resolveAll(true);
  await flush();
  assert.deepEqual(ctx.calls, [1], '目标已不在队列里时不得再起换源，实际 ' + JSON.stringify(ctx.calls));
});

test('a click landing right after a drain settles still starts a new switch', async () => {
  const ctx = createSandbox(10);
  ctx.sandbox.nextTrack();          // 起第一轮，calls=[1]
  ctx.resolveAll(true);
  await flush();
  await flush();                    // 这一轮 drain 已经收尾
  ctx.sandbox.nextTrack();          // 收尾之后立刻再点
  await flush();
  assert.deepEqual(ctx.calls, [1, 2],
    '收尾句柄必须先清掉，否则新点击会被当成「还有 drain 在跑」而永远排在 pending 里');
});

test('explicit pick beats the queued next target (点了 A 不许响 B)', async () => {
  const ctx = createSandbox(10);
  ctx.sandbox.nextTrack();                       // 起首：drain 正在跑第 1 首
  ctx.sandbox.nextTrack();                       // 排队里挂着第 2 首
  assert.deepEqual(ctx.calls, [1]);

  // 用户从队列面板点了第 7 首
  assert.equal(ctx.sandbox.claimPlaybackInvocationForExplicitPick(), true,
    '明确点选必须能把排队中的「下一曲」作废');
  assert.equal(ctx.sandbox.pendingTrackSwitch, null, '排队目标要清掉');
  assert.equal(ctx.sandbox.trackSwitchDrain, null, '排队句柄要摘掉，否则会被当成「切歌进行中」');

  ctx.resolveAll(true);
  await flush();
  ctx.resolveAll(true);
  await flush();
  assert.deepEqual(ctx.calls, [1], '排队的那首不得再被装载，实际 ' + JSON.stringify(ctx.calls));
});

test('a switch started by the gate itself is not an explicit pick', async () => {
  const ctx = createSandbox(10);
  const insideDrain = [];
  ctx.sandbox.__onPlayQueueAt = (idx, playOpts) => {
    insideDrain.push(ctx.sandbox.claimPlaybackInvocationForExplicitPick(playOpts));
  };
  ctx.sandbox.nextTrack();
  ctx.sandbox.nextTrack();
  ctx.resolveAll(true);
  await flush();
  ctx.resolveAll(true);
  await flush();

  assert.deepEqual(insideDrain, [false, false],
    '合流闸自己发起的 playQueueAt 不能认领成「明确点选」，否则会把自己排队的下一首清掉');
  assert.deepEqual(ctx.calls, [1, 2], '排队目标必须照常跑，实际 ' + JSON.stringify(ctx.calls));
});

test('playQueueAt claims the explicit pick only after the request is valid', () => {
  const start = source.indexOf('async function playQueueAt');
  assert.ok(start > 0);
  const block = source.slice(start, start + 900);
  const bounds = block.indexOf('idx >= playQueue.length');
  const claim = block.indexOf('claimPlaybackInvocationForExplicitPick(opts)');
  assert.ok(bounds > 0, '找不到入参校验，playQueueAt 入口被改过');
  assert.ok(claim > bounds,
    'playQueueAt 入口必须调用 claimPlaybackInvocationForExplicitPick(opts)，且要在校验通过之后（过期调用不该扔掉用户的点击）');
});

test('an abandoned drain must not clobber the handle of a newer one', async () => {
  const ctx = createSandbox(10);
  ctx.sandbox.nextTrack();                 // drain A 在跑第 1 首，calls=[1]
  ctx.sandbox.nextTrack();                 // 排队里挂着第 2 首
  assert.equal(ctx.sandbox.claimPlaybackInvocationForExplicitPick(), true);

  ctx.sandbox.nextTrack();                 // 用户又点了下一曲：drain B 起跑第 3 首，calls=[1,3]
  assert.deepEqual(ctx.calls, [1, 3]);

  ctx.resolveOne(true);                    // 只让老 drain A 那一首落地
  await flush();
  ctx.sandbox.nextTrack();                 // 此时必须排进 B，而不是另起 drain C
  assert.deepEqual(ctx.calls, [1, 3],
    '老 drain 退出时不许动新一轮的句柄，否则会并存两个 drain，实际 ' + JSON.stringify(ctx.calls));
});
