'use strict';
/**
 * 公共 HTTP 请求封装：超时 + 指数退避重试（GET/无 body 幂等）+ 显式 Content-Length + JSON。
 * 供 kugou/qishui/spotify 等音乐源 API 复用，避免每个平台各写一套 HTTP 样板。
 *
 * 兼容约束：
 * - requestText(targetUrl, opts, body) 与原 kugou-api.js 同名同签，可直接替换。
 * - opts.timeoutMs 可覆盖默认 12000ms；opts.retries 可覆盖默认重试 1 次（设 0 关闭）。
 * - GET 且无 body 才重试（幂等安全）；POST/带 body 不重试，避免非幂等副作用。
 * - 连接层诊断是只读埋点：不改变 requestText 的返回形状，captureSetCookie 仍是 opt-in。
 */
const http = require('http');
const https = require('https');
const networkDiagnostics = require('./network-diagnostics');

function isTimeoutError(err) {
  const m = String((err && err.message) || err || '').toLowerCase();
  return /timeout|timed out|etimedout|aborted|abort/.test(m);
}

function isRetryableNetError(err) {
  // 超时已经吃掉了整个 timeoutMs 预算：再重试一次等于让用户多等一倍
  // （旧行为 12s + 12s = 24s 的空白面板就是这么来的）。
  if (isTimeoutError(err)) return false;
  const m = String((err && err.message) || err || '').toLowerCase();
  return /econnreset|econnrefused|epipe|enotfound|socket hang up|network/.test(m);
}

function requestText(targetUrl, opts, body, attempt) {
  opts = opts || {};
  attempt = attempt || 0;
  const maxRetries = (opts.retries != null ? Number(opts.retries) : 1);
  const retryable = !body && (opts.method || 'GET').toUpperCase() === 'GET' && maxRetries > 0;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 12000;
  const captureSetCookie = !!opts.captureSetCookie;
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const rec = networkDiagnostics.begin({
      url: u.toString(), method: opts.method || 'GET', attempt, timeoutMs,
    });
    // 一次请求只结算一次：response end 之后 socket 仍可能补一个 error 事件。
    let settled = false;
    const finish = (patch) => {
      if (settled) return;
      settled = true;
      if (rec) networkDiagnostics.settle(rec, patch);
    };
    const headers = Object.assign({}, opts.headers || {});
    let bodyBuffer = null;
    if (body != null && body !== '') {
      bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      // 显式 Content-Length + JSON Content-Type：避免 chunked 编码，
      // 网关/WAF 对 chunked + 非 ASCII body 的处理可能与定长不一致
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(bodyBuffer.length);
      }
    }
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers,
    }, response => {
      // 状态码只由 finish -> settle 写入，避免两处重复赋值让诊断回归失去守门点。
      if (rec) networkDiagnostics.recordTiming(rec, 'ttfbMs', Date.now() - rec.at);
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        finish({ status: response.statusCode, phase: 'response' });
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          // 网关偶发 5xx：指数退避重试，避免抖动直接报错
          if (retryable && response.statusCode >= 500 && attempt < maxRetries) {
            const delayMs = 300 * Math.pow(2, attempt);
            setTimeout(() => resolve(requestText(targetUrl, opts, body, attempt + 1)), delayMs);
            return;
          }
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          reject(err);
          return;
        }
        /* captureSetCookie：酷狗会话自愈用（上游会轮换 token，响应里的
           Set-Cookie 必须合并回磁盘，否则永远带着旧 token 请求）。
           不开这个开关时行为不变，仍直接 resolve 字符串。 */
        if (captureSetCookie) {
          const setCookie = []
            .concat(response.headers['set-cookie'] || [])
            .map(v => String(v));
          resolve({ text, setCookie });
          return;
        }
        resolve(text);
      });
    });
    /* 连接层诊断：DNS / TCP / TLS 三段分开记。
     * 之前「像网络卡了一样」「概率事件」只能靠临时探针反推，现在有常驻证据。 */
    if (rec && typeof req.on === 'function') {
      req.on('socket', socket => {
        if (!socket || typeof socket.on !== 'function') return;
        socket.on('lookup', (err) => {
          if (err) rec.dnsError = networkDiagnostics.describeError(err);
          networkDiagnostics.recordTiming(rec, 'dnsMs', Date.now() - rec.at);
        });
        socket.once('connect', () => networkDiagnostics.recordTiming(rec, 'connectMs', Date.now() - rec.at));
        socket.once('secureConnect', () => networkDiagnostics.recordTiming(rec, 'tlsMs', Date.now() - rec.at));
      });
    }
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => {
      finish({ error: err });
      // 超时/网络抖动：指数退避重试
      if (retryable && attempt < maxRetries && isRetryableNetError(err)) {
        const delayMs = 300 * Math.pow(2, attempt);
        setTimeout(() => resolve(requestText(targetUrl, opts, body, attempt + 1)), delayMs);
        return;
      }
      reject(err);
    });
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  return JSON.parse(text);
}

module.exports = { requestText, requestJson, isRetryableNetError, isTimeoutError };
