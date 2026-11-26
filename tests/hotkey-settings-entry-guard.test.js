'use strict';

/*
 * 热键设置入口守卫（2026-11-25）
 *
 * 07-fx/06-hotkeys.js 早就写全了：7 个动作、局内 + 全局两套键位、组合键录入、
 * 系统占用冲突检测、主进程注册。但它唯一的入口 ensureHotkeySettingsButton()
 * 从未被任何地方调用 —— 整块 UI 是死代码。这次把它接到「设置 → 交互」。
 *
 * 守三件事：
 *   1) 入口行与只读键位表存在；
 *   2) 点击真的调 openHotkeySettings（不是只写了个链接）；
 *   3) 关掉编辑弹窗后只读表要刷新 —— 热键模块不会通知外面，必须自己包一层。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const HOTKEYS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/06-hotkeys.js'), 'utf8');

test('交互分区与热键入口存在', () => {
  assert.match(INDEX, /data-settings-tab="interaction"/, '导航里要有交互分区');
  assert.match(INDEX, /data-settings-page="interaction"/, '要有对应的页面');
  assert.match(INDEX, /id="open-hotkey-settings"/, '要有打开热键设置的入口行');
  assert.match(INDEX, /id="hotkey-overview"/, '要有只读键位表容器');
  assert.match(SETTINGS_JS, /'interaction'/, 'TAB_ORDER/TAB_LABEL 必须包含 interaction');
});

test('点击入口真的调 openHotkeySettings', () => {
  const bind = SETTINGS_JS.slice(SETTINGS_JS.indexOf('function bindHotkeySection'), SETTINGS_JS.indexOf('function bindHotkeySection') + 900);
  assert.match(bind, /openHotkeySettings\(\)/, '入口必须调用热键模块的打开函数');
  const initBody = SETTINGS_JS.slice(SETTINGS_JS.indexOf('function bindSettingsPage()'));
  assert.match(initBody, /bindHotkeySection\(\);/, '初始化（DOM 就绪）时必须绑定入口');
  assert.match(HOTKEYS_JS, /function openHotkeySettings\(/, '热键模块必须仍有 openHotkeySettings');
});

test('键位表按 HOTKEY_ACTIONS 渲染，并在关闭弹窗后刷新', () => {
  assert.match(SETTINGS_JS, /HOTKEY_ACTIONS/, '必须从热键模块的动作表取数据，不能手写死表');
  assert.match(SETTINGS_JS, /readHotkeySettings\(\)/, '必须读当前键位');
  assert.match(SETTINGS_JS, /closeHotkeySettings\s*=\s*wrapped/,
    '要包一层 closeHotkeySettings，否则改完键位回到设置页还是旧值');
  assert.match(SETTINGS_JS, /_settingsHotkeyHook/, '包装要幂等，重复初始化不能套多层');
});
