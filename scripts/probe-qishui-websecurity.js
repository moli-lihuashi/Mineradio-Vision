'use strict';

/**
 * 实测 webSecurity 对汽水「取二维码」链路的实际影响（只读，不写任何凭据）。
 *
 * 背景：qishui-auth-v6.js:268 全局 webSecurity:false。要判断能不能摘，
 * 唯一可靠办法是真的起一个 Electron 窗口、真的走一遍 get_qrcode 请求。
 *
 * 用法：
 *   node scripts/probe-qishui-websecurity.js                 # 保持现状 false（基线）
 *   node scripts/probe-qishui-websecurity.js --web-security=true   # 打开 webSecurity
 *
 * 判据：两种模式下 get_qrcode 是否都能拿到 token + qrcode。
 *   - 两种都成功 → webSecurity:false 对取码链路非必需，可收窄/摘除
 *   - 只有 false 成功 → 确认必需，只能收窄作用域不能摘
 */

const path = require('path');
const { app, BrowserWindow, session } = require('electron');

const APP_ROOT = path.resolve(__dirname, '..');

function argFlag(name) {
  const argv = process.argv.slice(2);
  // 同时支持 `--flag value` 与 `--flag=value` 两种写法
  const inline = argv.find(a => a.startsWith(name + '='));
  let raw;
  if (inline) {
    raw = inline.slice(name.length + 1);
  } else {
    const idx = argv.indexOf(name);
    if (idx < 0) return null;
    raw = argv[idx + 1];
  }
  if (raw == null) return true;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

const WEB_SECURITY = argFlag('--web-security') === true;
// 生产代码在 qishui-auth-v6.js:208-216 用 onHeadersReceived 注入 ACAO。
// 探针必须能单独开关它，否则无法区分「webSecurity 在起作用」和「ACAO 在起作用」。
const INJECT_ACAO = argFlag('--inject-acao') !== false;
// 官方预检只回 Access-Control-Allow-Methods，不回 Allow-Headers；
// 我们请求带 x-tt-passport-verify-portrait 等自定义头 → 预检必挂。
// 这个开关补全 Allow-Headers / Allow-Methods，用来验证「补全 CORS 后能否摘掉 webSecurity:false」。
const FULL_CORS = argFlag('--full-cors') === true;
// #16 修法：把 ACAO 从 `*` 收窄到我们自己的源（asset server 的 127.0.0.1 origin）。
// 必须实测「收窄后取码仍成功」，否则等于用一个洞换另一个洞。
const NARROW_ORIGIN = argFlag('--narrow-origin') === true;
// 用真实模块跑 getQrCode()，验证的是生产代码本身（含 a_bogus 签名链路），
// 而不是探针里手搓的裸 XHR。这是「收窄后取码是否真的还能用」的唯一可信判据。
const REAL_MODULE = argFlag('--real-module') === true;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 ' +
  'Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

const AUTH_PARTITION = 'persist:mineradio-qishui-auth-probe';
const ASSET_DIR = path.join(APP_ROOT, 'qishui-auth-v6');

let server = null;
let assetBase = '';

function startAssetServer() {
  const http = require('http');
  const fs = require('fs');
  const ASSETS = new Map([
    ['security_seed.html', 'text/html; charset=utf-8'],
    ['security_host.html', 'text/html; charset=utf-8'],
    ['react.js', 'text/javascript; charset=utf-8'],
    ['react-dom.js', 'text/javascript; charset=utf-8'],
    ['sdk-glue.js', 'text/javascript; charset=utf-8'],
    ['bdms.js', 'text/javascript; charset=utf-8'],
  ]);
  const token = require('crypto').randomBytes(18).toString('hex');
  server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const prefix = '/' + token + '/';
      if (!url.pathname.startsWith(prefix)) return res.writeHead(404).end('nf');
      const name = url.pathname.slice(prefix.length);
      const type = ASSETS.get(name);
      if (!type) return res.writeHead(404).end('nf');
      const file = path.join(ASSET_DIR, name);
      if (!fs.existsSync(file)) return res.writeHead(500).end('missing');
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
    } catch (e) {
      res.writeHead(500).end('err');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      assetBase = `http://127.0.0.1:${server.address().port}/${token}/`;
      resolve();
    });
  });
}

async function main() {
  await app.whenReady();
  await startAssetServer();

  // --real-module：让生产模块自己建窗口、自己签名，探针只负责看结果。
  // 这条路验证的是「改完之后取码还灵不灵」，比手搓 XHR 可信得多。
  if (REAL_MODULE) {
    return runRealModule();
  }

  const authSession = session.fromPartition(AUTH_PARTITION);
  authSession.webRequest.onBeforeRequest(
    { urls: ['https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js'] },
    (_d, cb) => cb({ redirectURL: assetBase + 'bdms.js' }),
  );
  if (INJECT_ACAO) {
    authSession.webRequest.onHeadersReceived(
      { urls: ['https://api.qishui.com/*', 'https://verify.zijieapi.com/*', 'https://auth.zijieapi.com/*'] },
      (details, callback) => {
        const headers = { ...(details.responseHeaders || {}) };
        // 收窄模式只放行 asset server 自己的 origin。
        // 注意：onHeadersReceived 的 details 里拿不到 Origin 请求头（实测为空），
        // 因此改为直接回显 selfOrigin —— 页面本身只能来自 assetBase（下方有
        // will-navigate 守卫），Origin 必然等于 selfOrigin；若窗口被导航到外部站点，
        // 浏览器会因 Origin 不匹配而拒绝，属于安全失败。
        const selfOrigin = new URL(assetBase).origin;
        if (NARROW_ORIGIN) {
          headers['Access-Control-Allow-Origin'] = [selfOrigin];
          headers['Access-Control-Expose-Headers'] = ['*'];
          headers['Vary'] = ['Origin'];
        } else {
          headers['Access-Control-Allow-Origin'] = ['*'];
          headers['Access-Control-Expose-Headers'] = ['*'];
        }
        if (FULL_CORS) {
          // 回显预检请求声明的头，否则带自定义头的 XHR 在 webSecurity:true 下必被拦。
          const requested = Object.entries(details.responseHeaders || {})
            .find(([k]) => k.toLowerCase() === 'access-control-request-headers');
          headers['Access-Control-Allow-Headers'] = [
            requested && requested[1] && requested[1][0]
              ? requested[1][0]
              : 'Content-Type, x-tt-passport-verify-portrait, x-tt-passport-trace-id, x-tt-trace-id, x-ss-stub',
          ];
          headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
          headers['Access-Control-Max-Age'] = ['600'];
          // 官方二次验证组件内部的 axios 硬编码 withCredentials:true。
          // 带凭据的跨源请求要求 ACAO 是具体 origin（不能是 *）且同时有
          // Allow-Credentials:true，只给前者浏览器直接判失败 → 页面看到
          // Network Error。此前这条分支漏了这个头，导致本探针测不出该问题。
          // 只在 ACAO 已收窄（NARROW_ORIGIN）时加：与 * 组合是非法配对。
          if (NARROW_ORIGIN) {
            headers['Access-Control-Allow-Credentials'] = ['true'];
          }
        }
        callback({ responseHeaders: headers });
      },
    );
  }

  const win = new BrowserWindow({
    show: false,
    width: 980,
    height: 760,
    webPreferences: {
      partition: AUTH_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: WEB_SECURITY,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(UA);

  const cspErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    const text = String(message || '');
    if (/CORS|Cross-Origin|Access-Control|blocked/i.test(text)) cspErrors.push(text.slice(0, 200));
  });

  await win.loadURL(assetBase + 'security_seed.html');
  let msToken = await win.webContents.executeJavaScript(
    `localStorage.getItem('xmsty') || localStorage.getItem('xmst') || ''`, true,
  );
  if (!/^[A-Za-z0-9_-]{118}==$/.test(String(msToken || ''))) {
    msToken = require('crypto').randomBytes(88).toString('base64url') + '==';
  }
  await win.webContents.executeJavaScript(
    `localStorage.setItem('xmst', ${JSON.stringify(msToken)});
     localStorage.setItem('xmsty', ${JSON.stringify(msToken)}); true`, true,
  );
  await win.loadURL(assetBase + 'security_host.html');

  // 直接走一次真实的 get_qrcode（和线上同一条 window.__qishuiRequest 通道）
  const url = 'https://api.qishui.com/passport/web/get_qrcode/'
    + '?aid=386088&next=https%3A%2F%2Fapi.qishui.com&need_logo=false&need_short_url=false'
    + `&msToken=${encodeURIComponent(msToken)}`;

  let result;
  try {
    result = await win.webContents.executeJavaScript(
      `window.__qishuiRequest(${JSON.stringify({
        method: 'GET',
        url,
        headers: {
          Accept: 'application/json, text/javascript',
          'User-Agent': UA,
          'x-tt-passport-verify-portrait': 'probe-' + Date.now() + '.login',
        },
        timeout: 20000,
      })})`, true,
    );
  } catch (err) {
    result = { status: 0, error: String(err && err.message || err) };
  }

  let parsed = null;
  try { parsed = JSON.parse(result.body || '{}'); } catch (_) {}

  const out = {
    webSecurity: WEB_SECURITY,
    injectAcao: INJECT_ACAO,
    fullCors: FULL_CORS,
    narrowOrigin: NARROW_ORIGIN,
    realModule: REAL_MODULE,
    httpStatus: result.status,
    transportError: result.error || null,
    message: parsed && parsed.message || null,
    errorCode: parsed && parsed.data && parsed.data.error_code,
    gotToken: !!(parsed && parsed.data && parsed.data.token),
    gotQrcode: !!(parsed && parsed.data && parsed.data.qrcode),
    corsConsoleErrors: cspErrors.slice(0, 5),
  };
  console.log('=== QISHUI WEBSECURITY PROBE ===');
  console.log(JSON.stringify(out, null, 2));

  const ok = out.gotToken && out.gotQrcode;
  console.log(ok
    ? `[PASS] webSecurity=${WEB_SECURITY} 下取二维码成功`
    : `[FAIL] webSecurity=${WEB_SECURITY} 下取二维码失败`);

  try { win.destroy(); } catch (_) {}
  if (server) await new Promise(r => server.close(r));
  app.exit(ok ? 0 : 1);
}

async function runRealModule() {
  const auth = require(path.join(APP_ROOT, 'qishui-auth-v6.js'));
  const config = {};
  auth.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  let envelope = null;
  let failure = null;
  const startedAt = Date.now();
  try {
    envelope = await auth.getQrCode();
  } catch (err) {
    failure = String(err && err.message || err);
  }
  const data = envelope && envelope.data || {};
  const out = {
    mode: 'real-module',
    webSecurityFromSource: readSourceWebSecurity(),
    elapsedMs: Date.now() - startedAt,
    failure,
    message: envelope && envelope.message || null,
    errorCode: data.error_code,
    gotToken: Boolean(data.token),
    gotQrcode: Boolean(data.qrcode && String(data.qrcode).startsWith('data:image/')),
    scanUrlHost: (() => { try { return new URL(data.scan_url).host; } catch (_) { return null; } })(),
  };
  console.log('=== QISHUI REAL-MODULE PROBE ===');
  console.log(JSON.stringify(out, null, 2));
  const ok = out.gotToken && out.gotQrcode;
  console.log(ok
    ? '[PASS] 生产模块取二维码成功（含 a_bogus 签名链路）'
    : '[FAIL] 生产模块取二维码失败');
  try { await auth.clear(); } catch (_) {}
  app.exit(ok ? 0 : 1);
}

// 直接读源码里 webSecurity 的实际取值，避免「探针开了 true 但生产代码还是 false」的自欺。
function readSourceWebSecurity() {
  try {
    const source = require('fs').readFileSync(path.join(APP_ROOT, 'qishui-auth-v6.js'), 'utf8');
    const match = source.match(/webSecurity\s*:\s*([A-Za-z0-9_.$]+)/);
    return match ? match[1] : 'not-found';
  } catch (_) {
    return 'read-error';
  }
}

main().catch(err => {
  console.error('[probe-error]', err && err.stack || err);
  app.exit(2);
});