'use strict';

// 汽水音乐：登录（PC 扫码 / OAuth 换 token / token 存取）。
//
// 第 3 刀从 qishui-api.js 抽出。只依赖 config/http —— 登录是纯协议，不认识任何业务领域。

const fs = require('fs');
const https = require('https');
const path = require('path');

const {
  QISHUI_PC_DEVICE_ID,
  QISHUI_PC_FIXED,
  QISHUI_UA,
  QISHUI_WEB_UA,
  getQishuiOAuthConfig,
  normalizeQishuiToken,
  qishuiOAuthConfigError,
  qishuiTokenFile,
} = require('./config');

const {
  clearQishuiRuntimeCaches,
  normalizeQishuiCookieInput,
  normalizeText,
  qishuiCookieHasLogin,
  qishuiCookieObject,
  qishuiHeadersWithCookie,
  qishuiOrderedForm,
  qishuiPassportHeaders,
  qishuiPcPassportParams,
  qishuiPcStatusError,
  qishuiPcUrl,
  qishuiQrErrorCode,
  qishuiSetCookieHeader,
  requestJson,
  requestJsonWithMeta,
  requestTextWithMeta,
} = require('./http');

const {
  getQishuiStatus,
} = require('./account');

function qishuiPcQrNextFromIndexUrl(indexUrl) {
  const value = normalizeText(indexUrl);
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const parsed = new URL(value);
    const next = normalizeText(parsed.searchParams.get('next_url') || parsed.searchParams.get('next') || '');
    return /^https?:\/\//i.test(next) ? next : '';
  } catch (_) {
    return '';
  }
}

function qishuiPcQrNextFromPayload(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  const raw = payload.next || payload.nextUrl || payload.next_url || qishuiPcQrNextFromIndexUrl(payload.qrcodeIndexUrl || payload.qrcode_index_url);
  return /^https?:\/\//i.test(String(raw || '')) ? String(raw).trim() : QISHUI_PC_FIXED.next;
}

function qishuiQrBoolParam(value, fallback) {
  if (value === true || value === false) return value ? 'true' : 'false';
  const text = normalizeText(value).toLowerCase();
  if (text === 'true' || text === '1') return 'true';
  if (text === 'false' || text === '0') return 'false';
  return fallback;
}

function qishuiPcQrStatusMessage(status, hasCookie) {
  const key = normalizeText(status).toLowerCase();
  if (hasCookie) return '汽水登录已确认，正在同步歌单';
  if (!key || key === 'new' || key === 'wait') return '等待汽水音乐 App 扫码';
  if (/scan|scanned/.test(key)) return '已扫码，等待在汽水音乐 App 内确认';
  if (/confirm|success|login/.test(key)) return '已确认，正在换取汽水登录态';
  if (/verify|mfa|sms/.test(key)) return '已确认，汽水要求短信验证';
  if (/expire/.test(key)) return '二维码已过期，请重新打开汽水授权';
  if (/error|fail/.test(key)) return '扫码状态异常，正在继续确认当前二维码';
  return '等待确认：' + status;
}

function qishuiQrAccountFlow(data, json) {
  return normalizeText(
    data && (data.account_flow || data.accountFlow || data.flow || data.verify_flow) ||
    json && (json.account_flow || json.accountFlow || json.flow || json.verify_flow) ||
    ''
  ).toLowerCase();
}

function qishuiPcQrRedirectUrl(json, data) {
  data = data && typeof data === 'object' ? data : {};
  json = json && typeof json === 'object' ? json : {};
  const raw = data.redirect_url || data.redirectUrl || data.login_url || data.loginUrl ||
    data.location || data.next || json.redirect_url || json.redirectUrl || json.location || '';
  const value = normalizeText(raw);
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const host = new URL(value).hostname.replace(/^\./, '').toLowerCase();
    if (host === 'qishui.com' || host.endsWith('.qishui.com') || host === 'douyin.com' || host.endsWith('.douyin.com')) return value;
  } catch (_) {}
  return '';
}

async function qishuiResolvePcQrLoginCookie(redirectUrl, cookieText) {
  let currentUrl = normalizeText(redirectUrl);
  let cookie = normalizeQishuiCookieInput(cookieText);
  if (!currentUrl) return '';
  for (let i = 0; i < 6; i++) {
    const meta = await requestTextWithMeta(currentUrl, {
      timeoutMs: 9000,
      headers: qishuiHeadersWithCookie({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': QISHUI_WEB_UA,
        'Referer': 'https://api.qishui.com/',
      }, cookie),
    });
    cookie = normalizeQishuiCookieInput([cookie, qishuiSetCookieHeader(meta.headers)]);
    if (qishuiCookieHasLogin(cookie)) return cookie;
    const location = normalizeText(meta.headers && (meta.headers.location || meta.headers.Location));
    if (!location || !/^(301|302|303|307|308)$/.test(String(meta.statusCode))) break;
    currentUrl = new URL(location, currentUrl).toString();
  }
  return qishuiCookieHasLogin(cookie) ? cookie : '';
}

async function createQishuiPcQrLogin() {
  const targetUrl = qishuiPcUrl('/passport/web/get_qrcode/', qishuiPcPassportParams({
    next: QISHUI_PC_FIXED.next,
    need_logo: QISHUI_PC_FIXED.need_logo,
    need_short_url: QISHUI_PC_FIXED.need_short_url,
    is_frontier: QISHUI_PC_FIXED.is_frontier,
  }));
  const meta = await requestJsonWithMeta(targetUrl, {
    timeoutMs: 9000,
    headers: qishuiPassportHeaders('', 'application/json,text/javascript'),
  });
  const json = meta.json || {};
  const err = qishuiPcStatusError(json, 'QISHUI_QR_CREATE_FAILED');
  if (err) throw err;
  const data = (json && json.data) || {};
  const token = normalizeText(data.token);
  if (!token) throw new Error('QISHUI_QR_TOKEN_MISSING');
  const qrcodeIndexUrl = data.qrcode_index_url || data.qrcodeIndexUrl || '';
  const next = qishuiPcQrNextFromIndexUrl(qrcodeIndexUrl) || QISHUI_PC_FIXED.next;
  const isFrontier = qishuiQrBoolParam(data.is_frontier, QISHUI_PC_FIXED.is_frontier);
  return {
    provider: 'qishui',
    token,
    qrcode: data.qrcode || '',
    qrcodeIndexUrl,
    next,
    passportNext: QISHUI_PC_FIXED.next,
    isFrontier,
    passportIsFrontier: QISHUI_PC_FIXED.is_frontier,
    deviceId: QISHUI_PC_DEVICE_ID,
    expireTime: Number(data.expire_time || data.expireTime || 0) || 0,
    copywriting: data.copywriting || '',
    cookie: qishuiSetCookieHeader(meta.headers),
    raw: json,
  };
}

async function checkQishuiPcQrLogin(token, cookieText, qrOptions) {
  token = normalizeText(token);
  if (!token) throw new Error('QISHUI_QR_TOKEN_REQUIRED');
  const seedCookie = normalizeQishuiCookieInput(cookieText);
  qrOptions = qrOptions && typeof qrOptions === 'object' ? qrOptions : {};
  const next = normalizeText(qrOptions.passportNext) || QISHUI_PC_FIXED.next;
  const isFrontier = qishuiQrBoolParam(qrOptions.passportIsFrontier, QISHUI_PC_FIXED.is_frontier);
  const checkParams = qishuiPcPassportParams();
  const formParams = {
    need_logo: QISHUI_PC_FIXED.need_logo,
    need_short_url: QISHUI_PC_FIXED.need_short_url,
    is_frontier: isFrontier,
    token,
    is_new_login: QISHUI_PC_FIXED.is_new_login,
    next,
  };
  const headers = qishuiPassportHeaders(seedCookie, 'application/json,text/javascript');
  let meta;
  try {
    meta = await requestJsonWithMeta(qishuiPcUrl('/passport/web/check_qrconnect/', checkParams), {
      method: 'POST',
      timeoutMs: 9000,
      headers,
    }, qishuiOrderedForm(formParams, [
      'need_logo',
      'need_short_url',
      'is_frontier',
      'token',
      'is_new_login',
      'next',
      'passport_mfa_retry_tag',
      'std_verify_flow_id',
      'std_verify_scene',
      'std_verify_template',
      'std_verify_token',
      'std_verify_type',
      'std_verify_way',
    ]));
  } catch (postErr) {
    const getParams = Object.assign({}, checkParams, formParams);
    meta = await requestJsonWithMeta(qishuiPcUrl('/passport/web/check_qrconnect/', getParams), {
      method: 'GET',
      timeoutMs: 9000,
      headers,
    });
    meta.postError = postErr && (postErr.message || postErr.code || String(postErr));
  }
  const json = meta.json || {};
  const err = qishuiPcStatusError(json, 'QISHUI_QR_CHECK_FAILED');
  const data = json.data || {};
  const errorCode = qishuiQrErrorCode(data, json);
  const accountFlow = qishuiQrAccountFlow(data, json);
  const errorDescription = normalizeText(data.description || data.message || json.description || json.status_msg || json.message || '');
  if (err && errorCode !== 7 && errorCode !== 2046 && !/scan|confirm|new|wait|error|fail|expire|verify|mfa|sms/i.test(err.message || '')) throw err;
  let status = normalizeText(data.status || data.qr_status || json.status || json.message || '');
  if (!status && errorCode === 7) status = 'wait';
  else if (!status && errorCode) status = 'error';
  if (errorCode === 2046 || /verify|mfa|sms/.test(accountFlow)) status = 'verify';
  const responseCookie = qishuiSetCookieHeader(meta.headers);
  const baseCookie = normalizeQishuiCookieInput([seedCookie, responseCookie]);
  let loginCookie = qishuiCookieHasLogin(baseCookie) ? baseCookie : '';
  const redirectUrl = qishuiPcQrRedirectUrl(json, data);
  if (!loginCookie && redirectUrl) {
    try {
      loginCookie = await qishuiResolvePcQrLoginCookie(redirectUrl, baseCookie);
    } catch (_) {}
  }
  const sessionObj = qishuiCookieObject(loginCookie || baseCookie);
  const sessionid = normalizeText(sessionObj.sessionid || sessionObj.sessionid_ss || sessionObj.sid_guard || sessionObj.sid_tt || '');
  const needsSms = status === 'verify' || errorCode === 2046 || /verify|mfa|sms/.test(accountFlow);
  const retryAfterMs = errorCode === 7 ? 60000 : 0;
  let message = qishuiPcQrStatusMessage(status, !!loginCookie);
  if (errorCode === 7) message = '汽水确认接口临时限流，已自动降频继续确认当前二维码';
  else if (needsSms) message = '汽水已确认扫码，但账号要求短信或二次验证，当前二维码不能直接换到登录态';
  else if (/confirm|confirmed|success|login/i.test(status) && !loginCookie) message = '汽水已确认扫码，正在等待登录态下发';
  else if (errorCode) message = '汽水扫码返回 error_code=' + errorCode + (errorDescription ? ('：' + errorDescription) : '，保留当前二维码继续确认');
  return {
    provider: 'qishui',
    ok: true,
    token,
    status,
    confirmed: !!loginCookie || (!needsSms && /confirmed|confirm|success|login/i.test(status)),
    sessionid,
    cookie: loginCookie,
    message,
    errorCode,
    errorDescription,
    accountFlow,
    needsSms,
    retryAfterMs,
    pollCookie: baseCookie,
    redirectUrl: redirectUrl ? true : false,
    raw: json,
  };
}

function saveQishuiAccessToken(value) {
  const token = normalizeQishuiToken(value);
  if (!token || token.length < 10) {
    const err = new Error('INVALID_QISHUI_TOKEN');
    err.code = 'INVALID_QISHUI_TOKEN';
    throw err;
  }
  const file = qishuiTokenFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, 'utf8');
  clearQishuiRuntimeCaches();
  return { ...getQishuiStatus(), saved: true };
}

function clearQishuiAccessToken() {
  const file = qishuiTokenFile();
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
  clearQishuiRuntimeCaches();
  return { ...getQishuiStatus(), ok: true };
}

async function exchangeQishuiOAuthCode(code) {
  code = normalizeText(code);
  if (!code) {
    const err = new Error('QISHUI_OAUTH_CODE_REQUIRED');
    err.code = 'QISHUI_OAUTH_CODE_REQUIRED';
    throw err;
  }
  const config = getQishuiOAuthConfig();
  if (!config.configured) throw qishuiOAuthConfigError(config);
  const body = new URLSearchParams();
  body.set('client_key', config.clientKey);
  body.set('client_secret', config.clientSecret);
  body.set('code', code);
  body.set('grant_type', 'authorization_code');
  const bodyText = body.toString();
  const json = await requestJson(config.tokenUrl, {
    method: 'POST',
    timeoutMs: 10000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyText),
      'User-Agent': QISHUI_UA,
    },
  }, bodyText);
  const data = (json && json.data) || json || {};
  const errCode = Number(data.error_code || data.err_code || json.error_code || json.err_code || 0);
  if (errCode) {
    const err = new Error(String(data.description || data.message || json.description || json.message || 'QISHUI_OAUTH_TOKEN_ERROR'));
    err.code = errCode;
    err.body = json;
    throw err;
  }
  const token = normalizeQishuiToken(data.access_token || json.access_token || '');
  if (!token) {
    const err = new Error('QISHUI_OAUTH_TOKEN_MISSING');
    err.code = 'QISHUI_OAUTH_TOKEN_MISSING';
    err.body = json;
    throw err;
  }
  const status = saveQishuiAccessToken(token);
  return {
    ...status,
    oauth: true,
    openId: data.open_id || data.openid || '',
    scope: data.scope || status.scope,
    expiresIn: data.expires_in || 0,
    refreshExpiresIn: data.refresh_expires_in || 0,
  };
}

module.exports = {
  qishuiPcQrNextFromIndexUrl,
  qishuiPcQrNextFromPayload,
  qishuiQrBoolParam,
  qishuiPcQrStatusMessage,
  qishuiQrAccountFlow,
  qishuiPcQrRedirectUrl,
  qishuiResolvePcQrLoginCookie,
  createQishuiPcQrLogin,
  checkQishuiPcQrLogin,
  saveQishuiAccessToken,
  clearQishuiAccessToken,
  exchangeQishuiOAuthCode,
};
