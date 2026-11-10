'use strict';

/* =============================================================================
 * B4 磁盘缓存容量裁剪 — 行为测试
 *
 * 淘汰规则必须是纯函数且方向正确：按「最久未使用优先」删。排序方向反了会先丢
 * 最常听的、留下从不回访的，而这种错在真机上几乎看不出来，只能靠测试看住。
 * pruneDirectory 起真实临时目录，断言真的删了哪些、没删哪些。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const cachePrune = require(path.join(appRoot, 'server/lib/cache-prune'));

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cache-prune-'));
}

test('上限解析：0 表示「真的不要上限」，坏值回落到默认上限而不是永不清理', () => {
  assert.equal(cachePrune.resolveCacheLimit(0), Infinity);
  assert.equal(cachePrune.resolveCacheLimit(1024), 1024);
  assert.equal(cachePrune.resolveCacheLimit(undefined), cachePrune.DEFAULT_CACHE_LIMIT_BYTES);
  assert.equal(cachePrune.resolveCacheLimit(-1), cachePrune.DEFAULT_CACHE_LIMIT_BYTES);
  assert.equal(cachePrune.resolveCacheLimit(NaN), cachePrune.DEFAULT_CACHE_LIMIT_BYTES);
  assert.equal(cachePrune.resolveCacheLimit(null), cachePrune.DEFAULT_CACHE_LIMIT_BYTES);
});

test('总量没超上限时一个都不淘汰', () => {
  const entries = [
    { name: 'a.json', size: 10, usedAt: 1 },
    { name: 'b.json', size: 10, usedAt: 2 },
  ];
  assert.deepEqual(cachePrune.selectEvictions(entries, 100), []);
  assert.deepEqual(cachePrune.selectEvictions(entries, 20), [], '刚好等于上限也不删');
  assert.deepEqual(cachePrune.selectEvictions([], 1), []);
  assert.deepEqual(cachePrune.selectEvictions(null, 1), []);
});

test('按最久未使用优先淘汰，最常听的那份一定留下', () => {
  const entries = [
    { name: 'old.json', size: 100, usedAt: 1 },
    { name: 'hot.json', size: 100, usedAt: 9 },
    { name: 'mid.json', size: 100, usedAt: 5 },
  ];
  // 总量 300，上限 150 → 先删 old(1) → 200 还超 → 再删 mid(5) → 100 达标
  assert.deepEqual(cachePrune.selectEvictions(entries, 150), ['old.json', 'mid.json']);
  assert.ok(!cachePrune.selectEvictions(entries, 150).includes('hot.json'));
});

test('缺 usedAt / size 的脏条目不会让排序炸掉', () => {
  const entries = [
    { name: 'n1.json', size: 100 },
    { name: 'n2.json', size: 100, usedAt: null },
    { name: 'n3.json', size: 100, usedAt: 7 },
  ];
  const evicted = cachePrune.selectEvictions(entries, 150);
  assert.equal(evicted.length, 2);
  assert.ok(evicted.includes('n1.json') || evicted.includes('n2.json'));
  assert.ok(!evicted.includes('n3.json'), '有明确最近使用时间的要留下');
});

test('目录裁剪：真删最老的，非 .json 一律不碰', async () => {
  const dir = makeTempDir();
  try {
    const now = Date.now() / 1000;
    const files = [
      ['old.json', 200, now - 3000],
      ['mid.json', 200, now - 2000],
      ['new.json', 200, now - 100],
      ['notes.txt', 5000, now - 4000],
    ];
    for (const [name, size, at] of files) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, 'x'.repeat(size));
      fs.utimesSync(file, at, at);
    }
    const result = await cachePrune.pruneDirectory({ dir, limitBytes: 250 });
    assert.equal(result.ok, true);
    assert.equal(result.scanned, 3, '只统计 .json');
    assert.deepEqual(result.evicted.sort(), ['mid.json', 'old.json']);
    assert.equal(result.removed, 2);
    assert.equal(result.bytesBefore, 600);
    assert.equal(result.bytesAfter, 200);
    assert.equal(fs.existsSync(path.join(dir, 'new.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 'notes.txt')), true, '非缓存文件绝不能删');
    assert.equal(fs.existsSync(path.join(dir, 'old.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('limitBytes=0 时目录裁剪不动任何文件', async () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.json'), 'x'.repeat(1000));
    const result = await cachePrune.pruneDirectory({ dir, limitBytes: 0 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.evicted, []);
    assert.equal(fs.existsSync(path.join(dir, 'a.json')), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('目录不存在当作「还没缓存」，不是失败', async () => {
  const result = await cachePrune.pruneDirectory({
    dir: path.join(os.tmpdir(), 'mr-cache-prune-does-not-exist-' + Date.now()),
  });
  assert.equal(result.ok, true);
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.evicted, []);
});

test('没给目录 / 读目录失败都返回结构化原因，不抛', async () => {
  const noDir = await cachePrune.pruneDirectory({});
  assert.equal(noDir.ok, false);
  assert.equal(noDir.error, 'CACHE_DIR_REQUIRED');

  const notADir = await cachePrune.pruneDirectory({ dir: path.join(appRoot, 'package.json') });
  assert.equal(notADir.ok, false);
  assert.ok(notADir.error, '必须带回错误码');
});
