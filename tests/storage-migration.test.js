'use strict';

/* =============================================================================
 * B2 版本化存档读写 — 行为测试
 *
 * 跑真实源码（00-storage-migration.js 进 vm），喂一个内存 storage。
 * 核心是两条不能违反的规则：
 *   · 旧档（无 v）必须交给 migrate，且迁移结果立即回写；
 *   · 未来版本（v 比本端高）既不读也不覆盖 —— 降级运行时写回高版本档 = 丢用户数据。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const moduleSrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/00-state/00-storage-migration.js'), 'utf8');

function loadModule(extra) {
  const sandbox = Object.assign({ console }, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(moduleSrc, sandbox);
  return sandbox;
}

function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    read(key) { return JSON.parse(map.get(key)); },
    has(key) { return map.has(key); },
    raw(key) { return map.get(key); },
  };
}

test('同版本直接读取，不触发迁移', () => {
  const sandbox = loadModule();
  const storage = makeStorage({ k: JSON.stringify({ v: 1, at: 111, list: [1, 2] }) });
  let migrateCalls = 0;
  const result = sandbox.readVersionedJson('k', {
    version: 1,
    storage,
    migrate() { migrateCalls += 1; return {}; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.migrated, false);
  assert.equal(result.version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value.list)), [1, 2],
    '值来自 vm 沙箱，跨 realm 的数组不能直接 deepStrictEqual');
  assert.equal(migrateCalls, 0, '同版本不该调迁移');
});

test('旧档（无 v）按 v0 交给 migrate，结果立即回写', () => {
  const sandbox = loadModule();
  const storage = makeStorage({ k: JSON.stringify({ at: 5, playlists: [{ id: 'p1' }] }) });
  const seen = [];
  const result = sandbox.readVersionedJson('k', {
    version: 1,
    storage,
    migrate(parsed, from, to) {
      seen.push([from, to, parsed.playlists.length]);
      return { at: parsed.at, playlists: parsed.playlists };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.deepEqual(seen, [[0, 1, 1]]);

  const written = storage.read('k');
  assert.equal(written.v, 1, '迁移结果必须带新版本号回写');
  assert.equal(written.at, 5, '回写要保留原 at，不能刷新成现在');
  assert.deepEqual(written.playlists, [{ id: 'p1' }]);
});

test('未来版本既不读也不覆盖（降级运行不能吃掉高版本档）', () => {
  const sandbox = loadModule();
  const original = JSON.stringify({ v: 9, at: 7, playlists: [{ id: 'from-newer-build' }] });
  const storage = makeStorage({ k: original });
  let migrateCalls = 0;
  const result = sandbox.readVersionedJson('k', {
    version: 1,
    storage,
    migrate() { migrateCalls += 1; return {}; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'future-version');
  assert.equal(result.version, 9);
  assert.equal(result.value, null);
  assert.equal(migrateCalls, 0);
  assert.equal(storage.raw('k'), original, '高版本档必须原封不动');
});

test('负数 / 非数字的 v 当作 v0，不会误判成未来版本', () => {
  const sandbox = loadModule();
  for (const raw of [{ v: -1, a: 1 }, { v: 'x', a: 1 }, { v: null, a: 1 }]) {
    const storage = makeStorage({ k: JSON.stringify(raw) });
    let from = null;
    const result = sandbox.readVersionedJson('k', {
      version: 1, storage, migrate(_parsed, f) { from = f; return { a: 1 }; },
    });
    assert.equal(result.ok, true);
    assert.equal(from, 0, '脏 v 一律按 v0 处理：' + JSON.stringify(raw));
  }
});

test('解析失败 / 非对象 / 空值都返回结构化原因，且不写盘', () => {
  const sandbox = loadModule();
  const broken = makeStorage({ k: '{ not json' });
  const r1 = sandbox.readVersionedJson('k', { version: 1, storage: broken, migrate: () => ({}) });
  assert.equal(r1.reason, 'parse-failed');
  assert.equal(broken.raw('k'), '{ not json', '坏档不该被覆盖');

  const array = makeStorage({ k: '[1,2,3]' });
  const r2 = sandbox.readVersionedJson('k', { version: 1, storage: array, migrate: () => ({}) });
  assert.equal(r2.reason, 'not-object');

  const empty = makeStorage({});
  const r3 = sandbox.readVersionedJson('k', { version: 1, storage: empty, migrate: () => ({}) });
  assert.equal(r3.reason, 'empty');
  assert.equal(empty.has('k'), false, '没东西可读时不该凭空写出一个档');
});

test('存储不可用 / 读抛错都不向外抛异常', () => {
  const sandbox = loadModule();
  const noStorage = sandbox.readVersionedJson('k', { version: 1, migrate: () => ({}) });
  assert.equal(noStorage.ok, false);
  assert.equal(noStorage.reason, 'no-storage');

  const throwing = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  const readFailed = sandbox.readVersionedJson('k', { version: 1, storage: throwing, migrate: () => ({}) });
  assert.equal(readFailed.reason, 'read-failed');
});

test('旧档但没有 migrate：返回 no-migrator，不猜也不写', () => {
  const sandbox = loadModule();
  const original = JSON.stringify({ a: 1 });
  const storage = makeStorage({ k: original });
  const result = sandbox.readVersionedJson('k', { version: 1, storage });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-migrator');
  assert.equal(storage.raw('k'), original);
});

test('migrate 返回非对象时判为迁移失败，保留原档', () => {
  const sandbox = loadModule();
  const original = JSON.stringify({ a: 1 });
  const storage = makeStorage({ k: original });
  const result = sandbox.readVersionedJson('k', {
    version: 1, storage, migrate() { return null; },
  });
  assert.equal(result.reason, 'migrate-failed');
  assert.equal(storage.raw('k'), original);
});

test('写入带 v；默认补 at；keepTimestamp 时保留已有 at', () => {
  const sandbox = loadModule();
  const storage = makeStorage({});
  assert.equal(sandbox.writeVersionedJson('k', { a: 1 }, 1, storage), true);
  const first = storage.read('k');
  assert.equal(first.v, 1);
  assert.equal(typeof first.at, 'number');
  assert.equal(first.a, 1);

  const kept = storage.read('k').at;
  sandbox.writeVersionedJson('k', { a: 2, at: kept - 1000 }, 1, storage, true);
  assert.equal(storage.read('k').at, kept - 1000, '调用方给了 at 就尊重它');

  sandbox.writeVersionedJson('k', { b: 3 }, 1, storage);
  assert.equal(typeof storage.read('k').at, 'number', '没给 at 时补一个新的');
});

test('写入失败（配额 / 存储不可用）返回 false 而不是抛', () => {
  const sandbox = loadModule();
  const throwing = { setItem() { throw new Error('QuotaExceededError'); }, getItem: () => null };
  assert.equal(sandbox.writeVersionedJson('k', { a: 1 }, 1, throwing), false);
  assert.equal(sandbox.writeVersionedJson('k', { a: 1 }, 1, null), false);
});

test('写入不会因为业务字段叫 v 而把版本号写乱', () => {
  const sandbox = loadModule();
  const storage = makeStorage({});
  sandbox.writeVersionedJson('k', { v: '用户自己的字段', a: 1 }, 1, storage);
  assert.equal(storage.read('k').v, 1, '版本号由模块决定');
  assert.equal(storage.read('k').a, 1);
});
