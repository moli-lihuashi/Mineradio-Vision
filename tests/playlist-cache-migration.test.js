'use strict';

/* =============================================================================
 * B2 接入点回归：歌单列表缓存真的走版本化读写
 *
 * 把 02-playlist-detail.js 里的两个函数按源码切片搬进 vm，同时跑真实的
 * 00-storage-migration.js。断言的是 localStorage 里最终写进去什么，
 * 而不是源码里有没有某行文字。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const playlistSrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/06-lyrics/02-playlist-detail.js'), 'utf8');
const migrationSrc = fs.readFileSync(
  path.join(appRoot, 'public/js/modules/00-state/00-storage-migration.js'), 'utf8');

/* 这两个函数都是顶层函数，闭合大括号独占一行。按源码切真实片段，
   注释里的 { at, playlists } 不会干扰 brace 计数。 */
function sliceTopLevelFunction(source, name) {
  const marker = 'function ' + name + '() {';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, '源码里应该找得到 ' + marker);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, '闭合大括号应该独占一行');
  return source.slice(start, end + 3);
}

const combined = [
  sliceTopLevelFunction(playlistSrc, 'readPlaylistListCache'),
  sliceTopLevelFunction(playlistSrc, 'writePlaylistListCache'),
].join('\n');

function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    read(key) { return JSON.parse(map.get(key)); },
    raw(key) { return map.get(key); },
  };
}

function load(initial, extra) {
  const storage = makeStorage(initial);
  const sandbox = Object.assign({
    console,
    localStorage: storage,
    PLAYLIST_LIST_CACHE_KEY: 'mineradio-user-playlists-cache-v1',
    userPlaylists: [],
  }, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(migrationSrc, sandbox);
  vm.runInContext(combined, sandbox);
  return { sandbox, storage };
}

const legacyPlaylists = [
  { id: 'p1', provider: 'kugou', name: '我的歌单' },
  { id: 'p2', provider: 'netease', name: '收藏' },
];

test('旧档（无 v）能被读出，并就地迁移成 v1 回写', () => {
  const original = JSON.stringify({ at: 12345, playlists: legacyPlaylists });
  const { sandbox, storage } = load({ 'mineradio-user-playlists-cache-v1': original });
  const cached = sandbox.readPlaylistListCache();
  assert.ok(cached, '旧格式不能因为没版本号就被当成没有缓存');
  assert.equal(cached.playlists.length, 2);

  const written = storage.read('mineradio-user-playlists-cache-v1');
  assert.equal(written.v, 1, '迁移结果要带版本号回写');
  assert.equal(written.at, 12345, '迁移不能把缓存时间刷新成现在（旧值要能识别为旧值）');
  assert.deepEqual(JSON.parse(JSON.stringify(written.playlists)), JSON.parse(JSON.stringify(legacyPlaylists)));
});

test('未来版本的缓存既不读也不覆盖，降级运行不会丢用户的歌单', () => {
  const original = JSON.stringify({ v: 9, at: 7, playlists: legacyPlaylists });
  const { sandbox, storage } = load({ 'mineradio-user-playlists-cache-v1': original });
  assert.equal(sandbox.readPlaylistListCache(), null);
  assert.equal(storage.raw('mineradio-user-playlists-cache-v1'), original);
});

test('写入歌单缓存带 v1，并过滤掉本地 / 内置歌单', () => {
  const { sandbox, storage } = load({}, {
    userPlaylists: [
      { id: 'p1', provider: 'kugou' },
      { id: 'local', provider: 'local' },
      { id: 'builtin', provider: 'mineradio' },
      { id: 'p2', source: 'spotify' },
    ],
  });
  sandbox.writePlaylistListCache();
  const written = storage.read('mineradio-user-playlists-cache-v1');
  assert.equal(written.v, 1);
  assert.equal(typeof written.at, 'number');
  assert.deepEqual(Array.from(written.playlists, p => p.id), ['p1', 'p2']);
});

test('缓存坏掉时返回 null 而不抛，首屏走在线加载', () => {
  const { sandbox, storage } = load({ 'mineradio-user-playlists-cache-v1': '{ not json' });
  assert.equal(sandbox.readPlaylistListCache(), null);
  assert.equal(storage.raw('mineradio-user-playlists-cache-v1'), '{ not json', '坏档不该被覆盖');
});

test('空歌单不写缓存，也不制造一份 v1 空档', () => {
  const { sandbox, storage } = load({}, { userPlaylists: [{ id: 'x', provider: 'local' }] });
  sandbox.writePlaylistListCache();
  assert.equal(storage.map.size, 0);
});

test('写入后立即读回，结构不串档', () => {
  const { sandbox } = load({}, { userPlaylists: legacyPlaylists });
  sandbox.writePlaylistListCache();
  const cached = sandbox.readPlaylistListCache();
  assert.ok(cached);
  assert.equal(cached.playlists.length, 2);
  assert.equal(cached.v, 1);
});
