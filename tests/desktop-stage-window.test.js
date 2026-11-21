'use strict';

// 桌面效果层窗口（壁纸模式的新承载）行为守卫
//
// 用户 2026-11-21 的要求：
//   1. 点壁纸模式时播放器窗口与任务栏条目不能消失 → 效果层必须是**另一张**窗口，
//      而且这张窗口自己不能进任务栏（skipTaskbar + toolbar）；
//   2. 效果要能和自己装的 Wallpaper Engine 共生 → 窗口必须透明、只有粒子/歌词有像素；
//   3. 播放器要一直能用 → 效果层必须鼠标穿透、不可聚焦、置底，绝不抢焦点；
//   4. 退出 = 再点一次开关 → disable 必须真的销毁窗口。
//
// 这里用注入的假 BrowserWindow 跑真实 runtime 代码，不碰 Electron。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DesktopStageWindow,
  normalizeStageOpacity,
  normalizeStageFrameRate,
  parseNativeAck,
  stageBottomScript,
} = require('../desktop/desktop-stage-window');

function createFakeBrowserWindowClass(recorder) {
  return class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.id = ++recorder.nextId;
      this.destroyed = false;
      this.shown = 0;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.ignoreMouse = null;
      this.opacity = 1;
      this.alwaysOnTop = true;
      this.sent = [];
      this.listeners = Object.create(null);
      this.webContents = {
        setAudioMuted: (muted) => { this.audioMuted = muted; },
        setWindowOpenHandler: () => {},
        on: (name, fn) => { (this.listeners[name] = this.listeners[name] || []).push(fn); },
        isDestroyed: () => this.destroyed,
        send: (channel, payload) => { this.sent.push([channel, payload]); },
      };
      recorder.windows.push(this);
    }
    setIgnoreMouseEvents(ignore) { this.ignoreMouse = ignore; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    setOpacity(value) { this.opacity = value; }
    loadURL(url) { this.loadedUrl = url; return Promise.resolve(); }
    showInactive() { this.shown += 1; this.visible = true; }
    show() { this.shown += 1; this.visible = true; }
    getBounds() { return { ...this.bounds }; }
    setBounds(next) { this.bounds = { ...next }; }
    isVisible() { return this.visible === true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    getNativeWindowHandle() {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64LE(4321n, 0);
      return buffer;
    }
  };
}

function makeRuntime(overrides = {}) {
  const recorder = { windows: [], nextId: 0, statuses: [], native: [] };
  const BrowserWindow = createFakeBrowserWindowClass(recorder);
  const runtime = new DesktopStageWindow({
    BrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ id: 2, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }),
      on: () => {},
    },
    preloadPath: 'preload.js',
    overlayUrl: () => 'http://127.0.0.1:3000/?stage=1&token=t',
    execFileImpl: (file, args, options, callback) => {
      recorder.native.push({ file, args });
      callback(null, JSON.stringify({ ok: true, windowId: 4321, zOrder: 'bottom' }), '');
    },
    logger: { warn: () => {} },
    onStatus: (status) => recorder.statuses.push(status),
    ...overrides,
  });
  runtime.mainWindowBounds = () => ({ x: 100, y: 80, width: 1200, height: 800 });
  return { runtime, recorder };
}

test('效果层窗口必须透明、无边框、不入任务栏、不可聚焦', async () => {
  const { runtime, recorder } = makeRuntime();
  const result = await runtime.open({ opacity: 1, frameRate: 30, stageWorld: 'native' });
  assert.equal(result.ok, true);
  const win = recorder.windows[0];
  assert.equal(win.options.transparent, true, '必须透明：WE 壁纸要从空隙透出来');
  assert.equal(win.options.backgroundColor, '#00000000');
  assert.equal(win.options.frame, false);
  assert.equal(win.options.skipTaskbar, true, '效果层不能占用任务栏（播放器自己的条目要留着）');
  assert.equal(win.options.focusable, false, '效果层不能抢焦点');
  assert.equal(win.options.type, 'toolbar', 'Windows 下要 WS_EX_TOOLWINDOW，避免任务栏缩略图');
  assert.equal(win.ignoreMouse, true, '必须鼠标穿透，否则整块桌面点不动');
  assert.equal(win.audioMuted, true, '第二份播放必须静音（频谱照常跑）');
  assert.equal(win.alwaysOnTop, false);
  assert.equal(win.loadedUrl, 'http://127.0.0.1:3000/?stage=1&token=t');
  assert.ok(win.shown >= 1, '打开后要显示出来');
});

test('效果层铺满主窗口所在显示器，而不是只铺主屏', async () => {
  const { runtime, recorder } = makeRuntime();
  await runtime.open({});
  const win = recorder.windows[0];
  assert.deepEqual(win.bounds, { x: 0, y: 0, width: 2560, height: 1440 },
    '主窗口在副屏时，效果层必须跟过去');
});

test('打开后要把窗口压到 z 序最底（HWND_BOTTOM），且不改 style/parent', async () => {
  const { runtime, recorder } = makeRuntime();
  await runtime.open({});
  // z 序是异步 promise 里的，等一轮
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(recorder.native.length >= 1, '没有调用原生 z 序');
  const script = recorder.native[0].args.join('\n');
  assert.match(script, /SetWindowPos\(\$target, \[IntPtr\]::new\(\[Int64\]1\)/, '必须用 HWND_BOTTOM=1');
  assert.match(script, /0x0070/, 'SWP_NOACTIVATE|SWP_SHOWWINDOW|SWP_FRAMECHANGED');
  assert.match(script, /WS_POPUP/, '要补 WS_POPUP，否则系统按工作区夹高度（任务栏那一条盖不到）');
  assert.match(script, /DwmSetWindowAttribute\(\$target, 33/, '要去掉 Win11 的圆角（DONOTROUND）');
  assert.match(script, /GetWindowRect\(\$target, \[ref\]\$rect\)/,
    '要以窗口当前实际矩形为准：写死主屏坐标会把副屏上的效果层搬走');
  assert.ok(!/SetWindowPos\(\$target, \[IntPtr\]::new\(\[Int64\]1\), 0, 0,/.test(script),
    '不能把效果层硬搬到 (0,0)：主窗口在副屏时桌面效果会跑到主屏左上角');
  assert.match(script, /GetSystemMetrics\(0\)/, '尺寸兜底仍要物理分辨率，不能用工作区');
  assert.ok(!/SetParent/.test(script), '不挂 Progman/WorkerW（分层窗跨进程 SetParent 后不刷新）');
  assert.equal(runtime.zOrder, 'bottom');
});

test('主窗口拖到另一块屏：效果层跟着换屏；同一块屏不重复 setBounds', async () => {
  const recorder = { windows: [], nextId: 0, statuses: [], native: [] };
  const BrowserWindow = createFakeBrowserWindowClass(recorder);
  const displayA = { id: 'a', bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const displayB = { id: 'b', bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
  let mainBounds = { x: 100, y: 80, width: 1200, height: 800 };
  const runtime = new DesktopStageWindow({
    BrowserWindow,
    screen: {
      getPrimaryDisplay: () => displayA,
      getDisplayMatching: (rect) => (Number(rect && rect.x) >= 1920 ? displayB : displayA),
      on: () => {},
    },
    preloadPath: 'preload.js',
    overlayUrl: () => 'http://127.0.0.1:3000/?stage=1&token=t',
    execFileImpl: (file, args, options, callback) => {
      recorder.native.push({ file, args });
      callback(null, JSON.stringify({ ok: true, windowId: 4321, zOrder: 'bottom' }), '');
    },
    logger: { warn: () => {} },
  });
  runtime.mainWindowBounds = () => mainBounds;
  await runtime.open({});
  const win = recorder.windows[0];
  assert.deepEqual(win.bounds, displayA.bounds, '初始应该铺主窗口所在屏');
  mainBounds = { x: 2200, y: 120, width: 1200, height: 800 };
  assert.equal(runtime.reposition('main-window-moved'), true, '换屏要跟过去');
  assert.deepEqual(win.bounds, displayB.bounds);
  assert.equal(runtime.reposition('main-window-moved'), false, '同一块屏的移动不该反复 setBounds');
});

test('设置与会话分开发：每秒更新设置不能把整条队列重发一遍', async () => {
  const { runtime, recorder } = makeRuntime();
  await runtime.open({ opacity: 0.8 });
  const win = recorder.windows[0];
  const fullSession = { kind: 'full', full: { song: { id: 'a' }, queue: new Array(120).fill({ id: 'x' }) } };
  runtime.setSession(fullSession);
  const sessionSends = win.sent.filter(([, payload]) => payload && payload.session);
  assert.equal(sessionSends.length, 1, '会话只该发一条');

  win.sent.length = 0;
  await runtime.update({ opacity: 0.6, frameRate: 24 });
  const settingsSends = win.sent.filter(([, payload]) => payload && !payload.session);
  assert.ok(settingsSends.length >= 1, '设置更新要发出去');
  assert.equal(win.sent.filter(([, payload]) => payload && payload.session).length, 0,
    '更新设置不得附带整条会话（120 首 × 每秒 = IPC 洪水）');
  assert.equal(win.opacity, 0.6, '透明度要真的应用');
});

test('disable 必须真的销毁窗口，并把 enabled 归 false', async () => {
  const { runtime, recorder } = makeRuntime();
  await runtime.open({});
  const win = recorder.windows[0];
  const result = await runtime.disable('test');
  assert.equal(result.ok, true);
  assert.equal(result.enabled, false);
  assert.equal(win.destroyed, true, '效果层窗口没被销毁');
  assert.equal(runtime.getStatus('after').active, false);
});

test('重复 open 复用同一张窗口，不叠第二张', async () => {
  const { runtime, recorder } = makeRuntime();
  await runtime.open({});
  await runtime.open({ opacity: 0.5 });
  assert.equal(recorder.windows.length, 1);
  assert.equal(recorder.windows[0].opacity, 0.5);
});

test('加载失败要回收窗口并如实报错（不能留一张黑窗在桌面上）', async () => {
  const { runtime, recorder } = makeRuntime();
  recorder.windows = [];
  const originalCreate = runtime.createWindow.bind(runtime);
  runtime.createWindow = function () {
    const win = originalCreate();
    win.loadURL = () => Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
    return win;
  };
  const result = await runtime.open({});
  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  assert.match(String(result.error), /ERR_CONNECTION_REFUSED/);
  assert.equal(recorder.windows[0].destroyed, true);
});

test('opacity / frameRate 归一化守住上下限', () => {
  assert.equal(normalizeStageOpacity(undefined), 1);
  assert.equal(normalizeStageOpacity(0.1), 0.2);
  assert.equal(normalizeStageOpacity(9), 1);
  assert.equal(normalizeStageFrameRate(0), 60);
  assert.equal(normalizeStageFrameRate(24), 24);
  assert.equal(normalizeStageFrameRate(120), 60);
});

test('原生置底脚本拒绝非法 HWND、ack 必须是 ok:true', () => {
  assert.throws(() => stageBottomScript({ hwnd: 'abc' }), /STAGE_NATIVE_HANDLE_INVALID/);
  assert.deepEqual(parseNativeAck('{"ok":true,"zOrder":"bottom"}').zOrder, 'bottom');
  assert.throws(() => parseNativeAck('{"ok":false}'), /STAGE_NATIVE_ACK_INVALID/);
  assert.throws(() => parseNativeAck(''), /STAGE_NATIVE_EMPTY/);
});
