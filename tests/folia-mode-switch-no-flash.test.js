'use strict';

// Folia 切样式防闪屏守卫（2026-11-21）
//
// 症状：点「花笺」时屏幕闪一下。花笺是异步样式（先 await PIXI init），
// 原逻辑在 create 之前就 foliaWorldDestroyInstance()，初始化那几百毫秒里
// 旧画面已经没了、新画面还没出来，露出的背景层就是「闪一下」。
//
// 修法：切样式时把旧样式的最后一帧留在下层（不销毁、不 tick），
// 等新样式第一帧 tick 画完再销毁旧实例；退出世界/创建失败时兜底清掉。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/03-folia-world-runtime.js'), 'utf8');

test('切样式不再先销毁旧实例，而是把它留作 prev', () => {
  const setMode = src.slice(src.indexOf('function foliaWorldSetMode'), src.indexOf('function foliaWorldSetBackground'));
  assert.ok(!/if \(foliaWorld\.active\) \{\s*foliaWorldDestroyInstance\(\);/.test(setMode),
    'setMode 仍然在建新实例前销毁旧实例：异步样式会露背景，闪一下');
  const create = src.slice(src.indexOf('function foliaWorldCreateInstance'), src.indexOf('function foliaWorldEnter'));
  assert.match(create, /var prev = foliaWorld\.instance/, 'create 没有接住旧实例');
  assert.match(create, /foliaWorldPrevInstance = prev/, '旧实例没有留作 prev');
  assert.match(create, /foliaWorld\.instance = null/, '旧实例没有从 tick 链上摘掉，会继续画');
  assert.match(create, /foliaWorldScheduleRetirePrev\(\)/, '缺少异步初始化的兜底清理');
  assert.match(src, /setTimeout\(foliaWorldRetirePrevInstance, 2500\)/, '兜底定时器没有 2500ms');
});

test('新实例第一帧画完才撤旧帧', () => {
  const tickStart = src.indexOf('function foliaWorldTick');
  const tick = src.slice(tickStart, tickStart + 4200);
  assert.match(tick, /__needsFirstFrame/, 'tick 没有等第一帧');
  assert.match(tick, /__needsFirstFrame[\s\S]{0,120}foliaWorldRetirePrevInstance/, '第一帧后没有撤旧帧');
  const apply = src.slice(src.indexOf('function foliaWorldApplyAsyncInstance'), src.indexOf('function foliaWorldFailAsyncInstance'));
  assert.match(apply, /foliaWorldArmPrevRetire\(real, def\)/, '异步实例接上后没有挂第一帧退役');
});

test('退出 / 失败 / 销毁时必须清掉旧帧', () => {
  const destroy = src.slice(src.indexOf('function foliaWorldDestroyInstance'), src.indexOf('function foliaWorldApplyAsyncInstance'));
  assert.match(destroy, /foliaWorldRetirePrevInstance\(\)/, '销毁实例时没有清旧帧');
  const fail = src.slice(src.indexOf('function foliaWorldFailAsyncInstance'), src.indexOf('function foliaWorldCreateInstance'));
  assert.match(fail, /foliaWorldRetirePrevInstance\(\)/, '异步失败时没有清旧帧');
  const retire = src.slice(src.indexOf('function foliaWorldRetirePrevInstance'), src.indexOf('function foliaWorldArmPrevRetire'));
  assert.match(retire, /__def\.destroy/, '退役时没有销毁旧实例');
  assert.match(retire, /removeChild\(prev\.__host\)/, '退役时没有移除旧 host');
});
