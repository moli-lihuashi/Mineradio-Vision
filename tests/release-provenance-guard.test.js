'use strict';

/* 发布可追溯性守卫：锁死「构建时溯源 → 服务端接口 → 关于页」整条链路，
   以及语义化版本规则不被后续改动悄悄拆掉。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('构建时必须生成 build-provenance.json，且随包发布', () => {
  const writer = read('scripts/write-build-provenance.js');
  assert.match(writer, /build['"]\s*,\s*['"]build-provenance\.json['"]/, '溯源文件必须写在 build/ 下');
  assert.match(writer, /rev-parse[\s\S]{0,80}HEAD/, '必须记录完整 commit sha');
  assert.match(writer, /builtAt/, '必须记录构建时间');
  assert.match(writer, /treeClean/, '必须标注构建时工作区是否干净');

  const files = JSON.parse(read('package.json')).build.files;
  assert.ok(files.some((f) => /build\/\*\*\/\*/.test(f)), 'build/**/* 必须在 electron-builder 打包清单里');

  const sync = read('scripts/sync-dist-app.js');
  assert.match(sync, /['"]build['"]/, '绿色版同步必须复制 build 目录');

  const ignore = read('.gitignore');
  assert.match(ignore, /build\/build-provenance\.json/, '生成物必须不入库，避免写入 sha 又改变 sha');
});

test('npm run build:win 前自动写溯源，不允许靠手工记得', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['prebuild:win'], 'node scripts/write-build-provenance.js',
    'prebuild:win 钩子必须存在（npm 会在 build:win 前自动执行）');
});

test('/api/debug/build 必须返回随包的构建溯源', () => {
  const lib = read('server/lib/build-provenance.js');
  assert.match(lib, /function readBuildStamp[\s\S]{0,600}build-provenance\.json/, '服务端必须读构建快照');
  assert.match(lib, /build:\s*readBuildStamp\(/, '返回对象必须带 build 字段');
  const route = read('server/routes/debug.js');
  assert.match(route, /\/api\/debug\/build/, '路由分支必须存在');
  assert.match(route, /collectBuildProvenance/, '必须调用溯源模块');
});

test('关于页必须能显示版本 / commit / 构建时间，且带 token 调接口', () => {
  const html = read('public/index.html');
  for (const id of ['about-modal', 'about-version', 'about-commit', 'about-built-at']) {
    assert.ok(html.includes('id="' + id + '"'), '缺少 about DOM: ' + id);
  }
  assert.match(html, /openAboutPanel\(\)/, '必须有打开关于页的入口');

  const js = read('public/js/modules/10-shell/07-about-panel.js');
  assert.match(js, /\/api\/debug\/build/, '关于页必须走已有溯源接口');
  assert.match(js, /X-Mineradio-Token/, '接口调用必须带 token');
  assert.match(js, /about-commit[\s\S]{0,200}about-built-at/s, '必须渲染 commit 与构建时间');

  const loader = read('public/js/index-loader.js');
  assert.match(loader, /10-shell\/07-about-panel\.js/, '新模块必须注册进 loader 列表');
});

test('CI 配置必须跑全量测试并用 npm ci 校验 lock', () => {
  // 规范副本在 docs/ci/tests.yml（一定随仓库发布）。若本地已启用
  // .github/workflows/tests.yml，两者内容必须一致，避免「启用版」悄悄落后。
  const canonical = read('docs/ci/tests.yml');
  const enabledPath = path.join(ROOT, '.github', 'workflows', 'tests.yml');
  if (fs.existsSync(enabledPath)) {
    assert.equal(fs.readFileSync(enabledPath, 'utf8'), canonical,
      '.github/workflows/tests.yml 必须与 docs/ci/tests.yml 完全一致');
  }
  const yml = canonical;
  assert.match(yml, /node scripts\/run-tests\.js/, 'CI 必须跑统一测试入口');
  assert.match(yml, /npm ci/, 'CI 必须用 npm ci（lock 不一致会直接失败）');
  assert.match(yml, /check-version-bump\.js/, 'CI 必须校验语义化版本');
  assert.match(yml, /fetch-depth:\s*0/, '版本检查需要完整 tag 历史');
});

test('版本号在 package / lock / index.html / README 四处一致', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const html = read('public/index.html');
  const readme = read('README.md');
  const v = pkg.version;
  assert.match(v, /^\d+\.\d+\.\d+$/, '版本必须是语义化三段');
  assert.equal(lock.version, v, 'lock 根版本');
  assert.equal(lock.packages[''].version, v, 'lock packages[""] 版本');
  assert.ok(html.includes('data-app-version="' + v + '"'), 'index.html data-app-version');
  assert.ok(readme.includes('version-' + v + '-success'), 'README 版本徽章');
  assert.ok(readme.includes('Mineradio-' + v + '-Setup.exe'), 'README 安装包链接');
  assert.ok(readme.includes('/releases/download/v' + v + '/'), 'README release tag');
  assert.ok(!readme.includes('3.3.1-Setup'), '不能残留旧版下载链接');
});

test('Release 正文固定溯源行由脚本生成，不靠手写', () => {
  const maker = read('scripts/make-release-notes.js');
  assert.match(maker, /构建自 commit/, '正文必须含固定溯源行');
  assert.match(maker, /SHA256/, '正文必须附资产校验值');
  assert.match(maker, /build-provenance\.json/, '必须复用同一份构建快照，避免正文与包内不一致');
});
