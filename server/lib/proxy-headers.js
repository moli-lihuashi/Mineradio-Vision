'use strict';

// 音频代理的「受限自定义请求头」通道。
//
// 为什么需要：部分音源返回的播放地址带防盗链，必须带正确的 Referer/UA 才能取流。
// 但让前端随意指定请求头就是把代理变成了可伪造任意请求的工具，所以这里收死：
//   · 只接受 referer / origin / user-agent 三个头
//   · 每个值长度 ≤ 512，且不许含 CR/LF（防 header 注入）
//   · 编码走 base64url(JSON)，解码失败一律当没传
//
// 只做「过滤」，不做「放行判断」——URL 本身仍要过 assertProxyableMediaUrl（SSRF 防线）。

const PROXY_HEADER_ALLOW = ['referer', 'origin', 'user-agent'];
const MAX_VALUE_LEN = 512;

function sanitizeProxyHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  const lower = {};
  Object.keys(headers).forEach(key => { lower[String(key).toLowerCase()] = headers[key]; });
  PROXY_HEADER_ALLOW.forEach(name => {
    const value = lower[name];
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LEN) return;
    if (/[\r\n]/.test(trimmed)) return;   // header 注入
    out[name] = trimmed;
  });
  return out;
}

function encodeHeaderParam(headers) {
  const clean = sanitizeProxyHeaders(headers);
  if (!Object.keys(clean).length) return '';
  return Buffer.from(JSON.stringify(clean), 'utf8').toString('base64url');
}

function decodeHeaderParam(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return {};
  try {
    const json = Buffer.from(text, 'base64url').toString('utf8');
    if (json.length > 2048) return {};
    return sanitizeProxyHeaders(JSON.parse(json));
  } catch (_) {
    return {};
  }
}

module.exports = {
  PROXY_HEADER_ALLOW,
  sanitizeProxyHeaders,
  encodeHeaderParam,
  decodeHeaderParam,
};
