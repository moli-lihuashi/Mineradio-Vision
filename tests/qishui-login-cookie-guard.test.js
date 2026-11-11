'use strict';

/**
 * 守卫：扫码确认后不得再误判「二维码已过期」。
 *
 * 真实链路日志（2026-11-11 12:18）：
 *   status=new → scanned → confirmed → expired
 *   confirmed 那一轮 confirmed=false bridgeLoggedIn=false cookieReady=false
 * 手机已提示登录成功，桌面端却显示「二维码已过期」。
 *
 * 根因：
 *   主进程轮询（get_qrcode / check_qrconnect）走 host 页的
 *   window.__qishuiRequest，那个 XHR 没有 xhr.withCredentials = true。
 *   跨源 XHR 不带凭据 → 上游确认时下发的 Set-Cookie（sessionid / sid_tt）
 *   被 Chromium 丢弃 → persistSessionCookies() 抓不到登录 cookie →
 *   hasLoginCookie() 恒 false → 登录判失败 → 下一轮 token 已消费变 expired。
 *
 * 加固（第二来源）：Cookie 即使带凭据，跨站（127.0.0.1 → api.qishui.com）
 * 遇到 SameSite=Lax/Strict 仍可能被拒写进 cookie jar。因此主进程在
 * onHeadersReceived 里直接从 Set-Cookie 响应头留存 name=value，
 * persistSessionCookies() 会把它合并进去，不依赖 cookie jar。
 *
 * 本测试为纯静态断言；真实链路见 scripts/probe-qishui-login-cookie.js。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_AUTH = fs.readFileSync(path.join(ROOT, 'qishui-auth-v6.js'), 'utf8');
const RAW_HOST = fs.readFileSync(
  path.join(ROOT, 'qishui-auth-v6', 'security_host.html'), 'utf8',
);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const AUTH = stripComments(RAW_AUTH);

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log('ok   ' + name);
}

// ---- 1. 主进程轮询 XHR 必须带凭据 ----
ok('__qishuiRequest 设置 xhr.withCredentials = true', () => {
  const start = RAW_HOST.indexOf('window.__qishuiRequest');
  const end = RAW_HOST.indexOf('function setMfaStatus', start);
  assert.ok(start >= 0 && end > start, '必须能定位 __qishuiRequest');
  const body = stripComments(RAW_HOST.slice(start, end));
  assert.ok(
    /xhr\.withCredentials\s*=\s*true/.test(body),
    '不带凭据时上游 Set-Cookie 会被丢弃，扫码确认后恒判「二维码已过期」',
  );
});

// ---- 2. host 页版本必须与主进程 EXPECTED 同步 ----
ok('host 页版本 >= 3 且等于主进程 EXPECTED（自愈重载生效）', () => {
  const hostVer = Number((RAW_HOST.match(/__qishuiHostVersion\s*=\s*(\d+)/) || [])[1] || 0);
  const expected = Number((AUTH.match(/const EXPECTED\s*=\s*(\d+)/) || [])[1] || 0);
  assert.ok(hostVer >= 3, '改了 host 页主流程逻辑必须 +1 版本，否则已运行实例不重载');
  assert.strictEqual(hostVer, expected, 'hostVersion 与 EXPECTED 必须一致');
});

// ---- 3. 从响应头捕获 Set-Cookie ----
ok('onHeadersReceived 捕获 check_qrconnect 的 Set-Cookie 响应头', () => {
  assert.ok(
    /includes\(['"]\/passport\/web\/check_qrconnect\/['"]\)/.test(AUTH),
    '必须从 check_qrconnect 响应里留存登录 cookie（cookie jar 之外的独立来源）',
  );
  assert.ok(
    /key\.toLowerCase\(\)\s*!==\s*['"]set-cookie['"]/.test(AUTH),
    'Set-Cookie 头名必须按小写比较（上游可能用任意大小写）',
  );
  assert.ok(
    /_checkQrSetCookiePairs\s*=\s*pairs/.test(AUTH),
    '捕获结果必须写入 _checkQrSetCookiePairs 供 persistSessionCookies 使用',
  );
});

// ---- 4. 预检 OPTIONS 不得冲掉真值 ----
ok('捕获逻辑排除 OPTIONS 预检（空 Set-Cookie 会覆盖真值）', () => {
  const start = AUTH.indexOf("includes('/passport/web/check_qrconnect/')");
  const block = AUTH.slice(start, start + 400);
  assert.ok(
    /OPTIONS/.test(block),
    'check_qrconnect 的捕获条件必须排除 OPTIONS 预检',
  );
});

// ---- 5. persistSessionCookies 合并独立来源 ----
ok('persistSessionCookies 合并 _checkQrSetCookiePairs', () => {
  const start = AUTH.indexOf('async persistSessionCookies');
  const body = AUTH.slice(start, start + 1600);
  assert.ok(start >= 0, '必须存在 persistSessionCookies');
  assert.ok(
    /_checkQrSetCookiePairs/.test(body),
    '必须合并从响应头留存的 cookie，否则 SameSite 拒写时仍拿不到登录态',
  );
  assert.ok(
    /updateConfig\(\{\s*cookie/.test(body),
    '最终必须把 cookie 写回 config（桥接层 hasLoginCookie 依赖它）',
  );
});

// ---- 6. 新二维码清空旧轮次 cookie ----
ok('getQrCode 重置 _checkQrSetCookiePairs（不串轮次）', () => {
  const start = AUTH.indexOf('async getQrCode()');
  const body = AUTH.slice(start, start + 600);
  assert.ok(
    /_checkQrSetCookiePairs\s*=\s*\[\]/.test(body),
    '新二维码必须丢掉上一轮响应头 cookie，否则旧会话会被合并进新一轮',
  );
});

// ---- 7. 诊断日志只记名称不记值 ----
ok('诊断日志只记 cookie 名 / hasLogin，不记 cookie 值', () => {
  assert.ok(/\[QishuiSetCookie\]/.test(AUTH), '必须记录 Set-Cookie 捕获情况便于真实链路取证');
  assert.ok(/\[QishuiPersist\]/.test(AUTH), '必须记录最终是否含登录 cookie');
  const setBlock = AUTH.slice(
    AUTH.indexOf('[QishuiSetCookie]') - 400,
    AUTH.indexOf('[QishuiSetCookie]') + 200,
  );
  assert.ok(/names=/.test(setBlock), 'Set-Cookie 日志应只记 names');
  assert.ok(!/values?=/.test(setBlock), 'Set-Cookie 日志不得记录任何 cookie 值');
});

// ---- 8. 既有 CORS 修复不得被破坏 ----
ok('改动未破坏 Allow-Credentials / ACAO 收窄 / 小写名去重', () => {
  assert.ok(
    /headers\['Access-Control-Allow-Credentials'\]\s*=\s*\[\s*'true'\s*\]/.test(AUTH),
    'withCredentials 的 XHR 依赖 Allow-Credentials:true',
  );
  assert.ok(
    /headers\['Access-Control-Allow-Origin'\]\s*=\s*\[selfOrigin\]/.test(AUTH),
    'ACAO 必须继续收窄到 selfOrigin',
  );
  assert.ok(
    /startsWith\(['"]access-control-['"]\)/.test(AUTH),
    '小写名去重必须保留，否则 verify.zijieapi.com 双 ACAO 会让提交 Network Error',
  );
});

console.log('\n' + passed + ' passed, 0 failed');
