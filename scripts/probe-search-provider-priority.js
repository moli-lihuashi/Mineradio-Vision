'use strict';
/**
 * 真 Electron 探针：搜索「以登录平台为优先」。
 *
 * 验证的是运行时行为，不是静态代码：
 *   1. 未登录：All 仍只查 网易云 + QQ，结果里没有酷狗行
 *   2. 登录酷狗：All 额外并入酷狗，酷狗行排最前，且不再提示「需会话/授权」
 *   3. 登录 QQ：All 以 QQ 为先
 *   4. 登录 Spotify：All 并入 SP
 *   5. 平台集合在搜索开始时快照进 searchPageState.providers
 *
 * 做法：stub 登录判定函数（hasPlatformLogin / firstLoggedProvider）+ stub apiJson 喂固定
 * 结果集，然后调真实 doSearch() 读真实 DOM 顺序。不碰用户真实档案：user-data-dir 放在
 * 项目内的 _debug-archive 下（C 盘禁用），结束即删。
 *
 * 用法：node scripts/probe-search-provider-priority.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9335;
const OUT_DIR = path.join(ROOT, '_debug-archive', '2026-11-26-search-priority');
const USER_DATA = path.join(OUT_DIR, 'userdata');

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

/* 页面内一次性注入：固定结果集 + 可切换的登录态 + 跑一次真实 doSearch */
const HARNESS = `
(function(){
  if (window.__searchPriorityProbe) return window.__searchPriorityProbe;
  var realHas = window.hasPlatformLogin;
  var realFirst = window.firstLoggedProvider;
  var realApi = window.apiJson;

  function song(provider, id, extra) {
    var base = { provider: provider, source: provider, type: provider, id: id, name: '晴天', artist: '周杰伦', album: '叶惠美', playable: false };
    if (extra) Object.keys(extra).forEach(function(k){ base[k] = extra[k]; });
    return base;
  }
  // 三个平台各给一首同题同歌手：排序差异只可能来自「优先平台上浮」
  var fixtures = {
    netease: [song('netease', 'ne-1'), song('netease', 'ne-2', { name: '晴天 (Live)', playable: true })],
    qq: [song('qq', 'qq-1')],
    kugou: [song('kugou', 'kg-1', { hash: 'kg-hash-1', albumAudioId: 'kg-aid-1' })],
    qishui: [song('qishui', 'qs-1')],
    spotify: [song('spotify', 'sp-1')]
  };

  function whichProvider(url) {
    var u = String(url || '');
    if (u.indexOf('/api/qq/search') === 0) return 'qq';
    if (u.indexOf('/api/kugou/search') === 0) return 'kugou';
    if (u.indexOf('/api/qishui/search') === 0) return 'qishui';
    if (u.indexOf('/api/spotify/search') === 0) return 'spotify';
    if (u.indexOf('/api/search') === 0) return 'netease';
    return '';
  }

  apiJson = function(url) {
    var provider = whichProvider(url);
    if (provider) {
      return Promise.resolve({
        provider: provider,
        songs: fixtures[provider].map(function(s){ return Object.assign({}, s); })
      });
    }
    return Promise.resolve({ ids: [], liked: [], data: [], songs: [] });
  };

  function setLogin(logged, active) {
    logged = logged || {};
    window.hasPlatformLogin = function(provider){ return !!logged[provider]; };
    window.firstLoggedProvider = function(){
      if (active && logged[active]) return active;
      var order = ['netease', 'qq', 'kugou', 'qishui', 'spotify'];
      for (var i = 0; i < order.length; i++) if (logged[order[i]]) return order[i];
      return 'netease';
    };
  }

  function readRows() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#search-results .search-result'));
    return rows.map(function(row){
      var tag = row.querySelector('.tag-source');
      var meta = row.querySelector('.search-result-meta');
      return {
        source: row.className.replace('search-result', '').replace(/-source/g, '').trim(),
        tag: tag ? String(tag.textContent || '').trim() : '',
        meta: meta ? String(meta.textContent || '').trim() : ''
      };
    });
  }

  window.__searchPriorityProbe = {
    fixtures: fixtures,
    makeSong: song,
    setFixtures: function(next){ fixtures = next; },
    setLogin: setLogin,
    restore: function(){
      window.hasPlatformLogin = realHas;
      window.firstLoggedProvider = realFirst;
      apiJson = realApi;
    },
    run: async function(logged, active, q) {
      setLogin(logged, active);
      var input = document.getElementById('search-input');
      var modeBefore = searchMode;
      searchMode = 'song';
      if (input) input.value = q;
      await doSearch(q, { autoPlayFirst: false });
      var out = {
        modeBefore: modeBefore,
        providers: (searchPageState && searchPageState.providers) || null,
        resultProviders: musicSearchProvidersForMode('song'),
        preferred: searchPreferredProvider(),
        rows: readRows(),
        allTabTitle: (document.getElementById('search-mode-song') || {}).title || '',
        stateQ: searchPageState && searchPageState.q
      };
      searchMode = modeBefore;
      clearSearchResults();
      return out;
    },
    /* 真 apiJson + 假登录：验证「登录平台请求失败/超时」不会拖死整个 All 搜索 */
    runReal: async function(logged, active, q) {
      window.__searchPriorityProbe.restore();
      setLogin(logged, active);
      var input = document.getElementById('search-input');
      searchMode = 'song';
      if (input) input.value = q;
      var t0 = performance.now();
      await doSearch(q, { autoPlayFirst: false });
      var elapsed = Math.round(performance.now() - t0);
      var footer = document.querySelector('#search-results .search-empty-text');
      var out = {
        elapsed: elapsed,
        providers: (searchPageState && searchPageState.providers) || null,
        failures: searchPageState ? searchPageState.failures.slice() : null,
        rows: readRows(),
        footer: footer ? String(footer.textContent || '').trim() : ''
      };
      clearSearchResults();
      return out;
    }
  };
  return window.__searchPriorityProbe;
})()
`;

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('缺少打包产物:', EXE);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  console.log('userData:', USER_DATA);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(EXE, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + USER_DATA,
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

    // 等主波模块全部就绪（模块未就绪时 doSearch 是 undefined，会得到假失败）
    const readyDeadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      ready = await evalJs(ws, 'typeof window.__mineradioCoreModulesReady !== "undefined" && window.__mineradioCoreModulesReady === true && typeof doSearch === "function"');
      if (ready) break;
      await delay(300);
    }
    check('主波模块就绪（doSearch 可调用）', !!ready);
    if (!ready) throw new Error('模块未就绪');

    const harnessOk = await evalJs(ws, HARNESS + ' && true');
    check('探针注入完成（固定结果集 + 登录态开关）', !!harnessOk);

    const dump = {};

    // 1) 未登录
    const anonymous = await evalJs(ws, '__searchPriorityProbe.run({}, "", "晴天")');
    dump.anonymous = anonymous;
    check('未登录：All 平台集 = 网易云 + QQ', JSON.stringify(anonymous.providers) === JSON.stringify(['netease', 'qq']),
      JSON.stringify(anonymous.providers));
    check('未登录：没有优先平台', anonymous.preferred === '', JSON.stringify(anonymous.preferred));
    check('未登录：结果里没有酷狗行', anonymous.rows.every(r => r.source !== 'kugou'),
      JSON.stringify(anonymous.rows.map(r => r.source)));
    console.log('    行序:', JSON.stringify(anonymous.rows.map(r => r.tag)));

    // 2) 登录酷狗
    const kugou = await evalJs(ws, '__searchPriorityProbe.run({kugou:true}, "kugou", "晴天")');
    dump.kugou = kugou;
    check('登录酷狗：All 平台集 = 网易云 + QQ + 酷狗', JSON.stringify(kugou.providers) === JSON.stringify(['netease', 'qq', 'kugou']),
      JSON.stringify(kugou.providers));
    check('登录酷狗：首选行是 KG（同一首歌在酷狗也有）', kugou.rows.length > 0 && kugou.rows[0].tag === 'KG',
      JSON.stringify(kugou.rows.map(r => r.tag)));
    check('登录酷狗：结果里确实有酷狗曲目', kugou.rows.some(r => r.source === 'kugou'));
    const kgRow = kugou.rows.find(r => r.source === 'kugou') || {};
    check('登录酷狗：不再提示「需会话/授权」', !/需会话|授权/.test(kgRow.meta || ''), kgRow.meta);
    const qqRow = kugou.rows.find(r => r.source === 'qq') || {};
    check('未登录的 QQ 仍保留「需会话/授权」提示', /需会话|授权/.test(qqRow.meta || ''), qqRow.meta);

    // 3) 登录 QQ
    const qq = await evalJs(ws, '__searchPriorityProbe.run({qq:true}, "qq", "晴天")');
    dump.qq = qq;
    check('登录 QQ：All 平台集 = 网易云 + QQ', JSON.stringify(qq.providers) === JSON.stringify(['netease', 'qq']),
      JSON.stringify(qq.providers));
    check('登录 QQ：首选行是 QQ', qq.rows.length > 0 && qq.rows[0].tag === 'QQ',
      JSON.stringify(qq.rows.map(r => r.tag)));

    // 4) 登录 Spotify
    const spotify = await evalJs(ws, '__searchPriorityProbe.run({spotify:true}, "spotify", "晴天")');
    dump.spotify = spotify;
    check('登录 Spotify：All 平台集并入 SP',
      JSON.stringify(spotify.providers) === JSON.stringify(['netease', 'qq', 'spotify']),
      JSON.stringify(spotify.providers));
    check('登录 Spotify：首选行是 SP（同一首歌 SP 也有）', spotify.rows.length > 0 && spotify.rows[0].tag === 'SP',
      JSON.stringify(spotify.rows.map(r => r.tag)));

    // 5) 相关度保护：优先平台前几条是同题翻唱时，不能把别家原唱整体压下去
    const coverGuard = await evalJs(ws, `(function(){
      var make = __searchPriorityProbe.makeSong;
      var saved = __searchPriorityProbe.fixtures;
      __searchPriorityProbe.setFixtures({
        netease: [make('netease', 'ne-jay', { name: '晴天', artist: '周杰伦', playable: true })],
        qq: [],
        kugou: [make('kugou', 'kg-cover', { name: '晴天', artist: '蓝心羽' }), make('kugou', 'kg-jay', { name: '晴天', artist: '周杰伦' })],
        qishui: [],
        spotify: []
      });
      return __searchPriorityProbe.run({kugou:true}, 'kugou', '晴天').then(function(out){
        __searchPriorityProbe.setFixtures(saved);
        return out;
      });
    })()`);
    dump.coverGuard = coverGuard;
    check('翻唱保护：优先平台的同题翻唱不得排在原唱之前',
      coverGuard.rows.length > 0 && /周杰伦/.test(coverGuard.rows[0].meta || '') && !/蓝心羽/.test(coverGuard.rows[0].meta || ''),
      JSON.stringify(coverGuard.rows.map(r => r.tag + '|' + r.meta)));
    check('翻唱保护：酷狗上的原唱版本被优先（同一首歌换本平台听）',
      coverGuard.rows[0].tag === 'KG' && /周杰伦/.test(coverGuard.rows[0].meta || ''),
      coverGuard.rows[0].tag + '|' + coverGuard.rows[0].meta);

    // 6) All 标签提示语随登录平台变化
    const titleAfterKugou = await evalJs(ws, `(function(){
      __searchPriorityProbe.setLogin({kugou:true}, 'kugou');
      updateSearchModeTabs();
      var t = (document.getElementById('search-mode-song') || {}).title || '';
      __searchPriorityProbe.setLogin({}, '');
      updateSearchModeTabs();
      return t;
    })()`);
    dump.allTabTitle = titleAfterKugou;
    check('All 标签提示语写明优先平台', /酷狗/.test(titleAfterKugou) && /优先/.test(titleAfterKugou), titleAfterKugou);

    // 6) 真网络 + 假登录酷狗：酷狗请求会失败/超时，但 All 搜索必须仍出网易云/QQ 结果且不卡死
    const realKugou = await evalJs(ws, '__searchPriorityProbe.runReal({kugou:true}, "kugou", "晴天")');
    dump.realKugou = realKugou;
    check('真网络：登录酷狗但酷狗不可用时，All 仍出结果', realKugou.rows.length > 0,
      'rows=' + realKugou.rows.length + ' elapsed=' + realKugou.elapsed + 'ms');
    check('真网络：酷狗失败被明确标注（不静默吞掉）',
      (realKugou.failures || []).indexOf('kugou') >= 0 || realKugou.rows.some(r => r.source === 'kugou'),
      JSON.stringify(realKugou.failures) + ' / footer=' + realKugou.footer);
    check('真网络：整轮搜索未被慢平台拖死（< 15s）', realKugou.elapsed < 15000, realKugou.elapsed + 'ms');

    await evalJs(ws, '__searchPriorityProbe.restore(); true');
    fs.writeFileSync(path.join(OUT_DIR, 'probe-result.json'), JSON.stringify(dump, null, 2));
    console.log('  证据:', path.join(OUT_DIR, 'probe-result.json'));

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
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(exitCode);
})();
