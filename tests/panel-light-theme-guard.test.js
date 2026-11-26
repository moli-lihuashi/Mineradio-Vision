'use strict';

/*
 * 设置页 / 皮肤面板 · 深浅切换守卫（2026-11-25）
 *
 * 范围只有这两个面板（它们共用 --st-* 令牌）。主界面不在范围内：
 * 全站 CSS 还有 1708 处 rgba(255,255,255) + 227 个 #fff，且主界面是
 * 「深色玻璃盖在封面图上」+ WebGL 调色，不是换一套变量就能翻过来的。
 *
 * 四条底线：
 *   1) 浅色只换令牌值，不改结构；深色仍是默认值；
 *   2) 浅色必须覆盖到两套令牌（--st-* 与老规则在用的 --panel-*），否则皮肤面板会半白半黑；
 *   3) .fx-section-label 在 playlist.css 被全局 !important 钉成白色，浅色必须补同权重覆盖；
 *   4) 主题要在模块加载时就落到 <html>，等用户打开面板才生效会闪一下。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_CSS = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/settings-page.css'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('浅色只覆盖令牌，且两套令牌一起翻', () => {
  const lightStart = SETTINGS_CSS.indexOf('html[data-theme="light"] :is(#settings-modal, #skin-popover, .modal, #player-quick-menu-popover){');
  assert.ok(lightStart > 0, '必须有浅色令牌块');
  const block = SETTINGS_CSS.slice(lightStart, SETTINGS_CSS.indexOf('}', lightStart));
  for (const token of ['--st-win', '--st-t1', '--st-line', '--st-fill', '--st-track', '--st-accent']) {
    assert.ok(block.includes(token + ':'), `浅色缺少 ${token}`);
  }
  for (const token of ['--panel-ink', '--panel-line', '--panel-bg']) {
    assert.ok(block.includes(token + ':'), `皮肤面板的老令牌 ${token} 也要映射，否则半白半黑`);
  }
  // 深色仍是默认：基础块里的值不能被改掉
  assert.match(SETTINGS_CSS, /:is\(#settings-modal, #skin-popover, \.modal, #player-quick-menu-popover\)\{[\s\S]{0,400}--st-t1:rgba\(255,255,255,\.94\)/,
    '深色默认值必须保留');
});

test('小标题在浅色下不被全局 !important 吃掉', () => {
  assert.match(SETTINGS_CSS,
    /html\[data-theme="light"\] :is\(#settings-modal, #skin-popover\) \.fx-section-label[\s\S]{0,400}?color:rgba\(22,22,26,\.82\)!important/,
    'playlist.css 的 !important 会把标签钉成白色，浅色必须同权重覆盖');
});

test('面板里的输入框/滚动条/滑块改用令牌（全站扫白光会把快捷菜单也算进来，这里点名校验）', () => {
  for (const [what, pattern] of [
    ['搜索框底色', /\.settings-search input\{[^}]*background:var\(--st-well\)/],
    ['搜索框聚焦', /\.settings-search input:focus\{[^}]*background:var\(--st-well2\)/],
    ['AI 输入框', /#settings-modal \.st-input\{[^}]*background:var\(--st-well\)/],
    ['滚动条', /\::-webkit-scrollbar-thumb\{background:var\(--st-scroll\)/],
    ['滚动条悬停', /scrollbar-thumb\{background:var\(--st-scrollHover\)/],
    ['滑块轨道', /var\(--st-slider-track\)/],
    ['滑块圆钮', /background:var\(--st-knob-bg\)/],
  ]) {
    assert.match(SETTINGS_CSS, pattern, `${what} 还没改成令牌`);
  }
});

test('三段控件 + 持久化 + 跟随系统', () => {
  assert.match(INDEX, /id="theme-seg"/);
  for (const pref of ['dark', 'light', 'system']) {
    assert.match(INDEX, new RegExp(`data-theme-pref="${pref}"`), `缺少 ${pref} 选项`);
  }
  assert.match(SETTINGS_JS, /mineradio:theme:v1/, '要落盘');
  assert.match(SETTINGS_JS, /prefers-color-scheme: light/, '跟随系统要读系统偏好');
  assert.match(SETTINGS_JS, /addEventListener\('change'/, '系统配色变了要跟着切');
  assert.match(SETTINGS_JS, /setAttribute\('data-theme'/, '主题挂在 <html data-theme>');
});

test('主题在模块加载时就应用（不是打开面板才应用）', () => {
  const idx = SETTINGS_JS.indexOf('themePreference = readThemePreference();');
  assert.ok(idx > 0, '模块求值时就要读偏好');
  const tail = SETTINGS_JS.slice(idx, idx + 400);
  assert.match(tail, /applyThemePreference\(\)/, '求值时就应用，避免打开面板时闪一下');
  assert.match(SETTINGS_JS, /style\.colorScheme/, '原生控件（滑块/输入框）也要跟着走');
});

test('提示条（#toast）跟着主题换色', () => {
  const block = SETTINGS_CSS.slice(SETTINGS_CSS.indexOf('html[data-theme="light"] #toast'));
  assert.ok(block, '浅色下必须有 #toast 覆盖');
  assert.ok(block.includes('background:rgba(252,252,254,.97)'), '浅色底');
  assert.ok(block.includes('color:rgba(22,22,26,.90)'), '深色字');
  // 2026-11-25：CSS 改成 border-color 覆写（基础 #toast 已有 1px solid，只换颜色更稳），
  // 断言按语义放宽：只要浅色描边颜色在，不锁死写法。
  assert.ok(
    block.includes('border-color:rgba(22,22,26,.12)') || block.includes('border:1px solid rgba(22,22,26,.12)'),
    '浅色描边'
  );
  // 2026-11-25 补：背景**必须**带 !important。
  // glass.css:31 与 playlist.css:164 把 #toast 收进了「统一玻璃」清单，对 background /
  // border-color / box-shadow 都写了 !important 的深色渐变；浅色这条不带同权重就永远输，
  // 表现就是「开了浅色，提示条还是黑的」—— 这次的原缺陷。
  assert.match(block, /background:rgba\(252,252,254,\.97\)!important/,
    '#toast 浅色背景必须 !important，否则被 glass.css / playlist.css 的深色玻璃压住');
  assert.match(block, /border-color:rgba\(22,22,26,\.12\)!important/,
    '#toast 浅色描边必须 !important');
  assert.match(block, /color:rgba\(22,22,26,\.90\)!important/,
    '#toast 浅色文字必须 !important（与背景同权重，避免只翻一半变成深底深字）');
});

test('弹窗（.modal / AI 歌单）在浅色下也跟随，且带 !important 压过 glass.css', () => {
  // .modal 要能用 --st-*，必须先被纳入令牌作用域
  assert.match(SETTINGS_CSS, /:is\(#settings-modal, #skin-popover, \.modal, #player-quick-menu-popover\)\{/,
    '.modal 必须并入令牌作用域，否则里面的 var(--st-*) 全是空值');
  const modal = SETTINGS_CSS.slice(SETTINGS_CSS.indexOf('html[data-theme="light"] .modal{'));
  assert.ok(modal, '浅色下必须有 .modal 覆盖');
  assert.match(modal, /background:linear-gradient\(180deg,#ffffff,#f6f6f8\)!important/,
    'glass.css 对 .modal 背景带 !important，这里必须同权重');
  assert.match(modal, /border-color:rgba\(22,22,26,\.12\)!important/);

  assert.match(SETTINGS_CSS, /background:#ffffff!important;border-color:rgba\(22,22,26,\.12\)!important/,
    '.ai-playlist-modal 背景要 !important');
  assert.match(SETTINGS_CSS, /html\[data-theme="light"\] \.modal-btn\{[\s\S]{0,120}?background:var\(--st-fill\)!important/,
    '.modal-btn 也被 glass 的 !important 清单覆盖');
  assert.match(SETTINGS_CSS, /html\[data-theme="light"\] \.modal-btn\.primary\{[\s\S]{0,80}?background:#0aa892!important/,
    '主按钮在浅色要用实色，否则还是半透明金');
  assert.match(SETTINGS_CSS, /#ai-playlist-save-name\{[\s\S]{0,160}?color:var\(--st-t1\)!important/,
    '歌单名输入框是内联 color:#fff，必须 !important 覆盖，否则输入的字看不见');
});

test('三条杠快捷菜单也跟随主题（.qm-* 已收敛到令牌）', () => {
  assert.match(SETTINGS_CSS, /:is\(#settings-modal, #skin-popover, \.modal, #player-quick-menu-popover\)\{/,
    '快捷菜单容器必须并入令牌作用域');
  const qmStart = SETTINGS_CSS.indexOf('/* ---------- 三条杠主菜单：快捷图标行 ---------- */');
  const qmEnd = SETTINGS_CSS.indexOf('/* 定时关闭收进一行');
  const qm = SETTINGS_CSS.slice(qmStart, qmEnd);
  const leftovers = qm.split('\n').filter((line) => /color:rgba\(255,255,255|background:rgba\(255,255,255/.test(line));
  assert.deepEqual(leftovers, [], `快捷菜单里还写死着白光：\n${leftovers.join('\n')}`);
  assert.match(SETTINGS_CSS, /html\[data-theme="light"\] \.player-quick-menu-popover\{[\s\S]{0,140}?background:rgba\(252,252,254,\.97\)!important/,
    '浅色必须换掉容器深底');
  assert.match(SETTINGS_CSS, /html\[data-theme="light"\] #player-quick-menu-popover \.quick-menu-section-title\{[^}]*color:rgba\(22,22,26,\.60\)!important/,
    '分组小标题在 index.css 写死白色，浅色必须覆盖');
});

test('播放页琥珀金与存储页荧光青在浅色下被压深', () => {
  // 歌曲过渡整套是 #ffdca6 / rgba(255,186,94,…) 的深色底配色，浅色下会变成浅黄
  for (const [what, needle] of [
    ['说明行', '#settings-modal #track-transition-desc{color:rgba(140,92,18,.88)}'],
    ['数值行', '#settings-modal .tt-caption{color:rgba(140,92,18,.90)}'],
    ['状态行', '#settings-modal .tt-status{color:rgba(140,92,18,.80)}'],
  ]) {
    assert.ok(SETTINGS_CSS.includes(needle), `歌曲过渡的${what}没有浅色覆盖`);
  }
  assert.match(SETTINGS_CSS, /tt-card\.active\{[\s\S]{0,120}?color:#6f4a10/,
    '选中卡片的白字要换成深金，否则白底浅黄看不清');
  // 存储页数值用 fx-panel 的荧光青，白底对比度 1.4:1
  assert.match(SETTINGS_CSS, /cache-storage-row b[\s\S]{0,80}?color:#0a8f7d/,
    '存储数值必须换深青');
});

test('下拉框（.fx-select）换底色时必须同时换字色', () => {
  assert.match(SETTINGS_CSS, /#settings-modal \.fx-select\{[\s\S]{0,160}?color:var\(--st-t1\)!important/,
    'fx-panel 的 .fx-select 是 color:#fff，只换底色就是白字白底');
});

test('EQ 预设卡浅色：标签加深、选中保留蓝色身份', () => {
  assert.match(SETTINGS_CSS, /html\[data-theme="light"\] #settings-modal \.audio-tuning-presets button\{[^}]*color:rgba\(22,22,26,\.72\)/,
    '未选中标签不能再用 --st-t2（白底上是 #8b 灰）');
  assert.match(SETTINGS_CSS, /html\[data-theme="light"\] #settings-modal \.audio-tuning-presets button\.active\{[\s\S]{0,160}?background:#ffffff/,
    '选中卡在浅色下应是白卡而不是 --st-fill2 的灰块');
  assert.match(SETTINGS_CSS, /audio-tuning-presets button\.active \.at-preset-wave i\{background:#3f8ede\}/,
    '选中的蓝色频谱柱要保留');
});

test('输出设备旁的「刷新 / 面板」小按钮在浅色下可见', () => {
  assert.match(SETTINGS_CSS,
    /html\[data-theme="light"\] #settings-modal \.audio-output-section \.quality-output-refresh\{[\s\S]{0,140}?color:var\(--st-t1\)/,
    'fx-panel 里是白字半透明底，浅色下必须换成令牌，否则整块消失');
});

test('搜索「结果面板」浅色：只做面板，不碰搜索框与分类胶囊', () => {
  const start = SETTINGS_CSS.indexOf('/* ---------- 搜索「结果面板」浅色');
  assert.ok(start > 0, '找不到结果面板的浅色块');
  const block = SETTINGS_CSS.slice(start, start + 4000);
  assert.match(block, /html\[data-theme="light"\] #search-results\{[\s\S]{0,200}?background:rgba\(252,252,254,\.97\)!important/,
    '面板底色必须带 !important（glass.css 那组也是 !important）');
  assert.match(block, /#search-results \.search-result-title\{color:rgba\(22,22,26,\.92\)\}/,
    '歌名要换成深色');
  assert.match(block, /#search-results \.search-result-meta\{color:rgba\(22,22,26,\.55\)\}/,
    '歌手/平台行要换成深色');
  for (const btn of ['song-action-btn', 'add-btn']) {
    assert.ok(new RegExp(`#search-results \\.${btn}\\{[\\s\\S]{0,160}?!important`).test(block),
      `${btn} 在 glass 的按钮 !important 清单里，必须同权重覆盖`);
  }
  // 歌手名是 <button class="search-artist-link">，glass.css:194 用 !important 钉成白色
  assert.match(block, /#search-results \.search-artist-link\{color:#0a6f61!important\}/,
    '歌手名必须带 !important，否则被 glass.css 的白字规则压住（搜「晴天」看不见周杰伦就是这个）');
  assert.match(block, /#search-results \.search-artist-link:hover\{color:#075e53!important\}/,
    'hover 也要同权重');
  // 用户明确要求：只改结果面板
  assert.ok(!/#search-box\{[^}]*rgba\(252,252,254/.test(block), '不要顺手改搜索框');
  assert.ok(!/\.search-mode-tabs\{[^}]*rgba\(255,255,255,\.88\)/.test(block), '不要顺手改分类胶囊');
});
