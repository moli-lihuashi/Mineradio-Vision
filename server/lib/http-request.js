'use strict';
/**
 * 公共 HTTP 请求封装：超时 + 指数退避重试（GET/无 body 幂等）+ 显式 Content-Length + JSON。
 * 供 kugou/qishui/spotify 等音乐源 API 复用，避免每个平台各写一套 HTTP 样板。
 *
 * 兼容约束：
 * - requestText(targetUrl, opts, body) 与原 kugou-api.js 同名同签，可直接替换。
 * - opts.timeoutMs 可覆盖默认 12000ms；opts.retries 可覆盖默认重试 1 次（设 0 关闭）。
 * - GET 且无 body 才重试（幂等安全）；POST/带 body 不重试，避免非幂等副作用。
 */
const http = require('http');
const https = require('https');

function isRetryableNetError(err) {
  const m = String((err && err.message) || err || '').toLowerCase();
  return /timeout|econnreset|econnrefused|epipe|enotfound|socket hang up|network|abort/.test(m);
}

function requestText(targetUrl, opts, body, attempt) {
  opts = opts || {};
  attempt = attempt || 0;
  const maxRetries = (opts.retries != null ? Number(opts.retries) : 1);
  const retryable = !body && (opts.method || 'GET').toUpperCase() === 'GET' && maxRetries > 0;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 12000;
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
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
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
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
        resolve(text);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => {
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

module.exports = { requestText, requestJson, isRetryableNetError };
