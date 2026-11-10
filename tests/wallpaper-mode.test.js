'use strict';

// =============================================================================
// 壁纸模式（完整桌面模式）行为回归
// 覆盖：
//   1. 03c 存档回环：wallpaperMode / wallpaperOpacity / wallpaperFps 保存后
//      「重启」（重新 read）能原样读回；帧率非法值回落 60
//   2. 帧率归一化：03c normalizeWallpaperFrameRate 与 04 normalizeWallpaperFps
//      同语义（<=0 → 60，clamp 1..60）
//   3. pushWallpaperState：非 force 也真实推送（旧版 `if (!force) return;`
//      死推送已修）；同内容 900ms 节流；内容变化 / force 立即发
//   4. updateWallpaperPanelVisibility：帧数分段与透明度滑块只在开关打开时显示
//   5. 主进程接线：createWallpaperWindow → enableFullDesktopMode(mainWindow, ...)，
//      退出走 disable / before-quit dispose；IPC 用 isTrustedMainWindowIpc；
//      旧 Canvas 链路（wallpaper.html / DesktopWallpaperRuntime / enableDesktopMode）已清除
//   6. preload 暴露 getWallpaperModeStatus / onWallpaperModeState（后者可解绑）
//   7. index.html 开关解锁（无 dev-locked / 开发中徽标），fps 控件默认 hidden
// 说明：跑的是 public/js/modules、desktop/preload.js 里的真实函数源码；
// DOM / IPC 为可控模拟对象。主进程 WorkerW 附着不做真机模拟（有风险，由用户实测）。
// =============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const layoutPath = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '03c-lyrics-layout-settings.js');
const overlayPath = path.join(appRoot, 'public', 'js', 'modules', '10-shell', '04-desktop-overlay-fullscreen.js');
const panelInputsPath = path.join(appRoot, 'public', 'js', 'modules', '07-fx', '05a-fx-panel-inputs.js');
const globalsPath = path.join(appRoot, 'public', 'js', 'modules', '00-state', '12d-fx-runtime-globals.js');
const bindingsPath = path.join(appRoot, 'public', 'js', 'modules', '07-fx', '07-bindings-shelf-immersive.js');
const mainProcessPath = path.join(appRoot, 'desktop', 'main.js');
const preloadPath = path.join(appRoot, 'desktop', 'preload.js');
const indexPath = path.join(appRoot, 'public', 'index.html');
const packageJsonPath = path.join(appRoot, 'package.json');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

/* 从真实源码里截取函数体（与 desktop-lyrics-multiline.test.js 同款实现）。
 * 先扫完参数列表再找函数体的 `{`：参数里可能有带大括号的默认值。 */
function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('未找到函数 ' + name);
  let i = source.indexOf('(', start);
  if (i < 0) throw new Error('函数 ' + name + ' 缺少参数列表');
  let paren = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') paren += 1;
    else if (ch === ')') {
      paren -= 1;
      if (paren === 0) { i += 1; break; }
    }
  }
  i = source.indexOf('{', i);
  if (i < 0) throw new Error('函数 ' + name + ' 缺少函数体');
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 函数体未闭合');
}

/* ---- 03c：壁纸设置存档回环 ------------------------------------------------- */
const STORE_KEY = 'mineradio-lyric-layout-v1';
const clampRangeSource = extractFunction(
  readSource(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '03b-lyrics-color-utils.js')),
  'clampRange'
);
let storedLayoutJson = null;
const layoutContext = vm.createContext({
  console: console,
  localStorage: {
    getItem: function (key) { return key === STORE_KEY ? storedLayoutJson : null; },
    setItem: function (key, value) { if (key === STORE_KEY) storedLayoutJson = String(value); },
  },
  LYRIC_LAYOUT_STORE_KEY: STORE_KEY,
  VISUAL_PRESET_MAX_INDEX: 8,
  VISUAL_PRESET_SCHEMA: 'visual-preset-v3',
  presetMeta: new Array(9),
  playing: false,
  currentIdx: -1,
  startupVisualPreviewActive: false,
  playbackVisualPreset: 0,
  normalizeHexColor: function (value, fallback) { return String(value || fallback || ''); },
  normalizeCustomBackgroundImage: function (value) { return value || ''; },
  normalizeCustomBackgroundMedia: function (value) { return value || null; },
  normalizeShelfCameraMode: function (value) { return String(value || '') === 'static' ? 'static' : 'dynamic'; },
  normalizeLyricFontKey: function (value) {
    var key = String(value || 'sans');
    return /^(sans|serif|rounded|hand|mono)$/.test(key) || /^custom:/.test(key) ? key : 'sans';
  },
  customLyricFontRecordForKey: function () { return null; },
  normalizePerformanceBackgroundMode: function (value) { return value; },
  normalizePerformanceQuality: function (value) { return value; },
  normalizeForegroundFpsMode: function (value) { return value; },
  normalizeGpuThrottleMode: function (value) { return value; },
  normalizeCoverResolution: function (value) { return value; },
  shelfDefaultAngleForCameraMode: function (mode) { return mode === 'static' ? -15 : 0; },
  // 壁纸模式默认值（与 12d 的 fxDefaults 同形）
  fxDefaults: new Proxy({
    wallpaperMode: false,
    wallpaperOpacity: 1,
    wallpaperFps: 60,
  }, {
    get: function (target, key) { return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined; },
  }),
  packagedDefaultLyricLayoutRaw: function () {
    return { desktopLyricsSchema: 'desktop-lyrics-v3', wallpaperMode: false };
  },
});
vm.runInContext(clampRangeSource, layoutContext, { filename: '03b-clamp-range.slice.js' });
vm.runInContext(readSource(layoutPath), layoutContext, { filename: '03c-lyrics-layout-settings.js' });
const readSavedLyricLayout = layoutContext.readSavedLyricLayout;
const saveLyricLayout = layoutContext.saveLyricLayout;
const normalizeWallpaperFrameRate = layoutContext.normalizeWallpaperFrameRate;

function testWallpaperSettingsRoundTrip() {
  // saveLyricLayout 读的是模块内部 fx 变量：把用户调整写进沙箱 fx 再存档
  layoutContext.fx = {
    preset: 0,
    wallpaperMode: true,
    wallpaperOpacity: 0.6,
    wallpaperFps: 24,
  };
  saveLyricLayout();

  // 模拟重启：重新读档
  var reloaded = readSavedLyricLayout();
  assert.strictEqual(reloaded.wallpaperMode, true, '壁纸模式开关要跨重启保留');
  assert.strictEqual(reloaded.wallpaperOpacity, 0.6, '壁纸透明度要跨重启保留');
  assert.strictEqual(reloaded.wallpaperFps, 24, '壁纸帧数要跨重启保留');

  // 关掉 + 透明度越界夹取
  layoutContext.fx = {
    preset: 0,
    wallpaperMode: false,
    wallpaperOpacity: 0.1,
    wallpaperFps: 999,
  };
  saveLyricLayout();
  reloaded = readSavedLyricLayout();
  assert.strictEqual(reloaded.wallpaperMode, false, '关掉的状态也要如实保留');
  assert.strictEqual(reloaded.wallpaperOpacity, 0.35, '透明度下限 0.35');
  assert.strictEqual(reloaded.wallpaperFps, 60, '帧数上限 60');
}

function testNormalizeWallpaperFrameRate() {
  assert.strictEqual(normalizeWallpaperFrameRate(0), 60, '0 回落默认 60');
  assert.strictEqual(normalizeWallpaperFrameRate(-3), 60, '负数回落默认 60');
  assert.strictEqual(normalizeWallpaperFrameRate('abc'), 60, '非法值回落默认 60');
  assert.strictEqual(normalizeWallpaperFrameRate(undefined), 60, '缺省回落默认 60');
  assert.strictEqual(normalizeWallpaperFrameRate(1), 1, '下限 1');
  assert.strictEqual(normalizeWallpaperFrameRate(60), 60, '上限 60');
  assert.strictEqual(normalizeWallpaperFrameRate(200), 60, '超上限夹到 60');
  assert.strictEqual(normalizeWallpaperFrameRate(24), 24, '合法值原样保留');
  assert.strictEqual(normalizeWallpaperFrameRate(30.6), 31, '四舍五入到整数');
}

/* ---- 04：normalizeWallpaperFps / pushWallpaperState ------------------------ */
const overlaySource = readSource(overlayPath);
const fpsContext = vm.createContext({});
vm.runInContext(extractFunction(overlaySource, 'normalizeWallpaperFps'), fpsContext,
  { filename: '04-normalize-wallpaper-fps.slice.js' });
const normalizeWallpaperFps = fpsContext.normalizeWallpaperFps;

function testNormalizeWallpaperFpsOverlayDefault() {
  assert.strictEqual(normalizeWallpaperFps(0), 60, '0 回落 60（与 03c / fxDefaults 一致）');
  assert.strictEqual(normalizeWallpaperFps(undefined), 60, '缺省回落 60');
  assert.strictEqual(normalizeWallpaperFps(-5), 60, '负数回落 60');
  assert.strictEqual(normalizeWallpaperFps(30), 30, '合法值保留');
  assert.strictEqual(normalizeWallpaperFps(120), 60, '超上限夹到 60');
}

function testPushWallpaperStateThrottlesAndSends() {
  var updateCalls = [];
  var nowMs = 10000;
  var currentPayload = {
    enabled: true, title: '第一首', artist: '歌手', cover: 'c.png',
    playing: true, preset: 0, opacity: 1, frameRate: 60,
    colors: { primary: '#fff', secondary: '#eee', highlight: '#ddd', glow: '#ccc' },
  };
  var pushContext = vm.createContext({
    console: console,
    performance: { now: function () { return nowMs; } },
    Promise: Promise,
    // 有可用的桌面 API
    getDesktopWindowApi: function () {
      return { updateWallpaperMode: function (payload) {
        updateCalls.push(payload);
        return Promise.resolve({ ok: true });
      } };
    },
    // 内容可控的 payload 工厂（节流 key 由内容决定）
    wallpaperPayload: function () { return currentPayload; },
    desktopOverlayPushState: { wallpaperAt: 0, lastWallpaperKey: '' },
  });
  vm.runInContext(extractFunction(overlaySource, 'pushWallpaperState'), pushContext,
    { filename: '04-push-wallpaper-state.slice.js' });

  // 1. 不带 force 首推要真的发（旧版 `if (!force) return;` 是死推送，已修）
  pushContext.pushWallpaperState(false);
  assert.strictEqual(updateCalls.length, 1, '非 force 首推必须发出（旧版死推送回归）');

  // 2. 900ms 内同内容再推 → 节流掉
  pushContext.pushWallpaperState(false);
  assert.strictEqual(updateCalls.length, 1, '同内容 900ms 内要节流');

  // 3. 内容变了（换歌）→ 立即发
  currentPayload = {
    enabled: true, title: '另一首', artist: '歌手', cover: 'c.png',
    playing: true, preset: 0, opacity: 1, frameRate: 60,
    colors: { primary: '#fff', secondary: '#eee', highlight: '#ddd', glow: '#ccc' },
  };
  pushContext.pushWallpaperState(false);
  assert.strictEqual(updateCalls.length, 2, '内容变化要立即推送');
  assert.strictEqual(updateCalls[1].title, '另一首', '推送要带新内容');

  // 4. force 绕过节流
  pushContext.pushWallpaperState(true);
  assert.strictEqual(updateCalls.length, 3, 'force 要绕过节流立即发');
}

function testPushWallpaperStateDropsDeadGate() {
  const pushSrc = extractFunction(overlaySource, 'pushWallpaperState');
  assert.ok(!/if \(!force\) return;/.test(pushSrc), 'pushWallpaperState 不得再有无条件 `if (!force) return;` 死推送');
}

/* ---- 05a：设置项随开关显隐 -------------------------------------------------- */
const panelInputsSource = readSource(panelInputsPath);

function makeVisibilityContext(on) {
  var groupLabel = { hidden: !on };
  var fpsLabel = { hidden: !on };
  var fpsSeg = { hidden: !on };
  var opacityRow = { hidden: !on };
  var opacityInput = { closest: function (selector) { return selector === '.fx-slider' ? opacityRow : null; } };
  var documentStub = {
    getElementById: function (id) {
      if (id === 'wallpaper-settings-label') return groupLabel;
      if (id === 'wallpaper-fps-label') return fpsLabel;
      if (id === 'wallpaper-fps-seg') return fpsSeg;
      if (id === 'fx-wallpaperopacity') return opacityInput;
      return null;
    },
  };
  var context = vm.createContext({
    document: documentStub,
    fx: { wallpaperMode: on },
  });
  vm.runInContext(extractFunction(panelInputsSource, 'updateWallpaperPanelVisibility'), context,
    { filename: '05a-update-wallpaper-panel-visibility.slice.js' });
  context.__els = { groupLabel: groupLabel, fpsLabel: fpsLabel, fpsSeg: fpsSeg, opacityRow: opacityRow };
  return context;
}

function testWallpaperPanelVisibilityFollowsToggle() {
  var off = makeVisibilityContext(false);
  off.updateWallpaperPanelVisibility();
  assert.strictEqual(off.__els.groupLabel.hidden, true, '开关关时「壁纸模式」分组标题要隐藏');
  assert.strictEqual(off.__els.fpsLabel.hidden, true, '开关关时「壁纸帧数」标签要隐藏');
  assert.strictEqual(off.__els.fpsSeg.hidden, true, '开关关时帧数分段要隐藏');
  assert.strictEqual(off.__els.opacityRow.hidden, true, '开关关时透明度滑块要隐藏');

  var on = makeVisibilityContext(true);
  on.updateWallpaperPanelVisibility();
  assert.strictEqual(on.__els.groupLabel.hidden, false, '开关开时「壁纸模式」分组标题要显示');
  assert.strictEqual(on.__els.fpsLabel.hidden, false, '开关开时「壁纸帧数」标签要显示');
  assert.strictEqual(on.__els.fpsSeg.hidden, false, '开关开时帧数分段要显示');
  assert.strictEqual(on.__els.opacityRow.hidden, false, '开关开时透明度滑块要显示');

  // updateFxInputs 必须刷新可见性（否则面板打开时状态不同步）
  const updateFxInputsSrc = extractFunction(panelInputsSource, 'updateFxInputs');
  assert.ok(/updateWallpaperPanelVisibility\(\)/.test(updateFxInputsSrc),
    'updateFxInputs 要调用 updateWallpaperPanelVisibility');
  const applySrc = extractFunction(overlaySource, 'applyWallpaperModeState');
  assert.ok(/updateWallpaperPanelVisibility\(\)/.test(applySrc),
    'applyWallpaperModeState 要调用 updateWallpaperPanelVisibility（开关切换即时生效）');

  /* hidden 属性必须真的能藏住：.fx-slider/.fx-seg/.fx-section-label 都带 display:grid/flex，
   * 会盖掉 UA 的 [hidden]{display:none}。缺这条 CSS 就是「代码设了 hidden，面板里照样显示」。 */
  const panelCss = readSource(path.join(appRoot, 'public', 'css', '07-fx', 'fx-panel.css'));
  assert.ok(/#fx-panel \.fx-slider\[hidden\][\s\S]{0,200}display:none/.test(panelCss),
    'CSS 要显式让 .fx-slider[hidden] 的 display:none 生效');
  assert.ok(/#fx-panel \.fx-seg\[hidden\]/.test(panelCss), 'CSS 要覆盖 .fx-seg[hidden]');
  assert.ok(/#fx-panel \.fx-section-label\[hidden\]/.test(panelCss), 'CSS 要覆盖 .fx-section-label[hidden]');
}

/* ---- 12d：开发锁已解除 ------------------------------------------------------ */
const globalsSource = readSource(globalsPath);

function testDevelopmentLockRemoved() {
  const lockMatch = globalsSource.match(/DEVELOPMENT_LOCKED_FX\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(lockMatch, '12d 要定义 DEVELOPMENT_LOCKED_FX');
  assert.ok(!/wallpaperMode/.test(lockMatch[1]), 'DEVELOPMENT_LOCKED_FX 不得再锁 wallpaperMode');
  const normalizeMatch = globalsSource.match(/function normalizeDevelopmentLockedFxState\([\s\S]*?\n\}/);
  assert.ok(normalizeMatch, '12d 要定义 normalizeDevelopmentLockedFxState');
  assert.ok(!/fx\.wallpaperMode\s*=\s*false/.test(normalizeMatch[1]),
    'normalizeDevelopmentLockedFxState 不得再强制关掉壁纸模式');
}

/* ---- main.js：主进程接线 ---------------------------------------------------- */
const mainSource = readSource(mainProcessPath);

function extractMainFunction(name) {
  return extractFunction(mainSource, name);
}

function testMainProcessWiring() {
  const createSrc = extractMainFunction('createWallpaperWindow');
  assert.ok(/enableFullDesktopMode\(mainWindow/.test(createSrc),
    'createWallpaperWindow 要走完整桌面模式 runtime.enable（附着到 WorkerW）');
  const enableSrc = extractMainFunction('enableFullDesktopMode');
  assert.ok(/runtime\.enable\(win/.test(enableSrc), 'enableFullDesktopMode 要调 runtime.enable');
  assert.ok(/applyWallpaperModeOpacity/.test(enableSrc), '启用后要应用用户透明度');

  const closeSrc = extractMainFunction('closeWallpaperWindow');
  assert.ok(/disableFullDesktopMode/.test(closeSrc), '关闭壁纸模式要走 disableFullDesktopMode');
  const disableSrc = extractMainFunction('disableFullDesktopMode');
  assert.ok(/runtime\.disable\(|fullDesktopModeRuntime\.disable\(/.test(disableSrc),
    'disableFullDesktopMode 要调 runtime.disable');
  assert.ok(/restoreWallpaperModeOpacity/.test(disableSrc), '退出时要恢复窗口透明度');

  assert.ok(!/wallpaper\.html/.test(mainSource), 'main.js 不得再引用旧 Canvas 链路 wallpaper.html');
  assert.ok(!/DesktopWallpaperRuntime/.test(mainSource), 'main.js 不得再引用旧 DesktopWallpaperRuntime');
  assert.ok(!/\.enableDesktopMode\(/.test(mainSource), 'main.js 不得再调用不存在的 enableDesktopMode 方法');
}

function testWallpaperIpcTrusted() {
  for (const channel of ['mineradio-wallpaper-set-enabled', 'mineradio-wallpaper-update']) {
    const start = mainSource.indexOf("'" + channel + "'");
    assert.ok(start >= 0, 'main.js 要注册 ' + channel);
    const chunk = mainSource.slice(start, start + 2500);
    assert.ok(/isTrustedMainWindowIpc\(event\)/.test(chunk),
      channel + ' 必须校验 isTrustedMainWindowIpc');
  }
}

function testBeforeQuitDisposes() {
  assert.ok(/dispose\('app-before-quit'\)/.test(mainSource),
    'before-quit 要先 dispose 完整桌面模式（把窗口从桌面摘下来）再退出');
  assert.ok(/fullDesktopQuitDisposePending/.test(mainSource),
    'before-quit 要用 fullDesktopQuitDisposePending 防止 dispose 竞态');
  assert.ok(/preventDefault\(\)/.test(mainSource.slice(mainSource.indexOf("before-quit-for-full-desktop") > 0
    ? mainSource.indexOf("before-quit-for-full-desktop") - 500
    : mainSource.indexOf("dispose('app-before-quit')") - 800)),
    'dispose 完成前要 preventDefault 挡住首次 quit');
}

/* 壁纸模式把整个窗口推到桌面图标层后面：一旦焦点被别的程序抢走，页面里的 keydown
 * 根本收不到。必须有主进程级 Esc + 托盘菜单两个逃生口，否则用户会被困在壁纸模式里。 */
function testWallpaperEscapeHatches() {
  // 1. 主进程 before-input-event：enabled 时 Esc 直接退出（优先于全屏退出）
  const inputStart = mainSource.indexOf("mainWindow.webContents.on('before-input-event'");
  assert.ok(inputStart >= 0, 'main.js 要有 before-input-event 处理');
  const inputChunk = mainSource.slice(inputStart, inputStart + 1400);
  assert.ok(/Escape/.test(inputChunk), 'before-input-event 要处理 Escape');
  assert.ok(/fullDesktopModeRuntime\.isEnabled\(\)/.test(inputChunk),
    'Esc 分支要判断完整桌面模式是否已启用');
  assert.ok(/disableFullDesktopMode\('escape-key'\)/.test(inputChunk),
    'Esc 要真的退出壁纸模式');
  assert.ok(/event\.preventDefault\(\)/.test(inputChunk), 'Esc 要 preventDefault，别让页面重复处理');

  // 2. 托盘菜单：enabled 时出现「退出壁纸模式」
  const trayStart = mainSource.indexOf('function createOrUpdateTray');
  assert.ok(trayStart >= 0, 'main.js 要有托盘菜单');
  const trayChunk = mainSource.slice(trayStart, trayStart + 3000);
  assert.ok(/退出壁纸模式/.test(trayChunk), '托盘菜单要有「退出壁纸模式」项');
  assert.ok(/disableFullDesktopMode\('tray-exit-wallpaper'\)/.test(trayChunk),
    '托盘项要调 disableFullDesktopMode');
  assert.ok(/fullDesktopModeRuntime\.isEnabled\(\)/.test(trayChunk),
    '托盘项只在壁纸模式启用时出现');
  /* 托盘左键 / 菜单「显示」必须走同一条路：壁纸模式下窗口是桌面的子窗口，
     不先退出壁纸模式 focus() 唤不出来。 */
  assert.ok(/const trayPrimaryAction = \(\) =>/.test(trayChunk), '托盘左键要有统一入口 trayPrimaryAction');
  assert.ok(/tray\.on\('click', trayPrimaryAction\)/.test(trayChunk), '左键要接到 trayPrimaryAction');
  assert.ok(/click: \(\) => trayPrimaryAction\(\)/.test(trayChunk),
    '菜单「显示」也要走 trayPrimaryAction（否则壁纸模式下点了没反应）');

  // 3. 渲染层：Esc 监听存在，且锁屏状态下不误退
  const bridgeSrc = extractFunction(overlaySource, 'initDesktopWallpaperRuntimeBridge');
  assert.ok(/keydown/.test(bridgeSrc) && /Escape/.test(bridgeSrc), '渲染层也要有 Esc 监听（双保险）');
  assert.ok(/softwareInteractionLocked/.test(bridgeSrc), '软件锁状态下 Esc 不误退');
}

/* ---- preload：状态桥接 ------------------------------------------------------ */
const preloadSource = readSource(preloadPath);

function testPreloadBridges() {
  assert.ok(/getWallpaperModeStatus:/.test(preloadSource), 'preload 要暴露 getWallpaperModeStatus');
  // preload 里是对象字面量的箭头函数属性：截出 `(callback) => { ... }` 整段
  const marker = 'onWallpaperModeState: (';
  const memberStart = preloadSource.indexOf(marker);
  assert.ok(memberStart >= 0, 'preload 要暴露 onWallpaperModeState');
  const arrowStart = preloadSource.indexOf('(', memberStart);
  let i = arrowStart;
  let paren = 0;
  for (; i < preloadSource.length; i++) {
    if (preloadSource[i] === '(') paren += 1;
    else if (preloadSource[i] === ')') { paren -= 1; if (paren === 0) { i += 1; break; } }
  }
  const bodyStart = preloadSource.indexOf('{', preloadSource.indexOf('=>', i));
  let depth = 0;
  let end = bodyStart;
  for (; end < preloadSource.length; end++) {
    if (preloadSource[end] === '{') depth += 1;
    else if (preloadSource[end] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const arrowSrc = preloadSource.slice(arrowStart, end + 1);
  assert.ok(/ipcRenderer\.on/.test(arrowSrc), 'onWallpaperModeState 要订阅 IPC 状态推送');

  var onCalls = [];
  var removeCalls = [];
  var bridgeContext = vm.createContext({
    ipcRenderer: {
      on: function (channel, listener) { onCalls.push([channel, listener]); },
      removeListener: function (channel, listener) { removeCalls.push([channel, listener]); },
    },
  });
  vm.runInContext('var onWallpaperModeState = ' + arrowSrc + ';', bridgeContext,
    { filename: 'preload-onWallpaperModeState.slice.js' });

  // 非函数回调 → 返回空解绑函数，不炸
  var noop = bridgeContext.onWallpaperModeState('not-a-function');
  assert.strictEqual(typeof noop, 'function', '非法回调也要返回解绑函数');
  assert.strictEqual(onCalls.length, 0, '非法回调不得注册监听');

  // 正常回调 → 注册到 runtime-state 频道，解绑函数真的解绑
  var received = [];
  var unbind = bridgeContext.onWallpaperModeState(function (payload) { received.push(payload); });
  assert.strictEqual(onCalls.length, 1, '要注册一次监听');
  assert.strictEqual(onCalls[0][0], 'mineradio-wallpaper-runtime-state', '频道名要对');
  onCalls[0][1](null, { enabled: true, phase: 'attached' });
  assert.deepStrictEqual(received, [{ enabled: true, phase: 'attached' }], '状态要透传给回调');
  unbind();
  assert.strictEqual(removeCalls.length, 1, '解绑函数要移除监听');
  assert.strictEqual(removeCalls[0][0], 'mineradio-wallpaper-runtime-state', '解绑频道名要对');
}

/* ---- 旧 Canvas 链路 / 打包排除 ---------------------------------------------- */
function testLegacyCanvasChainRemoved() {
  assert.ok(!fs.existsSync(path.join(appRoot, 'public', 'wallpaper.html')),
    'public/wallpaper.html 必须删除（guards.js 设计要求）');
  assert.ok(!fs.existsSync(path.join(appRoot, 'desktop', 'wallpaper-preload.js')),
    'desktop/wallpaper-preload.js 必须删除');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const files = pkg.build && pkg.build.files || [];
  assert.ok(files.some(function (f) { return f === '!public/wallpaper.html'; }),
    'electron-builder 必须排除 public/wallpaper.html');
  assert.ok(files.some(function (f) { return f === '!desktop/wallpaper-preload.js'; }),
    'electron-builder 必须排除 desktop/wallpaper-preload.js');
}

/* ---- index.html：解锁与默认隐藏 --------------------------------------------- */
const indexHtml = readSource(indexPath);

function testIndexHtmlUnlock() {
  const start = indexHtml.indexOf('id="t-wallpaperMode"');
  assert.ok(start >= 0, 'index.html 要有壁纸模式开关');
  const chunk = indexHtml.slice(Math.max(0, start - 200), start + 400);
  assert.ok(!/dev-locked/.test(chunk), '壁纸模式开关不得再有 dev-locked');
  assert.ok(!/fx-dev-badge/.test(chunk), '壁纸模式开关不得再有「开发中」徽标');

  assert.ok(/id="wallpaper-settings-label"[^>]*hidden/.test(indexHtml),
    '「壁纸模式」分组标题默认 hidden（随开关显示）');
  assert.ok(/id="wallpaper-fps-label"[^>]*hidden/.test(indexHtml),
    '「壁纸帧数」标签默认 hidden（随开关显示）');
  assert.ok(/id="wallpaper-fps-seg"[^>]*hidden/.test(indexHtml),
    '帧数分段默认 hidden（随开关显示）');

  /* 开关的 title 是用户唯一的「怎么退出」提示：默认走标准 WorkerW 时窗口拿不到键盘焦点，
   * 写「Esc 退出」就是骗人，必须指向托盘。 */
  const toggleTag = indexHtml.slice(start, indexHtml.indexOf('</div>', start));
  assert.ok(/title="[^"]*托盘/.test(toggleTag), '壁纸模式开关的提示要指向托盘退出');
  assert.ok(!/title="[^"]*Esc/.test(toggleTag), '默认模式窗口收不到键盘事件，提示里不能写 Esc');
}

function testFpsSegBinding() {
  const bindings = readSource(bindingsPath);
  assert.ok(/wallpaper-fps-seg/.test(bindings), 'bindings 要绑定壁纸帧数分段');
  assert.ok(/pushWallpaperState\(true\)/.test(bindings), '改帧数要立即推送（force）');
  assert.ok(/saveLyricLayout\(\)/.test(bindings), '改帧数要存档');
}

/* 壁纸模式控制器（右上角 dock）：渲染层 updateDesktopModeControl / initDesktopModeControls
 * 靠这些 id 找元素，缺一个就静默失效（用户会以为「开了壁纸模式什么都没有」）。
 * 同时它是桌面上唯一看得见的退出入口 —— 桌面模式下任务栏点不到窗口。 */
function testDesktopModeControlDockExists() {
  const ids = [
    'desktop-mode-control-dock',
    'desktop-mode-control-handle',
    'desktop-mode-control-panel',
    'desktop-software-lock-toggle',
    'desktop-software-lock-state',
    'desktop-icons-visible-toggle',
    'desktop-icons-visible-state',
    'desktop-exit-wallpaper-toggle',
  ];
  for (const id of ids) {
    const hits = indexHtml.split('id="' + id + '"').length - 1;
    assert.strictEqual(hits, 1, 'index.html 里 #' + id + ' 必须恰好出现一次，实际 ' + hits);
  }
  // 面板初始必须是关着的（aria-hidden + inert），否则一进桌面模式就挡在桌面上
  const panelTag = indexHtml.slice(indexHtml.indexOf('id="desktop-mode-control-panel"') - 120,
    indexHtml.indexOf('id="desktop-mode-control-panel"') + 140);
  assert.ok(/aria-hidden="true"/.test(panelTag), '控制面板初始要 aria-hidden="true"');
  assert.ok(/inert/.test(panelTag), '控制面板初始要 inert（不可聚焦）');

  // 样式：只有挂在桌面上才出现；只有 is-open 才展开面板
  const shellCss = readSource(path.join(appRoot, 'public', 'css', '10-shell', 'shell.css'));
  /* 只有「可交互壁纸」才显示控制器：标准 WorkerW 附着会把窗口压到桌面图标层下面，
   * 点击落在桌面上，控制器的按钮根本点不到 —— 显示出来只会误导用户去点。 */
  assert.ok(/body\.desktop-wallpaper-mode\.desktop-wallpaper-interactive \.desktop-mode-control-dock\{display:flex\}/.test(shellCss),
    '控制器只在可交互壁纸模式（窗口能收到点击）时显示');
  assert.ok(!/body\.desktop-wallpaper-mode \.desktop-mode-control-dock\{display:flex\}/.test(shellCss),
    '标准 WorkerW 壁纸（窗口点不到）不得显示控制器');
  assert.ok(/\.desktop-mode-control-dock\.is-open \.desktop-mode-control-panel\{display:block\}/.test(shellCss),
    '面板只在 dock.is-open 时展开');
  assert.ok(/\.desktop-mode-control-dock\{[^}]*display:none/.test(shellCss), '控制器默认隐藏');
  assert.ok(/--desktop-safe-top/.test(shellCss), '控制器要避开系统安全区（任务栏 / 刘海）');

  // 退出按钮要真的接到 applyWallpaperModeState
  const initSrc = extractFunction(overlaySource, 'initDesktopModeControls');
  assert.ok(/desktop-exit-wallpaper-toggle/.test(initSrc), 'initDesktopModeControls 要绑定退出按钮');
  const exitChunk = initSrc.slice(initSrc.indexOf('desktop-exit-wallpaper-toggle'));
  assert.ok(/applyWallpaperModeState\(true\)/.test(exitChunk.slice(0, 800)),
    '退出按钮要调 applyWallpaperModeState 真的退出');
  assert.ok(/saveLyricLayout\(\)/.test(exitChunk.slice(0, 800)), '退出后要存档（下次不自动进桌面模式）');

  /* index-loader 用 fetch 注入模块，执行时机可能早于 body 解析完成：
   * 找不到 DOM 时必须等 DOMContentLoaded 再试一次，否则控制器永远不初始化。 */
  assert.ok(/document\.readyState === 'loading'/.test(initSrc), '找不到 DOM 时要判断 readyState');
  assert.ok(/DOMContentLoaded/.test(initSrc), '找不到 DOM 时要等 DOMContentLoaded 重试');
  assert.ok(/desktopModeControlsInitPending/.test(overlaySource), '重试要防重复注册（pending 标记）');
}

async function run() {
  testWallpaperSettingsRoundTrip();
  testNormalizeWallpaperFrameRate();
  testNormalizeWallpaperFpsOverlayDefault();
  testPushWallpaperStateThrottlesAndSends();
  testPushWallpaperStateDropsDeadGate();
  testWallpaperPanelVisibilityFollowsToggle();
  testDevelopmentLockRemoved();
  testMainProcessWiring();
  testWallpaperIpcTrusted();
  testBeforeQuitDisposes();
  testWallpaperEscapeHatches();
  testPreloadBridges();
  testLegacyCanvasChainRemoved();
  testIndexHtmlUnlock();
  testFpsSegBinding();
  testDesktopModeControlDockExists();
  console.log('OK wallpaper-mode');
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
