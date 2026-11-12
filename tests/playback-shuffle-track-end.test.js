'use strict';

/* =============================================================================
 * 随机播放曲末切歌 / 曲末点播放键（2026-11-12 用户报障）
 *
 * 症状：KG 音乐随机播放，一首歌完整播完不自动跳下一首；点控制台播放键也不跳转；
 *       反复点击后播放器卡死重启。
 *
 * 真机探针 scripts/probe-shuffle-track-end.js 取证：
 *   A 组  本地短音频自然 ended → nextTrack / requestTrackSwitch / playQueueAt 链路正常，
 *         但 4 次 nextTrack 有 2 次 target === currentIdx（shuffle 抽中自己 = 重播同一首）。
 *   B 组  曲末停在 ended 后点一次 togglePlay → currentTime 归零重播，要再等一整首
 *         自然 ended 才 nextTrack（长歌曲上就是「点了不跳转」）。
 *   C 组  连点 5 次后 CDP Runtime.evaluate 超时（渲染进程无响应）。
 *
 * 本文件锁死三条修复：
 *   1) shuffle 的下一首必须从「除当前曲目外」的索引池里抽；
 *   2) 曲末态点播放键直接走 nextTrack 合流闸，不再 attemptAudioPlay 重播；
 *   3) 已有切歌在飞时不再重复登记目标，避免反复 trackSwitchToken++ 作废起播。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '..', 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// ---- 切片：曲末判据 + togglePlay -------------------------------------------
function sliceToggle(text) {
  const start = text.indexOf('function playbackReachedTrackEnd(media)');
  const end = text.indexOf('function setPlayIcon(p)');
  assert.ok(start > 0, '找不到 playbackReachedTrackEnd 定义');
  assert.ok(end > start, '找不到 setPlayIcon 边界');
  return text.slice(start, end);
}

// ---- 切片：合流闸 + shuffleNextTrackIndex + nextTrack -----------------------
function sliceScheduler(text) {
  const start = text.indexOf('var pendingTrackSwitch = null;');
  const end = text.indexOf('function releaseQueuePlaybackMedia');
  assert.ok(start > 0, '找不到 pendingTrackSwitch 声明');
  assert.ok(end > start, '找不到 releaseQueuePlaybackMedia 边界');
  return text.slice(start, end);
}

const toggleSource = sliceToggle(source);
const schedulerSource = sliceScheduler(source);

function makeToggleSandbox(media, opts) {
  const o = opts || {};
  const calls = { nextTrack: 0, attemptAudioPlay: 0, playQueueAt: 0, fadeOutAndPauseAudio: 0 };
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    Promise, Number, String, Math, isFinite,
    audio: media,
    playToggleBusy: false,
    playing: false,
    playQueue: Array.from({ length: o.queueLength == null ? 2 : o.queueLength }, (_, i) => ({ id: 's' + i })),
    currentIdx: 0,
    switchInProgress: !!o.switchInProgress,
    forcePlaybackControlsInteractive() {},
    hideLoading() {},
    showToast() {},
    setPlayIcon() {},
    updateListenStatsTick() {},
    syncPlaybackStateFromAudioEvent() {},
    scheduleControlsHide() {},
    savePlaybackSession() {},
    safePlaybackStep(label, fn) { try { return fn(); } catch (_) { return null; } },
    playbackTrackSwitchInProgress() { return sandbox.switchInProgress; },
    nextTrack() { calls.nextTrack += 1; },
    attemptAudioPlay() { calls.attemptAudioPlay += 1; return Promise.resolve(true); },
    playQueueAt() { calls.playQueueAt += 1; return Promise.resolve(true); },
    fadeOutAndPauseAudio() { calls.fadeOutAndPauseAudio += 1; return Promise.resolve(true); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(toggleSource, sandbox, { filename: sourcePath });
  return { sandbox, calls };
}

function makeSchedulerSandbox(queueLength, opts) {
  const o = opts || {};
  const targets = [];
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    Promise, Number, String, isFinite,
    Math: { floor: Math.floor, random: (typeof o.random === 'function' ? o.random : Math.random) },
    playMode: o.playMode || 'shuffle',
    playQueue: Array.from({ length: queueLength }, (_, i) => ({ id: 's' + i })),
    currentIdx: o.currentIdx == null ? 0 : o.currentIdx,
    trackSwitchToken: 0,
    playToggleBusy: false,
    forcePlaybackControlsInteractive() {},
    scenePlaybackContextForTrackSwitch() { return null; },
    playQueueAt() { return Promise.resolve(true); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(schedulerSource, sandbox, { filename: sourcePath });
  // 只关心 nextTrack 选中的目标，把真正的换源换成计数桩
  sandbox.requestTrackSwitch = function (idx) {
    targets.push(idx);
    return Promise.resolve(true);
  };
  return { sandbox, targets };
}

// ---- ① 静态守卫 -------------------------------------------------------------
test('① 播放核心不再把 ended 合并进「暂停后重播」分支', () => {
  const toggle = sliceToggle(source);
  assert.doesNotMatch(toggle, /audio\.paused\s*\|\|\s*audio\.ended/,
    'ended 与 paused 必须分流：曲末态不能再走 attemptAudioPlay 重播');
  assert.match(toggle, /if\s*\(playbackReachedTrackEnd\(audio\)\)/,
    '曲末态必须有独立判据分支');
  assert.match(toggle, /nextTrack\(\)/, '曲末态必须调用 nextTrack');
  assert.match(toggle, /playbackTrackSwitchInProgress\(\)/,
    '曲末连点必须挡在合流闸前面');
  assert.match(toggle, /playQueue\.length\s*>\s*1/,
    '只有多曲队列才切歌；单曲队列仍允许重播');
});

test('② shuffle 目标计算走排除当前曲目的索引池', () => {
  assert.match(source, /function shuffleNextTrackIndex\(\)/,
    '必须存在独立的 shuffle 目标函数');
  assert.match(source, /if \(i !== currentIdx\) pool\.push\(i\)/,
    '索引池必须排除 currentIdx');
  // 只检查 nextTrack 函数体：注释里描述旧实现的文字不参与判据
  const nextBody = source.slice(source.indexOf('function nextTrack()'), source.indexOf('function prevTrack()'));
  assert.doesNotMatch(nextBody, /Math\.random\(\)\s*\*\s*playQueue\.length/,
    '禁止回退成「直接在整条队列里随机」（会抽中当前曲目本身）');
  assert.match(nextBody, /target = shuffleNextTrackIndex\(\)/,
    'nextTrack 必须消费新的 shuffle 目标');
});

// ---- ③ playbackReachedTrackEnd 边界 ----------------------------------------
test('③ 曲末判据：ended 优先，播放中不抢暂停键，duration 非法不误判', () => {
  const { sandbox } = makeToggleSandbox(null);
  const f = sandbox.playbackReachedTrackEnd;
  assert.equal(f(null), false);
  assert.equal(f({ ended: true, paused: true, currentTime: 0, duration: Infinity }), true,
    'ended 为真时无条件算曲末（duration 可以未知）');
  assert.equal(f({ ended: false, paused: false, currentTime: 249.95, duration: 250 }), false,
    '还在播的最后 0.05s 点暂停必须仍然只是暂停');
  assert.equal(f({ ended: false, paused: true, currentTime: 249.95, duration: 250 }), true,
    'ended 事件丢失但已停在末尾时仍应算曲末');
  assert.equal(f({ ended: false, paused: true, currentTime: 100, duration: 250 }), false,
    '普通暂停不能误判成曲末');
  assert.equal(f({ ended: false, paused: true, currentTime: 249.95, duration: NaN }), false,
    'duration 为 NaN 的流媒体只认 ended');
  assert.equal(f({ ended: false, paused: true, currentTime: 0, duration: 0 }), false,
    'duration 为 0 的未就绪媒体不能算曲末');
});

// ---- ④ togglePlay 曲末行为 --------------------------------------------------
test('④ 曲末态点播放键：立刻切歌，不重播、不 seek 回 0', async () => {
  const media = { src: 'x', ended: true, paused: true, currentTime: 250, duration: 250 };
  const { sandbox, calls } = makeToggleSandbox(media, { queueLength: 2 });
  await sandbox.togglePlay();
  assert.equal(calls.nextTrack, 1, '曲末态必须调用一次 nextTrack');
  assert.equal(calls.attemptAudioPlay, 0, '绝不能再 attemptAudioPlay 重播当前曲目');
  assert.equal(calls.playQueueAt, 0, '切歌交给合流闸，不在 togglePlay 里直接起播');
  assert.equal(media.currentTime, 250, '不能把进度 seek 回 0（那是重播）');
});

test('⑤ 单曲队列曲末仍允许重播（没有下一首可去）', async () => {
  const media = { src: 'x', ended: true, paused: true, currentTime: 250, duration: 250 };
  const { sandbox, calls } = makeToggleSandbox(media, { queueLength: 1 });
  await sandbox.togglePlay();
  assert.equal(calls.nextTrack, 0);
  assert.equal(calls.attemptAudioPlay, 1);
  assert.equal(media.currentTime, 0, '重播前必须把进度归零');
});

test('⑥ 普通暂停与播放中暂停都不受影响（零回归）', async () => {
  const paused = { src: 'x', ended: false, paused: true, currentTime: 100, duration: 250 };
  const a = makeToggleSandbox(paused, { queueLength: 2 });
  await a.sandbox.togglePlay();
  assert.equal(a.calls.attemptAudioPlay, 1, '普通暂停后点播放键仍走 attemptAudioPlay');
  assert.equal(a.calls.nextTrack, 0);

  const nearEndPlaying = { src: 'x', ended: false, paused: false, currentTime: 249.95, duration: 250 };
  const b = makeToggleSandbox(nearEndPlaying, { queueLength: 2 });
  await b.sandbox.togglePlay();
  assert.equal(b.calls.fadeOutAndPauseAudio, 1, '播放中最后 0.05s 点按钮仍应只是暂停');
  assert.equal(b.calls.nextTrack, 0, '绝不能把暂停键变成切歌键');
});

test('⑦ ended 事件丢失但已停在末尾时，点播放键也切歌', async () => {
  const media = { src: 'x', ended: false, paused: true, currentTime: 249.95, duration: 250 };
  const { sandbox, calls } = makeToggleSandbox(media, { queueLength: 2 });
  await sandbox.togglePlay();
  assert.equal(calls.nextTrack, 1, '软判据必须兜住代理流尾包丢了 ended 的情况');
  assert.equal(calls.attemptAudioPlay, 0);
});

test('⑧ 已有切歌在飞时，曲末连点不得重复登记目标', async () => {
  const media = { src: 'x', ended: true, paused: true, currentTime: 250, duration: 250 };
  const { sandbox, calls } = makeToggleSandbox(media, { queueLength: 2, switchInProgress: true });
  await sandbox.togglePlay();
  assert.equal(calls.nextTrack, 0,
    '反复 requestTrackSwitch 会不断作废在飞的起播，必须挡住');
  await sandbox.togglePlay();
  assert.equal(calls.nextTrack, 0);
});

// ---- ⑨ shuffle 目标行为 -----------------------------------------------------
test('⑨ shuffle 连续 500 次都不抽中当前曲目', () => {
  for (const len of [2, 3, 7, 20]) {
    for (let cur = 0; cur < len; cur += 1) {
      const ctx = makeSchedulerSandbox(len, { currentIdx: cur });
      for (let i = 0; i < 500 / len + 1; i += 1) {
        const before = ctx.sandbox.currentIdx;
        ctx.sandbox.nextTrack();
        assert.notEqual(ctx.sandbox.currentIdx, before,
          '队列 ' + len + ' 首、当前 ' + before + ' 时，shuffle 抽中了自己');
        assert.ok(ctx.sandbox.currentIdx >= 0 && ctx.sandbox.currentIdx < len);
        assert.equal(ctx.targets[ctx.targets.length - 1], ctx.sandbox.currentIdx,
          'currentIdx 与登记给合流闸的目标必须一致');
      }
    }
  }
});

test('⑩ shuffle 索引池覆盖除当前曲目外的全部位置', () => {
  const seen = {};
  for (let r = 0; r <= 99; r += 1) {
    const ctx = makeSchedulerSandbox(4, { currentIdx: 1, random: () => r / 100 });
    ctx.sandbox.nextTrack();
    seen[ctx.sandbox.currentIdx] = true;
  }
  assert.deepEqual(Object.keys(seen).sort(), ['0', '2', '3'],
    '当前曲目 1 必须被排除，其余 0/2/3 都要能抽到');
});

test('⑪ 单曲队列 shuffle 绕回自己；loop 顺序推进不受影响', () => {
  const one = makeSchedulerSandbox(1, { currentIdx: 0 });
  one.sandbox.nextTrack();
  assert.equal(one.sandbox.currentIdx, 0);
  assert.deepEqual(one.targets, [0]);

  const loop = makeSchedulerSandbox(5, { playMode: 'loop', currentIdx: 3 });
  loop.sandbox.nextTrack();
  assert.equal(loop.sandbox.currentIdx, 4, 'loop 模式必须保持 +1 绕回语义');
  assert.deepEqual(loop.targets, [4]);
});
