'use strict';

/* 地址缓存必须真的接在取址路由上（2026-11-28）。
 *
 * 纯函数测试只能证明缓存本身会用，证明不了「路由第二次请求不再打上游」。
 * 这里直接调用路由处理器：handleSongUrl 的调用次数就是「有没有省掉往返」的证据。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const registerNetease = require('../server/routes/netease');
const registerKugou = require('../server/routes/kugou');

const sendJSON = (res, payload) => { res.payload = payload; };

function neteaseHandler(state) {
  const ctx = {
    sendJSON,
    getLoginInfo: async () => ({ loggedIn: false, vipType: 0, vipLevel: 'none' }),
    handleSongUrl: async (id) => {
      state.calls += 1;
      return { url: 'https://cdn.example/' + id + '?sig=' + state.calls, level: 'standard' };
    },
    get userCookie() { return ''; },
  };
  return registerNetease(ctx);
}

function kugouHandler(state) {
  const ctx = {
    sendJSON,
    handleKugouSongUrl: async (hash) => {
      state.calls += 1;
      return { provider: 'kugou', url: 'https://cdn.example/kugou/' + hash + '?sig=' + state.calls, level: 'standard' };
    },
    get kugouCookie() { return ''; },
  };
  return registerKugou(ctx);
}

function request(handler, path) {
  const res = {};
  const url = new URL('http://127.0.0.1' + path);
  // 分发器传进来的是 pathname，不是带 query 的完整路径
  return handler({ method: 'GET', headers: {} }, res, url, url.pathname)
    .then(() => res.payload);
}

test('网易：同一首歌第二次取址不再打上游，响应标 cached', async () => {
  const state = { calls: 0 };
  const handler = neteaseHandler(state);
  const path = '/api/song/url?id=900001&quality=standard';

  const first = await request(handler, path);
  assert.equal(state.calls, 1);
  assert.equal(first.cached, undefined);

  const second = await request(handler, path);
  assert.equal(state.calls, 1, '第二次仍在打上游 —— 缓存没接上');
  assert.equal(second.cached, true);
  assert.equal(second.url, first.url, '命中缓存却换了地址，说明键不稳定');
});

test('网易：fresh=1 绕过缓存并刷新条目', async () => {
  const state = { calls: 0 };
  const handler = neteaseHandler(state);
  const path = '/api/song/url?id=900002&quality=standard';

  await request(handler, path);
  const forced = await request(handler, path + '&fresh=1');
  assert.equal(state.calls, 2);
  assert.equal(forced.cached, undefined);

  // fresh 拉回来的新地址必须写入缓存，后续普通请求拿到的是它
  const after = await request(handler, path);
  assert.equal(state.calls, 2);
  assert.equal(after.url, forced.url);
});

test('网易：失败/受限结果不进缓存（下一次仍要重新取址）', async () => {
  const state = { calls: 0 };
  const ctx = {
    sendJSON,
    getLoginInfo: async () => ({ loggedIn: false }),
    handleSongUrl: async () => { state.calls += 1; return { url: '', restricted: true, message: '无版权' }; },
    get userCookie() { return ''; },
  };
  const handler = registerNetease(ctx);
  const path = '/api/song/url?id=900003&quality=standard';
  await request(handler, path);
  await request(handler, path);
  assert.equal(state.calls, 2);
});

test('网易：试听片段不进缓存（登录后必须能拿到完整版）', async () => {
  const state = { calls: 0 };
  const ctx = {
    sendJSON,
    getLoginInfo: async () => ({ loggedIn: false }),
    handleSongUrl: async () => {
      state.calls += 1;
      return { url: 'https://cdn.example/trial' + state.calls, level: 'standard', trial: true };
    },
    get userCookie() { return ''; },
  };
  const handler = registerNetease(ctx);
  const path = '/api/song/url?id=900004&quality=standard';
  await request(handler, path);
  await request(handler, path);
  assert.equal(state.calls, 2);
});

test('酷狗：同样命中缓存', async () => {
  const state = { calls: 0 };
  const handler = kugouHandler(state);
  const path = '/api/kugou/song/url?hash=ABCDEF&quality=standard';

  const first = await request(handler, path);
  const second = await request(handler, path);
  assert.equal(state.calls, 1);
  assert.equal(second.cached, true);
  assert.equal(second.url, first.url);
});

test('酷狗：换音质不命中旧条目', async () => {
  const state = { calls: 0 };
  const handler = kugouHandler(state);
  // 换一个 hash：缓存是进程级单例，前面的用例已经写过 ABCDEF 的 standard 档
  await request(handler, '/api/kugou/song/url?hash=GHIJKL&quality=standard');
  await request(handler, '/api/kugou/song/url?hash=GHIJKL&quality=lossless');
  assert.equal(state.calls, 2);
});
