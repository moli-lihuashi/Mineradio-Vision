'use strict';

/*
 * 随机播放不重复（按轮次）守卫（2026-11-25）
 *
 * 对应 Folia 的 `shuffleRoundNoRepeat`。原来的随机播放是「每次从除当前曲外的全集里抽」，
 * 同一首一小时里会反复出现。现在打开开关后按轮次抽：本轮播过的不再入池，池空才开新轮。
 *
 * 四个容易写坏的点：
 *   1) 入口分支必须**先**判断开关，否则永远走不到按轮次的实现；
 *   2) 「已播」必须在真正开始播放的地方登记（playQueueAt 里 currentIdx 赋值之后），
 *      只在 nextTrack 里登记的话，手动点歌不会计入本轮，会重复播；
 *   3) 手动洗牌 / 切换播放模式必须开新一轮，否则沿用旧记录会无故跳过一半的歌；
 *   4) 池空时清记录再重建，且当前曲不入池，避免新一轮第一首又是刚播完那首。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PLAYBACK_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/13-playback-start-audio.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const fnBody = (source, marker) => {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let depth = 0;
  let opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  return '';
};

test('开关独立持久化，默认关闭', () => {
  assert.match(PLAYBACK_JS, /SHUFFLE_NO_REPEAT_STORE_KEY = 'mineradio:shuffle-no-repeat:v1'/);
  assert.match(PLAYBACK_JS, /localStorage\.getItem\(SHUFFLE_NO_REPEAT_STORE_KEY\) === 'true'/,
    '默认必须是关闭：没存过值时不能当成开启');
  const toggle = fnBody(PLAYBACK_JS, 'function toggleShuffleNoRepeat');
  assert.match(toggle, /localStorage\.setItem\(SHUFFLE_NO_REPEAT_STORE_KEY/);
  assert.match(toggle, /resetShuffleRound\(\)/, '切换开关要开新一轮');
});

test('随机取下一首必须先走按轮次分支', () => {
  const entry = fnBody(PLAYBACK_JS, 'function shuffleNextTrackIndex');
  assert.ok(entry, '必须有 shuffleNextTrackIndex');
  const branchPos = entry.indexOf('shuffleNoRepeatPreference) return shuffleRoundNextIndex()');
  const randomPos = entry.indexOf('Math.random()');
  assert.ok(branchPos > 0, '入口必须判断开关并转给 shuffleRoundNextIndex');
  assert.ok(branchPos < randomPos, '分支必须写在纯随机实现之前，否则永远是纯随机');
});

test('按轮次实现：池空重建、当前曲不入池', () => {
  const fn = fnBody(PLAYBACK_JS, 'function shuffleRoundNextIndex');
  assert.ok(fn, '必须有 shuffleRoundNextIndex');
  assert.match(fn, /shuffleRoundPlayedKeys\[key\]/, '要跳过本轮已播');
  assert.match(fn, /shuffleRoundPlayedKeys = \{\}/, '池空必须清空本轮记录');
  assert.match(fn, /i !== currentIdx/, '当前曲不能进新一轮的池子');
});

test('「已播」在真正起播处登记（手动点歌也要算）', () => {
  const playAt = fnBody(PLAYBACK_JS, 'async function playQueueAt');
  assert.ok(playAt, '必须有 playQueueAt');
  const idxPos = playAt.indexOf('currentIdx = idx;');
  const notePos = playAt.indexOf('noteShufflePlayedIndex(idx)');
  assert.ok(idxPos > 0 && notePos > idxPos,
    '必须在 currentIdx = idx 之后登记，且不能只写在 nextTrack 里');
});

test('手动洗牌与切模式都开新一轮', () => {
  const shuffleQueueFn = fnBody(PLAYBACK_JS, 'function shuffleQueue');
  assert.match(shuffleQueueFn, /resetShuffleRound\(\)/, '手动洗牌=新轮');
  const cycle = fnBody(PLAYBACK_JS, 'function cyclePlayMode');
  assert.match(cycle, /resetShuffleRound\(\)/, '进出随机模式=新轮');
});

test('设置页有开关，并在打开时同步状态', () => {
  assert.match(INDEX, /id="t-shuffleNoRepeat"[^>]*onclick="toggleShuffleNoRepeat\(\)"/);
  assert.match(SETTINGS_JS, /applyShuffleNoRepeatUi\(\)/,
    '打开设置页要回填开关状态，否则显示与实际相反');
});
