'use strict';

// =============================================================================
// 分层网络自检（借 Folia loginSelfCheck 的分层思路）
//
// 目的：用户说「我网络没问题」时，能拿出一份「卡在哪一层」的结构化证据，而不是靠猜。
// 顺序：本地后端 → 代理（环境变量 / 系统代理）→ DNS（含 TUN fake-ip 识别）
//      → 对首个 IPv4 / IPv6 分别做 TCP + TLS（分开测才分得清只有 IPv6 被重置）
//      → 真实 HTTPS GET（用服务器 Date 头算本机时钟偏差）。
//
// 只产出结构化数据，不在这里下结论；每项都有超时，域名之间并行，整体十秒左右。
// 只在 /api/debug/self-check 手动触发，不在启动时跑。
// =============================================================================

const dns = require('dns');
const http = require('http');
const https = require('https');
const tls = require('tls');

const DEFAULT_TIMEOUT_MS = 5000;
const BACKEND_TIMEOUT_MS = 3000;
const PROXY_ENV_NAMES = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'];

// 只查真正会挡住播放 / 歌单的那几个上游；少一个域名就少一份噪声。
const DEFAULT_HOSTS = [
  'cloudlist.service.kugou.com',
  'gateway.kugou.com',
  'music.163.com',
  'y.qq.com',
  'api.spotify.com',
];

function errorOf(error, phase) {
  return {
    code: typeof (error && error.code) === 'string' ? error.code : null,
    message: error instanceof Error ? error.message : String(error == null ? '' : error),
    ...(phase ? { phase } : {}),
  };
}

// 代理地址里的账号密码是凭据，换成 ***；主机名与端口保留用于诊断代理链路。
function maskProxyCredentials(value) {
  return String(value).replace(/\/\/([^/@\s]+)@/, '//***@');
}

// 198.18.0.0/15 是基准测试保留段，Clash 等代理的 fake-ip 默认用它：
// DNS 返回这段地址说明有 TUN 代理在网络层接管连接。
function isFakeIp(address) {
  const match = /^(\d+)\.(\d+)\./.exec(String(address || ''));
  return Boolean(match) && Number(match[1]) === 198 && (Number(match[2]) === 18 || Number(match[2]) === 19);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(
        new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

// 对本地后端发一个 GET /：静态页或 404 都算活着，拿到任何 HTTP 响应即可。
function probeLocalBackend(options) {
  const o = options || {};
  const timeoutMs = o.timeoutMs || BACKEND_TIMEOUT_MS;
  const now = o.now || Date.now;
  const httpModule = o.httpModule || http;
  return new Promise(resolve => {
    const startedAt = now();
    let settled = false;
    const finish = payload => {
      if (settled) return;
      settled = true;
      resolve(Object.assign({ durationMs: now() - startedAt }, payload));
    };
    const request = httpModule.get({
      host: '127.0.0.1', port: o.port, path: '/', timeout: timeoutMs,
    }, response => {
      response.resume();
      finish({ ok: true, httpStatus: response.statusCode == null ? null : response.statusCode, error: null });
    });
    request.on('timeout', () => request.destroy(
      Object.assign(new Error(`no response within ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
    request.on('error', error => finish({ ok: false, httpStatus: null, error: errorOf(error) }));
  });
}

async function lookupHost(options) {
  const o = options || {};
  const startedAt = (o.now || Date.now)();
  try {
    const answers = await withTimeout(
      (o.lookup || dns.promises.lookup)(o.host, { all: true, verbatim: true }),
      o.timeoutMs, `DNS lookup of ${o.host}`);
    const addresses = answers.map(a => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
    return {
      addresses,
      durationMs: (o.now || Date.now)() - startedAt,
      error: null,
      fakeIp: addresses.some(item => isFakeIp(item.address)),
    };
  } catch (error) {
    return {
      addresses: [], durationMs: (o.now || Date.now)() - startedAt,
      error: errorOf(error, 'dns'), fakeIp: false,
    };
  }
}

// 对一个具体地址做 TCP + TLS 握手，两段耗时分开记；失败时 phase 说明断在 TCP 还是 TLS。
function probeTlsHandshake(options) {
  const o = options || {};
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  const now = o.now || Date.now;
  const tlsModule = o.tlsModule || tls;
  return new Promise(resolve => {
    const startedAt = now();
    let tcpMs = null;
    let settled = false;
    const socket = tlsModule.connect({
      host: o.address, port: 443, servername: o.host, timeout: timeoutMs,
    });
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve(Object.assign({
        address: o.address, family: o.family, tcpMs, tlsMs: null, error: null,
      }, result));
    };
    socket.once('connect', () => { tcpMs = now() - startedAt; });
    socket.once('secureConnect', () => finish({
      tlsMs: now() - startedAt,
      protocol: typeof socket.getProtocol === 'function' ? socket.getProtocol() : null,
    }));
    socket.once('timeout', () => finish({
      error: errorOf(Object.assign(new Error(`no progress within ${timeoutMs}ms`), { code: 'ETIMEDOUT' }),
        tcpMs === null ? 'tcp' : 'tls'),
    }));
    socket.once('error', error => finish({ error: errorOf(error, tcpMs === null ? 'tcp' : 'tls') }));
  });
}

// 一次真实 HTTPS GET（走 Node 默认地址选择，与内嵌后端发请求的方式一致）。
function probeHttps(options) {
  const o = options || {};
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  const now = o.now || Date.now;
  const httpsModule = o.httpsModule || https;
  return new Promise(resolve => {
    const startedAt = now();
    let settled = false;
    const finish = payload => {
      if (settled) return;
      settled = true;
      resolve(Object.assign({ durationMs: now() - startedAt }, payload));
    };
    const request = httpsModule.get({ host: o.host, path: '/', timeout: timeoutMs, agent: false }, response => {
      response.resume();
      const serverDate = Date.parse((response.headers && response.headers.date) || '');
      const finishedAt = now();
      finish({
        httpStatus: response.statusCode == null ? null : response.statusCode,
        remote: response.socket && response.socket.remoteAddress
          ? {
            address: response.socket.remoteAddress,
            family: response.socket.remoteFamily === 'IPv6' ? 6 : 4,
          }
          : null,
        error: null,
        // Date 头只到秒；偏差在几秒内都算准确，结论只看大偏差。
        clockSkewMs: Number.isFinite(serverDate) ? Math.round(finishedAt - serverDate) : null,
      });
    });
    request.on('timeout', () => request.destroy(
      Object.assign(new Error(`no response within ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
    request.on('error', error => finish({
      httpStatus: null, remote: null, error: errorOf(error, 'http'), clockSkewMs: null,
    }));
  });
}

async function probeHost(options) {
  const o = options || {};
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  const now = o.now || Date.now;
  const dnsResult = await lookupHost({
    host: o.host, lookup: o.lookup, timeoutMs, now,
  });
  const targets = [4, 6]
    .map(family => dnsResult.addresses.find(item => item.family === family))
    .filter(Boolean);
  const [connections, httpsResult] = await Promise.all([
    Promise.all(targets.map(target => probeTlsHandshake({
      host: o.host, address: target.address, family: target.family,
      timeoutMs, now, tlsModule: o.tlsModule,
    }))),
    dnsResult.error ? Promise.resolve(null) : probeHttps({
      host: o.host, timeoutMs, now, httpsModule: o.httpsModule,
    }),
  ]);
  return { host: o.host, dns: dnsResult, connections, https: httpsResult };
}

function readProxyEnv(env) {
  const found = {};
  for (const name of PROXY_ENV_NAMES) {
    const value = env[name] == null ? env[name.toLowerCase()] : env[name];
    if (typeof value === 'string' && value.trim()) found[name] = maskProxyCredentials(value.trim());
  }
  return found;
}

/**
 * 跑一次自检。
 * backend 是后端此刻的状态（{ status, port, error }）；resolveSystemProxy(url) 返回
 * 系统代理解析结果（Electron 的 session.resolveProxy），不可用时传 null。
 */
async function runSelfCheck(options) {
  const o = options || {};
  const timeoutMs = Number(o.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const now = o.now || Date.now;
  const hosts = Array.isArray(o.hosts) && o.hosts.length ? o.hosts : DEFAULT_HOSTS;
  const startedAt = now();

  const backendCheck = (async () => {
    if (!o.backend) return null;
    const probe = o.backend.status === 'running' && o.backend.port
      ? await probeLocalBackend({ port: o.backend.port, now, httpModule: o.httpModule })
      : null;
    return {
      status: o.backend.status, port: o.backend.port == null ? null : o.backend.port,
      error: o.backend.error == null ? null : o.backend.error, probe,
    };
  })();

  const proxyCheck = (async () => {
    let system = null;
    if (typeof o.resolveSystemProxy === 'function' && hosts.length > 0) {
      try {
        system = await withTimeout(
          Promise.resolve(o.resolveSystemProxy(`https://${hosts[0]}`)),
          timeoutMs, 'system proxy lookup');
      } catch (error) {
        system = `unavailable: ${errorOf(error).message}`;
      }
    }
    return { env: readProxyEnv(o.env || process.env), system: typeof system === 'string' ? system : null };
  })();

  const [backendResult, proxyResult, hostResults] = await Promise.all([
    backendCheck,
    proxyCheck,
    Promise.all(hosts.map(host => probeHost({
      host, timeoutMs, now,
      lookup: o.lookup, tlsModule: o.tlsModule, httpsModule: o.httpsModule,
    }))),
  ]);

  return {
    runtime: o.runtime || 'node',
    startedAt,
    durationMs: now() - startedAt,
    backend: backendResult,
    proxy: proxyResult,
    hosts: hostResults,
  };
}

module.exports = {
  DEFAULT_HOSTS,
  DEFAULT_TIMEOUT_MS,
  BACKEND_TIMEOUT_MS,
  PROXY_ENV_NAMES,
  isFakeIp,
  maskProxyCredentials,
  readProxyEnv,
  probeLocalBackend,
  lookupHost,
  probeHost,
  probeTlsHandshake,
  probeHttps,
  runSelfCheck,
};
