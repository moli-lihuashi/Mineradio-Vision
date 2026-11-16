'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CAMERA = read('public/js/modules/01-scene/02-beat-camera-runtime.js');
const BOOT = read('public/js/modules/10-shell/01-splash-and-boot.js');
const GLASS = read('public/js/modules/06-fx/01-liquidglass-config.js');
const RENDERER = read('public/js/modules/01-scene/00-renderer-quality.js');
const LOOP = read('public/js/modules/11-main-loop.js');

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'missing source markers: ' + from + ' -> ' + to);
  return source.slice(start, end);
}

function compileGuard(source) {
  assert.match(source, /scheduleVisualApply\(function\(\)\{[\s\S]*?\}, 900, 360\)/,
    'scene compile must use a real 900ms delay');
  assert.match(source, /var batchSize = 1/, 'compile work must be bounded to one material at a time');
  assert.match(source, /targets\[i\]\.clone\(false\)/, 'compile must not reparent original scene nodes');
  assert.match(source, /scheduleVisualApply\(runBatch, 0, 120\)/, 'compile batches must yield between frames');
  assert.doesNotMatch(source, /renderer\.compile\(scene, camera\)/, 'full-scene synchronous compile must stay removed');
}

test('scheduleVisualApply 的 delay 是真延迟，idle timeout 不冒充延迟', () => {
  const timers = [];
  let idle = null;
  let frame = null;
  let ran = 0;
  const sandbox = {
    setTimeout(fn, delay) { timers.push({ fn, delay }); },
    requestAnimationFrame(fn) { frame = fn; },
    requestIdleCallback(fn, options) { idle = { fn, options }; },
    isHiddenForBackgroundOptimization() { return false; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(slice(CAMERA, 'function scheduleVisualApply(', 'function scheduleUiWarmTask('), sandbox);
  sandbox.scheduleVisualApply(() => { ran += 1; }, 900, 360);
  assert.equal(ran, 0);
  assert.deepEqual(timers.map((entry) => entry.delay), [900]);
  timers.shift().fn();
  assert.equal(ran, 0);
  assert.equal(idle.options.timeout, 360);
  idle.fn();
  frame();
  assert.equal(ran, 1);
});

test('场景预热逐个材质分批，保留灯光环境且不修改原场景', () => {
  class Node {
    constructor(kind, visible = true) {
      this.kind = kind;
      this.visible = visible;
      this.isLight = kind === 'light';
      this.material = kind === 'mesh' ? { visible: true } : null;
      this.children = [];
      this.layers = { test: () => true };
    }
    add(...nodes) { this.children.push(...nodes); }
    remove(node) { this.children = this.children.filter((item) => item !== node); }
    traverseVisible(fn) {
      if (!this.visible) return;
      fn(this);
      this.children.forEach((child) => child.traverseVisible(fn));
    }
    clone() {
      const copy = new Node(this.kind, this.visible);
      copy.material = this.material;
      return copy;
    }
  }
  class Scene extends Node {
    constructor() { super('scene'); }
  }
  const scene = new Scene();
  scene.fog = { near: 1 };
  scene.environment = { intensity: 0.5 };
  scene.add(new Node('light'));
  const originalMaterials = [];
  for (let i = 0; i < 9; i += 1) {
    const mesh = new Node('mesh');
    originalMaterials.push(mesh.material);
    scene.add(mesh);
  }
  scene.add(new Node('mesh', false));
  const originalChildren = scene.children.slice();
  const batches = [];
  const scheduled = [];
  const marks = [];
  const deadlines = [];
  const sandbox = {
    THREE: { Scene },
    scene,
    camera: { layers: {} },
    startupSceneCompileState: { done: false },
    rendererUnavailableReason: '',
    renderer: {
      compile(compileScene) {
        assert.notEqual(compileScene, scene);
        assert.equal(compileScene.fog, scene.fog);
        assert.equal(compileScene.environment, scene.environment);
        assert.equal(compileScene.children.filter((node) => node.isLight).length, 1);
        batches.push(compileScene.children.filter((node) => node.material).length);
      },
    },
    scheduleVisualApply(fn, delay, timeout) { scheduled.push({ fn, delay, timeout }); },
    setTimeout(fn) { deadlines.push(fn); },
    markAppPerf(name) { marks.push(name); },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(slice(BOOT, 'function scheduleStartupSceneCompile()',
    "scheduleVisualApply(function(){ runStartupWarmStep('startup-control-glass-map'"), sandbox);
  sandbox.scheduleStartupSceneCompile();
  assert.equal(batches.length, 0);
  assert.deepEqual(scheduled.map((entry) => entry.delay), [900]);
  let guard = 0;
  while (scheduled.length) {
    assert.ok(++guard < 10, 'compile scheduler must terminate');
    const next = scheduled.shift();
    next.fn();
    if (scheduled.length) assert.equal(scheduled[0].delay, 0);
  }
  assert.deepEqual(batches, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(scene.children, originalChildren, 'original scene tree must be unchanged');
  assert.ok(originalMaterials.every((material, index) => scene.children[index + 1].material === material));
  assert.ok(marks.includes('startup-scene-compile-start'));
  assert.ok(marks.includes('startup-scene-compile-done'));
  assert.equal(sandbox.startupSceneCompileState.done, true);
  assert.equal(sandbox.startupSceneCompileState.reason, 'complete');
  assert.equal(deadlines.length, 1);
  deadlines[0]();
  assert.equal(sandbox.startupSceneCompileState.reason, 'complete', 'deadline must not overwrite completed state');
});

test('编译守卫能拦住退化为整场景同步编译的实现', () => {
  compileGuard(BOOT);
  assert.throws(() => compileGuard(BOOT.replace('scheduleVisualApply(runBatch, 0, 120);', 'runBatch();')),
    /compile batches must yield/);
  assert.throws(() => compileGuard(BOOT.replace('targets[i].clone(false)', 'targets[i]')),
    /must not reparent/);
});

test('液态玻璃后台预热串行，Promise 未完成时不启动下一项', async () => {
  const timers = [];
  const calls = [];
  const resolvers = [];
  const sandbox = {
    Promise,
    console,
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
  };
  vm.createContext(sandbox);
  vm.runInContext(slice(GLASS, 'var LG_WARM_SLOT_MS', '/* 方案 A：'), sandbox);
  function job(name) {
    return function () {
      calls.push(name);
      return new Promise((resolve) => { resolvers.push(resolve); });
    };
  }
  sandbox.staggerGlassWarmup(0, job('bottom'));
  sandbox.staggerGlassWarmup(1, job('search'));
  assert.deepEqual(timers.map((entry) => entry.delay), [0, 180]);
  timers.shift().fn();
  timers.shift().fn();
  assert.deepEqual(calls, ['bottom'], 'second job must wait for the first promise');
  resolvers.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers.length, 1);
  timers.shift().fn();
  assert.deepEqual(calls, ['bottom', 'search']);
  resolvers.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sandbox.lgBootWarmRunning, false);
});

test('液态玻璃等开屏退出后启动，12 秒异常等待有兜底', () => {
  const code = slice(GLASS, 'function scheduleLiquidGlassBootstrapAfterSplash()',
    "if (document.readyState === 'complete'");
  let now = 0;
  let booted = 0;
  const timers = [];
  const splashClasses = new Set(['splash-active']);
  const sandbox = {
    performance: { now: () => now },
    document: { body: { classList: { contains: (name) => splashClasses.has(name) } } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); },
    applyHomeLiquidGlassConfig() {},
    bootstrapLiquidGlass() { booted += 1; },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.scheduleLiquidGlassBootstrapAfterSplash();
  assert.equal(booted, 0);
  assert.equal(timers.shift().delay, 200);
  now = 500;
  splashClasses.clear();
  sandbox.scheduleLiquidGlassBootstrapAfterSplash();
  assert.equal(booted, 1, 'already dismissed splash must bootstrap immediately');
  splashClasses.add('splash-active');
  now = 13000;
  sandbox.scheduleLiquidGlassBootstrapAfterSplash();
  assert.equal(booted, 1);
  now = 25001;
  timers.shift().fn();
  assert.equal(booted, 2, 'fallback must bootstrap after the 12s bound');
});

test('首帧等待分批编译完成，失败或超时必须释放', () => {
  const loopGate = slice(LOOP, 'if (isMainSceneCoveredBySplash()) {', '    if (now - splashWarmRenderLast > 520) {');
  assert.match(loopGate, /!startupSceneCompileState\.done/);
  assert.match(loopGate, /splash-first-render-wait-prewarm/);
  assert.throws(() => {
    assert.match(loopGate.replace('!startupSceneCompileState.done', 'false'),
      /!startupSceneCompileState\.done/);
  });
  assert.match(BOOT, /startupSceneCompileState\.reason = 'failed'/);
  assert.match(BOOT, /startupSceneCompileState\.reason = 'deadline'/);
  assert.match(BOOT, /startup-scene-compile-deadline/);
});

test('进入主界面等首帧预热完成，状态缺失或超时仍放行', () => {
  const gate = slice(BOOT, "  if (typeof startupSceneCompileState !== 'undefined'",
    '  markSplashReadyToEnter();\n}');
  assert.match(gate, /!startupSceneCompileState\.done/);
  assert.match(gate, /splashPrewarmWaitLogged/);
  assert.match(gate, /setTimeout\(tryMarkSplashReadyFromBoot, 80\)/);
  assert.match(BOOT, /var splashPrewarmWaitLogged = false/);
  // 老链路没有 startupSceneCompileState 时，typeof 分支直接跳过，照常放行。
  assert.throws(() => {
    assert.match(gate.replace('!startupSceneCompileState.done', 'false'),
      /!startupSceneCompileState\.done/);
  });
});

test('所有预热返回真实 Promise，首屏重活不再使用伪延迟', () => {
  assert.equal((GLASS.match(/return LiquidGlass\.init\(/g) || []).length, 5);
  assert.doesNotMatch(GLASS, /^\s+LiquidGlass\.init\(/m);
  assert.match(GLASS, /if \(homeState === 'idle'\) staggerGlassWarmup\(0, warmupHomeGlass\)/);
  const bootBlock = slice(BOOT, 'bindPlayerControlAnimations();', 'initIdleGuideCanvas();');
  assert.doesNotMatch(bootBlock, /scheduleUiWarmTask\(/);
  assert.match(RENDERER, /renderer-create-start/);
  assert.match(RENDERER, /renderer-context-ready/);
  assert.match(LOOP, /splash-first-render-start/);
  assert.match(LOOP, /splash-first-render-done/);
});
