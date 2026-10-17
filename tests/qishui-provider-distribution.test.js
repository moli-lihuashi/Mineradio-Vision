'use strict';

const assert = require('assert');
const fs = require('fs');
const https = require('https');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const qishui = require('../qishui-api');

function namedFunctionSource(source, name) {
  const declaration = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(source);
  if (!declaration) return '';
  const bodyStart = source.indexOf('{', declaration.index + declaration[0].length);
  if (bodyStart < 0) return '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(declaration.index, index + 1);
    }
  }
  return '';
}

function withHttpsMock(handler, task) {
  const original = https.request;
  https.request = function mockedRequest(targetUrl, options, callback) {
    const request = new EventEmitter();
    const chunks = [];
    request.write = chunk => chunks.push(Buffer.from(String(chunk)));
    request.setTimeout = () => request;
    request.destroy = error => process.nextTick(() => request.emit('error', error || new Error('destroyed')));
    request.end = () => {
      Promise.resolve(handler({
        url: String(targetUrl),
        options: options || {},
        body: Buffer.concat(chunks).toString('utf8'),
      })).then(result => {
        result = result || {};
        const response = new EventEmitter();
        response.statusCode = Number(result.statusCode || 200);
        response.headers = result.headers || {};
        callback(response);
        process.nextTick(() => {
          response.emit('data', Buffer.from(typeof result.body === 'string' ? result.body : JSON.stringify(result.body || {})));
          response.emit('end');
        });
      }).catch(error => request.emit('error', error));
    };
    return request;
  };
  return Promise.resolve().then(task).finally(() => { https.request = original; });
}

async function run() {
  const status = qishui.getQishuiStatus('');
  assert.strictEqual(status.loggedIn, false);
  assert.strictEqual(status.capabilities.search, true, 'fresh installations must retain the Qishui metadata search fallback');

  const ranked = qishui._test.rankQishuiPublicSongs([
    { name: '无关歌曲', artist: '无关歌手', album: '' },
    { name: '晴天', artist: '周杰伦', album: '叶惠美' },
    { name: '另一个结果', artist: '周杰伦', album: '' },
  ], '晴天 周杰伦', 5);
  assert.strictEqual(ranked[0].name, '晴天');
  assert.strictEqual(ranked.some(song => song.name === '无关歌曲'), false, 'when relevant results exist, unrelated catalog noise must be removed');

  await withHttpsMock(({ url }) => {
    if (!url.includes('api-vehicle.volcengine.com/v2/search/type')) throw new Error('Unexpected Qishui search URL: ' + url);
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('real_offset'), '0', 'public search must use a bounded candidate window instead of the upstream duplicate offset');
    const count = Math.max(8, Number(parsed.searchParams.get('limit')) || 0);
    return {
      body: {
        data: {
          list: Array.from({ length: count }, (_, index) => ({
            item_id: 'paged-' + index,
            title: '分页测试 ' + index,
            author_info: { id: 'artist', name: '分页歌手' },
          })),
        },
      },
    };
  }, async () => {
    const first = await qishui.handleQishuiSearch('分页测试', 4, '', 0);
    const second = await qishui.handleQishuiSearch('分页测试', 4, '', 4);
    assert.deepStrictEqual(first.songs.map(song => song.id), ['paged-0', 'paged-1', 'paged-2', 'paged-3']);
    assert.deepStrictEqual(second.songs.map(song => song.id), ['paged-4', 'paged-5', 'paged-6', 'paged-7']);
    assert.strictEqual(first.nextOffset, 4);
    assert.strictEqual(second.nextOffset, 8);
  });

  const desktopMain = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  const desktopImport = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'qishui-local-session-import.js'), 'utf8');
  const extractorSource = namedFunctionSource(desktopImport, 'extractQishuiCookieHeaderFromCookieDatabase')
    || namedFunctionSource(desktopMain, 'extractQishuiCookieHeaderFromCookieDatabase');
  assert(extractorSource, 'the SodaMusic cookie database must have a full-cookie extractor');
  const extractCookie = vm.runInNewContext('(' + extractorSource + ')', {
    fs: { readFileSync: () => Buffer.from('test') },
    sqliteLeafRecords: () => [
      ['.qishui.com', 'sessionid', 'session-value'],
      ['.qishui.com', 'sid_tt', 'sid-value'],
      ['.qishui.com', 'uid_tt', 'uid-value'],
      ['.qishui.com', 'ttwid', 'ttwid-value'],
      ['.example.com', 'sessionid', 'wrong-domain'],
      ['.qishui.com', 'empty_cookie', ''],
    ],
    sqliteCookieColumns: () => ['host_key', 'name', 'value'],
    isQishuiCookieDomain: domain => /(?:^|\.)qishui\.com$/i.test(String(domain || '').replace(/^\./, '')),
    QISHUI_LOGIN_COOKIE_PRIORITY: ['sessionid', 'sid_tt', 'uid_tt', 'ttwid'],
    buildCookieHeaderFor: (cookies, allowed, priority) => {
      const picked = new Map();
      cookies.forEach(cookie => { if (allowed(cookie.domain)) picked.set(cookie.name, cookie.value); });
      return priority.filter(name => picked.has(name)).map(name => name + '=' + picked.get(name)).join('; ');
    },
    Buffer,
  });
  const cookie = extractCookie('Network/Cookies');
  assert.strictEqual(cookie, 'sessionid=session-value; sid_tt=sid-value; uid_tt=uid-value; ttwid=ttwid-value');
  assert(!cookie.includes('wrong-domain'), 'cookies from unrelated domains must never be imported');

  // 契约变更（2026-10-17）：本地汽水客户端会话导入窗口（openQishuiMusicLoginWindow）已下线，
  // 登录统一走扫码桥 qishui-qr-login.js；这里断言新链路存在、旧入口保持移除状态。
  const qrBridge = fs.readFileSync(path.join(__dirname, '..', 'qishui-qr-login.js'), 'utf8');
  assert(/createQishuiQrLoginBridge/.test(qrBridge), 'the desktop Qishui QR login bridge must exist');
  assert(/QISHUI_QR_CONFIG_FILE/.test(desktopMain), 'the desktop must persist the Qishui QR login config');
  assert(!/openQishuiMusicLoginWindow/.test(desktopImport), 'the removed local-session import window must stay gone');
  const officialReader = desktopImport.slice(desktopImport.indexOf('async function readQishuiOfficialClientCookieHeader'));
  // 契约变更（2026-10-17）：读者只从本机汽水客户端的 cookie 库 + Electron session 读取，
  // 不再回落到 readSavedQishuiCookieHeader() 的缓存副本，因此旧的「先后顺序」断言不再成立。
  assert(officialReader.indexOf('discoverQishuiCookieStores') >= 0, 'the reader must scan local SodaMusic cookie stores');
  assert(officialReader.indexOf('readQishuiOfficialClientCookieDatabase') >= 0, 'the reader must read the local cookie database directly');
  assert(officialReader.indexOf('readSavedQishuiCookieHeader()') < 0, 'the reader must not fall back to the cached cookie copy');
  console.log('[OK] Qishui search pagination and strict full SodaMusic local-session import verified.');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
