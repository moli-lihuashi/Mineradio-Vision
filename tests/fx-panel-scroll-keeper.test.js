'use strict';

// FX 面板滚动位置守护（2026-11-21）
//
// 用户实测：视觉控制台里点某些功能按钮后，面板会自己滚回最顶。
// 机制：面板里的列表/选项组是「清空再重建」的（Folia 样式网格、自定义字体、
// 调参面板），重建那一瞬间内容高度归零，浏览器把 .fx-scroll 的 scrollTop 钳到 0，
// 高度恢复后位置不会自己回来。
// 这里钉住守护的四条硬要求，避免以后被改回「无脑恢复」或干脆删掉。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'public/js/modules/07-fx/05b-fx-panel-layout.js'), 'utf8');
const bindings = fs.readFileSync(path.join(root, 'public/js/modules/07-fx/07-bindings-shelf-immersive.js'), 'utf8');

const fnStart = layout.indexOf('function bindFxPanelScrollKeeper');
const keeper = fnStart >= 0 ? layout.slice(fnStart) : '';

test('面板绑定时装上滚动守护', () => {
  assert.ok(keeper, '找不到 bindFxPanelScrollKeeper');
  assert.match(bindings, /bindFxPanelScrollKeeper\(\)/, 'bindFxPanelDom 里没有调用守护：按钮点了还是会滚回最顶');
});

test('守护只兜「点击引起」的归零，且在捕获阶段', () => {
  assert.match(keeper, /querySelector\('\.fx-scroll'\)/, '没有定位到真正的滚动容器 .fx-scroll');
  assert.match(keeper, /panel\.addEventListener\('click'/, '没有监听面板点击');
  assert.match(keeper, /\}, true\);/, 'click 监听没走捕获阶段：子按钮的 click 可能被 stopPropagation 挡掉');
  assert.match(keeper, /if \(!\(before > 24\)\) return;/, '没有最小位置门槛：在顶部附近点击也去干预');
});

test('双帧 + 320ms 各查一次（同步重建与分帧重建都覆盖）', () => {
  assert.match(keeper, /requestAnimationFrame\(function \(\) \{ requestAnimationFrame\(restore\); \}\)/, '缺少双帧检查');
  assert.match(keeper, /setTimeout\(restore, 320\)/, '缺少异步重建的兜底检查');
});

test('用户主动回顶 / 内容变短时不干预', () => {
  for (const evt of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
    assert.match(keeper, new RegExp("'" + evt + "'"), '用户意图事件缺少 ' + evt);
  }
  assert.match(keeper, /clickAt - userIntentAt < 250/, '没有「刚滚过就点」的豁免');
  /* 关键：点击之后的滚动意图必须能取消恢复。用固定时间窗会漏掉 320ms 兜底那次。 */
  assert.match(keeper, /userIntentAt > clickAt/, '点击后的用户滚动没有取消恢复：320ms 兜底会把人拉回去');
  assert.match(keeper, /scrollHeight - sc\.clientHeight < before - 8/, '内容真的变短时仍强行恢复：会顶出不存在的滚动位置');
  assert.match(keeper, /if \(sc\.scrollTop > 8\) return;/, '没有「已经能滚了就不干预」的早退');
});
