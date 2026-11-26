'use strict';

/*
 * Home 卡片文字钳制守卫（2026-11-25）
 *
 * 故障：续播卡（#home-continue-card）的文案是「歌名 + 歌手 · 队列 N 首 · 从 x% 继续 · 平台」，
 * 长度完全不可控。原来标题/副标题都是不限行 + max-width:70%，
 * 字一多就把卡片顶高；而且卡片在 grid 同一行会被拉伸，整排卡片一起变形。
 *
 * 现在：标题 2 行、副标题 1 行，超出省略，并加 max-height 兜底 ——
 * 因为新版 Chromium 会把 -webkit-box 规范成 flow-root，单靠 -webkit-line-clamp 不保险。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.resolve(__dirname, '../public/css/02-home/home.css'), 'utf8');

/* 必须从行首匹配：`.home-card-label,.home-card-title,.home-card-sub{...}` 这条共享规则
 * 里也含 ".home-card-sub{"，用 indexOf 会截到它。 */
const rule = (selector) => {
  const re = new RegExp('(?:^|\\n)' + selector.replace(/\./g, '\\.') + '\\{');
  const m = re.exec(CSS);
  if (!m) return '';
  const start = m.index + m[0].length - 1;
  return CSS.slice(start, CSS.indexOf('}', start));
};

test('标题最多 2 行并带省略号', () => {
  const r = rule('.home-card-title');
  assert.ok(r, '必须能找到 .home-card-title 规则');
  assert.match(r, /-webkit-line-clamp:2/, '标题要限制 2 行');
  assert.match(r, /overflow:hidden/, '超出必须裁掉');
  assert.match(r, /text-overflow:ellipsis/, '要有省略号');
  assert.match(r, /max-height:2\.32em/, 'line-height 1.16 × 2 行 = 2.32em，作为 clamp 失效时的兜底');
  assert.match(r, /overflow-wrap:anywhere/, '超长英文/数字串要能断');
});

test('副标题只留 1 行（它是撑高卡片的元凶）', () => {
  const r = rule('.home-card-sub');
  assert.ok(r, '必须能找到 .home-card-sub 规则');
  assert.match(r, /-webkit-line-clamp:1/, '副标题压到 1 行');
  assert.match(r, /max-height:1\.45em/, 'line-height 1.45 × 1 行');
  assert.match(r, /overflow:hidden/);
});

test('标题与副标题都不再用「不限行」写法', () => {
  const title = rule('.home-card-title');
  const sub = rule('.home-card-sub');
  for (const [name, r] of [['标题', title], ['副标题', sub]]) {
    assert.ok(!/white-space:nowrap/.test(r), `${name}不应用 nowrap（会横向溢出）`);
    assert.ok(/display:-webkit-box/.test(r), `${name} 需要 -webkit-box 才能 line-clamp`);
  }
});
