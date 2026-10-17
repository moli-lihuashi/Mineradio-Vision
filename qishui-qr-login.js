'use strict';

// Focused authentication bridge ported from
// Wx2yZx/Mineradio-Qishui-QR-Login revision
// aaadaab7d011714f94fbe45b382ba8dcc7cf17b9 (GPL-3.0-only).

const fs = require('fs');
const os = require('os');
const path = require('path');
const qishuiAuthV6 = require('./qishui-auth-v6');

// 凭据文件走 Electron safeStorage 加密（desktop/secret-store.js，DPAPI）。
// 非 electron 上下文（独立 node 跑 server）该模块降级为 null，此时：
// - 显式指定的 configFile（env/opt）：允许明文落盘（开发/自托管场景，调用方自负）
// - 默认项目根路径：拒绝明文落盘，仅内存持有，避免凭据混进仓库工作区
let secretStore = null;
try { secretStore = require('./desktop/secret-store'); } catch (_) { secretStore = null; }

// 显式探测 OS 加密可用性：非 electron 上下文下 safeStorage 为 undefined，
// secret-store 抛的是 TypeError 而非 ENCRYPTION_UNAVAILABLE，不能靠消息字符串判断。
function osEncryptionAvailable() {
  try {
    const electron = require('electron');
    const ss = electron && electron.safeStorage;
    return !!(ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable());
  } catch (_) { return false; }
}

// 默认路径优先取 electron userData；拿不到（非主进程/未打包）才回退项目根。
// 实际App内 desktop/main.js 会显式设置 QISHUI_QR_CONFIG_FILE 指向稳定 userData，此处仅兜底。
function resolveDefaultConfigFile() {
  try {
    const electronApp = require('electron').app;
    if (electronApp && typeof electronApp.getPath === 'function') {
      return path.join(electronApp.getPath('userData'), '.qishui-qr-login.json');
    }
  } catch (_) {}
  return path.join(__dirname, '.qishui-qr-login.json');
}
const DEFAULT_CONFIG_FILE = resolveDefaultConfigFile();

function defaultConfig() {
  return {
    deviceId: '',
    installId: '',
    verifyPortraitId: '',
    computerName: os.hostname() || 'Windows-PC',
    cookie: '',
    msToken: '',
    loggedInAt: 0,
  };
}

function readConfig(file) {
  try {
    if (!file || !fs.existsSync(file)) return defaultConfig();
    let text = '';
    if (secretStore) {
      // readSecretFile 同时兼容加密（MR 前缀）与历史明文文件
      text = secretStore.readSecretFile(file);
    }
    if (!text) text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(text);
    return { ...defaultConfig(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (error) {
    console.warn('[QishuiQrLogin] ignored invalid config:', error && error.message || error);
    return defaultConfig();
  }
}

// 启动时把历史明文凭据文件原地升级为加密格式（覆盖写，明文窗口当次即关）。
function migratePlaintextConfigFile(file) {
  try {
    if (!file || !secretStore || !osEncryptionAvailable() || !fs.existsSync(file)) return;
    const buf = fs.readFileSync(file);
    if (!buf.length) return;
    if (buf.length > 2 && buf[0] === 0x4d && buf[1] === 0x52) return; // 已是 MR 加密格式
    const cfg = readConfig(file);
    secretStore.writeSecretFile(file, JSON.stringify(cfg, null, 2));
    console.log('[QishuiQrLogin] plaintext credentials migrated to encrypted storage:', file);
  } catch (e) {
    console.warn('[QishuiQrLogin] credential migration skipped:', e && e.message || e);
  }
}

function writeConfig(file, value, allowPlaintextFallback) {
  if (!file) return;
  const text = JSON.stringify(value, null, 2);
  if (secretStore && osEncryptionAvailable()) {
    secretStore.writeSecretFile(file, text); // 加密写失败直接抛，不静默不兜底
    return;
  }
  if (secretStore && !allowPlaintextFallback) {
    // 系统加密不可用且未显式指定路径：不落盘，仅内存持有，避免明文凭据进仓库工作区
    console.warn('[QishuiQrLogin] OS encryption unavailable; credentials kept in memory only:', file);
    return;
  }
  if (secretStore) {
    console.warn('[QishuiQrLogin] OS encryption unavailable; writing plaintext to explicitly-set path:', file);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function hasLoginCookie(cookie) {
  return /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard|sid_tt)=[^;\s]+/i.test(String(cookie || ''));
}

// 上层用来判断「还能不能声称已登录」的上界。抖音系 cookie 本身不带 expires，
// 所以只能按登录时刻给一个保守上限：超期不再对外声称 loggedIn（cookie 仍会交给
// 上游验证 —— /api/qishui/status 走 handleQishuiStatus 拿真实结论）。
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function createQishuiQrLoginBridge(options) {
  options = options && typeof options === 'object' ? options : {};
  const auth = options.auth || qishuiAuthV6;
  const explicitConfigFile = !!(options.configFile || process.env.QISHUI_QR_CONFIG_FILE);
  const configFile = options.configFile || process.env.QISHUI_QR_CONFIG_FILE || DEFAULT_CONFIG_FILE;
  migratePlaintextConfigFile(configFile);
  let config = {
    ...readConfig(configFile),
    ...(options.initialConfig && typeof options.initialConfig === 'object' ? options.initialConfig : {}),
  };
  let qrGeneration = 0;
  let activeQrToken = '';
  let confirmedQrToken = '';
  let confirmedQrResult = null;
  let qrPending = false;

  function getConfig() {
    return { ...config };
  }

  function updateConfig(partial) {
    partial = partial && typeof partial === 'object' ? partial : {};
    const next = { ...config, ...partial };
    if (Object.prototype.hasOwnProperty.call(partial, 'cookie')) {
      const nextCookie = String(next.cookie || '').trim();
      const prevCookie = String(config.cookie || '').trim();
      if (!nextCookie) next.loggedInAt = 0;
      else if (nextCookie !== prevCookie) next.loggedInAt = Number(partial.loggedInAt) || Date.now();
    }
    config = next;
    writeConfig(configFile, config, explicitConfigFile);
    return getConfig();
  }

  auth.configure({ getConfig, updateConfig });

  async function createQrCode() {
    const generation = ++qrGeneration;
    activeQrToken = '';
    confirmedQrToken = '';
    confirmedQrResult = null;
    qrPending = true;
    const result = await auth.getQrCode();
    const data = result && result.data || {};
    if (!data.token || !data.qrcode) {
      const error = new Error('QISHUI_QR_PAYLOAD_INCOMPLETE');
      error.code = 'QISHUI_QR_PAYLOAD_INCOMPLETE';
      throw error;
    }
    if (generation !== qrGeneration) {
      const error = new Error('QISHUI_QR_REPLACED');
      error.code = 'QISHUI_QR_REPLACED';
      throw error;
    }
    activeQrToken = String(data.token);
    return result;
  }

  async function checkQrConnect(token) {
    token = String(token || '').trim();
    if (!token) {
      const error = new Error('QISHUI_QR_TOKEN_REQUIRED');
      error.code = 'QISHUI_QR_TOKEN_REQUIRED';
      throw error;
    }
    if (token !== activeQrToken) {
      return { message: 'error', data: { error_code: 2, status: 'expired', confirmed: false } };
    }
    if (confirmedQrToken === token && confirmedQrResult) return confirmedQrResult;
    const generation = qrGeneration;
    const result = await auth.checkQrConnect(token);
    const data = result && result.data || {};
    const confirmed = generation === qrGeneration && token === activeQrToken &&
      Number(data.error_code) === 0 &&
      (String(data.status) === '3' || String(data.status) === 'confirmed' || !!data.session_cookie) &&
      hasLoginCookie(config.cookie);
    if (confirmed) {
      confirmedQrToken = token;
      qrPending = false;
      confirmedQrResult = { ...result, data: { ...data, confirmed: true } };
      return confirmedQrResult;
    }
    return { ...result, data: { ...data, confirmed } };
  }

  function getCookie() {
    return String(config.cookie || '').trim();
  }

  function sessionAgeMs() {
    const at = Number(config.loggedInAt || 0) || 0;
    return at > 0 ? Math.max(0, Date.now() - at) : 0;
  }
  // 没有记录登录时刻的历史配置不做凭空判死（at=0 → 未知，保持原有行为）
  function sessionExpired() {
    const age = sessionAgeMs();
    return age > MAX_SESSION_AGE_MS;
  }

  function getStatus() {
    const cookie = getCookie();
    const cookieReady = hasLoginCookie(cookie);
    const expired = cookieReady && sessionExpired();
    return {
      provider: 'qishui',
      loggedIn: !qrPending && cookieReady && !expired,
      cookieReady,
      sessionExpired: expired,
      sessionAgeDays: Math.floor(sessionAgeMs() / (24 * 60 * 60 * 1000)),
      qrPending,
      qrConfirmed: !!activeQrToken && confirmedQrToken === activeQrToken,
      deviceId: String(config.deviceId || ''),
      msTokenReady: !!config.msToken,
      configFile,
    };
  }

  async function clear() {
    qrGeneration += 1;
    activeQrToken = '';
    confirmedQrToken = '';
    confirmedQrResult = null;
    qrPending = false;
    await auth.clear();
    updateConfig({ cookie: '', msToken: '' });
    return getStatus();
  }

  return {
    createQrCode,
    checkQrConnect,
    getCookie,
    getStatus,
    clear,
    _test: { getConfig, updateConfig, configFile },
  };
}

const bridge = createQishuiQrLoginBridge();

module.exports = Object.assign(bridge, {
  createQishuiQrLoginBridge,
  hasLoginCookie,
});
