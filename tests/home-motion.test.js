'use strict';

/*
 * Home 入场 / 退场 / 冷却反馈动效守卫（2026-11-25）
 *
 * 目的：把 400ms Home 切换冷却解释成可见动效，而不是「点了没反应」。
 *  1) 进入 Home：天气/主视觉区与 LiquidGlass 卡片分段飞入，动画时长对齐 400ms 冷却；
 *  2) 退出 Home：#empty-home 淡出 + 轻微下移，不瞬间消失；
 *  3) 冷却期内重复点击：不切换，只让卡片或 Home 按钮回弹一次作为反馈；
 *  4) 只用 opacity/transform，且 reduced-motion 下全部关闭。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/css/02-home/home.css'), 'utf8');
const HOME_SURFACE = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/04-home-empty-wallpaper.js'), 'utf8');
const HOME_ACTIONS = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/05-home-actions.js'), 'utf8');

test('Home 入场动效：关键帧、卡片分段、时长对齐 400ms 冷却', () => {
  assert.match(CSS, /@keyframes home-hero-in/, '必须有天气/主视觉入场关键帧');
  assert.match(CSS, /@keyframes home-card-in/, '必须有卡片入场关键帧');
  assert.match(CSS, /#empty-home\.home-enter-anim \.home-hero\{animation:home-hero-in/, '主视觉必须入场');
  assert.match(CSS, /#empty-home\.home-enter-anim \.home-grid \.home-card\{animation:home-card-in/, 'LiquidGlass 卡片必须入场');
  // 卡片动画必须带 !important：home.css 第 13 行有
  // body.empty-home-active .home-card{animation:none!important}，不加会被压成 none
  assert.match(CSS, /#empty-home\.home-enter-anim \.home-grid \.home-card\{animation:home-card-in[^}]*!important\}/, '卡片动画必须用 !important 覆盖 active 态的 animation:none');
  // 卡片必须有错峰延迟（飞入层次感），且延迟同样要 !important
  assert.match(CSS, /\.home-card:nth-child\(2\)\{animation-delay:\.04s!important\}/, '卡片必须有错峰延迟');
  // 动画时长应在 400ms 量级（对齐冷却，不让人等更久）
  assert.match(CSS, /home-card-in \.4[0-9]s/, '卡片动画时长应约 400ms');
});

test('冷却回弹必须是静态高亮（不跑逐帧动画，避免玻璃合成加压）', () => {
  assert.match(CSS, /#empty-home\.home-cooldown-nudge \.home-grid \.home-card\{[^}]*border-color/, '回弹必须是卡片静态高亮');
  assert.match(CSS, /#empty-home\.home-cooldown-nudge \.home-rail \.listening-today-card\{[^}]*border-color/, '回弹必须覆盖右侧 Rail');
  assert.match(CSS, /#home-btn\.home-btn-cooldown-pulse\{[^}]*border-color/, 'Home 按钮必须有静态高亮');
  // 冷却反馈不允许再用 keyframes 动画
  assert.ok(!/\.home-cooldown-nudge[^{]*\{animation:/.test(CSS), '冷却反馈不得使用逐帧动画');
});

test('Home 退场：容器淡出并延迟隐藏，不瞬间消失', () => {
  assert.match(CSS, /#empty-home\{position:fixed[^}]*opacity:0/, '基础态必须透明');
  assert.match(CSS, /#empty-home\{[^}]*transition:opacity \.16s ease,transform \.16s/, '基础态必须有淡出/位移过渡');
  assert.match(CSS, /visibility 0s linear \.16s/, '隐藏必须延迟到淡出结束');
  assert.match(CSS, /body\.empty-home-active #empty-home\{[^}]*transition:opacity 0s/, '入场必须立即显示，交给卡片动画');
});

test('冷却期内重复点击必须触发回弹反馈，而不是静默忽略', () => {
  const start = HOME_ACTIONS.indexOf('function goHome()');
  assert.ok(start > 0, '必须存在 goHome');
  const body = HOME_ACTIONS.slice(start, start + 900);
  assert.match(body, /homeToggleCooldownUntil\)[\s\S]{0,160}homeCooldownNudge\(\)[\s\S]{0,80}return/, '冷却分支必须先 nudge 再 return');
});

test('回弹反馈：Home 可见时动卡片，隐藏时动按钮，并有节流', () => {
  assert.match(HOME_SURFACE, /function homeCooldownNudge\(\)/, '必须有回弹反馈函数');
  assert.match(HOME_SURFACE, /classList\.contains\('empty-home-active'\)[\s\S]{0,240}home-cooldown-nudge/, 'Home 可见时给卡片容器加回弹 class');
  assert.match(HOME_SURFACE, /home-btn-cooldown-pulse/, 'Home 隐藏时给按钮加回弹 class');
  assert.match(HOME_SURFACE, /_cardAt[\s\S]{0,80}260/, '卡片回弹必须有节流');
  assert.match(HOME_SURFACE, /_btnAt[\s\S]{0,80}260/, '按钮回弹必须有节流');
});

test('入场动画必须由用户点 Home（goHome）触发，内部 showHome 不重播', () => {
  assert.match(
    HOME_ACTIONS,
    /showHome\(\{ forceLoad: true[\s\S]{0,240}playHomeEnterAnimation\(\)/,
    'goHome 进入 Home 后必须播放入场动画',
  );
  assert.match(HOME_SURFACE, /function playHomeEnterAnimation\(\)/, '必须有入场动画入口');
  assert.match(HOME_SURFACE, /setTimeout\(function \(\) \{\s*el\.classList\.remove\('home-enter-anim'\)/, '动画结束后必须清理 class');
  // showHome 本身不再触发（否则内部可见性同步会不断重播）
  const showStart = HOME_SURFACE.indexOf('function showHome(opts)');
  const showBody = HOME_SURFACE.slice(showStart, showStart + 2400);
  assert.ok(showBody.indexOf('playHomeEnterAnimation') === -1, 'showHome 不得直接播动画');
});

test('reduced-motion 必须关闭所有 Home 动效', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)/, '必须有 reduced-motion 分支');
  const start = CSS.indexOf('@media (prefers-reduced-motion:reduce)');
  const body = CSS.slice(start, start + 800);
  assert.match(body, /animation:none!important/, 'reduced-motion 下必须禁用动画');
});
