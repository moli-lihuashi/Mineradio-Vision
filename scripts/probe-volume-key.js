'use strict';
/**
 * 定向探针：音量快捷键（ArrowUp / ArrowDown）会不会让当前歌重新从头播。
 *
 * 只看三件事：
 *   1. audio.currentTime 是否被归零
 *   2. play 事件是否被额外触发（重播会触发）
 *   3. playQueue 长度 / currentIdx 是否变化（队列被插重复项）
 *
 * 用法：node scripts/probe-volume-key.js
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9334;
const OUT = path.join(ROOT, '_debug-archive', '2026-11-26-volume-key');

function httpJson(p) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let b = '';
      r.on('data', c => { b += c; });
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function waitDevtools(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* /json/version 偶尔在端口已监听后仍不响应（实测约 1/3 概率），
     * 用 /json/list 兜底：任一能拿到 JSON 就算 CDP 起来了。 */
    try { const v = await httpJson('/json/version'); if (v && v.webSocketDebuggerUrl) return v; } catch (_) {}
    try { const l = await httpJson('/json/list'); if (Array.isArray(l)) return { ok: true }; } catch (_) {}
    await delay(300);
  }
  throw new Error('CDP 未就绪');
}
function wsConnect(url) {
  return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = () => rej(new Error('ws')); });
}
let msgId = 0;
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ' → ' + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function evalJs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.text || '') + ' ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ''));
  return r && r.result ? r.result.value : undefined;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINERADIO_MODS_DATA_DIR;

  const child = spawn(EXE, ['--remote-debugging-port=' + PORT], { cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', () => {});

  try {
    await waitDevtools(70000);
    let page = null;
    const end = Date.now() + 70000;
    while (Date.now() < end) {
      const list = await httpJson('/json/list');
      page = (list || []).find(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url || ''));
      if (page) break;
      await delay(400);
    }
    if (!page) throw new Error('没找到主窗口');
    const ws = await wsConnect(page.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable');
    await send(ws, 'Page.enable');
    await send(ws, 'Page.bringToFront');

    await delay(1600);
    await evalJs(ws, `(function(){
      var s = document.getElementById('splash');
      if (s && getComputedStyle(s).display !== 'none') { if (typeof dismissSplash === 'function') dismissSplash(); else s.click(); }
      return true;
    })()`);
    await delay(2500);

    // 播一首真实歌，并挂一个 play 计数器
    const started = await evalJs(ws, `(function(){
      var h = (typeof listenStatsState !== 'undefined' && listenStatsState.history) || [];
      if (!h.length) return { error: '历史为空' };
      var song = typeof listeningTodaySongFromRecord === 'function' ? listeningTodaySongFromRecord(h[0]) : null;
      if (!song) return { error: '无法还原歌曲' };
      /* 放 3 首：如果音量键误触发切歌，currentIdx 会变，这比单首队列更容易看出来 */
      var more = h.slice(0, 3).map(function (r) { return listeningTodaySongFromRecord(r); }).filter(Boolean);
      window.playQueue = more.length >= 2 ? more : [song];
      window.currentIdx = 0;
      window.__vkPlays = 0;
      window.__vkSrcLog = [];
      if (window.audio) {
        window.audio.addEventListener('play', function () { window.__vkPlays++; });
        window.audio.addEventListener('loadedmetadata', function () { window.__vkSrcLog.push('meta:' + String(window.audio.src).slice(-24)); });
      }
      return Promise.resolve(playQueueAt(0, { manual: true })).then(function () {
        return { ok: true, song: song.name };
      }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    })()`);
    console.log('[1] 起播:', JSON.stringify(started));

    await delay(5000);
    /* 先把音量压到 40%：默认可能是 100%，按 Up 顶格不动，看不出 handler 有没有跑 */
    await evalJs(ws, `(function(){
      if (typeof setVolume === 'function') setVolume(0.4, true);
      return true;
    })()`);
    await delay(800);

    const before = await evalJs(ws, `(function(){
      return {
        t: Number(window.audio && window.audio.currentTime || 0).toFixed(2),
        paused: !!(window.audio && window.audio.paused),
        plays: window.__vkPlays,
        queueLen: (window.playQueue || []).length,
        idx: window.currentIdx,
        src: String(window.audio && window.audio.src || '').slice(-40),
        vol: Number(window.audio && window.audio.volume || 0).toFixed(2),
        target: (typeof targetVolume === 'number' ? targetVolume.toFixed(2) : 'n/a'),
        gain: (function(){ try { return (typeof gainNode !== 'undefined' && gainNode) ? Number(gainNode.gain.value).toFixed(2) : 'no-gain'; } catch (e) { return 'err'; } })()
      };
    })()`);
    console.log('[2] 按 Up 前:', JSON.stringify(before));

    // 按三次 ArrowUp（间隔 400ms，模拟真人连按）
    for (let i = 0; i < 3; i++) {
      await evalJs(ws, `(function(){
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true, cancelable: true }));
        return true;
      })()`);
      await delay(400);
    }
    await delay(1600);

    const afterUp = await evalJs(ws, `(function(){
      return {
        t: Number(window.audio && window.audio.currentTime || 0).toFixed(2),
        paused: !!(window.audio && window.audio.paused),
        plays: window.__vkPlays,
        queueLen: (window.playQueue || []).length,
        idx: window.currentIdx,
        src: String(window.audio && window.audio.src || '').slice(-40),
        vol: Number(window.audio && window.audio.volume || 0).toFixed(2),
        target: (typeof targetVolume === 'number' ? targetVolume.toFixed(2) : 'n/a'),
        gain: (function(){ try { return (typeof gainNode !== 'undefined' && gainNode) ? Number(gainNode.gain.value).toFixed(2) : 'no-gain'; } catch (e) { return 'err'; } })(),
        srcLog: (window.__vkSrcLog || []).slice(-4)
      };
    })()`);
    console.log('[3] 按 Up 后:', JSON.stringify(afterUp));

    // 再试 ArrowDown
    for (let i = 0; i < 2; i++) {
      await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown', bubbles: true, cancelable: true }))`);
      await delay(400);
    }
    await delay(1600);

    const afterDown = await evalJs(ws, `(function(){
      return {
        t: Number(window.audio && window.audio.currentTime || 0).toFixed(2),
        plays: window.__vkPlays,
        queueLen: (window.playQueue || []).length,
        idx: window.currentIdx,
        src: String(window.audio && window.audio.src || '').slice(-40),
        vol: Number(window.audio && window.audio.volume || 0).toFixed(2),
        target: (typeof targetVolume === 'number' ? targetVolume.toFixed(2) : 'n/a'),
        gain: (function(){ try { return (typeof gainNode !== 'undefined' && gainNode) ? Number(gainNode.gain.value).toFixed(2) : 'no-gain'; } catch (e) { return 'err'; } })()
      };
    })()`);
    console.log('[4] 按 Down 后:', JSON.stringify(afterDown));

    // 结论
    const restarted = Number(afterUp.t) < Number(before.t);
    const switched = Number(afterUp.idx) !== Number(before.idx);
    const extraPlay = Number(afterUp.plays) > Number(before.plays);
    const queueGrew = Number(afterUp.queueLen) > Number(before.queueLen);
    // 顺带把用户的快捷键绑定读出来：Up/Down 是否和别动作用了同一个组合
    const hk = await evalJs(ws, `(function(){
      var raw = null;
      try { raw = JSON.parse(localStorage.getItem('mineradio-hotkeys') || localStorage.getItem('HOTKEY_SETTINGS') || 'null'); } catch (e) {}
      var out = {};
      try {
        var s = window.hotkeySettings || raw;
        if (s && s.local) Object.keys(s.local).forEach(function (k) { out[k] = s.local[k]; });
      } catch (e) {}
      var hits = Object.keys(out).filter(function (k) { return /^Arrow(Up|Down)$/.test(out[k]); });
      return { raw: raw ? 'found' : 'none', map: out, usingArrowUpDown: hits };
    })()`);
    console.log('\n[5] 快捷键绑定:', JSON.stringify(hk));

    console.log('\n判定：');
    console.log('  currentTime 回退（重播）:', restarted, before.t, '→', afterUp.t);
    console.log('  play 事件变多:', extraPlay, before.plays, '→', afterUp.plays);
    console.log('  队列变长（插重复）:', queueGrew, before.queueLen, '→', afterUp.queueLen);
    console.log('  currentIdx 变了（被切歌）:', switched, before.idx, '→', afterUp.idx);
    console.log('  音量:', before.vol, '→', afterUp.vol, '→', afterDown.vol);
  } catch (e) {
    console.error('探针异常:', e && e.stack || e);
  } finally {
    try { if (child.pid) execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
    try { child.kill(); } catch (_) {}
    await delay(700);
  }
  process.exit(0);
})();
