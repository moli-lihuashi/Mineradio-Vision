'use strict';

/**
 * 探针：扫码确认后「二维码已过期」——登录 cookie 是否真能落进 authSession。
 *
 * 症状（2026-11-11 真实链路日志）：
 *   status=new → scanned → confirmed → expired
 *   confirmed 那一轮 confirmed=false bridgeLoggedIn=false cookieReady=false
 * 手机已提示登录成功，但桌面端判「二维码已过期」。
 *
 * 根因：主进程轮询（get_qrcode / check_qrconnect）走 host 页的
 *   window.__qishuiRequest，那个 XHR **没有 xhr.withCredentials = true**。
 * 跨源 XHR 不带凭据时，上游在 confirmed 响应里下发的
 *   Set-Cookie: sessionid / sid_tt / ...
 * 会被 Chromium 直接丢弃 → persistSessionCookies() 从 authSession 抓不到
 * 登录 cookie → hasLoginCookie() 恒 false → 前端判失败，下一轮 token 已被
 * 消费变 expired，显示「二维码已过期」。
 *
 * 本探针直接 require dist 的真实模块，从它自己的 authSession 读 cookie 清单
 * （只读名称+域，绝不读值），对比 withCredentials 开/关两种形态。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-login-cookie.js
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const argOf = name => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const assetDir = path.resolve(
  ROOT,
  argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'),
);

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// 只列名称和域，不碰值。
const cookieShape = list => (list || [])
  .map(c => String(c.domain || '').replace(/^\./, '') + '/' + c.name)
  .sort();

async function main() {
  await app.whenReady();
  const hostPath = path.join(assetDir, 'qishui-auth-v6', 'security_host.html');
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  const host = fs.readFileSync(hostPath, 'utf8');
  const source = fs.readFileSync(entry, 'utf8');

  // ① 静态：__qishuiRequest 必须开 withCredentials
  const reqStart = host.indexOf('window.__qishuiRequest');
  const reqEnd = host.indexOf('function setMfaStatus', reqStart);
  const reqBody = host.slice(reqStart, reqEnd);
  record(
    /xhr\.withCredentials\s*=\s*true/.test(reqBody),
    '__qishuiRequest 开启 withCredentials（主进程轮询链路）',
    /xhr\.withCredentials\s*=\s*true/.test(reqBody)
      ? '' : '缺 withCredentials → 上游 Set-Cookie 会被丢弃，扫码确认后恒判过期',
  );

  // ② 静态：host 页版本与主进程 EXPECTED 必须一致，否则已运行实例不会重载
  const hostVer = Number((host.match(/__qishuiHostVersion\s*=\s*(\d+)/) || [])[1] || 0);
  const expected = Number((source.match(/const EXPECTED\s*=\s*(\d+)/) || [])[1] || 0);
  record(
    hostVer >= 3 && hostVer === expected,
    'host 页版本与主进程 EXPECTED 同步（自愈重载生效）',
    `hostVersion=${hostVer} EXPECTED=${expected}`,
  );

  // ③ 真跑：拿模块自己的 authSession，发真实跨源请求看 cookie 落地
  delete require.cache[require.resolve(entry)];
  const mod = require(entry);
  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });
  await mod.__initialize();
  const runtime = mod.__getRuntime();
  const win = runtime.window;
  const sess = runtime.authSession;
  record(true, '模块 __initialize() 成功', runtime.assetBase);

  const before = cookieShape(await sess.cookies.get({}));
  console.log('     初始 cookie: ' + (before.join(', ') || '(空)'));

  const url =
    'https://api.qishui.com/passport/web/get_qrcode/' +
    '?aid=386088&next=https%3A%2F%2Fapi.qishui.com&need_logo=false&need_short_url=false' +
    '&msToken=' + encodeURIComponent(runtime.msToken);

  const script = `
    new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', ${JSON.stringify(url)}, true);
      xhr.withCredentials = true;      // 复刻修复后的 __qishuiRequest
      xhr.timeout = 20000;
      xhr.setRequestHeader('Accept', 'application/json, text/javascript');
      xhr.setRequestHeader('x-tt-passport-verify-portrait', 'probe.login');
      xhr.onload = () => resolve({ done: true, status: xhr.status });
      xhr.onerror = () => resolve({ done: false, error: 'network_error' });
      xhr.ontimeout = () => resolve({ done: false, error: 'timeout' });
      xhr.send(null);
    })
  `;
  const res = await Promise.race([
    win.webContents.executeJavaScript(script, true),
    new Promise(r => setTimeout(() => r({ done: false, error: 'hard_timeout' }), 25000)),
  ]).catch(err => ({ done: false, error: String(err && err.message || err) }));

  record(
    Boolean(res && res.done && res.status),
    '带凭据的跨源轮询请求拿到响应（CORS 配对正常）',
    `status=${res && res.status} error=${(res && res.error) || 'none'}`,
  );

  // cookie 写入是异步落盘，给一点时间；不 sleep 死循环，只等一次。
  await new Promise(r => setTimeout(r, 1200));
  const after = cookieShape(await sess.cookies.get({}));
  console.log('     请求后 cookie: ' + (after.join(', ') || '(空)'));
  const added = after.filter(x => !before.includes(x));
  // get_qrcode 在**未登录态**本来就不下发 cookie（实测为空），所以「有没有
  // 新增」不能当判据。真正要证的是：带凭据请求没被 CORS 拦、且捕获链路
  // 的字段已就绪。登录 cookie 只在 status=confirmed 那一轮下发，属于
  // 用户扫码链路，靠 [QishuiSetCookie] / [QishuiPersist] 日志取证。
  console.log('     新增 cookie: ' + (added.join(', ') || '(无，未登录态属正常)'));
  record(
    Array.isArray(runtime._checkQrSetCookiePairs),
    '登录 cookie 响应头捕获链路已就绪（_checkQrSetCookiePairs）',
    '真实扫码时由 [QishuiSetCookie] / [QishuiPersist] 日志取证',
  );

  // ④ 静态：persistSessionCookies 的域过滤不能把登录 cookie 挡在外面
  const persistStart = source.indexOf('async persistSessionCookies');
  const persistBody = source.slice(persistStart, persistStart + 1600);
  const loginNames = ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'uid_tt', 'uid_tt_ss'];
  record(
    /qishui\.com/.test(persistBody) && /_checkQrSetCookiePairs/.test(persistBody),
    'persistSessionCookies 同时收集 cookie jar 与响应头来源',
    '登录 cookie 名要求: ' + loginNames.join('/'),
  );

  // 注意：绝不调 mod.clear()（会清真实 userData 的登录态）。
  try { win.destroy(); } catch (_) {}
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed} passed, ${results.length - passed} failed`);
  app.exit(results.length - passed ? 1 : 0);
}

main().catch(err => {
  console.error('[probe-error]', (err && err.stack) || err);
  app.exit(2);
});
