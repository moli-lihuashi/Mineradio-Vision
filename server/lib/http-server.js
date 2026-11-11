'use strict';

// 注意：原 server.js 顶层的 path 是模块级绑定，搬进工厂后模块内不再有它。
// 静态资源段（resolve / join / sep）依赖它，漏了就只会在真请求时抛 path is not defined。
const path = require('path');
const crypto = require('crypto');

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
    getApiToken,
    nativeDjAvailable,
  } = deps || {};

  // shader 市场目录缓存：mtime 未变则复用上次结果，避免每次请求同步扫目录阻塞主进程（server 内嵌主进程）
  let shaderMarketCache = { dir: '', mtime: 0, shaders: null };

  // ---------- Host 头校验（DNS rebinding 防线）----------
  // 为什么必须有：`/` 的 serveIndexHtml 会把 API_TOKEN 明文注入 HTML，而静态路由不过 token 门禁。
  // 攻击者只要让自己的域名先解析到攻击机、再 rebind 到 127.0.0.1，浏览器就会用 **evil.com 的 origin**
  // 去请求本机服务 —— 此时同源成立，响应可读，token 直接落到攻击者手里。CORS 反射在这里救不了：
  // 同源请求根本不走 CORS 检查。唯一可靠的判别是 Host 头，因为 rebinding 后 Host 仍是 evil.com。
  // 放行：环回字面量（127.0.0.1 / localhost / ::1，带不带端口均可）。
  // 显式需要局域网访问时用 MINERADIO_ALLOW_NON_LOOPBACK_HOST=1 解除，默认 fail-closed。
  const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  const allowNonLoopbackHost = String(process.env.MINERADIO_ALLOW_NON_LOOPBACK_HOST || '').trim() === '1';
  function hostHeaderIsLoopback(rawHost) {
    if (allowNonLoopbackHost) return true;
    const host = String(rawHost || '').trim().toLowerCase();
    if (!host) return false;
    // IPv6 字面量形如 [::1]:3000，先摘掉方括号内的部分再按端口切分
    let hostname = host;
    if (host.startsWith('[')) {
      const close = host.indexOf(']');
      if (close === -1) return false;
      hostname = host.slice(0, close + 1);
    } else {
      const colon = host.lastIndexOf(':');
      if (colon !== -1) hostname = host.slice(0, colon);
    }
    return LOOPBACK_HOSTNAMES.has(hostname);
  }

  // 首页注入页的 token 门禁。只认 query token（渲染进程导航时带），
  // 不接受 header —— 浏览器地址栏导航没法带自定义头，这里也不该为此放宽。
  function assertIndexToken(searchParams) {
    const token = String((searchParams && searchParams.get('token')) || '').trim();
    if (!token) return false;
    const expected = String((typeof getApiToken === 'function' ? getApiToken() : '') || '').trim();
    if (!expected) return false;
    return safeTokenEquals(token, expected);
  }

  // 常量时间比较：长度不同直接 false（长度本身不是秘密），等长走 timingSafeEqual。
  function safeTokenEquals(a, b) {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) return false;
    try { return crypto.timingSafeEqual(bufA, bufB); } catch (_) { return false; }
  }

  // 本服务自己的 origin 集合。渲染进程是从 http://localhost:PORT 或 http://127.0.0.1:PORT 打开的，
  // 两种写法都算自己；端口必须等于本服务实际监听的 PORT。
  function isOwnOrigin(origin) {
    let parsed;
    try { parsed = new URL(origin); } catch (_) { return false; }
    if (parsed.protocol !== 'http:') return false;
    if (String(parsed.port || '') !== String(PORT || '')) return false;
    return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  }

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

    // Host 头校验放在最前面：它保护的是「读响应」这件事本身，
    // 所以必须在任何可能写出 token / 用户数据的响应之前拒绝（CORS 头也一并不发）。
    if (!hostHeaderIsLoopback(req.headers.host)) {
      sendJSON(res, { error: 'BAD_HOST' }, 403);
      return;
    }

    const origin = req.headers.origin;
    // 只回显本服务自己的 origin（任意端口都不放）。
    // 以前是 /^http:\/\/127\.0\.0\.1:|^http:\/\/localhost:/ —— 任何跑在本机的网页
    // （包括用户随手打开的另一个 localhost 开发服务器）都能拿到带 ACAO 的响应去读 token 注入页。
    // 本服务只有一个真实消费者：自己的渲染进程，它用的就是 PORT 这个 origin。
    if (origin && isOwnOrigin(origin)) {
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
      // 注入页里带着明文 API_TOKEN，是全站唯一的 token 出处 —— 必须先过 token 门禁。
      // 不设门禁的后果：任何能访问本服务的东西（局域网、rebinding、本机其它页面）
      // 只要 GET / 就拿到 token，随后 /api/* 全部敞开。
      // 渲染进程自己加载时是带 ?token= 的（见 desktop/main.js 拼的 URL），
      // 手动在浏览器开 localhost:3000 会被拒 —— 这是有意的 fail-closed。
      if (!assertIndexToken(url.searchParams)) {
        sendJSON(res, { error: 'UNAUTHORIZED' }, 403);
        return;
      }
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
