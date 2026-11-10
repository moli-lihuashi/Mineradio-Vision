'use strict';

/* =============================================================================
 * 歌单列表加载的抗抖动能力（public/js/modules/06-lyrics/02-playlist-detail.js）
 *
 * 旧实现是 6 个音源 `Promise.all` 一次性并发，任一失败 → 整体 reject → catch 里只
 * console.warn，结果就是「点了歌单，列表空白/一直转圈」。
 * 现在要求：
 *   - 单个音源失败只影响它自己，其它音源照常渲染；
 *   - 这次没拿到的音源保留上一轮列表，不清空；
 *   - 列表落 localStorage，下次启动先出缓存再后台刷新；
 *   - 每个请求都带超时，不会无限等。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '02-playlist-detail.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function sliceRefresh(text) {
  const start = text.indexOf('var PLAYLIST_FETCH_TIMEOUT_MS');
  assert.ok(start > 0, '找不到 PLAYLIST_FETCH_TIMEOUT_MS，歌单加载入口被改过');
  const end = text.indexOf('var playlistPanelDetailState');
  assert.ok(end > start, '找不到 playlistPanelDetailState 边界');
  const slice = text.slice(start, end);
  assert.ok(slice.includes('async function refreshUserPlaylists'), '切片里没有 refreshUserPlaylists');
  return slice;
}

const sliceSource = sliceRefresh(source);

function createSandbox(options) {
  const o = options || {};
  const requests = [];
  const responses = o.responses || {};
  const store = new Map();
  const rendered = { list: 0, podcasts: 0 };
  const el = () => ({ innerHTML: '', querySelector: () => null, textContent: '' });
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Promise,
    JSON,
    Date,
    Math,
    Object,
    Array,
    Number,
    String,
    isFinite,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    document: { getElementById: () => el() },
    window: { gsap: null },
    builtInPlaylists: [{ id: 'bi-1', name: '内置歌单', provider: 'mineradio' }],
    userPlaylists: [],
    neteasePlaylists: [],
    qqPlaylists: [],
    kugouPlaylists: [],
    qishuiPlaylists: [],
    spotifyPlaylists: [],
    myPodcastCollections: [],
    emptyHomeActive: false,
    loginStatus: { loggedIn: true },
    qqLoginStatus: { loggedIn: false },
    kugouLoginStatus: { loggedIn: true },
    qishuiLoginStatus: { loggedIn: false },
    spotifyLoginStatus: { loggedIn: false },
    refreshBuiltInPlaylists: async () => {},
    listLocalPlaylists: () => [],
    renderPlaylistSourceChip() {},
    resetPlaylistPanelRenderLimit() {},
    miniQueueSkeleton: () => '<skeleton></skeleton>',
    animateListItems() {},
    isPlaylistPanelVisibleForRender: () => false,
    renderUserPlaylistsList() { rendered.list += 1; },
    renderMyPodcastCollections() { rendered.podcasts += 1; },
    renderHomeDiscover() {},
    scheduleShelfRebuild() {},
    apiJson(url, opts) {
      requests.push({ url, opts: opts || {} });
      const handler = responses[url] || (() => ({ playlists: [] }));
      try {
        const out = handler();
        return out && typeof out.then === 'function' ? out : Promise.resolve(out);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    __requests: requests,
    __store: store,
    __rendered: rendered,
  };
  sandbox.window = sandbox.window || {};
  vm.createContext(sandbox);
  vm.runInContext(sliceSource + '\nthis.__api = { refreshUserPlaylists, hydrateUserPlaylistsFromCache, readPlaylistListCache, fetchPlaylistSource, playlistListEmptyHtml, playlistListBodyHtml, playlistListErrorNoticeHtml, get listLoadFailed() { return playlistListLoadFailed; } };', sandbox, { filename: '02-playlist-detail.js#slice' });
  return sandbox;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('单个音源挂掉不影响其它音源（不再整张列表空白）', async () => {
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => ({ playlists: [{ id: 'ne-1', name: '网易歌单A' }, { id: 'ne-2', name: '网易歌单B' }] }),
      '/api/podcast/my': () => ({ collections: [{ id: 'pod-1' }] }),
      '/api/kugou/user/playlists': () => { throw new Error('Request timeout'); },
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);

  assert.equal(sandbox.neteasePlaylists.length, 2, '其它音源必须照常渲染');
  assert.equal(sandbox.kugouPlaylists.length, 0, '失败音源本次没有数据');
  assert.equal(sandbox.myPodcastCollections.length, 1, '播客也不能因为别的音源失败而丢');
  assert.ok(sandbox.userPlaylists.some((pl) => pl.id === 'ne-1'), '合并结果里必须有网易歌单');
  assert.ok(sandbox.userPlaylists.some((pl) => pl.provider === 'mineradio'), '内置歌单不能被冲掉');
});

test('这次没拿到的音源保留上一轮列表，不清空', async () => {
  let kugouFails = false;
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => ({ playlists: [{ id: 'ne-1', name: '网易歌单A' }] }),
      '/api/kugou/user/playlists': () => {
        if (kugouFails) throw new Error('Request timeout');
        return { playlists: [{ id: 'kg-1', name: '酷狗歌单A' }] };
      },
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);
  assert.equal(sandbox.kugouPlaylists.length, 1);

  kugouFails = true;
  await sandbox.__api.refreshUserPlaylists(true);
  assert.equal(sandbox.kugouPlaylists.length, 1, '上游抖动时必须保留上一轮酷狗歌单，实际 ' + sandbox.kugouPlaylists.length);
  assert.equal(sandbox.kugouPlaylists[0].id, 'kg-1');
});

test('每个音源请求都带超时（不会无限等）', async () => {
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => ({ playlists: [] }),
      '/api/kugou/user/playlists': () => ({ playlists: [] }),
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);
  const live = sandbox.__requests.filter((r) => r.url);
  assert.ok(live.length >= 2, '应至少发出两个音源请求');
  live.forEach((r) => {
    assert.equal(r.opts.timeoutMs, 15000, r.url + ' 必须带 15s 超时，实际 ' + JSON.stringify(r.opts));
  });
});

test('列表落本地缓存，下次启动先出缓存内容', async () => {
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => ({ playlists: [{ id: 'ne-1', name: '网易歌单A' }] }),
      '/api/kugou/user/playlists': () => ({ playlists: [{ id: 'kg-1', name: '酷狗歌单A' }] }),
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);
  assert.ok(sandbox.__store.has('mineradio-user-playlists-cache-v1'), '刷新成功后必须写缓存');
  const persisted = JSON.parse(sandbox.__store.get('mineradio-user-playlists-cache-v1'));
  assert.ok(persisted.playlists.every((pl) => pl.provider !== 'mineradio'),
    '缓存文件里不该存内置歌单（内置歌单由主进程提供，存了会出现两份）');

  // 模拟下一次冷启动：内存里什么都没有，只剩 localStorage
  sandbox.userPlaylists = [];
  sandbox.neteasePlaylists = [];
  sandbox.kugouPlaylists = [];
  const hydrated = sandbox.__api.hydrateUserPlaylistsFromCache();
  assert.equal(hydrated, true, '有缓存时必须能恢复');
  assert.ok(sandbox.userPlaylists.some((pl) => pl.id === 'kg-1'), '缓存里的酷狗歌单要能还原');
  assert.ok(sandbox.userPlaylists.some((pl) => pl.id === 'ne-1'), '缓存里的网易歌单要能还原');
  assert.equal(sandbox.userPlaylists.filter((pl) => pl.id === 'bi-1').length, 1,
    '内置歌单只能出现一次（水合结果 = 内置 + 缓存，不是缓存覆盖内置）');
});

test('用缓存顶上之后仍然会去刷新（不能永远用旧数据）', async () => {
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => ({ playlists: [{ id: 'ne-1', name: '网易歌单A' }] }),
      '/api/kugou/user/playlists': () => ({ playlists: [{ id: 'kg-1', name: '酷狗歌单A' }] }),
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);
  const before = sandbox.__requests.length;

  sandbox.userPlaylists = [];
  sandbox.neteasePlaylists = [];
  sandbox.kugouPlaylists = [];
  await sandbox.__api.refreshUserPlaylists(false);   // 非强制，模拟切回面板
  assert.ok(sandbox.__requests.length > before, '水合缓存后仍要发一次后台刷新，实际没发');
  assert.ok(sandbox.userPlaylists.length > 0);
});

test('登出某个音源后它必须从列表里消失（未登录 ≠ 这次没拿到）', async () => {
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => ({ playlists: [{ id: 'ne-1', name: '网易歌单A' }] }),
      '/api/kugou/user/playlists': () => ({ playlists: [{ id: 'kg-1', name: '酷狗歌单A' }] }),
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);
  assert.equal(sandbox.kugouPlaylists.length, 1);

  // 酷狗登出
  sandbox.kugouLoginStatus = { loggedIn: false };
  await sandbox.__api.refreshUserPlaylists(true);
  assert.equal(sandbox.kugouPlaylists.length, 0, '登出后旧酷狗歌单不能还挂在列表里，实际 ' + sandbox.kugouPlaylists.length);
  assert.ok(!sandbox.userPlaylists.some((pl) => pl.provider === 'kugou'), '合并结果里也不能再有酷狗歌单');
  assert.equal(sandbox.neteasePlaylists.length, 1, '其它已登录音源不受影响');
});

test('所有音源都失败且一条都没有时标成「加载失败」，不是「未找到歌单」', async () => {
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => { throw new Error('Request timeout'); },
      '/api/kugou/user/playlists': () => { throw new Error('Request timeout'); },
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);

  assert.equal(sandbox.__api.listLoadFailed, true, '全部失败 + 手里没数据时必须标记加载失败');
  const html = sandbox.__api.playlistListEmptyHtml();
  assert.ok(html.includes('歌单加载失败'), '必须说清是失败，实际：' + html);
  assert.ok(html.includes('data-pl-list-retry'), '必须给重试入口，实际：' + html);
  assert.ok(!html.includes('未找到歌单'), '不能把失败说成「未找到歌单」');

  // 内置歌单通常还在：错误提示必须叠在列表上方，而不是等整页空了才出现
  const body = sandbox.__api.playlistListBodyHtml('<div class="pl-card">内置歌单</div>');
  assert.ok(body.includes('内置歌单'), '内置歌单照常显示');
  assert.ok(body.includes('data-pl-list-retry'), '内置歌单在也要给重试入口，实际：' + body);
  assert.ok(body.indexOf('data-pl-list-retry') < body.indexOf('内置歌单'), '提示要压在列表上面');
});

test('全部失败但手上有上一轮列表时不标失败（继续显示旧内容）', async () => {
  let fail = false;
  const sandbox = createSandbox({
    responses: {
      '/api/user/playlists': () => {
        if (fail) throw new Error('Request timeout');
        return { playlists: [{ id: 'ne-1', name: '网易歌单A' }] };
      },
      '/api/kugou/user/playlists': () => ({ playlists: [{ id: 'kg-1', name: '酷狗歌单A' }] }),
    },
  });
  await sandbox.__api.refreshUserPlaylists(true);
  assert.equal(sandbox.__api.listLoadFailed, false, '成功后不该标失败');

  fail = true;
  sandbox.kugouLoginStatus = { loggedIn: false };
  sandbox.kugouPlaylists = [];
  await sandbox.__api.refreshUserPlaylists(true);
  assert.equal(sandbox.__api.listLoadFailed, false, '还有上一轮的网易歌单时不能整页报失败');
  assert.equal(sandbox.neteasePlaylists.length, 1, '旧歌单要保留');
});
