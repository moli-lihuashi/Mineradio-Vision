'use strict';

/* 语义化版本检查的纯函数单测 —— 规则见 VERSIONING.md。
   这里不跑 git，只验证判定与期望版本计算，避免 CI 环境差异。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseVersion, compareVersion, bumpPatch, bumpMinor,
  classifyBump, evaluateVersionBump,
} = require(path.resolve(__dirname, '../scripts/check-version-bump.js'));

test('版本号解析与比较', () => {
  assert.deepEqual(parseVersion('3.3.1'), [3, 3, 1]);
  assert.deepEqual(parseVersion('3.4.0-beta.1'), [3, 4, 0]);
  assert.equal(parseVersion('v3.3.1'), null);
  assert.equal(parseVersion('3.3'), null);
  assert.equal(compareVersion([3, 3, 2], [3, 3, 1]), 1);
  assert.equal(compareVersion([3, 4, 0], [3, 3, 9]), 1);
  assert.equal(compareVersion([3, 3, 1], [3, 3, 1]), 0);
  assert.deepEqual(bumpPatch([3, 3, 1]), [3, 3, 2]);
  assert.deepEqual(bumpMinor([3, 3, 1]), [3, 4, 0]);
});

test('feat 需要 minor，fix/perf 需要 patch，docs 等不需要', () => {
  assert.equal(classifyBump(['feat(platforms): 平台能力面板']).level, 'minor');
  assert.equal(classifyBump(['fix(glass): 修复玻璃全黑']).level, 'patch');
  assert.equal(classifyBump(['perf(we): 后台停解码']).level, 'patch');
  assert.equal(classifyBump(['docs(README): 重写', 'test(guards): 补断言', 'chore(privacy): 清理']).level, 'none');
  // 混合时取最高级别
  assert.equal(classifyBump(['docs: x', 'fix: y', 'feat: z']).level, 'minor');
  assert.equal(classifyBump(['fix: y', 'perf: z']).level, 'patch');
  // 破坏性 feat 也归 minor（本仓库暂未启用 major 判定）
  assert.equal(classifyBump(['feat!: 不兼容改动']).level, 'minor');
});

test('未知前缀不静默吞掉，会单列出来供人工判断', () => {
  const r = classifyBump(['随手改了一点', 'feat: 新面板']);
  assert.equal(r.level, 'minor');
  assert.deepEqual(r.unknown, ['随手改了一点']);
});

test('版本未达到要求时必须拦住（这正是「功能加了版本号不动」）', () => {
  const feat = evaluateVersionBump('3.3.1', '3.3.1', 'minor');
  assert.equal(feat.ok, false);
  assert.equal(feat.expected, '3.4.0');

  const fix = evaluateVersionBump('3.3.1', '3.3.1', 'patch');
  assert.equal(fix.ok, false);
  assert.equal(fix.expected, '3.3.2');

  // 只 bump patch 但提交了 feat，仍然不通过
  const wrong = evaluateVersionBump('3.3.1', '3.3.2', 'minor');
  assert.equal(wrong.ok, false, 'feat 只 bump patch 属于规则违反，必须拦住');
});

test('满足最低要求时放行，超前 bump 也放行', () => {
  assert.equal(evaluateVersionBump('3.3.1', '3.4.0', 'minor').ok, true);
  assert.equal(evaluateVersionBump('3.3.1', '3.3.2', 'patch').ok, true);
  assert.equal(evaluateVersionBump('3.3.1', '4.0.0', 'minor').ok, true);
  assert.equal(evaluateVersionBump('3.3.1', '3.3.1', 'none').ok, true);
  assert.equal(evaluateVersionBump('bad', '3.3.2', 'patch').ok, false);
});
