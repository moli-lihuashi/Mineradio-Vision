'use strict';

/*
 * 设置页外壳守卫（2026-11-25）
 *
 * 这一版把设置页从「顶部 tab + 分组裸列表」改成 Folia 的「左侧分组导航 + 卡片行」，
 * 并新增了启动偏好与「播放时阻止系统休眠」。三类东西最容易在后续改动里被悄悄弄坏：
 *
 *   1) DOM 契约：设置页里的控件是整块搬来的既有 DOM，id / onclick 就是所有绑定入口。
 *      删掉或改名一个 id，对应功能会静默失效（不报错、只是点不动）。
 *   2) 样式层次：fx-glass.css / glass.css 用 :is(#fx-panel,#settings-modal,...) 加
 *      !important 给 .fx-slider / .fx-toggle / .fx-seg 画了玻璃皮，设置页的平面行样式
 *      必须用「更具体 + 同样 !important」才压得住；.fx-slider 那条还带 :not(...)，
 *      特异性高一档，必须用 #settings-modal #settings-body .fx-slider 才够。
 *   3) 新能力链路：防休眠必须 main(ipc) → preload → 设置页开关三段齐全，
 *      少一段就是「开关能点但什么都没发生」。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/settings-page.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(ROOT, 'desktop/preload.js'), 'utf8');

const blockStart = html.indexOf('<div id="settings-modal"');
const blockEnd = html.indexOf('<!-- 皮肤弹层（T 恤按钮）');
const modal = html.slice(blockStart, blockEnd);

test('设置页保留全部关键控件 id（绑定入口不能丢）', () => {
  const required = [
    'settings-modal', 'settings-tabs', 'settings-body', 'settings-search-input',
    'settings-search-results', 'settings-search-wrap',
    // 通用
    'close-behavior-seg', 't-breakReminderEnabled', 'break-reminder-interval-seg', 'break-reminder-status',
    't-startupAutoplay', 't-startupFastSkip', 'startup-resume-mode-seg',
    // 播放
    'fade-in-slider', 'fade-out-slider', 'track-transition-fold', 'track-transition-scene',
    'track-transition-toggle', 'playback-advanced-fold', 'playback-speed-range',
    'playback-preserve-pitch-toggle', 'playback-lookahead-range', 'playback-lead-range',
    't-preventSleep',
    // 音频
    'audio-tuning-fold', 'audio-tuning-eq-rows', 'at-preamp', 'at-balance', 'audio-output-panel',
    // 桌面歌词
    'fx-desktop-lyrics-settings', 'fx-desktoplyricssize', 'desktop-lyrics-lines-seg',
    'wallpaper-settings-group',
    // 性能
    'performance-background-seg', 'performance-quality-seg', 'foreground-fps-seg',
    't-liveBackgroundKeep', 't-wasapiOutput', 'perf-dashboard-body',
    't-memoryAutoTrimApp', 'memory-mask-seg', 'fx-memory-interval',
    // 存储 / 关于
    'cache-storage-panel', 'settings-about-version', 'settings-about-commit',
  ];
  const missing = required.filter((id) => !modal.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `设置页缺少这些 id：${missing.join(', ')}`);
});

test('设置页保留既有 onclick 入口', () => {
  const required = [
    'toggleStartupAutoplay()', 'toggleStartupFastSkip()', 'togglePreventSleep()',
    'toggleBreakReminderEnabled()', 'setBreakReminderInterval(60)',
    "toggleFx('liveBackgroundKeep')", "toggleFx('memoryAutoTrimApp')",
    'chooseCacheDirectory()', 'refreshCacheSettings()', 'openUpdatePanel()',
  ];
  const missing = required.filter((call) => !modal.includes(`onclick="${call}"`));
  assert.deepEqual(missing, [], `设置页缺少这些 onclick：${missing.join(', ')}`);
});

test('外壳是 Folia 的「左导航 + 右内容」两栏网格', () => {
  assert.match(css, /\.settings-shell\{[^}]*grid-template-areas:"head head" "nav body"/,
    '.settings-shell 必须是 head/nav/body 的三块两栏网格');
  assert.match(css, /\.settings-tabs\{grid-area:nav/, '导航必须占据 nav 区（侧栏）');
  assert.match(css, /\.settings-body\{grid-area:body/, '内容区必须占据 body 区');
  assert.match(css, /\.settings-nav-group\{/, '侧栏分组标题必须存在');
  // 侧栏图标：导航按钮里要有 svg
  assert.match(modal, /settings-tab[^>]*>\s*<svg[\s\S]*?<span>通用<\/span>/, '导航按钮需要图标 + 名称');
});

test('切换胶囊与开关轨道没有被旧玻璃皮 !important 盖回去', () => {
  assert.match(css, /#settings-modal #settings-body \.fx-slider\{/,
    '.fx-slider 的复位必须用两级 id —— 旧规则带 :not(.fx-fire-slider-row)，普通 #settings-modal .fx-slider 压不住');
  assert.match(css, /#settings-modal \.fx-toggle::before,\s*\n#settings-modal \.fx-toggle::after\{content:none!important/,
    '开关的高光伪元素必须清掉，否则 on 态会在整行铺一块青');
  assert.match(css, /#settings-modal \.fx-seg button\{background:transparent!important/,
    '分段按钮的黑底 !important 必须复位，否则每档还是一个带描边的小方块');
  assert.doesNotMatch(css, /\.fx-section-label:first-child\{display:none\}/,
    '首行小标题不能一律隐藏：性能页的「直播 / 后台」、内存页的「内存压缩 / Mem Reduct」都要显示');
});

test('音源页：状态由登录态实时渲染，退出全部必须逐个平台走', () => {
  assert.match(modal, /data-settings-tab="sources"/, '导航里必须有音源分区');
  assert.match(modal, /data-settings-page="sources"/, '必须有音源分区的内容容器');
  assert.match(modal, /id="sources-list"/, '音源列表容器（内容由脚本渲染，不能写死）');
  assert.match(js, /TAB_ORDER = \[[^\]]*'sources'/, 'sources 必须在 TAB_ORDER 里，否则切不过去');
  assert.match(js, /function renderSourcesPage\(\)/);
  assert.match(js, /function hookSourcesStateRefresh\(\)/,
    '登录态变化要能触发重画（renderUserBtn 是账号态变化的统一出口）');
  assert.match(js, /global\.logoutLoginProvider\(provider\)/,
    '单平台退出必须用 logoutLoginProvider');
  const logoutAllBody = js.slice(js.indexOf('function logoutAllSources'), js.indexOf('function bindSourcesPage'));
  assert.ok(logoutAllBody.length > 200, '必须能截到 logoutAllSources 的函数体');
  assert.match(logoutAllBody, /logoutLoginProvider/,
    '「退出全部」必须逐个平台调 logoutLoginProvider');
  assert.doesNotMatch(logoutAllBody, /doLogout\s*\(/,
    '「退出全部」不能落到 doLogout：那个函数只清网易云服务端 cookie，其余平台会原样留着');
});

test('防休眠是 main → preload → 页面 三段齐全', () => {
  assert.match(mainJs, /powerSaveBlocker/,
    'main.js 必须引入 powerSaveBlocker');
  assert.match(mainJs, /ipcMain\.handle\('mineradio-set-playback-power-blocker'/,
    'main.js 必须注册防休眠 IPC');
  assert.match(preloadJs, /setPlaybackPowerBlocker:\s*\(enabled\)/,
    'preload 必须暴露 setPlaybackPowerBlocker');
  assert.match(js, /global\.togglePreventSleep = togglePreventSleep/,
    '设置页必须把开关函数挂到 window（onclick 需要）');
  assert.match(js, /preventSleepOn && playing/,
    '只能在「设置开着且真的在出声」时占用 blocker，暂停/结束要解除');
});

test('启动偏好补绑定：脚本早于设置 DOM 执行，必须自己再绑一次', () => {
  assert.match(js, /function bindStartupControls\(\)/);
  assert.match(js, /_mineradioResumeModeBound/, '用一个标记位避免与 06b 重复绑定');
  assert.match(js, /openSettingsPage[\s\S]{0,400}bindStartupControls\(\)/,
    '打开设置页时要同步启动开关与恢复模式的分段状态');
});
