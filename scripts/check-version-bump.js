'use strict';

// =============================================================================
// 语义化版本检查：加用户可见功能 bump minor，只修 bug bump patch。
//
// 用法：
//   node scripts/check-version-bump.js --base origin/main
//   node scripts/check-version-bump.js --base v3.3.1        # 也可对 tag 比
//
// 判定基于 Conventional Commits 前缀（本仓库现有提交都遵循）：
//   feat(...)        -> minor（用户可见功能）
//   fix / perf(...)  -> patch（修 bug / 性能修复）
//   docs/test/chore/refactor/build/ci/style/revert -> none（无需 bump）
// 未匹配前缀的提交按 none 处理并提示，不静默放过。
//
// 用途：CI 的 PR 检查里比较 merge-base，避免「功能加了版本号不动」导致
// issue 里无法定位用户用的是哪一版。
// =============================================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function formatVersion(v) { return v.join('.'); }
function bumpPatch(v) { return [v[0], v[1], v[2] + 1]; }
function bumpMinor(v) { return [v[0], v[1] + 1, 0]; }

/** 纯函数：按提交 subject 列表判定所需的最低 bump 级别。 */
function classifyBump(subjects) {
  let minor = false;
  let patch = false;
  const unknown = [];
  for (const raw of subjects) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (/^feat(\([^)]*\))?!?:/i.test(s)) { minor = true; continue; }
    if (/^(fix|perf)(\([^)]*\))?!?:/i.test(s)) { patch = true; continue; }
    if (/^(docs|test|tests|chore|refactor|build|ci|style|revert|merge)(\([^)]*\))?!?:|^Merge /i.test(s)) continue;
    unknown.push(s);
  }
  return { level: minor ? 'minor' : (patch ? 'patch' : 'none'), unknown };
}

/** 纯函数：给出期望版本与是否满足。 */
function evaluateVersionBump(baseVersion, currentVersion, level) {
  const base = parseVersion(baseVersion);
  const current = parseVersion(currentVersion);
  if (!base || !current) return { ok: false, reason: '版本号不是合法 semver：base=' + baseVersion + ' current=' + currentVersion };
  if (level === 'none') return { ok: true, expected: formatVersion(current), reason: '只有无需发版的提交' };
  const expected = level === 'minor' ? bumpMinor(base) : bumpPatch(base);
  if (compareVersion(current, expected) < 0) {
    return {
      ok: false,
      expected: formatVersion(expected),
      reason: '包含 ' + level + ' 级改动，版本至少应为 ' + formatVersion(expected) + '，当前 ' + formatVersion(current),
    };
  }
  return { ok: true, expected: formatVersion(expected), reason: '版本 ' + formatVersion(current) + ' 满足 ' + level + ' 要求（>= ' + formatVersion(expected) + '）' };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readVersionAt(ref) {
  try {
    return JSON.parse(git(['show', ref + ':package.json'])).version;
  } catch (_) {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  let base = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) base = args[++i];
  }
  if (!base) {
    try { base = git(['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim(); }
    catch (_) { base = null; }
  }
  if (!base) {
    console.error('[version] 找不到基线 tag，且未指定 --base，跳过版本检查。');
    process.exit(0);
  }

  let mergeBase;
  try { mergeBase = git(['merge-base', base, 'HEAD']).trim(); }
  catch (_) { mergeBase = base; }
  const baseVersion = readVersionAt(mergeBase) || readVersionAt(base);
  const currentVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (!baseVersion) {
    console.error('[version] 无法从基线读取 package.json 版本，跳过。');
    process.exit(0);
  }

  const log = git(['log', '--format=%s', mergeBase + '..HEAD']);
  const subjects = log.split('\n').filter(Boolean);
  const { level, unknown } = classifyBump(subjects);
  const result = evaluateVersionBump(baseVersion, currentVersion, level);

  console.log('[version] 基线 ' + base + ' @ ' + mergeBase.slice(0, 7) + ' v' + baseVersion);
  console.log('[version] 当前 package.json v' + currentVersion + '，' + subjects.length + ' 个提交，需要 ' + level);
  if (unknown.length) {
    console.warn('[version] 以下提交未匹配 Conventional 前缀，按无需发版处理：');
    unknown.slice(0, 5).forEach(s => console.warn('  - ' + s));
  }
  if (!result.ok) {
    console.error('[version] BLOCKED: ' + result.reason);
    process.exit(1);
  }
  console.log('[version] PASS: ' + result.reason);
}

if (require.main === module) main();

module.exports = { parseVersion, compareVersion, bumpPatch, bumpMinor, classifyBump, evaluateVersionBump };
