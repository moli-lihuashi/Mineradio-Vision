'use strict';

// =============================================================================
// 2026-11-05 全面 bug 测试后的 P0 / P1 修复回归
//
// 覆盖的缺陷（改之前都能稳定复现或静态确证）：
//   P0-1 托盘菜单 send() 引用了不存在的 `win` → 播放/暂停等三项必抛 ReferenceError
//   P0-2 HTTP 监听函数是裸 async，异常时连接永不响应；请求体超限直接 destroy
//   P1-1 二维码登录包通道缺 sender 校验、TTL 无主动定时器、退出不停会话
//   P1-2 冷启动期 second-instance 并发 createWindow() 产生孤儿窗口
//   P1-3 酷狗 QR 登录窗口关闭后仍启动 1.2s 轮询且永不清理
//   P1-4 桌面歌词窗口销毁漏停 powershell 轮询 + stop/start 竞态清掉新引用
//
// 第二轮（同日）：又修了静默失效的 API 契约、定时器/异步错误、敏感 IPC 校验、
// 二维码导入 SSRF 面、明文凭据覆盖与 server 常驻 error 监听，见文件末尾的「第二轮」用例。
//
// 说明：主进程依赖 Electron，无法在 node --test 里真实实例化窗口；
// 这里对关键代码块做源码级断言（和项目其它 main.js 回归测试同一手法），
// 另对二维码模块做不依赖网络拓扑的行为断言。
// =============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const main = read('desktop/main.js');
const qrSync = read('desktop/login-pack-qr-sync.js');
const httpServer = read('server/lib/http-server.js');
const serverJs = read('server.js');

function read(rel) {
  return fs.readFileSync(path.join(appRoot, rel), 'utf8').replace(/\r\n/g, '\n');
}

// 取从 startMarker 起到 endMarker 之间的代码块；endMarker 缺省为下一个顶层 function。
function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, '找不到代码块起点：' + startMarker);
  const from = start + startMarker.length;
  let end = endMarker ? source.indexOf(endMarker, from) : source.indexOf('\nfunction ', from);
  if (end < 0) end = source.length;
  return source.slice(start, end);
}

// ---------------------------------------------------------------- P0-1 托盘

test('P0-1 托盘控制命令指向 mainWindow，不再引用未定义的 win', () => {
  const tray = block(main, 'function createOrUpdateTray()');
  const send = block(tray, 'const send = (code) => {', '};');
  assert.match(send, /const target = mainWindow;/, 'send 应显式取 mainWindow');
  assert.match(send, /target\.webContents\.executeJavaScript/, 'send 应向目标窗口注入控制命令');
  assert.doesNotMatch(send, /\bif \(win\b/, '不能再出现未声明的 win');
  assert.match(tray, /label: '播放 \/ 暂停'/, '托盘菜单仍保留播放控制项');
});

// ---------------------------------------------------------------- P0-2 HTTP

test('P0-2 HTTP 请求处理有统一 catch，异常时一定给出响应', () => {
  assert.match(httpServer, /async function handleRequest\(req, res\)/, '处理器应抽成具名 async 函数');
  const listener = block(httpServer, 'const server = http.createServer((req, res) => {', '\n  server.on(');
  assert.match(listener, /handleRequest\(req, res\)\.catch/, '同步监听器必须 .catch() 兜住 rejected Promise');
  assert.match(listener, /INTERNAL_ERROR/, '异常应返回结构化错误');
  assert.match(listener, /res\.writableEnded \|\| res\.headersSent/, '响应已发出时不能二次写头');
  assert.match(listener, /statusCode\) === 413 \? 413 : 500/, '请求体过大应映射为 413');
  assert.match(httpServer, /server\.on\('clientError'/, '应处理客户端协议错误');
});

test('P0-2 请求体超限不再 destroy 连接，改由 413 响应收口', () => {
  const readBody = block(serverJs, 'function readRequestBody(req)');
  const tooLarge = block(readBody, 'if (total > MAX_BYTES) {', '\n      }');
  assert.match(tooLarge, /err\.statusCode = 413/, '错误应带 413 状态码');
  assert.match(tooLarge, /req\.resume\(\)/, '应排空剩余请求体，避免连接卡住');
  assert.doesNotMatch(tooLarge, /req\.destroy\(\)/, '不能直接断开连接');
});

// ---------------------------------------------------------------- P1-1 二维码

test('P1-1 qr-start 通道只接受受信任的主窗口调用', () => {
  const handler = block(main, "ipcMain.handle('mineradio-login-pack-qr-start'", "\n});");
  assert.match(handler, /isTrustedMainWindowIpc\(event\)/, '必须做 sender 校验');
  assert.match(handler, /UNTRUSTED_SENDER/, '拒绝时要返回明确错误码');
  assert.match(handler, /async \(event, payload = \{\}\)/, 'handler 必须接收 event 参数');
});

test('P1-1 二维码会话 TTL 有主动定时器，且停止时清理', () => {
  assert.match(qrSync, /sessionExpiryTimer = setTimeout\(/, '必须有按 expiresAt 主动过期的定时器');
  assert.match(qrSync, /stopLoginPackQrSession\(\);\s*\n\s*\}, ttlMs\)/, '定时器到点要关服务');
  assert.match(qrSync, /typeof sessionExpiryTimer\.unref === 'function'/, '定时器应 unref 以免阻碍退出');
  const stop = block(qrSync, 'function stopLoginPackQrSession()');
  assert.match(stop, /clearTimeout\(sessionExpiryTimer\)/, 'stop 必须清掉定时器');
  assert.match(stop, /activeSession = null/, 'stop 必须释放会话引用');
  assert.match(qrSync, /if \(resolved\) return;/, 'listening / error 回调不能重复 resolve');
});

test('P1-1 应用退出清理会停掉二维码服务', () => {
  const cleanup = block(main, 'function runAppShutdownCleanup()');
  assert.match(cleanup, /stopLoginPackQrSession\(\)/, '退出前必须关闭监听 LAN 的凭据服务');
});

test('P1-1 停止会话是幂等的，重复停止不影响后续启动', () => {
  const { stopLoginPackQrSession } = require('../desktop/login-pack-qr-sync');
  assert.deepStrictEqual(stopLoginPackQrSession(), { ok: true, stopped: true });
  assert.deepStrictEqual(stopLoginPackQrSession(), { ok: true, stopped: true });
});

// ---------------------------------------------------------------- P1-2 主窗口

test('P1-2 主窗口创建全部走去重入口', () => {
  assert.match(main, /function ensureMainWindowCreated\(\)/, '应有 Promise 去重包装');
  assert.match(main, /mainWindowCreationPromise = createWindow\(\)/, '去重包装应复用同一次创建');
  assert.match(main, /\.finally\(\(\) => \{ mainWindowCreationPromise = null; \}\)/, '结束后要复位哨兵');
  const secondInstance = block(main, "app.on('second-instance'", '\n  });');
  assert.match(secondInstance, /if \(mainWindowCreationPromise\)/, '启动未完成时先等主流程');
  assert.match(secondInstance, /ensureMainWindowCreated\(\)/, '兜底路径也要走去重入口');
  assert.doesNotMatch(secondInstance, /then\(\(\) => createWindow\(\)\)/, '不能直接并发 createWindow');
  assert.match(main, /await ensureMainWindowCreated\(\);/, '主启动流程走去重入口');
  assert.match(main, /ensureMainWindowCreated\(\)\.then\(\(\) => focusMainWindow\(\)\)/, 'activate 走去重入口');
});

// ---------------------------------------------------------------- P1-3 登录窗口

test('P1-3 三个登录窗口关闭时都标记 settled 并清掉轮询', () => {
  const closedHandlers = main.match(/loginWindow\.on\('closed', async \(\) => \{[\s\S]*?\n    \}\);/g) || [];
  assert.strictEqual(closedHandlers.length, 3, '网易 / QQ / 酷狗各有一个 closed handler');
  closedHandlers.forEach((handler, i) => {
    assert.match(handler, /settled = true;/, '第 ' + (i + 1) + ' 个 closed 必须置 settled');
    assert.match(handler, /clearInterval\(pollTimer\)/, '第 ' + (i + 1) + ' 个 closed 必须停轮询');
  });
});

test('P1-3 酷狗 QR 的每次 await 之后都检查窗口是否还在', () => {
  // 守卫函数定义在 startKugouQrLogin 之前，分两段取。
  const guards = block(main, 'const windowGone = () =>', '\n    const checkCookies');
  const start = block(main, 'const startKugouQrLogin = async () => {', '\n    };');
  assert.match(guards, /const windowGone = \(\) => settled \|\| !loginWindow \|\| loginWindow\.isDestroyed\(\)/);
  assert.match(guards, /const startPolling = \(fn\) => \{[\s\S]*?if \(windowGone\(\)\) return false;/,
    '启动定时器前必须检查窗口状态');
  const checks = start.match(/if \(windowGone\(\)\) (?:return;|\{ stopPolling\(\); return; \})/g) || [];
  assert(checks.length >= 4, 'QR key / loadURL / 轮询开始 / 轮询回调都要检查，实际 ' + checks.length);
  assert.match(start, /if \(windowGone\(\)\) return;\s*\n\s*console\.warn\('Kugou QR login failed/,
    '兜底分支也不能在窗口关闭后启动轮询');
  assert.doesNotMatch(start, /pollTimer = setInterval\(pollLogin/, '轮询必须统一走 startPolling');
});

// ---------------------------------------------------------------- P1-4 桌面歌词

test('P1-4 桌面歌词窗口任何销毁路径都停掉 powershell 轮询', () => {
  const closed = block(main, "desktopLyricsWindow.on('closed', () => {", '\n  });');
  assert.match(closed, /stopDesktopLyricsMousePoller\(\)/, 'closed 必须停 powershell 子进程');
  assert.match(closed, /stopDesktopLyricsCursorWatcher\(\)/, '原有 cursor watcher 清理要保留');
});

test('P1-4 旧进程的 exit 不能清掉新进程的引用', () => {
  const start = block(main, 'function startDesktopLyricsMousePoller()');
  assert.match(start, /const poller = spawn\('powershell\.exe'/, '应持有本次 child 的局部引用');
  assert.match(start, /if \(desktopLyricsMousePoller !== poller\) return;/, 'exit/error 必须校验引用身份');
  assert.match(start, /poller\.on\('exit', clearPollerRef\)/);
  assert.match(start, /poller\.on\('error', clearPollerRef\)/);
  assert.match(start, /poller\.stdout\.on\('data'[\s\S]*?desktopLyricsMousePoller !== poller/,
    '旧进程输出不能污染新进程缓冲区');
});

// ------------------------------------------------- 顺手修的两处低风险项

test('恢复背景按钮绑定的是真实存在的函数', () => {
  const html = read('public/index.html');
  assert.doesNotMatch(html, /restoreWallpaperEngineBackground/, '不能再调用不存在的函数');
  assert.match(html, /onclick="restoreOriginalBackgroundAfterWallpaperEngine\(\)"/, '应绑定到真实实现');
});

test('QQ 登录窗口的弹窗导航限制在 QQ 自有域', () => {
  const handler = block(main, '// 和网易 / 酷狗登录窗口一致', '\n    });');
  assert.match(handler, /new URL\(url\)\.hostname\.toLowerCase\(\)/, '用 hostname 精确比较，防前缀绕过');
  assert.match(handler, /host\.endsWith\('\.qq\.com'\)/);
  assert.match(handler, /const trusted = /, '必须有白名单判据');
  assert.match(handler, /if \(trusted\) \{[\s\S]*?loginWindow\.loadURL/, '只有白名单域名才在本窗口导航');
  assert.match(handler, /shell\.openExternal\(url\)/, '非白名单 http(s) 应交给外部浏览器');
});

// =========================================================================
// 第二轮：P2 / P3 加固
// =========================================================================

test('第二轮 preload 暴露 getGpuDiagnostics', () => {
  const preload = read('desktop/preload.js');
  assert.match(preload, /getGpuDiagnostics: \(\) => ipcRenderer\.invoke\('mineradio-get-gpu-diagnostics'\)/);
});

test('第二轮 trimAppMemory 无有效 PID 时整理全部自有进程', () => {
  const trim = block(main, "ipcMain.handle('mineradio-memory-trim-app'", "\n});");
  assert.match(trim, /const targets = requested\.length \? requested : Array\.from\(own\)/);
  assert.match(trim, /isTrustedMainWindowIpc\(event\)/, '仍保留 sender 校验');
});

test('第二轮 home-pet 兜底创建的 input 会回设 id', () => {
  const pet = read('public/js/modules/05-playback/14-home-pet.js');
  const pick = block(pet, 'function homePetPickPhoto()');
  assert.match(pick, /input\.id = 'home-pet-photo-input'/, '不回设 id 会每次追加一个 input');
});

test('第二轮 5 个敏感 IPC 全部补上 sender 校验', () => {
  const names = [
    'mineradio-export-json-file',
    'mineradio-import-json-file',
    'mineradio-open-update-installer',
    'mineradio-export-login-pack',
    'mineradio-import-login-pack',
  ];
  names.forEach((name) => {
    const handler = block(main, "ipcMain.handle('" + name + "'", "\n});");
    assert.match(handler, /isTrustedMainWindowIpc\(event\)/, name + ' 缺少 sender 校验');
  });
});

test('第二轮 主窗口外链 openExternal 补 catch', () => {
  assert.match(main, /shell\.openExternal\(url\)\.catch\(\(\) => \{\}\)/);
});

test('第二轮 二维码导入 URL 只允许回环与 RFC1918 私网（真实行为）', async () => {
  const {
    isAllowedQrSyncHost,
    fetchLoginPackEnvelopeFromUrl,
  } = require('../desktop/login-pack-qr-sync');
  const allowed = ['127.0.0.1', 'localhost', 'a.localhost', '10.0.0.5', '192.168.198.1',
    '172.16.0.1', '172.31.255.254', '::1', '[::1]', '::ffff:127.0.0.1'];
  const denied = ['169.254.169.254', '0.0.0.0', '8.8.8.8', 'metadata.google.internal',
    'example.com', '172.32.0.1', '192.169.1.1', '224.0.0.1', 'fe80::1', 'fc00::1',
    '::ffff:8.8.8.8', ''];
  allowed.forEach((h) => assert.strictEqual(isAllowedQrSyncHost(h), true, '应允许 ' + h));
  denied.forEach((h) => assert.strictEqual(isAllowedQrSyncHost(h), false, '应拒绝 ' + h));
  // 关键：被拒时不能真的发 GET（否则测试会联网 / 超时）。
  const blocked = await fetchLoginPackEnvelopeFromUrl('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(blocked.error, 'FORBIDDEN_HOST');
  const blockedDomain = await fetchLoginPackEnvelopeFromUrl('https://metadata.google.internal/computeMetadata/v1/');
  assert.strictEqual(blockedDomain.error, 'FORBIDDEN_HOST');
});

test('第二轮 splash 卡顿探针落盘后彻底停掉采样', () => {
  const splash = read('public/js/modules/10-shell/01-splash-and-boot.js');
  assert.match(splash, /var beatTimer = setInterval\(/, '心跳要有句柄');
  assert.match(splash, /clearInterval\(beatTimer\)/, 'flush 时要清心跳');
  assert.match(splash, /var beatTimer = setInterval\(function \(\) \{\s*\n\s*if \(flushed\) return;/,
    'flushed 必须在 R.lag.push 之前短路，否则数组无限增长');
  assert.match(splash, /\(function frame\(\) \{\s*\n\s*if \(flushed\) return;/, 'rAF 不再续帧');
  assert.match(splash, /longTaskObserver\.disconnect\(\)/, 'longtask 观察器要断开');
  assert.match(splash, /document\.addEventListener\('visibilitychange', function \(\) \{\s*\n\s*if \(flushed\) return;/);
});

test('第二轮 覆盖层健康巡检有句柄且页面卸载时清理', () => {
  const overlay = read('public/js/modules/10-shell/04-desktop-overlay-fullscreen.js');
  assert.match(overlay, /var desktopOverlayHealthTimer = setInterval\(/);
  assert.match(overlay, /window\.addEventListener\('pagehide'[\s\S]*?clearInterval\(desktopOverlayHealthTimer\)/);
});

test('第二轮 HTTP server 有常驻 error 监听', () => {
  assert.match(httpServer, /server\.on\('error', \(err\) => \{/);
  assert.match(httpServer, /console\.error\('\[HttpServer\] server error:'/);
});

test('第二轮 明文 cookie 导出不静默覆盖桌面固定文件', () => {
  const handler = block(main, "ipcMain.handle('mineradio-export-login-cookie'", "\n});");
  assert.match(handler, /登录cookie_\$\{stamp\}/, '文件名应带时间戳');
  assert.match(handler, /flag: 'wx'/, '应拒绝覆盖已存在文件');
  assert.match(handler, /fs\.existsSync\(filePath\)/, '冲突时加序号');
  assert.match(handler, /warning: '该文件包含明文登录凭据/, '应给调用方明确提示');
});

test('第二轮 同名函数覆盖是有意设计且已写明代价', () => {
  const shaders = read('public/js/modules/02-visual/10-lyrics-mask-shaders.js');
  assert.match(shaders, /会覆盖 07 里 21 个同名顶层函数/);
  assert.match(shaders, /生效版：立即下发，无补间/);
  assert.match(shaders, /不要只删这里的重复定义/, '应提示需要视觉回归，避免后人误改');
});
