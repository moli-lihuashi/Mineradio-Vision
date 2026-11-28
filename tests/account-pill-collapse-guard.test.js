'use strict';

/* 多账号 pill 的折叠版式守卫（2026-11-28）。
 *
 * 演进过两版，都是被实际使用打回来的：
 *   v1 四颗常驻、行宽随内容 → 左边缘参差 65px（191/135/129/126px），像四级台阶；
 *   v2 固定 196px + 收起藏徽标换 +N → 短昵称（「墨染」）右侧空一大截，SVIP 还消失了。
 * 现在：宽度 max-content 跟随内容（收起=当前这一行，展开=最长那一行），
 *       昵称 132px 上限截断，徽标始终显示，「+N」内联在该行徽标之后。
 *
 * 这条守卫盯住四个容易悄悄退回去的点。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const cssPath = path.join(appRoot, 'public', 'css', '05-playback', 'playback.css');
const jsPath = path.join(appRoot, 'public', 'js', 'modules', '08-account', '02-login-status.js');
const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

test('列宽跟随内容，不写死固定像素', () => {
  assert.match(css, /#user-btn\.multi-account\{width:max-content;/, '列宽又写死了：短昵称会留白');
  assert.match(css, /#user-btn\.multi-account\{[^}]*align-items:stretch/, '不是 stretch：各行宽度不再一致');
  assert.match(css, /\.top-account-name\{flex:1 1 auto;min-width:0;max-width:132px/,
    '昵称没有 132px 上限：超长昵称会把整块顶宽');
});

test('折叠规则只对支持 hover 的设备生效，且不隐藏会员徽标', () => {
  const rule = '#user-btn.multi-account:not(:hover):not(:focus-within) .top-account-pill:not(:first-child){display:none}';
  const ruleAt = css.indexOf(rule);
  assert.ok(ruleAt > 0, '折叠的核心规则丢了');
  const mediaAt = css.lastIndexOf('@media (hover:hover){', ruleAt);
  assert.ok(mediaAt > 0, '折叠规则没有包在 @media (hover:hover) 里：触屏上会永远展不开');
  const mediaEnd = css.indexOf('\n}', ruleAt);
  const block = css.slice(mediaAt, mediaEnd);
  assert.doesNotMatch(block, /top-account-vip[^{]*\{[^}]*opacity:0/, '收起时又把会员徽标藏掉了：SVIP 会消失');
});

test('收起态不引入额外宽度：没有 +N 计数等会撑宽这一行的元素', () => {
  assert.doesNotMatch(css, /top-account-pill:first-child::after\{[^}]*content:attr\(data-more\)/,
    '又给收起行加了计数：实测会把收起态撑得比展开态还宽（150 > 123）');
  assert.doesNotMatch(js, /stampAccountPillMore/, 'JS 里还留着计数写入');
});

test('颜色不在这里抢：pill 的玻璃外观由 glass.css 的 !important 接管', () => {
  const start = css.indexOf('#user-btn.multi-account{width:max-content');
  const end = css.indexOf('#user-avatar{');
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /\.top-account-pill\{[^}]*background:/,
    '在 playback.css 给 pill 写 background 不会生效（glass.css 是 !important），别写死代码');
});
