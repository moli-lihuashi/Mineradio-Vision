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

test('默认走补丁号：feat / fix / perf 都只要求 patch，带 ! 的提交才要求 minor', () => {
  assert.equal(classifyBump(['feat(platforms): 平台能力面板']).level, 'patch');
  assert.equal(classifyBump(['fix(glass): 修复玻璃全黑']).level, 'patch');
  assert.equal(classifyBump(['perf(we): 后台停解码']).level, 'patch');
  assert.equal(classifyBump(['docs(README): 重写', 'test(guards): 补断言', 'chore(privacy): 清理']).level, 'none');
  // 混合时取最高级别
  assert.equal(classifyBump(['docs: x', 'fix: y', 'feat: z']).level, 'patch');
  assert.equal(classifyBump(['fix: y', 'perf: z']).level, 'patch');
  // 带 ! 的不兼容改动抬到 minor（本仓库暂未启用 major 判定）
  assert.equal(classifyBump(['feat!: 不兼容改动']).level, 'minor');
  assert.equal(classifyBump(['fix(api)!: 接口必带 token']).level, 'minor');
  // 同一批里既有普通 feat 又有不兼容改动 -> minor
  assert.equal(classifyBump(['feat: 新面板', 'fix!: 不兼容']).level, 'minor');
});

test('未知前缀不静默吞掉，会单列出来供人工判断', () => {
  const r = classifyBump(['随手改了一点', 'feat: 新面板']);
  assert.equal(r.level, 'patch');
  assert.deepEqual(r.unknown, ['随手改了一点']);
});

test('版本未达到要求时必须拦住（这正是「改了东西版本号不动」）', () => {
  const patch = evaluateVersionBump('3.3.6', '3.3.6', 'patch');
  assert.equal(patch.ok, false);
  assert.equal(patch.expected, '3.3.7');

  const minor = evaluateVersionBump('3.3.6', '3.3.6', 'minor');
  assert.equal(minor.ok, false);
  assert.equal(minor.expected, '3.4.0');

  // 带 ! 的提交只 bump patch，仍然不通过
  const wrong = evaluateVersionBump('3.3.6', '3.3.7', 'minor');
  assert.equal(wrong.ok, false, '不兼容改动只 bump patch 属于规则违反，必须拦住');
});

test('满足最低要求时放行，超前 bump 也放行', () => {
  assert.equal(evaluateVersionBump('3.3.6', '3.4.0', 'minor').ok, true);
  assert.equal(evaluateVersionBump('3.3.6', '3.3.7', 'patch').ok, true);
  // 真实回归：v3.3.6 -> v3.3.7 只有 feat/fix 提交，按补丁号发布必须放行
  assert.equal(evaluateVersionBump('3.3.6', '3.3.7', classifyBump(['feat(playback): 取址缓存', 'fix(login): 导航收口']).level).ok, true);
  assert.equal(evaluateVersionBump('3.3.1', '4.0.0', 'minor').ok, true);
  assert.equal(evaluateVersionBump('3.3.1', '3.3.1', 'none').ok, true);
  assert.equal(evaluateVersionBump('bad', '3.3.2', 'patch').ok, false);
});
