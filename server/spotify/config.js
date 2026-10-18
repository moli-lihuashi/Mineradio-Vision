'use strict';

// Spotify：配置身份 / 常量 / 缓存实例 / 文本与文件工具 / token 文件存取。
//
// 从 spotify-api.js 抽出。零依赖：不 require 任何本地模块。
// `spotifySafeStorage` 是 electron safeStorage 的惰性包装 —— 非 Electron 环境要能降级，
// 所以读它必须走 try/catch，不能在顶层直接调用。

const fs = require('fs');
const path = require('path');

// 本文件原来就是项目根的 spotify-api.js，__dirname 指项目根。
// 搬进 server/spotify/ 后必须用 PROJECT_ROOT，否则 .spotify-credentials.json /
// .spotify-token.json 会去 server/spotify/ 下面找（同一个失效模式在 qishui 第 1 刀、
// server.js 第 9 块都踩过）。这是本次搬迁**唯一**允许的替换，verify 里逐条断言。
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const SPOTIFY_ACCOUNTS_BASE = (process.env.SPOTIFY_ACCOUNTS_BASE || 'https://accounts.spotify.com').replace(/\/+$/, '');

const SPOTIFY_API_BASE = (process.env.SPOTIFY_API_BASE || 'https://api.spotify.com/v1').replace(/\/+$/, '');

const DEFAULT_SPOTIFY_MARKET = String(process.env.MINERADIO_SPOTIFY_MARKET || process.env.SPOTIFY_MARKET || 'US').trim().toUpperCase();

const DEFAULT_SPOTIFY_CONFIG_FILE = path.join(PROJECT_ROOT, '.spotify-credentials.json');

const DEFAULT_SPOTIFY_TOKEN_FILE = path.join(PROJECT_ROOT, '.spotify-token.json');

const DEFAULT_SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:43879/callback';

const DEFAULT_SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
  'playlist-modify-private',
  'playlist-modify-public',
];

const SPOTIFY_LIKED_PLAYLIST_ID = 'spotify-liked';

const SPOTIFY_UA = 'Mineradio/2.0.2 (Spotify Web API bridge)';

const SPOTIFY_SEARCH_LIMIT_MAX = 10;

const SPOTIFY_PLAYLIST_PAGE_LIMIT = 50;

const spotifySearchCache = new Map();

const spotifySearchInflight = new Map();

const SPOTIFY_PROFILE_CACHE_TTL_MS = 60 * 1000;

const SPOTIFY_SHORT_RATE_LIMIT_WAIT_MAX_MS = 5000;

const SPOTIFY_TRANSIENT_RETRY_DELAYS_MS = [320, 900];

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function firstEnv(keys) {
  for (const key of keys) {
    const value = normalizeText(process.env[key]);
    if (value) return value;
  }
  return '';
}

function uniqueList(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    item = normalizeText(item);
    if (!item || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  });
  return out;
}

function normalizeScopes(value) {
  if (Array.isArray(value)) return uniqueList(value);
  return uniqueList(String(value || '').split(/[\s,;]+/));
}

function spotifyConfigFileCandidates() {
  const candidates = [];
  function add(value) {
    value = normalizeText(value);
    if (!value) return;
    const resolved = path.resolve(value);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  }
  add(firstEnv(['SPOTIFY_CONFIG_FILE', 'MINERADIO_SPOTIFY_CONFIG_FILE']));
  add(DEFAULT_SPOTIFY_CONFIG_FILE);
  add(path.join(PROJECT_ROOT, 'spotify-credentials.json'));
  return candidates;
}

function normalizeSpotifyFileConfig(raw, file) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const spotify = raw.spotify && typeof raw.spotify === 'object' ? raw.spotify : raw;
  return {
    clientId: normalizeText(spotify.clientId || spotify.client_id || spotify.id),
    clientSecret: normalizeText(spotify.clientSecret || spotify.client_secret || spotify.secret),
    redirectUri: normalizeText(spotify.redirectUri || spotify.redirect_uri || spotify.callbackUrl || spotify.callback_url),
    scopes: normalizeScopes(spotify.scopes || spotify.scope),
    market: normalizeText(spotify.market || spotify.country || ''),
    file,
    source: file ? 'file' : '',
  };
}

function readSpotifyFileConfig() {
  const candidates = spotifyConfigFileCandidates();
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const config = normalizeSpotifyFileConfig(parsed, file);
      if (config.clientId || config.clientSecret || config.redirectUri || config.scopes.length || config.market) return config;
    } catch (err) {
      console.warn('[SpotifyConfig] ignored invalid config file:', file, err.message);
    }
  }
  return normalizeSpotifyFileConfig(null, '');
}

function getSpotifyConfigFile() {
  return process.env.SPOTIFY_CONFIG_FILE || process.env.MINERADIO_SPOTIFY_CONFIG_FILE || DEFAULT_SPOTIFY_CONFIG_FILE;
}

function saveSpotifyConfig(input) {
  input = input && typeof input === 'object' ? input : {};
  const clientId = normalizeText(input.clientId || input.client_id || input.id);
  const redirectUri = normalizeText(input.redirectUri || input.redirect_uri || input.callbackUrl || input.callback_url) || DEFAULT_SPOTIFY_REDIRECT_URI;
  const scopes = normalizeScopes(input.scopes || input.scope);
  const market = normalizeText(input.market || input.country || DEFAULT_SPOTIFY_MARKET || 'US').toUpperCase();
  if (!clientId) {
    const err = new Error('SPOTIFY_CLIENT_ID_REQUIRED');
    err.code = 'SPOTIFY_CLIENT_ID_REQUIRED';
    err.missing = ['SPOTIFY_CLIENT_ID'];
    throw err;
  }
  const file = getSpotifyConfigFile();
  writeJsonFile(file, {
    spotify: {
      clientId,
      redirectUri,
      scopes: scopes.length ? scopes : DEFAULT_SPOTIFY_SCOPES,
      market,
    },
  });
  return {
    provider: 'spotify',
    ok: true,
    saved: true,
    credentialsFile: file,
    credentialsFileExists: true,
    clientId,
    redirectUri,
    scope: (scopes.length ? scopes : DEFAULT_SPOTIFY_SCOPES).join(' '),
    market,
  };
}

function writeJsonFile(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

function getSpotifyTokenFile() {
  return process.env.SPOTIFY_TOKEN_FILE || process.env.MINERADIO_SPOTIFY_TOKEN_FILE || DEFAULT_SPOTIFY_TOKEN_FILE;
}

// OAuth token 是账号凭据，落盘必须加密（与 desktop/secret-store.js 同一格式：
// "MR" 前缀 + safeStorage/DPAPI 密文）。
const ENCRYPTED_PREFIX = Buffer.from([0x4d, 0x52]); // "MR"

function spotifySafeStorage() {
  try {
    const ss = require('electron').safeStorage;
    if (ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) return ss;
  } catch (_) {}
  return null;
}

function readTokenFilePayload(file) {
  const buf = fs.readFileSync(file);
  if (!buf.length) return {};
  if (buf.length > 2 && buf[0] === ENCRYPTED_PREFIX[0] && buf[1] === ENCRYPTED_PREFIX[1]) {
    const ss = spotifySafeStorage();
    if (!ss) {
      console.warn('[SpotifyToken] encrypted token file present but OS encryption unavailable:', file);
      return {};
    }
    return JSON.parse(ss.decryptString(buf.subarray(2)));
  }
  // 历史明文 token：只有本机加密可用（能立刻在下次写入时升级为密文）才接受；
  // 加密不可用时 fail-closed，宁可让用户重新授权，也不继续信任明文凭据。
  if (!spotifySafeStorage()) {
    console.warn('[SpotifyToken] plaintext token file ignored (OS encryption unavailable):', file);
    return {};
  }
  return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
}

function writeTokenFilePayload(file, payload) {
  const ss = spotifySafeStorage();
  if (!ss) {
    const err = new Error('SPOTIFY_TOKEN_STORAGE_UNAVAILABLE');
    err.code = 'SPOTIFY_TOKEN_STORAGE_UNAVAILABLE';
    throw err;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const enc = ss.encryptString(JSON.stringify(payload));
  fs.writeFileSync(file, Buffer.concat([ENCRYPTED_PREFIX, Buffer.from(enc)]));
}

function getSpotifyOAuthConfig() {
  const fileConfig = readSpotifyFileConfig();
  const envClientId = firstEnv(['SPOTIFY_CLIENT_ID', 'MINERADIO_SPOTIFY_CLIENT_ID']);
  const envClientSecret = firstEnv(['SPOTIFY_CLIENT_SECRET', 'MINERADIO_SPOTIFY_CLIENT_SECRET']);
  const envRedirectUri = firstEnv(['SPOTIFY_REDIRECT_URI', 'MINERADIO_SPOTIFY_REDIRECT_URI']);
  const envScopes = normalizeScopes(firstEnv(['SPOTIFY_SCOPES', 'SPOTIFY_SCOPE', 'MINERADIO_SPOTIFY_SCOPES']));
  const clientId = envClientId || fileConfig.clientId;
  // Desktop PKCE must not depend on a secret stored in the packaged app or user JSON.
  // A client secret is accepted only from a backend-controlled environment for optional client-credentials requests.
  const clientSecret = envClientSecret;
  const redirectUri = envRedirectUri || fileConfig.redirectUri || DEFAULT_SPOTIFY_REDIRECT_URI;
  // Mineradio owns the OAuth flow, so always include the scopes required by
  // the currently exposed account actions. Existing tokens still need a fresh
  // authorization before these newly requested scopes become effective.
  const configuredScopes = envScopes.length ? envScopes : fileConfig.scopes;
  const scopes = uniqueList(DEFAULT_SPOTIFY_SCOPES.concat(configuredScopes || []));
  const market = (firstEnv(['SPOTIFY_MARKET', 'MINERADIO_SPOTIFY_MARKET']) || fileConfig.market || DEFAULT_SPOTIFY_MARKET || 'US').toUpperCase();
  const missing = [];
  if (!clientId) missing.push('SPOTIFY_CLIENT_ID');
  return {
    provider: 'spotify',
    configured: missing.length === 0,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    scope: scopes.join(' '),
    market,
    credentialsFile: fileConfig.file,
    configSource: envClientId || envClientSecret || envRedirectUri || envScopes.length ? 'env' : (fileConfig.source || (redirectUri === DEFAULT_SPOTIFY_REDIRECT_URI ? 'default' : '')),
    missing,
  };
}

function spotifyUrl(pathname, params) {
  const cleanPath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(cleanPath, SPOTIFY_API_BASE + '/');
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

module.exports = {
  SPOTIFY_ACCOUNTS_BASE,
  SPOTIFY_API_BASE,
  DEFAULT_SPOTIFY_MARKET,
  DEFAULT_SPOTIFY_CONFIG_FILE,
  DEFAULT_SPOTIFY_TOKEN_FILE,
  DEFAULT_SPOTIFY_REDIRECT_URI,
  DEFAULT_SPOTIFY_SCOPES,
  SPOTIFY_LIKED_PLAYLIST_ID,
  SPOTIFY_UA,
  SPOTIFY_SEARCH_LIMIT_MAX,
  SPOTIFY_PLAYLIST_PAGE_LIMIT,
  spotifySearchCache,
  spotifySearchInflight,
  SPOTIFY_PROFILE_CACHE_TTL_MS,
  SPOTIFY_SHORT_RATE_LIMIT_WAIT_MAX_MS,
  SPOTIFY_TRANSIENT_RETRY_DELAYS_MS,
  normalizeText,
  firstEnv,
  uniqueList,
  normalizeScopes,
  spotifyConfigFileCandidates,
  normalizeSpotifyFileConfig,
  readSpotifyFileConfig,
  getSpotifyConfigFile,
  saveSpotifyConfig,
  writeJsonFile,
  getSpotifyTokenFile,
  ENCRYPTED_PREFIX,
  spotifySafeStorage,
  readTokenFilePayload,
  writeTokenFilePayload,
  getSpotifyOAuthConfig,
  spotifyUrl,
};
