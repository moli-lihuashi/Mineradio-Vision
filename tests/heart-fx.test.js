'use strict';

// 红心点击动效（2026-11-07）回归守：
// 四套形态 folia/riso/ring/star + random + off，选择存在 fx.heartFx，入口在顶栏「皮肤」弹层
// （2026-11-10 按用户要求删除了视觉控制台「外观」页那一组，皮肤弹层成为唯一宿主）。
// 守四件事：
//   ① 存档白名单：写进去的值和读出来的值都必须过 normalizeHeartFxMode，脏值不能落到 fx 上；
//   ② 随机不连庄：random 连续两次不能抽到同一套（否则「随机」看起来像卡住了）；
//   ③ 触发面收窄：只有主红心按钮（toggleLikeCurrent）传锚点，列表小红心不炸粒子；
//   ④ 图层位置：粒子层必须挂 body —— 挂在 #bottom-bar 里会被 backdrop-filter 裁掉。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const heartSrc = read('public/js/modules/05-playback/06e-heart-fx.js');
const panelSrc = read('public/js/modules/07-fx/05d-heart-fx-panel.js');
const layoutSrc = read('public/js/modules/07-fx/05b-fx-panel-layout.js');
const skinSrc = read('public/js/modules/07-fx/05e-skin-popover.js');
const accountSrc = read('public/js/modules/05-playback/06c-account-actions.js');
const layoutSettingsSrc = read('public/js/modules/02-visual/03c-lyrics-layout-settings.js');
const globalsSrc = read('public/js/modules/00-state/12d-fx-runtime-globals.js');
const loaderSrc = read('public/js/index-loader.js');
const html = read('public/index.html');
const fxPanelCss = read('public/css/07-fx/fx-panel.css');
const playbackCss = read('public/css/05-playback/playback.css');

/* 按大括号配对取出一个顶层函数声明（源码切片测试不能用正则截断，函数体里有嵌套花括号） */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 花括号不配对');
}

function between(source, from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, '源码片段定位失败: ' + from);
  return source.slice(a, b);
}

test('红心动效：默认值两处都是 random，且存档读写都过白名单', () => {
  const defaults = globalsSrc.match(/heartFx: 'random'/g) || [];
  assert.strictEqual(defaults.length, 2,
    'fxDefaults 与 PACKAGED_DEFAULT_FX_SNAPSHOT 都要有 heartFx: \'random\'');

  const readFn = between(layoutSettingsSrc, 'function readSavedLyricLayout', 'function saveLyricLayout');
  assert.match(readFn, /heartFx: normalizeHeartFxMode\(raw\.heartFx/,
    '读存档时必须过 normalizeHeartFxMode，否则脏值会直接进 fx');

  const saveFn = between(layoutSettingsSrc, 'function saveLyricLayout', 'function desktopLyricsSizeLimits');
  assert.match(saveFn, /heartFx: normalizeHeartFxMode\(fx\.heartFx/,
    '写存档时同样要过白名单');
});

test('红心动效：normalizeHeartFxMode 白名单与兜底', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extractFunction(layoutSettingsSrc, 'normalizeHeartFxMode'), ctx);
  const normalize = ctx.normalizeHeartFxMode;

  ['random', 'folia', 'riso', 'ring', 'star', 'off'].forEach((mode) => {
    assert.strictEqual(normalize(mode, 'ring'), mode, mode + ' 是合法值，要原样返回');
  });
  assert.strictEqual(normalize('nope', 'star'), 'star', '非法值要落回 fallback');
  assert.strictEqual(normalize('', 'ring'), 'ring', '空值要落回 fallback');
  assert.strictEqual(normalize(null, 'ring'), 'ring', 'null 要落回 fallback');
  assert.strictEqual(normalize(undefined, undefined), 'random', 'fallback 也非法时兜底 random');
  assert.strictEqual(normalize('FOLIA', 'star'), 'star', '大小写不匹配视为非法');
});

test('红心动效：random 连续两次不重复', () => {
  const ctx = vm.createContext({});
  vm.runInContext(
    between(heartSrc, 'var HEART_FX_MODES', 'function heartFxReduceMotion') +
    extractFunction(heartSrc, 'heartFxResolveMode') +
    '\nthis.resolve = heartFxResolveMode;',
    ctx
  );
  const resolve = ctx.resolve;
  const solo = ['folia', 'riso', 'ring', 'star'];

  let prev = '';
  for (let i = 0; i < 60; i++) {
    const mode = resolve('random');
    assert.ok(solo.indexOf(mode) >= 0, 'random 只能抽出单套，实得 ' + mode);
    assert.notStrictEqual(mode, prev, 'random 不能连续两次抽到同一套');
    prev = mode;
  }
  assert.strictEqual(resolve('star'), 'star', '显式指定时不能被随机覆盖');
  assert.strictEqual(resolve('ring'), 'ring', '显式指定时不能被随机覆盖');
});

test('红心动效：只有主红心按钮传锚点，列表小红心不炸粒子', () => {
  const toggleFn = between(accountSrc, 'async function toggleLikeSong', 'function toggleLikeCurrent');
  // 写成带 if 的整句：只匹配「函数名出现过」是不够的，`if (false && opts.anchor)` 也能过
  assert.match(toggleFn, /if \(opts && opts\.anchor\) heartFxFeedback\(opts\.anchor, next\);/,
    '点亮/取消都要走 heartFxFeedback，且必须由锚点门控');
  assert.match(toggleFn, /if \(opts && opts\.anchor\) heartFxDip\(opts\.anchor\);/,
    '请求失败要补一次下沉，别庆祝假成功');

  const current = between(accountSrc, 'function toggleLikeCurrent', 'function toggleLikeSearchResult');
  assert.match(current, /getElementById\('heart-btn'\)/, 'toggleLikeCurrent 要把 #heart-btn 当锚点');

  const searchFn = between(accountSrc, 'function toggleLikeSearchResult', 'function toggleLikeQueueIndex');
  assert.ok(searchFn.indexOf('anchor') < 0, '搜索结果的 15px 小红心不该传锚点（一屏几十个会糊）');
  assert.match(html, /id="heart-btn"[\s\S]{0,120}toggleLikeCurrent\(\)/,
    'index.html 里的主红心按钮要仍绑 toggleLikeCurrent');
});

test('红心动效：粒子层挂 body，不挂底栏', () => {
  const layerFn = extractFunction(heartSrc, 'heartFxLayer');
  assert.match(layerFn, /document\.body\.appendChild\(layer\)/,
    '图层必须挂 body：#bottom-bar 有 backdrop-filter 会裁掉 fixed 粒子');
  assert.ok(!/bottom-bar/.test(layerFn), '图层不能往 #bottom-bar 里塞');
  assert.match(playbackCss, /\.heart-fx-layer\{[^}]*z-index:14/,
    '图层 z-index 要压在底栏(6)之上、fx 面板(18)之下');
  assert.match(playbackCss, /\.heart-fx-layer\{[^}]*pointer-events:none/,
    '图层不能吃点击');
});

test('红心动效：四套形态 + 关闭 + 心跳动画类齐全', () => {
  ['folia', 'riso', 'ring', 'star'].forEach((mode) => {
    assert.ok(extractFunction(heartSrc, 'heartFxPlay' + mode[0].toUpperCase() + mode.slice(1)),
      '缺少 ' + mode + ' 的实现');
  });
  const players = between(heartSrc, 'var HEART_FX_PLAYERS', 'function heartFxPlay');
  ['folia', 'riso', 'ring', 'star'].forEach((mode) => {
    assert.ok(players.indexOf(mode + ':') >= 0, 'HEART_FX_PLAYERS 缺少 ' + mode);
  });
  assert.match(heartSrc, /if \(mode === 'off'\) return false/,
    'off 必须真的什么都不播');

  ['pop', 'soft', 'quick', 'bloom', 'dip'].forEach((k) => {
    assert.ok(playbackCss.indexOf('@keyframes heart-beat-' + k) >= 0,
      'playback.css 缺少 @keyframes heart-beat-' + k);
  });
});

test('红心动效：皮肤弹层并排预览格 6 项，点击即预览（FX 面板那组已删）', () => {
  assert.match(html, /<div class="heart-fx-grid" id="skin-heart-fx-grid"><\/div>/,
    '皮肤弹层要有并排预览格的容器');
  assert.doesNotMatch(html, /id="heart-fx-grid"/,
    '视觉控制台「外观」页那一组已按用户要求删除，不能复活');
  assert.doesNotMatch(html, /<div class="fx-section-label">红心动效<\/div>/,
    'FX 面板的「红心动效」区块标题也要删掉');

  const meta = between(panelSrc, 'var HEART_FX_TILE_META', 'function heartFxTileHeartMarkup');
  ['random', 'folia', 'riso', 'ring', 'star', 'off'].forEach((mode) => {
    assert.ok(meta.indexOf("'" + mode + "'") >= 0, '预览格缺少 ' + mode + ' 这一项');
  });
  assert.ok(!/select|option/.test(panelSrc), '要求并排预览，不能用下拉');

  const pickFn = extractFunction(panelSrc, 'pickHeartFx');
  assert.match(pickFn, /fx\.heartFx = mode/, '选中要写进 fx.heartFx');
  assert.match(pickFn, /saveLyricLayout\(\)/, '选中要落盘');
  assert.match(pickFn, /heartFxPlay\(host, \{ mode: mode, scale: [\d.]+, preview: true \}\)/,
    '点格子要就地用格子里那颗心放一遍');
  assert.match(pickFn, /mode !== 'off'/, 'off 不预览');

  assert.match(skinSrc, /if \(typeof syncHeartFxGrid === 'function'\) syncHeartFxGrid\(\)/,
    '打开皮肤弹层要懒渲染 / 同步预览格');
  assert.match(panelSrc, /document\.querySelectorAll\('\.heart-fx-grid'\)/,
    '渲染仍按 class 遍历，别写死 id');
  assert.doesNotMatch(layoutSrc, /id === 'heart-fx-grid'|syncHeartFxGrid\(\)/,
    'FX 外观页不该再引用已删除的宿主');

  assert.match(fxPanelCss, /\.heart-fx-grid\{[^}]*grid-template-columns:repeat\(3/,
    '预览格按 3 列并排');
  assert.match(fxPanelCss, /\.heart-fx-tile\{[^}]*overflow:visible/,
    '格子不能裁切，粒子要能飞出去');
});

test('红心动效：模块注册顺序在依赖之后', () => {
  const idx06c = loaderSrc.indexOf('05-playback/06c-account-actions.js');
  const idx06e = loaderSrc.indexOf('05-playback/06e-heart-fx.js');
  assert.ok(idx06c > 0 && idx06e > idx06c, '06e 要排在 06c 之后');

  const idx05b = loaderSrc.indexOf('07-fx/05b-fx-panel-layout.js');
  const idx05d = loaderSrc.indexOf('07-fx/05d-heart-fx-panel.js');
  assert.ok(idx05b > 0 && idx05d > idx05b, '05d 要排在 05b 之后');

  const idx05e = loaderSrc.indexOf('07-fx/05e-skin-popover.js');
  assert.ok(idx05e > idx05d, '05e（皮肤弹层）要用 05d 的 syncHeartFxGrid 渲染，必须排在其后');
});

/* ------------------------------------------------------------------
 * 皮肤弹层（顶栏 T 恤按钮）
 * 守：按钮与弹层都在、六格两个宿主共享一份选中态、开关手势齐全、
 *     与播放选项互斥、全屏那颗按钮同样能开。
 * ------------------------------------------------------------------ */
test('皮肤弹层：T 恤按钮在「三条杠」左边，顶栏与全屏各一颗', () => {
  const titlebar = between(html, '<div class="desktop-window-controls">', 'id="fullscreen-diy-zone"');
  assert.match(titlebar, /id="skin-btn"[\s\S]*?onclick="toggleSkinPopover\(event\)"/,
    '标题栏要有皮肤按钮，且绑 toggleSkinPopover');
  assert.ok(titlebar.indexOf('id="skin-btn"') < titlebar.indexOf('id="player-quick-menu-btn"'),
    '皮肤按钮要排在播放选项（三条杠）左边，和截图位置一致');

  const fsZone = between(html, 'id="fullscreen-diy-zone"', 'id="custom-bg"');
  assert.match(fsZone, /id="skin-btn-fs"[\s\S]*?onclick="toggleSkinPopover\(event\)"/,
    '全屏 DIY 区也要有一颗，否则全屏下点不到皮肤');

  assert.match(html, /id="skin-popover"[\s\S]*?class="heart-fx-grid"[\s\S]*?<\/div>\s*<\/div>/,
    '皮肤弹层里要放红心六格的宿主');
});

test('皮肤弹层：六格两个宿主共用一份真值，选哪格两边一起亮', () => {
  const hostsFn = extractFunction(panelSrc, 'heartFxGridHosts');
  assert.match(hostsFn, /querySelectorAll\('\.heart-fx-grid'\)/,
    '宿主要按 class 找，不能写死成一个 id（否则弹层那份永远不亮）');

  const renderFn = extractFunction(panelSrc, 'renderHeartFxGrid');
  assert.match(renderFn, /hosts\.forEach/, '渲染要铺到每个宿主');

  const pickFn = extractFunction(panelSrc, 'pickHeartFx');
  assert.ok(pickFn.indexOf("getElementById('heart-fx-grid')") < 0,
    '选中态同步不能只刷视觉控制台那一份');
  assert.match(pickFn, /paintHeartFxSelection\(mode\)/, '改档位要调用统一的选中态同步');

  const paintFn = extractFunction(panelSrc, 'paintHeartFxSelection');
  assert.match(paintFn, /heartFxGridHosts\(\)/, '选中态同步要遍历所有宿主');
});

test('皮肤弹层：开关手势与互斥', () => {
  const skinSrc = read('public/js/modules/07-fx/05e-skin-popover.js');

  const toggleFn = extractFunction(skinSrc, 'toggleSkinPopover');
  assert.match(toggleFn, /classList\.toggle\('skin-popover-open'/,
    '打开状态挂在 body.skin-popover-open 上');
  assert.match(toggleFn, /if \(typeof closePlayerQuickMenu === 'function'\) closePlayerQuickMenu\(\);/,
    '打开皮肤要收掉播放选项，两块玻璃不能叠着');
  assert.match(toggleFn, /syncHeartFxGrid\(\)/, '打开时要懒渲染/同步六格');
  assert.match(toggleFn, /positionSkinPopover\(e && e\.currentTarget\)/,
    '弹层要贴着被点的那颗按钮，全屏那颗才不会飞到左上角');

  const unlessFn = extractFunction(skinSrc, 'closeSkinPopoverUnless');
  assert.match(unlessFn, /pop\.contains\(target\)/, '点弹层内部不关');
  assert.match(unlessFn, /btnFs && btnFs\.contains\(target\)/, '点全屏那颗按钮不能一开就关');

  assert.match(skinSrc, /if \(e\.key === 'Escape'\) closeSkinPopover\(\);/,
    'Esc 要能关');
  assert.match(skinSrc, /addEventListener\('resize'/, '窗口尺寸变了要重新定位');

  const quickToggle = between(
    read('public/js/modules/05-playback/00b-mood-sleep-timer.js'),
    'function togglePlayerQuickMenu', 'function closePlayerQuickMenu'
  );
  assert.match(quickToggle, /if \(typeof closeSkinPopover === 'function'\) closeSkinPopover\(\);/,
    '反方向也要互斥：开播放选项时收掉皮肤');
});

test('皮肤弹层：样式与全屏热区', () => {
  const css = read('public/css/index.css');
  assert.match(css, /\.skin-btn\{[^}]*width:30px;height:30px/,
    '皮肤按钮和播放选项按钮同尺寸（30×30），并排才不打架');
  assert.match(css, /\.skin-btn\{[^}]*-webkit-app-region:no-drag/,
    '标题栏拖拽区里要 no-drag，否则点不动');
  assert.match(css, /\.skin-popover\{[^}]*position:fixed[^}]*z-index:620/,
    '弹层要和播放选项同层级(620)');
  assert.match(css, /body\.skin-popover-open \.skin-popover\{[^}]*opacity:1/,
    '打开状态要让弹层可交互');

  // 全屏 DIY 区加了第三颗按钮：热区不跟着放宽，最左边那颗会点不到
  assert.match(css, /#fullscreen-diy-zone \.player-quick-menu-trigger,#fullscreen-diy-zone \.skin-btn\{[^}]*opacity:0/,
    '全屏下皮肤按钮也要走同一套浮现动画');
  assert.match(css, /#skin-btn-fs[^{]*\{opacity:1/,
    'peek/hover 时全屏皮肤按钮要浮出来');
  const diyGlobals = read('public/js/modules/00-state/12c-preference-diy-globals.js');
  assert.match(between(diyGlobals, 'function layoutFullscreenDiyZone', 'function shouldSuppress'),
    /innerWidth < 820 \? 134 : 158/, '全屏 DIY 区热区宽度要按三颗按钮放宽');
});
