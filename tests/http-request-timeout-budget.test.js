'use strict';

/* =============================================================================
 * 上游超时的「预算」（server/lib/http-request.js）
 *
 * 现场：/api/kugou/user/playlists 出现过 25.2s 的响应，对应 12s 超时 + 重试 1 次。
 * 对前台接口来说，重试一个已经超时的请求只是把等待翻倍：
 * 用户早就离开面板了，回来还是一片空白。
 *
 * 这里用「只 accept 不回包」的本地服务器验证：
 *   - 超时后只发一次请求，不再重试；
 *   - 5xx 仍然照旧重试（不能把正常重试一起砍掉）。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const { requestText, isRetryableNetError, isTimeoutError } = require(path.join(appRoot, 'server', 'lib', 'http-request.js'));

function startServer(handler) {
  return new Promise((resolve) => {
    const hits = { count: 0 };
    const server = http.createServer((req, res) => {
      hits.count += 1;
      handler(req, res, hits);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ port, hits, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test('超时只发一次请求：不再为已经超时的请求重试', async () => {
  const srv = await startServer(() => { /* 永不响应 */ });
  try {
    const started = Date.now();
    await assert.rejects(() => requestText('http://127.0.0.1:' + srv.port + '/slow', { timeoutMs: 250, retries: 3 }), /timeout/i);
    const elapsed = Date.now() - started;
    assert.equal(srv.hits.count, 1, '超时后不许再发第二次，实际发了 ' + srv.hits.count + ' 次');
    assert.ok(elapsed < 900, '总耗时应该接近一次超时（250ms），实际 ' + elapsed + 'ms');
  } finally {
    await srv.close();
  }
});

test('5xx 仍然按原样重试（正常重试不能被一起砍掉）', async () => {
  const srv = await startServer((req, res) => {
    res.statusCode = 503;
    res.end('busy');
  });
  try {
    await assert.rejects(() => requestText('http://127.0.0.1:' + srv.port + '/busy', { timeoutMs: 2000, retries: 2 }), /503/);
    assert.equal(srv.hits.count, 3, '重试 2 次 = 共 3 次请求，实际 ' + srv.hits.count);
  } finally {
    await srv.close();
  }
});

test('超时错误被明确归类为「不可重试」', () => {
  assert.equal(isTimeoutError(new Error('Request timeout')), true);
  assert.equal(isRetryableNetError(new Error('Request timeout')), false, '超时重试只会把等待翻倍');
  assert.equal(isRetryableNetError(new Error('read ECONNRESET')), true, '连接被重置仍然值得重试');
  assert.equal(isRetryableNetError(new Error('HTTP 500')), false, 'HTTP 错误由状态码分支处理');
});
