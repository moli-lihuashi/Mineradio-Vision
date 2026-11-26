'use strict';
/**
 * 实机诊断：听歌档案「封面不显示 / 重复歌曲」。
 *
 * 和 probe-folia-panel.js 的区别：那个用临时 userData + 假数据，只能证明代码路径通；
 * 这个用**真实 userData**（带登录态、真实歌单），拿真实歌曲对象跑，回答两个问题：
 *   1. 真实歌曲的 cover 字段是什么？coverProxySrc 出来的 URL 能不能 200？
 *   2. 档案里的 records / songs 到底几条？卡片为什么重复？
 *
 * 只读查询为主；会真的播一首（这是功能本身），档案会多一条记录。
 *
 * 用法：node scripts/diag-folia-live.js
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9333;
const OUT = path.join(ROOT, '_debug-archive', '2026-11-25-folia-live');

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function waitDevtools(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await httpJson('/json/version'); if (v && v.webSocketDebuggerUrl) return v; } catch (_) {}
    await delay(300);
  }
  throw new Error('CDP 未就绪');
}
function wsConnect(url) {
  return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = e => rej(new Error('ws')); });
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
  if (r && r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('eval threw: ' + (d.text || '') + ' ' + ((d.exception && d.exception.description) || ''));
  }
  return r && r.result ? r.result.value : undefined;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINERADIO_MODS_DATA_DIR;   // 用真实数据目录

  const child = spawn(EXE, ['--remote-debugging-port=' + PORT], {
    cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'inherit'],
  });
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

    // 开屏是点击门闩
    await delay(1500);
    const splash = await evalJs(ws, `(function(){
      var s = document.getElementById('splash');
      if (!s) return 'none';
      var cs = getComputedStyle(s);
      if (cs.display === 'none') return 'gone';
      if (typeof dismissSplash === 'function') { dismissSplash(); return 'dismissed'; }
      s.click(); return 'clicked';
    })()`);
    await delay(2500);
    console.log('开屏:', splash);

    // 1) 模组宿主状态
    const hostState = await evalJs(ws, `(function(){
      var s = window.foliaPanelHostState;
      return s ? { ready: !!s.ready, tabs: Object.keys(s.tabs || {}), errors: (s.errors || []).map(function(e){return e.id+': '+e.error;}) } : null;
    })()`);
    console.log('\n[1] 宿主状态:', JSON.stringify(hostState));

    // 2) 真实歌曲对象：历史记录里那条 + 当前队列
    const realSongs = await evalJs(ws, `(function(){
      var out = { history: [], queue: [], current: null };
      try {
        var h = (typeof listenStatsState !== 'undefined' && listenStatsState.history) || [];
        out.history = h.slice(0, 3).map(function (r) {
          return { name: r.name, artist: r.artist, cover: String(r.cover || '').slice(0, 90), key: r.key };
        });
      } catch (e) { out.historyErr = String(e); }
      try {
        out.queue = (playQueue || []).slice(0, 3).map(function (s) {
          return { name: s.name, artist: s.artist, cover: String(s.cover || '').slice(0, 90), id: s.id, hash: s.hash, mid: s.mid, album: typeof s.album === 'object' ? '[obj]' + JSON.stringify(s.album).slice(0,40) : s.album };
        });
        out.current = currentIdx;
      } catch (e) { out.queueErr = String(e); }
      return out;
    })()`);
    console.log('\n[2] 真实歌曲:');
    console.log('  历史:', JSON.stringify(realSongs && realSongs.history, null, 1));
    console.log('  队列:', JSON.stringify(realSongs && realSongs.queue, null, 1));

    // 3) 封面 URL 可达性：拿历史里的 cover 走 songCoverSrc + coverProxySrc，再 fetch
    const coverProbe = await evalJs(ws, `(function(){
      var h = (typeof listenStatsState !== 'undefined' && listenStatsState.history) || [];
      var r = h[0];
      if (!r) return { error: '没有历史记录' };
      var fake = { name: r.name, artist: r.artist, cover: r.cover, id: r.id, provider: r.provider, source: r.source };
      var viaSong = '';
      var viaProxy = '';
      try { viaSong = typeof songCoverSrc === 'function' ? songCoverSrc(fake, 640) : '(no songCoverSrc)'; } catch (e) { viaSong = 'ERR ' + e.message; }
      try { viaProxy = typeof coverProxySrc === 'function' ? coverProxySrc(r.cover) : '(no coverProxySrc)'; } catch (e) { viaProxy = 'ERR ' + e.message; }
      function probe(url) {
        if (!url) return Promise.resolve({ url: '', skipped: true });
        return fetch(url, { method: 'GET' }).then(function (res) {
          return { url: String(url).slice(0, 120), status: res.status, type: res.headers.get('content-type'), len: res.headers.get('content-length') };
        }).catch(function (e) { return { url: String(url).slice(0, 120), error: String(e && e.message || e) }; });
      }
      return Promise.all([probe(viaSong), probe(viaProxy)]).then(function (arr) {
        return { rawCover: String(r.cover || '').slice(0, 90), songCoverSrc: arr[0], coverProxySrc: arr[1] };
      });
    })()`);
    console.log('\n[3] 封面可达性:', JSON.stringify(coverProbe, null, 1));

    // 4) 档案现状：records 与 songs 各多少条
    const archive = await evalJs(ws, `(function(){
      var d = new Date(); d.setHours(0,0,0,0);
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.query', [{ start: d.getTime(), end: d.getTime() + 86400000, period: 'day' }])
        .then(function (r) {
          var v = (r && r.value) || {};
          return {
            ok: !!(r && r.ok),
            recordCount: v.recordCount,
            revision: v.revision,
            summary: v.summary,
            songsLen: (v.songs || []).length,
            songs: (v.songs || []).slice(0, 8).map(function (s) { return { key: s.key, name: s.name, plays: s.plays, seconds: s.seconds }; }),
            bucketsLen: (v.buckets || []).length,
            heatLen: Array.isArray(v.heat) ? v.heat.length : typeof v.heat
          };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    })()`);
    console.log('\n[4] 档案数据:', JSON.stringify(archive, null, 1).slice(0, 1600));

    // 4b) 全局累计（start=0 到明天）：模组 UI 没有这个维度，测一下底层能不能算
    const globalAgg = await evalJs(ws, `(function(){
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.query',
        [{ start: 0, end: Date.now() + 86400000, period: 'year' }])
        .then(function (r) {
          var v = (r && r.value) || {};
          return {
            ok: !!(r && r.ok),
            error: r && r.error,
            summary: v.summary,
            firstRecorded: v.firstRecorded,
            recordCount: v.recordCount,
            songsLen: (v.songs || []).length,
            bucketsLen: (v.buckets || []).length
          };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    })()`);
    console.log('\n[4b] 全局累计:', JSON.stringify(globalAgg));

    // 4c) 旧统计（首页「今日聆听」用的那份）有多少历史，决定「累计」能不能有真实数字
    const legacy = await evalJs(ws, `(function(){
      try {
        var h = (typeof listenStatsState !== 'undefined' && listenStatsState.history) || [];
        var first = h.length ? h[h.length - 1] : null;
        var last = h.length ? h[0] : null;
        return {
          len: h.length,
          oldest: first ? (first.at || first.time || first.playedAt || null) : null,
          newest: last ? (last.at || last.time || last.playedAt || null) : null,
          keys: first ? Object.keys(first).slice(0, 14) : []
        };
      } catch (e) { return { error: String(e && e.message || e) }; }
    })()`);
    console.log('[4c] 旧统计历史:', JSON.stringify(legacy));

    // 4d) archive.records 不受 367 天上限约束，试试一次拿全量并自己累加
    const allRecords = await evalJs(ws, `(function(){
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.records',
        [{ start: 0, end: Date.now() + 86400000, period: 'year' }])
        .then(function (r) {
          if (!r || !r.ok) return { ok: false, error: r && r.error };
          var list = Array.isArray(r.value) ? r.value : (r.value && (r.value.records || r.value.items)) || [];
          var totalSeconds = 0, minAt = Infinity, maxAt = 0;
          for (var i = 0; i < list.length; i++) {
            var rec = list[i];
            var segs = rec.segments || [];
            for (var j = 0; j < segs.length; j++) totalSeconds += Number(segs[j].seconds) || 0;
            if (rec.startedAt < minAt) minAt = rec.startedAt;
            if (rec.endedAt > maxAt) maxAt = rec.endedAt;
          }
          return {
            ok: true,
            count: list.length,
            totalSeconds: Math.round(totalSeconds),
            hours: (totalSeconds / 3600).toFixed(2),
            minAt: isFinite(minAt) ? new Date(minAt).toISOString().slice(0, 10) : null,
            maxAt: maxAt ? new Date(maxAt).toISOString().slice(0, 10) : null,
            shape: Object.keys(r.value || {}).slice(0, 8)
          };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    })()`);
    console.log('[4d] 全量记录:', JSON.stringify(allRecords));

    // 5) 打开展示面板，数卡片
    await evalJs(ws, `window.openFoliaHomeTab('archive')`);
    await delay(2000);
    const cards = await evalJs(ws, `(function(){
      var root = document.querySelector('#folia-panel .archive-canvas');
      if (!root) return null;
      var arts = [].slice.call(root.querySelectorAll('article.cover-window'));
      var cells = [].slice.call(root.querySelectorAll('.canvas-cell'));
      return {
        cards: arts.length,
        cells: cells.length,
        visibleCells: cells.filter(function (c) { return getComputedStyle(c).display !== 'none'; }).length,
        hiddenCells: cells.filter(function (c) { return getComputedStyle(c).display === 'none'; }).length,
        keys: arts.map(function (a) { return a.getAttribute('data-row-key'); }).slice(0, 4),
        summary: (function(){
          var box = document.getElementById('folia-panel-summary');
          var t = document.getElementById('folia-panel-sum-total');
          var d = document.getElementById('folia-panel-sum-dates');
          var a = document.getElementById('folia-panel-sum-daily');
          return {
            visible: !!box && getComputedStyle(box).display !== 'none',
            height: box ? Math.round(box.getBoundingClientRect().height) : 0,
            total: t ? (t.innerText || '').replace(/\s+/g, ' ').trim() : '',
            dates: d ? (d.innerText || '').replace(/\s+/g, ' ').trim() : '',
            daily: a ? (a.innerText || '').replace(/\s+/g, ' ').trim() : '',
            trend: (function () {
              var p = document.querySelector('#folia-panel-sum-trend .fp-trend-line');
              var d = p ? (p.getAttribute('d') || '') : '';
              return { hasPath: d.length > 10, len: d.length };
            })(),
            slogan: (function () {
              var e = document.querySelector('.fp-sum-slogan');
              return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : '';
            })()
          };
        })(),
        withArt: arts.filter(function (a) { return a.classList.contains('with-art'); }).length,
        missingArt: arts.filter(function (a) { return a.classList.contains('missing-art'); }).length,
        coverImgs: [].slice.call(root.querySelectorAll('img')).map(function (i) { return String(i.src || '').slice(0, 40); }).slice(0, 3)
      };
    })()`);
    console.log('\n[5] 面板卡片:', JSON.stringify(cards, null, 1));

    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      const f = path.join(OUT, 'live-panel.png');
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
      console.log('\n截图:', f);
    }

    // 5b) 切到「7 天」：日期窗口应变成 7 天前，按钮要 active
    await evalJs(ws, `(function(){
      var btn = document.querySelector('#folia-panel-summary [data-fp-range="7"]');
      if (btn) btn.click();
      return true;
    })()`);
    await delay(1600);
    const rangeSwitch = await evalJs(ws, `(function(){
      var d = document.getElementById('folia-panel-sum-dates');
      var t = document.getElementById('folia-panel-sum-total');
      var a = document.querySelector('#folia-panel-summary [data-fp-range="7"]');
      return {
        dates: d ? (d.innerText || '').replace(/\s+/g, ' ').trim() : '',
        total: t ? (t.innerText || '').replace(/\s+/g, ' ').trim() : '',
        active7: a ? a.classList.contains('active') : null
      };
    })()`);
    console.log('  [5b] 切到 7 天:', JSON.stringify(rangeSwitch));

    // 5c) AI 月度总结：点按钮 → 面板展开 → 看是否有结果或明确的未配置提示
    await evalJs(ws, `(function(){
      var btn = document.querySelector('#folia-panel [data-fp-ai]');
      if (btn) btn.click();
      return true;
    })()`);
    await delay(1800);
    const loadingProbe = await evalJs(ws, `(function(){
      var c = document.querySelector('#folia-panel-ai-body .fp-ai-dots');
      var info = null;
      if (c) {
        var painted = -1;
        try {
          var ctx = c.getContext('2d');
          var d = ctx.getImageData(0, 0, c.width, c.height).data;
          painted = 0;
          for (var i = 3; i < d.length; i += 4) if (d[i] > 8) painted++;
        } catch (e) { painted = -2; }
        info = { w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width), painted: painted };
      }
      var t = document.querySelector('#folia-panel-ai-body .fp-ai-loading-text');
      return { hasCanvas: !!c, canvas: info, text: t ? t.textContent : '' };
    })()`);
    console.log('  [5c-0] 点阵 loading:', JSON.stringify(loadingProbe));
    const shotLoading = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shotLoading && shotLoading.data) {
      const fp2 = path.join(OUT, 'live-ai-loading.png');
      fs.writeFileSync(fp2, Buffer.from(shotLoading.data, 'base64'));
      console.log('  loading 截图:', fp2);
    }
    await delay(26000);
    const aiProbe = await evalJs(ws, `(function(){
      var panel = document.getElementById('folia-panel-ai');
      var body = document.getElementById('folia-panel-ai-body');
      var box = document.querySelector('#folia-panel .fp-box');
      return {
        opened: !!panel && !panel.hidden,
        position: panel ? getComputedStyle(panel).position : '',
        coversBox: !!(panel && box && Math.abs(panel.getBoundingClientRect().height - box.getBoundingClientRect().height) < 4),
        name: (body && body.querySelector('.fp-ai-name')) ? (body.querySelector('.fp-ai-name').textContent || '').trim() : '',
        paragraphs: body ? body.querySelectorAll('p').length : 0,
        strongs: body ? body.querySelectorAll('strong').length : 0,
        text: body ? (body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 420) : '',
        isError: body ? body.classList.contains('is-error') : null
      };
    })()`);
    console.log('  [5c] AI 总结:', JSON.stringify(aiProbe));
    const shotAi = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shotAi && shotAi.data) {
      const fa = path.join(OUT, 'live-ai.png');
      fs.writeFileSync(fa, Buffer.from(shotAi.data, 'base64'));
      console.log('  AI 面板截图:', fa);
    }
    await evalJs(ws, `(function(){
      var btn = document.querySelector('#folia-panel [data-fp-ai-close]');
      if (btn) btn.click();
      return true;
    })()`);

    // 5d) 浅色主题：切 data-theme=light → 重开面板 → 外壳与模组都要跟着变
    await evalJs(ws, `(function(){
      document.documentElement.setAttribute('data-theme', 'light');
      window.closeFoliaPanel();
      return true;
    })()`);
    await delay(500);
    await evalJs(ws, `window.openFoliaHomeTab('archive')`);
    await delay(2200);
    const lightProbe = await evalJs(ws, `(function(){
      var box = document.querySelector('#folia-panel .fp-box');
      var root = document.querySelector('#folia-panel .archive-root');
      var sum = document.querySelector('#folia-panel .fp-summary');
      return {
        htmlTheme: document.documentElement.getAttribute('data-theme'),
        boxBg: box ? getComputedStyle(box).backgroundColor : '',
        sumBg: sum ? getComputedStyle(sum).backgroundColor : '',
        rootClass: root ? String(root.className) : '',
        isDaylight: root ? root.classList.contains('daylight') : null
      };
    })()`);
    console.log('  [5d] 浅色:', JSON.stringify(lightProbe));
    const shotLight = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shotLight && shotLight.data) {
      const fl = path.join(OUT, 'live-light.png');
      fs.writeFileSync(fl, Buffer.from(shotLight.data, 'base64'));
      console.log('  浅色截图:', fl);
    }
    // 10) 登录页在浅色/浅背景下的实际样式（用户报告白字看不清）
    await evalJs(ws, `(function(){
      document.documentElement.setAttribute('data-theme', 'light');
      try { window.closeFoliaPanel(); } catch (e) {}
      return true;
    })()`);
    await delay(500);
    /* 开屏有时会比首次 dismiss 晚出现，这里再收一次，否则截图拍到的全是开屏 */
    await evalJs(ws, `(function(){
      var s = document.getElementById('splash');
      if (s && getComputedStyle(s).display !== 'none') {
        if (typeof dismissSplash === 'function') dismissSplash(); else s.click();
      }
      return true;
    })()`);
    await delay(600);
    await evalJs(ws, `(function(){ if (typeof showLoginModal === 'function') showLoginModal(); return true; })()`);
    await delay(4200);
    const loginProbe = await evalJs(ws, `(function(){
      var mask = document.getElementById('login-modal');
      var dlg = mask && mask.querySelector('.dual-login-modal');
      var panel = document.getElementById('folia-panel');
      var ms = mask ? getComputedStyle(mask) : null;
      var ds = dlg ? getComputedStyle(dlg) : null;
      var ps = panel ? getComputedStyle(panel) : null;
      function colorOf(id) { var e = document.getElementById(id); return e ? getComputedStyle(e).color : ''; }
      return {
        maskZ: ms && ms.zIndex,
        maskBg: ms && ms.backgroundColor,
        maskOpacity: ms && ms.opacity,
        maskBackdrop: ms && String(ms.backdropFilter || '').slice(0, 40),
        dialogZ: ds && ds.zIndex,
        dialogBg: ds && ds.backgroundColor,
        dialogBackdrop: ds && String(ds.backdropFilter || '').slice(0, 40),
        maskDisplay: ms && ms.display,
        maskClass: mask ? String(mask.className) : '',
        parentChain: (function(){
          var chain = [];
          var el = mask ? mask.parentElement : null;
          var guard = 0;
          while (el && guard++ < 6) {
            var cs = getComputedStyle(el);
            chain.push((el.id || el.className || el.tagName) + ' z=' + cs.zIndex + ' pos=' + cs.position + ' tf=' + (cs.transform === 'none' ? '-' : 'yes'));
            el = el.parentElement;
          }
          return chain;
        })(),
        topAtCenter: (function(){
          var el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
          if (!el) return 'none';
          var path = [];
          var n = el, g = 0;
          while (n && g++ < 4) { path.push(n.id || n.className || n.tagName); n = n.parentElement; }
          return path.join(' < ');
        })(),
        panelZ: ps && ps.zIndex,
        panelOpacity: ps && ps.opacity,
        titleColor: colorOf('login-intro-title'),
        bodyColor: colorOf('login-intro-body'),
        providerB: (function(){ var e = document.querySelector('.login-platform-list button b'); return e ? getComputedStyle(e).color : ''; })(),
        providerState: (function(){ var e = document.querySelector('.login-platform-list button .login-provider-state'); return e ? getComputedStyle(e).color : ''; })(),
        providerStateOn: (function(){ var e = document.querySelector('.login-platform-list button .login-provider-state.on'); return e ? getComputedStyle(e).color : ''; })(),
        platformBg: (function(){ var e = document.querySelector('.login-platform-list'); return e ? getComputedStyle(e).backgroundColor : ''; })()
      };
    })()`);
    console.log('\n[10] 登录页样式:', JSON.stringify(loginProbe, null, 1));
    const shot10 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shot10 && shot10.data) {
      const f10 = path.join(OUT, 'live-login-light.png');
      fs.writeFileSync(f10, Buffer.from(shot10.data, 'base64'));
      console.log('  登录页截图:', f10);
    }
    await evalJs(ws, `(function(){
      if (typeof closeLoginModal === 'function') closeLoginModal();
      document.documentElement.removeAttribute('data-theme');
      window.closeFoliaPanel();
      return true;
    })()`);
    await delay(400);
    await evalJs(ws, `window.openFoliaHomeTab('archive')`);
    await delay(1500);
    await evalJs(ws, `(function(){
      var btn = document.querySelector('#folia-panel-summary [data-fp-range="all"]');
      if (btn) btn.click();
      return true;
    })()`);

    // 6) 真播一首：用历史记录还原成队列项（listeningTodaySongFromRecord 是项目自己的映射）
    const skipPlay = process.env.SKIP_PLAY === '1';
    if (skipPlay) {
      console.log('\n[6] 跳过播放（SKIP_PLAY=1）');
    } else {
    const playResult = await evalJs(ws, `(function(){
      var h = (typeof listenStatsState !== 'undefined' && listenStatsState.history) || [];
      if (!h.length) return { error: '历史为空' };
      var rec = h[0];
      var song = typeof listeningTodaySongFromRecord === 'function' ? listeningTodaySongFromRecord(rec) : null;
      if (!song) return { error: '无法还原歌曲对象' };
      window.playQueue = [song];
      window.currentIdx = 0;
      return Promise.resolve(playQueueAt(0, { manual: true }))
        .then(function () { return { ok: true, song: song.name, cover: String(song.cover || '').slice(0, 80) }; })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    })()`);
    console.log('\n[6] 真播:', JSON.stringify(playResult));

    // 6b) 封面字段随时间的变化：项目是「取址成功后才补 cover」，模组只在换歌瞬间捕获一次
    const coverOverTime = [];
    for (const wait of [400, 1500, 3000, 3000]) {
      await delay(wait);
      const s = await evalJs(ws, `(function(){
        var cs = typeof foliaPanelCurrentSong === 'function' ? foliaPanelCurrentSong() : null;
        var snap = typeof foliaPanelPlaybackSnapshot === 'function' ? foliaPanelPlaybackSnapshot() : null;
        var raw = cs ? String(cs.cover || '') : '';
        var proxied = '';
        try { proxied = raw && typeof coverProxySrc === 'function' ? coverProxySrc(raw) : ''; } catch (e) { proxied = 'ERR'; }
        return {
          t: Math.round(performance.now()),
          state: snap && snap.state,
          name: cs && cs.name,
          coverRaw: raw.slice(0, 70),
          coverProxied: String(proxied || '').slice(0, 90),
          mappedCover: snap && snap.song ? null : null
        };
      })()`);
      coverOverTime.push(s);
      console.log('   +' + wait + 'ms cover:', s && s.state, '|', s && s.coverRaw ? s.coverRaw.slice(0, 50) : '(空)');
    }
    const afterPlay = await evalJs(ws, `(function(){
      var snap = typeof foliaPanelPlaybackSnapshot === 'function' ? foliaPanelPlaybackSnapshot() : null;
      var cs = typeof foliaPanelCurrentSong === 'function' ? foliaPanelCurrentSong() : null;
      return {
        snapshot: snap ? { state: snap.state, song: snap.song, duration: snap.duration, position: snap.position } : null,
        rawSong: cs ? { name: cs.name, artist: cs.artist, cover: String(cs.cover || '').slice(0, 90), album: typeof cs.album === 'object' ? '[obj]' : cs.album, id: cs.id } : null,
        coverUrl: (function(){ try { var g = document.querySelector('#folia-panel'); return 'n/a'; } catch(e){ return 'n/a'; } })()
      };
    })()`);
    console.log('\n[7] 播放 6s 后的播放态:', JSON.stringify(afterPlay, null, 1).slice(0, 1200));

    // 7a) 宿主内部状态：图层挂没挂、事件有没有人听、pump 有没有在跑
    const inner = await evalJs(ws, `(function(){
      var s = window.foliaPanelHostState;
      if (!s) return null;
      var counts = {};
      Object.keys(s.listeners || {}).forEach(function (k) { counts[k] = (s.listeners[k] || []).length; });
      return {
        pumping: !!s.pumping,
        timers: (s.timers || []).length,
        last: s.last,
        listenerCounts: counts,
        layers: (s.layers || []).map(function (l) {
          return { id: l.id, hasHost: !!l.hostEl, connected: l.hostEl ? l.hostEl.isConnected : false, hasCleanup: typeof l.cleanup === 'function' };
        }),
        stageChildren: document.querySelectorAll('#folia-panel-stage .fp-stage-layer').length,
        stageExists: !!document.getElementById('folia-panel-stage'),
        tabs: Object.keys(s.tabs || {})
      };
    })()`);
    console.log('\n[7a] 宿主内部:', JSON.stringify(inner, null, 1));

    // 7a2) 强制触发一次 songChanged（把 last.key 打脏），看 artwork 会不会出现
    await evalJs(ws, `(function(){ window.foliaPanelHostState.last.key = '__diag_force__'; return true; })()`);
    await delay(2500);
    const forced = await evalJs(ws, `(function(){
      var cs = typeof foliaPanelCurrentSong === 'function' ? foliaPanelCurrentSong() : null;
      var key = '';
      try { key = cs && typeof queueItemKey === 'function' ? String(queueItemKey(cs)) : ''; } catch (e) {}
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.artworks', [[key]]).then(function (r) {
        var m = (r && r.value) || {};
        var hit = m[key];
        return { key: key.slice(0, 60), hasArt: !!(hit && hit.url), keys: Object.keys(m).length };
      }).catch(function (e) { return { error: String(e && e.message || e) }; });
    })()`);
    console.log('  [7a2] 强制触发后 artwork:', JSON.stringify(forced));

    // 7c) 模组内部看到的两个 song 与 URL：模拟它的 bg() 判据
    const bgProbe = await evalJs(ws, `(function(){
      var s = window.foliaPanelHostState;
      var layer = (s.layers || [])[0];
      var ctxSong = layer && layer.ctx ? layer.ctx.song : 'no-ctx';
      var ctxUrl = layer && layer.ctx ? layer.ctx.getCoverUrl() : 'no-ctx';
      var u = (typeof foliaPanelPlaybackSnapshot === 'function') ? foliaPanelPlaybackSnapshot().song : null;
      function norm(v) { return String(v == null ? '' : v).normalize('NFC').trim().replace(/\\s+/g, ' ').toLowerCase(); }
      function be(x) {
        if (!x) return null;
        var artists = String(x.artist || '').split(' / ').map(function (a) { return a.trim(); }).filter(Boolean).map(norm).sort();
        return JSON.stringify([norm(x.title), artists]);
      }
      return {
        ctxSong: ctxSong,
        ctxUrl: String(ctxUrl || '').slice(0, 100),
        playbackSong: u,
        beEqual: be(ctxSong) === be(u),
        beCtx: be(ctxSong),
        bePlayback: be(u),
        albumEqual: norm(ctxSong && ctxSong.album || '') === norm(u && u.album || ''),
        verdict: (!u ? 'no-u' : (!ctxSong ? 'no-ctx-song' : (!ctxUrl ? 'no-url' : (be(ctxSong) !== be(u) ? 'be-mismatch' : (norm(ctxSong.album || '') !== norm(u.album || '') ? 'album-mismatch' : 'would-capture')))))
      };
    })()`);
    console.log('\n[7c] 模组判据模拟:', JSON.stringify(bgProbe, null, 1));

    // 7b) 原地复现模组的封面处理（Image → decode → canvas → toDataURL），定位失败在哪一步
    const captureSim = await evalJs(ws, `(function(){
      var cs = typeof foliaPanelCurrentSong === 'function' ? foliaPanelCurrentSong() : null;
      if (!cs) return { error: '没在播' };
      var raw = String(cs.cover || '');
      var url = '';
      try { url = raw && typeof coverProxySrc === 'function' ? coverProxySrc(raw) : raw; } catch (e) { url = 'ERR'; }
      if (!url) return { error: 'coverProxySrc 返回空', raw: raw.slice(0, 60) };
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      return img.decode().then(function () {
        var c = document.createElement('canvas');
        var k = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/webp', 0.86);
        return { ok: true, natural: img.naturalWidth + 'x' + img.naturalHeight, outLen: data.length, head: data.slice(0, 30) };
      }).catch(function (e) {
        return { ok: false, decodeError: String(e && e.message || e), natural: img.naturalWidth, url: String(url).slice(0, 110) };
      });
    })()`);
    console.log('\n[7b] 复现模组封面处理:', JSON.stringify(captureSim));

    await delay(4000);
    const archive2 = await evalJs(ws, `(function(){
      var d = new Date(); d.setHours(0,0,0,0);
      return window.desktopWindow.foliaPanel.rpc('listening-archive', 'archive.query', [{ start: d.getTime(), end: d.getTime() + 86400000, period: 'day' }])
        .then(function (r) {
          var v = (r && r.value) || {};
          return { recordCount: v.recordCount, summary: v.summary, songsLen: (v.songs || []).length };
        });
    })()`);
    console.log('\n[8] 播放后档案:', JSON.stringify(archive2));

    const shot2 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    if (shot2 && shot2.data) {
      const f = path.join(OUT, 'live-after-play.png');
      fs.writeFileSync(f, Buffer.from(shot2.data, 'base64'));
      console.log('播放后截图:', f);
    }
    }   // 结束 if (!skipPlay)

    // 9) 账号入口：胶囊点开的是档案还是账号信息弹窗；面板底部还剩几个按钮
    const accountEntry = await evalJs(ws, `(function(){
      try { window.closeFoliaPanel(); } catch (e) {}
      var panel = document.getElementById('folia-panel');
      var footBtns = panel ? [].slice.call(panel.querySelectorAll('.fp-foot-btn')).map(function (b) { return (b.textContent || '').trim(); }) : null;
      var userBtn = document.getElementById('user-btn');
      if (userBtn) userBtn.click();
      var panelShown = !!(panel && panel.classList.contains('show'));
      var modal = document.getElementById('user-modal');
      var modalVisible = modal ? getComputedStyle(modal).display !== 'none' : null;
      var modalCs = modal ? getComputedStyle(modal) : null;
      return {
        footBtns: footBtns,
        panelShown: panelShown,
        modalDisplay: modalCs ? modalCs.display : null,
        modalVisible: modalVisible,
        loggedIn: typeof hasAnyPlatformLogin === 'function' ? !!hasAnyPlatformLogin() : null
      };
    })()`);
    console.log('\n[9] 账号入口:', JSON.stringify(accountEntry));

    // 9b) 设置页「账号与登录」应跳到音源页
    const settingsJump = await evalJs(ws, `(function(){
      try { window.closeFoliaPanel(); } catch (e) {}
      if (typeof openSettingsPage !== 'function') return { error: 'no openSettingsPage' };
      openSettingsPage('general');
      var row = document.querySelector('#settings-modal .st-link-row[onclick*="sources"]');
      if (!row) return { error: '没找到账号与登录行' };
      row.click();
      var active = document.querySelector('#settings-tabs .settings-tab.active');
      return { rowText: (row.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40), activeTab: active ? active.getAttribute('data-settings-tab') : null };
    })()`);
    console.log('  [9b] 设置页账号入口:', JSON.stringify(settingsJump));
    await evalJs(ws, `(function(){ var m = document.getElementById('settings-modal'); if (m && typeof closeSettingsPage === 'function') closeSettingsPage(); return true; })()`).catch(function () {});
  } catch (err) {
    console.error('诊断异常:', err && err.stack || err);
  } finally {
    try { if (child.pid) execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
    try { child.kill(); } catch (_) {}
    await delay(800);
  }
  process.exit(0);
})();
