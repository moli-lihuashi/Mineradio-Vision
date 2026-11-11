'use strict';

// Focused authentication port from Wx2yZx/Mineradio-Qishui-QR-Login
// revision aaadaab7d011714f94fbe45b382ba8dcc7cf17b9 (GPL-3.0-only).
// This module intentionally owns only the official Passport Web QR flow.
// Mineradio's catalogue, playlist and playback adapters remain in qishui-api.js.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { BrowserWindow, app, session } = require('electron');
const QRCode = require('qrcode');

const API_BASE = 'https://api.qishui.com';
const AID = '386088';
const APP_VERSION = '3.5.2';
const SDK_VERSION = '2.4.13';
const VERIFY_SDK_VERSION = '1.0.29';
const SECURE_SDK_VERSION = '3.3.5';
const BDMS_VERSION = '1.0.0.41';
const AUTH_PARTITION = 'persist:mineradio-qishui-auth-v6';
const OFFICIAL_BDMS_URL =
  'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 ' +
  'Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

const ASSET_DIR = path.join(__dirname, 'qishui-auth-v6');
// 验证页 XHR 会带这些自定义头。这份清单必须覆盖二次验证组件
// index.umd.production.js 实际会发出的**全部**自定义头，否则那类请求的
// 预检必然失败（页面表现：提交时报 Network Error）。
//
// 清单来源：对官方产物（555005 字节）执行
//   grep -o "x-tt-[a-z-]\{2,40\}" index.umd.production.js | sort -u
// 得到 5 个，其中 3 个曾经缺失，直接导致「发送短信成功、但所有提交
// 全部 Network Error」——因为组件内 axios 是
//   withCredentials:!0, xsrfCookieName:"passport_csrf_token",
//   xsrfHeaderName:"x-tt-passport-csrf-token"
// 首次请求时还没有 passport_csrf_token cookie，axios 不加 CSRF 头，预检
// 能过（所以「发送」成功）；服务端下发该 cookie 之后，每次提交都会带上
// x-tt-passport-csrf-token，预检挂 → 提交被判 Network Error。
//
// 注意：这份清单不能靠「回显预检声明的头」来省事。Electron 的
// OnHeadersReceivedListenerDetails 没有 requestHeaders 字段
// （见 electron.d.ts），任何 details.requestHeaders 读取恒为 undefined，
// 只会静默退回白名单。必须在这里写全。
const ALLOWED_CORS_REQUEST_HEADERS = [
  'Content-Type',
  // 组件 axios 的 xsrfHeaderName：服务端下发 passport_csrf_token 后必带。
  'x-tt-passport-csrf-token',
  // 组件埋点/链路追踪头。
  'x-tt-logid',
  // 组件签名头。
  'x-tt-passport-aid-sign',
  'x-tt-passport-verify-portrait',
  'x-tt-passport-trace-id',
  'x-tt-trace-id',
  'x-ss-stub',
].join(', ');
const ASSETS = new Map([
  ['security_seed.html', 'text/html; charset=utf-8'],
  ['security_host.html', 'text/html; charset=utf-8'],
  ['react.js', 'text/javascript; charset=utf-8'],
  ['react-dom.js', 'text/javascript; charset=utf-8'],
  ['sdk-glue.js', 'text/javascript; charset=utf-8'],
  ['bdms.js', 'text/javascript; charset=utf-8'],
]);

let getConfig = null;
let updateConfig = null;
let runtime = null;

function configure(hooks) {
  getConfig = hooks && hooks.getConfig;
  updateConfig = hooks && hooks.updateConfig;
}

function randomDigits(length, firstMax = 9) {
  let value = String(crypto.randomInt(1, Math.max(2, firstMax + 1)));
  while (value.length < length) value += String(crypto.randomInt(0, 10));
  return value;
}

function ensureIdentity() {
  if (typeof getConfig !== 'function' || typeof updateConfig !== 'function') {
    throw new Error('Qishui V6 auth runtime is not configured');
  }
  const config = getConfig();
  const patch = {};
  if (!config.deviceId) patch.deviceId = randomDigits(16, 8);
  if (!config.installId) patch.installId = randomDigits(15, 8);
  if (!config.verifyPortraitId) patch.verifyPortraitId = crypto.randomUUID() + '.login';
  if (!config.computerName) patch.computerName = os.hostname() || 'Windows-PC';
  if (Object.keys(patch).length) updateConfig(patch);
  const current = getConfig();
  return {
    deviceId: String(current.deviceId),
    installId: String(current.installId),
    verifyPortraitId: String(current.verifyPortraitId),
    computerName: String(current.computerName || 'Windows-PC'),
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBizParams(value) {
  if (!value) return {};
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      const parsed = new URLSearchParams(source);
      return Object.fromEntries(parsed.entries());
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('二次验证 biz_params 格式无效');
  }
  const result = {};
  for (const [key, item] of Object.entries(source)) {
    if (item == null) continue;
    result[String(key)] = typeof item === 'object' ? JSON.stringify(item) : String(item);
  }
  return result;
}

function mergeDecision(envelope) {
  const data = envelope && envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const decision = { ...(envelope || {}), ...data };
  delete decision.data;
  return decision;
}

function officialScanUrl(indexUrl, computerName) {
  const source = new URL(String(indexUrl || ''));
  const token = source.searchParams.get('token');
  if (!token) throw new Error('qrcode_index_url 缺少 token');
  const target = new URL('https://bff-pc.qishui.com/light/invoke/scan_login');
  target.searchParams.set('token', token);
  target.searchParams.set('os', 'Windows');
  target.searchParams.set('computer_name', computerName || 'Windows-PC');
  return target.toString().replace(/\+/g, '%20');
}

function parseCookieString(raw) {
  const result = {};
  String(raw || '').split(';').forEach(pair => {
    const index = pair.indexOf('=');
    if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  });
  return result;
}

function buildCookieString(values) {
  return Object.entries(values)
    .filter(([name]) => name)
    .map(([name, value]) => name + '=' + value)
    .join('; ');
}

class QishuiAuthRuntime {
  constructor() {
    this.window = null;
    this.authSession = null;
    this.assetServer = null;
    this.assetBase = '';
    this.assetToken = crypto.randomBytes(18).toString('hex');
    this.msToken = '';
    this.browserInfo = null;
    this.lastPassportRequest = null;
    this.initializing = null;
    this.destroying = false;
    this.mfaNetworkLog = [];
    // check_qrconnect 响应头里的 Set-Cookie（name=value），登录 cookie 的
    // 独立来源；不落盘明文、不写日志值。
    this._checkQrSetCookiePairs = [];
    this.qrGeneration = 0;
    // 二次验证（2046）去重：同一 token 只弹一次验证窗口，并发轮询复用同一结果。
    this._mfaPromise = null;
    this._mfaToken = '';
    this._mfaDone = false;
    // 终止态（组件失败 / 用户取消）：同一 token 不再重弹，也不再打上游，
    // 否则 2 秒轮询会反复弹窗并把上游打到 rate_limited。
    this._mfaStopToken = '';
    this._mfaStopCode = '';
    this._mfaStopMessage = '';
    // host 页版本比对状态：只在进程内做一次，避免每次 request 都走 IPC。
    this._hostVersionChecked = false;
    this._hostReloading = false;
  }

  async initialize() {
    if (this.window && !this.window.isDestroyed() && this.browserInfo && this.msToken) {
      // 窗口已就绪，但驻留页面的逻辑版本可能落后于磁盘上的 security_host.html
      // （_initialize 只 loadURL 一次，之后页面 JS 常驻内存）。
      // 不重载的话，host 页里的修复对已运行实例完全无效——用户必须重启应用，
      // 而且期间看到的是旧报错。这里按版本号按需重载一次。
      await this.ensureHostPageFresh();
      return true;
    }
    if (this.initializing) return this.initializing;
    this.initializing = this._initialize().finally(() => { this.initializing = null; });
    return this.initializing;
  }

  // 页面版本不一致 → 重载 security_host.html，使 host 页修复即时生效。
  // 重载会丢失页面内存态（bdms/msToken 在 localStorage，不受影响），
  // 因此只在版本确实落后时执行一次，并在失败时降级为「继续用旧页面」，
  // 不让一次重载失败打断登录主流程。
  async ensureHostPageFresh() {
    if (!this.window || this.window.isDestroyed()) return false;
    if (!this.assetBase) return false;
    if (this._hostReloading) return false;
    // initialize() 会被每次 request 调用，不能每次都做一次 IPC 往返。
    // 版本比对只在进程内首次进到这里时做一次；重载成功后置位，后续直接跳过。
    if (this._hostVersionChecked) return false;
    // 每次改 security_host.html 里进主流程的逻辑都要同步 +1，否则
    // 已运行实例的页面 JS 常驻内存，磁盘修复不会生效。
    // v3：__qishuiRequest 开 withCredentials，让上游下发的登录 cookie
    // 能真正写进 authSession（否则扫码确认后恒判「二维码已过期」）。
    const EXPECTED = 3;
    let current = 0;
    try {
      current = await this.window.webContents.executeJavaScript(
        'Number(window.__qishuiHostVersion) || 0', true,
      );
    } catch (_) {
      // 页面可能正在导航或尚未就绪：不在这里强行重载，交给下次调用。
      return false;
    }
    if (Number(current) >= EXPECTED) {
      this._hostVersionChecked = true;
      return false;
    }
    this._hostReloading = true;
    try {
      // 重载后页面的 bdms 需要重新就绪，后续 request() 才有签名能力。
      await this.window.loadURL(this.assetBase + 'security_host.html');
      await this.waitForBdms();
      this.browserInfo = await this.window.webContents.executeJavaScript(
        'window.__qishuiBrowserInfo()', true,
      );
      this._mfaToken = '';
      this._mfaDone = false;
      this._mfaStopToken = '';
      this._mfaStopCode = '';
      this._mfaStopMessage = '';
      this._hostVersionChecked = true;
      return true;
    } catch (_) {
      // 重载失败：不置位，允许下次再试；但也不阻塞本次登录。
      return false;
    } finally {
      this._hostReloading = false;
    }
  }

  async _startAssetServer() {
    if (this.assetServer) return;
    this.assetServer = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const prefix = '/' + this.assetToken + '/';
        if (!url.pathname.startsWith(prefix)) {
          response.writeHead(404).end('not found');
          return;
        }
        const name = url.pathname.slice(prefix.length);
        const type = ASSETS.get(name);
        if (!type) {
          response.writeHead(404).end('not found');
          return;
        }
        const file = path.join(ASSET_DIR, name);
        if (!fs.existsSync(file)) {
          response.writeHead(500).end('missing auth asset');
          return;
        }
        response.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(file).pipe(response);
      } catch (_) {
        response.writeHead(500).end('asset error');
      }
    });
    await new Promise((resolve, reject) => {
      this.assetServer.once('error', reject);
      this.assetServer.listen(0, '127.0.0.1', resolve);
    });
    const address = this.assetServer.address();
    this.assetBase = `http://127.0.0.1:${address.port}/${this.assetToken}/`;
  }

  _installSessionHooks() {
    const authSession = this.authSession;
    authSession.webRequest.onBeforeRequest(
      { urls: [OFFICIAL_BDMS_URL] },
      (_details, callback) => callback({ redirectURL: this.assetBase + 'bdms.js' }),
    );
    // 官方接口不发 Access-Control-Allow-Origin（实测预检只回
    // Access-Control-Allow-Methods，连 Allow-Headers 都没有），而验证页的
    // XHR 带 x-tt-passport-verify-portrait 等自定义头，预检必挂。
    // 这里补齐 CORS，使窗口可以安全地开启 webSecurity。
    //
    // 收窄点：只回显本页自己的 origin（asset server 的 127.0.0.1:port），
    // 不再是无条件 `*`。页面只能来自 assetBase（见 _guardNavigation），
    // 因此 Origin 恒等于 selfOrigin；若窗口被导航到外部站点，浏览器会因
    // Origin 不匹配而拒绝 —— 属于安全失败，符合预期。
    authSession.webRequest.onHeadersReceived(
      {
        urls: [
          'https://api.qishui.com/*',
          'https://bff-pc.qishui.com/*',
          'https://verify.zijieapi.com/*',
          'https://auth.zijieapi.com/*',
        ],
      },
      (details, callback) => {
        const headers = { ...(details.responseHeaders || {}) };
        // 从 check_qrconnect 响应头直接留存登录 cookie（只留 name=value，
        // 不写日志、不落盘明文）。
        //
        // 为什么需要第二来源：上游确认登录时是通过 Set-Cookie 下发
        // sessionid / sid_tt 的。跨站请求（本页 127.0.0.1 → api.qishui.com）
        // 遇到 SameSite=Lax/Strict 的 cookie，Chromium 会拒绝写进 cookie jar，
        // 于是 persistSessionCookies() 从 authSession.cookies.get({}) 里
        // 什么也抓不到 → hasLoginCookie() 恒 false → 手机已确认却被判
        // 「二维码已过期」。响应头是主进程能看到的原始数据，不受此限制。
        // 只看真实 POST；预检 OPTIONS 不带 Set-Cookie，若让它写入空数组
        // 会把上一轮真正下发的 cookie 冲掉。
        if (String(details.url || '').includes('/passport/web/check_qrconnect/') &&
            String(details.method || '').toUpperCase() !== 'OPTIONS') {
          const pairs = [];
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() !== 'set-cookie') continue;
            for (const raw of (headers[key] || [])) {
              const first = String(raw || '').split(';')[0].trim();
              if (first && first.includes('=')) pairs.push(first);
            }
          }
          this._checkQrSetCookiePairs = pairs;
          try {
            const _envCookieFile = process.env.KUGOU_COOKIE_FILE || process.env.COOKIE_FILE || '';
            const _logPath = _envCookieFile
              ? path.join(path.dirname(_envCookieFile), 'cookie-debug.log')
              : path.join(app.getPath('userData'), 'cookie-debug.log');
            // 只记名称，绝不记值。
            const names = pairs.map(p => p.split('=')[0]);
            fs.appendFileSync(
              _logPath,
              '[' + new Date().toISOString() + '] [QishuiSetCookie] status=' + details.statusCode +
              ' count=' + pairs.length + ' names=' + names.join(',') + '\n',
              'utf8',
            );
          } catch (_) {}
        }
        // 先按**小写名**清掉上游自带的全部 CORS 头，再写我们自己的一份。
        //
        // 为什么必须清：部分宿主（实测 verify.zijieapi.com 的预检响应）上游
        // 自己就带 `access-control-allow-origin: *`（小写键）。HTTP 头名大小写
        // 不敏感，但 responseHeaders 是普通对象、按字符串键存放，直接写
        // `headers['Access-Control-Allow-Origin']` 会留下两个键：
        //   Access-Control-Allow-Origin: http://127.0.0.1:port   ← 我们注入
        //   access-control-allow-origin: *                       ← 上游自带
        // 浏览器合并后读到「origin, *」两个值 → 带 credentials 的 CORS 判定
        // 直接失败，页面表现是 net::ERR_FAILED / Network Error。
        // 这正是 api.qishui.com 能通、verify.zijieapi.com 全挂的差别。
        //
        // 只清 access-control-* 与 Vary，其他响应头一律保留。
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (lower.startsWith('access-control-') || lower === 'vary') {
            delete headers[key];
          }
        }
        let selfOrigin = '';
        try { selfOrigin = new URL(this.assetBase).origin; } catch (_) {}
        if (selfOrigin) {
          headers['Access-Control-Allow-Origin'] = [selfOrigin];
          headers['Vary'] = ['Origin'];
        }
        // 无条件回全量白名单，不再尝试「回显预检声明的头」。
        // 原因：Electron 的 OnHeadersReceivedListenerDetails 没有
        // requestHeaders 字段（见 electron.d.ts 该 interface 定义），
        // 旧代码 `(details.requestHeaders || {})['Access-Control-Request-Headers']`
        // 恒为 undefined，所以一直是静默走兜底——看起来「自动适配」其实没有。
        // 而兜底清单当时漏了 x-tt-passport-csrf-token / x-tt-logid /
        // x-tt-passport-aid-sign 三个头，组件提交时的预检全部失败。
        // 回全量清单是安全的：Allow-Headers 只是声明「允许带哪些头」，
        // 不放大任何请求能力，真正把住跨源边界的是上面的 ACAO 收窄。
        headers['Access-Control-Allow-Headers'] = [ALLOWED_CORS_REQUEST_HEADERS];
        headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
        headers['Access-Control-Max-Age'] = ['600'];
        headers['Access-Control-Expose-Headers'] = ['*'];
        // 必须补 Allow-Credentials：官方二次验证组件内部的 axios 是硬编码
        // withCredentials:true（index.umd.production.js 里
        // tj.create({withCredentials:!0,...})），带凭据的跨源请求在
        // webSecurity:true 下要求响应同时具备
        //   ACAO=<具体 origin>（不能是 *） + Access-Control-Allow-Credentials:true
        // 只给前者会被浏览器直接判失败，页面表现就是组件内所有请求
        // 「Network Error」，短信/密码验证都无法提交。
        // 注意：ACAO 已在上面收窄到 selfOrigin，与 credentials 组合是合法配对；
        // 若回退成 *，这一行会让请求变成非法组合，故两者必须同时存在。
        if (selfOrigin) {
          headers['Access-Control-Allow-Credentials'] = ['true'];
        }
        callback({ responseHeaders: headers });
      },
    );
    authSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://api.qishui.com/passport/*'] },
      (details, callback) => {
        this.lastPassportRequest = {
          method: details.method,
          url: details.url,
          requestHeaders: details.requestHeaders,
        };
        callback({ requestHeaders: details.requestHeaders });
      },
    );
    const mfaUrls = ['https://api.qishui.com/passport/*', 'https://verify.zijieapi.com/passport/*'];
    authSession.webRequest.onCompleted({ urls: mfaUrls }, details => {
      this.mfaNetworkLog.push({ at: Date.now(), method: details.method, endpoint: this.safeEndpoint(details.url), statusCode: details.statusCode });
      if (this.mfaNetworkLog.length > 100) this.mfaNetworkLog.shift();
    });
    authSession.webRequest.onErrorOccurred({ urls: mfaUrls }, details => {
      this.mfaNetworkLog.push({ at: Date.now(), method: details.method, endpoint: this.safeEndpoint(details.url), error: details.error });
      if (this.mfaNetworkLog.length > 100) this.mfaNetworkLog.shift();
    });
  }

  // webSecurity:true 的前提：窗口必须始终停在本地 asset 页。
  // 一旦被导航到外部站点，CORS 收窄（只回显 selfOrigin）会让请求全部失败——
  // 这是安全失败，但用户会看到白屏。因此显式拦住外部导航并记录原因。
  _guardNavigation() {
    const contents = this.window.webContents;
    const isLocalAsset = url => {
      try {
        const parsed = new URL(String(url));
        return this.assetBase && parsed.href.startsWith(this.assetBase);
      } catch (_) {
        return false;
      }
    };
    contents.on('will-navigate', (event, url) => {
      if (isLocalAsset(url)) return;
      event.preventDefault();
      this.navigationBlocked = { at: Date.now(), url: this.safeEndpoint(url), reason: 'external-navigation' };
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
  }

  safeEndpoint(rawUrl) {
    try {
      const value = new URL(rawUrl);
      return value.origin + value.pathname;
    } catch (_) {
      return String(rawUrl || '').split('?')[0];
    }
  }

  async _initialize() {
    if (!app.isReady()) await app.whenReady();
    ensureIdentity();
    await this._startAssetServer();
    this.authSession = session.fromPartition(AUTH_PARTITION);
    // 启动指纹：每次真正装 CORS hook 都留一条明文记录。
    // 主进程 .js 是 require 时加载的，改磁盘对**已运行实例无效**；而本应用
    // 有单实例锁，用户「重新打开」只会聚焦旧窗口、新进程自行退出，看起来
    // 像重启了其实没有。有了这行，就能从日志直接判断当前进程装的是哪一版
    // 白名单（缺 3 个头的旧版 vs 补全后的新版），不必再靠猜。
    // 指纹只记头名清单，不含 cookie / token / msToken。
    try {
      // 真实应用已在 desktop/main.js 设好 KUGOU_COOKIE_FILE（指向
      // <stableUserData>/.kugou-cookie），dirname 后与 server.js 的
      // cookie-debug.log 是同一份；探针进程没设该变量，直接写 userData。
      const _envCookieFile = process.env.KUGOU_COOKIE_FILE || process.env.COOKIE_FILE || '';
      let _logPath;
      if (_envCookieFile) {
        _logPath = path.join(path.dirname(_envCookieFile), 'cookie-debug.log');
      } else {
        try { _logPath = path.join(app.getPath('userData'), 'cookie-debug.log'); }
        catch (_) { _logPath = path.join(__dirname, '..', 'cookie-debug.log'); }
      }
      fs.appendFileSync(
        _logPath,
        '[' + new Date().toISOString() + '] [QishuiCORS] hook-installed pid=' +
        process.pid + ' allowHeaders=' + ALLOWED_CORS_REQUEST_HEADERS + '\n',
        'utf8',
      );
    } catch (_) {}
    this._installSessionHooks();
    this.window = new BrowserWindow({
      show: false,
      width: 980,
      height: 760,
      minWidth: 760,
      minHeight: 600,
      title: '汽水音乐安全验证',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: AUTH_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // #15 已修：原先这里是 webSecurity:false（全局关同源策略），
        // 用来绕过官方接口缺 ACAO 导致的 CORS 失败。
        // 现改为在 _installSessionHooks() 里补齐 CORS 头（且收窄到本页 origin），
        // 因此可以恢复 webSecurity:true。实测见 scripts/probe-qishui-websecurity.js。
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    this.window.setMenuBarVisibility(false);
    this.window.webContents.setUserAgent(UA);
    this._guardNavigation();
    this.window.on('close', event => {
      if (this.destroying) return;
      event.preventDefault();
      this.window.webContents.executeJavaScript(
        'window.__qishuiCancelSecondVerify && window.__qishuiCancelSecondVerify()',
      ).catch(() => {});
      this.window.hide();
    });

    await this.window.loadURL(this.assetBase + 'security_seed.html');
    let storedToken = await this.window.webContents.executeJavaScript(
      `localStorage.getItem('xmsty') || localStorage.getItem('xmst') || ''`,
      true,
    );
    if (!/^[A-Za-z0-9_-]{118}==$/.test(String(storedToken || ''))) {
      storedToken = crypto.randomBytes(88).toString('base64url') + '==';
    }
    this.msToken = String(storedToken);
    await this.window.webContents.executeJavaScript(
      `localStorage.setItem('xmst', ${JSON.stringify(this.msToken)});
       localStorage.setItem('xmsty', ${JSON.stringify(this.msToken)}); true`,
      true,
    );
    await this.window.loadURL(this.assetBase + 'security_host.html');
    // decision.url 的域名白名单可由环境变量追加（官方换 CDN 时不必改代码）。
    // 用 did-finish-load 也覆盖后续重载，避免页面刷新后白名单丢失。
    const extraVerifyScriptHosts = String(process.env.MINERADIO_QISHUI_VERIFY_SCRIPT_HOSTS || '').trim();
    if (extraVerifyScriptHosts) {
      const injectVerifyHosts = () => {
        this.window.webContents.executeJavaScript(
          `window.__mineradioVerifyScriptHosts = ${JSON.stringify(extraVerifyScriptHosts)}; true`,
          true,
        ).catch(() => {});
      };
      this.window.webContents.on('did-finish-load', injectVerifyHosts);
      injectVerifyHosts();
    }
    await this.waitForBdms();
    this.browserInfo = await this.window.webContents.executeJavaScript('window.__qishuiBrowserInfo()', true);
    updateConfig({ msToken: this.msToken });
    // 刚 loadURL 过，页面一定是最新的：直接置位，省掉首次请求时的一次 IPC 比对。
    this._hostVersionChecked = true;
    return true;
  }

  async waitForBdms(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.window.webContents.executeJavaScript(`({
        glue: window._sdkGlueVersionMap && window._sdkGlueVersionMap.sdkGlueVersion,
        bdms: window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion,
        loaded: Boolean(window.bdms)
      })`);
      if (last && last.loaded && last.bdms) return last;
      await delay(100);
    }
    throw new Error('汽水安全组件初始化超时：bdms 1.0.0.41 未就绪');
  }

  commonParams(identity) {
    return {
      passport_jssdk_version: SDK_VERSION,
      passport_jssdk_type: 'normal',
      is_from_ttaccountsdk: '1',
      aid: AID,
      language: 'zh',
      account_sdk_source: 'web',
      p_js_v: SDK_VERSION,
      p_js_t: 'pro',
      p_zt: SECURE_SDK_VERSION,
      p_ver: VERIFY_SDK_VERSION,
      request_host: 'app%3A%2F%2Fresources',
      p_bd: BDMS_VERSION,
      biz_trace_id: crypto.randomBytes(4).toString('hex'),
      is_new_login: '1',
      is_from_iesaccountsaas: '1',
      device_id: identity.deviceId,
      install_id: identity.installId,
      did: identity.deviceId,
      iid: identity.installId,
      device_platform: 'PC',
      version_code: APP_VERSION,
      account_sdk_source_info: String(this.browserInfo.encrypted),
      msToken: this.msToken,
    };
  }

  requestHeaders(identity, bizTraceId) {
    const traceId = crypto.randomBytes(16).toString('hex');
    return {
      Accept: 'application/json, text/javascript',
      'User-Agent': UA,
      'x-tt-passport-verify-portrait': identity.verifyPortraitId,
      'x-tt-passport-trace-id': bizTraceId,
      'x-tt-trace-id': `00-${traceId}-${traceId.slice(0, 16)}-01`,
    };
  }

  async request(method, pathname, params, data) {
    await this.initialize();
    const identity = ensureIdentity();
    const query = { ...this.commonParams(identity), ...(params || {}) };
    const url = new URL(pathname, API_BASE);
    for (const [name, value] of Object.entries(query)) {
      if (value != null) url.searchParams.set(name, String(value));
    }
    const headers = this.requestHeaders(identity, query.biz_trace_id);
    let body = null;
    if (data != null) {
      body = new URLSearchParams();
      for (const [name, value] of Object.entries(data)) {
        if (value != null) body.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      body = body.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['x-ss-stub'] = crypto.createHash('md5').update(body).digest('hex').toUpperCase();
    }
    const payload = {
      method: String(method || 'GET').toUpperCase(),
      url: url.toString(),
      headers,
      body,
      timeout: 30000,
    };
    const response = await this.window.webContents.executeJavaScript(
      `window.__qishuiRequest(${JSON.stringify(payload)})`,
      true,
    );
    if (!response || response.status < 200 || response.status >= 400) {
      throw new Error(`汽水登录接口 HTTP ${response && response.status || 0}: ${String(response && response.body || '').slice(0, 300)}`);
    }
    let envelope;
    try {
      envelope = JSON.parse(response.body || '{}');
    } catch (_) {
      throw new Error('汽水登录接口返回了无效 JSON');
    }
    const signedUrl = String(this.lastPassportRequest && this.lastPassportRequest.url || '');
    let signedQuery;
    try {
      signedQuery = new URL(signedUrl).searchParams;
    } catch (_) {
      signedQuery = new URLSearchParams();
    }
    const aBogus = signedQuery.get('a_bogus') || '';
    const signedMsToken = signedQuery.get('msToken') || '';
    if (aBogus.length !== 44 || signedMsToken !== this.msToken) {
      throw new Error('汽水安全参数注入失败：a_bogus 或 msToken 缺失');
    }
    return envelope;
  }

  async getQrCode() {
    this.qrGeneration += 1;
    this._mfaToken = '';
    this._mfaDone = false;
    this._mfaPromise = null;
    this._mfaStopToken = '';
    this._mfaStopCode = '';
    this._mfaStopMessage = '';
    // 新二维码必须丢掉上一轮响应头里留存的 cookie，
    // 否则旧 token 的会话可能被错误合并进新一轮。
    this._checkQrSetCookiePairs = [];
    await this.initialize();
    const identity = ensureIdentity();
    const envelope = await this.request('GET', '/passport/web/get_qrcode/', {
      next: API_BASE,
      need_logo: 'false',
      need_short_url: 'false',
    });
    const data = envelope.data || {};
    if (envelope.message !== 'success' || Number(data.error_code) !== 0) {
      throw new Error(`二维码生成失败：code=${data.error_code} ${data.description || envelope.message || ''}`);
    }
    const scanUrl = officialScanUrl(data.qrcode_index_url, identity.computerName);
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#000000', light: '#ffffff' },
    });
    envelope.data = { ...data, qrcode: qrDataUrl, scan_url: scanUrl };
    return envelope;
  }

  // 记录二次验证的终止态：同一 token 之后不再弹窗、不再请求上游。
  _markMfaStop(tokenKey, code, message) {
    this._mfaStopToken = String(tokenKey || '');
    this._mfaStopCode = String(code || 'QISHUI_MFA_CANCELLED');
    this._mfaStopMessage = String(message || '二次验证未完成');
  }

  async secondVerify(decision, identity) {
    this.mfaNetworkLog = [];
    this.window.setTitle('汽水音乐安全验证');
    this.window.setSize(980, 760);
    this.window.center();
    this.window.show();
    this.window.focus();
    let failed = false;
    try {
      return await this.window.webContents.executeJavaScript(
        `window.__qishuiSecondVerify(
          ${JSON.stringify(decision)},
          ${JSON.stringify({ generalParams: {
            device_id: identity.deviceId,
            install_id: identity.installId,
            did: identity.deviceId,
            iid: identity.installId,
            device_platform: 'PC',
            version_code: APP_VERSION,
          } })}
        )`,
        true,
      );
    } catch (error) {
      // 组件加载/执行失败时不要立刻 hide：否则用户只看到窗口「一闪」，
      // 既读不到错误也来不及操作。保留窗口（页面上已有错误文案），
      // 由用户点「取消验证」或关闭窗口收尾。
      failed = true;
      throw error;
    } finally {
      // 成功（验证完成）或用户取消 → 收起窗口；失败 → 保留以便阅读原因。
      if (!failed && this.window && !this.window.isDestroyed()) this.window.hide();
    }
  }

  async checkQrConnect(token) {
    const generation = this.qrGeneration;
    await this.initialize();
    const identity = ensureIdentity();
    const body = {
      need_logo: 'false',
      need_short_url: 'false',
      is_frontier: 'true',
      token: String(token || ''),
      is_new_login: '1',
      next: API_BASE,
    };
    let envelope = await this.request('POST', '/passport/web/check_qrconnect/', {}, body);
    let data = envelope.data || {};
    if (Number(data.error_code) === 2046) {
      const decision = mergeDecision(envelope);
      if (!decision.verify_portrait_id) decision.verify_portrait_id = identity.verifyPortraitId;
      const bizParams = normalizeBizParams(decision.biz_params);
      const tokenKey = String(token || '');
      // 去重：同一 token 的二次验证只弹一次窗口，并发轮询复用同一结果，
      // 否则 2 秒一次的轮询会把验证窗口反复弹出。
      let verified;
      try {
        if (this._mfaDone && this._mfaToken === tokenKey) {
          verified = { status: true };
        } else if (this._mfaStopToken && this._mfaStopToken === tokenKey) {
          // 该 token 的二次验证已终止（组件失败 / 用户取消）：不再重弹、也不再
          // 请求上游。否则每 2 秒轮询都会重新触发 2046，上游按频率判
          // error_code 7（rate_limited），限流窗口永远不结束。
          const cached = new Error(this._mfaStopMessage || '二次验证未完成');
          cached.code = this._mfaStopCode || 'QISHUI_MFA_CANCELLED';
          cached.cached = true;
          throw cached;
        } else if (this._mfaPromise && this._mfaToken === tokenKey) {
          verified = await this._mfaPromise;
        } else {
          this._mfaToken = tokenKey;
          this._mfaPromise = this.secondVerify(decision, identity).finally(() => {
            this._mfaPromise = null;
          });
          verified = await this._mfaPromise;
        }
      } catch (mfaErr) {
        // 二次验证组件加载/执行失败（非用户主动取消）：单独标记，让前端停止轮询、
        // 提示手动刷新，避免每 2 秒反复弹窗。
        const error = new Error(
          (mfaErr && mfaErr.message)
            ? ('安全验证组件加载失败：' + mfaErr.message)
            : '安全验证组件加载失败',
        );
        error.code = 'QISHUI_MFA_FAILED';
        this._markMfaStop(tokenKey, error.code, error.message);
        throw error;
      }
      if (!verified || verified.status !== true) {
        const error = new Error(verified && verified.message || '二次验证未完成');
        error.code = 'QISHUI_MFA_CANCELLED';
        // 用户取消同样是终止态：不记住的话，下一次轮询会把窗口再弹一次。
        this._markMfaStop(tokenKey, error.code, error.message);
        throw error;
      }
      this._mfaDone = true;
      envelope = await this.request(
        'POST',
        '/passport/web/check_qrconnect/',
        { isResend: 'true' },
        { ...body, ...bizParams },
      );
      data = envelope.data || {};
      // 验证已通过但服务端可能仍在确认：保持 _mfaDone，交给后续轮询重试确认，
      // 不要再抛错也不要再弹窗。
    }
    if (generation === this.qrGeneration && Number(data.error_code) === 0 && (String(data.status) === '3' || String(data.status) === 'confirmed' || data.session_cookie)) {
      await this.persistSessionCookies(data.session_cookie || '', generation);
    }
    return envelope;
  }

  async persistSessionCookies(sessionCookie, generation) {
    const current = {};
    const cookies = await this.authSession.cookies.get({});
    for (const cookie of cookies) {
      const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
      if (domain === 'qishui.com' || domain.endsWith('.qishui.com')) {
        current[cookie.name] = cookie.value;
      }
    }
    Object.assign(current, parseCookieString(sessionCookie));
    // 合并主进程从 Set-Cookie 响应头直接留存的登录 cookie。
    // authSession 的 cookie jar 可能因 SameSite 拒绝跨站写入而为空，
    // 这条独立来源保证确认态仍能拿到 sessionid / sid_tt。
    for (const pair of (this._checkQrSetCookiePairs || [])) {
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name && value) current[name] = value;
    }
    if (generation !== this.qrGeneration) return;
    const cookie = buildCookieString(current);
    try {
      const _envCookieFile = process.env.KUGOU_COOKIE_FILE || process.env.COOKIE_FILE || '';
      const _logPath = _envCookieFile
        ? path.join(path.dirname(_envCookieFile), 'cookie-debug.log')
        : path.join(app.getPath('userData'), 'cookie-debug.log');
      // 只记名称与是否含登录 cookie，绝不记值。
      const names = Object.keys(current);
      const hasLogin = /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt|uid_tt_ss)=/i.test(cookie);
      fs.appendFileSync(
        _logPath,
        '[' + new Date().toISOString() + '] [QishuiPersist] hasLogin=' + hasLogin +
        ' count=' + names.length + ' names=' + names.join(',') + '\n',
        'utf8',
      );
    } catch (_) {}
    updateConfig({ cookie, msToken: this.msToken });
  }

  async clear() {
    this.qrGeneration += 1;
    this._mfaToken = '';
    this._mfaDone = false;
    this._mfaPromise = null;
    this._mfaStopToken = '';
    this._mfaStopCode = '';
    this._mfaStopMessage = '';
    if (this.authSession) {
      await this.authSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
      });
      try { await this.authSession.flushStorageData(); } catch (_) {}
    }
    this.destroying = true;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.browserInfo = null;
    this.msToken = '';
    if (this.assetServer) await new Promise(resolve => this.assetServer.close(resolve));
    this.assetServer = null;
    this.assetBase = '';
    this.assetToken = crypto.randomBytes(18).toString('hex');
    this.destroying = false;
  }
}

async function initSignEngine() {
  if (!runtime) runtime = new QishuiAuthRuntime();
  return runtime.initialize();
}

async function getQrCode() {
  await initSignEngine();
  return runtime.getQrCode();
}

async function checkQrConnect(token) {
  await initSignEngine();
  return runtime.checkQrConnect(token);
}

async function clear() {
  if (runtime) {
    await runtime.clear();
  } else {
    if (!app.isReady()) await app.whenReady();
    const authSession = session.fromPartition(AUTH_PARTITION);
    await authSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
    });
    try { await authSession.flushStorageData(); } catch (_) {}
  }
  runtime = null;
}

module.exports = {
  configure,
  initSignEngine,
  getQrCode,
  checkQrConnect,
  clear,
  constants: { API_BASE, AID, APP_VERSION, AUTH_PARTITION },
  // 仅供探针/诊断使用：拿到已初始化的 runtime 实例，用来验证
  // ensureHostPageFresh() 这类内部自愈逻辑。生产代码不依赖这个出口。
  __getRuntime: () => runtime,
  // 仅供探针/诊断使用：只把 host 页拉起来（装 CORS hook + 就绪 bdms），
  // 不发起任何业务请求。这样探针验证「组件内 withCredentials 请求能否拿到
  // 响应」时，不会被一次真实的 get_qrcode 调用打上游、也不会触发限流。
  __initialize: initSignEngine,
};
