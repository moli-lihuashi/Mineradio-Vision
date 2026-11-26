'use strict';

// 频带渲染 / 帧化能量守（renderBandEnergyOn / makeFrameEnergy）。
//
// 2026-11-25 从 analyzeAudioBeats 闭包外提：函数体逐字未改，依赖改为 deps 注入，
// 因此可以在 Node 里用假 OfflineAudioContext 真跑滤波链装配与 token 失效路径。
//
// 盯四件事：
//   ① 高切/低切按顺序串起来，截止频率必须夹在 sampleRate*0.45 以内；
//   ② 渲染后 token 失效 → 释放源节点并返回 null（不继续算包络）；
//   ③ 帧化能量按 win 整数分帧（忽略尾巴），值为 RMS；
//   ④ 长音轨每 520 帧让出主线程，且让出后 token 失效要中断。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public/js/modules/03-beat/01-audio-beat-analysis.js'),
  'utf8'
);

function extractFunction(name) {
  const start = source.indexOf('async function ' + name + '(');
  assert.notEqual(start, -1, 'missing ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' 没有闭合');
}

function load(name, extra) {
  const sandbox = Object.assign({ console: { warn() {}, log() {} }, Math, Float32Array }, extra || {});
  return vm.runInNewContext(extractFunction(name) + '\n' + name, sandbox);
}

test('makeFrameEnergy：按 win 整数分帧取 RMS，尾巴丢弃', async () => {
  const fn = load('makeFrameEnergy');
  const deps = { token: 1, beatMapToken: 1, yieldToPaint: async () => {} };
  const pcm = Float32Array.from([1, 1, 2, 2, 3]); // win=2 → 2 帧，末尾 3 丢弃
  const out = await fn(pcm, 2, deps);
  assert.deepEqual(Array.from(out), [1, 2]);
});

test('makeFrameEnergy：让出后 token 失效返回 null', async () => {
  const fn = load('makeFrameEnergy');
  let yields = 0;
  const deps = { token: 9, beatMapToken: 1, yieldToPaint: async () => { yields += 1; } };
  const pcm = new Float32Array(600 * 2).fill(1);
  const out = await fn(pcm, 2, deps);
  assert.equal(out, null, '第 520 帧让出后发现 token 变了必须中断');
  assert.equal(yields, 1);
});

function makeOfflineCtx(rendered) {
  const ctx = {
    calls: { filters: [], started: 0, connects: [] },
    destination: { name: 'destination' },
    createBufferSource() {
      return {
        buffer: null,
        connect(node) { ctx.calls.connects.push(['src', node.name || node.type || 'node']); },
        start() { ctx.calls.started += 1; },
      };
    },
    createBiquadFilter() {
      const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, name: 'filter' };
      f.connect = (node) => ctx.calls.connects.push([f.type, node.name || node.type || 'node']);
      ctx.calls.filters.push(f);
      return f;
    },
    async startRendering() { return rendered; },
  };
  return ctx;
}

test('renderBandEnergyOn：高切+低切串联，截止频率夹到 Nyquist*0.9', async () => {
  const fn = load('renderBandEnergyOn');
  const rendered = { getChannelData: () => Float32Array.from([1, 1, 1, 1]) };
  const off = makeOfflineCtx(rendered);
  const released = [];
  let frameArgs = null;
  const deps = {
    TmpCtx: function () { return off; },
    token: 1,
    beatMapToken: 1,
    releaseBandSrc: (src) => released.push(src),
    yieldToIdle: async () => {},
    beatAnalysisYieldMs: () => 0,
    options: {},
    makeFrameEnergy: async (pcm, win) => { frameArgs = { len: pcm.length, win }; return Float32Array.from([0.5]); },
  };
  const buf = { length: 4, sampleRate: 1000 };
  const out = await fn(buf, 900, 950, deps);
  assert.deepEqual(Array.from(out), [0.5]);
  assert.equal(off.calls.filters.length, 2);
  assert.equal(off.calls.filters[0].type, 'highpass');
  assert.equal(off.calls.filters[1].type, 'lowpass');
  assert.equal(off.calls.filters[0].frequency.value, 450, '900 > sampleRate*0.45，必须夹到 450');
  assert.equal(off.calls.filters[1].frequency.value, 450, '950 同样要夹');
  assert.equal(off.calls.started, 1);
  assert.equal(released.length, 1, '算完必须释放源节点对整轨 buffer 的引用');
  assert.deepEqual(frameArgs, { len: 4, win: 10 }, '帧窗 = floor(sampleRate*0.010)');
});

test('renderBandEnergyOn：渲染后 token 失效 → 释放并返回 null', async () => {
  const fn = load('renderBandEnergyOn');
  const off = makeOfflineCtx({ getChannelData: () => Float32Array.from([1]) });
  let released = 0;
  const deps = {
    TmpCtx: function () { return off; },
    token: 2,
    beatMapToken: 1,
    releaseBandSrc: () => { released += 1; },
    yieldToIdle: async () => {},
    beatAnalysisYieldMs: () => 0,
    options: {},
    makeFrameEnergy: async () => Float32Array.from([1]),
  };
  assert.equal(await fn({ length: 1, sampleRate: 48000 }, 38, 155, deps), null);
  assert.equal(released, 1);
});
