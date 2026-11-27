'use strict';

/* =============================================================================
 * 独立调音链回归测试（对标酷狗 EQSection / ReplayGainCalc / Balance / BQResampler fade）
 *
 * 四项能力：10 段 EQ + 前级增益、ReplayGain 响度对齐、左右声道平衡、换源/跳转防爆音。
 * 全部走独立节点链，绝不写 gainNode（音量/播放暂停淡变/曲末淡出/Cuefield A deck 都在它上面）。
 *
 * 这里把 01-audio-tuning.js 整份真实源码放进 vm 沙箱跑，用可控 AudioParam、
 * 假定时器与 DOM 桩验证行为，不是重写一遍逻辑。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const tuningPath = path.join(appRoot, 'public', 'js', 'modules', '04-mood', '01-audio-tuning.js');
const graphPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '08-audio-graph-controls.js');
const startPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const htmlPath = path.join(appRoot, 'public', 'index.html');
const cssPath = path.join(appRoot, 'public', 'css', '10-shell', 'shell.css');
const localLibPath = path.join(appRoot, 'desktop', 'local-music-library.js');
const cuefieldIntegrationPath = path.join(appRoot, 'public', 'js', 'modules', '05-cuefield', '02-cuefield-automix-integration.js');

const tuningSource = fs.readFileSync(tuningPath, 'utf8');
const graphSource = fs.readFileSync(graphPath, 'utf8');
const startSource = fs.readFileSync(startPath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const localLibSource = fs.readFileSync(localLibPath, 'utf8');
const cuefieldIntegrationSource = fs.readFileSync(cuefieldIntegrationPath, 'utf8');

const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function makeParam(initial) {
  const p = {
    value: initial,
    calls: [],
    cancelScheduledValues(t) { p.calls.push(['cancel', t]); },
    setValueAtTime(v, t) { p.calls.push(['setValue', v, t]); p.value = v; },
    linearRampToValueAtTime(v, t) { p.calls.push(['ramp', v, t]); p.value = v; },
    setTargetAtTime(v, t, c) { p.calls.push(['setTarget', v, t, c]); },
    setValueCurveAtTime(c, t, d) { p.calls.push(['curve', t, d]); },
  };
  return p;
}

function makeNode(kind, extra) {
  const n = Object.assign({
    kind,
    outs: [],
    connect(dest) { n.outs.push(dest); return dest; },
    disconnect(dest) {
      if (dest === undefined) { n.outs.length = 0; return; }
      const i = n.outs.indexOf(dest);
      if (i >= 0) n.outs.splice(i, 1);
    },
  }, extra || {});
  return n;
}

function createSandbox(overrides) {
  const o = overrides || {};
  const store = Object.assign({}, o.storage || {});
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
  };

  // ---- 可控假定时器：RMS 采样与防爆音超时都要能确定性推进 ----
  let nowMs = 0;
  let nextTimerId = 1;
  const timers = new Map();
  function fakeSetTimeout(fn, ms) {
    const id = nextTimerId++;
    timers.set(id, { fn, at: nowMs + (Number(ms) || 0) });
    return id;
  }
  function fakeClearTimeout(id) { timers.delete(id); }
  function advance(ms) {
    const target = nowMs + Number(ms || 0);
    for (;;) {
      let dueId = null;
      let due = null;
      for (const [id, t] of timers) {
        if (t.at > target) continue;
        if (!due || t.at < due.at) { dueId = id; due = t; }
      }
      if (!due) break;
      timers.delete(dueId);
      nowMs = due.at;
      due.fn();
    }
    nowMs = target;
  }

  // ---- AudioContext 桩 ----
  const created = { biquad: [], gain: [], panner: [], compressor: [], analyser: [], splitter: [], merger: [], delay: [], waveshaper: [] };
  const meter = {
    kind: 'analyser',
    fftSize: 2048,
    smoothingTimeConstant: 0,
    byteValue: o.rmsByte == null ? 160 : o.rmsByte,
    outs: [],
    connect(d) { return d; },
    disconnect() {},
    getByteTimeDomainData(buf) { buf.fill(this.byteValue); },
  };
  const ctx = {
    sampleRate: o.sampleRate == null ? 44100 : o.sampleRate,
    currentTime: 0,
    createBiquadFilter() {
      const n = makeNode('biquad', {
        type: '', frequency: makeParam(0), Q: makeParam(1), gain: makeParam(0),
      });
      created.biquad.push(n);
      return n;
    },
    createGain() {
      const n = makeNode('gain', { gain: makeParam(1) });
      created.gain.push(n);
      return n;
    },
    createStereoPanner: o.noPanner ? undefined : function () {
      const n = makeNode('panner', { pan: makeParam(0) });
      created.panner.push(n);
      return n;
    },
    createDynamicsCompressor: o.noCompressor ? undefined : function () {
      const n = makeNode('compressor', {
        threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12),
        attack: makeParam(0.003), release: makeParam(0.25),
      });
      created.compressor.push(n);
      return n;
    },
    createAnalyser() { created.analyser.push(meter); return meter; },
    /* 立体环绕级用到这三个：桩要跟真 Web Audio 一样能建出来，
       否则整条链的既有断言会因为「ctx 缺方法」而不是「实现错了」失败。 */
    createChannelSplitter() {
      const n = makeNode('splitter', {});
      created.splitter.push(n);
      return n;
    },
    createChannelMerger() {
      const n = makeNode('merger', {});
      created.merger.push(n);
      return n;
    },
    createDelay() {
      const n = makeNode('delay', { delayTime: makeParam(0) });
      created.delay.push(n);
      return n;
    },
    /* 虚拟低音的谐波支路要用到：不给桩会让整条 install 抛错，
       失败原因就变成「ctx 缺方法」而不是「实现错了」。 */
    createWaveShaper: o.noShaper ? undefined : function () {
      const n = makeNode('waveshaper', { curve: null, oversample: 'none' });
      created.waveshaper.push(n);
      return n;
    },
  };
  const input = makeNode('input');

  // ---- DOM 桩 ----
  const presetButtons = ['flat', 'pop', 'rock', 'vocal'].map((name) => ({
    attrs: { 'data-preset': name },
    classList: { toggle(k, on) { this['_' + k] = !!on; } },
    getAttribute(k) { return this.attrs[k]; },
  }));
  const elements = Object.create(null);
  function uiEl() {
    return {
      value: '', textContent: '', innerHTML: '', attrs: Object.create(null),
      _listeners: Object.create(null),
      classList: { toggle(k, on) { this['_' + k] = !!on; } },
      getAttribute(k) { return this.attrs[k]; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
      removeEventListener() {},
      querySelectorAll() { return presetButtons; },
      fire(name, event) { (this._listeners[name] || []).slice().forEach((fn) => fn(event)); },
    };
  }
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) {
      if (!elements[id]) elements[id] = uiEl();
      return elements[id];
    },
  };

  const media = {
    _listeners: Object.create(null),
    addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = this._listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(name) { (this._listeners[name] || []).slice().forEach((fn) => fn({ type: name })); },
  };

  const sandbox = {
    localStorage,
    document,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(tuningSource, sandbox, { filename: '01-audio-tuning.js' });
  const api = sandbox.Mineradio.audioTuning;
  return {
    sandbox, api, ctx, input, media, store, created, meter, elements, presetButtons,
    advance,
    pendingTimers: () => timers.size,
    install: () => api.install(ctx, input),
  };
}

function chainOf(s) { return s.api._test.getChain(); }

// =============================================================================
// A. 节点链结构
// =============================================================================

test('A1 install 建出 10 段 EQ，频点与酷狗 EQGain0..9 对齐，含 Nyquist 保护', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  assert.equal(c.eq.length, 10);
  // 数组来自 vm 沙箱，先转回主 realm 再 deepStrictEqual（跨 realm 原型不同）
  assert.deepEqual(Array.from(c.eq, (f) => f.frequency.value), EQ_BANDS);
  assert.equal(c.eq[0].type, 'lowshelf');
  assert.equal(c.eq[9].type, 'highshelf');
  for (let i = 1; i < 9; i++) assert.equal(c.eq[i].type, 'peaking');
  assert.ok(c.eq.every((f) => f.Q.value === 1));
});

test('A2 链路顺序 input→EQ→preamp→loudness→环绕→limiter→antiClick→panner→exit', () => {
  const s = createSandbox();
  const exit = s.install();
  const c = chainOf(s);
  assert.ok(s.input.outs.includes(c.eq[0]), '首段要接在 input 上');
  for (let i = 0; i < 9; i++) assert.ok(c.eq[i].outs.includes(c.eq[i + 1]));
  assert.ok(c.eq[9].outs.includes(c.preamp));
  assert.ok(c.preamp.outs.includes(c.loudness));
  /* 2026-11-26 起 loudness 与 limiter 之间多了立体环绕级（M/S + 侧声道反射）：
     宽度拉满多出来的峰值必须先过限幅器，所以环绕在 limiter 之前。 */
  const surroundSplitter = c.loudness.outs.find((n) => n && n.kind === 'splitter');
  assert.ok(surroundSplitter, '响度之后应先进入环绕级的声道拆分');
  const surroundMerger = c.surround.nodes.find((n) => n.kind === 'merger');
  assert.ok(surroundMerger, '环绕级必须有声道合并');
  /* 2026-11-26：合并之后还多了一级低音补偿（lowshelf），再进限幅器 */
  assert.ok(surroundMerger.outs.includes(c.surround.bassComp), '合流后接低音补偿');
  /* 2026-11-27：补偿之后又多了两级 —— 先并联虚拟低音（求和节点），再进 3D 丽音 */
  assert.ok(c.vbs && c.vbs.sum, '链上必须有虚拟低音的求和节点');
  assert.ok(c.surround.bassComp.outs.includes(c.vbs.sum), '低音补偿后先进虚拟低音的求和节点');
  assert.ok(c.surround.bassComp.outs.includes(c.vbs.lowpass), '同时分出一路去造谐波');
  assert.ok(c.vbs.sum.outs.some((n) => n && n.kind === 'splitter'), '求和之后进 3D 级');
  assert.ok(c.haas && c.haas.merger, '链上必须有 3D 丽音级');
  assert.ok(c.haas.merger.outs.includes(c.safetyLimiter), '3D 级合流后进限幅器');
  assert.ok(c.safetyLimiter.outs.includes(c.antiClick), '防爆音必须在 limiter 之后');
  assert.ok(c.antiClick.outs.includes(c.panner));
  assert.equal(exit, c.panner);
  assert.equal(c.exit, exit);
});

test('A3 RMS 测量旁路挂在链【之前】，避免响度增益自激正反馈', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  assert.ok(s.input.outs.includes(c.meter));
  assert.ok(!c.loudness.outs.includes(c.meter));
  assert.ok(!c.safetyLimiter.outs.includes(c.meter));
  assert.equal(c.meter.fftSize, 2048);
});

test('A4 软限幅只在 -1dB 以上动作，防止响度对齐提升削波', () => {
  const s = createSandbox();
  s.install();
  const lim = chainOf(s).safetyLimiter;
  assert.equal(lim.threshold.value, -1);
  assert.equal(lim.ratio.value, 20);
  assert.equal(lim.knee.value, 0);
});

test('A5 install 幂等：同 ctx/input 二次调用不重建任何节点', () => {
  const s = createSandbox();
  const first = s.install();
  const before = s.created.biquad.length;
  const beforeGain = s.created.gain.length;
  const second = s.install();
  assert.equal(second, first);
  assert.equal(s.created.biquad.length, before);
  assert.equal(s.created.gain.length, beforeGain); // 二次调用不能再建 gain（环绕级也含 gain）
});

test('A6 换源重建音频图时只重接首段，不重建整链', () => {
  const s = createSandbox();
  const exit = s.install();
  const c = chainOf(s);
  const newInput = makeNode('input2');
  const again = s.api.install(s.ctx, newInput);
  assert.equal(again, exit);
  assert.equal(chainOf(s), c);
  assert.equal(s.created.biquad.length, 17); // 10 段 EQ + 环绕反射 highpass + 低音补偿 lowshelf + 3D 两路 highpass + 虚拟低音三只滤波器
  assert.ok(!s.input.outs.includes(c.eq[0]), '旧 input 到首段的连边要断掉');
  assert.ok(!s.input.outs.includes(c.meter), '旧 input 到 meter 的连边要断掉');
  assert.ok(newInput.outs.includes(c.eq[0]));
  assert.ok(newInput.outs.includes(c.meter));
});

test('A7 detach 清掉 input 首段 / meter 连边与所有节点输出', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  s.api.detach();
  assert.equal(s.api._test.getChain(), null);
  assert.ok(!s.input.outs.includes(c.eq[0]));
  assert.ok(!s.input.outs.includes(c.meter));
  assert.equal(c.eq[0].outs.length, 0);
  assert.equal(c.antiClick.outs.length, 0);
});

test('A8 没有 StereoPanner / DynamicsCompressor 时链路仍完整降级', () => {
  const s = createSandbox({ noPanner: true, noCompressor: true });
  const exit = s.install();
  const c = chainOf(s);
  assert.equal(c.panner, null);
  assert.equal(c.safetyLimiter, null);
  assert.equal(exit, c.antiClick);
  const merger = c.surround.nodes.find((n) => n.kind === 'merger');
  assert.ok(c.loudness.outs.some((n) => n && n.kind === 'splitter'), '响度先进环绕级');
  assert.ok(merger && merger.outs.includes(c.surround.bassComp), '合流后接低音补偿');
  assert.ok(c.haas && c.haas.merger.outs.includes(c.antiClick), '没有压缩器时 3D 级直连 antiClick');
  assert.equal(s.api.getStatus().hasPanner, false);
  assert.equal(s.api.getStatus().hasLimiter, false);
  assert.equal(s.api.getStatus().eqBands, 10);
});

test('A9 Nyquist guard：低采样率下 16k 频点被夹到合法范围', () => {
  const s = createSandbox({ sampleRate: 22050 });
  s.install();
  const freqs = chainOf(s).eq.map((f) => f.frequency.value);
  assert.equal(freqs[9], 10825); // 22050/2 - 200
  assert.equal(freqs[8], 8000);
});

test('A10 initAudio 每次 new AudioContext：ctx 变化时先拆旧链再建，避免泄漏', () => {
  const s = createSandbox();
  s.install();
  const oldChain = chainOf(s);
  const newCtx = Object.assign({}, s.ctx, { currentTime: 1 });
  const newInput = makeNode('input2');
  s.api.install(newCtx, newInput);
  const fresh = chainOf(s);
  assert.notEqual(fresh, oldChain);
  assert.ok(!s.input.outs.includes(oldChain.eq[0]), '旧 input 的首段连边要断掉');
  assert.ok(!s.input.outs.includes(oldChain.meter), '旧 meter 连边要断掉');
  assert.equal(oldChain.eq[0].outs.length, 0, '旧链节点输出要清空');
  assert.equal(s.created.biquad.length, 34, '两条链各 10 段 EQ + 环绕 highpass + 低音补偿 + 3D 两路 highpass + 虚拟低音三只滤波器');
  assert.ok(newInput.outs.includes(fresh.eq[0]));
});

// =============================================================================
// B. 参数、预设与持久化
// =============================================================================

test('B1 默认设置：三段开关全开、EQ 全 0、前级 0dB、平衡居中', () => {
  const s = createSandbox();
  const st = s.api.getSettings();
  assert.equal(st.eqEnabled, true);
  assert.equal(st.replayGainEnabled, true);
  assert.equal(st.antiClickEnabled, true);
  assert.deepEqual(Array.from(st.eq), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(st.preampDb, 0);
  assert.equal(st.balance, 0);
  assert.equal(st.preset, 'flat');
});

test('B2 setPreset 把 10 段增益写进 BiquadFilter 并落盘', () => {
  const s = createSandbox();
  s.install();
  s.api.setPreset('rock');
  const c = chainOf(s);
  assert.deepEqual(Array.from(c.eq, (f) => f.gain.value), [4, 3, 1, -2, -3, 1, 3, 4, 4, 3]);
  assert.equal(s.api.getSettings().preset, 'rock');
  const saved = JSON.parse(s.store['mineradio-audio-tuning-v1']);
  assert.deepEqual(Array.from(saved.eq), [4, 3, 1, -2, -3, 1, 3, 4, 4, 3]);
  assert.equal(saved.preset, 'rock');
  s.api.setPreset('pop');
  assert.deepEqual(Array.from(c.eq, (f) => f.gain.value), [-1, 1, 3, 4, 2, -1, -1, 1, 3, 3]);
  s.api.setPreset('vocal');
  assert.deepEqual(Array.from(c.eq, (f) => f.gain.value), [-2, -1, 0, 1, 3, 5, 4, 2, 0, -1]);
});

test('B3 拖 EQ 后 preset=custom，刷新回读仍是 custom 而不是显示「平坦」', () => {
  const s = createSandbox();
  s.install();
  const rows = s.elements['audio-tuning-eq-rows'];
  rows.fire('input', { target: { getAttribute: () => '2', value: '7.5' } });
  assert.equal(s.api.getSettings().eq[2], 7.5);
  assert.equal(s.api.getSettings().preset, 'custom');
  const saved = s.store['mineradio-audio-tuning-v1'];
  const s2 = createSandbox({ storage: { 'mineradio-audio-tuning-v1': saved } });
  assert.equal(s2.api.getSettings().preset, 'custom');
  assert.equal(s2.api.getSettings().eq[2], 7.5);
  s2.install();
  assert.equal(chainOf(s2).eq[2].gain.value, 7.5);
});

test('B4 eqEnabled=false 时 10 段归零、前级归 1，重开能恢复曲线', () => {
  const s = createSandbox();
  s.install();
  s.api.setPreset('rock');
  s.sandbox.toggleAudioTuningEq();
  const c = chainOf(s);
  assert.ok(c.eq.every((f) => f.gain.value === 0));
  assert.equal(c.preamp.gain.value, 1);
  s.sandbox.toggleAudioTuningEq();
  assert.deepEqual(Array.from(c.eq, (f) => f.gain.value), [4, 3, 1, -2, -3, 1, 3, 4, 4, 3]);
});

test('B5 前级增益走 dB→linear，平衡映射 -100..100 → -1..1', () => {
  const s = createSandbox();
  s.install();
  const preamp = s.elements['at-preamp'];
  preamp.fire('input', { target: { value: '3' } });
  assert.ok(Math.abs(chainOf(s).preamp.gain.value - Math.pow(10, 3 / 20)) < 1e-9);
  const balance = s.elements['at-balance'];
  balance.fire('input', { target: { value: '-50' } });
  assert.equal(chainOf(s).panner.pan.value, -0.5);
  balance.fire('input', { target: { value: '100' } });
  assert.equal(chainOf(s).panner.pan.value, 1);
});

test('B6 越界输入被 clamp，不会把非法值写进 AudioParam', () => {
  const s = createSandbox();
  s.install();
  const rows = s.elements['audio-tuning-eq-rows'];
  rows.fire('input', { target: { getAttribute: () => '0', value: '999' } });
  assert.equal(s.api.getSettings().eq[0], 12);
  s.elements['at-preamp'].fire('input', { target: { value: '-999' } });
  assert.equal(s.api.getSettings().preampDb, -12);
  s.elements['at-balance'].fire('input', { target: { value: '999' } });
  assert.equal(s.api.getSettings().balance, 1);
  assert.equal(s.api._test.dbToLinear(-12).toFixed(4), '0.2512');
});

test('B7 绝不调用 setTargetAtTime（上一轮淡变失效的根因）', () => {
  const s = createSandbox();
  s.install();
  s.api.setPreset('rock');
  s.api.onTrackChanged({ replayGainTrackDb: -4 });
  s.api.applyAll();
  const c = chainOf(s);
  const params = Array.from(c.eq, (f) => f.gain)
    .concat([c.preamp.gain, c.loudness.gain, c.panner.pan]);
  for (const p of params) {
    assert.ok(!p.calls.some((call) => call[0] === 'setTarget'), '出现永不结束的自动化');
    assert.ok(p.calls.some((call) => call[0] === 'cancel'), '每次写入前必须清旧排程');
  }
  // antiClick 在 install 时是直接写 .value（无排程）；短淡变期间同样走 setParam
  assert.ok(!c.antiClick.gain.calls.some((call) => call[0] === 'setTarget'));
  s.api.bindMedia(s.media);
  s.media.fire('seeking');
  assert.ok(c.antiClick.gain.calls.some((call) => call[0] === 'cancel'));
  assert.ok(!c.antiClick.gain.calls.some((call) => call[0] === 'setTarget'));
});

test('B8 buildUi 生成 10 行 EQ 控件并同步数值标签', () => {
  const s = createSandbox();
  const html = s.elements['audio-tuning-eq-rows'].innerHTML;
  for (let i = 0; i < 10; i++) {
    assert.ok(html.includes('id="at-eq-' + i + '"'));
    assert.ok(html.includes('data-band="' + i + '"'));
    assert.ok(html.includes('at-eq-v-' + i));
  }
  assert.equal(s.elements['audio-tuning-eq-rows'].getAttribute('data-built'), '1');
});

// =============================================================================
// C. ReplayGain 响度对齐
// =============================================================================

test('C1 有 ReplayGain tag 时直接用标签，字符串 / 数字 / {dB} 都能吃', () => {
  const s = createSandbox();
  s.install();
  assert.equal(s.api.onTrackChanged({ replayGainTrackDb: '-4.5 dB' }), -4.5);
  assert.ok(Math.abs(chainOf(s).loudness.gain.value - Math.pow(10, -4.5 / 20)) < 1e-9);
  assert.equal(s.api.onTrackChanged({ replayGainTrackGain: 3 }), 3);
  assert.equal(s.api.onTrackChanged({ replayGainTrackGain: { dB: -2 } }), -2);
  assert.equal(s.api._test.parseGainDb('bogus'), null);
});

test('C2 标签超过 ±6dB 会被限幅，避免与 EQ 叠加后削波', () => {
  const s = createSandbox();
  s.install();
  s.api.onTrackChanged({ replayGainTrackDb: '-20' });
  assert.equal(s.api.getStatus().appliedDb, -6);
  s.api.onTrackChanged({ replayGainTrackDb: '+20' });
  assert.equal(s.api.getStatus().appliedDb, 6);
});

test('C3 有标签时不启动采样，无标签时 playing 后做短窗 RMS 自适应', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({ replayGainTrackDb: -3 });
  s.media.fire('playing');
  assert.equal(s.pendingTimers(), 0, '有标签就不该采样');
  assert.equal(s.api.getStatus().measured, true);

  const s2 = createSandbox({ rmsByte: 160 });
  s2.install();
  s2.api.bindMedia(s2.media);
  s2.api.onTrackChanged({ name: '在线音源' });
  assert.equal(s2.api.getStatus().metaDb, null);
  s2.media.fire('playing');
  assert.ok(s2.pendingTimers() > 0, '无标签要起采样');
  s2.advance(2500);
  assert.equal(s2.api.getStatus().measured, true);
  assert.equal(s2.api.getStatus().samples, 10);
  // 160 → v=0.25 → rmsDb≈-12.04 → -18-(-12.04)≈-5.96
  assert.ok(Math.abs(s2.api.getStatus().appliedDb - (-5.96)) < 0.05);
});

test('C4 极轻音源的自适应结果被 clamp 到 +6dB', () => {
  const s = createSandbox({ rmsByte: 129 });
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({});
  s.media.fire('playing');
  s.advance(2500);
  assert.equal(s.api.getStatus().appliedDb, 6);
});

test('C5 换歌后旧采样作废，不会用上一首的 RMS 覆盖新曲', () => {
  const s = createSandbox({ rmsByte: 160 });
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({});
  s.media.fire('playing');
  s.advance(600); // 采了 2 个样本
  const before = s.api.getStatus().samples;
  assert.ok(before > 0);
  s.api.onTrackChanged({ name: '下一首' }); // session 推进
  s.advance(3000);
  assert.equal(s.api.getStatus().samples, 0, '旧 session 的采样不能写进新曲');
  assert.equal(s.api.getStatus().appliedDb, 0);
  assert.equal(s.api.getStatus().measured, false);
});

test('C6 loadstart / emptied 换 CDN 源保留 ReplayGain 元数据', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({ replayGainTrackDb: -4.5 });
  assert.equal(s.api.getStatus().appliedDb, -4.5);
  s.media.fire('loadstart');
  assert.equal(s.api.getStatus().metaDb, -4.5);
  assert.equal(s.api.getStatus().appliedDb, -4.5, '换源不能把刚注入的增益清成 0');
  s.media.fire('emptied');
  assert.equal(s.api.getStatus().appliedDb, -4.5);
});

test('C7 关闭响度对齐后 loudness 恒为 1，且不再采样', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({ replayGainTrackDb: -5 });
  s.sandbox.toggleAudioTuningReplayGain();
  assert.equal(chainOf(s).loudness.gain.value, 1);
  s.api.onTrackChanged({ replayGainTrackDb: -5 });
  assert.equal(chainOf(s).loudness.gain.value, 1);
  s.media.fire('playing');
  assert.equal(s.pendingTimers(), 0);
});

// =============================================================================
// D. 换源 / 跳转防爆音
// =============================================================================

test('D1 seeking 8ms 淡出、seeked/playing 12ms 淡入', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  const g = chainOf(s).antiClick.gain;
  s.media.fire('seeking');
  assert.equal(g.value, 0);
  const outCall = g.calls.filter((c) => c[0] === 'ramp').pop();
  assert.equal(outCall[2], 0.008);
  s.media.fire('seeked');
  assert.equal(g.value, 1);
  const inCall = g.calls.filter((c) => c[0] === 'ramp').pop();
  assert.equal(inCall[2], 0.012);
});

test('D2 900ms 超时兜底：换源后等不到 playing 也不会一直静音', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({});
  s.media.fire('loadstart');
  assert.equal(chainOf(s).antiClick.gain.value, 0);
  s.advance(899);
  assert.equal(chainOf(s).antiClick.gain.value, 0);
  s.advance(2);
  assert.equal(chainOf(s).antiClick.gain.value, 1);
});

test('D3 关掉防爆音后 seeking 不改 gain；关的瞬间会强制恢复 1', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.sandbox.toggleAudioTuningAntiClick();
  s.media.fire('seeking');
  assert.equal(chainOf(s).antiClick.gain.value, 1);
});

test('D4 拖 EQ / 改前级时 applyAll 不把正在淡出的防爆音拉回 1', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.media.fire('seeking');
  assert.equal(chainOf(s).antiClick.gain.value, 0);
  s.api.setPreset('rock');   // 触发 applyAll
  s.elements['at-preamp'].fire('input', { target: { value: '2' } });
  assert.equal(chainOf(s).antiClick.gain.value, 0, '防爆音是独立短事件，不能被 EQ 同步打断');
});

test('D5 会话切换后旧防爆音超时不再动新曲的 gain', () => {
  const s = createSandbox();
  s.install();
  s.api.bindMedia(s.media);
  s.api.onTrackChanged({});
  s.media.fire('seeking');
  assert.equal(chainOf(s).antiClick.gain.value, 0);
  s.api.onTrackChanged({ name: '下一首' });
  s.media.fire('seeked'); // 新曲立刻恢复
  assert.equal(chainOf(s).antiClick.gain.value, 1);
  s.advance(1200);
  assert.equal(chainOf(s).antiClick.gain.value, 1);
});

// =============================================================================
// E. 接线与不回归边界（真实源码静态断言）
// =============================================================================

test('E1 index.html 挂载模块并具备全部 UI 载体', () => {
  assert.ok(htmlSource.includes('js/modules/04-mood/01-audio-tuning.js'));
  const ids = [
    'audio-tuning-fold', 'audio-tuning-summary', 'audio-tuning-eq-toggle',
    'audio-tuning-replaygain-toggle', 'audio-tuning-anticlick-toggle',
    'audio-tuning-presets', 'audio-tuning-eq-rows',
    'at-preamp', 'at-preamp-v', 'at-balance', 'at-balance-v',
    'audio-tuning-haas-body', 'audio-tuning-haas-toggle', 'audio-tuning-haas-sliders',
    'at-haas-mix', 'at-haas-mix-v', 'at-haas-delay', 'at-haas-delay-v',
  ];
  for (const id of ids) assert.ok(htmlSource.includes('id="' + id + '"'), '缺少 ' + id);
  for (const p of ['flat', 'pop', 'rock', 'vocal', 'live3d']) {
    assert.ok(htmlSource.includes('data-preset="' + p + '"'), '缺少预设 ' + p);
  }
  assert.ok(htmlSource.includes('toggleAudioTuningEq()'));
  assert.ok(htmlSource.includes('toggleAudioTuningHaas()'));
  assert.ok(htmlSource.includes('toggleAudioTuningReplayGain()'));
  assert.ok(htmlSource.includes('toggleAudioTuningAntiClick()'));
});

test('E2 音频图在 moodExit 与 gainNode 之间安装调音链，且顺序正确', () => {
  const installAt = graphSource.indexOf('Mineradio.audioTuning.install(audioCtx, audioTap)');
  const connectGainAt = graphSource.indexOf('audioTap.connect(gainNode)');
  const tapAt = graphSource.indexOf('var audioTap = moodExit || source');
  assert.ok(installAt > 0, '没有调用 install');
  assert.ok(tapAt < installAt && installAt < connectGainAt, '调音链必须插在 tap 与 gainNode 之间');
  assert.ok(graphSource.includes('Mineradio.audioTuning.bindMedia(audio)'));
});

test('E3 切歌链路调用 onTrackChanged 注入曲目 ReplayGain', () => {
  assert.ok(startSource.includes("audio-tuning-track"));
  assert.ok(startSource.includes('Mineradio.audioTuning.onTrackChanged(song)'));
  const songAt = startSource.indexOf('var song = safePlaybackStep(');
  const tuneAt = startSource.indexOf('Mineradio.audioTuning.onTrackChanged(song)');
  assert.ok(songAt > 0 && tuneAt > songAt, '必须在 song 就绪之后调用');
});

test('E4 本地文件库透传 ReplayGain tag，且兼容多种 tag 形态', () => {
  assert.ok(localLibSource.includes('function readReplayGainTrackDb(metadata)'));
  assert.ok(localLibSource.includes('function parseReplayGainDb(value)'));
  assert.ok(localLibSource.includes('replayGainTrackDb: parseReplayGainDb(record.replayGainTrackDb)'));
  assert.ok(localLibSource.includes('replayGainTrackGain'));
  assert.ok(localLibSource.includes('track[_ ]?gain'), 'native tag 的 REPLAYGAIN_TRACK_GAIN 兜底');
});

test('E5 CSS 提供 10 段 EQ 行与折叠面板样式', () => {
  assert.ok(cssSource.includes('.at-control-row{'));
  assert.ok(cssSource.includes('.audio-tuning-fold > summary'));
  assert.ok(cssSource.includes('.audio-tuning-presets button.active'));
  assert.ok(cssSource.includes('.audio-tuning-hint'));
});

test('E6 Cuefield AutoMix 不被本轮改动碰，gainNode 淡变基础层保持原样', () => {
  assert.ok(!cuefieldIntegrationSource.includes('audioTuning'), 'Cuefield 集成层不应引用调音链');
  // 08 里本次只新增 install/bindMedia，原有淡变 API 全部保留
  for (const fn of [
    'function writeAudioOutputGain', 'function buildAudioFadeCurve',
    'function rampAudioOutputGain', 'function scheduleTrackEndFade',
    'function cancelTrackEndFade',
  ]) assert.ok(graphSource.includes(fn), '淡变基础层丢失 ' + fn);
  assert.ok(graphSource.includes('gainNode.gain.setValueCurveAtTime('), '等功率曲线不能回退');
});

// =============================================================================
// B. 立体环绕：UI 开关 → 节点增益 这条路径必须真的通
//    （用户实测「开了没区别」，先排除「点开关根本没写到节点上」）
// =============================================================================
test('B1 点开关后，环绕节点的宽度/反射增益真的变了', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  assert.ok(c.surround, '链上必须有环绕级');

  // 开关默认关：中性
  assert.equal(c.surround.width.gain.value, 1);
  assert.equal(c.surround.g1.gain.value, 0);
  assert.equal(c.surround.g2.gain.value, 0);

  // 走 UI 同一条路径
  s.sandbox.toggleAudioTuningSurround();

  const sur = s.api.getSurround();
  assert.equal(sur.enabled, true, '开关要打开');
  assert.equal(sur.width, 1.3, '中性参数下打开时给默认宽度 130%');
  assert.equal(sur.ambience, 0.12, '中性参数下打开时给默认反射 12%');
  assert.equal(c.surround.width.gain.value, 1.3, '宽度增益必须写到节点上');
  assert.ok(Math.abs(c.surround.g1.gain.value - 0.55 * 0.12) < 1e-6, '反射 1 路增益 0.55×ambience');
  assert.ok(Math.abs(c.surround.g2.gain.value - 0.35 * 0.12) < 1e-6, '反射 2 路增益 0.35×ambience');
});

test('B2 再次关掉要回到严格中性', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  s.sandbox.toggleAudioTuningSurround();
  s.sandbox.toggleAudioTuningSurround();
  assert.equal(s.api.getSurround().enabled, false);
  assert.equal(c.surround.width.gain.value, 1, '关闭必须回 1（M/S 重建才是恒等）');
  assert.equal(c.surround.g1.gain.value, 0);
  assert.equal(c.surround.g2.gain.value, 0);
});

test('B3 setSurround 会夹住越界值', () => {
  const s = createSandbox();
  s.install();
  s.api.setSurround({ enabled: true, width: 9, ambience: 5 });
  const sur = s.api.getSurround();
  assert.equal(sur.width, 2, '宽度上限 200%');
  assert.equal(sur.ambience, 1, '反射上限 100%');
});

// =============================================================================
// C. 中置分离（人声 / 伴奏双推子）
// =============================================================================
test('C1 默认严格中性：mid/side = 1，低音补偿 0dB', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  assert.equal(c.surround.midGain.gain.value, 1);
  assert.equal(c.surround.sideGain.gain.value, 1);
  assert.equal(c.surround.bassComp.gain.value, 0, 'mid=100% 时不能有低频补偿');
});

test('C2 拉人声到 0：mid 增益归零，并补 +4dB 低频', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  s.api.setCenter({ mid: 0 });
  assert.equal(c.surround.midGain.gain.value, 0);
  assert.equal(c.surround.sideGain.gain.value, 1, '拉人声不该动伴奏');
  assert.equal(c.surround.bassComp.gain.value, 4, 'mid=0 时低音补偿 +4dB');
});

test('C3 拉伴奏到 0：side 增益归零，人声不动', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  s.api.setCenter({ side: 0 });
  assert.equal(c.surround.sideGain.gain.value, 0);
  assert.equal(c.surround.midGain.gain.value, 1);
});

test('C4 setCenter 夹住越界值，且与 setSurround 互不干扰', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  s.api.setCenter({ mid: 9, side: -3 });
  const cen = s.api.getCenter();
  assert.equal(cen.mid, 2, '人声上限 200%');
  assert.equal(cen.side, 0, '伴奏下限 0%');
  s.api.setSurround({ enabled: true, width: 1.6, ambience: 0.3 });
  assert.equal(s.api.getCenter().mid, 2, 'setSurround 不能改写人声推子');
  assert.equal(c.surround.midGain.gain.value, 2);
});

// =============================================================================
// D. 拖动推子不能压死主线程：input 必须走节流，且不做同步落盘
// =============================================================================
test('D1 空间推子的 input 处理不再同步写盘 / 全量刷新', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/modules/04-mood/01-audio-tuning.js'), 'utf8');
  const bind = src.slice(src.indexOf('function bindSpatialSlider'), src.indexOf("bindSpatialSlider('at-center-mid'"));
  assert.ok(bind.includes('scheduleApply()'), '音频写入要走每帧合并');
  assert.ok(bind.includes('scheduleSave()'), '落盘要走合并');
  assert.ok(!bind.includes('syncUi()'), '拖动时不能跑全量 syncUi（会回写所有控件）');
  assert.ok(bind.includes("addEventListener('change'"), '松手时补一次落盘');
});

test('D2 syncUi 不回写正在拖动的控件', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/modules/04-mood/01-audio-tuning.js'), 'utf8');
  assert.ok(src.includes('var active = global.document.activeElement'), '要取当前焦点控件');
  for (const id of ['at-surround-width', 'at-surround-ambience', 'at-center-mid', 'at-center-side']) {
    const varName = { 'at-surround-width': 'surW', 'at-surround-ambience': 'surA', 'at-center-mid': 'midEl', 'at-center-side': 'sideEl' }[id];
    assert.ok(new RegExp(`if \\(${varName} && ${varName} !== active\\)`).test(src),
      `${id} 的 value 回写必须跳过拖动中的元素`);
  }
  assert.ok(/if \(input && input !== active\)/.test(src), 'EQ 推子同理');
});

test('D3 调度器出错也要复位标志位，否则推子会永久失灵', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/modules/04-mood/01-audio-tuning.js'), 'utf8');
  assert.ok(src.includes('function flush()'), '要有独立的 flush');
  assert.ok(src.includes('finally 兜住') || /try \{ applyAll\(\); \} catch/.test(src), 'applyAll 必须被 try 包住');
});

test('D4 拖动空间推子：合并到下一帧才写参数，拖动过程不落盘', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  const slider = s.elements['at-center-mid'];
  assert.ok(slider && slider._listeners.input && slider._listeners.input.length, '推子要绑上 input');

  /* 折叠后只有开启才能拖，所以先打开（同时会给一个非中性的默认 mid） */
  s.sandbox.toggleAudioTuningCenter();
  const storeBefore = JSON.stringify(s.store);

  slider.fire('input', { target: { value: '0' } });
  assert.equal(c.surround.midGain.gain.value, 0.6, '还没到下一帧，不应该立刻改音频参数');
  assert.equal(JSON.stringify(s.store), storeBefore, '拖动过程不能同步写盘');

  s.advance(20);           // 推进一帧，触发 flush
  assert.equal(c.surround.midGain.gain.value, 0, '下一帧必须真的把参数写进去');
  assert.equal(JSON.stringify(s.store), storeBefore, '一帧之后仍由 300ms 合并负责落盘');

  slider.fire('change', { target: { value: '0' } });
  assert.notEqual(JSON.stringify(s.store), storeBefore, '松手（change）要立刻落盘一次');
});

// =============================================================================
// E. 回归：buildUi 里两块「顺手删区间」最容易误伤的逻辑
//    （2026-11-26 删竖向推子时，先丢过 EQ 输入委托，后丢过预设波形）
// =============================================================================
test('E1 预设卡片的频谱柱子在，且十段 EQ 的输入委托在', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/modules/04-mood/01-audio-tuning.js'), 'utf8');
  assert.ok(src.includes("var wave = btn.querySelector('.at-preset-wave')"), '预设波形生成被删过，必须留着');
  assert.ok(src.includes("wave.innerHTML = bars"), '柱子要真的写进去');
  assert.ok(src.includes("rows.addEventListener('input'"), '十段 EQ 的输入委托被删过，必须留着');
  assert.ok(src.includes("t.getAttribute('data-band')"), '委托靠 data-band 找频段');
});

// =============================================================================
// F. 3D 丽音（交叉差分延迟）
//    out_L = in_L − k·HP(delay(in_R)) / out_R = in_R − k·HP(delay(in_L))
//    关键契约：关掉必须严格直通；低频不进差分支路；参数越界要夹住。
// =============================================================================
test('F1 默认严格中性：两路 dry=1、两路交叉增益=0，等于逐样本直通', () => {
  const s = createSandbox();
  s.install();
  const h = chainOf(s).haas;
  assert.ok(h, '链上必须有 3D 级');
  assert.equal(h.dryL.gain.value, 1);
  assert.equal(h.dryR.gain.value, 1);
  assert.equal(h.xLR.gain.value, 0, '关闭时交叉项必须为 0（否则不是直通）');
  assert.equal(h.xRL.gain.value, 0);
  assert.equal(s.api.getHaas().enabled, false);
});

test('F2 开开关后交叉增益写成负值，延迟落到节点上', () => {
  const s = createSandbox();
  s.install();
  const h = chainOf(s).haas;
  s.sandbox.toggleAudioTuningHaas();
  const st = s.api.getHaas();
  assert.equal(st.enabled, true);
  assert.equal(st.mix, 0.28, '中性值打开时给默认强度 28%');
  assert.equal(st.delayMs, 22);
  assert.ok(Math.abs(h.xLR.gain.value + 0.28) < 1e-9, 'L→R 交叉项是负增益');
  assert.ok(Math.abs(h.xRL.gain.value + 0.28) < 1e-9, 'R→L 交叉项是负增益');
  assert.ok(Math.abs(h.delayL.delayTime.value - 0.022) < 1e-9, '延迟 22ms');
  assert.ok(Math.abs(h.delayR.delayTime.value - 0.022) < 1e-9);
});

test('F3 再关回去必须回严格中性，且不清空用户拖过的参数', () => {
  const s = createSandbox();
  s.install();
  const h = chainOf(s).haas;
  s.api.setHaas({ enabled: true, delayMs: 30, mix: 0.45 });
  assert.ok(Math.abs(h.xLR.gain.value + 0.45) < 1e-9);
  s.sandbox.toggleAudioTuningHaas();
  assert.equal(s.api.getHaas().enabled, false);
  assert.equal(h.xLR.gain.value, 0, '关掉必须回 0');
  assert.equal(h.xRL.gain.value, 0);
  assert.equal(s.api.getHaas().delayMs, 30, '滑块数值要保留，下次打开还是上次那组');
  assert.equal(s.api.getHaas().mix, 0.45);
});

test('F4 预设 live3d = 一键 3D 丽音：EQ 曲线 + 3D 级一起打开', () => {
  const s = createSandbox();
  s.install();
  s.api.setPreset('live3d');
  const c = chainOf(s);
  assert.deepEqual(Array.from(c.eq, (f) => f.gain.value), [4, 4.5, 2.5, 0, -1.5, -2, -0.5, 1.5, 3, 2]);
  const st = s.api.getSettings();
  assert.equal(st.preset, 'live3d');
  assert.equal(st.haasEnabled, true, '预设必须把 3D 级一起打开，否则只是改了 EQ');
  assert.ok(Math.abs(c.haas.xLR.gain.value + 0.28) < 1e-9);
  const saved = JSON.parse(s.store['mineradio-audio-tuning-v1']);
  assert.equal(saved.haasEnabled, true, '3D 开关要落盘');
});

test('F5 越界参数被夹住，不会把非法值写进节点', () => {
  const s = createSandbox();
  s.install();
  s.api.setHaas({ enabled: true, delayMs: 999, mix: 9 });
  assert.equal(s.api.getHaas().delayMs, 35, '延迟上限 35ms');
  assert.equal(s.api.getHaas().mix, 0.6, '强度上限 60%');
  s.api.setHaas({ delayMs: -5, mix: -1 });
  assert.equal(s.api.getHaas().delayMs, 8, '延迟下限 8ms');
  assert.equal(s.api.getHaas().mix, 0);
});

test('F6 持久化回读：刷新后 3D 参数与开关都还原', () => {
  const s = createSandbox();
  s.install();
  s.api.setHaas({ enabled: true, delayMs: 26, mix: 0.34 });
  const saved = s.store['mineradio-audio-tuning-v1'];
  const s2 = createSandbox({ storage: { 'mineradio-audio-tuning-v1': saved } });
  const st = s2.api.getHaas();
  assert.equal(st.enabled, true);
  assert.equal(st.delayMs, 26);
  assert.equal(st.mix, 0.34);
  s2.install();
  assert.ok(Math.abs(chainOf(s2).haas.xLR.gain.value + 0.34) < 1e-9, '回读后增益要落到节点上');
});

test('F7 延迟支路必须高通在前：低频不参与差分，bass 才不会被梳状滤波削掉', () => {
  const s = createSandbox();
  s.install();
  const h = chainOf(s).haas;
  assert.equal(h.hpL.type, 'highpass');
  assert.equal(h.hpR.type, 'highpass');
  assert.ok(h.hpL.frequency.value >= 200 && h.hpL.frequency.value <= 400,
    '分频点落在 200~400Hz：低于 200 会削 bass，高于 400 会只剩齿音');
  // 连线顺序：交叉项必须取自 HP 之后、Delay 之前
  assert.ok(h.hpL.outs.includes(h.delayL), 'HP 之后才进延迟');
  assert.ok(h.delayL.outs.includes(h.xLR), '延迟之后才进交叉增益');
});

test('F8 detach 把 3D 级的 10 个节点全部断开，不留悬挂引用', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  const h = c.haas;
  const nodes = h.nodes.slice();
  s.api.detach();
  assert.equal(s.api._test.getChain(), null);
  for (const n of nodes) assert.equal(n.outs.length, 0, '每个节点输出都要清空');
});

test('F9 拖动强度滑块走节流：不当场写参数，下一帧才落地', () => {
  const s = createSandbox();
  s.install();
  const c = chainOf(s);
  const slider = s.elements['at-haas-mix'];
  assert.ok(slider && slider._listeners.input && slider._listeners.input.length, '滑块要绑上 input');
  slider.fire('input', { target: { value: '50' } });
  assert.equal(s.api.getHaas().mix, 0.5, 'settings 要立刻更新（UI 读数跟着走）');
  assert.equal(c.haas.xLR.gain.value, 0, '但音频参数要等下一帧');
  s.advance(20);
  assert.ok(Math.abs(c.haas.xLR.gain.value + 0.5) < 1e-9, '下一帧必须真的写进去');
});

test('F10 五列预设排布：三处 CSS 都得改，真正生效的是 #settings-modal 那条', () => {
  const rack = fs.readFileSync(path.join(appRoot, 'public/css/10-shell/eq-rack.css'), 'utf8');
  const page = fs.readFileSync(path.join(appRoot, 'public/css/10-shell/settings-page.css'), 'utf8');
  const shell = fs.readFileSync(path.join(appRoot, 'public/css/10-shell/shell.css'), 'utf8');
  /* 这一条是实锤：`#settings-modal .audio-tuning-presets` 特异性 (1,1,0)，
     压过 eq-rack.css 里的 (0,1,0)。只改 eq-rack 的话第 5 个按钮会掉到第二行
     —— 2026-11-27 的真截图里，第 5 个按钮就是这样掉到第二行的。 */
  assert.ok(/#settings-modal \.audio-tuning-presets\{[^}]*repeat\(5/.test(page),
    '生效的是 #settings-modal 这条，不改它等于没改');
  assert.ok(/\.audio-tuning-presets\{display:grid;grid-template-columns:repeat\(5/.test(shell), 'shell.css 的默认列数');
  assert.ok(/\.audio-tuning-presets\{display:grid;grid-template-columns:repeat\(5/.test(rack), 'eq-rack.css 的默认列数');
  assert.ok(rack.includes('#audio-tuning-haas-body.is-off'), '关闭态压暗要跟着一起加');
});

// =============================================================================
// G. 虚拟低音（心理声学低音增强）
//    并联支路：lowpass(fc) → 软整流 → highpass(去直流) → lowpass(限带) → mix
//    关键契约：关掉必须直通；整流曲线必须是半波（否则不是「补基频」是「加失真」）；
//              直流必须被掐掉（否则往功放灌 DC）。
// =============================================================================
test('G1 默认关闭：mix=0、总和节点只有直连那一路', () => {
  const s = createSandbox();
  s.install();
  const v = chainOf(s).vbs;
  assert.ok(v, '链上必须有虚拟低音支路');
  assert.equal(v.mix.gain.value, 0, '关闭时支路增益必须为 0');
  assert.equal(v.sum.gain.value, 1, '总和节点保持单位增益');
  assert.equal(s.api.getVirtualBass().enabled, false);
});

test('G2 打开后支路增益与三只滤波器频率一起落到节点上', () => {
  const s = createSandbox();
  s.install();
  const v = chainOf(s).vbs;
  s.sandbox.toggleAudioTuningBass();
  const st = s.api.getVirtualBass();
  assert.equal(st.enabled, true);
  assert.equal(st.crossoverHz, 150, '默认分频 150Hz');
  assert.equal(st.amount, 0.45, '默认强度 45%');
  assert.ok(Math.abs(v.mix.gain.value - 0.45 * 0.55) < 1e-9, '支路增益 = 强度 × 归一化系数');
  assert.equal(v.lowpass.frequency.value, 150, '分频低通');
  assert.ok(Math.abs(v.dcBlock.frequency.value - 165) < 1e-6, '去直流高通 = 分频 × 1.1');
  assert.equal(v.bandLimit.frequency.value, 900, '限带低通 = 分频 × 6');
});

test('G3 关回去必须回 0，且不清空用户拖过的参数', () => {
  const s = createSandbox();
  s.install();
  const v = chainOf(s).vbs;
  s.api.setVirtualBass({ enabled: true, crossoverHz: 240, amount: 0.8 });
  assert.ok(v.mix.gain.value > 0);
  s.sandbox.toggleAudioTuningBass();
  assert.equal(v.mix.gain.value, 0, '关掉必须回 0（否则不是直通）');
  assert.equal(s.api.getVirtualBass().crossoverHz, 240, '滑块数值要保留');
  assert.equal(s.api.getVirtualBass().amount, 0.8);
});

test('G4 整流曲线必须是半波：负半周全 0、正半周饱和到 1', () => {
  const s = createSandbox();
  s.install();
  const curve = Array.from(chainOf(s).vbs.shaper.curve);
  assert.ok(curve.length >= 1024, '查表要有足够分辨率');
  const half = Math.floor(curve.length / 2);
  assert.ok(curve.slice(0, half).every((x) => x === 0), '负半周必须全 0（半波整流的定义）');
  assert.ok(curve[curve.length - 1] > 0.999, '正半周顶端要饱和到 1');
  assert.ok(curve[Math.floor(half * 1.5)] > 0.4, '正半周中段要有输出');
  /* 单调不减：曲线一旦回折就说明查表建错了（会出现怪异的谐波） */
  for (let i = half + 1; i < curve.length; i++) {
    assert.ok(curve[i] >= curve[i - 1] - 1e-9, '第 ' + i + ' 点回折了');
  }
});

test('G5 越界参数被夹住', () => {
  const s = createSandbox();
  s.install();
  s.api.setVirtualBass({ enabled: true, crossoverHz: 9999, amount: 9 });
  assert.equal(s.api.getVirtualBass().crossoverHz, 300);
  assert.equal(s.api.getVirtualBass().amount, 1);
  s.api.setVirtualBass({ crossoverHz: 1, amount: -1 });
  assert.equal(s.api.getVirtualBass().crossoverHz, 60);
  assert.equal(s.api.getVirtualBass().amount, 0);
});

test('G6 持久化回读：刷新后分频/强度/开关都还原', () => {
  const s = createSandbox();
  s.install();
  s.api.setVirtualBass({ enabled: true, crossoverHz: 220, amount: 0.6 });
  const saved = s.store['mineradio-audio-tuning-v1'];
  const s2 = createSandbox({ storage: { 'mineradio-audio-tuning-v1': saved } });
  const back = s2.api.getVirtualBass();
  assert.equal(back.enabled, true);
  assert.equal(back.crossoverHz, 220);
  assert.equal(back.amount, 0.6);
  s2.install();
  assert.ok(chainOf(s2).vbs.mix.gain.value > 0, '回读后增益要落到节点上');
});

test('G7 支路顺序：低通取低频 → 整流 → 去直流 → 限带 → 混音', () => {
  const s = createSandbox();
  s.install();
  const v = chainOf(s).vbs;
  assert.ok(v.lowpass.outs.includes(v.pre), '低频先过分频低通再进驱动增益');
  assert.ok(v.pre.outs.includes(v.shaper), '驱动之后才是整流');
  assert.ok(v.shaper.outs.includes(v.dcBlock), '整流之后必须立刻去直流');
  assert.ok(v.dcBlock.outs.includes(v.bandLimit), '去直流之后限带');
  assert.ok(v.bandLimit.outs.includes(v.mix), '限带之后进混音增益');
  assert.ok(v.mix.outs.includes(v.sum), '混音增益汇入总和节点');
  assert.equal(v.dcBlock.type, 'highpass', '去直流必须是 highpass');
  assert.equal(v.bandLimit.type, 'lowpass', '限带必须是 lowpass');
});

test('G8 detach 把虚拟低音的 7 个节点全部断开', () => {
  const s = createSandbox();
  s.install();
  const v = chainOf(s).vbs;
  const nodes = v.nodes.slice();
  s.api.detach();
  assert.equal(s.api._test.getChain(), null);
  for (const n of nodes) assert.ok(!n || n.outs.length === 0, '每个节点输出都要清空');
});

test('G9 UI 载体齐全，且拖滑块会自动开启', () => {
  const s = createSandbox();
  s.install();
  assert.ok(s.api._test.getChain().vbs, '链路里要有支路');
  s.elements['at-bass-amount'].fire('input', { target: { value: '70' } });
  assert.equal(s.api.getVirtualBass().amount, 0.7);
  assert.equal(s.api.getVirtualBass().enabled, true, '拖强度滑块视为想用这个效果');
  s.elements['at-bass-freq'].fire('input', { target: { value: '80' } });
  assert.equal(s.api.getVirtualBass().crossoverHz, 80);
  s.advance(20);
  assert.equal(chainOf(s).vbs.lowpass.frequency.value, 80, '分频改了要真的写到节点上');
});

test('G10 没有 WaveShaperNode 时支路强制静音，主信号仍直通', () => {
  const s = createSandbox({ noShaper: true });
  s.install();
  const v = chainOf(s).vbs;
  assert.equal(v.shaper, null);
  s.sandbox.toggleAudioTuningBass();
  assert.equal(v.mix.gain.value, 0, '内核不支持整流时必须压成 0，不能只做滤波');
});
