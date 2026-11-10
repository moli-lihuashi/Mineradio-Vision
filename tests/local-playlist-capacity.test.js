'use strict';

// =============================================================================
// 本地歌单容量上限（回归）
// 旧实现：createLocalPlaylist 先 unshift，writeLocalPlaylists 再 slice(0, 50)，
// 于是第 51 个歌单会静默把最早的一个从持久化存储里挤掉，而调用方仍拿到「成功」。
// 现在要求：容量满时明确拒绝，写入不截断，批量导入准确反馈成功数与上限。
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const modulePath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '12-local-playlists.js');
const source = fs.readFileSync(modulePath, 'utf8');

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    _raw: map,
  };
}

function createSandbox(storage) {
  const toasts = [];
  const sandbox = {
    console,
    JSON,
    String,
    Array,
    Object,
    Date,
    Math,
    Number,
    localStorage: storage,
    toasts,
    showToast(message) { toasts.push(String(message)); },
    cloneSong(song) { return Object.assign({}, song); },
    document: { getElementById() { return null; }, createElement() { return null; } },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: modulePath });
  return sandbox;
}

function seedPlaylists(sandbox, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      id: 'seed-' + i,
      name: 'Seed ' + i,
      cover: '',
      creator: '本地歌单',
      provider: 'local',
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
      songs: [{ provider: 'netease', id: 's' + i, name: 'S' + i, artist: 'A' }],
    });
  }
  const ok = sandbox.writeLocalPlaylists(list);
  assert.strictEqual(ok, true, '种子数据应当写入成功');
  return list;
}

function payloadOf(name, songs) {
  return { name: name, songs: songs };
}

function tracks(count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ provider: 'netease', id: 't' + i, name: 'T' + i, artist: 'A' });
  return out;
}

// --- 第 51 个歌单必须被明确拒绝，且不删除旧歌单 -----------------------------
function testCreateBeyondCapacityIsRejected() {
  const storage = createStorage();
  const sandbox = createSandbox(storage);
  const seeded = seedPlaylists(sandbox, sandbox.LOCAL_PLAYLIST_MAX_COUNT);
  const oldestId = seeded[0].id;

  const created = sandbox.createLocalPlaylist('One More', tracks(2));

  assert.strictEqual(created, null, '达到上限后新建必须返回失败');
  assert(sandbox.toasts.some(text => /上限/.test(text)), '必须提示已达上限而不是静默失败');
  const stored = sandbox.readLocalPlaylists();
  assert.strictEqual(stored.length, sandbox.LOCAL_PLAYLIST_MAX_COUNT, '存储里的歌单数量必须不变');
  assert(stored.some(item => item.id === oldestId), '最早的歌单不能被静默删除');
  assert(!stored.some(item => item.name === 'One More'), '被拒绝的歌单不能落盘');
}

// --- 写入层不得再截断 -------------------------------------------------------
function testWriteNeverTruncates() {
  const storage = createStorage();
  const sandbox = createSandbox(storage);
  const seeded = seedPlaylists(sandbox, 3);
  const overflow = seeded.concat([{
    id: 'extra-1', name: 'Extra 1', cover: '', creator: '本地歌单', provider: 'local',
    createdAt: 9, updatedAt: 9, songs: [],
  }]).concat(new Array(sandbox.LOCAL_PLAYLIST_MAX_COUNT).fill(null).map((_, index) => ({
    id: 'overflow-' + index, name: 'Overflow ' + index, cover: '', creator: '本地歌单', provider: 'local',
    createdAt: 9, updatedAt: 9, songs: [],
  })));

  const ok = sandbox.writeLocalPlaylists(overflow);

  assert.strictEqual(ok, false, '超过上限的写入必须失败');
  assert.strictEqual(sandbox.readLocalPlaylists().length, 3, '失败写入不得改动既有数据');
  assert(sandbox.readLocalPlaylists().some(item => item.id === 'seed-0'), '既有歌单完整保留');
}

// --- 批量导入：满容量时准确反馈 ---------------------------------------------
function testImportIntoFullStoreReportsLimit() {
  const storage = createStorage();
  const sandbox = createSandbox(storage);
  const seeded = seedPlaylists(sandbox, sandbox.LOCAL_PLAYLIST_MAX_COUNT);
  const before = sandbox.readLocalPlaylists().map(item => item.id);

  const result = sandbox.importLocalPlaylistsFromPayload([
    payloadOf('Import A', tracks(2)),
    payloadOf('Import B', tracks(2)),
    payloadOf('Import C', tracks(2)),
  ]);

  assert.strictEqual(result.imported, 0, '满容量时不能谎报导入成功');
  assert.strictEqual(result.skipped, 3);
  assert.strictEqual(result.limitReached, true);
  assert.strictEqual(result.capacity, sandbox.LOCAL_PLAYLIST_MAX_COUNT);
  const after = sandbox.readLocalPlaylists().map(item => item.id);
  assert.deepStrictEqual(after, before, '导入失败不得删除或覆盖已有歌单');
  assert.strictEqual(after[0], seeded[0].id);
}

// --- 批量导入：部分成功时成功数准确 -----------------------------------------
function testImportPartialSuccessIsAccurate() {
  const storage = createStorage();
  const sandbox = createSandbox(storage);
  const seeded = seedPlaylists(sandbox, sandbox.LOCAL_PLAYLIST_MAX_COUNT - 2);
  const oldestId = seeded[0].id;

  const result = sandbox.importLocalPlaylistsFromPayload([
    payloadOf('Import A', tracks(2)),
    payloadOf('Import B', tracks(2)),
    payloadOf('Import C', tracks(2)),
    payloadOf('Import D', tracks(2)),
  ]);

  assert.strictEqual(result.imported, 2, '只能导入还装得下的两个');
  assert.strictEqual(result.skipped, 2);
  assert.strictEqual(result.limitReached, true);
  const stored = sandbox.readLocalPlaylists();
  assert.strictEqual(stored.length, sandbox.LOCAL_PLAYLIST_MAX_COUNT);
  assert(stored.some(item => item.id === oldestId), '导入不能挤掉最早的歌单');
  assert(stored.some(item => item.name === 'Import A'));
  assert(stored.some(item => item.name === 'Import B'));
  assert(!stored.some(item => item.name === 'Import C'));
}

// --- 批量导入：全部装得下时如实返回 -----------------------------------------
function testImportFitsCompletely() {
  const storage = createStorage();
  const sandbox = createSandbox(storage);

  const result = sandbox.importLocalPlaylistsFromPayload([
    payloadOf('Import A', tracks(2)),
    payloadOf('Import B', tracks(2)),
  ]);

  assert.deepStrictEqual(
    { imported: result.imported, skipped: result.skipped, limitReached: result.limitReached },
    { imported: 2, skipped: 0, limitReached: false }
  );
  assert.strictEqual(sandbox.readLocalPlaylists().length, 2);
}

// --- 删除后腾出容量可以再次新增 ---------------------------------------------
function testCapacityFreedByDelete() {
  const storage = createStorage();
  const sandbox = createSandbox(storage);
  const seeded = seedPlaylists(sandbox, sandbox.LOCAL_PLAYLIST_MAX_COUNT);
  assert.strictEqual(sandbox.createLocalPlaylist('Blocked', tracks(1)), null);

  assert.strictEqual(sandbox.deleteLocalPlaylistById(seeded[0].id), true);
  const created = sandbox.createLocalPlaylist('Allowed', tracks(1));

  assert(created, '删除后应当可以再新建');
  const stored = sandbox.readLocalPlaylists();
  assert.strictEqual(stored.length, sandbox.LOCAL_PLAYLIST_MAX_COUNT);
  assert(stored.some(item => item.name === 'Allowed'));
  assert(!stored.some(item => item.id === seeded[0].id), '被删除的歌单不应复活');
  assert(stored.some(item => item.id === seeded[1].id), '其余歌单必须完整');
}

// --- 静态接线：写入层不允许 slice 截断 --------------------------------------
function testNoSilentSliceInWriter() {
  assert(!/playlists:\s*list\.slice\(0,\s*LOCAL_PLAYLIST_MAX_COUNT\)/.test(source), 'writeLocalPlaylists 不得再静默截断');
  assert(/list\.length > LOCAL_PLAYLIST_MAX_COUNT/.test(source), '写入层必须显式拒绝超限列表');
  assert(/result\.imported/.test(source) && /result\.limitReached/.test(source), '导入结果必须回报成功数与上限');
}

function run() {
  testCreateBeyondCapacityIsRejected();
  testWriteNeverTruncates();
  testImportIntoFullStoreReportsLimit();
  testImportPartialSuccessIsAccurate();
  testImportFitsCompletely();
  testCapacityFreedByDelete();
  testNoSilentSliceInWriter();
  console.log('OK local-playlist-capacity');
}

try {
  run();
} catch (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}
