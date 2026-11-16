'use strict';

// ====================================================================
//  路由: 洛雪音乐（LX Music）源脚本运行时
//
//  这不是「新增一个音乐平台」，而是把 LX Music 的**自定义源脚本**跑起来：
//  · LX 官方 Open API（/status /lyric /play …）只能遥控 LX 客户端，
//    **不提供音频地址**，所以拿不到歌；真正的音源能力只在源脚本里。
//  · 源脚本是用户自行导入的 JS，运行在我们的 vm 沙箱里，通过
//    `on('request', …)` 响应 musicUrl / lyric。
//  · 交付形态与 LX 官方、参考实现一致：**不内置任何音源脚本**，
//    由用户自行导入，脚本版权与合规责任归导入者。
//
//  ⚠ 安全边界（必须让用户知道）：vm 沙箱不是强隔离，恶意脚本有逃逸可能。
//  只导入你信任来源的脚本。面板里也写了这句提示。
//
//  协议依据：https://lxmusic.toside.cn/desktop/custom-source
//  （EVENT_NAMES.inited/request、actions=musicUrl/lyric/pic、qualitys=128k/320k/flac/flac24bit）
// ====================================================================

const lxHost = require('../lx/source-host');
const { PROXY_HEADER_ALLOW, sanitizeProxyHeaders, encodeHeaderParam } = require('../lib/proxy-headers');

const ERR_TEXT = {
  LX_SOURCE_SCRIPT_INVALID: '音源脚本无效（内容为空或超过 5MB）',
  LX_SOURCE_NOT_FOUND: '找不到这个音源，可能已被删除',
  LX_SOURCE_DISABLED: '这个音源已被停用，先启用再切换',
  LX_SOURCE_IDS_REQUIRED: '没有指定要操作的音源',
  LX_SOURCE_UNSUPPORTED: '当前音源不支持这个平台',
  LX_SOURCE_INIT_TIMEOUT: '音源初始化超时（脚本可能是异步初始化或网络不通）',
  LX_SOURCE_RESOLVER_TIMEOUT: '音源解析超时',
  LX_SOURCE_URL_INVALID: '音源返回的播放地址不合法',
  LX_SOURCE_RESOLVE_FAILED: '音源解析失败',
  LX_SOURCE_SCRIPT_INIT_FAILED: '音源脚本初始化失败',
  LX_SOURCE_IMPORT_URL_FAILED: '从链接下载音源脚本失败',
  LX_SOURCE_HOST_NOT_PROXYABLE: '音源返回的地址域名不在音频代理白名单里',
};

function explain(code) {
  const raw = String(code || '');
  if (ERR_TEXT[raw]) return ERR_TEXT[raw];
  // 形如 "320k:LX_SOURCE_URL_INVALID;128k:LX_SOURCE_RESOLVE_FAILED" 的聚合错误
  const parts = raw.split(';').map(p => p.trim()).filter(Boolean);
  const mapped = parts.map(p => {
    const [q, code0] = p.includes(':') ? p.split(':') : ['', p];
    const text = ERR_TEXT[code0] || code0;
    return q ? q + '：' + text : text;
  });
  return mapped.length ? mapped.join('；') : '音源操作失败';
}

module.exports = function register(ctx) {
  const { sendJSON, readRequestBody } = ctx;

  async function readBody(req) {
    try { return (await readRequestBody(req)) || {}; } catch (_) { return {}; }
  }

  function fail(res, err, fallbackCode, status) {
    const code = String((err && err.message) || fallbackCode || 'LX_SOURCE_FAILED');
    console.warn('[LXSource]', code);
    sendJSON(res, { ok: false, error: code, message: explain(code) }, status || 400);
  }

  return async function (req, res, url, pn) {
    if (!pn || pn.indexOf('/api/lx-source/') !== 0) return;

    // ---------- 状态：当前音源 + 已导入列表 ----------
    if (pn === '/api/lx-source/status') {
      try {
        const st = await lxHost.status();
        sendJSON(res, Object.assign({ ok: true, configured: true }, st));
      } catch (err) {
        // 没有导入/选中音源时 getRuntime 会抛，这不是故障，如实报告「未配置」
        sendJSON(res, {
          ok: true,
          configured: false,
          sources: {},
          installed: lxHost.listSources(),
          reason: explain(err && err.message),
        });
      }
      return;
    }

    // ---------- 导入脚本（原文或链接） ----------
    if (pn === '/api/lx-source/import') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      const link = String(payload.url || '').trim();
      const script = String(payload.script || '');
      if (!link && !script.trim()) {
        sendJSON(res, { ok: false, error: 'LX_SOURCE_SCRIPT_INVALID', message: '没有脚本内容，也没给链接' }, 400);
        return;
      }
      try {
        const record = link
          ? await lxHost.importSourceUrl(link)
          : await lxHost.importSource(script, payload.fileName);
        sendJSON(res, {
          ok: true,
          source: record,
          installed: lxHost.listSources(),
          message: '已导入「' + ((record && record.name) || '未命名音源') + '」',
        });
      } catch (err) {
        fail(res, err, link ? 'LX_SOURCE_IMPORT_URL_FAILED' : 'LX_SOURCE_SCRIPT_INVALID');
      }
      return;
    }

    // ---------- 切换当前音源 ----------
    if (pn === '/api/lx-source/select') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      try {
        const result = await lxHost.selectSource(payload.id);
        sendJSON(res, { ok: true, result, installed: lxHost.listSources() });
      } catch (err) { fail(res, err, 'LX_SOURCE_NOT_FOUND'); }
      return;
    }

    // ---------- 启用 / 停用（备用音源池） ----------
    if (pn === '/api/lx-source/enable') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      try {
        const result = await lxHost.setSourcesEnabled(payload.ids || payload.id, payload.enabled !== false);
        sendJSON(res, { ok: true, result, installed: lxHost.listSources() });
      } catch (err) { fail(res, err, 'LX_SOURCE_NOT_FOUND'); }
      return;
    }

    // ---------- 自检：音源脚本能否初始化、声明了哪些平台 ----------
    if (pn === '/api/lx-source/check') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      try {
        // checkSources 返回 { ok, checked, installed }，不是数组——直接当数组下发会让前端拿不到结果
        const result = await lxHost.checkSources(payload.ids || payload.id);
        sendJSON(res, { ok: true, checked: result.checked || [], installed: result.installed || [] });
      } catch (err) { fail(res, err, 'LX_SOURCE_NOT_FOUND'); }
      return;
    }

    // ---------- 删除 ----------
    if (pn === '/api/lx-source/delete') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      try {
        const result = Array.isArray(payload.ids)
          ? await lxHost.deleteSources(payload.ids)
          : await lxHost.deleteSource(payload.id);
        sendJSON(res, { ok: true, result, installed: lxHost.listSources() });
      } catch (err) { fail(res, err, 'LX_SOURCE_NOT_FOUND'); }
      return;
    }

    // ---------- 取播放地址 ----------
    if (pn === '/api/lx-source/resolve') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      const source = String(payload.source || '').toLowerCase();
      if (!source) { sendJSON(res, { ok: false, error: 'LX_SOURCE_UNSUPPORTED', message: '没指定平台' }, 400); return; }
      const musicInfo = payload.musicInfo && typeof payload.musicInfo === 'object' ? payload.musicInfo : {};
      try {
        const result = await lxHost.resolveMusicUrl(source, musicInfo, String(payload.quality || ''), {
          excludeResolvers: Array.isArray(payload.excludeResolvers) ? payload.excludeResolvers : [],
          maxResolvers: Math.max(1, Math.min(8, Number(payload.maxResolvers) || 6)),
        });
        const rawUrl = String((result && result.url) || '');
        // 取址时就检查代理白名单：否则要等播放器报 MEDIA_ERR_SRC_NOT_SUPPORTED，
        // 用户只看到「播放失败」，完全不知道是域名没放行。
        let hostname = '';
        try { hostname = new URL(rawUrl).hostname.toLowerCase(); } catch (_) { }
        if (!hostname) {
          sendJSON(res, { ok: false, error: 'LX_SOURCE_URL_INVALID', message: '音源返回的播放地址不合法' }, 502);
          return;
        }
        const canProxy = typeof ctx.isAllowedProxyMediaHost === 'function'
          ? ctx.isAllowedProxyMediaHost(hostname)
          : true;
        if (!canProxy) {
          sendJSON(res, {
            ok: false,
            error: 'LX_SOURCE_HOST_NOT_PROXYABLE',
            message: '音源返回的地址域名（' + hostname + '）不在音频代理白名单里，没法播放。'
              + '需要把它加进 server/lib/media-proxy.js 的 PROXY_MEDIA_HOST_SUFFIXES。',
          }, 422);
          return;
        }
        const headers = sanitizeProxyHeaders(result && result.headers);
        const params = { url: rawUrl };
        const headerParam = encodeHeaderParam(headers);
        if (headerParam) params.h = headerParam;
        sendJSON(res, {
          ok: true,
          source,
          url: params.url,
          quality: (result && result.quality) || '',
          requestedQuality: (result && result.requestedQuality) || '',
          resolver: (result && result.resolver) || '',
          // 前端不要直接用 url 播：防盗链要带上 headers，必须走音频代理
          proxy: { path: '/api/audio', params: params },
        });
      } catch (err) { fail(res, err, 'LX_SOURCE_RESOLVE_FAILED', 502); }
      return;
    }

    // ---------- 歌词 ----------
    if (pn === '/api/lx-source/lyric') {
      if (req.method !== 'POST') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return; }
      const payload = await readBody(req);
      const source = String(payload.source || '').toLowerCase();
      const musicInfo = payload.musicInfo && typeof payload.musicInfo === 'object' ? payload.musicInfo : {};
      try {
        const lyrics = await lxHost.resolveLyrics(source, musicInfo);
        sendJSON(res, Object.assign({ ok: true, source }, lyrics));
      } catch (err) { fail(res, err, 'LX_SOURCE_RESOLVE_FAILED', 502); }
      return;
    }
  };
};

module.exports.PROXY_HEADER_ALLOW = PROXY_HEADER_ALLOW;
module.exports.explain = explain;
