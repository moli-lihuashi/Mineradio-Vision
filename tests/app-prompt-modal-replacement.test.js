'use strict';

// =============================================================================
// 应用内异步输入弹窗（替代 Electron 不支持的 window.prompt）
// 桌面实测（Electron 44.9，项目自带 dist）：window.prompt 会抛
//   Error: prompt() is not supported.
// 因此这五个入口必须改用 openAppPromptModal / promptPasswordWithConfirm，
// 并且取消时不得执行后续操作、不得产生未处理异常。
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const promptPath = path.join(appRoot, 'public', 'js', 'modules', '00-state', '15-app-prompt.js');
const accountPath = path.join(appRoot, 'public', 'js', 'modules', '08-account', '04-user-modal-logout.js');
const qrSyncPath = path.join(appRoot, 'public', 'js', 'modules', '08-account', '08-login-pack-qr-sync.js');
const weatherPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '03-home-discover-weather.js');
const loaderPath = path.join(appRoot, 'public', 'js', 'index-loader.js');

// --- 轻量 DOM：只实现这段代码实际用到的 API --------------------------------
function createFakeDom() {
  const registry = new Map();
  const docListeners = {};
  function makeElement(id) {
    const listeners = {};
    const classes = new Set();
    const el = {
      id: id || '',
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, force) { if (force === undefined) { classes.has(name) ? classes.delete(name) : classes.add(name); } else if (force) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      style: {},
      dataset: {},
      hidden: false,
      textContent: '',
      value: '',
      type: 'text',
      maxLength: 200,
      placeholder: '',
      offsetWidth: 0,
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(value) {
        this._html = String(value);
        // 模拟真实 DOM：内联子元素按 id 可被 getElementById 取到
        const re = /id="([^"]+)"/g;
        let match;
        while ((match = re.exec(this._html))) {
          if (!registry.has(match[1])) registry.set(match[1], makeElement(match[1]));
        }
      },
      appendChild(child) { if (child && child.id) registry.set(child.id, child); },
      setAttribute() {},
      removeAttribute() {},
      focus() { this.focused = true; },
      select() { this.selected = true; },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
      dispatch(type, event) { (listeners[type] || []).slice().forEach(fn => fn(event || { target: el })); },
      click() { this.dispatch('click', { target: this }); },
      querySelector() { return null; },
      contains() { return false; },
    };
    return el;
  }
  const document = {
    body: {
      appendChild(el) { if (el && el.id) registry.set(el.id, el); },
      classList: { contains() { return false; } },
      contains(el) { return !!el && registry.get(el.id) === el; },
    },
    getElementById(id) { return registry.get(id) || null; },
    createElement() { return makeElement(''); },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(item => item !== fn); },
    fire(type, event) { (docListeners[type] || []).slice().forEach(fn => fn(event)); },
  };
  return document;
}

function createPromptSandbox() {
  const toasts = [];
  const document = createFakeDom();
  const sandbox = {
    console,
    Promise,
    String,
    Number,
    Object,
    Array,
    JSON,
    setTimeout(fn) { fn(); return 0; },
    clearTimeout() {},
    document,
    toasts,
    showToast(message) { toasts.push(String(message)); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(promptPath, 'utf8'), sandbox, { filename: promptPath });
  return { sandbox, document, toasts };
}

async function flush(times) {
  const rounds = times || 6;
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// 未结束的 Promise 绝不能算通过：所有异步断言统一套超时
function withTimeout(promise, label, ms) {
  const limit = ms || 2000;
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error('TIMEOUT(' + limit + 'ms): ' + (label || 'promise') + ' 未结束'));
    }, limit);
    Promise.resolve(promise).then(
      function (value) { clearTimeout(timer); resolve(value); },
      function (error) { clearTimeout(timer); reject(error); }
    );
  });
}

function track(promise) {
  const box = { settled: false, value: undefined, promise: null };
  box.promise = promise.then(value => { box.settled = true; box.value = value; });
  return box;
}

// --- 基本输入 / 取消 -------------------------------------------------------
async function testCancelResolvesNull() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.openAppPromptModal({ title: '修改天气城市', value: '上海' }));
  await flush();

  const mask = document.getElementById('app-prompt-modal');
  assert(mask, '弹窗必须挂到 body 上');
  assert.strictEqual(mask.classList.contains('show'), true, '弹窗必须显示');
  assert.strictEqual(document.getElementById('app-prompt-input').type, 'text');

  document.getElementById('app-prompt-cancel').click();
  await box.promise;

  assert.strictEqual(box.value, null, '取消必须返回 null');
  assert.strictEqual(mask.classList.contains('show'), false, '取消必须关闭弹窗');
}

async function testEscapeCancels() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.openAppPromptModal({ title: 'x' }));
  await flush();

  document.fire('keydown', { key: 'Escape', preventDefault() {} });
  await box.promise;
  assert.strictEqual(box.value, null);
}

async function testSubmitReturnsValue() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.openAppPromptModal({ title: '修改天气城市', maxLength: 32 }));
  await flush();

  const input = document.getElementById('app-prompt-input');
  assert.strictEqual(input.maxLength, 32, 'maxLength 必须生效');
  input.value = '成都';
  document.getElementById('app-prompt-ok').click();
  await box.promise;

  assert.strictEqual(box.value, '成都');
  assert.strictEqual(document.getElementById('app-prompt-modal').classList.contains('show'), false);
}

async function testEmptyValueIsBlockedNotSilentlyAccepted() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.openAppPromptModal({ title: '修改天气城市' }));
  await flush();

  document.getElementById('app-prompt-input').value = '   ';
  document.getElementById('app-prompt-ok').click();
  await flush();

  assert.strictEqual(box.settled, false, '空值不应关闭弹窗');
  const error = document.getElementById('app-prompt-error');
  assert.strictEqual(error.hidden, false);
  assert(/不能为空/.test(error.textContent));

  document.getElementById('app-prompt-input').value = '上海';
  document.getElementById('app-prompt-ok').click();
  await box.promise;
  assert.strictEqual(box.value, '上海');
}

async function testAllowEmptyAndValidate() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.openAppPromptModal({ title: 'x', allowEmpty: true }));
  await flush();
  document.getElementById('app-prompt-ok').click();
  await box.promise;
  assert.strictEqual(box.value, '', 'allowEmpty 时允许空串');

  const validating = track(sandbox.openAppPromptModal({
    title: 'y',
    validate(value) { return /^http/.test(value) ? '' : '链接格式不正确'; },
  }));
  await flush();
  const input = document.getElementById('app-prompt-input');
  input.value = 'ftp://bad';
  document.getElementById('app-prompt-ok').click();
  await flush();
  assert.strictEqual(validating.settled, false);
  assert(/链接格式不正确/.test(document.getElementById('app-prompt-error').textContent));

  input.value = 'http://192.168.1.2:8080/pack';
  document.getElementById('app-prompt-ok').click();
  await validating.promise;
  assert.strictEqual(validating.value, 'http://192.168.1.2:8080/pack');
}

// --- 口令输入 --------------------------------------------------------------
async function testPasswordInputIsMasked() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.openAppPromptModal({ title: '输入口令', inputType: 'password' }));
  await flush();

  const input = document.getElementById('app-prompt-input');
  assert.strictEqual(input.type, 'password', '口令必须使用密码输入框');

  input.value = ' pass word ';
  document.getElementById('app-prompt-ok').click();
  await box.promise;
  assert.strictEqual(box.value, ' pass word ', '口令不能被 trim 改写');
}

async function testPasswordConfirmMismatchCancels() {
  const { sandbox, document, toasts } = createPromptSandbox();
  const box = track(sandbox.promptPasswordWithConfirm({ title: '设置导出口令' }));
  await flush();

  const input = document.getElementById('app-prompt-input');
  assert.strictEqual(input.type, 'password');
  input.value = 'abc123';
  document.getElementById('app-prompt-ok').click();
  await flush();

  // 第二次输入：仍复用同一个输入框，但已清空并再次要求输入
  assert.strictEqual(sandbox.appPromptState !== null, true, '第二次输入必须仍在等待');
  document.getElementById('app-prompt-input').value = 'abc124';
  document.getElementById('app-prompt-ok').click();
  await box.promise;

  assert.strictEqual(box.value, null, '两次口令不一致必须放弃');
  assert(toasts.some(text => /两次口令不一致/.test(text)));
}

async function testPasswordConfirmMatchReturnsPassword() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.promptPasswordWithConfirm({ title: '设置口令' }));
  await flush();

  document.getElementById('app-prompt-input').value = 'same-pass';
  document.getElementById('app-prompt-ok').click();
  await flush();
  document.getElementById('app-prompt-input').value = 'same-pass';
  document.getElementById('app-prompt-ok').click();
  await box.promise;

  assert.strictEqual(box.value, 'same-pass');
}

async function testPasswordConfirmCancelSecondStep() {
  const { sandbox, document } = createPromptSandbox();
  const box = track(sandbox.promptPasswordWithConfirm({ title: '设置口令' }));
  await flush();

  document.getElementById('app-prompt-input').value = 'first';
  document.getElementById('app-prompt-ok').click();
  await flush();
  document.getElementById('app-prompt-cancel').click();
  await box.promise;

  assert.strictEqual(box.value, null, '第二次取消必须整体放弃');
}

async function testReentrancyResolvesPreviousAsCancel() {
  const { sandbox } = createPromptSandbox();
  const first = track(sandbox.openAppPromptModal({ title: 'first' }));
  await flush();
  const second = track(sandbox.openAppPromptModal({ title: 'second' }));
  await flush();

  await withTimeout(first.promise, 'first (superseded)');
  assert.strictEqual(first.value, null, '被顶台的弹窗必须按取消收掉');
  assert.strictEqual(second.settled, false);
}

// --- 重入后第二个 Promise 必须真的结束（旧实现会永久悬挂） -----------------
async function openPromptPair(sandbox, firstOptions, secondOptions) {
  const first = track(sandbox.openAppPromptModal(firstOptions));
  await flush();
  const firstInstance = sandbox.appPromptState;
  const second = track(sandbox.openAppPromptModal(secondOptions));
  await flush();
  return { first, second, firstInstance };
}

async function testReentrancySecondSubmitResolves() {
  const { sandbox, document } = createPromptSandbox();
  const { first, second } = await openPromptPair(sandbox, { title: '第一个' }, { title: '第二个' });

  document.getElementById('app-prompt-input').value = '新城市';
  document.getElementById('app-prompt-ok').click();

  await withTimeout(second.promise, 'second prompt submit');
  await withTimeout(first.promise, 'first prompt superseded');

  assert.strictEqual(second.value, '新城市', '第二个弹窗提交必须结束并返回输入值');
  assert.strictEqual(first.value, null);
  assert.strictEqual(sandbox.appPromptState, null, '结束后不应残留实例状态');
  assert.strictEqual(document.getElementById('app-prompt-modal').classList.contains('show'), false, '提交后必须关闭弹窗');
}

async function testReentrancySecondCancelResolves() {
  const { sandbox, document } = createPromptSandbox();
  const { first, second } = await openPromptPair(sandbox, { title: '第一个' }, { title: '第二个' });

  document.getElementById('app-prompt-cancel').click();

  await withTimeout(second.promise, 'second prompt cancel');
  await withTimeout(first.promise, 'first prompt superseded');

  assert.strictEqual(second.value, null);
  assert.strictEqual(first.value, null);
  assert.strictEqual(sandbox.appPromptState, null);
}

async function testReentrancySecondEscapeResolves() {
  const { sandbox, document } = createPromptSandbox();
  const { first, second } = await openPromptPair(sandbox, { title: '第一个' }, { title: '第二个' });

  document.fire('keydown', { key: 'Escape', preventDefault() {} });

  await withTimeout(second.promise, 'second prompt escape');
  await withTimeout(first.promise, 'first prompt superseded');

  assert.strictEqual(second.value, null);
  assert.strictEqual(first.value, null);
  assert.strictEqual(sandbox.appPromptState, null);
}

async function testReentrancyCrossTextThenPassword() {
  const { sandbox, document } = createPromptSandbox();
  const { first, second } = await openPromptPair(
    sandbox,
    { title: '城市', inputType: 'text' },
    { title: '口令', inputType: 'password' }
  );

  const input = document.getElementById('app-prompt-input');
  assert.strictEqual(input.type, 'password', '第二个实例必须接管输入框类型');
  input.value = ' pw ';
  document.getElementById('app-prompt-ok').click();

  await withTimeout(second.promise, 'second password prompt');
  await withTimeout(first.promise, 'first text prompt superseded');

  assert.strictEqual(second.value, ' pw ', '密码框的值不能被 trim 改写');
  assert.strictEqual(first.value, null);
}

async function testReentrancyCrossPasswordThenText() {
  const { sandbox, document } = createPromptSandbox();
  const { first, second } = await openPromptPair(
    sandbox,
    { title: '口令', inputType: 'password' },
    { title: '城市', inputType: 'text' }
  );

  const input = document.getElementById('app-prompt-input');
  assert.strictEqual(input.type, 'text', '第二个实例必须把输入框切回 text');
  input.value = '成都';
  document.getElementById('app-prompt-ok').click();

  await withTimeout(second.promise, 'second text prompt');
  await withTimeout(first.promise, 'first password prompt superseded');

  assert.strictEqual(second.value, '成都');
  assert.strictEqual(first.value, null);
}

async function testReentrancyCleansUpOldInstance() {
  const { sandbox } = createPromptSandbox();
  const { firstInstance } = await openPromptPair(sandbox, { title: '第一个' }, { title: '第二个' });

  assert(firstInstance, '重入前应当有实例对象');
  assert.strictEqual(firstInstance.settled, true, '旧实例必须标记结束');
  assert.strictEqual(firstInstance.cleanup, null, '旧实例的监听必须已移除');
  assert.strictEqual(firstInstance.focusTimer, 0, '旧实例的定时任务必须已清理');
  assert.notStrictEqual(sandbox.appPromptState, firstInstance, '旧实例不得再占用全局状态');
}

async function testReentrancyOldCallbackCannotAffectNew() {
  const { sandbox, document } = createPromptSandbox();
  const { first, second } = await openPromptPair(sandbox, { title: '第一个' }, { title: '第二个' });
  await withTimeout(first.promise, 'first prompt superseded');

  // 旧监听若还在，会先于新实例处理这次点击并清空全局状态 → 新 Promise 悬挂
  document.getElementById('app-prompt-input').value = '第二次结果';
  document.getElementById('app-prompt-ok').click();

  await withTimeout(second.promise, 'second prompt after stale listener');
  assert.strictEqual(second.value, '第二次结果');

  // 收尾后再点一次不应抛错、也不应产生新的结算
  document.getElementById('app-prompt-ok').click();
  document.getElementById('app-prompt-cancel').click();
  assert.strictEqual(sandbox.appPromptState, null);
}

// --- 入口接线：五个入口都不得再碰 window.prompt -----------------------------
function createAccountSandbox() {
  const document = createFakeDom();
  const toasts = [];
  const apiCalls = [];
  const api = {
    exportLoginSessionPack(params) { apiCalls.push({ name: 'exportLoginSessionPack', params }); return Promise.resolve({ ok: true, providers: ['netease'] }); },
    importLoginSessionPack(params) { apiCalls.push({ name: 'importLoginSessionPack', params }); return Promise.resolve({ ok: true, providers: ['netease'] }); },
    startLoginPackQrSync(params) { apiCalls.push({ name: 'startLoginPackQrSync', params }); return Promise.resolve({ ok: true, url: 'http://192.168.1.2:9000/pack', qrDataUrl: '', ttlMs: 180000 }); },
    importLoginPackFromQrUrl(params) { apiCalls.push({ name: 'importLoginPackFromQrUrl', params }); return Promise.resolve({ ok: true, providers: ['netease'] }); },
  };
  const sandbox = {
    console,
    Promise,
    String,
    Number,
    Object,
    Array,
    JSON,
    Date,
    Math,
    isFinite,
    setTimeout() { return 0; },
    clearTimeout() {},
    document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    toasts,
    apiCalls,
    showToast(message) { toasts.push(String(message)); },
    escHtml(value) { return String(value || ''); },
    refreshLoginStatus() { return Promise.resolve(); },
    refreshQQLoginStatus() { return Promise.resolve(); },
    refreshKugouLoginStatus() { return Promise.resolve(); },
    refreshQishuiLoginStatus() { return Promise.resolve(); },
    refreshSpotifyLoginStatus() { return Promise.resolve(); },
    refreshUserPlaylists() {},
    updateUserModalUi() {},
    closeGsapModal(mask) { if (mask) mask.classList.remove('show'); },
  };
  sandbox.window = sandbox;
  sandbox.desktopWindow = api;
  return { sandbox, document, toasts, apiCalls, api, context: null };
}

function runAccountFiles(sandbox) {
  const context = vm.createContext(sandbox);
  [accountPath, qrSyncPath].forEach(file => {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });
  return context;
}

async function testExportPackCancelDoesNothing() {
  const { sandbox, apiCalls } = createAccountSandbox();
  runAccountFiles(sandbox);
  sandbox.promptPasswordWithConfirm = async function () { return null; };

  const result = await sandbox.exportActiveLoginSessionPack();

  assert.strictEqual(result, undefined);
  assert.deepStrictEqual(apiCalls, [], '取消口令后不得导出登录包');
}

async function testExportPackUsesPassword() {
  const { sandbox, apiCalls } = createAccountSandbox();
  runAccountFiles(sandbox);
  sandbox.promptPasswordWithConfirm = async function (options) {
    assert(/口令/.test(String(options && options.title)), '口令弹窗必须有标题');
    return 'secret-pass';
  };

  await sandbox.exportActiveLoginSessionPack();

  assert.strictEqual(apiCalls.length, 1);
  assert.strictEqual(apiCalls[0].name, 'exportLoginSessionPack');
  assert.strictEqual(apiCalls[0].params.password, 'secret-pass');
}

async function testImportPackCancelDoesNothing() {
  const { sandbox, apiCalls } = createAccountSandbox();
  runAccountFiles(sandbox);
  sandbox.promptPasswordOnce = async function () { return null; };

  await sandbox.importLoginSessionPack();
  assert.deepStrictEqual(apiCalls, [], '取消口令后不得导入登录包');
}

async function testQrSyncCancelDoesNothing() {
  const { sandbox, apiCalls } = createAccountSandbox();
  runAccountFiles(sandbox);
  sandbox.promptPasswordWithConfirm = async function () { return null; };

  await sandbox.exportLoginSessionPackQr();
  assert.deepStrictEqual(apiCalls, [], '取消口令后不得开启二维码同步');
}

async function testQrSyncSuccessOpensModal() {
  const { sandbox, apiCalls, document } = createAccountSandbox();
  runAccountFiles(sandbox);
  sandbox.promptPasswordWithConfirm = async function () { return 'sync-pass'; };

  await sandbox.exportLoginSessionPackQr();

  assert.strictEqual(apiCalls.length, 1);
  assert.strictEqual(apiCalls[0].params.password, 'sync-pass');
  const modal = document.getElementById('login-pack-qr-modal');
  assert(modal, '成功后必须打开二维码弹窗');
  assert.strictEqual(modal.classList.contains('show'), true);
}

async function testLinkImportCancelDoesNothing() {
  const { sandbox, apiCalls } = createAccountSandbox();
  runAccountFiles(sandbox);
  sandbox.openAppPromptModal = async function () { return null; };
  sandbox.promptPasswordOnce = async function () { return 'never-used'; };

  await sandbox.importLoginSessionPackFromQr();

  assert.deepStrictEqual(apiCalls, [], '取消链接输入后不得导入');
}

async function testLinkImportSuccess() {
  const { sandbox, apiCalls } = createAccountSandbox();
  runAccountFiles(sandbox);
  const prompts = [];
  sandbox.openAppPromptModal = async function (options) { prompts.push(options); return 'http://192.168.1.9:9000/login-pack'; };
  sandbox.promptPasswordOnce = async function (options) {
    prompts.push(options);
    return 'sync-pass';
  };

  await sandbox.importLoginSessionPackFromQr();

  assert.strictEqual(prompts.length, 2, '链接导入需要链接 + 口令两次输入');
  assert.strictEqual(apiCalls.length, 1);
  assert.strictEqual(apiCalls[0].name, 'importLoginPackFromQrUrl');
  assert.strictEqual(apiCalls[0].params.url, 'http://192.168.1.9:9000/login-pack');
  assert.strictEqual(apiCalls[0].params.password, 'sync-pass');
}

// --- 天气城市入口 ----------------------------------------------------------
function createWeatherSandbox() {
  const document = createFakeDom();
  const toasts = [];
  const loads = [];
  const storage = new Map();
  const sandbox = {
    console,
    Promise,
    String,
    Number,
    Object,
    Array,
    JSON,
    Date,
    Math,
    isFinite,
    setTimeout() { return 0; },
    clearTimeout() {},
    document,
    toasts,
    loads,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    HOME_WEATHER_CITY_KEY: 'mineradio-home-weather-city',
    homeWeatherRadioState: { city: '上海', loaded: true, loading: false, error: '' },
    markManualWeatherCity() { sandbox.manualCityMarked = true; },
    loadHomeWeatherRadio(force, opts) { loads.push({ force, opts }); return Promise.resolve(); },
    showToast(message) { toasts.push(String(message)); },
    renderHomeDiscover() {},
    queueItemKey(song) { return (song && song.id) || ''; },
  };
  sandbox.window = sandbox;
  return { sandbox, document, loads, toasts };
}

function runWeatherFile(sandbox) {
  const context = vm.createContext(sandbox);
  const loadSpy = sandbox.loadHomeWeatherRadio;
  vm.runInContext(fs.readFileSync(weatherPath, 'utf8'), context, { filename: weatherPath });
  // 模块自身也声明了 loadHomeWeatherRadio（完整取天气链路），这里换回可观测的桩
  sandbox.loadHomeWeatherRadio = loadSpy;
  sandbox.homeWeatherToken = 0;
  return context;
}

async function testWeatherCityCancelDoesNothing() {
  const { sandbox, loads } = createWeatherSandbox();
  runWeatherFile(sandbox);
  sandbox.openAppPromptModal = async function () { return null; };

  await sandbox.changeWeatherCity();

  assert.strictEqual(sandbox.homeWeatherRadioState.city, '上海', '取消后城市不变');
  assert.strictEqual(sandbox.homeWeatherRadioState.loaded, true);
  assert.deepStrictEqual(loads, [], '取消后不得触发天气加载');
}

async function testWeatherCityEmptyInputDoesNothing() {
  const { sandbox, loads } = createWeatherSandbox();
  runWeatherFile(sandbox);
  sandbox.openAppPromptModal = async function () { return '   '; };

  await sandbox.changeWeatherCity();

  assert.strictEqual(sandbox.homeWeatherRadioState.city, '上海');
  assert.deepStrictEqual(loads, []);
}

async function testWeatherCityAppliesInput() {
  const { sandbox, loads } = createWeatherSandbox();
  runWeatherFile(sandbox);
  const prompts = [];
  sandbox.openAppPromptModal = async function (options) { prompts.push(options); return ' 成都 '; };

  const event = { defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  await sandbox.changeWeatherCity(event);

  assert.strictEqual(event.defaultPrevented, true, '必须保留原有点击拦截行为');
  assert.strictEqual(prompts.length, 1);
  assert(/城市/.test(String(prompts[0].title)));
  assert.strictEqual(sandbox.homeWeatherRadioState.city, '成都', '城市名必须 trim 后生效');
  assert.strictEqual(sandbox.homeWeatherRadioState.loaded, false);
  assert.strictEqual(sandbox.localStorage.getItem('mineradio-home-weather-city'), '成都');
  assert.strictEqual(JSON.stringify(loads), JSON.stringify([{ force: true, opts: { city: '成都' } }]));
}

async function testWeatherPromptThrowIsHandled() {
  const { sandbox, loads } = createWeatherSandbox();
  runWeatherFile(sandbox);
  sandbox.openAppPromptModal = async function () { throw new Error('boom'); };

  await sandbox.changeWeatherCity();

  assert.strictEqual(sandbox.homeWeatherRadioState.city, '上海');
  assert.deepStrictEqual(loads, [], '输入异常不得触发加载');
}

// --- 静态接线 --------------------------------------------------------------
function testNoNativePromptLeft() {
  [weatherPath, accountPath, qrSyncPath].forEach(file => {
    const text = fs.readFileSync(file, 'utf8');
    assert(!/window\.prompt\s*\(/.test(text), path.basename(file) + ' 不得再调用 window.prompt');
  });
  const promptText = fs.readFileSync(promptPath, 'utf8');
  assert(/inputType === 'password' \? 'password' : 'text'/.test(promptText), '口令必须渲染成密码框');
  const loaderText = fs.readFileSync(loaderPath, 'utf8');
  assert(/js\/modules\/00-state\/15-app-prompt\.js/.test(loaderText), '新模块必须被 index-loader 加载');
}

async function run() {
  await testCancelResolvesNull();
  await testEscapeCancels();
  await testSubmitReturnsValue();
  await testEmptyValueIsBlockedNotSilentlyAccepted();
  await testAllowEmptyAndValidate();
  await testPasswordInputIsMasked();
  await testPasswordConfirmMismatchCancels();
  await testPasswordConfirmMatchReturnsPassword();
  await testPasswordConfirmCancelSecondStep();
  await testReentrancyResolvesPreviousAsCancel();
  await testReentrancySecondSubmitResolves();
  await testReentrancySecondCancelResolves();
  await testReentrancySecondEscapeResolves();
  await testReentrancyCrossTextThenPassword();
  await testReentrancyCrossPasswordThenText();
  await testReentrancyCleansUpOldInstance();
  await testReentrancyOldCallbackCannotAffectNew();
  await testExportPackCancelDoesNothing();
  await testExportPackUsesPassword();
  await testImportPackCancelDoesNothing();
  await testQrSyncCancelDoesNothing();
  await testQrSyncSuccessOpensModal();
  await testLinkImportCancelDoesNothing();
  await testLinkImportSuccess();
  await testWeatherCityCancelDoesNothing();
  await testWeatherCityEmptyInputDoesNothing();
  await testWeatherCityAppliesInput();
  await testWeatherPromptThrowIsHandled();
  testNoNativePromptLeft();
  console.log('OK app-prompt-modal-replacement');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
