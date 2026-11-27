'use strict';
/**
 * 真 Electron 探针：Folia「隐喻」样式接入验证。
 *
 * 验证链路（全部运行时取值，不是静态检查）：
 *   1. 样式注册进注册表（id=metaphor，名字=隐喻），面板清单里排得到
 *   2. 世界能切到它：实例 __def.id === 'metaphor'，没有 failReason
 *   3. 画布真的在画：尺寸非 0，逐个 cue 步进后 lastTime 跟着走
 *   4. 排版/分镜真的产出了东西：cue 表有歌词 cue、glyphs 数量、实例化图形数 > 0
 *   5. 截图落盘（人工看真实渲染：墨、网点、线稿、字）
 *
 * 歌词与播放时间都是注入的（本机没有正在播放的歌）：直接改 lyricsLines + 覆盖
 * foliaWorldPlaybackTime()，再手动调 foliaWorldTick() 步进，不碰用户存档。
 *
 * 用法：node scripts/probe-folia-metaphor.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'Mineradio', 'Mineradio.exe');
const PORT = 9337;
const OUT_DIR = path.join(ROOT, '_debug-archive', '2026-11-27-metaphor');
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
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ' → ' + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    /* 任何一条 CDP 命令都不许无声挂住：截图/求值卡住时要报错，不是把探针冻在这里 */
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error(method + ' 超时（30s）'));
    }, 30000);
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

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  — ' + detail : ''));
}

/* 假歌词：覆盖中日韩长句、英文短句、标点行（间奏占位）。每个词带自己的起止时间。 */
const HARNESS = `
(function(){
  if (window.__metaphorProbe) return window.__metaphorProbe;
  function words(text, from, to, size) {
    var chars = Array.from(text);
    var out = [];
    var step = (to - from) / Math.max(1, Math.ceil(chars.length / size));
    for (var i = 0; i < chars.length; i += size) {
      var index = i / size;
      out.push({ text: chars.slice(i, i + size).join(''), startTime: from + step * index, endTime: from + step * (index + 1) });
    }
    return out;
  }
  var spec = [
    ['墨在纸上缓缓散开', 0.0, 13],
    ['融球与字同一张场', 4.0, 14],
    ['the ink does not drip', 8.0, 10],
    ['它只对撞然后碎成星屑', 12.5, 14],
    ['镜头在唱到的词上硬切', 17.0, 15],
    ['paper ink halftone grain', 21.0, 10],
    ['最后一句留给留白', 25.5, 14],
    ['end', 30.0, 16]
  ];
  var injected = spec.map(function (row, index) {
    var next = spec[index + 1];
    return {
      startTime: row[1],
      endTime: next ? next[1] - 0.4 : row[1] + 4,
      fullText: row[0],
      translation: '',
      duration: 4,
      words: words(row[0], row[1], (next ? next[1] - 0.4 : row[1] + 4) - 0.05, 2)
    };
  });

  window.__metaphorProbeTime = 0;
  foliaWorldPlaybackTime = function () { return window.__metaphorProbeTime; };

  function step(seconds) {
    window.__metaphorProbeTime = seconds;
    var inst = foliaWorld.instance;
    if (!inst) return { error: 'no-instance' };
    try {
      foliaWorldTick(performance.now(), 16);
    } catch (err) {
      return { error: String(err && err.message || err), stack: String(err && err.stack || '').slice(0, 400) };
    }
    var set = inst.shown;
    var cueIndex = inst.current;
    var cue = inst.program && inst.program.cues[cueIndex];
    return {
      time: seconds,
      cueIndex: cueIndex,
      cueCount: inst.program ? inst.program.cues.length : 0,
      lineIndex: cue ? cue.lineIndex : null,
      composition: cue ? cue.composition : '',
      transition: cue ? cue.transition : '',
      lastTime: inst.lastTime,
      glyphs: set && set.layout ? set.layout.glyphs.length : 0,
      words: set && set.layout ? set.layout.words.length : 0,
      shapes: set && set.shapes ? set.shapes.length : 0,
      instanceCount: inst.shapeGeometry ? inst.shapeGeometry.instanceCount : 0,
      hasMesh: !!(set && set.mesh),
      canvas: inst.renderer ? [inst.renderer.domElement.width, inst.renderer.domElement.height] : null,
      failReason: foliaWorld.failReason || ''
    };
  }

  /* 同一任务里先 tick 再 readPixels：WebGL 的绘图缓冲在合成后会被清掉，
   * 分两条 CDP 命令拿不到画面，所以取帧必须和渲染在同一个任务里完成。 */
  function readFrame(seconds, width) {
    window.__metaphorProbeTime = seconds;
    var inst = foliaWorld.instance;
    if (!inst) return null;
    foliaWorldTick(performance.now(), 16);
    var gl = inst.renderer.getContext();
    var w = gl.drawingBufferWidth;
    var h = gl.drawingBufferHeight;
    var px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var stride = 4 * 97;
    var sum = 0, nonBlank = 0, min = 255, max = 0, samples = 0;
    var buckets = {};
    for (var i = 0; i < px.length; i += stride) {
      var lum = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
      sum += lum; samples += 1;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      if (lum > 8) nonBlank += 1;
      buckets[(px[i] >> 5) + ',' + (px[i + 1] >> 5) + ',' + (px[i + 2] >> 5)] = 1;
    }
    var scale = Math.min(1, (width || 900) / w);
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var full = document.createElement('canvas');
    full.width = w; full.height = h;
    var fullCtx = full.getContext('2d');
    var img = fullCtx.createImageData(w, h);
    for (var y = 0; y < h; y += 1) {
      var src = (h - 1 - y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    fullCtx.putImageData(img, 0, 0);
    var out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(full, 0, 0, cw, ch);
    return {
      time: seconds, width: cw, height: ch,
      mean: Math.round(sum / Math.max(1, samples)),
      min: Math.round(min), max: Math.round(max),
      nonBlankRatio: Math.round((nonBlank / Math.max(1, samples)) * 1000) / 1000,
      colors: Object.keys(buckets).length,
      dataUrl: out.toDataURL('image/png')
    };
  }

  window.__metaphorProbe = {
    install: function () {
      lyricsLines = injected;
      if (typeof foliaWorldLineCache !== 'undefined' && foliaWorldLineCache) foliaWorldLineCache.ref = null;
      if (typeof foliaWorldLines === 'function') foliaWorldLines();
      return injected.length;
    },
    step: step,
    capture: readFrame,
    state: function () {
      var inst = foliaWorld.instance;
      return {
        active: foliaWorld.active,
        mode: foliaWorld.mode,
        instanceId: inst && inst.__def ? inst.__def.id : '',
        failReason: foliaWorld.failReason || '',
        hasCanvas: !!(inst && inst.renderer && inst.renderer.domElement),
        contextLost: !!(inst && inst.renderer && inst.renderer.getContext().isContextLost())
      };
    }
  };
  return window.__metaphorProbe;
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
  ], { cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    if (!page) throw new Error('主窗口未导航到本地服务');

    const ws = await wsConnect(page.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable');
    await send(ws, 'Page.enable');
    await send(ws, 'Page.bringToFront');

    const pageErrors = [];
    ws.addEventListener('message', ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        pageErrors.push('exception: ' + ((d && d.exception && d.exception.description) || (d && d.text) || '?'));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (/metaphor|隐喻|Folia/i.test(text)) pageErrors.push('console: ' + text.slice(0, 300));
      }
    });

    const readyDeadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      ready = await evalJs(ws, 'typeof window.__mineradioCoreModulesReady !== "undefined" && window.__mineradioCoreModulesReady === true && typeof foliaWorldEnter === "function"');
      if (ready) break;
      await delay(300);
    }
    check('主波模块就绪', !!ready);
    if (!ready) throw new Error('模块未就绪');

    /* 等延迟波（folia 样式本体）落地 */
    const modeDeadline = Date.now() + 60000;
    let modeInfo = null;
    while (Date.now() < modeDeadline) {
      modeInfo = await evalJs(ws, `(function(){
        if (typeof getFoliaMode !== 'function' || typeof listFoliaModes !== 'function') return null;
        var mode = getFoliaMode('metaphor');
        if (!mode) return null;
        return {
          id: mode.id,
          name: mode.name,
          desc: mode.desc,
          needsWebGL2: mode.needsWebGL2,
          order: mode.order,
          total: listFoliaModes().length,
          ids: listFoliaModes().map(function (item) { return item.id; })
        };
      })()`);
      if (modeInfo) break;
      await delay(400);
    }
    check('隐喻样式已注册（id=metaphor）', !!modeInfo, modeInfo ? modeInfo.name + ' / order=' + modeInfo.order : '未找到');
    check('样式清单里查得到隐喻', !!(modeInfo && modeInfo.ids.indexOf('metaphor') >= 0), modeInfo ? ('共 ' + modeInfo.total + ' 个样式') : '');
    check('声明需要 WebGL2', !!(modeInfo && modeInfo.needsWebGL2 === true));

    /* 关掉开屏，进入世界 */
    await evalJs(ws, `(function(){ var s = document.getElementById('splash'); if (s) s.click(); return true; })()`);
    const splashDeadline = Date.now() + 20000;
    while (Date.now() < splashDeadline) {
      const gone = await evalJs(ws, `(function(){ var s = document.getElementById('splash'); if (!s) return true; var cs = getComputedStyle(s); return cs.display === 'none' || cs.visibility === 'hidden'; })()`);
      if (gone) break;
      await delay(300);
    }

    const injected = await evalJs(ws, HARNESS + ' && window.__metaphorProbe.install()');
    check('注入假歌词 + 覆盖播放时间', injected === 8, 'lines=' + injected);

    const entered = await evalJs(ws, `(function(){
      if (!foliaWorld.active) foliaWorldEnter({ silent: true });
      if (!foliaWorld.active) return { ok: false, fail: foliaWorld.failReason || '' };
      foliaWorldSetMode('metaphor');
      return { ok: true, mode: foliaWorld.mode, fail: foliaWorld.failReason || '' };
    })()`);
    check('世界已切到隐喻', !!(entered && entered.ok && entered.mode === 'metaphor'), JSON.stringify(entered));

    await delay(600);
    const st = await evalJs(ws, '__metaphorProbe.state()');
    check('实例存活（无 failReason / 上下文未丢）',
      !!(st && st.instanceId === 'metaphor' && !st.failReason && !st.contextLost),
      JSON.stringify(st));

    /* 只影响截图：把首页/顶栏/底栏藏起来，免得挡住样式本体（不改任何业务状态） */
    await evalJs(ws, `(function(){
      var style = document.createElement('style');
      style.id = 'metaphor-probe-hide-ui';
      style.textContent = '#empty-home,#search-area,#hint,#top-right,#bottom-bar,#left-shelf,.bottom-bar{visibility:hidden !important}';
      document.head.appendChild(style);
      return true;
    })()`);

    const samples = [1.2, 5.6, 9.4, 14.2, 18.6, 23.2, 27.4, 31.6];
    const rows = [];
    for (const seconds of samples) {
      const row = await evalJs(ws, '__metaphorProbe.step(' + seconds + ')');
      rows.push(row);
      await delay(120);
    }

    /* 取三帧真画面：同一任务里渲染 + readPixels，落 PNG 供人工看（不是合成器截图） */
    const shots = [];
    for (const seconds of [5.6, 18.6, 27.4]) {
      const frame = await evalJs(ws, '__metaphorProbe.capture(' + seconds + ', 1000)');
      if (frame && frame.dataUrl) {
        const file = path.join(OUT_DIR, 'metaphor-' + String(seconds).replace('.', '_') + '.png');
        fs.writeFileSync(file, Buffer.from(String(frame.dataUrl).split(',')[1], 'base64'));
        shots.push({ time: seconds, mean: frame.mean, min: frame.min, max: frame.max, nonBlankRatio: frame.nonBlankRatio, colors: frame.colors, file: path.basename(file) });
        console.log('  截图:', file, 'mean=' + frame.mean, 'colors=' + frame.colors, 'nonBlank=' + frame.nonBlankRatio);
      } else {
        shots.push({ time: seconds, error: 'no-frame' });
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'probe-result.json'), JSON.stringify({ modeInfo, state: st, rows, shots, pageErrors }, null, 2));

    const errors = rows.filter(r => r && r.error);
    check('逐 cue 步进没有抛错', errors.length === 0, errors.map(e => e.time + ':' + e.error).join(' | '));
    check('cue 表覆盖全曲（>= 8 段）', !!(rows[0] && rows[0].cueCount >= 8), rows[0] ? String(rows[0].cueCount) : '');
    check('每个采样点都真的渲染了那一帧', rows.every(r => r && !r.error && Math.abs(r.lastTime - r.time) < 1e-6),
      rows.map(r => r.lastTime).join(','));
    const lyricRows = rows.filter(r => r && r.lineIndex >= 0);
    check('歌词 cue 有字（glyphs > 0）', lyricRows.length > 0 && lyricRows.every(r => r.glyphs > 0),
      lyricRows.map(r => r.lineIndex + ':' + r.glyphs).join(' '));
    check('图形实例数 > 0（融球/线稿/网点真的在画）', rows.every(r => r.instanceCount > 0),
      rows.map(r => r.instanceCount).join(','));
    check('构图有变化（不是一句话一种排法）', new Set(rows.map(r => r.composition)).size >= 3,
      rows.map(r => r.composition).join(','));
    check('画布尺寸非 0', !!(rows[0] && rows[0].canvas && rows[0].canvas[0] > 100 && rows[0].canvas[1] > 100), JSON.stringify(rows[0] && rows[0].canvas));
    check('页面无相关异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    check('三帧画面都取到了', shots.length === 3 && shots.every(s => !s.error), JSON.stringify(shots.map(s => s.time)));
    check('画面不是空白（亮度均值 > 8 / 颜色桶 >= 8）', shots.every(s => !s.error && s.mean > 8 && s.colors >= 8),
      shots.map(s => s.mean + '/' + s.colors).join(' '));
    check('墨与纸都有（亮的和暗的都在，不是整屏一色）', shots.every(s => !s.error && s.max - s.min > 40),
      shots.map(s => s.min + '~' + s.max).join(' '));

    const failed = checks.filter(c => !c.ok);
    console.log('\n' + (failed.length ? 'FAILED ' + failed.length + '/' + checks.length : 'ALL CHECKS PASSED (' + checks.length + ')'));
    if (failed.length) exitCode = 1;
  } catch (err) {
    console.error('探针异常:', err && err.stack || err);
    exitCode = 1;
  } finally {
    try {
      if (child.pid) require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' });
    } catch (_) {}
    try { child.kill(); } catch (_) {}
    await delay(600);
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(exitCode);
})();
