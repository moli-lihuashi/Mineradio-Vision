'use strict';
/*
 * 启动模块批量接口（2026-11-22）
 *
 * 为什么要有它：index-loader 原先对 213 个模块各发一个 fetch。HTTP/1.1 同源上限
 * 6 连接 → 约 36 批串行；冷缓存（系统重启后首次）每批都要 stat + 读磁盘 + Defender
 * 过一遍，实测把「页面开始求值」推到 1.6s（热态最低 230ms）。合并成一次响应后，
 * 冷启动只剩 2 个请求（核心波 / 延迟波）。
 *
 * 安全边界：
 *   · 只接受 js/modules/ 下的 .js，路径必须落在 publicDir 内（拒绝 .. 与反斜杠）
 *   · 与 index.html 同一个 token 门禁（assertIndexToken）；渲染进程从注入脚本拿 token
 *   · 请求体上限 256KB（213 条路径约 9KB，留足余量）
 * 缓存：ETag = 路径 + 每个文件 size/mtime 的 sha1；ETag 相同直接 304，不读文件内容。
 *   进程内再留一份 texts（最多 6 组），避免核心波 / 延迟波互相顶掉后重复读盘。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODULE_PATH_RE = /^js\/modules\/[A-Za-z0-9_\-/]+\.js$/;
const MAX_PATHS = 500;
const MAX_BODY_BYTES = 256 * 1024;
const READ_CONCURRENCY = 32;
const CACHE_MAX = 6;
const DISK_CACHE_MAX = 8;

function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = (code, status) => {
      if (settled) return;
      settled = true;
      const err = new Error(code);
      err.code = code;
      err.statusCode = status;
      reject(err);
      try { req.resume(); } catch (_) {}
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) { fail('BODY_TOO_LARGE', 413); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (_) {
        const err = new Error('BAD_JSON');
        err.code = 'BAD_JSON';
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = function createBootModules({ appRoot, sendJSON, assertIndexToken, cacheDir }) {
  const publicDir = path.resolve(appRoot, 'public');
  /* 内存缓存只活在本进程：核心波 / 延迟波各一份，最多 6 组。
   * 值存的是「已经 JSON.stringify 好的整段响应」，命中时直接 send，不再 parse + stringify。 */
  const memoryCache = new Map();
  /* 磁盘缓存跨进程、跨系统重启生效，这才是「重启后第一次」的解法：
   * 实测读 213 个小文件首次 1.24s（Defender 逐文件首次扫描），
   * 而读 1 个 5.78MB 整包首次 201ms、二次 13ms。缓存 key 里带每个文件的
   * size/mtime 指纹，开发态改任何模块都会自然失效，不会读到旧代码。 */
  const diskDir = cacheDir ? path.resolve(String(cacheDir)) : '';

  function cacheFileFor(etag) {
    if (!diskDir) return '';
    const safe = String(etag).replace(/[^a-zA-Z0-9]/g, '');
    return path.join(diskDir, safe + '.json');
  }

  async function readDiskCache(file) {
    if (!file) return '';
    try {
      const raw = await fs.promises.readFile(file, 'utf8');
      // 只做形状校验，不 parse：整段就是要发给前端的 JSON 文本
      if (raw.length < 2 || raw[0] !== '[') return '';
      return raw;
    } catch (_) { return ''; }
  }

  async function pruneDiskCache() {
    if (!diskDir) return;
    try {
      const names = await fs.promises.readdir(diskDir);
      const entries = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const full = path.join(diskDir, name);
        try {
          const st = await fs.promises.stat(full);
          entries.push({ full, at: st.mtimeMs });
        } catch (_) {}
      }
      entries.sort((a, b) => b.at - a.at);
      for (const entry of entries.slice(DISK_CACHE_MAX)) {
        try { await fs.promises.unlink(entry.full); } catch (_) {}
      }
    } catch (_) {}
  }

  async function writeDiskCache(file, payload) {
    if (!file) return;
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      await fs.promises.writeFile(tmp, payload, 'utf8');
      await fs.promises.rename(tmp, file); // 原子替换，避免半截文件被下次启动读到
      await pruneDiskCache();
    } catch (_) { /* 缓存写失败不影响本次响应 */ }
  }

  function remember(etag, payload) {
    memoryCache.set(etag, payload);
    while (memoryCache.size > CACHE_MAX) {
      const oldest = memoryCache.keys().next().value;
      memoryCache.delete(oldest);
    }
  }

  function normalizePaths(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_PATHS) return null;
    const list = [];
    for (const raw of input) {
      const rel = String(raw || '');
      if (!MODULE_PATH_RE.test(rel)) return null;
      if (rel.includes('..') || rel.includes('\\')) return null;
      const abs = path.resolve(publicDir, rel);
      if (!abs.startsWith(publicDir + path.sep)) return null;
      list.push({ rel, abs });
    }
    return list;
  }

  async function handle(req, res, url) {
    if (typeof assertIndexToken !== 'function' || !assertIndexToken(url.searchParams)) {
      sendJSON(res, { error: 'UNAUTHORIZED' }, 403);
      return;
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES);
    } catch (err) {
      sendJSON(res, { error: err.code || 'BAD_BODY' }, err.statusCode || 400);
      return;
    }
    const list = normalizePaths(body && body.paths);
    if (!list) {
      sendJSON(res, { error: 'BAD_PATHS' }, 400);
      return;
    }

    let stats;
    try {
      stats = await mapLimited(list, READ_CONCURRENCY, async (item) => {
        const st = await fs.promises.stat(item.abs);
        if (!st.isFile()) throw new Error('NOT_A_FILE');
        return st;
      });
    } catch (_) {
      // 和逐个 fetch 的行为对齐：任何模块取不到都让整批失败，前端回退逐文件并暴露 404。
      sendJSON(res, { error: 'MODULE_MISSING' }, 404);
      return;
    }

    const etag = 'W/"' + crypto.createHash('sha1')
      .update(list.map((item, i) => item.rel + ':' + stats[i].size + ':' + stats[i].mtimeMs).join('|'))
      .digest('hex')
      .slice(0, 24) + '"';

    const inm = req.headers && req.headers['if-none-match'];
    if (inm && inm === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }

    let payload = memoryCache.get(etag);
    if (!payload) {
      const file = cacheFileFor(etag);
      payload = await readDiskCache(file);
      if (!payload) {
        try {
          const texts = await mapLimited(list, READ_CONCURRENCY, (item) => fs.promises.readFile(item.abs, 'utf8'));
          payload = JSON.stringify(texts);
        } catch (_) {
          sendJSON(res, { error: 'MODULE_READ_FAILED' }, 500);
          return;
        }
        // 先回响应，落盘在后台做：冷启动第一次仍然要读全量，但只发生一次。
        writeDiskCache(file, payload).catch(() => {});
      }
      remember(etag, payload);
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'ETag': etag,
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  return { handle };
};
