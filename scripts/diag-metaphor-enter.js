'use strict';
/**
 * 诊断：单独建一次「隐喻」实例（不进 Folia 世界、不建背景），把卡住的位置缩到
 * 「样式本体」还是「世界/背景」这一层。用法：node scripts/diag-metaphor-enter.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9338;
const OUT_DIR = path.join(ROOT, '_debug-archive', '2026-11-27-metaphor');
const USER_DATA = path.join(OUT_DIR, 'userdata-diag');

const delay = ms => new Promise(r => setTimeout(r, ms));
function httpJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('timeout')));
  });
}
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(new Error('ws error'));
  });
}
let msgId = 0;
function send(ws, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ' → ' + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    const timer = setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error(method + ' 超时')); }, timeoutMs || 20000);
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function evalJs(ws, expr, timeoutMs) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r && r.exceptionDetails) throw new Error('eval threw: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + USER_DATA, '--no-first-run'], {
    cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  try {
    const deadline = Date.now() + 45000;
    let up = false;
    while (Date.now() < deadline) {
      try { const v = await httpJson('/json/version'); if (v && v.webSocketDebuggerUrl) { up = true; break; } } catch (_) {}
      await delay(300);
    }
    if (!up) throw new Error('CDP 未就绪');
    let page = null;
    const pd = Date.now() + 70000;
    while (Date.now() < pd) {
      const list = await httpJson('/json/list');
      page = (list || []).find(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url || ''));
      if (page) break;
      await delay(400);
    }
    const ws = await wsConnect(page.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable');
    const rd = Date.now() + 60000;
    let ready = false;
    while (Date.now() < rd) {
      ready = await evalJs(ws, 'typeof doSearch === "function" && !!window.__mineradioCoreModulesReady');
      if (ready) break;
      await delay(300);
    }
    console.log('ready:', ready);
    const md = Date.now() + 60000;
    let hasMode = false;
    while (Date.now() < md) {
      hasMode = await evalJs(ws, 'typeof getFoliaMode === "function" && !!getFoliaMode("metaphor")');
      if (hasMode) break;
      await delay(400);
    }
    console.log('mode registered:', hasMode);

    console.log('--- create 计时 ---');
    const result = await evalJs(ws, `(function(){
      var lines = [
        { startTime: 0, endTime: 3.6, fullText: '墨在纸上缓缓散开', translation: '', words: [{ text: '墨在', startTime: 0, endTime: 0.9 }, { text: '纸上', startTime: 0.9, endTime: 1.8 }, { text: '缓缓', startTime: 1.8, endTime: 2.7 }, { text: '散开', startTime: 2.7, endTime: 3.6 }] },
        { startTime: 4, endTime: 7.6, fullText: '融球与字同一张场', translation: '', words: [{ text: '融球', startTime: 4, endTime: 5 }, { text: '与字', startTime: 5, endTime: 6 }, { text: '同一张场', startTime: 6, endTime: 7.6 }] }
      ];
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:1';
      document.body.appendChild(host);
      var theme = foliaWorldTheme();
      var ctx = { now: performance.now(), dt: 16, time: 5, index: 0, lines: lines, linesRev: 1, theme: theme,
        audio: { power: 0.2, bands: {} }, paused: false, showText: true, showTranslation: true, fontScale: 1, seed: 'diag', song: { title: 'diag' } };
      var def = getFoliaMode('metaphor');
      var t0 = performance.now();
      var inst = null;
      var error = '';
      try { inst = def.create(host, ctx); } catch (err) { error = String(err && err.stack || err); }
      var createMs = Math.round(performance.now() - t0);
      var tickMs = null;
      if (inst) {
        var t1 = performance.now();
        try { ctx.time = 6.2; def.tick(inst, ctx); } catch (err2) { error += ' | tick: ' + String(err2 && err2.message || err2); }
        tickMs = Math.round(performance.now() - t1);
      }
      window.__diagInst = inst;
      return { createMs: createMs, tickMs: tickMs, error: error, hasInst: !!inst,
        canvas: inst ? [inst.renderer.domElement.width, inst.renderer.domElement.height] : null,
        cues: inst ? inst.program.cues.length : 0,
        width: inst ? inst.width : 0, height: inst ? inst.height : 0 };
    })()`, 30000);
    console.log(JSON.stringify(result, null, 2));

    console.log('--- 世界路径（enter）---');
    try {
      const enter = await evalJs(ws, `(function(){
        var t0 = performance.now();
        foliaWorldEnter({ silent: true });
        return { ms: Math.round(performance.now() - t0), active: foliaWorld.active, fail: foliaWorld.failReason || '', mode: foliaWorld.mode };
      })()`, 20000);
      console.log(JSON.stringify(enter));
    } catch (err) {
      console.log('enter 失败/超时:', err.message);
    }

    console.log('--- 世界里切到隐喻 ---');
    try {
      const switched = await evalJs(ws, `(function(){
        var host = document.querySelector('.folia-mode-host');
        var size = host ? [host.clientWidth, host.clientHeight] : null;
        var t0 = performance.now();
        foliaWorldSetMode('metaphor');
        var ms = Math.round(performance.now() - t0);
        return { ms: ms, hostSize: size, mode: foliaWorld.mode, active: foliaWorld.active,
          fail: foliaWorld.failReason || '',
          instanceId: foliaWorld.instance && foliaWorld.instance.__def ? foliaWorld.instance.__def.id : '',
          canvas: foliaWorld.instance && foliaWorld.instance.renderer ? [foliaWorld.instance.renderer.domElement.width, foliaWorld.instance.renderer.domElement.height] : null };
      })()`, 45000);
      console.log(JSON.stringify(switched));
      const tick = await evalJs(ws, `(function(){
        var inst = foliaWorld.instance;
        if (!inst) return { error: 'no-instance' };
        var t0 = performance.now();
        foliaWorldTick(performance.now(), 16);
        return { tickMs: Math.round(performance.now() - t0), shown: !!inst.shown,
          glyphs: inst.shown ? inst.shown.layout.glyphs.length : 0,
          instances: inst.shapeGeometry.instanceCount, cues: inst.program.cues.length };
      })()`, 45000);
      console.log(JSON.stringify(tick));
    } catch (err) {
      console.log('setMode 失败/超时:', err.message);
    }

    console.log('--- 世界里切到隐喻 ---');
    try {
      const switched = await evalJs(ws, `(function(){
        var host = document.querySelector('.folia-mode-host');
        var size = host ? [host.clientWidth, host.clientHeight] : null;
        var t0 = performance.now();
        foliaWorldSetMode('metaphor');
        var ms = Math.round(performance.now() - t0);
        return { ms: ms, hostSize: size, mode: foliaWorld.mode, active: foliaWorld.active,
          fail: foliaWorld.failReason || '',
          instanceId: foliaWorld.instance && foliaWorld.instance.__def ? foliaWorld.instance.__def.id : '',
          canvas: foliaWorld.instance && foliaWorld.instance.renderer ? [foliaWorld.instance.renderer.domElement.width, foliaWorld.instance.renderer.domElement.height] : null };
      })()`, 45000);
      console.log(JSON.stringify(switched));
      const tick = await evalJs(ws, `(function(){
        var inst = foliaWorld.instance;
        if (!inst) return { error: 'no-instance' };
        var t0 = performance.now();
        foliaWorldTick(performance.now(), 16);
        return { tickMs: Math.round(performance.now() - t0), shown: !!inst.shown,
          glyphs: inst.shown ? inst.shown.layout.glyphs.length : 0,
          instances: inst.shapeGeometry.instanceCount, cues: inst.program.cues.length };
      })()`, 45000);
      console.log(JSON.stringify(tick));
    } catch (err) {
      console.log('setMode 失败/超时:', err.message);
    }
  } catch (err) {
    console.error('诊断异常:', err && err.stack || err);
  } finally {
    try { if (child.pid) require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
    try { child.kill(); } catch (_) {}
    await delay(500);
  }
  process.exit(0);
})();
