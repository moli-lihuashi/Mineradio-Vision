'use strict';

/* 播放地址短 TTL 缓存（2026-11-28）。
 *
 * 这个缓存的风险不在「省了多少」，而在「会不会把死链留住」：
 *   · TTL 必须真的过期（回切太频繁时不能一直命中）；
 *   · 媒体代理发现上游 403 时按 URL 精确失效，重试才能拿到新签名；
 *   · 失败结果与试听片段不进缓存（登录/换音质后不该拿到同一份答案）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlayUrlCache, playUrlCacheKey, playUrlCacheScope,
} = require('../server/lib/play-url-cache');

function withClock(start, ttlMs) {
  let now = start;
  const cache = createPlayUrlCache({ ttlMs, now: () => now });
  return { cache, advance(ms) { now += ms; } };
}

test('命中与过期：TTL 内返回同一份，过期后不再命中', () => {
  const { cache, advance } = withClock(1_000_000, 60_000);
  const key = playUrlCacheKey({ provider: 'netease', scope: 'anon', quality: 'hires', id: '123' });
  assert.equal(cache.set(key, { url: 'https://cdn/a.flac', level: 'hires' }), true);
  assert.equal(cache.get(key).url, 'https://cdn/a.flac');
  advance(59_999);
  assert.equal(cache.get(key).url, 'https://cdn/a.flac');
  advance(2);
  assert.equal(cache.get(key), null);
});

test('没有 url 的结果不写缓存（失败/受限/试听片段）', () => {
  const { cache } = withClock(0, 60_000);
  assert.equal(cache.set('k', { url: '', restricted: true }), false);
  assert.equal(cache.set('k', { restricted: true }), false);
  assert.equal(cache.get('k'), null);
});

test('按 URL 精确失效：只删命中那条，不误伤同曲不同档', () => {
  const { cache } = withClock(0, 60_000);
  const k1 = playUrlCacheKey({ provider: 'qq', scope: 'u1', quality: 'hires', id: 'm1' });
  const k2 = playUrlCacheKey({ provider: 'qq', scope: 'u1', quality: 'lossless', id: 'm1' });
  cache.set(k1, { url: 'https://dl/a.flac' });
  cache.set(k2, { url: 'https://dl/b.flac' });
  assert.equal(cache.invalidateByUrl('https://dl/a.flac'), 1);
  assert.equal(cache.get(k1), null);
  assert.ok(cache.get(k2));
});

test('探测纠正写回：下一次取址拿到真实档位，其余字段保持', () => {
  const { cache } = withClock(0, 60_000);
  const key = playUrlCacheKey({ provider: 'netease', scope: 'u1', quality: 'hires', id: '9' });
  cache.set(key, { url: 'https://dl/x.flac', level: 'hires', br: 999000, trial: false });
  assert.equal(cache.correct(key, { level: 'lossless', qualityMismatch: 'hires→lossless' }), true);
  const hit = cache.get(key);
  assert.equal(hit.level, 'lossless');
  assert.equal(hit.qualityMismatch, 'hires→lossless');
  assert.equal(hit.br, 999000);
  assert.equal(hit.url, 'https://dl/x.flac');
});

test('纠正不存在的键不报错、不凭空建条目', () => {
  const { cache } = withClock(0, 60_000);
  assert.equal(cache.correct('missing', { level: 'standard' }), false);
  assert.equal(cache.size(), 0);
});

test('上限淘汰：超过 maxEntries 时按写入顺序淘汰最老的', () => {
  const { cache } = withClock(0, 60_000);
  const small = createPlayUrlCache({ ttlMs: 60_000, maxEntries: 2, now: () => 0 });
  small.set('a', { url: 'https://dl/a' });
  small.set('b', { url: 'https://dl/b' });
  small.set('c', { url: 'https://dl/c' });
  assert.equal(small.get('a'), null);
  assert.ok(small.get('b'));
  assert.ok(small.get('c'));
  assert.equal(cache.size(), 0);
});

test('键包含账号维度：登录前后不共用条目', () => {
  const anon = playUrlCacheKey({ provider: 'netease', scope: playUrlCacheScope(''), quality: 'hires', id: '1' });
  const userA = playUrlCacheKey({ provider: 'netease', scope: playUrlCacheScope('MUSIC_U=aaa'), quality: 'hires', id: '1' });
  const userB = playUrlCacheKey({ provider: 'netease', scope: playUrlCacheScope('MUSIC_U=bbb'), quality: 'hires', id: '1' });
  assert.notEqual(anon, userA);
  assert.notEqual(userA, userB);
  assert.equal(playUrlCacheScope(''), 'anon');
});

test('键包含音质与匹配提示：换档/换提示不命中旧条目', () => {
  const base = { provider: 'netease', scope: 'u', id: '1' };
  const hires = playUrlCacheKey({ ...base, quality: 'hires', extra: 'a|b' });
  const lossless = playUrlCacheKey({ ...base, quality: 'lossless', extra: 'a|b' });
  const otherHint = playUrlCacheKey({ ...base, quality: 'hires', extra: 'a|c' });
  assert.notEqual(hires, lossless);
  assert.notEqual(hires, otherHint);
});
