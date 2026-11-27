'use strict';

/*
 * WASAPI 旁路取样点守卫（2026-11-26）
 *
 * 故障：开启「WASAPI 旁路输出」后，EQ / 前级增益 / 响度对齐 / 声道平衡 / 防爆音全部没反应，音量也没反应。
 *
 * 原因：音频图是
 *   source → moodExit → audioTuning(五项调节) → audioTap → gainNode → destination
 * 而桥里取样点写成了 `tap = source`（无条件覆盖上一行算出来的 tap），
 * 取的是调音链**之前**的信号，所以整条调音链被绕过去了。
 *
 * 修法：从 `gainNode`（调音链之后、主出声之前）取样；
 * 并且主出声不能再用「gain 设 0」来静音 —— 取样点在 gain 之后，
 * 清零会把旁路流一起静音。必须断开 gainNode → destination，停止时再接回。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../public/js/modules/03-beat/09-wasapi-output-bridge.js'),
  'utf8'
);

const startFn = SRC.slice(SRC.indexOf('async function startWasapiOutputBridge'), SRC.indexOf('async function stopWasapiOutputBridge'));
const stopFn = SRC.slice(SRC.indexOf('async function stopWasapiOutputBridge'), SRC.indexOf('function initWasapiOutputBridgeFromPref'));

test('取样点在调音链之后（gainNode），不是 source', () => {
  assert.ok(startFn.includes('masterOut.connect(wasapiScriptNode)'),
    '必须从主输出节点（gainNode）取样，否则 EQ 等五项调节会被绕过');
  assert.ok(/var masterOut = .*gainNode/.test(startFn), 'masterOut 要取自 gainNode');
  assert.ok(!/^\s*tap = source;\s*$/m.test(startFn),
    '不能无条件 tap = source（这正是原来的 bug）');
});

test('主出声靠断开连接静音，不能把 gain 清零', () => {
  assert.ok(startFn.includes('masterOut.disconnect(audioCtx.destination)'),
    '取样点在 gain 之后，必须断开 destination 而不是清零 gain');
  assert.ok(!/gainNode\.gain\.value = 0/.test(startFn), '不能再清零 gain（会把旁路流一起静音）');
});

test('兜底路径可见：拿不到主节点时退回 source 并告警', () => {
  assert.match(startFn, /console\.warn\([^)]*gainNode/, '退回 source 必须留下 warn，别静默降级');
  assert.ok(startFn.includes('source.connect(wasapiScriptNode)'), '兜底仍要能出声');
});

test('停止时把主出声接回 destination', () => {
  assert.ok(stopFn.includes('gainNode.connect(wasapiDetachedDestination)'),
    '关闭旁路必须把手动断开的连接接回去，否则整机静音');
  assert.ok(SRC.includes('var wasapiDetachedDestination = null'), '要有记录被断开目标的状态位');
});
