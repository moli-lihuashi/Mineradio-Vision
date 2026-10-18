'use strict';

// 汽水音乐：环境 / 端点 / 设备身份 / OAuth 配置。
// 从 qishui-api.js 抽出（第 1 刀）。纯声明 + 读文件，无网络请求。
//
// 注意：本文件原来住在项目根（qishui-api.js），__dirname 指项目根；
// 搬到 server/qishui/ 后必须用 PROJECT_ROOT，否则 .qishui-token / .qishui-oauth.json
// 会去 server/qishui/ 下面找（第 9 块 `path` 漏注入同一个失效模式）。

const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const QISHUI_API_BASE = (process.env.QISHUI_API_BASE || 'https://open.douyin.com').replace(/\/+$/, '');

const QISHUI_RELATED_MEDIA_PATH = '/api/luna/v1/platform/feed/related-media/';

const QISHUI_FEED_SONG_TAB_PATH = '/api/luna/v1/platform/feed/song-tab/';

const QISHUI_SCOPE = 'luna.openapi.platform.play_core';

const DEFAULT_QISHUI_TOKEN_FILE = path.join(PROJECT_ROOT, '.qishui-token');

const QISHUI_UA = 'Mineradio/2.0.2 (Qishui official OpenAPI bridge)';

const QISHUI_OAUTH_AUTH_URL = (process.env.QISHUI_OAUTH_AUTH_URL || 'https://open.douyin.com/platform/oauth/connect').replace(/\/+$/, '');

const QISHUI_OAUTH_TOKEN_URL = process.env.QISHUI_OAUTH_TOKEN_URL || 'https://open.douyin.com/oauth/access_token/';

const QISHUI_PUBLIC_ENABLED = process.env.QISHUI_PUBLIC_ENABLED !== '0';

const QISHUI_PUBLIC_SEARCH_URL = process.env.QISHUI_PUBLIC_SEARCH_URL || 'https://api-vehicle.volcengine.com/v2/search/type';

const QISHUI_PUBLIC_CONTENTS_URL = process.env.QISHUI_PUBLIC_CONTENTS_URL || 'https://api-vehicle.volcengine.com/v2/custom/contents';

const QISHUI_VIRTUAL_FEED_PLAYLIST_ID = 'qishui-feed';

const QISHUI_WEB_LIKED_PLAYLIST_ID = 'qishui-liked';

const QISHUI_WEB_RECENT_PLAYLIST_ID = 'qishui-recent';

const QISHUI_WEB_API_BASES = (process.env.QISHUI_WEB_API_BASES || 'https://api5-lq.qishui.com,https://api.qishui.com')
  .split(',')
  .map(item => item.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const QISHUI_WEB_PC_API_BASE = (process.env.QISHUI_WEB_PC_API_BASE || 'https://api.qishui.com').replace(/\/+$/, '');

const QISHUI_PUBLIC_HEADERS = {
  'Accept': 'application/json,text/plain,*/*',
  'User-Agent': 'Mineradio/2.0.2 (Qishui public catalog bridge)',
};

const QISHUI_WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.1.0 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

const QISHUI_PC_APP_UA = 'LunaPC/3.3.0(359450208)';

// device_id 持久化：模块级 Date.now() 会让每次重启都换新身份，易触发汽水风控；
// 跨进程稳定后行为更接近真实客户端。
function loadQishuiPcDeviceId() {
  const file = path.join(require('os').tmpdir(), 'mineradio-qishui-device');
  try {
    if (fs.existsSync(file)) {
      const id = fs.readFileSync(file, 'utf8').trim();
      if (/^\d+$/.test(id)) return id;
    }
  } catch (e) {}
  const fresh = String(Date.now());
  try { fs.writeFileSync(file, fresh, 'utf8'); } catch (e) {}
  return fresh;
}

const QISHUI_PC_DEVICE_ID = loadQishuiPcDeviceId();

const QISHUI_PC_INSTALL_ID = String(Number(QISHUI_PC_DEVICE_ID) + 1);

const QISHUI_PC_BIZ_TRACE_ID = crypto.randomBytes(4).toString('hex');

const QISHUI_WEB_DEFAULT_PARAMS = {
  aid: '386088',
  app_name: 'luna_pc',
  device_platform: 'web',
  channel: 'pc_web',
};

const QISHUI_PC_FIXED = {
  aid: '386088',
  passport_jssdk_version: '2.4.13',
  passport_jssdk_type: 'normal',
  is_from_ttaccountsdk: '1',
  next: 'https://api.qishui.com',
  need_logo: 'false',
  need_short_url: 'false',
  is_frontier: 'true',
  is_new_login: '1',
  language: 'zh',
  account_sdk_source: 'web',
  p_js_v: '2.4.13',
  p_js_t: 'pro',
  p_zt: '3.3.5',
  p_ver: '1.0.29',
  request_host: 'app://resources',
  p_bd: '1.0.0.41',
  is_from_iesaccountsaas: '1',
  device_platform: 'PC',
  region: 'cn',
  geo_region: 'cn',
  os_region: 'cn',
  sim_region: '',
  version_code: '3.3.0',
};

function firstEnv(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeQishuiOAuthFileConfig(raw, file) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const oauth = raw.oauth && typeof raw.oauth === 'object' ? raw.oauth : raw;
  return {
    clientKey: String(oauth.clientKey || oauth.client_key || oauth.clientId || oauth.client_id || oauth.key || '').trim(),
    clientSecret: String(oauth.clientSecret || oauth.client_secret || oauth.secret || '').trim(),
    redirectUri: String(oauth.redirectUri || oauth.redirect_uri || oauth.redirectURL || oauth.redirect_url || '').trim(),
    scope: String(oauth.scope || oauth.scopes || '').trim(),
    file,
    source: file ? 'file' : '',
  };
}

function qishuiOAuthConfigFileCandidates() {
  const candidates = [];
  const add = (value) => {
    value = String(value || '').trim();
    if (!value) return;
    const resolved = path.resolve(value);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };
  add(firstEnv(['QISHUI_OAUTH_CONFIG_FILE', 'DOUYIN_OAUTH_CONFIG_FILE']));
  try { add(path.join(path.dirname(qishuiTokenFile()), '.qishui-oauth.json')); } catch (_) {}
  add(path.join(PROJECT_ROOT, '.qishui-oauth.json'));
  add(path.join(PROJECT_ROOT, 'qishui-oauth.json'));
  return candidates;
}

function readQishuiOAuthFileConfig() {
  const candidates = qishuiOAuthConfigFileCandidates();
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const config = normalizeQishuiOAuthFileConfig(parsed, file);
      if (config.clientKey || config.clientSecret || config.redirectUri || config.scope) return config;
    } catch (e) {
      console.warn('[QishuiOAuthConfig] ignored invalid config file:', file, e.message);
    }
  }
  return normalizeQishuiOAuthFileConfig(null, candidates[0] || '');
}

function getQishuiOAuthConfig() {
  const fileConfig = readQishuiOAuthFileConfig();
  const clientKey = firstEnv(['QISHUI_OAUTH_CLIENT_KEY', 'QISHUI_CLIENT_KEY', 'DOUYIN_CLIENT_KEY']) || fileConfig.clientKey;
  const clientSecret = firstEnv(['QISHUI_OAUTH_CLIENT_SECRET', 'QISHUI_CLIENT_SECRET', 'DOUYIN_CLIENT_SECRET']) || fileConfig.clientSecret;
  const redirectUri = firstEnv(['QISHUI_OAUTH_REDIRECT_URI', 'QISHUI_REDIRECT_URI', 'DOUYIN_REDIRECT_URI']) || fileConfig.redirectUri;
  const scope = firstEnv(['QISHUI_OAUTH_SCOPE', 'DOUYIN_OAUTH_SCOPE']) || fileConfig.scope || QISHUI_SCOPE;
  const missing = [];
  if (!clientKey) missing.push('QISHUI_OAUTH_CLIENT_KEY');
  if (!clientSecret) missing.push('QISHUI_OAUTH_CLIENT_SECRET');
  if (!redirectUri) missing.push('QISHUI_OAUTH_REDIRECT_URI');
  else if (!/^https:\/\//i.test(redirectUri)) missing.push('QISHUI_OAUTH_REDIRECT_URI(https)');
  return {
    configured: missing.length === 0,
    clientKey,
    clientSecret,
    redirectUri,
    scope,
    authUrl: QISHUI_OAUTH_AUTH_URL,
    tokenUrl: QISHUI_OAUTH_TOKEN_URL,
    missing,
    configFile: fileConfig.file || '',
    configSource: fileConfig.source || (clientKey || clientSecret || redirectUri ? 'env' : ''),
  };
}

function qishuiOAuthConfigError(config) {
  const err = new Error('QISHUI_OAUTH_NOT_CONFIGURED');
  err.code = 'QISHUI_OAUTH_NOT_CONFIGURED';
  err.missing = (config && config.missing) || [];
  err.message = 'QISHUI_OAUTH_NOT_CONFIGURED: ' + err.missing.join(', ');
  return err;
}

function buildQishuiOAuthAuthorizeUrl(state) {
  const config = getQishuiOAuthConfig();
  if (!config.configured) throw qishuiOAuthConfigError(config);
  const url = new URL(config.authUrl);
  url.searchParams.set('client_key', config.clientKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('redirect_uri', config.redirectUri);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

function qishuiTokenFile() {
  return process.env.QISHUI_TOKEN_FILE || DEFAULT_QISHUI_TOKEN_FILE;
}

function normalizeQishuiToken(value) {
  let token = String(value || '').trim();
  token = token.replace(/^bearer\s+/i, '').trim();
  const headerMatch = token.match(/(?:access-token|access_token)\s*[:=]\s*([^;\s]+)/i);
  if (headerMatch) token = headerMatch[1].trim();
  return token;
}

module.exports = {
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
};
