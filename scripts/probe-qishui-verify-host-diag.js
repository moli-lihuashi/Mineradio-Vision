'use strict';

/**
 * 诊断：为什么 verify.zijieapi.com 的 POST 提交仍然 network_error。
 *
 * 背景：补完 Allow-Headers 白名单后，api.qishui.com 的 GET/POST 都通了，
 * 但 verify.zijieapi.com/passport/web/send_code/ 的 POST 仍报 network_error。
 * 需要抓到预检（OPTIONS）的真实 statusCode 与响应头，才能区分：
 *   A. 上游 OPTIONS 返回非 2xx → 浏览器直接判预检失败（注入 CORS 头也没用）
 *   B. onHeadersReceived 没在该宿主触发 → CORS 头根本没注入
 *   C. 上游返回了另一个 ACAO，与注入值冲突
 *   D. 连接层失败（DNS / TLS / 证书）
 *
 * 主进程 Windows 下 console.log 会被吞，所有结果一律写日志文件。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-verify-host-diag.js
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'probe-verify-host-diag.log');
try { fs.writeFileSync(OUT, '', 'utf8'); } catch (_) {}
const log = msg => {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
  try { fs.appendFileSync(OUT, line, 'utf8'); } catch (_) {}
};

const argOf = name => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const assetDir = path.resolve(
  ROOT,
  argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'),
);

const COMPONENT_HEADERS = [
  'x-tt-passport-verify-portrait',
  'x-tt-passport-trace-id',
  'x-tt-passport-csrf-token',
  'x-tt-logid',
  'x-tt-passport-aid-sign',
];

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

function shortHeaders(h) {
  if (!h) return 'none';
  return Object.keys(h)
    .filter(k => /access-control|origin|content-type/i.test(k))
    .map(k => k + '=' + JSON.stringify(h[k]))
    .join(' | ') || '(no cors headers)';
}

async function main() {
  await app.whenReady();
  const mod = loadModule();
  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });
  await mod.__initialize();
  const runtime = mod.__getRuntime();
  const win = runtime.window;
  const sess = runtime.authSession;

  log('assetBase=' + runtime.assetBase);

  // 取证只用**通知型**事件（onBeforeSendHeaders / onCompleted /
  // onErrorOccurred / onResponseStarted 可多个并存）。
  // 绝不挂 onHeadersReceived / onBeforeSendHeaders 这类「可修改」事件：
  // Electron 对它们只认**最后一个** listener，后挂的会把模块自己的
  // CORS 注入器整个顶掉，测出来的 network_error 是探针自己造成的假象。
  const allUrls = ['https://verify.zijieapi.com/*', 'https://api.qishui.com/*'];
  sess.webRequest.onResponseStarted({ urls: allUrls }, details => {
    log('STARTED id=' + details.id + ' ' + details.method + ' status=' + details.statusCode +
        ' url=' + details.url + ' resp=' + shortHeaders(details.responseHeaders));
  });
  sess.webRequest.onErrorOccurred({ urls: allUrls }, details => {
    log('ERROR   id=' + details.id + ' ' + details.method + ' ' + details.url +
        ' error=' + details.error);
  });
  sess.webRequest.onCompleted({ urls: allUrls }, details => {
    log('DONE    id=' + details.id + ' ' + details.method + ' status=' + details.statusCode +
        ' ' + details.url);
  });

  const targets = [
    'https://api.qishui.com/passport/web/send_code/',
    'https://verify.zijieapi.com/passport/web/send_code/',
  ];

  for (const target of targets) {
    const script = `
      new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', ${JSON.stringify(target)}, true);
        xhr.withCredentials = true;
        xhr.timeout = 15000;
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        const pairs = ${JSON.stringify(COMPONENT_HEADERS.map(h => [h, 'probe-value']))};
        for (const p of pairs) { try { xhr.setRequestHeader(p[0], p[1]); } catch (_) {} }
        xhr.onload = () => resolve({ ok: true, status: xhr.status });
        xhr.onerror = () => resolve({ ok: false, error: 'network_error' });
        xhr.ontimeout = () => resolve({ ok: false, error: 'timeout' });
        xhr.send('aid=386088&type=22');
      })
    `;
    log('--- REQUEST ' + target + ' ---');
    const res = await win.webContents.executeJavaScript(script, true)
      .catch(err => ({ ok: false, error: 'exec:' + String(err && err.message || err) }));
    log('RESULT  ' + target + ' ' + JSON.stringify(res));
  }

  log('=== END ===');
  try { win.destroy(); } catch (_) {}
  app.exit(0);
}

main().catch(err => {
  log('[probe-error] ' + ((err && err.stack) || err));
  app.exit(2);
});
