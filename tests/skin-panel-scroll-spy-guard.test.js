'use strict';

/*
 * 皮肤面板「长页 + 滚动定位」守卫（2026-11-25）
 *
 * 用户要求：五个分页合成一条长页，滚动到哪左导航就高亮哪，点左导航就滚到那一段。
 * 实现要点：
 *   1) 分段必须常显（不再靠 .active 控制 display），否则滚动高亮无从谈起；
 *   2) 点击跳转必须自己算偏移（scrollIntoView 会把整个窗口一起滚，fixed 面板里会跳页）；
 *   3) 平滑滚动途中要临时屏蔽滚动高亮，否则会一节一节地闪；
 *   4) 打开面板时宠物库/小组件状态/iframe 都要就位（原来只在切到那一页才加载）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKIN_CSS = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/skin-page.css'), 'utf8');
const SKIN_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/05e-skin-popover.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const fnBody = (marker) => {
  const start = SKIN_JS.indexOf(marker);
  if (start < 0) return '';
  let depth = 0, opened = false;
  for (let i = SKIN_JS.indexOf('{', start); i < SKIN_JS.length; i++) {
    if (SKIN_JS[i] === '{') { depth++; opened = true; }
    else if (SKIN_JS[i] === '}') { depth--; if (opened && depth === 0) return SKIN_JS.slice(start, i + 1); }
  }
  return '';
};

test('五个分段常显，不再靠 .active 控制显隐', () => {
  assert.match(SKIN_CSS, /#skin-popover \.skin-page\{display:block\}/,
    '长页模式下所有分段必须常显');
  const tabsFound = (INDEX.match(/data-skin-page="/g) || []).length;
  assert.equal(tabsFound, 5, '应有 5 个分段');
  const titles = (INDEX.match(/class="skin-section-title"/g) || []).length;
  assert.equal(titles, 5, '每段都要有小标题，否则长页读不出结构');
});

test('点击左导航按偏移滚动，不用 scrollIntoView', () => {
  const fn = fnBody('function scrollSkinBodyToSection');
  assert.ok(fn, '必须有 scrollSkinBodyToSection');
  assert.match(fn, /getBoundingClientRect\(\)\.top - body\.getBoundingClientRect\(\)\.top/,
    '必须自己算相对 .skin-body 的偏移');
  assert.match(fn, /scrollTo\(\{ top: target, behavior: 'smooth' \}\)/);
  assert.doesNotMatch(fn, /scrollIntoView/, 'scrollIntoView 会把外层窗口一起滚');
  const setter = fnBody('function setSkinPageTab');
  assert.match(setter, /scrollSkinBodyToSection\(next\)/);
  assert.doesNotMatch(setter, /scrollTop = 0/, '切成「滚到某段」后不能再把滚动条按回去');
});

test('滚动高亮：判定线 + 底部兜底 + 跳转后短暂屏蔽', () => {
  const spy = fnBody('function syncSkinTabFromScroll');
  assert.ok(spy, '必须有 syncSkinTabFromScroll');
  assert.match(spy, /body\.scrollTop \+ 96/, '要有明确的判定线');
  assert.match(spy, /scrollHeight - 4/, '滚到底部要强制高亮最后一段');
  assert.match(spy, /applySkinTabActive\(tab\)/, '高亮只改导航，不触发跳转/加载');
  const binder = fnBody('function bindSkinScrollSpy');
  assert.match(binder, /passive: true/, '滚动监听必须 passive');
  assert.match(binder, /skinSpySuppressUntil/, '跳转途中要能屏蔽，避免逐节闪烁');
});

test('打开面板即就位，不等切页', () => {
  const open = SKIN_JS.slice(SKIN_JS.indexOf('function toggleSkinPopover'), SKIN_JS.indexOf('function openSkinPage'));
  assert.match(open, /bindSkinScrollSpy\(\)/);
  assert.match(open, /refreshSkinWidgetStatus\(\)/);
  assert.match(open, /mountInlineWidgetFrame\(\)/, '挂件 iframe 打开即挂，滚到那一节不会是空白');
  assert.match(open, /body\.scrollTop = 0/, '打开时回到顶部');
});

test('宠物库调用有 typeof 守卫（这两个函数仓库里已不存在）', () => {
  assert.ok(!/^\s+openSkinPetDex\(\);/m.test(SKIN_JS), '直接调用会抛 ReferenceError');
  assert.ok(!/^\s+closeSkinPetDex\(\);/m.test(SKIN_JS), '直接调用会抛 ReferenceError');
  const calls = SKIN_JS.match(/typeof (openSkinPetDex|closeSkinPetDex) === 'function'/g) || [];
  assert.ok(calls.length >= 3, `三处调用都要守卫，实际 ${calls.length}`);
});

test('不存在的 glass 分页已从 tab 清单移除', () => {
  assert.ok(!SKIN_JS.includes("'glass'"), 'SKIN_TABS 里不该再有 glass（DOM 里没有这一页）');
});
