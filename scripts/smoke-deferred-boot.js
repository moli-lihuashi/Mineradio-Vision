'use strict';
/**
 * 独立启动冒烟：验证 index-loader 主波/延迟波拆分不会在求值期 ReferenceError（白屏级）。
 * 用法：node scripts/smoke-deferred-boot.js
 */
const path = require('path');
const { smokeCoreEvalNoReferenceError, checkDeferredEagerDependencyGuard, parseCombinedIndexModules } =
  require(path.join(__dirname, 'quick-check', 'module-parse'));

function main() {
  parseCombinedIndexModules();
  checkDeferredEagerDependencyGuard();
  smokeCoreEvalNoReferenceError();
  console.log('\nDeferred boot smoke passed.');
}

try {
  main();
} catch (err) {
  console.error('\n[FAIL]', err && err.message ? err.message : err);
  process.exitCode = 1;
}
// 沙箱里可能留下 setTimeout；显式退出，避免 npm 挂住
process.exit(process.exitCode || 0);
