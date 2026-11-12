'use strict';

/**
 * 真机验证：点播放器右上角关闭按钮后，整个 Electron 进程树是否全部退出。
 *
 * 背景（2026-11-11 22:13）：用户已关掉播放器、托盘任务栏都无窗口，
 * 但 7 个 Mineradio.exe 仍挂了近 1.5 小时。修复后必须实测：
 *   - 启动一个隔离 profile 的真实 exe；
 *   - 用 CDP 真实点击 [data-window-action="close"]；
 *   - 等 8 秒（含 3 秒 app.exit 兜底）后查系统进程表，必须为 0。
 *
 * 用法：node scripts/probe-desktop-force-exit.js
 * 前置：本机不能有其他 Mineradio.exe 实例（单实例锁会吞掉调试端口）。
 */

const { execFileSync } = require('child_process');
const cdp = require('../.workbuddy/harness/cdp-client');

const PORT = 9431;
const PROFILE = 'D:/Mineradio/.workbuddy/tmp/electron-exit-probe';
const WAIT_AFTER_CLICK_MS = 8000;

function listPids() {
  let out = '';
  try {
    out = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-Process -Name Mineradio -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id',
    ], { encoding: 'utf8', windowsHide: true });
  } catch (_) { return []; }
  return String(out).split(/\r?\n/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function pidDetails(pids) {
  if (!pids.length) return '[]';
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name = \'Mineradio.exe\'" | ForEach-Object { '
      + '"$($_.ProcessId) ppid=$($_.ParentProcessId) $($_.CommandLine)" }',
    ], { encoding: 'utf8', windowsHide: true });
    return '\n  ' + String(out).trim().split(/\r?\n/)
      .map((s) => s.slice(0, 150)).join('\n  ');
  } catch (_) { return JSON.stringify(pids); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   [' + detail + ']' : ''));
}

async function main() {
  const before = listPids();
  check('启动前无残留 Mineradio.exe 进程', before.length === 0, 'count=' + before.length);
  if (before.length) {
    console.log('  残留进程：' + pidDetails(before));
    console.log('  请先结束这些进程再跑本探针（单实例锁会吞掉调试端口）。');
    process.exitCode = 1;
    return;
  }

  let app = null;
  try {
    app = await cdp.launch({
      port: PORT,
      safeClose: true,
      bootTimeoutMs: 120000,
      evalTimeoutMs: 20000,
      extraArgs: ['--user-data-dir=' + PROFILE],
    });
  } catch (e) {
    check('隔离实例启动成功', false, e.message);
    process.exitCode = 1;
    return;
  }
  check('隔离实例启动成功（CDP 已连上）', true, 'port=' + PORT);

  // 等关闭按钮出现：不要求核心模块全 ready，只要窗口控制条渲染出来即可。
  let buttonReady = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await app.eval("!!document.querySelector('[data-window-action=\"close\"]')");
      if (r === true) { buttonReady = true; break; }
    } catch (_) {}
    await sleep(1000);
  }
  check('主窗口关闭按钮已渲染并绑定点击', buttonReady);
  if (!buttonReady) {
    try { app.close(); } catch (_) {}
    process.exitCode = 1;
    return;
  }

  const started = listPids();
  check('启动后确实拉起了进程树（主 + 子进程）', started.length >= 3,
    'count=' + started.length + ' pids=' + started.join(','));

  /* 用 setTimeout 把点击推到 eval 返回之后：进程一退 CDP 连接就断，
     若让 evaluate 等 IPC invoke 的 Promise，会先超时再拿不到结果。 */
  const clicked = await app.eval(`(function(){
    var b = document.querySelector('[data-window-action="close"]');
    if (!b) return 'no-button';
    setTimeout(function(){ b.click(); }, 50);
    return 'clicked';
  })()`);
  check('已通过 CDP 真实点击关闭按钮', clicked === 'clicked', String(clicked));

  await sleep(WAIT_AFTER_CLICK_MS);
  const after = listPids();
  check('点击关闭后所有 Mineradio.exe 进程全部退出', after.length === 0,
    'count=' + after.length + (after.length ? pidDetails(after) : ''));

  // 再等 2 秒复查，防止 crashpad / utility 晚退。
  await sleep(2000);
  const final = listPids();
  check('2 秒后复查仍为 0 个进程', final.length === 0, 'count=' + final.length);

  if (final.length) {
    console.log('\n残留明细：' + pidDetails(final));
    console.log('清理探针实例...');
    try { app.close(); } catch (_) {}
    try {
      execFileSync('taskkill', ['/IM', 'Mineradio.exe', '/T', '/F'], { stdio: 'ignore' });
    } catch (_) {}
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (failed ? 'FAILED ' + failed + '/' + results.length : 'ALL_OK ' + results.length + '/' + results.length));
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('probe crashed: ' + (e && e.stack || e));
  process.exitCode = 1;
});
