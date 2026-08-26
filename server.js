// ====================================================================
//  粒子音乐可视化播放器 — Server v2
//  - 网易云搜索 / 歌曲URL / 封面/音频代理
//  - 扫码登录 (login_qr_*) + cookie 持久化 (./.cookie)
//  - 试听检测 (freeTrialInfo) + 全 quality 探测
//  - 所有受保护 API 都会带上已登录用户的 cookie
// ====================================================================
const {
  cloudsearch,
  song_detail,
  song_url,
  song_url_v1,
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  logout,
  user_account,
  user_playlist,
  comment_music,
  artist_detail,
  artist_top_song,
  artist_songs,
  like: like_song,
  likelist,
  song_like_check,
  playlist_tracks,
  playlist_track_add,
  playlist_create,
  playlist_detail,
  playlist_track_all,
  personalized,
  recommend_resource,
  recommend_songs,
  dj_detail,
  dj_program,
  dj_hot,
  dj_sublist,
  user_audio,
  dj_paygift,
  record_recent_voice,
  sati_resource_sub_list,
  lyric,
  lyric_new,
  album_sub,
  album_sublist,
  playlist_subscribe,
} = require('NeteaseCloudMusicApi');
const {
  getKugouLoginInfo: getKugouLoginInfoFromApi,
  handleKugouGuessLike,
} = require('./kugou-api');
const {
  getSpotifyConfig,
  clearSpotifyToken,
  saveSpotifyConfig,
  handleSpotifyStatus,
  handleSpotifySearch,
  handleSpotifyRecommendations,
  handleSpotifyUserPlaylists,
  handleSpotifyPlaylistTracks,
  handleSpotifyAlbumDetail,
  handleSpotifyLibraryCheck,
  handleSpotifyLibrarySet,
  handleSpotifyPlaylistAddSong,
  handleSpotifyCreatePlaylist,
  handleSpotifySongUrl,
  handleSpotifyLyric,
} = require('./spotify-api');
const {
  getQishuiStatus,
  handleQishuiStatus,
  normalizeQishuiCookieInput,
  qishuiCookieHasLogin,
  saveQishuiAccessToken,
  clearQishuiAccessToken,
  handleQishuiSearch,
  handleQishuiFeed,
  handleQishuiUserPlaylists,
  handleQishuiPlaylistTracks,
  handleQishuiCheckTracksLiked,
  handleQishuiSetTrackLiked,
  handleQishuiSetPlaylistCollected,
  handleQishuiPlaylistAddSong,
  handleQishuiSetAlbumCollected,
  handleQishuiLyric,
  handleQishuiSongUrl,
} = require('./qishui-api');
const http = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TrackDecryptor } = require('./qishui-audio-decryptor/track-decryptor');
const dns = require('dns').promises;
const tls = require('tls');
const os = require('os');
const { once } = require('events');
const { fileURLToPath } = require('url');
const QRCode = require('qrcode');
const { analyzePodcastDjStream, analyzePodcastDjIntro, nativeDjAvailable } = require('./dj-analyzer');
const {
  appendCuefieldFeedback,
  readCuefieldFeedbackStats,
} = require('./cuefield/feedback-log');
const { planCuefieldTransitionFromCache } = require('./cuefield/mineradio-bridge');
const CUEFIELD_FEEDBACK_FILE = process.env.CUEFIELD_FEEDBACK_FILE || path.join(__dirname, 'data', 'cuefield-feedback.jsonl');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
let API_TOKEN = String(process.env.MINERADIO_API_TOKEN || '').trim();
let API_TOKEN_AUTO = false;
function ensureApiToken() {
  if (!API_TOKEN) {
    API_TOKEN = crypto.randomBytes(32).toString('hex');
    API_TOKEN_AUTO = true;
  }
}
ensureApiToken();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const COOKIE_FILE = process.env.COOKIE_FILE || path.join(__dirname, '.cookie');
const QQ_COOKIE_FILE = process.env.QQ_COOKIE_FILE || path.join(__dirname, '.qq-cookie');
const KUGOU_COOKIE_FILE = process.env.KUGOU_COOKIE_FILE || path.join(__dirname, '.kugou-cookie');
const QISHUI_COOKIE_FILE = process.env.QISHUI_COOKIE_FILE || path.join(__dirname, '.qishui-cookie');
const UPDATE_WORK_DIR = process.env.MINERADIO_UPDATE_DIR || path.join(__dirname, 'updates');
const UPDATE_DOWNLOAD_DIR = process.env.MINERADIO_UPDATE_DOWNLOAD_DIR || path.join(UPDATE_WORK_DIR, 'downloads');
const UPDATE_PATCH_BACKUP_DIR = process.env.MINERADIO_PATCH_BACKUP_DIR || path.join(UPDATE_WORK_DIR, 'backups', 'patches');
const BEATMAP_CACHE_DIR = process.env.MINERADIO_BEAT_CACHE_DIR || path.join(os.homedir(), '.mineradio', 'beatmaps');
const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.MINERADIO_VERSION || APP_PACKAGE.version || '0.9.11';
const UPDATE_CONFIG = readUpdateConfig(APP_PACKAGE);
const PATCH_MAX_BYTES = 12 * 1024 * 1024;
const PATCH_ALLOWED_ROOTS = new Set(['public']);
const PATCH_STATIC_EXTENSIONS = new Set([
  '.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.map', '.wasm', '.mp3', '.mp4', '.webm',
]);
const UPDATE_PUBKEY_PEM = String(process.env.MINERADIO_UPDATE_PUBKEY_PEM || '').trim();
const PROXY_FETCH_TIMEOUT_MS = 30000;
const API_AUTH_QUERY_TOKEN_PATHS = new Set(['/api/audio', '/api/cover']);
const UPDATE_FALLBACK_NOTES = [
  '电影镜头节奏更松',
  '音源失败自动换源',
  '右上角更新提示',
];
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'https://ip-api.com/json/';
const WEATHER_IPWHO_URL = 'https://ipwho.is/';
const WEATHER_IPAPI_CO_URL = 'https://ipapi.co/json/';
const WEATHER_REVERSE_GEO_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const WEATHER_NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};

const updateDownloadJobs = new Map();
let djAnalyzeBusy = false;
const djAnalyzeQueue = [];
const qishuiAudioDecryptor = new TrackDecryptor();
const qishuiAudioDecryptCache = new Map();
const QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES = 96 * 1024 * 1024;
let qishuiAudioDecryptCacheBytes = 0;

function applySystemCertificateAuthorities() {
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    if (!system.length) return;
    const seen = new Set();
    const merged = [];
    bundled.concat(system).forEach(cert => {
      if (!cert || seen.has(cert)) return;
      seen.add(cert);
      merged.push(cert);
    });
    if (merged.length > bundled.length) tls.setDefaultCACertificates(merged);
  } catch (e) {
    console.warn('[TLS] system CA merge skipped:', e.message);
  }
}

applySystemCertificateAuthorities();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ---------- Cookie 持久化 ----------
const COOKIE_ATTRIBUTE_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly']);
function collectCookiePair(picked, key, value) {
  key = String(key || '').trim();
  if (!key || COOKIE_ATTRIBUTE_NAMES.has(key.toLowerCase())) return;
  if (value === null || value === undefined) return;
  picked.set(key, String(value).trim());
}
function collectCookieInput(input, picked) {
  if (input === null || input === undefined) return;
  if (Array.isArray(input)) {
    input.forEach(item => collectCookieInput(item, picked));
    return;
  }
  if (typeof input === 'object') {
    if (input.name && Object.prototype.hasOwnProperty.call(input, 'value')) {
      collectCookiePair(picked, input.name, input.value);
      return;
    }
    Object.keys(input).forEach(key => {
      const value = input[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectCookiePair(picked, key, value.value);
      } else if (typeof value !== 'object') {
        collectCookiePair(picked, key, value);
      }
    });
    return;
  }
  String(input).split(/\r?\n/).forEach(line => {
    line.split(';').forEach(part => {
      const raw = String(part || '').trim();
      const idx = raw.indexOf('=');
      if (idx <= 0) return;
      collectCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1));
    });
  });
}
function normalizeCookieHeader(input) {
  const picked = new Map();
  collectCookieInput(input, picked);
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}
function rawCookieFallback(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input) && input.every(item => typeof item === 'string')) return input.join('; ').trim();
  return '';
}
const ENCRYPTED_PREFIX_BYTE0 = 0x4d;
const ENCRYPTED_PREFIX_BYTE1 = 0x52;
let _cookieDebugLogPath = '';
try {
  const _cookieDir = (process.env.KUGOU_COOKIE_FILE || process.env.COOKIE_FILE || __dirname);
  _cookieDebugLogPath = path.join(path.dirname(_cookieDir), 'cookie-debug.log');
} catch (_) { _cookieDebugLogPath = ''; }
function cookieDebugLog(msg) {
  try {
    const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
    if (_cookieDebugLogPath) fs.appendFileSync(_cookieDebugLogPath, line, 'utf8');
  } catch (_) {}
}
let _safeStorageRef = null;
function tryDecryptSafeStorage(buf) {
  try {
    if (!_safeStorageRef) {
      _safeStorageRef = require('electron').safeStorage || null;
    }
    if (_safeStorageRef && _safeStorageRef.isEncryptionAvailable && _safeStorageRef.isEncryptionAvailable()) {
      return _safeStorageRef.decryptString(buf).trim();
    }
  } catch (_) {}
  return '';
}
let readCookieFile = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    const buf = fs.readFileSync(filePath);
    if (!buf.length) return '';
    if (buf.length > 2 && buf[0] === ENCRYPTED_PREFIX_BYTE0 && buf[1] === ENCRYPTED_PREFIX_BYTE1) {
      const dec = tryDecryptSafeStorage(buf.subarray(2));
      if (dec) return dec;
      cookieDebugLog('readCookieFile: encrypted cookie unreadable (safeStorage unavailable): ' + filePath);
      return '';
    }
    return buf.toString('utf8').trim();
  } catch (e) {
    cookieDebugLog('readCookieFile error: ' + filePath + ' ' + e.message);
    return '';
  }
};
let writeCookieFile = (filePath, content) => {
  try {
    if (!filePath) return;
    const value = String(content || '');
    if (!value) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    fs.writeFileSync(filePath, value, 'utf8');
    cookieDebugLog('writeCookieFile(default) OK: ' + filePath + ' len=' + value.length);
  } catch (e) {
    cookieDebugLog('writeCookieFile(default) FAILED: ' + filePath + ' ' + e.message);
    console.warn('[Cookie] write failed:', filePath, e.message);
  }
};
let _configureCookieStorageCalled = false;
function configureCookieStorage(readFn, writeFn) {
  _configureCookieStorageCalled = true;
  cookieDebugLog('configureCookieStorage CALLED');
  if (typeof readFn === 'function') readCookieFile = readFn;
  if (typeof writeFn === 'function') writeCookieFile = writeFn;
  userCookie = readCookieFile(COOKIE_FILE);
  qqCookie = readCookieFile(QQ_COOKIE_FILE);
  kugouCookie = readCookieFile(KUGOU_COOKIE_FILE);
  qishuiCookie = readCookieFile(QISHUI_COOKIE_FILE);
  cookieDebugLog('configureCookieStorage: kugouCookie len=' + (kugouCookie || '').length + ' qishuiCookie len=' + (qishuiCookie || '').length);
}
let userCookie = readCookieFile(COOKIE_FILE);
function saveCookie(c) {
  userCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  writeCookieFile(COOKIE_FILE, userCookie);
}

let qqCookie = readCookieFile(QQ_COOKIE_FILE);
function saveQQCookie(c) {
  qqCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  writeCookieFile(QQ_COOKIE_FILE, qqCookie);
}

let kugouCookie = readCookieFile(KUGOU_COOKIE_FILE);
function saveKugouCookie(c) {
  kugouCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  kugouVipProbeCache = { userId: '', checkedAt: 0, info: null };
  cookieDebugLog('saveKugouCookie called, configureCalled=' + _configureCookieStorageCalled + ' len=' + (kugouCookie || '').length + ' file=' + KUGOU_COOKIE_FILE);
  try {
    writeCookieFile(KUGOU_COOKIE_FILE, kugouCookie);
    cookieDebugLog('saveKugouCookie write OK');
  } catch (e) {
    cookieDebugLog('saveKugouCookie write THREW: ' + e.message + ' — trying plaintext fallback');
    try {
      if (kugouCookie && KUGOU_COOKIE_FILE) {
        fs.writeFileSync(KUGOU_COOKIE_FILE, kugouCookie, 'utf8');
        cookieDebugLog('saveKugouCookie plaintext fallback OK');
      }
    } catch (e2) {
      cookieDebugLog('saveKugouCookie plaintext fallback FAILED: ' + e2.message);
    }
  }
}

let qishuiCookie = readCookieFile(QISHUI_COOKIE_FILE);
function saveQishuiCookie(c) {
  qishuiCookie = normalizeQishuiCookieInput(c) || normalizeCookieHeader(c) || rawCookieFallback(c);
  cookieDebugLog('saveQishuiCookie called, configureCalled=' + _configureCookieStorageCalled + ' len=' + (qishuiCookie || '').length + ' file=' + QISHUI_COOKIE_FILE);
  try {
    writeCookieFile(QISHUI_COOKIE_FILE, qishuiCookie);
    cookieDebugLog('saveQishuiCookie write OK');
  } catch (e) {
    cookieDebugLog('saveQishuiCookie write THREW: ' + e.message + ' — trying plaintext fallback');
    try {
      if (qishuiCookie && QISHUI_COOKIE_FILE) {
        fs.writeFileSync(QISHUI_COOKIE_FILE, qishuiCookie, 'utf8');
        cookieDebugLog('saveQishuiCookie plaintext fallback OK');
      }
    } catch (e2) {
      cookieDebugLog('saveQishuiCookie plaintext fallback FAILED: ' + e2.message);
    }
  }
}

// ---------- 工具 ----------
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}
function serveIndexHtml(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const inject = '<script>window.__MINERADIO_API_TOKEN__=' + JSON.stringify(API_TOKEN) + ';</script>';
    const out = html.includes('<head>')
      ? html.replace('<head>', '<head>' + inject)
      : (html.includes('</head>') ? html.replace('</head>', inject + '</head>') : inject + html);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(out);
  });
}
function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(JSON.stringify(data));
}
function readPackageInfo() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function parseGitHubRepository(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const direct = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (direct) return { owner: direct[1], repo: direct[2].replace(/\.git$/i, '') };
  const github = raw.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i);
  if (github) return { owner: github[1], repo: github[2].replace(/\.git$/i, '') };
  return null;
}
function readUpdateConfig(pkg) {
  const local = (pkg && pkg.mineradio && pkg.mineradio.update) || {};
  const repoHint = process.env.MINERADIO_UPDATE_REPOSITORY
    || process.env.GITHUB_REPOSITORY
    || local.repository
    || local.github
    || (pkg && pkg.repository && (pkg.repository.url || pkg.repository))
    || '';
  const parsed = parseGitHubRepository(repoHint) || {};
  const owner = process.env.MINERADIO_UPDATE_OWNER || local.owner || parsed.owner || '';
  const repo = process.env.MINERADIO_UPDATE_REPO || local.repo || parsed.repo || '';
  return {
    provider: local.provider || 'github',
    owner,
    repo,
    configured: !!(owner && repo),
    preview: local.preview !== false,
    preferMirrors: local.preferMirrors !== false,
    mirrors: readUpdateMirrors(local),
    manifest: process.env.MINERADIO_UPDATE_MANIFEST
      || process.env.MINERADIO_UPDATE_MANIFEST_URL
      || process.env.MINERADIO_UPDATE_MANIFEST_FILE
      || '',
  };
}
function parseUpdateMirrorList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[\n,;]/);
}
function readUpdateMirrors(local) {
  const envMirrors = process.env.MINERADIO_UPDATE_MIRRORS || process.env.MINERADIO_UPDATE_MIRROR || '';
  const raw = envMirrors
    ? parseUpdateMirrorList(envMirrors)
    : parseUpdateMirrorList(local.mirrors || local.downloadMirrors || []);
  const seen = new Set();
  const mirrors = [];
  raw.forEach(item => {
    const url = String(item || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mirrors.push(url);
  });
  return mirrors.slice(0, 6);
}
function normalizeDigest(value, algorithm) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefix = new RegExp('^' + algorithm + ':', 'i');
  return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}
function assetDigestInfo(asset) {
  const digest = String(asset && asset.digest || '').trim();
  return {
    sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
    sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  };
}
function buildMirrorUrl(originalUrl, mirror) {
  const source = String(originalUrl || '').trim();
  const base = String(mirror || '').trim();
  if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return '';
  if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source));
  if (base.includes('{url}')) return base.replace(/\{url\}/g, source);
  return base.replace(/\/+$/, '/') + source;
}
function uniqueDownloadCandidates(urls, opts) {
  opts = opts || {};
  const directUrls = (Array.isArray(urls) ? urls : [urls])
    .map(url => String(url || '').trim())
    .filter(url => /^https?:\/\//i.test(url));
  const directSet = new Set(directUrls.map(url => url.toLowerCase()));
  const mirrors = opts.useMirrors === false ? [] : (UPDATE_CONFIG.mirrors || []);
  const mirrored = [];
  directUrls.forEach(source => {
    mirrors.forEach((mirror, index) => {
      const url = buildMirrorUrl(source, mirror);
      if (url) mirrored.push({
        url,
        label: '国内加速线路 ' + (index + 1),
        mirrored: true,
      });
    });
  });
  const direct = directUrls.map(url => ({
    url,
    label: directSet.has(url.toLowerCase()) ? 'GitHub 直连' : '下载线路',
    mirrored: false,
  }));
  const ordered = UPDATE_CONFIG.preferMirrors === false ? direct.concat(mirrored) : mirrored.concat(direct);
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function publicDownloadUrls(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(item => item && item.url)
    .filter(Boolean);
}
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
}
function compareVersions(a, b) {
  const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}
function cleanReleaseLine(line) {
  return String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}
function extractReleaseNotes(body) {
  const notes = [];
  String(body || '').split(/\r?\n/).forEach(line => {
    const text = cleanReleaseLine(line);
    if (!text) return;
    if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return;
    if (/^https?:\/\//i.test(text)) return;
    if (text.length > 72) return;
    notes.push(text);
  });
  return notes.slice(0, 4);
}
function pickReleaseAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const preferred = list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
    || list[0];
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function patchAssetVersions(name) {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
  return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
}
function pickPatchAsset(assets, currentVersion, latestVersion) {
  const list = Array.isArray(assets) ? assets : [];
  const current = normalizeVersion(currentVersion || APP_VERSION);
  const latest = normalizeVersion(latestVersion || '');
  const preferred = list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function updateAssetNameFromUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const base = path.basename(decodeURIComponent(u.pathname || ''));
    if (base) return base;
  } catch (_) {}
  return path.basename(String(value || '').split('?')[0]) || '';
}
function normalizeManifestUpdateInfo(data) {
  data = data || {};
  const release = data.release || {};
  const asset = release.asset || data.asset || {};
  const latestVersion = normalizeVersion(
    data.latestVersion
    || data.version
    || release.version
    || release.tagName
    || release.tag_name
    || release.name
    || APP_VERSION
  ) || APP_VERSION;
  const downloadUrl = release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || '';
  const patch = release.patch || data.patch || null;
  const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []);
  const patchUrls = patch ? [patch.downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []) : [];
  const patchInfo = patch && patch.downloadUrl ? {
    name: patch.name || updateAssetNameFromUrl(patch.downloadUrl) || `Mineradio-${APP_VERSION}→${latestVersion}.patch.json`,
    size: Number(patch.size || 0) || 0,
    contentType: patch.contentType || patch.content_type || 'application/json',
    downloadUrl: patch.downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
    from: normalizeVersion(patch.from || APP_VERSION),
    to: normalizeVersion(patch.to || latestVersion),
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
  } : null;
  const notes = Array.isArray(release.notes) && release.notes.length
    ? release.notes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
    : (extractReleaseNotes(release.body || data.body).length ? extractReleaseNotes(release.body || data.body) : UPDATE_FALLBACK_NOTES);
  const assetInfo = downloadUrl ? {
    name: asset.name || updateAssetNameFromUrl(downloadUrl) || `Mineradio-${latestVersion}-Setup.exe`,
    size: Number(asset.size || 0) || 0,
    contentType: asset.contentType || asset.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
    sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
  } : null;
  return {
    configured: true,
    preview: false,
    updateAvailable: data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: release.tagName || release.tag_name || data.tagName || ('v' + latestVersion),
      name: release.name || data.name || ('Mineradio v' + latestVersion),
      version: latestVersion,
      publishedAt: release.publishedAt || release.published_at || data.publishedAt || '',
      htmlUrl: release.htmlUrl || release.html_url || data.htmlUrl || '',
      downloadUrl,
      asset: assetInfo,
      patch: patchInfo,
      patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
      summary: release.summary || data.summary || notes[0] || '发现新版本，建议更新。',
      notes,
    },
    source: 'manifest',
  };
}
async function readUpdateManifest(ref) {
  const value = String(ref || '').trim();
  if (!value) throw new Error('UPDATE_MANIFEST_MISSING');
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Update manifest ' + resp.status);
    return resp.json();
  }
  const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function fetchManifestUpdateInfo(ref) {
  try {
    const data = await readUpdateManifest(ref);
    return normalizeManifestUpdateInfo(data);
  } catch (err) {
    return localUpdateFallback(err.message || 'Update manifest failed', { configured: true });
  }
}
function beatCacheRootInfo() {
  const dir = path.resolve(BEATMAP_CACHE_DIR);
  const root = path.parse(dir).root;
  const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
  const explicit = !!String(process.env.MINERADIO_BEAT_CACHE_DIR || '').trim();
  const allowed = explicit || (!!root && !/^C:$/i.test(drive));
  const available = allowed && fs.existsSync(root);
  return { dir, root, drive, allowed, available };
}
function ensureBeatMapCacheDir() {
  const info = beatCacheRootInfo();
  if (!info.allowed) {
    const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
    err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
    err.info = info;
    throw err;
  }
  if (!info.available) {
    const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
    err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
    err.info = info;
    throw err;
  }
  fs.mkdirSync(info.dir, { recursive: true });
  return info.dir;
}
function safeBeatMapCacheFile(key) {
  const raw = String(key || '').trim();
  if (!raw || raw.length > 240) return null;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap';
  return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
}
function compactBeatMapCachePayload(body) {
  const key = String(body && body.key || '').trim();
  const map = body && body.map;
  if (!key || !map || typeof map !== 'object') return null;
  return {
    v: 1,
    key,
    savedAt: Date.now(),
    meta: {
      provider: String(body.provider || '').slice(0, 32),
      title: String(body.title || '').slice(0, 160),
      artist: String(body.artist || '').slice(0, 160),
      mode: String(body.mode || 'mr').slice(0, 32),
    },
    map,
  };
}
function readBeatMapCache(key) {
  const file = safeBeatMapCacheFile(key);
  if (!file || !fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw && raw.map ? raw : null;
}
function writeBeatMapCache(body) {
  const payload = compactBeatMapCachePayload(body);
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
  const file = safeBeatMapCacheFile(payload.key);
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) };
}
function localUpdateFallback(reason, opts) {
  opts = opts || {};
  const configured = !!(opts.configured != null ? opts.configured : false);
  return {
    configured,
    preview: UPDATE_CONFIG.preview,
    updateAvailable: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    release: {
      tagName: 'v' + APP_VERSION,
      name: 'Mineradio v' + APP_VERSION,
      version: APP_VERSION,
      htmlUrl: '',
      downloadUrl: '',
      summary: '当前版本，更新检测已就绪。',
      notes: UPDATE_FALLBACK_NOTES,
    },
    reason: reason || '',
  };
}
function updateError(code, message, cause) {
  const err = new Error(message || code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}
function classifyUpdateError(err) {
  const code = String(err && err.code || '').trim();
  const message = String(err && err.message || err || '').trim();
  const detail = message || code || '未知错误';
  if (/HASH|DIGEST|CHECKSUM/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail };
  }
  if (/SIZE_MISMATCH|content length/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_SIZE_MISMATCH', reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。', detail };
  }
  if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail };
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail };
  }
  if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail };
  }
  const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/);
  if (http) {
    const status = Number(http[1]);
    if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail };
    if (status === 404) return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail };
    if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail };
    return { code: code || ('UPDATE_HTTP_' + status), reason: '更新线路返回 HTTP ' + status + '。', detail };
  }
  return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail };
}
function promiseWithTimeout(promise, timeoutMs, code) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(code || 'PROVIDER_REQUEST_TIMEOUT');
        err.code = code || 'PROVIDER_REQUEST_TIMEOUT';
        reject(err);
      }, Math.max(250, Number(timeoutMs) || 5000));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function readStreamChunkWithTimeout(reader, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('UPSTREAM_STREAM_IDLE_TIMEOUT');
          err.code = 'UPSTREAM_STREAM_IDLE_TIMEOUT';
          reject(err);
        }, timeoutMs || 12000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
async function fetchTextFromCandidates(candidates, timeoutMs) {
  const list = Array.isArray(candidates) && candidates.length ? candidates : [];
  const failures = [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    try {
      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, timeoutMs || 6500);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
      return { text: await resp.text(), candidate };
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push(candidate.label + ': ' + info.reason);
    }
  }
  throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed');
}
function yamlScalar(text, key) {
  const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm');
  const match = String(text || '').match(pattern);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}
function githubReleaseDownloadUrl(version, fileName) {
  const tag = 'v' + normalizeVersion(version);
  const encodedOwner = encodeURIComponent(UPDATE_CONFIG.owner);
  const encodedRepo = encodeURIComponent(UPDATE_CONFIG.repo);
  const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
}
function parseLatestYmlUpdateInfo(text, reason) {
  const latestVersion = normalizeVersion(yamlScalar(text, 'version') || APP_VERSION) || APP_VERSION;
  const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `Mineradio-${latestVersion}-Setup.exe`;
  const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512');
  const size = Number(yamlScalar(text, 'size') || 0) || 0;
  const releaseDate = yamlScalar(text, 'releaseDate');
  const downloadUrl = githubReleaseDownloadUrl(latestVersion, assetPath);
  const candidates = uniqueDownloadCandidates(downloadUrl);
  const asset = {
    name: updateAssetNameFromUrl(downloadUrl) || assetPath,
    size,
    contentType: 'application/octet-stream',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: '',
    sha512,
  };
  return {
    configured: true,
    preview: false,
    updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: 'v' + latestVersion,
      name: 'Mineradio v' + latestVersion,
      version: latestVersion,
      publishedAt: releaseDate,
      htmlUrl: `https://github.com/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`,
      downloadUrl,
      asset,
      patch: null,
      patchAvailable: false,
      summary: '发现新版本，已启用备用更新线路。',
      notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
    },
    source: 'latest-yml',
    reason: reason || '',
  };
}
async function fetchLatestYmlUpdateInfo(reason) {
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
  const latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest/download/latest.yml`;
  const candidates = uniqueDownloadCandidates(latestYmlUrl);
  const result = await fetchTextFromCandidates(candidates, 6500);
  return parseLatestYmlUpdateInfo(result.text, reason);
}
async function fetchLatestUpdateInfo() {
  if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest);
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (!resp.ok) {
      try { return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status); }
      catch (_) { return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true }); }
    }
    const data = await resp.json();
    const latestVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION;
    const asset = pickReleaseAsset(data.assets);
    const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion);
    const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES;
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: data.tag_name || ('v' + latestVersion),
        name: data.name || ('Mineradio v' + latestVersion),
        version: latestVersion,
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || '',
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
    };
  } catch (err) {
    const reason = err && err.message || 'Update check failed';
    try { return await fetchLatestYmlUpdateInfo(reason); }
    catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
  } finally {
    clearTimeout(timer);
  }
}
function safeUpdateFileName(name, version) {
  const raw = String(name || '').trim() || `Mineradio-${version || APP_VERSION}.exe`;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `Mineradio-${version || APP_VERSION}.exe`;
}
function publicUpdateJob(job) {
  if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' };
  return {
    ok: job.status !== 'error',
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    received: job.received || 0,
    total: job.total || 0,
    speedBps: job.speedBps || 0,
    etaSeconds: job.etaSeconds || 0,
    sourceLabel: job.sourceLabel || '',
    attempt: job.attempt || 0,
    attempts: job.attempts || 0,
    mode: job.mode || 'installer',
    message: job.message || '',
    restartRequired: !!job.restartRequired,
    cached: !!job.cached,
    fileName: job.fileName || '',
    filePath: job.status === 'ready' ? job.filePath : '',
    version: job.version || '',
    releaseUrl: job.releaseUrl || '',
    error: job.error || '',
    errorReason: job.errorReason || '',
    errorDetail: job.errorDetail || '',
    failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function activeUpdateJobFor(version) {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jobs.find(job => job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
}
function trimUpdateJobs() {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  jobs.slice(8).forEach(job => updateDownloadJobs.delete(job.id));
}
async function downloadUpdateAsset(job) {
  const tmpPath = job.filePath + '.download';
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
      },
    });
    if (!resp.ok) throw new Error('Download failed ' + resp.status);

    const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
    job.total = totalHeader || job.total || 0;
    job.received = 0;
    job.progress = 0;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';
    job.updatedAt = Date.now();
    let speedWindowAt = Date.now();
    let speedWindowBytes = 0;

    const writer = fs.createWriteStream(tmpPath);
    const reader = resp.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const buf = Buffer.from(chunk.value);
        job.received += buf.length;
        speedWindowBytes += buf.length;
        const now = Date.now();
        if (now - speedWindowAt >= 900) {
          job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
          speedWindowAt = now;
          speedWindowBytes = 0;
        }
        if (job.total > 0) {
          job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
          job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
        } else {
          const kb = Math.max(1, job.received / 1024);
          job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
        }
        job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
        job.updatedAt = Date.now();
        if (!writer.write(buf)) await once(writer, 'drain');
      }
    } finally {
      writer.end();
      await once(writer, 'finish').catch(() => {});
    }

    if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
    fs.renameSync(tmpPath, job.filePath);
    job.status = 'ready';
    job.progress = 100;
    job.message = '安装包已下载';
    job.updatedAt = Date.now();
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    job.status = 'error';
    job.error = e.message || 'UPDATE_DOWNLOAD_FAILED';
    job.updatedAt = Date.now();
  }
}
function sha512Base64(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}
function sha512Hex(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}
function verifyUpdateBuffer(buffer, job) {
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`);
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
  if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
    throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
  if (expectedSha512) {
    const actualBase64 = sha512Base64(buffer);
    const actualHex = sha512Hex(buffer).toLowerCase();
    if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
    }
  }
}
function verifyUpdateFile(filePath, job) {
  verifyUpdateBuffer(fs.readFileSync(filePath), job);
}
function moveInvalidUpdateFile(filePath, reason) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`);
    fs.renameSync(filePath, invalidPath);
    console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath);
  } catch (e) {
    console.warn('[UpdateDownload] failed to move invalid cached installer:', e.message);
  }
}
function reuseVerifiedInstallerJob(opts) {
  if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null;
  if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null;
  const now = Date.now();
  const stat = fs.statSync(opts.filePath);
  const job = {
    id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'ready',
    progress: 100,
    received: stat.size || 0,
    total: opts.expectedSize || stat.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '本地缓存',
    attempt: 0,
    attempts: opts.attempts || 0,
    mode: 'installer',
    message: '安装包已下载，可直接打开安装',
    fileName: opts.fileName || path.basename(opts.filePath),
    filePath: opts.filePath,
    version: opts.version || '',
    downloadUrl: opts.downloadUrl || '',
    downloadCandidates: opts.downloadCandidates || [],
    expectedSize: opts.expectedSize || 0,
    sha256: opts.sha256 || '',
    sha512: opts.sha512 || '',
    releaseUrl: opts.releaseUrl || '',
    failedAttempts: [],
    cached: true,
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  try {
    verifyUpdateFile(opts.filePath, job);
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    return job;
  } catch (err) {
    moveInvalidUpdateFile(opts.filePath, (err && err.message) || 'cache verification failed');
    return null;
  }
}
function setUpdateJobError(job, err, fallbackMessage) {
  const info = classifyUpdateError(err);
  job.status = 'error';
  job.error = info.code;
  job.errorReason = info.reason;
  job.errorDetail = info.detail;
  job.message = fallbackMessage || info.reason;
  job.updatedAt = Date.now();
}
function prepareUpdateJobAttempt(job, candidate, index, total) {
  job.status = 'downloading';
  job.sourceLabel = candidate.label || '下载线路';
  job.attempt = index + 1;
  job.attempts = total;
  job.received = 0;
  job.speedBps = 0;
  job.etaSeconds = 0;
  job.error = '';
  job.errorReason = '';
  job.errorDetail = '';
  job.updatedAt = Date.now();
}
function ensureMirrorCanBeVerified(job, candidate) {
  if (!candidate || !candidate.mirrored) return;
  if (job.sha256 || job.sha512) return;
  throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available');
}
async function downloadUpdateAssetWithMirrors(job) {
  const tmpPath = job.filePath + '.download';
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      ensureMirrorCanBeVerified(job, candidate);
      prepareUpdateJobAttempt(job, candidate, i, candidates.length);
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';

      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, 14000);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      job.total = totalHeader || job.expectedSize || job.total || 0;
      job.progress = 0;
      job.updatedAt = Date.now();
      let speedWindowAt = Date.now();
      let speedWindowBytes = 0;

      const writer = fs.createWriteStream(tmpPath);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value);
          job.received += buf.length;
          speedWindowBytes += buf.length;
          const now = Date.now();
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
            speedWindowAt = now;
            speedWindowBytes = 0;
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
          } else {
            const kb = Math.max(1, job.received / 1024);
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
          job.updatedAt = Date.now();
          if (!writer.write(buf)) await once(writer, 'drain');
        }
      } finally {
        writer.end();
        await once(writer, 'finish').catch(() => {});
      }

      verifyUpdateFile(tmpPath, job);
      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      fs.renameSync(tmpPath, job.filePath);
      job.status = 'ready';
      job.progress = 100;
      job.etaSeconds = 0;
      job.message = '安装包已下载';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason);
    }
  }
}
function startUpdateDownloadJob(info) {
  const release = info && info.release ? info.release : {};
  const asset = release.asset || {};
  const downloadUrl = release.downloadUrl || asset.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' };

  const version = info.latestVersion || release.version || '';
  const existing = activeUpdateJobFor(version);
  if (existing) return publicUpdateJob(existing);

  const fileName = safeUpdateFileName(asset.name || '', version);
  const filePath = path.join(UPDATE_DOWNLOAD_DIR, fileName);
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []));
  const expectedSize = asset.size || 0;
  const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase();
  const sha512 = normalizeDigest(asset.sha512 || '', 'sha512');
  const cached = reuseVerifiedInstallerJob({
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    attempts: downloadCandidates.length,
  });
  if (cached) return publicUpdateJob(cached);

  const now = Date.now();
  const job = {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: expectedSize,
    mode: 'installer',
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadUpdateAssetWithMirrors(job);
  return publicUpdateJob(job);
}
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function safePatchRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel.includes('\0')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  const root = parts[0];
  if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
  const ext = path.posix.extname(rel).toLowerCase();
  if (!PATCH_STATIC_EXTENSIONS.has(ext)) return '';
  if (/\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i.test(rel)) return '';
  return parts.join('/');
}
function patchTargetPath(rel) {
  const safeRel = safePatchRelativePath(rel);
  if (!safeRel) return null;
  const target = path.resolve(__dirname, safeRel);
  const root = path.resolve(__dirname);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
function decodePatchFile(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
  if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
  return null;
}
function backupPatchTarget(job, rel, target) {
  if (!fs.existsSync(target)) return;
  const backup = path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
}
function writePatchFile(job, file) {
  const rel = safePatchRelativePath(file.path || file.name);
  const target = rel ? patchTargetPath(rel) : null;
  const content = decodePatchFile(file);
  if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
  if (content.length > PATCH_MAX_BYTES) throw new Error('PATCH_FILE_TOO_LARGE');
  const expected = String(file.sha256 || '').trim().toLowerCase();
  const actual = sha256Hex(content);
  if (expected && expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
  backupPatchTarget(job, rel, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.mineradio-patch';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  if (expected && sha256Hex(fs.readFileSync(target)) !== expected) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + rel);
  return rel;
}
function assertPatchSignature(payload) {
  if (!UPDATE_PUBKEY_PEM) return;
  const signature = String(payload.signature || payload.sig || '').trim();
  if (!signature) throw new Error('PATCH_SIGNATURE_MISSING');
  const signedPayload = Object.assign({}, payload);
  delete signedPayload.signature;
  delete signedPayload.sig;
  const ok = crypto.verify(
    'sha256',
    Buffer.from(JSON.stringify(signedPayload), 'utf8'),
    crypto.createPublicKey(UPDATE_PUBKEY_PEM),
    Buffer.from(signature, 'base64'),
  );
  if (!ok) throw new Error('PATCH_SIGNATURE_INVALID');
}
function parsePatchPayload(raw) {
  const payload = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
  assertPatchSignature(payload);
  return normalizePatchPayload(payload);
}
function normalizePatchPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
  const type = String(payload.type || payload.kind || '');
  if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
  const from = normalizeVersion(payload.from || payload.baseVersion || '');
  const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH');
  if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID');
  if (!files.length) throw new Error('PATCH_EMPTY');
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
  return { from, to, files, restartRequired: payload.restartRequired === true };
}
async function downloadAndApplyPatch(job) {
  const chunks = [];
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.mode = 'patch';
    job.message = '正在下载快速补丁';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Patch download failed ' + resp.status);

    job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.total || 0;
    job.received = 0;
    const reader = resp.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buf = Buffer.from(chunk.value);
      job.received += buf.length;
      if (job.received > PATCH_MAX_BYTES) throw new Error('PATCH_TOO_LARGE');
      chunks.push(buf);
      job.progress = job.total > 0
        ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
        : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
      job.updatedAt = Date.now();
    }

    const raw = Buffer.concat(chunks);
    const expectedPatchHash = String(job.sha256 || '').trim().toLowerCase();
    if (expectedPatchHash && sha256Hex(raw) !== expectedPatchHash) throw new Error('PATCH_PACKAGE_HASH_MISMATCH');
    const patch = parsePatchPayload(raw.toString('utf8'));
    job.version = patch.to;
    job.message = '正在应用快速补丁';
    job.progress = 88;
    job.updatedAt = Date.now();
    const changed = [];
    patch.files.forEach(file => changed.push(writePatchFile(job, file)));
    job.changedFiles = changed;
    job.status = 'ready';
    job.progress = 100;
    job.restartRequired = patch.restartRequired;
    job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
    job.updatedAt = Date.now();
  } catch (e) {
    job.status = 'error';
    job.error = e.message || 'PATCH_APPLY_FAILED';
    job.message = '快速补丁失败，可改用完整安装包';
    job.updatedAt = Date.now();
  }
}
async function downloadPatchBufferFromCandidate(job, candidate, index, total) {
  ensureMirrorCanBeVerified(job, candidate);
  prepareUpdateJobAttempt(job, candidate, index, total);
  job.mode = 'patch';
  job.message = '正在下载快速补丁';
  job.progress = 0;
  job.updatedAt = Date.now();

  const resp = await fetchWithTimeout(candidate.url, {
    headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
  }, 12000);
  if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

  job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0;
  job.received = 0;
  const chunks = [];
  const reader = resp.body.getReader();
  let speedWindowAt = Date.now();
  let speedWindowBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const buf = Buffer.from(chunk.value);
    job.received += buf.length;
    speedWindowBytes += buf.length;
    if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large');
    chunks.push(buf);
    const now = Date.now();
    if (now - speedWindowAt >= 700) {
      job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
      speedWindowAt = now;
      speedWindowBytes = 0;
    }
    job.progress = job.total > 0
      ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
      : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
    job.etaSeconds = job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
    job.updatedAt = Date.now();
  }
  const raw = Buffer.concat(chunks);
  verifyUpdateBuffer(raw, job);
  return raw;
}
async function downloadAndApplyPatchWithMirrors(job) {
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length);
      const patch = parsePatchPayload(raw.toString('utf8'));
      job.version = patch.to;
      job.message = '正在应用快速补丁';
      job.progress = 88;
      job.etaSeconds = 0;
      job.updatedAt = Date.now();
      const changed = [];
      patch.files.forEach(file => changed.push(writePatchFile(job, file)));
      job.changedFiles = changed;
      job.status = 'ready';
      job.progress = 100;
      job.restartRequired = patch.restartRequired;
      job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason);
    }
  }
}
function startUpdatePatchJob(info) {
  const release = info && info.release ? info.release : {};
  const patch = release.patch || {};
  const downloadUrl = patch.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' };

  const version = info.latestVersion || release.version || patch.to || '';
  const existing = Array.from(updateDownloadJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .find(job => job.mode === 'patch' && job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
  if (existing) return publicUpdateJob(existing);

  const now = Date.now();
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []));
  const job = {
    id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: patch.size || 0,
    mode: 'patch',
    fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
    filePath: '',
    version,
    downloadUrl,
    downloadCandidates,
    releaseUrl: release.htmlUrl || '',
    expectedSize: patch.size || 0,
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    restartRequired: true,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    message: '等待下载快速补丁',
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadAndApplyPatchWithMirrors(job);
  return publicUpdateJob(job);
}
function readRequestBody(req) {
  const MAX_BYTES = 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    req.on('data', chunk => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BYTES) {
        req.destroy();
        finish(() => reject(new Error('BODY_TOO_LARGE')));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      if (settled) return;
      finish(() => {
        if (!chunks.length) { resolve({}); return; }
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(raw)); }
        catch (e) {
          const params = new URLSearchParams(raw);
          const out = {};
          params.forEach((v, k) => { out[k] = v; });
          resolve(out);
        }
      });
    });
    req.on('error', (err) => finish(() => reject(err || new Error('BODY_READ_FAILED'))));
  });
}
function enqueueDjAnalyze(task) {
  return new Promise((resolve, reject) => {
    djAnalyzeQueue.push({ task, resolve, reject });
    pumpDjAnalyzeQueue();
  });
}
function pumpDjAnalyzeQueue() {
  if (djAnalyzeBusy || !djAnalyzeQueue.length) return;
  djAnalyzeBusy = true;
  const item = djAnalyzeQueue.shift();
  Promise.resolve()
    .then(() => item.task())
    .then(item.resolve, item.reject)
    .finally(() => {
      djAnalyzeBusy = false;
      pumpDjAnalyzeQueue();
    });
}
function normalizeApiCode(payload) {
  const body = payload && (payload.body || payload);
  return Number((body && body.code) || (body && body.body && body.body.code) || (payload && payload.status) || 0);
}
function normalizeApiMessage(payload) {
  const body = payload && (payload.body || payload);
  return (body && (body.message || body.msg || body.error)) || (body && body.body && (body.body.message || body.body.msg || body.body.error)) || '';
}
function parseCookieString(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach(part => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}
function serializeCookieObject(obj) {
  return Object.keys(obj || {})
    .filter(k => obj[k] != null && String(obj[k]) !== '')
    .map(k => k + '=' + String(obj[k]))
    .join('; ');
}
function qqCookieObject() {
  return parseCookieString(qqCookie);
}
function normalizeQQUin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
}
function qqCookieUin(obj) {
  obj = obj || qqCookieObject();
  const raw = Number(obj.login_type) === 2 ? (obj.wxuin || obj.uin || obj.p_uin) : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin);
  return normalizeQQUin(raw);
}
function qqCookieMusicKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
}
function qqCookiePlaybackKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
}
function decodeQQCookieValue(value) {
  try { return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim(); }
  catch (e) { return String(value || '').trim(); }
}
function qqCookieNickname(obj, uin) {
  obj = obj || qqCookieObject();
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  const padded = uin ? '0' + uin : '';
  const keys = [
    uin && ('ptnick_' + uin),
    padded && ('ptnick_' + padded),
    'ptnick',
    'nick',
    'nickname',
    'qq_nickname'
  ].filter(Boolean);
  for (const key of keys) {
    if (obj[key]) {
      const nick = decodeQQCookieValue(obj[key]);
      if (nick) return nick;
    }
  }
  const ptnickKey = Object.keys(obj).find(key => /^ptnick_/i.test(key) && obj[key]);
  return ptnickKey ? decodeQQCookieValue(obj[ptnickKey]) : '';
}
function qqCookieAvatar(obj, uin) {
  obj = obj || qqCookieObject();
  const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || '';
  if (direct) return decodeQQCookieValue(direct);
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : '';
}
function normalizeQQCookieInput(cookieText) {
  const obj = parseCookieString(cookieText);
  if (Number(obj.login_type) === 2 && obj.wxuin && !obj.uin) obj.uin = obj.wxuin;
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin;
  if (obj.uin) obj.uin = normalizeQQUin(obj.uin);
  return serializeCookieObject(obj);
}

function kugouCookieObject() {
  return parseCookieString(kugouCookie);
}

function kugouCookieUserId(obj) {
  obj = obj || kugouCookieObject();
  return String(obj.userid || obj.user_id || obj.uid || obj.KugooID || obj.kugou_id || obj.kugouid || obj.kg_uid || '').replace(/\D/g, '');
}

function kugouCookieToken(obj) {
  obj = obj || kugouCookieObject();
  return obj.token || obj.user_token || obj.access_token || obj.key || obj.KuGoo || obj.t || '';
}

function kugouCookieNickname(obj) {
  obj = obj || kugouCookieObject();
  try {
    return decodeURIComponent(obj.nickname || obj.nick || obj.username || obj.user_name || obj.uname || '').trim();
  } catch (_) {
    return obj.nickname || obj.nick || obj.username || obj.user_name || obj.uname || '';
  }
}

function kugouCookieAvatar(obj) {
  obj = obj || kugouCookieObject();
  const raw = obj.avatar || obj.pic || obj.img || obj.icon || obj.headpic || obj.head_img || obj.headimg || obj.user_pic || obj.userpic || '';
  try {
    return decodeURIComponent(raw).trim();
  } catch (_) {
    return String(raw || '').trim();
  }
}

function kugouCookieVipType(obj) {
  obj = obj || kugouCookieObject();
  const raw = obj.vipType || obj.vip_type || obj.viptype || obj.isvip || obj.is_vip || obj.vip || 0;
  return Number(raw) || 0;
}

function normalizeKugouCookieInput(cookieText) {
  return normalizeCookieHeader(cookieText) || rawCookieFallback(cookieText);
}

function getKugouLoginInfo() {
  const obj = kugouCookieObject();
  const userId = kugouCookieUserId(obj);
  const token = kugouCookieToken(obj);
  const loggedIn = !!(userId && token);
  const vipType = loggedIn ? kugouCookieVipType(obj) : 0;
  const isVip = vipType > 0 || String(obj.vip || obj.is_vip || obj.isvip || '').toLowerCase() === 'true';
  return {
    provider: 'kugou',
    loggedIn,
    hasCookie: !!kugouCookie,
    userId,
    nickname: loggedIn ? (kugouCookieNickname(obj) || '酷狗音乐用户') : '酷狗音乐',
    avatar: loggedIn ? kugouCookieAvatar(obj) : '',
    vipType,
    vipLevel: isVip ? 'vip' : 'none',
    isVip,
    isSvip: false,
    vipLabel: isVip ? 'Kugou VIP' : '无 VIP',
    playbackKeyReady: loggedIn,
    preview: !loggedIn,
    message: loggedIn ? '已保存酷狗网页登录会话' : '未登录酷狗音乐'
  };
}

function playbackRestriction(provider, category, message, action, extra) {
  return {
    provider,
    category,
    action: action || '',
    message,
    ...(extra || {}),
  };
}
function classifyNeteasePlaybackRestriction(lastData, loginInfo) {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn);
  const fee = Number(lastData && lastData.fee);
  const code = Number(lastData && lastData.code);
  const freeTrial = lastData && lastData.freeTrialInfo;
  if (!loggedIn) {
    return playbackRestriction('netease', 'login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee });
  }
  if (freeTrial) {
    return playbackRestriction('netease', 'trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee });
  }
  if (fee === 1) {
    return playbackRestriction('netease', 'vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee });
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('netease', 'paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee });
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('netease', 'copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee });
  }
  return playbackRestriction('netease', 'url_unavailable', '网易云没有返回可播放地址，可能是版权、会员或地区限制', loggedIn ? 'switch_source' : 'login', { code, fee });
}
function classifyQQPlaybackRestriction(info, session) {
  const hasSession = typeof session === 'object' ? !!session.hasSession : !!session;
  const hasPlaybackKey = typeof session === 'object' ? !!session.hasPlaybackKey : hasSession;
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim();
  const code = Number((info && (info.result || info.code || info.errtype)) || 0);
  const lower = rawMsg.toLowerCase();
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', { code, rawMessage: rawMsg });
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权', 'login', { code, rawMessage: rawMsg, missingPlaybackKey: true });
  }
  if (code === 104003) {
    return playbackRestriction('qq', 'copyright_unavailable', 'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制，可以换一个搜索结果或切到网易云源', 'switch_source', { code, rawMessage: rawMsg });
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', { code, rawMessage: rawMsg });
  }
  if (code && code !== 0) {
    return playbackRestriction('qq', 'copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', { code, rawMessage: rawMsg });
  }
  return playbackRestriction('qq', 'url_unavailable', 'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制', 'switch_source', { code, rawMessage: rawMsg });
}
const NETEASE_QUALITY_CANDIDATES = [
  { level: 'jymaster', br: 1999000, label: '超清母带', svip: true },
  { level: 'hires',    br: 1999000, label: '高清臻音' },
  { level: 'lossless', br: 1411000, label: '无损' },
  { level: 'exhigh',   br: 999000,  label: '极高' },
  { level: 'standard', br: 128000,  label: '标准' },
];
const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
];
function normalizeQualityPreference(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (['jymaster', 'master', 'studio', 'svip'].includes(raw)) return 'jymaster';
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires';
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless';
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh';
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard';
  return 'hires';
}
function qualityCandidatesFrom(target, candidates) {
  target = normalizeQualityPreference(target);
  let start = candidates.findIndex(item => item.level === target);
  if (start < 0) start = 0;
  return candidates.slice(start);
}
function hasNeteaseSvip(loginInfo) {
  return !!(loginInfo && loginInfo.loggedIn && (loginInfo.vipLevel === 'svip' || loginInfo.isSvip || Number(loginInfo.vipType || 0) >= 10));
}
function mapArtists(raw) {
  return (raw || [])
    .map(a => ({ id: a && a.id, name: (a && a.name) || '' }))
    .filter(a => a.name);
}
const NETEASE_DIRECT_RESOLVE_BUDGET_MS = 4800;
const NETEASE_SOURCE_MATCH_TOTAL_BUDGET_MS = 8000;
const NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS = 4800;
const NETEASE_SONG_URL_TOTAL_BUDGET_MS = 12000;

function mapSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: s.id,
    name: s.name,
    artist: artists.map(a => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: s.dt || s.duration || 0,
    fee: s.fee,
  };
}
function mapDiscoverPlaylist(pl, tag) {
  pl = pl || {};
  const creator = pl.creator || pl.user || {};
  const id = pl.id || pl.resourceId || pl.creativeId;
  return {
    provider: 'netease',
    source: 'netease',
    type: 'playlist',
    id,
    name: pl.name || pl.title || '',
    cover: pl.picUrl || pl.coverImgUrl || pl.coverUrl || pl.uiElement && pl.uiElement.image && pl.uiElement.image.imageUrl || '',
    trackCount: pl.trackCount || pl.songCount || pl.programCount || 0,
    playCount: pl.playCount || pl.playcount || 0,
    creator: creator.nickname || creator.name || '',
    tag: tag || pl.alg || '',
  };
}

function lowSignalText(value) {
  return String(value || '').trim().toLowerCase();
}

function isLowSignalPodcastItem(item) {
  const name = lowSignalText(item && (item.name || item.title || item.radioName));
  const sub = lowSignalText(item && (item.djName || item.category || item.desc || item.sub));
  const text = name + ' ' + sub;
  return /购买播客|付费精品|qzone|空间背景音乐|背景音乐|四只烤翅|试纸烤翅/i.test(text);
}

function isQQFavoritePlaylist(pl) {
  const name = String(pl && pl.name || '').trim();
  return /我喜欢|我的喜欢|喜欢的音乐/i.test(name);
}

function isQzoneBackgroundPlaylist(pl) {
  const text = String((pl && pl.name || '') + ' ' + (pl && pl.creator || '')).toLowerCase();
  return /qzone|空间|背景音乐/i.test(text);
}
async function requireLogin(res) {
  const info = await getLoginInfo();
  if (!info.loggedIn || !info.userId) {
    sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
    return null;
  }
  return info;
}

// ---------- 业务: 搜索 ----------
//   优先用 cloudsearch (新接口, 字段更全, picUrl 更稳定)
//   对于仍然缺失封面的歌曲, 用 song_detail 批量补齐
async function handleSearch(keywords, limit) {
  console.log('[Search]', keywords, 'limit:', limit);
  const result = await cloudsearch({ keywords, limit, cookie: userCookie });
  const songs = result.body && result.body.result && result.body.result.songs ? result.body.result.songs : [];

  let mapped = songs.map(s => {
    return mapSongRecord(s);
  });

  // 兜底: 补齐缺失的封面
  const missing = mapped.filter(s => !s.cover).map(s => s.id);
  if (missing.length) {
    try {
      console.log('[Search] backfilling covers for', missing.length, 'songs');
      const dd = await song_detail({ ids: missing.join(','), cookie: userCookie });
      const songsArr = (dd.body && dd.body.songs) || [];
      const idToPic = {};
      songsArr.forEach(s => {
        const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '';
        if (pic) idToPic[s.id] = pic;
      });
      mapped = mapped.map(s => s.cover ? s : { ...s, cover: idToPic[s.id] || '' });
    } catch (e) { console.warn('[Search] backfill failed:', e.message); }
  }

  return mapped;
}

const NETEASE_SOURCE_MATCH_POSITIVE_TTL_MS = 12 * 60 * 60 * 1000;
const NETEASE_SOURCE_MATCH_NEGATIVE_TTL_MS = 5 * 60 * 1000;
const NETEASE_SOURCE_MATCH_MAX_CANDIDATES = 4;
const neteaseSourceMatchCache = new Map();

function neteaseSourceMatchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|!?！？]+/g, '');
}
function neteaseSourceMatchDurationMs(value) {
  let duration = Number(value) || 0;
  if (duration > 0 && duration < 10000) duration *= 1000;
  return Math.max(0, duration);
}
function neteaseSourceMatchArtists(song) {
  const list = song && (song.ar || song.artists) || [];
  return (Array.isArray(list) ? list : []).map(artist => ({
    id: String(artist && artist.id || ''),
    name: neteaseSourceMatchText(artist && artist.name || ''),
  })).filter(artist => artist.id || artist.name);
}
function neteaseSourceMatchVersionTokens(song) {
  const aliases = song && (song.alia || song.alias) || [];
  const text = String((song && song.name || '') + ' ' + (Array.isArray(aliases) ? aliases.join(' ') : aliases || '')).toLowerCase();
  const rules = [
    ['live', /\blive\b|现场|演唱会/],
    ['cover', /\bcover\b|翻唱/],
    ['remix', /\bremix\b|\b(?:pop |radio |club |digital dog )?mix\b|mix版/],
    ['remaster', /\bremaster(?:ed)?\b|重制/],
    ['rerecord', /\bre[ -]?record(?:ed|ing)?\b|重录/],
    ['named-version', /taylor['’]?s version|\bversion\b|\bver\.?\b|版本/],
    ['edit', /\bradio edit\b|\bedit\b|剪辑版/],
    ['alternate-cut', /\bstripped\b|\bmono\b|\bstereo\b|\bcommentary\b/],
    ['instrumental', /\binstrumental\b|伴奏|\bkaraoke\b/],
    ['acoustic', /\bacoustic\b|不插电/],
    ['speed', /\bnightcore\b|\bsped up\b|\bslowed(?: and reverb)?\b|加速|慢速|变速/],
    ['dj', /\bdj\b|dj版/],
    ['demo', /\bdemo\b|试听版/],
  ];
  return rules.filter(rule => rule[1].test(text)).map(rule => rule[0]);
}
function neteaseSourceMatchMediaProfiles(song) {
  const profiles = [];
  ['h', 'm', 'l', 'sq', 'hr', 'hMusic', 'mMusic', 'lMusic', 'sqMusic', 'hrMusic'].forEach(key => {
    const item = song && song[key];
    if (!item) return;
    const profile = {
      br: Number(item.br || item.bitrate || 0) || 0,
      size: Number(item.size || 0) || 0,
      duration: Number(item.playTime || item.playtime || item.duration || 0) || 0,
      sr: Number(item.sr || item.sampleRate || 0) || 0,
    };
    if (profile.br || profile.size) profiles.push(profile);
  });
  return profiles;
}
function neteaseSourceMatchFingerprintCount(source, candidate) {
  const sourceProfiles = neteaseSourceMatchMediaProfiles(source);
  const candidateProfiles = neteaseSourceMatchMediaProfiles(candidate);
  let matches = 0;
  sourceProfiles.forEach(left => {
    if (candidateProfiles.some(right =>
      left.br && left.br === right.br &&
      left.size && left.size === right.size &&
      (!left.duration || !right.duration || Math.abs(left.duration - right.duration) <= 10) &&
      (!left.sr || !right.sr || left.sr === right.sr)
    )) matches++;
  });
  return matches;
}
function neteaseSourceMatchArtistSetEqual(sourceArtists, candidateArtists) {
  const sourceIds = [...new Set(sourceArtists.map(artist => artist.id).filter(Boolean))].sort();
  const candidateIds = [...new Set(candidateArtists.map(artist => artist.id).filter(Boolean))].sort();
  if (sourceIds.length && candidateIds.length) {
    return sourceIds.length === candidateIds.length && sourceIds.every((id, index) => id === candidateIds[index]);
  }
  const sourceNames = [...new Set(sourceArtists.map(artist => artist.name).filter(Boolean))].sort();
  const candidateNames = [...new Set(candidateArtists.map(artist => artist.name).filter(Boolean))].sort();
  return sourceNames.length > 0 && sourceNames.length === candidateNames.length && sourceNames.every((name, index) => name === candidateNames[index]);
}
function neteaseSourceMatchCandidateScore(source, candidate) {
  if (!source || !candidate || String(source.id || '') === String(candidate.id || '')) return -1;
  if (neteaseSourceMatchText(source.name) !== neteaseSourceMatchText(candidate.name)) return -1;
  const sourceVersions = neteaseSourceMatchVersionTokens(source);
  const candidateVersions = neteaseSourceMatchVersionTokens(candidate);
  if (sourceVersions.join('|') !== candidateVersions.join('|')) return -1;
  const sourceArtists = neteaseSourceMatchArtists(source);
  const candidateArtists = neteaseSourceMatchArtists(candidate);
  const sourceIds = sourceArtists.map(artist => artist.id).filter(Boolean);
  const candidateIds = candidateArtists.map(artist => artist.id).filter(Boolean);
  const artistIdMatch = sourceIds.length && candidateIds.length && sourceIds.some(id => candidateIds.indexOf(id) >= 0);
  const artistNameMatch = sourceArtists.some(left => candidateArtists.some(right => left.name && right.name && left.name === right.name));
  const artistSetMatch = neteaseSourceMatchArtistSetEqual(sourceArtists, candidateArtists);
  if (!artistIdMatch && !artistNameMatch) return -1;
  const sourceDuration = neteaseSourceMatchDurationMs(source.dt || source.duration);
  const candidateDuration = neteaseSourceMatchDurationMs(candidate.dt || candidate.duration);
  const durationDiff = sourceDuration && candidateDuration ? Math.abs(sourceDuration - candidateDuration) : 0;
  const durationLimit = sourceDuration ? Math.max(1800, sourceDuration * 0.012) : 0;
  if (durationLimit && durationDiff > durationLimit) return -1;
  const fingerprintMatches = neteaseSourceMatchFingerprintCount(source, candidate);
  const officialRecommendation = !!candidate.__officialSourceMatch;
  if (!fingerprintMatches && (!artistSetMatch || !sourceDuration || !candidateDuration || durationDiff > (officialRecommendation ? 1800 : 600))) return -1;
  const privilege = candidate.__privilege || candidate.privilege || {};
  let score = fingerprintMatches * 120;
  if (artistIdMatch) score += 70;
  else if (artistNameMatch) score += 42;
  if (artistSetMatch) score += 18;
  if (officialRecommendation) score += 240;
  if (sourceDuration && candidateDuration) score += Math.max(0, 45 - durationDiff / 100);
  if (Number(privilege.pl || 0) > 0 && String(privilege.plLevel || '').toLowerCase() !== 'none') score += 22;
  score += Math.min(20, Number(candidate.pop || candidate.popularity || candidate.score || 0) / 5 || 0);
  return score;
}
function neteaseSourceMatchCacheKey(id, hints) {
  hints = hints || {};
  return [
    String(id || ''),
    neteaseSourceMatchText(hints.name || hints.title),
    neteaseSourceMatchText(hints.artist),
    Math.round(neteaseSourceMatchDurationMs(hints.duration) / 1000),
  ].join('|');
}
function readNeteaseSourceMatchCache(key) {
  const entry = neteaseSourceMatchCache.get(key);
  if (!entry) return null;
  const ttl = entry.candidates && entry.candidates.length ? NETEASE_SOURCE_MATCH_POSITIVE_TTL_MS : NETEASE_SOURCE_MATCH_NEGATIVE_TTL_MS;
  if (Date.now() - entry.at > ttl) {
    neteaseSourceMatchCache.delete(key);
    return null;
  }
  return entry.candidates;
}
function writeNeteaseSourceMatchCache(key, candidates) {
  neteaseSourceMatchCache.set(key, { at: Date.now(), candidates: candidates || [] });
  while (neteaseSourceMatchCache.size > 256) neteaseSourceMatchCache.delete(neteaseSourceMatchCache.keys().next().value);
}
function neteaseSourceMatchHintArtists(hints) {
  hints = hints || {};
  const ids = String(hints.artistIds || hints.artistId || '').split(',').map(value => value.trim()).filter(Boolean);
  let names = String(hints.artistNames || '').split('\u001f').map(value => value.trim()).filter(Boolean);
  if (!names.length && String(hints.artist || '').trim()) names = [String(hints.artist).trim()];
  const count = Math.max(ids.length, names.length);
  const artists = [];
  for (let index = 0; index < count; index++) {
    const id = ids[index] || '';
    const name = names[index] || (count === 1 ? String(hints.artist || '').trim() : '');
    if (id || name) artists.push({ id, name });
  }
  return artists;
}
function mergeNeteaseSourceMatchSong(detailSong, searchSong, hints) {
  const detail = detailSong || {};
  const searchItem = searchSong || {};
  const merged = { ...searchItem, ...detail };
  const rawDetailArtists = detail.ar || detail.artists || [];
  const rawSearchArtists = searchItem.ar || searchItem.artists || [];
  const detailArtists = (Array.isArray(rawDetailArtists) ? rawDetailArtists : []).filter(artist => artist && (artist.id || String(artist.name || '').trim()));
  const searchArtists = (Array.isArray(rawSearchArtists) ? rawSearchArtists : []).filter(artist => artist && (artist.id || String(artist.name || '').trim()));
  const hintArtists = neteaseSourceMatchHintArtists(hints);
  const artists = (Array.isArray(detailArtists) && detailArtists.length)
    ? detailArtists
    : ((Array.isArray(searchArtists) && searchArtists.length) ? searchArtists : hintArtists);
  const detailAlbum = detail.al || detail.album || {};
  const searchAlbum = searchItem.al || searchItem.album || {};
  const album = { ...searchAlbum, ...detailAlbum };
  album.name = String(detailAlbum.name || '').trim() || String(searchAlbum.name || '').trim() || hints && hints.album || '';
  merged.id = detail.id || searchItem.id || hints && hints.id || '';
  merged.name = String(detail.name || '').trim() || String(searchItem.name || '').trim() || hints && (hints.name || hints.title) || '';
  merged.ar = artists;
  merged.artists = artists;
  merged.al = album;
  merged.album = album;
  merged.dt = detail.dt || detail.duration || searchItem.dt || searchItem.duration || neteaseSourceMatchDurationMs(hints && hints.duration);
  ['h', 'm', 'l', 'sq', 'hr', 'hMusic', 'mMusic', 'lMusic', 'sqMusic', 'hrMusic'].forEach(key => {
    if (!merged[key] && searchItem[key]) merged[key] = searchItem[key];
  });
  return merged;
}
async function findNeteaseSameTrackCandidates(id, hints, lookupDeadline) {
  hints = hints || {};
  const deadline = Number(lookupDeadline) > 0 ? Number(lookupDeadline) : Date.now() + NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS;
  const sourceId = String(id || '').trim();
  const title = String(hints.name || hints.title || '').trim();
  const artist = String(hints.artist || '').trim();
  if (!sourceId || !title || !artist) return [];
  const cacheKey = neteaseSourceMatchCacheKey(sourceId, hints);
  const cached = readNeteaseSourceMatchCache(cacheKey);
  if (cached) return cached;
  const query = [title, artist].filter(Boolean).join(' ');
  let searchSongs = [];
  try {
    const searchBudget = Math.min(3000, Math.max(500, deadline - Date.now()));
    const result = await promiseWithTimeout(cloudsearch({ keywords: query, type: 1, limit: 16, cookie: userCookie }), searchBudget, 'NETEASE_SOURCE_SEARCH_TIMEOUT');
    searchSongs = result.body && result.body.result && Array.isArray(result.body.result.songs) ? result.body.result.songs : [];
  } catch (err) {
    console.warn('[NeteaseSourceMatch] search failed:', err.code || err.message);
    return [];
  }
  const searchById = new Map(searchSongs.map(song => [String(song && song.id || ''), song]));
  const detailIds = [sourceId].concat(searchSongs.slice(0, 12).map(song => String(song && song.id || '')).filter(Boolean));
  let detailSongs = [];
  let privileges = [];
  try {
    const detailBudget = Math.min(2000, Math.max(500, deadline - Date.now()));
    const detail = await promiseWithTimeout(song_detail({ ids: [...new Set(detailIds)].join(','), cookie: userCookie }), detailBudget, 'NETEASE_SOURCE_DETAIL_TIMEOUT');
    detailSongs = detail.body && Array.isArray(detail.body.songs) ? detail.body.songs : [];
    privileges = detail.body && Array.isArray(detail.body.privileges) ? detail.body.privileges : [];
  } catch (err) {
    console.warn('[NeteaseSourceMatch] detail failed:', err.code || err.message);
  }
  const privilegeById = new Map(privileges.map(item => [String(item && item.id || ''), item]));
  const detailById = new Map(detailSongs.map(song => [String(song && song.id || ''), song]));
  const sourceDetail = detailById.get(sourceId) || searchById.get(sourceId) || null;
  const officialRecommendationId = String(sourceDetail && sourceDetail.noCopyrightRcmd && sourceDetail.noCopyrightRcmd.songId || '');
  if (officialRecommendationId && !detailById.has(officialRecommendationId) && !searchById.has(officialRecommendationId) && deadline - Date.now() >= 500) {
    try {
      const officialDetail = await promiseWithTimeout(song_detail({ ids: officialRecommendationId, cookie: userCookie }), Math.min(1000, Math.max(500, deadline - Date.now())), 'NETEASE_OFFICIAL_MATCH_DETAIL_TIMEOUT');
      const officialSongs = officialDetail.body && Array.isArray(officialDetail.body.songs) ? officialDetail.body.songs : [];
      const officialPrivileges = officialDetail.body && Array.isArray(officialDetail.body.privileges) ? officialDetail.body.privileges : [];
      officialSongs.forEach(song => detailById.set(String(song && song.id || ''), song));
      officialPrivileges.forEach(item => privilegeById.set(String(item && item.id || ''), item));
    } catch (err) {
      console.warn('[NeteaseSourceMatch] official alternate detail failed:', err.code || err.message);
    }
  }
  const source = mergeNeteaseSourceMatchSong(detailById.get(sourceId), searchById.get(sourceId), {
    ...hints,
    id: sourceId,
    name: title,
    artist,
  });
  const ranked = [];
  const candidateSeeds = searchSongs.slice();
  if (officialRecommendationId && !candidateSeeds.some(song => String(song && song.id || '') === officialRecommendationId)) {
    const officialSeed = detailById.get(officialRecommendationId) || { id: officialRecommendationId, name: title, ar: neteaseSourceMatchHintArtists(hints), dt: neteaseSourceMatchDurationMs(hints.duration) };
    candidateSeeds.unshift(officialSeed);
  }
  candidateSeeds.forEach(searchSong => {
    const candidateId = String(searchSong && searchSong.id || '');
    if (!candidateId || candidateId === sourceId) return;
    const candidate = mergeNeteaseSourceMatchSong(detailById.get(candidateId), searchSong, {});
    candidate.__privilege = privilegeById.get(candidateId) || searchSong.privilege || {};
    candidate.__officialSourceMatch = !!(officialRecommendationId && candidateId === officialRecommendationId);
    const score = neteaseSourceMatchCandidateScore(source, candidate);
    if (score < 0) return;
    ranked.push({
      song: mapSongRecord(candidate),
      score,
      fingerprintMatches: neteaseSourceMatchFingerprintCount(source, candidate),
      officialRecommendation: !!candidate.__officialSourceMatch,
      durationDiff: Math.abs(neteaseSourceMatchDurationMs(source.dt || source.duration) - neteaseSourceMatchDurationMs(candidate.dt || candidate.duration)),
    });
  });
  ranked.sort((a, b) => b.score - a.score || a.durationDiff - b.durationDiff || Number(b.song.popularity || 0) - Number(a.song.popularity || 0));
  const candidates = ranked.slice(0, NETEASE_SOURCE_MATCH_MAX_CANDIDATES);
  writeNeteaseSourceMatchCache(cacheKey, candidates);
  return candidates;
}


async function handleDiscoverHome() {
  const info = await getLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  if (!loggedIn) {
    return {
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  const tasks = [
    personalized({ limit: 8, cookie: userCookie, timestamp: Date.now() }),
    dj_hot({ limit: 6, offset: 0, cookie: userCookie, timestamp: Date.now() }),
    recommend_resource({ cookie: userCookie, timestamp: Date.now() }),
    recommend_songs({ cookie: userCookie, timestamp: Date.now() }),
  ];
  const result = await Promise.allSettled(tasks);

  const personalizedBody = result[0].status === 'fulfilled' && result[0].value && result[0].value.body || {};
  const publicPlaylists = (personalizedBody.result || personalizedBody.data || [])
    .map(pl => mapDiscoverPlaylist(pl, '推荐歌单'))
    .filter(pl => pl.id && pl.name)
    .slice(0, 8);

  const podcastBody = result[1].status === 'fulfilled' && result[1].value && result[1].value.body || {};
  const podcastRaw = podcastBody.djRadios || podcastBody.djradios || podcastBody.radios || podcastBody.data || [];
  const podcasts = (Array.isArray(podcastRaw) ? podcastRaw : [])
    .map(mapPodcastRadio)
    .filter(p => p.id && !isLowSignalPodcastItem(p))
    .slice(0, 6);

  let privatePlaylists = [];
  if (result[2].status === 'fulfilled' && result[2].value) {
    const body = result[2].value.body || {};
    const raw = body.recommend || body.data || [];
    privatePlaylists = (Array.isArray(raw) ? raw : [])
      .map(pl => mapDiscoverPlaylist(pl, '私人推荐'))
      .filter(pl => pl.id && pl.name)
      .slice(0, 6);
  }

  let dailySongs = [];
  if (result[3].status === 'fulfilled' && result[3].value) {
    const body = result[3].value.body || {};
    const raw = body.data && (body.data.dailySongs || body.data.recommend) || body.recommend || [];
    dailySongs = (Array.isArray(raw) ? raw : [])
      .map(mapSongRecord)
      .filter(song => song.id && song.name)
      .slice(0, 12);
  }

  return {
    loggedIn,
    user: loggedIn ? { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' } : null,
    dailySongs,
    playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
    podcasts,
    updatedAt: Date.now(),
  };
}

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
};
const KUGOU_GATEWAY_URL = 'https://gateway.kugou.com';
const KUGOU_LOGIN_BASE_URL = 'https://login-user.kugou.com';
const KUGOU_USER_SERVICE_URL = 'https://userservice.kugou.com';
const KUGOU_APPID = '3116';
const KUGOU_CLIENTVER = '11440';
const KUGOU_QR_APPID = '1001';
const KUGOU_QR_SRC_APPID = '2919';
const KUGOU_ANDROID_SIGN_KEY = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const KUGOU_WEB_SIGN_KEY = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const KUGOU_PLAY_KEY_SALT = 'kgcloudv2';
const KUGOU_RSA_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');
const KUGOU_ANDROID_UA = 'Android15-1070-11440-46-0-DiscoveryDRADProtocol-wifi';
const KUGOU_DEFAULT_MID = crypto.createHash('md5').update((process.env.COMPUTERNAME || 'mineradio') + ':kugou').digest('hex');
let kugouVipProbeCache = { userId: '', checkedAt: 0, info: null };

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
    req.setTimeout(10000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestBuffer(targetUrl, opts, body) {
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
        const buf = Buffer.concat(chunks);
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = buf.toString('utf8');
          reject(err);
          return;
        }
        resolve(buf);
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Request timeout')));
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
    const err = new Error('Invalid JSON from ' + targetUrl);
    err.cause = e;
    throw err;
  }
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function openMeteoWeatherLabel(code) {
  code = Number(code);
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '少云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code === 51 || code === 53 || code === 55) return '毛毛雨';
  if (code === 56 || code === 57) return '冻雨';
  if (code === 61 || code === 63 || code === 65) return '雨';
  if (code === 66 || code === 67) return '冻雨';
  if (code === 71 || code === 73 || code === 75 || code === 77) return '雪';
  if (code === 80 || code === 81 || code === 82) return '阵雨';
  if (code === 85 || code === 86) return '阵雪';
  if (code === 95 || code === 96 || code === 99) return '雷雨';
  return '天气';
}

function buildWeatherMood(weather, date) {
  const now = date || new Date();
  const hour = now.getHours();
  const code = Number(weather && weather.weatherCode);
  const temp = Number(weather && weather.temperature);
  const apparent = Number(weather && weather.apparentTemperature);
  const rain = Number(weather && weather.precipitation) || 0;
  const humidity = Number(weather && weather.humidity) || 0;
  const wind = Number(weather && weather.windSpeed) || 0;
  const isNight = weather && weather.isDay === 0 || hour < 6 || hour >= 20;
  const isMorning = hour >= 5 && hour < 11;
  const isDusk = hour >= 17 && hour < 20;
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code);
  const isCloud = [2, 3, 45, 48].includes(code);
  const isStorm = [95, 96, 99].includes(code);
  const feels = Number.isFinite(apparent) ? apparent : temp;

  let mood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  };
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    };
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    };
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    };
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.30,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    };
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.40,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    };
  }

  if (isNight) {
    mood.key += '-night';
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听');
    mood.tagline = '音量放低一点，让夜色参与编曲';
    mood.energy = Math.min(mood.energy, 0.42);
    mood.focus = Math.max(mood.focus, 0.68);
    mood.melancholy = Math.max(mood.melancholy, 0.52);
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3));
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台';
    mood.energy = Math.max(mood.energy, 0.52);
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3));
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台';
    mood.melancholy = Math.max(mood.melancholy, 0.48);
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3));
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56);
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4));
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7);
  return mood;
}

async function resolveOpenMeteoLocation(query) {
  const raw = String(query || '').trim();
  if (!raw) return WEATHER_DEFAULT_LOCATION;
  const u = new URL(OPEN_METEO_GEOCODE_URL);
  u.searchParams.set('name', raw);
  u.searchParams.set('count', '5');
  u.searchParams.set('language', 'zh');
  u.searchParams.set('format', 'json');
  if (/[\u4e00-\u9fff]/.test(raw)) u.searchParams.set('countryCode', 'CN');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const results = body && Array.isArray(body.results) ? body.results : [];
  const first = results.find(item => item && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
    || results[0];
  if (!first) return { ...WEATHER_DEFAULT_LOCATION, query: raw, fallback: true };
  return {
    name: first.name || raw,
    country: first.country || '',
    admin1: first.admin1 || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto',
  };
}

function isGenericWeatherLocationName(name) {
  const raw = String(name || '').trim();
  return !raw || raw === '当前位置' || raw === '定位中';
}

function cleanWeatherPlaceLabel(value) {
  return String(value || '')
    .replace(/(市|区|县|區|省|自治区|壮族自治区|维吾尔自治区|回族自治区|特别行政区)$/u, '')
    .trim();
}

function formatBigDataCloudLabel(body) {
  if (!body) return '';
  const city = cleanWeatherPlaceLabel(body.city);
  const district = cleanWeatherPlaceLabel(body.locality);
  const province = cleanWeatherPlaceLabel(body.principalSubdivision);
  if (district && city && district !== city) return district + ' · ' + city;
  if (city && province && city !== province) return city + ' · ' + province;
  if (city) return city;
  if (district) return district;
  if (province) return province;
  return '';
}

function formatNominatimLabel(body) {
  const addr = body && body.address;
  if (!addr) return String(body && body.display_name || '').split(',')[0].trim();
  const district = cleanWeatherPlaceLabel(addr.city_district || addr.district || addr.suburb || addr.borough);
  const city = cleanWeatherPlaceLabel(addr.city || addr.town || addr.county || addr.municipality || addr.village);
  const state = cleanWeatherPlaceLabel(addr.state || addr.province || addr.region);
  if (district && city && district !== city) return district + ' · ' + city;
  if (city && state && city !== state) return city + ' · ' + state;
  if (city) return city;
  if (state) return state;
  if (district) return district;
  return String(body.display_name || '').split(',')[0].trim();
}

async function reverseBigDataCloudLocation(lat, lon) {
  const u = new URL(WEATHER_REVERSE_GEO_URL);
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('localityLanguage', 'zh');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const name = formatBigDataCloudLabel(body);
  if (!name) return null;
  return {
    name,
    country: body && body.countryName || '',
    admin1: body && body.principalSubdivision || '',
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    provider: 'bigdatacloud',
  };
}

async function reverseNominatimLocation(lat, lon) {
  const u = new URL(WEATHER_NOMINATIM_REVERSE_URL);
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lon));
  u.searchParams.set('format', 'json');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'zh-CN,zh');
  u.searchParams.set('zoom', '10');
  const body = await requestJson(u.toString(), {
    headers: {
      'User-Agent': 'MineradioWeather/1.0 (reverse-geocode)',
      Accept: 'application/json',
    },
  });
  const name = formatNominatimLabel(body);
  if (!name) return null;
  const addr = body && body.address || {};
  return {
    name,
    country: addr.country || '',
    admin1: addr.state || addr.province || addr.region || '',
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    provider: 'nominatim',
  };
}

async function resolveWeatherLocationLabel(lat, lon, hintCity) {
  if (!isGenericWeatherLocationName(hintCity)) {
    return {
      name: String(hintCity).trim(),
      country: '',
      admin1: '',
      latitude: lat,
      longitude: lon,
      timezone: 'auto',
      provider: 'manual',
    };
  }
  const providers = [reverseBigDataCloudLocation, reverseNominatimLocation];
  for (const provider of providers) {
    try {
      const resolved = await provider(lat, lon);
      if (resolved && resolved.name) return resolved;
    } catch (e) {
      console.warn('[WeatherRadio] reverse geocode failed:', provider.name || 'provider', e.message);
    }
  }
  try {
    const ip = await fetchIpWeatherLocation();
    if (ip && ip.city && !isGenericWeatherLocationName(ip.city)) {
      const name = ip.region && ip.region !== ip.city
        ? cleanWeatherPlaceLabel(ip.city) + ' · ' + cleanWeatherPlaceLabel(ip.region)
        : cleanWeatherPlaceLabel(ip.city);
      return {
        name,
        country: ip.country || '',
        admin1: ip.region || '',
        latitude: lat,
        longitude: lon,
        timezone: ip.timezone || 'auto',
        provider: ip.provider || 'ip-label',
      };
    }
  } catch (e) {
    console.warn('[WeatherRadio] ip label fallback failed:', e.message);
  }
  return {
    name: String(hintCity || '当前位置').trim() || '当前位置',
    country: '',
    admin1: '',
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    provider: 'coords',
  };
}

function normalizeIpWeatherLocation(payload) {
  if (!payload || !Number.isFinite(Number(payload.latitude)) || !Number.isFinite(Number(payload.longitude))) return null;
  const city = String(payload.city || payload.region || '').trim();
  return {
    provider: payload.provider || 'ip',
    city: city || '当前位置',
    region: payload.region || '',
    country: payload.country || '',
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    timezone: payload.timezone || 'auto',
    ip: payload.ip || '',
  };
}

async function fetchIpWeatherLocationFromIpWho() {
  const body = await requestJson(WEATHER_IPWHO_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!body || body.success === false) {
    const err = new Error(body && body.message || 'IPWHO_FAILED');
    err.body = body;
    throw err;
  }
  return normalizeIpWeatherLocation({
    provider: 'ipwho',
    city: body.city,
    region: body.region,
    country: body.country,
    latitude: body.latitude,
    longitude: body.longitude,
    timezone: body.timezone && body.timezone.id ? body.timezone.id : body.timezone,
    ip: body.ip,
  });
}

async function fetchIpWeatherLocationFromIpApiCo() {
  const body = await requestJson(WEATHER_IPAPI_CO_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!body || body.error) {
    const err = new Error(body && body.reason || body && body.error || 'IPAPI_CO_FAILED');
    err.body = body;
    throw err;
  }
  return normalizeIpWeatherLocation({
    provider: 'ipapi-co',
    city: body.city,
    region: body.region,
    country: body.country_name || body.country,
    latitude: body.latitude,
    longitude: body.longitude,
    timezone: body.timezone,
    ip: body.ip,
  });
}

async function fetchIpWeatherLocationFromIpApi() {
  const u = new URL(WEATHER_IP_LOCATION_URL);
  u.searchParams.set('fields', 'status,message,country,regionName,city,lat,lon,timezone,query');
  u.searchParams.set('lang', 'zh-CN');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  if (!body || body.status !== 'success' || !Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lon))) {
    const err = new Error(body && body.message || 'IP_API_FAILED');
    err.body = body;
    throw err;
  }
  return normalizeIpWeatherLocation({
    provider: 'ip-api',
    city: body.city,
    region: body.regionName,
    country: body.country,
    latitude: body.lat,
    longitude: body.lon,
    timezone: body.timezone,
    ip: body.query,
  });
}

async function fetchOpenMeteoWeather(params) {
  params = params || {};
  let location;
  const lat = clampNumber(params.lat, -90, 90, NaN);
  const lon = clampNumber(params.lon, -180, 180, NaN);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const hintCity = String(params.city || params.name || '当前位置').trim() || '当前位置';
    const resolved = await resolveWeatherLocationLabel(lat, lon, hintCity);
    location = {
      name: resolved.name,
      country: resolved.country || '',
      admin1: resolved.admin1 || '',
      latitude: lat,
      longitude: lon,
      timezone: params.timezone || resolved.timezone || 'auto',
      labelProvider: resolved.provider || '',
    };
  } else {
    location = await resolveOpenMeteoLocation(params.city || params.q || params.location);
  }
  const u = new URL(OPEN_METEO_FORECAST_URL);
  u.searchParams.set('latitude', String(location.latitude));
  u.searchParams.set('longitude', String(location.longitude));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m');
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', location.timezone || 'auto');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const cur = body && body.current || {};
  const weather = {
    provider: 'open-meteo',
    location: {
      name: location.name,
      country: location.country || '',
      admin1: location.admin1 || '',
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: body.timezone || location.timezone || '',
      fallback: !!location.fallback,
    },
    label: openMeteoWeatherLabel(cur.weather_code),
    weatherCode: Number(cur.weather_code),
    temperature: Number(cur.temperature_2m),
    apparentTemperature: Number(cur.apparent_temperature),
    humidity: Number(cur.relative_humidity_2m),
    precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
    cloudCover: Number(cur.cloud_cover),
    windSpeed: Number(cur.wind_speed_10m),
    windGusts: Number(cur.wind_gusts_10m),
    isDay: Number(cur.is_day),
    time: cur.time || '',
    updatedAt: Date.now(),
  };
  weather.mood = buildWeatherMood(weather);
  return weather;
}

async function fetchIpWeatherLocation() {
  const providers = [
    fetchIpWeatherLocationFromIpWho,
    fetchIpWeatherLocationFromIpApiCo,
    fetchIpWeatherLocationFromIpApi,
  ];
  let lastErr = null;
  for (const provider of providers) {
    try {
      const loc = await provider();
      if (loc) return loc;
    } catch (e) {
      lastErr = e;
      console.warn('[WeatherIpLocation]', provider.name || 'provider', e.message);
    }
  }
  throw lastErr || new Error('IP_LOCATION_FAILED');
}

const SCENE_PRESETS = {
  focus: {
    key: 'scene-focus',
    title: '专注场景',
    tagline: '低密度节奏，把注意力留给手头的事',
    label: '专注',
    energy: 0.34,
    warmth: 0.42,
    focus: 0.88,
    melancholy: 0.28,
    visualPreset: 0,
    coverGradient: ['#3d5a80', '#1d2d44'],
    moodVisualLink: false,
    hours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
    keywords: ['lofi study', 'ambient piano', 'post rock instrumental', '纯音乐 学习', '轻电子 专注'],
  },
  commute: {
    key: 'scene-commute',
    title: '通勤场景',
    tagline: '节拍清楚，但不抢你的注意力',
    label: '通勤',
    energy: 0.58,
    warmth: 0.52,
    focus: 0.56,
    melancholy: 0.22,
    visualPreset: 4,
    coverGradient: ['#f4a261', '#bc4749'],
    moodVisualLink: true,
    hours: [7, 8, 9, 17, 18, 19],
    keywords: ['早晨 通勤', 'city pop', 'indie pop', '轻快 华语', '公路 歌单'],
  },
  party: {
    key: 'scene-party',
    title: '派对场景',
    tagline: '把能量拉高，让视觉跟着鼓点走',
    label: '派对',
    energy: 0.82,
    warmth: 0.72,
    focus: 0.34,
    melancholy: 0.12,
    visualPreset: 6,
    coverGradient: ['#ff006e', '#8338ec'],
    moodVisualLink: true,
    hours: [20, 21, 22, 23, 0, 1],
    keywords: ['dance pop', 'house 派对', '华语 舞曲', 'edm 热门', 'hip hop party'],
  },
  sleep: {
    key: 'scene-sleep',
    title: '睡前场景',
    tagline: '音量与亮度都收一点，慢慢进入休息',
    label: '睡前',
    energy: 0.22,
    warmth: 0.38,
    focus: 0.76,
    melancholy: 0.48,
    visualPreset: 9,
    coverGradient: ['#4895ef', '#3a0ca3'],
    moodVisualLink: false,
    hours: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    keywords: ['sleep ambient', 'night jazz', 'lofi sleep', '钢琴 晚安', '慢歌 华语'],
  },
  rain: {
    key: 'scene-rain',
    title: '雨夜场景',
    tagline: '潮湿、柔软、适合把房间关小一点',
    label: '雨夜',
    energy: 0.36,
    warmth: 0.40,
    focus: 0.68,
    melancholy: 0.70,
    visualPreset: 9,
    coverGradient: ['#5c677d', '#33415c'],
    moodVisualLink: true,
    hours: [18, 19, 20, 21, 22, 23],
    keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
  },
};

function weatherRadioSeedQueries(mood) {
  const key = String(mood && mood.key || '');
  if (key.includes('rain') || key.includes('storm')) return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁'];
  if (key.includes('snow') || key.includes('cloudy')) return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文'];
  if (key.includes('humid')) return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise'];
  if (key.includes('night')) return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"];
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲'];
}

function fallbackWeatherForRadio(params, err) {
  params = params || {};
  const name = String(params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() || WEATHER_DEFAULT_LOCATION.name;
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    isDay: null,
    time: '',
    updatedAt: Date.now(),
    error: err && err.message || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  };
}

function uniqueSongsByKey(songs) {
  const seen = new Set();
  const out = [];
  (songs || []).forEach(song => {
    const key = String(song && (song.id || song.name + '|' + song.artist) || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function tagWeatherPoolSongs(songs, source) {
  return (songs || []).map(song => ({ ...song, weatherSource: source }));
}

async function fetchWeatherPlaylistSongs(playlist, limit) {
  const id = playlist && playlist.id;
  if (!id) return [];
  let rawTracks = [];
  try {
    if (typeof playlist_track_all === 'function') {
      const all = await playlist_track_all({ id, limit: limit || 36, offset: 0, cookie: userCookie, timestamp: Date.now() });
      rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
    }
  } catch (e) {
    console.warn('[WeatherRadio] playlist_track_all failed:', playlist && playlist.name, e.message);
  }
  if (!rawTracks.length && typeof playlist_detail === 'function') {
    try {
      const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
      const pl = (detail.body && detail.body.playlist) || {};
      rawTracks = pl.tracks || [];
    } catch (e) {
      console.warn('[WeatherRadio] playlist_detail failed:', playlist && playlist.name, e.message);
    }
  }
  return rawTracks.map(mapSongRecord).filter(song => song.id && song.name).slice(0, limit || 36);
}

async function filterLikelyPlayableWeatherSongs(songs) {
  const source = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .slice(0, 24);
  const playable = [];
  const fallback = source.slice(0, 24);
  for (let i = 0; i < source.length; i += 4) {
    const chunk = source.slice(i, i + 4);
    const settled = await Promise.allSettled(chunk.map(async song => {
      const info = await handleSongUrl(song.id, { loggedIn: !!userCookie }, 'standard');
      return info && info.url ? song : null;
    }));
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) playable.push(result.value);
      else if (result.status === 'rejected') console.warn('[WeatherRadio] playable probe failed:', chunk[idx] && chunk[idx].name, result.reason && result.reason.message);
    });
    if (playable.length >= 12) break;
  }
  return (playable.length ? playable : fallback).slice(0, 24);
}

function isLowSignalWeatherSong(song) {
  const text = String([
    song && song.name,
    song && song.artist,
    song && song.album,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (!text) return true;
  if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声)|$|[\s\-_/）)])/i.test(text)) return true;
  if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|demo|beat\s*maker/i.test(text)) return true;
  if (/翻自|翻唱|cover|remix|伴奏|纯音乐|钢琴|dj|live\s*版|live版|唯美钢琴|karaoke|instrumental/i.test(text)) return true;
  if (/白噪音|雨声|睡眠|助眠|冥想|疗愈频率|环境音|自然声音|asmr/i.test(text)) return true;
  if (/[（(](r&b|lofi|jazz|dj|edm|trap|remix|伴奏|纯音乐|钢琴|电子|治愈|古风|女声|男声|英文|中文版|抖音|ai)[）)]/i.test(text)) return true;
  if (/^(纯音乐|轻音乐|治愈系|放松|睡眠|雨天|阴天|夜晚|夏日|海边)$/i.test(String(song.name || '').trim())) return true;
  return false;
}

function scoreWeatherSong(song, mood) {
  const text = String((song && song.name || '') + ' ' + (song && song.artist || '') + ' ' + (song && song.album || '')).toLowerCase();
  let score = 0;
  if (song && song.cover) score += 4;
  if (song && song.duration) score += 2;
  if (song && song.weatherSource === 'daily') score += 6;
  if (song && song.weatherSource === 'private') score += 4;
  if (/周杰伦|陈奕迅|孙燕姿|五月天|王菲|陶喆|方大同|林宥嘉|蔡健雅|莫文蔚|李健|毛不易|告五人|落日飞车|陈绮贞|朴树/.test(text)) score += 10;
  const key = String(mood && mood.key || '');
  if (key.includes('rain') && /雨|阴|夜|慢|r&b|soul|陈奕迅|林宥嘉|孙燕姿/.test(text)) score += 5;
  if (key.includes('humid') && /夏|海|city|pop|落日|告五人|方大同|陶喆/.test(text)) score += 5;
  if (key.includes('night') && /夜|moon|jazz|soul|r&b|方大同|陶喆|王菲/.test(text)) score += 5;
  if (key.includes('cloudy') && /阴|民谣|indie|陈绮贞|朴树|李健/.test(text)) score += 5;
  return score;
}

function weatherArtistKey(song) {
  const raw = String(song && song.artist || song && song.name || '').split(/\s*\/\s*|、|,|&/)[0] || '';
  return raw.trim().toLowerCase() || 'unknown';
}

function weatherTitleKey(song) {
  return String(song && song.name || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '')
    .trim();
}

function uniqueWeatherTitles(sorted) {
  const seen = new Set();
  const out = [];
  (sorted || []).forEach(song => {
    const key = weatherTitleKey(song);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(song);
  });
  return out;
}

function diversifyWeatherSongs(sorted, artistLimit) {
  const primary = [];
  const deferred = [];
  const counts = new Map();
  (sorted || []).forEach(song => {
    const key = weatherArtistKey(song);
    const count = counts.get(key) || 0;
    if (count < artistLimit) {
      primary.push(song);
      counts.set(key, count + 1);
    } else {
      deferred.push(song);
    }
  });
  return primary.length >= 8 ? primary : primary.concat(deferred.slice(0, 8 - primary.length));
}

function orderWeatherSongs(songs, mood) {
  const sorted = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .sort((a, b) => scoreWeatherSong(b, mood) - scoreWeatherSong(a, mood));
  return diversifyWeatherSongs(uniqueWeatherTitles(sorted), 2);
}

async function buildRadioFromMood(mood, seedQueries, weatherShell) {
  const queries = (Array.isArray(seedQueries) && seedQueries.length ? seedQueries : weatherRadioSeedQueries(mood)).slice(0, 5);
  let songs = [];
  const settled = await Promise.allSettled(queries.slice(0, 4).map(q => handleSearch(q, 6)));
  settled.forEach(result => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
  });
  if (songs.length < 10 && mood && Array.isArray(mood.keywords)) {
    const more = await Promise.allSettled(mood.keywords.slice(0, 2).map(q => handleSearch(q, 6)));
    more.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
    });
  }
  songs = orderWeatherSongs(songs, mood);
  const weather = weatherShell || {
    provider: 'open-meteo',
    label: mood.title,
    temperature: null,
    mood,
    updatedAt: Date.now(),
  };
  if (!weather.mood) weather.mood = mood;
  return {
    ok: true,
    weather,
    radio: {
      title: mood.title,
      subtitle: mood.tagline,
      seedQueries: queries.slice(0, 4),
      songs: songs.slice(0, 18),
      sceneKey: mood.key || '',
      updatedAt: Date.now(),
    },
  };
}

async function buildSceneRadio(sceneKey) {
  const id = String(sceneKey || '').toLowerCase();
  const preset = SCENE_PRESETS[id] || SCENE_PRESETS.focus;
  const mood = Object.assign({}, preset, { keywords: preset.keywords.slice() });
  const payload = await buildRadioFromMood(mood, mood.keywords.slice(0, 4), {
    provider: 'scene',
    label: mood.title,
    temperature: null,
    mood,
    updatedAt: Date.now(),
  });
  if (payload && payload.radio) {
    payload.radio.sceneId = id in SCENE_PRESETS ? id : 'focus';
    payload.radio.visualPreset = preset.visualPreset;
    payload.radio.coverGradient = preset.coverGradient.slice();
    payload.radio.moodVisualLink = preset.moodVisualLink !== false;
  }
  return payload;
}

async function buildWeatherRadio(params) {
  let weather;
  try {
    weather = await fetchOpenMeteoWeather(params);
  } catch (e) {
    console.warn('[WeatherRadio] weather provider failed, using fallback radio:', e.message);
    weather = fallbackWeatherForRadio(params, e);
  }
  const queries = weatherRadioSeedQueries(weather.mood);
  return buildRadioFromMood(weather.mood, queries, weather);
}

function parseJSONText(text) {
  const raw = String(text || '').trim();
  const json = raw.replace(/^callback\(([\s\S]*)\);?$/, '$1');
  return JSON.parse(json);
}

async function qqMusicRequest(payload, opts) {
  opts = opts || {};
  const body = JSON.stringify(payload);
  const headers = {
    ...QQ_HEADERS,
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (opts.cookie && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(QQ_MUSICU_URL, {
    method: 'POST',
    headers,
  }, body);
  return parseJSONText(text);
}

function normalizeQQProfile(body, cookieObj) {
  cookieObj = cookieObj || qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {};
  const profileNick = creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '';
  const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
  const cookieNick = qqCookieNickname(cookieObj, uin);
  const nick = profileNick || cookieNick || '';
  const avatar = profileAvatar || qqCookieAvatar(cookieObj, uin);
  let vipType = Number(
    cookieObj.vipType || cookieObj.vip_type ||
    data.vipType || data.vip_type || data.viptype || data.music_vip_level || data.green_vip_level || data.luxury_vip_level ||
    creator.vipType || creator.vip_type || creator.music_vip_level || creator.green_vip_level || creator.luxury_vip_level ||
    vipInfo.vipType || vipInfo.vip_type || vipInfo.music_vip_level || vipInfo.green_vip_level || vipInfo.luxury_vip_level || 0
  ) || 0;
  if (!vipType) {
    const vipFlag = data.isVip || data.is_vip || data.vipFlag || data.vipflag || creator.isVip || creator.is_vip || vipInfo.isVip || vipInfo.is_vip || vipInfo.vipFlag;
    if (vipFlag === true || Number(vipFlag) > 0 || String(vipFlag || '').toLowerCase() === 'true') vipType = 1;
  }
  const isSvip = !!(
    vipType >= 10 ||
    data.isSvip || data.is_svip || creator.isSvip || creator.is_svip || vipInfo.isSvip || vipInfo.is_svip ||
    Number(vipInfo.iSuperVip || vipInfo.super_vip || vipInfo.luxury_vip_level || 0) > 0
  );
  const isVip = isSvip || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieObj)),
    preview: false,
    userId: uin,
    nickname: nick || (uin ? ('QQ ' + uin) : 'QQ 音乐'),
    avatar,
    vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'QQ SVIP' : (vipLevel === 'vip' ? 'QQ VIP' : '无VIP'),
    hasCookie: !!qqCookie,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieObj),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
  };
}

async function getQQLoginInfo() {
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const musicKey = qqCookieMusicKey(cookieObj);
  if (!uin || !musicKey) return { provider: 'qq', loggedIn: false, hasCookie: !!qqCookie };
  const fallback = normalizeQQProfile(null, cookieObj);
  try {
    const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
    u.searchParams.set('cid', '205360838');
    u.searchParams.set('userid', uin);
    u.searchParams.set('reqfrom', '1');
    u.searchParams.set('g_tk', '5381');
    u.searchParams.set('loginUin', uin);
    u.searchParams.set('hostUin', '0');
    u.searchParams.set('format', 'json');
    u.searchParams.set('inCharset', 'utf8');
    u.searchParams.set('outCharset', 'utf-8');
    u.searchParams.set('notice', '0');
    u.searchParams.set('platform', 'yqq.json');
    u.searchParams.set('needNewCode', '0');
    const text = await requestText(u.toString(), {
      headers: { ...QQ_HEADERS, Cookie: qqCookie },
    });
    const body = parseJSONText(text);
    const info = normalizeQQProfile(body, cookieObj);
    if (body && (body.code === 1000 || body.result === 301)) {
      return { ...fallback, profileUnavailable: true };
    }
    return info;
  } catch (e) {
    console.warn('[QQLogin] profile check failed:', e.message);
    return { ...fallback, profileUnavailable: true };
  }
}

async function qqGetJSON(targetUrl, params, opts) {
  opts = opts || {};
  const u = new URL(targetUrl);
  Object.keys(params || {}).forEach(k => {
    if (params[k] != null) u.searchParams.set(k, String(params[k]));
  });
  const headers = { ...QQ_HEADERS, ...(opts.headers || {}) };
  if (opts.cookie !== false && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(u.toString(), { headers });
  return parseJSONText(text);
}

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
  'douyin.com',
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

async function fetchProxiedMedia(mediaUrl, headers) {
  return fetchWithTimeout(mediaUrl, { headers: headers || {} }, PROXY_FETCH_TIMEOUT_MS);
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
  return token && token === API_TOKEN;
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
      host.includes('toutiao.com')
    ) headers.Referer = 'https://music.qishui.com/';
  } catch (e) {}
  if (range) headers.Range = range;
  return headers;
}

function audioContentTypeForUrl(audioUrl, upstreamType) {
  let pathname = '';
  try { pathname = new URL(audioUrl).pathname.toLowerCase(); } catch (e) {}
  if (/\.flac$/.test(pathname)) return 'audio/flac';
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg';
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4';
  if (/\.ogg$/.test(pathname)) return 'audio/ogg';
  if (/\.wav$/.test(pathname)) return 'audio/wav';
  return upstreamType || 'audio/mpeg';
}

function qishuiAudioAuthFromUrl(audioUrl) {
  const text = String(audioUrl || '');
  const idx = text.indexOf('#auth=');
  if (idx < 0) return { cleanUrl: text, auth: '' };
  const authRaw = text.slice(idx + 6);
  let auth = authRaw;
  try { auth = decodeURIComponent(authRaw); } catch (_) {}
  return { cleanUrl: text.slice(0, idx), auth };
}

function qishuiAudioCacheKey(cleanUrl, auth) {
  return crypto.createHash('sha1').update(String(cleanUrl || '') + '\n' + String(auth || '')).digest('hex');
}

function rememberQishuiDecryptedAudio(key, payload) {
  if (!payload || !Buffer.isBuffer(payload.buffer)) return;
  qishuiAudioDecryptCache.set(key, Object.assign({ at: Date.now() }, payload));
  qishuiAudioDecryptCacheBytes += payload.buffer.length;
  while (qishuiAudioDecryptCacheBytes > QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES && qishuiAudioDecryptCache.size > 1) {
    const oldest = [...qishuiAudioDecryptCache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0];
    if (!oldest) break;
    qishuiAudioDecryptCache.delete(oldest[0]);
    qishuiAudioDecryptCacheBytes -= oldest[1].buffer.length;
  }
}

async function getQishuiDecryptedAudio(audioUrl) {
  const parsed = qishuiAudioAuthFromUrl(audioUrl);
  if (!parsed.auth) return null;
  const key = qishuiAudioCacheKey(parsed.cleanUrl, parsed.auth);
  const cached = qishuiAudioDecryptCache.get(key);
  if (cached) {
    cached.at = Date.now();
    return cached;
  }
  const up = await fetchProxiedMedia(parsed.cleanUrl, audioProxyHeadersFor(parsed.cleanUrl, ''));
  if (!up.ok) throw new Error('Qishui encrypted audio fetch failed: HTTP ' + up.status);
  const encryptedBuffer = Buffer.from(await up.arrayBuffer());
  const result = qishuiAudioDecryptor.decrypt({ encryptedBuffer, spadeA: parsed.auth });
  const payload = {
    buffer: result.buffer,
    contentType: result.extension === '.flac' ? 'audio/flac' : 'audio/mp4',
    extension: result.extension,
  };
  rememberQishuiDecryptedAudio(key, payload);
  return payload;
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

function mapQQPlaylist(pl, kind) {
  pl = pl || {};
  const id = pl.dissid || pl.tid || pl.dirid || pl.id || pl.diss_id;
  return {
    provider: 'qq',
    source: 'qq',
    id: id ? String(id) : '',
    name: pl.diss_name || pl.name || pl.title || '',
    cover: pl.diss_cover || pl.logo || pl.picurl || pl.cover || '',
    trackCount: pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count || 0,
    playCount: pl.listen_num || pl.visitnum || pl.play_count || 0,
    creator: pl.hostname || pl.nick || pl.creator || 'QQ 音乐',
    subscribed: kind === 'collect',
    specialType: 0,
  };
}

function mapQQPlaylistTrack(raw) {
  raw = raw || {};
  const track = raw.songid || raw.songmid || raw.mid || raw.name ? raw : (raw.track_info || raw.songInfo || raw.songinfo || raw.song || {});
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || track.singers || []);
  const mid = track.mid || track.songmid || raw.mid || raw.songmid || '';
  const albumMid = album.mid || track.albummid || raw.albummid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid || String(track.id || track.songid || raw.id || raw.songid || ''),
    qqId: track.id || track.songid || raw.id || raw.songid || '',
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || raw.strMediaMid || '',
    name: track.name || track.songname || raw.songname || '',
    artist: artists.map(a => a.name).join(' / ') || track.singername || raw.singername || '',
    artists,
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || track.albumname || raw.albumname || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300),
    duration: (Number(track.interval || raw.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  };
}

async function handleQQUserPlaylists() {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] };
  const uin = info.userId;
  const createdReq = qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
    hostUin: 0,
    hostuin: uin,
    sin: 0,
    size: 200,
    g_tk: 5381,
    loginUin: uin,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
  const collectReq = qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
    ct: 20,
    cid: 205360956,
    userid: uin,
    reqtype: 3,
    sin: 0,
    ein: 80,
  }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
  const [createdRaw, collectRaw] = await Promise.allSettled([createdReq, collectReq]);
  const created = createdRaw.status === 'fulfilled' && createdRaw.value && createdRaw.value.data && Array.isArray(createdRaw.value.data.disslist)
    ? createdRaw.value.data.disslist.map(pl => mapQQPlaylist(pl, 'created')) : [];
  const collected = collectRaw.status === 'fulfilled' && collectRaw.value && collectRaw.value.data && Array.isArray(collectRaw.value.data.cdlist)
    ? collectRaw.value.data.cdlist.map(pl => mapQQPlaylist(pl, 'collect')) : [];
  const seen = new Set();
  const playlists = created.concat(collected).filter(pl => {
    if (!pl.id || !pl.name || seen.has(pl.id)) return false;
    if (isQzoneBackgroundPlaylist(pl)) return false;
    seen.add(pl.id);
    return true;
  }).sort((a, b) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)));
  return { loggedIn: true, provider: 'qq', userId: uin, playlists };
}

async function handleQQPlaylistTracks(id) {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] };
  const result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    utf8: 1,
    disstid: pid,
    loginUin: info.userId,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } });
  const detail = result && result.cdlist && result.cdlist[0] ? result.cdlist[0] : {};
  const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter(s => s.name && (s.mid || s.id));
  const playlist = {
    provider: 'qq',
    id: pid,
    name: detail.dissname || detail.diss_name || detail.name || '',
    cover: detail.logo || detail.diss_cover || '',
    trackCount: tracks.length,
  };
  return { loggedIn: true, provider: 'qq', playlist, tracks };
}

function kugouMd5(text) {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

function kugouSigVal(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function kugouAndroidSignature(params, dataString) {
  const body = Object.keys(params || {})
    .sort()
    .map(k => k + '=' + kugouSigVal(params[k]))
    .join('');
  return kugouMd5(KUGOU_ANDROID_SIGN_KEY + body + (dataString || '') + KUGOU_ANDROID_SIGN_KEY);
}

function kugouWebSignature(params) {
  const body = Object.keys(params || {})
    .sort()
    .map(k => k + '=' + (params[k] == null ? '' : params[k]))
    .join('');
  return kugouMd5(KUGOU_WEB_SIGN_KEY + body + KUGOU_WEB_SIGN_KEY);
}

function kugouRandomString(length, lower) {
  const chars = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < (length || 16); i++) out += chars[Math.floor(Math.random() * chars.length)];
  return lower ? out.toLowerCase() : out;
}

function kugouCalculateMid(seed) {
  const hex = crypto.createHash('md5').update(String(seed || '')).digest('hex');
  try {
    return BigInt('0x' + hex).toString(10);
  } catch (_) {
    return KUGOU_DEFAULT_MID;
  }
}

function kugouInitDevice(obj) {
  obj = Object.assign({}, obj || {});
  const guid = obj.KUGOU_API_GUID || crypto.randomUUID();
  obj.KUGOU_API_GUID = guid;
  obj.KUGOU_API_MID = obj.KUGOU_API_MID || kugouCalculateMid(guid);
  obj.KUGOU_API_MAC = obj.KUGOU_API_MAC || kugouRandomString(12);
  obj.KUGOU_API_DEV = obj.KUGOU_API_DEV || kugouRandomString(16);
  return obj;
}

function saveKugouAuth(obj) {
  const auth = kugouInitDevice(obj || {});
  kugouVipProbeCache = { userId: '', checkedAt: 0, info: null };
  saveKugouCookie(serializeCookieObject(auth));
  return auth;
}

function kugouCookieMid(obj) {
  obj = obj || kugouCookieObject();
  return obj.KUGOU_API_MID || obj.mid || obj.kg_mid || obj.KG_MID || KUGOU_DEFAULT_MID;
}

function kugouCookieDfid(obj) {
  obj = obj || kugouCookieObject();
  return obj.dfid || obj.DFID || '-';
}

function kugouCookieHeader() {
  const obj = kugouCookieObject();
  const allow = [
    'userid',
    'user_id',
    'uid',
    'token',
    'user_token',
    'access_token',
    'KugooID',
    'KuGoo',
    'dfid',
    'DFID',
    'mid',
    'kg_mid',
    'KG_MID',
    'KUGOU_API_MID',
    'KUGOU_API_GUID',
    'KUGOU_API_MAC',
    'KUGOU_API_DEV',
  ];
  return allow
    .filter(key => obj[key] != null && String(obj[key]) !== '')
    .map(key => key + '=' + encodeURIComponent(String(obj[key])))
    .join('; ');
}

function kugouCloudlistCookieHeader(obj) {
  obj = obj || kugouCookieObject();
  const pairs = [
    ['userid', kugouCookieUserId(obj)],
    ['token', kugouCookieToken(obj)],
    ['KUGOU_API_MID', kugouCookieMid(obj)],
  ];
  return pairs
    .filter(([, value]) => value != null && String(value) !== '')
    .map(([key, value]) => key + '=' + encodeURIComponent(String(value)))
    .join('; ');
}

async function kugouGatewayRequest(pathname, options) {
  options = options || {};
  const obj = kugouCookieObject();
  const clienttime = String(Math.floor(Date.now() / 1000));
  const params = Object.assign({
    dfid: kugouCookieDfid(obj),
    mid: kugouCookieMid(obj),
    uuid: '-',
    appid: KUGOU_APPID,
    clientver: KUGOU_CLIENTVER,
    clienttime,
  }, options.params || {});
  const token = kugouCookieToken(obj);
  const userId = kugouCookieUserId(obj);
  if (token && !params.token) params.token = token;
  if (userId && userId !== '0' && !params.userid) params.userid = userId;

  const method = String(options.method || 'GET').toUpperCase();
  const hasBody = options.data !== undefined && options.data !== null;
  const dataString = hasBody ? (typeof options.data === 'string' ? options.data : JSON.stringify(options.data)) : '';
  const signType = options.encryptType === 'web' ? 'web' : 'android';
  if (!options.notSignature && !params.signature) {
    params.signature = signType === 'web' ? kugouWebSignature(params) : kugouAndroidSignature(params, dataString);
  }

  const u = new URL(pathname, options.baseURL || KUGOU_GATEWAY_URL);
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) u.searchParams.set(k, String(params[k]));
  });
  const cookie = kugouCookieHeader();
  const headers = Object.assign({
    'User-Agent': KUGOU_ANDROID_UA,
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    dfid: kugouCookieDfid(obj),
    mid: kugouCookieMid(obj),
    clienttime,
  }, options.headers || {});
  if (cookie) headers.Cookie = cookie;
  if (hasBody && typeof options.data !== 'string') headers['Content-Type'] = 'application/json';
  if (options.responseType === 'buffer') {
    return requestBuffer(u.toString(), { method, headers }, hasBody ? dataString : null);
  }
  const text = await requestText(u.toString(), { method, headers }, hasBody ? dataString : null);
  return parseJSONText(text);
}

async function kugouCloudlistRequest(pathname, params, data) {
  const obj = kugouCookieObject();
  const clienttime = String(Math.floor(Date.now() / 1000));
  const token = kugouCookieToken(obj);
  const userId = kugouCookieUserId(obj);
  const finalParams = Object.assign({
    dfid: kugouCookieDfid(obj),
    mid: kugouCookieMid(obj),
    uuid: '-',
    appid: KUGOU_APPID,
    clientver: KUGOU_CLIENTVER,
    clienttime,
    userid: userId,
    token,
  }, params || {});
  const dataString = data ? JSON.stringify(data) : '';
  finalParams.signature = kugouAndroidSignature(finalParams, dataString);
  const u = new URL(pathname, KUGOU_GATEWAY_URL);
  Object.keys(finalParams).forEach(k => {
    if (finalParams[k] !== undefined && finalParams[k] !== null) u.searchParams.set(k, String(finalParams[k]));
  });
  const headers = {
    'User-Agent': KUGOU_ANDROID_UA,
    'x-router': 'cloudlist.service.kugou.com',
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    dfid: kugouCookieDfid(obj),
    mid: kugouCookieMid(obj),
    clienttime,
    'Content-Type': 'application/json',
    Cookie: 'userid=' + encodeURIComponent(String(userId || '')) +
      '; token=' + encodeURIComponent(String(token || '')) +
      '; KUGOU_API_MID=' + encodeURIComponent(String(kugouCookieMid(obj) || '')),
  };
  const text = await requestText(u.toString(), { method: dataString ? 'POST' : 'GET', headers }, dataString);
  return parseJSONText(text);
}

function kugouSafeGet(obj, pathKeys, fallback) {
  let cur = obj;
  for (const key of pathKeys || []) {
    if (!cur || typeof cur !== 'object' || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return cur == null ? fallback : cur;
}

function kugouDeepFind(obj, names) {
  const wanted = new Set((names || []).map(name => String(name).toLowerCase()));
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (wanted.has(String(key).toLowerCase()) && value[key] != null && String(value[key]) !== '') {
        return value[key];
      }
    }
    for (const key of Object.keys(value)) {
      const found = walk(value[key]);
      if (found != null && String(found) !== '') return found;
    }
    return '';
  }
  return walk(obj);
}

async function handleKugouLoginQrKey() {
  const device = saveKugouAuth(kugouCookieObject());
  const qrcodeText = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=' + KUGOU_APPID + '&';
  const data = await kugouGatewayRequest('/v2/qrcode', {
    baseURL: KUGOU_LOGIN_BASE_URL,
    encryptType: 'web',
    params: {
      appid: KUGOU_QR_APPID,
      type: 1,
      plat: 4,
      qrcode_txt: qrcodeText,
      srcappid: KUGOU_QR_SRC_APPID,
    },
    headers: {
      'User-Agent': UA,
      'x-router': 'login-user.kugou.com',
    },
  });
  const key = kugouSafeGet(data, ['data', 'qrcode'], '') || data.qrcode || data.key || '';
  if (!key) {
    const err = new Error((data && (data.error_msg || data.message || data.msg)) || 'KUGOU_QR_KEY_FAILED');
    err.body = data;
    throw err;
  }
  const loginUrl = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + encodeURIComponent(key);
  const img = await QRCode.toDataURL(loginUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
  return {
    provider: 'kugou',
    key,
    qrcode: key,
    url: loginUrl,
    img,
    deviceId: device.KUGOU_API_GUID,
  };
}

async function kugouRegisterDevice(auth) {
  auth = kugouInitDevice(auth || kugouCookieObject());
  const dataMap = {
    availableRamSize: 4983533568,
    availableRomSize: 48114719,
    availableSDSize: 48114717,
    basebandVer: '',
    batteryLevel: 100,
    batteryStatus: 3,
    brand: 'Redmi',
    buildSerial: 'unknown',
    device: 'marble',
    imei: auth.KUGOU_API_GUID,
    imsi: '',
    manufacturer: 'Xiaomi',
    uuid: auth.KUGOU_API_GUID,
    accelerometerValue: '',
    gravity: false,
    gravityValue: '',
    gyroscope: false,
    gyroscopeValue: '',
    light: false,
    lightValue: '',
    magnetic: false,
    magneticValue: '',
    orientation: false,
    orientationValue: '',
    pressure: false,
    pressureValue: '',
    step_counter: false,
    step_counterValue: '',
    temperature: false,
    temperatureValue: '',
    accelerometer: false,
  };
  const aesKey = kugouRandomString(6, true);
  const digest = kugouMd5(aesKey);
  const key = Buffer.from(digest.slice(0, 16), 'utf8');
  const iv = Buffer.from(digest.slice(16, 32), 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(dataMap), 'utf8'), cipher.final()]).toString('base64');
  const pRaw = JSON.stringify({ aes: aesKey, uid: auth.userid || 0, token: auth.token || '' });
  const p = crypto.publicEncrypt({
    key: KUGOU_RSA_PUBLIC_KEY,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  }, Buffer.from(pRaw)).toString('hex');
  const buf = await kugouGatewayRequest('/risk/v2/r_register_dev', {
    baseURL: KUGOU_USER_SERVICE_URL,
    method: 'POST',
    encryptType: 'android',
    responseType: 'buffer',
    params: { part: 1, platid: 1, p },
    data: encrypted,
    headers: { 'x-router': 'userservice.kugou.com' },
  });
  let result = null;
  const plain = buf.toString('utf8');
  try {
    result = plain.trim().startsWith('{') ? JSON.parse(plain) : null;
  } catch (_) {
    result = null;
  }
  if (!result) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(buf), decipher.final()]).toString('utf8');
    result = JSON.parse(decrypted);
  }
  const dfid = kugouSafeGet(result, ['data', 'dfid'], '');
  if (dfid) auth.dfid = dfid;
  return result;
}

async function handleKugouLoginQrCheck(key) {
  const qr = String(key || '').trim();
  if (!qr) return { provider: 'kugou', code: 800, status: 0, message: 'Missing Kugou QR key' };
  const data = await kugouGatewayRequest('/v2/get_userinfo_qrcode', {
    baseURL: KUGOU_LOGIN_BASE_URL,
    encryptType: 'web',
    params: {
      plat: 4,
      appid: KUGOU_APPID,
      srcappid: KUGOU_QR_SRC_APPID,
      qrcode: qr,
    },
    headers: {
      'User-Agent': UA,
      'x-router': 'login-user.kugou.com',
    },
  });
  const status = Number(kugouSafeGet(data, ['data', 'status'], data.status || kugouDeepFind(data, ['status']) || 0)) || 0;
  const token = String(kugouSafeGet(data, ['data', 'token'], '') ||
    kugouDeepFind(data, ['token', 'user_token', 'access_token', 'key']) ||
    data.token || '').trim();
  const userId = String(kugouSafeGet(data, ['data', 'userid'], '') ||
    kugouDeepFind(data, ['userid', 'user_id', 'uid', 'kugooid', 'kugouid']) ||
    data.userid || '').replace(/\D/g, '');
  const nickname = String(kugouSafeGet(data, ['data', 'nickname'], '') ||
    kugouSafeGet(data, ['data', 'username'], '') ||
    kugouDeepFind(data, ['nickname', 'nick', 'username', 'user_name', 'uname']) ||
    '').trim();
  const avatar = String(kugouSafeGet(data, ['data', 'pic'], '') ||
    kugouSafeGet(data, ['data', 'avatar'], '') ||
    kugouSafeGet(data, ['data', 'img'], '') ||
    kugouSafeGet(data, ['data', 'user_pic'], '') ||
    kugouDeepFind(data, ['avatar', 'pic', 'img', 'icon', 'headpic', 'head_img', 'headimg', 'user_pic', 'userpic']) ||
    data.pic || data.avatar || data.img || '').trim();
  const vipType = Number(kugouSafeGet(data, ['data', 'vip_type'], 0) ||
    kugouSafeGet(data, ['data', 'vipType'], 0) ||
    kugouSafeGet(data, ['data', 'viptype'], 0) ||
    kugouDeepFind(data, ['vip_type', 'vipType', 'viptype', 'isvip', 'is_vip', 'vip']) ||
    data.vip_type || data.vipType || data.viptype || 0) || 0;
  if (!(token && userId)) {
    if (status !== 4) {
      const code = status === 2 ? 802 : (status === 3 ? 800 : 801);
      return { provider: 'kugou', loggedIn: false, code, status, rawStatus: status, message: data && (data.message || data.msg || data.error_msg) || '' };
    }
  }
  if (!token || !userId) {
    return { provider: 'kugou', loggedIn: false, code: 803, status, error: 'KUGOU_TOKEN_MISSING', message: 'Kugou login confirmed but token was not returned' };
  }
  const auth = saveKugouAuth(Object.assign({}, kugouCookieObject(), {
    token,
    userid: userId,
    nickname,
    avatar,
    vipType,
  }));
  try {
    await kugouRegisterDevice(auth);
    saveKugouAuth(auth);
  } catch (e) {
    console.warn('[KugouRegisterDevice]', e.message);
  }
  return Object.assign({}, await getKugouLoginInfoFresh(), {
    code: 803,
    status,
    saved: true,
    rawStatus: status,
  });
}

function asArrayDeep(value, keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === 'object') {
      const found = asArrayDeep(value[key], keys);
      if (found.length) return found;
    }
  }
  return [];
}

function mapKugouPlaylist(raw) {
  raw = raw || {};
  const id = raw.listid || raw.list_id || raw.global_collection_id || raw.specialid || raw.id || raw.mixsongid || '';
  const name = raw.name || raw.listname || raw.list_name || raw.specialname || raw.title || raw.collection_name || '';
  const cover = raw.pic || raw.img || raw.cover || raw.sizable_cover || raw.list_pic || raw.avatar || '';
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'kugou',
    id: String(id || ''),
    name: String(name || '酷狗歌单'),
    cover: String(cover || '').replace(/\{size\}/g, '240'),
    trackCount: Number(raw.count || raw.song_count || raw.total || raw.file_count || raw.songcount || 0) || 0,
    creator: raw.username || raw.nickname || raw.user_name || '酷狗音乐',
  };
}

function cleanKugouTrackText(value) {
  return String(value || '')
    .replace(/\.(mp3|flac|m4a|aac|ogg|wav)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSimpleTitleForCompare(value) {
  return cleanKugouTrackText(value).toLowerCase().replace(/\s+/g, '');
}

function mapKugouTrack(raw) {
  raw = raw || {};
  const trans = raw.trans_param || raw.transParam || {};
  const hash = raw.hash || raw.Hash || raw.file_hash || raw.FileHash || raw.audio_hash ||
    raw['320hash'] || raw['128hash'] || raw.sqhash || raw.SQFileHash || raw.HQFileHash ||
    trans.ogg_320_hash || trans.ogg_128_hash || '';
  const qualityHashes = {
    standard: raw['128hash'] || raw.hash || raw.Hash || raw.file_hash || trans.ogg_128_hash || '',
    exhigh: raw['320hash'] || raw.HQFileHash || trans.ogg_320_hash || raw.hash || raw.Hash || raw.file_hash || '',
    lossless: raw.sqhash || raw.SQFileHash || raw.flac_hash || raw.hash || raw.Hash || raw.file_hash || '',
    hires: raw.hrhash || raw.high_hash || raw.sqhash || raw.SQFileHash || raw.hash || raw.Hash || raw.file_hash || '',
    jymaster: raw.masterhash || raw.jymaster_hash || raw.hrhash || raw.sqhash || raw.SQFileHash || raw.hash || raw.Hash || raw.file_hash || '',
  };
  const albumAudioId = raw.album_audio_id || raw.albumAudioId || raw.audio_id || raw.audioid || raw.Audioid || raw.mixsongid || raw.songid || raw.id || '';
  const filename = cleanKugouTrackText(raw.filename || raw.FileName || '');
  let name = cleanKugouTrackText(raw.songname || raw.song_name || raw.name || raw.title || '');
  let artist = cleanKugouTrackText(raw.singername || raw.singer_name || raw.author_name || raw.singer || raw.artist || '');
  if (!artist && Array.isArray(raw.singerinfo) && raw.singerinfo[0]) {
    artist = raw.singerinfo.map(item => item && cleanKugouTrackText(item.name)).filter(Boolean).join(' / ');
  }
  if (filename) {
    const parts = String(filename).split(' - ');
    if (parts.length >= 2) {
      const filenameArtist = cleanKugouTrackText(parts.shift());
      const titleFromFilename = cleanKugouTrackText(parts.join(' - '));
      artist = artist || filenameArtist;
      if (!name || normalizeSimpleTitleForCompare(name) === normalizeSimpleTitleForCompare(filename)) name = titleFromFilename;
    } else {
      name = name || filename;
    }
  }
  if (name && artist && String(name).includes(' - ')) {
    const parts = String(name).split(' - ');
    const maybeArtist = cleanKugouTrackText(parts.shift());
    const maybeTitle = cleanKugouTrackText(parts.join(' - '));
    if (maybeTitle && normalizeSimpleTitleForCompare(maybeArtist) === normalizeSimpleTitleForCompare(artist)) {
      name = maybeTitle;
    }
  }
  const albumInfo = raw.albuminfo || raw.albumInfo || {};
  const album = raw.album_name || raw.albumname || raw.album || albumInfo.name || '';
  const albumId = raw.album_id || raw.albumid || raw.AlbumID || raw.albumId || '';
  const cover = raw.pic || raw.img || raw.image || raw.cover || raw.sizable_cover || trans.union_cover || '';
  const durationMs = Number(raw.timelength || raw.time_length || raw.timelen || raw.duration || raw.interval) || 0;
  const fsort = Number(raw.fsort || raw.sort || raw.position || raw.pos || 0) || 0;
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'kugou',
    id: String(hash || albumAudioId || name),
    hash: String(hash || ''),
    qualityHashes,
    albumAudioId: String(albumAudioId || ''),
    albumId: String(albumId || ''),
    name: cleanKugouTrackText(name).replace(/\s*-\s*$/, ''),
    artist: String(artist || ''),
    artists: artist ? [{ name: String(artist) }] : [],
    album: String(album || ''),
    cover: String(cover || '').replace(/\{size\}/g, '300'),
    duration: durationMs * (durationMs > 1000 ? 1 : 1000),
    fee: Number(raw.privilege || raw.media_privilege || raw.media_pay_type || raw.pay_type || 0) || 0,
    fsort,
    position: fsort,
    sort: fsort,
    playable: !!hash,
  };
}

function kugouHashForQuality(hash, qualityPreference, qualityHashes) {
  const requested = normalizeQualityPreference(qualityPreference);
  const hashes = qualityHashes && typeof qualityHashes === 'object' ? qualityHashes : {};
  const orderMap = {
    jymaster: ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'],
    hires: ['hires', 'lossless', 'exhigh', 'standard'],
    lossless: ['lossless', 'exhigh', 'standard'],
    exhigh: ['exhigh', 'standard'],
    standard: ['standard'],
  };
  const order = orderMap[requested] || orderMap.hires;
  for (const key of order) {
    const candidate = String(hashes[key] || '').trim();
    if (candidate) return { hash: candidate, level: key };
  }
  return { hash: String(hash || '').trim(), level: requested };
}

function sortKugouCloudTracks(rawTracks) {
  return (rawTracks || []).slice().sort((a, b) => {
    const af = Number(a && (a.fsort || a.sort || a.position || a.pos || 0)) || 0;
    const bf = Number(b && (b.fsort || b.sort || b.position || b.pos || 0)) || 0;
    if (af || bf) return af - bf;
    const ac = Number(a && (a.collecttime || a.collect_time || 0)) || 0;
    const bc = Number(b && (b.collecttime || b.collect_time || 0)) || 0;
    return ac - bc;
  });
}

async function handleKugouUserPlaylists() {
  const info = await getKugouLoginInfoFresh();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'kugou', playlists: [] };
  const data = await kugouGatewayRequest('/v7/get_all_list', {
    method: 'POST',
    params: {
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 200,
      userid: info.userId,
      token: kugouCookieToken(),
    },
    data: {
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 200,
      userid: Number(info.userId) || info.userId,
      token: kugouCookieToken(),
    },
    headers: { 'x-router': 'cloudlist.service.kugou.com' },
  });
  const rawLists = asArrayDeep(data, ['lists', 'list', 'info', 'data', 'listinfo', 'collection_list', 'playlist']);
  const seen = new Set();
  const playlists = rawLists.map(mapKugouPlaylist).filter(pl => {
    if (!pl.id || seen.has(pl.id)) return false;
    seen.add(pl.id);
    return true;
  });
  return { ...info, loggedIn: true, provider: 'kugou', userId: info.userId, playlists, rawStatus: data && (data.status || data.errcode || data.error_code) };
}

async function handleKugouPlaylistTracks(id) {
  const info = getKugouLoginInfo();
  if (!info.loggedIn) return { loggedIn: false, provider: 'kugou', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'kugou', error: 'Missing Kugou playlist id', tracks: [] };
  let detail = null;
  let rawTracks = [];
  try {
    const pageSize = 200;
    let page = 1;
    let total = 0;
    do {
      detail = await kugouCloudlistRequest('/v4/get_list_all_file',
        { listid: pid, page, pagesize: pageSize },
        { listid: pid, page, pagesize: pageSize, area_code: 1, show_relate_goods: 0, allplatform: 1, show_cover: 1, type: 0, userid: Number(info.userId) || info.userId, token: kugouCookieToken() });
      if (!detail || Number(detail.status) === 0 || Number(detail.error_code || detail.errcode) > 0) {
        throw new Error('KUGOU_CLOUDLIST_DETAIL_FAILED');
      }
      const pageTracks = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data']);
      rawTracks = rawTracks.concat(pageTracks);
      total = Number(detail && detail.data && (detail.data.count || detail.data.total)) || rawTracks.length;
      if (!pageTracks.length || rawTracks.length >= total) break;
      page++;
    } while (page <= 10);
  } catch (err) {
    detail = await kugouGatewayRequest('/pubsongs/v2/get_other_list_file_nofilt', {
      params: { id: pid, global_collection_id: pid, page: 1, pagesize: 500, area_code: 1, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization' },
      headers: { 'x-router': 'pubsongscdn.kugou.com' },
    });
    rawTracks = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data']);
  }
  const tracks = sortKugouCloudTracks(rawTracks).map(mapKugouTrack).filter(s => s.name && (s.hash || s.id));
  return {
    loggedIn: true,
    provider: 'kugou',
    playlist: { provider: 'kugou', id: pid, name: '', trackCount: tracks.length },
    tracks,
  };
}

async function kugouTrackercdnPlayUrl(hash, options) {
  options = options || {};
  const h = String(hash || '').trim().toUpperCase();
  const obj = kugouCookieObject();
  const userId = kugouCookieUserId(obj);
  const token = kugouCookieToken(obj);
  const mid = kugouCookieMid(obj);
  const appid = KUGOU_APPID;
  const params = {
    cmd: '26',
    hash: h,
    behavior: 'play',
    appid,
    pid: '2',
    mid,
    userid: userId || '0',
    version: KUGOU_CLIENTVER,
    vipType: String(options.vipType || kugouCookieVipType(obj) || 0),
    token: token || '0',
    key: kugouMd5(h + KUGOU_PLAY_KEY_SALT + appid + mid + (userId || '0')),
  };
  if (options.albumAudioId) params.album_audio_id = String(options.albumAudioId);
  if (options.albumId) params.album_id = String(options.albumId);
  const u = new URL('/i/v2/', 'https://trackercdn.kugou.com');
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null && String(params[k]) !== '') u.searchParams.set(k, String(params[k]));
  });
  const text = await requestText(u.toString(), {
    headers: {
      'User-Agent': KUGOU_ANDROID_UA,
      Cookie: kugouCloudlistCookieHeader(obj),
    },
  });
  const cleanText = String(text || '')
    .replace('<!--KG_TAG_RES_START-->', '')
    .replace('<!--KG_TAG_RES_END-->', '')
    .trim();
  return parseJSONText(cleanText);
}

function kugouPlayableUrlFromResponse(json) {
  const data = json && (json.data || json);
  const rawUrl = data && (data.play_url || data.play_backup_url || data.url || data.src || data.backup_url);
  const url = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
  const backupUrl = data && (Array.isArray(data.backup_url) ? data.backup_url[0] : data.backup_url);
  return url || backupUrl || '';
}

function decodeKugouLyricContent(raw) {
  raw = String(raw || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length >= 8) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '');
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) return decoded.replace(/\r\n/g, '\n').trim();
    } catch (_) {}
  }
  return raw.replace(/\r\n/g, '\n').trim();
}

async function handleKugouLyric(hash, duration) {
  const h = String(hash || '').trim().toUpperCase();
  if (!h) return { provider: 'kugou', error: 'Missing Kugou hash', lyric: '' };
  const searchUrl = new URL('http://lyrics.kugou.com/search');
  searchUrl.searchParams.set('ver', '1');
  searchUrl.searchParams.set('man', 'yes');
  searchUrl.searchParams.set('client', 'pc');
  searchUrl.searchParams.set('hash', h);
  const dur = Number(duration || 0) || 0;
  if (dur > 0) searchUrl.searchParams.set('duration', String(Math.round(dur > 1000 ? dur : dur * 1000)));
  const search = parseJSONText(await requestText(searchUrl.toString(), { headers: { 'User-Agent': UA } }));
  const candidates = Array.isArray(search && search.candidates) ? search.candidates : [];
  const first = candidates[0];
  if (!first || !first.id || !first.accesskey) {
    return { provider: 'kugou', lyric: '', tlyric: '', yrc: '', source: 'kugou-empty' };
  }
  const downloadUrl = new URL('http://lyrics.kugou.com/download');
  downloadUrl.searchParams.set('ver', '1');
  downloadUrl.searchParams.set('client', 'pc');
  downloadUrl.searchParams.set('id', String(first.id));
  downloadUrl.searchParams.set('accesskey', String(first.accesskey));
  downloadUrl.searchParams.set('fmt', 'lrc');
  downloadUrl.searchParams.set('charset', 'utf8');
  const body = parseJSONText(await requestText(downloadUrl.toString(), { headers: { 'User-Agent': UA } }));
  const lyricText = decodeKugouLyricContent(body && body.content);

  let transText = '';
  if (body && body.trans) {
    transText = decodeKugouLyricContent(body.trans);
  }
  if (!transText) {
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || !c.id || !c.accesskey) continue;
      const isTransCandidate = String(c.style) === '2' || String(c.lyric_style) === '2' || c.trans === true;
      if (!isTransCandidate && candidates.length > 2) continue;
      try {
        const tdl = new URL('http://lyrics.kugou.com/download');
        tdl.searchParams.set('ver', '1');
        tdl.searchParams.set('client', 'pc');
        tdl.searchParams.set('id', String(c.id));
        tdl.searchParams.set('accesskey', String(c.accesskey));
        tdl.searchParams.set('fmt', 'lrc');
        tdl.searchParams.set('charset', 'utf8');
        const tbody = parseJSONText(await requestText(tdl.toString(), { headers: { 'User-Agent': UA } }));
        const tContent = decodeKugouLyricContent(tbody && tbody.content);
        if (tContent && tContent !== lyricText) {
          transText = tContent;
          break;
        }
      } catch (_) {}
    }
  }

  return {
    provider: 'kugou',
    hash: h,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    source: lyricText ? 'kugou-lyrics' : 'kugou-empty',
  };
}

async function getKugouLoginInfoFresh() {
  if (kugouCookie) {
    try {
      const apiInfo = await getKugouLoginInfoFromApi(kugouCookie);
      if (apiInfo && apiInfo.loggedIn) {
        return Object.assign({}, apiInfo, {
          playbackKeyReady: apiInfo.playbackReady !== false,
          preview: false,
          message: '已保存酷狗网页登录会话',
        });
      }
      if (apiInfo) return Object.assign({}, getKugouLoginInfo(), apiInfo);
    } catch (err) {
      console.warn('[KugouLoginInfoApi]', err && err.message);
    }
  }
  const info = getKugouLoginInfo();
  if (!info.loggedIn || info.isVip) return info;
  const now = Date.now();
  if (kugouVipProbeCache.userId === info.userId && kugouVipProbeCache.info && now - kugouVipProbeCache.checkedAt < 5 * 60 * 1000) {
    return Object.assign({}, info, kugouVipProbeCache.info);
  }
  try {
    const detail = await kugouCloudlistRequest('/v4/get_list_all_file',
      { listid: '2', page: 1, pagesize: 1 },
      { listid: '2', page: 1, pagesize: 1, area_code: 1, show_relate_goods: 0, allplatform: 1, show_cover: 1, type: 0, userid: Number(info.userId) || info.userId, token: kugouCookieToken() });
    const first = asArrayDeep(detail, ['songs', 'songlist', 'list', 'info', 'files', 'data'])[0] || {};
    const hash = first.hash || first.Hash || first.file_hash || '';
    const probe = hash ? await kugouTrackercdnPlayUrl(hash, {
      albumId: first.album_id || first.albumid || '',
      albumAudioId: first.album_audio_id || first.audio_id || first.mixsongid || '',
      vipType: 1,
    }) : null;
    const playbackReady = !!kugouPlayableUrlFromResponse(probe);
    const probeInfo = playbackReady ? {
      vipType: Math.max(1, Number(info.vipType || 0)),
      vipLevel: 'vip',
      isVip: true,
      isSvip: false,
      vipLabel: 'Kugou VIP',
      playbackKeyReady: true,
    } : { playbackKeyReady: false };
    kugouVipProbeCache = { userId: info.userId, checkedAt: now, info: probeInfo };
    return Object.assign({}, info, probeInfo);
  } catch (_) {
    kugouVipProbeCache = { userId: info.userId, checkedAt: now, info: { playbackKeyReady: false } };
    return info;
  }
}

async function handleKugouSongUrl(hash, albumAudioId, albumId, qualityPreference, qualityHashes) {
  const h = String(hash || '').trim();
  if (!h) return { provider: 'kugou', url: '', playable: false, error: 'Missing Kugou hash' };
  const loginInfo = getKugouLoginInfo();
  const selected = kugouHashForQuality(h, qualityPreference, qualityHashes);
  const json = await kugouTrackercdnPlayUrl(selected.hash || h, { albumAudioId, albumId, vipType: loginInfo.vipType });
  const data = json && (json.data || json);
  const playableUrl = kugouPlayableUrlFromResponse(json);
  const code = json && (json.error_code || json.errcode || json.status);
  const restriction = playableUrl ? null : playbackRestriction('kugou',
    loginInfo.loggedIn ? 'paid_required' : 'login_required',
    loginInfo.loggedIn ? '酷狗没有返回当前账号可播放地址，可能需要会员、购买或官方客户端权限' : '酷狗歌曲需要登录后获取播放地址',
    loginInfo.loggedIn ? 'upgrade' : 'login',
    { code, rawMessage: json && (json.error || json.errmsg || json.message || '') });
  return {
    provider: 'kugou',
    url: playableUrl,
    playable: !!playableUrl,
    loggedIn: !!loginInfo.loggedIn,
    vipType: loginInfo.vipType || 0,
    vipLevel: loginInfo.vipLevel || 'none',
    level: selected.level || (data && (data.audio_name || data.quality || data.bitRate || data.bitrate || '')),
    quality: data && (data.fileName || data.songName || data.extName || ''),
    requestedQuality: normalizeQualityPreference(qualityPreference),
    resolvedHash: selected.hash || h,
    trial: false,
    message: playableUrl ? '' : restriction.message,
    reason: playableUrl ? '' : restriction.category,
    restriction,
    kugouCode: code,
  };
}

function qqAlbumCover(albumMid, size) {
  if (!albumMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T002R' + px + 'x' + px + 'M000' + albumMid + '.jpg?max_age=2592000';
}

function qqSingerAvatar(singerMid, size) {
  if (!singerMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T001R' + px + 'x' + px + 'M000' + singerMid + '.jpg?max_age=2592000';
}

function mapQQArtists(raw) {
  return (raw || [])
    .map(a => ({
      id: a && a.id,
      mid: a && a.mid,
      name: (a && (a.name || a.title)) || '',
    }))
    .filter(a => a.name);
}

function mapQQSmartSong(item) {
  item = item || {};
  const mid = item.mid || item.songmid || item.id || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    name: item.name || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: '',
    cover: '',
    duration: 0,
    fee: 0,
    playable: false,
  };
}

function mapQQTrack(track, fallback) {
  track = track || {};
  fallback = fallback || {};
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || []);
  const mid = track.mid || fallback.mid || fallback.songmid || '';
  const albumMid = album.mid || album.pmid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: track.id || fallback.qqId || fallback.id || '',
    mid,
    songmid: mid,
    mediaMid: track.file && track.file.media_mid,
    name: track.name || track.title || fallback.name || '',
    artist: artists.map(a => a.name).join(' / ') || fallback.artist || '',
    artists: artists.length ? artists : (fallback.artists || []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || fallback.album || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || fallback.cover || '',
    duration: (Number(track.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  };
}

async function qqSmartboxSearch(keywords, limit) {
  const u = new URL(QQ_SMARTBOX_URL);
  u.searchParams.set('format', 'json');
  u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', '0');
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  const text = await requestText(u.toString(), { headers: QQ_HEADERS });
  const json = parseJSONText(text);
  const items = json && json.data && json.data.song && json.data.song.itemlist;
  return (Array.isArray(items) ? items : []).slice(0, Math.max(1, Math.min(limit || 6, 10))).map(mapQQSmartSong);
}

async function qqSongDetail(mid, fallback) {
  if (!mid) return fallback;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid },
    },
  });
  const data = json && json.songinfo && json.songinfo.data;
  return mapQQTrack(data && data.track_info, fallback);
}

async function handleQQArtistDetail(mid, limit) {
  const singerMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(80, parseInt(limit || '36', 10) || 36));
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid: singerMid, sin: 0, num },
    },
  }, { cookie: true });
  const block = json && json.singer;
  if (!block || Number(block.code || 0) !== 0) {
    return { provider: 'qq', error: block && (block.message || block.msg || block.code) || 'QQ_ARTIST_DETAIL_FAILED', artist: null, songs: [] };
  }
  const data = block.data || {};
  const info = data.singer_info || data.singerInfo || {};
  const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = rawSongs
    .map(raw => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter(song => song && song.name && (song.mid || song.id));
  const matchedSongArtist = songs[0] && (songs[0].artists || []).find(a => a && a.mid === singerMid);
  const artistMid = info.mid || singerMid;
  const artistName = info.name || info.title || (matchedSongArtist && matchedSongArtist.name) || '';
  const totalSong = Number(data.total_song || data.song_count || 0) || songs.length;
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      id: info.id || '',
      mid: artistMid,
      name: artistName,
      avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
      fans: Number(info.fans || 0) || 0,
      musicSize: totalSong,
      albumSize: Number(data.total_album || 0) || 0,
      mvSize: Number(data.total_mv || 0) || 0,
    },
    total: totalSong,
    songs,
  };
}

async function handleQQSearch(keywords, limit) {
  const kw = String(keywords || '').trim();
  if (!kw) return [];
  const base = await qqSmartboxSearch(kw, limit);
  const detailed = await Promise.all(base.map(async item => {
    try { return await qqSongDetail(item.mid, item); }
    catch (e) {
      console.warn('[QQSearch] detail failed:', item.mid, e.message);
      return item;
    }
  }));
  const seen = new Set();
  return detailed.filter(song => {
    const key = song && (song.mid || song.id || (song.name + '|' + song.artist));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!song.name;
  });
}

async function handleQQSongUrl(mid, mediaMid, qualityPreference) {
  const songmid = String(mid || '').trim();
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj) || '0';
  const musicKey = qqCookieMusicKey(cookieObj);
  const playbackKey = qqCookiePlaybackKey(cookieObj);
  const fileMediaMid = String(mediaMid || '').trim();
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const mediaIds = [];
  if (fileMediaMid) mediaIds.push(fileMediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);
  const fileCandidates = mediaIds.flatMap(mediaId =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
  );
  const filenames = fileCandidates.map(item => item.filename);
  const param = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  };
  if (filenames.length) param.filename = filenames;
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  const json = await qqMusicRequest({
    comm,
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param,
    },
  }, { cookie: true });
  const data = json && json.req_0 && json.req_0.data;
  const infos = (data && Array.isArray(data.midurlinfo)) ? data.midurlinfo : [];
  const info = infos.find(item => item && item.purl) || infos[0];
  const purl = info && info.purl;
  if (purl) {
    const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/';
    const fileMeta = fileCandidates.find(item => item.filename === info.filename) || {};
    return {
      provider: 'qq',
      url: sip + purl,
      trial: false,
      playable: true,
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      filename: info.filename || '',
      requestedQuality,
    };
  }
  const restriction = classifyQQPlaybackRestriction(info, {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
  });
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: !!(uin && musicKey),
    playbackKeyReady: !!(uin && playbackKey),
    restriction,
    reason: restriction.category,
    message: restriction.message,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    tried: fileCandidates.map(item => item.label + ' · ' + item.filename),
    requestedQuality,
  };
}

function mapQQComment(raw) {
  raw = raw || {};
  const user = raw.user || raw.uin || {};
  const nickname = raw.nick || raw.nickname || raw.encrypt_uin || user.nick || user.nickname || user.name || 'QQ 音乐用户';
  const avatar = raw.avatarurl || raw.avatar || user.avatarurl || user.avatar || '';
  const timeRaw = Number(raw.time || raw.commenttime || raw.createTime || 0) || 0;
  return {
    id: raw.commentid || raw.commentId || raw.id || '',
    content: raw.rootcommentcontent || raw.content || raw.comment || '',
    likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: raw.encrypt_uin || raw.uin || user.uin || '',
      nickname,
      avatar,
    },
  };
}

async function handleQQSongComments(id, mid, limit, offset) {
  let topid = String(id || '').replace(/\D/g, '');
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid });
      topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
    } catch (e) {
      console.warn('[QQComments] detail fallback failed:', e.message);
    }
  }
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
  const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
  const uin = qqCookieUin() || '0';
  const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
    g_tk: '5381',
    loginUin: uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
    cid: '205360772',
    reqtype: '2',
    biztype: '1',
    topid,
    cmd: '8',
    needmusiccrit: '0',
    pagenum: String(page),
    pagesize: String(limit || 20),
  }, { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } });
  const hotList = body && body.hot_comment && body.hot_comment.commentlist;
  const normalList = body && body.comment && body.comment.commentlist;
  const raw = (offset === 0 && Array.isArray(hotList) && hotList.length) ? hotList : (normalList || []);
  const comments = (raw || []).map(mapQQComment).filter(c => c.content);
  const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
  return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function decodeQQLyricText(text) {
  let raw = decodeHtmlEntities(String(text || '').trim());
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const looksBase64 = compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '');
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
    } catch (e) {
      console.warn('[QQLyric] base64 decode failed:', e.message);
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
}

function normalizeQQSongId(id) {
  const n = String(id || '').replace(/\D/g, '');
  return n ? Number(n) : 0;
}

async function handleQQLyric(mid, id) {
  const songMID = String(mid || '').trim();
  const songID = normalizeQQSongId(id);
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };

  let lyricText = '';
  let transText = '';
  let qrcText = '';
  let romaText = '';
  let source = 'qq-musicu';

  try {
    const param = {};
    if (songMID) param.songMID = songMID;
    if (songID) param.songID = songID;
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param,
      },
    }, { cookie: true });
    const data = json && json.lyric && json.lyric.data;
    lyricText = decodeQQLyricText(data && data.lyric);
    transText = decodeQQLyricText(data && data.trans);
    qrcText = decodeQQLyricText(data && data.qrc);
    romaText = decodeQQLyricText(data && data.roma);
  } catch (e) {
    console.warn('[QQLyric] musicu failed:', e.message);
  }

  if (!lyricText && songMID) {
    try {
      const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        songmid: songMID,
        songtype: '0',
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: qqCookieUin() || '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, { headers: { Referer: 'https://y.qq.com/portal/player.html' } });
      lyricText = decodeQQLyricText(body && body.lyric);
      transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
      source = 'qq-legacy';
    } catch (e) {
      console.warn('[QQLyric] legacy failed:', e.message);
    }
  }

  return {
    provider: 'qq',
    id: songID || '',
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    qrc: qrcText,
    roma: romaText,
    source: lyricText ? source : 'qq-empty',
  };
}

function mapPodcastRadio(r) {
  r = r || {};
  const dj = r.dj || r.djSimple || r.djUser || r.creator || {};
  const id = r.id || r.rid || r.radioId;
  return {
    id,
    rid: id,
    name: r.name || r.radioName || '',
    cover: r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl || '',
    desc: r.desc || r.description || r.rcmdText || '',
    djName: dj.nickname || r.djName || r.nickname || '',
    category: r.category || r.categoryName || '',
    programCount: r.programCount || r.programNum || r.programCnt || 0,
    subCount: r.subCount || r.subedCount || r.subscriberCount || 0,
  };
}

function mapPodcastProgram(p, fallbackRadio) {
  p = p || {};
  const mainSong = p.mainSong || p.song || p.mainTrack || {};
  const radio = p.radio || fallbackRadio || {};
  const mappedRadio = mapPodcastRadio(radio);
  const artists = mapArtists(mainSong.ar || mainSong.artists || []);
  const album = mainSong.al || mainSong.album || {};
  const dj = p.dj || radio.dj || {};
  const playableId = mainSong.id || p.mainSongId || p.songId;
  return {
    type: 'podcast',
    source: 'podcast',
    id: playableId,
    programId: p.id || p.programId,
    radioId: mappedRadio.id,
    name: p.name || mainSong.name || '',
    artist: mappedRadio.name || dj.nickname || artists.map(a => a.name).join(' / ') || mappedRadio.djName || '',
    artists,
    artistId: artists[0] && artists[0].id,
    album: mappedRadio.name || album.name || 'Podcast',
    cover: p.coverUrl || p.cover || p.blurCoverUrl || mappedRadio.cover || album.picUrl || '',
    duration: p.duration || mainSong.dt || mainSong.duration || 0,
    fee: mainSong.fee,
    djName: mappedRadio.djName || dj.nickname || '',
    radioName: mappedRadio.name || '',
    desc: p.description || p.desc || '',
    createTime: p.createTime || 0,
    serialNum: p.serialNum || p.serial || 0,
  };
}

function firstArrayFrom(obj, keys) {
  obj = obj || {};
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.list)) return value.list;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.resources)) return value.resources;
  }
  return [];
}

function mapPodcastVoice(v) {
  v = v || {};
  const raw = v.resource || v.voice || v.data || v.program || v;
  const mainSong = raw.mainSong || raw.song || raw.track || {};
  const radio = raw.radio || raw.djRadio || raw.voiceList || raw.podcast || {};
  const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id;
  return {
    type: 'podcast',
    source: 'podcast',
    sourceType: 'podcast-voice',
    id: playableId,
    programId: raw.programId || raw.voiceId || raw.id,
    radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
    name: raw.name || raw.songName || raw.title || mainSong.name || '',
    artist: (radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName || 'Voice'),
    album: radio.name || radio.radioName || raw.podcastName || 'Podcast',
    cover: raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl || '',
    duration: raw.duration || raw.durationMs || mainSong.dt || mainSong.duration || 0,
    djName: raw.djName || (radio.dj && radio.dj.nickname) || '',
    radioName: radio.name || radio.radioName || raw.podcastName || '',
    desc: raw.desc || raw.description || '',
  };
}

function mapPodcastCollectionRadio(r, key) {
  const radio = mapPodcastRadio(r);
  return {
    ...radio,
    type: 'podcast-radio',
    sourceType: 'podcast-radio',
    collectionKey: key || '',
    radioId: radio.id,
    name: radio.name,
    artist: radio.djName || radio.category || 'Podcast',
    album: radio.category || 'Podcast',
  };
}

function podcastCollectionMeta(key, items) {
  const meta = {
    collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
    created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
    liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
  }[key] || { key, title: key, sub: '', itemType: 'radio' };
  const first = (items || [])[0] || {};
  return {
    ...meta,
    count: (items || []).length,
    cover: first.cover || first.picUrl || first.coverUrl || '',
  };
}

async function fetchMyPodcastItems(key, info, limit, offset) {
  limit = Math.max(8, Math.min(60, Number(limit) || 30));
  offset = Math.max(0, Number(offset) || 0);
  if (key === 'collect') {
    const r = await dj_sublist({ limit, offset, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['djRadios', 'djradios', 'radios', 'data']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'created') {
    const r = await user_audio({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'paid') {
    const r = await dj_paygift({ limit, offset, cookie: userCookie, timestamp: Date.now() });
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map(x => mapPodcastCollectionRadio(x, key)).filter(x => x.id) };
  }
  if (key === 'liked') {
    let raw = [];
    try {
      const sati = await sati_resource_sub_list({ cookie: userCookie, timestamp: Date.now() });
      raw = firstArrayFrom(sati.body, ['data', 'resources', 'list']);
    } catch (e) {
      console.warn('[MyPodcastLiked] sati sub list failed:', e.message);
    }
    if (!raw.length) {
      try {
        const recent = await record_recent_voice({ limit, cookie: userCookie, timestamp: Date.now() });
        raw = firstArrayFrom(recent.body, ['data', 'list', 'resources']);
      } catch (e) {
        console.warn('[MyPodcastLiked] recent voice fallback failed:', e.message);
      }
    }
    return { itemType: 'voice', items: raw.map(mapPodcastVoice).filter(x => x.id && x.name) };
  }
  return { itemType: 'radio', items: [] };
}

// ---------- 业务: 取歌曲URL (探测试听) ----------
//   返回 { url, trial, level, br }
//   trial=true 表示这是试听片段 (freeTrialInfo 非空)
const QQ_AUDIO_PROBE_ATTEMPT_MS = 2000;
const AUDIO_URL_PROBE_BYTES = 8192;
function audioProbeMagic(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3-id3';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'wave';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  const scan = Math.min(buffer.length - 1, 2048);
  for (let i = 0; i < scan; i++) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) return 'mpeg-frame';
  }
  return '';
}
async function probePlaybackAudioUrl(audioUrl, timeoutMs) {
  try {
    const probeStartedAt = Date.now();
    const probeBudgetMs = Math.max(800, Number(timeoutMs) || QQ_AUDIO_PROBE_ATTEMPT_MS);
    const resp = await fetchWithTimeout(audioUrl, {
      headers: audioProxyHeadersFor(audioUrl, 'bytes=0-' + (AUDIO_URL_PROBE_BYTES - 1)),
    }, probeBudgetMs);
    const status = Number(resp.status) || 0;
    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    const chunks = [];
    let bytes = 0;
    if (resp.body && (status === 200 || status === 206)) {
      const reader = resp.body.getReader();
      const deadline = probeStartedAt + probeBudgetMs;
      try {
        while (bytes < AUDIO_URL_PROBE_BYTES && Date.now() < deadline) {
          const chunk = await readStreamChunkWithTimeout(reader, Math.max(50, deadline - Date.now()));
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value || []);
          if (!buf.length) continue;
          chunks.push(buf);
          bytes += buf.length;
        }
      } finally {
        try { await reader.cancel(); } catch (_) {}
      }
    } else {
      try { if (resp.body && typeof resp.body.cancel === 'function') await resp.body.cancel(); } catch (_) {}
    }
    const sample = chunks.length ? Buffer.concat(chunks, bytes).subarray(0, AUDIO_URL_PROBE_BYTES) : Buffer.alloc(0);
    const magic = audioProbeMagic(sample);
    const contentLooksText = /text\/html|application\/(json|xml)|text\/plain/.test(contentType);
    return {
      ok: (status === 200 || status === 206) && sample.length >= 512 && !contentLooksText && !!magic,
      status,
      bytes: sample.length,
      contentType,
      magic,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason: err && err.name === 'AbortError' ? 'timeout' : 'network',
    };
  }
}
async function probeQQAudioUrl(audioUrl, timeoutMs) {
  return probePlaybackAudioUrl(audioUrl, timeoutMs || QQ_AUDIO_PROBE_ATTEMPT_MS);
}

async function resolveNeteaseDirectSongUrl(id, loginInfo, qualityPreference) {
  console.log('[SongUrl] id:', id, 'logged-in:', !!userCookie);
  const resolveDeadline = Date.now() + NETEASE_DIRECT_RESOLVE_BUDGET_MS;
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const svipReady = hasNeteaseSvip(loginInfo);
  const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES)
    .filter(q => !q.svip || svipReady);

  let trialFallback = null;
  let lastData = null;
  let lastError = null;
  const probeCache = new Map();
  const probeFailures = [];

  for (const q of qualities) {
    if (resolveDeadline - Date.now() < 500) break;
    try {
      let result;
      try {
        result = await promiseWithTimeout(
          song_url_v1({ id, level: q.level, cookie: userCookie }),
          Math.min(2600, Math.max(500, resolveDeadline - Date.now())),
          'NETEASE_DIRECT_URL_TIMEOUT'
        );
      } catch (e) {
        lastError = e;
        if (resolveDeadline - Date.now() < 500) throw e;
        result = await promiseWithTimeout(
          song_url({ id, br: q.br, cookie: userCookie }),
          Math.min(2200, Math.max(500, resolveDeadline - Date.now())),
          'NETEASE_LEGACY_URL_TIMEOUT'
        );
      }
      const d = result.body && result.body.data && result.body.data[0];
      if (d) lastData = d;
      const url = d && d.url;
      const freeTrial = d && d.freeTrialInfo;
      console.log('[SongUrl]', q.level, '->', url ? 'OK' : 'no url', freeTrial ? '(TRIAL)' : '');
      let probe = null;
      if (url) {
        probe = probeCache.get(url);
        if (!probe) {
          probe = await probePlaybackAudioUrl(url, Math.min(2500, Math.max(600, resolveDeadline - Date.now())));
          probeCache.set(url, probe);
        }
        if (!probe.ok || !probe.magic) {
          probeFailures.push(q.level + ':' + (probe.status || probe.reason || 'invalid-audio'));
          continue;
        }
      }
      if (url && !freeTrial && probe && probe.ok) {
        return {
          provider: 'netease',
          source: 'netease',
          url,
          trial: false,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
          probeStatus: probe.status,
          probeBytes: probe.bytes,
          probeMagic: probe.magic,
        };
      }
      if (url && freeTrial && probe && probe.ok && !trialFallback) {
        trialFallback = {
          provider: 'netease',
          source: 'netease',
          url,
          trial: true,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
          trialInfo: freeTrial,
          restriction: classifyNeteasePlaybackRestriction(d, loginInfo),
          probeStatus: probe.status,
          probeBytes: probe.bytes,
          probeMagic: probe.magic,
        };
      }
    } catch (err) {
      lastError = err;
      console.log('[SongUrl]', q.level, 'failed:', err.message);
    }
  }
  if (trialFallback) return trialFallback;
  const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo);
  return {
    provider: 'netease',
    source: 'netease',
    url: null,
    trial: false,
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction,
    lastCode: lastData && lastData.code,
    fee: lastData && lastData.fee,
    error: lastError && lastError.message,
    requestedQuality,
    probeFailures: probeFailures.length ? probeFailures : undefined,
  };
}

async function resolveNeteaseSameTrackPlayback(id, loginInfo, qualityPreference, matchHints, requestDeadline) {
  const ownDeadline = Date.now() + NETEASE_SOURCE_MATCH_TOTAL_BUDGET_MS;
  const deadline = Number(requestDeadline) > 0 ? Math.min(ownDeadline, Number(requestDeadline)) : ownDeadline;
  let candidates = [];
  try {
    const lookupBudget = Math.min(NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS, Math.max(500, deadline - Date.now()));
    candidates = await promiseWithTimeout(
      findNeteaseSameTrackCandidates(id, matchHints, Date.now() + lookupBudget),
      lookupBudget,
      'NETEASE_SOURCE_MATCH_LOOKUP_TIMEOUT'
    );
  } catch (err) {
    console.warn('[NeteaseSourceMatch] lookup failed:', err.code || err.message);
    return null;
  }
  const excludedIds = new Set(String(matchHints && matchHints.excludeIds || '')
    .split(',')
    .map(value => String(value || '').trim())
    .filter(Boolean));
  const attemptedIds = [...excludedIds];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const candidateId = String(candidate && candidate.song && candidate.song.id || '');
    if (!candidateId || excludedIds.has(candidateId)) continue;
    attemptedIds.push(candidateId);
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 800) break;
      const playback = await promiseWithTimeout(
        resolveNeteaseDirectSongUrl(candidate.song.id, loginInfo, qualityPreference),
        Math.min(NETEASE_DIRECT_RESOLVE_BUDGET_MS, remainingMs),
        'NETEASE_SOURCE_MATCH_PLAYBACK_TIMEOUT'
      );
      if (!playback || !playback.url || playback.trial) continue;
      return { candidate, playback, triedIds: attemptedIds.slice() };
    } catch (err) {
      console.warn('[NeteaseSourceMatch] candidate failed:', candidate.song && candidate.song.id, err.code || err.message);
    }
  }
  return null;
}

async function handleSongUrl(id, loginInfo, qualityPreference, matchHints) {
  const hints = matchHints || {};
  const requestDeadline = Date.now() + NETEASE_SONG_URL_TOTAL_BUDGET_MS;
  let direct = null;
  if (!hints.skipDirect) {
    try {
      direct = await promiseWithTimeout(
        resolveNeteaseDirectSongUrl(id, loginInfo, qualityPreference),
        Math.min(NETEASE_DIRECT_RESOLVE_BUDGET_MS + 300, Math.max(500, requestDeadline - Date.now())),
        'NETEASE_DIRECT_RESOLVE_TIMEOUT'
      );
    } catch (err) {
      const restriction = playbackRestriction('netease', 'url_unavailable', '网易云音源请求超时，已继续尝试站内同一录音版本', 'retry', { code: err.code || 'NETEASE_DIRECT_RESOLVE_TIMEOUT' });
      direct = {
        provider: 'netease',
        source: 'netease',
        url: null,
        trial: false,
        playable: false,
        reason: restriction.category,
        message: restriction.message,
        restriction,
        error: err.code || err.message,
      };
    }
  } else {
    const restriction = playbackRestriction('netease', 'url_unavailable', '正在继续尝试网易云站内的其它同曲版本', 'retry', { code: 'NETEASE_DIRECT_SKIPPED_AFTER_MATCH_FAILURE' });
    direct = {
      provider: 'netease',
      source: 'netease',
      url: null,
      trial: false,
      playable: false,
      reason: restriction.category,
      message: restriction.message,
      restriction,
      error: 'NETEASE_DIRECT_SKIPPED_AFTER_MATCH_FAILURE',
    };
  }
  if (direct && direct.url && !direct.trial) return direct;
  const sourceMatchAttempted = !!(String(hints.name || hints.title || '').trim() && String(hints.artist || '').trim());
  const matched = await resolveNeteaseSameTrackPlayback(id, loginInfo, qualityPreference, hints, requestDeadline);
  if (!matched) return Object.assign({}, direct, { sourceMatchAttempted });
  return Object.assign({}, matched.playback, {
    provider: 'netease',
    source: 'netease-same-track',
    sourceMatch: true,
    matchKind: matched.candidate.fingerprintMatches > 0
      ? 'netease_same_recording'
      : (matched.candidate.officialRecommendation ? 'netease_official_alternate' : 'netease_same_track_metadata'),
    matchedFromId: String(id || ''),
    requestedSongId: String(id || ''),
    resolvedNeteaseId: String(matched.candidate.song.id || ''),
    resolvedSongId: String(matched.candidate.song.id || ''),
    matchedSong: matched.candidate.song,
    matchScore: Math.round(matched.candidate.score || 0),
    fingerprintMatches: matched.candidate.fingerprintMatches || 0,
    sourceMatchTriedIds: matched.triedIds || [String(matched.candidate.song.id || '')],
    originalRestriction: direct && direct.restriction || null,
  });
}



// ---------- 业务: 登录态/用户信息 ----------
function readCookieFromResponse(resp) {
  const candidates = [
    resp && resp.cookie,
    resp && resp.body && resp.body.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookies,
  ];
  for (const candidate of candidates) {
    const cookie = normalizeCookieHeader(candidate);
    if (cookie) return cookie;
  }
  return '';
}
function firstPositiveNumberFrom(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}
function collectStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') {
    if (value) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(key => collectStringValues(value[key], out, depth + 1));
  }
  return out;
}
function collectVipStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectVipStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  Object.keys(value).forEach(key => {
    const child = value[key];
    if (/vip|svip|member|associator|privilege|right|level|package|label|title|type/i.test(key)) {
      collectStringValues(child, out, depth + 1);
    } else if (child && typeof child === 'object') {
      collectVipStringValues(child, out, depth + 1);
    }
  });
  return out;
}
function normalizeNeteaseVip(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  extra = extra || {};
  const vipInfo = profile.vipInfo || profile.vipinfo || account.vipInfo || account.vipinfo || extra.vipInfo || extra.vipinfo || {};
  const objects = [account, profile, vipInfo, extra];
  const vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'musicVipLevel', 'music_vip_level', 'redVipLevel', 'red_vip_level',
    'blackVipLevel', 'black_vip_level', 'luxuryVipLevel', 'luxury_vip_level',
    'svipType', 'svip_type',
  ]);
  const text = collectVipStringValues({ account, profile, vipInfo, extra }, [], 0).join(' ').toLowerCase();
  const svipFlag = objects.some(obj => obj && (
    obj.isSvip === true || obj.is_svip === true || obj.svip === true ||
    Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || 0) > 0
  )) || /svip|supervip|super_vip|blackvip|black_vip|黑胶svip|超级会员/.test(text);
  const vipFlag = objects.some(obj => obj && (
    obj.isVip === true || obj.is_vip === true || obj.vip === true ||
    Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || 0) > 0
  )) || /vip|黑胶|会员/.test(text);
  const isSvip = svipFlag || vipType >= 10;
  const isVip = isSvip || vipFlag || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无VIP'),
  };
}
function normalizeLoginInfo(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  const userId = profile.userId || profile.user_id || profile.id || account.userId || account.id || '';
  if (!(userId || userId === 0)) return { loggedIn: false };
  const vip = normalizeNeteaseVip(profile, account, extra);
  return {
    loggedIn: true,
    userId,
    nickname: profile.nickname || profile.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || '',
    ...vip,
  };
}
function isNeteaseAuthInvalidPayload(payload) {
  const code = normalizeApiCode(payload);
  if (code === 301 || code === 401) return true;
  const msg = normalizeApiMessage(payload);
  return /未登录|需要登录|请先登录|login/i.test(msg) && code >= 300;
}
async function getLoginInfo() {
  if (!userCookie) return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };

  // login_status 对二维码 cookie 的资料刷新通常更及时；失败时再降级到 user_account。
  try {
    const st = await login_status({ cookie: userCookie, timestamp: Date.now() });
    const body = st.body || {};
    const data = body.data || body;
    const info = normalizeLoginInfo(data.profile || body.profile, data.account || body.account, data);
    if (info.loggedIn) return info;
  } catch (e) {
    console.warn('[Login] login_status failed:', e.message);
  }

  try {
    const acc = await user_account({ cookie: userCookie, timestamp: Date.now() });
    const body = acc.body || {};
    const info = normalizeLoginInfo(body.profile, body.account, body);
    if (info.loggedIn) return info;
    if (isNeteaseAuthInvalidPayload(acc)) saveCookie('');
    return { loggedIn: false, hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  } catch (e) {
    console.warn('[Login] account check failed:', e.message);
    return { loggedIn: false, hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  }
}

// ====================================================================
//  HTTP Server
// ====================================================================
const routeCtx = {
  // ---- config / 常量 ----
  APP_PACKAGE, APP_VERSION, UPDATE_CONFIG, UA, SCENE_PRESETS, CUEFIELD_FEEDBACK_FILE,
  // ---- http 工具 ----
  sendJSON, readRequestBody, serveStatic, serveIndexHtml,
  assertProxyableMediaUrl, fetchProxiedMedia,
  audioProxyHeadersFor, audioContentTypeForUrl, sendAudioBuffer,
  qishuiAudioAuthFromUrl, getQishuiDecryptedAudio,
  // ---- update / beatmap / cuefield ----
  fetchLatestUpdateInfo, localUpdateFallback,
  startUpdateDownloadJob, startUpdatePatchJob, publicUpdateJob, updateDownloadJobs,
  beatCacheRootInfo, readBeatMapCache, writeBeatMapCache,
  planCuefieldTransitionFromCache, readCuefieldFeedbackStats, appendCuefieldFeedback,
  // ---- home / weather ----
  handleDiscoverHome, buildSceneRadio, buildWeatherRadio, fetchIpWeatherLocation,
  // ---- netease 业务函数 ----
  handleSearch, handleSongUrl, getLoginInfo, requireLogin, normalizeLoginInfo,
  readCookieFromResponse, saveCookie, normalizeCookieHeader, parseCookieString,
  normalizeApiCode, normalizeApiMessage, mapSongRecord,
  mapPodcastRadio, mapPodcastProgram, podcastCollectionMeta, fetchMyPodcastItems,
  enqueueDjAnalyze, analyzePodcastDjStream, analyzePodcastDjIntro,
  // ---- netease openapi ----
  cloudsearch, dj_hot, dj_detail, dj_program, login_qr_key, login_qr_create, login_qr_check,
  logout, user_playlist, song_like_check, likelist, like_song,
  album_sub, album_sublist, playlist_subscribe, playlist_create, playlist_tracks,
  playlist_track_add, playlist_track_all, playlist_detail, comment_music,
  artist_detail, artist_songs, artist_top_song, lyric, lyric_new,
  // ---- qq ----
  handleQQSearch, handleQQSongUrl, handleQQLyric, getQQLoginInfo, normalizeQQCookieInput,
  qqCookieUin, qqCookieMusicKey, saveQQCookie,
  handleQQUserPlaylists, handleQQPlaylistTracks, handleQQArtistDetail, handleQQSongComments,
  // ---- kugou ----
  getKugouLoginInfoFresh, getKugouLoginInfo, handleKugouLoginQrKey, handleKugouLoginQrCheck,
  normalizeKugouCookieInput, saveKugouCookie,
  handleKugouUserPlaylists, handleKugouPlaylistTracks, handleKugouSongUrl, handleKugouLyric, handleKugouGuessLike,
  // ---- qishui ----
  handleQishuiStatus, saveQishuiAccessToken, getQishuiStatus, clearQishuiAccessToken,
  normalizeQishuiCookieInput, qishuiCookieHasLogin, saveQishuiCookie,
  handleQishuiSearch, handleQishuiFeed, handleQishuiUserPlaylists,
  handleQishuiPlaylistTracks, handleQishuiCheckTracksLiked, handleQishuiSetTrackLiked,
  handleQishuiSetPlaylistCollected, handleQishuiPlaylistAddSong, handleQishuiSetAlbumCollected,
  handleQishuiSongUrl, handleQishuiLyric,
  // ---- spotify ----
  handleSpotifyStatus, saveSpotifyConfig, clearSpotifyToken, getSpotifyConfig,
  handleSpotifyUserPlaylists, handleSpotifyLibraryCheck, handleSpotifyLibrarySet,
  handleSpotifyPlaylistAddSong, handleSpotifyCreatePlaylist, handleSpotifyPlaylistTracks,
  handleSpotifyAlbumDetail, handleSpotifySearch, handleSpotifyRecommendations,
  handleSpotifySongUrl, handleSpotifyLyric,
  // ---- 可变 cookie 状态：取请求时刻的当前值 ----
  get userCookie() { return userCookie; },
  get qishuiCookie() { return qishuiCookie; },
  get kugouCookie() { return kugouCookie; },
};

const routeMatchers = [
  require('./server/routes/update')(routeCtx),
  require('./server/routes/home')(routeCtx),
  require('./server/routes/netease')(routeCtx),
  require('./server/routes/qq')(routeCtx),
  require('./server/routes/kugou')(routeCtx),
  require('./server/routes/qishui')(routeCtx),
  require('./server/routes/spotify')(routeCtx),
  require('./server/routes/audio')(routeCtx),
  require('./server/routes/ai')(routeCtx),
];

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
      const userDataPath = electron.app ? electron.app.getPath('userData') : '';
      const shaderDir = userDataPath ? require('path').join(userDataPath, 'plugins', 'lyric-shaders') : '';
      const shaders = [];
      if (shaderDir && require('fs').existsSync(shaderDir)) {
        const files = require('fs').readdirSync(shaderDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const content = require('fs').readFileSync(require('path').join(shaderDir, file), 'utf8');
            const parsed = JSON.parse(content);
            if (parsed && parsed.id && parsed.name && parsed.fragmentShader) {
              shaders.push(parsed);
            }
          } catch (_) {}
        }
      }
      sendJSON(res, { shaders });
    } catch (err) {
      sendJSON(res, { shaders: [], error: err.message });
    }
    return;
  }

  // ---------- 静态资源 ----------
    if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  const publicDir = path.resolve(__dirname, 'public');
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
    console.log(' 登录态: ' + (userCookie ? '已登录(cookie已加载)' : '未登录'));
    console.log(' DJ native: ' + (nativeDjAvailable ? 'ON (energy+beatmap C++)' : 'OFF (JS fallback)'));
    if (API_TOKEN_AUTO) console.log(' [Security] API token auto-generated for this session');
    console.log('======================================================');
  });
  return server;
}

if (require.main === module) {
  startHttpServer();
}

module.exports = server;
module.exports.configureCookieStorage = configureCookieStorage;
module.exports.getApiToken = () => API_TOKEN;
module.exports.startHttpServer = startHttpServer;
