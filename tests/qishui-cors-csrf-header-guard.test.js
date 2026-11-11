'use strict';

/**
 * 守卫：汽水二次验证组件「提交全部 Network Error」不得回归。
 *
 * 症状（2026-11-11 用户三张截图）：
 *   验证窗口里「发送短信」那一步成功（页面显示「短信已发送至 192******77」），
 *   但之后所有提交动作——输入验证码点「验证」、上行短信点「我已发送」、
 *   密码验证点「验证」——全部报 Network Error。
 *
 * 根因：
 *   组件 index.umd.production.js 内 axios 硬编码
 *     withCredentials:!0,
 *     xsrfCookieName:"passport_csrf_token",
 *     xsrfHeaderName:"x-tt-passport-csrf-token"
 *   它会发出 5 个自定义头，而主进程 CORS 注入的 Allow-Headers 白名单
 *   当时只有 2 个，漏了 x-tt-passport-csrf-token / x-tt-logid /
 *   x-tt-passport-aid-sign。预检失败 → 提交被判 Network Error。
 *   「发送成功、提交失败」的差异来自 xsrf：首次请求还没有
 *   passport_csrf_token cookie，axios 不加 CSRF 头，预检能过；服务端下发
 *   cookie 之后每次提交都带，于是全挂。
 *
 * 本测试是纯静态断言（不启动 Electron），防止白名单被删减、或有人把
 * 「回显预检请求头」的无效写法加回来。
 * 真实链路验证见 scripts/probe-qishui-cors-csrf-header.js（5 项）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_SOURCE = fs.readFileSync(path.join(ROOT, 'qishui-auth-v6.js'), 'utf8');

// 注释里会引用旧写法/旧清单作为说明，断言只看真实代码。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const SOURCE = stripComments(RAW_SOURCE);

// 官方产物里实际会发出的自定义头全集。来源：
//   grep -o "x-tt-[a-z-]\{2,40\}" index.umd.production.js | sort -u
const COMPONENT_HEADERS = [
  'x-tt-passport-verify-portrait',
  'x-tt-passport-trace-id',
  'x-tt-passport-csrf-token',
  'x-tt-logid',
  'x-tt-passport-aid-sign',
];

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log('ok   ' + name);
}

// ---- 1. 白名单必须覆盖组件全部自定义头 ----
ok('ALLOWED_CORS_REQUEST_HEADERS 覆盖组件全部 5 个自定义头', () => {
  const match = SOURCE.match(/ALLOWED_CORS_REQUEST_HEADERS\s*=\s*([\s\S]*?);/);
  assert.ok(match, '必须存在 ALLOWED_CORS_REQUEST_HEADERS 定义');
  const text = match[1].toLowerCase();
  const missing = COMPONENT_HEADERS.filter(h => !text.includes(h));
  assert.deepStrictEqual(
    missing,
    [],
    'Allow-Headers 白名单缺 ' + missing.join(', ') +
    '；这些头的预检会失败，页面表现为提交时 Network Error',
  );
});

// ---- 2. xsrf 头必须显式在列（单独点名，防止被合并写法吞掉） ----
ok('白名单显式包含 axios xsrfHeaderName（x-tt-passport-csrf-token）', () => {
  const match = SOURCE.match(/ALLOWED_CORS_REQUEST_HEADERS\s*=\s*([\s\S]*?);/);
  assert.ok(match, '必须存在 ALLOWED_CORS_REQUEST_HEADERS 定义');
  assert.ok(
    match[1].toLowerCase().includes('x-tt-passport-csrf-token'),
    '组件 axios 配置了 xsrfHeaderName:"x-tt-passport-csrf-token"，' +
    '服务端下发 passport_csrf_token 后每次提交都会带它，必须在白名单里',
  );
});

// ---- 3. 不得依赖 details.requestHeaders 回显 ----
ok('onHeadersReceived 不读 details.requestHeaders（Electron 不提供该字段）', () => {
  const start = SOURCE.indexOf('onHeadersReceived');
  const end = SOURCE.indexOf('onBeforeSendHeaders');
  assert.ok(start >= 0 && end > start, '必须能定位 onHeadersReceived 段');
  const segment = SOURCE.slice(start, end);
  assert.ok(
    !/details\.requestHeaders/.test(segment),
    'OnHeadersReceivedListenerDetails 没有 requestHeaders 字段，' +
    '读它恒为 undefined，只会静默退回白名单（历史故障就是这么来的）',
  );
});

// ---- 4. Allow-Headers 必须无条件写全量白名单 ----
ok('Allow-Headers 直接赋全量白名单，不设条件回退', () => {
  const match = SOURCE.match(
    /headers\['Access-Control-Allow-Headers'\]\s*=\s*\[\s*ALLOWED_CORS_REQUEST_HEADERS\s*\]/,
  );
  assert.ok(
    match,
    "必须写成 headers['Access-Control-Allow-Headers'] = [ALLOWED_CORS_REQUEST_HEADERS]，" +
    '不能用 `requested || ALLOWED_CORS_REQUEST_HEADERS` 这种恒走兜底的条件写法',
  );
});

// ---- 5. 白名单只增不减：原有 4 个自定义头必须保留 ----
ok('原有自定义头未被删减（verify-portrait / trace-id / tt-trace-id / ss-stub）', () => {
  const match = SOURCE.match(/ALLOWED_CORS_REQUEST_HEADERS\s*=\s*([\s\S]*?);/);
  assert.ok(match, '必须存在 ALLOWED_CORS_REQUEST_HEADERS 定义');
  const text = match[1].toLowerCase();
  ['x-tt-passport-verify-portrait', 'x-tt-passport-trace-id', 'x-tt-trace-id', 'x-ss-stub']
    .forEach(h => assert.ok(text.includes(h), '白名单不得删掉既有头 ' + h));
});

// ---- 6. ACAO 仍收窄（避免为了修这个洞而放开 *） ----
ok('ACAO 仍收窄到 selfOrigin，没有为修预检而放开通配', () => {
  assert.ok(
    /headers\['Access-Control-Allow-Origin'\]\s*=\s*\[selfOrigin\]/.test(SOURCE),
    'ACAO 必须继续收窄到 selfOrigin；放开 * 会与 Allow-Credentials 构成非法组合',
  );
  assert.ok(
    !/headers\['Access-Control-Allow-Origin'\]\s*=\s*\[\s*'\*'\s*\]/.test(SOURCE),
    '不得把 ACAO 改成通配 *',
  );
});

// ---- 7. Allow-Credentials 必须仍在（与 ACAO 收窄共存亡） ----
ok("Allow-Credentials 仍为 ['true']（组件 withCredentials 硬编码）", () => {
  assert.ok(
    /headers\['Access-Control-Allow-Credentials'\]\s*=\s*\[\s*'true'\s*\]/.test(SOURCE),
    '组件内 axios 硬编码 withCredentials:true，缺 Allow-Credentials 会整片 Network Error',
  );
});

// ---- 8. 注入前必须按小写名清掉上游自带的 CORS 头 ----
// 实测 verify.zijieapi.com 的预检响应上游自带
// `access-control-allow-origin: *`（小写键）。只写大写键的
// `Access-Control-Allow-Origin` 会留下两个 ACAO，浏览器合并成
// 「origin, *」→ 带 credentials 的 CORS 判定失败 → 提交 Network Error。
// 这是与白名单缺头**独立**的第二个根因：api.qishui.com 不带上游 ACAO
// 所以能通，verify.zijieapi.com 全挂。
ok('注入前按小写名删除上游自带的 access-control-* / Vary 头', () => {
  const start = SOURCE.indexOf('onHeadersReceived');
  const end = SOURCE.indexOf('onBeforeSendHeaders');
  const segment = SOURCE.slice(start, end);
  assert.ok(
    /toLowerCase\(\)/.test(segment) && /startsWith\(['"]access-control-['"]\)/.test(segment),
    '必须遍历响应头、按小写名删除上游自带的 access-control-* 头，' +
    '否则 verify.zijieapi.com 会出现两个 ACAO 导致预检失败',
  );
  assert.ok(
    /delete\s+headers\[key\]/.test(segment),
    '必须真的删掉旧键，只写新键不够',
  );
});

// ---- 9. 清理必须发生在写 ACAO 之前 ----
ok('去重清理在写 Access-Control-Allow-Origin 之前执行', () => {
  const start = SOURCE.indexOf('onHeadersReceived');
  const end = SOURCE.indexOf('onBeforeSendHeaders');
  const segment = SOURCE.slice(start, end);
  const del = segment.indexOf('delete headers[key]');
  const set = segment.indexOf("headers['Access-Control-Allow-Origin']");
  assert.ok(del >= 0 && set >= 0, '必须同时存在清理与赋值');
  assert.ok(del < set, '先清后写；先写后清会把刚注入的 ACAO 也删掉');
});

console.log('\n' + passed + ' passed, 0 failed');
