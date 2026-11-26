'use strict';

/*
 * 设置页导航注册守卫（2026-11-25）
 *
 * 真实故障：新加的「AI」页只加了导航按钮和页面，忘了把它加进 TAB_ORDER。
 * setSettingsPageTab() 里是 `TAB_ORDER.indexOf(tab) >= 0 ? tab : 'general'`，
 * 于是点「AI」会静默跳回「通用」—— 没有任何报错，看起来像点了没反应。
 *
 * 这条守卫把「HTML 里的每个 data-settings-tab 都必须注册」变成不变量：
 * 以后再加页，漏注册会直接红。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');

const navTabs = [...new Set([...INDEX.matchAll(/data-settings-tab="([^"]+)"/g)].map((m) => m[1]))];
const pageTabs = [...new Set([...INDEX.matchAll(/data-settings-page="([^"]+)"/g)].map((m) => m[1]))];
const orderMatch = SETTINGS_JS.match(/var TAB_ORDER = \[([^\]]+)\]/);
const order = orderMatch
  ? orderMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  : [];
const labelMatch = SETTINGS_JS.match(/var TAB_LABEL = \{([\s\S]*?)\};/);
const labels = labelMatch ? labelMatch[1] : '';

test('导航按钮必须有对应页面', () => {
  assert.ok(navTabs.length >= 8, `导航项太少（${navTabs.length}），HTML 可能没解析对`);
  const missing = navTabs.filter((t) => !pageTabs.includes(t));
  assert.deepEqual(missing, [], `这些导航项没有页面：${missing.join(', ')}`);
});

test('导航项必须全部在 TAB_ORDER 注册（漏一个就会静默跳回通用）', () => {
  const unregistered = navTabs.filter((t) => !order.includes(t));
  assert.deepEqual(unregistered, [], `没注册进 TAB_ORDER：${unregistered.join(', ')} —— 点它会跳回「通用」`);
  const stale = order.filter((t) => !navTabs.includes(t));
  assert.deepEqual(stale, [], `TAB_ORDER 里有已不存在的页：${stale.join(', ')}`);
});

test('每个导航项都有中文名（搜索/标题会用到）', () => {
  const missing = navTabs.filter((t) => {
    if (/^[a-z-]+$/.test(t) && labels.includes(`${t}:`)) return false;
    return !labels.includes(`'${t}':`);
  });
  assert.deepEqual(missing, [], `TAB_LABEL 缺名字：${missing.join(', ')}`);
});
