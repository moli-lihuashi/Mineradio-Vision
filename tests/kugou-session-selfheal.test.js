'use strict';

/* =============================================================================
 * 酷狗会话自愈（参照 Folia kugouApiBridge 的机制，server/kugou/http.js）
 *
 * 背景：上游会轮换 token、并对旧设备指纹抛 errcode 20028「本次请求需要验证」。
 * 旧行为：磁盘 cookie 只在登录时写一次、dfid 拿到一次永不刷新 —— 上游一旦轮换，
 * 之后每个请求都带旧凭据，概率性失败且永远无法自愈，直到用户重新登录。
 * （用户 2026-11 反复遇到「歌单加载不出来」的深层根源之一。）
 *
 * 现在要求：
 *   - 响应 Set-Cookie / body.data 里的新 token/userid/dfid 合并回 cookie 并落盘；
 *   - 合并必须以原 cookie 为底（KuGoo 复合值不能丢）；
 *   - 无新值不写盘；合并结果不能丢凭据；
 *   - 20028「需要验证」→ 强制重新 register_dev → 用新凭据重试一次；
 *   - 非 20028 错误不触发设备重注册；
 *   - captureSetCookie 不影响 requestText 的既有调用方。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const path = require('path');
const { EventEmitter } = require('events');

const appRoot = path.resolve(__dirname, '..');
const httpModulePath = require.resolve(path.join(appRoot, 'server/lib/http-request'));
const kugouHttpModulePath = require.resolve(path.join(appRoot, 'server/kugou/http'));

/* 每个用例重新加载 server/kugou/http.js（重置 dfid 缓存等模块级状态），
 * 并把 lib/http-request 顶替成可编程的假实现 —— 不发真网络请求。 */
function loadKugouHttp(fakeRequestText) {
  delete require.cache[kugouHttpModulePath];
  const saved = require.cache[httpModulePath];
  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      requestText: fakeRequestText,
      requestJson: async (u, o, b) => JSON.parse(await fakeRequestText(u, o, b)),
      isRetryableNetError: () => false,
      isTimeoutError: () => false,
    },
  };
  try {
    return require(kugouHttpModulePath);
  } finally {
    if (saved) require.cache[httpModulePath] = saved;
    else delete require.cache[httpModulePath];
  }
}

/* patch https.request 拦截 register_dev（设备注册走原生 https，不走 requestText） */
function patchRegisterDev() {
  const calls = [];
  const original = https.request;
  https.request = function (url, opts, cb) {
    calls.push({ url: String(url), opts });
    const res = new EventEmitter();
    res.headers = {};
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.end = () => {
      setImmediate(() => {
        cb(res);
        const body = JSON.stringify({ status: 1, data: { dfid: 'dfid-NEW-' + calls.length } });
        res.emit('data', Buffer.from(body, 'utf8'));
        res.emit('end');
      });
    };
    return req;
  };
  return {
    calls,
    restore() { https.request = original; },
  };
}

const BASE_COOKIE = 'KuGoo=KugooID%3D7%26t%3Dold-token%26NickName%3Dabc; token=old-token; userid=7; kg_mid=MID1; kg_dfid=OLD; dfid=OLD';

/* 假 requestText：队列消费；记录每次调用的 url/headers/body/captureSetCookie */
function makeFakeRequestText(queue) {
  const seen = [];
  const fn = async function requestTextFake(url, opts) {
    opts = opts || {};
    seen.push({ url: String(url), headers: opts.headers || {}, captureSetCookie: !!opts.captureSetCookie });
    const next = queue.shift();
    if (!next) throw new Error('FAKE_QUEUE_EMPTY');
    if (next.thrown) throw new Error(next.thrown);
    const text = JSON.stringify(next.json == null ? {} : next.json);
    if (opts.captureSetCookie) return { text, setCookie: next.setCookie || [] };
    return text;
  };
  fn.seen = seen;
  return fn;
}

test('20028「需要验证」→ 重新注册设备 → 用新凭据重试一次并成功', async () => {
  const reg = patchRegisterDev();
  try {
    const fake = makeFakeRequestText([
      { json: { status: 0, errcode: 20028, error: '本次请求需要验证' } },
      { json: { status: 1, data: { lists: [{ listid: 88 }] } } },
    ]);
    const mod = loadKugouHttp(fake);
    const json = await mod.kugouCloudlistRequest('/v7/get_all_list', { cookie: BASE_COOKIE, params: {} });
    assert.equal(json.status, 1, '自愈重试后应拿到成功响应');
    assert.equal(fake.seen.length, 2, 'cloudlist 必须恰好请求两次（初次 + 自愈重试），实际 ' + fake.seen.length);
    assert.ok(reg.calls.length >= 1, '必须重新调 register_dev');
    assert.ok(String(reg.calls[0].url).includes('/risk/v2/r_register_dev'));
    const retryCookie = fake.seen[1].headers.Cookie || '';
    assert.ok(retryCookie.includes('dfid-NEW-1'), '重试请求必须带新 dfid，实际 Cookie: ' + retryCookie);
  } finally { reg.restore(); }
});

test('非 20028 的网关错误不触发设备重注册，按原样抛出', async () => {
  const reg = patchRegisterDev();
  try {
    const fake = makeFakeRequestText([
      { json: { status: 0, errcode: 30951, error: '非会员限制' } },
    ]);
    const mod = loadKugouHttp(fake);
    await assert.rejects(() => mod.kugouCloudlistRequest('/v7/get_all_list', { cookie: BASE_COOKIE, params: {} }), /30951|非会员/);
    assert.equal(fake.seen.length, 1, '非风控错误不许重试');
    assert.equal(reg.calls.length, 0, '不许碰 register_dev');
  } finally { reg.restore(); }
});

test('errcode 20028 藏在 status=1 的响应里同样触发自愈', async () => {
  const reg = patchRegisterDev();
  try {
    const fake = makeFakeRequestText([
      { json: { status: 1, errcode: 20028, error: '本次请求需要验证' } },
      { json: { status: 1, data: { ok: 1 } } },
    ]);
    const mod = loadKugouHttp(fake);
    const json = await mod.kugouCloudlistRequest('/v7/get_all_list', { cookie: BASE_COOKIE, params: {} });
    assert.equal(json.status, 1);
    assert.equal(fake.seen.length, 2, '要自愈重试');
    assert.ok(reg.calls.length >= 1);
  } finally { reg.restore(); }
});

test('响应 Set-Cookie 轮换 token → 合并落盘，KuGoo 复合值保留', async () => {
  const saved = [];
  const fake = makeFakeRequestText([
    { json: { status: 1, data: {} }, setCookie: ['token=NEW-TOKEN; Path=/; HttpOnly'] },
  ]);
  const mod = loadKugouHttp(fake);
  mod.setKugouCookiePersistHook(function next(c) { saved.push(c); return c; });
  const json = await mod.kugouCloudlistRequest('/v7/get_all_list', { cookie: BASE_COOKIE, params: {} });
  assert.equal(json.status, 1);
  assert.equal(saved.length, 1, '有新 token 必须落盘一次');
  assert.ok(saved[0].includes('token=NEW-TOKEN'), '新 token 要进落盘内容');
  assert.ok(saved[0].includes('KuGoo='), 'KuGoo 复合值绝不能在合并时丢失');
  assert.ok(saved[0].includes('userid=7'), 'userid 保留');
});

test('业务响应 data.userid 是歌单作者 id，绝不能当成登录会话写回', async () => {
  const saved = [];
  const fake = makeFakeRequestText([
    { json: { status: 1, data: { userid: '999999', dfid: 'SOME-OTHER-DFID', count: 376 } } },
  ]);
  const mod = loadKugouHttp(fake);
  mod.setKugouCookiePersistHook(function next(c) { saved.push(c); return c; });
  await mod.kugouCloudlistRequest('/v4/get_list_all_file', { cookie: BASE_COOKIE, params: {} });
  assert.equal(saved.length, 0, '业务字段不该触发写盘，实际 ' + saved.length);
});

test('token 藏在 body.data 里（无 Set-Cookie）同样要落盘', async () => {
  const saved = [];
  const fake = makeFakeRequestText([
    { json: { status: 1, data: { token: 'BODY-TOKEN', userid: '7' } } },
  ]);
  const mod = loadKugouHttp(fake);
  mod.setKugouCookiePersistHook(function next(c) { saved.push(c); return c; });
  await mod.kugouCloudlistRequest('/v7/get_all_list', { cookie: BASE_COOKIE, params: {} });
  assert.equal(saved.length, 1);
  assert.ok(saved[0].includes('BODY-TOKEN'), 'body.data.token 要进落盘内容');
});

test('响应没有任何新凭据时不写盘', async () => {
  const saved = [];
  const fake = makeFakeRequestText([
    { json: { status: 1, data: { count: 2 } }, setCookie: ['sessionid=xyz; Path=/'] },
  ]);
  const mod = loadKugouHttp(fake);
  mod.setKugouCookiePersistHook(function next(c) { saved.push(c); return c; });
  await mod.kugouCloudlistRequest('/v7/get_all_list', { cookie: BASE_COOKIE, params: {} });
  assert.equal(saved.length, 0, '无关 cookie（sessionid）不值得写盘，实际写了 ' + saved.length);
});

test('invalidateKugouDfid 强制重新注册：cookie 里的旧 dfid 不再直接采信', async () => {
  const reg = patchRegisterDev();
  try {
    const fake = makeFakeRequestText([]);
    const mod = loadKugouHttp(fake);
    const persisted = [];
    mod.setKugouDfidPersistHook((dfid) => { persisted.push(dfid); });

    // 未失效：cookie 里已有 dfid=OLD → 直接采信，不注册
    const before = await mod.ensureKugouDfid(BASE_COOKIE);
    assert.equal(before, 'OLD', '正常路径直接用 cookie 里的 dfid');
    assert.equal(reg.calls.length, 0, '正常路径不该注册');

    // 20028 自愈路径：强制重新注册
    mod.invalidateKugouDfid();
    const after = await mod.ensureKugouDfid(BASE_COOKIE);
    assert.equal(after, 'dfid-NEW-1', '失效后必须重新注册拿新 dfid');
    assert.equal(reg.calls.length, 1);
    assert.deepEqual(persisted, ['dfid-NEW-1'], '新 dfid 要过持久化 hook');
  } finally { reg.restore(); }
});

/* requestText 的 captureSetCookie 开关：默认行为（返回字符串）不能变 */
test('captureSetCookie 开关：默认仍返回字符串，开启才返回 {text,setCookie}', async () => {
  const real = require(httpModulePath);
  const server = http.createServer((req, res) => {
    res.setHeader('Set-Cookie', 'token=FROM-SERVER; Path=/');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: 1 }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/x';
  try {
    const plain = await real.requestText(url, { timeoutMs: 3000 });
    assert.equal(typeof plain, 'string', '默认必须仍返回字符串');
    assert.equal(JSON.parse(plain).ok, 1);

    const captured = await real.requestText(url, { timeoutMs: 3000, captureSetCookie: true });
    assert.equal(typeof captured, 'object');
    assert.equal(JSON.parse(captured.text).ok, 1);
    assert.ok(Array.isArray(captured.setCookie) && captured.setCookie.some((c) => c.includes('FROM-SERVER')),
      '要捕获 Set-Cookie，实际 ' + JSON.stringify(captured.setCookie));
  } finally {
    server.close();
  }
});
