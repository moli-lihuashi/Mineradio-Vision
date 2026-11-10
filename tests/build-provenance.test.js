'use strict';

/* =============================================================================
 * A5 构建溯源 — 行为测试
 * 在临时目录造一份源码树 + dist 副本，直接验证「改了没同步」能不能被判出来。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const { TRACKED_FILES, sha256Of, collectBuildProvenance } =
  require(path.join(appRoot, 'server/lib/build-provenance'));

function makeRoot(withDist) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-provenance-'));
  const write = (rel, content) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('package.json', JSON.stringify({ name: 'mineradio-test', version: '1.2.3' }));
  write('public/index.html', '<html data-app-version="9.9.9"></html>');
  for (const rel of TRACKED_FILES) {
    if (rel === 'public/index.html') continue;
    write(rel, 'source:' + rel);
    if (withDist) write(path.join('dist/Mineradio/resources/app', rel), 'source:' + rel);
  }
  if (withDist) write('dist/Mineradio/resources/app/public/index.html', '<html data-app-version="9.9.9"></html>');
  return { root, write };
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
}

test('源码与 dist 完全一致时判定 synced，并读出版本信息', () => {
  const { root } = makeRoot(true);
  try {
    const r = collectBuildProvenance({ appRoot: root, runtimeAppRoot: root, now: () => 1700000000000 });
    assert.equal(r.kind, 'source');
    assert.equal(r.version, '1.2.3');
    assert.equal(r.appVersion, '9.9.9');
    assert.equal(r.generatedAt, new Date(1700000000000).toISOString());
    assert.equal(r.dist.present, true);
    assert.equal(r.dist.synced, true);
    assert.deepEqual(r.dist.mismatches, []);
    assert.ok(r.files.every(f => f.synced));
    assert.equal(r.files.length, TRACKED_FILES.length);
  } finally { cleanup(root); }
});

test('dist 里有一个文件是旧内容时，精确指出文件名并给出同步提示', () => {
  const { root, write } = makeRoot(true);
  try {
    const stale = 'public/js/modules/06-lyrics/02-playlist-detail.js';
    write(path.join('dist/Mineradio/resources/app', stale), 'STALE OLD BUILD');
    const r = collectBuildProvenance({ appRoot: root, runtimeAppRoot: root });
    assert.equal(r.dist.synced, false);
    assert.deepEqual(r.dist.mismatches, [stale]);
    const f = r.files.find(item => item.path === stale);
    assert.equal(f.synced, false);
    assert.notEqual(f.sourceSha256, f.distSha256);
    assert.ok(r.hints.some(h => h.includes('sync-dist-app.js')));
  } finally { cleanup(root); }
});

test('跑在打包副本里且源码不一致时，点明「当前进程跑的是旧副本」', () => {
  const { root, write } = makeRoot(true);
  try {
    write('dist/Mineradio/resources/app/server.js', 'STALE');
    const runtime = path.join(root, 'dist', 'Mineradio', 'resources', 'app', 'server', 'routes');
    const r = collectBuildProvenance({ appRoot: root, runtimeAppRoot: runtime });
    assert.equal(r.kind, 'packaged');
    assert.equal(r.dist.synced, false);
    assert.ok(r.hints.some(h => h.includes('打包副本')));
  } finally { cleanup(root); }
});

test('跑在打包副本里时，仍能从运行时目录定位源码树，不误报「未找到 dist」', () => {
  const { root } = makeRoot(true);
  try {
    const distApp = path.join(root, 'dist', 'Mineradio', 'resources', 'app');
    const runtime = path.join(distApp, 'server', 'routes');
    // 真实调用形态：appRoot 是运行时根目录，runtimeAppRoot 是 routes 的 __dirname。
    const r = collectBuildProvenance({ appRoot: distApp, runtimeAppRoot: runtime });
    assert.equal(r.kind, 'packaged');
    assert.equal(r.dist.present, true, '打包副本里绝不能误报未找到 dist');
    assert.equal(r.dist.synced, true);
    assert.equal(r.sourceRoot, root);
    assert.equal(r.appVersion, '9.9.9', '版本信息要从源码树读');
  } finally { cleanup(root); }
});

test('没有 dist 树时如实标注，不假装同步', () => {
  const { root } = makeRoot(false);
  try {
    const r = collectBuildProvenance({ appRoot: root, runtimeAppRoot: root });
    assert.equal(r.dist.present, false);
    assert.equal(r.dist.synced, false);
    assert.deepEqual(r.dist.mismatches, []);
    assert.ok(r.hints.some(h => h.includes('未找到')));
  } finally { cleanup(root); }
});

test('sha256Of 对缺失文件返回 null 而不抛', () => {
  assert.equal(sha256Of(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now())), null);
});

test('追踪清单覆盖最容易「改了没反应」的运行时文件', () => {
  for (const rel of ['server.js', 'public/index.html', 'public/js/index-loader.js',
    'public/js/modules/06-lyrics/02-playlist-detail.js',
    'server/lib/self-check.js', 'server/lib/cache-prune.js', 'server/routes/debug.js',
    'public/js/modules/00-state/00-storage-migration.js',
    'public/js/modules/05-playback/09f-playback-source-revision.js',
    'public/js/modules/10-shell/05-diagnostics.js']) {
    assert.ok(TRACKED_FILES.includes(rel), rel + ' 必须在溯源清单里');
  }
});
