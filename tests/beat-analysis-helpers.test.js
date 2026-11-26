'use strict';

// 节拍分析的两个纯工具守：downsampleMono / concatFloat32。
//
// 2026-11-25 从 analyzeAudioBeats 的闭包里外提到顶层（原函数 1087 行，逐段拆分的第一步）。
// 外提必须行为不变，所以这里用固定向量钉死语义：
//   · downsampleMono：多声道先混单，目标率高于源率时原样返回并给出真实 rate；
//     否则按整数抽稀（decim = round(src/target)），输出长度 floor(len/decim)；
//   · concatFloat32：空 → null，单片 → 原引用，多片 → 顺序拼接并把输入槽位置空（省内存）。
// 这两个函数是所有节拍图（含长播客分段路径）的公共底座，改错会让拍点整体漂移。

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
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' 没有闭合');
}

function run(name, expr, ctx) {
  const sandbox = Object.assign({ console }, ctx || {});
  return vm.runInNewContext(extractFunction(name) + '\n' + expr, sandbox);
}

function fakeBuffer(channels, sampleRate) {
  const length = channels[0].length;
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    getChannelData: (i) => Float32Array.from(channels[i]),
  };
}

test('downsampleMono：目标率高于源率时只混单，不改速率', () => {
  const buf = fakeBuffer([[1, 0.5, -1], [0, 0.5, 1]], 22050);
  const out = run('downsampleMono', "downsampleMono(buf, 44100)", { buf });
  assert.equal(out.rate, 22050);
  assert.deepEqual(Array.from(out.pcm), [0.5, 0.5, 0]);
});

test('downsampleMono：抽稀按 round(src/target) 且所有声道一起平均', () => {
  // 48k -> 24k，decim=2；双声道 4 个采样 → 2 帧
  const buf = fakeBuffer([[1, 3, 5, 7], [1, 3, 5, 7]], 48000);
  const out = run('downsampleMono', "downsampleMono(buf, 24000)", { buf });
  assert.equal(out.rate, 24000);
  assert.deepEqual(Array.from(out.pcm), [2, 6]);
});

test('downsampleMono：样本不足一帧返回 null', () => {
  const buf = fakeBuffer([[1, 2]], 48000); // decim=2 → floor(2/2)=1 帧，ok
  assert.deepEqual(Array.from(run('downsampleMono', "downsampleMono(buf, 24000)", { buf }).pcm), [1.5]);
  const tiny = fakeBuffer([[1]], 48000); // floor(1/2)=0
  assert.equal(run('downsampleMono', "downsampleMono(tiny, 24000)", { tiny }), null);
});

test('concatFloat32：空/null、单片原引用、多片顺序拼接并置空输入', () => {
  assert.equal(run('concatFloat32', 'concatFloat32([])'), null);
  assert.equal(run('concatFloat32', 'concatFloat32(null)'), null);
  const one = [Float32Array.from([1, 2])];
  const single = run('concatFloat32', 'concatFloat32(parts)', { parts: one });
  assert.equal(single, one[0], '单片必须返回原引用，不复制');
  const parts = [Float32Array.from([1, 2]), Float32Array.from([3]), Float32Array.from([4, 5])];
  const merged = run('concatFloat32', 'concatFloat32(parts)', { parts });
  assert.deepEqual(Array.from(merged), [1, 2, 3, 4, 5]);
  assert.deepEqual(parts, [null, null, null], '拼接后必须置空输入槽位，否则分段路径会双倍占内存');
});
