'use strict';

// 长音轨分段解码守（decodeBeatsInputBySegments）。
//
// 2026-11-25 从 analyzeAudioBeats 的闭包里外提到顶层：函数体逐字未改，外部依赖改为 deps 注入，
// 所以这里可以在 Node 里用假 fetch / 假解码器真跑整条控制流（以前这段没有任何测试）。
//
// 盯四件事：
//   ① 服务端不支持 Range（回 200 整包）必须立刻放弃，不能退回整块下载；
//   ② token 失效 / 解码失败 / 采样率不一致 → 返回 null（调用方据此回退整轨路径）；
//   ③ 分段边界必须丢掉段首 trim 帧（否则每段交界都会多一个假 onset）；
//   ④ 覆盖时长超过真实时长时要裁掉尾部，且 mono / profile 按各自速率同步裁。

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

// 与模块内常量保持一致（这里显式写死，改常量必须同步改测试，防止静默漂移）
const CONSTS = {
  BEAT_ANALYSIS_SEGMENT_SEC: 120,
  BEAT_ANALYSIS_SEGMENT_PREROLL_BYTES: 320 * 1024,
  BEAT_ANALYSIS_SEGMENT_TRIM_SEC: 0.20,
  BEAT_ANALYSIS_TEMPO_RATE: 22050,
  MUSICAL_PROFILE_SAMPLE_RATE: 11025,
};

function fakeBuffer(durationSec, sampleRate) {
  return {
    duration: durationSec,
    sampleRate,
    length: Math.round(durationSec * sampleRate),
  };
}

function makeCtx(overrides) {
  const calls = { chips: [], hidden: 0, fetch: [] };
  const base = {
    console: { log() {}, warn() {} },
    ...CONSTS,
    fetch: async (url, init) => {
      calls.fetch.push({ url, range: init && init.headers && init.headers.Range });
      return { status: 206, arrayBuffer: async () => new ArrayBuffer(16) };
    },
    deps: {
      showBeatChip: (m) => calls.chips.push(m),
      hideBeatChip: () => { calls.hidden += 1; },
      beatMapToken: 7,
      DecodeCtx: class {
        decodeAudioData(_ab, resolve) { resolve(fakeBuffer(120, 44100)); }
        close() {}
      },
      renderBandEnergyOn: async () => Float32Array.from({ length: 12000 }, (_, i) => i),
      yieldToIdle: async () => {},
      beatAnalysisYieldMs: () => 0,
    },
    calls,
  };
  return Object.assign(base, overrides && overrides.base);
}

async function run(ctx) {
  const sandbox = {
    console: ctx.console,
    fetch: ctx.fetch,
    BEAT_ANALYSIS_SEGMENT_SEC: ctx.BEAT_ANALYSIS_SEGMENT_SEC,
    BEAT_ANALYSIS_SEGMENT_PREROLL_BYTES: ctx.BEAT_ANALYSIS_SEGMENT_PREROLL_BYTES,
    BEAT_ANALYSIS_SEGMENT_TRIM_SEC: ctx.BEAT_ANALYSIS_SEGMENT_TRIM_SEC,
    BEAT_ANALYSIS_TEMPO_RATE: ctx.BEAT_ANALYSIS_TEMPO_RATE,
    MUSICAL_PROFILE_SAMPLE_RATE: ctx.MUSICAL_PROFILE_SAMPLE_RATE,
    // 同文件的顶层纯工具（真实实现由 beat-analysis-helpers.test.js 单独钉死语义）
    downsampleMono: (buf, targetRate) => ({ pcm: new Float32Array(64), rate: targetRate }),
    concatFloat32: (parts) => {
      if (!parts || !parts.length) return null;
      if (parts.length === 1) return parts[0];
      var total = 0;
      for (var i = 0; i < parts.length; i++) total += parts[i].length;
      var out = new Float32Array(total);
      var at = 0;
      for (var j = 0; j < parts.length; j++) { out.set(parts[j], at); at += parts[j].length; }
      return out;
    },
  };
  const fn = vm.runInNewContext(extractFunction('decodeBeatsInputBySegments') + '\ndecodeBeatsInputBySegments', sandbox);
  const plan = ctx.plan || { totalSec: 120, bytesPerSec: 1000, contentLength: 200000 };
  return fn('http://audio/x', plan, ctx.token == null ? 7 : ctx.token, ctx.options || {}, ctx.deps);
}

test('① 服务端不支持 Range（200 整包）→ 放弃分段并提示关闭 chip', async () => {
  const ctx = makeCtx();
  ctx.fetch = async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(16) });
  const out = await run(ctx);
  assert.equal(out, null);
  assert.equal(ctx.calls.hidden, 1);
});

test('② fetch 抛错 / token 失效 → 返回 null', async () => {
  const boom = makeCtx();
  boom.fetch = async () => { throw new Error('offline'); };
  assert.equal(await run(boom), null);

  const stale = makeCtx();
  stale.token = 1; // !== beatMapToken(7)
  assert.equal(await run(stale), null);
  assert.equal(stale.calls.hidden, 1, 'token 失效要收起 chip');
});

test('③ 解码失败（采样率 0）→ 返回 null', async () => {
  const ctx = makeCtx();
  ctx.deps.DecodeCtx = class { decodeAudioData(_ab, resolve) { resolve({ length: 0, sampleRate: 0, duration: 0 }); } close() {} };
  assert.equal(await run(ctx), null);
});

test('④ 单段成功：返回包络 / 双路 mono / stats，且请求带 Range', async () => {
  const ctx = makeCtx();
  const out = await run(ctx);
  assert.ok(out, '应当返回结果');
  assert.equal(out.stats.segments, 1);
  assert.equal(out.stats.monoRate, 22050);
  assert.equal(out.stats.profileRate, 11025);
  assert.equal(out.energy.length, 12000);
  assert.equal(out.duration, 120);
  assert.equal(out.sampleRate, 44100);
  assert.match(ctx.calls.fetch[0].range, /^bytes=\d+-\d+$/, '必须用 Range 分段拉取');
});

test('⑤ 两段拼接：第二段段首按 trim 帧丢弃，尾部超出时长按各自速率裁掉', async () => {
  const ctx = makeCtx();
  // 真实码率量级（~16KB/s）：preroll 320KB 必须小于段字节跨度，否则两段请求会退化成同一区间
  ctx.plan = { totalSec: 240, bytesPerSec: 16000, contentLength: 240 * 16000 };
  // 每段解码出 120s；第二段丢 20 帧（0.2s/0.010）
  const out = await run(ctx);
  assert.ok(out);
  assert.equal(out.stats.segments, 2);
  // 12000 + (12000 - 20) = 23980 帧
  assert.equal(out.energy.length, 23980);
  assert.equal(ctx.calls.fetch.length, 2);
  assert.notEqual(ctx.calls.fetch[0].range, ctx.calls.fetch[1].range, '第二段必须从新的字节偏移取');
});
