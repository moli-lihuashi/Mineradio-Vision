'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const AUDIO = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/08-audio-graph-controls.js'), 'utf8');
const CHROME = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/05-prismal-chrome.js'), 'utf8');
const LOADER = fs.readFileSync(path.join(ROOT, 'public/js/index-loader.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/css/06-fx/prismal-chrome.css'), 'utf8');

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'missing markers: ' + from + ' -> ' + to);
  return source.slice(start, end);
}

function buildSandbox() {
  const slider = {
    value: '1',
    style: { vars: {}, setProperty(k, v) { this.vars[k] = v; } },
  };
  const sandbox = {
    clampRange: (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0)),
    document: {
      getElementById(id) {
        if (id === 'volume-slider') return slider;
        if (id === 'volume-value') return { textContent: '' };
        return null;
      },
    },
    window: {},
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  return { sandbox, slider };
}

test('加载守卫：实际生效的是 prismal-chrome，死模块已删除', () => {
  assert.match(LOADER, /06-fx\/05-prismal-chrome\.js/);
  assert.doesNotMatch(LOADER, /06-fx\/05-prismal-fill\.js/,
    'prismal-fill must stay unloaded; syncing it is a no-op');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public/js/modules/06-fx/05-prismal-fill.js')),
    'dead prismal-fill module must be deleted, not left as a trap');
  assert.match(CHROME, /window\.MineradioPrismalChrome = \{/);
  assert.match(CHROME, /syncRangeFill: syncRangeFill/);
  // 填充要按 thumb 中心对齐（几何算法），不是裸百分比
  assert.match(CHROME, /fillPx \/ trackW/);
});

test('滚轮弹簧逐帧更新：更新 slider.value 时必须调生效模块的 syncRangeFill', () => {
  const { sandbox, slider } = buildSandbox();
  const syncCalls = [];
  sandbox.window.MineradioPrismalChrome = { syncRangeFill(input) { syncCalls.push(String(input.value)); } };
  vm.createContext(sandbox);
  vm.runInContext(slice(AUDIO, 'function updateVolumeUiFrom(level) {', 'function updateVolumeUi() {'), sandbox);
  for (let i = 100; i >= 30; i -= 5) sandbox.updateVolumeUiFrom(i / 100);
  assert.ok(slider.value === '0.3' || slider.value === 0.3);
  assert.ok(syncCalls.length >= 14, 'must sync every reassigned frame, got ' + syncCalls.length);
  assert.equal(syncCalls[0], String(0.95));
  assert.equal(syncCalls[syncCalls.length - 1], String(0.3));
});

test('拖拽路径值未变时不重复触发（fill 已由 input 事件同步）', () => {
  const { sandbox, slider } = buildSandbox();
  const calls = [];
  sandbox.window.MineradioPrismalChrome = { syncRangeFill() { calls.push(1); } };
  vm.createContext(sandbox);
  vm.runInContext(slice(AUDIO, 'function updateVolumeUiFrom(level) {', 'function updateVolumeUi() {'), sandbox);
  slider.value = '0.42';
  sandbox.updateVolumeUiFrom(0.42);
  assert.equal(calls.length, 0);
});

test('突变守卫：删同步调用必须失败', () => {
  const fn = slice(AUDIO, 'function updateVolumeUiFrom(level) {', 'function updateVolumeUi() {');
  assert.match(fn, /prismChrome\.syncRangeFill\(slider\)/);
  assert.throws(() => {
    assert.match(fn.replace(/var prismChrome[\s\S]*?prismChrome\.syncRangeFill\(slider\);/, ''),
      /prismChrome\.syncRangeFill\(slider\)/);
  });
  // 该函数不得再引用已删除的 MineradioPrismalFill（上一轮错误调用的死 API）
  assert.doesNotMatch(fn, /MineradioPrismalFill/);
  assert.match(CSS, /var\(--prism-fill,0%\)/);
});
