'use strict';
/**
 * 真 Electron 探针：听歌档案面板的「鼠标滚动异常」定位。
 *
 * 不是猜 CSS：打开面板后先枚举真实 DOM 里谁是滚动容器、谁 position:fixed/sticky、
 * 哪个元素的面积盖住了列表；再发真实滚轮事件，对比前后 scrollTop 与截图。
 *
 * 用法：node scripts/probe-folia-panel-scroll.js
 * 产物：_debug-archive/2026-11-27-folia-scroll/
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9337;
const OUT_DIR = path.join(ROOT, '_debug-archive', '2026-11-27-folia-scroll');

function httpJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout ' + p)));
  });
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitDevtools(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await httpJson('/json/version'); if (v && v.webSocketDebuggerUrl) return; } catch (_) {}
    await delay(300);
  }
  throw new Error('CDP 未就绪');
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error'));
  });
}

let msgId = 0;
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = (ev) => {
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
  if (r && r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r && r.result ? r.result.value : undefined;
}

async function shot(ws, name) {
  const r = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT_DIR, name);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log('  saved ' + f);
}

/* 页面内诊断：从 .dense-scroll 往上爬到面板，逐层看高度与 overflow，
   并列出根的所有直接子元素 —— 「滚不动」要么是没有滚动容器，要么是高度链断了 */
const DIAG = `(function(){
  var panel = document.getElementById('folia-panel');
  var root = panel && panel.querySelector('.archive-root');
  if (!root) return { error: 'no archive-root' };
  function info(el){
    if (!el) return null;
    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 70),
      h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top),
      cssH: cs.height, cssMaxH: cs.maxHeight,
      ovY: cs.overflowY, pos: cs.position, disp: cs.display, flex: cs.flex,
      z: cs.zIndex, sticky: cs.position === 'sticky' ? cs.top : '',
      z: cs.zIndex, sticky: cs.position === 'sticky' ? cs.top : '',
      ch: el.clientHeight, sh: el.scrollHeight, st: el.scrollTop
    };
  }
  var ds = root.querySelector('.dense-scroll');
  var chain = [], node = ds;
  while (node && node !== panel) { chain.push(info(node)); node = node.parentElement; }
  var scrollables = [];
  Array.prototype.forEach.call(root.querySelectorAll('*'), function(el){
    var cs = getComputedStyle(el);
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'clip')
      scrollables.push(info(el));
  });
  var cssProbe = (function(){
    var el = root.querySelector('.archive-canvas');
    var found = [];
    try {
      Array.prototype.forEach.call(document.styleSheets, function(ss){
        var rules = ss.cssRules || [];
        Array.prototype.forEach.call(rules, function(r){
          var t = r.selectorText || '';
          if (t.indexOf('archive-canvas') >= 0) {
            found.push({ from: (ss.href || 'inline').split('/').pop().slice(-28), sel: t, ovY: (r.style && r.style.overflowY) || '' });
          }
        });
      });
    } catch (e) { found.push({ err: String(e && e.message) }); }
    return { matches: el ? el.matches('#folia-panel .archive-root > .archive-canvas') : null, rules: found.slice(0, 10) };
  })();
  return {
    cssProbe: cssProbe,
    viewport: [innerWidth, innerHeight],
    rootClass: String(root.className),
    hasDenseScroll: !!ds,
    rootBox: info(root),
    chainFromDenseScroll: chain,
    rootChildren: Array.prototype.map.call(root.children, info),
    scrollables: scrollables.slice(0, 12),
    canvasKids: (function(){
      var cv = root.querySelector('.archive-canvas');
      return cv ? Array.prototype.map.call(cv.children, info) : [];
    })(),
    worldKids: (function(){
      var w = root.querySelector('.archive-canvas .canvas-world');
      return w ? Array.prototype.map.call(w.children, info).slice(0, 10) : [];
    })(),
    canvasKids: (function(){
      var cv = root.querySelector('.archive-canvas');
      return cv ? Array.prototype.map.call(cv.children, info) : [];
    })(),
    worldKids: (function(){
      var w = root.querySelector('.archive-canvas .canvas-world');
      return w ? Array.prototype.map.call(w.children, info).slice(0, 10) : [];
    })(),
    textLen: (root.innerText || '').length,
    boxes: (function(){
      function h(sel){ var el=document.querySelector(sel); return el?Math.round(el.getBoundingClientRect().height):null; }
      return { panel:h('#folia-panel'), box:h('.fp-box'), summary:h('.fp-summary'), body:h('.fp-body'), mount:h('.fp-mount') };
    })()
  };
})()`;

/* 全局滚动快照：面板内滚不动时，滚轮很可能穿透到背后的主页列表上。
   这条不查「谁应该滚」，只查「谁真的滚了」——包括面板外的元素。 */
const GLOBAL_SCROLL = `(function(){
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('*'), function(el){
    var cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      out.push({
        n: (el.id ? '#' + el.id : '') + (String(el.className || '').trim().split(/\\s+/).slice(0,2).join('.')),
        st: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight
      });
    }
  });
  var se = document.scrollingElement || document.documentElement;
  return { docTop: se ? se.scrollTop : -1, docH: se ? se.scrollHeight : -1, list: out.slice(0, 18) };
})()`;

(async () => {
  if (!fs.existsSync(EXE)) { console.error('缺少打包产物:', EXE); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  /* 归档目录放项目内：os.tmpdir() 在 C 盘，禁用；固定路径也方便复跑时覆盖 */
  const userDataDir = path.join(OUT_DIR, 'userdata');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  /* 空档案下模组只渲染背景墙、不出卡片列表，量不到真实布局。
     这里把用户档案的记录副本（只读复制，已授权）塞进探针数据目录。 */
  const modsRoot = path.join(userDataDir, 'mods-data');
  fs.mkdirSync(modsRoot, { recursive: true });
  const seedDir = path.join(OUT_DIR, 'seed-mods-data');
  if (fs.existsSync(seedDir)) {
    fs.cpSync(seedDir, modsRoot, { recursive: true });
    console.log('  已装载档案副本:', seedDir);
  }
  env.MINERADIO_MODS_DATA_DIR = modsRoot;
  /* 预置低性能模式：验证模组是否走另一套（非画布）渲染分支 */
  if (process.env.FP_LOW_PERF === '1') {
    const filesDir = path.join(env.MINERADIO_MODS_DATA_DIR, 'listening-archive', 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, 'settings.json'), JSON.stringify({ lowPerformance: true }));
    console.log('  已预置 lowPerformance=true');
  }

  const child = spawn(EXE, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
  ], { cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let code = 0;
  try {
    await waitDevtools(45000);
    let page = null;
    const end = Date.now() + 70000;
    while (Date.now() < end) {
      const targets = await httpJson('/json/list');
      page = (targets || []).find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url || ''));
      if (page) break;
      await delay(400);
    }
    if (!page) throw new Error('主窗口未导航');

    const ws = await wsConnect(page.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable');
    await send(ws, 'Page.enable');
    await send(ws, 'Page.bringToFront');
    /* 用真实窗口尺寸复现：用户的截图是 1080×736，比默认窗口矮 100px，
       同样的 CSS 在矮窗口下会重新溢出。 */
    const vw = Number(process.env.FP_VW || 1080);
    const vh = Number(process.env.FP_VH || 736);
    try {
      await send(ws, 'Emulation.setDeviceMetricsOverride', {
        width: vw, height: vh, deviceScaleFactor: 1, mobile: false,
      });
      console.log('  视口模拟 ' + vw + '×' + vh);
    } catch (e) { console.log('  视口模拟失败:', e && e.message); }
    await delay(1500);

    await evalJs(ws, `(function(){
      window.__fpErr = null;
      window.addEventListener('error', function(ev){ window.__fpErr = String(ev.message || ev.error); });
      window.addEventListener('unhandledrejection', function(ev){ window.__fpErr = 'reject:' + String(ev.reason); });
      return true;
    })()`);
    /* 开屏动画 + 模组 activate 都是异步的：固定 sleep 在慢机器上会错过，
       轮询等到 openFoliaHomeTab 真的出现为止。 */
    let opened = 'missing';
    const openDeadline = Date.now() + 40000;
    while (Date.now() < openDeadline) {
      opened = await evalJs(ws, `(function(){
        try { return typeof openFoliaHomeTab === 'function' ? openFoliaHomeTab('archive') : 'missing'; }
        catch (e) { return 'throw:' + e.message; }
      })()`);
      if (opened === true) break;
      await delay(800);
    }
    console.log('openFoliaHomeTab →', opened);
    await delay(2600);

    const before = await evalJs(ws, DIAG);
    const gBefore = await evalJs(ws, GLOBAL_SCROLL);
    console.log('\n=== 打开后（未滚动）===');
    console.log('全局滚动:', JSON.stringify(gBefore));
    console.log(JSON.stringify(before, null, 1));
    await shot(ws, '01-before-scroll.png');

    /* 装一个 wheel 计数器：先分清「事件没到」和「事件到了但没滚」 */
    await evalJs(ws, `(function(){
      window.__wheelCount = 0;
      window.__hitAt = (document.elementFromPoint(540, 620) || {}).className || '';
      document.addEventListener('wheel', function(){ window.__wheelCount++; }, { passive: true, capture: true });
      return true;
    })()`);

    /* 方式 A：合成滚动手势（最接近真实滚轮） */
    let gestureErr = '';
    try {
      await send(ws, 'Input.synthesizeScrollGesture', {
        x: 540, y: 620, yDistance: 320, gestureSourceType: 'mouse', speed: 800,
      });
    } catch (e) { gestureErr = String(e && e.message); }
    await delay(700);
    let a = await evalJs(ws, `({ wheels: window.__wheelCount, hit: window.__hitAt,
      st: (document.querySelector('#folia-panel .archive-canvas') || {}).scrollTop })`);

    /* 方式 B：CDP 原生 mouseWheel（带完整按钮字段） */
    for (let i = 0; i < 3; i++) {
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: 540, y: 620, deltaX: 0, deltaY: 360,
        modifiers: 0, button: 'none', clickCount: 0, pointerType: 'mouse',
      });
      await delay(200);
    }
    await delay(600);
    let b = await evalJs(ws, `(function(){
      var w = document.querySelector('#folia-panel .archive-canvas .canvas-world');
      return { wheels: window.__wheelCount, hit: window.__hitAt,
        st: (document.querySelector('#folia-panel .archive-canvas') || {}).scrollTop,
        worldTransform: w ? (w.style.transform || getComputedStyle(w).transform) : null,
        err: window.__fpErr || null };
    })()`);
    console.log('  合成手势(' + (gestureErr || 'ok') + ') →', JSON.stringify(a));
    console.log('  原生滚轮 →', JSON.stringify(b));

    const after = await evalJs(ws, DIAG);
    const gAfter = await evalJs(ws, GLOBAL_SCROLL);
    console.log('\n=== 滚轮之后 ===');
    console.log('全局滚动:', JSON.stringify(gAfter));
    var shifted = (gBefore.list || []).map(function (x, i) {
      var y = (gAfter.list || [])[i] || {};
      return { n: x.n, from: x.st, to: y.st, delta: (y.st || 0) - x.st };
    }).filter(function (x) { return x.delta !== 0; });
    console.log('面板外被滚动的容器:', JSON.stringify(shifted));
    console.log(JSON.stringify(after, null, 1));
    await shot(ws, '02-after-scroll.png');

    /* 谁真的滚了 */
    const moved = (before.scrollers || []).map((s, i) => {
      const a = (after.scrollers || [])[i] || {};
      return { n: s.n, from: s.st, to: a.st, delta: (a.st || 0) - s.st };
    });
    console.log('\n=== scrollTop 变化 ===');
    console.log(JSON.stringify(moved, null, 1));

    fs.writeFileSync(path.join(OUT_DIR, 'diag.json'), JSON.stringify({ before, after, moved }, null, 1));
  } catch (err) {
    console.error('探针失败:', err && err.message);
    code = 1;
  } finally {
    /* 只杀自己起的进程树：/IM 会把用户正在听的实例一起杀掉 */
    try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
    try { child.kill(); } catch (_) {}
  }
  process.exit(code);
})();
