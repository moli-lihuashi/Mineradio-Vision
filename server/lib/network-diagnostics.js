'use strict';

// =============================================================================
// 连接层诊断记录（借 Folia networkRecorder 的思路）
//
// 之前定位「歌单像网络卡了一样」「概率事件」全靠临时 CDP 探针反推耗时。
// 这里在公共 HTTP 封装上留一份常驻、有上限、默认开启的环形记录：
// 每个请求记 DNS / TCP / TLS / 首字节 / 总耗时、状态码、错误阶段，
// 只记 path 不记 query（query 常带 cookie 和签名），错误文本过一遍凭据脱敏。
//
// run(tag, fn) 用 AsyncLocalStorage 给一次业务操作打标签，
// entriesForTag(tag) 能把「这一次点歌单」牵动的所有上游请求单独拉出来。
// =============================================================================

const { AsyncLocalStorage } = require('async_hooks');
const { redactCredentials } = require('./log-redact');

const DEFAULT_MAX_ENTRIES = 200;

const PROVIDER_HOST_RULES = [
  ['kugou', ['kugou.com', 'kgimg.com', 'cloudlist.service.kugou.com', 'gateway.kugou.com']],
  ['netease', ['music.163.com', '126.net', '127.net', '163.com']],
  ['qq', ['qq.com', 'qpic.cn', 'gtimg.com', 'tencentmusic.com']],
  ['qishui', ['douyin.com', 'douyinvod.com', 'bytecdntp.com', 'volccdn.com', 'huoshanstatic.com']],
  ['spotify', ['spotify.com', 'spotifycdn.com', 'scdn.co']],
];

function classifyProvider(host) {
  const h = String(host || '').toLowerCase();
  for (const [provider, suffixes] of PROVIDER_HOST_RULES) {
    if (suffixes.some(s => h === s || h.endsWith('.' + s))) return provider;
  }
  return 'other';
}

function describeError(err) {
  if (!err) return null;
  return {
    code: typeof err.code === 'string' ? err.code : null,
    message: redactCredentials(String((err && err.message) || err || '')),
  };
}

function errorPhaseOf(entry) {
  const t = entry.timings || {};
  if (t.dnsMs == null && !entry.secure) return 'dns';
  if (t.connectMs == null) return 'connect';
  if (entry.secure && t.tlsMs == null) return 'tls';
  if (t.ttfbMs == null) return 'response';
  return 'body';
}

function createNetworkRecorder(options) {
  const opts = options || {};
  const maxEntries = Number.isFinite(opts.maxEntries) && opts.maxEntries > 0
    ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
  const now = opts.now || Date.now;
  const tags = new AsyncLocalStorage();
  let entries = [];
  let seq = 0;
  let enabled = opts.enabled !== false;

  function currentTag() {
    try { return tags.getStore() || null; } catch (_) { return null; }
  }

  function begin(meta) {
    if (!enabled) return null;
    const m = meta || {};
    let host = '';
    let path = '/';
    let secure = false;
    try {
      const u = new URL(String(m.url));
      host = u.host.toLowerCase();
      path = u.pathname || '/';
      secure = u.protocol === 'https:';
    } catch (_) {
      host = String(m.url || '').slice(0, 120);
    }
    const entry = {
      id: ++seq,
      at: now(),
      tag: m.tag != null ? m.tag : currentTag(),
      provider: classifyProvider(host),
      method: String(m.method || 'GET').toUpperCase(),
      host,
      path,
      secure,
      attempt: Number(m.attempt) || 0,
      timeoutMs: Number(m.timeoutMs) || null,
      status: null,
      phase: 'pending',
      error: null,
      dnsError: null,
      timings: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, totalMs: null },
    };
    entries.push(entry);
    if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
    return entry;
  }

  function recordTiming(entry, name, ms) {
    if (!entry || !entry.timings || !(name in entry.timings)) return;
    if (!Number.isFinite(ms)) return;
    entry.timings[name] = Math.max(0, ms);
  }

  function settle(entry, patch) {
    if (!entry || !enabled) return entry;
    const p = patch || {};
    if (p.status != null) entry.status = Number(p.status) || null;
    if (p.error) {
      entry.error = describeError(p.error);
      entry.phase = p.phase || errorPhaseOf(entry);
    } else if (p.phase) {
      entry.phase = p.phase;
    }
    if (p.dnsError) entry.dnsError = describeError(p.dnsError);
    entry.timings.totalMs = Math.max(0, now() - entry.at);
    return entry;
  }

  function toPlain(entry) {
    return {
      id: entry.id, at: entry.at, tag: entry.tag, provider: entry.provider,
      method: entry.method, host: entry.host, path: entry.path, secure: entry.secure,
      attempt: entry.attempt, timeoutMs: entry.timeoutMs,
      status: entry.status, phase: entry.phase,
      error: entry.error ? Object.assign({}, entry.error) : null,
      dnsError: entry.dnsError ? Object.assign({}, entry.dnsError) : null,
      timings: Object.assign({}, entry.timings),
    };
  }

  return {
    begin,
    recordTiming,
    settle,
    run: (tag, fn) => tags.run(tag, fn),
    currentTag,
    snapshot(options) {
      const o = options || {};
      let list = entries.slice();
      if (o.provider) list = list.filter(e => e.provider === o.provider);
      if (o.tag != null) list = list.filter(e => e.tag === o.tag);
      if (o.errorsOnly) list = list.filter(e => !!e.error || (e.status != null && e.status >= 400));
      const limit = Number.isFinite(o.limit) && o.limit > 0 ? o.limit : list.length;
      return list.slice(-limit).map(toPlain);
    },
    entriesForTag: tag => entries.filter(e => e.tag === tag).map(toPlain),
    setEnabled(value) { enabled = !!value; },
    isEnabled: () => enabled,
    clear() { entries = []; seq = 0; },
    size: () => entries.length,
  };
}

const singleton = createNetworkRecorder();

module.exports = {
  DEFAULT_MAX_ENTRIES,
  classifyProvider,
  describeError,
  errorPhaseOf,
  createNetworkRecorder,
  getNetworkRecorder: () => singleton,
  begin: singleton.begin,
  recordTiming: singleton.recordTiming,
  settle: singleton.settle,
  run: singleton.run,
  snapshot: singleton.snapshot,
  entriesForTag: singleton.entriesForTag,
};
