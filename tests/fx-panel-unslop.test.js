'use strict';

// FX 面板 / Folia 歌词样式按钮的 unslop 守卫（2026-11-21）
//
// 依据 heydamir/unslop 的审计：长描述撑爆卡片、iOS 蓝/绿三套强调色、
// 只有颜色没有可读的选中态、10px 描述、10/11px 间距、弹簧悬停。
// 这里钉住修复后的关键边界，防止回退。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const foliaCss = fs.readFileSync(path.join(root, 'public/css/12-folia/folia-world.css'), 'utf8');
const panelCss = fs.readFileSync(path.join(root, 'public/css/07-fx/fx-panel.css'), 'utf8');
const panelJs = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/04-folia-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('样式卡：等行高 + 两行截断 + 4px 网格间距', () => {
  assert.match(foliaCss, /\.fx-folia-mode-grid\s*\{[^}]*grid-auto-rows:\s*1fr/, '网格没设等行高，长描述会把整行拉歪');
  assert.match(foliaCss, /\.fx-folia-mode-desc\s*\{[^}]*-webkit-line-clamp:\s*2/, '描述没有两行截断');
  assert.match(foliaCss, /\.fx-folia-mode-card\s*\{[^}]*min-height:\s*56px/, '卡片最小高度不是 56px');
  assert.match(foliaCss, /\.fx-folia-mode-card,\s*\n\.fx-folia-bg-card\s*\{[^}]*padding:\s*12px/, '卡片内边距不是 12px');
  assert.match(foliaCss, /\.fx-folia-mode-card,\s*\n\.fx-folia-bg-card\s*\{[^}]*gap:\s*4px/, '卡片内容间距不是 4px');
});

test('选中态：只用主题色描边与 7% 底，不再有 iOS 蓝渐变/光晕', () => {
  const active = foliaCss.slice(foliaCss.indexOf('.fx-folia-mode-card.active,'), foliaCss.indexOf('.fx-folia-mode-card.active::after'));
  assert.match(active, /var\(--ui-accent/, '选中态没有用面板主题色');
  assert.doesNotMatch(active, /10,\s*132,\s*255/, '选中态还留着 iOS 蓝');
  assert.doesNotMatch(active, /0 4px 16px/, '选中态还留着彩色光晕');
  assert.match(foliaCss, /\.fx-folia-mode-card\.active::after\s*\{[^}]*background:\s*var\(--ui-accent/, '缺少非颜色的选中圆点');
});

test('开关与焦点环统一主题色，滑钮不再弹簧放大', () => {
  const mainSwitch = foliaCss.slice(foliaCss.indexOf('.fx-folia-switch {'), foliaCss.indexOf('.fx-folia-hint'));
  assert.match(mainSwitch, /is-on,[\s\S]{0,80}background:\s*var\(--ui-accent/, '主开关开启态不是主题色');
  assert.doesNotMatch(mainSwitch, /#34c759|10,\s*132,\s*255/, '主开关还留着 iOS 绿/蓝');
  assert.doesNotMatch(mainSwitch, /scale\(1\.08\)/, '滑钮还有按压缩放');
  const tuningSwitch = foliaCss.slice(foliaCss.indexOf('.fx-folia-tuning-switch {'), foliaCss.indexOf('.fx-folia-tuning-switch:disabled'));
  assert.match(tuningSwitch, /is-on\s*\{[^}]*var\(--ui-accent/, '调参开关开启态不是主题色');
  assert.doesNotMatch(tuningSwitch, /#34c759/, '调参开关还留着 iOS 绿');
});

test('读屏与焦点：卡片有 aria-pressed，禁用卡保留可读名称', () => {
  assert.match(panelJs, /card\.setAttribute\('aria-pressed'/, '样式卡没有 aria-pressed');
  assert.match(panelJs, /card\.setAttribute\('aria-pressed',\s*bg\.id/, '背景卡没有 aria-pressed');
  assert.match(panelJs, /fx-folia-mode-note/, '禁用卡没有可见说明');
  assert.match(foliaCss, /\.fx-folia-mode-card\.is-disabled \.fx-folia-mode-name[\s\S]{0,80}rgba\(255, 255, 255, \.60\)/, '禁用卡名称被压到不可读');
  assert.doesNotMatch(foliaCss, /\.fx-folia-mode-card\.is-disabled,[\s\S]{0,120}grayscale/, '禁用卡还在整张 grayscale');
});

test('卡片副标题收短，完整描述留给 title', () => {
  assert.match(panelJs, /FOLIA_MODE_SHORT_DESC/, '缺少模组短描述表');
  assert.match(panelJs, /desc\.textContent = foliaModeShortDesc\(mode\)/, '卡片没用短描述');
  assert.match(panelJs, /card\.title = String\(mode\.desc\)/, '完整描述没有进 title');
});

test('FX 面板：分区标签不再大写宽字距，预设卡不再 transition:all/径向脉冲', () => {
  assert.match(panelCss, /\.fx-section-label\{[^}]*letter-spacing:0/, '分区标签还有宽字距');
  assert.doesNotMatch(panelCss, /\.fx-section-label\{[^}]*text-transform:uppercase/, '分区标签还是全大写');
  assert.doesNotMatch(panelCss, /\.preset-card\{[^}]*transition:all/, '预设卡还在 transition:all');
  assert.doesNotMatch(panelCss, /preset-card-pulse/, '预设卡还有径向色团脉冲');
  assert.match(html, /placeholder="搜索设置"/, '搜索占位符还是长句');
  assert.doesNotMatch(html, /MINERADIO VISUALS · 鼠标移开自动隐藏/, '面板副标题还有大写英文 kicker');
});

test('Folia 调参面板不再有 iOS 蓝/绿，主色只剩主题色', () => {
  assert.doesNotMatch(foliaCss, /10,\s*132,\s*255|#0a84ff|#34c759/, '调参面板还留着 iOS 蓝/绿');
  assert.match(foliaCss, /\.fx-folia-tuning-pill\.active\s*\{[^}]*var\(--ui-accent/, '调参药丸选中态不是主题色');
  assert.match(foliaCss, /\.fx-folia-tuning-pill\.active\s*\{[^}]*inset 0 0 0 1px/, '调参药丸选中态没有发丝描边');
});

test('预设卡与面板标题的字体对齐', () => {
  assert.match(panelCss, /\.preset-card \.pc-name\{[^}]*font-weight:600[^}]*letter-spacing:0/, '预设卡名称还是 700/宽字距');
  assert.match(panelCss, /\.preset-card \.pc-desc\{[^}]*font-size:12px/, '预设卡描述不是 12px');
  assert.match(panelCss, /\.fx-title\{[^}]*letter-spacing:0/, '面板标题还有宽字距');
});
