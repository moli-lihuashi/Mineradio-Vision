const { fs, path, appRoot, rel, fail, logStep, walk, forbiddenPattern, vm } = require('./helpers');

function loadLoaderSplit() {
  const publicDir = path.join(appRoot, 'public');
  const loaderPath = path.join(publicDir, 'js', 'index-loader.js');
  const loader = fs.readFileSync(loaderPath, 'utf8');
  const coreStart = loader.indexOf('const modulePaths');
  if (coreStart < 0) fail('modulePaths not found in public/js/index-loader.js');
  const deferredStart = loader.indexOf('const deferredModulePaths');
  const coreSrc = deferredStart > coreStart ? loader.slice(coreStart, deferredStart) : loader.slice(coreStart);
  const modulePaths = [...coreSrc.matchAll(/'(js\/modules\/[^']+)'/g)].map(m => m[1]);
  if (!modulePaths.length) fail('modulePaths parsed empty');
  let deferredPaths = [];
  if (deferredStart >= 0) {
    const deferredSrc = loader.slice(deferredStart, loader.indexOf('];', deferredStart) + 2);
    deferredPaths = [...deferredSrc.matchAll(/'(js\/modules\/[^']+)'/g)].map(m => m[1]);
    if (!deferredPaths.length) fail('deferredModulePaths parsed empty');
    const overlap = deferredPaths.filter(p => modulePaths.includes(p));
    if (overlap.length) fail('deferred modules overlap core modulePaths: ' + overlap.join(', '));
  }
  return { publicDir, modulePaths, deferredPaths };
}

function readModuleText(publicDir, modulePath) {
  return fs.readFileSync(path.join(publicDir, modulePath), 'utf8');
}

function stripComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 仅顶层（列 0）声明：var/let/const/function/async function */
function extractTopLevelDecls(source) {
  const text = stripComments(source);
  const names = new Set();
  // 顶层：行首无缩进
  const varRe = /(?:^|\n)(?:var|let|const)\s+([^;\n]+)/g;
  let m;
  while ((m = varRe.exec(text))) {
    for (const part of m[1].split(',')) {
      const id = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (id) names.add(id[1]);
    }
  }
  const fnRe = /(?:^|\n)(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g;
  while ((m = fnRe.exec(text))) {
    if (m[1]) names.add(m[1]);
  }
  return names;
}

/** 核心 combined 里对 name 的裸引用（排除 typeof / window.x / 字符串 / 注释 / 属性名） */
function hasBareReference(source, name) {
  const text = stripComments(source);
  // 文件内已有 typeof name 守卫则视为安全（典型：if (typeof fn === 'function') fn()）
  if (new RegExp('typeof\\s+' + name.replace(/\$/g, '\\$') + '\\b').test(text)) return false;
  const escaped = name.replace(/\$/g, '\\$');
  const re = new RegExp('\\b' + escaped + '\\b', 'g');
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + name.length;
    if (start >= 7 && text.slice(start - 7, start) === 'window.') continue;
    if (start >= 6) {
      const lead = text.slice(Math.max(0, start - 8), start);
      if (/(^|[^\w$])typeof\s+$/.test(lead)) continue;
    }
    const q = text.slice(Math.max(0, start - 1), start);
    if (q === '"' || q === "'" || q === '`') continue;
    const prevNonWs = text.slice(0, start).replace(/\s+$/, '');
    if (prevNonWs.endsWith('.')) continue;
    if (/^\s*:/.test(text.slice(end))) continue;
    return true;
  }
  return false;
}

function parseCombinedIndexModules() {
  logStep('Combined index module parse');
  const { publicDir, modulePaths, deferredPaths } = loadLoaderSplit();
  const combined = modulePaths
    .map(modulePath => readModuleText(publicDir, modulePath))
    .join('\n');
  new Function(combined);
  console.log(`[OK] Combined classic script parses. Modules: ${modulePaths.length}.`);
  if (deferredPaths.length) {
    const deferredCombined = deferredPaths
      .map(modulePath => readModuleText(publicDir, modulePath))
      .join('\n');
    new Function(deferredCombined);
    console.log(`[OK] Deferred classic script parses. Modules: ${deferredPaths.length}.`);
  }
}

/**
 * 白屏回归：延迟波独有顶层声明被主波急切引用 → 合并脚本求值 ReferenceError → splash 卡死。
 * 允许：typeof 守卫、window.x、主波 stub 同名声明。
 */
function checkDeferredEagerDependencyGuard() {
  logStep('Deferred eager-dependency guard (white-screen)');
  const { publicDir, modulePaths, deferredPaths } = loadLoaderSplit();
  if (!deferredPaths.length) {
    console.log('[OK] No deferred wave; skip eager-dependency scan.');
    return;
  }

  const coreSources = modulePaths.map(p => ({ path: p, text: readModuleText(publicDir, p) }));
  const deferredSources = deferredPaths.map(p => ({ path: p, text: readModuleText(publicDir, p) }));
  const coreCombined = coreSources.map(s => s.text).join('\n');
  const coreDecls = extractTopLevelDecls(coreCombined);
  const deferredDecls = new Set();
  for (const s of deferredSources) {
    for (const n of extractTopLevelDecls(s.text)) deferredDecls.add(n);
  }

  // 只在延迟波声明、主波没有 stub/声明的名字
  const deferredOnly = [...deferredDecls].filter(n => !coreDecls.has(n));
  // 白屏高危：登录态 / 面板 API / 主循环每帧 API；过短与泛词丢弃
  const INTERESTING = /Login|Status|WasLoggedIn|Busy|Timer|Cookie|Provider|Queue|Playlist|UpdatePanel|HomeAudio|FxInputs|setRange|Prismal|ParticleFire|ShaderMarket|Spotify|Qishui|Kugou|Netease|loadScript|logout|Logout|refreshQr|stopQr|updateLogin|normalizeQishui|normalizeSpotify/i;
  const skipShort = new Set(['e', 'i', 'j', 'k', 'n', 'm', 'p', 'q', 's', 't', 'x', 'y', 'id', 'fn', 'ok', 'el', 'ev', 'st', 'to', 'at', 'by', 'or', 'if', 'do', 'in', 'of', 'on', 'up', 'it', 'as', 'is', 'no', 'be', 'Array', 'Object', 'Math', 'JSON', 'Date', 'Error', 'Promise', 'Map', 'Set', 'Symbol', 'block', 'shader', 'pair', 'cookie', 'button', 'pill', 'perf', 'desktop', 'boot', 'restore', 'lyrics', 'event', 'error', 'value', 'index', 'count', 'total', 'state', 'options', 'config', 'result', 'payload']);

  const bootHotPaths = coreSources.filter(s =>
    /^js\/modules\/00-state\//.test(s.path) ||
    /^js\/modules\/10-shell\//.test(s.path) ||
    s.path.endsWith('/11-main-loop.js') ||
    s.path.endsWith('/07-fx/00-panel-lazy-stubs.js') ||
    s.path.endsWith('/07-fx/07-bindings-shelf-immersive.js') ||
    s.path.endsWith('/08-account/01-login-modal-utils.js') ||
    s.path.endsWith('/08-account/02-login-status.js')
  );

  const violations = [];
  for (const name of deferredOnly) {
    if (name.length < 5 || skipShort.has(name)) continue;
    if (!INTERESTING.test(name)) continue;
    if (/^(webkit|moz|MS)/.test(name)) continue;
    for (const hot of bootHotPaths) {
      if (hasBareReference(hot.text, name)) {
        violations.push({ name, file: hot.path });
      }
    }
  }

  if (violations.length) {
    const lines = violations.map(v => `  ${v.name}  ←  ${v.file}`);
    fail(
      'Deferred-only symbols are eagerly referenced from core boot path (white-screen risk).\n' +
      'Declare state in 00-state (core) + keep implementation in deferred, or use typeof guards / stubs.\n' +
      lines.join('\n')
    );
  }
  console.log(`[OK] No eager refs to deferred-only boot-critical symbols from hot core files (${deferredOnly.length} deferred-only decls scanned).`);
}

/** 主波求值冒烟：仅当 ReferenceError 指向延迟波独有符号时判白屏失败 */
function smokeCoreEvalNoReferenceError() {
  logStep('Core combined eval smoke (deferred-only ReferenceError = white-screen)');
  const { publicDir, modulePaths, deferredPaths } = loadLoaderSplit();
  const combined = modulePaths.map(p => readModuleText(publicDir, p)).join('\n');

  const coreDecls = extractTopLevelDecls(combined);
  const deferredDecls = new Set();
  for (const p of deferredPaths) {
    for (const n of extractTopLevelDecls(readModuleText(publicDir, p))) deferredDecls.add(n);
  }
  const deferredOnly = new Set([...deferredDecls].filter(n => !coreDecls.has(n)));

  const classListStub = () => ({
    add() {}, remove() {}, toggle() {}, contains() { return false; },
    item() { return ''; }, replace() {}, value: '',
  });
  const elStub = () => ({
    style: { setProperty() {}, removeProperty() {}, set cssText(v) {}, get cssText() { return ''; } },
    classList: classListStub(),
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild() {}, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return elStub(); }, querySelectorAll() { return []; },
    closest() { return elStub(); }, contains() { return false; },
    focus() {}, blur() {}, click() {},
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    dataset: {}, children: [], childNodes: [], parentNode: null,
    innerHTML: '', textContent: '', value: '', id: '', width: 0, height: 0,
  });

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    // 不真正调度，避免 node 进程被 timer 挂住
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    setInterval: function () { return 0; },
    clearInterval: function () {},
    requestAnimationFrame: function () { return 0; },
    cancelAnimationFrame: function () {},
    requestIdleCallback: function () { return 0; },
    cancelIdleCallback: function () {},
    performance: { now: () => Date.now() },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Error, TypeError, ReferenceError,
    Promise, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] == null ? null : this._d[k]; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
      clear() { this._d = {}; },
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} },
    location: { search: '', href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', pathname: '/', hash: '' },
    navigator: { userAgent: 'MineradioSmoke/1.0', language: 'zh-CN', platform: 'Win32', hardwareConcurrency: 4 },
    document: {
      readyState: 'complete', hidden: false, visibilityState: 'visible',
      documentElement: {
        getAttribute() { return '3.2.31'; }, setAttribute() {},
        classList: classListStub(), style: { setProperty() {}, removeProperty() {} }, appendChild() {},
      },
      body: { classList: classListStub(), style: {}, appendChild() {}, addEventListener() {} },
      head: { appendChild() {}, insertBefore() {} },
      getElementById() { return elStub(); },
      querySelector() { return elStub(); },
      querySelectorAll() { return []; },
      createElement() { return elStub(); },
      createTextNode(t) { return { textContent: t }; },
      addEventListener() {}, removeEventListener() {},
      createEvent() { return { initEvent() {} }; },
      currentScript: null,
    },
    fetch: async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }),
    XMLHttpRequest: function () {
      this.open = function () {}; this.send = function () {}; this.setRequestHeader = function () {};
      this.status = 0; this.responseText = '';
    },
    Image: function () { this.src = ''; this.onload = null; this.onerror = null; },
    Audio: function () { return elStub(); },
    AudioContext: function () { throw new Error('no AudioContext'); },
    webkitAudioContext: function () { throw new Error('no webkitAudioContext'); },
    Worker: function () { throw new Error('no Worker'); },
    ResizeObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    IntersectionObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0,
    addEventListener() {}, removeEventListener() {}, postMessage() {},
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function (type) { this.type = type; },
  };
  function makeThreeNode() {
    const target = function () { return makeThreeNode(); };
    return new Proxy(target, {
      get(t, prop) {
        if (prop === 'then' || prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined;
        if (!(prop in t)) t[prop] = makeThreeNode();
        return t[prop];
      },
      set(t, prop, v) { t[prop] = v; return true; },
      apply() { return makeThreeNode(); },
      construct() { return makeThreeNode(); },
      has() { return true; },
    });
  }
  sandbox.THREE = makeThreeNode();
  sandbox.gsap = {
    to() {}, from() {}, fromTo() {}, set() {},
    timeline: () => ({ to() {}, from() {}, kill() {} }),
    registerPlugin() {}, killTweensOf() {},
  };
  const noop = function () {};
  sandbox.Mineradio = {
    auth: { configure: noop, getToken: () => '', on: noop, off: noop },
    api: { get: async () => ({}), post: async () => ({}) },
    desktop: null,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.location = sandbox.location;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.performance = sandbox.performance;
  sandbox.window.Mineradio = sandbox.Mineradio;
  sandbox.window.THREE = sandbox.THREE;
  sandbox.window.gsap = sandbox.gsap;

  const context = vm.createContext(sandbox);
  try {
    vm.runInContext(combined, context, { filename: 'mineradio-core-combined.js', timeout: 8000 });
    console.log('[OK] Core combined eval completed without throw.');
  } catch (err) {
    const msg = String((err && err.message) || err);
    const idm = msg.match(/([A-Za-z_$][\w$]*)\s+is not defined/);
    if (idm && deferredOnly.has(idm[1])) {
      fail(
        'White-screen class: core eval ReferenceError on deferred-only symbol "' + idm[1] + '".\n' +
        '  Move the declaration into 00-state (core) or add a stub / typeof guard.\n' +
        '  ' + String(err && err.stack || err).split('\n').slice(0, 3).join('\n  ')
      );
    }
    if (err instanceof ReferenceError || /ReferenceError/.test(String(err && err.stack || err))) {
      console.log('[WARN] Core eval ReferenceError on non-deferred symbol (env/sandbox): ' + msg);
    } else {
      console.log('[WARN] Core eval threw (env/sandbox, ignored): ' + msg.split('\n')[0]);
    }
  }

  // 主波求值后关键符号必须存在（用 typeof 读沙箱）
  const requiredAfterCore = [
    'qishuiLoginStatus', 'updateFxInputs', 'setRange', 'updateHomeAudioVisual', 'scheduleFxPanelDomBind',
  ];
  const missing = [];
  for (const name of requiredAfterCore) {
    let t = 'missing';
    try { t = vm.runInContext(`typeof ${name}`, context); } catch (_) { t = 'missing'; }
    if (t === 'undefined' || t === 'missing') missing.push(name);
  }
  if (missing.length) {
    fail('Core eval finished but required boot symbols are missing: ' + missing.join(', '));
  }
  console.log('[OK] Boot symbols present after core eval: ' + requiredAfterCore.join(', '));

  if (deferredPaths.length) {
    const deferredCombined = deferredPaths.map(p => readModuleText(publicDir, p)).join('\n');
    try {
      vm.runInContext(deferredCombined, context, { filename: 'mineradio-deferred-combined.js', timeout: 8000 });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const idm = msg.match(/([A-Za-z_$][\w$]*)\s+is not defined/);
      if (idm && deferredOnly.has(idm[1])) {
        fail('Deferred eval ReferenceError on deferred-only symbol "' + idm[1] + '"');
      }
      console.log('[WARN] Deferred eval threw (env/sandbox, ignored): ' + msg.split('\n')[0]);
    }
    let ready = false;
    try { ready = !!vm.runInContext('typeof window !== "undefined" && window.__fxPanelDomModulesReady', context); } catch (_) {}
    if (!ready) fail('After deferred eval, window.__fxPanelDomModulesReady is not true');
    console.log('[OK] Deferred eval done; __fxPanelDomModulesReady=true.');
  }
}

function scanForbiddenMarkers() {
  logStep('Forbidden FSR/DLSS/native FG scan');
  const scanTargets = [
    path.join(appRoot, 'public', 'js'),
    path.join(appRoot, 'desktop'),
    path.join(appRoot, 'server.js'),
    path.join(appRoot, 'dj-analyzer.js'),
    path.join(appRoot, 'cuefield')
  ];
  const files = [];
  for (const target of scanTargets) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      walk(target).forEach(file => {
        if (/\.(js|json|html|css)$/i.test(file)) files.push(file);
      });
    } else {
      files.push(target);
    }
  }

  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (forbiddenPattern.test(text)) hits.push(rel(file));
  }
  if (hits.length) fail(`Forbidden markers found:\n${hits.join('\n')}`);
  console.log(`[OK] No FSR/DLSS/native FG markers in ${files.length} scanned files.`);
}

module.exports = {
  parseCombinedIndexModules,
  scanForbiddenMarkers,
  checkDeferredEagerDependencyGuard,
  smokeCoreEvalNoReferenceError,
};
