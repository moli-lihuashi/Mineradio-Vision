#!/usr/bin/env node
'use strict';

/* =============================================================================
 * 启动不回归探针：首页 token 门禁上线后，主窗口还能正常进主页吗？
 *
 * 背景：`/` 现在要求 ?token=<API_TOKEN>（serveIndexHtml 会明文注入 token，
 * 不加门禁 = GET / 即拿 token）。而 desktop/main.js 的 loadMainWindowWithRetry
 * 必须同步带上 token，否则导航 403 → 启动页卡死/白屏。
 *
 * 这个探针做四件事：
 *   1. 起 Electron（dev 态，临时 userData 隔离，不污染真实登录态）
 *   2. 等主窗口 CDP target
 *   3. 断言 URL 带 token、页面真的渲染出 #bottom-bar、window.__MINERADIO_API_TOKEN__ 有值
 *   4. 断言用该 token 打 /api/* 能通（证明 token 是真有效的那一个）
 *
 * 用法：node scripts/check-startup-token-gate.js [--port 9333]
 * ========================================================================== */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const portArg = process.argv.indexOf('--port');
const CDP_PORT = Number(portArg > 0 ? process.argv[portArg + 1] : 9333) || 9333;
/* dev 态走 require('electron')，但本地 node_modules 里的 electron 二进制可能没下载
 * （离线环境装不上）。这时用 --exe 指到已打包的 dist/Mineradio/Mineradio.exe 即可，
 * 前提是先把源码同步进 dist（node scripts/sync-dist-app.js），否则测的是旧代码。 */
const exeArg = process.argv.indexOf('--exe');
const EXE_PATH = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : '';

function resolveLaunch() {
  if (EXE_PATH) {
    if (!fs.existsSync(EXE_PATH)) throw new Error('--exe 指向的文件不存在: ' + EXE_PATH);
    return { command: EXE_PATH, args: [], cwd: path.dirname(EXE_PATH) };
  }
  let electronBin;
  try {
    electronBin = require('electron');
  } catch (e) {
    throw new Error('本地 electron 不可用（' + e.message + '）。离线环境请用 --exe 指向 dist/Mineradio/Mineradio.exe');
  }
  if (typeof electronBin !== 'string' || !fs.existsSync(electronBin)) {
    throw new Error('electron 二进制未下载。请用 --exe 指向 dist/Mineradio/Mineradio.exe');
  }
  return { command: electronBin, args: ['.'], cwd: appRoot };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP failed'));
      else p.resolve(msg.result);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
  }
  call(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.call('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception && res.exceptionDetails.exception.description
        || res.exceptionDetails.text || 'eval failed');
    }
    return res.result && res.result.value;
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function findMainTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() <= deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      const target = (list || []).find((t) => t.type === 'page'
        && /^http:\/\/127\.0\.0\.1:/.test(String(t.url || ''))
        && !/\/wallpaper\.html(?:[?#]|$)/.test(String(t.url || ''))
        && !/startup\.html/.test(String(t.url || '')));
      if (target && target.webSocketDebuggerUrl) return target;
      // 记下当前所有 target 便于失败诊断
      lastErr = 'targets=' + JSON.stringify((list || []).map((t) => ({ type: t.type, url: String(t.url || '').slice(0, 120) })));
    } catch (e) { lastErr = e.message; }
    await sleep(150);
  }
  throw new Error('主窗口 CDP target 未出现。' + (lastErr || ''));
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-probe-'));
  const env = Object.assign({}, process.env);
  // 关键：删掉 ELECTRON_RUN_AS_NODE，否则 electron 会当 node 跑、窗口根本不出现
  delete env.ELECTRON_RUN_AS_NODE;

  const launch = resolveLaunch();
  const child = spawn(launch.command, launch.args.concat([
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
  ]), {
    cwd: launch.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 必须排空 stdout/stderr：管道写满会阻塞子进程，表现为全超时
  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout.on('data', (c) => { stdoutBuf += c.toString(); });
  child.stderr.on('data', (c) => { stderrBuf += c.toString(); });

  let exitInfo = null;
  child.on('exit', (code, signal) => { exitInfo = { code, signal }; });

  let client = null;
  const results = {};
  try {
    const target = await findMainTarget(60000);
    results.targetUrl = target.url;
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.call('Runtime.enable');

    // 等首屏渲染（bottom-bar 是宿主玻璃的主挂载点，存在即代表 index.html 跑起来了）
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() <= deadline) {
      ready = await client.evaluate(
        "!!(document.querySelector('#bottom-bar') && window.__MINERADIO_API_TOKEN__)"
      ).catch(() => false);
      if (ready) break;
      await sleep(250);
    }
    results.ready = ready;

    results.urlHasToken = /\btoken=/.test(String(target.url || ''));
    results.tokenLength = await client.evaluate('String(window.__MINERADIO_API_TOKEN__||"").length').catch(() => 0);
    results.hasBottomBar = await client.evaluate("!!document.querySelector('#bottom-bar')").catch(() => false);
    results.hasSearchBox = await client.evaluate("!!document.querySelector('#search-box')").catch(() => false);
    results.readyState = await client.evaluate('document.readyState').catch(() => '');
    results.title = await client.evaluate('document.title').catch(() => '');
    // 页面上是否出现过 403/UNAUTHORIZED（门禁误拦的典型表现）
    results.bodyTextHead = await client.evaluate('String(document.body&&document.body.innerText||"").slice(0,200)').catch(() => '');

    // 用页面里的 token 真打一次 /api/*，证明这个 token 是服务端认可的那一个
    results.apiProbe = await client.evaluate(`(async () => {
      const token = window.__MINERADIO_API_TOKEN__ || '';
      if (!token) return { ok: false, reason: 'no-token' };
      try {
        const r = await fetch('/api/login/status', { headers: { 'X-Mineradio-Token': token } });
        return { ok: r.status !== 403, status: r.status };
      } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
    })()`).catch((e) => ({ ok: false, reason: e.message }));
  } finally {
    if (client) client.close();
    try { child.kill(); } catch (_) {}
    // 等进程真的退，再清临时目录（Windows 上文件句柄没释放会删不掉）
    await sleep(2500);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('=== 启动 token 门禁探针 ===');
  console.log(JSON.stringify(Object.assign({}, results, {
    processExit: exitInfo,
    stderrTail: stderrBuf.slice(-1200),
  }), null, 2));

  const failures = [];
  if (!results.ready) failures.push('首屏未就绪（#bottom-bar 或 token 缺失）');
  if (!results.urlHasToken) failures.push('主窗口 URL 没带 token');
  if (!results.hasBottomBar) failures.push('#bottom-bar 不存在');
  if (!(results.tokenLength > 0)) failures.push('window.__MINERADIO_API_TOKEN__ 为空');
  if (!(results.apiProbe && results.apiProbe.ok)) failures.push('/api/* 探针失败：' + JSON.stringify(results.apiProbe));
  if (/UNAUTHORIZED|BAD_HOST/.test(String(results.bodyTextHead || ''))) failures.push('页面正文出现 UNAUTHORIZED/BAD_HOST');

  if (failures.length) {
    console.error('\n[FAIL] ' + failures.join(' | '));
    process.exitCode = 1;
  } else {
    console.log('\n[PASS] 主窗口带 token 正常进主页，token 可访问 /api/*');
  }
}

main().catch((e) => {
  console.error('[probe crashed]', e && (e.stack || e.message) || e);
  process.exitCode = 1;
});
