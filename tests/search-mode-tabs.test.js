'use strict';

// 搜索平台标签高亮回归守（2026-11-06 修复）：
// updateSearchModeTabs() 旧写法只硬编码 song/netease/qq/podcast 四个按钮，
// 页面却有 7 个（多了 kugou/qishui/spotify）。切到后三者时旧按钮 active 被清掉、
// 新按钮又没人补，整排标签一起失去高亮（aria-selected 也全 false）。
// 这里守住「统一遍历」的写法，并要求页面按钮、setSearchMode 白名单、searchMode 初值三者一致。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const searchSrc = fs.readFileSync(path.join(root, 'public/js/modules/05-playback/07-search.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const globalsSrc = fs.readFileSync(path.join(root, 'public/js/modules/00-state/12a-audio-login-globals.js'), 'utf8');

function between(source, from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to);
  assert.ok(a >= 0 && b > a, '源码片段定位失败: ' + from);
  return source.slice(a, b);
}

function searchTabIds() {
  const block = html.slice(html.indexOf('id="search-mode-tabs"'));
  // 跳过容器自己的开标签，否则会把 search-mode-tabs 也当成一个平台
  const inner = block.slice(block.indexOf('>') + 1, block.indexOf('</div>'));
  return Array.from(inner.matchAll(/id="search-mode-([a-z]+)"/g)).map((m) => m[1]);
}

test('搜索平台标签：updateSearchModeTabs 统一遍历全部按钮', () => {
  const fn = between(searchSrc, 'function updateSearchModeTabs', 'function setSearchMode');
  assert.match(fn, /querySelectorAll\('#search-mode-tabs button'\)/,
    '必须遍历 #search-mode-tabs 下的所有按钮');
  assert.match(fn, /search-mode-/, '模式名应从按钮 id 前缀派生');
  assert.match(fn, /classList\.toggle\('active'/, '必须切换 active');
  assert.match(fn, /aria-selected/, '必须同步 aria-selected');
  ['songBtn', 'neteaseBtn', 'qqBtn', 'podcastBtn'].forEach((name) => {
    assert.ok(!fn.includes(name), '不应再硬编码按钮变量 ' + name + '（新增平台会被漏掉）');
  });
});

test('搜索平台标签：页面按钮 / setSearchMode 白名单 / 初值一致', () => {
  const ids = searchTabIds().sort();
  assert.deepStrictEqual(ids, ['kugou', 'netease', 'podcast', 'qishui', 'qq', 'song', 'spotify'],
    'index.html 的搜索平台按钮集合发生变化，请同步 updateSearchModeTabs 与 setSearchMode');

  const initial = globalsSrc.match(/var searchMode = '([a-z]+)'/);
  assert.ok(initial, '未找到 searchMode 初值');
  assert.strictEqual(initial[1], 'song');

  const setFn = between(searchSrc, 'function setSearchMode', 'function podcastMetaText');
  ids.forEach((id) => {
    if (id === 'song') return; // song 是白名单外的默认分支
    assert.ok(setFn.includes("'" + id + "'"), 'setSearchMode 白名单缺少 ' + id);
  });
});

test('搜索平台标签：每个模式都有对应的输入框提示语', () => {
  const fn = between(searchSrc, 'function updateSearchModeTabs', 'function setSearchMode');
  ['podcast', 'qq', 'netease', 'kugou', 'qishui', 'spotify'].forEach((mode) => {
    assert.ok(fn.includes("searchMode === '" + mode + "'"), '缺少 ' + mode + ' 的 placeholder 分支');
  });
});
