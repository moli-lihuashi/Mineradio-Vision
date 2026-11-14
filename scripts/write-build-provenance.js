'use strict';

// =============================================================================
// 构建时写入溯源快照。生成物不入库（.gitignore），避免「写入 sha 又改变 sha」
// 的自引用；package.json 的 build.files 含 build/**/*，electron-builder 会把它
// 打进安装包，sync-dist-app.js 也会整目录复制进绿色版。
//
// 用法：node scripts/write-build-provenance.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'build-provenance.json');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf8', timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) { return ''; }
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const commit = git(['rev-parse', 'HEAD']) || 'unknown';
const short = commit === 'unknown' ? 'unknown' : commit.slice(0, 12);
const dirty = git(['status', '--porcelain']);
const builtAt = new Date().toISOString();

const payload = {
  schema: 1,
  version,
  commit,
  commitShort: short,
  builtAt,
  // 有未提交改动时如实标注，避免把「本地脏树构建」当成干净发布
  treeClean: dirty === '',
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log('written', path.relative(ROOT, OUT));
console.log('  version   =', version);
console.log('  commit    =', commit);
console.log('  builtAt   =', builtAt);
console.log('  treeClean =', payload.treeClean);
