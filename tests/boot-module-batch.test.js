'use strict';

/*
 * 启动模块批量接口（server/lib/boot-modules.js + public/js/index-loader.js）
 *
 * 背景：index-loader 原先对 213 个模块各发一个 fetch，冷缓存下受 HTTP/1.1
 * 六连接上限约束串 30+ 批，把求值起点推到 1.6s。改成一次 POST 批量取回。
 * 这里守两件事：
 *   1) 服务端：白名单 / token / ETag 304 / 顺序一致 / 请求体上限；
 *   2) 前端：默认走批量，且三层回退链没有被删掉（批量 → 逐文件 fetch → 同步 XHR）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const ROOT = path.resolve(__dirname, '..');
const createBootModules = require('../server/lib/boot-modules');

const FILES = [
  'js/modules/00-state/00-debug-gate.js',
  'js/modules/00-state/10-frame-scheduler.js',
  'js/modules/01-scene/00-renderer-quality.js',
];

function makeReq(body, headers = {}) {
  const payload = body == null ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Readable.from(payload);
  req.headers = headers;
  return req;
}

function makeRes() {
  const state = { status: 0, headers: {}, body: '', ended: false };
  const res = {
    writeHead(status, headers) {
      state.status = status;
      Object.assign(state.headers, headers || {});
      return res;
    },
    end(chunk) {
      if (chunk != null) state.body += String(chunk);
      state.ended = true;
      return res;
    },
    get writableEnded() { return state.ended; },
    get headersSent() { return state.status > 0; },
  };
  return { res, state };
}

function sendJSON(res, data, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const BOOT_URL = new URL('http://localhost:3000/boot-modules');

function makeServer(assertIndexToken = () => true, cacheDir = '') {
  return createBootModules({ appRoot: ROOT, sendJSON, assertIndexToken, cacheDir });
}

test('批量接口：返回与 paths 顺序一致的模块原文', async () => {
  const boot = makeServer();
  const { res, state } = makeRes();
  await boot.handle(makeReq({ paths: FILES }), res, BOOT_URL);

  assert.equal(state.status, 200);
  assert.match(String(state.headers['Content-Type']), /application\/json/);
  assert.ok(state.headers.ETag, '必须带 ETag');
  const texts = JSON.parse(state.body);
  assert.equal(texts.length, FILES.length);
  for (let i = 0; i < FILES.length; i += 1) {
    const onDisk = fs.readFileSync(path.join(ROOT, 'public', FILES[i]), 'utf8');
    assert.equal(texts[i], onDisk, '顺序必须与请求一致：' + FILES[i]);
  }
});

test('批量接口：同 ETag 走 304 且不重复读内容', async () => {
  const boot = makeServer();
  const first = makeRes();
  await boot.handle(makeReq({ paths: FILES }), first.res, BOOT_URL);
  assert.equal(first.state.status, 200);
  const etag = first.state.headers.ETag;

  const second = makeRes();
  await boot.handle(makeReq({ paths: FILES }, { 'if-none-match': etag }), second.res, BOOT_URL);
  assert.equal(second.state.status, 304);
  assert.equal(second.state.body, '');
});

test('批量接口：ETag 随文件 mtime/size 变化（模拟模块改动）', async () => {
  const boot = makeServer();
  const target = FILES[0];
  const first = makeRes();
  await boot.handle(makeReq({ paths: [target] }), first.res, BOOT_URL);
  const etagBefore = first.state.headers.ETag;

  const abs = path.join(ROOT, 'public', target);
  const st = fs.statSync(abs);
  // 只改 mtime，不动内容；ETag 必须变，否则开发态改模块会拿到旧文本
  const bumped = new Date(st.mtimeMs + 5000);
  fs.utimesSync(abs, bumped, bumped);
  try {
    const second = makeRes();
    await boot.handle(makeReq({ paths: [target] }), second.res, BOOT_URL);
    assert.equal(second.state.status, 200);
    assert.notEqual(second.state.headers.ETag, etagBefore);
  } finally {
    fs.utimesSync(abs, st.atime, st.mtime);
  }
});

test('批量接口：路径白名单拒绝穿越与非模块路径', async () => {
  const boot = makeServer();
  const bad = [
    ['../server.js'],
    ['js/modules/../../server.js'],
    ['js\\modules\\00-state\\00-debug-gate.js'],
    ['public/js/modules/00-state/00-debug-gate.js'],
    ['js/modules/00-state/00-debug-gate.css'],
    [],
  ];
  for (const paths of bad) {
    const { res, state } = makeRes();
    await boot.handle(makeReq({ paths }), res, BOOT_URL);
    assert.equal(state.status, 400, '应拒绝：' + JSON.stringify(paths));
    assert.match(state.body, /BAD_PATHS/);
  }
});

test('批量接口：token 不通过时 403', async () => {
  const boot = makeServer((searchParams) => searchParams.get('token') === 'ok');
  const denied = makeRes();
  await boot.handle(makeReq({ paths: FILES }), denied.res, BOOT_URL);
  assert.equal(denied.state.status, 403);
  assert.match(denied.state.body, /UNAUTHORIZED/);

  const allowed = makeRes();
  await boot.handle(makeReq({ paths: FILES }), allowed.res, new URL(BOOT_URL + '?token=ok'));
  assert.equal(allowed.state.status, 200);
});

test('批量接口：请求体超限返回 413', async () => {
  const boot = makeServer();
  const huge = 'x'.repeat(300 * 1024);
  const { res, state } = makeRes();
  await boot.handle(makeReq(huge), res, BOOT_URL);
  assert.equal(state.status, 413);
  assert.match(state.body, /BODY_TOO_LARGE/);
});

test('批量接口：缺失模块返回 404（与逐文件 fetch 的失败语义一致）', async () => {
  const boot = makeServer();
  const { res, state } = makeRes();
  await boot.handle(makeReq({ paths: ['js/modules/00-state/__missing__.js'] }), res, BOOT_URL);
  assert.equal(state.status, 404);
  assert.match(state.body, /MODULE_MISSING/);
});

test('磁盘缓存：首次请求落盘，新进程实例直接命中（重启后第一次只读 1 个文件）', async () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-boot-cache-'));
  try {
    const first = makeServer(() => true, dir);
    const r1 = makeRes();
    await first.handle(makeReq({ paths: FILES }), r1.res, BOOT_URL);
    assert.equal(r1.state.status, 200);

    // 落盘是「先回响应、后台写」→ 轮询等它出现
    let cacheFiles = [];
    for (let i = 0; i < 40; i += 1) {
      cacheFiles = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
      if (cacheFiles.length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(cacheFiles.length, 1, '必须生成 1 个磁盘缓存文件');
    const cached = JSON.parse(fs.readFileSync(path.join(dir, cacheFiles[0]), 'utf8'));
    assert.equal(cached.length, FILES.length);

    // 新实例（模拟重启后新进程）：内存缓存为空，必须走磁盘
    const second = makeServer(() => true, dir);
    const r2 = makeRes();
    await second.handle(makeReq({ paths: FILES }), r2.res, BOOT_URL);
    assert.equal(r2.state.status, 200);
    assert.equal(r2.state.body, r1.state.body, '磁盘缓存内容必须与首次响应一致');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('前端加载器：默认批量 + 三层回退链未丢失', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/index-loader.js'), 'utf8');

  assert.match(src, /function fetchModuleTexts\(paths\)/, '必须有批量取模块函数');
  assert.match(src, /fetch\(url,\s*\{[\s\S]{0,200}method:\s*'POST'/, '批量必须走 POST');
  assert.match(src, /'\/boot-modules\?v='/, '批量必须打到 /boot-modules');
  assert.match(src, /window\.__MINERADIO_API_TOKEN__/, '批量必须带 token');

  assert.match(src, /fetchModuleTexts\(modulePaths\)/, '核心波默认走批量');
  assert.match(src, /function \(batchError\)[\s\S]{0,400}fetchModuleText\(path\)/, '必须保留逐文件 fetch 回退');
  assert.match(src, /readModuleSync\(path\)/, '必须保留同步 XHR 兜底');

  assert.match(src, /fetchModuleTexts\(deferredModulePaths\)/, '延迟波默认走批量');
  assert.match(src, /deferred batch failed, trying per-module/, '延迟波必须有逐文件回退');
});

test('服务端路由：/boot-modules 命中在静态资源之前', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/lib/http-server.js'), 'utf8');
  const bootAt = src.indexOf("pn === '/boot-modules'");
  const staticAt = src.indexOf('// ---------- 静态资源 ----------');
  assert.ok(bootAt > 0, 'http-server 必须注册 /boot-modules');
  assert.ok(staticAt > bootAt, '/boot-modules 必须在静态资源处理之前');
  assert.match(src, /require\('\.\/boot-modules'\)/);
});
