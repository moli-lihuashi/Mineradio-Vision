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
  const created = { biquad: [], gain: [], panner: [], compressor: [], analyser: [] };
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

test('A2 链路顺序 input→EQ→preamp→loudness→limiter→antiClick→panner→exit', () => {
  const s = createSandbox();
  const exit = s.install();
  const c = chainOf(s);
  assert.ok(s.input.outs.includes(c.eq[0]), '首段要接在 input 上');
  for (let i = 0; i < 9; i++) assert.ok(c.eq[i].outs.includes(c.eq[i + 1]));
  assert.ok(c.eq[9].outs.includes(c.preamp));
  assert.ok(c.preamp.outs.includes(c.loudness));
  assert.ok(c.loudness.outs.includes(c.safetyLimiter));
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
  const second = s.install();
  assert.equal(second, first);
  assert.equal(s.created.biquad.length, before);
  assert.equal(s.created.gain.length, 3); // preamp / loudness / antiClick
});

test('A6 换源重建音频图时只重接首段，不重建整链', () => {
  const s = createSandbox();
  const exit = s.install();
  const c = chainOf(s);
  const newInput = makeNode('input2');
  const again = s.api.install(s.ctx, newInput);
  assert.equal(again, exit);
  assert.equal(chainOf(s), c);
  assert.equal(s.created.biquad.length, 10);
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
  assert.ok(c.loudness.outs.includes(c.antiClick));
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
  assert.equal(s.created.biquad.length, 20, '新链重新建了 10 段');
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
  ];
  for (const id of ids) assert.ok(htmlSource.includes('id="' + id + '"'), '缺少 ' + id);
  for (const p of ['flat', 'pop', 'rock', 'vocal']) {
    assert.ok(htmlSource.includes('data-preset="' + p + '"'), '缺少预设 ' + p);
  }
  assert.ok(htmlSource.includes('toggleAudioTuningEq()'));
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
