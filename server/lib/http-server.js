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

  const server = http.createServer(async (req, res) => {
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
