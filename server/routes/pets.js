'use strict';

// ====================================================================
//  路由: 桌面宠物 · Petdex 接入
//   - GET  /api/pets/petdex/search   代理 petdex 的公开搜索（不落库、不改远程）
//   - POST /api/pets/petdex/install  下载精灵表 + 元数据到本地缓存
//   - GET  /api/pets/local           已安装的 petdex 宠物
//   - GET  /api/pets/local/asset     回传本地精灵表（二进制）
//   - POST /api/pets/local/remove    卸载
//
//  协议依据（2026-11-13 实测取证，非推断）：
//   · 列表：GET https://petdex.dev/api/pets/search?q=&limit= → { pets[], nextCursor, total }
//     每条含 slug / displayName / spritesheetPath / dominantColor / tags。
//   · 元数据：GET https://assets.petdex.dev/curated/<slug>/pet.json
//     只有 { id, displayName, description, spritesheetPath }，**不含帧信息**——
//     帧布局是固定网格约定：classic 8×9、v2 8×11，每帧 192×208。
//     所以每行真实帧数由前端解码后按列扫描得出，后端不猜。
//   · 资源：sprite.webp 是整表（boba 实测 1536×2288、VP8L 2.4MB）。
//     无缩略图服务（?w= / ?width= 都不缩放），因此列表只用 dominantColor 占位，
//     真正下载只发生在「选用」那一刻。
//
//  安全：slug 走白名单正则（防路径穿越）；下载 URL 只允许 assets.petdex.dev
//  （防 SSRF）；体积设上限。
// ====================================================================

const fs = require('fs');
const path = require('path');
const { isSafePetSlug, resolvePetdexAssetUrl, parsePetdexPetInput, extractPetFromHtml } = require('../lib/petdex-uri');

const PETDEX_ORIGIN = 'https://petdex.dev';
const MAX_SPRITE_BYTES = 12 * 1024 * 1024;
const MAX_LIST = 40;

function petsRoot() {
  // exe 由主进程注入 stableUserData；纯 node 起服务时落到仓库根 .pets
  return process.env.MINERADIO_PET_DIR || path.join(__dirname, '..', '..', '.pets');
}

function petDir(slug) {
  return path.join(petsRoot(), slug);
}

function readMeta(slug) {
  try {
    const raw = fs.readFileSync(path.join(petDir(slug), 'meta.json'), 'utf8');
    const meta = JSON.parse(raw);
    if (!meta || typeof meta !== 'object') return null;
    return meta;
  } catch (_) {
    return null;
  }
}

function listInstalled() {
  let names = [];
  try {
    names = fs.readdirSync(petsRoot(), { withFileTypes: true })
      .filter(d => d.isDirectory() && isSafePetSlug(d.name))
      .map(d => d.name);
  } catch (_) {
    return [];
  }
  return names.map(readMeta).filter(Boolean).map(meta => ({
    slug: meta.slug,
    displayName: meta.displayName,
    description: meta.description,
    dominantColor: meta.dominantColor || '',
    source: 'petdex',
    installedAt: meta.installedAt || 0,
    spriteUrl: '/api/pets/local/asset?slug=' + encodeURIComponent(meta.slug),
    bytes: Number(meta.bytes) || 0,
  }));
}

function trimPet(row) {
  if (!row || typeof row !== 'object') return null;
  const slug = String(row.slug || '').trim();
  if (!isSafePetSlug(slug)) return null;
  return {
    slug,
    displayName: String(row.displayName || slug).slice(0, 80),
    description: String(row.description || '').slice(0, 400),
    // 列表阶段不下载精灵表，只用主色做占位块
    dominantColor: /^#[0-9a-f]{3,8}$/i.test(String(row.dominantColor || '')) ? row.dominantColor : '',
    spritesheetPath: String(row.spritesheetPath || ''),
    tags: Array.isArray(row.tags) ? row.tags.slice(0, 8).map(t => String(t).slice(0, 24)) : [],
    kind: String(row.kind || ''),
    featured: !!row.featured,
  };
}

async function fetchPng(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  try {
    const res = await fetch(url, {
      headers: { Accept: '*/*', 'User-Agent': 'Mineradio/3.3 (+petdex-client)' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SPRITE_BYTES) throw new Error('sprite too large: ' + buf.length);
    if (buf.length < 64) throw new Error('sprite too small');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; Mineradio/3.3; +petdex-client)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    // 宠物页实测约 150KB；给 2MB 上限，防被异常响应撑爆内存
    if (text.length > 2 * 1024 * 1024) throw new Error('page too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// 下载精灵表并落盘。install 与 import 共用，避免两份「下载 + 写 meta」逻辑漂移。
async function installSprite(slug, info) {
  const buf = await fetchPng(info.spriteUrl, 25000);
  const dir = petDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(new URL(info.spriteUrl).pathname) || '.webp';
  // 先删另一种扩展名残留，避免 asset 端读到旧格式
  const stale = path.join(dir, ext === '.png' ? 'sprite.webp' : 'sprite.png');
  try { fs.rmSync(stale, { force: true }); } catch (_) {}
  fs.writeFileSync(path.join(dir, 'sprite' + ext), buf);
  const meta = {
    slug,
    displayName: String(info.displayName || slug).slice(0, 80),
    description: String(info.description || '').slice(0, 400),
    dominantColor: /^#[0-9a-f]{3,8}$/i.test(String(info.dominantColor || '')) ? info.dominantColor : '',
    source: 'petdex',
    sourceSprite: info.spriteUrl,
    bytes: buf.length,
    installedAt: Date.now(),
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

module.exports = function register(ctx) {
  const { sendJSON, readRequestBody } = ctx;

  return async function (req, res, url, pn) {
    // ---------- 搜索代理 ----------
    if (pn === '/api/pets/petdex/search') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 64);
      const limit = Math.max(1, Math.min(MAX_LIST, Number(url.searchParams.get('limit')) || 24));
      const cursor = String(url.searchParams.get('cursor') || '').trim().slice(0, 128);
      const target = new URL('/api/pets/search', PETDEX_ORIGIN);
      target.searchParams.set('q', q);
      target.searchParams.set('limit', String(limit));
      if (cursor) target.searchParams.set('cursor', cursor);
      try {
        const upstream = await fetch(target.href, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mineradio/3.3 (+petdex-client)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!upstream.ok) throw new Error('petdex HTTP ' + upstream.status);
        const json = await upstream.json();
        const rows = (Array.isArray(json && json.pets) ? json.pets : []).map(trimPet).filter(Boolean);
        const installed = new Set(listInstalled().map(p => p.slug));
        sendJSON(res, {
          ok: true,
          pets: rows.map(r => Object.assign(r, { installed: installed.has(r.slug) })),
          nextCursor: String((json && json.nextCursor) || ''),
          total: Number(json && json.total) || 0,
          query: q,
          limit,
          message: rows.length ? '' : 'Petdex 没有匹配的宠物。',
        });
      } catch (err) {
        sendJSON(res, {
          ok: false, pets: [], error: 'PETDEX_SEARCH_FAILED',
          message: 'Petdex 搜索失败：' + (err && err.message || err),
        }, 502);
      }
      return;
    }

    // ---------- 安装 ----------
    if (pn === '/api/pets/petdex/install') {
      if (req.method !== 'POST') {
        sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED', message: '需要 POST' }, 405);
        return;
      }
      let body;
      try { body = await readRequestBody(req); } catch (_) { body = null; }
      const slug = String(body && body.slug || '').trim();
      if (!isSafePetSlug(slug)) {
        sendJSON(res, { ok: false, error: 'INVALID_SLUG', message: '宠物 slug 不合法' }, 400);
        return;
      }
      const spriteUrl = resolvePetdexAssetUrl(body && body.spritesheetPath);
      if (!spriteUrl) {
        sendJSON(res, {
          ok: false, error: 'INVALID_SPRITE_URL',
          message: '精灵表地址不被允许（只接受 assets.petdex.dev 的 webp/png）',
        }, 400);
        return;
      }
      try {
        const meta = await installSprite(slug, {
          spriteUrl,
          displayName: body && body.displayName,
          description: body && body.description,
          dominantColor: body && body.dominantColor,
        });
        sendJSON(res, {
          ok: true, slug, bytes: meta.bytes,
          spriteUrl: '/api/pets/local/asset?slug=' + encodeURIComponent(slug),
          message: '已安装 ' + meta.displayName,
        });
      } catch (err) {
        sendJSON(res, {
          ok: false, error: 'PETDEX_INSTALL_FAILED',
          message: '下载精灵表失败：' + (err && err.message || err),
        }, 502);
      }
      return;
    }

    // ---------- 按链接/名字导入（主流程：浏览器里挑好，粘地址回来） ----------
    if (pn === '/api/pets/petdex/import') {
      if (req.method !== 'POST') {
        sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED', message: '需要 POST' }, 405);
        return;
      }
      let body;
      try { body = await readRequestBody(req); } catch (_) { body = null; }
      const parsed = parsePetdexPetInput(body && body.input);
      if (!parsed) {
        sendJSON(res, {
          ok: false, error: 'INVALID_INPUT',
          message: '认不出这个地址。请粘 petdex.dev/pets/<名字> 这样的宠物页地址，或直接粘宠物名（如 hachiware-2）。',
        }, 400);
        return;
      }
      const slug = parsed.slug;
      const already = readMeta(slug);
      if (already) {
        sendJSON(res, {
          ok: true, slug, alreadyInstalled: true, bytes: Number(already.bytes) || 0,
          displayName: already.displayName,
          spriteUrl: '/api/pets/local/asset?slug=' + encodeURIComponent(slug),
          message: already.displayName + ' 已经在本地了',
        });
        return;
      }
      let pet = null;
      try {
        // 用 slug 拼宠物页：/pets/<slug> 与 /zh/pets/<slug> 实测都返回同样的 --sprite-url
        const html = await fetchText('https://petdex.dev/pets/' + encodeURIComponent(slug), 20000);
        pet = extractPetFromHtml(html);
      } catch (err) {
        sendJSON(res, {
          ok: false, error: 'PETDEX_PAGE_FAILED',
          message: '打开宠物页失败：' + (err && err.message || err),
        }, 502);
        return;
      }
      if (!pet) {
        sendJSON(res, {
          ok: false, error: 'PETDEX_PAGE_PARSE_FAILED',
          message: '宠物页里没找到精灵表地址（页面结构可能变了）：petdex.dev/pets/' + slug,
        }, 502);
        return;
      }
      try {
        const meta = await installSprite(slug, pet);
        sendJSON(res, {
          ok: true, slug, bytes: meta.bytes, displayName: meta.displayName,
          description: meta.description,
          spriteUrl: '/api/pets/local/asset?slug=' + encodeURIComponent(slug),
          message: '已导入 ' + meta.displayName,
        });
      } catch (err) {
        sendJSON(res, {
          ok: false, error: 'PETDEX_INSTALL_FAILED',
          message: '下载精灵表失败：' + (err && err.message || err),
        }, 502);
      }
      return;
    }

    // ---------- 本地列表 ----------
    if (pn === '/api/pets/local') {
      const list = listInstalled();
      sendJSON(res, { ok: true, pets: list, root: petsRoot(), message: list.length ? '' : '还没有安装 Petdex 宠物。' });
      return;
    }

    // ---------- 精灵表回传 ----------
    if (pn === '/api/pets/local/asset') {
      const slug = String(url.searchParams.get('slug') || '').trim();
      if (!isSafePetSlug(slug)) {
        sendJSON(res, { ok: false, error: 'INVALID_SLUG' }, 400);
        return;
      }
      const dir = petDir(slug);
      let file = path.join(dir, 'sprite.webp');
      if (!fs.existsSync(file)) {
        // 允许 png（petdex 也收 png 精灵表）
        const alt = path.join(dir, 'sprite.png');
        if (!fs.existsSync(alt)) {
          sendJSON(res, { ok: false, error: 'NOT_INSTALLED', message: '该宠物尚未安装' }, 404);
          return;
        }
        file = alt;
      }
      // 必须用 res.end(buf) 而不是 stream.pipe(res)：分发器靠 res.writableEnded
      // 判断「这个 matcher 处理完了」，而 pipe 不同步结束响应，会继续走到静态资源
      // 处理器再 writeHead 一次，触发 ERR_HTTP_HEADERS_SENT（实测崩溃过）。
      let buf;
      try {
        buf = await fs.promises.readFile(file);
      } catch (err) {
        sendJSON(res, { ok: false, error: 'READ_FAILED', message: err && err.message || String(err) }, 500);
        return;
      }
      res.writeHead(200, {
        'Content-Type': /\.png$/i.test(file) ? 'image/png' : 'image/webp',
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buf);
      return;
    }

    // ---------- 卸载 ----------
    if (pn === '/api/pets/local/remove') {
      if (req.method !== 'POST') {
        sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED', message: '需要 POST' }, 405);
        return;
      }
      let body;
      try { body = await readRequestBody(req); } catch (_) { body = null; }
      const slug = String(body && body.slug || '').trim();
      if (!isSafePetSlug(slug)) {
        sendJSON(res, { ok: false, error: 'INVALID_SLUG' }, 400);
        return;
      }
      try {
        fs.rmSync(petDir(slug), { recursive: true, force: true });
        sendJSON(res, { ok: true, slug, message: '已卸载' });
      } catch (err) {
        sendJSON(res, { ok: false, error: 'REMOVE_FAILED', message: err && err.message || String(err) }, 500);
      }
      return;
    }
  };
};
