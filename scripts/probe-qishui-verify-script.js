'use strict';

/**
 * 汽水二次验证「组件脚本加载」探针（真 Electron + 真网络）。
 *
 * 背景：用户实测二维码已正常显示，但状态栏报
 *   安全验证组件加载失败：https://auth.zijieapi.com/ucenter_web/app/
 *   second_verification_web/dist/index.umd.production?<aid,error_code,...>
 * 实测该 URL（无 .js 后缀）返回 404，而同级 index.umd.production.js 返回 200。
 * <script> 遇 404 只触发 onerror，拿不到状态码，整条二次验证链路被判死。
 *
 * 本探针在真实 Electron 窗口里加载 security_host.html，直接调用页面内的
 * loadVerifyScript()，验证「候选序列 + 补 .js」能真正加载出组件并挂上
 * window.ucWebSecondVerify。纯静态断言无法证明这一点（那是网络行为）。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node scripts/probe-qishui-verify-script.js
 *   （必须 env -u ELECTRON_RUN_AS_NODE：环境常驻 =1 会退化成纯 node）
 */

const path = require('path');
const http = require('http');
const fs = require('fs');
const { app, BrowserWindow, session } = require('electron');

const APP_ROOT = path.join(__dirname, '..');

// 默认验源码目录；--asset-dir 可指向 dist 里实际被打包的那份，
// 用来确认「用户重启后真正会加载的文件」也含修复（避免只验源码自欺）。
function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '');
}
const ASSET_DIR = argValue('--asset-dir')
  ? path.resolve(argValue('--asset-dir'))
  : path.join(APP_ROOT, 'qishui-auth-v6');
const AUTH_PARTITION = 'persist:qishui-auth-v6';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 上游 2046 决策里实际给出的 url 形态：路径末段没有扩展名。
const UPSTREAM_URL = 'https://auth.zijieapi.com/ucenter_web/app/'
  + 'second_verification_web/dist/index.umd.production';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
}

function startAssetServer() {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
    const name = path.basename(urlPath);
    const file = path.join(ASSET_DIR, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(name)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  await app.whenReady();

  const server = await startAssetServer();
  const assetBase = `http://127.0.0.1:${server.address().port}/`;

  // 与生产一致：给组件白名单宿主补 CORS 头，窗口保持 webSecurity:true。
  const authSession = session.fromPartition(AUTH_PARTITION);
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
      headers['Access-Control-Allow-Origin'] = [assetBase.replace(/\/$/, '')];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
      callback({ responseHeaders: headers });
    },
  );

  const win = new BrowserWindow({
    show: false,
    width: 980,
    height: 760,
    webPreferences: {
      partition: AUTH_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(UA);

  const netFailures = [];
  win.webContents.session.webRequest.onCompleted(
    { urls: ['https://auth.zijieapi.com/*'] },
    details => netFailures.push({ url: details.url.split('?')[0], status: details.statusCode }),
  );
  win.webContents.session.webRequest.onErrorOccurred(
    { urls: ['https://auth.zijieapi.com/*'] },
    details => netFailures.push({ url: details.url.split('?')[0], error: details.error }),
  );

  await win.loadURL(assetBase + 'security_host.html');

  console.log('=== QISHUI VERIFY SCRIPT PROBE ===');

  // 1) 先确认上游给的无后缀地址确实拿不到脚本。
  // 注意：实测该地址返回 404 + text/html，而 Chromium 的 ORB
  // （Opaque Response Blocking）会把「非脚本 MIME 的跨源响应」直接拦成
  // net::ERR_BLOCKED_BY_ORB —— 所以页面侧连状态码都读不到，只表现为
  // fetch reject / <script> onerror。这正是用户看到「加载失败」却没有
  // 任何状态码的机制，断言按「不可用」而非「恰好 404」来写。
  const bareProbe = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      fetch(${JSON.stringify(UPSTREAM_URL)}, { method: 'GET' })
        .then(r => resolve({ ok: r.ok, status: r.status }))
        .catch(e => resolve({ ok: false, error: String(e && e.message || e) }));
    })
  `, true);
  check(
    '上游无后缀地址不可用（复现根因：404 被 ORB 拦截）',
    bareProbe.ok === false,
    'status=' + (bareProbe.status || bareProbe.error),
  );

  // 2) 候选序列必须生成两个候选，且第二个带 .js
  const candidates = await win.webContents.executeJavaScript(
    `window.__probeCandidates = verifyScriptCandidates(${JSON.stringify(UPSTREAM_URL)});
     window.__probeCandidates`, true,
  );
  check(
    '候选序列为 [原地址, 原地址+.js]',
    Array.isArray(candidates) && candidates.length === 2
      && /\.js$/.test(candidates[1]) && !/\.js$/.test(candidates[0]),
    JSON.stringify(candidates && candidates.map(u => u.replace(/^.*\/dist\//, ''))),
  );

  // 3) 真实加载：必须成功并挂出 ucWebSecondVerify
  const loadResult = await win.webContents.executeJavaScript(`
    (async () => {
      const before = typeof window.ucWebSecondVerify;
      try {
        const used = await loadVerifyScript(${JSON.stringify(UPSTREAM_URL)});
        return { before, after: typeof window.ucWebSecondVerify, used, error: null };
      } catch (e) {
        return { before, after: typeof window.ucWebSecondVerify, used: null, error: String(e && e.message || e) };
      }
    })()
  `, true);
  check(
    'loadVerifyScript 能从无后缀 URL 加载成功',
    loadResult.error === null,
    loadResult.error || ('used=' + String(loadResult.used || '').replace(/^.*\/dist\//, '')),
  );
  check(
    '组件已挂出 window.ucWebSecondVerify',
    loadResult.after === 'function',
    'before=' + loadResult.before + ' after=' + loadResult.after,
  );

  // 4) 补后缀不能成为绕过安全边界的后门
  const guardResult = await win.webContents.executeJavaScript(`
    (async () => {
      const cases = [
        'http://auth.zijieapi.com/x/index.umd.production',
        'https://evil.example.com/x/index.umd.production',
      ];
      const out = [];
      for (const u of cases) {
        try { await loadVerifyScript(u); out.push({ u, blocked: false }); }
        catch (e) { out.push({ u, blocked: true, msg: String(e && e.message || e).slice(0, 60) }); }
      }
      return out;
    })()
  `, true);
  check(
    '非 https 候选被拒绝',
    guardResult[0] && guardResult[0].blocked === true,
    guardResult[0] && guardResult[0].msg,
  );
  check(
    '白名单外域名候选被拒绝',
    guardResult[1] && guardResult[1].blocked === true,
    guardResult[1] && guardResult[1].msg,
  );

  // 5) 网络层证据：原地址被拦（ORB/失败），补 .js 后 200 成功。
  // 断言「存在失败 + 存在 200」而不是「恰好 404」，因为 ORB 会把 404 的
  // text/html 响应转成 net::ERR_BLOCKED_BY_ORB，状态码不可见。
  const statuses = netFailures.map(f => f.status || f.error).filter(Boolean);
  const sawFailure = statuses.some(s => s === 404 || String(s).startsWith('net::ERR_'));
  const sawOk = statuses.includes(200);
  check(
    '网络层记录到「原地址失败 → .js 成功」的降级路径',
    sawFailure && sawOk,
    JSON.stringify(statuses),
  );

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  try { win.destroy(); } catch (_) {}
  await new Promise(r => server.close(r));
  app.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[probe error]', err && err.stack || err);
  app.exit(1);
});
