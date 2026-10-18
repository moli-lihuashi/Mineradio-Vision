'use strict';

// Spotify：请求封装 / 签名头 / token 获取与刷新 / 限流退避。
//
// 从 spotify-api.js 抽出。单向依赖 config ——
// 只负责「把请求发出去、把 401/429/5xx 变成可判定的重试或失效」。

const fs = require('fs');
const https = require('https');

const {
  SPOTIFY_ACCOUNTS_BASE,
  DEFAULT_SPOTIFY_SCOPES,
  SPOTIFY_UA,
  spotifySearchCache,
  spotifySearchInflight,
  SPOTIFY_SHORT_RATE_LIMIT_WAIT_MAX_MS,
  SPOTIFY_TRANSIENT_RETRY_DELAYS_MS,
  normalizeText,
  getSpotifyTokenFile,
  readTokenFilePayload,
  writeTokenFilePayload,
  getSpotifyOAuthConfig,
  spotifyUrl,
} = require('./config');

let spotifyClientTokenCache = { token: '', expiresAt: 0 };

let spotifyClientTokenRefreshPromise = null;

let spotifyUserTokenRefreshPromise = null;

let spotifyProfileCache = { value: null, at: 0, promise: null };

function readStoredSpotifyToken() {
  const file = getSpotifyTokenFile();
  try {
    if (!file || !fs.existsSync(file)) return { file, accessToken: '', refreshToken: '', expiresAt: 0 };
    const raw = readTokenFilePayload(file);
    return {
      file,
      accessToken: normalizeText(raw.accessToken || raw.access_token),
      refreshToken: normalizeText(raw.refreshToken || raw.refresh_token),
      tokenType: normalizeText(raw.tokenType || raw.token_type || 'Bearer') || 'Bearer',
      scope: normalizeText(raw.scope || (Array.isArray(raw.scopes) ? raw.scopes.join(' ') : '')),
      expiresAt: Number(raw.expiresAt || raw.expires_at || 0) || 0,
      createdAt: Number(raw.createdAt || raw.created_at || 0) || 0,
      authorizedAt: Number(raw.authorizedAt || raw.authorized_at || 0) || 0,
    };
  } catch (err) {
    console.warn('[SpotifyToken] ignored invalid token file:', file, err.message);
    return { file, accessToken: '', refreshToken: '', expiresAt: 0, invalid: true };
  }
}

function saveSpotifyOAuthToken(payload) {
  payload = payload || {};
  const previous = readStoredSpotifyToken();
  const expiresIn = Math.max(60, Number(payload.expires_in || payload.expiresIn) || 3600);
  const now = Date.now();
  const saved = {
    accessToken: normalizeText(payload.access_token || payload.accessToken),
    refreshToken: normalizeText(payload.refresh_token || payload.refreshToken || previous.refreshToken),
    tokenType: normalizeText(payload.token_type || payload.tokenType || 'Bearer') || 'Bearer',
    scope: normalizeText(payload.scope || previous.scope || DEFAULT_SPOTIFY_SCOPES.join(' ')),
    expiresAt: Number(payload.expiresAt || payload.expires_at) || (now + expiresIn * 1000),
    createdAt: now,
    authorizedAt: payload.newAuthorization || payload.new_authorization
      ? now
      : (Number(payload.authorizedAt || payload.authorized_at || previous.authorizedAt || 0) || now),
  };
  if (!saved.accessToken && !saved.refreshToken) {
    const err = new Error('SPOTIFY_TOKEN_MISSING');
    err.code = 'SPOTIFY_TOKEN_MISSING';
    throw err;
  }
  writeTokenFilePayload(getSpotifyTokenFile(), saved);
  spotifyProfileCache = { value: null, at: 0, promise: null };
  return {
    provider: 'spotify',
    loggedIn: !!saved.accessToken,
    tokenConfigured: !!(saved.accessToken || saved.refreshToken),
    expiresAt: saved.expiresAt,
    scope: saved.scope,
  };
}

function clearSpotifyToken() {
  try {
    const file = getSpotifyTokenFile();
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.warn('[SpotifyToken] clear skipped:', err.message);
  }
  spotifyProfileCache = { value: null, at: 0, promise: null };
  return { ok: true, provider: 'spotify', loggedIn: false };
}

function getSpotifyConfig() {
  const oauth = getSpotifyOAuthConfig();
  const token = readStoredSpotifyToken();
  const tokenFileExists = !!(token.file && fs.existsSync(token.file));
  const credentialsFileExists = !!(oauth.credentialsFile && fs.existsSync(oauth.credentialsFile));
  const clientCredentialsConfigured = !!(oauth.clientId && oauth.clientSecret);
  const oauthConfigured = !!(oauth.clientId && oauth.redirectUri);
  const tokenConfigured = !!(token.accessToken || token.refreshToken);
  const localConfigMissing = !tokenConfigured && !oauth.clientId && !credentialsFileExists;
  const spotifyConfigMessage = clientCredentialsConfigured || tokenConfigured
    ? 'Spotify Web API 已接入；播放仍会按匹配源自动换源。'
    : (localConfigMissing
      ? 'Spotify 未连接：请先粘贴一次 Client ID 保存配置，再打开官方 OAuth 授权。'
      : 'Spotify 已保存 Client ID，可直接打开官方 OAuth 授权；桌面端使用 PKCE，不保存 Client Secret。');
  const missing = [];
  if (!oauth.clientId) missing.push('SPOTIFY_CLIENT_ID');
  const clientCredentialsMissing = [];
  if (!oauth.clientId) clientCredentialsMissing.push('SPOTIFY_CLIENT_ID');
  if (!oauth.clientSecret) clientCredentialsMissing.push('SPOTIFY_CLIENT_SECRET');
  return {
    provider: 'spotify',
    configured: !!(clientCredentialsConfigured || oauthConfigured || tokenConfigured),
    loggedIn: false,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    redirectUri: oauth.redirectUri,
    scopes: oauth.scopes,
    scope: oauth.scope,
    market: oauth.market,
    clientCredentialsConfigured,
    clientCredentialsMissing,
    oauthConfigured,
    oauthMissing: oauth.missing,
    tokenConfigured,
    tokenFileExists,
    tokenReady: !!(token.accessToken && Date.now() < token.expiresAt - 30000),
    authorizedAt: token.authorizedAt || 0,
    tokenFile: token.file,
    credentialsFile: oauth.credentialsFile,
    credentialsFileExists,
    localConfigMissing,
    configSource: oauth.configSource,
    missing,
    playbackMode: 'recommend-match',
    capabilities: {
      search: clientCredentialsConfigured || tokenConfigured,
      metadata: clientCredentialsConfigured || tokenConfigured,
      lyric: false,
      playableUrl: false,
      userPlaylists: tokenConfigured,
      likedTracks: tokenConfigured,
    },
    message: spotifyConfigMessage,
  };
}

function requestText(targetUrl, opts, body) {
  opts = opts || {};
  const timeoutMs = Number(opts.timeoutMs) || 10000;
  const method = opts.method || (body == null ? 'GET' : 'POST');
  const headers = Object.assign({ 'User-Agent': SPOTIFY_UA }, opts.headers || {});
  return new Promise((resolve, reject) => {
    const req = https.request(targetUrl, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text);
          return;
        }
        const err = new Error('SPOTIFY_HTTP_' + res.statusCode);
        err.statusCode = res.statusCode;
        err.body = text;
        err.retryAfter = res.headers && res.headers['retry-after'];
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('SPOTIFY_REQUEST_TIMEOUT')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    err.message = 'SPOTIFY_JSON_PARSE_FAILED: ' + err.message;
    throw err;
  }
}

function spotifyTokenHeaders(config, useClientSecret) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (useClientSecret && config && config.clientSecret) {
    headers.Authorization = 'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64');
  }
  return headers;
}

function spotifyErrorDetails(err) {
  err = err || {};
  let apiMessage = '';
  let apiStatus = '';
  try {
    const body = err.body ? JSON.parse(String(err.body)) : null;
    if (body && body.error) {
      if (typeof body.error === 'string') {
        apiMessage = body.error_description || body.error;
      } else {
        apiMessage = body.error.message || body.error.reason || '';
        apiStatus = body.error.status || '';
      }
    }
  } catch (parseErr) { }
  const statusCode = Number(err.statusCode || apiStatus || 0) || 0;
  const oauthCode = normalizeText(spotifyTokenErrorBody(err).error);
  const code = normalizeText(err.code || oauthCode || (statusCode ? ('SPOTIFY_HTTP_' + statusCode) : err.message)) || 'SPOTIFY_ERROR';
  let message = apiMessage || normalizeText(err.message) || 'Spotify 请求失败';
  const reauthRequired = !!err.reauthRequired || code === 'SPOTIFY_REAUTH_REQUIRED' || oauthCode === 'invalid_grant';
  if (reauthRequired || statusCode === 401 || code === 'SPOTIFY_REFRESH_TOKEN_MISSING') {
    message = 'Spotify 登录已过期，请重新连接 Spotify。';
  } else if (statusCode === 429) {
    const seconds = Math.max(1, Math.ceil(Number(err.retryAfterMs || spotifyRetryAfterMs(err)) / 1000));
    message = 'Spotify 请求过于频繁，请约 ' + seconds + ' 秒后重试。';
  } else if (statusCode === 403) {
    message = 'Spotify 授权权限不够，请在 Spotify 登录面板里重新连接一次。';
  } else if (statusCode === 404) {
    message = 'Spotify 没找到这个歌单，可能已删除、未公开或当前账号无权访问。';
  } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
    message = 'Spotify 服务暂时不可用，Mineradio 已完成有限重试，请稍后再试。';
  } else if (/scope|permission|insufficient/i.test(apiMessage || code)) {
    message = 'Spotify 授权权限不够，请重新连接 Spotify 后再同步歌单。';
  }
  return {
    error: code,
    message,
    statusCode,
    spotifyApiMessage: apiMessage,
    retryAfterSeconds: Math.max(0, Math.ceil(Number(err.retryAfterMs || spotifyRetryAfterMs(err)) / 1000)),
    reauthRequired,
  };
}

function spotifyTokenErrorBody(err) {
  try { return err && err.body ? JSON.parse(String(err.body)) : {}; } catch (_) { return {}; }
}

function spotifyInvalidGrant(err) {
  const body = spotifyTokenErrorBody(err);
  return normalizeText(body && body.error).toLowerCase() === 'invalid_grant';
}

async function requestSpotifyToken(bodyParams, opts) {
  opts = opts || {};
  const config = getSpotifyOAuthConfig();
  if (!config.clientId) {
    const err = new Error('SPOTIFY_CLIENT_ID_REQUIRED');
    err.code = 'SPOTIFY_CLIENT_ID_REQUIRED';
    err.missing = ['SPOTIFY_CLIENT_ID'];
    throw err;
  }
  bodyParams = Object.assign({ client_id: config.clientId }, bodyParams || {});
  const body = new URLSearchParams(bodyParams).toString();
  return requestJson(SPOTIFY_ACCOUNTS_BASE + '/api/token', {
    method: 'POST',
    timeoutMs: 9000,
    headers: spotifyTokenHeaders(config, !!opts.useClientSecret),
  }, body);
}

async function getSpotifyClientCredentialsAccessToken() {
  const config = getSpotifyOAuthConfig();
  if (!config.clientId || !config.clientSecret) {
    const err = new Error('SPOTIFY_CREDENTIALS_REQUIRED');
    err.status = getSpotifyConfig();
    throw err;
  }
  const now = Date.now();
  if (spotifyClientTokenCache.token && now < spotifyClientTokenCache.expiresAt - 30000) return spotifyClientTokenCache.token;
  if (spotifyClientTokenRefreshPromise) return spotifyClientTokenRefreshPromise;
  spotifyClientTokenRefreshPromise = (async () => {
    const json = await requestSpotifyToken({ grant_type: 'client_credentials' }, { useClientSecret: true });
    const token = normalizeText(json && json.access_token);
    if (!token) throw new Error('SPOTIFY_TOKEN_MISSING');
    const expiresIn = Math.max(60, Number(json.expires_in) || 3600);
    spotifyClientTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  })().finally(() => { spotifyClientTokenRefreshPromise = null; });
  return spotifyClientTokenRefreshPromise;
}

function invalidateSpotifyAccessToken() {
  const stored = readStoredSpotifyToken();
  if (!stored.refreshToken) return clearSpotifyToken();
  try {
    writeTokenFilePayload(getSpotifyTokenFile(), {
      accessToken: '',
      refreshToken: stored.refreshToken,
      tokenType: stored.tokenType || 'Bearer',
      scope: stored.scope || DEFAULT_SPOTIFY_SCOPES.join(' '),
      expiresAt: 0,
      createdAt: stored.createdAt || 0,
      authorizedAt: stored.authorizedAt || 0,
    });
  } catch (err) {
    // 失效标记写不进去不该让刷新链路整体失败，只记日志（内存态仍是未登录）
    console.warn('[SpotifyToken] invalidate write skipped:', err.message);
  }
  return { ok: true, provider: 'spotify', loggedIn: false, tokenConfigured: true };
}

async function refreshSpotifyUserToken() {
  if (spotifyUserTokenRefreshPromise) return spotifyUserTokenRefreshPromise;
  spotifyUserTokenRefreshPromise = (async () => {
    const stored = readStoredSpotifyToken();
    if (!stored.refreshToken) {
      const err = new Error('SPOTIFY_REFRESH_TOKEN_MISSING');
      err.code = 'SPOTIFY_REFRESH_TOKEN_MISSING';
      err.reauthRequired = true;
      throw err;
    }
    try {
      const json = await requestSpotifyToken({
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
      });
      const token = normalizeText(json && json.access_token);
      if (!token) throw new Error('SPOTIFY_TOKEN_MISSING');
      saveSpotifyOAuthToken(Object.assign({}, json, {
        refresh_token: json.refresh_token || stored.refreshToken,
        scope: json.scope || stored.scope,
        authorizedAt: stored.authorizedAt || 0,
      }));
      return readStoredSpotifyToken();
    } catch (err) {
      if (spotifyInvalidGrant(err)) {
        clearSpotifyToken();
        err.code = 'SPOTIFY_REAUTH_REQUIRED';
        err.reauthRequired = true;
      }
      throw err;
    }
  })().finally(() => { spotifyUserTokenRefreshPromise = null; });
  return spotifyUserTokenRefreshPromise;
}

async function getSpotifyUserAccessToken() {
  let stored = readStoredSpotifyToken();
  if (stored.accessToken && Date.now() < stored.expiresAt - 30000) return stored.accessToken;
  stored = await refreshSpotifyUserToken();
  if (!stored.accessToken) throw new Error('SPOTIFY_TOKEN_MISSING');
  return stored.accessToken;
}

async function getSpotifyApiAccessToken(opts) {
  opts = opts || {};
  if (opts.preferUser !== false) {
    const stored = readStoredSpotifyToken();
    if (stored.accessToken || stored.refreshToken) {
      try {
        return await getSpotifyUserAccessToken();
      } catch (err) {
        if (!getSpotifyConfig().clientCredentialsConfigured) throw err;
      }
    }
  }
  return getSpotifyClientCredentialsAccessToken();
}

function spotifyDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function spotifyRetryAfterMs(err) {
  const seconds = Number(err && err.retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : 0;
}

function spotifyTransientError(err) {
  const status = Number(err && err.statusCode || 0);
  return status === 500 || status === 502 || status === 503 ||
    /SPOTIFY_REQUEST_TIMEOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ETIMEDOUT/i.test(String(err && (err.code || err.message) || ''));
}

async function spotifyUserRequest(pathname, method, params, payload, opts) {
  opts = opts || {};
  method = String(method || 'GET').toUpperCase();
  let token = normalizeText(opts.accessToken) || await getSpotifyUserAccessToken();
  const explicitToken = normalizeText(opts.accessToken);
  let authRetried = false;
  let transientAttempt = 0;
  const body = payload == null ? null : JSON.stringify(payload);
  while (true) {
    try {
      return await requestJson(spotifyUrl(pathname, params || {}), {
        method,
        timeoutMs: opts.timeoutMs || 9000,
        headers: Object.assign({
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
        }, body == null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }),
      }, body);
    } catch (err) {
      const status = Number(err && err.statusCode || 0);
      if (status === 401 && !explicitToken && !authRetried) {
        authRetried = true;
        invalidateSpotifyAccessToken();
        token = await getSpotifyUserAccessToken();
        continue;
      }
      if (status === 429) {
        const waitMs = spotifyRetryAfterMs(err);
        err.retryAfterMs = waitMs;
        if (!opts.noRetry && transientAttempt === 0 && waitMs > 0 && waitMs <= SPOTIFY_SHORT_RATE_LIMIT_WAIT_MAX_MS) {
          transientAttempt += 1;
          await spotifyDelay(waitMs);
          continue;
        }
      } else if (!opts.noRetry && transientAttempt < SPOTIFY_TRANSIENT_RETRY_DELAYS_MS.length && spotifyTransientError(err)) {
        const waitMs = SPOTIFY_TRANSIENT_RETRY_DELAYS_MS[transientAttempt] + Math.floor(Math.random() * 120);
        transientAttempt += 1;
        await spotifyDelay(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function spotifyGet(pathname, params, opts) {
  opts = opts || {};
  const preferUser = opts.userOnly || opts.preferUser !== false;
  const explicitToken = normalizeText(opts.accessToken);
  let token = explicitToken || (opts.userOnly
    ? await getSpotifyUserAccessToken()
    : await getSpotifyApiAccessToken({ preferUser }));
  let authRetried = false;
  let transientAttempt = 0;
  while (true) {
    try {
      return await requestJson(spotifyUrl(pathname, params || {}), {
        timeoutMs: opts.timeoutMs || 9000,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      const status = Number(err && err.statusCode || 0);
      if (status === 401 && !explicitToken && !authRetried) {
        authRetried = true;
        const stored = readStoredSpotifyToken();
        if (opts.userOnly || (preferUser && (stored.accessToken || stored.refreshToken))) {
          invalidateSpotifyAccessToken();
          token = await getSpotifyUserAccessToken();
        } else {
          spotifyClientTokenCache = { token: '', expiresAt: 0 };
          token = await getSpotifyClientCredentialsAccessToken();
        }
        continue;
      }
      if (status === 429) {
        const waitMs = spotifyRetryAfterMs(err);
        err.retryAfterMs = waitMs;
        if (!opts.noRetry && transientAttempt === 0 && waitMs > 0 && waitMs <= SPOTIFY_SHORT_RATE_LIMIT_WAIT_MAX_MS) {
          transientAttempt += 1;
          await spotifyDelay(waitMs);
          continue;
        }
      } else if (!opts.noRetry && transientAttempt < SPOTIFY_TRANSIENT_RETRY_DELAYS_MS.length && spotifyTransientError(err)) {
        const waitMs = SPOTIFY_TRANSIENT_RETRY_DELAYS_MS[transientAttempt] + Math.floor(Math.random() * 120);
        transientAttempt += 1;
        await spotifyDelay(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function spotifyUserGet(pathname, params, opts) {
  opts = opts || {};
  return spotifyGet(pathname, params, Object.assign({}, opts, { userOnly: true, preferUser: true }));
}

function cacheWrap(map, key, ttlMs, loader) {
  const now = Date.now();
  const cached = map.get(key);
  if (cached && now - cached.at < ttlMs) return Promise.resolve(cached.value);
  if (spotifySearchInflight.has(key)) return spotifySearchInflight.get(key);
  const promise = Promise.resolve(loader()).then((value) => {
    map.set(key, { at: Date.now(), value });
    if (map.size > 80) {
      const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) map.delete(oldest[0]);
    }
    return value;
  }).finally(() => spotifySearchInflight.delete(key));
  spotifySearchInflight.set(key, promise);
  return promise;
}

function resetSpotifyRuntimeStateForTests() {
  spotifyClientTokenCache = { token: '', expiresAt: 0 };
  spotifyClientTokenRefreshPromise = null;
  spotifyUserTokenRefreshPromise = null;
  spotifyProfileCache = { value: null, at: 0, promise: null };
  spotifySearchCache.clear();
  spotifySearchInflight.clear();
}

module.exports = {
  spotifyClientTokenCache,
  spotifyClientTokenRefreshPromise,
  spotifyUserTokenRefreshPromise,
  spotifyProfileCache,
  readStoredSpotifyToken,
  saveSpotifyOAuthToken,
  clearSpotifyToken,
  getSpotifyConfig,
  requestText,
  requestJson,
  spotifyTokenHeaders,
  spotifyErrorDetails,
  spotifyTokenErrorBody,
  spotifyInvalidGrant,
  requestSpotifyToken,
  getSpotifyClientCredentialsAccessToken,
  invalidateSpotifyAccessToken,
  refreshSpotifyUserToken,
  getSpotifyUserAccessToken,
  getSpotifyApiAccessToken,
  spotifyDelay,
  spotifyRetryAfterMs,
  spotifyTransientError,
  spotifyUserRequest,
  spotifyGet,
  spotifyUserGet,
  cacheWrap,
  resetSpotifyRuntimeStateForTests,
};
