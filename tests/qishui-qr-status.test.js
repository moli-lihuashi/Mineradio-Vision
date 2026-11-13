'use strict';

// 汽水扫码状态收敛规则的单测。
//
// 这次「清理未收口」的核心结论：`status === '2'` **不是死代码**。
// CHANGELOG 曾断言上游只回字面量（new/scanned/confirmed/expired），
// 但 qishui-auth-v6.js:828 判确认态时同时写了 `String(data.status) === '3'`，
// 说明数字形态真实存在；删掉 '2' 会让「已扫码」退化成「等待扫码」。
// 所以改为数字 + 字面量双形态收敛，由这些用例锁住。

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapQishuiQrStatus, QR_RETRY_AFTER_MS } = require('../server/qishui/qr-status');

function map(status, errorCode) {
  return mapQishuiQrStatus({ status, errorCode });
}

test('数字形态：1 新 / 2 已扫 / 3 已确认 都要映射（2 不是死代码）', () => {
  assert.equal(map('1').status, 'waiting');
  assert.equal(map('2').status, 'scanned', '上游若回数字 2，必须识别成已扫码');
  assert.equal(map('3').status, 'confirmed');
  assert.equal(map(2).status, 'scanned', '数值类型也要吃进来');
});

test('字面量形态：new / scanned / confirmed / expired', () => {
  assert.equal(map('new').status, 'waiting');
  assert.equal(map('scanned').status, 'scanned');
  assert.equal(map('confirmed').status, 'confirmed');
  assert.equal(map('expired').status, 'expired');
});

test('大小写与首尾空白要做容错', () => {
  assert.equal(map('  Scanned ').status, 'scanned');
  assert.equal(map('CONFIRMED').status, 'confirmed');
});

test('空状态视为等待扫码', () => {
  assert.equal(map('').status, 'waiting');
  assert.equal(map(undefined).status, 'waiting');
  assert.equal(map(null).status, 'waiting');
});

test('error_code 2 优先判过期，盖过文本状态', () => {
  const r = map('scanned', 2);
  assert.equal(r.status, 'expired');
  assert.equal(r.retryAfterMs, 0);
});

test('error_code 7 只降频、不命名语义（不再叫 rate_limited）', () => {
  const r = map('', 7);
  assert.equal(r.status, 'upstream_code_7');
  assert.notEqual(r.status, 'rate_limited', '「限流」解读已被探针证伪，不该再出现这个状态名');
  assert.equal(r.retryAfterMs, QR_RETRY_AFTER_MS);
  assert.equal(r.unknown, false);
});

test('未知状态原样透传并标记 unknown，不吞掉上游原文', () => {
  const r = map('whatever_upstream_says');
  assert.equal(r.status, 'whatever_upstream_says');
  assert.equal(r.unknown, true);
  assert.equal(r.rawStatus, 'whatever_upstream_says');
  assert.equal(r.retryAfterMs, 0);
});

test('已知状态一律 retryAfterMs=0，只有 code 7 才降频', () => {
  ['1', '2', '3', 'new', 'scanned', 'confirmed', 'expired', ''].forEach(s => {
    assert.equal(map(s).retryAfterMs, 0, '状态 ' + JSON.stringify(s) + ' 不该带重试延迟');
  });
});
