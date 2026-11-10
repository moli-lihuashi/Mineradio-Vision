'use strict';

// 注意：原 server.js 顶层的 path 是模块级绑定，搬进工厂后模块内不再有它。
// 静态资源段（resolve / join / sep）依赖它，漏了就只会在真请求时抛 path is not defined。
const path = require('path');

// HTTP 分发层：server.js 尾巴上最后一块。
//   · CORS（只放行 127.0.0.1 / localhost 的 origin）
//   · OPTIONS 预检 → 204
//   · /api/* token 鉴权（assertApiAuth）
//   · 依次问 9 个路由模块（routeMatchers），谁写了响应就结束
//   · 歌词着色器市场（按目录 mtime 缓存，避免每次请求同步扫盘）
//   · 静态资源 + 目录穿越防护（resolve 后必须仍在 public 内）
//
// 从 server.js 抽出（原 server.js 1961–1962 / 1976–2061 / 2063–2074）。不 require server.js，避免循环依赖。
// deps 里 routeCtx / routeMatchers 由 server.js 组装（它们是「表里有什么」的清单，属于聚合层）。

module.exports = function createHttpServer(deps) {
  const {
    http,
    PORT,
    HOST,
    appRoot,
    routeCtx,
    routeMatchers,
    sendJSON,
    assertApiAuth,
    serveStatic,
    serveIndexHtml,
    getUserCookie,
    getApiTokenAuto,
    nativeDjAvailable,
  } = deps || {};

  // shader 市场目录缓存：mtime 未变则复用上次结果，避免每次请求同步扫目录阻塞主进程（server 内嵌主进程）
  let shaderMarketCache = { dir: '', mtime: 0, shaders: null };

  // ---------- 汉字笔顺：同源取 hanzi-writer medians ----------
  // 为什么要有这一段：渲染层 index.html 的 CSP 是 `connect-src 'self' …`，
  // 模组直连 jsDelivr / unpkg / npmmirror 会全部被挡 —— 表现是笔顺一个字都取不到，
  // 整段歌词退回字体骨架。这里由主进程去取、落盘缓存，用同源路径发给渲染层。
  // 路径故意不放在 /api/ 下：/api/* 一律要 token，而模组在渲染层拿不到 token。
  // 内容是公开字形数据，不含用户信息，不需要鉴权。
  const HANZI_PREFIX = '/hanzi-strokes/';
  const HANZI_CDN = [
    'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/',
    'https://unpkg.com/hanzi-writer-data@2.0/',
    'https://registry.npmmirror.com/hanzi-writer-data/2.0.1/files/',
  ];
  const hanziMemo = new Map();       // ch → medians|null，挡住同一句反复读盘
  const hanziDir = () => {
    try {
      const electron = require('electron');
      const userDataPath = electron.app ? electron.app.getPath('userData') : '';
      return userDataPath ? path.join(userDataPath, 'hanzi-strokes') : '';
    } catch (_) { return ''; }
  };
  // 只认单个 CJK 统一表意文字：这个白名单同时也是路径穿越的防线（文件名由它重新拼，不用请求里的原文）
  const hanziOf = (raw) => {
    let s = '';
    try { s = decodeURIComponent(String(raw || '')); } catch (_) { return ''; }
    s = s.replace(/\.json$/i, '');
    if ([...s].length !== 1) return '';
    const c = s.codePointAt(0);
    const ok = (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
    return ok ? s : '';
  };
  async function fetchHanziFromCdn(ch) {
    for (const base of HANZI_CDN) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      try {
        const r = await fetch(base + encodeURIComponent(ch) + '.json', { signal: ac.signal });
        if (!r.ok) continue;
        const data = await r.json();
        if (Array.isArray(data?.medians) && data.medians.length) return data.medians;
      } catch (_) { /* 换下一个源 */ }
      finally { clearTimeout(timer); }
    }
    return null;
  }
  async function serveHanziStrokes(res, raw) {
    const ch = hanziOf(raw);
    if (!ch) { sendJSON(res, { error: 'BAD_CHAR' }, 400); return; }
    if (hanziMemo.has(ch)) { sendJSON(res, { ch, medians: hanziMemo.get(ch) }); return; }
    const dir = hanziDir();
    const file = dir ? path.join(dir, ch + '.json') : '';
    if (file) {
      try {
        const parsed = JSON.parse(await require('fs').promises.readFile(file, 'utf8'));
        if (Array.isArray(parsed) && parsed.length) { hanziMemo.set(ch, parsed); sendJSON(res, { ch, medians: parsed }); return; }
      } catch (_) { /* 没缓存过 */ }
    }
    const medians = await fetchHanziFromCdn(ch);
    hanziMemo.set(ch, medians);
    if (medians && file) {
      try {
        await require('fs').promises.mkdir(dir, { recursive: true });
        await require('fs').promises.writeFile(file, JSON.stringify(medians));
      } catch (_) { /* 落盘失败不影响这次返回 */ }
    }
    if (!medians) { sendJSON(res, { error: 'NOT_FOUND', ch }, 404); return; }
    sendJSON(res, { ch, medians });
  }

  // 抽成具名 async 函数，由下面的同步监听器统一 .catch()。
  // http.createServer 不会处理 async 监听器返回的 rejected Promise：
  // 以前任一 handler 抛出未被自身捕获的异常时，这个连接既没有响应、
  // 又会产生进程级 unhandledRejection，前端 fetch 只能一直挂到超时。
  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    const pn = url.pathname;

    const origin = req.headers.origin;
    if (origin && /^http:\/\/127\.0\.0\.1:|^http:\/\/localhost:/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Mineradio-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!assertApiAuth(req, pn, url.searchParams)) {
      sendJSON(res, { error: 'UNAUTHORIZED' }, 403);
      return;
    }

    for (const matcher of routeMatchers) {
      await matcher(req, res, url, pn);
      if (res.writableEnded) return;
    }

    // ---------- 歌词着色器市场 ----------
    if (pn === '/api/shader-market/list') {
      try {
        const electron = require('electron');
        const path = require('path');
        const fs = require('fs');
        const userDataPath = electron.app ? electron.app.getPath('userData') : '';
        const shaderDir = userDataPath ? path.join(userDataPath, 'plugins', 'lyric-shaders') : '';
        // 目录 mtime 未变则直接复用上次结果，避免每次请求同步扫目录阻塞主进程
        let dirMtime = 0;
        if (shaderDir) {
          try { dirMtime = (await fs.promises.stat(shaderDir)).mtimeMs || 0; } catch (_) {}
        }
        if (shaderMarketCache.dir === shaderDir && shaderMarketCache.mtime === dirMtime && shaderMarketCache.shaders) {
          sendJSON(res, { shaders: shaderMarketCache.shaders });
          return;
        }
        const shaders = [];
        if (shaderDir && dirMtime) {
          const files = await fs.promises.readdir(shaderDir).catch(() => []);
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
              const content = await fs.promises.readFile(path.join(shaderDir, file), 'utf8');
              const parsed = JSON.parse(content);
              if (parsed && parsed.id && parsed.name && parsed.fragmentShader) {
                shaders.push(parsed);
              }
            } catch (_) {}
          }
        }
        shaderMarketCache = { dir: shaderDir, mtime: dirMtime, shaders };
        sendJSON(res, { shaders });
      } catch (err) {
        sendJSON(res, { shaders: [], error: err.message });
      }
      return;
    }

    // ---------- 汉字笔顺（同源，给雾笺 / 雾窗取 hanzi-writer medians）----------
    if (pn.startsWith(HANZI_PREFIX)) {
      await serveHanziStrokes(res, pn.slice(HANZI_PREFIX.length));
      return;
    }

    // ---------- 静态资源 ----------
      if (pn === '/favicon.ico') {
      serveStatic(res, path.join(appRoot, 'build', 'icon.ico'));
      return;
    }

    const publicDir = path.resolve(appRoot, 'public');
    let filePath = pn === '/' ? '/index.html' : pn;
    filePath = path.resolve(publicDir, filePath.slice(1));
    if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (pn === '/' || pn === '/index.html') {
      serveIndexHtml(res, filePath.endsWith('.html') ? filePath : path.join(publicDir, 'index.html'));
      return;
    }
    serveStatic(res, filePath);
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[HttpServer] unhandled request error:', (err && (err.stack || err.message)) || err);
      if (res.writableEnded || res.headersSent || res.destroyed) return;
      const status = Number(err && err.statusCode) === 413 ? 413 : 500;
      try {
        sendJSON(res, {
          error: status === 413 ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',
          message: status === 413 ? '请求体过大' : '服务器内部错误',
        }, status);
      } catch (_) {
        try { res.writeHead(status); res.end(status === 413 ? 'Payload Too Large' : 'Internal Server Error'); } catch (_) {}
      }
    });
  });

  server.on('clientError', (_err, socket) => {
    if (!socket || socket.destroyed) return;
    try { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch (_) {}
  });

  // waitForServer() 在启动探活结束后会 removeListener 掉自己的 once('error')，
  // 没有常驻监听时，运行期的 server 级 error（EADDRINUSE / EACCES 等）会变成
  // 进程级未捕获异常。这里只记日志，不改变启动期的 reject 语义。
  server.on('error', (err) => {
    console.error('[HttpServer] server error:', (err && (err.stack || err.message)) || err);
  });

  function startHttpServer() {
    if (server.listening) return server;
    server.listen(PORT, HOST, () => {
      console.log('======================================================');
      console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
      console.log(' 登录态: ' + (getUserCookie() ? '已登录(cookie已加载)' : '未登录'));
      console.log(' DJ native: ' + (nativeDjAvailable ? 'ON (energy+beatmap C++)' : 'OFF (JS fallback)'));
      if (getApiTokenAuto()) console.log(' [Security] API token auto-generated for this session');
      console.log('======================================================');
    });
    return server;
  }

  return { server, startHttpServer };
};
