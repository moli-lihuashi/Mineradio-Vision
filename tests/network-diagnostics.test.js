'use strict';

/* =============================================================================
 * A3 连接层诊断 — 行为测试
 * 起一个真实本地 HTTP server，跑真实 requestText，断言记录内容与返回形状。
 * 重点：埋点不能改变 requestText 的既有契约（默认返回字符串、captureSetCookie 仍是 opt-in）。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const diagnostics = require(path.join(appRoot, 'server/lib/network-diagnostics'));
const { requestText } = require(path.join(appRoot, 'server/lib/http-request'));
const rec = diagnostics.getNetworkRecorder();

function startServer(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const portOf = server => server.address().port;

test('成功请求留下分层记录，且 path 不含 query（凭据不进诊断）', async () => {
  const server = await startServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  try {
    rec.clear();
    const url = `http://127.0.0.1:${portOf(server)}/api/kugou/playlist?cookie=SUPER_SECRET&token=ABC`;
    const text = await requestText(url, { timeoutMs: 2000, retries: 0 });
    assert.equal(text, 'ok');
    const entries = rec.snapshot();
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.path, '/api/kugou/playlist');
    assert.equal(e.status, 200);
    assert.equal(e.phase, 'response');
    assert.equal(e.method, 'GET');
    assert.equal(e.error, null);
    assert.equal(typeof e.timings.totalMs, 'number');
    assert.ok(!JSON.stringify(e).includes('SUPER_SECRET'), 'cookie 值绝不能进诊断记录');
    assert.ok(!JSON.stringify(e).includes('ABC'));
  } finally { server.close(); }
});

test('5xx 重试留下两条记录，attempt 递增且都记下状态码', async () => {
  const server = await startServer((_req, res) => { res.writeHead(503); res.end('busy'); });
  try {
    rec.clear();
    const url = `http://127.0.0.1:${portOf(server)}/api/flaky`;
    await assert.rejects(() => requestText(url, { timeoutMs: 2000, retries: 1 }), /HTTP 503/);
    const entries = rec.snapshot();
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map(e => e.attempt), [0, 1]);
    assert.ok(entries.every(e => e.status === 503));
    assert.equal(rec.snapshot({ errorsOnly: true }).length, 2);
  } finally { server.close(); }
});

test('连接失败记下错误码与阶段，错误消息过凭据脱敏', async () => {
  rec.clear();
  await assert.rejects(
    () => requestText('http://127.0.0.1:1/api/dead?token=LEAKME', { timeoutMs: 1500, retries: 0 }),
    () => true);
  const e = rec.snapshot().at(-1);
  assert.ok(e, '连接失败也要留下记录');
  assert.ok(e.error, 'error 字段不能为空');
  assert.ok(e.phase && e.phase !== 'pending');
  assert.ok(!JSON.stringify(e).includes('LEAKME'));
});

test('requestText 契约不变：默认返回字符串，captureSetCookie 才返回对象', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Set-Cookie': 'token=ROTATED' });
    res.end('{"status":1}');
  });
  try {
    const url = `http://127.0.0.1:${portOf(server)}/api/session`;
    assert.equal(typeof await requestText(url, { timeoutMs: 2000, retries: 0 }), 'string');
    const captured = await requestText(url, { timeoutMs: 2000, retries: 0, captureSetCookie: true });
    assert.equal(typeof captured, 'object');
    assert.equal(captured.text, '{"status":1}');
    assert.ok(captured.setCookie.some(v => v.includes('token=ROTATED')));
  } finally { server.close(); }
});

test('run(tag, fn) 给整次业务操作打标签，entriesForTag 能单独拉出来', () => {
  const local = diagnostics.createNetworkRecorder();
  local.run('playlist-open', () => {
    local.begin({ url: 'https://cloudlist.service.kugou.com/v7/get_all_list' });
    local.begin({ url: 'https://gateway.kugou.com/v2/tracks' });
  });
  local.begin({ url: 'https://music.163.com/api/song/url' });
  assert.equal(local.entriesForTag('playlist-open').length, 2);
  assert.equal(local.snapshot({ tag: 'untagged' }).length, 0);
  assert.equal(local.snapshot().length, 3);
});

test('环形缓冲有上限：超出后只保留最近 N 条', () => {
  const local = diagnostics.createNetworkRecorder({ maxEntries: 2 });
  for (let i = 0; i < 5; i++) local.begin({ url: `https://kugou.com/p/${i}` });
  assert.equal(local.size(), 2);
  assert.deepEqual(local.snapshot().map(e => e.path), ['/p/3', '/p/4']);
});

test('供应商域名分类与错误脱敏', () => {
  assert.equal(diagnostics.classifyProvider('cloudlist.service.kugou.com'), 'kugou');
  assert.equal(diagnostics.classifyProvider('music.163.com'), 'netease');
  assert.equal(diagnostics.classifyProvider('v26-luna.douyinvod.com'), 'qishui');
  assert.equal(diagnostics.classifyProvider('example.org'), 'other');
  const d = diagnostics.describeError({
    code: 'ECONNRESET',
    message: 'GET /x?token=SECRET123 failed at 192.168.1.7',
  });
  assert.equal(d.code, 'ECONNRESET');
  assert.ok(d.message.includes('<redacted>'));
  assert.ok(d.message.includes('192.168.1.7'), 'IP 必须保留用于排障');
  assert.ok(d.message.includes('/x'), '请求路径必须保留');
});
