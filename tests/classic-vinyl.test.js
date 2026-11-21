'use strict';

// 原世界「经典预设」黑胶唱片守卫（2026-11-21）
//
// 用户要求：经典预设里的封面改成黑胶唱片，播放时唱片旋转、唱臂落下，
// 暂停时唱臂抬起、唱片停转；经典布局/歌词/歌曲信息不动。
//
// 这里钉三件事：
//   1) #cp-cover 是碟心（在 .cp-vinyl-disc 里），不是整张封面；
//   2) 播放态只切 #classic-player.cp-playing 一个 class，CSS 负责转动/唱臂；
//   3) JS 每帧只做一次布尔比较，状态没变不写 DOM。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/06-lyrics/lyrics.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/js/modules/02-visual/01-ripple-classic-float.js'), 'utf8');

test('经典预设：封面改成黑胶碟心，碟面/纹路/高光/唱臂齐全', () => {
  assert.match(html, /<div class="cp-vinyl"[\s\S]{0,1600}<div class="cp-vinyl-disc">[\s\S]{0,600}id="cp-cover"/,
    'cp-cover 不在 cp-vinyl-disc 里：封面没变成碟心');
  for (const cls of ['cp-vinyl-grooves', 'cp-vinyl-rim', 'cp-vinyl-sheen', 'cp-vinyl-arm']) {
    assert.ok(html.includes(cls), '缺少 ' + cls);
  }
  assert.match(html, /id="cpVinylArmShadow"/, '唱臂阴影滤镜缺失');
});

test('经典预设：播放时唱片转、唱臂落；暂停时停转、唱臂抬', () => {
  assert.match(css, /@keyframes cp-vinyl-spin\{to\{transform:rotate\(360deg\)\}\}/,
    '缺少唱片旋转关键帧');
  assert.match(css, /\.cp-vinyl-disc\{[^}]*animation:cp-vinyl-spin[^}]*animation-play-state:paused/,
    '唱片默认必须是暂停态（未播放不转）');
  assert.match(css, /#classic-player\.cp-playing \.cp-vinyl-disc\{animation-play-state:running\}/,
    '播放态没有启动唱片旋转');
  assert.match(css, /\.cp-vinyl-arm\{[^}]*transform:rotate\(-50deg\)/,
    '唱臂默认（暂停）应为抬起角度 -50deg');
  assert.match(css, /#classic-player\.cp-playing \.cp-vinyl-arm\{transform:rotate\(0deg\)\}/,
    '播放态唱臂没有落下');
  assert.match(css, /\.cp-vinyl-arm\{[^}]*transition:transform \.9s/,
    '唱臂落下/抬起需要过渡，不能瞬移');
});

test('经典预设：播放态每帧只切一个 class，状态不变不写 DOM', () => {
  assert.match(js, /function updateClassicPlayerVinylState\(\)/,
    '缺少黑胶播放态同步函数');
  const fn = js.slice(js.indexOf('function updateClassicPlayerVinylState'), js.indexOf('function updateClassicPlayerVinylState') + 700);
  assert.match(fn, /classicPlayer\._vinylPlaying === spinning/, '缺少状态比较，每帧都会写 classList');
  assert.match(fn, /classList\.toggle\('cp-playing', spinning\)/, '没有切 cp-playing');
  assert.match(js, /updateClassicPlayerVinylState\(\);\s*\/\/|updateClassicPlayerVinylState\(\);/, '没有调用点');
  const songFn = js.slice(js.indexOf('function updateClassicPlayerSong'), js.indexOf('function updateClassicPlayerVinylState'));
  assert.match(songFn, /updateClassicPlayerVinylState\(\)/, '切歌/激活时没有同步播放态');
});

test('经典预设：碟心封面仍由 updateClassicPlayerSong 写入', () => {
  const songFn = js.slice(js.indexOf('function updateClassicPlayerSong'), js.indexOf('function updateClassicPlayerVinylState'));
  assert.match(songFn, /getElementById\('cp-cover'\)/, '找不到 cp-cover');
  assert.match(songFn, /coverEl\.style\.backgroundImage/, '碟心没有写封面图');
});
