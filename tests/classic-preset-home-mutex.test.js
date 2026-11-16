'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/04-home-empty-wallpaper.js'), 'utf8');
const GRID = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/04-preset-grid-uniforms.js'), 'utf8');
const LYRICS_CSS = fs.readFileSync(path.join(ROOT, 'public/css/06-lyrics/lyrics.css'), 'utf8');
const HOME_CSS = fs.readFileSync(path.join(ROOT, 'public/css/02-home/home.css'), 'utf8');

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'missing markers: ' + from + ' -> ' + to);
  return source.slice(start, end);
}

test('经典预设不再被当作需要为 HOME 隐藏的覆盖层', () => {
  const fn = slice(HOME, 'function hasActivePresetOverlay() {', 'function snapshotPresetLayersForHome() {');
  assert.doesNotMatch(fn, /isClassicPresetActive\(\)/, 'classic preset must NOT count as a hide-on-home overlay');
  assert.match(fn, /sonic-topography-active/, 'sonic topography is the only remaining overlay');
});

test('HOME 空场态不再用 visibility:hidden 藏掉经典播放器', () => {
  const rule = LYRICS_CSS.slice(
    LYRICS_CSS.indexOf('body.empty-home-active #classic-player.active'),
    LYRICS_CSS.indexOf('\n', LYRICS_CSS.indexOf('body.empty-home-active #classic-player.active'))
  );
  assert.doesNotMatch(rule, /visibility:hidden/, 'empty-home must not visibility:hidden classic player');
  assert.doesNotMatch(rule, /opacity:0/, 'empty-home must not opacity:0 classic player');
  assert.match(rule, /z-index:2/, 'classic player stays behind home content');
  assert.match(rule, /pointer-events:none/, 'classic player must not steal interaction');
});

test('home-preset-enter 不再把经典播放器一起藏掉', () => {
  const enterRule = HOME_CSS.slice(
    HOME_CSS.indexOf('body.home-preset-enter #sonic-topography-frame'),
    HOME_CSS.indexOf('\n', HOME_CSS.indexOf('body.home-preset-enter #sonic-topography-frame'))
  );
  assert.doesNotMatch(enterRule, /#classic-player/, 'home-preset-enter must only hide sonic, not classic');
  assert.match(enterRule, /#sonic-topography-frame/, 'sonic still hidden on home entry');
});

test('经典预设激活时空场 HOME 不接管', () => {
  const core = slice(HOME, 'function shouldShowEmptyHomeCore(ignoreSplash) {', 'function shouldShowEmptyHome() {');
  assert.match(core, /isClassicPresetActive\(\)\) return false/);
  const classicAt = core.indexOf('isClassicPresetActive');
  const forcedAt = core.indexOf('homeForcedOpen');
  assert.ok(classicAt >= 0 && classicAt < forcedAt, 'classic gate precedes forced-open');
});

test('切预设时刷新 HOME 可见性', () => {
  const block = slice(GRID, "applyClassicPresetState(p === CLASSIC_PRESET_INDEX);", '  refreshPresetGrid();');
  assert.match(block, /updateEmptyHomeVisibility\(\{ forceLoad: false \}\)/);
  assert.match(block, /if \(changed && typeof updateEmptyHomeVisibility === 'function'\)/);
});

test('突变守卫：回退任一修复都必须失败', () => {
  // 1) 经典预设重新被当作覆盖层
  const overlay = slice(HOME, 'function hasActivePresetOverlay() {', 'function snapshotPresetLayersForHome() {');
  assert.throws(() => {
    assert.doesNotMatch(overlay.replace("return document.body.classList.contains('sonic-topography-active');",
      "return isClassicPresetActive() || document.body.classList.contains('sonic-topography-active');"), /isClassicPresetActive\(\)/);
  });
  // 2) empty-home 又加回 visibility:hidden
  assert.throws(() => {
    assert.doesNotMatch(LYRICS_CSS.replace('pointer-events:none!important;transition:none!important}',
      'pointer-events:none!important;visibility:hidden!important;transition:none!important}'), /visibility:hidden/);
  });
  // 3) home-preset-enter 又加回 #classic-player
  assert.throws(() => {
    assert.doesNotMatch(HOME_CSS.replace('body.home-preset-enter #sonic-topography-frame,',
      'body.home-preset-enter #classic-player,\nbody.home-preset-enter #classic-player.active,\nbody.home-preset-enter #sonic-topography-frame,'), /#classic-player/);
  });
});
