'use strict';

/* =============================================================================
 * 酷狗「未返回歌曲」快速通道（2026-11-12 用户需求）
 *
 * 用户：「当再次碰到类似的时候播放器不要卡顿崩溃，不要傻傻的等待，
 *        直接提示 KG 未返回歌曲就好，自动跳转」。
 *
 * 取证背景：Phone Kisses (雨声) / 罗生门 (Follow) 这类 UGC 条目，
 * trackercdn 返回 {"status":3,"trans_param":{...}}（无 url / 无错误消息），
 * 服务端归为 copyright_unavailable；同歌单另外 8 首 status:1 正常。
 * 旧链路会跑 tryAutoPlaybackFallback（换源搜索 6.5s）→ 终局清 audio.src
 * → 点播放键重开 root playback → 连点打崩渲染进程。
 *
 * 本文件锁死：
 *   1) 只认服务端响应，绝不按歌名 / 版本后缀猜；
 *   2) 绕过换源与终局，直接提示 + 走合流闸跳下一首；
 *   3) 跳过预算 / 去重 / 时间窗，防止整队列不可用时无限循环；
 *   4) 已有切歌在飞时不重复登记目标。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '..', 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function sliceFastSkip(text) {
  const start = text.indexOf('var KUGOU_SKIP_MAX');
  const end = text.indexOf('async function playQueueAt(idx, opts)');
  assert.ok(start > 0, '找不到 KUGOU_SKIP_MAX 声明');
  assert.ok(end > start, '找不到 playQueueAt 边界');
  return text.slice(start, end);
}
const fastSkipSource = sliceFastSkip(source);

function makeSandbox(opts) {
  const o = opts || {};
  let now = 1700000000000;
  const calls = { toast: [], switches: [], failedMarks: [] };
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    Object, String, Number, Math, Promise,
    Date: { now() { return now; } },
    playQueue: o.queue || [
      { hash: 'h0', name: 'A', source: 'kugou' },
      { hash: 'h1', name: 'B', source: 'kugou' },
      { hash: 'h2', name: 'C', source: 'kugou' },
    ],
    currentIdx: o.currentIdx == null ? 0 : o.currentIdx,
    playMode: o.playMode || 'loop',
    switchInProgress: !!o.switchInProgress,
    audio: o.audio == null ? null : o.audio,
    audioFadeSerial: 0,
    clearAudioFadeTimers() {},
    playing: false,
    setPlayIcon() {},
    getMusicProviderKey(song) { return song && (song.source || song.provider || song.type) || 'netease'; },
    queueItemKey(song) { return song ? (song.hash || song.name || '') : ''; },
    forcePlaybackControlsInteractive() {},
    hideLoading() {},
    showToast(text) { calls.toast.push(String(text)); },
    playbackTrackSwitchInProgress() { return sandbox.switchInProgress; },
    markQueueItemPlaybackFailed(idx) {
      calls.failedMarks.push(idx);
      if (sandbox.playQueue[idx]) sandbox.playQueue[idx]._lastPlaybackFailAt = 1700000000000;
    },
    shuffleNextTrackIndex() { return o.shuffleTarget == null ? 1 : o.shuffleTarget; },
    scenePlaybackContextForTrackSwitch() { return null; },
    internalPlaybackOpts(opts) { opts = opts || {}; opts.__mineradioInternalPlayback = true; return opts; },
    requestTrackSwitch(idx, playOpts, label) {
      calls.switches.push({ idx, playOpts, label });
      return Promise.resolve(true);
    },
  };
  vm.runInNewContext(fastSkipSource, sandbox, { filename: sourcePath });
  return { sandbox, calls, advance(ms) { now += ms; } };
}

const UNAVAILABLE = { provider: 'kugou', url: '', playable: false, reason: 'copyright_unavailable', kugouCode: 3 };
const SONG = { hash: 'h0', name: 'Phone Kisses (雨声)', source: 'kugou' };

// ---- ① 静态守卫 -------------------------------------------------------------
test('① 判据只认服务端响应，no-url 分支必须优先于换源', () => {
  const body = sliceFastSkip(source);
  assert.match(body, /category !== 'copyright_unavailable'\) return false;/,
    '必须只认服务端版权分类');
  assert.match(body, /getMusicProviderKey/);
  assert.match(body, /KUGOU_SKIP_MAX/, '必须有跳过预算');
  assert.match(body, /kugouSkipChain/, '自动跳过发起的那一轮要带标记');
  assert.match(body, /_kugouUnavailableAt/, '必须给这类曲目打短时效标记');
  assert.match(source, /kugouUnavailableAt > 0/,
    'togglePlay 必须读这个标记，否则连点播放键会重置跳过链再跳一轮');

  const noUrlStart = source.indexOf('    if (!data || !data.url) {');
  const noUrlEnd = source.indexOf('    // 取址成功', noUrlStart);
  assert.ok(noUrlStart > 0 && noUrlEnd > noUrlStart);
  const noUrl = source.slice(noUrlStart, noUrlEnd);
  const skipAt = noUrl.indexOf('skipKugouUnavailableTrack(idx, token, song, data)');
  const fallbackAt = noUrl.indexOf('tryAutoPlaybackFallback(song, data, idx, token, opts)');
  assert.ok(skipAt > 0, '快速通道必须存在于 no-url 分支');
  assert.ok(skipAt < fallbackAt, '快速通道必须在换源搜索之前，否则还是会傻等 6.5s');
  assert.doesNotMatch(noUrl.slice(skipAt, fallbackAt), /settleSourceFallbackTerminal/,
    '快速通道不能进换源终局（会清 audio.src 并诱发重开 root playback）');

  const entry = source.slice(source.indexOf('async function playQueueAt(idx, opts)'),
    source.indexOf('if (typeof beginSourceFallbackPlaybackInvocation'));
  assert.match(entry, /if \(!opts\.kugouSkipChain\) resetKugouSkipChain\(\);/,
    '用户手动操作要重置跳过链，自动跳过那一轮不能重置');
});

test('② 源码里不得出现按歌名 / 版本后缀预判 unavailable 的逻辑', () => {
  const body = sliceFastSkip(source);
  assert.doesNotMatch(body, /雨声|Follow|DJ.{0,4}版|song\.name.*includes/,
    '同类正常曲目也带这些后缀，按歌名猜会误杀');
});

// ---- ② 识别边界 -------------------------------------------------------------
test('③ 识别：只看 provider + copyright_unavailable + 确实没有 url', () => {
  const { sandbox } = makeSandbox();
  const f = sandbox.isKugouUnavailableResponse;
  assert.equal(f(SONG, UNAVAILABLE), true);
  assert.equal(f(SONG, Object.assign({}, UNAVAILABLE, { restriction: { category: 'copyright_unavailable' }, reason: '' })), true,
    '兼容 restriction.category 形式');
  assert.equal(f(SONG, Object.assign({}, UNAVAILABLE, { url: 'https://cdn/x.mp3' })), false,
    '有地址就不能当未返回');
  assert.equal(f(SONG, Object.assign({}, UNAVAILABLE, { reason: 'paid_required' })), false,
    '会员/付费类仍走原链路');
  assert.equal(f(Object.assign({}, SONG, { source: 'netease' }), UNAVAILABLE), false,
    '其它平台不受影响');
  assert.equal(f(null, UNAVAILABLE), false);
  assert.equal(f(SONG, null), false);
});

// ---- ③ 跳过预算 -------------------------------------------------------------
test('④ 预算 / 去重 / 慢响应不续期（2026-11-12 复核回归：预算跟随整轮自动跳转）', () => {
  const ctx = makeSandbox({ queue: Array.from({ length: 12 }, (_, i) => ({ hash: 'h' + i, source: 'kugou' })) });
  const claim = ctx.sandbox.claimKugouSkip;
  for (let i = 0; i < 6; i += 1) assert.equal(claim({ hash: 'h' + i }), 'ok', '第 ' + (i + 1) + ' 次');
  assert.equal(claim({ hash: 'h6' }), 'budget', '连跳 6 首后必须停住');

  ctx.sandbox.resetKugouSkipChain();
  assert.equal(claim({ hash: 'x' }), 'ok');
  assert.equal(claim({ hash: 'x' }), 'duplicate', '同一首不能重复跳（防死循环）');

  ctx.advance(13000);
  assert.equal(claim({ hash: 'y' }), 'stale',
    '超过时间窗必须终止而不是重置窗口再拿 6 次（旧语义会让慢响应绕过预算上限）');
});

test('④b 慢响应模拟：两首不可用曲、响应间隔 6.5s，10 连跳会被拦住', () => {
  const ctx = makeSandbox({ queue: Array.from({ length: 12 }, (_, i) => ({ hash: 'h' + i, source: 'kugou' })) });
  const claim = ctx.sandbox.claimKugouSkip;
  let approved = 0;
  let last = 'ok';
  for (let i = 0; i < 10; i += 1) {
    ctx.advance(6500);
    last = claim({ hash: 'h' + (i % 2) });
    if (last !== 'ok') break;
    approved += 1;
  }
  assert.ok(approved < 10, '旧实现每个 12s 窗口重置计数，会连续获准 10 次；实际获准 ' + approved + ' 次');
  assert.notEqual(last, 'ok', '必须以预算 / 去重 / 超时终止');
});

test('④c 重新拿预算的唯一入口是 resetKugouSkipChain（用户手动操作触发）', () => {
  const ctx = makeSandbox({ queue: Array.from({ length: 12 }, (_, i) => ({ hash: 'h' + i, source: 'kugou' })) });
  const claim = ctx.sandbox.claimKugouSkip;
  assert.equal(claim({ hash: 'h0' }), 'ok', '本轮链从第一次跳转起算');
  ctx.advance(13000);
  assert.equal(claim({ hash: 'h1' }), 'stale', '超时后直接 claim 不能复活预算');
  ctx.sandbox.resetKugouSkipChain();
  assert.equal(claim({ hash: 'h0' }), 'ok', '用户手动选曲（playQueueAt 入口重置）后重新开始');
});

// ---- ④ 自动跳转行为 ---------------------------------------------------------
test('⑤ 正常情况：提示「酷狗未返回歌曲」并走合流闸跳到另一首', async () => {
  const ctx = makeSandbox();
  const r = ctx.sandbox.skipKugouUnavailableTrack(0, 7, SONG, UNAVAILABLE);
  assert.equal(r, false, '不重开 root playback，直接返回');
  assert.equal(ctx.calls.toast.length, 1);
  assert.match(ctx.calls.toast[0], /酷狗未返回歌曲/);
  assert.match(ctx.calls.toast[0], /自动跳/);
  assert.equal(ctx.calls.failedMarks.length, 1, '必须补写失败标记，否则连点播放键会重开 root playback');
  assert.ok(ctx.sandbox.playQueue[0]._kugouUnavailableAt > 0,
    '必须打短时效标记，让 togglePlay 连点时直接提示而不重开');
  assert.equal(ctx.calls.switches.length, 1);
  assert.equal(ctx.calls.switches[0].idx, 1, 'loop 模式跳下一首');
  assert.equal(ctx.calls.switches[0].playOpts.kugouSkipChain, true, '要带链标记，否则预算被重置');
  assert.equal(ctx.calls.switches[0].playOpts.__mineradioInternalPlayback, true,
    '必须带 INTERNAL 标记，否则 claimPlaybackInvocationForExplicitPick 会把刚登记的目标清掉');
  assert.equal(ctx.sandbox.currentIdx, 1);
  await Promise.resolve();
});

test('⑤b 同一轮跳过链只弹一次「已自动跳」，停住时另给一次明确提示', async () => {
  const ctx = makeSandbox({ queue: Array.from({ length: 12 }, (_, i) => ({ hash: 'h' + i, source: 'kugou' })) });
  for (let i = 0; i < 6; i += 1) {
    ctx.sandbox.skipKugouUnavailableTrack(i, 7, ctx.sandbox.playQueue[i], UNAVAILABLE);
  }
  assert.equal(ctx.calls.toast.filter((t) => /已自动跳/.test(t)).length, 1, '连续跳不能刷屏');
  ctx.sandbox.skipKugouUnavailableTrack(6, 7, ctx.sandbox.playQueue[6], UNAVAILABLE);
  assert.equal(ctx.calls.toast.filter((t) => /停止自动跳转/.test(t)).length, 1);
  await Promise.resolve();
});

test('⑥ drain 在飞时仍继续自动跳（不能被 playbackTrackSwitchInProgress 卡住）', async () => {
  const ctx = makeSandbox({ switchInProgress: true });
  ctx.sandbox.skipKugouUnavailableTrack(0, 7, SONG, UNAVAILABLE);
  assert.equal(ctx.calls.switches.length, 1,
    'drain 正在 await 当前 playQueueAt 时这道闸恒真，拿它当早退条件会卡在第 2 首');
  assert.equal(ctx.calls.failedMarks.length, 1);
  await Promise.resolve();
});

test('⑦ 单曲队列 / 无可跳目标：不跳、不死循环', () => {
  const one = makeSandbox({ queue: [{ hash: 'h0', source: 'kugou' }] });
  one.sandbox.skipKugouUnavailableTrack(0, 7, SONG, UNAVAILABLE);
  assert.equal(one.calls.switches.length, 0);
  assert.match(one.calls.toast[0], /没有其它曲目/);

  const same = makeSandbox({ queue: [
    { hash: 'h0', source: 'kugou' }, { hash: 'h1', source: 'kugou' },
  ], currentIdx: 1, playMode: 'loop' });
  // 目标绕回 0，与 idx 0 相同的情况由调用方 idx 判定；这里验证不会跳到自己
  same.sandbox.skipKugouUnavailableTrack(1, 7, { hash: 'h1', source: 'kugou' }, UNAVAILABLE);
  assert.equal(same.calls.switches.length, 1);
  assert.equal(same.calls.switches[0].idx, 0);
});

test('⑧ 预算耗尽：停住并明确告知，不再登记跳转', () => {
  const ctx = makeSandbox({ queue: Array.from({ length: 12 }, (_, i) => ({ hash: 'h' + i, source: 'kugou' })) });
  for (let i = 0; i < 6; i += 1) ctx.sandbox.claimKugouSkip({ hash: 'h' + i });
  ctx.sandbox.skipKugouUnavailableTrack(0, 7, { hash: 'h6', source: 'kugou' }, UNAVAILABLE);
  assert.equal(ctx.calls.switches.length, 0);
  assert.match(ctx.calls.toast[0], /停止自动跳转/);
});

test('⑩ 停止自动跳转必须卸掉旧媒体源（2026-11-12 复核回归：否则点播放键重播上一首）', () => {
  const unloadCalls = [];
  const audioStub = {
    src: 'proxy://old-song', paused: true,
    pause() {},
    removeAttribute(k) { unloadCalls.push('remove:' + k); },
    load() { unloadCalls.push('load'); },
    __mineradioQueueItemKey: 'old-song-key',
    __mineradioTrackSwitchToken: 5,
  };
  const ctx = makeSandbox({
    queue: Array.from({ length: 12 }, (_, i) => ({ hash: 'h' + i, source: 'kugou' })),
    audio: audioStub,
  });
  for (let i = 0; i < 6; i += 1) ctx.sandbox.claimKugouSkip({ hash: 'k' + i });
  const r = ctx.sandbox.skipKugouUnavailableTrack(0, 7, { hash: 'h6', source: 'kugou' }, UNAVAILABLE);
  assert.equal(r, false);
  assert.ok(unloadCalls.some(c => c === 'remove:src'), '必须 removeAttribute("src")，否则旧 audio.src 还挂着上一首');
  assert.ok(unloadCalls.some(c => c === 'load'), '必须 load() 让媒体元素真正卸载');
  assert.equal(audioStub.__mineradioQueueItemKey, '', '队列项身份要清掉，归属校验不能再认旧音源');
  assert.equal(ctx.sandbox.playing, false, '播放状态必须复位');

  // 慢响应超时（stale）终止也必须卸源：先起一轮链，再推进时间越过时间窗
  unloadCalls.length = 0;
  ctx.sandbox.resetKugouSkipChain();
  assert.equal(ctx.sandbox.claimKugouSkip({ hash: 'seed' }), 'ok');
  ctx.advance(13000);
  ctx.sandbox.skipKugouUnavailableTrack(0, 7, { hash: 'h0', source: 'kugou' }, UNAVAILABLE);
  assert.ok(unloadCalls.some(c => c === 'remove:src'), 'stale 终止也要卸源');
  assert.match(ctx.calls.toast[ctx.calls.toast.length - 1], /加载超时/);
});

test('⑨ shuffle 模式复用「排除当前曲目」的目标计算', async () => {
  const ctx = makeSandbox({ playMode: 'shuffle', shuffleTarget: 2, queue: [
    { hash: 'h0', source: 'kugou' }, { hash: 'h1', source: 'kugou' }, { hash: 'h2', source: 'kugou' },
  ] });
  ctx.sandbox.skipKugouUnavailableTrack(0, 7, SONG, UNAVAILABLE);
  assert.equal(ctx.calls.switches.length, 1);
  assert.equal(ctx.calls.switches[0].idx, 2);
  await Promise.resolve();
});
