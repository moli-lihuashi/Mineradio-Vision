'use strict';

/**
 * 播放地址短 TTL 缓存。
 *
 * 为什么要缓存：同一首歌回切 / 重播 / 预取后再次起播都会重新打一次上游取址，
 * 而取址是整条起播链最慢的一跳（实测 /api/song/url 单次 100ms~4s），QQ 还会对
 * 高频取址风控。命中缓存等于把这一段往返省掉。
 *
 * 为什么 TTL 必须短：直链带签名，过期时间由上游决定且响应里没有可靠字段。
 * 因此两条同时成立才敢上线：
 *   1) TTL 保守（默认 5 分钟，远小于观测到的最短有效期）；
 *   2) 媒体代理看到上游 403/404/410 时按 URL 精确失效（invalidateByUrl），
 *      否则「取到死链 → 缓存死链 → 重试仍拿到死链」会变成递归放大。
 *
 * 只缓存成功结果：失败与试听片段由调用方把关不写入 —— 试听片段缓存下来，
 * 用户登录或换音质后仍会拿到同一份错误答案。
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 400;

function createPlayUrlCache(options) {
  const opts = options || {};
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const maxEntries = Number(opts.maxEntries) > 0 ? Number(opts.maxEntries) : DEFAULT_MAX_ENTRIES;
  const clock = typeof opts.now === 'function' ? opts.now : Date.now;
  const entries = new Map();

  function prune(at) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function get(key) {
    if (!key) return null;
    const at = clock();
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= at) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key, value) {
    if (!key || !value || !value.url) return false;
    const at = clock();
    entries.set(key, { value, url: String(value.url), storedAt: at, expiresAt: at + ttlMs });
    prune(at);
    return true;
  }

  /** 探测到「档位名不副实」时把缓存里的那一份改掉：下一次取址直接给正确的 level。 */
  function correct(key, patch) {
    if (!key || !patch) return false;
    const entry = entries.get(key);
    if (!entry) return false;
    entry.value = Object.assign({}, entry.value, patch);
    return true;
  }

  /** 媒体代理看到上游死链时调用：按直链精确失效，避免重试又拿到同一条。 */
  function invalidateByUrl(targetUrl) {
    const url = String(targetUrl || '');
    if (!url) return 0;
    let removed = 0;
    for (const [key, entry] of entries) {
      if (entry.url === url) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  function size() {
    prune(clock());
    return entries.size;
  }

  function clear() {
    entries.clear();
  }

  return { get, set, correct, invalidateByUrl, size, clear, ttlMs, maxEntries };
}

/** 账号维度隔离：同一首歌在登录/未登录、不同账号下音质与可用性不同，不能共用条目。 */
function playUrlCacheScope(cookie) {
  const text = String(cookie || '');
  if (!text) return 'anon';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return 'u' + (hash >>> 0).toString(36);
}

function playUrlCacheKey(parts) {
  const p = parts || {};
  return [
    String(p.provider || ''),
    String(p.scope || 'anon'),
    String(p.quality || ''),
    String(p.id || ''),
    String(p.extra || ''),
  ].join('\u001f');
}

module.exports = {
  createPlayUrlCache,
  playUrlCacheKey,
  playUrlCacheScope,
  // 进程内共享一份：三个平台路由与媒体代理必须看到同一批条目，
  // 否则「代理发现死链 → 失效」失效不到路由写入的那份。
  shared: createPlayUrlCache(),
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
};
