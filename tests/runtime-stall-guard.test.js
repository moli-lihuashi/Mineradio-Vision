'use strict';

/*
 * 运行期卡顿记录器守卫（2026-11-22）
 *
 * 背景：用户报「返回 home 时白屏 1~2s + 鼠标转圈」，但 enter-perf 只覆盖启动窗口，
 * startup-error.log 里没有崩溃/重载记录 → 间歇性卡顿完全没有现场。
 * 记录器必须满足：
 *   1) 只在 splash 退场后启用（不与启动埋点重复）；
 *   2) 阈值 ≥200ms、250ms 内最多一条（防刷屏）；
 *   3) longtask / LoAF / rAF 缺帧三路都要有——实测 338ms 的停顿只有 frame-gap、
 *      没有 longtask，说明是渲染管线（样式/布局/绘制）而非 JS；LoAF 才能把
 *      「脚本耗时」与「样式布局耗时」分开。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/01-splash-and-boot.js'), 'utf8');

function recorderBody() {
  const start = SRC.indexOf('function installRuntimeStallRecorder()');
  assert.ok(start > 0, '必须存在 installRuntimeStallRecorder');
  return SRC.slice(start, start + 4200);
}

test('三路采样：longtask、LoAF、rAF 缺帧', () => {
  const body = recorderBody();
  assert.match(body, /entryTypes:\s*\['longtask'\]/, '必须监听 longtask');
  assert.match(body, /entryTypes:\s*\['long-animation-frame'\]/, '必须监听 LoAF');
  assert.match(body, /frame-gap/, '必须记录 rAF 缺帧');
  assert.match(body, /requestAnimationFrame\(frame\)/, '缺帧检测必须是常驻 rAF');
});

test('LoAF：区分脚本与样式/布局耗时', () => {
  const body = recorderBody();
  assert.match(body, /styleLayoutMs/, '必须记录样式/布局阶段耗时');
  assert.match(body, /renderStartMs/, '必须记录渲染起点');
  assert.match(body, /entry\.scripts/, '必须记录脚本归因');
});

test('阈值与限流：200ms 起报、250ms 内最多一条', () => {
  const body = recorderBody();
  assert.match(body, /duration\s*>=\s*200/, 'longtask 阈值必须是 200ms');
  assert.match(body, /gap\s*>=\s*200/, '缺帧阈值必须是 200ms');
  assert.match(body, /lastNoteAt[\s\S]{0,40}250/, '必须有 250ms 限流');
});

test('只在 splash 退场后启用，不重复启动期采样', () => {
  const body = recorderBody();
  assert.match(body, /splash-active/, '启用条件必须检查 splash-active');
  assert.match(body, /!document\.body\.classList\.contains\('splash-active'\)/, '必须等到 splash 退场');
});

test('写 notePerfEvent 且带现场信息', () => {
  const body = recorderBody();
  assert.match(body, /desktopWindow\.notePerfEvent/, '必须走既有 IPC 落盘');
  assert.match(body, /kind:\s*'runtime-stall'/, '必须用 kind 区分启动记录');
  for (const field of ['body:', 'href:', 'marks:', 'visible:']) {
    assert.ok(body.includes(field), '必须带现场字段：' + field);
  }
});

test('记录器位于文件末尾且只执行一次', () => {
  const iife = SRC.lastIndexOf('(function installRuntimeStallRecorder()');
  assert.ok(iife > 0, '必须由 IIFE 包裹');
  assert.equal(SRC.indexOf('(function installRuntimeStallRecorder()', iife + 1), -1, '不得重复安装');
  assert.ok(iife > SRC.length - 4200, '应位于文件尾部，避免被启动主路径的异常带走');
});
