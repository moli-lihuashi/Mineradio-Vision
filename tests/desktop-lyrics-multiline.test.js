'use strict';

// =============================================================================
// 桌面歌词「多行 / 倾斜 / 动效 / 位置」行为回归
// 覆盖：
//   1. 行数归一化只认 1/3/5/7，非法值就近吸附（0/2/4/6/8/-4/undefined）
//   2. 换行动效归一化只认 slide/flip/float/none，其余回落 slide
//   3. 多行窗口切片 desktopLyricWindow：当前句恒在 floor(count/2) 行；
//      开头/结尾不足时补空行；active 唯一；progress 透传；count<=1 走单行
//   4. 主进程窗口尺寸/定位：行数越多窗口越高、水平按 x 比例居中、受屏幕高度封顶、
//      用户拖到副屏后按该屏定位
//   5. 主进程 layoutChanged：只有 x / y / lineCount 变化才重置窗口位置，
//      调透明度、字号之类不动窗口
//   6. 多行字号与倾斜预留：行数越多字越小、当前句比相邻句大；
//      倾斜越大左右预留越宽（避免旋转后的字被裁）
// 说明：跑的是 public/js/modules/02-visual/03c-lyrics-layout-settings.js、
// public/js/modules/10-shell/04-desktop-overlay-fullscreen.js、public/desktop-lyrics.html
// 与 desktop/main.js 里的真实函数源码；DOM/媒体/屏幕为可控模拟对象，不是桌面端实测。
// =============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const layoutPath = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '03c-lyrics-layout-settings.js');
const overlayPath = path.join(appRoot, 'public', 'js', 'modules', '10-shell', '04-desktop-overlay-fullscreen.js');
const lyricsPagePath = path.join(appRoot, 'public', 'desktop-lyrics.html');
const mainProcessPath = path.join(appRoot, 'desktop', 'main.js');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

/* 从真实源码里截取函数体（保持原样，不重写实现）。
 * 先扫完参数列表再找函数体的 `{`：参数里可能有带大括号的默认值（如 `options = {}`），
 * 直接取第一个 `{` 会把它当成函数体开头。 */
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
      const lineEnd = source.indexOf('\n', i);
      if (lineEnd < 0) break;
      i = lineEnd;
      continue;
    }
    if (ch === '/' && next === '*') {
      const blockEnd = source.indexOf('*/', i);
      if (blockEnd < 0) break;
      i = blockEnd + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 大括号不闭合');
}

function extractVarDeclaration(source, name) {
  const match = source.match(new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;'));
  if (!match) throw new Error('未找到变量 ' + name);
  return match[0];
}

function clampNumberStub(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ---- 03c：行数 / 动效归一化 ---------------------------------------------- */
const layoutSource = readSource(layoutPath);
const layoutContext = vm.createContext({ console: console });
vm.runInContext([
  extractVarDeclaration(layoutSource, 'DESKTOP_LYRICS_LINE_OPTIONS'),
  extractFunction(layoutSource, 'desktopLyricsLineOptions'),
  extractFunction(layoutSource, 'normalizeDesktopLyricsLineCount'),
  extractFunction(layoutSource, 'normalizeDesktopLyricsMotion'),
  extractFunction(layoutSource, 'desktopLyricsMotionLabel'),
].join('\n\n'), layoutContext, { filename: '03c-lyrics-layout-settings.slice.js' });

const normalizeLineCount = layoutContext.normalizeDesktopLyricsLineCount;
const normalizeMotion = layoutContext.normalizeDesktopLyricsMotion;
const motionLabel = layoutContext.desktopLyricsMotionLabel;

/* ---- 03c：桌面歌词开关的一次性默认值迁移 ----------------------------------
 * 2026-11-06 起桌面歌词默认【关】，迁移标记升级为 'off-v4'：旧存档（含旧 'on' 标记）
 * 一律按新默认值重置一次，避免播放器一启动就自动铺桌面歌词；之后才完全听用户的。
 * 整个 03c 文件放进沙箱跑真实的 readSavedLyricLayout()。 */
const STORE_KEY = 'mineradio-lyric-layout-v1';
const clampRangeSource = extractFunction(
  readSource(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '03b-lyrics-color-utils.js')),
  'clampRange'
);
let storedLayoutJson = null;
const readLayoutContext = vm.createContext({
  console: console,
  localStorage: {
    getItem: function (key) { return key === STORE_KEY ? storedLayoutJson : null; },
    setItem: function (key, value) { if (key === STORE_KEY) storedLayoutJson = String(value); },
  },
  LYRIC_LAYOUT_STORE_KEY: STORE_KEY,
  VISUAL_PRESET_MAX_INDEX: 8,
  VISUAL_PRESET_SCHEMA: 'visual-preset-v3',
  // saveLyricLayout 会用到（本测试只关心 desktopLyrics 组的键）
  presetMeta: new Array(9),
  playing: false,
  currentIdx: -1,
  // 这两个的真实定义在 12d-fx-runtime-globals.js（加载顺序在 03c 之前），这里给静态值
  startupVisualPreviewActive: false,
  playbackVisualPreset: 0,
  normalizeHexColor: function (value, fallback) { return String(value || fallback || ''); },
  normalizeCustomBackgroundImage: function (value) { return value || ''; },
  normalizeCustomBackgroundMedia: function (value) { return value || null; },
  normalizeShelfCameraMode: function (value) { return String(value || '') === 'static' ? 'static' : 'dynamic'; },
  // 与 02-visual/06 的 normalizeLyricFontKey 同语义：不认识的字体键回落 sans
  normalizeLyricFontKey: function (value) {
    var key = String(value || 'sans');
    return /^(sans|serif|rounded|hand|mono)$/.test(key) || /^custom:/.test(key) ? key : 'sans';
  },
  customLyricFontRecordForKey: function () { return null; },
  // 这些只影响别的设置项，跟 desktopLyrics 无关，给空实现即可
  normalizePerformanceBackgroundMode: function (value) { return value; },
  normalizePerformanceQuality: function (value) { return value; },
  normalizeForegroundFpsMode: function (value) { return value; },
  normalizeGpuThrottleMode: function (value) { return value; },
  normalizeCoverResolution: function (value) { return value; },
  shelfDefaultAngleForCameraMode: function (mode) { return mode === 'static' ? -15 : 0; },
  // 新默认值：桌面歌词默认关
  fxDefaults: new Proxy({ desktopLyrics: false }, {
    get: function (target, key) { return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined; },
  }),
  packagedDefaultLyricLayoutRaw: function () {
    return { desktopLyricsSchema: 'desktop-lyrics-v3', desktopLyrics: false };
  },
});
vm.runInContext(clampRangeSource, readLayoutContext, { filename: '03b-clamp-range.slice.js' });
vm.runInContext(layoutSource, readLayoutContext, { filename: '03c-lyrics-layout-settings.js' });
const readSavedLyricLayout = readLayoutContext.readSavedLyricLayout;

/* ---- 04：多行窗口切片 ----------------------------------------------------- */
const overlaySource = readSource(overlayPath);
const overlayContext = vm.createContext({
  console: console,
  clampRange: clampNumberStub,
  normalizeDesktopLyricsLineCount: normalizeLineCount,
});
vm.runInContext(
  extractFunction(overlaySource, 'desktopLyricWindow'),
  overlayContext,
  { filename: '04-desktop-overlay-fullscreen.slice.js' }
);
const desktopLyricWindow = overlayContext.desktopLyricWindow;

/* ---- desktop-lyrics.html：字号与倾斜预留 ---------------------------------- */
const lyricsPageSource = readSource(lyricsPagePath);
const pageContext = vm.createContext({
  console: console,
  baseFontSize: 58,
  clamp: clampNumberStub,
  innerWidth: 1000,
  innerHeight: 700,
  state: { tilt: 0, lineHeight: 1.18, lineCount: 3 },
});
vm.runInContext([
  extractFunction(lyricsPageSource, 'rowFontFor'),
  extractFunction(lyricsPageSource, 'fitStackByHeight'),
  // 倾斜改成绕 Y 轴旋转后，预留量由「行宽 + 透视距离」决定，这三个是它的依赖链
  extractFunction(lyricsPageSource, 'rotateYOverhang'),
  extractFunction(lyricsPageSource, 'stackRowMaxWidth'),
  extractFunction(lyricsPageSource, 'stackTiltOverhang'),
].join('\n\n'), pageContext, { filename: 'desktop-lyrics.slice.js' });
// 透视距离用页面里的真实常量（不写死，改了会跟着变；CSS 是否一致由专门的用例管）
const perspectiveMatch = lyricsPageSource.match(/var LYRIC_ROTATE_PERSPECTIVE = (\d+);/);
assert.ok(perspectiveMatch, '桌面歌词页应声明 LYRIC_ROTATE_PERSPECTIVE');
pageContext.LYRIC_ROTATE_PERSPECTIVE = Number(perspectiveMatch[1]);
const rowFontFor = pageContext.rowFontFor;
const fitStackByHeight = pageContext.fitStackByHeight;
const stackTiltOverhang = pageContext.stackTiltOverhang;
const pageState = pageContext.state;

/* ---- desktop-lyrics.html：拖动跟手 / 不自我打断 ----------------------------- */
let dragNowMs = 0;
let dragLocked = false;
const moveCalls = [];
const dragContext = vm.createContext({
  console: console,
  dragging: false,
  dragLast: { x: 0, y: 0 },
  dragMovedAt: 0,
  performance: { now: function () { return dragNowMs; } },
  isLocked: function () { return dragLocked; },
  window: {
    desktopOverlay: {
      moveLyricsBy: function (dx, dy) { moveCalls.push([dx, dy]); return Promise.resolve({ ok: true }); },
    },
  },
});
vm.runInContext([
  extractFunction(lyricsPageSource, 'moveDrag'),
  extractFunction(lyricsPageSource, 'shouldCancelDrag'),
].join('\n\n'), dragContext, { filename: 'desktop-lyrics-drag.slice.js' });
const moveDrag = dragContext.moveDrag;
const shouldCancelDrag = dragContext.shouldCancelDrag;

/* ---- desktop/main.js：窗口尺寸 / 定位 / 布局变化 / 位置持久化 ------------- */
const mainSource = readSource(mainProcessPath);
let primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
let matchedDisplayBounds = primaryDisplayBounds;
// 系统光标位置（主进程轮询 screen.getCursorScreenPoint() 得到的值）
let cursorPoint = { x: 0, y: 0 };
// 模拟 userData 里的锚点文件：null 表示文件不存在（首次启动）
let anchorFileJson = null;
const anchorWrites = [];
const mainContext = vm.createContext({
  console: console,
  screen: {
    getPrimaryDisplay: function () { return { bounds: primaryDisplayBounds }; },
    getDisplayMatching: function () { return { bounds: matchedDisplayBounds }; },
    getCursorScreenPoint: function () { return { x: cursorPoint.x, y: cursorPoint.y }; },
  },
  desktopLyricsUserBounds: null,
  desktopLyricsState: {},
  desktopLyricsWindow: null,
  desktopLyricsProgrammaticMove: false,
  app: { getPath: function () { return '/fake-user-data'; } },
  path: { join: function () { return Array.prototype.slice.call(arguments).join('/'); } },
  fs: {
    readFileSync: function (file) {
      if (anchorFileJson == null) throw new Error('ENOENT ' + file);
      return anchorFileJson;
    },
    writeFileSync: function (file, text) {
      anchorFileJson = text;
      anchorWrites.push(file);
    },
    renameSync: function () {},
  },
  // 落盘用了 debounce：桩里立即执行，这样测试能同步看到写出的内容
  setTimeout: function (fn) { fn(); return { unref: function () {} }; },
  clearTimeout: function () {},
  desktopLyricsAnchor: null,
  desktopLyricsAnchorLoaded: false,
  desktopLyricsAnchorSaveTimer: null,
  DESKTOP_LYRICS_ANCHOR_DEFAULT: { xRatio: 0.5, yRatio: 0.76 },
  desktopLyricsPointerCapture: false,
  desktopLyricsMouseIgnored: null,
  desktopLyricsHotBounds: null,
  desktopLyricsCursorInside: false,
  desktopLyricsDragUntil: 0,
});
vm.runInContext([
  extractFunction(mainSource, 'clampNumber'),
  extractFunction(mainSource, 'desktopLyricsAnchorPath'),
  extractFunction(mainSource, 'loadDesktopLyricsAnchor'),
  extractFunction(mainSource, 'saveDesktopLyricsAnchor'),
  extractFunction(mainSource, 'desktopLyricsAnchorFromBounds'),
  extractFunction(mainSource, 'desktopLyricsDefaultBounds'),
  extractFunction(mainSource, 'constrainDesktopLyricsBounds'),
  extractFunction(mainSource, 'setDesktopLyricsBounds'),
  extractFunction(mainSource, 'positionDesktopLyricsWindow'),
  extractFunction(mainSource, 'desktopLyricsDragNextBounds'),
  extractFunction(mainSource, 'applyDesktopLyricsDrag'),
  extractFunction(mainSource, 'desktopLyricsLayoutChanged'),
  extractFunction(mainSource, 'pointInBounds'),
  extractFunction(mainSource, 'desktopLyricsHotBoundsOnScreen'),
  extractFunction(mainSource, 'applyDesktopLyricsMouseBehavior'),
  extractFunction(mainSource, 'desktopLyricsCursorOverStage'),
  extractFunction(mainSource, 'syncDesktopLyricsCursorCapture'),
  extractFunction(mainSource, 'sendDesktopLyricsState'),
  extractFunction(mainSource, 'createDesktopLyricsWindow'),
].join('\n\n'), mainContext, { filename: 'desktop-main.slice.js' });
const desktopLyricsDefaultBounds = mainContext.desktopLyricsDefaultBounds;
const constrainDesktopLyricsBounds = mainContext.constrainDesktopLyricsBounds;
const positionDesktopLyricsWindow = mainContext.positionDesktopLyricsWindow;
const desktopLyricsDragNextBounds = mainContext.desktopLyricsDragNextBounds;
const applyDesktopLyricsDrag = mainContext.applyDesktopLyricsDrag;
const desktopLyricsLayoutChanged = mainContext.desktopLyricsLayoutChanged;
const desktopLyricsCursorOverStage = mainContext.desktopLyricsCursorOverStage;
const syncDesktopLyricsCursorCapture = mainContext.syncDesktopLyricsCursorCapture;
const createDesktopLyricsWindow = mainContext.createDesktopLyricsWindow;

/* 面板显隐：真的跑 updateDesktopLyricsPanelVisibility()，检查它把哪个 class 挂到 #fx-panel */
const fxPanelSource = readSource(path.join(appRoot, 'public', 'js', 'modules', '07-fx', '05a-fx-panel-inputs.js'));
let panelClassList = [];
const panelContext = vm.createContext({
  console: console,
  fx: { desktopLyrics: true },
  isDevelopmentLockedFx: function () { return false; },
  document: {
    getElementById: function (id) {
      if (id !== 'fx-panel') return null;
      return {
        classList: {
          toggle: function (name, on) {
            panelClassList = panelClassList.filter(function (item) { return item !== name; });
            if (on) panelClassList.push(name);
          },
        },
      };
    },
  },
});
vm.runInContext(
  extractFunction(fxPanelSource, 'updateDesktopLyricsPanelVisibility'),
  panelContext,
  { filename: '05a-visibility.slice.js' }
);
const updateDesktopLyricsPanelVisibility = panelContext.updateDesktopLyricsPanelVisibility;

/* ------------------------------------------------------------------------- */

function makeEntries(texts) {
  return texts.map(function (text, i) {
    return { text: text, progress: i % 2 === 0 ? 1 : 0.25 };
  });
}

function testLineCountNormalization() {
  const cases = [
    [0, 1], [1, 1], [2, 1], [3, 3], [4, 3], [5, 5], [6, 5], [7, 7], [8, 7],
    // 9 行离 10 更近（差 1）而不是 7（差 2）—— 吸附按最近邻算，不能简单取「下一个奇数」
    [9, 10], [10, 10], [11, 10],
    [-4, 1], [undefined, 1], [null, 1], ['5', 5], ['10', 10], [12, 10],
  ];
  cases.forEach(function (pair) {
    const input = pair[0];
    const expected = pair[1];
    assert.strictEqual(
      normalizeLineCount(input),
      expected,
      '行数归一化 ' + String(input) + ' 应为 ' + expected
    );
  });
  // 归一化结果必须始终是 1/3/5/7/10 之一，UI 分段控件才有一致的选中态
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100, -100].forEach(function (value) {
    assert.ok(
      [1, 3, 5, 7, 10].indexOf(normalizeLineCount(value)) >= 0,
      '行数归一化结果必须落在 1/3/5/7/10，实际 ' + normalizeLineCount(value)
    );
  });
}

function testMotionNormalization() {
  ['slide', 'flip', 'float', 'none'].forEach(function (value) {
    assert.strictEqual(normalizeMotion(value), value, '合法动效应原样保留：' + value);
  });
  [['', 'slide'], [null, 'slide'], [undefined, 'slide'], ['blur', 'slide'], ['SLIDE', 'slide'], ['flip ', 'slide']].forEach(function (pair) {
    assert.strictEqual(normalizeMotion(pair[0]), pair[1], '非法动效应回落 slide：' + String(pair[0]));
  });
  assert.strictEqual(motionLabel('flip'), '3D 翻转');
  assert.strictEqual(motionLabel('unknown'), '上浮');
}

function testDesktopLyricsDefaultMigration() {
  // 新默认值：桌面歌词默认【关】（2026-11-06 起），迁移标记为 'off-v4'。
  // 大原则：只有「新标记 + 用户显式写下的值」才听用户的，其余一律回到新默认值关。

  // 1. 完全没有存档（首次启动）→ 走打包默认 → 关
  storedLayoutJson = null;
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, false, '首次启动不应自动铺桌面歌词');

  // 2. 老存档：没有迁移标记，desktopLyrics 被写成了 true（旧默认开着）→ 一次性按新默认值关掉
  storedLayoutJson = JSON.stringify({ preset: 1, desktopLyrics: true, desktopLyricsSchema: 'desktop-lyrics-v3' });
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, false, '老存档里写着 true 也要按新默认值关掉一次');

  // 3. 老迁移标记 'on' + 用户当时开着 → 旧标记不被认可，仍然重置为关
  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'on', desktopLyrics: true });
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, false, "旧 'on' 标记不做数，一律重置为关");

  // 4. 老迁移标记 'on' + 用户当时关着 → 关（重置结果一致）
  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'on', desktopLyrics: false });
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, false, "旧 'on' 标记 + 关 → 仍是关");

  // 5. 新标记 'off-v4' + 用户在新版本里手动开启过 → 开，必须听用户的
  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4', desktopLyrics: true });
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, true, '新标记之后要听用户的：开就是开');

  // 6. 新标记 'off-v4' + 用户手动关掉 → 关
  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4', desktopLyrics: false });
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, false, '新标记之后要听用户的：关就是关');

  // 7. 有新标记但没写 desktopLyrics 字段 → 回到新默认值关
  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4' });
  assert.strictEqual(readSavedLyricLayout().desktopLyrics, false);

  storedLayoutJson = null;
}

function testSavedSizeRespectsNewLimits() {
  const min = readLayoutContext.DESKTOP_LYRICS_SIZE_MIN;
  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4', desktopLyrics: true, desktopLyricsSize: min });
  assert.strictEqual(readSavedLyricLayout().desktopLyricsSize, min, '存下来的最小字号必须能原样读回（不能被旧下限 0.72 顶上去）');

  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4', desktopLyrics: true, desktopLyricsSize: 0.2 });
  assert.strictEqual(readSavedLyricLayout().desktopLyricsSize, min, '比下限还小的存档要夹到下限');

  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4', desktopLyrics: true, desktopLyricsSize: 9 });
  assert.strictEqual(readSavedLyricLayout().desktopLyricsSize, readLayoutContext.DESKTOP_LYRICS_SIZE_MAX, '超上限要夹到上限');

  storedLayoutJson = JSON.stringify({ desktopLyricsDefault: 'off-v4', desktopLyrics: true, desktopLyricsSize: 0.55 });
  assert.strictEqual(readSavedLyricLayout().desktopLyricsSize, 0.55, '区间内要原样保留');
  storedLayoutJson = null;
}

function testDesktopLyricWindowKeepsActiveRowCentered() {
  const entries = makeEntries(['a', 'b', 'c', 'd', 'e']);
  // count<=1 表示继续走原来的单行渲染
  assert.strictEqual(desktopLyricWindow(entries, 0, 1), null, '1 行应返回 null（走单行路径）');
  assert.strictEqual(desktopLyricWindow(entries, 0, 0), null, '0 行归一化后是 1 行，应返回 null');

  [3, 5, 7, 10].forEach(function (count) {
    const center = Math.floor(count / 2);
    for (let activeIdx = 0; activeIdx < entries.length; activeIdx++) {
      const rows = desktopLyricWindow(entries, activeIdx, count);
      assert.ok(Array.isArray(rows), count + ' 行要返回行数组');
      assert.strictEqual(rows.length, count, count + ' 行必须正好 ' + count + ' 行（补空行也要凑满）');
      const activeRows = rows.filter(function (row) { return row.active; });
      assert.strictEqual(activeRows.length, 1, '当前句必须唯一');
      assert.ok(rows[center].active, 'activeIdx=' + activeIdx + ' 时当前句应在第 ' + center + ' 行，实际不在');
      assert.strictEqual(
        rows[center].text,
        entries[activeIdx].text,
        '居中的那一行必须就是当前句文本'
      );
    }
  });
}

function testDesktopLyricWindowPadsBothEnds() {
  const entries = makeEntries(['首句', '二句', '末句']);
  // 第一句：上方补两行空行，保证后面还有歌词时整块不跳动
  const atFirst = desktopLyricWindow(entries, 0, 5);
  assert.deepStrictEqual(
    Array.from(atFirst.map(function (row) { return row.text; })),
    ['', '', '首句', '二句', '末句'],
    '第一句时上方应补 2 行空行'
  );
  assert.deepStrictEqual(
    Array.from(atFirst.map(function (row) { return row.active; })),
    [false, false, true, false, false],
    '补出来的空行不能是 active'
  );
  // 最后一句：下方补空行
  const atLast = desktopLyricWindow(entries, 2, 5);
  assert.deepStrictEqual(
    Array.from(atLast.map(function (row) { return row.text; })),
    ['首句', '二句', '末句', '', ''],
    '最后一句时下方应补 2 行空行'
  );
  // 空行不带进度，避免高亮进度条落到空行上
  assert.strictEqual(atLast[3].progress, 0);
  assert.strictEqual(atLast[4].progress, 0);
  // progress 透传：当前句的行进度要跟着走
  const mid = desktopLyricWindow([{ text: 'x', progress: 0.42 }], 0, 3);
  assert.strictEqual(mid[1].progress, 0.42, '当前句进度必须透传');
  // 非法输入不能抛
  assert.strictEqual(desktopLyricWindow(null, 0, 3).length, 3, 'entries 为空也要给出空行');
  assert.deepStrictEqual(
    Array.from(desktopLyricWindow(null, 0, 3).map(function (row) { return row.text; })),
    ['', '', ''],
    'entries 为空时应全部是空行'
  );
  // 行数会先归一化（4 → 3）
  assert.strictEqual(desktopLyricWindow(entries, 1, 4).length, 3, '非法的 4 行要归一化成 3 行');
}

function testWindowBoundsFollowLineCount() {
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;
  const heights = [1, 3, 5, 7, 10].map(function (lines) {
    return desktopLyricsDefaultBounds({ lineCount: lines }).height;
  });
  assert.ok(heights[1] >= heights[0], '切到 3 行时窗口不能反而变矮');
  assert.ok(heights[2] > heights[1], '5 行窗口要比 3 行高');
  assert.ok(heights[3] > heights[2], '7 行窗口要比 5 行高');
  assert.ok(heights[4] > heights[3], '10 行窗口要比 7 行高（不跟着长高就会被裁掉）');
  // 窗口高度要装得下每行（单行字号 28px + 行距，按 60px/行 估）
  [3, 5, 7, 10].forEach(function (lines, index) {
    assert.ok(
      heights[index + 1] >= lines * 60,
      lines + ' 行窗口高度 ' + heights[index + 1] + ' 装不下 ' + lines + ' 行'
    );
  });
  // 1 行仍然保持原来的较矮窗口
  assert.ok(heights[0] >= 340 && heights[0] <= 560, '1 行窗口高度应保持原范围');
  // 10 行也不能无限长高：1080p 上不能顶到整屏
  assert.ok(heights[4] <= 1080 - 96, '10 行窗口仍要受屏幕高度约束，实际 ' + heights[4]);

  // 屏幕不够高时要封顶，不能超出屏幕
  primaryDisplayBounds = { x: 0, y: 0, width: 1280, height: 700 };
  matchedDisplayBounds = primaryDisplayBounds;
  const capped = desktopLyricsDefaultBounds({ lineCount: 10 });
  assert.ok(capped.height <= 700 - 96, '窗口高度必须受屏幕高度封顶，实际 ' + capped.height);
  // 主进程最后会走 constrainDesktopLyricsBounds 把窗口收回屏幕内
  const placed = constrainDesktopLyricsBounds(capped);
  assert.ok(placed.y >= 0, '窗口不能跑到屏幕上方');
  assert.ok(placed.y + placed.height <= 700, '窗口不能超出屏幕底部');
  assert.ok(placed.x >= 0 && placed.x + placed.width <= 1280, '窗口不能超出屏幕左右');
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;
}

/* 面板里的「高度 / 左右」滑块已删除（歌词窗口可以直接拖），位置改由用户上次
 * 拖动留下的锚点比例决定。这里是定位行为的真实校验。 */
function setDesktopLyricsAnchor(anchor) {
  mainContext.desktopLyricsAnchor = anchor;
  mainContext.desktopLyricsAnchorLoaded = true;
}

function testWindowPositionFollowsDragAnchor() {
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;

  // 没拖过 → 水平居中、屏幕下方 3/4 处
  setDesktopLyricsAnchor(null);
  const centered = desktopLyricsDefaultBounds({ lineCount: 1 });
  assert.strictEqual(
    centered.x + centered.width / 2,
    1920 * 0.5,
    '没拖过时窗口应水平居中于主屏，实际 ' + (centered.x + centered.width / 2)
  );

  // 拖到左边 / 右边 → 窗口跟着走，且不越界
  setDesktopLyricsAnchor({ xRatio: 0, yRatio: 0.76 });
  const left = desktopLyricsDefaultBounds({ lineCount: 1 });
  setDesktopLyricsAnchor({ xRatio: 1, yRatio: 0.76 });
  const right = desktopLyricsDefaultBounds({ lineCount: 1 });
  assert.ok(left.x < centered.x, '锚点靠左时窗口要往左');
  assert.ok(right.x > centered.x, '锚点靠右时窗口要往右');
  assert.ok(left.x >= 0, '窗口不能越过屏幕左边，实际 ' + left.x);
  assert.ok(right.x + right.width <= 1920, '窗口不能越过屏幕右边，实际 ' + (right.x + right.width));

  // 竖直锚点同样生效，而且不影响水平
  setDesktopLyricsAnchor({ xRatio: 0.5, yRatio: 0.2 });
  const high = desktopLyricsDefaultBounds({ lineCount: 1 });
  setDesktopLyricsAnchor({ xRatio: 0.5, yRatio: 0.9 });
  const low = desktopLyricsDefaultBounds({ lineCount: 1 });
  assert.ok(high.y < low.y, '锚点靠上时窗口要往上');
  assert.strictEqual(high.x, low.x, '竖直锚点变化不应改变水平位置');

  // 换行数只改高度/纵向位置，水平位置仍按锚点走（不会回弹到屏幕正中）
  setDesktopLyricsAnchor({ xRatio: 0, yRatio: 0.76 });
  const tenLines = desktopLyricsDefaultBounds({ lineCount: 10 });
  assert.strictEqual(tenLines.x, left.x, '切到 10 行后水平位置应保持用户拖过的锚点');

  // 用户把歌词拖到副屏后，新的尺寸要按副屏算，而不是弹回主屏
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = { x: 1920, y: 0, width: 1920, height: 1080 };
  mainContext.desktopLyricsUserBounds = { x: 2200, y: 600, width: 900, height: 200 };
  const onSecondDisplay = desktopLyricsDefaultBounds({ lineCount: 5 });
  mainContext.desktopLyricsUserBounds = null;
  assert.ok(
    onSecondDisplay.x >= 1920,
    '副屏上的歌词换行数后仍应留在副屏，实际 x=' + onSecondDisplay.x
  );

  setDesktopLyricsAnchor(null);
}

function testLayoutChangedRebuildsOnlyForLineCount() {
  const previous = { lineCount: 3 };
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, { lineCount: 5 }, { lineCount: 5 }),
    true,
    '行数变化要重置窗口（窗口高度跟着变）'
  );
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, { lineCount: 10 }, { lineCount: 10 }),
    true,
    '切到 10 行也要重算窗口'
  );
  // 位置滑块已经删掉：即使老版本渲染进程还在推 x / y，也不能再让窗口乱跳
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, { x: 0.62 }, { x: 0.62, y: 0.76, lineCount: 3 }),
    false,
    'payload 里出现 x 字段不应再触发重排（该字段已废弃）'
  );
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, { y: 0.3 }, { x: 0.5, y: 0.3, lineCount: 3 }),
    false,
    'payload 里出现 y 字段不应再触发重排（该字段已废弃）'
  );
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, { opacity: 0.5, size: 1.2, tilt: 6 }, { lineCount: 3 }),
    false,
    '只调透明度/字号/倾斜不应重置用户拖出来的位置'
  );
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, {}, { lineCount: 3 }),
    false,
    '没有 layout 字段的推送不应重排窗口'
  );
  assert.strictEqual(
    desktopLyricsLayoutChanged(previous, { lineCount: 3 }, { lineCount: 3 }),
    false,
    '行数没变就不重排'
  );
}

/* 「保留上一次设置」里最难的一环：歌词窗口被拖到的位置要跨重启记住。
 * 走的是真实的 saveDesktopLyricsAnchor / loadDesktopLyricsAnchor + 假文件系统。 */
function testDragPositionPersistsAcrossRestart() {
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;

  const anchor = mainContext.desktopLyricsAnchorFromBounds({ x: 960, y: 800, width: 900, height: 200 });
  assert.ok(anchor.xRatio >= 0 && anchor.xRatio <= 1, 'x 比例要被夹在 0..1，实际 ' + anchor.xRatio);
  assert.ok(anchor.yRatio > 0.5 && anchor.yRatio < 1, '窗口在屏幕下方时 y 比例应大于 0.5，实际 ' + anchor.yRatio);
  // 窗口中心而不是左上角参与计算：y=800 高 200 → 中心 900 / 1080
  assert.strictEqual(Math.round(anchor.yRatio * 100) / 100, Math.round((900 / 1080) * 100) / 100);

  anchorFileJson = null;
  mainContext.desktopLyricsAnchor = null;
  mainContext.desktopLyricsAnchorLoaded = false;
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(mainContext.loadDesktopLyricsAnchor())),
    { xRatio: 0.5, yRatio: 0.76 },
    '没有存档时要回落默认锚点（水平居中、下方 3/4 处）'
  );

  anchorWrites.length = 0;
  mainContext.saveDesktopLyricsAnchor({ xRatio: 0, yRatio: 0.9 });
  assert.ok(anchorWrites.length > 0, '拖动后要把锚点写进 userData');
  assert.ok(
    /^\/fake-user-data\/desktop-lyrics-anchor\.json(\.tmp)?$/.test(anchorWrites[0]),
    '文件应落在 userData 下，实际 ' + anchorWrites[0]
  );
  const written = JSON.parse(anchorFileJson);
  assert.strictEqual(written.xRatio, 0);
  assert.strictEqual(written.yRatio, 0.9);
  assert.strictEqual(written.version, 1);

  // 模拟重启：内存清空，只剩磁盘上的文件
  mainContext.desktopLyricsAnchor = null;
  mainContext.desktopLyricsAnchorLoaded = false;
  const restored = mainContext.loadDesktopLyricsAnchor();
  assert.strictEqual(restored.xRatio, 0, '重启后左对齐的锚点要读回来');
  assert.strictEqual(restored.yRatio, 0.9, '重启后竖直锚点要读回来');

  // 文件损坏时不能崩，回落默认
  anchorFileJson = '{ not json';
  mainContext.desktopLyricsAnchor = null;
  mainContext.desktopLyricsAnchorLoaded = false;
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(mainContext.loadDesktopLyricsAnchor())),
    { xRatio: 0.5, yRatio: 0.76 },
    '存档损坏要静默回落默认锚点'
  );

  anchorFileJson = null;
  mainContext.desktopLyricsAnchor = null;
  mainContext.desktopLyricsAnchorLoaded = true;
}

function testRowFontScalesWithLineCount() {
  const active1 = rowFontFor(1, true);
  const active3 = rowFontFor(3, true);
  const active5 = rowFontFor(5, true);
  const active7 = rowFontFor(7, true);
  const active10 = rowFontFor(10, true);
  assert.strictEqual(active1, 58, '单行时用完整字号');
  assert.ok(
    active3 < active1 && active5 < active3 && active7 < active5 && active10 < active7,
    '行数越多每行字号越小'
  );
  assert.ok(rowFontFor(5, true) > rowFontFor(5, false), '当前句要比相邻句大');
  // 10 行时最小字号仍要能读（行数上限就是 10，再小就没意义了）
  assert.ok(rowFontFor(10, false) >= 20, '10 行的相邻句字号不能小到看不清，实际 ' + rowFontFor(10, false));
  [3, 5, 7, 10].forEach(function (count) {
    assert.ok(rowFontFor(count, true) > rowFontFor(count, false), count + ' 行时当前句必须比相邻句大');
  });
}

/* 字号只按宽度缩还不够：10 行 + 大字号 + 行距拉满时整块会高过窗口。
 * fitStackByHeight 是最后一道闸，保证任意组合都在可视区内。 */
function testStackHeightStaysInsideViewport() {
  const gap = 6 + 18 * 1.18;
  function stackHeight(count, fontSize) {
    return count * fontSize * 1.18 + (count - 1) * gap;
  }
  pageContext.innerHeight = 700;
  const limit = 700 * 0.94;
  [1, 3, 5, 7, 10].forEach(function (count) {
    const fitted = fitStackByHeight(count, 80);
    assert.ok(
      stackHeight(count, fitted) <= limit + 0.5,
      count + ' 行在 700px 高窗口里溢出：字号 ' + fitted + ' → 总高 ' + Math.round(stackHeight(count, fitted))
    );
    assert.ok(fitted >= 9, count + ' 行缩放后字号不能低于 9px，实际 ' + fitted);
  });
  // 装得下的时候不要乱缩
  assert.strictEqual(fitStackByHeight(3, 30), 30, '装得下就该原样返回字号');
  assert.strictEqual(fitStackByHeight(1, 80), 80, '单行走单行逻辑，不做多行高度缩放');
  // 窗口越高能放的字越大
  pageContext.innerHeight = 1000;
  const tallFit = fitStackByHeight(10, 80);
  pageContext.innerHeight = 700;
  const shortFit = fitStackByHeight(10, 80);
  assert.ok(tallFit >= shortFit, '窗口更高时能放的字号不能更小，实际 ' + tallFit + ' vs ' + shortFit);
  pageState.lineCount = 3;
  pageState.tilt = 0;
}

/* ---- 04：desktopLyricsPayload 里字号的实际夹取 --------------------------- */
const payloadContext = vm.createContext({
  console: console,
  Object: Object,
  Math: Math,
  Number: Number,
  Array: Array,
  String: String,
  isFinite: isFinite,
  clampRange: clampNumberStub,
  isDevelopmentLockedFx: function () { return false; },
  normalizeDesktopLyricsLineCount: normalizeLineCount,
  normalizeDesktopLyricsMotion: function () { return 'slide'; },
  normalizeDesktopLyricsFps: function () { return 60; },
  DESKTOP_LYRICS_SIZE_MIN: readLayoutContext.DESKTOP_LYRICS_SIZE_MIN,
  DESKTOP_LYRICS_SIZE_MAX: readLayoutContext.DESKTOP_LYRICS_SIZE_MAX,
  DESKTOP_LYRICS_TILT_MIN: readLayoutContext.DESKTOP_LYRICS_TILT_MIN,
  DESKTOP_LYRICS_TILT_MAX: readLayoutContext.DESKTOP_LYRICS_TILT_MAX,
  fxDefaults: {
    desktopLyricsSize: 1,
    desktopLyricsOpacity: 0.92,
    desktopLyricsY: 0.76,
    desktopLyricsX: 0.5,
    desktopLyricsLines: 3,
    desktopLyricsTilt: 0,
    desktopLyricsMotion: 'slide',
  },
  fx: { desktopLyrics: true, desktopLyricsSize: 1 },
  playing: true,
  currentDesktopSongMeta: function () { return { title: '歌名', artist: '歌手', cover: '' }; },
  currentDesktopLyricSnapshot: function () {
    return { text: '当前句', progress: 0.5, progressSpan: 4.8, lineCount: 3, lines: [{ text: '当前句', progress: 0.5, active: true }] };
  },
  desktopLyricsBeatMapPayload: function () { return { beatMapKey: 'none' }; },
  desktopLyricsCustomFontPayload: function () { return null; },
  lyricFontStackForKey: function () { return 'Inter,sans-serif'; },
  lyricFontWeightValue: function () { return 900; },
  lyricLineHeightFactor: function () { return 1; },
  lyricsHasNativeKaraoke: false,
  desktopLyricsMotionPayload: function () { return {}; },
  desktopLyricsPlaybackPayload: function () { return { time: 0, duration: 0, rate: 1 }; },
  desktopOverlayColors: function () {
    return { primary: '#f6fdff', secondary: '#a8f6ff', highlight: '#fff0b8', glow: '#9cffdf' };
  },
});
vm.runInContext(
  extractFunction(overlaySource, 'desktopLyricsPayload'),
  payloadContext,
  { filename: '04-desktop-overlay-fullscreen.payload.js' }
);
const desktopLyricsPayload = payloadContext.desktopLyricsPayload;

function testTiltKeepsTextInsideViewport() {
  pageState.tilt = 0;
  pageState.lineCount = 5;
  assert.strictEqual(stackTiltOverhang(), 0, '不倾斜时不需要额外预留宽度');

  // 倾斜是绕 Y 轴的透视旋转：近端被放大，10° 以内预留量随角度增长
  pageState.tilt = 10;
  const tilt10 = stackTiltOverhang();
  pageState.tilt = 20;
  const tilt20 = stackTiltOverhang();
  assert.ok(tilt10 > 0, '倾斜后要预留宽度，实际 ' + tilt10);
  assert.ok(tilt20 > tilt10, '20° 的预留要比 10° 多，实际 ' + tilt20 + ' vs ' + tilt10);
  assert.ok(tilt20 < 120, '预留不能大到把整行挤没了，实际 ' + tilt20);

  // 与行数无关：rotateY 只放大横向，不再有「整块越高探出越多」的性质
  pageState.lineCount = 1;
  const oneRow = stackTiltOverhang();
  pageState.lineCount = 7;
  assert.strictEqual(stackTiltOverhang(), oneRow, '倾斜预留不应随行数变化');

  // 左右对称
  pageState.tilt = -20;
  assert.strictEqual(stackTiltOverhang(), tilt20, '左右倾斜的预留量应一致');

  // 行越宽，近端被放大的绝对量越大
  pageState.tilt = 20;
  const narrow = stackTiltOverhang();
  pageContext.innerWidth = 1800;
  const wide = stackTiltOverhang();
  assert.ok(wide > narrow, '可用宽度更大时预留也要更多，实际 ' + wide + ' vs ' + narrow);
  pageContext.innerWidth = 1000;

  pageState.tilt = 0;
  pageState.lineCount = 3;
}

/* 倾斜角度上下限同样散在多处，且页面 CSS 的透视距离必须和 JS 的预留算法一致，
 * 否则「预留量」算的是另一套几何，倾斜到位后仍会裁字。 */
function testDesktopLyricsTiltLimitsStayInSync() {
  const indexHtml = readSource(path.join(appRoot, 'public', 'index.html'));
  const sliderTag = (indexHtml.match(/<input[^>]*id="fx-desktoplyricstilt"[^>]*>/) || [''])[0];
  assert.ok(sliderTag, '面板里应有桌面歌词倾斜滑块');
  const sliderMin = parseFloat((sliderTag.match(/min="(-?[\d.]+)"/) || [])[1]);
  const sliderMax = parseFloat((sliderTag.match(/max="(-?[\d.]+)"/) || [])[1]);

  const pageClamp = lyricsPageSource.match(/state\.tilt = clamp\(state\.tilt == null \? 0 : state\.tilt, (-?\d+), (-?\d+), 0\)/);
  assert.ok(pageClamp, '桌面歌词页应有 tilt 的 clamp');
  const pageMin = Number(pageClamp[1]);
  const pageMax = Number(pageClamp[2]);

  const sharedMin = readLayoutContext.DESKTOP_LYRICS_TILT_MIN;
  const sharedMax = readLayoutContext.DESKTOP_LYRICS_TILT_MAX;
  assert.strictEqual(sliderMin, sharedMin, '面板滑块 min 要与共享常量一致');
  assert.strictEqual(sliderMax, sharedMax, '面板滑块 max 要与共享常量一致');
  assert.strictEqual(pageMin, sharedMin, '页面 clamp min 要与共享常量一致');
  assert.strictEqual(pageMax, sharedMax, '页面 clamp max 要与共享常量一致');
  assert.ok(sharedMax >= 30, '绕 Y 轴旋转要能转到 30° 以上才有明显三维感，实际 ' + sharedMax);
  assert.strictEqual(sharedMin, -sharedMax, '倾斜范围应左右对称');
  assert.ok(
    /clampRange\([\s\S]{0,120}DESKTOP_LYRICS_TILT_MIN, DESKTOP_LYRICS_TILT_MAX\)/.test(overlaySource),
    'desktopLyricsPayload 的 tilt 必须用 DESKTOP_LYRICS_TILT_MIN/MAX'
  );

  // CSS 用 perspective(1100px) 做 3D，JS 的预留算法按同一个距离计算
  const cssPerspective = lyricsPageSource.match(/transform:perspective\((\d+)px\) rotateY\(var\(--lyric-tilt/);
  assert.ok(cssPerspective, '.lyric-stack 的倾斜必须是 perspective(...) rotateY(...)');
  assert.strictEqual(
    Number(cssPerspective[1]),
    Number(perspectiveMatch[1]),
    'CSS 的透视距离要与 JS 的 LYRIC_ROTATE_PERSPECTIVE 一致'
  );
  // 单行模式的滚动容器也必须走 rotateY（否则「倾斜」只在多行时是三维的）
  assert.ok(
    /transform:perspective\(\d+px\) rotateY\(var\(--lyric-tilt/.test(
      (lyricsPageSource.match(/\.lyric-scroll\{[\s\S]*?\}/) || [''])[0]
    ),
    '.lyric-scroll 的 transform 也要用 perspective + rotateY'
  );
  assert.ok(
    !/transform:rotate\(var\(--lyric-tilt/.test(lyricsPageSource),
    '不应残留画面内 rotate() 的旧写法'
  );
}

/* 字号下限本来散在 5 处（面板滑块 / 页面 clamp / 读档 / 落盘 / 主进程 payload），
 * 少改一处就会出现「滑块能拉到很小但窗口里不变」。这里直接比对真实数值。 */
function testDesktopLyricsSizeLimitsStayInSync() {
  const indexHtml = readSource(path.join(appRoot, 'public', 'index.html'));
  const sliderTag = (indexHtml.match(/<input[^>]*id="fx-desktoplyricssize"[^>]*>/) || [''])[0];
  assert.ok(sliderTag, '面板里应有桌面歌词大小滑块');
  const sliderMin = parseFloat((sliderTag.match(/min="([\d.]+)"/) || [])[1]);
  const sliderMax = parseFloat((sliderTag.match(/max="([\d.]+)"/) || [])[1]);

  const pageClamp = lyricsPageSource.match(/clamp\(state\.size,\s*([\d.]+),\s*([\d.]+),\s*1\)/);
  assert.ok(pageClamp, '桌面歌词页应有 size 的 clamp');
  const pageMin = parseFloat(pageClamp[1]);
  const pageMax = parseFloat(pageClamp[2]);

  // 主进程 payload 必须引用共享常量，不能又写一份字面量
  assert.ok(
    /clampRange\(Number\(fx\.desktopLyricsSize\)[\s\S]{0,80}DESKTOP_LYRICS_SIZE_MIN,\s*DESKTOP_LYRICS_SIZE_MAX/.test(overlaySource),
    'desktopLyricsPayload 的 size 必须用 DESKTOP_LYRICS_SIZE_MIN/MAX'
  );
  assert.ok(
    !/0\.72,\s*1\.55/.test(overlaySource + lyricsPageSource + indexHtml),
    '不应再残留旧的字号下限 0.72'
  );

  const sharedMin = readLayoutContext.DESKTOP_LYRICS_SIZE_MIN;
  const sharedMax = readLayoutContext.DESKTOP_LYRICS_SIZE_MAX;
  assert.strictEqual(sliderMin, sharedMin, '面板滑块 min 要与共享常量一致');
  assert.strictEqual(sliderMax, sharedMax, '面板滑块 max 要与共享常量一致');
  assert.strictEqual(pageMin, sharedMin, '桌面歌词页 clamp 的 min 要与共享常量一致');
  assert.strictEqual(pageMax, sharedMax, '桌面歌词页 clamp 的 max 要与共享常量一致');
  // 0.45 * 58 ≈ 26px：小到能当「背景歌词」，又不至于看不见
  assert.ok(sharedMin <= 0.5, '字号下限要明显小于原来的 0.72，实际 ' + sharedMin);
  assert.ok(sharedMin * 58 >= 20, '字号下限换算后不能小于 20px，实际 ' + Math.round(sharedMin * 58));
}

function testPayloadClampsSizeToSharedLimits() {
  const min = readLayoutContext.DESKTOP_LYRICS_SIZE_MIN;
  const max = readLayoutContext.DESKTOP_LYRICS_SIZE_MAX;
  const cases = [
    [0.2, min],
    [min, min],
    [0.9, 0.9],
    [1, 1],
    [9, max],
    [undefined, 1],
  ];
  cases.forEach(function (pair) {
    payloadContext.fx.desktopLyricsSize = pair[0];
    const payload = desktopLyricsPayload(true, true);
    assert.strictEqual(payload.size, pair[1], 'size=' + pair[0] + ' 应夹到 ' + pair[1] + '，实际 ' + payload.size);
  });
  payloadContext.fx.desktopLyricsSize = 1;
  const payload = desktopLyricsPayload(true, true);
  assert.ok(payload.lineCount >= 1, 'payload 要带行数');
  assert.strictEqual(payload.enabled, true);

  // 倾斜角同样要按共享常量夹取（绕 Y 轴旋转的可用范围比原来的 ±18 宽）
  const tiltMin = readLayoutContext.DESKTOP_LYRICS_TILT_MIN;
  const tiltMax = readLayoutContext.DESKTOP_LYRICS_TILT_MAX;
  [[-99, tiltMin], [tiltMin, tiltMin], [12, 12], [tiltMax, tiltMax], [99, tiltMax]].forEach(function (pair) {
    payloadContext.fx.desktopLyricsTilt = pair[0];
    const p2 = desktopLyricsPayload(true, true);
    assert.strictEqual(p2.tilt, pair[1], 'tilt=' + pair[0] + ' 应夹到 ' + pair[1] + '，实际 ' + p2.tilt);
  });
  payloadContext.fx.desktopLyricsTilt = 0;
}

// 小字号下各行仍要保持比例：不能因为内部 15px 地板把「中间大、两侧小」压平
function testRowFontKeepsProportionAtMinimumSize() {
  pageContext.baseFontSize = Math.round(58 * readLayoutContext.DESKTOP_LYRICS_SIZE_MIN);
  assert.strictEqual(pageContext.baseFontSize, 26, '最小字号对应的基准字号应为 26px');
  const active7 = rowFontFor(7, true);
  const idle7 = rowFontFor(7, false);
  assert.ok(active7 < 26, '7 行时当前句要比基准字号小，实际 ' + active7);
  assert.ok(idle7 < active7, '相邻句仍要比当前句更小，实际 ' + idle7 + ' vs ' + active7);
  assert.ok(idle7 >= 11, '相邻句不能小于 11px，实际 ' + idle7);
  assert.ok(active7 - idle7 >= 2, '最小字号下当前句与相邻句仍要有可辨差异');
  pageContext.baseFontSize = 58;
  pageState.tilt = 0;
  pageState.lineCount = 3;
}

// 窗口太宽时拖动行程太小：可移动行程要占屏幕宽度的相当一部分
function testHorizontalTravelIsUsable() {
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;
  const wide = desktopLyricsDefaultBounds({ lineCount: 3 });
  const travel = 1920 - wide.width;
  assert.ok(travel >= 600, '1920 宽屏上左右拖动行程至少要有 600px，实际 ' + travel);
  setDesktopLyricsAnchor({ xRatio: 0, yRatio: 0.76 });
  const left = desktopLyricsDefaultBounds({ lineCount: 3 });
  setDesktopLyricsAnchor({ xRatio: 1, yRatio: 0.76 });
  const right = desktopLyricsDefaultBounds({ lineCount: 3 });
  assert.ok(
    right.x - left.x >= 400,
    '锚点从最左拖到最右窗口至少要移动 400px，实际 ' + (right.x - left.x)
  );

  primaryDisplayBounds = { x: 0, y: 0, width: 1366, height: 768 };
  matchedDisplayBounds = primaryDisplayBounds;
  setDesktopLyricsAnchor(null);
  const smallWindow = desktopLyricsDefaultBounds({ lineCount: 3 });
  assert.ok(smallWindow.width <= 1366 - 96, '窗口不能超出小屏');
  assert.ok(1366 - smallWindow.width >= 400, '小屏上拖动行程也不能小于 400px');
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;
}

/* 用户拖过窗口之后，行数一变窗口高度必须跟着重算：
 * 只复用「拖出来的位置」而不复用「旧高度」，否则 10 行会被压成一排 16px 的小字。
 * （真机上就是这里出过偏差，单测必须覆盖。） */
function testManualBoundsKeepHeightInSync() {
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;
  setDesktopLyricsAnchor(null);

  let liveBounds = { x: 100, y: 620, width: 900, height: 344 };
  mainContext.desktopLyricsWindow = {
    isDestroyed: function () { return false; },
    getBounds: function () { return Object.assign({}, liveBounds); },
    setBounds: function (next) { liveBounds = Object.assign({}, next); },
    setOpacity: function () {},
  };
  mainContext.desktopLyricsUserBounds = { x: 100, y: 620, width: 900, height: 344 };

  positionDesktopLyricsWindow({ lineCount: 10, opacity: 0.9 });
  const expected10 = desktopLyricsDefaultBounds({ lineCount: 10 }).height;
  assert.strictEqual(
    liveBounds.height,
    expected10,
    '拖过的窗口切到 10 行时高度要变成 ' + expected10 + '，实际 ' + liveBounds.height
  );
  assert.strictEqual(liveBounds.x, 100, '水平位置要保留用户拖出来的 100');
  assert.strictEqual(liveBounds.width, 900, '宽度要保留用户拖出来的 900');
  // 屏幕底部放不下这么高的窗口时，收敛到屏幕内（不能跑出去）
  assert.ok(
    liveBounds.y >= 0 && liveBounds.y + liveBounds.height <= 1080,
    '长高后窗口不能超出屏幕，实际 y=' + liveBounds.y + ' bottom=' + (liveBounds.y + liveBounds.height)
  );

  // 空间够的时候，长高要围绕中心点，避免整块「往上跳」
  liveBounds = { x: 100, y: 300, width: 900, height: 344 };
  mainContext.desktopLyricsUserBounds = { x: 100, y: 300, width: 900, height: 344 };
  positionDesktopLyricsWindow({ lineCount: 10, opacity: 0.9 });
  assert.ok(
    Math.abs((liveBounds.y + liveBounds.height / 2) - (300 + 344 / 2)) <= 1,
    '空间足够时窗口中心点应保持不动，实际中心 ' + (liveBounds.y + liveBounds.height / 2)
  );

  // 切回单行 → 高度要收回去
  positionDesktopLyricsWindow({ lineCount: 1, opacity: 0.9 });
  const expected1 = desktopLyricsDefaultBounds({ lineCount: 1 }).height;
  assert.strictEqual(liveBounds.height, expected1, '切回单行窗口高度要收回，实际 ' + liveBounds.height);

  // force=true（用户从未拖过 / 显示器变化）时按默认几何走，不受 manual bounds 影响
  positionDesktopLyricsWindow({ lineCount: 5, opacity: 0.9 }, { force: true });
  const forced = desktopLyricsDefaultBounds({ lineCount: 5 });
  assert.strictEqual(liveBounds.height, forced.height, 'force 时应使用默认几何的高度');
  assert.strictEqual(liveBounds.width, forced.width, 'force 时应使用默认几何的宽度');

  mainContext.desktopLyricsWindow = null;
  mainContext.desktopLyricsUserBounds = null;
  setDesktopLyricsAnchor(null);
}

/* 拖动能否「跟手」，取决于拖动过程中主窗口高频推来的状态会不会把窗口拽回去。
 * Windows 上 SetWindowPos 是异步的：回读 getBounds() 常常还是旧坐标，
 * 一旦拿旧坐标当「用户拖到的位置」，下一次推送就会把窗口弹回起点。
 * 这里用一个「setBounds 延迟生效」的假窗口复现这个竞态。 */
function testDragSurvivesStatePush() {
  primaryDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  matchedDisplayBounds = primaryDisplayBounds;
  anchorFileJson = null;
  mainContext.desktopLyricsAnchor = null;
  mainContext.desktopLyricsAnchorLoaded = true;

  // 3 行窗口的真实高度（desktopLyricsDefaultBounds 给的是 410，含窗口边框）
  let committed = { x: 300, y: 600, width: 900, height: 410 };
  let pending = null;
  const win = {
    isDestroyed: function () { return false; },
    getBounds: function () { return Object.assign({}, committed); }, // 只返回已提交的位置
    setBounds: function (next) { pending = Object.assign({}, next); }, // 模拟异步生效
    setOpacity: function () {},
    setIgnoreMouseEvents: function () {},
    webContents: { send: function () {} },
  };
  const flush = function () { if (pending) { committed = pending; pending = null; } };
  mainContext.desktopLyricsWindow = win;
  mainContext.desktopLyricsUserBounds = Object.assign({}, committed);

  for (let i = 1; i <= 6; i++) {
    applyDesktopLyricsDrag(win.getBounds(), 20, 8);
    // 推送在 setBounds 生效前到达（故意不 flush），复现真实竞态
    positionDesktopLyricsWindow({ lineCount: 3, opacity: 0.92 });
    const queued = pending || committed;
    assert.strictEqual(
      queued.x,
      300 + i * 20,
      '第 ' + i + ' 步拖动被状态推送拽回：期望 x=' + (300 + i * 20) + '，实际 ' + queued.x
    );
    assert.strictEqual(
      queued.y,
      600 + i * 8,
      '第 ' + i + ' 步拖动被状态推送拽回：期望 y=' + (600 + i * 8) + '，实际 ' + queued.y
    );
    assert.strictEqual(queued.height, 410, '拖动过程不应改变窗口高度');
    flush();
  }
  assert.strictEqual(committed.x, 420, '连续 6 步后窗口应停在 420，实际 ' + committed.x);
  assert.strictEqual(committed.y, 648, '连续 6 步后窗口应停在 648，实际 ' + committed.y);

  /* 记账要用「算出来的新位置」，不能回读 getBounds()：Windows 上 setBounds 是异步的，
   * 紧接着回读拿到的常常还是旧坐标；一旦把旧坐标记成「用户拖到哪」，
   * 之后切行数 / 换显示器时窗口就会跳回上一个位置。 */
  const dragBase = win.getBounds();
  applyDesktopLyricsDrag(dragBase, 20, 8);
  assert.strictEqual(
    mainContext.desktopLyricsUserBounds.x,
    dragBase.x + 20,
    '拖动后记账的 x 应是新位置（不能回读还没生效的 getBounds），实际 ' + mainContext.desktopLyricsUserBounds.x
  );
  assert.strictEqual(
    mainContext.desktopLyricsUserBounds.y,
    dragBase.y + 8,
    '拖动后记账的 y 应是新位置（不能回读还没生效的 getBounds），实际 ' + mainContext.desktopLyricsUserBounds.y
  );
  flush();

  /* 第二阶段：先让 setBounds 生效，再来一次状态推送。
   * 这一步专门守「回读 getBounds()」这个坑 —— Windows 上拖动时 getBounds() 常常还是
   * 上一步的旧坐标，一旦拿它当「用户拖到的位置」，下一次推送就会把窗口拽回上一步，
   * 手感就是「拖一下弹一下」，长按拖动根本走不到终点。 */
  mainContext.desktopLyricsState = { lineCount: 3, opacity: 0.92, enabled: true, clickThrough: false };
  for (let i = 1; i <= 4; i++) {
    const before = win.getBounds();
    applyDesktopLyricsDrag(before, 20, 8);
    flush(); // OS 这一拍生效了
    createDesktopLyricsWindow({ lineCount: 3, opacity: 0.92 }); // 紧接着一轮真实的状态推送
    flush(); // 推送造成的位移也让它生效，否则断言看不到「被拽回」
    const now = win.getBounds();
    assert.strictEqual(
      now.x,
      before.x + 20,
      '第 ' + i + ' 次推送把刚拖到的 x 拽回了：期望 ' + (before.x + 20) + '，实际 ' + now.x
    );
    assert.strictEqual(
      now.y,
      before.y + 8,
      '第 ' + i + ' 次推送把刚拖到的 y 拽回了：期望 ' + (before.y + 8) + '，实际 ' + now.y
    );
    assert.strictEqual(now.height, 410, '推送不该改窗口高度');
  }
  assert.strictEqual(committed.x, 520, '再拖 4 步后窗口应停在 520，实际 ' + committed.x);
  assert.strictEqual(committed.y, 688, '再拖 4 步后窗口应停在 688，实际 ' + committed.y);

  // 拖完的位置要落盘，重启才能回到这里（以最后一次拖动 520,688 为准）
  const written = JSON.parse(anchorFileJson);
  const travel = 1920 - 900;
  assert.ok(
    Math.abs(written.xRatio - 520 / travel) < 0.02,
    '拖完的 x 比例应落盘，期望 ≈' + (520 / travel).toFixed(3) + '，实际 ' + written.xRatio
  );
  // 纵向落盘的是「窗口中心点的比例」：688 + 410/2 = 893
  assert.ok(
    Math.abs(written.yRatio - (688 + 410 / 2) / 1080) < 0.02,
    '拖完的 y 比例应落盘，期望 ≈' + ((688 + 205) / 1080).toFixed(3) + '，实际 ' + written.yRatio
  );

  // 单步位移要限幅，避免一次异常大 delta（或合成事件的伪 screenX）把窗口甩出屏幕
  const clamped = desktopLyricsDragNextBounds({ x: 0, y: 0, width: 10, height: 10 }, 9999, -9999);
  assert.strictEqual(clamped.x, 160, '单步横向位移应夹到 ±160，实际 ' + clamped.x);
  assert.strictEqual(clamped.y, -160, '单步纵向位移应夹到 ±160，实际 ' + clamped.y);

  mainContext.desktopLyricsWindow = null;
  mainContext.desktopLyricsUserBounds = null;
  anchorFileJson = null;
  mainContext.desktopLyricsAnchor = null;
  mainContext.desktopLyricsAnchorLoaded = true;
}

/* 「拖不动」的第一道坎是窗口的鼠标闸门：桌面歌词为了不挡桌面，默认是穿透的
 * （setIgnoreMouseEvents(true)）。之前靠页面收到 mousemove 再回过头打开穿透，
 * 转发事件一不可靠，页面就永远拿不到指针事件 —— 表现为完全拖不动。
 * 现在改成主进程按「系统光标是否压在歌词热区上」自己判定，这里守这套判定。 */
function testCursorWatcherOpensMouseGate() {
  const ignoreCalls = [];
  const bounds = { x: 300, y: 600, width: 900, height: 410 };
  const win = {
    isDestroyed: function () { return false; },
    getBounds: function () { return Object.assign({}, bounds); },
    setBounds: function () {},
    setOpacity: function () {},
    setIgnoreMouseEvents: function (ignore) { ignoreCalls.push(!!ignore); },
  };
  mainContext.desktopLyricsWindow = win;
  mainContext.desktopLyricsMouseIgnored = null;
  mainContext.desktopLyricsPointerCapture = false;
  mainContext.desktopLyricsDragUntil = 0;
  mainContext.desktopLyricsState = { enabled: true, clickThrough: false };
  // 歌词热区（页面用 setLyricsHotBounds 上报，坐标相对窗口）：屏幕 360..1140 / 700..910
  mainContext.desktopLyricsHotBounds = { left: 60, top: 100, right: 840, bottom: 310 };

  // 1. 未锁定 + 光标压在歌词上 → 关掉穿透，窗口才收得到按下和拖动
  cursorPoint = { x: 500, y: 800 };
  assert.strictEqual(desktopLyricsCursorOverStage(), true, '光标在歌词热区内应判定为命中');
  syncDesktopLyricsCursorCapture();
  assert.strictEqual(mainContext.desktopLyricsPointerCapture, true, '光标在歌词上时要打开 pointer capture');
  assert.strictEqual(mainContext.desktopLyricsMouseIgnored, false, '光标在歌词上时窗口不能穿透（否则按不下去）');

  // 2. 光标刚离开歌词（透明留白区）→ 不能马上翻回穿透：穿透开关每翻一次，
  //    Chromium 都会重建鼠标命中状态，翻得勤会把正在进行的拖动打断
  cursorPoint = { x: 320, y: 620 };
  assert.strictEqual(desktopLyricsCursorOverStage(), false, '留白区不算命中（否则会挡住桌面点击）');
  syncDesktopLyricsCursorCapture();
  assert.strictEqual(mainContext.desktopLyricsPointerCapture, true, '刚离开的一瞬间要保持可接收鼠标（迟滞）');
  assert.strictEqual(mainContext.desktopLyricsMouseIgnored, false, '刚离开时不能立刻退回穿透');

  // 3. 离开超过迟滞时间 → 恢复穿透，别一直挡着桌面
  mainContext.desktopLyricsCursorHoldUntil = Date.now() - 1;
  syncDesktopLyricsCursorCapture();
  assert.strictEqual(mainContext.desktopLyricsPointerCapture, false, '光标离开后要收回 pointer capture');
  assert.strictEqual(mainContext.desktopLyricsMouseIgnored, true, '光标离开歌词后窗口要恢复穿透');

  // 4. 锁定状态：光标压上去也不接管鼠标（防误触）
  mainContext.desktopLyricsState = { enabled: true, clickThrough: true };
  cursorPoint = { x: 500, y: 800 };
  syncDesktopLyricsCursorCapture();
  assert.strictEqual(mainContext.desktopLyricsMouseIgnored, true, '锁定时无论光标在哪都必须穿透');

  // 5. 正在拖动：光标因为窗口跟手稍微甩出热区，这一瞬间也不能退回穿透，
  //    否则后半段 pointermove 全部丢失（手一快就「拖一半断了」）
  mainContext.desktopLyricsState = { enabled: true, clickThrough: false };
  mainContext.desktopLyricsDragUntil = Date.now() + 500;
  mainContext.desktopLyricsCursorHoldUntil = Date.now() - 1;
  cursorPoint = { x: 100, y: 100 };
  syncDesktopLyricsCursorCapture();
  assert.strictEqual(mainContext.desktopLyricsPointerCapture, true, '拖动过程中即使光标短暂离开热区也要保持可拖');
  assert.strictEqual(mainContext.desktopLyricsMouseIgnored, false, '拖动过程中窗口不能穿透');

  // 6. 拖动结束、迟滞也过了、光标同样不在歌词上 → 恢复穿透，不挡桌面
  mainContext.desktopLyricsDragUntil = 0;
  mainContext.desktopLyricsCursorHoldUntil = Date.now() - 1;
  syncDesktopLyricsCursorCapture();
  assert.strictEqual(mainContext.desktopLyricsMouseIgnored, true, '拖完并离开歌词后要恢复穿透');

  assert.ok(ignoreCalls.length >= 4, '穿透状态应真的下发到窗口，实际调用 ' + ignoreCalls.length + ' 次');

  mainContext.desktopLyricsWindow = null;
  mainContext.desktopLyricsHotBounds = null;
  mainContext.desktopLyricsMouseIgnored = null;
  mainContext.desktopLyricsDragUntil = 0;
  mainContext.desktopLyricsState = {};
}

/* 页面的 drag 循环：moveDrag 按「屏幕坐标差」推窗口，
 * shouldCancelDrag 决定什么时候认定「用户在窗口外松手了」。
 * 这两件事一起决定手感：推得准 = 跟手；误判松手 = 拖一下就断。 */
function testDragFollowsPointer() {
  dragNowMs = 1000;
  dragLocked = false;
  moveCalls.length = 0;
  dragContext.dragging = true;
  dragContext.dragLast = { x: 100, y: 200 };
  dragContext.dragMovedAt = 0;

  moveDrag({ screenX: 130, screenY: 210 });
  assert.deepStrictEqual(moveCalls[0], [30, 10], '拖动要按屏幕坐标差推窗口，实际 ' + JSON.stringify(moveCalls[0]));
  assert.deepStrictEqual(
    { x: dragContext.dragLast.x, y: dragContext.dragLast.y },
    { x: 130, y: 210 },
    '推完要更新基准点，否则下一步会重复推同一段位移'
  );
  assert.strictEqual(dragContext.dragMovedAt, 1000, '推窗口时要记下时间戳（判断松手用）');

  // 光标没动（合成事件）→ 不要发无意义的位移
  moveCalls.length = 0;
  dragNowMs = 1100;
  moveDrag({ screenX: 130, screenY: 210 });
  assert.strictEqual(moveCalls.length, 0, '位移为 0 时不该再调 moveLyricsBy');

  // 锁定状态 → 拖动必须失效（防误触）
  dragLocked = true;
  moveDrag({ screenX: 160, screenY: 240 });
  assert.strictEqual(moveCalls.length, 0, '锁定时不能移动窗口');

  // 刚推过窗口的 260ms 内收到 buttons=0 的合成 move：不能判松手
  dragLocked = false;
  dragContext.dragging = true;
  dragContext.dragMovedAt = 1000;
  assert.strictEqual(shouldCancelDrag({ buttons: 0 }, 1100), false, '刚挪过窗口时要忽略 buttons=0 的合成事件');
  assert.strictEqual(shouldCancelDrag({ buttons: 0 }, 1400), true, '真的没动静了才认定松手');
  assert.strictEqual(shouldCancelDrag({ buttons: 1 }, 1400), false, '左键还按着就不能结束拖动');
  dragContext.dragging = false;
  assert.strictEqual(shouldCancelDrag({ buttons: 0 }, 5000), false, '没在拖动时什么都不做');
  dragContext.dragging = true;
}

/* 「保留用户的上一次设置」：面板里调过的桌面歌词项要写进存档，
 * 重启后 readSavedLyricLayout() 要原样读回来 —— 这是第九轮的明确需求。 */
function testDesktopLyricsSettingsSurviveRestart() {
  // 第一次会话：用户把桌面歌词打开、各项调了一遍
  storedLayoutJson = null;
  readLayoutContext.fx = {
    preset: 0,
    desktopLyrics: true,
    desktopLyricsSize: 1.2,
    desktopLyricsOpacity: 0.7,
    desktopLyricsLines: 10,
    desktopLyricsTilt: 15,
    desktopLyricsMotion: 'flip',
    desktopLyricsFps: 30,
    desktopLyricsClickThrough: false,
    desktopLyricsCinema: true,
    desktopLyricsHighlight: true
  };
  readLayoutContext.saveLyricLayout();
  assert.ok(storedLayoutJson, '调整桌面歌词设置后应写入存档');
  const saved = JSON.parse(storedLayoutJson);
  assert.strictEqual(saved.desktopLyricsSchema, 'desktop-lyrics-v3', '存档要带 schema 标记，重启后才知道这些键可信');
  assert.strictEqual(saved.desktopLyricsDefault, 'off-v4', '存档要带迁移标记（新版为 off-v4），之后开关完全听用户的');
  assert.strictEqual(saved.desktopLyrics, true, '开关状态要落档');
  assert.strictEqual(saved.desktopLyricsLines, 10, '行数要落档');
  assert.strictEqual(saved.desktopLyricsSize, 1.2, '大小要落档');
  assert.strictEqual(saved.desktopLyricsOpacity, 0.7, '透明度要落档');
  assert.strictEqual(saved.desktopLyricsTilt, 15, '倾斜要落档');
  assert.strictEqual(saved.desktopLyricsMotion, 'flip', '动效要落档');
  assert.strictEqual(saved.desktopLyricsFps, 30, '帧率要落档');

  // 重启：一切从存档恢复
  const restored = readLayoutContext.readSavedLyricLayout();
  assert.strictEqual(restored.desktopLyrics, true, '上次开着的桌面歌词，重启后还要开着');
  assert.strictEqual(restored.desktopLyricsLines, 10, '重启后行数要保留');
  assert.strictEqual(restored.desktopLyricsSize, 1.2, '重启后大小要保留');
  assert.strictEqual(restored.desktopLyricsOpacity, 0.7, '重启后透明度要保留');
  assert.strictEqual(restored.desktopLyricsTilt, 15, '重启后倾斜要保留');
  assert.strictEqual(restored.desktopLyricsMotion, 'flip', '重启后动效要保留');
  assert.strictEqual(restored.desktopLyricsFps, 30, '重启后帧率要保留');
  assert.strictEqual(restored.desktopLyricsClickThrough, false, '重启后锁定状态要保留');
  assert.strictEqual(restored.desktopLyricsCinema, true, '重启后电影震动要保留');
  assert.strictEqual(restored.desktopLyricsHighlight, true, '重启后高亮跟随要保留');

  // 老存档（没有 schema 标记）：开关做一次性迁移（一律回到新默认值【关】，不再自动铺桌面歌词），
  // 其它数值键也不该被旧数据带偏
  storedLayoutJson = JSON.stringify({ desktopLyrics: true, desktopLyricsLines: 2 });
  const migrated = readLayoutContext.readSavedLyricLayout();
  assert.strictEqual(migrated.desktopLyrics, false, '老存档没有迁移标记，一律迁移成新默认值【关】');
  assert.strictEqual(migrated.desktopLyricsLines, 1, '没有 schema 标记时行数不采信旧值（2 非法，就近吸附前先回落默认）');

  storedLayoutJson = null;
}

/* 面板里的「桌面歌词高度 / 左右」两个滑块按用户要求删掉了（歌词窗口可以直接拖），
 * 主开关则要留在「镜头与叠加」的开关网格里，而不是被搬去歌词折叠区。 */
function testPanelDropsPositionSliders() {
  const indexHtml = readSource(path.join(appRoot, 'public', 'index.html'));
  assert.ok(!/id="fx-desktoplyricsx"/.test(indexHtml), '「桌面歌词左右」滑块应已删除（歌词可直接拖）');
  assert.ok(!/id="fx-desktoplyricsy"/.test(indexHtml), '「桌面歌词高度」滑块应已删除（歌词可直接拖）');

  const overlayGrid = (indexHtml.match(/<div class="fx-toggle-grid">[\s\S]*?<\/div>\s*<div class="fx-dl-hint"/) || [''])[0];
  assert.ok(overlayGrid, '应能找到「镜头与叠加」的开关网格');
  assert.ok(overlayGrid.indexOf('id="t-desktopLyrics"') >= 0, '桌面歌词主开关应出现在「镜头与叠加」开关网格里');

  const layoutSourceText = readSource(path.join(appRoot, 'public', 'js', 'modules', '07-fx', '05b-fx-panel-layout.js'));
  const moved = (layoutSourceText.match(/\[([\s\S]*?)\]\.forEach\(function\(id\)\{ moveToggleToGrid/) || [])[1] || '';
  assert.ok(moved.indexOf("'t-desktopLyrics'") < 0, '搬运名单里不能再包含桌面歌词主开关，否则它又会被移出网格');
  ['t-desktopLyricsClickThrough', 't-desktopLyricsCinema', 't-desktopLyricsHighlight'].forEach(function (id) {
    assert.ok(moved.indexOf("'" + id + "'") < 0, id + ' 也应留在开关网格里，由主开关控制显隐');
  });
  // 歌词自己的开关仍要继续被搬进歌词折叠区
  ['t-lyricGlow', 't-lyricCameraLock'].forEach(function (id) {
    assert.ok(moved.indexOf("'" + id + "'") >= 0, id + ' 仍应被搬进「歌词开关」区');
  });
}

/* 「桌面歌词的设置要打开才显示」：JS 挂 class + CSS 按 class 收起，两边必须对上，
 * 否则 class 挂了但界面毫无变化。 */
function testDesktopLyricsSettingsHiddenUntilEnabled() {
  panelContext.fx.desktopLyrics = true;
  updateDesktopLyricsPanelVisibility();
  assert.ok(panelClassList.indexOf('dl-on') >= 0, '打开桌面歌词时应挂 dl-on');
  assert.ok(panelClassList.indexOf('dl-off') < 0, '打开时不能还留着 dl-off');

  panelContext.fx.desktopLyrics = false;
  updateDesktopLyricsPanelVisibility();
  assert.ok(panelClassList.indexOf('dl-off') >= 0, '关掉桌面歌词时应挂 dl-off');
  assert.ok(panelClassList.indexOf('dl-on') < 0, '关掉时不能还留着 dl-on');

  panelContext.fx.desktopLyrics = true;
  updateDesktopLyricsPanelVisibility();

  const cssSource = readSource(path.join(appRoot, 'public', 'css', '07-fx', 'fx-panel.css'));
  assert.ok(/\.fx-dl-settings\{display:none\}/.test(cssSource), '默认（关）时设置区必须隐藏');
  assert.ok(/#fx-panel\.dl-on \.fx-dl-settings\{display:block\}/.test(cssSource), 'CSS 要让 dl-on 时展开设置区');
  assert.ok(/#fx-panel\.dl-off \.fx-dl-dependent\{display:none\}/.test(cssSource), '关掉时从属开关也要一起收起');

  const indexHtml = readSource(path.join(appRoot, 'public', 'index.html'));
  const settingsBlock = (indexHtml.match(/<div class="fx-dl-settings" id="fx-desktop-lyrics-settings">[\s\S]*?\n {6}<\/div>/) || [''])[0];
  assert.ok(settingsBlock, '面板里应有 #fx-desktop-lyrics-settings 容器');
  ['fx-desktoplyricssize', 'fx-desktoplyricsopacity', 'fx-desktoplyricstilt',
    'desktop-lyrics-lines-seg', 'desktop-lyrics-motion-seg', 'desktop-lyrics-fps-seg'].forEach(function (id) {
    assert.ok(settingsBlock.indexOf('id="' + id + '"') >= 0, id + ' 应该被收进桌面歌词设置容器里');
  });
  ['t-desktopLyricsClickThrough', 't-desktopLyricsCinema', 't-desktopLyricsHighlight'].forEach(function (id) {
    assert.ok(
      new RegExp('class="fx-toggle fx-dl-dependent" id="' + id + '"').test(indexHtml),
      id + ' 要标上 fx-dl-dependent，否则关掉主开关后它还留在网格里'
    );
  });
  assert.ok(
    /id="fx-desktop-lyrics-hint"/.test(indexHtml),
    '关掉时要有提示，避免用户以为设置丢了'
  );
}

/* 行数选项散在三处（共享常量 / 面板按钮 / 覆盖层页面），少改一处就会「面板能点 10 行但页面只画 7 行」 */
/* 启动顺序回归：12d 里 `var fx = Object.assign({}, fxDefaults, readSavedLyricLayout())`
 * 在合并脚本里先于 03c 的顶层赋值执行 —— 那一刻 03c 末尾声明的 var 常量还是 undefined。
 * 旧实现在这个窗口期会 indexOf(undefined) 抛 TypeError，被 readSavedLyricLayout 的
 * catch 吞掉后返回 `{}`，于是：启动瞬间整份存档设置归零，紧接着 boot 期的
 * saveLyricLayout 再把这些默认值写回本地存储（存档被真正抹掉）。
 * 用户感受到的就是「桌面歌词关掉后，下次开还是自己冒出来」。
 * 这里把常量打回 undefined，精确复现那个窗口期。 */
function testSavedLayoutReadsBeforeConstantsInitialized() {
  const realConsts = {
    sizeMin: readLayoutContext.DESKTOP_LYRICS_SIZE_MIN,
    sizeMax: readLayoutContext.DESKTOP_LYRICS_SIZE_MAX,
    tiltMin: readLayoutContext.DESKTOP_LYRICS_TILT_MIN,
    tiltMax: readLayoutContext.DESKTOP_LYRICS_TILT_MAX,
    lineOptions: Array.from(readLayoutContext.DESKTOP_LYRICS_LINE_OPTIONS || [])
  };
  assert.strictEqual(typeof realConsts.sizeMin, 'number', '字号下限常量应已定义');
  assert.strictEqual(realConsts.sizeMin, 0.45);
  assert.strictEqual(realConsts.sizeMax, 1.55);
  assert.deepStrictEqual(realConsts.lineOptions, [1, 3, 5, 7, 10]);

  // 兜底读取器必须和常量给出同一个区间（两边漂移就白兜了）
  const normalSize = readLayoutContext.desktopLyricsSizeLimits();
  const normalTilt = readLayoutContext.desktopLyricsTiltLimits();
  assert.strictEqual(normalSize.min, realConsts.sizeMin);
  assert.strictEqual(normalSize.max, realConsts.sizeMax);
  assert.strictEqual(normalTilt.min, realConsts.tiltMin);
  assert.strictEqual(normalTilt.max, realConsts.tiltMax);
  assert.deepStrictEqual(Array.from(readLayoutContext.desktopLyricsLineOptions()), realConsts.lineOptions);

  try {
    // 模拟「03c 顶层赋值还没跑」的启动窗口期
    readLayoutContext.DESKTOP_LYRICS_SIZE_MIN = undefined;
    readLayoutContext.DESKTOP_LYRICS_SIZE_MAX = undefined;
    readLayoutContext.DESKTOP_LYRICS_TILT_MIN = undefined;
    readLayoutContext.DESKTOP_LYRICS_TILT_MAX = undefined;
    readLayoutContext.DESKTOP_LYRICS_LINE_OPTIONS = undefined;

    const windowSize = readLayoutContext.desktopLyricsSizeLimits();
    const windowTilt = readLayoutContext.desktopLyricsTiltLimits();
    assert.strictEqual(windowSize.min, 0.45, '常量未就位时字号下限仍要走兜底值');
    assert.strictEqual(windowSize.max, 1.55, '常量未就位时字号上限仍要走兜底值');
    assert.strictEqual(windowTilt.min, -35);
    assert.strictEqual(windowTilt.max, 35);
    assert.deepStrictEqual(Array.from(readLayoutContext.desktopLyricsLineOptions()), [1, 3, 5, 7, 10],
      '常量未就位时行数档位仍要给出 1/3/5/7/10');
    assert.strictEqual(readLayoutContext.normalizeDesktopLyricsLineCount(9), 10,
      '常量未就位时行数归一化不能抛，9 应就近吸到 10');

    // 关键断言：完整读一次存档，不能抛异常、不能返回空对象
    storedLayoutJson = JSON.stringify({
      desktopLyricsSchema: 'desktop-lyrics-v3',
      desktopLyricsDefault: 'off-v4',
      desktopLyrics: true,
      desktopLyricsLines: 10,
      desktopLyricsSize: 1.2,
      desktopLyricsTilt: 15
    });
    const saved = readSavedLyricLayout();
    assert.ok(saved && typeof saved === 'object', '读存档必须返回对象');
    assert.ok(Object.keys(saved).length > 0, '常量未就位时读存档不能退化成空对象 {}');
    assert.strictEqual(saved.desktopLyrics, true, '用户显式开着的桌面歌词不能被启动顺序吃掉');
    assert.strictEqual(saved.desktopLyricsLines, 10, '行数存档要读回来');
    assert.strictEqual(saved.desktopLyricsSize, 1.2, '字号存档要读回来（不能被 NaN 夹掉）');
    assert.strictEqual(saved.desktopLyricsTilt, 15, '倾斜存档要读回来');
  } finally {
    readLayoutContext.DESKTOP_LYRICS_SIZE_MIN = realConsts.sizeMin;
    readLayoutContext.DESKTOP_LYRICS_SIZE_MAX = realConsts.sizeMax;
    readLayoutContext.DESKTOP_LYRICS_TILT_MIN = realConsts.tiltMin;
    readLayoutContext.DESKTOP_LYRICS_TILT_MAX = realConsts.tiltMax;
    readLayoutContext.DESKTOP_LYRICS_LINE_OPTIONS = realConsts.lineOptions;
    storedLayoutJson = null;
  }
}

function testLineOptionsStayInSync() {
  const shared = Array.from(readLayoutContext.DESKTOP_LYRICS_LINE_OPTIONS);
  const indexHtml = readSource(path.join(appRoot, 'public', 'index.html'));
  const panelCounts = (indexHtml.match(/data-desktop-lyrics-lines="(\d+)"/g) || []).map(function (tag) {
    return Number(tag.match(/"(\d+)"/)[1]);
  });
  const pageCounts = JSON.parse(
    '[' + ((lyricsPageSource.match(/var DESKTOP_ROW_COUNTS = \[([^\]]+)\]/) || [])[1] || '') + ']'
  );
  assert.deepStrictEqual(panelCounts, shared, '面板按钮的行数选项要跟共享常量一致，实际 ' + panelCounts);
  assert.deepStrictEqual(pageCounts, shared, '覆盖层页面的行数选项要跟共享常量一致，实际 ' + pageCounts);
  assert.ok(shared.indexOf(10) >= 0, '行数选项必须包含 10 行');
  assert.strictEqual(Math.max.apply(null, shared), 10, '10 行是当前上限');

  // 主进程的高度公式也要认到 10 行，否则窗高和 7 行一样，10 行会被裁
  assert.ok(
    /Math\.min\(10,\s*Math\.round\(Number\(payload\.lineCount\)/.test(mainSource),
    '主进程的行数上限要放宽到 10'
  );
  // 覆盖层字号的 factor 表也要有 10 行这一档，否则 10 行会沿用 7 行的字号
  assert.ok(/count === 7 \? \.58 : \.46/.test(lyricsPageSource), 'rowFontFor 要单独给 10 行一档系数');
}

/* payload 不该再带面板上已删除的位置字段：老字段留着只会让主进程误以为「锚点变了」 */
function testPayloadDropsPositionFields() {
  const payload = desktopLyricsPayload(true, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'x'), 'payload 不应再带左右比例（滑块已删）');
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'y'), 'payload 不应再带高度比例（滑块已删）');
  payloadContext.fx.desktopLyricsLines = 10;
  assert.strictEqual(desktopLyricsPayload(true, true).lineCount, 10, '10 行要能原样透传到覆盖层');
  payloadContext.fx.desktopLyricsLines = 3;
}

async function run() {
  testLineCountNormalization();
  testMotionNormalization();
  testDesktopLyricsDefaultMigration();
  testSavedSizeRespectsNewLimits();
  testDesktopLyricWindowKeepsActiveRowCentered();
  testDesktopLyricWindowPadsBothEnds();
  testWindowBoundsFollowLineCount();
  testWindowPositionFollowsDragAnchor();
  testLayoutChangedRebuildsOnlyForLineCount();
  testRowFontScalesWithLineCount();
  testTiltKeepsTextInsideViewport();
  testDesktopLyricsSizeLimitsStayInSync();
  testDesktopLyricsTiltLimitsStayInSync();
  testPayloadClampsSizeToSharedLimits();
  testRowFontKeepsProportionAtMinimumSize();
  testHorizontalTravelIsUsable();
  testStackHeightStaysInsideViewport();
  testDragPositionPersistsAcrossRestart();
  testManualBoundsKeepHeightInSync();
  testDragSurvivesStatePush();
  testCursorWatcherOpensMouseGate();
  testDragFollowsPointer();
  testDesktopLyricsSettingsSurviveRestart();
  testPanelDropsPositionSliders();
  testDesktopLyricsSettingsHiddenUntilEnabled();
  testLineOptionsStayInSync();
  testSavedLayoutReadsBeforeConstantsInitialized();
  testPayloadDropsPositionFields();
  console.log('OK desktop-lyrics-multiline');
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
