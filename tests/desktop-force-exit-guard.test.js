'use strict';

/**
 * 守卫：点关闭按钮后必须把整个 Electron 进程树收干净。
 *
 * 真实现场（2026-11-11 22:13）：
 *   用户已点关闭按钮，托盘和任务栏都没有窗口（MainWindowHandle=0），
 *   但 7 个 Mineradio.exe 仍在：MAIN 22472 + crashpad + gpu + 3×utility
 *   + renderer，全部 20:35 启动，挂了近 1.5 小时。
 *
 * 三条会把退出卡住的老路径：
 *   ① mainWindow.on('close') 在 closeBehavior==='tray' 下 preventDefault + hide()；
 *   ② 其它 BrowserWindow（登录窗 / 桌面歌词 / 壁纸层）还活着，
 *      window-all-closed 永远不触发；
 *   ③ before-quit 里壁纸 runtime.dispose() 挂起时退出被永久 preventDefault。
 *
 * 修法：desktop-window-close 直接走 forceExitApp —— 显式销毁所有窗口、
 * kill 独立子进程、app.quit()，并留 3 秒 app.exit(0) 兜底；
 * 「后台托盘」语义搬到最小化按钮。
 *
 * 本文件为静态守卫；真实进程树验证见 scripts/probe-desktop-force-exit.js。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RAW_MAIN = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
const RAW_INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const RAW_SHELL = fs.readFileSync(
  path.join(ROOT, 'public', 'js', 'modules', '10-shell', '04-desktop-overlay-fullscreen.js'), 'utf8',
);
const RAW_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'public', 'js', 'modules', '07-fx', '08-cache-storage-settings.js'), 'utf8',
);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const MAIN = stripComments(RAW_MAIN);
const SHELL = stripComments(RAW_SHELL);

/** 按大括号配对切出某个函数 / handler 的完整函数体，避免跨片段误匹配 */
function sliceBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

const FORCE_EXIT = sliceBlock(MAIN, 'function forceExitApp(');
const CLOSE_IPC = sliceBlock(MAIN, "ipcMain.handle('desktop-window-close'");
const MINIMIZE_IPC = sliceBlock(MAIN, "ipcMain.handle('desktop-window-minimize'");
const BEFORE_QUIT = sliceBlock(MAIN, "app.on('before-quit'");
const WILL_QUIT = sliceBlock(MAIN, "app.on('will-quit'");
const ALL_CLOSED = sliceBlock(MAIN, "app.on('window-all-closed'");
const KILL_CHILDREN = sliceBlock(MAIN, 'function killAppChildProcesses(');
const DESTROY_WINDOWS = sliceBlock(MAIN, 'function destroyAllAppWindows(');
const SHUTDOWN_CLEANUP = sliceBlock(MAIN, 'function runAppShutdownCleanup(');

test('D1 定义了 forceExitApp 强制退出函数', () => {
  assert.ok(FORCE_EXIT.length > 200, 'forceExitApp 函数体必须存在');
  assert.match(FORCE_EXIT, /forceQuitting\s*=\s*true/);
  assert.match(FORCE_EXIT, /appQuitting\s*=\s*true/);
});

test('D2 关闭按钮 IPC 直接走 forceExitApp，不再只 win.close()', () => {
  assert.match(CLOSE_IPC, /forceExitApp\('window-close-button'\)/);
  assert.ok(!/\.close\(\)/.test(CLOSE_IPC.replace(/forceExitApp/g, '')),
    '关闭按钮不得再依赖 win.close() 后等 window-all-closed');
});

test('D3 close 拦截只为「关闭到托盘」服务，且强制退出必须能穿透', () => {
  /* 2026-11-25 起「关闭按钮」可由用户选：完全退出（默认）/ 隐藏到托盘。
   * 旧版本之所以要彻底禁掉 close 拦截，是因为当时 hide() 之前**不建托盘**，
   * 窗口和任务栏都没了、进程却全留着，用户没有任何找回的办法。
   * 现在这条守卫守的是新契约，而不是「不许拦」：
   *   ① 只有 closeAction === 'tray' 才拦；
   *   ② 拦的时候必须先 createOrUpdateTray()，再 hide（顺序不能反）；
   *   ③ forceQuitting 期间必须直接放行，否则托盘「退出」/ 关闭选「完全退出」都会被顶回去。 */
  const closeHandler = sliceBlock(MAIN, "mainWindow.on('close'");
  assert.ok(closeHandler, '必须存在 close 拦截（关闭到托盘依赖它）');
  assert.match(closeHandler, /if \(forceQuitting\) return;/, '强制退出期间不能被拦');
  assert.match(closeHandler, /closeAction !== 'tray'\) return;/, '只有选了托盘才拦');
  const trayPos = closeHandler.indexOf('createOrUpdateTray()');
  const hidePos = closeHandler.indexOf('mainWindow.hide()');
  assert.ok(trayPos > 0, '隐藏前必须建托盘，否则用户找不回窗口');
  assert.ok(hidePos > 0 && trayPos < hidePos, '顺序必须是先建托盘再隐藏');
  assert.match(closeHandler, /event\.preventDefault\(\)/);
});

test('D4 forceExitApp 显式销毁所有 BrowserWindow', () => {
  assert.match(DESTROY_WINDOWS, /BrowserWindow\.getAllWindows\(\)/);
  assert.match(DESTROY_WINDOWS, /win\.destroy\(\)/);
  assert.match(FORCE_EXIT, /destroyAllAppWindows\(\)/);
});

test('D5 独立 OS 子进程（powershell 轮询 / 光标监视）在退出时被 kill', () => {
  assert.match(KILL_CHILDREN, /stopDesktopLyricsMousePoller\(\)/);
  assert.match(KILL_CHILDREN, /stopDesktopLyricsCursorWatcher\(\)/);
  assert.match(FORCE_EXIT, /killAppChildProcesses\(\)/);
  assert.match(SHUTDOWN_CLEANUP, /killAppChildProcesses\(\)/);
  assert.match(BEFORE_QUIT, /killAppChildProcesses\(\)/);
  assert.match(WILL_QUIT, /killAppChildProcesses\(\)/);
});

test('D6 有 3 秒 app.exit(0) 兜底，且 before-quit 不再拦截强制退出', () => {
  assert.match(FORCE_EXIT, /setTimeout\(/);
  assert.match(FORCE_EXIT, /3000/);
  assert.match(FORCE_EXIT, /app\.exit\(0\)/);
  assert.match(BEFORE_QUIT, /!forceQuitting/,
    '壁纸 dispose 分支在强制退出时必须让路，否则 preventDefault 会永久卡住');
});

test('D7 window-all-closed 和 will-quit 都接入强制退出链路', () => {
  assert.match(ALL_CLOSED, /forceExitApp\('window-all-closed'\)/);
  assert.ok(WILL_QUIT.length > 50, 'will-quit 必须存在（退出前最后一次子进程清理）');
  assert.match(WILL_QUIT, /clearTimeout\(forceExitTimer\)/);
});

test('D8 托盘「退出」菜单同样走 forceExitApp', () => {
  assert.match(MAIN, /label:\s*['"]退出['"],\s*click:\s*\(\)\s*=>\s*forceExitApp\('tray-menu-exit'\)/);
});

test('D9 「后台托盘」语义搬到最小化按钮，关闭按钮不再读 behavior', () => {
  assert.match(MINIMIZE_IPC, /closeBehavior\s*===\s*['"]tray['"]/);
  assert.match(MINIMIZE_IPC, /win\.hide\(\)/);
  assert.match(MINIMIZE_IPC, /createOrUpdateTray\(\)/);
  assert.ok(!/closeBehaviorPreference/.test(SHELL),
    'closeBehaviorPreference 全项目从未定义，旧写法恒传 undefined');
  assert.match(SHELL, /api\.close\(\)/);
});

test('D10 最小化与关闭按钮的行为都可配置，关闭默认仍是完全退出', () => {
  // 设置页：两个分段各有两项，关闭按钮默认选中 exit
  assert.match(RAW_INDEX, /<div class="fx-section-label">最小化按钮<\/div>/);
  assert.match(RAW_INDEX, /id="close-behavior-seg"/);
  assert.match(RAW_INDEX, /最小化到任务栏/);
  assert.match(RAW_INDEX, /id="close-action-seg"/);
  assert.match(RAW_INDEX, /<button data-close-action="exit" class="active"/);
  assert.match(RAW_INDEX, /<button data-close-action="tray"/);
  assert.match(RAW_SETTINGS, /最小化行为/);
  assert.match(RAW_SETTINGS, /关闭按钮: 隐藏到托盘/);
  // 主进程：默认 exit；tray 时隐藏 + 建托盘，只有 exit 才走 forceExitApp
  assert.match(MAIN, /let closeAction = 'exit'/);
  assert.match(CLOSE_IPC, /if \(closeAction === 'tray'[\s\S]{0,220}?win\.hide\(\)/,
    'tray 分支必须隐藏窗口而不是退出');
  assert.match(CLOSE_IPC, /forceExitApp\('window-close-button'\)/, 'exit 分支保留强制退出兜底');
  assert.match(MAIN, /mainWindow\.on\('close',[\s\S]{0,260}?event\.preventDefault\(\)/,
    'Alt+F4 走 close 事件，tray 模式必须在那里拦下来');
  // 偏好必须落盘，否则重启回到默认值
  assert.match(RAW_SETTINGS, /mineradio:close-action:v1/);
  assert.match(RAW_SETTINGS, /setCloseAction/);
});
