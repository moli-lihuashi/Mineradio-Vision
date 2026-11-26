'use strict';

// =============================================================================
// 统一测试入口（P2-1 / 9.16 测试框架标准化）
//  - 单元测试：node --test <tests/*.test.js>（基于 node:test 内置框架）
//  - 静态检查：node scripts/quick-check.js
// 任一阶段失败即以非零退出码结束，便于 CI / npm test 集成。
// 用法：
//   node scripts/run-tests.js            # 跑全部（unit + quick-check）
//   node scripts/run-tests.js unit       # 仅单元测试
//   node scripts/run-tests.js quick      # 仅静态检查
// =============================================================================

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const mode = process.argv[2] || 'all';
const cwd = path.resolve(__dirname, '..');

// 2026-11-25：原 KUGOU_SKIP_TESTS 清单里的 6 个测试（platform-account-sync-guard /
// playback-audio-graph-recovery / search-frontend-pagination / ui-default-theme-shelf-layer /
// home-hero-mp4-platform-recommend / home-dashboard-update）断言的模块、函数、DOM 在本仓库
// 从未存在（或已被用户裁定回滚），自 v3.0.0 起一直红且零覆盖，已删除。
// 现在这里不再跳过任何文件：任何失败都是真回归，不允许再加"已知失败"白名单。

function collectTestFiles() {
  const dir = path.join(cwd, 'tests');
  return fs.readdirSync(dir)
    .filter(function (f) { return /\.test\.js$/.test(f); })
    .sort()
    .map(function (f) { return path.join('tests', f); });
}

function runUnitTests() {
  const files = collectTestFiles();
  console.log('\n========================================');
  console.log('  [1/2] 单元测试  (node --test, ' + files.length + ' files)');
  console.log('========================================');
  const res = spawnSync(process.execPath, ['--test'].concat(files), {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: false
  });
  return res.status === 0;
}

function runQuickCheck() {
  console.log('\n========================================');
  console.log('  [2/2] 静态检查  (quick-check)');
  console.log('========================================');
  const res = spawnSync(process.execPath, ['scripts/quick-check.js'], {
    cwd,
    stdio: 'inherit',
    env: process.env
  });
  return res.status === 0;
}

function main() {
  let ok = true;
  let ran = 0;
  if (mode === 'all' || mode === 'unit') {
    ok = runUnitTests() && ok;
    ran++;
  }
  if (mode === 'all' || mode === 'quick') {
    ok = runQuickCheck() && ok;
    ran++;
  }
  if (ran === 0) {
    console.error('Unknown mode: ' + mode + ' (use all|unit|quick)');
    process.exit(2);
  }
  console.log('\n========================================');
  console.log(ok ? '  ALL TESTS PASSED' : '  TESTS FAILED');
  console.log('========================================');
  process.exit(ok ? 0 : 1);
}

main();
