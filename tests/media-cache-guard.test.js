'use strict';

/* =============================================================================
 * A2 媒体缓存写出守卫 — 行为测试
 * 纯函数用真实模块；下发行为用注入替身 guard 的真实 createMediaProxy().sendAudioBuffer。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const guardModule = require(path.join(appRoot, 'server/lib/media-cache-guard'));
const createMediaProxy = require(path.join(appRoot, 'server/lib/media-proxy'));

const headersOf = type => ({ get: () => type });
const respOf = (ok, type) => ({ ok, headers: headersOf(type) });
const blobOf = (size, type) => ({ size, type });

function fakeRes() {
  const state = { code: null, headers: null, body: null };
  return {
    state,
    writeHead(code, headers) { state.code = code; state.headers = headers; },
    end(body) { state.body = body; },
  };
}

test('HTTP 非成功不写缓存', () => {
  assert.equal(guardModule.isCacheableAudioResponse(respOf(false, 'audio/mpeg'), blobOf(99999)), false);
  assert.equal(guardModule.isCacheableAudioResponse(null, blobOf(99999)), false);
});

test('错误页 / JSON / XML / HTML 一律不写缓存', () => {
  for (const type of ['text/html', 'text/plain', 'application/json', 'application/xml', 'application/xhtml+xml']) {
    assert.equal(
      guardModule.isCacheableAudioResponse(respOf(true, type), blobOf(99999)), false,
      type + ' 不能当成音频');
    assert.equal(guardModule.isClearlyNonAudioPayload(type), true);
  }
});

test('小于 16 KiB 的下载不写缓存', () => {
  assert.equal(guardModule.isCacheableAudioResponse(respOf(true, 'audio/mpeg'), blobOf(16 * 1024 - 1)), false);
});

test('不规范但合法的 Content-Type 仍然可写（黑名单而非白名单）', () => {
  assert.equal(guardModule.isCacheableAudioResponse(respOf(true, 'binary/octet-stream'), blobOf(20 * 1024)), true);
  assert.equal(guardModule.isCacheableAudioResponse(respOf(true, 'video/mp4'), blobOf(20 * 1024)), true);
  assert.equal(guardModule.isCacheableAudioResponse(respOf(true, ''), blobOf(20 * 1024)), true,
    '拿不到头时退到 blob.type，不能因此拒绝');
});

test('会话内不信任标记：标记 → 命中 → 清除 → 不再命中', () => {
  const guard = guardModule.createMediaCacheGuard();
  assert.equal(guard.isDistrusted('kugou:123'), false);
  guard.distrust('kugou:123');
  assert.equal(guard.isDistrusted('kugou:123'), true);
  assert.deepEqual(guard.distrustedKeys(), ['kugou:123']);
  guard.clearDistrust('kugou:123');
  assert.equal(guard.isDistrusted('kugou:123'), false);
  guard.distrust('kugou:1');
  guard.reset();
  assert.deepEqual(guard.distrustedKeys(), []);
});

test('下发行为：text/html 错误页被 502 挡下，并留下可疑负载记录', () => {
  const guard = guardModule.createMediaCacheGuard();
  const proxy = createMediaProxy({ audioGuard: guard });
  const res = fakeRes();
  proxy.sendAudioBuffer(res, Buffer.alloc(20 * 1024), 'text/html', '');
  assert.equal(res.state.code, 502);
  assert.equal(res.state.body, 'UPSTREAM_NOT_AUDIO');
  const noted = guard.suspiciousPayloads();
  assert.equal(noted.length, 1);
  assert.equal(noted[0].reason, 'NON_AUDIO_CONTENT_TYPE');
  assert.equal(noted[0].bytes, 20 * 1024);
});

test('下发行为：正常音频照常 200，且带正确 Content-Length', () => {
  const guard = guardModule.createMediaCacheGuard();
  const proxy = createMediaProxy({ audioGuard: guard });
  const res = fakeRes();
  const buf = Buffer.alloc(20 * 1024, 7);
  proxy.sendAudioBuffer(res, buf, 'audio/mpeg', '');
  assert.equal(res.state.code, 200);
  assert.equal(res.state.headers['Content-Length'], 20 * 1024);
  assert.equal(res.state.body, buf);
  assert.deepEqual(guard.suspiciousPayloads(), [], '合格音频不应被记成可疑');
});

test('下发行为：小于缓存阈值的短音频不被阻断，只记一条诊断', () => {
  const guard = guardModule.createMediaCacheGuard();
  const proxy = createMediaProxy({ audioGuard: guard });
  const res = fakeRes();
  proxy.sendAudioBuffer(res, Buffer.alloc(1024), 'audio/mpeg', '');
  assert.equal(res.state.code, 200, '短试听片段是合法音源，不能误伤');
  assert.equal(guard.suspiciousPayloads()[0].reason, 'TOO_SMALL_FOR_CACHE');
});

test('下发行为：Range 请求仍按原逻辑切出 206 分片', () => {
  const guard = guardModule.createMediaCacheGuard();
  const proxy = createMediaProxy({ audioGuard: guard });
  const res = fakeRes();
  proxy.sendAudioBuffer(res, Buffer.alloc(20 * 1024), 'audio/mpeg', 'bytes=0-99');
  assert.equal(res.state.code, 206);
  assert.equal(res.state.headers['Content-Length'], 100);
  assert.equal(res.state.body.length, 100);
});
