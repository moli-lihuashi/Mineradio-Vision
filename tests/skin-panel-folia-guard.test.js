'use strict';

/*
 * 皮肤与外观面板 · Folia 语言守卫（2026-11-25）
 *
 * 面板原来是「顶部横向 tab + 粉/蓝各自的发光选中」，和设置页（左侧导航 + 卡片 + 细线 +
 * 中性选中）不是一套。这次只改样式、不动渲染逻辑（四个网格仍由 05d/06f/05f/16c 生成）。
 *
 * 守四件事：
 *   1) 令牌只定义一次，两个面板共用（别各抄一份后漂掉）；
 *   2) 面板是两栏：head 跨两列，tabs 在左、body 在右；
 *   3) 四类卡片统一成 --st-card 底 + 1px 细线 + 选中内描边；
 *   4) 窄窗口导航回到顶部横条（否则 196px 侧栏会把内容挤没）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_CSS = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/settings-page.css'), 'utf8');
const SKIN_CSS = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/skin-page.css'), 'utf8');

test('Folia 令牌两个面板共用，只定义一次', () => {
  assert.match(SETTINGS_CSS, /:is\(#settings-modal, #skin-popover, \.modal, #player-quick-menu-popover\)\{/,
    '令牌选择器必须覆盖设置页、皮肤弹层、弹窗与三条杠快捷菜单（后两者 2026-11-25 并入）');
  assert.equal((SKIN_CSS.match(/--st-win:/g) || []).length, 0,
    '皮肤样式里不能再抄一份 --st-*，只能引用');
  for (const token of ['--st-card', '--st-line', '--st-fill2', '--st-accent']) {
    assert.match(SETTINGS_CSS, new RegExp(token + ':'), `令牌 ${token} 必须存在`);
  }
});

test('面板改成两栏：head 跨列，tabs 在左，body 在右', () => {
  assert.match(SKIN_CSS, /#skin-popover \.skin-shell\{[\s\S]{0,200}grid-template-areas:'head head' 'nav body'/);
  assert.match(SKIN_CSS, /#skin-popover \.skin-tabs\{[\s\S]{0,160}grid-area:nav/);
  assert.match(SKIN_CSS, /#skin-popover \.skin-tabs\{[\s\S]{0,200}flex-direction:column/);
  assert.match(SKIN_CSS, /#skin-popover \.skin-tab\.active::after\{content:none\}/,
    '旧的下划线选中态要关掉，否则和左侧填充态打架');
  assert.match(SKIN_CSS, /#skin-popover \.skin-body\{[\s\S]{0,80}grid-area:body/);
});

test('四类卡片统一成 Folia 卡片语言', () => {
  const cardBlock = SKIN_CSS.slice(
    SKIN_CSS.indexOf('#skin-popover .heart-fx-tile,'),
    SKIN_CSS.indexOf('/* ---- 挂件页 ---- */')
  );
  assert.ok(cardBlock.length > 200, '要能截到卡片规则块');
  for (const cls of ['.heart-fx-tile', '.scene-fx-tile', '.bar-spectrum-tile', '.pet-skin-tile']) {
    assert.ok(cardBlock.includes(cls), `卡片规则必须覆盖 ${cls}`);
  }
  assert.match(cardBlock, /background:var\(--st-card\)/, '卡片底色用 --st-card');
  assert.match(cardBlock, /border:1px solid var\(--st-line\)/, '描边用 1px --st-line');
  assert.match(cardBlock, /inset 0 0 0 1px var\(--st-accent\)/, '选中用断面色内描边');
});

test('挂件页按钮与宠物按钮不再通栏', () => {
  assert.match(SKIN_CSS, /#skin-popover \.skin-btn-primary,[\s\S]{0,200}background:var\(--st-fill\)/);
  assert.match(SKIN_CSS, /#skin-popover \.pet-skin-action\{flex:0 0 auto;width:auto\}/,
    '基类 flex:1 会把「用照片生成」拉成整行');
});

test('窄窗口导航回到顶部横条', () => {
  assert.match(SKIN_CSS, /@media \(max-width:820px\)\{[\s\S]{0,260}grid-template-areas:'head' 'nav' 'body'/);
  assert.match(SKIN_CSS, /#skin-popover \.skin-tabs\{flex-direction:row/);
});
