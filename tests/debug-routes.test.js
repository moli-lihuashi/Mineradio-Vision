'use strict';

/* =============================================================================
 * 诊断接口的联通性 — 行为测试（A 档 3 个 + B 档 2 个）
 * 用 sendJSON 桩直接跑真实 route matcher，断言返回结构与「只读」语义。
 * B 档的 self-check 会真打公网，所以注入 runner 桩；cache-prune 会真删文件，
 * 所以这里同时验证「GET 一律拒绝」这道闸。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const registerDebug = require(path.join(appRoot, 'server/routes/debug'));
const logBuffer = require(path.join(appRoot, 'server/lib/log-buffer'));
const { DEFAULT_HOSTS } = require(path.join(appRoot, 'server/lib/self-check'));

const calls = { prune: [], selfCheck: [] };
const ctx = {
  sendJSON(res, data, code) {
    res.payload = data;
    res.status = code || 200;
    res.writableEnded = true;
  },
  beatMapCacheLimitBytes: () => 512 * 1024 * 1024,
  async pruneBeatMapCache(options) {
    calls.prune.push(options);
    return {
      ok: true, dir: 'D:/beat-cache', scanned: 3, evicted: ['old.json'],
      removed: 1, bytesBefore: 300, bytesAfter: 200, limitBytes: options.limitBytes,
    };
  },
  async runSelfCheck(options) {
    calls.selfCheck.push(options);
    return {
      runtime: options.runtime,
      hosts: options.hosts.map(host => ({ host, dns: { addresses: [] } })),
      backend: options.backend,
      proxy: { env: {} },
    };
  },
};
const matcher = registerDebug(ctx);

async function call(pn, query, method) {
  const req = { method: method || 'GET', headers: {}, socket: { localPort: 8317 } };
  const res = {};
  const url = new URL('http://127.0.0.1' + pn + (query || ''));
  await matcher(req, res, url, pn);
  return res;
}

test.beforeEach(() => {
  calls.prune.length = 0;
  calls.selfCheck.length = 0;
});

test('装配诊断路由时日志缓冲已安装且默认开启', () => {
  assert.equal(logBuffer.getLogBuffer().isInstalled(), true);
  assert.equal(logBuffer.getLogBuffer().isEnabled(), true);
});

test('/api/debug/network 返回连接层记录与可疑音频清单', async () => {
  const res = await call('/api/debug/network', '?limit=5');
  assert.equal(res.status, 200);
  assert.equal(typeof res.payload.enabled, 'boolean');
  assert.ok(Array.isArray(res.payload.entries));
  assert.ok(Array.isArray(res.payload.suspiciousAudio));
  assert.ok(Array.isArray(res.payload.distrustedAudioKeys));
  assert.ok(res.payload.entries.length <= 5);
});

test('/api/debug/logs 返回已脱敏的运行日志缓冲', async () => {
  const res = await call('/api/debug/logs', '?limit=10');
  assert.equal(res.status, 200);
  assert.equal(res.payload.installed, true);
  assert.ok(Array.isArray(res.payload.entries));
  assert.ok(res.payload.entries.length <= 10);
});

test('/api/debug/build 返回构建溯源与 dist 一致性结论', async () => {
  const res = await call('/api/debug/build');
  assert.equal(res.status, 200);
  assert.ok(res.payload.dist && typeof res.payload.dist.present === 'boolean');
  assert.ok(Array.isArray(res.payload.files));
  assert.ok(Array.isArray(res.payload.hints));
  assert.ok(res.payload.commit !== undefined);
});

test('/api/debug/self-check 把本机监听端口与默认上游一起交给自检', async () => {
  const res = await call('/api/debug/self-check');
  assert.equal(res.status, 200);
  assert.equal(calls.selfCheck.length, 1);
  const opts = calls.selfCheck[0];
  assert.deepEqual(Array.from(opts.hosts), Array.from(DEFAULT_HOSTS));
  assert.equal(opts.runtime, 'server');
  assert.equal(opts.timeoutMs, 5000);
  assert.equal(opts.backend.status, 'running');
  assert.equal(opts.backend.port, 8317, '探测的是本次连接的实际监听端口');
  assert.equal(res.payload.runtime, 'server');
  assert.equal(res.payload.backend.port, 8317);
  assert.equal(res.payload.hosts.length, DEFAULT_HOSTS.length);
});

test('/api/debug/self-check 支持指定域名并把超时夹在 500~15000ms', async () => {
  const res = await call('/api/debug/self-check', '?hosts=gateway.kugou.com,%20y.qq.com&timeoutMs=99999');
  assert.equal(res.status, 200);
  assert.deepEqual(Array.from(calls.selfCheck[0].hosts), ['gateway.kugou.com', 'y.qq.com']);
  assert.equal(calls.selfCheck[0].timeoutMs, 15000);
  assert.equal(res.payload.hosts.length, 2);

  await call('/api/debug/self-check', '?timeoutMs=1');
  assert.equal(calls.selfCheck[1].timeoutMs, 500);
});

test('/api/debug/self-check 自检抛错时返回 500 且带原因，不泄漏堆栈', async () => {
  const original = ctx.runSelfCheck;
  ctx.runSelfCheck = async () => { throw new Error('probe exploded'); };
  try {
    const res = await call('/api/debug/self-check');
    assert.equal(res.status, 500);
    assert.equal(res.payload.error, 'SELF_CHECK_FAILED');
    assert.equal(res.payload.message, 'probe exploded');
  } finally {
    ctx.runSelfCheck = original;
  }
});

test('/api/debug/cache-prune 绝不接受 GET（地址栏 / 预取都不该删用户缓存）', async () => {
  const res = await call('/api/debug/cache-prune');
  assert.equal(res.status, 405);
  assert.equal(res.payload.error, 'METHOD_NOT_ALLOWED');
  assert.equal(calls.prune.length, 0, 'GET 一次都不能触发裁剪');
});

test('/api/debug/cache-prune 的 POST 走默认上限并原样回传裁剪结果', async () => {
  const res = await call('/api/debug/cache-prune', '', 'POST');
  assert.equal(res.status, 200);
  assert.equal(calls.prune.length, 1);
  assert.equal(calls.prune[0].limitBytes, 512 * 1024 * 1024);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.removed, 1);
  assert.equal(res.payload.bytesAfter, 200);
});

test('/api/debug/cache-prune 的 limitMb 换算成字节', async () => {
  const res = await call('/api/debug/cache-prune', '?limitMb=8', 'POST');
  assert.equal(res.status, 200);
  assert.equal(calls.prune[0].limitBytes, 8 * 1024 * 1024);
  assert.equal(res.payload.limitBytes, 8 * 1024 * 1024);
});

test('非诊断路径不写响应，交给后续 matcher', async () => {
  const res = await call('/api/kugou/user/playlists');
  assert.equal(res.payload, undefined);
  assert.equal(res.writableEnded, undefined);
});
