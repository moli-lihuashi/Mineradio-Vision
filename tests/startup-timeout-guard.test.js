'use strict';

/*
 * 启动超时守卫（2026-11-25）
 *
 * 背景：cookie 解密走 safeStorage/DPAPI，杀软/系统繁忙时单次 readFn 实测 2–5s，
 * 4 个 cookie 读完会让本地服务超过 8s 才就绪，旧配置直接报 MR-BOOT-SERVER-START；
 * 随后窗口加载也被连带判超时（用户看到的就是启动失败弹窗）。
 * 这里锁住「探活窗口必须给慢解密留足余量」，避免以后又被调回 8s。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');

function readMs(name) {
  const match = MAIN.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(match, '必须定义 ' + name);
  return Number(match[1]);
}

test('本地服务探活必须给慢 cookie 解密留足余量（>=30s）', () => {
  const http = readMs('STARTUP_HTTP_TIMEOUT_MS');
  assert.ok(http >= 30000, 'STARTUP_HTTP_TIMEOUT_MS 必须 >=30000，当前 ' + http);
});

test('服务监听等待必须 >=20s', () => {
  const server = readMs('STARTUP_SERVER_TIMEOUT_MS');
  assert.ok(server >= 20000, 'STARTUP_SERVER_TIMEOUT_MS 必须 >=20000，当前 ' + server);
});

test('主窗口导航超时不得低于 20s', () => {
  const nav = readMs('STARTUP_NAVIGATION_TIMEOUT_MS');
  assert.ok(nav >= 20000, 'STARTUP_NAVIGATION_TIMEOUT_MS 必须 >=20000，当前 ' + nav);
});
