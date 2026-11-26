'use strict';

/*
 * 封面源不得把「文档 URL」当图片（2026-11-23）
 *
 * 现象：反复返回 Home 后背景层可能失效，露出舞台歌词；WE 层若同时不可用会更明显。
 * 封面背景链的确定性缺陷：`customBackgroundAlbumCoverSource()` 原来按
 *   thumb.currentSrc || thumb.src || thumb.getAttribute('src')
 * 取封面。HTML 规范规定 `<img src="">` 的 `.src` 会解析成**当前文档 URL**，
 * 于是封面还没加载的那一瞬间，首页地址被当成封面写进 --custom-bg-image，
 * 壁纸变成一张 HTML 页（加载失败）；WE 层一旦被摘掉就露出下面的歌词底。
 *
 * 这里用 VM 直接跑函数，守住三条：
 *   1) 空 attr + 非空 prop（文档 URL）→ 返回空，不能回落；
 *   2) 正常封面地址原样返回；
 *   3) 根路径带 ?token= 的地址一律过滤。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/js/modules/02-visual/06-lyric-measure-colorlab.js'), 'utf8');

const start = SRC.indexOf('function customBackgroundAlbumCoverSource()');
const end = SRC.indexOf('function customBackgroundActiveMedia()');
assert.ok(start > 0 && end > start, '必须能截到 customBackgroundAlbumCoverSource');
const FN = SRC.slice(start, end);

function runCoverSource({ attr, prop, current, href }) {
  const sandbox = {
    location: { href },
    currentCoverSource: null,
    playQueue: [],
    currentIdx: -1,
    document: {
      getElementById: () => ({
        getAttribute: () => attr,
        get src() { return prop; },
        get currentSrc() { return current; },
      }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(FN + '\n__result = customBackgroundAlbumCoverSource();', sandbox);
  return sandbox.__result;
}

test('空 attr 时不得把文档 URL 当封面', () => {
  const href = 'http://127.0.0.1:3000/?startupAttempt=1&token=abc';
  // 这正是 img.src 在 src="" 时的规范返回值
  assert.equal(runCoverSource({ attr: '', prop: href, current: '', href }), '');
});

test('正常封面地址必须原样返回', () => {
  const href = 'http://127.0.0.1:3000/?x';
  const attr = '/api/cover?url=http%3A%2F%2Fimge.kugou.com%2Fx.jpg&token=abc';
  assert.equal(runCoverSource({ attr, prop: 'http://127.0.0.1:3000' + attr, current: '', href }), attr);
});

test('根路径带查询串的地址一律过滤（文档 URL 的另一种形态）', () => {
  const href = 'http://127.0.0.1:3000/?x';
  assert.equal(runCoverSource({ attr: href, prop: href, current: '', href }), '');
  assert.equal(runCoverSource({ attr: 'http://localhost:3000/?token=1', prop: 'http://localhost:3000/?token=1', current: '', href }), '');
});

test('源码必须优先 getAttribute，且注释说明规范坑', () => {
  const fn = SRC.slice(start, start + 2200);
  assert.match(fn, /thumb\.getAttribute\('src'\)/, '必须优先读原始属性');
  assert.ok(
    fn.indexOf("thumb.getAttribute('src')") < fn.indexOf('thumb.currentSrc'),
    'getAttribute 必须在 currentSrc 之前',
  );
  assert.match(fn, /文档 URL|文档地址/, '必须留注释解释 img.src 的规范行为');
  assert.match(fn, /localhost/, '必须有兜底过滤');
});

test('首次空源必须安排有界重试，否则壁纸永远是空底色', () => {
  const accent = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/01-lyric-color-accent.js'), 'utf8');
  assert.match(accent, /function scheduleCustomBackgroundAlbumRetry\(\)/, '必须有重试排程');
  assert.match(accent, /tries >= 8/, '重试必须有上限');
  assert.match(accent, /else if \(!layer\.style\.getPropertyValue\('--custom-bg-image'\)\)/, '只在层里没有旧图时才重试');
  const start = accent.indexOf("else if (!layer.style.getPropertyValue('--custom-bg-image'))");
  assert.ok(accent.slice(start, start + 200).includes('scheduleCustomBackgroundAlbumRetry()'), '必须真的调用重试');
});

test('封面加载完成必须刷新背景（否则普通播放不会写入 --custom-bg-image）', () => {
  const accent = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/01-lyric-color-accent.js'), 'utf8');
  assert.match(accent, /function watchThumbCoverForAlbumBackground\(\)/, '必须有封面就绪监听');
  assert.match(accent, /addEventListener\('load',[\s\S]{0,700}}, true\);/, '必须用捕获阶段监听（不依赖元素已挂载）');
  assert.match(accent, /target\.id !== 'thumb-cover'/, '必须按 id 精确匹配');
  assert.match(accent, /customBackgroundUsesAlbumCover\(\)[\s\S]{0,400}applyCustomBackground\(\)/, '封面模式才刷新，且必须真的调用');
});
