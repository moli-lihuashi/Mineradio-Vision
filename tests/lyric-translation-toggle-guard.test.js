'use strict';

/*
 * 歌词译文开关守卫（2026-11-25）
 *
 * 译文是「并进原文行」的（原文上、译文下），入口只有 attachLyricTranslations() 一个：
 * 三个调用点全在 06-lyrics 内部，所以拦住它能一次性覆盖舞台 / 经典 / 桌面歌词 / 小组件。
 *
 * 三条底线：
 *   1) 默认显示（老行为不变）；
 *   2) 关闭时必须在「合并之前」返回，不能先合并再过滤（那样 lastApplied 里会残留译文）；
 *   3) 切换要就地重算当前歌词，而不是等下次切歌。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LYRICS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const fnBody = (marker) => {
  const start = LYRICS_JS.indexOf(marker);
  if (start < 0) return '';
  let depth = 0, opened = false;
  for (let i = LYRICS_JS.indexOf('{', start); i < LYRICS_JS.length; i++) {
    if (LYRICS_JS[i] === '{') { depth++; opened = true; }
    else if (LYRICS_JS[i] === '}') { depth--; if (opened && depth === 0) return LYRICS_JS.slice(start, i + 1); }
  }
  return '';
};

test('默认显示译文，只有明确存 false 才隐藏', () => {
  assert.match(LYRICS_JS, /getItem\(LYRIC_TRANSLATION_VISIBLE_STORE_KEY\) !== 'false'/,
    '默认必须是显示：没存过值不能当成隐藏');
  assert.match(LYRICS_JS, /mineradio:lyric-translation-visible:v1/);
});

test('关闭时在合并之前返回，不能先合并再过滤', () => {
  const body = fnBody('function attachLyricTranslations');
  assert.ok(body, '必须有 attachLyricTranslations');
  const guardPos = body.indexOf('if (!lyricTranslationVisiblePreference) return primary;');
  const mergePos = body.indexOf('usableLyricTranslationLines');
  assert.ok(guardPos > 0, '必须有「关闭即返回」的分支');
  assert.ok(mergePos > 0 && guardPos < mergePos, '分支必须在取译文之前，否则 lastApplied 会残留译文');
  assert.match(body.slice(0, guardPos), /cloneLyricLines/, '返回的必须是克隆行，调用方还会往上写样式字段');
});

test('切换会落盘、同步开关、就地重算', () => {
  const toggle = fnBody('function toggleLyricTranslationVisible');
  assert.ok(toggle, '必须有 toggleLyricTranslationVisible');
  assert.match(toggle, /localStorage\.setItem\(LYRIC_TRANSLATION_VISIBLE_STORE_KEY/);
  assert.match(toggle, /applyLyricTranslationVisibleUi\(\)/);
  assert.match(toggle, /applyLyricApiResponse\(lastAppliedLyricResponse/, '要就地重算当前歌词');
});

test('设置页有开关并在打开时同步', () => {
  assert.match(INDEX, /id="t-lyricTranslationVisible"[^>]*onclick="toggleLyricTranslationVisible\(\)"/);
  assert.match(SETTINGS_JS, /applyLyricTranslationVisibleUi\(\)/);
});
