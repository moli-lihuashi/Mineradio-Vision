'use strict';

/**
 * 探针：汽水二次验证组件「组件内所有请求 Network Error」回归守卫。
 *
 * 背景（2026-11-11 定位）：
 *   官方二次验证组件 index.umd.production.js 内部的 axios 硬编码
 *   withCredentials: true（`tj.create({withCredentials:!0,...i,
 *   xsrfCookieName:"passport_csrf_token",xsrfHeaderName:"x-tt-passport-csrf..."})`）。
 *   带凭据的跨源请求，浏览器要求响应同时具备：
 *     Access-Control-Allow-Origin: <具体 origin>   ← 不能是 *
 *     Access-Control-Allow-Credentials: true
 *   只注入前者（历史上就是这么写的）→ 浏览器直接判失败，
 *   页面表现是组件内短信/密码验证全部提交不了，控制台只有 Network Error。
 *
 *   这条探针不走「自己模拟一份注入逻辑」的路线，而是直接 require
 *   dist 里真实落盘的 qishui-auth-v6.js，让它自己的 _installSessionHooks()
 *   装 CORS，然后从它自己的 security_host.html 发真实 withCredentials XHR。
 *   这样 dist 同步漏了、或注入头被删了，探针都会红。
 *
 * 判据：
 *   PASS = 拿到 HTTP 响应（status 非 0）且不是 network_error。
 *   业务错误码（如 4031 未登录）算 PASS —— 那证明网络层已经通了。
 *
 * 用法：
 *   node_modules/.bin/electron scripts/probe-qishui-cors-credentials.js
 *   node_modules/.bin/electron scripts/probe-qishui-cors-credentials.js --asset-dir=dist/Mineradio/resources/app
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');

const argOf = name => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};

// 默认验 dist（用户日常启动的那棵树），而不是仓库根——根目录永远是新的，
// 拿根目录测等于测了个寂寞。
const assetDir = path.resolve(
  ROOT,
  argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'),
);

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  // 每次都从磁盘重新读，避免 require 缓存掩盖「dist 是旧的」。
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

async function main() {
  await app.whenReady();

  const mod = loadModule();
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  const source = fs.readFileSync(entry, 'utf8');

  // 1) 静态断言：dist 里确实**赋值**了 Allow-Credentials。
  //    只搜关键字会被注释骗过去（注释里也写了这个词），必须匹配赋值语句。
  const hasCred = /headers\['Access-Control-Allow-Credentials'\]\s*=\s*\[\s*'true'\s*\]/.test(source);
  record(hasCred, "dist 模块存在 headers['Access-Control-Allow-Credentials'] = ['true'] 赋值", entry);

  // 2) 静态断言：ACAO 必须是收窄到 selfOrigin，不能是通配。
  //    通配 + credentials 是非法组合（Chromium 会直接拒绝，极端情况下进程挂住）。
  const acaoNarrowed = /headers\['Access-Control-Allow-Origin'\]\s*=\s*\[selfOrigin\]/.test(source);
  record(acaoNarrowed, 'ACAO 收窄到 selfOrigin（不是 *）');

  const wildcard = /headers\['Access-Control-Allow-Origin'\]\s*=\s*\[\s*'\*'\s*\]/.test(source);
  record(!wildcard, 'dist 模块没有 ACAO=* 的通配写法');

  // 3) 真跑：让模块自己初始化，再在它自己的 host 页里发 withCredentials XHR。
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

  if (runtime && runtime.window && !runtime.window.isDestroyed()) {
    record(true, '模块 __initialize() 成功（host 页 + bdms 就绪）', runtime.assetBase);

    const win = runtime.window;
    const token = runtime.msToken;

    // 用 get_qrcode 这个不需要登录态的接口：有响应就说明网络层通了。
    const url =
      'https://api.qishui.com/passport/web/get_qrcode/' +
      '?aid=386088&next=https%3A%2F%2Fapi.qishui.com&need_logo=false&need_short_url=false' +
      '&msToken=' + encodeURIComponent(token);

    const script = `
      new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', ${JSON.stringify(url)}, true);
        xhr.withCredentials = true;            // 复刻组件内部 axios 的硬编码
        xhr.timeout = 20000;
        xhr.setRequestHeader('Accept', 'application/json, text/javascript');
        xhr.setRequestHeader('x-tt-passport-verify-portrait', ${JSON.stringify(config.verifyPortraitId || 'probe.login')});
        xhr.onload = () => {
          let errCode = null, hasData = false;
          try {
            const p = JSON.parse(xhr.responseText);
            errCode = (p.data || {}).error_code;
            hasData = Boolean(p.data);
          } catch (_) {}
          resolve({ done: true, status: xhr.status, errCode: errCode, hasData: hasData });
        };
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

    if (res && res.done && res.status) {
      record(
        true,
        '组件内 withCredentials 跨源请求拿到 HTTP 响应',
        `status=${res.status} errCode=${res.errCode}`,
      );
      // 业务错误码是正常的：探针没有真实登录上下文。
      if (res.errCode != null) {
        console.log(`     注：errCode=${res.errCode} 属业务层（探针无真实登录态），不算失败`);
      }
    } else {
      record(
        false,
        '组件内 withCredentials 跨源请求拿到 HTTP 响应',
        `status=${res && res.status} error=${(res && res.error) || 'unknown'} ← 这就是用户看到的 Network Error`,
      );
    }

    // 4) 顺带确认 host 页自己的裸 XHR 没被误伤（它不带 credentials）。
    const plain = await win.webContents.executeJavaScript(
      `fetch(${JSON.stringify(url)}, { mode: 'cors' })
         .then(r => ({ done: true, status: r.status }))
         .catch(e => ({ done: false, error: String(e && e.message || e) }))`,
      true,
    ).catch(err => ({ done: false, error: String((err && err.message) || err) }));
    record(
      Boolean(plain && plain.done && plain.status),
      'host 页裸 fetch（无 credentials）仍可用',
      `status=${plain && plain.status} error=${(plain && plain.error) || 'none'}`,
    );

    // 5) CORS 注入的域名清单必须覆盖组件真正会请求的两个 origin。
    //    注意：组件里出现的 aweme.snssdk.com / www.douyin.com 经核对只是
    //    参数值（人脸验证二维码载荷、next 跳转地址），不是 XHR 目标，
    //    因此不需要（也不应该）加进注入清单——加宽只会扩大信任面。
    const injectOrigins = (source.match(/urls:\s*\[([\s\S]*?)\]/g) || []).join(' ');
    const need = ['api.qishui.com', 'verify.zijieapi.com', 'auth.zijieapi.com'];
    const missing = need.filter(o => !injectOrigins.includes(o));
    record(
      missing.length === 0,
      'CORS 注入覆盖组件真实请求的 origin',
      missing.length ? '缺 ' + missing.join(', ') : need.join(' / '),
    );

    const noOverreach = !/aweme\.snssdk\.com/.test(source);
    record(noOverreach, '未把仅作参数值的域名（aweme.snssdk.com）误加进注入清单');
  }

  // 收尾
  try {
    if (mod.clear) await mod.clear();
  } catch (_) {}
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
