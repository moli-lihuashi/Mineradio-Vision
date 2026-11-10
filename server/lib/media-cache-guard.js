'use strict';

// =============================================================================
// 媒体缓存写出守卫 + 会话内「不信任」标记（借 Folia mediaCacheGuard 的语义）
//
// 错误页、JSON 报错、截断的下载都不能当成音频存进缓存或下发给 <audio>。
// 用黑名单而不用白名单：部分 CDN 的 Content-Type 不规范（例如 binary/octet-stream、
// 汽水 VOD 的 video/mp4），白名单会把正常音源一起挡掉。
// =============================================================================

const MIN_CACHEABLE_AUDIO_BYTES = 16 * 1024;
const NON_AUDIO_CONTENT_TYPE = /^(text\/|application\/(json|xml|xhtml))|html/i;

/** 下载结果是否像一段可以缓存的音频：HTTP 成功、不是文本/JSON/HTML、不小于 16 KiB。 */
function isCacheableAudioResponse(response, blob) {
  if (!response || response.ok !== true) return false;
  let contentType = '';
  try {
    contentType = (response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type') : '') || '';
  } catch (_) { /* 拿不到头就退到 blob.type */ }
  if (!contentType) contentType = String((blob && blob.type) || '');
  if (NON_AUDIO_CONTENT_TYPE.test(contentType)) return false;
  const size = Number(blob && blob.size);
  return Number.isFinite(size) && size >= MIN_CACHEABLE_AUDIO_BYTES;
}

/* 下发阻断比缓存资格更保守：只有 Content-Type 明确是错误页/文本/JSON 才拒绝。
 * 小于 16 KiB 只记诊断不阻断 —— 试听片段、短音效是合法音源，误伤比漏记更贵。 */
function isClearlyNonAudioPayload(contentType) {
  return NON_AUDIO_CONTENT_TYPE.test(String(contentType || ''));
}

function payloadByteLength(buffer) {
  if (!buffer) return 0;
  if (typeof buffer.byteLength === 'number') return buffer.byteLength;
  if (typeof buffer.length === 'number') return buffer.length;
  return 0;
}

function createMediaCacheGuard(options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  const maxSuspicious = Number.isFinite(opts.maxSuspicious) && opts.maxSuspicious > 0
    ? opts.maxSuspicious : 100;
  let distrusted = new Set();
  let suspicious = [];

  function noteSuspicious(reason, meta) {
    const entry = Object.assign({ at: now(), reason: String(reason || '') }, meta || {});
    suspicious.push(entry);
    if (suspicious.length > maxSuspicious) {
      suspicious.splice(0, suspicious.length - maxSuspicious);
    }
    return entry;
  }

  return {
    isCacheableAudioResponse,
    isClearlyNonAudioPayload,
    payloadByteLength,
    noteSuspicious,
    suspiciousPayloads: () => suspicious.map(item => Object.assign({}, item)),
    /** 标记这首歌的缓存音频不可信：会话内应绕过缓存并允许重写。 */
    distrust: key => { if (key) distrusted.add(String(key)); },
    isDistrusted: key => !!key && distrusted.has(String(key)),
    /** 缓存被合格的新下载重写后清除标记。 */
    clearDistrust: key => { if (key) distrusted.delete(String(key)); },
    distrustedKeys: () => Array.from(distrusted),
    reset() { distrusted = new Set(); suspicious = []; },
  };
}

const singleton = createMediaCacheGuard();

module.exports = {
  MIN_CACHEABLE_AUDIO_BYTES,
  NON_AUDIO_CONTENT_TYPE,
  isCacheableAudioResponse,
  isClearlyNonAudioPayload,
  payloadByteLength,
  createMediaCacheGuard,
  getMediaCacheGuard: () => singleton,
  noteSuspicious: singleton.noteSuspicious,
  suspiciousPayloads: singleton.suspiciousPayloads,
  distrust: singleton.distrust,
  isDistrusted: singleton.isDistrusted,
  clearDistrust: singleton.clearDistrust,
  distrustedKeys: singleton.distrustedKeys,
};
