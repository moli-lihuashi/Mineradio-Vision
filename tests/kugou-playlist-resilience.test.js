'use strict';

/* =============================================================================
 * 歌单接口的抗抖动能力（server/lib/kugou-service.js）
 *
 * 现场：/api/kugou/user/playlists 实测在 153ms ~ 25.2s 之间跳，还夹着两次 500。
 * 旧实现的放大链路是：
 *   上游超时 → requestText 12s × 重试 1 次 = 24s → 抛错 → 路由 500
 *   → 渲染层 Promise.all 整体 reject → 整张歌单列表变空白（「像网络卡了一样」）。
 *
 * 这里直接跑真实的服务工厂（注入假协议层），验证：
 *   - 短 TTL 内重复打开不再打上游（面板反复开关不再各等一次）；
 *   - 上游抖动时回落到「上一次成功」的列表，而不是 500；
 *   - 加歌之后缓存被主动作废（不会让用户看到 90s 前的旧歌单）。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const createKugouService = require(path.join(appRoot, 'server', 'lib', 'kugou-service.js'));

const USER_COOKIE = 'kg_mid=abc; kg_user_id=7; kg_token=tok';

function createService(options) {
  const opts = options || {};
  const calls = { cloudlist: 0, loginApi: 0, gateway: 0 };
  let cloudlistImpl = opts.cloudlist || (async () => ({
    status: 1,
    lists: [{ listid: 88, listname: '我喜欢的音乐', songcount: 12 }],
  }));
  const deps = {
    KUGOU_ID: { APPID: '1000', ANDROID_UA: 'ua/test', CLIENTVER: '1' },
    KUGOU_LOGIN_BASE_URL: 'https://login.kugou.test',
    KUGOU_PLAY_KEY_SALT: 'salt',
    KUGOU_QR_APPID: '1',
    KUGOU_QR_SRC_APPID: '1',
    QRCode: {},
    UA: 'ua/test',
    getKugouCookie: () => USER_COOKIE,
    getKugouLoginInfo: () => (opts.syncLogin ? opts.syncLogin() : { loggedIn: true, userId: 7, isVip: true, vipType: 1 }),
    getKugouLoginInfoFromApi: async () => {
      calls.loginApi += 1;
      return opts.freshLogin ? opts.freshLogin() : { loggedIn: true, userId: 7, isVip: true, vipType: 1 };
    },
    kugouCookieObject: () => ({ kg_user_id: '7' }),
    kugouCookieToken: () => 'tok',
    kugouCookieUserId: () => '7',
    kugouCookieVipType: () => 0,
    kugouVipProbe: { current: {} },
    normalizeQualityPreference: (q) => q || 'standard',
    parseJSONText: (t) => JSON.parse(t),
    playbackRestriction: () => ({ message: '', category: '', action: '' }),
    protocol: {
      kugouMd5: () => 'md5',
      kugouInitDevice: () => ({}),
      saveKugouAuth: () => ({}),
      kugouCookieMid: () => 'mid',
      kugouCloudlistCookieHeader: () => '',
      kugouSafeGet: (obj, keys, fallback) => fallback,
      kugouDeepFind: () => '',
      kugouGatewayRequest: async () => {
        calls.gateway += 1;
        return { status: 1, songs: [] };
      },
      kugouCloudlistRequest: async (...args) => {
        calls.cloudlist += 1;
        return cloudlistImpl(...args);
      },
    },
    registerKugouCloudDevice: async () => 'dfid-test',
    requestText: async () => '{}',
    serializeCookieObject: () => '',
  };
  const service = createKugouService(deps);
  return {
    service,
    calls,
    failUpstreamWith(message) {
      cloudlistImpl = async () => { throw new Error(message || 'Request timeout'); };
    },
    upstreamWith(impl) {
      cloudlistImpl = impl;
    },
  };
}

/* TTL 判定用的是 Date.now()：测试里把时钟往前推，避免真等 45s。 */
function withFakeClock(fn) {
  return async () => {
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow.call(Date) + offset;
    try {
      await fn((ms) => { offset += ms; });
    } finally {
      Date.now = realNow;
    }
  };
}

test('重复打开歌单面板只打一次上游（短 TTL 缓存），登录态探测也复用', withFakeClock(async (advance) => {
  const ctx = createService();
  const first = await ctx.service.handleKugouUserPlaylists();
  assert.equal(first.playlists.length, 1, '第一次应拿到真实歌单');
  assert.equal(first.playlists[0].id, '88');
  assert.equal(ctx.calls.cloudlist, 1);

  const second = await ctx.service.handleKugouUserPlaylists();
  assert.equal(ctx.calls.cloudlist, 1, 'TTL 内重复打开不许再打上游，实际 ' + ctx.calls.cloudlist);
  assert.equal(ctx.calls.loginApi, 1, '登录态探测同样要复用，实际 ' + ctx.calls.loginApi);
  assert.deepEqual(second.playlists.map((p) => p.id), first.playlists.map((p) => p.id));

  advance(50 * 1000); // 越过 45s TTL
  await ctx.service.handleKugouUserPlaylists();
  assert.equal(ctx.calls.cloudlist, 2, 'TTL 过期后必须重新取，实际 ' + ctx.calls.cloudlist);
}));

test('上游抖动时回落到上一次的成功列表，而不是抛 500', withFakeClock(async (advance) => {
  const ctx = createService();
  await ctx.service.handleKugouUserPlaylists();
  advance(50 * 1000);
  ctx.failUpstreamWith('Request timeout');

  const stale = await ctx.service.handleKugouUserPlaylists();
  assert.equal(stale.stale, true, '必须标记这是旧数据');
  assert.equal(stale.playlists.length, 1, '旧列表不能丢，否则面板会变空白');
  assert.equal(stale.playlists[0].name, '我喜欢的音乐');
}));

test('冷启动就抖动时仍按错误抛出（由渲染层降级展示）', async () => {
  const ctx = createService();
  ctx.failUpstreamWith('Request timeout');
  await assert.rejects(() => ctx.service.handleKugouUserPlaylists(), /timeout/i);
});

test('加歌之后缓存被作废，用户立刻能看到新列表', async () => {
  const ctx = createService();
  await ctx.service.handleKugouUserPlaylists();
  assert.equal(ctx.calls.cloudlist, 1);
  ctx.service.clearKugouPlaylistCache();
  await ctx.service.handleKugouUserPlaylists();
  assert.equal(ctx.calls.cloudlist, 2, '清缓存后必须重新取，实际 ' + ctx.calls.cloudlist);
});

test('歌单曲目：命中缓存不再往返，上游失败也回落到旧曲目', withFakeClock(async (advance) => {
  const ctx = createService({
    cloudlist: async () => ({
      status: 1,
      songs: [
        { hash: 'H1', filename: '晴天 - 周杰伦', songname: '晴天', singername: '周杰伦', duration: 269 },
        { hash: 'H2', filename: '夜曲 - 周杰伦', songname: '夜曲', singername: '周杰伦', duration: 227 },
      ],
      data: { count: 2 },
    }),
  });
  const first = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(first.tracks.length, 2, '应解析出两首曲目');
  const cloudlistCalls = ctx.calls.cloudlist;

  const second = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(ctx.calls.cloudlist, cloudlistCalls, '同key重复打开不许再打上游');
  assert.deepEqual(second.tracks.map((t) => t.hash), first.tracks.map((t) => t.hash));

  advance(100 * 1000); // 越过 90s TTL
  ctx.failUpstreamWith('Request timeout');
  const stale = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(stale.stale, true, '上游失败且有过成功数据时必须回落到旧曲目');
  assert.equal(stale.tracks.length, 2);
}));

test('同步登录态还没就绪时补一次 fresh 探测，不能直接判成「没歌」', async () => {
  const ctx = createService({
    // 刚启动 / 刚切账号：内存里的登录态还是上一轮的值
    syncLogin: () => ({ loggedIn: false, userId: 0 }),
    freshLogin: () => ({ loggedIn: true, userId: 7, isVip: false, vipType: 0 }),
    cloudlist: async () => ({
      status: 1,
      songs: [{ hash: 'H1', songname: '晴天', singername: '周杰伦', duration: 269 }],
      data: { count: 1 },
    }),
  });
  const r = await ctx.service.handleKugouPlaylistTracks('88');
  assert.notEqual(r.error, 'KUGOU_AUTH_REQUIRED', 'refresh 没跑完不等于没登录，实际 ' + r.error);
  assert.equal(r.tracks.length, 1, '必须真的去取曲目，实际 ' + r.tracks.length);
  assert.equal(ctx.calls.cloudlist, 1);
});

test('确实未登录时返回可重试的 AUTH_REQUIRED，而不是空列表装没事', async () => {
  const ctx = createService({
    syncLogin: () => ({ loggedIn: false, userId: 0 }),
    freshLogin: () => ({ loggedIn: false, userId: 0 }),
  });
  const r = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(r.loggedIn, false);
  assert.equal(r.error, 'KUGOU_AUTH_REQUIRED');
  assert.equal(r.retryable, true, '要能让前端提示「重新登录/重试」，不能静默空列表');
  assert.equal(ctx.calls.cloudlist, 0, '未登录不该去打上游');
});

test('分页中途失败保留已取到的页，不把大歌单整份丢掉', async () => {
  const ctx = createService();
  let page = 0;
  ctx.upstreamWith(async () => {
    page += 1;
    if (page === 1) {
      return {
        status: 1,
        songs: [
          { hash: 'H1', songname: '晴天', singername: '周杰伦', duration: 269 },
          { hash: 'H2', songname: '夜曲', singername: '周杰伦', duration: 227 },
        ],
        data: { count: 6 },
      };
    }
    throw new Error('Request timeout');
  });
  const r = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(r.tracks.length, 2, '第一页的曲目必须保住，实际 ' + r.tracks.length);
  assert.ok(page >= 2, '确实走到了第二页');
});

test('上游说有歌却一首没解析出来 → 标可重试，且不写 90s 缓存', withFakeClock(async () => {
  const ctx = createService({
    // count=6 但 songs 是空的：典型的「这次没拿到」，不是「歌单真的空」
    cloudlist: async () => ({ status: 1, songs: [], data: { count: 6 } }),
  });
  const first = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(first.tracks.length, 0);
  assert.equal(first.error, 'KUGOU_PLAYLIST_EMPTY', '有期望曲目却拿到 0 首要带可重试标记');
  assert.equal(first.retryable, true);

  const callsAfterFirst = ctx.calls.cloudlist;
  await ctx.service.handleKugouPlaylistTracks('88');
  assert.ok(ctx.calls.cloudlist > callsAfterFirst, '空/可疑结果不能进缓存，实际没有再打上游');
}));

test('上游明确说 0 首时算真的空歌单，不报加载失败', withFakeClock(async () => {
  const ctx = createService({
    cloudlist: async () => ({ status: 1, songs: [], data: { count: 0 } }),
  });
  const r = await ctx.service.handleKugouPlaylistTracks('88');
  assert.equal(r.tracks.length, 0);
  assert.equal(r.error, undefined, '「默认收藏」这种真的空歌单不能报成加载失败，实际 ' + r.error);
  assert.equal(r.retryable, undefined);
  assert.equal(r.loggedIn, true);
}));
