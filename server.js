// ====================================================================
//  粒子音乐可视化播放器 — Server v2
//  - 网易云搜索 / 歌曲URL / 封面/音频代理
//  - 扫码登录 (login_qr_*) + cookie 持久化 (./.cookie)
//  - 试听检测 (freeTrialInfo) + 全 quality 探测
//  - 所有受保护 API 都会带上已登录用户的 cookie
// ====================================================================
// ---- 音源模块懒加载：首次调用时 require，保留原函数名以兼容全部调用点 ----
const _lazyMods = { netease: null, kugou: null, spotify: null, qishui: null, qqVip: null };
function _neteaseMod() {
  if (!_lazyMods.netease) _lazyMods.netease = require('NeteaseCloudMusicApi');
  return _lazyMods.netease;
}
function _kugouMod() {
  if (!_lazyMods.kugou) {
    _lazyMods.kugou = require('./kugou-api');
    // cloudlist 拿到新 dfid 后写回 cookie 存档（原先在模块顶层注册）
    try {
      _lazyMods.kugou.setKugouDfidPersistHook(function (dfid) {
        try { saveKugouAuth(Object.assign(kugouCookieObject(), { dfid })); } catch (_) {}
      });
    } catch (_) {}
  }
  return _lazyMods.kugou;
}
function _spotifyMod() {
  if (!_lazyMods.spotify) _lazyMods.spotify = require('./spotify-api');
  return _lazyMods.spotify;
}
function _qishuiMod() {
  if (!_lazyMods.qishui) _lazyMods.qishui = require('./qishui-api');
  return _lazyMods.qishui;
}
function _qqVipMod() {
  if (!_lazyMods.qqVip) _lazyMods.qqVip = require('./qq-vip-api');
  return _lazyMods.qqVip;
}
function _lazyFn(getMod, name) {
  return function (...args) { return getMod()[name](...args); };
}

// NeteaseCloudMusicApi
const cloudsearch = _lazyFn(_neteaseMod, 'cloudsearch');
const song_detail = _lazyFn(_neteaseMod, 'song_detail');
const song_url = _lazyFn(_neteaseMod, 'song_url');
const song_url_v1 = _lazyFn(_neteaseMod, 'song_url_v1');
const login_qr_key = _lazyFn(_neteaseMod, 'login_qr_key');
const login_qr_create = _lazyFn(_neteaseMod, 'login_qr_create');
const login_qr_check = _lazyFn(_neteaseMod, 'login_qr_check');
const login_status = _lazyFn(_neteaseMod, 'login_status');
const logout = _lazyFn(_neteaseMod, 'logout');
const user_account = _lazyFn(_neteaseMod, 'user_account');
const user_playlist = _lazyFn(_neteaseMod, 'user_playlist');
const comment_music = _lazyFn(_neteaseMod, 'comment_music');
const artist_detail = _lazyFn(_neteaseMod, 'artist_detail');
const artist_top_song = _lazyFn(_neteaseMod, 'artist_top_song');
const artist_songs = _lazyFn(_neteaseMod, 'artist_songs');
const like_song = _lazyFn(_neteaseMod, 'like');
const likelist = _lazyFn(_neteaseMod, 'likelist');
const song_like_check = _lazyFn(_neteaseMod, 'song_like_check');
const playlist_tracks = _lazyFn(_neteaseMod, 'playlist_tracks');
const playlist_track_add = _lazyFn(_neteaseMod, 'playlist_track_add');
const playlist_create = _lazyFn(_neteaseMod, 'playlist_create');
const playlist_detail = _lazyFn(_neteaseMod, 'playlist_detail');
const playlist_track_all = _lazyFn(_neteaseMod, 'playlist_track_all');
const personalized = _lazyFn(_neteaseMod, 'personalized');
const recommend_resource = _lazyFn(_neteaseMod, 'recommend_resource');
const recommend_songs = _lazyFn(_neteaseMod, 'recommend_songs');
const dj_detail = _lazyFn(_neteaseMod, 'dj_detail');
const dj_program = _lazyFn(_neteaseMod, 'dj_program');
const dj_hot = _lazyFn(_neteaseMod, 'dj_hot');
const dj_sublist = _lazyFn(_neteaseMod, 'dj_sublist');
const user_audio = _lazyFn(_neteaseMod, 'user_audio');
const dj_paygift = _lazyFn(_neteaseMod, 'dj_paygift');
const record_recent_voice = _lazyFn(_neteaseMod, 'record_recent_voice');
const sati_resource_sub_list = _lazyFn(_neteaseMod, 'sati_resource_sub_list');
const lyric = _lazyFn(_neteaseMod, 'lyric');
const lyric_new = _lazyFn(_neteaseMod, 'lyric_new');
const album_sub = _lazyFn(_neteaseMod, 'album_sub');
const album_sublist = _lazyFn(_neteaseMod, 'album_sublist');
const playlist_subscribe = _lazyFn(_neteaseMod, 'playlist_subscribe');

// kugou-api（函数 + 常量）
const getKugouLoginInfoFromApi = _lazyFn(_kugouMod, 'getKugouLoginInfo');
const handleKugouSearch = _lazyFn(_kugouMod, 'handleKugouSearch');
const handleKugouLyric = _lazyFn(_kugouMod, 'handleKugouLyric');
const handleKugouGuessLike = _lazyFn(_kugouMod, 'handleKugouGuessLike');
const handleKugouLikeCheck = _lazyFn(_kugouMod, 'handleKugouLikeCheck');
const handleKugouLikeToggle = _lazyFn(_kugouMod, 'handleKugouLikeToggle');
const handleKugouPlaylistAddSong = _lazyFn(_kugouMod, 'handleKugouPlaylistAddSong');
const registerKugouCloudDevice = _lazyFn(_kugouMod, 'registerKugouCloudDevice');
const kugouApiCloudlistRequest = _lazyFn(_kugouMod, 'kugouCloudlistRequest');
const ensureKugouDfid = _lazyFn(_kugouMod, 'ensureKugouDfid');
const kugouSignatureAndroidParams = _lazyFn(_kugouMod, 'signatureAndroidParams');
const KUGOU_ID = {
  get APPID() { return _kugouMod().KUGOU_LITE_APPID; },
  get CLIENTVER() { return _kugouMod().KUGOU_LITE_CLIENTVER; },
  get ANDROID_SIGN_KEY() { return _kugouMod().KUGOU_LITE_ANDROID_SALT; },
  get ANDROID_UA() { return _kugouMod().KUGOU_LITE_GATEWAY_UA; },
  get WEB_SIGN_KEY() { return _kugouMod().KUGOU_H5_SALT; },
};

// spotify-api
const getSpotifyConfig = _lazyFn(_spotifyMod, 'getSpotifyConfig');
const clearSpotifyToken = _lazyFn(_spotifyMod, 'clearSpotifyToken');
const saveSpotifyConfig = _lazyFn(_spotifyMod, 'saveSpotifyConfig');
const handleSpotifyStatus = _lazyFn(_spotifyMod, 'handleSpotifyStatus');
const handleSpotifySearch = _lazyFn(_spotifyMod, 'handleSpotifySearch');
const handleSpotifyRecommendations = _lazyFn(_spotifyMod, 'handleSpotifyRecommendations');
const handleSpotifyUserPlaylists = _lazyFn(_spotifyMod, 'handleSpotifyUserPlaylists');
const handleSpotifyPlaylistTracks = _lazyFn(_spotifyMod, 'handleSpotifyPlaylistTracks');
const handleSpotifyAlbumDetail = _lazyFn(_spotifyMod, 'handleSpotifyAlbumDetail');
const handleSpotifyLibraryCheck = _lazyFn(_spotifyMod, 'handleSpotifyLibraryCheck');
const handleSpotifyLibrarySet = _lazyFn(_spotifyMod, 'handleSpotifyLibrarySet');
const handleSpotifyPlaylistAddSong = _lazyFn(_spotifyMod, 'handleSpotifyPlaylistAddSong');
const handleSpotifyCreatePlaylist = _lazyFn(_spotifyMod, 'handleSpotifyCreatePlaylist');
const handleSpotifySongUrl = _lazyFn(_spotifyMod, 'handleSpotifySongUrl');
const handleSpotifyLyric = _lazyFn(_spotifyMod, 'handleSpotifyLyric');

// qishui-api
const getQishuiStatus = _lazyFn(_qishuiMod, 'getQishuiStatus');
const handleQishuiStatus = _lazyFn(_qishuiMod, 'handleQishuiStatus');
const normalizeQishuiCookieInput = _lazyFn(_qishuiMod, 'normalizeQishuiCookieInput');
const qishuiCookieHasLogin = _lazyFn(_qishuiMod, 'qishuiCookieHasLogin');
const saveQishuiAccessToken = _lazyFn(_qishuiMod, 'saveQishuiAccessToken');
const clearQishuiAccessToken = _lazyFn(_qishuiMod, 'clearQishuiAccessToken');
const handleQishuiSearch = _lazyFn(_qishuiMod, 'handleQishuiSearch');
const handleQishuiFeed = _lazyFn(_qishuiMod, 'handleQishuiFeed');
const handleQishuiUserPlaylists = _lazyFn(_qishuiMod, 'handleQishuiUserPlaylists');
const handleQishuiPlaylistTracks = _lazyFn(_qishuiMod, 'handleQishuiPlaylistTracks');
const handleQishuiCheckTracksLiked = _lazyFn(_qishuiMod, 'handleQishuiCheckTracksLiked');
const handleQishuiSetTrackLiked = _lazyFn(_qishuiMod, 'handleQishuiSetTrackLiked');
const handleQishuiSetPlaylistCollected = _lazyFn(_qishuiMod, 'handleQishuiSetPlaylistCollected');
const handleQishuiPlaylistAddSong = _lazyFn(_qishuiMod, 'handleQishuiPlaylistAddSong');
const handleQishuiSetAlbumCollected = _lazyFn(_qishuiMod, 'handleQishuiSetAlbumCollected');
const handleQishuiLyric = _lazyFn(_qishuiMod, 'handleQishuiLyric');
const handleQishuiSongUrl = _lazyFn(_qishuiMod, 'handleQishuiSongUrl');

// qq-vip-api
const normalizeQQVipPayloadStrict = _lazyFn(_qqVipMod, 'normalizeQQVipPayload');
const resolveQQVipFromProbes = _lazyFn(_qqVipMod, 'resolveQQVipFromProbes');
const qqVipSessionCacheKey = _lazyFn(_qqVipMod, 'qqVipSessionCacheKey');
const qqVipCacheTtlMs = _lazyFn(_qqVipMod, 'qqVipCacheTtlMs');
const qqVipEntitlementRights = _lazyFn(_qqVipMod, 'qqVipEntitlementRights');
const preserveQQVipStalePositive = _lazyFn(_qqVipMod, 'preserveQQVipStalePositive');
const qqVipObjectLooksExpiredStrict = _lazyFn(_qqVipMod, 'qqVipObjectLooksExpired');
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
const { Worker } = require('worker_threads');
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
// 更新系统的纯逻辑层（readPackageInfo/readUpdateConfig 在下面立即被调用）
const updateManifestConfig = { appRoot: __dirname };
const updateManifest = require('./server/lib/update-manifest')(updateManifestConfig);
const { readPackageInfo, readUpdateConfig } = updateManifest;
const fetchUtils = require('./server/lib/fetch-utils');
const { promiseWithTimeout, readStreamChunkWithTimeout, fetchWithTimeout } = fetchUtils;

const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.MINERADIO_VERSION || APP_PACKAGE.version || '0.9.11';
const UPDATE_CONFIG = readUpdateConfig(APP_PACKAGE);
const PATCH_MAX_BYTES = 12 * 1024 * 1024;
// 安装包下载累计字节硬上限：content-length 可能撒谎或缺失，恶意/异常上游不能写满磁盘。
// Electron 安装包量级在 100~200MB，800MB 留足余量同时挡住无限流。
const UPDATE_INSTALLER_MAX_BYTES = 800 * 1024 * 1024;
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

const updateDownloadJobs = new Map();

// 更新 / 补丁执行层（依赖上半部分的路径与上限常量）
const updateService = require("./server/lib/update-service")({
  manifest: updateManifest,
  fetchUtils,
  config: {
    appRoot: __dirname,
    APP_VERSION,
    UPDATE_CONFIG,
    UPDATE_DOWNLOAD_DIR,
    UPDATE_PATCH_BACKUP_DIR,
    PATCH_ALLOWED_ROOTS,
    PATCH_MAX_BYTES,
    PATCH_STATIC_EXTENSIONS,
    UPDATE_INSTALLER_MAX_BYTES,
    UPDATE_PUBKEY_PEM,
    UPDATE_FALLBACK_NOTES,
  },
  jobs: updateDownloadJobs,
});
// 版本/更新配置常量在下面才定义，此处回填给纯逻辑层（manifest 在调用期读取 cfg.*）
Object.assign(updateManifestConfig, { APP_VERSION, UPDATE_CONFIG, UPDATE_FALLBACK_NOTES });
const {
  localUpdateFallback, fetchLatestUpdateInfo, publicUpdateJob,
  startUpdateDownloadJob, startUpdatePatchJob,
} = updateService;

// beatmap 磁盘缓存（与更新系统无关，独立域）
const beatmapCache = require("./server/lib/beatmap-cache")({ cacheDir: BEATMAP_CACHE_DIR });
const { beatCacheRootInfo, readBeatMapCache, writeBeatMapCache } = beatmapCache;
let djAnalyzeBusy = false;
const djAnalyzeQueue = [];
// 汽水音频解密（worker / 缓存 / 并发闸门）已拆到 server/lib/qishui-audio.js，
// 注入点在下面「媒体代理 / 鉴权 / 汽水音频解密」注释处（1915 行附近）。

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
// 凭据落盘加密（与 desktop/secret-store.js 同格式："MR" + safeStorage 密文）。
// 返回 null 表示本机拿不到可用加密后端。
function tryEncryptSafeStorage(text) {
  try {
    if (!_safeStorageRef) {
      _safeStorageRef = require('electron').safeStorage || null;
    }
    if (_safeStorageRef && _safeStorageRef.isEncryptionAvailable && _safeStorageRef.isEncryptionAvailable()) {
      const enc = Buffer.from(_safeStorageRef.encryptString(String(text || '')));
      return Buffer.concat([Buffer.from([ENCRYPTED_PREFIX_BYTE0, ENCRYPTED_PREFIX_BYTE1]), enc]);
    }
  } catch (_) {}
  return null;
}
// 明文兜底是显式开发开关，默认关闭：加密不可用时宁可这次会话不落盘。
function plaintextCookieAllowed() {
  return process.env.MINERADIO_ALLOW_PLAINTEXT_COOKIE === '1';
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
    // 无 "MR" 前缀 = 明文。默认路径下 fail-closed：只有显式允许明文（开发态）
    // 才把它当凭据用，避免「加密形同虚设」。
    if (!plaintextCookieAllowed()) {
      cookieDebugLog('readCookieFile: plaintext cookie ignored (encryption unavailable): ' + filePath);
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
    // 默认写入器（未经 desktop 注入时使用）：能加密就加密，加密不可用就拒绝落盘。
    const enc = tryEncryptSafeStorage(value);
    if (enc) {
      fs.writeFileSync(filePath, enc);
      cookieDebugLog('writeCookieFile(default) OK(encrypted): ' + filePath + ' len=' + value.length);
      return;
    }
    if (plaintextCookieAllowed()) {
      fs.writeFileSync(filePath, value, 'utf8');
      cookieDebugLog('writeCookieFile(default) OK(plaintext, allowed by env): ' + filePath + ' len=' + value.length);
      return;
    }
    cookieDebugLog('writeCookieFile(default) REFUSED: encryption unavailable, plaintext not allowed: ' + filePath);
    console.warn('[Cookie] encryption unavailable, credential NOT persisted (set MINERADIO_ALLOW_PLAINTEXT_COOKIE=1 only for dev):', filePath);
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
  invalidateNeteaseLoginInfoCache();
}

let qqCookie = readCookieFile(QQ_COOKIE_FILE);
function saveQQCookie(c) {
  qqCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  writeCookieFile(QQ_COOKIE_FILE, qqCookie);
}
// QQ cookie 写保护：
// 1) withQQCookieWriteLock 序列化「读-改-写」，后台刷新在锁内重读最新值再合并，
//    防止基于旧读取的写回冲掉用户刚手动保存的新值；
// 2) qqCookieEpoch 代际校验，手动保存/登出即递增，在途刷新写回前发现代际变化就放弃写回，
//    防止旧刷新结果把已登出的账号又写活。
let qqCookieWriteChain = Promise.resolve();
function withQQCookieWriteLock(fn) {
  const run = qqCookieWriteChain.then(fn, fn);
  qqCookieWriteChain = run.then(() => {}, () => {});
  return run;
}
let qqCookieEpoch = 0;
function bumpQQCookieEpoch() {
  qqCookieEpoch += 1;
  return qqCookieEpoch;
}

let kugouCookie = readCookieFile(KUGOU_COOKIE_FILE);
function saveKugouCookie(c) {
  kugouCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  kugouVipProbe.current = { userId: '', checkedAt: 0, info: null };
  cookieDebugLog('saveKugouCookie called, configureCalled=' + _configureCookieStorageCalled + ' len=' + (kugouCookie || '').length + ' file=' + KUGOU_COOKIE_FILE);
  try {
    writeCookieFile(KUGOU_COOKIE_FILE, kugouCookie);
    cookieDebugLog('saveKugouCookie write OK');
  } catch (e) {
    // 不再明文兜底：加密写入失败时凭据只保留在内存里，不落盘
    cookieDebugLog('saveKugouCookie write THREW: ' + e.message + ' — credential kept in memory only');
    console.warn('[Cookie] kugou credential NOT persisted:', e.message);
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
    // 不再明文兜底：加密写入失败时凭据只保留在内存里，不落盘
    cookieDebugLog('saveQishuiCookie write THREW: ' + e.message + ' — credential kept in memory only');
    console.warn('[Cookie] qishui credential NOT persisted:', e.message);
  }
}

// ---------- 工具 ----------
// cookie getter：各拆分模块在**调用期**读取（持久化层会反复重新赋值，按值注入会拿到快照）。
// 五个都必须在这里统一声明：模块注入点在文件较早位置，晚于此处会触发 const 的 TDZ。
const getUserCookie = () => userCookie;
const getKugouCookie = () => kugouCookie;
const getQishuiCookie = () => qishuiCookie;
const getQQCookie = () => qqCookie;
// QQ 的 cookie 代际：手动保存 / 登出会 ++，QQ 会话模块靠它判断「在途刷新是否还该写回」
const getQQCookieEpoch = () => qqCookieEpoch;
// QQ 会话模块重读磁盘后需要写回（refreshQQConfiguredCookieStore），getter 无法赋值 → 单独给 setter
const setQQCookie = (value) => { qqCookie = value; };

function staticCacheControlForPath(filePath) {
  const rel = String(filePath || '').replace(/\\/g, '/');
  if (/\/public\/index\.html$/i.test(rel) || /\/index\.html$/i.test(rel)) {
    return 'no-store, no-cache, must-revalidate';
  }
  if (/\/(js\/modules|vendor|css|fonts|assets)\//i.test(rel) ||
      /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico|mp4|webm|json)$/i.test(rel)) {
    // 本地 localhost 服务，revalidate 零成本：文件变了 ETag 必变（size+mtime），
    // 彻底避免「版本号忘 bump → Chromium 缓存旧模块 → 白屏且重装无效」。
    // ?v= 保留用于穿透中间层缓存，不再承担新鲜度职责。
    return 'no-cache';
  }
  return 'public, max-age=300';
}
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.stat(filePath, (statErr, st) => {
    if (statErr || !st || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    const etag = 'W/"' + st.size + '-' + Number(st.mtimeMs || st.mtime.getTime()) + '"';
    const inm = res.req && res.req.headers && res.req.headers['if-none-match'];
    if (inm && inm === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': staticCacheControlForPath(filePath),
      });
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'text/plain',
        'Cache-Control': staticCacheControlForPath(filePath),
        'ETag': etag,
      });
      res.end(data);
    });
  });
}
function serveIndexHtml(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const inject = '<script>window.__MINERADIO_API_TOKEN__=' + JSON.stringify(API_TOKEN) + ';</script>';
    const out = html.includes('<head>')
      ? html.replace('<head>', '<head>' + inject)
      : (html.includes('</head>') ? html.replace('</head>', inject + '</head>') : inject + html);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
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
// ---------- 更新 / 补丁 / 镜像：实现见 server/lib/update-{manifest,service}.js ----------
// 纯逻辑（版本/镜像/manifest/latest.yml/摘要）与执行层（下载/校验/落盘/任务态）分文件，
// 函数名与拆分前一致并在上方解构回同名 → 所有调用点零改动。

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
    // 上限防御：每个任务都要下载整条播客流做节奏分析，排队过多会堆积 IO/CPU
    if (djAnalyzeQueue.length >= 4) {
      reject(new Error('DJ_ANALYZE_BUSY'));
      return;
    }
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
// 音质候选模板与 VKEY 超时已随 QQ 协议族移到 server/lib/qq-content.js。
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
const SEARCH_RESULT_POSITIVE_TTL_MS = 10 * 60 * 1000;
const SEARCH_RESULT_NEGATIVE_TTL_MS = 60 * 1000;
const SEARCH_RESULT_CACHE_MAX = 128;
const searchResultCache = new Map();
const searchResultInflight = new Map();

function searchResultCacheKey(keywords, limit) {
  return String(keywords || '').trim().toLowerCase() + '|' + String(limit || 30) + '|' + (userCookie ? '1' : '0');
}
function readTtlCache(map, key, posTtl, negTtl) {
  const entry = map.get(key);
  if (!entry) return null;
  const ttl = entry.negative ? negTtl : posTtl;
  if (Date.now() - entry.at > ttl) {
    map.delete(key);
    return null;
  }
  return entry;
}
function writeTtlCache(map, key, value, negative, maxSize) {
  map.set(key, { at: Date.now(), value: value, negative: !!negative });
  while (map.size > (maxSize || 128)) map.delete(map.keys().next().value);
}

async function handleSearch(keywords, limit) {
  const key = searchResultCacheKey(keywords, limit);
  const cached = readTtlCache(searchResultCache, key, SEARCH_RESULT_POSITIVE_TTL_MS, SEARCH_RESULT_NEGATIVE_TTL_MS);
  if (cached) return cached.value;
  if (searchResultInflight.has(key)) return searchResultInflight.get(key);

  const job = (async () => {
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

    writeTtlCache(searchResultCache, key, mapped, !mapped.length, SEARCH_RESULT_CACHE_MAX);
    return mapped;
  })();

  searchResultInflight.set(key, job);
  try {
    return await job;
  } finally {
    searchResultInflight.delete(key);
  }
}
// ---------- 网易同曲匹配：实现见 server/lib/netease-source-match.js ----------
// 判分/缓存纯逻辑与「打上游找候选」同处一个域；函数名与拆分前一致并在此解构回同名。
const neteaseSourceMatch = require("./server/lib/netease-source-match")({
  promiseWithTimeout, cloudsearch, song_detail, mapSongRecord,
  getUserCookie: () => userCookie,
});
const {
  neteaseSourceMatchText, neteaseSourceMatchDurationMs, neteaseSourceMatchArtists, neteaseSourceMatchVersionTokens, neteaseSourceMatchMediaProfiles, neteaseSourceMatchFingerprintCount, neteaseSourceMatchArtistSetEqual, neteaseSourceMatchCandidateScore, neteaseSourceMatchCacheKey, readNeteaseSourceMatchCache, writeNeteaseSourceMatchCache, neteaseSourceMatchHintArtists, mergeNeteaseSourceMatchSong, findNeteaseSameTrackCandidates,
  NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS,
} = neteaseSourceMatch;

// 每日推荐映射：全量保序，过滤无效项；截断交给前端虚拟化渲染
function mapDailyRecommendationSongs(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(song => mapSongRecord(song))
    .filter(Boolean);
}

const DISCOVER_HOME_TTL_MS = 3 * 60 * 1000;
const discoverHomeCache = new Map();
const discoverHomeInflight = new Map();

async function handleDiscoverHome(opts) {
  opts = opts || {};
  const info = await getLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  if (!loggedIn) {
    return {
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      dailySongTotal: 0,
      dailySongsComplete: true,
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  const cacheKey = String(info.userId || 'user') + '|' + (userCookie ? crypto.createHash('md5').update(String(userCookie)).digest('hex').slice(0, 10) : '0');
  if (!opts.force) {
    const cached = readTtlCache(discoverHomeCache, cacheKey, DISCOVER_HOME_TTL_MS, DISCOVER_HOME_TTL_MS);
    if (cached) return cached.value;
    if (discoverHomeInflight.has(cacheKey)) return discoverHomeInflight.get(cacheKey);
  }

  const job = (async () => {
    // 播客推荐已下线（前端按需走 /api/podcast/hot）；日推全量返回，前端虚拟化负责窗口化
    const tasks = [
      personalized({ limit: 8, cookie: userCookie, timestamp: Date.now() }),
      recommend_resource({ cookie: userCookie, timestamp: Date.now() }),
      recommend_songs({ cookie: userCookie, timestamp: Date.now() }),
    ];
    const result = await Promise.allSettled(tasks);

    const personalizedBody = result[0].status === 'fulfilled' && result[0].value && result[0].value.body || {};
    const publicPlaylists = (personalizedBody.result || personalizedBody.data || [])
      .map(pl => mapDiscoverPlaylist(pl, '推荐歌单'))
      .filter(pl => pl.id && pl.name)
      .slice(0, 8);

    let privatePlaylists = [];
    if (result[1].status === 'fulfilled' && result[1].value) {
      const body = result[1].value.body || {};
      const raw = body.recommend || body.data || [];
      privatePlaylists = (Array.isArray(raw) ? raw : [])
        .map(pl => mapDiscoverPlaylist(pl, '私人推荐'))
        .filter(pl => pl.id && pl.name)
        .slice(0, 6);
    }

    let dailySongs = [];
    if (result[2].status === 'fulfilled' && result[2].value) {
      const body = result[2].value.body || {};
      const raw = body.data && (body.data.dailySongs || body.data.recommend) || body.recommend || [];
      dailySongs = mapDailyRecommendationSongs(raw);
    }

    const payload = {
      loggedIn,
      user: loggedIn ? { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' } : null,
      dailySongs,
      dailySongTotal: dailySongs.length,
      dailySongsComplete: true,
      playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
      podcasts: [],
      updatedAt: Date.now(),
    };
    writeTtlCache(discoverHomeCache, cacheKey, payload, false, 16);
    return payload;
  })();

  discoverHomeInflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    discoverHomeInflight.delete(cacheKey);
  }
}

// QQ_MUSICU_URL / QQ_SMARTBOX_URL / QQ_HEADERS 已随 QQ 协议族移到 server/lib/qq-session.js。
const KUGOU_GATEWAY_URL = 'https://gateway.kugou.com';
const KUGOU_LOGIN_BASE_URL = 'https://login-user.kugou.com';
const KUGOU_USER_SERVICE_URL = 'https://userservice.kugou.com';
const KUGOU_QR_APPID = '1001';
const KUGOU_QR_SRC_APPID = '2919';
const KUGOU_PLAY_KEY_SALT = 'kgcloudv2';
const KUGOU_DEFAULT_MID = crypto.createHash('md5').update((process.env.COMPUTERNAME || 'mineradio') + ':kugou').digest('hex');
const kugouVipProbe = { current: { userId: '', checkedAt: 0, info: null } };

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

// ---------- 天气电台（实现已拆到 server/lib/weather-radio.js）----------
// 依赖显式注入；返回的函数名与拆分前完全一致，调用点无需改动。
const {
  buildRadioFromMood,
  buildWeatherMood,
  buildWeatherRadio,
  clampNumber,
  cleanWeatherPlaceLabel,
  diversifyWeatherSongs,
  fallbackWeatherForRadio,
  fetchIpWeatherLocation,
  fetchIpWeatherLocationFromIpApi,
  fetchIpWeatherLocationFromIpApiCo,
  fetchIpWeatherLocationFromIpWho,
  fetchOpenMeteoWeather,
  fetchWeatherPlaylistSongs,
  filterLikelyPlayableWeatherSongs,
  formatBigDataCloudLabel,
  formatNominatimLabel,
  isGenericWeatherLocationName,
  isLowSignalWeatherSong,
  normalizeIpWeatherLocation,
  openMeteoWeatherLabel,
  orderWeatherSongs,
  resolveOpenMeteoLocation,
  resolveWeatherLocationLabel,
  reverseBigDataCloudLocation,
  reverseNominatimLocation,
  scoreWeatherSong,
  tagWeatherPoolSongs,
  uniqueSongsByKey,
  uniqueWeatherTitles,
  weatherArtistKey,
  weatherRadioSeedQueries,
  weatherTitleKey,
} = require('./server/lib/weather-radio')({
  UA,
  requestJson,
  handleSearch,
  handleSongUrl,
  playlistDetail: playlist_detail,
  playlistTrackAll: playlist_track_all,
  mapSongRecord,
  getUserCookie: () => userCookie,
});

// ---------- QQ 协议族：实现见 server/lib/qq-{session,content}.js ----------
// session = JSONP/musicu 请求 + VIP 探测 + cookie 刷新链 + 登录态；content = 歌单/曲目/搜索/取址/评论/歌词。
// 单向依赖 content → session；对外函数名与拆分前一致并在此解构回同名，
// routeCtx 与 server/routes/{audio,netease}.js 的调用点零改动。
// 放在场景电台注入**之前**：scene-radio 的 deps 里有 handleQQSearch，晚于此会 TDZ。
// qqCookie / qqCookieEpoch 是下面的 let → getter；readCookieFile 也是 let → 调用转发。
const qqSession = require("./server/lib/qq-session")({
  QQ_COOKIE_FILE, UA, getQQCookie, getQQCookieEpoch, setQQCookie,   // setQQCookie 定义在 cookie getter 区
  readCookieFile: (...args) => readCookieFile(...args),
  saveQQCookie, serializeCookieObject, withQQCookieWriteLock,
  qqCookieObject, qqCookieUin, qqCookieMusicKey, qqCookiePlaybackKey,
  qqCookieNickname, qqCookieAvatar, decodeQQCookieValue, requestText,
  normalizeQQVipPayloadStrict, resolveQQVipFromProbes, qqVipSessionCacheKey,
  qqVipCacheTtlMs, qqVipEntitlementRights, preserveQQVipStalePositive, qqVipObjectLooksExpiredStrict,
});
const {
  parseJSONText, getQQCookieFile, getQQLoginInfo,
  refreshQQConfiguredCookieStore, refreshQQCookieSession,
} = qqSession;

const qqContent = require("./server/lib/qq-content")({
  classifyQQPlaybackRestriction, normalizeQualityPreference, qualityCandidatesFrom,
  isQQFavoritePlaylist, isQzoneBackgroundPlaylist, requestText,
  qqCookieObject, qqCookieUin, qqCookieMusicKey, qqCookiePlaybackKey,
  session: qqSession,
});
const {
  handleQQSearch, handleQQUserPlaylists, handleQQPlaylistTracks,
  handleQQArtistDetail, handleQQSongUrl, handleQQSongComments, handleQQLyric,
} = qqContent;

// 场景预设表：原先夹在天气代码中间，拆分后随场景块一起放回语义位置。
// ---------- 场景电台：实现见 server/lib/scene-radio.js ----------
// SCENE_PRESETS 与 12 个场景函数同处一个模块；函数名/常量名与拆分前一致并在此解构回同名。
const sceneRadio = require("./server/lib/scene-radio")({
  handleSearch,
  handleKugouSearch,
  handleQQSearch,
  handleQishuiSearch,
  qishuiCookieHasLogin,
  weatherArtistKey,
  getKugouCookie,
  getQishuiCookie,
  getQQCookie,
});
const {
  sceneRadioBucket, sceneRotateSeed, sceneShuffle, sceneKeywordCandidates, sceneRadioProviders, searchSceneProvider, isLowSignalSceneSong, sceneSongKey, normalizeSceneText, sceneEchoFamily, buildSceneRadioSongs, buildSceneRadio,
  SCENE_PRESETS,
} = sceneRadio;

// QQ 协议族（会话层 + 内容层）已拆到 server/lib/qq-{session,content}.js，注入点在上方场景电台之前。

// ---------- 媒体代理 / 鉴权 / 汽水音频解密：实现见 server/lib/{media-proxy,qishui-audio}.js ----------
// 两个模块单向依赖（qishui-audio → media-proxy），对外函数名与拆分前一致并在此解构回同名，
// 因此 routeCtx 与 server/routes/{audio,netease}.js 的调用点零改动。
// API_TOKEN 是下面的 let（ensureApiToken 会重新赋值）→ 以 getter 注入；
// 汽水解密 worker 的脚本路径含 __dirname → 以 workerPath 注入，避免 __dirname 跟着文件搬家。
const mediaProxy = require("./server/lib/media-proxy")({
  dns, fetchWithTimeout, UA, PROXY_FETCH_TIMEOUT_MS, API_AUTH_QUERY_TOKEN_PATHS,
  getApiToken: () => API_TOKEN,
});
const {
  assertProxyableMediaUrl, fetchProxiedMedia, assertApiAuth,
  audioProxyHeadersFor, audioContentTypeForUrl, sendAudioBuffer,
} = mediaProxy;

const qishuiAudio = require("./server/lib/qishui-audio")({
  workerPath: path.join(__dirname, 'qishui-audio-decryptor', 'decrypt-worker.js'),
  crypto, Worker, TrackDecryptor, mediaProxy,
});
const { qishuiAudioAuthFromUrl, getQishuiDecryptedAudio } = qishuiAudio;

// （QQ 歌单映射已随协议族移出）
// ---------- 酷狗协议族：实现见 server/lib/kugou-{protocol,service}.js ----------
// 协议底层（签名/设备/cookie 头/gateway）与业务编排（登录/歌单/映射/取址）分文件，
// 两层互不引用；函数名与拆分前一致并在此解构回同名 → 所有调用点零改动。
const kugouProtocol = require("./server/lib/kugou-protocol")({
  KUGOU_DEFAULT_MID,
  KUGOU_GATEWAY_URL,
  KUGOU_ID,
  getKugouCookie,
  kugouApiCloudlistRequest,
  kugouCookieObject,
  kugouCookieToken,
  kugouCookieUserId,
  kugouSignatureAndroidParams,
  kugouVipProbe,
  parseJSONText,
  requestBuffer,
  requestText,
  saveKugouCookie,
  serializeCookieObject,
});
const kugouService = require("./server/lib/kugou-service")({
  KUGOU_ID,
  KUGOU_LOGIN_BASE_URL,
  KUGOU_PLAY_KEY_SALT,
  KUGOU_QR_APPID,
  KUGOU_QR_SRC_APPID,
  QRCode,
  UA,
  getKugouCookie,
  getKugouLoginInfo,
  getKugouLoginInfoFromApi,
  kugouCookieObject,
  kugouCookieToken,
  kugouCookieUserId,
  kugouCookieVipType,
  kugouVipProbe,
  normalizeQualityPreference,
  parseJSONText,
  playbackRestriction,
  protocol: kugouProtocol,
  registerKugouCloudDevice,
  requestText,
  serializeCookieObject,
});
const {
  kugouMd5,
  kugouAndroidSignature,
  kugouWebSignature,
  kugouRandomString,
  kugouCalculateMid,
  kugouInitDevice,
  saveKugouAuth,
  kugouCookieMid,
  kugouCookieDfid,
  kugouCookieHeader,
  kugouCloudlistCookieHeader,
  kugouGatewayRequest,
  kugouCloudlistRequest,
  kugouSafeGet,
  kugouDeepFind,
  handleKugouLoginQrKey,
  kugouRegisterDevice,
  handleKugouLoginQrCheck,
  asArrayDeep,
  mapKugouPlaylist,
  cleanKugouTrackText,
  normalizeSimpleTitleForCompare,
  mapKugouTrack,
  kugouHashForQuality,
  sortKugouCloudTracks,
  handleKugouUserPlaylists,
  handleKugouPlaylistTracks,
  kugouTrackercdnPlayUrl,
  kugouPlayableUrlFromResponse,
  getKugouLoginInfoFresh,
  handleKugouSongUrl,
} = Object.assign({}, kugouProtocol, kugouService);

// （QQ 曲目/搜索/取址/评论/歌词已随协议族移出）

// ---------- 播客映射：实现见 server/lib/podcast-map.js ----------
// 7 个函数同处一个模块；对外的 4 个在此解构回同名，routeCtx 与 server/routes/netease.js 零改动。
// userCookie 是下面的 let → 以 getter 注入。
const podcastMap = require("./server/lib/podcast-map")({
  mapArtists, dj_sublist, user_audio, dj_paygift, record_recent_voice, sati_resource_sub_list,
  getUserCookie,
});
const {
  mapPodcastRadio, mapPodcastProgram, podcastCollectionMeta, fetchMyPodcastItems,
} = podcastMap;

// ---------- 业务: 取歌曲URL (探测试听) ----------
//   返回 { url, trial, level, br }
//   trial=true 表示这是试听片段 (freeTrialInfo 非空)
const QQ_AUDIO_PROBE_ATTEMPT_MS = 2000;
const QQ_AUDIO_PROBE_TOTAL_MS = 6200;
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
  return probePlaybackAudioUrl(audioUrl, timeoutMs || QQ_AUDIO_PROBE_TOTAL_MS);
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

const SONG_URL_POSITIVE_TTL_MS = 5 * 60 * 1000;
const SONG_URL_NEGATIVE_TTL_MS = 45 * 1000;
const SONG_URL_CACHE_MAX = 256;
const songUrlCache = new Map();
const songUrlInflight = new Map();

function songUrlCacheKey(id, loginInfo, qualityPreference, matchHints) {
  const hints = matchHints || {};
  const cookieMark = userCookie ? crypto.createHash('md5').update(String(userCookie)).digest('hex').slice(0, 10) : '0';
  return [
    String(id || ''),
    qualityPreference || 'standard',
    loginInfo && loginInfo.loggedIn ? '1' : '0',
    cookieMark,
    hints.skipDirect ? '1' : '0',
    String(hints.name || hints.title || '').slice(0, 40),
    String(hints.artist || '').slice(0, 40),
  ].join('|');
}

async function handleSongUrl(id, loginInfo, qualityPreference, matchHints) {
  const hints = matchHints || {};
  const cacheKey = songUrlCacheKey(id, loginInfo, qualityPreference, hints);
  // 带匹配提示的同曲回退结果也缓存；成功 URL 正缓存，失败短负缓存
  const cached = readTtlCache(songUrlCache, cacheKey, SONG_URL_POSITIVE_TTL_MS, SONG_URL_NEGATIVE_TTL_MS);
  if (cached) return cached.value;
  if (songUrlInflight.has(cacheKey)) return songUrlInflight.get(cacheKey);

  const job = (async () => {
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
    let payload;
    if (direct && direct.url && !direct.trial) {
      payload = direct;
    } else {
      const sourceMatchAttempted = !!(String(hints.name || hints.title || '').trim() && String(hints.artist || '').trim());
      const matched = await resolveNeteaseSameTrackPlayback(id, loginInfo, qualityPreference, hints, requestDeadline);
      if (!matched) payload = Object.assign({}, direct, { sourceMatchAttempted });
      else {
        payload = Object.assign({}, matched.playback, {
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
    }
    const ok = !!(payload && payload.url && !payload.trial);
    writeTtlCache(songUrlCache, cacheKey, payload, !ok, SONG_URL_CACHE_MAX);
    return payload;
  })();

  songUrlInflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    songUrlInflight.delete(cacheKey);
  }
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
// 登录信息缓存：每次取播放地址都会调用 getLoginInfo，缓存避免每首歌多打 1-2 次上游登录接口
const NETEASE_LOGIN_INFO_TTL_MS = 30000;
let neteaseLoginInfoCache = { at: 0, value: null, promise: null };
function invalidateNeteaseLoginInfoCache() {
  neteaseLoginInfoCache.at = 0;
  neteaseLoginInfoCache.value = null;
}
async function getLoginInfo() {
  const now = Date.now();
  if (neteaseLoginInfoCache.promise) return neteaseLoginInfoCache.promise; // in-flight 合并
  if (neteaseLoginInfoCache.value && now - neteaseLoginInfoCache.at < NETEASE_LOGIN_INFO_TTL_MS) {
    return neteaseLoginInfoCache.value;
  }
  neteaseLoginInfoCache.promise = (async () => {
    try {
      const info = await getLoginInfoUncached();
      neteaseLoginInfoCache.value = info;
      neteaseLoginInfoCache.at = Date.now();
      return info;
    } finally {
      neteaseLoginInfoCache.promise = null;
    }
  })();
  return neteaseLoginInfoCache.promise;
}
async function getLoginInfoUncached() {
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
  qqCookieUin, qqCookieMusicKey, saveQQCookie, bumpQQCookieEpoch, withQQCookieWriteLock, refreshQQCookieSession, refreshQQConfiguredCookieStore, getQQCookieFile,
  handleQQUserPlaylists, handleQQPlaylistTracks, handleQQArtistDetail, handleQQSongComments,
  // ---- kugou ----
  getKugouLoginInfoFresh, getKugouLoginInfo, handleKugouLoginQrKey, handleKugouLoginQrCheck,
  normalizeKugouCookieInput, saveKugouCookie,
  handleKugouSearch,
  handleKugouUserPlaylists, handleKugouPlaylistTracks, handleKugouSongUrl, handleKugouLyric, handleKugouGuessLike,
  handleKugouLikeCheck, handleKugouLikeToggle, handleKugouPlaylistAddSong,
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

// ---------- HTTP 分发：实现见 server/lib/http-server.js ----------
// CORS / OPTIONS / token 鉴权 / 9 个路由模块轮询 / 着色器市场 / 静态资源都已搬进该模块。
// routeCtx（下面那张聚合表）与 routeMatchers 留在本文件：它们是「表里有什么」的清单。
// userCookie 是 let → getter；API_TOKEN_AUTO 由 ensureApiToken() 赋值 → getter；
// __dirname（build/icon.ico、public/）→ 以 appRoot 注入，避免 __dirname 跟着文件搬家。
const httpServer = require("./server/lib/http-server")({
  http, PORT, HOST, appRoot: __dirname,
  routeCtx, routeMatchers,
  sendJSON, assertApiAuth, serveStatic, serveIndexHtml,
  getUserCookie: () => userCookie,
  getApiTokenAuto: () => API_TOKEN_AUTO,
  nativeDjAvailable,
});
const { server, startHttpServer } = httpServer;

if (require.main === module) {
  startHttpServer();
}

module.exports = server;
module.exports.configureCookieStorage = configureCookieStorage;
module.exports.getApiToken = () => API_TOKEN;
module.exports.startHttpServer = startHttpServer;
