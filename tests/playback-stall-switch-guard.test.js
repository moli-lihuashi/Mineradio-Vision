'use strict';

/* =============================================================================
 * 停播看门狗必须给「切歌」让路
 *
 * 原始 BUG：快速点下一曲，偶尔整首没声音。真机压测（12 连点 / 15ms 间隔）抓到的现场是
 *   play() -> reject AbortError: The play() request was interrupted by a new load request
 *   play() -> reject AbortError: The play() request was interrupted by a call to pause()
 * 而这两条中断都不是用户操作，全部来自看门狗自己：
 *   换源时 audio.src 被改、load() 被调，readyState 天然回到 0，看门狗认为「卡住了」，
 *   于是 softRetryStalledAudio 又补一刀 media.load()（把还在飞的 play() 打断），
 *   交不出成绩再走 recoverCurrentTrackPlaybackFromFreshUrl（再换一次源 + pause）。
 *
 * 现在的语义：只要还有切歌在飞（trackSwitchDrain）或还有目标在排队（pendingTrackSwitch），
 * 看门狗就站住不动；另外「新源正在下载」这种中间态只补 play()，不再重新 load()。
 *
 * 这里直接跑真实源码（从 09d-playback-stall-recovery.js 切出来），
 * 用可计数的 media 桩验证「有没有真的去打断起播」，而不是断言源码字符串。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '09d-playback-stall-recovery.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const SRC = 'blob:mineradio-track-1';

function sliceRecovery(text) {
  const start = text.indexOf('function isSameAudioPlaybackTarget');
  assert.ok(start > 0, '找不到 isSameAudioPlaybackTarget，停播恢复模块结构被改过');
  const end = text.indexOf('async function recoverCurrentTrackPlaybackFromFreshUrl');
  assert.ok(end > start, '找不到 recoverCurrentTrackPlaybackFromFreshUrl 边界');
  const slice = text.slice(start, end);
  assert.ok(slice.includes('function playbackTrackSwitchInProgress'), '切片里没有切歌闸门，测试失去意义');
  return slice;
}

const recoverySource = sliceRecovery(source);

/* media 桩：把「会不会打断起播」变成可计数的 load / play 次数。 */
function createSandbox(overrides) {
  const o = overrides || {};
  const rec = { load: 0, play: 0, buffering: [] };
  const listeners = Object.create(null);
  const media = {
    paused: o.paused === undefined ? false : o.paused,
    ended: false,
    seeking: false,
    readyState: o.readyState === undefined ? 4 : o.readyState,
    networkState: o.networkState === undefined ? 1 : o.networkState,
    NETWORK_LOADING: 2,
    NETWORK_IDLE: 1,
    currentTime: o.currentTime === undefined ? 12 : o.currentTime,
    currentSrc: o.currentSrc || SRC,
    load() {
      rec.load++;
      const queued = (listeners.canplay || []).slice();
      queued.forEach((fn) => fn());
    },
    play() {
      rec.play++;
      media.paused = false;
      return Promise.resolve();
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
  };
  const sandbox = {
    console,
    Math,
    Number,
    Date,
    Promise,
    setTimeout,
    isFinite,
    audio: media,
    trackSwitchToken: 1,
    playbackResumeRecovery: { serial: 0 },
    setPlaybackBufferingState(state, reason) { rec.buffering.push(state + ':' + reason); },
    __media: media,
    __rec: rec,
  };
  // 缺省两个变量都「存在且为空」；传 undefined 表示该变量根本没被声明（模块单独加载）。
  sandbox.pendingTrackSwitch = o.hasPending === false ? null : (o.pending === undefined ? null : o.pending);
  sandbox.trackSwitchDrain = o.hasDrain === false ? null : (o.drain === undefined ? null : o.drain);
  if (o.dropPendingDecl) delete sandbox.pendingTrackSwitch;
  if (o.dropDrainDecl) delete sandbox.trackSwitchDrain;
  vm.createContext(sandbox);
  vm.runInContext(recoverySource + '\nthis.__api = { playbackTrackSwitchInProgress, playbackStallRecoveryOwnerStillCurrent, softRetryStalledAudio, isSameAudioPlaybackTarget };', sandbox, {
    filename: '09d-playback-stall-recovery.js#slice',
  });
  return sandbox;
}

function ownerCurrent(sandbox, patch) {
  const p = patch || {};
  const media = sandbox.__media;
  if (p.paused !== undefined) media.paused = p.paused;
  if (p.seeking !== undefined) media.seeking = p.seeking;
  // 只改「传进去的」token / serial，全局真值保持默认（1 / 0），才能验出过期分支
  return sandbox.__api.playbackStallRecoveryOwnerStillCurrent(
    media,
    p.src === undefined ? SRC : p.src,
    p.token === undefined ? sandbox.trackSwitchToken : p.token,
    p.serial === undefined ? sandbox.playbackResumeRecovery.serial : p.serial
  );
}

test('A 切歌闸门：没有在飞的切歌 / 排队目标时才算空闲', () => {
  assert.equal(createSandbox({}).__api.playbackTrackSwitchInProgress(), false, '空闲时必须放行看门狗');
  assert.equal(createSandbox({ pending: { idx: 3 } }).__api.playbackTrackSwitchInProgress(), true, '有目标排队 = 切歌进行中');
  assert.equal(createSandbox({ drain: Promise.resolve(true) }).__api.playbackTrackSwitchInProgress(), true, '有 drain 在飞 = 切歌进行中');
  // 变量压根没声明时不能抛 ReferenceError（模块被单独加载 / 顺序变化）
  assert.equal(createSandbox({ dropPendingDecl: true, dropDrainDecl: true }).__api.playbackTrackSwitchInProgress(), false, '变量不存在时必须安全返回 false');
});

test('B 看门狗归属判定：切歌期间一律判为「不是我的现场」', () => {
  assert.equal(ownerCurrent(createSandbox({})), true, '基线：同源、token 与 serial 都对、正在播放 → 允许恢复');

  assert.equal(ownerCurrent(createSandbox({ pending: { idx: 2 } })), false, '有目标排队时看门狗必须退场');
  assert.equal(ownerCurrent(createSandbox({ drain: Promise.resolve(true) })), false, 'drain 在飞时看门狗必须退场');

  assert.equal(ownerCurrent(createSandbox({}), { token: 1 }), true, 'token 与当前一致仍应放行（对照）');
  assert.equal(ownerCurrent(createSandbox({}), { token: 99 }), false, 'token 已过期 → 退场');
  assert.equal(ownerCurrent(createSandbox({}), { serial: 7 }), false, 'recoverySerial 过期 → 退场');
  assert.equal(ownerCurrent(createSandbox({}), { src: 'blob:other' }), false, '音频源已换 → 退场');
  assert.equal(ownerCurrent(createSandbox({}), { paused: true }), false, '已暂停不是「卡住」→ 退场');
});

test('C 切歌期间软重试绝不碰 audio（不能 load 也不能 play）', async () => {
  for (const [label, overrides] of [
    ['有目标排队', { pending: { idx: 4 } }],
    ['drain 在飞', { drain: Promise.resolve(true) }],
  ]) {
    const sandbox = createSandbox(overrides);
    const ok = await sandbox.__api.softRetryStalledAudio(sandbox.__media, SRC, sandbox.trackSwitchToken, 12);
    assert.equal(ok, false, label + '：不得声称恢复成功');
    assert.equal(sandbox.__rec.load, 0, label + '：绝不能 media.load()（会打断在飞的 play()）');
    assert.equal(sandbox.__rec.play, 0, label + '：也不该再补 play()');
    assert.deepEqual(sandbox.__rec.buffering, [], label + '：连 buffering 状态都不该改');
  }
});

test('D 「新源正在下载」只补 play，不重新 load', async () => {
  // readyState 0 + NETWORK_LOADING：换源后最正常的中间态
  const loading = createSandbox({ readyState: 0, networkState: 2 });
  const ok = await loading.__api.softRetryStalledAudio(loading.__media, SRC, loading.trackSwitchToken, 12);
  assert.equal(loading.__rec.load, 0, '还在下载时重新 load() 等于把请求推倒重来并打断起播');
  assert.equal(loading.__rec.play, 1, '应当补一次 play() 让它挂着等数据');
  assert.equal(ok, true, '补 play() 之后音频在播 → 恢复成功');
  assert.ok(loading.__rec.buffering.includes('false:soft-retry-ok'), '恢复成功要收起 buffering');

  // 对照：readyState 0 但网络已停（NETWORK_IDLE）才是真卡住，必须重新 load
  const idle = createSandbox({ readyState: 0, networkState: 1 });
  const ok2 = await idle.__api.softRetryStalledAudio(idle.__media, SRC, idle.trackSwitchToken, 12);
  assert.equal(idle.__rec.load, 1, '网络已停的死现场必须重新 load()');
  assert.equal(idle.__rec.play, 1, '重新 load() 之后仍要 play()');
  assert.equal(ok2, true, '死现场重试后应恢复');

  // 对照：readyState >= 2 有数据，只 seek + play，不需要 load
  const ready = createSandbox({ readyState: 4 });
  await ready.__api.softRetryStalledAudio(ready.__media, SRC, ready.trackSwitchToken, 12);
  assert.equal(ready.__rec.load, 0, '已有数据时不该 load()');
  assert.equal(ready.__rec.play, 1, '已有数据时只补 play()');
});

test('E 闸门放开后软重试照常工作（不能把看门狗改成永久关闭）', async () => {
  const sandbox = createSandbox({});
  assert.equal(sandbox.__api.playbackTrackSwitchInProgress(), false);
  const ok = await sandbox.__api.softRetryStalledAudio(sandbox.__media, SRC, sandbox.trackSwitchToken, 12);
  assert.equal(ok, true, '空闲时看门狗必须仍然能救场');
  assert.equal(sandbox.__rec.play, 1);
});
