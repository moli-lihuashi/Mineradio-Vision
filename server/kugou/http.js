'use strict';

// 酷狗：缓存实例 / 请求封装 / 设备签名 / cookie 解析 / 设备注册(dfid) / 网关请求。
//
// 第 1 刀从 kugou-api.js 抽出。单向依赖 config + mapping ——
// mapping 只做纯归一，不认识网络；本模块只负责「把请求发出去、把 cookie 读懂」。

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const { requestText } = require('../lib/http-request');

const {
  KUGOU_HEADERS,
  KUGOU_GATEWAY,
  KUGOU_APPID,
  KUGOU_WEB_APPID,
  KUGOU_CLIENTVER,
  KUGOU_ANDROID_SALT,
  KUGOU_H5_SALT,
  KUGOU_H5_SRC_APPID,
  KUGOU_H5_CLIENTVER,
  KUGOU_SIGN_KEY_SALT,
  KUGOU_GATEWAY_UA,
  KUGOU_H5_UA,
  KUGOU_REGISTER_RSA_PUBLIC_KEY,
  KUGOU_LITE_APPID,
  KUGOU_LITE_CLIENTVER,
  KUGOU_LITE_ANDROID_SALT,
  KUGOU_LITE_GATEWAY_UA,
} = require('./config');

const {
  decodeKugouDisplayText,
  firstPositiveKugouNumber,
  kugouObjectHasMembershipSignal,
} = require('./mapping');

function createKugouTtlCache(maxEntries, defaultTtlMs) {
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
    async wrap(key, ttlMs, fn) {
      const cached = this.get(key);
      if (cached !== null) return cached;
      if (inflight.has(key)) return inflight.get(key);
      const promise = Promise.resolve().then(fn).then((value) => {
        const resolvedTtl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
        this.set(key, value, resolvedTtl);
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },
  };
}

const kugouSearchCache = createKugouTtlCache(120, 2 * 60 * 1000);

const kugouSongUrlCache = createKugouTtlCache(240, 15 * 60 * 1000);

const kugouPlaylistTracksCache = createKugouTtlCache(24, 5 * 60 * 1000);

const kugouProfileCache = createKugouTtlCache(24, 5 * 60 * 1000);

const kugouVipCache = createKugouTtlCache(24, 5 * 60 * 1000);

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  return JSON.parse(text);
}

function createKugouMid(seed) {
  const raw = String(seed || Date.now()) + Math.random();
  return crypto.createHash('md5').update(raw).digest('hex');
}

function kugouCloudKey(hash) {
  return crypto.createHash('md5').update(String(hash || '') + 'kgcloud').digest('hex');
}

function parseCookieString(cookie) {
  const out = {};
  String(cookie || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function kugouCookieObject(cookie) {
  return parseCookieString(cookie);
}

function sanitizeCookieValue(value) {
  // 移除 HTTP 头非法字符 (非 ASCII 可打印字符和 tab)
  // 酷狗 cookie 的 KuGoo 复合值可能含解码后的中文昵称等非 ASCII 字符，
  // 导致 Node.js http.request 抛 "Invalid character in header content"
  return String(value || '').replace(/[^\x20-\x7E\x09]/g, '').trim();
}

function buildKugouRequestCookie(cookie) {
  const obj = kugouCookieObject(cookie);
  const mid = obj.kg_mid || obj.KG_MID || createKugouMid('mineradio');
  const dfid = obj.kg_dfid || obj.KG_DFID || '-';
  const parts = [];
  if (cookie) parts.push(String(cookie).trim());
  if (!obj.kg_mid && !obj.KG_MID) parts.push('kg_mid=' + mid);
  if (!obj.kg_dfid && !obj.KG_DFID) parts.push('kg_dfid=' + dfid);
  const merged = {};
  parts.join('; ').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    merged[part.slice(0, idx).trim()] = sanitizeCookieValue(part.slice(idx + 1));
  });
  return Object.keys(merged).map(k => `${k}=${merged[k]}`).join('; ');
}

function parseKuGooCompound(raw) {
  const out = {};
  let text = String(raw || '').trim();
  if (!text) return out;
  try { text = decodeURIComponent(text); } catch (_) {}
  text.split('&').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function signKey(hash, mid, userid, appid) {
  return crypto.createHash('md5').update(`${hash}${KUGOU_SIGN_KEY_SALT}${appid || KUGOU_APPID}${mid}${userid || 0}`).digest('hex');
}

function kugouSignParamsKey(clienttime) {
  // 与 KuGouMusicApi signParamsKey 对齐: MD5(appid + salt + clientver + data)
  return crypto.createHash('md5').update(`${KUGOU_APPID}${KUGOU_ANDROID_SALT}${KUGOU_CLIENTVER}${clienttime}`).digest('hex');
}

function signatureAndroidParams(params, data, saltOverride) {
  const salt = saltOverride || KUGOU_ANDROID_SALT;
  const paramsString = Object.keys(params).sort()
    .map(key => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return crypto.createHash('md5').update(`${salt}${paramsString}${data || ''}${salt}`).digest('hex');
}

function signatureH5Params(params, bodyObj) {
  const parts = Object.keys(params).sort().map(key => `${key}=${params[key]}`);
  if (bodyObj && typeof bodyObj === 'object') parts.push(JSON.stringify(bodyObj));
  return crypto.createHash('md5').update(`${KUGOU_H5_SALT}${parts.join('')}${KUGOU_H5_SALT}`).digest('hex');
}

function buildKugouH5Params(auth, extra) {
  auth = auth || {};
  const now = Date.now();
  return Object.assign({
    srcappid: KUGOU_H5_SRC_APPID,
    clientver: KUGOU_H5_CLIENTVER,
    clienttime: now,
    mid: auth.mid || createKugouMid('gateway'),
    uuid: now,
    dfid: auth.dfid || '-',
    appid: KUGOU_WEB_APPID,
    token: auth.token || '',
    userid: auth.userid ? Number(auth.userid) : 0,
  }, extra || {});
}

function buildKugouGatewayParams(auth, extra) {
  auth = auth || {};
  const clienttime = Math.floor(Date.now() / 1000);
  return Object.assign({
    dfid: auth.dfid || '-',
    mid: auth.mid || createKugouMid('gateway'),
    uuid: '-',
    appid: KUGOU_APPID,
    clientver: KUGOU_CLIENTVER,
    clienttime,
    token: auth.token || '',
    userid: auth.userid || 0,
  }, extra || {});
}

function kugouGatewayError(json, path) {
  const statusText = json && json.status !== undefined && json.status !== null ? `(status=${json.status})` : '';
  const errCodeText = [json && json.error_code, json && json.errcode]
    .filter(v => v !== undefined && v !== null && String(v) !== '0').map(v => `code=${v}`).join(' ');
  const msg = json && (json.error || json.msg || json.message) || '';
  let text = (msg || `KUGOU_GATEWAY_FAILED${statusText}${errCodeText ? ' ' + errCodeText : ''}`).trim();
  if (!msg && json && typeof json === 'object') {
    try { text += ' body=' + JSON.stringify(json).slice(0, 200); } catch (_) {}
  }
  const err = new Error(text);
  err.body = json;
  try { console.warn('[KugouGateway]', path || '', JSON.stringify(json).slice(0, 400)); } catch (_) {}
  return err;
}

var kugouDfidCache = '';

var kugouDfidPending = null;

var kugouDfidPersistHook = null;

function setKugouDfidPersistHook(fn) {
  kugouDfidPersistHook = typeof fn === 'function' ? fn : null;
}

function kugouRandomSeed(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function kugouRegisterAesKeyIV(seed) {
  const md5 = crypto.createHash('md5').update(seed).digest('hex');
  return { key: md5.substring(0, 16), iv: md5.substring(16, 32) };
}

async function registerKugouCloudDevice(cookie) {
  const auth = extractKugouAuth(cookie);
  const guid = String(kugouCookieObject(cookie).KUGOU_API_GUID || auth.mid || '').trim();
  const dataMap = {
    availableRamSize: 4983533568, availableRomSize: 48114719, availableSDSize: 48114717,
    basebandVer: '', batteryLevel: 100, batteryStatus: 3,
    brand: 'Redmi', buildSerial: 'unknown', device: 'marble',
    imei: guid, imsi: '', manufacturer: 'Xiaomi', uuid: guid,
    accelerometer: false, accelerometerValue: '', gravity: false, gravityValue: '',
    gyroscope: false, gyroscopeValue: '', light: false, lightValue: '',
    magnetic: false, magneticValue: '', orientation: false, orientationValue: '',
    pressure: false, pressureValue: '', step_counter: false, step_counterValue: '',
    temperature: false, temperatureValue: '',
  };
  const seed = kugouRandomSeed(6);
  const { key: aesKey, iv: aesIV } = kugouRegisterAesKeyIV(seed);
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(aesKey, 'utf8'), Buffer.from(aesIV, 'utf8'));
  const aesStr = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(dataMap), 'utf8')), cipher.final()]).toString('base64');
  const rsaPayload = JSON.stringify({ aes: seed, uid: Number(auth.userid) || 0, token: auth.token });
  const p = crypto.publicEncrypt(
    { key: KUGOU_REGISTER_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(rsaPayload, 'utf8'),
  ).toString('hex');

  const params = buildKugouGatewayParams(auth, { part: 1, platid: 1, p });
  // 注册也用 lite 客户端身份，与登录会话保持一致
  params.appid = KUGOU_LITE_APPID;
  params.clientver = KUGOU_LITE_CLIENTVER;
  params.signature = signatureAndroidParams(params, aesStr, KUGOU_LITE_ANDROID_SALT);
  const u = new URL('/risk/v2/r_register_dev', 'https://userservice.kugou.com');
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const headers = Object.assign({}, KUGOU_HEADERS, {
    'User-Agent': KUGOU_LITE_GATEWAY_UA,
    'Content-Type': 'application/json',
    Cookie: buildKugouRequestCookie(cookie),
  });
  const bodyBuf = await new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(12000, () => req.destroy(new Error('KUGOU_REGISTER_TIMEOUT')));
    req.on('error', reject);
    req.write(aesStr);
    req.end();
  });
  let json = null;
  const plain = bodyBuf.toString('utf8');
  if (plain.trim().startsWith('{')) {
    // 错误/风控响应是明文 JSON；成功响应才是 AES 密文（与 server.js 的注册实现一致）
    try { json = JSON.parse(plain); } catch (_) { json = null; }
  }
  if (!json) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(aesKey, 'utf8'), Buffer.from(aesIV, 'utf8'));
    json = JSON.parse(Buffer.concat([decipher.update(bodyBuf), decipher.final()]).toString('utf8'));
  }
  if (json && json.status === 1 && json.data && json.data.dfid) return String(json.data.dfid);
  throw new Error('KUGOU_REGISTER_DEV_FAILED ' + JSON.stringify(json).slice(0, 160));
}

async function ensureKugouDfid(cookie) {
  if (kugouDfidCache) return kugouDfidCache;
  if (kugouDfidPending) return kugouDfidPending;
  const existing = kugouCookieObject(cookie);
  const present = existing.kg_dfid || existing.KG_DFID || existing.dfid || existing.DFID;
  if (present && present !== '-') {
    kugouDfidCache = String(present).trim();
    return kugouDfidCache;
  }
  kugouDfidPending = registerKugouCloudDevice(cookie)
    .then((dfid) => {
      kugouDfidCache = dfid;
      kugouDfidPending = null;
      try { if (kugouDfidPersistHook) kugouDfidPersistHook(dfid); } catch (_) {}
      return dfid;
    })
    .catch((e) => { kugouDfidPending = null; throw e; });
  return kugouDfidPending;
}

async function kugouWithCloudlistDevice(opts) {
  // 本 helper 仅由 cloudlist / 需设备身份的网关调用；旧实现要求 opts.router 才注册，
  // 但调用方只写了 headers['x-router']、从未设 opts.router → ensureKugouDfid 整段死代码，缺 dfid 时回落到 '-' 触发 20017。
  opts = opts || {};
  const dfid = await ensureKugouDfid(opts.cookie || '');
  if (dfid) {
    opts.cookie = (opts.cookie ? String(opts.cookie) + '; ' : '') + 'kg_dfid=' + dfid + '; dfid=' + dfid;
  }
}

async function kugouCloudlistRequest(path, opts) {
  opts = opts || {};
  opts.router = 'cloudlist.service.kugou.com';
  await kugouWithCloudlistDevice(opts);
  const auth = extractKugouAuth(opts.cookie || '');
  if (!auth.playbackReady) throw new Error('KUGOU_AUTH_REQUIRED');
  const clienttime = Math.floor(Date.now() / 1000);
  const params = Object.assign({
    dfid: auth.dfid || '-',
    mid: auth.mid,
    uuid: '-',
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_CLIENTVER,
    clienttime,
    userid: auth.userid,
    token: auth.token,
  }, opts.params || {});
  const dataString = opts.body == null ? '' : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  params.signature = signatureAndroidParams(params, dataString, KUGOU_LITE_ANDROID_SALT);
  const u = new URL(path, KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const headers = Object.assign({}, KUGOU_HEADERS, {
    'User-Agent': KUGOU_LITE_GATEWAY_UA,
    'x-router': 'cloudlist.service.kugou.com',
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    dfid: params.dfid,
    mid: params.mid,
    clienttime: String(clienttime),
    Cookie: buildKugouRequestCookie(opts.cookie || ''),
  });
  if (dataString) headers['Content-Type'] = 'application/json';
  const json = await requestJson(u.toString(), { method: 'POST', headers }, dataString || undefined);
  if (json && Number(json.status) === 0) throw kugouGatewayError(json, path);
  return json;
}

async function kugouH5GatewayRequest(path, opts) {
  opts = opts || {};
  await kugouWithCloudlistDevice(opts);
  const auth = extractKugouAuth(opts.cookie || '');
  if (!auth.playbackReady) throw new Error('KUGOU_AUTH_REQUIRED');
  const bodyObj = opts.body == null ? null : (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body);
  const bodyText = bodyObj == null ? '' : JSON.stringify(bodyObj);
  const params = buildKugouH5Params(auth, opts.params || {});
  params.signature = signatureH5Params(params, bodyObj);
  const u = new URL(path, opts.baseURL || KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const headers = Object.assign({}, KUGOU_HEADERS, {
    'User-Agent': KUGOU_H5_UA,
    Cookie: buildKugouRequestCookie(opts.cookie || ''),
  }, opts.headers || {});
  if (opts.router) headers['x-router'] = opts.router;
  const json = await requestJson(u.toString(), { method: opts.method || (bodyObj == null ? 'GET' : 'POST'), headers }, bodyText || undefined);
  if (json && Number(json.status) === 0) {
    throw kugouGatewayError(json, path);
  }
  return json;
}

async function kugouGatewayRequest(path, opts) {
  opts = opts || {};
  await kugouWithCloudlistDevice(opts);
  const auth = extractKugouAuth(opts.cookie || '');
  if (!auth.playbackReady) throw new Error('KUGOU_AUTH_REQUIRED');
  const body = opts.body == null ? '' : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  const params = buildKugouGatewayParams(auth, opts.params || {});
  if (!opts.skipSignature) params.signature = signatureAndroidParams(params, body);
  const u = new URL(path, opts.baseURL || KUGOU_GATEWAY);
  Object.keys(params).forEach(key => u.searchParams.set(key, String(params[key])));
  const headers = Object.assign({}, KUGOU_HEADERS, {
    'User-Agent': KUGOU_GATEWAY_UA,
    dfid: auth.dfid || '-',
    mid: auth.mid,
    clienttime: String(params.clienttime),
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    Cookie: buildKugouRequestCookie(opts.cookie || ''),
  }, opts.headers || {});
  if (opts.router) headers['x-router'] = opts.router;
  if (body) headers['Content-Type'] = 'application/json';
  const json = await requestJson(u.toString(), { method: opts.method || 'GET', headers }, body || undefined);
  if (json && Number(json.status) === 0) {
    throw kugouGatewayError(json, path);
  }
  return json;
}

function extractKugouAuth(cookie) {
  const obj = kugouCookieObject(cookie);
  const kugoo = parseKuGooCompound(obj.KuGoo || obj.kugou || obj.Kugou || '');
  const userid = String(
    obj.userid || obj.UserId || obj.KugooID || obj.kugouID ||
    kugoo.KugooID || kugoo.kugouID || kugoo.userid || kugoo.uid || ''
  ).replace(/\D/g, '');
  const token = String(obj.token || obj.Token || obj.t || obj.T || kugoo.t || kugoo.token || '').trim();
  const mid = String(obj.kg_mid || obj.KG_MID || obj.KUGOU_API_MID || obj.mid || createKugouMid('mineradio')).trim();
  const dfid = String(obj.kg_dfid || obj.KG_DFID || obj.dfid || obj.DFID || '-').trim();
  const nickname = decodeKugouDisplayText(
    kugoo.NickName || kugoo.nickname || obj.NickName || obj.nickname || obj.UserName || obj.username || ''
  );
  const avatar = String(kugoo.Pic || kugoo.pic || obj.Pic || obj.avatar || '').trim();
  const vipType = firstPositiveKugouNumber([kugoo, obj], [
    'isVIP', 'isVip', 'is_vip', 'vip_type', 'VIPType', 'vipLevel', 'vip_level',
    'vip_status', 'member_type', 'member_level', 'vip',
  ]);
  const svipType = firstPositiveKugouNumber([kugoo, obj], [
    'isSVIP', 'isSvip', 'is_svip', 'svip_type', 'SVIPType', 'superVip', 'super_vip',
    'svip_level', 'svip_status', 'svip',
  ]);
  const membershipKnown = [obj, kugoo].some(kugouObjectHasMembershipSignal);
  const isSvip = svipType > 0;
  const isVip = isSvip || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  const loggedIn = !!(userid && userid !== '0') || !!(obj.KuGoo || obj.kugou || obj.Kugou);
  const playbackReady = !!(userid && userid !== '0' && token);
  return {
    userid,
    token,
    mid,
    dfid,
    nickname,
    avatar,
    vipType,
    svipType,
    vipLevel,
    isVip,
    isSvip,
    membershipKnown,
    loggedIn,
    playbackReady,
  };
}

function kugouCookieUserId(obj) {
  return extractKugouAuth(typeof obj === 'string' ? obj : kugouCookieObject(obj)).userid;
}

function kugouCookieNickname(obj) {
  return extractKugouAuth(typeof obj === 'string' ? obj : kugouCookieObject(obj)).nickname;
}

function kugouCookieHasLogin(input) {
  const auth = extractKugouAuth(typeof input === 'string' ? input : kugouCookieObject(input));
  return auth.loggedIn;
}

function kugouCookieHasPlayback(input) {
  return extractKugouAuth(typeof input === 'string' ? input : kugouCookieObject(input)).playbackReady;
}

module.exports = {
  createKugouTtlCache,
  kugouSearchCache,
  kugouSongUrlCache,
  kugouPlaylistTracksCache,
  kugouProfileCache,
  kugouVipCache,
  requestJson,
  createKugouMid,
  kugouCloudKey,
  parseCookieString,
  kugouCookieObject,
  sanitizeCookieValue,
  buildKugouRequestCookie,
  parseKuGooCompound,
  signKey,
  kugouSignParamsKey,
  signatureAndroidParams,
  signatureH5Params,
  buildKugouH5Params,
  buildKugouGatewayParams,
  kugouGatewayError,
  kugouDfidCache,
  kugouDfidPending,
  kugouDfidPersistHook,
  setKugouDfidPersistHook,
  kugouRandomSeed,
  kugouRegisterAesKeyIV,
  registerKugouCloudDevice,
  ensureKugouDfid,
  kugouWithCloudlistDevice,
  kugouCloudlistRequest,
  kugouH5GatewayRequest,
  kugouGatewayRequest,
  extractKugouAuth,
  kugouCookieUserId,
  kugouCookieNickname,
  kugouCookieHasLogin,
  kugouCookieHasPlayback,
};
