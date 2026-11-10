// 共享 CDP 客户端 —— 把 8 份重复脚手架收成一份。
//
// 用法：
//   const cdp = require('./cdp-client');
//   const app = await cdp.launch({ port: 9401 });
//   try {
//     await app.waitReady();
//     const v = await app.eval('1+1');
//   } finally { await app.close(); }
//
// 之前每个探针各复制 40 行（spawn + /json/list + WebSocket + Runtime.evaluate +
// taskkill），端口还各不相同。判据不一样可以，脚手架不该有 8 份。
'use strict';

const { spawn, execSync } = require('child_process');

const DEFAULT_EXE = 'D:\\Mineradio\\Mineradio-Kugou-Modified-main\\dist\\Mineradio\\Mineradio.exe';

async function launch(opts) {
  const exe = opts.exe || DEFAULT_EXE;
  const port = Number(opts.port || 9401);
  const bootTimeoutMs = Number(opts.bootTimeoutMs || 120000);
  const evalTimeoutMs = Number(opts.evalTimeoutMs || 25000);

  const childEnv = Object.assign({}, process.env);
  delete childEnv.ELECTRON_RUN_AS_NODE; // 常驻 =1 会把 Electron 退化成纯 node

  const child = spawn(exe, ['--remote-debugging-port=' + port, '--enable-logging'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  child.on('error', (e) => process.stderr.write('[cdp spawn error] ' + e.message + '\n'));

  // 等调试端口起来
  const deadline = Date.now() + bootTimeoutMs;
  let target = null;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = (list || []).find((t) => t && t.type === 'page' && t.webSocketDebuggerUrl) || null;
      if (target) break;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!target) {
    killApp();
    throw new Error('CDP target 未就绪（' + (lastErr && lastErr.message) + '）');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const pending = new Map();
  let seq = 0;
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  };

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); }
      }, evalTimeoutMs);
    });
  }

  async function evalJs(expression) {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      return {
        __thrown: true,
        text: String((e.exception && (e.exception.description || e.exception.value)) || e.text || '').slice(0, 900),
      };
    }
    return r.result ? r.result.value : undefined;
  }

  await send('Runtime.enable');
  await send('Log.enable').catch(() => {});

  // 前台未捕获错误收集：很多「功能半死」只在这里留痕（合并 script 顶层异常）
  await evalJs(
    'window.__harnessErrors = window.__harnessErrors || [];'
    + 'window.addEventListener("error", function(e){ window.__harnessErrors.push(String(e.message)); }); 1'
  );

  async function waitReady(timeoutMs) {
    const dl = Date.now() + (timeoutMs || bootTimeoutMs);
    while (Date.now() < dl) {
      const st = await evalJs('({ ready: !!window.__mineradioCoreModulesReady, hasFx: typeof fx !== "undefined" && !!fx })');
      if (st && st.ready && st.hasFx) return true;
      await new Promise((r) => setTimeout(r, 600));
    }
    return false;
  }

  async function dismissSplash() {
    return evalJs('(function(){ try { dismissSplash(); return 1; } catch(e){ return String(e); } })()');
  }

  function killApp() {
    try { ws && ws.close(); } catch (_) {}
    try { execSync('taskkill /IM Mineradio.exe /T /F', { stdio: 'ignore' }); } catch (_) {}
    try { child && child.kill(); } catch (_) {}
  }

  return {
    exe, port, eval: evalJs, send, waitReady, dismissSplash,
    errors: async () => (await evalJs('window.__harnessErrors || []')) || [],
    close: killApp,
  };
}

module.exports = { launch, DEFAULT_EXE };
