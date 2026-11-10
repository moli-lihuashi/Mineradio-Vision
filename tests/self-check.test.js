'use strict';

/* =============================================================================
 * B1 分层网络自检 — 行为测试
 *
 * 真跑 probeLocalBackend（起真实本地 HTTP server），DNS/TCP/TLS/HTTPS 用注入的
 * 假实现，断言的是「结论落在哪一层」这件事本身：TCP 挂 / TLS 挂 / DNS 挂
 * 必须给出三种不同的结果，否则这份自检没有诊断价值。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');

const appRoot = path.resolve(__dirname, '..');
const selfCheck = require(path.join(appRoot, 'server/lib/self-check'));

function startServer(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* 手写 tls 替身：按 outcomes 指定每次握手断在 tcp / tls，还是成功。 */
function fakeTls(outcomes) {
  const calls = [];
  return {
    calls,
    connect(options) {
      const index = calls.length;
      calls.push(options);
      const socket = new EventEmitter();
      socket.destroyed = false;
      socket.destroy = () => { socket.destroyed = true; };
      socket.getProtocol = () => 'TLSv1.3';
      const plan = outcomes[index] || outcomes[outcomes.length - 1] || {};
      setImmediate(() => {
        if (plan.failAt === 'tcp') {
          socket.emit('error', Object.assign(new Error('reset by peer'), { code: 'ECONNRESET' }));
          return;
        }
        socket.emit('connect');
        setImmediate(() => {
          if (plan.failAt === 'tls') {
            socket.emit('error', Object.assign(new Error('bad certificate'), { code: 'CERT_HAS_EXPIRED' }));
            return;
          }
          socket.emit('secureConnect');
        });
      });
      return socket;
    },
  };
}

function fakeHttps(mode) {
  const calls = [];
  return {
    calls,
    get(options, callback) {
      calls.push(options);
      const request = new EventEmitter();
      request.destroyed = false;
      request.destroy = () => { request.destroyed = true; };
      setImmediate(() => {
        if (mode === 'fail') {
          request.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
          return;
        }
        const response = new EventEmitter();
        response.statusCode = 200;
        // 服务器时间比本机慢 4 秒 → clockSkewMs 应该约等于 +4000
        response.headers = { date: new Date(Date.now() - 4000).toUTCString() };
        response.socket = { remoteAddress: '203.0.113.9', remoteFamily: 'IPv4' };
        response.resume = () => {};
        callback(response);
      });
      return request;
    },
  };
}

const lookupOk = addresses => async () => addresses.map(a => ({
  address: a.address, family: a.family,
}));

test('198.18/15 判为 fake-ip（TUN 代理接管网络层），其余地址不算', () => {
  assert.equal(selfCheck.isFakeIp('198.18.0.7'), true);
  assert.equal(selfCheck.isFakeIp('198.19.255.1'), true);
  assert.equal(selfCheck.isFakeIp('198.20.0.1'), false);
  assert.equal(selfCheck.isFakeIp('8.8.8.8'), false);
  assert.equal(selfCheck.isFakeIp(''), false);
  assert.equal(selfCheck.isFakeIp(null), false);
});

test('代理地址里的账号密码被抹掉，主机端口保留', () => {
  assert.equal(
    selfCheck.maskProxyCredentials('http://user:secret@127.0.0.1:7890'),
    'http://***@127.0.0.1:7890');
  const env = selfCheck.readProxyEnv({
    HTTPS_PROXY: 'http://u:p@10.0.0.2:1080',
    NO_PROXY: 'localhost,127.0.0.1',
  });
  assert.equal(env.HTTPS_PROXY, 'http://***@10.0.0.2:1080');
  assert.ok(!JSON.stringify(env).includes('u:p@'));
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1');
  assert.deepEqual(selfCheck.readProxyEnv({}), {});
});

test('本机后端探测：真实 server 算活，闭端口算死且带错误码', async () => {
  const server = await startServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  try {
    const alive = await selfCheck.probeLocalBackend({ port: server.address().port });
    assert.equal(alive.ok, true);
    assert.equal(alive.httpStatus, 200);
    assert.equal(alive.error, null);
    assert.equal(typeof alive.durationMs, 'number');
  } finally { server.close(); }

  const dead = await selfCheck.probeLocalBackend({ port: 1, timeoutMs: 1500 });
  assert.equal(dead.ok, false);
  assert.ok(dead.error && dead.error.code, '必须带回 ECONNREFUSED 之类的错误码');
});

test('TCP 阶段失败与 TLS 阶段失败分得清', async () => {
  const tcpFail = fakeTls([{ failAt: 'tcp' }]);
  const a = await selfCheck.probeTlsHandshake({
    host: 'gateway.kugou.com', address: '203.0.113.1', family: 4, tlsModule: tcpFail,
  });
  assert.equal(a.error.phase, 'tcp');
  assert.equal(a.error.code, 'ECONNRESET');
  assert.equal(a.tcpMs, null, '没连上就不该有 TCP 耗时');
  assert.equal(a.tlsMs, null);

  const tlsFail = fakeTls([{ failAt: 'tls' }]);
  const b = await selfCheck.probeTlsHandshake({
    host: 'gateway.kugou.com', address: '203.0.113.1', family: 4, tlsModule: tlsFail,
  });
  assert.equal(b.error.phase, 'tls');
  assert.equal(b.error.code, 'CERT_HAS_EXPIRED');
});

test('握手成功时 TCP / TLS 两段耗时都在，servername 用的是域名', async () => {
  const tls = fakeTls([{}]);
  const result = await selfCheck.probeTlsHandshake({
    host: 'gateway.kugou.com', address: '203.0.113.1', family: 4, tlsModule: tls,
  });
  assert.equal(result.error, null);
  assert.equal(typeof result.tcpMs, 'number');
  assert.equal(typeof result.tlsMs, 'number');
  assert.equal(result.protocol, 'TLSv1.3');
  assert.equal(tls.calls[0].servername, 'gateway.kugou.com');
  assert.equal(tls.calls[0].port, 443);
});

test('单域名探测：v4 / v6 各测一次，HTTPS 用 Date 头算时钟偏差', async () => {
  const tls = fakeTls([{}]);
  const https = fakeHttps('ok');
  const result = await selfCheck.probeHost({
    host: 'y.qq.com',
    lookup: lookupOk([{ address: '203.0.113.1', family: 4 }, { address: '2001:db8::1', family: 6 }]),
    tlsModule: tls,
    httpsModule: https,
  });
  assert.equal(result.host, 'y.qq.com');
  assert.equal(result.dns.addresses.length, 2);
  assert.equal(result.dns.fakeIp, false);
  assert.deepEqual(result.connections.map(c => c.family), [4, 6], '两个地址族都要测');
  assert.ok(Math.abs(result.https.clockSkewMs - 4000) < 1500,
    '时钟偏差应接近 4000ms，实际 ' + result.https.clockSkewMs);
  assert.equal(result.https.remote.address, '203.0.113.9');
});

test('DNS 直接失败时不再发 HTTPS 请求（避免把 DNS 问题误报成 HTTP 问题）', async () => {
  const https = fakeHttps('ok');
  const result = await selfCheck.probeHost({
    host: 'music.163.com',
    lookup: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); },
    tlsModule: fakeTls([{}]),
    httpsModule: https,
  });
  assert.equal(result.dns.error.code, 'ENOTFOUND');
  assert.equal(result.dns.error.phase, 'dns');
  assert.deepEqual(result.connections, []);
  assert.equal(result.https, null);
  assert.equal(https.calls.length, 0, 'DNS 挂了就不该再打 HTTPS');
});

test('一次自检的分层结构完整：后端 / 代理 / 每个域名三段', async () => {
  const server = await startServer((_req, res) => { res.writeHead(404); res.end('nope'); });
  try {
    const report = await selfCheck.runSelfCheck({
      hosts: ['gateway.kugou.com'],
      runtime: 'server',
      backend: { status: 'running', port: server.address().port, error: null },
      env: { HTTPS_PROXY: 'http://u:p@127.0.0.1:7890' },
      lookup: lookupOk([{ address: '203.0.113.1', family: 4 }]),
      tlsModule: fakeTls([{}]),
      httpsModule: fakeHttps('ok'),
      now: () => 1000,
    });
    assert.equal(report.runtime, 'server');
    assert.equal(report.backend.status, 'running');
    assert.equal(report.backend.probe.ok, true);
    assert.equal(report.backend.probe.httpStatus, 404, '404 也说明后端在听');
    assert.equal(report.proxy.env.HTTPS_PROXY, 'http://***@127.0.0.1:7890');
    assert.equal(report.proxy.system, null, '没注入 resolveSystemProxy 时不该瞎猜');
    assert.equal(report.hosts.length, 1);
    assert.equal(report.hosts[0].dns.addresses[0].address, '203.0.113.1');
    assert.equal(typeof report.durationMs, 'number');
  } finally { server.close(); }
});

test('后端不是 running 时不做本机探测，只如实上报状态', async () => {
  const report = await selfCheck.runSelfCheck({
    hosts: ['api.spotify.com'],
    backend: { status: 'starting', port: 8317, error: null },
    lookup: lookupOk([{ address: '203.0.113.1', family: 4 }]),
    tlsModule: fakeTls([{}]),
    httpsModule: fakeHttps('ok'),
  });
  assert.equal(report.backend.status, 'starting');
  assert.equal(report.backend.probe, null);
  assert.equal(report.backend.port, 8317);
});

test('系统代理解析抛错时降级成 unavailable 字符串，不让整轮自检失败', async () => {
  const report = await selfCheck.runSelfCheck({
    hosts: ['gateway.kugou.com'],
    lookup: lookupOk([{ address: '203.0.113.1', family: 4 }]),
    tlsModule: fakeTls([{}]),
    httpsModule: fakeHttps('ok'),
    resolveSystemProxy: async () => { throw new Error('resolveProxy not available'); },
  });
  assert.ok(String(report.proxy.system).startsWith('unavailable:'));
  assert.equal(report.hosts.length, 1, '代理这一层出问题不该影响域名探测');
});

test('resolveSystemProxy 正常时把结果原样带回', async () => {
  const seen = [];
  const report = await selfCheck.runSelfCheck({
    hosts: ['gateway.kugou.com'],
    lookup: lookupOk([{ address: '203.0.113.1', family: 4 }]),
    tlsModule: fakeTls([{}]),
    httpsModule: fakeHttps('ok'),
    resolveSystemProxy: async (url) => { seen.push(url); return 'PROXY 127.0.0.1:7890'; },
  });
  assert.deepEqual(seen, ['https://gateway.kugou.com']);
  assert.equal(report.proxy.system, 'PROXY 127.0.0.1:7890');
});

test('HTTPS 请求失败被记在 http 阶段，其余层结论保留', async () => {
  const result = await selfCheck.probeHttps({ host: 'y.qq.com', httpsModule: fakeHttps('fail') });
  assert.equal(result.httpStatus, null);
  assert.equal(result.error.phase, 'http');
  assert.equal(result.error.code, 'ECONNRESET');
  assert.equal(result.clockSkewMs, null);
});
