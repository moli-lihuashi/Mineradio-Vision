'use strict';

/*
 * 歌词时间粒度守卫（2026-11-25）
 *
 * 原来的选源是一句 `nativeLines.length ? nativeLines : lrcLines` —— 只要平台回了 yrc
 * 就永远用逐字。有些平台的逐字时间轴是坏的（整句挤在同一点），表现成「不跟着唱」，
 * 用户没有任何办法。现在有「自动 / 强制逐行」，决策收在 chooseLyricLines() 这个纯函数里。
 *
 * 三个必须成立的性质：
 *   1) 自动模式下行为与改动前完全一致（有逐字就逐字）；
 *   2) 强制逐行只在「确实有逐行候选」时生效 —— 只回了逐字的歌不能变成空白；
 *   3) 切粒度要就地重算当前这首歌，而不是等下一次切歌。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LYRICS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

function sliceFn(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let depth = 0, opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  return '';
}

/* 把两个纯函数原样拿出来执行 */
const pureSrc = sliceFn(LYRICS_JS, 'function lyricLinesHaveWordTiming') + '\n' + sliceFn(LYRICS_JS, 'function chooseLyricLines');
const { chooseLyricLines } = new Function(pureSrc + '\nreturn { chooseLyricLines };')();

const wordLines = [{ text: 'a', words: [{ w: 'a', t: 0 }] }, { text: 'b', words: [{ w: 'b', t: 1 }] }];
const plainLines = [{ text: 'a', source: 'lrc' }, { text: 'b', source: 'lrc' }];

test('自动模式：有逐字就用逐字，行为与改动前一致', () => {
  const r = chooseLyricLines(wordLines, plainLines, 'auto');
  assert.equal(r.lines, wordLines);
  assert.equal(r.hasNativeKaraoke, true);
  assert.equal(r.timingSource, 'yrc-word');
});

test('自动模式：没有逐字时退回逐行', () => {
  const r = chooseLyricLines([], plainLines, 'auto');
  assert.equal(r.lines, plainLines);
  assert.equal(r.hasNativeKaraoke, false);
  // parseLyricText 会给每行写 source（lrc / ttml …），有 source 就优先报它
  assert.equal(r.timingSource, 'lrc');
});

test('强制逐行：忽略逐字时间轴，改用逐行候选', () => {
  const r = chooseLyricLines(wordLines, plainLines, 'line');
  assert.equal(r.lines, plainLines);
  assert.equal(r.hasNativeKaraoke, false, '逐行模式不能还把 karaoke 标记留着');
  assert.equal(r.timingSource, 'lrc');
});

test('强制逐行：只有逐字歌词时不能变成空白', () => {
  const r = chooseLyricLines(wordLines, [], 'line');
  assert.equal(r.lines, wordLines, '没有逐行候选时必须退回逐字，而不是给空数组');
  assert.equal(r.hasNativeKaraoke, true);
});

test('两份都空时落到 fallback', () => {
  const r = chooseLyricLines([], [], 'line');
  assert.deepEqual(r.lines, []);
  assert.equal(r.timingSource, 'fallback');
});

test('解析处真的用了这个决策，并且切换时就地重算', () => {
  assert.match(LYRICS_JS, /chooseLyricLines\(nativeLines, lrcLines, lyricGranularityPreference\)/,
    'applyLyricApiResponse 必须把用户设置传进决策函数');
  assert.match(LYRICS_JS, /lastAppliedLyricResponse = r;/, '要留下上一次响应，切粒度时才能就地重算');
  const setter = sliceFn(LYRICS_JS, 'function setLyricGranularity');
  assert.match(setter, /applyLyricApiResponse\(lastAppliedLyricResponse/, '切换后要立刻重算当前歌词');
  assert.match(setter, /localStorage\.setItem\(LYRIC_GRANULARITY_STORE_KEY/);
});

test('设置页有分段控件，并由设置页脚本绑定', () => {
  assert.match(INDEX, /id="lyric-granularity-seg"/);
  assert.match(INDEX, /data-lyric-granularity="auto"/);
  assert.match(INDEX, /data-lyric-granularity="line"/);
  assert.match(SETTINGS_JS, /function bindLyricGranularity\(\)/);
  assert.match(SETTINGS_JS, /setLyricGranularity\(/);
  assert.match(SETTINGS_JS, /applyLyricGranularityUi\(\)/);
});
