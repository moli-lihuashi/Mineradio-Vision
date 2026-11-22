'use strict';

/*
 * 服务端启动 require 链守卫（2026-11-22）
 *
 * 为什么守：Electron 主进程启动时同步 `require(server.js)`，期间消息泵被堵，
 * 窗口已显示但点不动（Windows 判未响应 → 鼠标转圈）。实测冷启动 server-ready
 * 1497ms，其中 qrcode 一个包就占 631ms（连带 pngjs 渲染器），而它只在
 * 「酷狗扫码登录」时才会用到。
 *
 * 这里守两件事：
 *   1) qrcode 不得再出现在 server.js 的顶层 require；
 *   2) kugou-service 必须按需加载（函数内 require），且工厂本身不触发它。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const KUGOU = fs.readFileSync(path.join(ROOT, 'server/lib/kugou-service.js'), 'utf8');

test('server.js 不得在顶层 require qrcode', () => {
  const topLevel = SERVER.split(/\r?\n/).filter((line) => /^\s*(const|let|var)\s+.*require\(\s*['"]qrcode['"]\s*\)/.test(line));
  assert.equal(topLevel.length, 0, 'qrcode 必须从服务端顶层移除：' + topLevel.join(' | '));
  assert.ok(!/^\s*QRCode,\s*$/m.test(SERVER), 'routeCtx 里不得再注入 QRCode');
});

test('kugou-service 必须按需加载 qrcode', () => {
  assert.match(KUGOU, /function qrcodeLib\(\)\s*\{[\s\S]{0,200}require\(['"]qrcode['"]\)/, '必须有懒加载函数');
  assert.match(KUGOU, /qrcodeLib\(\)\.toDataURL\(/, '扫码登录必须走懒加载');
  assert.ok(!/^\s*QRCode\.toDataURL/m.test(KUGOU), '不得直接使用顶层 QRCode 绑定');
  assert.ok(!/^\s*QRCode,\s*$/m.test(KUGOU), '工厂解构里不得再接收 QRCode');
});

test('不加载 qrcode 也能创建酷狗服务工厂', () => {
  const create = require('../server/lib/kugou-service');
  assert.equal(typeof create, 'function');
  const service = create({});
  assert.equal(typeof service, 'object');
  // 关键：创建工厂不应当把 qrcode 拉进 require 缓存
  const qrcodePath = require.resolve('qrcode');
  assert.ok(!Object.prototype.hasOwnProperty.call(require.cache, qrcodePath), '工厂创建阶段不应加载 qrcode');
});
