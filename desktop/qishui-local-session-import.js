const { session } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  discoverQishuiClientDataRoots,
  discoverQishuiCookieStores,
  qishuiDiscoveryErrorCode,
} = require('./qishui-local-session-discovery');
const { handleQishuiStatus } = require('../qishui-api');

const QISHUI_LOGIN_PARTITION = 'persist:mineradio-qishui-oauth-login';
const QISHUI_OFFICIAL_CLIENT_DATA_DIRS = (process.env.QISHUI_OFFICIAL_CLIENT_DATA_DIRS || '')
  .split(/[;,]/)
  .map((value) => String(value || '').trim())
  .filter(Boolean);
const QISHUI_LOGIN_COOKIE_PRIORITY = [
  'sessionid',
  'sessionid_ss',
  'sid_guard',
  'sid_tt',
  'uid_tt',
  'uid_tt_ss',
  'passport_csrf_token',
  'passport_csrf_token_default',
  's_v_web_id',
  'odin_tt',
  'ttwid',
];

function getStableUserDataPath() {
  try {
    const { app } = require('electron');
    const appData = process.env.APPDATA || app.getPath('appData');
    return path.join(appData, 'Mineradio');
  } catch (_) {
    return path.join(process.env.APPDATA || process.env.HOME || __dirname, 'Mineradio');
  }
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });
  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));
  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => name + '=' + value)
    .join('; ');
}

function readQishuiCookieFileText(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    try {
      const secretStore = require('./secret-store');
      const encrypted = secretStore.readSecretFile(filePath);
      if (encrypted) return String(encrypted).trim();
    } catch (_) {}
    return String(fs.readFileSync(filePath, 'utf8') || '').trim();
  } catch (_) {
    return '';
  }
}

function isQishuiCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'douyin.com' || normalized.endsWith('.douyin.com') ||
    normalized === 'qishui.com' || normalized.endsWith('.qishui.com');
}

function qishuiCookieHasLogin(cookieText) {
  return /(?:^|;\s*)(sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt|uid_tt_ss)=/i.test(String(cookieText || ''));
}

function readSavedQishuiCookieHeader() {
  const candidates = [];
  const add = (value) => {
    value = String(value || '').trim();
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  add(process.env.QISHUI_COOKIE_FILE);
  add(path.join(getStableUserDataPath(), '.qishui-cookie'));
  try {
    const { app } = require('electron');
    add(path.join(app.getPath('userData'), '.qishui-cookie'));
  } catch (e) {}
  for (const filePath of candidates) {
    try {
      const cookie = readQishuiCookieFileText(filePath);
      if (qishuiCookieHasLogin(cookie)) return { cookie, source: filePath, method: 'persisted-cookie' };
    } catch (e) {
      console.warn('Saved Qishui cookie read skipped:', e && e.message || e);
    }
  }
  return { cookie: '', source: '', method: 'persisted-cookie' };
}

function qishuiOfficialClientDataDirCandidates() {
  let appDataPath = process.env.APPDATA || '';
  let homePath = process.env.USERPROFILE || process.env.HOME || '';
  try { appDataPath = app.getPath('appData') || appDataPath; } catch (_) {}
  try { homePath = app.getPath('home') || homePath; } catch (_) {}
  let localAppDataPath = process.env.LOCALAPPDATA || '';
  if (!localAppDataPath && appDataPath) {
    localAppDataPath = path.resolve(appDataPath, '..', 'Local');
  }
  return discoverQishuiClientDataRoots({
    explicitDirs: QISHUI_OFFICIAL_CLIENT_DATA_DIRS,
    appDataPath,
    localAppDataPath,
    homePath,
  });
}

function readSqliteVarint(buffer, offset, end) {
  let value = 0n;
  for (let i = 0; i < 9 && offset + i < end; i++) {
    const byte = buffer[offset + i];
    if (i === 8) {
      value = (value << 8n) | BigInt(byte);
      return { value: Number(value), next: offset + i + 1 };
    }
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: Number(value), next: offset + i + 1 };
  }
  return null;
}

function sqliteSerialSize(type) {
  if (type === 0 || type === 8 || type === 9) return 0;
  if (type === 1) return 1;
  if (type === 2) return 2;
  if (type === 3) return 3;
  if (type === 4) return 4;
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  if (type >= 12) return Math.floor((type - 12) / 2);
  return 0;
}

function sqliteDecodeSerialValue(buffer, offset, type) {
  const size = sqliteSerialSize(type);
  if (offset + size > buffer.length) return { value: null, size };
  if (type === 0) return { value: null, size };
  if (type === 1) return { value: buffer.readInt8(offset), size };
  if (type === 2) return { value: buffer.readInt16BE(offset), size };
  if (type === 3) return { value: buffer.readIntBE(offset, 3), size };
  if (type === 4) return { value: buffer.readInt32BE(offset), size };
  if (type === 5) return { value: buffer.readIntBE(offset, 6), size };
  if (type === 6) return { value: Number(buffer.readBigInt64BE(offset)), size };
  if (type === 7) return { value: buffer.readDoubleBE(offset), size };
  if (type === 8) return { value: 0, size };
  if (type === 9) return { value: 1, size };
  if (type >= 12 && type % 2 === 0) return { value: buffer.slice(offset, offset + size), size };
  if (type >= 13 && type % 2 === 1) return { value: buffer.toString('utf8', offset, offset + size), size };
  return { value: null, size };
}

function sqliteParseRecord(buffer, offset, payloadSize) {
  const payloadEnd = Math.min(buffer.length, offset + payloadSize);
  const header = readSqliteVarint(buffer, offset, payloadEnd);
  if (!header || header.value <= 0 || offset + header.value > payloadEnd) return [];
  const headerEnd = offset + header.value;
  const serials = [];
  let pos = header.next;
  while (pos < headerEnd) {
    const serial = readSqliteVarint(buffer, pos, headerEnd);
    if (!serial) break;
    serials.push(serial.value);
    pos = serial.next;
  }
  const values = [];
  pos = headerEnd;
  for (const type of serials) {
    const decoded = sqliteDecodeSerialValue(buffer, pos, type);
    values.push(decoded.value);
    pos += decoded.size;
    if (pos > payloadEnd) break;
  }
  return values;
}

function sqliteLeafRecords(buffer) {
  if (!buffer || buffer.length < 100 || buffer.toString('ascii', 0, 16) !== 'SQLite format 3\0') return [];
  const rawPageSize = buffer.readUInt16BE(16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (!pageSize || pageSize < 512) return [];
  const pageCount = Math.floor(buffer.length / pageSize);
  const records = [];
  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    const pageStart = (pageNo - 1) * pageSize;
    const headerStart = pageStart + (pageNo === 1 ? 100 : 0);
    if (headerStart + 8 > buffer.length || buffer[headerStart] !== 0x0d) continue;
    const cellCount = buffer.readUInt16BE(headerStart + 3);
    const pointerStart = headerStart + 8;
    for (let i = 0; i < cellCount; i++) {
      const pointerOffset = pointerStart + i * 2;
      if (pointerOffset + 2 > buffer.length) break;
      const cellOffset = pageStart + buffer.readUInt16BE(pointerOffset);
      if (cellOffset <= 0 || cellOffset >= buffer.length) continue;
      const payloadSize = readSqliteVarint(buffer, cellOffset, Math.min(buffer.length, cellOffset + 10));
      if (!payloadSize) continue;
      const rowId = readSqliteVarint(buffer, payloadSize.next, Math.min(buffer.length, payloadSize.next + 10));
      if (!rowId) continue;
      records.push(sqliteParseRecord(buffer, rowId.next, payloadSize.value));
    }
  }
  return records;
}

function sqliteCookieColumns(records) {
  const master = records.find((record) =>
    record.some((value) => typeof value === 'string' && /CREATE\s+TABLE\s+cookies/i.test(value))
  );
  const sql = master && master.find((value) => typeof value === 'string' && /CREATE\s+TABLE\s+cookies/i.test(value));
  const body = sql && sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  if (!body) return [];
  return body.split(/,(?![^()]*\))/)
    .map(part => part.trim().split(/\s+/)[0])
    .map(name => String(name || '').replace(/^[`"[]|[`"\]]$/g, ''))
    .filter(Boolean);
}

function extractQishuiCookieHeaderFromCookieDatabase(databasePath) {
  const buffer = fs.readFileSync(databasePath);
  const records = sqliteLeafRecords(buffer);
  const columns = sqliteCookieColumns(records);
  const hostIndex = columns.indexOf('host_key');
  const nameIndex = columns.indexOf('name');
  const valueIndex = columns.indexOf('value');
  if (hostIndex < 0 || nameIndex < 0 || valueIndex < 0) return '';
  const cookies = [];
  for (const record of records) {
    const domain = String(record[hostIndex] || '').trim();
    const name = String(record[nameIndex] || '').trim();
    const value = String(record[valueIndex] || '').trim();
    if (!isQishuiCookieDomain(domain) || !name || !value) continue;
    if (!/^[0-9A-Za-z_.-]+$/.test(name)) continue;
    cookies.push({ domain, name, value });
  }
  return buildCookieHeaderFor(cookies, isQishuiCookieDomain, QISHUI_LOGIN_COOKIE_PRIORITY);
}

function extractQishuiSessionIdFromCookieDatabase(databasePath) {
  const cookie = extractQishuiCookieHeaderFromCookieDatabase(databasePath);
  const match = cookie.match(/(?:^|;\s*)sessionid=([^;]+)/i);
  return match ? String(match[1] || '').trim() : '';
}

function readQishuiOfficialClientCookieDatabase(target) {
  const store = target && typeof target === 'object' && target.cookieDbPath
    ? target
    : {
        cookieDbPath: path.basename(String(target || '')).toLowerCase() === 'cookies'
          ? path.resolve(String(target || ''))
          : path.join(String(target || ''), 'Network', 'Cookies'),
      };
  const cookieDb = store.cookieDbPath;
  if (!fs.existsSync(cookieDb)) return { cookie: '', source: '', missing: true, dbPath: cookieDb };
  try {
    const cookie = extractQishuiCookieHeaderFromCookieDatabase(cookieDb);
    if (!qishuiCookieHasLogin(cookie)) return { cookie: '', source: '', noSession: true, dbPath: cookieDb };
    return { cookie, source: cookieDb, dbPath: cookieDb };
  } catch (e) {
    const message = e && e.message || String(e || '');
    const errorCode = qishuiDiscoveryErrorCode(e);
    const locked = errorCode === 'locked' || errorCode === 'access-denied' ||
      /used by another process|EBUSY|locked|busy|access.*denied|无法访问|另一个程序正在使用|进程无法访问/i.test(message);
    return { cookie: '', source: '', locked, error: message, errorCode, dbPath: cookieDb };
  }
}

async function readQishuiOfficialClientCookieHeader() {
  let last = null;
  let lastLocked = null;
  const roots = qishuiOfficialClientDataDirCandidates();
  const stores = [];
  const storeKeys = new Set();
  const attemptsByStore = new Map();
  const diagnostics = {
    version: 1,
    mode: 'sodamusic-local-session',
    candidateCount: roots.length,
    rootsChecked: [],
    attempts: [],
    selected: null,
    result: 'pending',
  };

  for (const root of roots) {
    const scan = discoverQishuiCookieStores(root);
    diagnostics.rootsChecked.push({
      kind: String(root.kind || 'detected'),
      hint: String(root.hint || 'Detected/client-data'),
      exists: scan.rootExists === true,
      storesFound: scan.stores.length,
      scannedDirectories: scan.scannedDirectories,
      truncated: scan.truncated === true,
      errorCode: String(scan.errorCode || ''),
    });
    for (const store of scan.stores) {
      const key = path.resolve(store.cookieDbPath).toLowerCase();
      if (storeKeys.has(key)) continue;
      storeKeys.add(key);
      stores.push(store);
      const attempt = {
        rootKind: String(store.rootKind || root.kind || 'detected'),
        rootHint: String(store.rootHint || root.hint || 'Detected/client-data'),
        storeLayout: String(store.layout || 'nested-cookie-store'),
        relativeStore: String(store.relativePath || 'Network/Cookies'),
        directRead: 'pending',
        electronRead: 'not-run',
        errorCode: '',
      };
      diagnostics.attempts.push(attempt);
      attemptsByStore.set(key, attempt);
    }
  }

  const finish = (result, diagnosticResult, selected) => {
    diagnostics.result = String(diagnosticResult || 'not-found');
    diagnostics.selected = selected || null;
    try {
      console.log('[QishuiLocalSession]', JSON.stringify(diagnostics));
    } catch (_) {}
    return Object.assign({}, result || {}, { diagnostics });
  };

  for (const store of stores) {
    const key = path.resolve(store.cookieDbPath).toLowerCase();
    const attempt = attemptsByStore.get(key);
    const direct = readQishuiOfficialClientCookieDatabase(store);
    if (attempt) {
      attempt.directRead = direct && direct.cookie
        ? 'login'
        : direct && direct.locked
          ? 'locked'
          : direct && direct.missing
            ? 'missing'
            : direct && direct.noSession
              ? 'no-login'
              : 'error';
      attempt.errorCode = String(direct && direct.errorCode || '');
    }
    if (direct && direct.cookie) {
      return finish(
        Object.assign({ method: 'cookie-db' }, direct),
        'login',
        {
          method: 'cookie-db',
          rootKind: attempt && attempt.rootKind || 'detected',
          rootHint: attempt && attempt.rootHint || 'Detected/client-data',
          storeLayout: attempt && attempt.storeLayout || 'nested-cookie-store',
          relativeStore: attempt && attempt.relativeStore || 'Network/Cookies',
        }
      );
    }
    if (direct && direct.locked) lastLocked = direct;
    last = direct || last;
  }
  if (!stores.length) last = { cookie: '', source: '', missing: true, dbPath: '' };
  if (!session || typeof session.fromPath !== 'function') {
    return finish(
      Object.assign({ cookie: '', source: '', skipped: 'session.fromPath unavailable' }, lastLocked || last || {}),
      lastLocked ? 'locked' : 'not-found'
    );
  }

  const sessionPaths = new Set();
  for (const store of stores) {
    const key = path.resolve(store.cookieDbPath).toLowerCase();
    const attempt = attemptsByStore.get(key);
    const sessionPathKey = path.resolve(store.sessionPath).toLowerCase();
    if (sessionPaths.has(sessionPathKey)) {
      if (attempt) attempt.electronRead = 'duplicate-session';
      continue;
    }
    sessionPaths.add(sessionPathKey);
    try {
      const clientSession = session.fromPath(store.sessionPath, { cache: false });
      const cookie = await readQishuiLoginCookieHeader(clientSession);
      if (attempt) attempt.electronRead = qishuiCookieHasLogin(cookie) ? 'login' : 'no-login';
      if (qishuiCookieHasLogin(cookie)) {
        return finish(
          { cookie, source: store.cookieDbPath, method: 'electron-session' },
          'login',
          {
            method: 'electron-session',
            rootKind: attempt && attempt.rootKind || 'detected',
            rootHint: attempt && attempt.rootHint || 'Detected/client-data',
            storeLayout: attempt && attempt.storeLayout || 'nested-cookie-store',
            relativeStore: attempt && attempt.relativeStore || 'Network/Cookies',
          }
        );
      }
    } catch (e) {
      const errorCode = qishuiDiscoveryErrorCode(e);
      const locked = errorCode === 'locked' || errorCode === 'access-denied';
      if (attempt) {
        attempt.electronRead = locked ? 'locked' : 'error';
        attempt.errorCode = errorCode;
      }
      if (locked) {
        lastLocked = {
          cookie: '',
          source: '',
          locked: true,
          error: e && e.message || String(e || ''),
          errorCode,
          dbPath: store.cookieDbPath,
        };
      }
      console.warn('[QishuiLocalSession] electron import skipped', JSON.stringify({
        rootHint: attempt && attempt.rootHint || 'Detected/client-data',
        storeLayout: attempt && attempt.storeLayout || 'nested-cookie-store',
        errorCode,
      }));
    }
  }
  return finish(
    Object.assign({ cookie: '', source: '', skipped: 'no logged-in SodaMusic client session' }, lastLocked || last || {}),
    lastLocked ? 'locked' : 'not-found'
  );
}


async function readQishuiLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isQishuiCookieDomain, QISHUI_LOGIN_COOKIE_PRIORITY);
}


async function openQishuiMusicLoginWindow(owner) {
  const imported = await readQishuiOfficialClientCookieHeader();
  if (imported && imported.cookie) {
    let importedStatus = null;
    try {
      importedStatus = await handleQishuiStatus(imported.cookie);
    } catch (error) {
      console.warn('Imported Qishui cookie validation skipped:', error && error.message || error);
    }
    return {
      ...(importedStatus || {}),
      ok: true,
      provider: 'qishui',
      webSession: true,
      opened: false,
      cookieSaved: false,
      cookie: imported.cookie,
      loggedIn: true,
      configured: true,
      searchReady: true,
      publicCatalog: false,
      playbackMode: 'direct-url',
      localPcImport: true,
      importedOfficialClient: true,
      source: imported.source,
      importMethod: imported.method || 'cookie-db',
      localSessionDiagnostics: imported.diagnostics || null,
      message: '已读取本机汽水 PC 登录态，正在导入 Mineradio 并同步我的喜欢和歌单',
    };
  }

  // Reuse Mineradio's last imported copy only when the official client data is
  // temporarily unavailable. This keeps normal use stable without ever
  // falling through to the obsolete QR/OAuth flows.
  const saved = readSavedQishuiCookieHeader();
  let savedStatus = null;
  if (saved && saved.cookie) {
    try {
      savedStatus = await handleQishuiStatus(saved.cookie);
    } catch (error) {
      console.warn('Saved Qishui cookie validation skipped:', error && error.message || error);
    }
  }
  if (saved && saved.cookie && savedStatus && savedStatus.loggedIn && savedStatus.webSession) {
    return {
      ...savedStatus,
      ok: true,
      provider: 'qishui',
      webSession: true,
      opened: false,
      cookieSaved: true,
      cookie: saved.cookie,
      loggedIn: true,
      configured: true,
      searchReady: true,
      publicCatalog: false,
      playbackMode: 'direct-url',
      localPcImport: true,
      persistedSession: true,
      source: saved.source,
      importMethod: saved.method,
      localSessionDiagnostics: imported && imported.diagnostics || null,
      message: imported && imported.locked
        ? '本机汽水登录数据库暂时被占用，已继续使用 Mineradio 上次导入的有效登录态。'
        : '已继续使用 Mineradio 上次从本机汽水 PC 导入的登录态。',
    };
  }

  const locked = !!(imported && imported.locked);
  return {
    ok: false,
    provider: 'qishui',
    webSession: false,
    loggedIn: false,
    localPcImport: true,
    source: imported && (imported.dbPath || imported.source) || '',
    locked,
    localSessionDiagnostics: imported && imported.diagnostics || null,
    error: locked ? 'QISHUI_LOCAL_COOKIE_DB_LOCKED' : 'QISHUI_LOCAL_COOKIE_NOT_FOUND',
    message: locked
      ? '汽水 PC 客户端正在占用本地登录数据库。请先完全退出汽水音乐 PC 端，再点击“重新导入”。'
      : '没有读到本机汽水 PC 登录态。请先安装并登录汽水音乐 PC 客户端，然后重新导入。',
  };
}

async function clearQishuiMusicLoginSession() {
  const cookieSession = session.fromPartition(QISHUI_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}


module.exports = {
  QISHUI_LOGIN_PARTITION,
  openQishuiMusicLoginWindow,
  clearQishuiMusicLoginSession,
  qishuiCookieHasLogin,
  readSavedQishuiCookieHeader,
};
