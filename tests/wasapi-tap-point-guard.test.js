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
const vm = require('vm');

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

function createWasapiSandbox(options) {
  const opts = options || {};
  const openPlan = (opts.openPlan || []).slice();
  let openIndex = 0;
  const source = SRC.slice(
    SRC.indexOf('var WASAPI_OUTPUT_STORE_KEY'),
    SRC.indexOf('function initWasapiOutputBridgeFromPref')
  );
  const openResolvers = [];
  const state = { closeCalls: 0, scriptNodes: [] };
  const makeNode = (name) => ({
    name,
    connections: [],
    connect(node) { this.connections.push(node); },
    disconnect(node) {
      const index = this.connections.indexOf(node);
      if (index >= 0) this.connections.splice(index, 1);
    },
  });
  const destination = makeNode('destination');
  const gainNode = makeNode('gain');
  gainNode.gain = { value: 1 };
  const audioCtx = {
    sampleRate: 48000,
    destination,
    createScriptProcessor() {
      const node = makeNode('script');
      state.scriptNodes.push(node);
      return node;
    },
  };
  const api = {
    wasapiAvailable: async () => true,
    wasapiOpen() {
      const plan = openIndex < openPlan.length ? openPlan[openIndex] : 'defer';
      openIndex += 1;
      if (plan instanceof Error) return Promise.reject(plan);
      if (plan !== 'defer') return Promise.resolve(plan);
      return new Promise((resolve) => openResolvers.push(resolve));
    },
    wasapiClose: async () => { state.closeCalls += 1; },
    wasapiWrite() {},
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Promise,
    Math,
    Date,
    Float32Array,
    localStorage: { getItem() { return null; }, setItem() {} },
    window: { desktopWindow: api },
    audioCtx,
    source: makeNode('source'),
    gainNode,
  };
  vm.runInNewContext(source, sandbox, { filename: '09-wasapi-output-bridge.js' });
  return { sandbox, state, openResolvers, gainNode, destination };
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

test('WASAPI 开启在途时执行关闭，旧开启不得重新激活旁路', async () => {
  const { sandbox, state, openResolvers } = createWasapiSandbox();
  const starting = sandbox.startWasapiOutputBridge();
  await flushMicrotasks();
  assert.strictEqual(openResolvers.length, 1);

  const stopping = sandbox.stopWasapiOutputBridge();
  openResolvers[0]({ ok: true, status: {} });
  const startResult = await starting;
  const stopResult = await stopping;

  assert.strictEqual(startResult.superseded, true);
  assert.strictEqual(stopResult.ok, true);
  assert.strictEqual(sandbox.wasapiOutputActive, false);
  assert.strictEqual(sandbox.wasapiScriptNode, null);
  assert.strictEqual(state.scriptNodes.length, 0);
  assert.strictEqual(state.closeCalls, 1);
});

test('WASAPI 连续开启只保留最后一次代际，停止后恢复 WebAudio', async () => {
  const { sandbox, state, openResolvers, gainNode, destination } = createWasapiSandbox();
  const first = sandbox.startWasapiOutputBridge();
  await flushMicrotasks();
  const second = sandbox.startWasapiOutputBridge();
  openResolvers[0]({ ok: true, status: {} });
  await flushMicrotasks();
  assert.strictEqual(openResolvers.length, 2);
  openResolvers[1]({ ok: true, status: {} });

  const firstResult = await first;
  const secondResult = await second;
  assert.strictEqual(firstResult.superseded, true);
  assert.strictEqual(secondResult.ok, true);
  assert.strictEqual(sandbox.wasapiOutputActive, true);
  assert.strictEqual(state.scriptNodes.length, 1);
  assert.strictEqual(state.closeCalls, 1);
  assert.ok(!gainNode.connections.includes(destination));

  const stopped = await sandbox.stopWasapiOutputBridge();
  assert.strictEqual(stopped.ok, true);
  assert.strictEqual(sandbox.wasapiOutputActive, false);
  assert.strictEqual(sandbox.wasapiScriptNode, null);
  assert.strictEqual(state.closeCalls, 2);
  assert.ok(gainNode.connections.includes(destination));
});

test('WASAPI 运行中重开失败时先恢复 WebAudio，不留静音旁路', async () => {
  const { sandbox, state, openResolvers, gainNode, destination } = createWasapiSandbox({
    openPlan: ['defer', { ok: false, error: 'device busy' }],
  });
  const first = sandbox.startWasapiOutputBridge();
  await flushMicrotasks();
  openResolvers[0]({ ok: true, status: {} });
  assert.equal((await first).ok, true);
  assert.equal(sandbox.wasapiOutputActive, true);
  assert.ok(!gainNode.connections.includes(destination));

  const second = await sandbox.startWasapiOutputBridge();
  assert.equal(second.ok, false);
  assert.equal(second.error, 'device busy');
  assert.equal(sandbox.wasapiOutputActive, false);
  assert.equal(sandbox.wasapiScriptNode, null);
  assert.equal(sandbox.wasapiOutputDeviceGeneration, 0);
  assert.equal(state.closeCalls, 1);
  assert.ok(gainNode.connections.includes(destination));
});
