'use strict';

/*
 * 全局歌词偏移守卫（2026-11-25）
 *
 * Folia 的 `globalLyricTimelineOffset` 对应到我们这边是「设置 → 歌词 → 时间校准」。
 * 关键是它必须和既有的「逐曲偏移」叠在同一条链路上，而不是各算各的：
 *
 *   getAdjustedLyricPlaybackTime(raw)  =  max(0, raw + 逐曲 + 全局)
 *
 * 舞台歌词 / 经典歌词 / 桌面歌词 / 悬浮小组件 / Folia 读的都是
 * `getAdjustedLyricPlaybackTime()`，所以只要这一个函数对了，五处一起对。
 *
 * 最容易写错的地方：`adjustCurrentLyricTimingOffset()`（桌面歌词上的 ±0.1 按钮）
 * 写的是**逐曲**记录。如果它拿求和后的 `getActiveLyricTimingOffsetSeconds()` 做基准，
 * 每按一次就会把全局值累进逐曲记录里 —— 表面能调，但逐曲记录会被污染，
 * 换成别的歌再切回来值就飘了。这里把这条钉死。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TIMING_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/06b-startup-autoplay-timing.js'), 'utf8');
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

test('全局偏移单独持久化，并钳在 ±3 秒', () => {
  assert.match(TIMING_JS, /GLOBAL_LYRIC_OFFSET_STORE_KEY = 'mineradio:lyric-global-offset:v1'/,
    '必须有自己的存储键，不能和逐曲偏移共用一个 map');
  assert.match(TIMING_JS, /GLOBAL_LYRIC_OFFSET_LIMIT = 3/);
  const normalize = fnBody(TIMING_JS, 'function normalizeGlobalLyricTimingOffset');
  assert.ok(normalize, '必须有归一化函数');
  assert.match(normalize, /GLOBAL_LYRIC_OFFSET_LIMIT/, '归一化必须钳制上下限');
  const setter = fnBody(TIMING_JS, 'function setGlobalLyricTimingOffset');
  assert.match(setter, /localStorage\.setItem\(GLOBAL_LYRIC_OFFSET_STORE_KEY/,
    '设置后必须落盘，否则重启就丢');
});

test('总偏移 = 逐曲 + 全局（五处歌词共用这一个出口）', () => {
  const active = fnBody(TIMING_JS, 'function getActiveLyricTimingOffsetSeconds');
  assert.match(active, /getLyricTimingOffsetForSong\(/, '必须包含逐曲偏移');
  assert.match(active, /globalLyricTimingOffset/, '必须叠加全局偏移');
  const adjusted = fnBody(TIMING_JS, 'function getAdjustedLyricPlaybackTime');
  assert.match(adjusted, /getActiveLyricTimingOffsetSeconds\(\)/,
    '时间入口必须只读这一个总偏移');
  assert.match(adjusted, /Math\.max\(0,/, '负偏移不能把时间弄成负数');
});

test('逐曲 ±0.1 的基准是逐曲值，不能把全局值累进去', () => {
  const adjust = fnBody(TIMING_JS, 'function adjustCurrentLyricTimingOffset');
  assert.ok(adjust, '必须有 adjustCurrentLyricTimingOffset');
  assert.match(adjust, /getLyricTimingOffsetForSong\(/, '基准必须是逐曲偏移');
  assert.doesNotMatch(adjust, /getActiveLyricTimingOffsetSeconds\(\)/,
    '基准不能是求和后的总偏移：每按一次都会把全局值累进逐曲记录');
});

test('设置页有对应的控件，并在打开时同步当前值', () => {
  assert.match(INDEX, /id="global-lyric-offset-range"[^>]*min="-3"[^>]*max="3"[^>]*step="0\.1"/,
    '全局偏移滑块必须是 -3..3 秒、0.1 一档');
  assert.match(INDEX, /id="global-lyric-offset-range"[^>]*oninput="setGlobalLyricTimingOffset\(this\.value\)"/);
  assert.match(INDEX, /id="global-lyric-offset-value"/);
  assert.match(INDEX, /id="global-lyric-offset-reset"[^>]*onclick="resetGlobalLyricTimingOffset\(\)"/);
  assert.match(SETTINGS_JS, /applyGlobalLyricTimingOffsetUi\(\)/,
    '打开设置页时必须把已保存的值回填到滑块');
});
