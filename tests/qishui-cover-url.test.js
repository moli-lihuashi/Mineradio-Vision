'use strict';

// 汽水封面 URL 拼接（2026-11-13）
//
// 背景：用户报「Ta在抖音收藏的音乐」那张歌单卡封面裂图。追到 mapping 的两处拼接：
//   1) 尺寸后缀 `~c5_300x300.jpg` 直接拼在字符串末尾 —— 遇到带 query 的封面
//      （抖音 CDN 的 `?from=…&x-expires=…`）会拼进 query 里，
//      过期时间变成 "99~c5_300x300.jpg"，CDN 校验失败 → 403 → <img> 裂图。
//   2) cover 与 uri 相遇时无条件 `cover + uri`，而判断条件 `includes(uri)` 在
//      cover 带 query 时会漏 → 得到 `.../a.jpg?x=1tos-cn-i-x/y` 这种坏链。
//
// 这里锁死的判据：任何输入都只能产出「一个 host；带 query/fragment 的 URL 一个字符都不改；
// 只有干净 URL 才追加尺寸后缀」。

const assert = require('assert');
const { test } = require('node:test');
const mapping = require('../server/qishui/mapping');

const SUFFIX = '~c5_300x300.jpg';

function coverOf(item) {
  return mapping.qishuiPlaylistCoverFromItem(item);
}

function assertHealthy(url, label) {
  assert.ok(url, label + '：不应为空');
  assert.strictEqual((url.match(/https?:\/\//g) || []).length, 1, label + '：只能有一个 origin，实际 ' + url);
  // 后缀必须在 query 之前
  const q = url.indexOf('?');
  if (q >= 0) {
    assert.ok(url.indexOf(SUFFIX) >= 0 && url.indexOf(SUFFIX) < q, label + '：尺寸后缀应落在 query 之前，实际 ' + url);
  }
  assert.ok(!/[?&][^#]*~c5_/.test(url), label + '：后缀被拼进了 query，实际 ' + url);
}

test('干净 URL：追加尺寸后缀', () => {
  const url = coverOf({ cover_url: 'https://p3.douyinpic.com/abc.jpg' });
  assert.strictEqual(url, 'https://p3.douyinpic.com/abc.jpg~c5_300x300.jpg');
});

// 2026-11-13 回归：把后缀插到 query 之前（改 path）会让签名 CDN 失配 → 头像/封面 403 裂图。
// 签名是按 path 算的，所以带 query/fragment 的 URL 必须原样返回。
test('带 query 的签名 URL：一个字符都不动', () => {
  const signed = 'https://p3-pc-sign.douyinpic.com/aweme-avatar/abc.jpeg?lk3s=1&x-expires=99&x-signature=xyz';
  assert.strictEqual(coverOf({ cover_url: signed }), signed);
  assert.strictEqual(coverOf({ cover_url: 'https://p9.douyinpic.com/img/abc.jpg?from=1&x-expires=99' }),
    'https://p9.douyinpic.com/img/abc.jpg?from=1&x-expires=99');
});

test('带 fragment 的 URL 也不动', () => {
  assert.strictEqual(coverOf({ cover_url: 'https://p3.douyinpic.com/abc.jpg#frag' }),
    'https://p3.douyinpic.com/abc.jpg#frag');
});

test('已带 ~ 处理参数的封面不重复追加', () => {
  const url = coverOf({ cover_url: 'https://p3.douyinpic.com/abc~tplv-dy.jpeg' });
  assert.strictEqual(url, 'https://p3.douyinpic.com/abc~tplv-dy.jpeg');
});

test('cover 是完整文件 URL + 另有 uri：不得把 uri 拼到 query 后面', () => {
  const url = coverOf({ cover: { uri: 'tos-cn-i-3/ijkl', urls: ['https://p3.douyinpic.com/img.jpg?x=1'] } });
  assert.strictEqual(url, 'https://p3.douyinpic.com/img.jpg?x=1');
});

test('cover 已包含 uri 时保持原样', () => {
  const url = coverOf({ cover: { uri: 'tos-cn-i-1/abcd', urls: ['https://p3.douyinpic.com/tos-cn-i-1/abcd~tplv-dy.jpeg'] } });
  assert.strictEqual(url, 'https://p3.douyinpic.com/tos-cn-i-1/abcd~tplv-dy.jpeg');
});

test('cover 是目录式基础域：拼上 uri', () => {
  const url = coverOf({ cover: { uri: 'tos-cn-i-2/efgh', urls: ['https://p3.douyinpic.com/'] } });
  assertHealthy(url, '基础域 + uri');
  assert.strictEqual(url, 'https://p3.douyinpic.com/tos-cn-i-2/efgh~c5_300x300.jpg');
});

test('cover 是裸域名：补斜杠再拼 uri', () => {
  const url = coverOf({ cover: { uri: 'tos-cn-i-9/zzz', urls: ['https://p3.douyinpic.com'] } });
  assertHealthy(url, '裸域名 + uri');
  assert.strictEqual(url, 'https://p3.douyinpic.com/tos-cn-i-9/zzz~c5_300x300.jpg');
});

test('url_list 形态与数组形态都能取到', () => {
  assert.strictEqual(
    coverOf({ url_cover: { url_list: ['https://p3.douyinpic.com/x~c5_1080x1080.jpg'] } }),
    'https://p3.douyinpic.com/x~c5_1080x1080.jpg'
  );
  assert.strictEqual(
    coverOf({ cover: [{ urls: ['https://p3.douyinpic.com/a~b.jpeg'] }] }),
    'https://p3.douyinpic.com/a~b.jpeg'
  );
});

test('只有 uri 没有域名时返回空串（由前端走占位块，而不是拼出相对路径）', () => {
  assert.strictEqual(coverOf({ cover: { uri: 'tos-cn-i-4/mnop' } }), '');
});

test('非 http(s) 的脏值一律丢弃', () => {
  assert.strictEqual(coverOf({ cover_url: 'tos-cn-i-4/mnop' }), '');
  assert.strictEqual(coverOf({ cover_url: 'javascript:alert(1)' }), '');
  assert.strictEqual(coverOf({}), '');
  assert.strictEqual(coverOf(null), '');
});
