'use strict';

// =============================================================================
// 打包版内可见的运行日志缓冲（借 Folia consoleLogBuffer 的思路）
//
// 桌面构建没有常开的 DevTools，排障时往往只有「它刚才打印了什么」可用。
// 缓冲默认开启：需要在问题发生「之前」才打开的日志，等于永远拿不到。
// 有上限（1000 行）、按 [Prefix] 自动归类、写盘前过凭据脱敏。
// 格式化不能抛异常 —— 它运行在 console 内部，一个循环引用就足以拖垮调用点。
// =============================================================================

const { redactCredentials } = require('./log-redact');

const DEFAULT_LIMIT = 1000;
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

function readScope(text) {
  const m = /^\[([^\]\s]{1,40})\]/.exec(String(text || ''));
  return m ? m[1] : null;
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || (value.name + ': ' + value.message);
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, item) => {
      if (typeof item !== 'object' || item === null) return item;
      // Error / DOMException 的 name 和 message 在原型上，直接 stringify 会写成 {}。
      if (item instanceof Error) return item.name + ': ' + item.message;
      if (seen.has(item)) return '[circular]';
      seen.add(item);
      return item;
    }) || String(value);
  } catch (_) { return String(value); }
}

function createLogBuffer(options) {
  const opts = options || {};
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;
  const now = opts.now || Date.now;
  const redact = opts.redact || redactCredentials;
  let entries = [];
  let nextId = 0;
  let enabled = opts.enabled !== false;
  let installed = false;
  let originals = null;

  function push(level, args) {
    if (!enabled) return;
    let text;
    try {
      text = Array.prototype.map.call(args || [], formatValue).join(' ');
    } catch (_) { return; }
    let safe = text;
    try { safe = redact(text); } catch (_) { /* 脱敏失败也不能吞掉日志 */ }
    entries.push({ id: ++nextId, at: now(), level, text: safe, scope: readScope(safe) });
    if (entries.length > limit) entries.splice(0, entries.length - limit);
  }

  function install() {
    if (installed) return false;
    originals = {};
    for (const level of LEVELS) {
      const original = console[level];
      originals[level] = original;
      console[level] = function () {
        try { push(level, arguments); } catch (_) { /* 日志绝不影响业务 */ }
        return original.apply(console, arguments);
      };
    }
    installed = true;
    return true;
  }

  function uninstall() {
    if (!installed || !originals) return false;
    for (const level of LEVELS) console[level] = originals[level];
    originals = null;
    installed = false;
    return true;
  }

  return {
    push, install, uninstall,
    snapshot(options) {
      const o = options || {};
      let list = entries.slice();
      if (o.level) list = list.filter(e => e.level === o.level);
      if (o.scope) list = list.filter(e => e.scope === o.scope);
      if (o.since != null) list = list.filter(e => e.at >= Number(o.since));
      const limitN = Number.isFinite(o.limit) && o.limit > 0 ? o.limit : list.length;
      return list.slice(-limitN).map(e => Object.assign({}, e));
    },
    setEnabled(value) { enabled = !!value; },
    isEnabled: () => enabled,
    isInstalled: () => installed,
    clear() { entries = []; nextId = 0; },
    size: () => entries.length,
  };
}

const singleton = createLogBuffer();

module.exports = {
  DEFAULT_LIMIT,
  readScope,
  formatValue,
  createLogBuffer,
  getLogBuffer: () => singleton,
  installLogBuffer: () => singleton.install(),
  logSnapshot: options => singleton.snapshot(options),
};
