'use strict';

/*
 * 动效降级归一守卫（2026-11-25）
 *
 * 之前「减少动效」只有系统偏好一条路：8 个文件各自 matchMedia。用户想手工减少，没门。
 * 现在判据收口到 00-state/14-motion-system.js：
 *   MineradioMotion.prefersReducedMotion() = 手动 reduce || 系统 reduce
 *   手动模式给 <html> 挂 .reduce-motion，CSS 用一条全局规则收紧（不复制 5 段 @media）。
 *
 * 守四件事：
 *   1) 业务模块不许再自己 matchMedia（漏一处就等于漏一片）；
 *   2) 全局便捷入口 prefersReducedMotionNow() 存在且优先走 MineradioMotion；
 *   3) 只有手动模式才挂 class —— 否则会把系统级那 5 段 @media 的行为也换掉；
 *   4) 设置页有分段并在打开时回填。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MOTION = read('public/js/modules/00-state/14-motion-system.js');
const INDEX_CSS = read('public/css/index.css');
const INDEX = read('public/index.html');
const SETTINGS_JS = read('public/js/modules/10-shell/31-settings-page.js');

const CONSUMERS = [
  'public/js/modules/02-home/03-home-weather-fx.js',
  'public/js/modules/05-playback/03c-home-hero-grid.js',
  'public/js/modules/05-playback/06e-heart-fx.js',
  'public/js/modules/05-playback/06f-heart-scene.js',
  'public/js/modules/06-lyrics/02-playlist-detail.js',
  'public/js/modules/10-shell/01-splash-and-boot.js',
  'public/js/modules/10-shell/04-desktop-overlay-fullscreen.js'
];

test('业务模块不再各自 matchMedia，统一走 prefersReducedMotionNow', () => {
  const offenders = CONSUMERS.filter((p) => read(p).includes("matchMedia('(prefers-reduced-motion: reduce)')"));
  assert.deepEqual(offenders, [], `这些文件还在自己判断系统偏好：${offenders.join(', ')}`);
  const missing = CONSUMERS.filter((p) => !read(p).includes('prefersReducedMotionNow()'));
  assert.deepEqual(missing, [], `这些文件没有走统一入口：${missing.join(', ')}`);
});

test('统一入口优先读 MineradioMotion，读不到才回落到 matchMedia', () => {
  assert.match(MOTION, /function prefersReducedMotionNow\(\)/);
  const fn = MOTION.slice(MOTION.indexOf('function prefersReducedMotionNow()'));
  assert.match(fn, /MineradioMotion\.prefersReducedMotion/, '必须优先问 MineradioMotion');
  assert.match(fn, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, '取不到时要能回落到系统偏好');
});

test('手动模式才挂 html.reduce-motion，系统级仍走原 @media', () => {
  assert.match(MOTION, /prefersReducedMotion\(\)[\s\S]{0,200}?_rmMode === 'reduce'/) ||
    assert.match(MOTION, /if \(_rmMode === 'reduce'\) return true;/);
  const applyClass = MOTION.slice(MOTION.indexOf('function applyReduceMotionClass'), MOTION.indexOf('function applyReduceMotionUi'));
  assert.match(applyClass, /_rmMode === 'reduce'/, '挂类只看用户设置，不能把系统偏好也变成类');
  assert.match(INDEX_CSS, /html\.reduce-motion \*/, 'CSS 必须有手动模式的全局收紧规则');
  assert.ok(INDEX_CSS.includes('transition-duration:.01ms!important'), '必须把过渡收紧到即时');
  assert.ok(INDEX_CSS.includes('animation-duration:.01ms!important'), '必须把动画收紧到即时');
});

test('设置页有分段，打开时回填，切换落盘', () => {
  assert.match(INDEX, /id="motion-reduce-seg"/);
  assert.match(INDEX, /data-motion-reduce="auto"/);
  assert.match(INDEX, /data-motion-reduce="reduce"/);
  assert.match(SETTINGS_JS, /function bindMotionReduce\(\)/);
  assert.match(SETTINGS_JS, /setReduceMotionMode\(/);
  assert.match(SETTINGS_JS, /applyReduceMotionUi\(\)/);
  assert.match(MOTION, /mineradio:motion-reduce:v1/);
});
