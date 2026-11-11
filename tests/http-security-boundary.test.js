'use strict';

/* =============================================================================
 * HTTP 边界的三个安全不变量 — 行为测试（真起 server，真发请求）
 *
 * 守的是三件容易在重构里被「顺手改回去」的事：
 *
 *  1. Host 头必须是环回字面量。这是 DNS rebinding 的唯一可靠判别点：
 *     攻击者域名 rebind 到 127.0.0.1 后，浏览器以 evil.com 的 origin 发请求，
 *     同源成立、响应可读，CORS 完全拦不住 —— 只有 Host 头还留着 evil.com。
 *     一旦这道闸被删，`GET /` 就能把明文 API_TOKEN 送到攻击者手里。
 *
 *  2. CORS 只回显「本服务自己的 origin」。以前是 /^http:\/\/127\.0\.0\.1:/，
 *     本机任意端口的页面（包括别的 dev server）都能读到带 ACAO 的响应。
 *
 *  3. `/` 与 `/index.html` 必须带 token。这两个是 token 的唯一出处
 *     （serveIndexHtml 把 API_TOKEN 明文注入 HTML），不设门禁 = 全站敞开。
 *
 * 反过来也要守住「别把正常路径一起关死」：渲染进程带 token 的导航必须 200。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appRoot = path.resolve(__dirname, '..');
const createMediaProxy = require(path.join(appRoot, 'server/lib/media-proxy'));

const TEST_TOKEN = 'test-token-0123456789abcdef0123456789abcdef';

/* ---------- 公共桩 ---------- */

function sendJSON(res, data, code) {
  const body = JSON.stringify(data);
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function buildServer(opts) {
  const options = opts || {};
  const createHttpServer = require(path.join(appRoot, 'server/lib/http-server'));
  const mediaProxy = createMediaProxy({
    dns: require('dns'),
    fetchWithTimeout: async () => { throw new Error('not used'); },
    UA: 'test',
    PROXY_FETCH_TIMEOUT_MS: 1000,
    API_AUTH_QUERY_TOKEN_PATHS: new Set(['/api/audio', '/api/cover']),
    getApiToken: () => TEST_TOKEN,
  });
  // 起在 0 端口让内核分配，避免与真实实例（3000）撞车。
  return createHttpServer({
    http,
    PORT: options.port || 0,
    HOST: '127.0.0.1',
    appRoot,
    routeCtx: {},
    routeMatchers: [],
    sendJSON,
    assertApiAuth: mediaProxy.assertApiAuth,
    serveStatic(res, filePath) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end('static:' + path.basename(filePath));
    },
    serveIndexHtml(res) {
      // 真实实现会把 API_TOKEN 明文注入 HTML —— 桩里同样注入，
      // 这样「门禁漏了就等于 token 泄漏」这件事在测试里也是真的。
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<script>window.__MINERADIO_API_TOKEN__=' + JSON.stringify(TEST_TOKEN) + ';</script>');
    },
    getUserCookie: () => '',
    getApiTokenAuto: () => false,
    getApiToken: () => TEST_TOKEN,
    nativeDjAvailable: false,
  });
}

let server;
let basePort;

test.before(async () => {
  const built = buildServer();
  server = built.server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  basePort = server.address().port;
  // http-server 内部用注入的 PORT 拼 URL 与 isOwnOrigin 判定，
  // 这里必须让 PORT 与真实监听端口一致，否则 origin 校验测不准。
  server.close();
  await new Promise(r => server.once('close', r));
  const rebuilt = buildServer({ port: basePort });
  server = rebuilt.server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(basePort, '127.0.0.1', resolve);
  });
});

test.after(async () => {
  if (server && server.listening) await new Promise(r => server.close(r));
});

/* 直接用 net 层写原始请求：Host 头必须能任意伪造，用 http.request 的
 * setHost:false + 手写 Host 更稳，但这里最省事的是传 headers.host。 */
function rawRequest(opts) {
  const options = opts || {};
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: basePort,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: Object.assign({}, options.headers || {}),
      setHost: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/* ---------- 1. Host 头白名单（DNS rebinding 防线）---------- */

test('Host 头是环回字面量才放行：127.0.0.1 / localhost 带 token 拿得到首页', async () => {
  for (const host of ['127.0.0.1:' + basePort, 'localhost:' + basePort]) {
    const res = await rawRequest({ path: '/?token=' + TEST_TOKEN, headers: { host } });
    assert.equal(res.status, 200, 'host=' + host + ' 应放行');
    assert.ok(res.body.includes(TEST_TOKEN), 'host=' + host + ' 应拿到注入页');
  }
});

test('Host 头是攻击者域名一律 403 BAD_HOST，且不泄漏 token', async () => {
  for (const host of ['evil.com', 'evil.com:' + basePort, 'attacker.example', '']) {
    const res = await rawRequest({ path: '/?token=' + TEST_TOKEN, headers: { host } });
    assert.equal(res.status, 403, 'host=' + JSON.stringify(host) + ' 必须被拒');
    assert.equal(JSON.parse(res.body).error, 'BAD_HOST');
    assert.ok(!res.body.includes(TEST_TOKEN), '拒绝响应里绝不能出现 token');
  }
});

test('Host 被拒时连 CORS 头都不发（不能给攻击者留读响应的一半条件）', async () => {
  const res = await rawRequest({
    path: '/?token=' + TEST_TOKEN,
    headers: { host: 'evil.com', origin: 'http://evil.com' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('IPv6 字面量 [::1] 视为环回', async () => {
  const res = await rawRequest({ path: '/?token=' + TEST_TOKEN, headers: { host: '[::1]:' + basePort } });
  assert.equal(res.status, 200);
});

test('Host 头缺失同样 fail-closed（不静默放行）', async () => {
  const res = await rawRequest({ path: '/?token=' + TEST_TOKEN, headers: {} });
  /* HTTP/1.1 的 Host 是必需头，Node 的解析层会先于我们的门禁拒掉（clientError → 400）。
   * 也就是说这条路径有两道闸，谁先拦都算 fail-closed —— 断言「被拒」而不是死盯 403，
   * 否则 Node 版本换了拦截层就会误报。 */
  assert.ok(res.status === 400 || res.status === 403, '无 Host 必须被拒，实际 ' + res.status);
  assert.ok(!res.body.includes(TEST_TOKEN), '拒绝响应里绝不能出现 token');
});

/* ---------- 2. CORS 只回显本服务 origin ---------- */

test('CORS 回显本服务自己的 origin', async () => {
  const origin = 'http://127.0.0.1:' + basePort;
  const res = await rawRequest({
    path: '/api/ping',
    headers: { host: '127.0.0.1:' + basePort, origin, 'x-mineradio-token': TEST_TOKEN },
  });
  assert.equal(res.headers['access-control-allow-origin'], origin);
});

test('CORS 不回显别的环回端口（本机其它页面读不到）', async () => {
  const res = await rawRequest({
    path: '/api/ping',
    headers: {
      host: '127.0.0.1:' + basePort,
      origin: 'http://127.0.0.1:5173',
      'x-mineradio-token': TEST_TOKEN,
    },
  });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('CORS 不回显外部 origin', async () => {
  const res = await rawRequest({
    path: '/api/ping',
    headers: { host: '127.0.0.1:' + basePort, origin: 'https://evil.com' },
  });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

/* ---------- 3. 首页 token 门禁 ---------- */

test('GET / 无 token → 403，且不注入 token', async () => {
  const res = await rawRequest({ path: '/', headers: { host: '127.0.0.1:' + basePort } });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error, 'UNAUTHORIZED');
  assert.ok(!res.body.includes(TEST_TOKEN));
});

test('GET /index.html 无 token → 403（换个路径不能绕过）', async () => {
  const res = await rawRequest({ path: '/index.html', headers: { host: '127.0.0.1:' + basePort } });
  assert.equal(res.status, 403);
  assert.ok(!res.body.includes(TEST_TOKEN));
});

test('GET / 带错误 token → 403', async () => {
  const res = await rawRequest({ path: '/?token=wrong-token-value', headers: { host: '127.0.0.1:' + basePort } });
  assert.equal(res.status, 403);
  assert.ok(!res.body.includes(TEST_TOKEN));
});

test('GET / 带正确 token → 200 且注入 token（渲染进程的正常路径不能被关死）', async () => {
  const res = await rawRequest({ path: '/?token=' + TEST_TOKEN, headers: { host: '127.0.0.1:' + basePort } });
  assert.equal(res.status, 200);
  assert.ok(res.body.includes(TEST_TOKEN));
});

test('非首页静态资源不受 token 门禁影响（CSS/JS 不该被拦）', async () => {
  const res = await rawRequest({ path: '/css/index.css', headers: { host: '127.0.0.1:' + basePort } });
  assert.equal(res.status, 200);
  assert.ok(res.body.startsWith('static:'));
});

/* ---------- 4. /api/* 鉴权：常量时间比较 + fail-closed ---------- */

test('/api/* 无 token → 403', async () => {
  const res = await rawRequest({ path: '/api/anything', headers: { host: '127.0.0.1:' + basePort } });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error, 'UNAUTHORIZED');
});

test('/api/* header token 正确 → 通过', async () => {
  const res = await rawRequest({
    path: '/api/anything',
    headers: { host: '127.0.0.1:' + basePort, 'x-mineradio-token': TEST_TOKEN },
  });
  assert.notEqual(res.status, 403);
});

test('assertApiAuth 用常量时间比较，且空 token / 空期望值一律拒绝', () => {
  const mediaProxy = createMediaProxy({
    dns: require('dns'),
    fetchWithTimeout: async () => { throw new Error('not used'); },
    UA: 'test',
    PROXY_FETCH_TIMEOUT_MS: 1000,
    API_AUTH_QUERY_TOKEN_PATHS: new Set(['/api/audio']),
    getApiToken: () => TEST_TOKEN,
  });
  const sp = new URLSearchParams('');
  // 无 token
  assert.equal(mediaProxy.assertApiAuth({ headers: {} }, '/api/x', sp), false);
  // 长度不等（长度本身不是秘密，直接 false 不比较）
  assert.equal(mediaProxy.assertApiAuth({ headers: { 'x-mineradio-token': 'short' } }, '/api/x', sp), false);
  // 等长但不同
  const sameLenWrong = 'x'.repeat(TEST_TOKEN.length);
  assert.equal(mediaProxy.assertApiAuth({ headers: { 'x-mineradio-token': sameLenWrong } }, '/api/x', sp), false);
  // 正确
  assert.equal(mediaProxy.assertApiAuth({ headers: { 'x-mineradio-token': TEST_TOKEN } }, '/api/x', sp), true);
  // 非 /api/ 路径不需要鉴权
  assert.equal(mediaProxy.assertApiAuth({ headers: {} }, '/css/index.css', sp), true);

  // getApiToken 返回空 → 即使 token 也空也拒绝（fail-closed）
  const emptyExpected = createMediaProxy({
    dns: require('dns'),
    fetchWithTimeout: async () => { throw new Error('not used'); },
    UA: 'test',
    PROXY_FETCH_TIMEOUT_MS: 1000,
    API_AUTH_QUERY_TOKEN_PATHS: new Set(),
    getApiToken: () => '',
  });
  assert.equal(emptyExpected.assertApiAuth({ headers: { 'x-mineradio-token': '' } }, '/api/x', sp), false);
});

test('assertApiAuth 源码里不再有直接 === 比较 token', () => {
  // 静态守卫：常量时间比较一旦被改回 ===，上面的行为测试仍可能全过
  // （功能等价），但侧信道会回来。这条直接盯源码。
  const src = fs.readFileSync(path.join(appRoot, 'server/lib/media-proxy.js'), 'utf8');
  assert.ok(/crypto\.timingSafeEqual/.test(src), '必须使用 crypto.timingSafeEqual');
  const body = src.slice(src.indexOf('function assertApiAuth'), src.indexOf('function audioProxyHeadersFor'));
  assert.ok(!/token\s*===\s*expected|expected\s*===\s*token/.test(body), 'assertApiAuth 不得用 === 比较 token');
});

/* ---------- 5. 主进程导航必须带 token（否则启动白屏）---------- */

test('主进程 loadMainWindowWithRetry 的导航 URL 必须带 token', () => {
  const src = fs.readFileSync(path.join(appRoot, 'desktop/main.js'), 'utf8');
  const start = src.indexOf('async function loadMainWindowWithRetry');
  assert.ok(start > 0, '找不到 loadMainWindowWithRetry');
  const body = src.slice(start, start + 2000);
  assert.ok(/token=/.test(body) || /tokenQuery/.test(body), '导航 URL 必须拼 token，否则首页 403 → 启动白屏');
});

/* ---------- 6. 插件 pending 机制（求值即执行 → 显式启用才执行）---------- */

test('插件加载不再无条件 eval 磁盘上的每个 .js', () => {
  const src = fs.readFileSync(
    path.join(appRoot, 'public/js/modules/06-fx/04-liquidglass-plugin-api.js'), 'utf8');
  const start = src.indexOf('async function loadDesktopLiquidGlassPlugins');
  assert.ok(start > 0, '找不到 loadDesktopLiquidGlassPlugins');
  const body = src.slice(start, src.indexOf('if (typeof document !== \'undefined\')', start));
  // 允许在 enabledMap[id] 为真时求值，但绝不能出现「forEach 里直接 eval」
  assert.ok(/registerPendingPlugin/.test(body), '首次发现必须走 pending 登记（只登记不执行）');
  const evalCount = (body.match(/evalPluginSource\(/g) || []).length;
  assert.ok(evalCount <= 1, '每个插件最多求值一次，重复求值会重跑 registerPlugin 挂第二套玻璃');
});

test('setPluginEnabled 对 pending 插件先求值再启用，且不重复跑 setup', () => {
  const src = fs.readFileSync(
    path.join(appRoot, 'public/js/modules/06-fx/04-liquidglass-plugin-api.js'), 'utf8');
  const start = src.indexOf('function setPluginEnabled');
  const body = src.slice(start, src.indexOf('function getPerf'));
  assert.ok(/\.pending/.test(body), '必须处理 pending 分支');
  assert.ok(/evalPluginSource/.test(body), 'pending 插件必须先求值才能拿到 setup');
  // 求值后 registerPlugin 已按 enabledMap 跑过 setup；这里必须提前 return，
  // 否则同一块 root 挂两套玻璃，帧率与延迟翻倍。
  assert.ok(/return enabledMap\[id\] !== false/.test(body), 'pending 求值后必须提前返回，避免 setup 跑两遍');
});
