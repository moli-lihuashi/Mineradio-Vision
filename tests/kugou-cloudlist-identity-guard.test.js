'use strict';

// =============================================================================
// 2026-08-29 KUGOU_GATEWAY_FAILED(20017) 事故守卫
// 根因：cloudlist（歌单读写/收藏）要求请求客户端身份与 token 签发身份一致——
// 登录会话是酷狗概念版 lite 身份（appid 3116 / clientver 11440 / lite 盐 / lite RSA 公钥），
// kugou-api.js 旧实现用标准版身份（1005/20489）访问 → 一律 20017；且登录 cookie 缺 dfid。
// 本文件把这些结论钉死为静态断言，防止身份常量或调用通道被改回去。
// 详见 docs/PROJECT_MEMORY.md「2026-08-29 - 酷狗收藏 KUGOU_GATEWAY_FAILED(20017)」条目。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readKugouSources, readServerEntrySources } = require('../scripts/quick-check/helpers');

const appRoot = path.resolve(__dirname, '..');

// 2026-10-18 插件族拆分：kugou-api.js 已退化成门面（require + 导出表），身份常量、
// cloudlist 通道、设备注册全部搬进 server/kugou/*.js。本文件的断言语义是「这些常量
// 与调用形态还在代码里」，不是「还在 kugou-api.js 这一个文件里」，所以按族读
// （kugou-api.js + server/kugou/*.js，与 scripts/quick-check/guards.js 同一套做法）。
//
// serverSource 故意保持单文件：它守的是「server.js 自己不许硬编码标准身份」——
// 标准 android 盐合法地存在于 server/kugou/config.js（非 cloudlist 通道要用），
// 按族读会把这条否定断言变成恒假。
const kugouApiSource = readKugouSources(appRoot);
const serverSource = fs.readFileSync(path.join(appRoot, 'server.js'), 'utf8');
const serverEntryFamilySource = readServerEntrySources(appRoot);

const CLOUDLIST_ENDPOINTS = [
  'v7/get_all_list',
  'v4/get_list_all_file',
  'v6/add_song',
  'v4/delete_songs',
];

const STANDARD_ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const STANDARD_RSA_KEY_MARK = 'DIAG7QOELSYoIJvTFJhMpe1s';
const LITE_RSA_KEY_MARK = 'QDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27';

function functionBody(source, name) {
  const marker = source.indexOf('function ' + name);
  assert.ok(marker >= 0, `missing function ${name}()`);
  const end = source.indexOf('\n}', marker);
  assert.ok(end > marker, `unbalanced function body: ${name}()`);
  return source.slice(marker, end);
}

test('cloudlist endpoints must all be called via kugouCloudlistRequest (lite identity channel)', () => {
  for (const endpoint of CLOUDLIST_ENDPOINTS) {
    assert.match(
      kugouApiSource,
      new RegExp(`kugouCloudlistRequest\\('/${endpoint.replace('/', '\\/')}'`),
      `/${endpoint} must go through kugouCloudlistRequest`,
    );
    assert.doesNotMatch(
      kugouApiSource,
      new RegExp(`kugou(?:H5Gateway|Gateway)Request\\('/${endpoint.replace('/', '\\/')}'`),
      `/${endpoint} must not bypass kugouCloudlistRequest (would return 20017)`,
    );
  }
});

test('kugou-api.js must pin the lite client identity constants', () => {
  assert.match(kugouApiSource, /const KUGOU_LITE_APPID = '3116'/);
  assert.match(kugouApiSource, /const KUGOU_LITE_CLIENTVER = '11440'/);
  assert.match(kugouApiSource, /const KUGOU_LITE_ANDROID_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'/);
  assert.match(kugouApiSource, /const KUGOU_LITE_GATEWAY_UA = 'Android15-1070-11440-/);
});

test('kugouCloudlistRequest must present the lite identity to cloudlist', () => {
  const body = functionBody(kugouApiSource, 'kugouCloudlistRequest');
  assert.match(body, /kugouWithCloudlistDevice\(opts\)/, 'must inject registered dfid');
  assert.match(body, /opts\.router\s*=\s*'cloudlist\.service\.kugou\.com'/, 'must mark cloudlist router before ensure');
  assert.match(body, /appid: KUGOU_LITE_APPID/);
  assert.match(body, /clientver: KUGOU_LITE_CLIENTVER/);
  assert.match(body, /KUGOU_LITE_ANDROID_SALT/, 'must sign with the lite salt');
  assert.match(body, /KUGOU_LITE_GATEWAY_UA/, 'must present the lite User-Agent');
});

test('kugouWithCloudlistDevice must always ensure dfid (no dead opts.router gate)', () => {
  assert.doesNotMatch(
    kugouApiSource,
    /opts\.router\s*!==\s*['"]cloudlist\.service\.kugou\.com['"]/,
    'router early-return made ensureKugouDfid unreachable',
  );
  const body = functionBody(kugouApiSource, 'kugouWithCloudlistDevice');
  assert.match(body, /ensureKugouDfid/, 'must call ensureKugouDfid unconditionally');
});

test('server.js cloudlist must delegate to kugou-api and not gateway-bypass get_all_list', () => {
  assert.match(serverSource, /kugouApiCloudlistRequest/, 'server must import kugou-api cloudlist channel');
  assert.doesNotMatch(
    serverSource,
    /kugouGatewayRequest\(\s*['"]\/v7\/get_all_list['"]/,
    'server /v7/get_all_list must not bypass cloudlist channel',
  );
  // 调用点随实现搬进了 server/kugou/*，按族断言「get_all_list 只走 cloudlist 通道」。
  assert.match(kugouApiSource, /kugouCloudlistRequest\('\/v7\/get_all_list'/);
});

test('device registration must exist, use the lite RSA key, and cover both response shapes', () => {
  assert.match(kugouApiSource, /userservice\.kugou\.com/);
  assert.match(kugouApiSource, /risk\/v2\/r_register_dev/);
  assert.match(kugouApiSource, new RegExp(LITE_RSA_KEY_MARK), 'registration must use the lite RSA public key');
  assert.ok(!new RegExp(STANDARD_RSA_KEY_MARK).test(kugouApiSource), 'standard RSA key yields 20010 rsa failure on lite identity');
  const body = functionBody(kugouApiSource, 'registerKugouCloudDevice');
  assert.match(body, /startsWith\('\{'\)/, 'must accept plaintext JSON responses (risk-control rejections)');
  assert.match(body, /createDecipheriv\('aes-128-cbc'/, 'must AES-decrypt success responses');
});

test('dfid registration infrastructure must be wired for persistence', () => {
  assert.match(kugouApiSource, /function ensureKugouDfid/);
  assert.match(kugouApiSource, /function setKugouDfidPersistHook/);
  assert.match(kugouApiSource, /kugouDfidPersistHook\(dfid\)/, 'newly registered dfid must reach the persist hook');
  assert.match(serverSource, /setKugouDfidPersistHook\(/, 'server.js must register the dfid persist hook');
});

test('server.js must reuse the lite identity from kugou-api.js with zero standard-identity drift', () => {
  // 懒加载后常量经 KUGOU_ID getter 转发，仍以 kugou-api.js 为唯一来源。
  // getter 定义留在 server.js；使用点（KUGOU_ID.APPID 等）在服务端拆分后
  // 随签名/请求代码搬进了 server/lib/kugou-protocol.js / kugou-service.js，
  // 所以使用点要在 server.js + server/lib/*.js 范围内找（与 guards.js 同一判据）。
  assert.match(serverSource, /KUGOU_LITE_APPID/);
  assert.match(serverSource, /KUGOU_LITE_CLIENTVER/);
  assert.match(serverSource, /KUGOU_LITE_ANDROID_SALT/);
  assert.match(serverSource, /KUGOU_LITE_GATEWAY_UA/);
  assert.match(serverEntryFamilySource, /KUGOU_ID\.(APPID|CLIENTVER|ANDROID_SIGN_KEY|ANDROID_UA|WEB_SIGN_KEY)/);
  // 否定断言只守 server.js 自己：标准身份常量合法地存在于 server/kugou/config.js。
  assert.doesNotMatch(serverSource, new RegExp(STANDARD_ANDROID_SALT), 'standard android salt must not reappear in server.js');
  assert.doesNotMatch(serverSource, new RegExp(STANDARD_RSA_KEY_MARK), 'standard RSA key must not reappear in server.js');
});

test('kugou-api.js must export the cloudlist channel for tooling and tests', () => {
  assert.match(kugouApiSource, /kugouCloudlistRequest,/);
  assert.match(kugouApiSource, /registerKugouCloudDevice,/);
  assert.match(kugouApiSource, /setKugouDfidPersistHook,/);
});
