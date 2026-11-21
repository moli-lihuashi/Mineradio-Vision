'use strict';

// 壁纸模式禁用经典预设 + 经典切 Folia 的呈现守卫（2026-11-21）
//
// 用户要求：
//   1. 壁纸模式下经典预设不允许使用，卡片置灰；
//   2. 从经典预设切进 Folia 世界时不要两套界面叠在一起。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const grid = fs.readFileSync(path.join(root, 'public/js/modules/07-fx/04-preset-grid-uniforms.js'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'public/js/modules/10-shell/04-desktop-overlay-fullscreen.js'), 'utf8');
const panelCss = fs.readFileSync(path.join(root, 'public/css/07-fx/fx-panel.css'), 'utf8');
const foliaCss = fs.readFileSync(path.join(root, 'public/css/12-folia/folia-world.css'), 'utf8');

test('壁纸模式判定只针对经典预设，且卡片会置灰/禁读', () => {
  const fn = grid.slice(grid.indexOf('function presetBlockedInWallpaper'), grid.indexOf('function buildPresetGrid'));
  assert.match(fn, /fx\.wallpaperMode === true/, '判据没看壁纸模式');
  assert.match(fn, /CLASSIC_PRESET_INDEX/, '判据没锁定经典预设');
  assert.match(grid, /class="preset-card' \+ \(blocked \? ' is-disabled' : ''\)/, '构建卡片时没加 is-disabled');
  assert.match(grid, /aria-disabled/, '卡片没有 aria-disabled');
  assert.match(grid, /refreshPresetGrid[\s\S]{0,220}is-disabled/, '刷新时没同步 is-disabled');
  assert.match(panelCss, /\.preset-card\.is-disabled\{[^}]*grayscale\(1\)/, '禁用的经典卡没有变灰');
});

test('setPreset 兜底拦截，存档恢复/脚本也带不进经典', () => {
  const fn = grid.slice(grid.indexOf('function setPreset'), grid.indexOf('function setPreset') + 700);
  assert.match(fn, /presetBlockedInWallpaper\(p\)/, 'setPreset 没有拦截');
  assert.match(fn, /壁纸模式下不可用经典预设/, '拦截时没有说明原因');
});

test('进入壁纸模式时若正停在经典，会切回默认预设并刷新卡片', () => {
  const fn = overlay.slice(overlay.indexOf('function applyWallpaperModeState'), overlay.indexOf('function applyWallpaperModeState') + 4200);
  assert.match(fn, /Number\(fx\.preset\) === CLASSIC_PRESET_INDEX/, '没有检测当前是否经典');
  assert.match(fn, /setPreset\(0, \{ silent: true, preserveCamera: true \}\)/, '没有切回默认预设');
  assert.match(fn, /refreshPresetGrid\(\)/, '没有刷新预设卡状态');
  assert.match(fn, /壁纸模式下不可用经典预设/, '没有给切换原因');
});

test('经典切 Folia：Folia 激活时藏掉 #classic-player', () => {
  assert.match(foliaCss, /body\.folia-world-active #classic-player\s*\{[^}]*display:\s*none/, 'Folia 激活时经典播放器还盖在上面');
});
