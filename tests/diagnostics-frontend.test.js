'use strict';

/* =============================================================================
 * 打包版内可见诊断入口 — 行为测试
 * 在 vm 里跑真实前端模块源码，用假 fetch 断言：三个接口都拉、token 带上、
 * 报告里合并构建提示 / 连接层失败计数 / 播放源版本结论；以及 B 档新增的
 * mineradioSelfCheck() 单独跑分层自检时的参数拼装。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const src = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/10-shell/05-diagnostics.js'), 'utf8');

function loadFrontend(overrides) {
  const calls = [];
  const replies = Object.assign({
    '/api/debug/build': { dist: { synced: false }, hints: ['先跑 sync-dist-app.js'] },
    '/api/debug/network?limit=200': { entries: [{ error: { code: 'ETIMEDOUT' } }, { status: 200 }] },
    '/api/debug/logs?limit=300': { entries: [{ text: '[Kugou] ok' }] },
    '/api/debug/self-check': { hosts: [{ host: 'gateway.kugou.com' }] },
  }, (overrides && overrides.replies) || {});
  const sandbox = Object.assign({
    console: { warn() {} },
    Promise, URL, URLSearchParams,
    desktopWindow: {
      fetchApiToken: async () => 'TOKEN_XYZ',
      getApiToken: () => 'CACHED_TOKEN',
    },
    async fetch(url, opts) {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => replies[url] || {} };
    },
  }, (overrides && overrides.sandbox) || {});
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, calls };
}

test('真实源码挂载了 mineradioDiagnostics 与 mineradioSelfCheck', () => {
  const { sandbox } = loadFrontend();
  assert.equal(typeof sandbox.mineradioDiagnostics, 'function');
  assert.equal(typeof sandbox.mineradioSelfCheck, 'function');
});

test('一次调用拉齐构建溯源 / 连接层 / 运行日志三个接口', async () => {
  const { sandbox, calls } = loadFrontend();
  const report = await sandbox.mineradioDiagnostics();
  assert.deepEqual(calls.map(c => c.url).sort(), [
    '/api/debug/build',
    '/api/debug/logs?limit=300',
    '/api/debug/network?limit=200',
  ].sort());
  assert.equal(report.build.dist.synced, false);
  assert.equal(report.network.entries.length, 2);
  assert.equal(report.logs.entries.length, 1);
  assert.ok(report.hints.some(h => h.includes('sync-dist-app.js')));
  assert.ok(report.hints.some(h => h.includes('1 条失败记录')), '连接层失败数要进提示');
});

test('每个诊断请求都带上 API token 头', async () => {
  const { sandbox, calls } = loadFrontend();
  await sandbox.mineradioDiagnostics();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.opts.headers['X-Mineradio-Token'] === 'TOKEN_XYZ'));
});

test('拿不到异步 token 时回落到缓存 token，不裸奔请求', async () => {
  const { sandbox, calls } = loadFrontend();
  sandbox.desktopWindow.fetchApiToken = async () => { throw new Error('bridge down'); };
  await sandbox.mineradioDiagnostics();
  assert.ok(calls.every(c => c.opts.headers['X-Mineradio-Token'] === 'CACHED_TOKEN'));
});

test('接口非 2xx 时明确报错，不把空数据当成功', async () => {
  const { sandbox } = loadFrontend();
  sandbox.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => sandbox.mineradioDiagnostics(), /HTTP 403/);
});

test('源指纹快照并入报告；源没轮换时给出明确提示', async () => {
  const { sandbox } = loadFrontend({
    sandbox: {
      playbackSourceRevisionSnapshot: () => ({
        songKey: 'kugou:h1',
        src: 'https://cdn/a.mp3',
        revision: 'kugou|h1|210|https://cdn/a.mp3',
        lastRevision: 'kugou|h1|210|https://cdn/a.mp3',
        changedAfterRecovery: false,
      }),
    },
  });
  const report = await sandbox.mineradioDiagnostics();
  assert.equal(report.playbackSource.songKey, 'kugou:h1');
  assert.ok(report.hints.some(h => h.includes('同一枚链接')), '没换到源要说明白');
});

test('没换链过时快照结论为 null，不硬加「源没变」的提示', async () => {
  const { sandbox } = loadFrontend({
    sandbox: {
      playbackSourceRevisionSnapshot: () => ({
        songKey: '', src: '', revision: '', lastRevision: '', changedAfterRecovery: null,
      }),
    },
  });
  const report = await sandbox.mineradioDiagnostics();
  assert.equal(report.playbackSource.changedAfterRecovery, null);
  assert.ok(!report.hints.some(h => h.includes('同一枚链接')));
});

test('09f 缺席时报告里的 playbackSource 是 null，不抛', async () => {
  const { sandbox } = loadFrontend();
  const report = await sandbox.mineradioDiagnostics();
  assert.equal(report.playbackSource, null);
});

test('mineradioSelfCheck 单独请求自检接口并带 token', async () => {
  const { sandbox, calls } = loadFrontend();
  const report = await sandbox.mineradioSelfCheck();
  assert.deepEqual(calls.map(c => c.url), ['/api/debug/self-check']);
  assert.equal(calls[0].opts.headers['X-Mineradio-Token'], 'TOKEN_XYZ');
  assert.equal(report.hosts[0].host, 'gateway.kugou.com');
});

test('mineradioSelfCheck 把 hosts / timeoutMs 拼进 query', async () => {
  const { sandbox, calls } = loadFrontend();
  await sandbox.mineradioSelfCheck({ hosts: ['gateway.kugou.com', 'y.qq.com'], timeoutMs: 8000 });
  const url = new URL(calls[0].url, 'http://127.0.0.1');
  assert.equal(url.pathname, '/api/debug/self-check');
  assert.equal(url.searchParams.get('hosts'), 'gateway.kugou.com,y.qq.com');
  assert.equal(url.searchParams.get('timeoutMs'), '8000');
});

test('自检接口失败时同样明确抛错', async () => {
  const { sandbox } = loadFrontend();
  sandbox.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => sandbox.mineradioSelfCheck(), /HTTP 403/);
});
