'use strict';

/* 2026-11-12 复核回归：启动冒烟此前用「末尾函数是否存在」当完成判据，
 * 但函数声明在编译期就提升 —— 内存注入启动异常后，eval 中途中断，哨兵符号
 * 依然存在，检查误报通过。必须靠「脚本末尾执行完成标记」+ 未预期异常直接失败。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const checkPath = path.join(appRoot, 'scripts', 'quick-check', 'module-parse.js');
const source = fs.readFileSync(checkPath, 'utf8');

test('core eval 追加末尾完成标记，且标记缺失直接判失败', () => {
  assert.match(source, /window\.__MINERADIO_CORE_EVAL_COMPLETED = true/,
    '完成标记必须拼在合并脚本末尾：eval 中途抛错时这条语句不会执行');
  assert.match(source, /runInContext\(combined \+ '\\n;window\.__MINERADIO_CORE_EVAL_COMPLETED = true;'/,
    '标记语句必须与被检查脚本同一次求值');
  assert.match(source, /if \(!coreCompleted\)[\s\S]*?fail\(/, '标记缺失必须 fail');
});

test('deferred eval 同样要有完成标记与失败判定', () => {
  assert.match(source, /window\.__MINERADIO_DEFERRED_EVAL_COMPLETED = true/);
  assert.match(source, /if \(!deferredCompleted\) fail\(/);
  assert.match(source, /Deferred eval did NOT run to completion/);
});

test('未预期异常不再被 WARN 容忍', () => {
  assert.doesNotMatch(source, /Core eval threw \(env\/sandbox, ignored\)/,
    '旧实现的容忍分支会让注入异常后的冒烟照样通过');
  assert.doesNotMatch(source, /Deferred eval threw \(env\/sandbox, ignored\)/);
  assert.match(source, /Core eval did NOT run to completion/);
});

test('WebGL / 2D 上下文桩齐全，eval 才可能真正跑完', () => {
  assert.match(source, /getContext\(kind\) \{ return \/webgl\/i\.test/);
  assert.match(source, /createRadialGradient\(\) \{/);
  assert.match(source, /const glStub = new Proxy/);
});
