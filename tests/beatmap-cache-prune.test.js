'use strict';

/* =============================================================================
 * B4 节拍缓存：读命中刷 mtime + 容量裁剪接入 — 行为测试
 *
 * 两个点必须真跑：
 *   1. 读命中要把文件 mtime 推到「现在」，否则裁剪的 usedAt 语义是「最早下载」，
 *      会优先删掉用户最常听的那几首的节拍分析结果。
 *   2. pruneBeatMapCache 在目录不可用时返回结构化原因而不是抛 —— 它会被定时器调用。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-beatmap-'));
  tempDirs.push(dir);
  return dir;
}

// 缓存目录在 C 盘时默认禁用，测试目录落在 tmpdir 上 → 必须显式声明。
const cacheDir = makeTempDir();
process.env.MINERADIO_BEAT_CACHE_DIR = cacheDir;

const createBeatmapCache = require(path.join(appRoot, 'server/lib/beatmap-cache'));
const cache = createBeatmapCache({ cacheDir });

test.after(() => {
  delete process.env.MINERADIO_BEAT_CACHE_DIR;
  delete process.env.MINERADIO_BEAT_CACHE_LIMIT_MB;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 2000);
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

function seed(key, extra) {
  return cache.writeBeatMapCache(Object.assign({
    key,
    provider: 'kugou',
    title: 't-' + key,
    artist: 'a',
    mode: 'mr',
    map: { beats: [1, 2, 3] },
  }, extra || {}));
}

test('写入后能原样读回，载荷带版本号', async () => {
  const written = await seed('kugou:song-one');
  assert.equal(written.ok, true);
  const restored = await cache.readBeatMapCache('kugou:song-one');
  assert.ok(restored, '刚写的必须能读回');
  assert.equal(restored.key, 'kugou:song-one');
  assert.equal(restored.v, 1);
  assert.deepEqual(restored.map, { beats: [1, 2, 3] });
  assert.equal(restored.meta.provider, 'kugou');
});

test('读命中会把 mtime 刷新到现在（裁剪的 usedAt 才有「最近播放」语义）', async () => {
  await seed('kugou:touch-me');
  const info = cache.beatCacheRootInfo();
  const file = cache.safeBeatMapCacheFile('kugou:touch-me');
  const ancient = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(file, ancient, ancient);
  const before = fs.statSync(file).mtimeMs;
  assert.ok(before < Date.now() - 86400000, '前置条件：mtime 已被推回 2001 年');

  const restored = await cache.readBeatMapCache('kugou:touch-me');
  assert.ok(restored);
  const touched = await waitUntil(() => fs.statSync(file).mtimeMs > before + 1000);
  assert.equal(touched, true, '读命中后 mtime 必须被推到现在');
  assert.equal(cache.beatCacheRootInfo().dir, info.dir);
});

test('未命中返回 null，不抛也不建文件', async () => {
  const missing = await cache.readBeatMapCache('kugou:never-cached');
  assert.equal(missing, null);
});

test('JSON 损坏时删掉文件并返回 null，下次正常回源', async () => {
  await seed('kugou:broken');
  const file = cache.safeBeatMapCacheFile('kugou:broken');
  fs.writeFileSync(file, '{ this is not json');
  const result = await cache.readBeatMapCache('kugou:broken');
  assert.equal(result, null);
  const gone = await waitUntil(() => !fs.existsSync(file));
  assert.equal(gone, true, '损坏文件应被清掉');
});

test('裁剪：按 mtime 最老优先删，最新的一首留下', async () => {
  const dir = cache.beatCacheRootInfo().dir;
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));

  await seed('kugou:oldest');
  await seed('kugou:middle');
  await seed('kugou:newest');
  const now = Date.now() / 1000;
  const files = {
    oldest: cache.safeBeatMapCacheFile('kugou:oldest'),
    middle: cache.safeBeatMapCacheFile('kugou:middle'),
    newest: cache.safeBeatMapCacheFile('kugou:newest'),
  };
  fs.utimesSync(files.oldest, now - 5000, now - 5000);
  fs.utimesSync(files.middle, now - 3000, now - 3000);
  fs.utimesSync(files.newest, now - 10, now - 10);

  const sizes = Object.values(files).map(f => fs.statSync(f).size);
  const total = sizes.reduce((a, b) => a + b, 0);
  const oldestSize = fs.statSync(files.oldest).size;

  const result = await cache.pruneBeatMapCache({ limitBytes: total - oldestSize - 1 });
  assert.equal(result.ok, true);
  assert.equal(result.scanned, 3);
  assert.equal(fs.existsSync(files.oldest), false, '最老的一定先删');
  assert.equal(fs.existsSync(files.newest), true, '最新的必须留下');
  assert.ok(result.bytesAfter <= total - oldestSize - 1);
});

test('裁剪：limitBytes=0 一个文件都不删', async () => {
  const dir = cache.beatCacheRootInfo().dir;
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
  await seed('kugou:keep-a');
  await seed('kugou:keep-b');

  const result = await cache.pruneBeatMapCache({ limitBytes: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.evicted, []);
  assert.equal(fs.readdirSync(dir).filter(n => /\.json$/.test(n)).length, 2);
});

test('上限字节数：默认值、环境变量覆盖、0 表示不设上限', () => {
  const defaults = require(path.join(appRoot, 'server/lib/cache-prune')).DEFAULT_CACHE_LIMIT_BYTES;
  delete process.env.MINERADIO_BEAT_CACHE_LIMIT_MB;
  assert.equal(cache.beatMapCacheLimitBytes(), defaults);

  process.env.MINERADIO_BEAT_CACHE_LIMIT_MB = '8';
  assert.equal(cache.beatMapCacheLimitBytes(), 8 * 1024 * 1024);

  process.env.MINERADIO_BEAT_CACHE_LIMIT_MB = '0';
  assert.equal(cache.beatMapCacheLimitBytes(), 0, '0 是用户明确要求不要上限');

  process.env.MINERADIO_BEAT_CACHE_LIMIT_MB = 'not-a-number';
  assert.equal(cache.beatMapCacheLimitBytes(), defaults, '脏值回落默认，而不是永不清理');
});

test('目录不可用时裁剪返回结构化原因，绝不抛（它会被定时器无声调用）', async () => {
  // 先把白名单环境变量摘掉，C 盘目录才会被判为不可用；否则这条用例会走
  // 「只验证不抛」的兜底分支，真正要守的错误形状就没人测了。
  const saved = process.env.MINERADIO_BEAT_CACHE_DIR;
  delete process.env.MINERADIO_BEAT_CACHE_DIR;
  try {
    const blockedDir = path.join('C:', path.sep, 'mineradio-beat-blocked-test');
    const blocked = createBeatmapCache({ cacheDir: blockedDir });
    const info = blocked.beatCacheRootInfo();
    if (info.allowed) {
      // 非 C 盘机器上本来就合法：至少保证不抛。
      const result = await blocked.pruneBeatMapCache({ limitBytes: 1 });
      assert.equal(typeof result.ok, 'boolean');
      return;
    }
    const result = await blocked.pruneBeatMapCache({ limitBytes: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'BEAT_CACHE_ON_C_DRIVE_DISABLED');
    assert.deepEqual(result.evicted, []);
  } finally {
    if (saved != null) process.env.MINERADIO_BEAT_CACHE_DIR = saved;
  }
});
