'use strict';

// =============================================================================
// 汽水「我的喜欢」点 A 播 B / 反复点击卡死重启 —— 回归守卫（2026-11-10）
// -----------------------------------------------------------------------------
// 两个根因：
//   1) 换源匹配用 normalizeMatchText，它会删掉整个括号，导致「歌（氛围版）」与「歌」
//      归一后同名 → 原版顶替氛围版播放（用户侧＝点 A 播 B）。
//   2) 反复点同一首会 cancel 旧换源并重开一轮，每轮都重建封面/纹理/歌词/队列，
//      叠加几轮把渲染进程原生内存打穿 → render-process-gone → 自动重载（用户侧＝卡死重启）。
// 这里锁住：换源用严格同名、recovery 内容键区分版本、同曲复用、结算用参数而非全局。
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '11-provider-fallback.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

// 按大括号配对切真实源码（项目既有做法）。
function sliceFn(src, name) {
  const marker = 'function ' + name + '(';
  let start = src.indexOf(marker);
  if (start < 0) throw new Error('找不到函数：' + name);
  // async 函数要把前缀一起带上，否则切出来是个含 await 的普通函数（语法非法）
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const PRELUDE = [
  'var SOURCE_FALLBACK_RECOVERY_TIMEOUT_MS = 20000;',
  'var SOURCE_FALLBACK_MAX_QUEUE_ADVANCES = 2;',
  'var MAX_RECENT_AUTO_QUEUE_FAILURES = 12;',
  'var sourceFallbackRecoverySerial = 0;',
  'var activeSourceFallbackRecovery = null;',
  'var currentIdx = 0;',
  'var trackSwitchToken = 1;',
  'var queueItemKey = null;',
  'var songProviderKey = function (song) { return (song && (song.provider || song.source)) || ""; };'
].join('\n');

// 匹配相关工具（纯函数，不需要额外依赖）
function loadMatchers(src) {
  const code = [PRELUDE,
    sliceFn(src || source, 'normalizeMatchText'),
    sliceFn(src || source, 'artistNameParts'),
    sliceFn(src || source, 'matchTitleDecoration'),
    sliceFn(src || source, 'isSameTitleArtist'),
    sliceFn(src || source, 'isSameTitleArtistStrict'),
    sliceFn(src || source, 'sourceFallbackSongKey'),
    sliceFn(src || source, 'sourceFallbackRecoveryContentKey'),
    'module.exports = { normalizeMatchText, matchTitleDecoration, isSameTitleArtist, isSameTitleArtistStrict, sourceFallbackRecoveryContentKey };'
  ].join('\n');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Date: Date, JSON: JSON, String: String, Array: Array, Object: Object });
  return mod.exports;
}

// recovery 生命周期（需要 cancel / ensure）
function loadRecovery(src) {
  const code = [PRELUDE,
    sliceFn(src || source, 'normalizeMatchText'),
    sliceFn(src || source, 'artistNameParts'),
    sliceFn(src || source, 'matchTitleDecoration'),
    sliceFn(src || source, 'isSameTitleArtist'),
    sliceFn(src || source, 'isSameTitleArtistStrict'),
    sliceFn(src || source, 'sourceFallbackSongKey'),
    sliceFn(src || source, 'sourceFallbackRecoveryContentKey'),
    sliceFn(src || source, 'sourceFallbackRecoveryFromOptions'),
    sliceFn(src || source, 'sourceFallbackRecoveryIdentityActive'),
    sliceFn(src || source, 'sourceFallbackRecoveryRemainingMs'),
    sliceFn(src || source, 'sourceFallbackRecoveryCanContinue'),
    sliceFn(src || source, 'cancelSourceFallbackRecovery'),
    sliceFn(src || source, 'ensureSourceFallbackRecovery'),
    'module.exports = { ensureSourceFallbackRecovery, cancelSourceFallbackRecovery, sourceFallbackRecoveryContentKey, getActive: function () { return activeSourceFallbackRecovery; } };'
  ].join('\n');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Date: Date, JSON: JSON, String: String, Array: Array, Object: Object });
  return mod.exports;
}

const AMBIENT = { provider: 'qishui', id: '11', name: '我们之间的回忆（氛围版）', artist: '某某' };
const ORIGINAL = { provider: 'netease', id: '99', name: '我们之间的回忆', artist: '某某' };

test('换源严格同名：氛围版不会被原版顶替，但宽松判定仍保持（歌词匹配不受影响）', () => {
  const m = loadMatchers();
  // 宽松判定：歌词 / 搜索打分继续按同名处理，避免「氛围版找不到歌词」
  assert.equal(m.isSameTitleArtist(AMBIENT, ORIGINAL), true, '宽松同名判定应保持原行为');
  // 换源：版本标识不一致 → 拒绝
  assert.equal(m.isSameTitleArtistStrict(AMBIENT, ORIGINAL), false, '氛围版不能被原版顶替');
  assert.equal(m.isSameTitleArtistStrict({ name: '演员（伴奏）', artist: 'A' }, { name: '演员', artist: 'A' }), false);
  assert.equal(m.isSameTitleArtistStrict({ name: '夜曲 (Live)', artist: 'A' }, { name: '夜曲', artist: 'A' }), false);
  // 同一版本的不同写法要能匹配
  assert.equal(m.isSameTitleArtistStrict({ name: '我们之间的回忆（氛围版）', artist: 'A' }, { name: '我们之间的回忆(氛围版)', artist: 'A' }), true, '全角/半角括号应视为同一版本');
  assert.equal(m.isSameTitleArtistStrict({ name: '夜曲 (Live)', artist: 'A' }, { name: '夜曲（live）', artist: 'A' }), true, '大小写与全半角归一');
  // 都没括号：保持原有匹配能力
  assert.equal(m.isSameTitleArtistStrict({ name: '晴天', artist: 'A' }, { name: '晴天', artist: 'A' }), true);
  // 不同版本之间互不顶替
  assert.equal(m.isSameTitleArtistStrict({ name: '演员（伴奏）', artist: 'A' }, { name: '演员 (Live)', artist: 'A' }), false);
});

test('recovery 内容键区分版本，不会把两首当成同一项去重', () => {
  const m = loadMatchers();
  const kAmbient = m.sourceFallbackRecoveryContentKey(AMBIENT);
  const kOriginal = m.sourceFallbackRecoveryContentKey(ORIGINAL);
  assert.notEqual(kAmbient, kOriginal, '氛围版与原版必须有不同内容键');
  const kAmbientHalf = m.sourceFallbackRecoveryContentKey({ name: '我们之间的回忆(氛围版)', artist: '某某' });
  assert.equal(kAmbient, kAmbientHalf, '同版本不同括号写法应归一为同一键');
});

test('反复点同一首歌复用同一次换源，不再 cancel 重开（防 OOM 重启）', () => {
  const r = loadRecovery();
  const first = r.ensureSourceFallbackRecovery({}, AMBIENT, 0, 1);
  assert.ok(first && first.id, '首次应创建 recovery');
  const second = r.ensureSourceFallbackRecovery({}, AMBIENT, 0, 1);
  assert.equal(second, first, '同一首歌连点应复用同一个 recovery 对象');
  assert.equal(second.id, first.id);
  assert.notEqual(first.cancelled, true, '复用时不能被 cancel');

  // 换一首歌仍然要开新事务，并 cancel 旧的（保持原有语义）
  const other = r.ensureSourceFallbackRecovery({}, { provider: 'qishui', id: '12', name: '另一首歌', artist: '某某' }, 1, 2);
  assert.notEqual(other.id, first.id, '不同歌曲应开新事务');
  assert.equal(first.cancelled, true, '旧事务应被取消');
  assert.equal(r.getActive(), other);
});

test('结算使用传入的 idx / token，不读全局 currentIdx / trackSwitchToken', () => {
  const settleCalls = [];
  // 全局值故意指向别的歌（999/777）：旧实现会拿它们去结算，修复后必须用传入的 4/40。
  const globals = PRELUDE
    .replace('var currentIdx = 0;', 'var currentIdx = 999;')
    .replace('var trackSwitchToken = 1;', 'var trackSwitchToken = 777;');
  const code = [globals,
    sliceFn(source, 'normalizeMatchText'),
    sliceFn(source, 'artistNameParts'),
    sliceFn(source, 'matchTitleDecoration'),
    sliceFn(source, 'isSameTitleArtist'),
    sliceFn(source, 'isSameTitleArtistStrict'),
    sliceFn(source, 'sourceFallbackSongKey'),
    sliceFn(source, 'sourceFallbackRecoveryContentKey'),
    sliceFn(source, 'sourceFallbackRecoveryFromOptions'),
    sliceFn(source, 'sourceFallbackRecoveryIdentityActive'),
    sliceFn(source, 'sourceFallbackRecoveryRemainingMs'),
    sliceFn(source, 'sourceFallbackRecoveryCanContinue'),
    sliceFn(source, 'cancelSourceFallbackRecovery'),
    sliceFn(source, 'ensureSourceFallbackRecovery'),
    sliceFn(source, 'settleExpiredSourceFallbackPlayback'),
    'module.exports = { ensureSourceFallbackRecovery, settleExpiredSourceFallbackPlayback };'
  ].join('\n');
  const ctx = {
    module: { exports: {} },
    Date: Date, JSON: JSON, String: String, Array: Array, Object: Object,
    settleSourceFallbackTerminal: function (idx, token) { settleCalls.push([idx, token]); return true; },
    sourceFallbackRecoveryFailureOptions: function () { return null; }
  };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(code, ctx);
  const mod = ctx.module.exports;

  const rec = mod.ensureSourceFallbackRecovery({}, AMBIENT, 4, 40);
  mod.settleExpiredSourceFallbackPlayback(4, 40, { sourceFallbackRecovery: rec }, '超时');
  assert.equal(settleCalls.length, 1, '应完成一次结算');
  assert.deepEqual(settleCalls[0], [4, 40],
    '结算必须用传入的 idx/token，而不是全局 currentIdx/trackSwitchToken');
});

// 审源码本身：调用点、严格判定、内容键、结算参数、同曲复用，任一条失守即报。
function analyzeSource(src) {
  const issues = [];
  if (!/isSameTitleArtistStrict\(\s*identity\.source\s*,/.test(src)) {
    issues.push('换源调用点没有使用严格同名判定');
  }
  if (/isSameTitleArtist\(\s*identity\.source\s*,/.test(src)) {
    issues.push('换源调用点仍在使用宽松同名判定');
  }
  const strictFn = sliceFn(src, 'isSameTitleArtistStrict');
  if (!/matchTitleDecoration\(source\.name \|\| source\.title\)\s*===\s*matchTitleDecoration\(candidate\.name \|\| candidate\.title\)/.test(strictFn)) {
    issues.push('严格判定没有比较版本标识');
  }
  const keyFn = sliceFn(src, 'sourceFallbackRecoveryContentKey');
  if (!/decoration\s*\?/.test(keyFn)) issues.push('内容键没有包含版本标识');
  const settleFn = sliceFn(src, 'settleExpiredSourceFallbackPlayback');
  if (/settleSourceFallbackTerminal\(\s*currentIdx/.test(settleFn)) issues.push('结算用了全局 currentIdx');
  if (!/activeSongKey\s*===\s*songKey/.test(src)) issues.push('缺少同曲换源复用');
  return issues;
}

test('源码守卫：调用点/判定/内容键/结算/复用 五项都在位', () => {
  assert.deepEqual(analyzeSource(source), []);
});

test('源码守卫对 5 个回归变异体全部判红（自检，防假阴性）', () => {
  const mutations = [
    {
      name: '换源调用点退回宽松同名',
      mutate: src => src.replace(
        'if (isSameTitleArtistStrict(identity.source, list[i])) {',
        'if (isSameTitleArtist(identity.source, list[i])) {')
    },
    {
      name: '严格判定忽略版本标识',
      mutate: src => src.replace(
        'return matchTitleDecoration(source.name || source.title) === matchTitleDecoration(candidate.name || candidate.title);',
        'return true;')
    },
    {
      name: '内容键丢掉版本标识',
      mutate: src => src.replace(
        "return title + (decoration ? '{' + decoration + '}' : '') + '|' + artists;",
        "return title + '|' + artists;")
    },
    {
      name: '结算退回全局变量',
      mutate: src => src.replace(
        'return settleSourceFallbackTerminal(\n    idx,\n    token,',
        'return settleSourceFallbackTerminal(\n    currentIdx,\n    trackSwitchToken,')
    },
    {
      name: '同曲复用被删掉',
      mutate: src => src.replace('&& activeSourceFallbackRecovery.activeSongKey === songKey', '&& false')
    }
  ];
  mutations.forEach(m => {
    const mutated = m.mutate(source);
    assert.notEqual(mutated, source, '变异体没有真正改动源码：' + m.name);
    let issues;
    try {
      issues = analyzeSource(mutated);
    } catch (e) {
      issues = ['切片失败：' + (e && e.message)];
    }
    assert.ok(issues.length > 0, '变异体被判红：' + m.name);
  });
});

// -----------------------------------------------------------------------------
// 用户点选不可播的歌：停住并说明，不自动跳下一首（否则就是「点 A 播 B」）。
// 自动连播仍保持「跳过受限歌曲继续播」。
// -----------------------------------------------------------------------------
function loadSkip(src) {
  const ctx = {
    module: { exports: {} },
    Date: Date, JSON: JSON, String: String, Array: Array, Object: Object,
    trackSwitchToken: 1,
    currentIdx: 0,
    playQueue: [
      { provider: 'qishui', id: '11', name: '我们之间的回忆（氛围版）', artist: '某某' },
      { provider: 'netease', id: '22', name: '另一首歌', artist: '某某' }
    ],
    hideLoading: function () {},
    showSourceFallbackNotice: function () {},
    playQueueAt: null,
    settleSourceFallbackTerminal: null
  };
  const code = [PRELUDE,
    sliceFn(src, 'normalizeMatchText'),
    sliceFn(src, 'artistNameParts'),
    sliceFn(src, 'matchTitleDecoration'),
    sliceFn(src, 'isSameTitleArtist'),
    sliceFn(src, 'isSameTitleArtistStrict'),
    sliceFn(src, 'sourceFallbackSongKey'),
    sliceFn(src, 'sourceFallbackRecoveryContentKey'),
    sliceFn(src, 'sourceFallbackRecoveryFromOptions'),
    sliceFn(src, 'sourceFallbackRecoveryIdentityActive'),
    sliceFn(src, 'sourceFallbackRecoveryRemainingMs'),
    sliceFn(src, 'sourceFallbackRecoveryCanContinue'),
    sliceFn(src, 'cancelSourceFallbackRecovery'),
    sliceFn(src, 'completeSourceFallbackRecovery'),
    sliceFn(src, 'ensureSourceFallbackRecovery'),
    sliceFn(src, 'sourceFallbackQueuePlaybackOptions'),
    sliceFn(src, 'markQueueItemPlaybackFailed'),
    sliceFn(src, 'recentQueuePlaybackFailureCount'),
    sliceFn(src, 'nextUnblockedQueueIndex'),
    sliceFn(src, 'skipFailedQueueItem'),
    'module.exports = { skipFailedQueueItem };'
  ].join('\n');
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(code, ctx);
  return { ctx, api: ctx.module.exports };
}

test('用户点选的歌换源无果时停在本曲，不自动跳下一首', () => {
  const { ctx, api } = loadSkip(source);
  const settleCalls = [];
  const playCalls = [];
  ctx.settleSourceFallbackTerminal = (i, t, msg) => { settleCalls.push([i, t, msg]); return false; };
  ctx.playQueueAt = (i) => { playCalls.push(i); return Promise.resolve(true); };

  return api.skipFailedQueueItem(0, 1, '', {
    userPick: true,
    playbackOpts: {},
    sourceFallbackRecovery: null
  }).then(() => {
    assert.equal(playCalls.length, 0, '用户点选时不能被自动跳走');
    assert.equal(settleCalls.length, 1, '应结算为「停在这里」');
    assert.equal(settleCalls[0][0], 0);
    assert.match(String(settleCalls[0][2] || ''), /停在这里/, '提示要说明停住而不是跳走');
  });
});

test('自动连播仍保持原行为：跳过受限歌曲继续播', () => {
  const { ctx, api } = loadSkip(source);
  const settleCalls = [];
  const playCalls = [];
  ctx.settleSourceFallbackTerminal = (i, t, msg) => { settleCalls.push([i, t, msg]); return false; };
  ctx.playQueueAt = (i) => { playCalls.push(i); return Promise.resolve(true); };

  return api.skipFailedQueueItem(0, 1, '没有找到同版本，正在播放下一首。', {
    userPick: false,
    playbackOpts: {},
    sourceFallbackRecovery: null
  }).then(() => {
    assert.equal(playCalls.length, 1, '自动连播应跳到下一首');
    assert.equal(playCalls[0], 1);
    assert.equal(settleCalls.length, 0);
  });
});

test('点歌入口传 userPick，失败路径都让路', () => {
  const listMgr = fs.readFileSync(path.join(appRoot, 'public/js/modules/04-shelf/03-content-list-manager.js'), 'utf8');
  const shelfMgr = fs.readFileSync(path.join(appRoot, 'public/js/modules/04-shelf/00c-shelf-manager.js'), 'utf8');
  const startAudio = fs.readFileSync(path.join(appRoot, 'public/js/modules/05-playback/13-playback-start-audio.js'), 'utf8');
  const core = fs.readFileSync(path.join(appRoot, 'public/js/modules/05-playback/09b-playback-core.js'), 'utf8');

  assert.match(listMgr, /playQueueAt\(playIndex, \{[^}]*userPick: true/, '歌单列表点行必须带 userPick');
  assert.match(shelfMgr, /playQueueAt\(action\.index, \{ userPick: true \}\)/, '歌单架队列卡片必须带 userPick');
  assert.ok(!/playQueueAt\(action\.index\);/.test(shelfMgr), '仍有入口漏传 userPick');
  [startAudio, core].forEach((src, i) => {
    const name = i === 0 ? '13-playback-start-audio' : '09b-playback-core';
    assert.match(src, /!opts\.manual && !opts\.userPick && playQueue\.length > 1/, name + ' 的自动跳歌必须让路用户点选');
    assert.ok(!/!opts\.manual && playQueue\.length > 1/.test(src), name + ' 仍有未加 userPick 守卫的跳歌');
  });
  assert.match(source, /if \(opts\.userPick\) \{/, '换源无果时要按 userPick 分支停住');
  assert.match(source, /userPick: !!!?\(opts && opts\.userPick\)|userPick: !!(opts && opts\.userPick)/, 'skipOpts 必须透传 userPick');
});
