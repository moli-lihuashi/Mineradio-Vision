'use strict';

/*
 * fx 面板「液态展开 / 吸回」守卫（2026-11-26）
 *
 * 需求：点滑杆按钮（#fx-fab）收起 / 隐藏 fx 面板时，用液态拉出那套动效 ——
 * 面板从按钮里长出来（液滴 + 三维翻折），收起时 175ms 干脆吸回。
 *
 * 三个必须守住的东西：
 *   1. 接管期间必须停掉面板原有的「右侧滑入」CSS 动画与弹簧，
 *      否则 transform 会以屏幕外的 right:-460px 为基准算，动效整个错位；
 *   2. 只在用户点按钮这条路径接管，鼠标贴边的 peek 仍走原轻量逻辑；
 *   3. 动画指纹（470/175ms 非对称、两条 bezier）不能被随手改。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const JS = read('public/js/modules/07-fx/09-fx-panel-genie.js');
const CSS = read('public/css/07-fx/fx-panel-genie.css');
const BIND = read('public/js/modules/07-fx/07-bindings-shelf-immersive.js');
const INDEX = read('public/index.html');
const LOADER = read('public/js/index-loader.js');
const MOTION = read('public/js/modules/00-state/14-motion-system.js');
const SHELL = read('public/js/modules/10-shell/00-gesture-resize-ui.js');

test('模块存在且注册：样式 + 加载器', () => {
  assert.match(INDEX, /css\/07-fx\/fx-panel-genie\.css/, '样式要在 index.html 注册');
  assert.match(LOADER, /07-fx\/09-fx-panel-genie\.js/, '模块要在 index-loader 里注册');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public/js/modules/07-fx/09-genie-menu.js')),
    '旧的「三点菜单」模块应已删除，避免两套逻辑并存');
});

test('接管期必须钉住面板位置并停掉原动画/过渡', () => {
  /* CSS 里写成 `right: 24px !important;`，比对前先把空白压掉 */
  const css = CSS.replace(/\s+/g, '');
  assert.match(css, /#fx-panel\.fx-genie-run\{[^}]*right:24px!important/,
    '必须把面板钉在最终位置，否则 transform 以屏幕外为基准');
  assert.match(css, /#fx-panel\.fx-genie-run\{[^}]*animation:none!important/, '要停掉 fx-panel-in');
  assert.match(css, /#fx-panel\.fx-genie-run\{[^}]*transition:none!important/, '要停掉位移过渡');
  assert.ok(JS.includes('RUN_CLASS'), '模块要用这个类名开关接管态');
});

test('只在滑杆按钮路径接管，peek 不动', () => {
  // 关闭：先试液态吸回，失败再回原路径
  assert.match(BIND, /if \(window\.FxPanelGenie && window\.FxPanelGenie\.close\(\)\)/, '关闭要先交给液态模块');
  assert.ok(BIND.includes('toggleFxPanel(false);'), '原路径必须保留作为兜底');
  // 打开：接管成功就不跑弹簧
  assert.match(BIND, /var genieHandled = !!\(window\.FxPanelGenie && window\.FxPanelGenie\.open\(\)\)/);
  assert.match(BIND, /if \(!genieHandled && window\.MineradioMotion/, '接管成功时不能同时跑弹簧');
  // peek 用的 setPeek 里不应出现液态调用
  const peekBlock = BIND.slice(BIND.indexOf('function setPeek'), BIND.indexOf('function toggleFxPanel'));
  assert.ok(!peekBlock.includes('FxPanelGenie'), '贴边 peek 不要走液态动画');
});

test('动画指纹保留', () => {
  assert.ok(/OPEN_MS = 470/.test(JS), '开启 470ms');
  assert.ok(/CLOSE_MS = 175/.test(JS), '关闭 175ms（吸回要干脆）');
  assert.ok(JS.includes('cubicBezier(0.28, 0.04, 0.14, 1.0, u)'), '开启曲线');
  assert.ok(JS.includes('cubicBezier(0.42, 0.0, 0.22, 1.0, u)'), '关闭曲线');
  assert.ok(JS.includes('rotateX'), '三维翻折');
  assert.ok(JS.includes('trapezoid('), '液滴形状构造器');
});

test('三维透视靠 transform 自带 perspective（面板父级是 body，不能加 wrapper）', () => {
  assert.ok(JS.includes('perspective(900px)'), '必须用 perspective() 函数');
  assert.ok(JS.includes('transformOrigin'), '要以按钮位置为原点');
  assert.ok(JS.includes('getBoundingClientRect'), '原点按按钮实时位置算');
});

test('动画结束后清理内联样式与类名', () => {
  const finishOpen = JS.slice(JS.indexOf('function finishOpen'), JS.indexOf('function finishClose'));
  assert.ok(finishOpen.includes("remove(RUN_CLASS)"), '结束后要摘掉接管类');
  assert.ok(finishOpen.includes("panel.style.transform = ''"), '不能留下内联 transform');
  const finishClose = JS.slice(JS.indexOf('function finishClose'), JS.indexOf('function startRunning'));
  assert.ok(finishClose.includes("classList.remove('show', 'peek', RUN_CLASS, 'closing')"),
    '收起结束要回到未显示状态');
});

test('无障碍：减弱动效时不接管，交回原逻辑', () => {
  assert.ok(JS.includes('prefers-reduced-motion'), '要检测减弱动效');
  assert.match(JS, /function open\(\)[\s\S]{0,400}?if \(prefersReduced\(\)\) return false/, 'open 要能放弃接管');
  assert.match(JS, /function close\(\)[\s\S]{0,400}?if \(prefersReduced\(\)\) return false/, 'close 要能放弃接管');
});

test('与旧动画不打架：接管前必须掐掉弹簧，peek 期间不许插手', () => {
  // 运动库要提供取消接口
  assert.match(MOTION, /cancelUi: function \(el\)/, 'motion-system 要暴露 cancelUi');
  assert.ok(MOTION.includes('killAll(el, { release: true })'), 'cancelUi 要真的 kill 掉在跑的 spring');

  // genie 在 open / close 两处都先清场
  const openFn = JS.slice(JS.indexOf('function open()'), JS.indexOf('function close()'));
  const closeFn = JS.slice(JS.indexOf('function close()'), JS.indexOf('function isRunning'));
  assert.ok(openFn.includes('cancelRivals(panel)'), 'open 接管前要清场');
  assert.ok(closeFn.includes('cancelRivals(panel)'), 'close 接管前要清场');
  assert.ok(JS.includes("window.MineradioMotion.cancelUi(panel)"), '清场要调运动库的 cancelUi');

  // peek 与通用开关都不能在液态动画期间再动手
  assert.match(SHELL, /if \(key === 'fx' && window\.FxPanelGenie && window\.FxPanelGenie\.running\(\)\) return;/,
    'setPeek 在液态动画期间必须直接返回，否则会再加 .peek 并跑 springUiIn');
  assert.match(BIND, /if \(currentlyOpen && window\.FxPanelGenie && window\.FxPanelGenie\.close\(\)\)/,
    'toggleFxPanel(false) 要优先交给液态（自动隐藏也走它）');
  assert.match(BIND, /if \(!immersiveMode && window\.FxPanelGenie && window\.FxPanelGenie\.open\(\)\) return;/,
    'toggleFxPanel(true) 要优先交给液态，但保留沉浸模式不显示的语义');
});

test('旧的关键帧动画在接管期被压住', () => {
  const css = CSS.replace(/\s+/g, '');
  assert.match(css, /#fx-panel\.fx-genie-run\{[^}]*animation:none!important/,
    'fx-panel-in（.show 上的 CSS 关键帧）必须停掉');
  assert.match(css, /#fx-panel\.fx-genie-run\{[^}]*transition:none!important/,
    'right 的 .55s 过渡必须停掉');
});

test('鼠标移到滑杆按钮不再自动展开面板', () => {
  /* 用户 2026-11-26 明确要求删掉这个悬停热区：面板只由点击开合 */
  assert.ok(!/var inFxFab\b/.test(SHELL), 'inFxFab 热区必须删除');
  assert.ok(!/inFxFab \|\|/.test(SHELL), '不能再用 inFxFab 触发 setPeek');
  assert.match(SHELL, /if \(inFxPanel \|\| inFxBridge\) setPeek\(fp, true, 'fx'\);/,
    '只保留「指针已在面板/缝隙上」时维持显示');
});
