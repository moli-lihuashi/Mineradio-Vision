'use strict';

// 媒体代理与 API 鉴权：
//   · 出站 HTTP 只允许白名单 CDN（PROXY_MEDIA_HOST_SUFFIXES），并且**逐跳**复核重定向目标，
//     防白名单主机用 302 把请求带进内网 / 本机 / 云元数据地址（SSRF）
//   · DNS 解析后按 IP 再拦一遍（防白名单域名指到 127.0.0.1）
//   · /api/* token 鉴权：header `x-mineradio-token`，音频/封面额外允许 query token
//   · 音频请求头（各平台 Referer）、Content-Type 推断、Range 响应
// 从 server.js 抽出（原 server.js 1915–2184）。不 require server.js，避免循环依赖。
//
// deps: { dns, fetchWithTimeout, UA, PROXY_FETCH_TIMEOUT_MS, API_AUTH_QUERY_TOKEN_PATHS, getApiToken }
//   getApiToken 是函数而不是值：API_TOKEN 是 server.js 的 let，ensureApiToken() 会重新赋值。

module.exports = function createMediaProxy(deps) {
  const {
    dns,
    fetchWithTimeout,
    UA,
    PROXY_FETCH_TIMEOUT_MS,
    API_AUTH_QUERY_TOKEN_PATHS,
    getApiToken,
  } = deps || {};

  const PROXY_MEDIA_HOST_SUFFIXES = [
    'music.163.com',
    '126.net',
    '127.net',
    '128cdn.net',
    'qq.com',
    'qpic.cn',
    'qlogo.cn',
    'gtimg.com',
    'myqcloud.com',
    'cloudfront.net',
    'kugou.com',
    'kgimg.com',
    'kuwo.cn',
    'ydns.cn',
    'huoshanstatic.com',
    'bytecdntp.com',
    'tencentmusic.com',
    'volccdn.com',
    'byteimg.com',
    'ibytedtos.com',
    'douyinpic.com',
    'douyin.com',
    // 汽水(H5 取址回退链)下发的是 ByteDance VOD 音频流，主机形如
    // v26-luna.douyinvod.com / v5-luna.douyinvod.com（vNN-luna 前缀会轮换）。
    // 注意 douyinvod.com 不是 douyin.com 的子域，用后缀 'douyin.com' 匹配不到。
    'douyinvod.com',
    'toutiao.com',
  ];

  function isBlockedProxyAddress(address) {
    const h = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (isBlockedProxyHost(h)) return true;
    if (h.includes(':')) {
      if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    }
    if (/^169\.254\./.test(h)) return true;
    return false;
  }

  function isBlockedProxyHost(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
    if (h === '0.0.0.0' || h === '::1') return true;
    if (/^127(?:\.|$)/.test(h)) return true;
    if (/^10(?:\.|$)/.test(h)) return true;
    if (/^192\.168(?:\.|$)/.test(h)) return true;
    if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.|$)/.test(h)) return true;
    if (h.endsWith('.internal') || h.endsWith('.lan')) return true;
    return false;
  }

  function isAllowedProxyMediaHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (isBlockedProxyHost(h)) return false;
    return PROXY_MEDIA_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith('.' + suffix));
  }

  async function assertProxyableMediaUrl(raw, label) {
    const value = String(raw || '').trim();
    const tag = String(label || 'URL').toUpperCase();
    if (!value) throw new Error(tag + '_MISSING');
    let parsed;
    try { parsed = new URL(value); } catch (_) { throw new Error('INVALID_' + tag); }
    if (!/^https?:$/i.test(parsed.protocol)) throw new Error('INVALID_' + tag + '_PROTOCOL');
    if (!isAllowedProxyMediaHost(parsed.hostname)) throw new Error('PROXY_HOST_NOT_ALLOWED');
    let addrs = [];
    try {
      addrs = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    } catch (e) {
      throw new Error('PROXY_DNS_FAILED');
    }
    if (!addrs.length) throw new Error('PROXY_DNS_FAILED');
    for (const entry of addrs) {
      if (isBlockedProxyAddress(entry.address)) throw new Error('PROXY_IP_NOT_ALLOWED');
    }
    return parsed.toString();
  }

  // 代理媒体拉取：manual 重定向 + 逐跳重新校验，防白名单 CDN 用 302 把请求带进内网/本机。
  // 合法 CDN 跳转（同白名单 host）仍可跟随，最多 PROXY_MEDIA_MAX_REDIRECTS 跳。
  const PROXY_MEDIA_MAX_REDIRECTS = 5;
  async function fetchProxiedMedia(mediaUrl, headers, redirectsLeft) {
    const hopsLeft = redirectsLeft == null ? PROXY_MEDIA_MAX_REDIRECTS : redirectsLeft;
    const resp = await fetchWithTimeout(mediaUrl, { headers: headers || {}, redirect: 'manual' }, PROXY_FETCH_TIMEOUT_MS);
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers && resp.headers.get ? resp.headers.get('location') : '';
      if (!location) return resp;
      if (hopsLeft <= 0) throw new Error('PROXY_REDIRECT_LIMIT');
      const nextUrl = new URL(location, mediaUrl).toString();
      await assertProxyableMediaUrl(nextUrl, 'PROXY_REDIRECT');
      return fetchProxiedMedia(nextUrl, headers, hopsLeft - 1);
    }
    return resp;
  }

  function requiresApiAuth(pathname) {
    return String(pathname || '').startsWith('/api/');
  }

  function assertApiAuth(req, pathname, searchParams) {
    if (!requiresApiAuth(pathname)) return true;
    const headerToken = String(req.headers['x-mineradio-token'] || '').trim();
    let queryToken = '';
    if (API_AUTH_QUERY_TOKEN_PATHS.has(pathname) && searchParams) {
      queryToken = String(searchParams.get('token') || searchParams.get('t') || '').trim();
    }
    const token = headerToken || queryToken;
    return token && token === getApiToken();
  }

  function audioProxyHeadersFor(audioUrl, range) {
    const headers = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
    try {
      const host = new URL(audioUrl).hostname.toLowerCase();
      if (host.includes('qq.com') || host.includes('qpic.cn')) headers.Referer = 'https://y.qq.com/';
      else if (host.includes('kugou.com') || host.includes('kgimg.com')) headers.Referer = 'https://www.kugou.com/';
      else if (
        host.includes('huoshanstatic.com') || host.includes('bytecdntp.com') || host.includes('volccdn.com') ||
        host.includes('byteimg.com') || host.includes('ibytedtos.com') || host.includes('douyin.com') ||
        host.includes('douyinvod.com') || host.includes('toutiao.com')
      ) headers.Referer = 'https://music.qishui.com/';
    } catch (e) {}
    if (range) headers.Range = range;
    return headers;
  }

  function audioContentTypeForUrl(audioUrl, upstreamType) {
    let pathname = '';
    let host = '';
    try { const parsed = new URL(audioUrl); pathname = parsed.pathname.toLowerCase(); host = parsed.hostname.toLowerCase(); } catch (e) {}
    if (/\.flac$/.test(pathname)) return 'audio/flac';
    if (/\.mp3$/.test(pathname)) return 'audio/mpeg';
    if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4';
    if (/\.ogg$/.test(pathname)) return 'audio/ogg';
    if (/\.wav$/.test(pathname)) return 'audio/wav';
    // 汽水 VOD 音频流的路径没有扩展名（/…/video/tos/cn/…/），上游给的是 video/mp4。
    // 内容是纯音频 m4a，按 audio/mp4 下发，避免下游把它当视频处理。
    if (host.endsWith('douyinvod.com') && /^video\/mp4/i.test(String(upstreamType || ''))) return 'audio/mp4';
    return upstreamType || 'audio/mpeg';
  }

  function sendAudioBuffer(res, buffer, contentType, range) {
    const total = buffer.length;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range || ''));
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : total - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + total });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': contentType || 'audio/mp4',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
      });
      res.end(buffer.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType || 'audio/mp4',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Length': total,
    });
    res.end(buffer);
  }

  return {
    PROXY_MEDIA_HOST_SUFFIXES,
    isBlockedProxyAddress,
    isBlockedProxyHost,
    isAllowedProxyMediaHost,
    assertProxyableMediaUrl,
    fetchProxiedMedia,
    requiresApiAuth,
    assertApiAuth,
    audioProxyHeadersFor,
    audioContentTypeForUrl,
    sendAudioBuffer,
  };
};
