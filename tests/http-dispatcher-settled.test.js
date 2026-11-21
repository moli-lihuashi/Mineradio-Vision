'use strict';

// 分发器「响应是否已被占住」的守卫。
//
// 事故（2026-11-19 实机，startup-state.json 里有完整堆栈）：
// 用户点壁纸模式 → 重建窗口销毁旧渲染进程 → 在途 /api/audio 流被中断 →
// pipeline 把 ERR_STREAM_PREMATURE_CLOSE 当「客户端走了」正常 resolve、没有 end() →
// 此时 res.headersSent=true / writableEnded=false → 分发器以为没人处理 →
// 继续掉到静态资源处理器 → public/api/audio 不存在 → fs.stat 失败 → writeHead(404) →
// ERR_HTTP_HEADERS_SENT（抛在 fs 回调里，绕过请求级 try）→ 进程级 uncaughtException →
// 主进程判为「启动失败」→ 销毁壁纸窗口 + app.quit() →
// 窗口留下 Chromium 的 ERR_CONNECTION_REFUSED 错误页。
//
// 守三件事：
//   1. matcher 已经 writeHead 但没 end（客户端中途断开）时，分发器必须就此收手
//   2. /api/* 落到兜底时必须由分发器自己回 404，绝不能掉进静态资源处理器
//   3. 正常静态资源的投递不能因此被误伤

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');

const createHttpServer = require('../server/lib/http-server');

const APP_ROOT = os.tmpdir();

function makeDeps(routeMatchers, state) {
  return {
    http,
    PORT: 0,
    HOST: '127.0.0.1',
    appRoot: APP_ROOT,
    routeCtx: {},
    routeMatchers,
    sendJSON: (res, data, status) => {
      state.json = { data, status };
      res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    },
    assertApiAuth: () => true,
    // 静态资源处理器：只要被调用就记一笔，测试里据此判断「有没有掉下来」
    serveStatic: (res, filePath) => {
      state.staticCalled.push(filePath);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('STATIC:' + path.basename(filePath));
    },
    serveIndexHtml: (res) => {
      state.indexCalled = true;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('INDEX');
    },
    getUserCookie: () => '',
    getApiTokenAuto: () => false,
    getApiToken: () => 'test-token',
    nativeDjAvailable: false,
  };
}

// 起一个真服务：分发器是真实实现，只有下游处理器是替身。
// 用真 HTTP 而不是伪造 req/res —— 要复现的正是「res 已经被写过」这种真实状态。
async function withServer(routeMatchers, fn) {
  const state = { json: null, staticCalled: [], indexCalled: false };
  const deps = makeDeps(routeMatchers, state);
  const { server, startHttpServer } = createHttpServer(deps);
  startHttpServer();
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;
  // 注意：有的用例复刻的是「响应头已发出、body 写了一半、永远不会 end」的断流态，
  // 客户端不能等 'end'（会一直挂着），只收第一块数据然后主动断开。
  const request = (urlPath, opts = {}) => new Promise((resolve, reject) => {
    const stopAfterFirstChunk = opts.stopAfterFirstChunk === true;
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (stopAfterFirstChunk) {
          req.destroy();
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', () => {
        if (stopAfterFirstChunk) resolve({ status: res.statusCode, headers: res.headers, body });
        else reject(new Error('response error'));
      });
    });
    req.on('error', reject);
  });
  try {
    await fn(request, state);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('matcher 已发响应头但未 end（客户端中途断开）时，分发器不得继续往下掉', async () => {
  await withServer([
    async function streamingMatcher(req, res, url, pn) {
      if (pn !== '/api/audio') return;
      // 复刻 pipeWebBodyToRes 的 clientGone 分支：头发出去了、body 写了一半、
      // 再也不会有人调 end()。旧代码在这里 writableEnded=false → 掉到静态资源。
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '100' });
      res.write('partial-audio-bytes');
      // 故意不 end
    },
  ], async (request, state) => {
    const res = await request('/api/audio?url=x', { stopAfterFirstChunk: true });
    assert.equal(res.status, 200, '已发出的头不该被覆盖成别的状态码');
    assert.equal(res.body, 'partial-audio-bytes');
    // 分发器在 matcher 返回后同步判定一次，等一小会儿让那条链走完再断言
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(state.staticCalled, [],
      '响应已被 matcher 占住时，静态资源处理器一次都不能被调用（否则就是二次 writeHead）');
    assert.equal(state.json, null, '兜底 JSON 也不该被触发');
  });
});

test('/api/* 无人认领时由分发器自己回 404，不掉进静态资源处理器', async () => {
  await withServer([async function noop() {}], async (request, state) => {
    const res = await request('/api/this-route-does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.body), {
      error: 'NOT_FOUND',
      path: '/api/this-route-does-not-exist',
    });
    assert.deepEqual(state.staticCalled, [],
      '/api/ 下没有物理文件，往下掉只会触发 ERR_HTTP_HEADERS_SENT');
  });
});

test('正常静态资源投递不受影响（守卫没有把静态段一起挡掉）', async () => {
  await withServer([async function noop() {}], async (request, state) => {
    const res = await request('/css/10-shell/wallpaper-stage.css');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'STATIC:wallpaper-stage.css');
    assert.equal(state.staticCalled.length, 1);
  });
});

test('matcher 正常 end 之后分发器立刻收手（回归：原有判据不能丢）', async () => {
  await withServer([
    async function jsonMatcher(req, res, url, pn) {
      if (pn !== '/api/ok') return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    },
  ], async (request, state) => {
    const res = await request('/api/ok');
    assert.equal(res.body, '{"ok":true}');
    assert.deepEqual(state.staticCalled, []);
  });
});
