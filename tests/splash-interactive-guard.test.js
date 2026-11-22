'use strict';

/*
 * 开屏退场可交互守卫（2026-11-22）
 *
 * 现象：启动后窗口已经出现，但 1 秒多内点不动任何功能。
 * 根因：dismissSplash() 先给 #splash 加 .exiting（pointer-events:none，视觉淡出），
 * 但 body 上的 .splash-active 要等 1180ms 的 setTimeout 结束才摘掉；而
 * `body.splash-active #empty-home{visibility:hidden!important;pointer-events:none!important}`
 * 只认 .splash-active、不认退场态 —— 于是整段淡出动画期间首页被按死。
 * #hint / #top-right / #canvas-container 早就用的是 :not(.splash-revealing)，
 * #empty-home 是唯一漏掉的那条。
 *
 * 这里守三件事：
 *   1) 首页压制规则必须只作用于「未进入退场」的开屏；
 *   2) splash 自身在退场态必须放开点击（不能挡住刚露出的首页）；
 *   3) dismissSplash 必须先加 splash-revealing、再排 1180ms 的收尾。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME_CSS = fs.readFileSync(path.join(ROOT, 'public/css/02-home/home.css'), 'utf8');
const INDEX_CSS = fs.readFileSync(path.join(ROOT, 'public/css/index.css'), 'utf8');
const SPLASH_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/01-splash-and-boot.js'), 'utf8');

test('首页压制规则只作用于未退场的开屏', () => {
  const line = HOME_CSS.split(/\r?\n/).find((l) => l.includes('body.splash-active') && l.includes('#empty-home'));
  assert.ok(line, '必须存在 splash-active 对 #empty-home 的压制规则');
  assert.match(
    line,
    /body\.splash-active:not\(\.splash-revealing\)\s+#empty-home/,
    '#empty-home 压制必须排除 .splash-revealing，否则退场 1180ms 内点不动',
  );
  assert.match(line, /pointer-events:none!important/, '压制仍需保留 pointer-events:none');
});

test('沉浸模式仍然隐藏首页（这次改动不能顺手放开它）', () => {
  const line = HOME_CSS.split(/\r?\n/).find((l) => l.includes('body.splash-active') && l.includes('#empty-home'));
  assert.match(line, /body\.immersive-mode #empty-home/, '沉浸模式必须继续压制首页');
});

test('开屏自身在退场态放开点击', () => {
  const exiting = INDEX_CSS.split(/\r?\n/).find((l) => l.startsWith('#splash.exiting{'));
  assert.ok(exiting, '必须存在 #splash.exiting 规则');
  assert.match(exiting, /pointer-events:none/, '退场态 splash 必须 pointer-events:none，不能挡住首页');
});

test('dismissSplash 先进入退场态、再排 1180ms 收尾', () => {
  const start = SPLASH_JS.indexOf('function dismissSplash()');
  assert.ok(start > 0, '必须存在 dismissSplash');
  const body = SPLASH_JS.slice(start, start + 2600);
  const addRevealing = body.indexOf("classList.add('splash-revealing')");
  const removeSplashActive = body.indexOf("classList.remove('splash-active')");
  assert.ok(addRevealing > 0, '退场时必须加 splash-revealing');
  assert.ok(removeSplashActive > addRevealing, 'splash-active 的摘除必须在退场态之后（1180ms 收尾里）');
  assert.match(body, /\}, 1180\);/, '收尾延迟必须保持与 CSS transform 1180ms 一致');
});
