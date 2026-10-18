'use strict';

// 酷狗协议底层：签名（android/web）、设备指纹（guid/mid/mac/dev）、cookie 头拼装、
// gateway / cloudlist 请求封装。不含任何业务语义。
// 从 server.js 抽出（原为 server.js 2911–3560 的前半段）。
// kugouCookie 由块外 cookie 持久化层反复赋值 → 以 getKugouCookie() 注入（调用期读，不会拿快照）。
// kugouVipProbe 是 holder 对象（.current），块外也会写，故不按值注入。

module.exports = function createKugouProtocol(deps) {
  const {
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
  } = deps || {};

  const crypto = require('crypto');

  function kugouMd5(text) {
    return crypto.createHash('md5').update(String(text || '')).digest('hex');
  }
  function kugouAndroidSignature(params, dataString) {
    // 签名算法单一来源在 kugou-api.js；此处仅传 lite 盐
    return kugouSignatureAndroidParams(params, dataString, KUGOU_ID.ANDROID_SIGN_KEY);
  }
  function kugouWebSignature(params) {
    const body = Object.keys(params || {})
      .sort()
      .map(k => k + '=' + (params[k] == null ? '' : params[k]))
      .join('');
    return kugouMd5(KUGOU_ID.WEB_SIGN_KEY + body + KUGOU_ID.WEB_SIGN_KEY);
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
    kugouVipProbe.current = { userId: '', checkedAt: 0, info: null };
    saveKugouCookie(serializeCookieObject(auth));
    return auth;
  }
  function kugouCookieMid(obj) {
    obj = obj || kugouCookieObject();
    return obj.KUGOU_API_MID || obj.mid || obj.kg_mid || obj.KG_MID || KUGOU_DEFAULT_MID;
  }
  function kugouCookieDfid(obj) {
    obj = obj || kugouCookieObject();
    const value = obj.kg_dfid || obj.KG_DFID || obj.dfid || obj.DFID || '-';
    const text = String(value || '').trim();
    return text && text !== '-' ? text : '-';
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
      appid: KUGOU_ID.APPID,
      clientver: KUGOU_ID.CLIENTVER,
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
      'User-Agent': KUGOU_ID.ANDROID_UA,
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
  // 归口到 kugou-api.js 的 lite 身份通道（含 ensureKugouDfid）；勿再本地旁路签名/Cookie。
  async function kugouCloudlistRequest(pathname, params, data) {
    return kugouApiCloudlistRequest(pathname, {
      cookie: getKugouCookie() || '',
      params: params || {},
      body: data == null ? undefined : data,
    });
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

  return {
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
  };
};
