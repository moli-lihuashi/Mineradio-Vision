'use strict';

/*
 * 挂件内嵌设置页 · 主题跟随守卫（2026-11-25）
 *
 * 背景：皮肤与外观 → 挂件页把 desktop/floating-widget/widget.html?settings=1&embedded=1
 * 整块嵌进 iframe。iframe 是**独立文档**，父窗的 <html data-theme> 不会自己流进去。
 *
 * 三条底线（都是这次「开了浅色还是黑的」的原缺陷）：
 *   1) 内嵌版样式必须是变量驱动，并且浅色有一整套覆盖 —— 当初把深色值写死在每条规则里，
 *      切浅色时整块还是黑的。
 *   2) iframe 加载时就要**同步**读父窗主题（等 postMessage 会先用深色画一帧，浅色下能看见闪）。
 *   3) 打开面板之后再切主题，要靠父窗推 postMessage 过来，内嵌页不能要求重载。
 *
 * 独立窗口（520×640 那个）不受影响：它既没有 data-embedded 也没有 data-theme。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DARK_CSS = fs.readFileSync(path.join(ROOT, 'desktop/floating-widget/widget-settings-dark.css'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'desktop/floating-widget/widget-embed-bridge.js'), 'utf8');
const INLINE = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/32-widget-settings-inline.js'), 'utf8');

test('内嵌样式有浅色令牌块，且与深色块同结构', () => {
  const dark = DARK_CSS.slice(DARK_CSS.indexOf('html[data-embedded="1"] {'));
  assert.ok(dark, '必须有深色令牌块');
  assert.ok(
    DARK_CSS.includes('html[data-embedded="1"][data-theme="light"] {'),
    '必须有浅色令牌块（html[data-embedded="1"][data-theme="light"]）'
  );

  const varNames = (block) => [...block.matchAll(/(--emb-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  const darkBlock = DARK_CSS.slice(
    DARK_CSS.indexOf('html[data-embedded="1"] {'),
    DARK_CSS.indexOf('}', DARK_CSS.indexOf('html[data-embedded="1"] {'))
  );
  const lightStart = DARK_CSS.indexOf('html[data-embedded="1"][data-theme="light"] {');
  const lightBlock = DARK_CSS.slice(lightStart, DARK_CSS.indexOf('}', lightStart));

  const darkVars = varNames(darkBlock).sort();
  const lightVars = varNames(lightBlock).sort();
  assert.deepEqual(lightVars, darkVars, '深浅两套 --emb-* 必须一一对应，少一个就会回落到深色值');
  assert.ok(darkVars.length >= 20, '令牌数量看起来不对');
});

test('浅色令牌确实是浅色，深色令牌确实是深色', () => {
  const lightStart = DARK_CSS.indexOf('html[data-embedded="1"][data-theme="light"] {');
  const lightBlock = DARK_CSS.slice(lightStart, DARK_CSS.indexOf('}', lightStart));
  // 底色/卡片色必须是白色系；文字必须是深色系
  assert.match(lightBlock, /--emb-bg:\s*#ffffff/i, '浅色页面底应为白');
  assert.match(lightBlock, /--emb-card:\s*#ffffff/i, '浅色卡片底应为白');
  assert.match(lightBlock, /--emb-t1:\s*rgba\(22,\s*22,\s*26/i, '浅色主文字应为深色');

  const darkBlock = DARK_CSS.slice(
    DARK_CSS.indexOf('html[data-embedded="1"] {'),
    DARK_CSS.indexOf('}', DARK_CSS.indexOf('html[data-embedded="1"] {'))
  );
  assert.match(darkBlock, /--emb-t1:\s*#f2f2f0/i, '深色主文字应为浅色（默认主题不能被改坏）');
});

test('配色规则禁止写死色值（除令牌块）', () => {
  // 除去两段令牌定义，其余规则里出现 #xxxxxx / rgba(...) 说明又在硬编码颜色。
  // 令牌声明（--xxx: 值;）本身允许出现色值，先整段剔掉再扫。
  const start = DARK_CSS.indexOf('/* ---------- 底色与 token ----------');
  assert.ok(start > 0, '找不到「底色与 token」分界线');
  const rules = DARK_CSS.slice(start).replace(/--[a-z0-9-]+\s*:\s*[^;{}]+;/gi, '');
  const hardcoded = [];
  const re = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi;
  let m;
  while ((m = re.exec(rules))) {
    const line = rules.slice(0, m.index).split('\n').length;
    hardcoded.push(line + ': ' + m[0]);
  }
  assert.deepEqual(hardcoded, [], '规则里不应写死颜色，一律用 var(--emb-*)：\n' + hardcoded.join('\n'));
});

test('结构改动与主题解耦：隐藏标题栏与拆高度链不受主题限制', () => {
  // 这两条是内嵌适配的核心，浅色深色都必须生效，所以选择器里不能带 data-theme
  assert.match(DARK_CSS, /html\[data-embedded="1"\] \.sheet-head \{ display: none; \}/,
    'sheet-head 必须双主题都隐藏');
  assert.match(DARK_CSS, /html\[data-embedded="1"\] #sheet \{ display: block; height: auto;/,
    '拆高度链不能只在某个主题下生效');
  assert.ok(!/\[data-theme="light"\][^{]*\.sheet-head/.test(DARK_CSS),
    '结构规则不要误挂到浅色作用域下');
});

test('iframe 加载时同步读父窗主题（避免深色闪一帧）', () => {
  assert.match(BRIDGE, /parent\.document\.documentElement\.getAttribute\('data-theme'\)/,
    'bridge 必须直接读父窗 data-theme');
  assert.match(BRIDGE, /applyTheme\(initialTheme\)/, '读完必须立即落到自己的 <html>');
  // 读取要在 postMessage ready 之前完成
  const readIdx = BRIDGE.indexOf("parent.document.documentElement.getAttribute('data-theme')");
  const readyIdx = BRIDGE.indexOf("kind: 'ready'");
  assert.ok(readIdx > 0 && readyIdx > readIdx, '主题初始化必须早于 ready 上报');
});

test('bridge 接受父窗推送的主题消息', () => {
  assert.match(BRIDGE, /data\.kind === 'theme'/, '必须处理 kind:"theme"');
  assert.match(BRIDGE, /applyTheme\(data\.theme\)/, '收到主题要真正应用');
});

test('父窗在主题变化时推给 iframe（不要求重载）', () => {
  assert.match(INLINE, /function pushThemeToFrame\(/, '必须有 pushThemeToFrame');
  assert.match(INLINE, /MutationObserver[\s\S]{0,220}?attributeFilter: \['data-theme'\]/,
    '必须监听 <html data-theme> 变化');
  assert.match(INLINE, /kind: 'theme'/, '推送的消息类型要跟 bridge 对上');
  // iframe ready 时要补推一次（覆盖「打开面板时主题已切换过」的情况）
  assert.match(INLINE, /kind === 'ready'[\s\S]{0,160}?pushThemeToFrame\(\)/,
    'iframe ready 后要补推主题');
});
