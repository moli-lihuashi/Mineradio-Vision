'use strict';

/* =============================================================================
 * issue #1 问题 1：酷狗「个人歌单」cloudlist 20017
 *
 * 根因：cloudlist 校验「请求客户端身份 == token 签发身份」。
 *   扫码 key 用 1001、换 token 用 1005、cloudlist 请求用 3116 —— 三方不一致，
 *   所以个人歌单恒 20017（不是 dfid 缺失，也不是签名错）。
 *
 * 2026-11-21 实测（真实账号）：
 *   用 3116 扫码拿到 token 后，以 3116 + lite 盐请求 /v7/get_all_list：
 *   status=1, error_code=0, listCount=2 —— 20017 消失。
 *
 * 本守卫锁「登录身份必须与 cloudlist 身份同源」，防止以后有人把 appid 改回去。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8').replace(/\r\n/g, '\n');

test('扫码登录必须用 3116 / 11440（与 cloudlist 的 lite 身份一致）', () => {
  const server = read('server.js');
  assert.match(server, /const KUGOU_QR_APPID = '3116';/,
    '扫码 appid 必须是 3116：1001/1005 签发的 token 与 cloudlist(3116) 身份不一致，恒 20017');
  assert.match(server, /const KUGOU_QR_CLIENTVER = '11440';/,
    '扫码 clientver 必须是 lite 的 11440');
  assert.ok(!/KUGOU_QR_APPID = '1001'/.test(server), '不许改回 1001');
});

test('二维码内容里的 appid 必须与请求参数同源', () => {
  const svc = read('server/lib/kugou-service.js');
  assert.match(svc, /const qrcodeText = 'https:\/\/h5\.kugou\.com\/apps\/loginQRCode\/html\/index\.html\?appid=' \+ KUGOU_QR_APPID/,
    'qrcodeText 必须用 KUGOU_QR_APPID，不能再用 KUGOU_ID.APPID');
  assert.ok(!/qrcodeText = [^;]*KUGOU_ID\.APPID/.test(svc), '二维码内容不许用全局默认 appid');
});

test('换 token 优先 3116，且保留 1005 回退', () => {
  const svc = read('server/lib/kugou-service.js');
  const start = svc.indexOf('async function handleKugouLoginQrCheck');
  assert.ok(start > 0, '找不到 handleKugouLoginQrCheck');
  const nextFn = svc.indexOf('\n  async function ', start + 10);
  const body = svc.slice(start, nextFn > start ? nextFn : start + 4000);

  assert.ok(/checkQr\(KUGOU_QR_APPID, KUGOU_QR_CLIENTVER\)/.test(body),
    '换 token 必须先用 3116/11440');
  assert.ok(/checkQr\(KUGOU_ID\.APPID, KUGOU_ID\.CLIENTVER\)/.test(body),
    '3116 失败时必须回退旧身份，否则登录会整体不可用');
  assert.ok(/if \(!tokenOf\(data\)\)/.test(body),
    '回退条件必须是「没拿到 token」，不能在拿到 token 后仍多请求一次');
  // 旧写法：直接用 KUGOU_ID.APPID 换 token
  assert.ok(!/appid: KUGOU_ID\.APPID,\s*\n\s*srcappid: KUGOU_QR_SRC_APPID/.test(body),
    '不许退回「换 token 用 1005」的旧写法');
});

test('cloudlist 仍用 lite 身份，与登录身份保持同源', () => {
  const http = read('server/kugou/http.js');
  const start = http.indexOf('async function kugouCloudlistRequest');
  assert.ok(start > 0, '找不到 kugouCloudlistRequest');
  const body = http.slice(start, start + 3000);
  assert.ok(/appid: KUGOU_LITE_APPID/.test(body), 'cloudlist 必须用 lite appid');
  assert.ok(/clientver: KUGOU_LITE_CLIENTVER/.test(body), 'cloudlist 必须用 lite clientver');
  assert.ok(/KUGOU_LITE_ANDROID_SALT/.test(body), 'cloudlist 必须用 lite 盐');

  const cfg = read('server/kugou/config.js');
  const liteAppid = /const KUGOU_LITE_APPID = '(\d+)'/.exec(cfg);
  const liteClientver = /const KUGOU_LITE_CLIENTVER = '(\d+)'/.exec(cfg);
  const qrAppid = /const KUGOU_QR_APPID = '(\d+)'/.exec(read('server.js'));
  const qrClientver = /const KUGOU_QR_CLIENTVER = '(\d+)'/.exec(read('server.js'));
  assert.ok(liteAppid && qrAppid, '缺少 appid 常量');
  assert.equal(qrAppid[1], liteAppid[1], '登录 appid 必须等于 cloudlist appid');
  assert.equal(qrClientver[1], liteClientver[1], '登录 clientver 必须等于 cloudlist clientver');
});
