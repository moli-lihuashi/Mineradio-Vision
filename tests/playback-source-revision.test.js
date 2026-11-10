'use strict';

/* =============================================================================
 * B3 播放源版本指纹 — 行为测试
 *
 * 09f 与 09d 合并进 vm 真跑。重点不是「有没有那行代码」，而是换链前后
 * 状态机到底记了什么：
 *   · 只换签名（CDN 回了新 token）→ 源没变，recoveryRevisionChanged === false；
 *   · 换了域名 / 音质 → 源变了，=== true；
 *   · 「没换到源」与「换了源还是播不了」必须给出不同的提示文案。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const revisionSrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/05-playback/09f-playback-source-revision.js'), 'utf8');
const recoverySrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/05-playback/09d-playback-stall-recovery.js'), 'utf8');

function loadCombined(extra) {
  const notices = [];
  const clock = { t: 10000 };
  const audio = {
    currentSrc: 'http://cdn.example.com/a.mp3?sign=OLD_SIGNATURE&token=SECRET',
    src: 'http://cdn.example.com/a.mp3?sign=OLD_SIGNATURE&token=SECRET',
    currentTime: 42,
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    networkState: 1,
  };
  const sandbox = Object.assign({
    console,
    // 浏览器里 URL 是全局内置；vm 沙箱不带 Web API，必须显式注入，
    // 否则 09f 会走 catch 的「截断原文」兜底，测试就测不到去凭据逻辑了。
    URL,
    setTimeout(fn, ms) { return 1; },
    clearTimeout() {},
    performance: { now: () => clock.t },
    document: { getElementById: () => null },
    showLoading() {}, hideLoading() {},
    showToast() {},
    showSourceFallbackNotice(title, body) { notices.push({ title, body }); },
    forcePlaybackControlsInteractive() {},
    getMusicProviderKey(song) { return song && song.provider || ''; },
    PLAYBACK_RESUME_STALL_DELAYS: [1600, 3600],
    PLAYBACK_RESUME_LONG_PAUSE_MS: 8 * 60 * 1000,
    PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS: {},
    trackSwitchToken: 3,
    playQueue: [{ id: 'h1', provider: 'kugou', duration: 210 }],
    currentIdx: 0,
    audio,
    playQueueAt: async () => true,
    playbackResumeRecovery: {
      timerIds: [], serial: 0, buffering: false, pending: false,
      lastAttemptAt: 0, pausedAt: 0,
      freshUrlSongKey: '', freshUrlAttemptCount: 0, softRetryCount: 0,
      lastSourceRevision: '', recoveryRevisionChanged: null,
    },
  }, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(revisionSrc + '\n' + recoverySrc, sandbox);
  return { sandbox, notices, clock, audio };
}

/* ---------- 09f 纯函数 ---------- */

test('源身份丢掉签名 / token，只留 origin+path+音质参数', () => {
  const { sandbox } = loadCombined();
  const identity = sandbox.safePlaybackSourceIdentity(
    'https://cdn.example.com/d/1.mp3?sign=SUPER_SECRET&token=ABC&format=flac&maxBitRate=320');
  assert.equal(identity, 'https://cdn.example.com/d/1.mp3?format=flac&maxBitRate=320');
  assert.ok(!identity.includes('SUPER_SECRET'));
  assert.ok(!identity.includes('ABC'));
});

test('blob / data / file 不解析，按前缀截断避免把整段内容记账', () => {
  const { sandbox } = loadCombined();
  const blob = 'blob:http://localhost/uuid-' + 'x'.repeat(200);
  assert.equal(sandbox.safePlaybackSourceIdentity(blob), blob.slice(0, 40));
  assert.equal(sandbox.safePlaybackSourceIdentity('data:audio/mpeg;base64,' + 'A'.repeat(200)).length, 40);
  assert.equal(sandbox.safePlaybackSourceIdentity(''), '');
});

test('源指纹 = provider | 歌曲标识 | 时长 | 去凭据源身份，签名变化不改指纹', () => {
  const { sandbox } = loadCombined();
  const song = { id: 'h1', provider: 'kugou', duration: 210 };
  const a = sandbox.buildPlaybackSourceRevision(song, 'https://cdn/a.mp3?sign=ONE&format=flac');
  const b = sandbox.buildPlaybackSourceRevision(song, 'https://cdn/a.mp3?sign=TWO&format=flac');
  assert.equal(a, 'kugou|h1|210|https://cdn/a.mp3?format=flac');
  assert.equal(a, b, '只换签名不该算换源');
  assert.notEqual(a, sandbox.buildPlaybackSourceRevision(song, 'https://cdn/a.mp3?format=mp3'));
  assert.notEqual(a, sandbox.buildPlaybackSourceRevision(
    { id: 'h1', provider: 'qishui', duration: 210 }, 'https://cdn/a.mp3?format=flac'));
});

test('变更判定：任一侧为空一律不算变更（保守，不误报）', () => {
  const { sandbox } = loadCombined();
  assert.equal(sandbox.playbackSourceRevisionChanged('', 'x'), false);
  assert.equal(sandbox.playbackSourceRevisionChanged('x', ''), false);
  assert.equal(sandbox.playbackSourceRevisionChanged('a', 'a'), false);
  assert.equal(sandbox.playbackSourceRevisionChanged('a', 'b'), true);
});

/* ---------- 09d 接线后的状态机行为 ---------- */

test('换链后签名变了但源没轮换：changedAfterRecovery=false，lastRevision 记的是旧源', async () => {
  const { sandbox, audio } = loadCombined({
    playQueueAt: async () => {
      audio.currentSrc = 'http://cdn.example.com/a.mp3?sign=NEW_SIGNATURE&token=FRESH';
      audio.src = audio.currentSrc;
      return true;
    },
  });
  const result = await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', { silent: true });
  assert.equal(result, true);
  assert.equal(sandbox.playbackResumeRecovery.recoveryRevisionChanged, false,
    '同一枚链接换个签名不算换到新源');
  assert.equal(sandbox.playbackResumeRecovery.lastSourceRevision,
    'kugou|h1|210|http://cdn.example.com/a.mp3');
});

test('换链换了域名：changedAfterRecovery=true', async () => {
  const { sandbox, audio } = loadCombined({
    playQueueAt: async () => {
      audio.currentSrc = 'http://cdn2.example.com/a.mp3?sign=NEW';
      audio.src = audio.currentSrc;
      return true;
    },
  });
  await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', { silent: true });
  assert.equal(sandbox.playbackResumeRecovery.recoveryRevisionChanged, true);
});

test('换链换了音质（format 参数）：也算换了源', async () => {
  const { sandbox, audio } = loadCombined({
    playQueueAt: async () => {
      audio.currentSrc = 'http://cdn.example.com/a.mp3?format=flac&sign=NEW';
      audio.src = audio.currentSrc;
      return true;
    },
  });
  await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', { silent: true });
  assert.equal(sandbox.playbackResumeRecovery.recoveryRevisionChanged, true);
});

test('没换到源时，二次取链提示「没有备用链接」而不是「换了源仍失败」', async () => {
  const { sandbox, notices, clock, audio } = loadCombined({
    playQueueAt: async () => {
      audio.currentSrc = 'http://cdn.example.com/a.mp3?sign=NEW';
      audio.src = audio.currentSrc;
      return false;
    },
  });
  await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', {});
  notices.length = 0;
  clock.t += 5000; // 越过 1200ms 节流，才能走到「已 exhausted」分支
  const again = await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', {});
  assert.equal(again, false, '同一首歌不重复换链');
  assert.equal(notices.length, 1);
  assert.match(notices[0].body, /没有可用的备用链接/);
  assert.doesNotMatch(notices[0].body, /重新取链后仍无法播放/);
});

test('换到过新源但仍失败时，提示走另一条文案', async () => {
  const { sandbox, notices, clock, audio } = loadCombined({
    playQueueAt: async () => {
      audio.currentSrc = 'http://cdn2.example.com/a.mp3?sign=NEW';
      audio.src = audio.currentSrc;
      return false;
    },
  });
  await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', {});
  notices.length = 0;
  clock.t += 5000;
  await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', {});
  assert.equal(notices.length, 1);
  assert.match(notices[0].body, /重新取链后仍无法播放/);
});

test('换歌会重置源指纹，避免用上一首的「源没变」解释新歌的提示', async () => {
  const { sandbox } = loadCombined();
  sandbox.playbackResumeRecovery.lastSourceRevision = 'old-song-revision';
  sandbox.playbackResumeRecovery.recoveryRevisionChanged = false;
  sandbox.resetPlaybackFreshUrlRecoveryBudget({ id: 'h2', provider: 'qq', duration: 100 });
  assert.equal(sandbox.playbackResumeRecovery.lastSourceRevision, '');
  assert.equal(sandbox.playbackResumeRecovery.recoveryRevisionChanged, null);
  assert.equal(sandbox.playbackResumeRecovery.freshUrlAttemptCount, 0);
});

test('诊断快照带出当前指纹与上次换链结论', async () => {
  const { sandbox, audio } = loadCombined({
    playQueueAt: async () => {
      audio.currentSrc = 'http://cdn2.example.com/a.mp3';
      audio.src = audio.currentSrc;
      return true;
    },
  });
  await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', { silent: true });
  const snap = sandbox.playbackSourceRevisionSnapshot();
  assert.equal(snap.src, 'http://cdn2.example.com/a.mp3');
  assert.equal(snap.revision, 'kugou|h1|210|http://cdn2.example.com/a.mp3');
  assert.equal(snap.lastRevision, 'kugou|h1|210|http://cdn.example.com/a.mp3');
  assert.equal(snap.changedAfterRecovery, true);
});

test('09f 缺席时换链主流程不受影响（typeof 兜底）', async () => {
  const notices = [];
  const clock = { t: 10000 };
  const audio = {
    currentSrc: 'http://cdn.example.com/a.mp3', src: 'http://cdn.example.com/a.mp3',
    currentTime: 1, paused: false, ended: false, seeking: false, readyState: 4, networkState: 1,
  };
  const sandbox = Object.assign({
    console,
    URL,
    setTimeout: () => 1, clearTimeout() {},
    performance: { now: () => clock.t },
    document: { getElementById: () => null },
    showLoading() {}, hideLoading() {}, showToast() {},
    showSourceFallbackNotice: (t, b) => notices.push(b),
    forcePlaybackControlsInteractive() {},
    getMusicProviderKey: () => 'kugou',
    PLAYBACK_RESUME_STALL_DELAYS: [1600, 3600],
    PLAYBACK_RESUME_LONG_PAUSE_MS: 480000,
    PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS: {},
    trackSwitchToken: 1,
    playQueue: [{ id: 'h1', provider: 'kugou', duration: 210 }],
    currentIdx: 0,
    audio,
    playQueueAt: async () => true,
    playbackResumeRecovery: {
      timerIds: [], serial: 0, pending: false, lastAttemptAt: 0,
      freshUrlSongKey: '', freshUrlAttemptCount: 0, softRetryCount: 0,
    },
  });
  vm.createContext(sandbox);
  vm.runInContext(recoverySrc, sandbox); // 故意不注入 09f
  const result = await sandbox.recoverCurrentTrackPlaybackFromFreshUrl('resume-stalled', { silent: true });
  assert.equal(result, true, '分类器缺席不能把恢复能力关掉');
  assert.equal(sandbox.playbackResumeRecovery.recoveryRevisionChanged, null,
    '09f 缺席时结论停在「未知」，不能假装换过源');
});
