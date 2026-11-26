'use strict';
/**
 * 真 Electron 探针：Folia 面板模组「听歌档案」接入验证。
 *
 * 验证链路（不是静态检查，全部运行时取值）：
 *   1. 模组 client.mjs 被 activate，注册出 homeTab「archive」
 *   2. 主进程 index.cjs 起来了：archive.settings 能穿过 preload → IPC → 模组 RPC 返回
 *   3. openFoliaHomeTab('archive') 后 #folia-panel 出 .show，里面长出 .archive-root
 *   4. 面板有真实内容（innerText 非空、有 tab 按钮）
 *   5. Escape / 关闭按钮能收起
 *   6. 截图落盘，人工看真实渲染
 *
 * 用独立 --user-data-dir：不碰用户真实档案；模组数据也写在临时目录里，
 * 顺便验证「目录不存在会自动建」。
 *
 * 用法：node scripts/probe-folia-panel.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9333;
const OUT_DIR = path.join(ROOT, '_debug-archive', '2026-11-25-folia-panel');

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout ' + urlPath)); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForDevtools(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await httpJson('/json/version');
      if (v && v.webSocketDebuggerUrl) return v;
    } catch (_) {}
    await delay(300);
  }
  throw new Error('CDP 端口未就绪（' + PORT + '）');
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(new Error('ws error: ' + (e && e.message || e)));
  });
}

let msgId = 0;
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
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
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r && r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('eval threw: ' + (d.text || '') + ' ' + ((d.exception && d.exception.description) || ''));
  }
  return r && r.result ? r.result.value : undefined;
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('缺少打包产物:', EXE);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-folia-'));
  console.log('userData:', userDataDir);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  /* 模组数据默认落在 %APPDATA%\Mineradio\mods-data；探针显式改到临时目录，
   * 既不写用户真实档案，也能验证「目录不存在会自动建」。 */
  const modsDataRoot = path.join(userDataDir, 'mods-data');
  env.MINERADIO_MODS_DATA_DIR = modsDataRoot;

  const child = spawn(EXE, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
  ], {
    cwd: path.dirname(EXE),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let exitCode = 0;
  try {
    await waitForDevtools(45000);

    let page = null;
    const pageDeadline = Date.now() + 70000;
    while (Date.now() < pageDeadline) {
      const targets = await httpJson('/json/list');
      page = (targets || []).find(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url || ''));
      if (page) break;
      await delay(400);
    }
    if (!page) {
      const targets = await httpJson('/json/list');
      throw new Error('主窗口未导航到本地服务，现有: ' + JSON.stringify((targets || []).map(t => t.type + ' ' + t.url)));
    }

    const ws = await wsConnect(page.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable');
    await send(ws, 'Page.enable');
    await send(ws, 'Page.bringToFront');

    const targets = await httpJson('/json/list');
    console.log('  targets:', JSON.stringify((targets || []).map(t => ({ type: t.type, url: (t.url || '').slice(0, 70), title: t.title }))));
    const selfInfo = await evalJs(ws, `(function(){
      return {
        href: location.href,
        title: document.title,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        dpr: window.devicePixelRatio,
        hasSplash: !!document.getElementById('splash'),
        hasUserBtn: !!document.getElementById('user-btn'),
        hasPanel: !!document.getElementById('folia-panel')
      };
    })()`);
    console.log('  当前 target:', JSON.stringify(selfInfo));

    /* 收集页面错误：React 渲染抛错时容器会只剩空壳，不看 console 根本不知道为什么。 */
    const pageErrors = [];
    ws.addEventListener('message', ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        pageErrors.push('exception: ' + ((d && d.exception && d.exception.description) || (d && d.text) || '?'));
      } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (/FoliaPanel|听歌|archive|Listening/i.test(text)) pageErrors.push(m.params.type + ': ' + text.slice(0, 300));
      }
    });

    // 开屏是「点击进入」的门闩（#splash role=button），不会自己走；面板会被它盖住。
    // 只看 body.splash-active 不够：类名先被摘掉、元素还在做退场动画，截图仍是开屏。
    // 判据用 #splash 自身是否 display:none。
    const splashState = () => evalJs(ws, `(function(){
      var s = document.getElementById('splash');
      if (!s) return { gone: true, why: 'no-element' };
      var cs = getComputedStyle(s);
      return {
        gone: cs.display === 'none' || cs.visibility === 'hidden',
        display: cs.display,
        cls: s.className,
        bodyActive: document.body ? document.body.classList.contains('splash-active') : null
      };
    })()`);
    const splashDeadline = Date.now() + 45000;
    let splash = await splashState();
    let splashGone = !!(splash && splash.gone);
    while (!splashGone && Date.now() < splashDeadline) {
      await delay(400);
      splash = await splashState();
      splashGone = !!(splash && splash.gone);
    }
    if (!splashGone) {
      const clicked = await evalJs(ws, `(function(){
        if (typeof dismissSplash === 'function') { dismissSplash(); return 'dismissSplash'; }
        var s = document.getElementById('splash');
        if (s) s.click();
        return 'click';
      })()`);
      console.log('  开屏仍在，主动进入 via', clicked, JSON.stringify(splash));
      const exitDeadline = Date.now() + 15000;
      while (!splashGone && Date.now() < exitDeadline) {
        await delay(400);
        splash = await splashState();
        splashGone = !!(splash && splash.gone);
      }
    }
    check('开屏已退场（主界面可见）', splashGone, JSON.stringify(splash));

    // 1) 等宿主与模组都就绪（模组是 1.5s 后才 import 的）
    const readyDeadline = Date.now() + 45000;
    let state = null;
    while (Date.now() < readyDeadline) {
      state = await evalJs(ws, `(function(){
        var s = window.foliaPanelHostState;
        if (!s) return { has: false };
        return {
          has: true,
          ready: !!s.ready,
          tabs: Object.keys(s.tabs || {}),
          errors: (s.errors || []).map(function(e){ return e.id + ': ' + e.error; })
        };
      })()`);
      if (state && state.ready) break;
      await delay(500);
    }
    check('渲染端宿主已加载', !!(state && state.has), JSON.stringify(state && state.errors));
    check('模组 activate 完成（ready）', !!(state && state.ready));
    check('注册出 archive 面板', !!(state && state.tabs && state.tabs.indexOf('archive') >= 0),
      state && state.tabs ? state.tabs.join(',') : '');
    check('加载过程无错误', !!(state && (!state.errors || !state.errors.length)),
      state && state.errors ? JSON.stringify(state.errors) : '');

    // 2) 主进程 RPC 通路（archive.settings 只读，不写记录）
    const rpcProbe = await evalJs(ws, `(function(){
      if (!window.desktopWindow || !window.desktopWindow.foliaPanel) return Promise.resolve({ ok:false, error:'no bridge' });
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.settings', [])
        .then(function(r){ return { ok: !!(r && r.ok), value: r && r.value, error: r && r.error }; })
        .catch(function(e){ return { ok:false, error: String(e && e.message || e) }; });
    })()`);
    check('主进程模组 RPC 可用（archive.settings）', !!(rpcProbe && rpcProbe.ok),
      JSON.stringify(rpcProbe));

    // 3) 打开面板
    const opened = await evalJs(ws, `(function(){
      var r = typeof openFoliaHomeTab === 'function' ? openFoliaHomeTab('archive') : 'missing';
      return r;
    })()`);
    check('openFoliaHomeTab 受理', opened === true, String(opened));

    await delay(2200);

    const dom = await evalJs(ws, `(function(){
      var panel = document.getElementById('folia-panel');
      var root = panel && panel.querySelector('.archive-root');
      var mount = panel && panel.querySelector('.fp-mount');
      var canvases = root ? root.querySelectorAll('canvas').length : 0;
      var canvasBox = root ? root.querySelector('canvas') : null;
      var clickable = root ? root.querySelectorAll('button, [role="button"], a').length : 0;
      var cs = root ? getComputedStyle(root) : null;
      var chain = [];
      if (root) {
        var node = root;
        for (var depth = 0; node && depth < 8; depth++) {
          var ns = getComputedStyle(node);
          chain.push((node.id ? '#' + node.id : node.className ? '.' + String(node.className).split(/\\s+/)[0] : node.tagName)
            + ' vis=' + ns.visibility + ' op=' + ns.opacity + ' disp=' + ns.display);
          node = node.parentElement;
        }
      }
      return {
        panelExists: !!panel,
        show: !!(panel && panel.classList.contains('show')),
        boxW: panel ? Math.round(panel.querySelector('.fp-box').getBoundingClientRect().width) : 0,
        boxH: panel ? Math.round(panel.querySelector('.fp-box').getBoundingClientRect().height) : 0,
        mountExists: !!mount,
        rootExists: !!root,
        rootW: root ? Math.round(root.getBoundingClientRect().width) : 0,
        rootH: root ? Math.round(root.getBoundingClientRect().height) : 0,
        rootDisplay: cs ? cs.display : '',
        rootVisibility: cs ? cs.visibility : '',
        rootOpacity: cs ? cs.opacity : '',
        canvases: canvases,
        canvasW: canvasBox ? Math.round(canvasBox.getBoundingClientRect().width) : 0,
        canvasH: canvasBox ? Math.round(canvasBox.getBoundingClientRect().height) : 0,
        clickable: clickable,
        contentLen: root ? (root.textContent || '').replace(/\\s+/g, ' ').trim().length : 0,
        contentHead: root ? (root.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) : '',
        textLen: root ? (root.innerText || '').replace(/\\s+/g, ' ').trim().length : 0,
        textHead: root ? (root.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160) : '',
        htmlHead: root ? (root.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 700) : '',
        chain: chain,
        children: root ? root.children.length : -1
      };
    })()`);
    check('#folia-panel 已显示', !!(dom && dom.show));
    check('模组容器已挂载', !!(dom && dom.mountExists && dom.rootExists), JSON.stringify(dom));
    check('面板有真实尺寸', !!(dom && dom.boxW > 600 && dom.boxH > 400), dom ? dom.boxW + '×' + dom.boxH : '');
    /* 模组的排行可能是 DOM 也可能是 canvas；两种情况都认，但必须有真实内容。
     * textContent 不看布局，比 innerText 可靠（innerText 在 opacity/transform 祖先下会返回空）。 */
    check('模组内容已渲染（有文字内容或画布）',
      !!(dom && (dom.contentLen > 20 || (dom.canvases > 0 && dom.canvasW > 300))),
      dom ? 'text=' + dom.contentLen + ' canvas=' + dom.canvases + ' clickable=' + dom.clickable : '');
    check('可交互元素存在', !!(dom && dom.clickable > 0), dom ? String(dom.clickable) : '');
    if (dom) console.log('  面板内容开头:', dom.contentHead);
    if (dom) console.log('  root 样式链:\n    ' + (dom.chain || []).join('\n    '));

    // 面板 visibility 若非 visible，把命中的 CSS 规则打出来（不猜，直接找源头）
    const visSrc = await evalJs(ws, `(function(){
      var el = document.getElementById('folia-panel');
      if (!el) return { vis: 'no-el' };
      var hits = [];
      function walk(rules, href) {
        for (var i = 0; i < rules.length; i++) {
          var r = rules[i];
          if (r.style && r.style.visibility && String(r.style.visibility).toLowerCase() !== 'visible' && r.selectorText) {
            try { if (el.matches(r.selectorText)) hits.push(href + ' :: ' + r.selectorText + ' -> ' + r.style.visibility); } catch (_) {}
          }
          if (r.cssRules) walk(r.cssRules, href);
        }
      }
      for (var s = 0; s < document.styleSheets.length; s++) {
        var ss = document.styleSheets[s];
        try { walk(ss.cssRules, (ss.href || 'inline').split('/').pop()); } catch (_) {}
      }
      var cs = getComputedStyle(el);
      return { vis: cs.visibility, op: cs.opacity, disp: cs.display, hits: hits, inline: el.getAttribute('style') || '' };
    })()`);
    console.log('  面板 visibility 来源:', JSON.stringify(visSrc));
    if (dom) console.log('  DOM 片段:', dom.htmlHead);
    if (pageErrors.length) console.log('  页面错误:\n    ' + pageErrors.slice(0, 8).join('\n    '));
    else console.log('  页面错误: 无');

    // 4) 截图
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      const file = path.join(OUT_DIR, 'panel-open.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      check('截图已保存', true, file);
    } else {
      check('截图已保存', false, 'no data');
    }

    // 5) Escape 收起
    await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await delay(600);
    const closed = await evalJs(ws, `(function(){
      var p = document.getElementById('folia-panel');
      return { show: !!(p && p.classList.contains('show')), bodyLock: document.body.classList.contains('folia-panel-open') };
    })()`);
    check('Escape 能关闭面板', !!(closed && !closed.show && !closed.bodyLock), JSON.stringify(closed));

    // 6) 再打开一次，确认复用同一棵 React 树（不重复 mount）
    await evalJs(ws, `openFoliaHomeTab('archive')`);
    await delay(900);
    const reopened = await evalJs(ws, `(function(){
      var p = document.getElementById('folia-panel');
      return {
        show: !!(p && p.classList.contains('show')),
        mounts: p ? p.querySelectorAll('.fp-mount').length : -1
      };
    })()`);
    check('再次打开复用同一实例（只有一个 .fp-mount）',
      !!(reopened && reopened.show && reopened.mounts === 1), JSON.stringify(reopened));

    // 6b) 账号胶囊真实点击链路：未登录时会弹登录框，这里把登录判定 stub 成已登录，
    //     点 #user-btn 应该落到听歌档案（而不是账号信息弹窗）。
    const btnFlow = await evalJs(ws, `(function(){
      window.closeFoliaPanel();
      window.hasAnyPlatformLogin = function () { return true; };
      var opened = null;
      var orig = window.openFoliaHomeTab;
      window.openFoliaHomeTab = function (id) { opened = id; return orig(id); };
      var btn = document.getElementById('user-btn');
      if (btn) btn.click();
      window.openFoliaHomeTab = orig;
      var panel = document.getElementById('folia-panel');
      var userModal = document.getElementById('user-modal');
      return {
        clickedId: opened,
        panelShown: !!(panel && panel.classList.contains('show')),
        userModalOpen: !!(userModal && (userModal.classList.contains('show') || getComputedStyle(userModal).display !== 'none')),
        hasUserBtn: !!btn
      };
    })()`);
    check('账号胶囊点击 → 打开听歌档案（tab=archive）',
      !!(btnFlow && btnFlow.clickedId === 'archive' && btnFlow.panelShown), JSON.stringify(btnFlow));
    check('账号胶囊不再弹账号信息弹窗', !!(btnFlow && !btnFlow.userModalOpen), JSON.stringify(btnFlow));

    // 7) 模组数据目录是否已建（主进程侧副作用）
    const modsData = path.join(modsDataRoot, 'listening-archive');
    check('模组数据目录已创建', fs.existsSync(modsData), modsData);

    // 8) 采集链路：伪造一首「正在播放」的歌，让模组按秒采样，停播后落盘。
    //    audio 元素在未播放时可能还没创建，这里直接换成一个可读写的假元素：
    //    宿主只从中读 currentTime/duration/volume/muted，不调方法。
    const fake = await evalJs(ws, `(function(){
      window.audio = {
        currentTime: 0, duration: 180, volume: 1, muted: false, paused: false, src: '',
        addEventListener: function(){}, removeEventListener: function(){}
      };
      /* 带封面：模组会走 stageLayers 把封面缩成 webp dataURL 存进档案目录，
       * 这是「封面能不能显示」的唯一真链路（不是查 CSS 有没有背景图）。 */
      window.playQueue = [{
        name: '探针测试曲', artist: '探针歌手', album: '探针专辑', id: '990001',
        provider: 'netease', source: 'netease',
        cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeElEQVR4nO3PQQkAMAzAwAqrfyZrIvY4BoEIuMzZ/brhgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAseuzfrAS2gdd8fAAAAAElFTkSuQmCC'
      }];
      window.currentIdx = 0;
      window.playing = true;
      window.__fpTimer = setInterval(function(){ window.audio.currentTime += 0.9; }, 900);
      return { queue: window.playQueue.length, idx: window.currentIdx };
    })()`);
    check('已注入模拟播放状态（含封面）', !!(fake && !fake.err), JSON.stringify(fake));

    await delay(7000);
    const played = await evalJs(ws, `(function(){
      clearInterval(window.__fpTimer);
      window.playQueue = [];
      window.currentIdx = -1;
      window.playing = false;
      return { t: window.__fpT };
    })()`);
    console.log('  模拟播放累计 position =', played && played.t);

    await delay(3500);
    const recQuery = await evalJs(ws, `(function(){
      var d = new Date(); d.setHours(0,0,0,0);
      var start = d.getTime(), end = start + 86400000;
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.query', [{ start: start, end: end, period: 'day' }])
        .then(function(r){
          var v = (r && r.value) || {};
          return {
            ok: !!(r && r.ok),
            error: r && r.error,
            keys: Object.keys(v).slice(0, 10),
            summary: JSON.stringify(v.summary || {}).slice(0, 320),
            songs: Array.isArray(v.songs) ? v.songs.length : null,
            firstSong: Array.isArray(v.songs) && v.songs[0] ? JSON.stringify(v.songs[0]).slice(0, 220) : ''
          };
        })
        .catch(function(e){ return { ok:false, error:String(e && e.message || e) }; });
    })()`);
    const summary = (() => {
      try { return JSON.parse(recQuery && recQuery.summary || '{}'); } catch (_) { return {}; }
    })();
    const recorded = !!(recQuery && recQuery.ok
      && ((Number(summary.plays) > 0) || (Number(summary.totalMs) > 0) || Number(summary.durationSeconds) > 0
        || (recQuery.songs != null && recQuery.songs > 0)));
    check('模拟播放已写入档案（summary/songs 有数据）', recorded, JSON.stringify(recQuery));
    if (!recorded) console.log('  summary 原样:', recQuery && recQuery.summary);

    // 8b) 封面链路：模组把当前封面缩成 webp dataURL 存进档案目录，这里按歌曲 key 取回来。
    const coverProbe = await evalJs(ws, `(function(){
      var d = new Date(); d.setHours(0,0,0,0);
      var start = d.getTime(), end = start + 86400000;
      var api = window.desktopWindow.foliaPanel;
      return api.rpc('listening-archive', 'archive.query', [{ start: start, end: end, period: 'day' }])
        .then(function (q) {
          var songs = (q && q.value && q.value.songs) || [];
          var hit = songs.filter(function (s) { return s && s.name === '探针测试曲'; })[0];
          if (!hit) return { ok: false, error: '没找到探针测试曲' };
          return api.rpc('listening-archive', 'archive.artworks', [[hit.key]]).then(function (r) {
            var map = (r && r.value) || {};
            var entry = map[hit.key];
            var url = entry && entry.url ? String(entry.url) : '';
            return { ok: !!(r && r.ok), key: hit.key, hasUrl: !!url, urlHead: url.slice(0, 40), len: url.length };
          });
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    })()`);
    check('封面已捕获并写入档案（artworks 有 dataURL）', !!(coverProbe && coverProbe.hasUrl), JSON.stringify(coverProbe));

    // 8c) 按钮结构 dump：morphicons 替换图标要知道原按钮长什么样
    const btnDump = await evalJs(ws, `(function(){
      var root = document.querySelector('#folia-panel .archive-root');
      if (!root) return null;
      var btns = [].slice.call(root.querySelectorAll('button'));
      function brief(b) {
        return {
          cls: String(b.className || '').slice(0, 48),
          aria: b.getAttribute('aria-label') || '',
          title: b.getAttribute('title') || '',
          text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24),
          svgCount: b.querySelectorAll('svg').length,
          html: b.outerHTML.replace(/\\s+/g, ' ').slice(0, 420)
        };
      }
      /* 按类名去重，保留每种按钮一个样本 */
      var seen = {};
      var uniq = [];
      btns.forEach(function (b) {
        var k = String(b.className || '') + '|' + (b.getAttribute('aria-label') || '') + '|' + (b.textContent || '').trim().slice(0, 6);
        if (seen[k]) return;
        seen[k] = 1;
        uniq.push(brief(b));
      });
      return { total: btns.length, unique: uniq.length, samples: uniq.slice(0, 14) };
    })()`);
    if (btnDump) {
      const btnFile = path.join(OUT_DIR, 'buttons.json');
      fs.writeFileSync(btnFile, JSON.stringify(btnDump, null, 2));
      console.log('  按钮结构 → ' + btnFile + '（' + btnDump.total + ' 个按钮，' + btnDump.unique + ' 种）');
    }

    // 8d) 图标升级：模组内联的 16 网格 SVG 应已换成 morphicons 的 24 网格图标
    const iconProbe = await evalJs(ws, `(function(){
      var root = document.querySelector('#folia-panel .archive-root');
      if (!root) return null;
      var ups = root.querySelectorAll('svg[data-mi="up"]');
      var names = {};
      for (var i = 0; i < ups.length; i++) {
        var n = ups[i].getAttribute('data-mi-name') || '?';
        names[n] = (names[n] || 0) + 1;
      }
      var box = ups.length ? ups[0].getAttribute('viewBox') : '';
      return {
        upgraded: ups.length,
        names: names,
        viewBox: box,
        untouched: root.querySelectorAll('svg:not([data-mi])').length,
        hasLib: !!(window.Morphicons && typeof window.Morphicons.createMorph === 'function')
      };
    })()`);
    check('morphicons 库在页面可用', !!(iconProbe && iconProbe.hasLib), JSON.stringify(iconProbe && iconProbe.hasLib));
    check('按钮图标已升级（16 网格 → 24 网格 Lucide）',
      !!(iconProbe && iconProbe.upgraded > 0 && iconProbe.viewBox === '0 0 24 24'),
      JSON.stringify(iconProbe));
    if (iconProbe) console.log('  图标明细:', JSON.stringify(iconProbe.names), '未升级:', iconProbe.untouched);
    if (iconProbe && iconProbe.untouched) {
      const rest = await evalJs(ws, `(function(){
        var root = document.querySelector('#folia-panel .archive-root');
        return [].slice.call(root.querySelectorAll('svg:not([data-mi])')).map(function(s){
          var p = s.querySelector('path');
          return { vb: s.getAttribute('viewBox'), d: p ? (p.getAttribute('d') || '').slice(0, 46) : '' };
        }).slice(0, 10);
      })()`);
      console.log('  未匹配的 svg:', JSON.stringify(rest));
    }

    // 9) 面板 UI + 多曲排列：直接写 3 条不同歌的记录（走模组的 archive.record 校验），
    //    刷新后看 UI 是否按 3 首正常排列 —— 单曲被铺满一屏时无法判断是「填充」还是列表 bug。
    const seed = await evalJs(ws, `(function(){
      var now = Date.now();
      var songs = [
        { id: '990001', title: '探针曲A', artist: '歌手A', album: '专辑A', source: 'netease' },
        { id: '990002', title: '探针曲B', artist: '歌手B', album: '专辑B', source: 'netease' },
        { id: '990003', title: '探针曲C', artist: '歌手C', album: '专辑C', source: 'netease' }
      ];
      var calls = songs.map(function (song, i) {
        var startedAt = now - 3600000 + i * 360000;
        return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.record', [{
          id: 'probe-' + (i + 1), revision: 1, closed: true,
          startedAt: startedAt, endedAt: startedAt + 40000, duration: 180,
          song: song,
          segments: [{ start: startedAt, end: startedAt + 40000, seconds: 40, offset: 0 }]
        }]).then(function (r) { return r && r.ok; }).catch(function () { return false; });
      });
      return Promise.all(calls).then(function (res) { return { results: res }; });
    })()`);
    check('archive.record 接受 3 条测试记录', !!(seed && seed.results && seed.results.every(Boolean)), JSON.stringify(seed));

    await evalJs(ws, `window.openFoliaHomeTab('archive')`);
    await delay(800);
    const refreshHit = await evalJs(ws, `(function(){
      var btns = [].slice.call(document.querySelectorAll('#folia-panel button'));
      var hit = btns.filter(function(b){ return /刷新/.test(b.textContent || ''); })[0];
      if (hit) hit.click();
      return { found: !!hit, total: btns.length };
    })()`);
    await delay(2400);
    const uiData = await evalJs(ws, `(function(){
      var root = document.querySelector('#folia-panel .archive-root');
      var text = root ? (root.innerText || '') : '';
      function count(needle) { return text.split(needle).length - 1; }
      /* 排行区（.archive-canvas 里的可见卡片）按位次分组，取标题文字判定排列 */
      var listCards = [].slice.call(document.querySelectorAll('#folia-panel .archive-canvas [data-testid], #folia-panel .archive-canvas article'))
        .filter(function (el) { var r = el.getBoundingClientRect(); return r.width > 40 && r.height > 40; })
        .map(function (el) { return (el.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 40); });
      return {
        a: count('探针曲A'), b: count('探针曲B'), c: count('探针曲C'),
        hasAll: text.indexOf('探针曲A') >= 0 && text.indexOf('探针曲B') >= 0 && text.indexOf('探针曲C') >= 0,
        /* 不用正则 \\b：这段代码在模板字符串里，\\b 会被 JS 解析成退格字符 */
        hasRanks: ['01', '02', '03', '04'].every(function (n) { return text.indexOf(n) >= 0; }),
        ranks: listCards.slice(0, 6),
        len: text.replace(/\\s+/g,' ').trim().length,
        head: text.replace(/\\s+/g,' ').trim().slice(0, 240)
      };
    })()`);
    /* 不能用 textContent 的出现次数判「有没有重复卡片」：模组的封面墙与排行列表都在 DOM 里，
     * 还有虚拟滚动留下的隐藏副本，同一首歌会出现十几次。真实视觉效果见 panel-with-data.png
     * （4 张卡：01–04，各一首）。这里只校验位次 01–04 齐全，说明是按 4 首排列而不是单曲铺满。 */
    check('排行位次 01–04 齐全',
      !!(uiData && uiData.hasRanks),
      uiData ? uiData.head.slice(0, 120) : '');
    if (refreshHit) console.log('  刷新按钮:', JSON.stringify(refreshHit));

    // 9b) 列表渲染后的图标：卡片上的播放/加号/箭头是否也升级了（空状态测不到）
    const cardIcons = await evalJs(ws, `(function(){
      var root = document.querySelector('#folia-panel .archive-canvas');
      if (!root) return null;
      var svgs = [].slice.call(root.querySelectorAll('svg'));
      function d(s) { var p = s.querySelector('path'); return p ? String(p.getAttribute('d') || '') : ''; }
      var seen = {};
      var kinds = [];
      svgs.forEach(function (s) {
        var k = (s.getAttribute('data-mi-name') || 'raw') + '|' + d(s).slice(0, 30);
        if (seen[k]) return;
        seen[k] = 1;
        kinds.push({ mi: s.getAttribute('data-mi-name') || '', vb: s.getAttribute('viewBox'), d: d(s).slice(0, 46) });
      });
      return {
        total: svgs.length,
        upgraded: svgs.filter(function (s) { return s.getAttribute('data-mi') === 'up'; }).length,
        kinds: kinds.slice(0, 10)
      };
    })()`);
    check('卡片内图标也已升级',
      !!(cardIcons && cardIcons.total > 0 && cardIcons.upgraded > 0),
      JSON.stringify(cardIcons));
    if (cardIcons) console.log('  卡片图标:', JSON.stringify(cardIcons.kinds));

    // 9c) 卡片按钮真实结构：▷ ＋ ↗ 如果不是 svg，就得走别的替换路径
    const cardBtns = await evalJs(ws, `(function(){
      var root = document.querySelector('#folia-panel .archive-canvas');
      if (!root) return null;
      var cards = [].slice.call(root.querySelectorAll('article, [data-testid], li')).filter(function (el) {
        var r = el.getBoundingClientRect();
        return r.width > 120 && r.height > 80;
      });
      var host = cards[0] || root;
      var btns = [].slice.call(host.querySelectorAll('button'));
      var covers = [].slice.call(document.querySelectorAll('#folia-panel .archive-canvas img, #folia-panel .archive-canvas [style*="background-image"]')).slice(0, 3);
      return {
        cardTag: host.tagName + '.' + String(host.className || '').split(/\\s+/)[0],
        btnCount: btns.length,
        btns: btns.slice(0, 6).map(function (b) { return b.outerHTML.replace(/\\s+/g, ' ').slice(0, 300); }),
        covers: covers.map(function (c) {
          return c.tagName === 'IMG' ? String(c.src || '').slice(0, 60) : String(c.getAttribute('style') || '').slice(0, 100);
        })
      };
    })()`);
    if (cardBtns) console.log('  卡片按钮结构:', JSON.stringify(cardBtns, null, 1).slice(0, 2200));

    // 9d) 卡片动作按钮的图标覆盖层（伪元素 + SVG mask）是否真的生效
    const maskProbe = await evalJs(ws, `(function(){
      var sel = ['立即播放', '加入队列', '查看轨迹'];
      var out = {};
      sel.forEach(function (kw) {
        var btn = document.querySelector('#folia-panel .cover-window button[aria-label^="' + kw + '"]');
        if (!btn) { out[kw] = 'missing'; return; }
        var cs = getComputedStyle(btn);
        var be = getComputedStyle(btn, '::before');
        out[kw] = {
          color: cs.color,
          beforeW: be.width + 'x' + be.height,
          mask: String(be.webkitMaskImage || be.maskImage || '').slice(0, 40),
          bg: be.backgroundColor
        };
      });
      return out;
    })()`);
    const maskOk = !!(maskProbe && ['立即播放', '加入队列', '查看轨迹'].every(function (k) {
      const v = maskProbe[k];
      return v && v !== 'missing' && v.color === 'rgba(0, 0, 0, 0)' && v.beforeW === '13pxx13px';
    }));
    check('卡片动作按钮已换成 SVG 图标（字形透明 + mask 覆盖）', maskOk, JSON.stringify(maskProbe));

    const shot2 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shot2 && shot2.data) {
      const file2 = path.join(OUT_DIR, 'panel-with-data.png');
      fs.writeFileSync(file2, Buffer.from(shot2.data, 'base64'));
      console.log('  有数据截图:', file2);
    }

    const failed = checks.filter(c => !c.ok);
    console.log('\n' + (failed.length ? 'FAILED ' + failed.length + '/' + checks.length : 'ALL CHECKS PASSED (' + checks.length + ')'));
    if (failed.length) exitCode = 1;
  } catch (err) {
    console.error('探针异常:', err && err.stack || err);
    exitCode = 1;
  } finally {
    /* 只杀本次探针起的进程树：/IM 会顺手打死用户正在用的播放器。 */
    try {
      if (child.pid) require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' });
    } catch (_) {}
    try { child.kill(); } catch (_) {}
    await delay(600);
  }
  process.exit(exitCode);
})();
