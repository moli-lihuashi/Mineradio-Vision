'use strict';

/**
 * 探针：汽水二次验证「提交类请求全部 Network Error」根因守卫。
 *
 * 症状（2026-11-11 用户三张截图）：
 *   二次验证窗口里，短信「发送」那一步是成功的（页面显示「短信已发送至
 *   192******77」），但之后所有「提交」动作——输入验证码点「验证」、
 *   上行短信点「我已发送」、密码验证点「验证」——全部报 Network Error。
 *
 * 根因（读组件源码 index.umd.production.js 得出）：
 *   组件内 axios 实例硬编码
 *     withCredentials: !0,
 *     xsrfCookieName: "passport_csrf_token",
 *     xsrfHeaderName: "x-tt-passport-csrf-token"
 *   它实际会发出的自定义头共 5 个：
 *     x-tt-passport-verify-portrait   （在白名单）
 *     x-tt-passport-trace-id          （在白名单）
 *     x-tt-passport-csrf-token        （原白名单缺失）
 *     x-tt-logid                      （原白名单缺失）
 *     x-tt-passport-aid-sign          （原白名单缺失）
 *   而 onHeadersReceived 里「回显预检声明头」那行是**恒失效**的：
 *   Electron 的 OnHeadersReceivedListenerDetails 根本没有 requestHeaders
 *   字段（见 node_modules/electron/electron.d.ts），所以永远退回硬编码
 *   白名单，缺的那 3 个头预检必挂。
 *
 *   「发送成功、提交失败」的差异由此而来：第一次请求时还没有
 *   passport_csrf_token cookie，axios 的 xsrf 逻辑不加 CSRF 头，预检能过；
 *   服务端下发该 cookie 之后，后续每次提交都带 x-tt-passport-csrf-token，
 *   预检失败 → 整个提交被判 Network Error。
 *
 * 判据：
 *   ① 静态：dist 模块的 ALLOWED_CORS_REQUEST_HEADERS 必须含组件会发的
 *      全部 5 个头（漏一个就是可复现的用户故障）。
 *   ② 静态：不能依赖 details.requestHeaders 回显（Electron 不提供该字段）。
 *   ③ 真跑：在 host 页发 withCredentials + 全部 5 个头的请求，必须拿到
 *      HTTP 响应（业务错误码算 PASS，那证明网络层已通）。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-cors-csrf-header.js
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-cors-csrf-header.js --asset-dir=dist/win-unpacked/resources/app
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');

const argOf = name => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};

const assetDir = path.resolve(
  ROOT,
  argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'),
);

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// 组件 index.umd.production.js 里实际会发出的自定义请求头全集。
// 这份清单不是猜的，是用
//   grep -o "x-tt-[a-z-]\{2,40\}" index.umd.production.js | sort -u
// 从 555005 字节的官方产物里抓出来的。
const COMPONENT_HEADERS = [
  'x-tt-passport-verify-portrait',
  'x-tt-passport-trace-id',
  'x-tt-passport-csrf-token',
  'x-tt-logid',
  'x-tt-passport-aid-sign',
];

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

async function main() {
  await app.whenReady();

  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  const source = fs.readFileSync(entry, 'utf8');
  const mod = loadModule();

  // ---- ① 静态：白名单必须覆盖组件全部自定义头 ----
  const allowMatch = source.match(
    /ALLOWED_CORS_REQUEST_HEADERS\s*=\s*([\s\S]*?);/,
  );
  const allowText = allowMatch ? allowMatch[1] : '';
  const missingStatic = COMPONENT_HEADERS.filter(
    h => !allowText.toLowerCase().includes(h.toLowerCase()),
  );
  record(
    missingStatic.length === 0,
    'CORS Allow-Headers 白名单覆盖组件的全部自定义头',
    missingStatic.length
      ? '缺 ' + missingStatic.join(', ') + ' ← 这些请求的预检会失败（Network Error）'
      : COMPONENT_HEADERS.join(' / '),
  );

  // ---- ② 静态：不能依赖 details.requestHeaders 回显 ----
  // Electron 的 OnHeadersReceivedListenerDetails 没有 requestHeaders 字段，
  // 任何 `(details.requestHeaders || {})['Access-Control-Request-Headers']`
  // 都恒为 undefined。这类「看起来在回显、实际永远走兜底」的写法必须消失，
  // 否则后人会以为已经自动适配了组件新增的头。
  //
  // 只检查 onHeadersReceived 到 onBeforeSendHeaders 之间的**非注释代码行**：
  //   - 注释里会引用旧写法作为反面说明，不能算违规；
  //   - onBeforeSendHeaders 的 details 确实有 requestHeaders 字段（见
  //     electron.d.ts），那里读它是合法的。
  const between = source.slice(
    source.indexOf('onHeadersReceived'),
    source.indexOf('onBeforeSendHeaders'),
  );
  const codeOnly = between
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const reliesOnEcho = /details\.requestHeaders/.test(codeOnly);
  record(
    !reliesOnEcho,
    'onHeadersReceived 不再假装能回显预检请求头（Electron 不提供该字段）',
    reliesOnEcho ? '仍在读 details.requestHeaders，该值恒 undefined' : '已改为静态全量白名单',
  );

  // ---- ③ 真跑 ----
  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  let runtime = null;
  try {
    await mod.__initialize();
    runtime = mod.__getRuntime();
  } catch (err) {
    record(false, '模块 __initialize() 成功', String((err && err.message) || err).slice(0, 200));
  }

  if (!runtime || !runtime.window || runtime.window.isDestroyed()) {
    finish(mod, runtime);
    return;
  }

  record(true, '模块 __initialize() 成功（host 页 + bdms 就绪）', runtime.assetBase);

  const win = runtime.window;
  const token = runtime.msToken;

  // 复刻「服务端已下发 passport_csrf_token 之后的那次提交」：
  // withCredentials + 组件全部 5 个自定义头。这是用户点「验证」时浏览器
  // 真实发出的预检形态。
  const url =
    'https://api.qishui.com/passport/web/get_qrcode/' +
    '?aid=386088&next=https%3A%2F%2Fapi.qishui.com&need_logo=false&need_short_url=false' +
    '&msToken=' + encodeURIComponent(token);

  const headerPairs = COMPONENT_HEADERS.map(h => [h, 'probe-value']);
  const script = `
    new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', ${JSON.stringify(url)}, true);
      xhr.withCredentials = true;               // 复刻组件 axios 的 withCredentials:!0
      xhr.timeout = 20000;
      const pairs = ${JSON.stringify(headerPairs)};
      for (const p of pairs) {
        try { xhr.setRequestHeader(p[0], p[1]); } catch (_) {}
      }
      xhr.onload = () => resolve({ done: true, status: xhr.status });
      xhr.onerror = () => resolve({ done: false, error: 'network_error' });
      xhr.ontimeout = () => resolve({ done: false, error: 'timeout' });
      xhr.send(null);
    })
  `;

  let res;
  try {
    res = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise(r => setTimeout(() => r({ done: false, error: 'probe_hard_timeout' }), 25000)),
    ]);
  } catch (err) {
    res = { done: false, error: 'exec: ' + String((err && err.message) || err) };
  }

  record(
    Boolean(res && res.done && res.status),
    '带组件全部 5 个自定义头 + withCredentials 的跨源请求能拿到响应',
    res && res.done && res.status
      ? `status=${res.status}`
      : `error=${(res && res.error) || 'unknown'} ← 这就是用户看到的 Network Error`,
  );

  // 逐个头单独定位：哪一个头单独加就会挂，直接指名道姓，
  // 避免下次又只能盯着「Network Error」猜。
  const single = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const pairs = ${JSON.stringify(headerPairs)};
      for (const p of pairs) {
        const r = await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', ${JSON.stringify(url)}, true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          try { xhr.setRequestHeader(p[0], p[1]); } catch (_) {}
          xhr.onload = () => resolve({ ok: true, status: xhr.status });
          xhr.onerror = () => resolve({ ok: false, error: 'network_error' });
          xhr.ontimeout = () => resolve({ ok: false, error: 'timeout' });
          xhr.send(null);
        });
        out.push({ header: p[0], ...r });
      }
      return out;
    })()
  `, true).catch(() => []);

  if (Array.isArray(single) && single.length) {
    const bad = single.filter(r => !r.ok);
    record(
      bad.length === 0,
      '逐头验证：每个自定义头单独加都不触发预检失败',
      bad.length
        ? bad.map(r => r.header + '(' + r.error + ')').join(', ')
        : single.map(r => r.header).join(' / '),
    );
  }

  // ---- ④ 真跑：复刻组件「提交」的 POST 预检形态 ----
  // GET + 自定义头能触发预检，但组件真实提交是 POST + 表单体 +
  // Content-Type，且会打到 api.qishui.com / verify.zijieapi.com 两个宿主
  // （源码：baseURL 用 newSecondVerifyWebOptions.host，send_code/
  // validate_code 另有 useVerifyHost 分支指向 verify.zijieapi.com）。
  // 只测 GET 一个宿主等于没覆盖真实链路，这里补上。
  const postTargets = [
    'https://api.qishui.com/passport/web/send_code/',
    'https://verify.zijieapi.com/passport/web/send_code/',
  ];
  const postScript = `
    (async () => {
      const out = [];
      const targets = ${JSON.stringify(postTargets)};
      const pairs = ${JSON.stringify(headerPairs)};
      for (const target of targets) {
        const r = await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', target, true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          for (const p of pairs) {
            try { xhr.setRequestHeader(p[0], p[1]); } catch (_) {}
          }
          xhr.onload = () => resolve({ ok: true, status: xhr.status });
          xhr.onerror = () => resolve({ ok: false, error: 'network_error' });
          xhr.ontimeout = () => resolve({ ok: false, error: 'timeout' });
          xhr.send('aid=386088&type=22');
        });
        out.push({ target: target, ...r });
      }
      return out;
    })()
  `;
  const postRes = await win.webContents.executeJavaScript(postScript, true).catch(() => []);
  if (Array.isArray(postRes) && postRes.length) {
    const bad = postRes.filter(r => !r.ok);
    record(
      bad.length === 0,
      '真实提交形态：POST + 全部 5 头 + withCredentials，两个宿主都拿到响应',
      bad.length
        ? bad.map(r => new URL(r.target).hostname + '(' + r.error + ')').join(', ')
        : postRes.map(r => new URL(r.target).hostname + '=' + r.status).join(' / '),
    );
  }

  // ---- ⑤ 启动指纹：重启后能从日志核验进程装的是哪一版白名单 ----
  const hasFingerprint = /\[QishuiCORS\] hook-installed/.test(source) &&
    /allowHeaders=.\s*\+?\s*ALLOWED_CORS_REQUEST_HEADERS/.test(source);
  record(
    hasFingerprint,
    '每次装 CORS hook 都写启动指纹（可核验进程是否已加载新代码）',
    hasFingerprint ? 'cookie-debug.log 的 [QishuiCORS] 行' : '缺启动指纹，无法区分新旧进程',
  );

  finish(mod, runtime);
}

function finish(mod, runtime) {
  // 注意：绝不调 mod.clear() —— 它会对 persist:mineradio-qishui-auth-v6
  // 执行 clearStorageData，探针跑在真实 userData 下会清掉用户真实登录态。
  try {
    if (runtime && runtime.window && !runtime.window.isDestroyed()) runtime.window.destroy();
  } catch (_) {}

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('[probe-error]', (err && err.stack) || err);
  app.exit(2);
});
