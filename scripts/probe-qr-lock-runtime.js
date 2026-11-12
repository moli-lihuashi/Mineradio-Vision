'use strict';

/**
 * 探针：在真实 Electron 渲染进程里验证 checkQr 的防重入锁 / 代际语义。
 *
 * 为什么需要它：probe-qr-poll-reentry.js 只做「源码结构断言 + 等价模型」，
 * 它能证明写法正确，但证明不了「这两个模块被 index-loader 拼成单个 script 注入后，
 * qrCheckSerial / qrCheckHolder 这些 var 在 03-login-modal-flows.js 里真的可见」。
 * 一旦哪天有人把模块改成 IIFE 或 ESM，结构断言照样全绿，运行时就 ReferenceError。
 *
 * 做法：加载真实的 public/index.html（走真实 loader 与真实注入顺序），
 * 然后在页面里直接调用 checkQr() 观察锁状态，不发任何业务请求（把 apiJson 打桩）。
 *
 * 注意：
 *   - 必须 env -u ELECTRON_RUN_AS_NODE，否则 require('electron') 退化成纯 node。
 *   - 绝不调用任何会 clearStorageData 的接口，不碰用户真实登录态。
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const results = [];
// Electron 主进程在 Windows 上 exit 时 console 输出常被吞掉（管道未 flush），
// 所以除了 console.log 之外再写一份文件日志，作为唯一可信来源。
const LOG_FILE = path.join(ROOT, 'probe-qr-lock-runtime.log');
try { fs.writeFileSync(LOG_FILE, ''); } catch (_) {}
const log = (line) => {
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
};
const check = (ok, name, detail) => {
  results.push({ ok, name, detail });
  log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// 用独立 userData，避免污染（也避免误读）用户真实配置。
app.setPath('userData', path.join(ROOT, '.tmp-probe-qr-lock'));

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

let win = null;

async function main() {
  win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('  [renderer] ' + message);
  });

  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('缺少 public/index.html');

  await win.loadFile(indexPath);

  // 等延迟波模块（含 03-login-modal-flows.js）落地。
  await new Promise((r) => setTimeout(r, 2500));

  // 1) 变量可见性：这是结构断言测不到的真正风险点。
  const vis = await win.webContents.executeJavaScript(`(() => ({
    hasCheckQr: typeof checkQr === 'function',
    hasSerial: typeof qrCheckSerial === 'number',
    hasHolder: typeof qrCheckHolder === 'number',
    hasInFlight: typeof qrCheckInFlight === 'boolean',
    hasStop: typeof stopQrPoll === 'function',
    serial: typeof qrCheckSerial === 'number' ? qrCheckSerial : null,
  }))()`);

  check(vis.hasCheckQr, 'checkQr 在全局作用域可见');
  check(vis.hasSerial, 'qrCheckSerial 在 03-login-modal-flows.js 里可见（跨文件 var 生效）');
  check(vis.hasHolder, 'qrCheckHolder 跨文件可见');
  check(vis.hasInFlight, 'qrCheckInFlight 跨文件可见');

  // 2) 行为：并发重入必须只放行一次。
  // 把 apiJson 打桩成慢响应，模拟 check_qrconnect 挂住。
  const reentry = await win.webContents.executeJavaScript(`(async () => {
    var origApiJson = apiJson;
    var calls = 0;
    var concurrent = 0, peak = 0;
    apiJson = function () {
      calls += 1;
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      return new Promise(function (res) {
        setTimeout(function () {
          concurrent -= 1;
          res({ ok: true, status: 'new' });
        }, 600);
      });
    };
    // 强制走汽水分支并准备一个 token
    loginProvider = 'qishui';
    qishuiQrToken = '__probe_token__';
    qrCheckInFlight = false;
    qrCheckHolder = 0;

    // 连打 5 次，模拟 setInterval 在慢响应下反复点火
    var ps = [];
    for (var i = 0; i < 5; i++) ps.push(checkQr());
    await Promise.all(ps);

    var out = { calls: calls, peak: peak, inFlightAfter: qrCheckInFlight, holderAfter: qrCheckHolder };
    apiJson = origApiJson;
    return out;
  })()`);

  check(reentry.calls === 1, '连打 5 次 checkQr 只发出 1 个请求（防重入生效）',
    `calls=${reentry.calls} peak=${reentry.peak}`);
  check(reentry.peak === 1, '峰值并发为 1（不再叠加打上游）', `peak=${reentry.peak}`);
  check(reentry.inFlightAfter === false, '落定后锁已释放（不会永久卡死）',
    `inFlight=${reentry.inFlightAfter}`);
  check(reentry.holderAfter === 0, '落定后持有者已清零', `holder=${reentry.holderAfter}`);

  // 3) 行为：请求挂死 + stopQrPoll()（用户点刷新）后，新一轮必须能跑。
  const stuck = await win.webContents.executeJavaScript(`(async () => {
    var origApiJson = apiJson;
    apiJson = function () { return new Promise(function () {}); }; // 永不落定
    loginProvider = 'qishui';
    qishuiQrToken = '__probe_token_2__';
    qrCheckInFlight = false;
    qrCheckHolder = 0;

    checkQr();                       // 这一次会挂死
    await new Promise(function (r) { setTimeout(r, 120); });
    var stuckInFlight = qrCheckInFlight;

    stopQrPoll();                    // 用户点「刷新二维码」

    apiJson = function () { return Promise.resolve({ ok: true, status: 'new' }); };
    var before = typeof qrCheckSerial === 'number' ? qrCheckSerial : 0;
    await checkQr();                 // 新一轮必须能跑
    var after = typeof qrCheckSerial === 'number' ? qrCheckSerial : 0;

    var out = {
      stuckInFlight: stuckInFlight,
      serialAdvanced: after > before,
      inFlightAfter: qrCheckInFlight,
    };
    apiJson = origApiJson;
    return out;
  })()`);

  check(stuck.stuckInFlight === true, '挂死的请求确实占着锁（前提成立）');
  check(stuck.serialAdvanced === true, 'stopQrPoll() 推进代际（刷新后新一轮能跑，不死锁）');
  check(stuck.inFlightAfter === false, '新一轮正常落定并释放锁');

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

function finish(code) {
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch (_) {}
  try {
    // 清理本探针自己的临时 userData（只删我们自己建的 .tmp-probe-qr-lock）
    const tmp = path.join(ROOT, '.tmp-probe-qr-lock');
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}
  app.exit(code);
}

app.whenReady().then(() => {
  main().then(finish).catch((e) => {
    log('探针异常: ' + (e && e.stack || e));
    finish(1);
  });
});
