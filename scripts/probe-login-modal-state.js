'use strict';
/**
 * 真 Electron 探针：验证登录弹窗 provider 分支的状态类同步。
 *
 * 复现的 bug：汽水 / Spotify 分支在 updateLoginProviderUi() 里提前 return，
 * 而 `login-modal-logged-in` 的 toggle 原本在通用尾部 → 该类残留。
 * account.css 的 `.login-modal-logged-in .qr-shell{display:none!important}`
 * 会把二维码容器整个藏掉，表现为「标题正常、中间一片空白」。
 *
 * 探针不依赖真实汽水登录态：直接操作弹窗，验证类名与 qr-shell 的
 * computed display 在「模拟已登录 → 切到未登录」后能正确恢复。
 *
 * 用法：node scripts/probe-login-modal-state.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9333;

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout ' + urlPath)); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForDevtools(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await httpJson('/json/version');
      if (v && v.webSocketDebuggerUrl) return v;
    } catch (_) {}
    await delay(300);
  }
  throw new Error('CDP 端口未就绪（' + PORT + '）');
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(new Error('ws error: ' + (e && e.message || e)));
  });
}

let msgId = 0;
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ' → ' + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evalJs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r && r.exceptionDetails) {
    throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails));
  }
  return r && r.result ? r.result.value : undefined;
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('缺少打包产物:', EXE);
    process.exit(1);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-probe-'));
  console.log('userData:', userDataDir);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(EXE, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
  ], {
    cwd: path.dirname(EXE),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 必须排空 stdout/stderr，否则管道写满会让子进程整体卡死（本项目已踩过的坑）。
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let exitCode = 0;
  try {
    await waitForDevtools(40000);
    // 主窗口先停在 desktop/startup.html，再由主进程导航到 http://127.0.0.1:PORT/。
    // 必须等它导航完成，否则拿到的还是 startup 页（没有登录模块）。
    let page = null;
    const pageDeadline = Date.now() + 60000;
    while (Date.now() < pageDeadline) {
      const targets = await httpJson('/json/list');
      const list = targets || [];
      page = list.find(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url || ''));
      if (page) break;
      await delay(400);
    }
    if (!page) {
      const targets = await httpJson('/json/list');
      throw new Error('主窗口未导航到本地服务，现有: ' + JSON.stringify((targets || []).map(t => t.type + ' ' + t.url)));
    }

    const ws = await wsConnect(page.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable');

    // 等前端脚本就绪
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evalJs(ws, "typeof updateLoginProviderUi === 'function' && typeof setLoginProvider === 'function'");
      if (ready) break;
      await delay(300);
    }
    if (!ready) throw new Error('前端登录模块未就绪');

    // ---- 用例 1：模拟「其他平台已登录」→ 类被加上 → 切到汽水 → 类必须被清掉 ----
    const r1 = await evalJs(ws, `(function(){
      var modal = document.querySelector('#login-modal .dual-login-modal');
      if (!modal) return { error: 'no modal' };
      // 模拟已登录残留：手工加上类（等价于上次网易云/酷狗登录后留下的状态）
      modal.classList.add('login-modal-logged-in');
      loginProvider = 'qishui';
      // 让 renderLoginAccountCard 认为未登录
      qishuiLoginStatus = { loggedIn: false };
      updateLoginProviderUi();
      var shell = document.getElementById('qr-shell');
      var img = document.getElementById('qr-img');
      return {
        hasClass: modal.classList.contains('login-modal-logged-in'),
        shellDisplay: shell ? getComputedStyle(shell).display : 'no-shell',
        imgDisplay: img ? getComputedStyle(img).display : 'no-img',
        title: (document.getElementById('login-modal-title') || {}).textContent || '',
      };
    })()`);

    if (r1 && r1.error) throw new Error(r1.error);
    check('切到汽水（未登录）后 login-modal-logged-in 类被清除', r1.hasClass === false, 'hasClass=' + r1.hasClass);
    check('qr-shell 未被 display:none 隐藏', r1.shellDisplay !== 'none', 'display=' + r1.shellDisplay);
    check('qr-img 未被隐藏', r1.imgDisplay !== 'none', 'display=' + r1.imgDisplay);
    check('标题为未登录态', /扫码登录汽水音乐/.test(r1.title || ''), 'title=' + r1.title);

    // ---- 用例 2：模拟已登录 → 类必须被加上（确保修复没有把正向逻辑弄丢）----
    const r2 = await evalJs(ws, `(function(){
      var modal = document.querySelector('#login-modal .dual-login-modal');
      qishuiLoginStatus = { loggedIn: true, nickname: 'probe-user', webSession: true };
      updateLoginProviderUi();
      var shell = document.getElementById('qr-shell');
      return {
        hasClass: modal.classList.contains('login-modal-logged-in'),
        shellDisplay: shell ? getComputedStyle(shell).display : 'no-shell',
        title: (document.getElementById('login-modal-title') || {}).textContent || '',
        btnText: (document.getElementById('refresh-qr-btn') || {}).textContent || '',
      };
    })()`);
    check('汽水已登录时 login-modal-logged-in 类被加上', r2.hasClass === true, 'hasClass=' + r2.hasClass);
    check('已登录时 qr-shell 按设计隐藏', r2.shellDisplay === 'none', 'display=' + r2.shellDisplay);
    check('标题为已登录态', /汽水音乐已登录/.test(r2.title || ''), 'title=' + r2.title);
    check('按钮文案为「退出汽水」', /退出汽水/.test(r2.btnText || ''), 'btn=' + r2.btnText);

    // ---- 用例 3：Spotify 分支同样必须清掉该类 ----
    const r3 = await evalJs(ws, `(function(){
      var modal = document.querySelector('#login-modal .dual-login-modal');
      modal.classList.add('login-modal-logged-in');
      loginProvider = 'spotify';
      spotifyLoginStatus = { loggedIn: false, oauthConfigured: false };
      updateLoginProviderUi();
      return { hasClass: modal.classList.contains('login-modal-logged-in') };
    })()`);
    check('Spotify 分支也会清掉 login-modal-logged-in', r3.hasClass === false, 'hasClass=' + r3.hasClass);

    // ---- 用例 4：logoutLoginProvider 不再把 qishui 归一成 netease ----
    const r4 = await evalJs(ws, `(function(){
      // 直接读函数源码里的归一化行，验证 qishui 在白名单中
      var src = String(logoutLoginProvider);
      return {
        hasQishui: /'qishui'/.test(src.split('\\n').slice(0,4).join('\\n')),
        head: src.split('\\n').slice(0,4).join(' | ')
      };
    })()`);
    check('logoutLoginProvider 白名单含 qishui', r4.hasQishui === true, r4.head);

    // ---- 用例 5：rate_limited 后会安排延迟重试，且 stopQrPoll 会清掉它 ----
    const r5 = await evalJs(ws, `(function(){
      // 用一个假 token 走 checkQr 的汽水分支，桩掉 apiJson 返回 rate_limited
      var origApi = window.apiJson;
      var origProvider = loginProvider;
      var origToken = qishuiQrToken;
      var scheduled = false;
      var origSetTimeout = window.setTimeout;
      loginProvider = 'qishui';
      qishuiQrToken = 'probe-token';
      window.apiJson = function(){
        return Promise.resolve({ ok:false, loggedIn:false, status:'rate_limited', retryAfterMs: 5000 });
      };
      // 捕获 setTimeout 调用（不真正等待 5 秒）
      var captured = null;
      window.setTimeout = function(fn, ms){ captured = ms; return 12345; };
      return checkQr().then(function(){
        window.setTimeout = origSetTimeout;
        window.apiJson = origApi;
        var st = document.getElementById('qr-status');
        var text = st ? st.textContent : '';
        var out = { captured: captured, text: text };
        loginProvider = origProvider;
        qishuiQrToken = origToken;
        return out;
      });
    })()`);
    check('rate_limited 安排了延迟重试', typeof r5.captured === 'number' && r5.captured >= 5000, 'delay=' + r5.captured + 'ms');
    check('rate_limited 文案提示会自动重试', /自动重试/.test(r5.text || ''), 'text=' + r5.text);

    const r6 = await evalJs(ws, `(function(){
      qrRetryTimer = 999;
      stopQrPoll();
      return { after: qrRetryTimer };
    })()`);
    check('stopQrPoll 会清掉 qrRetryTimer', r6.after === null, 'qrRetryTimer=' + r6.after);

    ws.close();
  } catch (err) {
    console.error('\n探针异常:', err && err.message || err);
    exitCode = 1;
  } finally {
    try { child.kill(); } catch (_) {}
  }

  const failed = checks.filter(c => !c.ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed, ${checks.length} total`);
  if (failed > 0) exitCode = 1;
  process.exit(exitCode);
})();
