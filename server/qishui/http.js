'use strict';

// 汽水音乐：缓存工厂 / 请求封装 / 设备签名 / cookie 与鉴权头构造。
// 从 qishui-api.js 抽出（第 1 刀）。只依赖 ./config，不知道任何业务语义。
//
// cache 实例放在这里（而不是各自业务里）是因为 clearQishuiRuntimeCaches() 要一次清全部，
// 且这些实例有 TTL / 容量上限，必须全进程单例 —— 拆到多处就会出现「清了这边没清那边」。

const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const {
  QISHUI_API_BASE,
  QISHUI_RELATED_MEDIA_PATH,
  QISHUI_FEED_SONG_TAB_PATH,
  QISHUI_SCOPE,
  DEFAULT_QISHUI_TOKEN_FILE,
  QISHUI_UA,
  QISHUI_OAUTH_AUTH_URL,
  QISHUI_OAUTH_TOKEN_URL,
  QISHUI_PUBLIC_ENABLED,
  QISHUI_PUBLIC_SEARCH_URL,
  QISHUI_PUBLIC_CONTENTS_URL,
  QISHUI_VIRTUAL_FEED_PLAYLIST_ID,
  QISHUI_WEB_LIKED_PLAYLIST_ID,
  QISHUI_WEB_RECENT_PLAYLIST_ID,
  QISHUI_WEB_API_BASES,
  QISHUI_WEB_PC_API_BASE,
  QISHUI_PUBLIC_HEADERS,
  QISHUI_WEB_UA,
  QISHUI_PC_APP_UA,
  loadQishuiPcDeviceId,
  QISHUI_PC_DEVICE_ID,
  QISHUI_PC_INSTALL_ID,
  QISHUI_PC_BIZ_TRACE_ID,
  QISHUI_WEB_DEFAULT_PARAMS,
  QISHUI_PC_FIXED,
  firstEnv,
  normalizeQishuiOAuthFileConfig,
  qishuiOAuthConfigFileCandidates,
  readQishuiOAuthFileConfig,
  getQishuiOAuthConfig,
  qishuiOAuthConfigError,
  buildQishuiOAuthAuthorizeUrl,
  qishuiTokenFile,
  normalizeQishuiToken,
} = require('./config');

function createTtlCache(maxEntries, defaultTtlMs) {
  const store = new Map();
  const inflight = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit || Date.now() - hit.at > hit.ttl) return null;
      return hit.value;
    },
    set(key, value, ttlMs) {
      store.set(key, { at: Date.now(), ttl: ttlMs || defaultTtlMs, value });
      if (store.size > maxEntries) {
        const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) store.delete(oldest[0]);
      }
    },
    clear() {
      store.clear();
      inflight.clear();
    },
    async wrap(key, ttlMs, fn) {
      const cached = this.get(key);
      if (cached !== null) return cached;
      if (inflight.has(key)) return inflight.get(key);
      const promise = Promise.resolve().then(fn).then((value) => {
        const resolvedTtlMs = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
        this.set(key, value, resolvedTtlMs);
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },
  };
}

const qishuiSearchCache = createTtlCache(80, 2 * 60 * 1000);

const qishuiLyricCache = createTtlCache(240, 30 * 60 * 1000);

const qishuiPublicDetailCache = createTtlCache(240, 30 * 60 * 1000);

const qishuiFeedCache = createTtlCache(16, 90 * 1000);

const qishuiWebLibraryCache = createTtlCache(24, 90 * 1000);

const qishuiWebPlaylistCache = createTtlCache(48, 90 * 1000);

const qishuiWebPlaylistCursorCache = new Map();

const qishuiMembershipCache = createTtlCache(24, 60 * 1000);

const qishuiTrackMetadataCache = createTtlCache(120, 20 * 1000);

const qishuiPlaybackCache = createTtlCache(120, 4 * 60 * 1000);

function requestText(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          reject(err);
          return;
        }
        resolve(text);
      });
    });
    req.setTimeout(Number(opts.timeoutMs) || 7000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON from Qishui OpenAPI');
    err.cause = e;
    err.body = text;
    throw err;
  }
}

function requestJsonWithMeta(targetUrl, opts, body) {
  opts = opts || {};
  return requestTextWithMeta(targetUrl, opts, body).then(meta => {
    try {
      return { json: JSON.parse(meta.text), headers: meta.headers || {}, statusCode: meta.statusCode };
    } catch (e) {
      const err = new Error('Invalid JSON from Qishui API');
      err.cause = e;
      err.body = meta.text;
      err.headers = meta.headers || {};
      throw err;
    }
  });
}

function requestTextWithMeta(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          err.headers = response.headers || {};
          reject(err);
          return;
        }
        resolve({ text, headers: response.headers || {}, statusCode: response.statusCode });
      });
    });
    req.setTimeout(Number(opts.timeoutMs) || 7000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function urlWithParams(baseUrl, params) {
  const u = new URL(baseUrl);
  Object.keys(params || {}).forEach(key => {
    const value = params[key];
    if (value == null || value === '') return;
    u.searchParams.set(key, String(value));
  });
  return u.toString();
}

function qishuiPcUrl(apiPath, params) {
  const target = /^https?:\/\//i.test(apiPath)
    ? apiPath
    : (QISHUI_WEB_PC_API_BASE + apiPath);
  return urlWithParams(target, params || {});
}

function qishuiPcPassportParams(extra) {
  return Object.assign({
    passport_jssdk_version: QISHUI_PC_FIXED.passport_jssdk_version,
    passport_jssdk_type: QISHUI_PC_FIXED.passport_jssdk_type,
    is_from_ttaccountsdk: QISHUI_PC_FIXED.is_from_ttaccountsdk,
    aid: QISHUI_PC_FIXED.aid,
    language: QISHUI_PC_FIXED.language,
    account_sdk_source: QISHUI_PC_FIXED.account_sdk_source,
    p_js_v: QISHUI_PC_FIXED.p_js_v,
    p_js_t: QISHUI_PC_FIXED.p_js_t,
    p_zt: QISHUI_PC_FIXED.p_zt,
    p_ver: QISHUI_PC_FIXED.p_ver,
    request_host: QISHUI_PC_FIXED.request_host,
    p_bd: QISHUI_PC_FIXED.p_bd,
    biz_trace_id: QISHUI_PC_BIZ_TRACE_ID,
    is_new_login: QISHUI_PC_FIXED.is_new_login,
    is_from_iesaccountsaas: QISHUI_PC_FIXED.is_from_iesaccountsaas,
    device_id: QISHUI_PC_DEVICE_ID,
    install_id: QISHUI_PC_INSTALL_ID,
    did: QISHUI_PC_DEVICE_ID,
    iid: QISHUI_PC_INSTALL_ID,
    device_platform: QISHUI_PC_FIXED.device_platform,
    version_code: QISHUI_PC_FIXED.version_code,
  }, extra || {});
}

function qishuiOrderedForm(params, order) {
  params = params || {};
  const picked = new Set();
  const out = new URLSearchParams();
  (order || []).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      out.append(key, String(params[key] == null ? '' : params[key]));
      picked.add(key);
    }
  });
  Object.keys(params).sort().forEach(key => {
    if (!picked.has(key)) out.append(key, String(params[key] == null ? '' : params[key]));
  });
  return out.toString();
}

function qishuiSetCookieHeader(headers) {
  const raw = headers && (headers['set-cookie'] || headers['Set-Cookie']) || [];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return normalizeQishuiCookieInput(cookies);
}

function qishuiSetCookieSessionId(headers) {
  const obj = qishuiCookieObject(qishuiSetCookieHeader(headers));
  return normalizeText(obj.sessionid || obj.sessionid_ss || obj.sid_guard || obj.sid_tt || '');
}

function qishuiSessionCookieHeader(cookieText) {
  const normalized = normalizeQishuiCookieInput(cookieText);
  const obj = qishuiCookieObject(normalized);
  if (qishuiCookieHasLogin(normalized)) return normalized;
  const sessionid = normalizeText(obj.sessionid || obj.sessionid_ss || '');
  return sessionid ? ('sessionid=' + sessionid + ';') : normalized;
}

function qishuiHeadersWithCookie(headers, cookieText) {
  const out = Object.assign({}, headers || {});
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (cookie) out.Cookie = cookie;
  return out;
}

function qishuiPassportCsrfHeaders(cookieText) {
  const obj = qishuiCookieObject(cookieText);
  const csrf = normalizeText(obj.passport_csrf_token || obj.passport_csrf_token_default || '');
  return csrf ? { 'x-tt-passport-csrf-token': csrf } : {};
}

function qishuiPassportHeaders(cookieText, accept) {
  return qishuiHeadersWithCookie({
    'Accept': accept || 'application/json,text/javascript',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': QISHUI_WEB_UA,
    'Referer': 'app://resources/',
    'sec-ch-ua': '"Not.A/Brand";v="99", "Chromium";v="136"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'bd-ticket-guard-version': '2',
    'bd-ticket-guard-iteration-version': '2',
    'bd-ticket-guard-ree-public-key': 'BAnIxKL96Jby5x+Um9i7HZ2c8O6lfZJRxm6yk73Mqcr06l2qIw2iqu2Mtm3U/6OI98usukA9dqxUlsctVWK9rKA=',
    'bd-ticket-guard-server-cert-sn': '0',
    'X-Tt-Passport-Trace-Id': QISHUI_PC_BIZ_TRACE_ID,
    ...qishuiPassportCsrfHeaders(cookieText),
  }, cookieText);
}

function qishuiQrErrorCode(data, json) {
  const raw = data && (data.error_code || data.errorCode || data.err_code || data.errCode) ||
    json && (json.error_code || json.errorCode || json.err_code || json.errCode) || 0;
  const code = Number(raw);
  return Number.isFinite(code) ? code : 0;
}

function qishuiPcStatusError(payload, fallback) {
  if (!payload || typeof payload !== 'object') return null;
  const code = Number(payload.status_code == null ? payload.error_code : payload.status_code);
  if (!isFinite(code) || code === 0) return null;
  const info = payload.status_info || {};
  const message = normalizeText(info.status_msg || payload.message || payload.status_msg || fallback || 'QISHUI_PC_API_ERROR');
  const err = new Error(message || 'QISHUI_PC_API_ERROR');
  err.code = 'QISHUI_PC_API_' + code;
  err.statusCode = code;
  err.body = payload;
  return err;
}

const QISHUI_COOKIE_ATTRIBUTE_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly']);

function collectQishuiCookiePair(picked, key, value) {
  key = String(key || '').trim();
  if (!key || QISHUI_COOKIE_ATTRIBUTE_NAMES.has(key.toLowerCase())) return;
  if (value === null || value === undefined) return;
  picked.set(key, String(value).trim());
}

function collectQishuiCookieInput(input, picked) {
  if (input === null || input === undefined) return;
  if (Array.isArray(input)) {
    input.forEach(item => collectQishuiCookieInput(item, picked));
    return;
  }
  if (typeof input === 'object') {
    if (input.name && Object.prototype.hasOwnProperty.call(input, 'value')) {
      collectQishuiCookiePair(picked, input.name, input.value);
      return;
    }
    Object.keys(input).forEach(key => {
      const value = input[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectQishuiCookiePair(picked, key, value.value);
      } else if (typeof value !== 'object') {
        collectQishuiCookiePair(picked, key, value);
      }
    });
    return;
  }
  String(input).split(/\r?\n/).forEach(line => {
    line.split(';').forEach(part => {
      const raw = String(part || '').trim();
      const idx = raw.indexOf('=');
      if (idx <= 0) return;
      collectQishuiCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1));
    });
  });
}

function normalizeQishuiCookieInput(input) {
  const picked = new Map();
  collectQishuiCookieInput(input, picked);
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function qishuiCookieObject(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function qishuiCookieHasLogin(cookieText) {
  return /(?:^|;\s*)(sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt|uid_tt_ss)=/i.test(String(cookieText || ''));
}

function qishuiCookieFingerprint(cookieText) {
  const normalized = normalizeQishuiCookieInput(cookieText);
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

function qishuiCookieUserId(cookieText) {
  const obj = qishuiCookieObject(cookieText);
  const raw = String(obj.uid_tt || obj.uid_tt_ss || obj.sessionid || obj.sessionid_ss || obj.sid_guard || '').trim();
  if (!raw) return '';
  return 'web:' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

function clearQishuiRuntimeCaches() {
  qishuiSearchCache.clear && qishuiSearchCache.clear();
  qishuiFeedCache.clear && qishuiFeedCache.clear();
  qishuiWebLibraryCache.clear && qishuiWebLibraryCache.clear();
  qishuiWebPlaylistCache.clear && qishuiWebPlaylistCache.clear();
  qishuiWebPlaylistCursorCache.clear();
  qishuiMembershipCache.clear && qishuiMembershipCache.clear();
  qishuiTrackMetadataCache.clear && qishuiTrackMetadataCache.clear();
  qishuiPlaybackCache.clear && qishuiPlaybackCache.clear();
}

function qishuiAccessTokenInfo() {
  const envKeys = ['QISHUI_ACCESS_TOKEN', 'DOUYIN_ACCESS_TOKEN', 'DOUYIN_OPEN_ACCESS_TOKEN'];
  for (const key of envKeys) {
    const token = normalizeQishuiToken(process.env[key] || '');
    if (token) return { token, source: 'env:' + key, file: qishuiTokenFile() };
  }
  const file = qishuiTokenFile();
  try {
    if (fs.existsSync(file)) {
      const token = normalizeQishuiToken(fs.readFileSync(file, 'utf8'));
      if (token) return { token, source: 'file', file };
    }
  } catch (_) {}
  return { token: '', source: '', file };
}

function qishuiAccessToken() {
  return qishuiAccessTokenInfo().token;
}

function qishuiRestriction(category, message, action, extra) {
  return {
    provider: 'qishui',
    category,
    action: action || '',
    message,
    ...(extra || {}),
  };
}

function qishuiUnavailable(message, category, extra) {
  const restriction = qishuiRestriction(
    category || 'provider_limited',
    message || '汽水音乐开放平台当前没有公开可交给播放器直连的音频 URL，已按匹配源处理。',
    'switch_source',
    { playbackMode: 'recommend-match', scope: QISHUI_SCOPE }
  );
  return Object.assign({
    provider: 'qishui',
    playbackMode: 'recommend-match',
    url: '',
    playable: false,
    trial: false,
    loggedIn: !!qishuiAccessToken(),
    playbackKeyReady: false,
    restriction,
    reason: restriction.category,
    message: restriction.message,
  }, extra || {});
}

function qishuiUrl(apiPath) {
  return QISHUI_API_BASE + apiPath;
}

async function qishuiPost(apiPath, payload) {
  const token = qishuiAccessToken();
  if (!token) {
    const err = new Error('QISHUI_TOKEN_REQUIRED');
    err.code = 'QISHUI_TOKEN_REQUIRED';
    throw err;
  }
  const body = JSON.stringify(payload || {});
  const json = await requestJson(qishuiUrl(apiPath), {
    method: 'POST',
    timeoutMs: 7000,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': QISHUI_UA,
      'access-token': token,
    },
  }, body);
  const errCode = Number(json && json.data && (json.data.error_code || json.data.err_code || json.data.code) || json && (json.error_code || json.err_code || json.code) || 0);
  if (errCode) {
    const err = new Error(String((json && json.data && (json.data.description || json.data.message)) || json.description || json.message || 'QISHUI_API_ERROR'));
    err.code = errCode;
    err.body = json;
    throw err;
  }
  return json;
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function qishuiWebCommonParams(extra, opts) {
  if (opts && opts.noDefaultParams) return Object.assign({}, extra || {});
  return Object.assign({}, QISHUI_WEB_DEFAULT_PARAMS, extra || {});
}

function qishuiPcAppParams(extra) {
  const now = Date.now();
  const deviceId = String(now);
  return Object.assign({
    aid: '386088',
    app_name: 'luna_pc',
    region: 'cn',
    geo_region: 'cn',
    os_region: 'cn',
    sim_region: '',
    device_id: deviceId,
    cdid: '',
    iid: String(now + 1),
    version_name: '3.3.0',
    version_code: '30030000',
    channel: 'official',
    build_mode: 'master',
    network_carrier: '',
    ac: 'wifi',
    tz_name: 'Asia/Shanghai',
    resolution: '',
    device_platform: 'windows',
    device_type: 'Windows',
    os_version: 'Windows 11',
    fp: deviceId,
  }, extra || {});
}

function qishuiWebHeaders(cookieText, opts) {
  const cookie = opts && opts.sessionOnly ? qishuiSessionCookieHeader(cookieText) : normalizeQishuiCookieInput(cookieText);
  const headers = {
    'Accept': 'application/json,text/plain,*/*',
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': opts && opts.pcApp ? QISHUI_PC_APP_UA : QISHUI_WEB_UA,
  };
  if (opts && opts.pcApp) {
    headers['x-luna-background-type'] = 'foreground';
    headers['x-luna-is-background-req'] = '0';
    headers['x-luna-is-local-user'] = '1';
  }
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function qishuiWebRequestJson(apiPath, params, cookieText, opts) {
  opts = opts || {};
  const bases = Array.isArray(opts.bases) && opts.bases.length ? opts.bases : QISHUI_WEB_API_BASES;
  let lastErr = null;
  for (const base of bases) {
    const target = /^https?:\/\//i.test(apiPath) ? apiPath : (String(base || '').replace(/\/+$/, '') + apiPath);
    const targetUrl = urlWithParams(target, qishuiWebCommonParams(params, opts));
    try {
      const json = await requestJson(targetUrl, {
        timeoutMs: opts.timeoutMs || 8000,
        headers: qishuiWebHeaders(cookieText, opts),
      });
      const err = qishuiPcStatusError(json, 'QISHUI_WEB_REQUEST_FAILED');
      if (err) throw err;
      return json;
    } catch (err) {
      lastErr = err;
      if (err && (err.statusCode === 401 || err.statusCode === 403)) break;
    }
  }
  throw lastErr || new Error('QISHUI_WEB_REQUEST_FAILED');
}

async function qishuiPcPostJson(apiPath, payload, cookieText, opts) {
  opts = opts || {};
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) {
    const err = new Error('QISHUI_COOKIE_REQUIRED');
    err.code = 'QISHUI_COOKIE_REQUIRED';
    throw err;
  }
  const body = JSON.stringify(payload || {});
  const json = await requestJson(qishuiPcUrl(apiPath, qishuiPcAppParams(opts.params)), {
    method: 'POST',
    timeoutMs: opts.timeoutMs || 9000,
    headers: Object.assign(qishuiWebHeaders(cookie, { sessionOnly: true, pcApp: true }), {
      'Content-Length': Buffer.byteLength(body),
      'Referer': 'https://www.qishui.com/',
    }),
  }, body);
  const statusError = qishuiPcStatusError(json, opts.errorCode || 'QISHUI_PC_WRITE_FAILED');
  if (statusError) throw statusError;
  return json;
}

module.exports = {
  createTtlCache,
  qishuiSearchCache,
  qishuiLyricCache,
  qishuiPublicDetailCache,
  qishuiFeedCache,
  qishuiWebLibraryCache,
  qishuiWebPlaylistCache,
  qishuiWebPlaylistCursorCache,
  qishuiMembershipCache,
  qishuiTrackMetadataCache,
  qishuiPlaybackCache,
  requestText,
  requestJson,
  requestJsonWithMeta,
  requestTextWithMeta,
  urlWithParams,
  qishuiPcUrl,
  qishuiPcPassportParams,
  qishuiOrderedForm,
  qishuiSetCookieHeader,
  qishuiSetCookieSessionId,
  qishuiSessionCookieHeader,
  qishuiHeadersWithCookie,
  qishuiPassportCsrfHeaders,
  qishuiPassportHeaders,
  qishuiQrErrorCode,
  qishuiPcStatusError,
  QISHUI_COOKIE_ATTRIBUTE_NAMES,
  collectQishuiCookiePair,
  collectQishuiCookieInput,
  normalizeQishuiCookieInput,
  qishuiCookieObject,
  qishuiCookieHasLogin,
  qishuiCookieFingerprint,
  qishuiCookieUserId,
  clearQishuiRuntimeCaches,
  qishuiAccessTokenInfo,
  qishuiAccessToken,
  qishuiRestriction,
  qishuiUnavailable,
  qishuiUrl,
  qishuiPost,
  normalizeText,
  qishuiWebCommonParams,
  qishuiPcAppParams,
  qishuiWebHeaders,
  qishuiWebRequestJson,
  qishuiPcPostJson,
};
