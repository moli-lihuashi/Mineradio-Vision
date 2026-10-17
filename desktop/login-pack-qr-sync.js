'use strict';

const http = require('http');
const os = require('os');
const crypto = require('crypto');

let activeSession = null;

function pickLanAddress() {
  const nets = os.networkInterfaces() || {};
  const preferred = [];
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (!net || net.internal || net.family !== 'IPv4') return;
      preferred.push(net.address);
    });
  });
  return preferred.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip))
    || preferred[0]
    || '127.0.0.1';
}

function stopLoginPackQrSession() {
  if (!activeSession) return { ok: true, stopped: true };
  try { activeSession.server.close(); } catch (_) {}
  activeSession = null;
  return { ok: true, stopped: true };
}

function startLoginPackQrSession(opts) {
  opts = opts || {};
  const envelope = opts.envelope;
  const ttlMs = Math.max(60 * 1000, Math.min(10 * 60 * 1000, Number(opts.ttlMs) || 3 * 60 * 1000));
  if (!envelope || typeof envelope !== 'object') {
    return Promise.resolve({ ok: false, error: 'MISSING_ENVELOPE', message: '缺少登录包数据' });
  }
  stopLoginPackQrSession();
  const token = crypto.randomBytes(16).toString('hex');
  const host = pickLanAddress();
  const payloadText = JSON.stringify(envelope);
  // 单 IP 请求预算：合法手机扫码只需要 1 次成功命中，阈值以内的探测/健康检查放行
  const perIpHits = new Map();
  const PER_IP_MAX_HITS = 20;
  function noteIpHit(ip) {
    const n = (perIpHits.get(ip) || 0) + 1;
    perIpHits.set(ip, n);
    return n;
  }
  return new Promise((resolve) => {
    function onListening() {
      let QRCode;
      try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }
      const address = server.address();
      const port = address && address.port;
      const url = 'http://' + host + ':' + port + '/p/' + token;
      let qrDataUrl = '';
      const done = () => {
        activeSession = {
          server,
          token,
          url,
          host,
          port,
          consumed: false,
          expiresAt: Date.now() + ttlMs,
        };
        resolve({
          ok: true,
          url,
          host,
          port,
          token,
          expiresAt: activeSession.expiresAt,
          ttlMs,
          qrDataUrl,
        });
      };
      if (!QRCode || typeof QRCode.toDataURL !== 'function') { done(); return; }
      QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
        .then((data) => { qrDataUrl = data; })
        .catch(() => { qrDataUrl = ''; })
        .then(done);
    }
    const server = http.createServer((req, res) => {
      const url = String((req && req.url) || '');
      // 不带任何 CORS 头：本服务的消费方只有「手机浏览器顶层打开二维码链接」与
      // 「另一台机器的主进程服务端 GET」（importLoginPackFromQrUrl），都不需要跨源读取。
      // 历史版本在此返回 Access-Control-Allow-Origin: *，等于把登录包开放给任意网页跨源拉取，已移除。
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end('method not allowed');
        return;
      }
      const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
      if (url === '/' || url.indexOf('/health') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, service: 'mineradio-login-pack-qr' }));
        return;
      }
      if (url.indexOf('/p/') !== 0) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      // 速率预算作用于 /p/ 前缀命中（含错误 token 的爆破尝试），放在精确匹配之前；
      // 健康检查与非 /p/ 探测不占用，避免扫码 App 探测把合法手机的一次性拉取挤进 429
      if (noteIpHit(ip) > PER_IP_MAX_HITS) {
        res.writeHead(429);
        res.end('too many requests');
        return;
      }
      if (url.indexOf('/p/' + token) !== 0) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      if (!activeSession || activeSession.token !== token) {
        res.writeHead(410);
        res.end('expired');
        return;
      }
      if (Date.now() > activeSession.expiresAt || activeSession.consumed) {
        stopLoginPackQrSession();
        res.writeHead(410);
        res.end('expired');
        return;
      }
      activeSession.consumed = true;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(payloadText);
      stopLoginPackQrSession();
    });
    // 绑定选定的局域网网卡而非 0.0.0.0：避免登录包同步服务暴露在 VPN/其他网卡接口上。
    // 手机必须经局域网访问本服务（功能前提），无法像纯本地服务那样绑 127.0.0.1；
    // 选定网卡绑定失败（多网卡/VPN 场景）才回退全接口。
    let fellBack = false;
    server.on('error', (err) => {
      if (!fellBack && host !== '0.0.0.0' && err && (err.code === 'EADDRNOTAVAIL' || err.code === 'EACCES')) {
        fellBack = true;
        console.warn('[LoginPackQrSync] bind ' + host + ' failed (' + err.code + '); falling back to 0.0.0.0');
        try { server.listen(0, '0.0.0.0', onListening); } catch (_) {}
        return;
      }
      resolve({ ok: false, error: err.message || 'QR_SYNC_SERVER_FAILED', message: '局域网同步服务启动失败' });
    });
    server.listen(0, host, onListening);
  });
}

function fetchLoginPackEnvelopeFromUrl(targetUrl) {
  const url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return Promise.resolve({ ok: false, error: 'INVALID_URL', message: '请输入以 http:// 开头的同步链接' });
  }
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) {
      resolve({ ok: false, error: 'INVALID_URL', message: '同步链接无效' });
      return;
    }
    const lib = parsed.protocol === 'https:' ? require('https') : http;
    const req = lib.get(parsed, { timeout: 12000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ ok: false, error: 'FETCH_FAILED', message: '拉取登录包失败 (' + res.statusCode + ')' });
          return;
        }
        try {
          const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!envelope || envelope.magic !== 'MINERADIO_LOGIN_PACK_V1') {
            resolve({ ok: false, error: 'INVALID_LOGIN_PACK', message: '不是有效的 Mineradio 登录包' });
            return;
          }
          resolve({ ok: true, envelope });
        } catch (e) {
          resolve({ ok: false, error: 'PARSE_FAILED', message: e.message || '登录包解析失败' });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT', message: '拉取登录包超时' });
    });
    req.on('error', (e) => {
      resolve({ ok: false, error: e.message || 'FETCH_FAILED', message: '无法连接同步链接' });
    });
  });
}

module.exports = {
  startLoginPackQrSession,
  stopLoginPackQrSession,
  fetchLoginPackEnvelopeFromUrl,
  pickLanAddress,
};
