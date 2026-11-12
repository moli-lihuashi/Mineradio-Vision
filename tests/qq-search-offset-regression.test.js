'use strict';

/* 2026-11-12 复核回归：QQ 搜索「加载更多」此前前端发 offset、后端忽略，
 * 两次请求都打 handleQQSearch(kw, 12) 返回第一页，前端去重后误判到底。
 * 锁死：路由透传 offset → 内容层换算页码 → client_search_cp 的 p/n 参数。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const createQQContent = require(path.join(appRoot, 'server', 'lib', 'qq-content.js'));
const registerQQRoutes = require(path.join(appRoot, 'server', 'routes', 'qq.js'));

function fakeContentFactory(responses) {
  const urls = [];
  const deps = {
    requestText: async (url) => {
      urls.push(url);
      const u = new URL(url);
      return responses && responses[u.pathname] ? responses[u.pathname] : '{}';
    },
    session: {
      parseJSONText(text) { try { return JSON.parse(text); } catch (_) { return null; } },
      qqMusicRequest: async () => ({}),
      qqGetJSON: async () => ({}),
      getQQLoginInfo: async () => ({}),
      refreshQQCookieSession: async () => ({}),
      QQ_HEADERS: { 'User-Agent': 'test' },
      QQ_SMARTBOX_URL: 'https://example.test/smartbox',
    },
  };
  return { content: createQQContent(deps), urls };
}

const clientSearchPayload = JSON.stringify({
  data: { song: { list: [
    { mid: 'songA', id: 1, name: '晴天', singer: [{ name: '周杰伦' }], album: { mid: 'alb1', name: '叶惠美' }, interval: 269 },
  ] } },
});
const smartboxPayload = JSON.stringify({
  data: { song: { itemlist: [{ mid: 'songB', id: 2, name: '晴天', singer: '周杰伦' }] } },
});

test('offset 换算成 client_search_cp 的页码 p，limit 换算成 n', async () => {
  const { content, urls } = fakeContentFactory({ '/soso/fcgi-bin/client_search_cp': clientSearchPayload });
  const songs = await content.handleQQSearch('晴天', 12, 24);
  assert.equal(urls.length, 1, '翻页不应回落到 smartbox');
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get('p'), '3', 'offset=24 / limit=12 → 第 3 页');
  assert.equal(u.searchParams.get('n'), '12');
  assert.equal(u.searchParams.get('w'), '晴天');
  assert.equal(songs.length, 1);
  assert.equal(songs[0].mid, 'songA');
  assert.equal(songs[0].name, '晴天');
});

test('第一页真分页有结果时走 client_search_cp，不再重复 smartbox 联想结果', async () => {
  const { content, urls } = fakeContentFactory({
    '/soso/fcgi-bin/client_search_cp': clientSearchPayload,
    '/smartbox': smartboxPayload,
  });
  await content.handleQQSearch('晴天', 12, 0);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /client_search_cp/);
});

test('网络故障必须继续抛出（2026-11-12 复核：不能回 200 + 空数组冒充到底）', async () => {
  const urls = [];
  const deps = {
    requestText: async (url) => {
      urls.push(url);
      throw new Error('QQ_SEARCH_TIMEOUT');
    },
    session: {
      parseJSONText(text) { try { return JSON.parse(text); } catch (_) { return null; } },
      qqMusicRequest: async () => ({}),
      QQ_HEADERS: {},
      QQ_SMARTBOX_URL: 'https://example.test/smartbox',
    },
  };
  const content = createQQContent(deps);
  await assert.rejects(() => content.handleQQSearch('晴天', 12, 0), /QQ_SEARCH_TIMEOUT/,
    '第一页超时也要抛出，让前端保留当前页并提供重试');
  await assert.rejects(() => content.handleQQSearch('晴天', 12, 24), /QQ_SEARCH_TIMEOUT/,
    '翻页超时更要抛出：回 [] 会被前端判定「没有更多歌曲」并推进 offset');
  assert.ok(!urls.some(u => u.indexOf('/smartbox') >= 0),
    '异常路径不得回落 smartbox 伪装成成功结果');
});

test('只有真正的空结果才判定到底（翻页空列表 = 到底，不涉及异常）', async () => {
  const empty = JSON.stringify({ data: { song: { list: [] } } });
  const f = fakeContentFactory({
    '/soso/fcgi-bin/client_search_cp': empty,
    '/smartbox': smartboxPayload,
  });
  const first = await f.content.handleQQSearch('晴天', 12, 0);
  assert.ok(first.length >= 1, '第一页空结果仍回落 smartbox 兜底');
  assert.ok(f.urls.some(u => u.indexOf('/smartbox') >= 0));

  const prevCount = f.urls.length;
  const second = await f.content.handleQQSearch('晴天', 12, 12);
  assert.deepEqual(second, [], '翻页真的空 → 返回空数组，前端据此判定到底');
  assert.ok(!f.urls.slice(prevCount).some(u => u.indexOf('/smartbox') >= 0),
    '翻页绝不能再调用 smartbox，否则第一页会重复出现');
});

test('后端异常时路由返回 500，而不是 200 + songs:[]', async () => {
  const route = registerQQRoutes({
    handleQQSearch: async () => { throw new Error('QQ_SEARCH_TIMEOUT'); },
    sendJSON(res, body, status) { res.body = body; res.status = status || 200; },
    console: { error() {} },
  });
  const res = {};
  const url = new URL('http://127.0.0.1/api/qq/search?keywords=x&limit=12&offset=12');
  await route({}, res, url, '/api/qq/search');
  assert.equal(res.status, 500, 'apiJson 非 2xx 会抛错，前端才不会把它当成空结果页');
  assert.equal(res.body.error, 'QQ_SEARCH_TIMEOUT');
});

test('路由把 offset 透传给 handleQQSearch', async () => {
  const calls = [];
  const route = registerQQRoutes({
    handleQQSearch: async (kw, limit, offset) => { calls.push({ kw, limit, offset }); return []; },
    sendJSON(res, body, status) { res.body = body; res.status = status || 200; },
  });
  const res = {};
  const url = new URL('http://127.0.0.1/api/qq/search?keywords=%E6%99%B4%E5%A4%A9&limit=12&offset=24');
  await route({}, res, url, '/api/qq/search');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kw, '晴天');
  assert.equal(calls[0].limit, 12);
  assert.equal(calls[0].offset, 24, 'offset 必须透传，旧实现丢掉了它');
  assert.equal(res.status, 200);
});

test('源码守卫：路由与内容层都要出现 offset / p-n 分页', () => {
  const routeSrc = fs.readFileSync(path.join(appRoot, 'server', 'routes', 'qq.js'), 'utf8');
  const contentSrc = fs.readFileSync(path.join(appRoot, 'server', 'lib', 'qq-content.js'), 'utf8');
  assert.match(routeSrc, /handleQQSearch\(kw, limit, offset\)/);
  assert.match(contentSrc, /client_search_cp/);
  assert.match(contentSrc, /searchParams\.set\('p', String\(Math\.max\(1, page/);
  assert.match(contentSrc, /Math\.floor\(off \/ num\) \+ 1/);
});
