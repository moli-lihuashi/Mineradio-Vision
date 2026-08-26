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
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = String((req && req.url) || '');
      const allowCors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, allowCors);
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, allowCors);
        res.end('method not allowed');
        return;
      }
      if (url === '/' || url.indexOf('/health') === 0) {
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, allowCors));
        res.end(JSON.stringify({ ok: true, service: 'mineradio-login-pack-qr' }));
        return;
      }
      if (url.indexOf('/p/' + token) !== 0) {
        res.writeHead(404, allowCors);
        res.end('not found');
        return;
      }
      if (!activeSession || activeSession.token !== token) {
        res.writeHead(410, allowCors);
        res.end('expired');
        return;
      }
      if (Date.now() > activeSession.expiresAt || activeSession.consumed) {
        stopLoginPackQrSession();
        res.writeHead(410, allowCors);
        res.end('expired');
        return;
      }
      activeSession.consumed = true;
      res.writeHead(200, Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      }, allowCors));
      res.end(payloadText);
      stopLoginPackQrSession();
    });
    server.on('error', (err) => {
      resolve({ ok: false, error: err.message || 'QR_SYNC_SERVER_FAILED', message: '局域网同步服务启动失败' });
    });
    server.listen(0, '0.0.0.0', async () => {
      const address = server.address();
      const port = address && address.port;
      const url = 'http://' + host + ':' + port + '/p/' + token;
      let qrDataUrl = '';
      try {
        const QRCode = require('qrcode');
        qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
      } catch (e) {
        qrDataUrl = '';
      }
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
    });
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
